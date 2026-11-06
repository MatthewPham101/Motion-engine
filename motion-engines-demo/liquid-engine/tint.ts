// A circle can carry its own color, like a progress disc or a completed category, and
// a scene can have a band: a ring around the centre made of that same color. The tint
// is a blob of that liquid inside the drop. As the drop gets pulled in, the blob
// reaches for the band, fuses with it through a neck just like the circles do (see
// metaball.ts), and flows in while the band swells. Popping out is the same thing
// backwards, with the tint budding off the band.
//
// My first attempt ran the color down the neck like dye, with the band parting for
// it. That looked wrong, which is why the tint is its own liquid.

import { clamp, easeOut, smooth } from './curves'
import { EMIT } from './emit'
import type { EmitTuning } from './emit'
import { mergeSegments } from './metaball'
import type { Seg } from './path'

/** The color a circle carries. At rest it matches the circle's own fill. Pulled in, it
 *  flows into the band. Popping out, it gathers back into the drop. */
export interface LiquidTint {
  color: string
  /** Its opacity at rest. */
  alpha: number
  /** Its radius as a share of the circle's. A progress disc uses the square root of done. */
  size: number
  /** Fills the whole circle including the border (the border is the same color).
   *  Otherwise it only fills the inside of the circle's 2px border. */
  toEdge?: boolean
}

export const TINT = {
  /** How far from the band (times the blob's radius) a blob starts taking on the band's
   *  shade, so they're the same color by the time they touch. */
  approach: 1.5,
  /** How much the band swells as a blob passes into it, as a multiple of the blob's area
   *  spread around the ring. */
  swell: 0.5,
  /** Its neck's width, and how far into the band it reaches full width. */
  spread: 0.5,
  neckRamp: 0.3,
} as const

export interface TintBand {
  /** The band's outer and inner radius in canvas px, measured from the centre's middle. */
  outer: number
  inner: number
  /** Its shade. */
  alpha: number
}

export interface TintBlobFrame {
  /** Fused with the band right now, so it gets drawn as part of it, in its shade. */
  attached: boolean
  /** Its outline joined to the band (local frame), when attached. */
  joined: Seg[] | null
  /** The ellipse to draw when it's outside the band and not attached. */
  alone: { d: number; rx: number; ry: number; alpha: number } | null
  /** How much it swells the band right now, in px. */
  swell: number
}

/**
 * A drop's tint measured against the band. With `outward` it's popping out, and its
 * neck stretches past touching before letting go, using `bridge` and `pinchSpread`
 * from the emit tuning. Otherwise it's going in, and the neck grows from the touching
 * point. `band.outer` includes the current swell so a joined blob meets the swollen band.
 */
export function tintBlobOf(input: {
  tint: LiquidTint; band: TintBand; r: number; d: number; along: number; across: number; outward: boolean
  /** The circle's resting distance from the middle. Its shade matches the circle's own
   *  exactly there, however close the circle sits to the band. */
  rest?: number
}, emit: Pick<EmitTuning, 'bridge' | 'pinchSpread'> = EMIT): TintBlobFrame {
  const { tint, band, r, d, along, across, outward, rest } = input
  const rc = tint.size * r * along
  const ry = tint.size * r * across
  const squeeze = rc > 0 ? ry / rc : 1
  const mid = (band.outer + band.inner) / 2
  const swell = TINT.swell * (rc * ry) / (2 * mid) * smooth(clamp(1 - Math.abs(d - mid) / (rc + 5)))
  const bridge = outward ? emit.bridge * rc : 0
  const gap = d - rc - band.outer

  // Inside the band's outer edge it's part of the band now, and the hole hides the rest.
  if (d + rc <= band.outer) return { attached: false, joined: null, alone: null, swell }

  if (gap < bridge) {
    const spread = gap <= 0
      ? TINT.spread * (outward ? 1 : easeOut(clamp(-gap / (TINT.neckRamp * rc))))
      : emit.pinchSpread + (TINT.spread - emit.pinchSpread) * (1 - gap / bridge) ** 1.5
    return {
      attached: true,
      joined: mergeSegments({ R: band.outer, d, rc, squeeze, spread, wobble: 0, bridge }),
      alone: null,
      swell,
    }
  }

  // Apart from the band: it keeps its own shade and shifts to the band's as it gets
  // close. The shift never starts further out than the circle's resting spot, otherwise
  // a circle sitting close to the band would hand over too dark and flick lighter.
  const span = rest === undefined
    ? TINT.approach * rc
    : Math.max(1, Math.min(TINT.approach * rc, rest - rc - band.outer - bridge))
  const near = smooth(clamp(1 - (gap - bridge) / span))
  return {
    attached: false,
    joined: null,
    alone: { d, rx: rc, ry, alpha: tint.alpha + (band.alpha - tint.alpha) * near },
    swell,
  }
}
