import type {Rect} from './geometry.ts'
import type {PersistedEditorState} from './persistence.ts'
import type {GenerationEvidence, Ingredient, Layer, ProjectDocument} from './state.ts'

import {findModel} from './models/index.ts'
import {closestRatio, isRatioString, parseRatio} from './ratio.ts'

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (): never => {
  throw new Error('Invalid or unsupported LayerPaint project. The existing workspace was not replaced.')
}
const text = (v: unknown, limit = 200) => (typeof v === 'string' && v.length > 0 && v.length <= limit ? v : fail())
const number = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail())
const bool = (v: unknown) => (typeof v === 'boolean' ? v : fail())
export function parseRect(v: unknown): Rect {
  if (!isRecord(v)) {
    return fail()
  }
  return {
    x: number(v.x, -1e8, 1e8),
    y: number(v.y, -1e8, 1e8),
    width: number(v.width, 0.001, 1e7),
    height: number(v.height, 0.001, 1e7),
  }
}
export function parseProjectDocument(value: unknown): ProjectDocument {
  if (!isRecord(value) || !Array.isArray(value.layers) || !Array.isArray(value.ingredients) || value.layers.length > 1000 || value.ingredients.length > 1000) {
    return fail()
  }
  const ids = new Set<string>; const indexes = new Set<number>
  const uniqueId = (v: unknown) => {
    const id = text(v); if (ids.has(id)) {
      return fail()
    } ids.add(id); return id
  }
  const layers: Array<Layer> = value.layers.map(v => {
    if (!isRecord(v) || !['generated', 'import'].includes(String(v.kind))) {
      return fail()
    }
    const result: Layer = {
      id: uniqueId(v.id),
      assetId: text(v.assetId),
      name: text(v.name, 1000),
      kind: v.kind as Layer['kind'],
      createdAt: number(v.createdAt, 0, 9e15),
      rect: parseRect(v.rect),
      visible: bool(v.visible),
      area: number(v.area, 0, 1),
      feather: number(v.feather, 0, 1),
    }
    if (v.rotation !== undefined) {
      result.rotation = number(v.rotation, -360, 360)
    }
    if (result.kind === 'generated' && result.rotation) {
      return fail()
    }
    if (v.offsetX !== undefined) {
      result.offsetX = number(v.offsetX, -1, 1)
    }
    if (v.offsetY !== undefined) {
      result.offsetY = number(v.offsetY, -1, 1)
    }
    if (v.roundness !== undefined) {
      result.roundness = number(v.roundness, 0, 1)
    }
    if (v.featherAllEdges !== undefined) {
      result.featherAllEdges = bool(v.featherAllEdges)
    }
    if (v.modelId !== undefined) {
      result.modelId = text(v.modelId)
    }
    if (v.prompt !== undefined) {
      result.prompt = text(v.prompt, 110_000)
    }
    if (v.aligned !== undefined) {
      result.aligned = bool(v.aligned)
    }
    const captured = evidence(v.evidence)
    if (captured) {
      result.evidence = captured
    }
    return result
  })
  const ingredients: Array<Ingredient> = value.ingredients.map(v => {
    if (!isRecord(v)) {
      return fail()
    }
    const index = number(v.index, 1, Number.MAX_SAFE_INTEGER)
    if (!Number.isSafeInteger(index) || indexes.has(index)) {
      return fail()
    }
    indexes.add(index)
    const kind = v.kind ?? 'import'
    if (!['generated', 'import', 'snapshot'].includes(String(kind))) {
      return fail()
    }
    // Thumbnails are regenerated from decoded assets, not trusted HTML or URLs.
    return {
      id: uniqueId(v.id),
      assetId: text(v.assetId),
      index,
      name: text(v.name, 1000),
      createdAt: number(v.createdAt, 0, 9e15),
      thumbnail: '',
      kind: kind as Ingredient['kind'],
    }
  })
  const next = value.nextIngredientIndex ?? Math.max(0, ...indexes) + 1
  if (!Number.isSafeInteger(next) || Number(next) <= Math.max(0, ...indexes)) {
    return fail()
  }
  return {
    layers,
    ingredients,
    nextIngredientIndex: Number(next),
    ...value.layersNumbered === true ? {layersNumbered: true} : {},
  }
}
export function collectDocumentAssetIds(documents: Iterable<ProjectDocument>) {
  const ids = new Set<string>
  for (const document of documents) {
    for (const layer of document.layers) {
      ids.add(layer.assetId)
      if (!layer.evidence) {
        continue
      }
      if (layer.evidence.canvasAssetId) {
        ids.add(layer.evidence.canvasAssetId)
      }
      ids.add(layer.evidence.outputAssetId)
      for (const id of layer.evidence.referenceAssetIds) {
        ids.add(id)
      }
    }
    for (const ingredient of document.ingredients) {
      ids.add(ingredient.assetId)
    }
  }
  return ids
}
export function parseEditor(value: unknown): PersistedEditorState {
  if (!isRecord(value) || !isRecord(value.view) || typeof value.prompt !== 'string' || value.prompt.length > 100_000) {
    return fail()
  }
  const model = findModel(value.modelId)
  if (!model || !isRatioString(value.ratio)) {
    return fail()
  }
  const ratio = model.supportsRatio(value.ratio) ? value.ratio : closestRatio(parseRatio(value.ratio), model.aspectRatios)
  return {
    frame: parseRect(value.frame),
    frameEnabled: typeof value.frameEnabled === 'boolean' ? value.frameEnabled : true,
    view: {
      x: number(value.view.x, -1e10, 1e10),
      y: number(value.view.y, -1e10, 1e10),
      scale: number(value.view.scale, 0.02, 32),
    },
    layersPanelOpen: typeof value.layersPanelOpen === 'boolean' ? value.layersPanelOpen : true,
    modelId: model.id,
    prompt: value.prompt,
    ratio,
    resolution: model.normalizeResolution(typeof value.resolution === 'string' ? value.resolution : '') ?? '',
    quality: model.normalizeQuality(typeof value.quality === 'string' ? value.quality : '') ?? '',
    exportMode: ['canvas', 'custom', 'detail'].includes(String(value.exportMode)) ? value.exportMode as 'canvas' | 'custom' | 'detail' : 'detail',
    exportScale: typeof value.exportScale === 'number' ? number(value.exportScale, 0.01, 64) : 1,
    alignOutput: typeof value.alignOutput === 'boolean' ? value.alignOutput : false,
    demoMode: typeof value.demoMode === 'boolean' ? value.demoMode : false,
  }
}

function evidence(v: unknown): GenerationEvidence | undefined {
  if (v === undefined) {
    return undefined
  }
  if (!isRecord(v) || !Array.isArray(v.referenceAssetIds) || v.referenceAssetIds.length > 32) {
    return fail()
  }
  const emptyText = (value: unknown) => (typeof value === 'string' && value.length <= 110_000 ? value : fail())
  return {
    id: text(v.id),
    capturedAt: number(v.capturedAt, 0, 9e15),
    frame: parseRect(v.frame),
    modelId: text(v.modelId),
    ratio: text(v.ratio),
    resolution: emptyText(v.resolution),
    quality: emptyText(v.quality),
    prompt: emptyText(v.prompt),
    compiledPrompt: emptyText(v.compiledPrompt),
    ...v.canvasAssetId === undefined ? {} : {canvasAssetId: text(v.canvasAssetId)},
    referenceAssetIds: v.referenceAssetIds.map(id => text(id)),
    outputAssetId: text(v.outputAssetId),
    ...v.cost === undefined ? {} : {cost: number(v.cost, 0, 1e6)},
    ...v.demo === undefined ? {} : {demo: bool(v.demo)},
  }
}
