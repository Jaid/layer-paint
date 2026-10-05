import {useEffect, useRef, useState} from 'react'
import type {Ingredient} from '#src/lib/state.ts'
import {addIngredients, importLayers, removeIngredient} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {captureCanvasSnapshot, placeIngredient, referenceAsset} from '#src/lib/workspaceIO.ts'
import css from './style.module.sass'

export default function Ingredients() {
  const document = useStore(projectStore), input = useRef<HTMLInputElement>(null), canvasInput = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(() => typeof matchMedia !== 'function' || !matchMedia('(max-width: 1000px) and (max-height: 700px)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(max-width: 1000px) and (max-height: 700px)')
    const update = () => setExpanded(!media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const run = async (action: () => unknown) => {try {await action()} catch (error) {notify('error', getErrorMessage(error))}}
  const chip = (ingredient: Ingredient) => <div key={ingredient.id} className={css.chip} data-kind={ingredient.kind ?? 'import'} data-testid='ingredient'>
    <button title={`Insert ![${ingredient.index}] · ${ingredient.name}`} type='button' onClick={() => insertIntoPrompt(`![${ingredient.index}]`)}><img alt='' src={ingredient.thumbnail}/><code>![{ingredient.index}]</code><span>{ingredient.name}</span></button>
    <button aria-label={`Place ${ingredient.name} on canvas`} title='Place a movable copy onto the canvas' type='button' onClick={() => placeIngredient(ingredient)}>↗</button>
    <button aria-label={`Remove ingredient ${ingredient.index}`} title='Remove reference; existing numbers never change' type='button' onClick={() => removeIngredient(ingredient.id)}>×</button>
  </div>
  const snapshots = document.ingredients.filter(item => item.kind === 'snapshot')
  const imports = document.ingredients.filter(item => !item.kind || item.kind === 'import')
  const generated = document.ingredients.filter(item => item.kind === 'generated')
  const referenced = new Set(document.ingredients.map(item => item.assetId))
  const layerChips = (kind: 'import' | 'generated') => document.layers.filter(layer => layer.kind === kind && !referenced.has(layer.assetId)).map(layer => <button key={layer.id} className={css.layerChip} data-kind={kind} title={`Use ${layer.name} as a prompt reference`} type='button' onClick={() => void run(async () => {const item = await referenceAsset(layer.assetId, layer.name, kind); insertIntoPrompt(`![${item.index}]`)})}>{assets.get(layer.assetId) && <img alt='' src={assets.get(layer.assetId)!.url}/>}<span>{layer.name}</span><small>＋ reference</small></button>)
  return <section aria-label='Image collection' className={css.container} data-testid='ingredients'>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Collection <span>{document.ingredients.length} references · {document.layers.length} layers</span></summary>
      <div className={css.group} data-kind='canvas'><header><span>Canvas</span><small>live frame content</small></header><div className={css.items}><button className={css.canvasChip} title='Insert the current framed canvas' type='button' onClick={() => insertIntoPrompt('![0]')}><code>![0]</code><span>Live canvas</span></button><button className={css.snapshotButton} disabled={!document.layers.length} title='Freeze current frame as a reusable reference' type='button' onClick={() => void run(async () => {const item = await captureCanvasSnapshot(); insertIntoPrompt(`![${item.index}]`)})}>Take snapshot</button></div></div>
      {snapshots.length > 0 && <div className={css.group} data-kind='snapshot'><header>Canvas snapshots</header><div className={css.items}>{snapshots.map(chip)}</div></div>}
      <div className={css.group} data-kind='import'><header><span>Imports</span><div><button type='button' onClick={() => canvasInput.current?.click()}>To canvas</button><button type='button' onClick={() => input.current?.click()}>To prompt</button></div></header><div className={css.items}>{imports.map(chip)}{layerChips('import')}{!imports.length && !document.layers.some(layer => layer.kind === 'import') && <p>Drop images on either side, or add them above.</p>}</div></div>
      {(generated.length > 0 || document.layers.some(layer => layer.kind === 'generated')) && <div className={css.group} data-kind='generated'><header>Generations</header><div className={css.items}>{generated.map(chip)}{layerChips('generated')}</div></div>}
    </details>
    <input ref={input} hidden multiple accept='image/*,.jxl,.svg' aria-label='Add prompt images' type='file' onChange={event => {const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; void run(async () => {for (const item of await addIngredients(files)) insertIntoPrompt(`![${item.index}]`)})}}/>
    <input ref={canvasInput} hidden multiple accept='image/*,.jxl,.svg' aria-label='Add canvas images' type='file' onChange={event => {const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; void run(() => importLayers(files))}}/>
  </section>
}
