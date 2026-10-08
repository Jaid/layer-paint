import type {PersistedEditorState, StoredProject} from './persistence.ts'
import type {ProjectDocument} from './state.ts'

import queryParameters, {explicitQueryKeys} from '#src/queryParameters.ts'

import {setModel, setRatio, withLayerIngredients} from './actions.ts'
import {assets} from './assets.ts'
import {createThumbnailDataUrl, decodeImage} from './image.ts'
import {getModel} from './models/index.ts'
import {getErrorMessage, notify} from './notices.ts'
import {isPersistenceAvailable, loadAssets, loadProject, saveProject} from './persistence.ts'
import {collectDocumentAssetIds, parseEditor, parseProjectDocument} from './projectSchema.ts'
import {closestRatio, isRatioString, parseRatio} from './ratio.ts'
import {editorStore, projectStore} from './state.ts'
import {Store} from './store/index.ts'

export const persistenceStore = new Store({
  hydrated: false,
  lastSavedAt: 0,
  saving: false,
  paused: false,
  error: '',
})
export const getPersistedEditorState = (): PersistedEditorState => {
  const {frame, frameEnabled, layersPanelOpen, modelId, prompt, quality, ratio, resolution, view, exportMode, exportScale, demoMode} = editorStore.state
  return {
    frame,
    frameEnabled,
    layersPanelOpen,
    modelId,
    prompt,
    quality,
    ratio,
    resolution,
    view,
    exportMode,
    exportScale,
    demoMode,
  }
}
export const collectGarbage = () => assets.retain(collectDocumentAssetIds(projectStore.reachableStates))
export const resumeAutosave = () => persistenceStore.set({
  paused: false,
  error: '',
})
let timer: ReturnType<typeof setTimeout> | undefined
let saveChain: Promise<void> = Promise.resolve()
async function save() {
  if (!persistenceStore.state.hydrated || persistenceStore.state.paused || !isPersistenceAvailable()) {
    return
  }
  const document = projectStore.state
  const blobs = new Map([...collectDocumentAssetIds([document])].map(id => [id, assets.require(id).blob]))
  const project: StoredProject = {
    version: 1,
    savedAt: Date.now(),
    document,
    editor: getPersistedEditorState(),
  }
  persistenceStore.set({saving: true})
  try {
    await saveProject(project, blobs)
    persistenceStore.set({
      saving: false,
      lastSavedAt: project.savedAt,
      error: '',
    })
    collectGarbage()
  } catch (error) {
    const message = getErrorMessage(error)
    persistenceStore.set({
      saving: false,
      error: message,
    })
    notify('error', `Autosave failed. Save a portable project: ${message}`)
  }
}
export const flushAutosave = () => {
  clearTimeout(timer)
  timer = undefined
  saveChain = saveChain.then(save).catch(error => {
    persistenceStore.set({
      saving: false,
      error: getErrorMessage(error),
    })
  })
  return saveChain
}
const scheduleSave = () => {
  if (!persistenceStore.state.hydrated || persistenceStore.state.paused) {
    return
  }
  clearTimeout(timer)
  timer = setTimeout(() => {
    void flushAutosave()
  }, 600)
}

export async function rebuildThumbnails(document: ProjectDocument): Promise<ProjectDocument> {
  const ingredients = await Promise.all(document.ingredients.map(async ingredient => ({
    ...ingredient,
    thumbnail: await createThumbnailDataUrl(assets.require(ingredient.assetId).bitmap),
  })))
  return {
    ...document,
    ingredients,
  }
}
async function restore() {
  const raw = await loadProject()
  if (raw === undefined) {
    return false
  }
  if (raw.version !== 1) {
    throw new Error('Unsupported autosave version.')
  }
  const document = parseProjectDocument(raw.document); const editor = parseEditor(raw.editor)
  const ids = collectDocumentAssetIds([document]); const stored = await loadAssets(ids)
  if (stored.length !== ids.size) {
    throw new Error('Some saved images are missing. Recovery has been paused to protect the original data.')
  }
  // Validate and decode everything before mutating the live document.
  const decoded = await Promise.all(stored.map(async entry => ({
    ...entry,
    image: await decodeImage(entry.blob),
  })))
  for (const entry of decoded) {
    await assets.add(entry.blob, entry.image, entry.id)
  }
  projectStore.reset(await rebuildThumbnails(withLayerIngredients(document)))
  editorStore.set({
    ...editor,
    prompt: explicitQueryKeys.has('prompt') ? queryParameters.prompt : editor.prompt,
  })
  setModel(explicitQueryKeys.has('model') ? queryParameters.model : editor.modelId)
  if (explicitQueryKeys.has('ratio')) {
    const model = getModel(editorStore.state.modelId)
    const requested = isRatioString(queryParameters.ratio) ? queryParameters.ratio : '1:1'
    setRatio(model.supportsRatio(requested) ? requested : closestRatio(parseRatio(requested), model.aspectRatios))
  }
  const model = getModel(editorStore.state.modelId)
  if (explicitQueryKeys.has('resolution')) {
    editorStore.set({resolution: model.normalizeResolution(queryParameters.resolution) ?? ''})
  }
  if (explicitQueryKeys.has('quality')) {
    editorStore.set({quality: model.normalizeQuality(queryParameters.quality) ?? ''})
  }
  return true
}
let started = false
export async function startAutosave() {
  if (started) {
    return false
  }
  started = true
  let restored = false
  if (isPersistenceAvailable()) {
    try {
      restored = await restore()
    } catch (error) {
      persistenceStore.set({
        paused: true,
        error: getErrorMessage(error),
      })
      notify('error', 'Recovery is paused. Stored data has not been changed. Open a valid project or choose New project to resume saving.')
    }
  }
  persistenceStore.set({hydrated: true})
  projectStore.subscribe(scheduleSave)
  let previous = getPersistedEditorState()
  editorStore.subscribe(() => {
    const next = getPersistedEditorState()
    const changed = (Object.keys(next) as Array<keyof PersistedEditorState>).some(key => next[key] !== previous[key])
    previous = next
    if (changed) {
      scheduleSave()
    }
  })
  addEventListener('pagehide', () => {
    if (timer !== undefined) {
      void flushAutosave()
    }
  })
  return restored
}
