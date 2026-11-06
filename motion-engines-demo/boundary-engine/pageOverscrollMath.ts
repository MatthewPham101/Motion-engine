// The numbers behind pageOverscroll.ts: which end a gesture is pushing against, how far the
// page follows, how a fling arriving at an end becomes a bounce, and how wheel input gets
// measured. There's no DOM or React in here. This is the part that's easy to get subtly
// wrong, so it's kept pure and tested with plain numbers.

import type { Spring } from '../spring-engine'
import { rubberBand, RUBBER_BAND_CONSTANT } from './rubberBand'

/** Which end of the page a gesture is pushing past. */
export type PageEnd = 'top' | 'bottom'

/** Closer than this to an end counts as being at it, because of sub-pixel scroll offsets. */
export const END_TOLERANCE_PX = 1

/**
 * How the page comes back after release: critically damped, the way a UIScrollView settles.
 * No overshoot, since that would show the other end's gap for a frame, and quick enough to
 * look like the page snapping home rather than drifting.
 */
export const OVERSCROLL_RETURN_SPRING: Spring = { response: 0.4, damping: 1 }

/** Scroll metrics in one unit: where the page is and how far it goes. */
export interface PageScroll {
  /** Distance scrolled from the top. */
  readonly top: number
  /** The furthest it can scroll. 0 for a page that fits the screen. */
  readonly max: number
}

/**
 * The end a vertical movement `dy` (finger travel, positive is down) is pushing against, or
 * null if the page can still scroll that way.
 *
 * Dragging down at the top pulls past the top, and dragging up at the bottom pulls past the
 * bottom. A page that fits the screen is at both ends at once, so either direction pulls,
 * the same way iOS lets a short page bounce.
 */
export function pushedEnd(dy: number, scroll: PageScroll): PageEnd | null {
  if (dy > 0 && scroll.top <= END_TOLERANCE_PX) return 'top'
  if (dy < 0 && scroll.top >= scroll.max - END_TOLERANCE_PX) return 'bottom'
  return null
}

/**
 * Where the page gets drawn for a signed pull. Positive is past the top (the page moves
 * down), negative is past the bottom (it moves up). `screenHeight` is the band's `d`.
 */
export function overscrollOffset(pull: number, screenHeight: number): number {
  return Math.sign(pull) * rubberBand(Math.abs(pull), screenHeight)
}

/**
 * The most a fling arriving at an end can carry the page past it, as a share of the screen.
 * A real flick into the top of a long list arrives at several thousand px/s, and uncapped
 * that would throw the page a third of the screen. iOS's own bounce stays around this.
 */
export const MAX_ARRIVAL_BOUNCE_SHARE = 0.1

/**
 * The initial velocity (px/s, positive moves the page down) of the bounce when a fling
 * arrives at an end at `scrollVelocity` (px/s, positive is scrolling toward the bottom).
 *
 * The page keeps going the way it was traveling, since scrolling up into the top moves the
 * content down past it. It uses the band's `c` of the arrival speed, capped so it peaks at
 * MAX_ARRIVAL_BOUNCE_SHARE of the screen. A critically damped spring launched from its rest
 * position at velocity v peaks at v / (omega * e), which is what the cap solves for.
 */
export function arrivalBounceVelocity(scrollVelocity: number, screenHeight: number, spring = OVERSCROLL_RETURN_SPRING): number {
  if (screenHeight <= 0) return 0
  const omega = (2 * Math.PI) / spring.response
  const ceiling = MAX_ARRIVAL_BOUNCE_SHARE * screenHeight * omega * Math.E
  const v = -scrollVelocity * RUBBER_BAND_CONSTANT
  return Math.sign(v) * Math.min(Math.abs(v), ceiling)
}

/** Below this speed, an arrival is a scroll coming to rest at the end, not a fling. */
export const MIN_ARRIVAL_SPEED_PX_S = 600

// Wheel and trackpad

/** WheelEvent.deltaMode values. */
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
/** How many px a "line" of wheel travel means in browsers that report lines. */
const LINE_PX = 16

/** A wheel event's vertical travel in px, whatever unit it was reported in. */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === DOM_DELTA_LINE) return deltaY * LINE_PX
  if (deltaMode === DOM_DELTA_PAGE) return deltaY * pageHeight
  return deltaY
}

/**
 * A trackpad's momentum keeps sending wheel events after the fingers lift. Flung into an end,
 * that would pull the page as far as a deliberate drag of thousands of pixels. So wheel pull
 * is capped at this share of the screen, which through the band is about 16% of its height.
 */
export const MAX_WHEEL_PULL_SHARE = 0.35

/** After this long with no wheel events past an end, the page returns. */
export const WHEEL_RELEASE_MS = 140
