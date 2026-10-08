import type {FeatherMethod, FeatherShape} from '../src/lib/feather/index.ts'

import {describe, expect, test} from 'bun:test'

import {DistanceFeather} from '../src/lib/feather/DistanceFeather.ts'
import {distanceTransform} from '../src/lib/feather/distanceTransform.ts'
import {featherMethods, getFeatherMethod, parseFeatherMethodId} from '../src/lib/feather/index.ts'
import {SmoothFeather} from '../src/lib/feather/SmoothFeather.ts'
import {getFeatherCore, getMaskAlpha} from '../src/lib/mask.ts'
import queryParameters from '../src/queryParameters.ts'

const smooth = new SmoothFeather
const distance = new DistanceFeather
const shape = (roundness: number, feather: number, width = 400, height = 240): FeatherShape => ({
  centerX: width / 2,
  centerY: height / 2,
  halfWidth: width / 2,
  halfHeight: height / 2,
  radius: roundness * Math.min(width, height) / 2,
  transition: feather * Math.min(width, height) / 2,
})
/** largest alpha curvature across the diagonal of the top-left corner, where offset contours crease */
const diagonalCurvature = (method: FeatherMethod, target: FeatherShape) => {
  let worst = 0
  for (let s = 3; s < target.transition * 0.9; s++) {
    const step = 0.5
    const at = (u: number) => method.getAlpha(target, s + u / Math.SQRT2, s - u / Math.SQRT2)
    worst = Math.max(worst, Math.abs(at(step) - 2 * at(0) + at(-step)) / step ** 2)
  }
  return worst
}

describe('feather method selection', () => {
  test('smooth is the default and the URL parameter is typed', () => {
    expect(queryParameters.feather_method).toBe('smooth')
    expect(getFeatherMethod().id).toBe('smooth')
    expect(getFeatherMethod('distance')).toBe(featherMethods.distance)
  })
  test('ids are parsed case-insensitively with a default fallback', () => {
    expect(parseFeatherMethodId('Distance')).toBe('distance')
    expect(parseFeatherMethodId(' smooth ')).toBe('smooth')
    expect(parseFeatherMethodId('gaussian')).toBe('smooth')
    expect(parseFeatherMethodId(undefined)).toBe('smooth')
  })
})

describe('distance feather', () => {
  test('keeps the original smoothstep over the signed distance', () => {
    const target = shape(0.2, 0.5)
    const smoothstep = (t: number) => t * t * (3 - 2 * t)
    for (const [x, y] of [[10, 120], [30, 30], [5, 7], [200, 60], [390, 230]]) {
      const qx = Math.abs(x - 200) - (200 - target.radius); const qy = Math.abs(y - 120) - (120 - target.radius)
      const signed = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - target.radius
      expect(distance.getAlpha(target, x, y)).toBeCloseTo(signed > 0 ? 0 : smoothstep(Math.min(1, -signed / target.transition)), 9)
    }
  })
})

describe('smooth feather', () => {
  test('straight edges keep exactly the requested feather width', () => {
    const target = shape(0, 0.5)
    for (const inset of [0, 6, 30, 59, 60, 90]) {
      expect(smooth.getDepth(target, 200, inset)).toBeCloseTo(Math.min(1, inset / target.transition), 4)
      expect(smooth.getDepth(target, inset, 120)).toBeCloseTo(Math.min(1, inset / target.transition), 4)
    }
  })
  test('the outermost contour is the mask itself, so nothing leaks outside', () => {
    for (const roundness of [0, 0.4, 1]) {
      const target = shape(roundness, 0.7)
      expect(smooth.getContour(target, 0)).toEqual({
        halfWidth: 200,
        halfHeight: 120,
        radius: target.radius,
      })
      expect(Number.isNaN(smooth.getDepth(target, -1, 120))).toBe(true)
      expect(smooth.getAlpha(target, 0.2, 0.2)).toBeLessThan(1e-4)
      expect(smooth.getAlpha(target, 200, 0)).toBe(0)
    }
  })
  test('depth roots lie on their contour and grow monotonically inward', () => {
    for (const [roundness, feather] of [[0, 0.5], [0, 1], [0.3, 0.6], [1, 1]]) {
      const target = shape(roundness, feather)
      const field = smooth.getDepthField(target, 400, 240)
      for (let y = 0; y < 120; y += 3) {
        for (let x = 0; x < 200; x += 3) {
          const depth = field[y * 400 + x]
          const right = field[y * 400 + x + 1]
          if (!Number.isNaN(depth)) {
            expect(right).toBeGreaterThanOrEqual(depth - 1e-5)
          }
          if (depth > 0 && depth < 1) {
            const contour = smooth.getContour(target, depth)
            const qx = Math.abs(x + 0.5 - 200) - contour.halfWidth + contour.radius; const qy = Math.abs(y + 0.5 - 120) - contour.halfHeight + contour.radius
            expect(Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - contour.radius)).toBeLessThan(2e-3)
          }
        }
      }
    }
  })
  test('sharp corners have no crease along the diagonal', () => {
    for (const feather of [0.5, 0.8, 1]) {
      const target = shape(0, feather)
      expect(diagonalCurvature(smooth, target)).toBeLessThan(diagonalCurvature(distance, target) / 20)
    }
  })
  test('the opaque core is a rounded rectangle that becomes a capsule at full feather', () => {
    expect(smooth.getCore(shape(0, 1))).toEqual({
      inset: 120,
      radius: 0,
    })
    const core = smooth.getCore(shape(0, 0.5))
    expect(core.inset).toBe(60)
    expect(core.radius).toBeGreaterThan(0)
    expect(core.radius).toBeLessThanOrEqual(60)
  })
  test('without uncovered pixels, the overlap alpha is the plain profile', () => {
    const target = shape(0, 0.5, 40, 30)
    const depth = smooth.getDepthField(target, 40, 30)
    const alpha = smooth.getOverlapAlpha(depth, new Uint8Array(depth.length), 40, 30, target.transition)
    for (const [index, value] of depth.entries()) {
      expect(alpha[index]).toBe(Number.isNaN(value) ? 0 : Math.round(smooth.profile(value) * 255))
    }
  })
  test('the layer turns opaque toward a coverage seam but still blends at its own edge', () => {
    const width = 200; const height = 200
    const target = shape(0, 0.6, width, height)
    const depth = smooth.getDepthField(target, width, height)
    // the right half of the layer has no artwork below it
    const uncovered = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 100; x < width; x++) {
        uncovered[y * width + x] = 1
      }
    }
    const alpha = smooth.getOverlapAlpha(depth, uncovered, width, height, target.transition)
    const at = (x: number, y: number) => alpha[y * width + x]
    // the top edge over the artwork blends
    expect(at(40, 0)).toBe(0)
    // right next to the seam, deep in the band, the layer is nearly opaque instead of revealing the artwork’s edge
    expect(at(99, 30)).toBeGreaterThan(240)
    // far from the seam, the plain ramp applies
    expect(at(10, 30)).toBe(Math.round(smooth.profile(depth[30 * width + 10]) * 255))
    // no hard step along the seam inside the band
    for (let y = 5; y < 60; y++) {
      expect(Math.abs(at(99, y) - 255)).toBeLessThan(40)
    }
  })
})

describe('mask integration', () => {
  test('getMaskAlpha honors the method', () => {
    const settings = {
      area: 1,
      feather: 0.8,
    }
    const size = {
      width: 200,
      height: 200,
    }
    // Inside a sharp corner, the smooth contours are more transparent than the offset contours.
    expect(getMaskAlpha(settings, size, 30, 30, featherMethods.smooth)).toBeLessThan(getMaskAlpha(settings, size, 30, 30, featherMethods.distance))
    // Along a straight edge, both start and end at the same place.
    expect(getMaskAlpha(settings, size, 100, 80, featherMethods.smooth)).toBe(1)
    expect(getMaskAlpha(settings, size, 100, 0, featherMethods.smooth)).toBe(0)
  })
  test('the feather core follows the method', () => {
    const settings = {
      area: 1,
      feather: 0.3,
      roundness: 0.5,
    }
    const size = {
      width: 100,
      height: 100,
    }
    expect(getFeatherCore(settings, size, featherMethods.distance)).toEqual({
      inset: 15,
      radius: 10,
    })
    expect(getFeatherCore(settings, size, featherMethods.smooth).radius).toBeGreaterThan(10)
  })
})

describe('distance transform', () => {
  test('matches brute force', () => {
    const width = 37; const height = 23
    let seed = 7
    const random = () => (seed = Math.imul(seed, 1_664_525) + 1_013_904_223 >>> 0) / 4_294_967_296
    const seeds = new Uint8Array(width * height).map(() => (random() < 0.03 ? 1 : 0))
    const result = distanceTransform(seeds, width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let best = Infinity
        for (const [index, value] of seeds.entries()) {
          if (value) {
            best = Math.min(best, Math.hypot(index % width - x, Math.floor(index / width) - y))
          }
        }
        expect(result[y * width + x]).toBeCloseTo(best, 4)
      }
    }
  })
  test('is infinite without seeds', () => {
    expect([...distanceTransform(new Uint8Array(12), 4, 3)].every(value => value === Infinity)).toBe(true)
  })
})
