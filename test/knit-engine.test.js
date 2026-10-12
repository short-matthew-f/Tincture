// Knitting Room prototype: the stitch engine (proto/knit/engine.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPiece, build, apply, applyMany, parseRow, planSteps, written, status, layout, ripRow, undo,
  repeatToEnd, repeatPasses, asItAppears, rsOrder, STITCHES,
} from '../proto/knit/engine.js';

const st = (op, n = 1) => Array.from({ length: n }, () => ({ t: 'st', op }));
function row(piece, text) {
  const p = parseRow(text);
  assert.equal(p.ok, true, `${text}: ${p.error}`);
  const plan = planSteps(piece, p.plan);
  const r = applyMany(piece, plan.steps);
  return r.state;
}
const facesOf = (s, pass) => rsOrder(s, pass).map((id) => s.cells[id].face).join('');

test('stockinette flat: knit RS, purl WS, every stitch is a knit on the right side', () => {
  const pc = newPiece({ stitches: 6 });
  row(pc, 'k to end');
  const s = row(pc, 'p to end');
  assert.equal(facesOf(s, s.passes[0]), 'kkkkkk');
  assert.equal(facesOf(s, s.passes[1]), 'kkkkkk');
  assert.equal(s.passes[1].side, 'WS');
});

test('garter flat alternates knit and purl ridges; in the round, knit every round is stockinette', () => {
  const g = newPiece({ stitches: 4 });
  row(g, 'k to end');
  const s = row(g, 'k to end');
  assert.equal(facesOf(s, s.passes[1]), 'pppp');
  const r = newPiece({ stitches: 4, mode: 'round' });
  row(r, 'k to end');
  const t = row(r, 'k to end');
  assert.equal(facesOf(t, t.passes[1]), 'kkkk');
  assert.equal(t.passes[1].side, 'RS');
});

test('a RS row is worked right to left: the first stitch knit sits at the right edge', () => {
  const pc = newPiece({ stitches: 4 });
  const s = row(pc, 'p1, k3');
  assert.equal(facesOf(s, s.passes[0]), 'kkkp');
});

test('2x2 rib reads back as a repeat, and work-as-they-appear keeps it', () => {
  const pc = newPiece({ stitches: 12 });
  let s = row(pc, '*k2, p2; rep from * to end');
  assert.equal(written(s, pc)[1], 'Row 1 (RS): *k2, p2; rep from * to end.');
  const appear = [];
  while (s.passes.length === 2 && status(s).left > 0) {
    const op = asItAppears(s);
    appear.push(op);
    s = apply(pc, { t: 'st', op }, s).state;
  }
  // WS of k2, p2 worked right-to-left: the first stitch on the WS is the RS's last (p).
  assert.equal(appear.join(''), 'kkppkkppkkpp');
  assert.equal(facesOf(s, s.passes[1]), facesOf(s, s.passes[0]));
});

test('decreases lean the right way from the right side, also when worked on the WS', () => {
  const pc = newPiece({ stitches: 8 });
  let s = row(pc, 'k1, k2tog, k2, ssk, k1');
  assert.equal(status(s).total, 6);
  const leans = rsOrder(s, s.passes[0]).map((id) => s.cells[id].lean).filter(Boolean);
  // RS order is left to right; k2tog was worked first so it is on the right.
  assert.deepEqual(leans, ['L', 'R']);
  s = row(pc, 'p1, p2tog, ssp, p1');
  const ws = rsOrder(s, s.passes[1]).map((id) => s.cells[id].lean).filter(Boolean);
  // WS row runs left to right in RS view: p2tog then ssp. p2tog shows as a right lean, ssp as a left.
  assert.deepEqual(ws, ['R', 'L']);
});

test('lace: k1, *yo, k2tog; rep to last st, k1 keeps the count and makes holes', () => {
  const pc = newPiece({ stitches: 10 });
  const s = row(pc, 'k1, *yo, k2tog; rep from * to last st, k1');
  assert.equal(s.passes[0].end, 'row');
  assert.equal(s.passes[0].endCount, 10);
  assert.equal(s.cells.filter((c) => c.yo).length, 4);
  assert.equal(written(s, pc)[1], 'Row 1 (RS): k1, *yo, k2tog; rep from * to last st, k1.');
});

test('cables cross: 2/2 LC holds two to the front and they land on the other side', () => {
  const pc = newPiece({ stitches: 8 });
  const s = row(pc, 'p2, 2/2 LC, p2');
  const L = layout(s);
  const cab = rsOrder(s, s.passes[0]).map((id) => s.cells[id]).filter((c) => c.cable);
  assert.equal(cab.length, 4);
  const front = cab.filter((c) => c.cable.front);
  assert.equal(front.length, 2);
  // The front stitches came from the right (worked first on a RS row) and travel left.
  for (const c of front) assert.ok(L.x[c.id] < L.x[c.parents[0]], 'front stitches move left in a left cross');
});

test('slipped stitches: wyif on a RS row floats on the right side, wyib on the back', () => {
  const pc = newPiece({ stitches: 4 });
  const s = row(pc, 'k1, sl 1 wyif, sl 1 wyib, k1');
  const sl = s.cells.filter((c) => c.slip);
  assert.deepEqual(sl.map((c) => c.slip.float), ['RS', 'WS']);
  assert.equal(sl[0].color, 'A');
});

test('short rows turn mid-row, work back, and leave a wedge of extra height', () => {
  const pc = newPiece({ stitches: 10 });
  row(pc, 'k6, w&t');
  let s = build(pc);
  assert.equal(s.passes[0].end, 'wt');
  assert.equal(s.passes[1].side, 'WS');
  s = row(pc, 'p6');
  assert.equal(s.passes[0].kind, 'short', 'the row that turned early is a short row');
  assert.equal(s.passes[1].kind, 'row', 'working back to the edge is a full row again');
  s = row(pc, 'k to end');
  const heights = rsOrder(s, s.passes[2]).map((id) => s.cells[id].y);
  assert.equal(Math.max(...heights) - Math.min(...heights), 2, 'six stitches are two rows taller');
});

test('increases widen and decreases narrow the drawn fabric', () => {
  const pc = newPiece({ stitches: 4 });
  for (let i = 0; i < 4; i++) { row(pc, 'k1, M1L, k to last st, M1R, k1'); row(pc, 'p to end'); }
  let s = build(pc);
  let L = layout(s);
  const top = rsOrder(s, s.passes[s.passes.length - 2]);
  const width = Math.max(...top.map((id) => L.x[id])) - Math.min(...top.map((id) => L.x[id]));
  assert.ok(width >= 11, `grew to about 12 sts wide (got ${width})`);
  const hat = newPiece({ stitches: 16, mode: 'round' });
  row(hat, '*k2tog, k2; rep from * to end');
  s = build(hat);
  L = layout(s);
  const r = rsOrder(s, s.passes[0]);
  const w = Math.max(...r.map((id) => L.x[id])) - Math.min(...r.map((id) => L.x[id]));
  assert.ok(w < 15 && w >= 11, `crown pulled in (got ${w})`);
});

test('two-color brioche flat uses slide; bind off finishes the piece', () => {
  const pc = newPiece({ stitches: 6 });
  row(pc, '*sl1yo, k1; rep from * to end');
  assert.equal(apply(pc, { t: 'slide' }).ok, true);
  let s = build(pc);
  assert.equal(s.passes[1].side, 'RS');
  assert.equal(s.passes[1].kind, 'slide');
  s = row(pc, 'BO to end');
  assert.equal(s.finished, true);
  assert.equal(written(s, pc).at(-1), 'Fasten off. Weave in ends.');
});

test('the parser reads common US phrasing', () => {
  for (const t of ['k2, p2', '*k1, p1; rep from * to end', '(k1, p1) 3 times', '[ssk, k2] x 2', 'k to last 2 sts, k2tog',
    'sl 1 wyib, k1 tbl, M1L, LLI, kfb, s2kp, sk2p, 1/1 RC, 2/1 LPC, C6F, brk, brp, BO 3, CO 2, pm', 'Row 3 (RS): k3, w&t', 'rep: *k2; rep from * 3 more times']) {
    const r = parseRow(t);
    if (t.startsWith('rep:')) { assert.equal(r.ok, false); continue; }
    assert.equal(r.ok, true, `${t}: ${r.error}`);
  }
  assert.equal(parseRow('k2, frobnicate').ok, false);
  const pc = newPiece({ stitches: 9 });
  const s = row(pc, 'k1, *p1, k1; rep from * 3 more times');
  assert.equal(s.passes[0].end, 'row');
});

test('undo and rip back return to an earlier state exactly', () => {
  const pc = newPiece({ stitches: 6 });
  row(pc, 'k to end');
  row(pc, 'p3');
  let s = ripRow(pc);
  assert.equal(status(s).left, 6);
  assert.equal(s.passes.length, 2);
  s = ripRow(pc);
  assert.equal(s.passes.length, 1);
  assert.equal(status(s).left, 6);
  row(pc, 'k2');
  s = undo(pc, 1);
  assert.equal(status(s).left, 5);
});

test('repeat helpers: work a group to the end, and repeat the last two rows', () => {
  const pc = newPiece({ stitches: 8 });
  let s = build(pc);
  applyMany(pc, repeatToEnd(s, ['k', 'p']));
  s = build(pc);
  applyMany(pc, repeatToEnd(s, ['k', 'p']));
  s = build(pc);
  const r = applyMany(pc, repeatPasses(s, 2));
  assert.equal(r.ok, true);
  s = r.state;
  assert.equal(status(s).rows, 4);
});

test('every stitch in the vocabulary can be worked on a big enough piece', () => {
  for (const op of Object.keys(STITCHES)) {
    const pc = newPiece({ stitches: 8 });
    const r = apply(pc, { t: 'st', op });
    assert.equal(r.ok, true, op);
  }
});

test('every sample project knits through row by row with no stitches left over', async () => {
  const { SAMPLES } = await import('../proto/knit/samples.js');
  for (const smp of SAMPLES) {
    const pc = newPiece({ stitches: smp.co, mode: smp.mode, yarn: smp.yarn });
    smp.rows.forEach((text, i) => {
      const before = build(pc).passes.length;
      const p = parseRow(text);
      assert.equal(p.ok, true, `${smp.id} row ${i + 1}: ${p.error}`);
      const plan = planSteps(pc, p.plan);
      applyMany(pc, plan.steps);
      const s = build(pc);
      assert.ok(s.passes.length > before || s.finished, `${smp.id} row ${i + 1} "${text}" did not finish (${status(s).left} left)`);
    });
  }
});
