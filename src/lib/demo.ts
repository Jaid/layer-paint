import {createCanvas, encodeCanvas, getContext} from './image.ts'

/** Deliberately labeled procedural demo, never presented as an AI/provider response. */
export async function createDemoImage(prompt: string, aspect = 1, source?: OffscreenCanvas, signal?: AbortSignal): Promise<Blob> {
  const side = 1536
  const canvas = createCanvas(aspect >= 1 ? side : side * aspect, aspect >= 1 ? side / aspect : side)
  const ctx = getContext(canvas), w = canvas.width, h = canvas.height
  let seed = 2166136261
  for (const char of prompt) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  const random = () => {seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296}
  if (source) {
    ctx.filter = `hue-rotate(${Math.round(random() * 50 - 25)}deg) saturate(1.2)`
    ctx.drawImage(source, 0, 0, w, h)
    ctx.filter = 'none'
    const light = ctx.createRadialGradient(w * 0.55, h * 0.3, 0, w * 0.55, h * 0.3, Math.max(w, h) * 0.65)
    light.addColorStop(0, 'rgb(250 192 100 / 35%)'); light.addColorStop(1, 'transparent')
    ctx.fillStyle = light; ctx.fillRect(0, 0, w, h)
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#0d1634'); sky.addColorStop(0.48, '#403455'); sky.addColorStop(0.75, '#d68b78'); sky.addColorStop(1, '#f3c6a0')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 220; i++) {ctx.fillStyle = `rgb(255 244 218 / ${0.2 + random() * 0.75})`; ctx.beginPath(); ctx.arc(random() * w, random() * h * 0.6, 0.5 + random() * 1.4, 0, Math.PI * 2); ctx.fill()}
    const glow = ctx.createRadialGradient(w * 0.72, h * 0.3, 0, w * 0.72, h * 0.3, h * 0.3)
    glow.addColorStop(0, 'rgb(255 213 147 / 50%)'); glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#f6deb1'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.3, h * 0.058, 0, Math.PI * 2); ctx.fill()
    for (let ridge = 0; ridge < 4; ridge++) {
      ctx.beginPath(); ctx.moveTo(0, h)
      for (let x = 0; x <= 32; x++) ctx.lineTo(x / 32 * w, h * (0.53 + ridge * 0.115) - (Math.sin(x * 0.6 + ridge) * 0.055 + random() * 0.055) * h)
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = ['#746278', '#4c455f', '#2b304d', '#17233b'][ridge]; ctx.fill()
    }
    ctx.fillStyle = '#111c2d'; ctx.fillRect(w * 0.28, h * 0.61, w * 0.075, h * 0.09)
    ctx.beginPath(); ctx.arc(w * 0.3175, h * 0.615, w * 0.044, Math.PI, 0); ctx.fill()
    ctx.fillStyle = '#f8d391'; ctx.fillRect(w * 0.305, h * 0.66, w * 0.017, h * 0.024)
  }
  await new Promise<void>((resolve, reject) => {
    const done = () => {signal?.removeEventListener('abort', abort); resolve()}
    const timer = setTimeout(done, 250)
    const abort = () => {clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError'))}
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true})
  })
  return encodeCanvas(canvas, 'png')
}
