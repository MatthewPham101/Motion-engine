import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { LiquidHold } from './hold'

// The finger's side of a held drop (see hold.ts). It works out which press is a drag,
// where the finger is in the scene's own px, and what the click after a drag shouldn't
// do. The host decides whether a circle can be picked up (`grab`) and what choosing it
// does. The hold does the physics and LiquidCanvas draws it.
//
//   useLiquidDrag({ target: canvasRef, size: SCENE.size, itemAttribute: SCENE.itemAttribute,
//     grab: (key, at, now) => { const hold = createLiquidHold({ ..., at, now }); liquid.begin({ ..., hold }); return hold } })
//
// A few rules worth knowing:
//   - The circle is the handle. A press only counts on an item's circle (its first child,
//     see dom.ts), never its label, so the label stays a plain tap target. Give the circle
//     touch-action: none, or the browser takes a touch drag as a scroll and cancels it.
//   - A press becomes a drag once the finger moves DRAG_SLOP px. Until then it's a tap and
//     nothing is held. A circle already heading home (`catches`) is caught on first touch.
//   - The click that ends a drag gets swallowed, so a drag never also counts as a tap.
//   - One finger at a time. Others are ignored until it lifts.

/** How far (screen px) a press moves before it's a drag instead of a tap. */
export const DRAG_SLOP = 8

/** How long after a drag (ms) its click can still arrive and need swallowing. */
const CLICK_AFTER_DRAG_MS = 500

interface Point { x: number; y: number }

export interface LiquidDragOptions {
  /** The element the circles (and the canvas) are laid out in. */
  target: RefObject<HTMLElement | null>
  /** Its width in its own px (the scene's `size`). The finger gets mapped into these px
   *  however the element is scaled or zoomed on screen. */
  size: number
  /** The attribute that names each circle (the scene's `itemAttribute`). */
  itemAttribute: string
  /** When false, no circle can be picked up and taps are left alone. */
  enabled?: boolean
  /** A moving circle that a touch catches immediately, without waiting for the slop. */
  catches?: (key: string) => boolean
  /** Picks the circle up by starting a hold and returning it, or refuses by returning null. */
  grab: (key: string, at: Point, now: number) => LiquidHold | null
}

interface Press {
  id: number
  key: string
  /** Where it began, on screen (for the slop) and in the scene (to pick up at). */
  client: Point
  at: Point
  mouse: boolean
  hold: LiquidHold | null
}

export function useLiquidDrag(options: LiquidDragOptions): void {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })

  useEffect(() => {
    const el = latest.current.target.current
    if (!el) return
    let press: Press | null = null
    // Until this time, a click is the end of a drag and not a tap. Starts out as never.
    let swallowClickUntil = -Infinity
    let cursor: string | null = null

    /** The finger in the scene's px. Comparing screen px with screen px means any scale or
     *  zoom along the way divides out. */
    const toScene = (e: PointerEvent): Point => {
      const rect = el.getBoundingClientRect()
      const k = rect.width / latest.current.size || 1
      return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k }
    }

    const showGrabbing = (on: boolean) => {
      const root = document.documentElement
      if (on && cursor === null) {
        cursor = root.style.cursor
        root.style.cursor = 'grabbing'
      } else if (!on && cursor !== null) {
        root.style.cursor = cursor
        cursor = null
      }
    }

    const end = () => {
      press = null
      showGrabbing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }

    const pickUp = (p: Press, at: Point): boolean => {
      p.hold = latest.current.grab(p.key, at, performance.now())
      if (p.hold && p.mouse) showGrabbing(true)
      return p.hold !== null
    }

    function onDown(e: PointerEvent) {
      const o = latest.current
      // A press whose end never arrived (the screen rotated or folded under the finger, or the
      // system took the touch) shouldn't block every press after it. A new primary pointer
      // means all earlier fingers are gone. A second finger during a real press isn't primary,
      // so it's still ignored.
      if (press && e.isPrimary && e.pointerId !== press.id) end()
      if (press || o.enabled === false || e.button !== 0) return
      const node = e.target instanceof Element ? e.target : null
      const item = node?.closest<HTMLElement>(`[${o.itemAttribute}]`)
      if (!item || !el!.contains(item)) return
      // The circle is the handle, not its label.
      const handle = item.firstElementChild
      if (!handle || !handle.contains(node)) return
      const key = item.getAttribute(o.itemAttribute)
      if (key === null) return
      press = { id: e.pointerId, key, client: { x: e.clientX, y: e.clientY }, at: toScene(e), mouse: e.pointerType === 'mouse', hold: null }
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      if (o.catches?.(key) && !pickUp(press, press.at)) end()
    }

    function onMove(e: PointerEvent) {
      const p = press
      if (!p || e.pointerId !== p.id) return
      if (!p.hold) {
        if (Math.hypot(e.clientX - p.client.x, e.clientY - p.client.y) < DRAG_SLOP) return
        // Pick it up where the press began, so the drop doesn't jump by the slop distance.
        if (!pickUp(p, p.at)) {
          // Refused, and by now it's not a tap either.
          swallowClickUntil = performance.now() + CLICK_AFTER_DRAG_MS
          end()
          return
        }
      }
      if (e.cancelable) e.preventDefault()
      p.hold!.move(toScene(e), performance.now())
    }

    function onUp(e: PointerEvent) {
      const p = press
      if (!p || e.pointerId !== p.id) return
      end()
      if (!p.hold) return
      p.hold.release(performance.now())
      swallowClickUntil = performance.now() + CLICK_AFTER_DRAG_MS
    }

    function onCancel(e: PointerEvent) {
      const p = press
      if (!p || e.pointerId !== p.id) return
      end()
      p.hold?.cancel(performance.now())
    }

    // Runs before React sees it, since React listens at the root. A drag isn't a tap.
    function onClick(e: MouseEvent) {
      if (performance.now() > swallowClickUntil) return
      swallowClickUntil = -Infinity
      e.stopPropagation()
      e.preventDefault()
    }

    // The browser's own image drag on the icon would steal the pointer.
    const onDragStart = (e: DragEvent) => e.preventDefault()

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick, true)
    el.addEventListener('dragstart', onDragStart)
    return () => {
      const p = press
      end()
      p?.hold?.cancel(performance.now())
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('dragstart', onDragStart)
    }
  }, [])
}
