// The Hoop: drawing the words (pure; no window/document). Used by app.js and
// by the tests that prove the picture matches the rule.
//
// The words and signs (rules.js) are a signed Gauss code: a planar map whose
// vertices are the pegs (on the rim) and the crossings, and whose edges are
// the pieces of yarn between them. To draw it:
//   1. build the map: at a crossing the four pieces leave in the order the
//      sign says; at a knot the tail(s) leave inward between the rim's two
//      neighbors (a shared knot's clockwise tail first);
//   2. subdivide every piece (so two pieces between the same crossings, a
//      clasp's lens, are separate paths), put a hub in every face and tie it
//      to the face's corners: a triangulated disk with the rim fixed;
//   3. place it with a weighted Tutte embedding (each free point at the
//      weighted average of its neighbors). Yarn edges pull hard (the strands
//      are taut), hub edges pull softly (faces, and a clasp's two loops, stay
//      open). Tutte's theorem: a straight-line drawing with no extra
//      crossings, every crossing where the code says;
//   4. smooth each strand through its points (centripetal Catmull-Rom). The
//      tests check every crossing appears exactly once and nothing else does.
// A crossing hooked at a knot pulls toward that peg, so a strand that went
// over a knot's tail wraps round it: two hooked strands look like two
// interlocked loops.
import { pegUnit, otherOf } from './rules.js';

export const SUB = 3;                  // points in each piece of yarn between crossings
export const W_YARN = 1, W_FACE = 0.16; // pull of yarn edges / face hubs

/**
 * planarMap(L, s) -> { V: [{ fixed, p? }], adj: [[v...] in ccw order], paths: { strand: [v...] }, cross: { id: v }, faces: [[v...]], outer }
 * Pegs are vertices 0..n-1. Only strands still on the hoop are included.
 */
export function planarMap(L, s) {
  const n = L.n, V = [], adj = [];
  for (let p = 0; p < n; p++) { V.push({ fixed: true, p: pegUnit(n, p), peg: p }); adj.push([]); }
  const nv = (o) => { V.push(o); adj.push([]); return V.length - 1; };
  const cross = {};
  for (let c = 0; c < s.x.length; c++) if (s.x[c]) cross[c] = nv({ fixed: false, crossing: c });
  const paths = {};
  // each strand: knot, (SUB dummies, crossing)*, SUB dummies, knot
  const tailFirst = {}; // end -> first vertex after the knot
  const nbr = {};       // crossing vertex -> { aPrev, aNext, bPrev, bNext }
  for (let i = 0; i < L.S; i++) {
    if (s.out[i]) continue;
    const seq = [s.ends[2 * i], ...s.w[i].map((c) => cross[c]), s.ends[2 * i + 1]];
    const path = [seq[0]];
    for (let k = 0; k + 1 < seq.length; k++) {
      const u = seq[k], v = seq[k + 1];
      let prev = u;
      for (let d = 0; d < SUB; d++) {
        const m = nv({ fixed: false, strand: i });
        adj[m].push(prev, -1); // next filled below
        path.push(m);
        prev = m;
      }
      path.push(v);
    }
    // wire up the path
    for (let k = 1; k + 1 < path.length; k++) {
      const v = path[k];
      if (V[v].crossing === undefined) { adj[v] = [path[k - 1], path[k + 1]]; continue; }
      const c = V[v].crossing, X = s.x[c];
      const r = nbr[v] || (nbr[v] = {});
      if (X[0] === i) { r.aPrev = path[k - 1]; r.aNext = path[k + 1]; } else { r.bPrev = path[k - 1]; r.bNext = path[k + 1]; }
    }
    tailFirst[2 * i] = path[1];
    tailFirst[2 * i + 1] = path[path.length - 2];
    paths[i] = path;
  }
  // crossings: ccw order by the sign (b turns left of a when sign > 0)
  for (const v of Object.values(cross)) {
    const r = nbr[v], X = s.x[V[v].crossing];
    adj[v] = X[3] > 0 ? [r.aNext, r.bNext, r.aPrev, r.bPrev] : [r.aNext, r.bPrev, r.aPrev, r.bNext];
  }
  // pegs: the next peg clockwise, the tails (clockwise one first), the previous peg
  for (let p = 0; p < n; p++) {
    const tails = [];
    for (let e = 0; e < 2 * L.S; e++) if (s.ends[e] === p && !s.out[e >> 1]) tails.push(e);
    if (tails.length === 2) tails.sort((a, b) => L.cwSide[b] - L.cwSide[a]);
    adj[p] = [(p + 1) % n, ...tails.map((e) => tailFirst[e]), (p - 1 + n) % n];
  }
  // faces: walk each dart, turning to the neighbor just before the one we came from
  const pos = adj.map((a) => { const m = new Map(); a.forEach((u, k) => m.set(u, k)); return m; });
  const seen = new Set(), faces = [];
  let outer = -1;
  for (let u = 0; u < V.length; u++) for (const v of adj[u]) {
    if (seen.has(u * 100000 + v)) continue;
    const f = [];
    let a = u, b = v, guard = 0;
    while (!seen.has(a * 100000 + b)) {
      seen.add(a * 100000 + b);
      f.push(a);
      const k = pos[b].get(a), d = adj[b].length;
      const c = adj[b][(k - 1 + d) % d];
      a = b; b = c;
      if (++guard > 100000) throw new Error('face walk');
    }
    // with any strand on the hoop, the only face made of pegs alone is the outside
    if (outer < 0 && f.length === n && f.every((y) => y < n)) outer = faces.length;
    faces.push(f);
  }
  return { V, adj, paths, cross, faces, outer, nbr };
}

/** Euler check for the map: V - E + F = 2. */
export function eulerOk(M) {
  let E2 = 0;
  for (const a of M.adj) E2 += a.length;
  return M.V.length - E2 / 2 + M.faces.length === 2;
}

/**
 * layout(L, s, { iters }) -> { strands: { i: [[x,y]...] smoothed, unit disk },
 *   raw: { i: [[x,y]] }, crossings: [{ c, p, a, b, top, ka, kb }], map }
 * ka/kb: index of the crossing in each strand's smoothed polyline.
 */
export function layout(L, s, { iters = 4000, tol = 1e-9, prev = null, wf = W_FACE } = {}) {
  const M = planarMap(L, s);
  const { V, faces, outer } = M;
  // neighbors with weights: yarn edges, and a hub for every inner face
  const nb = V.map(() => []);
  const link = (u, v, wt) => { nb[u].push(v, wt); nb[v].push(u, wt); };
  for (const path of Object.values(M.paths)) for (let k = 0; k + 1 < path.length; k++) link(path[k], path[k + 1], W_YARN);
  const nFixed = V.length;
  const P = V.map((v) => (v.fixed ? v.p.slice() : [0, 0]));
  faces.forEach((f, fi) => {
    if (fi === outer) return;
    const h = P.length;
    P.push([0, 0]); nb.push([]);
    for (const v of new Set(f)) link(h, v, wf);
  });
  const fixed = (v) => v < nFixed && V[v].fixed;
  // start: each strand's points along its chord (a warm start from prev if given)
  for (const [i, path] of Object.entries(M.paths)) {
    const A = V[path[0]].p, B = V[path[path.length - 1]].p;
    path.forEach((v, k) => {
      if (fixed(v)) return;
      const t = k / (path.length - 1);
      const q = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      if (V[v].crossing !== undefined) { P[v][0] += q[0] / 2; P[v][1] += q[1] / 2; } else P[v] = q;
    });
    void i;
  }
  for (let h = nFixed; h < P.length; h++) {
    let x = 0, y = 0, c = 0;
    for (let k = 0; k < nb[h].length; k += 2) { x += P[nb[h][k]][0]; y += P[nb[h][k]][1]; c++; }
    P[h] = [x / c, y / c];
  }
  if (prev) for (const [v, q] of prev) if (P[v] && !fixed(v)) P[v] = q.slice();
  // Gauss-Seidel with over-relaxation
  const free = [];
  for (let v = 0; v < P.length; v++) if (!fixed(v)) free.push(v);
  const om = 1.7;
  for (let it = 0; it < iters; it++) {
    let delta = 0;
    for (const v of free) {
      const a = nb[v];
      let x = 0, y = 0, ws = 0;
      for (let k = 0; k < a.length; k += 2) { const q = P[a[k]], wt = a[k + 1]; x += q[0] * wt; y += q[1] * wt; ws += wt; }
      const nx = P[v][0] + om * (x / ws - P[v][0]), ny = P[v][1] + om * (y / ws - P[v][1]);
      delta = Math.max(delta, Math.abs(nx - P[v][0]) + Math.abs(ny - P[v][1]));
      P[v][0] = nx; P[v][1] = ny;
    }
    if (delta < tol) break;
  }
  // strands: raw polylines and smoothed curves
  const raw = {}, strands = {}, at = {};
  for (const [i, path] of Object.entries(M.paths)) {
    const pts = path.map((v) => P[v]);
    raw[i] = pts;
    const { out, idx } = smooth(pts, 5);
    strands[i] = out;
    at[i] = new Map();
    path.forEach((v, k) => { if (V[v].crossing !== undefined) at[i].set(V[v].crossing, idx[k]); });
  }
  const crossings = [];
  for (const [c, v] of Object.entries(M.cross)) {
    const X = s.x[c];
    crossings.push({ c: +c, p: P[v].slice(), a: X[0], b: X[1], top: X[2], ka: at[X[0]].get(+c), kb: at[X[1]].get(+c) });
  }
  return { strands, raw, crossings, map: M, P };
}

// Centripetal Catmull-Rom through the points, k samples per span. Returns the
// curve and, for each input point, its index in the curve (it passes through).
export function smooth(pts, k = 5) {
  const n = pts.length, out = [], idx = [];
  if (n < 3) { for (let i = 0; i < n; i++) { idx.push(out.length); out.push(pts[i].slice()); } return { out, idx }; }
  const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  for (let i = 0; i < n - 1; i++) {
    const p1 = P(i), p2 = P(i + 1);
    const p0 = i === 0 ? ext(p1, p2) : P(i - 1), p3 = i + 2 >= n ? ext(p2, p1) : P(i + 2);
    const d = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    idx.push(out.length);
    for (let j = 0; j < k; j++) {
      const t = t1 + ((t2 - t1) * j) / k;
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(j === 0 ? p1.slice() : L(B1, B2, t1, t2));
    }
  }
  idx.push(out.length);
  out.push(pts[n - 1].slice());
  return { out, idx };
}

// ---------- intersections (for the tests and for the retie animation) ----------

function segHit(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-15) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}
/** All points where polylines A and B meet (touching points merged within eps). */
export function hits(A, B, eps = 1e-7) {
  const out = [];
  const bx0 = [], bx1 = [], by0 = [], by1 = [];
  for (let j = 1; j < B.length; j++) { bx0.push(Math.min(B[j - 1][0], B[j][0])); bx1.push(Math.max(B[j - 1][0], B[j][0])); by0.push(Math.min(B[j - 1][1], B[j][1])); by1.push(Math.max(B[j - 1][1], B[j][1])); }
  for (let i = 1; i < A.length; i++) {
    const ax0 = Math.min(A[i - 1][0], A[i][0]), ax1 = Math.max(A[i - 1][0], A[i][0]), ay0 = Math.min(A[i - 1][1], A[i][1]), ay1 = Math.max(A[i - 1][1], A[i][1]);
    for (let j = 1; j < B.length; j++) {
      if (bx0[j - 1] > ax1 || bx1[j - 1] < ax0 || by0[j - 1] > ay1 || by1[j - 1] < ay0) continue;
      const h = segHit(A[i - 1], A[i], B[j - 1], B[j]);
      if (h && !out.some((o) => Math.hypot(o[0] - h[0], o[1] - h[1]) < eps)) out.push(h);
    }
  }
  return out;
}
/** Distance from point p to polyline A. */
export function distTo(A, p) {
  let d = Infinity;
  for (let k = 1; k < A.length; k++) {
    const [ax, ay] = A[k - 1], [bx, by] = A[k];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
    d = Math.min(d, Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t));
  }
  return d;
}

// ---------- over and under: what to paint, in what order ----------

/**
 * A base order for whole strands: lower ones first where the crossings
 * agree; a cycle (or a clasp, which is always one) is broken by strand order.
 */
export function baseOrder(strandIds, crossings) {
  const ids = strandIds.slice().sort((a, b) => a - b);
  const above = new Map(ids.map((i) => [i, new Set()])); // i -> strands that must come after i
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const X of crossings) {
    const bot = X.top === X.a ? X.b : X.a;
    if (!above.has(bot) || !above.has(X.top) || above.get(bot).has(X.top)) continue;
    above.get(bot).add(X.top); indeg.set(X.top, indeg.get(X.top) + 1);
  }
  const out = [], left = new Set(ids);
  while (left.size) {
    let pick = -1;
    for (const i of ids) if (left.has(i) && indeg.get(i) === 0) { pick = i; break; }
    if (pick < 0) { let bd = Infinity; for (const i of ids) if (left.has(i) && indeg.get(i) < bd) { bd = indeg.get(i); pick = i; } }
    left.delete(pick); out.push(pick);
    for (const j of above.get(pick)) if (left.has(j)) indeg.set(j, indeg.get(j) - 1);
  }
  return out;
}

/** Radius of a crossing's patch: wide enough for a shallow crossing's overlap. */
export function patchRadius(A, B, ka, kb, w) {
  const tan = (C, k) => { const a = C[Math.max(0, k - 1)], b = C[Math.min(C.length - 1, k + 1)]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  const ta = tan(A, ka), tb = tan(B, kb);
  const sn = Math.abs(ta[0] * tb[1] - ta[1] * tb[0]);
  return Math.min(4 * w, w * (0.9 + 0.75 / Math.max(sn, 0.22)));
}

/**
 * plan(curves, crossings, { w, live, order, liveOnly }) -> { rest: [s], restPatches, live: [s], livePatches }
 * (liveOnly: skip the rest patches, already painted in a cache)
 * curves: { s: polyline } (one coordinate space), crossings: [{ p, a, b, top, ka, kb }]
 * Painting: rest strands (bottom to top), restPatches, live strands, livePatches.
 * A patch { p, r, order } repaints, inside a disk, the linen and then every
 * strand near it in the local order its crossings demand.
 */
export function plan(curves, crossings, { w, live = new Set(), order = null, liveOnly = false }) {
  const ids = Object.keys(curves).map(Number);
  const base = order || baseOrder(ids, crossings);
  const rank = new Map(base.map((s, k) => [s, k]));
  const time = (s) => (live.has(s) ? 1000 : 0) + rank.get(s);
  const rest = base.filter((s) => !live.has(s)), lv = base.filter((s) => live.has(s));
  const dist = (P, Q) => Math.hypot(P[0] - Q[0], P[1] - Q[1]);
  const mk = (X, pool) => {
    let r = X.r ?? patchRadius(curves[X.a], curves[X.b], X.ka ?? 0, X.kb ?? 0, w);
    const reach0 = r + 1.7 * w;
    const members = pool.filter((s) => distTo(curves[s], X.p) <= reach0);
    // the crossings nearby, nearest first; one that would close a cycle with
    // nearer ones (the other half of a clasp, say) is left out, and the disk
    // shrinks to keep its overlap outside
    const near = crossings.filter((Y) => members.includes(Y.a) && members.includes(Y.b) && dist(Y.p, X.p) <= r + 1.2 * w)
      .sort((Y, Z) => dist(Y.p, X.p) - dist(Z.p, X.p));
    const after = new Map(members.map((s) => [s, new Set()]));
    const reaches = (from, to) => {
      const stack = [from], seen = new Set([from]);
      while (stack.length) { const u = stack.pop(); if (u === to) return true; for (const v of after.get(u)) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
      return false;
    };
    const indeg = new Map(members.map((s) => [s, 0]));
    for (const Y of near) {
      const bot = Y.top === Y.a ? Y.b : Y.a;
      if (after.get(bot).has(Y.top)) continue;
      if (reaches(Y.top, bot)) { const d = dist(Y.p, X.p); r = Math.min(r, Math.max(0.5 * d, d - 0.9 * w)); continue; }
      after.get(bot).add(Y.top); indeg.set(Y.top, indeg.get(Y.top) + 1);
    }
    // topological order inside the disk, ties by paint time
    const ms = members.slice().sort((a, b) => time(a) - time(b));
    const ord = [], left = new Set(ms);
    while (left.size) {
      let pick = ms.find((s) => left.has(s) && indeg.get(s) === 0);
      if (pick === undefined) pick = ms.find((s) => left.has(s) && s === X.top) ?? ms.find((s) => left.has(s));
      left.delete(pick); ord.push(pick);
      for (const j of after.get(pick)) if (left.has(j)) indeg.set(j, indeg.get(j) - 1);
    }
    return { p: X.p, r, order: ord, a: X.a, b: X.b };
  };
  const restPatches = [], livePatches = [];
  for (const X of crossings) {
    const bot = X.top === X.a ? X.b : X.a;
    if (!(X.top in curves) || !(bot in curves)) continue;
    if (time(X.top) > time(bot)) continue; // painted in the right order already
    if (!live.has(X.a) && !live.has(X.b)) { if (!liveOnly) restPatches.push(mk(X, rest)); }
    else livePatches.push(mk(X, base));
  }
  // a later rest patch may cover a live strand's crossing near it: live
  // patches are painted after everything, so they win
  return { rest, restPatches, live: lv, livePatches };
}

/**
 * What lies on top at point q, if the plan were painted with yarn of width w
 * (for the tests): the last strand painted that covers q, or -1. With
 * `among`, only those strands count (at a crossing: which of its two strands
 * is painted over the other there; a third strand may lie over both).
 */
export function topAt(curves, P, q, w, among = null) {
  let top = -1;
  const cov = (s) => (!among || among.includes(s)) && distTo(curves[s], q) <= w / 2;
  for (const s of P.rest) if (cov(s)) top = s;
  for (const X of P.restPatches) if (Math.hypot(q[0] - X.p[0], q[1] - X.p[1]) <= X.r) { top = -1; for (const s of X.order) if (cov(s)) top = s; }
  for (const s of P.live) if (cov(s)) top = s;
  for (const X of P.livePatches) if (Math.hypot(q[0] - X.p[0], q[1] - X.p[1]) <= X.r) { top = -1; for (const s of X.order) if (cov(s)) top = s; }
  return top;
}
