import { useEffect } from 'react'
import { installPageOverscroll } from './pageOverscroll'

/**
 * Gives every page the rubber band past its ends (see pageOverscroll.ts). Mount this once at
 * the app's root. It moves the root element, so it covers every route with no per-page setup.
 *
 * `enabled` is meant for the phone apps. On the web we keep the browser's own behavior, and with
 * nothing installed the stylesheet leaves the browser's overscroll alone, because it keys off
 * the attribute this installs.
 */
export function usePageOverscroll(enabled: boolean, rootId = 'root'): void {
  useEffect(() => {
    if (!enabled) return
    const root = document.getElementById(rootId)
    if (!root) return
    return installPageOverscroll(root)
  }, [enabled, rootId])
}
