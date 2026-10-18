// sim/commissions.js — multi-step commissions: two to three open at once, never
// expiring; steps filled by delivering stock (or a merged shelf container); rewards
// are a big Coin payout, a signature catalog color and a workshop trophy. Also the
// era capstone and Era Advance (Era 2 is not playable yet: "coming in a later update").
// Spec: DESIGN.md "Progression, eras and prestige" > "Commissions", "Era Advance".
//
// State: state.commissions = {open:[Rec], done:[id], later:[Rec]}
//   Rec = {id, started, steps:[{delivered, colors:{id:jars}, done}]}
//   `later` holds commissions set aside (by her, or because she cannot reach a
//   color they need yet); they come back, progress kept, when a slot is free.
//   Old saves have no `later`; ensure() adds it.
// Step requirements are read from content by commission id (never copied into the save).
//
// What a step accepts lives in sim/commission-rules.js. stepGuide() tells the
// UI, for one step, which of her colors count, how many jars or containers she
// can hand over now, and the single honest next action when none (make it in a
// mixer, purify, merge on the shelf, find it at the bench / on a board / with a
// hunter). refresh() only opens commissions whose every step has such a path
// (commissionFeasible), so a commission she cannot finish is never offered.

import { availableCommissions, getCommission, OPEN_COMMISSIONS } from '../content/commissions.js';
import { getEra, capstoneColorsRequired } from '../content/eras.js';
import { getRegion, REGIONS, isRegionUnlocked } from '../content/regions.js';
import { SOURCES } from '../content/sources.js';
import { getColor } from '../content/catalog.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { discover, discoveredCount } from './discovery.js';
import { takeStock, stockOf, PURITY_ORDER } from './storage.js';
import { incomeRate, cheapestUpgrade } from './economy.js';
import { earn, canMix } from './factory.js';
import { colorInfo } from './hunters.js';
import { shelfColors } from './shelf.js';
import {
  stepMatches, usesShelf, minTier, stepCandidates, distinctDelivered, roomFor, familiesOf,
} from './commission-rules.js';

export { familiesOf as commissionFamilies, usesShelf as stepUsesShelf } from './commission-rules.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

function ensure(state) {
  if (!state.commissions || typeof state.commissions !== 'object') state.commissions = { open: [], done: [], later: [] };
  const c = state.commissions;
  if (!Array.isArray(c.open)) c.open = [];
  if (!Array.isArray(c.done)) c.done = [];
  if (!Array.isArray(c.later)) c.later = [];
  return c;
}

function newRecord(def, now) {
  return { id: def.id, started: now, steps: def.steps.map(() => ({ delivered: 0, colors: {}, done: false })) };
}

const hasProgress = (rec) => (rec.steps || []).some((p) => p && (p.done || fin(p.delivered) > 0));

/** The current era's capstone commission definition (or null). */
export function capstoneDef(state) {
  const era = getEra(state.era ?? 1);
  return era ? getCommission(era.capstoneCommission) : null;
}

/** Commissions are a coin-bought unlock (Phase 3, src/sim/unlocks.js). */
export function commissionsOpen(state) {
  return (state?.phase ?? 1) >= 3 && !!state?.unlocks?.commissions;
}

// ---------------------------------------------------------------------------
// Reachability: can she get a color from where she is now?
// ---------------------------------------------------------------------------

const isMine = (state, id) => !!(state.catalog && state.catalog.discovered && state.catalog.discovered[id]);
const huntersOpen = (state) => !!(state.unlocks && state.unlocks.hunters);
/**
 * Can her hunters go to this region? Open now, or (before the Hue Hunters are bought) the
 * moment she buys them: the path then starts with "open the Hue Hunters".
 */
function regionOpen(state, regionId) {
  if (huntersOpen(state)) return ((state.hunters && state.hunters.regionsUnlocked) || []).includes(regionId);
  const r = getRegion(regionId);
  return !!r && r.kind === 'home' && isRegionUnlocked(r, { era: state.era ?? 1, colors: discoveredCount(state), hunters: true });
}
const shelfOpen = (state) => !!(state.unlocks && state.unlocks.shelf);

function ownsPigment(state, pigmentId) {
  if (pigmentId === 'white' || pigmentId === 'black') return true;
  const s = state.stations && state.stations.sources && state.stations.sources[pigmentId];
  return !!s && fin(s.level) > 0 && !s.eventLoan;
}

/** The region whose hunters can bring back a source for this pigment (only when that region is open to her). */
function pigmentRegion(state, pigmentId) {
  const src = SOURCES.find((x) => x.pigment === pigmentId);
  if (!src || !src.unlock || src.unlock.type !== 'region') return null;
  return regionOpen(state, src.unlock.region) ? src.unlock.region : null;
}

function wildRegion(colorId) {
  return REGIONS.find((r) => (r.wildHues || []).includes(colorId)) || null;
}

/**
 * howToFind(state, colorId) -> {how, region?, pigment?} | null: the real way she can
 * discover a color she has not found yet, or null if none is open to her now.
 *   'bench'  — a mix she can make with the pigments she owns;
 *   'grade'  — revealed by a Grading board (its pigments are hers);
 *   'source' — needs a pigment a hunter can bring back from an open region;
 *   'hunt'   — a wild hue found by hunters in an open region.
 */
export function howToFind(state, colorId) {
  const c = getColor(colorId);
  if (!c || c.foundBy === 'commission' || c.foundBy === 'event') return null;
  if (c.tier === 'wild' || c.foundBy === 'hunt') {
    const r = wildRegion(colorId);
    return r && regionOpen(state, r.id) ? { how: 'hunt', region: r.id } : null;
  }
  const pigs = (c.recipe || []).map((p) => p.pigment);
  const missing = pigs.filter((p) => !ownsPigment(state, p));
  if (missing.length) {
    const regions = missing.map((p) => pigmentRegion(state, p));
    if (regions.some((r) => !r)) return null;
    return { how: 'source', region: regions[0], pigment: missing[0] };
  }
  if (c.foundBy === 'grade' || c.foundBy === 'accident') return { how: 'grade' };
  return { how: 'bench' };
}

/** Can she end up with this color's jars (stock steps) or containers (shelf steps)? */
function canSupply(state, colorId, shelf) {
  if (isMine(state, colorId)) return shelf ? true : (canMix(state, colorId) || stockOf(state, colorId) >= 1);
  const f = howToFind(state, colorId);
  if (!f) return false;
  if (shelf) return true;
  return f.how !== 'hunt'; // a wild hue never becomes stock jars
}

/** Every step of a commission can still be finished from where she is. */
export function commissionFeasible(state, commissionId, rec = null) {
  const def = getCommission(commissionId);
  if (!def || def.comingSoon) return false;
  const r = rec || ensure(state).open.find((x) => x.id === commissionId) || ensure(state).later.find((x) => x.id === commissionId);
  return def.steps.every((st, i) => {
    const p = (r && r.steps[i]) || { delivered: 0, colors: {}, done: false };
    if (p.done) return true;
    const shelf = usesShelf(st);
    const used = Object.keys(p.colors || {}).filter((k) => p.colors[k] > 0);
    const more = Math.max(0, (st.distinct ?? 1) - used.length);
    const supply = stepCandidates(st).filter((id) => canSupply(state, id, shelf));
    if (!supply.length) return false;
    return supply.filter((id) => !used.includes(id)).length >= more;
  });
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/**
 * refresh(state, now) — keeps up to three commissions open (once bought in Phase 3, by catalog
 * size), adding the era capstone on top when ~80% of the catalog is found. Only commissions she
 * can finish open; an untouched one she cannot finish moves to `later` until she can.
 * Returns the ids added.
 */
export function refresh(state, now = 0) {
  const c = ensure(state);
  // drop records whose content vanished between versions
  c.open = c.open.filter((x) => x && getCommission(x.id));
  c.later = c.later.filter((x) => x && getCommission(x.id) && !c.done.includes(x.id) && !c.open.some((o) => o.id === x.id));
  const added = [];
  if (!commissionsOpen(state)) return added;
  // refresh runs every tick: skip the work while nothing it depends on has changed.
  const key = refreshKey(state, c);
  if (lastKey.get(state) === key) return added;
  // An untouched commission she cannot finish (an old save, a Renovate) waits for later.
  for (const rec of [...c.open]) {
    if (!hasProgress(rec) && !commissionFeasible(state, rec.id, rec)) {
      c.open.splice(c.open.indexOf(rec), 1);
      c.later.push(rec);
    }
  }
  const colors = discoveredCount(state);
  const isCap = (id) => !!getCommission(id).capstone;
  const regular = () => c.open.filter((x) => !isCap(x.id)).length;
  if (regular() < OPEN_COMMISSIONS.max) {
    const taken = new Set([...c.open.map((x) => x.id), ...c.done, ...c.later.map((x) => x.id)]);
    // Set-aside ones first (they keep their progress), then new ones, easiest first.
    for (const rec of [...c.later]) {
      if (regular() >= OPEN_COMMISSIONS.max) break;
      if (isCap(rec.id) || rec.asideAt === now) continue;
      if (!commissionFeasible(state, rec.id, rec)) continue;
      c.later.splice(c.later.indexOf(rec), 1);
      delete rec.asideAt;
      c.open.push(rec);
      added.push(rec.id);
    }
    const pool = availableCommissions({ era: state.era ?? 1, phase: state.phase ?? 3, colors })
      .filter((d) => !taken.has(d.id))
      .sort((a, b) => a.colorsRequired - b.colorsRequired);
    for (const def of pool) {
      if (regular() >= OPEN_COMMISSIONS.max) break;
      const rec = newRecord(def, now);
      if (!commissionFeasible(state, def.id, rec)) continue;
      c.open.push(rec);
      added.push(def.id);
    }
  }
  const cap = capstoneDef(state);
  const capTaken = cap && (c.done.includes(cap.id) || c.open.some((x) => x.id === cap.id));
  if (cap && !cap.comingSoon && !capTaken && colors >= Math.max(cap.colorsRequired, capstoneColorsRequired(state.era ?? 1))) {
    const waiting = c.later.find((x) => x.id === cap.id);
    const rec = waiting || newRecord(cap, now);
    if (commissionFeasible(state, cap.id, rec)) {
      if (waiting) c.later.splice(c.later.indexOf(waiting), 1);
      c.open.push(rec);
      added.push(cap.id);
    }
  }
  for (const id of added) emit(state, 'commissionOffered', { id });
  lastKey.set(state, refreshKey(state, c));
  return added;
}

const lastKey = new WeakMap();
function refreshKey(state, c) {
  const src = Object.entries((state.stations && state.stations.sources) || {})
    .filter(([, v]) => v && fin(v.level) > 0 && !v.eventLoan).map(([k]) => k).sort().join(',');
  const regions = ((state.hunters && state.hunters.regionsUnlocked) || []).join(',');
  const u = state.unlocks || {};
  return [state.era ?? 1, state.phase ?? 1, discoveredCount(state), src, regions, !!u.hunters, !!u.shelf,
    c.open.map((x) => x.id + (hasProgress(x) ? '+' : '')).join(','), c.later.map((x) => x.id).join(','), c.done.join(',')].join('|');
}

/** Another commission could take this one's place right now (setAside would swap it). */
export function canSetAside(state, commissionId) {
  const c = ensure(state);
  const rec = c.open.find((x) => x.id === commissionId);
  const def = getCommission(commissionId);
  if (!rec || !def || def.capstone) return false;
  const taken = new Set([...c.open.map((x) => x.id), ...c.done]);
  if (c.later.some((x) => !taken.has(x.id) && !getCommission(x.id).capstone && commissionFeasible(state, x.id, x))) return true;
  const laterIds = new Set(c.later.map((x) => x.id));
  return availableCommissions({ era: state.era ?? 1, phase: state.phase ?? 3, colors: discoveredCount(state) })
    .some((d) => !taken.has(d.id) && !laterIds.has(d.id) && commissionFeasible(state, d.id, newRecord(d, 0)));
}

/**
 * setAside(state, {commissionId}, now) -> {ok, replacedBy}. Swaps an open commission for
 * another one she can do; the set-aside one keeps its progress and comes back later.
 * Nothing is lost and nothing expires.
 */
export function setAside(state, { commissionId } = {}, now = 0) {
  const c = ensure(state);
  if (!canSetAside(state, commissionId)) return { ok: false, reason: 'nothing-else' };
  const i = c.open.findIndex((x) => x.id === commissionId);
  const rec = c.open.splice(i, 1)[0];
  rec.asideAt = now;
  c.later.push(rec);
  const added = refresh(state, now);
  delete rec.asideAt;
  return { ok: true, replacedBy: added[0] ?? null };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Does a color satisfy a step's color rule (ignores purity/tier)? */
export function stepAccepts(stepDef, colorId) {
  return stepMatches(stepDef, colorId);
}

function stepComplete(def, prog) {
  return fin(prog.delivered) >= def.jars - 1e-9 && distinctDelivered(prog) >= (def.distinct ?? 1);
}

/** How many more jars this step will accept of `colorId` (keeps room for the distinct rule). */
export function stepRoom(def, prog, colorId) {
  return roomFor(def, prog, colorId);
}

function shelfCells(state) {
  return (state.shelf && Array.isArray(state.shelf.cells)) ? state.shelf.cells : [];
}

/** Jars of a color at or above a purity. */
function usableJars(state, colorId, purity) {
  const e = state.stock && state.stock[colorId];
  if (!e) return 0;
  if (!purity) return fin(e.jars);
  const min = PURITY_ORDER.indexOf(purity);
  let n = 0;
  PURITY_ORDER.forEach((p, i) => { if (i >= min) n += fin(e.purity && e.purity[p]); });
  return n;
}

/**
 * deliver(state, {commissionId, stepIndex, colorId, jars}, now) — hands stock to a step.
 * Purity steps take only pure-or-better jars. Shelf steps (a container size, or a wild
 * hue, which cannot be mixed into jars) take one merged shelf container of that size or
 * bigger. Completes the commission when every step is done.
 * Returns {ok, delivered, stepDone, completed}.
 */
export function deliver(state, { commissionId, stepIndex, colorId, jars } = {}, now = 0) {
  const c = ensure(state);
  const rec = c.open.find((x) => x.id === commissionId);
  if (!rec) return { ok: false, reason: 'unknown' };
  const def = getCommission(commissionId);
  const sDef = def && def.steps[stepIndex];
  const prog = rec.steps[stepIndex];
  if (!sDef || !prog) return { ok: false, reason: 'step' };
  if (prog.done) return { ok: false, reason: 'done' };
  prog.colors ??= {};

  let delivered = 0;
  if (usesShelf(sDef)) {
    const cells = shelfCells(state);
    const tier = minTier(sDef);
    const ok = (cell) => cell && (cell.tier ?? 1) >= tier && stepAccepts(sDef, cell.color) && roomFor(sDef, prog, cell.color) > 0;
    // The smallest container that fits, so a bigger one is never spent by accident.
    let idx = -1;
    cells.forEach((cell, i) => {
      if (!ok(cell) || (colorId && cell.color !== colorId)) return;
      if (idx < 0 || (cell.tier ?? 1) < (cells[idx].tier ?? 1)) idx = i;
    });
    if (idx < 0) return { ok: false, reason: colorId && stepAccepts(sDef, colorId) && roomFor(sDef, prog, colorId) <= 0 ? 'need-variety' : 'no-container' };
    const used = cells[idx].color;
    cells[idx] = null;
    delivered = 1;
    prog.colors[used] = fin(prog.colors[used]) + 1;
  } else {
    if (!stepAccepts(sDef, colorId)) return { ok: false, reason: 'wrong-color' };
    const room = stepRoom(sDef, prog, colorId);
    const want = Math.min(room, Number.isFinite(jars) && jars > 0 ? jars : room);
    if (!(want > 0)) return { ok: false, reason: 'need-variety' };
    const opts = sDef.purity ? { minPurity: sDef.purity, prefer: 'low' } : { prefer: 'low' };
    const r = takeStock(state, colorId, want, opts);
    delivered = fin(r && r.taken);
    if (!(delivered > 0)) return { ok: false, reason: 'no-stock' };
    prog.colors[colorId] = fin(prog.colors[colorId]) + delivered;
  }
  prog.delivered = fin(prog.delivered) + delivered;
  if (stepComplete(sDef, prog)) prog.done = true;
  let completed = null;
  if (rec.steps.every((s) => s.done)) completed = complete(state, { commissionId }, now);
  return { ok: true, delivered, stepDone: prog.done, completed };
}

/** Coins a commission pays: incomeMinutes of idle income, never less than the cheapest upgrade. */
export function commissionPay(state, commissionId) {
  const def = getCommission(commissionId);
  if (!def) return 0;
  const byIncome = fin(def.reward.incomeMinutes) * fin(incomeRate(state)) * 60;
  const floor = fin(cheapestUpgrade(state) && cheapestUpgrade(state).cost);
  return Math.max(byIncome, floor);
}

/** complete(state, {commissionId}, now) — pays out once every step is done. */
export function complete(state, { commissionId } = {}, now = 0) {
  const c = ensure(state);
  const i = c.open.findIndex((x) => x.id === commissionId);
  if (i < 0) return { ok: false, reason: 'unknown' };
  const rec = c.open[i];
  if (!rec.steps.every((s) => s.done)) return { ok: false, reason: 'not-done' };
  const def = getCommission(commissionId);
  const coins = commissionPay(state, commissionId);
  earn(state, coins);
  let signature = null;
  const sig = def.reward.signatureColor;
  if (sig && colorInfo(sig) && !(state.catalog.discovered && state.catalog.discovered[sig])) {
    discover(state, { colorId: sig, method: 'commission' }, now);
    signature = sig;
  }
  state.trophies ??= [];
  if (def.reward.trophy && !state.trophies.includes(def.reward.trophy)) state.trophies.push(def.reward.trophy);
  c.open.splice(i, 1);
  if (!c.done.includes(commissionId)) c.done.push(commissionId);
  questEvent(state, 'commissionDone', 1, { commission: commissionId });
  emit(state, 'commissionDone', { id: commissionId });
  if (def.capstone) emit(state, 'capstoneDone', { id: commissionId });
  // The next one arrives straight away (the tick would add it a moment later anyway).
  refresh(state, now);
  return { ok: true, id: commissionId, coins, signatureColor: signature, trophy: def.reward.trophy };
}

/** Progress view of an open commission: [{def step, delivered, distinct, done, need}] */
export function commissionProgress(state, commissionId) {
  const rec = ensure(state).open.find((x) => x.id === commissionId);
  const def = getCommission(commissionId);
  if (!rec || !def) return null;
  return def.steps.map((s, i) => {
    const p = rec.steps[i] || { delivered: 0, colors: {}, done: false };
    return { ...s, delivered: fin(p.delivered), distinctDone: distinctDelivered(p), done: !!p.done, need: Math.max(0, s.jars - fin(p.delivered)) };
  });
}

/** Colors in stock that a step would accept (for the delivery picker). Shelf steps: none. */
export function eligibleStock(state, commissionId, stepIndex) {
  const def = getCommission(commissionId);
  const sDef = def && def.steps[stepIndex];
  if (!sDef || usesShelf(sDef)) return [];
  return Object.keys(state.stock || {}).filter((id) => stepAccepts(sDef, id) && stockOf(state, id) > 0);
}

// ---------------------------------------------------------------------------
// Guidance: what counts, what she has, and the next honest action
// ---------------------------------------------------------------------------

function mixersMaking(state, colorId) {
  const out = [];
  ((state.stations && state.stations.mixers) || []).forEach((m, i) => { if (m && m.recipe === colorId) out.push(i); });
  return out;
}

const FIND_ORDER = { bench: 0, grade: 1, source: 2, hunt: 3 };

/**
 * stepGuide(state, commissionId, stepIndex[, rec]) -> {
 *   kind: 'stock'|'shelf', jars, delivered, need, tier, purity,
 *   distinct, distinctDone, moreColors,
 *   owned: [{id, used, jars, usable, containers, room, making:[mixer], canMix, chip, deliverable}],
 *   findable: [{id, how, region?, pigment?}],
 *   ready,            // jars (stock) or containers (shelf) she could hand over right now
 *   action: {kind, colorId?, region?, pigment?, screen?, params?}
 * }
 * action.kind: 'deliver' | 'done' | 'purify' | 'wait' (a mixer is making it) | 'make'
 * (set a mixer) | 'shelf-open' | 'shelf-chip' (add it to the shelf colors) | 'shelf-merge'
 * (merge up / wait for vials) | 'find' (bench, grading board, hunter) | 'hunters-open' (buy
 * the Hue Hunters first, then send one) | 'later' (nothing
 * open to her yet; refresh never offers such a commission).
 * Pure data; the UI words it.
 */
export function stepGuide(state, commissionId, stepIndex, recArg = null) {
  const def = getCommission(commissionId);
  const st = def && def.steps[stepIndex];
  if (!st) return null;
  const c = ensure(state);
  const rec = recArg || c.open.find((x) => x.id === commissionId) || c.later.find((x) => x.id === commissionId);
  const prog = (rec && rec.steps[stepIndex]) || { delivered: 0, colors: {}, done: false };
  const shelf = usesShelf(st);
  const tier = minTier(st);
  const chips = shelf ? shelfColors(state) : [];
  const cells = shelf ? shelfCells(state) : [];
  const distinct = st.distinct ?? 1;
  const distinctDone = distinctDelivered(prog);
  const moreColors = prog.done ? 0 : Math.max(0, distinct - distinctDone);

  const mine = new Set(Object.keys((state.catalog && state.catalog.discovered) || {}));
  for (const id of Object.keys(state.stock || {})) mine.add(id);
  const owned = [];
  for (const id of mine) {
    if (!stepAccepts(st, id)) continue;
    const used = fin(prog.colors && prog.colors[id]) > 0;
    const room = roomFor(st, prog, id);
    const o = { id, used, room, making: mixersMaking(state, id), canMix: canMix(state, id), chip: chips.includes(id) };
    if (shelf) {
      o.containers = cells.filter((x) => x && x.color === id && (x.tier ?? 1) >= tier).length;
      o.smaller = cells.filter((x) => x && x.color === id && (x.tier ?? 1) < tier).length;
      o.deliverable = !prog.done && o.containers > 0 && room > 0;
    } else {
      o.jars = stockOf(state, id);
      o.usable = Math.floor(usableJars(state, id, st.purity) + 1e-9);
      o.deliverable = !prog.done && o.usable >= 1 && room >= 1 - 1e-9;
    }
    owned.push(o);
  }
  owned.sort((a, b) => (b.deliverable - a.deliverable) || (a.used - b.used)
    || ((shelf ? b.containers - a.containers : b.usable - a.usable)) || (b.making.length - a.making.length)
    || (b.canMix - a.canMix) || (a.id < b.id ? -1 : 1));

  const findable = [];
  for (const id of stepCandidates(st)) {
    if (mine.has(id)) continue;
    const f = howToFind(state, id);
    if (!f || (!shelf && f.how === 'hunt')) continue;
    findable.push({ id, ...f });
  }
  findable.sort((a, b) => FIND_ORDER[a.how] - FIND_ORDER[b.how] || (a.id < b.id ? -1 : 1));

  const ready = prog.done ? 0 : owned.filter((o) => o.deliverable)
    .reduce((n, o) => n + Math.min(shelf ? o.containers : o.usable, Math.ceil(o.room - 1e-9)), 0);
  const need = Math.max(0, Math.ceil(st.jars - fin(prog.delivered) - 1e-9));
  const base = {
    kind: shelf ? 'shelf' : 'stock', jars: st.jars, delivered: fin(prog.delivered), need, tier: st.tier || null,
    purity: st.purity || null, wild: !!st.wild, distinct, distinctDone, moreColors, owned, findable, ready, done: !!prog.done,
  };
  base.action = nextAction(state, st, base);
  return base;
}

function findAction(state, f) {
  if ((f.how === 'hunt' || f.how === 'source') && !huntersOpen(state)) {
    return { kind: 'hunters-open', how: f.how, colorId: f.id, region: f.region, pigment: f.pigment, screen: 'workshop', params: { unlock: 'hunters' } };
  }
  if (f.how === 'bench') return { kind: 'find', how: 'bench', colorId: f.id, screen: 'bench', params: {} };
  if (f.how === 'grade') return { kind: 'find', how: 'grade', colorId: f.id, screen: 'puzzles', params: { puzzle: 'grading' } };
  if (f.how === 'source') return { kind: 'find', how: 'source', colorId: f.id, pigment: f.pigment, region: f.region, screen: 'map', params: { regionId: f.region } };
  return { kind: 'find', how: 'hunt', colorId: f.id, region: f.region, screen: 'map', params: { regionId: f.region } };
}

function nextAction(state, st, g) {
  if (g.done) return { kind: 'done' };
  if (g.owned.some((o) => o.deliverable)) return { kind: 'deliver' };
  // Colors that would still help: room left for them, a new color first when the step wants variety.
  const useful = g.owned.filter((o) => o.room > 0).sort((a, b) => (g.moreColors > 0 ? a.used - b.used : 0));
  if (g.kind === 'stock') {
    if (g.purity) {
      const plain = useful.find((o) => o.jars >= 1);
      if (plain) return { kind: 'purify', colorId: plain.id, screen: 'puzzles', params: { puzzle: 'purify' } };
    }
    const making = useful.find((o) => o.making.length);
    if (making) return { kind: 'wait', colorId: making.id, mixer: making.making[0], screen: 'workshop', params: { panel: 'mixers' } };
    const mixable = useful.find((o) => o.canMix);
    if (mixable) return { kind: 'make', colorId: mixable.id, screen: 'workshop', params: { assign: mixable.id } };
  } else {
    if (!shelfOpen(state) && (useful.length || g.findable.length)) return { kind: 'shelf-open', screen: 'workshop', params: { unlock: 'shelf' } };
    const onShelf = useful.find((o) => o.smaller > 0) || useful.find((o) => o.chip);
    if (onShelf) return { kind: 'shelf-merge', colorId: onShelf.id, tier: g.tier || 1, screen: 'shelf', params: {} };
    if (useful.length) return { kind: 'shelf-chip', colorId: useful[0].id, tier: g.tier || 1, screen: 'shelf', params: {} };
  }
  if (g.findable.length) return findAction(state, g.findable[0]);
  return { kind: 'later' };
}

/** capstoneReady(state) — has this era's capstone commission been completed? */
export function capstoneReady(state) {
  const cap = capstoneDef(state);
  return !!cap && ensure(state).done.includes(cap.id);
}

/**
 * eraAdvance(state) — Era 2 is not playable in this build: always {ok:false,
 * reason:'coming-soon'} and a 'comingSoon' event ("coming in a later update").
 * `capstoneReady` tells the UI whether she has actually earned it.
 */
export function eraAdvance(state) {
  const ready = capstoneReady(state);
  emit(state, 'comingSoon', { era: (state.era ?? 1) + 1, capstoneReady: ready });
  return { ok: false, reason: 'coming-soon', capstoneReady: ready };
}

/** The region a wild hue is found in (for copy), or null. */
export function wildRegionOf(colorId) {
  const r = wildRegion(colorId);
  return r ? getRegion(r.id) : null;
}

export { refresh as refreshCommissions, deliver as deliverCommission, complete as completeCommission };
