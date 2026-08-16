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
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.5 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSplitShadow: { value: new THREE.Vector3(1, 1, 1) },
    uSplitHigh: { value: new THREE.Vector3(1, 1, 1) },
    uSplitAmount: { value: 0 },
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
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform vec3 uSplitShadow;
    uniform vec3 uSplitHigh;
    uniform float uSplitAmount;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // Lift / gamma / gain, the standard three-way grade. Lift moves the
      // black point, gain the white point, gamma everything between — which
      // is the only one of the three that can shift midtones without
      // crushing or blowing the ends.
      c = uGain * (c + uLift);
      c = pow(max(c, 0.0), 1.0 / uGamma);

      // Split toning: push shadows and highlights in opposite hue directions.
      // This is most of what separates a graded image from a tinted one — a
      // single tint moves everything together and just looks like a filter.
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(uSplitShadow, uSplitHigh, smoothstep(0.15, 0.85, lum));
      c = mix(c, c * tint, uSplitAmount);

      // Vignette. Squared radius, smoothstepped, so there is no hard edge.
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.12, 0.72, dot(d, d));

      /*
       * Triangular-PDF dither, not flat noise.
       *
       * Subtracting two uniform samples gives a triangular distribution, which
       * decorrelates the quantisation error from the signal instead of merely
       * hiding it. That is the difference between banding you cannot see and
       * banding you can see through a haze — and this scene is mostly large
       * smooth gradients across a sky, which is exactly where 8-bit banding
       * shows up worst.
       */
      float n1 = hash(vUv * 1024.0 + uTime);
      float n2 = hash(vUv * 1024.0 + uTime + 17.0);
      c += (n1 - n2) * uGrain;

      gl_FragColor = vec4(c, 1.0);
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

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.applyGrade(P);

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

  /** Pull grading values off a palette. Defaults are a no-op identity grade. */
  applyGrade(P) {
    const g = P.grade ?? {};
    const u = this.grade.uniforms;
    u.uVignette.value = g.vignette ?? 0.5;
    u.uGrain.value = g.grain ?? 0.03;
    u.uLift.value.fromArray(g.lift ?? [0, 0, 0]);
    u.uGamma.value.fromArray(g.gamma ?? [1, 1, 1]);
    u.uGain.value.fromArray(g.gain ?? [1, 1, 1]);
    u.uSplitShadow.value.fromArray(g.splitShadow ?? [1, 1, 1]);
    u.uSplitHigh.value.fromArray(g.splitHigh ?? [1, 1, 1]);
    u.uSplitAmount.value = g.splitAmount ?? 0;
  }

  render(elapsed) {
    this.grade.uniforms.uTime.value = elapsed;
    this.composer.render();
  }
}
