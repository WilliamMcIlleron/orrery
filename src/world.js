import * as THREE from "three";
import { R, RELIEF, WORLD_SEED } from "./config.js";
import { mulberry32 } from "./rng.js";
import { terrain, surface } from "./geometry.js";

/**
 * Builds the planet, its furniture and its lighting into `scene`.
 *
 * Everything collidable is a capsule — a segment plus a radius. A boulder is a
 * capsule whose segment has zero length, a monument is one standing on end.
 * One collision routine covers both, which is the entire reason this project
 * does not need a physics engine yet.
 *
 * @returns {{capsules: Array, monuments: Array, lamp: THREE.PointLight|null}}
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
  scene.add(new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiInt));

  // A lamp riding with the marble. It only exists in palettes that have a dark
  // half — in a daylit world it has nothing to do. It is what makes the night
  // side somewhere to go rather than something to endure.
  let lamp = null;
  if (P.lamp) {
    lamp = new THREE.PointLight(P.lamp, 26, 26, 1.8);
    scene.add(lamp);
  }

  /* ---- stars ---- */
  if (P.stars > 0) {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // acos of a uniform variable gives an even spread over the sphere.
      // Uniform angles would crowd the poles.
      const t = Math.acos(2 * rand() - 1);
      const ph = rand() * Math.PI * 2;
      const d = 180 + rand() * 120;
      pos[i * 3] = d * Math.sin(t) * Math.cos(ph);
      pos[i * 3 + 1] = d * Math.cos(t);
      pos[i * 3 + 2] = d * Math.sin(t) * Math.sin(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x8e97ab,
          size: 1.05,
          sizeAttenuation: false,
          transparent: true,
          opacity: P.stars,
        }),
      ),
    );
  } else {
    // Burn the same draws so the rock scatter is identical across palettes.
    // Without this, switching palette silently rearranges the world.
    for (let i = 0; i < 2700; i++) rand();
  }

  /* ---- planet ---- */
  const planetGeo = new THREE.IcosahedronGeometry(R, 4);
  {
    const p = planetGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      v.multiplyScalar(R + terrain(v.x, v.y, v.z) * RELIEF);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    planetGeo.computeVertexNormals();
  }
  const planet = new THREE.Mesh(
    planetGeo,
    new THREE.MeshStandardMaterial({
      color: P.ground,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    }),
  );
  planet.receiveShadow = true;
  scene.add(planet);

  // A faint equator. Purely an orientation aid — without it, rolling on a
  // featureless sphere gives you no sense of having gone anywhere.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(R + 0.45, 0.06, 6, 160),
    new THREE.MeshBasicMaterial({ color: P.band, transparent: true, opacity: P.bandOp }),
  );
  band.rotation.x = Math.PI / 2;
  scene.add(band);

  /* ---- monuments ---- */
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const UP_Z = new THREE.Vector3(0, 0, 1);

  content.forEach((item, i) => {
    const base = surface(item.lat, item.lon);
    const up = base.clone().normalize();
    const h = item.height;
    const top = base.clone().addScaledVector(up, h);
    const rad = 1.15;
    const colour = P.accents[i % P.accents.length];

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 0.8, rad, h, 18),
      new THREE.MeshStandardMaterial({ color: P.monument, roughness: 0.7, metalness: 0.05 }),
    );
    pillar.position.copy(base).addScaledVector(up, h / 2);
    pillar.quaternion.setFromUnitVectors(UP_Y, up);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);

    // The collar is what you actually notice from across the planet. The
    // pillar is nearly invisible at range; the ring of colour is the hook.
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(rad * 1.05, 0.16, 8, 28),
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 1.5,
        roughness: 0.4,
      }),
    );
    collar.position.copy(base).addScaledVector(up, h * 0.82);
    collar.quaternion.setFromUnitVectors(UP_Z, up);
    scene.add(collar);

    // A glow only pays for itself where there is dark to glow into.
    if (P.lamp) {
      const glow = new THREE.PointLight(colour, 9, 16, 2);
      glow.position.copy(base).addScaledVector(up, h * 0.86);
      scene.add(glow);
    }

    capsules.push({ a: base.clone(), b: top.clone(), r: rad });
    monuments.push({
      label: item.label,
      href: item.href ?? null,
      pos: base.clone().addScaledVector(up, h * 0.9),
    });
  });

  /* ---- boulders ---- */
  const rockMat = new THREE.MeshStandardMaterial({
    color: P.rock,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });

  for (let i = 0; i < 26; i++) {
    const lat = (rand() - 0.5) * 150;
    const lon = rand() * 360;
    const rad = 0.7 + rand() * 1.9;
    // Sink it so it reads as embedded in the ground rather than resting on it.
    const c = surface(lat, lon).setLength(R + rad * 0.45);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), rockMat);
    m.position.copy(c);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    capsules.push({ a: c.clone(), b: c.clone(), r: rad });
  }

  return { capsules, monuments, lamp, planet };
}
