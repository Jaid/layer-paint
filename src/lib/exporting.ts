import type {Rect, Size} from './geometry.ts'
import type {ExportFormat} from './image.ts'
import type {Layer} from './state.ts'
import {assets} from './assets.ts'
import {getContentBounds, renderRegion} from './composite.ts'
import {rectIntersection} from './geometry.ts'
import {encodeCanvas, MAX_EDGE, MAX_PIXELS} from './image.ts'
import {getLayerBounds} from './layerGeometry.ts'
import {getErrorMessage, notify} from './notices.ts'
import {editorStore, projectStore} from './state.ts'

export type ExportScope = 'content' | 'frame'
export type ExportPolicy = {mode?: 'detail' | 'canvas' | 'custom'; scale?: number; allowDownsample?: boolean}
export const exportFormats: ReadonlyArray<{extension: string; format: ExportFormat; quality?: number; title: string}> = [
  {format: 'png', extension: 'png', title: 'PNG'}, {format: 'jpeg', extension: 'jpg', title: 'JPG', quality: 0.96}, {format: 'webp', extension: 'webp', title: 'WebP', quality: 1},
]

/** No coverage threshold: a tiny, high-resolution repair is still real image detail. */
export function getExportPlan(layers: readonly Layer[], region: Rect, policy: ExportPolicy = {}) {
  const mode = policy.mode ?? 'detail'
  let density = mode === 'custom' ? policy.scale ?? 1 : 1
  if (mode === 'detail') for (const [index, layer] of layers.entries()) {
    if (!layer.visible || (index > 0 && layer.area <= 0) || !rectIntersection(getLayerBounds(layer, index > 0), region)) continue
    const asset = assets.get(layer.assetId)
    if (asset) density = Math.max(density, asset.width / layer.rect.width, asset.height / layer.rect.height)
  }
  if (!Number.isFinite(density) || density <= 0) throw new Error('Export scale must be a positive number.')
  const requestedWidth = Math.max(1, Math.round(region.width * density)), requestedHeight = Math.max(1, Math.round(region.height * density))
  const reduction = Math.min(1, MAX_EDGE / Math.max(requestedWidth, requestedHeight), Math.sqrt(MAX_PIXELS / (requestedWidth * requestedHeight)))
  return {width: Math.max(1, Math.floor(requestedWidth * reduction)), height: Math.max(1, Math.floor(requestedHeight * reduction)), requestedWidth, requestedHeight, density: density * reduction, limited: reduction < 1}
}
export const getExportSize = (layers: readonly Layer[], region: Rect): Size => getExportPlan(layers, region)
export const getExportRegion = (scope: ExportScope) => scope === 'frame' ? editorStore.state.frame : getContentBounds(projectStore.state.layers)
export const currentExportPolicy = (): ExportPolicy => ({mode: editorStore.state.exportMode, scale: editorStore.state.exportScale})

export async function renderExport(scope: ExportScope, format: ExportFormat, quality?: number, policy: ExportPolicy = currentExportPolicy()) {
  const region = getExportRegion(scope)
  if (!region) throw new Error('There is nothing to export yet.')
  const layers = projectStore.state.layers
  const plan = getExportPlan(layers, region, policy)
  if (plan.limited && !policy.allowDownsample) throw new Error(`Preserving all detail requires ${plan.requestedWidth} × ${plan.requestedHeight} pixels. Choose a smaller frame/custom scale, or explicitly allow the reduced export in Export settings. The editable project always keeps original pixels.`)
  const {canvas} = renderRegion({layers, region, size: plan, background: format === 'jpeg' ? '#ffffff' : undefined, measureEmpty: false})
  return encodeCanvas(canvas, format, quality)
}
export const createFileName = (extension: string) => `layerpaint_${new Date().toISOString().slice(0, 19).replaceAll(':', '-').replace('T', '_')}.${extension}`
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = fileName; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
export async function exportImage(scope: ExportScope, format: ExportFormat, policy?: ExportPolicy) {
  try {
    const entry = exportFormats.find(candidate => candidate.format === format) ?? exportFormats[0]
    const blob = await renderExport(scope, entry.format, entry.quality, policy)
    downloadBlob(blob, createFileName(entry.extension))
    notify('success', `${entry.title} exported.`)
  } catch (error) {notify('error', getErrorMessage(error))}
}
export async function copyImage(scope: ExportScope, policy?: ExportPolicy) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard images require HTTPS or localhost. Use PNG download on this origin.')
    await navigator.clipboard.write([new ClipboardItem({'image/png': renderExport(scope, 'png', undefined, policy)})])
    notify('success', 'PNG copied to clipboard.')
  } catch (error) {notify('error', `Could not copy: ${getErrorMessage(error)}`)}
}
