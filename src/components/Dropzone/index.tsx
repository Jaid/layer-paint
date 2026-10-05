import type {DragEvent, PropsWithChildren} from 'react'
import type {DropEvent} from 'react-dropzone'
import {createContext, useContext, useState} from 'react'
import {useDropzone} from 'react-dropzone'
import {routeDroppedFiles} from '#src/lib/drop.ts'
import css from './style.module.sass'

export type DropTarget = 'canvas' | 'editor'

export type DropzoneState = {
  active: boolean
  target: DropTarget | null
}

const DropzoneContext = createContext<DropzoneState>({active: false, target: null})

export const useDropzoneState = () => useContext(DropzoneContext)

const getDropTarget = (element: EventTarget | null): DropTarget | null => {
  if (!(element instanceof Element)) {
    return null
  }
  const target = element.closest<HTMLElement>('[data-drop-target]')?.dataset.dropTarget
  return target === 'canvas' || target === 'editor' ? target : null
}

const getEventPoint = (event: DropEvent) => {
  if ('clientX' in event && typeof event.clientX === 'number') {
    return {x: event.clientX, y: event.clientY}
  }
}

/** Routes dropped files to the half they were dropped on: the canvas creates layers, the editor creates prompt ingredients. */
const Dropzone = ({children}: PropsWithChildren) => {
  const [target, setTarget] = useState<DropTarget | null>(null)
  const handleDrop = (files: Array<File>, _rejections: unknown, event: DropEvent) => {
    const dropTarget = getDropTarget('target' in event ? event.target : null) ?? target ?? 'canvas'
    setTarget(null)
    if (files.length === 0) {
      return
    }
    void routeDroppedFiles(files, dropTarget, getEventPoint(event))
  }
  const {getInputProps, getRootProps, isDragActive} = useDropzone({
    autoFocus: true,
    noClick: true,
    noKeyboard: true,
    onDrop: handleDrop,
    onDragLeave: () => setTarget(null),
  })
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    const next = getDropTarget(event.target)
    if (next !== target) {
      setTarget(next)
    }
  }
  return <DropzoneContext value={{active: isDragActive, target: isDragActive ? target : null}}>
    <div {...getRootProps({className: css.container, onDragOver: handleDragOver})}>
      <input {...getInputProps()}/>
      {children}
    </div>
  </DropzoneContext>
}

export default Dropzone
