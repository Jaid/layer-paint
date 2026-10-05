import type {Rect} from '#src/lib/geometry.ts'
import type {AlignmentResult, GrayImage, Placement} from './align.ts'
import type {AlignmentRequest, AlignmentResponse} from './worker.ts'
import {createCanvas, fitWithin, getContext} from '#src/lib/image.ts'
import {decideAlignment, toGray} from './align.ts'

const analysisSide = 128

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, PromiseWithResolvers<AlignmentResult>>()

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('worker.ts', import.meta.url), {type: 'module', name: 'alignment'})
    worker.addEventListener('message', (event: MessageEvent<AlignmentResponse>) => {
      const request = pending.get(event.data.id)
      pending.delete(event.data.id)
      if (event.data.result) {
        request?.resolve(event.data.result)
      } else {
        request?.reject(new Error(event.data.error ?? 'Alignment failed'))
      }
    })
  }
  return worker
}

const toAnalysisImage = (source: CanvasImageSource & {height: number
  width: number}, aspect: number): GrayImage => {
  const size = fitWithin({width: analysisSide * aspect, height: analysisSide}, analysisSide)
  const canvas = createCanvas(size.width, size.height)
  const context = getContext(canvas)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height)
  return toGray(data, canvas.width, canvas.height)
}

export type RegistrationResult = AlignmentResult & {
  applied: boolean
  reason: string
}

/**
 * Registers a generated image against the canvas input it was generated from.
 * Both are analyzed with the frame aspect ratio, which is how the generated layer is placed.
 */
export const registerOutput = async (input: OffscreenCanvas, output: ImageBitmap, aspect: number): Promise<RegistrationResult> => {
  const request: AlignmentRequest = {
    id: nextId++,
    input: toAnalysisImage(input, aspect),
    output: toAnalysisImage(output, aspect),
  }
  const resolvers = Promise.withResolvers<AlignmentResult>()
  pending.set(request.id, resolvers)
  getWorker().postMessage(request, [request.input.data.buffer, request.output.data.buffer])
  const result = await resolvers.promise
  const decision = decideAlignment(result)
  return {...result, applied: decision.apply, reason: decision.reason}
}

export const placementToRect = (frame: Rect, placement: Placement): Rect => ({
  x: frame.x + placement.x * frame.width,
  y: frame.y + placement.y * frame.height,
  width: frame.width * placement.scale,
  height: frame.height * placement.scale,
})
