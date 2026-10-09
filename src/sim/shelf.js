// shelf.js — the Merge Shelf (pure).
// Implements docs/DESIGN.md "The Merge Shelf" as reworked by docs/PLAN-v0.2.md
// Theme B and docs/V02-CONTRACTS.md "Line rule": a fixed 6×6 grid (no
// expansion) where two containers of the same color and size merge into the
// next size up (Vial 1×, Jar 2.5×, Bottle 6×, Urn 15×, Cask 40× + Essence).
// Merging never changes a color. Vials spill over from production (one per 3
// minutes, worth ~5 s of that color's output) in one of the ≤ 5 colors she
// picked (`shelf.colors`), pausing while fewer than 6 cells are empty so a line
// can always be built. Golden vials (1 in 40) appear once she has made her
// first Bottle.
//
// Lines: a full row, column or main diagonal of six containers of one hue
// family (golden counts as any) resolves after every merge or move: the six
// combine into the highest tier their summed vial-value allows, that container
// sells at once at value × 1.5 (× 2 more when two or more lines resolve in the
// same check: a "double line"), the cells clear, and a Cask grants Essence to
// the family's most-stocked color.
//
// Cell: null | {color, tier:1..5, golden, boost, unit}
//   unit  = jars a single vial of this container stands for (value basis)
//   boost = value multiplier (golden merges double it)

import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { stateRng } from '../rng.js';
import { deltaEHex } from '../color.js';
import { colorPrice, colorDef, colorFamily, incomeMultiplier, rates, discoveredCount, ESSENCE_MAX } from './economy.js';
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
/** The grid is the grid: 6 × 6, no expansion purchases. */
export const COLS = 6;
export const ROWS = 6;
/** Containers in a line. */
export const LINE_LENGTH = 6;
/** A resolved line sells at value × LINE_BONUS ("full shelf" bonus)... */
export const LINE_BONUS = 1.5;
/** ...and × DOUBLE_BONUS more when two or more lines resolve in one check. */
export const DOUBLE_BONUS = 2;
export const LINE_FLOOR = 1.2; // a line always beats selling its containers separately
/** At most this many color chips: spillover never delivers a sixth color. */
export const MAX_COLORS = 5;
/** Spillover rests while fewer than this many cells are empty. */
export const MIN_EMPTY = 6;
/** The shelf's price shows at 8 colors (src/sim/unlocks.js); it opens when bought. */
export const UNLOCK_COLORS = 8;
/** Before the shelf is bought, spillover piles vials behind its glass from this many colors... */
export const WAITING_FROM_COLORS = 6;
/** ...up to this many (they become real vials when the shelf is bought). */
export const WAITING_MAX = 12;
export const SPILLOVER_MS = 3 * 60e3; // was 10 min; playtest 3: "filling too slowly"
export const SPILLOVER_SECONDS = 5; // 15 s at one vial per 10 min; 5 s at one per 3 min keeps shelf income per hour the same
/** Before the shelf is bought, vials pile behind the glass at the old, slower pace (a teaser, capped at WAITING_MAX). */
export const WAITING_MS = 10 * 60e3;
export const GOLDEN_CHANCE = 1 / 40;
/** Golden vials only spill over once a container of this tier has been made (stats.firstBottleAt). */
export const GOLDEN_FROM_TIER = 3;

export { ESSENCE_MAX };

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function shelfOf(state) {
  if (!state.shelf || typeof state.shelf !== 'object') {
    state.shelf = { cols: COLS, rows: ROWS, cells: new Array(COLS * ROWS).fill(null), colors: [], waiting: 0, nextSpilloverAt: 0, pausedRemainingMs: 0 };
  }
  const s = state.shelf;
  if (!(s.cols > 0)) s.cols = COLS;
  if (!(s.rows > 0)) s.rows = ROWS;
  const n = s.cols * s.rows;
  if (!Array.isArray(s.cells)) s.cells = [];
  while (s.cells.length < n) s.cells.push(null);
  if (!Array.isArray(s.colors)) s.colors = [];
  return s;
}

function statsOf(state) {
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  return state.stats;
}

/** The Merge Shelf is a coin-bought unlock: open once bought (state.unlocks.shelf). */
export function unlocked(state) {
  return !!state?.unlocks?.shelf;
}

export function tierValue(tier) {
  return TIER_VALUES[Math.max(1, Math.min(MAX_TIER, tier | 0)) - 1] ?? 1;
}

/** Highest tier whose TIER_VALUES entry `sum` (vial-value) reaches; 1 below a Jar. */
export function tierForValue(sum) {
  let t = 1;
  for (let k = 0; k < TIER_VALUES.length; k++) if (num(sum) >= TIER_VALUES[k] - 1e-9) t = k + 1;
  return t;
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

function markMade(state, tier, now) {
  if (tier < GOLDEN_FROM_TIER) return;
  const st = statsOf(state);
  if (!(num(st.firstBottleAt) > 0)) st.firstBottleAt = num(now) > 0 ? now : 1;
}

/** True once a Bottle (or bigger) has ever been made: golden vials may spill over. */
export function goldenAllowed(state) {
  return num(state?.stats?.firstBottleAt) > 0;
}

/**
 * addVial(state, {colorId, tier=1, golden=false, unit?, cell?}) -> cell index
 * or null (full). Lands in `cell` when that is empty, else the first empty cell
 * in reading order.
 */
export function addVial(state, args = {}) {
  const { colorId, tier = 1, golden = false } = args;
  if (!colorId) return null;
  const s = shelfOf(state);
  const want = Number.isInteger(args.cell) && args.cell >= 0 && args.cell < s.cells.length && !s.cells[args.cell] ? args.cell : null;
  const idx = want ?? emptyCells(s)[0];
  if (idx === undefined) return null;
  s.cells[idx] = {
    color: colorId,
    tier: Math.max(1, Math.min(MAX_TIER, tier | 0)),
    golden: !!golden,
    boost: 1,
    unit: num(args.unit) > 0 ? args.unit : defaultUnit(state, colorId),
  };
  return idx;
}

// ---------------------------------------------------------------------------
// Color chips
// ---------------------------------------------------------------------------

function stockJars(state, colorId) {
  return num(state?.stock?.[colorId]?.jars);
}

/**
 * defaultShelfColors(state) -> [colorId] (≤ 5): the mixers' recipes, then the
 * most-stocked discovered colors, preferring five different hue families (a
 * second color of a family only when no new family is left).
 */
export function defaultShelfColors(state) {
  const discovered = state?.catalog?.discovered ?? {};
  const ids = Object.keys(discovered);
  const recipes = [];
  for (const m of state?.stations?.mixers ?? []) {
    if (m && m.recipe && discovered[m.recipe] && !recipes.includes(m.recipe)) recipes.push(m.recipe);
  }
  const stocked = ids.filter((id) => !recipes.includes(id))
    .map((id, i) => ({ id, jars: stockJars(state, id), i }))
    .sort((a, b) => b.jars - a.jars || a.i - b.i)
    .map((x) => x.id);
  const candidates = [...recipes, ...stocked];
  const out = [];
  const families = new Set();
  for (const id of candidates) {
    if (out.length >= MAX_COLORS) break;
    const fam = colorFamily(id);
    if (families.has(fam)) continue;
    families.add(fam);
    out.push(id);
  }
  for (const id of candidates) {
    if (out.length >= MAX_COLORS) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The colors spillover delivers now: her chips (discovered ones), else the defaults. */
export function shelfColors(state) {
  const s = shelfOf(state);
  const discovered = state?.catalog?.discovered ?? {};
  const mine = [...new Set(s.colors.filter((id) => typeof id === 'string' && discovered[id]))].slice(0, MAX_COLORS);
  return mine.length ? mine : defaultShelfColors(state);
}

/**
 * chipFor(state, colorId) -> colorId|null. Bonus vials (a Perfect order, an
 * event, a hunter's haul) land in one of her chip colors so the shelf only
 * ever holds what the chips show: the color itself if it is a chip, else the
 * chip of the same hue family, else the nearest chip.
 */
export function chipFor(state, colorId) {
  const chips = shelfColors(state);
  if (!chips.length) return null;
  if (chips.includes(colorId)) return colorId;
  const fam = colorFamily(colorId);
  const same = chips.find((id) => colorFamily(id) === fam);
  if (same) return same;
  const hex = colorDef(colorId)?.hex;
  if (!hex) return chips[0];
  let best = chips[0];
  let bestD = Infinity;
  for (const id of chips) {
    const h = colorDef(id)?.hex;
    const d = h ? deltaEHex(hex, h) : Infinity;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/**
 * setShelfColors(state, {colors}) -> {ok, colors}. Keeps up to five distinct
 * discovered ids, in order; containers already on the shelf stay. An empty
 * list means "use the defaults".
 */
export function setShelfColors(state, args = {}) {
  const s = shelfOf(state);
  if (!Array.isArray(args.colors)) return { ok: false, reason: 'colors' };
  const discovered = state?.catalog?.discovered ?? {};
  const colors = [...new Set(args.colors.filter((id) => typeof id === 'string' && discovered[id]))].slice(0, MAX_COLORS);
  s.colors = colors;
  return { ok: true, colors: [...colors] };
}

// ---------------------------------------------------------------------------
// Spillover
// ---------------------------------------------------------------------------

/** True while spillover rests because fewer than MIN_EMPTY cells are empty. */
export function spilloverPaused(state) {
  const s = shelfOf(state);
  return emptyCells(s).length < MIN_EMPTY;
}

/**
 * tickSpillover(state, now) -> {added, waiting}. One vial per 3 minutes of
 * production in one of shelfColors(state) (her chips, else the defaults);
 * accumulates while away; rests while fewer than MIN_EMPTY cells are empty
 * (nothing lost from the factory). Before the shelf is bought (from
 * WAITING_FROM_COLORS colors) the same timer piles vials behind the glass
 * instead: `shelf.waiting` counts up to WAITING_MAX, and unlocks.buy('shelf')
 * turns them into vials.
 */
export function tickSpillover(state, now = 0) {
  const s = shelfOf(state);
  const open = unlocked(state);
  if (!Number.isFinite(s.waiting)) s.waiting = 0;
  if (!open && discoveredCount(state) < WAITING_FROM_COLORS) { s.nextSpilloverAt = 0; return { added: 0, waiting: 0 }; }
  const r = rates(state);
  const active = Object.entries(r.byColor).filter(([, j]) => j > 0);
  if (!active.length) {
    // Nothing is producing: pause the timer, keeping the time left, so it
    // neither resets to a fresh timer every tick nor fires while idle.
    if (s.nextSpilloverAt > 0) s.pausedRemainingMs = Math.max(0, s.nextSpilloverAt - now);
    s.nextSpilloverAt = 0;
    return { added: 0, waiting: 0 };
  }
  if (!(s.nextSpilloverAt > 0)) {
    const remaining = s.pausedRemainingMs > 0 ? s.pausedRemainingMs : (open ? SPILLOVER_MS : WAITING_MS);
    s.pausedRemainingMs = 0;
    s.nextSpilloverAt = now + remaining;
    return { added: 0, waiting: 0 };
  }
  if (!open) {
    let waiting = 0;
    while (s.nextSpilloverAt <= now && s.waiting < WAITING_MAX) {
      s.waiting++;
      waiting++;
      s.nextSpilloverAt += WAITING_MS;
    }
    if (s.nextSpilloverAt <= now) s.nextSpilloverAt = now + WAITING_MS; // the pile is full: wait, nothing lost
    if (waiting) emit(state, 'shelfWaiting', { waiting: s.waiting });
    return { added: 0, waiting };
  }
  const colors = shelfColors(state);
  const rng = stateRng(state);
  const golden0 = goldenAllowed(state);
  let added = 0;
  while (colors.length && s.nextSpilloverAt <= now && added < s.cells.length) {
    if (emptyCells(s).length < MIN_EMPTY) break; // resting: room for a line
    const color = colors[Math.min(colors.length - 1, Math.floor(rng() * colors.length))];
    const golden = golden0 && rng() < GOLDEN_CHANCE;
    const jps = num(r.byColor[color]);
    addVial(state, { colorId: color, golden, unit: jps > 0 ? Math.max(1, jps * SPILLOVER_SECONDS) : defaultUnit(state, color) });
    if (golden) emit(state, 'golden', { colorId: color });
    added++;
    s.nextSpilloverAt += SPILLOVER_MS;
  }
  if (s.nextSpilloverAt <= now) s.nextSpilloverAt = now + SPILLOVER_MS; // resting: wait, nothing lost
  return { added, waiting: 0 };
}

/**
 * openWaiting(state) -> {added}: the vials piled behind the glass land on the
 * newly bought shelf, round-robin over the mixers' colors (the madder / ochre /
 * woad primaries if no mixer is set). Called by unlocks.buy('shelf').
 */
export function openWaiting(state) {
  const s = shelfOf(state);
  const n = Math.max(0, Math.min(WAITING_MAX, Math.floor(num(s.waiting))));
  s.waiting = 0;
  let colors = [...new Set((state.stations?.mixers ?? []).map((m) => m && m.recipe).filter(Boolean))];
  if (!colors.length) colors = ['madder', 'ochre', 'woad'].filter((id) => state.catalog?.discovered?.[id]);
  if (!s.colors.length) s.colors = colors.slice(0, MAX_COLORS);
  if (!colors.length) return { added: 0 };
  let added = 0;
  for (let k = 0; k < n; k++) {
    if (addVial(state, { colorId: colors[k % colors.length] }) === null) break;
    added++;
  }
  return { added };
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

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

function grantEssence(state, colorId) {
  const d = state?.catalog?.discovered?.[colorId];
  if (!d || num(d.essence) >= ESSENCE_MAX) return null;
  d.essence = num(d.essence) + 1;
  emit(state, 'essence', { colorId, essence: d.essence });
  return { colorId, essence: d.essence };
}

function caskToEssence(state, s, cell) {
  const c = s.cells[cell];
  if (!c || c.tier < MAX_TIER) return null;
  const got = grantEssence(state, c.color); // at max, the Cask stays (sellable)
  if (got) s.cells[cell] = null;
  return got;
}

/**
 * merge(state, {from, to}, now) -> {ok, steps:[{tier, colorId, cell}], essence?, lines}.
 * The dragged container (from) merges into `to`; then, greedily, any orthogonal
 * neighbor of the result with the same color and tier merges in too (a chain).
 * Forming a Cask grants +1 Essence for that color and consumes the Cask. When
 * the chain has finished, resolveLines runs: `lines` is its result (null when
 * no line completed).
 */
export function merge(state, args = {}, now = 0) {
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
  markMade(state, steps[steps.length - 1].tier, now);
  if (steps.length > 1) emit(state, 'chain', { steps });
  const essence = caskToEssence(state, s, to);
  const lines = resolveLines(state, now);
  return essence ? { ok: true, steps, essence, lines } : { ok: true, steps, lines };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Every candidate line of the grid: rows, then columns, then the two main diagonals. */
function lineSlots(s) {
  const out = [];
  if (s.cols === LINE_LENGTH) {
    for (let r = 0; r < s.rows; r++) out.push({ kind: 'row', index: r, cells: Array.from({ length: s.cols }, (_, c) => r * s.cols + c) });
  }
  if (s.rows === LINE_LENGTH) {
    for (let c = 0; c < s.cols; c++) out.push({ kind: 'col', index: c, cells: Array.from({ length: s.rows }, (_, r) => r * s.cols + c) });
  }
  if (s.cols === LINE_LENGTH && s.rows === LINE_LENGTH) {
    out.push({ kind: 'diag', index: 0, cells: Array.from({ length: LINE_LENGTH }, (_, k) => k * s.cols + k) });
    out.push({ kind: 'diag', index: 1, cells: Array.from({ length: LINE_LENGTH }, (_, k) => k * s.cols + (s.cols - 1 - k)) });
  }
  return out;
}

/**
 * findLines(state) -> [{kind:'row'|'col'|'diag', index, cells:[6 idx], family}]
 * Full lines of six containers of one hue family (colorFamily, i.e. hueFamily
 * of the color's hex; a golden container counts as any family). Order: rows
 * top to bottom, columns left to right, then the diagonal from the top-left
 * (index 0) and from the top-right (index 1).
 */
export function findLines(state) {
  const s = shelfOf(state);
  const out = [];
  for (const slot of lineSlots(s)) {
    const items = slot.cells.map((i) => s.cells[i]);
    if (items.some((x) => !x)) continue;
    const fams = new Set(items.filter((x) => !x.golden).map((x) => colorFamily(x.color)));
    if (fams.size > 1) continue;
    const family = fams.size ? [...fams][0] : colorFamily(items[0].color);
    out.push({ kind: slot.kind, index: slot.index, cells: slot.cells, family });
  }
  return out;
}

/** The family's most-stocked discovered color still below max Essence (null if none). */
function essenceTarget(state, family) {
  let best = null;
  let bestJars = -1;
  for (const [id, d] of Object.entries(state?.catalog?.discovered ?? {})) {
    if (!d || num(d.essence) >= ESSENCE_MAX || colorFamily(id) !== family) continue;
    const jars = stockJars(state, id);
    if (jars > bestJars) { best = id; bestJars = jars; }
  }
  return best;
}

/**
 * resolveLines(state, now) -> null when no line is complete, else
 *   {lines, tier, value, coins, double, cells, essence}
 * Every line found in one check resolves together. Per line: sum = Σ tier value
 * × boost of its six containers (a shared cell counts for both lines); its tier
 * is the highest TIER_VALUES entry the sum reaches; it sells at
 * TIER_VALUES[tier] × (mean unit × color price of the six) × LINE_BONUS
 * (× DOUBLE_BONUS when two or more lines resolve) × incomeMultiplier.
 * `lines[k]` = {kind, index, cells, family, sum, tier, value, coins}; top-level
 * `tier` is the highest line tier, `value`/`coins` the totals before/after the
 * income multiplier, `cells` the cleared cells (sorted, unique), `essence` the
 * [{colorId, essence}] granted by Cask lines. Coins are credited, cells
 * cleared, stats.lines += 1 (one per resolved check, double or not) and
 * 'lines' {lines, tier, coins, double, cells} is emitted.
 */
export function resolveLines(state, now = 0) {
  const s = shelfOf(state);
  const found = findLines(state);
  if (!found.length) return null;
  const double = found.length >= 2;
  const mult = LINE_BONUS * (double ? DOUBLE_BONUS : 1);
  const inc = incomeMultiplier(state, now);
  const lines = [];
  const essence = [];
  let value = 0;
  let coins = 0;
  let tier = 0;
  for (const line of found) {
    const items = line.cells.map((i) => s.cells[i]);
    const sum = items.reduce((a, x) => a + tierValue(x.tier) * num(x.boost, 1), 0);
    const t = tierForValue(sum);
    const base = items.reduce((a, x) => a + num(x.unit, 1) * colorPrice(state, x.color), 0) / items.length;
    // "Merging up always pays": a line is never worth less than selling its
    // six containers one by one, plus 20%. Six Bottles would otherwise make an
    // Urn worth 22.5 against 36 sold separately.
    const separately = items.reduce((a, x) => a + tierValue(x.tier) * num(x.boost, 1) * num(x.unit, 1) * colorPrice(state, x.color), 0);
    const v = Math.max(num(TIER_VALUES[t - 1] * base * mult), separately * LINE_FLOOR);
    const c = num(v * inc);
    lines.push({ ...line, cells: [...line.cells], sum, tier: t, value: v, coins: c });
    value += v;
    coins += c;
    tier = Math.max(tier, t);
  }
  const cells = [...new Set(found.flatMap((l) => l.cells))].sort((a, b) => a - b);
  for (const i of cells) s.cells[i] = null;
  for (const line of lines) {
    if (line.tier < MAX_TIER) continue;
    const id = essenceTarget(state, line.family);
    const got = id ? grantEssence(state, id) : null;
    if (got) essence.push(got);
  }
  markMade(state, tier, now);
  state.coins = num(state.coins) + coins;
  state.runEarned = num(state.runEarned) + coins;
  if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
  const st = statsOf(state);
  st.lines = num(st.lines) + 1;
  emit(state, 'lines', { lines, tier, coins, double, cells });
  return { lines, tier, value, coins, double, cells, essence };
}

/** skipLine(state) -> {ok, lineSkips}: she tapped through a line sequence (local feel counter). */
export function skipLine(state) {
  const st = statsOf(state);
  st.lineSkips = num(st.lineSkips) + 1;
  return { ok: true, lineSkips: st.lineSkips };
}

// ---------------------------------------------------------------------------
// Selling and moving
// ---------------------------------------------------------------------------

/** Coins a container would sell for right now (before it is sold). */
export function containerValue(state, cellIndex, now) {
  const s = shelfOf(state);
  const x = s.cells[cellIndex];
  if (!x) return 0;
  const v = num(x.unit, 1) * colorPrice(state, x.color) * tierValue(x.tier) * num(x.boost, 1) * incomeMultiplier(state, now);
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

/**
 * move(state, {from, to}, now) -> {ok, swapped, lines}: into an empty cell, or
 * swap two containers; then resolveLines (`lines` is its result or null).
 */
export function move(state, args = {}, now = 0) {
  const s = shelfOf(state);
  const from = args.from | 0;
  const to = args.to | 0;
  const n = s.cells.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n || !s.cells[from]) return { ok: false };
  const tmp = s.cells[to];
  s.cells[to] = s.cells[from];
  s.cells[from] = tmp;
  const lines = resolveLines(state, now);
  return { ok: true, swapped: !!tmp, lines };
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
