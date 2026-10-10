import type {Rect, Size} from './geometry.ts'

/** clockwise rotations in degrees; 270 is a quarter turn counterclockwise */
export const rotations = [0, 90, 270, 180] as const
export type Rotation = typeof rotations[number]

/** Mirroring both ways is left out because it is the same as a half turn. */
export const flips = ['none', 'horizontal', 'vertical'] as const
export type Flip = typeof flips[number]

/**
 * how a collection image is shown relative to its original pixels
 *
 * The image is rotated first and then mirrored along the axes of the rotated result, so “horizontal” always mirrors what is seen left to right.
 */
export type Orientation = {
  flip: Flip
  rotation: Rotation
}

export const identityOrientation: Orientation = {
  rotation: 0,
  flip: 'none',
}

export const rotationTitles: Record<Rotation, string> = {
  0: '0°',
  90: '90° clockwise',
  270: '90° counterclockwise',
  180: '180°',
}

export const flipTitles: Record<Flip, string> = {
  none: 'None',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
}

export const isRotation = (value: unknown): value is Rotation => rotations.includes(value as Rotation)
export const isFlip = (value: unknown): value is Flip => flips.includes(value as Flip)

/**
 * The orientation as one of the eight symmetries of a rectangle: the original is mirrored left to right first if `mirrored`, then turned clockwise by `turns` quarter turns.
 *
 * Several orientations describe the same pixels, for example 90° clockwise with a horizontal flip equals 90° counterclockwise with a vertical flip.
 */
export type Symmetry = {
  mirrored: boolean
  /** clockwise quarter turns, 0–3 */
  turns: 0 | 1 | 2 | 3
}

const quarterTurns = (turns: number) => ((turns % 4 + 4) % 4) as Symmetry['turns']

export const getSymmetry = ({rotation, flip}: Orientation): Symmetry => {
  const turns = rotation / 90
  // A mirror after a turn equals the opposite turn after the mirror; a vertical mirror is a horizontal one plus a half turn.
  switch (flip) {
    case 'none': {
      return {
        turns: quarterTurns(turns),
        mirrored: false,
      }
    }
    case 'horizontal': {
      return {
        turns: quarterTurns(-turns),
        mirrored: true,
      }
    }
    case 'vertical': {
      return {
        turns: quarterTurns(2 - turns),
        mirrored: true,
      }
    }
  }
}

export const isIdentitySymmetry = (symmetry: Symmetry) => symmetry.turns === 0 && !symmetry.mirrored

/** whether the orientation turns width into height */
export const swapsAxes = (orientation: Orientation) => getSymmetry(orientation).turns % 2 === 1

export const isSameOrientation = (a: Orientation, b: Orientation) => a.rotation === b.rotation && a.flip === b.flip

export type PixelTransform = Size & {
  /** canvas transform from source pixels to oriented pixels as [a, b, c, d, e, f], with exact integers only */
  matrix: [number, number, number, number, number, number]
}

const turnMatrices: Record<Symmetry['turns'], [number, number, number, number]> = {
  0: [1, 0, 0, 1],
  1: [0, 1, -1, 0],
  2: [-1, 0, 0, -1],
  3: [0, -1, 1, 0],
}

/** the size of the oriented image and the transform that draws the original into it pixel-exactly */
export const getPixelTransform = (size: Size, symmetry: Symmetry): PixelTransform => {
  const [ra, rb, rc, rd] = turnMatrices[symmetry.turns]
  const sx = symmetry.mirrored ? -1 : 1
  // rotate ∘ mirror, so mirroring happens first
  const a = ra * sx
  const b = rb * sx
  const c = rc
  const d = rd
  const swap = symmetry.turns % 2 === 1
  const width = swap ? size.height : size.width
  const height = swap ? size.width : size.height
  // The source center lands on the target center: e = width/2 − (a·w/2 + c·h/2), which is always an integer.
  return {
    width,
    height,
    matrix: [a, b, c, d, (width - a * size.width - c * size.height) / 2, (height - b * size.width - d * size.height) / 2],
  }
}

/** the rect turned by a quarter turn around its center */
export const swapRectAxes = (rect: Rect): Rect => ({
  x: rect.x + (rect.width - rect.height) / 2,
  y: rect.y + (rect.height - rect.width) / 2,
  width: rect.height,
  height: rect.width,
})
