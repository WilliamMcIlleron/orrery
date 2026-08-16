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
 */
export const JUMP_SPEED = 19;

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
