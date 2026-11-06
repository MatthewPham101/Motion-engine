// While you drag one circle, every other circle on screen is liquid too, sitting in its
// spot and reacting the way liquid would:
//
//   - It gets nudged: pushed slightly aside when pressed into, tugged slightly along when
//     a neck between them pulls, and it wobbles home afterwards. I tried a version that
//     slid it out of the way by most of the overlap, and the smaller movement looked better.
//   - A grey circle is the same liquid as the held drop. As the drop gets close its surface
//     rises to meet it, and on touching they fuse through a neck that gloops open and snaps
//     when pulled apart. A green disc floating inside it (progress) is a different liquid,
//     so it reacts like the held drop does against the wall (see wall.ts): it dents, spreads
//     around its circle to keep its area, and clings as the drop pulls away.
//   - A circle completely filled with green is a green drop. Its whole body reacts that way.
//     There's no neck, since those are different liquids, and no grey circle left standing
//     behind the dent, which looked like a stray inner circle.
//
// These circles never get swallowed and always end up back in place.
//
// This is pure: each frame it's told where the held drop is, and it answers with its own
// position, its body and liquid, and its green.

import { springStep } from '../spring-engine'
import type { Motion } from '../spring-engine'
import { clamp, easeOut, smooth } from './curves'
import type { EmitTuning } from './emit'
import type { HoldTuning } from './hold'
import { mergeSegments } from './metaball'
import { ellipseSegs } from './path'
import type { Placement, Seg } from './path'
import type { SwallowTuning } from './swallow'
import type { LiquidTint } from './tint'
import { liquidBody } from './wall'

interface Point { x: number; y: number }

/** A circle beside the held one, as the host describes it. */
export interface HoldPeer {
  /** Its item key (see dom.ts). Its circle and label move with it. */
  key: string
  /** Its middle at rest, in canvas px. */
  at: Point
  /** Its label's resting horizontal nudge in px, same as LiquidSwallow.labelShiftX. */
  labelShiftX?: number
  /** Its green (a progress disc or a completed category) and its own fill. The liquid draws
   *  both while the drop is held. */
  tint?: LiquidTint
  fill?: string
}

export interface PeerFrame {
  key: string
  /** How far it's been moved from its spot, in px. */
  dx: number
  dy: number
  /** Its body and its liquid reaching toward the held drop (a rising surface or a neck
   *  joining the two), placed at `at`. */
  shape: Seg[]
  at: Placement
  /** Its green, placed at `place`. Null for a circle with no green. */
  green: { segs: Seg[]; place: Placement } | null
}

export interface PeerLife {
  /** React to the held drop, given its middle (canvas px) and the radius of a circle that
   *  fits inside it there. That circle is what a neck joins and what a green meets. */
  step(drop: Point, dropRadius: number, dt: number): PeerFrame
  frame(): PeerFrame
  /** True when it's in place, still, round, and touching nothing. */
  atRest(): boolean
}

/** A green this big, relative to the circle's inside, counts as a fully green drop. */
const FILLED = 0.9

const still = (x: number): Motion => ({ x, v: 0 })

export function createPeer(
  peer: HoldPeer,
  env: { r: number; hold: HoldTuning; swallow: SwallowTuning; emit: EmitTuning },
): PeerLife {
  const { r, hold: H, swallow: L, emit: E } = env
  const bridgePx = H.bridge * r
  const rho = H.tideWidth * r
  const reach = H.reach * r
  // The green fills the inside (within the 2px edge) out to the square root of done. If the
  // edge is the same color as the green, it covers the whole circle, edge included.
  const room = peer.tint?.toEdge ? r : r - 2
  const greenRadius = peer.tint ? peer.tint.size * room : 0
  const filled = !!peer.tint && (peer.tint.toEdge || peer.tint.size >= FILLED)

  let sx = still(0)
  let sy = still(0)
  let tide = still(0)
  let neck = still(0)
  let linked = false
  // Contact between the green (or, when filled, the whole body) and the held drop.
  // Positive is pressed, negative is clinging.
  let contact = still(0)
  let clinging = false

  const place = () => ({ x: peer.at.x + sx.x, y: peer.at.y + sy.x })

  /** A body of `radius` around `where`, with the held drop pressing in from outside. */
  const dented = (radius: number, where: Point, drop: Point, dropRadius: number, shrink: number): Seg[] => {
    const press = Math.max(0, contact.x - shrink)
    const stick = Math.max(0, -contact.x)
    if (press <= 0.05 && stick <= 0.05) return ellipseSegs(0, radius, radius)
    return liquidBody({
      along: radius,
      across: radius,
      contacts: [{ x: -Math.hypot(where.x - drop.x, where.y - drop.y), y: 0, radius: dropRadius, side: 'outside', press, stick }],
      fillet: H.fillet, wet: H.wet, maxCreep: H.maxCreep * r, wetReach: H.wetReach * r,
    }).segs
  }

  /** A green floating inside a grey circle: its edge holds it in, and the held drop keeps it out. */
  const floating = (where: Point, drop: Point, dropRadius: number): Seg[] => {
    const press = Math.max(0, contact.x)
    const stick = Math.max(0, -contact.x)
    if (press <= 0.05 && stick <= 0.05) return ellipseSegs(0, greenRadius, greenRadius)
    return liquidBody({
      along: greenRadius,
      across: greenRadius,
      contacts: [
        { x: 0, y: 0, radius: room, side: 'inside', press: 0, stick: 0 },
        { x: -Math.hypot(where.x - drop.x, where.y - drop.y), y: 0, radius: dropRadius, side: 'outside', press, stick },
      ],
      fillet: H.fillet, wet: H.wet, maxCreep: H.maxCreep * r, wetReach: H.wetReach * r,
    }).segs
  }

  const rest = (): PeerFrame => ({
    key: peer.key, dx: 0, dy: 0, shape: ellipseSegs(0, r, r), at: { angle: 0, ...peer.at },
    green: peer.tint ? { segs: ellipseSegs(0, greenRadius, greenRadius), place: { angle: 0, ...peer.at } } : null,
  })
  let current = rest()

  return {
    step(drop, rc, dt) {
      const from = place()
      const ux = drop.x - from.x
      const uy = drop.y - from.y
      const dist = Math.hypot(ux, uy) || 1e-6
      const gap = dist - r - rc

      if (!filled) {
        if (!linked && gap <= Math.max(0, tide.x) + 0.5) {
          linked = true
          neck = still(H.neckFrom)
        } else if (linked && gap >= bridgePx) {
          // The neck snaps, and the surface springs back from where it was pulled.
          linked = false
          tide = still(H.tide * r)
        }
        const near = gap <= 0 ? 1 : smooth(clamp(1 - gap / reach))
        if (linked) {
          const target = gap > 0
            ? H.pinchSpread + (E.spread - H.pinchSpread) * (1 - clamp(gap / bridgePx)) ** 1.5
            : Math.max(E.spread, L.spread * easeOut(clamp(-gap / (L.neckRamp * r))))
          neck = springStep(neck, target, H.neckSpring, dt)
        }
        tide = springStep(tide, linked ? 0 : H.tide * r * near, H.tideSpring, dt)
      }

      // The nudge: aside by `push` times the overlap (up to `maxPush`) when pressed into, and
      // along by up to `tug` as a neck stretches. Then it wobbles home.
      const pull = gap > 0
        ? (linked ? H.tug * r * clamp(gap / bridgePx) : 0)
        : -Math.min(H.push * -gap, H.maxPush * r)
      sx = springStep(sx, (ux / dist) * pull, H.peerSpring, dt)
      sy = springStep(sy, (uy / dist) * pull, H.peerSpring, dt)

      // The green (or the whole body, when filled) against the held drop: pressed, or clinging
      // as it pulls away after touching. Once the gap reaches `adhere` it lets go and springs
      // back round.
      const where = place()
      const toDrop = Math.hypot(drop.x - where.x, drop.y - where.y)
      const meets = filled ? r : greenRadius
      if (meets > 0) {
        const clear = toDrop - meets - rc
        if (clear <= 0) clinging = true
        else if (clinging && clear >= H.adhere * r) clinging = false
        contact = springStep(contact, clear <= 0 || clinging ? -clear : 0, H.wallSpring, dt)
      }

      const toward = Math.atan2(drop.y - where.y, drop.x - where.x)
      const awayAngle = Math.atan2(where.y - drop.y, where.x - drop.x)
      if (filled) {
        current = {
          key: peer.key, dx: sx.x, dy: sy.x,
          shape: dented(r, where, drop, rc, 0),
          at: { angle: awayAngle, ...where },
          green: { segs: dented(greenRadius, where, drop, rc, r - greenRadius), place: { angle: awayAngle, ...where } },
        }
        return current
      }
      const shape = linked
        ? mergeSegments({ R: r, d: toDrop, rc, squeeze: 1, spread: Math.max(0, neck.x), wobble: 0, bridge: bridgePx })
        : tide.x > 0.05
          ? mergeSegments({ R: r, d: r + tide.x - rho, rc: rho, squeeze: 1, spread: 1, wobble: 0 })
          : ellipseSegs(0, r, r)
      current = {
        key: peer.key, dx: sx.x, dy: sy.x,
        shape,
        at: { angle: toward, ...where },
        green: peer.tint
          ? { segs: floating(where, drop, rc), place: { angle: awayAngle, ...where } }
          : null,
      }
      return current
    },

    frame: () => current,

    atRest: () => !linked && !clinging
      && Math.abs(sx.x) < 0.05 && Math.abs(sy.x) < 0.05 && Math.abs(sx.v) < 2 && Math.abs(sy.v) < 2
      && tide.x < 0.15 && Math.abs(tide.v) < 2
      && Math.abs(contact.x) < 0.05 && Math.abs(contact.v) < 2,
  }
}
