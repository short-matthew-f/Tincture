// blocks.js — quilt block geometry and the traditional block library (pure).
//
// A block is an n×n grid of cells. Units are rectangles of whole cells, each
// with a shape (square, HST, QST, flying geese, ...) drawn in a canonical
// orientation inside the unit square [0,1]² (y down), then optionally
// mirrored left-right (flip) and turned clockwise in quarter turns (rot),
// then stretched onto the unit's rectangle of cells.
//
//   Block = { name, n, units: [Unit] }
//   Unit  = { x, y, w, h, t, rot, flip, f: [fill], off?: [[dx,dy]] }
//     t     shape id (see SHAPES)
//     f     one fill per patch: a value role ('L','M','D','A','B') or a fabric id
//     off   optional per-patch fussy-cut offset of the fabric, in inches
//
// Non-square units (flying geese, logs) keep their footprint: their rot is
// even when wider than tall and odd when taller than wide.

export const ROLES = ['L', 'M', 'D', 'A', 'B'];
export const ROLE_NAMES = { L: 'Light', M: 'Medium', D: 'Dark', A: 'Accent', B: 'Accent 2' };

/** Drunkard's Path quarter-circle radius, as a fraction of the unit. */
export const ARC_R = 0.66;
/** Snowball corner leg, as a fraction of the unit. */
export const SNOW_C = 1 / 3;
const ARC_SEGS = 40;

function arcPts(cx, cy, r, a0, a1, segs = ARC_SEGS) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const c = SNOW_C;
const R = ARC_R;
const pie = [[0, 0], ...arcPts(0, 0, R, 0, Math.PI / 2)];
const crust = [[R, 0], [1, 0], [1, 1], [0, 1], ...arcPts(0, 0, R, Math.PI / 2, 0)];

/** Canonical patches of each shape, in [0,1]², y down. */
export const SHAPES = {
  square: { name: 'Square', patches: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  hst: {
    name: 'Half-square triangle',
    patches: [[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]],
  },
  qst: {
    name: 'Quarter-square triangle',
    patches: [
      [[0, 0], [1, 0], [0.5, 0.5]], [[1, 0], [1, 1], [0.5, 0.5]],
      [[1, 1], [0, 1], [0.5, 0.5]], [[0, 1], [0, 0], [0.5, 0.5]],
    ],
  },
  hqst: {
    name: 'Three-triangle unit',
    patches: [[[1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0], [0.5, 0.5]], [[0, 1], [0, 0], [0.5, 0.5]]],
  },
  geese: {
    name: 'Flying geese',
    patches: [[[0, 1], [0.5, 0], [1, 1]], [[0, 0], [0.5, 0], [0, 1]], [[0.5, 0], [1, 0], [1, 1]]],
  },
  sqsq: {
    name: 'Square in a square',
    patches: [
      [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
      [[0, 0], [0.5, 0], [0, 0.5]], [[0.5, 0], [1, 0], [1, 0.5]],
      [[1, 0.5], [1, 1], [0.5, 1]], [[0, 0.5], [0.5, 1], [0, 1]],
    ],
  },
  snowball: {
    name: 'Snowball',
    patches: [
      [[c, 0], [1 - c, 0], [1, c], [1, 1 - c], [1 - c, 1], [c, 1], [0, 1 - c], [0, c]],
      [[0, 0], [c, 0], [0, c]], [[1 - c, 0], [1, 0], [1, c]],
      [[1, 1 - c], [1, 1], [1 - c, 1]], [[0, 1 - c], [c, 1], [0, 1]],
    ],
  },
  corner: {
    name: 'Square with a flipped corner',
    patches: [[[0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0.5]], [[0, 0], [0.5, 0], [0, 0.5]]],
  },
  strips2: { name: 'Two strips', patches: [[[0, 0], [1, 0], [1, 0.5], [0, 0.5]], [[0, 0.5], [1, 0.5], [1, 1], [0, 1]]] },
  strips3: {
    name: 'Three strips',
    patches: [
      [[0, 0], [1, 0], [1, 1 / 3], [0, 1 / 3]],
      [[0, 1 / 3], [1, 1 / 3], [1, 2 / 3], [0, 2 / 3]],
      [[0, 2 / 3], [1, 2 / 3], [1, 1], [0, 1]],
    ],
  },
  arc: { name: "Drunkard's Path", patches: [pie, crust], curved: true },
};

/** Shapes offered when tapping a unit, by footprint. */
export const CYCLE_SQUARE = ['square', 'hst', 'qst', 'hqst', 'sqsq', 'snowball', 'corner', 'strips2', 'strips3', 'arc'];
export const CYCLE_GEESE = ['geese', 'square', 'strips2', 'strips3'];
export const CYCLE_RECT = ['square', 'strips2', 'strips3'];

export function cycleFor(u) {
  if (u.w === u.h) return CYCLE_SQUARE;
  if (Math.max(u.w, u.h) === 2 * Math.min(u.w, u.h)) return CYCLE_GEESE;
  return CYCLE_RECT;
}

/** Maps a canonical point through flip and quarter turns (all in [0,1]²). */
export function orient([u, v], rot = 0, flip = false) {
  if (flip) u = 1 - u;
  for (let k = 0; k < (((rot % 4) + 4) % 4); k++) [u, v] = [1 - v, u];
  return [u, v];
}

/** Patches of one unit, in block cell coordinates. */
export function unitPatches(unit) {
  const shape = SHAPES[unit.t] || SHAPES.square;
  return shape.patches.map((poly) => poly.map((p) => {
    const [u, v] = orient(p, unit.rot, unit.flip);
    return [unit.x + u * unit.w, unit.y + v * unit.h];
  }));
}

/** Every patch of a block: [{ unit, patch, pts }] with pts in cell coordinates (0..n). */
export function blockPatches(block) {
  const out = [];
  block.units.forEach((unit, ui) => {
    unitPatches(unit).forEach((pts, pi) => out.push({ unit: ui, patch: pi, pts, fill: unit.f[pi] }));
  });
  return out;
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function pointInPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function patchCount(t) { return (SHAPES[t] || SHAPES.square).patches.length; }

/* ----------------------------------------------------- block transforms */

/** A block point (0..n) under a quarter-turn rotation and mirroring. */
export function transformPoint([x, y], n, { rot = 0, mirrorX = false, mirrorY = false } = {}) {
  if (mirrorX) x = n - x;
  if (mirrorY) y = n - y;
  for (let k = 0; k < (((rot % 4) + 4) % 4); k++) [x, y] = [n - y, x];
  return [x, y];
}

/** Turns one unit a quarter turn clockwise about the block center. */
export function rotateUnitCW(u, n) {
  return { ...u, x: n - u.y - u.h, y: u.x, w: u.h, h: u.w, rot: (u.rot + 1) % 4 };
}

/** Mirrors one unit left-right in the block. */
export function mirrorUnit(u, n) {
  // flip then rot == rot' then flip with rot' = -rot; mirroring after the turn
  // is the same as flipping first and turning the other way.
  return { ...u, x: n - u.x - u.w, flip: !u.flip, rot: (4 - u.rot) % 4 };
}

export function rotateBlock(block, k = 1) {
  let units = block.units;
  for (let i = 0; i < (((k % 4) + 4) % 4); i++) units = units.map((u) => rotateUnitCW(u, block.n));
  return { ...block, units };
}
export function mirrorBlock(block) {
  return { ...block, units: block.units.map((u) => mirrorUnit(u, block.n)) };
}

/* ------------------------------------------------------- editing helpers */

/** The unit covering a cell, or -1. */
export function unitAt(block, cx, cy) {
  return block.units.findIndex((u) => cx >= u.x && cx < u.x + u.w && cy >= u.y && cy < u.y + u.h);
}

export function plainGrid(n, fill = 'L') {
  const units = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) units.push(U(x, y, 'square', fill));
  return { name: 'My block', n, units };
}

/** Changes a unit's shape, carrying its fabrics over as well as it can. */
export function setShape(u, t) {
  const k = patchCount(t);
  const old = u.f.length ? u.f : ['L'];
  const two = [old[0], old[1] ?? old[0]];
  const f = [];
  for (let i = 0; i < k; i++) f.push(i < old.length && u.t !== 'square' ? old[i] : two[i % 2]);
  return { ...u, t, f, off: undefined };
}

export function nextShape(u) {
  const list = cycleFor(u);
  const i = list.indexOf(u.t);
  return setShape(u, list[(i + 1) % list.length]);
}

/** A quarter turn for square units; half a turn for rectangles (keeps the footprint). */
export function turnUnit(u) {
  return { ...u, rot: (u.rot + (u.w === u.h ? 1 : 2)) % 4 };
}

/** Joins two units into one rectangle, if together they make a rectangle. */
export function joinUnits(block, i, j) {
  const a = block.units[i];
  const b = block.units[j];
  if (!a || !b || i === j) return null;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(a.x + a.w, b.x + b.w) - x;
  const h = Math.max(a.y + a.h, b.y + b.h) - y;
  if (w * h !== a.w * a.h + b.w * b.h) return null;
  const isGeese = Math.max(w, h) === 2 * Math.min(w, h);
  const t = isGeese ? 'geese' : 'square';
  const goose = a.f[0] === 'L' ? 'D' : a.f[0];
  const unit = { x, y, w, h, t, rot: h > w ? 1 : 0, flip: false, f: t === 'geese' ? [goose, 'L', 'L'] : [a.f[0]] };
  const units = block.units.filter((_, k) => k !== i && k !== j);
  units.push(unit);
  return { ...block, units };
}

/** Splits a multi-cell unit back into plain squares. */
export function splitUnit(block, i) {
  const u = block.units[i];
  if (!u || (u.w === 1 && u.h === 1)) return null;
  const units = block.units.filter((_, k) => k !== i);
  for (let y = u.y; y < u.y + u.h; y++) for (let x = u.x; x < u.x + u.w; x++) units.push(U(x, y, 'square', u.f[0]));
  return { ...block, units };
}

/* -------------------------------------------------------------- library */

function U(x, y, t, f, rot = 0, w = 1, h = 1, flip = false) {
  const fills = typeof f === 'string' ? f.split('') : [...f];
  return { x, y, w, h, t, rot, flip, f: fills.length ? fills : ['L'] };
}

/** Repeats a quadrant's units at four quarter turns about the block center. */
function quad(n, units) {
  const out = [...units];
  let cur = units;
  for (let k = 1; k < 4; k++) {
    cur = cur.map((u) => rotateUnitCW(u, n));
    out.push(...cur);
  }
  return out;
}

function logs(order, rounds, center, colors) {
  // order: list of sides per round; colors: role per side
  let x0 = center[0], y0 = center[1], x1 = center[2], y1 = center[3];
  const units = [U(x0, y0, 'square', 'A', 0, x1 - x0, y1 - y0)];
  for (let r = 0; r < rounds; r++) {
    for (const side of order) {
      const col = colors[side][r % colors[side].length];
      if (side === 'R') { units.push(U(x1, y0, 'square', col, 0, 1, y1 - y0)); x1++; }
      if (side === 'T') { units.push(U(x0, y0 - 1, 'square', col, 0, x1 - x0, 1)); y0--; }
      if (side === 'L') { units.push(U(x0 - 1, y0, 'square', col, 0, 1, y1 - y0)); x0--; }
      if (side === 'B') { units.push(U(x0, y1, 'square', col, 0, x1 - x0, 1)); y1++; }
    }
  }
  return units;
}

function courthouse() {
  let x0 = 3, y0 = 3, x1 = 5, y1 = 5;
  const units = [U(3, 3, 'square', 'A', 0, 2, 2)];
  const dark = ['D', 'D', 'D'];
  for (let r = 0; r < 3; r++) {
    units.push(U(x0, y0 - 1, 'square', dark[r], 0, x1 - x0, 1));
    units.push(U(x0, y1, 'square', dark[r], 0, x1 - x0, 1));
    y0--; y1++;
    units.push(U(x0 - 1, y0, 'square', 'L', 0, 1, y1 - y0));
    units.push(U(x1, y0, 'square', 'L', 0, 1, y1 - y0));
    x0--; x1++;
  }
  return units;
}

function drunkard() {
  // The classic 16-patch: two colorways set in quarters (light pies on dark in
  // two quarters, dark pies on light in the other two), turned so the curves
  // stagger corner to corner like a wandering path.
  const rots = [
    [2, 0, 2, 0],
    [0, 2, 0, 2],
    [2, 0, 2, 0],
    [0, 2, 0, 2],
  ];
  const units = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const dark = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
    units.push(U(x, y, 'arc', dark ? 'DL' : 'LD', rots[y][x]));
  }
  return units;
}

/** Double Irish Chain, pieced block (rows top to bottom). */
const DIC_A = ['DMLMD', 'MDMDM', 'LMDML', 'MDMDM', 'DMLMD'];

/**
 * The library. Fills use value roles: L light (background), M medium,
 * D dark, A accent, B second accent. `note` is a short, true line about it.
 */
export const LIBRARY = [
  { id: 'four-patch', name: 'Four Patch', n: 2, note: 'The first block most quilters sew.',
    units: [U(0, 0, 'square', 'D'), U(1, 0, 'square', 'L'), U(0, 1, 'square', 'L'), U(1, 1, 'square', 'D')] },
  { id: 'nine-patch', name: 'Nine Patch', n: 3, note: 'Five darks, four lights; set side by side they make a chain.',
    units: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => U(i % 3, Math.floor(i / 3), 'square', i % 2 ? 'L' : 'D')) },
  { id: 'pinwheel', name: 'Pinwheel', n: 2, note: 'Four half-square triangles spinning around the center.',
    units: quad(2, [U(0, 0, 'hst', 'DL', 1)]) },
  { id: 'broken-dishes', name: 'Broken Dishes', n: 2, note: 'Half-square triangles turned so the seams make a diamond.',
    units: [U(0, 0, 'hst', 'DL', 0), U(1, 0, 'hst', 'DL', 3), U(1, 1, 'hst', 'DL', 0), U(0, 1, 'hst', 'DL', 3)] },
  { id: 'hourglass', name: 'Hourglass', n: 2, note: 'Quarter-square triangles; set together they make a lattice.',
    units: [U(0, 0, 'qst', 'DLDL'), U(1, 0, 'qst', 'DLDL'), U(0, 1, 'qst', 'DLDL'), U(1, 1, 'qst', 'DLDL')] },
  { id: 'friendship-star', name: 'Friendship Star', n: 3, note: 'Four half-square triangle points turning around a center square.',
    units: [U(0, 0, 'square', 'L'), U(2, 0, 'square', 'L'), U(2, 2, 'square', 'L'), U(0, 2, 'square', 'L'), U(1, 1, 'square', 'D'),
      ...quad(3, [U(1, 0, 'hst', 'LD', 0)])] },
  { id: 'ohio-star', name: 'Ohio Star', n: 3, note: 'Eight points from four quarter-square triangle units.',
    units: [...quad(3, [U(0, 0, 'square', 'L'), U(1, 0, 'qst', 'LDLD', 0)]), U(1, 1, 'square', 'M')] },
  { id: 'variable-star', name: 'Variable Star', n: 3, note: 'An Ohio Star whose inner triangles match the center, so the middle reads as one big square on point.',
    units: [...quad(3, [U(0, 0, 'square', 'L'), U(1, 0, 'qst', 'LDMD', 0)]), U(1, 1, 'square', 'M')] },
  { id: 'sawtooth-star', name: 'Sawtooth Star', n: 4, note: 'Flying geese with star-point wings around a big center square.',
    units: [...quad(4, [U(0, 0, 'square', 'L'), U(1, 0, 'geese', 'LDD', 2, 2, 1)]), U(1, 1, 'square', 'M', 0, 2, 2)] },
  { id: 'flying-geese', name: 'Flying Geese', n: 4, note: 'Two columns of geese flying north.',
    units: [0, 1, 2, 3].flatMap((y) => [U(0, y, 'geese', y % 2 ? 'MLL' : 'DLL', 0, 2, 1), U(2, y, 'geese', y % 2 ? 'DLL' : 'MLL', 0, 2, 1)]) },
  { id: 'dutchmans-puzzle', name: "Dutchman's Puzzle", n: 4, note: 'Pairs of flying geese turning like a pinwheel.',
    units: quad(4, [U(0, 0, 'geese', 'DLL', 0, 2, 1), U(0, 1, 'geese', 'DLL', 0, 2, 1)]) },
  { id: 'churn-dash', name: 'Churn Dash', n: 3, note: 'Half-square triangle corners and two-strip sides, like the dasher of a butter churn.',
    units: [...quad(3, [U(0, 0, 'hst', 'LD', 0), U(1, 0, 'strips2', 'LD', 0)]), U(1, 1, 'square', 'L')] },
  { id: 'shoofly', name: 'Shoofly', n: 3, note: 'A nine patch with half-square triangle corners.',
    units: [...quad(3, [U(0, 0, 'hst', 'LD', 0), U(1, 0, 'square', 'L')]), U(1, 1, 'square', 'D')] },
  { id: 'bears-paw', name: "Bear's Paw", n: 7, note: 'Four paws, each a big pad with two rows of half-square triangle claws.',
    units: [...quad(7, [U(0, 0, 'square', 'L'), U(1, 0, 'hst', 'LD'), U(2, 0, 'hst', 'LD'), U(0, 1, 'hst', 'LD'), U(0, 2, 'hst', 'LD'),
      U(1, 1, 'square', 'D', 0, 2, 2), U(3, 0, 'square', 'L', 1, 1, 3)]), U(3, 3, 'square', 'A')] },
  { id: 'rail-fence', name: 'Rail Fence', n: 2, note: 'Three-strip units turned to zigzag.',
    units: [U(0, 0, 'strips3', 'LMD', 0), U(1, 0, 'strips3', 'LMD', 1), U(0, 1, 'strips3', 'LMD', 1), U(1, 1, 'strips3', 'LMD', 0)] },
  { id: 'log-cabin', name: 'Log Cabin', n: 8, note: 'Logs built around a red hearth; light on two sides, dark on the other two.',
    units: logs(['R', 'T', 'L', 'B'], 3, [3, 3, 5, 5], { R: ['L', 'L', 'L'], T: ['L', 'L', 'L'], L: ['D'], B: ['D'] }) },
  { id: 'courthouse-steps', name: 'Courthouse Steps', n: 8, note: 'Logs added to opposite sides in pairs.',
    units: courthouse() },
  { id: 'card-trick', name: 'Card Trick', n: 3, note: 'Four cards fanned so each seems to tuck under the next.',
    units: [U(0, 0, 'hst', 'LM', 0), U(2, 0, 'hst', 'LD', 1), U(2, 2, 'hst', 'LA', 2), U(0, 2, 'hst', 'LB', 3),
      U(1, 0, 'hqst', 'DLM', 0), U(2, 1, 'hqst', 'ALD', 1), U(1, 2, 'hqst', 'BLA', 2), U(0, 1, 'hqst', 'MLB', 3),
      U(1, 1, 'qst', 'DABM')] },
  { id: 'jacobs-ladder', name: "Jacob's Ladder", n: 6, note: 'Four patches climb the diagonal between big half-square triangles.',
    units: [
      ...[[0, 0], [4, 0], [2, 2], [0, 4], [4, 4]].flatMap(([x, y]) => [U(x, y, 'square', 'D'), U(x + 1, y, 'square', 'L'), U(x, y + 1, 'square', 'L'), U(x + 1, y + 1, 'square', 'D')]),
      U(2, 0, 'hst', 'ML', 1, 2, 2), U(4, 2, 'hst', 'ML', 1, 2, 2), U(0, 2, 'hst', 'LM', 1, 2, 2), U(2, 4, 'hst', 'LM', 1, 2, 2),
    ] },
  { id: 'drunkards-path', name: "Drunkard's Path", n: 4, note: 'Quarter-circle units; turned, they wander. Sewn with curved seams.',
    units: drunkard() },
  { id: 'snowball', name: 'Snowball', n: 2, note: 'One square with stitch-and-flip corners. Alternate it with a Nine Patch.',
    units: [U(0, 0, 'snowball', 'LDDDD', 0, 2, 2)] },
  { id: 'square-in-a-square', name: 'Square in a Square', n: 2, note: 'A square on point with four corner triangles.',
    units: [U(0, 0, 'sqsq', 'MDDDD', 0, 2, 2)] },

  // ---- added in the second round
  { id: 'bow-tie', name: 'Bow Tie', n: 2, note: 'Two dark squares and two light ones; stitch-and-flip corners make the knot in the middle.',
    units: [U(0, 0, 'square', 'D'), U(1, 1, 'square', 'D'), U(1, 0, 'corner', 'LD', 3), U(0, 1, 'corner', 'LD', 1)] },
  { id: 'double-four-patch', name: 'Double Four Patch', n: 4, note: 'Two small four patches and two plain squares; set side by side they make a chain.',
    units: [...[[0, 0], [2, 2]].flatMap(([x, y]) => [U(x, y, 'square', 'D'), U(x + 1, y, 'square', 'L'), U(x, y + 1, 'square', 'L'), U(x + 1, y + 1, 'square', 'D')]),
      U(2, 0, 'square', 'M', 0, 2, 2), U(0, 2, 'square', 'M', 0, 2, 2)] },
  { id: 'whirligig', name: 'Whirligig', n: 2, note: 'A pinwheel whose light halves are split again, so a second, smaller whirl turns inside the first.',
    units: quad(2, [U(0, 0, 'hqst', 'DLM', 3)]) },
  { id: 'spool', name: 'Spool', n: 3, note: 'Dark spool ends cut on the angle, with the thread wound in the middle.',
    units: [U(0, 0, 'hst', 'LD', 3), U(1, 0, 'square', 'D'), U(2, 0, 'hst', 'LD', 2),
      U(0, 1, 'square', 'L'), U(1, 1, 'square', 'M'), U(2, 1, 'square', 'L'),
      U(0, 2, 'hst', 'LD', 0), U(1, 2, 'square', 'D'), U(2, 2, 'hst', 'LD', 1)] },
  { id: 'hole-in-the-barn-door', name: 'Hole in the Barn Door', n: 3, note: 'Another name for the Churn Dash (and Monkey Wrench, Sherman’s March); shown with a dark center.',
    units: [...quad(3, [U(0, 0, 'hst', 'LD', 0), U(1, 0, 'strips2', 'LM', 0)]), U(1, 1, 'square', 'D')] },
  { id: 'monkey-wrench', name: 'Monkey Wrench', n: 5, note: 'The five-patch Churn Dash: big triangle corners and two-square sides. Also sold as Hole in the Barn Door.',
    units: [...quad(5, [U(0, 0, 'hst', 'LD', 0, 2, 2), U(2, 0, 'square', 'L'), U(2, 1, 'square', 'D')]), U(2, 2, 'square', 'L')] },
  { id: 'lady-of-the-lake', name: 'Lady of the Lake', n: 5, note: 'One big half-square triangle ringed by small ones, light on the dark side and dark on the light side.',
    units: [U(1, 1, 'hst', 'DL', 0, 3, 3),
      ...[0, 1, 2, 3, 4].flatMap((i) => [[i, 0], [i, 4]]).concat([1, 2, 3].flatMap((i) => [[0, i], [4, i]]))
        .map(([x, y]) => U(x, y, 'hst', x + y < 4 ? 'LD' : 'DL', 0))] },
  { id: 'cake-stand', name: 'Cake Stand', n: 4, note: 'A big triangle stand (or basket) with sawtooth edges. Set on point so it sits upright.',
    units: [U(0, 0, 'hst', 'LD', 0, 3, 3), U(3, 0, 'hst', 'DL', 3), U(3, 1, 'hst', 'DL', 3), U(3, 2, 'hst', 'DL', 3),
      U(0, 3, 'hst', 'DL', 1), U(1, 3, 'hst', 'DL', 1), U(2, 3, 'hst', 'DL', 1), U(3, 3, 'square', 'L')] },
  { id: 'pine-tree', name: 'Pine Tree', n: 4, note: 'Stacked flying geese for the branches and a trunk below.',
    units: [U(0, 0, 'square', 'L'), U(1, 0, 'geese', 'DLL', 0, 2, 1), U(3, 0, 'square', 'L'),
      U(0, 1, 'geese', 'DLL', 0, 4, 2),
      U(0, 3, 'square', 'L'), U(1, 3, 'square', 'A', 0, 2, 1), U(3, 3, 'square', 'L')] },
  { id: 'double-nine-patch', name: 'Double Nine Patch', n: 9, note: 'Five small nine patches set like the squares of one big one.',
    units: [[0, 0], [6, 0], [3, 3], [0, 6], [6, 6]].flatMap(([x, y]) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => U(x + (i % 3), y + Math.floor(i / 3), 'square', i % 2 ? 'L' : 'D')))
      .concat([[3, 0], [0, 3], [6, 3], [3, 6]].map(([x, y]) => U(x, y, 'square', 'M', 0, 3, 3))) },
  { id: 'irish-chain-a', name: 'Double Irish Chain (chain block)', n: 5, note: 'The pieced block of the Double Irish Chain: a dark diagonal flanked by mediums.',
    units: [0, 1, 2, 3, 4].flatMap((y) => [0, 1, 2, 3, 4].map((x) => U(x, y, 'square', DIC_A[y][x]))) },
  { id: 'irish-chain-b', name: 'Double Irish Chain (plain block)', n: 5, note: 'The light block between the chains, with medium corners that carry them through.',
    units: [U(0, 0, 'square', 'M'), U(4, 0, 'square', 'M'), U(0, 4, 'square', 'M'), U(4, 4, 'square', 'M'),
      U(1, 0, 'square', 'L', 0, 3, 1), U(1, 4, 'square', 'L', 0, 3, 1), U(0, 1, 'square', 'L', 0, 5, 3)] },
  { id: 'hst', name: 'Half-Square Triangle', n: 1, note: 'One half-square triangle. Use the layouts below, or Turn in Layout, to set them.',
    units: [U(0, 0, 'hst', 'DL', 0)] },
  { id: 'plain-square', name: 'Plain Square', n: 1, note: 'One square: for Trip Around the World, or a plain alternate block.',
    units: [U(0, 0, 'square', 'L')] },
];

/** Library sections, in the order the library shows them. */
export const GROUPS = [
  { id: 'four', name: 'Four-patch', ids: ['four-patch', 'double-four-patch', 'pinwheel', 'whirligig', 'broken-dishes', 'hourglass', 'bow-tie', 'dutchmans-puzzle', 'flying-geese', 'pine-tree', 'cake-stand', 'snowball', 'square-in-a-square', 'hst'] },
  { id: 'nine', name: 'Nine-patch', ids: ['nine-patch', 'double-nine-patch', 'shoofly', 'churn-dash', 'hole-in-the-barn-door', 'card-trick', 'spool', 'jacobs-ladder', 'plain-square'] },
  { id: 'stars', name: 'Stars', ids: ['friendship-star', 'ohio-star', 'variable-star', 'sawtooth-star'] },
  { id: 'five', name: 'Five-patch and bigger', ids: ['monkey-wrench', 'lady-of-the-lake', 'irish-chain-a', 'irish-chain-b', 'bears-paw'] },
  { id: 'strip', name: 'Strip and log', ids: ['rail-fence', 'log-cabin', 'courthouse-steps'] },
  { id: 'curves', name: 'Curves', ids: ['drunkards-path'] },
];

export function libraryBlock(id) {
  const b = LIBRARY.find((x) => x.id === id) || LIBRARY[0];
  return cloneBlock({ name: b.name, n: b.n, from: b.id, units: b.units });
}

export function cloneBlock(b) {
  return { ...b, units: b.units.map((u) => ({ ...u, f: [...u.f], off: u.off ? u.off.map((o) => (o ? [...o] : null)) : undefined })) };
}

/**
 * A block read back from storage, checked: every unit on the grid, a known
 * shape, one fill per patch, no two units on the same cell, every cell covered.
 * Returns a clean copy, or null if it cannot be trusted (the caller then
 * falls back to a library block instead of failing to draw).
 */
export function sanitizeBlock(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.units)) return null;
  const n = Number(b.n);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  const cells = new Set();
  const units = [];
  for (const u of b.units) {
    if (!u || typeof u !== 'object') return null;
    const [x, y, w, h] = [u.x, u.y, u.w, u.h].map(Number);
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > n || y + h > n) return null;
    const t = SHAPES[u.t] ? u.t : 'square';
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const k = `${xx},${yy}`;
      if (cells.has(k)) return null;
      cells.add(k);
    }
    const k = patchCount(t);
    const src = Array.isArray(u.f) ? u.f.filter((f) => typeof f === 'string' && f) : [];
    const f = Array.from({ length: k }, (_, i) => src[i] ?? src[0] ?? 'L');
    const off = Array.isArray(u.off) ? u.off.slice(0, k).map((o) => (Array.isArray(o) && o.length === 2 && o.every(Number.isFinite) ? [o[0], o[1]] : null)) : undefined;
    units.push({ x, y, w, h, t, rot: ((Math.round(Number(u.rot) || 0) % 4) + 4) % 4, flip: !!u.flip, f, ...(off ? { off } : {}) });
  }
  if (cells.size !== n * n) return null;
  return { ...b, name: typeof b.name === 'string' && b.name ? b.name : 'My block', n, units };
}

/** Area covered by a block's patches (should equal n²). */
export function blockArea(block) {
  return blockPatches(block).reduce((s, p) => s + polyArea(p.pts), 0);
}
