import type {RatioString} from '../ratio.ts'

import {isRatioString} from '../ratio.ts'
import {Store} from '../store/index.ts'
import {ImageModel} from './base/ImageModel.ts'
import snapshot from './catalog.json'

export type Capability = {
  max: number
  min: number
  type: 'range'
} | {type: 'boolean'} | {
  type: 'enum'
  values: Array<string>
}
export type ImageCatalogEntry = {
  id: string
  name: string
  supported_parameters: Record<string, Capability>
}
export const requestedModelIds: ReadonlyArray<string> = snapshot.data.map(row => row.id)
const titles = ['Gemini Flash Lite', 'Gemini Flash', 'Nano Banana 2.1', 'GPT Image Sunburst', 'Flux 3', 'Grok Imagine', 'Seedream Flash', 'Seedream Lite', 'Seedream Pro']
const vendors: Record<string, string> = {
  google: 'Google',
  openai: 'OpenAI',
  'black-forest-labs': 'Black Forest Labs',
  'x-ai': 'xAI',
  'bytedance-seed': 'ByteDance',
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Treat discovery data as untrusted. Absence in this catalog is not a claim about account access. */
export function parseImageCatalog(value: unknown): Array<ImageCatalogEntry> {
  if (!record(value) || !Array.isArray(value.data)) {
    throw new Error('Invalid Image API model catalog.')
  }
  const entries: Array<ImageCatalogEntry> = []
  for (const row of value.data) {
    if (!record(row) || typeof row.id !== 'string' || !requestedModelIds.includes(row.id) || !record(row.supported_parameters)) {
      continue
    }
    const supported_parameters: Record<string, Capability> = {}
    for (const [key, cap] of Object.entries(row.supported_parameters)) {
      if (!record(cap)) {
        continue
      }
      if (cap.type === 'enum' && Array.isArray(cap.values) && cap.values.every(v => typeof v === 'string')) {
        supported_parameters[key] = {
          type: 'enum',
          values: cap.values,
        }
      } else if (cap.type === 'range' && typeof cap.min === 'number' && typeof cap.max === 'number' && Number.isFinite(cap.min) && Number.isFinite(cap.max) && cap.max >= cap.min) {
        supported_parameters[key] = {
          type: 'range',
          min: cap.min,
          max: cap.max,
        }
      } else if (cap.type === 'boolean') {
        supported_parameters[key] = {type: 'boolean'}
      }
    }
    const ratio = supported_parameters.aspect_ratio
    if (ratio?.type !== 'enum' || !ratio.values.some(isRatioString)) {
      continue
    }
    entries.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : row.id,
      supported_parameters,
    })
  }
  if (!entries.length) {
    throw new Error('The Image API catalog contains none of the requested models.')
  }
  return entries
}

let catalog = new Map(parseImageCatalog(snapshot).map(row => [row.id, row]))
export const catalogStore = new Store({
  source: 'snapshot',
  updatedAt: snapshot.retrievedAt,
  error: '',
  revision: 0,
})
const values = (id: string, key: string) => {
  const cap = catalog.get(id)?.supported_parameters[key]
  return cap?.type === 'enum' ? cap.values : []
}
class CatalogImageModel extends ImageModel {
  constructor(readonly id: string, readonly title: string) {
    super()
  }
  get aspectRatios(): ReadonlyArray<RatioString> {
    return values(this.id, 'aspect_ratio').filter(isRatioString)
  }
  get maxReferences() {
    const cap = catalog.get(this.id)?.supported_parameters.input_references
    return cap?.type === 'range' ? Math.max(0, Math.floor(cap.max)) : 0
  }
  override get note() {
    return `${catalogStore.state.source === 'live' ? 'Live Image API' : 'Bundled capability snapshot'} · up to ${this.maxReferences} reference images`
  }
  override get qualities() {
    return values(this.id, 'quality')
  }
  override get resolutions() {
    return values(this.id, 'resolution')
  }
  get vendor() {
    return vendors[this.id.split('/')[0]] ?? this.id.split('/')[0]
  }
}
export const models: ReadonlyArray<ImageModel> = requestedModelIds.map((id, i) => new CatalogImageModel(id, titles[i]))
export const defaultModel = models[0]
export const findModel = (id: unknown) => (typeof id === 'string' ? models.find(model => model.id === id.trim() || model.shortId === id.trim()) : undefined)
export const getModel = (id: unknown): ImageModel => findModel(id) ?? defaultModel
export function applyImageCatalog(value: unknown) {
  const entries = parseImageCatalog(value)
  // Retain explicitly labeled snapshot records for models temporarily missing from discovery.
  catalog = new Map([...catalog, ...entries.map(row => [row.id, row] as const)])
  catalogStore.set(state => ({
    source: 'live',
    updatedAt: (new Date).toISOString(),
    error: entries.length < models.length ? 'Some models are using bundled capabilities.' : '',
    revision: state.revision + 1,
  }))
}
export async function refreshImageCatalog() {
  try {
    let response = await fetch('/api/models', {signal: AbortSignal.timeout(12_000)})
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      response = await fetch('https://openrouter.ai/api/v1/images/models', {signal: AbortSignal.timeout(12_000)})
    }
    if (!response.ok) {
      throw new Error(`Image catalog returned HTTP ${response.status}.`)
    }
    const value = await response.json()
    applyImageCatalog(value)
    if (value.source === 'snapshot') {
      catalogStore.set({
        source: 'snapshot',
        updatedAt: value.retrievedAt ?? snapshot.retrievedAt,
        error: 'Live discovery is unavailable; using the dated capability snapshot.',
      })
    }
  } catch {
    catalogStore.set({error: 'Live discovery is unavailable; using the dated capability snapshot.'})
  }
}

export type {GenerationSettings} from './base/ImageModel.ts'

export {ImageModel} from './base/ImageModel.ts'
