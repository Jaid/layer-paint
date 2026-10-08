import {useEffect, useSyncExternalStore} from 'react'
import {Group, Panel, Separator} from 'react-resizable-panels'

import ContextMenu from '#component/ContextMenu'
import DropOverlay from '#component/DropOverlay'
import ExportDialog from '#component/ExportDialog'
import LayersPanel from '#component/LayersPanel'
import Notices from '#component/Notices'
import PromptPanel from '#component/PromptPanel'
import Viewport from '#component/Viewport'
import ZoomIndicator from '#component/ZoomIndicator'
import {fitViewToFrame, setModel} from '#src/lib/actions.ts'
import {refreshApiStatus} from '#src/lib/apiKey.ts'
import {persistenceStore, startAutosave} from '#src/lib/autosave.ts'
import {installDebugHandle} from '#src/lib/debug.ts'
import {refreshImageCatalog} from '#src/lib/models/index.ts'
import {installShortcuts} from '#src/lib/shortcuts.ts'
import {editorStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {initializeTheme} from '#src/lib/theme.ts'
import {viewportReady} from '#src/lib/viewport.ts'

import css from './style.module.sass'

let initialized = false
async function initialize() {
  if (initialized) {
    return
  }
  initialized = true
  initializeTheme()
  if (import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === 'true') {
    installDebugHandle()
  }
  void refreshApiStatus()
  void refreshImageCatalog().then(() => setModel(editorStore.state.modelId))
  const restored = await startAutosave()
  await viewportReady
  if (!restored) {
    fitViewToFrame()
  }
}
const query = '(max-width: 1000px)'
const subscribe = (callback: () => void) => {
  if (typeof matchMedia !== 'function') {
    return () => {}
  }
  const media = matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
export default function App() {
  const hydrated = useStore(persistenceStore, state => state.hydrated)
  const stacked = useSyncExternalStore(subscribe, () => typeof matchMedia === 'function' && matchMedia(query).matches, () => false)
  useEffect(() => {
    void initialize(); return installShortcuts()
  }, [])
  return <div className={css.container} aria-busy={!hydrated}>
    <div className={css.group} inert={!hydrated}>
      <Group key={stacked ? 'stacked' : 'split'} className={css.group} orientation={stacked ? 'vertical' : 'horizontal'}>
        <Panel className={css.pane} defaultSize={stacked ? '50%' : '42%'} minSize={stacked ? '240px' : '350px'}><PromptPanel /><DropOverlay target='editor' /></Panel>
        <Separator className={css.separator} />
        <Panel className={css.pane} minSize={stacked ? '240px' : '380px'}><div className={css.canvasPane} data-drop-target='canvas'><div className={css.stage}><Viewport /><ZoomIndicator /><Notices /><DropOverlay target='canvas' /></div><LayersPanel /></div></Panel>
      </Group>
    </div>
    {!hydrated && <div className={css.loading} role='status'>Opening your workspace…</div>}
    <ContextMenu />
    <ExportDialog />
  </div>
}
