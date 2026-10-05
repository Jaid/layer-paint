import {useStore} from './store/index.ts'
import {themeStore} from './theme.ts'
export const useDarkMode = () => useStore(themeStore, state => state.dark)
