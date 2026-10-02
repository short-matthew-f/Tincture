// matching.js — customer orders: mix drops to hit a target swatch (pure).
// Implements docs/DESIGN.md "Active play › Matching (orders)": paint-style
// mixing (color.mixPaint), OKLab ΔE scoring with Perfect/Great/Good/Close
// tiers, no fail state, and targets generated from a real recipe of her
// pigments so a Perfect match is always reachable. Orders are plain data.

import { mixPaintHex, deltaEHex, WHITE, BLACK } from '../color.js';
import { shuffle, randInt, chance } from '../rng.js';

/** The two free drops (ids match src/content/pigments.js DROPS). */
export const DROPS = Object.freeze([
  Object.freeze({ id: 'white', hex: WHITE }),
  Object.freeze({ id: 'black', hex: BLACK }),
]);

/** Score tiers, best first. `max` is the exclusive ΔE ceiling. */
export const SCORE_TIERS = Object.freeze([
  Object.freeze({ tier: 'perfect', max: 2, pct: 1.5, star: true }),
  Object.freeze({ tier: 'great', max: 5, pct: 1.2, star: false }),
  Object.freeze({ tier: 'good', max: 10, pct: 1.0, star: false }),
  Object.freeze({ tier: 'close', max: Infinity, pct: 0.7, star: false }),
]);

/** ΔE at which the live closeness needle reaches 0. */
export const NEEDLE_RANGE = 30;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function resolveRng(opts, rng) {
  const r = typeof rng === 'function' ? rng : opts && opts.rng;
  if (typeof r !== 'function') throw new TypeError('matching: an rng function is required');
  return r;
}

/**
 * createOrder({pigments:[{id,hex}], includeDrops = true, maxParts = 3, rng,
 * difficulty = 0..1}) -> {kind:'mix', recipe:[{pigment, weight}], target, parts}.
 * Picks 2–3 distinct pigments (fewer if she owns fewer; 3 grows likelier with
 * difficulty), maybe one white or black drop, integer weights 1–4 (the range
 * widens with difficulty), reduced by their gcd. `parts` is the drop count.
 * `rng` may be passed in opts or as the second argument.
 */
export function createOrder(opts, rngArg) {
  const rng = resolveRng(opts, rngArg);
  const { pigments = [], includeDrops = true, maxParts = 3 } = opts || {};
  const difficulty = Math.min(1, Math.max(0, Number(opts && opts.difficulty) || 0));
  const usable = pigments.filter((p) => p && typeof p.id === 'string' && typeof p.hex === 'string');
  if (!usable.length) throw new RangeError('matching.createOrder: need at least one pigment');

  const want = 2 + (chance(rng, 0.25 + 0.6 * difficulty) ? 1 : 0);
  const count = Math.max(1, Math.min(want, Math.max(1, Math.floor(maxParts)), usable.length));
  const chosen = shuffle(rng, usable).slice(0, count);
  const topWeight = 2 + Math.round(2 * difficulty); // 2 at easy, 4 at hard
  const recipe = chosen.map((p) => ({ pigment: p.id, hex: p.hex, weight: randInt(rng, 1, topWeight) }));

  if (includeDrops && chance(rng, 0.3 + 0.3 * difficulty)) {
    // White lightens gently and is the friendlier drop; black darkens hard, so one drop at most.
    const useBlack = chance(rng, 0.3);
    const drop = useBlack ? DROPS[1] : DROPS[0];
    const total = recipe.reduce((s, r) => s + r.weight, 0);
    const weight = useBlack ? 1 : randInt(rng, 1, Math.max(1, Math.min(4, total - 1)));
    recipe.push({ pigment: drop.id, hex: drop.hex, weight });
  }

  const g = recipe.reduce((acc, r) => gcd(acc, r.weight), 0) || 1;
  for (const r of recipe) r.weight /= g;
  const target = mixPaintHex(recipe.map((r) => ({ hex: r.hex, weight: r.weight })));
  return {
    kind: 'mix',
    recipe: recipe.map((r) => ({ pigment: r.pigment, weight: r.weight })),
    target,
    parts: recipe.reduce((s, r) => s + r.weight, 0),
  };
}

/** ARCHITECTURE.md alias. */
export const create = createOrder;

/** "Any color you love" order: no target; every submission is welcome. */
export function createAnyYouLoveOrder() {
  return { kind: 'any', recipe: null, target: null, parts: 0 };
}

/** Event twist: a bouquet of 2–3 targets, each from its own real recipe. */
export function createBouquetOrder(opts, rngArg) {
  const rng = resolveRng(opts, rngArg);
  const n = opts && Number.isInteger(opts.count) ? Math.min(3, Math.max(2, opts.count)) : randInt(rng, 2, 3);
  const orders = [];
  for (let k = 0; k < n * 4 && orders.length < n; k++) {
    const o = createOrder(opts, rng);
    // Keep bouquet swatches visibly different from each other.
    if (orders.every((p) => deltaEHex(p.target, o.target) >= 8) || k >= n * 4 - (n - orders.length)) orders.push(o);
  }
  return { kind: 'bouquet', orders, targets: orders.map((o) => o.target) };
}

/** Live blend of drops [{id, hex, count}] -> hex, or null for an empty jar. */
export function blend(drops) {
  if (!Array.isArray(drops)) return null;
  const parts = drops
    .filter((d) => d && typeof d.hex === 'string' && Number.isFinite(d.count) && d.count > 0)
    .map((d) => ({ hex: d.hex, weight: d.count }));
  return parts.length ? mixPaintHex(parts) : null;
}

/** score(targetHex, mixHex) -> {de, tier, pct, star}. Never fails: worst is 'close' at 70%.
 *  An empty jar (mixHex null) scores 'close' with de null. */
export function score(targetHex, mixHex) {
  if (!mixHex || !targetHex) return { de: null, tier: 'close', pct: 0.7, star: false };
  const de = deltaEHex(targetHex, mixHex);
  const t = SCORE_TIERS.find((s) => de < s.max);
  return { de, tier: t.tier, pct: t.pct, star: t.star };
}

/** Live needle: 1 at ΔE 0 falling linearly to 0 at ΔE ≥ 30 (0 for an empty jar). */
export function closeness(targetHex, mixHex) {
  if (!mixHex || !targetHex) return 0;
  return Math.max(0, 1 - deltaEHex(targetHex, mixHex) / NEEDLE_RANGE);
}

/** Recipe -> drops list for blend(), given a lookup of id -> hex. */
export function recipeDrops(recipe, hexOf) {
  return recipe.map((r) => ({ id: r.pigment, hex: hexOf(r.pigment), count: r.weight }));
}
