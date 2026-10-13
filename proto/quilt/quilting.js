// quilting.js — quilting designs as thread paths over the top (pure).
//
// Every function returns polylines in quilt inches: [{ pts: [[x,y]...], closed }].

import { layoutQuilt, quiltPatches } from './layout.js';
import { SHAPES } from './blocks.js';

export const PATTERNS = [
  { id: 'none', name: 'Not yet', note: 'The top on its own.' },
  { id: 'ditch', name: 'In the ditch', note: 'Right in the seams, nearly invisible; the patchwork puffs up.' },
  { id: 'grid', name: 'Straight grid', note: 'Straight lines both ways with a walking foot.' },
  { id: 'crosshatch', name: 'Crosshatch', note: 'Diagonal lines both ways: a classic.' },
  { id: 'echo', name: 'Echo', note: 'Lines inside each patch, following its shape.' },
  { id: 'fan', name: 'Baptist fan', note: 'Arcs in overlapping fans, stitched across the whole quilt.' },
  { id: 'meander', name: 'Meander', note: 'A big, loose free-motion wander that never crosses itself.' },
  { id: 'stipple', name: 'Stipple', note: 'A small, dense meander.' },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ geometry */

/** Insets a convex polygon by d (positive = inward). Returns null when it vanishes. */
export function insetConvex(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const sgn = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-9) continue;
    // Inward normal for this winding (y down).
    const nx = (-(y2 - y1) / len) * sgn;
    const ny = ((x2 - x1) / len) * sgn;
    lines.push([[x1 + nx * d, y1 + ny * d], [x2 + nx * d, y2 + ny * d]]);
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const [p1, p2] = lines[(i + lines.length - 1) % lines.length];
    const [p3, p4] = lines[i];
    const den = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
    if (Math.abs(den) < 1e-12) { out.push(p3); continue; }
    const tt = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / den;
    out.push([p1[0] + tt * (p2[0] - p1[0]), p1[1] + tt * (p2[1] - p1[1])]);
  }
  // Vanished if winding flipped or area collapsed.
  let a2 = 0;
  for (let i = 0; i < out.length; i++) {
    const [x1, y1] = out[i];
    const [x2, y2] = out[(i + 1) % out.length];
    a2 += x1 * y2 - x2 * y1;
  }
  if (a2 * area <= 0 || Math.abs(a2) < 0.02) return null;
  // Past the incenter the polygon turns inside out: edges reverse direction.
  for (let i = 0; i < out.length; i++) {
    const [a, b] = lines[i];
    const p = out[i];
    const q = out[(i + 1) % out.length];
    if ((q[0] - p[0]) * (b[0] - a[0]) + (q[1] - p[1]) * (b[1] - a[1]) <= 0) return null;
  }
  return out;
}

function clipSegmentToRect(p, q, x0, y0, x1, y1) {
  // Liang–Barsky
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const P = [-dx, dx, -dy, dy];
  const Q = [p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(P[i]) < 1e-12) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}

/* ------------------------------------------------------- the patterns */

export function gridLines(w, h, sp) {
  const out = [];
  for (let x = sp; x < w - 1e-6; x += sp) out.push({ pts: [[x, 0], [x, h]] });
  for (let y = sp; y < h - 1e-6; y += sp) out.push({ pts: [[0, y], [w, y]] });
  return out;
}

export function crosshatch(w, h, sp) {
  const out = [];
  const step = sp * Math.SQRT2; // perpendicular spacing sp
  for (let c = -h; c < w + h; c += step) {
    const a = clipSegmentToRect([c, 0], [c + h, h], 0, 0, w, h);
    if (a) out.push({ pts: a });
    const b = clipSegmentToRect([c, 0], [c - h, h], 0, 0, w, h);
    if (b) out.push({ pts: b });
  }
  return out;
}

/**
 * Baptist fan: fans pivot on a grid of R; each sweeps a quarter circle up
 * and to the right. Rows are worked top-down and right to left, and a fan's
 * outer arcs stop where they run into a fan already stitched, so the inner
 * arcs are always whole and the outer ones nest into their neighbors.
 */
export function baptistFan(w, h, sp) {
  const R = 4 * sp;
  const Rmax = 1.45 * R;
  const n = Math.floor(Rmax / sp + 1e-9);
  const fans = [];
  for (let cy = 0; cy <= h + R; cy += R) {
    for (let cx = Math.floor(w / R) * R; cx >= -R; cx -= R) fans.push([cx, cy]);
  }
  const inFan = ([x, y], [cx, cy]) => x >= cx - 1e-9 && y <= cy + 1e-9 && Math.hypot(x - cx, y - cy) < Rmax - 1e-6;
  const out = [];
  const done = [];
  for (const c of fans) {
    const near = done.filter(([ox, oy]) => Math.abs(ox - c[0]) <= R + 1e-6 && Math.abs(oy - c[1]) <= R + 1e-6);
    for (let k = 1; k <= n; k++) {
      const r = k * sp;
      const segs = Math.max(8, Math.round(r * 4));
      let run = [];
      for (let s = 0; s <= segs; s++) {
        const a = -Math.PI / 2 + (Math.PI / 2) * (s / segs);
        const p = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
        const hidden = near.some((o) => inFan(p, o)) || p[0] < -1 || p[0] > w + 1 || p[1] < -1 || p[1] > h + 1;
        if (!hidden) run.push(p);
        else { if (run.length > 1) out.push({ pts: run }); run = []; }
      }
      if (run.length > 1) out.push({ pts: run });
    }
    done.push(c);
  }
  return out;
}

/**
 * A meander that never crosses itself: a random spanning tree on a coarse
 * grid, traced around on a grid twice as fine (one closed loop through every
 * fine cell), then rounded off.
 */
export function meanderLoop(cols, rows, rng) {
  // Kruskal with random edge order.
  const parent = Array.from({ length: cols * rows }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edges = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (x + 1 < cols) edges.push([x, y, 1, 0, rng()]);
    if (y + 1 < rows) edges.push([x, y, 0, 1, rng()]);
  }
  edges.sort((a, b) => a[4] - b[4]);
  const right = new Set();
  const down = new Set();
  for (const [x, y, dx, dy] of edges) {
    const a = find(y * cols + x);
    const b = find((y + dy) * cols + x + dx);
    if (a === b) continue;
    parent[a] = b;
    (dx ? right : down).add(y * cols + x);
  }
  const W = cols * 2;
  const H = rows * 2;
  const adj = Array.from({ length: W * H }, () => []);
  const link = (x1, y1, x2, y2) => { adj[y1 * W + x1].push(y2 * W + x2); adj[y2 * W + x2].push(y1 * W + x1); };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    const X = 2 * x, Y = 2 * y;
    if (right.has(i)) { link(X + 1, Y, X + 2, Y); link(X + 1, Y + 1, X + 2, Y + 1); } else link(X + 1, Y, X + 1, Y + 1);
    if (down.has(i)) { link(X, Y + 1, X, Y + 2); link(X + 1, Y + 1, X + 1, Y + 2); } else link(X, Y + 1, X + 1, Y + 1);
    if (x === 0 || !right.has(i - 1)) link(X, Y, X, Y + 1);
    if (y === 0 || !down.has(i - cols)) link(X, Y, X + 1, Y);
  }
  // Walk the loop.
  const order = [0];
  let prev = -1;
  let cur = 0;
  for (let k = 1; k < W * H; k++) {
    const nx = adj[cur][0] !== prev ? adj[cur][0] : adj[cur][1];
    prev = cur;
    cur = nx;
    if (cur === 0) break;
    order.push(cur);
  }
  return { W, H, order: order.map((i) => [i % W, Math.floor(i / W)]), adj };
}

export function chaikin(pts, iters = 2, closed = true) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [];
    const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

export function meander(w, h, cell, seed = 7) {
  const rng = mulberry32(seed);
  const cols = Math.max(1, Math.ceil(w / (cell * 2)));
  const rows = Math.max(1, Math.ceil(h / (cell * 2)));
  const { order } = meanderLoop(cols, rows, rng);
  const sx = w / (cols * 2);
  const sy = h / (rows * 2);
  const j = 0.22;
  // A smooth warp (gentle enough never to fold) turns the grid into a wander.
  const waves = [0, 1, 2].map(() => ({ fx: (0.6 + rng() * 0.5) * 2 * Math.PI / 7, fy: (0.6 + rng() * 0.5) * 2 * Math.PI / 7, p: rng() * 6.28, q: rng() * 6.28 }));
  const A = 0.26;
  const warp = (x, y) => {
    let dx = 0, dy = 0;
    for (const w of waves) { dx += A * Math.sin(y * w.fy + w.p); dy += A * Math.sin(x * w.fx + w.q); }
    return [x + dx, y + dy];
  };
  const pts = order.map(([x, y]) => {
    const [wx, wy] = warp(x + 0.5 + (rng() - 0.5) * j, y + 0.5 + (rng() - 0.5) * j);
    return [wx * sx, wy * sy];
  });
  return [{ pts: chaikin(pts, 3), closed: true }];
}

/** All the patch outlines (stitch in the ditch). */
function ditch(design, layout) {
  const out = quiltPatches(design, layout).map((p) => ({ pts: p.pts, closed: true }));
  for (const p of layout.pieces) out.push({ pts: p.pts, closed: true });
  return out;
}

function echo(design, layout, sp) {
  const out = [];
  const patches = quiltPatches(design, layout);
  const shapes = layout.blocks.length ? design.blocks : [];
  for (const p of patches) {
    const block = shapes[layout.blocks[p.inst].which] || shapes[0];
    const unit = block.units[p.unit];
    if (SHAPES[unit.t]?.curved) { out.push({ pts: p.pts, closed: true }); continue; }
    for (let d = 0.25; d < 20; d += sp) {
      const q = insetConvex(p.pts, d);
      if (!q) break;
      out.push({ pts: q, closed: true });
    }
  }
  for (const piece of layout.pieces) {
    for (let d = 0.25; d < 20; d += sp) {
      const q = insetConvex(piece.pts, d);
      if (!q) break;
      out.push({ pts: q, closed: true });
    }
  }
  return out;
}

/**
 * The quilting paths for a design.
 * opts: { pattern, spacing } (defaults to design.quilting)
 */
export function quiltingPaths(design, layout = layoutQuilt(design), opts = design.quilting || {}) {
  const sp = Math.max(0.5, Number(opts.spacing) || 1.5);
  const { w, h } = layout;
  switch (opts.pattern) {
    case 'ditch': return ditch(design, layout);
    case 'grid': return gridLines(w, h, sp * 1.5);
    case 'crosshatch': return crosshatch(w, h, sp * 1.5);
    case 'echo': return echo(design, layout, Math.max(0.5, sp * 0.5));
    case 'fan': return baptistFan(w, h, sp);
    case 'meander': return meander(w, h, sp * 1.2, 11);
    case 'stipple': return meander(w, h, sp * 0.45, 5);
    default: return [];
  }
}
