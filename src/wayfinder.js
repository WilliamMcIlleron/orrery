import * as THREE from "three";
import { WAYFINDER_DELAY } from "./config.js";
import { seesOverHorizon } from "./geometry.js";

const _p = new THREE.Vector3();

/**
 * An arrow at the edge of the screen pointing at the nearest unlit monument.
 *
 * On a sphere, everything worth finding is over the horizon, which is the good
 * part of the concept and also the risk: someone who rolls for twenty seconds
 * without meeting anything concludes there is nothing there and leaves before
 * the payoff.
 *
 * Two rules keep it from spoiling the discovery:
 *
 *   - It only appears after WAYFINDER_DELAY seconds without progress, so the
 *     first thing you do is explore rather than follow an instruction. The
 *     timer resets every time a monument lights.
 *   - It hides the moment its target is on screen, because at that point the
 *     glowing collar is a better cue than an arrow.
 *
 * It reads as "there is something that way", not "go here".
 */
export class Wayfinder {
  constructor(el, camera) {
    this.el = el;
    this.camera = camera;
    this.idle = 0;
    this.visible = false;
  }

  /** Call whenever the player makes progress. */
  reset() {
    this.idle = 0;
  }

  update(monuments, marblePos, dt) {
    if (!this.el) return;
    this.idle += dt;

    // Nearest unlit monument, by distance across the surface.
    let best = null;
    let bestD = Infinity;
    for (const m of monuments) {
      if (m.lit) continue;
      const d = m.base.distanceTo(marblePos);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }

    if (!best || this.idle < WAYFINDER_DELAY) return this._hide();

    // Projection has no idea the world is round: a monument fifty degrees past
    // the horizon still lands inside the screen rectangle. See geometry.js for
    // why the usual dot(p, c) >= R2 test is wrong for anything with height.
    const overHorizon = !seesOverHorizon(best.pos, this.camera.position);

    _p.copy(best.pos).project(this.camera);
    const behind = _p.z > 1;

    // A point behind the camera projects to the opposite side of the screen,
    // so its coordinates have to be flipped before they mean anything.
    let x = behind ? -_p.x : _p.x;
    let y = behind ? -_p.y : _p.y;

    const onScreen = !behind && Math.abs(x) < 0.86 && Math.abs(y) < 0.86;
    if (onScreen && !overHorizon) return this._hide();

    // Dead ahead but over the curve: the projection is near the centre, so its
    // direction is meaningless. "Keep going" is the honest arrow.
    if (Math.hypot(x, y) < 0.08) {
      x = 0;
      y = 1;
    }

    // Push the direction out to the screen edge, keeping its angle.
    const len = Math.hypot(x, y) || 1;
    const inset = 46;
    const halfW = innerWidth / 2 - inset;
    const halfH = innerHeight / 2 - inset;

    const nx = x / len;
    const ny = y / len;
    // Scale the unit direction until it touches whichever edge it reaches
    // first — this is what keeps the arrow on the rim rather than in a corner.
    const k = Math.min(halfW / Math.abs(nx || 1e-6), halfH / Math.abs(ny || 1e-6));
    const px = innerWidth / 2 + nx * k;
    const py = innerHeight / 2 - ny * k;

    this.el.style.left = `${px}px`;
    this.el.style.top = `${py}px`;
    // Screen y grows downward, so the angle is negated.
    this.el.style.setProperty("--a", `${Math.atan2(-ny, nx)}rad`);

    if (!this.visible) {
      this.visible = true;
      this.el.classList.add("on");
    }
    this.el.setAttribute("aria-label", `Unlit monument: ${best.label}, ${Math.round(bestD)} away`);
  }

  _hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.remove("on");
  }
}
