// resist.js — the pattern side of the Dye Studio. PURE: no DOM, no Date.now, no Math.random.
//
// Every generator works on an N×N grid and returns Float32Arrays:
//   resist  0 = dye takes fully, 1 = the cloth stays as it was. A little below 0 means dye
//           pools there (the dark line where dye creeps to the edge of a clamp).
//   coord   (tie-dye) where a pixel sat in the tied bundle, 0..1: the wedge of a spiral, the
//           ring of a bullseye, the lump of a crumple. Dye squirted on section k lands where
//           coord is near (k + 0.5) / n.
// They imitate what the cloth does in the real crafts: folds, clamps, poles, bound points,
// gathered stitches, wax crackle, ice melting through powder, and carved blocks.

import { vnoise, mulberry32 } from '../fabric/textures.js';

const TAU = Math.PI * 2;
export const g2 = (v) => Math.exp(-v * v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a, b, v) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
const BIG = 1 << 16;
/** Non-periodic value noise in [0,1]. */
export const nz = (x, y, s) => vnoise(x, y, BIG, BIG, s);
export function fbm(x, y, s, oct = 3) {
  let a = 1, f = 1, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) { sum += a * nz(x * f, y * f, s + o * 131); n += a; a *= 0.5; f *= 2; }
  return sum / n;
}
const ridge = (v) => 1 - Math.abs(2 * v - 1);

/** Separable box blur (2 passes ≈ gaussian), wrapping at the edges. Returns a new array. */
export function blur(src, W, H, r, wrap = true) {
  if (r <= 0) return Float32Array.from(src);
  const ri = Math.max(1, Math.ceil(r));
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    boxH(a, b, W, H, ri, wrap); boxV(b, a, W, H, ri, wrap);
  }
  if (ri !== r) { const t = r / ri; for (let i = 0; i < a.length; i++) a[i] = src[i] + (a[i] - src[i]) * t; }
  return a;
}
function boxH(src, dst, W, H, r, wrap) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + idx(k, W, wrap)];
    for (let x = 0; x < W; x++) {
      dst[row + x] = acc * inv;
      acc += src[row + idx(x + r + 1, W, wrap)] - src[row + idx(x - r, W, wrap)];
    }
  }
}
function boxV(src, dst, W, H, r, wrap) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[idx(k, H, wrap) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = acc * inv;
      acc += src[idx(y + r + 1, H, wrap) * W + x] - src[idx(y - r, H, wrap) * W + x];
    }
  }
}
function idx(i, n, wrap) { return wrap ? ((i % n) + n) % n : (i < 0 ? 0 : i >= n ? n - 1 : i); }

// ------------------------------------------------------------------ batik: crackle
/**
 * Crumpling cold wax cracks it into a network of fine veins. Worley-cell edges (F2 − F1 small),
 * stretched along the crumple direction, wobbled and broken in places, at two scales.
 */
export function crackle(N, seed) {
  const rng = mulberry32(seed * 53 + 1);
  const out = new Float32Array(N * N);
  const k = N / 512;
  const layers = [
    { cell: 30 * k, w: 0.75, amp: 1, keep: 0.3 },
    { cell: 15 * k, w: 0.6, amp: 0.75, keep: 0.45 },
    { cell: 64 * k, w: 0.9, amp: 0.9, keep: 0.2 },
  ];
  for (const [li, L] of layers.entries()) {
    const ang = rng() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    const stretch = 1.5 + rng() * 0.6;
    const s = seed * 7 + li * 101;
    // Feature points are looked up 9 times per pixel but there are only a few hundred cells:
    // compute each once (same values, about 4x faster, so crumpling doesn't freeze a phone).
    const cells = new Map();
    const cellPt = (cx, cy) => {
      const key = cx * 65536 + cy;
      let q = cells.get(key);
      if (!q) { q = [cx + 0.1 + 0.8 * nz(cx * 1.37, cy * 1.91, s), cy + 0.1 + 0.8 * nz(cx * 2.11, cy * 1.13, s + 9)]; cells.set(key, q); }
      return q;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      // wobble the cracks, then rotate + stretch so they run mostly one way like real crumples
      const wx = x + 6 * k * (fbm(x / (40 * k), y / (40 * k), s + 3, 2) - 0.5);
      const wy = y + 6 * k * (fbm(x / (40 * k), y / (40 * k), s + 5, 2) - 0.5);
      const u = (wx * ca + wy * sa) / L.cell, v = (-wx * sa + wy * ca) / L.cell * stretch;
      const ix = Math.floor(u), iy = Math.floor(v);
      let f1 = 1e9, f2 = 1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const p = cellPt(ix + dx, iy + dy);
        const ex = (u - p[0]), ey = (v - p[1]) / stretch;
        const d = ex * ex + ey * ey;
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const edgePx = (Math.sqrt(f2) - Math.sqrt(f1)) * L.cell;
      let line = 1 - smoothstep(0.15 * L.w, 1.25 * L.w, edgePx);
      if (line <= 0) continue;
      line *= smoothstep(L.keep - 0.1, L.keep + 0.1, nz(x / (30 * k), y / (30 * k), s + 17)) * L.amp;
      const p = y * N + x;
      if (line > out[p]) out[p] = line;
    }
  }
  return out;
}

// ------------------------------------------------------------------ shibori
export const SHIBORI = [
  { id: 'itajime', name: 'Itajime', note: 'Fold the cloth into a stack and clamp shapes between boards.' },
  { id: 'arashi', name: 'Arashi', note: 'Wrap it on a pole, bind with thread and push it down: storm lines.' },
  { id: 'kumo', name: 'Kumo', note: 'Pinch up points and bind them tightly: spider webs.' },
  { id: 'mokume', name: 'Mokume', note: 'Rows of running stitch, pulled tight: wood grain.' },
];

/** Itajime: accordion-fold both ways (optionally into triangles) and clamp a shape. */
export function itajime(N, opts = {}, seed = 1) {
  const folds = opts.folds || 4, P = N / folds;
  const tri = opts.fold === 'triangle', clampShape = opts.clamp || 'circle';
  const out = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let u = x % (2 * P); if (u > P) u = 2 * P - u;
    let v = y % (2 * P); if (v > P) v = 2 * P - v;
    let U = u / P, V = v / P;
    if (tri && V > U) { const t = U; U = V; V = t; }
    const ix = Math.floor(x / P), iy = Math.floor(y / P);
    // each panel sat at a different depth in the stack: outer layers drink more dye
    const layer = 0.75 + 0.5 * nz(ix * 3.1 + 0.5, iy * 2.7 + 0.5, seed + 5);
    let sdf;
    if (clampShape === 'square') sdf = Math.max(Math.abs(U - 0.5), Math.abs(V - 0.5)) - 0.25;
    else if (clampShape === 'corner') sdf = Math.hypot(U, V) - 0.46;
    else if (clampShape === 'bars') sdf = Math.min(Math.abs(U - 0.5), Math.abs(V - 0.5)) - 0.075;
    else if (clampShape === 'triangle') sdf = Math.max(-V + 0.18, U - 0.82, V - U + 0.12) ;
    else if (tri) sdf = Math.hypot(U - 0.62, V - 0.3) - 0.22;
    else sdf = Math.hypot(U - 0.5, V - 0.5) - 0.27;
    const sp = sdf * P;
    // dye creeps under the board edge in a fibrous, feathery fringe
    const feather = (fbm(x / (5 * k), y / (5 * k), seed + 11, 3) - 0.5) * 10 * k + (fbm(x / (40 * k), y / (40 * k), seed + 12, 2) - 0.5) * 8 * k;
    const soft = (4 + 7 * layer) * k;
    const e = sp + feather;
    const shape = (1 - smoothstep(-soft, soft * 0.5, e)) * (0.82 + 0.18 * nz(ix * 1.7 + 0.3, iy * 2.3 + 0.7, seed + 6));
    const pool = e > 0 ? -0.22 * g2((e - 2 * k) / (3 * k)) : 0;
    // folded stack: dye gets in from the folded edges, less into the middle of each panel
    const inner = Math.min(U, 1 - U, V, 1 - V);
    const stack = 0.3 * layer * smoothstep(0.02, 0.3, inner) * (0.7 + 0.6 * fbm(x / (60 * k), y / (60 * k), seed + 13, 2));
    const crease = -0.2 * g2((inner * P) / (1.8 * k)) + 0.18 * g2((inner * P - 4 * k) / (2 * k));
    out[y * N + x] = Math.max(shape * 0.97, stack + crease) + pool * (1 - shape);
  }
  return { resist: out };
}

/** Arashi: diagonal pole wrap, bound and compressed; the pleats take fine storm lines. */
export function arashi(N, opts = {}, seed = 1) {
  const ang = opts.angle ?? 0.62;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const out = new Float32Array(N * N);
  const k = N / 512;
  const wrap = N * (0.3 + 0.05 * nz(1, 2, seed));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const s = x * ca + y * sa, t0 = -x * sa + y * ca;
    const t = t0 + 7 * k * (fbm(s / (110 * k), t0 / (110 * k), seed + 1, 2) - 0.5) + 2.5 * k * (nz(s / (25 * k), t0 / (25 * k), seed + 2) - 0.5);
    const r1 = ridge(nz(s / (90 * k), t / (3.2 * k), seed + 3)) ** 4;
    const r2 = ridge(nz(s / (40 * k), t / (1.7 * k), seed + 4)) ** 6;
    const r3 = ridge(nz(s / (160 * k), t / (5 * k), seed + 6)) ** 5;
    const streak = Math.max(r1 * 0.95, r2 * 0.75, r3 * 0.55);
    // where the cloth overlapped itself on the pole it took less dye: broad soft bands
    const band = 0.16 * (0.5 + 0.5 * Math.sin(TAU * t0 / wrap + 3 * fbm(s / (200 * k), t0 / (200 * k), seed + 7, 2)));
    const breaks = smoothstep(0.25, 0.55, nz(s / (55 * k), t / (9 * k), seed + 8));
    out[y * N + x] = Math.min(0.96, smoothstep(0.15, 0.85, streak) * (0.5 + 0.5 * breaks) + band);
  }
  return { resist: out };
}

/** Kumo: points pinched into cones and bound with thread from base to tip. */
export function kumo(N, opts = {}, seed = 1) {
  const g = opts.count === 'many' ? 4 : opts.count === 'one' ? 1 : 3;
  const rng = mulberry32(seed * 17 + 3);
  const cell = N / g;
  const pts = [];
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    const R = cell * (0.4 + 0.09 * rng());
    pts.push({
      x: (i + 0.5 + (rng() - 0.5) * 0.3) * cell, y: (j + 0.5 + (rng() - 0.5) * 0.3) * cell, R,
      K: 11 + Math.floor(rng() * 7), rot: rng() * TAU, pitch: R * (0.075 + 0.03 * rng()), s: seed * 5 + i * 13 + j * 31,
    });
  }
  const out = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let best = 0;
    for (const p of pts) {
      // distance with wrap so cones near the edge continue across
      let dx = x - p.x, dy = y - p.y;
      if (dx > N / 2) dx -= N; else if (dx < -N / 2) dx += N;
      if (dy > N / 2) dy -= N; else if (dy < -N / 2) dy += N;
      const r = Math.hypot(dx, dy);
      if (r > p.R * 1.15) continue;
      const phi = Math.atan2(dy, dx) + p.rot;
      const rn = r / p.R;
      // radial pleats: the folds of the cone are exposed and dye runs down them
      const ph = (phi / TAU) * p.K + 0.9 * (nz(r / (14 * k), phi * 2, p.s) - 0.5);
      const lineW = 0.35 + 0.65 * nz(Math.round(ph) * 1.3, 0.5, p.s + 3);
      const pleat = lineW * g2(((ph - Math.round(ph)) * TAU * Math.max(r, 3 * k) / p.K) / (1.1 * k + r * 0.012));
      // thread wound in a spiral: thin gaps between turns let dye in as faint rings
      const tp = (r - (phi / TAU) * p.pitch + 3 * k * (nz(phi * 2, r / (12 * k), p.s + 4) - 0.5)) / p.pitch;
      const gapRing = g2(((tp - Math.round(tp)) * p.pitch) / (0.9 * k)) * (0.45 + 0.55 * nz(phi * 3, r / (9 * k), p.s + 1));
      const lines = Math.max(pleat * (0.35 + 0.65 * rn), gapRing * 0.28 * smoothstep(0.3, 0.7, rn));
      const bound = 1 - smoothstep(0.78, 1.05, rn + 0.18 * (nz(Math.cos(phi) * 2 + 5, Math.sin(phi) * 2 + 5, p.s + 2) - 0.5));
      const tip = smoothstep(0.03, 0.09, rn);
      const v = bound * tip * (0.95 - 0.85 * lines);
      if (v > best) best = v;
    }
    out[y * N + x] = best;
  }
  return { resist: out, pts: pts.map((p) => ({ x: p.x / N, y: p.y / N, R: p.R / N })) };
}

/** Mokume: parallel rows of running stitches gathered tight; it dyes like wood grain. */
export function mokume(N, opts = {}, seed = 1) {
  const rows = opts.rows || 13;
  const S = N / rows;
  const out = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const yy = y + 22 * k * (fbm(x / (110 * k), y / (160 * k), seed + 1, 2) - 0.5) + 2.5 * k * (nz(x / (30 * k), y / (30 * k), seed + 4) - 0.5);
    const rp = yy / S, row = Math.floor(rp), f = rp - row;
    const near = 1 - Math.abs(f - 0.5) * 2; // 1 at the stitch line
    // the stitches themselves: dashed thread
    const dash = ((x / (9 * k) + row * 0.37) % 1 + 1) % 1 < 0.58 ? 1 : 0;
    const stitch = dash * g2(((f - 0.5) * S) / (1.3 * k));
    // gathered pleats: vertical ridges, sharp and white near the thread, fading toward the next row
    const xx = x + 4 * k * (fbm(x / (16 * k), rp * 2, seed + 7, 2) - 0.5);
    const pl = ridge(nz(xx / (5.5 * k), rp * 1.1 + row * 3.1, seed + 9)) ** 3;
    const pl2 = ridge(nz(xx / (9 * k), rp * 1.2 + row * 1.7, seed + 10)) ** 4;
    const bunch = 0.55 + 0.6 * fbm(x / (45 * k), row * 2.3, seed + 12, 2);
    const pleat = smoothstep(0.1, 0.8, Math.max(pl, pl2 * 0.8)) * Math.min(1, near * bunch * 1.25) ** 1.2;
    out[y * N + x] = Math.min(0.96, Math.max(stitch * 0.7, pleat * 0.9) + 0.4 * (near * bunch) ** 3);
  }
  return { resist: out };
}

export function shibori(kind, N, opts, seed) {
  if (kind === 'itajime') return itajime(N, opts, seed);
  if (kind === 'arashi') return arashi(N, opts, seed);
  if (kind === 'kumo') return kumo(N, opts, seed);
  return mokume(N, opts, seed);
}

// ------------------------------------------------------------------ tie-dye & ice
export const TIES = [
  { id: 'spiral', name: 'Spiral', note: 'Pinch the middle and twist it into a flat coil.' },
  { id: 'bullseye', name: 'Bullseye', note: 'Pull up from the center and band it into rings.' },
  { id: 'crumple', name: 'Crumple', note: 'Scrunch it into a loose lump.' },
];

/** Spiral: the twisted coil is a disk of wedges between bands; pleats run along the arms. */
export function spiral(N, opts = {}, seed = 1) {
  const n = opts.n || 4;
  const cx = N * (0.5 + (nz(1, 1, seed) - 0.5) * 0.06), cy = N * (0.5 + (nz(2, 3, seed) - 0.5) * 0.06);
  const twist = opts.twist ?? 1.15;
  const resist = new Float32Array(N * N), coord = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    const rr = r / N;
    let c = (Math.atan2(dy, dx) / TAU + twist * Math.sqrt(rr) * 1.6 + 1) % 1;
    c = (c + 0.025 * (fbm(x / (50 * k), y / (50 * k), seed + 3, 2) - 0.5) + 1) % 1;
    coord[y * N + x] = c;
    // pleats of the coil (follow the arms), tighter and whiter near the center
    const K = 20;
    const ph = c * K + 0.6 * (nz(r / (18 * k), c * 9, seed + 5) - 0.5);
    const pleat = ridge(ph - Math.floor(ph)) ** 5 * (0.55 + 0.45 * Math.exp(-rr * 3)) * smoothstep(0.02, 0.06, rr);
    // the rubber bands sit between the wedges: white, slightly ragged lines
    const bp = c * n;
    const bd = Math.abs(bp - Math.round(bp)) / n * TAU * Math.max(r, 4);
    const band = g2((bd) / ((2.2 + 1.5 * nz(r / (20 * k), 1, seed + 6)) * k));
    const knot = 1 - smoothstep(4 * k, 14 * k, r);
    resist[y * N + x] = Math.min(0.97, Math.max(pleat * 0.92, band * 0.85, knot * 0.7) + 0.07 * nz(x / (12 * k), y / (12 * k), seed + 8));
  }
  return { resist, coord, n, circular: true, cx: cx / N, cy: cy / N };
}

/** Bullseye: a cone banded at intervals: rings of color between white bands, radial pleat lines. */
export function bullseye(N, opts = {}, seed = 1) {
  const n = opts.n || 4;
  const cx = N * 0.5, cy = N * 0.5, Rm = N * 0.72;
  const resist = new Float32Array(N * N), coord = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
    const wob = 1 + 0.07 * (fbm(Math.cos(phi) * 2 + 3, Math.sin(phi) * 2 + 3, seed + 1, 2) - 0.5) + 0.03 * (nz(phi * 6, r / (30 * k), seed + 2) - 0.5);
    const c = Math.min(0.999, (r * wob) / Rm);
    coord[y * N + x] = c;
    const bp = c * n;
    const bd = Math.abs(bp - Math.round(bp)) / n * Rm;
    const band = Math.round(bp) > 0 && Math.round(bp) < n ? g2(bd / ((3 + 2 * nz(phi * 5, 2, seed + 3)) * k)) : 0;
    const K = 44;
    const ph = (phi / TAU) * K + 1.2 * (nz(r / (25 * k), phi * 3, seed + 4) - 0.5);
    const pleat = ridge(ph - Math.floor(ph)) ** 9 * (0.5 + 0.5 * (1 - c));
    const tip = 1 - smoothstep(3 * k, 10 * k, r);
    resist[y * N + x] = Math.min(0.97, Math.max(band * 0.9, pleat * 0.7, tip * 0.5) + 0.06 * nz(x / (10 * k), y / (10 * k), seed + 8));
  }
  return { resist, coord, n, circular: false };
}

/** Crumple: lumps of a scrunched cloth; white crinkle lines on the ridges. */
export function crumple(N, opts = {}, seed = 1) {
  const n = opts.n || 3;
  const resist = new Float32Array(N * N), coord = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c0 = fbm(x / (150 * k), y / (150 * k), seed + 1, 3);
    coord[y * N + x] = clamp01((c0 - 0.3) / 0.4);
    const wx = x + 8 * k * (fbm(x / (50 * k), y / (50 * k), seed + 2, 2) - 0.5);
    const wy = y + 8 * k * (fbm(x / (50 * k), y / (50 * k), seed + 3, 2) - 0.5);
    const r1 = ridge(fbm(wx / (38 * k), wy / (38 * k), seed + 4, 2)) ** 10;
    const r2 = ridge(nz(wx / (14 * k), wy / (14 * k), seed + 5)) ** 12;
    const blot = smoothstep(0.55, 0.8, fbm(x / (26 * k), y / (26 * k), seed + 6, 3));
    resist[y * N + x] = Math.min(0.95, Math.max(r1 * 0.9, r2 * 0.6) + blot * 0.35);
  }
  return { resist, coord, n, circular: false };
}

/** Ice dye: cloth scrunched on a rack; melt water runs along the folds, ridges stay pale. */
export function iceScrunch(N, opts = {}, seed = 1) {
  const resist = new Float32Array(N * N);
  const k = N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = x + 10 * k * (fbm(x / (60 * k), y / (60 * k), seed + 2, 2) - 0.5);
    const wy = y + 10 * k * (fbm(x / (60 * k), y / (60 * k), seed + 3, 2) - 0.5);
    const r1 = ridge(fbm(wx / (46 * k), wy / (46 * k), seed + 4, 2)) ** 7;
    const r2 = ridge(nz(wx / (16 * k), wy / (16 * k), seed + 5)) ** 9;
    resist[y * N + x] = Math.min(0.92, Math.max(r1 * 0.95, r2 * 0.6));
  }
  return { resist };
}

export function tie(kind, N, opts, seed) {
  if (kind === 'spiral') return spiral(N, opts, seed);
  if (kind === 'bullseye') return bullseye(N, opts, seed);
  if (kind === 'ice') return iceScrunch(N, opts, seed);
  return crumple(N, opts, seed);
}

/** How much of section k (of n) a coord value gets: soft-edged so neighbouring colors bleed. */
export function sectionWeight(c, k, n, circular, jitter = 0) {
  const center = (k + 0.5) / n;
  if (!circular && ((k === 0 && c < center) || (k === n - 1 && c > center))) return 1;
  let d = Math.abs(c - center);
  if (circular && d > 0.5) d = 1 - d;
  const half = 0.5 / n, bleed = 0.22 / n;
  return 1 - smoothstep(half - bleed + jitter, half + bleed + jitter, d);
}

/**
 * One handful of dye powder melting on ice: speckles of concentrated powder, watery blooms with
 * crisp darker edges, crystalline feathering. comps = [{ a: [3] absorbance, w: weight }].
 * Adds into delta (Float32 3·N·N) and returns it.
 */
export function iceBloom(N, x, y, comps, s, seed, resist, delta = new Float32Array(N * N * 3)) {
  const rng = mulberry32(seed * 97 + 11);
  const k = N / 512;
  const R = N * 0.25 * (0.85 + 0.3 * rng());
  const W = Math.ceil(R * 2.6), x0 = Math.round(x - W / 2), y0 = Math.round(y - W / 2);
  const tw = comps.reduce((a, c) => a + c.w, 0);
  const fields = comps.map(() => new Float32Array(W * W));
  const specks = comps.map(() => new Float32Array(W * W));
  const parts = 55 + Math.floor(rng() * 25);
  for (let q = 0; q < parts; q++) {
    let pick = rng() * tw, ci = 0;
    while (ci < comps.length - 1 && pick > comps[ci].w) { pick -= comps[ci].w; ci++; }
    const gr = Math.sqrt(-2 * Math.log(1 - rng() * 0.999)) * R * 0.34, ga = rng() * TAU;
    const px = W / 2 + Math.cos(ga) * gr, py = W / 2 + Math.sin(ga) * gr;
    const rho = (8 + 18 * rng() ** 2) * k, amt = 0.5 + 0.8 * rng();
    const ext = Math.ceil(rho * 2.6);
    const F = fields[ci], SP = specks[ci];
    for (let yy = Math.max(0, Math.floor(py - ext)); yy < Math.min(W, Math.ceil(py + ext)); yy++) {
      for (let xx = Math.max(0, Math.floor(px - ext)); xx < Math.min(W, Math.ceil(px + ext)); xx++) {
        const d2 = ((xx - px) ** 2 + (yy - py) ** 2) / (rho * rho);
        if (d2 < 6.8) F[yy * W + xx] += amt * Math.exp(-d2);
      }
    }
    // undissolved grains: tiny dark specks scattered around
    const grains = 14 + Math.floor(rng() * 16);
    for (let g = 0; g < grains; g++) {
      const sx = Math.round(px + (rng() - 0.5) * rho * 3), sy = Math.round(py + (rng() - 0.5) * rho * 3);
      if (sx >= 0 && sy >= 0 && sx < W && sy < W) SP[sy * W + sx] += 0.6 + rng();
    }
  }
  for (let ci = 0; ci < comps.length; ci++) {
    // each color travels its own distance in the melt water: they separate at the edges
    const F = blur(fields[ci], W, W, (5 + 5 * ci) * k, false);
    const SPb = blur(specks[ci], W, W, 0.6 * k, false);
    const a = comps[ci].a;
    const cs = seed * 13 + ci * 71;
    for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) {
      const f = F[yy * W + xx], sp = SPb[yy * W + xx];
      if (f < 0.04 && sp <= 0.01) continue;
      const gx = x0 + xx, gy = y0 + yy;
      const wxp = ((gx % N) + N) % N, wyp = ((gy % N) + N) % N;
      // ragged, feathery edge: the threshold wanders with fine noise
      const n1 = fbm(gx / (9 * k), gy / (9 * k), cs, 4);
      const th = 0.08 + 0.2 * n1;
      const body = smoothstep(th, th + 0.18, f);
      const rim = g2((f - th - 0.03) / 0.05) * 0.18;
      // crystals: fern-like dark veins where the ice sat
      const crystal = 0.35 + 0.4 * fbm(gx / (3 * k), gy / (3 * k), cs + 3, 2) + 0.7 * ridge(fbm(gx / (11 * k), gy / (11 * k), cs + 5, 3)) ** 5;
      const p = wyp * N + wxp;
      const res = resist ? resist[p] : 0;
      const v = s * ((body * crystal * (0.35 + 0.65 * Math.min(1, f)) + rim * body) * (1 - res) ** 1.5 + Math.min(1.4, sp) * 0.9);
      if (v <= 0) continue;
      delta[p * 3] += v * a[0]; delta[p * 3 + 1] += v * a[1]; delta[p * 3 + 2] += v * a[2];
    }
  }
  return delta;
}

// ------------------------------------------------------------------ carved blocks & tjap
export const BLOCKS = [
  { id: 'leaf', name: 'Leaf' },
  { id: 'ginkgo', name: 'Ginkgo' },
  { id: 'rosette', name: 'Rosette' },
  { id: 'star', name: 'Star' },
  { id: 'paisley', name: 'Paisley' },
  { id: 'kawung', name: 'Kawung' },
];
export const TJAPS = [
  { id: 'kawung', name: 'Kawung' },
  { id: 'star', name: 'Ceplok star' },
  { id: 'rosette', name: 'Flower' },
  { id: 'leaf', name: 'Leaf' },
];

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Signed distance (negative = raised wood) of a motif at (x, y) in [-1, 1]². */
export function motifSDF(id, x, y) {
  if (id === 'leaf') {
    const c = Math.SQRT1_2, X = (x + y) * c, Y = (y - x) * c; // turned 45°
    const L = 0.9;
    const w = 0.4 * Math.max(0, 1 - (Y / L) ** 2) ** 0.85;
    let d = Math.max(Math.abs(X) - w, Math.abs(Y) - L);
    const stem = Math.max(Math.abs(X) - 0.035, Math.abs(Y - 0.92) - 0.1);
    d = Math.min(d, stem);
    // carved midrib and veins
    const mid = Math.abs(X) - 0.028;
    const vv = ((Y + Math.abs(X) * 0.9) * 4.5) % 1;
    const vein = Math.abs((vv + 1) % 1 - 0.5) / 4.5 - 0.022;
    const veinIn = Math.max(vein, 0.07 - Math.abs(X), Math.abs(X) - (w - 0.07), Math.abs(Y) - 0.78);
    return Math.max(d, -Math.min(Math.max(mid, Math.abs(Y) - 0.82), veinIn));
  }
  if (id === 'ginkgo') {
    const ox = 0, oy = 0.85; // fan grows up from the stem point
    y = y * 1.05 + 0.05;
    const dx = x - ox, dy = y - oy, r = Math.hypot(dx, dy);
    const a = Math.atan2(dx, -dy); // 0 = straight up
    const span = 1.0;
    const notch = Math.abs(a) < 0.06 && r > 1.2 ? 1 : 0;
    const top = 1.55 + 0.08 * Math.cos(a * 9);
    let d = Math.max(Math.abs(a) - span, 0) * r;
    d = Math.max(d, r - top, 0.32 - r);
    if (notch) d = Math.max(d, 0.02);
    const stem = Math.min(segDist(x, y, 0, 0.5, 0, 0.85), segDist(x, y, 0, 0.85, 0.1, 1.0)) - 0.04;
    d = Math.min(d, stem);
    // carved fan ribs
    const rib = Math.abs(((a / span) * 6 + 6.5) % 1 - 0.5) * r * span / 6 - 0.016;
    const ribs = Math.max(rib, 0.5 - r, r - (top - 0.1), Math.abs(a) - span + 0.06);
    return Math.max(d, -ribs);
  }
  if (id === 'rosette') {
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    const petal = 0.5 + 0.38 * Math.abs(Math.cos(a * 4)) ** 0.6;
    let d = r - petal;
    const ring = Math.abs(r - 0.27) - 0.04;
    const axis = Math.abs(Math.sin(a * 4 + Math.PI / 2)) * r - 0.022;
    const vein = Math.max(axis, 0.36 - r, r - petal + 0.12);
    d = Math.max(d, -Math.min(ring, vein));
    return Math.min(d, r - 0.14);
  }
  if (id === 'star') {
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    const t = Math.abs(((a / TAU) * 8 + 8.5) % 1 - 0.5) * 2; // 0 at points
    const star = 0.48 + 0.47 * (1 - t) ** 1.6;
    let d = r - star;
    const oct = Math.abs(r - 0.36) - 0.035;
    d = Math.max(d, -oct);
    const dot = r - 0.12;
    const ring = Math.max(d, 0.2 - r);
    return Math.min(ring, dot);
  }
  if (id === 'paisley') {
    // a teardrop: a round body and a curling tail
    let d = Math.hypot(x - 0.05, y - 0.22) - 0.55;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const px = 0.5 * (1 - t) ** 2 + 2 * t * (1 - t) * 0.55 + t * t * -0.35;
      const py = 0.2 * (1 - t) ** 2 + 2 * t * (1 - t) * -0.75 + t * t * -0.85;
      d = Math.min(d, Math.hypot(x - px, y - py) - (0.5 * (1 - t) + 0.03));
    }
    const inner = Math.abs(d + 0.13) - 0.035;
    const eye = Math.hypot(x - 0.08, y - 0.28) - 0.18;
    const eyeRing = Math.abs(Math.hypot(x - 0.08, y - 0.28) - 0.28) - 0.03;
    return Math.min(Math.max(d, -inner, -eyeRing), eye);
  }
  // kawung: four ovals around a center, the old Javanese motif
  let d = 1e9;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cx = sx * 0.47, cy = sy * 0.47;
    const c = Math.SQRT1_2, X = ((x - cx) * c + (y - cy) * c * sx * sy), Y = (-(x - cx) * c * sx * sy + (y - cy) * c);
    const e = Math.hypot(X / 0.47, Y / 0.25) - 1;
    d = Math.min(d, e * 0.25);
    const seed = Math.hypot(x - cx * 1.15, y - cy * 1.15) - 0.06;
    d = Math.max(d, -seed);
  }
  return Math.min(d, Math.hypot(x, y) - 0.08);
}

/** Raised-wood mask of a block, S×S, antialiased, in [0,1]. */
export function blockMask(id, S) {
  const m = new Float32Array(S * S);
  const aa = 2.2 / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const X = ((x + 0.5) / S) * 2 - 1, Y = ((y + 0.5) / S) * 2 - 1;
    m[y * S + x] = 1 - smoothstep(-aa, aa, motifSDF(id, X * 1.08, Y * 1.08));
  }
  return m;
}

/** A copper tjap is made of bent strips: it prints outlines of the motif, plus small dots. */
export function tjapMask(id, S) {
  const m = blockMask(id, S);
  const b = blur(m, S, S, Math.max(1, S / 70), false);
  const out = new Float32Array(S * S);
  for (let i = 0; i < m.length; i++) {
    const edge = smoothstep(0.42, 0.85, 1 - Math.abs(2 * b[i] - 1));
    out[i] = Math.max(edge, 0);
  }
  return out;
}

/** How a hand-inked block prints: uneven ink, bare specks, ink squeezed to the edges, one side
 *  pressed harder. Returns S×S amounts in [0, ~1.2]. */
export function inkImpression(mask, S, seed) {
  const rng = mulberry32(seed * 29 + 7);
  const b = blur(mask, S, S, 1.5, false);
  const tilt = rng() * TAU, tc = Math.cos(tilt), ts = Math.sin(tilt), press = 0.12 + 0.12 * rng();
  const out = new Float32Array(S * S);
  const s = seed * 3 + 1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (mask[i] <= 0.001) continue;
    const X = x / S - 0.5, Y = y / S - 0.5;
    const holes = 1 - 0.85 * smoothstep(0.64, 0.8, fbm(x / 3.2, y / 3.2, s, 3));
    const grain = 0.82 + 0.28 * fbm(x / 9, y / 9, s + 7, 2);
    const edge = Math.max(0, mask[i] - b[i]) * 0.6;
    const p = 1 + press * 2 * (X * tc + Y * ts);
    out[i] = mask[i] * holes * grain * p + edge;
  }
  return out;
}

/** Positions for a full repeat of a block of size s (0..1) on the cloth: grid or half-drop. */
export function repeatGrid(s, mode) {
  const n = Math.max(1, Math.round(1 / s));
  const step = 1 / n;
  const out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const dy = mode === 'halfdrop' && i % 2 ? step / 2 : 0;
    out.push([(i + 0.5) * step, ((j + 0.5) * step + dy) % 1]);
  }
  return out;
}
