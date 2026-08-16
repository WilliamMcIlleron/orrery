import * as THREE from "three";

/**
 * Surface detail, without a single texture file.
 *
 * The ground was solid colour, so all its shape came from the facets and the
 * light. That is what "flat" looked like up close: no grain, no variation, and
 * every rock the same shade as every other rock.
 *
 * Rather than load images, this patches Three's standard material and mixes
 * value noise into the diffuse colour and the roughness at the fragment stage.
 * The noise is sampled in *world space*, which matters on a sphere: there is
 * no sane UV layout for an icosahedron, and a world-space lookup needs none.
 * It is also seamless everywhere by construction — no wrapping, no poles, no
 * pinching where the projection would have folded.
 *
 * Roughness variation does more work than colour here. Colour alone reads as
 * dirt on the texture; roughness changes how the light behaves across the
 * surface, which is what makes it read as material rather than paint.
 */

const NOISE_GLSL = /* glsl */ `
  float orr_hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float orr_vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    // Smoothstep the interpolant, or the lattice shows up as a visible grid.
    f = f * f * (3.0 - 2.0 * f);
    float n000 = orr_hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = orr_hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = orr_hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = orr_hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = orr_hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = orr_hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = orr_hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = orr_hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  // Three octaves. A fourth is not visible at the distances this is viewed at.
  float orr_fbm(vec3 p) {
    return orr_vnoise(p) * 0.58
         + orr_vnoise(p * 2.7) * 0.28
         + orr_vnoise(p * 6.3) * 0.14;
  }
`;

/**
 * Shared state for the dawn terminator.
 *
 * One object, handed to every material that takes part, so a single write
 * moves the ground, the rocks and the monuments together. Uniform *objects*
 * are shared by reference — Three reads `.value` at draw time — which is what
 * makes this work without a per-material update loop.
 */
export function makeSweep() {
  return {
    // Centre of the growing lit cap.
    uSweepAxis: { value: new THREE.Vector3(0, 1, 0) },
    // Cosine threshold. +1 is nothing lit, -1 is everything lit.
    uSweepT: { value: 1.2 },
    // Half-width of the leading edge, in cosine. Widened hugely under reduced
    // motion, which degrades the sweep to a plain crossfade.
    uSweepSoft: { value: 0.09 },
    // Colour of the light line itself. Emissive, so bloom picks it up free.
    uSweepRim: { value: new THREE.Color(0, 0, 0) },
  };
}

const SWEEP_DECL = /* glsl */ `
  uniform vec3 uSweepAxis;
  uniform float uSweepT;
  uniform float uSweepSoft;
  uniform vec3 uSweepRim;
  uniform vec3 uNight;
  uniform vec3 uDawn;
`;

/**
 * @param {THREE.Material} material  a MeshStandardMaterial
 * @param {object} opts
 * @param {number} opts.scale    world-space frequency
 * @param {number} opts.colour   how much the tint moves, 0 to ~0.4
 * @param {number} opts.rough    how much roughness moves, 0 to ~0.5
 * @param {object} [opts.sweep]  shared object from makeSweep(), enables dawn
 * @param {number} [opts.night]  colour before the terminator passes
 * @param {number} [opts.dawn]   colour after it
 */
export function addSurfaceNoise(
  material,
  { scale = 0.22, colour = 0.2, rough = 0.35, sweep = null, night = 0xffffff, dawn = null } = {},
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNoiseScale = { value: scale };
    shader.uniforms.uNoiseColour = { value: colour };
    shader.uniforms.uNoiseRough = { value: rough };

    if (sweep) {
      // Shared by reference on purpose — see makeSweep().
      Object.assign(shader.uniforms, sweep);
      shader.uniforms.uNight = { value: new THREE.Color(night) };
      shader.uniforms.uDawn = { value: new THREE.Color(dawn ?? night) };
    }

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOrrWorld;")
      // begin_vertex always exists, unlike worldpos_vertex which Three only
      // includes when something else has already asked for a world position.
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vOrrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vOrrWorld;
        uniform float uNoiseScale;
        uniform float uNoiseColour;
        uniform float uNoiseRough;
        ${sweep ? SWEEP_DECL : ""}
        ${NOISE_GLSL}`,
      )
      // After color_fragment so it multiplies whatever the vertex tint and the
      // material colour already agreed on.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float orrN = orr_fbm(vOrrWorld * uNoiseScale);
        diffuseColor.rgb *= 1.0 + (orrN - 0.5) * uNoiseColour * 2.0;
        ${sweep ? `
        /*
         * Dawn arrives as a line that crosses the world, not as a filter fading
         * in over it. The lit region is a spherical cap around uSweepAxis whose
         * threshold walks from +1 (nothing) to -1 (everything).
         *
         * Sampled from the world position, never the vertex normal: this
         * terrain is flat-shaded, and a per-face signal would turn the
         * terminator into a jagged polygon edge instead of a smooth line.
         */
        float orrC = dot(normalize(vOrrWorld), uSweepAxis);
        float orrS = smoothstep(uSweepT - uSweepSoft, uSweepT + uSweepSoft * 0.6, orrC);
        diffuseColor.rgb *= mix(uNight, uDawn, orrS);` : ""}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        ${sweep ? `
        // The leading edge glows. Bloom is already running, so this becomes a
        // band of light travelling over the terrain for free.
        float orrEdge = 1.0 - clamp(abs(orrC - uSweepT) / max(uSweepSoft * 1.35, 0.001), 0.0, 1.0);
        // Narrow and fifth-power: bloom is already running at strength ~1, and a
        // wide or bright edge stops being a line of light and becomes a flare
        // across the whole screen at the exact moment you want clarity.
        totalEmissiveRadiance += uSweepRim * pow(orrEdge, 4.0);` : ""}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float orrR = orr_fbm(vOrrWorld * uNoiseScale * 2.3 + 19.0);
        roughnessFactor = clamp(roughnessFactor * (1.0 + (orrR - 0.5) * uNoiseRough * 2.0), 0.04, 1.0);`,
      );
  };

  // Materials with different injected code must not share a compiled program.
  material.customProgramCacheKey = () => `orr-noise-${scale}-${colour}-${rough}-${sweep ? 1 : 0}`;
  material.needsUpdate = true;
  return material;
}
