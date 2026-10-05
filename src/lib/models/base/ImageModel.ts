import type {RatioString} from '#src/lib/ratio.ts'

export type GenerationSettings = {
  quality?: string
  resolution?: string
}

/**
 * an image generation model reachable through OpenRouter’s Image API
 *
 * Capabilities mirror the per-model `supported_parameters` from https://openrouter.ai/api/v1/images/models.
 */
export abstract class ImageModel {
  abstract readonly aspectRatios: ReadonlyArray<RatioString>
  abstract readonly id: string
  abstract readonly maxReferences: number
  abstract readonly title: string
  abstract readonly vendor: string
  get defaultQuality() {
    if (this.qualities.includes('auto')) {
      return 'auto'
    }
    return this.qualities.includes('medium') ? 'medium' : this.qualities.at(-1)
  }
  get defaultResolution() {
    if (this.resolutions.includes('1K')) {
      return '1K'
    }
    return this.resolutions[0]
  }
  /** short hint shown in the model picker */
  get note(): string {
    return ''
  }

  /** quality levels accepted by the endpoint, empty if the parameter is unsupported */
  get qualities(): ReadonlyArray<string> {
    return []
  }

  /** resolution tiers accepted by the endpoint, empty if the parameter is unsupported */
  get resolutions(): ReadonlyArray<string> {
    return []
  }

  /** the model slug without its vendor prefix */
  get shortId() {
    return this.id.slice(this.id.indexOf('/') + 1)
  }

  /** request body fields that are passed through to OpenRouter in addition to model, prompt, aspect ratio and references */
  getRequestOptions(settings: GenerationSettings): Record<string, string> {
    const options: Record<string, string> = {}
    const resolution = this.normalizeResolution(settings.resolution)
    if (resolution) {
      options.resolution = resolution
    }
    const quality = this.normalizeQuality(settings.quality)
    if (quality) {
      options.quality = quality
    }
    return options
  }

  normalizeQuality(quality?: string) {
    if (quality && this.qualities.includes(quality)) {
      return quality
    }
    return this.defaultQuality
  }

  normalizeResolution(resolution?: string) {
    if (resolution && this.resolutions.includes(resolution)) {
      return resolution
    }
    return this.defaultResolution
  }

  supportsRatio(ratio: string) {
    return this.aspectRatios.includes(ratio as RatioString)
  }
}
