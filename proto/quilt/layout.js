// layout.js — quilt settings, sizes and fabric resolution (pure).
//
// All measurements are finished inches. Coordinates: origin at the top-left
// of the finished quilt (outer edge of the last border), y down.

import { ROLES, blockPatches, transformPoint, libraryBlock, cloneBlock } from './blocks.js';

export const BLOCK_SIZES = [6, 8, 9, 10, 12, 14, 16];
export const SASH_WIDTHS = [0, 1, 1.5, 2, 2.5, 3];
export const BORDER_WIDTHS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
export const SQRT2 = Math.SQRT2;

export function defaultDesign() {
  return {
    v: 1,
    name: 'Ohio Star throw',
    palette: { L: 'starter-0', M: 'starter-11', D: 'starter-1', A: 'starter-2', B: 'starter-7' },
    blocks: [libraryBlock('ohio-star'), libraryBlock('snowball')],
    size: 12,
    rows: 4,
    cols: 3,
    setting: 'straight', // 'straight' | 'onpoint'
    alt: 'none', // 'none' | 'plain' | 'block2'
    altFill: 'L', // plain alternate blocks
    settingFill: 'L', // on-point setting and corner triangles
    sash: { w: 2, fill: 'starter-4', stone: 'A', outer: true },
    borders: [{ w: 5, fill: 'starter-8' }],
    binding: 'A',
    rotate: 'none', // 'none' | 'alt' | 'quad'
    mirror: 'none', // 'none' | 'cols' | 'rows' | 'both'
    scrappy: { on: false, seed: 1 },
    quilting: { pattern: 'meander', spacing: 1.5, thread: '#EFE6D2' },
  };
}

/** Fills in anything missing from an older or partial design. */
export function normalizeDesign(d) {
  const base = defaultDesign();
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...d };
  out.palette = { ...base.palette, ...(d.palette || {}) };
  out.blocks = Array.isArray(d.blocks) && d.blocks.length ? d.blocks.map(cloneBlock) : base.blocks;
  if (out.blocks.length < 2) out.blocks.push(base.blocks[1]);
  out.sash = { ...base.sash, ...(d.sash || {}) };
  out.borders = Array.isArray(d.borders) ? d.borders.map((b) => ({ w: Number(b.w) || 2, fill: b.fill || 'D' })) : base.borders;
  out.scrappy = { ...base.scrappy, ...(d.scrappy || {}) };
  out.quilting = { ...base.quilting, ...(d.quilting || {}) };
  out.rows = clampInt(out.rows, 1, 16);
  out.cols = clampInt(out.cols, 1, 16);
  if (!(Number(out.size) > 0 && Number(out.size) <= 30)) out.size = 12;
  return out;
}

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || lo))); }

export function bordersTotal(design) { return design.borders.reduce((s, b) => s + b.w, 0); }

/** Finished size of the center (inside the borders). */
export function centerSize(design) {
  const B = design.size;
  if (design.setting === 'onpoint') {
    const d = B * SQRT2;
    return { w: design.cols * d, h: design.rows * d };
  }
  const s = design.sash.w || 0;
  const outer = s > 0 && design.sash.outer !== false;
  return {
    w: design.cols * B + (design.cols - 1) * s + (outer ? 2 * s : 0),
    h: design.rows * B + (design.rows - 1) * s + (outer ? 2 * s : 0),
  };
}

export function quiltSize(design) {
  const c = centerSize(design);
  const t = bordersTotal(design);
  return { w: c.w + 2 * t, h: c.h + 2 * t };
}

export function sizeName(w, h) {
  const s = Math.min(w, h);
  const l = Math.max(w, h);
  if (l <= 30) return 'Wall hanging';
  if (s <= 45) return 'Baby quilt';
  if (s <= 62) return 'Lap quilt';
  if (s <= 76) return 'Twin';
  if (s <= 88) return 'Full';
  if (s <= 98) return 'Queen';
  return 'King';
}

const odd = (v) => ((v % 2) + 2) % 2;
function rotFor(design, r, c) {
  if (design.rotate === 'alt') return odd(r + c) ? 1 : 0;
  if (design.rotate === 'quad') return [[0, 1], [3, 2]][odd(r)][odd(c)];
  return 0;
}
function mirrorFor(design, r, c) {
  const m = design.mirror;
  return { mirrorX: (m === 'cols' || m === 'both') && odd(c) === 1, mirrorY: (m === 'rows' || m === 'both') && odd(r) === 1 };
}
/** On point, neighbors share a side along the diagonals: use the block's own grid. */
function diagRC(row, col) { return [(row + col) / 2, (col - row) / 2]; }

/**
 * Lays out the quilt. Returns
 *   { w, h, center: {x, y, w, h}, blocks: [Inst], pieces: [Piece], borders: [Border] }
 *   Inst  = { i, row, col, cx, cy, size, angle, rot, mirrorX, mirrorY, kind: 'block'|'plain', which }
 *   Piece = { kind: 'sash'|'stone'|'setting'|'corner'|'border'|'plain', fill, pts }
 */
export function layoutQuilt(design) {
  const B = design.size;
  const T = bordersTotal(design);
  const cs = centerSize(design);
  const { w, h } = { w: cs.w + 2 * T, h: cs.h + 2 * T };
  const blocks = [];
  const pieces = [];
  const altOn = design.alt === 'plain' || design.alt === 'block2';
  const push = (inst) => blocks.push({ i: blocks.length, ...inst });

  if (design.setting === 'onpoint') {
    const d = B * SQRT2;
    const r = design.rows;
    const c = design.cols;
    for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) {
      const [a, b] = diagRC(j * 2, i * 2);
      push({ row: j * 2, col: i * 2, cx: T + (i + 0.5) * d, cy: T + (j + 0.5) * d, size: B, angle: 45,
        rot: rotFor(design, a, b), ...mirrorFor(design, a, b), kind: 'block', which: 0 });
    }
    for (let j = 0; j < r - 1; j++) for (let i = 0; i < c - 1; i++) {
      const plain = design.alt === 'plain';
      const [a, b] = diagRC(j * 2 + 1, i * 2 + 1);
      push({ row: j * 2 + 1, col: i * 2 + 1, cx: T + (i + 1) * d, cy: T + (j + 1) * d, size: B, angle: 45,
        rot: rotFor(design, a, b), ...mirrorFor(design, a, b), kind: plain ? 'plain' : 'block', which: altOn && !plain ? 1 : 0 });
    }
    const sf = design.settingFill;
    const h2 = d / 2;
    for (let i = 0; i < c - 1; i++) {
      const x = T + (i + 0.5) * d;
      pieces.push({ kind: 'setting', fill: sf, pts: [[x, T], [x + d, T], [x + h2, T + h2]] });
      pieces.push({ kind: 'setting', fill: sf, pts: [[x + d, T + cs.h], [x, T + cs.h], [x + h2, T + cs.h - h2]] });
    }
    for (let j = 0; j < r - 1; j++) {
      const y = T + (j + 0.5) * d;
      pieces.push({ kind: 'setting', fill: sf, pts: [[T, y + d], [T, y], [T + h2, y + h2]] });
      pieces.push({ kind: 'setting', fill: sf, pts: [[T + cs.w, y], [T + cs.w, y + d], [T + cs.w - h2, y + h2]] });
    }
    const x0 = T, y0 = T, x1 = T + cs.w, y1 = T + cs.h;
    pieces.push({ kind: 'corner', fill: sf, pts: [[x0, y0], [x0 + h2, y0], [x0, y0 + h2]] });
    pieces.push({ kind: 'corner', fill: sf, pts: [[x1 - h2, y0], [x1, y0], [x1, y0 + h2]] });
    pieces.push({ kind: 'corner', fill: sf, pts: [[x1, y1 - h2], [x1, y1], [x1 - h2, y1]] });
    pieces.push({ kind: 'corner', fill: sf, pts: [[x0, y1 - h2], [x0 + h2, y1], [x0, y1]] });
  } else {
    const s = design.sash.w || 0;
    const outer = s > 0 && design.sash.outer !== false;
    const off = outer ? s : 0;
    const R = design.rows;
    const C = design.cols;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const x = T + off + c * (B + s);
      const y = T + off + r * (B + s);
      const odd = (r + c) % 2 === 1;
      const kind = odd && design.alt === 'plain' ? 'plain' : 'block';
      push({ row: r, col: c, cx: x + B / 2, cy: y + B / 2, size: B, angle: 0, rot: rotFor(design, r, c), ...mirrorFor(design, r, c),
        kind, which: odd && design.alt === 'block2' ? 1 : 0 });
    }
    if (s > 0) {
      const rect = (x, y, ww, hh) => [[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]];
      const c0 = outer ? 0 : 1;
      const c1 = outer ? C : C - 1;
      const r0 = outer ? 0 : 1;
      const r1 = outer ? R : R - 1;
      for (let r = 0; r < R; r++) for (let c = c0; c <= c1; c++) {
        pieces.push({ kind: 'sash', fill: design.sash.fill, pts: rect(T + off + c * (B + s) - s, T + off + r * (B + s), s, B) });
      }
      for (let r = r0; r <= r1; r++) for (let c = 0; c < C; c++) {
        pieces.push({ kind: 'sash', fill: design.sash.fill, pts: rect(T + off + c * (B + s), T + off + r * (B + s) - s, B, s) });
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        pieces.push({ kind: 'stone', fill: design.sash.stone, pts: rect(T + off + c * (B + s) - s, T + off + r * (B + s) - s, s, s) });
      }
    }
  }

  // Borders: sides first (the current height), then top and bottom (the new width).
  const borders = [];
  let x0 = T, y0 = T, x1 = T + cs.w, y1 = T + cs.h;
  design.borders.forEach((b, i) => {
    const bw = b.w;
    const side = y1 - y0;
    const L = [[x0 - bw, y0], [x0, y0], [x0, y1], [x0 - bw, y1]];
    const Rr = [[x1, y0], [x1 + bw, y0], [x1 + bw, y1], [x1, y1]];
    x0 -= bw; x1 += bw;
    const top = [[x0, y0 - bw], [x1, y0 - bw], [x1, y0], [x0, y0]];
    const bot = [[x0, y1], [x1, y1], [x1, y1 + bw], [x0, y1 + bw]];
    const across = x1 - x0;
    y0 -= bw; y1 += bw;
    borders.push({ i, w: bw, fill: b.fill, sideLength: side, topLength: across });
    for (const pts of [L, Rr, top, bot]) pieces.push({ kind: 'border', fill: b.fill, border: i, pts });
  });

  for (const inst of blocks) {
    if (inst.kind === 'plain') pieces.push({ kind: 'plain', fill: design.altFill, pts: instCorners(inst) });
  }

  return { w, h, center: { x: T, y: T, w: cs.w, h: cs.h }, blocks, pieces, borders };
}

/** Maps a point in a block (0..size inches) to quilt coordinates for an instance. */
export function instPoint(inst, [x, y]) {
  const B = inst.size;
  const [tx, ty] = transformPoint([x, y], B, inst);
  const dx = tx - B / 2;
  const dy = ty - B / 2;
  const a = (inst.angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return [inst.cx + dx * ca - dy * sa, inst.cy + dx * sa + dy * ca];
}

export function instCorners(inst) {
  const B = inst.size;
  return [[0, 0], [B, 0], [B, B], [0, B]].map((p) => instPoint(inst, p));
}

/** Every pieced patch in the quilt, in quilt coordinates: [{ inst, unit, patch, fill, pts }]. */
export function quiltPatches(design, layout = layoutQuilt(design)) {
  const out = [];
  for (const inst of layout.blocks) {
    if (inst.kind !== 'block') continue;
    const block = design.blocks[inst.which] || design.blocks[0];
    const k = inst.size / block.n;
    for (const p of blockPatches(block)) {
      out.push({ inst: inst.i, unit: p.unit, patch: p.patch, fill: p.fill, pts: p.pts.map(([x, y]) => instPoint(inst, [x * k, y * k])) });
    }
  }
  return out;
}

/** Counts used by the cutting list and the summary. */
export function blockCounts(layout) {
  const pieced = [0, 0];
  let plain = 0;
  for (const b of layout.blocks) {
    if (b.kind === 'plain') plain++; else pieced[b.which]++;
  }
  return { pieced, plain, total: layout.blocks.length };
}

/* --------------------------------------------------------------- fabric */

export function isRole(f) { return ROLES.includes(f); }

/** A fill (role or fabric id) to a fabric id via the palette. */
export function resolveRole(design, fill) {
  return isRole(fill) ? design.palette[fill] : fill;
}

function hexRgb(hex) {
  const n = parseInt(String(hex || '#888888').replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CIE L* (0..100) of a hex color: how light it reads, the quilter's "value". */
export function valueOf(hex) {
  const lin = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

export function valueBand(hex) {
  const v = valueOf(hex);
  return v >= 68 ? 'light' : v >= 42 ? 'medium' : 'dark';
}

/** Color family: hue in eight 45° slices (or neutral) plus light/dark. */
export function familyOf(hex) {
  const [r, g, b] = hexRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = valueOf(hex) >= 60 ? 'light' : 'dark';
  if (max - min < 40) return `neutral-${light}`;
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  hue = (hue + 360) % 360;
  return `${Math.floor(((hue + 22.5) % 360) / 45)}-${light}`;
}

export function hash3(a, b, c) {
  let h = 2166136261 >>> 0;
  const s = `${a}|${b}|${c}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Builds a resolver for the quilt: (fill, instIndex) -> fabric id. With scrappy
 * on, each block draws its own fabric from the same color family for every
 * fabric it uses (controlled scrappy: one star point fabric per block).
 * stash: [{ id, color }].
 */
export function makeResolver(design, stash = []) {
  const byId = new Map(stash.map((f) => [f.id, f]));
  const fam = new Map();
  for (const f of stash) {
    const k = familyOf(f.color);
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(f.id);
  }
  return (fill, inst = -1) => {
    const id = resolveRole(design, fill);
    if (!design.scrappy?.on || inst < 0) return id;
    const f = byId.get(id);
    if (!f) return id;
    const group = fam.get(familyOf(f.color)) || [id];
    if (group.length < 2) return id;
    return group[Math.floor(hash3(design.scrappy.seed, inst, id) * group.length)];
  };
}

/** Swaps two fabrics (ids or roles) everywhere in a design. Returns a new design. */
export function swapFabrics(design, a, b) {
  if (a === b) return design;
  const d = JSON.parse(JSON.stringify(design));
  // Swap palette entries that point at the fabrics, and any direct uses.
  const ida = resolveRole(design, a);
  const idb = resolveRole(design, b);
  const swId = (f) => (f === ida ? idb : f === idb ? ida : f);
  for (const r of ROLES) d.palette[r] = swId(design.palette[r]);
  const fix = (f) => (isRole(f) ? f : swId(f));
  for (const bl of d.blocks) for (const u of bl.units) u.f = u.f.map(fix);
  d.altFill = fix(d.altFill);
  d.settingFill = fix(d.settingFill);
  d.sash.fill = fix(d.sash.fill);
  d.sash.stone = fix(d.sash.stone);
  d.binding = fix(d.binding);
  for (const bo of d.borders) bo.fill = fix(bo.fill);
  return d;
}

/** Every fill used in a design (roles and ids), for the fabric list. */
export function usedFills(design, layout = layoutQuilt(design)) {
  const s = new Set();
  const which = new Set(layout.blocks.filter((b) => b.kind === 'block').map((b) => b.which));
  for (const w of which) for (const u of design.blocks[w].units) u.f.forEach((f) => s.add(f));
  for (const p of layout.pieces) s.add(p.fill);
  s.add(design.binding);
  return [...s];
}
