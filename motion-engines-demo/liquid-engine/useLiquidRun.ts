import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { runDuration, runStart } from './run'
import type { LiquidRun } from './run'

// Handles the life of a run for any host: start one (ending any before it), let it end
// itself when the last drop is still, cut it short, or turn it around from the frame
// it reached. Render `run` with LiquidCanvas and pass it onFrame:
//
//   const liquid = useLiquidRun({ onFinish: run => shownKeys(run).forEach(restore) })
//   liquid.begin({ geometry, swallow, emit })
//   {liquid.run && <LiquidCanvas run={liquid.run} scene={SCENE} onFrame={liquid.onFrame} />}
//
// This hook exists mainly to keep two bugs out of every host:
//
// 1. The halt. A run ends on a timer, but React unmounts the canvas a frame later. A
//    frame drawn in that gap re-applied styles after the circles had been restored,
//    and clobbered whatever moved them next. So ending a run sets run.halt.halted
//    synchronously, and the canvas won't draw after that.
//
// 2. Turning around. A reverse has to start from the frame on screen, not from the
//    end. The canvas reports each frame's time through onFrame, and the reversed run
//    plays from exactly that point back down.

/** A run as the host describes it. The runner adds the halt and, when reversed, reverseFrom. */
export type LiquidRunInput<Run extends LiquidRun> = Omit<Run, 'halt' | 'reverseFrom'>

export interface LiquidRunner<Run extends LiquidRun> {
  /** The run being drawn, or null. Render this. */
  readonly run: Run | null
  /** The same run, but safe to read from a timer or handler (never a stale render's). */
  current(): Run | null
  /** How far into the current run (ms) the last drawn frame was. */
  time(): number
  /** Pass this to the canvas. It reports every frame drawn. */
  onFrame(t: number): void
  /** Starts a run, finishing any that's still playing. It ends itself once its last
   *  swallow and drop are still, unless it's holding a circle on a finger (`hold`), which
   *  plays until someone finishes it. */
  begin(run: LiquidRunInput<Run>): Run
  /** Ends the run now. Nothing more gets drawn and onFinish receives it. */
  finish(): void
  /** Plays the current run backwards from the frame it reached down to its start (see
   *  runStart), then finishes it and calls onDone. Returns false when nothing is playing
   *  or a finger is holding the circle. */
  reverse(onDone?: () => void): boolean
}

export function useLiquidRun<Run extends LiquidRun = LiquidRun>(
  options: {
    /** The run ended or was cut short: put its circles back (see shownKeys). Called before
     *  `run` turns null. */
    onFinish?: (run: Run) => void
  } = {},
): LiquidRunner<Run> {
  const [run, setRun] = useState<Run | null>(null)
  const runRef = useRef<Run | null>(null)
  const clock = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const onFinish = useRef(options.onFinish)
  useLayoutEffect(() => { onFinish.current = options.onFinish })
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const finish = useCallback(() => {
    window.clearTimeout(timer.current)
    const ending = runRef.current
    if (!ending) return
    ending.halt.halted = true
    runRef.current = null
    onFinish.current?.(ending)
    setRun(null)
  }, [])

  const begin = useCallback((input: LiquidRunInput<Run>) => {
    finish()
    const next = { ...input, halt: { halted: false } } as Run
    runRef.current = next
    clock.current = 0
    setRun(next)
    const duration = runDuration(next)
    if (Number.isFinite(duration)) timer.current = window.setTimeout(finish, duration)
    return next
  }, [finish])

  const reverse = useCallback((onDone?: () => void) => {
    const playing = runRef.current
    if (!playing || playing.hold) return false
    // Same run turned around, with a fresh halt. The old one stops drawing without restoring
    // anything, because snapping it to its end first is exactly what reversing avoids.
    window.clearTimeout(timer.current)
    playing.halt.halted = true
    const t = clock.current
    const back = { ...playing, reverseFrom: t, halt: { halted: false } } as Run
    runRef.current = back
    setRun(back)
    timer.current = window.setTimeout(() => {
      finish()
      onDone?.()
    }, t - runStart(back))
    return true
  }, [finish])

  const onFrame = useCallback((t: number) => { clock.current = t }, [])
  const current = useCallback(() => runRef.current, [])
  const time = useCallback(() => clock.current, [])

  return useMemo(
    () => ({ run, current, time, onFrame, begin, finish, reverse }),
    [run, current, time, onFrame, begin, finish, reverse],
  )
}
