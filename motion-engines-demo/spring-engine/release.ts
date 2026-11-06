// What a gesture hands to its landing spring when the finger lifts: the projection of where a
// flick was trying to go, the landing rule built on it, and the cap on how much speed a landing
// can carry.

/**
 * The most speed a release can carry into its landing spring.
 *
 * Overshoot scales with the velocity given to the spring, and a hard flick gives it a lot. Without
 * a cap, a damping of 0.64 threw a row 78px past a 144px tray. The cap makes the spring-back
 * consistent (about 3px when slow, 10px when flicked) instead of depending on how hard someone
 * happened to swipe.
 *
 * This only applies to the landing. `project` still sees the true velocity, so a flick can open a
 * row that a slow drag wouldn't. The flick decides where it lands, not how it arrives.
 */
export const MAX_LANDING_SPEED = 1200

/** `velocity`, limited to what a landing can carry. Direction is kept. */
export function carriedVelocity(velocity: number): number {
  return Math.sign(velocity) * Math.min(Math.abs(velocity), MAX_LANDING_SPEED)
}

/** UIScrollView's fast deceleration rate, per millisecond. Short travel wants this one, because
 *  `normal` (0.998) projects a flick about five times further, which is fine for a page of content
 *  and absurd for a 150px tray. */
export const DECELERATION_FAST = 0.99

/**
 * Where a release was headed if left to decelerate. This is Apple's projection from WWDC 2018's
 * "Designing Fluid Interfaces". It lets one rule handle both flicks and slow drags: land on
 * whichever end the projected point is closer to. `velocity` is in px/s.
 */
export function project(x: number, velocity: number, rate = DECELERATION_FAST): number {
  return x + (velocity / 1000) * (rate / (1 - rate))
}

/**
 * Where a released pane should land: `resting` (tray open) or 0 (shut).
 *
 * `resting` is the signed rest position of the one tray this gesture can reach. The caller picks
 * it, and passing 0 means there's nothing to open. There are two rules, and the second is easy to
 * forget: the release has to be projected past halfway, and it has to be projected in the same
 * direction. Without the direction check, a hard flick back across an open row lands on the tray
 * it was being flicked away from.
 */
export function landingOffset(offset: number, velocity: number, resting: number): number {
  if (resting === 0) return 0
  const projected = project(offset, velocity)
  const committed = Math.sign(projected) === Math.sign(resting)
    && Math.abs(projected) >= Math.abs(resting) / 2
  return committed ? resting : 0
}
