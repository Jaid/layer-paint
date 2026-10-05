import type {Updater} from './Store.ts'
import {Store} from './Store.ts'

export type CommitOptions = {
  /**
   * Consecutive commits with the same key inside the coalescing window form a single undo step.
   * Useful for slider drags and pointer moves.
   */
  coalesceKey?: string
  /** maximum pause in milliseconds between coalesced commits, defaults to one second */
  coalesceWindow?: number
}

const coalesceWindow = 1000
const maxHistory = 200

export type HistoryMeta = {
  canRedo: boolean
  canUndo: boolean
}

/** store with linear undo/redo history of immutable snapshots */
export class HistoryStore<StateGeneric extends object> extends Store<StateGeneric> {
  #past: Array<StateGeneric> = []
  #future: Array<StateGeneric> = []
  #lastKey: string | undefined
  #lastTime = 0
  readonly meta = new Store<HistoryMeta>({canUndo: false, canRedo: false})

  #syncMeta() {
    const canUndo = this.#past.length > 0
    const canRedo = this.#future.length > 0
    if (canUndo !== this.meta.state.canUndo || canRedo !== this.meta.state.canRedo) {
      this.meta.set({canUndo, canRedo})
    }
  }

  commit(updater: Updater<StateGeneric>, options: CommitOptions = {}) {
    const next = this.resolve(updater)
    if (next === this.state) {
      return
    }
    const now = performance.now()
    const isCoalesced = options.coalesceKey !== undefined && options.coalesceKey === this.#lastKey && now - this.#lastTime < (options.coalesceWindow ?? coalesceWindow)
    if (!isCoalesced) {
      this.#past.push(this.state)
      if (this.#past.length > maxHistory) {
        this.#past.shift()
      }
    }
    this.#lastKey = options.coalesceKey
    this.#lastTime = now
    this.#future = []
    this.replace(next)
    this.#syncMeta()
  }

  /** replaces the state and discards the whole history, e.g. after loading a project */
  reset(state: StateGeneric) {
    this.#past = []
    this.#future = []
    this.#lastKey = undefined
    this.replace(state)
    this.#syncMeta()
  }

  /** Updates the present state without creating an undo step. */
  override set(updater: Updater<StateGeneric>) {
    this.replace(this.resolve(updater))
  }

  undo() {
    const previous = this.#past.pop()
    if (!previous) {
      return false
    }
    this.#future.push(this.state)
    this.#lastKey = undefined
    this.replace(previous)
    this.#syncMeta()
    return true
  }

  redo() {
    const next = this.#future.pop()
    if (!next) {
      return false
    }
    this.#past.push(this.state)
    this.#lastKey = undefined
    this.replace(next)
    this.#syncMeta()
    return true
  }

  /** every state that is still reachable through undo/redo, including the present */
  get reachableStates(): ReadonlyArray<StateGeneric> {
    return [...this.#past, this.state, ...this.#future]
  }
}
