import clsx from 'clsx'
import {Frame, Sparkles} from 'lucide-react'

import ApiKeySettings from '#component/ApiKeySettings'
import IconButton from '#component/IconButton'
import Ingredients from '#component/Ingredients'
import ProjectBar from '#component/ProjectBar'
import PromptEditor from '#component/PromptEditor'
import RatioPicker from '#component/RatioPicker'
import {setFrameEnabled, setModel, setQuality, setResolution} from '#src/lib/actions.ts'
import {persistenceStore} from '#src/lib/autosave.ts'
import {generate} from '#src/lib/generation.ts'
import {generationModeTitles} from '#src/lib/generationRegion.ts'
import {catalogStore, getModel, models} from '#src/lib/models/index.ts'
import {editorStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {useGenerationMode} from '#src/lib/useGenerationMode.ts'

import css from './style.module.sass'

const vendors = [...new Set(models.map(model => model.vendor))]
/** the two longest labels reserve the width of the generate button, so switching modes never shifts the layout */
const [widestTitle, secondWidestTitle] = Object.values(generationModeTitles).toSorted((a, b) => b.length - a.length)
export default function PromptPanel() {
  const editor = useStore(editorStore); const storage = useStore(persistenceStore); const catalog = useStore(catalogStore)
  const model = getModel(editor.modelId); const running = editor.jobs.filter(job => job.status === 'running').length
  const charged = (value: boolean) => editorStore.set({generationHover: value})
  const mode = useGenerationMode()
  return <div className={css.panel} data-drop-target='editor'>
    <header className={css.header}><h1 className={css.title}><span className={css.logo} aria-hidden />LayerPaint</h1><ProjectBar /><span className={clsx(css.saveState, storage.error && css.saveError)} title={storage.error || 'Images and project state are saved in this browser'}>{storage.paused ? 'recovery paused' : !storage.hydrated ? 'opening…' : storage.saving ? 'saving…' : storage.error ? 'save failed' : storage.lastSavedAt ? 'saved locally' : 'local workspace'}</span><ApiKeySettings /></header>
    <PromptEditor />
    <Ingredients />
    <footer className={css.footer}>
      <div className={css.settings}>
        <label className={clsx(css.field, css.modelField)}><span className={css.fieldLabel} title={`${catalog.source === 'live' ? 'Live Image API capabilities' : 'Bundled capability snapshot'} · ${new Date(catalog.updatedAt).toLocaleDateString('sv')}${catalog.error ? `\n${catalog.error}` : ''}`}>Image model</span><select className={css.select} aria-label='Image model' data-testid='model-select' title={model.note} value={editor.modelId} onChange={event => setModel(event.currentTarget.value)}>{vendors.map(vendor => <optgroup key={vendor} label={vendor}>{models.filter(item => item.vendor === vendor).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>)}</select></label>
        <CompactSelect label='Resolution' options={model.resolutions} value={editor.resolution} onChange={setResolution} />
        <CompactSelect label='Quality' options={model.qualities} value={editor.quality} onChange={setQuality} />
        <div className={css.field}><span className={css.fieldLabel}>Frame ratio</span><RatioPicker /></div>
      </div>
      <div className={css.optionsRow}><label className={css.demo}><input
        aria-label='Demo mode' checked={editor.demoMode} type='checkbox' onChange={event => editorStore.set({
          demoMode: event.currentTarget.checked,
          ...event.currentTarget.checked && !editorStore.state.prompt.trim() ? {prompt: 'A moonlit mountain observatory above a sea of clouds'} : {},
        })}
      />Demo mode <span>no credits</span></label></div>
      <div className={css.generateRow}>{editor.sessionCost > 0 ? <span className={css.meta} title='Actual reported OpenRouter cost for this browser session'>$ {editor.sessionCost.toFixed(4)}</span> : editor.demoMode && <span className={css.meta}>Procedural preview · not AI</span>}<IconButton active={editor.frameEnabled} className={css.frameToggle} data-testid='frame-toggle' icon={Frame} size={17} title={editor.frameEnabled ? 'Frame on · generations use the frame. Click to span all canvas content instead.' : 'Frame off · generations span all canvas content. Click to use the frame.'} onClick={() => setFrameEnabled(!editor.frameEnabled)} /><button className={css.generate} data-mode={mode} data-testid='generate' disabled={!storage.hydrated || running >= 2} title='Ctrl+Enter' type='button' onBlur={() => charged(false)} onClick={() => void generate()} onFocus={() => charged(true)} onPointerEnter={() => charged(true)} onPointerLeave={() => charged(false)}><Sparkles aria-hidden size={16} /><span className={css.generateLabel} data-reserve-a={`${widestTitle}${editor.demoMode ? ' demo' : ''}`} data-reserve-b={`${secondWidestTitle}${editor.demoMode ? ' demo' : ''}`}><span>{generationModeTitles[mode]}{editor.demoMode && ' demo'}</span></span>{running > 0 && <span className={css.badge}>{running}</span>}</button></div>
    </footer>
  </div>
}
function CompactSelect({label, value, options, onChange}: {
  label: string
  onChange: (value: string) => void
  options: ReadonlyArray<string>
  value: string
}) {
  return options.length > 0 ? <label className={css.field}><span className={css.fieldLabel}>{label}</span><select className={css.select} aria-label={label} disabled={options.length < 2} value={value} onChange={event => onChange(event.currentTarget.value)}>{options.map(item => <option key={item} value={item}>{item}</option>)}</select></label> : null
}
