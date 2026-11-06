import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { runDuration, SWALLOW_TOTAL, useLiquidRun } from '../index'
import type { LiquidRun, LiquidRunInput, LiquidSwallow } from '../index'

// Every host needs the same behavior from a run: it ends itself, a new one finishes the old one first,
// it can be cut short, and it can turn around from the frame on screen. The halt is set synchronously
// at the end, so no frame gets drawn after the host has put its circles back.

const swallow = (key: string): LiquidSwallow =>
  ({ key, from: { x: 300, y: 300 }, labelShiftX: 0, start: 0, speed: 1, s0: 1, wobble: 1 })
const input = (key: string): LiquidRunInput<LiquidRun> =>
  ({ geometry: { R: 100, r: 30 }, swallow: [swallow(key)], emit: null })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useLiquidRun', () => {
  it('plays a run and ends it itself once it is still', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    expect(result.current.run).toBeNull()

    let started: LiquidRun
    act(() => { started = result.current.begin(input('a')) })
    expect(result.current.run).toBe(started!)
    expect(result.current.current()).toBe(started!)
    expect(started!.halt.halted).toBe(false)

    act(() => { vi.advanceTimersByTime(runDuration(started!) - 1) })
    expect(onFinish).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onFinish).toHaveBeenCalledWith(started!)
    expect(started!.halt.halted).toBe(true)
    expect(result.current.run).toBeNull()
    expect(result.current.current()).toBeNull()
  })

  it('lands a run still playing before the next begins', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    let first: LiquidRun
    act(() => { first = result.current.begin(input('a')) })
    act(() => { result.current.begin(input('b')) })
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledWith(first!)
    expect(result.current.run?.swallow[0].key).toBe('b')
  })

  it('ends a run on demand, and does nothing with none playing', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    act(() => { result.current.finish() })
    expect(onFinish).not.toHaveBeenCalled()
    act(() => { result.current.begin(input('a')) })
    act(() => { result.current.finish() })
    expect(onFinish).toHaveBeenCalledTimes(1)
    // Its own timer is gone with it.
    act(() => { vi.advanceTimersByTime(SWALLOW_TOTAL * 2) })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('turns a run round from the frame it reached, then ends it', () => {
    const onFinish = vi.fn()
    const onDone = vi.fn()
    const { result } = renderHook(() => useLiquidRun({ onFinish }))
    let forwards: LiquidRun
    act(() => { forwards = result.current.begin(input('a')) })
    act(() => { result.current.onFrame(320) })
    expect(result.current.time()).toBe(320)

    act(() => { expect(result.current.reverse(onDone)).toBe(true) })
    const backwards = result.current.run!
    expect(backwards).not.toBe(forwards!)
    expect(backwards.reverseFrom).toBe(320)
    expect(backwards.swallow).toBe(forwards!.swallow)
    // The old run stops drawing without being "finished", so nothing gets put back.
    expect(forwards!.halt.halted).toBe(true)
    expect(backwards.halt.halted).toBe(false)
    expect(onFinish).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(320) })
    expect(onFinish).toHaveBeenCalledWith(backwards)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(result.current.run).toBeNull()
  })

  it('has nothing to turn round with no run playing', () => {
    const { result } = renderHook(() => useLiquidRun())
    let turned = true
    act(() => { turned = result.current.reverse() })
    expect(turned).toBe(false)
  })

  it('never ends a run after the host has gone', () => {
    const onFinish = vi.fn()
    const { result, unmount } = renderHook(() => useLiquidRun({ onFinish }))
    act(() => { result.current.begin(input('a')) })
    unmount()
    act(() => { vi.advanceTimersByTime(SWALLOW_TOTAL * 2) })
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('reports to the latest onFinish the host rendered with', () => {
    const early = vi.fn()
    const late = vi.fn()
    const { result, rerender } = renderHook(({ cb }) => useLiquidRun({ onFinish: cb }), { initialProps: { cb: early } })
    act(() => { result.current.begin(input('a')) })
    rerender({ cb: late })
    act(() => { result.current.finish() })
    expect(early).not.toHaveBeenCalled()
    expect(late).toHaveBeenCalledTimes(1)
  })
})
