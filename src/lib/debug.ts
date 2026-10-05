import * as actions from './actions.ts'
import {assets} from './assets.ts'
import {flushAutosave, persistenceStore} from './autosave.ts'
import {renderRegion} from './composite.ts'
import {getExportPlan, renderExport} from './exporting.ts'
import {generate, prepareGeneration} from './generation.ts'
import {encodeCanvas} from './image.ts'
import {openPortableProject, serializeProject} from './portableProject.ts'
import {editorStore, projectStore} from './state.ts'
import {captureCanvasSnapshot, newProject} from './workspaceIO.ts'

/** Local inspection interface, enabled in development or with ?debug=true. Contains no credentials. */
export const debugHandle = {
  actions,
  assets,
  editorStore,
  projectStore,
  renderExport,
  renderRegion,
  getExportPlan,
  generate,
  newProject,
  captureCanvasSnapshot,
  openPortableProject,
  serializeProject,
  flushAutosave,
  persistenceStore,
  previewRequest: async () => {
    const {compiled, model, rendered} = prepareGeneration()
    return {
      model: model.id,
      text: compiled.text,
      sources: compiled.sources,
      errors: compiled.errors,
      canvas: rendered ? await encodeCanvas(rendered.canvas, 'png') : undefined,
      emptyFraction: rendered?.emptyFraction,
    }
  },
}
declare global {
  var layerPaint: typeof debugHandle | undefined
}
export const installDebugHandle = () => {
  globalThis.layerPaint = debugHandle
}
