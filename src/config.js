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
 */
export const RELIEF = 0.6;

/**
 * Collision radius. Sits at the midpoint of the relief, so peaks poke through
 * the marble by at most RELIEF/2 and valleys read as filled.
 *
 * The mesh is displaced but the collider is a perfect sphere. At this
 * amplitude against a 0.85 marble the mismatch is invisible. Real heightfield
 * collision is a later problem and probably never worth it.
 */
export const R_COL = R + RELIEF * 0.5;

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
