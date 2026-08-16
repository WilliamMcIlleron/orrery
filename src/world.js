import * as THREE from "three";
import { R, RELIEF, WORLD_SEED } from "./config.js";
import { mulberry32 } from "./rng.js";
import { terrain, surface } from "./geometry.js";

/**
 * Builds the planet, its furniture and its lighting into `scene`.
 *
 * Everything collidable is a capsule — a line segment plus a radius. A boulder
 * is a capsule whose segment has zero length, a monument is one standing on
 * end. One collision routine covers the whole world, which is the entire
 * reason this project does not need a physics engine.
 *
 * Returns live handles as well as data, because the dawn transition has to
 * drive these materials and lights every frame.
 */
export function buildWorld(scene, P, content) {
  const rand = mulberry32(WORLD_SEED);
  const capsules = [];
  const monuments = [];

  /* ---- lighting ---- */
  const sun = new THREE.DirectionalLight(P.sun, P.sunInt);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.near = 20;
  sc.far = 220;
  sc.left = -R * 1.5;
  sc.right = R * 1.5;
  sc.top = R * 1.5;
  sc.bottom = -R * 1.5;
  sun.shadow.bias = -0.0012;
  scene.add(sun);

  // The fill is doing real work, not mood. Without it the unlit hemisphere is
  // genuinely unusable, and "half the world is black" is a design failure
  // rather than atmosphere.
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiInt);
  scene.add(hemi);

  // A lamp riding with the marble. It exists only in palettes with a dark
  // half, and it fades out as dawn breaks because you stop needing it.
  let lamp = null;
  if (P.lamp) {
    lamp = new THREE.PointLight(P.lamp, P.lampInt, 26, 1.8);
    scene.add(lamp);
  }

  /* ---- stars ---- */
  let starMat = null;
  if (P.stars > 0) {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // acos of a uniform variable spreads points evenly over the sphere.
      // Uniform angles would crowd them at the poles.
      const t = Math.acos(2 * rand() - 1);
      const ph = rand() * Math.PI * 2;
      const d = 180 + rand() * 120;
      pos[i * 3] = d * Math.sin(t) * Math.cos(ph);
      pos[i * 3 + 1] = d * Math.cos(t);
      pos[i * 3 + 2] = d * Math.sin(t) * Math.sin(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starMat = new THREE.PointsMaterial({
      color: 0x8e97ab,
      size: 1.05,
      sizeAttenuation: false,
      transparent: true,
      opacity: P.stars,
    });
    scene.add(new THREE.Points(g, starMat));
  } else {
    // Burn the same draws so the rock scatter is identical across palettes.
    // Without this, switching palette silently rearranges the world.
    for (let i = 0; i < 2700; i++) rand();
  }

  /* ---- planet ---- */
  const planetGeo = new THREE.IcosahedronGeometry(R, 4);
  {
    const p = planetGeo.attributes.position;
    const shade = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    const k = P.reliefShade ?? 0.15;

    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const h = terrain(v.x, v.y, v.z);
      v.multiplyScalar(R + h * RELIEF);
      p.setXYZ(i, v.x, v.y, v.z);

      // Vertex tint by height: high ground catches light, hollows sit in
      // shadow. It multiplies the material colour, so the dawn transition can
      // still recolour the ground underneath it without touching this.
      //
      // This is what makes relief legible in palettes where the lighting alone
      // cannot do it. Riso is the extreme case — cream ground under a white
      // sun produces almost no shading variation, so the terrain vanishes and
      // you lose the ability to perceive your own speed, which is the entire
      // reason the relief exists.
      const s = 1 + h * k;
      shade[i * 3] = s;
      shade[i * 3 + 1] = s;
      shade[i * 3 + 2] = s;
    }
    planetGeo.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    planetGeo.computeVertexNormals();
  }
  const planetMat = new THREE.MeshStandardMaterial({
    color: P.ground,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    vertexColors: true,
  });
  const planet = new THREE.Mesh(planetGeo, planetMat);
  planet.receiveShadow = true;
  scene.add(planet);

  // A faint equator. Purely an orientation aid — rolling on a featureless
  // sphere gives you no sense of having gone anywhere.
  const bandMat = new THREE.MeshBasicMaterial({
    color: P.band,
    transparent: true,
    opacity: P.bandOp,
  });
  const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.45, 0.06, 6, 160), bandMat);
  band.rotation.x = Math.PI / 2;
  scene.add(band);

  /* ---- monuments ---- */
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const UP_Z = new THREE.Vector3(0, 0, 1);
  const monumentMat = new THREE.MeshStandardMaterial({
    color: P.monument,
    roughness: 0.7,
    metalness: 0.05,
  });

  content.forEach((item, i) => {
    const base = surface(item.lat, item.lon);
    const up = base.clone().normalize();
    const h = item.height;
    const top = base.clone().addScaledVector(up, h);
    const rad = 1.15;
    const colour = P.accents[i % P.accents.length];

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad, h, 18), monumentMat);
    pillar.position.copy(base).addScaledVector(up, h / 2);
    pillar.quaternion.setFromUnitVectors(UP_Y, up);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);

    // The collar is what you actually notice from across the planet. The
    // pillar is near-invisible at range; the ring of colour is the hook.
    const collarMat = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      // Starts dim. Lighting it is the whole interaction.
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(rad * 1.05, 0.16, 8, 28), collarMat);
    collar.position.copy(base).addScaledVector(up, h * 0.82);
    collar.quaternion.setFromUnitVectors(UP_Z, up);
    scene.add(collar);

    // A glow only pays for itself where there is dark to glow into.
    let glow = null;
    if (P.lamp) {
      glow = new THREE.PointLight(colour, 0, 18, 2);
      glow.position.copy(base).addScaledVector(up, h * 0.86);
      scene.add(glow);
    }

    capsules.push({ a: base.clone(), b: top.clone(), r: rad });
    monuments.push({
      label: item.label,
      blurb: item.blurb ?? "",
      href: item.href ?? null,
      base: base.clone(),
      pos: base.clone().addScaledVector(up, h * 0.9),
      colour,
      collarMat,
      glow,
      lit: false,
      // Drives the light-up animation, 0 to 1.
      t: 0,
    });
  });

  /* ---- boulders ---- */
  const rockMat = new THREE.MeshStandardMaterial({
    color: P.rock,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });

  /*
   * Rejection sampling rather than pure random placement.
   *
   * Uniform random on a sphere clumps — it looks like a mistake rather than
   * like scattered rocks, and it can drop a boulder on top of a monument or
   * wall one in. Rejecting candidates that land too close to anything already
   * placed costs a few hundred cheap distance checks and fixes both.
   */
  const placed = monuments.map((m) => ({ pos: m.base, clearance: 5.5 }));
  let attempts = 0;

  while (placed.length < monuments.length + 26 && attempts < 900) {
    attempts++;
    const lat = (rand() - 0.5) * 150;
    const lon = rand() * 360;
    const rad = 0.7 + rand() * 1.9;
    const c = surface(lat, lon).setLength(R + rad * 0.45);

    // Keep a gap of both radii plus a margin, so rocks read as separate
    // objects and there is always a way through between them.
    let ok = true;
    for (const q of placed) {
      if (c.distanceTo(q.pos) < q.clearance + rad + 1.2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), rockMat);
    m.position.copy(c);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    capsules.push({ a: c.clone(), b: c.clone(), r: rad });
    placed.push({ pos: c, clearance: rad });
  }

  return {
    capsules,
    monuments,
    lamp,
    handles: { sun, hemi, lamp, starMat, planetMat, rockMat, monumentMat, bandMat },
  };
}

/**
 * Push an interpolated palette state onto the live scene.
 *
 * Called every frame while dawn is in progress and once at startup. Cheap —
 * a handful of colour copies and scalar assignments.
 */
export function applyPaletteState(scene, renderer, handles, state) {
  scene.background.copy(state.bg);
  scene.fog.color.copy(state.bg);
  scene.fog.near = state.fogNear;
  scene.fog.far = state.fogFar;

  renderer.toneMappingExposure = state.exposure;

  handles.sun.color.copy(state.sun);
  handles.sun.intensity = state.sunInt;

  handles.hemi.color.copy(state.hemiSky);
  handles.hemi.groundColor.copy(state.hemiGround);
  handles.hemi.intensity = state.hemiInt;

  handles.planetMat.color.copy(state.ground);
  handles.rockMat.color.copy(state.rock);
  handles.monumentMat.color.copy(state.monument);
  handles.bandMat.color.copy(state.band);
  handles.bandMat.opacity = state.bandOp;

  if (handles.lamp) handles.lamp.intensity = state.lampInt;
  if (handles.starMat) handles.starMat.opacity = state.stars;
}
