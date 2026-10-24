// The Hoop: pure rules. No window/document/Date.now/Math.random.
// Everything random (bots, generation) takes an explicit rng or seed.
// The save holds only ids, peg numbers, crossing records and color keys,
// never level objects.
//
// THE HOOP
// - A wooden hoop with n pegs evenly around it, numbered 0..n-1 clockwise
//   from the top. Each strand of yarn has two ends, each tied to a peg.
//   A peg holds at most one knot (a shared knot, below, is one knot).
// - Strands are CURVES, not chords. Two strands may cross more than once,
//   and may HOOK each other (a clasp). So the hoop remembers its topology.
//
// THE STATE: WORDS
// - Every crossing is a record [a, b, top, sign]: strands a < b cross there,
//   `top` is the one lying over, `sign` is which way b passes a (the sign of
//   cross(direction of a, direction of b), each read along its own word).
// - Strand s's WORD is the list of its crossings in order from its end 2s
//   to its end 2s+1. Each crossing appears once in each of its two strands'
//   words. Together the words and signs are a signed Gauss code: they fix the
//   picture up to sliding things about (layout.js draws it).
//
// THE MOVE (the step rule)
// - She lifts a knot and carries it to an empty peg. The carried end travels
//   ABOVE everything, so model it as sliding along the rim one knot at a
//   time. Passing a peg with a knot on it (strand T tied there), the end must
//   go OVER T's tail, right beside T's knot:
//
//        before                after (the end slid clockwise past r)
//     T's knot r  p (end)        r   p'
//        o        o              o ___o      the mover's end now runs over
//        |       /               |/          T's tail: a new crossing,
//        |      /               /|           mover OVER T, at the moved end
//        |     /               / |           of the mover's word and at the
//                                            r end (outermost) of T's word.
//
//   Passing an EMPTY peg changes nothing. A shared knot has two tails; the
//   end crosses both, in the order they leave the knot.
// - WHICH WAY ROUND. The carried end is above everything, and the space above
//   the hoop is one open disk with every knot on its rim, so going either way
//   round gives the same tangle. The rule takes the way that does not pass
//   the strand's own other knot (for a shared knot: either strand's), which
//   never makes a strand cross itself. It is unique for a single strand. A
//   shared knot whose two far ends lie on opposite sides of the target can't
//   be carried there ('around').
// - REDUCTION (Reidemeister II). Two crossings of A with B that are next to
//   each other along A AND along B, with the same strand on top at both,
//   bound an empty bigon: the top strand slides off and both vanish. This is
//   applied after every step until nothing is left to cancel, so the state is
//   always reduced. Carrying an end straight back over a knot it just passed
//   cancels this way. Two crossings next to each other along A only are NOT
//   cancelled: a third strand can dip into the bigon from B's side, and
//   sliding A off would just move the crossings onto it. Alternating pairs
//   (A under B, then A over B, next to each other along both) are a CLASP:
//   the two strands hook each other and stay hooked until a move undoes it.
// - Ends must stay at least `reach` pegs apart (3 by default).
//
// COMING FREE
// - After every move, each strand whose word is empty slips off its pegs and
//   winds onto a skein, freeing both pegs. Strands tied into one shared knot
//   come free together, once both words are empty.
//
// THE MECHANICS (each introduced on its own level, see levels.js)
// - Hooked strands (`clasp`): a level that starts with two strands hooked.
// - Stitched-down knot (`fixed`): that end never moves.
// - Painted peg (`pegs`): only yarn of that color may be tied there.
// - Shared knot (`links`): two strands tied into one knot on one peg. Lifting
//   it moves both ends together; each strand's far end moves on its own.
// - Over and under (`layering`): a knot can be lifted only when its strand
//   lies ON TOP at the crossing nearest that knot (lifting the end raises the
//   strand up to that crossing; anything lying over it there pins it down).
//   A shared knot needs both strands on top there.
// - Fewer spare pegs: a level parameter (empty pegs at the start).
//
// NO FAIL STATE: unlimited undo, a hint, and start over. A position that no
// longer has a way out is reported by the hint as tangled, never as lost.

export const VERSION = 2;
export const MODEL = 'words-1';
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

// ---------- rim geometry ----------

/** Pegs apart around the hoop, the short way. */
export const cdist = (n, p, q) => { const d = (((p - q) % n) + n) % n; return Math.min(d, n - d); };
/** Is peg x strictly inside the clockwise run from a to b? */
export function inArc(n, a, b, x) {
  const ab = (((b - a) % n) + n) % n, ax = (((x - a) % n) + n) % n;
  return ax > 0 && ax < ab;
}
/** Do the ends of chords (a1,a2) and (b1,b2) interleave? Then the strands cross an odd number of times. */
export function crosses(n, a1, a2, b1, b2) {
  if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) return false;
  return inArc(n, a1, a2, b1) !== inArc(n, a1, a2, b2);
}
/** Peg p's unit-disk position on an n-peg hoop (peg 0 just right of the top). */
export const pegUnit = (n, p) => { const a = -Math.PI / 2 + (2 * Math.PI * (p + 0.5)) / n; return [Math.cos(a), Math.sin(a)]; };

// ---------- crossings and words ----------

/** The strand on the other side of crossing record X from strand s. */
export const otherOf = (X, s) => (X[0] === s ? X[1] : X[0]);
const pushEnd = (w, e, c) => { if (e & 1) w[e >> 1].push(c); else w[e >> 1].unshift(c); };
/** The crossing nearest end e of its strand, or -1. */
export function nearestAt(w, e) {
  const ws = w[e >> 1];
  if (!ws.length) return -1;
  return e & 1 ? ws[ws.length - 1] : ws[0];
}

// Renumber crossings in reading order (strand 0's word first), dropping holes.
function canon(w, x) {
  const map = new Map(), nx = [];
  const nw = w.map((ws) => ws.map((c) => {
    let k = map.get(c);
    if (k === undefined) { k = nx.length; map.set(c, k); nx.push(x[c]); }
    return k;
  }));
  return { w: nw, x: nx };
}

// Reidemeister II: cancel two crossings that are next to each other along
// both strands with the same strand on top. Mutates w (the words of strands
// in `dirty`, which the caller has copied, and of any strand a cancellation
// reaches, copied here) and x (x gets holes). Only strands whose words just
// changed can hold a new pair, and a cancellation can only make new
// neighbors on the two strands it touched, so the scan follows those.
// Deterministic: lowest strand first, then reading order.
function reduce(w, x, dirty = null, owned = null) {
  let removed = 0;
  const todo = new Set(dirty || w.keys());
  const own = owned || new Set(w.keys());
  const mine = (s) => { if (!own.has(s)) { w[s] = w[s].slice(); own.add(s); } return w[s]; };
  while (todo.size) {
    let s = Infinity;
    for (const t of todo) if (t < s) s = t;
    todo.delete(s);
    const ws = w[s];
    for (let k = 0; k + 1 < ws.length; k++) {
      const c1 = ws[k], c2 = ws[k + 1], X1 = x[c1], X2 = x[c2];
      if (X1[0] !== X2[0] || X1[1] !== X2[1] || X1[2] !== X2[2]) continue;
      const o = otherOf(X1, s), wo = w[o];
      const i1 = wo.indexOf(c1), i2 = wo.indexOf(c2);
      if (Math.abs(i1 - i2) !== 1) continue;
      mine(s).splice(k, 2);
      mine(o).splice(Math.min(i1, i2), 2);
      x[c1] = null; x[c2] = null;
      removed += 2;
      todo.add(s); todo.add(o);
      break;
    }
  }
  return removed;
}

// What is left of A and B's crossings with every other strand ignored and
// the pair reduced on its own. If anything is left, A and B can never part
// unless one of them moves (a cancellation elsewhere can only remove a pair
// that is already reducible here). Used by the solver's bound and to spot
// hooked strands.
export function pairLeft(w, x, A, B) {
  const la = w[A].filter((c) => otherOf(x[c], A) === B);
  if (!la.length) return 0;
  const lb = w[B].filter((c) => otherOf(x[c], B) === A);
  for (;;) {
    let hit = false;
    for (let k = 0; k + 1 < la.length; k++) {
      const c1 = la[k], c2 = la[k + 1];
      if (x[c1][2] !== x[c2][2]) continue;
      const i1 = lb.indexOf(c1), i2 = lb.indexOf(c2);
      if (Math.abs(i1 - i2) !== 1) continue;
      la.splice(k, 2); lb.splice(Math.min(i1, i2), 2);
      hit = true;
      break;
    }
    if (!hit) return la.length;
  }
}

// ---------- levels ----------

// def: { id, name, n, reach?, strands: [{ c, a, b }], fixed?: [endId],
//        links?: [[cwEnd, ccwEnd]], pegs?: { peg: colorKey }, layering?,
//        x?: [[a, b, top, sign]], w?: [[crossing ids] per strand] }
// End ids: strand s has ends 2s (at a) and 2s+1 (at b). A link lists the end
// whose tail leaves the shared knot on the clockwise side first; that order
// never changes (the tails turn together as the knot slides).
export function buildLevel(def) {
  const n = def.n, S = def.strands.length, reach = def.reach ?? REACH;
  const color = def.strands.map((s) => s.c);
  const start = [];
  for (const s of def.strands) start.push(s.a, s.b);
  const fixed = Array(2 * S).fill(0);
  for (const e of def.fixed || []) fixed[e] = 1;
  const link = Array(2 * S).fill(-1), cwSide = Array(2 * S).fill(0);
  for (const [x, y] of def.links || []) { link[x] = y; link[y] = x; cwSide[x] = 1; }
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
  const w0 = def.w ? def.w.map((a) => a.slice()) : Array.from({ length: S }, () => []);
  const x0 = (def.x || []).map((X) => X.slice());
  const L = {
    id: def.id, name: def.name, n, reach, S, color, start, fixed, link, cwSide, pegColor, layering: !!def.layering, unitOf, units,
    colors: [...new Set(color)],
    def,
  };
  const err = validate(L, w0, x0);
  if (err) throw new Error(`${def.id}: ${err}`);
  const c = canon(w0, x0);
  L.startW = c.w; L.startX = c.x;
  return L;
}

function validate(L, w, x) {
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
  return wordsError(L, start, w, x);
}

/** Are words and crossing records consistent? null, or what is wrong. */
export function wordsError(L, ends, w, x) {
  const S = L.S;
  if (!Array.isArray(w) || w.length !== S || !Array.isArray(x)) return 'words';
  const count = new Map();
  for (let s = 0; s < S; s++) {
    if (!Array.isArray(w[s])) return 'words';
    for (const c of w[s]) {
      const X = x[c];
      if (!Array.isArray(X) || X.length !== 4) return `crossing ${c} missing`;
      const [a, b, top, sg] = X;
      if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a < b && b < S)) return `crossing ${c} strands`;
      if (top !== a && top !== b) return `crossing ${c} top`;
      if (sg !== 1 && sg !== -1) return `crossing ${c} sign`;
      if (s !== a && s !== b) return `crossing ${c} on strand ${s}`;
      const k = `${c}:${s}`;
      if (count.has(k)) return `crossing ${c} twice on ${s}`;
      count.set(k, 1);
    }
  }
  for (let c = 0; c < x.length; c++) {
    if (!x[c]) continue;
    if (!count.has(`${c}:${x[c][0]}`) || !count.has(`${c}:${x[c][1]}`)) return `crossing ${c} not on both strands`;
  }
  // parity: interleaved ends cross an odd number of times
  for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
    if (ends[2 * a] < 0 || ends[2 * b] < 0) continue;
    const k = w[a].filter((c) => otherOf(x[c], a) === b).length;
    const linked = [2 * a, 2 * a + 1].some((e) => L.link[e] >= 0 && (L.link[e] >> 1) === b);
    if (!linked && (k % 2 === 1) !== crosses(L.n, ends[2 * a], ends[2 * a + 1], ends[2 * b], ends[2 * b + 1])) return `strands ${a} and ${b} cross ${k} times`;
  }
  return null;
}

export function mechanicsOf(L) {
  const m = [];
  if (hookedPairs(L, newState(L)).length) m.push('clasp');
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
  return { v: VERSION, level: L.id, ends: L.start.slice(), out: Array(L.S).fill(0), w: L.startW.map((a) => a.slice()), x: L.startX.map((X) => X.slice()), moves: 0 };
}

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
/** Strands still on the hoop that cross strand i (each once). */
export function crossersOf(L, s, i) {
  const out = [];
  if (s.out[i]) return out;
  for (const c of s.w[i]) { const o = otherOf(s.x[c], i); if (!out.includes(o)) out.push(o); }
  return out.sort((a, b) => a - b);
}
/** Crossings on each strand. */
export const crossCounts = (L, s) => s.w.map((ws) => ws.length);
export const totalCrossings = (L, s) => s.w.reduce((a, ws) => a + ws.length, 0) / 2;
/** Pairs of strands hooked together: their crossings can't cancel between themselves. */
export function hookedPairs(L, s) {
  const out = [];
  for (let a = 0; a < L.S; a++) for (let b = a + 1; b < L.S; b++) if (!s.out[a] && !s.out[b] && pairLeft(s.w, s.x, a, b) >= 2) out.push([a, b]);
  return out;
}

/** The ends that move when end e is lifted: a shared knot lifts both. */
export const movers = (L, e) => (L.link[e] >= 0 ? [e, L.link[e]] : [e]);

/**
 * pathOf(L, ends, e, q) -> { dir, passed } or null: the way the knot at end e
 * goes round to peg q (dir +1 clockwise, -1 the other way) and the pegs with
 * knots it passes, in order. Never past a mover's own other end.
 */
export function pathOf(L, ends, e, q) {
  const n = L.n, ms = movers(L, e), p = ends[e];
  const others = ms.map((m) => ends[m ^ 1]);
  for (const dir of [1, -1]) {
    const passed = [];
    let ok = true;
    for (let k = (p + dir + n) % n; k !== q; k = (k + dir + n) % n) {
      if (others.includes(k)) { ok = false; break; }
      if (ends.includes(k)) passed.push(k);
    }
    if (ok) return { dir, passed };
  }
  return null;
}

/**
 * canLift(L, s, e) -> null if end e can be picked up now, else
 *   { reason: 'gone' | 'fixed' | 'under', blockers: [strand] }
 * under (over-and-under levels): blockers lie over the strand at the
 * crossing nearest the knot.
 */
export function canLift(L, s, e) {
  if (!(e >= 0 && e < 2 * L.S) || s.out[e >> 1] || s.ends[e] < 0) return { reason: 'gone', blockers: [] };
  if (L.fixed[e]) return { reason: 'fixed', blockers: [] };
  if (L.layering) {
    const ms = movers(L, e), mine = ms.map((m) => m >> 1);
    const blockers = [];
    for (const m of ms) {
      const c = nearestAt(s.w, m);
      if (c < 0) continue;
      const X = s.x[c], A = m >> 1, o = otherOf(X, A);
      if (X[2] !== A && !mine.includes(o) && !blockers.includes(o)) blockers.push(o);
    }
    if (blockers.length) return { reason: 'under', blockers };
  }
  return null;
}

/**
 * whyNotTo(L, s, e, q) -> null if the knot at end e may be retied on peg q,
 * else 'same' | 'taken' | 'reach' | 'color' | 'around'. (Assumes it can be lifted.)
 */
export function whyNotTo(L, s, e, q) {
  if (!(q >= 0 && q < L.n)) return 'taken';
  if (s.ends[e] === q) return 'same';
  for (let k = 0; k < 2 * L.S; k++) if (s.ends[k] === q) return 'taken';
  for (const m of movers(L, e)) {
    if (cdist(L.n, q, s.ends[m ^ 1]) < L.reach) return 'reach';
    if (L.pegColor[q] && L.pegColor[q] !== L.color[m >> 1]) return 'color';
  }
  if (!pathOf(L, s.ends, e, q)) return 'around';
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

// The step rule, for every knot passed. Mutates w and x (appends crossings).
// Returns how many crossings it made.
function carry(L, ends, w, x, ms, dir, passed) {
  const bySide = (a, b) => (dir > 0 ? L.cwSide[a] - L.cwSide[b] : L.cwSide[b] - L.cwSide[a]);
  // a shared knot's two tails trail behind it in two lanes: the outer lane
  // (nearest the rim) is the tail on the trailing side of the knot
  const lanes = ms.length === 2 ? ms.slice().sort(bySide) : ms;
  let made = 0;
  for (const r of passed) {
    const tails = [];
    for (let k = 0; k < ends.length; k++) if (ends[k] === r) tails.push(k);
    if (tails.length === 2) tails.sort(bySide); // crossed in the order they leave the knot
    const id = new Map();
    for (const m of lanes) for (const t of tails) {
      const A = m >> 1, T = t >> 1;
      // along A toward its moved end we travel round the rim in direction
      // dir; along T from an even end we head inward from r. The rim
      // tangent crossed with the inward normal is +1.
      let sg = dir * (m & 1 ? 1 : -1) * (t & 1 ? -1 : 1);
      if (A > T) sg = -sg;
      x.push([Math.min(A, T), Math.max(A, T), A, sg]);
      id.set(m * 64 + t, x.length - 1);
      made++;
    }
    for (const m of lanes) for (const t of tails) pushEnd(w, m, id.get(m * 64 + t));
    for (const t of tails) for (let k = lanes.length - 1; k >= 0; k--) pushEnd(w, t, id.get(lanes[k] * 64 + t));
  }
  return made;
}

// Free every unit whose strands all have empty words. Mutates ends/out;
// returns [{ s, a, b }] with the pegs each freed strand was tied to.
function settle(L, ends, out, w) {
  const freed = [];
  for (const u of L.units) {
    if (u.some((m) => out[m]) || u.some((m) => w[m].length > 0)) continue;
    for (const m of u) {
      freed.push({ s: m, a: ends[2 * m], b: ends[2 * m + 1] });
      out[m] = 1; ends[2 * m] = -1; ends[2 * m + 1] = -1;
    }
  }
  return freed;
}

// The whole move on bare arrays: carry, reduce, renumber, free.
// tidy: renumber the crossings (the solver skips it: its key renumbers anyway).
function applyMove(L, ends0, w0, x0, out0, e, q, path, free = true, tidy = true) {
  const ends = ends0.slice(), out = out0.slice();
  const w = w0.slice(), x = x0.slice();
  const ms = movers(L, e);
  for (const m of ms) ends[m] = q;
  // the words that change: the movers' and the tails' passed (copied, the rest shared)
  const dirty = new Set();
  for (const m of ms) dirty.add(m >> 1);
  for (const r of path.passed) for (let k = 0; k < ends0.length; k++) if (ends0[k] === r) dirty.add(k >> 1);
  for (const s of dirty) w[s] = w[s].slice();
  // the knots passed are judged before the end lands (q is empty)
  const made = carry(L, ends0, w, x, ms, path.dir, path.passed);
  const cancelled = reduce(w, x, dirty, new Set(dirty));
  let W = w, X = x;
  if (tidy) { const c = canon(w, x); W = c.w; X = c.x; }
  const freed = free ? settle(L, ends, out, W) : [];
  return { ends, out, w: W, x: X, freed, made, cancelled };
}

/**
 * move(L, s, e, q, { scramble }) -> { ok, state, from, to, movers, dir, passed, made, cancelled, freed } or
 *   { ok: false, reason, blockers?, state }
 * scramble (the level generator only): any knot but a stitched one may be
 * lifted, and nothing comes free.
 */
export function move(L, s, e, q, { scramble = false } = {}) {
  const why = scramble ? (L.fixed[e] || s.out[e >> 1] ? { reason: 'fixed', blockers: [] } : null) : canLift(L, s, e);
  if (why) return { ok: false, ...why, state: s };
  const w2 = whyNotTo(L, s, e, q);
  if (w2) return { ok: false, reason: w2, blockers: [], state: s };
  const path = pathOf(L, s.ends, e, q);
  const r = applyMove(L, s.ends, s.w, s.x, s.out, e, q, path, !scramble);
  const t = { v: VERSION, level: s.level, ends: r.ends, out: r.out, w: r.w, x: r.x, moves: s.moves + 1 };
  return { ok: true, state: t, from: s.ends[e], to: q, movers: movers(L, e), dir: path.dir, passed: path.passed, made: r.made, cancelled: r.cancelled, freed: r.freed };
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

// ---------- the solver and the bots ----------
// A position is the ends (peg or -1) plus the words. Plain strands are
// symmetric, so in the key each is read from its lower peg (its word turned
// round and its crossings' signs flipped to match); crossings are renumbered
// in reading order. Two positions with the same key play the same.

function ctxOf(L) {
  if (L._ctx) return L._ctx;
  const S = L.S;
  const sym = Array(S).fill(true);
  for (let e = 0; e < 2 * S; e++) if (L.fixed[e] || L.link[e] >= 0) sym[e >> 1] = false;
  const C = { L, S, n: L.n, sym };
  Object.defineProperty(L, '_ctx', { value: C, enumerable: false });
  return C;
}
function keyOf(C, ends, w, x) {
  const S = C.S, a = [];
  const flip = new Array(S);
  for (let s = 0; s < S; s++) {
    let p = ends[2 * s] + 2, q = ends[2 * s + 1] + 2;
    flip[s] = C.sym[s] && p > q;
    if (flip[s]) { const t = p; p = q; q = t; }
    a.push(p, q);
  }
  const map = new Int32Array(x.length).fill(-1);
  let next = 0;
  for (let s = 0; s < S; s++) {
    const ws = w[s], n = ws.length;
    a.push(100 + n);
    for (let k = 0; k < n; k++) {
      const c = flip[s] ? ws[n - 1 - k] : ws[k];
      if (map[c] < 0) map[c] = next++;
      const X = x[c];
      const sg = X[3] * (flip[X[0]] ? -1 : 1) * (flip[X[1]] ? -1 : 1);
      a.push(200 + map[c] * 4 + (X[2] === s ? 2 : 0) + (sg > 0 ? 1 : 0));
    }
  }
  return String.fromCharCode(...a);
}
// Legal moves on bare arrays: [e, q, e, q, ...]
function simMoves(C, ends, w, x) {
  const L = C.L, S = C.S, n = C.n;
  const out = [];
  for (let e = 0; e < 2 * S; e++) {
    const p = ends[e];
    if (p < 0 || L.fixed[e]) continue;
    const lk = L.link[e];
    if (lk >= 0 && lk < e) continue;
    const ms = lk >= 0 ? [e, lk] : [e];
    if (L.layering) {
      let blocked = false;
      for (const m of ms) {
        const c = nearestAt(w, m);
        if (c < 0) continue;
        const X = x[c], A = m >> 1, o = otherOf(X, A);
        if (X[2] !== A && !(lk >= 0 && o === (lk >> 1))) blocked = true;
      }
      if (blocked) continue;
    }
    for (let q = 0; q < n; q++) {
      if (ends.includes(q)) continue;
      let ok = true;
      for (const m of ms) {
        if (cdist(n, q, ends[m ^ 1]) < L.reach) { ok = false; break; }
        if (L.pegColor[q] && L.pegColor[q] !== L.color[m >> 1]) { ok = false; break; }
      }
      if (ok && ms.length === 2 && !pathOf(L, ends, e, q)) ok = false;
      if (ok) out.push(e, q);
    }
  }
  return out;
}
function simApply(C, st, e, q) {
  const r = applyMove(C.L, st.ends, st.w, st.x, st.out, e, q, pathOf(C.L, st.ends, e, q), true, false);
  return { ends: r.ends, out: r.out, w: r.w, x: r.x, freed: r.freed.length };
}
const simDone = (st) => st.out.every(Boolean);
const simCross = (st) => st.w.reduce((a, ws) => a + ws.length, 0) / 2;

// Lower bound on moves. A pair of strands whose crossings can't cancel
// between themselves (pairLeft > 0) stays crossed until one of the two
// moves, so some move must touch one of their units: the minimum vertex
// cover of that graph over units is admissible, and consistent (a move
// changes only pairs that involve the moved unit). A pair inside one unit
// forces that unit.
function vcBound(C, st) {
  const L = C.L, U = L.units.length, w = st.w, x = st.x;
  const adj = new Array(U).fill(0);
  let forced = 0, any = false;
  const cnt = new Int32Array(C.S);
  for (let a = 0; a < C.S; a++) {
    if (st.out[a] || !w[a].length) continue;
    cnt.fill(0);
    for (const c of w[a]) cnt[otherOf(x[c], a)]++;
    for (let b = a + 1; b < C.S; b++) {
      // one crossing (or any odd number) can't cancel; two or more might
      if (!cnt[b] || (!(cnt[b] & 1) && !pairLeft(w, x, a, b))) continue;
      const ua = L.unitOf[a], ub = L.unitOf[b];
      if (ua === ub) forced |= 1 << ua;
      else { adj[ua] |= 1 << ub; adj[ub] |= 1 << ua; any = true; }
    }
  }
  const pop = (v) => { let c = 0; while (v) { v &= v - 1; c++; } return c; };
  if (!any) return pop(forced);
  let best = Infinity;
  const rec = (alive, k) => {
    if (k >= best) return;
    let v = -1, dv = 0;
    for (let i = 0; i < U; i++) if (alive >> i & 1) { const d = pop(adj[i] & alive); if (d > dv) { dv = d; v = i; } }
    if (v < 0) { best = k; return; }
    rec(alive & ~(1 << v), k + 1);
    const nb = adj[v] & alive;
    rec(alive & ~nb & ~(1 << v), k + pop(nb));
  };
  rec(((1 << U) - 1) & ~forced, pop(forced));
  return best;
}
export const lowerBound = (L, s) => vcBound(ctxOf(L), s);

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v);
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
Heap.lt = (p, q) => (p.f !== q.f ? p.f < q.f : p.h !== q.h ? p.h < q.h : p.id < q.id);

/**
 * solve(L, s?, { cap, weight }) -> { ok, path: [[end, peg]], nodes, optimal, exhausted }
 * A* over positions with the vertex-cover bound (crossings break ties).
 * weight 1 gives a minimum-move solution; weight > 1 is faster and near-minimum.
 * nodes: positions expanded. exhausted: the whole reachable space was searched
 * (words can grow, so that only happens when nothing at all can move).
 */
export function solve(L, s = newState(L), { cap = 200000, weight = 1 } = {}) {
  const C = ctxOf(L);
  const st0 = { ends: s.ends.slice(), out: s.out.slice(), w: s.w.map((a) => a.slice()), x: s.x };
  if (simDone(st0)) return { ok: true, path: [], nodes: 0, optimal: true, exhausted: false };
  const best = new Map();
  const nodes = [];
  const open = new Heap();
  let id = 0;
  const h0 = vcBound(C, st0);
  const k0 = keyOf(C, st0.ends, st0.w, st0.x);
  nodes.push({ st: st0, g: 0, parent: -1, e: -1, q: -1, key: k0 });
  best.set(k0, 0);
  open.push({ f: weight * h0, h: h0 * 256 + simCross(st0), id: id++, k: 0 });
  let expanded = 0;
  while (open.size) {
    const top = open.pop();
    const nd = nodes[top.k];
    if (best.get(nd.key) < nd.g) continue;
    if (simDone(nd.st)) {
      const path = [];
      for (let k = top.k; nodes[k].parent >= 0; k = nodes[k].parent) path.push([nodes[k].e, nodes[k].q]);
      path.reverse();
      return { ok: true, path, nodes: expanded, optimal: weight === 1, exhausted: false };
    }
    if (++expanded > cap) return { ok: false, path: [], nodes: expanded, optimal: false, exhausted: false };
    const ms = simMoves(C, nd.st.ends, nd.st.w, nd.st.x);
    for (let k = 0; k < ms.length; k += 2) {
      const st = simApply(C, nd.st, ms[k], ms[k + 1]);
      const g = nd.g + 1;
      const kk = keyOf(C, st.ends, st.w, st.x);
      const old = best.get(kk);
      if (old !== undefined && old <= g) continue;
      best.set(kk, g);
      const h = vcBound(C, st);
      nodes.push({ st, g, parent: top.k, e: ms[k], q: ms[k + 1], key: kk });
      open.push({ f: g + weight * h, h: h * 256 + simCross(st), id: id++, k: nodes.length - 1 });
    }
  }
  return { ok: false, path: [], nodes: expanded, optimal: false, exhausted: true };
}

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

const startSt = (L) => ({ ends: L.start.slice(), out: Array(L.S).fill(0), w: L.startW.map((a) => a.slice()), x: L.startX });
/** A random player: any legal move, uniformly. Moves used to clear, or -1 within K. */
export function randomPlayout(L, rng, K) {
  const C = ctxOf(L);
  let st = startSt(L);
  for (let k = 1; k <= K; k++) {
    const ms = simMoves(C, st.ends, st.w, st.x);
    if (!ms.length) return -1;
    const i = Math.floor(rng() * (ms.length / 2)) * 2;
    st = simApply(C, st, ms[i], ms[i + 1]);
    if (simDone(st)) return k;
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
  let st = startSt(L);
  for (let k = 1; k <= K; k++) {
    const ms = simMoves(C, st.ends, st.w, st.x);
    if (!ms.length) return -1;
    let bestI = [], bs = Infinity;
    const kids = [];
    for (let i = 0; i < ms.length; i += 2) {
      const t = simApply(C, st, ms[i], ms[i + 1]);
      kids[i] = t;
      const sc = simCross(t);
      if (sc < bs) { bs = sc; bestI = [i]; } else if (sc === bs) bestI.push(i);
    }
    const i = bestI[Math.floor(rng() * bestI.length)];
    st = kids[i];
    if (simDone(st)) return k;
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

export const stateKey = (L, s) => keyOf(ctxOf(L), s.ends, s.w, s.x);

/** If s is exactly a position along the stored solution, its next move. */
export function solutionStep(L, s, solution = L.solution) {
  if (!solution) return null;
  const want = stateKey(L, s);
  let t = newState(L);
  for (const [e, q] of parseMoves(solution)) {
    if (stateKey(L, t) === want) {
      // the same position, but plain strands may have their ends swapped
      const p = t.ends[e];
      const here = endsAt(L, s, p).find((y) => (y >> 1) === (e >> 1));
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
  const st = { ends: s.ends, out: s.out, w: s.w, x: s.x };
  const ms = simMoves(C, s.ends, s.w, s.x);
  let bi = -1, bs = Infinity;
  for (let i = 0; i < ms.length; i += 2) {
    const t = simApply(C, st, ms[i], ms[i + 1]);
    const sc = (vcBound(C, t) * 64 + simCross(t)) - (simDone(t) ? 1e6 : 0);
    if (sc < bs) { bs = sc; bi = i; }
  }
  return bi >= 0 ? { kind: 'move', end: ms[bi], to: ms[bi + 1] } : { kind: 'tangled' };
}

// A short fingerprint of everything that shapes play (and of the model), so a
// save made on an older version of a level is set aside instead of misread.
export function levelSig(L) {
  const src = JSON.stringify([MODEL, L.n, L.reach, L.color, L.start, L.fixed, L.link, L.cwSide, L.pegColor, L.layering, L.startW, L.startX]);
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
