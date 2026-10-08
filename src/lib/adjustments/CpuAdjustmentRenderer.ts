import type {AdjustmentParameters} from './color.ts'
import type {AdjustableSource, AdjustedImage} from './base/AdjustmentRenderer.ts'

import {createCanvas} from '#src/lib/image.ts'

import {AdjustmentRenderer} from './base/AdjustmentRenderer.ts'
import {adjustColor} from './color.ts'

/** Pixel loop fallback for environments without WebGL 2. Slower, but produces the same look. */
export class CpuAdjustmentRenderer extends AdjustmentRenderer {
  id = 'cpu'
  render(source: AdjustableSource, parameters: AdjustmentParameters): AdjustedImage {
    const canvas = createCanvas(source.width, source.height)
    const context = canvas.getContext('2d', {willReadFrequently: true})
    if (!context) {
      throw new Error('2D canvas context is unavailable')
    }
    context.drawImage(source, 0, 0)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const {data} = image
    const color: [number, number, number] = [0, 0, 0]
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) {
        continue
      }
      color[0] = data[index] / 255
      color[1] = data[index + 1] / 255
      color[2] = data[index + 2] / 255
      adjustColor(color, parameters)
      data[index] = Math.round(color[0] * 255)
      data[index + 1] = Math.round(color[1] * 255)
      data[index + 2] = Math.round(color[2] * 255)
    }
    context.putImageData(image, 0, 0)
    return canvas
  }
}
