import type {Flip, Orientation, Rotation} from '#src/lib/orientation.ts'
import type {Ingredient} from '#src/lib/state.ts'

import {useEffect, useRef, useSyncExternalStore} from 'react'

import {addIngredients, fitFrameToContent, fitFrameToRect, fitViewToContent, fitViewToFrame, importLayers, moveLayerInStack, redo, removeIngredient, removeLayer, selectLayer, undo, updateLayer} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {closeContextMenu, contextMenuStore} from '#src/lib/contextMenu.ts'
import {exportIngredient, openExportDialog} from '#src/lib/exporting.ts'
import {pickImageFiles} from '#src/lib/filePicker.ts'
import {reroll} from '#src/lib/generation.ts'
import {getIngredientOrientation, getSourceAssetId, orientationStore, setIngredientOrientation} from '#src/lib/ingredientOrientation.ts'
import {getLayerBounds} from '#src/lib/layerGeometry.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {flips, flipTitles, rotations, rotationTitles} from '#src/lib/orientation.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {zoomBy} from '#src/lib/viewport.ts'
import {captureCanvasSnapshot, referenceAsset} from '#src/lib/workspaceIO.ts'

import css from './style.module.sass'

/** everything the arrow keys move between */
const focusableSelector = 'button:not(:disabled), select:not(:disabled)'
const subscribeAssets = (listener: () => void) => {
  const unsubscribeAdded = assets.subscribe(listener)
  const unsubscribeReleased = assets.subscribeRelease(() => listener())
  return () => {
    unsubscribeAdded()
    unsubscribeReleased()
  }
}

export default function ContextMenu() {
  const menu = useStore(contextMenuStore); const ref = useRef<HTMLDivElement>(null)
  const layer = useStore(projectStore, state => state.layers.find(item => item.id === menu.layerId))
  const collectionItem = useStore(projectStore, state => (menu.collectionIndex ? state.ingredients.find(item => item.index === menu.collectionIndex) : undefined))
  const hasArtwork = useStore(projectStore, state => state.layers.some(item => item.visible))
  const frameEnabled = useStore(editorStore, state => state.frameEnabled)
  useEffect(() => {
    if (!menu.open) {
      return
    }
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        closeContextMenu()
      }
    }
    addEventListener('pointerdown', dismiss)
    return () => {
      removeEventListener('pointerdown', dismiss); if (previous?.isConnected) {
        previous.focus({preventScroll: true})
      }
    }
  }, [menu.open])
  // An item removed while its menu is open leaves nothing to act on.
  const collection = menu.collectionIndex !== null
  const stale = collection && menu.collectionIndex !== 0 && !collectionItem
  useEffect(() => {
    if (menu.open && stale) {
      closeContextMenu()
    }
  }, [menu.open, stale])
  if (!menu.open || stale) {
    return null
  }
  const run = (action: () => unknown) => {
    closeContextMenu(); Promise.resolve().then(action).catch(error => notify('error', getErrorMessage(error)))
  }
  const button = (label: string, action: () => unknown, disabled = false) => <button disabled={disabled} role='menuitem' type='button' onClick={() => run(action)}>{label}</button>
  const estimatedHeight = collection ? 220 : (layer ? 650 : 420)
  return <div
    className={css.menu} aria-label={collection ? 'Collection context menu' : 'Canvas context menu'} data-overlay-control role='menu' style={{
      top: Math.max(8, Math.min(menu.y, innerHeight - estimatedHeight)),
      left: Math.max(8, Math.min(menu.x, innerWidth - 252)),
    }} ref={ref} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault(); closeContextMenu(); return
      }
      const buttons = [...ref.current!.querySelectorAll<HTMLElement>(focusableSelector)]
      const index = buttons.indexOf(document.activeElement as HTMLElement)
      if (['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const next = event.key === 'Home' ? 0 : (event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length)
        buttons[next]?.focus()
      }
    }}
  >
    {collection && <>
      <strong>{collectionItem ? `![${collectionItem.index}] · ${collectionItem.name}` : `![0] · ${frameEnabled ? 'canvas inside the frame' : 'all canvas artwork'}`}</strong>
      {collectionItem ? <>
        <OrientationRows ingredient={collectionItem} />
        <hr />
        {button('Export', () => exportIngredient(collectionItem))}
        {button('Delete', () => removeIngredient(collectionItem.id))}
      </> : button('Export…', () => openExportDialog('frame'), !hasArtwork)}
    </>}
    {!collection && <>
      {layer && <>
        <strong>{layer.name}</strong>
        {button('Frame it', () => {
          fitFrameToRect(getLayerBounds(layer)); editorStore.set({
            tool: 'frame',
            frameEnabled: true,
          })
        })}
        {layer.kind === 'generated' && layer.evidence && button('Reroll', () => reroll(layer.id))}
        {button('Use as prompt reference', async () => {
          const ingredient = await referenceAsset(layer.assetId, layer.name, layer.kind === 'generated' ? 'generated' : 'import'); insertIntoPrompt(`![${ingredient.index}]`)
        })}
        {button(layer.kind === 'import' ? 'Transform imported image' : 'Generated placement is locked', () => {
          selectLayer(layer.id); editorStore.set({tool: 'image'})
        }, layer.kind !== 'import')}
        {button('Edit mask', () => {
          selectLayer(layer.id); editorStore.set({tool: 'mask'})
        }, projectStore.state.layers[0]?.id === layer.id)}
        {button(layer.visible ? 'Hide layer' : 'Show layer', () => updateLayer(layer.id, {visible: !layer.visible}))}
        {button('Move up', () => moveLayerInStack(layer.id, 1))}
        {button('Move down', () => moveLayerInStack(layer.id, -1))}
        {button('Delete layer', () => removeLayer(layer.id))}
        <hr />
      </>}
      {button('Frame all artwork', () => {
        fitFrameToContent(); editorStore.set({
          tool: 'frame',
          frameEnabled: true,
        })
      })}
      {button(editorStore.state.frameEnabled ? 'Show the frame · F' : 'Show the generation area · F', fitViewToFrame)}
      {button('Show all artwork · Shift+F', fitViewToContent)}
      {button('Zoom in · +', () => zoomBy(1.25))}
      {button('Zoom out · −', () => zoomBy(0.8))}
      <hr />
      {button('Import images to canvas…', async () => importLayers(await pickImageFiles(), menu.world ?? undefined))}
      {button('Add images to collection…', async () => {
        for (const ingredient of await addIngredients(await pickImageFiles())) {
          insertIntoPrompt(`![${ingredient.index}]`)
        }
      })}
      {button('Snapshot the frame into collection', async () => {
        const ingredient = await captureCanvasSnapshot(); insertIntoPrompt(`![${ingredient.index}]`)
      }, !projectStore.state.layers.some(item => item.visible))}
      <hr />
      {button('Undo · Ctrl+Z', undo, !projectStore.meta.state.canUndo)}
      {button('Redo · Ctrl+Shift+Z', redo, !projectStore.meta.state.canRedo)}
    </>}
  </div>
}

/** Rotation and flip of a collection image. The menu stays open, so both can be set one after the other. */
function OrientationRows({ingredient}: {ingredient: Ingredient}) {
  const pending = useStore(orientationStore, state => state.pending.get(ingredient.id))
  const shown = pending ?? getIngredientOrientation(ingredient)
  const available = useSyncExternalStore(subscribeAssets, () => assets.has(getSourceAssetId(ingredient)))
  const apply = async (patch: Partial<Orientation>) => {
    try {
      await setIngredientOrientation(ingredient.id, patch)
    } catch (error) {
      notify('error', getErrorMessage(error))
    }
  }
  return <>
    <label className={css.row}>
      <span>Rotation</span>
      <select aria-busy={Boolean(pending)} aria-label='Rotation' data-testid='collection-rotation' disabled={!available} value={shown.rotation} onChange={event => void apply({rotation: Number(event.currentTarget.value) as Rotation})}>
        {rotations.map(rotation => <option key={rotation} value={rotation}>{rotationTitles[rotation]}</option>)}
      </select>
    </label>
    <label className={css.row}>
      <span>Flip</span>
      <select aria-busy={Boolean(pending)} aria-label='Flip' data-testid='collection-flip' disabled={!available} value={shown.flip} onChange={event => void apply({flip: event.currentTarget.value as Flip})}>
        {flips.map(flip => <option key={flip} value={flip}>{flipTitles[flip]}</option>)}
      </select>
    </label>
  </>
}
