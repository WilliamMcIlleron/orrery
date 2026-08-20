import * as THREE from "three";
import { DT, MAX_STEPS, LABEL_RANGE, MAX_SPEED, FOV_BASE, HIT_STOP } from "./config.js";
import { PALETTES, resolvePaletteKey, makePaletteState, applyDawn } from "./palettes.js";
import { CONTENT } from "./content.js";
import { buildWorld, applyPaletteState } from "./world.js";
import { fadeClusters, ringCluster } from "./landmarks.js";
import { readBest, submit, formatTime } from "./records.js";
import { Input, isControlTarget } from "./input.js";
import { Marble } from "./marble.js";
import { ChaseCamera } from "./chase-camera.js";
import { Progression } from "./progression.js";
import { Audio } from "./audio.js";
import { Wayfinder } from "./wayfinder.js";
import { createAtmosphere } from "./atmosphere.js";
import { Post } from "./postfx.js";
import { Beacons } from "./beacons.js";

const paletteKey = resolvePaletteKey();
const P = PALETTES[paletteKey];

/* ---------------------------------------------------------------- renderer */

const scene = new THREE.Scene();
scene.background = new THREE.Color(P.bg);
scene.fog = new THREE.Fog(P.bg, P.fogNear, P.fogFar);

const camera = new THREE.PerspectiveCamera(FOV_BASE, innerWidth / innerHeight, 0.1, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
// Phones report a device pixel ratio of 3 and above. Rendering at that buys
// nothing visible on a low-poly scene and costs a great deal of heat.
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Three ships with tone mapping off. Turning it on is the single largest free
// improvement available in any Three scene: it stops bright areas clipping to
// flat white and lifts the midrange out of mud.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = P.exposure;
document.body.appendChild(renderer.domElement);
document.getElementById("loading")?.remove();

/* ------------------------------------------------------------------- world */

const { capsules, monuments, lamp, handles, crystalClusters } = buildWorld(scene, P, CONTENT);
const atmosphere = createAtmosphere(scene, P);
const post = new Post(renderer, scene, camera, P);
const marble = new Marble(scene, P);
const chase = new ChaseCamera(camera);

const paletteState = makePaletteState(P);
applyPaletteState(scene, renderer, handles, paletteState);

/*
 * The overlay has to survive two palettes that are nearly black and two that
 * are nearly white. Hardcoding pale grey worked until Riso, where the arrow
 * and the hint text disappeared into the paper.
 *
 * Relative luminance of the background decides which ink the DOM uses. sRGB
 * coefficients, not a plain average — green carries most of perceived
 * brightness and averaging gets light greens and deep blues wrong.
 */
{
  const c = new THREE.Color(P.bg);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const light = lum > 0.4;
  const root = document.documentElement.style;
  root.setProperty("--ink", light ? "#3a3630" : "#cfd6e4");
  root.setProperty("--ink-soft", light ? "#6f6858" : "#7c8394");
  root.setProperty("--ink-done", light ? "#a8631a" : "#ffd9a8");
  root.setProperty("--ink-shadow", light ? "0 1px 3px rgba(255,255,255,.75)" : "0 1px 4px rgba(0,0,0,.9)");
  root.setProperty("--scrim", light ? "rgba(246,242,232,.90)" : "rgba(6,8,14,.86)");
  /*
   * The veil at the top and bottom edges.
   *
   * The controls used to sit on frosted lozenges, which guaranteed a known
   * backdrop behind every label. Drawing them as bare text over the world
   * looks far better and removes that guarantee: the ground is cream in one
   * palette and near-black in another, and a label can cross a bright rim as
   * you roll.
   *
   * A gradient at the edges fixes it without putting a shape back. It is
   * invisible as an object — nobody reads a vignette as a panel — but the text
   * always has something known behind it, so the contrast is a number rather
   * than a hope.
   */
  root.setProperty("--veil", light ? "rgba(250,247,240,.94)" : "rgba(3,5,10,.9)");
  root.setProperty("--scrim-ink", light ? "#f6f2e8" : "#11141a");
  root.setProperty("--glass", light ? "rgba(255,253,247,.55)" : "rgba(16,20,28,.5)");
  root.setProperty("--glass-line", light ? "rgba(58,54,48,.16)" : "rgba(255,255,255,.14)");
  root.setProperty("--glass-hi", light ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.07)");
  root.setProperty("--focus", light ? "#2f5d7c" : "#8ab4ff");
}

/* ------------------------------------------------------------------- audio */

const audio = new Audio();
const muteBtn = document.getElementById("mute");

const soundHintEl = document.getElementById("soundhint");

function syncMuteButton() {
  if (!muteBtn) return;
  // Reflects whether sound is actually audible, not whether we asked for it.
  // A speaker icon over a suspended context is the UI lying.
  const off = audio.ready ? !audio.audible : audio.muted;
  muteBtn.setAttribute("aria-pressed", String(off));
  muteBtn.setAttribute("aria-label", off ? "Unmute sound" : "Mute sound");
}

// Audio contexts cannot start outside a user gesture, so the engine is built
// on the very first input rather than at load. The control, however, is
// visible from first paint: someone on a phone in public needs to be able to
// say no *before* it happens, not discover it has already happened.
function ensureAudio() {
  audio.start();
  syncMuteButton();
}

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    // A click here is itself a gesture, so it can also be the thing that
    // starts the engine — tapping the speaker to turn sound ON must work.
    if (!audio.ready && audio.muted) {
      audio.setMuted(false);
      audio.start();
    } else {
      audio.setMuted(!audio.muted);
    }
    syncMuteButton();
    soundHintEl?.classList.add("gone");
  });
}
syncMuteButton();

// The label is a one-time offer, not a permanent piece of chrome.
setTimeout(() => soundHintEl?.classList.add("gone"), 5200);

document.addEventListener("visibilitychange", () => {
  audio.setPageVisible(document.visibilityState === "visible");
  syncMuteButton();
});

/* ------------------------------------------------------------- progression */

const progressEl = document.getElementById("progress");
const hintEl = document.getElementById("hint");

/*
 * A row of pips, not a fraction. "2 / 4" reads as a task to complete; pips
 * read as something you are in the middle of.
 *
 * Each pip carries its monument's own accent colour, so the row doubles as a
 * legend: the gold one you just lit is the gold beam on the horizon.
 */
function buildProgress(total) {
  if (!progressEl) return;
  progressEl.textContent = "";
  for (let i = 0; i < total; i++) {
    /*
     * Each pip is an anchor, and gets its href the moment its monument lights.
     *
     * This is the reliable way out of the piece. The intended one is to stand
     * at a pillar and use its marker, and that works — but it needs you to
     * travel back to each of the four, and the beacons that were supposed to
     * cover the rest are culled by the horizon most of the time.
     *
     * The row is already a legend the player has been reading all the way
     * through, in the monuments' own colours, and it is on screen from the
     * first second. Making it the index costs no new furniture at all.
     *
     * No href until lit, which also keeps it out of the tab order until it
     * means something — an anchor without one is not focusable.
     */
    const link = document.createElement("a");
    link.className = "pip-link";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const pip = document.createElement("span");
    pip.className = "pip";
    pip.style.color = `#${monuments[i].colour.toString(16).padStart(6, "0")}`;
    const name = document.createElement("span");
    name.className = "pip-name";
    name.textContent = monuments[i].label;
    link.append(pip, name);
    progressEl.appendChild(link);
  }
}

function renderProgress(lit, total) {
  if (!progressEl) return;
  const pips = progressEl.children;
  /*
   * Which pip, not how many.
   *
   * This used to light `i < lit`, which fills the row left to right in the
   * order you happened to arrive. Every pip already carries its own monument's
   * accent, so lighting the third monument turned on the *first* pip and the
   * row showed a colour that was nowhere on the horizon — the legend pointed
   * at the wrong thing, which is worse than no legend.
   *
   * Read off `monuments[i].lit`, which Progression sets before it calls back,
   * so the row cannot drift out of step with the world it is describing.
   */
  for (let i = 0; i < pips.length; i++) {
    const m = monuments[i];
    const link = pips[i];
    link.querySelector(".pip").classList.toggle("on", !!m.lit);
    if (m.lit && m.href) {
      link.href = m.href;
      link.setAttribute("aria-label", `Open ${m.label}`);
      link.classList.add("on");
    }
  }
  progressEl.setAttribute("aria-label", `${lit} of ${total} monuments lit`);
}

const wayfinder = new Wayfinder(document.getElementById("wayfinder"), camera);
const beacons = new Beacons(document.getElementById("beacons"), camera, monuments);

const clockEl = document.getElementById("clock");
const againBtn = document.getElementById("again");

/** Wall-clock ms at first input. The run is timed from when you took over. */
let runStart = 0;
/** Seconds, or null on a first ever visit. */
const bestBefore = readBest();
/** True once the run is over, so the clock stops rather than freezing by luck. */
let runDone = false;
/** How many crystal clusters have been rung this run. */
const rung = new Set();

/*
 * The clock runs from the second visit onward.
 *
 * Someone seeing this for the first time should get to wander, find things and
 * be surprised by dawn. A timer ticking in the corner turns all of that into a
 * task. Once there is a best time there is something to beat, and that is the
 * point at which a clock is an invitation rather than a demand.
 */
const timed = bestBefore !== null;
if (timed && clockEl) {
  clockEl.textContent = `best ${formatTime(bestBefore)}`;
  clockEl.classList.add("on", "idle");
}

if (againBtn) {
  // Same palette, same seeded world, fresh run. Reload rather than a reset
  // path: there is no second state to keep in sync and nothing to get wrong.
  againBtn.addEventListener("click", () => location.reload());
}

const progression = new Progression(monuments, {
  onApproach: () => audio.threshold(),
  onLight: (index, lit, total) => {
    audio.chime(lit - 1);
    renderProgress(lit, total);
    wayfinder.reset();
  },
  onComplete: () => {
    /*
     * The ending hands the work over.
     *
     * Every lit monument grows a permanent label anchored to its pillar, so
     * the planet finishes the piece covered in its own contents and the four
     * links are reachable from anywhere instead of only by trekking back to
     * each one. The run time appears once, under the pips.
     *
     * No modal, no menu, nothing to dismiss — the world stays playable, which
     * is the whole reason someone would send the link on.
     */
    beacons.reveal();

    runDone = true;
    if (clockEl && runStart) {
      const secs = (performance.now() - runStart) / 1000;
      const { best, improved } = submit(secs);
      clockEl.classList.remove("idle");
      clockEl.classList.add("on");
      clockEl.classList.toggle("record", improved && bestBefore !== null);
      // The crystals are optional and never asked for, so they are reported
      // rather than scored — a note about what you found, not a target missed.
      const found = rung.size
        ? `  ·  ${rung.size}/${crystalClusters.length} crystals`
        : "";
      clockEl.textContent = improved && bestBefore !== null
        ? `${formatTime(secs)}  ·  best${found}`
        : `${formatTime(secs)}${best !== null && best < secs ? `  ·  best ${formatTime(best)}` : ""}${found}`;
    }
    if (againBtn) againBtn.hidden = false;

    /*
     * Aim the terminator.
     *
     * The lit cap is centred on the camera's forward tangent, which is a point
     * on the horizon straight ahead of you. As the threshold walks from +1 to
     * -1 the cap grows from there, so the line of light rises over the horizon
     * you are looking at, travels toward you, crosses you at the halfway
     * point, and carries on behind. You watch it coming.
     *
     * Centring it on the player instead would light the ground under your feet
     * first and expand outward, which reads as a spotlight rather than a
     * sunrise. Centring it opposite would keep it out of sight for half the
     * transition.
     */
    handles.sweep.uSweepAxis.value.copy(chase.viewForward).normalize();
    handles.sweep.uSweepRim.value.set(P.dawn?.sun ?? P.sun).multiplyScalar(0.42);
    // Reduced motion: a half-width of 2 in cosine space covers the whole
    // sphere at once, so the sweep degrades cleanly into the crossfade it
    // replaced rather than needing a separate code path.
    handles.sweep.uSweepSoft.value = REDUCED_MOTION ? 2.0 : 0.09;

    audio.swell(11);
    if (progressEl) progressEl.classList.add("done");
    if (hintEl) {
      hintEl.textContent = "open a project from its marker";
      hintEl.style.opacity = "1";
    }
  },
});
buildProgress(progression.total);
renderProgress(0, progression.total);

const introEl = document.getElementById("intro");

function dismissIntro() {
  if (!introEl || introEl.classList.contains("gone")) return;
  introEl.classList.add("gone");
  setTimeout(() => introEl.remove(), 900);
}

// Backstop. Someone who just watches should not be reading the same card a
// minute later — the world is the point, and the card has said its piece.
setTimeout(dismissIntro, 9000);

/* -------------------------------------------------------------------- jump */

const jumpBtn = document.getElementById("jump");

function doJump() {
  if (!runStart) runStart = performance.now();
  marble.requestJump();
  ensureAudio();
  dismissIntro();
  if (hintEl) hintEl.style.opacity = "0";
}

addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  // See isControlTarget: Space belongs to a focused button before it belongs
  // to the marble.
  if (isControlTarget(e.target)) return;
  // Space scrolls the page by default, and on a fixed-height body that is a
  // silent no-op that eats the keypress.
  e.preventDefault();
  if (!e.repeat) doJump();
}, { passive: false });

if (jumpBtn) {
  // pointerdown, not click: a jump that waits for the finger to lift is a
  // jump that happens after you needed it.
  jumpBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    doJump();
  });
}

const input = new Input(renderer.domElement, document.getElementById("stick"));
input.onFirstUse = () => {
  runStart = performance.now();
  ensureAudio();
  if (hintEl) hintEl.style.opacity = "0";
  // The card is the first thing anyone sees, and it should leave the instant
  // they show they do not need it.
  dismissIntro();
};

/* ----------------------------------------------------------------- palette */

const palBar = document.getElementById("pal");
if (palBar) {
  const segBg = palBar.querySelector(".seg-bg");

  // Park the sliding mark under the active label. Measured rather than
  // hardcoded, because the labels are different widths and the breakpoint
  // changes the padding.
  function placeSeg() {
    const active = palBar.querySelector('button[aria-pressed="true"]');
    if (!active || !segBg) return;
    segBg.style.width = `${active.offsetWidth}px`;
    segBg.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  for (const btn of palBar.querySelectorAll("button[data-p]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.p === paletteKey));
    btn.addEventListener("click", () => {
      // Reload rather than rebuild every material in place. The world is
      // seeded, so a reload gives back the identical planet — cheap, and no
      // half-updated state to get wrong.
      location.hash = btn.dataset.p;
      location.reload();
    });
  }

  placeSeg();
  addEventListener("resize", placeSeg);
  // Fonts land after first paint and change the measured widths.
  if (document.fonts?.ready) document.fonts.ready.then(placeSeg);
}
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "p") return;
  const keys = Object.keys(PALETTES);
  location.hash = keys[(keys.indexOf(paletteKey) + 1) % keys.length];
  location.reload();
});

/* ------------------------------------------------------------------ labels */

const markerEl = document.getElementById("marker");
const _proj = new THREE.Vector3();
const _radial = new THREE.Vector3();

/** The monument currently under the marker, or null. */
let focused = null;
/** Its lit state when the card was last built. */
let focusedLit = false;

function setMarker(m) {
  /*
   * Rebuild on a change of monument *or* of its lit state.
   *
   * This used to bail on `focused === m` alone, which meant that lighting a
   * monument while standing next to it left the plain name card up: the same
   * object, so no rebuild, so no link. You had to roll out of range and back
   * in before the piece would offer you the thing you had just earned. It read
   * as the link taking a long time to appear, and it was in fact never going
   * to appear until you left.
   */
  if (focused === m && focusedLit === !!m?.lit) return;
  focused = m;
  focusedLit = !!m?.lit;
  if (!m) return;

  if (m.lit && m.href) {
    // Only a lit monument is a link. Before that it is a name you found, and
    // making it clickable would let someone skip the whole point of the piece.
    markerEl.href = m.href;
    markerEl.innerHTML =
      `<span class="mk-name">${m.label}</span>` +
      `<span class="mk-blurb">${m.blurb}</span>` +
      `<span class="mk-open">open ↗</span>`;
  } else {
    markerEl.removeAttribute("href");
    markerEl.textContent = m.label;
  }
  markerEl.classList.toggle("lit", !!m.lit);
}

function updateMarker() {
  if (!markerEl) return;

  /*
   * The marker keeps working after dawn.
   *
   * It used to stand down here, on the theory that the beacons label every
   * monument permanently and a proximity card would be a second label for the
   * pillar you are already next to.
   *
   * The beacons are not permanent. They are culled by the same exact horizon
   * test the wayfinder uses, and again by whether the pillar is in front of
   * the camera, so on a planet this small you can normally see one of the four
   * and only when facing it. Measured at the end of a finished run: all four
   * beacons at opacity 0 and pointer-events none. Completing the piece could
   * leave you with no way to open anything, which is the exact opposite of
   * what the ending is for.
   *
   * So the marker stays, and the duplicate is solved from the other end — the
   * beacon for whichever monument the marker is currently showing steps aside.
   */
  let best = null;
  let bestD = LABEL_RANGE;
  for (const m of monuments) {
    const d = m.pos.distanceTo(marble.pos);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (!best) {
    markerEl.style.opacity = "0";
    markerEl.classList.remove("shown");
    focused = null;
    return;
  }
  _proj.copy(best.pos).project(camera);
  // z > 1 means behind the near plane; projecting it would put the label on
  // the wrong side of the screen.
  if (_proj.z > 1) {
    markerEl.style.opacity = "0";
    markerEl.classList.remove("shown");
    return;
  }

  // Rebuild only on change. This runs every frame, and rewriting innerHTML
  // sixty times a second would throw away the element the user is aiming at.
  setMarker(best);

  /*
   * Keep the marker on screen.
   *
   * Standing at the foot of a monument puts its top well above the viewport,
   * and the label rides 190% above that again. Unclamped it leaves the screen
   * exactly when you are closest to it — and now that a lit marker is the link
   * to the project, losing it there loses the only way in.
   */
  const w = markerEl.offsetWidth;
  const h = markerEl.offsetHeight;
  const pad = 8;
  // Clear the progress dots, which sit centred along the top and are the one
  // thing the marker reliably collides with once it is clamped upward.
  const topInset = 42;
  const x = (_proj.x * 0.5 + 0.5) * innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * innerHeight;

  markerEl.style.left = `${Math.min(Math.max(x, w / 2 + pad), innerWidth - w / 2 - pad)}px`;
  // The element is translated up by 190% of its own height, so its top edge is
  // at y - 1.9h. That is what has to clear the top of the viewport.
  markerEl.style.top = `${Math.min(Math.max(y, h * 1.9 + topInset), innerHeight - pad)}px`;
  markerEl.style.opacity = "1";
  markerEl.classList.add("shown");
}

// Keyboard equivalent of clicking the marker, so the piece is finishable
// without a pointer at all.
addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (focused?.lit && focused.href) window.open(focused.href, "_blank", "noopener");
});

/* -------------------------------------------------------------------- loop */

const DEV = location.search.includes("dev");
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hudEl = DEV ? document.getElementById("hud") : null;
if (hudEl) hudEl.hidden = false;
let accumulator = 0;
let last = performance.now();
let frames = 0;
let fpsAcc = 0;
let workAcc = 0;
let lastDawn = -1;
let hitStop = 0;

/*
 * Context loss.
 *
 * A phone that backgrounds the tab, sleeps, or simply runs low on GPU memory
 * can take the WebGL context away, and the default outcome is a black
 * rectangle that never comes back — with the loop still running, still
 * stepping physics, still burning battery on a canvas nobody can see.
 *
 * `preventDefault` on the loss event is what tells the browser we would like
 * it back; without that call `webglcontextrestored` never fires at all. Three
 * rebuilds its own GPU-side state on restore, so there is nothing to do on the
 * way back in except start drawing again.
 */
let contextLost = false;
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
  // setPageVisible, not setMuted: the user did not choose this, and setMuted
  // would persist it into their next visit.
  audio.setPageVisible?.(false);
  document.getElementById("ctxlost")?.style.setProperty("display", "grid");
}, false);
renderer.domElement.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  audio.setPageVisible?.(!document.hidden);
  // The clock has to be reset or the first frame back carries the whole
  // outage as one delta, and the marble is thrown off the planet.
  last = performance.now();
  document.getElementById("ctxlost")?.style.removeProperty("display");
}, false);

function frame(now) {
  requestAnimationFrame(frame);
  // Keep the loop alive so the restore event can be handled, but do no work.
  if (contextLost) { last = now; return; }

  let wall = (now - last) / 1000;
  last = now;
  // A backgrounded tab returns a huge delta. Catching up on it would run
  // hundreds of steps in one frame and fling the marble off the planet.
  if (wall > 0.25) wall = 0.25;
  accumulator += wall;

  const t0 = performance.now();

  /*
   * Hit-stop: freeze the simulation for a few frames on a heavy impact.
   *
   * Rendering continues, so it is not a stall — the world simply stops
   * advancing for about 90ms, which makes a hard landing land. It is the
   * cheapest weight cue in games and almost nobody notices it consciously.
   */
  const inp = input.read();
  let steps = 0;
  if (hitStop > 0) {
    hitStop -= wall;
    accumulator = 0;
  } else {
    while (accumulator >= DT && steps < MAX_STEPS) {
      // viewForward, not forward: steering has to answer to what is on
      // screen, or looking left and pushing forward sends you somewhere else.
      marble.step(DT, inp, chase.viewForward, capsules);
      accumulator -= DT;
      steps++;
    }
  }

  marble.sync(wall);
  if (lamp) {
    const d = marble.pos.length();
    lamp.position.copy(marble.pos).multiplyScalar((d + 4.2) / d);
  }

  progression.update(marble.pos, wall, REDUCED_MOTION);
  wayfinder.update(monuments, marble.pos, wall);
  beacons.update();

  // Only touch the scene while dawn is actually moving. Once it has landed
  // this costs nothing for the rest of the session.
  const dawn = progression.easedDawn;
  if (dawn !== lastDawn) {
    applyDawn(paletteState, P, dawn);
    applyPaletteState(scene, renderer, handles, paletteState);
    // Threshold walks +1 (nothing lit) to -1 (everything lit). Padded a little
    // past each end so the first and last slivers of ground actually finish.
    handles.sweep.uSweepT.value = 1.12 - dawn * 2.24;
    atmosphere.set(paletteState.atmoColor, paletteState.atmoInt);
    post.setBloomStrength(paletteState.bloomStrength);
    // Night sounds small and close; morning opens up.
    audio.setDawn(dawn);
    lastDawn = dawn;
  }

  if (marble.jumped) {
    marble.jumped = false;
    audio.jump();
  }
  // Slope is 0 on the flat and rises with the steepness of the ground under
  // the marble, which the contact normal already knows.
  const slope = marble.grounded
    ? 1 - marble.groundN.dot(_radial.copy(marble.pos).normalize())
    : 0;
  audio.updateRoll(marble.speed, MAX_SPEED, marble.grounded, slope);
  fadeClusters(crystalClusters, wall);

  // The live clock. Only while timed, only once you have taken over, and it
  // stops the moment the run ends rather than being left to freeze by luck.
  if (timed && !runDone && runStart && clockEl) {
    clockEl.classList.remove("idle");
    clockEl.textContent = formatTime((now - runStart) / 1000);
  }

  const hit = marble.takeImpact();
  if (hit) {
    const struck = marble.hitCapsule;
    // A landing has a body under the knock; a rock does not; a crystal does
    // not sound like either. The flag is written by whichever contact won the
    // peak, so it needs no clearing here — clearing it inside this branch used
    // to let it latch across the impact-free contacts of ordinary rolling.
    if (struck?.kind === "crystal") {
      audio.crystal(hit, struck.cluster);
      ringCluster(crystalClusters, struck.cluster, hit);
      rung.add(struck.cluster);
    } else if (struck?.kind === "stone") audio.stone(hit);
    else if (marble.landed) audio.land(hit);
    else audio.knock(hit);
    marble.squashOnLanding(hit);
    // Only genuinely hard landings freeze. Every knock doing it would make
    // ordinary rolling feel like the framerate is broken.
    if (hit > 9) hitStop = HIT_STOP;
  }

  // The shadow camera covers a 32-unit cap, so it has to travel with the
  // thing casting into it. Snapped to texels inside aimShadow, or the edges
  // crawl as you roll.
  handles.aimShadow(marble.pos);

  {
    const l = input.takeLook(wall);
    if (l.yaw || l.pitch) chase.look(l.yaw, l.pitch);
  }
  chase.update(marble.pos, marble.vel, wall, marble.speed);
  // The marker owns the pillar you are standing at; its beacon steps aside so
  // there are never two labels on one monument.
  beacons.suppress = focused;
  updateMarker();
  post.render(now * 0.001);

  const t1 = performance.now();
  workAcc += t1 - t0;
  fpsAcc += wall;
  frames++;

  if (frames >= 30 && hudEl) {
    const fps = frames / fpsAcc;
    const ms = workAcc / frames;
    hudEl.textContent =
      `${P.name}\n${P.note}\n\n` +
      `fps    ${fps.toFixed(1)}\n` +
      `work   ${ms.toFixed(2)} ms/frame  ${ms < 16.7 ? "OK" : "OVER"}\n` +
      `speed  ${marble.speed.toFixed(1)}`;
    frames = 0;
    fpsAcc = 0;
    workAcc = 0;
  }
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  // fov is owned by the chase camera; only aspect changes here.
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// Dev handle, off unless asked for. Reaching a monument on the far side of the
// planet takes fifteen seconds of rolling, which is a slow way to check that
// dawn works. `?dev` lets a test put the marble where it needs to be.
if (location.search.includes("dev")) {
  window.__orrery = {
    marble, monuments, progression, audio, scene, renderer, handles, P, crystalClusters,
    camera, chase, wayfinder, capsules, post, atmosphere,
    /** Drop the marble next to monument `i`, on the surface. */
    warpTo(i) {
      const m = monuments[i];
      marble.pos.copy(m.base).setLength(marble.pos.length());
      marble.vel.set(0, 0, 0);
    },
  };
}

requestAnimationFrame(frame);

// Nothing in this scene animates on its own — the world is completely still
// until you move it, and dawn only happens because you made it happen. That is
// why prefers-reduced-motion needs no special case here. Keep it that way: any
// idle animation added later has to be gated on that query.
