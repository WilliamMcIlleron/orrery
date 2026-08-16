import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Vignette and a whisper of grain.
 *
 * Runs after OutputPass, so it works in display space where "darken the
 * corners by 12%" means what it says. Doing it before tone mapping would make
 * the amount depend on exposure.
 *
 * The grain matters more than it sounds: large areas of smooth gradient — a
 * sky, an unlit hemisphere — band into visible steps at 8 bits per channel.
 * A tiny amount of noise dithers the boundary away.
 */
const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.5 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      vec2 d = vUv - 0.5;
      // Squared radius, smoothstepped: no hard edge to the darkening.
      float r = dot(d, d);
      float vig = 1.0 - uAmount * smoothstep(0.12, 0.72, r);
      c.rgb *= vig;

      float g = hash(vUv * 1024.0 + uTime) - 0.5;
      c.rgb += g * uGrain;

      gl_FragColor = c;
    }
  `,
};

/**
 * The render pipeline.
 *
 * Bloom is what makes an emissive material read as a light source rather than
 * as a bright patch of paint. It is also the most expensive thing here, so it
 * is skipped entirely when a palette asks for none — Riso is a flat print and
 * a glowing one would just look like the other three.
 */
export class Post {
  constructor(renderer, scene, camera, P) {
    this.renderer = renderer;
    this.enabled = true;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = null;
    if ((P.bloomStrength ?? 0) > 0.001) {
      this.bloom = new UnrealBloomPass(
        // Half resolution. Bloom is a blur; nobody has ever noticed it being
        // blurrier, and it costs a quarter of the fill rate.
        new THREE.Vector2(innerWidth / 2, innerHeight / 2),
        P.bloomStrength,
        P.bloomRadius ?? 0.5,
        P.bloomThreshold ?? 0.7,
      );
      this.composer.addPass(this.bloom);
    }

    this.composer.addPass(new OutputPass());

    this.vignette = new ShaderPass(VignetteGrainShader);
    this.vignette.uniforms.uAmount.value = P.vignette ?? 0.5;
    this.composer.addPass(this.vignette);

    this.setSize(innerWidth, innerHeight);
  }

  /** Dawn moves this, so it has to be settable after construction. */
  setBloomStrength(v) {
    if (this.bloom) this.bloom.strength = v;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w / 2, h / 2);
  }

  render(elapsed) {
    this.vignette.uniforms.uTime.value = elapsed;
    this.composer.render();
  }
}
