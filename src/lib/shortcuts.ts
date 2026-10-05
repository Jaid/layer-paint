import {persistenceStore} from './autosave.ts'
import {fitViewToContent, fitViewToFrame, redo, removeLayer, selectLayer, setFrame, undo, updateLayer} from './actions.ts'
import {generate} from './generation.ts'
import {editorStore, projectStore} from './state.ts'
import {routeDroppedFiles} from './drop.ts'
import {zoomBy} from './viewport.ts'

const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || Boolean(target.closest('.monaco-editor')))
const handleKeyDown = (event: KeyboardEvent) => {
  if (!persistenceStore.state.hydrated) return
  if (event.defaultPrevented || document.querySelector('dialog[open]') || document.querySelector('[role=menu]')) return
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key === 'Enter') {
    // Monaco owns its own Ctrl+Enter action. Do not generate twice as the event bubbles.
    if (event.target instanceof Element && event.target.closest('.monaco-editor')) return
    event.preventDefault(); void generate(); return
  }
  if (editable(event.target)) return
  const key = event.key.toLowerCase()
  if (modifier && key === 'z') {event.preventDefault(); event.shiftKey ? redo() : undo(); return}
  if (modifier && key === 'y') {event.preventDefault(); redo(); return}
  if (modifier || event.altKey) return
  const state = editorStore.state, layer = projectStore.state.layers.find(item => item.id === state.selectedLayerId)
  if (['v', 'i', 'm'].includes(key)) {
    if (key === 'm' && (!layer || projectStore.state.layers[0]?.id === layer.id)) return
    event.preventDefault()
    editorStore.set({tool: key === 'v' ? 'frame' : key === 'i' ? 'image' : 'mask'})
    return
  }
  if (key === 'f') {event.preventDefault(); event.shiftKey ? fitViewToContent() : fitViewToFrame(); return}
  if (event.key === '+' || event.key === '=') {event.preventDefault(); zoomBy(1.25); return}
  if (event.key === '-') {event.preventDefault(); zoomBy(0.8); return}
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (layer) {event.preventDefault(); removeLayer(layer.id); editorStore.set({tool: 'frame'})}
    return
  }
  if (event.key === 'Escape') {editorStore.set({tool: 'frame'}); selectLayer(null); return}
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    const step = (event.shiftKey ? 50 : 5) / state.view.scale
    const x = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const y = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    if (state.tool === 'image' && layer?.kind === 'import') updateLayer(layer.id, {rect: {...layer.rect, x: layer.rect.x + x, y: layer.rect.y + y}}, {coalesceKey: `nudge:${layer.id}`})
    else if (state.tool === 'mask' && layer && projectStore.state.layers[0]?.id !== layer.id) updateLayer(layer.id, {offsetX: (layer.offsetX ?? 0) + x / layer.rect.width, offsetY: (layer.offsetY ?? 0) + y / layer.rect.height}, {coalesceKey: `mask-nudge:${layer.id}`})
    else setFrame({...state.frame, x: state.frame.x + x, y: state.frame.y + y})
  }
}
const handlePaste = (event: ClipboardEvent) => {
  const files = [...event.clipboardData?.files ?? []].filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  const editor = document.activeElement?.closest('[data-drop-target="editor"]')
  void routeDroppedFiles(files, editor ? 'editor' : 'canvas')
}
export const installShortcuts = () => {
  addEventListener('keydown', handleKeyDown); addEventListener('paste', handlePaste)
  return () => {removeEventListener('keydown', handleKeyDown); removeEventListener('paste', handlePaste)}
}
