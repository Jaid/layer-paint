/** narrowest collection thumbnail (width ÷ height); taller images are cropped to 2:3 */
export const minThumbnailAspect = 2 / 3
/** widest collection thumbnail (width ÷ height); wider images are cropped to 2:1 */
export const maxThumbnailAspect = 2
/** relative overshoot below which a crop is too small to be worth flagging */
const cropTolerance = 0.01

export type ThumbnailFit = {
  /** width ÷ height of the tile */
  aspect: number
  /** which axis is cut off: “vertical” loses top and bottom, “horizontal” loses left and right */
  crop?: 'horizontal' | 'vertical'
}

/** Collection tiles share one height, so only the width follows the image – clamped between 2:3 and 2:1. */
export const getThumbnailFit = (width: number, height: number): ThumbnailFit => {
  if (!(width > 0 && height > 0)) {
    return {aspect: 1}
  }
  const aspect = width / height
  if (aspect < minThumbnailAspect) {
    return aspect < minThumbnailAspect * (1 - cropTolerance) ? {
      aspect: minThumbnailAspect,
      crop: 'vertical',
    } : {aspect: minThumbnailAspect}
  }
  if (aspect > maxThumbnailAspect) {
    return aspect > maxThumbnailAspect * (1 + cropTolerance) ? {
      aspect: maxThumbnailAspect,
      crop: 'horizontal',
    } : {aspect: maxThumbnailAspect}
  }
  return {aspect}
}
