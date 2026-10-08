import type {Rect} from '#src/lib/geometry.ts'
import type {Job} from '#src/lib/state.ts'

import clsx from 'clsx'
import {RotateCw, X} from 'lucide-react'
import {useEffect, useState} from 'react'

import {dismissJob, generate} from '#src/lib/generation.ts'
import {getModel} from '#src/lib/models/index.ts'

import css from './style.module.sass'

type Props = {
  job: Job
  /** screen rect */
  rect: Rect
}

const useElapsedSeconds = (since: number, active: boolean) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [active])
  return Math.max(0, Math.floor((now - since) / 1000))
}
const JobOverlay = ({job, rect}: Props) => {
  const running = job.status === 'running'
  const seconds = useElapsedSeconds(job.startedAt, running)
  const retry = () => {
    dismissJob(job.id)
    void generate({
      frame: job.rect,
      prompt: job.prompt,
    })
  }
  return <div
    className={clsx(css.overlay, !running && css.failed)}
    data-overlay-control
    data-testid='job-overlay'
    style={{
      transform: `translate(${rect.x}px, ${rect.y}px)`,
      width: rect.width,
      height: rect.height,
    }}
  >
    {running && <>
      <div className={css.shimmer} />
      <div className={css.sparks} />
      <div className={css.scan} />
      <div className={css.ring} />
    </>}
    <div className={css.panel}>
      {running ? <>
        <span className={css.spinner} />
        <span className={css.text}>{getModel(job.modelId).title} · {seconds} s</span>
        <button className={css.button} title='Cancel generation' type='button' onClick={() => dismissJob(job.id)}><X size={14} /></button>
      </> : <>
        <span className={css.error} title={job.error}>{job.error ?? 'Generation failed'}</span>
        <button className={css.button} title='Retry with this frame and prompt' type='button' onClick={retry}><RotateCw size={14} /></button>
        <button className={css.button} title='Dismiss' type='button' onClick={() => dismissJob(job.id)}><X size={14} /></button>
      </>}
    </div>
  </div>
}

export default JobOverlay
