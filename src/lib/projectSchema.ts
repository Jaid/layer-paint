import type {Adjustments} from './adjustments/index.ts'
import type {Rect} from './geometry.ts'
import type {PersistedEditorState} from './persistence.ts'
import type {GenerationEvidence, GenerationRevision, Ingredient, Layer, LayerAlignment, ProjectDocument} from './state.ts'

import {adjustmentKeys, normalizeAdjustments} from './adjustments/index.ts'
import {findModel} from './models/index.ts'
import {isFlip, isRotation} from './orientation.ts'
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
    if (v.opacity !== undefined) {
      result.opacity = number(v.opacity, 0, 1)
    }
    if (v.modelId !== undefined) {
      result.modelId = text(v.modelId)
    }
    if (v.prompt !== undefined) {
      result.prompt = text(v.prompt, 110_000)
    }
    if (v.contentAware !== undefined) {
      result.contentAware = bool(v.contentAware)
    }
    if (v.alignment !== undefined) {
      result.alignment = alignment(v.alignment)
    }
    if (v.adjustments !== undefined) {
      const adjustments = parseAdjustments(v.adjustments)
      if (adjustments) {
        result.adjustments = adjustments
      }
    }
    if ((result.contentAware || result.alignment) && result.kind !== 'generated') {
      return fail()
    }
    const captured = evidence(v.evidence)
    if (captured) {
      result.evidence = captured
    }
    if (v.revisions !== undefined) {
      if (result.kind !== 'generated' || !result.evidence || !Array.isArray(v.revisions) || v.revisions.length < 1 || v.revisions.length > 1000) {
        return fail()
      }
      result.revisions = v.revisions.map(revision)
      const shown = number(v.revision ?? 0, 0, result.revisions.length - 1)
      if (!Number.isSafeInteger(shown)) {
        return fail()
      }
      result.revision = shown
    } else if (v.revision !== undefined) {
      return fail()
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
    const result: Ingredient = {
      id: uniqueId(v.id),
      assetId: text(v.assetId),
      index,
      name: text(v.name, 1000),
      createdAt: number(v.createdAt, 0, 9e15),
      thumbnail: '',
      kind: kind as Ingredient['kind'],
    }
    if (v.rotation !== undefined) {
      result.rotation = isRotation(v.rotation) && v.rotation !== 0 ? v.rotation : fail()
    }
    if (v.flip !== undefined) {
      result.flip = isFlip(v.flip) && v.flip !== 'none' ? v.flip : fail()
    }
    // The original image is kept exactly while a rotation or flip is applied.
    if (v.sourceAssetId !== undefined) {
      result.sourceAssetId = text(v.sourceAssetId)
    }
    if (Boolean(result.sourceAssetId) !== Boolean(result.rotation || result.flip)) {
      return fail()
    }
    return result
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
const addEvidenceAssetIds = (ids: Set<string>, captured: GenerationEvidence | undefined) => {
  if (!captured) {
    return
  }
  if (captured.canvasAssetId) {
    ids.add(captured.canvasAssetId)
  }
  ids.add(captured.outputAssetId)
  for (const id of captured.referenceAssetIds) {
    ids.add(id)
  }
}
export function collectDocumentAssetIds(documents: Iterable<ProjectDocument>) {
  const ids = new Set<string>
  for (const document of documents) {
    for (const layer of document.layers) {
      ids.add(layer.assetId)
      addEvidenceAssetIds(ids, layer.evidence)
      for (const item of layer.revisions ?? []) {
        ids.add(item.assetId)
        addEvidenceAssetIds(ids, item.evidence)
      }
    }
    for (const ingredient of document.ingredients) {
      ids.add(ingredient.assetId)
      if (ingredient.sourceAssetId) {
        ids.add(ingredient.sourceAssetId)
      }
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
    demoMode: typeof value.demoMode === 'boolean' ? value.demoMode : false,
  }
}

function alignment(v: unknown): LayerAlignment {
  if (!isRecord(v)) {
    return fail()
  }
  return {
    x: number(v.x, -10, 10),
    y: number(v.y, -10, 10),
    scale: number(v.scale, 0.01, 100),
    applied: bool(v.applied),
  }
}
function revision(v: unknown): GenerationRevision {
  if (!isRecord(v)) {
    return fail()
  }
  return {
    assetId: text(v.assetId),
    evidence: evidence(v.evidence) ?? fail(),
    ...v.modelId === undefined ? {} : {modelId: text(v.modelId)},
    ...v.alignment === undefined ? {} : {alignment: alignment(v.alignment)},
  }
}
function parseAdjustments(v: unknown) {
  if (!isRecord(v)) {
    return fail()
  }
  const parsed: Adjustments = {}
  for (const key of adjustmentKeys) {
    if (v[key] !== undefined) {
      parsed[key] = number(v[key], -1, 1)
    }
  }
  return normalizeAdjustments(parsed)
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
