// A circle picked up off its spot becomes a drop the finger carries, and everything
// around it reacts like liquid:
//
//   - It lifts, and its label gets drawn up into it. That's the swallow's own label
//     animation, on a clock that starts at pickup.
//   - Moving toward or away from the centre it stretches with its speed, and jiggles back
//     to round when it stops (spring engine).
//   - Near the centre, the centre's edge rises toward it (the "tide") and the drop leans
//     in. When the rising edge touches it they fuse through a neck (metaball.ts) that
//     gloops open, and the centre draws it in a little. Pull away and the neck stretches,
//     thins and lets go, and both sides recoil.
//   - At the boundary it follows on the rubber band (boundary engine) and meets the edge
//     the way liquid meets glass (wall.ts). The touching side flattens onto the curve, wets
//     it in feet that creep along, and spreads to keep its area. Pull away and it clings
//     until it lets go and springs back round with a wobble.
//   - The other circles on screen are liquid too (peer.ts). They rise toward it, fuse with
//     it, give way when pressed, and get tugged along until the neck snaps.
//
// On release, one of two things happens. It goes in, finishing a tap's swallow from
// wherever it is: its pace and shape ease onto the swallow's (no stall, no jump in speed)
// and then the host gets handed the swallow at exactly that point (handOff). Or it springs
// home with the speed it was released at, with its label pouring back out.
//
// There's no DOM or React in here. The host feeds it the finger (move) and asks for a frame
// on every animation frame (step), and LiquidCanvas draws the result. It uses the same
// local frame as the rest of the engine: centre at the origin, drop on +x, placed at `angle`.

import { rubberBandClamp } from '../boundary-engine'
import { carriedVelocity, isAtRest, project, springStep } from '../spring-engine'
import type { Motion, Spring } from '../spring-engine'
import { SPRINGS } from '../spring-engine/springs'
import { insideOf, linkOf } from './contact'
import { clamp, easeOut, lerp, smooth, span } from './curves'
import { createEmitLabel, EMIT } from './emit'
import type { EmitTuning } from './emit'
import type { MeltShape } from './melt'
import { mergeSegments } from './metaball'
import type { MergeInput } from './metaball'
import { ellipseSegs } from './path'
import type { Seg } from './path'
import { createPeer } from './peer'
import type { HoldPeer, PeerFrame } from './peer'
import { createSwallowLabel, createSwallowTimeline, SWALLOW, swallowIconAt, swallowTimeAt } from './swallow'
import type { SwallowIcon, SwallowLabel, SwallowTimeline, SwallowTuning } from './swallow'
import type { LiquidTint } from './tint'
import { wallBody } from './wall'

interface Point { x: number; y: number }

/** All the tuning for a held drop. Distances are multiples of the drop's radius `r`. */
export interface HoldTuning {
  /** The scale it lifts to when picked up. It settles back to its own size once the centre has it. */
  readonly lift: number
  readonly liftSpring: Spring
  /** Its shape, meaning its stretch along the line to the centre, moves on this spring, so
   *  it jiggles back after being stretched, squashed or jolted. Moving toward or away from
   *  the centre stretches it by `stretchPerSpeed` per px/ms, up to `maxStretch`. These are
   *  gentler than a tap's swallow, because a finger is slower and the spring adds overshoot. */
  readonly shapeSpring: Spring
  readonly stretchPerSpeed: number
  readonly maxStretch: number
  /** Within `reach` (edge to edge) the centre feels the drop. Its edge rises by up to `tide`
   *  in a bump `tideWidth` wide, and the drop stretches toward it by up to `tidal`. The reach
   *  never exceeds `reachShare` of the circle's resting gap, so a circle that was just picked
   *  up doesn't trigger it. Bigger circles on phones rest closer. */
  readonly reach: number
  readonly reachShare: number
  readonly tide: number
  readonly tideWidth: number
  readonly tidal: number
  readonly tideSpring: Spring
  /** Once the rising edge touches it they join. The neck opens from `neckFrom` on `neckSpring`
   *  and the drop's shape gets a jolt (`snapKick`, per second). Pulled apart, the neck thins
   *  to `pinchSpread` and lets go at `bridge`. That's shorter and thicker than a pop-out's,
   *  which is moving fast. On a drop held still, a long thin neck looks like a stray stroke. */
  readonly neckFrom: number
  readonly neckSpring: Spring
  readonly snapKick: number
  readonly bridge: number
  readonly pinchSpread: number
  /** While joined, the centre draws it in by up to `draw`. */
  readonly draw: number
  readonly drawSpring: Spring
  /** Past the boundary the drop follows on the rubber band, measured against `give`. Pressed
   *  in, the whole drop squashes by `squash` of how far a round drop would have gone in. That
   *  uses the jiggly shape spring, so a fast swing splats and wobbles. Only what's left over
   *  flattens onto the edge, through a meniscus (`fillet` times the contact), wetting it by
   *  `wet` times the press (up to `maxCreep`) and fading over `wetReach` (see wall.ts). The
   *  contact moves on `wallSpring`. Pulled away, it clings until its outline is `adhere` off
   *  the edge, then lets go and springs back round. */
  readonly give: number
  readonly squash: number
  readonly wallSpring: Spring
  readonly fillet: number
  readonly wet: number
  readonly maxCreep: number
  readonly wetReach: number
  readonly adhere: number
  /** How far (times r) its label can trail behind, so a fast swing doesn't strand it. */
  readonly labelTrail: number
  /** The other circles (see peer.ts). Pressed into, one gets nudged aside by `push` times the
   *  overlap, up to `maxPush` (times r). Pulled from, a neck tugs it along by up to `tug`, all
   *  on `peerSpring`. Their greens use the boundary's settings (fillet, wet, adhere, wallSpring). */
  readonly push: number
  readonly maxPush: number
  readonly tug: number
  readonly peerSpring: Spring
  /** How far back (ms) its speed gets measured. */
  readonly velocityWindow: number
  /** Released short of the centre, it goes home on this spring. */
  readonly returnSpring: Spring
  /** Released into the centre, its pace eases onto the swallow's over about `catchUp` ms (an
   *  e-folding time). It starts from its own speed, limited to `minRate` through `maxRate`
   *  times the swallow's, with sideways drift limited to `maxDrift` radians. Its shape eases
   *  onto the swallow's over `blend` ms. */
  readonly catchUp: number
  readonly blend: number
  readonly minRate: number
  readonly maxRate: number
  readonly maxDrift: number
}

/** The default tuning, made for the original dashboard. */
export const HOLD = {
  lift: 1.08,
  liftSpring: SPRINGS.glassPress,
  shapeSpring: SPRINGS.drop,
  stretchPerSpeed: 0.25,
  maxStretch: 0.14,

  reach: 1.1,
  reachShare: 0.8,
  tide: 0.16,
  tideWidth: 0.8,
  tidal: 0.07,
  tideSpring: SPRINGS.drop,

  neckFrom: 0.12,
  neckSpring: SPRINGS.pop,
  snapKick: 1.4,
  bridge: 0.32,
  pinchSpread: 0.16,

  draw: 0.1,
  drawSpring: SPRINGS.smooth,

  give: 0.32,
  squash: 0.7,
  wallSpring: SPRINGS.drop,
  fillet: 1.1,
  wet: 0.5,
  maxCreep: 0.18,
  wetReach: 0.3,
  adhere: 0.35,
  labelTrail: 0.4,

  push: 0.4,
  maxPush: 0.3,
  tug: 0.14,
  peerSpring: SPRINGS.drop,

  velocityWindow: 80,
  returnSpring: SPRINGS.dropHome,

  catchUp: 34,
  blend: 170,
  minRate: 0.2,
  maxRate: 4,
  maxDrift: 0.35,
} as const satisfies HoldTuning

/** The stage a held drop is in. */
export type HoldPhase =
  | 'held'        // on the finger
  | 'committing'  // let go into the centre, catching up with a tap's swallow
  | 'handedOff'   // given to that swallow (`handOff`): this draws no more
  | 'returning'   // let go short of the centre, on its way home
  | 'home'        // at rest in its place (`home`): this draws no more

/** Where a drop released into the centre joins a tap's swallow. Pass these to the swallow
 *  (LiquidSwallow.carried, with start: -local). */
export interface HoldCarry {
  /** The direction it goes in from. */
  angle: number
  /** Where the swallow's distance curve starts. Its recoil peaks just past this. */
  d0: number
  /** How far into that swallow it already is, in ms. */
  local: number
}

export interface HoldEvents {
  /** It fused with the centre (true) or let go of it (false). */
  joined?(joined: boolean): void
  /** The finger let go, either into the centre (true) or not. Return false to send a drop
   *  that was going in back home instead. */
  letGo?(into: boolean): boolean | void
  /** It caught up with a tap's swallow, so start that swallow from `carry`. This hold draws
   *  nothing after this. */
  handOff?(carry: HoldCarry): void
  /** It's back at rest in its spot. End the run and restore the circle. */
  home?(): void
}

export interface HoldInput {
  /** The circle's item key (see dom.ts). */
  key: string
  /** Its resting middle and the centre circle's, in canvas px. */
  from: Point
  centre: Point
  /** The centre circle's radius and the drop's, both to their outer edges. */
  R: number
  r: number
  /** How far from the centre's middle the drop's edge can go freely. Past that it's on the
   *  rubber band. */
  bounds: number
  /** Its scale when picked up, for a press "pop". Use 1 for none. */
  s0?: number
  /** Its label's resting horizontal nudge in px, same as LiquidSwallow.labelShiftX. */
  labelShiftX?: number
  tint?: LiquidTint
  fill?: string
  /** The other circles on screen, which react to it as liquid (see peer.ts). */
  peers?: readonly HoldPeer[]
  /** Where the finger picked it up (canvas px) and when (ms, on the same clock as
   *  performance.now() and animation frames). */
  at: Point
  now: number
  tuning?: { hold?: HoldTuning; swallow?: SwallowTuning; emit?: EmitTuning }
  on?: HoldEvents
}

/** Everything drawn for a held drop in one frame. */
export interface HoldFrame {
  /** The drop's middle in canvas px. */
  x: number
  y: number
  /** Direction from the centre's middle toward it (radians), and how far. */
  angle: number
  d: number
  /** Its scale along and across the line to the centre. */
  along: number
  across: number
  /** The liquid: the centre (risen toward it), the drop and any neck, in the local frame and
   *  placed at `angle` around the centre. */
  shape: Seg[]
  /** The drop's own outline, also part of `shape`. Its fill and tint are clipped to this,
   *  because when it's flattened against the wall it's no longer an ellipse. */
  body: Seg[]
  /** The other circles: how far each has moved, and its liquid. */
  peers: PeerFrame[]
  /** How joined it is to the centre, how much of it is inside (see contact.ts), and whether
   *  it's leaving, in which case its tint buds off the band instead of reaching for it. */
  link: number
  inside: number
  outward: boolean
  icon: SwallowIcon
  label: SwallowLabel
  /** Where the label hangs from: the drop's middle a moment ago, the same way the swallow's
   *  label follows its drop. */
  labelAt: Point
  /** The melts the icon and label use right now (going in or pouring out). */
  melt: { icon: MeltShape; label: MeltShape }
}

/** A drop on a finger. Put it on a run (LiquidRun.hold) to have it drawn. */
export interface LiquidHold {
  readonly key: string
  readonly from: Point
  readonly labelShiftX: number
  readonly tint?: LiquidTint
  readonly fill?: string
  /** The other circles that react to it (see peer.ts). */
  readonly peers: readonly HoldPeer[]
  readonly phase: HoldPhase
  /** It's going, or has gone, into the centre, so it won't be visible when its run ends. */
  readonly committed: boolean
  /** Catches it again on its way home. Returns false unless it's `returning`. */
  grab(at: Point, now: number): boolean
  /** Where the finger is now, in canvas px. */
  move(at: Point, now: number): void
  /** The finger let go. Returns whether it's going in or home. */
  release(now: number): 'in' | 'home'
  /** The gesture was taken away (a system gesture, a lost pointer), so it goes home. */
  cancel(now: number): void
  /** Advances to `now` and returns the frame to draw. */
  step(now: number): HoldFrame
  /** The last frame, without advancing. */
  frame(): HoldFrame
}

/** What a drop released into the centre needs to catch up with a tap's swallow. */
interface Pull {
  timeline: SwallowTimeline
  d0: number
  /** Where on the swallow it was released (ms) and its starting pace (as a multiple of the swallow's). */
  t0: number
  rate0: number
  angle0: number
  drift: number
  since: number
  /** Its own shape when released, eased out over `blend`. */
  merge: MergeInput
  tide: number
  along: number
  across: number
}

interface Sample { t: number; x: number; y: number }

/** How long (ms) past its blend a released drop waits for a circle it was tugging to
 *  settle before handing over anyway. */
const PEER_GRACE = 220

const still = (x: number): Motion => ({ x, v: 0 })

export function createLiquidHold(input: HoldInput): LiquidHold {
  const H = input.tuning?.hold ?? HOLD
  const L = input.tuning?.swallow ?? SWALLOW
  const E = input.tuning?.emit ?? EMIT
  const { key, from, centre: c, R, r, bounds, on = {} } = input

  const dHome = Math.hypot(from.x - c.x, from.y - c.y)
  // Its own swallow's distance curve says how deep a drop at distance d is in the swallow,
  // which is how far its icon should have melted.
  const homeDistance = createSwallowTimeline({ R, r, d0: dHome, s0: 1 }, L).distance
  const labelIn = createSwallowLabel(L)
  const labelOut = createEmitLabel(E)
  const swellPx = Math.sqrt(R * R + L.swell * r * r) - R
  const bridgePx = H.bridge * r
  const rho = H.tideWidth * r
  const reach = Math.max(1, Math.min(H.reach * r, H.reachShare * (dHome - R - r)))
  const inEnd = Math.max(L.label.suck, L.label.fadeTo)
  const peerList = input.peers ?? []
  const peers = peerList.map(peer => createPeer(peer, { r, hold: H, swallow: L, emit: E }))
  const peersAtRest = () => peers.every(peer => peer.atRest())

  let phase: HoldPhase = 'held'
  let last = input.now
  // The point it was grabbed by stays under the finger.
  let offset: Point = { x: from.x - input.at.x, y: from.y - input.at.y }
  let finger: Point = { ...from }
  let pos: Point = { ...from }
  let vel: Point = { x: 0, y: 0 }
  let homeX = still(from.x)
  let homeY = still(from.y)
  let scale = still(input.s0 ?? 1)
  let shape = still(0)
  let tide = still(0)
  let neck = still(0)
  let drawn = still(0)
  // Contact with the boundary in px. Positive is pressed in, negative is clinging.
  let wall = still(0)
  let clinging = false
  let linked = false
  let angle = Math.atan2(from.y - c.y, from.x - c.x)
  let label: { mode: 'in' | 'back' | 'pour'; at: number } = { mode: 'in', at: 0 }
  let trail: Sample[] = [{ t: input.now, ...from }]
  let pull: Pull | null = null
  let lastMerge: MergeInput = { R, d: dHome, rc: r, squeeze: 1, spread: 0, wobble: 0 }
  let current: HoldFrame

  /** Where the drop was at time `t`, from the frames drawn. */
  const posAt = (t: number): Point => {
    if (t <= trail[0].t) return trail[0]
    for (let i = trail.length - 1; i > 0; i--) {
      const a = trail[i - 1]
      const b = trail[i]
      if (t >= a.t) {
        const k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t)) : 1
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }
      }
    }
    return trail[0]
  }

  const remember = (now: number) => {
    const tail = trail[trail.length - 1]
    if (tail.t === now) trail[trail.length - 1] = { t: now, ...pos }
    else trail.push({ t: now, ...pos })
    const keep = now - Math.max(H.velocityWindow, L.label.lag) - 60
    while (trail.length > 2 && trail[1].t < keep) trail = trail.slice(1)
  }

  /** Its speed over the last `velocityWindow`, in px/s. */
  const trailVelocity = (now: number): Point => {
    const window = Math.min(H.velocityWindow, now - trail[0].t)
    if (window < 8) return { x: 0, y: 0 }
    const past = posAt(now - window)
    return { x: ((pos.x - past.x) * 1000) / window, y: ((pos.y - past.y) * 1000) / window }
  }

  /** The centre risen toward the drop by `h` px. This is a phantom drop surfacing inside it,
   *  fused at full spread, which makes a smooth swell. Nothing at h <= 0. */
  const tideSegs = (Rt: number, h: number): Seg[] =>
    h > 0.05 ? mergeSegments({ R: Rt, d: Rt + h - rho, rc: rho, squeeze: 1, spread: 1, wobble: 0 }) : []

  /** The label: going in on the swallow's animation, back out the same way, or pouring out
   *  like a pop-out's. */
  const labelFrame = (): { label: SwallowLabel; melt: MeltShape } =>
    label.mode === 'pour'
      ? { label: labelOut(label.at), melt: E.label.melt }
      : { label: labelIn(label.at), melt: L.label.melt }

  const tickLabel = (dtMs: number) => {
    if (label.mode === 'in') label = { mode: 'in', at: Math.min(inEnd, label.at + dtMs) }
    else if (label.mode === 'back') label = { mode: 'back', at: Math.max(0, label.at - dtMs) }
    else label = { mode: 'pour', at: Math.min(E.label.to, label.at + dtMs) }
  }
  const labelSettled = () =>
    (label.mode === 'back' && label.at <= 0) || (label.mode === 'pour' && label.at >= E.label.to)

  /** While held or heading home, the liquid reacts to wherever the drop is. */
  const answer = (now: number, dt: number): HoldFrame => {
    const dx = pos.x - c.x
    const dy = pos.y - c.y
    const d = Math.hypot(dx, dy)
    if (d > 1e-6) angle = Math.atan2(dy, dx)
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    const vRad = vel.x * ux + vel.y * uy

    // The centre swells by what it's taken in, same as in the swallow.
    const absorbed = clamp((R + r - d) / (2 * r))
    const Rt = R + swellPx * absorbed
    const gap = d - Rt - r * scale.x * (1 + shape.x)

    if (!linked && gap <= Math.max(0, tide.x) + 0.5) {
      // The rising edge touched it, so now it's one liquid with the neck glooping open.
      linked = true
      neck = still(H.neckFrom)
      shape = { x: shape.x, v: shape.v + H.snapKick }
      on.joined?.(true)
    } else if (linked && gap >= bridgePx) {
      // Stretched too far: the neck lets go and both sides spring back.
      linked = false
      tide = still(H.tide * r)
      shape = { x: shape.x, v: shape.v - H.snapKick * 0.6 }
      on.joined?.(false)
    }

    const near = gap <= 0 ? 1 : smooth(clamp(1 - gap / reach))
    if (linked) {
      const target = gap > 0
        ? H.pinchSpread + (E.spread - H.pinchSpread) * (1 - clamp(gap / bridgePx)) ** 1.5
        : Math.max(E.spread, L.spread * easeOut(clamp(-gap / (L.neckRamp * r))))
      neck = springStep(neck, target, H.neckSpring, dt)
    }
    tide = springStep(tide, linked ? 0 : H.tide * r * near, H.tideSpring, dt)
    // The boundary: pressed into it, or clinging as it's pulled away after touching. Once its
    // outline is `adhere` off the edge it lets go and springs back round.
    const clear = bounds - (d + r * scale.x * (1 + shape.x))
    if (clear <= 0) clinging = phase === 'held' || phase === 'returning'
    else if (clinging && clear >= H.adhere * r) clinging = false
    wall = springStep(wall, clear <= 0 || clinging ? -clear : 0, H.wallSpring, dt)
    // How far a round drop would be into the wall. The drop takes most of that by squashing as
    // a whole, like liquid does, instead of being cut flat.
    const sunk = Math.max(0, d + r * scale.x - bounds) / r
    const moving = clamp((Math.abs(vRad) / 1000) * H.stretchPerSpeed, 0, H.maxStretch)
    shape = springStep(shape, (moving + H.tidal * near - H.squash * sunk) * (1 - absorbed), H.shapeSpring, dt)
    scale = springStep(scale, phase === 'held' && !linked ? H.lift : 1, H.liftSpring, dt)

    const sa = 1 + shape.x
    let along = scale.x * sa
    let across = scale.x / sa
    const rc = r * along
    lastMerge = {
      R: Rt, d, rc, squeeze: across / along, spread: linked ? Math.max(0, neck.x) : 0, wobble: 0,
      bridge: linked ? bridgePx : 0,
    }

    // Its own outline: round, or flattened onto the boundary's curve.
    let body = ellipseSegs(d, rc, r * across)
    let middle = d
    let inner = r * Math.min(along, across)
    if (!linked && Math.abs(wall.x) > 0.05) {
      const flat = wallBody({
        d, along: rc, across: r * across, wall: bounds, press: wall.x, stick: -wall.x,
        fillet: H.fillet, wet: H.wet, maxCreep: H.maxCreep * r, wetReach: H.wetReach * r,
      })
      body = flat.segs
      middle = flat.d
      along = flat.along / r
      across = flat.across / r
      inner = flat.inner
    }
    const centred = { x: c.x + ux * middle, y: c.y + uy * middle }
    const { label: lbl, melt } = labelFrame()
    return {
      ...centred,
      angle,
      d: middle,
      along,
      across,
      shape: linked
        ? [...tideSegs(Rt, tide.x), ...mergeSegments(lastMerge)]
        : [...(tide.x > 0.05 ? tideSegs(Rt, tide.x) : ellipseSegs(0, Rt, Rt)), ...body],
      body,
      peers: peers.map(peer => peer.step(centred, inner, dt)),
      link: linkOf({ R: Rt, d, rc, attached: linked, bridge: linked ? bridgePx : 0 }),
      inside: insideOf(R, d, rc),
      outward: phase === 'returning',
      icon: swallowIconAt(swallowTimeAt(homeDistance, d, L), L),
      label: lbl,
      labelAt: label.mode === 'pour' ? { ...pos } : trailing(now),
      melt: { icon: L.icon.melt, label: melt },
    }
  }

  /** Where the label hangs from: where the drop was a moment ago, but never further back than
   *  `labelTrail`, or a fast swing would strand it. */
  const trailing = (now: number): Point => {
    const behind = posAt(now - L.label.lag)
    const dx = behind.x - pos.x
    const dy = behind.y - pos.y
    const far = Math.hypot(dx, dy)
    const most = H.labelTrail * r
    return far <= most ? behind : { x: pos.x + (dx * most) / far, y: pos.y + (dy * most) / far }
  }

  /** Released into the centre: on the swallow's curve from here, at its own speed at first. */
  const pullFrame = (now: number, dt: number, p: Pull): HoldFrame => {
    const tau = now - p.since
    const fade = Math.exp(-tau / H.catchUp)
    const local = p.t0 + tau + (p.rate0 - 1) * H.catchUp * (1 - fade)
    angle = p.angle0 + p.drift * (1 - fade)
    const sf = p.timeline(local)
    const b = smooth(span(tau, 0, H.blend))
    const merge: MergeInput = {
      R: lerp(p.merge.R, sf.merge.R, b),
      d: sf.d,
      rc: lerp(p.merge.rc, sf.merge.rc, b),
      squeeze: lerp(p.merge.squeeze, sf.merge.squeeze, b),
      spread: lerp(p.merge.spread, sf.merge.spread, b),
      wobble: sf.merge.wobble * b,
      bridge: (p.merge.bridge ?? 0) * (1 - b),
      maxBase: sf.merge.maxBase,
      handle: sf.merge.handle,
    }
    pos = { x: c.x + sf.d * Math.cos(angle), y: c.y + sf.d * Math.sin(angle) }
    const attached = sf.d > merge.R - merge.rc && sf.d < merge.R + merge.rc + (merge.bridge ?? 0)
    const { label: lbl, melt } = labelFrame()
    const along = lerp(p.along, sf.along, b)
    const across = lerp(p.across, sf.across, b)
    const frame: HoldFrame = {
      x: pos.x,
      y: pos.y,
      angle,
      d: sf.d,
      along,
      across,
      shape: [...tideSegs(merge.R, p.tide * (1 - b)), ...mergeSegments(merge)],
      body: ellipseSegs(sf.d, merge.rc, merge.rc * merge.squeeze),
      // The other circles let go of it as it's drawn away.
      peers: peers.map(peer => peer.step(pos, r * Math.min(along, across), dt)),
      link: linkOf({ R: merge.R, d: sf.d, rc: merge.rc, attached, bridge: merge.bridge ?? 0 }),
      inside: insideOf(R, sf.d, merge.rc),
      outward: false,
      icon: sf.icon,
      label: lbl,
      labelAt: trailing(now),
      melt: { icon: L.icon.melt, label: melt },
    }
    // Caught up: its pace, shape and label now match the swallow's, so the swallow takes over
    // from exactly here. A circle it was tugging gets a moment to settle, but can't hold the
    // swallow up for long.
    const caughtUp = tau >= Math.max(H.blend, 5 * H.catchUp) && label.at >= L.label.suck
    if (caughtUp && (peersAtRest() || tau >= H.blend + PEER_GRACE)) {
      phase = 'handedOff'
      on.handOff?.({ angle, d0: p.d0, local })
    }
    return frame
  }

  /** At rest in its spot: exactly what the host's own circle shows. */
  const restFrame = (): HoldFrame => {
    const home = { x: from.x, y: from.y }
    return {
      ...home,
      angle: Math.atan2(from.y - c.y, from.x - c.x),
      d: dHome,
      along: 1,
      across: 1,
      shape: mergeSegments({ R, d: dHome, rc: r, squeeze: 1, spread: 0, wobble: 0 }),
      body: ellipseSegs(dHome, r, r),
      peers: peers.map(peer => peer.frame()),
      link: 0,
      inside: 0,
      outward: false,
      icon: { scale: 1, melt: 0, opacity: 1 },
      label: labelIn(0),
      labelAt: home,
      melt: { icon: L.icon.melt, label: L.label.melt },
    }
  }

  const advance = (now: number): HoldFrame => {
    const dt = clamp((now - last) / 1000, 0, 1 / 15)
    last = Math.max(last, now)
    tickLabel(dt * 1000)

    if (phase === 'committing' && pull) {
      current = pullFrame(now, dt, pull)
      remember(now)
      vel = trailVelocity(now)
      return current
    }

    if (phase === 'held') {
      // Free inside the bounds. Past them, it's on the rubber band.
      const dx = finger.x - c.x
      const dy = finger.y - c.y
      const dRaw = Math.hypot(dx, dy)
      const ux = dRaw > 1e-6 ? dx / dRaw : Math.cos(angle)
      const uy = dRaw > 1e-6 ? dy / dRaw : Math.sin(angle)
      const dMax = Math.max(0, bounds - r * scale.x)
      const give = H.give * r
      const dBound = rubberBandClamp(dRaw, 0, dMax, give)
      // While joined, the centre draws it in a little.
      drawn = springStep(drawn, linked ? H.draw * r : 0, H.drawSpring, dt)
      const d = Math.max(0, dBound - drawn.x)
      pos = { x: c.x + ux * d, y: c.y + uy * d }
      remember(now)
      vel = trailVelocity(now)
    } else {
      homeX = springStep(homeX, from.x, H.returnSpring, dt)
      homeY = springStep(homeY, from.y, H.returnSpring, dt)
      pos = { x: homeX.x, y: homeY.x }
      vel = { x: homeX.v, y: homeY.v }
      remember(now)
    }

    current = answer(now, dt)

    if (phase === 'returning') {
      const settled = isAtRest(homeX, from.x) && isAtRest(homeY, from.y)
        && Math.abs(scale.x - 1) < 0.002 && Math.abs(scale.v) < 0.05
        && Math.abs(shape.x) < 0.002 && Math.abs(shape.v) < 0.05
        && tide.x < 0.15 && Math.abs(tide.v) < 2
        && Math.abs(wall.x) < 0.05 && Math.abs(wall.v) < 2 && !clinging
        && !linked && labelSettled() && peersAtRest()
      if (settled) {
        phase = 'home'
        current = restFrame()
        on.home?.()
      }
    }
    return current
  }

  const goHome = () => {
    const speed = Math.hypot(vel.x, vel.y)
    const keep = speed > 0 ? Math.abs(carriedVelocity(speed)) / speed : 0
    homeX = { x: pos.x, v: vel.x * keep }
    homeY = { x: pos.y, v: vel.y * keep }
    drawn = still(0)
    phase = 'returning'
    label = label.at >= L.label.suck ? { mode: 'pour', at: E.label.from } : { mode: 'back', at: label.at }
  }

  const goIn = (now: number) => {
    const d = current.d
    const ux = Math.cos(current.angle)
    const uy = Math.sin(current.angle)
    const vIn = -(vel.x * ux + vel.y * uy) / 1000
    const omega = d > 1 ? (ux * vel.y - uy * vel.x) / 1000 / d : 0
    // Use its own swallow, or if it was released further out than its home spot, one that
    // starts where it is (the recoil's peak is the only point where the curve is at rest).
    const d0 = Math.max(dHome, d - L.recoilPx)
    const timeline = createSwallowTimeline({ R, r, d0, s0: 1 }, L)
    const t0 = swallowTimeAt(timeline.distance, d, L)
    const pace = (timeline.distance(t0 - 1) - timeline.distance(t0 + 1)) / 2
    const rate0 = pace > 1e-3 ? clamp(vIn / pace, H.minRate, H.maxRate) : vIn > 0 ? H.maxRate : H.minRate
    pull = {
      timeline, d0, t0, rate0,
      angle0: current.angle,
      drift: clamp(omega * H.catchUp, -H.maxDrift, H.maxDrift),
      since: now,
      merge: lastMerge,
      tide: Math.max(0, tide.x),
      along: current.along,
      across: current.across,
    }
    phase = 'committing'
    clinging = false
    label = { mode: 'in', at: label.at }
  }

  current = advance(input.now)

  return {
    key,
    from,
    labelShiftX: input.labelShiftX ?? 0,
    tint: input.tint,
    fill: input.fill,
    peers: peerList,
    get phase() { return phase },
    get committed() { return phase === 'committing' || phase === 'handedOff' },

    grab(at, now) {
      if (phase !== 'returning') return false
      phase = 'held'
      offset = { x: pos.x - at.x, y: pos.y - at.y }
      finger = { ...pos }
      last = Math.max(last, now)
      label = label.mode === 'pour'
        ? { mode: 'in', at: L.label.suck * (1 - span(label.at, E.label.from, E.label.to)) }
        : { mode: 'in', at: label.at }
      return true
    },

    move(at) {
      if (phase === 'held') finger = { x: at.x + offset.x, y: at.y + offset.y }
    },

    release(now) {
      if (phase !== 'held') return phase === 'committing' || phase === 'handedOff' ? 'in' : 'home'
      const rc = r * scale.x
      const projected = Math.hypot(project(pos.x, vel.x) - c.x, project(pos.y, vel.y) - c.y)
      const gapNow = current.d - R - rc
      const gapThen = projected - R - rc
      // It goes in if it's touching the centre, was flicked at it, or is joined and still heading in.
      let into = gapNow <= 0 || gapThen <= 0 || (linked && gapThen < gapNow)
      if (on.letGo?.(into) === false) into = false
      if (into) goIn(now)
      else goHome()
      return into ? 'in' : 'home'
    },

    cancel() {
      if (phase !== 'held') return
      on.letGo?.(false)
      goHome()
    },

    step(now) {
      if (phase === 'handedOff' || phase === 'home') return current
      return advance(now)
    },

    frame() { return current },
  }
}
