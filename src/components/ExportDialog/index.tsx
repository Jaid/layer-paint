import type {ExportScope} from '#src/lib/exporting.ts'

import {useEffect, useRef, useState} from 'react'

import {closeExportDialog, copyImage, exportDialogStore, exportFormats, exportImage, getExportPlan, getExportRegion} from '#src/lib/exporting.ts'
import {getErrorMessage} from '#src/lib/notices.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

/** Raster export of the canvas, opened through “Export” in the context menu of the frame view. */
export default function ExportDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const {open, scope, allowDownsample} = useStore(exportDialogStore)
  const [busy, setBusy] = useState(false)
  const setAllowDownsample = (value: boolean) => exportDialogStore.set({allowDownsample: value})
  const layers = useStore(projectStore, state => state.layers)
  const editor = useStore(editorStore)
  useEffect(() => {
    const element = dialog.current
    if (!element) {
      return
    }
    if (open && !element.open) {
      element.showModal()
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])
  let plan: ReturnType<typeof getExportPlan> | null = null; let planError = ''
  if (open) {
    try {
      const region = getExportRegion(scope)
      plan = region && layers.some(layer => layer.visible) ? getExportPlan(layers, region, {
        mode: editor.exportMode,
        scale: editor.exportScale,
      }) : null
    } catch (error) {
      planError = getErrorMessage(error)
    }
  }
  const policy = {
    mode: editor.exportMode,
    scale: editor.exportScale,
    allowDownsample,
  }
  const enabled = Boolean(plan && (!plan.limited || allowDownsample)) && !busy
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  return <dialog
    className={css.dialog} aria-label='Export image' data-testid='export-dialog' ref={dialog} onClick={event => {
      if (event.target === event.currentTarget) {
        closeExportDialog()
      }
    }} onClose={closeExportDialog}
  >
    {open && <>
      <header><h2>Export image</h2><button aria-label='Close export' type='button' onClick={closeExportDialog}>×</button></header>
      <p>The editable project always retains original image pixels.</p>
      <label>Region<select aria-label='Export region' value={scope} onChange={event => exportDialogStore.set({
        scope: event.currentTarget.value as ExportScope,
        allowDownsample: false,
      })}><option value='frame'>{editor.frameEnabled ? 'Current frame · ![0]' : 'Generation area · ![0]'}</option><option value='content'>All visible artwork</option></select></label>
      <label>Resolution<select
        aria-label='Export resolution policy' value={editor.exportMode} onChange={event => {
          editorStore.set({exportMode: event.currentTarget.value as typeof editor.exportMode}); setAllowDownsample(false)
        }}
      ><option value='detail'>Preserve the highest local detail</option><option value='canvas'>Canvas scale · 1 pixel per world unit</option><option value='custom'>Custom scale</option></select></label>
      {editor.exportMode === 'custom' && <label>Scale<input
        aria-label='Custom export scale' max={64} min={0.01} step={0.25} type='number' value={editor.exportScale} onChange={event => {
          const scale = Number(event.currentTarget.value); if (scale > 0 && scale <= 64) {
            editorStore.set({exportScale: scale})
          }
        }}
      /></label>}
      {plan && <output className={css.dimensions}>{plan.width.toLocaleString()} × {plan.height.toLocaleString()} px · {(plan.width * plan.height / 1e6).toFixed(1)} MP</output>}
      {!plan && !planError && <p role='status'>There is no visible artwork to export yet.</p>}
      {planError && <p role='alert'>{planError}</p>}
      {plan?.limited && <div className={css.warning}><p>Full detail needs {plan.requestedWidth.toLocaleString()} × {plan.requestedHeight.toLocaleString()} px. This exceeds the 64-megapixel or 16,384-pixel edge limit.</p><label><input checked={allowDownsample} type='checkbox' onChange={event => setAllowDownsample(event.currentTarget.checked)} />Allow the reduced dimensions shown above</label></div>}
      <div className={css.formats}>{exportFormats.map(format => <button key={format.format} disabled={!enabled} type='button' onClick={() => void run(() => exportImage(scope, format.format, policy))}>Save {format.title}</button>)}</div>
      <button disabled={!enabled} type='button' onClick={() => void run(() => copyImage(scope, policy))}>Copy PNG to clipboard</button>
      {busy && <p role='status'>Rendering native-resolution artwork…</p>}
    </>}
  </dialog>
}
