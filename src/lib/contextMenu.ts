import {Store} from './store/index.ts'
export const contextMenuStore = new Store<{open: boolean; x: number; y: number; layerId: string | null}>({open: false, x: 0, y: 0, layerId: null})
export const openContextMenu = (x: number, y: number, layerId: string | null = null) => contextMenuStore.set({open: true, x, y, layerId})
export const closeContextMenu = () => contextMenuStore.set({open: false})
