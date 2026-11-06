import { describe, it, expect } from 'vitest'
import { createPeer, ellipseSegs, EMIT, HOLD, SWALLOW } from '../index'
import type { PeerFrame, Seg } from '../index'

// Another circle next to a held drop reacts like liquid: it rises toward it, fuses with it, gives way
// when pressed, gets tugged along by the neck, snaps, and settles back exactly in its spot.

const r = 45
const AT = { x: 400, y: 400 }
const FRAME = 1 / 60
const ENV = { r, hold: HOLD, swallow: SWALLOW, emit: EMIT }

const peer = () => createPeer({ key: 'b', at: AT, labelShiftX: 0 }, ENV)

/** The held drop `gap` px from the peer's edge, along +x. */
const dropAt = (gap: number) => ({ x: AT.x + r + r + gap, y: AT.y })

function hold(p: ReturnType<typeof peer>, gap: number, frames = 30): PeerFrame {
  let f = p.frame()
  for (let i = 0; i < frames; i++) f = p.step(dropAt(gap), r, FRAME)
  return f
}

/** Whether the outline joins the two circles: one closed shape, not two. */
const subpaths = (segs: Seg[]) => segs.filter(s => s[0] === 'M').length

describe('a circle beside a held drop', () => {
  it('is just itself while the held drop is far', () => {
    const p = peer()
    const f = hold(p, 3 * r)
    expect(f.shape).toEqual(ellipseSegs(0, r, r))
    expect(f.dx).toBe(0)
    expect(p.atRest()).toBe(true)
  })

  it('rises toward it as it comes near, before they touch', () => {
    const f = hold(peer(), 0.6 * r)
    expect(f.shape.length).toBeGreaterThan(0)
    // The rise: its outline reaches past its own edge toward the drop.
    const reach = Math.max(...f.shape.flatMap(s => (s[0] === 'A' ? [s[3][0]] : [])))
    expect(reach).toBeGreaterThan(r + 1)
    expect(reach).toBeLessThan(r + 0.6 * r)
  })

  it('fuses with it on touching — one shape — and is nudged aside when pressed into', () => {
    const p = peer()
    const touching = hold(p, 2)
    expect(subpaths(touching.shape)).toBe(1)
    const pressed = hold(p, -0.4 * r, 60)
    // The drop is to its right, so it gives way to the left, by at most maxPush.
    expect(pressed.dx).toBeLessThan(-2)
    expect(pressed.dx).toBeGreaterThan(-HOLD.maxPush * r - 1)
  })

  it('a circle its green fills dents as ONE green drop — no round body left behind — and comes back round', () => {
    const green = createPeer({ key: 'g', at: AT, labelShiftX: 0, tint: { color: '#2e7d32', alpha: 0.28, size: 1 } }, ENV)
    const dentedBody = hold(green, -0.5 * r, 90)
    // No neck into a different liquid here: its own body, dented like its green.
    expect(dentedBody.shape.some(seg => seg[0] === 'C')).toBe(true)
    expect(dentedBody.shape.some(seg => seg[0] === 'A')).toBe(false)
    hold(green, 4 * r, 300)
    expect(green.atRest()).toBe(true)
    expect(green.frame().shape).toEqual(ellipseSegs(0, r, r))
  })

  it('keeps its green out of the held drop, as the drop keeps off the boundary — and lets it come back round', () => {
    const green = createPeer({ key: 'g', at: AT, labelShiftX: 0, tint: { color: '#2e7d32', alpha: 0.28, size: 1 } }, ENV)
    const pressed = hold(green, -0.5 * r, 90)
    const g = pressed.green!
    // Placed at the circle, with its +x pointing away from the held drop (on its -x side), nothing of
    // the green reaches past where the drop's own circle begins.
    const drop = dropAt(-0.5 * r)
    const dist = Math.hypot(drop.x - g.place.x, drop.y - g.place.y)
    const nearest = Math.min(...g.segs.flatMap(seg => (seg[0] === 'C' ? [seg[3]] : seg[0] === 'M' ? [seg[1]] : []))
      .map(([x, y]) => Math.hypot(x + dist, y)))
    expect(nearest).toBeGreaterThan(r - 1)
    hold(green, 4 * r, 300)
    expect(green.atRest()).toBe(true)
    expect(green.frame().green!.segs).toEqual(ellipseSegs(0, r - 2, r - 2))
  })

  it('is tugged along by the stretching neck, which snaps past the bridge, and settles home', () => {
    const p = peer()
    hold(p, 0)
    const tugged = hold(p, HOLD.bridge * r * 0.8, 40)
    expect(subpaths(tugged.shape)).toBe(1)
    expect(tugged.dx).toBeGreaterThan(1)

    const snapped = hold(p, HOLD.bridge * r * 3, 4)
    expect(subpaths(snapped.shape)).toBeLessThanOrEqual(1)
    hold(p, 4 * r, 240)
    expect(p.atRest()).toBe(true)
    expect(p.frame().dx).toBeCloseTo(0, 1)
    expect(p.frame().shape).toEqual(ellipseSegs(0, r, r))
  })
})
