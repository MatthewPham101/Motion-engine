// A circle turns into a drop that the centre circle pulls in:
//   1. recoil   it gives a little outward and squashes, gathering itself
//   2. travel   it gets drawn toward the centre, stretching with its speed
//   3. neck     on touching the centre the two fuse through a smooth neck (metaball.ts),
//               which widens as the drop sinks in
//   4. swallow  once inside, the centre swells by the drop's volume and wobbles back to
//               round like a struck droplet
//
// The label gets slurped into the drop first and melts. The icon rides inside and melts
// as it's absorbed. LiquidCanvas draws all of it.
//
// This is pure math in a local frame: the centre at the origin, the drop on +x. Distances
// are in whatever px the caller's canvas uses. The default tuning was made for a 792px
// canvas with drops of about r = 44.

import { clamp, easeIn, easeOut, lerp, monotoneCurve, smooth, span } from './curves'
import type { MeltShape } from './melt'
import { mergeSegments } from './metaball'
import type { MergeInput } from './metaball'
import { formatPath } from './path'
import type { Seg } from './path'

/** All the tuning for a swallow. Times are ms after it starts. */
export interface SwallowTuning {
  readonly recoilAt: number   // the drop's furthest point outward
  readonly contactAt: number  // it is about to touch the centre circle
  readonly neckAt: number     // half its radius in, and the neck is fully formed
  readonly insideAt: number   // wholly inside the centre circle
  readonly centreAt: number   // its middle reaches the centre's middle
  readonly settle: number     // the centre circle's wobble, after `insideAt`

  readonly recoilPx: number        // how far it gives outward
  readonly recoilSquash: number    // how much it flattens along the pull while it does
  readonly stretchPerSpeed: number // stretch along the pull per px/ms of speed
  readonly maxStretch: number
  readonly popSettle: number       // the press "pop" scale eases out over this

  /** The neck: how wide it spreads around each shape, how long its curve handles are, and
   *  how far into the overlap (times the drop's radius) it reaches full width. That last
   *  one is what makes the fusing grow out from the touching point. */
  readonly spread: number
  readonly handle: number
  readonly neckRamp: number

  /** Once swallowed, the centre grows by `swell` of the drop's area and relaxes over
   *  `swellDecay`, while it wobbles (a fraction of the radius, a period, and a decay). */
  readonly swell: number
  readonly swellDecay: number
  readonly wobble: number
  readonly wobblePeriod: number
  readonly wobbleDecay: number

  /** The label gets drawn up into the drop like liquid through a straw. It narrows, streaks
   *  (`melt`) and disappears as it reaches the rim. `rim` is where its top ends up, as a
   *  share of the drop's radius below the middle. `lag` is how far (ms) it trails the drop. */
  readonly label: {
    readonly suck: number; readonly lag: number; readonly rim: number
    readonly meltFrom: number; readonly meltTo: number
    readonly fadeFrom: number; readonly fadeTo: number
    readonly stretchPeak: number; readonly stretchAt: number
    readonly endScaleY: number; readonly endScaleX: number
    readonly melt: MeltShape
  }
  /** The icon rides inside the drop and dissolves as it's absorbed. */
  readonly icon: {
    readonly meltFrom: number; readonly meltTo: number
    readonly fadeFrom: number; readonly fadeTo: number
    readonly endScale: number
    readonly melt: MeltShape
  }
}

/** The default swallow, tuned for the original 792px dashboard canvas. */
export const SWALLOW = {
  recoilAt:   110,
  contactAt:  360,
  neckAt:     470,
  insideAt:   620,
  centreAt:   760,  // (the icon is gone by then)
  settle:     480,

  recoilPx:      6,
  recoilSquash:  0.1,
  stretchPerSpeed: 0.45,
  maxStretch:    0.2,
  popSettle:     140,

  spread:   0.5,
  handle:   2.4,
  neckRamp: 0.3,

  swell:        0.5,
  swellDecay:   180,
  wobble:       0.05,
  wobblePeriod: 290,
  wobbleDecay:  170,

  // Mostly a vertical smear, in the direction it's being pulled, and never over the icon.
  label: {
    suck: 260, lag: 50, rim: 0.55,
    meltFrom: 20, meltTo: 230,
    fadeFrom: 90, fadeTo: 240,
    stretchPeak: 1.7, stretchAt: 120, endScaleY: 0.3, endScaleX: 0.35,
    melt: { blurX: 1.4, blurY: 5, slope: 3, cut: 0.6 },
  },
  // Keep this soft. Re-sharpening a thin outline glyph breaks it into fragments.
  icon: {
    meltFrom: 430, meltTo: 690, fadeFrom: 500, fadeTo: 700, endScale: 0.5,
    melt: { blurX: 2.6, blurY: 2.6, slope: 1.6, cut: 0.15 },
  },
} as const satisfies SwallowTuning

/** How long a swallow runs, wobble included. */
export function swallowDuration(tuning: SwallowTuning = SWALLOW): number {
  return tuning.insideAt + tuning.settle
}

/** How long the default swallow runs, wobble included. */
export const SWALLOW_TOTAL = swallowDuration(SWALLOW)

export interface SwallowGeometry {
  /** The centre circle's radius. */
  R: number
  /** The drop's radius. */
  r: number
  /** Distance from the centre's middle to the drop's at rest. */
  d0: number
  /** The drop's scale when it starts, for a press "pop". Use 1 for none. */
  s0: number
  /** Its share of the centre's swell and wobble (default 1). When several drops go in
   *  together each one causes a little of it, otherwise the centre churns. */
  wobble?: number
  /** Caps the neck's base around the centre. See MergeInput.maxBase. */
  maxBase?: number
}

export interface SwallowFrame {
  /** Distance from the centre's middle to the drop's. */
  d: number
  /** The drop's scale along and across the pull, times its pop. The product of the two
   *  stretch factors is 1, so area is preserved. */
  along: number
  across: number
  /** The outline in the local frame, as commands and as path data. */
  shape: Seg[]
  outline: string
  /** What the outline was drawn from. A host easing its own drop onto the swallow's shape
   *  needs this (see hold.ts). */
  merge: MergeInput
  icon:  SwallowIcon
  label: SwallowLabel
}

/** The icon riding in the drop: its scale, its melt (0 to 1) and its opacity. */
export interface SwallowIcon { scale: number; melt: number; opacity: number }

/** The label being drawn into the drop: how far it's been sucked in (0 at rest, 1 at the
 *  drop's rim), its scale, its melt and its opacity. */
export interface SwallowLabel { suck: number; sx: number; sy: number; melt: number; opacity: number }

export interface SwallowTimeline {
  (t: number): SwallowFrame
  /** Only the drop's distance. It's cheap, and the label's lagging follow needs it. */
  distance: (t: number) => number
}

/** The label's part of a swallow, by time. It doesn't depend on what the drop is doing,
 *  so a host can run it on its own clock, like a drop held by a finger in hold.ts. */
export function createSwallowLabel(tuning: SwallowTuning = SWALLOW): (t: number) => SwallowLabel {
  const L = tuning
  const labelCurve = monotoneCurve(
    [0, L.label.stretchAt, L.label.suck],
    [1, L.label.stretchPeak, L.label.endScaleY],
  )
  return (t: number) => {
    const suck = smooth(span(t, 0, L.label.suck))
    return {
      suck,
      sx: lerp(1, L.label.endScaleX, suck),
      sy: labelCurve(t),
      melt: smooth(span(t, L.label.meltFrom, L.label.meltTo)),
      opacity: 1 - easeIn(span(t, L.label.fadeFrom, L.label.fadeTo)),
    }
  }
}

/** The icon's part of a swallow, by time. */
export function swallowIconAt(t: number, tuning: SwallowTuning = SWALLOW): SwallowIcon {
  const L = tuning
  return {
    scale: lerp(1, L.icon.endScale, easeIn(span(t, L.icon.meltFrom + 20, L.icon.fadeTo))),
    melt: smooth(span(t, L.icon.meltFrom, L.icon.meltTo)),
    opacity: 1 - easeIn(span(t, L.icon.fadeFrom, L.icon.fadeTo)),
  }
}

/** The swallow's distance curve: how far the drop is from the centre's middle over time. */
function swallowDistance(g: Pick<SwallowGeometry, 'R' | 'r' | 'd0'>, L: SwallowTuning) {
  const { R, r, d0 } = g
  return monotoneCurve(
    [0, L.recoilAt, L.contactAt, L.neckAt, L.insideAt, L.centreAt],
    [d0, d0 + L.recoilPx, R + r + 2, R + r - 0.45 * r, R - r, 0],
  )
}

/**
 * When a drop on its way in (after the recoil) is `d` from the centre's middle. In other
 * words, how far into the swallow a drop that a finger already carried this close should
 * be. The curve only falls after the recoil, so plain bisection finds it.
 */
export function swallowTimeAt(distance: (t: number) => number, d: number, tuning: SwallowTuning = SWALLOW): number {
  let lo: number = tuning.recoilAt
  let hi: number = tuning.centreAt
  if (d >= distance(lo)) return lo
  if (d <= distance(hi)) return hi
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (distance(mid) > d) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Everything the drop, the centre, the icon and the label do, by time. */
export function createSwallowTimeline(g: SwallowGeometry, tuning: SwallowTuning = SWALLOW): SwallowTimeline {
  const L = tuning
  const total = swallowDuration(L)
  const { R, r, s0 } = g
  const distance = swallowDistance(g, L)
  const share = g.wobble ?? 1
  const swellPx = (Math.sqrt(R * R + L.swell * r * r) - R) * share
  const labelAt = createSwallowLabel(L)

  const frame = ((t: number): SwallowFrame => {
    const d = distance(t)
    // Speed toward the centre, in px/ms.
    const speed = (distance(t - 1) - distance(t + 1)) / 2
    // How much of the drop is inside the centre: 0 touching, 1 fully in.
    const absorbed = clamp((R + r - d) / (2 * r))
    // Nothing is left over at the very end, so the handoff to the real centre circle is exact.
    const fadeOut = 1 - smooth(span(t, total - 140, total))

    const relax = t < L.insideAt ? 1 : Math.exp(-(t - L.insideAt) / L.swellDecay)
    const Rt = R + swellPx * absorbed * relax * fadeOut
    const tau = t - L.insideAt
    const wobble = tau > 0
      ? L.wobble * share * Math.exp(-tau / L.wobbleDecay) * Math.sin((2 * Math.PI * tau) / L.wobblePeriod) * fadeOut
      : 0

    const recoil = 1 - L.recoilSquash * Math.sin(Math.PI * span(t, 0, L.recoilAt + 60))
    const stretch = clamp(speed * L.stretchPerSpeed, 0, L.maxStretch) * (1 - absorbed)
    const sa = (1 + stretch) * recoil
    const pop = lerp(s0, 1, easeOut(span(t, 0, L.popSettle)))

    // The neck grows from the touching point instead of appearing all at once.
    const overlap = R + r * sa - d
    const spread = L.spread * easeOut(clamp(overlap / (L.neckRamp * r)))

    const rc = r * sa * pop
    const merge: MergeInput = {
      R: Rt, d, rc, squeeze: 1 / (sa * sa), spread, wobble, maxBase: g.maxBase, handle: L.handle,
    }
    const shape = mergeSegments(merge)

    return {
      d,
      along: sa * pop,
      across: pop / sa,
      shape,
      outline: formatPath(shape),
      merge,
      icon: swallowIconAt(t, L),
      label: labelAt(t),
    }
  }) as SwallowTimeline
  frame.distance = distance
  return frame
}
