import {timingSafeEqual} from 'node:crypto'
import {readBoundedBody, validateImageRequest, parseImageResult} from '../src/lib/imageApi.ts'
import {applyImageCatalog, parseImageCatalog} from '../src/lib/models/index.ts'
import catalogSnapshot from '../src/lib/models/catalog.json'

export type ApiOptions = {
  key?: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  token?: string
  allowedOrigins?: Set<string>
}
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}})
const fail = (status: number, message: string) => json({error: {message}}, status)
const localHost = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
const matchesToken = (expected: string, received: string) => {
  const a = Buffer.from(expected), b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Local, same-origin gateway. Not an authenticated multi-user service. */
export function createApi(options: ApiOptions = {}) {
  const base = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const parsedBase = new URL(base)
  if (parsedBase.protocol !== 'https:' && !(parsedBase.protocol === 'http:' && localHost(parsedBase.hostname))) throw new Error('Image API base must use HTTPS, or HTTP on loopback for tests.')
  const token = options.token ?? crypto.randomUUID()
  const fetcher = options.fetch ?? globalThis.fetch
  const allowedOrigins = options.allowedOrigins ?? new Set<string>()
  let active = 0
  let catalogCache: {data: unknown[]; at: number} | undefined
  let catalogPending: Promise<{data: unknown[]; at: number}> | undefined

  const getCatalog = async () => {
    if (catalogCache && Date.now() - catalogCache.at < 600_000) return catalogCache
    catalogPending ??= (async () => {
      const response = await fetcher(`${base}/images/models`, {signal: AbortSignal.timeout(12_000), redirect: 'error'})
      if (!response.ok) throw new Error('Discovery unavailable.')
      const value: unknown = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 2_000_000)))
      const data = parseImageCatalog(value)
      applyImageCatalog({data})
      catalogCache = {data, at: Date.now()}
      return catalogCache
    })().finally(() => {catalogPending = undefined})
    return catalogPending
  }

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return undefined
    // Host validation also limits DNS rebinding; explicit reverse-proxy origins must be configured.
    if (!localHost(url.hostname) && !allowedOrigins.has(url.origin)) return fail(403, 'This host is not allowed.')
    const origin = request.headers.get('origin')
    if ((origin && origin !== url.origin && !allowedOrigins.has(origin)) || request.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'Cross-origin API requests are not allowed.')
    if (url.pathname === '/api/status' && request.method === 'GET') return json({configured: Boolean(options.key), csrfToken: token})
    if (url.pathname === '/api/models' && request.method === 'GET') {
      try {const value = await getCatalog(); return json({data: value.data, retrievedAt: new Date(value.at).toISOString(), source: 'live'})}
      catch {return json({...catalogSnapshot, source: 'snapshot'})}
    }
    if (url.pathname !== '/api/generate') return fail(404, 'Unknown API route.')
    if (request.method !== 'POST') return fail(405, 'Use POST for generation.')
    if (!matchesToken(token, request.headers.get('x-layerpaint-token') ?? '')) return fail(403, 'Refresh the application to establish a local session.')
    if (!options.key) return fail(503, 'No server-side API key is configured. Set OPENROUTER_API_KEY in .env or enter a browser-session key.')
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(415, 'Use an application/json request body.')
    if (active >= 2) return fail(429, 'Two generation requests are already running.')
    active++
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(240_000)])
    try {
      let payload: ReturnType<typeof validateImageRequest>
      try {
        const bytes = await readBoundedBody(request, 40_000_000, signal)
        payload = validateImageRequest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)))
      } catch (error) {
        // Validator messages are local and bounded, not arbitrary provider response text.
        const message = error instanceof Error ? error.message : 'Invalid request.'
        return fail(message.includes('size limit') ? 413 : 400, message.slice(0, 300))
      }
      const response = await fetcher(`${base}/images`, {
        method: 'POST', redirect: 'error', signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${options.key}`, 'X-OpenRouter-Title': 'LayerPaint'},
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await response.body?.cancel()
        const status = response.status >= 400 && response.status < 600 ? response.status : 502
        return fail(status, `Image generation failed (HTTP ${status}). Check model access, credit balance and the selected capabilities.`)
      }
      // Keep the concurrency slot until the entire upstream body has been read and validated.
      const bytes = await readBoundedBody(response, 64_000_000, signal)
      const result = parseImageResult(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)))
      signal.throwIfAborted()
      return json(result)
    } catch {
      return fail(signal.aborted ? 504 : 502, signal.aborted ? 'Generation was canceled or timed out.' : 'The Image API returned an invalid or interrupted response.')
    } finally {active--}
  }
}
