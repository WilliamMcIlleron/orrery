import * as THREE from "three";
import {
  R_COL, BALL_R, GRAVITY, ACCEL, AIR_ACCEL,
  DRAG, ROLL_FRIC, BOUNCE, MAX_SPEED, VERT_MAX, JUMP_SPEED, COYOTE_TIME,
  FLOW_MIN, FLOW_RISE, FLOW_FALL, FLOW_BREAK, FLOW_GRIP, FLOW_DRAG,
} from "./config.js";
import { orthonormalise, closestOnSegment, groundRadius, groundNormal } from "./geometry.js";
import { addSurfaceNoise } from "./surface.js";

// Module-scope scratch vectors. Allocating inside the step would produce a few
// hundred short-lived Vector3s a second and hand the GC a reason to stutter.
const _up = new THREE.Vector3();

/** Magnitude of the component of `v` lying in the plane perpendicular to `up`. */
function groundSpeed(v, up) {
  const n = v.dot(up);
  return Math.sqrt(Math.max(0, v.lengthSq() - n * n));
}
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

    /**
     * The capsule that produced the impact in `impact`, or null for the ground.
     *
     * The world is made of different materials and they should not all sound
     * like a rock. Written wherever `impact` is written, for the same reason
     * `landed` is.
     */
    this.hitCapsule = null;

    /**
     * Whether the impact currently held in `impact` was a landing.
     *
     * Written only where `impact` is written, so it always describes the same
     * event. Reading it when `impact` is zero is meaningless.
     */
    this.landed = false;

    /** Set by the input layer; consumed on the next grounded step. */
    this.jumpQueued = false;

    /**
     * Flow, 0 to 1. The thing there is to lose — see config.js.
     *
     * Built by holding speed, spent by crashing. Read by the renderer to
     * brighten the lamp and by step() to lighten rolling resistance.
     */
    this.flow = 0;

    /** True for the one step in which a crash emptied the meter. */
    this.flowBroke = false;

    /**
     * Whether anything resolved against a steep face this step.
     *
     * Speed lost is not enough on its own to call something a crash: rolling
     * fast over ordinary relief loses plenty of it at the bottom of a dip, and
     * thresholding on that alone broke flow at random on open ground. What
     * separates a crash from terrain is *what you hit* — a floor's normal
     * points roughly the way you do, a wall's does not.
     */
    this._steepHit = false;
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
    this._steepHit = false;

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
    vel.multiplyScalar(1 - DRAG * (1 - FLOW_DRAG * this.flow) * dt);

    if (this.grounded) {
      // Rolling friction, applied only to the tangential component — measured
      // against the contact normal, so friction on a slope acts along the
      // slope rather than across it.
      //
      // Flow lightens it. Since MAX_SPEED is untouched this cannot make you
      // faster on the flat; what it does is let you keep the speed you have
      // through the climbs, turns and landings that would otherwise bleed it,
      // which is exactly what "flow" should mean.
      _vt.copy(vel).addScaledVector(this.groundN, -vel.dot(this.groundN));
      const grip = ROLL_FRIC * (1 - FLOW_GRIP * this.flow);
      vel.addScaledVector(_vt, -grip * dt * (input.x || input.y ? 0.35 : 1.0));
    }

    /*
     * Cap ground speed, not total speed.
     *
     * This clamped the magnitude of the whole velocity vector, and because
     * JUMP_SPEED is larger than MAX_SPEED on its own, *every* jump tripped it.
     * A uniform scale takes the horizontal component down with it, so pressing
     * jump while rolling worked as a brake: measured at 34% of your speed gone
     * from a standing jump and 46% at full roll.
     *
     * It throttled the impulse too, and harder the faster you were going — the
     * jump got lower the more speed you carried into it, which is backwards.
     *
     * Horizontal and vertical are different quantities and want different
     * rules. MAX_SPEED is a statement about how long the planet takes to
     * circle, so it belongs on the tangential component alone. Vertical is
     * gravity's business; VERT_MAX below exists only so nothing can reach a
     * speed that steps through the ground between frames.
     */
    _vt.copy(vel).addScaledVector(_up, -vel.dot(_up));
    const gs = _vt.length();
    if (gs > MAX_SPEED) vel.addScaledVector(_vt, MAX_SPEED / gs - 1);

    const vv = vel.dot(_up);
    if (vv > VERT_MAX) vel.addScaledVector(_up, VERT_MAX - vv);
    else if (vv < -VERT_MAX) vel.addScaledVector(_up, -VERT_MAX - vv);

    /*
     * Sampled here, not at the top of the step, so that the only thing between
     * this reading and the one after the collisions is the collision response
     * itself.
     *
     * Taken at the top it also spanned the jump, and a jump leaves along the
     * *surface* normal — which on a slope has a component in the plane this
     * measures, so a 16-unit impulse on a ten degree slope moved ground speed
     * by 2.8 and tripped a 3.0 crash threshold. Every jump broke flow.
     */
    const gsBefore = groundSpeed(vel, _up);

    pos.addScaledVector(vel, dt);

    this.airborneFor += dt;
    this._collidePlanet();
    this._collideCapsules(capsules);

    /*
     * Flow.
     *
     * Judged on ground speed lost in this one step rather than on impact
     * strength, because impact cannot tell a landing from a crash — landing
     * off a jump registers 15, harder than most wall hits, and thresholding on
     * it would break flow every time you used the jump the ridges exist to
     * reward. Ground speed is the honest measure: a landing barely touches it,
     * a wall destroys it.
     *
     * `flowBroke` latches rather than clearing here, the same way `jumped`
     * does, because several fixed steps run per rendered frame and a flag
     * cleared at the top of step() would be gone before anything could read
     * it.
     */
    const gsAfter = groundSpeed(vel, _up);
    if (gsBefore - gsAfter > FLOW_BREAK && this._steepHit) {
      if (this.flow > 0.05) this.flowBroke = true;
      this.flow = 0;
    } else if (gsAfter > MAX_SPEED * FLOW_MIN) {
      this.flow = Math.min(1, this.flow + dt / FLOW_RISE);
    } else {
      this.flow = Math.max(0, this.flow - dt / FLOW_FALL);
    }

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
      if (-vn > 2.5 && -vn > this.impact) {
        this.impact = -vn;
        // Was this a landing or just a knock? Set it here, next to the impact
        // it describes, so the two can never disagree. `airborneFor` has not
        // been zeroed yet at this point — that happens below.
        //
        // The threshold rejects the micro-hops of rolling fast over relief,
        // which are airborne in the strict sense and sound absurd with a
        // landing thump under them.
        this.landed = this.airborneFor > 0.12;
        this.hitCapsule = null;
      }
      // Under 0.8 is steeper than about thirty-seven degrees. Base relief
      // never approaches that; ridge flanks and rock faces are all past it.
      if (Math.abs(_gn.dot(_rad)) < 0.8) this._steepHit = true;
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
        // Capsules stand up out of the ground, so anything you hit hard enough
        // to matter you hit in the side. Same test as the terrain path.
        if (Math.abs(_n.dot(_rad.copy(pos).normalize())) < 0.8) this._steepHit = true;
        /*
         * Rocks get a lower threshold than the ground: hitting one is an
         * event, whereas resting on the ground is the default state. Worked
         * stone gets a lower one again, because an arch leg is half a unit
         * across and most contacts with one are glancing — at the boulder
         * threshold the arches were silent to touch and read as scenery.
         */
        const min = c.minImpact ?? 0.8;
        if (-vn > min && -vn > this.impact) {
          this.impact = -vn;
          // A rock is never a landing, and capsules resolve after the ground
          // in the same step. Without this, hitting a boulder on the way down
          // would inherit the landing flag the ground just set.
          this.landed = false;
          this.hitCapsule = c;
        }
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
    // 0.022 dated from when falls were clamped to 13 and the hardest landing
    // available sat just under the 0.3 ceiling. Real fall speeds now run to
    // 27.6, which pinned every landing at maximum squash and threw away the
    // difference between a hop and a drop. 0.011 spreads the range back out:
    // a routine jump lands at 0.17, a long fall still reaches the ceiling.
    this._squash = Math.min(this._squash, -Math.min(0.3, strength * 0.011));
  }
}
