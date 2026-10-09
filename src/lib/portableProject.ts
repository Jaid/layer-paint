import type {GenerationEvidence, ProjectDocument} from './state.ts'

import {advanceWorkspaceEpoch, withLayerIngredients} from './actions.ts'
import {assets} from './assets.ts'
import {flushAutosave, getPersistedEditorState, rebuildThumbnails, resumeAutosave} from './autosave.ts'
import {createId} from './createId.ts'
import {createFileName, downloadBlob} from './exporting.ts'
import {blobToDataUrl, decodeImage} from './image.ts'
import {collectDocumentAssetIds, isRecord, parseEditor, parseProjectDocument} from './projectSchema.ts'
import {editorStore, projectStore} from './state.ts'

/** Local, user-initiated project export. Credentials are not part of either serialized state type. */
export async function serializeProject(): Promise<string> {
  const document = projectStore.state; const editor = getPersistedEditorState()
  const records = await Promise.all([...collectDocumentAssetIds([document])].map(async id => ({
    id,
    dataUrl: await blobToDataUrl(assets.require(id).blob),
  })))
  return JSON.stringify({
    format: 'layerpaint',
    version: 1,
    savedAt: Date.now(),
    document,
    editor,
    assets: records,
  })
}
export async function savePortableProject() {
  const content = await serializeProject()
  if (new Blob([content]).size > 200_000_000) {
    throw new Error('This project exceeds the 200 mb portable-file limit. Export a smaller workspace.')
  }
  downloadBlob(new Blob([content], {type: 'application/json'}), createFileName('layerpaint'))
}

/** Validate and decode a user-selected file before replacing the workspace. Incoming asset IDs are remapped. */
export async function openPortableProject(file: Blob | File) {
  const startingDocument = projectStore.state; const startingPrompt = editorStore.state.prompt
  const unchanged = () => projectStore.state === startingDocument && editorStore.state.prompt === startingPrompt
  if (file.size > 200_000_000) {
    throw new Error('Project files must be smaller than 200 mb.')
  }
  const value: unknown = JSON.parse(await file.text())
  if (!isRecord(value) || value.format !== 'layerpaint' || value.version !== 1 || !Array.isArray(value.assets) || value.assets.length > 4000) {
    throw new Error('Unsupported LayerPaint project format.')
  }
  const document = parseProjectDocument(value.document); const editor = parseEditor(value.editor)
  const ids = collectDocumentAssetIds([document])
  const raw = new Map<string, string>
  for (const entry of value.assets) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.dataUrl !== 'string' || raw.has(entry.id) || !/^data:image\/(jpeg|png|webp);base64,[+/0-9A-Za-z]+={0,2}$/.test(entry.dataUrl)) {
      throw new Error('Invalid or duplicate project image.')
    }
    raw.set(entry.id, entry.dataUrl)
  }
  if ([...ids].some(id => !raw.has(id))) {
    throw new Error('The project references a missing image.')
  }
  const staged: Array<{
    blob: Blob
    decoded: Awaited<ReturnType<typeof decodeImage>>
    id: string
    oldId: string
  }> = []
  try {
    for (const oldId of ids) {
      const url = raw.get(oldId)!; const comma = url.indexOf(',')
      const bytes = Uint8Array.fromBase64(url.slice(comma + 1))
      if (bytes.byteLength > 40_000_000) {
        throw new Error('A project image exceeds the 40 mb source limit.')
      }
      const blob = new Blob([bytes], {type: url.slice(5, url.indexOf(';'))})
      staged.push({
        oldId,
        id: createId(),
        blob,
        decoded: await decodeImage(blob),
      })
    }
  } catch (error) {
    for (const entry of staged) {
      entry.decoded.bitmap.close()
    } throw error
  }
  if (!unchanged()) {
    for (const entry of staged) {
      entry.decoded.bitmap.close()
    } throw new Error('The workspace changed while the project was opening. Your edits were preserved; open the file again when ready.')
  }
  const remap = new Map(staged.map(entry => [entry.oldId, entry.id]))
  const remapEvidence = (evidence: GenerationEvidence): GenerationEvidence => ({
    ...evidence,
    id: createId(),
    outputAssetId: remap.get(evidence.outputAssetId)!,
    canvasAssetId: evidence.canvasAssetId ? remap.get(evidence.canvasAssetId)! : undefined,
    referenceAssetIds: evidence.referenceAssetIds.map(id => remap.get(id)!),
  })
  const newDocument: ProjectDocument = {
    nextIngredientIndex: document.nextIngredientIndex,
    ...document.layersNumbered ? {layersNumbered: true} : {},
    ingredients: document.ingredients.map(item => ({
      ...item,
      id: createId(),
      assetId: remap.get(item.assetId)!,
      ...item.sourceAssetId ? {sourceAssetId: remap.get(item.sourceAssetId)!} : {},
    })),
    layers: document.layers.map(layer => ({
      ...layer,
      id: createId(),
      assetId: remap.get(layer.assetId)!,
      ...layer.evidence ? {evidence: remapEvidence(layer.evidence)} : {},
      ...layer.revisions ? {revisions: layer.revisions.map(item => ({
        ...item,
        assetId: remap.get(item.assetId)!,
        evidence: remapEvidence(item.evidence),
      }))} : {},
    })),
  }
  for (const entry of staged) {
    await assets.add(entry.blob, entry.decoded, entry.id)
  }
  const hydrated = await rebuildThumbnails(withLayerIngredients(newDocument))
  if (!unchanged()) {
    throw new Error('The workspace changed while the project was opening. Your edits were preserved.')
  }
  for (const job of editorStore.state.jobs) {
    job.controller.abort()
  }
  advanceWorkspaceEpoch()
  projectStore.commit(hydrated)
  editorStore.set({
    ...editor,
    jobs: [],
    selectedLayerId: null,
    hoveredLayerId: null,
    hoveredCollectionIndex: null,
    tool: 'frame',
  })
  resumeAutosave()
  await flushAutosave()
}
