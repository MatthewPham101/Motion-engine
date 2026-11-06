import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { DRAG_SLOP, useLiquidDrag } from '../index'
import type { LiquidDragOptions, LiquidHold } from '../index'

// The finger's half of a held drop. Only the circle itself picks it up, while its label stays a tap.
// A press is a tap until it moves past the slop, the finger gets mapped into the scene's px however
// the scene is scaled, and the click ending a drag doesn't also count as a tap.

const SIZE = 400

function fakeHold(): LiquidHold {
  return {
    key: 'a', from: { x: 0, y: 0 }, labelShiftX: 0, phase: 'held', committed: false,
    grab: vi.fn(() => true), move: vi.fn(), release: vi.fn(() => 'home' as const), cancel: vi.fn(),
    step: vi.fn(), frame: vi.fn(),
  } as unknown as LiquidHold
}

function Scene({ options, onTap }: { options: Omit<LiquidDragOptions, 'target' | 'size' | 'itemAttribute'>; onTap: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidDrag({ target: ref, size: SIZE, itemAttribute: 'data-orb', ...options })
  return (
    <div ref={ref} data-testid="scene">
      <div data-orb="a" onClick={onTap}>
        <div data-testid="circle"><img alt="" data-testid="icon" /></div>
        <span data-testid="label">A</span>
      </div>
    </div>
  )
}

function setup(options: Partial<LiquidDragOptions> = {}) {
  const hold = fakeHold()
  const grab = vi.fn<LiquidDragOptions['grab']>(() => hold)
  const onTap = vi.fn()
  const utils = render(<Scene options={{ grab, ...options }} onTap={onTap} />)
  // On screen at half size, 100px in: the scene's px are twice the screen's.
  vi.spyOn(utils.getByTestId('scene'), 'getBoundingClientRect')
    .mockReturnValue({ left: 100, top: 50, width: SIZE / 2, height: SIZE / 2, right: 300, bottom: 250, x: 100, y: 50, toJSON() {} } as DOMRect)
  return { ...utils, hold, grab, onTap }
}

const down = (el: Element, x: number, y: number) =>
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, pointerType: 'touch', clientX: x, clientY: y })
const move = (x: number, y: number) =>
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
const up = (x: number, y: number) =>
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useLiquidDrag', () => {
  it('picks the circle up once the finger moves past the slop, where the press began, in the scene’s px', () => {
    const { getByTestId, grab, hold } = setup()
    down(getByTestId('icon'), 150, 100)
    move(150 + DRAG_SLOP - 1, 100)
    expect(grab).not.toHaveBeenCalled()

    move(150 + DRAG_SLOP + 2, 100)
    expect(grab).toHaveBeenCalledTimes(1)
    expect(grab.mock.calls[0][0]).toBe('a')
    expect(grab.mock.calls[0][1]).toEqual({ x: 100, y: 100 })
    expect(hold.move).toHaveBeenLastCalledWith({ x: 2 * (50 + DRAG_SLOP + 2), y: 100 }, expect.any(Number))

    up(170, 100)
    expect(hold.release).toHaveBeenCalledTimes(1)
  })

  it('leaves the label to be tapped: pressing it picks nothing up', () => {
    const { getByTestId, grab } = setup()
    down(getByTestId('label'), 150, 100)
    move(200, 100)
    expect(grab).not.toHaveBeenCalled()
  })

  it('lets a still press be a tap, and swallows the click that ends a drag', () => {
    const { getByTestId, onTap } = setup()
    down(getByTestId('circle'), 150, 100)
    up(150, 100)
    fireEvent.click(getByTestId('circle'))
    expect(onTap).toHaveBeenCalledTimes(1)

    down(getByTestId('circle'), 150, 100)
    move(190, 100)
    up(190, 100)
    fireEvent.click(getByTestId('circle'))
    expect(onTap).toHaveBeenCalledTimes(1)

    // Only that one click: the next is a tap again.
    fireEvent.click(getByTestId('circle'))
    expect(onTap).toHaveBeenCalledTimes(2)
  })

  it('sends the circle home when the gesture is taken away', () => {
    const { getByTestId, hold } = setup()
    down(getByTestId('circle'), 150, 100)
    move(190, 100)
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(hold.cancel).toHaveBeenCalledTimes(1)
    expect(hold.release).not.toHaveBeenCalled()
  })

  it('catches a circle on its way home at the touch, without waiting for the slop', () => {
    const { getByTestId, grab } = setup({ catches: () => true })
    down(getByTestId('circle'), 150, 100)
    expect(grab).toHaveBeenCalledWith('a', { x: 100, y: 100 }, expect.any(Number))
  })

  it('does nothing when switched off, or for a second finger', () => {
    const off = setup({ enabled: false })
    down(off.getByTestId('circle'), 150, 100)
    move(200, 100)
    expect(off.grab).not.toHaveBeenCalled()
    off.unmount()

    const { getByTestId, grab } = setup()
    down(getByTestId('circle'), 150, 100)
    fireEvent.pointerDown(getByTestId('circle'), { pointerId: 2, button: 0, clientX: 150, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 220, clientY: 100 })
    expect(grab).not.toHaveBeenCalled()
  })
})
