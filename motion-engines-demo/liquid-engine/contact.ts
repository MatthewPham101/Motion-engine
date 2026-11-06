// Small measurements of a drop against the centre circle. The renderer uses them
// to shade whatever the drop is carrying (its fill, its tint) on the way in or out.

import { clamp, smooth } from './curves'

/** How joined a drop is to the centre: 0 when apart or fully inside, 1 on a full neck. */
export function linkOf(input: { R: number; d: number; rc: number; attached: boolean; bridge: number }): number {
  const { R, d, rc, attached, bridge } = input
  if (!attached) return 0
  // The neck is stretched past touching (popping out), so it thins as the drop leaves.
  if (d > R + rc) return bridge > 0 ? clamp(1 - (d - R - rc) / bridge) : 0
  // Overlapping: reaches full strength soon after touching and closes as the last of it goes in.
  return smooth(clamp((R + rc - d) / (0.4 * rc))) * smooth(clamp((d - (R - rc)) / (0.4 * rc)))
}

/** How much of a drop is inside the centre circle: 0 touching or apart, 1 wholly in. */
export function insideOf(R: number, d: number, rc: number): number {
  return clamp((R + rc - d) / (2 * rc))
}

// A drop's color
// The liquid is always the centre's color. A drop shows its circle's own fill at
// rest and trades it for the centre's color on the way in, so it arrives looking
// like the centre. Popping out runs the other way. This is measured from the
// resting spot rather than from where the necks form, which keeps the color exact
// at rest and makes the handoff to the real circle invisible in both directions.

/** How much of a drop's own fill shows: all of it at its resting distance `rest`,
 *  none once its middle reaches the centre circle's edge `R`. */
export function restFillShare(d: number, R: number, rest: number): number {
  return smooth(clamp((d - R) / (rest - R)))
}
