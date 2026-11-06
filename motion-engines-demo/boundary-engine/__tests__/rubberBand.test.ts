import { describe, it, expect } from 'vitest'
import { RUBBER_BAND_CONSTANT, rubberBand, rubberBandInverse, rubberBandSigned } from '../rubberBand'

// offset = (1 - 1 / (c*x / d + 1)) * d
// x is how far the finger is pulled past the end, d is the screen's height, and c is the constant.
// The further you pull, the less it follows, up to a ceiling.

const D = 844 // an iPhone's height, in points
const c = RUBBER_BAND_CONSTANT

describe('rubberBand', () => {
  it('is exactly the formula', () => {
    for (const x of [1, 10, 100, 400, 2000]) {
      expect(rubberBand(x, D)).toBeCloseTo((1 - 1 / ((c * x) / D + 1)) * D, 9)
      // ...and UIKit's usual way of writing the same thing.
      expect(rubberBand(x, D)).toBeCloseTo((c * x * D) / (D + c * x), 9)
    }
  })

  it('follows at c to begin with, and less the further it is pulled', () => {
    expect(rubberBand(1, D)).toBeCloseTo(c, 2)
    const first100 = rubberBand(100, D)
    const next100 = rubberBand(200, D) - rubberBand(100, D)
    const later100 = rubberBand(800, D) - rubberBand(700, D)
    expect(next100).toBeLessThan(first100)
    expect(later100).toBeLessThan(next100)
  })

  it('has a ceiling: never as far as the screen, however far the pull', () => {
    expect(rubberBand(1e7, D)).toBeLessThan(D)
    expect(rubberBand(1e7, D)).toBeGreaterThan(0.99 * D)
  })

  it('does nothing for no pull, a pull back inside the end, or no dimension', () => {
    expect(rubberBand(0, D)).toBe(0)
    expect(rubberBand(-40, D)).toBe(0)
    expect(rubberBand(40, 0)).toBe(0)
  })

  it('keeps the sign for a pull past either end', () => {
    expect(rubberBandSigned(-120, D)).toBeCloseTo(-rubberBand(120, D), 9)
    expect(rubberBandSigned(120, D)).toBeCloseTo(rubberBand(120, D), 9)
  })

  it('runs backwards: the pull that produces an offset', () => {
    for (const x of [5, 80, 600]) expect(rubberBandInverse(rubberBand(x, D), D)).toBeCloseTo(x, 6)
    expect(rubberBandInverse(0, D)).toBe(0)
    expect(Number.isFinite(rubberBandInverse(D * 2, D))).toBe(true)
  })
})
