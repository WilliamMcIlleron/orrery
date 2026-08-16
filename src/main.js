import * as THREE from "three";
import { DT, MAX_STEPS, LABEL_RANGE, MAX_SPEED } from "./config.js";
import { PALETTES, resolvePaletteKey, makePaletteState, applyDawn } from "./palettes.js";
import { CONTENT } from "./content.js";
import { buildWorld, applyPaletteState } from "./world.js";
import { Input } from "./input.js";
import { Marble } from "./marble.js";
import { ChaseCamera } from "./chase-camera.js";
import { Progression } from "./progression.js";
import { Audio } from "./audio.js";

const paletteKey = resolvePaletteKey();
const P = PALETTES[paletteKey];

/* ---------------------------------------------------------------- renderer */

const scene = new THREE.Scene();
scene.background = new THREE.Color(P.bg);
scene.fog = new THREE.Fog(P.bg, P.fogNear, P.fogFar);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

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

const { capsules, monuments, lamp, handles } = buildWorld(scene, P, CONTENT);
const marble = new Marble(scene, P);
const chase = new ChaseCamera(camera);

const paletteState = makePaletteState(P);
applyPaletteState(scene, renderer, handles, paletteState);

/* ------------------------------------------------------------------- audio */

const audio = new Audio();
const muteBtn = document.getElementById("mute");

// Audio contexts cannot start outside a user gesture, so the engine is built
// on the very first input rather than at load.
function ensureAudio() {
  audio.start();
  if (muteBtn) muteBtn.hidden = false;
}

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    const next = !audio.muted;
    audio.setMuted(next);
    muteBtn.setAttribute("aria-pressed", String(next));
    muteBtn.textContent = next ? "sound off" : "sound on";
  });
}

/* ------------------------------------------------------------- progression */

const progressEl = document.getElementById("progress");

function renderProgress(lit, total) {
  if (!progressEl) return;
  // A row of dots, not a number. "2 / 4" reads as a task; four dots with two
  // filled reads as something you are in the middle of.
  progressEl.textContent = "●".repeat(lit) + "○".repeat(total - lit);
  progressEl.setAttribute("aria-label", `${lit} of ${total} monuments lit`);
}

const progression = new Progression(monuments, {
  onLight: (index, lit, total) => {
    audio.chime(lit - 1);
    renderProgress(lit, total);
  },
  onComplete: () => {
    audio.swell(11);
    if (progressEl) progressEl.classList.add("done");
  },
});
renderProgress(0, progression.total);

const input = new Input(renderer.domElement, document.getElementById("stick"));
const hintEl = document.getElementById("hint");
input.onFirstUse = () => {
  ensureAudio();
  if (hintEl) hintEl.style.opacity = "0";
};

/* ----------------------------------------------------------------- palette */

const palBar = document.getElementById("pal");
if (palBar) {
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

function updateMarker() {
  if (!markerEl) return;
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
    return;
  }
  _proj.copy(best.pos).project(camera);
  // z > 1 means behind the near plane; projecting it would put the label on
  // the wrong side of the screen.
  if (_proj.z > 1) {
    markerEl.style.opacity = "0";
    return;
  }
  markerEl.textContent = best.label;
  markerEl.classList.toggle("lit", best.lit);
  markerEl.style.left = `${(_proj.x * 0.5 + 0.5) * innerWidth}px`;
  markerEl.style.top = `${(-_proj.y * 0.5 + 0.5) * innerHeight}px`;
  markerEl.style.opacity = "1";
}

/* -------------------------------------------------------------------- loop */

const hudEl = document.getElementById("hud");
let accumulator = 0;
let last = performance.now();
let frames = 0;
let fpsAcc = 0;
let workAcc = 0;
let lastDawn = -1;

function frame(now) {
  requestAnimationFrame(frame);

  let wall = (now - last) / 1000;
  last = now;
  // A backgrounded tab returns a huge delta. Catching up on it would run
  // hundreds of steps in one frame and fling the marble off the planet.
  if (wall > 0.25) wall = 0.25;
  accumulator += wall;

  const t0 = performance.now();

  const inp = input.read();
  let steps = 0;
  while (accumulator >= DT && steps < MAX_STEPS) {
    marble.step(DT, inp, chase.forward, capsules);
    accumulator -= DT;
    steps++;
  }

  marble.sync();
  if (lamp) {
    const d = marble.pos.length();
    lamp.position.copy(marble.pos).multiplyScalar((d + 2.2) / d);
  }

  progression.update(marble.pos, wall);

  // Only touch the scene while dawn is actually moving. Once it has landed
  // this costs nothing for the rest of the session.
  const dawn = progression.easedDawn;
  if (dawn !== lastDawn) {
    applyDawn(paletteState, P, dawn);
    applyPaletteState(scene, renderer, handles, paletteState);
    lastDawn = dawn;
  }

  audio.updateRoll(marble.speed, MAX_SPEED, marble.grounded);
  const hit = marble.takeImpact();
  if (hit) audio.knock(hit);

  chase.update(marble.pos, marble.vel, wall);
  updateMarker();
  renderer.render(scene, camera);

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
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Dev handle, off unless asked for. Reaching a monument on the far side of the
// planet takes fifteen seconds of rolling, which is a slow way to check that
// dawn works. `?dev` lets a test put the marble where it needs to be.
if (location.search.includes("dev")) {
  window.__orrery = {
    marble, monuments, progression, audio, scene, renderer, handles, P,
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
