// How far something follows a pull past its end:
//
//                    offset = (1 - 1 / (c*x / d + 1)) * d
//
//   x  how far the finger has pulled past the end (px)
//   d  the dimension the band is measured against: the screen's height for a page, the
//      tray being pulled open for a swiped row
//   c  how readily it follows at first (0.55, same as UIScrollView)
//
// It starts out following the finger at a rate of c, and follows less the further it goes, so
// each extra pixel of pull buys less movement than the one before. It also has a ceiling. As x
// grows the offset approaches d without ever reaching it, so a pull past the end always moves a
// little, never hits a wall, and never runs away. Algebraically it's the same as
// c*x*d / (d + c*x), which is how UIKit's band is usually written.
//
// Page overscroll, swipeable rows and pinch-zoom limits all share this one definition, so "past
// the end" feels the same everywhere in the app.

/** UIScrollView's constant: how much of the first pixel past the end moves. */
export const RUBBER_BAND_CONSTANT = 0.55

/**
 * The offset that a pull of `pull` px past the end produces, measured against `dimension`.
 * Zero for no pull, or a pull back inside the end.
 */
export function rubberBand(pull: number, dimension: number, constant = RUBBER_BAND_CONSTANT): number {
  if (pull <= 0 || dimension <= 0) return 0
  return (1 - 1 / ((constant * pull) / dimension + 1)) * dimension
}

/** Same thing for a pull in either direction, keeping the sign. */
export function rubberBandSigned(pull: number, dimension: number, constant = RUBBER_BAND_CONSTANT): number {
  return Math.sign(pull) * rubberBand(Math.abs(pull), dimension, constant)
}

/**
 * The pull that produces a given offset, or the band run backwards. This lets a finger catch
 * something still springing back and carry on from where it's visible, rather than from where
 * the finger happens to be.
 *
 * Offsets at or past the ceiling have no finite pull, so they're held just inside it.
 */
export function rubberBandInverse(offset: number, dimension: number, constant = RUBBER_BAND_CONSTANT): number {
  if (offset <= 0 || dimension <= 0) return 0
  const held = Math.min(offset, dimension * 0.999)
  return (held * dimension) / (constant * (dimension - held))
}

/**
 * Keeps `value` in [min, max] the soft way: free inside the range, the band past either end.
 * It's the building block for anything with limits a finger can push against, like a scroll
 * position, a zoom, a slider or a drawer. Inside the range it returns the value unchanged, so
 * an ordinary gesture lands exactly where it was asked to.
 */
export function rubberBandClamp(
  value: number, min: number, max: number, dimension: number, constant = RUBBER_BAND_CONSTANT,
): number {
  if (value > max) return max + rubberBand(value - max, dimension, constant)
  if (value < min) return min - rubberBand(min - value, dimension, constant)
  return value
}
