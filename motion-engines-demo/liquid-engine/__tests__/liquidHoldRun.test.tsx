import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import {
  createLiquidHold, LIQUID_ATTR, LiquidCanvas, runDuration, runKeys, runStart, shownKeys, SWALLOW, useLiquidRun,
} from '../index'
import type { LiquidHold, LiquidRun, LiquidScene, LiquidSwallow } from '../index'

// A held circle's run lasts until the host ends it, and the circle is visible afterward unless it
// went in. A swallow taken over from a finger starts partway through, so played backwards it runs
// down past 0, all the way home.

const SCENE: LiquidScene = { size: 200, centre: { x: 100, y: 100 }, color: '#123456', itemAttribute: 'data-orb' }
const FROM = { x: 170, y: 100 }

const hold = (on = {}): LiquidHold => createLiquidHold({
  key: 'a', from: FROM, centre: SCENE.centre, R: 40, r: 12, bounds: 95, labelShiftX: 0, at: FROM, now: 0, on,
})
const held = (h = hold()): LiquidRun => ({ geometry: { R: 40, r: 12 }, swallow: [], emit: null, hold: h, halt: { halted: false } })
const carried = (local: number): LiquidSwallow => ({
  key: 'a', from: FROM, labelShiftX: 0, start: -local, speed: 1, s0: 1, wobble: 1, carried: { angle: Math.PI / 2, d0: 70 },
})

function Host({ liquid }: { liquid: LiquidRun }) {
  return (
    <div style={{ position: 'relative', width: 200, height: 200 }}>
      <div data-orb="a"><div data-circle="">icon</div><span data-label="">Label</span></div>
      <LiquidCanvas run={liquid} scene={SCENE} />
    </div>
  )
}

describe('a run holding a circle', () => {
  it('names the held circle, never ends by itself, and shows it again unless it went in', () => {
    const h = hold()
    const run = held(h)
    expect(runKeys(run)).toEqual(['a'])
    expect(runDuration(run)).toBe(Infinity)
    expect(shownKeys(run)).toEqual(['a'])

    h.move({ x: 60, y: 100 }, 16)
    h.step(16)
    h.release(16)
    expect(h.committed).toBe(true)
    expect(shownKeys(run)).toEqual([])
  })

  it('starts its clock early when its swallow was taken over part of the way through', () => {
    expect(runStart({ swallow: [carried(420)], emit: null })).toBe(-420)
    expect(runStart({ swallow: [carried(420)], emit: { start: 0, speed: 1, stagger: 0, count: 1, drops: [] } })).toBe(-420)
    expect(runStart({ swallow: [{ ...carried(0), start: 0 }], emit: null })).toBe(0)
    expect(runDuration({ swallow: [carried(420)], emit: null })).toBeCloseTo(SWALLOW.insideAt + SWALLOW.settle - 420, 9)
  })
})

describe('useLiquidRun with a held circle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('keeps a held run until it is finished, and will not turn it round', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    act(() => { result.current.begin({ geometry: { R: 40, r: 12 }, swallow: [], emit: null, hold: hold() }) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onFinish).not.toHaveBeenCalled()
    expect(result.current.reverse()).toBe(false)
    act(() => { result.current.finish() })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('plays a carried swallow backwards all the way to its own start', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    act(() => { result.current.begin({ geometry: { R: 40, r: 12 }, swallow: [carried(400)], emit: null }) })
    act(() => { result.current.onFrame(100) })
    act(() => { result.current.reverse() })
    expect(result.current.run?.reverseFrom).toBe(100)
    // 100ms back to the hand-over, and 400 more to where the tap's swallow begins.
    act(() => { vi.advanceTimersByTime(499) })
    expect(onFinish).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })
})

describe('LiquidCanvas with a held circle', () => {
  it('draws the held drop where the finger has it, its label going in, in the one shape', () => {
    const h = hold()
    h.move({ x: 160, y: 130 }, 16)
    h.step(16)
    const { container } = render(<Host liquid={held(h)} />)
    const circle = container.querySelector<HTMLElement>('[data-circle]')!
    const f = h.frame()
    expect(circle.style.transform).toContain(`translate(${(f.x - FROM.x).toFixed(2)}px, ${(f.y - FROM.y).toFixed(2)}px)`)
    expect(f.x - FROM.x).toBeCloseTo(-10, 0)
    expect(f.y - FROM.y).toBeCloseTo(30, 0)
    const path = container.querySelector(`[${LIQUID_ATTR.canvas}] path[fill="${SCENE.color}"]`)!
    // The centre, and the drop beside it.
    expect(path.getAttribute('d')!.match(/M /g)!.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('filter')).toHaveLength(2)
  })

  it('draws a carried swallow coming in from where it was let go, not from its own place', () => {
    const run: LiquidRun = {
      geometry: { R: 40, r: 12 }, swallow: [carried(SWALLOW.recoilAt)], emit: null, halt: { halted: false },
    }
    const { container } = render(<Host liquid={run} />)
    const circle = container.querySelector<HTMLElement>('[data-circle]')!
    // Its place is to the right of the centre; it was let go straight below it.
    const [, dx, dy] = circle.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!.map(Number)
    expect(SCENE.centre.x + 0 - FROM.x).toBeCloseTo(dx, 0)
    expect(dy).toBeGreaterThan(60)
  })
})

describe('LiquidCanvas with circles beside the held one', () => {
  it('draws a neighbour’s liquid joined to the held drop, moves it, and puts it back once it is still', () => {
    const BESIDE = { x: 170, y: 140 }
    const h = createLiquidHold({
      key: 'a', from: FROM, centre: SCENE.centre, R: 40, r: 12, bounds: 95, labelShiftX: 0, at: FROM, now: 0,
      peers: [{ key: 'b', at: BESIDE, labelShiftX: 0 }],
    })
    // Pressed into it.
    for (let t = 16; t <= 320; t += 16) { h.move({ x: 170, y: 124 }, t); h.step(t) }
    const run = held(h)
    const { container } = render(
      <div style={{ position: 'relative', width: 200, height: 200 }}>
        <div data-orb="a"><div>icon</div><span>A</span></div>
        <div data-orb="b"><div data-peer-circle="">icon</div><span data-peer-label="">B</span></div>
        <LiquidCanvas run={run} scene={SCENE} />
      </div>,
    )
    const path = container.querySelector(`[${LIQUID_ATTR.peer}="b"]`)!
    expect(path.getAttribute('d')).toMatch(/^M /)
    // The same liquid as the drop's: one color, no shading into the neighbor's.
    expect(path.getAttribute('fill')).toBe(SCENE.color)
    const circle = container.querySelector<HTMLElement>('[data-peer-circle]')!
    expect(circle.style.transform).toMatch(/^translate\(/)
    expect(container.querySelector<HTMLElement>('[data-peer-label]')!.style.transform).toMatch(/^translate\(/)
  })
})

describe('LiquidCanvas — greens on the move', () => {
  const GREEN = { color: '#2e7d32', alpha: 0.28, size: 1 }

  it('keeps a held drop’s green: clipped to its outline from a group with no transform of its own', () => {
    const h = createLiquidHold({
      key: 'a', from: FROM, centre: SCENE.centre, R: 40, r: 12, bounds: 95, labelShiftX: 0, at: FROM, now: 0,
      tint: GREEN, fill: '#eeeeee',
    })
    const banded: LiquidScene = { ...SCENE, band: { outer: 30, inner: 26, alpha: 0.28, color: '#2e7d32' } }
    const { container } = render(
      <div style={{ position: 'relative', width: 200, height: 200 }}>
        <div data-orb="a"><div>icon</div><span>A</span></div>
        <LiquidCanvas run={held(h)} scene={banded} />
      </div>,
    )
    const blob = container.querySelector(`[${LIQUID_ATTR.tint}="hold"]`)!
    // A clip on the rotated ellipse itself would be read in its own frame and miss.
    expect(blob.getAttribute('clip-path')).toBeNull()
    expect(blob.parentElement!.getAttribute('clip-path')).toMatch(/^url\(#/)
    expect(blob.parentElement!.getAttribute('transform')).toBeNull()
    expect(Number(blob.getAttribute('fill-opacity'))).toBeGreaterThan(0)
  })

  it('draws a green neighbour’s green as a liquid of its own, flattened where the held drop pushes in', () => {
    const BESIDE = { x: 170, y: 140 }
    const h = createLiquidHold({
      key: 'a', from: FROM, centre: SCENE.centre, R: 40, r: 12, bounds: 95, labelShiftX: 0, at: FROM, now: 0,
      peers: [{ key: 'b', at: BESIDE, labelShiftX: 0, tint: GREEN, fill: '#eeeeee' }],
    })
    for (let t = 16; t <= 480; t += 16) { h.move({ x: 170, y: 124 }, t); h.step(t) }
    const pf = h.frame().peers[0]
    // Pushed into, its green is no longer round: flattened against the held drop.
    expect(pf.green!.segs.some(s => s[0] === 'C')).toBe(true)
    const { container } = render(
      <div style={{ position: 'relative', width: 200, height: 200 }}>
        <div data-orb="a"><div>icon</div><span>A</span></div>
        <div data-orb="b"><div>icon</div><span>B</span></div>
        <LiquidCanvas run={held(h)} scene={SCENE} />
      </div>,
    )
    const green = Array.from(container.querySelectorAll(`[${LIQUID_ATTR.peerGreen}]`))
      .find(el => el.getAttribute(LIQUID_ATTR.peerGreen) === 'b')!
    expect(green.getAttribute('d')).toMatch(/^M .* C /)
    // Its own green, not shaded into anything else.
    expect(green.getAttribute('fill')).toMatch(/^#|^rgb/)
    const neck = container.querySelector(`[${LIQUID_ATTR.peer}="b"]`)!
    expect(neck.getAttribute('fill')).toBe(SCENE.color)
  })
})
