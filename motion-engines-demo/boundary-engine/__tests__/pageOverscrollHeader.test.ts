import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installPageOverscroll } from '../pageOverscroll'

// Regression test: on some screens the header is drawn inside the page, so pulling past the top
// brought it down with everything else. jsdom has no layout, so each header's screen position is
// modeled here. One in the page's flow moves by the root's offset (and its own), and a fixed one
// doesn't. The page clips with the longhands, because jsdom doesn't expand `overflow` into them
// the way a browser does.

const SCREEN = 844
let root: HTMLElement
let page: HTMLElement
let uninstall: () => void
let frames: FrameRequestCallback[] = []
let clock = 0

const px = (v: string) => parseFloat(v || '0')

function touch(type: string, target: Element, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: type !== 'touchend' })
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: 100, clientY: y }] })
  target.dispatchEvent(e)
  return e
}

function settle() {
  for (let i = 0; i < 300 && frames.length; i++) {
    const run = frames
    frames = []
    clock += 16
    run.forEach(cb => cb(clock))
  }
}

/** A header drawn in the page's flow: on screen where the root's offset and its own relative
 *  offset put it. */
function inFlowHeader(el: HTMLElement) {
  el.getBoundingClientRect = () => {
    const y = px(root.style.top) + px(el.style.top)
    return { top: y, bottom: y + 96, left: 0, right: 390, width: 390, height: 96, x: 0, y, toJSON: () => ({}) } as DOMRect
  }
}

/** A header in a fixed strip: never moves with the page. */
function fixedHeader(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 96, left: 0, right: 390, width: 390, height: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
}

/** The header's screen position, according to the model. */
const headerTop = (el: HTMLElement) => el.getBoundingClientRect().top

beforeEach(() => {
  frames = []
  clock = 0
  document.body.innerHTML = `
    <div id="root">
      <div id="page" style="height: 844px; overflow-x: hidden; overflow-y: hidden; display: flex; flex-direction: column">
        <div id="header" data-app-header></div>
        <main id="content"><p>Content</p></main>
      </div>
    </div>`
  root = document.getElementById('root')!
  page = document.getElementById('page')!
  // test-setup gives every element a huge scrollHeight, but this page fits its box.
  for (const [key, value] of [['scrollHeight', 844], ['clientHeight', 844], ['scrollWidth', 390], ['clientWidth', 390]] as const) {
    Object.defineProperty(page, key, { configurable: true, get: () => value })
  }
  const doc = document.documentElement
  Object.defineProperty(doc, 'clientHeight', { configurable: true, get: () => SCREEN })
  // A page laid out to the screen: nothing to scroll, either end pulls.
  Object.defineProperty(doc, 'scrollHeight', { configurable: true, get: () => SCREEN })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  // jsdom's computed style ignores an inline overflow-y, but a browser's doesn't.
  const real = window.getComputedStyle.bind(window)
  vi.stubGlobal('getComputedStyle', (el: Element, pseudo?: string | null) => {
    const cs = real(el, pseudo)
    if (el !== page) return cs
    return new Proxy(cs, {
      get: (target, key) => {
        if (key === 'overflowX' || key === 'overflowY') return page.style[key] || 'visible'
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  uninstall = installPageOverscroll(root)
})

afterEach(() => {
  uninstall()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('a header drawn in the page', () => {
  it('stays where it was while the page is pulled past its top', () => {
    const header = document.getElementById('header')!
    inFlowHeader(header)
    const content = document.getElementById('content')!

    touch('touchstart', content, 100)
    for (const y of [130, 180, 260, 340]) {
      touch('touchmove', content, y)
      expect(px(root.style.top)).toBeGreaterThan(0)
      expect(headerTop(header)).toBeCloseTo(0, 1)
    }
  })

  it('stays where it was past the bottom too, drawn over the content sliding under it', () => {
    const header = document.getElementById('header')!
    inFlowHeader(header)
    const content = document.getElementById('content')!

    touch('touchstart', content, 600)
    touch('touchmove', content, 560)
    touch('touchmove', content, 420)
    expect(px(root.style.top)).toBeLessThan(0)
    expect(headerTop(header)).toBeCloseTo(0, 1)
    expect(header.style.position).toBe('relative')
    expect(Number(header.style.zIndex)).toBeGreaterThan(0)
  })

  it('stays put through the spring home, and is handed back untouched once home', () => {
    const header = document.getElementById('header')!
    inFlowHeader(header)
    const content = document.getElementById('content')!

    touch('touchstart', content, 100)
    touch('touchmove', content, 300)
    touch('touchend', content, 300)
    frames.splice(0).forEach(cb => { clock += 16; cb(clock) })
    expect(px(root.style.top)).toBeGreaterThan(0)
    expect(headerTop(header)).toBeCloseTo(0, 1)

    settle()
    expect(root.style.top).toBe('')
    expect(header.style.top).toBe('')
    expect(header.style.position).toBe('')
    expect(header.style.zIndex).toBe('')
  })

  it('is not cut off by a page that clips its own box, and the clip comes back after', () => {
    const header = document.getElementById('header')!
    inFlowHeader(header)
    const content = document.getElementById('content')!

    touch('touchstart', content, 100)
    touch('touchmove', content, 300)
    expect(page.style.overflowY).toBe('visible')
    expect(page.style.overflowX).toBe('visible')

    touch('touchend', content, 300)
    settle()
    expect(page.style.overflowY).toBe('hidden')
    expect(page.style.overflowX).toBe('hidden')
  })

  it('leaves a clip alone when something is actually spilling out of it', () => {
    const header = document.getElementById('header')!
    inFlowHeader(header)
    Object.defineProperty(page, 'scrollHeight', { configurable: true, get: () => 1200 })
    Object.defineProperty(page, 'clientHeight', { configurable: true, get: () => 844 })
    const content = document.getElementById('content')!

    touch('touchstart', content, 100)
    touch('touchmove', content, 300)
    expect(page.style.overflowY).toBe('hidden')
    expect(headerTop(header)).toBeCloseTo(0, 1)
  })
})

describe('a header that is already fixed', () => {
  it('is left alone — it never moved with the page', () => {
    const header = document.getElementById('header')!
    fixedHeader(header)
    const content = document.getElementById('content')!

    touch('touchstart', content, 100)
    touch('touchmove', content, 300)
    expect(px(root.style.top)).toBeGreaterThan(0)
    expect(header.style.top).toBe('')
    expect(header.style.position).toBe('')
    expect(page.style.overflowY).toBe('hidden')
  })
})
