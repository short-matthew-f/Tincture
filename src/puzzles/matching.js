// matching.js — customer orders: mix drops to hit a target swatch (pure).
// Implements docs/DESIGN.md "Active play › Matching (orders)": paint-style
// mixing (color.mixPaint), OKLab ΔE scoring with Perfect/Great/Good/Close
// tiers, no fail state, and targets generated from a real recipe of her
// pigments so a Perfect match is always reachable. Targets are chosen for
// appeal ("Color is the content"): clear chroma, comfortable lightness, and
// distinct from what is already on the board. Orders are plain data.

import { mixPaintHex, deltaEHex, hexToOklch, hueFamily, WHITE, BLACK } from '../color.js';
import { shuffle, randInt, chance, weightedPick } from '../rng.js';

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
const HEX_RE = /^#[0-9a-f]{6}$/i;

function resolveRng(opts, rng) {
  const r = typeof rng === 'function' ? rng : opts && opts.rng;
  if (typeof r !== 'function') throw new TypeError('matching: an rng function is required');
  return r;
}

/** Order-target appeal rules (docs/DESIGN.md pillar "Color is the content"). */
export const TARGET_RULES = Object.freeze({
  candidates: 12, // recipes sampled per round
  rounds: 4, // extra rounds before falling back to the best-scoring candidate
  minChroma: 0.07, // below this a target is "muted" (one muted order on the board at most)
  lightness: Object.freeze([0.3, 0.88]),
  minBoardDE: 8, // ΔE from every target already open on the board
  threePigments: 0.2, // 1 in 5 recipes use three pigments
  onePigment: 0.1, // now and then a lone pigment's tint or shade (always carries a drop)
  white: 0.55, // about half the orders are tints (1–3 white drops)
  black: 1 / 6, // black is rare, one drop
  catalogChance: 0.5, // how often a real catalog color is the target
});

const isDrop = (id) => id === 'white' || id === 'black';

// Internal: a recipe [{pigment, hex, weight}] reduced by its gcd, as an order.
function finish(recipe, extra) {
  const g = recipe.reduce((acc, r) => gcd(acc, r.weight), 0) || 1;
  const rec = recipe.map((r) => ({ pigment: r.pigment, hex: r.hex, weight: r.weight / g }));
  const target = mixPaintHex(rec.map((r) => ({ hex: r.hex, weight: r.weight })));
  return {
    kind: 'mix',
    recipe: rec.map((r) => ({ pigment: r.pigment, weight: r.weight })),
    target,
    parts: rec.reduce((s, r) => s + r.weight, 0),
    ...extra,
  };
}

// Internal: one random recipe from her pigments (+ drops).
function sampleRecipe(rng, usable, { includeDrops, maxPigments, topWeight }) {
  const roll = rng();
  let want = roll < TARGET_RULES.threePigments ? 3 : 2;
  if (includeDrops && roll >= 1 - TARGET_RULES.onePigment) want = 1;
  const count = Math.max(1, Math.min(want, maxPigments, usable.length));
  const chosen = shuffle(rng, usable).slice(0, count);
  const recipe = chosen.map((p) => ({ pigment: p.id, hex: p.hex, weight: randInt(rng, 1, topWeight) }));
  if (includeDrops) {
    const total = recipe.reduce((s, r) => s + r.weight, 0);
    const d = rng();
    // A lone pigment always takes a drop, so its target is a tint or shade rather than the pigment itself.
    const white = d < TARGET_RULES.white || (count === 1 && d >= TARGET_RULES.white + TARGET_RULES.black);
    if (white) recipe.push({ pigment: 'white', hex: DROPS[0].hex, weight: randInt(rng, 1, Math.max(1, Math.min(3, total + 1))) });
    else if (d < TARGET_RULES.white + TARGET_RULES.black) recipe.push({ pigment: 'black', hex: DROPS[1].hex, weight: 1 });
  }
  return finish(recipe);
}

// Internal: OKLCH, hue family and board distance of a target, plus whether it passes the rules.
function assess(order, ctx) {
  const lch = hexToOklch(order.target);
  const family = hueFamily(order.target);
  let minDE = Infinity;
  for (const h of ctx.avoid) minDE = Math.min(minDE, deltaEHex(order.target, h));
  const muted = lch.C < TARGET_RULES.minChroma;
  const [lo, hi] = TARGET_RULES.lightness;
  const pass = family !== 'neutral' && lch.L >= lo && lch.L <= hi
    && minDE >= TARGET_RULES.minBoardDE
    && !ctx.avoidFamilies.has(family)
    && (!muted || ctx.mutedOnBoard < 1);
  // Appeal: chroma (capped, so the most saturated orange does not always win),
  // a comfortable lightness, distance from the board and a hue the board lacks.
  let appeal = Math.min(lch.C, 0.13) / 0.13;
  if (muted) appeal *= 0.5;
  if (lch.L < 0.4 || lch.L > 0.84) appeal *= 0.8;
  if (ctx.avoid.length) appeal += 0.4 * Math.min(minDE, 25) / 25 + (ctx.boardFamilies.has(family) ? 0 : 0.3);
  if (order.colorId && !order.known) appeal += 0.2;
  // The fallback ranks by how badly the rules are missed.
  const miss = (family === 'neutral' ? 1 : 0) + Math.max(0, lo - lch.L) + Math.max(0, lch.L - hi)
    + Math.max(0, TARGET_RULES.minBoardDE - minDE) / 4
    + (ctx.avoidFamilies.has(family) ? 1 : 0)
    + (muted && ctx.mutedOnBoard >= 1 ? 1 : 0);
  return { pass, appeal: Math.max(0.01, appeal), miss };
}

/**
 * createOrder({pigments:[{id,hex}], includeDrops = true, maxParts = 3, rng,
 * difficulty = 0..1, avoidHexes = [], avoidFamilies = [], catalogRecipes = [],
 * catalogChance = 0.5}) -> {kind:'mix', recipe:[{pigment, weight}], target, parts, colorId?}.
 *
 * Every target is mixPaintHex of its own recipe, so Perfect is always reachable.
 * To keep the board colorful (docs/DESIGN.md "Color is the content") it samples
 * candidate recipes and picks by appeal: mostly two pigments (three 1 in 5, a
 * lone pigment's tint now and then), white in about half (tints), black rarely;
 * weights 1–2 when easy up to 1–4 when hard (`maxParts` caps distinct pigments).
 * A candidate passes when its OKLCH lightness is in [0.3, 0.88], it is ΔE ≥ 8
 * from every `avoidHexes` target, its hue family is neither 'neutral' nor in
 * `avoidFamilies`, and its chroma is ≥ 0.07 (one muted target is allowed while
 * `avoidHexes` holds none). About half the time a passing `catalogRecipes` entry ({id, hex,
 * recipe, discovered?}) whose recipe uses only her pigments and drops is the
 * target instead (`colorId` names it). If nothing passes, the best-scoring
 * candidate is used, so an order is always produced. `rng` may be passed in
 * opts or as the second argument.
 */
export function createOrder(opts, rngArg) {
  const rng = resolveRng(opts, rngArg);
  const o = opts || {};
  const { pigments = [], includeDrops = true, maxParts = 3 } = o;
  const difficulty = Math.min(1, Math.max(0, Number(o.difficulty) || 0));
  const usable = pigments.filter((p) => p && typeof p.id === 'string' && typeof p.hex === 'string' && !isDrop(p.id));
  if (!usable.length) throw new RangeError('matching.createOrder: need at least one pigment');

  const avoid = (Array.isArray(o.avoidHexes) ? o.avoidHexes : []).filter((h) => typeof h === 'string' && HEX_RE.test(h));
  const ctx = {
    avoid,
    avoidFamilies: new Set(Array.isArray(o.avoidFamilies) ? o.avoidFamilies : []),
    boardFamilies: new Set(avoid.map(hueFamily)),
    mutedOnBoard: avoid.filter((h) => hexToOklch(h).C < TARGET_RULES.minChroma).length,
  };
  const pool = [];
  const choose = (list) => {
    const scored = list.map((c) => ({ c, ...assess(c, ctx) }));
    pool.push(...scored);
    const ok = scored.filter((s) => s.pass);
    return ok.length ? weightedPick(rng, ok, (s) => s.appeal * s.appeal).c : null;
  };

  // A real catalog color, about half the time.
  const catalogChance = Number.isFinite(o.catalogChance) ? o.catalogChance : TARGET_RULES.catalogChance;
  const catalog = Array.isArray(o.catalogRecipes) ? o.catalogRecipes : [];
  if (catalog.length && chance(rng, catalogChance)) {
    const hexOf = new Map([...usable.map((p) => [p.id, p.hex]), ...(includeDrops ? DROPS.map((d) => [d.id, d.hex]) : [])]);
    const maxCatalogParts = 7 + Math.round(7 * difficulty);
    const fits = catalog.filter((c) => c && Array.isArray(c.recipe) && c.recipe.length >= 2
      && c.recipe.every((r) => hexOf.has(r.pigment) && Number.isInteger(r.weight) && r.weight >= 1)
      && c.recipe.some((r) => !isDrop(r.pigment))
      && c.recipe.reduce((s, r) => s + r.weight, 0) <= maxCatalogParts);
    const picked = choose(fits.map((c) => finish(
      c.recipe.map((r) => ({ pigment: r.pigment, hex: hexOf.get(r.pigment), weight: r.weight })),
      { colorId: c.id, known: !!c.discovered },
    )));
    if (picked) return clean(picked);
  }

  const sampling = {
    includeDrops,
    maxPigments: Math.max(1, Math.floor(maxParts)),
    topWeight: 2 + Math.round(2 * difficulty), // 2 at easy, 4 at hard
  };
  for (let round = 0; round < TARGET_RULES.rounds; round++) {
    const list = [];
    for (let k = 0; k < TARGET_RULES.candidates; k++) list.push(sampleRecipe(rng, usable, sampling));
    const picked = choose(list);
    if (picked) return clean(picked);
  }
  pool.sort((a, b) => a.miss - b.miss || b.appeal - a.appeal);
  return clean(pool[0].c);
}

// Internal: drop scoring-only fields.
function clean(order) {
  const { known, ...rest } = order;
  return rest;
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
  const avoid = Array.isArray(opts && opts.avoidHexes) ? opts.avoidHexes : [];
  for (let k = 0; k < n * 4 && orders.length < n; k++) {
    const o = createOrder({ ...opts, avoidHexes: [...avoid, ...orders.map((p) => p.target)] }, rng);
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
