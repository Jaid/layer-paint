import type {Point} from './geometry.ts'

import {addIngredients, importLayers} from './actions.ts'
import {persistenceStore} from './autosave.ts'
import {getErrorMessage, notify} from './notices.ts'
import {openPortableProject} from './portableProject.ts'
import {insertIntoPrompt} from './promptEditor.ts'
import {editorStore, projectStore} from './state.ts'
import {screenToWorld} from './viewport.ts'

export const clientToWorld = (client: Point) => {
  const element = document.querySelector<HTMLElement>('[data-viewport]')
  if (!element) {
    return
  }
  const bounds = element.getBoundingClientRect()
  if (client.x < bounds.left || client.x > bounds.right || client.y < bounds.top || client.y > bounds.bottom) {
    return
  }
  return screenToWorld(editorStore.state.view, {
    x: client.x - bounds.left,
    y: client.y - bounds.top,
  })
}

/** Both drop zones accept editable projects; images retain their side-specific meaning. */
export const routeDroppedFiles = async (files: ReadonlyArray<File>, target: 'canvas' | 'editor', client?: Point) => {
  if (!persistenceStore.state.hydrated) {
    notify('info', 'The saved workspace is still opening. Drop the file once recovery has finished.'); return
  }
  const projects = files.filter(file => file.name.toLowerCase().endsWith('.layerpaint'))
  if (projects.length) {
    if (files.length !== 1) {
      notify('error', 'Open one project file at a time.'); return
    }
    if (projectStore.state.layers.length && !confirm('Open this project and replace the workspace? Save a project copy first to preserve your current prompt and view settings.')) {
      return
    }
    try {
      await openPortableProject(projects[0]); notify('success', 'Project opened.')
    } catch (error) {
      notify('error', getErrorMessage(error))
    }
    return
  }
  if (target === 'editor') {
    const added = await addIngredients(files)
    for (const ingredient of added) {
      insertIntoPrompt(`![${ingredient.index}]`)
    }
    return
  }
  await importLayers(files, client ? clientToWorld(client) : undefined)
}
