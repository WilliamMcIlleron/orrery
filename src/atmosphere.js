import * as THREE from "three";
import { R } from "./config.js";

/**
 * The glow around the planet.
 *
 * The obvious way to do this is a slightly larger sphere with a fresnel term,
 * and it is wrong here. Fresnel measures the angle between the surface and the
 * eye, which only corresponds to "near the planet's edge" while the camera is
 * comfortably outside the shell. This camera sits about five units off a
 * thirty-unit surface, and any shell big enough to give the halo height ends
 * up *containing* the camera — at which point the term brightens toward the
 * edges of the screen rather than around the planet, and the halo becomes a
 * saturated tube with a visible seam where the shell crosses the terrain.
 * Both of those were on screen before this rewrite.
 *
 * So this measures the thing it actually cares about instead: for every
 * fragment, how close does the view ray pass to the centre of the planet?
 *
 *   t = dot(-ro, rd)      distance along the ray to closest approach
 *   d = |ro + rd·t|       how near the centre it gets
 *
 * A ray grazing the limb has d ≈ R; one pointing into empty sky has d ≫ R.
 * Fading between the two is a halo by construction, and it is correct from any
 * camera position — inside the shell or outside it, on the ground or in orbit.
 * It also cannot intersect the terrain, because the geometry it is painted on
 * lives far outside the world and never comes near the ground.
 *
 * The planet occludes the glow the ordinary way, through the depth buffer.
 */

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uInner;    // radius at which the glow is full strength
  uniform float uOuter;    // radius by which it has faded to nothing
  uniform float uFalloff;  // shaping exponent
  varying vec3 vWorld;

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    // Closest approach of this view ray to the origin, which is the planet's
    // centre. Negative t puts that point behind the camera.
    float t = dot(-ro, rd);
    vec3 closest = ro + rd * max(t, 0.0);
    float d = length(closest);

    // 1 at the limb, 0 out in empty sky.
    float g = 1.0 - smoothstep(uInner, uOuter, d);
    g = pow(clamp(g, 0.0, 1.0), uFalloff);

    // Looking away from the planet: no halo, however near the ray would have
    // passed had it continued backwards.
    g *= step(0.0, t);

    float a = g * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function createAtmosphere(scene, P) {
  const uniforms = {
    uColor: { value: new THREE.Color(P.atmoColor ?? 0xffffff) },
    uIntensity: { value: 0 },
    // Just inside the limb, so the brightest part sits on the edge of the disc
    // rather than floating detached from it.
    uInner: { value: R * 0.99 },
    // How high the halo climbs — the knob for "the glow should be higher up",
    // as a world distance rather than a screen effect, so it behaves the same
    // from every angle.
    //
    // Sensitive out of proportion to how it reads. The camera orbits about
    // 1.17R from the centre, so a ray only has to pass within a little over
    // that to be pointing at open sky: pushing this to 1.66R put glow across
    // the entire upper half of the screen. 1.22R clears the limb by a
    // comfortable margin and stops well short of the zenith.
    uOuter: { value: R * 1.22 },
    uFalloff: { value: 2.2 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });

  // Deliberately enormous. The geometry is only a surface to run the shader
  // on — all the shaping happens in the ray maths — so its radius only has to
  // sit beyond everything else in the scene and inside the far plane.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R * 3.2, 32, 24), material);
  mesh.renderOrder = 1;
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    /** @param {THREE.Color} colour @param {number} intensity */
    set(colour, intensity) {
      uniforms.uColor.value.copy(colour);
      uniforms.uIntensity.value = intensity;
    },
  };
}
