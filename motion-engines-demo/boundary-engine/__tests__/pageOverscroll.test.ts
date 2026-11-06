import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installPageOverscroll, noPageOverscroll, PAGE_OVERSCROLL_ACTIVE_ATTR, PAGE_OVERSCROLL_OPT_OUT_ATTR } from '../pageOverscroll'
import { MAX_WHEEL_PULL_SHARE, overscrollOffset, WHEEL_RELEASE_MS } from '../pageOverscrollMath'

// Driven with the events a browser actually sends. jsdom has no layout, so the page's scroll
// metrics are set here: an 844px screen over a page that scrolls `max` px, sitting at `scrollY`.

const SCREEN = 844
let root: HTMLElement
let page: HTMLElement
let uninstall: () => void
let frames: FrameRequestCallback[] = []
let clock = 0
let scrollY = 0
let max = 2000

function setScroll(y: number) { scrollY = y }

function touch(type: string, target: Element, y: number, x = 100, fingers = 1) {
  const e = new Event(type, { bubbles: true, cancelable: type !== 'touchend' })
  const list = type === 'touchend' ? [] : Array.from({ length: fingers }, () => ({ clientX: x, clientY: y }))
  Object.defineProperty(e, 'touches', { value: list })
  target.dispatchEvent(e)
  return e
}

/** A finger down at `from`, moved to each y in turn. Returns the moves. */
function drag(target: Element, from: number, ...to: number[]) {
  touch('touchstart', target, from)
  return to.map(y => touch('touchmove', target, y))
}

const top = () => parseFloat(root.style.top || '0')

function settle() {
  for (let i = 0; i < 300 && frames.length; i++) {
    const run = frames
    frames = []
    clock += 16
    run.forEach(cb => cb(clock))
  }
}

beforeEach(() => {
  frames = []
  clock = 0
  scrollY = 0
  max = 2000
  document.body.innerHTML = '<div id="root"><main id="page"><p>Content</p></main></div>'
  root = document.getElementById('root')!
  page = document.getElementById('page')!
  const doc = document.documentElement
  Object.defineProperty(doc, 'clientHeight', { configurable: true, get: () => SCREEN })
  Object.defineProperty(doc, 'scrollHeight', { configurable: true, get: () => SCREEN + max })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  uninstall = installPageOverscroll(root)
})

afterEach(() => {
  uninstall()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('pulling past the top', () => {
  it('follows the finger through the band — the further, the less', () => {
    drag(page, 100, 200)
    expect(top()).toBeCloseTo(overscrollOffset(100, SCREEN), 1)
    touch('touchmove', page, 400)
    expect(top()).toBeCloseTo(overscrollOffset(300, SCREEN), 1)
    expect(top()).toBeLessThan(300 * 0.55)
  })

  it('moves the page with a relative offset, never a transform (fixed chrome stays put)', () => {
    drag(page, 100, 220)
    expect(root.style.position).toBe('relative')
    expect(root.style.transform).toBe('')
  })

  it('holds the browser still for a pull that starts at the end', () => {
    const [move] = drag(page, 100, 160)
    expect(move.defaultPrevented).toBe(true)
  })

  it('springs home when let go, and hands its styles back', () => {
    drag(page, 100, 300)
    touch('touchend', page, 300)
    settle()
    expect(root.style.top).toBe('')
    expect(root.style.position).toBe('')
  })

  it('lets a finger catch the page while it is still springing home', () => {
    drag(page, 100, 300)
    touch('touchend', page, 300)
    frames.splice(0).forEach(cb => cb((clock += 16)))
    const caught = top()
    touch('touchstart', page, 500)
    touch('touchmove', page, 501)
    // It carries on from where it was visible, not from zero.
    expect(top()).toBeGreaterThan(caught - 1)
  })
})

describe('pulling past the bottom', () => {
  it('pulls up at the end of a long page', () => {
    setScroll(max)
    drag(page, 600, 500)
    expect(top()).toBeCloseTo(overscrollOffset(-100, SCREEN), 1)
  })

  it('leaves the middle of a page to scroll as it always has', () => {
    setScroll(900)
    const [move] = drag(page, 600, 500)
    expect(top()).toBe(0)
    expect(move.defaultPrevented).toBe(false)
  })

  it('lets a page that fits the screen pull either way', () => {
    max = 0
    drag(page, 600, 500)
    expect(top()).toBeLessThan(0)
  })
})

describe('what never pulls the page', () => {
  it('a sideways swipe — a carousel or a row', () => {
    drag(page, 100, 100, 100)
    touch('touchstart', page, 100, 100)
    const e = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'touches', { value: [{ clientX: 160, clientY: 110 }] })
    page.dispatchEvent(e)
    touch('touchmove', page, 200, 220)
    expect(top()).toBe(0)
  })

  it('fixed chrome: the header, a dock, a map', () => {
    page.innerHTML = '<header style="position: fixed"><button>Back</button></header>'
    drag(page.querySelector('button')!, 100, 300)
    expect(top()).toBe(0)
  })

  it('a list that scrolls on its own', () => {
    page.innerHTML = '<div id="list" style="overflow-y: auto"><p>Row</p></div>'
    const list = page.querySelector<HTMLElement>('#list')!
    Object.defineProperty(list, 'scrollHeight', { value: 900 })
    Object.defineProperty(list, 'clientHeight', { value: 300 })
    drag(list.querySelector('p')!, 100, 300)
    expect(top()).toBe(0)
  })

  it('an element that opts out', () => {
    page.setAttribute(PAGE_OVERSCROLL_OPT_OUT_ATTR, '')
    drag(page, 100, 300)
    expect(top()).toBe(0)
  })

  it('the page behind an open sheet', () => {
    document.body.style.overflow = 'hidden'
    drag(page, 100, 300)
    expect(top()).toBe(0)
  })

  it('a second finger — a pinch', () => {
    touch('touchstart', page, 100, 100, 2)
    touch('touchmove', page, 300, 100, 2)
    expect(top()).toBe(0)
  })

  it('anything outside the app root — a sheet portaled to the body', () => {
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    drag(sheet, 100, 300)
    expect(top()).toBe(0)
  })
})

describe('turning back', () => {
  it('a held pull dragged back across the end scrolls the page by hand', () => {
    drag(page, 100, 200, 50)
    expect(top()).toBe(0)
    expect(window.scrollBy).toHaveBeenCalled()
  })
})

describe('wheel and trackpad', () => {
  function wheel(deltaY: number) {
    const e = new WheelEvent('wheel', { deltaY, bubbles: true })
    page.dispatchEvent(e)
  }

  it('pulls past the top on the band, and returns once the wheel is quiet', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      wheel(-60)
      wheel(-60)
      expect(top()).toBeCloseTo(overscrollOffset(120, SCREEN), 1)
      vi.advanceTimersByTime(WHEEL_RELEASE_MS + 1)
      settle()
      expect(root.style.top).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing in the middle of the page', () => {
    setScroll(500)
    wheel(-60)
    expect(top()).toBe(0)
  })

  it('caps a trackpad’s momentum, so a flung wheel cannot throw the page', () => {
    for (let i = 0; i < 100; i++) wheel(-120)
    // Held at the pull cap, which through the band is about a sixth of the screen.
    expect(top()).toBeCloseTo(overscrollOffset(MAX_WHEEL_PULL_SHARE * SCREEN, SCREEN), 1)
    expect(top()).toBeLessThan(0.17 * SCREEN)
  })
})

describe('a fling arriving at an end', () => {
  it('bounces past the top and back', () => {
    drag(page, 400, 380) // a touch that scrolls nothing here, so the next fling is a finger's
    touch('touchend', page, 380)
    settle()
    setScroll(300)
    clock += 16
    window.dispatchEvent(new Event('scroll'))
    setScroll(150)
    clock += 16
    window.dispatchEvent(new Event('scroll'))
    setScroll(0)
    clock += 16
    window.dispatchEvent(new Event('scroll'))

    frames.splice(0).forEach(cb => cb((clock += 16)))
    frames.splice(0).forEach(cb => cb((clock += 16)))
    expect(top()).toBeGreaterThan(0)
    settle()
    expect(root.style.top).toBe('')
  })
})

describe('the platform’s own overscroll', () => {
  it('is switched off for exactly as long as this is installed — never both, never neither', () => {
    expect(document.documentElement.hasAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)).toBe(true)
    uninstall()
    expect(document.documentElement.hasAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)).toBe(false)
    uninstall = installPageOverscroll(root)
  })
})

describe('the gap the page leaves', () => {
  // Pulled from its end, the page uncovered the document's white background, leaving a white band
  // above or below a grey page.
  it('is painted the page’s own ground colour, and handed back at home', () => {
    page.style.backgroundColor = 'rgb(242, 243, 245)'
    ;(document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => [page]
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, window.innerWidth, 900))
    try {
      drag(page, 100, 300)
      expect(document.documentElement.style.backgroundColor).toBe('rgb(242, 243, 245)')
      expect(document.body.style.backgroundColor).toBe('rgb(242, 243, 245)')

      touch('touchend', page, 300)
      settle()
      expect(document.documentElement.style.backgroundColor).toBe('')
      expect(document.body.style.backgroundColor).toBe('')
    } finally {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
    }
  })

  it('takes the page’s ground, not a card on it', () => {
    page.style.backgroundColor = 'rgb(242, 243, 245)'
    page.innerHTML = '<div id="card" style="background-color: rgb(255, 255, 255)">Card</div>'
    const card = page.querySelector<HTMLElement>('#card')!
    ;(document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => [card, page]
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 0, window.innerWidth - 32, 200))
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, window.innerWidth, 900))
    try {
      drag(page, 100, 300)
      expect(document.body.style.backgroundColor).toBe('rgb(242, 243, 245)')
    } finally {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
    }
  })
})

describe('a page that holds still (the dashboard)', () => {
  beforeEach(() => {
    page.setAttribute(Object.keys(noPageOverscroll)[0], Object.values(noPageOverscroll)[0])
  })

  it('never pulls', () => {
    max = 0
    drag(page, 100, 300)
    expect(top()).toBe(0)
  })

  it('never bounces at the end of a fling either', () => {
    touch('touchstart', page, 400)
    touch('touchend', page, 380)
    for (const y of [300, 150, 0]) {
      setScroll(y)
      clock += 16
      window.dispatchEvent(new Event('scroll'))
    }
    expect(frames).toHaveLength(0)
    expect(top()).toBe(0)
  })
})

