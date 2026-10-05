import {closestRatio, parseRatio} from './ratio.ts'
import type {RatioString} from './ratio.ts'
import type {Point, Rect} from './geometry.ts'

export type Corner = 'ne' | 'nw' | 'se' | 'sw'

export const corners: ReadonlyArray<Corner> = ['nw', 'ne', 'se', 'sw']

const cornerSigns: Record<Corner, {x: -1 | 1
  y: -1 | 1}> = {
  nw: {x: -1, y: -1},
  ne: {x: 1, y: -1},
  se: {x: 1, y: 1},
  sw: {x: -1, y: 1},
}

export type SnapTargets = {
  x: ReadonlyArray<number>
  y: ReadonlyArray<number>
}

export const getSnapTargets = (rects: Iterable<Rect>): SnapTargets => {
  const x: Array<number> = []
  const y: Array<number> = []
  for (const rect of rects) {
    x.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width)
    y.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height)
  }
  return {x, y}
}

/** Finds the smallest offset that aligns one of the values with one of the targets, within the threshold. */
export const findSnapOffset = (values: ReadonlyArray<number>, targets: ReadonlyArray<number>, threshold: number) => {
  let best: number | undefined
  for (const value of values) {
    for (const target of targets) {
      const offset = target - value
      if (Math.abs(offset) <= threshold && (best === undefined || Math.abs(offset) < Math.abs(best))) {
        best = offset
      }
    }
  }
  return best
}

export type SnapGuides = {
  x?: number
  y?: number
}

/** Moves a rect by the delta and snaps its edges and center to the targets. */
export const moveRectWithSnapping = (start: Rect, delta: Point, targets: SnapTargets | undefined, threshold: number): {guides: SnapGuides
  rect: Rect} => {
  const rect = {...start, x: start.x + delta.x, y: start.y + delta.y}
  const guides: SnapGuides = {}
  if (!targets) {
    return {rect, guides}
  }
  const offsetX = findSnapOffset([rect.x, rect.x + rect.width / 2, rect.x + rect.width], targets.x, threshold)
  if (offsetX !== undefined) {
    rect.x += offsetX
    guides.x = [rect.x, rect.x + rect.width / 2, rect.x + rect.width].find(value => targets.x.some(target => Math.abs(target - value) < 1e-6))
  }
  const offsetY = findSnapOffset([rect.y, rect.y + rect.height / 2, rect.y + rect.height], targets.y, threshold)
  if (offsetY !== undefined) {
    rect.y += offsetY
    guides.y = [rect.y, rect.y + rect.height / 2, rect.y + rect.height].find(value => targets.y.some(target => Math.abs(target - value) < 1e-6))
  }
  return {rect, guides}
}

export type ResizeOptions = {
  /** width / height */
  aspect: number
  corner: Corner
  /** resize symmetrically around the center */
  fromCenter?: boolean
  minWidth: number
  pointer: Point
  snapThreshold?: number
  snapTargets?: SnapTargets
  start: Rect
}

/** Resizes a rect by dragging one corner while keeping the aspect ratio locked. */
export const resizeRectFromCorner = (options: ResizeOptions): {guides: SnapGuides
  rect: Rect} => {
  const {aspect, corner, start, pointer} = options
  const sign = cornerSigns[corner]
  const anchor: Point = options.fromCenter
    ? {x: start.x + start.width / 2, y: start.y + start.height / 2}
    : {x: sign.x > 0 ? start.x : start.x + start.width, y: sign.y > 0 ? start.y : start.y + start.height}
  const factor = options.fromCenter ? 2 : 1
  const reachX = Math.max(0, (pointer.x - anchor.x) * sign.x) * factor
  const reachY = Math.max(0, (pointer.y - anchor.y) * sign.y) * factor
  let width = Math.max(options.minWidth, reachX, reachY * aspect)
  const guides: SnapGuides = {}
  if (options.snapTargets && options.snapThreshold) {
    const movingX = anchor.x + sign.x * width / factor
    const movingY = anchor.y + sign.y * width / aspect / factor
    const offsetX = findSnapOffset([movingX], options.snapTargets.x, options.snapThreshold)
    const offsetY = findSnapOffset([movingY], options.snapTargets.y, options.snapThreshold)
    const widthFromX = offsetX === undefined ? undefined : width + offsetX * sign.x * factor
    const widthFromY = offsetY === undefined ? undefined : width + offsetY * sign.y * factor * aspect
    const useX = widthFromX !== undefined && (widthFromY === undefined || Math.abs(offsetX!) <= Math.abs(offsetY!))
    if (useX && widthFromX >= options.minWidth) {
      width = widthFromX
      guides.x = anchor.x + sign.x * width / factor
    } else if (widthFromY !== undefined && widthFromY >= options.minWidth) {
      width = widthFromY
      guides.y = anchor.y + sign.y * width / aspect / factor
    }
  }
  const height = width / aspect
  if (options.fromCenter) {
    return {rect: {x: anchor.x - width / 2, y: anchor.y - height / 2, width, height}, guides}
  }
  return {
    rect: {
      x: sign.x > 0 ? anchor.x : anchor.x - width,
      y: sign.y > 0 ? anchor.y : anchor.y - height,
      width,
      height,
    },
    guides,
  }
}

export type FrameEdge = 'n' | 'e' | 's' | 'w'
/** Dragging a frame edge changes only one axis and snaps to a supported ratio. */
export function resizeFrameFromEdge(start: Rect, edge: FrameEdge, pointer: Point, ratios: readonly RatioString[]) {
  const horizontal = edge === 'e' || edge === 'w'
  const width = horizontal ? Math.max(16, edge === 'e' ? pointer.x - start.x : start.x + start.width - pointer.x) : start.width
  const height = horizontal ? start.height : Math.max(16, edge === 's' ? pointer.y - start.y : start.y + start.height - pointer.y)
  const ratio = closestRatio(width / height, ratios), aspect = parseRatio(ratio)
  const rect = {...start, width: horizontal ? start.height * aspect : start.width, height: horizontal ? start.height : start.width / aspect}
  if (edge === 'w') rect.x = start.x + start.width - rect.width
  if (edge === 'n') rect.y = start.y + start.height - rect.height
  return {rect, ratio}
}
