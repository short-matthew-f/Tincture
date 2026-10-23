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
//   column, a jar that is not full lifts the exposed cell if it wants that color
//   (one cell per column per jar per pass). The next jar in the train reaches
//   that column a moment later and sees whatever is exposed by then.
// - A jar that fills is corked and leaves the belt for the shelf at the end of
//   the pass. Passes repeat until a pass lifts nothing; jars that found nothing
//   wait on the belt.
// - A belt jar can be parked on the bench (`bench` spots) and brought back.
// - No fail state. Stuck = no jar can lift and nothing more can go on the belt,
//   even after resting jars. The free nudge adds one bench spot, once per picture.
//
// THE EXTRA MECHANICS (each introduced on its own level, see levels.js)
// - Mystery jar ("?r5"): its color shows only when it reaches the front of its
//   lane. The rules ignore the "?"; it is a display rule only.
// - Linked jars ("r5=b3"): two jars tied with string go onto the belt together,
//   so they need two free belt places.
// - Mixing jar ("r3+o3"): one jar lifts two colors, a set amount of each. It is
//   full (and blends) when both parts are full.
// - Cloth (level `cover`: column numbers): a sheer cloth lies over a column, and
//   nothing lifts through it. It lifts away for good once a column beside it is
//   bare (fully lifted).
// - Key (level `locks`: [lane, row, col]): a lane is locked until the key cell
//   (row, col) of the picture has been lifted.

export const VERSION = 2;
export const NUDGES = 1; // free extra bench spots per picture

// ---------- level parsing ----------

// Rows are run-length strings ("s5 r2 s5" = five s, two r, five s) or literal
// runs of letters ("sssss rr sssss").
export function parseRow(str) {
  let out = '';
  for (const tok of str.trim().split(/\s+/)) {
    const m = /^([a-z])(\d*)$/.exec(tok);
    if (m) { out += m[1].repeat(m[2] ? +m[2] : 1); continue; }
    if (/^[a-z]+$/.test(tok)) { out += tok; continue; }
    throw new Error(`bad art token "${tok}"`);
  }
  return out;
}

// A jar token: optional "?" (mystery), color, capacity, optional "+color capacity" (mixing).
export function parseJar(tok) {
  const m = /^(\?)?([a-z])(\d+)(?:\+([a-z])(\d+))?$/.exec(tok);
  if (!m) throw new Error(`bad jar token "${tok}"`);
  const j = { c: m[2], cap: +m[3] };
  if (m[4]) {
    if (m[4] === m[2]) throw new Error(`mixing jar "${tok}" needs two colors`);
    j.c2 = m[4]; j.cap2 = +m[5];
  }
  if (m[1]) j.q = true;
  return j;
}
export const jarToken = (j) => `${j.q ? '?' : ''}${j.c}${j.cap}${j.c2 ? `+${j.c2}${j.cap2}` : ''}`;

// A lane string: units separated by spaces; a unit is one jar, or two tied with "=".
export function parseLane(str) {
  const out = [];
  for (const unit of str.trim().split(/\s+/).filter(Boolean)) {
    const parts = unit.split('=');
    if (parts.length > 2) throw new Error(`only two jars can be tied: "${unit}"`);
    parts.forEach((p, k) => { const j = parseJar(p); if (k === 0 && parts.length === 2) j.link = true; out.push(j); });
  }
  return out;
}
export function laneString(lane) {
  const out = [];
  for (let i = 0; i < lane.length; i++) {
    if (lane[i].link) { out.push(`${jarToken(lane[i])}=${jarToken(lane[i + 1])}`); i++; } else out.push(jarToken(lane[i]));
  }
  return out.join(' ');
}

// def: { id, name, noun, art: [rows], slots, bench, cover?: [cols], queues?: [lane strings], locks?: [[lane,row,col]] }
export function buildLevel(def) {
  const cells = def.art.map(parseRow);
  const H = cells.length, W = cells[0].length;
  cells.forEach((r, i) => { if (r.length !== W) throw new Error(`${def.id}: row ${i} is ${r.length} wide, expected ${W}`); });
  const counts = countCells(cells);
  const colors = Object.keys(counts);
  const lanes = (def.queues || []).map(parseLane);
  const cover = Array(W).fill(false);
  for (const c of def.cover || []) { if (c < 0 || c >= W) throw new Error(`${def.id}: cloth column ${c}`); cover[c] = true; }
  const locks = lanes.map(() => null);
  for (const [i, r, c] of def.locks || []) {
    if (!lanes[i] || r < 0 || r >= H || c < 0 || c >= W) throw new Error(`${def.id}: bad lock ${i},${r},${c}`);
    locks[i] = { r, c };
  }
  return {
    id: def.id, name: def.name, noun: def.noun || def.name.toLowerCase(),
    W, H, cells, colors, counts, lanes, cover, locks,
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
  for (const lane of lanes) for (const j of lane) {
    out[j.c] = (out[j.c] || 0) + j.cap;
    if (j.c2) out[j.c2] = (out[j.c2] || 0) + j.cap2;
  }
  return out;
}

export function capacitiesMatch(L) {
  const cap = capacityByColor(L.lanes);
  const keys = new Set([...Object.keys(cap), ...Object.keys(L.counts)]);
  for (const k of keys) if ((cap[k] || 0) !== (L.counts[k] || 0)) return false;
  return true;
}

// Which mechanics a level uses (for intro cards and the gallery).
export function mechanicsOf(L) {
  const out = new Set();
  for (const lane of L.lanes) for (const j of lane) {
    if (j.q) out.add('mystery');
    if (j.link) out.add('linked');
    if (j.c2) out.add('mixing');
  }
  if (L.cover.some(Boolean)) out.add('cloth');
  if (L.locks.some(Boolean)) out.add('key');
  return out;
}

// ---------- state ----------

const cloneJar = (j) => ({ ...j });
const clone = (s) => ({
  ...s, h: s.h.slice(), lp: s.lp.slice(),
  belt: s.belt.map(cloneJar), bench: s.bench.map(cloneJar), shelf: s.shelf.slice(),
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

// A cloth lies on this column right now.
export const isCovered = (L, s, col) => !!L.cover[col] && s.h[col] > 0 &&
  !((col > 0 && s.h[col - 1] === 0) || (col < L.W - 1 && s.h[col + 1] === 0));
// The color a jar could lift from this column right now (null under a cloth).
export const openColor = (L, s, col) => (s.h[col] > 0 && !isCovered(L, s, col) ? L.cells[s.h[col] - 1][col] : null);

export function exposedCounts(L, s) {
  const out = {};
  for (let c = 0; c < L.W; c++) { const k = openColor(L, s, c); if (k) out[k] = (out[k] || 0) + 1; }
  return out;
}

export const jarFull = (j) => j.n >= j.cap && (!j.c2 || j.n2 >= j.cap2);
export const jarWants = (j, k) => (k === j.c && j.n < j.cap) || (!!j.c2 && k === j.c2 && j.n2 < j.cap2);
export const jarSize = (j) => j.cap + (j.cap2 || 0);
export const jarFill = (j) => j.n + (j.n2 || 0);
export const jarColors = (j) => (j.c2 ? [j.c, j.c2] : [j.c]);

export const frontJar = (L, s, lane) => L.lanes[lane][s.lp[lane]] || null;
export const laneLeft = (L, s, lane) => L.lanes[lane].length - s.lp[lane];
export const laneOpen = (L, s, lane) => { const k = L.locks[lane]; return !k || s.h[k.c] <= k.r; };
// How many jars the lane's front unit puts on the belt (2 when tied).
export const unitSize = (L, s, lane) => { const f = frontJar(L, s, lane); return f ? (f.link ? 2 : 1) : 0; };
export const frontUnit = (L, s, lane) => L.lanes[lane].slice(s.lp[lane], s.lp[lane] + unitSize(L, s, lane));

// Would this jar lift something right now? (a jar object, or a plain color)
export function canLift(L, s, j) {
  const jar = typeof j === 'string' ? { c: j, cap: 1, n: 0 } : { n: 0, n2: 0, ...j };
  for (let col = 0; col < L.W; col++) { const k = openColor(L, s, col); if (k && jarWants(jar, k)) return true; }
  return false;
}

// ---------- the belt ----------

const beltJar = (id, j) => (j.c2 ? { id, c: j.c, cap: j.cap, n: 0, c2: j.c2, cap2: j.cap2, n2: 0 } : { id, c: j.c, cap: j.cap, n: 0 });
const shelfJar = (j) => (j.c2 ? { id: j.id, c: j.c, cap: j.cap, c2: j.c2, cap2: j.cap2 } : { id: j.id, c: j.c, cap: j.cap });

// Runs passes until one lifts nothing. Mutates s. Returns the events for the
// animation: [{ lifts: [{ id, col, row, c, tick }], filled: [id] }].
function settleInPlace(L, s) {
  const passes = [];
  for (let guard = 0; guard < 100000; guard++) {
    const lifts = [], filled = [];
    for (let k = 0; k < s.belt.length; k++) {
      const j = s.belt[k];
      for (let col = 0; col < L.W && !jarFull(j); col++) {
        const x = openColor(L, s, col);
        if (!x) continue;
        if (x === j.c && j.n < j.cap) j.n++;
        else if (j.c2 && x === j.c2 && j.n2 < j.cap2) j.n2++;
        else continue;
        s.h[col]--;
        lifts.push({ id: j.id, col, row: s.h[col], c: x, tick: col + k });
        if (jarFull(j)) filled.push(j.id);
      }
    }
    if (!lifts.length) break;
    if (filled.length) {
      for (const id of filled) s.shelf.push(shelfJar(s.belt.find((x) => x.id === id)));
      s.belt = s.belt.filter((j) => !jarFull(j));
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

// Moves: { t: 'place', i } lane i's front jar (or tied pair) to the belt;
// { t: 'park', i } belt jar i to the bench; { t: 'unpark', i } bench jar i back.
export function legalMoves(L, s) {
  const out = [];
  if (isDone(s)) return out;
  const free = L.slots - s.belt.length;
  for (let i = 0; i < L.lanes.length; i++) {
    const k = unitSize(L, s, i);
    if (k && k <= free && laneOpen(L, s, i)) out.push({ t: 'place', i });
  }
  if (free > 0) for (let i = 0; i < s.bench.length; i++) out.push({ t: 'unpark', i });
  if (s.bench.length < benchCap(L, s)) for (let i = 0; i < s.belt.length; i++) out.push({ t: 'park', i });
  return out;
}

export function isLegal(L, s, m) {
  return legalMoves(L, s).some((x) => x.t === m.t && x.i === m.i);
}

// Why a move can't happen right now (for the UI's gentle explanation).
export function blockedReason(L, s, m) {
  if (m.t === 'place') {
    if (!frontJar(L, s, m.i)) return 'empty';
    if (!laneOpen(L, s, m.i)) return 'locked';
    const free = L.slots - s.belt.length;
    if (unitSize(L, s, m.i) > free) return free > 0 ? 'tied' : 'belt';
  }
  if (m.t === 'unpark' && s.belt.length >= L.slots) return 'belt';
  if (m.t === 'park' && s.bench.length >= benchCap(L, s)) return 'bench';
  return null;
}

// The move itself, before the belt runs (the UI shows this, then animates).
export function stage(L, s, m) {
  if (!isLegal(L, s, m)) throw new Error(`illegal move ${encodeMove(m)}`);
  const t = clone(s);
  t.moves++;
  if (m.t === 'place') {
    const n = unitSize(L, t, m.i);
    for (let k = 0; k < n; k++) {
      const p = t.lp[m.i];
      t.belt.push(beltJar(`${m.i}.${p}`, L.lanes[m.i][p]));
      t.lp[m.i]++;
    }
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

// Effective belt room if every belt jar that fits on the bench were rested.
const reachRoom = (L, s) => L.slots - s.belt.length + Math.min(benchCap(L, s) - s.bench.length, s.belt.length);

// Stuck: nothing can lift, and nothing new can reach the belt, even after resting jars.
export function isStuck(L, s) {
  if (isDone(s)) return false;
  if (s.belt.some((j) => canLift(L, s, j))) return false;
  const room = reachRoom(L, s);
  if (room >= 1 && s.bench.some((j) => canLift(L, s, j))) return false;
  for (let i = 0; i < L.lanes.length; i++) {
    const k = unitSize(L, s, i);
    if (k && laneOpen(L, s, i) && k <= room) return false;
  }
  return true;
}

// The free nudge: one more bench spot for this picture, once.
export const canNudge = (s) => s.extra < NUDGES;
export function nudge(s) {
  if (!canNudge(s)) return s;
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
  if (!canNudge(g.state)) return g;
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

const jarKey = (j) => `${j.c}${j.cap}.${j.n}${j.c2 ? `+${j.c2}${j.cap2}.${j.n2}` : ''}`;
// Position only: the spare bench spot is left out, so a hint still finds its
// place on the stored solution after a nudge.
export function stateKey(s) {
  return `${s.h.join('.')}|${s.lp.join('.')}|${s.belt.map(jarKey).join(',')}|${s.bench.map(jarKey).sort().join(',')}`;
}

// Moves worth searching. Parking only when the belt can't take a lane's front
// unit (parking with room to spare never helps); a bench jar only comes back if
// it can lift right away or the lanes are all set out.
function searchMoves(L, s, prune) {
  const all = legalMoves(L, s);
  if (!prune) return all;
  const free = L.slots - s.belt.length;
  let tight = free === 0;
  for (let i = 0; i < L.lanes.length && !tight; i++) if (laneOpen(L, s, i) && unitSize(L, s, i) > free) tight = true;
  const lanesLeft = s.lp.some((p, i) => p < L.lanes[i].length);
  return all.filter((m) => {
    if (m.t === 'park') return tight;
    if (m.t === 'unpark') return !lanesLeft || canLift(L, s, s.bench[m.i]);
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

// The fewest parks any clear needs (uniform cost on parks, best-first inside a
// cost layer). { parks, exact }: exact=false when the node cap ran out first.
export function minParks(L, s = newState(L), cap = 60000) {
  const best = new Map([[stateKey(s), 0]]);
  const heap = new Heap();
  let nodes = 0, seq = 0;
  heap.push({ s, p: 0, f: 0 });
  while (heap.size) {
    const n = heap.pop();
    if (best.get(stateKey(n.s)) < n.p) continue;
    if (isDone(n.s)) return { parks: n.p, exact: true, nodes };
    if (++nodes > cap) return { parks: null, exact: false, nodes };
    for (const m of searchMoves(L, n.s, true)) {
      const ns = apply(L, n.s, m).state;
      const p = n.p + (m.t === 'park' ? 1 : 0);
      const k = stateKey(ns);
      if (best.has(k) && best.get(k) <= p) continue;
      best.set(k, p);
      heap.push({ s: ns, p, f: p * 1e6 + remaining(ns) * 4 + (seq++) * 1e-9 });
    }
  }
  return { parks: Infinity, exact: true, nodes };
}

// For each legal first move: does a clear still exist after it?
// { total, losing, unknown }: losing = proved unwinnable (no nudge).
export function firstMoveSurvey(L, cap = 40000, retryCap = 0) {
  const s0 = newState(L);
  let losing = 0, unknown = 0;
  const ms = legalMoves(L, s0);
  for (const m of ms) {
    let r = solve(L, apply(L, s0, m).state, { cap });
    if (!r.ok && !r.exhausted && retryCap > cap) r = solve(L, apply(L, s0, m).state, { cap: retryCap });
    if (r.ok) continue;
    if (r.exhausted) losing++; else unknown++;
  }
  return { total: ms.length, losing, unknown };
}

// Traps along a solution: at each step, the other legal moves that a quick
// search proves leave no clear. { traps, steps, trapSteps } (trapSteps = steps
// with at least one trap). A measure of how much lookahead the level asks for.
export function trapSurvey(L, solution, cap = 600) {
  const moves = (typeof solution === 'string' ? solution.split(/\s+/).filter(Boolean) : solution).map(decodeMove);
  let s = newState(L), traps = 0, trapSteps = 0;
  for (const want of moves) {
    let here = 0;
    for (const m of legalMoves(L, s)) {
      if (m.t === want.t && m.i === want.i) continue;
      const r = solve(L, apply(L, s, m).state, { cap });
      if (!r.ok && r.exhausted) here++;
    }
    traps += here; if (here) trapSteps++;
    s = apply(L, s, want).state;
  }
  return { traps, steps: moves.length, trapSteps };
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
export const MIX_CAPS = [3, 4, 5];
// A capacity for the next jar of a color with `rem` cells not yet promised to
// a jar. Never leaves a remainder of 1 or 2.
export function chooseCap(rem, rng, caps = CAPS) {
  const ok = caps.filter((c) => c <= rem && (rem - c === 0 || rem - c >= 3));
  if (rem <= 10 && !ok.includes(rem) && (rem >= 3 || !ok.length)) ok.push(rem);
  if (!ok.length) return rem;
  return pickWeighted(ok, ok.map((c) => c), rng); // bigger jars a bit more often
}

// How many cells of color c a lone jar could lift from here, letting the
// picture open up as it goes (cloth included).
export function reachable(L, s, c) {
  const t = { h: s.h.slice() };
  let n = 0;
  for (let again = true; again;) {
    again = false;
    for (let col = 0; col < L.W; col++) if (openColor(L, t, col) === c) { t.h[col]--; n++; again = true; }
  }
  return n;
}
// The biggest allowed capacity that a jar could fill right now, or null.
export function fitCap(rem, avail, caps = CAPS) {
  const ok = [...caps, Math.min(avail, Math.max(...caps))].filter((c) => c >= 3 && c <= avail && c <= rem && (rem - c === 0 || rem - c >= 3));
  if (rem <= avail && rem <= Math.max(...caps)) ok.push(rem);
  return ok.length ? Math.max(...ok) : null;
}

// An intended play order: jars are invented as the picture opens up, so the
// order is always playable (with the same parking). Returns
// { units: [[jar] | [jar, jar]], log: [{ r, c, u }] } (u = units placed before
// that cell lifted), or null if the bench overflowed.
// Options (chances per decision):
//   future: promise a jar to a color that is still buried (it waits: planning);
//   link:   tie two jars together (the second may be for a buried color);
//   mix:    make a mixing jar for two colors.
export function intendedOrder(L, rng, { caps = CAPS, future = 0, link = 0, mix = 0, fit = 0.75 } = {}) {
  const s = newState({ ...L, lanes: [] });
  const rem = { ...L.counts };
  const units = [], log = [], acts = [];
  let id = 0;
  const wanted = (c) => s.belt.some((j) => jarWants(j, c)) || s.bench.some((j) => jarWants(j, c));
  const owed = (c) => s.belt.reduce((a, j) => a + (j.c === c ? j.cap - j.n : j.c2 === c ? j.cap2 - j.n2 : 0), 0);
  const avail = (c) => reachable(L, s, c) - owed(c);
  const put = (jars) => { acts.push({ t: 'place', u: units.length }); units.push(jars.map((j) => ({ ...j }))); for (const j of jars) s.belt.push(beltJar(`g${id++}`, j)); };
  const make = (c, force = false) => {
    let cap = null;
    if (force || rng() < fit) cap = fitCap(rem[c], avail(c), caps);
    if (!cap) cap = chooseCap(rem[c], rng, caps);
    rem[c] -= cap;
    return { c, cap };
  };
  for (let step = 0; step < 5000; step++) {
    for (const p of settleInPlace(L, s)) for (const x of p.lifts) log.push({ r: x.row, c: x.col, u: units.length });
    if (isDone(s)) return { units, log, acts };
    const room = L.slots - s.belt.length;
    const bi = s.bench.findIndex((j) => canLift(L, s, j));
    if (room && bi >= 0) { acts.push({ t: 'unpark', i: bi }); s.belt.push(s.bench.splice(bi, 1)[0]); continue; }
    const ex = exposedCounts(L, s);
    const cand = Object.keys(ex).filter((c) => rem[c] > 0);
    const buried = Object.keys(rem).filter((c) => rem[c] > 0 && !ex[c] && !wanted(c));
    const any = Object.keys(rem).filter((c) => rem[c] > 0);
    // Jars already waiting; keep headroom so the intended order never jams.
    const waiting = s.belt.length + s.bench.length;
    const calm = waiting <= L.slots + L.bench - 3;
    if (calm && room >= 2 && cand.length && any.length && rng() < link) {
      const c = pickWeighted(cand, cand.map((k) => ex[k]), rng);
      const a = make(c);
      const rest = Object.keys(rem).filter((k) => rem[k] > 0);
      if (rest.length) {
        const bur = buried.filter((k) => rem[k] > 0);
        const pool = bur.length && rng() < 0.5 ? bur : rest;
        const b = make(pickWeighted(pool, pool.map((k) => rem[k]), rng));
        put([{ ...a, link: true }, b]);
      } else put([a]);
      continue;
    }
    if (calm && room >= 2 && buried.length && rng() < future) {
      put([make(pickWeighted(buried, buried.map((k) => rem[k]), rng))]);
      continue;
    }
    if (room && cand.length) {
      const c = pickWeighted(cand, cand.map((k) => ex[k] + Math.min(20, avail(k)) / 4), rng);
      const others = any.filter((k) => k !== c && rem[k] >= 3);
      let mixed = null;
      if (others.length && rem[c] >= 3 && rng() < mix) {
        const c2 = pickWeighted(others, others.map((k) => (ex[k] ? 2 : 1) * rem[k]), rng);
        const f1 = calm ? chooseCap(rem[c], rng, MIX_CAPS) : fitCap(rem[c], avail(c), MIX_CAPS);
        const f2 = calm ? chooseCap(rem[c2], rng, MIX_CAPS) : fitCap(rem[c2], avail(c2), MIX_CAPS);
        if (f1 && f2) { rem[c] -= f1; rem[c2] -= f2; mixed = { c, cap: f1, c2, cap2: f2 }; }
      }
      put([mixed || make(c, !calm)]);
      continue;
    }
    if (!room && s.bench.length < L.bench) { acts.push({ t: 'park', i: 0 }); s.bench.push(s.belt.shift()); continue; }
    return null;
  }
  return null;
}

// Deal ordered units into lanes. Each lane keeps the relative order, so the
// intended order stays playable by construction. Locked lanes (the last
// `locks` lanes) only take units from `lockFrom` on.
export function dealLanes(units, lanes, rng, { locks = 0, lockFrom = 0 } = {}) {
  const out = Array.from({ length: lanes }, () => []);
  const first = Array(lanes).fill(-1);
  const laneOf = [];
  units.forEach((u, idx) => {
    const ok = [...out.keys()].filter((i) => i < lanes - locks || idx >= lockFrom);
    const lens = ok.map((i) => out[i].length);
    const min = Math.min(...lens);
    const w = ok.map((i, k) => {
      const base = lens[k] === min ? 3 : lens[k] === min + 1 ? 1.5 : 0.4;
      return i >= lanes - locks && !out[i].length ? base * 3 : base;
    });
    const i = pickWeighted(ok, w, rng);
    if (first[i] < 0) first[i] = idx;
    laneOf.push(i);
    out[i].push(...u);
  });
  return { lanes: out, first, laneOf };
}

// Choose the key cell for a lane whose first unit is number `t` in the
// intended order: the latest cell lifted before that unit went on.
export function chooseKey(log, t, rng) {
  const before = log.filter((x) => x.u <= t);
  if (!before.length) return null;
  const u = before[before.length - 1].u;
  const last = before.filter((x) => x.u === u);
  return pick(last, rng);
}

// opts: lanes, seed, caps, future, link, mix, mystery, locks.
export function generateQueues(L, { lanes, seed, caps = CAPS, future = 0, link = 0, mix = 0, mystery = 0, locks = 0 }) {
  for (let k = 0; k < 50; k++) {
    const rng = mulberry(seed * 1000 + k + 1);
    const io = intendedOrder(L, rng, { caps, future, link, mix });
    if (!io) continue;
    const lockFrom = Math.floor(io.units.length * (0.3 + rng() * 0.2));
    const dealt = dealLanes(io.units, lanes, rng, { locks, lockFrom });
    if (dealt.lanes.some((l) => !l.length)) continue;
    const lockList = [];
    for (let i = lanes - locks; i < lanes; i++) {
      const key = chooseKey(io.log, dealt.first[i], rng);
      if (key) lockList.push([i, key.r, key.c]);
    }
    if (lockList.length < locks) continue;
    if (mystery) {
      for (const lane of dealt.lanes) {
        for (let p = 1; p < lane.length; p++) {
          if (lane[p - 1].link) continue; // the second of a tied pair shows with its partner
          if (rng() < mystery) lane[p].q = true;
        }
      }
    }
    // The intended play, as moves: a solution by construction.
    const moves = io.acts.map((a) => (a.t === 'place' ? `L${dealt.laneOf[a.u]}` : encodeMove(a)));
    return { queues: dealt.lanes.map(laneString), locks: lockList, intended: io.units.reduce((a, u) => a + u.length, 0), moves };
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
    const lifts = (m) => (m.t === 'place' ? frontUnit(L, s, m.i).some((j) => canLift(L, s, j)) : m.t === 'unpark' ? canLift(L, s, s.bench[m.i]) : false);
    const good = ms.filter((m) => m.t !== 'park' && lifts(m));
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

// If this position lies on the stored solution, its next move.
export function solutionStep(L, s, solution) {
  if (!solution) return null;
  const moves = solution.split(/\s+/).filter(Boolean);
  const target = stateKey(s);
  let t = newState(L);
  for (let i = 0; i < moves.length; i++) {
    if (t.moves === s.moves && stateKey(t) === target) return decodeMove(moves[i]);
    if (t.moves > s.moves) return null;
    t = apply(L, t, decodeMove(moves[i])).state;
  }
  return null;
}

// The next move toward a clear picture, or a gentle fallback.
export function hint(L, s, cap = 20000, solution = L.solution) {
  if (isDone(s)) return { kind: 'none' };
  const known = solutionStep(L, s, solution);
  if (known) return { kind: 'solution', move: known };
  const r = solve(L, s, { cap });
  if (r.ok && r.path.length) return { kind: 'solution', move: decodeMove(r.path[0]), length: r.path.length };
  // Only call it tangled when the unpruned search agrees.
  if (r.exhausted && solve(L, s, { cap, prune: false }).exhausted) return { kind: 'tangled' };
  // Fallback: a jar that can lift right now.
  for (const m of legalMoves(L, s)) {
    const ok = m.t === 'place' ? frontUnit(L, s, m.i).some((j) => canLift(L, s, j)) : m.t === 'unpark' ? canLift(L, s, s.bench[m.i]) : false;
    if (ok) return { kind: 'lift', move: m };
  }
  return { kind: 'none' };
}

// A short fingerprint of everything that shapes play, so a save made on an
// older version of a picture is set aside instead of misread.
export function levelSig(L) {
  const src = JSON.stringify([L.cells, L.lanes.map(laneString), L.locks, L.cover, L.slots, L.bench]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
