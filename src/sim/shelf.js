// shelf.js — the Merge Shelf (pure).
// Implements docs/DESIGN.md "The Merge Shelf": a 5×7 grid (6×9 expanded) where
// two containers of the same color and size merge into the next size up
// (Vial 1×, Jar 2.5×, Bottle 6×, Urn 15×, Cask 40× + Essence). Merging never
// changes a color. Vials spill over from production (one per 10 minutes, worth
// ~15 s of that color's output, 1 in 40 golden), stop when the shelf is full and
// never affect the factory. Chain merges, golden wildcards, tidy-row bonus.
//
// Cell: null | {color, tier:1..5, golden, boost, unit}
//   unit  = jars a single vial of this container stands for (value basis)
//   boost = value multiplier (golden merges double it)

import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { stateRng } from '../rng.js';
import { colorPrice, colorFamily, incomeMultiplier, rates, discoveredCount, ESSENCE_MAX } from './economy.js';
import { STATION_KINDS } from '../content/stations.js';

export const TIERS = Object.freeze([
  Object.freeze({ tier: 1, id: 'vial', name: 'Vial', value: 1 }),
  Object.freeze({ tier: 2, id: 'jar', name: 'Jar', value: 2.5 }),
  Object.freeze({ tier: 3, id: 'bottle', name: 'Bottle', value: 6 }),
  Object.freeze({ tier: 4, id: 'urn', name: 'Urn', value: 15 }),
  Object.freeze({ tier: 5, id: 'cask', name: 'Cask', value: 40 }),
]);
export const TIER_VALUES = Object.freeze(TIERS.map((t) => t.value));
export const MAX_TIER = 5;
export const UNLOCK_COLORS = 5;
export const SPILLOVER_MS = 10 * 60e3;
export const SPILLOVER_SECONDS = 15;
export const GOLDEN_CHANCE = 1 / 40;
export const TIDY_BONUS = 0.1;
export const EXPANDED = Object.freeze({ cols: 6, rows: 9 });
export const EXPAND_COST = 50000;

export { ESSENCE_MAX };

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function shelfOf(state) {
  if (!state.shelf) state.shelf = { cols: 5, rows: 7, cells: new Array(35).fill(null), rowLabels: new Array(7).fill(null), nextSpilloverAt: 0 };
  const s = state.shelf;
  const n = s.cols * s.rows;
  if (!Array.isArray(s.cells)) s.cells = [];
  while (s.cells.length < n) s.cells.push(null);
  if (!Array.isArray(s.rowLabels)) s.rowLabels = [];
  while (s.rowLabels.length < s.rows) s.rowLabels.push(null);
  return s;
}

/** The shelf opens at 5 catalog colors. */
export function unlocked(state) {
  return discoveredCount(state) >= UNLOCK_COLORS;
}

export function tierValue(tier) {
  return TIER_VALUES[Math.max(1, Math.min(MAX_TIER, tier | 0)) - 1] ?? 1;
}

function defaultUnit(state, colorId) {
  const rate = num(rates(state).byColor[colorId]);
  const r = rate > 0 ? rate : STATION_KINDS.mixer.baseOutput;
  return Math.max(1, r * SPILLOVER_SECONDS);
}

function emptyCells(s) {
  const out = [];
  s.cells.forEach((c, i) => { if (!c) out.push(i); });
  return out;
}

/**
 * addVial(state, {colorId, tier=1, golden=false, unit?}) -> cell index or null
 * (full). Prefers an empty cell in a row labeled with the color's family.
 */
export function addVial(state, args = {}) {
  const { colorId, tier = 1, golden = false } = args;
  if (!colorId) return null;
  const s = shelfOf(state);
  const empty = emptyCells(s);
  if (!empty.length) return null;
  const fam = colorFamily(colorId);
  const labeled = empty.find((i) => s.rowLabels[Math.floor(i / s.cols)] === fam);
  const unlabeled = empty.find((i) => !s.rowLabels[Math.floor(i / s.cols)]);
  const idx = labeled ?? unlabeled ?? empty[0];
  s.cells[idx] = {
    color: colorId,
    tier: Math.max(1, Math.min(MAX_TIER, tier | 0)),
    golden: !!golden,
    boost: 1,
    unit: num(args.unit) > 0 ? args.unit : defaultUnit(state, colorId),
  };
  return idx;
}

/**
 * tickSpillover(state, now) -> {added}. One vial per 10 minutes of production in
 * a random active (assigned) color; accumulates while away; stops when full.
 */
export function tickSpillover(state, now = 0) {
  const s = shelfOf(state);
  if (!unlocked(state)) { s.nextSpilloverAt = 0; return { added: 0 }; }
  const r = rates(state);
  const active = Object.entries(r.byColor).filter(([, j]) => j > 0);
  if (!active.length) {
    // Nothing is producing: pause the timer, keeping the time left, so it
    // neither resets to a fresh 10 minutes every tick nor fires while idle.
    if (s.nextSpilloverAt > 0) s.pausedRemainingMs = Math.max(0, s.nextSpilloverAt - now);
    s.nextSpilloverAt = 0;
    return { added: 0 };
  }
  if (!(s.nextSpilloverAt > 0)) {
    const remaining = s.pausedRemainingMs > 0 ? s.pausedRemainingMs : SPILLOVER_MS;
    s.pausedRemainingMs = 0;
    s.nextSpilloverAt = now + remaining;
    return { added: 0 };
  }
  const rng = stateRng(state);
  let added = 0;
  while (s.nextSpilloverAt <= now && added < s.cells.length) {
    if (!emptyCells(s).length) break;
    const [color, jps] = active[Math.min(active.length - 1, Math.floor(rng() * active.length))];
    const golden = rng() < GOLDEN_CHANCE;
    addVial(state, { colorId: color, golden, unit: Math.max(1, jps * SPILLOVER_SECONDS) });
    if (golden) emit(state, 'golden', { colorId: color });
    added++;
    s.nextSpilloverAt += SPILLOVER_MS;
  }
  if (s.nextSpilloverAt <= now) s.nextSpilloverAt = now + SPILLOVER_MS; // full: wait, nothing lost
  return { added };
}

/** Same tier (below Cask) and same color, or either is a golden wildcard. */
export function canMerge(a, b) {
  if (!a || !b) return false;
  if (a.tier !== b.tier || a.tier >= MAX_TIER) return false;
  return !!(a.golden || b.golden || a.color === b.color);
}

function neighbors(s, i) {
  const r = Math.floor(i / s.cols);
  const c = i % s.cols;
  const out = [];
  if (r > 0) out.push(i - s.cols);
  if (r < s.rows - 1) out.push(i + s.cols);
  if (c > 0) out.push(i - 1);
  if (c < s.cols - 1) out.push(i + 1);
  return out;
}

function combine(a, b) {
  // b is the drop target; golden keeps the other's color and doubles the boost.
  const unit = (num(a.unit, 1) + num(b.unit, 1)) / 2;
  if (a.golden && b.golden) return { color: b.color, tier: b.tier + 1, golden: true, boost: Math.max(num(a.boost, 1), num(b.boost, 1)) * 2, unit };
  if (a.golden || b.golden) {
    const other = a.golden ? b : a;
    return { color: other.color, tier: other.tier + 1, golden: false, boost: num(other.boost, 1) * 2, unit };
  }
  return { color: b.color, tier: b.tier + 1, golden: false, boost: Math.max(num(a.boost, 1), num(b.boost, 1)), unit };
}

function caskToEssence(state, s, cell) {
  const c = s.cells[cell];
  if (!c || c.tier < MAX_TIER) return null;
  const d = state?.catalog?.discovered?.[c.color];
  if (!d || num(d.essence) >= ESSENCE_MAX) return null; // at max, the Cask stays (sellable)
  d.essence = num(d.essence) + 1;
  s.cells[cell] = null;
  emit(state, 'essence', { colorId: c.color, essence: d.essence });
  return { colorId: c.color, essence: d.essence };
}

/**
 * merge(state, {from, to}) -> {ok, steps:[{tier, colorId, cell}], essence?}.
 * The dragged container (from) merges into `to`; then, greedily, any orthogonal
 * neighbor of the result with the same color and tier merges in too (a chain).
 * Forming a Cask grants +1 Essence for that color and consumes the Cask.
 */
export function merge(state, args = {}) {
  const s = shelfOf(state);
  const from = args.from | 0;
  const to = args.to | 0;
  if (from === to) return { ok: false, steps: [] };
  const a = s.cells[from];
  const b = s.cells[to];
  if (!canMerge(a, b)) return { ok: false, steps: [] };
  const steps = [];
  s.cells[from] = null;
  s.cells[to] = combine(a, b);
  steps.push({ tier: s.cells[to].tier, colorId: s.cells[to].color, cell: to });
  questEvent(state, 'merged', 1, { tier: s.cells[to].tier, colorId: s.cells[to].color });
  for (let guard = 0; guard < MAX_TIER; guard++) {
    const cur = s.cells[to];
    if (!cur || cur.tier >= MAX_TIER) break;
    const n = neighbors(s, to).find((i) => {
      const x = s.cells[i];
      return x && !x.golden && !cur.golden && x.color === cur.color && x.tier === cur.tier;
    });
    if (n === undefined) break;
    s.cells[to] = combine(s.cells[n], cur);
    s.cells[n] = null;
    steps.push({ tier: s.cells[to].tier, colorId: s.cells[to].color, cell: to });
    questEvent(state, 'merged', 1, { tier: s.cells[to].tier, colorId: s.cells[to].color, chain: true });
  }
  if (steps.length > 1) emit(state, 'chain', { steps });
  const essence = caskToEssence(state, s, to);
  return essence ? { ok: true, steps, essence } : { ok: true, steps };
}

/** Rows whose label matches every container in them: boolean per row. */
export function tidyRows(state) {
  const s = shelfOf(state);
  const out = [];
  for (let r = 0; r < s.rows; r++) {
    const label = s.rowLabels[r];
    if (!label) { out.push(false); continue; }
    let any = false;
    let ok = true;
    for (let c = 0; c < s.cols; c++) {
      const x = s.cells[r * s.cols + c];
      if (!x) continue;
      any = true;
      if (colorFamily(x.color) !== label) { ok = false; break; }
    }
    out.push(any && ok);
  }
  return out;
}

/** Coins a container would sell for right now (before it is sold). */
export function containerValue(state, cellIndex, now) {
  const s = shelfOf(state);
  const x = s.cells[cellIndex];
  if (!x) return 0;
  const tidy = tidyRows(state)[Math.floor(cellIndex / s.cols)] ? 1 + TIDY_BONUS : 1;
  const v = num(x.unit, 1) * colorPrice(state, x.color) * tierValue(x.tier) * num(x.boost, 1) * tidy * incomeMultiplier(state, now);
  return num(v);
}

/** sell(state, {cell}, now) -> {ok, coins}. */
export function sell(state, args = {}, now = 0) {
  const s = shelfOf(state);
  const i = typeof args === 'number' ? args : args.cell;
  if (!s.cells[i]) return { ok: false, coins: 0 };
  const coins = containerValue(state, i, now);
  s.cells[i] = null;
  state.coins = num(state.coins) + coins;
  state.runEarned = num(state.runEarned) + coins;
  if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
  return { ok: true, coins };
}

/** Remove a container (e.g. delivered to an order or commission) -> the container or null. */
export function takeContainer(state, args = {}) {
  const s = shelfOf(state);
  const i = typeof args === 'number' ? args : args.cell;
  const x = s.cells[i];
  if (!x) return null;
  s.cells[i] = null;
  return x;
}

export function setRowLabel(state, args = {}) {
  const s = shelfOf(state);
  const row = args.row | 0;
  if (row < 0 || row >= s.rows) return { ok: false };
  s.rowLabels[row] = args.family || null;
  return { ok: true };
}

/** move(state, {from, to}): into an empty cell, or swap two containers. */
export function move(state, args = {}) {
  const s = shelfOf(state);
  const from = args.from | 0;
  const to = args.to | 0;
  const n = s.cells.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n || !s.cells[from]) return { ok: false };
  const tmp = s.cells[to];
  s.cells[to] = s.cells[from];
  s.cells[from] = tmp;
  return { ok: true, swapped: !!tmp };
}

/** Cell indices that have a mergeable partner somewhere on the shelf. */
export function hints(state) {
  const s = shelfOf(state);
  const out = [];
  for (let i = 0; i < s.cells.length; i++) {
    if (!s.cells[i]) continue;
    for (let j = 0; j < s.cells.length; j++) {
      if (i !== j && canMerge(s.cells[i], s.cells[j])) { out.push(i); break; }
    }
  }
  return out;
}

/** Grow the shelf to 6×9 (keeps every container in its row/column). */
export function expand(state, args = {}, now = 0) {
  const s = shelfOf(state);
  if (s.cols >= EXPANDED.cols && s.rows >= EXPANDED.rows) return { ok: false, reason: 'max' };
  const cost = num(args.cost, EXPAND_COST);
  if (num(state.coins) < cost) return { ok: false, reason: 'coins', cost };
  state.coins -= cost;
  const cells = new Array(EXPANDED.cols * EXPANDED.rows).fill(null);
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) cells[r * EXPANDED.cols + c] = s.cells[r * s.cols + c] ?? null;
  }
  s.cells = cells;
  s.cols = EXPANDED.cols;
  s.rows = EXPANDED.rows;
  while (s.rowLabels.length < s.rows) s.rowLabels.push(null);
  return { ok: true, cost };
}
