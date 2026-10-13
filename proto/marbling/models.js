// models.js - the origami model definitions (pure data built with fold.js ops).
// World units are "diamond units" (sheet half-diagonal = 1). Every model starts as the diamond unless pose:'square'.
// decor: marks "drawn on with a pen" over the finished model (eyes, noses, windows). Shapes:
//   {t:'dot', x, y, r, fill} {t:'ellipse', x, y, rx, ry, rot, fill} {t:'poly', pts, fill} {t:'line', pts, color, w}

import { reflectPoint, creaseLine } from './fold.js';

export const LEVELS = ['Easy', 'Medium', 'Patient'];

const T = [0, -1], B = [0, 1], L = [-1, 0], R = [1, 0], O = [0, 0];
const INK = '#2A2622', CREAM = '#FBF8F1', ORANGE = '#E08A2E', PINK = '#E6879A', GOLD = '#E2B04A', WALNUT = '#6B4A32';

// ---------------------------------------------------------------- helpers
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
function refl(P, a, b) { // reflect P across the line through a and b
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
const V = (o) => ({ dir: 'valley', ...o });
const M = (o) => ({ dir: 'mountain', ...o });

// the sheet folded in half into a triangle with its point down (base on top)
const triDown = (text = 'Fold the top point down and behind, to meet the bottom point.') => ({ text, ...M(horiz(0, T)) });

// two wing folds from creases at x = -+a that meet at the bottom point
function wings(a, textL, textR) {
  return [
    { text: textL, ...V(through([-a, 0], B, L)) },
    { text: textR, ...V(through([a, 0], B, R)), sel: { bottom: 2 } },
  ];
}

// fold a small corner behind (mountain) to blunt it
function chamfer(tip, p, q, k, dir = 'mountain') {
  return { a: toward(tip, p, k), b: toward(tip, q, k), move: tip, dir };
}
function roundLobe(tip, p, q) { // chop the tip, then chop the two new corners
  const P1 = toward(tip, p, 0.24), P2 = toward(tip, q, 0.24);
  return [
    { a: P1, b: P2, move: tip, dir: 'mountain' },
    chamfer(P1, toward(P1, p, 1), P2, 0.12),
    chamfer(P2, toward(P2, q, 1), P1, 0.12),
  ];
}

const eye = (x, y, r = 0.045) => ({ t: 'dot', x, y, r, fill: INK });
const shine = (x, y, r = 0.016) => ({ t: 'dot', x, y, r, fill: CREAM });

// ---------------------------------------------------------------- cup / sailboat
const CUP_H = 2 / (2 + Math.SQRT2);
function cupSteps(full) {
  const Ql = [CUP_H - 1, -CUP_H], Qr = [1 - CUP_H, -CUP_H];
  const s = [
    { text: 'Fold the bottom point up and behind, to meet the top point.', ...M(horiz(0, B)) },
    { text: 'Fold the left point across so it just touches the right edge.', ...V(bis(L, Qr)) },
    { text: 'Fold the right point across so it just touches the left edge.', ...V(bis(R, Ql)) },
  ];
  if (full) {
    s.push({ text: "Fold the front point down to make the cup's lip.", ...V(horiz(-CUP_H, T)), sel: { top: 1 } });
    s.push({ text: 'Turn it and fold the back point down the same way.', ...M(horiz(-CUP_H, T)), sel: { bottom: 1 } });
  }
  return s;
}

// ---------------------------------------------------------------- heart
function heartSteps() {
  const A1 = [-0.14, 0], A2 = [0.14, 0];
  const tipR = refl(L, A1, B), tipL = refl(R, A2, B);
  return [
    triDown(),
    ...wings(0.14, 'Fold the left point across, along a crease from near the middle down to the bottom point.', 'Now the right point, the same way. It lands over the first.'),
    { text: 'Tuck the corners of the right lobe behind to round it.', ops: roundLobe(tipR, A1, B) },
    { text: 'Round the other lobe the same way.', ops: roundLobe(tipL, A2, B) },
  ];
}

// ---------------------------------------------------------------- tulip, fox, cat
const tulipSteps = () => [
  triDown(),
  ...wings(0.6, 'Fold the left point across from a wide crease. It becomes a petal.', 'Fold the right point across for the second petal.'),
  { text: 'Fold the bottom point up. This is the third petal.', ...V(horiz(0.325, B)) },
];
const foxSteps = () => [
  triDown(),
  ...wings(0.45, 'Fold the left point across to make an ear.', 'Fold the right point across for the other ear.'),
  { text: 'Tip the chin up to show a pale muzzle.', ...V(horiz(0.78, B)) },
];
const catSteps = () => [
  triDown(),
  ...wings(0.55, 'Fold the left point across to make an ear.', 'Fold the right point across for the other ear.'),
  { text: 'Tip the chin up for a small muzzle.', ...V(horiz(0.62, B)) },
];

// ---------------------------------------------------------------- dog
const dogSteps = () => [
  triDown(),
  { text: 'Fold the left top corner down for a floppy ear.', ...V(through([-0.5, 0], [-0.75, 0.25], L)) },
  { text: 'Fold the right top corner down for the other ear.', ...V(through([0.5, 0], [0.75, 0.25], R)) },
  { text: 'Tuck the nose behind to round it.', ...M(horiz(0.86, B)) },
];

// ---------------------------------------------------------------- envelope
const envelopeSteps = () => [
  { text: 'The colour side is face down. Fold the left point to the middle.', ...V(bis(L, O)) },
  { text: 'Fold the right point to the middle.', ...V(bis(R, O)) },
  { text: 'Fold the bottom point up to the middle.', ...V(bis(B, O)) },
  { text: 'Close the flap: the top point comes down to the middle.', ...V(bis(T, O)) },
];

// ---------------------------------------------------------------- house
const houseSteps = () => [
  { text: 'Fold the left point to the middle.', ...V(bis(L, O)) },
  { text: 'Fold the right point to the middle.', ...V(bis(R, O)) },
  { text: 'Fold the bottom point up to the middle to make the floor.', ...V(bis(B, O)) },
];

// ---------------------------------------------------------------- kite
const kiteE = [-0.5857864376, -0.4142135624];
const kiteSteps = () => [
  { text: 'Fold the lower left edge to the middle line.', ...V(through(B, kiteE, L)) },
  { text: 'Fold the lower right edge to the middle line.', ...V(through(B, [-kiteE[0], kiteE[1]], R)) },
  { text: 'Fold the top point down a little to square the sail.', ...V(horiz(-0.82, T)) },
];

// ---------------------------------------------------------------- fish (a heart turned on its side)
function fishSteps() {
  const a = 0.25;
  return [
    { text: 'Fold the left point over to the right, behind.', ...M(vert(0, L)) },
    { text: 'Fold the bottom corner across, from a crease near the middle out to the nose.', ...V(through([0, a], R, B)) },
    { text: 'Fold the top corner across the same way. The two corners make the tail.', ...V(through([0, -a], R, T)), sel: { bottom: 2 } },
  ];
}

// ---------------------------------------------------------------- penguin
const penE = [-0.5857864376, 0.4142135624];
const penguinSteps = () => [
  { text: 'Fold the upper left edge to the middle line, behind.', ...M(through(T, penE, L)) },
  { text: 'Fold the upper right edge to the middle line, behind.', ...M(through(T, [-penE[0], penE[1]], R)) },
  { text: "Fold the top point down to make the head and beak.", ...V(horiz(-0.55, T)) },
  { text: 'Tuck the bottom point behind so it can stand.', ...M(horiz(0.8, B)) },
];

// ---------------------------------------------------------------- paper hat (starts as a square)
const HS = Math.SQRT2 / 2; // half side
const HM = 0.507; // half width after the margins are folded in
const hatSteps = () => [
  { text: 'Colour side down. Fold the left edge in a little.', ...V(vert(-HM, [-HS, 0])) },
  { text: 'Fold the right edge in the same amount.', ...V(vert(HM, [HS, 0])) },
  { text: 'Fold the top down over the bottom.', ...V(horiz(0, [0, -HS])) },
  { text: 'Fold the top left corner down to the middle line.', ...V(bis([-HM, 0], [0, HM])) },
  { text: 'Fold the top right corner down to meet it.', ...V(bis([HM, 0], [0, HM])) },
  { text: 'Fold the lower band up to make the brim.', ...V(horiz(HM, [0, HS])) },
];

// ---------------------------------------------------------------- swan
const swEt = [-0.4142135624, -0.5857864376], swEb = [-0.4142135624, 0.5857864376];
function swanSteps() {
  const neckLine = { a: [4.4, -4], b: [-3.6, 4], move: R };
  const headLine = { a: [4, -4], b: [-4, 4], move: [0.4, -0.6] };
  const tailU = unit([-1.5, -0.87]);
  const tailQ = [-0.72, 0];
  const tailLine = { a: add(tailQ, tailU, -4), b: add(tailQ, tailU, 4), move: [-1, 0] };
  return [
    { text: 'Fold the upper right edge to the middle line, behind.', ...M(through(R, swEt, T)) },
    { text: 'Fold the lower right edge to the middle line, behind.', ...M(through(R, swEb, B)) },
    { text: 'Fold the whole thing in half, bottom half behind.', ...M(horiz(0, [-0.2, 0.3])) },
    { text: 'Reverse-fold the pointed end up inside itself to make the neck.', ...V(neckLine), place: 'inside' },
    { text: 'Reverse-fold the tip of the neck forward to make the head.', ...V(headLine), place: 'inside', clip: [{ a: [0.25, -4], b: [0.25, 4], keep: [0.45, -0.5] }] },
    { text: 'Reverse-fold the tail up a little.', ...V(tailLine), place: 'inside' },
  ];
}

// ---------------------------------------------------------------- bird base, crane, flapping bird
const WAIST = 1 - Math.SQRT1_2; // 0.2929: where the petals hinge
const PL = [-WAIST, WAIST], PR = [WAIST, WAIST];
const S1 = [-0.5, 0.5], S2 = [0.5, 0.5];
const NARROW = Math.tan(Math.PI / 16) * (1 - WAIST);
const waistClip = [{ a: [-4, WAIST], b: [4, WAIST], keep: [0, 0.9] }];

function birdBaseSteps(withHint = true) {
  void withHint;
  return [
    { text: 'Start colour side down. Fold the diamond in half along a diagonal, upper left half behind.', ...M({ a: [-4, 4], b: [4, -4], move: T }) },
    { text: 'Fold it in half again. This is the square base: four layers, open end at the bottom.', ...M({ a: [-4, -4], b: [4, 4], move: R }), label: true },
    { text: 'Fold both lower edges in to the middle line.', ops: [V(through(B, PL, S1)), V(through(B, PR, S2))] },
    { text: 'Petal fold the front: lift its bottom corner up and let the sides come in.', ...V({ a: [-4, WAIST], b: [4, WAIST], move: B }), sel: { grp: [3] }, tag: 'wing' },
    { text: 'Turn over and petal fold the back the same way. This is the bird base.', ...M({ a: [-4, WAIST], b: [4, WAIST], move: B }), sel: { grp: [0] }, tag: 'wing' },
  ];
}

// returns { steps, neckTip, headTip }
function legNarrowOps(grp, dir) {
  const wl = [-NARROW, WAIST], wr = [NARROW, WAIST];
  const mk = (b, move) => ({ a: B, b, move, dir, sel: { grp: [grp] }, clip: waistClip });
  return [mk(wl, PL), mk(wr, PR)];
}

function reverseLine(point, from, to) { // crease through `point` that turns direction `from` into direction `to`
  const u = unit([from[0] + to[0], from[1] + to[1]]);
  return { a: add(point, u, -4), b: add(point, u, 4) };
}

function craneParts(narrow) {
  const Q = [0, 0.45];
  const vNeck = unit([-0.77, -0.64]);
  const vTail = unit([0.77, -0.64]);
  const nl = reverseLine(Q, [0, 1], vNeck);
  const tl = reverseLine(Q, [0, 1], vTail);
  const neckTip = reflectPoint(B, creaseLine({ ...nl, move: B }));
  const vHead = unit([-0.55, 0.84]);
  const hp = add(neckTip, vNeck, -0.16);
  const hl = reverseLine(hp, vNeck, vHead);
  const headTip = reflectPoint(neckTip, creaseLine({ ...hl, move: neckTip }));
  const ops = {
    neck: { ...nl, move: B, dir: 'valley', place: 'inside', sel: { grp: [2] } },
    tail: { ...tl, move: B, dir: 'valley', place: 'inside', sel: { grp: [1] } },
    head: { ...hl, move: neckTip, dir: 'valley', place: 'inside', sel: { grp: [2] } },
  };
  void narrow;
  return { ops, neckTip, headTip, vHead };
}

const wingOps = (deg) => [
  { type: 'rotate', pivot: [0, WAIST], angle: (deg * Math.PI) / 180, sel: { tag: 'wing', grp: [3] }, move: [0, -0.4] },
  { type: 'rotate', pivot: [0, WAIST], angle: (-deg * Math.PI) / 180, sel: { tag: 'wing', grp: [0] }, move: [0, -0.4], mirror: true },
];

function craneSteps() {
  const { ops } = craneParts();
  return [
    ...birdBaseSteps(),
    { text: 'Fold the lower edges of both legs in to the middle, front and back, to make them slim.', ops: [...legNarrowOps(2, 'valley'), ...legNarrowOps(1, 'mountain')] },
    { text: 'Reverse-fold the front leg up inside itself and out to the left. This is the neck.', ...ops.neck },
    { text: 'Reverse-fold the back leg up and out to the right. This is the tail.', ...ops.tail },
    { text: 'Reverse-fold the tip of the neck down inside itself to make the head.', ...ops.head },
    { text: 'Open the wings out, one to each side.', ops: wingOps(24) },
  ];
}
function flappingSteps() {
  const { ops } = craneParts();
  return [
    ...birdBaseSteps(),
    { text: 'Reverse-fold the front leg up inside itself and out to the left. This is the neck.', ...ops.neck },
    { text: 'Reverse-fold the tip of the neck down to make the head.', ...ops.head },
    { text: 'Open the wings out, one to each side.', ops: wingOps(24) },
  ];
}

// ---------------------------------------------------------------- decoration of the finished models
function craneDecor() {
  const { headTip, vHead } = craneParts();
  const e = add(headTip, vHead, -0.055);
  return [{ t: 'dot', x: e[0] - vHead[1] * 0.0, y: e[1] - 0.012, r: 0.02, fill: INK }];
}

const DECOR = {
  dog: () => [
    eye(-0.27, 0.2), eye(0.27, 0.2), shine(-0.26, 0.19), shine(0.28, 0.19),
    { t: 'ellipse', x: 0, y: 0.8, rx: 0.1, ry: 0.07, rot: 0, fill: INK },
    { t: 'line', pts: [[0, 0.46], [0, 0.55]], color: INK, w: 0.025 },
    { t: 'line', pts: [[-0.12, 0.6], [0, 0.55], [0.12, 0.6]], color: INK, w: 0.025 },
  ],
  fox: () => [
    { t: 'line', pts: [[-0.27, 0.08], [-0.12, 0.17]], color: INK, w: 0.04 },
    { t: 'line', pts: [[0.27, 0.08], [0.12, 0.17]], color: INK, w: 0.04 },
    { t: 'dot', x: 0, y: 0.7, r: 0.055, fill: INK },
  ],
  cat: () => [
    eye(-0.24, 0.2), eye(0.24, 0.2),
    { t: 'poly', pts: [[-0.05, 0.31], [0.05, 0.31], [0, 0.38]], fill: PINK },
    { t: 'line', pts: [[-0.25, 0.4], [-0.52, 0.34]], color: INK, w: 0.014 },
    { t: 'line', pts: [[-0.25, 0.44], [-0.5, 0.46]], color: INK, w: 0.014 },
    { t: 'line', pts: [[0.25, 0.4], [0.52, 0.34]], color: INK, w: 0.014 },
    { t: 'line', pts: [[0.25, 0.44], [0.5, 0.46]], color: INK, w: 0.014 },
  ],
  fish: () => [
    { t: 'dot', x: 0.52, y: -0.1, r: 0.06, fill: CREAM }, eye(0.53, -0.1, 0.03),
    { t: 'line', pts: [[0.34, -0.22], [0.3, 0], [0.34, 0.22]], color: INK, w: 0.02 },
  ],
  house: () => [
    { t: 'poly', pts: [[-0.13, 0.5], [-0.13, 0.12], [0.13, 0.12], [0.13, 0.5]], fill: WALNUT },
    { t: 'dot', x: 0.08, y: 0.32, r: 0.015, fill: GOLD },
    { t: 'poly', pts: [[-0.4, -0.15], [-0.4, 0.05], [-0.2, 0.05], [-0.2, -0.15]], fill: GOLD },
    { t: 'poly', pts: [[0.2, -0.15], [0.2, 0.05], [0.4, 0.05], [0.4, -0.15]], fill: GOLD },
    { t: 'poly', pts: [[0.2, -0.82], [0.2, -1.02], [0.36, -1.02], [0.36, -0.68]], fill: WALNUT },
  ],
  kite: () => [
    { t: 'line', pts: [[0, -0.82], [0, 1]], color: INK, w: 0.02 },
    { t: 'line', pts: [[-0.586, -0.414], [0.586, -0.414]], color: INK, w: 0.02 },
    { t: 'line', pts: [[0, 1], [0.1, 1.15], [-0.1, 1.3], [0.1, 1.45], [-0.1, 1.6]], color: INK, w: 0.025 },
    { t: 'poly', pts: [[0.1, 1.15], [0.22, 1.1], [0.22, 1.22]], fill: ORANGE },
    { t: 'poly', pts: [[-0.1, 1.3], [-0.22, 1.25], [-0.22, 1.37]], fill: GOLD },
    { t: 'poly', pts: [[0.1, 1.45], [0.22, 1.4], [0.22, 1.52]], fill: ORANGE },
  ],
  penguin: () => [
    { t: 'ellipse', x: 0, y: 0.3, rx: 0.3, ry: 0.42, rot: 0, fill: CREAM },
    { t: 'poly', pts: [[-0.1, -0.55], [0.1, -0.55], [0, -0.28]], fill: ORANGE },
    eye(-0.12, -0.42, 0.04), eye(0.12, -0.42, 0.04), shine(-0.11, -0.43, 0.013), shine(0.13, -0.43, 0.013),
    { t: 'ellipse', x: -0.13, y: 0.83, rx: 0.1, ry: 0.045, rot: 0, fill: ORANGE },
    { t: 'ellipse', x: 0.13, y: 0.83, rx: 0.1, ry: 0.045, rot: 0, fill: ORANGE },
  ],
  sailboat: () => [
    { t: 'line', pts: [[0, -1.2], [0, -0.1]], color: WALNUT, w: 0.03 },
    { t: 'poly', pts: [[0, -1.2], [0, -1.04], [0.2, -1.12]], fill: GOLD },
  ],
};

export const MODELS = [
  { id: 'cup', name: 'Cup', level: 'Easy', blurb: 'A little drinking cup for the studio.', startFace: 1, steps: cupSteps(true) },
  { id: 'sailboat', name: 'Sailboat', level: 'Easy', blurb: 'A hull and a sail, from the first three cup folds.', startFace: 1, steps: cupSteps(false).map((s, i) => ({ ...s, text: ['Fold the bottom point up and behind. The sail will be the top point.', 'Fold the left point across to start the hull.', 'Fold the right point across to finish the hull.'][i] })), decor: DECOR.sailboat },
  { id: 'house', name: 'House', level: 'Easy', blurb: 'A cottage with a pointed roof and a door.', startFace: 1, steps: houseSteps(), decor: DECOR.house },
  { id: 'envelope', name: 'Envelope', level: 'Easy', blurb: 'Folded colour-side in, so the patterns meet in the middle.', startFace: -1, steps: envelopeSteps() },
  { id: 'kite', name: 'Kite', level: 'Easy', blurb: 'A kite with a ribbon tail.', startFace: 1, steps: kiteSteps(), decor: DECOR.kite },
  { id: 'fish', name: 'Fish', level: 'Easy', blurb: 'A slim fish with a forked tail.', startFace: 1, steps: fishSteps(), decor: DECOR.fish },
  { id: 'dog', name: 'Dog face', level: 'Easy', blurb: 'Floppy ears and a dark nose.', startFace: 1, steps: dogSteps(), decor: DECOR.dog },
  { id: 'cat', name: 'Cat face', level: 'Easy', blurb: 'Two ears, a small muzzle and whiskers.', startFace: 1, steps: catSteps(), decor: DECOR.cat },
  { id: 'fox', name: 'Fox face', level: 'Easy', blurb: 'Tall ears and a pale chin.', startFace: 1, steps: foxSteps(), decor: DECOR.fox },
  { id: 'heart', name: 'Heart', level: 'Easy', blurb: 'Two round lobes and a point.', startFace: 1, steps: heartSteps() },
  { id: 'tulip', name: 'Tulip', level: 'Easy', blurb: 'A flower head with three petals.', startFace: 1, steps: tulipSteps() },
  { id: 'penguin', name: 'Penguin', level: 'Medium', blurb: 'A standing penguin with a beak.', startFace: 1, steps: penguinSteps(), decor: DECOR.penguin },
  { id: 'hat', name: 'Paper hat', level: 'Medium', blurb: 'A sailor hat with a turned-up brim.', startFace: -1, pose: 'square', steps: hatSteps() },
  { id: 'swan', name: 'Swan', level: 'Medium', blurb: 'A swan with a curved neck, folded with reverse folds.', startFace: 1, steps: swanSteps(), decor: () => swanDecor() },
  { id: 'flapping', name: 'Flapping bird', level: 'Patient', blurb: 'A bird base with a neck, head and wings.', startFace: -1, steps: flappingSteps(), decor: () => craneDecor() },
  { id: 'crane', name: 'Crane', level: 'Patient', blurb: 'The traditional crane: bird base, petal folds, reverse folds.', startFace: -1, steps: craneSteps(), decor: () => craneDecor() },
];

function swanDecor() {
  return [
    { t: 'dot', x: 0.47, y: -0.43, r: 0.02, fill: INK },
    { t: 'poly', pts: [[0.52, -0.465], [0.71, -0.4], [0.52, -0.37]], fill: ORANGE },
  ];
}

export function getModel(id) { return MODELS.find((m) => m.id === id) || null; }
