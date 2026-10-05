import type {RatioString} from '#src/lib/ratio.ts'

import clsx from 'clsx'
import {useId} from 'react'

import {setRatio} from '#src/lib/actions.ts'
import {getModel} from '#src/lib/models/index.ts'
import {parseRatio, sortRatios} from '#src/lib/ratio.ts'
import {editorStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

const RatioShape = ({ratio, size = 16}: {
  ratio: string
  size?: number
}) => {
  const aspect = parseRatio(ratio)
  const width = aspect >= 1 ? size : size * aspect
  const height = aspect >= 1 ? size / aspect : size
  return <span
    className={css.shapeBox} aria-hidden style={{
      width: size,
      height: size,
    }}
  >
    <span
      className={css.shape} style={{
        width,
        height,
      }}
    />
  </span>
}
/** frame ratio selector that only offers ratios the active model supports */
const RatioPicker = () => {
  const id = useId()
  const popoverId = `ratio-${id}`
  const ratio = useStore(editorStore, state => state.ratio)
  const modelId = useStore(editorStore, state => state.modelId)
  const ratios = sortRatios(getModel(modelId).aspectRatios)
  const choose = (value: RatioString) => {
    setRatio(value)
    document.getElementById(popoverId)?.hidePopover()
  }
  return <>
    <button className={css.trigger} popoverTarget={popoverId} style={{anchorName: `--${popoverId}`}} title='Frame aspect ratio' type='button'>
      <RatioShape ratio={ratio} />
      <span>{ratio}</span>
    </button>
    <div id={popoverId} className={css.popover} popover='auto' style={{positionAnchor: `--${popoverId}`}}>
      <div className={css.grid}>
        {ratios.map(entry => <button key={entry} className={clsx(css.option, entry === ratio && css.selected)} aria-pressed={entry === ratio} type='button' onClick={() => choose(entry)}>
          <RatioShape ratio={entry} size={22} />
          <span>{entry}</span>
        </button>)}
      </div>
    </div>
  </>
}

export default RatioPicker
