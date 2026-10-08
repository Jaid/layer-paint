/**
 * Non-destructive per-layer color adjustments.
 *
 * Every value is normalized to −1…1 with 0 as the neutral position, so documents stay independent of slider scales.
 * The pixel math lives here once as derived parameters; the GPU shader and the CPU fallback both evaluate the same formula.
 */
export type Adjustments = {
  brightness?: number
  contrast?: number
  gamma?: number
  saturation?: number
  /** white balance: negative is cooler, positive is warmer */
  temperature?: number
  vibrance?: number
}

export type AdjustmentKey = keyof Adjustments

export const adjustmentKeys = ['brightness', 'contrast', 'gamma', 'saturation', 'vibrance', 'temperature'] as const satisfies ReadonlyArray<AdjustmentKey>

/** Rec. 709 luma weights, the same ones used for drift registration */
export const lumaWeights = [0.2126, 0.7152, 0.0722] as const

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const clampUnit = (value: number) => Math.min(1, Math.max(-1, value))

export const isNeutral = (adjustments?: Adjustments) => !adjustments || adjustmentKeys.every(key => !adjustments[key])

/** drops neutral entries and clamps the rest, so equal looks produce equal cache keys */
export const normalizeAdjustments = (adjustments: Adjustments): Adjustments | undefined => {
  const result: Adjustments = {}
  for (const key of adjustmentKeys) {
    const value = adjustments[key]
    if (value !== undefined && Number.isFinite(value) && value !== 0) {
      result[key] = clampUnit(value)
    }
  }
  return Object.keys(result).length ? result : undefined
}

export const getAdjustmentsKey = (adjustments: Adjustments) => adjustmentKeys.map(key => adjustments[key] ?? 0).join(',')

/** gamma slider position → γ, where γ > 1 lifts the midtones */
export const toGamma = (value: number) => 3 ** clampUnit(value)

export type AdjustmentParameters = {
  brightness: number
  contrast: number
  /** exponent applied to each channel, 1 / γ */
  exponent: number
  /** per-channel white balance gains, normalized to keep luma */
  gains: readonly [number, number, number]
  saturation: number
  vibrance: number
}

export const getAdjustmentParameters = (adjustments: Adjustments = {}): AdjustmentParameters => {
  const temperature = clampUnit(adjustments.temperature ?? 0)
  const raw = [1 + 0.3 * temperature, 1 + 0.04 * temperature, 1 - 0.3 * temperature] as const
  const luma = raw[0] * lumaWeights[0] + raw[1] * lumaWeights[1] + raw[2] * lumaWeights[2]
  const contrast = clampUnit(adjustments.contrast ?? 0)
  return {
    gains: [raw[0] / luma, raw[1] / luma, raw[2] / luma],
    brightness: 1 + clampUnit(adjustments.brightness ?? 0),
    exponent: 1 / toGamma(adjustments.gamma ?? 0),
    contrast: contrast >= 0 ? 1 + 2 * contrast : 1 + contrast,
    saturation: 1 + clampUnit(adjustments.saturation ?? 0),
    vibrance: clampUnit(adjustments.vibrance ?? 0),
  }
}

/**
 * Adjusts one straight-alpha sRGB color in place, channels 0…1.
 * Order: white balance, brightness, gamma, contrast, saturation, vibrance.
 */
export const adjustColor = (color: [number, number, number], p: AdjustmentParameters) => {
  for (let channel = 0; channel < 3; channel++) {
    let value = clamp01(color[channel] * p.gains[channel] * p.brightness)
    value = value ** p.exponent
    color[channel] = clamp01((value - 0.5) * p.contrast + 0.5)
  }
  let luma = color[0] * lumaWeights[0] + color[1] * lumaWeights[1] + color[2] * lumaWeights[2]
  for (let channel = 0; channel < 3; channel++) {
    color[channel] = clamp01(luma + (color[channel] - luma) * p.saturation)
  }
  // Vibrance mostly affects muted colors and leaves already saturated ones alone.
  const chroma = Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2])
  const factor = 1 + p.vibrance * (1 - chroma)
  luma = color[0] * lumaWeights[0] + color[1] * lumaWeights[1] + color[2] * lumaWeights[2]
  for (let channel = 0; channel < 3; channel++) {
    color[channel] = clamp01(luma + (color[channel] - luma) * factor)
  }
  return color
}
