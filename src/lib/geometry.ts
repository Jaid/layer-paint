export type Point = {
  x: number
  y: number
}

export type Size = {
  height: number
  width: number
}

export type Rect = Point & Size

export const rectCenter = (rect: Rect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
})

export const rectFromCenter = (center: Point, size: Size): Rect => ({
  x: center.x - size.width / 2,
  y: center.y - size.height / 2,
  width: size.width,
  height: size.height,
})

export const rectContains = (rect: Rect, point: Point) => point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height

export const rectIntersection = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) {
    return null
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

export const rectUnion = (rects: Iterable<Rect>): Rect | null => {
  let result: Rect | null = null
  for (const rect of rects) {
    if (!result) {
      result = {...rect}
      continue
    }
    const x = Math.min(result.x, rect.x)
    const y = Math.min(result.y, rect.y)
    const right = Math.max(result.x + result.width, rect.x + rect.width)
    const bottom = Math.max(result.y + result.height, rect.y + rect.height)
    result = {
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  }
  return result
}

export const roundRect = (rect: Rect): Rect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
})

export const rectsEqual = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** Smallest rect with the given aspect ratio (width / height) that fully covers the target, sharing its center. */
export const coverRect = (target: Rect, aspect: number): Rect => {
  const targetAspect = target.width / target.height
  const size = targetAspect > aspect ? {
    width: target.width,
    height: target.width / aspect,
  } : {
    width: target.height * aspect,
    height: target.height,
  }
  return rectFromCenter(rectCenter(target), size)
}

/** Largest size with the given aspect ratio that fits inside the bounds. */
export const containSize = (bounds: Size, aspect: number): Size => {
  if (bounds.width / bounds.height > aspect) {
    return {
      width: bounds.height * aspect,
      height: bounds.height,
    }
  }
  return {
    width: bounds.width,
    height: bounds.width / aspect,
  }
}

/** Size with the given aspect ratio and (approximately) the given area. */
export const sizeFromArea = (area: number, aspect: number): Size => {
  const height = Math.sqrt(area / aspect)
  return {
    width: height * aspect,
    height,
  }
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
