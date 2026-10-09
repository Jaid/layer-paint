import type {Asset} from './assets.ts'
import type {Orientation, Symmetry} from './orientation.ts'
import type {Ingredient, Layer, ProjectDocument} from './state.ts'

import {workspaceEpoch} from './actions.ts'
import {assets} from './assets.ts'
import {setContentAwareAlignment, supportsContentAwareAlignment} from './contentAware.ts'
import {createCanvas, createThumbnailDataUrl, encodeCanvas} from './image.ts'
import {getPixelTransform, getSymmetry, identityOrientation, isIdentitySymmetry, isSameOrientation, swapRectAxes, swapsAxes} from './orientation.ts'
import {projectStore} from './state.ts'
import {Store} from './store/index.ts'

export const getIngredientOrientation = (ingredient: Pick<Ingredient, 'flip' | 'rotation'>): Orientation => ({
  rotation: ingredient.rotation ?? 0,
  flip: ingredient.flip ?? 'none',
})

/** the original image of a collection entry, before any rotation or flip */
export const getSourceAssetId = (ingredient: Pick<Ingredient, 'assetId' | 'sourceAssetId'>) => ingredient.sourceAssetId ?? ingredient.assetId

/** the image a collection entry shows in a given orientation */
export type OrientedImage = {
  assetId: string
  thumbnail: string
}

const withoutAlignment = <Value extends {alignment?: unknown}>(value: Value): Value => {
  const next = {...value}
  delete next.alignment
  return next
}
/**
 * The layer with every use of one image replaced by another.
 * A quarter turn turns the layer rect around its center, so the image keeps its proportions; registrations of the old image no longer apply.
 */
const withReplacedAsset = (layer: Layer, from: string, to: string, swap: boolean): Layer => {
  let next = layer
  if (layer.assetId === from) {
    next = withoutAlignment({
      ...layer,
      assetId: to,
      rect: swap ? swapRectAxes(layer.rect) : layer.rect,
    })
  }
  if (layer.revisions?.some(revision => revision.assetId === from)) {
    next = {
      ...next,
      revisions: layer.revisions.map(revision => (revision.assetId === from ? withoutAlignment({
        ...revision,
        assetId: to,
      }) : revision)),
    }
  }
  return next
}

/**
 * The document with a collection entry shown in another orientation, together with every layer that shows its image or keeps it as a revision.
 * Nothing changes if the entry is gone or now stands for another original image.
 */
export function withIngredientOrientation(document: ProjectDocument, ingredientId: string, sourceAssetId: string, orientation: Orientation, image: OrientedImage): ProjectDocument {
  const ingredient = document.ingredients.find(item => item.id === ingredientId)
  if (!ingredient || getSourceAssetId(ingredient) !== sourceAssetId) {
    return document
  }
  const current = getIngredientOrientation(ingredient)
  if (isSameOrientation(current, orientation) && ingredient.assetId === image.assetId) {
    return document
  }
  const next: Ingredient = {
    ...ingredient,
    assetId: image.assetId,
    thumbnail: image.thumbnail,
  }
  delete next.rotation
  delete next.flip
  delete next.sourceAssetId
  if (!isSameOrientation(orientation, identityOrientation)) {
    next.sourceAssetId = sourceAssetId
    if (orientation.rotation !== 0) {
      next.rotation = orientation.rotation
    }
    if (orientation.flip !== 'none') {
      next.flip = orientation.flip
    }
  }
  const from = ingredient.assetId
  const swap = swapsAxes(current) !== swapsAxes(orientation)
  return {
    ...document,
    ingredients: document.ingredients.map(item => (item.id === ingredientId ? next : item)),
    layers: from === image.assetId ? document.layers : document.layers.map(layer => withReplacedAsset(layer, from, image.assetId, swap)),
  }
}

/** oriented images by original and symmetry, so switching back and forth does not encode the same pixels twice */
const orientedImages = new Map<string, OrientedImage>
assets.subscribeRelease(id => {
  for (const [key, image] of orientedImages) {
    if (image.assetId === id || key.startsWith(`${id}>`)) {
      orientedImages.delete(key)
    }
  }
})
/** WebP cannot store images with an edge beyond this, so larger ones are kept as PNG */
const maxWebpEdge = 16_383
/** Draws the original into its new orientation pixel-exactly and stores the result losslessly. */
async function createOrientedImage(source: Asset, symmetry: Symmetry): Promise<OrientedImage> {
  if (isIdentitySymmetry(symmetry)) {
    return {
      assetId: source.id,
      thumbnail: await createThumbnailDataUrl(source.bitmap),
    }
  }
  const key = `${source.id}>${symmetry.turns}${symmetry.mirrored ? 'm' : ''}`
  const cached = orientedImages.get(key)
  if (cached && assets.has(cached.assetId)) {
    return cached
  }
  const transform = getPixelTransform(source, symmetry)
  const canvas = createCanvas(transform.width, transform.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas context is unavailable')
  }
  // Quarter turns and mirrors map whole pixels onto whole pixels, so nothing is resampled.
  context.imageSmoothingEnabled = false
  context.setTransform(...transform.matrix)
  context.drawImage(source.bitmap, 0, 0)
  // Chromium encodes WebP at quality 1 losslessly.
  const lossless = Math.max(transform.width, transform.height) <= maxWebpEdge
  const asset = await assets.add(await encodeCanvas(canvas, lossless ? 'webp' : 'png', lossless ? 1 : undefined))
  const image = {
    assetId: asset.id,
    thumbnail: await createThumbnailDataUrl(asset.bitmap),
  }
  orientedImages.set(key, image)
  return image
}

/** orientations chosen for collection entries whose pixels are still being prepared */
export const orientationStore = new Store<{pending: ReadonlyMap<string, Orientation>}>({pending: new Map})
const setPending = (id: string, orientation?: Orientation) => orientationStore.set(state => {
  const pending = new Map(state.pending)
  if (orientation) {
    pending.set(id, orientation)
  } else {
    pending.delete(id)
  }
  return {pending}
})

/** the orientation a collection entry has or is about to have */
export const getShownOrientation = (ingredient: Ingredient) => orientationStore.state.pending.get(ingredient.id) ?? getIngredientOrientation(ingredient)

/**
 * Rotates or flips a collection entry relative to its original image, as one undo step.
 * Every layer that shows the image or keeps it as a revision follows along. The latest choice wins when several are prepared at once.
 */
export async function setIngredientOrientation(id: string, patch: Partial<Orientation>) {
  const epoch = workspaceEpoch
  const ingredient = projectStore.state.ingredients.find(item => item.id === id)
  if (!ingredient) {
    return
  }
  const orientation: Orientation = {
    ...getShownOrientation(ingredient),
    ...patch,
  }
  if (isSameOrientation(orientation, getShownOrientation(ingredient))) {
    return
  }
  const sourceAssetId = getSourceAssetId(ingredient)
  const source = assets.get(sourceAssetId)
  if (!source) {
    throw new Error(`The original image of ![${ingredient.index}] is not loaded.`)
  }
  setPending(id, orientation)
  const release = assets.pin([source.id])
  try {
    const image = await createOrientedImage(source, getSymmetry(orientation))
    if (epoch !== workspaceEpoch || orientationStore.state.pending.get(id) !== orientation) {
      return
    }
    const before = projectStore.state
    projectStore.commit(document => withIngredientOrientation(document, id, sourceAssetId, orientation, image))
    // Content-aware alignment stays on; the new pixels are registered like a newly shown revision.
    for (const layer of projectStore.state.layers) {
      if (!before.layers.includes(layer) && layer.contentAware && !layer.alignment && supportsContentAwareAlignment(layer)) {
        void setContentAwareAlignment(layer.id, true)
      }
    }
  } finally {
    release()
    if (orientationStore.state.pending.get(id) === orientation) {
      setPending(id)
    }
  }
}
