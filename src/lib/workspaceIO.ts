import type {Ingredient} from './state.ts'

import {addLayer, getNextIngredientIndex, resetProject, selectLayer, workspaceEpoch} from './actions.ts'
import {assets} from './assets.ts'
import {flushAutosave, resumeAutosave} from './autosave.ts'
import {renderRegion} from './composite.ts'
import {createId} from './createId.ts'
import {getExportPlan} from './exporting.ts'
import {createThumbnailDataUrl, encodeCanvas} from './image.ts'
import {editorStore, projectStore} from './state.ts'

export {openPortableProject, savePortableProject, serializeProject} from './portableProject.ts'

export async function newProject() {
  resetProject()
  resumeAutosave()
  await flushAutosave()
}
export async function referenceAsset(assetId: string, name: string, kind: Ingredient['kind'] = 'import') {
  const epoch = workspaceEpoch
  const existing = projectStore.state.ingredients.find(item => item.assetId === assetId)
  if (existing) {
    return existing
  }
  const asset = assets.require(assetId)
  const ingredient: Ingredient = {
    id: createId(),
    index: getNextIngredientIndex(projectStore.state.ingredients),
    assetId,
    name,
    kind,
    thumbnail: await createThumbnailDataUrl(asset.bitmap),
    createdAt: Date.now(),
  }
  if (epoch !== workspaceEpoch) {
    throw new Error('The workspace changed while the reference was being prepared.')
  }
  projectStore.commit(document => ({
    ...document,
    nextIngredientIndex: Math.max(document.nextIngredientIndex ?? 1, ingredient.index + 1),
    ingredients: [...document.ingredients, ingredient],
  }))
  return ingredient
}
export async function captureCanvasSnapshot() {
  const epoch = workspaceEpoch
  const layers = projectStore.state.layers; const region = {...editorStore.state.frame}
  if (!layers.some(layer => layer.visible)) {
    throw new Error('Add artwork before capturing a snapshot.')
  }
  const size = getExportPlan(layers, region)
  if (size.limited) {
    throw new Error('This snapshot exceeds the pixel limit. Use a smaller frame.')
  }
  const {canvas} = renderRegion({
    layers,
    region,
    size,
    measureEmpty: false,
  })
  const asset = await assets.add(await encodeCanvas(canvas, 'png'))
  if (epoch !== workspaceEpoch) {
    throw new Error('The workspace changed while the snapshot was being prepared.')
  }
  return referenceAsset(asset.id, `Snapshot ${(new Date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`, 'snapshot')
}
export function placeIngredient(ingredient: Ingredient) {
  const asset = assets.require(ingredient.assetId); const frame = editorStore.state.frame
  const scale = Math.min(1, frame.width / asset.width, frame.height / asset.height)
  const width = asset.width * scale; const height = asset.height * scale; const id = createId()
  addLayer({
    id,
    assetId: asset.id,
    kind: 'import',
    name: ingredient.name,
    createdAt: Date.now(),
    visible: true,
    area: 1,
    feather: 0,
    rotation: 0,
    rect: {
      x: frame.x + (frame.width - width) / 2,
      y: frame.y + (frame.height - height) / 2,
      width,
      height,
    },
  })
  selectLayer(id)
  editorStore.set({tool: 'image'})
}
