import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import mediaMixins from 'vite-plugin-media-mixins'
import title from 'vite-plugin-title'
export default defineConfig({
  plugins: [title(), react(), mediaMixins()],
  optimizeDeps: {include: ['monacozen', '@jsquash/jxl/decode.js']},
  worker: {format: 'es'},
  server: {host: '127.0.0.1', watch: {ignored: ['**/out/**', '**/temp/**', '**/dist/**']}},
  build: {target: 'chrome154', minify: 'oxc', reportCompressedSize: false, chunkSizeWarningLimit: 5000},
})
