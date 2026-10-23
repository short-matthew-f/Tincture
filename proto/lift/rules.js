// The Lifting Table: pure rules. No window/document/Date.now/Math.random.
// Randomness (level generation, playouts) comes from an explicit seed.
// Colors are palette keys (one letter, see levels.js); the save holds only ids,
// numbers and those keys, never objects from content.
//
// THE RULES
// - A picture is a grid of colored cells, row 0 at the top. Paint lifts from the
//   bottom up, so a column is just a height: column c still holds rows
//   0..h[c]-1 and its lowest remaining cell (row h[c]-1) is "exposed".
// - Jars wait in supply lanes. Tapping a lane puts its front jar on the belt,
//   which has `slots` places. Belt order is the order the jars went on.
// - After every placement the belt runs. A pass is a little train of jars riding
//   left to right along the bottom edge, the oldest jar in front. Over each
//   column, a jar that is not full lifts the exposed cell if it is its color
//   (one cell per column per jar per pass). The next jar in the train reaches
//   that column a moment later and sees whatever is exposed by then.
// - A jar that fills is corked and leaves the belt for the shelf at the end of
//   the pass. Passes repeat until a pass lifts nothing; jars that found nothing
//   wait on the belt.
// - A belt jar can be parked on the bench (`bench` spots) and brought back.
// - No fail state. Stuck = belt full and bench full (after the belt settles no
//   belt jar can lift). The free nudge adds one bench spot for this picture.

export const VERSION = 1;

// ---------- level parsing ----------

// Rows are run-length strings: "s5 r2 s5" = five s, two r, five s.
export function parseRow(str) {
  let out = '';
  for (const tok of str.trim().split(/\s+/)) {
    const m = /^([a-z])(\d*)$/.exec(tok);
    if (!m) throw new Error(`bad art token "${tok}"`);
    out += m[1].repeat(m[2] ? +m[2] : 1);
  }
  return out;
}

export function parseJar(tok) {
  const m = /^([a-z])(\d+)$/.exec(tok);
  if (!m) throw new Error(`bad jar token "${tok}"`);
  return { c: m[1], cap: +m[2] };
}
export const jarToken = (j) => `${j.c}${j.cap}`;

// def: { id, name, noun, art: [rle rows], slots, bench, queues?: ["s10 o5 ...", ...] }
export function buildLevel(def) {
  const cells = def.art.map(parseRow);
  const H = cells.length, W = cells[0].length;
  cells.forEach((r, i) => { if (r.length !== W) throw new Error(`${def.id}: row ${i} is ${r.length} wide, expected ${W}`); });
  const counts = countCells(cells);
  const colors = Object.keys(counts);
  const lanes = (def.queues || []).map((q) => q.trim() ? q.trim().split(/\s+/).map(parseJar) : []);
  return {
    id: def.id, name: def.name, noun: def.noun || def.name.toLowerCase(),
    W, H, cells, colors, counts, lanes,
    slots: def.slots ?? 4, bench: def.bench ?? 3,
  };
}

export function countCells(cells) {
  const counts = {};
  for (const row of cells) for (const ch of row) counts[ch] = (counts[ch] || 0) + 1;
  return counts;
}

// Total jar capacity per color, from the lanes.
export function capacityByColor(lanes) {
  const out = {};
  for (const lane of lanes) for (const j of lane) out[j.c] = (out[j.c] || 0) + j.cap;
  return out;
}

export function capacitiesMatch(L) {
  const cap = capacityByColor(L.lanes);
  const keys = new Set([...Object.keys(cap), ...Object.keys(L.counts)]);
  for (const k of keys) if ((cap[k] || 0) !== (L.counts[k] || 0)) return false;
  return true;
}

// ---------- state ----------

const clone = (s) => ({
  ...s, h: s.h.slice(), lp: s.lp.slice(),
  belt: s.belt.map((j) => ({ ...j })), bench: s.bench.map((j) => ({ ...j })), shelf: s.shelf.slice(),
});

export function newState(L) {
  return {
    v: VERSION, level: L.id,
    h: Array(L.W).fill(L.H),
    lp: L.lanes.map(() => 0),
    belt: [], bench: [], shelf: [],
    extra: 0, moves: 0,
  };
}

export const benchCap = (L, s) => L.bench + s.extra;
export const remaining = (s) => s.h.reduce((a, b) => a + b, 0);
export const isDone = (s) => s.h.every((x) => x === 0);
export const exposedRow = (s, col) => s.h[col] - 1; // -1 when the column is clear
export const exposedColor = (L, s, col) => (s.h[col] > 0 ? L.cells[s.h[col] - 1][col] : null);
export const isLifted = (s, r, col) => r >= s.h[col];

export function exposedCounts(L, s) {
  const out = {};
  for (let c = 0; c < L.W; c++) { const k = exposedColor(L, s, c); if (k) out[k] = (out[k] || 0) + 1; }
  return out;
}

export const frontJar = (L, s, lane) => L.lanes[lane][s.lp[lane]] || null;
export const laneLeft = (L, s, lane) => L.lanes[lane].length - s.lp[lane];

// Would this jar lift something right now?
export const canLift = (L, s, c) => s.h.some((_, col) => exposedColor(L, s, col) === c);

// ---------- the belt ----------

// Runs passes until one lifts nothing. Mutates s. Returns the events for the
// animation: [{ lifts: [{ id, col, row, c, tick }], filled: [id] }].
function settleInPlace(L, s) {
  const passes = [];
  for (let guard = 0; guard < 100000; guard++) {
    const lifts = [], filled = [];
    s.belt.forEach((j, k) => {
      for (let col = 0; col < L.W && j.n < j.cap; col++) {
        if (s.h[col] > 0 && L.cells[s.h[col] - 1][col] === j.c) {
          s.h[col]--;
          j.n++;
          lifts.push({ id: j.id, col, row: s.h[col], c: j.c, tick: col + k });
          if (j.n === j.cap) filled.push(j.id);
        }
      }
    });
    if (!lifts.length) break;
    if (filled.length) {
      for (const id of filled) {
        const j = s.belt.find((x) => x.id === id);
        s.shelf.push({ id: j.id, c: j.c, cap: j.cap });
      }
      s.belt = s.belt.filter((j) => j.n < j.cap);
    }
    passes.push({ lifts, filled });
  }
  return passes;
}

export function settle(L, s) {
  const t = clone(s);
  const passes = settleInPlace(L, t);
  return { state: t, passes };
}

// Moves: { t: 'place', i } lane i's front jar to the belt; { t: 'park', i } belt
// jar i to the bench; { t: 'unpark', i } bench jar i back to the belt.
export function legalMoves(L, s) {
  const out = [];
  if (isDone(s)) return out;
  const beltRoom = s.belt.length < L.slots;
  if (beltRoom) for (let i = 0; i < L.lanes.length; i++) if (s.lp[i] < L.lanes[i].length) out.push({ t: 'place', i });
  if (beltRoom) for (let i = 0; i < s.bench.length; i++) out.push({ t: 'unpark', i });
  if (s.bench.length < benchCap(L, s)) for (let i = 0; i < s.belt.length; i++) out.push({ t: 'park', i });
  return out;
}

export function isLegal(L, s, m) {
  return legalMoves(L, s).some((x) => x.t === m.t && x.i === m.i);
}

// The move itself, before the belt runs (the UI shows this, then animates).
export function stage(L, s, m) {
  if (!isLegal(L, s, m)) throw new Error(`illegal move ${encodeMove(m)}`);
  const t = clone(s);
  t.moves++;
  if (m.t === 'place') {
    const j = L.lanes[m.i][t.lp[m.i]];
    t.belt.push({ id: `${m.i}.${t.lp[m.i]}`, c: j.c, cap: j.cap, n: 0 });
    t.lp[m.i]++;
  } else if (m.t === 'unpark') {
    t.belt.push(t.bench.splice(m.i, 1)[0]);
  } else if (m.t === 'park') {
    t.bench.push(t.belt.splice(m.i, 1)[0]);
  }
  return t;
}

export function apply(L, s, m) {
  const t = stage(L, s, m);
  const passes = m.t === 'park' ? [] : settleInPlace(L, t);
  return { state: t, passes };
}

// Stuck: belt and bench both full and nothing on the belt can lift.
export function isStuck(L, s) {
  if (isDone(s)) return false;
  if (s.belt.length < L.slots || s.bench.length < benchCap(L, s)) return false;
  return !s.belt.some((j) => canLift(L, s, j.c));
}

// The free nudge: one more bench spot for this picture.
export function nudge(s) {
  const t = clone(s);
  t.extra++;
  return t;
}

// ---------- undo (a tiny pure history) ----------

export const newGame = (L) => ({ state: newState(L), past: [] });
export function play(L, g, m) {
  const r = apply(L, g.state, m);
  return { game: { state: r.state, past: [...g.past, g.state] }, passes: r.passes };
}
export function playNudge(g) {
  return { state: nudge(g.state), past: [...g.past, g.state] };
}
export function undo(g) {
  if (!g.past.length) return g;
  return { state: g.past[g.past.length - 1], past: g.past.slice(0, -1) };
}

// ---------- move strings ----------

const T2C = { place: 'L', park: 'P', unpark: 'U' };
const C2T = { L: 'place', P: 'park', U: 'unpark' };
export const encodeMove = (m) => `${T2C[m.t]}${m.i}`;
export function decodeMove(str) {
  const m = /^([LPU])(\d+)$/.exec(str);
  if (!m) throw new Error(`bad move "${str}"`);
  return { t: C2T[m[1]], i: +m[2] };
}
export function replay(L, moves, s = newState(L)) {
  for (const str of (typeof moves === 'string' ? moves.split(/\s+/).filter(Boolean) : moves)) {
    s = apply(L, s, typeof str === 'string' ? decodeMove(str) : str).state;
  }
  return s;
}

// ---------- solver ----------

export function stateKey(s) {
  const belt = s.belt.map((j) => `${j.c}${j.cap}.${j.n}`).join(',');
  const bench = s.bench.map((j) => `${j.c}${j.cap}.${j.n}`).sort().join(',');
  return `${s.h.join('.')}|${s.lp.join('.')}|${belt}|${bench}|${s.extra}`;
}

// Moves worth searching. Parking only when the belt is full (parking with room
// to spare never helps); a bench jar only comes back if it can lift right away
// or the bench is the only source left.
function searchMoves(L, s, prune) {
  const all = legalMoves(L, s);
  if (!prune) return all;
  const full = s.belt.length >= L.slots;
  const lanesLeft = s.lp.some((p, i) => p < L.lanes[i].length);
  return all.filter((m) => {
    if (m.t === 'park') return full;
    if (m.t === 'unpark') return !lanesLeft || canLift(L, s, s.bench[m.i].c);
    return true;
  });
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= x.f) break; a[i] = a[p]; i = p; }
    a[i] = x;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const fm = () => (m === i ? last.f : a[m].f);
        if (l < a.length && a[l].f < fm()) m = l;
        if (r < a.length && a[r].f < fm()) m = r;
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

// Best-first search with memoized states and a node cap. With `bfs: true` the
// frontier is plain breadth-first, which gives shortest solutions on small
// boards. Returns { ok, path: ['L0', ...], nodes, exhausted }. `exhausted` with
// ok=false means the position is proved unsolvable (within the pruned moves).
export function solve(L, s = newState(L), { cap = 200000, bfs = false, weight = 4, prune = true } = {}) {
  const seen = new Set([stateKey(s)]);
  const start = { s, parent: null, m: null, g: 0 };
  const path = (n) => { const out = []; for (; n.parent; n = n.parent) out.push(encodeMove(n.m)); return out.reverse(); };
  if (isDone(s)) return { ok: true, path: [], nodes: 0, exhausted: false };
  let nodes = 0, seq = 0;
  const heap = new Heap();
  const score = (n) => (bfs ? n.g * 1e6 + seq : remaining(n.s) * weight + n.g + n.s.belt.length * 0.5 + seq * 1e-9);
  start.f = score(start); heap.push(start);
  while (heap.size) {
    const n = heap.pop();
    if (++nodes > cap) return { ok: false, path: [], nodes, exhausted: false };
    for (const m of searchMoves(L, n.s, prune)) {
      const ns = apply(L, n.s, m).state;
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      const child = { s: ns, parent: n, m, g: n.g + 1 };
      if (isDone(ns)) return { ok: true, path: path(child), nodes, exhausted: false };
      seq++;
      child.f = score(child);
      heap.push(child);
    }
  }
  return { ok: false, path: [], nodes, exhausted: true };
}

// ---------- generation (authoring time; see gen-levels.mjs) ----------

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
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function pickWeighted(items, weights, rng) {
  const tot = weights.reduce((a, b) => a + b, 0);
  let x = rng() * tot;
  for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x < 0) return items[i]; }
  return items[items.length - 1];
}

export const CAPS = [3, 5, 8, 10];
// A capacity for the next jar of a color with `rem` cells not yet promised to
// a jar. Never leaves a remainder of 1 or 2.
export function chooseCap(rem, rng, caps = CAPS) {
  const ok = caps.filter((c) => c <= rem && (rem - c === 0 || rem - c >= 3));
  if (rem <= 10 && !ok.includes(rem) && (rem >= 3 || !ok.length)) ok.push(rem);
  if (!ok.length) return rem;
  return pickWeighted(ok, ok.map((c) => c), rng); // bigger jars a bit more often
}

// An intended play order: jars are invented as the picture opens up, so the
// order is always playable (with the same parking). Returns the jar list in
// order, or null if the bench overflowed.
// `future` is the chance of promising a jar to a color that is still buried:
// it waits on the belt until the picture opens up, which is where the planning
// comes from.
export function intendedOrder(L, rng, { caps = CAPS, future = 0 } = {}) {
  const s = newState({ ...L, lanes: [] });
  const rem = { ...L.counts };
  const order = [];
  let id = 0;
  for (let step = 0; step < 5000; step++) {
    settleInPlace(L, s);
    if (isDone(s)) return order;
    const room = s.belt.length < L.slots;
    const bi = s.bench.findIndex((j) => canLift(L, s, j.c));
    if (room && bi >= 0) { s.belt.push(s.bench.splice(bi, 1)[0]); continue; }
    const ex = exposedCounts(L, s);
    const cand = Object.keys(ex).filter((c) => rem[c] > 0);
    const buried = Object.keys(rem).filter((c) => rem[c] > 0 && !ex[c] && !s.belt.some((j) => j.c === c));
    if (L.slots - s.belt.length >= 2 && buried.length && rng() < future) {
      const c = pickWeighted(buried, buried.map((k) => rem[k]), rng);
      const cap = chooseCap(rem[c], rng, caps);
      rem[c] -= cap;
      order.push({ c, cap });
      s.belt.push({ id: `g${id++}`, c, cap, n: 0 });
      continue;
    }
    if (room && cand.length) {
      const c = pickWeighted(cand, cand.map((k) => ex[k]), rng);
      const cap = chooseCap(rem[c], rng, caps);
      rem[c] -= cap;
      const j = { id: `g${id++}`, c, cap, n: 0 };
      order.push({ c, cap });
      s.belt.push(j);
      continue;
    }
    if (!room && s.bench.length < L.bench) { s.bench.push(s.belt.shift()); continue; }
    return null;
  }
  return null;
}

// Deal an ordered jar list into lanes. Each lane keeps the relative order, so
// the intended order stays playable by construction.
export function dealLanes(order, lanes, rng) {
  const out = Array.from({ length: lanes }, () => []);
  for (const j of order) {
    const lens = out.map((l) => l.length);
    const min = Math.min(...lens);
    const w = lens.map((n) => (n === min ? 3 : n === min + 1 ? 1.5 : 0.4));
    const i = pickWeighted([...out.keys()], w, rng);
    out[i].push(j);
  }
  return out.map((l) => l.map(jarToken).join(' '));
}

export function generateQueues(L, { lanes, seed, caps = CAPS, future = 0 }) {
  for (let k = 0; k < 50; k++) {
    const rng = mulberry(seed * 1000 + k + 1);
    const order = intendedOrder(L, rng, { caps, future });
    if (order) return { queues: dealLanes(order, lanes, rng), intended: order.length };
  }
  return null;
}

// A casual player: lifts right away when she can, otherwise taps something.
// Used to measure how much planning a layout needs. Returns true if cleared
// without a nudge.
export function casualPlayout(L, rng, maxSteps = 600) {
  let s = newState(L);
  for (let step = 0; step < maxSteps; step++) {
    if (isDone(s)) return true;
    const ms = legalMoves(L, s);
    if (!ms.length) return false;
    const colorOf = (m) => (m.t === 'place' ? L.lanes[m.i][s.lp[m.i]].c : m.t === 'unpark' ? s.bench[m.i].c : null);
    const good = ms.filter((m) => m.t !== 'park' && canLift(L, s, colorOf(m)));
    const adds = ms.filter((m) => m.t !== 'park');
    const parks = ms.filter((m) => m.t === 'park');
    const m = good.length ? pick(good, rng) : adds.length ? pick(adds, rng) : pick(parks, rng);
    s = apply(L, s, m).state;
  }
  return false;
}

export function casualRate(L, seed, runs = 100) {
  const rng = mulberry(seed);
  let ok = 0;
  for (let i = 0; i < runs; i++) if (casualPlayout(L, rng)) ok++;
  return ok / runs;
}

// ---------- hints ----------

// The next move toward a clear picture, or a gentle fallback.
export function hint(L, s, cap = 20000) {
  const r = solve(L, s, { cap });
  if (r.ok && r.path.length) return { kind: 'solution', move: decodeMove(r.path[0]), length: r.path.length };
  // Only call it tangled when the unpruned search agrees.
  if (r.exhausted && solve(L, s, { cap, prune: false }).exhausted) return { kind: 'tangled' };
  // Fallback: a jar that can lift right now.
  const ms = legalMoves(L, s);
  for (const m of ms) {
    const c = m.t === 'place' ? L.lanes[m.i][s.lp[m.i]].c : m.t === 'unpark' ? s.bench[m.i].c : null;
    if (c && canLift(L, s, c)) return { kind: 'lift', move: m };
  }
  return { kind: 'none' };
}
