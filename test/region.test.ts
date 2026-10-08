import type {Layer, ProjectDocument} from '#src/lib/state.ts'

import {describe, expect, test} from 'bun:test'

import {withIngredient, withLayerIngredients} from '#src/lib/actions.ts'
import {getContentRegion, getGenerationMode, getGenerationRegion, hasContentOutside} from '#src/lib/generationRegion.ts'
import {parseProjectDocument} from '#src/lib/projectSchema.ts'
import {getThumbnailFit, maxThumbnailAspect, minThumbnailAspect} from '#src/lib/thumbnailFit.ts'

const layer = (id: string, rect: Layer['rect'], extra: Partial<Layer> = {}): Layer => ({
  id,
  assetId: `asset-${id}`,
  name: id,
  kind: 'import',
  createdAt: 0,
  visible: true,
  area: 1,
  feather: 0,
  rect,
  ...extra,
})
const base = layer('base', {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
})
describe('generation region', () => {
  test('the frame is used while it is on', () => {
    const frame = {
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    }
    expect(getGenerationRegion({
      frame,
      frameEnabled: true,
      modelId: 'google/gemini-nano-banana-2.1',
      ratio: '1:1',
    }, [base])).toEqual({
      frame,
      ratio: '1:1',
    })
  })
  test('a switched-off frame spans all artwork with the closest supported ratio', () => {
    const region = getGenerationRegion({
      frame: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      frameEnabled: false,
      modelId: 'google/gemini-nano-banana-2.1',
      ratio: '1:1',
    }, [base, layer('top', {
      x: 150,
      y: 50,
      width: 100,
      height: 100,
    })])
    // Artwork spans 250 × 150; the frame must cover it completely at a supported ratio.
    expect(region.ratio).toBe('16:9')
    expect(region.frame.width).toBeGreaterThanOrEqual(250)
    expect(region.frame.height).toBeGreaterThanOrEqual(150 - 1e-9)
    expect(region.frame.width / region.frame.height).toBeCloseTo(16 / 9)
    expect(region.frame.x + region.frame.width / 2).toBeCloseTo(125)
    expect(region.frame.y + region.frame.height / 2).toBeCloseTo(75)
  })
  test('without artwork a switched-off frame falls back to the frame', () => {
    expect(getContentRegion([], ['1:1'])).toBeUndefined()
    expect(getGenerationRegion({
      frame: {
        x: 1,
        y: 2,
        width: 3,
        height: 3,
      },
      frameEnabled: false,
      modelId: 'google/gemini-nano-banana-2.1',
      ratio: '1:1',
    }, []).frame).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 3,
    })
  })
  test('content outside the frame is detected with a rounding tolerance', () => {
    expect(hasContentOutside([base], {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    })).toBe(false)
    expect(hasContentOutside([base], {
      x: 0.1,
      y: 0,
      width: 199.9,
      height: 100,
    })).toBe(false)
    expect(hasContentOutside([base], {
      x: 20,
      y: 0,
      width: 100,
      height: 100,
    })).toBe(true)
    expect(hasContentOutside([{
      ...base,
      visible: false,
    }], {
      x: 20,
      y: 0,
      width: 100,
      height: 100,
    })).toBe(false)
  })
  test('a frame without artwork generates', () => {
    expect(getGenerationMode([base], {
      x: 500,
      y: 500,
      width: 100,
      height: 100,
    })).toBe('generate')
  })
})
describe('collection numbering', () => {
  const ingredient = {
    id: 'i',
    assetId: 'asset-base',
    index: 4,
    name: 'base',
    kind: 'import' as const,
    thumbnail: '',
    createdAt: 0,
  }
  test('adding an entry advances the counter and never duplicates an image', () => {
    const document: ProjectDocument = {
      layers: [],
      ingredients: [],
      nextIngredientIndex: 1,
    }
    const added = withIngredient(document, ingredient)
    expect(added.ingredients).toHaveLength(1)
    expect(added.nextIngredientIndex).toBe(5)
    expect(withIngredient(added, {
      ...ingredient,
      id: 'j',
      index: 5,
    })).toBe(added)
  })
  test('older projects number every layer image once, keeping existing numbers', () => {
    const document: ProjectDocument = {
      layers: [base, layer('gen', base.rect, {kind: 'generated'}), {
        ...base,
        id: 'copy',
      }],
      ingredients: [{
        ...ingredient,
        assetId: 'asset-other',
        index: 3,
      }],
      nextIngredientIndex: 7,
    }
    const migrated = withLayerIngredients(document)
    expect(migrated.ingredients.map(item => [item.assetId, item.index, item.kind])).toEqual([['asset-other', 3, 'import'], ['asset-base', 7, 'import'], ['asset-gen', 8, 'generated']])
    expect(migrated.nextIngredientIndex).toBe(9)
    expect(migrated.layersNumbered).toBe(true)
    // Once migrated, removed entries are not brought back.
    const removed = {
      ...migrated,
      ingredients: migrated.ingredients.slice(0, 1),
    }
    expect(withLayerIngredients(removed)).toBe(removed)
  })
  test('the migration flag survives validation', () => {
    expect(parseProjectDocument({
      layers: [],
      ingredients: [],
      layersNumbered: true,
    }).layersNumbered).toBe(true)
    expect(parseProjectDocument({
      layers: [],
      ingredients: [],
    }).layersNumbered).toBeUndefined()
  })
})
describe('collection thumbnails', () => {
  test('moderate aspects keep the whole image', () => {
    expect(getThumbnailFit(300, 200)).toEqual({aspect: 1.5})
    expect(getThumbnailFit(200, 300)).toEqual({aspect: 2 / 3})
    expect(getThumbnailFit(400, 200)).toEqual({aspect: 2})
  })
  test('very tall images are cropped to 2:3 with top and bottom marked', () => {
    expect(getThumbnailFit(48, 192)).toEqual({
      aspect: minThumbnailAspect,
      crop: 'vertical',
    })
  })
  test('very wide images are cropped to 2:1 with left and right marked', () => {
    expect(getThumbnailFit(1000, 200)).toEqual({
      aspect: maxThumbnailAspect,
      crop: 'horizontal',
    })
  })
  test('rounding noise just past a limit is not flagged as a crop', () => {
    expect(getThumbnailFit(2010, 1000)).toEqual({aspect: maxThumbnailAspect})
    expect(getThumbnailFit(1000, 1505)).toEqual({aspect: minThumbnailAspect})
  })
  test('unknown dimensions fall back to a square', () => {
    expect(getThumbnailFit(0, 0)).toEqual({aspect: 1})
  })
})
