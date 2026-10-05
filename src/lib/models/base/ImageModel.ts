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
  abstract readonly id: string
  abstract readonly title: string
  abstract readonly vendor: string
  abstract readonly aspectRatios: ReadonlyArray<RatioString>
  abstract readonly maxReferences: number
  /** resolution tiers accepted by the endpoint, empty if the parameter is unsupported */
  get resolutions(): ReadonlyArray<string> {return []}
  /** quality levels accepted by the endpoint, empty if the parameter is unsupported */
  get qualities(): ReadonlyArray<string> {return []}
  /** short hint shown in the model picker */
  get note(): string {return ''}

  get defaultResolution() {
    if (this.resolutions.includes('1K')) {
      return '1K'
    }
    return this.resolutions[0]
  }

  get defaultQuality() {
    if (this.qualities.includes('auto')) {
      return 'auto'
    }
    return this.qualities.includes('medium') ? 'medium' : this.qualities.at(-1)
  }

  /** the model slug without its vendor prefix */
  get shortId() {
    return this.id.slice(this.id.indexOf('/') + 1)
  }

  supportsRatio(ratio: string) {
    return this.aspectRatios.includes(ratio as RatioString)
  }

  normalizeResolution(resolution?: string) {
    if (resolution && this.resolutions.includes(resolution)) {
      return resolution
    }
    return this.defaultResolution
  }

  normalizeQuality(quality?: string) {
    if (quality && this.qualities.includes(quality)) {
      return quality
    }
    return this.defaultQuality
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
}
