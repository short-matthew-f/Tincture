// purify.js — tube sort for muddy batches (pure, JSON-serializable state).
// Implements docs/DESIGN.md "Active play › Purifying (tube sort)", ARCHITECTURE.md
// "Puzzles" and docs/V02-CONTRACTS.md "Purify": the size comes from the
// difficulty tier she picks (Relaxed 4 colors / 6 tubes with a free extra tube,
// Steady 6 / 8, Tricky 8 / 10, Master 9 / 11); unlimited undo. Solved means
// every non-empty tube is one color AND full (corked).
//
// Tubes are arrays of color indices, bottom -> top. A forward pour moves the
// whole contiguous top run of the source as far as the target has room, onto
// an empty tube or a matching top color.
//
// Boards (0.3.3): a few random deals are solved by solve() and rated by the
// solution length; create() keeps one inside the tier's band, so every tier
// feels the same from board to board and no board ships unverified. When the
// node budget runs out it falls back to the reverse-pour scramble below.
//
// Reverse-pour scramble (solvable by construction): each reverse pour takes k
// units of color c off tube A and stacks them on tube B, and is only allowed
// when the matching forward pour B -> A is legal afterwards (A is empty or
// still topped by c) and moves exactly k units back (B's new top run is
// exactly k long, or A has exactly k free slots). Undoing the reverse pours in
// order therefore solves the puzzle. The start is CAPACITY units of each color
// in its own tube, so undoing them reaches the strict solved state.
//
// Murky (a separate mode on any tier): layers below each tube's top start
// hidden and are revealed for good once they reach the top (p.hidden).
// clearMurk (0.4.1) turns Murky off mid-puzzle, in place, keeping every pour.
//
// Dead ends (0.4.1): verdict / isDeadEnd ask the solver from the current
// position with a small node cap; backToSolvable steps back through the
// history (historyTubes) to the latest position that is not proven dead.

import {
  hexToRgb, rgbToHex, oklchToHex, hexToOklch, clampToGamut, deltaEHex, deltaE, rgbToOklab,
} from '../color.js';
import { shuffle, pick } from '../rng.js';
import { lastSolvable } from './backtrack.js';

export const MIN_COLORS = 4;
export const MAX_COLORS = 9;
export const CAPACITY = 4;

/**
 * Difficulty tiers (all free; docs/PLAN-v0.2.md Theme C.3). `purity` is what a
 * solve sets the batch to; `k` is the puzzle reward in minutes of production
 * (economy.puzzleReward); `minutes` is the expected length shown on the tier
 * control ("about 1 / 2 / 3 / 5 min"). `band` is the target solution length
 * [lo, hi] in pours, as rated by solve() (calibrated in tools/purify-bench.js);
 * `family` is how many colors stay in the batch's own hue family (the batch
 * color and its nearest neighbors; null = all of them), the rest being picked
 * strongly distinct (DISTINCT_DE apart).
 */
export const TIERS = Object.freeze({
  relaxed: Object.freeze({ colors: 4, tubes: 6, extraTube: true, purity: 'pure', k: 4, minutes: 1, band: Object.freeze([9, 13]), family: null }),
  steady: Object.freeze({ colors: 6, tubes: 8, extraTube: false, purity: 'pure', k: 6, minutes: 2, band: Object.freeze([16, 21]), family: null }),
  tricky: Object.freeze({ colors: 8, tubes: 10, extraTube: false, purity: 'flawless', k: 10, minutes: 3, band: Object.freeze([24, 29]), family: 3 }),
  master: Object.freeze({ colors: 9, tubes: 11, extraTube: false, purity: 'flawless', k: 16, minutes: 5, band: Object.freeze([28, 34]), family: 3 }),
});
export const TIER_IDS = Object.freeze(Object.keys(TIERS));

/**
 * Murky: a separate mode that combines with any tier. Every layer below the top
 * of each tube starts hidden (cloudy glass) and is revealed for good once it
 * becomes the top of its tube. `pay` multiplies the puzzle reward on a solve.
 */
export const MURKY = Object.freeze({ pay: 1.25 });

/** Minimum ΔE between the non-family colors on Tricky and Master boards. */
export const DISTINCT_DE = 18;
/** Chroma above which a distinct impurity is softened when its spacing allows. */
const SOFT_C = 0.13;

const tierOf = (tier) => TIERS[tier] ?? TIERS.relaxed;

/** sizeForTier(tier) -> {colors, tubes} (unknown tiers read as Relaxed). */
export function sizeForTier(tier) {
  const t = tierOf(tier);
  return { colors: t.colors, tubes: t.tubes };
}

/** expectedMinutes(tier) -> about how long a board takes: 1 / 2 / 3 / 5. */
export function expectedMinutes(tier) {
  return tierOf(tier).minutes;
}

/** Whether the tier allows the one free extra tube (Relaxed only). */
export function extraTubeAllowed(tier) {
  return !!tierOf(tier).extraTube;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const top = (tube) => (tube.length ? tube[tube.length - 1] : null);

function topRun(tube) {
  if (!tube.length) return 0;
  const c = tube[tube.length - 1];
  let n = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === c; i--) n++;
  return n;
}

const uniform = (tube) => tube.every((c) => c === tube[0]);

/** Pick `n` mutually distinguishable hexes: palette first, then a hue spread. */
function chooseColors(n, palette, rng) {
  const out = [];
  const fits = (hex, minDE) => out.every((h) => deltaEHex(h, hex) >= minDE);
  const norm = (h) => {
    try { return rgbToHex(hexToRgb(h)); } catch { return null; }
  };
  const pal = shuffle(rng, [...new Set((palette || []).map(norm).filter(Boolean))]);
  for (const minDE of [14, 10]) {
    for (const h of pal) if (out.length < n && !out.includes(h) && fits(h, minDE)) out.push(h);
  }
  // Fill with an even hue spread at alternating lightness.
  const offset = rng() * 360;
  const spread = [];
  for (let k = 0; k < 18; k++) {
    const L = [0.62, 0.78, 0.48][k % 3];
    spread.push(oklchToHex(clampToGamut({ L, C: 0.15, h: (offset + k * 47) % 360 })));
  }
  for (const minDE of [14, 10, 6, 0]) {
    for (const h of spread) if (out.length < n && !out.includes(h) && fits(h, minDE)) out.push(h);
  }
  return out.slice(0, n);
}

/** Candidate hexes for strongly distinct impurities: every 15° of hue, six lightnesses, five chromas (gamut-clamped). */
let SWEEP = null;
function distinctSweep() {
  if (SWEEP) return SWEEP;
  const out = new Set();
  for (let h = 0; h < 360; h += 15) {
    for (const L of [0.44, 0.52, 0.6, 0.68, 0.76, 0.84]) {
      for (const C of [0.06, 0.11, 0.16, 0.21, 0.26]) out.add(oklchToHex(clampToGamut({ L, C, h })));
    }
  }
  SWEEP = [...out].filter((hex) => { const L = hexToOklch(hex).L; return L >= 0.4 && L <= 0.86 && deltaEHex(hex, EMPTY_GLASS) >= 16; });
  return SWEEP;
}

/** What an empty tube looks like on the shelf (ui/purify.js: dark glass over walnut). */
export const EMPTY_GLASS = '#5C412E';

/**
 * Colors for a batch of `target`: the batch's own color plus its "impurities", drawn
 * from the same corner of the color wheel (her nearby colors first, then lighter,
 * darker and neighboring-hue versions of the target), so a coral batch sorts into
 * corals, roses, peaches and russets. Never near-white or near-black (those read as
 * an empty tube or a shadow), unless the batch itself is that pale.
 *
 * With `family` (Tricky and Master: 3), only that many colors come from the batch's
 * family (the batch and its nearest neighbors); the rest are picked far apart, at
 * least DISTINCT_DE from every other color, so a bigger board is harder to plan,
 * not harder to see.
 */
function themedColors(n, target, palette, rng, family = null) {
  const norm = (h) => {
    try { return rgbToHex(hexToRgb(h)); } catch { return null; }
  };
  const t = norm(target);
  if (!t) return chooseColors(n, palette, rng);
  const out = [t];
  const fits = (hex, minDE) => out.every((h) => deltaEHex(h, hex) >= minDE);
  const tl = hexToOklch(t);
  const hue = Number.isFinite(tl.h) ? tl.h : 30;
  const C = Math.min(0.16, Math.max(0.08, tl.C * 1.3 + 0.03));
  // Not near-white, and clearly apart from the dark glass of an empty tube.
  const okL = (hex) => { const L = hexToOklch(hex).L; return L >= 0.4 && L <= 0.86 && deltaEHex(hex, EMPTY_GLASS) >= 16; };
  // Candidates in widening hue windows: the batch's own hue family first (lighter,
  // darker, softer, brighter), then its neighbors, then the wider wheel.
  const ring = (dhs) => {
    const g = [];
    for (const dh of dhs) for (const L of [0.44, 0.52, 0.6, 0.68, 0.76, 0.84]) for (const c of [C * 0.6, C, C * 1.4]) {
      g.push(oklchToHex(clampToGamut({ L, C: c, h: (hue + dh + 360) % 360 })));
    }
    return g.filter(okL);
  };
  const near = (palette || []).map(norm).filter(Boolean).filter((h) => h !== t && okL(h));
  // Closest to the batch first, with a little shuffle so boards differ.
  const byNear = (list) => list.map((h) => ({ h, k: deltaEHex(h, t) + rng() * 6 })).sort((a, b) => a.k - b.k).map((x) => x.h);
  const within = (list, deg) => list.filter((h) => {
    const o = hexToOklch(h);
    const d = Math.abs((((o.h - hue) % 360) + 540) % 360 - 180);
    return o.C < 0.03 || d <= deg;
  });
  const passes = [
    [byNear([...within(near, 30), ...ring([0, 15, -15, 30, -30])]), [13, 11]],
    [byNear([...within(near, 70), ...ring([50, -50, 70, -70])]), [13, 11]],
    [byNear([...near, ...ring([100, -100, 140, -140, 180])]), [14, 11, 9]],
  ];
  const famN = Number.isInteger(family) && family > 0 ? Math.min(n, family) : n;
  for (const [cands, ladder] of passes) {
    for (const minDE of ladder) {
      for (const h of cands) if (out.length < famN && !out.includes(h) && fits(h, minDE)) out.push(h);
    }
  }
  if (famN < n) {
    // The rest far apart: her own colors and an even sweep of the wheel, picked
    // farthest-first (with a little jitter so boards differ).
    const lab = (h) => rgbToOklab(hexToRgb(h));
    const base = [...new Set([...near, ...distinctSweep()])].filter((h) => !out.includes(h)).map((h) => ({ h, lab: lab(h) }));
    const famLabs = out.map(lab);
    // Greedy farthest-first, restarted a few times (the jitter differs) until
    // every pick is at least DISTINCT_DE from all the others; keep the widest.
    let best = null;
    for (let tryN = 0; tryN < 16 && !(best && best.min >= DISTINCT_DE); tryN++) {
      const pool = base.map((c) => ({ ...c, d: Infinity }));
      const note = (o) => { for (const c of pool) { const e = deltaE(c.lab, o); if (e < c.d) c.d = e; } };
      famLabs.forEach(note);
      const picks = [];
      let min = Infinity;
      while (out.length + picks.length < n) {
        let pickC = null;
        let pickScore = -1;
        for (const c of pool) {
          if (picks.includes(c.h)) continue;
          const score = c.d + rng() * 3;
          if (score > pickScore) { pickScore = score; pickC = c; }
        }
        if (!pickC) break;
        picks.push(pickC.h);
        if (pickC.d < min) min = pickC.d;
        note(pickC.lab);
      }
      if (!best || min > best.min) best = { picks, min };
    }
    if (best) {
      // Soften: each pick moves to the calmest candidate (least chroma above
      // SOFT_C) that keeps its distance from every other color, so the spread
      // stays but the shelf reads papercut, not neon.
      const keep = Math.min(DISTINCT_DE, best.min);
      const picks = best.picks.slice();
      const labOf = new Map(base.map((c) => [c.h, c.lab]));
      const excess = (h) => Math.max(0, hexToOklch(h).C - SOFT_C);
      for (let k = 0; k < picks.length; k++) {
        const others = [...famLabs, ...picks.filter((_, j) => j !== k).map((h) => labOf.get(h))];
        let bestH = picks[k];
        let bestX = excess(bestH);
        if (bestX <= 0) continue;
        for (const c of base) {
          if (picks.includes(c.h)) continue;
          const x = excess(c.h);
          if (x >= bestX) continue;
          if (others.every((o) => deltaE(c.lab, o) >= keep)) { bestH = c.h; bestX = x; }
        }
        picks[k] = bestH;
      }
      out.push(...picks);
    }
  }
  if (out.length < n) {
    for (const h of chooseColors(n + 4, palette, rng)) if (out.length < n && !out.includes(h) && fits(h, 8)) out.push(h);
  }
  return shuffle(rng, out.slice(0, n));
}

/** Legacy (v0.1): puzzle size for a batch worth `valueMinutes` minutes of production. Use sizeForTier. */
export function sizeForBatch(valueMinutes) {
  const v = Number.isFinite(valueMinutes) ? Math.max(0, valueMinutes) : 0;
  const steps = [5, 15, 30, 60, 120]; // thresholds in minutes
  let colors = MIN_COLORS;
  for (const s of steps) if (v >= s) colors++;
  colors = clamp(colors, MIN_COLORS, MAX_COLORS);
  return { colors, tubes: colors + 2 };
}

// ---------------------------------------------------------------------------
// Solver: weighted best-first search over tube states
// ---------------------------------------------------------------------------
//
// A state is the list of tubes, each encoded as a short string (one letter per
// layer, bottom -> top). States are deduped by their canonical form (the tube
// strings sorted), so the same shelf in a different tube order is one node.
// Nodes are expanded by f = g + W·h, where g is pours so far and h is the
// "color breaks" heuristic: adjacent layers of different colors inside a tube,
// plus tubes that hold more than one color, plus colors split over several
// tubes (so h is 0 exactly on the strict solved shelf). W > 1 trades a few
// extra pours for far fewer nodes. The search is bounded by a node cap, never
// by the clock, so it stays pure and deterministic; tools/purify-bench.js
// times it.

/** Expanded-node budget for one solve. */
export const SOLVER_NODE_CAP = 25000;
/** Heuristic weight: f = g + W·h. */
export const SOLVER_WEIGHT = 2;

const encTube = (tube) => tube.map((c) => String.fromCharCode(97 + c)).join('');

/** colorBreaks(tubes as strings, scratch) -> breaks + mixed tubes + split colors (0 only when solved). */
function colorBreaks(tubes, counts) {
  counts.fill(0);
  let h = 0;
  for (let t = 0; t < tubes.length; t++) {
    const s = tubes[t];
    const n = s.length;
    if (!n) continue;
    let prev = s.charCodeAt(0);
    counts[prev - 97]++;
    let mixed = false;
    for (let i = 1; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c !== prev) { h++; mixed = true; counts[c - 97]++; prev = c; }
    }
    if (mixed) h++;
  }
  for (let c = 0; c < counts.length; c++) if (counts[c] > 1) h += counts[c] - 1;
  return h;
}

/**
 * heuristic(p) -> the "color breaks" score of a board (0 when solved): adjacent
 * different colors inside tubes + tubes that mix colors + colors split across tubes.
 */
export function heuristic(p) {
  return colorBreaks(p.tubes.map(encTube), new Int32Array(64));
}

/**
 * solve(p, {nodeCap, weight}) -> {ok:true, moves:[[from, to]…], length, nodes}
 *                              | {ok:false, reason:'budget'|'stuck', nodes}
 * Full information (hidden layers in Murky do not matter to it). `moves` index
 * the board's own tubes and replay through pour() to the strict solved state.
 */
export function solve(p, opts = {}) {
  const cap = p.capacity;
  const nodeCap = Number.isFinite(opts.nodeCap) ? opts.nodeCap : SOLVER_NODE_CAP;
  const W = Number.isFinite(opts.weight) ? opts.weight : SOLVER_WEIGHT;
  const counts = new Int32Array(64);
  const keyOf = (ts) => ts.slice().sort().join(',');
  const T = [];   // node -> tubes (strings, board order)
  const G = [];   // node -> pours from the start
  const Hs = [];  // node -> heuristic
  const PAR = []; // node -> parent node
  const MV = [];  // node -> from * 64 + to
  const heap = [];
  const less = (i, j) => {
    const fi = G[i] + W * Hs[i];
    const fj = G[j] + W * Hs[j];
    return fi < fj || (fi === fj && (Hs[i] < Hs[j] || (Hs[i] === Hs[j] && i < j)));
  };
  const push = (i) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (!less(heap[k], heap[up])) break;
      [heap[k], heap[up]] = [heap[up], heap[k]];
      k = up;
    }
  };
  const popMin = () => {
    const top0 = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]];
        k = m;
      }
    }
    return top0;
  };
  const add = (tubes, g, parent, mv) => {
    T.push(tubes); G.push(g); Hs.push(colorBreaks(tubes, counts)); PAR.push(parent); MV.push(mv);
    push(T.length - 1);
  };
  const start = p.tubes.map(encTube);
  const seen = new Set([keyOf(start)]);
  add(start, 0, -1, -1);
  let nodes = 0;
  while (heap.length) {
    const i = popMin();
    if (Hs[i] === 0) {
      const moves = [];
      for (let k = i; PAR[k] >= 0; k = PAR[k]) moves.push([Math.floor(MV[k] / 64), MV[k] % 64]);
      moves.reverse();
      return { ok: true, moves, length: moves.length, nodes };
    }
    if (++nodes > nodeCap) return { ok: false, reason: 'budget', nodes: nodes - 1 };
    const ts = T[i];
    const n = ts.length;
    let firstEmpty = -1;
    for (let b = 0; b < n; b++) if (!ts[b].length) { firstEmpty = b; break; }
    for (let a = 0; a < n; a++) {
      const A = ts[a];
      const len = A.length;
      if (!len) continue;
      const c = A.charCodeAt(len - 1);
      let run = 1;
      while (run < len && A.charCodeAt(len - 1 - run) === c) run++;
      const uni = run === len;
      if (uni && len === cap) continue; // corked
      for (let b = 0; b < n; b++) {
        if (b === a) continue;
        const B = ts[b];
        const bl = B.length;
        if (bl >= cap) continue;
        if (!bl) {
          if (uni || b !== firstEmpty) continue; // pointless, or the same as another empty tube
        } else if (B.charCodeAt(bl - 1) !== c) continue;
        const k = Math.min(run, cap - bl);
        const child = ts.slice();
        child[a] = A.slice(0, len - k);
        child[b] = B + A.slice(len - k);
        const key = keyOf(child);
        if (seen.has(key)) continue;
        seen.add(key);
        add(child, G[i] + 1, i, a * 64 + b);
      }
    }
  }
  return { ok: false, reason: 'stuck', nodes };
}

/** verify(p, moves) -> true when replaying `moves` with pour() on a copy reaches the strict solved state. */
export function verify(p, moves) {
  if (!Array.isArray(moves)) return false;
  const q = { tubes: p.tubes.map((t) => t.slice()), capacity: p.capacity, history: [], moves: 0 };
  for (const [a, b] of moves) if (!pour(q, a, b).ok) return false;
  return isSolved(q);
}

/** One random reverse pour; returns true if a move was made. */
function reversePour(tubes, capacity, rng) {
  const options = [];
  for (let a = 0; a < tubes.length; a++) {
    const A = tubes[a];
    if (!A.length) continue;
    const c = top(A);
    const run = topRun(A);
    for (let b = 0; b < tubes.length; b++) {
      if (b === a) continue;
      const B = tubes[b];
      const room = capacity - B.length;
      for (let k = 1; k <= Math.min(run, room); k++) {
        // Forward B -> A must be legal afterwards: A empty or still topped by c.
        // (Taking the whole run would expose a different color underneath.)
        if (k === run && k < A.length) continue;
        // Forward B -> A must move exactly k back.
        const runBAfter = k + (top(B) === c ? topRun(B) : 0);
        const freeAAfter = capacity - A.length + k;
        if (runBAfter !== k && freeAAfter !== k) continue;
        options.push([a, b, k]);
      }
    }
  }
  if (!options.length) return false;
  // Prefer single-unit moves so layers interleave.
  const singles = options.filter((o) => o[2] === 1);
  const [a, b, k] = singles.length && rng() < 0.6 ? pick(rng, singles) : pick(rng, options);
  const moved = tubes[a].splice(tubes[a].length - k, k);
  tubes[b].push(...moved);
  return true;
}

/** Boards tried per create (each one solved and rated); the first in the tier's band wins. */
export const CANDIDATES = 6;
/** Expanded-node budget for all the candidates of one create together. */
export const CREATE_NODE_BUDGET = 30000;

/** A random deal: every unit shuffled into the first `nColors` tubes, the rest empty. */
function deal(nColors, nTubes, capacity, rng) {
  const units = [];
  for (let c = 0; c < nColors; c++) for (let k = 0; k < capacity; k++) units.push(c);
  const sh = shuffle(rng, units);
  const tubes = [];
  for (let i = 0; i < nTubes; i++) tubes.push(i < nColors ? sh.slice(i * capacity, (i + 1) * capacity) : []);
  return tubes;
}

/** The pre-0.3.3 board: reverse pours from the solved shelf (solvable by construction). */
function scramble(nColors, nTubes, capacity, rng) {
  const tubes = [];
  for (let i = 0; i < nTubes; i++) tubes.push(i < nColors ? new Array(capacity).fill(i) : []);
  // Mixed means some tube holds two colors (not merely a split color), so the
  // board never opens looking already sorted.
  const sorted = () => tubes.every((tube) => !tube.length || uniform(tube));
  const pours = 20 + nColors * 8;
  for (let attempt = 0; attempt < 20; attempt++) {
    for (let i = 0; i < pours; i++) reversePour(tubes, capacity, rng);
    if (!sorted()) break;
  }
  for (let i = 0; i < 1000 && sorted(); i++) reversePour(tubes, capacity, rng);
  return tubes;
}

/** Distance from a rating to a band [lo, hi] (0 inside it). */
const bandGap = (n, band) => (!band ? 0 : n < band[0] ? band[0] - n : n > band[1] ? n - band[1] : 0);

/**
 * create({tier?, colors = 4..9, tubes = colors + 2, capacity = 4, extraTube?, murky?, nodeBudget?}, rng, {palette, target?}) -> puzzle
 * {tubes:[[colorIndex…]] bottom→top, capacity, colors:[hex], history:[], moves:0,
 *  extraTubeUsed:false, tier, extraTube, par, murky?, hidden?}
 * With a `tier`, colors / tubes / extraTube come from TIERS (explicit numbers
 * still win). `extraTube` (default true without a tier) gates addTube.
 *
 * Boards are random deals, each solved by solve() (full information) and rated
 * by its solution length; the first candidate inside the tier's `band` is kept,
 * else the verified one closest to it. If no candidate is verified within
 * CREATE_NODE_BUDGET, the board is the plain reverse-pour scramble, which is
 * solvable by construction. `par` is the rated solution length (null on the
 * fallback); it is never shown as a limit. `murky: true` hides every layer below
 * each tube's top (see hiddenCount).
 */
export function create(opts, rng, extra) {
  if (typeof rng !== 'function') throw new TypeError('purify.create: rng must be a function');
  const o = opts || {};
  const t = o.tier && TIERS[o.tier] ? TIERS[o.tier] : null;
  const nColors = clamp(Math.floor(o.colors || (t && t.colors) || MIN_COLORS), 2, 12);
  const capacity = Math.max(2, Math.floor(o.capacity || CAPACITY));
  const nTubes = Math.max(nColors + 1, Math.floor(o.tubes || (t && t.tubes) || nColors + 2));
  const colors = extra && extra.target
    ? themedColors(nColors, extra.target, extra.palette, rng, t ? t.family : null)
    : chooseColors(nColors, extra && extra.palette, rng);
  const allowExtra = typeof o.extraTube === 'boolean' ? o.extraTube : (t ? t.extraTube : true);
  const band = t && !o.colors && !o.tubes ? t.band : null;

  let best = null;
  let budget = Number.isFinite(o.nodeBudget) ? o.nodeBudget : CREATE_NODE_BUDGET;
  for (let k = 0; k < CANDIDATES && budget > 0; k++) {
    const tubes = deal(nColors, nTubes, capacity, rng);
    // A dealt tube that is already full of one color would open corked: deal again.
    if (tubes.some((tb) => tb.length === capacity && uniform(tb))) continue;
    const r = solve({ tubes, capacity }, { nodeCap: Math.min(SOLVER_NODE_CAP, budget) });
    budget -= r.nodes;
    if (!r.ok || !verify({ tubes, capacity }, r.moves)) continue;
    const gap = bandGap(r.length, band);
    if (!best || gap < best.gap) best = { tubes, par: r.length, gap };
    if (gap === 0) break;
  }
  const p = {
    tubes: best ? best.tubes : scramble(nColors, nTubes, capacity, rng),
    capacity, colors, history: [], moves: 0, extraTubeUsed: false,
    tier: t ? o.tier : null, extraTube: allowExtra, par: best ? best.par : null,
  };
  if (o.murky) {
    p.murky = true;
    p.hidden = p.tubes.map((tb) => (tb.length === capacity && uniform(tb) ? 0 : Math.max(0, tb.length - 1)));
  }
  return p;
}

/** createForTier(tier, rng, {palette, target?, murky?}) -> a board sized, rated and gated by TIERS[tier]. */
export function createForTier(tier, rng, extra) {
  return create({ tier: TIERS[tier] ? tier : 'relaxed', murky: !!(extra && extra.murky) }, rng, extra);
}

// ---------------------------------------------------------------------------
// Murky: hidden layers
// ---------------------------------------------------------------------------
//
// p.hidden[i] counts the hidden layers at the BOTTOM of tube i; everything
// above is revealed. Only a tube's top can be uncovered and poured layers land
// revealed, so the hidden layers are always a bottom run. After any change a
// tube keeps at most length - 1 hidden (its top shows), and a corked tube
// shows all of it. Counts only ever go down, so undo never re-hides anything.
// A puzzle without `hidden` (every save before 0.3.3) is fully revealed.

/** hiddenCount(p, i) -> how many layers at the bottom of tube i are still cloudy. */
export function hiddenCount(p, i) {
  if (!p || !p.murky || !Array.isArray(p.hidden)) return 0;
  const n = Number(p.hidden[i]);
  const len = p.tubes[i] ? p.tubes[i].length : 0;
  return Number.isFinite(n) ? clamp(Math.floor(n), 0, Math.max(0, len - 1)) : 0;
}

/** isHidden(p, i, k) -> true when layer k (0 = bottom) of tube i is still cloudy. */
export function isHidden(p, i, k) {
  return k < hiddenCount(p, i);
}

/** hiddenTotal(p) -> cloudy layers left on the board. */
export function hiddenTotal(p) {
  if (!p || !p.tubes) return 0;
  let n = 0;
  for (let i = 0; i < p.tubes.length; i++) n += hiddenCount(p, i);
  return n;
}

/** Re-apply the reveal rule to tube i (top always shows; a corked tube shows all). */
function settle(p, i) {
  if (!p.murky || !Array.isArray(p.hidden)) return;
  const tube = p.tubes[i];
  if (!tube) return;
  const corked = tube.length === p.capacity && uniform(tube);
  p.hidden[i] = corked ? 0 : hiddenCount(p, i);
}

/** True when a forward pour from -> to is allowed. */
export function canPour(p, from, to) {
  const A = p.tubes[from];
  const B = p.tubes[to];
  if (!A || !B || from === to || !A.length) return false;
  if (B.length >= p.capacity) return false;
  return !B.length || top(B) === top(A);
}

/** Pour the top run of `from` onto `to` (as much as fits). */
export function pour(p, from, to) {
  if (!canPour(p, from, to)) return { ok: false, moved: 0, completedTube: false, solved: isSolved(p) };
  const A = p.tubes[from];
  const B = p.tubes[to];
  const n = Math.min(topRun(A), p.capacity - B.length);
  B.push(...A.splice(A.length - n, n));
  settle(p, from);
  settle(p, to);
  p.history.push({ from, to, n });
  p.moves += 1;
  const completedTube = B.length === p.capacity && uniform(B);
  return { ok: true, moved: n, completedTube, solved: isSolved(p) };
}

/** Take back the last pour. Unlimited. Moves are not refunded (bragging only). */
export function undo(p) {
  const last = p.history.pop();
  if (!last) return { ok: false };
  const B = p.tubes[last.to];
  p.tubes[last.from].push(...B.splice(B.length - last.n, last.n));
  settle(p, last.from);
  settle(p, last.to);
  return { ok: true, from: last.to, to: last.from, moved: last.n };
}

/**
 * clearMurk(p) -> {ok, revealed: [[tube, layer]…]}: Murky off for this puzzle,
 * in place (0.4.1). Every cloudy layer is revealed for good, every pour so far
 * is kept (history untouched), and the puzzle is no longer Murky, so a solve
 * pays the usual amount (the pay reads p.murky at completion). Undo never
 * re-hides a layer (settle() does nothing on a puzzle that is not Murky).
 * `p.murkCleared` remembers that she chose this, so the batch is not restarted.
 */
export function clearMurk(p) {
  if (!p || !p.murky) return { ok: false, revealed: [] };
  const revealed = [];
  for (let i = 0; i < p.tubes.length; i++) {
    const n = hiddenCount(p, i);
    for (let k = 0; k < n; k++) revealed.push([i, k]);
  }
  p.murky = false;
  if (Array.isArray(p.hidden)) p.hidden = p.hidden.map(() => 0);
  p.murkCleared = true;
  return { ok: true, revealed };
}

// ---------------------------------------------------------------------------
// Dead ends and "Back to solvable" (0.4.1)
// ---------------------------------------------------------------------------
//
// verdict(p) runs solve() from the current position with a small node cap:
// 'solvable' (a solution found), 'dead' (the search was exhausted: no order of
// pours finishes this shelf with these tubes) or 'unknown' (the cap was
// reached). Only 'dead' ever shows the button, so it never lies. Verdicts are
// cached by the canonical position (tube order does not matter).

/** Node cap for the after-every-pour dead-end check (a few ms on a phone). */
export const DEAD_NODE_CAP = 1500;
/** Node cap per position while stepping back through the history. */
export const BACK_NODE_CAP = 4000;

/** positionKey(p) -> the canonical shelf (tubes sorted, empties included, capacity). */
export function positionKey(p) {
  return `${p.capacity}|${p.tubes.map(encTube).sort().join(',')}`;
}

/**
 * verdict(p, {nodeCap, cache}) -> 'solvable' | 'dead' | 'unknown'. `cache`
 * (backtrack.verdictCache()) keeps answers by position; an 'unknown' is only
 * reused for a cap no bigger than the one that produced it.
 */
export function verdict(p, { nodeCap = DEAD_NODE_CAP, cache = null } = {}) {
  if (isSolved(p)) return 'solvable';
  const key = positionKey(p);
  const hit = cache ? cache.get(key) : null;
  if (hit && (hit.v !== 'unknown' || hit.cap >= nodeCap)) return hit.v;
  const r = solve({ tubes: p.tubes, capacity: p.capacity }, { nodeCap });
  const v = r.ok ? 'solvable' : r.reason === 'stuck' ? 'dead' : 'unknown';
  if (cache) cache.set(key, { v, cap: nodeCap });
  return v;
}

/** isDeadEnd(p, opts) -> true only when the solver proves no order of pours finishes from here. */
export function isDeadEnd(p, opts) {
  return verdict(p, opts) === 'dead';
}

/** spareHelps(p, opts) -> true when the board is a dead end now but the free extra tube (not yet added) would rescue it. */
export function spareHelps(p, opts) {
  if (!p || p.extraTubeUsed || p.extraTube === false) return false;
  return verdict({ tubes: [...p.tubes, []], capacity: p.capacity }, opts) === 'solvable';
}

/** historyTubes(p) -> [tubes after 0 pours, after 1, …, now] rebuilt by undoing the history on a copy. */
export function historyTubes(p) {
  const tubes = p.tubes.map((t) => t.slice());
  const hist = Array.isArray(p.history) ? p.history : [];
  const out = [tubes.map((t) => t.slice())];
  for (let i = hist.length - 1; i >= 0; i--) {
    const { from, to, n } = hist[i];
    const B = tubes[to];
    if (!B || !tubes[from]) break;
    tubes[from].push(...B.splice(B.length - n, n));
    out.push(tubes.map((t) => t.slice()));
  }
  return out.reverse();
}

/**
 * backToSolvable(p, {nodeCap, cache}) -> {index, steps}: the latest position in
 * her history that is not proven dead ('unknown' counts as solvable), and how
 * many undos reach it (0 when she is fine where she is). Pure; nothing moves.
 */
export function backToSolvable(p, { nodeCap = BACK_NODE_CAP, cache = null } = {}) {
  const states = historyTubes(p);
  const n = states.length;
  const index = lastSolvable(n, (i) => verdict({ tubes: states[i], capacity: p.capacity }, { nodeCap, cache }));
  return { index, steps: n - 1 - index };
}

/** Add the one free empty tube; only on a board whose tier allows it (Relaxed). */
export function addTube(p) {
  if (p.extraTubeUsed || p.extraTube === false) return { ok: false };
  p.tubes.push([]);
  if (p.murky && Array.isArray(p.hidden)) p.hidden[p.tubes.length - 1] = 0;
  p.extraTubeUsed = true;
  return { ok: true, index: p.tubes.length - 1 };
}

/** Solved when every non-empty tube holds a single color AND is full (corked). */
export function isSolved(p) {
  return p.tubes.every((t) => !t.length || (t.length === p.capacity && uniform(t)));
}

/** True when tube `i` is full and one color (it corks). */
export function isCorked(p, i) {
  const t = p.tubes[i];
  return !!t && t.length === p.capacity && uniform(t);
}

/** ARCHITECTURE.md shape: apply(p, {from, to} | {undo:true} | {addTube:true}). */
export function apply(p, move) {
  if (move && move.undo) {
    const r = undo(p);
    return { ...r, events: r.ok ? ['undo'] : ['refused'] };
  }
  if (move && move.addTube) {
    const r = addTube(p);
    return { ...r, events: r.ok ? ['tube'] : ['refused'] };
  }
  const r = pour(p, move && move.from, move && move.to);
  const events = r.ok ? ['pour', ...(r.completedTube ? ['cork'] : []), ...(r.solved ? ['solved'] : [])] : ['refused'];
  return { ...r, events };
}
