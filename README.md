# Orrery

A small world you roll a marble around, in the browser.

Gravity points at the centre of the planet rather than downwards, so there is
no floor and no edge. Roll in one direction for about fourteen seconds and you
arrive back where you started, having gone over a horizon that curves away from
you the whole time.

**Work in progress.** The world, the physics and the camera are done. Sound,
textures and the thing that gives it a point are not — see [Where it is going](#where-it-is-going).

## Running it

No build step and no package manager. It is ES modules and one CDN import.

```bash
python -m http.server
```

Then open `localhost:8000`. Opening `index.html` straight off disk may work
depending on the browser, because module scripts on a `file://` page have to
fetch across origins, so the server is the reliable route.

## Controls

Arrow keys or WASD. On a touch screen, drag anywhere — the stick appears under
your finger rather than in a fixed corner, so you never have to look down at
your thumb.

The four buttons along the bottom switch palette, or press <kbd>P</kbd> to
cycle. They are not four coats of paint on the same thing: two of them are
daylit worlds with no dark side, which means the lamp that travels with the
marble does not exist in them. Picking a palette here is partly picking a
mechanic.

## How it works

### There is no physics engine

Everything this needs is a sphere against a sphere, and a sphere against a
capsule. Both are exact and about twenty lines each.

Every collidable thing in the world is stored as a capsule — a line segment
plus a radius. A boulder is a capsule whose segment has zero length. A monument
is one standing on end. That means a single collision routine covers the whole
world, and adding a new kind of obstacle costs nothing.

A general solver would be larger, slower, and would not do anything you could
see that this does not.

### The camera was the hard part

On flat ground a chase camera is a fixed offset and a `lookAt`. On a sphere,
"up" is different at every point, and three things have to happen every frame:

1. The forward vector is re-projected onto the tangent plane. Skip it and the
   camera slowly tips into the ground, taking the horizon with it.
2. `camera.up` is set to the local surface normal. Skip it and the world
   appears to roll as you travel.
3. Both the heading and the position are smoothed with `1 - e^(-k·dt)` rather
   than a fixed fraction, so the feel does not change with framerate.

Miss any one of the three and it looks wrong in a way that is genuinely hard to
name if you do not already know what you are looking for.

### The terrain is a lie, and it is worth it

The planet mesh is displaced by a sum of sines — cheap, smooth, and seamless on
a sphere by construction, with no wrapping seam to hide. The collider
underneath it is still a perfect sphere, sitting at the midpoint of the relief.

At this amplitude, against a marble of this size, the mismatch is invisible.
What it buys is the ability to perceive your own speed: on a perfectly smooth
sphere nothing passes you, and rolling feels identical at every velocity.

### The world is seeded

`mulberry32` with a fixed seed, so the planet is byte-for-byte identical on
every load. Without that, switching palette would quietly compare two different
planets, and a bug you saw once might never come back.

### Small things that carry more than they should

- **The marble spins to match distance travelled.** Without it, it slides like
  a hockey puck and the whole scene reads as fake however good everything else is.
- **Tone mapping is on.** Three ships with it off. Turning it on is the single
  largest free improvement available in any Three scene.
- **Device pixel ratio is capped at 2.** Phones report 3 and above; rendering
  at that buys nothing visible on a low-poly scene and costs a lot of heat.
- **Nothing animates on its own.** The world is completely still until you move
  it, which is why `prefers-reduced-motion` needs no special case. Any idle
  animation added later has to be gated on that query.

## Accessibility

- Fully keyboard playable.
- `focus-visible` outlines on every control, 40px minimum touch targets.
- The canvas is opaque to assistive tech, so the page carries a real `h1` and a
  described-in-words summary of what is on the planet.
- A browser without WebGL gets a written explanation instead of a black rectangle.
- Nothing autoplays, moves on its own, or flashes.

## Where it is going

- **A reason to exist.** Start on the dark side; touching each monument lights
  it; lighting all four breaks dawn over the whole planet. Right now you roll,
  you find a pillar, and nothing happens.
- **Sound.** Rolling loop pitched to speed, a knock per collision, one chord per
  monument. Generated in code rather than sourced as files — no licensing, no
  downloads, and it is a better story.
- **Texture and material work**, and monuments that actually open the project
  they name.

## Credits

Built by [William McIlleron](https://williammcilleron.netlify.app).

[Three.js](https://threejs.org) for rendering. Nothing else.

The idea of a portfolio you move through rather than scroll is
[Bruno Simon's](https://bruno-simon.com). The execution here shares none of his
code and deliberately none of his look — his is a car in a bright toy world,
this is a marble on a small planet.

MIT licensed. Take any of it.
