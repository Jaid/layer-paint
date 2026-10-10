import {afterEach, describe, expect, jest, mock, test} from 'bun:test'

import {act, cleanup, fireEvent, render} from '@testing-library/react'
import {createElement} from 'react'

import testSassModulesPlugin from './lib/sassModulesPlugin.js'
Bun.plugin(testSassModulesPlugin)
// Monaco cannot run in happy-dom, so the editor is replaced with its native textarea backend.
mock.module('monacozen', () => {
  const DummyEditor = ({value, onChange, placeholder}: {
    onChange?: (value: string) => void
    placeholder?: string
    value?: string
  }) => createElement('textarea', {
    placeholder,
    value,
    onChange: (event: {currentTarget: {value: string}}) => onChange?.(event.currentTarget.value),
  })
  return {
    default: DummyEditor,
    DummyEditor,
  }
})
type RenderOptions = {
  path?: string
  props?: Record<string, unknown>
}
async function renderComponent(componentSegment: string, options: RenderOptions = {}) {
  globalThis.history.replaceState(null, '', options.path ?? '/')
  const Component = (await import(`#src/components/${componentSegment}/index.tsx`)).default
  return render(createElement(Component, options.props))
}
afterEach(() => {
  cleanup()
  jest.useRealTimers()
  globalThis.history.replaceState(null, '', '/')
})
describe('components', () => {
  test('App', async () => {
    const {container} = await renderComponent('App')
    expect(container.innerHTML.length).toBeGreaterThan(0)
    expect(container.querySelector('[data-testid="frame"]')).not.toBeNull()
    // The frame carries no text label.
    expect(container.querySelector('[data-testid="frame"]')?.textContent).toBe('')
    expect(container.querySelector('[data-testid="generate"]')?.textContent).toContain('Generate')
    expect(container.querySelector('[data-testid="layers-panel"]')).not.toBeNull()
  })
  test('PromptPanel lists all models', async () => {
    const {container} = await renderComponent('PromptPanel')
    const options = [...container.querySelectorAll('[data-testid="model-select"] option')].map(option => option.getAttribute('value'))
    expect(options).toHaveLength(9)
    expect(options).toContain('bytedance-seed/seedream-5-0-pro')
  })
  test('switching the model keeps the frame ratio supported', async () => {
    const {editorStore} = await import('#src/lib/state.ts')
    const {getModel} = await import('#src/lib/models/index.ts')
    const {setRatio} = await import('#src/lib/actions.ts')
    const {container} = await renderComponent('PromptPanel')
    act(() => setRatio('1:8'))
    fireEvent.change(container.querySelector('[data-testid="model-select"]')!, {target: {value: 'x-ai/grok-imagine-image-2.0'}})
    expect(editorStore.state.modelId).toBe('x-ai/grok-imagine-image-2.0')
    expect(getModel(editorStore.state.modelId).supportsRatio(editorStore.state.ratio)).toBe(true)
    expect(editorStore.state.ratio).toBe('9:20')
  })
  test('Ingredients shows numbered, draggable thumbnails only', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    const empty = await renderComponent('Ingredients')
    expect(empty.container.querySelectorAll('[data-testid="ingredient"]')).toHaveLength(0)
    expect(empty.container.textContent).toContain('collection')
    cleanup()
    act(() => projectStore.reset({
      layers: [],
      ingredients: [3, 1, 2].map(index => ({
        id: `ingredient-${index}`,
        assetId: `missing-${index}`,
        index,
        name: `Image ${index}`,
        kind: 'import' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      })),
      nextIngredientIndex: 4,
    }))
    const {container} = await renderComponent('Ingredients')
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-testid="ingredient"]')]
    expect(tiles).toHaveLength(3)
    expect(tiles.every(tile => tile.getAttribute('draggable') === 'true')).toBe(true)
    expect(tiles.map(tile => tile.querySelector('img')?.getAttribute('src'))).toEqual(['data:image/webp;base64,AAAA', 'data:image/webp;base64,AAAA', 'data:image/webp;base64,AAAA'])
    expect(new Set(tiles.map(tile => tile.dataset.index))).toEqual(new Set(['1', '2', '3']))
    // Only thumbnails and numbers: no names, groups or section headings. Names only appear in the tooltips.
    const visibleText = [...container.querySelectorAll('[data-index] > button')].map(button => button.textContent).join('')
    expect(visibleText).not.toContain('Image 1')
    expect(container.querySelector('header')).toBeNull()
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('the generate button names what will happen and sits next to the frame toggle', async () => {
    const {editorStore} = await import('#src/lib/state.ts')
    const {container} = await renderComponent('PromptPanel')
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="frame-toggle"]')!
    expect(toggle.nextElementSibling?.getAttribute('data-testid')).toBe('generate')
    expect(container.querySelector('[data-testid="generate"]')?.textContent).toContain('Generate')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    act(() => toggle.click())
    expect(editorStore.state.frameEnabled).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    act(() => toggle.click())
    expect(editorStore.state.frameEnabled).toBe(true)
  })
  test('the prompt panel has no options menu any more', async () => {
    const {container} = await renderComponent('PromptPanel')
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).not.toMatch(/Options|drift correction/)
  })
  test('project actions share the title row', async () => {
    const {container} = await renderComponent('PromptPanel')
    const header = container.querySelector('header')!
    expect(header.querySelector('nav[aria-label="Project actions"]')).not.toBeNull()
    expect(header.querySelector('h1')).not.toBeNull()
  })
  test('LayersPanel shows mask sliders only while editing the mask of a non-background layer', async () => {
    const {projectStore, editorStore, defaultGeneratedMask} = await import('#src/lib/state.ts')
    const rect = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }
    const base = {
      assetId: 'missing',
      createdAt: 0,
      visible: true,
      rect,
    }
    projectStore.reset({
      ingredients: [],
      layers: [{
        ...base,
        id: 'a',
        kind: 'import',
        name: 'background',
        area: 1,
        feather: 0,
      }, {
        ...base,
        id: 'b',
        kind: 'generated',
        name: 'edit',
        ...defaultGeneratedMask,
      }],
    })
    editorStore.set({
      selectedLayerId: 'b',
      layersPanelOpen: true,
    })
    const {container} = await renderComponent('LayersPanel')
    expect(container.querySelectorAll('[data-testid="layer-row"]')).toHaveLength(2)
    // No tool tab row and no undo/redo footer.
    expect(container.querySelector('[role="group"]')).toBeNull()
    expect(container.querySelector('footer')).toBeNull()
    expect(container.textContent).not.toMatch(/Undo|Redo/)
    // Selecting the image itself shows the color adjustments and content-aware alignment, but no mask controls.
    const adjustmentSliders = () => [...container.querySelectorAll<HTMLInputElement>('input[type="range"][data-adjustment]')].map(input => input.dataset.adjustment)
    expect(adjustmentSliders()).toEqual(['brightness', 'contrast', 'gamma', 'saturation', 'vibrance', 'temperature'])
    // Besides the adjustments, only the opacity slider belongs to the image.
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="range"]:not([data-adjustment])')].map(input => input.dataset.testid)).toEqual(['opacity'])
    fireEvent.change(container.querySelector('[data-testid="opacity"]')!, {target: {value: '35'}})
    expect(projectStore.state.layers[1].opacity).toBe(0.35)
    fireEvent.change(container.querySelector('[data-testid="opacity"]')!, {target: {value: '100'}})
    // Fully opaque layers carry no opacity.
    expect('opacity' in projectStore.state.layers[1]).toBe(false)
    expect(container.textContent).not.toMatch(/Area|Feather/)
    expect(container.textContent).toContain('White balance')
    const contentAware = container.querySelector<HTMLInputElement>('[data-testid="content-aware"]')!
    expect(contentAware).not.toBeNull()
    // Without a captured canvas input there is nothing to align against.
    expect(contentAware.disabled).toBe(true)
    fireEvent.change(container.querySelector('[data-adjustment="saturation"]')!, {target: {value: '40'}})
    expect(projectStore.state.layers[1].adjustments).toEqual({saturation: 0.4})
    fireEvent.change(container.querySelector('[data-adjustment="saturation"]')!, {target: {value: '0'}})
    // A neutral look is stored as no adjustments at all.
    expect('adjustments' in projectStore.state.layers[1]).toBe(false)
    expect(defaultGeneratedMask).toEqual({
      area: 1,
      feather: 0,
    })
    // Only right-click opens the layer menu; the mask thumbnail replaces the advanced mask button.
    expect(container.querySelector('[aria-label^="Actions for"]')).toBeNull()
    expect(container.textContent).not.toContain('Advanced mask')
    const maskThumbnails = container.querySelectorAll<HTMLButtonElement>('[data-testid="mask-thumbnail"]')
    expect(maskThumbnails).toHaveLength(1)
    act(() => maskThumbnails[0].click())
    expect(editorStore.state.tool).toBe('mask')
    expect(maskThumbnails[0].getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(5)
    expect(adjustmentSliders()).toEqual([])
    expect(container.querySelector('[data-testid="content-aware"]')).toBeNull()
    expect(container.textContent).toContain('Area')
    expect(container.textContent).toContain('Feather')
    act(() => maskThumbnails[0].click())
    expect(editorStore.state.tool).toBe('frame')
    expect(container.querySelectorAll('input[type="range"]:not([data-adjustment])')).toHaveLength(1)
    act(() => editorStore.set({selectedLayerId: 'a'}))
    const second = await renderComponent('LayersPanel')
    // The base layer has adjustments too, but no mask and no alignment.
    expect(second.container.querySelectorAll('input[type="range"]:not([data-adjustment], [data-testid="opacity"])')).toHaveLength(0)
    expect(second.container.querySelectorAll('input[type="range"][data-adjustment]')).toHaveLength(6)
    expect(second.container.querySelector('[data-testid="content-aware"]')).toBeNull()
    act(() => projectStore.reset({
      ingredients: [],
      layers: [],
    }))
  })
  test('LayersPanel no longer shows the zoom level', async () => {
    const {editorStore} = await import('#src/lib/state.ts')
    act(() => editorStore.set({layersPanelOpen: true}))
    const {container} = await renderComponent('LayersPanel')
    expect(container.textContent).not.toMatch(/\d+%/)
  })
  test('ZoomIndicator appears briefly whenever the zoom level changes', async () => {
    const {editorStore} = await import('#src/lib/state.ts')
    const {zoomIndicatorDuration} = await import('#src/components/ZoomIndicator/index.tsx')
    act(() => editorStore.set({view: {
      x: 0,
      y: 0,
      scale: 1,
    }}))
    jest.useFakeTimers()
    const {getByTestId} = await renderComponent('ZoomIndicator')
    const indicator = getByTestId('zoom-indicator')
    expect(indicator.hasAttribute('data-visible')).toBe(false)
    // Panning keeps the scale and must not reveal the indicator.
    act(() => editorStore.set({view: {
      x: 40,
      y: 20,
      scale: 1,
    }}))
    expect(indicator.hasAttribute('data-visible')).toBe(false)
    act(() => editorStore.set({view: {
      ...editorStore.state.view,
      scale: 1.25,
    }}))
    expect(indicator.hasAttribute('data-visible')).toBe(true)
    expect(indicator.textContent).toBe('125%')
    // A further change restarts the countdown.
    act(() => jest.advanceTimersByTime(zoomIndicatorDuration / 2))
    act(() => editorStore.set({view: {
      ...editorStore.state.view,
      scale: 1.5,
    }}))
    act(() => jest.advanceTimersByTime(zoomIndicatorDuration - 1))
    expect(indicator.hasAttribute('data-visible')).toBe(true)
    expect(indicator.textContent).toBe('150%')
    act(() => jest.advanceTimersByTime(1))
    expect(indicator.hasAttribute('data-visible')).toBe(false)
  })
  test('there is no Export button; the dialog only opens on request', async () => {
    const {exportDialogStore, openExportDialog} = await import('#src/lib/exporting.ts')
    const panel = await renderComponent('PromptPanel')
    expect([...panel.container.querySelectorAll('button')].some(button => /export/i.test(button.textContent ?? ''))).toBe(false)
    cleanup()
    const {container} = await renderComponent('ExportDialog')
    const dialog = container.querySelector<HTMLDialogElement>('[data-testid="export-dialog"]')!
    expect(dialog.textContent).toBe('')
    act(() => openExportDialog('frame'))
    expect(dialog.textContent).toContain('Export image')
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Export region"]')?.value).toBe('frame')
    act(() => (container.querySelector('[aria-label="Close export"]') as HTMLButtonElement).click())
    expect(exportDialogStore.state.open).toBe(false)
  })
  test('the collection starts with a live frame view at position 0', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [{
        id: 'ingredient-1',
        assetId: 'missing-1',
        index: 1,
        name: 'Image 1',
        kind: 'import' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      }],
      nextIngredientIndex: 2,
    }))
    const {container} = await renderComponent('Ingredients')
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-index]')]
    expect(tiles.map(tile => tile.dataset.index)).toEqual(['0', '1'])
    expect(tiles[0].dataset.testid).toBe('frame-view')
    expect(tiles[0].querySelector('canvas')).not.toBeNull()
    // Tiles carry no remove buttons; deletion lives in the context menu.
    expect(container.querySelector('[aria-label^="Remove"]')).toBeNull()
    expect(tiles.every(tile => tile.querySelectorAll('button').length === 1)).toBe(true)
    cleanup()
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
    const empty = await renderComponent('Ingredients')
    expect(empty.container.querySelectorAll('[data-testid="frame-view"]')).toHaveLength(1)
    expect(empty.container.textContent).toContain('collection')
  })
  test('collection items offer Export in their context menu', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    const {contextMenuStore} = await import('#src/lib/contextMenu.ts')
    const {exportDialogStore} = await import('#src/lib/exporting.ts')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [{
        id: 'ingredient-1',
        assetId: 'missing-1',
        index: 1,
        name: 'Image 1',
        kind: 'import' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      }],
      nextIngredientIndex: 2,
    }))
    const {container} = await renderComponent('Ingredients')
    const menu = await renderComponent('ContextMenu')
    fireEvent.contextMenu(container.querySelector('[data-testid="ingredient"]')!, {
      clientX: 20,
      clientY: 20,
    })
    expect(contextMenuStore.state.collectionIndex).toBe(1)
    const items = () => [...menu.container.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)
    expect(items()).toEqual(['Export', 'Delete'])
    act(() => contextMenuStore.set({open: false}))
    fireEvent.contextMenu(container.querySelector('[data-testid="frame-view"]')!)
    expect(contextMenuStore.state.collectionIndex).toBe(0)
    expect(items()).toEqual(['Export…'])
    // Without visible artwork there is nothing to export.
    expect(menu.container.querySelector<HTMLButtonElement>('[role="menuitem"]')?.disabled).toBe(true)
    act(() => contextMenuStore.set({open: false}))
    expect(exportDialogStore.state.open).toBe(false)
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('collection items offer rotation and flip dropdowns that reflect the entry', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    const {openCollectionMenu} = await import('#src/lib/contextMenu.ts')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [{
        id: 'ingredient-1',
        assetId: 'missing-turned',
        sourceAssetId: 'missing-1',
        rotation: 270,
        flip: 'vertical',
        index: 1,
        name: 'Image 1',
        kind: 'import' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      }],
      nextIngredientIndex: 2,
    }))
    const menu = await renderComponent('ContextMenu')
    act(() => openCollectionMenu(10, 10, 1))
    const rotation = menu.container.querySelector<HTMLSelectElement>('[data-testid="collection-rotation"]')!
    const flip = menu.container.querySelector<HTMLSelectElement>('[data-testid="collection-flip"]')!
    expect(rotation.closest('label')?.textContent).toStartWith('Rotation')
    expect(flip.closest('label')?.textContent).toStartWith('Flip')
    expect([...rotation.options].map(option => option.textContent)).toEqual(['0°', '90° clockwise', '90° counterclockwise', '180°'])
    expect([...flip.options].map(option => option.textContent)).toEqual(['None', 'Horizontal', 'Vertical'])
    expect(rotation.value).toBe('270')
    expect(flip.value).toBe('vertical')
    // Without the original pixels there is nothing to transform.
    expect(rotation.disabled).toBe(true)
    expect(flip.disabled).toBe(true)
    act(() => openCollectionMenu(10, 10, 0))
    expect(menu.container.querySelector('select')).toBeNull()
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('Delete in the context menu of a collection item removes it without renumbering', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    const {openCollectionMenu} = await import('#src/lib/contextMenu.ts')
    const ingredient = (index: number) => ({
      id: `ingredient-${index}`,
      assetId: `missing-${index}`,
      index,
      name: `Image ${index}`,
      kind: 'import' as const,
      thumbnail: 'data:image/webp;base64,AAAA',
      createdAt: 0,
    })
    act(() => projectStore.reset({
      layers: [],
      ingredients: [ingredient(1), ingredient(2)],
      nextIngredientIndex: 3,
    }))
    const menu = await renderComponent('ContextMenu')
    act(() => openCollectionMenu(10, 10, 1))
    const remove = [...menu.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Delete')!
    act(() => remove.click())
    await act(() => Promise.resolve())
    expect(projectStore.state.ingredients.map(item => item.index)).toEqual([2])
    expect(projectStore.state.nextIngredientIndex).toBe(3)
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('collection tiles use rich tooltips instead of title attributes', async () => {
    const {projectStore} = await import('#src/lib/state.ts')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [{
        id: 'ingredient-1',
        assetId: 'missing-1',
        index: 1,
        name: 'Witch',
        kind: 'generated' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      }],
      nextIngredientIndex: 2,
    }))
    const {container} = await renderComponent('Ingredients')
    for (const tile of container.querySelectorAll<HTMLElement>('[data-index]')) {
      const button = tile.querySelector('button')!
      expect(button.hasAttribute('title')).toBe(false)
      const tooltip = tile.querySelector(`#${CSS.escape(button.getAttribute('interestfor')!)}`)!
      expect(tooltip.getAttribute('popover')).toBe('hint')
      expect(tooltip.getAttribute('role')).toBe('tooltip')
    }
    expect(container.querySelector('[data-testid="ingredient"] [role="tooltip"]')?.textContent).toContain('Witch')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('hovering a collection tile marks it for the prompt, the layers and the canvas', async () => {
    const {editorStore, projectStore} = await import('#src/lib/state.ts')
    act(() => projectStore.reset({
      layers: [],
      ingredients: [{
        id: 'ingredient-4',
        assetId: 'missing-4',
        index: 4,
        name: 'Image 4',
        kind: 'import' as const,
        thumbnail: 'data:image/webp;base64,AAAA',
        createdAt: 0,
      }],
      nextIngredientIndex: 5,
    }))
    const {container} = await renderComponent('Ingredients')
    const tile = container.querySelector('[data-testid="ingredient"]')!
    fireEvent.pointerEnter(tile)
    expect(editorStore.state.hoveredCollectionIndex).toBe(4)
    fireEvent.pointerLeave(tile)
    expect(editorStore.state.hoveredCollectionIndex).toBeNull()
    fireEvent.pointerEnter(container.querySelector('[data-testid="frame-view"]')!)
    expect(editorStore.state.hoveredCollectionIndex).toBe(0)
    // Removing a hovered tile clears the highlight.
    cleanup()
    expect(editorStore.state.hoveredCollectionIndex).toBeNull()
    act(() => projectStore.reset({
      layers: [],
      ingredients: [],
    }))
  })
  test('layer rows hide via the context menu, keep a show button for hidden layers and cycle revisions', async () => {
    const {editorStore, projectStore} = await import('#src/lib/state.ts')
    const {contextMenuStore} = await import('#src/lib/contextMenu.ts')
    const rect = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }
    const evidence = (id: string) => ({
      id,
      capturedAt: 0,
      compiledPrompt: 'a cat',
      frame: rect,
      modelId: 'google/gemini-nano-banana-2.1',
      outputAssetId: `out-${id}`,
      prompt: 'a cat',
      quality: '',
      ratio: '1:1',
      referenceAssetIds: [],
      resolution: '',
    })
    act(() => {
      projectStore.reset({
        ingredients: [],
        layers: [{
          id: 'base',
          assetId: 'base-asset',
          createdAt: 0,
          visible: true,
          rect,
          kind: 'import',
          name: 'Base',
          area: 1,
          feather: 0,
        }, {
          id: 'gen',
          assetId: 'out-b',
          createdAt: 0,
          visible: true,
          rect,
          kind: 'generated',
          name: 'Cat',
          area: 1,
          feather: 0,
          evidence: evidence('b'),
          revision: 1,
          revisions: [{
            assetId: 'out-a',
            evidence: evidence('a'),
          }, {
            assetId: 'out-b',
            evidence: evidence('b'),
          }, {
            assetId: 'out-c',
            evidence: evidence('c'),
          }],
        }],
      })
      editorStore.set({
        layersPanelOpen: true,
        selectedLayerId: null,
        tool: 'frame',
      })
    })
    const {container} = await renderComponent('LayersPanel')
    const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="layer-row"]')]
    // Visible layers have no eye button.
    expect(rows().some(row => row.querySelector('[aria-label="Hide layer"], [aria-label="Show layer"]'))).toBe(false)
    const selector = container.querySelector<HTMLElement>('[data-testid="revision-selector"]')!
    expect(selector.textContent?.replaceAll(/[◂▸]/g, '')).toBe('2/3')
    act(() => selector.querySelector<HTMLButtonElement>('[aria-label^="Show the next"]')!.click())
    expect(projectStore.state.layers[1].assetId).toBe('out-c')
    expect(projectStore.state.layers[1].evidence?.id).toBe('c')
    expect(container.querySelector('[data-testid="revision-selector"]')!.textContent).toContain('3/3')
    expect(container.querySelector<HTMLButtonElement>('[aria-label^="Show the next"]')!.disabled).toBe(true)
    // Hovering the collection item of a buried revision highlights the selector instead of the thumbnail.
    act(() => projectStore.set(document => ({
      ...document,
      ingredients: [{
        id: 'ingredient-a',
        assetId: 'out-a',
        index: 1,
        name: 'a cat',
        kind: 'generated' as const,
        thumbnail: '',
        createdAt: 0,
      }, {
        id: 'ingredient-c',
        assetId: 'out-c',
        index: 2,
        name: 'a cat',
        kind: 'generated' as const,
        thumbnail: '',
        createdAt: 0,
      }],
    })))
    act(() => editorStore.set({hoveredCollectionIndex: 1}))
    expect(container.querySelector('[data-testid="revision-selector"]')!.hasAttribute('data-highlighted')).toBe(true)
    expect(container.querySelector('button[data-highlighted]')).toBeNull()
    act(() => editorStore.set({hoveredCollectionIndex: 2}))
    expect(container.querySelector('[data-testid="revision-selector"]')!.hasAttribute('data-highlighted')).toBe(false)
    expect(container.querySelectorAll('button[data-highlighted]')).toHaveLength(1)
    act(() => editorStore.set({hoveredCollectionIndex: null}))
    // Undo goes back to the previous revision.
    act(() => projectStore.undo())
    expect(projectStore.state.layers[1].assetId).toBe('out-b')
    // The context menu offers Hide and Reroll.
    const menu = await renderComponent('ContextMenu')
    fireEvent.contextMenu(rows()[0])
    expect(contextMenuStore.state.layerId).toBe('gen')
    const items = [...menu.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.map(item => item.textContent)).toContain('Reroll')
    act(() => items.find(item => item.textContent === 'Hide layer')!.click())
    await act(() => Promise.resolve())
    expect(projectStore.state.layers[1].visible).toBe(false)
    const show = container.querySelector<HTMLButtonElement>('[aria-label="Show layer"]')!
    expect(show).not.toBeNull()
    act(() => show.click())
    expect(projectStore.state.layers[1].visible).toBe(true)
    expect(container.querySelector('[aria-label="Show layer"]')).toBeNull()
    act(() => {
      projectStore.reset({
        ingredients: [],
        layers: [],
      })
      editorStore.set({selectedLayerId: null})
    })
  })
  test('the canvas context menu has no Export entry', async () => {
    const {openContextMenu, closeContextMenu} = await import('#src/lib/contextMenu.ts')
    const menu = await renderComponent('ContextMenu')
    act(() => openContextMenu(10, 10))
    const items = [...menu.container.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)
    expect(items).toContain('Frame all artwork')
    expect(items.some(item => /export/i.test(item ?? ''))).toBe(false)
    act(() => closeContextMenu())
  })
})
