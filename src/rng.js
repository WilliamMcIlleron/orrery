/**
 * Seeded random.
 *
 * The world has to be identical on every load. Math.random() would mean that
 * comparing two palettes compared two different planets, and that a bug you
 * saw once might never come back.
 */

/** mulberry32 — small, fast, good enough for scattering rocks. */
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
