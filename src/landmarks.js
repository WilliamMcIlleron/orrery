import * as THREE from "three";
import { R, RELIEF } from "./config.js";
import { surface, groundRadius } from "./geometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeBloomable } from "./postfx.js";

/**
 * The things on the ground that are not monuments.
 *
 * The world used to be four pillars and twenty-six boulders, and the boulders
 * were the same icosahedron twenty-six times at different scales and
 * rotations. Rolling between monuments was traversal rather than exploration,
 * because there was nothing to arrive at on the way.
 *
 * Everything here is placed by the same rejection sampler as the boulders and
 * registers capsule colliders, which means the marble bumps into it and the
 * ambient-occlusion bake welds it to the ground with no extra work. A capsule
 * is a segment plus a radius, so an arch is eight of them along a curve and a
 * standing stone is one on end — the whole collision system already covers
 * every shape added here, and that is the payoff for having written it that
 * way in the first place.
 */

const UP_Y = new THREE.Vector3(0, 1, 0);

/*
 * Every landmark is one draw call, not one per piece.
 *
 * A stone circle is nine uprights and an arch is fourteen blocks, and at two
 * circles, three arches and six crystal clusters that is a hundred and thirty
 * meshes. Each of them is drawn three times a frame — once for the scene, once
 * into the shadow map, once into the bloom pass — so the naive version cost
 * about three hundred and fifty draw calls to render eleven objects.
 *
 * They never move relative to each other, so there is no reason for them to be
 * separate. Baking each piece's transform into its vertices and merging brings
 * a whole landmark down to one geometry and one call.
 */
function bakeInto(list, geo, position, quaternion) {
  const m = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  list.push(geo.applyMatrix4(m));
}

/** Merge the baked pieces and add them as a single mesh. */
function addMerged(scene, parts, mat, { bloom = false } = {}) {
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (bloom) makeBloomable(mesh);
  scene.add(mesh);
  for (const p of parts) if (p !== geo) p.dispose?.();
  return mesh;
}

/** Places a point on the displaced ground under a unit direction. */
function onGround(dir, lift = 0) {
  return dir.clone().multiplyScalar(groundRadius(dir) + lift);
}

/**
 * A boulder that is not the same boulder as the last one.
 *
 * An icosphere scaled up and down is recognisably one rock repeated, and at
 * twenty-six copies the eye picks it up immediately. Displacing each vertex
 * along its own direction by a hash of that direction gives every rock its own
 * lumps for the cost of one pass over the buffer.
 *
 * Keyed on direction rather than index for the same reason the moon's craters
 * are: PolyhedronGeometry is non-indexed, so each shared corner exists once per
 * touching triangle, and moving those copies independently tears the mesh
 * apart along every edge.
 *
 * @returns {{geometry: THREE.BufferGeometry, radius: number}} radius is the
 *   furthest any vertex ended up, so the collider can be sized not to let the
 *   marble sink into a lump that stuck out.
 */
export function makeBoulder(rad, rand) {
  const geo = new THREE.IcosahedronGeometry(rad, 1);
  const seed = rand() * 1000;
  // Three axes of non-uniform squash, so some are slabs and some are cobbles.
  const sx = 0.78 + rand() * 0.5;
  const sy = 0.6 + rand() * 0.55;
  const sz = 0.78 + rand() * 0.5;

  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    // A cheap deterministic hash of the direction. Not good noise; it does not
    // have to be, because there are only forty-two vertices on the whole rock
    // and what is wanted is that they disagree with each other.
    const h = Math.sin(n.x * 12.9898 + n.y * 78.233 + n.z * 37.719 + seed) * 43758.5453;
    const jitter = 0.82 + (h - Math.floor(h)) * 0.34;
    v.multiplyScalar(jitter);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
    maxR = Math.max(maxR, v.length());
  }
  geo.computeVertexNormals();
  return { geometry: geo, radius: maxR };
}

/**
 * A ring of standing stones.
 *
 * The single most useful thing to add to a landscape you can walk across is
 * evidence that somebody was here before you. Boulders are weather; a circle is
 * intent, and the piece already has four monuments to imply whoever built it.
 *
 * The stones lean outward slightly and vary in height, because a ring of
 * identical uprights at identical angles reads as a fence.
 */
function stoneCircle(scene, mat, dir, rand, capsules, out) {
  const centre = onGround(dir);
  const up = dir.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const count = 7 + Math.floor(rand() * 3);
  const ringR = 3.6 + rand() * 1.4;
  const parts = [];

  for (let i = 0; i < count; i++) {
    // A little angular jitter, or the ring reads as machined.
    const a = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const at = east.clone().multiplyScalar(Math.cos(a) * ringR)
      .addScaledVector(north, Math.sin(a) * ringR)
      .add(centre);
    const nd = at.clone().normalize();
    const foot = onGround(nd, -0.4);
    const h = 1.9 + rand() * 1.7;
    const w = 0.34 + rand() * 0.22;

    // A five-sided tapered column, not a box. A box seen from the side is a
    // rectangle from every angle, and against a bright horizon a ring of them
    // reads as cardboard standing on edge. Five faces give the silhouette a
    // corner to catch light on and cost nothing.
    const g = new THREE.CylinderGeometry(w * 0.66, w * 0.95, h, 5, 1);
    g.scale(1.5, 1, 0.85);
    const lean = nd.clone()
      .addScaledVector(at.clone().sub(centre).normalize(), 0.12 + rand() * 0.1)
      .normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP_Y, lean)
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP_Y, a + Math.PI / 2));
    bakeInto(parts, g, foot.clone().addScaledVector(lean, h * 0.5), q);

    capsules.push({
      a: foot.clone(),
      b: foot.clone().addScaledVector(lean, h),
      r: w * 1.1,
      kind: "stone",
    });
  }
  addMerged(scene, parts, mat);
  out.push({ pos: centre, clearance: ringR + 2.4 });
}

/**
 * An arch.
 *
 * Worth having because it is the only thing in the world you can go *through*
 * rather than around, and because a curve on the skyline is legible from much
 * further away than a lump is. Built as a strip of segments following a
 * half-circle, each one collidable, so rolling under it works without a single
 * line of special-case code.
 */
function arch(scene, mat, dir, rand, capsules, out) {
  const centre = onGround(dir);
  const up = dir.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  // A random heading, so arches on the same planet do not all face one way.
  const spin = rand() * Math.PI;
  const across = east.clone().multiplyScalar(Math.cos(spin)).addScaledVector(north, Math.sin(spin));

  const span = 4.2 + rand() * 2.2;
  const rise = span * (0.95 + rand() * 0.3);
  const thick = 0.42 + rand() * 0.2;
  // Enough segments that the steps between them read as courses of masonry
  // rather than as a polygon count.
  const SEGS = 14;

  const parts = [];
  const pts = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = (i / SEGS) * Math.PI;
    pts.push(centre.clone()
      .addScaledVector(across, Math.cos(t) * span)
      .addScaledVector(up, Math.sin(t) * rise - 0.5));
  }

  for (let i = 0; i < SEGS; i++) {
    const a = pts[i], b = pts[i + 1];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    // Thinner toward the crown, the way an arch that has to carry its own
    // weight actually is. A constant section reads as bent pipe.
    const taper = 1 - 0.28 * Math.sin((i + 0.5) / SEGS * Math.PI);
    // Barely overlong: enough to close the gap on the outside of the curve
    // where consecutive blocks fan apart, not enough for corners to poke out.
    bakeInto(
      parts,
      new THREE.BoxGeometry(thick * 2 * taper, len * 1.06, thick * 2 * taper),
      mid,
      new THREE.Quaternion().setFromUnitVectors(UP_Y, b.clone().sub(a).normalize()),
    );
    capsules.push({ a: a.clone(), b: b.clone(), r: thick, kind: "stone" });
  }
  addMerged(scene, parts, mat);
  out.push({ pos: centre, clearance: span + 2.2 });
}

/**
 * A cluster of crystals.
 *
 * Colour, and in the dark palettes a point of light that is not a monument.
 * They are faintly emissive and on the bloom layer, which in Deep field and
 * Dusk makes them read at a distance across the unlit hemisphere — small
 * enough not to be mistaken for a monument beam, bright enough to be worth
 * rolling over to.
 *
 * Octahedra, stretched. It is the one primitive that already looks like a
 * mineral rather than like a primitive.
 */
function crystals(scene, mat, dir, rand, capsules, out, clusters) {
  // One material per cluster rather than one for all of them, so a cluster can
  // ring on its own. Six clones of a standard material is nothing, and the
  // alternative is that striking one lights every crystal on the planet.
  const own = mat.clone();
  const index = clusters.length;
  clusters.push({ mat: own, base: own.emissiveIntensity ?? 1, pulse: 0 });

  const centre = onGround(dir, -0.3);
  const up = dir.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const count = 3 + Math.floor(rand() * 4);
  const parts = [];
  let widest = 0;

  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const off = 0.2 + rand() * 1.5;
    const foot = centre.clone()
      .addScaledVector(east, Math.cos(a) * off)
      .addScaledVector(north, Math.sin(a) * off);
    const h = 1.1 + rand() * 2.2;
    const w = 0.26 + rand() * 0.24;

    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(w, h, w);
    // Splayed off vertical, the way a real cluster grows. All upright is a
    // row of spikes.
    const tilt = up.clone()
      .addScaledVector(east, (rand() - 0.5) * 0.7)
      .addScaledVector(north, (rand() - 0.5) * 0.7)
      .normalize();
    bakeInto(
      parts,
      g,
      foot.clone().addScaledVector(tilt, h * 0.55),
      new THREE.Quaternion().setFromUnitVectors(UP_Y, tilt),
    );

    capsules.push({
      a: foot.clone(),
      b: foot.clone().addScaledVector(tilt, h * 0.9),
      r: w * 1.15,
      kind: "crystal",
      cluster: index,
    });
    widest = Math.max(widest, off + w);
  }
  addMerged(scene, parts, own, { bloom: true });
  out.push({ pos: centre, clearance: widest + 2.0 });
}

/**
 * Scatter the landmarks across the planet.
 *
 * Uses the same reject-if-too-close list the boulders use, so nothing lands on
 * a monument or inside another landmark, and the sampler stays the single
 * authority on what is where.
 *
 * @param {object} opts.counts how many of each to attempt
 * @param {Array} opts.placed  the shared occupancy list, mutated
 */
export function scatterLandmarks(scene, mats, rand, capsules, placed, counts) {
  /** One entry per crystal cluster, for the ring-when-struck pulse. */
  const clusters = [];
  const kinds = [
    ["circle", stoneCircle, mats.stone, 7.5],
    ["arch", arch, mats.stone, 7.0],
    ["crystal", crystals, mats.crystal, 4.0],
  ];

  for (const [name, build, mat, need] of kinds) {
    let made = 0;
    let attempts = 0;
    while (made < (counts[name] ?? 0) && attempts < 400) {
      attempts++;
      const lat = (rand() - 0.5) * 150;
      const lon = rand() * 360;
      const dir = surface(lat, lon).normalize();
      const c = dir.clone().multiplyScalar(R);

      let ok = true;
      for (const q of placed) {
        if (c.distanceTo(q.pos) < q.clearance + need) { ok = false; break; }
      }
      if (!ok) continue;

      build(scene, mat, dir, rand, capsules, placed, clusters);
      made++;
    }
  }
  return clusters;
}

/**
 * Decay the ring-glow on every crystal cluster.
 *
 * Exponential rather than linear: a crystal that has just been struck should
 * fall off fast and then linger, which is what a struck thing does.
 *
 * @param {Array} clusters from scatterLandmarks
 * @param {number} dt real seconds
 */
/*
 * How far a struck cluster overshoots its resting glow.
 *
 * Held at the peak for a screenshot, 5.5 read as an explosion rather than as a
 * ring. It only ever lasts about a third of a second in play, but the bloom
 * pass amplifies it and the flare filled the frame. 3.5 still flares.
 */
const PULSE_GAIN = 3.5;

export function fadeClusters(clusters, dt) {
  const k = Math.exp(-3.4 * dt);
  for (const c of clusters) {
    if (c.pulse <= 0.001) continue;
    c.pulse *= k;
    c.mat.emissiveIntensity = c.base * (1 + c.pulse * PULSE_GAIN);
  }
}

/** Light a cluster up. Called when the marble hits one. */
export function ringCluster(clusters, index, strength) {
  const c = clusters[index];
  if (!c) return;
  c.pulse = Math.min(1, Math.max(c.pulse, strength / 7));
  c.mat.emissiveIntensity = c.base * (1 + c.pulse * PULSE_GAIN);
}

/** Kept so the caller does not have to reach into config for the relief. */
export const GROUND_LIFT = RELIEF;
