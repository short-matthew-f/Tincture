// quilting.js — quilting designs as thread paths over the top (pure).
//
// Every function returns polylines in quilt inches: [{ pts: [[x,y]...], closed }].

import { layoutQuilt, quiltPatches, instCorners } from './layout.js';
import { SHAPES } from './blocks.js';

export const PATTERNS = [
  { id: 'none', group: 'none', name: 'Not yet', note: 'The top on its own.' },
  // Follow the piecing
  { id: 'ditch', group: 'piecing', name: 'In the ditch', note: 'Right in the seams, nearly invisible; the patchwork puffs up.' },
  { id: 'echo', group: 'piecing', name: 'Echo', note: 'Lines inside each patch, following its shape.' },
  { id: 'curves', group: 'piecing', name: 'Continuous curves', note: 'A gentle arc across every patch, corner to corner: a curved crosshatch.' },
  { id: 'sqsq', group: 'piecing', name: 'Square in a square', note: 'Nested squares in every block, each joining the middles of the last.' },
  // Lines
  { id: 'grid', group: 'lines', name: 'Straight grid', note: 'Straight lines both ways with a walking foot.' },
  { id: 'crosshatch', group: 'lines', name: 'Crosshatch', note: 'Diagonal lines both ways: a classic.' },
  { id: 'diagonal', group: 'lines', name: 'Diagonal lines', note: 'Parallel lines on the bias, one way only.' },
  { id: 'wavy', group: 'lines', name: 'Wavy lines', note: 'Soft waves edge to edge; easy with a walking foot.' },
  { id: 'chevron', group: 'lines', name: 'Chevron', note: 'Zigzag rows, the shape of a wishbone repeated.' },
  // Allover, edge to edge
  { id: 'meander', group: 'allover', name: 'Meander', note: 'A big, loose free-motion wander that never crosses itself.' },
  { id: 'stipple', group: 'allover', name: 'Stipple', note: 'A small, dense meander.' },
  { id: 'loops', group: 'allover', name: 'Loop-de-loop', note: 'Rows of curls that cross back over themselves.' },
  { id: 'pebbles', group: 'allover', name: 'Pebbles', note: 'Round stones of mixed sizes, packed close.' },
  { id: 'swirls', group: 'allover', name: 'Swirls', note: 'Little spirals scattered over the quilt.' },
  { id: 'clamshell', group: 'allover', name: 'Clamshell', note: 'Overlapping half circles like fish scales.' },
  { id: 'orangepeel', group: 'allover', name: 'Orange peel', note: 'Petals on a grid; four meet at every corner.' },
  { id: 'cathedral', group: 'allover', name: 'Cathedral arcs', note: 'Rows of pointed arches, nested like windows.' },
  { id: 'fan', group: 'allover', name: 'Baptist fan', note: 'Arcs in overlapping fans, stitched across the whole quilt.' },
  { id: 'pantograph', group: 'allover', name: 'Leafy vine', note: 'A pantograph row: a vine with a leaf off every curve.' },
  { id: 'spiral', group: 'allover', name: 'Spiral', note: 'One spiral from the middle out to the edges.' },
];

export const PATTERN_GROUPS = [
  { id: 'piecing', name: 'Follows the piecing' },
  { id: 'lines', name: 'Lines' },
  { id: 'allover', name: 'All over, edge to edge' },
];

/** Border designs (used when the borders get their own). */
export const BORDER_PATTERNS = [
  { id: 'same', name: 'Same as the center' },
  { id: 'feather', name: 'Feathers' },
  { id: 'cable', name: 'Cable' },
  { id: 'lines', name: 'Lines' },
  { id: 'none', name: 'Plain' },
];

/** Density choices: spacing in inches (the base the patterns scale from). */
export const DENSITIES = [
  { sp: 3, name: 'Airy' },
  { sp: 2, name: 'Open' },
  { sp: 1.5, name: 'Classic' },
  { sp: 1, name: 'Close' },
  { sp: 0.5, name: 'Dense' },
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
export function baptistFan(w, h, sp, maxFans = Infinity) {
  sp = fanSpacing(w, h, sp, maxFans);
  const R = 4 * sp;
  const Rmax = 1.45 * R;
  const n = Math.floor(Rmax / sp + 1e-9);
  const fans = [];
  const top = Math.floor(w / R);
  for (let j = 0, cy = 0; cy <= h + R; j++, cy += R) {
    for (let i = 0, cx = top * R; cx >= -R; i++, cx -= R) fans.push([cx, cy, i, j]);
  }
  const inFan = ([x, y], [cx, cy]) => x >= cx - 1e-9 && y <= cy + 1e-9 && Math.hypot(x - cx, y - cy) < Rmax - 1e-6;
  const out = [];
  // Fans already stitched, by grid position: only the eight around a fan can
  // overlap it, so look those up instead of scanning every fan so far.
  const done = new Map();
  for (const c of fans) {
    const near = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const o = done.get(`${c[2] + di},${c[3] + dj}`);
      if (o) near.push(o);
    }
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
    done.set(`${c[2]},${c[3]}`, c);
  }
  return out;
}

/*
 * Stitch budget. A stipple at ¼" over a king-size quilt is millions of points:
 * stroking that on a phone froze the page for seconds per tap. Past these
 * counts the preview loosens the pattern (the cutting list and sizes are
 * unaffected), and the panel says so.
 */
export const MAX_MEANDER_CELLS = 9000;
export const MAX_FANS = 3600;

/** The meander's coarse grid for a cell size, loosened to stay within maxCells. */
export function meanderGrid(w, h, cell, maxCells = MAX_MEANDER_CELLS) {
  const grid = (c) => ({ cols: Math.max(1, Math.ceil(w / (c * 2))), rows: Math.max(1, Math.ceil(h / (c * 2))) });
  let g = grid(cell);
  let capped = false;
  for (let tries = 0; g.cols * g.rows > maxCells && tries < 40; tries++) {
    cell *= Math.max(1.02, Math.sqrt((g.cols * g.rows) / maxCells));
    g = grid(cell);
    capped = true;
  }
  return { ...g, cell, capped };
}

/** Fan spacing, loosened so the quilt holds at most maxFans fans. */
export function fanSpacing(w, h, sp, maxFans = MAX_FANS) {
  const count = (s) => (Math.floor(w / (4 * s)) + 2) * (Math.floor((h + 4 * s) / (4 * s)) + 1);
  for (let tries = 0; count(sp) > maxFans && tries < 60; tries++) sp *= 1.08;
  return sp;
}

/** True when the preview draws this quilting looser than asked (see the stitch budget). */
export function quiltingLoosened(design, layout = layoutQuilt(design), opts = design.quilting || {}) {
  const sp = Math.max(0.5, Number(opts.spacing) || 1.5);
  const area = bordersSeparate(design, opts) ? layout.center : layout;
  const { w, h } = area;
  if (opts.pattern === 'meander') return meanderGrid(w, h, sp * 1.2).capped;
  if (opts.pattern === 'stipple') return meanderGrid(w, h, sp * 0.45).capped;
  if (opts.pattern === 'fan') return fanSpacing(w, h, sp) > sp;
  if (EST[opts.pattern]) {
    return EST[opts.pattern](w, h, sp) > MAX_POINTS;
  }
  return false;
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

export function meander(w, h, cell, seed = 7, maxCells = Infinity) {
  const rng = mulberry32(seed);
  const { cols, rows } = meanderGrid(w, h, cell, maxCells);
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
  // Three rounding passes look best; on very long loops two are plenty.
  return [{ pts: chaikin(pts, pts.length > 16000 ? 2 : 3), closed: true }];
}

/** All the patch outlines (stitch in the ditch). */
function ditch(design, layout, keep = () => true) {
  const out = quiltPatches(design, layout).map((p) => ({ pts: p.pts, closed: true }));
  for (const p of layout.pieces) if (keep(p)) out.push({ pts: p.pts, closed: true });
  return out;
}

function echo(design, layout, sp, keep = () => true) {
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
    if (!keep(piece)) continue;
    for (let d = 0.25; d < 20; d += sp) {
      const q = insetConvex(piece.pts, d);
      if (!q) break;
      out.push({ pts: q, closed: true });
    }
  }
  return out;
}

const shift = (paths, dx, dy) => (dx || dy ? paths.map((p) => ({ ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy]) })) : paths);

/** An allover design over w × h. */
function allover(pattern, w, h, sp) {
  switch (pattern) {
    case 'grid': return gridLines(w, h, sp * 1.5);
    case 'crosshatch': return crosshatch(w, h, sp * 1.5);
    case 'diagonal': return diagonalLines(w, h, sp);
    case 'wavy': return wavy(w, h, sp);
    case 'chevron': return chevron(w, h, sp);
    case 'fan': return baptistFan(w, h, sp, MAX_FANS);
    case 'meander': return meander(w, h, sp * 1.2, 11, MAX_MEANDER_CELLS);
    case 'stipple': return meander(w, h, sp * 0.45, 5, MAX_MEANDER_CELLS);
    case 'loops': return loops(w, h, sp);
    case 'pebbles': return pebbles(w, h, sp);
    case 'swirls': return swirls(w, h, sp);
    case 'clamshell': return clamshell(w, h, sp);
    case 'orangepeel': return orangePeel(w, h, sp);
    case 'cathedral': return cathedral(w, h, sp);
    case 'pantograph': return pantograph(w, h, sp);
    case 'spiral': return spiral(w, h, sp);
    default: return [];
  }
}

/** True if the borders get their own design (and the center design stops at them). */
export function bordersSeparate(design, opts = design.quilting || {}) {
  return !!design.borders?.length && !!opts.border && opts.border !== 'same';
}

/**
 * The quilting, in two layers:
 *   center  polylines for the center design (the whole quilt when the
 *           borders share it)
 *   clip    the rect the center design is confined to, or null
 *   border  polylines for the border design (empty when shared)
 */
export function quiltingLayers(design, layout = layoutQuilt(design), opts = design.quilting || {}) {
  const sp = Math.max(0.5, Number(opts.spacing) || 1.5);
  const sep = bordersSeparate(design, opts);
  const area = sep ? layout.center : { x: 0, y: 0, w: layout.w, h: layout.h };
  const keepPiece = (p) => !sep || p.kind !== 'border';
  let center;
  switch (opts.pattern) {
    case 'ditch': center = ditch(design, layout, keepPiece); break;
    case 'echo': center = echo(design, layout, Math.max(0.5, sp * 0.5), keepPiece); break;
    case 'curves': center = continuousCurves([...quiltPatches(design, layout).map((p) => p.pts), ...layout.pieces.filter(keepPiece).map((p) => p.pts)]); break;
    case 'sqsq': center = squareInSquare(layout.blocks.map(instCorners), sp); break;
    default: center = shift(allover(opts.pattern, area.w, area.h, sp), area.x, area.y);
  }
  const border = sep ? borderPaths(design, layout, opts.border, sp) : [];
  return { center, clip: sep ? area : null, border };
}

/** Border design paths, strip by strip (sides between the top and bottom strips). */
export function borderPaths(design, layout, kind, sp) {
  if (!kind || kind === 'none' || kind === 'same') return [];
  const out = [];
  let x0 = layout.center.x, y0 = layout.center.y, x1 = x0 + layout.center.w, y1 = y0 + layout.center.h;
  for (const b of layout.borders) {
    const w = b.w;
    const X0 = x0 - w, Y0 = y0 - w, X1 = x1 + w, Y1 = y1 + w;
    // Top and bottom run the full width; the sides fit between them.
    out.push(...borderStrip(kind, [X0, Y0 + w / 2], [X1, Y0 + w / 2], w, sp));
    out.push(...borderStrip(kind, [X1, Y1 - w / 2], [X0, Y1 - w / 2], w, sp));
    out.push(...borderStrip(kind, [X0 + w / 2, y1], [X0 + w / 2, y0], w, sp));
    out.push(...borderStrip(kind, [X1 - w / 2, y0], [X1 - w / 2, y1], w, sp));
    x0 = X0; y0 = Y0; x1 = X1; y1 = Y1;
  }
  return out;
}

/**
 * The quilting paths for a design, as one list (center and border together).
 * opts: { pattern, spacing, border } (defaults to design.quilting)
 */
export function quiltingPaths(design, layout = layoutQuilt(design), opts = design.quilting || {}) {
  const l = quiltingLayers(design, layout, opts);
  return [...l.center, ...l.border];
}

/* ----------------------------------------------- more quilting designs */
//
// All in quilt inches over a w × h area from the origin; quiltingLayers
// shifts them onto the center when the borders get their own design.

/** Max points an allover design may use before the preview loosens it. */
export const MAX_POINTS = 140000;

/** Loosens a spacing until est(sp) fits the budget. */
function fit(sp, est, max = MAX_POINTS) {
  for (let i = 0; est(sp) > max && i < 80; i++) sp *= 1.08;
  return sp;
}

/** Rough point counts per design, for the stitch budget. */
const EST = {
  chevron: (w, h, s) => (h / s + 1) * (w / (s / 2) + 2),
  wavy: (w, h, s) => (h / s + 1) * (w / (s / 6) + 2),
  loops: (w, h, s) => (h / (2 * s) + 1) * (w / (1.3 * s) + 2) * 18,
  pebbles: (w, h, s) => (w / (1.1 * s) + 1) * (h / (1.1 * s) + 1) * 2 * 16,
  swirls: (w, h, s) => (w / (2 * s) + 2) * (h / (1.74 * s) + 2) * 49,
  clamshell: (w, h, s) => (h / s + 2) * (w / (2 * s) + 2) * 12,
  orangepeel: (w, h, s) => ((h / (1.5 * s) + 1) * (w / (1.5 * s) + 1)) * 4 * 8,
  cathedral: (w, h, s) => (h / (1.2 * s) + 2) * (w / (1.6 * s) + 2) * 16,
  pantograph: (w, h, s) => (h / (2.6 * s) + 1) * (w / (3.6 * s) + 2) * 60,
  spiral: (w, h, s) => (Math.PI * (Math.hypot(w, h) / 2) ** 2) / (1.2 * s) / (s / 3),
};

/** A gentle arc from p to q: a quadratic curve whose middle sits `bulge` off the chord (to its left, y down). */
export function arc(p, q, bulge, segs = 8, skipFirst = false) {
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  // control point twice the sagitta off the chord gives that sagitta at t = ½
  const cx = mx + (dy / len) * bulge * 2;
  const cy = my - (dx / len) * bulge * 2;
  const out = [];
  for (let i = skipFirst ? 1 : 0; i <= segs; i++) {
    const t = i / segs;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    out.push([a * p[0] + b * cx + c * q[0], a * p[1] + b * cy + c * q[1]]);
  }
  return out;
}

const circlePts = (cx, cy, r, segs, a0 = 0) => Array.from({ length: segs }, (_, i) => {
  const a = a0 + (2 * Math.PI * i) / segs;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

export function diagonalLines(w, h, sp) {
  const out = [];
  const step = sp * Math.SQRT2;
  for (let c = -h; c < w; c += step) {
    const a = clipSegmentToRect([c, 0], [c + h, h], 0, 0, w, h);
    if (a) out.push({ pts: a });
  }
  return out;
}

/** Rows of zigzags (chevrons). */
export function chevron(w, h, sp) {
  sp = fit(sp, (s) => EST.chevron(w, h, s));
  const out = [];
  const a = sp * 0.45;
  for (let y = sp / 2; y < h + a; y += sp) {
    const pts = [];
    for (let i = 0, x = 0; x <= w + sp; i++, x += sp / 2) pts.push([x, y + (i % 2 ? -a : a)]);
    out.push({ pts });
  }
  return out;
}

/** Wavy lines across the quilt. */
export function wavy(w, h, sp) {
  sp = fit(sp, (s) => EST.wavy(w, h, s));
  const out = [];
  const P = sp * 2.6;
  const A = sp * 0.28;
  for (let y = sp / 2; y < h + A; y += sp) {
    const pts = [];
    for (let x = 0; x <= w + sp / 6; x += sp / 6) pts.push([x, y + A * Math.sin((2 * Math.PI * x) / P)]);
    out.push({ pts });
  }
  return out;
}

/** Loop-de-loops: rows of a curl that crosses back over itself (a prolate cycloid). */
export function loops(w, h, sp) {
  sp = fit(sp, (s) => EST.loops(w, h, s));
  const out = [];
  const L = 1.3 * sp; // advance per loop
  const R = 0.62 * sp; // loop radius (> L / 2π makes the loop)
  for (let row = 0, y = sp; y < h + R; row++, y += 2 * sp) {
    const pts = [];
    const n = Math.ceil(w / L) + 2;
    for (let i = 0; i <= n * 18; i++) {
      const t = (i / 18) * 2 * Math.PI;
      pts.push([-L + (L * t) / (2 * Math.PI) + R * Math.sin(t), y - R * Math.cos(t) * (row % 2 ? -1 : 1)]);
    }
    out.push({ pts });
  }
  return out;
}

/** Pebbles: round stones of mixed sizes, packed without overlapping. */
export function pebbles(w, h, sp, seed = 3) {
  sp = fit(sp, (s) => EST.pebbles(w, h, s));
  const rng = mulberry32(seed);
  const cell = 1.1 * sp;
  const out = [];
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
    const r = cell * (0.26 + rng() * 0.2);
    const cx = x + r + rng() * (cell - 2 * r);
    const cy = y + r + rng() * (cell - 2 * r);
    out.push({ pts: circlePts(cx, cy, r, 16, rng() * 6.28), closed: true });
    // A small pebble tucked into the roomiest corner of the cell.
    const s = cell * 0.13;
    const corners = [[x + s * 1.05, y + s * 1.05], [x + cell - s * 1.05, y + s * 1.05], [x + s * 1.05, y + cell - s * 1.05], [x + cell - s * 1.05, y + cell - s * 1.05]];
    const far = corners.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cy) > Math.hypot(b[0] - cx, b[1] - cy) ? c : b));
    if (Math.hypot(far[0] - cx, far[1] - cy) > r + s * 1.15) out.push({ pts: circlePts(far[0], far[1], s, 12), closed: true });
  }
  return out;
}

/** Swirls: little spirals scattered over the quilt, each turned its own way. */
export function swirls(w, h, sp, seed = 9) {
  sp = fit(sp, (s) => EST.swirls(w, h, s));
  const rng = mulberry32(seed);
  const cell = 2 * sp;
  const out = [];
  for (let row = 0, y = 0; y < h; row++, y += cell * 0.87) {
    for (let x = (row % 2) * cell * 0.5 - cell * 0.5; x < w; x += cell) {
      const cx = x + cell / 2 + (rng() - 0.5) * cell * 0.12;
      const cy = y + cell / 2 + (rng() - 0.5) * cell * 0.12;
      const R = cell * 0.46;
      const turns = 2.2;
      const dir = rng() < 0.5 ? 1 : -1;
      const a0 = rng() * 2 * Math.PI;
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const a = a0 + dir * t * turns * 2 * Math.PI;
        pts.push([cx + R * t * Math.cos(a), cy + R * t * Math.sin(a)]);
      }
      out.push({ pts });
    }
  }
  return out;
}

/** Clamshells: rows of half circles, every other row shifted half a shell. */
export function clamshell(w, h, sp) {
  sp = fit(sp, (s) => EST.clamshell(w, h, s));
  const r = sp;
  const out = [];
  for (let j = 0, y = 0; y < h + 2 * r; j++, y += r) {
    const pts = [];
    for (let cx = -2 * r + (j % 2) * r; cx < w + 2 * r; cx += 2 * r) {
      for (let i = pts.length ? 1 : 0; i <= 12; i++) {
        const a = Math.PI + (Math.PI * i) / 12;
        pts.push([cx + r * Math.cos(a), y + r * Math.sin(a)]);
      }
    }
    out.push({ pts });
  }
  return out;
}

/** Orange peel: a petal on every grid line, so four petals meet at each crossing. */
export function orangePeel(w, h, sp) {
  sp = fit(sp, (s) => EST.orangepeel(w, h, s));
  const g = 1.5 * sp;
  const b = g * 0.21;
  const out = [];
  const run = (p0, step, n, bulge) => {
    let pts = [p0];
    for (let i = 0; i < n; i++) {
      const p = [p0[0] + step[0] * i, p0[1] + step[1] * i];
      const q = [p0[0] + step[0] * (i + 1), p0[1] + step[1] * (i + 1)];
      pts = pts.concat(arc(p, q, bulge, 8, true));
    }
    return { pts };
  };
  const nx = Math.ceil(w / g);
  const ny = Math.ceil(h / g);
  for (let j = 0; j <= ny; j++) for (const s of [1, -1]) out.push(run([0, j * g], [g, 0], nx, s * b));
  for (let i = 0; i <= nx; i++) for (const s of [1, -1]) out.push(run([i * g, 0], [0, g], ny, s * b));
  return out;
}

/** Cathedral arcs: rows of pointed arches, every other row shifted to nest. */
export function cathedral(w, h, sp) {
  sp = fit(sp, (s) => EST.cathedral(w, h, s));
  const W = 1.6 * sp;
  const H = 1.2 * sp;
  const out = [];
  for (let j = 0, base = H; base < h + H; j++, base += H) {
    let pts = [];
    for (let x = -W + (j % 2) * (W / 2); x < w + W; x += W) {
      const a = [x, base];
      const top = [x + W / 2, base - H];
      const c = [x + W, base];
      if (!pts.length) pts.push(a);
      pts = pts.concat(arc(a, top, -0.16 * W, 8, true), arc(top, c, -0.16 * W, 8, true));
    }
    out.push({ pts });
  }
  return out;
}

/** An Archimedean spiral from the middle out to the corners. */
export function spiral(w, h, sp) {
  const rmax = Math.hypot(w, h) / 2;
  sp = fit(sp, (s) => EST.spiral(w, h, s));
  const gap = 1.2 * sp;
  const pts = [];
  let a = 0;
  for (let r = 0; r <= rmax && pts.length < MAX_POINTS * 1.1;) {
    pts.push([w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)]);
    const da = Math.min(0.5, (sp / 3) / Math.max(r, sp / 3));
    a += da;
    r = (gap * a) / (2 * Math.PI);
  }
  return [{ pts }];
}

/**
 * Leafy vine pantograph: an edge-to-edge row design, a wave with a leaf off
 * every crest and trough, repeated down the quilt.
 */
export function pantograph(w, h, sp) {
  sp = fit(sp, (s) => EST.pantograph(w, h, s));
  const P = 3.6 * sp; // one repeat: a crest and a trough
  const A = 0.55 * sp;
  const out = [];
  for (let y = 1.3 * sp; y < h + 2 * sp; y += 2.6 * sp) {
    const spine = [];
    for (let x = -P / 2; x <= w + P / 2; x += P / 24) spine.push([x, y + A * Math.sin((2 * Math.PI * x) / P)]);
    out.push({ pts: spine });
    for (let x0 = -P / 4; x0 < w + P; x0 += P / 2) {
      // Crest at sin = 1 (x = P/4), trough at sin = -1: leaves point away from the vine.
      const up = Math.round((x0 + P / 4) / (P / 2)) % 2 === 0;
      const base = [x0 + P / 4, y + A * (up ? 1 : -1) * -1];
      const dir = up ? -1 : 1;
      const tip = [base[0] + 0.55 * sp, base[1] + dir * 1.05 * sp];
      out.push({ pts: [...arc(base, tip, 0.22 * sp, 8), ...arc(tip, base, 0.22 * sp, 8, true)], closed: true });
    }
  }
  return out;
}

/* ---- designs that follow the piecing */

/** Continuous curves: every patch edge replaced by an arc bowing in, so the lines flow patch to patch. */
export function continuousCurves(polys) {
  const edges = polys.reduce((s, p) => s + p.length, 0);
  const segs = Math.max(3, Math.min(8, Math.floor(MAX_POINTS / Math.max(1, edges))));
  return polys.map((pts) => {
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= pts.length; cy /= pts.length;
    let out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      // Bow toward the patch's middle.
      const side = (q[0] - p[0]) * (cy - p[1]) - (q[1] - p[1]) * (cx - p[0]);
      out = out.concat(arc(p, q, (side < 0 ? 1 : -1) * len * 0.17, segs, out.length > 0));
    }
    return { pts: out, closed: true };
  });
}

/** Square in a square: in each block, nested squares joining the midpoints of the one outside. */
export function squareInSquare(quads, sp) {
  const out = [];
  for (const q of quads) {
    let poly = insetConvex(q, 0.25) || q;
    for (let k = 0; k < 8; k++) {
      out.push({ pts: poly, closed: true });
      const side = Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
      if (side / Math.SQRT2 < sp * 1.2) break;
      poly = poly.map((p, i) => { const n = poly[(i + 1) % poly.length]; return [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]; });
    }
  }
  return out;
}

/* ---- border designs, along a strip */

/**
 * A strip of border: its long axis runs from a to b (the middle of the
 * strip), `width` across. Returns polylines for a border design.
 */
export function borderStrip(kind, a, b, width, sp) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6 || width <= 0.5) return [];
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const nx = -uy;
  const ny = ux;
  const at = (s, o) => [a[0] + ux * s + nx * o, a[1] + uy * s + ny * o];
  const half = width / 2 - 0.4; // keep clear of the seams and the binding
  const out = [];
  if (kind === 'lines') {
    const n = Math.max(1, Math.floor((2 * half) / Math.max(0.5, sp * 0.75)));
    for (let i = 0; i <= n; i++) {
      const o = -half + (2 * half * i) / n;
      out.push({ pts: [at(0, o), at(len, o)] });
    }
  } else if (kind === 'cable') {
    // Two waves half a turn apart: a chain of interlocked ovals, like a rope.
    const P = Math.max(1.5, width * 1.5);
    const A = half * 0.9;
    for (const ph of [0, Math.PI]) {
      const pts = [];
      for (let s = 0; s <= len; s += P / 24) pts.push(at(s, A * Math.sin((2 * Math.PI * s) / P + ph)));
      out.push({ pts });
    }
  } else if (kind === 'feather') {
    // A feathered vine: a gently waving spine with plumes leaning forward on both sides.
    const P = Math.max(3, width * 3);
    const A = half * 0.18;
    const spine = (s) => A * Math.sin((2 * Math.PI * s) / P);
    const pts = [];
    for (let s = 0; s <= len; s += P / 30) pts.push(at(s, spine(s)));
    out.push({ pts });
    const step = Math.max(0.5, half * 0.42);
    const L = half * 0.85;
    for (const side of [1, -1]) {
      // Plumes lean forward, so stop a plume's length short of the end.
      for (let s = step * (side > 0 ? 0.5 : 1); s < len - L; s += step) {
        const base = at(s, spine(s));
        const lean = 0.85; // radians from the perpendicular, toward the vine's travel
        const dx = ux * Math.sin(lean) + nx * side * Math.cos(lean);
        const dy = uy * Math.sin(lean) + ny * side * Math.cos(lean);
        const c = [base[0] + dx * L / 2, base[1] + dy * L / 2];
        const plume = [];
        for (let i = 0; i < 14; i++) {
          const t = (2 * Math.PI * i) / 14;
          const ex = (L / 2) * Math.cos(t);
          const ey = L * 0.24 * Math.sin(t);
          plume.push([c[0] - dx * ex - dy * ey, c[1] - dy * ex + dx * ey]);
        }
        out.push({ pts: plume, closed: true });
      }
    }
  }
  return out;
}
