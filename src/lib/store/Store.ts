type Listener = () => void

export type Updater<StateGeneric> = Partial<StateGeneric> | ((state: StateGeneric) => StateGeneric)

/** minimal immutable external store, compatible with React’s useSyncExternalStore */
export class Store<StateGeneric extends object> {
  #state: StateGeneric
  readonly #listeners = new Set<Listener>()

  constructor(initialState: StateGeneric) {
    this.#state = initialState
  }

  get state() {
    return this.#state
  }

  protected replace(state: StateGeneric) {
    if (state === this.#state) {
      return
    }
    this.#state = state
    for (const listener of this.#listeners) {
      listener()
    }
  }

  protected resolve(updater: Updater<StateGeneric>) {
    if (typeof updater === 'function') {
      return updater(this.#state)
    }
    return {...this.#state, ...updater}
  }

  set(updater: Updater<StateGeneric>) {
    this.replace(this.resolve(updater))
  }

  readonly subscribe = (listener: Listener) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = () => this.#state
}
