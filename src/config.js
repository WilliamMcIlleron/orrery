/**
 * Every number worth arguing about, in one place.
 *
 * These are tuned, not guessed. Where a value has a reason, the reason is
 * written down — otherwise the next person to touch it (you, in a month)
 * has to rediscover it by breaking things.
 */

/** Planet radius, in world units. */
export const R = 30;

/** Marble radius. The ratio of R to BALL_R is what makes the world feel small. */
export const BALL_R = 0.85;

/**
 * Vertical displacement applied to the planet mesh, plus and minus.
 *
 * Relief matters more than it looks like it should: on a perfectly smooth
 * sphere you cannot perceive your own speed, because nothing passes you.
 *
 * This was 0.6 while the collider was a fixed sphere, because anything larger
 * made the marble visibly hover over hollows. Collision now follows the
 * terrain exactly, so the hills can be hills — a little over three marble
 * diameters from trough to crest, on wavelengths long enough to roll rather
 * than rattle.
 */
export const RELIEF = 1.5;

/**
 * Spawn radius only.
 *
 * The collider used to be a fixed sphere at the midpoint of the relief, which
 * meant the marble floated above every hollow and rolled straight through
 * every rise. Ground contact is now evaluated analytically per step — see
 * groundRadius() and groundNormal() in geometry.js — and this constant
 * survives purely to drop the marble in from above at startup.
 */
export const R_COL = R + RELIEF;

/** Constant, not inverse-square. On a world this small the falloff would be noise. */
export const GRAVITY = 55;

export const ACCEL = 30;

/** Deliberately weak: losing control mid-air is what makes hitting a ramp mean something. */
export const AIR_ACCEL = 10;

export const DRAG = 0.22;
export const ROLL_FRIC = 1.9;
export const BOUNCE = 0.3;

/**
 * At 26 you circle the planet in about 7 seconds and it reads as a marble
 * rattling in a bowl. At 13 it takes about 14 seconds, which is the
 * difference between a toy and a place.
 */
export const MAX_SPEED = 13;

/**
 * Ceiling on the component of velocity away from the planet, both ways.
 *
 * Not a design value — a tunnelling backstop. The collider is a penetration
 * test, so anything that covers more than a marble radius between fixed steps
 * can pass straight through geometry. At DT this is 0.28 units a step against
 * a marble radius of 0.85, so it never fires in normal play; it exists for the
 * case where a boulder launch and a fall compound.
 *
 * Comfortably above JUMP_SPEED, so it never touches the arc of a jump.
 */
export const VERT_MAX = 34;

/** Chase camera. */
export const FOV_BASE = 62;

/** Degrees of extra field of view at full speed. Subtle on purpose. */
export const FOV_KICK = 9;

export const CAM_BACK = 8.5;
export const CAM_UP = 3.6;
export const CAM_LAG = 6.0;
export const HEAD_LAG = 3.2;

/**
 * Fixed simulation step. The marble is small and fast relative to its own
 * radius, so a 1/60 step lets it tunnel through thin geometry at speed.
 */
export const DT = 1 / 120;

/**
 * Seconds the simulation freezes on a heavy impact.
 *
 * Rendering keeps going, so this is weight rather than a stall. Much past
 * 0.12 and it stops reading as impact and starts reading as a dropped frame.
 */
export const HIT_STOP = 0.09;

/** Hard cap on catch-up steps, so a backgrounded tab cannot spiral. */
export const MAX_STEPS = 12;

/** Seed for world generation. Changing it changes the planet. */
export const WORLD_SEED = 20260816;

/** How close you must be for a monument's label to appear. */
export const LABEL_RANGE = 15;

/**
 * How close counts as reaching a monument.
 *
 * Physical contact happens at 2.0 (pillar radius 1.15 plus marble 0.85), and
 * requiring that made lighting one a precision task: you had to drive into a
 * post, and glancing past at speed did nothing.
 *
 * It is now a generous zone drawn on the ground, so the target is the circle
 * you can see rather than the pillar you have to hit. Rolling anywhere near
 * counts, which is what the piece actually wants — reaching it is the point,
 * not aiming at it.
 */
export const TOUCH_RANGE = 5.2;

/**
 * Jump.
 *
 * The single biggest thing traversal was missing. Rolling was the only verb;
 * now the terrain and the rocks are things you can clear, and hitting a
 * boulder at speed launches you instead of just stopping you.
 *
 * This read 19 while the speed cap still clamped the whole velocity vector,
 * which meant it was never worth 19: the clamp cut it to 13 standing still and
 * to 11 at full roll. Now that the cap applies to ground speed only, the
 * number is honest and the arc no longer changes shape with your speed.
 *
 * 16 puts the apex 2.33 units up with 0.58s of air, against a relief of 1.5
 * and a marble radius of 0.85 — it clears a crest with room, and at full speed
 * carries you about 7 units. Straight to 19 unthrottled would have been 3.28
 * up and floaty on a planet this small.
 */
export const JUMP_SPEED = 16;

/**
 * Grace period after leaving the ground where a jump still counts.
 *
 * Standard platformer courtesy. Without it, jumping off the crest of a rise
 * fails about a third of the time and feels like the game ignoring you.
 */
export const COYOTE_TIME = 0.11;

/** Seconds for a monument's light to rise once touched. */
export const LIGHT_RISE = 0.8;

/** Beat between the last monument lighting and the sky beginning to move. */
export const DAWN_HOLD = 0.9;

/** Seconds for dawn to break fully. */
export const DAWN_SECONDS = 7;

/**
 * Seconds without lighting a monument before the wayfinder arrow appears.
 *
 * Long enough that exploring on your own comes first and the arrow feels like
 * help rather than instruction. Resets every time one lights.
 */
export const WAYFINDER_DELAY = 11;

/**
 * Icosphere subdivision for the planet.
 *
 * PolyhedronGeometry cuts each of the twenty base faces into (detail+1)^2
 * triangles, so this is quadratic and not exponential: 4 gives 500 triangles,
 * 10 gives 2420. Vertex count is what the AO bake pays for and neither number
 * is close to mattering.
 *
 * What it actually controls is the size of a facet against the size of the
 * marble, which is the whole low-poly look. Too coarse and relief reads as
 * flat panels rather than as landforms.
 */
export const PLANET_DETAIL = 12;

/*
 * Was 8, which put a facet at 4.0 units — two and a half marble diameters, and
 * wider than a ridge. The landforms in terrain-features.js are collided with
 * analytically and drawn from this mesh, so a facet wider than a feature means
 * driving into a wall the renderer never showed you. 12 puts a facet at 2.8
 * units, so a ridge spans three of them and reads as a landform while the
 * ground still reads as folded paper. 3380 triangles against 1620.
 */
/*
 * 8, chosen by looking at 4, 8, 12 and 16 side by side under raking light,
 * which is the only condition where facet size actually shows.
 *
 * At 4 the ground is 500 triangles and a single facet covers a third of the
 * screen — relief reads as flat panels rather than as landforms, and it is
 * most of what made the piece look like a test build. At 12 and above the
 * ground goes smooth while the rocks stay chunky, so the two stop belonging to
 * the same world. 8 is the point where the horizon is a curve, the terrain
 * undulates, and a facet is still about the size of a facet on a boulder.
 */

/**
 * The direction the sunlight comes from, as a unit vector.
 *
 * Lives here because two things need to agree about it: the light itself, and
 * the placement of the bodies in the sky, which are positioned by how lit they
 * should look rather than by eye.
 */
export const SUN_DIR = Object.freeze({ x: 0.5569, y: 0.7425, z: 0.3713 });

/*
 * Flow.
 *
 * The piece had no way to fail. You could not lose progress, lose a resource
 * or die, so the optimal play was to hold full speed at everything and take
 * the crashes — they cost a second and nothing else. Until that was false
 * there was a ceiling on how much any amount of terrain could add.
 *
 * Flow is the thing there is to lose. Keep moving fast and it builds; rolling
 * resistance drops as it does, so you hold speed through climbs, turns and
 * landings that would otherwise bleed it, and the marble's own lamp brightens
 * with it. Hit something hard enough to destroy your ground speed and all of
 * it goes at once.
 *
 * It deliberately does not touch MAX_SPEED. The ridge crest was calibrated
 * against that number — 2.0 is the lowest wall a rolling marble cannot climb —
 * and a flow bonus that raised top speed would quietly uncalibrate every
 * obstacle in the world.
 */

/** Fraction of MAX_SPEED you must exceed for flow to build at all. */
export const FLOW_MIN = 0.55;

/** Seconds at speed to reach full flow, and seconds below the line to lose it. */
export const FLOW_RISE = 2.6;
export const FLOW_FALL = 1.4;

/**
 * Ground speed lost in a single fixed step that counts as a crash.
 *
 * Measured against the two things it has to tell apart. Rolling friction takes
 * about 0.02 a step, and landing from a jump barely touches ground speed at
 * all — that is the whole point of the jump fix. Driving into a ridge takes
 * most of ten units in one step. 3.0 sits in the empty space between them.
 *
 * Thresholding on raw impact instead would break flow on every landing, which
 * would punish the exact skill the ridges exist to reward.
 */
export const FLOW_BREAK = 3.0;

/** How much of the rolling friction and drag full flow removes. */
export const FLOW_GRIP = 0.55;
export const FLOW_DRAG = 0.5;

/**
 * How much brighter the marble's own lamp burns at full flow.
 *
 * The mechanic is invisible otherwise. Rolling resistance is a number you feel
 * only in aggregate, so the meter needs a read you cannot miss, and a marble
 * that is literally the light source in a dark world already has one. Kept
 * this side of doubling — the marble under its own lamp is the brightest thing
 * on screen and bloom will happily turn it into a fireball.
 */
export const FLOW_LAMP = 0.9;
