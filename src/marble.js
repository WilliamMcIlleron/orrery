import * as THREE from "three";
import {
  R_COL, BALL_R, GRAVITY, ACCEL, AIR_ACCEL,
  DRAG, ROLL_FRIC, BOUNCE, MAX_SPEED,
} from "./config.js";
import { orthonormalise, closestOnSegment } from "./geometry.js";

// Module-scope scratch vectors. Allocating inside the step would produce a few
// hundred short-lived Vector3s a second and hand the GC a reason to stutter.
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _n = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * The marble, and all of its physics.
 *
 * There is no physics engine here on purpose. Everything this needs is
 * sphere-against-sphere and sphere-against-capsule, both of which are exact
 * and about twenty lines each. A general solver would be slower, heavier, and
 * would not do anything visible that this does not.
 */
export class Marble {
  constructor(scene, P) {
    this.mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_R, 3),
      new THREE.MeshStandardMaterial({
        color: P.marble,
        roughness: 0.45,
        // A glossy marble needs something to reflect. In the flat palettes
        // there is nothing, and the highlight just reads as a smudge. Kept low
        // even where there is: a mirror-bright marble under its own lamp is
        // the brightest thing on screen and bloom turns it into a fireball.
        metalness: P.lamp ? 0.18 : 0.05,
        flatShading: true,
      }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // Spawn above the north pole and let it fall in. Cheaper than a scripted
    // intro and it demonstrates gravity in the first half second.
    this.pos = new THREE.Vector3(0, R_COL + BALL_R + 6, 0);
    this.vel = new THREE.Vector3();
    this.grounded = false;

    /**
     * Strongest impact since the last read, as a normal velocity.
     *
     * Reported as a single peak rather than a list: several sub-steps can
     * collide within one rendered frame, and firing a sound for each would
     * machine-gun. The loudest one is the one you would actually hear.
     */
    this.impact = 0;
  }

  /** Read and clear the accumulated impact. */
  takeImpact() {
    const i = this.impact;
    this.impact = 0;
    return i;
  }

  get speed() {
    return this.vel.length();
  }

  /**
   * Advance one fixed step.
   *
   * @param {number} dt      fixed timestep
   * @param {{x:number,y:number}} input
   * @param {THREE.Vector3} camFwd  unit vector, tangent to the surface
   * @param {Array} capsules
   */
  step(dt, input, camFwd, capsules) {
    const { pos, vel } = this;

    _up.copy(pos).normalize();

    // Input is camera-relative, which is what makes a rolling ball feel right.
    // Steering a heading like a car would be easier to write and worse to use.
    if (input.x || input.y) {
      orthonormalise(_right.copy(camFwd).cross(_up), _up);
      const a = this.grounded ? ACCEL : AIR_ACCEL;
      vel.addScaledVector(_right, input.x * a * dt);
      vel.addScaledVector(camFwd, -input.y * a * dt);
    }

    vel.addScaledVector(_up, -GRAVITY * dt);
    vel.multiplyScalar(1 - DRAG * dt);

    if (this.grounded) {
      // Rolling friction, applied only to the tangential component. Cut hard
      // while steering, or holding a direction fights the friction and the
      // marble feels like it is rolling through sand.
      _vt.copy(vel).addScaledVector(_up, -vel.dot(_up));
      vel.addScaledVector(_vt, -ROLL_FRIC * dt * (input.x || input.y ? 0.35 : 1.0));
    }

    const sp = vel.length();
    if (sp > MAX_SPEED) vel.multiplyScalar(MAX_SPEED / sp);

    pos.addScaledVector(vel, dt);

    this._collidePlanet();
    this._collideCapsules(capsules);
    this._roll(dt);
  }

  _collidePlanet() {
    const { pos, vel } = this;
    this.grounded = false;
    const dist = pos.length();
    const minD = R_COL + BALL_R;
    if (dist >= minD) return;

    _up.copy(pos).divideScalar(dist);
    pos.copy(_up).multiplyScalar(minD);
    const vn = vel.dot(_up);
    if (vn < 0) {
      // Only landings count, not the constant micro-contact of resting on the
      // ground. Below this the marble is simply in contact, not hitting.
      if (-vn > 2.5 && -vn > this.impact) this.impact = -vn;
      vel.addScaledVector(_up, -vn * (1 + BOUNCE));
    }
    this.grounded = true;
  }

  _collideCapsules(capsules) {
    const { pos, vel } = this;
    for (let i = 0; i < capsules.length; i++) {
      const c = capsules[i];
      closestOnSegment(c.a, c.b, pos, _cp);
      _n.subVectors(pos, _cp);
      const d = _n.length();
      const minD = c.r + BALL_R;
      if (d >= minD || d < 1e-6) continue;
      _n.divideScalar(d);
      pos.addScaledVector(_n, minD - d);
      const vn = vel.dot(_n);
      if (vn < 0) {
        // Rocks get a lower threshold than the ground: hitting one is an
        // event, whereas resting on the ground is the default state.
        if (-vn > 0.8 && -vn > this.impact) this.impact = -vn;
        vel.addScaledVector(_n, -vn * (1 + BOUNCE));
      }
    }
  }

  /**
   * Spin the mesh to match the distance travelled.
   *
   * Small detail, large effect: without it the marble slides like a hockey
   * puck and the whole thing reads as fake, whatever else is right.
   */
  _roll(dt) {
    const { pos, vel } = this;
    _up.copy(pos).normalize();
    _vt.copy(vel).addScaledVector(_up, -vel.dot(_up));
    const vtl = _vt.length();
    if (vtl <= 1e-4) return;
    _axis.crossVectors(_up, _vt).normalize();
    _q.setFromAxisAngle(_axis, -(vtl * dt) / BALL_R);
    this.mesh.quaternion.premultiply(_q);
  }

  /** Copy simulation state onto the mesh. Called once per rendered frame. */
  sync() {
    this.mesh.position.copy(this.pos);
  }
}
