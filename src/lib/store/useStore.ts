import type {Store} from './Store.ts'
import {useSyncExternalStore} from 'react'

/** Subscribes to a store; the selector must return a value that is referentially stable for an unchanged state. */
export const useStore = <StateGeneric extends object, SelectionGeneric = StateGeneric>(store: Store<StateGeneric>, selector?: (state: StateGeneric) => SelectionGeneric): SelectionGeneric => {
  const getSelection = () => (selector ? selector(store.state) : store.state) as SelectionGeneric
  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}
