// sim/hoop.js — The Hoop as sim actions on state (pure).
// The rules live in src/puzzles/hoop.js and the hoops in src/puzzles/
// hoop-levels.js (ported from proto/hoop/, where the playtested prototype, its
// generator and its surveys stay). This module owns the save shape, her yarn
// colors, the order the hoops open in, the moves of the hoop on the frame, the
// coins a cleared hoop pays, and the hooks for quests and events.
//
// state.hoop = {
//   cur: 'first',                // the hoop on the frame (a level id)
//   game: null | { level, sig, moves: ['3:7', '4:-1', ...], yarns: {m: colorId, ...}, paid },
//                                // her moves so far ("end:peg"; peg -1 lifts the
//                                // strand off); sig = the hoop's levelSig, so a
//                                // save from an older version of a hoop is set
//                                // aside instead of misread; yarns = her colors
//                                // for the hoop's color keys, fixed when it
//                                // starts; paid = this game has paid its finish
//                                // (undo, then finish again, never pays twice)
//   other: { [levelId]: Game },  // unfinished hoops she stepped away from (at most OTHER_MAX)
//   done: { first: 1 },          // times each hoop has been cleared
//   best: { first: 3 },          // her fewest moves on each hoop (the par star: best <= par)
//   seenIntro: { clasp: true },  // mechanics whose intro card she has seen
//   settings: { sound: true, glyphs: null, hooks: true },  // glyphs null follows settings.colorblind
//   paid: 0, finished: 0,        // coins every hoop has paid; hoops cleared (repeats too)
//   last: null | { levelId, coins, bonus, repeat, star, moves, par, optimal, at },
// }
//
// Hoops open in order: the first always, hoop i+1 once hoop i is cleared (any
// hoop already cleared stays open).
//
// A reload mid-hoop resumes exactly: every move is one act (saved at once), and
// the rules state is the replay of `moves` from the fresh hoop (the rules are
// deterministic). `current(state)` memoizes the replay, so a move is one rules
// step, not a replay, and undo is a step back through the same list.
//
// Yarns: the prototype's eight natural dyes (madder, weld, indigo, walnut,
// cochineal, nettle, logwood, onion skin) become her discovered colors, as the
// Tangle Basket does it: each key, in the order hoops bring colors in, takes
// her discovered color nearest that dye from a hue family not used yet; once
// her families run out, the color furthest from the ones chosen (the color
// symbols keep them apart too). A color too close to the linen in the hoop is
// never yarn. Catalog colors fill in only when she has fewer colors than keys.
//
// Coins (kept modest so hand orders stay the best coins per active minute; see
// tools/balance/TUNING.md "Tangle Basket", the same rule):
//   coins = hoopMinutes(L) × orderBasePay(state, 1) × incomeMultiplier, where
//     hoopMinutes(L) = max(MIN_MINUTES, RATE × estimated active minutes) and
//     the estimate is SEC_LOOK to take the hoop in plus SEC_PER_MOVE per move
//     of its par. RATE 1: one income-minute per active minute. A hoop cleared
//     again pays REPEAT_SHARE of that. The first time she clears a hoop at or
//     under par (the star), it adds STAR_SHARE of a first clear: at most 1.15
//     income-minutes per estimated minute, under the 1.2 ceiling.
//
// Hooks (only existing exports are called):
//   questEvent(state, 'hoopUntangled', 1, {levelId}) per cleared hoop
//   eventPoints(state, 'hoop', 1, {colors: [her yarn ids in it]}) per cleared hoop
// Domain event (bus): 'hoopUntangled' {levelId, coins, bonus, repeat, star, finished}.

import * as R from '../puzzles/hoop.js';
import { LEVELS, LEVEL_IDS, CHAPTERS, levelById, indexOf, chapterOf } from '../puzzles/hoop-levels.js';
import { emit } from './bus.js';
import { deltaEHex } from '../color.js';
import { colorFamily, colorHex, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { CATALOG } from '../content/catalog.js';
import { gate } from './limits.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Seconds of active play to take a hoop in, and per move of its par. */
export const SEC_LOOK = 15;
export const SEC_PER_MOVE = 6;
/** Income-minutes a hoop pays per estimated active minute (hand orders pay 2 to 4 per 30 to 60 s). */
export const RATE = 1;
/** The smallest hoop still pays this many income-minutes. */
export const MIN_MINUTES = 0.5;
/** A hoop cleared again pays this share. */
export const REPEAT_SHARE = 0.25;
/** The first clear at or under par adds this share of a first clear (the gentle par star). */
export const STAR_SHARE = 0.15;
/** Unfinished hoops kept waiting when she steps away to another one. */
export const OTHER_MAX = 6;
/** The color keys in the order hoops bring them in (proto/hoop/gen.js COLOR_ORDER). */
export const YARN_ORDER = Object.freeze(['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l']);

const SETTINGS = Object.freeze({ sound: true, glyphs: null, hooks: true });

export { LEVELS, LEVEL_IDS, CHAPTERS, levelById };

/** Fresh state.hoop (createInitialState uses the same shape). */
export function initialHoop() {
  return {
    cur: LEVEL_IDS[0], game: null, other: {}, done: {}, best: {}, seenIntro: {},
    settings: { ...SETTINGS }, paid: 0, finished: 0, last: null,
  };
}

/** Has she bought the Hoop (src/sim/unlocks.js 'hoop')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.hoop);
}

// ---------------------------------------------------------------------------
// Yarns: her colors for the eight dye keys
// ---------------------------------------------------------------------------

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/** Yarn must not vanish into the linen stretched in the hoop. */
export const YARN_MIN_DE = 14;
export const LINEN = '#EFE6D2';
function usable(id) {
  const hx = colorHex(id);
  return !!hx && deltaEHex(hx, LINEN) >= YARN_MIN_DE;
}

/** defaultYarns(state) -> {key: colorId} for every dye key (see the top of this file). */
export function defaultYarns(state) {
  let pool = discoveredIds(state).filter(usable);
  if (pool.length < YARN_ORDER.length) pool = pool.concat(CATALOG.map((c) => c.id).filter((id) => usable(id) && !pool.includes(id)));
  const out = {};
  const used = [];
  const fams = new Set();
  for (const key of YARN_ORDER) {
    const left = pool.filter((id) => !used.includes(id));
    if (!left.length) break;
    const fresh = left.filter((id) => !fams.has(colorFamily(id)));
    let best = null;
    if (fresh.length) {
      let bd = Infinity;
      for (const id of fresh) { const d = deltaEHex(colorHex(id), R.COLORS[key].hex); if (d < bd) { bd = d; best = id; } }
    } else {
      let bd = -1;
      for (const id of left) {
        const d = used.length ? Math.min(...used.map((o) => deltaEHex(colorHex(id), colorHex(o)))) : 100;
        if (d > bd) { bd = d; best = id; }
      }
    }
    out[key] = best;
    used.push(best);
    fams.add(colorFamily(best));
  }
  return out;
}

function validYarns(y) {
  if (!isObj(y)) return false;
  const ids = YARN_ORDER.map((k) => y[k]);
  return ids.every((id) => typeof id === 'string' && !!colorHex(id)) && new Set(ids).size === ids.length;
}

/** yarns(state) -> {key: colorId}: the hoop on the frame's colors (or the next hoop's). */
export function yarns(state) {
  const g = state && state.hoop && state.hoop.game;
  if (g && validYarns(g.yarns)) return { ...g.yarns };
  return defaultYarns(state);
}

// ---------------------------------------------------------------------------
// The hoop on the frame: moves -> rules state (memoized replay)
// ---------------------------------------------------------------------------

let memo = null; // {key, L, states: [s0, s1, ...]} for the last game read

/** "end:peg" -> [end, peg], or null when it is not a move's shape. */
export function parseMove(m) {
  if (typeof m !== 'string') return null;
  const t = /^(\d{1,2}):(-1|\d{1,2})$/.exec(m);
  return t ? [+t[1], +t[2]] : null;
}
export const moveText = (end, to) => `${end}:${to}`;

/** One move on a rules state -> the next rules state, or null when it is not legal there. */
function step(L, s, m) {
  const p = parseMove(m);
  if (!p || p[0] >= 2 * L.S) return null;
  const r = R.move(L, s, p[0], p[1]);
  return r.ok ? r.state : null;
}

/** Replays `moves` from the fresh hoop: [s0, s1, ...] or null when a move does not fit. */
function replayAll(L, moves) {
  const states = [R.newState(L)];
  for (const m of moves) {
    const next = step(L, states[states.length - 1], m);
    if (!next) return null;
    states.push(next);
  }
  return states;
}

const keyOf = (g) => `${g.level}|${g.sig}|${g.moves.join(' ')}`;
function remember(g, L, states) { memo = { key: keyOf(g), L, states }; }

/** Do the game's moves replay on its hoop? (the memo answers without a replay when it holds this game) */
function replays(g, L) {
  if (memo && memo.key === keyOf(g)) return true;
  const states = replayAll(L, g.moves);
  if (!states) return false;
  remember(g, L, states);
  return true;
}

/**
 * current(state) -> {L, s, past: [rules states], moves, done, paid, yarns} for
 * the hoop on the frame, or null when there is none (or its moves no longer
 * replay; ensureHoop drops such a game). `s` is the rules state after every
 * move; `past` the states before each move (the undo history). Read-only.
 */
export function current(state) {
  const g = state && state.hoop && state.hoop.game;
  if (!g || !Array.isArray(g.moves)) return null;
  const L = levelById(g.level);
  if (!L || g.sig !== L.sig) return null;
  const key = keyOf(g);
  if (!memo || memo.key !== key) {
    const states = replayAll(L, g.moves);
    if (!states) return null;
    memo = { key, L, states };
  }
  const st = memo.states;
  const s = st[st.length - 1];
  return { L, s, past: st.slice(0, -1), moves: g.moves.slice(), done: R.isDone(s), paid: !!g.paid, yarns: validYarns(g.yarns) ? { ...g.yarns } : defaultYarns(state) };
}

function freshGame(state, L) {
  return { level: L.id, sig: L.sig, moves: [], yarns: defaultYarns(state), paid: false };
}

/** A saved game that still fits its hoop (or null). Repairs its fields in place. */
function goodGame(state, g) {
  if (!isObj(g)) return null;
  const L = levelById(g.level);
  if (!L || g.sig !== L.sig || !Array.isArray(g.moves) || !g.moves.every((m) => !!parseMove(m)) || !replays(g, L)) return null;
  if (!validYarns(g.yarns)) g.yarns = defaultYarns(state);
  g.paid = !!g.paid;
  return g;
}

/**
 * ensureHoop(state) -> state.hoop, repaired in place: missing keys filled,
 * unknown hoop ids dropped, a saved game whose hoop changed (sig) or whose
 * moves no longer replay set aside, so a broken save never locks the hoop.
 */
export function ensureHoop(state) {
  if (!isObj(state.hoop)) state.hoop = initialHoop();
  const t = state.hoop;
  const d = initialHoop();
  for (const k of Object.keys(d)) if (t[k] === undefined) t[k] = d[k];
  if (!isObj(t.settings)) t.settings = { ...SETTINGS };
  if (typeof t.settings.sound !== 'boolean') t.settings.sound = SETTINGS.sound;
  if (typeof t.settings.hooks !== 'boolean') t.settings.hooks = SETTINGS.hooks;
  if (t.settings.glyphs !== null && typeof t.settings.glyphs !== 'boolean') t.settings.glyphs = null;
  for (const key of ['done', 'best']) {
    if (!isObj(t[key])) t[key] = {};
    for (const id of Object.keys(t[key])) {
      const n = Math.floor(num(Number(t[key][id])));
      if (!levelById(id) || n <= 0) delete t[key][id];
      else t[key][id] = n;
    }
  }
  if (!isObj(t.seenIntro)) t.seenIntro = {};
  if (typeof t.cur !== 'string' || !levelById(t.cur)) t.cur = LEVEL_IDS[0];
  if (t.game !== null && !goodGame(state, t.game)) t.game = null;
  if (!isObj(t.other)) t.other = {};
  for (const id of Object.keys(t.other)) {
    const g = t.other[id];
    if (!isObj(g) || g.level !== id || !goodGame(state, g) || id === (t.game && t.game.level)) delete t.other[id];
  }
  if (!isOpen(state, indexOf(t.cur))) t.cur = LEVEL_IDS[maxOpen(state)];
  t.paid = Math.max(0, num(t.paid));
  t.finished = Math.max(0, Math.floor(num(t.finished)));
  if (t.last !== null && !isObj(t.last)) t.last = null;
  return t;
}

// ---------------------------------------------------------------------------
// Order: hoops open one after another
// ---------------------------------------------------------------------------

/** isOpen(state, i) -> hoop 1 always; hoop i+1 once hoop i is cleared (a cleared one stays open). */
export function isOpen(state, i) {
  if (!(Number.isInteger(i) && i >= 0 && i < LEVEL_IDS.length)) return false;
  const done = (state && state.hoop && state.hoop.done) || {};
  return i === 0 || !!done[LEVEL_IDS[i - 1]] || !!done[LEVEL_IDS[i]];
}

/** The furthest hoop she can open (index). */
export function maxOpen(state) {
  let i = 0;
  while (i + 1 < LEVEL_IDS.length && isOpen(state, i + 1)) i++;
  return i;
}

/** nextLevelId(state, fromId) -> the next hoop not yet cleared after fromId, else simply the next one. */
export function nextLevelId(state, fromId) {
  const done = (state && state.hoop && state.hoop.done) || {};
  const idx = Math.max(0, indexOf(fromId));
  return LEVEL_IDS.slice(idx + 1).find((id) => !done[id]) || LEVEL_IDS[(idx + 1) % LEVEL_IDS.length];
}

/**
 * continueId(state) -> where Continue goes: the hoop on the frame while she is
 * part way through it, else the first open hoop not yet cleared (one she
 * stepped away from resumes where she left it), else the one on the frame.
 */
export function continueId(state) {
  const t = state && state.hoop;
  const cur = current(state);
  if (cur && cur.moves.length && !cur.done) return cur.L.id;
  const done = (t && t.done) || {};
  for (let i = 0; i <= maxOpen(state); i++) if (!done[LEVEL_IDS[i]]) return LEVEL_IDS[i];
  return t && levelById(t.cur) ? t.cur : LEVEL_IDS[0];
}

/** starred(state, levelId) -> has she cleared that hoop at or under par? */
export function starred(state, levelId) {
  const L = levelById(levelId);
  const b = num(state && state.hoop && state.hoop.best && state.hoop.best[levelId]);
  return !!L && b > 0 && b <= L.par;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Steps the game on the frame aside (an unfinished one waits in `other`). */
function park(t) {
  const g = t.game;
  const L = g && levelById(g.level);
  const states = L && g.moves.length ? (memo && memo.key === keyOf(g) ? memo.states : replayAll(L, g.moves)) : null;
  if (states && !R.isDone(states[states.length - 1])) {
    delete t.other[g.level];
    t.other[g.level] = g;
    const ids = Object.keys(t.other);
    while (ids.length > OTHER_MAX) delete t.other[ids.shift()];
  }
  t.game = null;
}

/**
 * openHoop(state) -> {ok, levelId}: the hoop on the frame is ready to play:
 * her saved game of state.hoop.cur when there is one, else a fresh one.
 */
export function openHoop(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureHoop(state);
  const L = levelById(t.cur);
  if (!t.game || t.game.level !== L.id) {
    const waiting = t.other[L.id];
    if (!(waiting && goodGame(state, waiting))) {
      const no = gate(state, 'hoop', now); // a fresh one is a new play (Responsibility mode)
      if (no) return no;
    }
    delete t.other[L.id];
    t.game = waiting && goodGame(state, waiting) ? waiting : freshGame(state, L);
  }
  return { ok: true, levelId: L.id };
}

/**
 * startHoop(state, {levelId, fresh}) -> {ok, levelId, resumed} | {ok:false, reason}:
 * that hoop on the frame. An unfinished hoop she steps away from waits for
 * her; `fresh` starts it over. reasons: 'locked' | 'unknown' | 'closed'.
 */
export function startHoop(state, { levelId, fresh = false } = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureHoop(state);
  const L = levelById(levelId);
  if (!L) return { ok: false, reason: 'unknown' };
  if (!isOpen(state, indexOf(L.id))) return { ok: false, reason: 'closed' };
  if (t.game && t.game.level === L.id && !fresh) { t.cur = L.id; return { ok: true, levelId: L.id, resumed: true }; }
  // Responsibility mode (src/sim/limits.js): only a new play counts. Resuming one
  // that waits, or starting an unfinished one over, never counts and never rests.
  const unfinished = !!(t.game && t.game.level === L.id && !t.game.paid) || !!(t.other[L.id] && goodGame(state, t.other[L.id]));
  if (!unfinished) {
    const no = gate(state, 'hoop', now);
    if (no) return no;
  }
  park(t);
  t.cur = L.id;
  const waiting = t.other[L.id];
  delete t.other[L.id];
  let resumed = false;
  if (!fresh && waiting && goodGame(state, waiting)) { t.game = waiting; resumed = true; } else {
    t.game = freshGame(state, L);
    remember(t.game, L, [R.newState(L)]);
  }
  return { ok: true, levelId: L.id, resumed };
}

/** restart(state) -> {ok}: the hoop on the frame, fresh. */
export function restart(state, args = {}, now = 0) {
  const t = ensureHoop(state);
  return startHoop(state, { levelId: t.cur, fresh: true }, now);
}

/**
 * move(state, {end, to}, now) -> {ok, ...the rules' move (from, to, movers,
 * dir, passed, made, cancelled, pulled, freed, liftoff), state, finished} |
 * {ok:false, reason, ...}. `to` -1 lifts strand end >> 1 off (a lift-off
 * band). `finished` (the pay, see finish) when this move cleared the hoop.
 * reasons: 'locked' | 'none' | 'bad' | 'done' | the rules' own ('fixed' |
 * 'under' | 'taken' | 'color' | 'around' | 'same' | 'band' | 'stitched' | 'clear' | 'gone').
 */
export function move(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureHoop(state);
  const cur = current(state);
  if (!cur) return { ok: false, reason: 'none' };
  const { L, s } = cur;
  const e = args.end, q = args.to;
  if (!(Number.isInteger(e) && e >= 0 && e < 2 * L.S && Number.isInteger(q) && q >= -1 && q < L.n)) return { ok: false, reason: 'bad' };
  if (R.isDone(s)) return { ok: false, reason: 'done' };
  const r = R.move(L, s, e, q);
  if (!r.ok) return { ...r, ok: false, state: s };
  t.game.moves.push(moveText(e, q));
  remember(t.game, L, memo.states.concat([r.state]));
  let finished = null;
  if (R.isDone(r.state) && !t.game.paid) {
    t.game.paid = true;
    finished = finish(state, L, r.state, now);
  }
  return { ...r, ok: true, state: r.state, finished };
}

/** undo(state) -> {ok, state}: takes back her last move (unlimited, back to the fresh hoop). */
export function undo(state) {
  ensureHoop(state);
  const cur = current(state);
  if (!cur || !cur.moves.length) return { ok: false, reason: 'none' };
  const states = memo.states.slice(0, -1);
  state.hoop.game.moves.pop();
  remember(state.hoop.game, cur.L, states);
  return { ok: true, state: states[states.length - 1] };
}

/** setSetting(state, {key, value}) -> {ok}: 'sound' | 'glyphs' (color symbols) | 'hooks' (hooked marks). */
export function setSetting(state, { key, value } = {}) {
  const t = ensureHoop(state);
  if (!(key in SETTINGS)) return { ok: false, reason: 'key' };
  t.settings[key] = !!value;
  return { ok: true, key, value: t.settings[key] };
}

/** glyphsOn(state) -> her choice, else settings.colorblind. */
export function glyphsOn(state) {
  const g = state && state.hoop && state.hoop.settings && state.hoop.settings.glyphs;
  if (typeof g === 'boolean') return g;
  return !!(state && state.settings && state.settings.colorblind);
}

/** seeIntro(state, {mechanics}) -> {ok}: these mechanics' intro cards are seen. */
export function seeIntro(state, { mechanics } = {}) {
  const t = ensureHoop(state);
  for (const m of Array.isArray(mechanics) ? mechanics : []) if (typeof m === 'string') t.seenIntro[m] = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/** Estimated active seconds for a hoop: a look, then each move of its par. */
export function estimatedSeconds(L) {
  return SEC_LOOK + SEC_PER_MOVE * num(L && L.par, 6);
}

/** Income-minutes a first clear of this hoop pays (the star adds STAR_SHARE of it once). */
export function hoopMinutes(L) {
  return Math.max(MIN_MINUTES, RATE * estimatedSeconds(L) / 60);
}

/**
 * quote(state, levelId, now, {moves}) -> {coins, bonus, repeat, star}: what
 * clearing that hoop pays now (bonus: the star's, when `moves` is at or under
 * par and she has not had it on this hoop yet; star: whether `moves` earns it).
 */
export function quote(state, levelId, now = 0, { moves = Infinity } = {}) {
  const L = levelById(levelId);
  if (!L) return { coins: 0, bonus: 0, repeat: false, star: false };
  const repeat = num(state && state.hoop && state.hoop.done && state.hoop.done[L.id]) > 0;
  const one = Math.max(0, num(hoopMinutes(L) * orderBasePay(state, 1) * incomeMultiplier(state, now)));
  const star = moves <= L.par;
  const bonus = star && !starred(state, L.id) ? one * STAR_SHARE : 0;
  return { coins: one * (repeat ? REPEAT_SHARE : 1), bonus, repeat, star };
}

/** The finish: coins, the record, the hooks. */
function finish(state, L, s, now) {
  const t = ensureHoop(state);
  const q = quote(state, L.id, now, { moves: s.moves });
  const coins = earn(state, q.coins + q.bonus);
  const y = validYarns(t.game && t.game.yarns) ? t.game.yarns : defaultYarns(state);
  const colors = [...new Set(L.colors.map((k) => y[k]).filter(Boolean))];
  t.done[L.id] = num(t.done[L.id]) + 1;
  const was = num(t.best[L.id]);
  if (!(was > 0) || s.moves < was) t.best[L.id] = s.moves;
  t.finished = num(t.finished) + 1;
  t.paid = num(t.paid) + coins;
  t.last = { levelId: L.id, coins, bonus: q.bonus, repeat: q.repeat, star: q.star, moves: s.moves, par: L.par, optimal: !!(L.stats && L.stats.optimal), at: num(now) };
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  questEvent(state, 'hoopUntangled', 1, { levelId: L.id });
  eventPoints(state, 'hoop', 1, { colors });
  emit(state, 'hoopUntangled', { levelId: L.id, coins, bonus: q.bonus, repeat: q.repeat, star: q.star, finished: t.finished });
  return { levelId: L.id, coins, bonus: q.bonus, repeat: q.repeat, star: q.star, colors };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** summary(state) -> a cheap read for the Puzzles hub card. */
export function summary(state) {
  const t = state && state.hoop;
  const cur = t && t.game ? current(state) : null;
  const id = (cur && cur.L.id) || (t && levelById(t.cur) ? t.cur : LEVEL_IDS[0]);
  const L = levelById(id);
  const i = indexOf(id);
  const done = t && isObj(t.done) ? Object.keys(t.done).filter((k) => levelById(k)).length : 0;
  const stars = t && isObj(t.best) ? Object.keys(t.best).filter((k) => starred(state, k)).length : 0;
  return {
    open: unlocked(state),
    levelId: id,
    name: L.name,
    index: i,
    total: LEVEL_IDS.length,
    chapter: chapterOf(i).name,
    playing: !!(cur && cur.moves.length && !cur.done),
    cleared: !!(cur && cur.done),
    left: cur ? R.remaining(cur.s) : L.stats.strands,
    strands: L.stats.strands,
    moves: cur ? cur.s.moves : 0,
    done,
    stars,
    finished: t ? num(t.finished) : 0,
    continueId: continueId(state),
  };
}
