// The spring itself
//
//                         m*x'' = -k*x - b*x'
//
// A damped harmonic oscillator. x is the distance from where it's going, m is its mass, k is the
// stiffness (how hard it gets pulled home), and b is the damping (how much the motion is resisted).
// It's solved exactly in closed form rather than stepped, and everything else reads from here.
//
// Springs are authored the way SwiftUI does it, because that's how you judge motion by eye:
// `response` is the period of the undamped oscillation in seconds, roughly how long the move takes,
// and `damping` is the damping ratio (1 arrives without overshoot, below 1 overshoots and comes
// back). springPhysics converts that into m, k and b, where k = m*(2*pi/response)^2 and
// b = 2*zeta*sqrt(k*m). With m = 1 both descriptions are the same spring.
//
// Why use a spring when a CSS cubic-bezier can overshoot too? A bezier is a fixed shape over a fixed
// duration, so it always starts from a standstill. Release a fast flick into one and it visibly
// stalls for a frame and then speeds back up. A spring takes the finger's velocity as its initial
// condition, so the pixel under your thumb never changes speed on release. That's most of why iOS
// feels attached to your hand.

/** A spring as it's authored, in SwiftUI's terms. */
export interface Spring {
  /** Seconds. The period of the undamped oscillation, 2*pi*sqrt(m/k), and roughly how long the
   *  move takes. SwiftUI calls this `response`. */
  readonly response: number
  /** The damping ratio, b / (2*sqrt(k*m)). 1 settles with no overshoot (critically damped), and
   *  below 1 overshoots and comes back. */
  readonly damping: number
}

/** The same spring as the equation's own coefficients. */
export interface SpringPhysics {
  /** m */
  readonly mass: number
  /** k */
  readonly stiffness: number
  /** b, the damping coefficient (not the ratio). */
  readonly damping: number
}

/** m, k and b for an authored spring. Mass defaults to 1. A heavier mass with the same response
 *  is just a stiffer spring with the same motion. */
export function springPhysics(spring: Spring, mass = 1): SpringPhysics {
  const omega = (2 * Math.PI) / spring.response
  const stiffness = mass * omega * omega
  return { mass, stiffness, damping: 2 * spring.damping * Math.sqrt(stiffness * mass) }
}

/** The authored spring for a given m, k and b. */
export function springFromPhysics({ mass, stiffness, damping }: SpringPhysics): Spring {
  return {
    response: 2 * Math.PI * Math.sqrt(mass / stiffness),
    damping: damping / (2 * Math.sqrt(stiffness * mass)),
  }
}

/** A position and the speed it is moving at (px, px/s). */
export interface Motion {
  readonly x: number
  readonly v: number
}

/** The longest frame a step will honor. A backgrounded tab hands back a delta of several seconds,
 *  and the exact solution would land the motion in one frame, which looks like a glitch. */
const MAX_FRAME_S = 1 / 15

/** Within this of 1, the ratio is treated as exactly critical, which has its own formula. */
const CRITICAL_EPSILON = 1e-6

/**
 * Where a motion is `t` seconds after it was at `start`, heading for `target`. This is the exact
 * solution from that position and velocity, with three cases depending on the damping ratio z:
 *
 *   z < 1  underdamped  y = e^(-z*w0*t) * (y0*cos(wd*t) + (v0 + z*w0*y0)/wd * sin(wd*t))
 *   z = 1  critical     y = e^(-w0*t) * (y0 + (v0 + w0*y0)*t)
 *   z > 1  overdamped   y = C1*e^(r1*t) + C2*e^(r2*t), with r = -w0*(z -/+ sqrt(z^2 - 1))
 *
 * where y = x - target, w0 = sqrt(k/m) and wd = w0*sqrt(1 - z^2). Because it's exact, you get the
 * same motion at 30, 60 or 120Hz and on a late frame, with no step size to tune and nothing to drift.
 */
export function springAt(t: number, start: Motion, target: number, spring: Spring): Motion {
  const { mass, stiffness, damping } = springPhysics(spring)
  const omega0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const y0 = start.x - target
  const v0 = start.v
  if (t <= 0) return { x: start.x, v: start.v }

  if (Math.abs(zeta - 1) < CRITICAL_EPSILON) {
    const decay = Math.exp(-omega0 * t)
    const b = v0 + omega0 * y0
    return {
      x: target + (y0 + b * t) * decay,
      v: (b - omega0 * (y0 + b * t)) * decay,
    }
  }

  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-zeta * omega0 * t)
    const a = y0
    const b = (v0 + zeta * omega0 * y0) / omegaD
    const cos = Math.cos(omegaD * t)
    const sin = Math.sin(omegaD * t)
    return {
      x: target + decay * (a * cos + b * sin),
      v: decay * ((b * omegaD - zeta * omega0 * a) * cos - (a * omegaD + zeta * omega0 * b) * sin),
    }
  }

  const root = Math.sqrt(zeta * zeta - 1)
  const r1 = -omega0 * (zeta - root)
  const r2 = -omega0 * (zeta + root)
  const c1 = (v0 - r2 * y0) / (r1 - r2)
  const c2 = y0 - c1
  const e1 = Math.exp(r1 * t)
  const e2 = Math.exp(r2 * t)
  return { x: target + c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 }
}

/** Advances `motion` toward `target` by `dt` seconds (one frame), exactly. */
export function springStep(motion: Motion, target: number, spring: Spring, dt: number): Motion {
  return springAt(Math.min(Math.max(dt, 0), MAX_FRAME_S), motion, target, spring)
}

/**
 * How long a spring takes to settle: from `distance` away (at rest unless `velocity` is given)
 * until it stays within `precision` of its target, as a share of the distance. This steps the
 * exact solution, because the envelope alone would cut off an underdamped spring mid-swing.
 */
export function settleTime(
  spring: Spring,
  { distance = 1, velocity = 0, precision = 0.001 }: { distance?: number; velocity?: number; precision?: number } = {},
): number {
  const tolerance = Math.abs(distance) * precision || precision
  const step = 1 / 240
  let lastOutside = 0
  for (let t = step; t < 10; t += step) {
    const m = springAt(t, { x: distance, v: velocity }, 0, spring)
    if (Math.abs(m.x) > tolerance || Math.abs(m.v) > tolerance * 10) lastOutside = t
    else if (t - lastOutside > 0.25) break
  }
  return lastOutside + step
}

/** Under a pixel and slower than half a pixel per frame means there's nothing left to draw. Before
 *  I loosened these, traces showed the tail running about 180ms past the last visible change. */
const REST_DISTANCE_PX = 0.4
const REST_SPEED_PX_S = 30

export function isAtRest(motion: Motion, target: number): boolean {
  return Math.abs(motion.x - target) < REST_DISTANCE_PX && Math.abs(motion.v) < REST_SPEED_PX_S
}
