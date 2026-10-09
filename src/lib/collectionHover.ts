import {editorStore, projectStore} from './state.ts'
import {useStore} from './store/index.ts'

/** Marks a collection tile as hovered, so the prompt, the layers panel and the canvas can point out where it is used; 0 is the live frame view. */
export const setHoveredCollectionIndex = (index: number | null) => {
  if (editorStore.state.hoveredCollectionIndex !== index) {
    editorStore.set({hoveredCollectionIndex: index})
  }
}

/** the image of the hovered collection item; undefined while none or the frame view is hovered */
export const useHoveredCollectionAssetId = () => {
  const index = useStore(editorStore, state => state.hoveredCollectionIndex)
  return useStore(projectStore, state => (index ? state.ingredients.find(item => item.index === index)?.assetId : undefined))
}
