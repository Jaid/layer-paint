import type {Point} from './geometry.ts'

import {setPrompt} from './actions.ts'
import {editorStore} from './state.ts'

/** receives text and, for drops, the client point it should land at instead of the cursor */
type Inserter = (text: string, client?: Point) => void

let inserter: Inserter | undefined

/** lets the mounted prompt editor receive insertions at its cursor */
export const registerPromptInserter = (callback: Inserter | undefined) => {
  inserter = callback
}

/** Inserts text at the editor cursor (or the given client point), or appends it when the editor is not mounted yet. */
export const insertIntoPrompt = (text: string, client?: Point) => {
  if (inserter) {
    inserter(text, client)
    return
  }
  const {prompt} = editorStore.state
  const separator = prompt && !/\s$/.test(prompt) ? ' ' : ''
  setPrompt(`${prompt}${separator}${text}`)
}
