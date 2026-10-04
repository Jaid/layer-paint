import {expect, test} from 'bun:test'

const {default: layerPaint} = await import('#src/main.ts')
test('should run', () => {
  const result = layerPaint()
  expect(result).toBe('layer-paint') // TODO Test actual functionality
})
