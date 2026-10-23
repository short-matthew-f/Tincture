// The Tangle Basket: pure rules. No window/document/Date.now/Math.random.
// Everything random (generation, playouts) takes an explicit seed or rng.
// The save holds only ids, numbers and color keys, never objects from content.
//
// THE HEAP
// - A level is a heap of yarn strands on a board 100 units wide and 140 tall.
//   Each strand is a smooth Catmull-Rom spline through its control points,
//   drawn W units thick. Strands are listed bottom to top: a later strand lies
//   on top of an earlier one wherever their bodies touch (centerlines closer
//   than W * TOUCH). The generator keeps every pair either clearly touching or
//   clearly apart, so the rule and the picture always agree.
// - A strand is UNCOVERED when no strand still in the heap lies over it.
//
// PULLING
// - She taps a strand to pull it. It comes out only if it is uncovered, it is
//   not pinned, and the rack has room for it (below). Then it winds onto a spool.
// - The rack has `slots` places. Each holds one spool of one color. A pulled
//   strand winds onto the spool of its color if one is on the rack, otherwise it
//   starts a new spool in the leftmost empty place. A spool that reaches SPOOL
//   strands is complete: it pops off as a finished skein and frees its place.
// - Every color comes in a multiple of SPOOL strand-lengths, so every spool
//   fills in the end. With a full rack, only colors already on it can come out:
//   that is the planning.
//
// THE MECHANICS (each introduced on its own level, see levels.js)
// - Knot: two strands tied end to end come out together, as one pull. Both
//   must be uncovered (they may lie on each other), and both wind on in turn.
// - Pin: a pinned strand stays put until the strand named by its pin (`by`,
//   the one matching the pin's glass head) has been pulled.
// - Variegated: a two-color strand puts one length on each color's spool.
// - Buried colors: a strand marked `q` looks undyed gray while it is covered.
//   A display rule only; the rules ignore it.
// - A smaller rack: `slots` is 4 instead of 5.
//
// NO FAIL STATE
// - Stuck: nothing can be pulled (in practice, the rack is full and no
//   uncovered strand matches a spool). The UI offers Undo, then one free spare
//   rack place per level (the nudge), then Start over. Undo is unlimited.
//
// Within one pull, lengths wind on in the order that fits: lengths for spools
// already on the rack first (they may complete and free a place), then new ones.

export const VERSION = 1;
export const SPOOL = 3;   // strand-lengths per spool
export const NUDGES = 1;  // free spare rack places per level
export const W = 5.6;     // yarn thickness, board units
export const BOARD = { w: 100, h: 140 };
export const TOUCH = 0.9; // bodies touch when centerlines are closer than W * TOUCH
export const STEP = 1;    // spline sample spacing, board units

// Natural-dye colors. Keys are what the save and the level data hold.
export const COLORS = {
  m: { name: 'Madder red', short: 'madder', hex: '#B9473A', glyph: 'dot' },
  w: { name: 'Weld yellow', short: 'weld', hex: '#D6A92E', glyph: 'diamond' },
  i: { name: 'Indigo blue', short: 'indigo', hex: '#34588E', glyph: 'ring' },
  n: { name: 'Walnut brown', short: 'walnut', hex: '#6B4630', glyph: 'wave' },
  c: { name: 'Cochineal pink', short: 'cochineal', hex: '#B8467A', glyph: 'heart' },
  g: { name: 'Nettle green', short: 'nettle', hex: '#5F8A3A', glyph: 'leaf' },
  l: { name: 'Logwood purple', short: 'logwood', hex: '#674A8C', glyph: 'moon' },
  o: { name: 'Onion skin orange', short: 'onion skin', hex: '#D9782B', glyph: 'sun' },
};
export const COLOR_KEYS = Object.keys(COLORS);
export const HIDDEN_HEX = '#A9A296';

// ---------- geometry ----------

// Catmull-Rom (uniform) through control points [[x,y],...], sampled about
// every STEP units. Pure arithmetic, so it is identical everywhere.
export function spline(ctrl) {
  const P = (k) => ctrl[Math.max(0, Math.min(ctrl.length - 1, k))];
  const out = [[ctrl[0][0], ctrl[0][1]]];
  for (let k = 0; k < ctrl.length - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(d / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

export function arcLengths(poly) {
  const cum = [0];
  for (let k = 1; k < poly.length; k++) cum.push(cum[k - 1] + Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]));
  return cum;
}

// A uniform grid of sample points for quick nearest-distance checks.
const CELL = 2 * W;
const cellKey = (gx, gy) => (gx + 64) * 4096 + (gy + 64);
export function gridOf(poly) {
  const m = new Map();
  for (let k = 0; k < poly.length; k++) {
    const key = cellKey(Math.floor(poly[k][0] / CELL), Math.floor(poly[k][1] / CELL));
    let a = m.get(key);
    if (!a) m.set(key, (a = []));
    a.push(k);
  }
  return m;
}
// Distance from point p to the nearest sample of a polyline (via its grid),
// or Infinity when farther than one grid cell.
export function nearDist(p, poly, grid) {
  const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = grid.get(cellKey(gx + dx, gy + dy));
    if (!a) continue;
    for (const k of a) {
      const d = Math.hypot(poly[k][0] - p[0], poly[k][1] - p[1]);
      if (d < best) best = d;
    }
  }
  return best > CELL ? Infinity : best;
}
export function minDist(a, b, gridB) {
  let best = Infinity;
  for (const p of a) { const d = nearDist(p, b, gridB); if (d < best) best = d; }
  return best;
}
const bbox = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
const boxesNear = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

// Where a touches b: one spot per run of a's samples within reach of b.
function touchSpots(a, b, gridB, reach) {
  const spots = [];
  let run = null;
  for (let k = 0; k <= a.length; k++) {
    const near = k < a.length && nearDist(a[k], b, gridB) < reach;
    if (near) { if (!run) run = [k, k]; else run[1] = k; } else if (run) {
      const mid = a[(run[0] + run[1]) >> 1];
      spots.push([mid[0], mid[1]]);
      run = null;
    }
  }
  return spots;
}

// ---------- levels ----------

// def: { id, name, slots, strands: [{ c, c2?, q?, p: [x0,y0,x1,y1,...] }],
//        knots?: [[a,b]], pins?: [[s,by]] }
export function buildLevel(def) {
  const strands = def.strands.map((s) => {
    const ctrl = [];
    for (let k = 0; k < s.p.length; k += 2) ctrl.push([s.p[k], s.p[k + 1]]);
    return { c: s.c, c2: s.c2 || null, q: !!s.q, ctrl };
  });
  const n = strands.length;
  const poly = strands.map((s) => spline(s.ctrl));
  const cum = poly.map(arcLengths);
  const grids = poly.map(gridOf);
  const boxes = poly.map(bbox);
  const partner = Array(n).fill(-1);
  for (const [a, b] of def.knots || []) { partner[a] = b; partner[b] = a; }
  const pinBy = Array(n).fill(-1);
  const pinAt = Array(n).fill(null);
  // over[i]: strands lying on top of i; under[i]: strands i lies on.
  const over = poly.map(() => []), under = poly.map(() => []);
  const spots = []; // { u, l, x, y }: contact shadows, u lies over l
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (partner[i] === j) continue;
      if (!boxesNear(boxes[i], boxes[j], W)) continue;
      if (minDist(poly[i], poly[j], grids[j]) < W * TOUCH) {
        over[i].push(j); under[j].push(i);
        for (const [x, y] of touchSpots(poly[i], poly[j], grids[j], W * 0.55)) spots.push({ u: j, l: i, x, y });
      }
    }
  }
  for (const [s, by] of def.pins || []) {
    pinBy[s] = by;
    // the pin sits on s where it comes closest to its neighbor
    let best = 0, bd = Infinity;
    poly[s].forEach((p, k) => { const d = nearDist(p, poly[by], grids[by]); if (d < bd) { bd = d; best = k; } });
    if (bd === Infinity) { // farther than a grid cell: brute force
      poly[s].forEach((p, k) => { for (const q of poly[by]) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; best = k; } } });
    }
    pinAt[s] = best;
  }
  const colors = [];
  for (const s of strands) for (const c of s.c2 ? [s.c, s.c2] : [s.c]) if (!colors.includes(c)) colors.push(c);
  const units = {};
  for (const s of strands) for (const c of s.c2 ? [s.c, s.c2] : [s.c]) units[c] = (units[c] || 0) + 1;
  return {
    id: def.id, name: def.name, slots: def.slots ?? 5, n, strands, poly, cum, grids, over, under, spots,
    partner, pinBy, pinAt, colors, units, knots: (def.knots || []).map((k) => k.slice()), pins: (def.pins || []).map((p) => p.slice()),
  };
}

export const colorsOf = (L, i) => (L.strands[i].c2 ? [L.strands[i].c, L.strands[i].c2] : [L.strands[i].c]);
export const groupOf = (L, i) => (L.partner[i] >= 0 ? [Math.min(i, L.partner[i]), Math.max(i, L.partner[i])] : [i]);
export const unitsBalanced = (L) => Object.values(L.units).every((u) => u % SPOOL === 0);

// Which mechanics a level uses (for intro cards and the level list).
export function mechanicsOf(L) {
  const m = [];
  if (L.knots.length) m.push('knot');
  if (L.pins.length) m.push('pin');
  if (L.strands.some((s) => s.c2)) m.push('variegated');
  if (L.strands.some((s) => s.q)) m.push('buried');
  if (L.slots < 5) m.push('rack4');
  return m;
}

// The dependency graph has no cycle (over, pins and knots together), so some
// pull order always exists if the rack had room for everything.
export function acyclic(L) {
  const rep = (i) => groupOf(L, i)[0];
  const deps = new Map();
  for (let i = 0; i < L.n; i++) {
    const r = rep(i);
    if (!deps.has(r)) deps.set(r, new Set());
    for (const j of L.over[i]) if (rep(j) !== r) deps.get(r).add(rep(j));
    if (L.pinBy[i] >= 0 && rep(L.pinBy[i]) !== r) deps.get(r).add(rep(L.pinBy[i]));
  }
  const state = new Map();
  const visit = (r) => {
    if (state.get(r) === 2) return true;
    if (state.get(r) === 1) return false;
    state.set(r, 1);
    for (const d of deps.get(r)) if (!visit(d)) return false;
    state.set(r, 2);
    return true;
  };
  for (const r of deps.keys()) if (!visit(r)) return false;
  return true;
}

// ---------- state ----------

export function newState(L) {
  return { v: VERSION, level: L.id, out: Array(L.n).fill(0), rack: Array(L.slots).fill(null), skeins: [], extra: 0, moves: 0 };
}
const clone = (s) => ({ ...s, out: s.out.slice(), rack: s.rack.map((x) => (x ? { ...x } : null)), skeins: s.skeins.slice() });

export const isDone = (s) => s.out.every(Boolean);
export const remaining = (s) => s.out.reduce((a, x) => a + (x ? 0 : 1), 0);
// Strands still in the heap that lie over strand i.
export const coveredBy = (L, s, i) => L.over[i].filter((j) => !s.out[j]);
export const isUncovered = (L, s, i) => !s.out[i] && L.over[i].every((j) => s.out[j]);
export const isPinned = (L, s, i) => L.pinBy[i] >= 0 && !s.out[L.pinBy[i]];
// What shows: a buried strand looks gray until it is uncovered.
export const showsColor = (L, s, i) => !L.strands[i].q || isUncovered(L, s, i);

// The order a pull's lengths wind on, or null if the rack has no room.
// cnt: lengths of each color wound so far; cap: rack places.
function windOrder(cnt, cap, units) {
  const occ0 = Object.keys(cnt).filter((c) => cnt[c] % SPOOL !== 0).length;
  const tryOrder = (order) => {
    const k = { ...cnt };
    let occ = occ0;
    for (const u of order) {
      const c = u.c;
      const had = (k[c] || 0) % SPOOL !== 0;
      if (!had) { if (occ >= cap) return false; occ++; }
      k[c] = (k[c] || 0) + 1;
      if (k[c] % SPOOL === 0) occ--;
    }
    return true;
  };
  const first = units.slice().sort((a, b) => ((cnt[a.c] || 0) % SPOOL ? 0 : 1) - ((cnt[b.c] || 0) % SPOOL ? 0 : 1));
  if (tryOrder(first)) return first;
  if (units.length < 2) return null;
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  for (const p of perms(units)) if (tryOrder(p)) return p;
  return null;
}
const countsOf = (s) => {
  const cnt = {};
  for (const x of s.rack) if (x) cnt[x.c] = x.n;
  return cnt;
};
const unitsOf = (L, g) => g.flatMap((m) => colorsOf(L, m).map((c) => ({ m, c })));

/**
 * whyNot(L, s, i) -> null if strand i can be pulled now, else
 *   { reason: 'gone' | 'covered' | 'pinned' | 'rack', blockers, pins, colors, group }
 * covered: blockers = strands lying over i or its knot partner.
 * pinned: pins = the strands whose pins still hold the group.
 * rack: colors = the colors that would need a new spool.
 */
export function whyNot(L, s, i) {
  const g = groupOf(L, i);
  if (g.some((m) => s.out[m])) return { reason: 'gone', group: g, blockers: [], pins: [], colors: [] };
  const blockers = [];
  for (const m of g) for (const j of coveredBy(L, s, m)) if (!g.includes(j) && !blockers.includes(j)) blockers.push(j);
  if (blockers.length) return { reason: 'covered', group: g, blockers, pins: [], colors: [] };
  const pins = g.filter((m) => isPinned(L, s, m)).map((m) => L.pinBy[m]);
  if (pins.length) return { reason: 'pinned', group: g, blockers: [], pins, colors: [] };
  const cnt = countsOf(s);
  const units = unitsOf(L, g);
  if (!windOrder(cnt, s.rack.length, units)) {
    const colors = [...new Set(units.map((u) => u.c).filter((c) => !cnt[c]))];
    return { reason: 'rack', group: g, blockers: [], pins: [], colors };
  }
  return null;
}
export const canPull = (L, s, i) => whyNot(L, s, i) === null;

/**
 * pull(L, s, i) -> { ok, state, events, group } or { ok: false, ...whyNot }
 * events, in winding order: { m, c, slot, n, fresh, popped }
 *   m: the strand, c: the color length, slot: rack place, n: the spool's count
 *   after it, fresh: a new spool was started, popped: the spool completed.
 */
export function pull(L, s, i) {
  const why = whyNot(L, s, i);
  if (why) return { ok: false, ...why, state: s };
  const g = groupOf(L, i);
  const t = clone(s);
  const order = windOrder(countsOf(s), s.rack.length, unitsOf(L, g));
  const events = [];
  for (const u of order) {
    let k = t.rack.findIndex((x) => x && x.c === u.c);
    let fresh = false;
    if (k < 0) { k = t.rack.findIndex((x) => !x); t.rack[k] = { c: u.c, n: 0 }; fresh = true; }
    t.rack[k].n++;
    const n = t.rack[k].n;
    const popped = n >= SPOOL;
    if (popped) { t.rack[k] = null; t.skeins.push(u.c); }
    events.push({ m: u.m, c: u.c, slot: k, n, fresh, popped });
  }
  for (const m of g) t.out[m] = 1;
  t.moves++;
  return { ok: true, state: t, events, group: g };
}

// One representative per pullable group (its lowest index), in index order.
export function legalPulls(L, s) {
  const out = [];
  for (let i = 0; i < L.n; i++) {
    if (s.out[i] || groupOf(L, i)[0] !== i) continue;
    if (canPull(L, s, i)) out.push(i);
  }
  return out;
}
export const isStuck = (L, s) => !isDone(s) && legalPulls(L, s).length === 0;
export const canNudge = (s) => s.extra < NUDGES;
export function nudge(s) {
  if (!canNudge(s)) return s;
  const t = clone(s);
  t.extra++;
  t.rack.push(null);
  return t;
}

// ---------- undo: a tiny pure history ----------

export const newGame = (L) => ({ state: newState(L), past: [] });
export function play(L, g, i) {
  const r = pull(L, g.state, i);
  if (!r.ok) return { ok: false, game: g, why: r };
  return { ok: true, game: { state: r.state, past: [...g.past, g.state] }, events: r.events, group: r.group };
}
export function playNudge(g) {
  if (!canNudge(g.state)) return g;
  return { state: nudge(g.state), past: [...g.past, g.state] };
}
export function undo(g) {
  if (!g.past.length) return g;
  return { state: g.past[g.past.length - 1], past: g.past.slice(0, -1) };
}
export function replay(L, moves, s = newState(L)) {
  for (const m of typeof moves === 'string' ? moves.split(/\s+/).filter(Boolean).map(Number) : moves) {
    const r = pull(L, s, m);
    if (!r.ok) throw new Error(`${L.id}: pull ${m} is not legal (${r.reason})`);
    s = r.state;
  }
  return s;
}

// ---------- a fast simulator for the solver and the bots ----------
// The rack is fully described by how many lengths of each color have wound on
// (a color has a spool on the rack when its count is not a multiple of SPOOL),
// so a position is just the set of strands pulled.

function simOf(L, s) {
  const ci = Object.fromEntries(L.colors.map((c, k) => [c, k]));
  const unitC = [];
  for (let i = 0; i < L.n; i++) unitC.push(colorsOf(L, i).map((c) => ci[c]));
  const cnt = L.colors.map(() => 0);
  for (let i = 0; i < L.n; i++) if (s.out[i]) for (const k of unitC[i]) cnt[k]++;
  const groups = [];
  for (let i = 0; i < L.n; i++) if (groupOf(L, i)[0] === i) groups.push(groupOf(L, i));
  const gUnits = groups.map((g) => g.flatMap((m) => unitC[m]));
  const gDeps = groups.map((g) => {
    const d = [];
    for (const m of g) { for (const j of L.over[m]) if (!g.includes(j)) d.push(j); if (L.pinBy[m] >= 0) d.push(L.pinBy[m]); }
    return d;
  });
  return { out: Uint8Array.from(s.out), cnt, cap: s.rack.length, groups, gUnits, gDeps, left: remaining(s) };
}
function simOcc(S) { let o = 0; for (const x of S.cnt) if (x % SPOOL) o++; return o; }
// Can group gi wind on now? Returns the number of spools it completes, or -1.
function simFits(S, gi, occ) {
  const u = S.gUnits[gi];
  const k = S.cnt.slice();
  const tryOrder = (order) => {
    let o = occ, pops = 0;
    const kk = k.slice();
    for (const c of order) {
      if (kk[c] % SPOOL === 0) { if (o >= S.cap) return -1; o++; }
      kk[c]++;
      if (kk[c] % SPOOL === 0) { o--; pops++; }
    }
    return pops;
  };
  const first = u.slice().sort((a, b) => (k[a] % SPOOL ? 0 : 1) - (k[b] % SPOOL ? 0 : 1));
  const r = tryOrder(first);
  if (r >= 0 || u.length < 2) return r;
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  for (const p of perms(u)) { const q = tryOrder(p); if (q >= 0) return q; }
  return -1;
}
function simLegal(S) {
  const occ = simOcc(S);
  const out = [];
  for (let gi = 0; gi < S.groups.length; gi++) {
    if (S.out[S.groups[gi][0]]) continue;
    let free = true;
    for (const d of S.gDeps[gi]) if (!S.out[d]) { free = false; break; }
    if (!free) continue;
    const pops = simFits(S, gi, occ);
    if (pops >= 0) out.push({ gi, pops });
  }
  return out;
}
function simApply(S, gi) { for (const m of S.groups[gi]) S.out[m] = 1; for (const c of S.gUnits[gi]) S.cnt[c]++; S.left -= S.groups[gi].length; }
function simRevert(S, gi) { for (const m of S.groups[gi]) S.out[m] = 0; for (const c of S.gUnits[gi]) S.cnt[c]--; S.left += S.groups[gi].length; }
const simKey = (S) => String.fromCharCode(...S.out);

// How promising a pull looks to a careful player: completing spools first,
// then adding to spools on the rack, opening new spools last.
function moveScore(S, gi) {
  let sc = 0;
  for (const c of S.gUnits[gi]) sc += S.cnt[c] % SPOOL ? 2 : -2;
  return sc;
}

/**
 * solve(L, s?, { cap }) -> { ok, path: [strand], nodes, exhausted }
 * Depth-first with memoized dead positions and a careful move order. `path`
 * lists one strand per pull (the lower index of a knotted pair).
 */
export function solve(L, s = newState(L), { cap = 400000 } = {}) {
  const S = simOf(L, s);
  const dead = new Set();
  const path = [];
  let nodes = 0;
  const STOP = {};
  const dfs = () => {
    if (S.left === 0) return true;
    if (++nodes > cap) throw STOP;
    const k = simKey(S);
    if (dead.has(k)) return false;
    const ms = simLegal(S);
    ms.sort((a, b) => b.pops - a.pops || moveScore(S, b.gi) - moveScore(S, a.gi) || a.gi - b.gi);
    for (const m of ms) {
      simApply(S, m.gi); path.push(S.groups[m.gi][0]);
      if (dfs()) return true;
      path.pop(); simRevert(S, m.gi);
    }
    dead.add(k);
    return false;
  };
  try {
    const ok = dfs();
    return { ok, path: ok ? path.slice() : [], nodes, exhausted: !ok };
  } catch (e) {
    if (e !== STOP) throw e;
    return { ok: false, path: [], nodes, exhausted: false };
  }
}

// ---------- the bots (for the difficulty table) ----------

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random player: any pull that is allowed right now, chosen uniformly.
export function randomPlayout(L, rng) {
  const S = simOf(L, newState(L));
  for (;;) {
    if (S.left === 0) return true;
    const ms = simLegal(S);
    if (!ms.length) return false;
    simApply(S, ms[Math.floor(rng() * ms.length)].gi);
  }
}
export function randomRate(L, seed = 1, runs = 200) {
  const rng = mulberry(seed);
  let ok = 0;
  for (let k = 0; k < runs; k++) if (randomPlayout(L, rng)) ok++;
  return ok / runs;
}

// A careful player with no lookahead: completes spools, then adds to spools,
// and opens a new spool for the color she can see the most of. With `blind`,
// she can't see the colors of buried (gray) strands.
export function carefulPlayout(L, rng, { blind = false } = {}) {
  const S = simOf(L, newState(L));
  const ci = Object.fromEntries(L.colors.map((c, k) => [c, k]));
  for (;;) {
    if (S.left === 0) return true;
    const ms = simLegal(S);
    if (!ms.length) return false;
    const seen = L.colors.map(() => 0);
    for (let i = 0; i < L.n; i++) {
      if (S.out[i]) continue;
      if (blind && L.strands[i].q && !L.over[i].every((j) => S.out[j])) continue;
      for (const c of colorsOf(L, i)) seen[ci[c]]++;
    }
    let best = null, bs = -Infinity;
    for (const m of ms) {
      let sc = m.pops * 10;
      for (const c of S.gUnits[m.gi]) sc += S.cnt[c] % SPOOL ? 5 : -6 + Math.min(4, seen[c]);
      sc += rng() * 1.5;
      if (sc > bs) { bs = sc; best = m; }
    }
    simApply(S, best.gi);
  }
}
export function carefulRate(L, seed = 1, runs = 100, opts = {}) {
  const rng = mulberry(seed);
  let ok = 0;
  for (let k = 0; k < runs; k++) if (carefulPlayout(L, rng, opts)) ok++;
  return ok / runs;
}

// Along a solution: how many other allowed pulls lead to a position with no
// way out (a quick proof by search). { traps, trapSteps, steps }
export function trapSurvey(L, solution, cap = 4000) {
  const moves = typeof solution === 'string' ? solution.split(/\s+/).filter(Boolean).map(Number) : solution;
  let s = newState(L), traps = 0, trapSteps = 0;
  for (const want of moves) {
    let here = 0;
    for (const m of legalPulls(L, s)) {
      if (m === want) continue;
      const r = solve(L, pull(L, s, m).state, { cap });
      if (!r.ok && r.exhausted) here++;
    }
    traps += here; if (here) trapSteps++;
    s = pull(L, s, want).state;
  }
  return { traps, trapSteps, steps: moves.length };
}

// ---------- hints ----------

// If the strands pulled so far are exactly a prefix of the stored solution,
// its next pull.
export function solutionStep(L, s, solution) {
  if (!solution) return null;
  const moves = solution.split(/\s+/).filter(Boolean).map(Number);
  const t = Array(L.n).fill(0);
  const same = () => t.every((x, k) => x === (s.out[k] ? 1 : 0));
  for (const m of moves) {
    if (same()) return canPull(L, s, m) ? m : null;
    for (const g of groupOf(L, m)) t[g] = 1;
  }
  return null;
}

/** hint -> { kind: 'pull', strand } | { kind: 'tangled' } | { kind: 'none' } */
export function hint(L, s, { cap = 60000, solution = L.solution } = {}) {
  if (isDone(s)) return { kind: 'none' };
  const known = solutionStep(L, s, solution);
  if (known !== null) return { kind: 'pull', strand: known };
  const r = solve(L, s, { cap });
  if (r.ok && r.path.length) return { kind: 'pull', strand: r.path[0] };
  if (r.exhausted) return { kind: 'tangled' };
  // out of search budget: the most careful-looking pull
  const S = simOf(L, s);
  const ms = simLegal(S).sort((a, b) => b.pops - a.pops || moveScore(S, b.gi) - moveScore(S, a.gi));
  return ms.length ? { kind: 'pull', strand: S.groups[ms[0].gi][0] } : { kind: 'tangled' };
}

// A short fingerprint of everything that shapes play, so a save made on an
// older version of a level is set aside instead of misread.
export function levelSig(L) {
  const src = JSON.stringify([L.slots, L.strands.map((s) => [s.c, s.c2, s.ctrl]), L.knots, L.pins]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------- what the skeins would knit up into ----------
// Each finished spool is a 50 g skein of worsted, about 100 yards. Yardages
// are typical for adult sizes in worsted weight.
export const YARDS_PER_SKEIN = 100;
const KNITS = [
  { min: 1, one: 'a headband', many: 'a striped headband' },
  { min: 2, one: 'a hat or a pair of mittens', many: 'a striped hat or a pair of colorwork mittens' },
  { min: 3, one: 'a cowl', many: 'a striped cowl' },
  { min: 4, one: 'a hat and a matching pair of mittens', many: 'a hat and mittens in stripes' },
  { min: 5, one: 'a cozy scarf', many: 'a striped scarf' },
  { min: 7, one: 'a sweater for a toddler', many: 'a striped sweater for a toddler' },
  { min: 9, one: 'a baby blanket', many: 'a striped baby blanket' },
  { min: 12, one: 'an adult sweater', many: 'a colorwork yoke sweater' },
];
export function knitsInto(skeins) {
  const n = skeins.length;
  const kinds = new Set(skeins).size;
  let pick = KNITS[0];
  for (const k of KNITS) if (n >= k.min) pick = k;
  const what = kinds >= 3 ? pick.many : pick.one;
  return { skeins: n, yards: n * YARDS_PER_SKEIN, what, line: `Enough for ${what}.` };
}
