// fold.js - flat-folding engine with a rigid 3D animation model. PURE: no DOM, no randomness.
// (Model definitions live in models.js.)
//
// The paper is a stack of flat convex polygon layers (index 0 = bottom, last = top). Each layer is
//   { id, poly: [[x,y]...] (world, positive area), m: affine sheet-unit -> world, face: +1 front / -1 back,
//     grp: label used to pick layers later, tag: optional label set by a step }
// "Front" is the marbled side. World units: the square sheet's half-diagonal is 1 (side sqrt 2).
// An affine is [a, b, c, d, e, f] with x' = a x + c y + e, y' = b x + d y + f (the canvas convention).
//
// A step is { text, ops: [op, ...], label?, arrow?, pull? } (or a single op written inline). Ops run one after another.
//
//   fold op   { a, b, move, dir:'valley'|'mountain', sel, clip, place, tag, unfold }
//       crease through a and b; the side holding `move` swings over.
//       sel:   'all' | {top:n} | {bottom:n} | {half:'top'|'bottom'} | {grp:[..]} | {tag:'..'} | combined, among
//              the layers that actually reach the moving side.
//       clip:  [{a,b,keep}] extra lines: only the part of the moving side that is also on the `keep` side moves.
//       place: 'inside'  inside-reverse fold: the chosen layers split into a back half and a front half and each
//                        half's tip turns in between them (the outer layer wraps round the inner one).
//              'outside' outside-reverse fold: each half's tip wraps round the outside of the flap.
//              Without it a valley fold lands the pieces on top (reversed), a mountain fold behind.
//       unfold: true      fold and unfold again: only the crease stays (a pre-crease).
//       tag:   label put on the swung pieces (so a later op can pick them with sel:{tag}).
//   multi op  { type:'multi', parts:[part...] }  several regions move at once, each by its own chain of hinges.
//       This is how squash folds, petal folds and collapses are made (see the helpers in models.js).
//       part = { sel, region:[{a,b,keep}], chain:[joint...], z:'top'|'bottom'|number, zo, rev, tag }
//         region: half-planes; the part takes (layer ∩ region) from every selected layer that reaches it.
//         chain:  joints from the piece's own hinge (first) out to the root hinge (last), every line given in the
//                 coordinates before the op. joint = { a, b, up=true, keys=[[0,0],[1,180]], flat, rigid, n }
//                 keys: hinge angle (degrees) over the op's progress; 180 = folded flat over, 0 = unchanged.
//                 up: the piece rises toward the viewer (valley) or dips away (mountain), in its parent's frame.
//                 flat: the motion stays in the plane (used inside reverse folds). rigid: the whole piece turns,
//                 whichever side of the line it is on (turning the paper over); n gives the "up" side then.
//         z/zo:   where the moved pieces go in the stack: on top, at the bottom, or at a layer index (2.5 = between
//                 layers 2 and 3 of the stack before the op). Pieces of a part keep their order, reversed if the
//                 part's net motion turns them over (override with rev).
//   turn op   { type:'turn' }  turn the paper over (left to right).
//   rotate op { type:'rotate', pivot, angle, sel, mirror? }  rigid turn of the chosen layers in the plane.
//   pull op   { type:'pull', parts:[...] }  like multi, but the end pose is three-dimensional (a cup opening, wings
//             spreading, a balloon filling). The flat stack does not change; the pose is drawn on top of it.
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
export function centroid(poly) {
  let cx = 0, cy = 0, s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const k = a[0] * b[1] - b[0] * a[1];
    s += k; cx += (a[0] + b[0]) * k; cy += (a[1] + b[1]) * k;
  }
  if (Math.abs(s) < 1e-12) return poly[0].slice();
  return [cx / (3 * s), cy / (3 * s)];
}

// ---------------------------------------------------------------- the sheet
// pose: 'diamond' | 'square' | { w, h } (a rectangle, world size, upright). The marbled texture keeps its proportions:
// the unit texture square maps onto a square that covers the sheet.
export function poseInfo(pose = 'diamond') {
  if (pose === 'square') { const s = R2 / 2; return { poly: [[-s, -s], [s, -s], [s, s], [-s, s]], m: SQUARE_M.slice() }; }
  if (pose && typeof pose === 'object') {
    const w = pose.w / 2, h = pose.h / 2, S = Math.max(pose.w, pose.h);
    return { poly: [[-w, -h], [w, -h], [w, h], [-w, h]], m: [S, 0, 0, S, -S / 2, -S / 2] };
  }
  return { poly: [[0, -1], [1, 0], [0, 1], [-1, 0]], m: SHEET_M.slice() };
}
export function createStack(startFace = 1, pose = 'diamond') {
  const p = poseInfo(pose);
  return [{ id: 0, poly: p.poly, m: p.m, face: startFace, grp: 0 }];
}
// fraction of the texture square that the sheet covers (1 for squares)
export function sheetFraction(pose) { const p = poseInfo(pose); return area(p.poly) / Math.abs(det(p.m)); }

// ---------------------------------------------------------------- lines and splitting
export function creaseLine(op) {
  const dx = op.b[0] - op.a[0], dy = op.b[1] - op.a[1];
  const l = Math.hypot(dx, dy);
  let n = [-dy / l, dx / l];
  if (op.move && (op.move[0] - op.a[0]) * n[0] + (op.move[1] - op.a[1]) * n[1] < 0) n = [-n[0], -n[1]];
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
  // drop collinear points so later tests see clean convex polygons
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-11) { out.splice(i, 1); changed = true; break; }
    }
  }
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

// poly ∩ every half-plane (inside) and the rest of poly as convex pieces (outside)
function cutRegion(poly, lines) {
  const outside = [];
  let inn = poly;
  for (const l of lines) {
    if (!inn) break;
    const o = clipSide(inn, l, -1);
    if (o) outside.push(o);
    inn = clipSide(inn, l, 1);
  }
  return { inside: inn, outside };
}

// moving part = moving side of the crease AND inside every clip line; everything else stays.
function partition(poly, line, clips) {
  const { pos, neg } = splitConvex(poly, line);
  const rest = [];
  if (neg) rest.push(neg);
  let mov = pos;
  if (pos) {
    const r = cutRegion(pos, clips);
    mov = r.inside;
    rest.push(...r.outside);
  }
  return { mov, rest };
}

function transformPoly(poly, M) {
  const out = poly.map(([x, y]) => applyM(M, x, y));
  if (det(M) < 0) out.reverse(); // a reflection flips orientation; keep the area positive
  return out;
}
export function reflectPoint(pt, line) {
  const d = signedDist(line, pt);
  return [pt[0] - 2 * d * line.n[0], pt[1] - 2 * d * line.n[1]];
}

// Pieces cut from one layer by earlier creases still lie flat together; counting "layers" (top:n and so on) treats
// pieces that share the same placement as one layer.
function mKey(l) { return l.face + ':' + l.m.map((v) => Math.round(v * 1e6)).join(','); }
function pick(reach, stack, sel) {
  if (!sel || sel === 'all') return reach;
  let r = reach;
  if (sel.grp) r = r.filter((i) => sel.grp.includes(stack[i].grp));
  if (sel.tag) r = r.filter((i) => (Array.isArray(sel.tag) ? sel.tag.includes(stack[i].tag) : stack[i].tag === sel.tag));
  if (sel.notTag) r = r.filter((i) => (Array.isArray(sel.notTag) ? !sel.notTag.includes(stack[i].tag) : stack[i].tag !== sel.notTag));
  if (!(sel.top || sel.bottom || sel.skipTop || sel.half)) return r;
  const groups = new Map();
  for (const i of r) { const k = mKey(stack[i]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  let g = [...groups.values()].sort((a, b) => Math.max(...a) - Math.max(...b));
  if (sel.top) g = g.slice(-sel.top);
  if (sel.bottom) g = g.slice(0, sel.bottom);
  if (sel.skipTop) g = g.slice(0, Math.max(0, g.length - sel.skipTop));
  if (sel.half === 'top') g = g.slice(Math.ceil(g.length / 2));
  if (sel.half === 'bottom') g = g.slice(0, Math.ceil(g.length / 2));
  return g.flat().sort((a, b) => a - b);
}

// ---------------------------------------------------------------- joints (the 3D motion model)
// A joint is a hinge line with an angle schedule. jointOf() resolves it for one piece: which side the piece is on.
const DEG = Math.PI / 180;
function keyAngle(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a0] = keys[i - 1], [t1, a1] = keys[i];
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      const s = u * u * (3 - 2 * u); // ease within a phase
      return a0 + (a1 - a0) * s;
    }
  }
  return keys[keys.length - 1][1];
}
const FOLD_KEYS = [[0, 0], [1, 180]];
function resolveJoint(j, piecePoly) {
  if (j.shift) return { shift: j.shift, keys: j.keys || [[0, 0], [1, 1]] };
  if (j.sector) return { sector: j.sector, keys: j.keys || FOLD_KEYS };
  const line = creaseLine({ a: j.a, b: j.b });
  let n = line.n;
  if (j.rigid) {
    if (j.n) n = j.n;
  } else {
    const c = centroid(piecePoly);
    if (signedDist(line, c) < 0) n = [-n[0], -n[1]];
  }
  return { p: line.p, n, u: [-n[1], n[0]], up: j.up !== false, keys: j.keys || FOLD_KEYS, flat: !!j.flat, rigid: !!j.rigid, hint: j.hint, spin: j.spin, pivot: j.pivot, mirror: j.mirror };
}
function finalAngle(j) { const k = j.keys || FOLD_KEYS; return k[k.length - 1][1]; }

// 3D affine: [r00 r01 r02 r10 r11 r12 r20 r21 r22 tx ty tz]
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function mul3(A, B) { // A after B
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  for (let i = 0; i < 3; i++) r[9 + i] = A[i * 3] * B[9] + A[i * 3 + 1] * B[10] + A[i * 3 + 2] * B[11] + A[9 + i];
  return r;
}
// rotation of the piece's side (normal n) about the in-plane line through p by angle th (radians), rising if up
function hinge3(p, n, th, up) {
  const u = [-n[1], n[0]];
  // Rodrigues about axis u (z = 0): R n = n cos(phi) + (u x n) sin(phi), and (u x n).z = u0 n1 - u1 n0 = 1 here
  const phi = up ? -th : th; // (R n).z = -sin(phi)
  const c = Math.cos(phi), s = Math.sin(phi), C = 1 - c;
  const [ux, uy] = u;
  const R = [
    c + ux * ux * C, ux * uy * C, uy * s,
    uy * ux * C, c + uy * uy * C, -ux * s,
    -uy * s, ux * s, c,
  ];
  const t = [p[0] - (R[0] * p[0] + R[1] * p[1]), p[1] - (R[3] * p[0] + R[4] * p[1]), -(R[6] * p[0] + R[7] * p[1])];
  return [...R, ...t];
}
// A wedge of paper between two rays from a vertex (o -> b on a valley, o -> d on a ridge) as the vertex opens like an
// umbrella: the ridge ray rises to elevation phiD, the valley ray to the elevation that keeps the wedge's angle.
function sector3({ o, b, d }, phiD) {
  const vb = [b[0] - o[0], b[1] - o[1]], vd = [d[0] - o[0], d[1] - o[1]];
  const rb = Math.hypot(vb[0], vb[1]), rd = Math.hypot(vd[0], vd[1]);
  const pb = Math.atan2(vb[1], vb[0]), pd = Math.atan2(vd[1], vd[0]);
  const alpha = Math.acos((vb[0] * vd[0] + vb[1] * vd[1]) / (rb * rd));
  const A = Math.cos(phiD) * Math.cos(alpha), Bs = Math.sin(phiD), Rr = Math.hypot(A, Bs);
  const phiB = Math.atan2(Bs, A) - Math.acos(Math.min(1, Math.cos(alpha) / Rr));
  const B3 = [rb * Math.cos(phiB) * Math.cos(pb), rb * Math.cos(phiB) * Math.sin(pb), rb * Math.sin(phiB)];
  const D3 = [rd * Math.cos(phiD) * Math.cos(pd), rd * Math.cos(phiD) * Math.sin(pd), rd * Math.sin(phiD)];
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const e1 = nrm([vb[0], vb[1], 0]);
  const e2 = nrm([vd[0] - dot([vd[0], vd[1], 0], e1) * e1[0], vd[1] - dot([vd[0], vd[1], 0], e1) * e1[1], 0]);
  const e3 = cross(e1, e2);
  const E1 = nrm(B3);
  const dd = dot(D3, E1);
  const E2 = nrm([D3[0] - dd * E1[0], D3[1] - dd * E1[1], D3[2] - dd * E1[2]]);
  const E3 = cross(E1, E2);
  // R = [E1 E2 E3] [e1 e2 e3]^T
  const R = [];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) R.push(E1[i] * e1[k] + E2[i] * e2[k] + E3[i] * e3[k]);
  return [...R, o[0] - (R[0] * o[0] + R[1] * o[1]), o[1] - (R[3] * o[0] + R[4] * o[1]), -(R[6] * o[0] + R[7] * o[1])];
}
function spin3(pivot, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [c, -s, 0, s, c, 0, 0, 0, 1, pivot[0] - (c * pivot[0] - s * pivot[1]), pivot[1] - (s * pivot[0] + c * pivot[1]), 0];
}
// the 3D pose of one piece at progress t
export function pieceTransform(joints, t) {
  let T = I3;
  for (const j of joints) { // joints[0] is the innermost hinge; apply it first
    let A;
    if (j.sector) {
      A = sector3(j.sector, keyAngle(j.keys, t) * DEG);
    } else if (j.shift) {
      const k = keyAngle(j.keys, t);
      A = [1, 0, 0, 0, 1, 0, 0, 0, 1, j.shift[0] * k, j.shift[1] * k, j.shift[2] * k];
    } else if (j.spin != null) {
      A = spin3(j.pivot, j.spin * Math.min(1, Math.max(0, t)));
      if (j.mirror) A = mul3(A, hinge3(j.pivot, [1, 0], Math.PI * Math.min(1, Math.max(0, t)), true));
    } else {
      const th = keyAngle(j.keys, t) * DEG;
      A = hinge3(j.p, j.n, th, j.up);
      if (j.flat) A = [A[0], A[1], 0, A[3], A[4], 0, 0, 0, 1, A[9], A[10], 0];
    }
    T = mul3(A, T); // parent joints come later in the list and act last: T = J_root ∘ ... ∘ J_leaf
  }
  return T;
}
// the flat transform a chain ends at (each hinge either folded flat or not moved)
function chainFlat(chain) {
  let F = IDENTITY;
  for (const j of chain) {
    const a = ((finalAngle(j) % 360) + 360) % 360;
    if (Math.abs(a - 180) < 1e-6) {
      const L = creaseLine({ a: j.a, b: j.b });
      F = mul(reflectionMatrix(L.p, L.n), F);
    } else if (a > 1e-6) {
      return null; // not a flat end pose
    }
  }
  return F;
}

// ---------------------------------------------------------------- one op
let idSeed = 1;
function nextIdFor(stack) { return Math.max(idSeed, 1 + stack.reduce((m, l) => Math.max(m, l.id), 0)); }

function planFoldOp(stack, op) {
  const line = creaseLine(op);
  const clips = (op.clip || []).map((c) => creaseLine({ a: c.a, b: c.b, move: c.keep }));
  const parts = stack.map((l) => partition(l.poly, line, clips));
  const reach = [];
  parts.forEach((p, i) => { if (p.mov) reach.push(i); });
  const chosenList = pick(reach, stack, op.sel);
  const chosen = new Set(chosenList);
  const R = reflectionMatrix(line.p, line.n);
  let nextId = nextIdFor(stack);
  const dir = op.dir === 'mountain' ? 'mountain' : 'valley';
  const place = op.place || null;
  // the chosen layers split into a back half and a front half (reverse folds)
  const gmap = new Map();
  for (const i of chosenList) { const k = mKey(stack[i]); if (!gmap.has(k)) gmap.set(k, []); gmap.get(k).push(i); }
  const glist = [...gmap.values()].sort((a, b) => Math.max(...a) - Math.max(...b));
  const split = op.split != null ? op.split : Math.ceil(glist.length / 2);
  const backSet = new Set(glist.slice(0, split).flat());
  const entries = []; // { layer, start, moved }
  const moving = [], stay = [];
  const movedBack = [], movedFront = [], movedAll = [];
  for (let i = 0; i < stack.length; i++) {
    const l = stack[i];
    if (!chosen.has(i)) { entries.push({ layer: l, start: i }); stay.push(l); continue; }
    const restPieces = parts[i].rest.map((r) => ({ ...l, poly: r }));
    for (const r of restPieces) { entries.push({ layer: r, start: i }); stay.push(r); }
    if (parts[i].mov) {
      const src = { ...l, poly: parts[i].mov };
      moving.push(src);
      const flipped = op.unfold ? { ...src, id: nextId++ } : { ...src, id: nextId++, poly: transformPoly(src.poly, R), m: mul(R, src.m), face: -src.face };
      if (op.tag && !op.unfold) flipped.tag = op.tag;
      const e = { layer: flipped, start: i, src, back: backSet.has(i) };
      movedAll.push(e);
      (backSet.has(i) ? movedBack : movedFront).push(e);
    }
    // markers so reverse folds know where each half sits
    entries.push({ marker: i });
  }
  let order = [];
  if (op.unfold) {
    // pieces go back where they were: a moved piece sits with the rest of its layer
    for (const e of entries) {
      if (e.marker != null) { const m = movedAll.find((x) => x.start === e.marker); if (m) order.push(m); } else order.push(e);
    }
  } else if (place === 'inside') {
    const lastBack = Math.max(-1, ...[...backSet].filter((i) => movedAll.some((m) => m.start === i)));
    for (const e of entries) {
      if (e.marker != null) {
        if (e.marker === lastBack || (lastBack < 0 && e.marker === chosenList[0])) {
          order.push(...movedBack.slice().reverse(), ...movedFront.slice().reverse());
        }
      } else order.push(e);
    }
    if (!order.some((e) => movedAll.includes(e))) order.push(...movedAll.slice().reverse());
  } else if (place === 'outside') {
    const firstBack = chosenList[0], lastFront = chosenList[chosenList.length - 1];
    const out = [];
    let backDone = false;
    for (const e of entries) {
      if (!backDone && e.start === firstBack && e.marker == null) { out.push(...movedBack.slice().reverse()); backDone = true; }
      if (e.marker != null) {
        if (e.marker === firstBack && !backDone) { out.push(...movedBack.slice().reverse()); backDone = true; }
        if (e.marker === lastFront) out.push(...movedFront.slice().reverse());
      } else out.push(e);
    }
    order = out;
  } else if (dir === 'mountain') {
    order = movedAll.slice().reverse().concat(entries.filter((e) => e.marker == null));
  } else {
    order = entries.filter((e) => e.marker == null).concat(movedAll.slice().reverse());
  }
  const result = order.map((e) => e.layer);
  // render items
  const items = order.map((e, k) => {
    if (!e.src) return { piece: e.layer, joints: [], start: e.start + 0.5, end: k };
    const keys = op.unfold ? [[0, 0], [0.5, 175], [1, 0]] : FOLD_KEYS;
    const j = resolveJoint({ a: op.a, b: op.b, up: dir === 'valley', keys, flat: place === 'inside' || place === 'outside' }, e.src.poly);
    if (place === 'outside') { j.flat = true; }
    return { piece: e.src, joints: [j], start: e.start + 0.5, end: k, moved: true };
  });
  return { kind: 'fold', line, stay, moving, result, R, dir, place, unfold: !!op.unfold, items, landing: (pt) => (op.unfold ? pt : reflectPoint(pt, line)) };
}

function planRotateOp(stack, op) {
  const reach = stack.map((_, i) => i);
  const chosen = new Set(pick(reach, stack, op.sel));
  let Rm = rotationMatrix(op.pivot, op.angle);
  if (op.mirror) Rm = mul(Rm, reflectionMatrix(op.pivot, [1, 0])); // turn the layer over, then rotate
  const flips = det(Rm) < 0;
  const stay = [], moving = [];
  const items = [];
  const result = stack.map((l, i) => {
    if (!chosen.has(i)) { stay.push(l); items.push({ piece: l, joints: [], start: i, end: i }); return l; }
    moving.push(l);
    items.push({ piece: l, joints: [{ spin: op.angle, pivot: op.pivot, mirror: !!op.mirror }], start: i, end: i, moved: true });
    return { ...l, poly: transformPoly(l.poly, Rm), m: mul(Rm, l.m), face: flips ? -l.face : l.face };
  });
  return { kind: 'rotate', mirror: !!op.mirror, pivot: op.pivot, angle: op.angle, stay, moving, result, Rm, dir: 'valley', items, landing: (pt) => applyM(Rm, pt[0], pt[1]) };
}

// multi / pull / turn
function planMultiOp(stack, op) {
  const pull = op.type === 'pull';
  let parts = op.parts;
  if (op.type === 'turn') {
    const b = stackBounds(stack);
    const cx = op.x != null ? op.x : (b.x0 + b.x1) / 2;
    parts = [{ sel: 'all', chain: [{ a: [cx, -9], b: [cx, 9], rigid: true, n: [1, 0], up: true }], z: 'top' }];
  }
  const remaining = stack.map((l) => [l.poly]);
  const claimed = parts.map(() => []); // { i, poly }
  parts.forEach((part, pi) => {
    const lines = (part.region || []).map((c) => creaseLine({ a: c.a, b: c.b, move: c.keep }));
    const reach = [];
    for (let i = 0; i < stack.length; i++) {
      if (remaining[i].some((p) => { const r = cutRegion(p, lines).inside; return r && area(r) > 1e-7; })) reach.push(i);
    }
    for (const i of pick(reach, stack, part.sel)) {
      const keep = [];
      for (const p of remaining[i]) {
        const r = cutRegion(p, lines);
        if (r.inside && area(r.inside) > 1e-9) claimed[pi].push({ i, poly: r.inside });
        keep.push(...r.outside);
      }
      remaining[i] = keep;
    }
  });
  let nextId = nextIdFor(stack);
  const entries = [];
  const stay = [], moving = [];
  stack.forEach((l, i) => {
    remaining[i].forEach((poly, k) => {
      const piece = poly === l.poly ? l : { ...l, poly };
      stay.push(piece);
      entries.push({ key: i + k * 1e-6, layer: piece, src: null, start: i + 0.5 });
    });
  });
  const n = stack.length;
  parts.forEach((part, pi) => {
    const F = pull || part.z === 'same' ? IDENTITY : chainFlat(part.chain);
    if (!F) throw new Error('multi op part does not end flat');
    const flips = det(F) < 0;
    const rev = part.rev != null ? part.rev : flips;
    const pieces = claimed[pi].slice().sort((a, b) => a.i - b.i);
    if (rev) pieces.reverse();
    const zo = part.zo != null ? part.zo : pi;
    pieces.forEach((c, rank) => {
      const l = stack[c.i];
      const src = { ...l, poly: c.poly };
      moving.push(src);
      let key;
      if (pull || part.z === 'same') key = c.i + 1e-4 + rank * 1e-6;
      else if (part.z === 'bottom') key = -1e6 + zo * 1000 + rank;
      else if (typeof part.z === 'number') key = part.z + zo * 1e-3 + rank * 1e-5;
      else if (part.z && (part.z.below || part.z.above)) { // tucked next to the layers with a tag (into a pocket)
        const tg = part.z.below || part.z.above;
        const idx = stack.map((s, i) => (s.tag === tg ? i : -1)).filter((i) => i >= 0);
        key = (part.z.below ? Math.min(...idx) - 0.5 : Math.max(...idx) + 0.5) + zo * 1e-3 + rank * 1e-5;
      }
      else key = 1e6 + zo * 1000 + rank;
      const layer = pull ? src : { ...l, id: nextId++, poly: transformPoly(c.poly, F), m: mul(F, l.m), face: flips ? -l.face : l.face };
      if (part.tag && !pull && part.z !== 'same') layer.tag = part.tag;
      const joints = part.chain.map((j) => resolveJoint(j, c.poly));
      entries.push({ key, layer, src, joints, start: c.i + 0.5, shade: part.shade || 0 });
    });
  });
  entries.sort((a, b) => a.key - b.key);
  const result = pull ? stack : entries.map((e) => e.layer);
  const items = entries.map((e, k) => ({ piece: e.src || e.layer, joints: e.joints || [], start: e.start, end: k, moved: !!e.src, shade: e.shade || 0 }));
  return { kind: pull ? 'pull' : op.type === 'turn' ? 'turn' : 'multi', stay, moving, result, items, dir: 'valley', landing: (pt) => pt };
}

export function planOp(stack, op) {
  if (op.type === 'rotate') return planRotateOp(stack, op);
  if (op.type === 'multi' || op.type === 'pull' || op.type === 'turn') return planMultiOp(stack, op);
  return planFoldOp(stack, op);
}
export function stepOps(step) { return step.ops || [step]; }
export function isPullStep(step) { return stepOps(step).some((o) => o.type === 'pull'); }

export function planStep(stack, step) {
  const plans = [];
  let cur = stack;
  for (const op of stepOps(step)) {
    const p = planOp(cur, op);
    p.before = cur;
    p.op = op;
    plans.push(p);
    cur = p.result;
  }
  if (step.label) cur = cur.map((l, i) => ({ ...l, grp: i }));
  return { plans, result: cur };
}
export function foldStack(stack, step) { return planStep(stack, step).result; }

// ---------------------------------------------------------------- drawing support (pure geometry)
// Projection of a 3D pose to the page: z (toward the viewer) is drawn as a small shift `view`.
export function chooseView(plan) {
  // a standing flap leans back toward the side it rose from (and a little up the page), so it never turns edge-on
  // while it is still upright
  let n = null;
  for (const it of plan.items || []) {
    const j = it.joints && it.joints[it.joints.length - 1];
    if (j && j.n && !j.rigid) { n = j.n; break; }
  }
  if (!n) return [-0.16, -0.39];
  const v = unit2([n[0], n[1] - 0.35]);
  return [v[0] * 0.42, v[1] * 0.42];
}
function unit2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// Every piece of a plan at progress t: a 2D affine (world -> world) to draw it with, which face shows, a shade, and
// the order to paint them in (back to front).
const LIGHT = (() => { const v = [-0.45, -0.55, 0.7]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
// A pull step may also turn the whole piece toward the viewer (camera: { yaw, pitch } in degrees, reached at t = 1).
function cameraAt(cam, t) {
  const a = (cam.yaw || 0) * DEG * t, b = (cam.pitch || 0) * DEG * t;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // yaw about the page's vertical axis, then pitch about its horizontal axis (positive pitch: seen from above)
  const Y = [ca, 0, sa, 0, 1, 0, -sa, 0, ca, 0, 0, 0];
  const P = [1, 0, 0, 0, cb, sb, 0, -sb, cb, 0, 0, 0];
  const C = mul3(P, Y);
  if (cam.pivot) { // turn about a point instead of the origin
    const [px, py] = cam.pivot;
    C[9] = px - (C[0] * px + C[1] * py); C[10] = py - (C[3] * px + C[4] * py); C[11] = -(C[6] * px + C[7] * py);
  }
  return C;
}
export function poseItems(plan, t, view) {
  const cam = plan.op && plan.op.camera;
  const v = view || plan.view || (plan.view = (plan.op && plan.op.view) || (cam ? [0, 0] : chooseView(plan)));
  const C = cam ? cameraAt(cam, t) : null;
  const out = [];
  const groups = new Map();
  for (const it of plan.items) {
    let M = IDENTITY, nz = 1, zc = 0, nvec = [0, 0, 1];
    if (it.joints.length || C) {
      let T = pieceTransform(it.joints, t);
      if (C) T = mul3(C, T);
      nvec = [T[2], T[5], T[8]];
      M = [T[0] + v[0] * T[6], T[3] + v[1] * T[6], T[1] + v[0] * T[7], T[4] + v[1] * T[7], T[9] + v[0] * T[11], T[10] + v[1] * T[11]];
      nz = T[8];
      const c = centroid(it.piece.poly);
      zc = T[6] * c[0] + T[7] * c[1] + T[11];
      const key = T.map((x) => Math.round(x * 1e4)).join(',');
      const g = groups.get(key);
      if (g) g.push(out.length); else groups.set(key, [out.length]);
    }
    out.push({ piece: it.piece, M, nz, n: nvec, zc, start: it.start, end: it.end, moved: it.moved, extraShade: (it.shade || 0) * Math.min(1, t * 1.5) });
  }
  for (const idx of groups.values()) { // pieces turning together share one depth (their own layer order inside)
    const z = idx.reduce((s, i) => s + out[i].zc, 0) / idx.length;
    for (const i of idx) out[i].zc = z;
  }
  const late = t >= 0.5;
  for (const o of out) {
    if (o.zc > 1e-5 || o.zc < -1e-5) {
      // lifted: in front of (or behind) the flat paper; a group seen from its back paints its layers in reverse
      o.key = (o.zc > 0 ? 1e6 : -1e6) + o.zc * 1e5 + (o.nz >= 0 ? o.start : -o.start) * 1e-3;
    } else {
      o.key = late ? o.end : o.start;
    }
    o.face = (o.nz >= 0 ? 1 : -1) * o.piece.face;
    // light from the upper left, a little in front: faces turned toward it brighten, faces turned away darken
    const N = o.nz >= 0 ? o.n : [-o.n[0], -o.n[1], -o.n[2]];
    const lit = N[0] * LIGHT[0] + N[1] * LIGHT[1] + N[2] * LIGHT[2];
    const diff = LIGHT[2] - lit; // 0 for paper lying flat
    o.shade = Math.max(0, 0.42 * diff) + (o.nz < 0 ? 0.03 : 0) + o.extraShade;
    o.light = Math.max(0, -0.5 * diff);
  }
  out.sort((a, b) => a.key - b.key);
  return out;
}

// For each layer, which edges are flat creases (the paper continues, unfolded, across them) rather than real edges.
const edgeCache = new WeakMap();
export function edgeFlags(stack) {
  if (edgeCache.has(stack)) return edgeCache.get(stack);
  const same = (A, B) => A.every((v, i) => Math.abs(v - B[i]) < 1e-7);
  const res = stack.map((l) => l.poly.map(() => false));
  for (let i = 0; i < stack.length; i++) {
    const A = stack[i];
    for (let j = i + 1; j < stack.length; j++) {
      const B = stack[j];
      if (A.face !== B.face || !same(A.m, B.m)) continue;
      for (let ea = 0; ea < A.poly.length; ea++) {
        const p = A.poly[ea], q = A.poly[(ea + 1) % A.poly.length];
        for (let eb = 0; eb < B.poly.length; eb++) {
          const r = B.poly[eb], s = B.poly[(eb + 1) % B.poly.length];
          if (segOverlap(p, q, r, s)) { res[i][ea] = true; res[j][eb] = true; }
        }
      }
    }
  }
  edgeCache.set(stack, res);
  return res;
}
function segOverlap(p, q, r, s) { // collinear, opposite direction, overlapping by more than a sliver
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return false;
  const ux = dx / L, uy = dy / L;
  const off = (pt) => (pt[0] - p[0]) * -uy + (pt[1] - p[1]) * ux;
  if (Math.abs(off(r)) > 1e-7 || Math.abs(off(s)) > 1e-7) return false;
  const tr = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy, ts = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy;
  const lo = Math.max(0, Math.min(tr, ts)), hi = Math.min(L, Math.max(tr, ts));
  return hi - lo > 1e-6;
}

// The diagram lines for a plan: segments where pieces hinge, valley (rising) or mountain (dipping).
export function planHints(plan) {
  const segs = [];
  const seen = new Set();
  if (plan.kind === 'pull' || plan.kind === 'turn' || plan.kind === 'rotate') return [];
  for (const it of plan.items || []) {
    if (!it.moved) continue;
    for (const j of it.joints) {
      if (j.spin != null || j.rigid || j.shift || j.sector) continue;
      const poly = it.piece.poly;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const L = { p: j.p, n: j.n };
        if (Math.abs(signedDist(L, a)) < 1e-6 && Math.abs(signedDist(L, b)) < 1e-6 && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-4) {
          if (j.hint === 'none') continue;
          const key = [a, b].map((p) => p.map((x) => Math.round(x * 1e4)).join(':')).sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          segs.push({ a, b, dir: j.hint || (j.up ? 'valley' : 'mountain') });
        }
      }
      break; // only a piece's own hinge touches it
    }
  }
  return mergeSegs(segs);
}
function mergeSegs(segs) { // join collinear touching segments of the same kind
  const out = [];
  for (const s of segs) {
    let merged = false;
    for (const o of out) {
      if (o.dir !== s.dir) continue;
      const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      const off = (pt) => (pt[0] - o.a[0]) * -uy + (pt[1] - o.a[1]) * ux;
      if (Math.abs(off(s.a)) > 1e-6 || Math.abs(off(s.b)) > 1e-6) continue;
      const t = (pt) => (pt[0] - o.a[0]) * ux + (pt[1] - o.a[1]) * uy;
      const t0 = Math.min(t(s.a), t(s.b)), t1 = Math.max(t(s.a), t(s.b));
      if (t0 > L + 1e-6 || t1 < -1e-6) continue;
      const lo = Math.min(0, t0), hi = Math.max(L, t1);
      const a = [o.a[0] + ux * lo, o.a[1] + uy * lo], b = [o.a[0] + ux * hi, o.a[1] + uy * hi];
      o.a = a; o.b = b; merged = true; break;
    }
    if (!merged) out.push({ ...s });
  }
  return out;
}

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
// the plan of the closing pull step (a 3D pose), or null
const pullCache = new Map();
export function finalPull(model) {
  if (pullCache.has(model.id)) return pullCache.get(model.id);
  const n = model.steps.length;
  let r = null;
  if (n && isPullStep(model.steps[n - 1])) {
    const states = buildStates(model);
    const { plans } = planStep(states[n - 1], model.steps[n - 1]);
    r = plans[plans.length - 1];
  }
  pullCache.set(model.id, r);
  return r;
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
export function poseBounds(plan, t) {
  let b = null;
  for (const o of poseItems(plan, t)) {
    for (const [x, y] of o.piece.poly) {
      const [X, Y] = applyM(o.M, x, y);
      b = unionBounds(b, { x0: X, y0: Y, x1: X, y1: Y });
    }
  }
  return b;
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

// the finished piece: its flat stack or its pulled 3D pose, and the pen marks
export function finishBounds(model) {
  const pull = finalPull(model);
  const b = pull ? poseBounds(pull, 1) : stackBounds(finalState(model));
  return unionBounds(b, decorBounds(modelDecor(model, finalState(model))));
}

export function modelBounds(model) { // union over every state (and the decoration), so the camera never moves mid-fold
  let b = null;
  for (const s of buildStates(model)) b = unionBounds(b, stackBounds(s));
  return unionBounds(b, finishBounds(model));
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
