import {createId} from '#src/lib/createId.ts'
import type {Notice} from './state.ts'
import {editorStore} from './state.ts'

const defaultDurations: Record<Notice['kind'], number> = {
  error: 9000,
  info: 4000,
  success: 3000,
}

export const dismissNotice = (id: string) => {
  editorStore.set(state => ({...state, notices: state.notices.filter(notice => notice.id !== id)}))
}

export const notify = (kind: Notice['kind'], text: string, duration = defaultDurations[kind]) => {
  const id = createId()
  editorStore.set(state => ({...state, notices: [...state.notices.slice(-4), {id, kind, text}]}))
  if (duration > 0) {
    setTimeout(() => dismissNotice(id), duration)
  }
  return id
}

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
