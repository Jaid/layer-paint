import {describe, expect, test} from 'bun:test'

import type {GenerationEvidence, Layer} from '#src/lib/state.ts'

import {collectDocumentAssetIds, parseProjectDocument} from '#src/lib/projectSchema.ts'
import {getAssetOccurrences, getRevisionIndex, getRevisions, withAddedRevision, withRevision} from '#src/lib/revisions.ts'

const rect = {
  x: 0,
  y: 0,
  width: 100,
  height: 50,
}
const evidence = (id: string, extra: Partial<GenerationEvidence> = {}): GenerationEvidence => ({
  id,
  capturedAt: 1,
  compiledPrompt: 'compiled',
  frame: rect,
  modelId: 'google/gemini-nano-banana-2.1',
  outputAssetId: `out-${id}`,
  prompt: 'a cat',
  quality: '',
  ratio: '2:1',
  referenceAssetIds: [`ref-${id}`],
  resolution: '',
  canvasAssetId: 'canvas',
  ...extra,
})
const generated: Layer = {
  id: 'layer',
  assetId: 'out-a',
  kind: 'generated',
  name: 'a cat',
  createdAt: 0,
  rect,
  visible: true,
  area: 1,
  feather: 0,
  modelId: 'google/gemini-nano-banana-2.1',
  evidence: evidence('a'),
  contentAware: true,
  alignment: {
    x: 0,
    y: 0,
    scale: 1,
    applied: false,
  },
}

describe('revisions', () => {
  test('a generation that was never rerolled has one revision', () => {
    expect(getRevisions(generated)).toHaveLength(1)
    expect(getRevisionIndex(generated)).toBe(0)
    expect(withRevision(generated, 0)).toBe(generated)
    expect(getRevisions({
      ...generated,
      kind: 'import',
      evidence: undefined,
    })).toEqual([])
  })
  test('a reroll becomes the shown revision; switching back restores everything that belongs to a shot', () => {
    const rerolled = withAddedRevision(generated, {
      assetId: 'out-b',
      evidence: evidence('b'),
      modelId: 'x-ai/grok-imagine-image-2.0',
    })
    expect(rerolled.assetId).toBe('out-b')
    expect(rerolled.evidence?.id).toBe('b')
    expect(rerolled.modelId).toBe('x-ai/grok-imagine-image-2.0')
    // The alignment belongs to the first output, not to the new one; layer settings stay.
    expect('alignment' in rerolled).toBe(false)
    expect(rerolled.contentAware).toBe(true)
    expect(rerolled.rect).toBe(generated.rect)
    expect(getRevisionIndex(rerolled)).toBe(1)
    expect(getRevisions(rerolled).map(item => item.assetId)).toEqual(['out-a', 'out-b'])
    const third = withAddedRevision(rerolled, {
      assetId: 'out-c',
      evidence: evidence('c'),
    })
    expect(getRevisions(third).map(item => item.assetId)).toEqual(['out-a', 'out-b', 'out-c'])
    expect('modelId' in third).toBe(false)
    const first = withRevision(third, 0)
    expect(first.assetId).toBe('out-a')
    expect(first.alignment).toEqual(generated.alignment)
    expect(first.modelId).toBe(generated.modelId)
    // An alignment computed while a revision is shown is kept when switching away and back.
    const aligned = {
      ...withRevision(first, 2),
      alignment: {
        x: 0.1,
        y: 0,
        scale: 1,
        applied: true,
      },
    }
    expect(withRevision(withRevision(aligned, 1), 2).alignment).toEqual(aligned.alignment)
    expect(withRevision(aligned, 7)).toBe(aligned)
  })
  test('occurrences tell shown images apart from buried revisions', () => {
    const rerolled = withAddedRevision(generated, {
      assetId: 'out-b',
      evidence: evidence('b'),
    })
    const copy: Layer = {
      ...generated,
      id: 'copy',
      kind: 'import',
      evidence: undefined,
      assetId: 'out-a',
    }
    expect(getAssetOccurrences([rerolled, copy], 'out-a').map(item => [item.layer.id, item.buried])).toEqual([['layer', true], ['copy', false]])
    expect(getAssetOccurrences([rerolled, copy], 'out-b').map(item => [item.layer.id, item.buried])).toEqual([['layer', false]])
    expect(getAssetOccurrences([rerolled, copy], 'nothing')).toEqual([])
  })
  test('revisions and opacity survive the project schema, and every revision keeps its images alive', () => {
    const rerolled = {
      ...withAddedRevision(generated, {
        assetId: 'out-b',
        evidence: evidence('b', {referenceAssetIds: ['ref-b']}),
      }),
      opacity: 0.5,
    }
    const document = {
      layers: [rerolled],
      ingredients: [],
      nextIngredientIndex: 1,
    }
    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(document)))
    expect(parsed.layers[0].opacity).toBe(0.5)
    expect(parsed.layers[0].revision).toBe(1)
    expect(parsed.layers[0].revisions?.map(item => item.assetId)).toEqual(['out-a', 'out-b'])
    expect(parsed.layers[0].revisions?.[0].alignment).toEqual(generated.alignment)
    const ids = collectDocumentAssetIds([parsed])
    for (const id of ['out-a', 'out-b', 'ref-a', 'ref-b', 'canvas']) {
      expect(ids.has(id)).toBe(true)
    }
    const invalid = (layer: Record<string, unknown>) => () => parseProjectDocument({
      ...document,
      layers: [{
        ...JSON.parse(JSON.stringify(rerolled)),
        ...layer,
      }],
    })
    expect(invalid({revision: 2})).toThrow()
    expect(invalid({revisions: []})).toThrow()
    expect(invalid({opacity: 1.5})).toThrow()
    expect(invalid({
      kind: 'import',
      evidence: undefined,
    })).toThrow()
  })
})
