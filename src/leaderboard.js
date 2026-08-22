/**
 * The leaderboard.
 *
 * Two backends behind one interface. With no credentials filled in below it
 * keeps scores in localStorage, which works offline, needs no account and is
 * honest about being your own times only. Fill in the two values and the same
 * calls go to Supabase and the board becomes everybody's.
 *
 * Written this way because the credentials are not mine to create. Nothing
 * here needs to change to go live; see CONFIG.
 */

/*
 * To make this global:
 *
 *   1. Create a free project at supabase.com.
 *   2. Run this in its SQL editor:
 *
 *        create table public.scores (
 *          id         bigint generated always as identity primary key,
 *          name       text not null check (char_length(name) between 1 and 18),
 *          place      text not null default '' check (char_length(place) <= 20),
 *          secs       double precision not null check (secs > 0 and secs < 3600),
 *          crystals   int  not null default 0 check (crystals between 0 and 64),
 *          created_at timestamptz not null default now()
 *        );
 *
 *        create index scores_secs_idx on public.scores (secs asc);
 *
 *        alter table public.scores enable row level security;
 *        create policy "anyone may read"   on public.scores for select using (true);
 *        create policy "anyone may insert" on public.scores for insert with check (true);
 *
 *        -- Supabase's default privileges usually cover this already; harmless
 *        -- to state, and the difference between a working board and a 401 if
 *        -- they were ever changed.
 *        grant select, insert on table public.scores to anon;
 *
 *   3. Paste the project URL and the *anon* key below. The anon key is meant to
 *      be public and is safe in client source; the service key is not, and must
 *      never go in here.
 *
 * The insert policy is deliberately open, which means a determined person can
 * post a fake time. That is the trade for having no accounts and no login on a
 * piece that should be playable in ten seconds. The checks above bound what can
 * be written; the sanitising below bounds what it can say.
 */
export const CONFIG = {
  url: "https://weubrhoslqpxzognwefb.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldWJyaG9zbHFweHpvZ253ZWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTU2MTMsImV4cCI6MjEwMjk5MTYxM30.HEPF8Z4_ZEbTc_F2ClTclONrQ8VHRrKcZf-dkHFHxBs",
  table: "scores",
};

/**
 * Where the last read actually came from.
 *
 * Configured is not the same as reachable. The table can be missing, the
 * project can be paused, the player can be on a train. The board says which of
 * its two lives it is currently leading, because a stone reading "everyone who
 * has played" while showing one person's times would be a lie carved three
 * metres tall.
 */
let source = isRemote() ? "remote" : "local";

export function lastSource() {
  return source;
}

export function isRemote() {
  return Boolean(CONFIG.url && CONFIG.anonKey);
}

/**
 * The fastest a run could physically be.
 *
 * Derived rather than guessed. The planet's circumference is about 188 units,
 * the four monuments sit roughly a quarter of the way round from each other,
 * and the shortest tour of them is on the order of 150 units of ground. At
 * MAX_SPEED that is around eleven and a half seconds before you account for
 * getting up to speed, the terrain, or the ridges now lying across every
 * route. Nine leaves room for a better line than I can imagine and still
 * refuses the 0.01s that an earlier version of this check waved through.
 *
 * It bounds nonsense; it does not stop a determined forgery, and nothing here
 * could — see the note on the insert policy above.
 */
const MIN_SECS = 9;

const KEY = "syzygy.board.v1";
const RATE_KEY = "syzygy.board.last";

/** Nothing longer than this reaches storage, whichever backend is in use. */
export const NAME_MAX = 18;
export const PLACE_MAX = 20;

/**
 * A small blocklist.
 *
 * Not exhaustive and cannot be — this exists to stop the laziest abuse from
 * rendering three metres tall on a stranger's portfolio, not to solve
 * moderation. The allowlist in `tidy` does most of the work by refusing
 * anything that is not a letter, a digit or ordinary punctuation.
 */
const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "bastard", "dick", "cock", "wank",
  "nigg", "fag", "retard", "rape", "nazi", "hitler", "slut", "whore",
];

/**
 * Strip anything that is not plain text and collapse the whitespace.
 *
 * An allowlist rather than a blocklist of characters: zero-width joiners,
 * combining marks and right-to-left overrides are all ways to make a short
 * string do things a canvas will faithfully draw.
 */
function tidy(s, max) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} '.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** True if the text reads as something that should not be on a portfolio. */
export function isBlocked(s) {
  const flat = String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z]/g, "");
  return BLOCKED.some((w) => flat.includes(w));
}

export function cleanName(s) {
  return tidy(s, NAME_MAX);
}

export function cleanPlace(s) {
  return tidy(s, PLACE_MAX);
}

/**
 * Validate an entry the way both backends need it.
 * Returns `{ ok: true, entry }` or `{ ok: false, why }`.
 */
export function check({ name, place, secs, crystals }) {
  const n = cleanName(name);
  const p = cleanPlace(place);
  if (n.length < 1) return { ok: false, why: "Needs a name." };
  if (isBlocked(n) || isBlocked(p)) return { ok: false, why: "Pick something else." };
  if (!Number.isFinite(secs) || secs < MIN_SECS || secs >= 3600) {
    return { ok: false, why: "That time cannot be right." };
  }
  const last = Number(localStorage.getItem(RATE_KEY) || 0);
  if (Date.now() - last < 20000) return { ok: false, why: "Give it a moment." };
  return {
    ok: true,
    entry: {
      name: n,
      place: p,
      secs: Math.round(secs * 100) / 100,
      crystals: Math.max(0, Math.min(64, Math.round(crystals || 0))),
    },
  };
}

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveLocal(entry) {
  const all = readLocal();
  all.push({ ...entry, at: Date.now() });
  all.sort((a, b) => a.secs - b.secs);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
}

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: CONFIG.anonKey,
    Authorization: `Bearer ${CONFIG.anonKey}`,
  };
}

/**
 * Post a score. Resolves to `{ ok, why }`; never throws, because a leaderboard
 * that breaks the end of a run is worse than no leaderboard.
 */
export async function submitScore(raw) {
  const v = check(raw);
  if (!v.ok) return v;
  const entry = v.entry;
  localStorage.setItem(RATE_KEY, String(Date.now()));

  if (!isRemote()) {
    saveLocal(entry);
    return { ok: true, local: true };
  }

  try {
    const res = await fetch(`${CONFIG.url}/rest/v1/${CONFIG.table}`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(String(res.status));
    source = "remote";
    return { ok: true };
  } catch {
    /*
     * Keep the run rather than lose it.
     *
     * Somebody has just finished a ninety second piece and typed their name;
     * telling them the network ate it and offering nothing is the worst
     * possible end. It goes on the local board instead and the caller is told
     * plainly which board that was, so nothing pretends otherwise.
     */
    saveLocal(entry);
    source = "local";
    return { ok: true, local: true };
  }
}

/**
 * The fastest `n`. Resolves to an array, empty if there is nothing or if the
 * network is unavailable — the caller draws a board either way.
 */
export async function topScores(n = 10) {
  if (!isRemote()) {
    source = "local";
    return readLocal().slice(0, n);
  }
  try {
    const q = `select=name,place,secs,crystals&order=secs.asc&limit=${n}`;
    const res = await fetch(`${CONFIG.url}/rest/v1/${CONFIG.table}?${q}`, { headers: headers() });
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("shape");
    source = "remote";
    return rows;
  } catch {
    // Unreachable, missing table, paused project, no signal. Fall back rather
    // than showing an empty stone — a local board is worth more than a dead
    // one, and lastSource() makes sure it does not claim to be the other kind.
    source = "local";
    return readLocal().slice(0, n);
  }
}
