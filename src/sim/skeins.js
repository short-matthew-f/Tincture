// sim/skeins.js — the Winding Room (Skein Stacks) as sim actions on state (pure).
// The rules live in src/puzzles/skeins.js (mirrored in proto/skeins/rules.js),
// the 112 levels in eleven chapters in src/puzzles/skeins-levels.js; this
// module owns the save shape, her yarn colors, level progress, the newer
// mechanics' intro cards she has seen, the session (undo and the quiet stats),
// the coins, and the hooks for quests and events.
//
// state.skeins = {
//   li: 0,                     // the level on the table (index into LEVELS)
//   sess: Session|null,        // the level in play (see below); null: none yet
//   other: { [li]: Parked },   // unfinished levels she stepped away from (resume where she was)
//   finished: { [li]: true },  // levels finished at least once (level li+1 opens after li)
//   notes: { [li]: {finishes, moves, undos, clears, swaps, neat?} },  // quiet stats, never shown as a cost;
//                              // neat: finished within the level's basket of trays (its ribbon)
//   seen: { [mechanic]: true }, // intro cards she has read (snarl, order, basket, felt, spindle, preview, untie)
//   glyphs: null|boolean,      // color symbols; null follows settings.colorblind
//   hanks: 0, levels: 0,       // hanks tied and levels finished, in all
// }
// Session = { state: Level (+ level.colors: her six yarn ids), past: [Level] (the
//   last SAVE_HISTORY, oldest first), stats: {moves, undos, clears, swaps},
//   paid: coins this try has paid, paidHanks: hanks already paid (undo never
//   pays a hank twice), bonusPaid: the level bonus is paid }
// Parked = { state, stats, paid, paidHanks, bonusPaid } (no undo history).
//
// A reload mid-level resumes exactly: every placement is one act (saved at
// once), the level carries its own mulberry32 seed (`rs`), so the tray deals
// the same stacks again.
//
// Coins (kept modest so hand orders stay the best coins per active minute):
//   each hank pays HANK_MINUTES of an order's base pay (orders.orderBasePay(state, 1)),
//   and a finished level adds LEVEL_MINUTES more; both × incomeMultiplier, so the
//   room follows her income in every era. A hank re-tied after an Undo pays
//   nothing. See tools/balance/TUNING.md "Winding Room".
//
// Hooks for quests and events (only existing exports are called):
//   questEvent(state, 'hankTied', 1, {colorId}) per newly tied hank
//   eventPoints(state, 'hank', 1, {colors: [colorId]}) per newly tied hank
// Domain events (bus): 'hankTied' {colorId, coins}, 'skeinLevelDone' {level, coins, bonus, hanks,
// neat, chapterDone}.

import * as R from '../puzzles/skeins.js';
import { emit } from './bus.js';
import { stateRng } from '../rng.js';
import { deltaEHex } from '../color.js';
import { colorFamily, colorHex, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { CATALOG } from '../content/catalog.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** One hank pays this many minutes of an order's base pay. */
export const HANK_MINUTES = 0.2;
/** A finished level pays this many minutes of an order's base pay on top. */
export const LEVEL_MINUTES = 0.75;
/** Undo steps kept in the save (the prototype's save kept the same 120). */
export const SAVE_HISTORY = 120;
export const YARN_COUNT = 6;
export const LEVEL_COUNT = R.LEVELS.length;

const STAT_KEYS = ['moves', 'undos', 'clears', 'swaps'];
const zeroStats = () => ({ moves: 0, undos: 0, clears: 0, swaps: 0 });

/** Fresh state.skeins (createInitialState mirrors it). */
export function initialSkeins() {
  return { li: 0, sess: null, other: {}, finished: {}, notes: {}, glyphs: null, hanks: 0, levels: 0, seen: {} };
}

function cleanStats(x) {
  const out = zeroStats();
  if (isObj(x)) for (const k of STAT_KEYS) out[k] = Math.max(0, Math.floor(num(x[k])));
  return out;
}

function validColors(c) {
  return Array.isArray(c) && c.length === YARN_COUNT && c.every((id) => typeof id === 'string' && id) && new Set(c).size === YARN_COUNT;
}

/** A level state that fits its board and carries six yarn ids. */
function goodLevel(s, li) {
  return R.isValidLevel(s) && (li === undefined || s.level === li) && validColors(s.colors);
}

/** Repairs one session-like record in place; returns it, or null when it no longer fits. */
function repairRecord(x, li, { withPast }) {
  if (!isObj(x) || !goodLevel(x.state, li)) return null;
  x.stats = cleanStats(x.stats);
  x.paid = Math.max(0, num(x.paid));
  x.paidHanks = Math.max(0, Math.floor(num(x.paidHanks, x.state.hanks.length)));
  x.bonusPaid = !!x.bonusPaid;
  if (withPast) {
    const past = Array.isArray(x.past) ? x.past.filter((p) => goodLevel(p, li)) : [];
    x.past = past.slice(-SAVE_HISTORY);
  } else delete x.past;
  return x;
}

/**
 * ensureSkeins(state) -> state.skeins, repaired in place: missing keys filled,
 * a saved level that no longer fits its board dropped (the room never locks).
 */
export function ensureSkeins(state) {
  if (!isObj(state.skeins)) state.skeins = initialSkeins();
  const k = state.skeins;
  const d = initialSkeins();
  for (const key of Object.keys(d)) if (k[key] === undefined) k[key] = d[key];
  k.li = Number.isInteger(k.li) && k.li >= 0 && k.li < LEVEL_COUNT ? k.li : 0;
  if (!isObj(k.finished)) k.finished = {};
  for (const key of Object.keys(k.finished)) if (!(+key >= 0 && +key < LEVEL_COUNT) || !k.finished[key]) delete k.finished[key];
  if (!isObj(k.notes)) k.notes = {};
  if (!isObj(k.seen)) k.seen = {};
  for (const key of Object.keys(k.seen)) if (!R.MECHANICS[key] || k.seen[key] !== true) delete k.seen[key];
  if (!isObj(k.other)) k.other = {};
  for (const key of Object.keys(k.other)) if (!repairRecord(k.other[key], +key, { withPast: false })) delete k.other[key];
  if (k.sess !== null && !repairRecord(k.sess, k.li, { withPast: true })) k.sess = null;
  if (k.glyphs !== null && typeof k.glyphs !== 'boolean') k.glyphs = null;
  k.hanks = Math.max(0, Math.floor(num(k.hanks)));
  k.levels = Math.max(0, Math.floor(num(k.levels)));
  return k;
}

/** Has she bought the Winding Room (src/sim/unlocks.js 'skeins')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.skeins);
}

// ---------------------------------------------------------------------------
// Yarns: her six colors
// ---------------------------------------------------------------------------

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/**
 * defaultYarns(state) -> six distinct color ids for a new level. Slot k is the
 * prototype's natural dye k (madder, weld, woad, walnut, cochineal, nettle):
 * each slot takes her discovered color nearest that dye from a hue family not
 * used yet, so the six read apart; once her families run out, the color
 * furthest from the ones already chosen (glyphs keep them apart too). Catalog
 * colors fill in only when she has fewer than six colors.
 */
export function defaultYarns(state) {
  let pool = discoveredIds(state);
  if (pool.length < YARN_COUNT) pool = pool.concat(CATALOG.map((c) => c.id).filter((id) => !pool.includes(id)));
  const out = [];
  const fams = new Set();
  for (let k = 0; k < YARN_COUNT; k++) {
    const left = pool.filter((id) => !out.includes(id));
    if (!left.length) break;
    const fresh = left.filter((id) => !fams.has(colorFamily(id)));
    let best = null;
    if (fresh.length) {
      let bd = Infinity;
      for (const id of fresh) { const d = deltaEHex(colorHex(id), R.COLORS[k].hex); if (d < bd) { bd = d; best = id; } }
    } else {
      let bd = -1;
      for (const id of left) {
        const d = out.length ? Math.min(...out.map((o) => deltaEHex(colorHex(id), colorHex(o)))) : 100;
        if (d > bd) { bd = d; best = id; }
      }
    }
    out.push(best);
    fams.add(colorFamily(best));
  }
  return out;
}

/** The six yarn ids of the level on the table (or the next level's). */
export function yarns(state) {
  const s = state && state.skeins && state.skeins.sess && state.skeins.sess.state;
  if (s && validColors(s.colors)) return s.colors.slice();
  return defaultYarns(state);
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

/** Coins one hank pays now. */
export function coinsPerHank(state, now) {
  return Math.max(0, num(orderBasePay(state, 1) * HANK_MINUTES * incomeMultiplier(state, now)));
}

/** Coins a finished level adds on top of its hanks. */
export function levelBonusCoins(state, now) {
  return Math.max(0, num(orderBasePay(state, LEVEL_MINUTES) * incomeMultiplier(state, now)));
}

/** quote(state, now) -> {perHank, levelBonus} for the screen's reward line. */
export function quote(state, now) {
  return { perHank: coinsPerHank(state, now), levelBonus: levelBonusCoins(state, now) };
}

function pay(state, sess, coins) {
  const c = earn(state, coins);
  sess.paid = num(sess.paid) + c;
  return c;
}

// ---------------------------------------------------------------------------
// Levels and progress
// ---------------------------------------------------------------------------

/** isOpen(state, li) -> level 1 always; level li+1 once level li is finished. */
export function isOpen(state, li) {
  if (!(Number.isInteger(li) && li >= 0 && li < LEVEL_COUNT)) return false;
  const f = (state && state.skeins && state.skeins.finished) || {};
  return li === 0 || !!f[li - 1] || !!f[li];
}

/** The furthest level she can play (index). */
export function maxOpen(state) {
  let li = 0;
  while (li + 1 < LEVEL_COUNT && isOpen(state, li + 1)) li++;
  return li;
}

/**
 * nextLevel(state) -> the level "Continue" plays: the level on the table while
 * it is unfinished, else the first open level she has not finished yet (the
 * newest one), else -1 when every level is finished.
 */
export function nextLevel(state) {
  const k = state && state.skeins;
  if (k && k.sess && k.sess.state && !k.sess.state.done && Number.isInteger(k.li)) return k.li;
  const f = (k && k.finished) || {};
  const top = maxOpen(state);
  if (!f[top]) return top;
  for (let li = 0; li < LEVEL_COUNT; li++) if (!f[li] && isOpen(state, li)) return li;
  return -1;
}

/** chapters(state) -> [{index, id, name, blurb, first, count, finished, open}] for the level list. */
export function chapters(state) {
  const f = (state && state.skeins && state.skeins.finished) || {};
  return R.CHAPTERS.map((c, index) => {
    const first = R.chapterStart(index);
    let finished = 0;
    for (let li = first; li < first + c.levels; li++) if (f[li]) finished++;
    return { index, id: c.id, name: c.name, blurb: c.blurb, first, count: c.levels, finished, open: isOpen(state, first) };
  });
}

/** introsFor(state, li) -> the mechanics level li uses that she has not read the card for yet. */
export function introsFor(state, li = state && state.skeins ? state.skeins.li : 0) {
  const seen = (state && state.skeins && state.skeins.seen) || {};
  return R.levelMechanics(li).filter((m) => !seen[m]);
}

/** seeIntro(state, {mechanics}) -> {ok}: she has read these intro cards. */
export function seeIntro(state, { mechanics } = {}) {
  const k = ensureSkeins(state);
  for (const m of Array.isArray(mechanics) ? mechanics : []) if (R.MECHANICS[m]) k.seen[m] = true;
  return { ok: true };
}

function newSess(state, li) {
  const seed = (Math.floor(stateRng(state)() * 4294967296) >>> 0) || 1;
  const sess = R.newSession(li, seed);
  sess.state.colors = defaultYarns(state);
  return { ...sess, paid: 0, paidHanks: 0, bonusPaid: false };
}

/**
 * startLevel(state, {level, fresh}, now) -> {ok, level, resumed} | {ok:false, reason}.
 * The prototype's startLevel: the level in play steps aside (unfinished ones
 * wait in `other`), then level `level` resumes where she left it, or deals
 * fresh (`fresh`, or nothing to resume). reasons: 'locked' | 'level' | 'closed'.
 */
export function startLevel(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const k = ensureSkeins(state);
  const li = Number.isInteger(args.level) ? args.level : k.li;
  if (!(li >= 0 && li < LEVEL_COUNT)) return { ok: false, reason: 'level' };
  if (!isOpen(state, li)) return { ok: false, reason: 'closed' };
  if (k.sess && !k.sess.state.done) {
    const { state: st, stats, paid, paidHanks, bonusPaid } = k.sess;
    k.other[k.li] = { state: st, stats, paid, paidHanks, bonusPaid };
  }
  k.li = li;
  const o = k.other[li];
  let resumed = false;
  if (!args.fresh && o && goodLevel(o.state, li) && !o.state.done) {
    k.sess = { state: o.state, past: [], stats: cleanStats(o.stats), paid: num(o.paid), paidHanks: num(o.paidHanks), bonusPaid: !!o.bonusPaid };
    resumed = true;
  } else {
    k.sess = newSess(state, li);
  }
  delete k.other[li];
  return { ok: true, level: li, resumed };
}

/** ensureLevel(state) -> {ok}: deals the level on the table when there is none yet (first visit, broken save). */
export function ensureLevel(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const k = ensureSkeins(state);
  if (k.sess) return { ok: true, dealt: false };
  if (!isOpen(state, k.li)) k.li = maxOpen(state);
  const r = startLevel(state, { level: k.li }, now);
  return { ...r, dealt: r.ok };
}

function record(sess, r, stat) {
  sess.past = sess.past.concat([sess.state]).slice(-SAVE_HISTORY);
  sess.state = r.state;
  sess.stats = { ...sess.stats, [stat]: num(sess.stats[stat]) + 1 };
}

/** Pays and reports every hank past the ones this try already paid for (an Undo never pays twice). */
function payHanks(state, sess, now) {
  const all = sess.state.hanks;
  const colors = sess.state.colors;
  const fresh = [];
  for (let i = num(sess.paidHanks); i < all.length; i++) {
    const colorId = colors[all[i]];
    const coins = pay(state, sess, coinsPerHank(state, now));
    questEvent(state, 'hankTied', 1, { colorId });
    eventPoints(state, 'hank', 1, { colors: [colorId] });
    emit(state, 'hankTied', { colorId, coins });
    fresh.push({ color: all[i], colorId, coins });
  }
  sess.paidHanks = Math.max(num(sess.paidHanks), all.length);
  state.skeins.hanks = num(state.skeins.hanks) + fresh.length;
  return fresh;
}

function finishLevel(state, now) {
  const k = state.skeins;
  const sess = k.sess;
  const li = sess.state.level;
  let bonus = 0;
  if (!sess.bonusPaid) {
    bonus = pay(state, sess, levelBonusCoins(state, now));
    sess.bonusPaid = true;
    k.levels = num(k.levels) + 1;
    if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
    const n = isObj(k.notes[li]) ? k.notes[li] : { finishes: 0, moves: 0, undos: 0, clears: 0, swaps: 0 };
    const neat = R.goalOf(li).trays > 0 && R.withinBasket(sess.state);
    k.notes[li] = {
      finishes: num(n.finishes) + 1, moves: num(n.moves) + sess.stats.moves, undos: num(n.undos) + sess.stats.undos,
      clears: num(n.clears) + sess.stats.clears, swaps: num(n.swaps) + sess.stats.swaps,
    };
    if (n.neat || neat) k.notes[li].neat = true;
    const ch = R.chapterOf(li);
    const chapterDone = li === R.chapterStart(ch) + R.CHAPTERS[ch].levels - 1;
    emit(state, 'skeinLevelDone', { level: li, coins: Math.round(num(sess.paid)), bonus, hanks: sess.state.hanks.length, neat, chapterDone });
  }
  k.finished[li] = true;
  return bonus;
}

/**
 * place(state, {t, cell}, now) -> {ok, steps, hanks, refilled, paid:[{color, colorId, coins}],
 * coins, done, bonus} | {ok:false, reason}. A tray stack onto an empty peg; the
 * merge rule runs; new hanks pay and report; a met goal finishes the level.
 */
export function place(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const k = ensureSkeins(state);
  const sess = k.sess;
  if (!sess) return { ok: false, reason: 'none' };
  const r = R.place(sess.state, num(args.t, -1), num(args.cell, -1));
  if (!r.ok) return r;
  record(sess, r, 'moves');
  const paid = payHanks(state, sess, now);
  const coins = paid.reduce((a, p) => a + p.coins, 0);
  const bonus = sess.state.done ? finishLevel(state, now) : 0;
  return { ok: true, steps: r.steps, hanks: r.hanks, refilled: r.refilled, paid, coins, done: sess.state.done, bonus };
}

/** clearPeg(state, {cell}) -> {ok, removed}: the free nudge, a stack set aside. */
export function clearPeg(state, args = {}, now = 0) {
  const k = ensureSkeins(state);
  if (!k.sess) return { ok: false, reason: 'none' };
  const r = R.clearPeg(k.sess.state, num(args.cell, -1));
  if (!r.ok) return { ok: false, reason: 'peg' };
  record(k.sess, r, 'clears');
  const bonus = k.sess.state.done ? finishLevel(state, now) : 0;
  return { ok: true, removed: r.removed, done: k.sess.state.done, bonus };
}

/** swapTray(state) -> {ok}: the free nudge, three fresh stacks. */
export function swapTray(state) {
  const k = ensureSkeins(state);
  if (!k.sess) return { ok: false, reason: 'none' };
  const r = R.swapTray(k.sess.state);
  if (!r.ok) return { ok: false, reason: 'done' };
  record(k.sess, r, 'swaps');
  return { ok: true };
}

/** undo(state) -> {ok}: restores the previous level state exactly (not after the level is finished). */
export function undo(state) {
  const k = ensureSkeins(state);
  const sess = k.sess;
  if (!sess || !sess.past.length || sess.state.done) return { ok: false, reason: 'none' };
  sess.state = sess.past[sess.past.length - 1];
  sess.past = sess.past.slice(0, -1);
  sess.stats = { ...sess.stats, undos: num(sess.stats.undos) + 1 };
  return { ok: true };
}

/** setGlyphs(state, {on}) -> {ok, on}: color symbols on the yarn. */
export function setGlyphs(state, { on } = {}) {
  const k = ensureSkeins(state);
  k.glyphs = !!on;
  return { ok: true, on: k.glyphs };
}

/** glyphsOn(state) -> her choice, else settings.colorblind. */
export function glyphsOn(state) {
  const g = state && state.skeins && state.skeins.glyphs;
  if (typeof g === 'boolean') return g;
  return !!(state && state.settings && state.settings.colorblind);
}

/** situation(state) -> 'none' | 'ok' | 'tight' | 'stuck' | 'done' (the rules' read of the board). */
export function situation(state) {
  const s = state && state.skeins && state.skeins.sess && state.skeins.sess.state;
  return s ? R.situation(s) : 'none';
}

/** summary(state) -> a cheap read for the Puzzles hub card. */
export function summary(state) {
  const k = state && state.skeins;
  const s = k && k.sess && R.isValidLevel(k.sess.state) ? k.sess.state : null;
  const li = k && Number.isInteger(k.li) && k.li >= 0 && k.li < LEVEL_COUNT ? k.li : 0;
  const ch = R.chapterOf(li);
  return {
    open: unlocked(state),
    level: li,
    playing: !!(s && !s.done),
    done: !!(s && s.done),
    hanks: s ? s.hanks.length : 0,
    goal: R.goalOf(li).hanks,
    finished: k && isObj(k.finished) ? Object.keys(k.finished).length : 0,
    hanksAll: k ? num(k.hanks) : 0,
    maxOpen: maxOpen(state),
    next: nextLevel(state),
    levels: LEVEL_COUNT,
    chapter: ch,
    chapterName: R.CHAPTERS[ch].name,
  };
}
