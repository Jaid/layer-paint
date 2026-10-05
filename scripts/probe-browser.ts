import {mkdir} from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import {startServer} from './server.ts'
const browser = await puppeteer.launch({executablePath: 'C:/Program Files/Google/Chrome Dev/Application/chrome.exe', headless: true, args: ['--no-sandbox']})
const server = startServer({port: 0})
try {
  await mkdir('out/test/screenshots', {recursive: true})
  const page = await browser.newPage()
  await page.setViewport({width: 1600, height: 1000})
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  await page.goto(server.url.origin + '/?debug=true', {waitUntil: 'networkidle0'})
  await page.waitForSelector('.monaco-editor textarea', {timeout: 30000})
  await new Promise(resolve => setTimeout(resolve, 1000))
  console.log(JSON.stringify(await page.evaluate(() => ({url: location.href, browser: navigator.userAgent, text: document.body.innerText, frame: document.querySelector('[data-testid="frame"]')?.getBoundingClientRect().toJSON(), canvas: document.querySelector('[data-viewport]')?.getBoundingClientRect().toJSON(), panel: document.querySelector('[data-testid="layers-panel"]')?.getBoundingClientRect().toJSON(), theme: getComputedStyle(document.documentElement).color, debug: Boolean(globalThis.layerPaint)})), null, 2))
  console.log('ERRORS', JSON.stringify(errors))
  await page.screenshot({path: 'out/test/screenshots/initial-dark.png'})
} finally {await browser.close(); await server.stop(true)}
