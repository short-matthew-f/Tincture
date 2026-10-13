// fold.js - flat-folding geometry and origami model definitions. PURE: no DOM, no randomness.
//
// The paper is a stack of flat convex polygon layers (index 0 = bottom, last = top). Each layer is
//   { id, poly: [[x,y]...] (world, positive area), m: affine sheet-unit -> world, face: +1 front / -1 back }
// "Front" is the marbled side. World units are "diamond units": the sheet is laid corner-up, so its
// half-diagonal is 1 and its side is sqrt(2); the unit square (u,v) maps to world x = u - v, y = u + v - 1.
//
// An affine is [a, b, c, d, e, f] with x' = a x + c y + e, y' = b x + d y + f (the canvas convention).

export const EPS = 1e-7;
export const H = 2 / (2 + Math.SQRT2); // cup rim height used below

export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const SHEET_M = [1, 1, -1, 1, 0, -1];

export function mul(A, B) { // apply B first, then A
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
export function applyM(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }
export function det(M) { return M[0] * M[3] - M[1] * M[2]; }
export function invert(M) {
  const d = det(M);
  const a = M[3] / d, b = -M[1] / d, c = -M[2] / d, dd = M[0] / d;
  return [a, b, c, dd, -(a * M[4] + c * M[5]), -(b * M[4] + dd * M[5])];
}

export function reflectionMatrix(p, n) {
  const k = 2 * (p[0] * n[0] + p[1] * n[1]);
  return [1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[1], 1 - 2 * n[1] * n[1], k * n[0], k * n[1]];
}

export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// ---------------------------------------------------------------- creating the sheet
export function createStack(startFace = 1) {
  return [{ id: 0, poly: [[0, -1], [1, 0], [0, 1], [-1, 0]], m: SHEET_M.slice(), face: startFace }];
}

// ---------------------------------------------------------------- lines and splitting
// step: { a:[x,y], b:[x,y], move:[x,y] } - a crease through a and b; the side holding `move` swings over.
export function creaseLine(step) {
  const dx = step.b[0] - step.a[0], dy = step.b[1] - step.a[1];
  const l = Math.hypot(dx, dy);
  let n = [-dy / l, dx / l];
  if ((step.move[0] - step.a[0]) * n[0] + (step.move[1] - step.a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { p: step.a.slice(), n, u: [-n[1], n[0]] };
}

export function signedDist(line, pt) { return (pt[0] - line.p[0]) * line.n[0] + (pt[1] - line.p[1]) * line.n[1]; }

function cleanPoly(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

// Sutherland-Hodgman against one side of the line (sign = +1 keeps the moving side, -1 the staying side).
export function clipSide(poly, line, sign) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let da = sign * signedDist(line, a), db = sign * signedDist(line, b);
    if (Math.abs(da) < 1e-10) da = 0;
    if (Math.abs(db) < 1e-10) db = 0;
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const c = cleanPoly(out);
  return c.length >= 3 && Math.abs(area(c)) > 1e-8 ? c : null;
}

export function splitConvex(poly, line) {
  return { pos: clipSide(poly, line, 1), neg: clipSide(poly, line, -1) };
}

function reflectPoly(poly, R) {
  const out = poly.map(([x, y]) => applyM(R, x, y));
  out.reverse(); // reflection flips orientation; keep area positive
  return out;
}

export function reflectPoint(pt, line) {
  const d = signedDist(line, pt);
  return [pt[0] - 2 * d * line.n[0], pt[1] - 2 * d * line.n[1]];
}

// ---------------------------------------------------------------- folding
// step.dir: 'valley' (flap lands on top) | 'mountain' (flap goes behind)
// step.sel: 'all' (default) | { top: n } | { bottom: n } - among the layers that reach the moving side.
export function planFold(stack, step) {
  const line = creaseLine(step);
  const reach = [];
  stack.forEach((l, i) => {
    let mx = -Infinity;
    for (const p of l.poly) mx = Math.max(mx, signedDist(line, p));
    if (mx > EPS) reach.push(i);
  });
  const sel = step.sel || 'all';
  let chosen = reach;
  if (sel.top) chosen = reach.slice(-sel.top);
  else if (sel.bottom) chosen = reach.slice(0, sel.bottom);
  const set = new Set(chosen);
  const stay = [], moving = [];
  for (let i = 0; i < stack.length; i++) {
    const l = stack[i];
    if (!set.has(i)) { stay.push(l); continue; }
    const { pos, neg } = splitConvex(l.poly, line);
    if (pos) moving.push({ ...l, poly: pos });
    if (neg) stay.push({ ...l, poly: neg });
  }
  const R = reflectionMatrix(line.p, line.n);
  let nextId = 1 + stack.reduce((m, l) => Math.max(m, l.id), 0);
  const flipped = moving.map((l) => ({ id: nextId++, poly: reflectPoly(l.poly, R), m: mul(R, l.m), face: -l.face }));
  flipped.reverse();
  const result = step.dir === 'mountain' ? flipped.concat(stay) : stay.concat(flipped);
  return { line, stay, moving, result, R, dir: step.dir === 'mountain' ? 'mountain' : 'valley' };
}

export function foldStack(stack, step) { return planFold(stack, step).result; }

// ---------------------------------------------------------------- helpers for describing models
function bis(P, Q) { // crease that lands P on Q
  const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
  const dx = -(Q[1] - P[1]), dy = Q[0] - P[0];
  const l = Math.hypot(dx, dy);
  return { a: [mx - (dx / l) * 4, my - (dy / l) * 4], b: [mx + (dx / l) * 4, my + (dy / l) * 4], move: P };
}
function horiz(y, move) { return { a: [-4, y], b: [4, y], move }; }
function through(a, b, move) { return { a, b, move }; }
function refl(P, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const n = [-dy / l, dx / l];
  const d = (P[0] - a[0]) * n[0] + (P[1] - a[1]) * n[1];
  return [P[0] - 2 * d * n[0], P[1] - 2 * d * n[1]];
}
function toward(from, to, dist) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const l = Math.hypot(dx, dy);
  return [from[0] + (dx / l) * dist, from[1] + (dy / l) * dist];
}
const B_PT = [0, 1];
const T_PT = [0, -1];
const L_PT = [-1, 0];
const R_PT = [1, 0];
const O_PT = [0, 0];

// the sheet is folded in half into a triangle with its point at the bottom (base on top)
const triDown = () => ({ ...horiz(0, T_PT), dir: 'mountain', text: 'Fold the top point down and behind, to meet the bottom point.' });

// "wings": fold both side points across the middle from creases at x = -+a (point at B)
function wings(a, textL, textR) {
  return [
    { ...through([-a, 0], B_PT, L_PT), dir: 'valley', text: textL },
    { ...through([a, 0], B_PT, R_PT), dir: 'valley', sel: { bottom: 2 }, text: textR },
  ];
}

function chamfer(tip, p, q, k) { // fold a small corner behind: crease between points k from the tip along each edge
  const a = toward(tip, p, k), b = toward(tip, q, k);
  return { a, b, move: tip };
}

function heartSteps() {
  const A1 = [-0.15, 0], A2 = [0.15, 0];
  const tipR = refl(L_PT, A1, B_PT); // the left wing's point lands on the right side, up high
  const tipL = refl(R_PT, A2, B_PT);
  return [
    triDown(),
    ...wings(0.15, 'Fold the left point across, along a crease from near the middle down to the bottom point.', 'Now the right point, the same way. It lands over the first.'),
    { ...chamfer(tipR, A1, B_PT, 0.26), dir: 'mountain', text: 'Tuck the tip of the right lobe behind to round it.' },
    { ...chamfer(tipL, A2, B_PT, 0.26), dir: 'mountain', text: 'Tuck the other lobe behind too.' },
  ];
}

function cupSteps() {
  const Ql = [H - 1, -H], Qr = [1 - H, -H];
  return [
    { ...horiz(0, B_PT), dir: 'mountain', text: 'Fold the bottom point up and behind, to meet the top point.' },
    { ...bis(L_PT, Qr), dir: 'valley', text: 'Fold the left point across so it just touches the right edge.' },
    { ...bis(R_PT, Ql), dir: 'valley', text: 'Fold the right point across so it just touches the left edge.' },
    { ...horiz(-H, T_PT), dir: 'valley', sel: { top: 1 }, text: 'Fold the front point down to make the cup\'s lip.' },
    { ...horiz(-H, T_PT), dir: 'mountain', sel: { bottom: 1 }, text: 'Turn it and fold the back point down the same way.' },
  ];
}

function tulipSteps() {
  return [
    triDown(),
    ...wings(0.6, 'Fold the left point across from a wide crease. It becomes a petal.', 'Fold the right point across for the second petal.'),
    { ...horiz(0.325, B_PT), dir: 'valley', text: 'Fold the bottom point up. This is the third petal.' },
  ];
}

function foxSteps() {
  return [
    triDown(),
    ...wings(0.45, 'Fold the left point across to make an ear.', 'Fold the right point across for the other ear.'),
    { ...horiz(0.78, B_PT), dir: 'valley', text: 'Tip the chin up to show a pale muzzle.' },
  ];
}

function catSteps() {
  return [
    triDown(),
    ...wings(0.55, 'Fold the left point across to make an ear.', 'Fold the right point across for the other ear.'),
    { ...horiz(0.62, B_PT), dir: 'valley', text: 'Tip the chin up for a small muzzle.' },
  ];
}

function envelopeSteps() {
  return [
    { ...bis(L_PT, O_PT), dir: 'valley', text: 'The colour side is face down. Fold the left point to the middle.' },
    { ...bis(R_PT, O_PT), dir: 'valley', text: 'Fold the right point to the middle.' },
    { ...bis(B_PT, O_PT), dir: 'valley', text: 'Fold the bottom point up to the middle.' },
    { ...bis(T_PT, O_PT), dir: 'valley', text: 'Close the flap: the top point comes down to the middle.' },
  ];
}

export const MODELS = [
  { id: 'cup', name: 'Cup', blurb: 'A little drinking cup for the studio.', startFace: 1, steps: cupSteps() },
  { id: 'heart', name: 'Heart', blurb: 'Two lobes and a point, from three folds.', startFace: 1, steps: heartSteps() },
  { id: 'tulip', name: 'Tulip', blurb: 'A flower head with three petals.', startFace: 1, steps: tulipSteps() },
  { id: 'fox', name: 'Fox face', blurb: 'Tall ears and a pale chin.', startFace: 1, steps: foxSteps() },
  { id: 'cat', name: 'Cat face', blurb: 'Round-cheeked, with two small ears.', startFace: 1, steps: catSteps() },
  { id: 'envelope', name: 'Envelope', blurb: 'Folded colour-side in, so the patterns meet in the middle.', startFace: -1, steps: envelopeSteps() },
];

export function getModel(id) { return MODELS.find((m) => m.id === id) || null; }

const stateCache = new Map();

// states[0] is the flat sheet; states[i] is after step i.
export function buildStates(model) {
  if (stateCache.has(model.id)) return stateCache.get(model.id);
  const states = [createStack(model.startFace)];
  for (const step of model.steps) states.push(foldStack(states[states.length - 1], step));
  stateCache.set(model.id, states);
  return states;
}

export function finalState(model) {
  const s = buildStates(model);
  return s[s.length - 1];
}

export function stackBounds(stack) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of stack) for (const [x, y] of l.poly) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function modelBounds(model) { // union over every state, so the camera never has to move mid-fold
  let b = null;
  for (const s of buildStates(model)) {
    const q = stackBounds(s);
    b = b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : q;
  }
  return b;
}

// Segments of a crease line that lie on the paper (for drawing the dashed line).
export function creaseSegments(stack, line) {
  const segs = [];
  for (const l of stack) {
    let t0 = -1e9, t1 = 1e9;
    const n = l.poly.length;
    for (let i = 0; i < n; i++) {
      const a = l.poly[i], b = l.poly[(i + 1) % n];
      // polygon is positively oriented: inside is where cross(b-a, p-a) >= 0
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const c0 = ex * (line.p[1] - a[1]) - ey * (line.p[0] - a[0]);
      const cd = ex * line.u[1] - ey * line.u[0];
      if (Math.abs(cd) < 1e-12) { if (c0 < 0) { t0 = 1; t1 = 0; } continue; }
      const t = -c0 / cd;
      if (cd > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    if (t1 - t0 > 1e-6) segs.push([[line.p[0] + line.u[0] * t0, line.p[1] + line.u[1] * t0], [line.p[0] + line.u[0] * t1, line.p[1] + line.u[1] * t1]]);
  }
  return segs;
}
