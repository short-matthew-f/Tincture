// limits.js — Responsibility mode (pure; takes `now`, never reads the clock).
// Implements docs/DESIGN.md "Responsibility mode": a player-requested, player-
// controlled wellbeing limit. Each subgame can be started `limit` times within a
// rolling window; then it rests until the oldest play in the window ages out.
// It is ON by default (settings.responsibleMode), and turning it off removes
// every limit at once. This is the one sanctioned exception to "no energy, no
// countdowns": it protects her time, never sells it back, never shows a ticking
// clock (only the time it is ready again) and never takes anything away.
//
// State: state.plays = { [gameId]: [ms, ...] }, absolute timestamps of each
// start, pruned to the window whenever a start is recorded. A play is recorded
// when a NEW level / board / batch / wall / painting / basket / hoop / garden
// visit starts. Resuming, Undo, Start over and Back to solvable never count and
// are never blocked; each subgame's sim decides which of its starts are new
// (see `inProgress` and the start functions that call `gate`).
// Timestamps from the future (the device clock went back) are dropped.

/** The limited subgames, by id (ids used in state.plays). */
export const LIMIT_GAMES = Object.freeze(['grading', 'purify', 'tiles', 'skeins', 'lift', 'garden', 'tangle', 'hoop']);

/** Names as they read in a sentence ("Time for a rest from the Hoop"). */
export const GAME_NAMES = Object.freeze({
  grading: 'grading boards',
  purify: 'Purify',
  tiles: 'the Tile Room',
  skeins: 'the Winding Room',
  lift: 'the Lifting Table',
  garden: 'the Dye Garden',
  tangle: 'the Tangle Basket',
  hoop: 'the Hoop',
});

/** Settings choices: plays per game, and the window in minutes. */
export const PLAY_LIMITS = Object.freeze([3, 5, 8, 10]);
export const PLAY_WINDOWS_MIN = Object.freeze([30, 60, 120]);
export const DEFAULT_LIMIT = 5;
export const DEFAULT_WINDOW_MIN = 60;

const MIN = 60e3;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** config(state) -> {on, limit, windowMin, windowMs} from state.settings (defaults when missing). */
export function config(state) {
  const s = (state && isObj(state.settings)) ? state.settings : {};
  const on = s.responsibleMode !== false;
  const limit = PLAY_LIMITS.includes(s.playLimit) ? s.playLimit : DEFAULT_LIMIT;
  const windowMin = PLAY_WINDOWS_MIN.includes(s.playWindowMin) ? s.playWindowMin : DEFAULT_WINDOW_MIN;
  return { on, limit, windowMin, windowMs: windowMin * MIN };
}

/** The plays of `gameId` inside the window ending at `now`, oldest first (never mutates). */
export function playsIn(state, gameId, now) {
  const { windowMs } = config(state);
  const raw = state && isObj(state.plays) && Array.isArray(state.plays[gameId]) ? state.plays[gameId] : [];
  return raw.filter((t) => fin(t) && t <= now && t > now - windowMs).sort((a, b) => a - b);
}

/** prune(state, now) -> state: keeps only in-window, not-from-the-future timestamps; drops empty games. */
export function prune(state, now) {
  if (!state) return state;
  if (!isObj(state.plays)) { state.plays = {}; return state; }
  for (const id of Object.keys(state.plays)) {
    const kept = playsIn(state, id, now);
    if (kept.length) state.plays[id] = kept;
    else delete state.plays[id];
  }
  return state;
}

/** canStart(state, gameId, now) -> true when a new play may start (always, with the mode off). */
export function canStart(state, gameId, now) {
  const c = config(state);
  if (!c.on) return true;
  return playsIn(state, gameId, now).length < c.limit;
}

/** playsLeft(state, gameId, now) -> plays left in the window (Infinity with the mode off). */
export function playsLeft(state, gameId, now) {
  const c = config(state);
  if (!c.on) return Infinity;
  return Math.max(0, c.limit - playsIn(state, gameId, now).length);
}

/**
 * readyAt(state, gameId, now) -> ms | null. When the oldest play in the window
 * ages out (with the limit reached, the moment a play is free again: if the
 * limit was lowered below the plays already made, the one that brings her back
 * under it). null with the mode off or no plays in the window.
 */
export function readyAt(state, gameId, now) {
  const c = config(state);
  if (!c.on) return null;
  const list = playsIn(state, gameId, now);
  if (!list.length) return null;
  const k = Math.max(0, list.length - c.limit);
  return list[k] + c.windowMs;
}

/**
 * recordStart(state, gameId, now) -> {ok, counted}. Notes a new play (only while
 * the mode is on; plays made with it off are not kept) and prunes old ones.
 */
export function recordStart(state, gameId, now) {
  if (!LIMIT_GAMES.includes(gameId) || !fin(now)) return { ok: false, counted: false };
  if (!config(state).on) return { ok: true, counted: false };
  prune(state, now);
  if (!Array.isArray(state.plays[gameId])) state.plays[gameId] = [];
  state.plays[gameId].push(now);
  return { ok: true, counted: true };
}

/** The refusal every start function returns while a game rests. */
export function resting(state, gameId, now) {
  const c = config(state);
  return { ok: false, reason: 'resting', game: gameId, readyAt: readyAt(state, gameId, now), limit: c.limit, windowMin: c.windowMin };
}

/**
 * gate(state, gameId, now) -> null when the new play may start (and records it),
 * else the resting refusal. Subgame sims call this only for a NEW play.
 */
export function gate(state, gameId, now) {
  if (!canStart(state, gameId, now)) return resting(state, gameId, now);
  recordStart(state, gameId, now);
  return null;
}

/**
 * startPlay(state, {game, restart}, now) -> {ok:true, counted} | resting refusal.
 * The sim action for subgames whose boards are built outside src/sim (grading,
 * purify): `restart` (the same board or batch again) never counts.
 */
export function startPlay(state, args = {}, now = 0) {
  const id = args.game;
  if (!LIMIT_GAMES.includes(id)) return { ok: false, reason: 'game' };
  if (args.restart) return { ok: true, counted: false };
  const r = gate(state, id, now);
  return r || { ok: true, counted: config(state).on };
}

/** status(state, gameId, now) -> everything a screen shows about one game. */
export function status(state, gameId, now) {
  const c = config(state);
  const used = c.on ? playsIn(state, gameId, now).length : 0;
  const left = c.on ? Math.max(0, c.limit - used) : Infinity;
  return {
    on: c.on, limit: c.limit, windowMin: c.windowMin, windowMs: c.windowMs,
    used, left, resting: c.on && left <= 0, readyAt: readyAt(state, gameId, now),
    inProgress: inProgress(state, gameId),
  };
}

/**
 * inProgress(state, gameId) -> true when she has a play of this game to resume
 * (continuing is never blocked). Reads each subgame's saved shape.
 */
export function inProgress(state, gameId) {
  if (!state) return false;
  const a = isObj(state.activePuzzles) ? state.activePuzzles : {};
  const waiting = (o) => isObj(o) && Object.keys(o).length > 0;
  switch (gameId) {
    case 'grading': return !!a.grading;
    case 'purify': {
      const p = a.purify;
      return !!(p && (state.muddyBatches || []).some((b) => b && b.id === p.batchId));
    }
    case 'tiles': { const g = state.tiles && state.tiles.game; return !!(g && !g.over); }
    case 'skeins': {
      const k = state.skeins;
      if (!k) return false;
      return !!(k.sess && k.sess.state && !k.sess.state.done) || waiting(k.other);
    }
    case 'lift': { const g = state.lift && state.lift.game; return !!(g && !g.paid); }
    case 'garden': return !!(state.garden && state.garden.cur);
    case 'tangle':
    case 'hoop': {
      const t = state[gameId];
      if (!t) return false;
      return !!(t.game && !t.game.paid) || waiting(t.other);
    }
    default: return false;
  }
}
