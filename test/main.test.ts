import {describe, expect, test} from 'bun:test'

import {align, decideAlignment, identityPlacement} from '#src/lib/alignment/align.ts'
import {placementToRect} from '#src/lib/alignment/index.ts'
import {containSize, coverRect, rectIntersection, rectUnion, sizeFromArea} from '#src/lib/geometry.ts'
import {findSnapOffset, moveRectWithSnapping, resizeRectFromCorner} from '#src/lib/interaction.ts'
import {getMaskAlpha, getMaskCss, getMaskStops, isMaskActive} from '#src/lib/mask.ts'
import {defaultModel, findModel, getModel, models} from '#src/lib/models/index.ts'
import {compilePrompt, findReferences, stripComments} from '#src/lib/prompt.ts'
import {closestRatio, isRatioString, parseRatio} from '#src/lib/ratio.ts'
import {HistoryStore} from '#src/lib/store/index.ts'

describe('geometry', () => {
  test('coverRect covers the target with the requested aspect', () => {
    const rect = coverRect({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    }, 1)
    expect(rect).toEqual({
      x: 0,
      y: -50,
      width: 200,
      height: 200,
    })
  })
  test('containSize fits inside bounds', () => {
    expect(containSize({
      width: 100,
      height: 100,
    }, 2)).toEqual({
      width: 100,
      height: 50,
    })
    expect(containSize({
      width: 100,
      height: 100,
    }, 0.5)).toEqual({
      width: 50,
      height: 100,
    })
  })
  test('sizeFromArea keeps area and aspect', () => {
    const size = sizeFromArea(1024 * 1024, 16 / 9)
    expect(size.width / size.height).toBeCloseTo(16 / 9)
    expect(size.width * size.height).toBeCloseTo(1024 * 1024)
  })
  test('intersection and union', () => {
    const a = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }
    const b = {
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    }
    expect(rectIntersection(a, b)).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    })
    expect(rectIntersection(a, {
      x: 20,
      y: 20,
      width: 1,
      height: 1,
    })).toBeNull()
    expect(rectUnion([a, b])).toEqual({
      x: 0,
      y: 0,
      width: 15,
      height: 15,
    })
    expect(rectUnion([])).toBeNull()
  })
})
describe('ratio', () => {
  test('parses ratios including fractional parts', () => {
    expect(parseRatio('16:9')).toBeCloseTo(16 / 9)
    expect(parseRatio('19.5:9')).toBeCloseTo(19.5 / 9)
    expect(() => parseRatio('abc')).toThrow()
    expect(isRatioString('4:3')).toBe(true)
    expect(isRatioString('4x3')).toBe(false)
  })
  test('closestRatio compares logarithmically', () => {
    expect(closestRatio(1.7, ['1:1', '16:9', '4:3'])).toBe('16:9')
    expect(closestRatio(0.5, ['1:1', '2:1', '1:2'])).toBe('1:2')
  })
})
describe('models', () => {
  test('all nine requested models are available', () => {
    expect(models.map(model => model.id)).toEqual([
      'google/gemini-3.1-flash-lite-image',
      'google/gemini-3.1-flash-image',
      'google/gemini-nano-banana-2.1',
      'openai/gpt-image-2.5-sunburst',
      'black-forest-labs/flux-3-image',
      'x-ai/grok-imagine-image-2.0',
      'bytedance-seed/seedream-5-0-flash',
      'bytedance-seed/seedream-5-0-lite',
      'bytedance-seed/seedream-5-0-pro',
    ])
  })
  test('models resolve with or without vendor prefix', () => {
    expect(findModel('gemini-3.1-flash-image')?.id).toBe('google/gemini-3.1-flash-image')
    expect(findModel('gpt-image-2.5-sunburst')?.id).toBe('openai/gpt-image-2.5-sunburst')
    expect(findModel('nope')).toBeUndefined()
    expect(getModel('nope')).toBe(defaultModel)
  })
  test('every model supports 1:1 and has valid ratios', () => {
    for (const model of models) {
      expect(model.supportsRatio('1:1')).toBe(true)
      for (const ratio of model.aspectRatios) {
        expect(isRatioString(ratio)).toBe(true)
      }
    }
  })
  test('request options only contain supported values', () => {
    const grok = getModel('x-ai/grok-imagine-image-2.0')
    expect(grok.getRequestOptions({
      resolution: '4K',
      quality: 'max',
    })).toEqual({
      resolution: '1K',
      quality: 'medium',
    })
    const gpt = getModel('openai/gpt-image-2.5-sunburst')
    expect(gpt.getRequestOptions({quality: 'high'})).toEqual({quality: 'high'})
    const seedreamLite = getModel('bytedance-seed/seedream-5-0-lite')
    expect(seedreamLite.getRequestOptions({})).toEqual({resolution: '2K'})
  })
})
describe('prompt', () => {
  const base = {
    ingredientIndices: [1, 2],
    maxReferences: 14,
  }
  test('finds references', () => {
    expect(findReferences('a ![1] b ![0]').map(reference => reference.index)).toEqual([1, 0])
  })
  test('canvas comes first even when ![0] is omitted', () => {
    const compiled = compilePrompt({
      ...base,
      hasCanvasContent: true,
      text: 'The hand should hold a cup with ![2] on it',
    })
    expect(compiled.errors).toEqual([])
    expect(compiled.sources).toEqual([{kind: 'canvas'}, {
      kind: 'ingredient',
      index: 2,
    }])
    expect(compiled.text).toContain('a cup with [Image 2] on it')
  })
  test('rewrites references to image positions', () => {
    const compiled = compilePrompt({
      ...base,
      hasCanvasContent: true,
      text: 'Please put the face of ![1] onto the head of ![0]',
    })
    expect(compiled.sources).toEqual([{kind: 'canvas'}, {
      kind: 'ingredient',
      index: 1,
    }])
    expect(compiled.text).toContain('Please put the face of [Image 2] onto the head of [Image 1]')
  })
  test('repeated references are attached once', () => {
    const compiled = compilePrompt({
      ...base,
      hasCanvasContent: false,
      text: '![2] next to ![2] and ![1]',
    })
    expect(compiled.sources).toEqual([{
      kind: 'ingredient',
      index: 2,
    }, {
      kind: 'ingredient',
      index: 1,
    }])
    expect(compiled.text).toContain('[Image 1] next to [Image 1] and [Image 2]')
  })
  test('without canvas content and references the prompt is passed through', () => {
    const compiled = compilePrompt({
      ...base,
      hasCanvasContent: false,
      text: 'a red apple',
    })
    expect(compiled.sources).toEqual([])
    expect(compiled.text).toBe('a red apple')
  })
  test('reports missing references, empty prompts and too many images', () => {
    expect(compilePrompt({
      ...base,
      hasCanvasContent: false,
      text: '![7]',
    }).errors[0]).toContain('![7]')
    expect(compilePrompt({
      ...base,
      hasCanvasContent: false,
      text: '  ',
    }).errors).toContain('The prompt is empty.')
    expect(compilePrompt({
      ...base,
      maxReferences: 2,
      hasCanvasContent: true,
      text: '![1] ![2]',
    }).errors.join(' ')).toContain('at most 2')
  })
  test('mentions empty canvas areas', () => {
    const compiled = compilePrompt({
      ...base,
      hasCanvasContent: true,
      canvasHasEmptyAreas: true,
      text: 'extend',
    })
    expect(compiled.text).toContain('gray')
  })
  test('HTML comments are stripped', () => {
    expect(stripComments('a <!-- note ![9] --> b')).toBe('a  b')
    expect(compilePrompt({
      ...base,
      hasCanvasContent: false,
      text: 'a <!-- ![9] -->',
    }).errors).toEqual([])
  })
})
describe('mask', () => {
  const size = {
    width: 200,
    height: 100,
  }
  test('full area without feather is inactive', () => {
    expect(isMaskActive({
      area: 1,
      feather: 0,
    })).toBe(false)
    expect(getMaskCss({
      area: 1,
      feather: 0,
    }, size)).toBeUndefined()
  })
  test('area contracts the visible region', () => {
    const settings = {
      area: 0.5,
      feather: 0,
    }
    expect(getMaskAlpha(settings, size, 100, 50)).toBe(1)
    expect(getMaskAlpha(settings, size, 10, 50)).toBe(0)
    expect(getMaskAlpha(settings, size, 100, 10)).toBe(0)
  })
  test('feather produces a smooth falloff', () => {
    const settings = {
      area: 1,
      feather: 0.5,
    }
    expect(getMaskAlpha(settings, size, 0, 50)).toBe(0)
    const inner = getMaskAlpha(settings, size, 20, 50)
    expect(inner).toBeGreaterThan(0)
    expect(inner).toBeLessThan(1)
    expect(getMaskAlpha(settings, size, 100, 50)).toBe(1)
  })
  test('stops are monotonic and symmetric', () => {
    const stops = getMaskStops({
      area: 0.8,
      feather: 0.3,
    }, size, 'x')
    for (let index = 1; index < stops.length; index++) {
      expect(stops[index].offset).toBeGreaterThanOrEqual(stops[index - 1].offset - 1e-9)
    }
    expect(stops[0].offset + stops.at(-1)!.offset).toBeCloseTo(1)
  })
  test('css uses two intersected gradients', () => {
    const css = getMaskCss({
      area: 0.9,
      feather: 0.2,
    }, size)!
    expect(css.maskComposite).toBe('intersect')
    expect(css.maskImage.match(/linear-gradient/g)?.length).toBe(2)
  })
})
describe('interaction', () => {
  test('snap offset picks the closest target', () => {
    expect(findSnapOffset([10, 50], [12, 49], 5)).toBe(-1)
    expect(findSnapOffset([10], [100], 5)).toBeUndefined()
  })
  test('moving snaps edges', () => {
    const {rect, guides} = moveRectWithSnapping({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }, {
      x: 97,
      y: 0,
    }, {
      x: [100],
      y: [],
    }, 4)
    // The center (102) is closest to the target, so the rect centers on it.
    expect(rect.x).toBe(95)
    expect(guides.x).toBe(100)
  })
  test('corner resize keeps the aspect ratio and opposite corner', () => {
    const start = {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    }
    const {rect} = resizeRectFromCorner({
      aspect: 2,
      corner: 'se',
      minWidth: 10,
      pointer: {
        x: 300,
        y: 60,
      },
      start,
    })
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
    expect(rect.width / rect.height).toBeCloseTo(2)
    expect(rect.width).toBe(300)
    const fromNw = resizeRectFromCorner({
      aspect: 2,
      corner: 'nw',
      minWidth: 10,
      pointer: {
        x: 50,
        y: 0,
      },
      start,
    }).rect
    expect(fromNw.x + fromNw.width).toBe(100)
    expect(fromNw.y + fromNw.height).toBe(50)
  })
  test('resize respects the minimum width', () => {
    const {rect} = resizeRectFromCorner({
      aspect: 1,
      corner: 'se',
      minWidth: 40,
      pointer: {
        x: -100,
        y: -100,
      },
      start: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    })
    expect(rect.width).toBe(40)
  })
})
describe('history', () => {
  test('undo, redo and coalescing', () => {
    const store = new HistoryStore({value: 0})
    store.commit({value: 1})
    store.commit({value: 2}, {coalesceKey: 'drag'})
    store.commit({value: 3}, {coalesceKey: 'drag'})
    expect(store.meta.state.canUndo).toBe(true)
    store.undo()
    expect(store.state.value).toBe(1)
    store.undo()
    expect(store.state.value).toBe(0)
    expect(store.meta.state.canUndo).toBe(false)
    store.redo()
    store.redo()
    expect(store.state.value).toBe(3)
    store.undo()
    store.commit({value: 9})
    expect(store.meta.state.canRedo).toBe(false)
    expect(store.reachableStates.map(state => state.value)).toEqual([0, 1, 9])
  })
  test('set does not create history', () => {
    const store = new HistoryStore({value: 0})
    store.set({value: 5})
    expect(store.meta.state.canUndo).toBe(false)
  })
})
describe('alignment', () => {
  const size = 128
  /** smooth synthetic scene sampled at normalized coordinates */
  const scene = (u: number, v: number) => 128 + 60 * Math.sin(u * 9 + v * 3) + 40 * Math.cos(v * 11 - u * 2) + 30 * Math.exp(-((u - 0.62) ** 2 + (v - 0.4) ** 2) * 40)
  const render = (x: number, y: number, scale: number) => {
    const data = new Float32Array(size * size)
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        data[row * size + column] = scene(x + scale * (column + 0.5) / size, y + scale * (row + 0.5) / size)
      }
    }
    return {
      data,
      width: size,
      height: size,
    }
  }
  test('recovers a shifted and zoomed output', () => {
    const input = render(0, 0, 1)
    const output = render(0.15, -0.05, 0.9)
    const result = align(input, output)
    expect(result.placement.x).toBeCloseTo(0.15, 1)
    expect(result.placement.y).toBeCloseTo(-0.05, 1)
    expect(result.placement.scale).toBeCloseTo(0.9, 1)
    expect(decideAlignment(result).apply).toBe(true)
  })
  test('keeps an aligned output in place', () => {
    const input = render(0, 0, 1)
    const result = align(input, render(0, 0, 1))
    expect(decideAlignment(result).apply).toBe(false)
  })
  test('placement maps to world space', () => {
    expect(placementToRect({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    }, {
      x: 0.1,
      y: 0.2,
      scale: 0.5,
    })).toEqual({
      x: 120,
      y: 70,
      width: 100,
      height: 50,
    })
    expect(placementToRect({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    }, identityPlacement)).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
  })
})
