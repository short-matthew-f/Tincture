// sim/lift.js — The Lifting Table as sim actions on state (pure).
// The rules live in src/puzzles/lift.js and the 27 paintings in
// src/puzzles/lift-levels.js (ported from proto/lift/, where the playtested
// prototype and its authoring tools stay). This module owns the save shape,
// the moves of the painting on the easel, the coins and the stock a finished
// painting pays, and the hooks for quests and events.
//
// state.lift = {
//   cur: 'sun',                  // the painting on the easel (a level id)
//   game: null | { level, sig, moves: ['L1', 'P0', 'U0', 'N', ...], paid },
//                                // her moves on it so far (N = the free spare
//                                // bench spot); sig = puzzles levelSig, so a
//                                // save from an older version of a picture is
//                                // set aside instead of misread; paid = this
//                                // game has paid its finish (undo, then finish
//                                // again, never pays twice)
//   done: { sun: 1 },            // times each painting has been lifted
//   seenIntro: { mystery: true },// mechanics whose intro card she has seen
//   settings: { fast: false, sound: true, glyphs: true },
//   paid: 0, lifted: 0,          // coins every painting has paid; paintings lifted (repeats too)
//   last: null | { levelId, coins, sold, stock: [{colorId, jars}], repeat, at },
// }
//
// A reload mid-painting resumes exactly: every move is one act (saved at once),
// and the rules state is the replay of `moves` from the fresh painting (the
// rules are deterministic). `current(state)` memoizes the replay, so a move is
// one rules step, not a replay, and undo is a step back through the same list.
//
// Rewards (kept modest so hand orders stay the best coins per active minute;
// see tools/balance/TUNING.md "Lifting Table"):
//   coins = orderBasePay(state, paintMinutes(L)) × incomeMultiplier, where
//     paintMinutes(L) = max(MIN_MINUTES, RATE × estimated active minutes) and
//     the estimate is SEC_PER_MOVE per move of the stored solution plus
//     SEC_PER_TRAP per step with a trap to dodge (stats in lift-queues.js).
//     RATE 1: one income-minute per active minute (hand orders: 2 to 4 per
//     30 to 60 s). A painting lifted again pays REPEAT_SHARE of that.
//   stock = for each palette color, STOCK_PER_CELL jars per lifted cell of it,
//     added to her nearest discovered color (ΔE in OKLab), whole jars, at least
//     one per color the first time. It goes through storage.addStock, so it
//     stops at free capacity; jars that do not fit sell at once (as Purify's
//     do), so nothing is lost. Nothing is ever taken from stock, so her shop
//     reserves (state.keep) are untouched. The puzzle's own jar capacities are
//     the designed ones; this is a separate, small conversion.
//
// Hooks (only existing exports are called):
//   questEvent(state, 'paintingLifted', 1, {levelId}) per finished painting
//   eventPoints(state, 'lifted', 1, {colors: [nearest discovered ids]}) per finished painting
// Domain event (bus): 'paintingLifted' {levelId, coins, sold, stock, repeat, lifted}.

import * as R from '../puzzles/lift.js';
import { LEVELS, LEVEL_IDS, PALETTE, levelById } from '../puzzles/lift-levels.js';
import { emit } from './bus.js';
import { deltaEHex } from '../color.js';
import { colorHex, colorPrice, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { addStock } from './storage.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Seconds of active play a move of the stored solution is worth, and a step with a trap on top. */
export const SEC_PER_MOVE = 4;
export const SEC_PER_TRAP = 6;
/** Income-minutes a painting pays per estimated active minute (hand orders pay 2 to 4 per 30 to 60 s). */
export const RATE = 1;
/** The smallest painting still pays this many income-minutes. */
export const MIN_MINUTES = 0.75;
/** A painting lifted again pays this share of its coins and stock. */
export const REPEAT_SHARE = 0.25;
/** Jars of stock per lifted cell (a 64-cell painting: about 3 jars; a 1,000-cell one: about 50). */
export const STOCK_PER_CELL = 0.05;

const MOVE_RE = /^(?:[LPU]\d+|N)$/;
const SETTINGS = Object.freeze({ fast: false, sound: true, glyphs: true });

/** Fresh state.lift (createInitialState uses the same shape). */
export function initialLift() {
  return {
    cur: LEVEL_IDS[0], game: null, done: {}, seenIntro: {},
    settings: { ...SETTINGS }, paid: 0, lifted: 0, last: null,
  };
}

/** Has she bought the Lifting Table (src/sim/unlocks.js 'lift')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.lift);
}

export { LEVELS, LEVEL_IDS, PALETTE, levelById };

// ---------------------------------------------------------------------------
// The painting on the easel: moves -> rules state (memoized replay)
// ---------------------------------------------------------------------------

let memo = null; // {key, L, states: [s0, s1, ...]} for the last game read

const decode = (str) => (str === 'N' ? { t: 'nudge' } : R.decodeMove(str));

/** One move on a rules state -> the next rules state, or null when it is not legal there. */
function step(L, s, str) {
  const m = decode(str);
  if (m.t === 'nudge') return R.canNudge(s) ? R.nudge(s) : null;
  if (!R.isLegal(L, s, m)) return null;
  return R.apply(L, s, m).state;
}

/** Replays `moves` from the fresh painting: [s0, s1, ...] or null when a move does not fit. */
function replayAll(L, moves) {
  const states = [R.newState(L)];
  for (const str of moves) {
    if (typeof str !== 'string' || !MOVE_RE.test(str)) return null;
    const next = step(L, states[states.length - 1], str);
    if (!next) return null;
    states.push(next);
  }
  return states;
}

const keyOf = (g) => `${g.level}|${g.sig}|${g.moves.join(' ')}`;

/**
 * current(state) -> {L, s, past: [rules states], moves, done, paid} for the
 * painting on the easel, or null when there is none (or its moves no longer
 * replay; ensureLift drops such a game). `s` is the rules state after every
 * move; `past` the states before each move (the undo history). Read-only.
 */
export function current(state) {
  const g = state && state.lift && state.lift.game;
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
  return { L, s: st[st.length - 1], past: st.slice(0, -1), moves: g.moves.slice(), done: R.isDone(st[st.length - 1]), paid: !!g.paid };
}

function remember(g, L, states) {
  memo = { key: keyOf(g), L, states };
}

/** Do the game's moves replay on its painting? (the memo answers without a replay when it holds this game) */
function replays(g, L) {
  if (!g.moves.every((m) => typeof m === 'string')) return false;
  if (memo && memo.key === keyOf(g)) return true;
  const states = replayAll(L, g.moves);
  if (!states) return false;
  remember(g, L, states);
  return true;
}

function freshGame(L) {
  return { level: L.id, sig: L.sig, moves: [], paid: false };
}

/**
 * ensureLift(state) -> state.lift, repaired in place: missing keys filled,
 * unknown painting ids dropped, a saved game whose picture changed (sig) or
 * whose moves no longer replay set aside, so a broken save never locks the table.
 */
export function ensureLift(state) {
  if (!isObj(state.lift)) state.lift = initialLift();
  const t = state.lift;
  const d = initialLift();
  for (const k of Object.keys(d)) if (t[k] === undefined) t[k] = d[k];
  if (!isObj(t.settings)) t.settings = { ...SETTINGS };
  for (const [k, v] of Object.entries(SETTINGS)) if (typeof t.settings[k] !== 'boolean') t.settings[k] = v;
  if (!isObj(t.done)) t.done = {};
  for (const id of Object.keys(t.done)) {
    const n = Math.floor(num(Number(t.done[id])));
    if (!levelById(id) || n <= 0) delete t.done[id];
    else t.done[id] = n;
  }
  if (!isObj(t.seenIntro)) t.seenIntro = {};
  if (typeof t.cur !== 'string' || !levelById(t.cur)) t.cur = LEVEL_IDS[0];
  if (t.game !== null) {
    const g = t.game;
    const L = isObj(g) ? levelById(g.level) : null;
    if (!L || g.sig !== L.sig || !Array.isArray(g.moves) || !replays(g, L)) t.game = null;
    else g.paid = !!g.paid;
  }
  t.paid = Math.max(0, num(t.paid));
  t.lifted = Math.max(0, Math.floor(num(t.lifted)));
  if (t.last !== null && !isObj(t.last)) t.last = null;
  return t;
}

/**
 * openEasel(state) -> {ok, levelId}: the painting on the easel is ready to
 * play: her saved game of state.lift.cur when there is one, else a fresh one.
 */
export function openEasel(state) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureLift(state);
  const L = levelById(t.cur);
  if (!t.game || t.game.level !== L.id) t.game = freshGame(L);
  return { ok: true, levelId: L.id };
}

/** startPainting(state, {levelId}) -> {ok, levelId}: that painting, fresh, on the easel (any painting, any order). */
export function startPainting(state, { levelId } = {}) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureLift(state);
  const L = levelById(levelId);
  if (!L) return { ok: false, reason: 'unknown' };
  t.cur = L.id;
  t.game = freshGame(L);
  remember(t.game, L, [R.newState(L)]);
  return { ok: true, levelId: L.id };
}

/** restart(state) -> {ok}: the painting on the easel, fresh. */
export function restart(state) {
  const t = ensureLift(state);
  return startPainting(state, { levelId: t.cur });
}

/**
 * move(state, {move}, now) -> {ok, move, staged, passes, state, finished} |
 * {ok:false, reason}. `move` is 'L<lane>' (set the lane's front jar or tied
 * pair on the belt), 'P<i>' (rest belt jar i on the bench), 'U<i>' (bring bench
 * jar i back) or 'N' (the free spare bench spot, once per painting). `staged`
 * is the rules state right after the move (before the belt runs) and `passes`
 * the belt's lifts, for the animation; `state` is where it settles.
 * `finished` (the pay, see finish) when this move cleared the painting.
 * reasons: 'locked' | 'none' | 'bad' | 'done' | 'nudge' | rules blockedReason
 * ('empty' | 'locked-lane' | 'tied' | 'belt' | 'bench').
 */
export function move(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureLift(state);
  const cur = current(state);
  if (!cur) return { ok: false, reason: 'none' };
  const { L, s } = cur;
  const str = typeof args.move === 'string' ? args.move : (isObj(args.move) ? (args.move.t === 'nudge' ? 'N' : R.encodeMove(args.move)) : '');
  if (!MOVE_RE.test(str)) return { ok: false, reason: 'bad' };
  if (R.isDone(s)) return { ok: false, reason: 'done' };
  let staged, after, passes;
  if (str === 'N') {
    if (!R.canNudge(s)) return { ok: false, reason: 'nudge' };
    staged = after = R.nudge(s);
    passes = [];
  } else {
    const m = R.decodeMove(str);
    if (!R.isLegal(L, s, m)) {
      const why = R.blockedReason(L, s, m);
      return { ok: false, reason: why === 'locked' ? 'locked-lane' : (why || 'bad') };
    }
    staged = R.stage(L, s, m);
    const r = m.t === 'park' ? { state: staged, passes: [] } : R.settle(L, staged);
    after = r.state;
    passes = r.passes;
  }
  const states = memo.states.concat([after]);
  t.game.moves.push(str);
  remember(t.game, L, states);
  let finished = null;
  if (R.isDone(after) && !t.game.paid) {
    t.game.paid = true;
    finished = finish(state, L, now);
  }
  return { ok: true, move: str, staged, passes, state: after, finished };
}

/** nudge(state) -> move 'N': one more bench spot for this painting, once. */
export function nudge(state, args = {}, now = 0) {
  return move(state, { move: 'N' }, now);
}

/** undo(state) -> {ok, state}: takes back her last move (unlimited, back to the fresh painting). */
export function undo(state) {
  const t = ensureLift(state);
  const cur = current(state);
  if (!cur || !cur.moves.length) return { ok: false, reason: 'none' };
  const states = memo.states.slice(0, -1);
  t.game.moves.pop();
  remember(t.game, cur.L, states);
  return { ok: true, state: states[states.length - 1] };
}

/** setSetting(state, {key, value}) -> {ok}: 'fast' (fast belt) | 'sound' | 'glyphs' (color symbols). */
export function setSetting(state, { key, value } = {}) {
  const t = ensureLift(state);
  if (!(key in SETTINGS)) return { ok: false, reason: 'key' };
  t.settings[key] = !!value;
  return { ok: true, key, value: t.settings[key] };
}

/** seeIntro(state, {mechanics}) -> {ok}: these mechanics' intro cards are seen. */
export function seeIntro(state, { mechanics } = {}) {
  const t = ensureLift(state);
  for (const m of Array.isArray(mechanics) ? mechanics : []) if (typeof m === 'string') t.seenIntro[m] = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/** Estimated active seconds for a painting: its stored solution's moves and trap steps. */
export function estimatedSeconds(L) {
  const st = (L && L.stats) || {};
  return SEC_PER_MOVE * num(st.moves, 10) + SEC_PER_TRAP * num(st.trapSteps);
}

/** Income-minutes a first lift of this painting pays. */
export function paintMinutes(L) {
  return Math.max(MIN_MINUTES, RATE * estimatedSeconds(L) / 60);
}

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/** nearestDiscovered(state, hex) -> the discovered color id closest to hex (ΔE in OKLab), or null. */
export function nearestDiscovered(state, hex) {
  let best = null;
  let bestDe = Infinity;
  for (const id of discoveredIds(state)) {
    const h = colorHex(id);
    if (!h) continue;
    const de = deltaEHex(hex, h);
    if (de < bestDe) { bestDe = de; best = id; }
  }
  return best;
}

/**
 * stockFor(state, L, share) -> [{colorId, jars, from: [palette keys]}]: what
 * the painting's lifted paint adds to stock, grouped by her nearest
 * discovered color, most jars first.
 */
export function stockFor(state, L, share = 1) {
  const cells = new Map();
  const from = new Map();
  for (const [k, n] of Object.entries(L.counts)) {
    const pal = PALETTE[k];
    const id = pal ? nearestDiscovered(state, pal.hex) : null;
    if (!id) continue;
    cells.set(id, (cells.get(id) || 0) + n);
    from.set(id, [...(from.get(id) || []), k]);
  }
  const out = [];
  for (const [colorId, n] of cells) {
    const jars = Math.max(share >= 1 ? 1 : 0, Math.round(n * STOCK_PER_CELL * share));
    if (jars > 0) out.push({ colorId, jars, from: from.get(colorId) });
  }
  return out.sort((a, b) => b.jars - a.jars || (a.colorId < b.colorId ? -1 : 1));
}

/** quote(state, levelId, now) -> {coins, stock, repeat}: what lifting that painting pays now. */
export function quote(state, levelId, now = 0) {
  const L = levelById(levelId);
  if (!L) return { coins: 0, stock: [], repeat: false };
  const repeat = num(state && state.lift && state.lift.done && state.lift.done[L.id]) > 0;
  const share = repeat ? REPEAT_SHARE : 1;
  const coins = Math.max(0, num(orderBasePay(state, paintMinutes(L)) * incomeMultiplier(state, now) * share));
  return { coins, stock: stockFor(state, L, share), repeat };
}

/** The finish: coins, stock (what does not fit sells), the record, the hooks. */
function finish(state, L, now) {
  const t = ensureLift(state);
  const q = quote(state, L.id, now);
  const coins = earn(state, q.coins);
  const mult = incomeMultiplier(state, now);
  let sold = 0;
  const stock = [];
  for (const it of q.stock) {
    const kept = addStock(state, it.colorId, it.jars, 'standard');
    const rest = Math.max(0, it.jars - kept);
    if (rest > 0) sold += earn(state, rest * num(colorPrice(state, it.colorId, 'standard')) * mult);
    stock.push({ colorId: it.colorId, jars: kept, sold: rest });
  }
  t.done[L.id] = num(t.done[L.id]) + 1;
  t.lifted = num(t.lifted) + 1;
  t.paid = num(t.paid) + coins + sold;
  t.last = { levelId: L.id, coins, sold, stock, repeat: q.repeat, at: num(now) };
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  const colors = q.stock.map((it) => it.colorId);
  questEvent(state, 'paintingLifted', 1, { levelId: L.id });
  eventPoints(state, 'lifted', 1, { colors });
  emit(state, 'paintingLifted', { levelId: L.id, coins, sold, stock, repeat: q.repeat, lifted: t.lifted });
  return { levelId: L.id, coins, sold, stock, repeat: q.repeat, colors };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** nextLevelId(state, fromId) -> the next painting not yet lifted after fromId, else simply the next one. */
export function nextLevelId(state, fromId) {
  const done = (state && state.lift && state.lift.done) || {};
  const idx = Math.max(0, LEVEL_IDS.indexOf(fromId));
  return LEVEL_IDS.slice(idx + 1).find((id) => !done[id]) || LEVEL_IDS[(idx + 1) % LEVEL_IDS.length];
}

/** summary(state) -> a cheap read for the Puzzles hub card. */
export function summary(state) {
  const t = state && state.lift;
  const cur = t ? current(state) : null;
  const id = (cur && cur.L.id) || (t && levelById(t.cur) ? t.cur : LEVEL_IDS[0]);
  const L = levelById(id);
  const left = cur ? R.remaining(cur.s) : L.W * L.H;
  const done = t && isObj(t.done) ? Object.keys(t.done).filter((k) => levelById(k)).length : 0;
  return {
    open: unlocked(state),
    levelId: id,
    name: L.name,
    index: LEVEL_IDS.indexOf(id),
    total: LEVEL_IDS.length,
    playing: !!(cur && cur.moves.length && !cur.done),
    cleared: !!(cur && cur.done),
    progress: 1 - left / (L.W * L.H),
    h: cur ? cur.s.h.slice() : null,
    done,
    lifted: t ? num(t.lifted) : 0,
  };
}
