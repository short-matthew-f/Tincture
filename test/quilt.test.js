import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../proto/quilt/blocks.js';
import * as Q from '../proto/quilt/layout.js';
import * as C from '../proto/quilt/cutting.js';
import * as P from '../proto/quilt/quilting.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** Samples points across the block and checks each lies in exactly one patch. */
function coverage(block, steps = 37) {
  const patches = K.blockPatches(block);
  let bad = 0;
  for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
    // Irrational-ish offsets keep samples off the seams.
    const x = ((i + 0.5 + 0.1234) / (steps + 0.3)) * block.n;
    const y = ((j + 0.5 + 0.0711) / (steps + 0.3)) * block.n;
    const hits = patches.filter((p) => K.pointInPoly([x, y], p.pts)).length;
    if (hits !== 1) bad++;
  }
  return bad;
}

test('every library block tiles its square exactly: area sums to n² and no gaps or overlaps', () => {
  assert.ok(K.LIBRARY.length >= 20);
  for (const item of K.LIBRARY) {
    const b = K.libraryBlock(item.id);
    assert.ok(near(K.blockArea(b), b.n * b.n, 1e-6), `${item.name} area ${K.blockArea(b)} vs ${b.n * b.n}`);
    assert.equal(coverage(b), 0, `${item.name} has gaps or overlaps`);
    // Units stay inside the grid and do not overlap.
    const cells = new Set();
    for (const u of b.units) {
      assert.ok(u.x >= 0 && u.y >= 0 && u.x + u.w <= b.n && u.y + u.h <= b.n, `${item.name} unit off grid`);
      for (let y = u.y; y < u.y + u.h; y++) for (let x = u.x; x < u.x + u.w; x++) {
        const k = `${x},${y}`;
        assert.ok(!cells.has(k), `${item.name} units overlap at ${k}`);
        cells.add(k);
      }
      assert.equal(u.f.length, K.patchCount(u.t), `${item.name} fills match patches`);
      if (u.w !== u.h && u.t !== 'square') assert.equal(u.rot % 2, u.w > u.h ? 0 : 1, `${item.name} rectangle keeps its footprint`);
    }
    assert.equal(cells.size, b.n * b.n, `${item.name} covers every cell`);
  }
});

test('every shape tiles the unit square, in every orientation', () => {
  for (const t of Object.keys(K.SHAPES)) {
    for (let rot = 0; rot < 4; rot++) for (const flip of [false, true]) {
      const u = { x: 0, y: 0, w: 1, h: 1, t, rot, flip, f: Array(K.patchCount(t)).fill('L') };
      const b = { n: 1, units: [u] };
      assert.ok(near(K.blockArea(b), 1, 1e-9), `${t} r${rot} f${flip}`);
      assert.equal(coverage(b, 23), 0, `${t} r${rot} f${flip}`);
    }
  }
  // The Drunkard's Path pie is a true quarter circle (to within the drawing segments).
  const pie = K.polyArea(K.SHAPES.arc.patches[0]);
  assert.ok(Math.abs(pie - (Math.PI * K.ARC_R ** 2) / 4) < 0.002);
});

test('orientation: a quarter turn of the HST swaps its diagonal; flips and turns compose', () => {
  assert.deepEqual(K.orient([0, 0], 1), [1, 0]);
  assert.deepEqual(K.orient([1, 0], 1), [1, 1]);
  assert.deepEqual(K.orient([0.25, 0], 0, true), [0.75, 0]);
  for (let r = 0; r < 4; r++) {
    const p = [0.2, 0.7];
    assert.deepEqual(K.orient(K.orient(p, r), 4 - r).map((v) => +v.toFixed(9)), p);
  }
  // A goose pointing up, turned once, points right.
  const g = K.unitPatches({ x: 0, y: 0, w: 1, h: 2, t: 'geese', rot: 1, flip: false, f: ['D', 'L', 'L'] });
  assert.deepEqual(g[0].map((p) => p.map((v) => +v.toFixed(9))), [[0, 0], [1, 1], [0, 2]]);
});

test('block rotation and mirror: four turns or two mirrors are the identity; the drawing turns with them', () => {
  for (const item of K.LIBRARY) {
    const b = K.libraryBlock(item.id);
    const key = (bl) => K.blockPatches(bl).map((p) => `${p.fill}:${p.pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort().join(' ')}`).sort().join('|');
    assert.equal(key(K.rotateBlock(b, 4)), key(b), item.name);
    assert.equal(key(K.mirrorBlock(K.mirrorBlock(b))), key(b), item.name);
    // Rotating the design equals rotating every patch point about the center.
    const turned = K.blockPatches(b).map((p) => `${p.fill}:${p.pts.map((q) => K.transformPoint(q, b.n, { rot: 1 })).map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort().join(' ')}`).sort().join('|');
    assert.equal(key(K.rotateBlock(b, 1)), turned, `${item.name} rotate`);
    const mirrored = K.blockPatches(b).map((p) => `${p.fill}:${p.pts.map((q) => K.transformPoint(q, b.n, { mirrorX: true })).map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort().join(' ')}`).sort().join('|');
    assert.equal(key(K.mirrorBlock(b)), mirrored, `${item.name} mirror`);
  }
  // Ohio Star and Nine Patch look the same turned; Pinwheel mirrored spins the other way.
  const ohio = K.libraryBlock('ohio-star');
  const k = (bl) => K.blockPatches(bl).map((p) => `${p.fill}:${p.pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort().join(' ')}`).sort().join('|');
  assert.equal(k(K.rotateBlock(ohio, 1)), k(ohio));
  const pin = K.libraryBlock('pinwheel');
  assert.notEqual(k(K.mirrorBlock(pin)), k(pin));
  assert.equal(k(K.rotateBlock(pin, 1)), k(pin));
});

test('editing: shapes cycle, joins make flying geese, splits undo them', () => {
  let b = K.plainGrid(3, 'L');
  const i = K.unitAt(b, 0, 0);
  const j = K.unitAt(b, 1, 0);
  b = K.joinUnits(b, i, j);
  const g = b.units[b.units.length - 1];
  assert.equal(g.t, 'geese');
  assert.equal(g.w, 2);
  assert.ok(near(K.blockArea(b), 9));
  assert.equal(K.joinUnits(b, K.unitAt(b, 0, 0), K.unitAt(b, 2, 2)), null); // not a rectangle
  b = K.splitUnit(b, b.units.length - 1);
  assert.equal(b.units.length, 9);
  let u = b.units[0];
  const seen = new Set();
  for (let n = 0; n < 9; n++) { u = K.nextShape(u); seen.add(u.t); assert.equal(u.f.length, K.patchCount(u.t)); }
  assert.equal(seen.size, K.CYCLE_SQUARE.length);
  assert.equal(K.turnUnit({ ...g, rot: 0 }).rot, 2); // rectangles turn half way
});

test('straight setting with sashing and borders: finished size', () => {
  const d = Q.normalizeDesign({ ...Q.defaultDesign(), size: 9, cols: 4, rows: 5, setting: 'straight', sash: { w: 2, fill: 'D', stone: 'A', outer: true }, borders: [{ w: 4, fill: 'D' }] });
  assert.deepEqual(Q.centerSize(d), { w: 46, h: 57 });
  assert.deepEqual(Q.quiltSize(d), { w: 54, h: 65 });
  const L = Q.layoutQuilt(d);
  assert.equal(L.pieces.filter((p) => p.kind === 'sash').length, 49);
  assert.equal(L.pieces.filter((p) => p.kind === 'stone').length, 30);
  // Sashing only between blocks
  d.sash.outer = false;
  assert.deepEqual(Q.centerSize(d), { w: 42, h: 53 });
  // Without sashing: plain multiples
  d.sash.w = 0; d.borders = [];
  assert.deepEqual(Q.quiltSize(d), { w: 36, h: 45 });
});

test('on point: block diagonal = size × √2, setting and corner triangles fill the rest exactly', () => {
  const d = Q.normalizeDesign({ ...Q.defaultDesign(), size: 6, cols: 3, rows: 4, setting: 'onpoint', borders: [] });
  const L = Q.layoutQuilt(d);
  const diag = 6 * Math.SQRT2;
  assert.ok(near(L.w, 3 * diag) && near(L.h, 4 * diag));
  assert.equal(L.blocks.length, 3 * 4 + 2 * 3);
  assert.equal(L.pieces.filter((p) => p.kind === 'setting').length, 2 * 2 + 2 * 3);
  assert.equal(L.pieces.filter((p) => p.kind === 'corner').length, 4);
  // Areas add up: blocks + setting + corners = whole center.
  const area = L.blocks.length * 36 + L.pieces.filter((p) => p.kind !== 'border').reduce((s, p) => s + K.polyArea(p.pts), 0);
  assert.ok(near(area, L.w * L.h, 1e-6));
  // Neighbors sit half a diagonal apart both ways, so their edges meet exactly.
  for (const a of L.blocks) for (const b of L.blocks) if (a !== b) assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= diag / Math.SQRT2 - 1e-9);
  // Cut sizes from the standard chart for a 6" block: side 9¾", corner 5⅛".
  const plan = C.cuttingPlan(d, (f) => f, L);
  const cuts = plan.fabrics.flatMap((f) => f.cuts);
  const side = cuts.find((c) => c.what === 'squares for setting triangles');
  const corner = cuts.find((c) => c.what === 'squares for corner triangles');
  assert.equal(side.w, 9.75);
  assert.equal(side.n, Math.ceil(10 / 4));
  assert.equal(corner.w, 5.125);
  assert.equal(corner.n, 2);
  // 12" blocks: 18¼" and 9⅜"
  const d12 = { ...d, size: 12 };
  const c12 = C.cuttingPlan(d12, (f) => f).fabrics.flatMap((f) => f.cuts);
  assert.equal(c12.find((c) => c.what === 'squares for setting triangles').w, 18.25);
  assert.equal(c12.find((c) => c.what === 'squares for corner triangles').w, 9.375);
});

test('cut sizes: squares +½", HST +⅞" (2 at a time), QST +1¼", flying geese no-waste', () => {
  const one = (unit, n = 1, size = 3) => {
    const d = Q.normalizeDesign({ ...Q.defaultDesign(), size, cols: n, rows: 1, sash: { w: 0 }, borders: [], alt: 'none', blocks: [{ name: 't', n: 1, units: [unit] }, K.libraryBlock('four-patch')] });
    return C.cuttingPlan(d, (f) => f).fabrics.flatMap((f) => f.cuts).filter((c) => !c.long);
  };
  const sq = one({ x: 0, y: 0, w: 1, h: 1, t: 'square', rot: 0, flip: false, f: ['L'] });
  assert.equal(sq[0].w, 3.5);
  const hst = one({ x: 0, y: 0, w: 1, h: 1, t: 'hst', rot: 0, flip: false, f: ['L', 'D'] }, 3);
  assert.equal(hst.length, 2);
  for (const c of hst) { assert.equal(c.w, 3.875); assert.equal(c.n, 2); } // 3 HSTs need 2 pairs
  const qst = one({ x: 0, y: 0, w: 1, h: 1, t: 'qst', rot: 0, flip: false, f: ['L', 'D', 'L', 'D'] }, 2);
  for (const c of qst) { assert.equal(c.w, 4.25); assert.equal(c.n, 1); } // 4 triangles of each = 1 square
  // Geese 6" × 3" finished: one 7¼" square and four 3⅞" squares make four.
  const geese = (() => {
    const d = Q.normalizeDesign({ ...Q.defaultDesign(), size: 6, cols: 4, rows: 1, sash: { w: 0 }, borders: [],
      blocks: [{ name: 'g', n: 2, units: [{ x: 0, y: 0, w: 2, h: 1, t: 'geese', rot: 0, flip: false, f: ['D', 'L', 'L'] }, { x: 0, y: 1, w: 2, h: 1, t: 'square', rot: 0, flip: false, f: ['L'] }] }, K.libraryBlock('four-patch')] });
    return C.cuttingPlan(d, (f) => f).fabrics.flatMap((f) => f.cuts).filter((c) => /geese/.test(c.what));
  })();
  const big = geese.find((c) => c.fab === 'D');
  const small = geese.find((c) => c.fab === 'L');
  assert.equal(big.w, 7.25); assert.equal(big.n, 1);
  assert.equal(small.w, 3.875); assert.equal(small.n, 4);
  // Square in a square, 4" finished: center 3⅜" (4/√2 + ½ = 3.33 → up to ⅛), corners from 2⅞" squares.
  const sqsq = one({ x: 0, y: 0, w: 1, h: 1, t: 'sqsq', rot: 0, flip: false, f: ['M', 'D', 'D', 'D', 'D'] }, 1, 4);
  assert.equal(sqsq.find((c) => c.fab === 'M').w, 3.375);
  const corners = sqsq.find((c) => c.fab === 'D');
  assert.equal(corners.w, 2.875); assert.equal(corners.n, 2);
});

test('strips across 42" WOF and yardage rounded up to ⅛ yd', () => {
  assert.deepEqual(C.planStrips(3.5, 3.5, 100), { stripW: 3.5, per: 12, strips: 9, length: 31.5, along: 3.5 });
  const sash = C.planStrips(2.5, 9.5, 49);
  assert.equal(sash.stripW, 2.5); assert.equal(sash.per, 4); assert.equal(sash.strips, 13); assert.equal(sash.length, 32.5);
  assert.equal(C.planStrips(2.5, 2.5, 16).strips, 1);
  assert.equal(C.planStrips(2.5, 2.5, 17).strips, 2);
  assert.equal(C.yardsFor(31.5), 0.875);
  assert.equal(C.yardsFor(4.5), 0.125);
  assert.equal(C.yardsFor(4.6), 0.25);
  assert.equal(C.yardsFor(36), 1);
  assert.equal(C.yardsFor(36.1), 1.125);
  assert.equal(C.fmtFrac(3.5), '3½');
  assert.equal(C.fmtFrac(0.375), '⅜');
  assert.equal(C.fmtFrac(9.875), '9⅞');
  assert.equal(C.fmtYd(1.75), '1¾ yd');
  assert.equal(C.roundUp8(9.7353), 9.75);
  assert.equal(C.roundUp8(3.5), 3.5);
});

test('hand-checked: 4 × 5 Nine Patch quilt, 9" blocks, 2" sashing with cornerstones, 4" border', () => {
  const d = Q.normalizeDesign({
    ...Q.defaultDesign(),
    palette: { L: 'cream', M: 'm', D: 'red', A: 'gold', B: 'b' },
    blocks: [K.libraryBlock('nine-patch'), K.libraryBlock('snowball')],
    size: 9, cols: 4, rows: 5, setting: 'straight', alt: 'none',
    sash: { w: 2, fill: 'green', stone: 'gold', outer: true },
    borders: [{ w: 4, fill: 'navy' }], binding: 'navy', scrappy: { on: false },
  });
  const res = (f) => Q.resolveRole(d, f);
  const plan = C.cuttingPlan(d, res);
  assert.deepEqual(plan.size, { w: 54, h: 65 });
  const fab = (id) => plan.fabrics.find((f) => f.fab === id);
  // 20 blocks × 5 dark squares at 3½": 12 per strip → 9 strips = 31½" → ⅞ yd
  const red = fab('red');
  assert.equal(red.cuts[0].n, 100); assert.equal(red.cuts[0].w, 3.5); assert.equal(red.cuts[0].strips, 9);
  assert.equal(red.yards, 0.875);
  // 80 light squares → 7 strips = 24½" → ¾ yd
  const cream = fab('cream');
  assert.equal(cream.cuts[0].n, 80); assert.equal(cream.cuts[0].strips, 7); assert.equal(cream.yards, 0.75);
  // Sashing: 5 rows × 5 + 6 × 4 = 49 strips 2½" × 9½": thirteen 2½" WOF strips, 4 per strip.
  const green = fab('green');
  assert.equal(green.cuts[0].n, 49); assert.equal(green.cuts[0].strips, 13); assert.equal(green.inches, 32.5); assert.equal(green.yards, 1);
  // Cornerstones: 6 × 5 = 30 at 2½": 2 strips → 5" → ¼ yd
  const gold = fab('gold');
  assert.equal(gold.cuts[0].n, 30); assert.equal(gold.cuts[0].strips, 2); assert.equal(gold.yards, 0.25);
  // Border 4": sides 57½" × 2, top/bottom 54½" × 2 = 224" → 6 WOF strips 4½" = 27".
  // Binding: 2 × (54 + 65) + 12 = 250" → 6 strips 2½" = 15". Same fabric: 42" → 1¼ yd.
  const navy = fab('navy');
  const border = navy.cuts.find((c) => /border/.test(c.what));
  assert.equal(border.strips, 6); assert.deepEqual(border.lengths, [57.5, 54.5]);
  const binding = navy.cuts.find((c) => /binding/.test(c.what));
  assert.equal(binding.strips, 6);
  assert.equal(navy.inches, 27 + 15);
  assert.equal(navy.yards, 1.25);
  // Backing 62 × 73": two widths of 62" seamed top to bottom = 124" → 3½ yd
  assert.equal(plan.backing.panels, 2); assert.equal(plan.backing.length, 62); assert.equal(plan.backing.yards, 3.5);
  assert.deepEqual(plan.batting, { w: 62, h: 73 });
});

test('Ohio Star starter: QST and square counts per block', () => {
  const d = Q.normalizeDesign(Q.defaultDesign());
  const plan = C.cuttingPlan(d, (f) => Q.resolveRole(d, f));
  // 12 blocks, 4" units: 4 corners per block = 48 light 4½" squares; 4 QSTs per block: 2 light + 2 dark triangles each.
  const L = plan.fabrics.find((f) => f.fab === d.palette.L);
  const sq = L.cuts.find((c) => c.what === 'squares');
  assert.equal(sq.n, 48); assert.equal(sq.w, 4.5);
  const q = L.cuts.find((c) => /quarter-square/.test(c.what));
  assert.equal(q.w, 5.25); assert.equal(q.n, 24); // 96 light triangles / 4
  const D = plan.fabrics.find((f) => f.fab === d.palette.D);
  assert.equal(D.cuts.find((c) => /quarter-square/.test(c.what)).n, 24);
});

test('fabric swap and scrappy resolution', () => {
  const d = Q.normalizeDesign(Q.defaultDesign());
  const s = Q.swapFabrics(d, d.palette.L, d.palette.D);
  assert.equal(s.palette.L, d.palette.D);
  assert.equal(s.palette.D, d.palette.L);
  const stash = [
    { id: 'i1', color: '#2C3E66' }, { id: 'i2', color: '#3E6A9E' }, { id: 'i3', color: '#2A3A60' },
    { id: 'c', color: '#EFE6D2' },
  ];
  const sd = { ...d, palette: { ...d.palette, D: 'i1', L: 'c' }, scrappy: { on: true, seed: 3 } };
  const r = Q.makeResolver(sd, stash);
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(r('D', i));
  assert.ok(picks.size >= 2, 'blues vary');
  for (const p of picks) assert.ok(['i1', 'i2', 'i3'].includes(p));
  assert.equal(r('L', 5), 'c'); // only one cream: stays put
  assert.equal(r('D', -1), 'i1'); // borders and sashing stay planned
  assert.equal(Q.familyOf('#2C3E66'), Q.familyOf('#3E6A9E'));
  assert.notEqual(Q.familyOf('#2C3E66'), Q.familyOf('#EFE6D2'));
});

test('secondary patterns: alternate turns and mirrors by position', () => {
  const d = Q.normalizeDesign({ ...Q.defaultDesign(), rotate: 'alt', mirror: 'cols', cols: 3, rows: 2, sash: { w: 0 }, borders: [] });
  const L = Q.layoutQuilt(d);
  const at = (r, c) => L.blocks.find((b) => b.row === r && b.col === c);
  assert.equal(at(0, 0).rot, 0); assert.equal(at(0, 1).rot, 1); assert.equal(at(1, 0).rot, 1);
  assert.equal(at(0, 1).mirrorX, true); assert.equal(at(0, 2).mirrorX, false);
  // On point, side-by-side neighbors (main vs inner grid) alternate.
  const o = Q.layoutQuilt({ ...d, setting: 'onpoint', mirror: 'none' });
  const main = o.blocks.filter((b) => b.row % 2 === 0);
  const inner = o.blocks.filter((b) => b.row % 2 === 1);
  const rots = (list) => new Set(list.map((b) => b.rot));
  assert.ok(rots(main).size === 1 && rots(inner).size === 1 && [...rots(main)][0] !== [...rots(inner)][0]);
});

test('quilting: the meander is one loop through every cell that never crosses itself', () => {
  const { W, H, order, adj } = P.meanderLoop(7, 5, P.mulberry32(3));
  assert.equal(order.length, W * H);
  assert.equal(new Set(order.map(([x, y]) => `${x},${y}`)).size, W * H);
  for (const a of adj) assert.equal(a.length, 2);
  for (let i = 0; i < order.length; i++) {
    const [x1, y1] = order[i];
    const [x2, y2] = order[(i + 1) % order.length];
    assert.equal(Math.abs(x1 - x2) + Math.abs(y1 - y2), 1);
  }
  const d = Q.normalizeDesign(Q.defaultDesign());
  for (const p of P.PATTERNS) {
    const paths = P.quiltingPaths(d, Q.layoutQuilt(d), { pattern: p.id, spacing: 1.5 });
    if (p.id === 'none') assert.equal(paths.length, 0); else assert.ok(paths.length > 0, p.id);
  }
  const sq = P.insetConvex([[0, 0], [4, 0], [4, 4], [0, 4]], 1);
  assert.deepEqual(sq.map((q) => q.map((v) => +v.toFixed(9))), [[1, 1], [3, 1], [3, 3], [1, 3]]);
  assert.equal(P.insetConvex([[0, 0], [1, 0], [0, 1]], 1), null);
});
