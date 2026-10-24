// sim/tangle.js — The Tangle Basket as sim actions on state (pure).
// The rules live in src/puzzles/tangle.js and the 109 baskets in
// src/puzzles/tangle-levels.js (ported from proto/tangle/, where the playtested
// prototype and its generator stay). This module owns the save shape, her yarn
// colors, the order the baskets open in, the pulls of the basket on the table,
// the coins a finished basket pays, and the hooks for quests and events.
//
// state.tangle = {
//   cur: 'first',                // the basket on the table (a level id)
//   game: null | { level, sig, moves: [3, 7, 'N', ...], yarns: {m: colorId, ...}, paid },
//                                // her pulls so far (a strand number per pull,
//                                // 'N' = the free spare rack place); sig = the
//                                // basket's levelSig, so a save from an older
//                                // version of a basket is set aside instead of
//                                // misread; yarns = her colors for the basket's
//                                // color keys, fixed when it starts; paid = this
//                                // game has paid its finish (undo, then finish
//                                // again, never pays twice)
//   other: { [levelId]: Game },  // unfinished baskets she stepped away from (at most OTHER_MAX)
//   done: { first: 1 },          // times each basket has been untangled
//   seenIntro: { rack: true },   // mechanics whose intro card she has seen
//   settings: { sound: true, glyphs: null },  // glyphs null follows settings.colorblind
//   paid: 0, untangled: 0,       // coins every basket has paid; baskets untangled (repeats too)
//   last: null | { levelId, coins, repeat, skeins, at },
// }
//
// Baskets open in order: the first always, basket i+1 once basket i is
// untangled (any basket already untangled stays open).
//
// A reload mid-basket resumes exactly: every pull is one act (saved at once),
// and the rules state is the replay of `moves` from the fresh basket (the rules
// are deterministic). `current(state)` memoizes the replay, so a pull is one
// rules step, not a replay, and undo is a step back through the same list.
//
// Yarns: the prototype's eight natural dyes (madder, weld, indigo, walnut,
// cochineal, nettle, logwood, onion skin) become her discovered colors, as the
// Winding Room does it: each key, in the order baskets bring colors in, takes
// her discovered color nearest that dye from a hue family not used yet, so the
// colors read apart; once her families run out, the color furthest from the
// ones chosen (the color symbols keep them apart too). A color too close to
// the undyed gray of a buried strand, or to the basket's linen, is never
// yarn. Catalog colors fill in only when she has fewer colors than keys.
//
// Coins (kept modest so hand orders stay the best coins per active minute; see
// tools/balance/TUNING.md "Tangle Basket"):
//   coins = basketMinutes(L) × orderBasePay(state, 1) × incomeMultiplier, where
//     basketMinutes(L) = max(MIN_MINUTES, RATE × estimated active minutes) and
//     the estimate is SEC_LOOK to take the basket in plus SEC_PER_PULL per pull
//     of the stored solution. RATE 1: one income-minute per active minute
//     (hand orders: 2 to 4 per 30 to 60 s). Like the Winding Room's hanks it
//     scales one order-minute (orderBasePay(state, 1), floored at 25% of the
//     cheapest upgrade), so even while that floor binds a quick basket never
//     out-earns an order per minute. A basket untangled again pays
//     REPEAT_SHARE of that.
//
// Hooks (only existing exports are called):
//   questEvent(state, 'basketUntangled', 1, {levelId}) per finished basket
//   eventPoints(state, 'untangled', 1, {colors: [her yarn ids in it]}) per finished basket
// Domain event (bus): 'basketUntangled' {levelId, coins, repeat, untangled, skeins}.

import * as R from '../puzzles/tangle.js';
import { LEVELS, LEVEL_IDS, CHAPTERS, levelById, indexOf, chapterOf } from '../puzzles/tangle-levels.js';
import { emit } from './bus.js';
import { deltaEHex } from '../color.js';
import { colorFamily, colorHex, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { CATALOG } from '../content/catalog.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Seconds of active play to take a basket in, and per pull of the stored solution. */
export const SEC_LOOK = 10;
export const SEC_PER_PULL = 4;
/** Income-minutes a basket pays per estimated active minute (hand orders pay 2 to 4 per 30 to 60 s). */
export const RATE = 1;
/** The smallest basket still pays this many income-minutes. */
export const MIN_MINUTES = 0.5;
/** A basket untangled again pays this share. */
export const REPEAT_SHARE = 0.25;
/** Unfinished baskets kept waiting when she steps away to another one. */
export const OTHER_MAX = 6;
/** The color keys in the order baskets bring them in (proto/tangle/gen.js COLOR_ORDER). */
export const YARN_ORDER = Object.freeze(['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l']);

const SETTINGS = Object.freeze({ sound: true, glyphs: null });

export { LEVELS, LEVEL_IDS, CHAPTERS, levelById };

/** Fresh state.tangle (createInitialState uses the same shape). */
export function initialTangle() {
  return {
    cur: LEVEL_IDS[0], game: null, other: {}, done: {}, seenIntro: {},
    settings: { ...SETTINGS }, paid: 0, untangled: 0, last: null,
  };
}

/** Has she bought the Tangle Basket (src/sim/unlocks.js 'tangle')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.tangle);
}

// ---------------------------------------------------------------------------
// Yarns: her colors for the eight dye keys
// ---------------------------------------------------------------------------

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/** Yarn must not read as a buried (undyed gray) strand, nor vanish into the basket's linen. */
export const YARN_MIN_DE = 14;
const LINEN = '#ECE2CC';
function usable(id) {
  const hx = colorHex(id);
  return !!hx && deltaEHex(hx, R.HIDDEN_HEX) >= YARN_MIN_DE && deltaEHex(hx, LINEN) >= YARN_MIN_DE;
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

/** yarns(state) -> {key: colorId}: the basket on the table's colors (or the next basket's). */
export function yarns(state) {
  const g = state && state.tangle && state.tangle.game;
  if (g && validYarns(g.yarns)) return { ...g.yarns };
  return defaultYarns(state);
}

// ---------------------------------------------------------------------------
// The basket on the table: moves -> rules state (memoized replay)
// ---------------------------------------------------------------------------

let memo = null; // {key, L, states: [s0, s1, ...]} for the last game read

const isMove = (m) => m === 'N' || (Number.isInteger(m) && m >= 0);

/** One move on a rules state -> the next rules state, or null when it is not legal there. */
function step(L, s, m) {
  if (m === 'N') return R.canNudge(s) ? R.nudge(s) : null;
  if (!(m < L.n)) return null;
  const r = R.pull(L, s, m);
  return r.ok ? r.state : null;
}

/** Replays `moves` from the fresh basket: [s0, s1, ...] or null when a move does not fit. */
function replayAll(L, moves) {
  const states = [R.newState(L)];
  for (const m of moves) {
    if (!isMove(m)) return null;
    const next = step(L, states[states.length - 1], m);
    if (!next) return null;
    states.push(next);
  }
  return states;
}

const keyOf = (g) => `${g.level}|${g.sig}|${g.moves.join(' ')}`;
function remember(g, L, states) { memo = { key: keyOf(g), L, states }; }

/** Do the game's moves replay on its basket? (the memo answers without a replay when it holds this game) */
function replays(g, L) {
  if (memo && memo.key === keyOf(g)) return true;
  const states = replayAll(L, g.moves);
  if (!states) return false;
  remember(g, L, states);
  return true;
}

/**
 * current(state) -> {L, s, past: [rules states], moves, done, paid, yarns} for
 * the basket on the table, or null when there is none (or its moves no longer
 * replay; ensureTangle drops such a game). `s` is the rules state after every
 * move; `past` the states before each move (the undo history). Read-only.
 */
export function current(state) {
  const g = state && state.tangle && state.tangle.game;
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

/** A saved game that still fits its basket (or null). Repairs its fields in place. */
function goodGame(state, g) {
  if (!isObj(g)) return null;
  const L = levelById(g.level);
  if (!L || g.sig !== L.sig || !Array.isArray(g.moves) || !g.moves.every(isMove) || !replays(g, L)) return null;
  if (!validYarns(g.yarns)) g.yarns = defaultYarns(state);
  g.paid = !!g.paid;
  return g;
}

/**
 * ensureTangle(state) -> state.tangle, repaired in place: missing keys filled,
 * unknown basket ids dropped, a saved game whose basket changed (sig) or whose
 * moves no longer replay set aside, so a broken save never locks the basket.
 */
export function ensureTangle(state) {
  if (!isObj(state.tangle)) state.tangle = initialTangle();
  const t = state.tangle;
  const d = initialTangle();
  for (const k of Object.keys(d)) if (t[k] === undefined) t[k] = d[k];
  if (!isObj(t.settings)) t.settings = { ...SETTINGS };
  if (typeof t.settings.sound !== 'boolean') t.settings.sound = SETTINGS.sound;
  if (t.settings.glyphs !== null && typeof t.settings.glyphs !== 'boolean') t.settings.glyphs = null;
  if (!isObj(t.done)) t.done = {};
  for (const id of Object.keys(t.done)) {
    const n = Math.floor(num(Number(t.done[id])));
    if (!levelById(id) || n <= 0) delete t.done[id];
    else t.done[id] = n;
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
  t.untangled = Math.max(0, Math.floor(num(t.untangled)));
  if (t.last !== null && !isObj(t.last)) t.last = null;
  return t;
}

// ---------------------------------------------------------------------------
// Order: baskets open one after another
// ---------------------------------------------------------------------------

/** isOpen(state, i) -> basket 1 always; basket i+1 once basket i is untangled (an untangled one stays open). */
export function isOpen(state, i) {
  if (!(Number.isInteger(i) && i >= 0 && i < LEVEL_IDS.length)) return false;
  const done = (state && state.tangle && state.tangle.done) || {};
  return i === 0 || !!done[LEVEL_IDS[i - 1]] || !!done[LEVEL_IDS[i]];
}

/** The furthest basket she can open (index). */
export function maxOpen(state) {
  let i = 0;
  while (i + 1 < LEVEL_IDS.length && isOpen(state, i + 1)) i++;
  return i;
}

/** nextLevelId(state, fromId) -> the next basket not yet untangled after fromId, else simply the next one. */
export function nextLevelId(state, fromId) {
  const done = (state && state.tangle && state.tangle.done) || {};
  const idx = Math.max(0, indexOf(fromId));
  return LEVEL_IDS.slice(idx + 1).find((id) => !done[id]) || LEVEL_IDS[(idx + 1) % LEVEL_IDS.length];
}

/**
 * continueId(state) -> where Continue goes: the basket on the table while she
 * is part way through it, else the first open basket not yet untangled (one
 * she stepped away from resumes where she left it), else the one on the table.
 */
export function continueId(state) {
  const t = state && state.tangle;
  const cur = current(state);
  if (cur && cur.moves.length && !cur.done) return cur.L.id;
  const done = (t && t.done) || {};
  for (let i = 0; i <= maxOpen(state); i++) if (!done[LEVEL_IDS[i]]) return LEVEL_IDS[i];
  return t && levelById(t.cur) ? t.cur : LEVEL_IDS[0];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Steps the game on the table aside (an unfinished one waits in `other`). */
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
 * openBasket(state) -> {ok, levelId}: the basket on the table is ready to
 * play: her saved game of state.tangle.cur when there is one, else a fresh one.
 */
export function openBasket(state) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureTangle(state);
  const L = levelById(t.cur);
  if (!t.game || t.game.level !== L.id) {
    const waiting = t.other[L.id];
    delete t.other[L.id];
    t.game = waiting && goodGame(state, waiting) ? waiting : freshGame(state, L);
  }
  return { ok: true, levelId: L.id };
}

/**
 * startBasket(state, {levelId, fresh}) -> {ok, levelId, resumed} | {ok:false, reason}:
 * that basket on the table. An unfinished basket she steps away from waits
 * for her; `fresh` starts it over. reasons: 'locked' | 'unknown' | 'closed'.
 */
export function startBasket(state, { levelId, fresh = false } = {}) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureTangle(state);
  const L = levelById(levelId);
  if (!L) return { ok: false, reason: 'unknown' };
  if (!isOpen(state, indexOf(L.id))) return { ok: false, reason: 'closed' };
  if (t.game && t.game.level === L.id && !fresh) { t.cur = L.id; return { ok: true, levelId: L.id, resumed: true }; }
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

/** restart(state) -> {ok}: the basket on the table, fresh. */
export function restart(state) {
  const t = ensureTangle(state);
  return startBasket(state, { levelId: t.cur, fresh: true });
}

/**
 * pull(state, {strand}, now) -> {ok, strand, events, group, state, finished} |
 * {ok:false, reason, ...whyNot}. `events` (the rules' winding order: color,
 * slot, count, fresh, popped) and `group` (the strands that came out) are for
 * the animation. `finished` (the pay, see finish) when this pull cleared the
 * basket. reasons: 'locked' | 'none' | 'bad' | 'done' | rules whyNot
 * ('covered' | 'pinned' | 'pegged' | 'rack' | 'gone').
 */
export function pull(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureTangle(state);
  const cur = current(state);
  if (!cur) return { ok: false, reason: 'none' };
  const { L, s } = cur;
  const i = args.strand;
  if (!(Number.isInteger(i) && i >= 0 && i < L.n)) return { ok: false, reason: 'bad' };
  if (R.isDone(s)) return { ok: false, reason: 'done' };
  const r = R.pull(L, s, i);
  if (!r.ok) return { ...r, ok: false, state: s };
  t.game.moves.push(i);
  remember(t.game, L, memo.states.concat([r.state]));
  let finished = null;
  if (R.isDone(r.state) && !t.game.paid) {
    t.game.paid = true;
    finished = finish(state, L, r.state, now);
  }
  return { ok: true, strand: i, events: r.events, group: r.group, state: r.state, finished };
}

/** nudge(state) -> {ok, state}: one spare rack place for this basket, once. */
export function nudge(state) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  ensureTangle(state);
  const cur = current(state);
  if (!cur) return { ok: false, reason: 'none' };
  if (R.isDone(cur.s) || !R.canNudge(cur.s)) return { ok: false, reason: 'nudge' };
  const next = R.nudge(cur.s);
  state.tangle.game.moves.push('N');
  remember(state.tangle.game, cur.L, memo.states.concat([next]));
  return { ok: true, state: next };
}

/** undo(state) -> {ok, state}: takes back her last pull (unlimited, back to the fresh basket). */
export function undo(state) {
  ensureTangle(state);
  const cur = current(state);
  if (!cur || !cur.moves.length) return { ok: false, reason: 'none' };
  const states = memo.states.slice(0, -1);
  state.tangle.game.moves.pop();
  remember(state.tangle.game, cur.L, states);
  return { ok: true, state: states[states.length - 1] };
}

/** setSetting(state, {key, value}) -> {ok}: 'sound' | 'glyphs' (color symbols). */
export function setSetting(state, { key, value } = {}) {
  const t = ensureTangle(state);
  if (!(key in SETTINGS)) return { ok: false, reason: 'key' };
  t.settings[key] = !!value;
  return { ok: true, key, value: t.settings[key] };
}

/** glyphsOn(state) -> her choice, else settings.colorblind. */
export function glyphsOn(state) {
  const g = state && state.tangle && state.tangle.settings && state.tangle.settings.glyphs;
  if (typeof g === 'boolean') return g;
  return !!(state && state.settings && state.settings.colorblind);
}

/** seeIntro(state, {mechanics}) -> {ok}: these mechanics' intro cards are seen. */
export function seeIntro(state, { mechanics } = {}) {
  const t = ensureTangle(state);
  for (const m of Array.isArray(mechanics) ? mechanics : []) if (typeof m === 'string') t.seenIntro[m] = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/** Estimated active seconds for a basket: a look, then each pull of its stored solution. */
export function estimatedSeconds(L) {
  const st = (L && L.stats) || {};
  return SEC_LOOK + SEC_PER_PULL * num(st.pulls, 10);
}

/** Income-minutes a first untangling of this basket pays. */
export function basketMinutes(L) {
  return Math.max(MIN_MINUTES, RATE * estimatedSeconds(L) / 60);
}

/** quote(state, levelId, now) -> {coins, repeat}: what untangling that basket pays now. */
export function quote(state, levelId, now = 0) {
  const L = levelById(levelId);
  if (!L) return { coins: 0, repeat: false };
  const repeat = num(state && state.tangle && state.tangle.done && state.tangle.done[L.id]) > 0;
  const share = repeat ? REPEAT_SHARE : 1;
  const coins = Math.max(0, num(basketMinutes(L) * orderBasePay(state, 1) * incomeMultiplier(state, now) * share));
  return { coins, repeat };
}

/** The finish: coins, the record, the hooks. */
function finish(state, L, s, now) {
  const t = ensureTangle(state);
  const q = quote(state, L.id, now);
  const coins = earn(state, q.coins);
  const y = validYarns(t.game && t.game.yarns) ? t.game.yarns : defaultYarns(state);
  const colors = [...new Set(L.colors.map((k) => y[k]).filter(Boolean))];
  t.done[L.id] = num(t.done[L.id]) + 1;
  t.untangled = num(t.untangled) + 1;
  t.paid = num(t.paid) + coins;
  t.last = { levelId: L.id, coins, repeat: q.repeat, skeins: s.skeins.length, at: num(now) };
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  questEvent(state, 'basketUntangled', 1, { levelId: L.id });
  eventPoints(state, 'untangled', 1, { colors });
  emit(state, 'basketUntangled', { levelId: L.id, coins, repeat: q.repeat, untangled: t.untangled, skeins: s.skeins.length });
  return { levelId: L.id, coins, repeat: q.repeat, colors };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** summary(state) -> a cheap read for the Puzzles hub card (never builds a basket it only shows). */
export function summary(state) {
  const t = state && state.tangle;
  const cur = t && t.game ? current(state) : null;
  const id = (cur && cur.L.id) || (t && levelById(t.cur) ? t.cur : LEVEL_IDS[0]);
  const L = levelById(id);
  const i = indexOf(id);
  const done = t && isObj(t.done) ? Object.keys(t.done).filter((k) => levelById(k)).length : 0;
  return {
    open: unlocked(state),
    levelId: id,
    name: L.name,
    index: i,
    total: LEVEL_IDS.length,
    chapter: chapterOf(i).name,
    playing: !!(cur && cur.moves.length && !cur.done),
    cleared: !!(cur && cur.done),
    left: cur ? R.remaining(cur.s) : L.n,
    n: L.n,
    out: cur ? cur.s.out.slice() : null,
    done,
    untangled: t ? num(t.untangled) : 0,
    continueId: continueId(state),
  };
}
