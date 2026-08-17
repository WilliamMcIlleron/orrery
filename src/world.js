import * as THREE from "three";
import { R, RELIEF, WORLD_SEED, TOUCH_RANGE } from "./config.js";
import { addSurfaceNoise, makeSweep } from "./surface.js";
import { mulberry32 } from "./rng.js";
import { terrain, surface, closestOnSegment } from "./geometry.js";

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

  // Shared by the ground, the rocks and the monuments, so one write moves the
  // terminator across all three at once.
  const sweep = makeSweep();
  const D = P.dawn ?? {};

  /* ---- lighting ---- */
  const sun = new THREE.DirectionalLight(P.sun, P.sunInt);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  // 2048 across a frustum 90 units wide puts a shadow texel at about 0.044
  // units. At 1024 the marble's own shadow was a soft blob rather than a
  // contact shadow, and a contact shadow is most of what sells the marble
  // as touching the ground.
  sun.shadow.mapSize.set(2048, 2048);
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
    // Range and decay tuned so it lights the ground rather than the marble.
    // Sat too close, its own lamp turned the marble into the brightest thing
    // in the scene and bloom happily made it a fireball.
    lamp = new THREE.PointLight(P.lamp, P.lampInt, 34, 1.5);
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
    // White, because the sweep supplies the colour. Leaving the palette colour
    // here would multiply it in twice.
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    vertexColors: true,
  });
  // Grain and roughness variation, generated in the shader. Without it the
  // ground is solid colour and every facet reads as paint.
  addSurfaceNoise(planetMat, {
    scale: 0.34, colour: 0.19, rough: 0.5,
    sweep, night: P.ground, dawn: D.ground ?? P.ground,
    strata: P.strata ?? 0.55,
  });

  const planet = new THREE.Mesh(planetGeo, planetMat);
  planet.receiveShadow = true;
  scene.add(planet);

  /*
   * The equator band is gone.
   *
   * It was added when the planet was a smooth featureless sphere and rolling
   * gave you no sense of having travelled. Terrain relief, scattered rock and
   * lit beams all do that job better now, and once bloom went in the thin
   * torus read as a stray green arc floating above the ground — an artifact
   * rather than an aid. Removing a crutch once it stops carrying weight.
   */

  /* ---- monuments ---- */
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const UP_Z = new THREE.Vector3(0, 0, 1);
  const monumentMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.05,
  });
  addSurfaceNoise(monumentMat, {
    scale: 1.1, colour: 0.14, rough: 0.35,
    sweep, night: P.monument, dawn: D.monument ?? P.monument,
  });

  content.forEach((item, i) => {
    const base = surface(item.lat, item.lon);
    const up = base.clone().normalize();
    const h = item.height;
    const top = base.clone().addScaledVector(up, h);
    const rad = 1.15;
    const colour = P.accents[i % P.accents.length];

    /*
     * A lathed obelisk rather than a cylinder.
     *
     * The profile is eight points revolved around the axis: a wide plinth, a
     * step, a long taper, and a narrow shoulder near the top. It costs the
     * same as the cylinder it replaced and stops the world looking like a set
     * of default primitives, which was the single loudest thing making this
     * read as a tech demo.
     */
    const profile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(rad * 1.34, 0.0),
      new THREE.Vector2(rad * 1.34, h * 0.055),
      new THREE.Vector2(rad * 1.02, h * 0.085),
      new THREE.Vector2(rad * 0.95, h * 0.70),
      new THREE.Vector2(rad * 0.78, h * 0.80),
      new THREE.Vector2(rad * 0.72, h * 0.95),
      new THREE.Vector2(0.0, h),
    ];
    const pillar = new THREE.Mesh(new THREE.LatheGeometry(profile, 22), monumentMat);
    pillar.position.copy(base);
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
    const collar = new THREE.Mesh(new THREE.TorusGeometry(rad * 0.92, 0.13, 10, 30), collarMat);
    collar.position.copy(base).addScaledVector(up, h * 0.755);
    collar.quaternion.setFromUnitVectors(UP_Z, up);
    scene.add(collar);

    /*
     * The activation ring.
     *
     * Drawn on the ground at exactly TOUCH_RANGE, so the thing you are aiming
     * at is a circle you can see rather than a post you have to hit. Before
     * this, reaching a monument meant driving into a pillar and glancing past
     * at speed did nothing — a precision task in a piece that is not about
     * precision.
     *
     * It breathes slowly while unlit, which is the only self-animating thing
     * in the world and the reason `prefers-reduced-motion` is honoured by
     * holding it still rather than by disabling it.
     */
    const ringMat = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(TOUCH_RANGE, 0.085, 6, 90),
      ringMat,
    );
    ring.position.copy(base);
    // A flat disc tangent to a sphere lifts its own edge by r^2/2R. Sinking
    // the centre by half that splits the error either side of the ground so
    // the ring neither floats nor buries itself.
    ring.position.addScaledVector(up, -(TOUCH_RANGE * TOUCH_RANGE) / (4 * R) + 0.06);
    ring.quaternion.setFromUnitVectors(UP_Z, up);
    ring.renderOrder = 1;
    scene.add(ring);

    /*
     * A beam of light that fires when the monument lights.
     *
     * An open-ended cone, additive, fading out with height and towards its own
     * silhouette so it has no visible edge. This is the thing you can see from
     * the far side of the planet once it is lit, and it is what turns "four
     * pillars somewhere" into a map you can read at a glance.
     */
    const beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colour) },
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          // Fade out with height, and hardest at the very top.
          float up = pow(1.0 - vUv.y, 1.6);
          // Brighter edge-on, so it reads as a volume rather than a sheet.
          float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vView))), 1.5);
          float a = up * (0.28 + rim * 0.85) * uOpacity;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const beamH = 26;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 2.6, rad * 0.5, beamH, 20, 1, true),
      beamMat,
    );
    beam.position.copy(base).addScaledVector(up, h * 0.72 + beamH / 2);
    beam.quaternion.setFromUnitVectors(UP_Y, up);
    beam.renderOrder = 3;
    scene.add(beam);

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
      beamMat,
      ringMat,
      glow,
      lit: false,
      // Drives the light-up animation, 0 to 1.
      t: 0,
    });
  });

  /* ---- boulders ---- */
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });
  // Higher frequency than the ground: rocks are smaller, so the same world
  // scale would give each one a single flat sample and no variation at all.
  addSurfaceNoise(rockMat, {
    scale: 0.85, colour: 0.26, rough: 0.4,
    sweep, night: P.rock, dawn: D.rock ?? P.rock,
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

  /*
   * Bake ambient occlusion into the vertex colours the height tint already uses.
   *
   * The shadow map only darkens ground the sun reaches, and half this planet
   * has no sun at all — in Riso the key is a flat white light that produces
   * almost no shading anywhere. Ambient occlusion is what actually welds an
   * object to the ground it is standing on, and here it is nearly free: every
   * occluder is already a capsule with a known radius, and the planet already
   * carries a per-vertex colour that nothing else competes for.
   *
   * Because it lives in the vertex colour, the dawn sweep and the palette both
   * still recolour the ground underneath it with no extra work.
   */
  {
    const pos = planetGeo.attributes.position;
    const nrm = planetGeo.attributes.normal;
    const col = planetGeo.attributes.color;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const cp = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      let ao = 1;

      for (let j = 0; j < capsules.length; j++) {
        const c = capsules[j];
        // Generous falloff. Tight to the occluder's own radius makes the
        // result read as a painted circle rather than as occlusion.
        const reach = c.r * 3.6;
        closestOnSegment(c.a, c.b, v, cp);
        dir.subVectors(cp, v);
        const d = dir.length();
        if (d >= reach || d < 1e-5) continue;

        // Falls off with distance, and only counts where the occluder is
        // actually above the surface — otherwise vertices on the far side of
        // a rock darken as much as those beneath it.
        const fall = 1 - d / reach;
        const facing = Math.max(0, dir.divideScalar(d).dot(n));
        ao *= 1 - 0.62 * fall * fall * facing;
      }

      if (ao < 1) {
        col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
      }
    }
    col.needsUpdate = true;
  }

  return {
    capsules,
    monuments,
    lamp,
    handles: { sun, hemi, lamp, starMat, planetMat, rockMat, monumentMat, sweep },
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

  // Ground, rock and monument colour are NOT written here. They belong to the
  // terminator sweep in the shader — writing them would crossfade the whole
  // planet at once and undo the effect entirely.

  if (handles.lamp) handles.lamp.intensity = state.lampInt;
  if (handles.starMat) handles.starMat.opacity = state.stars;
}
