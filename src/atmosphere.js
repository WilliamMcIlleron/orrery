import * as THREE from "three";
import { R } from "./config.js";

/**
 * The glow around the planet's edge.
 *
 * A sphere a little larger than the world, rendered inside-out and lit by a
 * fresnel term, so it is invisible where you look straight through it and
 * brightest where your line of sight grazes the surface. That is the same
 * geometry that makes a real atmosphere a bright rim from orbit.
 *
 * It does more work than it looks like it should. Without it the planet is a
 * hard-edged shape cut out of the background; with it the horizon has depth
 * and the world reads as a body rather than a disc.
 *
 * Additive, depth-write off, back faces only — so it never occludes anything
 * and never fights the depth buffer.
 */
export function createAtmosphere(scene, P) {
  const uniforms = {
    uColor: { value: new THREE.Color(P.atmoColor ?? 0xffffff) },
    uIntensity: { value: P.atmoInt ?? 0 },
    uPower: { value: P.atmoPower ?? 2.6 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vNormal;
      varying vec3 vView;

      void main() {
        vec3 viewDir = normalize(-vView);
        // abs() because these are back faces: their normals point inward and
        // the sign would otherwise invert the whole effect.
        float rim = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), uPower);
        float a = rim * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });

  // 1.055 is enough to read as a halo and small enough that the marble never
  // travels through it.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.055, 48, 32), material);
  mesh.renderOrder = 2;
  scene.add(mesh);

  return { mesh, uniforms, material };
}
