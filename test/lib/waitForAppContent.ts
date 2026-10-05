import type {Page} from 'puppeteer-core'

/** A layout-less wrapper (display: contents) is valid; wait for rendered app content. */
export const waitForAppContent = async (page: Page, timeout = 30_000) => {
  await page.waitForFunction(() => [...document.querySelectorAll('body > div *')].some(element => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  }), {timeout})
}
