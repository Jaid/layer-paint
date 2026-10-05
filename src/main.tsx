import './style.sass'

import mountRoot from 'mount-root'

import App from '#component/App'
import Dropzone from '#component/Dropzone'

import css from './style.module.sass'

const AppWithDropzone = () => <Dropzone>
  <App />
</Dropzone>
mountRoot(AppWithDropzone, {
  id: css.container,
  strict: import.meta.env.DEV,
})
