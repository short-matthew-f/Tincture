// puzzles/lift.js — The Lifting Table's rules (pure; ported from proto/lift/rules.js,
// play rules, solver and hint unchanged; 0.4.1 adds verdict, bestHint,
// guessMove and backToSolvableIndex to both copies). The authoring-time generator and the
// difficulty surveys (intendedOrder, generateQueues, casualRate, minParks, ...)
// stay in proto/lift/ with gen-levels.mjs; they are not shipped.
// No window/document/Date.now/Math.random. Colors are palette keys (one letter,
// see lift-levels.js); the save holds only ids, move strings and numbers.
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
// THE EXTRA MECHANICS (each introduced on its own level, see lift-levels.js)
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
// - Crock ("!r5"): a stoneware jar too heavy for the bench. Once on the belt it
//   stays there until it fills (it can never be parked).
// - Left out (level `left`: jar tokens): jars already resting on the bench when
//   the painting starts. Bring each back to the belt when its color shows.

export const VERSION = 2;
export const NUDGES = 1; // free extra bench spots per picture

// ---------- level parsing ----------

// Rows are run-length strings ("s5 r2 s5" = five s, two r, five s), literal
// runs of letters ("sssss rr sssss"), or both run together ("s5r2s5", "s3rrs2":
// a letter, then how many of it when more than one).
export function parseRow(str) {
  let out = '';
  for (const tok of str.trim().split(/\s+/)) {
    if (!/^(?:[a-z]\d*)+$/.test(tok)) throw new Error(`bad art token "${tok}"`);
    for (const m of tok.matchAll(/([a-z])(\d*)/g)) out += m[1].repeat(m[2] ? +m[2] : 1);
  }
  return out;
}
// The compact form of a row: each run as its letter, plus its length when over 1.
export function rowString(row) {
  let out = '';
  for (let i = 0; i < row.length;) {
    let j = i + 1;
    while (j < row.length && row[j] === row[i]) j++;
    out += row[i] + (j - i > 1 ? j - i : '');
    i = j;
  }
  return out;
}

// A jar token: optional "?" (mystery), optional "!" (a crock), color, capacity,
// optional "+color capacity" (mixing).
export function parseJar(tok) {
  const m = /^(\?)?(!)?([a-z])(\d+)(?:\+([a-z])(\d+))?$/.exec(tok);
  if (!m) throw new Error(`bad jar token "${tok}"`);
  const j = { c: m[3], cap: +m[4] };
  if (m[5]) {
    if (m[5] === m[3]) throw new Error(`mixing jar "${tok}" needs two colors`);
    j.c2 = m[5]; j.cap2 = +m[6];
  }
  if (m[1]) j.q = true;
  if (m[2]) j.heavy = true;
  return j;
}
export const jarToken = (j) => `${j.q ? '?' : ''}${j.heavy ? '!' : ''}${j.c}${j.cap}${j.c2 ? `+${j.c2}${j.cap2}` : ''}`;

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

// def: { id, name, noun, art: [rows], slots, bench, cover?: [cols], queues?: [lane strings], locks?: [[lane,row,col]], left?: [jar tokens] }
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
  const left = (def.left || []).map((t) => {
    const j = parseJar(t);
    if (j.q) throw new Error(`${def.id}: a jar left on the bench always shows its color`);
    return j;
  });
  const bench = def.bench ?? 3;
  if (left.length > bench) throw new Error(`${def.id}: more jars left out than bench spots`);
  return {
    id: def.id, name: def.name, noun: def.noun || def.name.toLowerCase(),
    W, H, cells, colors, counts, lanes, cover, locks, left,
    slots: def.slots ?? 4, bench,
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
  const cap = capacityByColor([...L.lanes, L.left || []]);
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
    if (j.heavy) out.add('crock');
  }
  if (L.left && L.left.length) out.add('leftover');
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
    belt: [], bench: (L.left || []).map((j, k) => beltJar(`b.${k}`, j)), shelf: [],
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

function beltJar(id, j) {
  const out = j.c2 ? { id, c: j.c, cap: j.cap, n: 0, c2: j.c2, cap2: j.cap2, n2: 0 } : { id, c: j.c, cap: j.cap, n: 0 };
  if (j.heavy) out.heavy = true;
  return out;
}
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
  if (s.bench.length < benchCap(L, s)) for (let i = 0; i < s.belt.length; i++) if (!s.belt[i].heavy) out.push({ t: 'park', i });
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
  if (m.t === 'park' && s.belt[m.i] && s.belt[m.i].heavy) return 'crock';
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
const reachRoom = (L, s) => L.slots - s.belt.length + Math.min(benchCap(L, s) - s.bench.length, s.belt.filter((j) => !j.heavy).length);

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

const jarKey = (j) => `${j.heavy ? '!' : ''}${j.c}${j.cap}.${j.n}${j.c2 ? `+${j.c2}${j.cap2}.${j.n2}` : ''}`;
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

// ---------- dead ends, a hint that always answers, back to solvable (0.4.1) ----------
//
// verdict(L, s): 'solvable' | 'dead' | 'unknown'. Dead is only ever said when
// it is proved: the table is stuck, or both the pruned and the unpruned search
// ran out of positions. 'unknown' = the node cap was reached first.
// bestHint(L, s): never comes back empty while a move exists: the stored
// solution, the solver's first move, 'dead', or a sensible guess when the
// solver can't decide within its budget. backToSolvableIndex(L, states): the
// latest position in her history the rules can prove solvable.

export const HINT_CAP = 2500; // per search; a hint stays well under 300 ms on a phone
export const DEAD_CAP = 1200; // the after-every-move check
export const BACK_CAP = 2500; // per position while stepping back
export const BACK_BUDGET = 40000; // nodes for one "Back to solvable" walk

// The stored solution's positions, once per painting: stateKey|moves -> its next move.
const SOLUTION_KEYS = new WeakMap();
function solutionKeys(L, solution) {
  let m = SOLUTION_KEYS.get(L);
  if (m && m.solution === solution) return m.keys;
  const keys = new Map();
  if (solution) {
    let t = newState(L);
    for (const str of solution.split(/\s+/).filter(Boolean)) {
      keys.set(`${t.moves}|${stateKey(t)}`, str);
      t = apply(L, t, decodeMove(str)).state;
    }
  }
  SOLUTION_KEYS.set(L, { solution, keys });
  return keys;
}
// The next move of the stored solution when s lies on it (a memoized solutionStep).
export function onSolution(L, s, solution = L.solution) {
  const str = solutionKeys(L, solution).get(`${s.moves}|${stateKey(s)}`);
  return str ? decodeMove(str) : null;
}

export function verdict(L, s, { cap = DEAD_CAP, solution = L.solution } = {}) {
  if (isDone(s)) return 'solvable';
  if (isStuck(L, s)) return 'dead';
  if (onSolution(L, s, solution)) return 'solvable';
  const r = solve(L, s, { cap });
  if (r.ok) return 'solvable';
  if (!r.exhausted) return 'unknown';
  const u = solve(L, s, { cap, prune: false });
  return u.ok ? 'solvable' : u.exhausted ? 'dead' : 'unknown';
}

// How many cells sit below color k's lowest reachable cell, over the best column
// (0 = it shows on the bottom edge now; Infinity = not in the picture any more).
function depthOf(L, s, k) {
  let best = Infinity;
  for (let col = 0; col < L.W; col++) {
    for (let r = s.h[col] - 1, d = 0; r >= 0 && d < best; r--, d++) {
      if (L.cells[r][col] === k) { best = d + (isCovered(L, s, col) ? 0.5 : 0); break; }
    }
  }
  return best;
}
const jarDepth = (L, s, j) => Math.min(...jarColors(j).filter((k) => jarWants({ n: 0, n2: 0, ...j }, k)).map((k) => depthOf(L, s, k)), Infinity);

// A sensible next move when the solver can't decide: a jar that lifts now, else
// make room by resting the belt jar whose color is deepest, else the lane or
// bench jar whose color is nearest the bottom edge.
export function guessMove(L, s) {
  const moves = legalMoves(L, s);
  if (!moves.length) return null;
  for (const m of moves) {
    const ok = m.t === 'place' ? frontUnit(L, s, m.i).some((j) => canLift(L, s, j)) : m.t === 'unpark' ? canLift(L, s, s.bench[m.i]) : false;
    if (ok) return { kind: 'lift', move: m };
  }
  const brings = moves.filter((m) => m.t !== 'park');
  const score = (m) => (m.t === 'place' ? Math.min(...frontUnit(L, s, m.i).map((j) => jarDepth(L, s, j))) : jarDepth(L, s, s.bench[m.i]));
  if (brings.length) {
    let best = brings[0], bs = score(best);
    for (const m of brings.slice(1)) { const v = score(m); if (v < bs) { best = m; bs = v; } }
    if (bs < Infinity) return { kind: 'guess', move: best };
  }
  const parks = moves.filter((m) => m.t === 'park');
  if (parks.length) {
    let best = parks[0], bs = jarDepth(L, s, s.belt[best.i]);
    for (const m of parks.slice(1)) { const v = jarDepth(L, s, s.belt[m.i]); if (v > bs) { best = m; bs = v; } }
    return { kind: 'guess', move: best };
  }
  return { kind: 'guess', move: brings[0] || moves[0] };
}

// The hint the table shows: { kind: 'solution' | 'lift' | 'guess', move } | { kind: 'dead' } | { kind: 'none' } (done).
export function bestHint(L, s, { cap = HINT_CAP, solution = L.solution } = {}) {
  if (isDone(s)) return { kind: 'none' };
  const known = onSolution(L, s, solution);
  if (known) return { kind: 'solution', move: known };
  if (isStuck(L, s)) return { kind: 'dead' };
  const r = solve(L, s, { cap });
  if (r.ok && r.path.length) return { kind: 'solution', move: decodeMove(r.path[0]), length: r.path.length };
  if (r.exhausted) {
    const u = solve(L, s, { cap, prune: false });
    if (u.ok && u.path.length) return { kind: 'solution', move: decodeMove(u.path[0]), length: u.path.length };
    if (u.exhausted) return { kind: 'dead' };
  }
  return guessMove(L, s) || { kind: 'dead' };
}

// states[0..n-1] (states[0] the fresh painting) -> the largest index whose
// position is proved solvable: done, on the stored solution, or solved by the
// search. A spent node budget falls back to the latest position on the stored
// solution (the fresh painting at worst), so the answer is always true.
export function backToSolvableIndex(L, states, opts) {
  const it = backToSolvableSteps(L, states, opts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
// The same walk as a generator: it yields after each searched position (so a
// screen can spread the work over frames) and returns the index.
export function* backToSolvableSteps(L, states, { cap = BACK_CAP, budget = BACK_BUDGET, solution = L.solution } = {}) {
  let spent = 0;
  const fallback = () => {
    for (let i = states.length - 1; i > 0; i--) if (isDone(states[i]) || onSolution(L, states[i], solution)) return i;
    return 0;
  };
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i];
    if (isDone(s) || onSolution(L, s, solution)) return i;
    if (isStuck(L, s)) continue;
    if (spent >= budget) return fallback();
    const r = solve(L, s, { cap });
    spent += r.nodes;
    if (r.ok) return i;
    yield i;
  }
  return fallback();
}

// A short fingerprint of everything that shapes play, so a save made on an
// older version of a picture is set aside instead of misread.
export function levelSig(L) {
  const parts = [L.cells, L.lanes.map(laneString), L.locks, L.cover, L.slots, L.bench];
  if (L.left && L.left.length) parts.push(L.left.map(jarToken)); // only when used, so older signatures stay
  const src = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
