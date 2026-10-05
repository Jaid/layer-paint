import type {Size} from './geometry.ts'

export type DecodedImage = Size & {
  bitmap: ImageBitmap
}

export type ExportFormat = 'jpeg' | 'png' | 'webp'

/** formats every supported upstream endpoint accepts as input reference */
export const upstreamMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** formats that browsers display natively and that are kept unchanged when imported as layers */
const retainedMediaTypes = upstreamMediaTypes

const extensionMediaTypes: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/x-icon',
  jfif: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  jxl: 'image/jxl',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

/** Some platforms report an empty MIME type for newer formats like JXL, so the extension serves as fallback. */
export const getMediaType = (file: Blob & {name?: string}) => {
  if (file.type) {
    return file.type
  }
  const extension = file.name?.split('.').at(-1)?.toLowerCase()
  return extension ? extensionMediaTypes[extension] ?? '' : ''
}

export const looksLikeImage = (file: Blob & {name?: string}) => getMediaType(file).startsWith('image/')

const fallbackVectorSize = 1024

const decodeWithElement = async (blob: Blob): Promise<DecodedImage> => {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image
    image.decoding = 'async'
    image.src = url
    await image.decode()
    let width = image.naturalWidth
    let height = image.naturalHeight
    if (!width || !height) {
      width = fallbackVectorSize
      height = fallbackVectorSize
    }
    const longSide = Math.max(width, height)
    // Vector graphics often declare tiny intrinsic sizes, so they get rasterized at a useful resolution.
    if (blob.type === 'image/svg+xml' && longSide < fallbackVectorSize) {
      const scale = fallbackVectorSize / longSide
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const bitmap = await createImageBitmap(image, {resizeWidth: width, resizeHeight: height, resizeQuality: 'high'})
    validateDimensions(bitmap.width, bitmap.height)
    return {bitmap, width: bitmap.width, height: bitmap.height}
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const decodeImage = async (blob: Blob): Promise<DecodedImage> => {
  if (blob.size > 40_000_000) throw new Error('Choose a source image smaller than 40 mb.')
  if (blob.type === 'image/jxl') {
    const image = await decodeJxl(await blob.arrayBuffer())
    validateDimensions(image.width, image.height)
    const canvas = createCanvas(image.width, image.height)
    getContext(canvas).putImageData(new ImageData(new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength), image.width, image.height), 0, 0)
    const bitmap = await createImageBitmap(canvas)
    return {bitmap, width: bitmap.width, height: bitmap.height}
  }
  if (blob.type !== 'image/svg+xml') {
    try {
      const bitmap = await createImageBitmap(blob)
      try {validateDimensions(bitmap.width, bitmap.height)} catch (error) {bitmap.close(); throw error}
      return {bitmap, width: bitmap.width, height: bitmap.height}
    } catch {}
  }
  try {
    return await decodeWithElement(blob)
  } catch {
    throw new Error(`This browser cannot decode ${blob.type || 'this file type'}`)
  }
}

export const MAX_EDGE = 16384
export const MAX_PIXELS = 64_000_000
export function validateDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('This image exceeds the 64-megapixel or 16,384-pixel edge limit. Choose a smaller export scale or frame.')
}
export const createCanvas = (width: number, height: number) => {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height))
  validateDimensions(width, height)
  return new OffscreenCanvas(width, height)
}

export const getContext = (canvas: OffscreenCanvas) => {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas context is unavailable')
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

export const encodeCanvas = (canvas: OffscreenCanvas, format: ExportFormat = 'png', quality?: number) => canvas.convertToBlob({type: `image/${format}`, quality})

export const fitWithin = (size: Size, maxSide: number): Size => {
  const longSide = Math.max(size.width, size.height)
  if (longSide <= maxSide) {
    return {width: size.width, height: size.height}
  }
  const scale = maxSide / longSide
  return {width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale))}
}

export const drawScaled = (bitmap: ImageBitmap, size: Size, background?: string) => {
  const canvas = createCanvas(size.width, size.height)
  const context = getContext(canvas)
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Normalizes an imported file into a blob that is safe to store and display as a layer. */
export const normalizeImportedImage = async (file: Blob & {name?: string}) => {
  const mediaType = getMediaType(file)
  const typed = file.type === mediaType ? file : new Blob([file], {type: mediaType})
  const decoded = await decodeImage(typed)
  if (retainedMediaTypes.has(mediaType)) {
    return {blob: typed, decoded}
  }
  try {
    const blob = await encodeCanvas(drawScaled(decoded.bitmap, decoded), 'webp', 1)
    return {blob, decoded: await decodeImage(blob)}
  } finally {decoded.bitmap.close()}
}

export const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader
  reader.addEventListener('load', () => resolve(reader.result as string))
  reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read blob')))
  reader.readAsDataURL(blob)
})

export const maxUpstreamSide = 2048
const maxUpstreamBytes = 4_000_000

/**
 * Prepares an image for an upstream image endpoint.
 * Formats the endpoints do not accept (SVG, JXL, AVIF, …) and oversized images are converted to WebP on the fly.
 */
export const prepareUpstreamImage = async (blob: Blob, decoded?: DecodedImage): Promise<{
  blob: Blob
  dataUrl: string
}> => {
  const image = decoded ?? await decodeImage(blob)
  const isAccepted = upstreamMediaTypes.has(blob.type)
  const isSmallEnough = Math.max(image.width, image.height) <= maxUpstreamSide && blob.size <= maxUpstreamBytes
  if (isAccepted && isSmallEnough) {
    return {blob, dataUrl: await blobToDataUrl(blob)}
  }
  const converted = await encodeCanvas(drawScaled(image.bitmap, fitWithin(image, maxUpstreamSide)), 'webp', 0.94)
  return {blob: converted, dataUrl: await blobToDataUrl(converted)}
}

export const createThumbnailDataUrl = async (bitmap: ImageBitmap, maxSide = 192) => {
  const canvas = drawScaled(bitmap, fitWithin({width: bitmap.width, height: bitmap.height}, maxSide))
  return blobToDataUrl(await encodeCanvas(canvas, 'webp', 0.85))
}

export const base64ToBlob = (base64: string, mediaType: string) => {
  const bytes = Uint8Array.fromBase64(base64)
  return new Blob([bytes], {type: mediaType})
}

/** Sol's worker decoder, adapted to the shared immutable-asset pipeline. */
async function decodeJxl(buffer: ArrayBuffer): Promise<ImageData> {
  const worker = new Worker(new URL('./codecs/jxl.worker.ts', import.meta.url), {type: 'module'})
  try {
    return await new Promise<ImageData>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('JPEG XL decoding timed out.')), 30_000)
      worker.onmessage = (event: MessageEvent<{image?: ImageData; error?: string}>) => {
        clearTimeout(timeout)
        if (event.data.image) resolve(event.data.image)
        else reject(new Error(event.data.error ?? 'JPEG XL decoding failed.'))
      }
      worker.onerror = () => {clearTimeout(timeout); reject(new Error('The JPEG XL decoder could not start.'))}
      worker.postMessage(buffer, [buffer])
    })
  } finally {worker.terminate()}
}
