// What a host page has to provide so the liquid can move its circles, and the
// hooks the canvas leaves on what it draws.
//
// A circle is an element with the scene's item attribute, where the value is its
// key: <div data-wheel-item="Assets">. Its first child is the circle itself (the
// icon rides inside it) and its last child is the label. While the liquid is
// drawing a circle, the host makes the circle's own fill and edge transparent,
// because the liquid draws both. The contents stay visible.
//
// The canvas writes inline transform, opacity and filter onto those two children
// every frame and never cleans up after itself, since whatever got swallowed
// should stay melted while it's hidden. The host calls restoreLiquidParts when the
// circle is next shown. useLiquidRun passes it the right circles when a run ends.

/** Attributes the canvas uses to find what it drew. The "green" names come from the
 *  original UI and tests read them, so rename them together with those tests. */
export const LIQUID_ATTR = {
  /** The canvas's own <svg>. */
  canvas: 'data-liquid-merge',
  /** The tint band, while the liquid draws it. */
  band: 'data-green-band',
  /** Each drop's tint blob; the value is its owner (`in0`, `out2`…). */
  tint: 'data-green',
  /** Each drop's own fill; the value is its owner. */
  fill: 'data-disc-fill',
  /** The liquid of a circle next to a held drop (see peer.ts). The value is its key. */
  peer: 'data-liquid-peer',
  /** The tint of that same neighbor. The value is its key. */
  peerGreen: 'data-liquid-peer-green',
} as const

export interface LiquidParts {
  circle: HTMLElement | null
  label: HTMLElement | null
}

/** Finds a circle and its label under `root` by key. */
export function findLiquidParts(root: ParentNode | null | undefined, itemAttribute: string, key: string): LiquidParts {
  const wrapper = Array.from(root?.querySelectorAll<HTMLElement>(`[${itemAttribute}]`) ?? [])
    .find(el => el.getAttribute(itemAttribute) === key)
  return {
    circle: (wrapper?.firstElementChild as HTMLElement | null) ?? null,
    label: (wrapper?.lastElementChild as HTMLElement | null) ?? null,
  }
}

/** Clears what the liquid wrote on a circle and its label. The label's resting
 *  position is translateX(labelShiftX), its own style's nudge. */
export function restoreLiquidParts({ circle, label }: LiquidParts, labelShiftX = 0): void {
  if (circle) {
    circle.style.transform = ''
    circle.style.opacity = ''
    circle.style.filter = ''
  }
  if (label) {
    label.style.transform = labelShiftX === 0 ? '' : `translateX(${labelShiftX}px)`
    label.style.transformOrigin = ''
    label.style.opacity = ''
    label.style.filter = ''
  }
}
