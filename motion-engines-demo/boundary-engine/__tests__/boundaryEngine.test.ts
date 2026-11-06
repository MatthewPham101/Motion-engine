import { describe, it, expect } from 'vitest'
import { boundedOffset, MIN_RUBBER_DIMENSION, rubberBand, rubberBandClamp } from '../index'

// Boundary engine: the band, the soft clamp built on it, and the swipe rows' trays.

describe('rubberBandClamp', () => {
  it('is the identity inside the range — an ordinary gesture lands where it was asked to', () => {
    for (const v of [-10, 0, 37.5, 100]) expect(rubberBandClamp(v, -10, 100, 300)).toBe(v)
  })

  it('bands past either end by the formula, measured from that end', () => {
    expect(rubberBandClamp(160, -10, 100, 300)).toBe(100 + rubberBand(60, 300))
    expect(rubberBandClamp(-70, -10, 100, 300)).toBe(-10 - rubberBand(60, 300))
  })

  it('never runs further past an end than the dimension it is measured against', () => {
    expect(rubberBandClamp(1e9, 0, 100, 300)).toBeLessThan(400)
    expect(rubberBandClamp(-1e9, 0, 100, 300)).toBeGreaterThan(-300)
  })

  it('takes its own constant: a firmer band follows less', () => {
    expect(rubberBandClamp(150, 0, 100, 300, 0.35)).toBeLessThan(rubberBandClamp(150, 0, 100, 300))
  })
})

describe('boundedOffset — a row between its trays', () => {
  it('moves freely inside the trays and is banded past them, against the tray', () => {
    expect(boundedOffset(120, 144, 72)).toBe(120)
    expect(boundedOffset(200, 144, 72)).toBe(144 + rubberBand(56, 144))
    expect(boundedOffset(-100, 144, 72)).toBe(-72 - rubberBand(28, 72))
  })

  it('still gives a little toward a side with no actions', () => {
    expect(boundedOffset(30, 0, 144)).toBe(rubberBand(30, MIN_RUBBER_DIMENSION))
  })
})
