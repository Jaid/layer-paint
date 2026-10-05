import type {DropTarget} from '#component/Dropzone'
import clsx from 'clsx'
import {ImagePlus, Layers} from 'lucide-react'
import {useDropzoneState} from '#component/Dropzone'
import css from './style.module.sass'

const texts: Record<DropTarget, {description: string
  title: string}> = {
  canvas: {title: 'Add as layer', description: 'The image is placed on the canvas where you drop it'},
  editor: {title: 'Add as ingredient', description: 'Reference it in the prompt with ![n]'},
}

const DropOverlay = ({target}: {target: DropTarget}) => {
  const {active, target: hovered} = useDropzoneState()
  if (!active) {
    return null
  }
  const Icon = target === 'canvas' ? Layers : ImagePlus
  return <div className={clsx(css.overlay, hovered === target && css.hovered)} data-testid={`drop-overlay-${target}`}>
    <div className={css.card}>
      <Icon aria-hidden size={28} strokeWidth={1.4}/>
      <strong>{texts[target].title}</strong>
      <span>{texts[target].description}</span>
    </div>
  </div>
}

export default DropOverlay
