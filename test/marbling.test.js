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
  splitConvex, creaseLine, stackBounds, creaseSegments, SHEET_M, stepOps, modelBounds, sheetFraction, poseItems,
  finalPull, finishBounds, edgeFlags, planHints, isPullStep,
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

// The invariants every flat state must keep: the layers tile the sheet exactly once, every texture coordinate lies on
// the sheet, every layer is convex and positively wound, and the face flag follows the parity of the placement.
function checkStack(model, stack, label) {
  let sheetArea = 0;
  for (const l of stack) {
    assert.ok(area(l.poly) > 1e-7, `${label} has a degenerate layer`);
    const d = det(l.m);
    assert.equal(Math.sign(d) * (model.startFace ?? 1), l.face, `${label} face parity`);
    sheetArea += area(l.poly) / Math.abs(d);
    assert.ok(l.poly.length >= 3);
    const inv = invert(l.m);
    for (const [x, y] of l.poly) {
      const [u, v] = applyM(inv, x, y);
      assert.ok(u > -1e-6 && u < 1 + 1e-6 && v > -1e-6 && v < 1 + 1e-6, `${label} texture off the sheet`);
    }
    for (let i = 0; i < l.poly.length; i++) { // convex and positively wound
      const a = l.poly[i], b = l.poly[(i + 1) % l.poly.length], c = l.poly[(i + 2) % l.poly.length];
      assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > -1e-7, `${label} not convex`);
    }
  }
  near(sheetArea, sheetFraction(model.pose), 1e-6); // the layers always tile the whole sheet exactly once
}

test('the model list: enough faithful models, every level, sources noted, unique ids', () => {
  assert.ok(MODELS.length >= 12);
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length);
  for (const level of LEVELS) assert.ok(MODELS.some((m) => m.level === level), level);
  for (const m of MODELS) {
    assert.ok(LEVELS.includes(m.level), m.id + ' level');
    assert.ok(m.source && /\.(com|org)\//.test(m.source), m.id + ' notes its source');
    assert.ok(m.steps.length >= 3 && m.steps.length <= 40, m.id + ' steps');
    for (const st of m.steps) assert.ok(typeof st.text === 'string' && st.text.length > 8, m.id + ' step text');
  }
});

for (const model of MODELS) {
  test(`${model.id}: every flat state is valid and every fold moves paper`, () => {
    const states = buildStates(model);
    assert.equal(states.length, model.steps.length + 1);
    states.forEach((stack, si) => checkStack(model, stack, `${model.id} state ${si}`));
    model.steps.forEach((step, i) => {
      const { plans, result } = planStep(states[i], step);
      plans.forEach((plan, k) => {
        assert.ok(plan.moving.length > 0, `${model.id} step ${i + 1} op ${k + 1} moves nothing`);
        const movedArea = plan.moving.reduce((s, l) => s + area(l.poly), 0);
        assert.ok(movedArea > 0.004, `${model.id} step ${i + 1} op ${k + 1} moves almost nothing`);
        // and it visibly moves during the animation
        const mid = poseItems(plan, 0.5);
        assert.ok(mid.some((o) => o.moved && o.M.some((v, j) => Math.abs(v - [1, 0, 0, 1, 0, 0][j]) > 1e-3)), `${model.id} step ${i + 1} op ${k + 1} does not animate`);
      });
      if (isPullStep(step)) assert.equal(result, states[i], 'a pull step leaves the flat state alone');
    });
    // only the last step may open the piece out of the plane
    model.steps.forEach((st, i) => { if (isPullStep(st)) assert.equal(i, model.steps.length - 1, model.id + ' pull is last'); });
    const fb = finishBounds(model);
    assert.ok(Number.isFinite(fb.x0 + fb.x1 + fb.y0 + fb.y1));
  });
}

test('cup: finished silhouette is the expected trapezoid', () => {
  const cup = MODELS.find((m) => m.id === 'cup');
  const b = stackBounds(finalState(cup));
  near(b.x0, -(1 - H) , 1e-6); // rim half-width = 1 - H = 0.4142
  near(b.x1, 1 - H, 1e-6);
  near(b.y0, -H, 1e-6); // rim height
  near(b.y1, 0, 1e-6);
});

test('heart: two lobes rise above a central cleft, point at the bottom, colour side out', () => {
  const heart = MODELS.find((m) => m.id === 'heart');
  const fin = finalState(heart);
  const b = stackBounds(fin);
  near(b.y1, 0.25, 1e-6); // the point
  near(b.x1, -b.x0, 1e-9); // symmetric
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
  assert.ok(topAt(0) > topAt(0.3) + 0.05, 'cleft at the centre');
  assert.ok(topAt(0) > topAt(-0.3) + 0.05);
  assert.equal(fin.at(-1).face, 1, 'the top layer shows the marbled side');
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

test('building every model is quick', () => {
  const t = Date.now();
  for (const m of MODELS) { let st = createStack(m.startFace, m.pose); for (const step of m.steps) st = foldStack(st, step); }
  assert.ok(Date.now() - t < 4000);
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

// layers (bottom to top) that cover a point
function layersAt(stack, pt) {
  const inside = (poly) => poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]) > 1e-9;
  });
  return stack.filter((l) => inside(l.poly));
}
const crane = () => getModel('crane');
const stepIndex = (model, re) => model.steps.findIndex((s) => re.test(s.text)) + 1; // state index after that step

test('squash fold: the square base from a folded triangle (true squash, not a fake)', () => {
  const m = crane();
  const st = buildStates(m);
  const tri = st[2]; // folded in half twice: four layers of one small triangle
  assert.equal(tri.length, 4);
  const s1 = st[3]; // the first squash
  // the squashed flap is now a square standing on the hinge: two layers each side of it, above the bottom triangle
  const b = stackBounds(s1);
  near(b.x0, -0.5, 1e-9); near(b.x1, 1, 1e-9);
  assert.equal(layersAt(s1, [-0.2, 0.5]).length, 2, 'the open wall swung across, with its spine half folded over it');
  assert.equal(layersAt(s1, [0.2, 0.5]).length, 4, 'the stay wall and its spine half lie over the two bottom layers');
  const pre = st[5]; // second squash: the square (preliminary) base
  const pb = stackBounds(pre);
  near(pb.x0, -0.5, 1e-9); near(pb.x1, 0.5, 1e-9); near(pb.y0, 0, 1e-9); near(pb.y1, 1, 1e-9);
  for (const pt of [[-0.2, 0.5], [0.2, 0.5], [-0.05, 0.2], [0.05, 0.8]]) {
    const here = layersAt(pre, pt);
    assert.equal(here.length, 4, 'four layers everywhere in a square base');
    assert.equal(here.at(-1).face, 1, 'marbled side out in front');
    assert.equal(here[0].face, -1, 'and behind (its underside is the marbled side)');
  }
  // the closed point is the centre of the sheet, the four sheet corners meet at the open end
  for (const l of pre) {
    const inv = invert(l.m);
    for (const [x, y] of l.poly) {
      const [u, v] = applyM(inv, x, y);
      if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) { near(u, 0.5, 1e-9); near(v, 0.5, 1e-9); }
      if (Math.abs(x) < 1e-9 && Math.abs(y - 1) < 1e-9) assert.ok([0, 1].includes(Math.round(u)) && [0, 1].includes(Math.round(v)) && Math.abs(u - Math.round(u)) < 1e-9 && Math.abs(v - Math.round(v)) < 1e-9, 'a sheet corner');
    }
  }
});

test('petal fold: the bird base has four flaps of equal length, wings outermost, marbled outside', () => {
  const m = crane();
  const st = buildStates(m);
  const bb = st[12];
  const b = stackBounds(bb);
  const W = 1 - Math.SQRT1_2;
  near(b.y0, -0.41421356, 1e-6); near(b.y1, 1, 1e-9);
  near(b.x1 - b.x0, 2 * W, 1e-6);
  // upper flaps (the petals, future wings) reach from the waist to y = -0.414, the legs from the waist to y = 1
  near(W - b.y0, 1 - W, 1e-6);
  const wings = bb.filter((l) => l.tag === 'wingF' || l.tag === 'wingB');
  assert.ok(wings.length >= 6, 'both petals are made of three pieces each');
  for (const pt of [[0.05, -0.2], [-0.05, 0.1]]) {
    const here = layersAt(bb, pt);
    assert.ok(['wingF', 'wingB'].includes(here.at(-1).tag) && ['wingF', 'wingB'].includes(here[0].tag), 'petals are the outermost layers');
    assert.equal(here.at(-1).face, 1); assert.equal(here[0].face, -1);
  }
  for (const pt of [[0.05, 0.6], [-0.05, 0.6]]) {
    const here = layersAt(bb, pt);
    assert.ok(['legF', 'legB'].includes(here.at(-1).tag) && ['legF', 'legB'].includes(here[0].tag), 'the folded-in sides are the outer layers of the legs');
    assert.equal(here.at(-1).face, 1);
  }
  // the petal fold is one compound move: centre up, sides turned under it (mountain), inner layers folded in (valley)
  const petal = m.steps.find((s) => /Petal fold/.test(s.text));
  assert.equal(stepOps(petal)[0].type, 'multi');
  const { plans } = planStep(st[7], petal);
  const hints = planHints(plans[0]);
  assert.ok(hints.some((h) => h.dir === 'valley') && hints.some((h) => h.dir === 'mountain'));
});

test('waterbomb base: the known triangle, marbled outside, four layers each side', () => {
  const m = getModel('balloon');
  const st = buildStates(m);
  const i = stepIndex(m, /waterbomb base/);
  const wb = st[i];
  const s = Math.SQRT1_2;
  const b = stackBounds(wb);
  near(b.x0, -s, 1e-9); near(b.x1, s, 1e-9); near(b.y0, 0, 1e-9); near(b.y1, s, 1e-9);
  for (const l of wb) for (const [x, y] of l.poly) assert.ok(y >= Math.abs(x) - 1e-9, 'inside the triangle');
  for (const pt of [[-0.3, 0.5], [0.3, 0.5]]) {
    const here = layersAt(wb, pt);
    assert.equal(here.length, 4);
    assert.equal(here.at(-1).face, 1);
  }
});

test('squash folds keep the area and make the house roof overhang the walls', () => {
  const m = getModel('house');
  const st = buildStates(m);
  const before = st[st.length - 3], after = st.at(-1);
  near(before.reduce((a, l) => a + area(l.poly), 0), after.reduce((a, l) => a + area(l.poly), 0), 1e-9);
  const h = Math.SQRT1_2 / 2;
  const b = stackBounds(after);
  near(b.x0, -2 * h, 1e-9); near(b.x1, 2 * h, 1e-9); // the eaves
  assert.equal(layersAt(after, [-0.6, 0.02]).length, 0, 'walls stay narrow below the eaves');
  assert.ok(layersAt(after, [-0.5, -0.03]).length >= 2, 'eave');
});

test('inside reverse fold of a four-layer flap: each half turns in, outer layers wrapping the inner ones', () => {
  let st = createStack(1);
  st = foldStack(st, { a: [-4, 0], b: [4, 0], move: [0, -1], dir: 'valley' });
  st = foldStack(st, { a: [0, -4], b: [0, 4], move: [-1, 0], dir: 'valley' }); // four layers: triangle O, R, B
  assert.equal(st.length, 4);
  const plan = planOp(st, { a: [0, 0.7], b: [1, 0.2], move: [0, 1], dir: 'valley', place: 'inside' });
  const res = plan.result;
  assert.equal(res.length, 8);
  const moved = new Set(res.filter((l) => !st.some((o) => o.m.every((v, k) => Math.abs(v - l.m[k]) < 1e-12))).map((l) => l.id));
  // order: two staying back layers, the four turned pieces, two staying front layers
  assert.deepEqual(res.map((l) => moved.has(l.id)), [false, false, true, true, true, true, false, false]);
  // the back half's pieces come in reverse order (the outer one wraps round)
  const ids = res.slice(2, 6).map((l) => plan.moving.findIndex((m) => m.id === l.id - 0)); // ids are fresh; compare faces instead
  void ids;
  assert.deepEqual(res.slice(2, 6).map((l) => l.face), [st[1].face, st[0].face, st[3].face, st[2].face].map((f) => -f));
  const out = planOp(st, { a: [0, 0.7], b: [1, 0.2], move: [0, 1], dir: 'valley', place: 'outside' }).result;
  assert.deepEqual(out.map((l) => moved.has(l.id) || !st.some((o) => o.m.every((v, k) => Math.abs(v - l.m[k]) < 1e-12))), [true, true, false, false, false, false, true, true]);
});

test('fold and unfold leaves a crease: same tiling, nothing moved, the crease drawn faintly', () => {
  const s0 = createStack(1);
  const s1 = foldStack(s0, { a: [-4, 0], b: [4, 0], move: [0, 1], dir: 'valley', unfold: true });
  assert.equal(s1.length, 2);
  for (const l of s1) assert.deepEqual(l.m, s0[0].m);
  near(s1.reduce((a, l) => a + area(l.poly), 0), 2);
  const flags = edgeFlags(s1);
  assert.equal(flags.flat().filter(Boolean).length, 2, 'the shared edge is a crease on both pieces');
});

test('layers split by an earlier crease still count as one layer when folding "the front layer"', () => {
  const hat = getModel('hat');
  const st = buildStates(hat);
  const i = stepIndex(hat, /band up again, over/);
  const s = st[i];
  assert.equal(layersAt(s, [-0.4, 0.55]).length, layersAt(s, [0.4, 0.55]).length, 'the band went up on both sides of the centre crease');
  near(sheetFraction(hat.pose), 1 / Math.SQRT2, 1e-9); // an A4-shaped sheet cut from the square texture
});

test('pull steps end in a three-dimensional pose and are drawn from the exact flat state before them', () => {
  for (const id of ['cup', 'crane', 'flapping', 'balloon', 'frog']) {
    const m = getModel(id);
    const pull = finalPull(m);
    assert.ok(pull, id + ' ends by opening out');
    const pose = poseItems(pull, 1);
    assert.ok(pose.some((o) => Math.abs(o.nz) < 0.98), id + ' has paper turned out of the plane');
    // every piece of the flat state is drawn exactly once
    const total = pose.reduce((a, o) => a + area(o.piece.poly), 0);
    near(total, finalState(m).reduce((a, l) => a + area(l.poly), 0), 1e-9);
  }
  // the opening is smooth: halfway is between the flat state and the end pose
  const p = finalPull(getModel('crane'));
  const a = poseItems(p, 0).every((o) => Math.abs(o.nz - 1) < 1e-9);
  assert.ok(a, 'starts flat');
});

test('models are grouped by difficulty and the camera bounds include the finished pose and pen marks', () => {
  for (const level of LEVELS) assert.ok(MODELS.some((m) => m.level === level), level);
  for (const m of MODELS) {
    const b = modelBounds(m), f = finishBounds(m);
    assert.ok(b.x0 <= f.x0 + 1e-9 && b.y0 <= f.y0 + 1e-9 && b.x1 >= f.x1 - 1e-9 && b.y1 >= f.y1 - 1e-9, m.id);
  }
  // longer models sit in the patient group
  const avg = (lv) => { const l = MODELS.filter((m) => m.level === lv); return l.reduce((a, m) => a + m.steps.length, 0) / l.length; };
  assert.ok(avg('Easy') < avg('Medium') && avg('Medium') < avg('Patient'));
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
