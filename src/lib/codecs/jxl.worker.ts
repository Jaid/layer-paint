import decode from '@jsquash/jxl/decode.js'

globalThis.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const image = await decode(event.data)
    globalThis.postMessage({image}, {transfer: [image.data.buffer]})
  } catch {
    globalThis.postMessage({error: 'JPEG XL decoding failed.'})
  }
}
