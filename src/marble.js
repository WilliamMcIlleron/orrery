import * as THREE from "three";
import {
  R_COL, BALL_R, GRAVITY, ACCEL, AIR_ACCEL,
  DRAG, ROLL_FRIC, BOUNCE, MAX_SPEED, JUMP_SPEED, COYOTE_TIME,
} from "./config.js";
import { orthonormalise, closestOnSegment, groundRadius, groundNormal } from "./geometry.js";
import { addSurfaceNoise } from "./surface.js";

// Module-scope scratch vectors. Allocating inside the step would produce a few
// hundred short-lived Vector3s a second and hand the GC a reason to stutter.
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _n = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _gn = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _rad = new THREE.Vector3();

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
    /*
     * Two nested objects, deliberately.
     *
     * The mesh owns its spin, which is accumulated by premultiplying a
     * quaternion every step and must never be reset. The rig owns position,
     * surface orientation and scale. Squashing the mesh directly would mean
     * writing scale on the same object whose rotation is being integrated, and
     * the deformation would tumble with the marble instead of staying aligned
     * with the ground.
     */
    this.rig = new THREE.Group();
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
    /*
     * Veining, sampled in object space so it turns with the ball.
     *
     * The marble is the thing you look at for the entire piece, and it was the
     * only object in the scene with no features at all — a plain sphere under
     * a directional light barely reads as rotating, which quietly wasted the
     * roll integration that exists specifically to sell that it is.
     */
    addSurfaceNoise(this.mesh.material, {
      scale: 1.15,
      colour: 0.13,
      rough: 0.5,
      objectSpace: true,
      veins: P.marbleVeins ?? 0.55,
      veinColour: P.marbleVein ?? 0x000000,
    });

    this.mesh.castShadow = true;
    this.rig.add(this.mesh);
    scene.add(this.rig);

    /** Current deformation, 0 = sphere. Positive stretches along the normal. */
    this._squash = 0;

    // Spawn above the north pole and let it fall in. Cheaper than a scripted
    // intro and it demonstrates gravity in the first half second.
    this.pos = new THREE.Vector3(0, R_COL + BALL_R + 6, 0);

    /** Live surface normal under the marble. Radial while airborne. */
    this.groundN = new THREE.Vector3(0, 1, 0);
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

    /** Seconds since last touching the ground. Drives coyote time. */
    this.airborneFor = 0;

    /** True on the frame the marble returns to ground after real airtime. */
    this.landed = false;

    /** Set by the input layer; consumed on the next grounded step. */
    this.jumpQueued = false;
  }

  /** Request a jump. Buffered, so pressing slightly early still works. */
  requestJump() {
    this.jumpQueued = true;
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

    // Jump before gravity, so the full impulse survives this step.
    if (this.jumpQueued && this.airborneFor <= COYOTE_TIME) {
      this.jumpQueued = false;
      this.airborneFor = COYOTE_TIME + 1; // no double jump off one contact
      // Replace the vertical component rather than adding to it, or a jump
      // taken while already rising off a bump goes absurdly high.
      // Leave along the surface, so jumping off a slope carries you sideways
      // the way it should rather than straight away from the core.
      const nrm = this.grounded ? this.groundN : _up;
      const vn = vel.dot(nrm);
      vel.addScaledVector(nrm, JUMP_SPEED - vn);
      this.jumped = true;
    }

    vel.addScaledVector(_up, -GRAVITY * dt);
    vel.multiplyScalar(1 - DRAG * dt);

    if (this.grounded) {
      // Rolling friction, applied only to the tangential component — measured
      // against the contact normal, so friction on a slope acts along the
      // slope rather than across it.
      _vt.copy(vel).addScaledVector(this.groundN, -vel.dot(this.groundN));
      vel.addScaledVector(_vt, -ROLL_FRIC * dt * (input.x || input.y ? 0.35 : 1.0));
    }

    const sp = vel.length();
    if (sp > MAX_SPEED) vel.multiplyScalar(MAX_SPEED / sp);

    pos.addScaledVector(vel, dt);

    this.airborneFor += dt;
    this._collidePlanet();
    this._collideCapsules(capsules);
    this._roll(dt);
  }

  /*
   * Collision against the actual displaced ground.
   *
   * This used to test against a fixed sphere at the midpoint of the relief,
   * which meant the marble hovered up to RELIEF/2 + a bit above every hollow —
   * visibly floating over ground it was supposed to be resting on — and the
   * hills it rolled through were not there at all.
   *
   * The terrain is an analytic function, so the exact ground height under any
   * point is one evaluation away. There is no reason to approximate it.
   */
  _collidePlanet() {
    const { pos, vel } = this;
    this.grounded = false;

    _rad.copy(pos).normalize();
    const minD = groundRadius(_rad) + BALL_R;
    const dist = pos.length();
    if (dist >= minD) return;

    // The real normal, not the radial one. Using radial on a slope is why a
    // marble would sit on a hillside instead of rolling off it.
    groundNormal(pos, _gn);
    this.groundN.copy(_gn);

    // Penetration is measured radially; push out along the normal. On slopes
    // this shallow the two differ by well under a percent.
    pos.addScaledVector(_gn, minD - dist);

    const vn = vel.dot(_gn);
    if (vn < 0) {
      // Only landings count, not the constant micro-contact of resting on the
      // ground. Below this the marble is simply in contact, not hitting.
      if (-vn > 2.5 && -vn > this.impact) this.impact = -vn;
      vel.addScaledVector(_gn, -vn * (1 + BOUNCE));
    }
    this.grounded = true;
    this.airborneFor = 0;
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
    const { vel } = this;
    // Spin about the contact normal while grounded, radial while airborne.
    _up.copy(this.grounded ? this.groundN : this.pos).normalize();
    _vt.copy(vel).addScaledVector(_up, -vel.dot(_up));
    const vtl = _vt.length();
    if (vtl <= 1e-4) return;
    _axis.crossVectors(_up, _vt).normalize();
    _q.setFromAxisAngle(_axis, -(vtl * dt) / BALL_R);
    this.mesh.quaternion.premultiply(_q);
  }

  /**
   * Copy simulation state onto the rig, and deform.
   *
   * Squash and stretch is the oldest trick in animation and it works because
   * a rigid sphere carries no information about the forces acting on it. Here
   * the marble stretches along its direction of travel through the air and
   * flattens against the ground on landing, springing back over about a fifth
   * of a second.
   *
   * @param {number} dt real elapsed seconds
   */
  sync(dt) {
    this.rig.position.copy(this.pos);

    // Orient the rig so its local Y is the surface normal. The deformation is
    // then always along and across the ground, whatever the marble is doing.
    _up.copy(this.grounded ? this.groundN : this.pos).normalize();
    _q.setFromUnitVectors(_Y, _up);
    this.rig.quaternion.copy(_q);

    // Airborne: stretch along the normal, proportional to vertical speed.
    // Grounded: relax to a sphere. The landing impulse is injected by impact().
    const vn = this.vel.dot(_up);
    const target = this.grounded ? 0 : THREE.MathUtils.clamp(vn * 0.014, -0.16, 0.16);

    // Critically damped enough to settle without wobbling like jelly, which
    // would read as rubber rather than as a heavy marble.
    const k = 1 - Math.exp(-14 * dt);
    this._squash += (target - this._squash) * k;

    const sy = 1 + this._squash;
    // Preserve volume: what it loses in height it gains around the equator.
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
    this.rig.scale.set(sxz, sy, sxz);
  }

  /** Kick the deformation on a hard landing. Called from the impact handler. */
  squashOnLanding(strength) {
    this._squash = Math.min(this._squash, -Math.min(0.3, strength * 0.022));
  }
}
