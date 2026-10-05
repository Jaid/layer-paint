import {findModel} from './models/index.ts'

export type ImageRequest = {
  model: string
  prompt: string
  aspect_ratio: string
  resolution?: string
  quality?: string
  n: 1
  input_references: Array<{type: 'image_url'; image_url: {url: string}}>
}
export type ImageResult = {data: Array<{b64_json: string; media_type: string}>; usage: {cost?: number}; created?: number}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const imageDataPattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** Rebuild an allowlisted Image API request. Never forward arbitrary client provider options or remote URLs. */
export function validateImageRequest(value: unknown): ImageRequest {
  if (!record(value) || typeof value.model !== 'string' || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 100_000) throw new Error('A supported model and a nonempty prompt of at most 100,000 characters are required.')
  const model = findModel(value.model)
  if (!model) throw new Error('Unknown image model.')
  if (typeof value.aspect_ratio !== 'string' || !model.supportsRatio(value.aspect_ratio)) throw new Error('The aspect ratio is not supported by this model.')
  const references = value.input_references ?? []
  if (!Array.isArray(references) || references.length > model.maxReferences) throw new Error(`This model accepts at most ${model.maxReferences} reference images.`)
  const input_references: ImageRequest['input_references'] = references.map(ref => {
    if (!record(ref) || ref.type !== 'image_url' || !record(ref.image_url) || typeof ref.image_url.url !== 'string' || !imageDataPattern.test(ref.image_url.url)) throw new Error('References must be embedded PNG, JPEG or WebP images.')
    return {type: 'image_url', image_url: {url: ref.image_url.url}}
  })
  const request: ImageRequest = {model: model.id, prompt: value.prompt, aspect_ratio: value.aspect_ratio, n: 1, input_references}
  for (const [key, allowed] of [['resolution', model.resolutions], ['quality', model.qualities]] as const) {
    if (value[key] === undefined || value[key] === '') continue
    if (typeof value[key] !== 'string' || !allowed.includes(value[key])) throw new Error(`Unsupported ${key} for this model.`)
    request[key] = value[key]
  }
  return request
}

/** A success body is sanitized too: provider echoes and credentials never reach the application. */
export function parseImageResult(value: unknown): ImageResult {
  if (!record(value) || !Array.isArray(value.data) || !value.data.length) throw new Error('The Image API returned no generated image.')
  const data = value.data.slice(0, 1).map(item => {
    if (!record(item) || typeof item.b64_json !== 'string' || !item.b64_json || item.b64_json.length > 86_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) throw new Error('The Image API returned invalid image data.')
    const media_type = item.media_type ?? 'image/png'
    if (typeof media_type !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(media_type)) throw new Error('The provider returned an unsupported image format.')
    return {b64_json: item.b64_json, media_type}
  })
  const usage: ImageResult['usage'] = {}
  if (record(value.usage) && typeof value.usage.cost === 'number' && Number.isFinite(value.usage.cost) && value.usage.cost >= 0) usage.cost = value.usage.cost
  return {data, usage, ...(typeof value.created === 'number' && Number.isFinite(value.created) ? {created: value.created} : {})}
}

export async function readBoundedBody(response: Response | Request, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {await response.body?.cancel(); throw new Error('The payload exceeds the size limit.')}
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > limit) throw new Error('The payload exceeds the size limit.')
      chunks.push(next.value)
    }
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength}
    return result
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {reader.releaseLock()}
}
