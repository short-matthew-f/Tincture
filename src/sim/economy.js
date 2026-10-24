// economy.js — upgrade curves, prices, multipliers, rates, reward scaling and the
// flow meter (pure). Implements docs/DESIGN.md "The factory › Upgrade curves",
// "Economy › Color value", "Active play › Reward scaling" and "Storage and
// shipping › The flow meter". Every other sim module asks this one "how much?".
//
// Conventions: rates are per second, money is plain floats, nothing here mutates
// state. `now` defaults to state.lastTick when a function needs a time (boosts).

import {
  STATION_KINDS, MILESTONES, milestonesPassed, GRINDER_KINDS_BY_ID, MIXER, SHOP,
  CELLAR, VEHICLES_BY_ID,
} from '../content/stations.js';
import { SOURCES_BY_ID } from '../content/sources.js';
import { getPigment } from '../content/pigments.js';
import { ERAS_BY_ID } from '../content/eras.js';
import { slotsForRooms, ROOMS } from '../content/rooms.js';
import { HERITAGE_BY_ID } from '../content/heritage.js';
import { getColor, EVENT_COLORS } from '../content/catalog.js';
import { hueFamily } from '../color.js';
import { capacity, stockTotal } from './storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PURITIES = Object.freeze(['muddy', 'standard', 'pure', 'flawless']);
export const PURITY_MULT = Object.freeze({ muddy: 0.8, standard: 1, pure: 1.5, flawless: 2 });
/** Fallback base prices by tier (spec "Color value") when a color has no basePrice. */
export const TIER_PRICE = Object.freeze({ primary: 1, secondary: 3, tertiary: 8, earth: 8, tint: 15, shade: 15, wild: 60 });
/** Puzzle tiers: k = minutes of production, mult = floor multiplier (spec "Reward scaling"). */
export const PUZZLE_TIERS = Object.freeze({
  relaxed: Object.freeze({ k: 8, mult: 1 }),
  steady: Object.freeze({ k: 12, mult: 1.5 }),
  tricky: Object.freeze({ k: 20, mult: 2.5 }),
  master: Object.freeze({ k: 32, mult: 4 }),
});
export const REWARD_FLOOR = 0.25;
export const BOOST_CAP = 2; // boosts stack additively, capped at +200%
export const ESSENCE_STEP = 0.05;
export const ESSENCE_MAX = 10;
/** Offline window the flow meter aims for, by phase (ms). */
export const STORE_TARGET_MS = Object.freeze({ 1: 15 * 60e3, 2: 4 * 3600e3, 3: 8 * 3600e3 });

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

// ---------------------------------------------------------------------------
// Color lookups (catalog + event pages + bare pigments)
// ---------------------------------------------------------------------------

let eventIndex = null;
function eventColorIndex() {
  if (eventIndex) return eventIndex;
  eventIndex = new Map();
  const add = (c) => { if (c && typeof c === 'object' && c.id) eventIndex.set(c.id, c); };
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach((y) => (Array.isArray(y) ? walk(y) : (y && y.id ? add(y) : walk(y))));
    else if (typeof x === 'object') {
      if (x.id && x.hex) add(x);
      else Object.values(x).forEach(walk);
    }
  };
  try { walk(EVENT_COLORS); } catch { /* shape unknown: ignore */ }
  return eventIndex;
}

/** Catalog (or event, or pigment) definition for a color id, or null. */
export function colorDef(id) {
  if (!id) return null;
  let c = null;
  try { c = getColor(id) ?? null; } catch { c = null; }
  if (c) return c;
  c = eventColorIndex().get(id);
  if (c) return c;
  const p = getPigment(id);
  if (p) return { id: p.id, name: p.name, hex: p.hex, tier: 'primary', basePrice: 1, recipe: null };
  return null;
}

export function colorHex(id) {
  return colorDef(id)?.hex ?? '#888888';
}

export function colorTier(id) {
  return colorDef(id)?.tier ?? 'primary';
}

/** Hue family of a color id (by its hex). */
export function colorFamily(id) {
  const d = colorDef(id);
  if (d && d.family) return d.family;
  // Content is static, so a color's family (an Oklch conversion) is worked out once per id.
  if (typeof id === 'string' && d) {
    let f = FAMILY_CACHE.get(id);
    if (f === undefined) { f = hueFamily(d.hex ?? '#888888'); FAMILY_CACHE.set(id, f); }
    return f;
  }
  return hueFamily(d?.hex ?? '#888888');
}
const FAMILY_CACHE = new Map();

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

function kindKey(kind) {
  switch (kind) {
    case 'sources': return 'source';
    case 'grinders': return 'grinder';
    case 'mixers': return 'mixer';
    case 'vats': return 'vat';
    case 'fleet': case 'vehicles': return 'vehicle';
    default: return kind;
  }
}

/**
 * stationCost(kind, level, id?) -> Coins to go from `level` to `level + 1`:
 * c0 · growth^level. `id` picks a source's baseCost or a vehicle kind's cost.
 * Vats (and the cellar) grow at 1.10, everything else at 1.15.
 */
export function stationCost(kind, level, id) {
  const k = kindKey(kind);
  const L = Math.max(0, num(level));
  if (k === 'cellar') return CELLAR.baseCost * Math.pow(CELLAR.costGrowth, L);
  const def = STATION_KINDS[k];
  if (!def) return Infinity;
  let c0 = def.baseCost;
  if (k === 'source' && id && SOURCES_BY_ID[id]) c0 = SOURCES_BY_ID[id].baseCost;
  if (k === 'vehicle' && id && VEHICLES_BY_ID[id]) c0 = VEHICLES_BY_ID[id].cost;
  const growth = k === 'vat' ? 1.10 : def.costGrowth;
  return c0 * growthPow(growth, L);
}

// Math.pow(growth, level) for whole levels, remembered: the flow meter prices every station
// on every call. Same value as calling Math.pow directly.
const POW_CACHE = new Map();
function growthPow(growth, L) {
  if (!Number.isInteger(L) || L > 4096) return Math.pow(growth, L);
  let row = POW_CACHE.get(growth);
  if (!row) { row = []; POW_CACHE.set(growth, row); }
  let v = row[L];
  if (v === undefined) { v = Math.pow(growth, L); row[L] = v; }
  return v;
}

/**
 * stationOutput(kind, level, id?) -> b · L · 2^milestones. Units: source raw/s
 * (b = that source's baseRate), grinder pigment/s (b = grinder kind
 * throughput), mixer jars/s, vat jars of capacity, shop jars/s, vehicle
 * capacity multiplier.
 */
export function stationOutput(kind, level, id) {
  const k = kindKey(kind);
  const L = Math.max(0, num(level));
  if (L <= 0) return 0;
  const def = STATION_KINDS[k];
  if (!def) return 0;
  let b = def.baseOutput;
  if (k === 'source' && id && SOURCES_BY_ID[id]) b = SOURCES_BY_ID[id].baseRate;
  if (k === 'grinder' && id && GRINDER_KINDS_BY_ID[id]) b = GRINDER_KINDS_BY_ID[id].throughput;
  return b * L * milestoneMult(L);
}

// 2^milestonesPassed(L), remembered for whole levels like growthPow (same value).
const MILESTONE_MULT = [];
function milestoneMult(L) {
  if (!Number.isInteger(L) || L > 4096) return Math.pow(2, milestonesPassed(L));
  let v = MILESTONE_MULT[L];
  if (v === undefined) { v = Math.pow(2, milestonesPassed(L)); MILESTONE_MULT[L] = v; }
  return v;
}

/** The next milestone level above `level`, or null after the last. */
export function nextMilestone(level) {
  const L = num(level);
  for (const m of MILESTONES) if (m > L) return m;
  return null;
}

// ---------------------------------------------------------------------------
// Prices and multipliers
// ---------------------------------------------------------------------------

export function essenceOf(state, colorId) {
  return Math.min(ESSENCE_MAX, Math.max(0, num(state?.catalog?.discovered?.[colorId]?.essence)));
}

/** basePrice × era priceScale × purity mult × (1 + 0.05 · essence stars). */
export function colorPrice(state, colorId, purity = 'standard') {
  const d = colorDef(colorId);
  const base = num(d?.basePrice, TIER_PRICE[d?.tier] ?? 1);
  const scale = num(ERAS_BY_ID[state?.era ?? 1]?.priceScale, 1);
  const pm = PURITY_MULT[purity] ?? 1;
  return base * scale * pm * (1 + ESSENCE_STEP * essenceOf(state, colorId));
}

// discoveredCount is read thousands of times per simulated day (incomeMultiplier, unlock
// status, routes), and Object.keys on the catalog allocates each time. The count is cached
// per `catalog.discovered` object (a new object, e.g. a new game or a loaded save, starts
// uncached). Contract: colors are added only through discovery.discover(), which calls
// invalidateDiscoveredCount; code that writes catalog.discovered directly after the count
// has been read must call it too (test/sim-discovery.test.js pins this).
const COUNTS = new WeakMap();
export function discoveredCount(state) {
  const d = state?.catalog?.discovered;
  if (!d || typeof d !== 'object') return 0;
  let n = COUNTS.get(d);
  if (n === undefined) { n = Object.keys(d).length; COUNTS.set(d, n); }
  return n;
}
export function invalidateDiscoveredCount(state) { const d = state?.catalog?.discovered; if (d) COUNTS.delete(d); }

function boostSum(state, kind, now) {
  const t = now ?? state?.lastTick ?? 0;
  let s = 0;
  for (const b of state?.boosts ?? []) {
    if (b && b.kind === kind && num(b.until) > t) s += Math.max(0, num(b.mult));
  }
  return Math.min(BOOST_CAP, s);
}

/** Total income multiplier: catalog milestones × Heritage × boosts (capped +200%). */
export function incomeMultiplier(state, now) {
  const catalog = 1 + 0.02 * Math.floor(discoveredCount(state) / 10);
  const heritage = 1 + 0.05 * Math.max(0, num(state?.heritage));
  return catalog * heritage * (1 + boostSum(state, 'income', now));
}

/** Production multiplier: boosts (capped +200%) × Heritage "Quick Hands" in Phases 1–2. */
export function productionMultiplier(state, now) {
  let m = 1 + boostSum(state, 'production', now);
  const qh = num(state?.heritageSpent?.['quick-hands']);
  const per = HERITAGE_BY_ID['quick-hands']?.effect?.phaseSpeed ?? 0.25;
  if (qh > 0 && (state?.phase ?? 1) <= 2) m *= 1 + per * qh;
  return m;
}

// ---------------------------------------------------------------------------
// Station helpers
// ---------------------------------------------------------------------------

export function vehicleCapacity(v) {
  const def = VEHICLES_BY_ID[v?.kind];
  if (!def) return 0;
  return def.capacity * stationOutput('vehicle', v.level ?? 1);
}

/** Trip time shortens 1% per level, down to 40% of the base. */
export function vehicleTripMs(v) {
  const def = VEHICLES_BY_ID[v?.kind];
  if (!def) return Infinity;
  const L = Math.max(1, num(v.level, 1));
  return def.tripMs * Math.max(0.4, 1 - 0.01 * (L - 1));
}

export function shopSellRate(state) {
  return stationOutput('shop', state?.stations?.shop?.level ?? 1);
}

export function shopPriceBonus(state) {
  return 1 + SHOP.priceBonusPerLevel * Math.max(0, (state?.stations?.shop?.level ?? 1) - 1);
}

/** Jars/s the fleet can move if every routed vehicle shuttles continuously. */
export function fleetSellRate(state) {
  let r = 0;
  for (const v of state?.stations?.fleet ?? []) {
    const t = vehicleTripMs(v);
    if (Number.isFinite(t) && t > 0) r += vehicleCapacity(v) / (t / 1000);
  }
  return r;
}

/** Weighted mean purity bonus of the grinders (by throughput). */
export function grinderPurityBonus(state) {
  let w = 0;
  let s = 0;
  for (const g of state?.stations?.grinders ?? []) {
    const out = stationOutput('grinder', g.level, g.kind);
    w += out;
    s += out * (GRINDER_KINDS_BY_ID[g.kind]?.purityBonus ?? 0);
  }
  return w > 0 ? s / w : 0;
}

/** Recipe weights normalized to shares, split into consumed pigments (white/black drops are free). */
export function recipeShares(colorId) {
  // Content is static (colorDef reads frozen content tables), so the shares for an id
  // never change; rates() asks for each mixer's recipe several times per call.
  if (typeof colorId === 'string') {
    if (SHARES_CACHE.has(colorId)) return SHARES_CACHE.get(colorId);
    const v = computeRecipeShares(colorId);
    SHARES_CACHE.set(colorId, v);
    return v;
  }
  return computeRecipeShares(colorId);
}

const SHARES_CACHE = new Map();

/**
 * recipeShares(colorId) as parallel lists {keys: [pigment], vals: [share]} in the
 * object's key order (cached per id; read-only), or null. Index loops over plain
 * arrays: destructuring frozen [pigment, share] pairs was the slowest part of rates().
 */
function shareEntries(colorId) {
  if (typeof colorId !== 'string') return toLists(recipeShares(colorId));
  let e = ENTRIES_CACHE.get(colorId);
  if (e === undefined) {
    e = toLists(recipeShares(colorId));
    ENTRIES_CACHE.set(colorId, e);
  }
  return e;
}
function toLists(sh) {
  return sh ? { keys: Object.keys(sh), vals: Object.values(sh) } : null;
}
const ENTRIES_CACHE = new Map();

function computeRecipeShares(colorId) {
  const d = colorDef(colorId);
  const recipe = d?.recipe;
  if (!Array.isArray(recipe) || !recipe.length) return null;
  const total = recipe.reduce((s, r) => s + Math.max(0, num(r.weight)), 0);
  if (!(total > 0)) return null;
  const out = {};
  for (const r of recipe) {
    if (r.pigment === 'white' || r.pigment === 'black') continue;
    out[r.pigment] = (out[r.pigment] ?? 0) + Math.max(0, num(r.weight)) / total;
  }
  return Object.freeze(out); // shared between callers: read-only
}

// ---------------------------------------------------------------------------
// Rates (steady-state chain: sources → grinders → mixers)
// ---------------------------------------------------------------------------

/**
 * rates(state, now?) -> {
 *   raw: {pigment: raw/s supplied}, pigment: {pigment: pigment/s ground},
 *   mixerJars: [jars/s per mixer], byColor: {colorId: jars/s}, jars,
 *   shop, fleet, sell, grinderCap, limit: 'raw'|'grinder'|'mixer'|null,
 *   rawLimited: [pigment ids], demand: {pigment: pigment/s wanted}
 * }
 * Production is the slowest stage: per-pigment raw limits scale the mixers
 * that use that pigment; then the grinder cap scales everything equally.
 */
export function rates(state, now) {
  const pm = productionMultiplier(state, now);
  const st = state?.stations;
  if (!st || typeof st !== 'object') return computeRates(state, pm);
  // The flow meter, the Next button, income and every factory sub-step ask for the
  // rates of an unchanged workshop many times in a row (about 3 of 4 calls repeat the
  // previous one). The result is a function of a few numbers and ids (ratesKey), so it
  // is remembered per stations object and reused while that key is unchanged. Callers
  // share the returned object and must only read it (freezing it cost 7% of a run).
  const key = ratesKey(state, st, pm);
  const memo = RATES_MEMO.get(st);
  if (memo && sameKey(memo.key, key)) return memo.value;
  const saved = key.slice(); // the scratch key is reused by the next call
  const value = computeRates(state, pm);
  RATES_MEMO.set(st, { key: saved, value });
  return value;
}

const RATES_MEMO = new WeakMap();
const RATES_KEY = []; // scratch, refilled by every ratesKey() call
const HOLE = Object.freeze({});

/** Every input rates() reads besides frozen content: pm, then each station's level/kind/recipe/essence. */
function ratesKey(state, st, pm) {
  const k = RATES_KEY;
  k.length = 0;
  k.push(pm, st.shop?.level);
  const sources = st.sources;
  if (sources && typeof sources === 'object') {
    for (const id in sources) if (Object.hasOwn(sources, id)) k.push(id, sources[id]?.level);
  }
  k.push(HOLE); // end of sources
  const grinders = st.grinders ?? [];
  k.push(grinders.length);
  for (const g of grinders) k.push(g?.level, g?.kind);
  const mixers = st.mixers ?? [];
  k.push(mixers.length);
  for (let i = 0; i < mixers.length; i++) {
    const m = mixers[i];
    if (!m) k.push(m, null, null);
    else k.push(m.level, m.recipe, m.recipe ? essenceOf(state, m.recipe) : null);
  }
  const fleet = st.fleet ?? [];
  k.push(fleet.length);
  for (const v of fleet) k.push(v?.kind, v?.level);
  return k;
}

function sameKey(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function computeRates(state, pm) {
  // Plain loops over cached pigment / share lists (shareEntries); the arithmetic and
  // the order of every sum are the same as the map/forEach version this replaced.
  const st = state?.stations ?? {};
  const raw = {};
  for (const [id, s] of Object.entries(st.sources ?? {})) {
    const pig = SOURCES_BY_ID[id]?.pigment ?? id;
    raw[pig] = (raw[pig] ?? 0) + stationOutput('source', s?.level ?? 0, id) * pm;
  }
  let grinderCap = 0;
  for (const g of st.grinders ?? []) grinderCap += stationOutput('grinder', g.level, g.kind) * pm;

  const ppj = MIXER.pigmentPerJar;
  const mixers = st.mixers ?? [];
  const n = mixers.length;
  const want = new Array(n);
  const shares = new Array(n);
  let wantAny = false;
  for (let i = 0; i < n; i++) {
    const m = mixers[i];
    const e = m && m.recipe ? shareEntries(m.recipe) : null;
    want[i] = e ? stationOutput('mixer', m.level) * pm * (1 + ESSENCE_STEP * essenceOf(state, m.recipe)) : 0;
    shares[i] = e;
    if (want[i] > 0) wantAny = true;
  }
  const demand = {};
  for (let i = 0; i < n; i++) {
    if (!want[i]) continue;
    const { keys, vals } = shares[i];
    for (let k = 0; k < keys.length; k++) demand[keys[k]] = (demand[keys[k]] ?? 0) + want[i] * vals[k] * ppj;
  }
  const factor = {};
  const rawLimited = [];
  for (const p in demand) {
    const d = demand[p];
    const sup = raw[p] ?? 0;
    factor[p] = d > 0 ? Math.min(1, sup / d) : 1;
    if (factor[p] < 1) rawLimited.push(p);
  }
  const f = new Array(n);
  let used = 0;
  for (let i = 0; i < n; i++) {
    if (!want[i]) { f[i] = 0; continue; }
    let x = 1;
    const keys = shares[i].keys;
    for (let k = 0; k < keys.length; k++) x = Math.min(x, factor[keys[k]] ?? 1);
    f[i] = x;
  }
  for (let i = 0; i < n; i++) {
    if (!want[i]) continue;
    const vals = shares[i].vals;
    for (let k = 0; k < vals.length; k++) used += f[i] * want[i] * vals[k] * ppj;
  }
  const g = used > 0 ? Math.min(1, grinderCap / used) : 1;
  const mixerJars = new Array(n);
  for (let i = 0; i < n; i++) mixerJars[i] = num(want[i] * f[i] * g);
  const pigment = {};
  const byColor = {};
  let jars = 0;
  for (let i = 0; i < n; i++) {
    const mj = mixerJars[i];
    jars += mj;
    if (!mj) continue;
    const recipe = mixers[i].recipe;
    byColor[recipe] = (byColor[recipe] ?? 0) + mj;
    const { keys, vals } = shares[i];
    for (let k = 0; k < keys.length; k++) pigment[keys[k]] = (pigment[keys[k]] ?? 0) + mj * vals[k] * ppj;
  }
  const shop = shopSellRate(state);
  const fleet = fleetSellRate(state);
  let limit = null;
  if (jars > 0 || wantAny) {
    if (rawLimited.length) limit = 'raw';
    else if (g < 1) limit = 'grinder';
    else limit = 'mixer';
  }
  return {
    raw, pigment, mixerJars, byColor, jars, shop, fleet, sell: shop + fleet,
    grinderCap, limit, rawLimited, demand, grinderFactor: g,
  };
}

/** Average standard price of what the mixers make (weighted by output), or of a primary. */
export function averagePrice(state, r = rates(state)) {
  let w = 0;
  let s = 0;
  for (const [c, j] of Object.entries(r.byColor)) {
    w += j;
    s += j * colorPrice(state, c);
  }
  return w > 0 ? s / w : colorPrice(state, 'madder');
}

/** r_idle: coins/s estimate = min(production, shop + fleet) × avg price × income multiplier. */
export function incomeRate(state, now) {
  const r = rates(state, now);
  const flow = Math.min(r.jars, r.sell);
  return num(flow * averagePrice(state, r) * shopPriceBonus(state) * incomeMultiplier(state, now));
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

/** Every upgrade she could buy right now: [{kind, id|index, cost, label}]. */
export function upgradeOptions(state) {
  const out = [];
  scanOptions(state, ALL_KINDS, (kind, ref, cost) => { if (Number.isFinite(cost)) out.push(optionOf(state, kind, ref, cost)); });
  return out;
}

const ALL_KINDS = Object.freeze({ source: true, grinder: true, mixer: true, vat: true, shop: true, fleet: true, cellar: true });

/**
 * Visits every upgrade of the given kinds in upgradeOptions order as (kind, ref, cost),
 * ref = source id or station index. No labels: the flow meter and cheapestUpgrade price
 * every station on each call (thousands of times per simulated day) and label only
 * their pick (optionOf).
 */
function scanOptions(state, kinds, visit) {
  const st = state?.stations ?? {};
  if (kinds.source) for (const [id, s] of Object.entries(st.sources ?? {})) visit('source', id, stationCost('source', s?.level ?? 0, id));
  if (kinds.grinder) (st.grinders ?? []).forEach((g, index) => visit('grinder', index, stationCost('grinder', g.level)));
  if (kinds.mixer) (st.mixers ?? []).forEach((m, index) => visit('mixer', index, stationCost('mixer', m.level)));
  if (kinds.vat) (st.vats ?? []).forEach((v, index) => visit('vat', index, stationCost('vat', v.level)));
  if (kinds.shop && st.shop) visit('shop', null, stationCost('shop', st.shop.level ?? 1));
  if (kinds.fleet) (st.fleet ?? []).forEach((v, index) => visit('fleet', index, stationCost('vehicle', v.level, v.kind)));
  if (kinds.cellar) visit('cellar', null, stationCost('cellar', state?.cellarLevel ?? 1));
}

/** One upgradeOptions entry: {kind, id|index, cost, label}. */
function optionOf(state, kind, ref, cost) {
  const st = state?.stations ?? {};
  switch (kind) {
    case 'source': {
      const L = st.sources[ref]?.level ?? 0;
      const name = SOURCES_BY_ID[ref]?.name ?? ref;
      return { kind, id: ref, cost, label: L > 0 ? `${name} to level ${L + 1}` : `Build ${name}` };
    }
    case 'grinder': {
      const g = st.grinders[ref];
      const name = GRINDER_KINDS_BY_ID[g.kind]?.name ?? 'Grinder';
      return { kind, index: ref, cost, label: `${name} to level ${g.level + 1}` };
    }
    case 'mixer': return { kind, index: ref, cost, label: `Mixer ${ref + 1} to level ${st.mixers[ref].level + 1}` };
    case 'vat': return { kind, index: ref, cost, label: `Bigger jars to level ${st.vats[ref].level + 1}` };
    case 'shop': return { kind, cost, label: `Shop counter to level ${(st.shop.level ?? 1) + 1}` };
    case 'fleet': {
      const v = st.fleet[ref];
      const name = VEHICLES_BY_ID[v.kind]?.name ?? 'Vehicle';
      return { kind, index: ref, cost, label: `${name} to level ${v.level + 1}` };
    }
    default: {
      const cl = state?.cellarLevel ?? 1;
      return { kind: 'cellar', cost, label: `Cellar to level ${cl + 1}` };
    }
  }
}

/** The cheapest finite option of `kinds` passing `keep(kind, ref)` (first on ties), labeled, or null. */
function cheapestOption(state, kinds, keep) {
  let bk = null;
  let br = null;
  let bc = Infinity;
  scanOptions(state, kinds, (kind, ref, cost) => {
    if (!Number.isFinite(cost) || (bk !== null && !(cost < bc))) return;
    if (keep && !keep(kind, ref)) return;
    bk = kind; br = ref; bc = cost;
  });
  return bk === null ? null : optionOf(state, bk, br, bc);
}

/** Cheapest upgrade across sources/grinders/mixers/vats/shop/fleet/cellar. */
export function cheapestUpgrade(state) {
  return cheapestOption(state, ALL_KINDS, null) ?? { kind: 'shop', cost: stationCost('shop', 1), label: 'Shop counter' };
}

/**
 * puzzleReward(state, tier, {k, mult}) = max(k · r_idle · 60, 0.25 · mult · c_min).
 * `tier` is relaxed|steady|tricky|master (explicit k / mult override it).
 */
export function puzzleReward(state, tier = 'relaxed', opts = {}) {
  const t = PUZZLE_TIERS[tier] ?? PUZZLE_TIERS.relaxed;
  const k = num(opts.k, t.k);
  const mult = num(opts.mult, t.mult);
  const r = incomeRate(state, opts.now);
  const cmin = num(cheapestUpgrade(state).cost);
  return Math.max(k * r * 60, REWARD_FLOOR * mult * cmin, 0);
}

/** Tutorial rewards (first order, first board) pay this many cheapest upgrades on top. */
export const TUTORIAL_REWARD_MULT = 1;

/**
 * tutorialReward(state) -> TUTORIAL_REWARD_MULT × c_min. Paid once for the
 * onboarding's first order (`order.tutorial`) and once for its first grading
 * board (`onboarding.flags.firstBoardPaid`), so she can buy an upgrade right
 * after each (DESIGN.md "First ten minutes"; TUNING.md change 7).
 */
export function tutorialReward(state) {
  return Math.max(0, num(TUTORIAL_REWARD_MULT * num(cheapestUpgrade(state).cost)));
}

// ---------------------------------------------------------------------------
// Flow meter
// ---------------------------------------------------------------------------

const KINDS_SOURCE = Object.freeze({ source: true });
const KINDS_GRINDER = Object.freeze({ grinder: true });
const KINDS_MIXER = Object.freeze({ mixer: true });
const KINDS_SHIP = Object.freeze({ shop: true, fleet: true });
const KINDS_STORE = Object.freeze({ vat: true, cellar: true });

/**
 * flowMeter(state) -> {make:{rate}, store:{capacity, fillMs, windowMs, targetMs},
 * ship:{rate}, weakest, scores, suggestion:{label, cost, kind, index|id}}.
 * Make vs Ship compare jar rates; Store compares the offline window
 * (capacity ÷ production) with the phase target. The narrowest wins.
 */
export function flowMeter(state, now) {
  const r = rates(state, now);
  const cap = capacity(state);
  const stock = stockTotal(state);
  const fillMs = r.jars > 0 ? Math.max(0, cap.total - stock) / r.jars * 1000 : Infinity;
  const windowMs = r.jars > 0 ? cap.total / r.jars * 1000 : Infinity;
  const targetMs = STORE_TARGET_MS[state?.phase ?? 1] ?? STORE_TARGET_MS[3];
  const top = Math.max(r.jars, r.sell, 1e-9);
  const scores = {
    make: r.jars / top,
    ship: r.sell / top,
    store: Number.isFinite(windowMs) ? Math.min(1, windowMs / targetMs) : 1,
  };
  let weakest = 'make';
  if (r.jars > 0) {
    for (const k of ['make', 'ship', 'store']) if (scores[k] < scores[weakest] - 1e-9) weakest = k;
  }
  // The cheapest option of the weakest stage (the order and ties of upgradeOptions).
  let suggestion = null;
  if (weakest === 'make') {
    const anyRecipe = (state?.stations?.mixers ?? []).some((m) => m && m.recipe);
    if (!anyRecipe) {
      suggestion = { label: 'Choose a recipe for a mixer', cost: 0, kind: 'assign', index: 0 };
    } else if (r.limit === 'raw') {
      const src = r.rawLimited.map((p) => Object.keys(state.stations.sources).find((id) => (SOURCES_BY_ID[id]?.pigment ?? id) === p)).filter(Boolean);
      suggestion = cheapestOption(state, KINDS_SOURCE, (kind, id) => src.includes(id));
    } else if (r.limit === 'grinder') {
      suggestion = cheapestOption(state, KINDS_GRINDER, null);
    } else {
      suggestion = cheapestOption(state, KINDS_MIXER, (kind, index) => state.stations.mixers[index]?.recipe);
    }
  } else if (weakest === 'ship') {
    suggestion = cheapestOption(state, KINDS_SHIP, null);
  } else {
    suggestion = cheapestOption(state, KINDS_STORE, null);
  }
  if (!suggestion) suggestion = cheapestUpgrade(state);
  return {
    make: { rate: r.jars },
    store: { capacity: cap.total, fillMs, windowMs, targetMs },
    ship: { rate: r.sell },
    weakest,
    scores,
    suggestion,
  };
}

/** Owned room ids → slot totals (re-exported for UI convenience). */
export function slots(state) {
  return slotsForRooms(state?.rooms ?? []);
}

export { ROOMS };
