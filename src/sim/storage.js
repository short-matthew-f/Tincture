// storage.js — display vats + shared cellar, per-color stock with purity (pure).
// Implements docs/DESIGN.md "Storage and shipping › Storage: hybrid vats and
// cellar": capacity is one shared number (vats summed + cellar), production
// pauses when full (nothing spills), purity is tracked per jar bucket.
//
// state.stock[colorId] = {jars, purity:{muddy, standard, pure, flawless}}

import { CELLAR } from '../content/stations.js';
import { slotsForRooms } from '../content/rooms.js';
import { stationOutput, rates } from './economy.js';
import { commissionReserve, commissionReserves } from './commission-rules.js';

export const PURITY_ORDER = Object.freeze(['muddy', 'standard', 'pure', 'flawless']);
const PURITY_HIGH_FIRST = Object.freeze([...PURITY_ORDER].reverse());
const EPS = 1e-9;

const num = (x) => (Number.isFinite(x) ? x : 0);

/**
 * capacity(state) -> {display, cellar, total} in jars. Remembered per stations object
 * while the vat levels, cellar level and rooms are unchanged (the flow meter and every
 * factory step ask). Callers share the returned object and must only read it.
 */
export function capacity(state) {
  const st = state?.stations;
  if (!st || typeof st !== 'object') return computeCapacity(state);
  const k = CAP_KEY;
  k.length = 0;
  for (const v of st.vats ?? []) k.push(v?.level);
  k.push(CAP_SEP, state.cellarLevel);
  for (const id of state.rooms ?? []) k.push(id);
  const memo = CAP_MEMO.get(st);
  if (memo && sameKey(memo.key, k)) return memo.value;
  const saved = k.slice(); // the scratch key is reused by the next call
  const value = computeCapacity(state);
  CAP_MEMO.set(st, { key: saved, value });
  return value;
}

function sameKey(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const CAP_MEMO = new WeakMap();
const CAP_KEY = [];
const CAP_SEP = Object.freeze({});

function computeCapacity(state) {
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
  let order = opts.prefer === 'high' ? PURITY_HIGH_FIRST : PURITY_ORDER;
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

// ---------------------------------------------------------------------------
// Shop keep reserve (docs/PLAN-v0.2.md Theme A.3, docs/V02-CONTRACTS.md)
// ---------------------------------------------------------------------------

/** Jars kept by default of a pinned color (painting is free, so paintings hold nothing back). */
export const DEFAULT_KEEP = 20;

/** Colors the default rule keeps: pinned ones. */
function defaultKept(state) {
  const out = new Set();
  for (const id of state?.catalog?.pinned ?? []) if (typeof id === 'string') out.add(id);
  return out;
}

/** Jars a bouquet flower takes from stock (sim/orders.js BOUQUET_JARS). */
export const BOUQUET_KEEP = 3;

/**
 * Bouquet orders (Bloom Week): a flower that is a catalog color keeps BOUQUET_KEEP
 * jars of it back from the shop, so "Give 3 jars" stays possible once a mixer makes it.
 */
function bouquetReserve(state, colorId) {
  for (const o of state?.orders?.open ?? []) {
    if (!o || o.kind !== 'bouquet' || !Array.isArray(o.flowers)) continue;
    if (o.flowers.some((f) => f && !f.filled && f.colorId === colorId)) return BOUQUET_KEEP;
  }
  return 0;
}

function bouquetReserves(state) {
  const out = {};
  for (const o of state?.orders?.open ?? []) {
    if (!o || o.kind !== 'bouquet' || !Array.isArray(o.flowers)) continue;
    for (const f of o.flowers) if (f && !f.filled && f.colorId) out[f.colorId] = BOUQUET_KEEP;
  }
  return out;
}

/**
 * keepMap(state) -> {colorId: jars} for every color with a reserve above 0.
 * Explicit `state.keep` entries override the default rule (0 turns it off).
 * The shop and the Dispatcher never sell these jars.
 */
export function keepMap(state) {
  const out = {};
  for (const id of defaultKept(state)) out[id] = DEFAULT_KEEP;
  // Commissions: jars an open step can use are kept by default (sim/commission-rules.js).
  if (state?.commissions?.open?.length) {
    for (const [id, r] of Object.entries(commissionReserves(state))) if (r > (out[id] ?? 0)) out[id] = r;
  }
  for (const [id, r] of Object.entries(bouquetReserves(state))) if (r > (out[id] ?? 0)) out[id] = r;
  const explicit = state?.keep;
  if (explicit && typeof explicit === 'object') {
    for (const [id, jars] of Object.entries(explicit)) {
      if (!Number.isFinite(jars)) continue;
      if (jars > 0) out[id] = jars;
      else delete out[id];
    }
  }
  return out;
}

/** keepOf(state, colorId) -> jars of that color the shop keeps (0 = sells it all). */
export function keepOf(state, colorId) {
  const e = state?.keep?.[colorId];
  if (Number.isFinite(e)) return Math.max(0, e);
  const base = Math.max(defaultKept(state).has(colorId) ? DEFAULT_KEEP : 0, bouquetReserve(state, colorId));
  return state?.commissions?.open?.length ? Math.max(base, commissionReserve(state, colorId)) : base;
}

/** Jars of a color above its keep reserve (what the shop / auto-ship may take). */
export function sellableOf(state, colorId) {
  return Math.max(0, stockOf(state, colorId) - keepOf(state, colorId));
}

/**
 * setKeep(state, {colorId, jars}) -> {ok, colorId, jars}. A number ≥ 0 sets an
 * explicit reserve (0 = sell it all); null/undefined goes back to the default
 * rule (20 jars if pinned).
 */
export function setKeep(state, args = {}) {
  const id = args.colorId;
  if (!id || typeof id !== 'string') return { ok: false, reason: 'color' };
  if (!state.keep || typeof state.keep !== 'object' || Array.isArray(state.keep)) state.keep = {};
  if (args.jars === null || args.jars === undefined) delete state.keep[id];
  else if (Number.isFinite(args.jars)) state.keep[id] = Math.max(0, Math.round(args.jars));
  else return { ok: false, reason: 'jars' };
  return { ok: true, colorId: id, jars: keepOf(state, id) };
}
