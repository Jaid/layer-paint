import {describe, expect, test} from 'bun:test'

import {createApi} from '../scripts/api.ts'
import {startServer} from '../scripts/server.ts'

const key = 'local-test-key-not-a-real-provider-credential'
const token = 'test-browser-session'
const origin = 'http://127.0.0.1:3000'
const body = {
  model: 'google/gemini-3.1-flash-lite-image',
  prompt: 'Edit this picture',
  aspect_ratio: '1:1',
  resolution: '1K',
  input_references: [],
}
const output = {
  data: [{
    b64_json: 'AAAA',
    media_type: 'image/png',
  }],
  usage: {cost: 0.025},
}
const request = (options: {
  body?: unknown
  headers?: Record<string, string>
  origin?: string
  token?: string
} = {}) => new Request(`${origin}/api/generate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: options.origin ?? origin,
    'X-LayerPaint-Token': options.token ?? token,
    ...options.headers,
  },
  body: JSON.stringify(options.body ?? body),
})
const asFetch = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch
describe('local Image API gateway', () => {
  test('health/configuration never reveals the server credential', async () => {
    const api = createApi({
      key,
      token,
    })
    const response = await api(new Request(`${origin}/api/status`))
    expect(response?.status).toBe(200)
    const text = await response!.text()
    expect(text).not.toContain(key)
    expect(JSON.parse(text)).toEqual({
      configured: true,
      csrfToken: token,
    })
  })
  test('missing key produces an explicit configuration error', async () => {
    const response = await createApi({token})(request())
    expect(response?.status).toBe(503)
  })
  test('cross-origin requests are rejected before provider dispatch', async () => {
    let calls = 0
    const api = createApi({
      key,
      token,
      fetch: asFetch(async () => {
        calls++; return Response.json(output)
      }),
    })
    expect((await api(request({origin: 'https://example.invalid'})))?.status).toBe(403)
    expect((await api(request({headers: {'Sec-Fetch-Site': 'cross-site'}})))?.status).toBe(403)
    expect(calls).toBe(0)
  })
  test('a missing or incorrect browser token is rejected', async () => {
    const api = createApi({
      key,
      token,
    })
    expect((await api(request({token: ''})))?.status).toBe(403)
    expect((await api(request({token: 'incorrect'})))?.status).toBe(403)
  })
  test('unexpected host names are rejected (DNS rebinding boundary)', async () => {
    const api = createApi({
      key,
      token,
    })
    expect((await api(new Request('http://unexpected.invalid/api/status')))?.status).toBe(403)
  })
  test('only a validated Image API request reaches the dedicated images endpoint', async () => {
    let seen: {
      authorization: string | null
      body: unknown
      url: string
    } | undefined
    const api = createApi({key, token, fetch: asFetch(async (input, init) => {
      seen = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get('authorization'),
      }
      return Response.json(output)
    })})
    const response = await api(request({body: {
      ...body,
      n: 200,
      tools: ['not forwarded'],
      messages: ['wrong endpoint'],
    }}))
    expect(response?.status).toBe(200)
    expect(seen?.url).toBe('https://openrouter.ai/api/v1/images')
    expect(seen?.authorization).toBe(`Bearer ${key}`)
    expect(seen?.body).toEqual({
      ...body,
      n: 1,
    })
    expect(await response!.json()).toEqual(output)
  })
  test('provider error bodies are not reflected into the browser', async () => {
    const api = createApi({
      key,
      token,
      fetch: asFetch(async () => Response.json({error: {message: `Failure echo: ${key}`}}, {status: 401})),
    })
    const response = await api(request())
    expect(response?.status).toBe(401)
    expect(await response!.text()).not.toContain(key)
  })
  test('invalid request content and remote image references never reach the provider', async () => {
    let calls = 0
    const api = createApi({
      key,
      token,
      fetch: asFetch(async () => {
        calls++; return Response.json(output)
      }),
    })
    expect((await api(request({headers: {'Content-Type': 'text/plain'}})))?.status).toBe(415)
    expect((await api(request({body: {
      ...body,
      input_references: [{
        type: 'image_url',
        image_url: {url: 'http://127.0.0.1/private'},
      }],
    }})))?.status).toBe(400)
    expect(calls).toBe(0)
  })
  test('upstream concurrency slots remain held until response bodies finish', async () => {
    const controllers: Array<ReadableStreamDefaultController<Uint8Array>> = []
    const api = createApi({
      key,
      token,
      fetch: asFetch(async () => new Response(new ReadableStream<Uint8Array>({start(controller) {
        controllers.push(controller)
      }}))),
    })
    const first = api(request()); const second = api(request())
    for (let i = 0; i < 100 && controllers.length < 2; i++) {
      await Bun.sleep(1)
    }
    expect(controllers.length).toBe(2)
    expect((await api(request()))?.status).toBe(429)
    for (const controller of controllers) {
      controller.enqueue((new TextEncoder).encode(JSON.stringify(output))); controller.close()
    }
    expect((await first)?.status).toBe(200); expect((await second)?.status).toBe(200)
  })
  test('redirect-prone and non-HTTPS public upstream bases are refused', () => {
    expect(() => createApi({baseUrl: 'http://public.invalid/api'})).toThrow('HTTPS')
  })
})
describe('production static boundary', () => {
  test('hidden files and traversal cannot be requested through the application server', async () => {
    const server = startServer({port: 0})
    try {
      for (const path of ['/.env', '/.git/config', '/%2eenv', '/assets/%2e%2e/%2eenv']) {
        expect((await fetch(server.url.origin + path)).status).toBe(404)
      }
      expect((await fetch(`${server.url.origin}/api/status`)).status).toBe(200)
    } finally {
      await server.stop(true)
    }
  })
})
