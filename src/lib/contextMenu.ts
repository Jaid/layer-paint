import type {Point} from './geometry.ts'

import {Store} from './store/index.ts'

export const contextMenuStore = new Store<{
  /** collection number of the tile the menu belongs to; 0 is the live frame view, null means the canvas menu */
  collectionIndex: number | null
  layerId: string | null
  open: boolean
  /** canvas point the menu was opened at, where imports land */
  world: Point | null
  x: number
  y: number
}>({
  open: false,
  x: 0,
  y: 0,
  layerId: null,
  world: null,
  collectionIndex: null,
})
export const openContextMenu = (x: number, y: number, layerId: string | null = null, world: Point | null = null) => contextMenuStore.set({
  open: true,
  x,
  y,
  layerId,
  world,
  collectionIndex: null,
})
/** opens the menu of a collection tile, where 0 is the live frame view */
export const openCollectionMenu = (x: number, y: number, collectionIndex: number) => contextMenuStore.set({
  open: true,
  x,
  y,
  layerId: null,
  world: null,
  collectionIndex,
})
export const closeContextMenu = () => contextMenuStore.set({open: false})
