import type {Ingredient} from '#src/lib/state.ts'
import type {MouseEvent} from 'react'

import {X} from 'lucide-react'
import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react'

import {addIngredients, removeIngredient} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {getReferenceText, startIngredientDrag, startReferenceDrag} from '#src/lib/collectionDrag.ts'
import {renderRegion} from '#src/lib/composite.ts'
import {openCollectionMenu} from '#src/lib/contextMenu.ts'
import {pickImageFiles} from '#src/lib/filePicker.ts'
import {getGenerationRegion} from '#src/lib/generationRegion.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {getThumbnailFit} from '#src/lib/thumbnailFit.ts'

import css from './style.module.sass'

const kindTitles: Record<NonNullable<Ingredient['kind']>, string> = {
  import: 'import',
  generated: 'generation',
  snapshot: 'canvas snapshot',
}

const useAssetRevision = () => {
  const revision = useRef(0)
  return useSyncExternalStore(listener => assets.subscribe(() => {
    revision.current++; listener()
  }), () => revision.current, () => 0)
}
const getFit = (ingredient: Ingredient) => {
  const asset = assets.get(ingredient.assetId)
  return asset ? getThumbnailFit(asset.width, asset.height) : getThumbnailFit(1, 1)
}
const openMenu = (event: MouseEvent, index: number) => {
  event.preventDefault()
  openCollectionMenu(event.clientX, event.clientY, index)
}
/** pixels per tile pixel the frame view renders at, so it stays crisp on high-density screens */
const maxFrameViewDensity = 2
const fallbackTileHeight = 76
/** Position 0 of the collection: a live view of `![0]`, the canvas inside the frame (or all artwork while the frame is off). */
function FrameView({assetRevision}: {assetRevision: number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useStore(projectStore, state => state.layers)
  const frame = useStore(editorStore, state => state.frame)
  const frameEnabled = useStore(editorStore, state => state.frameEnabled)
  const modelId = useStore(editorStore, state => state.modelId)
  const ratio = useStore(editorStore, state => state.ratio)
  const region = useMemo(() => getGenerationRegion({
    frame,
    frameEnabled,
    modelId,
    ratio,
  }, layers).frame, [frame, frameEnabled, modelId, ratio, layers])
  const fit = getThumbnailFit(region.width, region.height)
  // Renders at most once per animation frame, so dragging the frame or a layer stays smooth.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const target = canvasRef.current
      if (!target || !(region.width > 0 && region.height > 0)) {
        return
      }
      try {
        const density = Math.min(devicePixelRatio || 1, maxFrameViewDensity)
        const tileHeight = target.clientHeight || fallbackTileHeight
        const tileWidth = target.clientWidth || tileHeight * fit.aspect
        // The tile crops like object-fit: cover, so the region is scaled until it covers both tile dimensions.
        const scale = Math.max(tileWidth * density / region.width, tileHeight * density / region.height)
        const {canvas} = renderRegion({
          layers,
          region,
          size: {
            width: Math.max(1, Math.round(region.width * scale)),
            height: Math.max(1, Math.round(region.height * scale)),
          },
          measureEmpty: false,
        })
        target.width = canvas.width
        target.height = canvas.height
        target.getContext('2d')?.drawImage(canvas, 0, 0)
      } catch {
        // Without a working 2D canvas the tile keeps its last picture; the viewport reports rendering errors.
      }
    })
    return () => cancelAnimationFrame(id)
  }, [layers, region, fit.aspect, assetRevision])
  const reference = getReferenceText({index: 0})
  return <div
    className={css.tile}
    data-crop={fit.crop}
    data-index={0}
    data-kind='canvas'
    data-testid='frame-view'
    draggable
    style={{aspectRatio: String(fit.aspect)}}
    onContextMenu={event => openMenu(event, 0)}
    onDragStart={event => startReferenceDrag(event.dataTransfer, 0)}
  >
    <button
      className={css.insert}
      aria-label={`Insert ${reference} · ${frameEnabled ? 'canvas inside the frame' : 'all canvas artwork'}`}
      title={`${reference} · live view of the ${frameEnabled ? 'canvas inside the frame' : 'generation area spanning all artwork'}${fit.crop ? ' · thumbnail cropped' : ''}\nClick to reference it in the prompt, or drag it into the prompt. Right-click to export.`}
      type='button'
      onClick={() => insertIntoPrompt(reference)}
    >
      <canvas aria-hidden ref={canvasRef} />
      <span className={css.number}>0</span>
    </button>
  </div>
}
/** The collection: the live frame view, then every numbered image as an equally tall thumbnail. Click inserts its reference; drag it onto the canvas or into the prompt. */
export default function Ingredients() {
  const ingredients = useStore(projectStore, state => state.ingredients)
  const assetRevision = useAssetRevision()
  const addFiles = async () => {
    try {
      for (const item of await addIngredients(await pickImageFiles())) {
        insertIntoPrompt(getReferenceText(item))
      }
    } catch (error) {
      notify('error', getErrorMessage(error))
    }
  }
  return <section className={css.container} aria-label='Image collection' data-testid='ingredients'>
    <div className={css.grid}>
      <FrameView assetRevision={assetRevision} />
      {ingredients.map(ingredient => {
        const fit = getFit(ingredient)
        return <div
          key={ingredient.id}
          className={css.tile}
          data-crop={fit.crop}
          data-index={ingredient.index}
          data-kind={ingredient.kind ?? 'import'}
          data-testid='ingredient'
          draggable
          style={{aspectRatio: String(fit.aspect)}}
          onContextMenu={event => openMenu(event, ingredient.index)}
          onDragStart={event => startIngredientDrag(event.dataTransfer, ingredient)}
        >
          <button
            className={css.insert}
            aria-label={`Insert ${getReferenceText(ingredient)} · ${ingredient.name}`}
            title={`${getReferenceText(ingredient)} · ${ingredient.name} (${kindTitles[ingredient.kind ?? 'import']})${fit.crop ? ' · thumbnail cropped' : ''}\nClick to reference it in the prompt, or drag it onto the canvas or into the prompt. Right-click to export.`}
            type='button'
            onClick={() => insertIntoPrompt(getReferenceText(ingredient))}
          >
            {ingredient.thumbnail && <img alt='' draggable={false} src={ingredient.thumbnail} />}
            <span className={css.number}>{ingredient.index}</span>
          </button>
          <button
            className={css.remove}
            aria-label={`Remove ${getReferenceText(ingredient)} from the collection`}
            title='Remove from the collection; other numbers never change'
            type='button'
            onClick={() => removeIngredient(ingredient.id)}
          ><X aria-hidden size={11} strokeWidth={2} /></button>
        </div>
      })}
      {!ingredients.length && <button className={css.empty} type='button' onClick={() => void addFiles()}>Drop, paste or choose images for the collection</button>}
    </div>
  </section>
}
