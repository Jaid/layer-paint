import type {Adjustments} from './adjustments/index.ts'
import type {Placement} from './alignment/align.ts'
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
  canvasAssetId?: string
  capturedAt: number
  compiledPrompt: string
  cost?: number
  demo?: boolean
  frame: Rect
  id: string
  modelId: string
  outputAssetId: string
  prompt: string
  quality: string
  ratio: string
  referenceAssetIds: Array<string>
  resolution: string
}

/** cached registration of a generated output against its captured canvas input */
export type LayerAlignment = Placement & {
  /** whether the registration is reliable enough to move the content; otherwise the layer stays in place */
  applied: boolean
}

/** one shot of a generation request; rerolls add further revisions with the same prompt and input images */
export type GenerationRevision = {
  alignment?: LayerAlignment
  assetId: string
  evidence: GenerationEvidence
  modelId?: string
}

export type Layer = MaskSettings & {
  /** color adjustments, applied non-destructively by the compositor */
  adjustments?: Adjustments
  /** computed once on demand and kept, so toggling content-aware alignment is instant */
  alignment?: LayerAlignment
  assetId: string
  /** whether a generated layer’s content is registered onto the canvas it was generated from */
  contentAware?: boolean
  createdAt: number
  evidence?: GenerationEvidence
  id: string
  kind: LayerKind
  /** generation metadata */
  modelId?: string
  name: string
  /** 0–1, fully opaque when absent */
  opacity?: number
  prompt?: string
  /** placement in world units */
  rect: Rect
  /** index of the shown revision in `revisions` */
  revision?: number
  /**
   * every shot of this generation in creation order, present once it was rerolled
   *
   * The top-level assetId, evidence, modelId and alignment always describe the shown revision; its slot in this list may lag behind and is refreshed on every switch.
   */
  revisions?: ReadonlyArray<GenerationRevision>
  rotation?: number
  visible: boolean
}

export type Ingredient = {
  assetId: string
  createdAt: number
  id: string
  /** stable number used in prompt references like ![1] */
  index: number
  kind?: 'generated' | 'import' | 'snapshot'
  name: string
  /** small WebP data URL for editor hovers */
  thumbnail: string
}

/** everything that participates in undo/redo */
export type ProjectDocument = {
  ingredients: ReadonlyArray<Ingredient>
  /** bottom to top; the first layer is the background layer */
  layers: ReadonlyArray<Layer>
  /** set once every layer image has a collection number; older projects are migrated a single time, so removals stick */
  layersNumbered?: boolean
  nextIngredientIndex?: number
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
  /** the generated layer this job adds a revision to, for rerolls */
  layerId?: string
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
  demoMode: boolean
  exportMode: 'canvas' | 'custom' | 'detail'
  exportScale: number
  frame: Rect
  /** When off, generations span all canvas content, covered by the closest supported ratio. */
  frameEnabled: boolean
  generationHover: boolean
  /** collection number of the hovered collection tile; 0 is the live frame view */
  hoveredCollectionIndex: number | null
  hoveredLayerId: string | null
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
  tool: 'frame' | 'image' | 'mask'
  view: View
}

export const defaultFrameArea = 1024 * 1024

export const createFrame = (ratio: RatioString, center = {
  x: 0,
  y: 0,
}, area = defaultFrameArea): Rect => rectFromCenter(center, sizeFromArea(area, parseRatio(ratio)))

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
  tool: 'frame',
  hoveredLayerId: null,
  hoveredCollectionIndex: null,
  generationHover: false,
  demoMode: false,
  exportMode: 'detail',
  exportScale: 1,
  frame: createFrame(initialRatio, {
    x: 512,
    y: 512,
  }),
  frameEnabled: true,
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
  view: {
    x: 0,
    y: 0,
    scale: 0.5,
  },
})

export const createEmptyDocument = (): ProjectDocument => ({
  layers: [],
  ingredients: [],
  layersNumbered: true,
  nextIngredientIndex: 1,
})

export const defaultGeneratedMask: MaskSettings = {
  area: queryParameters.area,
  feather: queryParameters.feather,
}

export const defaultImportedMask: MaskSettings = {
  area: 1,
  feather: 0,
}

export const projectStore = new HistoryStore<ProjectDocument>(createEmptyDocument())

export const editorStore = new Store<EditorState>(createInitialEditorState())

export const getActiveModel = () => getModel(editorStore.state.modelId)
