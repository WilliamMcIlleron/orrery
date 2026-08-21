import * as THREE from "three";
import { R, RELIEF, WORLD_SEED, TOUCH_RANGE, PLANET_DETAIL, SUN_DIR as SUN_DIR_RAW } from "./config.js";
import { addSurfaceNoise, makeSweep } from "./surface.js";
import { makeBloomable } from "./postfx.js";
import { createSky } from "./sky.js";
import { makeBoulder, scatterLandmarks } from "./landmarks.js";
import { mulberry32 } from "./rng.js";
import { terrain, surface, groundRadius, closestOnSegment } from "./geometry.js";

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
  /*
   * The sun, and a shadow camera that follows the marble.
   *
   * The first version pointed a single orthographic shadow camera at the
   * origin with a frustum 90 units wide — wide enough to hold the entire
   * planet. That sounds like the safe choice and it is the expensive one:
   * 2048 texels across 90 units is a texel every 0.044 units, which on a
   * sphere whose faces meet the light at every angle is coarse enough that
   * grazing faces self-shadow across their whole width. The result was a
   * soft-edged wedge lying across the terrain that read as a rendering fault,
   * and no contact shadow worth the map it was drawn on.
   *
   * You can only ever see a small cap of a planet this size, so the shadow
   * camera only ever needs to cover that cap. A frustum 32 units across puts a
   * texel at 0.016 units — nearly three times finer — and confines every
   * artefact to ground you are standing on rather than spreading it over the
   * horizon.
   */
  const SUN_DIR = new THREE.Vector3(SUN_DIR_RAW.x, SUN_DIR_RAW.y, SUN_DIR_RAW.z).normalize();
  const SUN_DIST = 90;
  const SHADOW_HALF = 16;

  const sun = new THREE.DirectionalLight(P.sun, P.sunInt);
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = SUN_DIST - R - RELIEF - 6;
  sc.far = SUN_DIST + R + RELIEF + 6;
  sc.left = -SHADOW_HALF;
  sc.right = SHADOW_HALF;
  sc.top = SHADOW_HALF;
  sc.bottom = -SHADOW_HALF;
  // normalBias is the right tool here and plain bias is not. Constant bias
  // trades acne for peter-panning uniformly; normalBias pushes the sample
  // along the surface normal, so it scales with exactly the grazing geometry
  // that causes the acne and leaves face-on ground alone.
  sun.shadow.bias = -0.0002;
  // 0.12 was found by sweep, not by taste: below about 0.1 the grazing faces
  // of the sphere self-shadow in a broad wedge, and above about 0.3 the
  // marble's contact shadow starts to detach from the marble.
  sun.shadow.normalBias = 0.12;
  scene.add(sun);
  // A directional light aims at its target, and the target has to be in the
  // scene graph for its world matrix to be updated.
  scene.add(sun.target);

  const _sunCentre = new THREE.Vector3();
  const _sunSide = new THREE.Vector3();
  const _sunUp = new THREE.Vector3();
  /**
   * Re-centre the shadow camera on a point, snapped to whole shadow texels.
   *
   * Without the snap the frustum slides continuously and every shadow edge
   * crawls against the ground as you roll — the classic shimmer, and more
   * distracting than the artefact this replaced. Quantising the centre to the
   * texel grid means the depth map samples the same world points from frame to
   * frame until it jumps by exactly one texel, which is invisible.
   *
   * @param {THREE.Vector3} focus  world point to centre on, normally the marble
   */
  function aimShadow(focus) {
    // A stable basis for the light's own axes. Any two vectors perpendicular
    // to the light will do, as long as they do not change frame to frame.
    _sunSide.set(0, 1, 0).cross(SUN_DIR).normalize();
    _sunUp.crossVectors(SUN_DIR, _sunSide).normalize();
    const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x;
    const u = Math.round(focus.dot(_sunSide) / texel) * texel;
    const v = Math.round(focus.dot(_sunUp) / texel) * texel;
    const w = focus.dot(SUN_DIR);
    _sunCentre.copy(_sunSide).multiplyScalar(u)
      .addScaledVector(_sunUp, v)
      .addScaledVector(SUN_DIR, w);
    sun.target.position.copy(_sunCentre);
    sun.position.copy(_sunCentre).addScaledVector(SUN_DIR, SUN_DIST);
    sun.target.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
  }

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
    const stars = new THREE.Points(g, starMat);
    // Stars are light sources by definition, and they are the one thing in
    // the scene small enough that bloom is what stops them reading as dust.
    makeBloomable(stars);
    scene.add(stars);
  } else {
    // Burn the same draws so the rock scatter is identical across palettes.
    // Without this, switching palette silently rearranges the world.
    for (let i = 0; i < 2700; i++) rand();
  }

  /* ---- planet ---- */
  // Overridable from the URL so subdivision can be compared side by side
  // rather than argued about. ?detail=8 and reload.
  const DETAIL = (() => {
    const q = Number(new URLSearchParams(location.search).get("detail"));
    return Number.isFinite(q) && q >= 1 && q <= 24 ? q : PLANET_DETAIL;
  })();
  const planetGeo = new THREE.IcosahedronGeometry(R, DETAIL);

  /*
   * Push every vertex out to the ground and tint it by height.
   *
   * A function rather than a block because the ground moves now: closing a
   * pass changes groundRadius(), and a landform the marble collides with has
   * to be a landform the mesh shows. Safe to call repeatedly — displacement is
   * radial, so normalising an already-displaced vertex recovers exactly the
   * direction it started from, and the second call lands in the same place the
   * first one would have.
   */
  const _shade = new Float32Array(planetGeo.attributes.position.count * 3);
  planetGeo.setAttribute("color", new THREE.BufferAttribute(_shade, 3));

  /*
   * Every vertex's direction from the centre, captured once.
   *
   * IcosahedronGeometry hands back a sphere of radius R, so at this moment the
   * positions *are* the directions scaled by R and the whole table is one
   * division. Worth keeping: a rebuild otherwise re-normalises to find out
   * where each vertex points, and at three unshared vertices per face that is
   * twenty thousand square roots to answer a question whose answer never
   * changes. It also drops the assumption that displacement stays radial.
   */
  const _dirs = (() => {
    const p = planetGeo.attributes.position;
    const d = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      d[i * 3] = p.getX(i) / R;
      d[i * 3 + 1] = p.getY(i) / R;
      d[i * 3 + 2] = p.getZ(i) / R;
    }
    return d;
  })();

  function displacePlanet(near, cosR) {
    const p = planetGeo.attributes.position;
    const nrm = planetGeo.attributes.normal;
    const shade = _shade;
    const v = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fnorm = new THREE.Vector3();
    const k = P.reliefShade ?? 0.15;

    // Walked a face at a time rather than a vertex at a time, because the
    // geometry is non-indexed — PolyhedronGeometry emits three unshared
    // vertices per triangle — and the normal of a flat-shaded facet is a
    // property of the face. Doing it here also avoids computeVertexNormals(),
    // which has no idea only a handful of triangles moved.
    for (let i = 0; i < p.count; i += 3) {
      if (near) {
        let touches = false;
        for (let j = 0; j < 3 && !touches; j++) {
          const o = (i + j) * 3;
          if (_dirs[o] * near.x + _dirs[o + 1] * near.y + _dirs[o + 2] * near.z > cosR) {
            touches = true;
          }
        }
        if (!touches) continue;
      }

      for (let j = 0; j < 3; j++) {
        const o = (i + j) * 3;
        v.set(_dirs[o], _dirs[o + 1], _dirs[o + 2]);
        const h = terrain(v.x, v.y, v.z);
        v.multiplyScalar(groundRadius(v));
        p.setXYZ(i + j, v.x, v.y, v.z);

        // Vertex tint by height: high ground catches light, hollows sit in
        // shadow. It multiplies the material colour, so the dawn transition
        // can still recolour the ground underneath it without touching this.
        //
        // This is what makes relief legible in palettes where the lighting
        // alone cannot do it. Riso is the extreme case — cream ground under a
        // white sun produces almost no shading variation, so the terrain
        // vanishes and you lose the ability to perceive your own speed, which
        // is the entire reason the relief exists.
        //
        // Note this discards any occlusion already multiplied in here, which
        // is why a regional displacement has to re-bake the same region.
        const s = 1 + h * k;
        shade[(i + j) * 3] = s;
        shade[(i + j) * 3 + 1] = s;
        shade[(i + j) * 3 + 2] = s;
      }

      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      fnorm.crossVectors(e1, e2).normalize();
      for (let j = 0; j < 3; j++) nrm.setXYZ(i + j, fnorm.x, fnorm.y, fnorm.z);
    }

    p.needsUpdate = true;
    nrm.needsUpdate = true;
    planetGeo.attributes.color.needsUpdate = true;
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
    makeBloomable(collar);
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
    makeBloomable(ring);
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
    makeBloomable(beam);
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

  /* ---- the rest of the system ---- */
  const sky = createSky(scene, P);

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
    /*
     * Seated on the ground, not at a fixed distance from the core.
     *
     * This read `.setLength(R + rad * 0.45)`, which throws away the terrain
     * height that surface() had just worked out and puts every rock at the
     * same radius regardless of what is under it. The relief swings 1.5 either
     * way, so a boulder in a hollow floated by up to that much and one on a
     * rise was swallowed. Reported as rocks not attached to the ground, and
     * they were not.
     *
     * The 0.45 stays: it buries the rock by a bit over half its radius, which
     * is what stops a sphere reading as a ball resting on a plane.
     */
    const dir = surface(lat, lon).normalize();
    const c = dir.clone().multiplyScalar(groundRadius(dir) + rad * 0.45);

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

    // Every boulder gets its own lumps and its own squash. Twenty-six copies
    // of one icosphere is a texture, not a landscape, and the eye picks the
    // repeat up long before it can say why.
    const { geometry, radius } = makeBoulder(rad, rand);
    const m = new THREE.Mesh(geometry, rockMat);
    m.position.copy(c);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    // Sized to the furthest lump rather than to the nominal radius, so the
    // marble never rolls through a corner that stuck out.
    capsules.push({ a: c.clone(), b: c.clone(), r: radius });
    placed.push({ pos: c, clearance: radius });
  }

  /* ---- landmarks ---- */
  /*
   * Placed before the ambient-occlusion bake, so their capsules are in the
   * list when it runs and every stone gets welded to the ground it stands on.
   */
  const crystalMat = new THREE.MeshStandardMaterial({
    color: P.crystal ?? P.accents?.[0] ?? 0xffffff,
    // Faint, not glowing. On the bloom layer this is enough to make a cluster
    // legible across the unlit hemisphere without competing with a monument.
    emissive: new THREE.Color(P.crystal ?? P.accents?.[0] ?? 0xffffff).multiplyScalar(P.lamp ? 0.55 : 0.12),
    roughness: 0.35,
    metalness: 0.0,
    flatShading: true,
  });
  const crystalClusters = scatterLandmarks(
    scene,
    { stone: monumentMat, crystal: crystalMat },
    rand,
    capsules,
    placed,
    { circle: 2, arch: 3, crystal: 6 },
  );

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
  function bakePlanetAO(near, cosR) {
    const pos = planetGeo.attributes.position;
    const nrm = planetGeo.attributes.normal;
    const col = planetGeo.attributes.color;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const cp = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      if (near) {
        const o = i * 3;
        if (_dirs[o] * near.x + _dirs[o + 1] * near.y + _dirs[o + 2] * near.z < cosR) continue;
      }
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

  /**
   * Rebuild the ground after groundRadius() has changed underneath it.
   *
   * `near` is a unit direction and `radius` a distance in world units; pass
   * them and only the facets within that cap are touched. This is not an
   * optimisation so much as the difference between shipping the feature and
   * not: a whole-planet pass costs 14.5ms of plain JavaScript before the
   * occlusion bake, and the occlusion bake is 176ms on its own against 118
   * capsules. Run every frame of a one-and-a-half second animation, that is
   * not a rebuild, it is a stall.
   *
   * A sealing pass moves a disc about seven units across. Everything else on
   * the planet is already where it should be.
   */
  function rebuildPlanet(near = null, radius = 0) {
    const cosR = near ? Math.cos(Math.min(Math.PI, radius / R)) : -1;
    displacePlanet(near, cosR);
    bakePlanetAO(near, cosR);
  }

  displacePlanet();
  bakePlanetAO();

  return {
    rebuildPlanet,
    capsules,
    monuments,
    lamp,
    crystalClusters,
    handles: {
      sun, aimShadow, hemi, lamp, starMat, planetMat, rockMat, monumentMat, sweep,
      moonMat: sky.moonMat, bodyMat: sky.bodyMat, ringMat: sky.ringMat, crystalMat,
    },
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
  // The sky bodies warm through dawn with everything else. They are lit by the
  // same sun, so their shading already moves; this is only their albedo.
  if (handles.moonMat) handles.moonMat.color.copy(state.moon);
  if (handles.bodyMat) handles.bodyMat.color.copy(state.companion);
  if (handles.ringMat) handles.ringMat.color.copy(state.ring);
  if (handles.starMat) handles.starMat.opacity = state.stars;
}
