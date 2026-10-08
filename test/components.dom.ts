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
  test('Ingredients shows the canvas reference', async () => {
    const {container} = await renderComponent('Ingredients')
    expect(container.textContent).toContain('![0]')
  })
  test('LayersPanel shows mask sliders only for non-background layers', async () => {
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
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2)
    act(() => editorStore.set({selectedLayerId: 'a'}))
    const second = await renderComponent('LayersPanel')
    expect(second.container.querySelectorAll('input[type="range"]')).toHaveLength(0)
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
  test('CanvasToolbar', async () => {
    const {container} = await renderComponent('CanvasToolbar')
    expect(container.textContent).toContain('Export')
    expect(container.textContent).toMatch(/\d+%/)
  })
})
