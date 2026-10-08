import type {Ingredient} from './state.ts'

import {projectStore} from './state.ts'

/** private drag type for collection images, carrying the ingredient ID; only these can be placed on the canvas */
export const ingredientMediaType = 'application/x-layerpaint-ingredient'
/** private drag type for every collection tile, including the live frame view, carrying its prompt reference */
export const referenceMediaType = 'application/x-layerpaint-reference'

export const getReferenceText = (ingredient: Pick<Ingredient, 'index'>) => `![${ingredient.index}]`

/** Plain text carries the prompt reference for other drop targets as well. */
export const startReferenceDrag = (dataTransfer: DataTransfer, index: number) => {
  const text = getReferenceText({index})
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(referenceMediaType, text)
  dataTransfer.setData('text/plain', text)
}

export const startIngredientDrag = (dataTransfer: DataTransfer, ingredient: Ingredient) => {
  startReferenceDrag(dataTransfer, ingredient.index)
  dataTransfer.setData(ingredientMediaType, ingredient.id)
}

/** Works during dragover too, where browsers only expose the types and not the data. */
export const isIngredientDrag = (dataTransfer: DataTransfer | null) => Boolean(dataTransfer?.types.includes(ingredientMediaType))

/** whether a collection tile is dragged, including the frame view */
export const isReferenceDrag = (dataTransfer: DataTransfer | null) => Boolean(dataTransfer?.types.includes(referenceMediaType))

export const getDroppedIngredient = (dataTransfer: DataTransfer | null) => {
  const id = dataTransfer?.getData(ingredientMediaType)
  return id ? projectStore.state.ingredients.find(ingredient => ingredient.id === id) : undefined
}

/** the dropped prompt reference like “![2]”, accepted only in exactly that form */
export const getDroppedReference = (dataTransfer: DataTransfer | null) => {
  const text = dataTransfer?.getData(referenceMediaType)
  return text && /^!\[\d+\]$/.test(text) ? text : undefined
}
