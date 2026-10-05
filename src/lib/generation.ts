import type {Rect} from './geometry.ts'
import type {GenerationEvidence, Job, Layer} from './state.ts'

import {selectLayer, workspaceEpoch} from './actions.ts'
import {registerOutput} from './alignment/index.ts'
import {apiKeyStore, getApiKey, hasApiKey, refreshApiStatus, requestApiKey} from './apiKey.ts'
import {assets} from './assets.ts'
import {frameHasContent, getUpstreamCanvasSize, renderRegion} from './composite.ts'
import {createId} from './createId.ts'
import {createDemoImage} from './demo.ts'
import {blobToDataUrl, createCanvas, encodeCanvas, getContext, prepareUpstreamImage} from './image.ts'
import {parseImageResult, readBoundedBody, validateImageRequest} from './imageApi.ts'
import {getModel} from './models/index.ts'
import {getErrorMessage, notify} from './notices.ts'
import {compilePrompt, findReferences} from './prompt.ts'
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
  const editor = {
    ...editorStore.state,
    ...overrides,
  }; const document = projectStore.state; const model = getModel(editor.modelId)
  const mightHaveContent = frameHasContent(document.layers, editor.frame)
  const sample = mightHaveContent || findReferences(editor.prompt).some(token => token.index === 0) ? renderFrameInput(editor.frame) : undefined
  const hasCanvasContent = mightHaveContent && sample !== undefined && sample.emptyFraction < 1
  const compiled = compilePrompt({
    text: editor.prompt,
    hasCanvasContent,
    canvasHasEmptyAreas: Boolean(sample && sample.emptyFraction > 0.004),
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
  if (!apiKeyStore.state.checked && !editor.demoMode) {
    await refreshApiStatus()
  }
  if (epoch !== workspaceEpoch) {
    return
  }
  if (!editor.demoMode && !hasApiKey()) {
    requestApiKey(); notify('info', 'Configure the local server or enter a browser-session key. Demo mode does not need a key.'); return
  }
  if (editorStore.state.jobs.filter(job => job.status === 'running').length >= 2) {
    notify('info', 'Two generations are already running.'); return
  }
  const job: Job = {
    id: createId(),
    controller: new AbortController,
    modelId: model.id,
    prompt: editor.prompt,
    rect: {...editor.frame},
    startedAt: Date.now(),
    status: 'running',
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
    const ingredientAssets = compiled.sources.flatMap(source => {
      if (source.kind !== 'ingredient') {
        return []
      }
      const ingredient = document.ingredients.find(item => item.index === source.index)
      if (!ingredient) {
        throw new Error('A prompt ingredient is missing.')
      }
      return [assets.require(ingredient.assetId)]
    })
    releases.push(assets.pin(ingredientAssets.map(asset => asset.id)))
    let canvasAssetId: string | undefined
    const referenceAssetIds: Array<string> = []; const input_references: Array<{
      image_url: {url: string}
      type: 'image_url'
    }> = []
    if (rendered) {
      const blob = await encodeCanvas(rendered.canvas, 'webp', 0.98)
      const asset = await assets.add(blob)
      canvasAssetId = asset.id
      releases.push(assets.pin([asset.id]))
      input_references.push({
        type: 'image_url',
        image_url: {url: await blobToDataUrl(blob)},
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
      prompt: compiled.text,
      aspect_ratio: editor.ratio,
      ...model.getRequestOptions({
        resolution: editor.resolution,
        quality: editor.quality,
      }),
      input_references,
    })
    let blob: Blob
    if (editor.demoMode) {
      blob = await createDemoImage(editor.prompt, job.rect.width / job.rect.height, rendered?.canvas, signal)
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
    let output = raw; let aligned = false
    const actualAspect = raw.width / raw.height; const requestedAspect = job.rect.width / job.rect.height
    if (Math.abs(Math.log(actualAspect / requestedAspect)) > 0.02) {
      notify('info', 'The provider returned a different aspect ratio. It is fitted into the captured frame; the raw output remains in the project.')
    }
    if (editor.alignOutput && rendered && rendered.emptyFraction < 0.5 && !editor.demoMode) {
      try {
        const registration = await registerOutput(rendered.canvas, raw.bitmap, requestedAspect)
        if (registration.applied) {
          const canvas = createCanvas(raw.width, raw.height); const ctx = getContext(canvas); const p = registration.placement
          ctx.drawImage(rendered.canvas, 0, 0, canvas.width, canvas.height)
          ctx.drawImage(raw.bitmap, p.x * canvas.width, p.y * canvas.height, p.scale * canvas.width, p.scale * canvas.height)
          output = await assets.add(await encodeCanvas(canvas, 'png'))
          aligned = true
          notify('info', 'Experimental drift correction was applied. The original output is retained in the request capture.')
        }
      } catch {
        notify('info', 'Drift correction was unavailable. The original result was kept.')
      }
    }
    if (!current()) {
      return
    }
    const evidence: GenerationEvidence = {
      id: job.id,
      capturedAt,
      frame: job.rect,
      modelId: model.id,
      ratio: editor.ratio,
      resolution: editor.resolution,
      quality: editor.quality,
      prompt: editor.prompt,
      compiledPrompt: compiled.text,
      canvasAssetId,
      referenceAssetIds,
      outputAssetId: raw.id,
      cost,
      demo: editor.demoMode,
    }
    const layer: Layer = {
      ...defaultGeneratedMask,
      id: createId(),
      assetId: output.id,
      kind: 'generated',
      name: `${editor.demoMode ? 'Demo · ' : ''}${editor.prompt.trim().split('\n')[0].slice(0, 72)}`,
      rect: job.rect,
      visible: true,
      createdAt: Date.now(),
      modelId: model.id,
      prompt: editor.prompt,
      aligned,
      evidence,
    }
    projectStore.commit(state => ({
      ...state,
      layers: [...state.layers, layer],
    }))
    editorStore.set(state => ({
      ...state,
      jobs: state.jobs.filter(item => item.id !== job.id),
    }))
    selectLayer(layer.id)
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
