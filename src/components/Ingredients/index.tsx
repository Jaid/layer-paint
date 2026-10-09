import type {ThumbnailFit} from '#src/lib/thumbnailFit.ts'
import type {Ingredient} from '#src/lib/state.ts'
import type {MouseEvent, ReactNode} from 'react'

import {useEffect, useId, useMemo, useRef, useSyncExternalStore} from 'react'

import {addIngredients} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {getReferenceText, startIngredientDrag, startReferenceDrag} from '#src/lib/collectionDrag.ts'
import {setHoveredCollectionIndex} from '#src/lib/collectionHover.ts'
import {renderRegion} from '#src/lib/composite.ts'
import {openCollectionMenu} from '#src/lib/contextMenu.ts'
import {pickImageFiles} from '#src/lib/filePicker.ts'
import {getGenerationRegion} from '#src/lib/generationRegion.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {getAssetOccurrences} from '#src/lib/revisions.ts'
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
const openMenu = (event: MouseEvent, index: number) => {
  event.preventDefault()
  openCollectionMenu(event.clientX, event.clientY, index)
}
/** pixels per tile pixel the frame view renders at, so it stays crisp on high-density screens */
const maxFrameViewDensity = 2
const fallbackTileHeight = 76
/** distance kept between an unrolled picture and the window edges */
const unrollMargin = 8

type Size = {
  height: number
  width: number
}

/** where the uncropped picture goes: centered on the tile, as tall (or as wide) as the tile, kept inside the window */
const getUnrollRect = (tile: DOMRect, aspect: number, crop: NonNullable<ThumbnailFit['crop']>) => {
  const width = crop === 'horizontal' ? tile.height * aspect : tile.width
  const height = crop === 'horizontal' ? tile.height : tile.width / aspect
  const clamp = (value: number, size: number, limit: number) => Math.min(Math.max(value, unrollMargin), Math.max(unrollMargin, limit - size - unrollMargin))
  return {
    left: clamp(tile.left + (tile.width - width) / 2, width, innerWidth),
    top: clamp(tile.top + (tile.height - height) / 2, height, innerHeight),
    width,
    height,
  }
}

type TileProps = {
  'aria-label': string
  /** draws the uncropped picture into a canvas instead of showing an image URL */
  drawUnrolled?: (canvas: HTMLCanvasElement, size: Size) => void
  /** width ÷ height of the complete picture */
  fullAspect: number
  index: number
  kind: string
  media: ReactNode
  onDragStart: (dataTransfer: DataTransfer) => void
  testId: string
  tooltip: ReactNode
  /** URL of the uncropped picture */
  unrolledSource?: string
}

/** A collection tile. Hovering it reveals a rich tooltip above it and, if the thumbnail is cropped, the complete picture in place. */
function Tile({drawUnrolled, fullAspect, index, kind, media, onDragStart, testId, tooltip, unrolledSource, ...props}: TileProps) {
  const fit = getThumbnailFit(fullAspect, 1)
  const tooltipId = `collection-tooltip-${useId()}`
  const tileRef = useRef<HTMLDivElement>(null)
  const unrollRef = useRef<HTMLElement | null>(null)
  const setUnrollElement = (element: HTMLElement | null) => {
    unrollRef.current = element
  }
  const tooltipRef = useRef<HTMLDivElement>(null)
  const reference = getReferenceText({index})
  const canUnroll = Boolean(fit.crop && (unrolledSource || drawUnrolled))
  const unroll = () => {
    const tile = tileRef.current; const element = unrollRef.current
    if (!tile || !element || !fit.crop || element.matches(':popover-open')) {
      return
    }
    const rect = getUnrollRect(tile.getBoundingClientRect(), fullAspect, fit.crop)
    Object.assign(element.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    // The tooltip keeps clear of a picture that grows above and below the tile.
    tooltipRef.current?.style.setProperty('--unroll-overflow', `${Math.max(0, (rect.height - tile.offsetHeight) / 2)}px`)
    if (element instanceof HTMLCanvasElement && drawUnrolled) {
      drawUnrolled(element, rect)
    }
    element.showPopover?.()
  }
  const rollUp = () => {
    if (unrollRef.current?.matches(':popover-open')) {
      unrollRef.current.hidePopover()
    }
  }
  const leave = () => {
    rollUp()
    if (editorStore.state.hoveredCollectionIndex === index) {
      setHoveredCollectionIndex(null)
    }
  }
  // A tile that disappears while hovered must not leave its highlights behind.
  useEffect(() => () => {
    if (editorStore.state.hoveredCollectionIndex === index) {
      setHoveredCollectionIndex(null)
    }
  }, [index])
  return <div
    className={css.tile}
    data-crop={fit.crop}
    data-index={index}
    data-kind={kind}
    data-testid={testId}
    draggable
    style={{aspectRatio: String(fit.aspect)}}
    ref={tileRef}
    onContextMenu={event => {
      leave(); openMenu(event, index)
    }}
    onDragStart={event => {
      leave(); onDragStart(event.dataTransfer)
    }}
    onPointerEnter={() => {
      setHoveredCollectionIndex(index)
      if (canUnroll) {
        unroll()
      }
    }}
    onPointerLeave={leave}
  >
    <button
      className={css.insert}
      aria-label={props['aria-label']}
      interestfor={tooltipId}
      type='button'
      onClick={() => insertIntoPrompt(reference)}
    >
      {media}
      <span className={css.number}>{index}</span>
    </button>
    {canUnroll && (unrolledSource ? <img
      className={css.unroll} alt='' data-testid='unrolled' draggable={false} popover='manual' src={unrolledSource} ref={setUnrollElement}
    /> : <canvas className={css.unroll} aria-hidden data-testid='unrolled' popover='manual' ref={setUnrollElement} />)}
    <div id={tooltipId} className={css.tooltip} popover='hint' role='tooltip' ref={tooltipRef}>{tooltip}</div>
  </div>
}

function TooltipContent({index, kind, title, details}: {
  details: ReadonlyArray<string>
  index: number
  kind: string
  title: string
}) {
  return <>
    <span className={css.tooltipTitle} data-kind={kind}><span className={css.number}>{index}</span><strong>{title}</strong></span>
    {details.map(detail => <span key={detail} className={css.tooltipDetail}>{detail}</span>)}
  </>
}

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
  const drawUnrolled = (target: HTMLCanvasElement, size: Size) => {
    try {
      const density = Math.min(devicePixelRatio || 1, maxFrameViewDensity)
      const {canvas} = renderRegion({
        layers,
        region,
        size: {
          width: Math.max(1, Math.round(size.width * density)),
          height: Math.max(1, Math.round(size.height * density)),
        },
        measureEmpty: false,
      })
      target.width = canvas.width
      target.height = canvas.height
      target.getContext('2d')?.drawImage(canvas, 0, 0)
    } catch {
      // The unrolled view is a convenience; the tile itself still shows the cropped picture.
    }
  }
  const area = frameEnabled ? 'canvas inside the frame' : 'all canvas artwork'
  return <Tile
    aria-label={`Insert ![0] · ${area}`}
    drawUnrolled={drawUnrolled}
    fullAspect={region.width / region.height}
    index={0}
    kind='canvas'
    media={<canvas aria-hidden ref={canvasRef} />}
    testId='frame-view'
    tooltip={<TooltipContent details={[`Live view of the ${frameEnabled ? 'canvas inside the frame' : 'generation area spanning all artwork'}`, 'Click to reference it in the prompt or drag it into the prompt', 'Right-click to export']} index={0} kind='canvas' title={frameEnabled ? 'Canvas inside the frame' : 'All canvas artwork'} />}
    onDragStart={dataTransfer => startReferenceDrag(dataTransfer, 0)}
  />
}
function IngredientTile({ingredient}: {ingredient: Ingredient}) {
  const asset = assets.get(ingredient.assetId)
  const layers = useStore(projectStore, state => state.layers)
  const occurrences = getAssetOccurrences(layers, ingredient.assetId)
  const buried = occurrences.filter(item => item.buried).length
  const kind = ingredient.kind ?? 'import'
  const reference = getReferenceText(ingredient)
  const layerCount = (count: number) => `${count} layer${count === 1 ? '' : 's'}`
  const shown = occurrences.length - buried
  const usage = [shown && `Shown by ${layerCount(shown)}`, buried && `Unselected revision in ${layerCount(buried)}`].filter(Boolean).join(' · ') || 'Not on the canvas'
  return <Tile
    aria-label={`Insert ${reference} · ${ingredient.name}`}
    fullAspect={asset ? asset.width / asset.height : 1}
    index={ingredient.index}
    kind={kind}
    media={ingredient.thumbnail && <img alt='' draggable={false} src={ingredient.thumbnail} />}
    testId='ingredient'
    tooltip={<TooltipContent details={[[kindTitles[kind], asset && `${asset.width} × ${asset.height} px`].filter(Boolean).join(' · '), usage, 'Click to reference it in the prompt, or drag it into the prompt or onto the canvas', 'Right-click to export or delete']} index={ingredient.index} kind={kind} title={ingredient.name} />}
    unrolledSource={asset?.url ?? (ingredient.thumbnail || undefined)}
    onDragStart={dataTransfer => startIngredientDrag(dataTransfer, ingredient)}
  />
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
      {ingredients.map(ingredient => <IngredientTile key={ingredient.id} ingredient={ingredient} />)}
      {!ingredients.length && <button className={css.empty} type='button' onClick={() => void addFiles()}>Drop, paste or choose images for the collection</button>}
    </div>
  </section>
}
