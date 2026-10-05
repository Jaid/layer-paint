import {resolve, relative, extname, isAbsolute} from 'node:path'
import {createApi} from './api.ts'
export function startServer(options: {serveFiles?: boolean; port?: number; allowedOrigins?: Set<string>} = {}) {
  const root = resolve('dist')
  const allowedOrigins = options.allowedOrigins ?? new Set<string>()
  if (Bun.env.PUBLIC_ORIGIN) allowedOrigins.add(new URL(Bun.env.PUBLIC_ORIGIN).origin)
  const api = createApi({key: Bun.env.OPENROUTER_API_KEY, baseUrl: Bun.env.IMAGE_API_BASE, allowedOrigins})
  const server = Bun.serve({hostname: Bun.env.HOST ?? '127.0.0.1', port: options.port ?? Number(Bun.env.PORT ?? 3000), idleTimeout: 255, maxRequestBodySize: 40_000_000,
    async fetch(request) {
      const url = new URL(request.url)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !allowedOrigins.has(url.origin)) return new Response('Host not allowed.', {status: 403})
      const response = await api(request)
      if (response) return response
      if (options.serveFiles === false) return new Response('Not found.', {status: 404})
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', {status: 405})
      let path: string
      try {
        const pathname = decodeURIComponent(url.pathname)
        if (pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) return new Response('Not found.', {status: 404})
        path = resolve(root, '.' + pathname)
      } catch {return new Response('Invalid path.', {status: 400})}
      const inside = relative(root, path)
      if (inside.startsWith('..') || isAbsolute(inside)) return new Response('Not found.', {status: 404})
      const file = Bun.file(path)
      const exists = path !== root && await file.exists()
      if (!exists && extname(path)) return new Response('Not found.', {status: 404})
      const result = exists ? file : Bun.file(resolve(root, 'index.html'))
      if (!await result.exists()) return new Response('Build LayerPaint with bun run build first.', {status: 503})
      return new Response(request.method === 'HEAD' ? null : result, {headers: {'Content-Type': result.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin'}})
    },
  })
  return server
}
if (import.meta.main) {
  const server = startServer()
  console.log('LayerPaint: ' + server.url)
}
