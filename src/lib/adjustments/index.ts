import type {Adjustments} from './color.ts'
import type {AdjustableSource, AdjustedImage, AdjustmentRenderer} from './base/AdjustmentRenderer.ts'

import {getAdjustmentParameters, getAdjustmentsKey, isNeutral} from './color.ts'
import {CpuAdjustmentRenderer} from './CpuAdjustmentRenderer.ts'
import {WebGlAdjustmentRenderer} from './WebGlAdjustmentRenderer.ts'

type Entry = {
  image: AdjustedImage
  pixels: number
}

/** Adjusted copies are rendered once per look and reused by the viewport, exports and generation inputs. */
const maxEntries = 24
const maxPixels = 160_000_000
const cache = new Map<string, Entry>
let cachedPixels = 0
let renderers: Array<AdjustmentRenderer> | undefined
const getRenderers = () => {
  renderers ??= [new WebGlAdjustmentRenderer, new CpuAdjustmentRenderer]
  return renderers
}
const release = (key: string) => {
  const entry = cache.get(key)
  if (!entry) {
    return
  }
  cache.delete(key)
  cachedPixels -= entry.pixels
  if ('close' in entry.image) {
    entry.image.close()
  }
}

/**
 * Returns the source with the layer’s adjustments applied, at the source resolution.
 * Neutral adjustments return the source itself, so unadjusted layers render exactly as before.
 */
export const getAdjustedImage = (source: AdjustableSource, sourceKey: string, adjustments?: Adjustments): AdjustableSource => {
  if (isNeutral(adjustments)) {
    return source
  }
  const key = `${sourceKey}|${getAdjustmentsKey(adjustments!)}`
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.image
  }
  const parameters = getAdjustmentParameters(adjustments)
  let image: AdjustedImage | undefined
  for (const renderer of getRenderers()) {
    image = renderer.render(source, parameters, sourceKey)
    if (image) {
      break
    }
  }
  if (!image) {
    return source
  }
  const pixels = image.width * image.height
  cache.set(key, {
    image,
    pixels,
  })
  cachedPixels += pixels
  while (cache.size > 1 && (cache.size > maxEntries || cachedPixels > maxPixels)) {
    release(cache.keys().next().value!)
  }
  return image
}

/** drops cached copies of a source, for example when its asset is freed */
export const forgetAdjustedImages = (sourceKey: string) => {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${sourceKey}|`)) {
      release(key)
    }
  }
  for (const renderer of getRenderers()) {
    renderer.forget(sourceKey)
  }
}

export type {AdjustmentKey, Adjustments} from './color.ts'
export {adjustColor, adjustmentKeys, getAdjustmentParameters, isNeutral, normalizeAdjustments, toGamma} from './color.ts'
