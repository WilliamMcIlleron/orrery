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
 * The layer that decides what is allowed to bloom.
 *
 * Anything on it is treated as a light source. Everything else is rendered
 * black into the bloom pass, which keeps it out of the blur while still
 * letting it occlude the things that do glow.
 */
export const BLOOM_LAYER = 1;

/** Adds `object` and all of its descendants to the bloom layer. */
export function makeBloomable(object) {
  object.traverse((n) => n.layers.enable(BLOOM_LAYER));
}

/**
 * Composites the blurred bloom back over the untouched render.
 *
 * Additive, because bloom is light spilling — it should only ever brighten.
 */
const CombineShader = {
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv) + texture2D(tBloom, vUv);
    }
  `,
};

const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });

/**
 * The render pipeline.
 *
 * Bloom is what makes an emissive material read as a light source rather than
 * as a bright patch of paint. It is also the most expensive thing here, so it
 * is skipped entirely when a palette asks for none — Riso is a flat print and
 * a glowing one would just look like the other three.
 *
 * ## Why the bloom is selective
 *
 * The obvious build runs one bloom over the finished frame and keeps the
 * ground out of it with a high threshold. That does not work here, and the
 * reason is the low-poly ground: it is flat shaded, so a whole triangle has
 * one luminance. Near the horizon the terrain sits right around any threshold
 * you pick, so some facets cross it and their neighbours do not — and blurring
 * that gives a soft-edged wedge with dead straight sides lying across the
 * terrain. It reads as a rendering fault, because it is one.
 *
 * Raising the threshold until the ground is safe does remove it, and takes the
 * glow off the lit monuments with it, which is the whole payoff of the piece.
 *
 * So instead: render the scene a second time with everything that is not a
 * light source painted black, bloom *that*, and add it back. Nothing that is
 * not emissive can enter the blur at any threshold, which means the threshold
 * is free to be low and the glow can be as generous as it wants. The black
 * pass is a real second draw of the scene, but the scene is two thousand
 * triangles and it runs at half resolution.
 *
 * Fog has to come off for that pass. Fog blends toward the background colour,
 * so distant black ground would fade up to a bright sky colour and bloom after
 * all — the exact artefact, moved to the horizon. The background itself stays,
 * because sky light spilling down over the hills is wanted.
 */
export class Post {
  constructor(renderer, scene, camera, P) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this._stash = new Map();

    this.bloom = null;
    this.bloomComposer = null;
    this.combine = null;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    if ((P.bloomStrength ?? 0) > 0.001) {
      this.bloom = new UnrealBloomPass(
        // Half resolution. Bloom is a blur; nobody has ever noticed it being
        // blurrier, and it costs a quarter of the fill rate.
        new THREE.Vector2(innerWidth / 2, innerHeight / 2),
        P.bloomStrength,
        P.bloomRadius ?? 0.5,
        P.bloomThreshold ?? 0.7,
      );

      this.bloomComposer = new EffectComposer(renderer);
      this.bloomComposer.renderToScreen = false;
      this.bloomComposer.addPass(new RenderPass(scene, camera));
      this.bloomComposer.addPass(this.bloom);

      this.combine = new ShaderPass(CombineShader);
      this.combine.uniforms.tBloom.value = this.bloomComposer.renderTarget2.texture;
      this.composer.addPass(this.combine);
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
    const dpr = Math.min(devicePixelRatio, 2);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    if (this.bloomComposer) {
      // Half resolution for the whole bloom branch, not just the blur inside
      // it. The output of this composer is a blur that gets added to a
      // full-resolution frame, so there is nothing in it that a second
      // full-size scene draw could resolve — and at half size the extra draw
      // costs a quarter of the fill rate.
      this.bloomComposer.setPixelRatio(dpr);
      this.bloomComposer.setSize(w / 2, h / 2);
      this.bloom.setSize(w / 2, h / 2);
      this.combine.uniforms.tBloom.value = this.bloomComposer.renderTarget2.texture;
    }
  }

  /** Paint everything that is not a light source black, and remember it. */
  _darken() {
    const scene = this.scene;
    this._fog = scene.fog;
    scene.fog = null;
    scene.traverse((n) => {
      if (!n.material) return;
      if (n.layers.isEnabled(BLOOM_LAYER)) return;
      this._stash.set(n, n.material);
      n.material = BLACK;
    });
  }

  /** Put back exactly what _darken took. */
  _restore() {
    for (const [n, m] of this._stash) n.material = m;
    this._stash.clear();
    this.scene.fog = this._fog;
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
    if (this.bloomComposer) {
      this._darken();
      this.bloomComposer.render();
      this._restore();
    }
    this.composer.render();
  }
}
