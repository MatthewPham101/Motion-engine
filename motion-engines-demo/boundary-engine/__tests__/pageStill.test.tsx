import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { holdPageStill, PAGE_STILL_ATTR, resetPageStillForTests, usePageStill } from '../pageStill'

// A page that doesn't move at all.

function touch(type: string, target: Element, y: number, fingers = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: Array.from({ length: fingers }, () => ({ clientX: 100, clientY: y })) })
  target.dispatchEvent(e)
  return e
}

afterEach(() => {
  resetPageStillForTests()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('holdPageStill', () => {
  it('takes the document scroll away while held, and gives it back after', () => {
    const page = document.createElement('div')
    document.body.appendChild(page)
    const release = holdPageStill(page)
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(true)
    release()
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(false)
  })

  it('refuses a finger dragging the page — no scroll, no bounce', () => {
    const page = document.createElement('div')
    page.innerHTML = '<p id="card">Card</p>'
    document.body.appendChild(page)
    holdPageStill(page)
    const card = page.querySelector('#card')!
    touch('touchstart', card, 300)
    expect(touch('touchmove', card, 360).defaultPrevented).toBe(true)
    expect(touch('touchmove', card, 200).defaultPrevented).toBe(true)
  })

  it('leaves a list that scrolls on its own to scroll', () => {
    const page = document.createElement('div')
    page.innerHTML = '<div id="list" style="overflow-y: auto"><p id="row">Row</p></div>'
    document.body.appendChild(page)
    const list = page.querySelector<HTMLElement>('#list')!
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 900 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 })
    holdPageStill(page)
    const row = page.querySelector('#row')!
    touch('touchstart', row, 300)
    expect(touch('touchmove', row, 200).defaultPrevented).toBe(false)
  })

  it('leaves a pinch alone', () => {
    const page = document.createElement('div')
    document.body.appendChild(page)
    holdPageStill(page)
    touch('touchstart', page, 300, 2)
    expect(touch('touchmove', page, 360, 2).defaultPrevented).toBe(false)
  })

  it('stops refusing touches once released', () => {
    const page = document.createElement('div')
    document.body.appendChild(page)
    const release = holdPageStill(page)
    release()
    touch('touchstart', page, 300)
    expect(touch('touchmove', page, 360).defaultPrevented).toBe(false)
  })

  it('puts a page that arrived scrolled back at the top', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 240 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const page = document.createElement('div')
    document.body.appendChild(page)
    holdPageStill(page)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 })
  })

  it('keeps the document held while ANY still page is (two draw during a slide)', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    document.body.append(a, b)
    const releaseA = holdPageStill(a)
    const releaseB = holdPageStill(b)
    releaseA()
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(true)
    releaseB()
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(false)
  })
})

describe('usePageStill', () => {
  function Still() {
    const ref = useRef<HTMLDivElement>(null)
    usePageStill(ref)
    return <div ref={ref}>Dashboard</div>
  }

  it('holds the page for as long as it is mounted', () => {
    const { unmount } = render(<Still />)
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(true)
    unmount()
    expect(document.documentElement.hasAttribute(PAGE_STILL_ATTR)).toBe(false)
  })
})

describe('the stylesheet', () => {
  it('takes the document scroll and overscroll away under the attribute', () => {
    const css = readFileSync(resolve(__dirname, '../boundary.css'), 'utf8')
    const rule = css.match(/html\[data-page-still\],\s*html\[data-page-still\] body \{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/overflow:\s*hidden/)
    expect(rule![1]).toMatch(/overscroll-behavior:\s*none/)
  })
})
