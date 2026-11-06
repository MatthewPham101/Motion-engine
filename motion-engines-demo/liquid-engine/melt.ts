// A melt is an SVG filter: blur the shape, then re-sharpen its alpha edge
// (alpha * slope - cut). Shapes run together like liquid instead of just going soft.
// These helpers produce the two filter attributes for a melt amount `m` from 0 to 1.

/** A melt: the blur in px along x and y, and how hard its edge gets re-sharpened. */
export interface MeltShape { blurX: number; blurY: number; slope: number; cut: number }

/** The color matrix that re-sharpens a blurred alpha edge, `m` of the way into `shape`. */
export function meltMatrix(m: number, shape?: MeltShape): string {
  const slope = shape ? 1 + (shape.slope - 1) * m : 1
  const cut = shape ? -shape.cut * m : 0
  return `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${slope.toFixed(3)} ${cut.toFixed(3)}`
}

/** The blur, `m` of the way into `shape`, as feGaussianBlur's "x y". */
export function meltBlur(m: number, shape: MeltShape): string {
  return `${(shape.blurX * m).toFixed(2)} ${(shape.blurY * m).toFixed(2)}`
}
