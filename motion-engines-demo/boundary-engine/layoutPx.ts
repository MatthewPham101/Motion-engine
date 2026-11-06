// The app draws its desktop UI under a single CSS zoom on <html>. Under zoom, pointer
// coordinates and window.scrollY come in screen px, while styles are written in layout px,
// so one screen px is 1/zoom of a layout px. The full app computes the zoom from the window
// size. Here it's just a value you can set.
let zoom = 1

export function setPageZoom(next: number): void {
  zoom = next
}

/** A length measured on screen, converted to layout px, the unit styles are written in. */
export function toLayoutPx(screenPx: number): number {
  return zoom === 1 ? screenPx : screenPx / zoom
}
