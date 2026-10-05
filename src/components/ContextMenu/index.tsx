import {useEffect, useRef} from 'react'
import {fitFrameToContent, fitFrameToRect, fitViewToContent, fitViewToFrame, moveLayerInStack, redo, removeLayer, selectLayer, undo, updateLayer} from '#src/lib/actions.ts'
import {contextMenuStore, closeContextMenu} from '#src/lib/contextMenu.ts'
import {getLayerBounds} from '#src/lib/layerGeometry.ts'
import {notify, getErrorMessage} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {zoomBy} from '#src/lib/viewport.ts'
import {referenceAsset} from '#src/lib/workspaceIO.ts'
import css from './style.module.sass'

export default function ContextMenu() {
  const menu = useStore(contextMenuStore), ref = useRef<HTMLDivElement>(null)
  const layer = useStore(projectStore, state => state.layers.find(item => item.id === menu.layerId))
  useEffect(() => {
    if (!menu.open) return
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent) => {if (!ref.current?.contains(event.target as Node)) closeContextMenu()}
    addEventListener('pointerdown', dismiss)
    return () => {removeEventListener('pointerdown', dismiss); if (previous?.isConnected) previous.focus({preventScroll: true})}
  }, [menu.open])
  if (!menu.open) return null
  const run = (action: () => unknown) => {closeContextMenu(); Promise.resolve().then(action).catch(error => notify('error', getErrorMessage(error)))}
  const button = (label: string, action: () => unknown, disabled = false) => <button disabled={disabled} role='menuitem' type='button' onClick={() => run(action)}>{label}</button>
  return <div ref={ref} aria-label='Canvas context menu' className={css.menu} data-overlay-control role='menu' style={{left: Math.max(8, Math.min(menu.x, innerWidth - 252)), top: Math.max(8, Math.min(menu.y, innerHeight - (layer ? 510 : 320)))}} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === 'Escape') {event.preventDefault(); closeContextMenu(); return}
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
  }}>
    {layer && <>
      <strong>{layer.name}</strong>
      {button('Frame it', () => {fitFrameToRect(getLayerBounds(layer)); editorStore.set({tool: 'frame'})})}
      {button('Use as prompt reference', async () => {const ingredient = await referenceAsset(layer.assetId, layer.name, layer.kind === 'generated' ? 'generated' : 'import'); insertIntoPrompt(`![${ingredient.index}]`)})}
      {button(layer.kind === 'import' ? 'Transform imported image' : 'Generated placement is locked', () => {selectLayer(layer.id); editorStore.set({tool: 'image'})}, layer.kind !== 'import')}
      {button('Edit mask', () => {selectLayer(layer.id); editorStore.set({tool: 'mask'})}, projectStore.state.layers[0]?.id === layer.id)}
      {button(layer.visible ? 'Hide layer' : 'Show layer', () => updateLayer(layer.id, {visible: !layer.visible}))}
      {button('Move up', () => moveLayerInStack(layer.id, 1))}
      {button('Move down', () => moveLayerInStack(layer.id, -1))}
      {button('Delete layer', () => removeLayer(layer.id))}
      <hr/>
    </>}
    {button('Frame all artwork', () => {fitFrameToContent(); editorStore.set({tool: 'frame'})})}
    {button('Show the frame · F', fitViewToFrame)}
    {button('Show all artwork · Shift+F', fitViewToContent)}
    {button('Zoom in · +', () => zoomBy(1.25))}
    {button('Zoom out · −', () => zoomBy(0.8))}
    <hr/>
    {button('Undo · Ctrl+Z', undo, !projectStore.meta.state.canUndo)}
    {button('Redo · Ctrl+Shift+Z', redo, !projectStore.meta.state.canRedo)}
  </div>
}
