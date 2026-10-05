import {setPrompt} from './actions.ts'
import {editorStore} from './state.ts'

type Inserter = (text: string) => void

let inserter: Inserter | undefined

/** lets the mounted prompt editor receive insertions at its cursor */
export const registerPromptInserter = (callback: Inserter | undefined) => {
  inserter = callback
}

/** Inserts text at the editor cursor, or appends it when the editor is not mounted yet. */
export const insertIntoPrompt = (text: string) => {
  if (inserter) {
    inserter(text)
    return
  }
  const {prompt} = editorStore.state
  const separator = prompt && !/\s$/.test(prompt) ? ' ' : ''
  setPrompt(`${prompt}${separator}${text}`)
}
