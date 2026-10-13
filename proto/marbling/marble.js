// marble.js - the ink model for the marbling prototype. PURE: no DOM, no Date.now, no Math.random.
//
// Each ink drop is a closed polygon (flat Float64Array of x,y pairs) in "bath units": the bath is
// BATH_SIZE x BATH_SIZE, whatever the screen size. Every gesture is a smooth, invertible map of the
// bath plane, applied to every vertex of every ink ("mathematical marbling", Lu, Jaffer et al.):
//
//   drop at c, radius r   p' = c + (p - c) * sqrt(1 + r^2 / |p - c|^2)
//   tine line (B, M, N)   p' = p + z * u^d * M,   d = |(p - B) . N|,   u = 2^(-1/c)
//   circular line         p' = C + Rot(theta * u^|rho - R|) (p - C)
//
// c is the "sharpness": the distance at which a tine's pull has halved. A stylus is the same
// tine formula with d measured to the short segment the stylus just travelled, so it only pulls
// ink near its own path (instead of along an infinite line).
//
// Edges are subdivided at the moment they are stretched: the new vertex is the image of the
// ORIGINAL edge midpoint, so curves stay smooth no matter how hard they are combed.

export const BATH_SIZE = 1000;
export const BATH_COLOR = '#F1EBDD';
export const INKS = [
  { id: 'madder', name: 'Madder', hex: '#B8433A' },
  { id: 'ochre', name: 'Ochre', hex: '#D9A63A' },
  { id: 'woad', name: 'Woad', hex: '#3E6A9E' },
  { id: 'indigo', name: 'Indigo', hex: '#2C3E66' },
  { id: 'weld', name: 'Weld', hex: '#E3C65A' },
  { id: 'cochineal', name: 'Cochineal', hex: '#C2507A' },
  { id: 'walnut', name: 'Walnut', hex: '#6B4A32' },
  { id: 'sage', name: 'Sage', hex: '#8A9A6B' },
];
export const LIMITS = {
  maxVerts: 48000, // hard cap on vertices in one bath (stretching stops adding detail above this)
  softVerts: 8000, // above this we thin out near-collinear vertices
  maxEdge: 60, // edges longer than this (bath units) get subdivided
  flat: 0.6, // ...and so do edges whose true midpoint is further than this from the chord
  stylusC: 24,
  combC: 20,
  swirlC: 60,
  maxUndo: 14,
};

const LN2 = Math.LN2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBath(size = BATH_SIZE) {
  return { size, inks: [] };
}

export function countVerts(bath) {
  let n = 0;
  for (const ink of bath.inks) n += ink.pts.length >> 1;
  return n;
}

export function snapshot(bath) {
  return bath.inks.map((i) => ({ color: i.color, pts: Float64Array.from(i.pts) }));
}

export function restore(bath, snap) {
  bath.inks = snap.map((s) => makeInk(s.color, Float64Array.from(s.pts)));
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function makeInk(color, pts) {
  return { color, pts, bb: bbox(pts) };
}

export function dropVertexCount(r) {
  return Math.max(120, Math.min(200, Math.round((2 * Math.PI * r) / 2.4)));
}

export function circlePts(cx, cy, r, n = dropVertexCount(r)) {
  const pts = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts[2 * i] = cx + Math.cos(a) * r;
    pts[2 * i + 1] = cy + Math.sin(a) * r;
  }
  return pts;
}

// ---------------------------------------------------------------- fields
// A field is f(x, y, out) writing the transformed point into out[0], out[1].
// Optional f.bounds = [x0, y0, x1, y1]: nothing outside moves (lets us skip far-away inks).

export function dropField(cx, cy, r) {
  const k = r * r;
  return (x, y, out) => {
    const dx = x - cx, dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) { out[0] = x; out[1] = y; return; }
    const s = Math.sqrt(1 + k / d2);
    out[0] = cx + dx * s;
    out[1] = cy + dy * s;
  };
}

// The published tine line, exactly: p' = p + z u^d M. M is normalised here.
export function tineLineField(B, M, z, c) {
  const ml = Math.hypot(M[0], M[1]) || 1;
  const mx = M[0] / ml, my = M[1] / ml;
  const nx = -my, ny = mx;
  const u = Math.pow(2, -1 / c);
  return (x, y, out) => {
    const d = Math.abs((x - B[0]) * nx + (y - B[1]) * ny);
    const w = Math.pow(u, d);
    out[0] = x + z * w * mx;
    out[1] = y + z * w * my;
  };
}

// Stylus step from a to b: the same pull, with d = distance from p to the segment a-b.
export function segmentField(a, b, c) {
  const ax = a[0], ay = a[1];
  const dx = b[0] - ax, dy = b[1] - ay;
  const L2 = dx * dx + dy * dy;
  const k = LN2 / c;
  const cut = c * 7;
  const cut2 = cut * cut;
  const f = (x, y, out) => {
    const px = x - ax, py = y - ay;
    let t = L2 > 0 ? (px * dx + py * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px - t * dx, qy = py - t * dy;
    const d2 = qx * qx + qy * qy;
    if (d2 > cut2) { out[0] = x; out[1] = y; return; }
    const w = Math.exp(-k * Math.sqrt(d2));
    out[0] = x + dx * w;
    out[1] = y + dy * w;
  };
  f.bounds = [Math.min(ax, b[0]) - cut, Math.min(ay, b[1]) - cut, Math.max(ax, b[0]) + cut, Math.max(ay, b[1]) + cut];
  return f;
}

// Comb: several parallel tines moved together from a to b. offsets are distances along the unit normal nrm.
// (Evenly spaced offsets, so only the two nearest tines can matter for any point.)
export function combField(a, b, nrm, offsets, c) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const k = LN2 / c;
  const cut = c * 7;
  const cut2 = cut * cut;
  const n = offsets.length;
  const o0 = offsets[0];
  const sp = n > 1 ? offsets[1] - offsets[0] : 1;
  const tineD2 = (x, y, off) => {
    const px = x - a[0] - nrm[0] * off, py = y - a[1] - nrm[1] * off;
    let t = L2 > 0 ? (px * dx + py * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px - t * dx, qy = py - t * dy;
    return qx * qx + qy * qy;
  };
  const f = (x, y, out) => {
    const s = (x - a[0]) * nrm[0] + (y - a[1]) * nrm[1];
    let k0 = Math.floor((s - o0) / sp);
    let best = Infinity;
    for (let i = k0; i <= k0 + 1; i++) {
      const ii = i < 0 ? 0 : i > n - 1 ? n - 1 : i;
      const d2 = tineD2(x, y, o0 + ii * sp);
      if (d2 < best) best = d2;
    }
    if (best > cut2) { out[0] = x; out[1] = y; return; }
    const w = Math.exp(-k * Math.sqrt(best));
    out[0] = x + dx * w;
    out[1] = y + dy * w;
  };
  const lo = offsets[0], hi = offsets[n - 1];
  const xs = [a[0] + nrm[0] * lo, a[0] + nrm[0] * hi, b[0] + nrm[0] * lo, b[0] + nrm[0] * hi];
  const ys = [a[1] + nrm[1] * lo, a[1] + nrm[1] * hi, b[1] + nrm[1] * lo, b[1] + nrm[1] * hi];
  f.bounds = [Math.min(...xs) - cut, Math.min(...ys) - cut, Math.max(...xs) + cut, Math.max(...ys) + cut];
  return f;
}

// Circular line: rotate points about C by theta, strongest on the circle of radius R.
export function swirlField(cx, cy, R, theta, c) {
  const k = LN2 / c;
  return (x, y, out) => {
    const dx = x - cx, dy = y - cy;
    const rho = Math.sqrt(dx * dx + dy * dy);
    const w = Math.exp(-k * Math.abs(rho - R));
    const ang = theta * w;
    const co = Math.cos(ang), si = Math.sin(ang);
    out[0] = cx + dx * co - dy * si;
    out[1] = cy + dx * si + dy * co;
  };
}

// ---------------------------------------------------------------- polygons
const scratch = [0, 0];

export function transformPoly(pts, f, maxEdge = LIMITS.maxEdge, budget = Infinity, flat = LIMITS.flat) {
  const n = pts.length >> 1;
  const tp = new Float64Array(pts.length);
  const mv = new Uint8Array(n);
  let moved = false;
  const bnd = f.bounds;
  for (let i = 0; i < n; i++) {
    const x = pts[2 * i], y = pts[2 * i + 1];
    tp[2 * i] = x;
    tp[2 * i + 1] = y;
    if (bnd && (x < bnd[0] || x > bnd[2] || y < bnd[1] || y > bnd[3])) continue;
    f(x, y, scratch);
    const X = scratch[0], Y = scratch[1];
    if (X !== x || Y !== y) { tp[2 * i] = X; tp[2 * i + 1] = Y; mv[i] = 1; moved = true; }
  }
  if (!moved) return { pts, added: 0, moved: false };
  const me2 = maxEdge * maxEdge;
  const flat2 = flat * flat;
  const res = [];
  let added = 0;
  // Refine one edge: put in the image of the ORIGINAL midpoint when the edge is long or visibly bent.
  const refine = (x0, y0, X0, Y0, x1, y1, X1, Y1, depth) => {
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    f(mx, my, scratch);
    const MX = scratch[0], MY = scratch[1];
    const cl = (X1 - X0) * (X1 - X0) + (Y1 - Y0) * (Y1 - Y0);
    if (cl < 0.25 || depth > 10 || added >= budget) return;
    let need = cl > me2;
    if (!need) {
      const ex = MX - (X0 + X1) * 0.5, ey = MY - (Y0 + Y1) * 0.5;
      need = ex * ex + ey * ey > flat2;
      if (!need && cl > 16) { // a feature can hide between the midpoint and an end: look at the quarter points too
        f(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25, scratch);
        let dx = scratch[0] - (X0 * 0.75 + X1 * 0.25), dy = scratch[1] - (Y0 * 0.75 + Y1 * 0.25);
        need = dx * dx + dy * dy > flat2;
        if (!need) {
          f(x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75, scratch);
          dx = scratch[0] - (X0 * 0.25 + X1 * 0.75); dy = scratch[1] - (Y0 * 0.25 + Y1 * 0.75);
          need = dx * dx + dy * dy > flat2;
        }
      }
    }
    if (need) {
      refine(x0, y0, X0, Y0, mx, my, MX, MY, depth + 1);
      res.push(MX, MY);
      added++;
      refine(mx, my, MX, MY, x1, y1, X1, Y1, depth + 1);
    }
  };
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    res.push(tp[2 * i], tp[2 * i + 1]);
    if (mv[i] || mv[j]) refine(pts[2 * i], pts[2 * i + 1], tp[2 * i], tp[2 * i + 1], pts[2 * j], pts[2 * j + 1], tp[2 * j], tp[2 * j + 1], 0);
  }
  return { pts: Float64Array.from(res), added, moved: true };
}

// Thin out vertices that are nearly collinear with their neighbours.
export function simplifyPoly(pts, maxEdge = LIMITS.maxEdge, tol = 0.2) {
  const n = pts.length >> 1;
  if (n <= 48) return pts;
  const keep = new Uint8Array(n).fill(1);
  let prev = n - 1;
  let kept = n;
  for (let i = 0; i < n && kept > 40; i++) {
    const nx = i + 1 === n ? 0 : i + 1;
    const ax = pts[2 * prev], ay = pts[2 * prev + 1];
    const bx = pts[2 * nx], by = pts[2 * nx + 1];
    const cx = bx - ax, cy = by - ay;
    const cl = Math.hypot(cx, cy);
    if (cl <= maxEdge) {
      const dist = cl > 0 ? Math.abs((pts[2 * i] - ax) * cy - (pts[2 * i + 1] - ay) * cx) / cl : 0;
      if (dist <= tol) { keep[i] = 0; kept--; continue; }
    }
    prev = i;
  }
  if (kept === n) return pts;
  const out = new Float64Array(kept * 2);
  let k = 0;
  for (let i = 0; i < n; i++) if (keep[i]) { out[k++] = pts[2 * i]; out[k++] = pts[2 * i + 1]; }
  return out;
}

export function maintain(bath) {
  const total = countVerts(bath);
  if (total <= LIMITS.softVerts) return;
  const tol = total > LIMITS.maxVerts * 0.5 ? 0.4 : 0.2;
  for (const ink of bath.inks) {
    ink.pts = simplifyPoly(ink.pts, LIMITS.maxEdge, tol);
    ink.bb = bbox(ink.pts);
  }
}

export function applyField(bath, f, opts = {}) {
  const skip = opts.skip || null;
  const total = countVerts(bath);
  let budget = LIMITS.maxVerts - total;
  if (budget < 0) budget = 0;
  // as the bath fills up, detail gets a little coarser instead of stopping dead
  const pressure = Math.max(1, total / (0.5 * LIMITS.maxVerts));
  const flat = (opts.flat || LIMITS.flat) * pressure * pressure;
  const maxEdge = (opts.maxEdge || LIMITS.maxEdge) * Math.sqrt(pressure);
  const bnd = f.bounds;
  for (const ink of bath.inks) {
    if (ink === skip) continue;
    if (bnd) {
      const bb = ink.bb;
      if (bb[2] < bnd[0] || bb[0] > bnd[2] || bb[3] < bnd[1] || bb[1] > bnd[3]) continue;
    }
    const r = transformPoly(ink.pts, f, maxEdge, budget, flat);
    if (r.moved) {
      ink.pts = r.pts;
      ink.bb = bbox(r.pts);
      budget -= r.added;
      if (budget < 0) budget = 0;
    }
  }
  if (!opts.noMaintain) maintain(bath);
}

// ---------------------------------------------------------------- gestures
// Drops can grow over time (the press-and-hold preview, and the little bloom when ink lands).
export function beginDrop(bath, cx, cy, color) {
  const ink = makeInk(color, circlePts(cx, cy, 0.5, 120));
  bath.inks.push(ink);
  return { ink, cx, cy, r: 0 };
}

export function growDrop(bath, h, r) {
  if (r <= h.r) return;
  const dr = Math.sqrt(r * r - h.r * h.r);
  applyField(bath, dropField(h.cx, h.cy, dr), { skip: h.ink, noMaintain: true });
  h.r = r;
  h.ink.pts = circlePts(h.cx, h.cy, r);
  h.ink.bb = bbox(h.ink.pts);
}

export function dropInk(bath, cx, cy, r, color) {
  const h = beginDrop(bath, cx, cy, color);
  growDrop(bath, h, r);
  maintain(bath);
  return h.ink;
}

// A segment pull is only a bijection while its shift stays under about c / ln2, so long moves are
// cut into sub-steps of at most 0.9 c (a fast finger swipe is therefore still one smooth drag).
function subSteps(a, b, c) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.max(1, Math.ceil(len / (0.9 * c)));
}

export function stylusStep(bath, a, b, c = LIMITS.stylusC) {
  if (a[0] === b[0] && a[1] === b[1]) return;
  const n = subSteps(a, b, c);
  let p = a;
  for (let i = 1; i <= n; i++) {
    const q = i === n ? b : [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    applyField(bath, segmentField(p, q, c));
    p = q;
  }
}

/**
 * basinOffsets(start, nrm, gap, size) -> tine offsets (along nrm, relative to
 * start) for a comb as wide as the whole basin in that direction: like a real
 * marbling comb, it reaches wall to wall whichever way it is drawn, diagonals
 * included. Tines sit `gap` apart, centred in the basin's extent.
 */
export function basinOffsets(start, nrm, gap, size = BATH_SIZE) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    const s = (x - start[0]) * nrm[0] + (y - start[1]) * nrm[1];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const n = Math.max(1, Math.floor((hi - lo) / gap));
  const first = lo + (hi - lo - (n - 1) * gap) / 2;
  const out = [];
  for (let i = 0; i < n; i++) out.push(first + i * gap);
  return out;
}

export function combStep(bath, a, b, nrm, tines, spacing, c = LIMITS.combC) {
  if (a[0] === b[0] && a[1] === b[1]) return;
  const offs = Array.isArray(tines) ? tines : combOffsets(tines, spacing);
  const n = subSteps(a, b, c);
  let p = a;
  for (let i = 1; i <= n; i++) {
    const q = i === n ? b : [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    applyField(bath, combField(p, q, nrm, offs, c));
    p = q;
  }
}

export function combOffsets(tines, spacing) {
  const o = [];
  for (let i = 0; i < tines; i++) o.push((i - (tines - 1) / 2) * spacing);
  return o;
}

export function swirlStep(bath, cx, cy, R, theta, c = LIMITS.swirlC) {
  applyField(bath, swirlField(cx, cy, R, theta, c));
}

// Resample a polyline so consecutive points are at most `step` apart.
export function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

export function pathNormal(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

// ---------------------------------------------------------------- starters (scripted gestures)
// ops: { t:'drop', x, y, r, color } | { t:'stroke', tool:'stylus'|'comb', pts, c, tines?, spacing? }
function pickColors(rng, n) {
  const pool = INKS.map((i) => i.hex);
  const out = [];
  while (out.length < n) {
    const k = Math.floor(rng() * pool.length);
    out.push(pool.splice(k, 1)[0]);
  }
  return out;
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scatterDrops(rng, cols, g, rMin, rMax) {
  const cell = BATH_SIZE / g;
  const spots = [];
  for (let gy = 0; gy < g; gy++) for (let gx = 0; gx < g; gx++) {
    spots.push([(gx + 0.5 + (rng() - 0.5) * 0.5) * cell, (gy + 0.5 + (rng() - 0.5) * 0.5) * cell]);
  }
  shuffle(rng, spots);
  return spots.map(([x, y]) => ({ t: 'drop', x, y, r: rMin + rng() * (rMax - rMin), color: cols[Math.floor(rng() * cols.length)] }));
}

function zigzagRows(rows, c) {
  const ops = [];
  const gap = (BATH_SIZE - 120) / (rows - 1);
  for (let i = 0; i < rows; i++) {
    const y = 60 + i * gap;
    const pts = i % 2 === 0 ? [[-130, y], [BATH_SIZE + 130, y]] : [[BATH_SIZE + 130, y], [-130, y]];
    ops.push({ t: 'stroke', tool: 'stylus', c, pts });
  }
  return ops;
}

function fineComb() {
  // one pass of a fine comb over the whole tray, then a second pass back with the tines half a gap over
  const ops = [];
  const tines = 12, spacing = 80;
  [[500, false], [540, true]].forEach(([cx, up]) => {
    const pts = up ? [[cx, BATH_SIZE + 130], [cx, -130]] : [[cx, -130], [cx, BATH_SIZE + 130]];
    ops.push({ t: 'stroke', tool: 'comb', c: 24, tines, spacing, pts });
  });
  return ops;
}

function wavyPasses() {
  const ops = [];
  [310, 700].forEach((y0, i) => {
    const pts = [];
    for (let x = -130; x <= BATH_SIZE + 130; x += 20) pts.push([x, y0 + 70 * Math.sin((x / 120) * Math.PI)]);
    if (i % 2) pts.reverse();
    ops.push({ t: 'stroke', tool: 'stylus', c: 30, pts });
  });
  return ops;
}

export const STARTERS = [
  { id: 'stone', name: 'Stone', note: 'Rings of ink, dropped one inside another.' },
  { id: 'gelgit', name: 'Gel-git', note: 'Drops, then a stylus pulled back and forth.' },
  { id: 'nonpareil', name: 'Nonpareil', note: 'Gel-git, then a fine comb pulled across.' },
  { id: 'bouquet', name: 'Bouquet', note: 'Nonpareil, then a wavy pass for flowers.' },
];

export function starterOps(name, rng) {
  if (name === 'stone') {
    const cols = pickColors(rng, 3);
    const g = 4, cell = BATH_SIZE / g;
    const spots = [];
    for (let gy = 0; gy < g; gy++) for (let gx = 0; gx < g; gx++) {
      spots.push([(gx + 0.5 + (rng() - 0.5) * 0.4) * cell, (gy + 0.5 + (rng() - 0.5) * 0.4) * cell]);
    }
    shuffle(rng, spots);
    const ops = [];
    for (const [x, y] of spots) {
      const r = 62 + rng() * 26;
      const c0 = Math.floor(rng() * 3);
      ops.push({ t: 'drop', x, y, r, color: cols[c0] });
      ops.push({ t: 'drop', x, y, r: r * 0.62, color: cols[(c0 + 1) % 3] });
      ops.push({ t: 'drop', x, y, r: r * 0.34, color: cols[(c0 + 2) % 3] });
    }
    for (let i = 0; i < 10; i++) ops.push({ t: 'drop', x: 60 + rng() * 880, y: 60 + rng() * 880, r: 22 + rng() * 14, color: cols[Math.floor(rng() * 3)] });
    return ops;
  }
  if (name === 'gelgit' || name === 'nonpareil' || name === 'bouquet') {
    const cols = pickColors(rng, 3);
    const ops = scatterDrops(rng, cols, 5, 74, 96);
    ops.push(...zigzagRows(8, 28));
    if (name !== 'gelgit') ops.push(...fineComb());
    if (name === 'bouquet') ops.push(...wavyPasses());
    return ops;
  }
  throw new Error('unknown starter ' + name);
}

// Apply one op instantly (used by tests, "skip", and the sample sheet).
export function applyOp(bath, op, step = 20) {
  if (op.t === 'drop') { dropInk(bath, op.x, op.y, op.r, op.color); return; }
  const p = resample(op.pts, step);
  const nrm = pathNormal(op.pts);
  for (let i = 1; i < p.length; i++) {
    if (op.tool === 'comb') combStep(bath, p[i - 1], p[i], nrm, op.tines, op.spacing, op.c);
    else stylusStep(bath, p[i - 1], p[i], op.c);
  }
}

export function runStarter(bath, name, rng, step = 20) {
  const ops = starterOps(name, rng);
  for (const op of ops) applyOp(bath, op, step);
  return ops;
}

// ------------------------------------------------------------------ saving a bath across reloads
// Coordinates are rounded to 0.1 bath units (1/10000 of the basin): invisible, and it keeps a
// busy 48k-vertex bath to a few hundred kB of JSON.
export function serializeBath(bath) {
  return { v: 1, size: bath.size, inks: bath.inks.map((i) => ({ color: i.color, pts: Array.from(i.pts, (x) => Math.round(x * 10) / 10) })) };
}

/** Rebuild a bath from serializeBath() output; anything malformed gives an empty bath. */
export function deserializeBath(o) {
  const bath = createBath();
  if (!o || o.v !== 1 || !Array.isArray(o.inks)) return bath;
  if (Number.isFinite(o.size) && o.size > 0) bath.size = o.size;
  for (const ink of o.inks) {
    if (!ink || typeof ink.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(ink.color)) continue;
    if (!Array.isArray(ink.pts) || ink.pts.length < 6 || ink.pts.length % 2) continue;
    if (!ink.pts.every(Number.isFinite)) continue;
    bath.inks.push(makeInk(ink.color, Float64Array.from(ink.pts)));
  }
  return bath;
}
