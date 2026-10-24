// The Hoop: pure rules. No window/document/Date.now/Math.random.
// Everything random (bots, generation) takes an explicit rng or seed.
// The save holds only ids, peg numbers and color keys, never level objects.
//
// THE HOOP
// - A wooden hoop with n pegs evenly around it, numbered 0..n-1 clockwise
//   from the top. Each strand of yarn has two ends, each tied to a peg.
//   A peg holds at most one knot (a shared knot, below, is one knot).
// - Two strands CROSS if and only if their pegs interleave around the ring:
//   going clockwise from one end of A to its other end, exactly one end of B
//   lies strictly in between. Strands that share a peg never cross. This is
//   the whole rule; the drawing only bends the chords, and a single radial
//   warp keeps the picture's crossings exactly the rule's.
// - Every strand has an over/under height (z). A moved strand is laid down
//   on top of everything. Height is only for the picture until the
//   over-and-under levels, where it becomes a rule (below).
//
// THE MOVE
// - Pick up a knot and retie it on an EMPTY peg. Yarn needs room to lie
//   flat: a strand's two ends must stay at least `reach` pegs apart around
//   the hoop (3 by default: two pegs between them, either way round).
//
// COMING FREE (the freeing rule)
// - After every move, each strand that crosses nothing comes free at once:
//   it slips off its pegs and winds onto a skein, freeing both pegs.
//   (Strands tied into one shared knot come free together, once both cross
//   nothing.) Freeing never changes another strand's crossings, so one pass
//   finds everything that comes free.
//   Why per strand, not per color: see the notes in levels.js.
//
// THE MECHANICS (each introduced on its own level, see levels.js)
// - Stitched-down knot (`fixed`): that end never moves.
// - Painted peg (`pegs`): only yarn of that color may be tied there.
// - Shared knot (`links`): two strands tied into one knot on one peg. Lifting
//   it moves both ends together; each strand's far end moves on its own.
// - Over and under (`layering`): a strand may be lifted only while no strand
//   it crosses lies over it (a higher z). A shared knot needs both strands
//   clear on top.
// - Fewer spare pegs: a level parameter (empty pegs at the start).
//
// NO FAIL STATE: unlimited undo, a hint, and start over. A position that no
// longer has a way out is reported by the hint as tangled, never as lost.

export const VERSION = 1;
export const REACH = 3;

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

// ---------- the crossing rule ----------

/** Pegs apart around the hoop, the short way. */
export const cdist = (n, p, q) => { const d = (((p - q) % n) + n) % n; return Math.min(d, n - d); };
/** Is peg x strictly inside the clockwise run from a to b? */
export function inArc(n, a, b, x) {
  const ab = (((b - a) % n) + n) % n, ax = (((x - a) % n) + n) % n;
  return ax > 0 && ax < ab;
}
/** Do chords (a1,a2) and (b1,b2) cross? Shared pegs never cross. */
export function crosses(n, a1, a2, b1, b2) {
  if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) return false;
  return inArc(n, a1, a2, b1) !== inArc(n, a1, a2, b2);
}

// ---------- the picture ----------
// A strand is drawn as its straight chord pulled toward the center by phi (a
// blend of the straight chord and the hyperbolic one), then the whole disk
// turns by a gentle swirl. Both are one-to-one maps of the disk that keep
// the rim fixed, so with one shared slack every crossing in the picture is a
// crossing of the rule and nothing else. Each strand's own slack (taut when
// it crosses many) stays within [LAM_TAUT, LAM_SLACK], a range the tests
// check never adds or hides a crossing between strands on separate pegs.
// Strands that share a knot share one slack.
export const SWIRL = 0.32, LAM_SLACK = 0.7, LAM_TAUT = 0.2;
const phi = (r, l) => (1 - l) * r + (l * r) / (1 + Math.sqrt(Math.max(0, 1 - r * r)));
/** Unit-disk point (knots at radius 1) -> where it is drawn. */
export function warp(x, y, lam) {
  const r = Math.hypot(x, y);
  if (r < 1e-9) return [0, 0];
  const m = r < 1 ? phi(r, lam) / r : 1;
  const X = x * m, Y = y * m;
  const rr = Math.hypot(X, Y);
  const a = rr < 1 ? SWIRL * (1 - rr) ** 2 : 0;
  const c = Math.cos(a), s = Math.sin(a);
  return [X * c - Y * s, X * s + Y * c];
}
/** Slack for a strand with c crossings: 0.7 at one crossing, down to 0.2 at four or more. */
export const lamFor = (c) => LAM_SLACK - (LAM_SLACK - LAM_TAUT) * Math.min(1, Math.max(0, c - 1) / 3);
/** Peg p's unit-disk position on an n-peg hoop (peg 0 just right of the top). */
export const pegUnit = (n, p) => { const a = -Math.PI / 2 + (2 * Math.PI * (p + 0.5)) / n; return [Math.cos(a), Math.sin(a)]; };
/** The drawn polyline of a chord between pegs a and b. */
export function chordCurve(n, a, b, lam, K = 30) {
  const A = pegUnit(n, a), B = pegUnit(n, b), out = [];
  for (let k = 0; k <= K; k++) { const t = k / K; out.push(warp(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, lam)); }
  return out;
}

// ---------- levels ----------

// def: { id, name, n, reach?, strands: [{ c, a, b }], fixed?: [endId],
//        links?: [[endId, endId]], pegs?: { peg: colorKey }, layering? }
// End ids: strand s has ends 2s (at a) and 2s+1 (at b).
// Initial heights: later strands lie over earlier ones.
export function buildLevel(def) {
  const n = def.n, S = def.strands.length, reach = def.reach ?? REACH;
  const color = def.strands.map((s) => s.c);
  const start = [];
  for (const s of def.strands) start.push(s.a, s.b);
  const fixed = Array(2 * S).fill(0);
  for (const e of def.fixed || []) fixed[e] = 1;
  const link = Array(2 * S).fill(-1);
  for (const [x, y] of def.links || []) { link[x] = y; link[y] = x; }
  const pegColor = Array(n).fill(null);
  for (const [p, c] of Object.entries(def.pegs || {})) pegColor[+p] = c;
  const unitOf = Array(S).fill(-1), units = [];
  for (let s = 0; s < S; s++) {
    if (unitOf[s] >= 0) continue;
    const u = [s];
    for (const e of [2 * s, 2 * s + 1]) if (link[e] >= 0 && !u.includes(link[e] >> 1)) u.push(link[e] >> 1);
    for (const m of u) unitOf[m] = units.length;
    units.push(u);
  }
  const L = {
    id: def.id, name: def.name, n, reach, S, color, start, fixed, link, pegColor, layering: !!def.layering, unitOf, units,
    colors: [...new Set(color)],
    def,
  };
  const err = validate(L);
  if (err) throw new Error(`${def.id}: ${err}`);
  return L;
}

function validate(L) {
  const { n, S, start, fixed, link, pegColor, reach } = L;
  for (const c of L.color) if (!COLORS[c]) return `unknown color ${c}`;
  if (!(n >= 6 && n <= 40)) return 'peg count';
  const seen = new Map();
  for (let e = 0; e < 2 * S; e++) {
    const p = start[e];
    if (!Number.isInteger(p) || p < 0 || p >= n) return `end ${e} off the hoop`;
    if (seen.has(p) && link[e] !== seen.get(p)) return `peg ${p} holds two knots`;
    if (!seen.has(p)) seen.set(p, e);
  }
  for (let e = 0; e < 2 * S; e++) {
    if (link[e] >= 0) {
      if (link[link[e]] !== e || (link[e] >> 1) === (e >> 1)) return `bad link ${e}`;
      if (start[link[e]] !== start[e]) return `linked ends ${e} apart`;
      if (link[e ^ 1] >= 0) return `strand ${e >> 1} has two shared knots`;
      if (fixed[e]) return `a shared knot is stitched down (${e})`;
    }
    if (fixed[e] && fixed[e ^ 1]) return `strand ${e >> 1} is stitched down at both ends`;
  }
  for (let s = 0; s < S; s++) if (cdist(n, start[2 * s], start[2 * s + 1]) < reach) return `strand ${s} too short`;
  for (let p = 0; p < n; p++) {
    if (!pegColor[p]) continue;
    for (let e = 0; e < 2 * S; e++) if (start[e] === p && L.color[e >> 1] !== pegColor[p]) return `peg ${p} color`;
  }
  return null;
}

export function mechanicsOf(L) {
  const m = [];
  if (L.fixed.some(Boolean)) m.push('fixed');
  if (L.pegColor.some(Boolean)) m.push('pegs');
  if (L.link.some((x) => x >= 0)) m.push('links');
  if (L.layering) m.push('layering');
  return m;
}
/** Empty pegs at the start (the working space). */
export const sparePegs = (L) => L.n - new Set(L.start).size;

// ---------- state ----------

export function newState(L) {
  return { v: VERSION, level: L.id, ends: L.start.slice(), out: Array(L.S).fill(0), z: [...Array(L.S).keys()], moves: 0 };
}
const clone = (s) => ({ ...s, ends: s.ends.slice(), out: s.out.slice(), z: s.z.slice() });

export const isDone = (s) => s.out.every(Boolean);
export const remaining = (s) => s.out.reduce((a, x) => a + (x ? 0 : 1), 0);
export function pegOcc(L, s) {
  const o = Array(L.n).fill(0);
  for (const p of s.ends) if (p >= 0) o[p]++;
  return o;
}
/** The end(s) tied at peg p (a shared knot has two), or []. */
export function endsAt(L, s, p) {
  const out = [];
  for (let e = 0; e < 2 * L.S; e++) if (s.ends[e] === p) out.push(e);
  return out;
}
export const strandCross = (L, ends, a, b) => crosses(L.n, ends[2 * a], ends[2 * a + 1], ends[2 * b], ends[2 * b + 1]);
/** Strands still on the hoop that cross strand i. */
export function crossersOf(L, s, i) {
  const out = [];
  if (s.out[i]) return out;
  for (let j = 0; j < L.S; j++) if (j !== i && !s.out[j] && strandCross(L, s.ends, i, j)) out.push(j);
  return out;
}
export function crossCounts(L, s) {
  const c = Array(L.S).fill(0);
  for (let i = 0; i < L.S; i++) {
    if (s.out[i]) continue;
    for (let j = i + 1; j < L.S; j++) if (!s.out[j] && strandCross(L, s.ends, i, j)) { c[i]++; c[j]++; }
  }
  return c;
}
export const totalCrossings = (L, s) => crossCounts(L, s).reduce((a, x) => a + x, 0) / 2;

/** The ends that move when end e is lifted: a shared knot lifts both. */
export const movers = (L, e) => (L.link[e] >= 0 ? [e, L.link[e]] : [e]);

/**
 * canLift(L, s, e) -> null if end e can be picked up now, else
 *   { reason: 'gone' | 'fixed' | 'under', blockers: [strand] }
 * under: blockers are the strands lying over it (over-and-under levels).
 */
export function canLift(L, s, e) {
  if (!(e >= 0 && e < 2 * L.S) || s.out[e >> 1] || s.ends[e] < 0) return { reason: 'gone', blockers: [] };
  if (L.fixed[e]) return { reason: 'fixed', blockers: [] };
  if (L.layering) {
    const ms = movers(L, e).map((m) => m >> 1);
    const blockers = [];
    for (const m of ms) {
      for (const t of crossersOf(L, s, m)) if (!ms.includes(t) && s.z[t] > s.z[m] && !blockers.includes(t)) blockers.push(t);
    }
    if (blockers.length) return { reason: 'under', blockers };
  }
  return null;
}

/**
 * whyNotTo(L, s, e, q) -> null if the knot at end e may be retied on peg q,
 * else 'same' | 'taken' | 'reach' | 'color'. (Assumes the knot can be lifted.)
 */
export function whyNotTo(L, s, e, q) {
  if (!(q >= 0 && q < L.n)) return 'taken';
  if (s.ends[e] === q) return 'same';
  for (let k = 0; k < 2 * L.S; k++) if (s.ends[k] === q) return 'taken';
  for (const m of movers(L, e)) {
    if (cdist(L.n, q, s.ends[m ^ 1]) < L.reach) return 'reach';
    if (L.pegColor[q] && L.pegColor[q] !== L.color[m >> 1]) return 'color';
  }
  return null;
}
/** Pegs the knot at end e may go to now ([] if it can't be lifted). */
export function targets(L, s, e) {
  if (canLift(L, s, e)) return [];
  const out = [];
  for (let q = 0; q < L.n; q++) if (!whyNotTo(L, s, e, q)) out.push(q);
  return out;
}

/** All moves, one per knot (a shared knot is listed once, by its lower end). */
export function legalMoves(L, s) {
  const out = [];
  for (let e = 0; e < 2 * L.S; e++) {
    if (L.link[e] >= 0 && L.link[e] < e) continue;
    for (const q of targets(L, s, e)) out.push([e, q]);
  }
  return out;
}

// Heights as ranks 0..S-1 (lowest first); ties keep strand order.
function renormZ(z) {
  const order = z.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = z.slice();
  order.forEach(([, i], r) => { out[i] = r; });
  return out;
}

// Free every unit whose strands all cross nothing. Mutates t; returns
// [{ s, a, b }] with the pegs each freed strand was tied to.
function settle(L, t) {
  const c = crossCounts(L, t);
  const freed = [];
  for (const u of L.units) {
    if (u.some((m) => t.out[m]) || u.some((m) => c[m] > 0)) continue;
    for (const m of u) {
      freed.push({ s: m, a: t.ends[2 * m], b: t.ends[2 * m + 1] });
      t.out[m] = 1; t.ends[2 * m] = -1; t.ends[2 * m + 1] = -1;
    }
  }
  return freed;
}

/**
 * move(L, s, e, q) -> { ok, state, from, to, movers, freed } or
 *   { ok: false, reason, blockers?, state }
 * The moved strand(s) are laid on top (the tapped one uppermost).
 */
export function move(L, s, e, q) {
  const why = canLift(L, s, e);
  if (why) return { ok: false, ...why, state: s };
  const w2 = whyNotTo(L, s, e, q);
  if (w2) return { ok: false, reason: w2, blockers: [], state: s };
  const t = clone(s);
  const ms = movers(L, e);
  const from = s.ends[e];
  for (const m of ms) t.ends[m] = q;
  let top = Math.max(...t.z);
  const strands = ms.map((m) => m >> 1).sort((a, b) => (a === e >> 1) - (b === e >> 1));
  for (const m of strands) t.z[m] = ++top;
  t.z = renormZ(t.z);
  t.moves++;
  const freed = settle(L, t);
  return { ok: true, state: t, from, to: q, movers: ms, freed };
}

// ---------- undo: a tiny pure history ----------

export const newGame = (L) => ({ state: newState(L), past: [] });
export function play(L, g, e, q) {
  const r = move(L, g.state, e, q);
  if (!r.ok) return { ok: false, game: g, why: r };
  return { ...r, ok: true, game: { state: r.state, past: [...g.past, g.state] } };
}
export function undo(g) {
  if (!g.past.length) return g;
  return { state: g.past[g.past.length - 1], past: g.past.slice(0, -1) };
}

// Solutions are stored as "end:peg end:peg ...".
export const parseMoves = (str) => (typeof str === 'string' ? str.split(/\s+/).filter(Boolean).map((x) => x.split(':').map(Number)) : str);
export const formatMoves = (ms) => ms.map(([e, q]) => `${e}:${q}`).join(' ');
export function replay(L, moves, s = newState(L)) {
  for (const [e, q] of parseMoves(moves)) {
    const r = move(L, s, e, q);
    if (!r.ok) throw new Error(`${L.id}: move ${e}:${q} is not legal (${r.reason})`);
    s = r.state;
  }
  return s;
}

// ---------- a fast simulator for the solver and the bots ----------
// A position is the ends (peg or -1) plus, on over-and-under levels, the
// height order. Plain strands are symmetric, so their two ends are sorted in
// the key; a stitched-down or shared end keeps its identity.

function ctxOf(L) {
  if (L._ctx) return L._ctx;
  const S = L.S, n = L.n;
  const sym = Array(S).fill(true);
  for (let e = 0; e < 2 * S; e++) if (L.fixed[e] || L.link[e] >= 0) sym[e >> 1] = false;
  const C = { L, S, n, sym, reach: L.reach, layering: L.layering };
  Object.defineProperty(L, '_ctx', { value: C, enumerable: false });
  return C;
}
function keyOf(C, ends, z) {
  const a = [];
  for (let s = 0; s < C.S; s++) {
    let x = ends[2 * s] + 2, y = ends[2 * s + 1] + 2;
    if (C.sym[s] && x > y) { const t = x; x = y; y = t; }
    a.push(x, y);
  }
  if (C.layering) {
    // relative heights of strands still on the hoop
    const live = [];
    for (let s = 0; s < C.S; s++) if (ends[2 * s] >= 0) live.push(s);
    live.sort((p, q) => z[p] - z[q]);
    for (const s of live) a.push(s + 100);
  }
  return String.fromCharCode(...a);
}
function simMoves(C, ends, z) {
  const L = C.L, S = C.S, n = C.n;
  const occ = new Uint8Array(n);
  for (const p of ends) if (p >= 0) occ[p] = 1;
  const out = [];
  for (let e = 0; e < 2 * S; e++) {
    const p = ends[e];
    if (p < 0 || L.fixed[e]) continue;
    const lk = L.link[e];
    if (lk >= 0 && lk < e) continue;
    const ms = lk >= 0 ? [e, lk] : [e];
    if (C.layering) {
      let blocked = false;
      for (const m of ms) {
        const sm = m >> 1;
        for (let t = 0; t < S && !blocked; t++) {
          if (ends[2 * t] < 0 || t === sm || (lk >= 0 && t === (lk >> 1))) continue;
          if (z[t] > z[sm] && crosses(n, ends[2 * sm], ends[2 * sm + 1], ends[2 * t], ends[2 * t + 1])) blocked = true;
        }
      }
      if (blocked) continue;
    }
    for (let q = 0; q < n; q++) {
      if (occ[q]) continue;
      let ok = true;
      for (const m of ms) {
        if (cdist(n, q, ends[m ^ 1]) < C.reach) { ok = false; break; }
        if (L.pegColor[q] && L.pegColor[q] !== L.color[m >> 1]) { ok = false; break; }
      }
      if (ok) out.push(e, q);
    }
  }
  return out;
}
// Apply a move; returns [ends, z, freedCount].
function simApply(C, ends, z, e, q) {
  const L = C.L, S = C.S;
  const E = ends.slice();
  const lk = L.link[e];
  E[e] = q;
  if (lk >= 0) E[lk] = q;
  let Z = z;
  if (C.layering) {
    Z = z.slice();
    let top = 0;
    for (let s = 0; s < S; s++) if (Z[s] > top) top = Z[s];
    if (lk >= 0) Z[lk >> 1] = ++top;
    Z[e >> 1] = ++top;
  }
  // settle
  const cnt = new Uint8Array(S);
  for (let a = 0; a < S; a++) {
    if (E[2 * a] < 0) continue;
    for (let b = a + 1; b < S; b++) {
      if (E[2 * b] < 0) continue;
      if (crosses(C.n, E[2 * a], E[2 * a + 1], E[2 * b], E[2 * b + 1])) { cnt[a]++; cnt[b]++; }
    }
  }
  let freed = 0;
  for (const u of L.units) {
    if (E[2 * u[0]] < 0) continue;
    let clear = true;
    for (const m of u) if (cnt[m]) { clear = false; break; }
    if (!clear) continue;
    for (const m of u) { E[2 * m] = -1; E[2 * m + 1] = -1; freed++; }
  }
  return [E, Z, freed];
}
const simDone = (ends) => { for (const p of ends) if (p >= 0) return false; return true; };
function simCrossPairs(C, ends) {
  let k = 0;
  for (let a = 0; a < C.S; a++) {
    if (ends[2 * a] < 0) continue;
    for (let b = a + 1; b < C.S; b++) if (ends[2 * b] >= 0 && crosses(C.n, ends[2 * a], ends[2 * a + 1], ends[2 * b], ends[2 * b + 1])) k++;
  }
  return k;
}

// Lower bound on moves: every crossing needs one of its two strands moved,
// and a move moves one strand (or one shared-knot pair). So the minimum
// vertex cover of the crossing graph, over units, is admissible and
// consistent (a move changes only one unit's crossings).
function vcBound(C, ends) {
  const L = C.L, U = L.units.length;
  const adj = new Array(U).fill(0);
  let any = false;
  for (let a = 0; a < C.S; a++) {
    if (ends[2 * a] < 0) continue;
    for (let b = a + 1; b < C.S; b++) {
      if (ends[2 * b] < 0) continue;
      const ua = L.unitOf[a], ub = L.unitOf[b];
      if (ua === ub) continue;
      if (crosses(C.n, ends[2 * a], ends[2 * a + 1], ends[2 * b], ends[2 * b + 1])) { adj[ua] |= 1 << ub; adj[ub] |= 1 << ua; any = true; }
    }
  }
  if (!any) return 0;
  let best = Infinity;
  const pop = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  const rec = (alive, k) => {
    if (k >= best) return;
    // the live vertex of highest degree
    let v = -1, dv = 0;
    for (let i = 0; i < U; i++) if (alive >> i & 1) { const d = pop(adj[i] & alive); if (d > dv) { dv = d; v = i; } }
    if (v < 0) { best = k; return; }
    if (dv === 1) {
      // a matching on the remaining paths/stars: greedy is exact enough as a bound when all degrees are 1
      let m = 0, al = alive;
      for (let i = 0; i < U; i++) if (al >> i & 1 && adj[i] & al) { const j = 31 - Math.clz32(adj[i] & al); al &= ~(1 << i) & ~(1 << j); m++; }
      if (k + m < best) best = k + m;
      return;
    }
    rec(alive & ~(1 << v), k + 1);
    const nb = adj[v] & alive;
    rec(alive & ~nb & ~(1 << v), k + pop(nb));
  };
  rec((1 << U) - 1, 0);
  return best;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (Heap.lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && Heap.lt(a[l], a[m])) m = l;
        if (r < a.length && Heap.lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
// f, then deeper (smaller h), then first made: fully deterministic
Heap.lt =(x, y) => (x.f !== y.f ? x.f < y.f : x.h !== y.h ? x.h < y.h : x.id < y.id);

/**
 * solve(L, s?, { cap, weight }) -> { ok, path: [[end, peg]], nodes, optimal, exhausted }
 * A* over positions with the vertex-cover bound (crossing pairs break ties).
 * weight 1 gives a minimum-move solution; weight > 1 is faster and near-minimum.
 * nodes: positions expanded. exhausted: the whole reachable space was searched.
 */
export function solve(L, s = newState(L), { cap = 200000, weight = 1 } = {}) {
  const C = ctxOf(L);
  const ends0 = s.ends.slice(), z0 = s.z.slice();
  if (simDone(ends0)) return { ok: true, path: [], nodes: 0, optimal: true, exhausted: false };
  const best = new Map();
  const nodes = []; // { ends, z, g, parent, e, q }
  const open = new Heap();
  let id = 0;
  const h0 = vcBound(C, ends0);
  nodes.push({ ends: ends0, z: z0, g: 0, parent: -1, e: -1, q: -1 });
  best.set(keyOf(C, ends0, z0), 0);
  open.push({ f: weight * h0, h: h0 * 64 + simCrossPairs(C, ends0), id: id++, k: 0 });
  let expanded = 0;
  while (open.size) {
    const top = open.pop();
    const nd = nodes[top.k];
    const key = keyOf(C, nd.ends, nd.z);
    if (best.get(key) < nd.g) continue;
    if (simDone(nd.ends)) {
      const path = [];
      for (let k = top.k; nodes[k].parent >= 0; k = nodes[k].parent) path.push([nodes[k].e, nodes[k].q]);
      path.reverse();
      return { ok: true, path, nodes: expanded, optimal: weight === 1, exhausted: false };
    }
    if (++expanded > cap) return { ok: false, path: [], nodes: expanded, optimal: false, exhausted: false };
    const ms = simMoves(C, nd.ends, nd.z);
    for (let k = 0; k < ms.length; k += 2) {
      const [E, Z] = simApply(C, nd.ends, nd.z, ms[k], ms[k + 1]);
      const g = nd.g + 1;
      const kk = keyOf(C, E, Z);
      const old = best.get(kk);
      if (old !== undefined && old <= g) continue;
      best.set(kk, g);
      const h = vcBound(C, E);
      nodes.push({ ends: E, z: Z, g, parent: top.k, e: ms[k], q: ms[k + 1] });
      open.push({ f: g + weight * h, h: h * 64 + simCrossPairs(C, E), id: id++, k: nodes.length - 1 });
    }
  }
  return { ok: false, path: [], nodes: expanded, optimal: false, exhausted: true };
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

/** A random player: any legal move, uniformly. Moves used to clear, or -1 within K. */
export function randomPlayout(L, rng, K) {
  const C = ctxOf(L);
  let ends = L.start.slice(), z = [...Array(L.S).keys()];
  for (let k = 1; k <= K; k++) {
    const ms = simMoves(C, ends, z);
    if (!ms.length) return -1;
    const i = Math.floor(rng() * (ms.length / 2)) * 2;
    [ends, z] = simApply(C, ends, z, ms[i], ms[i + 1]);
    if (simDone(ends)) return k;
  }
  return -1;
}
export function randomRate(L, K, seed = 1, runs = 200) {
  const rng = mulberry(seed);
  let ok = 0;
  for (let r = 0; r < runs; r++) if (randomPlayout(L, rng, K) > 0) ok++;
  return ok / runs;
}
/** A greedy player with no lookahead: fewest crossings left after the move (ties at random). */
export function greedyPlayout(L, rng, K) {
  const C = ctxOf(L);
  let ends = L.start.slice(), z = [...Array(L.S).keys()];
  for (let k = 1; k <= K; k++) {
    const ms = simMoves(C, ends, z);
    if (!ms.length) return -1;
    let best = [], bs = Infinity;
    for (let i = 0; i < ms.length; i += 2) {
      const [E] = simApply(C, ends, z, ms[i], ms[i + 1]);
      const sc = simCrossPairs(C, E);
      if (sc < bs) { bs = sc; best = [i]; } else if (sc === bs) best.push(i);
    }
    const i = best[Math.floor(rng() * best.length)];
    [ends, z] = simApply(C, ends, z, ms[i], ms[i + 1]);
    if (simDone(ends)) return k;
  }
  return -1;
}
export function greedyRate(L, K, seed = 1, runs = 100) {
  const rng = mulberry(seed);
  let ok = 0;
  for (let r = 0; r < runs; r++) if (greedyPlayout(L, rng, K) > 0) ok++;
  return ok / runs;
}

// ---------- hints ----------

export const stateKey = (L, s) => keyOf(ctxOf(L), s.ends, s.z);

/** If s is exactly a position along the stored solution, its next move. */
export function solutionStep(L, s, solution = L.solution) {
  if (!solution) return null;
  const want = stateKey(L, s);
  let t = newState(L);
  for (const [e, q] of parseMoves(solution)) {
    if (stateKey(L, t) === want) {
      // the same position, but plain strands may have their ends swapped
      const p = t.ends[e];
      const here = endsAt(L, s, p).find((x) => (x >> 1) === (e >> 1));
      const end = here ?? e;
      return move(L, s, end, q).ok ? [end, q] : null;
    }
    const r = move(L, t, e, q);
    if (!r.ok) return null;
    t = r.state;
  }
  return null;
}

/** hint -> { kind: 'move', end, to } | { kind: 'tangled' } | { kind: 'none' } */
export function hint(L, s, { cap = 2500, solution = L.solution } = {}) {
  if (isDone(s)) return { kind: 'none' };
  const known = solutionStep(L, s, solution);
  if (known) return { kind: 'move', end: known[0], to: known[1] };
  const r = solve(L, s, { cap, weight: 1.5 });
  if (r.ok && r.path.length) return { kind: 'move', end: r.path[0][0], to: r.path[0][1] };
  if (r.exhausted) return { kind: 'tangled' };
  // out of search budget: the move that leaves the fewest crossings
  const C = ctxOf(L);
  const ms = simMoves(C, s.ends, s.z);
  let bi = -1, bs = Infinity;
  for (let i = 0; i < ms.length; i += 2) {
    const [E] = simApply(C, s.ends, s.z, ms[i], ms[i + 1]);
    const sc = simCrossPairs(C, E) * 4 - (simDone(E) ? 100 : 0);
    if (sc < bs) { bs = sc; bi = i; }
  }
  return bi >= 0 ? { kind: 'move', end: ms[bi], to: ms[bi + 1] } : { kind: 'tangled' };
}

// A short fingerprint of everything that shapes play, so a save made on an
// older version of a level is set aside instead of misread.
export function levelSig(L) {
  const src = JSON.stringify([L.n, L.reach, L.color, L.start, L.fixed, L.link, L.pegColor, L.layering]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------- what the freed yarn could make ----------
// The hoop is a 10-inch embroidery hoop. Each strand is cut a hoop's width
// plus a 2-inch tail at each knot: 14 inches of worsted. A small lazy-daisy
// flower (five chain-stitch petals) takes about one 18-inch needle-length;
// a 2-inch tassel takes about 15 wraps around a 2-inch card plus ties,
// roughly 72 inches.
export const HOOP_INCHES = 10;
export const STRAND_INCHES = 14;
export function yarnLine(strands) {
  const inches = strands * STRAND_INCHES;
  const flowers = Math.max(1, Math.floor(inches / 18));
  const fl = `${flowers} small lazy-daisy flower${flowers === 1 ? '' : 's'}`;
  const yards = Math.round((inches / 36) * 10) / 10;
  const line = inches >= 72
    ? `About ${yards} yards of worsted: enough to wrap a 2-inch tassel, or to embroider ${fl} at about one 18-inch needle-length each.`
    : `About ${inches} inches of worsted: enough to embroider ${fl}, at about one 18-inch needle-length each.`;
  return { inches, yards, flowers, line };
}
