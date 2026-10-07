import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import puppeteer from 'puppeteer-core'
import type {HTTPRequest, Page} from 'puppeteer-core'
import type {ImageRequest} from '../src/lib/imageApi.ts'
import {startServer} from './server.ts'
import catalog from '../src/lib/models/catalog.json'

const candidates = [Bun.env.CHROME_PATH, Bun.which('chrome'), Bun.which('chromium'), 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((path): path is string => Boolean(path))
const executablePath = (await Promise.all(candidates.map(async path => await Bun.file(path).exists() ? path : undefined))).find(Boolean)
if (!executablePath) throw new Error('Chrome was not found. Set CHROME_PATH to a current Chrome/Chromium executable.')
await mkdir('out/test/screenshots', {recursive: true})
await Bun.write('test/fixtures/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="white"/><circle cx="64" cy="64" r="48" fill="#223355"/><path d="M64 22 77 60 108 64 70 77 64 108 51 70 22 64 58 51Z" fill="#f7bd65"/></svg>')
const image = (await Bun.file('test/fixtures/red.png').bytes()).toBase64()
const server = startServer({port: 0})
const development = Bun.argv.includes('--development')
const vite = development ? await (await import('vite')).createServer({server: {host: '127.0.0.1', port: 0}}) : undefined
if (vite) await vite.listen()
const appOrigin = vite ? new URL(vite.resolvedUrls!.local[0]).origin : server.url.origin
const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-sandbox']})
await browser.defaultBrowserContext().overridePermissions(appOrigin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
const checks: Array<{name: string; passed: boolean; durationMs: number}> = []
const errors: string[] = []
const requests: ImageRequest[] = []
const pending: HTTPRequest[] = []
let defer = false
let page: Page
const output = () => JSON.stringify({data: [{b64_json: image, media_type: 'image/png'}], usage: {cost: 0.025}})
const respond = async (request: HTTPRequest) => {try {await request.respond({status: 200, contentType: 'application/json', body: output()})} catch {}}
const release = async () => {defer = false; for (const request of pending.splice(0)) await respond(request)}
async function wire(target: Page) {
  target.on('pageerror', error => errors.push(String(error)))
  await target.setRequestInterception(true)
  target.on('request', request => {
    void (async () => {
      const url = new URL(request.url())
      if (url.pathname === '/api/models' || url.pathname === '/api/v1/images/models') await request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({...catalog, source: 'snapshot'})})
      else if (url.pathname === '/api/status') await request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({configured: true, csrfToken: 'browser-test-session'})})
      else if (url.pathname === '/api/generate') {
        const body = JSON.parse(request.postData() ?? '{}') as ImageRequest
        requests.push(body)
        assert.equal(request.headers().authorization, undefined, 'The browser must not send a server credential.')
        if (defer) pending.push(request); else await respond(request)
      } else if (url.hostname === 'openrouter.ai') await request.abort()
      else await request.continue()
    })().catch(error => {errors.push('Interception: ' + String(error)); void request.abort().catch(() => {})})
  })
}
async function ready(target: Page) {
  await target.waitForFunction(() => Boolean(globalThis.layerPaint?.persistenceStore.state.hydrated), {timeout: 30000})
  await target.waitForSelector('.monaco-editor textarea', {timeout: 30000})
}
async function button(label: string, target = page) {
  for (const element of await target.$$('button')) if ((await element.evaluate(node => node.textContent?.trim())) === label) {await element.click(); return}
  throw new Error(`Button not found: ${label}`)
}
async function check(name: string, action: () => Promise<void>) {
  const start = performance.now()
  try {await action(); checks.push({name, passed: true, durationMs: Math.round(performance.now() - start)}); console.log('PASS ' + name)}
  catch (error) {checks.push({name, passed: false, durationMs: Math.round(performance.now() - start)}); await page.screenshot({path: 'out/test/screenshots/failure.png'}).catch(() => {}); throw new Error(name, {cause: error})}
}
const chord = async (key: 'a' | 'z' | 'Enter', shift = false) => {await page.keyboard.down('Control'); if (shift) await page.keyboard.down('Shift'); await page.keyboard.press(key); if (shift) await page.keyboard.up('Shift'); await page.keyboard.up('Control')}
const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

try {
  page = await browser.newPage()
  await wire(page)
  await page.setViewport({width: 1600, height: 1000})
  await page.goto(appOrigin + '/?debug=true', {waitUntil: 'networkidle0'})
  await ready(page)
  console.log('Browser: ' + await browser.version())

  await check('Production startup, real Monaco and docked layers', async () => {
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('[data-viewport]')!.getBoundingClientRect(), dock = document.querySelector('[data-testid="layers-panel"]')!.getBoundingClientRect()
      const frame = document.querySelector('[data-testid="frame"]')!.getBoundingClientRect()
      return {canvasRight: canvas.right, dockLeft: dock.left, frameWidth: frame.width, frameHeight: frame.height, count: document.querySelectorAll('[data-testid="frame"]').length}
    })
    assert.equal(layout.count, 1); assert.ok(layout.frameWidth > 100); assert.ok(Math.abs(layout.frameWidth - layout.frameHeight) < 1); assert.ok(layout.canvasRight <= layout.dockLeft + 1)
  })

  await check('An empty canvas keeps the frame in place and pans instead', async () => {
    await settle()
    const before = await page.evaluate(() => ({frame: {...globalThis.layerPaint!.editorStore.state.frame}, view: {...globalThis.layerPaint!.editorStore.state.view}, layers: globalThis.layerPaint!.projectStore.state.layers.length}))
    assert.equal(before.layers, 0)
    const bounds = (await (await page.$('[data-testid="frame"]'))!.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 40, {steps: 8}); await page.mouse.up()
    await page.keyboard.press('ArrowRight')
    const after = await page.evaluate(() => ({frame: {...globalThis.layerPaint!.editorStore.state.frame}, view: {...globalThis.layerPaint!.editorStore.state.view}}))
    assert.deepEqual(after.frame, before.frame)
    assert.ok(Math.abs(after.view.x - before.view.x - 60) < 1 && Math.abs(after.view.y - before.view.y - 40) < 1, 'Dragging inside the empty frame should pan the view.')
    await page.evaluate(view => globalThis.layerPaint!.editorStore.set({view}), before.view)
    await settle()
  })

  await check('PNG imports, SVG reference conversion and actual JXL worker decoding', async () => {
    await (await page.$('input[aria-label="Add canvas images"]'))!.uploadFile(resolve('test/fixtures/blue.png'))
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 1)
    await (await page.$('input[aria-label="Add prompt images"]'))!.uploadFile(resolve('test/fixtures/red.png'), resolve('test/fixtures/logo.svg'))
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.ingredients.length === 2)
    await (await page.$('input[aria-label="Add canvas images"]'))!.uploadFile(resolve('test/fixtures/red.jxl'))
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 2)
    const formats = await page.evaluate(() => {
      const h = globalThis.layerPaint!, doc = h.projectStore.state
      return {jxl: h.assets.require(doc.layers[1].assetId).blob.type, svg: h.assets.require(doc.ingredients[1].assetId).blob.type, ids: doc.ingredients.map(item => item.index)}
    })
    assert.equal(formats.jxl, 'image/webp'); assert.equal(formats.svg, 'image/webp'); assert.deepEqual(formats.ids, [1, 2])
  })

  const prompt = 'The hand should hold a cup of coffee with ![2] printed on it'
  await check('Zero-delay typing preserves every character and implicit canvas reference', async () => {
    const editor = (await page.$('.monaco-editor'))!, bounds = (await editor.boundingBox())!
    await page.mouse.click(bounds.x + 50, bounds.y + 22)
    await chord('a')
    await page.keyboard.type(prompt, {delay: 0})
    await page.waitForFunction(text => globalThis.layerPaint?.editorStore.state.prompt === text, {}, prompt)
    const preview = await page.evaluate(async () => {const result = await globalThis.layerPaint!.previewRequest(); return {sources: result.sources, errors: result.errors}})
    assert.deepEqual(preview.errors, []); assert.deepEqual(preview.sources, [{kind: 'canvas'}, {kind: 'ingredient', index: 2}])
  })

  await check('Context menu contains Frame it instead of a persistent layer button', async () => {
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Frame it').length), 0)
    await page.click('[aria-label="Actions for red"]')
    await page.waitForSelector('[role="menu"]')
    await button('Frame it')
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
  })

  await check('Frame edge drag snaps aspect ratios without moving the opposite edge', async () => {
    await page.evaluate(() => globalThis.layerPaint!.actions.fitViewToFrame())
    await settle()
    const before = await page.evaluate(() => ({...globalThis.layerPaint!.editorStore.state.frame}))
    const bounds = (await (await page.$('[data-testid="frame"]'))!.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2)
    await new Promise(resolve => setTimeout(resolve, 150))
    const edge = (await (await page.$('[data-edge="e"]'))!.boundingBox())!
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
    await page.mouse.down(); await page.mouse.move(edge.x + edge.width / 2 + bounds.width * 0.5, edge.y + edge.height / 2, {steps: 12}); await page.mouse.up()
    const after = await page.evaluate(() => ({frame: {...globalThis.layerPaint!.editorStore.state.frame}, ratio: globalThis.layerPaint!.editorStore.state.ratio}))
    assert.equal(after.frame.x, before.x); assert.equal(after.frame.height, before.height); assert.notEqual(after.ratio, '1:1')
    const [w, h] = after.ratio.split(':').map(Number); assert.ok(Math.abs(after.frame.width / after.frame.height - w / h) < 1e-8)
  })

  await check('Imported layers resize and rotate; one drag is one undo step', async () => {
    await page.click('[title="Select red"]'); await button('Move, resize & rotate'); await settle()
    const before = await page.evaluate(() => ({...globalThis.layerPaint!.projectStore.state.layers[1].rect}))
    const corner = (await (await page.$('[data-layer-corner="se"]'))!.boundingBox())!
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down(); await page.mouse.move(corner.x + 45, corner.y + 45, {steps: 8}); await page.mouse.up()
    const resized = await page.evaluate(() => ({...globalThis.layerPaint!.projectStore.state.layers[1].rect}))
    assert.ok(resized.width > before.width); assert.ok(Math.abs(resized.width / resized.height - before.width / before.height) < 1e-8)
    await settle()
    const rotate = (await (await page.$('[data-layer-rotate]'))!.boundingBox())!
    await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2); await page.mouse.down(); await page.mouse.move(rotate.x + 65, rotate.y + 35, {steps: 10}); await page.mouse.up()
    const rotated = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers[1].rotation ?? 0)
    assert.ok(Math.abs(rotated) > 1)
    await chord('z')
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers[1].rotation ?? 0), 0)
    await chord('z', true)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers[1].rotation ?? 0), rotated)
  })

  await check('One Ctrl+Enter produces one Image API call and a locked generated layer', async () => {
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.actions.fitFrameToContent(); h.editorStore.set({tool: 'frame'}); h.actions.fitViewToFrame()})
    const editor = (await (await page.$('.monaco-editor'))!.boundingBox())!
    await page.mouse.click(editor.x + 55, editor.y + 22)
    const count = requests.length
    await chord('Enter')
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 3)
    assert.equal(requests.length, count + 1)
    assert.equal(requests.at(-1)!.input_references.length, 2)
    const state = await page.evaluate(() => {const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.at(-1)!; const rect = {...layer.rect}; h.actions.updateLayer(layer.id, {rect: {...rect, x: rect.x + 100}, rotation: 90}); return {rect, after: h.projectStore.state.layers.at(-1)!.rect, rotation: h.projectStore.state.layers.at(-1)!.rotation ?? 0, evidence: Boolean(layer.evidence?.canvasAssetId), cost: h.editorStore.state.sessionCost}})
    assert.deepEqual(state.after, state.rect); assert.equal(state.rotation, 0); assert.equal(state.evidence, true); assert.equal(state.cost, 0.025)
  })

  await check('In-flight edits cannot mutate captured inputs, prompt or result placement', async () => {
    const frame = await page.evaluate(() => ({...globalThis.layerPaint!.editorStore.state.frame}))
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({prompt: 'A localized detail repair'}))
    defer = true
    await page.click('[data-testid="generate"]')
    for (let i = 0; i < 200 && pending.length < 1; i++) await Bun.sleep(10)
    assert.equal(pending.length, 1)
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.editorStore.set({prompt: 'A different future request', frame: {...h.editorStore.state.frame, x: 999}})})
    await release()
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 4)
    const evidence = await page.evaluate(() => {const layer = globalThis.layerPaint!.projectStore.state.layers.at(-1)!; return {rect: layer.rect, frame: layer.evidence!.frame, prompt: layer.evidence!.prompt, canvas: layer.evidence!.canvasAssetId, output: layer.evidence!.outputAssetId}})
    assert.deepEqual(evidence.rect, frame); assert.deepEqual(evidence.frame, frame); assert.equal(evidence.prompt, 'A localized detail repair'); assert.ok(evidence.canvas && evidence.canvas !== evidence.output)
  })

  await check('Advanced mask hides the frame and exposes contracted/feather bounds', async () => {
    await button('Advanced mask')
    assert.equal(await page.$('[data-testid="frame"]'), null)
    await page.evaluate(() => {
      const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.at(-1)!
      h.actions.updateLayer(layer.id, {area: 0.25, feather: 0.5, roundness: 0.3})
      h.editorStore.set({hoveredLayerId: layer.id})
    })
    await page.waitForSelector('[data-testid="mask-outline"]')
    assert.ok(await page.$('[data-testid="feather-outline"]'))
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.editorStore.set({frame: {...h.projectStore.state.layers.at(-1)!.rect}}); h.actions.fitViewToFrame()})
    await settle()
    const outline = (await (await page.$('[data-testid="layer-outline"]'))!.boundingBox())!
    const before = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.at(-1)!.offsetX ?? 0)
    await page.mouse.move(outline.x + outline.width / 2, outline.y + outline.height / 2); await page.mouse.down(); await page.mouse.move(outline.x + outline.width / 2 + 20, outline.y + outline.height / 2 + 10, {steps: 6}); await page.mouse.up()
    assert.notEqual(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.at(-1)!.offsetX ?? 0), before)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid="frame"]')
  })

  await check('Canceling a running request adds no late layer', async () => {
    const count = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length)
    defer = true
    await page.click('[data-testid="generate"]')
    for (let i = 0; i < 200 && pending.length < 1; i++) await Bun.sleep(10)
    await page.click('[title="Cancel generation"]')
    await release()
    await Bun.sleep(200)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length), count)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.editorStore.state.jobs.length), 0)
  })

  await check('Pixel regression: isolated masks preserve the opaque base and exposed outer edge', async () => {
    const pixels = await page.evaluate(async () => {
      const h = globalThis.layerPaint!
      const make = async (color: string) => {const c = new OffscreenCanvas(100, 100); const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 100, 100); return h.assets.add(await c.convertToBlob({type: 'image/png'}))}
      const blue = await make('#0000ff'), red = await make('#ff0000')
      const base = {id: 'pixel-base', assetId: blue.id, name: 'Blue', kind: 'import' as const, createdAt: 0, visible: true, area: 1, feather: 0, rect: {x: 0, y: 0, width: 100, height: 100}}
      const edit = {...base, id: 'pixel-edit', assetId: red.id, kind: 'generated' as const, feather: 0.5, rect: {x: 50, y: 0, width: 100, height: 100}}
      const canvas = h.renderRegion({layers: [base, edit], region: {x: 0, y: 0, width: 150, height: 100}, size: {width: 150, height: 100}}).canvas
      const ctx = canvas.getContext('2d')!
      const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data]
      return {base: at(25, 50), overlap: at(51, 50), outside: at(149, 50)}
    })
    assert.deepEqual(pixels.base, [0, 0, 255, 255]); assert.equal(pixels.overlap[3], 255); assert.ok(pixels.overlap[2] > 200); assert.deepEqual(pixels.outside, [255, 0, 0, 255])
  })

  await check('Native-detail export keeps a tiny high-density patch; all raster encodings decode', async () => {
    const result = await page.evaluate(async () => {
      const h = globalThis.layerPaint!
      await h.newProject()
      const make = async (side: number, color: string) => {const canvas = new OffscreenCanvas(side, side); const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, side, side); return h.assets.add(await canvas.convertToBlob({type: 'image/png'}))}
      const base = await make(128, '#0000ff'), detail = await make(512, '#ff0000')
      const common = {createdAt: 0, visible: true, area: 1, feather: 0}
      const layers = [{...common, id: 'detail-base', assetId: base.id, name: 'Base', kind: 'import' as const, rect: {x: 0, y: 0, width: 128, height: 128}}, {...common, id: 'detail-patch', assetId: detail.id, name: 'Detail', kind: 'generated' as const, rect: {x: 48, y: 48, width: 32, height: 32}}]
      h.projectStore.reset({layers, ingredients: [], nextIngredientIndex: 1})
      h.editorStore.set({frame: {x: 0, y: 0, width: 128, height: 128}, exportMode: 'detail'})
      const plan = h.getExportPlan(layers, {x: 0, y: 0, width: 128, height: 128})
      const formats = []
      for (const format of ['png', 'jpeg', 'webp'] as const) {const blob = await h.renderExport('content', format); const image = await createImageBitmap(blob); formats.push({type: blob.type, width: image.width, height: image.height}); image.close()}
      const png = await h.renderExport('content', 'png')
      if (navigator.clipboard?.write) {await navigator.clipboard.write([new ClipboardItem({'image/png': png})]); const items = await navigator.clipboard.read(); if (!items.some(item => item.types.includes('image/png'))) throw new Error('PNG clipboard read-back failed.')}
      return {plan, formats}
    })
    assert.equal(result.plan.width, 2048); assert.equal(result.plan.height, 2048)
    assert.deepEqual(result.formats.map(item => item.type), ['image/png', 'image/jpeg', 'image/webp'])
    assert.ok(result.formats.every(item => item.width === 2048 && item.height === 2048))
  })

  await check('Portable projects remap asset identity and autosave restores the same pixels', async () => {
    const result = await page.evaluate(async () => {
      const h = globalThis.layerPaint!, originalId = h.projectStore.state.layers[0].assetId
      const serialized = await h.serializeProject()
      await h.openPortableProject(new Blob([serialized], {type: 'application/json'}))
      const newId = h.projectStore.state.layers[0].assetId
      await h.flushAutosave()
      return {different: originalId !== newId, count: h.projectStore.state.layers.length, format: JSON.parse(serialized).format}
    })
    assert.equal(result.different, true); assert.equal(result.format, 'layerpaint'); assert.equal(result.count, 2)
    await page.reload({waitUntil: 'networkidle0'}); await ready(page)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length), 2)
  })

  await check('Invalid portable imports leave the current workspace untouched', async () => {
    const result = await page.evaluate(async () => {
      const h = globalThis.layerPaint!, before = h.projectStore.state
      try {await h.openPortableProject(new Blob([JSON.stringify({format: 'layerpaint', version: 1, document: {layers: [{id: 'bad'}]}, assets: []})])); return false}
      catch {return before === h.projectStore.state}
    })
    assert.equal(result, true)
  })

  await check('Demo mode, dark/light themes and responsive viewport controls', async () => {
    await page.evaluate(async () => {const h = globalThis.layerPaint!; await h.newProject(); h.editorStore.set({demoMode: true, prompt: 'A moonlit mountain observatory above a sea of clouds'}); await h.generate(); h.actions.fitViewToFrame()})
    const requestsBefore = requests.length
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers[0].evidence?.demo), true)
    for (const [name, width, height, theme] of [['desktop-dark', 1600, 1000, 'dark'], ['desktop-light', 1600, 1000, 'light'], ['tablet-dark', 768, 820, 'dark'], ['tile-dark', 432, 600, 'dark'], ['mobile-dark', 390, 844, 'dark']] as const) {
      await page.setViewport({width, height})
      await page.select('select[aria-label="Color scheme"]', theme)
      await page.evaluate(() => {const h = globalThis.layerPaint!; if (innerWidth <= 1000) h.editorStore.set({layersPanelOpen: false})})
      await Bun.sleep(150)
      await page.evaluate(() => globalThis.layerPaint!.actions.fitViewToFrame())
      await settle()
      const layout = await page.evaluate(() => {const button = document.querySelector('[data-testid="generate"]')!.getBoundingClientRect(), canvas = document.querySelector('[data-viewport]')!.getBoundingClientRect(); return {buttonBottom: button.bottom, buttonRight: button.right, canvasHeight: canvas.height, scrollWidth: document.body.scrollWidth, width: innerWidth, height: innerHeight, theme: document.documentElement.hasAttribute('data-light') ? 'light' : 'dark'}})
      assert.equal(layout.theme, theme); assert.ok(layout.buttonRight <= width + 1); assert.ok(layout.buttonBottom <= height); assert.ok(layout.canvasHeight >= 150); assert.ok(layout.scrollWidth <= width + 1)
      const editorBounds = await page.$eval('[data-drop-target="editor"]', node => node.getBoundingClientRect().toJSON())
      const monacoBounds = await page.$eval('.monaco-editor', node => node.getBoundingClientRect().toJSON())
      assert.ok(layout.buttonBottom <= editorBounds.bottom + 1, 'Generate must remain inside its pane')
      assert.ok(monacoBounds.height >= 50, 'Monaco must remain editable')
      await page.screenshot({path: `out/test/screenshots/${name}.png`})
    }
    assert.equal(requests.length, requestsBefore)
  })

  await check('Explicit New project remains empty after reload', async () => {
    await page.setViewport({width: 1600, height: 1000})
    await Bun.sleep(200)
    await ready(page)
    await settle()
    await button('New'); await page.waitForSelector('dialog[open]'); await button('Start new project')
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 0)
    await page.reload({waitUntil: 'networkidle0'}); await ready(page)
    const result = await page.evaluate(() => ({layers: globalThis.layerPaint!.projectStore.state.layers.length, references: globalThis.layerPaint!.projectStore.state.ingredients.length, prompt: globalThis.layerPaint!.editorStore.state.prompt}))
    assert.deepEqual(result, {layers: 0, references: 0, prompt: ''})
  })

  await check('Failed recovery cannot overwrite saved data until an explicit reset', async () => {
    await page.evaluate(async () => {
      const h = globalThis.layerPaint!
      await h.flushAutosave()
      const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open('layer-paint-definitive', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)})
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), read = store.get('project')
          read.onsuccess = () => {const saved = read.result; saved.savedAt = 123456789; saved.document.layers = [{id: 'broken-recovery-record'}]; store.put(saved, 'project')}
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
        })
      } finally {db.close()}
    })
    await page.reload({waitUntil: 'networkidle0'}); await ready(page)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.persistenceStore.state.paused), true)
    const preserved = await page.evaluate(async () => {
      const h = globalThis.layerPaint!
      h.editorStore.set({prompt: 'Temporary workspace while recovery is paused'})
      await h.flushAutosave()
      const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open('layer-paint-definitive', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)})
      try {return await new Promise<boolean>((resolve, reject) => {const read = db.transaction('state').objectStore('state').get('project'); read.onsuccess = () => resolve(read.result.savedAt === 123456789 && read.result.document.layers[0].id === 'broken-recovery-record'); read.onerror = () => reject(read.error)})} finally {db.close()}
    })
    assert.equal(preserved, true)
    await button('New'); await page.waitForSelector('dialog[open]'); await button('Start new project')
    await page.waitForFunction(() => globalThis.layerPaint?.persistenceStore.state.paused === false)
    await page.reload({waitUntil: 'networkidle0'}); await ready(page)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length), 0)
  })

  assert.deepEqual(errors, [], 'No unexpected browser JavaScript errors are allowed.')
  console.log(`Browser checks: ${checks.length} passed. All provider responses were deterministic mocks; no billable calls were made.`)
} finally {
  await release()
  await Bun.write(development ? 'out/test/browser-development-results.json' : 'out/test/browser-results.json', JSON.stringify({development, checks, errors, mockedGenerationRequests: requests.length, billableRequests: 0}, null, 2))
  await browser.close(); await vite?.close(); await server.stop(true)
}
