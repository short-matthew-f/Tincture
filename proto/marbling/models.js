// models.js - the origami model definitions (pure data built with fold.js ops).
// World units: the square sheet's half-diagonal is 1. Every model starts as the diamond unless pose says otherwise.
// Each model notes the source its step sequence follows. "Colour side" = the marbled side.
// decor: marks "drawn on with a pen" over the finished model (eyes, noses). Shapes:
//   {t:'dot', x, y, r, fill} {t:'ellipse', x, y, rx, ry, rot, fill} {t:'poly', pts, fill} {t:'line', pts, color, w}

import { reflectPoint, creaseLine } from './fold.js';

export const LEVELS = ['Easy', 'Medium', 'Patient'];

const T = [0, -1], B = [0, 1], L = [-1, 0], R = [1, 0], O = [0, 0];
const INK = '#2A2622', CREAM = '#FBF8F1', ORANGE = '#E08A2E', PINK = '#E6879A';
const R2 = Math.SQRT2, S = Math.SQRT1_2; // S = half side of the square sheet

// ---------------------------------------------------------------- helpers
const line = (a, b) => ({ a, b });
function bis(P, Q) { // crease that lands P on Q
  const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
  const dx = -(Q[1] - P[1]), dy = Q[0] - P[0];
  const l = Math.hypot(dx, dy);
  return { a: [mx - (dx / l) * 4, my - (dy / l) * 4], b: [mx + (dx / l) * 4, my + (dy / l) * 4], move: P };
}
const horiz = (y, move) => ({ a: [-4, y], b: [4, y], move });
const vert = (x, move) => ({ a: [x, -4], b: [x, 4], move });
const through = (a, b, move) => ({ a, b, move });
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const refl = (P, l) => reflectPoint(P, creaseLine({ a: l.a, b: l.b }));
function lineAt(p, dir) { const u = unit(dir); return { a: add(p, u, -4), b: add(p, u, 4) }; }
const hp = (l, keep) => ({ a: l.a, b: l.b, keep }); // half-plane: the side of l holding `keep`
function meet(l1, l2) { // intersection of two lines
  const d1 = [l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]], d2 = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  const t = ((l2.a[0] - l1.a[0]) * d2[1] - (l2.a[1] - l1.a[1]) * d2[0]) / den;
  return add(l1.a, d1, t);
}
const V = (o) => ({ dir: 'valley', ...o });
const M = (o) => ({ dir: 'mountain', ...o });
const crease = (o) => ({ dir: 'valley', unfold: true, ...o });
const turn = (x = 0, text = 'Turn the paper over.') => ({ text, type: 'turn', x });
const rotate = (deg, pivot, text) => ({ text, type: 'rotate', pivot, angle: (deg * Math.PI) / 180, sel: 'all' });

// Squash fold of a flap lying folded over `hinge`: lift it upright, open its pocket and press it flat so its folded edge
// (the spine) lands on the hinge line. bisector: the crease through the corner where spine meets hinge.
// flap: point on the flap's side of the hinge; spine: point on the spine's side of the bisector.
// k = layers in the flap (top k of the stack there), open = how many of them swing across (the top wall).
function squash({ hinge, bisector, flap, spine, k = 2, open = 1, region = [], sel = {}, lift = 0.4, tag }) {
  const flapR = [hp(hinge, flap), ...region];
  const spineSide = hp(bisector, spine);
  const hingeSide = hp(bisector, refl(spine, bisector));
  const up = (keys) => keys;
  const hingeJ = (end) => ({ ...hinge, up: true, keys: up([[0, 0], [lift, 90], [1, end]]) });
  const bisJ = (u) => ({ ...bisector, up: u, keys: [[0, 0], [lift, 0], [1, 180]] });
  const top = { ...sel, top: open };
  const rest = { ...sel, top: k - open };
  return {
    type: 'multi', kind: 'Squash fold',
    parts: [
      { sel: top, region: [...flapR, hingeSide], chain: [hingeJ(180)], z: 'top', zo: 1, tag },
      { sel: top, region: [...flapR, spineSide], chain: [bisJ(false), hingeJ(180)], z: 'top', zo: 2, tag },
      { sel: rest, region: [...flapR, hingeSide], chain: [hingeJ(0)], z: 'top', zo: 0, tag },
      { sel: rest, region: [...flapR, spineSide], chain: [bisJ(true), hingeJ(0)], z: 'top', zo: 3, tag },
    ],
  };
}

// Petal fold of the front flap of a preliminary base whose closed point is at `top`, open corner at `bot`, side
// corners sl / sr. The front layer's lower corner lifts up along the waist while its sides fold in along the kite
// creases, and the layer behind each side (joined to it along the outer edge) folds in to meet the centre line.
function petalLines(top, bot, sl, sr) {
  const ax = unit([top[0] - bot[0], top[1] - bot[1]]);
  const len = Math.hypot(top[0] - bot[0], top[1] - bot[1]);
  const t = 1 / (2 + R2); // waist: the kite creases meet the side edges this far down from the top
  const pl = add(top, unit([sl[0] - top[0], sl[1] - top[1]]), t * len * R2 / 1);
  const pr = add(top, unit([sr[0] - top[0], sr[1] - top[1]]), t * len * R2 / 1);
  void ax;
  return { waist: line(pl, pr), kl: line(bot, pl), kr: line(bot, pr), pl, pr };
}
function petal({ top, bot, sl, sr, tag, innerTag }) {
  const { waist, kl, kr } = petalLines(top, bot, sl, sr);
  const inside = add(bot, [top[0] - bot[0], top[1] - bot[1]], 0.3);
  const axis = line(top, bot);
  const below = hp(waist, bot);
  const left = hp(kl, sl), right = hp(kr, sr), cl = hp(kl, inside), cr = hp(kr, inside);
  const hl = hp(axis, sl), hr = hp(axis, sr);
  const W = () => ({ ...waist, up: true, keys: FULL });
  return {
    type: 'multi', kind: 'Petal fold',
    parts: [
      // the front layer: its centre lifts up and over; its sides turn under it (the kite creases become mountains)
      { sel: { top: 1 }, region: [below, cl, cr, hl], chain: [W()], z: 'top', zo: 2, tag },
      { sel: { top: 1 }, region: [below, cl, cr, hr], chain: [W()], z: 'top', zo: 3, tag },
      { sel: { top: 1 }, region: [below, left], chain: [{ ...kl, up: false, keys: FULL, hint: 'mountain' }, W()], z: 'top', zo: 4, tag },
      { sel: { top: 1 }, region: [below, right], chain: [{ ...kr, up: false, keys: FULL, hint: 'mountain' }, W()], z: 'top', zo: 5, tag },
      // the layer joined to each side along the outer edge folds in to the centre line
      { sel: { top: 1 }, region: [below, left], chain: [{ ...kl, up: true, keys: FULL, hint: 'none' }], z: 'top', zo: 0, tag: innerTag },
      { sel: { top: 1 }, region: [below, right], chain: [{ ...kr, up: true, keys: FULL, hint: 'none' }], z: 'top', zo: 1, tag: innerTag },
    ],
  };
}
const FULL = [[0, 0], [1, 180]];
const CREASE_KEYS = [[0, 0], [0.5, 175], [1, 0]];
// fold and unfold, several flaps at once: parts [{ l (line), keep (point on the side that swings), sel, region }]
function creaseMulti(parts) {
  return {
    type: 'multi',
    parts: parts.map((p) => ({ sel: p.sel, region: [hp(p.l, p.keep), ...(p.region || [])], chain: [{ ...p.l, up: p.up !== false, keys: CREASE_KEYS }], z: 'same' })),
  };
}

// A pull step: parts turn out of the plane and stay there (the finished piece is three-dimensional).
const pull = (text, parts, { cta, view, camera, prompt } = {}) => ({ text, cta, prompt, ops: [{ type: 'pull', parts, view, camera }] });

const eye = (x, y, r = 0.045) => ({ t: 'dot', x, y, r, fill: INK });
const shine = (x, y, r = 0.016) => ({ t: 'dot', x, y, r, fill: CREAM });

// ================================================================ CUP
// Source: origami-instructions.com/origami-cup.html (steps 1-6 of origami-cowboy-hat.html, then open it).
// 1 colour side down, fold the bottom point up to the top; 2 fold the right corner across so the flap's top edge lies
// level; 3 the left corner across the same way; 4 fold the front top point down; 5 turn over; 6 fold the other point
// down; 7 open the cup.
const CUP_H = 2 / (2 + R2);
function cupSteps() {
  const Ql = [CUP_H - 1, -CUP_H], Qr = [1 - CUP_H, -CUP_H];
  const lip = horiz(-CUP_H, T);
  return [
    { text: 'Colour side down. Valley fold the bottom point up to meet the top point.', ...V(horiz(0, B)) },
    { text: 'Fold the right corner across so it touches the left edge and its top edge lies level.', ...V(bis(R, Ql)) },
    { text: 'Fold the left corner across the same way, so it touches the right edge.', ...V(bis(L, Qr)) },
    { text: 'Fold the front layer of the top point down over the front.', ...V(lip), sel: { top: 1 } },
    turn(0),
    { text: 'Fold the other top point down the same way.', ...V(lip), sel: { top: 1 } },
    pull('Squeeze the sides gently so the cup opens.', [
      { sel: { half: 'top' }, region: [], chain: [{ a: [-4, 0], b: [4, 0], up: true, keys: [[0, 0], [1, 16]] }] },
      { sel: { half: 'bottom' }, region: [], chain: [{ a: [-4, 0], b: [4, 0], up: false, keys: [[0, 0], [1, 16]] }], shade: 0.34 },
    ], { cta: 'Open the cup', camera: { pitch: 26, yaw: 12, pivot: [0, -0.3] } }),
  ];
}

// ================================================================ preliminary base, bird base, crane, flapping bird
// Square base, method 2: origami-instructions.com/origami-square-base.html (diagonal, in half, squash, turn, squash).
// Bird base: origami-instructions.com/origami-bird-base.html (kite creases, top crease, petal fold; turn, repeat).
const WAIST = 1 - Math.SQRT1_2; // 0.2929: where the petals hinge
const PB = { top: O, bot: B, sl: [-0.5, 0.5], sr: [0.5, 0.5] };
function squareBaseSteps() {
  return [
    { text: 'Colour side down. Valley fold the top point down to the bottom point.', ...V(horiz(0, T)) },
    { text: 'Fold it in half again: the left point over to the right.', ...V(vert(0, L)) },
    { text: 'Squash fold: lift the top flap upright, open it, and press it flat into a square.', ...squash({ hinge: line([0, -4], [0, 4]), bisector: line([-4, -4], [4, 4]), flap: [0.5, 0.2], spine: [0.8, 0.05] }) },
    turn(0),
    { text: 'Squash fold this flap the same way. This is the square (preliminary) base.', ...squash({ hinge: line([0, -4], [0, 4]), bisector: line([-4, 4], [4, -4]), flap: [-0.5, 0.2], spine: [-0.8, 0.05] }) },
  ];
}
function petalSteps(tag, innerTag, which = 'front') {
  const { waist, kl, kr } = petalLines(PB.top, PB.bot, PB.sl, PB.sr);
  const axis = line(PB.top, PB.bot);
  return [
    { text: `Fold the lower edges of the ${which} flap in to the centre line, crease well and unfold.`, ...creaseMulti([
      { l: kl, keep: PB.sl, sel: { top: 2 } }, { l: kr, keep: PB.sr, sel: { top: 2 } }]) },
    { text: 'Fold the top point down over them, crease well and unfold.', ...creaseMulti([
      { l: waist, keep: O, sel: { top: 1 }, region: [hp(axis, PB.sl)] }, { l: waist, keep: O, sel: { top: 1 }, region: [hp(axis, PB.sr)] }]) },
    { text: 'Petal fold: lift the bottom corner of the front layer up along the crease and let its sides fold in to the middle. Flatten.', ...petal({ ...PB, tag, innerTag }) },
  ];
}
function birdBaseSteps() {
  return [
    ...squareBaseSteps(),
    ...petalSteps('wingF', 'legF', 'front'),
    turn(0),
    ...petalSteps('wingB', 'legB', 'back'),
  ];
}

// Crane: origami-instructions.com/origami-crane.html (bird base; narrow the legs front and back; fold, unfold and
// inside-reverse fold each leg up for the neck and tail; reverse fold the head; fold the wings down; pull them apart).
const NARROW = Math.tan(Math.PI / 16) * (1 - WAIST);
const belowWaist = { a: [-4, WAIST], b: [4, WAIST], keep: [0, 0.9] };
function narrowOps(where) {
  const mk = (x, side) => ({ a: B, b: [x, WAIST], move: side, dir: 'valley', sel: { top: 2, notTag: ['wingF', 'wingB'] }, clip: [belowWaist] });
  void where;
  return [mk(-NARROW, [-0.25, 0.5]), mk(NARROW, [0.25, 0.5])];
}
function reverseLine(point, from, to) { // crease through `point` that turns direction `from` into direction `to`
  const u = unit([from[0] + to[0], from[1] + to[1]]);
  return { a: add(point, u, -4), b: add(point, u, 4) };
}
function craneGeometry() {
  const Q = [0, 0.33];
  const vNeck = unit([-0.45, -0.89]);
  const vTail = unit([0.45, -0.89]);
  const nl = reverseLine(Q, [0, 1], vNeck);
  const tl = reverseLine(Q, [0, 1], vTail);
  const neckTip = refl(B, nl);
  const vHead = unit([-0.7, 0.72]);
  const hpnt = add(neckTip, vNeck, -0.17);
  const hl = reverseLine(hpnt, vNeck, vHead);
  const headTip = refl(neckTip, hl);
  return { nl, tl, hl, neckTip, headTip, vHead, vNeck };
}
const leftOf = (x = 0) => [{ a: [x, -4], b: [x, 4], keep: [x - 1, 0] }];
const rightOf = (x = 0) => [{ a: [x, -4], b: [x, 4], keep: [x + 1, 0] }];
function craneSteps() {
  const g = craneGeometry();
  const notWings = { notTag: ['wingF', 'wingB'] };
  return [
    ...birdBaseSteps(),
    { text: 'Fold the lower edges of the front layers in to the centre line, to make the legs slim.', ops: narrowOps() },
    turn(0),
    { text: 'Fold the lower edges in to the centre line on this side too.', ops: narrowOps() },
    { text: 'Fold the left leg up along the line, crease well and unfold.', ...crease({ ...g.nl, move: B, clip: leftOf(), sel: notWings }) },
    { text: 'Inside reverse fold: open the leg a little and push it up inside itself along the crease. This is the neck.', ...V({ ...g.nl, move: B }), clip: leftOf(), sel: notWings, place: 'inside', tag: 'neck' },
    { text: 'Fold the right leg up along the line, crease well and unfold.', ...crease({ ...g.tl, move: B, clip: rightOf(), sel: notWings }) },
    { text: 'Inside reverse fold it up the same way. This is the tail.', ...V({ ...g.tl, move: B }), clip: rightOf(), sel: notWings, place: 'inside', tag: 'tail' },
    { text: 'Inside reverse fold the tip of the neck down to make the head.', ...V({ ...g.hl, move: g.neckTip }), sel: { tag: 'neck' }, place: 'inside', tag: 'head' },
    { text: 'Fold the front wing down along the top of the body.', ...V(horiz(WAIST, [0, -0.3])), sel: { tag: 'wingF' } },
    { text: 'Fold the back wing down behind the same way.', ...M(horiz(WAIST, [0, -0.3])), sel: { tag: 'wingB' } },
    pull('Hold the neck and tail and pull the wings apart gently. The body puffs up.', [
      { sel: { tag: 'wingF' }, region: [], chain: [{ a: [-4, WAIST], b: [4, WAIST], up: true, keys: [[0, 0], [1, 92]] }] },
      { sel: { tag: 'wingB' }, region: [], chain: [{ a: [-4, WAIST], b: [4, WAIST], up: false, keys: [[0, 0], [1, 92]] }] },
    ], { cta: 'Pull the wings apart', camera: { yaw: 38, pitch: 28, pivot: [0, WAIST] } }),
  ];
}

// Flapping bird: origami-instructions.com/origami-flapping-bird.html (bird base; fold, unfold and inside-reverse fold
// both lower points up; reverse fold the head; fold the wings down; pull the tail and the wings flap).
function flappingSteps() {
  const Q = [0, WAIST + 0.01];
  const vNeck = unit([-0.42, -0.91]), vTail = unit([0.42, -0.91]);
  const nl = reverseLine(Q, [0, 1], vNeck), tl = reverseLine(Q, [0, 1], vTail);
  const neckTip = refl(B, nl);
  const hpnt = add(neckTip, vNeck, -0.2);
  const hl = reverseLine(hpnt, vNeck, unit([-0.75, 0.66]));
  const notWings = { notTag: ['wingF', 'wingB'] };
  return [
    ...birdBaseSteps(),
    { text: 'Fold the left lower point up along the line, crease well and unfold.', ...crease({ ...nl, move: B, clip: leftOf(), sel: notWings }) },
    { text: 'Inside reverse fold it up along the crease, between its layers. This is the neck.', ...V({ ...nl, move: B }), clip: leftOf(), sel: notWings, place: 'inside', tag: 'neck' },
    { text: 'Fold the right lower point up the same way, crease well and unfold.', ...crease({ ...tl, move: B, clip: rightOf(), sel: notWings }) },
    { text: 'Inside reverse fold it up too. This is the tail.', ...V({ ...tl, move: B }), clip: rightOf(), sel: notWings, place: 'inside', tag: 'tail' },
    { text: 'Inside reverse fold the tip of the neck down to make the head.', ...V({ ...hl, move: neckTip }), sel: { tag: 'neck' }, place: 'inside', tag: 'head' },
    { text: 'Fold the front wing down along the top of the body.', ...V(horiz(WAIST, [0, -0.3])), sel: { tag: 'wingF' } },
    { text: 'Fold the back wing down behind the same way.', ...M(horiz(WAIST, [0, -0.3])), sel: { tag: 'wingB' } },
    pull('Hold the base of the neck and gently pull the tail. The wings flap!', [
      { sel: { tag: 'wingF' }, region: [], chain: [{ a: [-4, WAIST], b: [4, WAIST], up: true, keys: [[0, 0], [0.5, 120], [1, 70]] }] },
      { sel: { tag: 'wingB' }, region: [], chain: [{ a: [-4, WAIST], b: [4, WAIST], up: false, keys: [[0, 0], [0.5, 120], [1, 70]] }] },
    ], { cta: 'Pull the tail', camera: { yaw: 30, pitch: 22, pivot: [0, WAIST] } }),
  ];
}

// ================================================================ simple faces and flowers
// Dog face: origami-instructions.com/origami-dog-face.html (first version).
const dogSteps = () => [
  { text: 'Colour side down. Fold the top point down to the bottom point to make a triangle.', ...V(horiz(0, T)) },
  { text: 'Fold the left corner onto the right corner, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the left corner down along the line to make a floppy ear.', ...V(bis(L, [-0.44, 0.73])) },
  { text: 'Fold the right corner down the same way for the other ear.', ...V(bis(R, [0.44, 0.73])) },
  { text: 'Fold the bottom point behind.', ...M(horiz(0.8, B)) },
  { text: 'Fold a thin strip of the top edge behind.', ...M(horiz(0.07, [0, -0.2])) },
];

// Cat face: origami-instructions.com/origami-cat-face.html
const catSteps = () => [
  { text: 'Colour side down. Fold the bottom point up to the top point to make a triangle.', ...V(horiz(0, B)) },
  { text: 'Fold the left corner onto the right corner, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the left corner up to make an ear.', ...V(bis(L, [-0.45, -0.86])), tag: 'ear' },
  { text: 'Fold the right corner up the same way for the other ear.', ...V(bis(R, [0.45, -0.86])), tag: 'ear' },
  { text: 'Fold the top point down toward you.', ...V(horiz(-0.7, T)), sel: { notTag: 'ear' } },
  turn(0, 'Turn it over. Here is the cat.'),
];

// Fox face: origami-instructions.com/origami-fox-face.html
const foxSteps = () => [
  { text: 'Colour side down. Fold the bottom point up to the top point to make a triangle.', ...V(horiz(0, B)) },
  { text: 'Fold the triangle in half, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the top point down to meet the middle of the bottom edge.', ...V(horiz(-0.5, T)) },
  { text: 'Fold the right corner up so its lower edge meets the centre crease.', ...V(through(O, [1, -1], R)) },
  { text: 'Fold the left corner up the same way.', ...V(through(O, [-1, -1], L)) },
  turn(0, 'Turn it over. Here is the fox.'),
];

// Tulip (flower): origami-instructions.com/easy-origami-tulip.html (steps 1-10)
const TULIP_TIP = 0.15;
const tulipSteps = () => [
  { text: 'Colour side down. Fold the bottom point up to the top point to make a triangle.', ...V(horiz(0, B)) },
  { text: 'Fold the triangle in half, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the right corner up along the line to make a petal.', ...V(bis(R, [0.34, -0.94])), tag: 'petal' },
  { text: 'Fold the left corner up over it the same way.', ...V(bis(L, [-0.34, -0.94])), tag: 'petal' },
  { text: 'Fold the tip of the middle point down a little (front layer only).', ...V(horiz(-0.88, T)), sel: { notTag: 'petal', top: 1 } },
  { text: 'Fold the bottom point up a little, crease well and unfold.', ...crease(horiz(-TULIP_TIP, [0, 0.05])) },
  { text: 'Inside reverse fold the bottom point: open the layers and push the tip up inside.', ...V(horiz(-TULIP_TIP, [0, 0.05])), place: 'inside' },
];

// Heart: origami-instructions.com/easy-origami-heart.html
const heartSteps = () => [
  { text: 'Colour side down. Fold in half to a triangle, crease and unfold.', ...crease(horiz(0, T)) },
  { text: 'Fold in half the other way, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the top point down to the centre.', ...V(horiz(-0.5, T)) },
  { text: 'Fold the bottom point up to meet the top edge.', ...V(horiz(0.25, B)) },
  { text: 'Fold the right side up so its bottom edge lies along the centre crease.', ...V(through([0, 0.25], [1, -0.75], R)) },
  { text: 'Fold the left side up the same way.', ...V(through([0, 0.25], [-1, -0.75], L)) },
  turn(0),
  { text: 'Fold the side corners in a little.', ops: [V(vert(-0.5, [-1, -0.37])), V(vert(0.5, [1, -0.37]))] },
  { text: 'Fold the tips of the two bumps down a little.', ...V(horiz(-0.6, [0, -1])) },
  turn(0, 'Turn it over. Here is the heart.'),
];

// Whale: origami-instructions.com/easy-origami-whale.html
const KITE = [0.5857864376, -0.4142135624];
const whaleSteps = () => [
  { text: 'Colour side down. Fold the left corner onto the right, crease and unfold.', ...crease(vert(0, L)) },
  { text: 'Fold the lower right edge in to the centre crease.', ...V(through(B, KITE, R)) },
  { text: 'Fold the lower left edge in to the centre crease. This is a kite base.', ...V(through(B, [-KITE[0], KITE[1]], L)) },
  { text: 'Fold the top point down to meet the flaps.', ...V(horiz(-0.7071, T)) },
  { text: 'Fold it in half, the left half behind.', ...M(vert(0, L)) },
  rotate(90, [0.3, 0.15], 'Turn the whale a quarter turn so the long point is on the left.'),
  { text: 'Fold the tail up along the line.', ...V(through([-0.3, -0.15], [0.068, 0.106], [-0.5, -0.14])) },
];

// Cicada: origami-instructions.com/origami-cicada.html
const cicadaSteps = () => [
  { text: 'Colour side down. Fold the bottom point up to the top point.', ...V(horiz(0, B)) },
  { text: 'Fold the left and right corners up to the top point.', ops: [{ ...V(bis(L, T)), tag: 'wingL' }, { ...V(bis(R, T)), tag: 'wingR' }] },
  { text: 'Fold both flaps down along the lines so their points stick out below: the wings.', ops: [
    { ...V(through([0, -0.4], [-0.5, -0.56], T)), sel: { tag: 'wingL' } },
    { ...V(through([0, -0.4], [0.5, -0.56], T)), sel: { tag: 'wingR' } }] },
  { text: 'Fold the top layer of the top point down.', ...V(horiz(-0.74, T)), sel: { top: 1 } },
  { text: 'Fold the next layer down too, a little higher.', ...V(horiz(-0.82, T)), sel: { top: 1 } },
  { text: 'Fold the left and right sides behind to shape the body.', ops: [M(through([-0.19, -0.96], [-0.4, 0.3], L)), M(through([0.19, -0.96], [0.4, 0.3], R))] },
];

// Samurai helmet (kabuto): origami-instructions.com/origami-samurai-helmet.html
const helmetSteps = () => [
  { text: 'Colour side down. Fold the top point down to the bottom point.', ...V(horiz(0, T)) },
  { text: 'Fold the right corner down to the bottom point.', ...V(bis(R, B)), tag: 'flapR' },
  { text: 'Fold the left corner down to the bottom point.', ...V(bis(L, B)), tag: 'flapL' },
  { text: 'Fold the bottom points of both flaps up to the top point.', ops: [
    { ...V(horiz(0.5, B)), sel: { tag: 'flapL' } }, { ...V(horiz(0.5, B)), sel: { tag: 'flapR' } }] },
  { text: 'Fold the points out to the sides along the lines. These are the horns.', ops: [
    { ...V(through([0, 0.043], [-0.385, 0.5], [-0.03, 0.4])), sel: { tag: 'flapL' } },
    { ...V(through([0, 0.043], [0.385, 0.5], [0.03, 0.4])), sel: { tag: 'flapR' } }] },
  { text: 'Fold the front layer of the bottom point up, most of the way to the top.', ...V(horiz(0.62, B)), sel: { top: 1 } },
  { text: 'Fold it up again along the bottom of the horns.', ...V(horiz(0.5, [0, 0.56])), sel: { top: 2 } },
  { text: 'Fold the back point up behind.', ...M(horiz(0.5, B)) },
];

// Envelope: the blintz fold (origami-instructions.com/origami-blintz-base.html), closed like a letter.
const envelopeSteps = () => [
  { text: 'Colour side down. Fold the left point to the middle.', ...V(bis(L, O)) },
  { text: 'Fold the right point to the middle.', ...V(bis(R, O)) },
  { text: 'Fold the bottom point up to the middle.', ...V(bis(B, O)) },
  { text: 'Close the flap: fold the top point down to the middle.', ...V(bis(T, O)) },
];

// ================================================================ from a rectangle
// Paper hat: origami-instructions.com/origami-hat.html (A4-shaped sheet)
const HAT = { w: 1.2, h: 1.2 * R2 };
function hatSteps() {
  const h2 = HAT.h / 2, w2 = HAT.w / 2;
  const band = (h2 + w2) / 2;
  return [
    { text: 'Colour side down. Fold the top edge down to the bottom edge.', ...V(horiz(0, [0, -h2])) },
    { text: 'Fold it in half from side to side, crease and unfold.', ...crease(vert(0, [-w2, 0.4])) },
    { text: 'Fold the top corners down to meet the centre crease.', ops: [V(through(O, [-1, 1], [-w2, 0.02])), V(through(O, [1, 1], [w2, 0.02]))] },
    { text: 'Fold the front layer of the bottom edge up to the bottom of the triangle.', ...V(horiz(band, [0, h2])), sel: { top: 1 } },
    { text: 'Fold the band up again, over the triangle.', ...V(horiz(w2, [0, band + 0.02])), sel: { top: 2 } },
    turn(0),
    { text: 'Fold the bottom edge up to the bottom of the triangle.', ...V(horiz(band, [0, h2])), sel: { top: 1 } },
    { text: 'Fold the band up again. Open the bottom a little and it sits on your head.', ...V(horiz(w2, [0, band + 0.02])), sel: { top: 2 } },
  ];
}

// House: origami-instructions.com/origami-house.html (square; book fold, cupboard folds, squash the roof)
function houseSteps() {
  const h = S / 2;
  const top = hp(horiz(0, null), [0, -1]);
  return [
    { text: 'Colour side down. Fold the top edge down to the bottom edge, crease and unfold.', ...crease(horiz(0, [0, -S])) },
    { text: 'Fold the top and bottom edges in to the centre crease.', ops: [V(horiz(-h, [0, -S])), V(horiz(h, [0, S]))] },
    { text: 'Fold it in half from side to side, crease and unfold.', ...crease(vert(0, [-S, 0])) },
    turn(0),
    { text: 'Fold the left and right edges in to the centre crease.', ops: [V(vert(-h, [-S, 0])), V(vert(h, [S, 0]))] },
    { text: 'Squash fold: lift the left flap, open the top of it and press its corner out to the side. This is half the roof.',
      ...squash({ hinge: line([-h, -4], [-h, 4]), bisector: line([-h, -h], [0, 0]), flap: [-0.2, -0.2], spine: [-0.08, -h + 0.03], region: [top, hp(vert(0), [-1, 0])] }) },
    { text: 'Squash fold the right flap the same way.',
      ...squash({ hinge: line([h, -4], [h, 4]), bisector: line([h, -h], [0, 0]), flap: [0.2, -0.2], spine: [0.08, -h + 0.03], region: [top, hp(vert(0), [1, 0])] }) },
  ];
}

// Waterbomb base collapse of the square centred on X with half side a (the top corners fold down in front).
// Left and right halves hinge in turn: the lower side triangles fold in along the diagonals, the upper ones along the
// middle crease, and the top triangle comes down over them.
function waterbomb(X, a, lift = 1) {
  const [cx, cy] = X;
  const TL = [cx - a, cy - a], TR = [cx + a, cy - a], BL = [cx - a, cy + a], BR = [cx + a, cy + a];
  const dTL = line(X, TL), dTR = line(X, TR), dBL = line(X, BL), dBR = line(X, BR), hz = line([cx - 4, cy], [cx + 4, cy]);
  const vt = line([cx, cy - 4], [cx, cy + 4]);
  const topP = [cx, cy - a / 2], leftP = [cx - a / 2, cy], rightP = [cx + a / 2, cy], up = [cx, cy - 1], down = [cx, cy + 1];
  const k = [[0, 0], [lift, 180]];
  const J = (l, u) => ({ ...l, up: u, keys: k });
  const sides = [['L', leftP, dTL, dBL, [cx - 1, cy]], ['R', rightP, dTR, dBR, [cx + 1, cy]]];
  const parts = [];
  sides.forEach(([sd, P, dT, dB, outP], i) => {
    const tri = [hp(dT, P), hp(dB, P)];
    parts.push({ sel: 'all', region: [...tri, hp(hz, down)], chain: [J(dB, true)], z: 'top', zo: i });
    parts.push({ sel: 'all', region: [...tri, hp(hz, up)], chain: [J(hz, false), J(dB, true)], z: 'top', zo: 2 + i });
    parts.push({ sel: 'all', region: [hp(dTL, topP), hp(dTR, topP), hp(vt, outP)], chain: [J(dT, true), J(hz, false), J(dB, true)], z: 'top', zo: 4 + i, tag: 'wb' + sd });
  });
  return { type: 'multi', kind: 'Collapse', parts };
}

// Water balloon: origami-instructions.com/origami-water-balloon.html (waterbomb base: origami-waterbomb-base.html)
function balloonSteps() {
  const s = S, q = S / 2;
  const tuck = (sd) => ({ sel: { top: 2 }, region: [hp(horiz(q / 2 + q / 2, null), [0, -1]), hp(vert(0), [sd, 0])],
    chain: [{ a: [-4, q / 2 + q / 2], b: [4, q / 2 + q / 2], up: true, keys: [[0, 0], [1, 180]] }], z: { below: sd < 0 ? 'pocketL' : 'pocketR' } });
  void tuck;
  const yS = q / 2; // shoulder height after the side folds
  const tuckPart = (sd) => ({ sel: { top: 2 }, region: [hp(horiz(yS, null), [0, -1]), hp(vert(0), [sd, 0])],
    chain: [{ a: [-4, yS], b: [4, yS], up: true, keys: [[0, 0], [1, 180]] }], z: { below: sd < 0 ? 'pocketL' : 'pocketR' } });
  const corners = () => ({ ops: [
    { ...V(through([0, s], [-q, q], [-s, s])), sel: { top: 2 } },
    { ...V(through([0, s], [q, q], [s, s])), sel: { top: 2 } }] });
  const sidesIn = () => ({ ops: [
    { ...V(vert(-q / 2, [-q, q])), sel: { top: 4 }, tag: 'pocketL' },
    { ...V(vert(q / 2, [q, q])), sel: { top: 4 }, tag: 'pocketR' }] });
  // the inflated balloon: the four long faces of the hexagon (front left and right, back left and right) open into a
  // square tube seen corner-on, and the triangles above and below the shoulders fold in to close its top and bottom.
  const L = q / 2, a4 = L / R2, yT = q / 2, yB = 3 * q / 2;
  const lineY = (y) => line([-4, y], [4, y]), lineX = (x) => line([x, -4], [x, 4]);
  const cube = [];
  for (const front of [true, false]) {
    for (const sx of [-1, 1]) {
      const sel = front ? { half: 'top' } : 'all';
      const side = hp(lineX(0), [sx, 0]);
      const panel = [{ ...lineX(sx * L), up: front, keys: [[0, 0], [1, 45]] }, { shift: [-sx * (L - a4), 0, 0], keys: [[0, 0], [1, 1]] }];
      const lid = (y, keep) => ({ sel, region: [side, hp(lineY(y), keep)], chain: [{ ...lineY(y), up: !front, keys: [[0, 0], [0.25, 0], [1, 90]] }, ...panel] });
      cube.push(lid(yT, [0, -1]));
      cube.push(lid(yB, [0, 2]));
      cube.push({ sel, region: [side, hp(lineY(yT), [0, 1]), hp(lineY(yB), [0, 0])], chain: panel });
    }
  }
  return [
    { text: 'Colour side up. Fold in half from side to side, crease and unfold.', ...crease(vert(0, [-s, 0])) },
    { text: 'Fold in half from top to bottom, crease and unfold.', ...crease(horiz(0, [0, -s])) },
    turn(0),
    { text: 'Fold in half from corner to corner, crease and unfold.', ...crease({ a: [-s, s], b: [s, -s], move: [-s, -s] }) },
    { text: 'Fold in half along the other diagonal, crease and unfold.', ...crease({ a: [-s, -s], b: [s, s], move: [s, -s] }) },
    { text: 'Push the sides in along the creases and flatten the top down into a triangle. This is the waterbomb base.', ...waterbomb([0, 0], s), arrows: [[[-s, 0.02], [-s / 2, 0.12]], [[s, 0.02], [s / 2, 0.12]]] },
    { text: 'Fold the bottom corners of the front flaps up to the top point.', ...corners() },
    turn(0),
    { text: 'Fold the bottom corners up to the top point on this side too.', ...corners() },
    { text: 'Fold the left and right corners of the front flaps in to the centre line.', ...sidesIn() },
    { text: 'Fold the loose top flaps down and tuck them into the pockets of the side flaps.', type: 'multi', kind: 'Fold and tuck', parts: [tuckPart(-1), tuckPart(1)] },
    turn(0),
    { text: 'Fold the left and right corners in to the centre line on this side.', ...sidesIn() },
    { text: 'Fold the loose top flaps down and tuck them into the pockets.', type: 'multi', kind: 'Fold and tuck', parts: [tuckPart(-1), tuckPart(1)] },
    pull('Blow gently into the little hole at the bottom. The balloon fills out.', cube,
    { cta: 'Blow into the hole', camera: { yaw: 22, pitch: 24, pivot: [0, q] } }),
  ];
}

// Jumping frog: origami-fun.com/origami-jumping-frog.html (A4-shaped sheet)
const FROG = { w: 1.1, h: 1.1 * R2 };
function frogSteps() {
  const w2 = FROG.w / 2, h2 = FROG.h / 2;
  const a = w2, c = -h2 + w2; // the top square's centre
  const yEdge = h2, yMid = c + a / 2;
  const f1 = (yEdge + yMid) / 2, f2 = (f1 + yMid) / 2;
  const aboveBase = [{ a: [-4, c + a], b: [4, c + a], keep: [0, c] }];
  return [
    { text: 'Colour side down. Fold in half lengthwise, crease and unfold.', ...crease(vert(0, [-w2, 0])) },
    { text: 'Fold the top left corner across to the right edge, crease and unfold.', ...crease({ a: [w2, -h2], b: [-w2, -h2 + FROG.w], move: [-w2, -h2] }) },
    { text: 'Fold the top right corner across to the left edge, crease and unfold.', ...crease({ a: [-w2, -h2], b: [w2, -h2 + FROG.w], move: [w2, -h2] }) },
    { text: 'Where the creases cross, fold the top behind, crease and unfold.', ...M({ ...horiz(c, [0, -h2]), unfold: true }) },
    { text: 'Bring the sides in along the creases and flatten the top into a triangle.', ...waterbomb([0, c], a), arrows: [[[-a, c], [-a / 2, c + 0.12]], [[a, c], [a / 2, c + 0.12]]] },
    { text: 'Fold the bottom corners of the front flaps up to the top point. These are the front legs.', ops: [
      { ...V(through([0, c + a], [-a / 2, c + a / 2], [-a, c + a - 0.01])), sel: { top: 2 }, clip: aboveBase },
      { ...V(through([0, c + a], [a / 2, c + a / 2], [a, c + a - 0.01])), sel: { top: 2 }, clip: aboveBase }] },
    { text: 'Fold the sides in to the centre line.', ops: [V(vert(-a / 2, [-a, 0.3])), V(vert(a / 2, [a, 0.3]))] },
    { text: 'Fold the bottom up so its edge sits in the middle of the diamond.', ...V(horiz(f1, [0, yEdge])), tag: 'spring' },
    { text: 'Fold that flap back down in half. This pleat is the spring.', ...V(horiz(f2, [0, yMid + 0.01])), sel: { tag: 'spring' } },
    turn(0, 'Turn it over. That is the frog, sitting on its spring.'),
    pull('Press its back down and let go: it jumps!', [
      { sel: 'all', region: [], chain: [
        { a: [-4, f2], b: [4, f2], up: true, keys: [[0, 0], [0.3, 8], [0.6, 48], [1, 14]] },
        { shift: [0, -0.32, 0.12], keys: [[0, 0], [0.3, 0], [0.6, 1], [1, 0]] }] },
    ], { cta: 'Press and let go', camera: { yaw: 28, pitch: 22, pivot: [0, f2] } }),
  ];
}

// Swan: origami-instructions.com/origami-swan.html
function swanSteps() {
  const nb = Math.tan(Math.PI / 16) * 1; // narrow kite: crease from the bottom point, 11.25 degrees off the axis
  const kTop = [KITE[0], KITE[1]];
  void kTop;
  const yNeck = 0;
  return [
    { text: 'Colour side down. Fold the left corner onto the right, crease and unfold.', ...crease(vert(0, L)) },
    { text: 'Fold the lower edges in to the centre crease: a kite base.', ops: [V(through(B, KITE, R)), V(through(B, [-KITE[0], KITE[1]], L))] },
    turn(0),
    { text: 'Fold the lower edges in to the centre line again, to make it slim.', ops: [
      V(through(B, [nb * 2, -1], [0.4, 0.2])), V(through(B, [-nb * 2, -1], [-0.4, 0.2]))] },
    { text: 'Fold the long point up to the top point.', ...V(horiz(yNeck, B)), tag: 'neck' },
    { text: 'Fold the tip back down to make the head.', ...V(horiz(-0.78, [0, -0.95])), sel: { tag: 'neck' }, tag: 'head' },
    { text: 'Fold the swan in half, the left half behind.', ...M(vert(0, L)) },
    rotate(-90, [0, 0], 'Turn the swan so its body lies flat.'),
    { text: 'Pull the neck up away from the body and press its base flat (an outside reverse fold).', ...V(through([0, 0], [1, 1], [-0.5, -0.05])), sel: { tag: ['neck', 'head'] }, place: 'outside' },
    { text: 'Pull the head out the same way.', ...V(through([0, -0.78], [0.425, 0.125], [-0.01, -0.65])), sel: { tag: 'head' }, place: 'outside' },
  ];
}

// Fortune teller (cootie catcher): origami-instructions.com/origami-fortune-teller.html
function fortuneSteps() {
  const s = S, h = S / 2;
  const corners = (r) => [V(bis([-r, -r], O)), V(bis([r, -r], O)), V(bis([r, r], O)), V(bis([-r, r], O))];
  const diamondCorners = (r) => [V(bis([0, -r], O)), V(bis([r, 0], O)), V(bis([0, r], O)), V(bis([-r, 0], O))];
  // opening: eight wedges round the centre; the diagonals rise as ridges, the middle creases stay as valleys
  const sectors = [];
  for (let k = 0; k < 8; k++) {
    const a0 = (k * Math.PI) / 4, a1 = ((k + 1) * Math.PI) / 4;
    const ray = (a) => [Math.cos(a), Math.sin(a)];
    const book = k % 2 === 0 ? a0 : a1, diag = k % 2 === 0 ? a1 : a0;
    const len = (a) => (Math.abs(Math.cos(a)) > 0.9 || Math.abs(Math.sin(a)) > 0.9 ? h : h * R2);
    const mida = (a0 + a1) / 2, inside = [Math.cos(mida) * 0.1, Math.sin(mida) * 0.1];
    sectors.push({ sel: 'all', region: [hp(line(O, ray(a0)), inside), hp(line(O, ray(a1)), inside)],
      chain: [{ sector: { o: O, b: add(O, ray(book), len(book)), d: add(O, ray(diag), len(diag)) }, keys: [[0, 0], [1, 55]] }] });
  }
  return [
    { text: 'Colour side down. Fold in half both ways, crease and unfold.', ops: [crease(vert(0, [-s, 0])), crease(horiz(0, [0, -s]))] },
    { text: 'Fold in half along both diagonals, crease and unfold.', ops: [crease({ a: [-s, s], b: [s, -s], move: [-s, -s] }), crease({ a: [-s, -s], b: [s, s], move: [s, -s] })] },
    { text: 'Fold all four corners in to the centre.', ops: corners(s) },
    turn(0),
    { text: 'Fold the four corners in to the centre again.', ops: diamondCorners(s) },
    { text: 'Fold in half both ways, crease and unfold.', ops: [crease(vert(0, [-h, 0])), crease(horiz(0, [0, -h]))] },
    turn(0, 'Turn it over. The four little squares are the pockets for your fingers.'),
    pull('Slide your thumbs and fingers under the four squares and push the corners up together.', sectors,
      { cta: 'Open the fortune teller', camera: { pitch: -52, yaw: 14 } }),
  ];
}

// ================================================================ decoration of the finished models
const DECOR = {
  dog: () => [
    eye(-0.2, 0.3), eye(0.2, 0.3), shine(-0.19, 0.29), shine(0.21, 0.29),
    { t: 'ellipse', x: 0, y: 0.6, rx: 0.08, ry: 0.055, rot: 0, fill: INK },
    { t: 'line', pts: [[0, 0.65], [0, 0.7]], color: INK, w: 0.02 },
  ],
  cat: () => [
    eye(-0.2, -0.42), eye(0.2, -0.42),
    { t: 'poly', pts: [[-0.045, -0.27], [0.045, -0.27], [0, -0.21]], fill: PINK },
    { t: 'line', pts: [[-0.12, -0.22], [-0.38, -0.27]], color: INK, w: 0.012 },
    { t: 'line', pts: [[-0.12, -0.19], [-0.37, -0.16]], color: INK, w: 0.012 },
    { t: 'line', pts: [[0.12, -0.22], [0.38, -0.27]], color: INK, w: 0.012 },
    { t: 'line', pts: [[0.12, -0.19], [0.37, -0.16]], color: INK, w: 0.012 },
  ],
  fox: () => [
    { t: 'line', pts: [[-0.24, -0.5], [-0.1, -0.44]], color: INK, w: 0.035 },
    { t: 'line', pts: [[0.24, -0.5], [0.1, -0.44]], color: INK, w: 0.035 },
    { t: 'dot', x: 0, y: -0.07, r: 0.04, fill: INK },
  ],
  cicada: () => [eye(-0.08, -0.7, 0.03), eye(0.08, -0.7, 0.03)],
  whale: () => [eye(0.42, 0.02, 0.035), shine(0.43, 0.01, 0.012)],
  frog: () => [eye(-0.12, -0.08, 0.04), eye(0.12, -0.08, 0.04), shine(-0.11, -0.09, 0.014), shine(0.13, -0.09, 0.014)],
  house: () => [
    { t: 'poly', pts: [[-0.08, 0.35], [-0.08, 0.17], [0.08, 0.17], [0.08, 0.35]], fill: '#6B4A32' },
    { t: 'dot', x: 0.05, y: 0.27, r: 0.011, fill: '#E2B04A' },
  ],
};

export const MODELS = [
  { id: 'cup', name: 'Cup', level: 'Easy', blurb: 'A little drinking cup that really opens.', startFace: -1, steps: cupSteps(), source: 'origami-instructions.com/origami-cup.html' },
  { id: 'dog', name: 'Dog face', level: 'Easy', blurb: 'Floppy ears and a dark nose.', startFace: -1, steps: dogSteps(), decor: DECOR.dog, source: 'origami-instructions.com/origami-dog-face.html' },
  { id: 'cat', name: 'Cat face', level: 'Easy', blurb: 'Pointed ears, whiskers and a pink nose.', startFace: -1, steps: catSteps(), decor: DECOR.cat, source: 'origami-instructions.com/origami-cat-face.html' },
  { id: 'fox', name: 'Fox face', level: 'Easy', blurb: 'A sharp little fox with keen eyes.', startFace: -1, steps: foxSteps(), decor: DECOR.fox, source: 'origami-instructions.com/origami-fox-face.html' },
  { id: 'tulip', name: 'Tulip', level: 'Easy', blurb: 'Three petals and a reverse-folded base.', startFace: -1, steps: tulipSteps(), source: 'origami-instructions.com/easy-origami-tulip.html' },
  { id: 'envelope', name: 'Envelope', level: 'Easy', blurb: 'Folded colour-side in, so the patterns meet in the middle.', startFace: -1, steps: envelopeSteps(), source: 'origami-instructions.com/origami-blintz-base.html' },
  { id: 'whale', name: 'Whale', level: 'Easy', blurb: 'A kite base turned into a whale with a lifted tail.', startFace: -1, steps: whaleSteps(), decor: DECOR.whale, source: 'origami-instructions.com/easy-origami-whale.html' },
  { id: 'cicada', name: 'Cicada', level: 'Easy', blurb: 'A summer insect with wide wings.', startFace: -1, steps: cicadaSteps(), decor: DECOR.cicada, source: 'origami-instructions.com/origami-cicada.html' },
  { id: 'heart', name: 'Heart', level: 'Medium', blurb: 'The classic folded heart, neat on both sides.', startFace: -1, steps: heartSteps(), source: 'origami-instructions.com/easy-origami-heart.html' },
  { id: 'helmet', name: 'Samurai helmet', level: 'Medium', blurb: 'A kabuto with two horns and a folded brim.', startFace: -1, steps: helmetSteps(), source: 'origami-instructions.com/origami-samurai-helmet.html' },
  { id: 'hat', name: 'Paper hat', level: 'Medium', blurb: 'The newspaper hat, from an A4 sheet.', startFace: -1, pose: HAT, steps: hatSteps(), source: 'origami-instructions.com/origami-hat.html' },
  { id: 'house', name: 'House', level: 'Medium', blurb: 'A cottage whose roof is two squash folds.', startFace: -1, pose: 'square', steps: houseSteps(), decor: DECOR.house, source: 'origami-instructions.com/origami-house.html' },
  { id: 'swan', name: 'Swan', level: 'Medium', blurb: 'A double kite with a pulled-up neck.', startFace: -1, steps: swanSteps(), source: 'origami-instructions.com/origami-swan.html' },
  { id: 'frog', name: 'Jumping frog', level: 'Medium', blurb: 'From an A4 sheet; press its back and it hops.', startFace: -1, pose: FROG, steps: frogSteps(), decor: DECOR.frog, source: 'origami-fun.com/origami-jumping-frog.html' },
  { id: 'fortune', name: 'Fortune teller', level: 'Medium', blurb: 'The cootie catcher: four pockets that open and close.', startFace: -1, pose: 'square', steps: fortuneSteps(), source: 'origami-instructions.com/origami-fortune-teller.html' },
  { id: 'balloon', name: 'Water balloon', level: 'Patient', blurb: 'A waterbomb base, tucked shut and blown up.', startFace: 1, pose: 'square', steps: balloonSteps(), source: 'origami-instructions.com/origami-water-balloon.html' },
  { id: 'flapping', name: 'Flapping bird', level: 'Patient', blurb: 'A bird base whose wings flap when you pull its tail.', startFace: -1, steps: flappingSteps(), source: 'origami-instructions.com/origami-flapping-bird.html' },
  { id: 'crane', name: 'Crane', level: 'Patient', blurb: 'The traditional crane: squash folds, petal folds, reverse folds.', startFace: -1, steps: craneSteps(), source: 'origami-instructions.com/origami-crane.html' },
];

export function getModel(id) { return MODELS.find((m) => m.id === id) || null; }
void ORANGE; void meet; void lineAt; void mid;
