// The Tangle Basket: pure rules. No window/document/Date.now/Math.random.
// Everything random (generation, playouts) takes an explicit seed or rng.
// The save holds only ids, numbers and color keys, never objects from content.
//
// THE HEAP
// - A level is a heap of yarn strands on a board (100 x 140 units, or larger
//   for the deep baskets). Each strand is a smooth centripetal Catmull-Rom
//   spline through its control points, drawn W units thick.
// - Strands meet only at CROSSINGS: places where their centerlines come closer
//   than W * TOUCH (a clean X, or one strand lying along another for a while).
//   The generator keeps every meeting clearly overlapping, well apart from
//   other crossings, and never a near-miss sliver, so the rule and the picture
//   always agree. A strand may also cross itself (a loop). The arithmetic is
//   only + - * / and sqrt, so every browser finds exactly the same crossings.
// - Every crossing has its own over/under. Strands are listed bottom to top,
//   and by default the later strand lies on top; `flips` lists the crossings
//   that go the other way. So yarn weaves: over one neighbor, under the next.
// - A strand is COVERED while, at any crossing, a strand still in the heap
//   (and outside its own group, below) lies over it.
// - A TUCK is a crossing that holds a strand's very tip, with the tip
//   underneath: the end is tucked under the other strand. Same rule, drawn as
//   a tuck. (A tip lying on top is just an end resting across.)
//
// SNARLS
// - When strands lie over and under each other in a ring (A over B somewhere,
//   B over A somewhere else; or A over B over C over A), they are interlocked:
//   a SNARL. Snarls are exactly the cycles of the "lies over" graph (its
//   strongly connected components), and the generator makes sure that is the
//   only kind of cycle anywhere (see dependencyCycles).
// - A snarl comes out together, as one pull, once no strand outside it lies
//   over any of its strands, and the rack has room for all of them.
//
// PULLING
// - She taps a strand to pull it. Its group (the strand, its knotted partner,
//   or its whole snarl) comes out if nothing outside the group lies over it,
//   no pin or peg holds it, and the rack has room (below). Then it winds on.
// - The rack has `slots` places. Each holds one spool of one color. A pulled
//   strand winds onto the spool of its color if one is on the rack, otherwise it
//   starts a new spool in the leftmost empty place. A spool that reaches SPOOL
//   strands is complete: it pops off as a finished skein and frees its place.
// - Every color comes in a multiple of SPOOL strand-lengths, so every spool
//   fills in the end. With a full rack, only colors already on it can come out:
//   that is the planning.
//
// THE MECHANICS (each introduced on its own level, see levels.js)
// - Knot: two strands tied end to end come out together, as one pull.
// - Pin: a pinned strand stays put until the strand named by its pin (`by`,
//   the one matching the pin's glass head) has been pulled.
// - Peg: a strand looped round a peg stays put until a skein of the peg's
//   color is finished (on the shelf).
// - Variegated: a two-color strand puts one length on each color's spool.
// - Buried colors: a strand marked `q` looks undyed gray while it is covered.
//   A display rule only; the rules ignore it.
// - A smaller rack: `slots` is 4 instead of 5.
// - A travel rack: `slots` is 3 (the late cashmere baskets).
//
// NO FAIL STATE
// - Stuck: nothing can be pulled (in practice, the rack is full and no free
//   strand matches a spool). The UI offers Undo, then one free spare rack place
//   per level (the nudge), then Start over. Undo is unlimited.
//
// Within one pull, lengths wind on in the order that fits: colors already on
// the rack first (they may complete and free a place), then new ones, one
// color at a time.

export const VERSION = 1;
export const SPOOL = 3;   // strand-lengths per spool
export const NUDGES = 1;  // free spare rack places per level
export const W = 5.6;     // yarn thickness, board units
export const BOARD = { w: 100, h: 140 };
export const TOUCH = 0.9; // a crossing: centerlines closer than W * TOUCH
export const STEP = 1;    // spline sample spacing, board units (about)
export const SELF_GAP = 2.4 * W; // along one strand, samples this close in arc are neighbors, not a crossing

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
// Only + - * / and Math.sqrt (correctly rounded everywhere), so a level builds
// to the same crossings in every browser.
const dist = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };

// Centripetal Catmull-Rom through control points [[x,y],...]: no cusps or
// self-loops inside a segment, so yarn never kinks. Sampled about every STEP
// units; passes exactly through every control point.
export const spline = (ctrl) => splineIdx(ctrl).poly;
// The same, with the sample index of every control point.
export function splineIdx(ctrl) {
  const n = ctrl.length;
  if (n < 2) return { poly: ctrl.map((p) => [p[0], p[1]]), idx: ctrl.map((_, k) => k) };
  const idx = [0];
  const P = (k) => {
    if (k < 0) return [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]];
    if (k >= n) return [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]];
    return ctrl[k];
  };
  const out = [[ctrl[0][0], ctrl[0][1]]];
  for (let k = 0; k < n - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const d01 = dist(p0[0], p0[1], p1[0], p1[1]), d12 = dist(p1[0], p1[1], p2[0], p2[1]), d23 = dist(p2[0], p2[1], p3[0], p3[1]);
    const t0 = 0, t1 = t0 + Math.sqrt(Math.max(1e-4, d01)), t2 = t1 + Math.sqrt(Math.max(1e-4, d12)), t3 = t2 + Math.sqrt(Math.max(1e-4, d23));
    const steps = Math.max(2, Math.ceil((d12 / STEP) * 1.25));
    for (let s = 1; s <= steps; s++) {
      if (s === steps) { out.push([p2[0], p2[1]]); break; }
      const t = t1 + ((t2 - t1) * s) / steps;
      const pt = [0, 1].map((c) => {
        const A1 = ((t1 - t) / (t1 - t0)) * p0[c] + ((t - t0) / (t1 - t0)) * p1[c];
        const A2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
        const A3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
        const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        return ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
      });
      out.push(pt);
    }
    idx.push(out.length - 1);
  }
  return { poly: out, idx };
}

export function arcLengths(poly) {
  const cum = [0];
  for (let k = 1; k < poly.length; k++) cum.push(cum[k - 1] + dist(poly[k][0], poly[k][1], poly[k - 1][0], poly[k - 1][1]));
  return cum;
}

// Tightest bend along a polyline (board units; Infinity for a straight line):
// the radius of the circle through three samples about `span` apart.
export function minRadius(poly, cum, span = 2) {
  let best = Infinity;
  let j = 0, k = 0;
  for (let i = 0; i < poly.length; i++) {
    while (j < poly.length - 1 && cum[j + 1] - cum[i] < span) j++;
    while (k < poly.length - 1 && cum[k] - cum[i] < 2 * span) k++;
    if (k >= poly.length - 1 && cum[poly.length - 1] - cum[i] < 2 * span) break;
    const a = poly[i], b = poly[j], c = poly[k];
    const ab = dist(a[0], a[1], b[0], b[1]), bc = dist(b[0], b[1], c[0], c[1]), ca = dist(c[0], c[1], a[0], a[1]);
    const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cr < 1e-9) continue;
    const r = (ab * bc * ca) / (2 * cr);
    if (r < best) best = r;
  }
  return best;
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
// or Infinity when farther than one grid cell. nearIdx: which sample.
export function nearIdx(p, poly, grid) {
  const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
  let best = Infinity, bk = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = grid.get(cellKey(gx + dx, gy + dy));
    if (!a) continue;
    for (const k of a) {
      const d = dist(poly[k][0], poly[k][1], p[0], p[1]);
      if (d < best) { best = d; bk = k; }
    }
  }
  return best > CELL ? { d: Infinity, k: -1 } : { d: best, k: bk };
}
export const nearDist = (p, poly, grid) => nearIdx(p, poly, grid).d;
export function minDist(a, b, gridB) {
  let best = Infinity;
  for (const p of a) { const d = nearDist(p, b, gridB); if (d < best) best = d; }
  return best;
}
export const bboxOf = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
// The half-length (along the over strand) of the patch drawn at a crossing:
// the over strand is painted again on top for this far either side, which
// covers where the under strand's body (and its edge) meets it. It grows as
// the crossing gets shallower. sin: sine of the crossing angle.
export const patchR = (sin) => {
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  return Math.min(2.4 * W, W * (0.55 / sin + (0.5 * cos) / sin + 0.22));
};
// The same for a contact that runs some way along (span: how far either side
// of its middle the centerlines stay within W * TOUCH).
export const patchLen = (sin, span) => Math.min(6 * W, Math.max(patchR(sin), span + 0.45 * W));
export const tangentAt = (poly, k) => {
  const a = poly[Math.max(0, k - 2)], b = poly[Math.min(poly.length - 1, k + 2)];
  const d = dist(a[0], a[1], b[0], b[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};

/**
 * Every place two strands (or one strand and itself) meet, as crossings.
 * partner: knot partners (their joint is not a crossing). flips: Set of
 * crossing ids "a.b.k" whose over/under goes against the default.
 * Returns [{ id, a, b, ord, ka, kb, x, y, self, over, under, ko, ku, sin, r, ra, rb, tipA, tipB, tuck }]
 *   a <= b; ka/kb: sample index of the crossing on a and on b; over/under:
 *   strands (equal for a self-crossing; then ko/ku say which pass is on top);
 *   sin: sine of the crossing angle; r: half-length of the patch drawn for it
 *   (along the over strand; ra/rb: along a and along b);
 *   tipA/tipB: -1, or 0/1 when a's (b's) start/end tip lies in this contact;
 *   tuck: the same for the under strand (its tip is tucked under the other).
 */
export function findCrossings(poly, cum, partner = [], flips = new Set()) {
  const n = poly.length;
  const R = W * TOUCH, C = W;
  const key = (gx, gy) => (gx + 64) * 8192 + (gy + 64);
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    for (let k = 0; k < p.length; k++) {
      const kk = key(Math.floor(p[k][0] / C), Math.floor(p[k][1] / C));
      let a = cells.get(kk);
      if (!a) cells.set(kk, (a = []));
      a.push(i, k);
    }
  }
  const out = [];
  for (let a = 0; a < n; a++) {
    const pa = poly[a], ca = cum[a];
    const near = new Map();
    for (let k = 0; k < pa.length; k++) {
      const x = pa[k][0], y = pa[k][1], gx = Math.floor(x / C), gy = Math.floor(y / C);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const list = cells.get(key(gx + dx, gy + dy));
        if (!list) continue;
        for (let t = 0; t < list.length; t += 2) {
          const b = list[t], j = list[t + 1];
          if (b < a || partner[a] === b) continue;
          if (b === a && Math.abs(ca[j] - ca[k]) < SELF_GAP) continue;
          const q = poly[b][j];
          const d = dist(q[0], q[1], x, y);
          if (d >= R) continue;
          let rec = near.get(b);
          if (!rec) { rec = { d: new Float64Array(pa.length).fill(Infinity), j: new Int32Array(pa.length) }; near.set(b, rec); }
          if (d < rec.d[k]) { rec.d[k] = d; rec.j[k] = j; }
        }
      }
    }
    for (const b of [...near.keys()].sort((x, y) => x - y)) {
      const rec = near.get(b);
      let ord = 0;
      for (let k = 0; k < pa.length; k++) {
        if (rec.d[k] === Infinity) continue;
        let e = k, km = k;
        const k0 = k;
        while (e + 1 < pa.length && rec.d[e + 1] < Infinity) { e++; if (rec.d[e] < rec.d[km]) km = e; }
        k = e;
        const kb = rec.j[km];
        if (a === b && kb < km) continue; // a self-crossing is counted once, from its first pass
        const pb = poly[b];
        const ta = tangentAt(pa, km), tb = tangentAt(pb, kb);
        const sin = Math.max(0.05, Math.abs(ta[0] * tb[1] - ta[1] * tb[0]));
        // how far along each strand the two lie on each other
        const ra = Math.max(ca[km] - ca[k0], ca[e] - ca[km]), cbb = cum[b];
        const rb = Math.max(Math.abs(cbb[rec.j[k0]] - cbb[kb]), Math.abs(cbb[rec.j[e]] - cbb[kb]));
        // a tip inside the contact: a's own tips, and b's tips near this stretch of a
        const tipA = k0 === 0 ? 0 : e === pa.length - 1 ? 1 : -1;
        let tipB = -1;
        if (a !== b) {
          const pb0 = poly[b];
          for (const [tk, tv] of [[0, 0], [pb0.length - 1, 1]]) {
            for (let q = k0; q <= e; q++) if (dist(pa[q][0], pa[q][1], pb0[tk][0], pb0[tk][1]) < R) { tipB = tv; break; }
          }
        }
        const id = `${a}.${b}.${ord}`;
        const flip = flips.has(id);
        // default: the later strand (or the later pass of a loop) lies on top
        const overB = !flip;
        const c = {
          id, a, b, ord: ord++, ka: km, kb, x: (pa[km][0] + pb[kb][0]) / 2, y: (pa[km][1] + pb[kb][1]) / 2, self: a === b,
          over: overB ? b : a, under: overB ? a : b, ko: overB ? kb : km, ku: overB ? km : kb, sin,
          r: patchLen(sin, overB ? rb : ra), ra: patchLen(sin, ra), rb: patchLen(sin, rb), tipA, tipB,
          tuck: a === b ? -1 : overB ? tipA : tipB,
        };
        out.push(c);
      }
    }
  }
  return out;
}

// Strongly connected components (Tarjan, iterative) of a graph given as
// adjacency lists. Returns components with more than one node, each sorted.
export function sccs(adj) {
  const n = adj.length;
  const index = Array(n).fill(-1), low = Array(n).fill(0), on = Array(n).fill(false);
  const stack = [], out = [];
  let idx = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] >= 0) continue;
    const work = [[s, 0]];
    index[s] = low[s] = idx++; stack.push(s); on[s] = true;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < adj[v].length) {
        const w = adj[v][top[1]++];
        if (index[w] < 0) { index[w] = low[w] = idx++; stack.push(w); on[w] = true; work.push([w, 0]); } else if (on[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === index[v]) {
          const comp = [];
          let w;
          do { w = stack.pop(); on[w] = false; comp.push(w); } while (w !== v);
          if (comp.length > 1) out.push(comp.sort((x, y) => x - y));
        }
      }
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// ---------- levels ----------

// def: { id, name, slots, board?: [w, h], strands: [{ c, c2?, q?, p: [x0,y0,x1,y1,...] }],
//        knots?: [[a,b]] (a's end is tied to b's start), pins?: [[s,by]],
//        pegs?: [[s, color, x, y]], flips?: [[a,b,k]], snarls?: [[...]] (stored for reference) }
export function buildLevel(def) {
  const board = def.board ? { w: def.board[0], h: def.board[1] } : { ...BOARD };
  const strands = def.strands.map((s) => {
    const ctrl = [];
    for (let k = 0; k < s.p.length; k += 2) ctrl.push([s.p[k], s.p[k + 1]]);
    return { c: s.c, c2: s.c2 || null, q: !!s.q, ctrl };
  });
  const n = strands.length;
  const poly = strands.map((s) => spline(s.ctrl));
  const cum = poly.map(arcLengths);
  const grids = poly.map(gridOf);
  const boxes = poly.map(bboxOf);
  const partner = Array(n).fill(-1);
  const knots = (def.knots || []).map((k) => k.slice());
  for (const [a, b] of knots) { partner[a] = b; partner[b] = a; }
  const flips = new Set((def.flips || []).map((f) => f.join('.')));
  const cross = findCrossings(poly, cum, partner, flips);
  const crossOf = poly.map(() => []);
  const overSet = poly.map(() => new Set());
  for (const c of cross) {
    crossOf[c.a].push(c);
    if (!c.self) { crossOf[c.b].push(c); overSet[c.under].add(c.over); }
  }
  const over = overSet.map((s) => [...s].sort((x, y) => x - y));
  const under = poly.map(() => []);
  over.forEach((o, i) => { for (const j of o) under[j].push(i); });
  // snarls: the rings of "lies over" (strongly connected components)
  const snarls = sccs(over);
  // groups: knotted pairs and snarls (merged if they ever share a strand)
  const root = [...Array(n).keys()];
  const find = (x) => { while (root[x] !== x) x = root[x] = root[root[x]]; return x; };
  const join = (x, y) => { x = find(x); y = find(y); if (x !== y) root[Math.max(x, y)] = Math.min(x, y); };
  for (const [a, b] of knots) join(a, b);
  for (const s of snarls) for (const m of s) join(s[0], m);
  const members = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!members.has(r)) members.set(r, []); members.get(r).push(i); }
  const group = Array(n);
  for (const g of members.values()) for (const m of g) group[m] = g;
  const snarlOf = Array(n).fill(-1);
  snarls.forEach((s, k) => { for (const m of s) snarlOf[m] = k; });
  const pinBy = Array(n).fill(-1), pinAt = Array(n).fill(null);
  for (const [s, by] of def.pins || []) {
    pinBy[s] = by;
    // the pin sits on s where it comes closest to its neighbor
    let best = 0, bd = Infinity;
    poly[s].forEach((p, k) => { for (const q of poly[by]) { const d = dist(p[0], p[1], q[0], q[1]); if (d < bd) { bd = d; best = k; } } });
    pinAt[s] = best;
  }
  const pegC = Array(n).fill(null), pegs = (def.pegs || []).map((p) => p.slice());
  for (const [s, c] of pegs) pegC[s] = c;
  const colors = [];
  for (const s of strands) for (const c of s.c2 ? [s.c, s.c2] : [s.c]) if (!colors.includes(c)) colors.push(c);
  const units = {};
  for (const s of strands) for (const c of s.c2 ? [s.c, s.c2] : [s.c]) units[c] = (units[c] || 0) + 1;
  return {
    id: def.id, name: def.name, slots: def.slots ?? 5, board, n, strands, poly, cum, grids, boxes, cross, crossOf, over, under,
    snarls, snarlOf, group, partner, pinBy, pinAt, pegC, pegs, colors, units, knots,
    pins: (def.pins || []).map((p) => p.slice()), flips: (def.flips || []).map((f) => f.slice()),
    tucks: cross.filter((c) => c.tuck >= 0).length,
  };
}

export const colorsOf = (L, i) => (L.strands[i].c2 ? [L.strands[i].c, L.strands[i].c2] : [L.strands[i].c]);
export const groupOf = (L, i) => L.group[i];
export const unitsBalanced = (L) => Object.values(L.units).every((u) => u % SPOOL === 0);
export const isSnarled = (L, i) => L.snarlOf[i] >= 0;

// Which mechanics a level uses (for intro cards and the level list).
export function mechanicsOf(L) {
  const m = [];
  if (L.knots.length) m.push('knot');
  if (L.pins.length) m.push('pin');
  if (L.strands.some((s) => s.c2)) m.push('variegated');
  if (L.strands.some((s) => s.q)) m.push('buried');
  if (L.slots < 5) m.push(L.slots < 4 ? 'rack3' : 'rack4');
  if (L.snarls.some((s) => s.length === 2)) m.push('snarl');
  if (L.snarls.some((s) => s.length > 2)) m.push('snarl3');
  if (L.tucks) m.push('tuck');
  if (L.pegs.length) m.push('peg');
  if (L.board.w >= 1.4 * BOARD.w) m.push('deep'); // big enough to want zooming
  return m;
}

// The dependency graph between strands: i -> j when j must go first (j lies
// over i at a crossing, or j holds i's pin). Pegs wait on a finished skein,
// not on one strand, so they are checked by clearsWithRoom below.
export function dependencyGraph(L) {
  return L.over.map((o, i) => (L.pinBy[i] >= 0 && !o.includes(L.pinBy[i]) ? [...o, L.pinBy[i]] : o.slice()));
}
// Every cycle of the dependency graph, as its strongly connected components.
// A fair level has these equal to its snarls: no other cycle anywhere.
export const dependencyCycles = (L) => sccs(dependencyGraph(L));

// With groups (knots and snarls) taken as one, the dependency graph has no cycle.
export function acyclic(L) {
  const rep = (i) => L.group[i][0];
  const adj = Array.from({ length: L.n }, () => []);
  const g = dependencyGraph(L);
  for (let i = 0; i < L.n; i++) for (const j of g[i]) if (rep(j) !== rep(i)) adj[rep(i)].push(rep(j));
  return sccs(adj).length === 0;
}
// Ignoring the rack: can the whole heap come out in some order (pins, pegs
// and all)? Pulling more never blocks anything, so pulling whatever is free
// until nothing is left decides it.
export function clearsWithRoom(L) {
  const out = Array(L.n).fill(0), cnt = {};
  let left = L.n, moved = true;
  while (left && moved) {
    moved = false;
    for (let i = 0; i < L.n; i++) {
      if (out[i] || L.group[i][0] !== i) continue;
      const g = L.group[i];
      const free = g.every((m) => L.over[m].every((j) => out[j] || g.includes(j)) && (L.pinBy[m] < 0 || out[L.pinBy[m]] || g.includes(L.pinBy[m])) && (!L.pegC[m] || (cnt[L.pegC[m]] || 0) >= SPOOL));
      if (!free) continue;
      for (const m of g) { out[m] = 1; left--; for (const c of colorsOf(L, m)) cnt[c] = (cnt[c] || 0) + 1; }
      moved = true;
    }
  }
  return left === 0;
}

// How deep the heap goes: for each strand, the longest chain of strands lying
// over it, one above the other (snarls and knots counted as one).
export function depths(L) {
  const memo = Array(L.n).fill(-1);
  const busy = Array(L.n).fill(false);
  const d = (i) => {
    const g = L.group[i];
    const r = g[0];
    if (memo[r] >= 0) return memo[r];
    if (busy[r]) return 0;
    busy[r] = true;
    let best = 0;
    for (const m of g) for (const j of L.over[m]) if (!g.includes(j)) best = Math.max(best, 1 + d(j));
    busy[r] = false;
    memo[r] = best;
    return best;
  };
  return [...Array(L.n).keys()].map(d);
}

// ---------- state ----------

export function newState(L) {
  return { v: VERSION, level: L.id, out: Array(L.n).fill(0), rack: Array(L.slots).fill(null), skeins: [], extra: 0, moves: 0 };
}
const clone = (s) => ({ ...s, out: s.out.slice(), rack: s.rack.map((x) => (x ? { ...x } : null)), skeins: s.skeins.slice() });

export const isDone = (s) => s.out.every(Boolean);
export const remaining = (s) => s.out.reduce((a, x) => a + (x ? 0 : 1), 0);
// Strands still in the heap, outside i's group, that lie over strand i.
export const coveredBy = (L, s, i) => L.over[i].filter((j) => !s.out[j] && !L.group[i].includes(j));
export const isUncovered = (L, s, i) => !s.out[i] && L.over[i].every((j) => s.out[j] || L.group[i].includes(j));
export const isPinned = (L, s, i) => L.pinBy[i] >= 0 && !s.out[L.pinBy[i]];
export const isPegged = (L, s, i) => !!L.pegC[i] && !s.skeins.includes(L.pegC[i]);
// What shows: a buried strand looks gray until it is uncovered.
export const showsColor = (L, s, i) => !L.strands[i].q || isUncovered(L, s, i);

// The order a pull's lengths wind on, or null if the rack has no room.
// cnt: lengths of each color wound so far; cap: rack places. Lengths of one
// color always go on together; colors already on the rack go first, then
// colors that this pull completes, then the rest. If that doesn't fit, every
// order of the colors is tried (a pull has only a few).
function windOrder(cnt, cap, units) {
  const occ0 = Object.keys(cnt).filter((c) => cnt[c] % SPOOL !== 0).length;
  const byColor = new Map();
  for (const u of units) { if (!byColor.has(u.c)) byColor.set(u.c, []); byColor.get(u.c).push(u); }
  const cols = [...byColor.keys()];
  const fits = (order) => {
    const k = { ...cnt };
    let occ = occ0;
    for (const c of order) {
      for (let u = 0; u < byColor.get(c).length; u++) {
        if ((k[c] || 0) % SPOOL === 0) { if (occ >= cap) return false; occ++; }
        k[c] = (k[c] || 0) + 1;
        if (k[c] % SPOOL === 0) occ--;
      }
    }
    return true;
  };
  const rank = (c) => ((cnt[c] || 0) % SPOOL ? 0 : byColor.get(c).length >= SPOOL ? 1 : 2);
  const first = cols.slice().sort((a, b) => rank(a) - rank(b));
  const flat = (order) => order.flatMap((c) => byColor.get(c));
  if (fits(first)) return flat(first);
  if (cols.length < 2 || cols.length > 6) return null;
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  for (const p of perms(cols)) if (fits(p)) return flat(p);
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
 *   { reason: 'gone' | 'covered' | 'pinned' | 'pegged' | 'rack', blockers, pins, pegs, colors, group }
 * covered: blockers = strands outside the group lying over any of its strands.
 * pinned: pins = the strands whose pins still hold the group.
 * pegged: pegs = the colors whose skein the group's pegs wait for.
 * rack: colors = the colors that would need a new spool.
 */
export function whyNot(L, s, i) {
  const g = L.group[i];
  const none = { blockers: [], pins: [], pegs: [], colors: [], group: g };
  if (g.some((m) => s.out[m])) return { ...none, reason: 'gone' };
  const blockers = [];
  for (const m of g) for (const j of coveredBy(L, s, m)) if (!blockers.includes(j)) blockers.push(j);
  if (blockers.length) return { ...none, reason: 'covered', blockers };
  const pins = g.filter((m) => isPinned(L, s, m) && !g.includes(L.pinBy[m])).map((m) => L.pinBy[m]);
  if (pins.length) return { ...none, reason: 'pinned', pins };
  const pegs = [...new Set(g.filter((m) => isPegged(L, s, m)).map((m) => L.pegC[m]))];
  if (pegs.length) return { ...none, reason: 'pegged', pegs };
  const cnt = countsOf(s);
  const units = unitsOf(L, g);
  if (!windOrder(cnt, s.rack.length, units)) {
    const colors = [...new Set(units.map((u) => u.c).filter((c) => !cnt[c]))];
    return { ...none, reason: 'rack', colors };
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
  const g = L.group[i];
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
    if (s.out[i] || L.group[i][0] !== i) continue;
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

// Is s a state this level could be in? (For loading a save.)
export function validState(L, s) {
  if (!s || s.v !== VERSION || s.level !== L.id || !Array.isArray(s.out) || s.out.length !== L.n) return false;
  if (!s.out.every((x) => x === 0 || x === 1)) return false;
  if (!Number.isInteger(s.extra) || s.extra < 0 || s.extra > NUDGES || !Number.isInteger(s.moves) || s.moves < 0) return false;
  if (!Array.isArray(s.rack) || s.rack.length !== L.slots + s.extra || !Array.isArray(s.skeins)) return false;
  // groups come out whole
  for (let i = 0; i < L.n; i++) if (L.group[i].some((m) => s.out[m] !== s.out[i])) return false;
  // the rack must agree with what has been pulled
  const cnt = {};
  for (let i = 0; i < L.n; i++) if (s.out[i]) for (const c of colorsOf(L, i)) cnt[c] = (cnt[c] || 0) + 1;
  const onRack = {};
  for (const x of s.rack) {
    if (x === null) continue;
    if (!x || !L.colors.includes(x.c) || !Number.isInteger(x.n) || x.n < 1 || x.n >= SPOOL || onRack[x.c]) return false;
    onRack[x.c] = x.n;
  }
  for (const c of L.colors) if ((cnt[c] || 0) % SPOOL !== (onRack[c] || 0)) return false;
  const sk = Object.values(cnt).reduce((a, v) => a + Math.floor(v / SPOOL), 0);
  return s.skeins.length === sk && s.skeins.every((c) => L.colors.includes(c));
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

// ---------- tapping: which strand is under a finger ----------

/**
 * pickStrand(L, s, p, reach) -> strand index or -1. p: a board point; reach:
 * how far from a centerline a tap still counts (board units). Within reach:
 * the nearest strand that can be pulled; else the nearest with nothing on
 * top; else the one on top where the finger is (at a crossing, the one lying
 * over); else the nearest. Pure, so it is the same at every zoom: the UI only
 * turns a screen point into a board point (view.js).
 */
export function pickStrand(L, s, p, reach) {
  const cands = [];
  for (let i = 0; i < L.n; i++) {
    if (s.out[i]) continue;
    const b = L.boxes[i];
    if (p[0] < b[0] - reach || p[0] > b[2] + reach || p[1] < b[1] - reach || p[1] > b[3] + reach) continue;
    let d = Infinity;
    if (reach <= CELL) d = nearDist(p, L.poly[i], L.grids[i]);
    else for (const q of L.poly[i]) { const e = dist(q[0], q[1], p[0], p[1]); if (e < d) d = e; }
    if (d <= reach) cands.push({ i, d });
  }
  if (!cands.length) return -1;
  const near = (a, b) => a.d - b.d || b.i - a.i;
  const pullable = cands.filter((c) => canPull(L, s, c.i)).sort(near);
  if (pullable.length) return pullable[0].i;
  const free = cands.filter((c) => isUncovered(L, s, c.i)).sort(near);
  if (free.length) return free[0].i;
  const onBody = cands.filter((c) => c.d <= W / 2 + 0.4).sort(near);
  if (onBody.length > 1) {
    // at a crossing: the one lying over
    for (const c of L.cross) {
      if (c.self || dist(c.x, c.y, p[0], p[1]) > c.r) continue;
      if (onBody.some((o) => o.i === c.over) && onBody.some((o) => o.i === c.under)) return c.over;
    }
  }
  if (onBody.length) return onBody[0].i;
  return cands.sort(near)[0].i;
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
  for (let i = 0; i < L.n; i++) if (L.group[i][0] === i) groups.push(L.group[i]);
  const gUnits = groups.map((g) => g.flatMap((m) => unitC[m]));
  const gDeps = groups.map((g) => {
    const d = new Set();
    for (const m of g) { for (const j of L.over[m]) if (!g.includes(j)) d.add(j); if (L.pinBy[m] >= 0 && !g.includes(L.pinBy[m])) d.add(L.pinBy[m]); }
    return [...d];
  });
  const gPegs = groups.map((g) => [...new Set(g.filter((m) => L.pegC[m]).map((m) => ci[L.pegC[m]]))]);
  return { out: Uint8Array.from(s.out), cnt, cap: s.rack.length, groups, gUnits, gDeps, gPegs, left: remaining(s) };
}
function simOcc(S) { let o = 0; for (const x of S.cnt) if (x % SPOOL) o++; return o; }
// Can group gi wind on now? Returns the number of spools it completes, or -1.
function simFits(S, gi, occ) {
  const u = S.gUnits[gi];
  if (u.length === 1) {
    const c = u[0];
    if (S.cnt[c] % SPOOL === 0 && occ >= S.cap) return -1;
    return (S.cnt[c] + 1) % SPOOL === 0 ? 1 : 0;
  }
  const cols = [...new Set(u)];
  const m = cols.map((c) => u.filter((x) => x === c).length);
  const tryOrder = (order) => {
    let o = occ, pops = 0;
    for (const ix of order) {
      let k = S.cnt[cols[ix]];
      for (let r = 0; r < m[ix]; r++) {
        if (k % SPOOL === 0) { if (o >= S.cap) return -1; o++; }
        k++;
        if (k % SPOOL === 0) { o--; pops++; }
      }
    }
    return pops;
  };
  const rank = (ix) => (S.cnt[cols[ix]] % SPOOL ? 0 : m[ix] >= SPOOL ? 1 : 2);
  const first = cols.map((_, ix) => ix).sort((a, b) => rank(a) - rank(b));
  const r = tryOrder(first);
  if (r >= 0 || cols.length < 2 || cols.length > 6) return r;
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  for (const p of perms(first)) { const q = tryOrder(p); if (q >= 0) return q; }
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
    for (const c of S.gPegs[gi]) if (S.cnt[c] < SPOOL) { free = false; break; }
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
 * lists one strand per pull (the lowest index of its group).
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
      if (blind && L.strands[i].q && !L.over[i].every((j) => S.out[j] || L.group[i].includes(j))) continue;
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
    for (const g of L.group[m]) t[g] = 1;
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
  const src = JSON.stringify([L.slots, L.board.w, L.strands.map((s) => [s.c, s.c2, s.ctrl]), L.knots, L.pins, L.pegs, L.flips]);
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
  { min: 16, one: 'a cardigan with pockets', many: 'a fair-isle cardigan' },
  { min: 20, one: 'a big cabled throw', many: 'a granny-square throw' },
];
export function knitsInto(skeins) {
  const n = skeins.length;
  const kinds = new Set(skeins).size;
  let pick = KNITS[0];
  for (const k of KNITS) if (n >= k.min) pick = k;
  const what = kinds >= 3 ? pick.many : pick.one;
  return { skeins: n, yards: n * YARDS_PER_SKEIN, what, line: `Enough for ${what}.` };
}
