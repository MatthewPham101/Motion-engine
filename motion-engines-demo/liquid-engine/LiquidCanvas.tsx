import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactElement } from 'react'
import { overColor } from './color'
import { insideOf, linkOf, restFillShare } from './contact'
import { clamp, smooth } from './curves'
import { findLiquidParts, LIQUID_ATTR, restoreLiquidParts } from './dom'
import type { LiquidParts } from './dom'
import { createEmitTimeline, EMIT, emitDropDuration } from './emit'
import { meltBlur, meltMatrix } from './melt'
import type { MeltShape } from './melt'
import { ellipseSegs, formatPath } from './path'
import type { Placement } from './path'
import type { HoldFrame } from './hold'
import type { PeerFrame } from './peer'
import { localTimes, runDuration, runStart } from './run'
import type { LiquidRun } from './run'
import { createSwallowTimeline, SWALLOW, swallowDuration } from './swallow'
import { tintBlobOf } from './tint'
import type { LiquidTint, TintBand } from './tint'

// Draws what a run describes: circles swallowed by the centre, circles budding back out,
// or one circle carried on a finger. The math and timing live in swallow.ts, emit.ts,
// metaball.ts and tint.ts. This file only draws it.
//
// It's all one liquid. Every shape (the centre, each drop going in or coming out, plus their
// necks) goes into a single path in the scene's color, with no outline. The shapes trace the
// circles' outer edge, and where two shapes meet they become one. A circle's own color is a
// fill on its drop that fades into the liquid's color as the drop nears the centre.
//
// The canvas sits under the centre circle, whose own fill the host makes transparent while a
// run plays. The real icons and labels get moved and melted to match.
//
// Neighbors of a held drop are liquid too (peer.ts). Each one's body, surface and neck is its
// own path, and its green is another, both as visible as the neighbor itself, since it might
// be fading out. Their circles and labels move as they get nudged.
//
// A tint is liquid as well. If the scene has a band (a ring around the centre), the band gets
// drawn here during a run while the page's real one steps aside, and a circle's tint is a blob
// of that same liquid. Going in, the blob reaches for the band, fuses through a neck, and flows
// in while the band swells. Popping out, the tint buds off the band.
//
// Attributes and inline styles are written straight to the DOM every frame, because a React
// render per frame would cost far more than the drawing. It never resets what it moved. The
// host does that with restoreLiquidParts, and useLiquidRun tells it which circles to restore.

/** A ring around the centre that the drops' tints flow into. */
export interface LiquidSceneBand extends TintBand {
  /** Its color, which is also the tints' color. */
  color: string
  /** The page's real band, hidden while the liquid draws one in its place. It's a selector,
   *  looked up inside the canvas's parent. */
  trackSelector?: string
}

/** Where a run gets drawn. Make this a module-level constant or memoize it, because a new
 *  scene restarts the run's drawing. */
export interface LiquidScene {
  /** The square canvas in px: the SVG's size and viewBox, laid over the element holding the circles. */
  size: number
  /** The centre circle's middle, in canvas px. */
  centre: { x: number; y: number }
  /** The liquid's color, same as the centre circle's. */
  color: string
  /** The attribute naming each circle the liquid moves (see dom.ts). */
  itemAttribute: string
  /** Optional ring the drops' tints flow into. Without one, tints aren't drawn. */
  band?: LiquidSceneBand
}

export interface LiquidCanvasProps {
  run: LiquidRun
  scene: LiquidScene
  /** Called for every frame drawn with how far into the run it is (ms), which is what lets a
   *  run turn around where it is. useLiquidRun supplies it. */
  onFrame?: (t: number) => void
}

/** A drop as seen by its fill and tint: where it is (local frame) and how joined it is. */
interface Body {
  owner: string
  angle: number
  d: number
  along: number
  across: number
  link: number
  inside: number
  /** Popping out, where its tint buds off the band, rather than going in. */
  outward: boolean
  tint?: LiquidTint
  /** Its circle's own fill, if it has one. */
  fill?: string
  /** Its circle's resting distance from the middle. The tint matches the circle's exactly
   *  there, so the handoff to the real circle is invisible. */
  rest: number
}

interface Parts extends LiquidParts { labelTop: number }

/** A melt filter's id. There's one per drop and part, per canvas. */
const meltIdOf = (prefix: string, owner: string, part: 'icon' | 'label') => `${prefix}-${owner}-${part}`

/** Everything about a run that doesn't change while it plays. */
function liquidModel(run: LiquidRun, scene: LiquidScene) {
  const { R, r } = run.geometry
  const { centre } = scene
  const swallowTuning = run.tuning?.swallow ?? SWALLOW
  const emitTuning = run.tuning?.emit ?? EMIT
  const swallowTotal = swallowDuration(swallowTuning)
  const dropTotal = emitDropDuration(emitTuning)
  const placeAt = (angle: number): Placement => ({ angle, x: centre.x, y: centre.y })
  const reversed = run.reverseFrom !== undefined
  const swallows = run.swallow.map(sw => {
    const own = {
      d0: Math.hypot(sw.from.x - centre.x, sw.from.y - centre.y),
      angle: Math.atan2(sw.from.y - centre.y, sw.from.x - centre.x),
    }
    // A carried circle goes in from where the finger released it. Played backwards it goes home
    // to its own spot, turning from the direction it came in by back to its own direction as it
    // comes out (from the frame the reverse began at, down to its start).
    const { carried } = sw
    const d0 = carried && !reversed ? carried.d0 : own.d0
    const turn = carried ? Math.atan2(Math.sin(carried.angle - own.angle), Math.cos(carried.angle - own.angle)) : 0
    const turnedAt = reversed ? Math.max(1, (run.reverseFrom! - sw.start) * sw.speed) : 1
    const angleAt = (local: number) => {
      if (!carried) return own.angle
      if (!reversed) return carried.angle
      return own.angle + turn * smooth(clamp(local / turnedAt))
    }
    return {
      sw,
      angleAt,
      rest: own.d0,
      timeline: createSwallowTimeline({ R, r, d0, s0: sw.s0, wobble: sw.wobble, maxBase: sw.maxBase }, swallowTuning),
    }
  })
  const drops = run.emit?.drops ?? []
  const emits = drops.map(drop => createEmitTimeline({ R, r, dSlot: drop.dSlot, count: run.emit!.count }, emitTuning))
  /** A swallow's own time, limited to the part it draws. */
  const swallowLocal = (local: number) => Math.max(0, Math.min(local, swallowTotal))

  /** The full outline `t` ms into the run, including the held drop's frame if there is one. */
  const unionAt = (t: number, held?: HoldFrame | null) => {
    const c = localTimes(run, t)
    const parts = swallows.map((s, i) => {
      const local = swallowLocal(c.swallow[i])
      return formatPath(s.timeline(local).shape, placeAt(s.angleAt(local)))
    })
    drops.forEach((drop, i) => {
      const shape = c.emit[i] > dropTotal + 50 ? ellipseSegs(drop.dSlot, r, r) : emits[i](c.emit[i]).shape
      if (shape.length) parts.push(formatPath(shape, placeAt(drop.angle)))
    })
    if (held) parts.push(formatPath(held.shape, placeAt(held.angle)))
    return parts.join(' ')
  }

  // A held circle's resting distance, where its own fill shows in full.
  const holdRest = run.hold ? Math.hypot(run.hold.from.x - centre.x, run.hold.from.y - centre.y) : 0

  return { R, r, swallowTuning, emitTuning, swallowTotal, dropTotal, placeAt, swallows, swallowLocal, drops, emits, holdRest, unionAt }
}

export function LiquidCanvas({ run, scene, onFrame }: LiquidCanvasProps) {
  // Per canvas, so two can play on one page. CSS url(#...) needs a plain id.
  const prefix = `liquid${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const bandHole = `${prefix}-band-hole`
  const holdClip = `${prefix}-hold-body`
  const model = useMemo(() => liquidModel(run, scene), [run, scene])
  const svgRef = useRef<SVGSVGElement>(null)
  const fillRef = useRef<SVGPathElement>(null)
  const onFrameRef = useRef(onFrame)
  useLayoutEffect(() => { onFrameRef.current = onFrame })

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const { R, r, swallowTuning: L, emitTuning: E, swallowTotal, dropTotal, swallows, swallowLocal, drops, emits, unionAt } = model
    const { centre, band } = scene
    const total = runDuration(run)
    const { hold } = run
    const id = (owner: string, part: 'icon' | 'label') => meltIdOf(prefix, owner, part)

    // The circles and labels it moves, found from the element it's drawn in.
    const root = svg.parentElement
    const partsFor = (key: string): Parts => {
      const parts = findLiquidParts(root, scene.itemAttribute, key)
      const { circle, label } = parts
      // The label's top relative to the circle's middle, since it scales from there.
      const labelTop = circle && label ? label.offsetTop - (circle.offsetTop + circle.offsetHeight / 2) : 0
      return { ...parts, labelTop }
    }
    const going = swallows.map(s => partsFor(s.sw.key))
    const coming = drops.map(drop => partsFor(drop.key))
    const held = hold ? partsFor(hold.key) : null
    const peerParts = hold ? hold.peers.map(peer => partsFor(peer.key)) : []
    // Look up by value rather than selector, because keys can contain characters like "&".
    const peerPathsByKey = new Map(Array.from(svg.querySelectorAll<SVGPathElement>(`[${LIQUID_ATTR.peer}]`))
      .map(el => [el.getAttribute(LIQUID_ATTR.peer)!, el]))
    const peerPaths = hold ? hold.peers.map(peer => peerPathsByKey.get(peer.key) ?? null) : []
    const peerGreensByKey = new Map(Array.from(svg.querySelectorAll<SVGPathElement>(`[${LIQUID_ATTR.peerGreen}]`))
      .map(el => [el.getAttribute(LIQUID_ATTR.peerGreen)!, el]))
    const peerGreens = hold ? hold.peers.map(peer => peerGreensByKey.get(peer.key) ?? null) : []
    const bodyClip = svg.querySelector<SVGPathElement>(`#${holdClip} path`)
    const rim = r * L.label.rim

    // The band gets drawn here as liquid during the run while the real one steps aside, along
    // with each drop's tint blob and own fill.
    const track = band?.trackSelector ? root?.querySelector<SVGElement>(band.trackSelector) ?? null : null
    if (track) track.style.opacity = '0'
    const bandPath = svg.querySelector<SVGPathElement>(`[${LIQUID_ATTR.band}]`)
    const byOwner = (attr: string) => new Map(Array.from(svg.querySelectorAll<SVGEllipseElement>(`[${attr}]`))
      .map(el => [el.getAttribute(attr)!, el]))
    const blobs = byOwner(LIQUID_ATTR.tint)
    const fills = byOwner(LIQUID_ATTR.fill)
    const f2 = (n: number) => n.toFixed(2)
    const turn = (angle: number) => `translate(${centre.x} ${centre.y}) rotate(${f2((angle * 180) / Math.PI)})`

    /** Each drop's own fill: covering the whole drop at its circle's spot, faded into the
     *  liquid's color by the time it reaches the centre. */
    const paintFills = (bodies: Body[]) => {
      for (const b of bodies) {
        const el = b.fill ? fills.get(b.owner) : undefined
        if (!el) continue
        el.setAttribute('transform', turn(b.angle))
        el.setAttribute('cx', f2(b.d))
        el.setAttribute('rx', f2(r * b.along))
        el.setAttribute('ry', f2(r * b.across))
        el.setAttribute('fill-opacity', restFillShare(b.d, R, b.rest).toFixed(3))
      }
    }

    /** The band, swollen by what it's taking in, with every blob joined to it drawn as part of
     *  it. A blob on its own is drawn separately. */
    // A tint fills the circle's inside, within its 2px border, or the whole circle when the
    // border is the tint's color. Each blob is sized to match.
    const rInside = r - 2
    const fillRadius = (tint: LiquidTint) => (tint.toEdge ? r : rInside)
    const paintTints = (bodies: Body[]) => {
      if (!band) return
      const tinted = bodies.filter((b): b is Body & { tint: LiquidTint } => !!b.tint)
      const resting: TintBand = { outer: band.outer, inner: band.inner, alpha: band.alpha }
      const swell = tinted.reduce((sum, b) => sum + tintBlobOf({ ...b, band: resting, r: fillRadius(b.tint) }, E).swell, 0)
      const swollen = { ...resting, outer: resting.outer + swell }
      let d = formatPath(ellipseSegs(0, swollen.outer, swollen.outer), model.placeAt(0))
      for (const b of tinted) {
        const g = tintBlobOf({ ...b, band: swollen, r: fillRadius(b.tint) }, E)
        if (g.joined) d += ' ' + formatPath(g.joined, model.placeAt(b.angle))
        const el = blobs.get(b.owner)
        if (!el) continue
        if (!g.alone) { el.setAttribute('fill-opacity', '0'); continue }
        el.setAttribute('transform', turn(b.angle))
        el.setAttribute('cx', f2(g.alone.d))
        el.setAttribute('rx', f2(g.alone.rx))
        el.setAttribute('ry', f2(g.alone.ry))
        if (b.fill) {
          // Over the drop's own fill, use the shade its circle shows: the tint over the liquid's
          // color, flattened to one opaque color.
          el.setAttribute('fill', overColor(b.tint.color, g.alone.alpha, scene.color))
          el.setAttribute('fill-opacity', '1')
        } else {
          el.setAttribute('fill-opacity', g.alone.alpha.toFixed(3))
        }
      }
      bandPath?.setAttribute('d', d)
    }

    // Only touch a filter when its melt changes, because re-filtering is the expensive part.
    const melted = new Map<string, number>()
    const melt = (el: HTMLElement, filterId: string, m: number, shape: MeltShape) => {
      const rounded = Math.round(m * 100) / 100
      if (melted.get(filterId) === rounded) return
      melted.set(filterId, rounded)
      if (rounded <= 0) { el.style.filter = ''; return }
      const filter = svg.querySelector(`#${filterId}`)
      filter?.children[0]?.setAttribute('stdDeviation', meltBlur(rounded, shape))
      filter?.children[1]?.setAttribute('values', meltMatrix(rounded, shape))
      el.style.filter = `url(#${filterId})`
    }

    /** The icon's circle: moved by (dx, dy) and stretched along the path. */
    const placeCircle = (el: HTMLElement, dx: number, dy: number, deg: number, along: number, across: number) => {
      el.style.transform =
        `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${deg}deg) ` +
        `scale(${along.toFixed(4)}, ${across.toFixed(4)}) rotate(${-deg}deg)`
    }
    /** The label: `suck` of 1 is narrowed into the drop's rim, 0 is at rest. */
    const placeLabel = (el: HTMLElement, dx: number, dy: number, top: number, shiftX: number,
      l: { suck: number; sx: number; sy: number }) => {
      const tx = dx + shiftX * (1 - l.suck)
      const ty = dy - l.suck * (top - rim)
      el.style.transformOrigin = '50% 0'
      el.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${l.sx.toFixed(4)}, ${l.sy.toFixed(4)})`
    }

    /** A neighbor of the held drop: its body and liquid, its green, and its circle nudged. */
    const moved = new Set<number>()
    const paintPeer = (i: number, pf: PeerFrame) => {
      const parts = peerParts[i]
      // As visible as the real circle, which may be fading out if another one was chosen.
      const wrapper = parts.circle?.parentElement
      const seen = wrapper ? getComputedStyle(wrapper).opacity : ''
      const path = peerPaths[i]
      if (path) {
        path.setAttribute('d', formatPath(pf.shape, pf.at))
        path.style.opacity = seen
      }
      const green = peerGreens[i]
      if (green && pf.green) {
        green.setAttribute('d', formatPath(pf.green.segs, pf.green.place))
        green.style.opacity = seen
      }
      const shift = hold!.peers[i].labelShiftX ?? 0
      if (Math.abs(pf.dx) > 0.01 || Math.abs(pf.dy) > 0.01) {
        moved.add(i)
        if (parts.circle) parts.circle.style.transform = `translate(${f2(pf.dx)}px, ${f2(pf.dy)}px)`
        if (parts.label) parts.label.style.transform = `translate(${f2(shift + pf.dx)}px, ${f2(pf.dy)}px)`
      } else if (moved.delete(i)) {
        restoreLiquidParts(parts, shift)
      }
    }

    const draw = (t: number, now: number) => {
      // A held circle moves itself, and this has to happen first because moving it can end the
      // run (it got home or was handed to a swallow). At that point the host has already restored
      // its circle, so nothing more can be written over it.
      const f = hold ? hold.step(now) : null
      if (run.halt.halted) return
      const c = localTimes(run, t)
      const bodies: Body[] = []

      // Going in
      swallows.forEach((s, i) => {
        const local = c.swallow[i]
        // Before it starts it's at rest and untouched. Long after, it's melted away. Its tint is
        // tracked from before it moves (the circle's own fill stays hidden for the whole run) until
        // it has dissolved.
        const at = s.timeline(swallowLocal(local))
        const angle = s.angleAt(swallowLocal(local))
        const rcNow = r * at.along
        const attached = at.d > R - rcNow && at.d < R + rcNow
        bodies.push({
          owner: `in${i}`, angle, d: at.d, along: at.along, across: at.across, tint: s.sw.tint, fill: s.sw.fill, outward: false, rest: s.rest,
          link: local < 0 ? 0 : linkOf({ R, d: at.d, rc: rcNow, attached, bridge: 0 }),
          inside: local < 0 ? 0 : insideOf(R, at.d, rcNow),
        })

        if (local < 0 || local > swallowTotal) return
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const { circle, label, labelTop } = going[i]
        if (circle) {
          const k = at.icon.scale
          placeCircle(circle, centre.x + at.d * cos - s.sw.from.x, centre.y + at.d * sin - s.sw.from.y,
            (angle * 180) / Math.PI, at.along * k, at.across * k)
          circle.style.opacity = at.icon.opacity.toFixed(3)
          melt(circle, id(`in${i}`, 'icon'), at.icon.melt, L.icon.melt)
        }
        if (label) {
          // A moment behind the drop while it's being drawn up into it.
          const lag = s.timeline.distance(Math.max(0, local - L.label.lag))
          placeLabel(label, centre.x + lag * cos - s.sw.from.x, centre.y + lag * sin - s.sw.from.y,
            labelTop, s.sw.labelShiftX ?? 0, at.label)
          label.style.opacity = at.label.opacity.toFixed(3)
          melt(label, id(`in${i}`, 'label'), at.label.melt, L.label.melt)
        }
      })

      // Coming out
      drops.forEach((drop, i) => {
        const tau = c.emit[i]
        const e = emits[i](Math.min(tau, dropTotal))
        const rcOut = r * e.along
        bodies.push({
          owner: `out${i}`, angle: drop.angle, d: e.d, along: e.along, across: e.across, tint: drop.tint, fill: drop.fill, outward: true, rest: drop.dSlot,
          link: tau < 0 ? 0 : linkOf({ R, d: e.d, rc: rcOut, attached: e.attached, bridge: E.bridge * r }),
          inside: tau < 0 ? 1 : insideOf(R, e.d, rcOut),
        })
        if (tau > dropTotal + 50) return

        const { circle, label, labelTop } = coming[i]
        const off = e.d - drop.dSlot
        const dx = off * Math.cos(drop.angle)
        const dy = off * Math.sin(drop.angle)
        if (circle) {
          const k = e.icon.scale
          placeCircle(circle, dx, dy, (drop.angle * 180) / Math.PI, e.along * k, e.across * k)
          circle.style.opacity = e.icon.opacity.toFixed(3)
          melt(circle, id(`out${i}`, 'icon'), e.icon.melt, E.icon.melt)
        }
        if (label) {
          placeLabel(label, dx, dy, labelTop, drop.labelShiftX ?? 0, e.label)
          label.style.opacity = e.label.opacity.toFixed(3)
          melt(label, id(`out${i}`, 'label'), e.label.melt, E.label.melt)
        }
      })

      // On a finger
      if (hold && f) {
        bodies.push({
          owner: 'hold', angle: f.angle, d: f.d, along: f.along, across: f.across, tint: hold.tint, fill: hold.fill,
          outward: f.outward, rest: model.holdRest, link: f.link, inside: f.inside,
        })
        const { circle, label, labelTop } = held!
        if (circle) {
          const k = f.icon.scale
          placeCircle(circle, f.x - hold.from.x, f.y - hold.from.y, (f.angle * 180) / Math.PI, f.along * k, f.across * k)
          circle.style.opacity = f.icon.opacity.toFixed(3)
          melt(circle, id('hold', 'icon'), f.icon.melt, f.melt.icon)
        }
        if (label) {
          placeLabel(label, f.labelAt.x - hold.from.x, f.labelAt.y - hold.from.y, labelTop, hold.labelShiftX, f.label)
          label.style.opacity = f.label.opacity.toFixed(3)
          melt(label, id('hold', 'label'), f.label.melt, f.melt.label)
        }
      }

      if (hold && f) {
        // Its fill and tint stay inside its own outline, flattened or not.
        bodyClip?.setAttribute('d', formatPath(f.body, model.placeAt(f.angle)))
        f.peers.forEach((pf, i) => paintPeer(i, pf))
      }

      fillRef.current?.setAttribute('d', unionAt(t, f))
      paintFills(bodies)
      paintTints(bodies)
      onFrameRef.current?.(t)
    }

    // Forwards from 0 to the end, or, when turned around (reverseFrom), from that frame back
    // down to the start through the same frames. A run holding a circle has no end, and plays
    // until the host finishes it.
    const from = run.reverseFrom
    const floor = runStart(run)
    let raf = 0
    let start: number | null = null
    const step = (now: number) => {
      if (run.halt.halted) return
      if (start === null) start = now
      const t = from === undefined ? Math.min(now - start, total) : Math.max(from - (now - start), floor)
      draw(t, now)
      if (from === undefined ? t < total : t > floor) raf = requestAnimationFrame(step)
    }
    draw(from ?? 0, performance.now())
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      // The real band takes over again.
      if (track) track.style.opacity = ''
    }
  }, [run, scene, model, prefix, holdClip])

  // Draw the first frame now so nothing flashes before the effect's first draw.
  const first = model.unionAt(run.reverseFrom ?? 0, run.hold?.frame())
  const { drops } = model
  const { band } = scene
  const owned = <T,>(pick: (entry: { tint?: LiquidTint; fill?: string }) => T | undefined) => [
    ...run.swallow.flatMap((sw, i) => { const v = pick(sw); return v === undefined ? [] : [{ owner: `in${i}`, value: v }] }),
    ...drops.flatMap((drop, i) => { const v = pick(drop); return v === undefined ? [] : [{ owner: `out${i}`, value: v }] }),
    ...(run.hold ? [run.hold].flatMap(h => { const v = pick(h); return v === undefined ? [] : [{ owner: 'hold', value: v }] }) : []),
  ]
  const tinted = band ? owned(entry => entry.tint) : []
  const filled = owned(entry => entry.fill)
  const hook = (attr: string, value: string) => ({ [attr]: value })
  /** The held drop's fill and tint are clipped to its own outline through a separate group. A
   *  clip on the ellipse itself would be read in its rotated and moved frame, and would cut the
   *  green away entirely. */
  const clipped = (owner: string, el: ReactElement) =>
    owner === 'hold' ? <g key={owner} clipPath={`url(#${holdClip})`}>{el}</g> : el
  const { hold } = run
  return (
    <svg
      ref={svgRef}
      {...hook(LIQUID_ATTR.canvas, '')}
      aria-hidden="true"
      focusable="false"
      width={scene.size}
      height={scene.size}
      viewBox={`0 0 ${scene.size} ${scene.size}`}
      style={{
        position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none',
      }}
    >
      <defs>
        {run.swallow.map((sw, i) => (
          <g key={sw.key}>
            <MeltFilter id={meltIdOf(prefix, `in${i}`, 'icon')} />
            <MeltFilter id={meltIdOf(prefix, `in${i}`, 'label')} />
          </g>
        ))}
        {drops.map((drop, i) => (
          <g key={drop.key}>
            <MeltFilter id={meltIdOf(prefix, `out${i}`, 'icon')} />
            <MeltFilter id={meltIdOf(prefix, `out${i}`, 'label')} />
          </g>
        ))}
        {hold && (
          <g>
            <MeltFilter id={meltIdOf(prefix, 'hold', 'icon')} />
            <MeltFilter id={meltIdOf(prefix, 'hold', 'label')} />
            <clipPath id={holdClip}><path /></clipPath>
          </g>
        )}
      </defs>
      <path ref={fillRef} d={first} fill={scene.color} />
      {hold?.peers.map(peer => (
        <path key={peer.key} {...hook(LIQUID_ATTR.peer, peer.key)} fill={scene.color} />
      ))}
      {filled.map(({ owner, value }) => (
        clipped(owner, <ellipse key={owner} {...hook(LIQUID_ATTR.fill, owner)} cy={0} fill={value} fillOpacity={0} />)
      ))}
      {/* The neighbors' greens: a separate liquid, floating in their own. */}
      {hold?.peers.flatMap(peer => peer.tint ? [
        <path key={peer.key} {...hook(LIQUID_ATTR.peerGreen, peer.key)}
          fill={overColor(peer.tint.color, peer.tint.alpha, scene.color)} />,
      ] : [])}
      {/* The tint's liquid: the band (with its hole masked out) plus the blobs joined to it, and
          each drop's tint blob on its own. */}
      {band && (
        <>
          <defs>
            <mask id={bandHole} maskUnits="userSpaceOnUse" x={0} y={0} width={scene.size} height={scene.size}>
              <rect width={scene.size} height={scene.size} fill="white" />
              <circle cx={scene.centre.x} cy={scene.centre.y} r={band.inner} fill="black" />
            </mask>
          </defs>
          <path {...hook(LIQUID_ATTR.band, '')} mask={`url(#${bandHole})`} fill={band.color} fillOpacity={band.alpha} />
          {tinted.map(({ owner, value }) => (
            clipped(owner, <ellipse key={owner} {...hook(LIQUID_ATTR.tint, owner)} cy={0} fill={value.color} fillOpacity={0} />)
          ))}
        </>
      )}
    </svg>
  )
}

/** Blur, then re-sharpen the alpha edge, so shapes run together like liquid. */
function MeltFilter({ id }: { id: string }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="0" />
      <feColorMatrix type="matrix" values={meltMatrix(0)} />
    </filter>
  )
}
