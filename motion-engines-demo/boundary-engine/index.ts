// Boundary engine: offset = (1 - 1/(c*x/d + 1)) * d
//
// Everything that happens when something gets pushed past its end. Import from this file,
// not from the modules behind it.
//
//   rubberBand.ts          the formula, its inverse, and a soft clamp to a range
//   bounds.ts              a swipeable row between two trays
//   pageOverscrollMath.ts  a page pulled past its ends: which end, how far, the fling
//                          bounce, wheel input (just numbers)
//   pageOverscroll.ts      the same thing installed on a real element
//   usePageOverscroll.ts   a hook for it, mounted once at the app's root
//   pageStill.ts           the opposite: a page that neither pulls nor scrolls
//
// Releases are handled by the spring engine. The band decides how far past the end
// something goes, and the spring decides how it comes back.

export {
  RUBBER_BAND_CONSTANT, rubberBand, rubberBandClamp, rubberBandInverse, rubberBandSigned,
} from './rubberBand'

export { boundedOffset, MIN_RUBBER_DIMENSION } from './bounds'

export {
  arrivalBounceVelocity, END_TOLERANCE_PX, MAX_ARRIVAL_BOUNCE_SHARE, MAX_WHEEL_PULL_SHARE,
  MIN_ARRIVAL_SPEED_PX_S, OVERSCROLL_RETURN_SPRING, overscrollOffset, pushedEnd, WHEEL_RELEASE_MS,
  wheelDeltaPx,
} from './pageOverscrollMath'
export type { PageEnd, PageScroll } from './pageOverscrollMath'

export {
  installPageOverscroll, noPageOverscroll, PAGE_OVERSCROLL_ACTIVE_ATTR, PAGE_OVERSCROLL_OPT_OUT_ATTR,
} from './pageOverscroll'

export { usePageOverscroll } from './usePageOverscroll'

export { holdPageStill, PAGE_STILL_ATTR, resetPageStillForTests, STILL_TAP_SLOP_PX, usePageStill } from './pageStill'
