// cutting.js — rotary cutting list and yardage (pure).
//
// Every cut size includes the standard ¼" seam allowance on each side.
// Methods (the usual rotary-cutting shortcuts):
//   square / rectangle            finished + ½"
//   half-square triangles (HST)   2-at-a-time: one square of each fabric at finished + ⅞",
//                                 sewn ¼" either side of the diagonal, makes 2 HSTs
//   quarter-square triangles      squares at finished + 1¼", cut twice diagonally (4 triangles)
//   three-triangle units          the half from finished + ⅞" squares cut once diagonally,
//                                 the quarters from finished + 1¼" squares cut twice
//   flying geese                  no-waste, 4 at a time: one square at goose width + 1¼"
//                                 and four squares at goose height + ⅞"
//                                 (stitch-and-flip when the two sky fabrics differ)
//   square in a square            center at finished ÷ √2 + ½" (rounded up to ⅛", trim),
//                                 corners from finished/2 + ⅞" squares cut once diagonally
//   snowball                      stitch-and-flip: base finished + ½", corners corner + ½"
//   on-point setting triangles    squares at block diagonal + 1¼", cut twice diagonally;
//                                 corner triangles at diagonal/2 + ⅞", cut once diagonally
//   borders, binding              strips across the width of fabric (WOF), joined
// Yardage assumes 42" of usable WOF and rounds each fabric up to the next ⅛ yd.

import { SHAPES, ARC_R, SNOW_C } from './blocks.js';
import { layoutQuilt, quiltSize, SQRT2 } from './layout.js';

export const WOF = 42;
export const BINDING_W = 2.5;
export const BINDING_EXTRA = 12; // corners and diagonal joins
export const BACKING_OVERHANG = 4; // each side, for quilting
export const BACKING_SEAM = 1; // two ½" allowances where widths are joined

const EPS = 1e-9;
export const roundUp8 = (x) => Math.ceil(x * 8 - EPS) / 8;
export const isEighth = (x) => Math.abs(x * 8 - Math.round(x * 8)) < 1e-6;

const FRAC = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };

/** 3.5 -> '3½', 0.375 -> '⅜', 12 -> '12' (nearest ⅛). */
export function fmtFrac(x) {
  const e = Math.round(x * 8);
  const whole = Math.floor(e / 8);
  const part = e % 8;
  if (!part) return String(whole);
  return (whole ? String(whole) : '') + FRAC[part];
}
export const fmtIn = (x) => `${fmtFrac(x)}"`;
export const fmtYd = (y) => `${fmtFrac(y)} yd`;

/** Inches of fabric (WOF length) to yards, rounded up to ⅛ yd. */
export function yardsFor(inches) {
  if (inches <= 0) return 0;
  return Math.ceil(inches / 4.5 - EPS) / 8;
}

/**
 * Plans cutting n pieces of w×h from WOF strips. Picks the strip direction
 * that uses the least fabric. Returns { stripW, per, strips, length, along }.
 */
export function planStrips(w, h, n) {
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  const opts = [];
  if (b <= WOF) {
    const per = Math.floor(WOF / b + EPS);
    const strips = Math.ceil(n / per);
    opts.push({ stripW: a, per, strips, length: strips * a, along: b });
  }
  if (a <= WOF && a !== b) {
    const per = Math.floor(WOF / a + EPS);
    const strips = Math.ceil(n / per);
    opts.push({ stripW: b, per, strips, length: strips * b, along: a });
  }
  opts.sort((p, q) => p.length - q.length);
  return opts[0];
}

/** WOF strips needed for long pieces joined end to end. */
export function joinedStrips(totalLength) {
  return Math.ceil(totalLength / WOF - EPS);
}

/** Backing for a quilt: widths of WOF fabric seamed together, 4" extra on every side. */
export function backingPlan(w, h) {
  const bw = w + 2 * BACKING_OVERHANG;
  const bh = h + 2 * BACKING_OVERHANG;
  const panels = (need) => {
    let n = 1;
    while (n * WOF - (n - 1) * BACKING_SEAM < need) n++;
    return n;
  };
  const vertical = { panels: panels(bw), length: bh, dir: 'vertical' };
  const horizontal = { panels: panels(bh), length: bw, dir: 'horizontal' };
  vertical.inches = vertical.panels * vertical.length;
  horizontal.inches = horizontal.panels * horizontal.length;
  const best = horizontal.inches < vertical.inches ? horizontal : vertical;
  return { w: bw, h: bh, ...best, yards: yardsFor(best.inches) };
}

export function bindingPlan(w, h, width = BINDING_W) {
  const length = 2 * (w + h) + BINDING_EXTRA;
  const strips = joinedStrips(length);
  return { width, length, strips, inches: strips * width, yards: yardsFor(strips * width) };
}

/* ------------------------------------------------------------ the pieces */

class Tally {
  constructor() { this.map = new Map(); }
  add(key, n, make) {
    const cur = this.map.get(key);
    if (cur) cur.n += n; else this.map.set(key, { ...make(), n });
  }
  values() { return [...this.map.values()]; }
}

/**
 * Cut pieces for one unit, in finished inches per cell.
 * fills: resolved fabric keys per patch. Adds raw counts to `t`.
 */
function unitCuts(unit, cell, fills, t) {
  const rotOdd = unit.rot % 2 === 1;
  const cw = (rotOdd ? unit.h : unit.w) * cell; // canonical width
  const ch = (rotOdd ? unit.w : unit.h) * cell; // canonical height
  const square = Math.abs(cw - ch) < EPS;
  const f = fills;
  const rect = (fab, w, h, what) => t.rect.add(`${fab}|${Math.min(w, h)}|${Math.max(w, h)}|${what}`, 1,
    () => ({ fab, w: Math.min(w, h), h: Math.max(w, h), what }));
  const tmpl = (fab, w, h, what) => t.template.add(`${fab}|${what}|${w}|${h}`, 1, () => ({ fab, w, h, what }));
  const tri2 = (fab, leg) => t.tri2.add(`${fab}|${leg}`, 1, () => ({ fab, leg }));
  const tri4 = (fab, side) => t.tri4.add(`${fab}|${side}`, 1, () => ({ fab, side }));
  const allSame = f.every((x) => x === f[0]);

  switch (unit.t) {
    case 'square':
      rect(f[0], cw + 0.5, ch + 0.5, cw === ch ? 'squares' : 'rectangles');
      return;
    case 'hst':
      if (!square) { for (let i = 0; i < 2; i++) tmpl(f[i], cw + 1, ch + 1, 'half-rectangle triangles'); return; }
      if (allSame) { rect(f[0], cw + 0.5, ch + 0.5, 'squares'); return; }
      {
        const [a, b] = [f[0], f[1]].sort();
        t.hst.add(`${a}|${b}|${cw}`, 1, () => ({ a, b, fin: cw }));
      }
      return;
    case 'qst':
      if (!square) { for (const x of f) tmpl(x, cw + 1.25, ch + 1.25, 'quarter-rectangle triangles'); return; }
      if (allSame) { rect(f[0], cw + 0.5, ch + 0.5, 'squares'); return; }
      for (const x of f) tri4(x, cw);
      return;
    case 'hqst':
      if (!square) { for (const x of f) tmpl(x, cw + 1.25, ch + 1.25, 'triangles'); return; }
      tri2(f[0], cw);
      tri4(f[1], cw);
      tri4(f[2], cw);
      return;
    case 'geese': {
      const goose = f[0];
      if (Math.abs(cw - 2 * ch) > EPS) { for (const x of f) tmpl(x, cw + 1.25, ch + 1, 'geese triangles'); return; }
      if (f[1] === f[2]) {
        t.geese.add(`${goose}|${f[1]}|${cw}`, 1, () => ({ goose, sky: f[1], w: cw, h: ch }));
      } else {
        rect(goose, cw + 0.5, ch + 0.5, 'goose rectangles (stitch-and-flip)');
        rect(f[1], ch + 0.5, ch + 0.5, 'squares for geese corners (stitch-and-flip)');
        rect(f[2], ch + 0.5, ch + 0.5, 'squares for geese corners (stitch-and-flip)');
      }
      return;
    }
    case 'sqsq':
      if (!square) { for (const x of f) tmpl(x, cw + 1, ch + 1, 'square-in-a-square pieces'); return; }
      rect(f[0], roundUp8(cw / SQRT2 + 0.5), roundUp8(cw / SQRT2 + 0.5), 'squares for the on-point centers (trim after)');
      for (const x of f.slice(1)) tri2(x, cw / 2);
      return;
    case 'snowball': {
      if (!square) { for (const x of f) tmpl(x, cw + 0.5, ch + 0.5, 'snowball pieces'); return; }
      rect(f[0], cw + 0.5, cw + 0.5, 'squares (snowball base)');
      const cs = roundUp8(cw * SNOW_C + 0.5);
      for (const x of f.slice(1)) rect(x, cs, cs, 'squares for snowball corners (stitch-and-flip)');
      return;
    }
    case 'strips2':
    case 'strips3': {
      const k = unit.t === 'strips2' ? 2 : 3;
      for (const x of f) rect(x, cw + 0.5, roundUp8(ch / k + 0.5), 'rectangles (strips)');
      return;
    }
    case 'arc':
      tmpl(f[0], roundUp8(cw * ARC_R + 0.5), roundUp8(cw * ARC_R + 0.5), `Drunkard's Path pies (template, ${fmtFrac(cw * ARC_R)}" radius)`);
      tmpl(f[1], cw + 0.5, cw + 0.5, "Drunkard's Path L-shapes (template)");
      return;
    default:
      rect(f[0], cw + 0.5, ch + 0.5, 'pieces');
  }
}

/**
 * The cutting plan for a design.
 *   resolve(fill, instIndex) -> fabric key (instIndex -1 for non-block pieces)
 * Returns { size, fabrics: [{ fab, cuts: [Cut], inches, yards }], binding, backing, batting, notes }
 *   Cut = { what, n, w, h, how, stripW, strips, per, long?, lengths? }
 */
export function cuttingPlan(design, resolve = (f) => f, layout = layoutQuilt(design)) {
  const size = quiltSize(design);
  const t = { rect: new Tally(), template: new Tally(), tri2: new Tally(), tri4: new Tally(), hst: new Tally(), geese: new Tally() };
  const notes = [];

  for (const inst of layout.blocks) {
    if (inst.kind !== 'block') continue;
    const block = design.blocks[inst.which] || design.blocks[0];
    const cell = inst.size / block.n;
    for (const unit of block.units) unitCuts(unit, cell, unit.f.map((x) => resolve(x, inst.i)), t);
  }
  const B = design.size;
  const cellSizes = new Set(layout.blocks.filter((b) => b.kind === 'block').map((b) => B / design.blocks[b.which].n));
  for (const c of cellSizes) {
    if (!isEighth(c)) notes.push(`Units finish at about ${fmtFrac(c)}" here, between ruler lines; cut sizes are rounded up to the next ⅛" so you can trim. A block size divisible by the grid cuts cleanly.`);
  }

  const raw = []; // { fab, what, n, w, h, how }
  for (const r of t.rect.values()) raw.push({ fab: r.fab, what: r.what, n: r.n, w: r.w, h: r.h, how: '' });
  for (const r of t.template.values()) raw.push({ fab: r.fab, what: r.what, n: r.n, w: Math.min(r.w, r.h), h: Math.max(r.w, r.h), how: 'Cut the shapes from these with a template.' });
  for (const r of t.tri2.values()) {
    const s = roundUp8(r.leg + 0.875);
    raw.push({ fab: r.fab, what: 'squares for triangles', n: Math.ceil(r.n / 2), w: s, h: s, how: `Cut once on the diagonal (${r.n} triangles).` });
  }
  for (const r of t.tri4.values()) {
    const s = roundUp8(r.side + 1.25);
    raw.push({ fab: r.fab, what: 'squares for quarter-square triangles', n: Math.ceil(r.n / 4), w: s, h: s, how: `Cut twice on the diagonal (${r.n} triangles).` });
  }
  for (const r of t.hst.values()) {
    const s = roundUp8(r.fin + 0.875);
    const n = Math.ceil(r.n / 2);
    raw.push({ fab: r.a, what: 'squares for half-square triangles', n, w: s, h: s, pair: r.b, how: `Pair each with a square of {pair}; sew ¼" each side of the diagonal and cut apart: 2 HSTs each (${r.n} needed).` });
    raw.push({ fab: r.b, what: 'squares for half-square triangles', n, w: s, h: s, pair: r.a, how: `Pair each with a square of {pair}; sew ¼" each side of the diagonal and cut apart: 2 HSTs each (${r.n} needed).` });
  }
  for (const r of t.geese.values()) {
    const sets = Math.ceil(r.n / 4);
    const big = roundUp8(r.w + 1.25);
    const small = roundUp8(r.h + 0.875);
    raw.push({ fab: r.goose, what: 'squares for flying geese (no-waste)', n: sets, w: big, h: big, pair: r.sky, how: `Each makes 4 geese with four {pair} squares (${r.n} geese needed).` });
    raw.push({ fab: r.sky, what: 'squares for flying geese wings (no-waste)', n: sets * 4, w: small, h: small, pair: r.goose, how: `Four go with each large {pair} square.` });
  }

  // Plain alternate blocks
  const plain = layout.blocks.filter((b) => b.kind === 'plain').length;
  if (plain) raw.push({ fab: resolve(design.altFill, -1), what: 'plain alternate blocks', n: plain, w: B + 0.5, h: B + 0.5, how: '' });

  // Sashing and cornerstones
  const sash = layout.pieces.filter((p) => p.kind === 'sash').length;
  const stones = layout.pieces.filter((p) => p.kind === 'stone').length;
  if (sash) {
    const s = design.sash.w;
    raw.push({ fab: resolve(design.sash.fill, -1), what: 'sashing strips', n: sash, w: s + 0.5, h: B + 0.5, how: '' });
    raw.push({ fab: resolve(design.sash.stone, -1), what: 'cornerstones', n: stones, w: s + 0.5, h: s + 0.5, how: '' });
  }

  // On-point setting and corner triangles
  const side = layout.pieces.filter((p) => p.kind === 'setting').length;
  const corner = layout.pieces.filter((p) => p.kind === 'corner').length;
  if (design.setting === 'onpoint') {
    const d = B * SQRT2;
    const fab = resolve(design.settingFill, -1);
    if (side) {
      const s = roundUp8(d + 1.25);
      raw.push({ fab, what: 'squares for setting triangles', n: Math.ceil(side / 4), w: s, h: s, how: `Cut twice on the diagonal (${side} side triangles; the long edge stays on the straight grain).` });
    }
    if (corner) {
      const s = roundUp8(d / 2 + 0.875);
      raw.push({ fab, what: 'squares for corner triangles', n: Math.ceil(corner / 2), w: s, h: s, how: 'Cut once on the diagonal (4 corner triangles).' });
    }
  }

  // Group by fabric, then plan strips.
  const byFab = new Map();
  const ensure = (fab) => {
    if (!byFab.has(fab)) byFab.set(fab, { fab, cuts: [], inches: 0 });
    return byFab.get(fab);
  };
  // Merge identical sizes with identical purpose in the same fabric.
  const merged = new Map();
  for (const r of raw) {
    const k = `${r.fab}|${r.w}|${r.h}|${r.what}|${r.pair || ''}|${r.how}`;
    const cur = merged.get(k);
    if (cur) cur.n += r.n; else merged.set(k, { ...r });
  }
  for (const r of merged.values()) {
    const plan = planStrips(r.w, r.h, r.n);
    const g = ensure(r.fab);
    g.cuts.push({ ...r, ...plan });
    g.inches += plan.length;
  }

  // Borders
  design.borders.forEach((b, i) => {
    const lb = layout.borders[i];
    const fab = resolve(b.fill, -1);
    const sideLen = lb.sideLength + 0.5;
    const topLen = lb.topLength + 0.5;
    const total = 2 * sideLen + 2 * topLen;
    const strips = joinedStrips(total);
    const g = ensure(fab);
    g.cuts.push({ fab, what: `border ${i + 1} strips`, long: true, n: 4, w: b.w + 0.5, h: topLen, stripW: b.w + 0.5, strips, per: 0,
      lengths: [sideLen, topLen], length: strips * (b.w + 0.5),
      how: `Join end to end; cut 2 at ${fmtIn(sideLen)} for the sides, sew on, then 2 at ${fmtIn(topLen)} for the top and bottom.` });
    g.inches += strips * (b.w + 0.5);
  });

  // Binding
  const binding = bindingPlan(size.w, size.h);
  const bfab = resolve(design.binding, -1);
  const bg = ensure(bfab);
  bg.cuts.push({ fab: bfab, what: 'binding strips', long: true, n: binding.strips, w: BINDING_W, h: WOF, stripW: BINDING_W, strips: binding.strips, per: 0,
    length: binding.inches, how: `Join with diagonal seams and press in half for a double-fold binding (${Math.round(binding.length)}" long).` });
  bg.inches += binding.inches;

  const fabrics = [...byFab.values()].map((g) => ({ ...g, yards: yardsFor(g.inches) }));
  fabrics.sort((a, b) => b.inches - a.inches);
  const backing = backingPlan(size.w, size.h);
  return { size, fabrics, binding, backing, batting: { w: size.w + 2 * BACKING_OVERHANG, h: size.h + 2 * BACKING_OVERHANG }, notes };
}

/** Instructions for a cut: { head, sub }. names(fab) -> fabric name. */
export function cutText(c, names = (x) => x) {
  const how = (c.how || '').replace('{pair}', names(c.pair));
  const what = c.what.charAt(0).toUpperCase() + c.what.slice(1);
  const strips = `${c.strips} strip${c.strips > 1 ? 's' : ''} ${fmtIn(c.stripW)} × WOF`;
  if (c.long) return { head: `Cut ${strips}`, sub: `${what}. ${how}` };
  const sq = c.w === c.h;
  const size = sq ? `${fmtIn(c.w)} square${c.n > 1 ? 's' : ''}` : `${fmtIn(c.w)} × ${fmtIn(c.h)}`;
  return { head: `${c.n} × ${size}`, sub: `${what}. Cut ${strips}; subcut ${c.per} from each. ${how}`.trim() };
}

export { SHAPES };
