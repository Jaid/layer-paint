export type ReferenceToken = {end: number; index: number; start: number}
export type PromptSource = {kind: 'canvas'} | {index: number; kind: 'ingredient'}
export type CompilePromptOptions = {
  canvasHasEmptyAreas?: boolean
  hasCanvasContent: boolean
  ingredientIndices: Iterable<number>
  maxReferences: number
  text: string
}
export type CompiledPrompt = {errors: string[]; sources: PromptSource[]; text: string}
export const createReferencePattern = () => /!\[(\d+)\]/g
export const stripComments = (text: string) => text.replaceAll(/<!--[\s\S]*?(?:-->|$)/g, '')
const escaped = (text: string, index: number) => {
  let count = 0
  while (index > 0 && text[--index] === '\\') count++
  return count % 2 === 1
}
const closing = (text: string, start: number, open: string, close: string) => {
  let depth = 1, quote = ''
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]
    if (char === '\\') index++
    else if (quote) {if (char === quote) quote = ''}
    else if (open === '(' && depth === 1 && (char === '"' || char === "'") && /\s/.test(text[index - 1])) quote = char
    else if (char === open) depth++
    else if (char === close && --depth === 0) return index
  }
  return -1
}

/** Bare numeric tokens only; escaped tokens, comments, code spans and complete Markdown images stay literal. */
export function findReferences(text: string): ReferenceToken[] {
  const tokens: ReferenceToken[] = []
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith('<!--', index)) {const end = text.indexOf('-->', index + 4); if (end < 0) break; index = end + 2; continue}
    if (text[index] === '`' && !escaped(text, index)) {
      let count = 1
      while (text[index + count] === '`') count++
      const end = text.indexOf('`'.repeat(count), index + count)
      if (end >= 0) {index = end + count - 1; continue}
    }
    if (text[index] !== '!' || text[index + 1] !== '[' || escaped(text, index)) continue
    const altEnd = closing(text, index + 1, '[', ']')
    if (altEnd < 0) continue
    const suffix = text[altEnd + 1]
    if (suffix === '(' || suffix === '[') {
      const end = closing(text, altEnd + 1, suffix, suffix === '(' ? ')' : ']')
      if (end >= 0) {index = end; continue}
    }
    const label = text.slice(index + 2, altEnd)
    if (/^\d+$/.test(label)) tokens.push({start: index, end: altEnd + 1, index: Number(label)})
    index = altEnd
  }
  return tokens
}
export const getImageLabel = (position: number) => `[Image ${position + 1}]`

/** The framed canvas is always first when it contains content, even if other references are explicit. */
export function compilePrompt(options: CompilePromptOptions): CompiledPrompt {
  const text = stripComments(options.text).trim()
  const errors: string[] = []
  if (!text) errors.push('The prompt is empty.')
  const tokens = findReferences(text)
  const available = new Set(options.ingredientIndices)
  const sources: PromptSource[] = []
  const positions = new Map<number, number>()
  if (options.hasCanvasContent) {positions.set(0, 0); sources.push({kind: 'canvas'})}
  else if (tokens.some(token => token.index === 0)) errors.push('![0] refers to an empty frame. Import an image or remove the canvas reference.')
  for (const {index} of tokens) {
    if (positions.has(index) || index === 0) continue
    if (!Number.isSafeInteger(index) || !available.has(index)) {const message = `![${index}] does not exist. Add a reference image or remove this token.`; if (!errors.includes(message)) errors.push(message); continue}
    positions.set(index, sources.length)
    sources.push({kind: 'ingredient', index})
  }
  if (sources.length > options.maxReferences) errors.push(`This model accepts at most ${options.maxReferences} input images, but this prompt needs ${sources.length}.`)
  let rewritten = '', offset = 0
  for (const token of tokens) {
    const position = positions.get(token.index)
    rewritten += text.slice(offset, token.start) + (position === undefined ? text.slice(token.start, token.end) : getImageLabel(position))
    offset = token.end
  }
  rewritten += text.slice(offset)
  if (!sources.length) return {errors, sources, text: rewritten}
  const preamble: string[] = []
  if (options.hasCanvasContent) {
    preamble.push('[Image 1] is a crop of a larger picture. The result will be pasted back over exactly that spot. Edit in place: preserve the exact framing, camera position, zoom, lighting, and position and size of every subject, even when cut off by a border. Never recenter, zoom, crop or recompose. Change only what the instructions ask for.')
    if (options.canvasHasEmptyAreas) preamble.push('Flat neutral gray areas in [Image 1] mark empty canvas. Extend the existing content seamlessly into those areas; do not add a border.')
  }
  for (const [i, source] of sources.entries()) if (source.kind === 'ingredient') preamble.push(`${getImageLabel(i)} is the reference image named ![${source.index}] by the user.`)
  return {errors, sources, text: `${preamble.join('\n')}\n\nInstructions:\n${rewritten}`}
}
