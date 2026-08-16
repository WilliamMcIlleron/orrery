/**
 * Palettes.
 *
 * These are not four coats of paint on the same thing. Two of them
 * (playground, riso) are lit worlds with no night side, which means the
 * travelling lamp and the whole "roll into the dark" feeling do not exist in
 * them. The other two keep both.
 *
 * A palette here is partly a mechanic decision wearing a colour decision's
 * clothes. Read `lamp` as "does this world have a dark half".
 */

export const PALETTES = {
  playground: {
    name: "Playground",
    note: "daylit · no night side",
    bg: 0x9fd8e8,
    fogNear: 70,
    fogFar: 190,
    ground: 0x8ecf7a,
    rock: 0xb9895e,
    monument: 0xf4f1e8,
    marble: 0xffffff,
    accents: [0xff6b4a, 0xffc23d, 0x4aa3e8, 0x9b6bd6],
    hemiSky: 0xcdeeff,
    hemiGround: 0x6fae7a,
    hemiInt: 2.5,
    sun: 0xfff6e0,
    sunInt: 2.4,
    lamp: false,
    stars: 0,
    exposure: 1.05,
    band: 0x6fae7a,
    bandOp: 0.25,
  },

  deepfield: {
    name: "Deep field",
    note: "void · night side + travelling lamp",
    bg: 0x05070e,
    fogNear: 55,
    fogFar: 150,
    ground: 0x53706a,
    rock: 0x5b6675,
    monument: 0x39414d,
    marble: 0xf2f6ff,
    accents: [0xffb03a, 0x5fb8ff, 0x66e0a8, 0xff7aa8],
    hemiSky: 0x8fa8cc,
    hemiGround: 0x1c222c,
    hemiInt: 1.4,
    sun: 0xdce8ff,
    sunInt: 2.0,
    lamp: 0xcfe0ff,
    stars: 0.75,
    exposure: 1.35,
    band: 0x5f7a6d,
    bandOp: 0.3,
  },

  dusk: {
    name: "Dusk",
    note: "warm terracotta · keeps night side",
    bg: 0x140f1c,
    fogNear: 55,
    fogFar: 150,
    ground: 0xc07a56,
    rock: 0x8f5a46,
    monument: 0x4a3830,
    marble: 0xfff0e0,
    accents: [0x4ecdc4, 0xffd166, 0xef476f, 0x8ecae6],
    hemiSky: 0xffb37a,
    hemiGround: 0x2a1a20,
    hemiInt: 1.5,
    sun: 0xffa961,
    sunInt: 2.8,
    lamp: 0xffd9b0,
    stars: 0.45,
    exposure: 1.3,
    band: 0xffb37a,
    bandOp: 0.22,
  },

  riso: {
    name: "Riso",
    note: "flat print · no night side",
    bg: 0xf2ede1,
    fogNear: 80,
    fogFar: 210,
    ground: 0xdcd2bd,
    rock: 0xbdb198,
    monument: 0x2f2b26,
    marble: 0x2f2b26,
    accents: [0xe0503a, 0x2f5d7c, 0x3f7d5c, 0xd9a520],
    hemiSky: 0xffffff,
    hemiGround: 0xd8cfbc,
    hemiInt: 2.7,
    sun: 0xffffff,
    sunInt: 1.5,
    lamp: false,
    stars: 0,
    exposure: 1.0,
    band: 0x9a8f78,
    bandOp: 0.35,
  },
};

export const DEFAULT_PALETTE = "deepfield";

/** Reads the palette key from the URL hash, falling back to the default. */
export function resolvePaletteKey(hash = location.hash) {
  const key = hash.replace(/^#/, "");
  return key in PALETTES ? key : DEFAULT_PALETTE;
}
