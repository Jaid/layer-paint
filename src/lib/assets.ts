import type {DecodedImage} from './image.ts'

import {createId} from '#src/lib/createId.ts'

import {decodeImage} from './image.ts'

/** an immutable decoded image shared by layers, ingredients and undo history */
export type Asset = {
  addedAt: number
  bitmap: ImageBitmap
  blob: Blob
  height: number
  id: string
  /** object URL for display */
  url: string
  width: number
}

type AssetListener = () => void
type ReleaseListener = (id: string) => void

export class AssetRegistry {
  readonly #assets = new Map<string, Asset>
  readonly #listeners = new Set<AssetListener>
  readonly #pins = new Map<string, number>
  readonly #releaseListeners = new Set<ReleaseListener>
  get ids() {
    return [...this.#assets.keys()]
  }

  async add(blob: Blob, decoded?: DecodedImage, id: string = createId()) {
    if (this.#assets.has(id)) {
      const existing = this.#assets.get(id)!
      if (existing.blob === blob) {
        return existing
      }
      throw new Error('Asset identifiers are immutable; import must allocate a fresh ID.')
    }
    const image = decoded ?? await decodeImage(blob)
    const asset: Asset = {
      id,
      addedAt: performance.now(),
      blob,
      bitmap: image.bitmap,
      width: image.width,
      height: image.height,
      url: URL.createObjectURL(blob),
    }
    this.#assets.set(id, asset)
    for (const listener of this.#listeners) {
      listener()
    }
    return asset
  }

  clear() {
    this.retain(new Set, 0)
  }

  get(id: string) {
    return this.#assets.get(id)
  }

  has(id: string) {
    return this.#assets.has(id)
  }

  pin(ids: Iterable<string>) {
    const values = [...new Set(ids)]
    for (const id of values) {
      this.#pins.set(id, (this.#pins.get(id) ?? 0) + 1)
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      for (const id of values) {
        const next = (this.#pins.get(id) ?? 1) - 1
        if (next) {
          this.#pins.set(id, next)
        } else {
          this.#pins.delete(id)
        }
      }
    }
  }

  require(id: string) {
    const asset = this.#assets.get(id)
    if (!asset) {
      throw new Error(`Image ${id} is missing`)
    }
    return asset
  }

  /**
   * Frees every asset that is not in the keep set.
   * Assets younger than the grace period are kept because they may be awaiting their commit into the document.
   */
  retain(keep: ReadonlySet<string>, gracePeriod = 60_000) {
    const now = performance.now()
    for (const [id, asset] of this.#assets) {
      if (keep.has(id) || this.#pins.has(id) || now - asset.addedAt < gracePeriod) {
        continue
      }
      URL.revokeObjectURL(asset.url)
      asset.bitmap.close()
      this.#assets.delete(id)
      for (const listener of this.#releaseListeners) {
        listener(id)
      }
    }
  }

  /** notifies derived caches that an asset was freed */
  subscribeRelease(listener: ReleaseListener) {
    this.#releaseListeners.add(listener)
    return () => {
      this.#releaseListeners.delete(listener)
    }
  }

  subscribe(listener: AssetListener) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}

export const assets = new AssetRegistry
