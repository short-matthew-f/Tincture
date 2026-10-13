// dyecore.js — the Dye Studio's cloth model. PURE: no DOM, no Date.now, no Math.random.
//
// A piece of cloth is a set of per-pixel maps on an N×N grid (N = 512 for an 8 inch piece):
//   A      Float32(3N²) dye absorbance per channel. Color = REF · e^(−(paper + A)), so dyes mix
//          subtractively: an overdye only ever adds absorbance, so it can only darken.
//   wax    Float32(N²) wax on the cloth (0..1, domed: it doubles as wax height for the gloss).
//   veins  Float32(N²) cracks in the wax from crumpling; dye seeps through them.
//   bind   the current tie / binding: { resist, coord?, n?, circular? } from resist.js.
// A piece is built by replaying a list of ops, so Undo is "replay all but the last", and the same
// ops can be replayed on a different cloth. Coordinates and sizes in ops are 0..1 of the cloth.
//
// Ops: dip · wax · tjap · crackle · boil · bind · unbind · squirt · ice · marble · stamp

import { DYES, BASES, absorbOf, colorOfAbsorb, noiseField, mulberry32, rgbHex, hexRgb, lookOf, shadeCloth, REF } from '../fabric/textures.js';
import * as R from './resist.js';

const g2 = (v) => Math.exp(-v * v);
export const N_DEFAULT = 512;
export const POTS = DYES.filter((d) => d.id !== 'cream');

// How each cloth takes dye. uptake: overall strength; mottle: hand-dyed unevenness (and its
// size, cells across); wick: how far dye creeps under a resist edge (px at 512); waxEdge: how
// ragged a wax line's edge is as the hot wax wicks into the fibers.
export const BASE_DYE = {
  'quilting-cotton': { uptake: 1, mottle: 0.11, cells: 5, wick: 1.4, waxEdge: 0.6 },
  'batik-cotton': { uptake: 1.06, mottle: 0.07, cells: 6, wick: 0.8, waxEdge: 0.3 },
  linen: { uptake: 0.8, mottle: 0.3, cells: 4, wick: 2.4, waxEdge: 1.3 },
  flannel: { uptake: 0.9, mottle: 0.1, cells: 5, wick: 3, waxEdge: 1.4 },
  voile: { uptake: 0.72, mottle: 0.12, cells: 6, wick: 3.2, waxEdge: 0.9 },
  chambray: { uptake: 1, mottle: 0.1, cells: 5, wick: 1.5, waxEdge: 0.7 },
  'shot-cotton': { uptake: 1, mottle: 0.1, cells: 5, wick: 1.5, waxEdge: 0.7 },
};
export const dyeOf = (id) => DYES.find((d) => d.id === id) || DYES[0];
export const dyeAbsorb = (id) => absorbOf(dyeOf(id).hex);

// ------------------------------------------------------------------ subtractive color
/** Mix dyes the way overdyeing does: absorbances add. layers = [{ hex, s }]. */
export function mixSubtractive(layers, paper = '#FCFAF6') {
  const a = absorbOf(paper);
  for (const l of layers) { const d = absorbOf(l.hex); for (let k = 0; k < 3; k++) a[k] += d[k] * (l.s ?? 1); }
  return rgbHex(colorOfAbsorb(a));
}
/** Freshly lifted from an indigo or woad vat the cloth is yellow-green; air turns it blue. */
export const OXIDIZING = new Set(['indigo', 'woad']);
export const VAT_GREEN = '#8FA04A';

// ------------------------------------------------------------------ hue helpers (ice dye splits)
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
/** On ice, a dye powder separates into the colors it is blended from. */
export function iceComponents(hex) {
  const [h, s, l] = rgbHsl(hexRgb(hex));
  if (s < 0.22) {
    // dark neutrals break into teal, plum and rust
    return [['#2F6F78', 1], ['#6B3168', 1], ['#8A4A24', 0.7]].map(([c, w]) => ({ hex: c, w }));
  }
  const sat = Math.min(1, s * 1.3 + 0.08);
  return [
    { hex: rgbHex(hslRgb([(h + 0.92) % 1, sat, Math.min(0.62, l * 1.05)])), w: 0.8 },
    { hex: rgbHex(hslRgb([h, sat, l])), w: 1.1 },
    { hex: rgbHex(hslRgb([(h + 0.09) % 1, sat, Math.min(0.65, l * 1.12)])), w: 0.7 },
  ];
}

// ------------------------------------------------------------------ the piece
export function createPiece(base = 'quilting-cotton', seed = 1, N = N_DEFAULT) {
  return {
    N, base, seed,
    A: new Float32Array(N * N * 3), wax: new Float32Array(N * N), veins: new Float32Array(N * N),
    bind: null, bindKind: null, bundleA: [0, 0, 0], sectionA: null, sprinkles: [],
    usage: [], // [{ id, amt }] in order of first use
    meta: { crackle: false, shibori: null, tie: null, block: null, waxed: false },
    _uptake: null,
  };
}

function uptakeField(piece) {
  if (!piece._uptake) {
    const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
    const n = noiseField(piece.N, bd.cells, piece.seed * 3 + 1, 4, 0.55);
    for (let i = 0; i < n.length; i++) n[i] = 1 + bd.mottle * 2 * (n[i] - 0.5);
    piece._uptake = n;
  }
  return piece._uptake;
}

function note(piece, id, amt) {
  if (id === 'cream' || !(amt > 0)) return;
  const u = piece.usage.find((x) => x.id === id);
  if (u) u.amt += amt; else piece.usage.push({ id, amt });
}

/** Where dye can't reach right now (0..1 per pixel): wax (minus cracks) and any binding. */
export function resistMap(piece) {
  const { N, wax, veins } = piece;
  const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
  const out = new Float32Array(N * N);
  let any = false;
  for (let p = 0; p < N * N; p++) {
    const w = wax[p];
    if (w > 0.02) {
      any = true;
      let r = R.smoothstep(0.08, 0.4, w) * 0.985;
      if (veins[p] > 0) r *= 1 - 0.95 * veins[p] * R.smoothstep(0.15, 0.4, w);
      out[p] = r;
    }
  }
  let res = any ? R.blur(out, N, N, Math.max(0.35, bd.wick * 0.3)) : out;
  if (piece.bind) {
    const b = piece.bind.resist;
    if (!any) return b;
    res = Float32Array.from(res);
    for (let p = 0; p < N * N; p++) res[p] = Math.max(res[p], b[p]);
  }
  return res;
}

// ---- dip (solid, ombré, any immersion): returns the per-pixel strength map
export function dipAmount(piece, op) {
  const { N } = piece;
  const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
  const up = uptakeField(piece);
  const res = resistMap(piece);
  const depth = op.depth ?? 1;
  const k = N / 512;
  const mott = op.mottle > 0 ? noiseField(N, 3, op.seed * 7 + 5, 4, 0.6) : null;
  const crinkle = op.mottle > 0.4 ? noiseField(N, 9, op.seed * 7 + 9, 2) : null;
  const out = new Float32Array(N * N);
  const yw = N * (1 - depth); // waterline
  const wz = (10 + 9 * bd.wick) * k; // capillary wicking above the line
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const p = y * N + x;
      let sub = 1;
      if (depth < 1) {
        const edge = yw - wz * (0.55 + 0.9 * R.fbm(x / (22 * k), op.seed, op.seed + 3, 3));
        if (y < edge) sub = 0;
        else if (y < yw) { const t = (y - edge) / (yw - edge); sub = t * t * (3 - 2 * t) * 0.85 + 0.25 * g2(((y - edge) / (2.5 * k))); }
        if (op.lift && y >= yw) sub *= 0.22 + 0.78 * Math.pow((y - yw) / Math.max(1, N - yw), 0.85);
        else if (op.lift) sub *= 0.22;
      }
      if (sub <= 0) continue;
      let m = up[p];
      if (mott) {
        let v = 1 + op.mottle * 0.9 * (mott[p] - 0.5) * 2;
        if (crinkle) v -= op.mottle * 0.18 * Math.max(0, 1 - Math.abs(2 * crinkle[p] - 1) * 6);
        m *= Math.max(0.2, v);
      }
      out[p] = op.s * bd.uptake * m * sub * (1 - res[p]);
    }
  }
  return out;
}

export function addAmount(piece, amount, absorb) {
  const { A } = piece;
  let sum = 0;
  for (let p = 0; p < amount.length; p++) {
    const v = amount[p];
    if (!v) continue;
    A[p * 3] += v * absorb[0]; A[p * 3 + 1] += v * absorb[1]; A[p * 3 + 2] += v * absorb[2];
    sum += v;
  }
  return sum / amount.length;
}
function addDelta(piece, delta) { const { A } = piece; for (let i = 0; i < A.length; i++) A[i] += delta[i]; }

// ---- wax
/** Lay a tjanting line (or a brush stroke) of hot wax along pts (flat [x, y, ...], 0..1). */
export function waxStroke(piece, pts, r, seed = 1, tool = 'tjanting', from = 0) {
  const { N, wax } = piece;
  const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
  const rr = r * N;
  const k = N / 512;
  const n = pts.length / 2;
  if (!n) return [0, 0, 0, 0];
  const brush = tool === 'brush';
  let bx0 = N, by0 = N, bx1 = 0, by1 = 0;
  let dist = 0;
  const dab = (cx, cy, rad) => {
    const ext = rad + 2 + bd.waxEdge * 2;
    const xa = Math.floor(cx - ext), xb = Math.ceil(cx + ext), ya = Math.floor(cy - ext), yb = Math.ceil(cy + ext);
    bx0 = Math.min(bx0, xa); by0 = Math.min(by0, ya); bx1 = Math.max(bx1, xb); by1 = Math.max(by1, yb);
    for (let y = ya; y <= yb; y++) {
      if (y < 0 || y >= N) continue;
      for (let x = xa; x <= xb; x++) {
        if (x < 0 || x >= N) continue;
        let d = Math.hypot(x - cx, y - cy);
        // hot wax wicks into the fibers: a slightly ragged edge (more on linen and flannel)
        d += bd.waxEdge * 1.6 * (R.nz(x / 1.7, y / 1.7, seed + 77) - 0.5) * k;
        if (brush) d += rad * 0.35 * (R.nz(x / (2.2 * k), y / (9 * k), seed + 5) - 0.5);
        if (d > rad + 0.8) continue;
        const cov = R.clamp01(rad + 0.8 - d);
        const dome = Math.sqrt(Math.max(0, 1 - (d / (rad + 0.8)) ** 2));
        const v = cov * (0.5 + 0.5 * dome);
        const p = y * N + x;
        if (v > wax[p]) wax[p] = v;
      }
    }
  };
  // touching down leaves a little drop
  if (!brush && from === 0) dab(pts[0] * N, pts[1] * N, rr * 1.35);
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2] * N, ay = pts[i * 2 + 1] * N;
    if (i === 0) { if (from === 0) dab(ax, ay, rr); continue; }
    const px = pts[i * 2 - 2] * N, py = pts[i * 2 - 1] * N;
    const seg = Math.hypot(ax - px, ay - py);
    // a slow hand lets more wax flow: thicker where points are close together
    const slow = 1 + 0.35 * Math.exp(-seg / (3 * k));
    const steps = Math.max(1, Math.ceil(seg / Math.max(0.5, rr * 0.3)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      dist += seg / steps;
      if (i < from) continue;
      const wob = 1 + (brush ? 0.18 : 0.14) * (R.nz(dist / (7 * k), 0.5, seed + 3) - 0.5) * 2;
      dab(px + (ax - px) * t, py + (ay - py) * t, rr * wob * slow);
    }
  }
  piece.meta.waxed = true;
  return [Math.max(0, bx0), Math.max(0, by0), Math.min(N, bx1 + 1), Math.min(N, by1 + 1)];
}

function placeMask(N, mask, S, cx, cy, rot, fn) {
  const x0 = Math.round(cx - S / 2), y0 = Math.round(cy - S / 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let sx = x, sy = y;
    if (rot === 1) { sx = y; sy = S - 1 - x; } else if (rot === 2) { sx = S - 1 - x; sy = S - 1 - y; } else if (rot === 3) { sx = S - 1 - y; sy = x; }
    const v = mask[sy * S + sx];
    if (v <= 0.002) continue;
    const gx = (((x0 + x) % N) + N) % N, gy = (((y0 + y) % N) + N) % N;
    fn(gy * N + gx, v);
  }
}

const MASKS = new Map();
function cachedMask(kind, id, S) {
  const key = `${kind}|${id}|${S}`;
  let m = MASKS.get(key);
  if (!m) { m = kind === 'tjap' ? R.tjapMask(id, S) : R.blockMask(id, S); MASKS.set(key, m); }
  return m;
}

// ------------------------------------------------------------------ ops
/**
 * applyOp(piece, op) mutates the piece. Returns what changed, for the UI to animate:
 *   { amount, absorb } for a one-dye op, { delta } for a many-color op, { rect } for wax.
 */
export function applyOp(piece, op) {
  const { N } = piece;
  switch (op.t) {
    case 'dip': {
      const amount = dipAmount(piece, op);
      const absorb = dyeAbsorb(op.dye);
      note(piece, op.dye, addAmount(piece, amount, absorb));
      if (piece.bind) for (let k = 0; k < 3; k++) piece.bundleA[k] += absorb[k] * op.s * (BASE_DYE[piece.base]?.uptake ?? 1);
      return { amount, absorb };
    }
    case 'wax': return { rect: waxStroke(piece, op.pts, op.r, op.seed, op.tool, op.from || 0) };
    case 'tjap': {
      const S = Math.max(8, Math.round(op.size * N));
      const mask = cachedMask('tjap', op.block, S);
      const s = op.seed * 5 + 3;
      placeMask(N, mask, S, op.x * N, op.y * N, op.rot || 0, (p, v) => {
        const x = p % N, y = (p / N) | 0;
        const skip = R.smoothstep(0.12, 0.28, R.nz(x / 6, y / 6, s));
        const w = v * (0.55 + 0.45 * skip);
        if (w > piece.wax[p]) piece.wax[p] = w;
      });
      piece.meta.waxed = true;
      return { rect: [0, 0, N, N] };
    }
    case 'crackle': {
      const v = R.crackle(N, op.seed);
      for (let p = 0; p < N * N; p++) if (v[p] > piece.veins[p] && piece.wax[p] > 0.1) piece.veins[p] = v[p];
      piece.meta.crackle = true;
      return { rect: [0, 0, N, N] };
    }
    case 'boil': piece.wax.fill(0); piece.veins.fill(0); return { rect: [0, 0, N, N] };
    case 'bind': {
      const isTie = op.kind.startsWith('tie-') || op.kind === 'ice';
      const g = isTie ? R.tie(op.kind.replace('tie-', ''), N, op.opts || {}, op.seed) : R.shibori(op.kind, N, op.opts || {}, op.seed);
      const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
      g.resist = R.blur(g.resist, N, N, bd.wick * 0.6);
      piece.bind = g; piece.bindKind = op.kind; piece.bundleA = [0, 0, 0];
      piece.sectionA = g.n ? Array.from({ length: g.n }, () => [0, 0, 0]) : null;
      piece.sprinkles = [];
      if (op.kind === 'ice') piece.meta.ice = true;
      else if (isTie) piece.meta.tie = op.kind.slice(4);
      else piece.meta.shibori = op.kind;
      return {};
    }
    case 'unbind': piece.bind = null; piece.bindKind = null; piece.sectionA = null; piece.sprinkles = []; return {};
    case 'squirt': {
      const g = piece.bind;
      if (!g || !g.coord) return {};
      const up = uptakeField(piece);
      const amount = new Float32Array(N * N);
      const bd = BASE_DYE[piece.base] || BASE_DYE['quilting-cotton'];
      for (let p = 0; p < N * N; p++) {
        const x = p % N, y = (p / N) | 0;
        const j = 0.25 / g.n * (R.nz(x / 18, y / 18, op.seed) - 0.5);
        const w = R.sectionWeight(g.coord[p], op.k, g.n, g.circular, j);
        if (w <= 0) continue;
        amount[p] = op.s * bd.uptake * up[p] * w * (1 - g.resist[p]) * (0.85 + 0.3 * R.nz(x / 40, y / 40, op.seed + 1));
      }
      const absorb = dyeAbsorb(op.dye);
      note(piece, op.dye, addAmount(piece, amount, absorb));
      if (piece.sectionA) for (let k = 0; k < 3; k++) piece.sectionA[op.k][k] += absorb[k] * op.s;
      return { amount, absorb };
    }
    case 'ice': {
      const comps = iceComponents(dyeOf(op.dye).hex).map((c) => ({ a: absorbOf(c.hex), w: c.w }));
      const delta = R.iceBloom(N, op.x * N, op.y * N, comps, op.s ?? 1.1, op.seed, piece.bind ? piece.bind.resist : null);
      addDelta(piece, delta);
      note(piece, op.dye, 0.1);
      piece.sprinkles.push({ x: op.x, y: op.y, dye: op.dye, seed: op.seed });
      return { delta };
    }
    case 'marble': {
      if (op.delta && op.delta.length === N * N * 3) addDelta(piece, op.delta);
      for (const id of op.dyes || []) note(piece, id, 0.1);
      return { delta: op.delta };
    }
    case 'stamp': {
      const S = Math.max(8, Math.round(op.size * N));
      const ink = R.inkImpression(cachedMask('block', op.block, S), S, op.seed);
      const amount = new Float32Array(N * N);
      const res = piece.meta.waxed ? resistMap(piece) : null;
      const s = op.s ?? 1.15;
      placeMask(N, ink, S, op.x * N, op.y * N, op.rot || 0, (p, v) => { amount[p] = Math.max(amount[p], v * s * (res ? 1 - res[p] : 1)); });
      const absorb = dyeAbsorb(op.dye);
      note(piece, op.dye, addAmount(piece, amount, absorb));
      piece.meta.block = op.block;
      return { amount, absorb };
    }
    default: return {};
  }
}

export function replay(base, seed, ops, N = N_DEFAULT) {
  const piece = createPiece(base, seed, N);
  for (const op of ops) applyOp(piece, op);
  return piece;
}

// ------------------------------------------------------------------ compositing
/**
 * Render the piece into RGBA (out, N×N×4): the cloth with its dye, and any wax as a glossy
 * amber layer with highlights from the wax's own relief. opts.A overrides the absorbance (for
 * animating a dip); opts.rect limits the update.
 */
export function composite(out, piece, wf, opts = {}) {
  const { N, wax, veins } = piece;
  const rect = opts.rect || [0, 0, N, N];
  shadeCloth(out, N, wf, { A: opts.A || piece.A, rect });
  if (!piece.meta.waxed || opts.noWax) return out;
  const [x0, y0, x1, y1] = rect;
  for (let y = y0; y < y1; y++) {
    const yu = ((y + N - 1) % N) * N, yd = ((y + 1) % N) * N, yr = y * N;
    for (let x = x0; x < x1; x++) {
      const p = yr + x;
      const w = wax[p];
      if (w <= 0.02) continue;
      const xl = (x + N - 1) % N, xr = (x + 1) % N;
      const gx = wax[yr + xr] - wax[yr + xl], gy = wax[yd + x] - wax[yu + x];
      const face = (gx + gy) * 0.5; // >0 faces the light (top left)
      const cov = R.smoothstep(0.05, 0.35, w);
      const spec = Math.max(0, face) ** 1.3 * 1.5 + 0.05 * Math.max(0, w - 0.6);
      const shade = Math.max(0, -face) * 0.35;
      const o = p * 4;
      let r = out[o], g = out[o + 1], b = out[o + 2];
      // wax soaks the cloth darker and a touch amber, like wet beeswax
      const dk = 1 - 0.34 * cov - shade * cov;
      r = r * dk + 232 * 0.26 * cov; g = g * dk + 188 * 0.26 * cov; b = b * dk + 84 * 0.26 * cov;
      const v = veins[p];
      if (v > 0) { const c = v * cov * 70; r += c; g += c; b += c * 0.9; }
      const s = spec * 255 * 0.7 * cov;
      out[o] = r + s; out[o + 1] = g + s; out[o + 2] = b + s * 0.92;
    }
  }
  return out;
}

/** The color of the outside of a bundle (what you see while it is bound). */
export function bundleColor(piece, extraA = [0, 0, 0]) {
  const paper = absorbOf(lookOf(piece.base).paper);
  return rgbHex(colorOfAbsorb([0, 1, 2].map((k) => paper[k] + piece.bundleA[k] + extraA[k])));
}
export function sectionColor(piece, k) {
  const paper = absorbOf(lookOf(piece.base).paper);
  const a = piece.sectionA ? piece.sectionA[k] : [0, 0, 0];
  return rgbHex(colorOfAbsorb([0, 1, 2].map((c) => paper[c] + a[c] * 0.8)));
}

// ------------------------------------------------------------------ results
/** The most common color of an RGBA image (4-bit buckets), as hex. */
export function dominantColor(rgba, stride = 4) {
  const cnt = new Uint32Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
  for (let i = 0; i < rgba.length; i += 4 * stride) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  // smooth: count each bucket with its neighbours so a mottled color still wins
  let best = -1, bk = 0;
  for (let k = 0; k < 4096; k++) {
    if (!cnt[k]) continue;
    const r = k >> 8, g = (k >> 4) & 15, b = k & 15;
    let c = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const R2 = r + dr, G2 = g + dg, B2 = b + db;
      if (R2 < 0 || G2 < 0 || B2 < 0 || R2 > 15 || G2 > 15 || B2 > 15) continue;
      c += cnt[(R2 << 8) | (G2 << 4) | B2];
    }
    if (c > best) { best = c; bk = k; }
  }
  return rgbHex([sr[bk] / cnt[bk], sg[bk] / cnt[bk], sb[bk] / cnt[bk]]);
}

/** The dyes of a piece, most-used first, at most `max`. Returns ids, in the order first used. */
export function mainDyes(piece, max = 3) {
  const top = [...piece.usage].sort((a, b) => b.amt - a.amt).slice(0, max).map((u) => u.id);
  return piece.usage.map((u) => u.id).filter((id) => top.includes(id));
}

const BASE_NOUN = {
  'quilting-cotton': 'cotton', 'batik-cotton': 'cotton', linen: 'linen', flannel: 'flannel',
  voile: 'voile', chambray: 'chambray', 'shot-cotton': 'shot cotton',
};
const SHIBORI_NAME = { itajime: 'itajime', arashi: 'arashi', kumo: 'kumo', mokume: 'mokume' };

export function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * A name a dyer would give it: "Indigo kumo shibori", "Madder and walnut batik".
 * info = { kind, base, dyes: [ids], shibori?, tie?, block?, crackle? }; existing = names in the stash.
 */
export function makeName(info, existing = []) {
  const ds = (info.dyes || []).filter((d) => d !== 'cream').map((id) => dyeOf(id).name.toLowerCase());
  let lead = listNames(ds);
  const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const noun = BASE_NOUN[info.base] || 'cotton';
  const onCloth = noun === 'cotton' ? '' : ` ${noun}`;
  let name;
  switch (info.kind) {
    case 'solid': name = ds.length ? (noun === 'cotton' ? `${lead} hand-dye` : `${lead} ${noun}`) : `Undyed ${noun}`; break;
    case 'ombre': name = `${lead || 'Undyed'} ombré${onCloth}`; break;
    case 'batik': name = `${lead || 'Undyed'} ${info.crackle ? 'crackle ' : ''}batik`; break;
    case 'shibori': name = `${lead || 'Undyed'} ${SHIBORI_NAME[info.shibori] || ''} shibori`.replace(/\s+/g, ' '); break;
    case 'tiedye': name = `${lead || 'Undyed'} ${info.tie || 'spiral'} tie-dye`; break;
    case 'ice': name = `${lead || 'Undyed'} ice dye${onCloth}`; break;
    case 'marbled': name = `${lead || 'Marbled'} marbled ${noun}`; break;
    case 'block': name = `${lead || 'Ink'} ${low((R.BLOCKS.find((b) => b.id === info.block) || { name: 'block' }).name)} block print`; break;
    default: name = `${lead || 'Hand-dyed'}${onCloth}`;
  }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  if (!existing.includes(name)) return name;
  for (let i = 2; i < 1000; i++) { const n = `${name} no. ${i}`; if (!existing.includes(n)) return n; }
  return name;
}

/** Which techniques make a seamless tile, and how many inches the tile spans. */
export function tileInfo(kind) {
  if (kind === 'solid' || kind === 'block') return { repeat: true, inches: 8 };
  return { repeat: false, inches: 8 };
}

export { BASES, DYES, R };
