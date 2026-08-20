import * as THREE from "three";
import { mulberry32 } from "./rng.js";
import { SUN_DIR } from "./config.js";

/**
 * The rest of the system.
 *
 * The piece is called orrery and until now nothing in it was in orbit around
 * anything. There was one planet, and above it an empty sky — which is also
 * why so many frames were half ground and half nothing: the chase camera sits
 * low, the horizon lands near the middle, and the upper half had no subject.
 *
 * Two bodies fix both at once. They are fixed in world space, not attached to
 * the camera, so rolling around the planet makes them rise and set. That turns
 * them into the one navigation cue the piece was missing: you cannot see the
 * monument you are heading for, but you can see that the moon is off your left
 * shoulder and it was off your right one when you started.
 *
 * They are lit by the same directional sun as the ground, so the moon carries
 * the same phase as the planet's own terminator — a crescent when you are near
 * dawn, full when the sun is behind you. Nothing computes that; it falls out of
 * using one light for the whole scene, and it is the kind of coherence that is
 * only expensive if you fake it.
 *
 * Both have `fog: false`. Fog fades toward the background colour by 150 to 210
 * units and these sit at 240 and 330, so without it they would be painted out
 * completely.
 */

/**
 * Distance, radius, and how lit each body should look.
 *
 * `phase` is the angle at the body between the sun and the planet. Zero puts
 * the body opposite the sun and fully lit, which is flat and has no modelling
 * in it; 180 puts it in front of the sun and entirely dark. The interesting
 * range is 45 to 75, where you get a fat crescent with a visible terminator
 * running across a cratered surface.
 *
 * The first pass placed these by eye and the moon came out 41% lit, which is
 * a dark disc against a dark sky — technically a correct crescent, visually a
 * hole. Placing by phase makes the lighting a decision instead of a leftover.
 *
 * `spin` rotates the body around the sun's axis, which changes where in the
 * sky it sits without changing how lit it is.
 */
const MOON = { dist: 240, radius: 16, phase: 58, spin: 118 };
const COMPANION = { dist: 340, radius: 34, phase: 72, spin: 285 };

const _sun = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();

/**
 * A direction that puts a body at a given phase angle from the planet.
 *
 * Everything on the planet is within 34 units of its centre and these bodies
 * are 240 and 340 away, so the phase is the same wherever you are standing.
 * That is what lets it be a placement decision at build time rather than
 * something to recompute.
 */
function directionForPhase(phaseDeg, spinDeg) {
  // Any unit vector perpendicular to the sun will do as the zero of the spin,
  // as long as it is the same one every time.
  const perp = new THREE.Vector3(0, 1, 0).cross(_sun).normalize();
  const perp2 = new THREE.Vector3().crossVectors(perp, _sun).normalize();
  const a = THREE.MathUtils.degToRad(180 - phaseDeg);
  const s = THREE.MathUtils.degToRad(spinDeg);
  const off = perp.clone().multiplyScalar(Math.cos(s)).addScaledVector(perp2, Math.sin(s));
  return _sun.clone().multiplyScalar(Math.cos(a)).addScaledVector(off, Math.sin(a)).normalize();
}

/**
 * Punch craters into an icosphere by pulling vertices in toward the centre.
 *
 * The geometry is non-indexed, so the same corner appears once per triangle
 * touching it. Keying the displacement on the vertex's own direction rather
 * than its index is what keeps those copies in agreement — do it per index and
 * the shell splits open along every shared edge.
 */
function crater(geo, seed, count, depth) {
  const rand = mulberry32(seed);
  const centres = [];
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: acos of a uniform gives equal-area bands, where
    // a uniform latitude would crowd the poles.
    const z = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    centres.push({
      n: new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), z),
      size: 0.18 + rand() * 0.3,
    });
  }

  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    v.divideScalar(len);
    let drop = 0;
    for (const c of centres) {
      // Angular distance, so a crater is round on the sphere rather than round
      // in the projection.
      const d = Math.acos(Math.min(1, Math.max(-1, v.dot(c.n))));
      if (d < c.size) {
        const k = 1 - d / c.size;
        // Squared, so the floor is flat-ish and the wall is steep. Linear
        // gives a cone, which reads as a dent rather than as a crater.
        drop = Math.max(drop, k * k);
      }
    }
    v.multiplyScalar(len * (1 - drop * depth));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/**
 * Build the moon and the ringed companion.
 *
 * @param {THREE.Scene} scene
 * @param {object} P palette
 * @returns {{moonMat, bodyMat, ringMat, group}} handles for the palette to drive
 */
export function createSky(scene, P) {
  const group = new THREE.Group();

  /* ---- the moon ---- */
  const moonGeo = new THREE.IcosahedronGeometry(MOON.radius, 3);
  crater(moonGeo, 20260820, 9, 0.055);
  const moonMat = new THREE.MeshStandardMaterial({
    color: P.moon ?? 0xbfc4cc,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
    fog: false,
    // A trace of self-illumination so the unlit limb is a shape against the
    // sky rather than a hole cut in it. Six percent: enough to separate, far
    // too little to read as glowing.
    emissive: new THREE.Color(P.moon ?? 0xbfc4cc).multiplyScalar(0.06),
  });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.copy(directionForPhase(MOON.phase, MOON.spin)).multiplyScalar(MOON.dist);
  group.add(moon);

  /* ---- the ringed companion ---- */
  const bodyGeo = new THREE.IcosahedronGeometry(COMPANION.radius, 3);
  crater(bodyGeo, 77712, 5, 0.02);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: P.companion ?? 0x6d7a94,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
    fog: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.copy(directionForPhase(COMPANION.phase, COMPANION.spin)).multiplyScalar(COMPANION.dist);

  /*
   * The ring, as a flat annulus rather than a torus.
   *
   * A torus is a tube and reads as a hoop around the planet — a curtain rail,
   * not a ring system. What makes a ring system read is that it is *flat*:
   * paper thin, so it vanishes to a line when you see it edge on and opens to
   * an ellipse when you do not. RingGeometry is exactly that and costs sixty
   * triangles.
   */
  const ringMat = new THREE.MeshBasicMaterial({
    color: P.ring ?? 0x9aa6bd,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(COMPANION.radius * 1.45, COMPANION.radius * 2.25, 64, 1),
    ringMat,
  );
  // Tilted well off the plane it would otherwise share with the viewer, or it
  // is edge on and invisible from the one place anybody stands.
  ring.rotation.set(Math.PI * 0.42, 0.35, 0.6);
  body.add(ring);

  group.add(body);
  scene.add(group);

  return { moonMat, bodyMat, ringMat, group };
}
