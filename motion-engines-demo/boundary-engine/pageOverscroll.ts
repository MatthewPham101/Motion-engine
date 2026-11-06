// Rubber-band overscroll for every page in the app, on web and on phones.
//
// Every screen pulls past its top and bottom on the rubber band (see rubberBand.ts, with
// d as the screen's height) and springs home on release. It gets installed once on the
// app's root element, so pages don't need to do anything and can't drift apart.
//
// This replaces the platforms' own behavior, because they all disagreed. iOS's WebView
// only bounced long pages, Android stretched or glowed, a phone browser held still, and
// desktop did whatever its browser felt like. While this is installed it stamps
// data-page-overscroll on <html> and the stylesheet (boundary.css) turns off the native
// overscroll. On iOS, the WebView's `bounces` is off too. That way the two never stack,
// and a page without this keeps its native behavior instead of having none at all.
//
// Three kinds of input drive it:
//   touch  Dragging against an end pulls the page with the finger, through the band, and
//          it springs back on release. A finger landing on a page that's still springing
//          back catches it where it is.
//   fling  A momentum scroll that arrives at an end carries the page a little past it and
//          back, like the bounce at the end of a flick.
//   wheel  A wheel or trackpad pushing past an end pulls the page the same way, and it
//          returns once the wheel goes quiet.
//
// The header holds its place. On most screens it's fixed and the offset doesn't touch it,
// but some screens draw it inside the page, where it used to get dragged along with
// everything else. So anything with data-app-header that turns out to travel with the page
// gets moved back by the same amount each frame (see holdChrome).
//
// Things that never get pulled: the header and anything else position: fixed, anything
// inside a list that scrolls on its own (it keeps its own end), a sideways swipe, an element
// that owns its vertical gestures (touch-action: none or pan-x), a page behind an open
// sheet, and anything marked data-no-page-overscroll.
//
// How the page moves matters. It uses position: relative with a `top` on the root, never a
// transform. A transform would make the root the containing block for every fixed element
// inside it, so at the bottom of a long page the header would get drawn at the top of the
// document, off screen. A relative offset moves the content and leaves fixed elements alone,
// which is how iOS rubber-bands under a fixed bar.
//
// Distances in here are layout px. Pointer and window scroll values arrive in screen px and
// get converted once, at the edge (see layoutPx.ts).

import { toLayoutPx } from './layoutPx'
import { isAtRest, springStep } from '../spring-engine'
import type { Motion } from '../spring-engine'
import { rubberBandInverse } from './rubberBand'
import {
  MAX_WHEEL_PULL_SHARE,
  MIN_ARRIVAL_SPEED_PX_S,
  OVERSCROLL_RETURN_SPRING,
  WHEEL_RELEASE_MS,
  arrivalBounceVelocity,
  overscrollOffset,
  pushedEnd,
  wheelDeltaPx,
  END_TOLERANCE_PX,
} from './pageOverscrollMath'
import type { PageScroll } from './pageOverscrollMath'

/** Put on an element whose touches must never pull the page. */
export const PAGE_OVERSCROLL_OPT_OUT_ATTR = 'data-no-page-overscroll'

/** Spread this on a page's root to keep the whole page still, with no pull and no bounce
 *  at the end of a fling: <div {...noPageOverscroll}>. */
export const noPageOverscroll = { [PAGE_OVERSCROLL_OPT_OUT_ATTR]: 'page' } as const

/** Set on <html> while installed. The stylesheet turns off native overscroll for exactly
 *  that long (boundary.css). */
export const PAGE_OVERSCROLL_ACTIVE_ATTR = 'data-page-overscroll'

/** Movement under this doesn't tell us which way a gesture is going yet. */
const SLOP_PX = 4
/** For this long after a finger lifts, a scroll arriving at an end counts as that finger's fling. */
const FLING_WINDOW_MS = 2500
/** A scroll sample older than this says nothing about the current speed. */
const STALE_SAMPLE_MS = 120
/** Below this the page counts as home, and the inline styles get handed back. */
const AT_HOME_PX = 0.25

/** What keeps its place on screen while the page is pulled. */
const HELD_CHROME_SELECTOR = '[data-app-header]'
/** How far the page has to be away before we check whether the header went with it. Far
 *  enough that rounding can't look like travel, close enough that nobody sees it move first. */
const HOLD_DECIDE_PX = 2
/** A held header gets lifted over the page's content, which slides under it past the bottom.
 *  This puts it over page chrome but under sheets and menus. */
const HELD_CHROME_Z_INDEX = '950'

interface HeldChrome {
  readonly el: HTMLElement
  readonly saved: { position: string; top: string; zIndex: string }
  /** Where its own `top` sits before ours is added, for a header that's already relative. */
  readonly base: number
  /** Ancestors that would have clipped it, opened up while the page is away from home. */
  readonly unclipped: ReadonlyArray<{ el: HTMLElement; x: string; y: string }>
}

interface TouchGesture {
  startX: number
  startY: number
  /** The last clientY seen, in screen px. */
  lastY: number
  /** Still allowed to pull the page. False once it turns out to be a sideways swipe. */
  eligible: boolean
  /** Past the slop, so its direction is known. */
  decided: boolean
  /** Pulling the page right now. */
  engaged: boolean
  /** Engaged from its first move, so its moves are held back from the browser. */
  held: boolean
  /** Pulled back across the end in a held gesture, so the page gets scrolled by hand. */
  scrollingByHand: boolean
  /** How far past the end, in layout px. Positive is past the top, negative past the bottom. */
  pull: number
}

interface ScrollSample {
  y: number
  t: number
  /** px/s, positive is toward the bottom. */
  v: number
}

class PageOverscroll {
  private offset = 0
  private motion: Motion | null = null
  private frame = 0
  private last = 0
  private touch: TouchGesture | null = null
  private wheel: { pull: number; timer: ReturnType<typeof setTimeout> | undefined } | null = null
  private sample: ScrollSample | null = null
  private lastTouchEndAt = Number.NEGATIVE_INFINITY
  private readonly content: HTMLElement
  private readonly saved: { position: string; top: string }
  /** html's and body's own backgrounds while the gap is painted, null otherwise. */
  private ground: { html: string; body: string } | null = null
  /** Each header's screen top at home, until we know whether it travels. */
  private chromeAtHome: Array<{ el: HTMLElement; top: number }> | null = null
  /** The headers being held in place during this pull. */
  private held: HeldChrome[] = []

  constructor(content: HTMLElement) {
    this.content = content
    this.saved = { position: content.style.position, top: content.style.top }
  }

  attach(): void {
    document.documentElement.setAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR, '')
    window.addEventListener('touchstart', this.onTouchStart, { passive: true, capture: true })
    // Not passive: a pull that starts at an end has to hold the page still, with no native
    // scroll under the band. The handler returns right away otherwise.
    window.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true })
    window.addEventListener('touchend', this.onTouchEnd, { passive: true, capture: true })
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: true, capture: true })
    window.addEventListener('wheel', this.onWheel, { passive: true })
    window.addEventListener('scroll', this.onScroll, { passive: true })
    document.addEventListener('visibilitychange', this.onHidden)
  }

  detach(): void {
    window.removeEventListener('touchstart', this.onTouchStart, { capture: true })
    window.removeEventListener('touchmove', this.onTouchMove, { capture: true })
    window.removeEventListener('touchend', this.onTouchEnd, { capture: true })
    window.removeEventListener('touchcancel', this.onTouchEnd, { capture: true })
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('scroll', this.onScroll)
    document.removeEventListener('visibilitychange', this.onHidden)
    if (this.wheel) clearTimeout(this.wheel.timer)
    this.stopSpring()
    this.setOffset(0)
    document.documentElement.removeAttribute(PAGE_OVERSCROLL_ACTIVE_ATTR)
  }

  // Touch

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      // A second finger is a pinch, not a pull.
      if (this.touch?.engaged) this.release()
      this.touch = null
      return
    }
    const t = e.touches[0]
    const eligible = this.canPullFrom(e.target, true)
    const gesture: TouchGesture = {
      startX: t.clientX, startY: t.clientY, lastY: t.clientY,
      eligible, decided: false, engaged: false, held: false, scrollingByHand: false, pull: 0,
    }
    // Landing on a page that's still springing home catches it. The finger takes it where
    // it's visible and carries on, the way a UIScrollView does.
    if (eligible && this.offset !== 0) {
      this.stopSpring()
      gesture.decided = true
      gesture.engaged = true
      gesture.held = true
      gesture.pull = Math.sign(this.offset) * rubberBandInverse(Math.abs(this.offset), this.dimension())
    }
    this.touch = gesture
  }

  private onTouchMove = (e: TouchEvent) => {
    const g = this.touch
    if (!g || !g.eligible || e.touches.length !== 1) return
    const t = e.touches[0]
    const screenDy = t.clientY - g.lastY
    g.lastY = t.clientY
    const dy = toLayoutPx(screenDy)

    if (g.scrollingByHand) {
      window.scrollBy(0, -screenDy)
      if (e.cancelable) e.preventDefault()
      return
    }

    if (!g.decided) {
      const dx = t.clientX - g.startX
      const dyTotal = t.clientY - g.startY
      if (Math.hypot(dx, dyTotal) < SLOP_PX) return
      g.decided = true
      // A sideways swipe belongs to a carousel or a row, not the page.
      if (Math.abs(dx) > Math.abs(dyTotal)) {
        g.eligible = false
        return
      }
    }

    if (!g.engaged) {
      if (dy === 0 || !pushedEnd(dy, this.scroll())) return
      g.engaged = true
      g.pull = 0
      // From its first move the gesture is ours and the browser knows it. A gesture that reached
      // the end mid-scroll can't be held anymore, but it doesn't need to be, since at the end
      // there's nothing left to scroll.
      g.held = e.cancelable
    }

    // The browser is scrolling this gesture too and it turned back inward. Let the page go now
    // instead of moving it twice (the band and the scroll).
    if (!g.held && dy !== 0 && Math.sign(dy) !== Math.sign(g.pull) && g.pull !== 0) {
      g.engaged = false
      g.pull = 0
      this.release()
      return
    }

    const pull = g.pull + dy
    if (g.pull !== 0 && (pull === 0 || Math.sign(pull) !== Math.sign(g.pull))) {
      // Back across the end. A held gesture never scrolls natively again, because WebKit decides
      // that on the first move, so the rest of it scrolls the page by hand. Anything else hands
      // over to the browser.
      this.setOffset(0)
      g.pull = 0
      g.engaged = false
      if (g.held) {
        g.scrollingByHand = true
        // Only the part of this move that went past the end scrolls.
        window.scrollBy(0, -screenDy * (Math.abs(pull) / Math.abs(dy)))
        if (e.cancelable) e.preventDefault()
      }
      return
    }

    g.pull = pull
    if (e.cancelable) e.preventDefault()
    this.setOffset(overscrollOffset(pull, this.dimension()))
  }

  private onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return
    this.lastTouchEndAt = performance.now()
    const g = this.touch
    this.touch = null
    if (g?.engaged || (g?.eligible && this.offset !== 0)) this.release()
  }

  // Wheel and trackpad

  private onWheel = (e: WheelEvent) => {
    // ctrl + wheel is a trackpad pinch (zoom), and a touch in progress owns the page.
    if (e.ctrlKey || this.touch) return
    const dimension = this.dimension()
    const dy = -toLayoutPx(wheelDeltaPx(e.deltaY, e.deltaMode, dimension))
    if (dy === 0) return

    if (!this.wheel) {
      if (!this.canPullFrom(e.target, false) || !pushedEnd(dy, this.scroll())) return
      this.stopSpring()
      this.wheel = { pull: Math.sign(this.offset) * rubberBandInverse(Math.abs(this.offset), dimension), timer: undefined }
    } else if (this.wheel.pull !== 0 && Math.sign(dy) !== Math.sign(this.wheel.pull)) {
      // Scrolling back inward: the page goes home and the browser takes over scrolling.
      this.endWheel()
      return
    }

    const cap = MAX_WHEEL_PULL_SHARE * dimension
    this.wheel.pull = Math.max(-cap, Math.min(cap, this.wheel.pull + dy))
    this.setOffset(overscrollOffset(this.wheel.pull, dimension))
    clearTimeout(this.wheel.timer)
    this.wheel.timer = setTimeout(this.endWheel, WHEEL_RELEASE_MS)
  }

  private endWheel = () => {
    if (!this.wheel) return
    clearTimeout(this.wheel.timer)
    this.wheel = null
    this.release()
  }

  // A fling arriving at an end

  private onScroll = () => {
    const now = performance.now()
    const y = toLayoutPx(window.scrollY)
    const prev = this.sample
    const fresh = prev && now - prev.t < STALE_SAMPLE_MS && now > prev.t
    const v = fresh ? 0.6 * ((y - prev.y) / ((now - prev.t) / 1000)) + 0.4 * prev.v : 0
    this.sample = { y, t: now, v }
    if (!prev || !fresh) return

    if (this.touch || this.wheel || this.offset !== 0 || this.motion) return
    if (now - this.lastTouchEndAt > FLING_WINDOW_MS || prefersReducedMotion()) return
    // A page that holds still doesn't bounce either.
    if (this.content.querySelector(`[${PAGE_OVERSCROLL_OPT_OUT_ATTR}="page"]`)) return
    if (Math.abs(v) < MIN_ARRIVAL_SPEED_PX_S) return

    const { max } = this.scroll()
    const arrivedTop = v < 0 && y <= END_TOLERANCE_PX && prev.y > END_TOLERANCE_PX
    const arrivedBottom = v > 0 && y >= max - END_TOLERANCE_PX && prev.y < max - END_TOLERANCE_PX
    if (!arrivedTop && !arrivedBottom) return
    if (document.body.style.overflow === 'hidden') return

    this.motion = { x: 0, v: arrivalBounceVelocity(v, this.dimension()) }
    this.run()
  }

  private onHidden = () => {
    if (document.visibilityState !== 'hidden') return
    this.touch = null
    if (this.wheel) clearTimeout(this.wheel.timer)
    this.wheel = null
    this.stopSpring()
    this.setOffset(0)
  }

  // The spring home

  private release() {
    if (this.offset === 0) return
    this.motion = { x: this.offset, v: this.motion?.v ?? 0 }
    this.run()
  }

  private run() {
    if (this.frame) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    const dt = Math.max(0, (now - this.last) / 1000)
    this.last = now
    const motion = this.motion
    if (!motion) {
      this.frame = 0
      return
    }
    const next = springStep(motion, 0, OVERSCROLL_RETURN_SPRING, dt)
    if (isAtRest(next, 0)) {
      this.motion = null
      this.frame = 0
      this.setOffset(0)
      return
    }
    this.motion = next
    this.setOffset(next.x)
    this.frame = requestAnimationFrame(this.tick)
  }

  private stopSpring() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.motion = null
  }

  // Reading and writing the page

  private setOffset(offset: number) {
    const style = this.content.style
    if (Math.abs(offset) < AT_HOME_PX) {
      if (this.offset !== 0 || style.top !== this.saved.top) {
        style.top = this.saved.top
        style.position = this.saved.position
      }
      this.releaseChrome()
      this.unpaintGround()
      this.offset = 0
      return
    }
    if (this.offset === 0) {
      this.chromeAtHome = this.measureChrome()
      this.paintGround()
    }
    this.offset = offset
    if (style.position !== 'relative') style.position = 'relative'
    style.top = `${offset.toFixed(2)}px`
    if (this.chromeAtHome && Math.abs(offset) >= HOLD_DECIDE_PX) this.holdChrome(offset)
    for (const h of this.held) h.el.style.top = `${(h.base - offset).toFixed(2)}px`
  }

  // The header holds its place
  //
  // This gets decided by measuring, once per pull. A header that moved with the page is in
  // its flow, and one that didn't is fixed (or inside something fixed) and gets left alone.
  // That handles every layout we have without keeping a list of which page draws what.
  //
  // It's held with a relative `top` rather than a transform, because page transitions animate
  // the same element's transform and would override ours.

  private measureChrome(): Array<{ el: HTMLElement; top: number }> {
    return Array.from(this.content.querySelectorAll<HTMLElement>(HELD_CHROME_SELECTOR))
      .map(el => ({ el, top: el.getBoundingClientRect().top }))
  }

  private holdChrome(offset: number) {
    const atHome = this.chromeAtHome ?? []
    this.chromeAtHome = null
    for (const { el, top } of atHome) {
      if (!el.isConnected) continue
      const travelled = toLayoutPx(el.getBoundingClientRect().top - top)
      if (Math.abs(travelled - offset) > Math.abs(offset) / 2) continue
      const computed = getComputedStyle(el)
      if (computed.position !== 'static' && computed.position !== 'relative') continue
      const saved = { position: el.style.position, top: el.style.top, zIndex: el.style.zIndex }
      const base = computed.position === 'relative' ? parseFloat(el.style.top) || 0 : 0
      el.style.position = 'relative'
      el.style.zIndex = HELD_CHROME_Z_INDEX
      this.held.push({ el, saved, base, unclipped: this.unclip(el) })
    }
  }

  /**
   * Opens up ancestors that would cut off a held header. A screen sized to the viewport clips
   * its own box, and the header gets held above that box while the page is pulled down. Only
   * boxes with no overflow and no scroll offset get opened, since for those the clip wasn't
   * doing anything else.
   */
  private unclip(el: HTMLElement): HeldChrome['unclipped'] {
    const opened: Array<{ el: HTMLElement; x: string; y: string }> = []
    for (let a = el.parentElement; a; a = a.parentElement) {
      const style = getComputedStyle(a)
      const clips = style.overflowY !== 'visible'
      const quiet = a.scrollTop === 0 && a.scrollLeft === 0
        && a.scrollHeight <= a.clientHeight + 1 && a.scrollWidth <= a.clientWidth + 1
      if (clips && quiet) {
        opened.push({ el: a, x: a.style.overflowX, y: a.style.overflowY })
        a.style.overflowX = 'visible'
        a.style.overflowY = 'visible'
      }
      if (a === this.content) break
    }
    return opened
  }

  private releaseChrome() {
    this.chromeAtHome = null
    for (const { el, saved, unclipped } of this.held) {
      el.style.position = saved.position
      el.style.top = saved.top
      el.style.zIndex = saved.zIndex
      for (const u of unclipped) {
        // Only restore what's still ours, since a render may have set its own value since then.
        if (u.el.style.overflowX === 'visible') u.el.style.overflowX = u.x
        if (u.el.style.overflowY === 'visible') u.el.style.overflowY = u.y
      }
    }
    this.held = []
  }

  // The gap's color
  //
  // A page pulled away from its end uncovers what's behind it, which is the document's white
  // background, so a grey page showed a white band. While the page is away from home, html and
  // body wear the page's own background color, read off the page, so the gap matches.

  private paintGround() {
    const color = groundColorOf(this.content)
    if (!color) return
    const html = document.documentElement.style
    const body = document.body.style
    this.ground = { html: html.backgroundColor, body: body.backgroundColor }
    html.backgroundColor = color
    body.backgroundColor = color
  }

  private unpaintGround() {
    if (!this.ground) return
    document.documentElement.style.backgroundColor = this.ground.html
    document.body.style.backgroundColor = this.ground.body
    this.ground = null
  }

  /** The band's `d`: the screen's height in layout px. */
  private dimension(): number {
    const el = document.scrollingElement ?? document.documentElement
    return el.clientHeight || toLayoutPx(window.innerHeight)
  }

  private scroll(): PageScroll {
    const el = document.scrollingElement ?? document.documentElement
    return {
      top: toLayoutPx(window.scrollY),
      max: Math.max(0, el.scrollHeight - el.clientHeight),
    }
  }

  /**
   * Whether a gesture that began on `target` can pull the page. It's asked once per gesture,
   * walking up from the target to the root.
   */
  private canPullFrom(target: EventTarget | null, touch: boolean): boolean {
    if (!(target instanceof Element) || !this.content.contains(target)) return false
    // A sheet is open, so the page behind it is locked.
    if (document.body.style.overflow === 'hidden') return false
    // A native view (like a live map) shows through a transparent page.
    if (document.documentElement.hasAttribute('data-native-view-active')) return false
    for (let el: Element | null = target; el && el !== this.content; el = el.parentElement) {
      if (el.hasAttribute(PAGE_OVERSCROLL_OPT_OUT_ATTR)) return false
      const style = getComputedStyle(el)
      if (style.position === 'fixed') return false
      if (touch && (style.touchAction === 'none' || style.touchAction === 'pan-x')) return false
      if (scrollsOnItsOwn(el as HTMLElement, style)) return false
    }
    return true
  }
}

const isTransparent = (color: string) =>
  !color || color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color)

/**
 * The color a page is painted on: the first opaque background, walking out from a point at
 * the screen's left edge, that spans the screen edge to edge. That finds the page's background
 * and not a card on it, because cards sit inside the page gutter. Fixed elements get skipped.
 * Falls back to the body's color, then the document's.
 */
function groundColorOf(content: HTMLElement): string {
  const width = window.innerWidth
  const hits = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(2, Math.round(window.innerHeight / 2))
    : []
  for (const hit of hits) {
    if (!content.contains(hit)) continue
    let fixed = false
    for (let el: Element | null = hit; el && el !== content; el = el.parentElement) {
      if (getComputedStyle(el).position === 'fixed') { fixed = true; break }
    }
    if (fixed) continue
    for (let el: Element | null = hit; el; el = el.parentElement) {
      const color = getComputedStyle(el).backgroundColor
      if (isTransparent(color)) continue
      // It has to be edge to edge. A card inset 16px on each side is still 92% of a 390px phone,
      // so checking for a share of the width would mistake it for the background.
      const box = el.getBoundingClientRect()
      if (box.left <= 2 && box.right >= width - 2) return color
    }
  }
  const body = getComputedStyle(document.body).backgroundColor
  return isTransparent(body) ? getComputedStyle(document.documentElement).backgroundColor : body
}

/** An element with its own vertical scroll that actually has somewhere to go. */
function scrollsOnItsOwn(el: HTMLElement, style: CSSStyleDeclaration): boolean {
  const overflowY = style.overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false
  return el.scrollHeight > el.clientHeight + 1
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Gives every page the rubber band past its ends. `content` is the element that moves,
 * usually the app's root, because its relative offset leaves fixed elements in place.
 * Returns the uninstall function.
 */
export function installPageOverscroll(content: HTMLElement): () => void {
  const controller = new PageOverscroll(content)
  controller.attach()
  return () => controller.detach()
}
