import type {FeatherMethodId} from '../featherMethodIds.ts'

/** a mask’s rounded rectangle in the coordinate space it is sampled in */
export type FeatherShape = {
  centerX: number
  centerY: number
  halfHeight: number
  halfWidth: number
  /** corner radius, at most the shorter half side */
  radius: number
  /** feather width measured inward from the edge, at most the shorter half side */
  transition: number
}

/** the fully opaque core of a feathered mask, relative to the mask rectangle */
export type FeatherCore = {
  inset: number
  radius: number
}

/** Signed distance to a centered rounded box, given the absolute offsets from its center; negative inside. */
export const roundedBoxDistance = (ax: number, ay: number, halfWidth: number, halfHeight: number, radius: number) => {
  const qx = ax - halfWidth + radius
  const qy = ay - halfHeight + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

export const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** quintic ramp with continuous first and second derivatives at both ends */
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * A feather method turns a mask shape into a soft alpha ramp.
 *
 * Every method describes the ramp through a depth field: 0 on the mask edge, 1 in the opaque core and NaN outside the mask. The profile then maps depth to alpha.
 */
export abstract class FeatherMethod {
  abstract readonly id: FeatherMethodId
  abstract readonly title: string
  /** Whether {@link getOverlapAlpha} takes the coverage below the layer into account. */
  readonly coverageAware: boolean = false
  /** depth of a point: 0 on the mask edge, 1 in the core, NaN outside the mask */
  abstract getDepth(shape: FeatherShape, x: number, y: number): number
  /** the opaque core that the viewport outlines */
  abstract getCore(shape: FeatherShape): FeatherCore
  /** maps depth in [0, 1] to alpha in [0, 1] */
  abstract profile(depth: number): number
  getAlpha(shape: FeatherShape, x: number, y: number) {
    const depth = this.getDepth(shape, x, y)
    return Number.isNaN(depth) ? 0 : this.profile(depth)
  }
  /** depths at the pixel centers of a width × height grid, row by row */
  getDepthField(shape: FeatherShape, width: number, height: number) {
    const field = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        field[y * width + x] = this.getDepth(shape, x + 0.5, y + 0.5)
      }
    }
    return field
  }
  /**
   * Alpha of the layer wherever it overlaps fully covered artwork, as 8-bit values per grid pixel.
   *
   * @param depth result of {@link getDepthField}
   * @param uncovered 1 for grid pixels inside the mask that have no artwork below them
   * @param transition feather width in grid pixels
   */
  getOverlapAlpha(depth: Float32Array, _uncovered: Uint8Array, _width: number, _height: number, _transition: number) {
    const alpha = new Uint8ClampedArray(depth.length)
    for (const [index, value] of depth.entries()) {
      alpha[index] = Number.isNaN(value) ? 0 : Math.round(this.profile(value) * 255)
    }
    return alpha
  }
}
