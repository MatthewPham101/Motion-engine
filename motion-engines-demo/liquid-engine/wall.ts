// When a body of liquid meets a round wall it should act like liquid on glass, not like
// a ball hitting a fence:
//
//   - Pressed in, the side touching the wall flattens onto it, following the wall's own
//     curve, and leaves it through a rounded meniscus.
//   - It wets the wall, creeping along past its own sides in thin feet so it meets the
//     wall in a concave curve.
//   - Whatever liquid no longer fits spreads along the wall, so the area stays the same.
//   - Pulled away, it clings. Its side stays on the wall, drawn out toward it (`stick`),
//     until it lets go. The caller decides when, and springs it back.
//
// The wall is a circle the body is held inside (the rim of a platter, a circle's edge
// around its green) or kept outside of (another circle pressing in). A body can meet
// several at once, and nothing ever crosses one.
//
// This is pure math. liquidBody works in the body's own frame, with its middle at the
// origin and its `along` axis on x. wallBody is the one-wall case in the engine's usual
// frame, with the wall's middle at the origin and the body on +x.

import { closedCurveSegs } from './path'
import type { Point, Seg } from './path'

/** A round wall the body touches, in the body's own frame. */
export interface WallContact {
  /** The wall's middle. */
  x: number
  y: number
  radius: number
  /** Whether the body is held inside this circle (a rim, a container) or kept outside it
   *  (a circle pressing in). */
  side: 'inside' | 'outside'
  /** How far (px) the body is pressed into it: where its side would be, past where it's
   *  being held. 0 keeps its own shape. */
  press: number
  /** How far (px) its side is drawn out toward the wall while clinging. */
  stick: number
}

export interface LiquidBodyInput {
  /** Its radius along x and y, before any wall. */
  along: number
  across: number
  contacts: readonly WallContact[]
  /** How round the meniscus is. Its radius is this times (press + stick). */
  fillet: number
  /** How far (px) it creeps along a wall past its sides, per px pressed. Capped at
   *  `maxCreep`, or the feet pinch into points. */
  wet: number
  maxCreep: number
  /** The height (px) off the wall that the creep fades over. */
  wetReach: number
}

export interface LiquidBody {
  /** Its outline in the body's own frame. */
  points: Point[]
  segs: Seg[]
  /** Its centre of area, which the walls can move. */
  x: number
  y: number
  /** Half its extent along x and y, which its contents squash to. */
  along: number
  across: number
  /** The largest circle around its centre of area that fits inside. It stands in for the
   *  body wherever something else meets it (see peer.ts). Anything bigger would poke out
   *  past a flattened side. */
  inner: number
}

/** Outline points. Enough that the flat contact, the feet and the meniscus look smooth. */
const SAMPLES = 72
/** Passes of re-spreading to keep the area. It settles within a fraction of a percent. */
const AREA_ROUNDS = 3
/** Limits on the spreading. A body squeezed between walls can't keep all its area, and
 *  it shouldn't balloon trying. */
const SPREAD_RANGE = [0.5, 2] as const

/** Shoelace area of a closed polygon. The sign is the winding, so this takes the absolute value. */
function areaOf(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/** The minimum of `a` and `b` with the corner rounded over a band `k` wide. Outside that
 *  band it's exactly the minimum. A log-sum smooth minimum never is, and it held the whole
 *  contact a few px off the wall. */
function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}

/** The same for the maximum. */
const smoothMax = (a: number, b: number, k: number) => -smoothMin(-a, -b, k)

/** Folds an angle into (-pi, pi]. */
const fold = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** The shape a body ends up in after its walls act on it, with area preserved. */
export function liquidBody(input: LiquidBodyInput): LiquidBody {
  const { along: a, across: b, contacts } = input
  const free: Point[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const phi = -(2 * Math.PI * i) / SAMPLES // counter-clockwise on screen, like every other shape
    free.push([a * Math.cos(phi), b * Math.sin(phi)])
  }
  // Measure the area using these same points, so a body nothing presses comes out exactly
  // its own shape.
  const target = areaOf(free)
  const walls = contacts.map(c => {
    const dc = Math.hypot(c.x, c.y)
    // Direction from the wall's middle to the body's, which is where on the wall it touches.
    const ux = dc > 1e-6 ? -c.x / dc : 1
    const uy = dc > 1e-6 ? -c.y / dc : 0
    const press = Math.max(0, c.press)
    const stick = Math.max(0, c.stick)
    return {
      ...c, dc, ux, uy, press, stick,
      toward: Math.atan2(uy, ux),
      k: input.fillet * (press + stick),
      creep: Math.min(input.wet * press, input.maxCreep),
      // The contact's width decides which way along the wall a point creeps.
      contactAngle: Math.max(1e-3, (0.25 * b) / c.radius),
    }
  })

  let spread = 1
  let points: Point[] = []
  for (let round = 0; round < AREA_ROUNDS; round++) {
    points = []
    // Its radius toward a wall, given this pass's spread.
    const radiusToward = (ux: number, uy: number) => 1 / Math.hypot(ux / a, uy / (b * spread))
    for (let i = 0; i < SAMPLES; i++) {
      const phi = -(2 * Math.PI * i) / SAMPLES
      let x = a * Math.cos(phi)
      let y = b * spread * Math.sin(phi)
      for (const w of walls) {
        const own = radiusToward(w.ux, w.uy)
        let D = Math.hypot(x - w.x, y - w.y)
        if (D < 1e-9) continue
        let angle = Math.atan2(y - w.y, x - w.x)
        // How directly this point faces the wall's surface.
        const facing = (x * w.ux + y * w.uy) / (Math.hypot(x, y) || 1)
        let held: number
        if (w.side === 'inside') {
          // Clinging: the side facing the rim gets drawn out to it, plus a rounding band, so it
          // lies on the wall in a small patch.
          if (w.stick > 0) D += (w.stick + w.k) * Math.max(0, facing) ** 3
          held = smoothMin(D, Math.min(w.radius, w.dc + own + w.stick - w.press), w.k)
        } else {
          if (w.stick > 0) D = Math.max(0.1, D - (w.stick + w.k) * Math.max(0, -facing) ** 3)
          held = smoothMax(D, Math.max(w.radius, w.dc - own - w.stick + w.press), w.k)
        }
        // Wetting: near the wall a point creeps along it, away from the middle of the contact.
        // That's what makes the feet and the concave curve up into the sides.
        if (w.creep > 0) {
          const off = w.side === 'inside' ? w.radius - held : held - w.radius
          angle += (w.creep / w.radius) * Math.exp(-off / input.wetReach)
            * Math.tanh(fold(angle - w.toward) / w.contactAngle)
        }
        // Hold it to the wall along the line from the wall's middle, so that on the wall the
        // outline is exactly the wall's arc.
        x = w.x + held * Math.cos(angle)
        y = w.y + held * Math.sin(angle)
      }
      points.push([x, y])
    }
    spread = Math.min(SPREAD_RANGE[1], Math.max(SPREAD_RANGE[0], spread * (target / Math.max(1e-6, areaOf(points)))))
  }

  // The polygon's centroid and its extent.
  let cross = 0
  let mx = 0
  let my = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    const c = x1 * y2 - x2 * y1
    cross += c
    mx += (x1 + x2) * c
    my += (y1 + y2) * c
    minX = Math.min(minX, x1)
    maxX = Math.max(maxX, x1)
    minY = Math.min(minY, y1)
    maxY = Math.max(maxY, y1)
  }
  const cx = mx / (3 * cross)
  const cy = my / (3 * cross)
  // Slightly under the nearest outline point, because the curve sags a little between points.
  let inner = Infinity
  for (const [x, y] of points) inner = Math.min(inner, Math.hypot(x - cx, y - cy))
  return {
    points,
    segs: closedCurveSegs(points),
    x: cx,
    y: cy,
    along: (maxX - minX) / 2,
    across: (maxY - minY) / 2,
    inner: Math.max(0, inner - 0.5),
  }
}

export interface WallInput {
  /** The drop's middle, measured from the wall's middle. */
  d: number
  /** Its radius along the line to the wall's middle and across it, before the wall acts. */
  along: number
  across: number
  /** The wall's radius. The drop is held inside it. */
  wall: number
  press: number
  stick: number
  fillet: number
  wet: number
  maxCreep: number
  wetReach: number
}

export interface WallBody {
  /** Its outline in the local frame. */
  segs: Seg[]
  /** Its centre of area from the wall's middle, after the wall moves it. */
  d: number
  along: number
  across: number
  inner: number
}

/** A drop inside one round wall in the usual frame: the wall's middle at the origin and
 *  the drop on +x. */
export function wallBody(input: WallInput): WallBody {
  const { d } = input
  const body = liquidBody({
    along: input.along,
    across: input.across,
    contacts: [{ x: -d, y: 0, radius: input.wall, side: 'inside', press: input.press, stick: input.stick }],
    fillet: input.fillet, wet: input.wet, maxCreep: input.maxCreep, wetReach: input.wetReach,
  })
  return {
    segs: closedCurveSegs(body.points.map(([x, y]) => [x + d, y] as Point)),
    d: d + body.x,
    along: body.along,
    across: body.across,
    inner: body.inner,
  }
}
