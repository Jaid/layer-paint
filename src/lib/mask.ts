import type {Rect, Size} from './geometry.ts'
import {clamp} from './geometry.ts'

export type MaskSettings = {
  /** Fraction of rectangular area retained before corner rounding. */
  area: number
  /** Inward feather width as a fraction of half the shorter mask side. */
  feather: number
  offsetX?: number
  offsetY?: number
  roundness?: number
  /** Normally only overlap with underlying artwork is feathered. */
  featherAllEdges?: boolean
}
export type MaskStop = {alpha: number; offset: number}
const smoothstep = (t: number) => t * t * (3 - 2 * t)
export const isMaskActive = (settings: MaskSettings) => settings.area < 1 || settings.feather > 0 || Boolean(settings.offsetX || settings.offsetY || settings.roundness)

export const getMaskMetrics = (settings: MaskSettings, size: Size) => {
  const scale = Math.sqrt(clamp(settings.area, 0, 1))
  const width = size.width * scale, height = size.height * scale
  const x = (size.width - width) / 2 + (settings.offsetX ?? 0) * size.width
  const y = (size.height - height) / 2 + (settings.offsetY ?? 0) * size.height
  const radius = clamp(settings.roundness ?? 0, 0, 1) * Math.min(width, height) / 2
  const transition = clamp(settings.feather, 0, 1) * Math.min(width, height) / 2
  return {x, y, width, height, radius, transition, inset: (size.width - width) / 2}
}
export const getMaskRect = (settings: MaskSettings, size: Size): Rect => {
  const {x, y, width, height} = getMaskMetrics(settings, size)
  return {x, y, width, height}
}

/** Signed distance to a rounded rectangle, negative inside. */
export function maskDistance(settings: MaskSettings, size: Size, x: number, y: number) {
  const m = getMaskMetrics(settings, size)
  if (!m.width || !m.height) return Infinity
  const qx = Math.abs(x - m.x - m.width / 2) - (m.width / 2 - m.radius)
  const qy = Math.abs(y - m.y - m.height / 2) - (m.height / 2 - m.radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - m.radius
}
export function getMaskAlpha(settings: MaskSettings, size: Size, x: number, y: number) {
  if (x < 0 || y < 0 || x > size.width || y > size.height || settings.area <= 0) return 0
  const distance = maskDistance(settings, size, x, y)
  if (distance > 0) return 0
  const {transition} = getMaskMetrics(settings, size)
  return transition <= 0 ? 1 : smoothstep(clamp(-distance / transition, 0, 1))
}

/** The central compositing invariant: no underlying coverage means no feather-induced loss. */
export const overlapMaskAlpha = (hard: number, feather: number, underlying: number, allEdges = false) => hard * (1 - (allEdges ? 1 : underlying) * (1 - feather))

export function clipMask(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, settings: MaskSettings, size: Size) {
  const m = getMaskMetrics(settings, size)
  context.beginPath()
  context.roundRect(m.x, m.y, m.width, m.height, m.radius)
  context.clip()
}

const maskCache = new Map<string, OffscreenCanvas>()
export function getSoftMask(settings: MaskSettings, size: Size, maxSide = 512) {
  const width = Math.max(1, Math.round(maxSide * size.width / Math.max(size.width, size.height)))
  const height = Math.max(1, Math.round(maxSide * size.height / Math.max(size.width, size.height)))
  const key = [width, height, settings.area, settings.feather, settings.offsetX ?? 0, settings.offsetY ?? 0, settings.roundness ?? 0].join(':')
  const cached = maskCache.get(key)
  if (cached) return cached
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(width, height)
  // Work in normalized coordinates to make the result independent of source bitmap density.
  const sampleSize = {width, height}
  const metrics = getMaskMetrics(settings, sampleSize)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const qx = Math.abs(x + 0.5 - metrics.x - metrics.width / 2) - (metrics.width / 2 - metrics.radius)
    const qy = Math.abs(y + 0.5 - metrics.y - metrics.height / 2) - (metrics.height / 2 - metrics.radius)
    const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - metrics.radius
    const alpha = settings.area <= 0 || distance > 0 ? 0 : metrics.transition <= 0 ? 1 : smoothstep(clamp(-distance / metrics.transition, 0, 1))
    pixels.data[(y * width + x) * 4 + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(pixels, 0, 0)
  maskCache.set(key, canvas)
  while (maskCache.size > 16) maskCache.delete(maskCache.keys().next().value!)
  return canvas
}

// Retained scalar helpers for callers that need axis diagnostics, not viewport rendering.
export function getMaskStops(settings: MaskSettings, size: Size, axis: 'x' | 'y'): MaskStop[] {
  const length = axis === 'x' ? size.width : size.height
  const stops: MaskStop[] = []
  for (let i = 0; i <= 32; i++) stops.push({offset: i / 32, alpha: getMaskAlpha(settings, size, axis === 'x' ? length * i / 32 : size.width / 2, axis === 'y' ? length * i / 32 : size.height / 2)})
  return stops
}
export function getMaskCss(settings: MaskSettings, size: Size) {
  if (!isMaskActive(settings)) return undefined
  const gradient = (axis: 'x' | 'y') => `linear-gradient(${axis === 'x' ? 'to right' : 'to bottom'}, ${getMaskStops(settings, size, axis).map(s => `rgb(0 0 0 / ${s.alpha}) ${s.offset * 100}%`).join(', ')})`
  return {maskImage: `${gradient('x')}, ${gradient('y')}`, maskComposite: 'intersect'} as const
}
