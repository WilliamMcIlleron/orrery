# Orrery

A small world you roll a marble around, in the browser.

Gravity points at the centre of the planet rather than downwards, so there is
no floor and no edge. Roll in one direction for about fourteen seconds and you
arrive back where you started, having gone over a horizon that curves away from
you the whole time.

You start in the dark. Four monuments stand on the surface, unlit. Roll into
one and it lights and sounds a note. Light all four and dawn breaks over the
whole planet. A lit monument's marker becomes a link to the thing it names.

Between them: boulders, rings of standing stones, arches you can roll under,
and crystals that ring when you hit them. A moon and a ringed companion hang
overhead and rise and set as you travel, which is the only way to tell where
you are on a planet with no landmarks you can see from more than a third of
the way round.

**Work in progress.** World, physics, camera, progression, surface shading,
sound, wayfinding and links are done. See
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

### The terrain is analytic, and that pays for itself twice

The planet mesh is displaced by a sum of sines — cheap, smooth, and seamless on
a sphere by construction, with no wrapping seam to hide. What it buys visually
is the ability to perceive your own speed: on a perfectly smooth sphere nothing
passes you, and rolling feels identical at every velocity.

The collider used to be a perfect sphere sitting at the midpoint of that
relief, on the theory that the mismatch was too small to see. It was not. The
marble hovered up to most of a radius above every hollow — visibly floating
over ground it was supposed to be resting on — and the hills it rolled through
were not there at all.

Because the terrain is a function rather than a mesh lookup, the exact ground
height under any point is one evaluation away, and the true surface normal is
three. So collision samples the real ground every step, pushes out along the
real normal, and applies friction along the slope instead of across it. A
marble on a hillside now rolls off it.

The same function is read again in the shader, which is where the layering
below comes from. Writing the terrain as maths rather than as vertex data is
the single decision the ground, the collision and the shading all depend on.

### The ground is layered, and the layering is free

The terrain is an analytic function, so height and slope cost nothing to
recover in the shader — and they are exactly the two signals that make ground
read as geology rather than as a bumpy ball painted one colour. Sediment
settles in the hollows, crests catch the light, anything steep breaks through
to bare rock regardless of height, and strata band with the terrain.

The bands are domain-warped by a second fbm lookup. Without that they are
perfect rings around the planet, which is worse than no bands at all. A single
very low frequency sample modulates the whole thing so the grain is not
statistically identical everywhere, which is what actually kills the sense of
tiling.

This runs after `normal_fragment_maps` rather than in `color_fragment`, because
it needs the surface normal and Three has not computed one yet at colour time.

It made the frame *cheaper*. The value-noise hash was
`fract(sin(dot(p, k)) * 43758.5)`, and each fbm call is three octaves of
trilinear noise needing eight lattice samples each — twenty-four hashes per
call, two calls per ground fragment, so roughly fifty transcendentals per pixel
of planet. Swapping to an integer hash paid for the layering and then some.

### There are no audio files

Every sound is synthesised at runtime from noise and oscillators. Nothing to
download, nothing to license, and no two megabytes of MP3 attached to a page
someone looks at for forty seconds.

- **Rolling** is granular: about nine hundred 1.6ms grains scattered through
  a five-second buffer, looped. Speed drives `playbackRate`, which moves the
  rate the grains arrive at *and* their pitch together — which is what a real
  rolling object does, and what a filter sweep can only imitate. The first
  build was filtered brown noise, and it was a mistake: on a phone the low end
  simply is not reproduced, so all that survived was hiss. A quiet bed sits
  under the grains to carry the weight on speakers that can. It cuts out
  entirely mid-air; hearing a marble roll while it is in flight is uncanny.
- **Knocks** are a short noise burst with the decay envelope baked into the
  buffer, through a bandpass whose centre frequency rises with impact strength.
  Rate limited, because a marble resting against a rock generates a contact
  every frame and without the limit it machine-guns.
- **Landings** are a knock with a sine body under it, dropping 120Hz to 58Hz
  over a sixth of a second. Only real airtime gets one — the flag that decides
  is written next to the impact it describes, and a boulder struck on the way
  down clears it, because a rock is not a floor.
- **Chimes** are two sine partials climbing a pentatonic run, one per monument.
- **Crystals** ring on three partials at 1, 2.76 and 5.4 — a stretched,
  inharmonic series, which is roughly what a struck bar does and what a
  harmonic series conspicuously does not. Harmonic partials sound like an
  organ; these sound like glass. Two milliseconds of attack, because anything
  slower is a pad and not a strike. The pitch comes from the same pentatonic
  run the monuments use, indexed by which cluster you hit, so no two clusters
  are the same note and none of them can clash with a chime.
- **Everything has a reverb send**, from a generated impulse response, at a
  different depth per sound. A chime is 55% wet and the rolling loop is 5%:
  the world should sound large around the things that ring and close around
  the thing you are pushing.
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

- **Bloom**, and it is *selective*, which took two attempts. Bloom is what
  makes an emissive material read as a light source rather than as a bright
  patch of paint, and the obvious build runs one over the finished frame with
  a threshold high enough to keep the ground out.

  That does not work here, and the reason is the ground itself. It is flat
  shaded, so an entire triangle carries one luminance. Near the horizon the
  terrain sits right around whatever threshold you pick, so some facets cross
  it and their neighbours do not — and blurring that gives a soft-edged wedge
  with dead straight sides lying across the hills. It reads as a rendering
  fault, because it is one. Raising the threshold until the ground is safe
  does remove it, and takes the glow off the lit monuments with it, which is
  the entire payoff of the piece.

  So the scene is drawn a second time with everything that is not a light
  source painted black, and *that* is what gets blurred and added back. The
  black pass still occludes, so a collar behind a hill is still hidden by the
  hill. Nothing that is not emissive can enter the blur at any threshold,
  which frees the threshold to stay low and the glow to be generous. Fog comes
  off for that pass — fog blends toward the background colour, so distant
  black ground would fade up to a bright sky and bloom after all, which is the
  same artefact moved to the horizon.

  The whole bloom branch runs at half resolution, not just the blur inside it.
  Its output is a blur added to a full-resolution frame, so there is nothing a
  second full-size scene draw could resolve. Measured on an Intel Iris Xe at
  1280×720: 60fps with or without it, and the pass adds 80 draw calls to a
  frame that has headroom to spare.
- **An atmosphere**, and not the usual one. The obvious build is a slightly
  larger sphere shaded by fresnel, and it looks right until the camera is
  *inside* the shell — which here it always is, because the shell has to be
  big enough to sit above the horizon. From in there, fresnel brightens toward
  the screen edges rather than toward the planet, so the halo tracks your head
  instead of the world. What it actually does is march the view ray to its
  closest approach to the planet's centre and shade on that distance, which is
  a property of the world and not of where you happen to be looking. Without
  it the planet is a hard-edged shape cut out of the background.
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

### The shadow camera follows the marble

The first version aimed one orthographic shadow camera at the origin with a
frustum ninety units wide, which is wide enough to hold the entire planet.
That sounds like the safe choice and it is the expensive one: 2048 texels
across ninety units is a texel every 0.044 units, and on a sphere whose faces
meet the light at every angle that is coarse enough for grazing facets to
self-shadow across their whole width.

You can only ever see a small cap of a planet this size, so the shadow camera
only ever needs to cover that cap. Thirty-two units across puts a texel at
0.016 — nearly three times finer — and it finally produces a contact shadow
under the marble rather than a smudge.

Two details make a moving shadow camera survivable. The light's position and
its target move together, so the light *direction* never changes and you still
roll from day into night. And the centre is snapped to whole shadow texels:
without that the frustum slides continuously and every shadow edge crawls
against the ground as you move, which is more distracting than the artefact it
replaced.

`normalBias` does the anti-acne work rather than plain `bias`. Constant bias
trades acne for peter-panning everywhere; normal bias pushes the sample along
the surface normal, so it scales with exactly the grazing geometry that causes
acne and leaves ground facing the light alone.

### How coarse the ground is, is a decision

The planet is an icosphere, and the subdivision was 4 — five hundred triangles,
a facet about a third of the screen wide when you stand next to it. Relief read
as flat panels rather than as landforms, and that was most of what made the
piece look like a test build.

It is now 8, which is 1620 triangles. Chosen by rendering 4, 8, 12 and 16 from
the same spot under raking light, which is the only condition where facet size
actually shows. At 12 and above the ground goes smooth while the boulders stay
chunky, and the two stop looking like they belong to the same world. 8 is where
the horizon is a curve, the terrain undulates, and a facet on the ground is
still about the size of a facet on a boulder.

`?detail=N` on the URL overrides it, so the comparison can be repeated rather
than argued about.

### Every capsule was an investment

The collision system stores every solid thing as a segment plus a radius, and
the note above says that means a new kind of obstacle costs nothing. This is
the release where that got tested.

A ring of standing stones is nine capsules on end. An arch is fourteen laid
along a curve, which is why you can roll under one without a line of
special-case code anywhere. A crystal cluster is five or six leaning at
different angles. All of it fell out of the routine that was already there for
boulders, and all of it is picked up for free by the ambient-occlusion bake,
which welds every new stone to the ground it stands on because the bake reads
the same capsule list.

Capsules also carry a `kind` now, which is what lets a crystal sound like a
crystal. The marble records which capsule produced the impact next to the
impact itself, so the sound is chosen by what was struck rather than by how
hard.

### One landmark is one draw call

Naively, two stone circles, three arches and six crystal clusters is a hundred
and thirty meshes, and each one is drawn three times a frame: once for the
scene, once into the shadow map, once into the bloom pass. That is about three
hundred and fifty draw calls to render eleven objects.

None of the pieces ever move relative to each other, so baking each piece's
transform into its vertices and merging the lot brings a whole landmark down to
one geometry. Measured on an Intel Iris Xe: 464 draw calls before, 160 after,
the same 36,800 triangles and the same image. The world with everything in it
now costs about what the empty version did.

### No boulder is the same boulder twice

They used to be one icosphere at twenty-six different scales and rotations,
which is a texture rather than a landscape — the eye finds the repeat long
before it can say what is wrong.

Each one now displaces every vertex along its own direction by a hash *of that
direction*, then squashes on three axes. Keying on direction rather than on
vertex index is the part that matters: `PolyhedronGeometry` is non-indexed, so
every shared corner exists once per triangle touching it, and moving those
copies independently tears the rock open along every edge. The same trick puts
the craters on the moon.

The collider is sized to the furthest lump the jitter produced rather than to
the nominal radius, so the marble never rolls through a corner that stuck out.

### The chrome is an instrument, not an interface

The overlay was frosted lozenges: a glass pill for the palette with a capsule
sliding behind the live label, a glass disc for jump, a glass capsule around
the hint, and rounded speech bubbles with little nibs for the labels. Every one
of those is a perfectly good control and every one of them ships in every
component library written since 2019. The world does not look like anything
else; the chrome looked like everything else, and it is a third of the frame.

An orrery is a brass instrument covered in engraved scales, which is a better
place to take the chrome from than a component library — and unlike a taste
profile, it comes from the subject rather than from someone else's product.

- The palette is a **scale**: four labels tracked out along a hairline rule
  with minor ticks, and one heavy mark that slides under the live one. Still a
  single moving element rather than four fading backgrounds, for the original
  reason — one object moving reads as one control.
- Jump is a **drawn bezel**: a ring with a second scribe line inside it, no
  fill and no blur.
- The hint is just text.
- The marker is an **annotation**, not a tooltip: a squared plate with a
  hairline leader dropping to a small open circle exactly where the monument
  is. The nib made it a speech bubble, and a speech bubble is something that
  explains an interface.

Panels that carry text over unpredictable terrain keep their scrim, because
only a scrim survives cream ground and near-black ground in the same session.
That is the marker, the beacons and the intro card, and nothing else.

### The veil, and why the contrast is a number

Drawing the controls as bare text over the world removes the one thing the
frosted lozenges were actually good for: a known backdrop. The ground is cream
in one palette and near-black in another, and a label crosses a bright rim as
you roll.

So there is a gradient at the top and bottom edges, under every control and
over the canvas. Nobody reads a vignette as a panel, but the text always has
something known behind it — which turns the contrast from a hope into a
measurement.

Measured on the built page, compositing each label's resolved colour and
opacity over the actual rendered backdrop, in the worst spot each palette has:

| | Deep field | Dusk | Playground | Riso |
|---|---|---|---|---|
| palette, inactive | 7.9 | 7.2 | **4.7** | 5.0 |
| palette, live | 12.0 | 10.4 | 7.7 | 9.1 |
| hint | 9.9 | 7.7 | 6.1 | 7.4 |
| jump | 9.5 | 8.1 | 5.8 | 6.7 |
| brand | 9.4 | 9.3 | 6.1 | 6.2 |

AA for text this size is 4.5:1, so the worst case clears it by a little and
most of it clears it by a lot. Before the veil the same table had four entries
under 4.5 and the jump label at **1.78** in Playground — a failure that
predated the redesign and would never have been found by looking, because the
palette anyone tests in is the dark one where it passes.

Jump sits higher than the rest of the chrome, above the edge veil, so it has
its own radial pool of shade. That is the difference between 3.25 and 5.8.

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
- **The progress row is a legend, not a counter.** Each pip carries its own
  monument's accent, so the one that just lit is the same colour as the beam
  now standing on the horizon. That only works if the pip that lights is the
  pip that belongs to the monument — it used to fill left to right in arrival
  order, so lighting the third monument turned on the first pip and the row
  pointed at a colour that was nowhere in the world. A legend that points at
  the wrong thing is worse than no legend. It now reads each monument's own
  state, which `Progression` sets before it calls back, so the two cannot
  drift apart.
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

- Fully keyboard playable — and the world's keys yield to the chrome. Arrows
  and space are grabbed at window level, which is fine until someone tabs to
  the palette and finds that pressing space jumps the marble instead of
  choosing a colour. Both handlers bail out when the event came from a button
  or a link.
- `focus-visible` outlines on every control, 40px minimum on every control at
  every breakpoint, and **every label measured against AA in all four
  palettes** — see the table above, worst case 4.7:1. The narrow layout buys its space by shedding horizontal
  padding rather than height, which is the one dimension that is not ours to
  trade.
- **Zoom is not blocked.** `user-scalable=no` is the reflex for a full-screen
  canvas and it is a WCAG 1.4.4 failure: it takes 200% text away from someone
  who needs it in order to prevent a gesture that `touch-action` already
  handles. `touch-action: none` now sits on the canvas and the stick, where a
  pinch would genuinely fight the drag control, and nowhere else.
- The canvas is opaque to assistive tech, so the page carries a real `h1` and a
  described-in-words summary of what is on the planet.
- A browser without WebGL gets a written explanation instead of a black rectangle.
- **A lost graphics context is recoverable.** A backgrounded tab on a phone can
  have its WebGL context taken away, and the default outcome is a black
  rectangle that never comes back while the loop keeps stepping physics into
  it. Losing it now pauses the loop and says what happened; `preventDefault` on
  the loss event is the part that makes a restore possible at all, and without
  it `webglcontextrestored` never fires. The frame clock is reset on the way
  back, or the first frame carries the whole outage as one delta and throws the
  marble off the planet.
- Nothing autoplays, moves on its own, or flashes.

## Development

`?dev` on the URL exposes `window.__orrery` with the marble, the monuments and
a `warpTo(i)` helper. Reaching a monument on the far side of the planet takes
fifteen seconds of rolling, which is a slow way to check that dawn still works.
It does not exist without the flag.

## Things that were built and then removed

**A trail burning into the ground behind the marble.** Built, measured, looked
at three ways, cut.

The trail was painted into vertex colours, and a flat-shaded face only lights
when all three of its corners do. At the subdivision of the time — 500
triangles, vertices about 2.7 units apart — a brush the width of the marble
marked one vertex at a time and left a dotted line, and widening it until the
mark was continuous took it to 5.4 units, six times the marble's diameter. A
swathe, not a track. Turned up far enough to actually see, it bleached the
ground rather than drawing a route.

The planet is finer now, at 1620 triangles and about 1.5 units between
vertices, which improves the arithmetic without changing the answer: the brush
would still have to be three units wide, and the marble is 1.7 across.

It is also behind you, and the chase camera looks forward.

Making it work needs a render-target decal system, and the alternative —
subdividing the planet further — costs the low-poly look that is the entire
visual identity. Noted here so it does not get proposed again.

## Where it is going

- **Dust off the marble at speed.** The trail is not coming back — see above.
- **The overlay is still generic.** The world looks designed and the chrome
  looks installed, and the chrome is a third of every frame.
- **More than four monuments**, once there is more worth putting on the planet.

## Credits

Built by [William McIlleron](https://williammcilleron.netlify.app).

[Three.js](https://threejs.org) for rendering. Nothing else.

The idea of a portfolio you move through rather than scroll is
[Bruno Simon's](https://bruno-simon.com). The execution here shares none of his
code and deliberately none of his look — his is a car in a bright toy world,
this is a marble on a small planet.

MIT licensed. Take any of it.
