import * as THREE from "three";
import { CAM_BACK, CAM_UP, CAM_LAG, HEAD_LAG, MAX_SPEED, FOV_BASE, FOV_KICK } from "./config.js";
import { orthonormalise, groundRadius } from "./geometry.js";

const _up = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _want = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _right = new THREE.Vector3();
const _offset = new THREE.Vector3();

/*
 * How far the free look can go.
 *
 * Yaw is unbounded — you can turn all the way round and look back at where you
 * came from, which on a planet you loop in fourteen seconds is a thing worth
 * being able to do.
 *
 * Pitch is not. Up is the surface normal, and lookAt has no answer when the
 * view direction lines up with it, so the top stop is short of vertical. The
 * bottom stop is much tighter because there is nothing under the marble but
 * ground and the camera would push through it.
 */
const PITCH_MAX = 1.15;
/*
 * Negative pitch drops the camera and tilts the view up. The first pass
 * stopped at -0.42, which is 24 degrees, and that is not enough: the moon sits
 * between 12 and 56 degrees above the horizon depending on where you are
 * standing, and being unable to look at it makes the sky decorative. -0.8
 * reaches it. What stops the camera going through the ground is the clearance
 * check below, not this number.
 */
const PITCH_MIN = -0.8;

/** Never let the camera get closer to the ground than this. */
const CAM_CLEARANCE = 1.1;

/**
 * How fast the view returns to behind the marble, per second, at full speed.
 *
 * Scaled by speed, so standing still it never recentres at all — look wherever
 * you like for as long as you like. It is only once you are actually going
 * somewhere that having the camera behind you starts to matter more than where
 * you were pointing it.
 */
const RECENTRE = 1.6;

/**
 * A chase camera that stays upright on a curving surface.
 *
 * This was the one genuinely hard part of the project. On flat ground a chase
 * camera is a fixed offset and a lookAt. On a sphere, "up" is different at
 * every point, so three things have to happen every frame:
 *
 *   1. `forward` is re-projected onto the tangent plane, or it slowly tips
 *      into the ground and takes the horizon with it.
 *   2. `camera.up` is set to the local surface normal, or the world appears
 *      to roll as you travel.
 *   3. Both the heading and the position are smoothed exponentially rather
 *      than by a fixed fraction, so the feel does not change with framerate.
 *
 * Miss any one and it looks broken in a way that is hard to name.
 */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    /** The heading the chase follows: the marble's direction of travel. */
    this.forward = new THREE.Vector3(0, 0, -1);
    /**
     * Where the camera is actually looking, once free look is applied.
     *
     * Steering reads this rather than `forward`, or the controls would answer
     * to a heading that is not on screen: you look left, push forward, and the
     * marble sets off in the direction the camera used to be facing.
     */
    this.viewForward = new THREE.Vector3(0, 0, -1);
    this.position = new THREE.Vector3();
    /** Free-look offsets from the chase heading, in radians. */
    this.yaw = 0;
    this.pitch = 0;
    this._initialised = false;
    this._fov = FOV_BASE;
  }

  /**
   * Push the view around without touching the marble.
   *
   * @param {number} dyaw   radians, positive turns right
   * @param {number} dpitch radians, positive raises the camera
   */
  look(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, PITCH_MIN, PITCH_MAX);
  }

  /**
   * @param {THREE.Vector3} pos  marble position
   * @param {THREE.Vector3} vel  marble velocity
   * @param {number} dt          real elapsed seconds, not the fixed step
   * @param {number} speed        current speed, for the fov kick
   */
  update(pos, vel, dt, speed = 0, holdView = false) {
    _up.copy(pos).normalize();

    // Swing the heading toward the direction of travel, but only once moving
    // fast enough that the direction means something. Below that the marble
    // is jittering and the camera would spin looking for a heading.
    _vt.copy(vel).addScaledVector(_up, -vel.dot(_up));
    if (_vt.lengthSq() > 0.9) {
      _want.copy(_vt).normalize();
      this.forward.lerp(_want, 1 - Math.exp(-HEAD_LAG * dt));
    }
    orthonormalise(this.forward, _up);

    /*
     * Ease the free look back out, in proportion to how fast you are going.
     *
     * At a standstill this does nothing and the view stays exactly where you
     * put it. Moving, it unwinds — because the camera being behind you is what
     * makes the controls legible, and a player who looked over their shoulder
     * and then set off should not have to put it back by hand.
     *
     * `holdView` suspends it while the player is actually looking, and for a
     * moment after. Without that, looking at speed is a fight the player
     * cannot win: the unwind removes the rotation as fast as the drag applies
     * it, and a gesture worth sixty degrees measured out at eight.
     */
    if (!holdView) {
      const back = 1 - Math.exp(-RECENTRE * Math.min(1, speed / MAX_SPEED) * dt);
      this.yaw -= this.yaw * back;
      this.pitch -= this.pitch * back;
    }

    // The heading the camera actually uses: the chase heading, turned by yaw.
    this.viewForward.copy(this.forward).applyAxisAngle(_up, this.yaw);
    orthonormalise(this.viewForward, _up);

    /*
     * Speed does two things to the camera, and neither is the marble moving
     * faster on screen.
     *
     * The field of view widens, which stretches the periphery and reads as
     * acceleration — the effect every racing game uses and almost no one
     * consciously notices. And the camera drops back, so the marble shrinks
     * slightly and more of what is coming fits in frame.
     *
     * Both are squared, so they stay out of the way at a stroll and only
     * arrive when you are genuinely moving. Both are smoothed frame-rate
     * independently, because a fov that snaps is nauseating.
     */
    const sp = Math.min(1, speed / MAX_SPEED);
    const kick = sp * sp;
    const wantFov = FOV_BASE + kick * FOV_KICK;
    this._fov += (wantFov - this._fov) * (1 - Math.exp(-3.2 * dt));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }

    /*
     * The camera offset, pitched around the view's own right axis.
     *
     * Building it as a vector and rotating it — rather than adding a height
     * and a distance separately — is what keeps the marble the same size in
     * frame as you swing the view up and over it. Otherwise raising the camera
     * also walks it away, and the ball shrinks as you look down at it.
     */
    _right.crossVectors(this.viewForward, _up).normalize();
    _offset
      .copy(this.viewForward).multiplyScalar(-(CAM_BACK + kick * 1.6))
      .addScaledVector(_up, CAM_UP + kick * 0.7);
    if (this.pitch !== 0) _offset.applyAxisAngle(_right, this.pitch);

    _target.copy(pos).add(_offset);

    /*
     * Keep the camera out of the ground.
     *
     * Free look can point the offset straight at the terrain, and on a
     * displaced surface the camera does not have to be below the marble to be
     * inside a hill. The ground height is an analytic function, so the honest
     * answer costs one evaluation: find the ground under wherever the camera
     * wants to be and push it back out along its own radius if it is short.
     *
     * Pushing radially rather than along the view keeps the framing — the
     * camera rises out of the slope instead of sliding backwards away from
     * the marble.
     */
    {
      _look.copy(_target).normalize();
      const floor = groundRadius(_look) + CAM_CLEARANCE;
      if (_target.length() < floor) _target.copy(_look).multiplyScalar(floor);
    }

    if (!this._initialised) {
      this.position.copy(_target);
      this._initialised = true;
    } else {
      // 1 - e^(-k*dt) is frame-rate independent. A plain lerp with a constant
      // factor would make the camera lag differently at 60fps and 120fps.
      this.position.lerp(_target, 1 - Math.exp(-CAM_LAG * dt));
    }

    this.camera.position.copy(this.position);
    this.camera.up.copy(_up);
    // Aim slightly above the marble so it sits low in frame and you can see
    // where you are going rather than what you have already rolled over.
    this.camera.lookAt(_look.copy(pos).addScaledVector(_up, 0.9));
  }
}
