import {useEffect, useState} from 'react'

import {editorStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

/** how long the indicator stays visible after the latest zoom change, in milliseconds */
export const zoomIndicatorDuration = 2000

/** transient canvas overlay that briefly shows the zoom level whenever it changes */
const ZoomIndicator = () => {
  const scale = useStore(editorStore, state => state.view.scale)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // Comparing against the last seen scale ignores pans and unrelated editor updates.
    let previous = editorStore.state.view.scale
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = editorStore.subscribe(() => {
      const next = editorStore.state.view.scale
      if (next === previous) {
        return
      }
      previous = next
      setVisible(true)
      clearTimeout(timer)
      timer = setTimeout(() => setVisible(false), zoomIndicatorDuration)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [])
  return <output className={css.indicator} aria-hidden={!visible} aria-label='Zoom level' data-testid='zoom-indicator' data-visible={visible || undefined}>{Math.round(scale * 100)}%</output>
}

export default ZoomIndicator
