// The Tangle Basket: level generation (pure; used at authoring time by
// gen-levels.mjs and by the tests). No window/document/Date.now/Math.random.
//
// A heap is built bottom to top. Each new strand is a smooth random walk
// (control points about 9 units apart, with a slowly drifting curl) dropped on
// the heap. A candidate is kept only if
//   - it stays on the board and never runs close along itself;
//   - against every strand already down it either clearly crosses
//     (centerlines closer than 0.72 W) or keeps clearly apart (over 1.3 W), so
//     what she sees and what the rules say always agree;
//   - every strand under it keeps at least VIS_MIN of its length in view, with
//     a stretch of RUN_MIN units somewhere she can tap.
// Among a few good candidates, the one with about the wanted number of
// crossings wins. Then colors, knots, pins, two-color strands and buried
// colors are dealt onto the geometry, and gen-levels.mjs keeps the deal whose
// random-player clear rate is nearest the level's target (solver-verified).
import { W, BOARD, spline, arcLengths, gridOf, nearDist, minDist, SPOOL, buildLevel, acyclic, mulberry } from './rules.js';

export const VIS_MIN = 0.36;
export const RUN_MIN = 8;
const CROSS = 0.72, APART = 1.3, COVER = 0.6;
const PAD = W / 2 + 1.2; // centerline keeps this far from the board edge
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Colors in the order levels bring them in (friendly, high-contrast ones first).
export const COLOR_ORDER = ['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l'];

function walk(rng, { len, start, heading, step = 9 }) {
  const n = Math.max(3, Math.round(len / step) + 1);
  let [x, y] = start;
  let h = heading, turn = (rng() - 0.5) * 0.8;
  const pts = [[r1(x), r1(y)]];
  const lo = PAD + 1.5, hiX = BOARD.w - PAD - 1.5, hiY = BOARD.h - PAD - 1.5;
  for (let k = 1; k < n; k++) {
    turn = clamp(turn + (rng() - 0.5) * 0.7, -0.75, 0.75);
    let nx, ny, tries = 0;
    for (;;) {
      h += turn;
      nx = x + Math.cos(h) * step; ny = y + Math.sin(h) * step;
      if (nx >= lo && nx <= hiX && ny >= lo && ny <= hiY) break;
      h = Math.atan2(BOARD.h / 2 - y, BOARD.w / 2 - x) + (rng() - 0.5) * 1.4;
      turn = (rng() - 0.5) * 0.3;
      if (++tries > 8) return null;
    }
    x = nx; y = ny;
    pts.push([r1(x), r1(y)]);
  }
  return pts;
}

function inBounds(poly) {
  return poly.every(([x, y]) => x >= PAD && x <= BOARD.w - PAD && y >= PAD && y <= BOARD.h - PAD);
}
// Does a strand run close along itself (a loop or a fold)?
function selfTouch(poly, cum, grid) {
  for (let k = 0; k < poly.length; k += 2) {
    const p = poly[k];
    const gx = Math.floor(p[0] / (2 * W)), gy = Math.floor(p[1] / (2 * W));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = grid.get((gx + dx + 64) * 4096 + (gy + dy + 64));
      if (!a) continue;
      for (const j of a) {
        if (Math.abs(cum[j] - cum[k]) < 2.4 * W) continue;
        if (Math.hypot(poly[j][0] - p[0], poly[j][1] - p[1]) < 1.35 * W) return true;
      }
    }
  }
  return false;
}
// Fraction of samples in view, and the longest run in view (units).
function visibility(cov, cum) {
  let vis = 0, run = 0, best = 0;
  for (let k = 0; k < cov.length; k++) {
    const step = k ? cum[k] - cum[k - 1] : 0;
    if (!cov[k]) { vis += step; run += step; if (run > best) best = run; } else run = 0;
  }
  return { frac: vis / cum[cum.length - 1], run: best };
}

/**
 * makeHeap(rng, opts) -> { ctrl: [[[x,y]...]], knots: [[a,b]] } or null
 * opts: n strands; len [min, max]; cross: wanted crossings per new strand;
 * knots: how many knotted pairs (each pair is placed one after the other).
 */
export function makeHeap(rng, { n, len = [55, 85], cross = 2, knots = 0, tries = 60, center = 0.85 } = {}) {
  const ctrl = [], poly = [], cum = [], grid = [], cov = [];
  const knotAt = new Set();
  // knotted pairs: spread through the heap, never at the very bottom
  for (let k = 0; k < knots; k++) {
    for (let t = 0; t < 50; t++) {
      const a = 1 + Math.floor(rng() * (n - 2));
      if (knotAt.has(a) || knotAt.has(a + 1) || knotAt.has(a - 1) || knotAt.has(a + 2)) continue;
      knotAt.add(a);
      break;
    }
  }
  const knotList = [...knotAt].sort((a, b) => a - b).map((a) => [a, a + 1]);
  const partnerOf = (i) => { for (const [a, b] of knotList) { if (a === i) return b; if (b === i) return a; } return -1; };
  for (let i = 0; i < n; i++) {
    const knotted = knotList.find(([, b]) => b === i);
    const pairStart = knotList.some(([a]) => a === i);
    let best = null;
    let found = 0;
    for (let t = 0; t < tries && found < 6; t++) {
      const L = len[0] + rng() * (len[1] - len[0]);
      let start, heading;
      if (knotted) {
        const pc = ctrl[i - 1], e = pc[pc.length - 1], f = pc[pc.length - 2];
        start = e; heading = Math.atan2(e[1] - f[1], e[0] - f[0]) + (rng() - 0.5) * 0.9;
      } else {
        const sx = BOARD.w / 2 + (rng() + rng() - 1) * BOARD.w * 0.5 * center;
        const sy = BOARD.h / 2 + (rng() + rng() - 1) * BOARD.h * 0.5 * center;
        start = [clamp(sx, PAD + 2, BOARD.w - PAD - 2), clamp(sy, PAD + 2, BOARD.h - PAD - 2)];
        heading = rng() * Math.PI * 2;
      }
      const c = walk(rng, { len: pairStart ? L * 0.7 : knotted ? L * 0.7 : L, start, heading });
      if (!c) continue;
      const p = spline(c);
      if (!inBounds(p)) continue;
      const cm = arcLengths(p);
      const g = gridOf(p);
      if (selfTouch(p, cm, g)) continue;
      if (knotted) {
        // the joined pair must not run close along itself either
        const both = poly[i - 1].concat(p.slice(1));
        if (selfTouch(both, arcLengths(both), gridOf(both))) continue;
      }
      let ok = true, crosses = 0;
      for (let j = 0; j < i && ok; j++) {
        if (partnerOf(i) === j) continue;
        const d = minDist(p, poly[j], grid[j]);
        if (d < CROSS * W) crosses++;
        else if (d <= APART * W) ok = false;
      }
      if (!ok) continue;
      // every strand underneath keeps enough of itself in view
      const newCov = [];
      for (let j = 0; j < i && ok; j++) {
        const cv = cov[j].slice();
        let changed = false;
        for (let k = 0; k < cv.length; k++) if (!cv[k] && nearDist(poly[j][k], p, g) < COVER * W) { cv[k] = 1; changed = true; }
        if (changed) {
          const v = visibility(cv, cum[j]);
          if (v.frac < VIS_MIN || v.run < RUN_MIN) ok = false;
          newCov.push([j, cv]);
        }
      }
      if (!ok) continue;
      found++;
      const want = Math.min(cross, i);
      const score = -Math.abs(crosses - want) + rng() * 0.8 + (i > 1 && crosses === 0 ? -1.5 : 0);
      if (!best || score > best.score) best = { score, c, p, cm, g, newCov };
    }
    if (!best) return null;
    ctrl.push(best.c); poly.push(best.p); cum.push(best.cm); grid.push(best.g);
    cov.push(best.p.map(() => 0));
    for (const [j, cv] of best.newCov) cov[j] = cv;
  }
  return { ctrl, knots: knotList };
}

// For each strand, every strand lying over it, directly or through others.
export function ancestors(L) {
  const memo = [];
  const up = (i) => {
    if (memo[i]) return memo[i];
    const set = new Set();
    memo[i] = set;
    for (const j of L.over[i]) { set.add(j); for (const k of up(j)) set.add(k); }
    return set;
  };
  for (let i = L.n - 1; i >= 0; i--) up(i);
  return memo;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/**
 * dealLevel(heap, rng, opts) -> level def (strands, knots, pins), unchecked.
 * opts: colors (how many), vari (two-color strands), pins, buried (share of
 * covered strands that show gray), slots.
 */
export function dealLevel(heap, rng, { colors = 3, vari = 0, pins = 0, buried = 0 } = {}) {
  const n = heap.ctrl.length;
  const keys = COLOR_ORDER.slice(0, colors);
  const inKnot = new Set(heap.knots.flat());
  // two-color strands: never in a knot (one idea at a time on a strand)
  const variIdx = shuffle([...Array(n).keys()].filter((i) => !inKnot.has(i)), rng).slice(0, vari);
  const U = n + variIdx.length;
  if (U % SPOOL) return null;
  const spools = U / SPOOL;
  if (spools < colors) return null;
  const per = keys.map(() => 1);
  for (let k = colors; k < spools; k++) per[Math.floor(rng() * colors)]++;
  const pool = [];
  keys.forEach((c, k) => { for (let u = 0; u < per[k] * SPOOL; u++) pool.push(c); });
  shuffle(pool, rng);
  const strands = heap.ctrl.map((c) => ({ c: null, p: c.flat() }));
  for (const i of variIdx) {
    const a = pool.pop();
    const k = pool.findIndex((x) => x !== a);
    if (k < 0) return null;
    const b = pool.splice(k, 1)[0];
    strands[i].c = a; strands[i].c2 = b;
  }
  for (const s of strands) if (!s.c) s.c = pool.pop();
  const def = { strands, knots: heap.knots.map((k) => k.slice()), pins: [] };
  // pins and buried colors need the geometry
  let L = buildLevel({ id: 'tmp', name: 'tmp', ...def });
  if (pins) {
    // A pin must matter: the strand that frees it must not already lie over the
    // pinned strand (directly or through others), or the pin changes nothing.
    // Pinned strands that come uncovered early are preferred, so she meets them.
    const above = ancestors(L);
    const cands = [];
    for (let s = 0; s < n; s++) {
      if (inKnot.has(s) || variIdx.includes(s)) continue;
      for (let by = 0; by < n; by++) {
        if (by === s || L.partner[s] === by || above[s].has(by)) continue;
        const d = minDist(L.poly[s], L.poly[by], L.grids[by]);
        if (d >= 1.4 * W && d <= 2.6 * W) cands.push({ pair: [s, by], key: above[s].size + rng() * 2.5 - above[by].size * 0.3 });
      }
    }
    cands.sort((a, b) => a.key - b.key);
    const used = new Set();
    for (const { pair: [s, by] } of cands) {
      if (def.pins.length >= pins) break;
      if (used.has(s) || used.has(by)) continue;
      const trial = { ...def, pins: [...def.pins, [s, by]] };
      const T = buildLevel({ id: 'tmp', name: 'tmp', ...trial });
      if (!acyclic(T)) continue;
      def.pins.push([s, by]); used.add(s); used.add(by);
    }
    if (def.pins.length < pins) return null;
    L = buildLevel({ id: 'tmp', name: 'tmp', ...def });
  }
  if (buried) {
    const covered = [...Array(n).keys()].filter((i) => L.over[i].length > 0);
    const k = Math.round(covered.length * buried);
    for (const i of shuffle(covered, rng).slice(0, k)) strands[i].q = 1;
  }
  return def;
}

/** One candidate for a level: geometry from `seed`, then deal `deal`. */
export function candidate(knobs, seed, deal = 0) {
  const heap = makeHeap(mulberry(seed * 7919 + 1), knobs);
  if (!heap) return null;
  return heapCandidate(heap, knobs, seed, deal);
}
export function heapCandidate(heap, knobs, seed, deal) {
  const def = dealLevel(heap, mulberry(seed * 104729 + deal * 31 + 5), knobs);
  if (!def) return null;
  return { ...def, slots: knobs.slots ?? 5 };
}
