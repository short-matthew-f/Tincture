// sim/garden.js — The Dye Garden as sim actions on state (pure).
// The rules live in src/puzzles/garden.js (ported from proto/garden/); this
// module owns the save shape, a Wander visit in progress, the harvest bests,
// the dye shelf, the lost spindles, the pay (coins and a few jars of stock),
// and the hooks for quests and events.
//
// state.garden = {
//   visits: 0,                       // finished visits
//   bests: { [placeId]: Score },     // harvest bests per place (the fixed garden)
//   daily: { day: '', bests: {} },   // harvest bests in today's garden (one day kept)
//   spindles: 0,                     // lost spindles found
//   spindleKeys: [],                 // 'place:mode:seed' of the gardens they came from (last SPINDLE_KEEP)
//   shelf: { [dyeId]: units },       // the dye shelf: every dye she has gathered (JAR units a jar)
//   cur: null | Resume,              // a Wander visit in progress (resumes where she left off)
//   settings: { sound: false, today: false },  // garden sounds (off by default), Today's garden for harvests
//   paid: 0,                         // coins the garden has paid, all time
//   last: null | Last,               // the last visit's pay, for the hub card
//   path: { done: {[levelId]: {stars, at}}, seen: {[introKey]: true} },  // the Garden Path
// }
// Score  = { jars, level, units, plants, spare }
// Resume = { place, mode:'wander'|'path', gen, seed, got:[plant ids], x, y, found:[find indices], cw?, sw? }
//          (a path visit: place is the garden's id, gen is PATH_GEN, cw: the cat woke, sw: her biggest sweep)
// Last   = { placeId, mode, plants, coins, jars, stock:[{colorId, jars}], at }
//
// Modes (puzzles/garden.js MODES): Wander has no clock and is the default;
// Harvest before dusk is opt-in (about two minutes, a fixed garden per place
// so bests are fair, the neighbor's goat). Neither can fail: every visit pays
// for what she gathered, however it ends.
//
// The Garden Path (puzzles/garden-path.js): 108 numbered gardens in order. A
// garden is done (and the next one opens) the first time its main goal is
// met; 1-3 stars never block anything. reachGoal records it the moment the
// goal is met mid-visit; finishVisit({mode:'path'}) banks the visit (the same
// pay as a Wander visit, the goal paying like the bonus goal) and keeps her
// best stars. Path visits resume like Wander visits (state.garden.cur).
//
// Pay (kept modest so hand orders stay the best coins per active minute; see
// tools/balance/TUNING.md "Dye Garden"):
//   coins = jars gathered × JAR_MINUTES × orders.orderBasePay(state, 1)
//           (+ GOAL_MINUTES of it when the visit's bonus goal is met), × incomeMultiplier.
//   stock = for each dye gathered, STOCK_PER_JAR jars per jar of dye (at least
//           one; STOCK_MAX a visit in all, biggest dyes first) of her nearest discovered color (OKLab ΔE to the dye), added
//           with storage.addStock, so free storage caps it; what does not fit
//           stays on the dye shelf (nothing is lost, no coins in its place).
//           Her keep reserves (state.keep) are never touched.
//
// Hooks (only existing exports are called), once per finished visit that
// gathered anything:
//   questEvent(state, 'gardenVisit', 1, {placeId, mode})
//   eventPoints(state, 'harvest', 1, {colors: [nearest discovered color ids]})
// Domain events (bus): 'gardenVisit' {placeId, mode, coins, jars, isNew},
// 'spindle' {count}.

import * as R from '../puzzles/garden.js';
import * as PATH from '../puzzles/garden-path.js';
import { emit } from './bus.js';
import { deltaEHex } from '../color.js';
import { colorHex, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { addStock } from './storage.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { dayKey } from '../format.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** A jar of dye pays this many minutes of an order's base pay. */
export const JAR_MINUTES = 0.025;
/** A met bonus goal adds this many minutes of an order's base pay. */
export const GOAL_MINUTES = 0.5;
/** Jars of stock per jar of a dye gathered (each dye gives at least one), at most STOCK_MAX a visit. */
export const STOCK_PER_JAR = 0.15;
export const STOCK_MAX = 12;
/** Spindle garden keys kept (the count itself is kept forever). */
export const SPINDLE_KEEP = 60;

/** Fresh state.garden (createInitialState has the same shape inline). */
export function initialGarden() {
  return {
    visits: 0, bests: {}, daily: { day: '', bests: {} }, spindles: 0, spindleKeys: [], shelf: {},
    cur: null, settings: { sound: false, today: false }, paid: 0, last: null, path: { done: {}, seen: {} },
  };
}

function cleanScore(s) {
  if (!isObj(s)) return null;
  return {
    jars: Math.max(0, Math.floor(num(s.jars))), level: Math.max(1, Math.floor(num(s.level, 1))),
    units: Math.max(0, num(s.units)), plants: Math.max(0, Math.floor(num(s.plants))), spare: Math.max(0, num(s.spare)),
  };
}
function cleanBests(b) {
  const out = {};
  if (!isObj(b)) return out;
  for (const [k, v] of Object.entries(b)) { const s = cleanScore(v); if (R.PLACE_BY_ID[k] && s) out[k] = s; }
  return out;
}

/** A saved Wander or Garden Path visit, or null when it cannot be resumed (another layout version, a bad place). */
function cleanCur(c) {
  if (!isObj(c)) return null;
  const path = c.mode === 'path';
  if (path ? c.gen !== PATH.PATH_GEN || !PATH.LEVEL_BY_ID[c.place] : c.gen !== R.GEN || !R.PLACE_BY_ID[c.place] || c.mode !== 'wander') return null;
  const seed = Number(c.seed) >>> 0;
  if (!seed || (path && seed !== PATH.LEVEL_BY_ID[c.place].seed)) return null;
  const ints = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0) : []);
  const out = {
    place: c.place, mode: path ? 'path' : 'wander', gen: path ? PATH.PATH_GEN : R.GEN, seed, got: ints(c.got),
    x: Number.isFinite(c.x) ? c.x : null, y: Number.isFinite(c.y) ? c.y : null, found: ints(c.found),
  };
  if (path) { out.cw = c.cw === true; out.sw = Math.max(0, Math.floor(num(c.sw))); }
  return out;
}

/** state.garden.path repaired: done only for gardens that exist, stars 1..3; seen intro keys. */
function cleanPath(p) {
  const out = { done: {}, seen: {} };
  if (!isObj(p)) return out;
  if (isObj(p.done)) {
    for (const [id, d] of Object.entries(p.done)) {
      if (!PATH.LEVEL_BY_ID[id] || !isObj(d)) continue;
      out.done[id] = { stars: Math.max(1, Math.min(3, Math.floor(num(d.stars, 1)))), at: num(d.at) };
    }
  }
  if (isObj(p.seen)) for (const [k, v] of Object.entries(p.seen)) if (v === true && typeof k === 'string' && k.length <= 40) out.seen[k] = true;
  return out;
}

/**
 * ensureGarden(state) -> state.garden, repaired in place: missing keys filled,
 * wrong types reset, a visit saved by another garden layout dropped (its
 * jars were never banked, so nothing is lost but the stroll).
 */
export function ensureGarden(state) {
  if (!isObj(state.garden)) state.garden = initialGarden();
  const g = state.garden;
  const d = initialGarden();
  for (const k of Object.keys(d)) if (g[k] === undefined) g[k] = d[k];
  g.visits = Math.max(0, Math.floor(num(g.visits)));
  g.bests = cleanBests(g.bests);
  if (!isObj(g.daily) || typeof g.daily.day !== 'string') g.daily = { day: '', bests: {} };
  g.daily.bests = cleanBests(g.daily.bests);
  g.spindles = Math.max(0, Math.floor(num(g.spindles)));
  if (!Array.isArray(g.spindleKeys)) g.spindleKeys = [];
  g.spindleKeys = g.spindleKeys.filter((k) => typeof k === 'string').slice(-SPINDLE_KEEP);
  if (!isObj(g.shelf)) g.shelf = {};
  for (const k of Object.keys(g.shelf)) if (!R.DYES[k] || !(num(g.shelf[k]) > 0)) delete g.shelf[k];
  g.cur = cleanCur(g.cur);
  if (!isObj(g.settings)) g.settings = { sound: false, today: false };
  g.settings.sound = g.settings.sound === true;
  g.settings.today = g.settings.today === true;
  g.paid = Math.max(0, num(g.paid));
  if (g.last !== null && !isObj(g.last)) g.last = null;
  g.path = cleanPath(g.path);
  return g;
}

/** Has she bought the Dye Garden (src/sim/unlocks.js 'garden')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.garden);
}

// ---------------------------------------------------------------------------
// Settings, the visit in progress, spindles
// ---------------------------------------------------------------------------

/** setSetting(state, {key:'sound'|'today', value}) -> {ok, settings}. */
export function setSetting(state, { key, value } = {}) {
  const g = ensureGarden(state);
  if (key !== 'sound' && key !== 'today') return { ok: false, reason: 'key' };
  g.settings[key] = !!value;
  return { ok: true, settings: { ...g.settings } };
}

/**
 * saveVisit(state, {place, seed, got, x, y, found, mode?, cw?, sw?}) -> {ok}. Keeps a Wander
 * (or Garden Path: mode 'path', place = the garden's id) visit so she picks up where
 * she left off (the jars are banked when she heads home). Harvests are never
 * saved: leaving one banks it at once.
 */
export function saveVisit(state, args = {}) {
  const g = ensureGarden(state);
  const path = args.mode === 'path';
  const cur = cleanCur({ ...args, mode: path ? 'path' : 'wander', gen: path ? PATH.PATH_GEN : R.GEN });
  if (!cur) return { ok: false, reason: 'visit' };
  if (path && !pathOpen(state, cur.place)) return { ok: false, reason: 'locked' };
  cur.got = cur.got.slice(0, 5000);
  if (cur.x !== null) cur.x = Math.round(cur.x);
  if (cur.y !== null) cur.y = Math.round(cur.y);
  g.cur = cur;
  return { ok: true };
}

/** clearVisit(state) -> {ok}: drops the saved Wander visit (nothing was banked yet). */
export function clearVisit(state) {
  ensureGarden(state).cur = null;
  return { ok: true };
}

export const spindleKey = (placeId, mode, seed) => `${placeId}:${mode}:${seed >>> 0}`;

/** Has a spindle from this very garden already come home? (Then it does not show again.) */
export function hasSpindle(state, key) {
  const g = state && state.garden;
  return !!(g && Array.isArray(g.spindleKeys) && g.spindleKeys.includes(key));
}

/** keepSpindle(state, {key}) -> {ok, count, isNew}: a lost spindle comes home (kept at once). */
export function keepSpindle(state, { key } = {}) {
  const g = ensureGarden(state);
  if (typeof key !== 'string' || !key) return { ok: false, reason: 'key', count: g.spindles };
  if (g.spindleKeys.includes(key)) return { ok: true, count: g.spindles, isNew: false };
  g.spindleKeys.push(key);
  if (g.spindleKeys.length > SPINDLE_KEEP) g.spindleKeys.splice(0, g.spindleKeys.length - SPINDLE_KEEP);
  g.spindles += 1;
  emit(state, 'spindle', { count: g.spindles });
  return { ok: true, count: g.spindles, isNew: true };
}

// ---------------------------------------------------------------------------
// Colors and pay
// ---------------------------------------------------------------------------

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/** nearestColor(state, dyeId) -> her discovered color id closest to the dye (ΔE), or null. */
export function nearestColor(state, dyeId) {
  const dye = R.DYES[dyeId];
  if (!dye) return null;
  let best = null;
  let bd = Infinity;
  for (const id of discoveredIds(state)) {
    const d = deltaEHex(dye.hex, colorHex(id));
    if (d < bd || (d === bd && id < best)) { bd = d; best = id; }
  }
  return best;
}

/** Coins one jar of dye pays now. */
export function coinsPerJar(state, now) {
  return Math.max(0, num(orderBasePay(state, 1) * JAR_MINUTES * incomeMultiplier(state, now)));
}

/** Coins a met bonus goal adds. */
export function goalCoins(state, now) {
  return Math.max(0, num(orderBasePay(state, GOAL_MINUTES) * incomeMultiplier(state, now)));
}

/** quote(state, now) -> {perJar, goal} for the screen's pay line. */
export function quote(state, now) {
  return { perJar: coinsPerJar(state, now), goal: goalCoins(state, now) };
}

/**
 * stockFor(state, haul) -> [{colorId, jars, dyes:[dyeId]}]: the jars of stock a
 * haul (puzzles/garden.js tally rows) brings home, merged per color.
 */
export function stockFor(state, haul) {
  const by = new Map();
  let room = STOCK_MAX;
  const rows = (Array.isArray(haul) ? haul : []).filter((row) => row && num(row.units) > 0 && R.DYES[row.dye])
    .sort((a, b) => num(b.units) - num(a.units) || (a.dye < b.dye ? -1 : 1));
  for (const row of rows) {
    if (room <= 0) break;
    const colorId = nearestColor(state, row.dye);
    if (!colorId) continue;
    const jars = Math.min(room, Math.max(1, Math.round((num(row.units) / R.JAR) * STOCK_PER_JAR)));
    room -= jars;
    const e = by.get(colorId) || { colorId, jars: 0, dyes: [] };
    e.jars += jars;
    e.dyes.push(row.dye);
    by.set(colorId, e);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------------------
// Finishing a visit
// ---------------------------------------------------------------------------

function bestFor(state, placeId, daily, day) {
  const g = state && state.garden;
  if (!isObj(g)) return null;
  if (daily) return isObj(g.daily) && g.daily.day === day && isObj(g.daily.bests) ? g.daily.bests[placeId] || null : null;
  return isObj(g.bests) ? g.bests[placeId] || null : null;
}

/** bestOf(state, placeId, {daily, day}) -> Score|null: her harvest best there (today's garden when daily). */
export function bestOf(state, placeId, { daily = false, day = '' } = {}) {
  return bestFor(state, placeId, daily, day);
}

/**
 * finishVisit(state, {placeId, mode, seed, day?, got, spare?, reason?}, now) ->
 * {ok, placeId, mode, reason, plants, units, jars, haul, coins, jarCoins, goalCoins,
 *  goal:{s, need, have, met, dye}, stock:[{colorId, jars, added}], stockLeft,
 *  score?, prev?, isNew, daily, fact, visits} | {ok:false, reason}.
 * Banks a visit: the garden is regenerated from (place, seed, mode) so the
 * haul, goal and score are worked out here, never trusted from the screen.
 * reasons: 'locked' | 'place' | 'seed'.
 */
export function finishVisit(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const gs = ensureGarden(state);
  if (args.mode === 'path') return finishPath(state, gs, args, now);
  const placeId = args.placeId;
  if (!R.PLACE_BY_ID[placeId]) return { ok: false, reason: 'place' };
  const mode = args.mode === 'harvest' ? 'harvest' : 'wander';
  const seed = Number(args.seed) >>> 0;
  if (!seed) return { ok: false, reason: 'seed' };
  let daily = false;
  let day = typeof args.day === 'string' && args.day ? args.day : dayKey(num(now));
  if (mode === 'harvest') {
    // A harvest is the fixed garden (fair bests) or today's garden; nothing else counts as one.
    if (seed === R.harvestSeed(placeId)) daily = false;
    else if (seed === R.harvestSeed(placeId, day)) daily = true;
    else return { ok: false, reason: 'seed' };
  }
  const g = R.gardenFor(placeId, seed, mode);
  const visit = R.restoreVisit(g, args.got);
  const haul = R.tally(g, visit.got);
  const units = haul.reduce((s, t) => s + t.units, 0);
  const jars = units / R.JAR;
  const goalDef = R.goalFor(g);
  const gp = R.goalProgress(g, goalDef, visit.got);
  const goal = { s: goalDef.s, dye: goalDef.dye, need: gp.need, have: gp.have, met: gp.met };

  // Coins
  const jarCoins = earn(state, jars * coinsPerJar(state, now));
  const bonus = goal.met ? earn(state, goalCoins(state, now)) : 0;
  const coins = jarCoins + bonus;
  gs.paid = num(gs.paid) + coins;

  // A few jars of stock of her nearest colors (free storage caps it)
  const stock = stockFor(state, haul).map((e) => {
    const added = addStock(state, e.colorId, e.jars, 'standard');
    return { colorId: e.colorId, jars: e.jars, added, dyes: e.dyes };
  });
  const stockLeft = stock.reduce((s, e) => s + Math.max(0, e.jars - e.added), 0);

  // The dye shelf keeps every dye she has gathered
  for (const t of haul) gs.shelf[t.dye] = num(gs.shelf[t.dye]) + t.units;

  // Harvest score and bests
  let score = null;
  let prev = null;
  let isNew = false;
  if (mode === 'harvest') {
    const spare = args.reason === 'done' || args.reason === 'cleared' ? num(args.spare) : 0;
    score = R.harvestScore(g, visit.got, visit.mass, Math.min(R.MODES.harvest.secs, spare));
    prev = bestFor(state, placeId, daily, day);
    isNew = score.plants > 0 && R.betterScore(score, prev);
    if (isNew) {
      const s = cleanScore(score);
      if (daily) {
        if (gs.daily.day !== day) gs.daily = { day, bests: {} };
        gs.daily.bests[placeId] = s;
      } else gs.bests[placeId] = s;
    }
  }

  const fact = R.pickFact(g, visit.got, gs.visits);
  gs.visits += 1;
  if (mode === 'wander') gs.cur = null;
  gs.last = {
    placeId, mode, plants: visit.got.length, coins: Math.round(coins), jars: Math.floor(jars),
    stock: stock.filter((e) => e.added > 0).map((e) => ({ colorId: e.colorId, jars: Math.round(e.added) })), at: num(now),
  };

  if (visit.got.length > 0) {
    const colors = [...new Set(stock.map((e) => e.colorId))];
    questEvent(state, 'gardenVisit', 1, { placeId, mode });
    eventPoints(state, 'harvest', 1, { colors });
  }
  emit(state, 'gardenVisit', { placeId, mode, coins, jars: Math.floor(jars), isNew });
  return {
    ok: true, placeId, mode, reason: args.reason || 'home', plants: visit.got.length, units, jars, haul,
    coins, jarCoins, goalCoins: bonus, goal, stock, stockLeft, score, prev, isNew, daily, fact, visits: gs.visits,
  };
}

// ---------------------------------------------------------------------------
// The Garden Path
// ---------------------------------------------------------------------------

/** pathOpen(state, levelId) -> can she play this garden (the first, or the one before it is done)? */
export function pathOpen(state, levelId) {
  const k = PATH.levelIndex(levelId);
  if (k < 0) return false;
  if (k === 0) return true;
  const done = state && state.garden && isObj(state.garden.path) && isObj(state.garden.path.done) ? state.garden.path.done : {};
  return !!done[PATH.LEVELS[k - 1].id];
}

/** Stars flags from the screen (stars are only stars, so they are taken on trust), made safe. */
function cleanFlags(f) {
  const o = isObj(f) ? f : {};
  return {
    eaten: Math.max(0, Math.floor(num(o.eaten))), sweep: Math.max(0, Math.floor(num(o.sweep))), spindle: o.spindle === true,
    catWoke: o.catWoke === true, sun: o.sun === true, beforeDusk: o.beforeDusk === true,
  };
}

/** Record the main goal: done (and the next garden open) the first time. Returns {first, stars, prev}. */
function recordPath(state, level, sc, now) {
  const gs = state.garden;
  const prev = gs.path.done[level.id] || null;
  if (!sc.met) return { first: false, stars: 0, prev: prev ? prev.stars : 0 };
  const stars = Math.max(prev ? prev.stars : 0, sc.stars);
  gs.path.done[level.id] = { stars, at: prev ? prev.at : num(now) };
  return { first: !prev, stars, prev: prev ? prev.stars : 0 };
}

/**
 * reachGoal(state, {levelId, got, flags}, now) -> {ok, met, first, next}: the main goal met
 * mid-visit. Checked from the gathered ids; marks the garden done at once, so the
 * next one opens even if she never heads home. Pays nothing (finishVisit does).
 */
export function reachGoal(state, args = {}, now = 0) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  ensureGarden(state);
  const level = PATH.LEVEL_BY_ID[args.levelId];
  if (!level) return { ok: false, reason: 'place' };
  if (!pathOpen(state, level.id)) return { ok: false, reason: 'locked' };
  const g = PATH.pathGarden(level.id);
  const visit = R.restoreVisit(g, args.got);
  const flags = cleanFlags(args.flags);
  // the goal itself never needs the sun; the dusk star is counted when the visit is banked
  const sc = PATH.score(level, g, visit.got, { ...flags, sun: false });
  if (!sc.met) return { ok: true, met: false, first: false, next: null };
  const r = recordPath(state, level, { met: true, stars: 1 }, now);
  const next = PATH.LEVELS[level.n] || null;
  if (r.first) emit(state, 'gardenPath', { levelId: level.id, n: level.n, first: true });
  return { ok: true, met: true, first: r.first, next: next ? next.id : null };
}

function finishPath(state, gs, args, now) {
  const level = PATH.LEVEL_BY_ID[args.levelId || args.placeId];
  if (!level) return { ok: false, reason: 'place' };
  if (!pathOpen(state, level.id)) return { ok: false, reason: 'locked' };
  const seed = Number(args.seed ?? level.seed) >>> 0;
  if (seed !== level.seed) return { ok: false, reason: 'seed' };
  const g = PATH.pathGarden(level.id);
  const visit = R.restoreVisit(g, args.got);
  const haul = R.tally(g, visit.got);
  const units = haul.reduce((s, t) => s + t.units, 0);
  const jars = units / R.JAR;
  const flags = cleanFlags(args.flags);
  const sc = PATH.score(level, g, visit.got, flags);

  const jarCoins = earn(state, jars * coinsPerJar(state, now));
  const bonus = sc.met ? earn(state, goalCoins(state, now)) : 0;
  const coins = jarCoins + bonus;
  gs.paid = num(gs.paid) + coins;
  const stock = stockFor(state, haul).map((e) => ({ colorId: e.colorId, jars: e.jars, added: addStock(state, e.colorId, e.jars, 'standard'), dyes: e.dyes }));
  const stockLeft = stock.reduce((s, e) => s + Math.max(0, e.jars - e.added), 0);
  for (const t of haul) gs.shelf[t.dye] = num(gs.shelf[t.dye]) + t.units;

  const before = gs.path.done[level.id] || null;
  const rec = recordPath(state, level, sc, now);
  const fact = R.pickFact(g, visit.got, gs.visits);
  gs.visits += 1;
  if (gs.cur && gs.cur.mode === 'path') gs.cur = null;
  gs.last = {
    placeId: level.id, mode: 'path', plants: visit.got.length, coins: Math.round(coins), jars: Math.floor(jars),
    stock: stock.filter((e) => e.added > 0).map((e) => ({ colorId: e.colorId, jars: Math.round(e.added) })), at: num(now),
  };
  if (visit.got.length > 0) {
    questEvent(state, 'gardenVisit', 1, { placeId: level.id, mode: 'path' });
    eventPoints(state, 'harvest', 1, { colors: [...new Set(stock.map((e) => e.colorId))] });
  }
  // first: done for the first time in this visit (reachGoal may already have recorded it mid-visit)
  const first = rec.first || (sc.met && !!args.firstMet);
  if (rec.first) emit(state, 'gardenPath', { levelId: level.id, n: level.n, first: true });
  emit(state, 'gardenVisit', { placeId: level.id, mode: 'path', coins, jars: Math.floor(jars), isNew: first });
  const next = PATH.LEVELS[level.n] || null;
  return {
    ok: true, placeId: level.id, levelId: level.id, mode: 'path', reason: args.reason || 'home', plants: visit.got.length, units, jars, haul,
    coins, jarCoins, goalCoins: bonus, goal: { met: sc.met, have: sc.main.have, need: sc.main.need }, stock, stockLeft,
    score: null, prev: null, isNew: false, daily: false, fact, visits: gs.visits,
    path: { met: sc.met, stars: sc.met ? sc.stars : 0, best: rec.stars || (before ? before.stars : 0), prevStars: before ? before.stars : 0, first, extras: sc.extras.map((e) => ({ text: e.text, met: e.met && sc.met, have: e.have, need: e.need })), next: next ? next.id : null },
  };
}

/** seeIntro(state, {key}) -> {ok}: an intro card (a new plant or a new mechanic) has been shown. */
export function seeIntro(state, { key } = {}) {
  const g = ensureGarden(state);
  if (typeof key !== 'string' || !key || key.length > 40) return { ok: false, reason: 'key' };
  g.path.seen[key] = true;
  return { ok: true };
}

/**
 * pathSummary(state) -> {total, done, stars, maxStars, next:levelId|null, nextN, chapters:[{id, name, done, total, stars, open}]}.
 * next: the first garden not done yet (null when every garden is done).
 */
export function pathSummary(state) {
  const p = state && state.garden && isObj(state.garden.path) ? state.garden.path : { done: {} };
  const done = isObj(p.done) ? p.done : {};
  let nDone = 0, stars = 0, next = null;
  for (const l of PATH.LEVELS) {
    const d = done[l.id];
    if (d) { nDone++; stars += Math.max(1, Math.min(3, d.stars | 0)); } else if (!next) next = l;
  }
  const chapters = PATH.CHAPTERS.map((c) => {
    const ls = PATH.chapterLevels(c.id);
    const dn = ls.filter((l) => done[l.id]);
    return { id: c.id, name: c.name, total: ls.length, done: dn.length, stars: dn.reduce((s, l) => s + Math.max(1, Math.min(3, done[l.id].stars | 0)), 0), open: pathOpen(state, ls[0].id) };
  });
  return { total: PATH.LEVELS.length, done: nDone, stars, maxStars: PATH.LEVELS.length * 3, next: next ? next.id : null, nextN: next ? next.n : null, chapters };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** shelfList(state) -> [{dye, name, hex, units}] most first: the dye shelf. */
export function shelfList(state) {
  const sh = (state && state.garden && state.garden.shelf) || {};
  return Object.entries(sh).filter(([d, u]) => R.DYES[d] && num(u) > 0)
    .map(([d, u]) => ({ dye: d, name: R.DYES[d].name, hex: R.DYES[d].hex, units: num(u) }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/** summary(state) -> a cheap read for the Puzzles hub and Map cards. */
export function summary(state) {
  const g = state && state.garden;
  const cur = g && g.cur && (R.PLACE_BY_ID[g.cur.place] || (g.cur.mode === 'path' && PATH.LEVEL_BY_ID[g.cur.place])) ? g.cur : null;
  const ps = pathSummary(state);
  return {
    open: unlocked(state),
    visits: g ? num(g.visits) : 0,
    wandering: cur ? { placeId: cur.place, plants: Array.isArray(cur.got) ? cur.got.length : 0, ...(cur.mode === 'path' ? { mode: 'path' } : {}) } : null,
    path: { done: ps.done, total: ps.total, stars: ps.stars, next: ps.next, nextN: ps.nextN },
    harvests: g && isObj(g.bests) ? Object.keys(g.bests).length : 0,
    spindles: g ? num(g.spindles) : 0,
    shelfJars: Math.floor(shelfList(state).reduce((s, x) => s + x.units, 0) / R.JAR),
    last: g && isObj(g.last) ? g.last : null,
  };
}
