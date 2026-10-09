import type {Asset} from './assets.ts'
import type {Rect} from './geometry.ts'
import type {ImageModel} from './models/index.ts'
import type {RatioString} from './ratio.ts'
import type {GenerationEvidence, Job, Layer} from './state.ts'

import {createIngredient, getLayer, withIngredient, workspaceEpoch} from './actions.ts'
import {apiKeyStore, getApiKey, hasApiKey, refreshApiStatus, requestApiKey} from './apiKey.ts'
import {assets} from './assets.ts'
import {frameHasContent, getUpstreamCanvasSize, renderRegion} from './composite.ts'
import {setContentAwareAlignment, supportsContentAwareAlignment} from './contentAware.ts'
import {createId} from './createId.ts'
import {createDemoImage} from './demo.ts'
import {blobToDataUrl, encodeCanvas, prepareUpstreamImage} from './image.ts'
import {parseImageResult, readBoundedBody, validateImageRequest} from './imageApi.ts'
import {emptyAreaThreshold, getGenerationRegion} from './generationRegion.ts'
import {getModel} from './models/index.ts'
import {getErrorMessage, notify} from './notices.ts'
import {compilePrompt, findReferences} from './prompt.ts'
import {closestRatio} from './ratio.ts'
import {getRevisions, withAddedRevision} from './revisions.ts'
import {defaultGeneratedMask, editorStore, projectStore} from './state.ts'

export const emptyCanvasColor = '#808080'
export type GenerationOverrides = {
  frame?: Rect
  prompt?: string
}
export const renderFrameInput = (frame: Rect = editorStore.state.frame, maxSide?: number) => renderRegion({
  background: emptyCanvasColor,
  layers: projectStore.state.layers,
  region: frame,
  size: getUpstreamCanvasSize(frame, maxSide, maxSide === undefined ? undefined : Math.min(1024, maxSide)),
})
export function prepareGeneration(overrides: GenerationOverrides = {}) {
  const document = projectStore.state; const model = getModel(editorStore.state.modelId)
  // An explicit frame (a retry) keeps its geometry; otherwise the frame, or all artwork while the frame is off, decides.
  const region = overrides.frame ? {
    frame: overrides.frame,
    ratio: closestRatio(overrides.frame.width / overrides.frame.height, model.aspectRatios),
  } : getGenerationRegion(editorStore.state, document.layers)
  const editor = {
    ...editorStore.state,
    ...overrides,
    frame: {...region.frame},
    ratio: region.ratio,
  }
  const mightHaveContent = frameHasContent(document.layers, editor.frame)
  const sample = mightHaveContent || findReferences(editor.prompt).some(token => token.index === 0) ? renderFrameInput(editor.frame) : undefined
  const hasCanvasContent = mightHaveContent && sample !== undefined && sample.emptyFraction < 1
  const compiled = compilePrompt({
    text: editor.prompt,
    hasCanvasContent,
    canvasHasEmptyAreas: Boolean(sample && sample.emptyFraction > emptyAreaThreshold),
    ingredientIndices: document.ingredients.map(item => item.index),
    maxReferences: model.maxReferences,
  })
  return {
    compiled,
    model,
    rendered: hasCanvasContent ? sample : undefined,
    editor,
    document,
  }
}
export const dismissJob = (id: string) => {
  editorStore.state.jobs.find(job => job.id === id)?.controller.abort()
  editorStore.set(state => ({
    ...state,
    jobs: state.jobs.filter(job => job.id !== id),
  }))
}

/** everything a request needs, captured before anything is encoded or sent */
type GenerationTask = {
  /** the canvas inside the frame, freshly rendered or – for rerolls – the exact image the first shot was sent */
  canvas?: {
    assetId: string
  } | {
    canvas: OffscreenCanvas
  }
  capturedAt: number
  compiledPrompt: string
  demoMode: boolean
  epoch: number
  frame: Rect
  /** the generated layer that receives the result as a new revision */
  layerId?: string
  model: ImageModel
  prompt: string
  quality: string
  ratio: RatioString
  /** referenced collection images in prompt order */
  referenceAssetIds: ReadonlyArray<string>
  resolution: string
  /** distinguishes the procedural demo images of rerolls */
  variation?: number
}

/** Checks credentials and concurrency; resolves false when the request must not be sent. */
const ensureDispatchable = async (task: GenerationTask) => {
  if (!apiKeyStore.state.checked && !task.demoMode) {
    await refreshApiStatus()
  }
  if (task.epoch !== workspaceEpoch) {
    return false
  }
  if (!task.demoMode && !hasApiKey()) {
    requestApiKey(); notify('info', 'Configure the local server or enter a browser-session key. Demo mode does not need a key.'); return false
  }
  if (editorStore.state.jobs.filter(job => job.status === 'running').length >= 2) {
    notify('info', 'Two generations are already running.'); return false
  }
  return true
}

/** Snapshot first, encode second, send last. Store mutations during a request cannot change its inputs or placement. */
export async function generate(overrides: GenerationOverrides = {}) {
  const epoch = workspaceEpoch; const capturedAt = Date.now()
  let prepared: ReturnType<typeof prepareGeneration>
  try {
    prepared = prepareGeneration(overrides)
  } catch (error) {
    notify('error', getErrorMessage(error)); return
  }
  if (prepared.compiled.errors.length) {
    notify('error', prepared.compiled.errors.join(' ')); return
  }
  const {editor, document, compiled, rendered, model} = prepared
  const referenceAssetIds: Array<string> = []
  for (const source of compiled.sources) {
    if (source.kind !== 'ingredient') {
      continue
    }
    const ingredient = document.ingredients.find(item => item.index === source.index)
    if (!ingredient) {
      notify('error', 'A prompt ingredient is missing.'); return
    }
    referenceAssetIds.push(ingredient.assetId)
  }
  await runGeneration({
    epoch,
    capturedAt,
    model,
    demoMode: editor.demoMode,
    frame: editor.frame,
    ratio: editor.ratio,
    resolution: editor.resolution,
    quality: editor.quality,
    prompt: editor.prompt,
    compiledPrompt: compiled.text,
    canvas: rendered ? {canvas: rendered.canvas} : undefined,
    referenceAssetIds,
  })
}

/**
 * Sends the request of a generated layer again: the same prompt and the very same input images, but the currently selected model and model settings.
 * The result becomes a further revision of that layer.
 */
export async function reroll(layerId: string) {
  const epoch = workspaceEpoch; const capturedAt = Date.now()
  const layer = getLayer(layerId)
  const evidence = layer?.evidence
  if (!layer || layer.kind !== 'generated' || !evidence) {
    notify('error', 'Only generations can be rerolled.'); return
  }
  const model = getModel(editorStore.state.modelId)
  const inputIds = [...evidence.canvasAssetId ? [evidence.canvasAssetId] : [], ...evidence.referenceAssetIds]
  if (inputIds.some(id => !assets.has(id))) {
    notify('error', 'The captured input images of this generation are unavailable.'); return
  }
  if (inputIds.length > model.maxReferences) {
    notify('error', `${model.title} accepts at most ${model.maxReferences} input images, but this generation used ${inputIds.length}. Choose another model to reroll it.`); return
  }
  const {demoMode, resolution, quality} = editorStore.state
  await runGeneration({
    epoch,
    capturedAt,
    model,
    demoMode,
    frame: {...layer.rect},
    ratio: closestRatio(layer.rect.width / layer.rect.height, model.aspectRatios),
    resolution: model.normalizeResolution(resolution) ?? '',
    quality: model.normalizeQuality(quality) ?? '',
    prompt: evidence.prompt,
    compiledPrompt: evidence.compiledPrompt,
    canvas: evidence.canvasAssetId ? {assetId: evidence.canvasAssetId} : undefined,
    referenceAssetIds: evidence.referenceAssetIds,
    layerId,
    variation: getRevisions(layer).length,
  })
}

async function runGeneration(task: GenerationTask) {
  const {model, epoch} = task
  if (!await ensureDispatchable(task)) {
    return
  }
  const job: Job = {
    id: createId(),
    controller: new AbortController,
    modelId: model.id,
    prompt: task.prompt,
    rect: {...task.frame},
    startedAt: Date.now(),
    status: 'running',
    ...task.layerId ? {layerId: task.layerId} : {},
  }
  const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(240_000)])
  editorStore.set(state => ({
    ...state,
    jobs: [...state.jobs, job],
  }))
  const releases: Array<() => void> = []
  let cost: number | undefined
  const current = () => epoch === workspaceEpoch && !job.controller.signal.aborted
  try {
    const ingredientAssets = task.referenceAssetIds.map(id => assets.require(id))
    const capturedCanvas = task.canvas && 'assetId' in task.canvas ? assets.require(task.canvas.assetId) : undefined
    releases.push(assets.pin([...ingredientAssets.map(asset => asset.id), ...capturedCanvas ? [capturedCanvas.id] : []]))
    let canvasAsset: Asset | undefined
    const referenceAssetIds: Array<string> = []; const input_references: Array<{
      image_url: {url: string}
      type: 'image_url'
    }> = []
    if (task.canvas) {
      canvasAsset = 'canvas' in task.canvas ? await assets.add(await encodeCanvas(task.canvas.canvas, 'webp', 0.98)) : capturedCanvas!
      releases.push(assets.pin([canvasAsset.id]))
      input_references.push({
        type: 'image_url',
        image_url: {url: await blobToDataUrl(canvasAsset.blob)},
      })
    }
    for (const source of ingredientAssets) {
      const image = await prepareUpstreamImage(source.blob, source)
      const sent = image.blob === source.blob ? source : await assets.add(image.blob)
      releases.push(assets.pin([sent.id]))
      referenceAssetIds.push(sent.id)
      input_references.push({
        type: 'image_url',
        image_url: {url: image.dataUrl},
      })
    }
    signal.throwIfAborted()
    const request = validateImageRequest({
      model: model.id,
      prompt: task.compiledPrompt,
      aspect_ratio: task.ratio,
      ...model.getRequestOptions({
        resolution: task.resolution,
        quality: task.quality,
      }),
      input_references,
    })
    let blob: Blob
    if (task.demoMode) {
      const source = task.canvas && 'canvas' in task.canvas ? task.canvas.canvas : canvasAsset?.bitmap
      blob = await createDemoImage(task.prompt, job.rect.width / job.rect.height, source, signal, task.variation)
    } else {
      const key = getApiKey(); const useGateway = !key && apiKeyStore.state.serverConfigured
      const response = await fetch(useGateway ? '/api/generate' : 'https://openrouter.ai/api/v1/images', {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...useGateway ? {'X-LayerPaint-Token': apiKeyStore.state.csrfToken} : {Authorization: `Bearer ${key}`},
        },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        await response.body?.cancel(); throw new Error(`Image API request failed (HTTP ${response.status}). Check your key, credit balance and selected model. No layer was added.`)
      }
      const bytes = await readBoundedBody(response, 64_000_000, signal)
      const result = parseImageResult(JSON.parse((new TextDecoder).decode(bytes)))
      cost = result.usage.cost
      blob = new Blob([Uint8Array.fromBase64(result.data[0].b64_json)], {type: result.data[0].media_type})
    }
    signal.throwIfAborted()
    if (!current()) {
      return
    }
    const raw = await assets.add(blob)
    releases.push(assets.pin([raw.id]))
    const actualAspect = raw.width / raw.height; const requestedAspect = job.rect.width / job.rect.height
    if (Math.abs(Math.log(actualAspect / requestedAspect)) > 0.02) {
      notify('info', 'The provider returned a different aspect ratio. It is fitted into the captured frame; the raw output remains in the project.')
    }
    const name = `${task.demoMode ? 'Demo · ' : ''}${task.prompt.trim().split('\n')[0].slice(0, 72)}`
    const ingredient = await createIngredient(raw, name, 'generated')
    if (!current()) {
      return
    }
    const evidence: GenerationEvidence = {
      id: job.id,
      capturedAt: task.capturedAt,
      frame: job.rect,
      modelId: model.id,
      ratio: task.ratio,
      resolution: task.resolution,
      quality: task.quality,
      prompt: task.prompt,
      compiledPrompt: task.compiledPrompt,
      canvasAssetId: canvasAsset?.id,
      referenceAssetIds,
      outputAssetId: raw.id,
      cost,
      demo: task.demoMode,
    }
    const layer: Layer = {
      ...defaultGeneratedMask,
      id: createId(),
      assetId: raw.id,
      kind: 'generated',
      name,
      rect: job.rect,
      visible: true,
      createdAt: Date.now(),
      modelId: model.id,
      prompt: task.prompt,
      evidence,
    }
    // A reroll whose layer was deleted in the meantime still lands, as a layer of its own.
    const target = task.layerId ? getLayer(task.layerId) : undefined
    projectStore.commit(state => withIngredient({
      ...state,
      layers: target ? state.layers.map(item => (item.id === target.id ? withAddedRevision(item, {
        assetId: raw.id,
        evidence,
        modelId: model.id,
      }) : item)) : [...state.layers, layer],
    }, ingredient))
    editorStore.set(state => ({
      ...state,
      jobs: state.jobs.filter(item => item.id !== job.id),
    }))
    const updated = target && getLayer(target.id)
    if (updated?.contentAware && supportsContentAwareAlignment(updated)) {
      void setContentAwareAlignment(updated.id, true)
    }
  } catch (error) {
    if (!current()) {
      editorStore.set(state => ({
        ...state,
        jobs: state.jobs.filter(item => item.id !== job.id),
      }))
    } else {
      editorStore.set(state => ({
        ...state,
        jobs: state.jobs.map(item => (item.id === job.id ? {
          ...item,
          status: 'failed' as const,
          error: signal.aborted ? 'Generation timed out. No layer was added.' : getErrorMessage(error),
        } : item)),
      }))
    }
  } finally {
    for (const release of releases) {
      release()
    }
    if (cost !== undefined) {
      const billed = cost; editorStore.set(state => ({
        ...state,
        sessionCost: state.sessionCost + billed,
      }))
    }
  }
}
