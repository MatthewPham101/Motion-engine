import { describe, it, expect } from 'vitest'
import { closedCurveSegs, wallBody } from '../index'
import type { Point, Seg, WallInput } from '../index'

// Liquid meeting glass: flattened onto the wall's own curve, wetting it in feet that creep along it,
// and clinging when pulled away. Its area stays the same and none of it ever crosses the wall.

const WALL = 357
const R = 59
const base: WallInput = {
  d: WALL - R + 20, along: R, across: R, wall: WALL, press: 20, stick: 0, fillet: 0.5, wet: 0.9, maxCreep: 14, wetReach: 13,
}

/** Every on-curve point of an outline (the end of each segment). */
const ends = (segs: Seg[]): Point[] =>
  segs.flatMap(s => (s[0] === 'M' ? [s[1]] : s[0] === 'C' ? [s[3]] : s[0] === 'A' ? [s[3]] : []))

/** The area inside an outline, from its on-curve points. */
function area(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/** How far round the wall (radians) the outline lies on it. */
function contactSpan(points: Point[], within = 0.75): number {
  const on = points.filter(([x, y]) => Math.hypot(x, y) > WALL - within).map(([x, y]) => Math.atan2(y, x))
  return on.length ? Math.max(...on) - Math.min(...on) : 0
}

describe('a drop against a round wall', () => {
  it('never crosses the wall, however hard it is pressed', () => {
    for (const press of [2, 20, 40]) {
      const points = ends(wallBody({ ...base, d: WALL - R + press, press }).segs)
      for (const [x, y] of points) expect(Math.hypot(x, y)).toBeLessThanOrEqual(WALL + 1e-6)
    }
  })

  it('flattens onto the wall’s own curve, spreading along it, its area kept', () => {
    const body = wallBody(base)
    const points = ends(body.segs)
    expect(area(points)).toBeCloseTo(Math.PI * R * R, -2)
    expect(Math.abs(area(points) / (Math.PI * R * R) - 1)).toBeLessThan(0.01)
    // A real stretch of it lies on the wall...
    expect(contactSpan(points) * WALL).toBeGreaterThan(R * 0.6)
    // ...and it's wider along the wall than it is deep.
    expect(body.across).toBeGreaterThan(body.along)
    // Pushed back off the wall, its middle sits further in than the finger has it.
    expect(body.d).toBeLessThan(base.d)
  })

  it('wets the wall: it creeps further along it than a drop that does not', () => {
    const wetting = contactSpan(ends(wallBody(base).segs))
    const dry = contactSpan(ends(wallBody({ ...base, wet: 0 }).segs))
    expect(wetting).toBeGreaterThan(dry * 1.15)
  })

  it('clinging, is drawn out to the wall as it is pulled away from it', () => {
    const gap = 12
    const free = wallBody({ ...base, d: WALL - R - gap, press: 0, stick: 0 })
    const clinging = wallBody({ ...base, d: WALL - R - gap, press: 0, stick: gap })
    const reach = (segs: Seg[]) => Math.max(...ends(segs).map(([x, y]) => Math.hypot(x, y)))
    expect(reach(free.segs)).toBeCloseTo(WALL - gap, 0)
    expect(reach(clinging.segs)).toBeGreaterThan(WALL - 1.5)
    expect(reach(clinging.segs)).toBeLessThanOrEqual(WALL + 1e-6)
  })

  it('stands in for itself with a circle that fits inside it, flattened side and all', () => {
    const body = wallBody(base)
    const points = ends(body.segs)
    const nearest = Math.min(...points.map(([x, y]) => Math.hypot(x - body.d, y)))
    expect(body.inner).toBeLessThanOrEqual(nearest)
    expect(body.inner).toBeGreaterThan(nearest - 1)
    // Smaller than its half-extent: that circle would poke out past the wall side.
    expect(body.inner).toBeLessThan(body.along)
  })

  it('never creeps further along the wall than its cap, however hard it is pressed', () => {
    const capped = contactSpan(ends(wallBody({ ...base, press: 30, d: WALL - R + 30, maxCreep: 4 }).segs))
    const free = contactSpan(ends(wallBody({ ...base, press: 30, d: WALL - R + 30, maxCreep: 40 }).segs))
    expect(capped).toBeLessThan(free)
  })

  it('is its own round self when nothing presses it', () => {
    const points = ends(wallBody({ ...base, d: 200, press: 0, stick: 0 }).segs)
    for (const [x, y] of points) expect(Math.hypot(x - 200, y)).toBeCloseTo(R, 6)
  })
})

describe('closedCurveSegs', () => {
  it('passes through every point, closing back to the first', () => {
    const pts: Point[] = [[10, 0], [0, -10], [-10, 0], [0, 10]]
    const segs = closedCurveSegs(pts)
    expect(segs[0]).toEqual(['M', pts[0]])
    expect(segs.filter(s => s[0] === 'C').map(s => (s as ['C', Point, Point, Point])[3])).toEqual([pts[1], pts[2], pts[3], pts[0]])
    expect(segs[segs.length - 1]).toEqual(['Z'])
  })
})
