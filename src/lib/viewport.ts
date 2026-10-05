import type {Point, Rect, Size} from './geometry.ts'
import type {View} from './state.ts'
import {clamp} from './geometry.ts'
import {editorStore} from './state.ts'

export const minScale = 0.02
export const maxScale = 32

/** the current size of the canvas viewport element, maintained by the Viewport component */
export const viewportSize: Size = {width: 800, height: 600}

const viewportReadyResolvers = Promise.withResolvers<void>()

/** resolves once the viewport has been measured for the first time */
export const viewportReady = viewportReadyResolvers.promise

let measured = false

/** Updates the measured viewport size and keeps the world point in the center stable. */
export const setViewportSize = (size: Size) => {
  if (measured) {
    const deltaX = (size.width - viewportSize.width) / 2
    const deltaY = (size.height - viewportSize.height) / 2
    if (deltaX || deltaY) {
      editorStore.set(state => ({...state, view: {...state.view, x: state.view.x + deltaX, y: state.view.y + deltaY}}))
    }
  }
  viewportSize.width = size.width
  viewportSize.height = size.height
  if (!measured) {
    measured = true
    viewportReadyResolvers.resolve()
  }
}

export const screenToWorld = (view: View, point: Point): Point => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
})

export const worldToScreen = (view: View, point: Point): Point => ({
  x: point.x * view.scale + view.x,
  y: point.y * view.scale + view.y,
})

export type Insets = {
  bottom: number
  left: number
  right: number
  top: number
}

/** Space covered by floating UI (frame label on top, toolbar at the bottom, layers panel on the right). */
export const getOverlayInsets = (_size: Size = viewportSize): Insets => ({top: 44, bottom: 24, left: 22, right: 22})

export const getViewForRect = (rect: Rect, size: Size = viewportSize, insets: Insets = getOverlayInsets(size), padding = 0.06): View => {
  const paddingPixels = Math.min(size.width, size.height) * padding
  const availableWidth = Math.max(32, size.width - insets.left - insets.right - paddingPixels * 2)
  const availableHeight = Math.max(32, size.height - insets.top - insets.bottom - paddingPixels * 2)
  const scale = clamp(Math.min(availableWidth / rect.width, availableHeight / rect.height), minScale, maxScale)
  const centerX = insets.left + (size.width - insets.left - insets.right) / 2
  const centerY = insets.top + (size.height - insets.top - insets.bottom) / 2
  return {
    scale,
    x: centerX - (rect.x + rect.width / 2) * scale,
    y: centerY - (rect.y + rect.height / 2) * scale,
  }
}

export const fitViewToRect = (rect: Rect) => {
  editorStore.set({view: getViewForRect(rect)})
}

/** Zooms around a screen-space anchor so the world point under it stays fixed. */
export const zoomView = (view: View, factor: number, anchor: Point): View => {
  const scale = clamp(view.scale * factor, minScale, maxScale)
  const appliedFactor = scale / view.scale
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * appliedFactor,
    y: anchor.y - (anchor.y - view.y) * appliedFactor,
  }
}

export const zoomBy = (factor: number) => {
  editorStore.set(state => ({...state, view: zoomView(state.view, factor, {x: viewportSize.width / 2, y: viewportSize.height / 2})}))
}

export const getViewportCenterWorld = () => screenToWorld(editorStore.state.view, {x: viewportSize.width / 2, y: viewportSize.height / 2})
