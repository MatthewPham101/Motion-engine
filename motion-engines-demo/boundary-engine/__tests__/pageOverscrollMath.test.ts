import { describe, it, expect } from 'vitest'
import {
  MAX_ARRIVAL_BOUNCE_SHARE, OVERSCROLL_RETURN_SPRING,
  arrivalBounceVelocity, overscrollOffset, pushedEnd, wheelDeltaPx,
} from '../pageOverscrollMath'
import { rubberBand } from '../rubberBand'
import { springStep } from '../../spring-engine'

const LONG = { top: 0, max: 2000 }

describe('pushedEnd', () => {
  it('a drag down at the top pushes past the top; up at the bottom, past the bottom', () => {
    expect(pushedEnd(10, LONG)).toBe('top')
    expect(pushedEnd(-10, { top: 2000, max: 2000 })).toBe('bottom')
  })

  it('is nothing while the page can still scroll that way', () => {
    expect(pushedEnd(-10, LONG)).toBeNull()
    expect(pushedEnd(10, { top: 900, max: 2000 })).toBeNull()
    expect(pushedEnd(0, LONG)).toBeNull()
  })

  it('lets a page that fits the screen pull either way, as iOS lets a short page bounce', () => {
    expect(pushedEnd(10, { top: 0, max: 0 })).toBe('top')
    expect(pushedEnd(-10, { top: 0, max: 0 })).toBe('bottom')
  })
})

describe('overscrollOffset', () => {
  it('is the rubber band against the screen height, signed by the end', () => {
    expect(overscrollOffset(150, 844)).toBeCloseTo(rubberBand(150, 844), 9)
    expect(overscrollOffset(-150, 844)).toBeCloseTo(-rubberBand(150, 844), 9)
  })
})

describe('arrivalBounceVelocity', () => {
  /** How far a bounce launched at `v` carries the page before coming back. */
  function peak(v: number): number {
    let m = { x: 0, v }
    let most = 0
    for (let i = 0; i < 120; i++) {
      m = springStep(m, 0, OVERSCROLL_RETURN_SPRING, 1 / 60)
      most = Math.max(most, Math.abs(m.x))
    }
    return most
  }

  it('carries the page on the way it was travelling', () => {
    // Scrolling up into the top: the content keeps going down past it.
    expect(arrivalBounceVelocity(-3000, 844)).toBeGreaterThan(0)
    expect(arrivalBounceVelocity(3000, 844)).toBeLessThan(0)
  })

  it('never throws the page further than a tenth of the screen', () => {
    expect(peak(arrivalBounceVelocity(-50_000, 844))).toBeLessThanOrEqual(MAX_ARRIVAL_BOUNCE_SHARE * 844 + 1)
    // A gentle arrival bounces gently.
    expect(peak(arrivalBounceVelocity(-1000, 844))).toBeLessThan(peak(arrivalBounceVelocity(-3000, 844)))
  })
})

describe('wheelDeltaPx', () => {
  it('measures pixels, lines and pages alike', () => {
    expect(wheelDeltaPx(53, 0, 900)).toBe(53)
    expect(wheelDeltaPx(3, 1, 900)).toBe(48)
    expect(wheelDeltaPx(1, 2, 900)).toBe(900)
  })
})
