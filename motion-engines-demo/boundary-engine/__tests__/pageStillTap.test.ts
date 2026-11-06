import { describe, it, expect, afterEach } from 'vitest'
import { holdPageStill, resetPageStillForTests, STILL_TAP_SLOP_PX } from '../index'

// A still page has to keep its taps. iOS WebKit drops the click of any touch whose touchmove was
// prevented, and a real finger always moves a little, so refusing the first move made buttons
// take many tries to open. I reproduced it in the iOS simulator, where a 3pt slide failed every time.

function touch(type: string, target: Element, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] })
  target.dispatchEvent(e)
  return e
}

afterEach(() => {
  resetPageStillForTests()
  document.body.innerHTML = ''
})

function stillPage() {
  const page = document.createElement('div')
  const circle = document.createElement('button')
  page.appendChild(circle)
  document.body.appendChild(page)
  return { page, circle, release: holdPageStill(page) }
}

describe('a still page and a tap', () => {
  it('leaves a finger that wobbles inside a tap alone, so its click still comes', () => {
    const { circle } = stillPage()
    touch('touchstart', circle, 100, 300)
    expect(touch('touchmove', circle, 103, 301).defaultPrevented).toBe(false)
    expect(touch('touchmove', circle, 100 + STILL_TAP_SLOP_PX - 1, 300).defaultPrevented).toBe(false)
  })

  it('refuses the drag once the finger has left a tap behind — and for the rest of it', () => {
    const { circle } = stillPage()
    touch('touchstart', circle, 100, 300)
    expect(touch('touchmove', circle, 100, 300 + STILL_TAP_SLOP_PX).defaultPrevented).toBe(true)
    // Back inside the slop it is still a drag, not a tap again.
    expect(touch('touchmove', circle, 100, 302).defaultPrevented).toBe(true)
  })

  it('measures each touch from where IT landed', () => {
    const { circle } = stillPage()
    touch('touchstart', circle, 100, 300)
    touch('touchmove', circle, 100, 360)
    touch('touchstart', circle, 200, 500)
    expect(touch('touchmove', circle, 203, 500).defaultPrevented).toBe(false)
  })

  it('takes the browser’s own pan and zoom away from the page while held, and gives them back', () => {
    const { page, release } = stillPage()
    page.style.touchAction = ''
    const held = document.createElement('div')
    held.style.touchAction = 'pan-y'
    document.body.appendChild(held)
    const releaseHeld = holdPageStill(held)
    expect(held.style.touchAction).toBe('none')
    releaseHeld()
    expect(held.style.touchAction).toBe('pan-y')
    release()
  })
})
