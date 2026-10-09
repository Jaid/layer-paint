import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import puppeteer from 'puppeteer-core'
import type {HTTPRequest, Page} from 'puppeteer-core'
import type {ImageRequest} from '../src/lib/imageApi.ts'
import {startServer} from './server.ts'
import catalog from '../src/lib/models/catalog.json'
import {adjustColor, getAdjustmentParameters} from '../src/lib/adjustments/color.ts'

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
/** Opens the canvas context menu and answers the native file dialog its item opens. */
async function pickViaMenu(item: string, ...files: string[]) {
  const canvas = (await (await page.$('[data-viewport]'))!.boundingBox())!
  await page.mouse.click(canvas.x + 30, canvas.y + canvas.height - 30, {button: 'right'})
  await page.waitForSelector('[role="menu"]')
  const [chooser] = await Promise.all([page.waitForFileChooser(), button(item)])
  await chooser.accept(files.map(file => resolve(file)))
}
const generateLabel = () => page.$eval('[data-testid="generate"]', node => node.textContent?.trim())
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

  await check('An empty canvas keeps the frame in place and unscalable and pans instead', async () => {
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
    // Touching the frame edge reveals no handles, and dragging its corner or edge does not scale it.
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(await page.$$eval('[data-corner], [data-edge]', nodes => nodes.length), 0)
    for (const [x, y] of [[bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height / 2]]) {
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 70, y + 50, {steps: 8}); await page.mouse.up()
    }
    const scaled = await page.evaluate(() => ({frame: {...globalThis.layerPaint!.editorStore.state.frame}, ratio: globalThis.layerPaint!.editorStore.state.ratio}))
    assert.deepEqual(scaled.frame, before.frame); assert.equal(scaled.ratio, '1:1')
    await page.evaluate(view => globalThis.layerPaint!.editorStore.set({view}), before.view)
    await settle()
  })

  await check('PNG imports, SVG reference conversion and actual JXL worker decoding', async () => {
    await pickViaMenu('Import images to canvas…', 'test/fixtures/blue.png')
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 1)
    await pickViaMenu('Add images to collection…', 'test/fixtures/red.png', 'test/fixtures/logo.svg')
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.ingredients.length === 3)
    await pickViaMenu('Import images to canvas…', 'test/fixtures/red.jxl')
    await page.waitForFunction(() => globalThis.layerPaint?.projectStore.state.layers.length === 2)
    const formats = await page.evaluate(() => {
      const h = globalThis.layerPaint!, doc = h.projectStore.state
      return {jxl: h.assets.require(doc.layers[1].assetId).blob.type, svg: h.assets.require(doc.ingredients[2].assetId).blob.type, ids: doc.ingredients.map(item => item.index), kinds: doc.ingredients.map(item => item.kind)}
    })
    // Canvas imports are numbered right away, not only once they are referenced.
    assert.equal(formats.jxl, 'image/webp'); assert.equal(formats.svg, 'image/webp'); assert.deepEqual(formats.ids, [1, 2, 3, 4])
    assert.equal(await page.$$eval('[data-testid="ingredient"]', nodes => nodes.length), 4)
    assert.deepEqual((await page.$$eval('[data-testid="ingredient"]', nodes => nodes.map(node => (node as HTMLElement).dataset.index))).toSorted(), ['1', '2', '3', '4'])
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

  await check('Described references put the description directly before the image', async () => {
    const preview = await page.evaluate(async () => {
      const h = globalThis.layerPaint!, previous = h.editorStore.state.prompt
      h.editorStore.set({prompt: 'Please add ![3](this witch) to the image'})
      const result = await h.previewRequest()
      h.editorStore.set({prompt: previous})
      return {sources: result.sources, text: result.text, errors: result.errors}
    })
    assert.deepEqual(preview.errors, []); assert.deepEqual(preview.sources, [{kind: 'canvas'}, {kind: 'ingredient', index: 3}])
    assert.ok(preview.text.includes('Please add this witch [Image 2] to the image'), preview.text)
    await page.waitForFunction(text => globalThis.layerPaint?.editorStore.state.prompt === text, {}, prompt)
  })

  await check('Collection thumbnails drag into the prompt and onto the canvas', async () => {
    const dragTo = (selector: string, point: (rect: DOMRect) => {x: number; y: number}) => page.evaluate((selector, pointSource) => {
      const tile = document.querySelector<HTMLElement>('[data-testid="ingredient"][data-index="2"]')!, target = document.querySelector<HTMLElement>(selector)!
      const at = new Function('rect', `return (${pointSource})(rect)`)(target.getBoundingClientRect()) as {x: number; y: number}
      const dataTransfer = new DataTransfer()
      tile.dispatchEvent(new DragEvent('dragstart', {bubbles: true, cancelable: true, dataTransfer}))
      const under = document.elementFromPoint(at.x, at.y)!
      const init = {bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, dataTransfer}
      under.dispatchEvent(new DragEvent('dragenter', init)); under.dispatchEvent(new DragEvent('dragover', init))
      const accepted = !under.dispatchEvent(new DragEvent('drop', init))
      tile.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer}))
      return {accepted, types: [...dataTransfer.types]}
    }, selector, point.toString())
    const before = await page.evaluate(() => globalThis.layerPaint!.editorStore.state.prompt)
    const intoEditor = await dragTo('.monaco-editor .view-lines', rect => ({x: rect.left + 4, y: rect.top + 8}))
    assert.equal(intoEditor.accepted, true); assert.ok(intoEditor.types.includes('application/x-layerpaint-ingredient'))
    await page.waitForFunction(previous => globalThis.layerPaint!.editorStore.state.prompt !== previous, {}, before)
    const after = await page.evaluate(() => globalThis.layerPaint!.editorStore.state.prompt)
    assert.ok(after.startsWith('![2]'), after)
    await page.evaluate(text => globalThis.layerPaint!.editorStore.set({prompt: text}), before)
    const layers = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length)
    const onCanvas = await dragTo('[data-viewport]', rect => ({x: rect.left + rect.width * 0.3, y: rect.top + rect.height * 0.3}))
    assert.equal(onCanvas.accepted, true)
    const placed = await page.evaluate(() => {const h = globalThis.layerPaint!, doc = h.projectStore.state, layer = doc.layers.at(-1)!; return {count: doc.layers.length, assetId: layer.assetId, ingredientAssetId: doc.ingredients.find(item => item.index === 2)!.assetId, ingredients: doc.ingredients.length}})
    assert.equal(placed.count, layers + 1); assert.equal(placed.assetId, placed.ingredientAssetId); assert.equal(placed.ingredients, 4, 'Placing a collection image must not create a duplicate number')
    await page.evaluate(() => globalThis.layerPaint!.actions.undo())
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length), layers)
  })

  await check('The frame view at position 0 follows the frame live; collection items export from their context menu', async () => {
    const sample = () => page.$eval('[data-testid="frame-view"] canvas', node => {
      const canvas = node as HTMLCanvasElement, {data} = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11
      return {width: canvas.width, height: canvas.height, sum}
    })
    const first = await page.$eval('[data-testid="ingredients"] [data-index]', node => (node as HTMLElement).dataset.index)
    assert.equal(first, '0', 'The frame view must be the first collection tile')
    const frame = await page.evaluate(() => ({...globalThis.layerPaint!.editorStore.state.frame}))
    await page.evaluate(() => globalThis.layerPaint!.actions.fitFrameToContent()); await settle(); await settle()
    const before = await sample()
    assert.ok(before.width > 0 && before.height > 0 && before.sum > 0, 'The frame view shows the artwork inside the frame')
    // Moving the frame half its width changes the view without any further interaction.
    await page.evaluate(() => {const {frame} = globalThis.layerPaint!.editorStore.state; globalThis.layerPaint!.editorStore.set({frame: {...frame, x: frame.x + frame.width / 2}})}); await settle(); await settle()
    const moved = await sample()
    assert.notEqual(moved.sum, before.sum, 'The frame view must update while the frame moves')
    // Hiding a layer updates it as well.
    const firstLayer = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers[0].id)
    await page.evaluate(id => globalThis.layerPaint!.actions.updateLayer(id, {visible: false}), firstLayer); await settle(); await settle()
    assert.notEqual((await sample()).sum, moved.sum, 'The frame view must update when the artwork changes')
    await page.evaluate(() => globalThis.layerPaint!.actions.undo())
    await page.evaluate(value => globalThis.layerPaint!.editorStore.set({frame: value}), frame); await settle()
    // Collection images download their original bytes.
    await page.evaluate(() => {
      const downloads: Array<{name: string; href: string}> = [], click = HTMLAnchorElement.prototype.click
      Object.assign(globalThis, {downloads, restoreClick: () => {HTMLAnchorElement.prototype.click = click}})
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {downloads.push({name: this.download, href: this.href})}
    })
    await page.click('[data-testid="ingredient"][data-index="1"] button', {button: 'right'})
    await page.waitForSelector('[role="menu"][aria-label="Collection context menu"]')
    assert.deepEqual(await page.$$eval('[role="menu"] [role="menuitem"]', nodes => nodes.map(node => node.textContent)), ['Export', 'Delete'])
    await button('Export')
    const download = await page.waitForFunction(() => (globalThis as unknown as {downloads: Array<{name: string; href: string}>}).downloads[0]).then(handle => handle.jsonValue() as Promise<{name: string; href: string}>)
    const exported = await page.evaluate(async href => {
      const h = globalThis.layerPaint!, blob = await (await fetch(href)).blob(), original = h.assets.require(h.projectStore.state.ingredients.find(item => item.index === 1)!.assetId).blob
      const [a, b] = [await blob.bytes(), await original.bytes()]
      return {same: a.length === b.length && a.every((byte, i) => byte === b[i]), type: blob.type, originalType: original.type}
    }, download.href)
    assert.ok(exported.same, 'Exporting a collection image must keep its original bytes'); assert.equal(exported.type, exported.originalType)
    assert.match(download.name, /\.(png|jpg|webp|svg|jxl)$/)
    await page.evaluate(() => (globalThis as unknown as {restoreClick: () => void}).restoreClick())
    // The frame view opens the raster export dialog, preset to the frame.
    await page.click('[data-testid="frame-view"] button', {button: 'right'})
    await page.waitForSelector('[role="menu"][aria-label="Collection context menu"]')
    await button('Export…')
    await page.waitForSelector('[data-testid="export-dialog"][open]')
    assert.equal(await page.$eval('[aria-label="Export region"]', node => (node as HTMLSelectElement).value), 'frame')
    assert.ok(await page.$eval('[data-testid="export-dialog"]', node => /\d × \d/.test(node.textContent ?? '')))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid="export-dialog"][open]'))
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Export')), false, 'There is no permanent Export button')
  })


  await check('Right-clicking a layer row opens its context menu; there is no actions button', async () => {
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Frame it').length), 0)
    assert.equal(await page.$('[aria-label^="Actions for"]'), null)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.editorStore.state.selectedLayerId), null, 'New layers are not auto-selected')
    await page.click('[title="Select red"]', {button: 'right'})
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
    assert.equal(requests.at(-1)!.model, 'google/gemini-nano-banana-2.1', 'Nano Banana 2.1 is the default model')
    const state = await page.evaluate(() => {const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.at(-1)!; const rect = {...layer.rect}; h.actions.updateLayer(layer.id, {rect: {...rect, x: rect.x + 100}, rotation: 90}); return {rect, after: h.projectStore.state.layers.at(-1)!.rect, rotation: h.projectStore.state.layers.at(-1)!.rotation ?? 0, evidence: Boolean(layer.evidence?.canvasAssetId), cost: h.editorStore.state.sessionCost}})
    assert.deepEqual(state.after, state.rect); assert.equal(state.rotation, 0); assert.equal(state.evidence, true); assert.equal(state.cost, 0.025)
  })

  await check('The generate button names the operation and the frame can be switched off', async () => {
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.actions.fitFrameToContent(); h.editorStore.set({tool: 'frame'})})
    const area = await page.evaluate(() => {const h = globalThis.layerPaint!, base = h.projectStore.state.layers[0]; return {...base.rect}})
    const label = async (frame: {x: number; y: number; width: number; height: number}, expected: string) => {
      await page.evaluate(frame => globalThis.layerPaint!.editorStore.set({frame}), frame)
      await page.waitForFunction(expected => document.querySelector('[data-testid="generate"]')?.textContent?.trim() === expected, {timeout: 3000}, expected).catch(async () => assert.fail(`Expected “${expected}”, got “${await generateLabel()}”`))
    }
    const all = await page.evaluate(() => globalThis.layerPaint!.editorStore.state.frame)
    // The button reserves the width of its longest label, so the frame toggle next to it never moves.
    const toggleLeft = () => page.$eval('[data-testid="frame-toggle"]', node => node.getBoundingClientRect().left)
    const positions: number[] = []
    await label({x: area.x - 10 * area.width, y: area.y, width: area.width, height: area.height}, 'Generate'); positions.push(await toggleLeft())
    await label({x: area.x + area.width / 2, y: area.y, width: area.width, height: area.height}, 'Extend'); positions.push(await toggleLeft())
    await label({x: area.x + area.width / 4, y: area.y + area.height / 4, width: area.width / 4, height: area.height / 4}, 'Patch'); positions.push(await toggleLeft())
    await label(all, 'Transform'); positions.push(await toggleLeft())
    assert.ok(Math.max(...positions) - Math.min(...positions) < 0.5, `The frame toggle moved: ${positions.join(', ')}`)
    // The frame carries no text label.
    assert.equal(await page.$eval('[data-testid="frame"]', node => node.textContent), '')
    // Frame off: generations span all artwork, padded to the closest ratio.
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({frame: {x: -5000, y: -5000, width: 100, height: 100}}))
    await page.click('[data-testid="frame-toggle"]')
    assert.equal(await page.$('[data-testid="frame"]'), null)
    await page.waitForFunction(() => document.querySelector('[data-testid="generate"]')?.textContent?.trim() === 'Transform', {timeout: 3000})
    await page.hover('[data-testid="generate"]')
    await page.waitForSelector('[data-testid="content-region"]')
    const count = requests.length
    await page.click('[data-testid="generate"]')
    await page.waitForFunction(count => globalThis.layerPaint!.editorStore.state.jobs.length === 0 && globalThis.layerPaint!.projectStore.state.layers.length > count, {}, await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length))
    assert.equal(requests.length, count + 1)
    const spanned = await page.evaluate(() => {
      const h = globalThis.layerPaint!, layers = h.projectStore.state.layers, generated = layers.at(-1)!
      const xs = layers.slice(0, -1).filter(layer => layer.visible).map(layer => layer.rect)
      const left = Math.min(...xs.map(rect => rect.x)), top = Math.min(...xs.map(rect => rect.y)), right = Math.max(...xs.map(rect => rect.x + rect.width)), bottom = Math.max(...xs.map(rect => rect.y + rect.height))
      const rect = generated.rect
      return {covers: rect.x <= left + 1e-6 && rect.y <= top + 1e-6 && rect.x + rect.width >= right - 1e-6 && rect.y + rect.height >= bottom - 1e-6, ratio: generated.evidence!.ratio, aspect: rect.width / rect.height}
    })
    assert.equal(spanned.covers, true)
    const [w, h] = spanned.ratio.split(':').map(Number); assert.ok(Math.abs(spanned.aspect - w / h) < 1e-6)
    assert.equal(requests.at(-1)!.aspect_ratio, spanned.ratio)
    await page.mouse.move(5, 5)
    await page.click('[data-testid="frame-toggle"]')
    await page.waitForSelector('[data-testid="frame"]')
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.actions.fitFrameToContent(); h.actions.fitViewToFrame()})
  })

  await check('In-flight edits cannot mutate captured inputs, prompt or result placement', async () => {
    const frame = await page.evaluate(() => ({...globalThis.layerPaint!.editorStore.state.frame}))
    const layerCount = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length)
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({prompt: 'A localized detail repair'}))
    defer = true
    await page.click('[data-testid="generate"]')
    for (let i = 0; i < 200 && pending.length < 1; i++) await Bun.sleep(10)
    assert.equal(pending.length, 1)
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.editorStore.set({prompt: 'A different future request', frame: {...h.editorStore.state.frame, x: 999}})})
    await release()
    await page.waitForFunction(count => globalThis.layerPaint?.projectStore.state.layers.length === count + 1, {}, layerCount)
    const evidence = await page.evaluate(() => {const layer = globalThis.layerPaint!.projectStore.state.layers.at(-1)!; return {rect: layer.rect, frame: layer.evidence!.frame, prompt: layer.evidence!.prompt, canvas: layer.evidence!.canvasAssetId, output: layer.evidence!.outputAssetId}})
    assert.deepEqual(evidence.rect, frame); assert.deepEqual(evidence.frame, frame); assert.equal(evidence.prompt, 'A localized detail repair'); assert.ok(evidence.canvas && evidence.canvas !== evidence.output)
  })

  await check('Reroll resends the captured inputs with the current model and adds a revision', async () => {
    const original = await page.evaluate(() => {const layer = globalThis.layerPaint!.projectStore.state.layers.at(-1)!; return {id: layer.id, assetId: layer.assetId, compiled: layer.evidence!.compiledPrompt, count: globalThis.layerPaint!.projectStore.state.layers.length}})
    const firstRequest = requests.at(-1)!
    await page.select('[data-testid="model-select"]', 'x-ai/grok-imagine-image-2.0')
    // The prompt changes in the meantime, but a reroll repeats the captured request.
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({prompt: 'Something else entirely'}))
    const count = requests.length
    await page.click('[title="Select A localized detail repair"]', {button: 'right'})
    await page.waitForSelector('[role="menu"]')
    await button('Reroll')
    await page.waitForFunction(id => (globalThis.layerPaint!.projectStore.state.layers.find(layer => layer.id === id)?.revisions?.length ?? 0) === 2, {}, original.id)
    assert.equal(requests.length, count + 1)
    const rerolled = requests.at(-1)!
    assert.equal(rerolled.model, 'x-ai/grok-imagine-image-2.0')
    assert.equal(rerolled.prompt, original.compiled)
    assert.deepEqual(rerolled.input_references.map(item => item.image_url.url), firstRequest.input_references.map(item => item.image_url.url), 'A reroll sends the very same input images')
    const state = await page.evaluate(id => {const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.find(item => item.id === id)!; return {count: h.projectStore.state.layers.length, assetId: layer.assetId, model: layer.evidence!.modelId, revision: layer.revision}}, original.id)
    assert.equal(state.count, original.count, 'A reroll adds no layer'); assert.notEqual(state.assetId, original.assetId); assert.equal(state.model, 'x-ai/grok-imagine-image-2.0'); assert.equal(state.revision, 1)
    const selector = () => page.$eval('[data-testid="revision-selector"]', node => node.textContent?.replaceAll(/[◂▸]/g, ''))
    assert.equal(await selector(), '2/2')
    await page.click('[aria-label="Show the previous revision of A localized detail repair"]')
    assert.equal(await selector(), '1/2')
    assert.equal(await page.evaluate(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.assetId, original.id), original.assetId)
    await page.select('[data-testid="model-select"]', 'google/gemini-nano-banana-2.1')
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({prompt: 'A localized detail repair'}))
  })

  await check('Hovering a collection item shows a rich tooltip, unrolls cropped pictures and points out every use', async () => {
    // The revision that is not shown right now is buried in the revision selector.
    const buried = await page.evaluate(() => {const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.at(-1)!, assetId = layer.revisions!.find(item => item.assetId !== layer.assetId)!.assetId; return h.projectStore.state.ingredients.find(item => item.assetId === assetId)!.index})
    await page.evaluate(index => globalThis.layerPaint!.editorStore.set({prompt: `Use ![${index}] here`}), buried)
    await page.hover(`[data-testid="ingredient"][data-index="${buried}"]`)
    await page.waitForSelector('[data-testid="revision-selector"][data-highlighted]')
    await page.waitForSelector('[data-testid="occurrence"]')
    const highlighted = await page.evaluate(index => [...document.querySelectorAll<HTMLElement>('.monaco-editor .view-lines span')].some(node => Boolean(node.textContent) && `![${index}]`.includes(node.textContent!) && getComputedStyle(node).outlineStyle === 'solid'), buried)
    assert.ok(highlighted, 'The reference in the prompt lights up')
    await page.waitForSelector(`[data-testid="ingredient"][data-index="${buried}"] [role="tooltip"]:popover-open`, {timeout: 3000})
    const [tile, tooltip] = await page.$$eval(`[data-testid="ingredient"][data-index="${buried}"], [data-testid="ingredient"][data-index="${buried}"] [role="tooltip"]`, nodes => nodes.map(node => node.getBoundingClientRect().toJSON() as DOMRect))
    assert.ok(tooltip.bottom <= tile.top + 1 || tooltip.top >= tile.bottom - 1, 'The tooltip keeps clear of the tile')
    assert.equal(await page.$eval(`[data-testid="ingredient"][data-index="${buried}"] button`, node => node.hasAttribute('title')), false)
    await page.mouse.move(5, 5)
    await page.waitForFunction(() => !document.querySelector('[data-testid="occurrence"]') && !document.querySelector('[data-highlighted]'))
    // A wide picture is cropped in its tile and unrolls in place.
    const wide = await page.evaluate(async () => {
      const h = globalThis.layerPaint!, canvas = new OffscreenCanvas(600, 100), context = canvas.getContext('2d')!
      context.fillStyle = '#3a6'; context.fillRect(0, 0, 600, 100); context.fillStyle = '#e33'; context.fillRect(0, 0, 60, 100)
      const [ingredient] = await h.actions.addIngredients([new File([await canvas.convertToBlob({type: 'image/png'})], 'wide.png', {type: 'image/png'})])
      return ingredient.index
    })
    const wideTile = `[data-testid="ingredient"][data-index="${wide}"]`
    assert.equal(await page.$eval(wideTile, node => (node as HTMLElement).dataset.crop), 'horizontal')
    await page.hover(wideTile)
    await page.waitForSelector(`${wideTile} [data-testid="unrolled"]:popover-open`)
    const unrolled = await page.$eval(`${wideTile} [data-testid="unrolled"]`, node => node.getBoundingClientRect().toJSON() as DOMRect)
    const wideBounds = await page.$eval(wideTile, node => node.getBoundingClientRect().toJSON() as DOMRect)
    assert.ok(Math.abs(unrolled.width / unrolled.height - 6) < 0.05, `The unrolled picture is complete: ${unrolled.width} × ${unrolled.height}`)
    assert.ok(Math.abs(unrolled.height - wideBounds.height) < 1 && unrolled.width > wideBounds.width)
    await page.mouse.move(5, 5)
    await page.waitForFunction(selector => !document.querySelector(`${selector} [data-testid="unrolled"]:popover-open`), {}, wideTile)
    // Delete lives in the context menu now.
    await page.click(`${wideTile} button`, {button: 'right'})
    await page.waitForSelector('[role="menu"][aria-label="Collection context menu"]')
    await button('Delete')
    await page.waitForFunction(selector => !document.querySelector(selector), {}, wideTile)
    assert.equal(await page.evaluate(() => globalThis.layerPaint!.editorStore.state.hoveredCollectionIndex), null)
    await page.evaluate(() => globalThis.layerPaint!.editorStore.set({prompt: 'A localized detail repair'}))
  })

  await check('Layer opacity is an image control and renders translucently; hiding moved into the context menu', async () => {
    const id = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.at(-1)!.id)
    assert.equal(await page.$('[aria-label="Hide layer"]'), null, 'Visible layers have no eye button')
    await page.click('[title="Select A localized detail repair"]')
    const slider = (await page.waitForSelector('[data-testid="opacity"]'))!
    await slider.evaluate(node => {const input = node as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '50'); input.dispatchEvent(new Event('input', {bubbles: true}))})
    await page.waitForFunction(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.opacity === 0.5, {}, id)
    const alpha = await page.evaluate(id => {
      const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.find(item => item.id === id)!
      const {canvas} = h.renderRegion({layers: [layer], region: layer.rect, size: {width: 8, height: 8}, measureEmpty: false})
      return canvas.getContext('2d')!.getImageData(4, 4, 1, 1).data[3]
    }, id)
    assert.ok(Math.abs(alpha - 128) <= 2, `alpha ${alpha}`)
    await page.evaluate(id => globalThis.layerPaint!.actions.updateLayer(id, {opacity: 1}), id)
    await page.click('[title="Select A localized detail repair"]', {button: 'right'})
    await page.waitForSelector('[role="menu"]')
    await button('Hide layer')
    await page.waitForSelector('[aria-label="Show layer"]')
    await page.click('[aria-label="Show layer"]')
    await page.waitForFunction(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.visible, {}, id)
    assert.equal(await page.$('[aria-label="Show layer"]'), null)
    await page.evaluate(() => {globalThis.layerPaint!.actions.selectLayer(null); globalThis.layerPaint!.editorStore.set({tool: 'frame'})})
  })

  await check('Content-aware alignment is analyzed once and then toggles instantly', async () => {
    assert.equal(await page.$('details'), null, 'The prompt panel options menu is gone')
    const id = await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.at(-1)!.id)
    await page.click('[title="Select A localized detail repair"]')
    const toggle = await page.waitForSelector('[data-testid="content-aware"]:not(:disabled)')
    const start = performance.now()
    await toggle!.click()
    await page.waitForFunction(id => {const layer = globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!; return layer.contentAware === true && Boolean(layer.alignment)}, {timeout: 30000}, id)
    console.log(`  first analysis took ${Math.round(performance.now() - start)} ms`)
    const toggles = await page.evaluate(async id => {
      const h = globalThis.layerPaint!, results: Array<{checked: boolean; enabled: boolean | undefined; ms: number}> = []
      for (let index = 0; index < 4; index++) {
        const input = document.querySelector<HTMLInputElement>('[data-testid="content-aware"]')!
        const begin = performance.now(); input.click()
        results.push({ms: performance.now() - begin, enabled: h.projectStore.state.layers.find(item => item.id === id)!.contentAware, checked: false})
        await new Promise(resolve => requestAnimationFrame(resolve))
        results.at(-1)!.checked = document.querySelector<HTMLInputElement>('[data-testid="content-aware"]')!.checked
      }
      return results
    }, id)
    // Cached toggles update the document synchronously, without another worker round trip.
    assert.deepEqual(toggles.map(item => item.enabled), [false, true, false, true])
    assert.deepEqual(toggles.map(item => item.checked), [false, true, false, true])
    assert.ok(toggles.every(item => item.ms < 100), JSON.stringify(toggles))
    await page.click('[data-testid="content-aware"]')
    assert.equal(await page.evaluate(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.contentAware, id), false)
  })

  await check('Adjustment sliders edit the selected layer and render like the reference color math', async () => {
    const id = await page.evaluate(() => globalThis.layerPaint!.editorStore.state.selectedLayerId!)
    assert.deepEqual(await page.$$eval('[data-testid="adjustments"] [data-adjustment]', nodes => nodes.map(node => (node as HTMLElement).dataset.adjustment)), ['brightness', 'contrast', 'gamma', 'saturation', 'vibrance', 'temperature'])
    await page.focus('[data-adjustment="saturation"]')
    for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight')
    assert.deepEqual(await page.evaluate(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.adjustments, id), {saturation: 0.1})
    await button('Reset adjustments')
    assert.equal(await page.evaluate(id => globalThis.layerPaint!.projectStore.state.layers.find(item => item.id === id)!.adjustments, id), undefined)
    const adjustments = {brightness: 0.15, contrast: 0.3, gamma: -0.2, saturation: 0.4, vibrance: 0.5, temperature: -0.35}
    const sample = await page.evaluate(async adjustments => {
      const h = globalThis.layerPaint!, side = 48
      const source = new OffscreenCanvas(side, side), context = source.getContext('2d')!
      const hue = context.createLinearGradient(0, 0, side, 0)
      for (let stop = 0; stop <= 6; stop++) hue.addColorStop(stop / 6, `hsl(${stop * 60} 80% 50%)`)
      context.fillStyle = hue; context.fillRect(0, 0, side, side)
      const shade = context.createLinearGradient(0, 0, 0, side - 8)
      shade.addColorStop(0, 'rgb(255 255 255 / 70%)'); shade.addColorStop(0.5, 'transparent'); shade.addColorStop(1, 'rgb(0 0 0 / 70%)')
      context.fillStyle = shade; context.fillRect(0, 0, side, side)
      context.clearRect(0, side - 8, side, 8)
      // semi-transparent rows catch premultiplied-alpha mistakes
      context.fillStyle = 'rgb(200 90 50 / 40%)'; context.fillRect(0, side - 8, side / 2, 4)
      context.fillStyle = 'rgb(40 120 220 / 75%)'; context.fillRect(side / 2, side - 8, side / 2, 4)
      const asset = await h.assets.add(await source.convertToBlob({type: 'image/png'}))
      const layer = {id: 'adjusted', assetId: asset.id, name: 'Adjusted', kind: 'import' as const, createdAt: 0, visible: true, area: 1, feather: 0, rect: {x: 0, y: 0, width: side, height: side}}
      const read = (layerAdjustments?: typeof adjustments) => [...h.renderRegion({layers: [{...layer, adjustments: layerAdjustments}], region: layer.rect, size: {width: side, height: side}, measureEmpty: false}).canvas.getContext('2d')!.getImageData(0, 0, side, side).data]
      return {source: read(), adjusted: read(adjustments), webgl: new OffscreenCanvas(1, 1).getContext('webgl2') !== null}
    }, adjustments)
    const parameters = getAdjustmentParameters(adjustments)
    let maxDifference = 0, changed = 0
    for (let index = 0; index < sample.source.length; index += 4) {
      if (sample.source[index + 3] === 0) {
        assert.equal(sample.adjusted[index + 3], 0, 'Transparent pixels stay transparent'); continue
      }
      const expected = adjustColor([sample.source[index] / 255, sample.source[index + 1] / 255, sample.source[index + 2] / 255], parameters).map(value => Math.round(value * 255))
      assert.equal(sample.adjusted[index + 3], sample.source[index + 3], 'Adjustments keep alpha')
      // Premultiplied storage quantizes translucent colors more coarsely.
      const tolerance = 255 / sample.source[index + 3] - 1
      for (let channel = 0; channel < 3; channel++) {
        maxDifference = Math.max(maxDifference, Math.abs(expected[channel] - sample.adjusted[index + channel]) - tolerance)
        changed += sample.source[index + channel] === sample.adjusted[index + channel] ? 0 : 1
      }
    }
    console.log(`  ${sample.webgl ? 'WebGL 2' : 'CPU fallback'} · max channel deviation beyond alpha quantization ${maxDifference.toFixed(2)}`)
    assert.ok(changed > sample.source.length / 4, 'Adjustments must visibly change the pixels')
    assert.ok(maxDifference <= 2, `Rendered adjustments deviate from the reference by ${maxDifference}`)
    await page.evaluate(() => {const h = globalThis.layerPaint!; h.actions.selectLayer(null); h.editorStore.set({hoveredLayerId: null})})
  })

  await check('The mask thumbnail enters mask mode, hides the frame and exposes contracted/feather bounds', async () => {
    const defaults = await page.evaluate(() => {const h = globalThis.layerPaint!, layer = h.projectStore.state.layers.at(-1)!; return {area: layer.area, feather: layer.feather, selected: h.editorStore.state.selectedLayerId === layer.id}})
    assert.deepEqual(defaults, {area: 1, feather: 0, selected: false}, 'Generated layers default to a 100% area, unfeathered mask and are not auto-selected')
    assert.equal(await page.$$eval('[data-testid="mask-thumbnail"]', nodes => nodes.length), await page.evaluate(() => globalThis.layerPaint!.projectStore.state.layers.length - 1), 'Every non-base layer has a mask thumbnail')
    await page.click('[aria-label="Edit the mask of A localized detail repair"]')
    assert.equal(await page.evaluate(() => {const h = globalThis.layerPaint!; return h.editorStore.state.tool === 'mask' && h.editorStore.state.selectedLayerId === h.projectStore.state.layers.at(-1)!.id}), true)
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

  await check('?feather_method selects the feather; smooth hides where the artwork below ends', async () => {
    const measureSeam = async (method?: string) => {
      const target = await browser.newPage()
      await wire(target)
      await target.goto(`${appOrigin}/?debug=true${method ? `&feather_method=${method}` : ''}`, {waitUntil: 'networkidle0'})
      await target.waitForFunction(() => Boolean(globalThis.layerPaint?.persistenceStore.state.hydrated), {timeout: 30000})
      const result = await target.evaluate(async () => {
        const h = globalThis.layerPaint!
        const make = async (color: string) => {const c = new OffscreenCanvas(64, 64); const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 64); return h.assets.add(await c.convertToBlob({type: 'image/png'}))}
        const blue = await make('#0000ff'), red = await make('#ff0000')
        const base = {id: 'seam-base', assetId: blue.id, name: 'Blue', kind: 'import' as const, createdAt: 0, visible: true, area: 1, feather: 0, rect: {x: 0, y: 0, width: 300, height: 300}}
        // an outpainting that overlaps the corner of the base: the base’s right and bottom edges run through its feather band
        const edit = {...base, id: 'seam-edit', assetId: red.id, kind: 'generated' as const, feather: 0.6, rect: {x: 150, y: 120, width: 300, height: 300}}
        const {canvas} = h.renderRegion({layers: [base, edit], region: {x: 0, y: 0, width: 450, height: 420}, size: {width: 450, height: 420}, measureEmpty: false})
        const {data} = canvas.getContext('2d')!.getImageData(0, 0, 450, 420)
        const red8 = (x: number, y: number) => data[(y * 450 + x) * 4]
        let seam = 0
        for (let y = 125; y < 290; y++) seam = Math.max(seam, Math.abs(red8(299, y) - red8(300, y)))
        for (let x = 155; x < 290; x++) seam = Math.max(seam, Math.abs(red8(x, 299) - red8(x, 300)))
        return {seam, blendedEdge: red8(160, 200), exposed: [...data.subarray((410 * 450 + 440) * 4, (410 * 450 + 440) * 4 + 4)]}
      })
      await target.close()
      return result
    }
    const smooth = await measureSeam(), distance = await measureSeam('distance')
    console.log(`  largest step across the underlying edge · smooth ${smooth.seam} · distance ${distance.seam}`)
    assert.ok(distance.seam > 200, 'The original method shows the underlying edge as a hard line.')
    assert.ok(smooth.seam < 24, 'The smooth method must not show the underlying edge as a hard line.')
    for (const result of [smooth, distance]) {
      assert.ok(result.blendedEdge < 30, 'The layer edge over artwork stays blended.')
      assert.deepEqual(result.exposed, [255, 0, 0, 255])
    }
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
