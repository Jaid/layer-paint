import clsx from 'clsx'
import {X} from 'lucide-react'

import {dismissNotice} from '#src/lib/notices.ts'
import {editorStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

const Notices = () => {
  const notices = useStore(editorStore, state => state.notices)
  return <div className={css.container} aria-live='polite' data-overlay-control>
    {notices.map(notice => <div key={notice.id} className={clsx(css.notice, css[notice.kind])} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button className={css.dismiss} aria-label='Dismiss' type='button' onClick={() => dismissNotice(notice.id)}><X size={13} /></button>
    </div>)}
  </div>
}

export default Notices
