import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { useLiquidDrag } from '../index'
import type { LiquidDragOptions, LiquidHold } from '../index'

// A press whose end never came (the screen rotated or folded under the finger) can't block every
// press after it.

function Scene({ grab }: { grab: LiquidDragOptions['grab'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidDrag({ target: ref, size: 400, itemAttribute: 'data-orb', grab })
  return (
    <div ref={ref} data-testid="scene">
      <div data-orb="a"><div data-testid="circle" /><span>A</span></div>
    </div>
  )
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useLiquidDrag — a lost press', () => {
  it('gives way to the next primary finger', () => {
    const hold = { move: vi.fn(), release: vi.fn(() => 'home'), cancel: vi.fn() } as unknown as LiquidHold
    const grab = vi.fn<LiquidDragOptions['grab']>(() => hold)
    const { getByTestId } = render(<Scene grab={grab} />)
    const c = getByTestId('circle')
    // The first press never ends (no pointerup, no pointercancel).
    fireEvent.pointerDown(c, { pointerId: 1, isPrimary: true, button: 0, pointerType: 'touch', clientX: 10, clientY: 10 })
    // A new finger, later: it is heard.
    fireEvent.pointerDown(c, { pointerId: 2, isPrimary: true, button: 0, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 10 })
    expect(grab).toHaveBeenCalledTimes(1)
  })
})
