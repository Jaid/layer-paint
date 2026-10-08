import type {FeatherShape} from './base/FeatherMethod.ts'

import {FeatherMethod, smootherstep} from './base/FeatherMethod.ts'
import {distanceTransform} from './distanceTransform.ts'

/** How far a coverage seam pulls the layer opaque, relative to the local feather depth; 1 makes a 45° wedge. */
const seamSlope = 1
/** root precision in pixels, far below what 8-bit alpha can resolve */
const tolerance = 1e-3

/**
 * Crease-free feathering that blends like a blurred mask.
 *
 * Instead of offsetting the mask edge, depth t follows a family of nested rounded rectangles: the edges move inward by t × feather while the corner radius grows from the mask’s own radius toward a capsule. Every contour is smooth, so there is no diagonal crease at the corners and no ridge along the center line, and straight edges keep exactly the requested feather width. A quintic profile keeps the alpha ramp continuous up to its curvature, which avoids Mach bands where the ramp starts and ends.
 *
 * Where a layer overlaps artwork that ends inside the feather band, the overlap normally switches from blended to opaque along the edge of that artwork. This method pulls the layer opaque in a smooth wedge toward such seams instead, so the edge of the underlying artwork never shows through as a hard line.
 */
export class SmoothFeather extends FeatherMethod {
  id = 'smooth' as const
  title = 'Smooth contours'
  override readonly coverageAware = true
  /** half sizes and corner radius of the contour at depth t */
  getContour(shape: FeatherShape, depth: number) {
    const shortSide = Math.min(shape.halfWidth, shape.halfHeight)
    const inset = depth * shape.transition
    const halfShort = Math.max(0, shortSide - inset)
    // roundness of the mask itself, as a fraction of the shorter half side
    const roundness = shortSide > 0 ? Math.min(1, shape.radius / shortSide) : 1
    // Grows like depth × feather near the edge and reaches a capsule when the contour collapses, while never exceeding the shorter half side.
    const radius = shortSide > 0 ? halfShort * (1 - (1 - roundness) * halfShort / shortSide) : 0
    return {
      halfWidth: Math.max(0, shape.halfWidth - inset),
      halfHeight: Math.max(0, shape.halfHeight - inset),
      radius,
    }
  }
  /** a depth function with the shape constants hoisted, since it runs for every mask pixel */
  createSolver(shape: FeatherShape) {
    const {centerX, centerY, halfWidth, halfHeight, transition} = shape
    const shortSide = Math.min(halfWidth, halfHeight)
    const roundness = shortSide > 0 ? Math.min(1, shape.radius / shortSide) : 1
    const flatness = shortSide > 0 ? (1 - roundness) / shortSide : 0
    /** signed distance from the offsets (ax, ay) to the contour at depth t, negative inside; mirrors getContour */
    const distanceAt = (ax: number, ay: number, depth: number) => {
      const inset = depth * transition
      const halfShort = Math.max(0, shortSide - inset)
      const radius = halfShort * (1 - flatness * halfShort)
      const qx = ax - Math.max(0, halfWidth - inset) + radius
      const qy = ay - Math.max(0, halfHeight - inset) + radius
      const px = qx > 0 ? qx : 0; const py = qy > 0 ? qy : 0
      const inner = qx > qy ? qx : qy
      return Math.sqrt(px * px + py * py) + (inner < 0 ? inner : 0) - radius
    }
    return (x: number, y: number) => {
      const ax = Math.abs(x - centerX); const ay = Math.abs(y - centerY)
      const outer = distanceAt(ax, ay, 0)
      if (outer > 0) {
        return Number.NaN
      }
      if (transition <= 0) {
        return 1
      }
      if (outer === 0) {
        return 0
      }
      // Contours are nested, so the distance to the contour grows monotonically with depth. The straight-edge depth brackets the root and is exact away from corners.
      let high = Math.min(1, Math.min(halfWidth - ax, halfHeight - ay) / transition)
      let highValue = distanceAt(ax, ay, high)
      if (highValue <= tolerance) {
        return high
      }
      let low = 0
      let lowValue = outer
      let side = 0
      // Illinois variant of regula falsi: bracketed like bisection, but converges superlinearly.
      for (let iteration = 0; iteration < 64; iteration++) {
        const depth = (low * highValue - high * lowValue) / (highValue - lowValue)
        const value = distanceAt(ax, ay, depth)
        if (Math.abs(value) <= tolerance || high - low <= 1e-9) {
          return depth
        }
        if (value > 0) {
          high = depth
          highValue = value
          if (side === 1) {
            lowValue /= 2
          }
          side = 1
        } else {
          low = depth
          lowValue = value
          if (side === -1) {
            highValue /= 2
          }
          side = -1
        }
      }
      return (low + high) / 2
    }
  }
  getDepth(shape: FeatherShape, x: number, y: number) {
    return this.createSolver(shape)(x, y)
  }
  override getDepthField(shape: FeatherShape, width: number, height: number) {
    const solve = this.createSolver(shape)
    const field = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        field[y * width + x] = solve(x + 0.5, y + 0.5)
      }
    }
    return field
  }
  getCore(shape: FeatherShape) {
    return {
      inset: shape.transition,
      radius: this.getContour(shape, 1).radius,
    }
  }
  profile(depth: number) {
    return smootherstep(Math.min(1, Math.max(0, depth)))
  }
  override getOverlapAlpha(depth: Float32Array, uncovered: Uint8Array, width: number, height: number, transition: number) {
    const seamDistance = distanceTransform(uncovered, width, height)
    const alpha = new Uint8ClampedArray(depth.length)
    for (let index = 0; index < depth.length; index++) {
      const value = depth[index]
      if (Number.isNaN(value)) {
        continue
      }
      // share of the underlying artwork that stays visible
      const reveal = 1 - this.profile(value)
      let wedge = 1
      if (reveal > 0 && value > 0 && transition > 0) {
        // Near a seam, the layer turns opaque within a wedge whose width grows with the depth. On the layer edge itself the wedge vanishes, so the layer still blends into the artwork it touches.
        const ratio = seamDistance[index] / (seamSlope * transition * value)
        wedge = ratio < 1 ? smootherstep(ratio) : 1
      }
      alpha[index] = Math.round((1 - reveal * wedge) * 255)
    }
    return alpha
  }
}
