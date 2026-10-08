import type {Point, Rect, Size} from './geometry.ts'
import type {Layer} from './state.ts'

import {forgetAdjustedImages, getAdjustedImage} from './adjustments/index.ts'
import {assets} from './assets.ts'
import {rectIntersection, rectUnion} from './geometry.ts'
import {createCanvas, getContext} from './image.ts'
import {getActiveAlignment, getContentRect, getLayerBounds, worldToLayer} from './layerGeometry.ts'
import {getFeatherMethod} from './feather/index.ts'
import {clipMask, createAlphaCanvas, getFeatherField, getSoftMask, isMaskActive, maskDistance} from './mask.ts'

export type RenderRegionOptions = {
  background?: string
  /** whether feather methods may adapt to the artwork below a layer; nested coverage renders turn this off */
  coverageAware?: boolean
  layers: ReadonlyArray<Layer>
  measureEmpty?: boolean
  region: Rect
  size: Size
}
export type RenderedRegion = {
  canvas: OffscreenCanvas
  emptyFraction: number
}
assets.subscribeRelease(forgetAdjustedImages)

export const getVisibleLayers = (layers: ReadonlyArray<Layer>) => layers.filter(layer => layer.visible)
export const isBackgroundLayer = (layers: ReadonlyArray<Layer>, layer: Layer) => layers[0]?.id === layer.id

const measureEmptyFraction = (canvas: OffscreenCanvas) => {
  const scale = Math.min(1, 192 / Math.max(canvas.width, canvas.height))
  const probe = createCanvas(canvas.width * scale, canvas.height * scale); const ctx = getContext(probe)
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height)
  const {data} = ctx.getImageData(0, 0, probe.width, probe.height)
  let empty = 0
  for (let i = 3; i < data.length; i += 4) {
    empty += data[i] < 250 ? 1 : 0
  }
  return empty / (probe.width * probe.height)
}

/** Mask resolutions snap to a few steps, so zooming does not recompute feather masks on every frame. */
const maskResolutions = [64, 96, 128, 192, 256, 384, 512, 768, 1024]
const getMaskResolution = (pixels: number) => maskResolutions.find(resolution => resolution >= pixels) ?? maskResolutions.at(-1)!

type SeamMaskEntry = {
  below: ReadonlyArray<Layer>
  canvas: OffscreenCanvas
  loaded: string
}
/** per layer and resolution, so the viewport, coverage probes and exports do not evict each other */
const seamMaskCache = new WeakMap<Layer, Map<string, SeamMaskEntry>>

/**
 * The feather ramp of a layer, adapted to where the artwork below it ends.
 *
 * Coverage is rendered in the layer’s own frame from the layers below, independent of the requested region, so the viewport, generation inputs and exports agree.
 */
function getSeamAwareMask(layers: ReadonlyArray<Layer>, index: number, resolution: number) {
  const layer = layers[index]
  const below = layers.slice(0, index)
  const method = getFeatherMethod()
  const key = `${method.id}:${resolution}`
  const loaded = below.map(item => Number(assets.has(item.assetId))).join('')
  let entries = seamMaskCache.get(layer)
  if (!entries) {
    entries = new Map
    seamMaskCache.set(layer, entries)
  }
  const cached = entries.get(key)
  if (cached?.loaded === loaded && cached.below.length === below.length && cached.below.every((item, i) => item === below[i])) {
    return cached.canvas
  }
  const field = getFeatherField(layer, layer.rect, resolution, method)
  const bounds = getLayerBounds(layer)
  const density = Math.max(field.width / layer.rect.width, field.height / layer.rect.height)
  const {canvas: coverage} = renderRegion({
    layers: below,
    region: bounds,
    size: {
      width: Math.max(1, Math.ceil(bounds.width * density)),
      height: Math.max(1, Math.ceil(bounds.height * density)),
    },
    measureEmpty: false,
    coverageAware: false,
  })
  // grid pixel → layer-local → world → coverage pixel
  const gridToCoverage = new DOMMatrix()
    .scale(coverage.width / bounds.width, coverage.height / bounds.height)
    .translate(-bounds.x, -bounds.y)
    .translate(layer.rect.x + layer.rect.width / 2, layer.rect.y + layer.rect.height / 2)
    .rotate(layer.rotation ?? 0)
    .translate(-layer.rect.width / 2, -layer.rect.height / 2)
    .scale(layer.rect.width / field.width, layer.rect.height / field.height)
  const sampled = createCanvas(field.width, field.height); const sample = getContext(sampled)
  sample.setTransform(gridToCoverage.inverse())
  sample.drawImage(coverage, 0, 0)
  const {data} = sample.getImageData(0, 0, field.width, field.height)
  const uncovered = new Uint8Array(field.depth.length)
  let seams = false
  for (const [i, depth] of field.depth.entries()) {
    if (!Number.isNaN(depth) && data[i * 4 + 3] < 128) {
      uncovered[i] = 1
      seams = true
    }
  }
  const canvas = seams ? createAlphaCanvas(method.getOverlapAlpha(field.depth, uncovered, field.width, field.height, field.transition), field) : getSoftMask(layer, layer.rect, resolution, method)
  entries.delete(key)
  entries.set(key, {
    below,
    canvas,
    loaded,
  })
  while (entries.size > 3) {
    entries.delete(entries.keys().next().value!)
  }
  return canvas
}

/** One path for the viewport, request crops, exports, clipboard and snapshots. */
export function renderRegion(options: RenderRegionOptions): RenderedRegion {
  const {region, size} = options
  if (!(region.width > 0 && region.height > 0)) {
    throw new Error('A render region must have positive dimensions.')
  }
  const canvas = createCanvas(size.width, size.height); const ctx = getContext(canvas)
  const sx = canvas.width / region.width; const sy = canvas.height / region.height
  const transform = (context: OffscreenCanvasRenderingContext2D, layer: Layer) => {
    context.setTransform(sx, 0, 0, sy, -region.x * sx, -region.y * sy)
    context.translate(layer.rect.x + layer.rect.width / 2, layer.rect.y + layer.rect.height / 2)
    context.rotate((layer.rotation ?? 0) * Math.PI / 180)
    context.translate(-layer.rect.width / 2, -layer.rect.height / 2)
  }
  for (const [index, layer] of options.layers.entries()) {
    if (!layer.visible || index > 0 && layer.area <= 0 || !rectIntersection(getLayerBounds(layer), region)) {
      continue
    }
    const asset = assets.get(layer.assetId)
    if (!asset) {
      continue
    }
    const masked = index > 0 && isMaskActive(layer)
    const surface = masked ? createCanvas(canvas.width, canvas.height) : canvas
    const target = masked ? getContext(surface) : ctx
    target.save()
    transform(target, layer)
    if (masked) {
      clipMask(target, layer, layer.rect)
    }
    const content = getContentRect(layer)
    if (getActiveAlignment(layer)) {
      // A realigned output may extend beyond its captured frame; the frame still bounds the layer.
      target.beginPath()
      target.rect(0, 0, layer.rect.width, layer.rect.height)
      target.clip()
    }
    target.drawImage(getAdjustedImage(asset.bitmap, asset.id, layer.adjustments), content.x, content.y, content.width, content.height)
    target.restore()
    if (!masked) {
      continue
    }
    if (layer.feather > 0) {
      // Reduction = existing coverage × (1 − feather). An exposed outer edge has no
      // existing coverage and therefore stays sharp. Never mask the accumulated scene.
      const reduction = createCanvas(canvas.width, canvas.height); const reduce = getContext(reduction)
      if (layer.featherAllEdges) {
        reduce.fillStyle = 'white'; reduce.fillRect(0, 0, reduction.width, reduction.height)
      } else {
        reduce.drawImage(canvas, 0, 0)
      }
      reduce.save()
      reduce.globalCompositeOperation = 'destination-out'
      transform(reduce, layer)
      const resolution = getMaskResolution(Math.ceil(Math.max(layer.rect.width * sx, layer.rect.height * sy)))
      const method = getFeatherMethod()
      const soft = options.coverageAware !== false && method.coverageAware && !layer.featherAllEdges ? getSeamAwareMask(options.layers, index, resolution) : getSoftMask(layer, layer.rect, resolution, method)
      reduce.drawImage(soft, 0, 0, layer.rect.width, layer.rect.height)
      reduce.restore()
      target.save()
      target.globalCompositeOperation = 'destination-out'
      target.drawImage(reduction, 0, 0)
      target.restore()
    }
    ctx.drawImage(surface, 0, 0)
  }
  const emptyFraction = options.measureEmpty === false ? 0 : measureEmptyFraction(canvas)
  if (options.background) {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
  return {
    canvas,
    emptyFraction,
  }
}

export const getContentBounds = (layers: ReadonlyArray<Layer>) => rectUnion(layers.flatMap((layer, i) => (layer.visible && (i === 0 || layer.area > 0) ? [getLayerBounds(layer, i > 0)] : [])).filter(rect => rect.width > 0 && rect.height > 0))
export const frameHasContent = (layers: ReadonlyArray<Layer>, frame: Rect) => layers.some((layer, i) => layer.visible && (i === 0 || layer.area > 0) && rectIntersection(getLayerBounds(layer, i > 0), frame) && assets.has(layer.assetId))
export const getUpstreamCanvasSize = (frame: Rect, maxSide = 2048, minSide = 1024): Size => {
  const side = Math.max(frame.width, frame.height); const target = Math.min(maxSide, Math.max(minSide, side)); const scale = target / side
  return {
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  }
}
export const findLayerAt = (layers: ReadonlyArray<Layer>, point: Point) => layers.findLast((layer, i) => {
  if (!layer.visible) {
    return false
  }
  const local = worldToLayer(layer, point)
  if (local.x < 0 || local.y < 0 || local.x > layer.rect.width || local.y > layer.rect.height) {
    return false
  }
  return i === 0 || layer.area > 0 && maskDistance(layer, layer.rect, local.x, local.y) <= 0
})

/** Fraction of the region that stays empty, probed at low resolution; pixels count as covered once they are at least half opaque. */
export function measureUncovered(layers: ReadonlyArray<Layer>, region: Rect, maxSide = 128) {
  const scale = maxSide / Math.max(region.width, region.height)
  const {canvas} = renderRegion({
    layers,
    region,
    size: {
      width: Math.max(1, Math.round(region.width * scale)),
      height: Math.max(1, Math.round(region.height * scale)),
    },
    measureEmpty: false,
  })
  const {data} = getContext(canvas).getImageData(0, 0, canvas.width, canvas.height)
  let empty = 0
  for (let i = 3; i < data.length; i += 4) {
    empty += data[i] < 128 ? 1 : 0
  }
  return empty / (canvas.width * canvas.height)
}
