// Liquid engine
//
// Makes a set of circles behave like liquid. Pick a circle and it gets pulled
// into a centre circle: it recoils, stretches, fuses through a metaball neck,
// and the centre swells and wobbles as it lands. Circles bud back out the same
// way, with their icons and labels melting in and out. It started on a dashboard
// menu, but nothing here depends on that, so it works anywhere a group of circles
// gathers into one or comes out of one.
//
// Import from this file, not from the modules behind it.
//
// Pure math, no DOM or React. Shapes are computed with the centre at the origin
// and the drop on the +x axis:
//   swallow.ts   going in (createSwallowTimeline, plus SWALLOW for the tuning)
//   emit.ts      coming out (createEmitTimeline, plus EMIT for the tuning)
//   metaball.ts  two circles drawn as one outline
//   tint.ts      a color carried inside a drop that flows into a ring
//   contact.ts   how joined a drop is, and how much of its own fill shows
//   melt.ts      values for the blur-and-resharpen filter
//   path.ts      shapes as path commands, written out as SVG path data
//   run.ts       one interaction: who goes in, who comes out, and when
//   hold.ts      a circle dragged by a finger, and what happens on release
//   wall.ts      a drop pressed flat against a round wall without losing area
//   peer.ts      how the other circles react to a dragged one
//
// React:
//   useLiquidRun.ts   plays a run (begin, finish, reverse)
//   LiquidCanvas.tsx  draws a run on top of the host's circles
//   useLiquidDrag.ts  decides which press is a drag and tracks the finger
//   dom.ts            what the host provides, and how circles get restored
//
// To use it: put an item attribute on your circles (see dom.ts), describe the
// canvas once as a module-level LiquidScene, start runs with
// begin({ geometry, swallow, emit }), and restore shownKeys(run) in onFinish.
// For different pacing or sizes, pass `tuning` on the run, starting from
// { ...SWALLOW, ... }. To let a finger carry circles in, use useLiquidDrag: its
// `grab` creates a hold with createLiquidHold and begins a run with it. When the
// hold fires handOff, begin the normal swallow with `carried` set.

export { monotoneCurve } from './curves'

export { closedCurveSegs, ellipseSegs, formatPath } from './path'
export type { Placement, Point, Seg } from './path'

export { mergeOutline, mergeSegments, METABALL_HANDLE, neckBaseLimit } from './metaball'
export type { MergeInput } from './metaball'

export { meltBlur, meltMatrix } from './melt'
export type { MeltShape } from './melt'

export {
  createSwallowLabel, createSwallowTimeline, SWALLOW, SWALLOW_TOTAL, swallowDuration, swallowIconAt, swallowTimeAt,
} from './swallow'
export type {
  SwallowFrame, SwallowGeometry, SwallowIcon, SwallowLabel, SwallowTimeline, SwallowTuning,
} from './swallow'

export { createEmitLabel, createEmitTimeline, EMIT, EMIT_DROP_TOTAL, emitDropDuration, emitDuration } from './emit'
export type { EmitFrame, EmitGeometry, EmitTuning } from './emit'

export { insideOf, linkOf, restFillShare } from './contact'

export { TINT, tintBlobOf } from './tint'
export type { LiquidTint, TintBand, TintBlobFrame } from './tint'

export { localTimes, peerKeys, runDuration, runKeys, runStart, sceneDuration, shownKeys } from './run'
export type { LiquidDrop, LiquidEmit, LiquidRun, LiquidSwallow, LiquidTuning } from './run'

export { findLiquidParts, LIQUID_ATTR, restoreLiquidParts } from './dom'
export type { LiquidParts } from './dom'

export { createLiquidHold, HOLD } from './hold'
export type { HoldCarry, HoldEvents, HoldFrame, HoldInput, HoldPhase, HoldTuning, LiquidHold } from './hold'
export { createPeer } from './peer'
export type { HoldPeer, PeerFrame, PeerLife } from './peer'
export { wallBody } from './wall'
export type { WallBody, WallInput } from './wall'

export { DRAG_SLOP, useLiquidDrag } from './useLiquidDrag'
export type { LiquidDragOptions } from './useLiquidDrag'

export { useLiquidRun } from './useLiquidRun'
export type { LiquidRunInput, LiquidRunner } from './useLiquidRun'

export { LiquidCanvas } from './LiquidCanvas'
export type { LiquidCanvasProps, LiquidScene, LiquidSceneBand } from './LiquidCanvas'
