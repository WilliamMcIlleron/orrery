# Syzygy

A small world you roll a marble around, in the browser.

A syzygy is three bodies on one line. There are three here — the planet under
your feet, a cratered moon, and a ringed companion further out — all lit by one
sun, so the moon carries the same phase as the ground you are standing on. The
piece was called *orrery* while it was one planet in an empty sky. It stopped
being that.

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

**The view moves without the marble.** Right-drag with a mouse, drag with a
second finger on a touch screen, or Q/E and R/F on a keyboard. Steering follows
the camera, so looking left and pushing forward sends you left — the controls
answer to what is on screen rather than to a heading that is not.

Looking stops you steering, for as long as you are looking. On a touch screen
the second finger takes over and the first one is set aside; when you lift the
look finger the steering finger gets the stick back where it currently is, so
it resumes from a standstill rather than snapping to whatever deflection it was
holding.

Standing still, the view stays exactly where you put it. Once you are moving it
unwinds back behind the marble, in proportion to speed, because a camera behind
you is what makes the controls legible and nobody who glanced over their
shoulder should have to put it back by hand — but never while you are actually
looking, and not for a moment afterwards either.

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
- **Impacts are modal.** A struck object rings at a set of frequencies fixed by
  its shape and material, each decaying at its own rate, and the strike itself
  is a click a few milliseconds long. Every impact here used to be one noise
  burst through one bandpass, which gets the brightness right and the identity
  wrong — every object ends up being the same object at a different pitch. They
  are now a four-millisecond excitation through a bank of resonators, which is
  the technique shipped games use for this and is cheap enough to be free.

  The mode ratios are deliberately inharmonic. Whole-number ratios are what a
  string does, and a bank of them reads as a pitched instrument rather than as
  a thing being hit.

  Q is derived from decay time rather than dialled in by ear. A resonant
  bandpass rings down as `exp(-πft/Q)`, so 60dB takes `t = 6.9Q/(πf)`, which
  rearranges to `Q = 0.455·f·t`. That lets a mode be written as "rings for
  90ms" instead of as a filter setting, which is the only way a material stays
  coherent when its pitch changes with impact strength.

  Rendered offline out of the shipping code and measured, three strikes each:

  | | fundamental | decay | peak |
  |---|---|---|---|
  | boulder | 246 Hz | 60 ms | 0.042 |
  | dressed stone | 597 Hz | 120 ms | 0.040 |
  | crystal | 530 Hz | 1078 ms | 0.096 |
  | landing | 125 Hz | 170 ms | 0.139 |

  Two things that measurement caught and listening would have taken much
  longer to. **The bank needs makeup gain**, because a narrow bandpass passes
  almost none of a four-millisecond click — the first build rendered the
  boulder at a peak of 0.003 against the crystal's 0.096: correct, distinct
  and inaudible. It is scaled by mode bandwidth, which is `2.2/decay` and so
  depends only on how long the mode rings, which is what lets modes be written
  as decay times without also having to balance them by ear.

  And **short-decay modes are wide**, so they catch more of the strike than
  their gain suggests. At an even balance the measured fundamental jumped
  between 563 Hz and 2065 Hz from one hit to the next — not variation, two
  different objects. Weighting toward the fundamental fixed it: the spread
  across three strikes is now zero for all four materials.

  Still rate limited, because a marble resting against a rock generates a
  contact every frame and without the limit it machine-guns.
- **Landings** are a knock with a sine body under it, dropping 120Hz to 58Hz
  over a sixth of a second. Only real airtime gets one — the flag that decides
  is written next to the impact it describes, and a boulder struck on the way
  down clears it, because a rock is not a floor.
- **Chimes** are two sine partials climbing a pentatonic run, one per monument.
- **Worked stone** — arch blocks and standing stones — is the boulder knock
  tightened: a narrower, higher, more resonant band so it cracks rather than
  thuds, with a short low partial under it for mass. It also accepts much
  quieter contacts than a boulder does, because an arch leg is half a unit
  across and most of what you do to one is clip it in passing. Under the
  boulder's threshold that was silent, and the arches read as scenery you
  could not touch.
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

Almanacs and ephemerides — the printed tables you would have used to predict a
syzygy before you could compute one — are pages of engraved scales and ruled
rows. That is a better place to take the chrome from than a component library,
and unlike a taste profile it comes from the subject rather than from someone
else's product.

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

### The ending had no way out

The design was: light all four, the beacons come up and label every monument
permanently, and the proximity marker stands down because it would be a second
card for the pillar you are standing at.

The beacons are not permanent. They are culled by the same exact horizon test
the wayfinder uses, and again by whether the pillar is in front of the camera,
so on a planet this small you can normally see one of the four and only while
facing it. Measured at the end of a finished run: **all four beacons at opacity
0 and pointer-events none**, and the marker switched off. Completing the piece
could leave you unable to open anything at all, which is the exact opposite of
what the ending is for.

Three changes, because one was not enough:

- The marker stays live after dawn. The duplicate is solved from the other
  end — the beacon for whichever monument the marker is showing steps aside.
- The marker rebuilds when a monument's *lit state* changes, not only when the
  monument does. It used to bail on `focused === m` alone, so lighting a pillar
  while standing next to it left the plain name card up: same object, no
  rebuild, no link. You had to roll out of range and back before the piece
  would offer you what you had just earned.
- **The progress row is the index.** Each pip gets its monument's href the
  moment it lights, wrapped in a 40px target around the 9px dot. The row has
  been on screen in the monuments' own colours from the first second and the
  player has been reading it the whole way through; making it the way out
  costs no new furniture. No href until lit, which also keeps it out of the
  tab order until it means something.

### Free look, and two things it breaks

Letting the camera turn without the marble is four lines of offset and two
problems.

**Steering has to follow the camera.** Input is camera-relative, and it was
reading the chase heading — the direction of travel. Turn the view ninety
degrees, push forward, and the marble sets off along a heading that is no
longer on screen. There are now two vectors: `forward` is what the chase
follows, `viewForward` is that turned by the look, and steering reads the
second one.

**Looking and steering will fight each other, twice over.** Neither was
obvious until it was measured.

Starting a look did not release the stick, so the stick stayed exactly where
the finger left it and went on steering at that value. On a two-finger look the
marble accelerated to full speed while the player was trying to turn the
camera. On a mouse it is worse and less visible: every mouse button shares one
`pointerId`, so a right-drag begun while the left button is down captures the
same id the stick is keyed on, and every subsequent move goes to the look while
the stick sits frozen and still active.

Then the recentre undoes the look as fast as it is applied, because it scales
with speed and the fight is worst exactly when you are moving. Measured at full
speed, a drag worth sixty degrees came out at eight.

So a look releases the stick and holds the recentre — while looking, and for
0.6s after so that letting go does not snap the view back. Measured after: the
same two-finger gesture leaves the marble coasting down from 9.8 to 5.3 instead
of climbing to the cap, and delivers the full 0.99 radians the drag was worth.

**The camera can be pointed into the ground.** On a displaced surface it does
not have to be below the marble to be inside a hill. The terrain is an analytic
function, so the honest fix costs one evaluation: find the ground under
wherever the camera wants to be, and if it is short of clearance push it back
out along its own radius. Radially rather than along the view, so the camera
rises out of the slope instead of sliding backwards and shrinking the marble.
Swept across the full pitch range with the yaw turning: worst clearance 1.199
against a floor of 1.1.

The offset is built as a vector and rotated, rather than as a height and a
distance added separately, which is what keeps the marble the same size in
frame as the view swings up and over it.

### Jumping was a brake

Pressing jump while rolling scrubbed most of your speed off. Measured against
the surface tangent, before the fix:

| rolling at | after the jump | lost | apex |
| --- | --- | --- | --- |
| standing | 0.15 | 34% | 1.54 |
| 6.0 | 3.83 | 36% | 1.42 |
| 9.1 | 5.37 | 41% | 1.30 |
| 12.9 | 6.93 | 46% | 1.14 |

One cause, and it was the speed cap rather than anything in the jump. The cap
clamped the magnitude of the whole velocity vector, and `JUMP_SPEED` was larger
than `MAX_SPEED` on its own — so every jump, from every speed, tripped it. A
uniform scale is the only thing a magnitude clamp can do, and it takes the
horizontal component down with it.

The right-hand column is the same bug from the other side. The clamp was eating
the impulse as well, and eating more of it the faster you went, so the jump got
*lower* the more speed you carried into it. Read the table upwards and the
piece was punishing you twice for the same input.

Horizontal and vertical are different quantities and want different rules.
`MAX_SPEED` is a claim about how long the planet takes to circle, which is a
statement about ground speed, so it now applies to the tangential component
alone. Vertical is gravity's business. `VERT_MAX` exists underneath it purely
so that a boulder launch compounding with a long fall cannot reach a speed that
steps through the ground between frames — at the fixed timestep it allows 0.28
units a step against a marble radius of 0.85, and it never fires in play.

After: 4-7% instead of 34-46%, and the residue is real rather than the clamp —
rolling drag through the arc, plus the deliberate sideways carry of leaving
along the surface normal instead of straight up. The apex no longer varies with
speed at all.

`JUMP_SPEED` came down from 19 to 16 in the same change, because 19 had never
actually been 19: the clamp had been quietly delivering 13 of it standing still
and 11 at speed. Unthrottling the old number would have put the apex 3.28 units
up, which is floaty on a planet with 1.5 of relief. 16 lands at 2.33 with 0.58s
of air, clears a crest with room, and carries about 7 units at full speed.

Two response curves had been fitted to the bug and had to move with it. Falls
were previously clamped to 13, so every landing arrived at almost exactly the
same speed; they now range from 15.2 for a routine jump to 27.6 for the drop
you spawn in on. The landing squash was scaled such that the hardest landing
available sat just under its ceiling, and after the fix everything pinned at
maximum — a hop and a drop looked identical. The landing sound had the same
problem an octave up. Both were rescaled to the range that now exists.

### The ridges, and the arithmetic that killed the ramps

The jump had nothing to jump over. Rolling between monuments was a straight
line at the speed cap with no decision in it, which is most of why the world
read as scenery rather than as a place.

Every route between two consecutive monuments now has a ridge lying across it,
with one pass cut through at 0.3 along its length — never on the line you were
already driving. Meet the wall and you either jump it, carrying your speed, or
give up the straight line and go round through the pass. It is not a gate: the
planet is a sphere and every monument stays reachable the long way.

It began as ramps and ridges, and the ramps did not survive contact with the
physics. A marble at MAX_SPEED carries `v²/2g` = 169/110 = **1.54 units** of
climb, and that is the entire vertical budget this world has. The first ramps
were 4.2 units tall. The marble stalled 3.2 units short of them, on every route,
every time. Even a ramp it *can* climb is a bad trade, because height is bought
with speed — 0.7 units of ramp costs a third of your velocity, and the shorter
air time that follows carries you less far than the flat jump you already had.
At this gravity a ramp is a brake with extra steps.

So the jump is the only tool and the obstacle is sized to it. The window is
narrow and was found by sweep rather than by arithmetic, because the marble is
under power the whole way up and `ACCEL` keeps doing work on the climb:

| crest | rolling into it | jumping it |
| --- | --- | --- |
| 1.8 | rolls over | clears |
| 2.0 | **stopped 3.5 short** | clears from 3–8 units out |
| 2.8+ | stopped | nothing clears it cleanly |

Above about 2.8 the only "successes" were the collider popping the marble out
of the wall at 21 units a second, which is a bug being exploited rather than a
jump being made. 2.0 is the bottom of the window — the lowest wall a rolling
marble cannot climb.

Two things about the crest are less obvious than they look. It is an *absolute*
height, not a height added to whatever is underneath: the base relief swings
three units peak to trough, and added, two of the four routes rolled straight
over an identical 2.0 while the other two stopped it dead. And it is measured
against the higher of the approach ground and the ground directly beneath —
against the approach alone, a ridge line sitting on a rise wants a negative
fill and stops existing, which is precisely what had happened on the fourth
route.

Scored by what a player actually feels, which is time:

| route | rolling into it | jumping it |
| --- | --- | --- |
| 0 | never crossed in 75s | 1.7s |
| 1 | never crossed in 75s | 1.6s |
| 2 | 12.8s, stopped for 9.9 | 1.7s |
| 3 | 3.4s | 1.7s |

Route 3 is the honest weak one — the ground on its approach happens to launch
the marble, so it clears without being asked to. Three of four ridges stop a
rolling marble outright.

`PLANET_DETAIL` went 8 to 12 for this. At 8 a facet is 4.0 units, wider than a
ridge, and a landform collided with analytically but drawn from the mesh is a
wall the renderer never showed you. 12 puts a facet at 2.8 so a ridge spans
three of them. 3380 triangles against 1620 — nothing on a GPU, and the software
renderer the tests run under is too noisy to resolve it (257, 284 and 264ms
across repeats of the same two builds).

### The planet answers back

Lighting a monument used to move the palette and nothing else. The fourth trip
was the first trip again, with a different colour grade.

Now lighting a monument seals the pass on the route leading out of it. The way
ahead becomes a wall where the way in was a gap: the first crossing can be
rolled straight through, the last has to be jumped. Nothing announces it — you
watch the ground close over about a second and a half.

Measured at the pass, driving straight at it:

| pass | rolling | jumping |
| --- | --- | --- |
| open | through in 1.8s | 1.7s |
| half closed | through in 2.0s | 1.7s |
| sealed | **stuck for 72s** | 1.7s |

Closing is non-linear on purpose — it seals at the very end rather than
tightening evenly — so the moment it stops being a route is a moment, not a
gradual souring.

The awkward part is that the ground has to *move*. The collider reads
`groundRadius()` directly, so the instant a pass narrows the marble is already
standing on the new ground; if the mesh has not caught up in the same frame,
it is bouncing off geometry nobody drew. So the planet is rebuilt live, and the
first attempt at that was unshippable:

| | cost |
| --- | --- |
| whole planet, displacement only | 14.5ms |
| whole planet, with the occlusion bake | 176ms |
| the ground that actually moved | **2.8ms** |

Two things got it there. The rebuild takes a direction and a radius and only
touches facets inside that cap — a sealing pass moves a disc about seven units
across, and the rest of the planet is already where it should be. And every
vertex's direction from the centre is now cached at build time: the geometry is
non-indexed, three unshared vertices per face, so 3380 triangles is 10,140
vertices, and re-normalising them to find out where they point was twenty
thousand square roots spent answering a question whose answer never changes.
That alone took it from 4.7ms to 2.8.

Displacement walks faces rather than vertices and writes the face normal
directly, which also drops `computeVertexNormals()` — it has no idea that only
a hundred triangles moved.

One trap worth naming: the rebuild has to happen *before* a finished animation
is retired from the list, not after. Retiring it first seals the collider and
leaves the final, fully sealed frame undrawn — the one frame where the mismatch
is largest.

### Flow, and how to tell a crash from a landing

There was nothing to lose. You could not lose progress, lose a resource or
die, so the optimal play was to hold full speed at everything and eat the
crashes — they cost a second and nothing else.

Flow is the thing there is to lose. Hold speed and it builds over about three
seconds; as it does, rolling resistance drops, so you keep speed through the
climbs, turns and landings that would otherwise bleed it, and the marble's own
lamp burns up to 90% brighter. Hit something hard enough to destroy your ground
speed and all of it goes at once.

It deliberately leaves `MAX_SPEED` alone. The ridge crest was calibrated
against that number, and a flow bonus that raised top speed would quietly
uncalibrate every obstacle on the planet.

The hard part was deciding what counts as a crash, and two obvious answers are
both wrong.

**Impact strength** cannot tell a landing from a wall. Landing off a jump
registers about 15 — harder than most wall hits — so thresholding on it broke
flow every single time you used the jump the ridges exist to reward.

**Ground speed lost** is closer, but measured across the whole step it also
spans the jump, and a jump leaves along the *surface* normal. On a ten degree
slope that 16-unit impulse moves ground speed by 2.8 and trips a 3.0 threshold.
Every jump still broke flow. Narrowing the window so it brackets only the
collision response fixed that.

It still fired at random on open ground, though, because rolling fast into the
bottom of a dip legitimately loses a lot of speed. Speed lost says how hard you
stopped; it does not say what stopped you. So the test now also asks what you
hit: a floor's normal points roughly the way you do, a wall's does not. Under
0.8 against local up — steeper than about thirty-seven degrees — counts. Base
relief never gets near that; ridge flanks and rock faces are all past it.

Verified by flattening the landforms and driving for a minute:

| | breaks in 60s | lowest flow |
| --- | --- | --- |
| ridges present | 1 (the ridge it drove into) | 0.00 |
| ridges flattened | **0** | **1.00** |

Six consecutive jumps: 1.00 to 1.00, no dip. Driving into a wall: 1.00 to 0.00.

### The crystals had nothing to say for themselves

Reported: no indication or motivation to hit the crystals until the end screen
counts them. Both halves of that were true. They rang prettily, and that was
the whole of it — the tally arrived after the run, when it was too late to act
on, and nothing in the world suggested they were worth a detour.

They now hold the flow meter. Ringing one fills it, every time and not just the
first, or a cluster you have already found goes back to being scenery on the
return trip. That makes them worth going out of your way for and makes them
mean something at the exact moment you would most want them to.

The tally appears with the first one you ring and not before. A counter reading
`0/6` on load is a target nobody agreed to, and this is a place rather than a
checklist — it should read as a note about what you found, not an instruction
about what you are missing.

That still teaches the rule one crystal too late, so the last piece is that
losing flow makes the crystals within 46 units ring, loudest nearest. You have
just crashed, the marble has gone dark, and the things that would fill it back
up light up across the ground in front of you. Nothing is written down and
nothing is pointed at. Measured frame by frame, a cluster 20 units out peaks at
0.205 pulse and lingers about a second.

### The challenge was already in the geometry

The piece had none. You found four monuments, dawn broke, and the run time
appeared once at the end as a fact about what had happened rather than as
anything you could do something about.

Nothing had to be invented to fix that. The planet is fourteen seconds around
and there are four points on it, so choosing a route is already an
optimisation problem — it simply was not worth solving, because nothing was
counting. The whole addition is a clock and a stored best.

Two restraints, and they are the design:

**The clock does not run on a first visit.** Someone seeing this for the first
time should get to wander, find things and be surprised by dawn, and a timer
ticking in the corner turns all of that into a task. It appears from the second
run onward — once you have a best, you have something to beat, and that is the
point at which a clock is an invitation rather than a demand.

**There is no fail state, no par time and nothing to lose.** The clock is a
reason to go round again, not a hurdle in front of the thing you came for. A
new best is one word and a letter-spacing change; anything more would be a
badge, and a badge would be the first thing here that treats the player as
someone to be rewarded rather than someone to be shown something.

The crystal clusters are counted the same way — reported at the end as what you
found rather than scored as a target you missed. They are never mentioned
beforehand, so finding six of them is a thing you did rather than a list you
completed.

Measured across a first and second visit: first run shows no clock at all until
the end, then `8.9s · 1/6 crystals`; second run opens on `best 8.9s`, ticks
live, and finishes `8.7s · best`.

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

`?dev` on the URL exposes `window.__syzygy` with the marble, the monuments and
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
- **A leaderboard would be the wrong shape.** The best time is local and stays
  local. A global board would need a backend, and it would turn a thing you
  send someone into a thing you compete in.
- **More than four monuments**, once there is more worth putting on the planet.

## Credits

Built by [William McIlleron](https://williammcilleron.netlify.app).

[Three.js](https://threejs.org) for rendering. Nothing else.

The idea of a portfolio you move through rather than scroll is
[Bruno Simon's](https://bruno-simon.com). The execution here shares none of his
code and deliberately none of his look — his is a car in a bright toy world,
this is a marble on a small planet.

MIT licensed. Take any of it.
