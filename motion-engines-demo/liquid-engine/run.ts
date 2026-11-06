// A run describes everything the liquid does for one interaction: which circles get
// swallowed (when, and how fast) and which ones bud out, in any number and with any
// timing. Opening a menu might swallow one circle and bud out a submenu. Going back
// swallows the submenu, last one first, and buds the original home. A run can also
// carry one circle on a finger (`hold`, see hold.ts) for as long as that takes.
// useLiquidRun plays a run and LiquidCanvas draws it.

import { emitDropDuration, emitDuration } from './emit'
import type { EmitTuning } from './emit'
import type { LiquidHold } from './hold'
import { swallowDuration } from './swallow'
import type { SwallowTuning } from './swallow'
import type { LiquidTint } from './tint'

/** Overrides for a run's tuning. The defaults are the engine's own. */
export interface LiquidTuning {
  swallow?: SwallowTuning
  emit?: EmitTuning
}

/** One circle being swallowed. */
export interface LiquidSwallow {
  /** The circle's item key (LiquidScene.itemAttribute), used to find the circle and its label. */
  key: string
  /** Its centre at rest, in canvas px. */
  from: { x: number; y: number }
  /** Its label's resting horizontal nudge in px: translateX(labelShiftX), none if omitted. */
  labelShiftX?: number
  /** When it starts (ms into the run) and how fast, as a multiple of the designed pace. */
  start: number
  speed: number
  /** Its scale at the moment it was chosen, for a press "pop". Use 1 for none. */
  s0: number
  /** Its share of the centre's swell and wobble. 1 if it's alone, less when several go in together. */
  wobble: number
  maxBase?: number
  tint?: LiquidTint
  /** Its circle's own fill, if different from the liquid (the centre's color). See restFillShare. */
  fill?: string
  /**
   * Set when a finger carried this circle in and let go (see HoldCarry in hold.ts). The
   * swallow picks it up from there, coming in from this direction on a curve that starts
   * this far out, and `start` is negative because it's already that far along. Played
   * backwards, it goes home to its own spot and turns back to its own direction on the way.
   */
  carried?: { angle: number; d0: number }
}

/** One circle popping out. */
export interface LiquidDrop {
  /** The circle's item key (LiquidScene.itemAttribute). */
  key: string
  /** Direction from the centre's middle toward its spot, in radians. */
  angle: number
  /** Distance from the centre's middle to its spot. */
  dSlot: number
  /** Its label's resting horizontal nudge in px, none if omitted. */
  labelShiftX?: number
  tint?: LiquidTint
  /** Its circle's own fill, if different from the liquid. See restFillShare. */
  fill?: string
}

/** The circles budding out, one after another. */
export interface LiquidEmit<Drop extends LiquidDrop = LiquidDrop> {
  start: number
  speed: number
  /** Time between one drop and the next, in ms of the run. */
  stagger: number
  /** How many circles share the ring. This sets how wide a neck can grow. */
  count: number
  drops: Drop[]
}

export interface LiquidRun<Emit extends LiquidEmit = LiquidEmit> {
  /** The centre circle's radius R and the drops' radius r, both measured to the outer
   *  edges, so the liquid lands exactly on the real circles. */
  geometry: { R: number; r: number }
  swallow: LiquidSwallow[]
  emit: Emit | null
  tuning?: LiquidTuning
  /** Set the moment the run ends. No frame can be drawn after its circles are put back,
   *  even one that lands before React unmounts the canvas. */
  halt: { halted: boolean }
  /** Plays backwards from this many ms down to the start, so an interaction can turn
   *  around from the frame it reached instead of snapping to its end first. */
  reverseFrom?: number
  /** A circle on a finger (see hold.ts). The run lasts until the host ends it, either
   *  when the drop gets home or when it's handed to a swallow. */
  hold?: LiquidHold
}

// These are generic over the emit type so a host's own run type passes straight in.

/** Every circle a run draws or moves. */
export function runKeys<Emit extends LiquidEmit>(run: Pick<LiquidRun<Emit>, 'swallow' | 'emit' | 'hold'>): string[] {
  return [
    ...run.swallow.map(s => s.key),
    ...(run.emit?.drops.map(d => d.key) ?? []),
    ...(run.hold ? [run.hold.key] : []),
  ]
}

/** The circles visible once the run is over: whatever popped out (or, when reversed,
 *  whatever had been swallowed), plus a held circle that didn't go in and the neighbors
 *  it may have moved. Anything that went in stays melted and hidden. */
export function shownKeys<Emit extends LiquidEmit>(
  run: Pick<LiquidRun<Emit>, 'swallow' | 'emit' | 'reverseFrom' | 'hold'>,
): string[] {
  const held = run.hold && !run.hold.committed ? [run.hold.key] : []
  return run.reverseFrom === undefined
    ? [...(run.emit?.drops ?? []).map(d => d.key), ...held, ...peerKeys(run)]
    : run.swallow.map(s => s.key)
}

/** The circles next to a held one, which it can move (see peer.ts). They keep their own
 *  fills, so they aren't part of what the liquid draws for runKeys. */
export function peerKeys<Emit extends LiquidEmit>(run: Pick<LiquidRun<Emit>, 'hold'>): string[] {
  return run.hold?.peers.map(peer => peer.key) ?? []
}

/** When the last swallow and last drop are both still. Never while a finger holds a
 *  circle, because the host ends that run itself. */
export function runDuration<Emit extends LiquidEmit>(run: Pick<LiquidRun<Emit>, 'swallow' | 'emit' | 'tuning' | 'hold'>): number {
  if (run.hold) return Infinity
  const swallowed = run.swallow.map(s => s.start + swallowDuration(run.tuning?.swallow) / s.speed)
  const emit = run.emit
  const popped = emit
    ? [emit.start + Math.max(0, emit.drops.length - 1) * emit.stagger + emitDropDuration(run.tuning?.emit) / emit.speed]
    : []
  return Math.max(0, ...swallowed, ...popped)
}

/**
 * Where a run's clock starts: 0, or earlier if it picks something up partway through
 * (a carried swallow's negative `start`). A reversed run plays down to here, so a
 * carried circle goes all the way home and not just back to where the finger let go.
 */
export function runStart<Emit extends LiquidEmit>(run: Pick<LiquidRun<Emit>, 'swallow' | 'emit'>): number {
  return Math.min(0, ...run.swallow.map(s => s.start), run.emit?.start ?? 0)
}

/** When the last drop is still, for one swallow followed from emit.start by emit.count
 *  drops at the designed pace. */
export function sceneDuration(emit: { start: number; count: number } | null, tuning?: LiquidTuning): number {
  return Math.max(swallowDuration(tuning?.swallow), emit ? emit.start + emitDuration(emit.count, tuning?.emit) : 0)
}

/** Each swallow's and drop's own time (ms, at its own pace), `t` ms into the run. */
export function localTimes(run: Pick<LiquidRun, 'swallow' | 'emit'>, t: number): { swallow: number[]; emit: number[] } {
  const emit = run.emit
  return {
    swallow: run.swallow.map(s => (t - s.start) * s.speed),
    emit: (emit?.drops ?? []).map((_, i) => (t - (emit!.start + i * emit!.stagger)) * emit!.speed),
  }
}
