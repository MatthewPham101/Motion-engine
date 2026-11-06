// Small timing helpers shared by every timeline in the engine. monotoneCurve is the
// one that matters most: it's the path a drop takes through its keyframes.

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
/** How far `t` is through [from, to], from 0 to 1. */
export const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from))
export const smooth = (x: number) => x * x * (3 - 2 * x)
export const easeIn = (x: number) => x * x * x
export const easeOut = (x: number) => 1 - (1 - x) ** 3
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/**
 * A smooth curve through keyframes that never overshoots them (monotone cubic,
 * Fritsch-Carlson), and is at rest at both ends. Overshoot is the one thing we can't
 * have here: a drop that dipped past the centre's edge and came back out would pull
 * its own neck apart.
 */
export function monotoneCurve(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length
  const h: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    delta.push((ys[i + 1] - ys[i]) / h[i])
  }
  const m = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      m[i] = k * a * delta[i]
      m[i + 1] = k * b * delta[i]
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const t = (x - xs[i]) / h[i]
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
  }
}
