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
 * @param {THREE.Material} material  a MeshStandardMaterial
 * @param {object} opts
 * @param {number} opts.scale    world-space frequency
 * @param {number} opts.colour   how much the tint moves, 0 to ~0.4
 * @param {number} opts.rough    how much roughness moves, 0 to ~0.5
 */
export function addSurfaceNoise(material, { scale = 0.22, colour = 0.2, rough = 0.35 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNoiseScale = { value: scale };
    shader.uniforms.uNoiseColour = { value: colour };
    shader.uniforms.uNoiseRough = { value: rough };

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
        ${NOISE_GLSL}`,
      )
      // After color_fragment so it multiplies whatever the vertex tint and the
      // material colour already agreed on.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float orrN = orr_fbm(vOrrWorld * uNoiseScale);
        diffuseColor.rgb *= 1.0 + (orrN - 0.5) * uNoiseColour * 2.0;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float orrR = orr_fbm(vOrrWorld * uNoiseScale * 2.3 + 19.0);
        roughnessFactor = clamp(roughnessFactor * (1.0 + (orrR - 0.5) * uNoiseRough * 2.0), 0.04, 1.0);`,
      );
  };

  // Materials with different injected code must not share a compiled program.
  material.customProgramCacheKey = () => `orr-noise-${scale}-${colour}-${rough}`;
  material.needsUpdate = true;
  return material;
}
