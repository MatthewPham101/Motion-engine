import { describe, it, expect, afterEach } from 'vitest'
import { findLiquidParts, restoreLiquidParts } from '../index'

// A circle is an element with the scene's item attribute. Its first child is the circle and its
// last is the label. The canvas writes onto both and never puts them back. The host does that with
// restoreLiquidParts.

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  document.body.innerHTML = `
    <div id="host">
      <div data-orb="a"><div class="circle"></div><span class="label">A</span></div>
      <div data-orb="b"><div class="circle"></div><span class="label">B</span></div>
    </div>`
  return document.getElementById('host')!
}

describe('findLiquidParts', () => {
  it('finds a circle’s circle and label by its key', () => {
    const { circle, label } = findLiquidParts(mount(), 'data-orb', 'b')
    expect(circle?.className).toBe('circle')
    expect(label?.textContent).toBe('B')
  })

  it('finds nothing for an unknown key, or no root', () => {
    expect(findLiquidParts(mount(), 'data-orb', 'z')).toEqual({ circle: null, label: null })
    expect(findLiquidParts(null, 'data-orb', 'a')).toEqual({ circle: null, label: null })
  })
})

describe('restoreLiquidParts', () => {
  it('clears what the liquid wrote, the label back at its own nudge', () => {
    const parts = findLiquidParts(mount(), 'data-orb', 'a')
    const { circle, label } = parts as { circle: HTMLElement; label: HTMLElement }
    circle.style.transform = 'translate(4px, 2px)'
    circle.style.opacity = '0.3'
    circle.style.filter = 'url(#melt)'
    label.style.transform = 'scale(0.5)'
    label.style.transformOrigin = '50% 0'
    label.style.opacity = '0'
    label.style.filter = 'url(#melt)'

    restoreLiquidParts(parts, -6)
    expect([circle.style.transform, circle.style.opacity, circle.style.filter]).toEqual(['', '', ''])
    expect(label.style.transform).toBe('translateX(-6px)')
    expect([label.style.transformOrigin, label.style.opacity, label.style.filter]).toEqual(['', '', ''])

    restoreLiquidParts(parts)
    expect(label.style.transform).toBe('')
  })
})
