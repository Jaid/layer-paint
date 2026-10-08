import type {FeatherMethod, FeatherShape} from './feather/index.ts'
import type {Rect, Size} from './geometry.ts'

import {getFeatherMethod} from './feather/index.ts'
import {clamp} from './geometry.ts'

export type MaskSettings = {
  /** Fraction of rectangular area retained before corner rounding. */
  area: number
  /** Inward feather width as a fraction of half the shorter mask side. */
  feather: number
  /** Normally only overlap with underlying artwork is feathered. */
  featherAllEdges?: boolean
  offsetX?: number
  offsetY?: number
  roundness?: number
}
export type MaskStop = {
  alpha: number
  offset: number
}
/** feather depths sampled at the pixel centers of a grid that spans the layer */
export type FeatherField = Size & {
  depth: Float32Array
  method: FeatherMethod
  /** feather width in grid pixels */
  transition: number
}
export const isMaskActive = (settings: MaskSettings) => settings.area < 1 || settings.feather > 0 || Boolean(settings.offsetX || settings.offsetY || settings.roundness)

export const getMaskMetrics = (settings: MaskSettings, size: Size) => {
  const scale = Math.sqrt(clamp(settings.area, 0, 1))
  const width = size.width * scale; const height = size.height * scale
  const x = (size.width - width) / 2 + (settings.offsetX ?? 0) * size.width
  const y = (size.height - height) / 2 + (settings.offsetY ?? 0) * size.height
  const radius = clamp(settings.roundness ?? 0, 0, 1) * Math.min(width, height) / 2
  const transition = clamp(settings.feather, 0, 1) * Math.min(width, height) / 2
  return {
    x,
    y,
    width,
    height,
    radius,
    transition,
    inset: (size.width - width) / 2,
  }
}
export const getMaskRect = (settings: MaskSettings, size: Size): Rect => {
  const {x, y, width, height} = getMaskMetrics(settings, size)
  return {
    x,
    y,
    width,
    height,
  }
}
export const getFeatherShape = (settings: MaskSettings, size: Size): FeatherShape => {
  const m = getMaskMetrics(settings, size)
  return {
    centerX: m.x + m.width / 2,
    centerY: m.y + m.height / 2,
    halfWidth: m.width / 2,
    halfHeight: m.height / 2,
    radius: m.radius,
    transition: m.transition,
  }
}

/** the fully opaque core of the feathered mask that the viewport outlines, relative to the mask rectangle */
export const getFeatherCore = (settings: MaskSettings, size: Size, method = getFeatherMethod()) => method.getCore(getFeatherShape(settings, size))

/** Signed distance to a rounded rectangle, negative inside. */
export function maskDistance(settings: MaskSettings, size: Size, x: number, y: number) {
  const m = getMaskMetrics(settings, size)
  if (!m.width || !m.height) {
    return Infinity
  }
  const qx = Math.abs(x - m.x - m.width / 2) - (m.width / 2 - m.radius)
  const qy = Math.abs(y - m.y - m.height / 2) - (m.height / 2 - m.radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - m.radius
}
export function getMaskAlpha(settings: MaskSettings, size: Size, x: number, y: number, method = getFeatherMethod()) {
  if (x < 0 || y < 0 || x > size.width || y > size.height || settings.area <= 0) {
    return 0
  }
  const shape = getFeatherShape(settings, size)
  if (!(shape.halfWidth > 0 && shape.halfHeight > 0)) {
    return 0
  }
  return method.getAlpha(shape, x, y)
}

/** The central compositing invariant: no underlying coverage means no feather-induced loss. */
export const overlapMaskAlpha = (hard: number, feather: number, underlying: number, allEdges = false) => hard * (1 - (allEdges ? 1 : underlying) * (1 - feather))

export function clipMask(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, settings: MaskSettings, size: Size) {
  const m = getMaskMetrics(settings, size)
  context.beginPath()
  context.roundRect(m.x, m.y, m.width, m.height, m.radius)
  context.clip()
}

const remember = <Value>(cache: Map<string, Value>, key: string, create: () => Value, limit = 16) => {
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const value = create()
  cache.set(key, value)
  while (cache.size > limit) {
    cache.delete(cache.keys().next().value!)
  }
  return value
}
export const getMaskGridSize = (size: Size, maxSide: number): Size => ({
  width: Math.max(1, Math.round(maxSide * size.width / Math.max(size.width, size.height))),
  height: Math.max(1, Math.round(maxSide * size.height / Math.max(size.width, size.height))),
})
const getMaskKey = (settings: MaskSettings, grid: Size, method: FeatherMethod) => [method.id, grid.width, grid.height, settings.area, settings.feather, settings.offsetX ?? 0, settings.offsetY ?? 0, settings.roundness ?? 0].join(':')
const fieldCache = new Map<string, FeatherField>
/** Feather depths on a grid with the longer side maxSide; it works in grid coordinates to stay independent of source bitmap density. */
export function getFeatherField(settings: MaskSettings, size: Size, maxSide = 512, method = getFeatherMethod()): FeatherField {
  const grid = getMaskGridSize(size, maxSide)
  return remember(fieldCache, getMaskKey(settings, grid, method), () => {
    const shape = getFeatherShape(settings, grid)
    const empty = settings.area <= 0 || !(shape.halfWidth > 0 && shape.halfHeight > 0)
    return {
      ...grid,
      method,
      transition: shape.transition,
      depth: empty ? new Float32Array(grid.width * grid.height).fill(Number.NaN) : method.getDepthField(shape, grid.width, grid.height),
    }
  })
}
/** an alpha-only canvas from 8-bit alpha values */
export const createAlphaCanvas = (alpha: Uint8ClampedArray, size: Size) => {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(size.width, size.height)
  for (const [index, value] of alpha.entries()) {
    pixels.data[index * 4 + 3] = value
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}
const maskCache = new Map<string, OffscreenCanvas>
/** the feather ramp of a mask, as it applies where the layer overlaps fully covered artwork */
export function getSoftMask(settings: MaskSettings, size: Size, maxSide = 512, method = getFeatherMethod()) {
  const field = getFeatherField(settings, size, maxSide, method)
  return remember(maskCache, getMaskKey(settings, field, method), () => {
    const alpha = new Uint8ClampedArray(field.depth.length)
    for (const [index, depth] of field.depth.entries()) {
      alpha[index] = Number.isNaN(depth) ? 0 : Math.round(method.profile(depth) * 255)
    }
    return createAlphaCanvas(alpha, field)
  })
}

// Retained scalar helpers for callers that need axis diagnostics, not viewport rendering.
export function getMaskStops(settings: MaskSettings, size: Size, axis: 'x' | 'y'): Array<MaskStop> {
  const length = axis === 'x' ? size.width : size.height
  const stops: Array<MaskStop> = []
  for (let i = 0; i <= 32; i++) {
    stops.push({
      offset: i / 32,
      alpha: getMaskAlpha(settings, size, axis === 'x' ? length * i / 32 : size.width / 2, axis === 'y' ? length * i / 32 : size.height / 2),
    })
  }
  return stops
}
export function getMaskCss(settings: MaskSettings, size: Size) {
  if (!isMaskActive(settings)) {
    return
  }
  const gradient = (axis: 'x' | 'y') => `linear-gradient(${axis === 'x' ? 'to right' : 'to bottom'}, ${getMaskStops(settings, size, axis).map(s => `rgb(0 0 0 / ${s.alpha}) ${s.offset * 100}%`).join(', ')})`
  return {
    maskImage: `${gradient('x')}, ${gradient('y')}`,
    maskComposite: 'intersect',
  } as const
}
