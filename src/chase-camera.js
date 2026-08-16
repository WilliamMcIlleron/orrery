import * as THREE from "three";
import { CAM_BACK, CAM_UP, CAM_LAG, HEAD_LAG, MAX_SPEED, FOV_BASE, FOV_KICK } from "./config.js";
import { orthonormalise } from "./geometry.js";

const _up = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _want = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();

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
    this.forward = new THREE.Vector3(0, 0, -1);
    this.position = new THREE.Vector3();
    this._initialised = false;
    this._fov = FOV_BASE;
  }

  /**
   * @param {THREE.Vector3} pos  marble position
   * @param {THREE.Vector3} vel  marble velocity
   * @param {number} dt          real elapsed seconds, not the fixed step
   * @param {number} speed        current speed, for the fov kick
   */
  update(pos, vel, dt, speed = 0) {
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

    _target
      .copy(pos)
      .addScaledVector(_up, CAM_UP + kick * 0.7)
      .addScaledVector(this.forward, -(CAM_BACK + kick * 1.6));

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
