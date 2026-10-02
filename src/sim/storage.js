// storage.js — display vats + shared cellar, per-color stock with purity (pure).
// Implements docs/DESIGN.md "Storage and shipping › Storage: hybrid vats and
// cellar": capacity is one shared number (vats summed + cellar), production
// pauses when full (nothing spills), purity is tracked per jar bucket.
//
// state.stock[colorId] = {jars, purity:{muddy, standard, pure, flawless}}

import { CELLAR } from '../content/stations.js';
import { slotsForRooms } from '../content/rooms.js';
import { stationOutput, rates } from './economy.js';

export const PURITY_ORDER = Object.freeze(['muddy', 'standard', 'pure', 'flawless']);
const EPS = 1e-9;

const num = (x) => (Number.isFinite(x) ? x : 0);

/** capacity(state) -> {display, cellar, total} in jars. */
export function capacity(state) {
  let display = 0;
  for (const v of state?.stations?.vats ?? []) display += stationOutput('vat', v?.level ?? 1);
  const lvl = Math.max(1, num(state?.cellarLevel) || 1);
  const mult = slotsForRooms(state?.rooms ?? []).cellarMult || 1;
  const cellar = (CELLAR.baseCapacity + CELLAR.capacityPerLevel * (lvl - 1)) * mult;
  return { display, cellar, total: display + cellar };
}

function entry(state, colorId, create = false) {
  if (!state.stock) state.stock = {};
  let e = state.stock[colorId];
  if (!e && create) {
    e = { jars: 0, purity: { muddy: 0, standard: 0, pure: 0, flawless: 0 } };
    state.stock[colorId] = e;
  }
  if (e && !e.purity) e.purity = { muddy: 0, standard: num(e.jars), pure: 0, flawless: 0 };
  return e;
}

function resum(e) {
  let s = 0;
  for (const p of PURITY_ORDER) {
    e.purity[p] = Math.max(0, num(e.purity[p]));
    if (e.purity[p] < EPS) e.purity[p] = 0;
    s += e.purity[p];
  }
  e.jars = s;
  return s;
}

/** Jars of one color on hand. */
export function stockOf(state, colorId) {
  return num(state?.stock?.[colorId]?.jars);
}

/** Jars of one color at a given purity. */
export function stockAt(state, colorId, purity) {
  return num(state?.stock?.[colorId]?.purity?.[purity]);
}

/** Total jars across every color. */
export function stockTotal(state) {
  let s = 0;
  for (const e of Object.values(state?.stock ?? {})) s += num(e?.jars);
  return s;
}

export function freeSpace(state) {
  return Math.max(0, capacity(state).total - stockTotal(state));
}

export function isFull(state) {
  return stockTotal(state) >= capacity(state).total - 1e-6;
}

/**
 * addStock(state, colorId, jars, purity='standard', {cap=true}) -> accepted jars.
 * Capped at free capacity unless {cap:false} (factory closed form only).
 */
export function addStock(state, colorId, jars, purity = 'standard', opts = {}) {
  const want = Math.max(0, num(jars));
  if (!colorId || want <= 0) return 0;
  const p = PURITY_ORDER.includes(purity) ? purity : 'standard';
  const accepted = opts.cap === false ? want : Math.min(want, freeSpace(state));
  if (accepted <= 0) return 0;
  const e = entry(state, colorId, true);
  e.purity[p] += accepted;
  resum(e);
  return accepted;
}

/**
 * takeStock(state, colorId, jars, {prefer:'high'|'low', purity?, minPurity?})
 * -> {taken, byPurity}. Takes up to `jars` (fewer if short), highest or lowest
 * purity first. `purity` restricts to one bucket; `minPurity` to that and above.
 */
export function takeStock(state, colorId, jars, opts = {}) {
  const byPurity = { muddy: 0, standard: 0, pure: 0, flawless: 0 };
  let want = Math.max(0, num(jars));
  const e = entry(state, colorId, false);
  if (!e || want <= 0) return { taken: 0, byPurity };
  let order = opts.prefer === 'high' ? [...PURITY_ORDER].reverse() : [...PURITY_ORDER];
  if (opts.purity) order = [opts.purity];
  if (opts.minPurity) {
    const i = PURITY_ORDER.indexOf(opts.minPurity);
    if (i >= 0) order = order.filter((p) => PURITY_ORDER.indexOf(p) >= i);
  }
  let taken = 0;
  for (const p of order) {
    if (want <= EPS) break;
    const t = Math.min(want, num(e.purity[p]));
    if (t <= 0) continue;
    e.purity[p] -= t;
    byPurity[p] += t;
    taken += t;
    want -= t;
  }
  resum(e);
  if (e.jars <= EPS) delete state.stock[colorId];
  return { taken, byPurity };
}

/** Move jars of one color from one purity to another (e.g. a flawless accident). */
export function convertPurity(state, colorId, jars, from, to) {
  const e = entry(state, colorId, false);
  if (!e) return 0;
  const t = Math.min(Math.max(0, num(jars)), num(e.purity[from]));
  if (t <= 0) return 0;
  e.purity[from] -= t;
  e.purity[to] = num(e.purity[to]) + t;
  resum(e);
  return t;
}

/**
 * fillTimeMs(state) -> ms until storage is full at the current production rate
 * ((capacity − stock) / production). Infinity when nothing is being made.
 */
export function fillTimeMs(state) {
  const r = rates(state).jars;
  if (!(r > 0)) return Infinity;
  return Math.max(0, capacity(state).total - stockTotal(state)) / r * 1000;
}

/** ARCHITECTURE.md alias. */
export const fillTime = fillTimeMs;
