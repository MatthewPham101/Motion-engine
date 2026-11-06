

DEMO:
https://github.com/user-attachments/assets/d4862d69-02f1-4d1d-a51e-89df081b9659



# Motion engines

Two gesture and animation engines from a production React and Capacitor app, pulled out so
they can be read and run on their own. Both are written from scratch with no animation library.

## Liquid engine (`liquid-engine`)

Makes circles behave like liquid. A circle gets swallowed by a centre circle through a metaball
neck, and new ones bud back out the same way. You can also drag a circle by hand, and everything
around it reacts: the centre rises to meet it, neighbors fuse with it and get pushed aside, and
it flattens against a round wall without losing area.

- `metaball.ts` builds the merged outline analytically as an SVG path, not with a blur filter
- `wall.ts` deforms a body against round walls and keeps its area constant
- `hold.ts` handles a drag, and on release eases onto the swallow's curve with no jump in speed
- `LiquidCanvas.tsx` writes straight to the DOM each frame instead of re-rendering React

## Boundary engine (`boundary-engine`)

Everything that happens when something is pushed past its end, built on one formula:

```
offset = (1 - 1 / (c*x / d + 1)) * d
```

- `rubberBand.ts` has the formula, its inverse, and a soft clamp
- `pageOverscroll.ts` is rubber-band overscroll for every page, driven by touch, fling and wheel
- `pageStill.ts` locks a page in place without breaking taps on iOS WebKit

## Spring engine (`spring-engine`)

An exact closed-form solver for a damped spring, which both engines above release onto. Only the
parts they need are included.

## Running it

```
npm install
npm test
npm run typecheck
```
