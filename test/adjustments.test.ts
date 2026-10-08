import type {Layer} from '#src/lib/state.ts'

import {describe, expect, test} from 'bun:test'

import {adjustColor, getAdjustmentParameters, isNeutral, normalizeAdjustments, toGamma} from '#src/lib/adjustments/color.ts'
import {getActiveAlignment, getContentRect} from '#src/lib/layerGeometry.ts'
import {parseProjectDocument} from '#src/lib/projectSchema.ts'

const apply = (color: [number, number, number], adjustments: Parameters<typeof getAdjustmentParameters>[0]) => adjustColor([...color], getAdjustmentParameters(adjustments))
const luma = ([r, g, b]: Array<number>) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const chroma = (color: Array<number>) => Math.max(...color) - Math.min(...color)

describe('color adjustments', () => {
  test('neutral adjustments are an identity', () => {
    const color: [number, number, number] = [0.2, 0.55, 0.9]
    const result = apply(color, {})
    for (const [index, value] of result.entries()) {
      expect(value).toBeCloseTo(color[index], 6)
    }
    expect(isNeutral({})).toBe(true)
    expect(isNeutral({contrast: 0})).toBe(true)
    expect(isNeutral({contrast: 0.1})).toBe(false)
  })
  test('normalization drops neutral values and clamps the rest', () => {
    expect(normalizeAdjustments({brightness: 0, gamma: 0})).toBeUndefined()
    expect(normalizeAdjustments({saturation: 3, vibrance: -0.2, contrast: Number.NaN})).toEqual({saturation: 1, vibrance: -0.2})
  })
  test('brightness, contrast and gamma move tones in the expected direction', () => {
    const gray: [number, number, number] = [0.4, 0.4, 0.4]
    expect(apply(gray, {brightness: 0.3})[0]).toBeGreaterThan(0.4)
    expect(apply(gray, {brightness: -0.3})[0]).toBeLessThan(0.4)
    expect(apply([0.3, 0.3, 0.3], {contrast: 0.5})[0]).toBeLessThan(0.3)
    expect(apply([0.7, 0.7, 0.7], {contrast: 0.5})[0]).toBeGreaterThan(0.7)
    expect(apply([0.5, 0.5, 0.5], {contrast: 0.5})[0]).toBeCloseTo(0.5, 6)
    expect(apply(gray, {gamma: 0.5})[0]).toBeGreaterThan(0.4)
    expect(toGamma(0)).toBe(1)
    expect(apply([0, 0, 0], {gamma: 0.8})[0]).toBe(0)
    expect(apply([1, 1, 1], {gamma: -0.8})[0]).toBe(1)
  })
  test('saturation −100 produces gray, white balance shifts toward warm or cool', () => {
    const [r, g, b] = apply([0.8, 0.3, 0.2], {saturation: -1})
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
    const warm = apply([0.5, 0.5, 0.5], {temperature: 0.6})
    expect(warm[0]).toBeGreaterThan(warm[2])
    const cool = apply([0.5, 0.5, 0.5], {temperature: -0.6})
    expect(cool[2]).toBeGreaterThan(cool[0])
    // White balance keeps the luma of neutral colors.
    expect(luma(warm)).toBeCloseTo(0.5, 2)
  })
  test('vibrance boosts muted colors more than saturated ones', () => {
    const muted: [number, number, number] = [0.5, 0.45, 0.42]
    const vivid: [number, number, number] = [0.9, 0.2, 0.1]
    const mutedGain = chroma(apply(muted, {vibrance: 0.8})) / chroma(muted)
    const vividGain = chroma(apply(vivid, {vibrance: 0.8})) / chroma(vivid)
    expect(mutedGain).toBeGreaterThan(vividGain)
    expect(vividGain).toBeGreaterThanOrEqual(1)
  })
})

const generated = (extra: Partial<Layer> = {}): Layer => ({
  id: 'g',
  assetId: 'output',
  name: 'generated',
  kind: 'generated',
  createdAt: 0,
  visible: true,
  area: 1,
  feather: 0,
  rect: {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
  },
  ...extra,
})

describe('content-aware alignment', () => {
  const alignment = {
    x: 0.1,
    y: -0.05,
    scale: 0.9,
    applied: true,
  }
  test('the cached registration only moves content while the layer opts in', () => {
    expect(getContentRect(generated({alignment}))).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    })
    expect(getContentRect(generated({
      alignment,
      contentAware: true,
    }))).toEqual({
      x: 20,
      y: -5,
      width: 180,
      height: 90,
    })
    expect(getActiveAlignment(generated({
      contentAware: true,
      alignment: {
        ...alignment,
        applied: false,
      },
    }))).toBeUndefined()
  })
  test('projects keep adjustments and cached registrations', () => {
    const document = parseProjectDocument({
      layers: [generated({
        contentAware: true,
        alignment,
        adjustments: {
          saturation: 0.25,
          gamma: 0,
        },
      })],
      ingredients: [],
    })
    expect(document.layers[0].alignment).toEqual(alignment)
    expect(document.layers[0].contentAware).toBe(true)
    expect(document.layers[0].adjustments).toEqual({saturation: 0.25})
  })
  test('imports cannot carry a registration and adjustments stay in range', () => {
    expect(() => parseProjectDocument({
      layers: [generated({
        kind: 'import',
        contentAware: true,
      })],
      ingredients: [],
    })).toThrow()
    expect(() => parseProjectDocument({
      layers: [generated({adjustments: {contrast: 4}})],
      ingredients: [],
    })).toThrow()
  })
})
