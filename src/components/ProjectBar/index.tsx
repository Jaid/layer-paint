// Browser UI source. Project replacement only occurs after the user confirms it in the dialog.
import {useRef, useState} from 'react'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {useStore} from '#src/lib/store/index.ts'
import {applyTheme, themeStore, type Theme} from '#src/lib/theme.ts'
import {newProject, openPortableProject, savePortableProject} from '#src/lib/workspaceIO.ts'
import {ExportMenu} from '#component/CanvasToolbar'
import css from './style.module.sass'

export default function ProjectBar() {
  const input = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const theme = useStore(themeStore, state => state.theme)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {await action()} catch (error) {notify('error', getErrorMessage(error))} finally {setBusy(false)}
  }
  return <nav aria-label='Project actions' className={css.bar}>
    <button disabled={busy} title='Start an empty project' type='button' onClick={() => confirmation.current?.showModal()}>New</button>
    <button disabled={busy} title='Open an editable project' type='button' onClick={() => input.current?.click()}>Open</button>
    <button disabled={busy} title='Save an editable copy with original images' type='button' onClick={() => void run(savePortableProject)}>Save project</button>
    <ExportMenu/>
    <select aria-label='Color scheme' value={theme} onChange={event => applyTheme(event.currentTarget.value as Theme)}><option value='dark'>Dark</option><option value='light'>Light</option><option value='system'>System</option></select>
    <input ref={input} hidden accept='.layerpaint' aria-label='Open project file' type='file' onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (file && confirm('Open this project? Save a project copy first to preserve your current prompt and view settings.')) void run(async () => {await openPortableProject(file); notify('success', 'Project opened.')})
    }}/>
    <dialog ref={confirmation} aria-label='New project' className={css.dialog}>
      <h2>Start a new project?</h2>
      <p>This replaces the canvas, references, prompt, undo history and autosave with an empty project. Save a copy first to keep your work. API settings are unchanged.</p>
      <button type='button' onClick={() => confirmation.current?.close()}>Cancel</button>
      <button disabled={busy} type='button' onClick={() => void run(async () => {await savePortableProject(); await newProject(); confirmation.current?.close()})}>Save a copy, then start new</button>
      <button disabled={busy} type='button' onClick={() => void run(async () => {await newProject(); confirmation.current?.close(); notify('success', 'New project started.')})}>Start new project</button>
    </dialog>
  </nav>
}
