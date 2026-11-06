// Spring engine: m*x'' = -k*x - b*x'
//
// The two engines in this folder both let go on a spring, so this is the part of it they
// need: the exact solver, the release helpers, and the named springs.

export {
  isAtRest, settleTime, springAt, springFromPhysics, springPhysics, springStep,
} from './spring'
export type { Motion, Spring, SpringPhysics } from './spring'

export {
  carriedVelocity, DECELERATION_FAST, landingOffset, MAX_LANDING_SPEED, project,
} from './release'

export { SPRINGS } from './springs'
