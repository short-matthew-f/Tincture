// fx.js pure helpers: spring curves, board-local hit testing, hysteresis, magnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRINGS, DRAG, springCurve, springAt, lerpKeyframe, nearestCell, applyHysteresis, cellsWithin, pickTarget,
  cellRect, boardFromRects, tiltFromVelocity, fx,
} from '../src/ui/fx.js';

test('springs: every preset ends within 0.5% of its target and overshoots at most 5%', () => {
  const want = { soft: 350, firm: 280, heavy: 420 };
  for (const [name, ms] of Object.entries(want)) {
    const c = springCurve(name);
    assert.equal(c.duration, ms, `${name} lasts ${ms} ms`);
    assert.equal(c.values.length, 41, '40 steps');
    assert.equal(c.values[0], 0);
    const end = c.values[c.values.length - 1];
    assert.ok(Math.abs(end - 1) <= 0.005, `${name} ends at ${end}`);
    // Overshoot on a fine grid, not only at the keyframes.
    let max = 0;
    for (let t = 0; t <= ms * 2; t += 0.5) max = Math.max(max, springAt(t, name));
    assert.ok(max <= 1.05, `${name} overshoot ${max}`);
    assert.ok(max > 1.005, `${name} has a visible overshoot (${max})`);
  }
  const heavy = Math.max(...springCurve('heavy').values);
  const soft = Math.max(...springCurve('soft').values);
  assert.ok(heavy > soft, 'heavy overshoots more than soft');
  assert.ok(Object.isFrozen(SPRINGS));
});

test('springAt: critically and over-damped springs approach without overshoot', () => {
  const crit = { stiffness: 400, damping: 40, duration: 400 };
  const over = { stiffness: 400, damping: 80, duration: 400 };
  for (const cfg of [crit, over]) {
    let prev = 0;
    for (let t = 0; t <= 1000; t += 5) {
      const v = springAt(t, cfg);
      assert.ok(v <= 1 + 1e-9 && v >= prev - 1e-9);
      prev = v;
    }
  }
});

test('lerpKeyframe interpolates numbers inside matching transform strings', () => {
  const k = lerpKeyframe({ transform: 'translate(0px, 10px) scale(1)', opacity: 0 }, { transform: 'translate(20px, 0px) scale(1.06)', opacity: 1 }, 0.5);
  assert.equal(k.transform, 'translate(10px, 5px) scale(1.03)');
  assert.equal(k.opacity, 0.5);
  const odd = lerpKeyframe({ transform: 'none' }, { transform: 'scale(2)' }, 0.5);
  assert.equal(odd.transform, 'none', 'shapes that do not match switch at the end');
  assert.equal(lerpKeyframe({ transform: 'none' }, { transform: 'scale(2)' }, 1).transform, 'scale(2)');
});

// A 6x6 shelf: 56 px cells, 6 px gaps between columns, a 20 px plank between rows.
const BOARD = { left: 20, top: 100, cols: 6, rows: 6, cellW: 56, cellH: 64, gapX: 6, gapY: 20, pad: 10 };
const centre = (i) => { const r = cellRect(i, BOARD); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };

test('nearestCell: centres, gap and plank midpoints, the frame and beyond', () => {
  for (let i = 0; i < 36; i++) assert.equal(nearestCell(centre(i), BOARD), i, `centre of ${i}`);
  // Gap midpoint between column 1 and 2, row 3: either side is fine, never nothing.
  const r1 = cellRect(3 * 6 + 1, BOARD);
  const gapMid = { x: r1.right + BOARD.gapX / 2, y: (r1.top + r1.bottom) / 2 };
  assert.ok([19, 20].includes(nearestCell(gapMid, BOARD)));
  // Just left of the gap midpoint is column 1, just right is column 2.
  assert.equal(nearestCell({ x: gapMid.x - 0.5, y: gapMid.y }, BOARD), 19);
  assert.equal(nearestCell({ x: gapMid.x + 0.5, y: gapMid.y }, BOARD), 20);
  // Plank midpoint between rows 2 and 3, column 4.
  const r2 = cellRect(2 * 6 + 4, BOARD);
  const plankMid = { x: (r2.left + r2.right) / 2, y: r2.bottom + BOARD.gapY / 2 };
  assert.ok([16, 22].includes(nearestCell(plankMid, BOARD)));
  assert.equal(nearestCell({ x: plankMid.x, y: plankMid.y - 1 }, BOARD), 16);
  assert.equal(nearestCell({ x: plankMid.x, y: plankMid.y + 1 }, BOARD), 22);
  // The frame (pad 10) and 12 px beyond it resolve to the edge cells.
  assert.equal(nearestCell({ x: BOARD.left - 10 - 11, y: centre(0).y }, BOARD), 0);
  assert.equal(nearestCell({ x: centre(35).x, y: cellRect(35, BOARD).bottom + 10 + 11 }, BOARD), 35);
  // Further out: nothing.
  assert.equal(nearestCell({ x: BOARD.left - 10 - 13, y: centre(0).y }, BOARD), -1);
  assert.equal(nearestCell({ x: centre(5).x, y: BOARD.top - 10 - 13 }, BOARD), -1);
  assert.equal(nearestCell({ x: cellRect(5, BOARD).right + 10 + 13, y: centre(5).y }, BOARD), -1);
  assert.equal(nearestCell({ x: NaN, y: 0 }, BOARD), -1);
});

test('nearestCell: perturbation at random offsets up to half a cell lands on the intended cell', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let right = 0;
  for (let k = 0; k < 2000; k++) {
    const i = Math.floor(rnd() * 36);
    const c = centre(i);
    const p = { x: c.x + (rnd() - 0.5) * BOARD.cellW, y: c.y + (rnd() - 0.5) * BOARD.cellH };
    if (nearestCell(p, BOARD) === i) right++;
  }
  assert.equal(right, 2000);
});

test('applyHysteresis: the target changes only 25% of a cell into a neighbour', () => {
  const from = 14; // row 2, col 2
  const r = cellRect(from, BOARD);
  const y = (r.top + r.bottom) / 2;
  const mid = r.right + BOARD.gapX / 2;            // the boundary with cell 15
  const band = BOARD.gapX / 2 + 0.25 * BOARD.cellW; // past the cell's edge
  // Just across the midline: the raw nearest is 15, hysteresis keeps 14.
  assert.equal(nearestCell({ x: mid + 2, y }, BOARD), 15);
  assert.equal(applyHysteresis(from, 15, { x: mid + 2, y }, BOARD), 14);
  assert.equal(applyHysteresis(from, 15, { x: r.right + band - 1, y }, BOARD), 14);
  assert.equal(applyHysteresis(from, 15, { x: r.right + band + 1, y }, BOARD), 15);
  // Vertical, across a plank.
  const yb = r.bottom + BOARD.gapY / 2 + 0.25 * BOARD.cellH;
  assert.equal(applyHysteresis(from, 20, { x: (r.left + r.right) / 2, y: yb - 1 }, BOARD), 14);
  assert.equal(applyHysteresis(from, 20, { x: (r.left + r.right) / 2, y: yb + 1 }, BOARD), 20);
  // No previous target, the same cell, or leaving the board: the candidate.
  assert.equal(applyHysteresis(-1, 15, { x: mid + 2, y }, BOARD), 15);
  assert.equal(applyHysteresis(14, 14, { x: mid + 2, y }, BOARD), 14);
  assert.equal(applyHysteresis(14, -1, { x: mid + 2, y }, BOARD), -1);
  // A fast jump far away switches at once.
  assert.equal(applyHysteresis(14, 35, centre(35), BOARD), 35);
});

test('cellsWithin + pickTarget: a legal partner within 24 px beats the empty under the point', () => {
  const r = cellRect(8, BOARD);
  // A point inside cell 9, 10 px right of cell 8's edge.
  const p = { x: r.right + 10, y: (r.top + r.bottom) / 2 };
  assert.equal(nearestCell(p, BOARD), 9);
  const near = cellsWithin(p, BOARD, DRAG.magnet);
  assert.deepEqual(near.slice(0, 2).map((c) => c.index), [9, 8]);
  assert.ok(near.every((c) => c.dist <= 24));
  const partners = new Set([8]);
  const magnet = (i) => (partners.has(i) ? 1 : 0);
  assert.equal(pickTarget([{ index: 9, dist: 0 }, ...near.filter((c) => c.index !== 9)], magnet), 8);
  // No partner nearby: the nearest (the empty under the point).
  assert.equal(pickTarget(near, () => 0), 9);
  assert.equal(pickTarget(near, null), 9);
  // A partner more than 24 px away never steals the drop.
  assert.equal(pickTarget([{ index: 9, dist: 0 }, { index: 3, dist: 30 }], (i) => (i === 3 ? 1 : 0)), 9);
  // Higher scores win; ties go to the nearer.
  assert.equal(pickTarget([{ index: 9, dist: 0 }, { index: 8, dist: 10 }, { index: 10, dist: 12 }], (i) => (i === 10 ? 2 : i === 8 ? 1 : 0)), 10);
  assert.equal(pickTarget([{ index: 9, dist: 0 }, { index: 8, dist: 10 }, { index: 10, dist: 4 }], (i) => (i === 9 ? 0 : 1)), 10);
  assert.equal(pickTarget([], magnet), -1);
});

test('boardFromRects measures cells, gaps and planks from client rects', () => {
  const rects = [];
  for (let i = 0; i < 36; i++) {
    const r = cellRect(i, BOARD);
    rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  }
  const b = boardFromRects(rects, 6, 10);
  assert.deepEqual({ ...b, count: undefined }, { ...BOARD, count: undefined });
  assert.equal(b.count, 36);
  assert.equal(boardFromRects([], 6), null);
});

test('tilt follows velocity and never passes 6 degrees', () => {
  assert.equal(tiltFromVelocity(0), 0);
  assert.ok(tiltFromVelocity(0.3) > 0 && tiltFromVelocity(-0.3) < 0);
  assert.equal(tiltFromVelocity(50), 6);
  assert.equal(tiltFromVelocity(-50), -6);
});

test('fx keeps every existing export and adds the v0.2 vocabulary', () => {
  for (const k of ['rollNumber', 'press', 'squash', 'pulse', 'confetti', 'shimmerSweep', 'flyTo', 'ringBurst', 'dim', 'fade', 'pourFill', 'isReducedMotion',
    'spring', 'lift', 'settle', 'coinArc', 'stamp', 'pour', 'drag', 'nearestCell', 'applyHysteresis', 'pickTarget']) {
    assert.equal(typeof fx[k], 'function', k);
  }
  // Without a DOM the effects resolve quietly.
  const noop = fx.drag(null, {});
  assert.equal(typeof noop.cancel, 'function');
  assert.equal(typeof noop.destroy, 'function');
});
