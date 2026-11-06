import { describe, it, expect, vi } from 'vitest'
import {
  createEmitLabel, createLiquidHold, createSwallowLabel, createSwallowTimeline, ellipseSegs, EMIT, formatPath, HOLD,
  SWALLOW, swallowTimeAt,
} from '../index'
import type { HoldEvents, HoldFrame, LiquidHold, Seg } from '../index'

// Dragging a circle to the centre, as plain numbers. The drop follows the finger, the centre rises
// and fuses with it, and the boundary holds it on the rubber band. On release it either finishes a
// tap's swallow from where it is, handing over at exactly the swallow's own frame, or it springs home
// and comes to rest exactly in its spot.

const R = 150
const r = 45
const C = { x: 396, y: 396 }
const HOME = { x: 396, y: 396 - 255 }
const BOUNDS = 352
const FRAME = 16

/** Points straight down from home toward the centre, `d` from the centre's middle. */
const onAxis = (d: number) => ({ x: C.x, y: C.y - d })

function makeHold(on: HoldEvents = {}, at = HOME) {
  return createLiquidHold({ key: 'a', from: HOME, centre: C, R, r, bounds: BOUNDS, labelShiftX: 0, at, now: 0, on })
}

/** Moves the finger to each point in turn, one frame apart, then holds it there for `rest` ms. */
function drag(hold: LiquidHold, clock: { t: number }, points: { x: number; y: number }[], rest = 0): HoldFrame {
  for (const p of points) {
    clock.t += FRAME
    hold.move(p, clock.t)
    hold.step(clock.t)
  }
  return settle(hold, clock, rest)
}

function settle(hold: LiquidHold, clock: { t: number }, ms: number): HoldFrame {
  let frame = hold.frame()
  for (let left = ms; left > 0; left -= FRAME) {
    clock.t += FRAME
    frame = hold.step(clock.t)
  }
  return frame
}

/** A straight line of `n` finger positions from `a` to `b`. */
const line = (a: { x: number; y: number }, b: { x: number; y: number }, n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }))

/** How far the shape reaches along +x between the centre and the drop: the centre's own edge. */
function centreReach(shape: Seg[], dropNear: number): number {
  const xs: number[] = []
  for (const seg of shape) {
    const end = seg[0] === 'M' ? seg[1] : seg[0] === 'C' ? seg[3] : seg[0] === 'A' ? seg[3] : null
    if (end && Math.abs(end[1]) < 1e-6 && end[0] > 0 && end[0] < dropNear) xs.push(end[0])
  }
  return Math.max(...xs)
}

describe('a held drop', () => {
  it('follows the finger, keeping the point it was picked up by under it', () => {
    const clock = { t: 0 }
    const grip = { x: HOME.x + 10, y: HOME.y + 5 }
    const hold = makeHold({}, grip)
    const f = drag(hold, clock, line(grip, { x: grip.x - 70, y: grip.y - 20 }, 6))
    expect(f.x).toBeCloseTo(HOME.x - 70, 6)
    expect(f.y).toBeCloseTo(HOME.y - 20, 6)
  })

  it('lifts, and draws its label up into it with a tap’s own animation', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    const f = drag(hold, clock, [{ x: HOME.x - 20, y: HOME.y }], 160 - FRAME)
    const tap = createSwallowLabel(SWALLOW)(160)
    for (const k of Object.keys(tap) as (keyof typeof tap)[]) expect(f.label[k]).toBeCloseTo(tap[k], 6)
    expect(f.melt.label).toBe(SWALLOW.label.melt)
    expect(f.along * f.across).toBeGreaterThan(1.08 ** 2 * 0.99) // lifted (area kept by the stretch)
  })

  it('makes the centre rise toward it when it comes near, before they touch', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    const far = drag(hold, clock, [onAxis(250)], 400)
    expect(centreReach(far.shape, far.d - r * far.along - 0.5)).toBeCloseTo(R, 6)

    const near = drag(hold, clock, line(onAxis(250), onAxis(R + r * HOLD.lift + 20), 6), 500)
    expect(near.link).toBe(0)
    expect(centreReach(near.shape, near.d - r * near.along - 0.5)).toBeGreaterThan(R + 2)
  })

  it('fuses when the rising edge touches it, and lets go only once pulled well apart', () => {
    const joined = vi.fn()
    const clock = { t: 0 }
    const hold = makeHold({ joined })
    drag(hold, clock, line(HOME, onAxis(R + r + 3), 8), 300)
    expect(joined).toHaveBeenLastCalledWith(true)
    expect(hold.frame().link).toBeGreaterThan(0)

    // Pulled back out a little: the neck stretches but holds.
    drag(hold, clock, [onAxis(R + r + HOLD.bridge * r * 0.5)], 200)
    expect(joined).toHaveBeenCalledTimes(1)

    // Pulled well apart: it lets go.
    drag(hold, clock, line(onAxis(R + r + 12), onAxis(R + r + HOLD.bridge * r * 2.5), 4), 100)
    expect(joined).toHaveBeenLastCalledWith(false)
    expect(hold.frame().link).toBe(0)
  })

  it('follows on the rubber band past the boundary, flattening against it', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    const f = drag(hold, clock, line(HOME, { x: HOME.x, y: HOME.y - 400 }, 10), 800)
    const edge = f.d + r * f.along
    expect(f.d).toBeGreaterThan(BOUNDS - r * HOLD.lift)
    expect(edge).toBeLessThan(BOUNDS + HOLD.give * r + 1)
    expect(f.along).toBeLessThan(f.across)
  })
})

describe('a held drop at the boundary and beside other circles', () => {
  /** Every on-curve point of an outline. */
  const ends = (segs: Seg[]) =>
    segs.flatMap(seg => (seg[0] === 'M' ? [seg[1]] : seg[0] === 'C' ? [seg[3]] : seg[0] === 'A' ? [seg[3]] : []))
  const outwards = (k: number) => ({ x: HOME.x, y: HOME.y - k })

  it('never crosses the boundary, however far the finger goes', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    for (const past of [60, 150, 400]) {
      const f = drag(hold, clock, line(hold.frame(), outwards(past), 6), 300)
      for (const [x] of ends(f.body)) expect(x).toBeLessThanOrEqual(BOUNDS + 1e-6)
    }
  })

  it('clings to the boundary as it is pulled away, then lets go and springs back round', () => {
    const reach = (f: HoldFrame) => Math.max(...ends(f.body).map(([x]) => x))
    // Just off the boundary (its own edge ~8px short of it), having pressed it:
    const clock = { t: 0 }
    const touched = makeHold()
    drag(touched, clock, line(HOME, outwards(140), 8), 300)
    const clinging = drag(touched, clock, line(outwards(140), outwards(40), 6), 800)
    // …the same place, never having touched it:
    const other = { t: 0 }
    const untouched = makeHold()
    const apart = drag(untouched, other, line(HOME, outwards(40), 6), 300)
    expect(reach(apart)).toBeLessThan(BOUNDS - 4)
    expect(reach(clinging)).toBeGreaterThan(BOUNDS - 1)
    // Further off, it lets go.
    const free = drag(touched, clock, line(outwards(40), outwards(0), 6), 600)
    expect(reach(free)).toBeLessThan(BOUNDS - 30)
  })

  it('is joined to a circle beside it without poking past its own side flattened on the boundary', () => {
    const clock = { t: 0 }
    const beside = { x: HOME.x + 140, y: HOME.y - 60 }
    const hold = createLiquidHold({
      key: 'a', from: HOME, centre: C, R, r, bounds: BOUNDS, labelShiftX: 0, at: HOME, now: 0,
      peers: [{ key: 'b', at: beside, labelShiftX: 0 }],
    })
    // Out against the boundary, right beside the other circle.
    const f = drag(hold, clock, line(HOME, { x: HOME.x + 75, y: HOME.y - 120 }, 10), 1500)
    const pf = f.peers[0]
    expect(pf.shape.filter(seg => seg[0] === 'M')).toHaveLength(1) // fused
    // The drop's circle in the joined shape (drawn round the other circle, the
    // drop on +x): its far edge, along the line between the two.
    const dist = Math.hypot(f.x - pf.at.x, f.y - pf.at.y)
    const far = Math.max(...pf.shape.flatMap(seg => (seg[0] === 'A' ? [seg[3][0]] : [])))
    const dropRadius = far - dist
    // Placed, the drop's own outline: nowhere closer to its middle than that circle reaches.
    const cos = Math.cos(f.angle)
    const sin = Math.sin(f.angle)
    const outline = ends(f.body).map(([x, y]) => [C.x + x * cos - y * sin, C.y + x * sin + y * cos])
    const nearest = Math.min(...outline.map(([x, y]) => Math.hypot(x - f.x, y - f.y)))
    expect(dropRadius).toBeLessThanOrEqual(nearest + 1e-6)
  })

  it('carries the other circles with it: they answer it, then settle home before it does', () => {
    const home = vi.fn()
    const clock = { t: 0 }
    const beside = { x: HOME.x + 170, y: HOME.y }
    const hold = createLiquidHold({
      key: 'a', from: HOME, centre: C, R, r, bounds: BOUNDS, labelShiftX: 0, at: HOME, now: 0, on: { home },
      peers: [{ key: 'b', at: beside, labelShiftX: 0 }],
    })
    expect(hold.peers.map(p => p.key)).toEqual(['b'])
    // Pressed into it: it fuses and gives way.
    const pressed = drag(hold, clock, line(HOME, { x: beside.x - 70, y: beside.y }, 10), 300)
    expect(pressed.peers[0].shape.length).toBeGreaterThan(0)
    expect(pressed.peers[0].dx).toBeGreaterThan(1)
    hold.release(clock.t)
    settle(hold, clock, 3000)
    expect(home).toHaveBeenCalledTimes(1)
    expect(hold.frame().peers[0].dx).toBeCloseTo(0, 1)
    expect(hold.frame().peers[0].shape).toEqual(ellipseSegs(0, r, r))
  })
})

describe('a held drop, let go', () => {
  it('into the centre: catches up with a tap’s swallow and hands over at exactly its frame', () => {
    const letGo = vi.fn(() => true)
    const handOff = vi.fn()
    const clock = { t: 0 }
    const hold = makeHold({ letGo, handOff })
    drag(hold, clock, line(HOME, onAxis(175), 10), 300)
    expect(hold.release(clock.t)).toBe('in')
    expect(letGo).toHaveBeenCalledWith(true)
    expect(hold.committed).toBe(true)

    let frame = hold.frame()
    for (let i = 0; i < 60 && !handOff.mock.calls.length; i++) {
      clock.t += FRAME
      frame = hold.step(clock.t)
    }
    expect(handOff).toHaveBeenCalledTimes(1)
    const carry = handOff.mock.calls[0][0]
    const tap = createSwallowTimeline({ R, r, d0: carry.d0, s0: 1 })(carry.local)
    expect(formatPath(frame.shape)).toBe(tap.outline)
    expect(frame.d).toBeCloseTo(tap.d, 9)
    expect(frame.along).toBeCloseTo(tap.along, 9)
    expect(frame.icon).toEqual(tap.icon)
    expect(carry.angle).toBeCloseTo(-Math.PI / 2, 6)
    expect(hold.phase).toBe('handedOff')
    // It draws nothing more.
    expect(hold.step(clock.t + 100)).toBe(frame)
  })

  it('carries the speed it was let go at into the swallow — no stall, no jump to its pace', () => {
    const clock = { t: 0 }
    const hold = makeHold({ letGo: () => true })
    // Steadily in, 2px a frame, overlapping the centre when let go.
    drag(hold, clock, line(onAxis(255), onAxis(R + r - 6), 300), 300)
    drag(hold, clock, line(onAxis(R + r - 6), onAxis(R + r - 26), 10))
    const before = hold.frame().d
    hold.release(clock.t)
    clock.t += FRAME
    const after = hold.step(clock.t).d
    // A tap's swallow passing the same point moves this far in a frame.
    const tap = createSwallowTimeline({ R, r, d0: 255, s0: 1 })
    const t0 = swallowTimeAt(tap.distance, before)
    const tapStep = tap.distance(t0) - tap.distance(t0 + FRAME)
    expect(tapStep).toBeGreaterThan(3)
    expect(before - after).toBeGreaterThan(1.4)
    expect(before - after).toBeLessThan(tapStep * 0.85)
  })

  it('goes in when flicked at the centre, though let go short of it', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    drag(hold, clock, line(HOME, onAxis(235), 2))
    expect(hold.frame().link).toBe(0)
    expect(hold.release(clock.t)).toBe('in')
  })

  it('short of the centre: springs home and comes to rest exactly in its place', () => {
    const letGo = vi.fn()
    const home = vi.fn()
    const clock = { t: 0 }
    const hold = makeHold({ letGo, home })
    drag(hold, clock, line(HOME, { x: HOME.x + 60, y: HOME.y + 40 }, 6), 400)
    expect(hold.release(clock.t)).toBe('home')
    expect(letGo).toHaveBeenCalledWith(false)
    expect(hold.committed).toBe(false)

    let frame = hold.frame()
    for (let i = 0; i < 200 && !home.mock.calls.length; i++) {
      clock.t += FRAME
      frame = hold.step(clock.t)
    }
    expect(home).toHaveBeenCalledTimes(1)
    expect(hold.phase).toBe('home')
    expect(frame.x).toBe(HOME.x)
    expect(frame.y).toBe(HOME.y)
    expect(frame.along).toBe(1)
    expect(frame.across).toBe(1)
    expect(frame.icon).toEqual({ scale: 1, melt: 0, opacity: 1 })
    expect(frame.label).toEqual(createSwallowLabel(SWALLOW)(0))
  })

  it('pours its label back out on the way home, once it had gone all the way in', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    drag(hold, clock, [{ x: HOME.x + 60, y: HOME.y }], 400)
    hold.release(clock.t)
    const f = settle(hold, clock, 160)
    expect(f.melt.label).toBe(EMIT.label.melt)
    const pour = createEmitLabel(EMIT)(EMIT.label.from + 160)
    expect(f.label.opacity).toBeCloseTo(pour.opacity, 6)
    expect(f.label.suck).toBeCloseTo(pour.suck, 6)
  })

  it('can be caught again on its way home, without a jump', () => {
    const clock = { t: 0 }
    const hold = makeHold()
    drag(hold, clock, line(HOME, { x: HOME.x + 90, y: HOME.y + 30 }, 6), 200)
    hold.release(clock.t)
    const flying = settle(hold, clock, 64)
    const finger = { x: flying.x - 4, y: flying.y + 3 }
    expect(hold.grab(finger, clock.t)).toBe(true)
    expect(hold.phase).toBe('held')
    clock.t += FRAME
    hold.move(finger, clock.t)
    const caught = hold.step(clock.t)
    expect(Math.hypot(caught.x - flying.x, caught.y - flying.y)).toBeLessThan(0.01)
  })

  it('goes home when the host refuses it', () => {
    const clock = { t: 0 }
    const hold = makeHold({ letGo: () => false })
    drag(hold, clock, line(HOME, onAxis(170), 10), 200)
    expect(hold.release(clock.t)).toBe('home')
    expect(hold.phase).toBe('returning')
  })
})
