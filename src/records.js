/**
 * The best time, and the fact that there is one.
 *
 * The piece had no challenge in it. You found four monuments, dawn broke, and
 * the run time appeared once at the end as a fact about what had happened
 * rather than as anything you could do something about.
 *
 * A time trial is the obvious answer and it is also the honest one: the planet
 * is fourteen seconds around and there are four points on it, so choosing a
 * route is already an optimisation problem — it just was not worth solving,
 * because nothing was counting. Nothing else needs to be added to make it a
 * game. It only needs to be measured.
 *
 * Two deliberate restraints:
 *
 * The clock does not run on a first visit. Someone who has never seen this
 * should get to wander, find things, and be surprised by dawn, and a timer
 * ticking in the corner turns all of that into a task. It appears from the
 * second run onward — once you have a best, you have something to beat, and
 * that is the point at which a clock is an invitation rather than a demand.
 *
 * There is no fail state, no par time and nothing you can lose. The clock is a
 * reason to go round again, not a hurdle in front of the thing you came for.
 */

const KEY = "orrery.best.v1";

/** @returns {number|null} best time in seconds, or null if there is none. */
export function readBest() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    // Private mode. The session still works; it just will not remember.
    return null;
  }
}

/**
 * Record a finished run.
 *
 * @param {number} secs
 * @returns {{best: number, improved: boolean}}
 */
export function submit(secs) {
  const prev = readBest();
  const improved = prev === null || secs < prev;
  if (improved) {
    try {
      localStorage.setItem(KEY, String(secs));
    } catch { /* private mode; the run still counted, it just will not persist */ }
  }
  return { best: improved ? secs : prev, improved };
}

/** mm:ss.t for anything over a minute, plain seconds below it. */
export function formatTime(secs) {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
