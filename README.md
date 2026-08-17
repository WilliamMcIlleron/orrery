# Orrery

A small world you roll a marble around, in the browser.

Gravity points at the centre of the planet rather than downwards, so there is
no floor and no edge. Roll in one direction for about fourteen seconds and you
arrive back where you started, having gone over a horizon that curves away from
you the whole time.

You start in the dark. Four monuments stand on the surface, unlit. Roll into
one and it lights and sounds a note. Light all four and dawn breaks over the
whole planet. A lit monument's marker becomes a link to the thing it names.

**Work in progress.** World, physics, camera, progression, sound, wayfinding
and links are done. Texture work is not — see
[Where it is going](#where-it-is-going).

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

### There are no audio files

Every sound is synthesised at runtime from noise and oscillators. Nothing to
download, nothing to license, and no two megabytes of MP3 attached to a page
someone looks at for forty seconds.

- **Rolling** is a loop of lightly integrated noise — closer to brown than
  white, so it rumbles rather than hisses — through a lowpass filter. Speed
  opens the filter *and* raises the gain, so going faster reads as brighter
  rather than merely louder, which is what a real rolling object does. It cuts
  out entirely mid-air; hearing a marble roll while it is in flight is uncanny.
- **Knocks** are a short noise burst with the decay envelope baked into the
  buffer, through a bandpass whose centre frequency rises with impact strength.
  Rate limited, because a marble resting against a rock generates a contact
  every frame and without the limit it machine-guns.
- **Chimes** are two sine partials climbing a pentatonic run, one per monument.
- **The dawn swell** is four slightly detuned oscillators over nine seconds.

Nothing is built until the first real input event, because a browser will not
let an audio context start outside a user gesture.

### The dawn is a palette interpolation

Each palette carries a `dawn` block of overrides, and the world lerps toward it
once the last monument lights. Colours interpolate as `THREE.Color`, everything
else as scalars, and the whole thing is driven by one eased value in the range
0 to 1.

Easing is smootherstep, which has zero first *and* second derivative at both
ends, so the sky neither starts nor stops abruptly. There is a deliberate
nine-tenths of a second of hold first: the chime for the fourth monument needs
room to land, and an instant sunrise reads as a bug rather than a reward.

The scene is only touched while the value is actually moving. Once dawn has
landed it costs nothing for the rest of the session.

### Finding things on a sphere is not the obvious test

Everything worth finding is over the horizon. That is the good part of the
concept and also the risk, so after eleven seconds without progress an arrow
appears at the screen edge pointing at the nearest unlit monument. It resets
whenever one lights, and it hides the moment its target is genuinely visible —
at that point the glowing collar is a better cue than an arrow.

"Genuinely visible" is where this got interesting. Projection has no idea the
world is round: a monument fifty degrees past the horizon still lands inside
the screen rectangle, so an on-screen test alone thinks you can see something
buried under a hemisphere of rock.

The test usually quoted for this is `dot(p, c) >= R²`. **It is wrong here, and
quietly.** It asks whether the target is beyond the camera's horizon *plane*,
which is only the right question when the target sits on the surface. These
monuments are six units tall, and that height buys real extra visibility over
the curve — the plane test hid pillars that were plainly on screen.

The exact condition is that the angle between the two points is no more than
the sum of their horizon angles, `acos(R/|c|) + acos(R/|p|)`. Expand the cosine
of that sum and multiply through by `|p||c|` and both the inverse cosines and
the normalisation drop out:

```
dot(p, c)  >=  R² - sqrt(|c|² - R²) · sqrt(|p|² - R²)
```

One dot product and two square roots, exact, no trigonometry.

### Rocks are placed by rejection sampling

Uniform random on a sphere clumps. It reads as a mistake rather than as
scattered rocks, and it will happily drop a boulder on top of a monument or
wall one in. Rejecting candidates that land too close to anything already
placed costs a few hundred cheap distance checks and fixes both.

### What it is rendered with

Three passes on top of the scene, and the reason for each:

- **Bloom** is what makes an emissive material read as a *light source* rather
  than as a bright patch of paint. Half resolution — bloom is a blur, nobody
  has ever noticed it being blurrier, and it costs a quarter of the fill rate.
  The threshold matters more than the strength: set too low, the marble under
  its own travelling lamp becomes the brightest thing on screen and bloom
  turns it into a fireball. It is above 1.0 so only genuinely emissive things
  bloom.
- **A fresnel atmosphere**: a sphere 5.5% larger than the world, rendered
  inside-out and additively, invisible where you look straight through it and
  brightest where your sight line grazes the surface. That is the geometry
  that makes a real atmosphere a bright rim from orbit. Without it the planet
  is a hard-edged shape cut out of the background.
- **Vignette and a whisper of grain**, after tone mapping so "darken the
  corners by 12%" means what it says. The grain earns its place: large smooth
  gradients — a sky, an unlit hemisphere — band into visible steps at 8 bits
  per channel, and a little noise dithers the boundary away.

Riso gets none of it. A print does not glow, and adding bloom would just make
it look like the other three.

### The monuments are lathed, not extruded

An eight-point profile revolved around the axis: plinth, step, long taper,
narrow shoulder. It costs the same as the cylinder it replaced. Default
primitives are most of what makes a 3D scene read as somebody's test build,
and a cylinder with a ring on it was the loudest offender here.

When one lights it fires a beam — an open-ended cone, additive, fading with
height and toward its own silhouette so it has no visible edge. That beam is
what you can see from the far side of the planet, and it turns "four pillars
somewhere" into a map you can read at a glance.

### The world is seeded

`mulberry32` with a fixed seed, so the planet is byte-for-byte identical on
every load. Without that, switching palette would quietly compare two different
planets, and a bug you saw once might never come back.

### Small things that carry more than they should

- **The marble spins to match distance travelled.** Without it, it slides like
  a hockey puck and the whole scene reads as fake however good everything else is.
- **Tone mapping is on.** Three ships with it off. Turning it on is the single
  largest free improvement available in any Three scene.
- **The ground is tinted per vertex by terrain height**, so high ground catches
  light and hollows sit in shadow. It multiplies the material colour, so dawn
  still recolours the ground underneath it. This is what makes relief legible
  in Riso, where cream ground under a white sun produces almost no shading of
  its own and the terrain would otherwise vanish — taking with it the ability
  to perceive your own speed, which is the entire reason the relief exists.
- **The overlay picks its ink from the background's luminance.** Two palettes
  are nearly black and two nearly white; pale grey text worked until it did
  not.
- **There is no framerate counter.** It is behind `?dev`, because a stats
  readout in the corner is most of what makes a finished piece read as a test
  build.
- **The equator band was deleted.** It was an orientation crutch from when the
  planet was a smooth featureless sphere. Relief, rocks and beams do that job
  better, and under bloom the thin torus read as a stray arc floating above the
  ground.
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

## Development

`?dev` on the URL exposes `window.__orrery` with the marble, the monuments and
a `warpTo(i)` helper. Reaching a monument on the far side of the planet takes
fifteen seconds of rolling, which is a slow way to check that dawn still works.
It does not exist without the flag.

## Things that were built and then removed

**A trail burning into the ground behind the marble.** Built, measured, looked
at three ways, cut.

The planet is 500 triangles, so its vertices sit about 2.7 units apart, and a
flat-shaded face only lights when all three of its corners do. A brush the
width of the marble therefore marks one vertex at a time and leaves a dotted
line; widening it until the mark is continuous takes it to 5.4 units, which is
six times the marble's diameter — a swathe, not a track. Turned up far enough
to actually see, it bleached the ground rather than drawing a route.

It is also behind you, and the chase camera looks forward.

Making it work needs a render-target decal system, and the alternative —
subdividing the planet further — costs the low-poly look that is the entire
visual identity. Noted here so it does not get proposed again.

## Where it is going

- **Surface texture.** Materials are still flat colour; the shapes and light do
  all the work.
- **Dust off the marble at speed**, and a trail on the ground.
- **More than four monuments**, once there is more worth putting on the planet.

## Credits

Built by [William McIlleron](https://williammcilleron.netlify.app).

[Three.js](https://threejs.org) for rendering. Nothing else.

The idea of a portfolio you move through rather than scroll is
[Bruno Simon's](https://bruno-simon.com). The execution here shares none of his
code and deliberately none of his look — his is a car in a bright toy world,
this is a marble on a small planet.

MIT licensed. Take any of it.
