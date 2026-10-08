import type {AdjustmentParameters} from './color.ts'
import type {AdjustableSource, AdjustedImage} from './base/AdjustmentRenderer.ts'

import {AdjustmentRenderer} from './base/AdjustmentRenderer.ts'
import {lumaWeights} from './color.ts'

const vertexShader = `#version 300 es
out vec2 uv;
void main() {
  // one oversized triangle covers the viewport; the top of the canvas samples the first texture row
  vec2 position = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`

// Mirrors adjustColor() in color.ts.
const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec3 gains;
uniform float brightness;
uniform float exponent;
uniform float contrast;
uniform float saturation;
uniform float vibrance;
const vec3 luma = vec3(${lumaWeights.map(weight => weight.toFixed(4)).join(', ')});
in vec2 uv;
out vec4 color;
void main() {
  // The texture is premultiplied; the color math works on straight colors.
  vec4 texel = texture(source, uv);
  if (texel.a <= 0.0) {
    color = vec4(0.0);
    return;
  }
  vec3 rgb = clamp(texel.rgb / texel.a * gains * brightness, 0.0, 1.0);
  rgb = pow(rgb, vec3(exponent));
  rgb = clamp((rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
  rgb = clamp(mix(vec3(dot(rgb, luma)), rgb, saturation), 0.0, 1.0);
  float chroma = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = clamp(mix(vec3(dot(rgb, luma)), rgb, 1.0 + vibrance * (1.0 - chroma)), 0.0, 1.0);
  // The drawing buffer is premultiplied.
  color = vec4(rgb * texel.a, texel.a);
}`

type Gl = {
  canvas: OffscreenCanvas
  context: WebGL2RenderingContext
  maxSize: number
  uniforms: Record<'brightness' | 'contrast' | 'exponent' | 'gains' | 'saturation' | 'vibrance', WebGLUniformLocation | null>
}

const maxCachedTextures = 4

/** A 2D canvas honors the unpack flags, so every upload has a known (premultiplied) alpha state. */
const toCanvas = (source: AdjustableSource) => {
  if (source instanceof OffscreenCanvas) {
    return source
  }
  const canvas = new OffscreenCanvas(source.width, source.height)
  canvas.getContext('2d')!.drawImage(source, 0, 0)
  return canvas
}

/** Evaluates the adjustment shader on the GPU and hands the result back as an ImageBitmap without a readback. */
export class WebGlAdjustmentRenderer extends AdjustmentRenderer {
  id = 'webgl'
  #failed = false
  #gl: Gl | undefined
  readonly #textures = new Map<string, WebGLTexture>

  override forget(sourceKey: string) {
    const texture = this.#textures.get(sourceKey)
    if (texture) {
      this.#gl?.context.deleteTexture(texture)
      this.#textures.delete(sourceKey)
    }
  }

  render(source: AdjustableSource, parameters: AdjustmentParameters, sourceKey: string): AdjustedImage | undefined {
    const gl = this.#getGl()
    if (!gl || source.width > gl.maxSize || source.height > gl.maxSize) {
      return
    }
    const {context, canvas, uniforms} = gl
    const texture = this.#getTexture(gl, source, sourceKey)
    if (!texture) {
      return
    }
    canvas.width = source.width
    canvas.height = source.height
    context.viewport(0, 0, source.width, source.height)
    context.bindTexture(context.TEXTURE_2D, texture)
    context.uniform3f(uniforms.gains, ...parameters.gains)
    context.uniform1f(uniforms.brightness, parameters.brightness)
    context.uniform1f(uniforms.exponent, parameters.exponent)
    context.uniform1f(uniforms.contrast, parameters.contrast)
    context.uniform1f(uniforms.saturation, parameters.saturation)
    context.uniform1f(uniforms.vibrance, parameters.vibrance)
    context.clearColor(0, 0, 0, 0)
    context.clear(context.COLOR_BUFFER_BIT)
    context.drawArrays(context.TRIANGLES, 0, 3)
    if (context.isContextLost()) {
      this.#reset()
      return
    }
    return canvas.transferToImageBitmap()
  }

  #getGl(): Gl | undefined {
    if (this.#gl && !this.#gl.context.isContextLost()) {
      return this.#gl
    }
    if (this.#gl) {
      this.#reset()
    }
    if (this.#failed || typeof OffscreenCanvas === 'undefined') {
      return
    }
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })
    if (!context) {
      this.#failed = true
      return
    }
    const compile = (type: number, sourceCode: string) => {
      const shader = context.createShader(type)!
      context.shaderSource(shader, sourceCode)
      context.compileShader(shader)
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
        throw new Error(`Adjustment shader failed: ${context.getShaderInfoLog(shader)}`)
      }
      return shader
    }
    try {
      const program = context.createProgram()
      context.attachShader(program, compile(context.VERTEX_SHADER, vertexShader))
      context.attachShader(program, compile(context.FRAGMENT_SHADER, fragmentShader))
      context.linkProgram(program)
      if (!context.getProgramParameter(program, context.LINK_STATUS)) {
        throw new Error(`Adjustment program failed: ${context.getProgramInfoLog(program)}`)
      }
      context.useProgram(program)
      context.bindVertexArray(context.createVertexArray())
      context.uniform1i(context.getUniformLocation(program, 'source'), 0)
      context.activeTexture(context.TEXTURE0)
      // ImageBitmaps ignore unpack flags and keep the alpha state they were created with, so they are routed through a 2D canvas first.
      context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false)
      context.pixelStorei(context.UNPACK_COLORSPACE_CONVERSION_WEBGL, context.NONE)
      const uniform = (name: string) => context.getUniformLocation(program, name)
      this.#gl = {
        canvas,
        context,
        maxSize: context.getParameter(context.MAX_TEXTURE_SIZE) as number,
        uniforms: {
          gains: uniform('gains'),
          brightness: uniform('brightness'),
          exponent: uniform('exponent'),
          contrast: uniform('contrast'),
          saturation: uniform('saturation'),
          vibrance: uniform('vibrance'),
        },
      }
      return this.#gl
    } catch (error) {
      console.warn(error)
      this.#failed = true
    }
  }

  #getTexture(gl: Gl, source: AdjustableSource, sourceKey: string) {
    const {context} = gl
    const cached = this.#textures.get(sourceKey)
    if (cached) {
      // refresh the LRU position
      this.#textures.delete(sourceKey)
      this.#textures.set(sourceKey, cached)
      return cached
    }
    const texture = context.createTexture()
    context.bindTexture(context.TEXTURE_2D, texture)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE)
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE)
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, context.RGBA, context.UNSIGNED_BYTE, toCanvas(source))
    if (context.getError() !== context.NO_ERROR) {
      context.deleteTexture(texture)
      return
    }
    this.#textures.set(sourceKey, texture)
    while (this.#textures.size > maxCachedTextures) {
      this.forget(this.#textures.keys().next().value!)
    }
    return texture
  }

  #reset() {
    this.#textures.clear()
    this.#gl = undefined
  }
}
