import type {Ingredient} from '#src/lib/state.ts'

import {X} from 'lucide-react'
import {useEffect, useRef, useState, useSyncExternalStore} from 'react'

import {addIngredients, removeIngredient} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {getReferenceText, startIngredientDrag} from '#src/lib/collectionDrag.ts'
import {pickImageFiles} from '#src/lib/filePicker.ts'
import {layoutMasonry} from '#src/lib/masonry.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

const minColumnWidth = 76
const gap = 6
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
const getAspect = (ingredient: Ingredient) => {
  const asset = assets.get(ingredient.assetId)
  return asset ? Math.min(3, Math.max(1 / 3, asset.height / asset.width)) : 1
}
/** The collection: every numbered image as a thumbnail. Click inserts its reference; drag it onto the canvas or into the prompt. */
export default function Ingredients() {
  const ingredients = useStore(projectStore, state => state.ingredients)
  useAssetRevision()
  const container = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const addFiles = async () => {
    try {
      for (const item of await addIngredients(await pickImageFiles())) {
        insertIntoPrompt(getReferenceText(item))
      }
    } catch (error) {
      notify('error', getErrorMessage(error))
    }
  }
  const columnCount = Math.max(2, Math.floor((width + gap) / (minColumnWidth + gap)))
  const columns = layoutMasonry(ingredients, columnCount, getAspect, gap / minColumnWidth)
  return <section className={css.container} aria-label='Image collection' data-testid='ingredients' ref={container}>
    {ingredients.length ? <div className={css.grid}>
      {columns.map((column, columnIndex) => <div key={columnIndex} className={css.column}>
        {column.map(ingredient => <div
          key={ingredient.id}
          className={css.tile}
          data-index={ingredient.index}
          data-kind={ingredient.kind ?? 'import'}
          data-testid='ingredient'
          draggable
          style={{aspectRatio: `1 / ${getAspect(ingredient)}`}}
          onDragStart={event => startIngredientDrag(event.dataTransfer, ingredient)}
        >
          <button
            className={css.insert}
            aria-label={`Insert ${getReferenceText(ingredient)} · ${ingredient.name}`}
            title={`${getReferenceText(ingredient)} · ${ingredient.name} (${kindTitles[ingredient.kind ?? 'import']})\nClick to reference it in the prompt, or drag it onto the canvas or into the prompt.`}
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
        </div>)}
      </div>)}
    </div> : <button className={css.empty} type='button' onClick={() => void addFiles()}>Drop, paste or choose images for the collection</button>}
  </section>
}
