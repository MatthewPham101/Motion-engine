// Drops budding off the centre, roughly the swallow played backwards:
//   1. form   the icon gathers in the middle, small and blurred, then drifts out
//             toward the rim, sharpening as it goes
//   2. bud    the drop swells out through the rim on a wide neck
//   3. pinch  the neck stretches as it pulls away, thins, and lets go
//   4. land   the drop springs past its spot, comes back, and jiggles to a stop
//   5. pour   its label runs out of the rim and firms up beneath it
//
// Several drops are staggered around the ring, with necks kept narrow enough that they
// never meet (neckShare, see neckBaseLimit in metaball.ts).
//
// Pure math in the local frame: centre at the origin, drop on +x.

import { clamp, easeOut, lerp, monotoneCurve, smooth, span } from './curves'
import type { MeltShape } from './melt'
import { mergeSegments, neckBaseLimit } from './metaball'
import { ellipseSegs } from './path'
import type { Seg } from './path'

/** All the tuning for a pop-out. Times are ms after the drop starts. */
export interface EmitTuning {
  /** Time between one drop and the next. Neighbors bud side by side, so if this gets much
   *  smaller their necks web together across the centre. */
  readonly stagger: number
  readonly rimAt: number    // the drop's edge reaches the centre circle's rim
  readonly budAt: number    // a quarter of it is out, on a wide neck
  readonly pinchAt: number  // the neck has stretched as far as it goes, and lets go
  readonly landAt: number   // furthest out (it overshoots its place by `overshoot`)
  readonly settle: number   // the bounce back and the jiggle, after `landAt`

  readonly overshoot: number
  readonly undershoot: number
  /** How far apart the neck still holds before it pinches, as a multiple of r. */
  readonly bridge: number
  /** The neck's width while the drop is half in... */
  readonly spread: number
  /** ...and as it lets go. Thin, so the snap looks like a thread breaking. */
  readonly pinchSpread: number
  /** The drop's scale as it buds, reaching full size by the pinch. It starts small so it
   *  isn't already as wide as the gap to its neighbor. */
  readonly birthScale: number
  /** How far toward a neighbor's neck the base of this neck can reach. */
  readonly neckShare: number
  readonly stretchPerSpeed: number
  readonly maxStretch: number
  readonly jiggle: number
  readonly jigglePeriod: number
  readonly jiggleDecay: number

  readonly icon: {
    readonly fadeFrom: number; readonly fadeTo: number; readonly meltTo: number
    readonly scaleFrom: number; readonly growTo: number
    readonly melt: MeltShape
  }
  readonly label: {
    readonly from: number; readonly to: number
    readonly startScaleX: number; readonly startScaleY: number; readonly stretchPeak: number
    readonly melt: MeltShape
  }
}

/** The default pop-out, tuned for the original 792px dashboard canvas. */
export const EMIT = {
  stagger: 110,
  rimAt:   150,
  budAt:   280,
  pinchAt: 430,
  landAt:  620,
  settle:  320,

  overshoot:   7,
  undershoot:  1.5,
  bridge:      0.5,
  spread:      0.42, // narrower than going in: see `stagger`
  pinchSpread: 0.07,
  birthScale:  0.55,
  neckShare:   0.42,
  stretchPerSpeed: 0.4,
  maxStretch:  0.22,
  jiggle:      0.06, jigglePeriod: 210, jiggleDecay: 120,

  // These melts re-sharpen around half alpha (cut = (slope - 1) / 2), so the icon and
  // label firm up at their real weight. A bolder edge looked like liquid going in, but
  // coming out it just looked like bold, jagged type.
  icon:  {
    fadeFrom: 20, fadeTo: 190, meltTo: 330, scaleFrom: 0.35, growTo: 400,
    melt: { blurX: 2.6, blurY: 2.6, slope: 1.6, cut: 0.3 },
  },
  label: {
    from: 480, to: 780, startScaleX: 0.35, startScaleY: 0.3, stretchPeak: 1.35,
    melt: { blurX: 1.2, blurY: 3.5, slope: 2.2, cut: 0.6 },
  },
} as const satisfies EmitTuning

/** One drop, start to standing still. */
export function emitDropDuration(tuning: EmitTuning = EMIT): number {
  return tuning.landAt + tuning.settle
}

/** One default drop, start to standing still. */
export const EMIT_DROP_TOTAL = emitDropDuration(EMIT)

/** When the last of `count` drops has finished, from the first one's start. */
export function emitDuration(count: number, tuning: EmitTuning = EMIT): number {
  return Math.max(0, count - 1) * tuning.stagger + emitDropDuration(tuning)
}

export interface EmitGeometry {
  /** The centre circle's radius. */
  R: number
  /** The drop's radius. */
  r: number
  /** From the centre's middle to where the circle sits. */
  dSlot: number
  /** How many circles share the ring (they are evenly spaced round it). */
  count: number
}

export interface EmitFrame {
  d: number
  /** The drop's scale along and across its path, including its growth while budding. */
  along: number
  across: number
  /** Joined to the centre circle by a neck right now. */
  attached: boolean
  /** Its outline in the local frame. Empty while it's still inside the centre circle. */
  shape: Seg[]
  icon:  { scale: number; melt: number; opacity: number }
  label: { suck: number; sx: number; sy: number; melt: number; opacity: number }
}

/** One drop's pop-out, by time `tau` from its own start. Negative means it hasn't begun. */
export function createEmitTimeline(g: EmitGeometry, tuning: EmitTuning = EMIT): (tau: number) => EmitFrame {
  const E = tuning
  const { R, r, dSlot } = g
  const total = emitDropDuration(E)
  const maxBase = neckBaseLimit(g.count, E.neckShare)
  const distance = monotoneCurve(
    [0, E.rimAt, E.budAt, E.pinchAt, E.landAt, E.landAt + 150, total],
    [0, R - 0.95 * r, R + 0.25 * r, R + r + E.bridge * r, dSlot + E.overshoot, dSlot - E.undershoot, dSlot],
  )
  const labelAt = createEmitLabel(E)

  return (tau: number): EmitFrame => {
    if (tau < 0) {
      return {
        d: 0, along: 1, across: 1, attached: false, shape: [],
        icon: { scale: E.icon.scaleFrom, melt: 1, opacity: 0 },
        label: { suck: 1, sx: E.label.startScaleX, sy: E.label.startScaleY, melt: 1, opacity: 0 },
      }
    }
    const d = distance(tau)
    const speed = Math.abs(distance(tau + 1) - distance(tau - 1)) / 2
    const still = 1 - smooth(span(tau, total - 120, total))
    const grow = lerp(E.birthScale, 1, smooth(span(tau, E.rimAt, E.pinchAt + 60)))
    const stretch = clamp(speed * E.stretchPerSpeed, 0, E.maxStretch) * still
    const since = tau - E.landAt
    const jiggle = since > 0
      ? E.jiggle * Math.exp(-since / E.jiggleDecay) * Math.sin((2 * Math.PI * since) / E.jigglePeriod) * still
      : 0
    const sa = (1 + stretch) * (1 - jiggle)
    const rc = r * grow * sa
    const squeeze = 1 / (sa * sa)

    const gap = d - (R + rc)
    const reach = E.bridge * r
    const attached = d > R - rc && gap < reach
    const spread = gap <= 0 ? E.spread : E.pinchSpread + (E.spread - E.pinchSpread) * (1 - gap / reach) ** 1.5
    const shape: Seg[] = d <= R - rc
      ? []
      : attached
        ? mergeSegments({ R, d, rc, squeeze, spread, wobble: 0, bridge: reach, maxBase })
        : ellipseSegs(d, rc, rc * squeeze)

    return {
      d,
      along: sa * grow,
      across: grow / sa,
      attached,
      shape,
      icon: {
        scale: lerp(E.icon.scaleFrom, 1, easeOut(span(tau, 0, E.icon.growTo))),
        melt: 1 - smooth(span(tau, 0, E.icon.meltTo)),
        opacity: easeOut(span(tau, E.icon.fadeFrom, E.icon.fadeTo)),
      },
      label: labelAt(tau),
    }
  }
}

/**
 * The label's part of a pop-out, by time `tau` from the drop's start: it pours out of
 * the rim and firms up beneath it. It doesn't depend on what the drop is doing, so a
 * host can run it on its own clock, like a held drop going home in hold.ts.
 */
export function createEmitLabel(tuning: EmitTuning = EMIT): (tau: number) => EmitFrame['label'] {
  const E = tuning
  const labelY = monotoneCurve(
    [E.label.from, E.label.from + 0.45 * (E.label.to - E.label.from), E.label.to],
    [E.label.startScaleY, E.label.stretchPeak, 1],
  )
  return (tau: number) => {
    const pour = span(tau, E.label.from, E.label.to)
    return {
      suck: 1 - smooth(pour),
      sx: lerp(E.label.startScaleX, 1, easeOut(pour)),
      sy: tau >= E.label.to ? 1 : tau <= E.label.from ? E.label.startScaleY : labelY(tau),
      melt: 1 - smooth(span(tau, E.label.from, E.label.to - 60)),
      opacity: easeOut(span(tau, E.label.from, E.label.from + 140)),
    }
  }
}
