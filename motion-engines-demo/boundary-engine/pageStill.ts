// A page that doesn't move at all: no scroll, no pull past its ends, no bounce, on the web,
// in a phone browser and in the apps. It's meant for a home screen laid out to fit the window.
//
// Opting out of the rubber band (noPageOverscroll) only gets you a third of the way there. The
// document can still scroll no matter what the page's own box does, and you can't turn off the
// platform's overscroll from inside a page. So while a still page is mounted:
//
//   - <html> gets data-page-still, and the stylesheet (boundary.css) takes away the document's
//     scroll and overscroll. A wheel, trackpad, keyboard or scrollbar has nothing to move.
//   - The page gets touch-action: none, so a finger on it never starts the browser's own pan or
//     zoom. An inner scroller is a fresh start, since browsers only intersect touch-action up
//     to the nearest scroller.
//   - A single finger dragging the page gets refused (touchmove preventDefault) once it's moved
//     past a tap (STILL_TAP_SLOP_PX). This covers engines without touch-action, and older iOS
//     builds where it's the only way to stop the WebView's bounce.
//
//     The slop is important. iOS WebKit drops the click of any touch whose touchmove was
//     prevented, and a real finger always moves a little. Refusing the very first move made
//     buttons take many tries to open. I reproduced this in the iOS simulator, where a 3pt slide
//     failed every time and a still press worked. Chromium clicks either way, so no Chrome-based
//     test could have caught it.
//   - The window gets scrolled back to the top in case it arrived scrolled.
//
// What still moves: anything inside the page that scrolls on its own, and sheets or menus opened
// over it, since those render outside the page. Pinch and multi-finger gestures are left alone.
//
// Measured in Chrome with CDP touches at 390x844: a held page moved 0px under a drag and a wheel
// that scrolled the same page 435px and 756px when not held, and an inner list still scrolled with
// the finger. The catch is that inner list loses its fling (125px vs 424px), which comes from the
// non-passive touch listener and not the stylesheet. If a page has an inner scroller, weigh that first.

import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Set on <html> while a still page is mounted (boundary.css reads it). */
export const PAGE_STILL_ATTR = 'data-page-still'

/** How far (px) a finger can travel and still count as a tap. iOS allows about this much. */
export const STILL_TAP_SLOP_PX = 10

/** How many still pages are mounted. The attribute stays while any are, and a page transition
 *  can draw two at once. */
let holders = 0

/**
 * Holds `page` still until the returned function is called. Safe to nest: the document gets
 * released when the last holder lets go.
 */
export function holdPageStill(page: HTMLElement): () => void {
  holders += 1
  document.documentElement.setAttribute(PAGE_STILL_ATTR, '')
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)

  const touchAction = page.style.touchAction
  page.style.touchAction = 'none'

  // Decided once per touch, where it lands. A finger starting in a list with room to scroll
  // belongs to that list.
  let ownsTouch = false
  let start = { x: 0, y: 0 }
  let tapping = false
  const onTouchStart = (e: TouchEvent) => {
    ownsTouch = e.touches.length === 1 && !landsInOwnScroller(e.target, page)
    const t = e.touches[0]
    if (t) start = { x: t.clientX, y: t.clientY }
    tapping = true
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!ownsTouch || e.touches.length !== 1) return
    const t = e.touches[0]
    if (tapping && Math.hypot(t.clientX - start.x, t.clientY - start.y) < STILL_TAP_SLOP_PX) return
    tapping = false
    if (e.cancelable) e.preventDefault()
  }
  page.addEventListener('touchstart', onTouchStart, { passive: true })
  // Not passive, because refusing the move is the whole point.
  page.addEventListener('touchmove', onTouchMove, { passive: false })

  let released = false
  return () => {
    if (released) return
    released = true
    page.removeEventListener('touchstart', onTouchStart)
    page.removeEventListener('touchmove', onTouchMove)
    page.style.touchAction = touchAction
    holders = Math.max(0, holders - 1)
    if (holders === 0) document.documentElement.removeAttribute(PAGE_STILL_ATTR)
  }
}

/** Holds the page `ref` points at still for as long as the caller is mounted. */
export function usePageStill(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const page = ref.current
    if (!enabled || !page) return
    return holdPageStill(page)
  }, [ref, enabled])
}

/** Whether a touch on `target` began inside something in `page` that scrolls on its own, in
 *  either direction, and has somewhere to go. */
function landsInOwnScroller(target: EventTarget | null, page: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  for (let el: Element | null = target; el && el !== page; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return true
    if (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth + 1) return true
  }
  return false
}

const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll'

/** Test seam. */
export function resetPageStillForTests(): void {
  holders = 0
  document.documentElement.removeAttribute(PAGE_STILL_ATTR)
}
