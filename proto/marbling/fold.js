// fold.js - flat-folding engine. PURE: no DOM, no randomness. (Model definitions live in models.js.)
//
// The paper is a stack of flat convex polygon layers (index 0 = bottom, last = top). Each layer is
//   { id, poly: [[x,y]...] (world, positive area), m: affine sheet-unit -> world, face: +1 front / -1 back,
//     grp: label used to pick layers later, tag: optional label set by a step }
// "Front" is the marbled side. World units are "diamond units": the sheet half-diagonal is 1, its side is sqrt(2).
// An affine is [a, b, c, d, e, f] with x' = a x + c y + e, y' = b x + d y + f (the canvas convention).
//
// A step is { text, ops: [op, ...], label? } (or a single op written inline). Ops run one after another
// (a petal fold is three of them); the UI animates them in sequence.
//
//   fold op   { a, b, move, dir:'valley'|'mountain', sel, clip, place, tag }
//       crease through a and b; the side holding `move` swings over.
//       sel:   'all' | {top:n} | {bottom:n} | {half:'top'|'bottom'} | {grp:[..]} | {tag:'..'} | combined, among
//              the layers that actually reach the moving side.
//       clip:  [{a,b,keep}] extra lines: only the part of the moving side that is also on the `keep` side moves
//              (a partial fold of a flap: the rest of the layer stays where it is).
//       place: 'inside' tucks the swung pieces between the layers they came from (inside-reverse fold).
//              Without it a valley fold lands them on top (reversed), a mountain fold behind. Valley with every
//              layer of a flap selected is an outside-reverse fold.
//       tag:   label put on the swung pieces (so a later op can pick them with sel:{tag}).
//   rotate op { type:'rotate', pivot, angle, sel, move, mirror? }  rigid turn of the chosen layers about a point (used to
//       spread the wings of a finished bird); mirror also turns them over, so both wings show their colour.
//   step.label: after the step, give every layer grp = its position in the stack.

export const EPS = 1e-7;
export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const SHEET_M = [1, 1, -1, 1, 0, -1]; // diamond pose: unit square -> world (x = u - v, y = u + v - 1)
const R2 = Math.SQRT2;
export const SQUARE_M = [R2, 0, 0, R2, -R2 / 2, -R2 / 2]; // upright square pose

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
export function rotationMatrix(pivot, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, -s, c, pivot[0] - (c * pivot[0] - s * pivot[1]), pivot[1] - (s * pivot[0] + c * pivot[1])];
}
export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// ---------------------------------------------------------------- the sheet
export function createStack(startFace = 1, pose = 'diamond') {
  if (pose === 'square') {
    const s = R2 / 2;
    return [{ id: 0, poly: [[-s, -s], [s, -s], [s, s], [-s, s]], m: SQUARE_M.slice(), face: startFace, grp: 0 }];
  }
  return [{ id: 0, poly: [[0, -1], [1, 0], [0, 1], [-1, 0]], m: SHEET_M.slice(), face: startFace, grp: 0 }];
}

// ---------------------------------------------------------------- lines and splitting
export function creaseLine(op) {
  const dx = op.b[0] - op.a[0], dy = op.b[1] - op.a[1];
  const l = Math.hypot(dx, dy);
  let n = [-dy / l, dx / l];
  if ((op.move[0] - op.a[0]) * n[0] + (op.move[1] - op.a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { p: op.a.slice(), n, u: [-n[1], n[0]] };
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

// Sutherland-Hodgman against one side of the line (sign +1 keeps the moving side, -1 the staying side).
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

// moving part = moving side of the crease AND inside every clip line; everything else stays.
function partition(poly, line, clips) {
  const { pos, neg } = splitConvex(poly, line);
  const rest = [];
  if (neg) rest.push(neg);
  let mov = pos;
  if (pos) {
    for (const c of clips) {
      if (!mov) break;
      const inn = clipSide(mov, c, 1), out = clipSide(mov, c, -1);
      if (out) rest.push(out);
      mov = inn;
    }
  }
  return { mov, rest };
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

function pick(reach, stack, sel) {
  if (!sel || sel === 'all') return reach;
  let r = reach;
  if (sel.grp) r = r.filter((i) => sel.grp.includes(stack[i].grp));
  if (sel.tag) r = r.filter((i) => stack[i].tag === sel.tag);
  if (sel.top) r = r.slice(-sel.top);
  if (sel.bottom) r = r.slice(0, sel.bottom);
  if (sel.half === 'top') r = r.slice(Math.ceil(r.length / 2));
  if (sel.half === 'bottom') r = r.slice(0, Math.ceil(r.length / 2));
  return r;
}

// ---------------------------------------------------------------- one op
function planFoldOp(stack, op) {
  const line = creaseLine(op);
  const clips = (op.clip || []).map((c) => creaseLine({ a: c.a, b: c.b, move: c.keep }));
  const parts = stack.map((l) => partition(l.poly, line, clips));
  const reach = [];
  parts.forEach((p, i) => { if (p.mov) reach.push(i); });
  const chosen = new Set(pick(reach, stack, op.sel));
  const stay = [], moving = [];
  let lowestStay = -1;
  for (let i = 0; i < stack.length; i++) {
    const l = stack[i];
    if (!chosen.has(i)) { stay.push(l); continue; }
    if (parts[i].mov) moving.push({ ...l, poly: parts[i].mov });
    for (const r of parts[i].rest) { stay.push({ ...l, poly: r }); if (lowestStay < 0) lowestStay = stay.length - 1; }
  }
  const R = reflectionMatrix(line.p, line.n);
  let nextId = 1 + stack.reduce((m, l) => Math.max(m, l.id), 0);
  const flipped = moving.map((l) => {
    const n = { ...l, id: nextId++, poly: reflectPoly(l.poly, R), m: mul(R, l.m), face: -l.face };
    if (op.tag) n.tag = op.tag;
    return n;
  });
  let result;
  if (op.place === 'inside' && lowestStay >= 0) {
    result = stay.slice(0, lowestStay + 1).concat(flipped, stay.slice(lowestStay + 1)); // tucked between its own layers
  } else if (op.dir === 'mountain') {
    result = flipped.slice().reverse().concat(stay);
  } else {
    result = stay.concat(flipped.slice().reverse());
  }
  return { kind: 'fold', line, stay, moving, result, R, dir: op.dir === 'mountain' ? 'mountain' : 'valley', place: op.place || null, landing: (pt) => reflectPoint(pt, line) };
}

function planRotateOp(stack, op) {
  const reach = stack.map((_, i) => i);
  const chosen = new Set(pick(reach, stack, op.sel));
  let Rm = rotationMatrix(op.pivot, op.angle);
  if (op.mirror) Rm = mul(Rm, reflectionMatrix(op.pivot, [1, 0])); // turn the layer over (about the vertical line through the pivot), then rotate
  const flips = det(Rm) < 0;
  const stay = [], moving = [];
  const result = stack.map((l, i) => {
    if (!chosen.has(i)) { stay.push(l); return l; }
    moving.push(l);
    const poly = l.poly.map(([x, y]) => applyM(Rm, x, y));
    if (flips) poly.reverse();
    return { ...l, poly, m: mul(Rm, l.m), face: flips ? -l.face : l.face };
  });
  return { kind: 'rotate', mirror: !!op.mirror, pivot: op.pivot, angle: op.angle, stay, moving, result, Rm, dir: 'valley', landing: (pt) => applyM(Rm, pt[0], pt[1]) };
}

export function planOp(stack, op) { return op.type === 'rotate' ? planRotateOp(stack, op) : planFoldOp(stack, op); }
export function stepOps(step) { return step.ops || [step]; }

export function planStep(stack, step) {
  const plans = [];
  let cur = stack;
  for (const op of stepOps(step)) {
    const p = planOp(cur, op);
    p.before = cur;
    plans.push(p);
    cur = p.result;
  }
  if (step.label) cur = cur.map((l, i) => ({ ...l, grp: i }));
  return { plans, result: cur };
}
export function foldStack(stack, step) { return planStep(stack, step).result; }

// ---------------------------------------------------------------- states
const stateCache = new Map();

// states[0] is the flat sheet; states[i] is after step i.
export function buildStates(model) {
  if (stateCache.has(model.id)) return stateCache.get(model.id);
  const states = [createStack(model.startFace ?? 1, model.pose || 'diamond')];
  for (const step of model.steps) states.push(planStep(states[states.length - 1], step).result);
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

export function decorBounds(shapes) {
  let b = null;
  const add = (x, y, r = 0) => {
    b = b ? { x0: Math.min(b.x0, x - r), y0: Math.min(b.y0, y - r), x1: Math.max(b.x1, x + r), y1: Math.max(b.y1, y + r) } : { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  };
  for (const s of shapes || []) {
    if (s.t === 'dot') add(s.x, s.y, s.r);
    else if (s.t === 'ellipse') add(s.x, s.y, Math.max(s.rx, s.ry));
    else for (const p of s.pts) add(p[0], p[1], (s.w || 0) / 2);
  }
  return b;
}

export function modelDecor(model, stack) {
  return typeof model.decor === 'function' ? model.decor(stack) : model.decor || [];
}

export function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function modelBounds(model) { // union over every state (and the decoration), so the camera never moves mid-fold
  let b = null;
  for (const s of buildStates(model)) b = unionBounds(b, stackBounds(s));
  return unionBounds(b, decorBounds(modelDecor(model, finalState(model))));
}

// Segments of a crease line that lie on the paper (for drawing the dashed line).
export function creaseSegments(stack, line) {
  const segs = [];
  for (const l of stack) {
    let t0 = -1e9, t1 = 1e9;
    const n = l.poly.length;
    for (let i = 0; i < n; i++) {
      const a = l.poly[i], b = l.poly[(i + 1) % n];
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
