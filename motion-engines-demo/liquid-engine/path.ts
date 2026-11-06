// Every shape starts in the same local frame, with the centre circle at the origin
// and the drop on the +x axis, stored as a list of commands. It only gets rotated
// and moved into place when it's written out as SVG path data.

const f = (n: number) => n.toFixed(2)

/** A point in the local frame. */
export type Point = [number, number]

/**
 * One path command in the local frame. Every arc takes the short way round and runs
 * counter-clockwise on screen, so any number of these shapes can share a single path
 * and fill as their union. Nonzero winding never cancels them out.
 */
export type Seg = ['M', Point] | ['C', Point, Point, Point] | ['A', number, number, Point] | ['Z']

/** Where a shape ends up: rotated by `angle` about its origin, then moved to (x, y). */
export interface Placement { angle: number; x: number; y: number }

/** Writes `segs` as SVG path data, placed by `at` if given. */
export function formatPath(segs: readonly Seg[], at?: Placement): string {
  const cos = at ? Math.cos(at.angle) : 1
  const sin = at ? Math.sin(at.angle) : 0
  const ox = at?.x ?? 0
  const oy = at?.y ?? 0
  const deg = f(at ? (at.angle * 180) / Math.PI : 0)
  const p = ([x, y]: Point) => `${f(ox + x * cos - y * sin)} ${f(oy + x * sin + y * cos)}`
  return segs.map(s => {
    switch (s[0]) {
      case 'M': return `M ${p(s[1])}`
      case 'C': return `C ${p(s[1])} ${p(s[2])} ${p(s[3])}`
      case 'A': return `A ${f(s[1])} ${f(s[2])} ${deg} 0 0 ${p(s[3])}`
      case 'Z': return 'Z'
    }
  }).join(' ')
}

/** An ellipse centred `cx` along the axis, with radius `rx` along it and `ry` across it. */
export function ellipseSegs(cx: number, rx: number, ry: number): Seg[] {
  return [['M', [cx + rx, 0]], ['A', rx, ry, [cx - rx, 0]], ['A', rx, ry, [cx + rx, 0]], ['Z']]
}

/**
 * A smooth closed curve through `points`, as cubic Béziers. It's Catmull-Rom, so it
 * passes through every point with no corners. Give the points counter-clockwise on
 * screen (y down) like every other shape here, so it unions with the rest. This is
 * for outlines that aren't circles or ellipses, like a drop pressed against a wall.
 */
export function closedCurveSegs(points: readonly Point[]): Seg[] {
  const n = points.length
  if (n < 3) return []
  const segs: Seg[] = [['M', points[0]]]
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    segs.push([
      'C',
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    ])
  }
  segs.push(['Z'])
  return segs
}
