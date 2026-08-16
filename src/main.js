import * as THREE from "three";
import { DT, MAX_STEPS, LABEL_RANGE } from "./config.js";
import { PALETTES, resolvePaletteKey } from "./palettes.js";
import { CONTENT } from "./content.js";
import { buildWorld } from "./world.js";
import { Input } from "./input.js";
import { Marble } from "./marble.js";
import { ChaseCamera } from "./chase-camera.js";

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

const { capsules, monuments, lamp } = buildWorld(scene, P, CONTENT);
const marble = new Marble(scene, P);
const chase = new ChaseCamera(camera);

const hintEl = document.getElementById("hint");
const input = new Input(renderer.domElement, document.getElementById("stick"));
input.onFirstUse = () => {
  if (hintEl) hintEl.style.opacity = "0";
};

/* ----------------------------------------------------------------- palette */

const palBar = document.getElementById("pal");
if (palBar) {
  for (const btn of palBar.querySelectorAll("button")) {
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
  // z > 1 means behind the near plane; projecting it would place the label on
  // the wrong side of the screen.
  if (_proj.z > 1) {
    markerEl.style.opacity = "0";
    return;
  }
  markerEl.textContent = best.label;
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

requestAnimationFrame(frame);

// Nothing in this scene animates on its own — the world is completely still
// until you move it. That is a deliberate property, and it is why
// prefers-reduced-motion needs no special case here. Keep it that way: any
// idle animation added later has to be gated on that query.
