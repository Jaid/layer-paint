import type {Rect} from './geometry.ts'
import type {MaskSettings} from './mask.ts'
import type {RatioString} from './ratio.ts'
import queryParameters from '#src/queryParameters.ts'
import {rectFromCenter, sizeFromArea} from './geometry.ts'
import {getModel} from './models/index.ts'
import {closestRatio, isRatioString, parseRatio} from './ratio.ts'
import {HistoryStore, Store} from './store/index.ts'

export type LayerKind = 'generated' | 'import'

export type GenerationEvidence = {
  id: string
  capturedAt: number
  frame: Rect
  modelId: string
  ratio: string
  resolution: string
  quality: string
  prompt: string
  compiledPrompt: string
  canvasAssetId?: string
  referenceAssetIds: string[]
  outputAssetId: string
  cost?: number
  demo?: boolean
}

export type Layer = MaskSettings & {
  rotation?: number
  evidence?: GenerationEvidence
  /** set when a generated result was automatically registered because the model shifted or zoomed the content */
  aligned?: boolean
  assetId: string
  createdAt: number
  id: string
  kind: LayerKind
  /** generation metadata */
  modelId?: string
  name: string
  prompt?: string
  /** placement in world units */
  rect: Rect
  visible: boolean
}

export type Ingredient = {
  kind?: 'import' | 'snapshot' | 'generated'
  assetId: string
  createdAt: number
  id: string
  /** stable number used in prompt references like ![1] */
  index: number
  name: string
  /** small WebP data URL for editor hovers */
  thumbnail: string
}

/** everything that participates in undo/redo */
export type ProjectDocument = {
  nextIngredientIndex?: number
  ingredients: ReadonlyArray<Ingredient>
  /** bottom to top; the first layer is the background layer */
  layers: ReadonlyArray<Layer>
}

export type View = {
  scale: number
  /** screen offset of the world origin in CSS pixels */
  x: number
  y: number
}

export type JobStatus = 'failed' | 'running'

export type Job = {
  controller: AbortController
  error?: string
  id: string
  modelId: string
  prompt: string
  rect: Rect
  startedAt: number
  status: JobStatus
}

export type Notice = {
  id: string
  kind: 'error' | 'info' | 'success'
  text: string
}

export type EditorState = {
  tool: 'frame' | 'image' | 'mask'
  hoveredLayerId: string | null
  generationHover: boolean
  demoMode: boolean
  alignOutput: boolean
  exportMode: 'detail' | 'canvas' | 'custom'
  exportScale: number
  frame: Rect
  jobs: ReadonlyArray<Job>
  layersPanelOpen: boolean
  modelId: string
  notices: ReadonlyArray<Notice>
  prompt: string
  quality: string
  ratio: RatioString
  resolution: string
  selectedLayerId: string | null
  /** USD spent in this browser session */
  sessionCost: number
  view: View
}

export const defaultFrameArea = 1024 * 1024

export const createFrame = (ratio: RatioString, center = {x: 0, y: 0}, area = defaultFrameArea): Rect => rectFromCenter(center, sizeFromArea(area, parseRatio(ratio)))

const initialModel = getModel(queryParameters.model)

const resolveInitialRatio = (): RatioString => {
  const requested = queryParameters.ratio
  if (isRatioString(requested) && initialModel.supportsRatio(requested)) {
    return requested
  }
  const aspect = isRatioString(requested) ? parseRatio(requested) : 1
  return closestRatio(aspect, initialModel.aspectRatios)
}

const initialRatio = resolveInitialRatio()

export const createInitialEditorState = (): EditorState => ({
  tool: 'frame', hoveredLayerId: null, generationHover: false,
  demoMode: false, alignOutput: queryParameters.align, exportMode: 'detail', exportScale: 1,
  frame: createFrame(initialRatio, {x: 512, y: 512}),
  jobs: [],
  // On small screens the panel would cover the frame, so it starts collapsed there.
  layersPanelOpen: typeof innerWidth === 'undefined' || innerWidth >= 900,
  modelId: initialModel.id,
  notices: [],
  prompt: queryParameters.prompt,
  quality: initialModel.normalizeQuality(queryParameters.quality) ?? '',
  ratio: initialRatio,
  resolution: initialModel.normalizeResolution(queryParameters.resolution) ?? '',
  selectedLayerId: null,
  sessionCost: 0,
  view: {x: 0, y: 0, scale: 0.5},
})

export const createEmptyDocument = (): ProjectDocument => ({layers: [], ingredients: [], nextIngredientIndex: 1})

export const defaultGeneratedMask: MaskSettings = {
  area: queryParameters.area,
  feather: queryParameters.feather,
}

export const defaultImportedMask: MaskSettings = {area: 1, feather: 0}

export const projectStore = new HistoryStore<ProjectDocument>(createEmptyDocument())

export const editorStore = new Store<EditorState>(createInitialEditorState())

export const getActiveModel = () => getModel(editorStore.state.modelId)
