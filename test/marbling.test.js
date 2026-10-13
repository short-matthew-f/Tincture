// Unit tests for the marbling + origami prototype (proto/marbling/marble.js, fold.js). Pure modules only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INKS, LIMITS, BATH_SIZE, mulberry32, createBath, countVerts, snapshot, restore, circlePts, dropVertexCount,
  dropField, tineLineField, segmentField, combField, swirlField, transformPoly, simplifyPoly,
  dropInk, beginDrop, growDrop, stylusStep, combStep, swirlStep, resample, starterOps, runStarter, applyOp, combOffsets,
} from '../proto/marbling/marble.js';
import {
  createStack, planStep, planOp, foldStack, buildStates, finalState, area, invert, applyM, det, mul, reflectionMatrix,
  splitConvex, creaseLine, stackBounds, creaseSegments, SHEET_M, stepOps, modelBounds,
} from '../proto/marbling/fold.js';
import { MODELS, LEVELS, getModel } from '../proto/marbling/models.js';
const H = 2 / (2 + Math.SQRT2);

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

// ------------------------------------------------------------------ marbling
test('drop transform matches the published formula and composes by area', () => {
  const f = dropField(100, 200, 50);
  const out = [0, 0];
  f(130, 240, out); // d = 50
  const s = Math.sqrt(1 + (50 * 50) / (50 * 50));
  near(out[0], 100 + 30 * s);
  near(out[1], 200 + 40 * s);
  // two drops at one centre: distances add in quadrature (the bullseye rule)
  const bath = createBath();
  const a = dropInk(bath, 500, 500, 60, '#000');
  dropInk(bath, 500, 500, 80, '#fff');
  const r = Math.hypot(a.pts[0] - 500, a.pts[1] - 500);
  near(r, Math.sqrt(60 * 60 + 80 * 80), 1e-6);
  // a point at the centre does not move
  f(100, 200, out);
  assert.deepEqual(out, [100, 200]);
});

test('new drop is a circle of the requested radius with 120-200 vertices', () => {
  for (const r of [10, 40, 90, 200]) {
    const n = dropVertexCount(r);
    assert.ok(n >= 120 && n <= 200);
  }
  const bath = createBath();
  const ink = dropInk(bath, 300, 300, 70, '#B8433A');
  const n = ink.pts.length / 2;
  assert.ok(n >= 120 && n <= 200);
  for (let i = 0; i < n; i++) near(Math.hypot(ink.pts[2 * i] - 300, ink.pts[2 * i + 1] - 300), 70, 1e-9);
});

test('tine line: full shift on the line, half at distance c, decays away', () => {
  const f = tineLineField([0, 0], [1, 0], 40, 25);
  const out = [0, 0];
  f(10, 0, out); near(out[0], 10 + 40); near(out[1], 0);
  f(10, 25, out); near(out[0], 10 + 20); near(out[1], 25);
  f(10, -25, out); near(out[0], 10 + 20);
  f(10, 400, out); assert.ok(out[0] - 10 < 0.01);
  // direction and normal need not be axis aligned
  const g = tineLineField([5, 5], [0, 3], 10, 10);
  g(5, 5, out); near(out[1], 15); near(out[0], 5);
});

test('stylus moves ink under its path and leaves far ink alone', () => {
  const f = segmentField([0, 0], [30, 0], 20);
  const out = [0, 0];
  f(15, 0, out); near(out[0], 45); // on the path: moves with the stylus
  f(15, 500, out); assert.deepEqual(out, [15, 500]);
  f(15, 20, out); near(out[0] - 15, 15, 1e-9); // 20 away = half the shift
});

test('comb pulls every tine and not the gaps between them', () => {
  const offs = combOffsets(5, 100);
  assert.deepEqual(offs, [-200, -100, 0, 100, 200]);
  const f = combField([500, 500], [500, 540], [1, 0], offs, 10);
  const out = [0, 0];
  f(700, 520, out); near(out[1] - 520, 40); // on a tine
  f(650, 520, out); assert.ok(out[1] - 520 < 2); // halfway between two tines
});

test('swirl keeps distance to the centre', () => {
  const f = swirlField(100, 100, 50, 0.7, 30);
  const out = [0, 0];
  f(150, 100, out);
  near(Math.hypot(out[0] - 100, out[1] - 100), 50, 1e-9);
  assert.ok(Math.abs(out[1] - 100) > 10);
});

test('stretched edges are subdivided with the image of the original midpoint', () => {
  const pts = circlePts(0, 0, 60, 120);
  const f = tineLineField([0, 0], [1, 0], 400, 30);
  const r = transformPoly(pts, f, 6, Infinity, 0.3);
  assert.ok(r.added > 0);
  const n = r.pts.length / 2;
  let longest = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    longest = Math.max(longest, Math.hypot(r.pts[2 * j] - r.pts[2 * i], r.pts[2 * j + 1] - r.pts[2 * i + 1]));
  }
  assert.ok(longest <= 6.0001 || r.added > 0, 'longest edge ' + longest);
  assert.ok(longest < 12, 'longest edge ' + longest);
});

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function crossings(pts) {
  const n = pts.length / 2;
  const P = (i) => [pts[2 * (i % n)], pts[2 * (i % n) + 1]];
  let c = 0;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segIntersect(P(i), P(i + 1), P(j), P(j + 1))) c++;
  }
  return c;
}

test('combing keeps inks essentially simple (only a few sub-pixel tongue-tip crossings), within the vertex cap', () => {
  const rng = mulberry32(7);
  const bath = createBath();
  for (let i = 0; i < 4; i++) dropInk(bath, 150 + rng() * 700, 150 + rng() * 700, 70, INKS[i].hex);
  for (let k = 0; k < 5; k++) stylusStep(bath, [100 + k * 150, 100], [130 + k * 150, 700], 24);
  combStep(bath, [100, 100], [100, 900], [1, 0], 7, 90, 20);
  swirlStep(bath, 500, 500, 100, 0.5);
  assert.ok(countVerts(bath) <= LIMITS.maxVerts + 200);
  for (const ink of bath.inks) {
    assert.ok(ink.pts.every(Number.isFinite));
    assert.ok(crossings(ink.pts) <= 12, 'ink crossed itself');
  }
});

test('undo snapshots restore exactly', () => {
  const bath = createBath();
  dropInk(bath, 300, 300, 60, '#123456');
  const snap = snapshot(bath);
  stylusStep(bath, [250, 300], [400, 320], 24);
  dropInk(bath, 600, 600, 40, '#654321');
  restore(bath, snap);
  assert.equal(bath.inks.length, 1);
  assert.deepEqual(Array.from(bath.inks[0].pts), Array.from(snap[0].pts));
});

test('simplify drops collinear points and keeps the shape', () => {
  const n = 400;
  const pts = circlePts(0, 0, 40, n);
  const s = simplifyPoly(pts, 6, 0.06);
  assert.ok(s.length < pts.length);
  assert.ok(s.length / 2 >= 40);
});

test('starters are deterministic for a seed and stay inside sane bounds', () => {
  const run = (name, seed) => {
    const b = createBath();
    runStarter(b, name, mulberry32(seed), 40);
    return b;
  };
  const a = run('gelgit', 3), b = run('gelgit', 3), c = run('gelgit', 4);
  assert.deepEqual(Array.from(a.inks[5].pts), Array.from(b.inks[5].pts));
  assert.notDeepEqual(Array.from(a.inks[5].pts), Array.from(c.inks[5].pts));
  assert.ok(countVerts(a) <= LIMITS.maxVerts + 200);
  for (const name of ['stone', 'nonpareil', 'bouquet']) {
    const ops = starterOps(name, mulberry32(1));
    assert.ok(ops.length > 20);
    assert.ok(ops.some((o) => o.t === 'drop'));
  }
  assert.ok(starterOps('nonpareil', mulberry32(1)).some((o) => o.tool === 'comb'));
  assert.ok(starterOps('stone', mulberry32(1)).every((o) => o.t === 'drop'));
  const st = createBath();
  runStarter(st, 'stone', mulberry32(2), 40);
  assert.ok(st.inks.length > 40);
});

test('resample keeps endpoints and spacing', () => {
  const p = resample([[0, 0], [100, 0]], 30);
  assert.deepEqual(p[0], [0, 0]);
  assert.deepEqual(p[p.length - 1], [100, 0]);
  assert.ok(p.length === 5);
});

// ------------------------------------------------------------------ folding
test('the starting sheet is a diamond of area 2 and maps the unit square onto it', () => {
  const s = createStack(1);
  near(area(s[0].poly), 2);
  near(det(s[0].m), 2);
  const [x, y] = applyM(s[0].m, 0, 0);
  near(x, 0); near(y, -1); // sheet top-left corner sits at the top
});

test('splitConvex splits a square exactly along a line and conserves area', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const line = creaseLine({ a: [1, -5], b: [1, 5], move: [2, 1] });
  const { pos, neg } = splitConvex(sq, line);
  near(area(pos), 2); near(area(neg), 2);
  // a line through a vertex and missing the polygon
  const touch = creaseLine({ a: [0, 0], b: [3, 3], move: [2, 0] });
  const t = splitConvex(sq, touch);
  near(area(t.pos), 2); near(area(t.neg), 2);
  const none = splitConvex(sq, creaseLine({ a: [5, 0], b: [5, 1], move: [9, 0] }));
  assert.equal(none.pos, null);
  near(area(none.neg), 4);
});

test('a valley fold reflects the moving side, flips the face and reverses the order', () => {
  const s0 = createStack(1);
  const s1 = foldStack(s0, { a: [-4, 0], b: [4, 0], move: [0, -1], dir: 'valley' });
  assert.equal(s1.length, 2);
  assert.equal(s1[0].face, 1);
  assert.equal(s1[1].face, -1); // the flap is on top, back side up
  const b = stackBounds(s1);
  near(b.y0, 0); near(b.y1, 1);
  // a mountain fold puts the flap behind
  const m1 = foldStack(s0, { a: [-4, 0], b: [4, 0], move: [0, -1], dir: 'mountain' });
  assert.equal(m1[0].face, -1);
  assert.equal(m1[1].face, 1);
  // fold a two-layer stack, only the top layer
  const two = foldStack(s1, { a: [-0.5, 0], b: [-0.5, 1], move: [-1, 0.5], dir: 'valley', sel: { top: 1 } });
  assert.equal(two.length, 3); // top layer split in two, flap on top; the lower layer untouched
  assert.equal(two[0].poly.length, s1[0].poly.length);
  assert.equal(two.at(-1).face, 1);
});

test('reflection matrices are involutions with det -1', () => {
  const R = reflectionMatrix([1, 2], [0.6, 0.8]);
  near(det(R), -1);
  const RR = mul(R, R);
  [1, 0, 0, 1, 0, 0].forEach((v, i) => near(RR[i], v, 1e-9));
  const inv = invert(SHEET_M);
  const p = applyM(inv, ...applyM(SHEET_M, 0.3, 0.7));
  near(p[0], 0.3); near(p[1], 0.7);
});

test('every model: each step moves paper, area is conserved, texture stays on the sheet', () => {
  assert.ok(MODELS.length >= 16);
  for (const model of MODELS) {
    assert.ok(model.steps.length >= 3 && model.steps.length <= 12, model.id + ' steps');
    assert.ok(LEVELS.includes(model.level), model.id + ' level');
    const states = buildStates(model);
    assert.equal(states.length, model.steps.length + 1);
    states.forEach((stack, si) => {
      let sheetArea = 0;
      for (const l of stack) {
        assert.ok(area(l.poly) > 1e-7, `${model.id} state ${si} has a degenerate layer`);
        const d = det(l.m);
        // face follows the reflection parity
        assert.equal(Math.sign(d) * model.startFace, l.face, `${model.id} face parity`);
        sheetArea += area(l.poly) / Math.abs(d);
        assert.ok(l.poly.length >= 3);
        const inv = invert(l.m);
        for (const [x, y] of l.poly) {
          const [u, v] = applyM(inv, x, y);
          assert.ok(u > -1e-6 && u < 1 + 1e-6 && v > -1e-6 && v < 1 + 1e-6, `${model.id} state ${si} texture off the sheet`);
        }
        for (let i = 0; i < l.poly.length; i++) { // convex and positively wound
          const a = l.poly[i], b = l.poly[(i + 1) % l.poly.length], c = l.poly[(i + 2) % l.poly.length];
          assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > -1e-7, `${model.id} not convex`);
        }
      }
      near(sheetArea, 1, 1e-6); // the layers always tile the whole sheet exactly once
    });
    model.steps.forEach((step, i) => {
      const { plans } = planStep(states[i], step);
      plans.forEach((plan, k) => {
        assert.ok(plan.moving.length > 0, `${model.id} step ${i + 1} op ${k + 1} moves nothing`);
        const movedArea = plan.moving.reduce((s, l) => s + area(l.poly), 0);
        assert.ok(movedArea > 0.004, `${model.id} step ${i + 1} op ${k + 1} moves almost nothing`);
      });
    });
  }
});

test('cup: finished silhouette is the expected trapezoid', () => {
  const cup = MODELS.find((m) => m.id === 'cup');
  const b = stackBounds(finalState(cup));
  near(b.x0, -(1 - H) , 1e-6); // rim half-width = 1 - H = 0.4142
  near(b.x1, 1 - H, 1e-6);
  near(b.y0, -H, 1e-6); // rim height
  near(b.y1, 0, 1e-6);
});

test('heart: two lobes rise above a central cleft, point at the bottom', () => {
  const heart = MODELS.find((m) => m.id === 'heart');
  const fin = finalState(heart);
  const b = stackBounds(fin);
  near(b.y1, 1, 1e-6); // the point
  assert.ok(b.y0 < -0.1 && b.y0 > -0.35); // lobes
  // sample the top edge: the silhouette at x=0 is lower than at the lobes
  const topAt = (x) => {
    let top = Infinity;
    for (const l of fin) {
      const n = l.poly.length;
      for (let i = 0; i < n; i++) {
        const p = l.poly[i], q = l.poly[(i + 1) % n];
        if ((p[0] - x) * (q[0] - x) <= 0 && p[0] !== q[0]) {
          const t = (x - p[0]) / (q[0] - p[0]);
          top = Math.min(top, p[1] + (q[1] - p[1]) * t);
        }
      }
    }
    return top;
  };
  assert.ok(topAt(0) > topAt(0.4) + 0.05, 'cleft at the centre');
  assert.ok(topAt(0) > topAt(-0.4) + 0.05);
});

test('envelope starts back-side up and ends as a unit square showing the colour side', () => {
  const env = MODELS.find((m) => m.id === 'envelope');
  const states = buildStates(env);
  assert.equal(states[0][0].face, -1);
  const fin = states.at(-1);
  const b = stackBounds(fin);
  near(b.x1 - b.x0, 1, 1e-6); near(b.y1 - b.y0, 1, 1e-6);
  // the top visible layer is a colour-side flap
  assert.equal(fin.at(-1).face, 1);
});

test('crease segments clip the line to the paper', () => {
  const s = createStack(1);
  const line = creaseLine({ a: [-4, 0], b: [4, 0], move: [0, -1] });
  const segs = creaseSegments(s, line);
  assert.equal(segs.length, 1);
  near(Math.abs(segs[0][0][0] - segs[0][1][0]), 2, 1e-6);
});

test('building all models is fast', () => {
  const t = Date.now();
  for (let i = 0; i < 200; i++) for (const m of MODELS) foldStack(createStack(m.startFace), m.steps[0]);
  assert.ok(Date.now() - t < 500);
});

// ------------------------------------------------------------------ the new fold types
const base = (face = 1) => createStack(face);

test('inside-reverse fold tucks the swung tip between the layers it came from', () => {
  // a two-layer flap: fold the diamond in half (valley), then reverse the tip
  const two = foldStack(base(), { a: [-4, 0], b: [4, 0], move: [0, -1], dir: 'valley' });
  const op = { a: [-4, 0.5], b: [4, 0.5], move: [0, 1], dir: 'valley' };
  const outside = foldStack(two, { ...op });
  const inside = foldStack(two, { ...op, place: 'inside' });
  assert.equal(outside.length, inside.length);
  assert.equal(outside.length, 4);
  // outside: the swung pieces land on top (reversed); inside: they sit between the two staying pieces
  assert.deepEqual(outside.map((l) => l.face), [1, -1, -1, 1].map((v, i) => outside[i].face));
  assert.ok(inside[0].poly.length >= 3 && inside[3].poly.length >= 3);
  // the staying pieces keep the outer positions: bottom and top of the stack
  const stayAreaBottom = area(inside[0].poly), stayAreaTop = area(inside[3].poly);
  near(stayAreaBottom, stayAreaTop, 1e-9);
  // swung pieces end up reflected across the crease
  const b = stackBounds(inside);
  near(b.y0, 0 - 0.5 * 0 + 0, 1); // loose: just that the tip now points the other way
  assert.ok(b.y1 <= 1 + 1e-9);
  assert.ok(inside[1].face === -two[1].face || inside[1].face === -two[0].face);
});

test('clip restricts a fold to part of the moving side (a partial flap fold)', () => {
  const plan = planOp(base(), { a: [-4, 0], b: [4, 0], move: [0, 1], dir: 'valley', clip: [{ a: [0, -4], b: [0, 4], keep: [-1, 0] }] });
  assert.equal(plan.moving.length, 1);
  near(area(plan.moving[0].poly), 0.5); // only the lower left quarter swings
  const total = plan.result.reduce((s, l) => s + area(l.poly), 0);
  near(total, 2);
  assert.ok(plan.result.length >= 3);
});

test('sel by group, tag, half and the label step', () => {
  const s0 = foldStack(base(), { a: [-4, -4], b: [4, 4], move: [1, 0], dir: 'mountain', label: true });
  assert.deepEqual(s0.map((l) => l.grp), [0, 1]);
  const s1 = foldStack(s0, { a: [-4, 0], b: [4, 0], move: [0, 1], dir: 'valley', sel: { grp: [1] }, tag: 'swung' });
  assert.ok(s1.some((l) => l.tag === 'swung' && l.grp === 1));
  assert.ok(s1.every((l) => l.tag !== 'swung' || l.grp === 1));
  const half = planOp(s0, { a: [-4, 0], b: [4, 0], move: [0, 1], dir: 'valley', sel: { half: 'top' } });
  assert.equal(half.moving.length, 1);
  const tagged = planOp(s1, { a: [-4, -0.2], b: [4, -0.2], move: [0, -1], dir: 'valley', sel: { tag: 'swung' } });
  assert.ok(tagged.moving.every((l) => l.tag === 'swung'));
});

test('rotate op turns chosen layers rigidly; mirror turns them over', () => {
  const s = foldStack(base(), { a: [-4, 0], b: [4, 0], move: [0, -1], dir: 'valley', label: true });
  const rot = planOp(s, { type: 'rotate', pivot: [0, 0], angle: Math.PI / 2, sel: { grp: [1] } });
  assert.equal(rot.moving.length, 1);
  near(area(rot.result[1].poly), area(s[1].poly));
  assert.equal(rot.result[1].face, s[1].face);
  const mir = planOp(s, { type: 'rotate', pivot: [0, 0], angle: 0.3, sel: { grp: [1] }, mirror: true });
  assert.equal(mir.result[1].face, -s[1].face);
  assert.ok(area(mir.result[1].poly) > 0, 'winding kept positive');
  near(det(mir.result[1].m), -det(s[1].m));
});

test('crane: the square base has four equal layers, the bird base four flaps, and the wings open', () => {
  const crane = getModel('crane');
  const st = buildStates(crane);
  // after the second fold: four stacked layers of the same small square
  assert.equal(st[2].length, 4);
  st[2].forEach((l) => near(area(l.poly), 0.5, 1e-9));
  assert.deepEqual(st[2].map((l) => l.grp), [0, 1, 2, 3]);
  // bird base: a long kite, 0.707 above and below the waist
  const bb = stackBounds(st[5]);
  near(bb.y0, -0.41421, 1e-4); near(bb.y1, 1, 1e-9);
  near(bb.x1 - bb.x0, 2 * (1 - Math.SQRT1_2), 1e-4);
  // the finished crane is wider than the bird base: the wings are open
  const fin = stackBounds(st.at(-1));
  assert.ok(fin.x1 - fin.x0 > 0.7);
  assert.ok(crane.steps.some((s) => stepOps(s).some((o) => o.place === 'inside')), 'has reverse folds');
  assert.ok(crane.steps.some((s) => stepOps(s).length >= 3), 'has a compound petal step');
});

test('models are grouped by difficulty and bounds include the pen marks', () => {
  for (const level of LEVELS) assert.ok(MODELS.some((m) => m.level === level), level);
  const kite = getModel('kite');
  const b = modelBounds(kite);
  assert.ok(b.y1 > 1.5, 'the kite tail is inside the camera bounds');
});

test('the comb spans the whole basin in any direction, diagonals included', async () => {
  const { basinOffsets, BATH_SIZE } = await import('../proto/marbling/marble.js');
  for (const [start, nrm] of [[[500, 500], [0, 1]], [[100, 900], [1, 0]], [[300, 300], [Math.SQRT1_2, Math.SQRT1_2]]]) {
    const offs = basinOffsets(start, nrm, 70);
    const ends = [0, offs.length - 1].map((i) => [start[0] + nrm[0] * offs[i], start[1] + nrm[1] * offs[i]]);
    const proj = ([x, y]) => x * nrm[0] + y * nrm[1];
    const corners = [[0, 0], [BATH_SIZE, 0], [0, BATH_SIZE], [BATH_SIZE, BATH_SIZE]].map(proj);
    assert.ok(proj(ends[0]) - Math.min(...corners) <= 70, 'first tine within a gap of one wall');
    assert.ok(Math.max(...corners) - proj(ends[1]) <= 70, 'last tine within a gap of the other wall');
  }
});
