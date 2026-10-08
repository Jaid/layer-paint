import type {Ingredient} from '#src/lib/state.ts'

import {X} from 'lucide-react'
import {useRef, useSyncExternalStore} from 'react'

import {addIngredients, removeIngredient} from '#src/lib/actions.ts'
import {assets} from '#src/lib/assets.ts'
import {getReferenceText, startIngredientDrag} from '#src/lib/collectionDrag.ts'
import {pickImageFiles} from '#src/lib/filePicker.ts'
import {getErrorMessage, notify} from '#src/lib/notices.ts'
import {insertIntoPrompt} from '#src/lib/promptEditor.ts'
import {projectStore} from '#src/lib/state.ts'
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
const getFit = (ingredient: Ingredient) => {
  const asset = assets.get(ingredient.assetId)
  return asset ? getThumbnailFit(asset.width, asset.height) : getThumbnailFit(1, 1)
}
/** The collection: every numbered image as an equally tall thumbnail. Click inserts its reference; drag it onto the canvas or into the prompt. */
export default function Ingredients() {
  const ingredients = useStore(projectStore, state => state.ingredients)
  useAssetRevision()
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
    {ingredients.length ? <div className={css.grid}>
      {ingredients.map(ingredient => {
        const fit = getFit(ingredient)
        return <div
          key={ingredient.id}
          className={css.tile}
          data-crop={fit.crop}
          data-index={ingredient.index}
          data-kind={ingredient.kind ?? 'import'}
          data-testid='ingredient'
          draggable
          style={{aspectRatio: String(fit.aspect)}}
          onDragStart={event => startIngredientDrag(event.dataTransfer, ingredient)}
        >
          <button
            className={css.insert}
            aria-label={`Insert ${getReferenceText(ingredient)} · ${ingredient.name}`}
            title={`${getReferenceText(ingredient)} · ${ingredient.name} (${kindTitles[ingredient.kind ?? 'import']})${fit.crop ? ' · thumbnail cropped' : ''}\nClick to reference it in the prompt, or drag it onto the canvas or into the prompt.`}
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
        </div>
      })}
    </div> : <button className={css.empty} type='button' onClick={() => void addFiles()}>Drop, paste or choose images for the collection</button>}
  </section>
}
