/**
 * Base relief at a point on the unit sphere, in the range about -1 to 1.
 *
 * A sum of sines, not real noise. It is cheap, it is smooth, it is seamless on
 * a sphere by construction — no wrapping seam to hide — and it costs no
 * dependency. Swap in simplex noise if the shapes ever start to look
 * repetitive; nothing else needs to change.
 *
 * This lives in its own module so that terrain-features.js can measure the
 * ground a landform is standing on without importing geometry.js, which
 * imports terrain-features.js right back. It is the rolling ground and nothing
 * else — the ridges are a separate term, added in groundRadius().
 */
export function terrain(nx, ny, nz) {
  return (
    Math.sin(nx * 3.1 + 1.7) * Math.sin(ny * 2.7 + 0.4) * Math.sin(nz * 3.3 + 2.1) * 0.7 +
    Math.sin(nx * 7.3) * Math.sin(ny * 6.1) * Math.sin(nz * 7.7) * 0.3
  );
}
