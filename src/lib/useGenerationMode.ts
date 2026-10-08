import type {GenerationMode} from './generationRegion.ts'

import {useEffect, useState} from 'react'

import {assets} from './assets.ts'
import {getGenerationMode, getGenerationRegion} from './generationRegion.ts'
import {editorStore, projectStore} from './state.ts'
import {useStore} from './store/index.ts'

/** Live generation mode for the current region. Probing pixels is debounced so frame drags stay smooth. */
export const useGenerationMode = (delay = 60): GenerationMode => {
  const layers = useStore(projectStore, state => state.layers)
  const frame = useStore(editorStore, state => state.frame)
  const frameEnabled = useStore(editorStore, state => state.frameEnabled)
  const modelId = useStore(editorStore, state => state.modelId)
  const ratio = useStore(editorStore, state => state.ratio)
  const [assetRevision, setAssetRevision] = useState(0)
  const [mode, setMode] = useState<GenerationMode>('generate')
  useEffect(() => assets.subscribe(() => setAssetRevision(revision => revision + 1)), [])
  useEffect(() => {
    if (!layers.some(layer => layer.visible)) {
      setMode('generate')
      return
    }
    const timer = setTimeout(() => {
      try {
        const region = getGenerationRegion({
          frame,
          frameEnabled,
          modelId,
          ratio,
        }, layers)
        setMode(getGenerationMode(layers, region.frame))
      } catch {
        // Without a working 2D canvas (or with a degenerate frame), the label simply stays as it was.
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [layers, frame, frameEnabled, modelId, ratio, assetRevision, delay])
  return mode
}
