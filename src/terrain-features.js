import * as THREE from "three";
import { R, RELIEF } from "./config.js";
import { terrain } from "./relief.js";
import { CONTENT } from "./content.js";

/**
 * The landforms that make traversal a skill instead of a distance.
 *
 * The piece had a jump and nothing to jump over. Rolling from one monument to
 * the next was a straight line at the speed cap with no decision in it, which
 * is most of why the world read as scenery rather than as a place.
 *
 * So every route between two monuments now has a ridge lying across it and a
 * ramp on the approach. Hit the ramp carrying speed and you clear the ridge
 * and keep it. Arrive slow, or miss the line, and you go around — which costs
 * you time and nothing else. Nothing here is a wall you can fail at
 * permanently; the planet is a sphere and every monument stays reachable by
 * simply going the long way. The ridge sells a fast line, it does not gate one.
 *
 * These are height-field features, evaluated analytically like the base
 * relief. That is the whole reason this was affordable: collision already
 * follows groundRadius() exactly, so a landform defined here is a landform the
 * marble collides with, with no mesh to keep in sync and no collider to build.
 */

/** Unit vector from latitude and longitude in degrees. */
function dirOf(latDeg, lonDeg) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(la) * Math.cos(lo),
    Math.sin(la),
    Math.cos(la) * Math.sin(lo),
  );
}

/** Unit tangent at `from`, pointing along the great circle towards `to`. */
function tangentOf(from, to) {
  const t = to.clone().addScaledVector(from, -to.dot(from));
  return t.normalize();
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/*
 * Where the routes are.
 *
 * Monuments are spread by longitude so that no two are visible at once, which
 * means the natural path between consecutive ones runs roughly east. A ridge
 * therefore runs north-south to lie across that path, and the ramp sits west
 * of it pointing east.
 *
 * Read from CONTENT rather than written out, so adding a project adds a route
 * and its landform instead of silently leaving a bare stretch of planet.
 */
const ROUTES = CONTENT.map((item, i) => {
  const next = CONTENT[(i + 1) % CONTENT.length];
  let lon = item.lon;
  let span = next.lon - lon;
  // Longitudes wrap, and the short way round is the one you would actually
  // drive. Without this the last route (310 to 35) computes as a 275 degree
  // journey westward and puts its landform on the wrong side of the planet.
  if (span > 180) span -= 360;
  if (span < -180) span += 360;
  return {
    lat: (item.lat + next.lat) * 0.5,
    lon: lon + span * 0.5,
    // Which way you are travelling, so the ramp faces the right way.
    east: span >= 0,
  };
});

/**
 * Feature table.
 *
 * `H` and the widths are in world units, not angles — a landform should be a
 * fixed size against the marble, and converting through R at evaluation time
 * keeps every number here readable as "units of ground".
 */
const FEATURES = [];

/*
 * Why there are no ramps here.
 *
 * There were, and the arithmetic killed them. A marble at MAX_SPEED carries
 * v^2/2g = 169/110 = 1.54 units of climb, total, and that is the entire
 * height budget this world has. A launch ramp needs to be tall enough to have
 * a steep lip, and anything tall enough to launch from is taller than the
 * marble can get up — the first version was 4.2 units and the marble simply
 * stalled against it at 3.2 units short, every time, on every route.
 *
 * Even a ramp it *could* climb is a bad trade, because height is bought with
 * speed: 0.7 units of ramp costs a third of your velocity, and the shorter
 * air time that follows carries you less far than the flat jump you already
 * had. At this gravity a ramp is a brake with extra steps.
 *
 * So the jump is the only tool, and the obstacle is sized to it.
 */

/**
 * Ridge crest height, world units.
 *
 * Found by sweep, not by arithmetic. The ballistic budget says 1.54, but the
 * marble is under power the whole way up and ACCEL keeps doing work on the
 * climb, so the real ceiling is higher than energy alone predicts: measured,
 * 1.8 still rolls over and 2.0 stops it dead 3.5 units short. Above about 2.8
 * nothing clears it cleanly and the only "successes" are the collider popping
 * the marble out of the wall at 21 units a second, which is a bug being
 * exploited rather than a jump being made.
 *
 * 2.0 is the bottom of the window: the lowest wall that a rolling marble
 * cannot climb.
 */
const RIDGE_H = 2.0;

/**
 * Half-width, world units.
 *
 * A jump spends 0.33 seconds above 1.6 units, which at full speed is 4.2 units
 * of ground. The ridge profile is above 1.6 across 1.13 of its half-width, so
 * anything past 3.7 cannot be cleared however well it is timed. 3.2 leaves the
 * timing window real but not generous.
 */
const RIDGE_W = 3.2;

/**
 * How much of the crest the pass cuts away, when the pass is fully open.
 *
 * 0.55 leaves it at 0.9, under the 1.54 a rolling marble can climb, so an open
 * pass can be taken flat out without jumping at all.
 */
const NOTCH_CUT = 0.55;

for (const route of ROUTES) {
  const ridgeMid = dirOf(route.lat, route.lon);

  /*
   * The crest is an absolute radius, not a height added to whatever is
   * underneath.
   *
   * Added, it was inconsistent: the base relief swings 1.5 either way, so a
   * ridge sitting in a hollow with the approach on a rise is a shorter climb
   * than the number says. Measured, two of the four routes rolled straight
   * over an identical 2.0 while the other two blocked it dead.
   *
   * So the crest is fixed 2.0 above the ground *you are approaching from*, and
   * the profile fills whatever gap that leaves.
   *
   * Sampled per query rather than once per ridge, because a ridge is
   * thirty-four degrees of arc long and the relief under it swings the full
   * 1.5 across that span. Fixing the crest against a single approach point
   * left the two routes whose north end sits on a rise still rollable. The
   * approach is now measured nine units back along the route from whatever
   * point is being asked about, so the climb is the same wherever you meet it.
   */
  const ahead = tangentOf(ridgeMid, dirOf(route.lat, route.lon + (route.east ? 10 : -10)));
  const back = 9 / R;

  FEATURES.push({
    kind: "ridge",
    ahead,
    cosBack: Math.cos(back),
    sinBack: Math.sin(back),
    a: dirOf(route.lat - 17, route.lon),
    b: dirOf(route.lat + 17, route.lon),
    mid: ridgeMid,
    H: RIDGE_H,
    wide: RIDGE_W,

    /*
     * The pass.
     *
     * A wall with no way through is a wall you resent. One point along each
     * ridge is cut down to 0.86 — under the 1.54 climb budget, so you can roll
     * it at speed without jumping at all.
     *
     * It sits at 0.3 along the ridge rather than at the middle, so it is never
     * on the line you were already driving. That is the whole decision the
     * feature exists to create: jump the wall where you meet it, or give up
     * the straight line and go through the pass.
     */
    notchAt: 0.3,
    notchWide: 0.16,
    notchCut: NOTCH_CUT,

    // Cheap reject: skip unless the point is within this angle of the
    // midpoint. Evaluated 120 times a second plus once per vertex.
    reach: Math.cos(Math.min(Math.PI, (17 * Math.PI) / 180 + (RIDGE_W + 1) / R)),
  });
}

/**
 * Height added by the landforms, in world units, at a point on the unit
 * sphere. Zero across most of the planet.
 */
export function featureHeight(nx, ny, nz) {
  let h = 0;
  for (let i = 0; i < FEATURES.length; i++) {
    const F = FEATURES[i];
    if (nx * F.mid.x + ny * F.mid.y + nz * F.mid.z < F.reach) continue;

    _p.set(nx, ny, nz);
    const t = closestOnArc(F.a, F.b, _p, _q);
    const d = Math.acos(Math.min(1, Math.max(-1, _p.dot(_q)))) * R;
    if (d > F.wide) continue;

    // Along the ridge: the pass, which lowers the crest rather than scaling
    // the fill, so the pass is a fixed height above the ground and not a
    // fraction of however deep the hollow under it happens to be.
    const nd = t < F.notchAt ? F.notchAt - t : t - F.notchAt;
    const drop = F.H * F.notchCut * (1 - smoothstep(F.notchWide * 0.5, F.notchWide, nd));

    // The ground this stretch of ridge is approached from, nine units back
    // along the route, and the crest measured against it.
    _a.copy(_p)
      .multiplyScalar(F.cosBack)
      .addScaledVector(F.ahead, -F.sinBack)
      .normalize();
    //
    // Measured against the higher of the approach and the ground directly
    // underneath. Against the approach alone the ridge could be erased: the
    // base relief swings three units peak to trough, so a ridge line sitting
    // on a rise more than F.H above the ground you come from wants a negative
    // fill and simply stops existing. That is exactly what happened on the
    // fourth route, which cost a rolling marble 0.1 seconds while the other
    // three stopped it dead.
    const hereT = terrain(nx, ny, nz);
    const awayT = terrain(_a.x, _a.y, _a.z);
    const crest = R + (awayT > hereT ? awayT : hereT) * RELIEF + F.H - drop;

    const want = crest - (R + hereT * RELIEF);
    if (want <= 0) continue;

    // Across the ridge: full fill in the middle, falling to nothing at the
    // flanks. The inner plateau is deliberate — a purely smooth bump has no
    // crest to time a jump against.
    h += want * (1 - smoothstep(F.wide * 0.42, F.wide, d));
  }
  return h;
}

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _q = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();

/**
 * Closest unit direction on the great-circle segment ab to the direction p.
 *
 * Done as a chord segment and renormalised rather than with real spherical
 * geometry. Over the seventeen degrees a ridge spans, the chord and the arc
 * differ by less than the width of the ridge's own falloff.
 */
function closestOnArc(a, b, p, out) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  if (len2 < 1e-9) { out.copy(a); return 0; }
  let t = _rel.subVectors(p, a).dot(_seg) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.copy(a).addScaledVector(_seg, t).normalize();
  // Returns how far along the ridge the closest point sits, 0 to 1, because
  // the pass is placed in that coordinate.
  return t;
}

/** Exported for the tests and for anything that wants to draw the routes. */
export { FEATURES, ROUTES };

/**
 * Close a pass, or reopen it.
 *
 * The planet is supposed to answer for itself as you light it. Lighting the
 * monument at the start of a route seals the pass on the route leading out of
 * it, so the way ahead is a wall where the way in was a gap: the first
 * crossing can be rolled, the last has to be jumped, and the difference is
 * something you watch the ground do rather than something a caption tells you.
 *
 * `open` is 1 for a gap and 0 for solid wall, and everything between is a
 * frame of the pass filling in. Callers animate it. Anything that reads
 * groundRadius() after this sees the new ground immediately — including the
 * collider, which is the point — so the mesh has to be rebuilt in the same
 * breath or the marble starts hitting geometry that is not drawn.
 */
export function setPassOpen(routeIndex, open) {
  const F = FEATURES[routeIndex];
  if (!F) return;
  F.notchCut = NOTCH_CUT * Math.min(1, Math.max(0, open));
}

/**
 * Unit direction of a route's pass.
 *
 * Callers need it to know which patch of ground moved when the pass seals, so
 * the mesh rebuild can touch that patch and leave the rest of the planet
 * alone.
 */
export function passDirection(routeIndex, out = new THREE.Vector3()) {
  const F = FEATURES[routeIndex];
  if (!F) return out.set(0, 1, 0);
  return out.copy(F.a).lerp(F.b, F.notchAt).normalize();
}

/**
 * World-unit distance from a direction to the nearest ridge body.
 *
 * Negative inside a ridge, positive outside it, measured to where the crest
 * profile has fallen to nothing. Placement uses it to keep things from
 * standing a hair's breadth off a wall: a boulder that leaves 1.65 units
 * between itself and a cliff has made a gap the marble cannot fit through and
 * cannot see is too small, which is exactly the shape of a place you drive at
 * twice and then give up on.
 */
export function distanceToRidge(nx, ny, nz) {
  let best = Infinity;
  for (let i = 0; i < FEATURES.length; i++) {
    const F = FEATURES[i];
    _p.set(nx, ny, nz);
    closestOnArc(F.a, F.b, _p, _q);
    const dot = Math.min(1, Math.max(-1, _p.dot(_q)));
    best = Math.min(best, Math.acos(dot) * R - F.wide);
  }
  return best;
}
