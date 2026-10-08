const transformLine = (input: Float64Array, output: Float64Array, length: number, vertices: Int32Array, boundaries: Float64Array) => {
  let count = -1
  for (let q = 0; q < length; q++) {
    const value = input[q]
    if (value === Infinity) {
      continue
    }
    // Drop parabolas that the new one hides completely.
    while (count >= 0) {
      const p = vertices[count]
      const intersection = (value + q * q - input[p] - p * p) / (2 * (q - p))
      if (intersection > boundaries[count]) {
        count++
        vertices[count] = q
        boundaries[count] = intersection
        break
      }
      count--
    }
    if (count < 0) {
      count = 0
      vertices[0] = q
      boundaries[0] = -Infinity
    }
  }
  if (count < 0) {
    output.fill(Infinity, 0, length)
    return
  }
  let segment = 0
  for (let q = 0; q < length; q++) {
    while (segment < count && boundaries[segment + 1] < q) {
      segment++
    }
    const p = vertices[segment]
    output[q] = (q - p) * (q - p) + input[p]
  }
}

/**
 * Exact Euclidean distance from every pixel center to the nearest seed pixel center, using the separable lower-envelope algorithm by Felzenszwalb and Huttenlocher in O(width × height).
 *
 * @param seeds nonzero for seed pixels
 * @returns distances in pixels; Infinity everywhere if there are no seeds
 */
export const distanceTransform = (seeds: ArrayLike<number>, width: number, height: number) => {
  const squared = new Float64Array(width * height)
  for (let index = 0; index < squared.length; index++) {
    squared[index] = seeds[index] ? 0 : Infinity
  }
  const longest = Math.max(width, height)
  const input = new Float64Array(longest)
  const output = new Float64Array(longest)
  const vertices = new Int32Array(longest)
  const boundaries = new Float64Array(longest)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      input[y] = squared[y * width + x]
    }
    transformLine(input, output, height, vertices, boundaries)
    for (let y = 0; y < height; y++) {
      squared[y * width + x] = output[y]
    }
  }
  const result = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    input.set(squared.subarray(row, row + width))
    transformLine(input, output, width, vertices, boundaries)
    for (let x = 0; x < width; x++) {
      result[row + x] = Math.sqrt(output[x])
    }
  }
  return result
}
