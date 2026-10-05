import decode from '@jsquash/jxl/decode.js'
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const image = await decode(event.data)
    self.postMessage({image}, {transfer: [image.data.buffer]})
  } catch {self.postMessage({error: 'JPEG XL decoding failed.'})}
}
