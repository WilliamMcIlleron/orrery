import * as THREE from "three";

/**
 * Palettes, and the dawn each one breaks into.
 *
 * These are not four coats of paint on the same thing. Two of them
 * (playground, riso) are lit worlds with no night side, which means the
 * travelling lamp does not exist in them and dawn has much less to do. A
 * palette here is partly a mechanic decision wearing a colour decision's
 * clothes — read `lamp` as "does this world have a dark half".
 *
 * Every palette carries a `dawn` block of overrides. The world interpolates
 * from the base values to the dawn values once all four monuments are lit.
 * Only the fields that change need listing.
 */

/** Fields interpolated as colours. */
const COLOUR_KEYS = ["bg", "ground", "rock", "monument", "hemiSky", "hemiGround", "sun", "band", "atmoColor"];

/** Fields interpolated as plain numbers. */
const NUMBER_KEYS = [
  "fogNear", "fogFar", "hemiInt", "sunInt", "exposure", "stars", "bandOp", "lampInt",
  "atmoInt", "bloomStrength",
];

export const PALETTES = {
  playground: {
    name: "Playground",
    note: "daylit · no night side",
    reliefShade: 0.16,
    atmoColor: 0xbfe6ff, atmoInt: 0.30, atmoPower: 4.0,
    bloomStrength: 0.30, bloomRadius: 0.6, bloomThreshold: 1.25,
    bg: 0x9fd8e8, fogNear: 70, fogFar: 190,
    ground: 0x8ecf7a, rock: 0xb9895e, monument: 0xf4f1e8, marble: 0xffffff,
    accents: [0xff6b4a, 0xffc23d, 0x4aa3e8, 0x9b6bd6],
    hemiSky: 0xcdeeff, hemiGround: 0x6fae7a, hemiInt: 2.5,
    sun: 0xfff6e0, sunInt: 2.4,
    lamp: false, lampInt: 0,
    stars: 0, exposure: 1.05, band: 0x6fae7a, bandOp: 0.25,
    // A world that was never dark cannot have a sunrise. It gets golden hour
    // instead: lower, warmer, richer. Overselling it would look like a bug.
    dawn: {
      bg: 0xf3c88d, ground: 0x9ed684, sun: 0xffd9a0, sunInt: 3.0,
      hemiSky: 0xffe3bd, hemiInt: 2.7, exposure: 1.2, fogFar: 210,
      atmoColor: 0xffd7a1, atmoInt: 0.5, bloomStrength: 0.42,
    },
  },

  deepfield: {
    name: "Deep field",
    note: "void · night side + travelling lamp",
    reliefShade: 0.15,
    atmoColor: 0x6fa8ff, atmoInt: 0.62, atmoPower: 3.6,
    bloomStrength: 1.05, bloomRadius: 0.5, bloomThreshold: 1.12,
    bg: 0x05070e, fogNear: 55, fogFar: 150,
    ground: 0x53706a, rock: 0x5b6675, monument: 0x39414d, marble: 0xf2f6ff,
    accents: [0xffb03a, 0x5fb8ff, 0x66e0a8, 0xff7aa8],
    hemiSky: 0x8fa8cc, hemiGround: 0x1c222c, hemiInt: 1.4,
    sun: 0xdce8ff, sunInt: 2.0,
    lamp: 0xcfe0ff, lampInt: 26,
    stars: 0.75, exposure: 1.35, band: 0x5f7a6d, bandOp: 0.3,
    // The payoff. Night to warm terracotta morning: the stars go out, the sun
    // warms and strengthens, and the lamp fades because you stop needing it.
    dawn: {
      bg: 0x2a1c2e, ground: 0xb0785f, rock: 0x8a6357, monument: 0x4a3830,
      hemiSky: 0xffb37a, hemiGround: 0x33222a, hemiInt: 1.9,
      sun: 0xffb877, sunInt: 3.1,
      stars: 0.06, exposure: 1.28, band: 0xffb37a, bandOp: 0.22,
      lampInt: 6, fogFar: 170,
      atmoColor: 0xffa463, atmoInt: 1.0, bloomStrength: 1.15,
    },
  },

  dusk: {
    name: "Dusk",
    note: "warm terracotta · keeps night side",
    reliefShade: 0.15,
    atmoColor: 0xff9a5c, atmoInt: 0.68, atmoPower: 3.4,
    bloomStrength: 1.0, bloomRadius: 0.5, bloomThreshold: 1.10,
    bg: 0x140f1c, fogNear: 55, fogFar: 150,
    ground: 0xc07a56, rock: 0x8f5a46, monument: 0x4a3830, marble: 0xfff0e0,
    accents: [0x4ecdc4, 0xffd166, 0xef476f, 0x8ecae6],
    hemiSky: 0xffb37a, hemiGround: 0x2a1a20, hemiInt: 1.5,
    sun: 0xffa961, sunInt: 2.8,
    lamp: 0xffd9b0, lampInt: 26,
    stars: 0.45, exposure: 1.3, band: 0xffb37a, bandOp: 0.22,
    dawn: {
      bg: 0x6d4a52, ground: 0xdb9a66, rock: 0xa9705a,
      hemiSky: 0xffd9a8, hemiInt: 2.1, sun: 0xffd6a0, sunInt: 3.4,
      stars: 0.0, exposure: 1.24, lampInt: 5, fogFar: 175,
      atmoColor: 0xffc27a, atmoInt: 0.95, bloomStrength: 1.1,
    },
  },

  riso: {
    name: "Riso",
    note: "flat print · no night side",
    reliefShade: 0.34,
    atmoColor: 0xc9bda4, atmoInt: 0.0, atmoPower: 3.0,
    bloomStrength: 0.0, bloomRadius: 0.4, bloomThreshold: 1.0,
    bg: 0xf2ede1, fogNear: 80, fogFar: 210,
    ground: 0xdcd2bd, rock: 0xbdb198, monument: 0x2f2b26, marble: 0x2f2b26,
    accents: [0xe0503a, 0x2f5d7c, 0x3f7d5c, 0xd9a520],
    hemiSky: 0xffffff, hemiGround: 0xd8cfbc, hemiInt: 2.7,
    sun: 0xffffff, sunInt: 1.5,
    lamp: false, lampInt: 0,
    stars: 0, exposure: 1.0, band: 0x9a8f78, bandOp: 0.35,
    // A print does not have weather. The paper warms and the ink deepens.
    dawn: {
      bg: 0xf7e3c4, ground: 0xe8d9b8, rock: 0xc4b092,
      hemiSky: 0xfff4e0, sunInt: 1.8, exposure: 1.08, bandOp: 0.45,
    },
  },
};

export const DEFAULT_PALETTE = "deepfield";

/** Reads the palette key from the URL hash, falling back to the default. */
export function resolvePaletteKey(hash = location.hash) {
  const key = hash.replace(/^#/, "");
  return key in PALETTES ? key : DEFAULT_PALETTE;
}

/**
 * A live, mutable set of the values the renderer actually consumes.
 *
 * Colours are THREE.Color instances so they can be lerped in place without
 * allocating on every frame of the transition.
 */
export function makePaletteState(P) {
  const state = {};
  for (const k of COLOUR_KEYS) state[k] = new THREE.Color(P[k]);
  for (const k of NUMBER_KEYS) state[k] = P[k] ?? 0;
  return state;
}

const _from = {};
const _to = {};

/**
 * Interpolate `state` from palette `P` toward its dawn values.
 *
 * @param {object} state  from makePaletteState, mutated in place
 * @param {object} P      the base palette
 * @param {number} t      0 = night, 1 = fully broken dawn
 */
export function applyDawn(state, P, t) {
  const d = P.dawn ?? {};
  for (const k of COLOUR_KEYS) {
    if (!(k in _from)) {
      _from[k] = new THREE.Color();
      _to[k] = new THREE.Color();
    }
    _from[k].set(P[k]);
    _to[k].set(d[k] ?? P[k]);
    state[k].copy(_from[k]).lerp(_to[k], t);
  }
  for (const k of NUMBER_KEYS) {
    const a = P[k] ?? 0;
    const b = d[k] ?? a;
    state[k] = a + (b - a) * t;
  }
  return state;
}
