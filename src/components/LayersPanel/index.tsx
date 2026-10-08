import type {Layer} from '#src/lib/state.ts'

import clsx from 'clsx'
import {ChevronDown, Eye, EyeOff, Layers, Lock} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

import IconButton from '#component/IconButton'
import {selectLayer, updateLayer} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {openContextMenu} from '#src/lib/contextMenu.ts'
import {getMaskAlpha} from '#src/lib/mask.ts'
import {defaultGeneratedMask, defaultImportedMask, editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

type MaskProperty = 'area' | 'feather' | 'offsetX' | 'offsetY' | 'roundness'
export default function LayersPanel() {
  const layers = useStore(projectStore, state => state.layers); const editor = useStore(editorStore)
  return <section className={clsx(css.panel, editor.layersPanelOpen && css.open)} aria-label='Layers' data-overlay-control data-testid='layers-panel'>
    <button className={css.header} aria-expanded={editor.layersPanelOpen} type='button' onClick={() => editorStore.set({layersPanelOpen: !editor.layersPanelOpen})}><Layers size={14} /><span>Layers</span><span className={css.count}>{layers.length}</span><ChevronDown className={css.chevron} size={14} /></button>
    {editor.layersPanelOpen && <>
      <ol className={css.list}>{layers.map((layer, index) => ({
        layer,
        index,
      })).toReversed().map(({layer, index}) => <LayerRow key={layer.id} background={index === 0} layer={layer} selected={layer.id === editor.selectedLayerId} />)}</ol>
    </>}
  </section>
}
function MaskSlider({layer, property, label, min = 0, max = 100}: {
  label: string
  layer: Layer
  max?: number
  min?: number
  property: MaskProperty
}) {
  const value = layer[property] ?? 0
  return <label className={css.slider}><span>{label}</span><input aria-label={`${label} of ${layer.name}`} max={max} min={min} step={1} type='range' value={Math.round(value * 100)} onChange={event => updateLayer(layer.id, {[property]: Number(event.currentTarget.value) / 100}, {coalesceKey: `${property}:${layer.id}`})} /><output>{Math.round(value * 100)}%</output></label>
}
function TransformFields({layer}: {layer: Layer}) {
  const [locked, setLocked] = useState(true)
  const edit = (field: 'height' | 'width' | 'x' | 'y', value: number) => {
    if (!Number.isFinite(value) || (field === 'width' || field === 'height') && value <= 0) {
      return
    }
    const rect = {
      ...layer.rect,
      [field]: value,
    }
    if (locked && field === 'width') {
      rect.height = value / (layer.rect.width / layer.rect.height)
    }
    if (locked && field === 'height') {
      rect.width = value * layer.rect.width / layer.rect.height
    }
    updateLayer(layer.id, {rect}, {coalesceKey: `${field}:${layer.id}`})
  }
  return <div className={css.transformFields}>
    {(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}><span>{field === 'width' ? 'Width' : (field === 'height' ? 'Height' : field.toUpperCase())}</span><input aria-label={`${field} of ${layer.name}`} step={1} type='number' value={Math.round(layer.rect[field] * 100) / 100} onChange={event => edit(field, Number(event.currentTarget.value))} /></label>)}
    <label><span>Rotation</span><input aria-label={`Rotation of ${layer.name}`} step={1} type='number' value={Math.round(layer.rotation ?? 0)} onChange={event => updateLayer(layer.id, {rotation: Number(event.currentTarget.value)}, {coalesceKey: `rotation:${layer.id}`})} /></label>
    <label className={css.checkbox}><input checked={locked} type='checkbox' onChange={event => setLocked(event.currentTarget.checked)} />Lock ratio</label>
  </div>
}
function LayerRow({layer, background, selected}: {
  background: boolean
  layer: Layer
  selected: boolean
}) {
  const asset = assets.get(layer.assetId); const tool = useStore(editorStore, state => state.tool)
  const editingMask = selected && tool === 'mask'
  const [renaming, setRenaming] = useState(false)
  const finish = (value: string) => {
    setRenaming(false); if (value.trim()) {
      updateLayer(layer.id, {name: value.trim()})
    }
  }
  const chooseImage = () => {
    selectLayer(layer.id)
    if (editorStore.state.tool === 'mask') {
      editorStore.set({tool: 'frame'})
    }
  }
  const toggleMaskEdit = () => {
    if (editingMask) {
      editorStore.set({tool: 'frame'}); return
    }
    selectLayer(layer.id); editorStore.set({tool: 'mask'})
  }
  return <li
    className={clsx(css.row, selected && css.selected, !layer.visible && css.hidden)} data-kind={layer.kind} data-testid='layer-row'
    onContextMenu={event => {
      event.preventDefault(); selectLayer(layer.id); openContextMenu(event.clientX, event.clientY, layer.id)
    }} onMouseEnter={() => editorStore.set({hoveredLayerId: layer.id})}
    onMouseLeave={() => editorStore.set({hoveredLayerId: null})}
  >
    <div className={css.rowMain}>
      <button className={clsx(css.choose, selected && !editingMask && css.targeted)} aria-pressed={selected && !editingMask} title={`Select ${layer.name}`} type='button' onClick={chooseImage}>
        <span className={css.thumbnail}>{asset && <img alt='' draggable={false} src={asset.url} />}</span>
      </button>
      {background ? <span className={css.maskPlaceholder} aria-hidden /> : <button
        className={clsx(css.choose, editingMask && css.targeted)}
        aria-label={editingMask ? `Finish editing the mask of ${layer.name}` : `Edit the mask of ${layer.name}`}
        aria-pressed={editingMask}
        data-testid='mask-thumbnail'
        title={editingMask ? 'Finish mask edit' : 'Edit mask'}
        type='button'
        onClick={toggleMaskEdit}
      ><MaskThumbnail layer={layer} /></button>}
      <div className={css.meta}>
        {renaming ? <input
          className={css.nameInput} aria-label='Layer name' autoFocus defaultValue={layer.name} onBlur={event => finish(event.currentTarget.value)} onKeyDown={event => {
            if (event.key === 'Enter') {
              finish(event.currentTarget.value)
            } else if (event.key === 'Escape') {
              setRenaming(false)
            }
          }}
        /> : <button className={css.name} title={`${layer.name} · double-click to rename`} type='button' onClick={chooseImage} onDoubleClick={() => setRenaming(true)}>{layer.name}</button>}
        <span className={css.subtitle}>{layer.kind === 'generated' ? <><Lock aria-hidden size={10} />generation</> : 'import'}{background && ' · base'}{layer.evidence?.demo && ' · demo'}{layer.aligned && ' · realigned'}</span>
      </div>
      <IconButton icon={layer.visible ? Eye : EyeOff} size={14} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={() => updateLayer(layer.id, {visible: !layer.visible})} />
    </div>
    {selected && <div className={css.details}>
      {!background && <>
        <MaskSlider label='Area' layer={layer} property='area' />
        <MaskSlider label='Feather' layer={layer} property='feather' />
        {editingMask && <>
          <MaskSlider label='Roundness' layer={layer} property='roundness' />
          <MaskSlider label='Mask X' layer={layer} min={-100} property='offsetX' />
          <MaskSlider label='Mask Y' layer={layer} min={-100} property='offsetY' />
          <label className={css.checkbox}><input checked={Boolean(layer.featherAllEdges)} type='checkbox' onChange={event => updateLayer(layer.id, {featherAllEdges: event.currentTarget.checked})} />Feather exposed edges too</label>
          <p className={css.note}>Drag the mask on the canvas to reposition it. By default, feathering blends overlaps and preserves exposed outer edges.</p>
          <button
            type='button' onClick={() => updateLayer(layer.id, {
              ...layer.kind === 'generated' ? defaultGeneratedMask : defaultImportedMask,
              offsetX: 0,
              offsetY: 0,
              roundness: 0,
              featherAllEdges: false,
            })}
          >Reset mask</button>
        </>}
      </>}
      {background && <p className={css.note}>The bottom layer is the unmasked base.</p>}
      {layer.kind === 'import' && <>
        <button className={css.editTransform} aria-pressed={tool === 'image'} type='button' onClick={() => editorStore.set({tool: tool === 'image' ? 'frame' : 'image'})}>{tool === 'image' ? 'Finish transform' : 'Move, resize & rotate'}</button>
        {tool === 'image' && <TransformFields layer={layer} />}
      </>}
      {layer.kind === 'generated' && <p className={css.note}>Placement is locked to the captured generation frame. {asset ? `${asset.width} × ${asset.height} source pixels.` : ''}</p>}
      {layer.evidence && <details className={css.provenance}><summary>Request capture</summary><p>{new Date(layer.evidence.capturedAt).toLocaleString()}<br />{layer.evidence.modelId}<br />{layer.evidence.ratio} · {layer.evidence.resolution || layer.evidence.quality || 'default'}<br />{layer.evidence.referenceAssetIds.length} reference image(s){layer.evidence.canvasAssetId ? ' + captured canvas' : ''}</p><pre>{layer.evidence.prompt}</pre><p>The exact input and raw output images are retained in the editable project.</p></details>}
    </div>}
  </li>
}

const maskThumbnailSide = 64
/** grayscale preview of a layer mask: white keeps the layer, black hides it */
function MaskThumbnail({layer}: {layer: Layer}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const {area, feather, offsetX, offsetY, roundness} = layer
  const aspect = layer.rect.width / layer.rect.height
  const width = Math.max(1, Math.round(aspect >= 1 ? maskThumbnailSide : maskThumbnailSide * aspect))
  const height = Math.max(1, Math.round(aspect >= 1 ? maskThumbnailSide / aspect : maskThumbnailSide))
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) {
      return
    }
    const size = {width, height}
    const settings = {area, feather, offsetX, offsetY, roundness}
    const pixels = context.createImageData(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = Math.round(getMaskAlpha(settings, size, x + 0.5, y + 0.5) * 255)
        const index = (y * width + x) * 4
        pixels.data[index] = value
        pixels.data[index + 1] = value
        pixels.data[index + 2] = value
        pixels.data[index + 3] = 255
      }
    }
    context.putImageData(pixels, 0, 0)
  }, [area, feather, offsetX, offsetY, roundness, width, height])
  return <span className={css.thumbnail}><canvas aria-hidden height={height} width={width} ref={canvas} /></span>
}