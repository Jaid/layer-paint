import type {Rect} from './geometry.ts'
import type {RatioString} from './ratio.ts'
import type {EditorState, Layer} from './state.ts'

import {frameHasContent, getContentBounds, measureUncovered} from './composite.ts'
import {coverRect} from './geometry.ts'
import {getModel} from './models/index.ts'
import {closestRatio, parseRatio} from './ratio.ts'

/**
 * What a generation will do with the canvas, which is also the label of the generate button.
 *
 * - generate: the frame does not touch any canvas content
 * - extend: the frame contains canvas content but also empty canvas
 * - patch: the frame is filled with canvas content and there is more content outside of it
 * - transform: the frame is filled with canvas content and nothing lies outside of it
 */
export type GenerationMode = 'extend' | 'generate' | 'patch' | 'transform'

export const generationModeTitles: Record<GenerationMode, string> = {
  generate: 'Generate',
  extend: 'Extend',
  patch: 'Patch',
  transform: 'Transform',
}

/** Below this empty fraction, a frame counts as filled; the prompt compiler only mentions empty areas above it as well. */
export const emptyAreaThreshold = 0.004

export type GenerationRegion = {
  frame: Rect
  ratio: RatioString
}

/** Smallest rect of the closest supported ratio that covers all visible artwork. */
export const getContentRegion = (layers: ReadonlyArray<Layer>, ratios: ReadonlyArray<RatioString>): GenerationRegion | undefined => {
  const bounds = getContentBounds(layers)
  if (!bounds || !(bounds.width > 0 && bounds.height > 0) || !ratios.length) {
    return
  }
  const ratio = closestRatio(bounds.width / bounds.height, ratios)
  return {
    ratio,
    frame: coverRect(bounds, parseRatio(ratio)),
  }
}

/** The frame and ratio a generation uses right now: the visible frame, or all artwork while the frame is switched off. */
export const getGenerationRegion = (editor: Pick<EditorState, 'frame' | 'frameEnabled' | 'modelId' | 'ratio'>, layers: ReadonlyArray<Layer>): GenerationRegion => {
  if (!editor.frameEnabled) {
    const region = getContentRegion(layers, getModel(editor.modelId).aspectRatios)
    if (region) {
      return region
    }
  }
  return {
    frame: editor.frame,
    ratio: editor.ratio,
  }
}

/** whether visible artwork reaches beyond the frame, ignoring sub-pixel rounding at its edges */
export const hasContentOutside = (layers: ReadonlyArray<Layer>, frame: Rect) => {
  const bounds = getContentBounds(layers)
  if (!bounds || !(bounds.width > 0 && bounds.height > 0)) {
    return false
  }
  const tolerance = Math.max(frame.width, frame.height) * 0.002
  return bounds.x < frame.x - tolerance || bounds.y < frame.y - tolerance || bounds.x + bounds.width > frame.x + frame.width + tolerance || bounds.y + bounds.height > frame.y + frame.height + tolerance
}

export const getGenerationMode = (layers: ReadonlyArray<Layer>, frame: Rect): GenerationMode => {
  if (!frameHasContent(layers, frame)) {
    return 'generate'
  }
  const uncovered = measureUncovered(layers, frame)
  if (uncovered >= 1) {
    return 'generate'
  }
  if (uncovered > emptyAreaThreshold) {
    return 'extend'
  }
  return hasContentOutside(layers, frame) ? 'patch' : 'transform'
}
