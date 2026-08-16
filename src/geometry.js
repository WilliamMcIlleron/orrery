import * as THREE from "three";
import { R, RELIEF } from "./config.js";

/**
 * Terrain height at a point on the unit sphere, in the range about -1 to 1.
 *
 * A sum of sines, not real noise. It is cheap, it is smooth, it is seamless on
 * a sphere by construction — no wrapping seam to hide — and it costs no
 * dependency. Swap in simplex noise if the shapes ever start to look
 * repetitive; nothing else needs to change.
 */
export function terrain(nx, ny, nz) {
  return (
    Math.sin(nx * 3.1 + 1.7) * Math.sin(ny * 2.7 + 0.4) * Math.sin(nz * 3.3 + 2.1) * 0.7 +
    Math.sin(nx * 7.3) * Math.sin(ny * 6.1) * Math.sin(nz * 7.7) * 0.3
  );
}

/**
 * A point on the displaced surface, from latitude and longitude in degrees.
 *
 * Returns the displaced position rather than the ideal sphere, or everything
 * placed with it floats above dips and sinks into rises.
 */
export function surface(latDeg, lonDeg) {
  const la = THREE.MathUtils.degToRad(latDeg);
  const lo = THREE.MathUtils.degToRad(lonDeg);
  const n = new THREE.Vector3(
    Math.cos(la) * Math.cos(lo),
    Math.sin(la),
    Math.cos(la) * Math.sin(lo),
  );
  return n.multiplyScalar(R + terrain(n.x, n.y, n.z) * RELIEF);
}

/**
 * Distance from the planet's centre to the displaced ground beneath `n`.
 *
 * @param {THREE.Vector3} n unit vector
 */
export function groundRadius(n) {
  return R + terrain(n.x, n.y, n.z) * RELIEF;
}

const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _AXIS = new THREE.Vector3(0, 1, 0);
const _AXIS2 = new THREE.Vector3(1, 0, 0);

function displaced(n, out) {
  return out.copy(n).multiplyScalar(groundRadius(n));
}

/**
 * True surface normal of the displaced terrain under `pos`.
 *
 * The radial direction is *not* the normal once the ground has slopes, and
 * using it anyway is why a marble on a hillside sits there instead of rolling
 * off it. Three samples of the surface and one cross product gives the real
 * one, for the cost of a handful of sines.
 *
 * Writes into `out` and returns it.
 */
export function groundNormal(pos, out) {
  _n.copy(pos).normalize();

  // Any two tangents will do. Pick the cross partner that is furthest from
  // parallel so the basis never collapses at the poles.
  const axis = Math.abs(_n.y) > 0.9 ? _AXIS2 : _AXIS;
  _t1.crossVectors(_n, axis).normalize();
  _t2.crossVectors(_n, _t1).normalize();

  // ~0.9 units of arc at R=30. Small enough to be local, large enough that
  // float error in the sine sum does not dominate the difference.
  const eps = 0.03;
  displaced(_n, _p0);
  displaced(_e1.copy(_n).addScaledVector(_t1, eps).normalize(), _p1);
  displaced(_e2.copy(_n).addScaledVector(_t2, eps).normalize(), _p2);

  _e1.subVectors(_p1, _p0);
  _e2.subVectors(_p2, _p0);
  out.crossVectors(_e1, _e2).normalize();

  // Winding depends on the tangent basis, so make it point outward.
  if (out.dot(_n) < 0) out.negate();
  return out;
}

/**
 * Project `v` onto the tangent plane at `up` and normalise it.
 *
 * This is the load-bearing function of the whole camera. "Up" changes
 * continuously as you roll around a sphere, so any direction vector you are
 * holding onto stops being tangent almost immediately. Re-orthogonalising it
 * every frame is what stops the camera drifting and slowly rolling on its own.
 *
 * Mutates and returns `v`.
 */
export function orthonormalise(v, up) {
  v.addScaledVector(up, -v.dot(up));
  if (v.lengthSq() < 1e-8) {
    // Degenerate: `v` was parallel to `up`. Any tangent will do.
    v.set(1, 0, 0).addScaledVector(up, -up.x);
    if (v.lengthSq() < 1e-8) v.set(0, 0, 1).addScaledVector(up, -up.z);
  }
  return v.normalize();
}

const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();

/** Closest point to `p` on the segment ab. Writes into `out` and returns it. */
export function closestOnSegment(a, b, p, out) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  if (len2 < 1e-9) return out.copy(a);
  let t = _rel.subVectors(p, a).dot(_seg) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out.copy(a).addScaledVector(_seg, t);
}
