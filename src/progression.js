import { TOUCH_RANGE, LIGHT_RISE, DAWN_SECONDS, DAWN_HOLD } from "./config.js";

/**
 * The reason the world exists.
 *
 * You start in the dark. Touching a monument lights it. Lighting all of them
 * breaks dawn over the whole planet.
 *
 * Without this the piece is a nice place with nothing to do in it — you roll,
 * you find a pillar, and nothing happens. The mechanic costs very little and
 * it is the difference between a demo and something someone finishes.
 */
export class Progression {
  constructor(monuments, { onLight, onComplete } = {}) {
    this.monuments = monuments;
    this.onLight = onLight ?? (() => {});
    this.onComplete = onComplete ?? (() => {});
    this.litCount = 0;
    this.complete = false;

    /** Dawn progress, 0 to 1. Drives the palette interpolation. */
    this.dawn = 0;
    this._holdLeft = DAWN_HOLD;
    this._clock = 0;
  }

  get total() {
    return this.monuments.length;
  }

  update(marblePos, dt, reducedMotion = false) {
    this._clock += dt;
    // --- contact ---
    for (let i = 0; i < this.monuments.length; i++) {
      const m = this.monuments[i];
      if (m.lit) continue;
      if (marblePos.distanceTo(m.base) > TOUCH_RANGE) continue;
      m.lit = true;
      this.litCount++;
      this.onLight(i, this.litCount, this.total);
      if (this.litCount === this.total) {
        this.complete = true;
        this.onComplete();
      }
    }

    // --- per-monument light-up animation ---
    for (const m of this.monuments) {
      const target = m.lit ? 1 : 0;
      if (m.t !== target) {
        m.t = Math.min(1, m.t + dt / LIGHT_RISE);
      }
      // Overshoot on the way up so it flares and settles rather than simply
      // getting brighter. A linear fade reads as a value change, not an event.
      const flare = m.t < 1 ? 1 + Math.sin(m.t * Math.PI) * 1.6 : 1;
      m.collarMat.emissiveIntensity = 0.35 + m.t * 1.5 * flare;
      if (m.glow) m.glow.intensity = m.t * 11 * flare;
      // The beam overshoots hard and settles low: it should punch on ignition
      // and then sit there as a landmark rather than shouting permanently.
      if (m.beamMat) m.beamMat.uniforms.uOpacity.value = m.t * 0.42 * flare;

      if (m.ringMat) {
        if (m.lit) {
          // Once lit the ring has done its job. It stays as a faint trace so
          // the place still reads as marked, but it stops asking for attention.
          m.ringMat.opacity = 0.34 + m.t * (0.55 * flare - 0.24);
        } else {
          // A slow pulse. This is the only thing in the world that moves on its
          // own, which is why reduced motion holds it still rather than hiding
          // it — the ring is information, the breathing is decoration.
          m.ringMat.opacity = reducedMotion
            ? 0.34
            : 0.26 + Math.sin(this._clock * 1.7) * 0.11;
        }
      }
    }

    // --- dawn ---
    if (this.complete) {
      // Hold a beat before the sky moves. The chime for the fourth monument
      // needs room to land, and an instant sunrise reads as a bug.
      if (this._holdLeft > 0) {
        this._holdLeft -= dt;
      } else if (this.dawn < 1) {
        this.dawn = Math.min(1, this.dawn + dt / DAWN_SECONDS);
      }
    }
  }

  /** Eased dawn, for anything that should not move linearly. */
  get easedDawn() {
    const t = this.dawn;
    // smootherstep: zero first and second derivative at both ends, so the sky
    // neither starts nor stops abruptly.
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
}
