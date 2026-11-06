import { describe, it, expect } from 'vitest'
import {
  createEmitTimeline, createSwallowTimeline, EMIT, EMIT_DROP_TOTAL, emitDropDuration, emitDuration, localTimes,
  neckBaseLimit, runDuration, sceneDuration, shownKeys, SWALLOW, SWALLOW_TOTAL, swallowDuration,
} from '../index'
import type { EmitTuning, LiquidSwallow, SwallowTuning } from '../index'

// The engine isn't tied to any one UI. Its settings are a tuning object a run can replace, and these
// tests pin the defaults.

const GEOMETRY = { R: 149, r: 44, d0: 255, s0: 1 }

/** The swallow `k` times as fast: every time knob scaled. */
function quicker(k: number): SwallowTuning {
  const t = (ms: number) => ms / k
  return {
    ...SWALLOW,
    recoilAt: t(SWALLOW.recoilAt), contactAt: t(SWALLOW.contactAt), neckAt: t(SWALLOW.neckAt),
    insideAt: t(SWALLOW.insideAt), centreAt: t(SWALLOW.centreAt), settle: t(SWALLOW.settle),
  }
}

const swallow = (key: string, start: number, speed = 1): LiquidSwallow =>
  ({ key, from: { x: 0, y: 0 }, labelShiftX: 0, start, speed, s0: 1, wobble: 1 })

describe('a tuning', () => {
  it('defaults to the wheel’s own', () => {
    expect(swallowDuration()).toBe(SWALLOW_TOTAL)
    expect(SWALLOW_TOTAL).toBe(SWALLOW.insideAt + SWALLOW.settle)
    expect(emitDropDuration()).toBe(EMIT_DROP_TOTAL)
    const byDefault = createSwallowTimeline(GEOMETRY)
    const explicit = createSwallowTimeline(GEOMETRY, SWALLOW)
    for (const t of [0, 200, 470, 700, 1000]) expect(byDefault(t).outline).toBe(explicit(t).outline)
  })

  it('re-times a swallow: the drop reaches the middle at the tuning’s own moment', () => {
    const fast = quicker(2)
    const at = createSwallowTimeline(GEOMETRY, fast)
    expect(at(fast.centreAt).d).toBe(0)
    expect(at(fast.recoilAt).d).toBeGreaterThan(GEOMETRY.d0)
    expect(swallowDuration(fast)).toBe(SWALLOW_TOTAL / 2)
  })

  it('re-times a pop-out', () => {
    const slow: EmitTuning = { ...EMIT, landAt: EMIT.landAt * 2, settle: EMIT.settle * 2, stagger: 200 }
    const at = createEmitTimeline({ R: 149, r: 44, dSlot: 255, count: 5 }, slow)
    expect(at(slow.landAt).d).toBeGreaterThan(255)
    expect(at(emitDropDuration(slow)).d).toBe(255)
    expect(emitDuration(3, slow)).toBe(2 * 200 + emitDropDuration(slow))
  })

  it('times a whole run on its own tuning', () => {
    const fast = quicker(2)
    const run = { swallow: [swallow('a', 100)], emit: null, tuning: { swallow: fast } }
    expect(runDuration(run)).toBe(100 + swallowDuration(fast))
    expect(sceneDuration(null, { swallow: fast })).toBe(swallowDuration(fast))
  })
})

describe('a run', () => {
  const emit = { start: 300, speed: 2, stagger: 50, count: 3, drops: ['x', 'y'].map(key => ({ key, angle: 0, dSlot: 255, labelShiftX: 0 })) }

  it('leaves on show what popped out — or, played backwards, what had gone in', () => {
    const run = { swallow: [swallow('a', 0)], emit }
    expect(shownKeys(run)).toEqual(['x', 'y'])
    expect(shownKeys({ ...run, reverseFrom: 400 })).toEqual(['a'])
  })

  it('gives each part its own clock, at its own pace', () => {
    const times = localTimes({ swallow: [swallow('a', 100, 1.5)], emit }, 400)
    expect(times.swallow).toEqual([(400 - 100) * 1.5])
    expect(times.emit).toEqual([(400 - 300) * 2, (400 - 350) * 2])
  })
})

describe('neighbouring necks', () => {
  it('may each reach a share of the way to the next drop round the ring', () => {
    expect(neckBaseLimit(5, 0.5)).toBeCloseTo(Math.PI / 5)
    expect(neckBaseLimit(0, 0.5)).toBe(neckBaseLimit(1, 0.5))
  })
})
