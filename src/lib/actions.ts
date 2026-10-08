import type {Point, Rect} from './geometry.ts'
import type {RatioString} from './ratio.ts'
import type {Ingredient, Layer, ProjectDocument} from './state.ts'
import type {Asset} from './assets.ts'
import type {CommitOptions} from './store/index.ts'

import {createId} from '#src/lib/createId.ts'

import {assets} from './assets.ts'
import {getContentBounds} from './composite.ts'
import {containSize, coverRect, rectCenter, rectFromCenter, sizeFromArea} from './geometry.ts'
import {createThumbnailDataUrl, looksLikeImage, normalizeImportedImage} from './image.ts'
import {getGenerationRegion} from './generationRegion.ts'
import {getModel} from './models/index.ts'
import {getErrorMessage, notify} from './notices.ts'
import {closestRatio, parseRatio} from './ratio.ts'
import {createEmptyDocument, createInitialEditorState, defaultImportedMask, editorStore, projectStore} from './state.ts'
import {fitViewToRect, getViewportCenterWorld} from './viewport.ts'

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '') || name

export const getLayer = (id: string | null) => (id ? projectStore.state.layers.find(layer => layer.id === id) : undefined)

// frame

export const setFrame = (frame: Rect) => {
  editorStore.set({frame})
}

/** Changes the frame ratio while keeping its center and area. */
export const setRatio = (ratio: RatioString) => {
  editorStore.set(state => {
    const {frame} = state
    const size = sizeFromArea(frame.width * frame.height, parseRatio(ratio))
    return {
      ...state,
      ratio,
      frame: rectFromCenter(rectCenter(frame), size),
    }
  })
}

/** Covers the target with the smallest frame of the closest supported ratio. */
export const fitFrameToRect = (target: Rect) => {
  const model = getModel(editorStore.state.modelId)
  const ratio = closestRatio(target.width / target.height, model.aspectRatios)
  editorStore.set({
    ratio,
    frame: coverRect(target, parseRatio(ratio)),
  })
}

export const fitFrameToContent = () => {
  const bounds = getContentBounds(projectStore.state.layers)
  if (!bounds) {
    notify('info', 'There is no visible content to frame yet.')
    return
  }
  fitFrameToRect(bounds)
}

/** Shows the region the next generation uses: the frame, or all artwork while the frame is off. */
export const fitViewToFrame = () => {
  fitViewToRect(getGenerationRegion(editorStore.state, projectStore.state.layers).frame)
}

export const setFrameEnabled = (frameEnabled: boolean) => {
  editorStore.set({frameEnabled})
}

export const fitViewToContent = () => {
  const bounds = getContentBounds(projectStore.state.layers)
  fitViewToRect(bounds ?? editorStore.state.frame)
}

// model settings

export const setModel = (modelId: string) => {
  const model = getModel(modelId)
  editorStore.set(state => ({
    ...state,
    modelId: model.id,
    resolution: model.normalizeResolution(state.resolution) ?? '',
    quality: model.normalizeQuality(state.quality) ?? '',
  }))
  const {ratio} = editorStore.state
  if (!model.supportsRatio(ratio)) {
    setRatio(closestRatio(parseRatio(ratio), model.aspectRatios))
  }
}

export const setResolution = (resolution: string) => {
  editorStore.set({resolution})
}

export const setQuality = (quality: string) => {
  editorStore.set({quality})
}

export const setPrompt = (prompt: string) => {
  editorStore.set({prompt})
}

// layers

export const selectLayer = (id: string | null) => {
  if (editorStore.state.selectedLayerId !== id) {
    editorStore.set({
      selectedLayerId: id,
      ...editorStore.state.tool === 'mask' && (id === null || projectStore.state.layers[0]?.id === id) ? {tool: 'frame' as const} : {},
    })
  }
}

const mapLayers = (document: ProjectDocument, id: string, mapper: (layer: Layer) => Layer): ProjectDocument => ({
  ...document,
  layers: document.layers.map(layer => (layer.id === id ? mapper(layer) : layer)),
})

export const updateLayer = (id: string, patch: Partial<Pick<Layer, 'area' | 'feather' | 'featherAllEdges' | 'name' | 'offsetX' | 'offsetY' | 'rect' | 'rotation' | 'roundness' | 'visible'>>, options: CommitOptions = {}) => {
  const layer = getLayer(id)
  if (!layer) {
    return
  }
  if ((patch.rect || patch.rotation !== undefined) && layer.kind === 'generated') {
    // Generated layers are pinned to the frame they were generated in.
    return
  }
  if (patch.rect && (!Object.values(patch.rect).every(Number.isFinite) || patch.rect.width <= 0 || patch.rect.height <= 0)) {
    return
  }
  for (const key of ['area', 'feather', 'roundness'] as const) {
    if (!(patch[key] !== undefined)) {
      continue
    }
    if (!Number.isFinite(patch[key])) {
      return
    } patch[key] = Math.min(1, Math.max(0, patch[key]))
  }
  for (const key of ['offsetX', 'offsetY'] as const) {
    if (!(patch[key] !== undefined)) {
      continue
    }
    if (!Number.isFinite(patch[key])) {
      return
    } patch[key] = Math.min(1, Math.max(-1, patch[key]))
  }
  if (patch.rotation !== undefined) {
    if (!Number.isFinite(patch.rotation)) {
      return
    } patch.rotation = ((patch.rotation + 180) % 360 + 360) % 360 - 180
  }
  projectStore.commit(document => mapLayers(document, id, current => ({
    ...current,
    ...patch,
  })), options)
}

export const removeLayer = (id: string) => {
  projectStore.commit(document => ({
    ...document,
    layers: document.layers.filter(layer => layer.id !== id),
  }))
  if (editorStore.state.selectedLayerId === id) {
    selectLayer(null)
  }
}

export const moveLayerInStack = (id: string, direction: -1 | 1) => {
  projectStore.commit(document => {
    const index = document.layers.findIndex(layer => layer.id === id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= document.layers.length) {
      return document
    }
    const layers = [...document.layers]
    const [layer] = layers.splice(index, 1)
    layers.splice(target, 0, layer)
    return {
      ...document,
      layers,
    }
  })
}

/** Adds a layer, and its collection entry when the layer’s image is not in the collection yet, as one undo step. */
export const addLayer = (layer: Layer, ingredient?: Ingredient) => {
  projectStore.commit(document => withIngredient({
    ...document,
    layers: [...document.layers, layer],
  }, ingredient))
}

const importOffset = 32

/**
 * Where a new canvas image goes.
 * The very first image defines the world scale: it is placed at its natural size.
 * Later images are centered on the given point (or the frame) and scaled down to fit into the frame if they are larger.
 */
export const getPlacementRect = (size: {
  height: number
  width: number
}, worldPoint?: Point, offset = 0): Rect => {
  if (projectStore.state.layers.length === 0) {
    return worldPoint ? rectFromCenter(worldPoint, size) : {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    }
  }
  const {frame} = editorStore.state
  const fits = size.width <= frame.width && size.height <= frame.height
  const fitted = fits ? size : containSize(frame, size.width / size.height)
  const center = worldPoint ?? rectCenter(frame)
  return rectFromCenter({
    x: center.x + offset,
    y: center.y + offset,
  }, fitted)
}

/** Adds dropped or pasted images as canvas layers. Each one also becomes a numbered collection item. */
export const importLayers = async (files: ReadonlyArray<File>, worldPoint?: Point) => {
  const epoch = workspaceEpoch
  const images = files.filter(looksLikeImage)
  if (images.length < files.length) {
    notify('error', `Skipped ${files.length - images.length} file${files.length - images.length === 1 ? '' : 's'} that are not images.`)
  }
  let offset = 0
  for (const file of images) {
    try {
      const {blob, decoded} = await normalizeImportedImage(file)
      if (epoch !== workspaceEpoch) {
        decoded.bitmap.close(); return []
      }
      const asset = await assets.add(blob, decoded)
      const name = stripExtension(file.name || 'Pasted image')
      const ingredient = await createIngredient(asset, name, 'import')
      if (epoch !== workspaceEpoch) {
        return []
      }
      const isFirst = projectStore.state.layers.length === 0
      const rect = getPlacementRect(asset, isFirst ? undefined : worldPoint, isFirst ? 0 : offset)
      if (!isFirst) {
        offset += importOffset
      }
      const layer: Layer = {
        ...defaultImportedMask,
        id: createId(),
        kind: 'import',
        name,
        assetId: asset.id,
        rect,
        visible: true,
        createdAt: Date.now(),
      }
      addLayer(layer, ingredient)
      if (isFirst) {
        fitFrameToRect(rect)
        fitViewToRect(editorStore.state.frame)
      }
    } catch (error) {
      notify('error', `Could not import ${file.name || 'image'}: ${getErrorMessage(error)}`)
    }
  }
}

// ingredients

let ingredientSequence = 1
export const getNextIngredientIndex = (ingredients: ReadonlyArray<Ingredient>) => {
  ingredientSequence = Math.max(ingredientSequence, projectStore.state.nextIngredientIndex ?? 1, Math.max(0, ...ingredients.map(ingredient => ingredient.index)) + 1)
  return ingredientSequence++
}

/** Builds a numbered collection entry. The number is reserved immediately, so it is never handed out twice. */
export const createIngredient = async (asset: Asset, name: string, kind: NonNullable<Ingredient['kind']>): Promise<Ingredient> => {
  const index = getNextIngredientIndex(projectStore.state.ingredients)
  return {
    id: createId(),
    index,
    assetId: asset.id,
    name,
    kind,
    thumbnail: await createThumbnailDataUrl(asset.bitmap),
    createdAt: Date.now(),
  }
}

/** Adds the entry unless the collection already holds its image. */
export const withIngredient = (document: ProjectDocument, ingredient?: Ingredient): ProjectDocument => {
  if (!ingredient || document.ingredients.some(item => item.assetId === ingredient.assetId || item.index === ingredient.index)) {
    return document
  }
  return {
    ...document,
    nextIngredientIndex: Math.max(document.nextIngredientIndex ?? 1, ingredient.index + 1),
    ingredients: [...document.ingredients, ingredient],
  }
}

/** Older projects only numbered images once they were referenced. They get a number for every layer image once; thumbnails are filled in later. */
export const withLayerIngredients = (document: ProjectDocument): ProjectDocument => {
  if (document.layersNumbered) {
    return document
  }
  const known = new Set(document.ingredients.map(item => item.assetId))
  let next = Math.max(document.nextIngredientIndex ?? 1, ...document.ingredients.map(item => item.index + 1))
  const added: Array<Ingredient> = []
  for (const layer of document.layers) {
    if (known.has(layer.assetId)) {
      continue
    }
    known.add(layer.assetId)
    added.push({
      id: createId(),
      index: next++,
      assetId: layer.assetId,
      name: layer.name,
      kind: layer.kind,
      thumbnail: '',
      createdAt: layer.createdAt,
    })
  }
  return {
    ...document,
    ingredients: [...document.ingredients, ...added],
    layersNumbered: true,
    nextIngredientIndex: next,
  }
}

export const addIngredients = async (files: ReadonlyArray<File>) => {
  const epoch = workspaceEpoch
  const images = files.filter(looksLikeImage)
  if (images.length < files.length) {
    notify('error', 'Only images can be used as prompt ingredients.')
  }
  const added: Array<Ingredient> = []
  for (const file of images) {
    try {
      const {blob, decoded} = await normalizeImportedImage(file)
      if (epoch !== workspaceEpoch) {
        decoded.bitmap.close(); return []
      }
      const asset = await assets.add(blob, decoded)
      const ingredient = await createIngredient(asset, stripExtension(file.name || 'Pasted image'), 'import')
      if (epoch !== workspaceEpoch) {
        return []
      }
      projectStore.commit(document => withIngredient(document, ingredient))
      added.push(ingredient)
    } catch (error) {
      notify('error', `Could not add ${file.name || 'image'}: ${getErrorMessage(error)}`)
    }
  }
  return added
}

export const removeIngredient = (id: string) => {
  projectStore.commit(document => ({
    ...document,
    ingredients: document.ingredients.filter(ingredient => ingredient.id !== id),
  }))
}

// history and project

export const undo = () => projectStore.undo()

export const redo = () => projectStore.redo()

export let workspaceEpoch = 0
export const advanceWorkspaceEpoch = () => {
  workspaceEpoch++
}
export const resetProject = () => {
  advanceWorkspaceEpoch()
  ingredientSequence = 1
  for (const job of editorStore.state.jobs) {
    job.controller.abort()
  }
  projectStore.reset(createEmptyDocument())
  const initial = createInitialEditorState()
  editorStore.set(state => ({
    ...initial,
    prompt: '',
    demoMode: state.demoMode,
    modelId: state.modelId,
    resolution: state.resolution,
    quality: state.quality,
    ratio: state.ratio,
    frameEnabled: state.frameEnabled,
    frame: rectFromCenter({
      x: 512,
      y: 512,
    }, sizeFromArea(1024 * 1024, parseRatio(state.ratio))),
    sessionCost: state.sessionCost,
  }))
  fitViewToFrame()
}

export const getDropWorldPoint = () => getViewportCenterWorld()
