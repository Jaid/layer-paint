import type {FeatherShape} from './base/FeatherMethod.ts'

import {FeatherMethod, roundedBoxDistance, smoothstep} from './base/FeatherMethod.ts'

/**
 * The original method: smoothstep over the exact signed distance to the mask edge.
 *
 * Its depth contours are inward offsets of the mask, so they keep sharp corners. That leaves a visible diagonal crease at every corner whose radius is smaller than the feather, and a ridge along the center line when the feather spans the whole mask.
 */
export class DistanceFeather extends FeatherMethod {
  id = 'distance' as const
  title = 'Signed distance'
  getDepth(shape: FeatherShape, x: number, y: number) {
    const distance = roundedBoxDistance(Math.abs(x - shape.centerX), Math.abs(y - shape.centerY), shape.halfWidth, shape.halfHeight, shape.radius)
    if (distance > 0) {
      return Number.NaN
    }
    if (shape.transition <= 0) {
      return 1
    }
    return Math.min(1, Math.max(0, -distance / shape.transition))
  }
  getCore(shape: FeatherShape) {
    return {
      inset: shape.transition,
      radius: Math.max(0, shape.radius - shape.transition),
    }
  }
  profile(depth: number) {
    return smoothstep(depth)
  }
}
