import type {AlignmentResult, GrayImage} from './align.ts'
import {align} from './align.ts'

export type AlignmentRequest = {
  id: number
  input: GrayImage
  output: GrayImage
}

export type AlignmentResponse = {
  error?: string
  id: number
  result?: AlignmentResult
}

addEventListener('message', (event: MessageEvent<AlignmentRequest>) => {
  const {id, input, output} = event.data
  try {
    const result = align(input, output)
    postMessage({id, result} satisfies AlignmentResponse)
  } catch (error) {
    postMessage({id, error: String(error)} satisfies AlignmentResponse)
  }
})
