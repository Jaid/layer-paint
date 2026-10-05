export type RatioString = `${number}:${number}`

export const ratioPattern = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/

export const isRatioString = (value: unknown): value is RatioString => typeof value === 'string' && ratioPattern.test(value) && value.split(':').every(part => Number.isFinite(Number(part)) && Number(part) > 0)

export const parseRatio = (ratio: string) => {
  const match = ratioPattern.exec(ratio)
  if (!match) {
    throw new Error(`Invalid aspect ratio “${ratio}”`)
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0 && height > 0)) {
    throw new Error(`Invalid aspect ratio “${ratio}”`)
  }
  return width / height
}

/** Picks the ratio from the list whose aspect is closest to the target aspect, compared on a logarithmic scale so 1:2 and 2:1 are equally far from 1:1. */
export const closestRatio = <RatioGeneric extends string>(aspect: number, ratios: ReadonlyArray<RatioGeneric>): RatioGeneric => {
  let best = ratios[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const ratio of ratios) {
    const distance = Math.abs(Math.log(parseRatio(ratio) / aspect))
    if (!(distance < bestDistance)) {
      continue
    }
    best = ratio
    bestDistance = distance
  }
  return best
}

export const sortRatios = <RatioGeneric extends string>(ratios: ReadonlyArray<RatioGeneric>) => ratios.toSorted((a, b) => parseRatio(b) - parseRatio(a))

export const describeRatio = (ratio: string) => {
  const aspect = parseRatio(ratio)
  if (Math.abs(aspect - 1) < 0.001) {
    return 'square'
  }
  return aspect > 1 ? 'landscape' : 'portrait'
}
