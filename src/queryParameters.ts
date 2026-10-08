import readPermalink, {parseNumber} from 'read-permalink'

const optionalString = (value: unknown) => (value === undefined || value === null ? '' : String(value))
const fraction = (value: unknown) => {
  const number = parseNumber(value)
  // Percentages like “35” are accepted as well as fractions like “0.35”.
  const normalized = number > 1 ? number / 100 : number
  return Math.min(1, Math.max(0, normalized))
}
const queryParameters = readPermalink(typeof location === 'undefined' ? '' : location.href, {schema: {
  defaults: {
    /** OpenRouter image model to use, with or without vendor prefix */
    model: 'google\u{2F}gemini-nano-banana-2.1',
    /** frame aspect ratio like “16:9”; falls back to the closest ratio the model supports */
    ratio: '1:1',
    /** resolution tier like “1K”, “2K” or “4K”; empty uses the model default */
    resolution: '',
    /** quality level for models that support it; empty uses the model default */
    quality: '',
    /** initial prompt text, overrides the stored prompt */
    prompt: '',
    /** default feathering for new generated layers, 0–1 or 0–100 */
    feather: 0,
    /** default mask area for new generated layers, 0–1 or 0–100 */
    area: 1,
  },
  normalizations: {
    model: String,
    ratio: String,
    resolution: optionalString,
    quality: optionalString,
    prompt: optionalString,
    feather: fraction,
    area: fraction,
  },
}})

/** keys that were explicitly present in the URL and therefore win over persisted settings */
export const explicitQueryKeys = new Set(typeof location === 'undefined' ? [] : new URLSearchParams(location.search).keys())

export default queryParameters
