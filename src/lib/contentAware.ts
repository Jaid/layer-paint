import type {Layer, LayerAlignment} from './state.ts'

import {getLayer, updateLayer, workspaceEpoch} from './actions.ts'
import {registerOutput} from './alignment/index.ts'
import {assets} from './assets.ts'
import {getErrorMessage, notify} from './notices.ts'
import {projectStore} from './state.ts'
import {Store} from './store/index.ts'

/** layers whose first registration is still running in the background */
export const contentAwareStore = new Store<{pending: ReadonlySet<string>}>({pending: new Set})

/**
 * Registrations survive undo, layer deletion and re-adding because they are keyed by the immutable input/output pair.
 * The result is also stored on the layer itself, so it survives reloads and portable projects.
 */
const registrations = new Map<string, LayerAlignment>
const getRegistrationKey = (layer: Layer) => `${layer.evidence?.canvasAssetId}>${layer.assetId}`

/** Only generated layers with a captured canvas input can be registered against that input. */
export const supportsContentAwareAlignment = (layer: Layer) => layer.kind === 'generated' && Boolean(layer.evidence?.canvasAssetId)

const setPending = (id: string, pending: boolean) => contentAwareStore.set(state => {
  const next = new Set(state.pending)
  if (pending) {
    next.add(id)
  } else {
    next.delete(id)
  }
  return {pending: next}
})

/** Applies the registration to every layer that shares the same output, without an extra undo step. */
const storeAlignment = (assetId: string, alignment: LayerAlignment) => projectStore.set(document => ({
  ...document,
  layers: document.layers.map(item => (item.assetId === assetId && !item.alignment ? {
    ...item,
    alignment,
  } : item)),
}))

/**
 * Turns content-aware alignment on or off for a generated layer.
 * The first activation registers the output against its captured canvas input in a worker; afterwards toggling is instant.
 */
export async function setContentAwareAlignment(id: string, enabled: boolean) {
  const layer = getLayer(id)
  if (!layer || !supportsContentAwareAlignment(layer) || contentAwareStore.state.pending.has(id)) {
    return
  }
  const known = layer.alignment ?? registrations.get(getRegistrationKey(layer))
  if (!enabled || known) {
    if (known && !layer.alignment) {
      storeAlignment(layer.assetId, known)
    }
    updateLayer(id, {contentAware: enabled})
    if (enabled && known && !known.applied) {
      notify('info', 'No reliable drift was found earlier, so this layer stays where it was generated.')
    }
    return
  }
  const epoch = workspaceEpoch
  const input = assets.get(layer.evidence!.canvasAssetId!); const output = assets.get(layer.assetId)
  if (!input || !output) {
    notify('error', 'The captured input of this layer is unavailable.'); return
  }
  setPending(id, true)
  const release = assets.pin([input.id, output.id])
  try {
    const registration = await registerOutput(input.bitmap, output.bitmap, layer.rect.width / layer.rect.height)
    const alignment: LayerAlignment = {
      ...registration.placement,
      applied: registration.applied,
    }
    registrations.set(getRegistrationKey(layer), alignment)
    if (epoch !== workspaceEpoch || !getLayer(id)) {
      return
    }
    storeAlignment(layer.assetId, alignment)
    updateLayer(id, {contentAware: true})
    if (!alignment.applied) {
      notify('info', `No reliable drift was found (${registration.reason}). The layer stays where it was generated.`)
    }
  } catch (error) {
    notify('error', `Content-aware alignment failed: ${getErrorMessage(error)}`)
  } finally {
    release()
    setPending(id, false)
  }
}
