/**
 * Finds where a generated image belongs relative to the image it was generated from.
 *
 * Image models sometimes recenter, zoom or slightly shift the content even when told to edit in place.
 * This estimates the similarity transform (uniform scale plus translation) that best registers the output onto the input,
 * using normalized cross-correlation of blurred luminance in a coarse-to-fine search.
 */

export type GrayImage = {
  data: Float32Array<ArrayBuffer>
  height: number
  width: number
}

/** placement of the output in normalized input coordinates: the output covers [x, x + scale] × [y, y + scale] */
export type Placement = {
  scale: number
  x: number
  y: number
}

export type AlignmentResult = {
  /** correlation at the identity placement */
  baseline: number
  placement: Placement
  /** correlation at the found placement, −1…1 */
  score: number
}

export const identityPlacement: Placement = {
  x: 0,
  y: 0,
  scale: 1,
}

export const toGray = (rgba: Uint8ClampedArray, width: number, height: number): GrayImage => {
  const data = new Float32Array(width * height)
  for (let index = 0; index < data.length; index++) {
    const offset = index * 4
    data[index] = 0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]
  }
  return {
    data,
    width,
    height,
  }
}

/** separable box blur, applied twice for an approximately Gaussian kernel */
export const blur = (image: GrayImage, radius: number): GrayImage => {
  if (radius < 1) {
    return image
  }
  const {width, height} = image
  let source: Float32Array<ArrayBuffer> = image.data
  let target = new Float32Array(source.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let count = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const sampleX = x + offset
          if (!(sampleX >= 0 && sampleX < width)) {
            continue
          }
          sum += source[y * width + sampleX]
          count++
        }
        target[y * width + x] = sum / count
      }
    }
    ;[source, target] = [target, source]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let count = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const sampleY = y + offset
          if (!(sampleY >= 0 && sampleY < height)) {
            continue
          }
          sum += source[sampleY * width + x]
          count++
        }
        target[y * width + x] = sum / count
      }
    }
    ;[source, target] = [target, source]
  }
  return {
    data: source,
    width,
    height,
  }
}

/** bilinear sample at normalized coordinates, NaN outside */
const sample = (image: GrayImage, u: number, v: number) => {
  const x = u * image.width - 0.5
  const y = v * image.height - 0.5
  if (x < -0.5 || y < -0.5 || x > image.width - 0.5 || y > image.height - 0.5) {
    return Number.NaN
  }
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)))
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const top = image.data[y0 * image.width + x0] * (1 - fx) + image.data[y0 * image.width + x1] * fx
  const bottom = image.data[y1 * image.width + x0] * (1 - fx) + image.data[y1 * image.width + x1] * fx
  return top * (1 - fy) + bottom * fy
}

type SampleGrid = {
  u: Float32Array
  v: Float32Array
  values: Float32Array
}

/** samples the output image on a regular grid once, so candidates only need to sample the input */
const createGrid = (output: GrayImage, columns: number, rows: number): SampleGrid => {
  const count = columns * rows
  const u = new Float32Array(count)
  const v = new Float32Array(count)
  const values = new Float32Array(count)
  let index = 0
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      u[index] = (column + 0.5) / columns
      v[index] = (row + 0.5) / rows
      values[index] = sample(output, u[index], v[index])
      index++
    }
  }
  return {
    u,
    v,
    values,
  }
}
const minOverlap = 0.35

/** normalized cross-correlation between the output grid and the input under a placement; overlap below the minimum scores −1 */
export const scorePlacement = (input: GrayImage, grid: SampleGrid, placement: Placement) => {
  let count = 0
  let sumA = 0
  let sumB = 0
  let sumAA = 0
  let sumBB = 0
  let sumAB = 0
  for (let index = 0; index < grid.values.length; index++) {
    const b = sample(input, placement.x + placement.scale * grid.u[index], placement.y + placement.scale * grid.v[index])
    if (Number.isNaN(b)) {
      continue
    }
    const a = grid.values[index]
    count++
    sumA += a
    sumB += b
    sumAA += a * a
    sumBB += b * b
    sumAB += a * b
  }
  if (count < grid.values.length * minOverlap) {
    return -1
  }
  const covariance = sumAB - sumA * sumB / count
  const varianceA = sumAA - sumA * sumA / count
  const varianceB = sumBB - sumB * sumB / count
  const denominator = Math.sqrt(varianceA * varianceB)
  if (denominator < 1e-6) {
    return 0
  }
  return covariance / denominator
}

export type AlignOptions = {
  maxScale?: number
  maxShift?: number
  minScale?: number
}

/**
 * Both images should be grayscale renders of the same aspect ratio, ideally with a long side around 96–160 px.
 * Returns the best placement found together with the baseline score of the identity placement.
 */
export const align = (input: GrayImage, output: GrayImage, options: AlignOptions = {}): AlignmentResult => {
  const minScale = options.minScale ?? 0.6
  const maxScale = options.maxScale ?? 1.5
  const maxShift = options.maxShift ?? 0.5
  const blurredInput = blur(input, Math.max(1, Math.round(input.width / 64)))
  const blurredOutput = blur(output, Math.max(1, Math.round(output.width / 64)))
  const coarseGrid = createGrid(blurredOutput, 24, Math.max(8, Math.round(24 * output.height / output.width)))
  const fineGrid = createGrid(blurredOutput, 64, Math.max(16, Math.round(64 * output.height / output.width)))
  const baseline = scorePlacement(blurredInput, fineGrid, identityPlacement)
  type Candidate = Placement & {score: number}
  const coarse: Array<Candidate> = []
  const scaleSteps = 24
  const shiftStep = 0.025
  for (let step = 0; step <= scaleSteps; step++) {
    const scale = minScale * (maxScale / minScale) ** (step / scaleSteps)
    // Placements whose center stays near the input are plausible; the range scales with the output size.
    const centerOffset = (1 - scale) / 2
    for (let x = centerOffset - maxShift; x <= centerOffset + maxShift + 1e-9; x += shiftStep) {
      for (let y = centerOffset - maxShift; y <= centerOffset + maxShift + 1e-9; y += shiftStep) {
        const score = scorePlacement(blurredInput, coarseGrid, {
          x,
          y,
          scale,
        })
        coarse.push({
          x,
          y,
          scale,
          score,
        })
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score)
  let best: Candidate = {
    ...identityPlacement,
    score: baseline,
  }
  for (const start of coarse.slice(0, 6)) {
    let current: Candidate = {
      ...start,
      score: scorePlacement(blurredInput, fineGrid, start),
    }
    let step = shiftStep
    let scaleFactor = (maxScale / minScale) ** (1 / scaleSteps)
    while (step > 0.0015) {
      let improved = false
      const neighbors: Array<Placement> = [
        {
          ...current,
          x: current.x + step,
        },
        {
          ...current,
          x: current.x - step,
        },
        {
          ...current,
          y: current.y + step,
        },
        {
          ...current,
          y: current.y - step,
        },
        {
          x: current.x - current.scale * (scaleFactor - 1) / 2,
          y: current.y - current.scale * (scaleFactor - 1) / 2,
          scale: current.scale * scaleFactor,
        },
        {
          x: current.x + current.scale * (1 - 1 / scaleFactor) / 2,
          y: current.y + current.scale * (1 - 1 / scaleFactor) / 2,
          scale: current.scale / scaleFactor,
        },
      ]
      for (const neighbor of neighbors) {
        if (neighbor.scale < minScale || neighbor.scale > maxScale) {
          continue
        }
        const score = scorePlacement(blurredInput, fineGrid, neighbor)
        if (!(score > current.score + 1e-5)) {
          continue
        }
        current = {
          ...neighbor,
          score,
        }
        improved = true
      }
      if (improved) {
        continue
      }
      step /= 2
      scaleFactor = Math.sqrt(scaleFactor)
    }
    if (current.score > best.score) {
      best = current
    }
  }
  return {
    baseline,
    score: best.score,
    placement: {
      x: best.x,
      y: best.y,
      scale: best.scale,
    },
  }
}

export type AlignmentDecision = {
  apply: boolean
  reason: string
}

/** Only meaningful, clearly better registrations are applied so faithful in-place edits are never disturbed. */
export const decideAlignment = (result: AlignmentResult): AlignmentDecision => {
  const {placement} = result
  const shift = Math.hypot(placement.x + (placement.scale - 1) / 2, placement.y + (placement.scale - 1) / 2)
  const scaleChange = Math.abs(Math.log(placement.scale))
  if (shift < 0.008 && scaleChange < 0.01) {
    return {
      apply: false,
      reason: 'already aligned',
    }
  }
  // Real misalignments of faithful edits register at ≥ 0.8, while substantial edits (a hand now holding a cup) only reach ~0.65 at a wrong spot.
  if (result.score < 0.76) {
    return {
      apply: false,
      reason: 'no reliable match',
    }
  }
  if (result.score - result.baseline < 0.12) {
    return {
      apply: false,
      reason: 'no significant improvement',
    }
  }
  return {
    apply: true,
    reason: 'misaligned output',
  }
}
