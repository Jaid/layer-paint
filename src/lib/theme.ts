import {Store} from './store/index.ts'
export type Theme = 'dark' | 'light' | 'system'
const read = (): Theme => {try {const saved = localStorage.getItem('layerpaint:theme'); return saved === 'light' || saved === 'system' ? saved : 'dark'} catch {return 'dark'}}
export const themeStore = new Store({theme: read(), dark: true})
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.toggleAttribute('data-dark', dark)
  root.toggleAttribute('data-light', !dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  themeStore.set({theme, dark})
  try {localStorage.setItem('layerpaint:theme', theme)} catch {}
}
export function initializeTheme() {
  applyTheme(themeStore.state.theme)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {if (themeStore.state.theme === 'system') applyTheme('system')})
}
