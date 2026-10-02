// rng.js — seeded PRNG and helpers (pure). Owns all randomness primitives.
// Implements ARCHITECTURE.md "Rules for every module": sim code never calls
// Math.random(); it passes an `rng` function ([0,1)) or uses nextRandom(state),
// which advances the 32-bit integer `state.seed` so saves stay deterministic.

/** mulberry32(seed) -> () => float in [0,1). Closure-based; seed is any int. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * nextRandom(state) -> float in [0,1). Same sequence as mulberry32(state.seed)
 * but stores the advanced 32-bit seed back in state.seed (no closures in state).
 */
export function nextRandom(state) {
  const a = ((state.seed >>> 0) + 0x6d2b79f5) >>> 0;
  state.seed = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Adapter: an rng function that draws from (and advances) state.seed. */
export function stateRng(state) {
  return () => nextRandom(state);
}

/** pick(rng, array) -> a random element (undefined for an empty array). */
export function pick(rng, array) {
  if (!array || array.length === 0) return undefined;
  return array[Math.min(array.length - 1, Math.floor(rng() * array.length))];
}

/**
 * weightedPick(rng, items, weightFn) -> item. Items with weight <= 0 (or
 * non-finite) are never chosen. Returns undefined if no item has weight.
 */
export function weightedPick(rng, items, weightFn = () => 1) {
  let total = 0;
  const weights = items.map((it, i) => {
    const w = Number(weightFn(it, i));
    const ok = Number.isFinite(w) && w > 0 ? w : 0;
    total += ok;
    return ok;
  });
  if (total <= 0) return undefined;
  let r = rng() * total;
  let last = -1;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    if (r < weights[i]) return items[i];
    r -= weights[i];
  }
  return items[last]; // float rounding fallback: last positive-weight item
}

/** shuffle(rng, array) -> new array (Fisher-Yates); input is not mutated. */
export function shuffle(rng, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** randInt(rng, lo, hiInclusive) -> integer in [lo, hiInclusive]. */
export function randInt(rng, lo, hiInclusive) {
  return lo + Math.floor(rng() * (hiInclusive - lo + 1));
}

/** chance(rng, p) -> true with probability p. */
export function chance(rng, p) {
  return rng() < p;
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** uuid(rng) -> short 8-char base36 id (not a real UUID). */
export function uuid(rng) {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rng() * 36)];
  return s;
}
