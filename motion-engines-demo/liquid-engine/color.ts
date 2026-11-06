/** `hex` laid over `base` at `alpha`, flattened to one opaque color. Both are #rrggbb. */
export function overColor(hex: string, alpha: number, base: string): string {
  const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const under = rgb(base)
  const [r, g, b] = rgb(hex).map((c, i) => Math.round(under[i] - alpha * (under[i] - c)))
  return `rgb(${r}, ${g}, ${b})`
}
