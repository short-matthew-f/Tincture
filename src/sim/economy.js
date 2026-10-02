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
  return hueFamily(d?.hex ?? '#888888');
}

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
  return c0 * Math.pow(growth, L);
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
  return b * L * Math.pow(2, milestonesPassed(L));
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

export function discoveredCount(state) {
  return Object.keys(state?.catalog?.discovered ?? {}).length;
}

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
  return out;
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
  const st = state?.stations ?? {};
  const raw = {};
  for (const [id, s] of Object.entries(st.sources ?? {})) {
    const pig = SOURCES_BY_ID[id]?.pigment ?? id;
    raw[pig] = (raw[pig] ?? 0) + stationOutput('source', s?.level ?? 0, id) * pm;
  }
  let grinderCap = 0;
  for (const g of st.grinders ?? []) grinderCap += stationOutput('grinder', g.level, g.kind) * pm;

  const mixers = st.mixers ?? [];
  const want = mixers.map((m) => {
    if (!m || !m.recipe) return 0;
    if (!recipeShares(m.recipe)) return 0;
    return stationOutput('mixer', m.level) * pm * (1 + ESSENCE_STEP * essenceOf(state, m.recipe));
  });
  const demand = {};
  mixers.forEach((m, i) => {
    if (!want[i]) return;
    const sh = recipeShares(m.recipe);
    for (const [p, w] of Object.entries(sh)) demand[p] = (demand[p] ?? 0) + want[i] * w * MIXER.pigmentPerJar;
  });
  const factor = {};
  const rawLimited = [];
  for (const [p, d] of Object.entries(demand)) {
    const sup = raw[p] ?? 0;
    factor[p] = d > 0 ? Math.min(1, sup / d) : 1;
    if (factor[p] < 1) rawLimited.push(p);
  }
  const f = mixers.map((m, i) => {
    if (!want[i]) return 0;
    let x = 1;
    for (const p of Object.keys(recipeShares(m.recipe))) x = Math.min(x, factor[p] ?? 1);
    return x;
  });
  let used = 0;
  mixers.forEach((m, i) => {
    if (!want[i]) return;
    const sh = recipeShares(m.recipe);
    for (const w of Object.values(sh)) used += f[i] * want[i] * w * MIXER.pigmentPerJar;
  });
  const g = used > 0 ? Math.min(1, grinderCap / used) : 1;
  const mixerJars = mixers.map((m, i) => num(want[i] * f[i] * g));
  const pigment = {};
  const byColor = {};
  mixers.forEach((m, i) => {
    if (!mixerJars[i]) return;
    byColor[m.recipe] = (byColor[m.recipe] ?? 0) + mixerJars[i];
    for (const [p, w] of Object.entries(recipeShares(m.recipe))) {
      pigment[p] = (pigment[p] ?? 0) + mixerJars[i] * w * MIXER.pigmentPerJar;
    }
  });
  const jars = mixerJars.reduce((s, x) => s + x, 0);
  const shop = shopSellRate(state);
  const fleet = fleetSellRate(state);
  let limit = null;
  if (jars > 0 || want.some((x) => x > 0)) {
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
  const st = state?.stations ?? {};
  const out = [];
  for (const [id, s] of Object.entries(st.sources ?? {})) {
    const L = s?.level ?? 0;
    const name = SOURCES_BY_ID[id]?.name ?? id;
    out.push({ kind: 'source', id, cost: stationCost('source', L, id), label: L > 0 ? `${name} to level ${L + 1}` : `Build ${name}` });
  }
  (st.grinders ?? []).forEach((g, index) => {
    const name = GRINDER_KINDS_BY_ID[g.kind]?.name ?? 'Grinder';
    out.push({ kind: 'grinder', index, cost: stationCost('grinder', g.level), label: `${name} to level ${g.level + 1}` });
  });
  (st.mixers ?? []).forEach((m, index) => {
    out.push({ kind: 'mixer', index, cost: stationCost('mixer', m.level), label: `Mixer ${index + 1} to level ${m.level + 1}` });
  });
  (st.vats ?? []).forEach((v, index) => {
    out.push({ kind: 'vat', index, cost: stationCost('vat', v.level), label: `Vat ${index + 1} to level ${v.level + 1}` });
  });
  if (st.shop) out.push({ kind: 'shop', cost: stationCost('shop', st.shop.level ?? 1), label: `Shop counter to level ${(st.shop.level ?? 1) + 1}` });
  (st.fleet ?? []).forEach((v, index) => {
    const name = VEHICLES_BY_ID[v.kind]?.name ?? 'Vehicle';
    out.push({ kind: 'fleet', index, cost: stationCost('vehicle', v.level, v.kind), label: `${name} to level ${v.level + 1}` });
  });
  const cl = state?.cellarLevel ?? 1;
  out.push({ kind: 'cellar', cost: stationCost('cellar', cl), label: `Cellar to level ${cl + 1}` });
  return out.filter((o) => Number.isFinite(o.cost));
}

/** Cheapest upgrade across sources/grinders/mixers/vats/shop/fleet/cellar. */
export function cheapestUpgrade(state) {
  let best = null;
  for (const o of upgradeOptions(state)) if (!best || o.cost < best.cost) best = o;
  return best ?? { kind: 'shop', cost: stationCost('shop', 1), label: 'Shop counter' };
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

function cheapestOf(list) {
  let best = null;
  for (const o of list) if (Number.isFinite(o.cost) && (!best || o.cost < best.cost)) best = o;
  return best;
}

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
  const opts = upgradeOptions(state);
  let suggestion = null;
  if (weakest === 'make') {
    const anyRecipe = (state?.stations?.mixers ?? []).some((m) => m && m.recipe);
    if (!anyRecipe) {
      suggestion = { label: 'Choose a recipe for a mixer', cost: 0, kind: 'assign', index: 0 };
    } else if (r.limit === 'raw') {
      const src = r.rawLimited.map((p) => Object.keys(state.stations.sources).find((id) => (SOURCES_BY_ID[id]?.pigment ?? id) === p)).filter(Boolean);
      suggestion = cheapestOf(opts.filter((o) => o.kind === 'source' && src.includes(o.id)));
    } else if (r.limit === 'grinder') {
      suggestion = cheapestOf(opts.filter((o) => o.kind === 'grinder'));
    } else {
      suggestion = cheapestOf(opts.filter((o) => o.kind === 'mixer' && state.stations.mixers[o.index]?.recipe));
    }
  } else if (weakest === 'ship') {
    suggestion = cheapestOf(opts.filter((o) => o.kind === 'shop' || o.kind === 'fleet'));
  } else {
    suggestion = cheapestOf(opts.filter((o) => o.kind === 'vat' || o.kind === 'cellar'));
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
