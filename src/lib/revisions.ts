import type {GenerationRevision, Layer} from './state.ts'

import {getLayer} from './actions.ts'
import {setContentAwareAlignment, supportsContentAwareAlignment} from './contentAware.ts'
import {projectStore} from './state.ts'

/** the shown revision, read from the layer’s top-level fields, which are authoritative */
const getShownRevision = (layer: Layer): GenerationRevision | undefined => {
  if (!layer.evidence) {
    return undefined
  }
  return {
    assetId: layer.assetId,
    evidence: layer.evidence,
    ...layer.modelId === undefined ? {} : {modelId: layer.modelId},
    ...layer.alignment === undefined ? {} : {alignment: layer.alignment},
  }
}

/** index of the shown revision; 0 for layers that were never rerolled */
export const getRevisionIndex = (layer: Pick<Layer, 'revision' | 'revisions'>) => {
  const count = layer.revisions?.length ?? 0
  if (!count) {
    return 0
  }
  return Math.min(count - 1, Math.max(0, Math.trunc(layer.revision ?? 0)))
}

/** every shot of a generated layer in creation order, with the shown one up to date; empty for imports */
export const getRevisions = (layer: Layer): ReadonlyArray<GenerationRevision> => {
  const shown = getShownRevision(layer)
  if (!shown) {
    return []
  }
  if (!layer.revisions?.length) {
    return [shown]
  }
  const index = getRevisionIndex(layer)
  return layer.revisions.map((revision, i) => (i === index ? shown : revision))
}

/** the layer showing another of its revisions; the previously shown one is written back into the list first */
export const withRevision = (layer: Layer, index: number): Layer => {
  const revisions = getRevisions(layer)
  const target = revisions[index]
  if (!target || revisions.length < 2) {
    return layer
  }
  const next: Layer = {
    ...layer,
    assetId: target.assetId,
    evidence: target.evidence,
    modelId: target.modelId,
    alignment: target.alignment,
    revisions,
    revision: index,
  }
  if (next.modelId === undefined) {
    delete next.modelId
  }
  if (next.alignment === undefined) {
    delete next.alignment
  }
  return next
}

/** the layer with an additional revision, which becomes the shown one */
export const withAddedRevision = (layer: Layer, revision: GenerationRevision): Layer => {
  const revisions = [...getRevisions(layer), revision]
  return withRevision({
    ...layer,
    revisions,
    revision: getRevisionIndex(layer),
  }, revisions.length - 1)
}

export type AssetOccurrence = {
  /** whether the image is one of the layer’s revisions that is not shown right now */
  buried: boolean
  layer: Layer
}

/** every layer that shows the image or keeps it as a revision */
export const getAssetOccurrences = (layers: ReadonlyArray<Layer>, assetId: string) => layers.flatMap((layer): Array<AssetOccurrence> => {
  if (layer.assetId === assetId) {
    return [{
      layer,
      buried: false,
    }]
  }
  return layer.revisions?.some(revision => revision.assetId === assetId) ? [{
    layer,
    buried: true,
  }] : []
})

/** Shows another revision of a generated layer as one undo step. */
export const showRevision = (id: string, index: number) => {
  const layer = getLayer(id)
  if (!layer || index === getRevisionIndex(layer) || !layer.revisions?.[index]) {
    return
  }
  projectStore.commit(document => ({
    ...document,
    layers: document.layers.map(item => (item.id === id ? withRevision(item, index) : item)),
  }))
  const shown = getLayer(id)
  // Content-aware alignment stays on across revisions; a revision that was never analyzed is registered now.
  if (shown?.contentAware && !shown.alignment && supportsContentAwareAlignment(shown)) {
    void setContentAwareAlignment(id, true)
  }
}

/** Steps through the revisions of a generated layer, without wrapping around. */
export const stepRevision = (id: string, direction: -1 | 1) => {
  const layer = getLayer(id)
  if (layer) {
    showRevision(id, getRevisionIndex(layer) + direction)
  }
}
