import type {EditorState, ProjectDocument} from './state.ts'
import type {DBSchema, IDBPDatabase} from 'idb'

import {openDB} from 'idb'

export type StoredAsset = {
  blob: Blob
  id: string
}
export type PersistedEditorState = Pick<EditorState, 'alignOutput' | 'demoMode' | 'exportMode' | 'exportScale' | 'frame' | 'layersPanelOpen' | 'modelId' | 'prompt' | 'quality' | 'ratio' | 'resolution' | 'view'>
export type StoredProject = {
  document: ProjectDocument
  editor: PersistedEditorState
  savedAt: number
  version: 1
}
interface Database extends DBSchema {
  assets: {
    key: string
    value: StoredAsset
  }
  state: {
    key: string
    value: StoredProject
  }
}
let pending: Promise<IDBPDatabase<Database>> | undefined
const openDatabase = () => {
  pending ??= openDB<Database>('layer-paint-definitive', 1, {
    upgrade(db) {
      db.createObjectStore('assets', {keyPath: 'id'}); db.createObjectStore('state')
    },
    blocking() {
      void pending?.then(db => db.close()); pending = undefined
    },
    terminated() {
      pending = undefined
    },
  }).catch(error => {
    pending = undefined; throw error
  })
  return pending
}
export const isPersistenceAvailable = () => typeof indexedDB !== 'undefined'
export const loadProject = async () => (await openDatabase()).get('state', 'project')
export async function loadAssets(ids: Iterable<string>) {
  const db = await openDatabase(); const transaction = db.transaction('assets', 'readonly')
  const values = await Promise.all([...ids].map(id => transaction.store.get(id)))
  await transaction.done
  return values.filter((asset): asset is StoredAsset => asset !== undefined)
}

/** Images and document become visible together, or neither does. Asset IDs are immutable. */
export async function saveProject(project: StoredProject, blobs: ReadonlyMap<string, Blob>) {
  const db = await openDatabase(); const transaction = db.transaction(['assets', 'state'], 'readwrite')
  const done = transaction.done
  // Observe rejection immediately, including failures before the final await.
  void done.catch(() => {})
  try {
    const store = transaction.objectStore('assets'); const keys = new Set(await store.getAllKeys())
    const writes: Array<Promise<unknown>> = []
    for (const [id, blob] of blobs) {
      if (!keys.has(id)) {
        writes.push(store.put({
          id,
          blob,
        }))
      }
    }
    for (const id of keys) {
      if (!blobs.has(id)) {
        writes.push(store.delete(id))
      }
    }
    writes.push(transaction.objectStore('state').put(project, 'project'))
    await Promise.all(writes)
    await done
  } catch (error) {
    try {
      transaction.abort()
    } catch {}
    await done.catch(() => {})
    throw error
  }
}
export async function clearProject() {
  const transaction = (await openDatabase()).transaction(['assets', 'state'], 'readwrite')
  await Promise.all([transaction.objectStore('assets').clear(), transaction.objectStore('state').clear(), transaction.done])
}
