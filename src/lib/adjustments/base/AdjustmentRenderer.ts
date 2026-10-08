import type {AdjustmentParameters} from '../color.ts'

export type AdjustableSource = ImageBitmap | OffscreenCanvas

/** a rendered, adjusted copy of a source image */
export type AdjustedImage = ImageBitmap | OffscreenCanvas

export abstract class AdjustmentRenderer {
  abstract readonly id: string
  /** Renders an adjusted copy at the source resolution, or returns undefined when this backend cannot handle the source. */
  abstract render(source: AdjustableSource, parameters: AdjustmentParameters, sourceKey: string): AdjustedImage | undefined
  /** releases cached GPU or CPU resources tied to a source */
  forget(_sourceKey: string) {}
}
