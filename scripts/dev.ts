import {createServer} from 'vite'
import {startServer} from './server.ts'
const allowedOrigins = new Set<string>()
const api = startServer({serveFiles: false, port: 0, allowedOrigins})
const vite = await createServer({server: {host: '127.0.0.1', proxy: {'/api': {target: api.url.origin, changeOrigin: true}}}})
await vite.listen()
for (const value of vite.resolvedUrls?.local ?? []) allowedOrigins.add(new URL(value).origin)
vite.printUrls()
const close = async () => {await vite.close(); api.stop(true); process.exit()}
process.once('SIGINT', () => {void close()})
process.once('SIGTERM', () => {void close()})
