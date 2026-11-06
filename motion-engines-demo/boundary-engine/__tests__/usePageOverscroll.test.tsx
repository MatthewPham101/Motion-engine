import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageOverscroll } from '../usePageOverscroll'
import { PAGE_OVERSCROLL_ACTIVE_ATTR } from '../pageOverscroll'

// Phone apps only. The website keeps the browser's own overscroll, and with the band not installed
// the stylesheet leaves that overscroll alone, because it keys off the attribute the band sets on <html>.

afterEach(() => { document.body.innerHTML = '' })

describe('usePageOverscroll', () => {
  it('installs on the phone apps', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const { unmount } = renderHook(() => usePageOverscroll(true))
    expect(document.documentElement.hasAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)).toBe(true)
    unmount()
    expect(document.documentElement.hasAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)).toBe(false)
  })

  it('does nothing on the website', () => {
    document.body.innerHTML = '<div id="root"></div>'
    renderHook(() => usePageOverscroll(false))
    expect(document.documentElement.hasAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)).toBe(false)
  })
})
