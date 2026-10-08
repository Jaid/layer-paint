import type {Point, Rect} from './geometry.ts'
import type {Layer} from './state.ts'

import {rectCenter, rectIntersection, rectUnion} from './geometry.ts'
import {getMaskRect} from './mask.ts'

/** The alignment that currently moves a layer’s content, if content-aware alignment is on and found a reliable registration. */
export const getActiveAlignment = (layer: Pick<Layer, 'alignment' | 'contentAware'>) => (layer.contentAware && layer.alignment?.applied ? layer.alignment : undefined)

/** where the layer image is drawn in layer-local coordinates; the layer rect itself still clips it */
export function getContentRect(layer: Pick<Layer, 'alignment' | 'contentAware' | 'rect'>): Rect {
  const alignment = getActiveAlignment(layer)
  if (!alignment) {
    return {
      x: 0,
      y: 0,
      width: layer.rect.width,
      height: layer.rect.height,
    }
  }
  return {
    x: alignment.x * layer.rect.width,
    y: alignment.y * layer.rect.height,
    width: alignment.scale * layer.rect.width,
    height: alignment.scale * layer.rect.height,
  }
}

export function layerToWorld(layer: Pick<Layer, 'rect' | 'rotation'>, local: Point): Point {
  const angle = (layer.rotation ?? 0) * Math.PI / 180
  const center = rectCenter(layer.rect); const x = local.x - layer.rect.width / 2; const y = local.y - layer.rect.height / 2
  return {
    x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: center.y + x * Math.sin(angle) + y * Math.cos(angle),
  }
}
export function worldToLayer(layer: Pick<Layer, 'rect' | 'rotation'>, world: Point): Point {
  const angle = -(layer.rotation ?? 0) * Math.PI / 180
  const center = rectCenter(layer.rect); const x = world.x - center.x; const y = world.y - center.y
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle) + layer.rect.width / 2,
    y: x * Math.sin(angle) + y * Math.cos(angle) + layer.rect.height / 2,
  }
}
export function getLayerBounds(layer: Layer, effective = false): Rect {
  const local = {
    x: 0,
    y: 0,
    width: layer.rect.width,
    height: layer.rect.height,
  }
  const bounds = effective ? rectIntersection(local, getMaskRect(layer, layer.rect)) : local
  if (!bounds) {
    return {
      ...layer.rect,
      width: 0,
      height: 0,
    }
  }
  const points = [
    {
      x: bounds.x,
      y: bounds.y,
    },
    {
      x: bounds.x + bounds.width,
      y: bounds.y,
    },
    {
      x: bounds.x,
      y: bounds.y + bounds.height,
    },
    {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    },
  ].map(point => layerToWorld(layer, point))
  return rectUnion(points.map(point => ({
    ...point,
    width: 0,
    height: 0,
  })))!
}
