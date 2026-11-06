import type { Spring } from './spring'

// The named springs a held drop uses. New motion should pick one of these by name instead
// of inventing its own numbers, so things that move together feel related.
export const SPRINGS = {
  smooth: { response: 0.21, damping: 1 },
  pop: { response: 0.175, damping: 0.78 },
  glassPress: { response: 0.3, damping: 0.66 },
  drop: { response: 0.3, damping: 0.42 },
  dropHome: { response: 0.44, damping: 0.72 },
} as const satisfies Record<string, Spring>
