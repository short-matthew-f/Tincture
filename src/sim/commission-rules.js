// sim/commission-rules.js — what a commission step accepts (pure, no state).
// Shared by sim/commissions.js (delivery, guidance, feasibility) and
// sim/storage.js (the shop keeps jars an open step can use).
//
// Playtest ("her blue tints don't seem to qualify"): a step that asks for
// "blues" now takes every color that reads as blue to a person, not only the
// ones whose catalog `family` is exactly 'blue':
//   1. its catalog family;
//   2. a pale or greyish color (catalog family 'neutral') that still leans to
//      a hue: Powder Blue, Mist, Heather count for that hue as well;
//   3. a color within NEAR_BAND_DEG of a hue-band edge counts for the
//      neighbor too ("Teal" sits 3° past the teal/blue edge);
//   4. a family word in its catalog name ("Bottle Green", "Shell Pink"); such a
//      name settles it, so rules 2 and 3 are skipped ("Green" is not a yellow).
// A pigment step ("umber") takes the pigment's own color or any color made
// with that pigment. A wild-hue step and a container (tier) step are filled
// from the Merge Shelf, one container at a time, because wild hues cannot be
// mixed into jars.

import { CATALOG, getColor } from '../content/catalog.js';
import { hexToOklch, hueFamily } from '../color.js';
import { getCommission } from '../content/commissions.js';

/** Degrees from a hue-band edge within which a color counts for both families. */
export const NEAR_BAND_DEG = 5;
/** A 'neutral' color with at least this OKLCH chroma still leans to its hue. */
export const LEAN_CHROMA = 0.012;

// Must match color.js HUE_BANDS (upper edges, degrees).
const EDGES = [[15, 'pink', 'red'], [45, 'red', 'orange'], [75, 'orange', 'yellow'], [118, 'yellow', 'green'],
  [170, 'green', 'teal'], [225, 'teal', 'blue'], [280, 'blue', 'violet'], [330, 'violet', 'pink']];

const NAME_WORDS = Object.freeze({
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', teal: 'teal', blue: 'blue',
  violet: 'violet', purple: 'violet', pink: 'pink', grey: 'neutral', gray: 'neutral', white: 'neutral', black: 'neutral',
});

const famCache = new Map();

/** Every hue family a color counts for in a commission (a Set; empty for unknown ids). */
export function familiesOf(colorId) {
  if (famCache.has(colorId)) return famCache.get(colorId);
  const out = new Set();
  const c = colorId ? getColor(colorId) : null;
  if (c && c.hex) {
    let lch = null;
    try { lch = hexToOklch(c.hex); } catch { lch = null; }
    const base = c.family || (lch ? hueFamily(c.hex) : 'neutral');
    out.add(base);
    const named = String(c.name || '').toLowerCase().split(/[^a-z]+/).map((w) => NAME_WORDS[w]).filter(Boolean);
    for (const f of named) out.add(f);
    // A family word in the name settles it ("Green" is a green, not also a yellow).
    if (lch && !named.length) {
      const band = lch.C >= 0.03 ? null : bandOf(lch.h);
      if (base === 'neutral' && lch.C >= LEAN_CHROMA && band) out.add(band);
      if (lch.C >= 0.03) {
        for (const [edge, below, above] of EDGES) {
          if (Math.abs(lch.h - edge) <= NEAR_BAND_DEG) { out.add(below); out.add(above); }
        }
      }
    }
  }
  famCache.set(colorId, out);
  return out;
}

function bandOf(h) {
  for (const [edge, below] of EDGES) if (h < edge) return below;
  return 'pink';
}

/** Does a recipe use this pigment? */
export function madeWith(colorId, pigmentId) {
  const c = getColor(colorId);
  return !!(c && Array.isArray(c.recipe) && c.recipe.some((r) => r.pigment === pigmentId));
}

const acceptCache = new WeakMap();
const CATALOG_IDS = new Set(CATALOG.map((c) => c.id));
/** Does a color satisfy a step's color rule (ignores purity, tier and the distinct rule)? */
export function stepMatches(step, colorId) {
  if (!step || !colorId) return false;
  let set = acceptCache.get(step);
  if (!set) {
    set = new Set(CATALOG.filter((c) => matchRule(step, c.id)).map((c) => c.id));
    acceptCache.set(step, set);
  }
  if (set.has(colorId)) return true;
  return CATALOG_IDS.has(colorId) ? false : matchRule(step, colorId);
}

function matchRule(step, colorId) {
  if (step.colorId) return colorId === step.colorId;
  if (step.pigment) return colorId === step.pigment || madeWith(colorId, step.pigment);
  const fams = familiesOf(colorId);
  if (step.family) return fams.has(step.family);
  if (step.families) return step.families.some((f) => fams.has(f));
  return false;
}

/** Steps filled with Merge Shelf containers instead of stock jars. */
export function usesShelf(step) {
  return !!(step && (step.tier || step.wild));
}

/** Smallest container size a shelf step takes (1 = a Vial). */
export function minTier(step) {
  return step && step.tier ? step.tier : 1;
}

const candCache = new WeakMap();
/** Every Era catalog color (signature colors excluded) a step accepts. */
export function stepCandidates(step) {
  if (candCache.has(step)) return candCache.get(step);
  const out = CATALOG.filter((c) => c.foundBy !== 'commission' && stepMatches(step, c.id)).map((c) => c.id);
  candCache.set(step, out);
  return out;
}

const fin = (x) => (Number.isFinite(x) ? x : 0);

/** Distinct colors delivered so far to a step's progress record. */
export function distinctDelivered(prog) {
  return Object.keys((prog && prog.colors) || {}).filter((k) => prog.colors[k] > 0).length;
}

/** How many more jars (or containers) this step will take of `colorId`, keeping room for the distinct rule. */
export function roomFor(step, prog, colorId) {
  const p = prog || { delivered: 0, colors: {} };
  const remaining = Math.max(0, step.jars - fin(p.delivered));
  const has = (p.colors || {})[colorId] > 0;
  const distinctAfter = distinctDelivered(p) + (has ? 0 : 1);
  const missing = Math.max(0, (step.distinct ?? 1) - distinctAfter);
  return Math.max(0, remaining - missing);
}

/** Jars the shop keeps back of each color by default while an open step can use them. */
export const COMMISSION_KEEP_MAX = 20;

/**
 * commissionReserves(state) -> {colorId: jars} the shop should keep for open commission
 * steps that take stock jars: per color the largest single step's room, capped at
 * COMMISSION_KEEP_MAX. Only colors in stock or in a mixer are considered.
 */
export function commissionReserves(state, getDef = getCommission) {
  const out = {};
  const open = (state && state.commissions && Array.isArray(state.commissions.open)) ? state.commissions.open : [];
  if (!open.length) return out;
  const ids = new Set(Object.keys((state && state.stock) || {}));
  for (const m of (state.stations && state.stations.mixers) || []) if (m && m.recipe) ids.add(m.recipe);
  // Called on every factory step: memo per (progress, colors) so a tick costs one string build.
  const key = progressStamp(open) + '#' + [...ids].join(',');
  const memo = reservesCache.get(state);
  if (memo && memo.key === key && memo.getDef === getDef) return memo.out;
  for (const rec of open) {
    const def = rec && getDef(rec.id);
    if (!def) continue;
    def.steps.forEach((st, i) => {
      const p = rec.steps && rec.steps[i];
      if (!p || p.done || usesShelf(st)) return;
      for (const id of ids) {
        if (!stepMatches(st, id)) continue;
        const r = Math.min(COMMISSION_KEEP_MAX, Math.ceil(roomFor(st, p, id) - 1e-9));
        if (r > (out[id] ?? 0)) out[id] = r;
      }
    });
  }
  reservesCache.set(state, { key, getDef, out });
  return out;
}
const reservesCache = new WeakMap();

const reserveCache = new WeakMap();
function progressStamp(open) {
  let k = '';
  for (const rec of open) {
    k += rec.id + ':';
    for (const p of rec.steps || []) k += (p && p.done ? 'd' : fin(p && p.delivered)) + '/' + (p && p.colors ? Object.keys(p.colors).length : 0) + ',';
  }
  return k;
}

/** commissionReserve(state, colorId) -> jars kept of one color for open commission steps (0 if none). */
export function commissionReserve(state, colorId, getDef = getCommission) {
  const open = (state && state.commissions && Array.isArray(state.commissions.open)) ? state.commissions.open : [];
  if (!open.length) return 0;
  // The shop and the Dispatcher ask for many colors in a row: memo per progress stamp.
  const stamp = progressStamp(open);
  let memo = reserveCache.get(state);
  if (!memo || memo.stamp !== stamp || memo.getDef !== getDef) { memo = { stamp, getDef, map: new Map() }; reserveCache.set(state, memo); }
  if (memo.map.has(colorId)) return memo.map.get(colorId);
  let best = 0;
  for (const rec of open) {
    const def = rec && getDef(rec.id);
    if (!def) continue;
    def.steps.forEach((st, i) => {
      const p = rec.steps && rec.steps[i];
      if (!p || p.done || usesShelf(st) || !stepMatches(st, colorId)) return;
      best = Math.max(best, Math.ceil(roomFor(st, p, colorId) - 1e-9));
    });
  }
  const r = Math.min(COMMISSION_KEEP_MAX, best);
  memo.map.set(colorId, r);
  return r;
}
