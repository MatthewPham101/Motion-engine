import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { LIQUID_ATTR, LiquidCanvas } from '../index'
import type { LiquidRun, LiquidScene } from '../index'

// Makes sure the canvas works with any scene: its own canvas size, centre, color and item attribute.
// Only the first frame is drawn synchronously, which is all these tests need.

const SCENE: LiquidScene = {
  size: 200,
  centre: { x: 100, y: 100 },
  color: '#123456',
  itemAttribute: 'data-orb',
}
const BANDED: LiquidScene = {
  ...SCENE,
  band: { outer: 40, inner: 34, alpha: 0.3, color: '#00aa00', trackSelector: '[data-track] circle' },
}

const TINT = { color: '#00aa00', alpha: 0.3, size: 1, toEdge: true }

function run(overrides: Partial<LiquidRun> = {}): LiquidRun {
  return {
    geometry: { R: 40, r: 12 },
    swallow: [{ key: 'a', from: { x: 170, y: 100 }, labelShiftX: 0, start: 0, speed: 1, s0: 1, wobble: 1, tint: TINT }],
    emit: null,
    halt: { halted: false },
    ...overrides,
  }
}

function Host({ scene, liquid, onFrame }: { scene: LiquidScene; liquid: LiquidRun; onFrame?: (t: number) => void }) {
  return (
    <div style={{ position: 'relative', width: 200, height: 200 }}>
      <svg data-track=""><circle r={37} /></svg>
      <div data-orb="a"><div data-circle="">icon</div><span>Label</span></div>
      <LiquidCanvas run={liquid} scene={scene} onFrame={onFrame} />
    </div>
  )
}

afterEach(() => { vi.restoreAllMocks() })

describe('LiquidCanvas', () => {
  it('draws the run as one shape in the scene’s colour, at the scene’s size', () => {
    const { container } = render(<Host scene={SCENE} liquid={run()} />)
    const svg = container.querySelector(`[${LIQUID_ATTR.canvas}]`)!
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200')
    const path = svg.querySelector('path')!
    expect(path.getAttribute('fill')).toBe('#123456')
    expect(path.getAttribute('d')).toMatch(/^M /)
  })

  it('moves and fades the host’s own circle and label, found by the scene’s attribute', () => {
    const { container } = render(<Host scene={SCENE} liquid={run()} />)
    const circle = container.querySelector<HTMLElement>('[data-circle]')!
    expect(circle.style.transform).toContain('translate(')
    expect(circle.style.opacity).toBe('1')
    expect(container.querySelector<HTMLElement>('[data-orb] span')!.style.transformOrigin).toBe('50% 0')
  })

  it('reports the frame it drew', () => {
    const onFrame = vi.fn()
    render(<Host scene={SCENE} liquid={run()} onFrame={onFrame} />)
    expect(onFrame).toHaveBeenCalledWith(0)
    onFrame.mockClear()
    render(<Host scene={SCENE} liquid={run({ reverseFrom: 250 })} onFrame={onFrame} />)
    expect(onFrame).toHaveBeenCalledWith(250)
  })

  it('draws no band, and no tint, in a scene without one', () => {
    const { container } = render(<Host scene={SCENE} liquid={run()} />)
    expect(container.querySelector(`[${LIQUID_ATTR.band}]`)).toBeNull()
    expect(container.querySelector(`[${LIQUID_ATTR.tint}]`)).toBeNull()
  })

  it('draws the band in place of the page’s own while it plays, then hands it back', () => {
    const { container, unmount } = render(<Host scene={BANDED} liquid={run()} />)
    const track = container.querySelector<SVGElement>('[data-track] circle')!
    expect(track.style.opacity).toBe('0')
    const band = container.querySelector(`[${LIQUID_ATTR.band}]`)!
    expect(band.getAttribute('fill')).toBe('#00aa00')
    expect(band.getAttribute('d')).toMatch(/^M /)
    expect(container.querySelectorAll(`[${LIQUID_ATTR.tint}="in0"]`)).toHaveLength(1)
    unmount()
    expect(track.style.opacity).toBe('')
  })

  it('gives two canvases on one page their own melt filters', () => {
    const { container } = render(
      <>
        <Host scene={SCENE} liquid={run()} />
        <Host scene={SCENE} liquid={run()} />
      </>,
    )
    const ids = Array.from(container.querySelectorAll('filter')).map(f => f.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
  })

  it('draws nothing more once the run is halted', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
    const liquid = run()
    const onFrame = vi.fn()
    render(<Host scene={SCENE} liquid={liquid} onFrame={onFrame} />)
    onFrame.mockClear()
    liquid.halt.halted = true
    frames.forEach(cb => cb(16))
    expect(onFrame).not.toHaveBeenCalled()
  })
})
