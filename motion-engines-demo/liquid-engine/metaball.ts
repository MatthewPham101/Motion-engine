// The metaball at the heart of the engine. It draws the big centre circle and a drop
// as one outline with a smooth neck where they meet. This is analytic: a real path
// rather than a blur-and-threshold filter, which would fuzz the crisp edge and cost a
// re-filter every frame on iOS.

import { clamp } from './curves'
import { ellipseSegs, formatPath } from './path'
import type { Point, Seg } from './path'

/** Default length of the neck's curve handles, as a multiple of the shapes' radii. */
export const METABALL_HANDLE = 2.4

export interface MergeInput {
  /** The centre circle's radius, and the drop's distance from its middle. */
  R: number; d: number
  /** The drop's radius along the pull, and its across / along ratio (1 means a circle). */
  rc: number; squeeze: number
  /** How wide the neck spreads around each shape, from 0 to the most it can. */
  spread: number
  /** The centre circle's wobble once the drop is inside (fraction of R). */
  wobble: number
  /** How far apart (px) the two can be and still stay joined, which gives a neck
   *  stretched past touching as a drop leaves. 0 means joined only while overlapping. */
  bridge?: number
  /** Whether to draw the centre circle when it isn't joined to the drop. False draws the drop alone. */
  centre?: boolean
  /** The widest the neck's base can reach around the centre, on each side of the drop,
   *  in radians. This keeps two drops budding side by side from meeting in corners. */
  maxBase?: number
  /** The neck's handle length (default `METABALL_HANDLE`). */
  handle?: number
}

/**
 * The centre circle and the drop as one outline, in the local frame.
 *
 *   apart     two separate shapes
 *   touching  fused through a neck, with arcs meeting it tangentially so the outline
 *             has no corners anywhere
 *   inside    only the centre circle, possibly wobbling (an ellipse)
 *
 * `rc` is the drop's radius along the pull and `squeeze` is across / along, so a
 * stretched drop is an ellipse. The neck gets solved for a plain circle of radius
 * `rc`, which keeps "touching" exact because the drop's nearest point is on the axis.
 * Then the drop's side is squeezed across the axis onto the ellipse. Squeezing is an
 * affine transform, so the joins stay tangent.
 */
export function mergeSegments(input: MergeInput): Seg[] {
  const { R, d, rc: r, squeeze: q, wobble: w, bridge = 0, centre = true, maxBase, handle = METABALL_HANDLE } = input
  let v = input.spread
  const centreShape = (rx: number, ry: number) => (centre ? ellipseSegs(0, rx, ry) : [])
  if (d <= R - r) return centreShape(R * (1 + w), R * (1 - w))
  if (d >= R + r + bridge || (d >= R + r && v <= 0)) return [...centreShape(R, R), ...ellipseSegs(d, r, r * q)]

  const u1 = Math.acos(clamp((R * R + d * d - r * r) / (2 * R * d), -1, 1))
  const u2 = Math.acos(clamp((r * r + d * d - R * R) / (2 * r * d), -1, 1))
  const maxSpread = Math.acos(clamp((R - r) / d, -1, 1))
  // A narrower base means a smaller spread on the drop's side too, so both ends of the
  // neck still match.
  if (maxBase !== undefined && maxSpread - u1 > 1e-6 && u1 + (maxSpread - u1) * v > maxBase) {
    v = clamp((maxBase - u1) / (maxSpread - u1))
  }
  const a1 = u1 + (maxSpread - u1) * v
  const a3 = Math.PI - u2 - (Math.PI - u2 - maxSpread) * v

  const p1: Point = [R * Math.cos(a1), R * Math.sin(a1)]
  const p2: Point = [p1[0], -p1[1]]
  const p3: Point = [d + r * Math.cos(a3), r * Math.sin(a3)]

  const total = R + r
  const reach = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / total
  const d2 = Math.min(v * handle, reach) * Math.min(1, (2 * d) / total)
  // A handle long enough to cross the axis would twist a thin neck into a bow tie, so
  // each one stops short of it.
  const cap = (len: number, y: number, cosine: number) =>
    cosine > 1e-6 ? Math.min(len, (0.8 * y) / cosine) : len
  const l1 = cap(R * d2, p1[1], Math.cos(a1))
  const l2 = cap(r * d2, p3[1], -Math.cos(a3))

  const h1: Point = [p1[0] + l1 * Math.sin(a1), p1[1] - l1 * Math.cos(a1)]
  const h2: Point = [h1[0], -h1[1]]
  const h3: Point = [p3[0] - l2 * Math.sin(a3), p3[1] + l2 * Math.cos(a3)]

  // The drop's side, squeezed across the axis onto the ellipse.
  const sq = ([x, y]: Point): Point => [x, y * q]
  const p3e = sq(p3)
  const p4e: Point = [p3e[0], -p3e[1]]
  const h3e = sq(h3)
  const h4e: Point = [h3e[0], -h3e[1]]
  const ry = r * q

  return [
    ['M', p1],
    ['C', h1, h3e, p3e],
    // Round the far side of the drop, through its furthest point.
    ['A', r, ry, [d + r, 0]],
    ['A', r, ry, p4e],
    ['C', h4e, h2, p2],
    // Round the far side of the centre circle, through its furthest point.
    ['A', R, R, [-R, 0]],
    ['A', R, R, p1],
    ['Z'],
  ]
}

/** mergeSegments, as path data in the local frame. */
export function mergeOutline(input: MergeInput): string {
  return formatPath(mergeSegments(input))
}

/**
 * The widest a neck's base can reach around the centre, on each side of its drop,
 * when `count` drops share the ring evenly. `share` is how far toward a neighbor's
 * neck it can go, so neighboring necks never touch.
 */
export function neckBaseLimit(count: number, share: number): number {
  return (Math.PI / Math.max(1, count)) * 2 * share
}
