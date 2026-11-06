// The rubber band for a row that slides sideways over the actions beneath it: free
// inside its trays, banded past them.

import { rubberBandClamp } from './rubberBand'

/** The smallest tray the band is measured against, so pulling a row toward a side with
 *  no actions still gives a little instead of hitting a wall. */
export const MIN_RUBBER_DIMENSION = 72

/**
 * Turns a raw finger position into where the row can actually be: free travel inside the
 * trays, rubber-banded past them. `leading` and `trailing` are magnitudes, and a positive
 * `raw` heads toward the leading tray.
 */
export function boundedOffset(raw: number, leading: number, trailing: number): number {
  const limit = raw >= 0 ? leading : trailing
  return rubberBandClamp(raw, -trailing, leading, Math.max(limit, MIN_RUBBER_DIMENSION))
}
