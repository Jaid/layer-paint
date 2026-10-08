import type {Ingredient} from './state.ts'

import {projectStore} from './state.ts'

/** private drag type for collection thumbnails; plain text carries the prompt reference for other drop targets */
export const ingredientMediaType = 'application/x-layerpaint-ingredient'

export const getReferenceText = (ingredient: Pick<Ingredient, 'index'>) => `![${ingredient.index}]`

export const startIngredientDrag = (dataTransfer: DataTransfer, ingredient: Ingredient) => {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(ingredientMediaType, ingredient.id)
  dataTransfer.setData('text/plain', getReferenceText(ingredient))
}

/** Works during dragover too, where browsers only expose the types and not the data. */
export const isIngredientDrag = (dataTransfer: DataTransfer | null) => Boolean(dataTransfer?.types.includes(ingredientMediaType))

export const getDroppedIngredient = (dataTransfer: DataTransfer | null) => {
  const id = dataTransfer?.getData(ingredientMediaType)
  return id ? projectStore.state.ingredients.find(ingredient => ingredient.id === id) : undefined
}
