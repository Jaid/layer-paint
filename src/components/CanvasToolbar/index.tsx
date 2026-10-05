import {useRef, useState} from 'react'
import type {ExportScope} from '#src/lib/exporting.ts'
import {copyImage, exportFormats, exportImage, getExportPlan, getExportRegion} from '#src/lib/exporting.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import css from './style.module.sass'

/** Exports live in a deliberate dialog, not an always-floating canvas toolbar. */
export function ExportMenu() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [scope, setScope] = useState<ExportScope>('content'), [allowDownsample, setAllowDownsample] = useState(false), [busy, setBusy] = useState(false)
  const layers = useStore(projectStore, state => state.layers)
  const editor = useStore(editorStore)
  const region = getExportRegion(scope)
  const policy = {mode: editor.exportMode, scale: editor.exportScale, allowDownsample}
  const plan = region ? getExportPlan(layers, region, policy) : null
  const enabled = Boolean(plan && (!plan.limited || allowDownsample)) && !busy
  const run = async (action: () => Promise<unknown>) => {setBusy(true); try {await action()} finally {setBusy(false)}}
  return <>
    <button disabled={!layers.length} title='Export or copy artwork' type='button' onClick={() => dialog.current?.showModal()}>Export</button>
    <dialog ref={dialog} aria-label='Export image' className={css.dialog} onClick={event => {if (event.target === event.currentTarget) dialog.current?.close()}}>
      <header><h2>Export image</h2><button aria-label='Close export' type='button' onClick={() => dialog.current?.close()}>×</button></header>
      <p>The editable project always retains original image pixels.</p>
      <label>Region<select aria-label='Export region' value={scope} onChange={event => setScope(event.currentTarget.value as ExportScope)}><option value='content'>All visible artwork</option><option value='frame'>Current frame</option></select></label>
      <label>Resolution<select aria-label='Export resolution policy' value={editor.exportMode} onChange={event => {editorStore.set({exportMode: event.currentTarget.value as typeof editor.exportMode}); setAllowDownsample(false)}}><option value='detail'>Preserve the highest local detail</option><option value='canvas'>Canvas scale · 1 pixel per world unit</option><option value='custom'>Custom scale</option></select></label>
      {editor.exportMode === 'custom' && <label>Scale<input aria-label='Custom export scale' max={64} min={0.01} step={0.25} type='number' value={editor.exportScale} onChange={event => {const scale = Number(event.currentTarget.value); if (scale > 0 && scale <= 64) editorStore.set({exportScale: scale})}}/></label>}
      {plan && <output className={css.dimensions}>{plan.width.toLocaleString()} × {plan.height.toLocaleString()} px · {(plan.width * plan.height / 1e6).toFixed(1)} MP</output>}
      {plan?.limited && <div className={css.warning}><p>Full detail needs {plan.requestedWidth.toLocaleString()} × {plan.requestedHeight.toLocaleString()} px. This exceeds the 64-megapixel or 16,384-pixel edge limit.</p><label><input checked={allowDownsample} type='checkbox' onChange={event => setAllowDownsample(event.currentTarget.checked)}/>Allow the reduced dimensions shown above</label></div>}
      <div className={css.formats}>{exportFormats.map(format => <button key={format.format} disabled={!enabled} type='button' onClick={() => void run(() => exportImage(scope, format.format, policy))}>Save {format.title}</button>)}</div>
      <button disabled={!enabled} type='button' onClick={() => void run(() => copyImage(scope, policy))}>Copy PNG to clipboard</button>
      {busy && <p role='status'>Rendering native-resolution artwork…</p>}
    </dialog>
  </>
}
export default function CanvasToolbar() {const scale = useStore(editorStore, state => state.view.scale); return <div><span>{Math.round(scale * 100)}%</span><ExportMenu/></div>}
