import type {Point} from './geometry.ts'

import {Store} from './store/index.ts'

export const contextMenuStore = new Store<{
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
})
export const openContextMenu = (x: number, y: number, layerId: string | null = null, world: Point | null = null) => contextMenuStore.set({
  open: true,
  x,
  y,
  layerId,
  world,
})
export const closeContextMenu = () => contextMenuStore.set({open: false})
