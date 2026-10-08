import type {Point} from './geometry.ts'
import type {Ingredient} from './state.ts'

import {addLayer, createIngredient, fitFrameToRect, getPlacementRect, resetProject, withIngredient, workspaceEpoch} from './actions.ts'
import {assets} from './assets.ts'
import {flushAutosave, resumeAutosave} from './autosave.ts'
import {renderRegion} from './composite.ts'
import {createId} from './createId.ts'
import {getExportPlan} from './exporting.ts'
import {encodeCanvas} from './image.ts'
import {defaultImportedMask, editorStore, projectStore} from './state.ts'

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
  const ingredient = await createIngredient(assets.require(assetId), name, kind ?? 'import')
  if (epoch !== workspaceEpoch) {
    throw new Error('The workspace changed while the reference was being prepared.')
  }
  projectStore.commit(document => withIngredient(document, ingredient))
  return projectStore.state.ingredients.find(item => item.assetId === assetId) ?? ingredient
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
/** Places a movable copy of a collection image onto the canvas, centered on the given world point or the frame. */
export function placeIngredient(ingredient: Ingredient, worldPoint?: Point) {
  const asset = assets.require(ingredient.assetId); const isFirst = !projectStore.state.layers.length
  const rect = getPlacementRect(asset, worldPoint)
  addLayer({
    id: createId(),
    assetId: asset.id,
    kind: 'import',
    name: ingredient.name,
    createdAt: Date.now(),
    visible: true,
    ...defaultImportedMask,
    rotation: 0,
    rect,
  })
  if (isFirst) {
    fitFrameToRect(rect)
  }
}
