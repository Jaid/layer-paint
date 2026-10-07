import type {Layer} from '../src/lib/state.ts'

import {describe, expect, test} from 'bun:test'

import {parseImageResult, readBoundedBody, validateImageRequest} from '../src/lib/imageApi.ts'
import {resizeFrameFromEdge} from '../src/lib/interaction.ts'
import {getLayerBounds, layerToWorld, worldToLayer} from '../src/lib/layerGeometry.ts'
import {getMaskAlpha, getMaskMetrics, overlapMaskAlpha} from '../src/lib/mask.ts'
import catalog from '../src/lib/models/catalog.json'
import {models, parseImageCatalog} from '../src/lib/models/index.ts'
import {collectDocumentAssetIds, parseProjectDocument} from '../src/lib/projectSchema.ts'
import {compilePrompt, findReferences} from '../src/lib/prompt.ts'

const compile = (text: string, hasCanvasContent = true) => compilePrompt({
  text,
  hasCanvasContent,
  ingredientIndices: [1, 2, 7],
  maxReferences: 14,
})
const image = 'data:image/png;base64,AAAA'
const request = {
  model: models[0].id,
  prompt: 'Make a change',
  aspect_ratio: '1:1',
  resolution: '1K',
  input_references: [{
    type: 'image_url',
    image_url: {url: image},
  }],
}
const layer: Layer = {
  id: 'layer',
  assetId: 'asset',
  name: 'Example',
  kind: 'import',
  createdAt: 0,
  visible: true,
  area: 1,
  feather: 0,
  rect: {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  },
}
describe('definitive prompt contracts', () => {
  test('the fixture coffee/logo example always includes the canvas first', () => {
    const result = compile('The hand should hold a cup of coffee with ![2] printed on it')
    expect(result.errors).toEqual([])
    expect(result.sources).toEqual([{kind: 'canvas'}, {
      kind: 'ingredient',
      index: 2,
    }])
    expect(result.text).toContain('with [Image 2] printed')
  })
  test('only referenced ingredients are sent, in first-mention order', () => {
    expect(compile('![7] ![2] ![7]').sources).toEqual([{kind: 'canvas'}, {
      kind: 'ingredient',
      index: 7,
    }, {
      kind: 'ingredient',
      index: 2,
    }])
  })
  test('explicit canvas on an empty frame is rejected', () => expect(compile('Edit ![0]', false).errors.join()).toContain('empty frame'))
  test('ordinary text on an empty frame is a valid initial generation', () => expect(compile('a lighthouse', false)).toEqual({
    sources: [],
    errors: [],
    text: 'a lighthouse',
  }))
  test('escaped references stay literal', () => {
    expect(findReferences(String.raw`literal \![2] and ![1]`).map(token => token.index)).toEqual([1]); expect(compile(String.raw`literal \![2]`).sources).toEqual([{kind: 'canvas'}])
  })
  test('complete Markdown images do not become arbitrary fetch targets', () => expect(findReferences('![2](https://example.invalid/a.png) ![7][ref]')).toEqual([]))
  test('code spans and comments are not ingredients', () => expect(findReferences('`![2]` <!-- ![7] --> ![1]').map(token => token.index)).toEqual([1]))
  test('unknown and unsafe reference IDs are rejected', () => {
    expect(compile('![3]').errors).toHaveLength(1); expect(compile('![9007199254740993]').errors).toHaveLength(1)
  })
  test('empty/comment-only prompts fail before provider dispatch', () => expect(compile('<!-- draft -->').errors).toContain('The prompt is empty.'))
})
describe('graphics invariants', () => {
  test('25% mask area means half width and height, not quarter width and height', () => {
    const mask = getMaskMetrics({
      area: 0.25,
      feather: 0,
    }, {
      width: 200,
      height: 100,
    })
    expect(mask.width).toBe(100); expect(mask.height).toBe(50); expect(mask.x).toBe(50); expect(mask.y).toBe(25)
  })
  test('no underlying coverage means exposed edges remain opaque', () => {
    expect(overlapMaskAlpha(1, 0, 0)).toBe(1)
    expect(overlapMaskAlpha(1, 0.2, 0)).toBe(1)
  })
  test('overlap feather blends while the accumulated background remains intact', () => {
    const mask = overlapMaskAlpha(1, 0.25, 1)
    expect(mask).toBe(0.25)
    const background = 1; const layerAlpha = mask
    expect(layerAlpha + background * (1 - layerAlpha)).toBe(1)
  })
  test('explicit all-edge feather can still fade an exposed border', () => expect(overlapMaskAlpha(1, 0.25, 0, true)).toBe(0.25))
  test('area zero remains empty regardless of coverage', () => {
    expect(getMaskAlpha({
      area: 0,
      feather: 0,
    }, {
      width: 20,
      height: 20,
    }, 10, 10)).toBe(0); expect(overlapMaskAlpha(0, 1, 0)).toBe(0)
  })
  test('roundness changes corners without moving the mask center', () => {
    expect(getMaskAlpha({
      area: 1,
      feather: 0,
      roundness: 1,
    }, {
      width: 100,
      height: 100,
    }, 1, 1)).toBe(0); expect(getMaskAlpha({
      area: 1,
      feather: 0,
      roundness: 1,
    }, {
      width: 100,
      height: 100,
    }, 50, 50)).toBe(1)
  })
  test('mask translation is independent of image placement', () => {
    const result = getMaskMetrics({
      area: 0.25,
      feather: 0,
      offsetX: 0.1,
    }, {
      width: 100,
      height: 100,
    }); expect(result.x).toBe(35); expect(result.width).toBe(50)
  })
  test('rotated world/local coordinates round trip', () => {
    const rotated = {
      ...layer,
      rotation: 37,
    }; const point = {
      x: 20,
      y: 35,
    }; const result = worldToLayer(rotated, layerToWorld(rotated, point)); expect(result.x).toBeCloseTo(point.x, 8); expect(result.y).toBeCloseTo(point.y, 8)
  })
  test('90° import rotation changes export bounds', () => {
    const result = getLayerBounds({
      ...layer,
      rotation: 90,
    }); expect(result.width).toBeCloseTo(50); expect(result.height).toBeCloseTo(100)
  })
  test('edge frame resizing snaps ratios and anchors the opposite side', () => {
    const start = {
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    }
    const result = resizeFrameFromEdge(start, 'w', {
      x: -90,
      y: 60,
    }, ['1:1', '2:1', '1:2'])
    expect(result.ratio).toBe('2:1'); expect(result.rect).toEqual({
      x: -90,
      y: 20,
      width: 200,
      height: 100,
    })
  })
})
describe('Image API request contract', () => {
  test('normalizes aliases and discards arbitrary extra provider fields', () => {
    const parsed = validateImageRequest({
      ...request,
      model: 'gemini-3.1-flash-image',
      n: 99,
      messages: ['wrong endpoint'],
      tools: ['unsafe extra'],
      secret: 'not forwarded',
    })
    expect(parsed.model).toBe('google/gemini-3.1-flash-image'); expect(parsed.n).toBe(1)
    expect(Object.keys(parsed).sort()).toEqual(['aspect_ratio', 'input_references', 'model', 'n', 'prompt', 'resolution'])
  })
  test('remote input URLs are rejected', () => expect(() => validateImageRequest({
    ...request,
    input_references: [{
      type: 'image_url',
      image_url: {url: 'https://example.invalid/private'},
    }],
  })).toThrow('embedded'))
  test('too many references are rejected rather than silently discarded', () => expect(() => validateImageRequest({
    ...request,
    model: 'x-ai/grok-imagine-image-2.0',
    input_references: Array.from({length: 4}).fill(request.input_references[0]),
  })).toThrow('at most 3'))
  test('unsupported model, ratio, resolution and quality fail explicitly', () => {
    for (const change of [{model: 'unknown'}, {aspect_ratio: '0:1'}, {resolution: '8K'}, {quality: 'imaginary'}]) {
      expect(() => validateImageRequest({
        ...request,
        ...change,
      })).toThrow()
    }
  })
  test('all nine models come from the dedicated catalog, not chat discovery', () => expect(parseImageCatalog(catalog).map(item => item.id)).toEqual(models.map(model => model.id)))
  test('a generic chat catalog cannot masquerade as image capabilities', () => expect(() => parseImageCatalog({data: [{
    id: models[0].id,
    architecture: {output_modalities: ['image']},
  }]})).toThrow())
  test('success body strips provider echoes and keeps numeric cost', () => {
    const parsed = parseImageResult({
      data: [{
        b64_json: 'AAAA',
        media_type: 'image/png',
        extra: 'ignored',
      }],
      usage: {
        cost: 0.03,
        token: 'ignored',
      },
      key: 'ignored',
    })
    expect(parsed).toEqual({
      data: [{
        b64_json: 'AAAA',
        media_type: 'image/png',
      }],
      usage: {cost: 0.03},
    })
  })
  test('chat completion response is not accepted as an Image API response', () => expect(() => parseImageResult({choices: [{message: {images: []}}]})).toThrow())
  test('oversized streamed bodies are canceled', async () => {
    let canceled = false
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(6))
      },
      cancel() {
        canceled = true
      },
    })
    await expect(readBoundedBody(new Response(stream), 10)).rejects.toThrow('size limit')
    expect(canceled).toBe(true)
  })
})
describe('portable project validation', () => {
  test('accepts an ordinary document and regenerates untrusted thumbnails', () => {
    const result = parseProjectDocument({
      layers: [layer],
      ingredients: [{
        id: 'ref',
        assetId: 'asset',
        index: 2,
        name: 'Ref',
        thumbnail: 'https://not-loaded.invalid',
        createdAt: 0,
      }],
      nextIngredientIndex: 3,
    })
    expect(result.ingredients[0].thumbnail).toBe(''); expect(result.nextIngredientIndex).toBe(3)
  })
  test('rejects duplicate layer identifiers', () => expect(() => parseProjectDocument({
    layers: [layer, layer],
    ingredients: [],
  })).toThrow())
  test('rejects invalid geometry, masks and generated rotations', () => {
    for (const edited of [{
      ...layer,
      rect: {
        ...layer.rect,
        width: 0,
      },
    }, {
      ...layer,
      area: 1.1,
    }, {
      ...layer,
      kind: 'generated',
      rotation: 10,
    }]) {
      expect(() => parseProjectDocument({
        layers: [edited],
        ingredients: [],
      })).toThrow()
    }
  })
  test('reference indices cannot be reused by a stale counter', () => expect(() => parseProjectDocument({
    layers: [],
    ingredients: [{
      id: 'ref',
      assetId: 'a',
      index: 5,
      name: 'Ref',
      createdAt: 0,
    }],
    nextIngredientIndex: 3,
  })).toThrow())
  test('hidden layers still keep their source images reachable', () => expect([...collectDocumentAssetIds([{
    layers: [{
      ...layer,
      visible: false,
    }],
    ingredients: [],
  }])]).toEqual(['asset']))
})
