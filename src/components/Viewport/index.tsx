import type {Point, Rect} from '#src/lib/geometry.ts'
import type {Corner, FrameEdge, SnapGuides, SnapTargets} from '#src/lib/interaction.ts'
import type {Layer, View} from '#src/lib/state.ts'
import type {DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent} from 'react'

import clsx from 'clsx'
import {useEffect, useRef, useState} from 'react'

import JobOverlay from '#component/JobOverlay'
import {fitFrameToRect, selectLayer, setFrame, updateLayer} from '#src/lib/actions.ts'
import {getDroppedIngredient, isIngredientDrag} from '#src/lib/collectionDrag.ts'
import {findLayerAt, renderRegion} from '#src/lib/composite.ts'
import {openContextMenu} from '#src/lib/contextMenu.ts'
import {rectCenter, rectContains, rectFromCenter} from '#src/lib/geometry.ts'
import {corners, getSnapTargets, moveRectWithSnapping, resizeFrameFromEdge, resizeRectFromCorner} from '#src/lib/interaction.ts'
import {getLayerBounds, layerToWorld, worldToLayer} from '#src/lib/layerGeometry.ts'
import {getFeatherCore, getMaskMetrics} from '#src/lib/mask.ts'
import {getModel} from '#src/lib/models/index.ts'
import {getContentRegion} from '#src/lib/generationRegion.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {screenToWorld, setViewportSize, worldToScreen, zoomView} from '#src/lib/viewport.ts'
import {placeIngredient} from '#src/lib/workspaceIO.ts'

import css from './style.module.sass'

type DragKind = 'frame-edge' | 'frame-move' | 'frame-resize' | 'image-move' | 'image-resize' | 'image-rotate' | 'mask-move' | 'pan'
type Drag = {
  corner?: Corner
  edge?: FrameEdge
  frame: Rect
  key: string
  kind: DragKind
  layer?: Layer
  moved: boolean
  point: Point
  pointerId: number
  targets: SnapTargets
  view: View
  world: Point
}
const toScreenRect = (view: View, rect: Rect): Rect => ({
  ...worldToScreen(view, rect),
  width: rect.width * view.scale,
  height: rect.height * view.scale,
})
const rectStyle = (rect: Rect, rotation = 0) => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
  transform: `rotate(${rotation}deg)`,
})
export default function Viewport() {
  const ref = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const drag = useRef<Drag | null>(null)
  const editor = useStore(editorStore); const layers = useStore(projectStore, state => state.layers)
  const [size, setSize] = useState({
    width: 800,
    height: 600,
  })
  const [dragKind, setDragKind] = useState<DragKind | null>(null); const [guides, setGuides] = useState<SnapGuides>({})
  const [space, setSpace] = useState(false); const [frameTouched, setFrameTouched] = useState(false)
  const renderError = useRef('')
  useEffect(() => {
    if (!ref.current) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }
      setSize(next); setViewportSize(next)
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const target = canvasRef.current
      if (!target) {
        return
      }
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const view = editor.view
      try {
        const region = {
          ...screenToWorld(view, {
            x: 0,
            y: 0,
          }),
          width: size.width / view.scale,
          height: size.height / view.scale,
        }
        const result = renderRegion({
          layers,
          region,
          size: {
            width: size.width * dpr,
            height: size.height * dpr,
          },
          measureEmpty: false,
        })
        target.width = result.canvas.width; target.height = result.canvas.height
        target.getContext('2d')!.drawImage(result.canvas, 0, 0)
        renderError.current = ''
      } catch (error) {
        const message = getErrorMessage(error)
        if (renderError.current !== message) {
          renderError.current = message; notify('error', `Canvas rendering failed: ${message}`)
        }
      }
    })
    return () => cancelAnimationFrame(id)
  }, [layers, editor.view, size])
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect(); const view = editorStore.state.view
      const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? bounds.height : 1)
      const dx = event.deltaX * unit; const dy = event.deltaY * unit
      if (event.shiftKey || !event.ctrlKey && dx !== 0) {
        editorStore.set({view: {
          ...view,
          x: view.x - (event.shiftKey && dx === 0 ? dy : dx),
          y: view.y - (event.shiftKey && dx === 0 ? 0 : dy),
        }})
      } else {
        editorStore.set({view: zoomView(view, Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015)), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        })})
      }
    }
    element.addEventListener('wheel', wheel, {passive: false})
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, .monaco-editor')))
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !editable(event.target)) {
        event.preventDefault(); setSpace(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpace(false)
      }
    }
    const blur = () => {
      setSpace(false); drag.current = null; setDragKind(null); setGuides({})
    }
    addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', blur)
    return () => {
      element.removeEventListener('wheel', wheel); removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur)
    }
  }, [])
  const pointOf = (event: {
    clientX: number
    clientY: number
  }) => {
    const bounds = ref.current!.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }
  const begin = (event: ReactPointerEvent, kind: DragKind, layer?: Layer, corner?: Corner, edge?: FrameEdge) => {
    const view = editorStore.state.view; const point = pointOf(event)
    const targets = getSnapTargets(projectStore.state.layers.filter(item => item.visible && item.id !== layer?.id).map(item => getLayerBounds(item)))
    drag.current = {
      kind,
      pointerId: event.pointerId,
      point,
      world: screenToWorld(view, point),
      view,
      frame: {...editorStore.state.frame},
      layer,
      corner,
      edge,
      targets,
      key: `gesture:${performance.now()}`,
      moved: false,
    }
    setDragKind(kind)
    ref.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (![0, 1].includes(event.button) || (event.target as HTMLElement).closest('[data-overlay-control]')) {
      return
    }
    ref.current?.focus({preventScroll: true})
    const target = event.target as HTMLElement; const state = editorStore.state
    const world = screenToWorld(state.view, pointOf(event))
    const selected = projectStore.state.layers.find(item => item.id === state.selectedLayerId)
    const layerCorner = target.closest<HTMLElement>('[data-layer-corner]')?.dataset.layerCorner as Corner | undefined
    if (event.button === 1 || space) {
      begin(event, 'pan'); return
    }
    if (selected?.kind === 'import' && layerCorner) {
      begin(event, 'image-resize', selected, layerCorner); return
    }
    if (selected?.kind === 'import' && target.closest('[data-layer-rotate]')) {
      begin(event, 'image-rotate', selected); return
    }
    if (state.tool === 'mask' && selected && projectStore.state.layers[0]?.id !== selected.id && rectContains(getLayerBounds(selected), world)) {
      begin(event, 'mask-move', selected); return
    }
    const corner = target.closest<HTMLElement>('[data-corner]')?.dataset.corner as Corner | undefined
    const edge = target.closest<HTMLElement>('[data-edge]')?.dataset.edge as FrameEdge | undefined
    // With no artwork the frame is locked: it can neither be moved nor scaled.
    const frameEditable = state.tool === 'frame' && state.frameEnabled && projectStore.state.layers.length > 0
    if (frameEditable && corner) {
      begin(event, 'frame-resize', undefined, corner); return
    }
    if (frameEditable && edge) {
      begin(event, 'frame-edge', undefined, undefined, edge); return
    }
    const hit = findLayerAt(projectStore.state.layers, world)
    // With no artwork there is nothing to frame, so a press inside the frame pans instead of moving it.
    if (!frameEditable || event.ctrlKey || event.metaKey || event.altKey || !rectContains(state.frame, world)) {
      selectLayer(hit?.id ?? null)
      if (hit?.kind === 'import' && state.tool !== 'mask') {
        begin(event, 'image-move', hit); return
      }
      begin(event, 'pan'); return
    }
    begin(event, 'frame-move')
  }
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointOf(event); const state = editorStore.state; const world = screenToWorld(state.view, point); const active = drag.current
    if (!active) {
      const frame = toScreenRect(state.view, state.frame); const distance = 14
      if (!state.frameEnabled) {
        setFrameTouched(false)
      }
      const expanded = {
        x: frame.x - distance,
        y: frame.y - distance,
        width: frame.width + distance * 2,
        height: frame.height + distance * 2,
      }
      const near = rectContains(expanded, point) && (Math.min(Math.abs(point.x - frame.x), Math.abs(point.x - frame.x - frame.width)) <= distance || Math.min(Math.abs(point.y - frame.y), Math.abs(point.y - frame.y - frame.height)) <= distance)
      setFrameTouched(near && state.frameEnabled && projectStore.state.layers.length > 0)
      const hit = findLayerAt(projectStore.state.layers, world)
      if (state.hoveredLayerId !== (hit?.id ?? null)) {
        editorStore.set({hoveredLayerId: hit?.id ?? null})
      }
      return
    }
    if (event.pointerId !== active.pointerId) {
      return
    }
    if (!active.moved && Math.hypot(point.x - active.point.x, point.y - active.point.y) < 2) {
      return
    }
    active.moved = true
    const threshold = event.shiftKey ? 0 : 8 / state.view.scale
    const delta = {
      x: world.x - active.world.x,
      y: world.y - active.world.y,
    }
    const options = {
      coalesceKey: active.key,
      coalesceWindow: Infinity,
    }
    if (active.kind === 'pan') {
      editorStore.set({view: {
        ...active.view,
        x: active.view.x + point.x - active.point.x,
        y: active.view.y + point.y - active.point.y,
      }}); return
    }
    if (active.kind === 'frame-move') {
      const result = moveRectWithSnapping(active.frame, delta, threshold ? active.targets : undefined, threshold)
      setFrame(result.rect); setGuides(result.guides); return
    }
    if (active.kind === 'frame-resize') {
      const result = resizeRectFromCorner({
        start: active.frame,
        corner: active.corner!,
        aspect: active.frame.width / active.frame.height,
        pointer: world,
        minWidth: Math.max(16, 24 / state.view.scale),
        fromCenter: event.altKey,
        snapTargets: threshold ? active.targets : undefined,
        snapThreshold: threshold,
      })
      setFrame(result.rect); setGuides(result.guides); return
    }
    if (active.kind === 'frame-edge') {
      const result = resizeFrameFromEdge(active.frame, active.edge!, world, getModel(state.modelId).aspectRatios)
      editorStore.set({
        frame: result.rect,
        ratio: result.ratio,
      }); return
    }
    const layer = active.layer!
    if (active.kind === 'image-move') {
      const bounds = getLayerBounds(layer)
      const targets = getSnapTargets([state.frame])
      const result = moveRectWithSnapping(bounds, delta, threshold ? {
        x: [...active.targets.x, ...targets.x],
        y: [...active.targets.y, ...targets.y],
      } : undefined, threshold)
      updateLayer(layer.id, {rect: {
        ...layer.rect,
        x: layer.rect.x + result.rect.x - bounds.x,
        y: layer.rect.y + result.rect.y - bounds.y,
      }}, options)
      setGuides(result.guides); return
    }
    if (active.kind === 'image-resize') {
      const local = worldToLayer(layer, world)
      const result = resizeRectFromCorner({
        start: {
          x: 0,
          y: 0,
          width: layer.rect.width,
          height: layer.rect.height,
        },
        corner: active.corner!,
        aspect: layer.rect.width / layer.rect.height,
        pointer: local,
        minWidth: 16,
        fromCenter: event.altKey,
      })
      const center = layerToWorld(layer, rectCenter(result.rect))
      updateLayer(layer.id, {rect: rectFromCenter(center, result.rect)}, options); return
    }
    if (active.kind === 'image-rotate') {
      const center = rectCenter(layer.rect)
      let angle = (layer.rotation ?? 0) + (Math.atan2(world.y - center.y, world.x - center.x) - Math.atan2(active.world.y - center.y, active.world.x - center.x)) * 180 / Math.PI
      if (event.shiftKey) {
        angle = Math.round(angle / 15) * 15
      }
      updateLayer(layer.id, {rotation: angle}, options); return
    }
    if (active.kind === 'mask-move') {
      const local = worldToLayer(layer, world); const start = worldToLayer(layer, active.world)
      updateLayer(layer.id, {
        offsetX: (layer.offsetX ?? 0) + (local.x - start.x) / layer.rect.width,
        offsetY: (layer.offsetY ?? 0) + (local.y - start.y) / layer.rect.height,
      }, options)
    }
  }
  const end = (event: ReactPointerEvent) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) {
      return
    }
    if (active.kind === 'frame-move' && !active.moved) {
      selectLayer(findLayerAt(projectStore.state.layers, active.world)?.id ?? null)
    }
    drag.current = null; setDragKind(null); setGuides({})
    if (ref.current?.hasPointerCapture(event.pointerId)) {
      ref.current.releasePointerCapture(event.pointerId)
    }
  }
  const dropIngredient = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isIngredientDrag(event.dataTransfer)) {
      return
    }
    event.preventDefault(); event.stopPropagation()
    const ingredient = getDroppedIngredient(event.dataTransfer)
    if (!ingredient) {
      return
    }
    try {
      placeIngredient(ingredient, screenToWorld(editorStore.state.view, pointOf(event)))
    } catch (error) {
      notify('error', getErrorMessage(error))
    }
  }
  const {view, frame, frameEnabled, tool, selectedLayerId, hoveredLayerId, jobs} = editor
  // While the frame is off, hovering Generate previews the region that spans all artwork.
  const contentRegion = !frameEnabled && editor.generationHover ? getContentRegion(layers, getModel(editor.modelId).aspectRatios) : undefined
  const selected = layers.find(layer => layer.id === selectedLayerId)
  const outlined = layers.filter(layer => layer.visible && (layer.id === selectedLayerId || layer.id === hoveredLayerId))
  const frameScreen = toScreenRect(view, frame)
  const grid = 32 * 2 ** Math.round(Math.log2(1 / view.scale)) * view.scale
  const frameLocked = !layers.length
  const handles = tool === 'frame' && !frameLocked && (frameTouched || Boolean(dragKind?.startsWith('frame')))
  return <div
    className={clsx(css.viewport, dragKind && css.dragging)} aria-label='Canvas' data-testid='viewport' data-tool={tool} data-viewport role='application' style={{
      cursor: dragKind === 'pan' ? 'grabbing' : space ? 'grab' : tool === 'mask' ? 'move' : undefined,
      backgroundSize: `${grid}px ${grid}px`,
      backgroundPosition: `${view.x}px ${view.y}px`,
    }} tabIndex={0} ref={ref}
    onDragOver={event => {
      if (isIngredientDrag(event.dataTransfer)) {
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'
      }
    }} onDrop={dropIngredient}
    onContextMenu={event => {
      event.preventDefault(); const world = screenToWorld(editorStore.state.view, pointOf(event)); const hit = findLayerAt(projectStore.state.layers, world); openContextMenu(event.clientX, event.clientY, hit?.id ?? null, world)
    }} onDoubleClick={event => {
      const layer = findLayerAt(layers, screenToWorld(editorStore.state.view, pointOf(event))); if (layer) {
        fitFrameToRect(getLayerBounds(layer)); editorStore.set({
          tool: 'frame',
          frameEnabled: true,
        })
      }
    }} onKeyDown={event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        event.preventDefault(); const box = ref.current!.getBoundingClientRect(); openContextMenu(box.left + box.width / 2, box.top + box.height / 2, selectedLayerId)
      }
    }} onPointerCancel={end}
    onPointerDown={onDown}
    onPointerLeave={() => {
      if (!drag.current) {
        setFrameTouched(false); editorStore.set({hoveredLayerId: null})
      }
    }}
    onPointerMove={onMove}
    onPointerUp={end}
  >
    <canvas className={css.scene} aria-hidden data-testid='scene' ref={canvasRef} />
    {outlined.map(layer => <LayerOutline key={layer.id} layer={layer} masked={layers[0]?.id !== layer.id} transform={layer.id === selectedLayerId && layer.kind === 'import' && tool === 'image'} view={view} />)}
    {jobs.map(job => <JobOverlay key={job.id} job={job} rect={toScreenRect(view, job.rect)} />)}
    {tool !== 'mask' && frameEnabled && <div className={clsx(css.frame, handles && css.handlesVisible, editor.generationHover && css.charged, dragKind?.startsWith('frame') && css.activeFrame)} data-testid='frame' style={rectStyle(frameScreen)}>
      {tool === 'frame' && !frameLocked && <>
        {corners.map(corner => <div key={corner} className={clsx(css.handle, css[corner])} data-corner={corner} title='Resize frame; aspect ratio stays locked' />)}
        {(['n', 'e', 's', 'w'] as const).map(edge => <div key={edge} className={clsx(css.edgeHandle, css[edge])} data-edge={edge} title='Drag to snap between model-supported aspect ratios' />)}
      </>}
    </div>}
    {tool !== 'mask' && contentRegion && <div className={clsx(css.frame, css.charged, css.contentRegion)} data-testid='content-region' style={rectStyle(toScreenRect(view, contentRegion.frame))} />}
    {tool === 'mask' && <div className={css.modeHint}>{selected ? 'Mask edit · drag to reposition · Escape to leave' : 'Select a non-background layer to edit its mask'}</div>}
    {guides.x !== undefined && <div
      className={css.guideX} style={{left: worldToScreen(view, {
        x: guides.x,
        y: 0,
      }).x}}
    />}
    {guides.y !== undefined && <div
      className={css.guideY} style={{top: worldToScreen(view, {
        x: 0,
        y: guides.y,
      }).y}}
    />}
  </div>
}

function LayerOutline({layer, view, masked, transform}: {
  layer: Layer
  masked: boolean
  transform: boolean
  view: View
}) {
  const screen = toScreenRect(view, layer.rect); const metrics = getMaskMetrics(layer, layer.rect)
  const core = getFeatherCore(layer, layer.rect); const inner = core.inset
  return <div className={clsx(css.selection, layer.kind === 'generated' && css.generatedSelection)} data-testid='layer-outline' style={rectStyle(screen, layer.rotation)}>
    {masked && layer.area < 1 && <div
      className={css.maskOutline} data-testid='mask-outline' style={{
        left: metrics.x * view.scale,
        top: metrics.y * view.scale,
        width: metrics.width * view.scale,
        height: metrics.height * view.scale,
        borderRadius: metrics.radius * view.scale,
      }}
    />}
    {masked && layer.feather > 0 && <div
      className={css.featherOutline} data-testid='feather-outline' style={{
        left: (metrics.x + inner) * view.scale,
        top: (metrics.y + inner) * view.scale,
        width: Math.max(0, metrics.width - inner * 2) * view.scale,
        height: Math.max(0, metrics.height - inner * 2) * view.scale,
        borderRadius: core.radius * view.scale,
      }}
    />}
    {transform && <>
      {corners.map(corner => <div key={corner} className={clsx(css.imageHandle, css[corner])} aria-label={`Resize imported layer ${corner}`} data-layer-corner={corner} />)}
      <div className={css.rotationHandle} aria-label='Rotate imported layer' data-layer-rotate title='Rotate · hold Shift for 15° increments' />
    </>}
  </div>
}
