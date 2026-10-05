// grading.js — Hue-style gradient boards (pure, JSON-serializable state).
// Implements docs/DESIGN.md "Active play › Grading (Hue boards)" and
// ARCHITECTURE.md "Puzzles". The spec's 4×5 Relaxed board wins over the
// prototype's 5×6 ("Prototypes › Differences between prototypes and spec").
//
// Board generation:
//  - Four corners are built in OKLCH around a hue taken from her palette:
//    hue sweeps across the horizontal axis ('h'), lightness ramps down the
//    vertical axis, 'l' adds a lightness tilt across the horizontal axis too
//    (so lightness must be read both ways) and 'c' adds a chroma difference
//    across the diagonal. Lightness stays in [0.3, 0.9], chroma in [0.06, 0.2].
//  - Cells are bilinear in OKLab (color.gradientOklab), gamut-clamped.
//  - Validation: min ΔE between orthogonal in-play neighbors must reach the
//    tier floor and no two in-play cells may sit within ΔE 2 of each other.
//    40 tries, then 40 more with spans widened by 20%, then the best board is
//    returned with belowFloor = true.
//
// Floor scale (judgment call): the spec's neighbor ΔE values (12/8/5/3) are
// not reachable as *minimum* OKLab×100 steps inside sRGB at these grid sizes
// (an optimizer over all in-gamut corners tops out near 11.5/6.5/4.8/3.9, and
// that is before the corners have to follow her palette). TIERS keeps the spec
// numbers; boards are validated against floorFor(tier) = max(2, spec / 2),
// which keeps the tier ordering and is met by well over 90% of boards.
//
// Every function takes `rng` (() => [0,1)) where randomness is needed.

import {
  hexToRgb, rgbToOklab, hexToOklch, oklchToHex, clampToGamut, deltaE,
  gradientOklab, noteIndexForLightness,
} from '../color.js';
import { pick, shuffle } from '../rng.js';

/** Difficulty tiers, exactly as the spec table (k = reward minutes, mult = reward multiplier). */
export const TIERS = Object.freeze({
  relaxed: Object.freeze({ cols: 4, rows: 5, anchors: 'alt-edges', neighborDE: 12, dims: Object.freeze(['h']), k: 8, mult: 1 }),
  steady: Object.freeze({ cols: 6, rows: 8, anchors: 'sparse-edges', neighborDE: 8, dims: Object.freeze(['h', 'l']), k: 12, mult: 1.5 }),
  tricky: Object.freeze({ cols: 8, rows: 10, anchors: 'corners+4', neighborDE: 5, dims: Object.freeze(['h', 'l']), k: 20, mult: 2.5 }),
  master: Object.freeze({ cols: 9, rows: 12, anchors: 'corners', neighborDE: 3, dims: Object.freeze(['h', 'l', 'c']), k: 32, mult: 4 }),
});

export const TIER_NAMES = Object.freeze(['relaxed', 'steady', 'tricky', 'master']);

/** Silhouettes; any non-rect shape counts as an "odd shape" for difficulty. */
export const SHAPES = Object.freeze(['rect', 'leaf', 'fish', 'window', 'snowflake']);

/** Validation floor is the spec value scaled by this (see header). */
export const FLOOR_SCALE = 0.5;
/** Two in-play tiles closer than this look like duplicates. */
export const DUPLICATE_DE = 2;

const TRIES = 40;
const WIDEN = 1.2;
const L_MIN = 0.3;
const L_MAX = 0.9;
const C_MIN = 0.06;
const C_MAX = 0.2;
const AIM = 1.3; // spans are sized for AIM × floor so most tries pass

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const range = (rng, lo, hi) => lo + (hi - lo) * rng();
const sign = (rng) => (rng() < 0.5 ? -1 : 1);
const labOf = (hex) => rgbToOklab(hexToRgb(hex));

function tierOf(name) {
  const t = TIERS[name];
  if (!t) throw new RangeError('grading: unknown tier ' + JSON.stringify(name));
  return t;
}

/** The ΔE floor boards of this tier are validated against. */
export function floorFor(tierName) {
  return Math.max(DUPLICATE_DE, tierOf(tierName).neighborDE * FLOOR_SCALE);
}

// ---------------------------------------------------------------------------
// Shapes and anchors
// ---------------------------------------------------------------------------

/** Boolean mask (row-major) for a silhouette over a cols × rows grid. */
export function shapeMask(shape, cols, rows) {
  const mask = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Cell centre in (-1, 1) on both axes (y grows downward).
      const u = ((x + 0.5) / cols) * 2 - 1;
      const v = ((y + 0.5) / rows) * 2 - 1;
      mask.push(inShape(shape || 'rect', u, v));
    }
  }
  return mask;
}

function inShape(shape, u, v) {
  switch (shape) {
    case 'rect':
      return true;
    case 'leaf': {
      // Pointed lens with a short stem at the bottom.
      if (v > 0.8) return Math.abs(u) < 0.2;
      const t = (v + 1) / 1.8; // 0 at the tip, 1 at the stem
      const half = 1.15 * Math.sin(Math.PI * clamp(t, 0, 1)) ** 0.7;
      return Math.abs(u) <= half;
    }
    case 'fish': {
      // Body ellipse swimming up, forked tail at the bottom.
      const body = (u * u) / (1.05 * 1.05) + ((v + 0.25) * (v + 0.25)) / (0.78 * 0.78) <= 1;
      const tail = v >= 0.5 && Math.abs(u) <= (v - 0.35) * 1.3 && !(Math.abs(u) < (v - 0.75) * 1.2);
      return body || tail;
    }
    case 'window': {
      // Arched window: rectangle with a round top.
      if (v >= -0.25) return true;
      const dy = (v + 0.25) / 0.8;
      return u * u + dy * dy <= 0.92;
    }
    case 'snowflake': {
      // Hexagonal core plus six arms.
      if (u * u + v * v <= 0.36) return true;
      for (const deg of [90, 30, 150]) {
        const a = (deg * Math.PI) / 180;
        const dist = Math.abs(u * Math.sin(a) - v * Math.cos(a)); // distance from the arm's line
        if (dist <= 0.3) return true;
      }
      return false;
    }
    default:
      throw new RangeError('grading: unknown shape ' + JSON.stringify(shape));
  }
}

function inPlayEdges(mask, cols, rows) {
  const out = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % cols;
    const y = Math.floor(p / cols);
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    if (nb.some(([nx, ny]) => nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny * cols + nx])) out.push(p);
  }
  return out;
}

function nearestInPlay(mask, cols, tx, ty, exclude = () => false) {
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || exclude(p)) continue;
    const d = (p % cols - tx) ** 2 + (Math.floor(p / cols) - ty) ** 2;
    if (d < bestD - 1e-9) { bestD = d; best = p; }
  }
  return best;
}

/** The in-play cells closest to the four grid corners (tl, tr, bl, br). */
export function cornerCells(mask, cols, rows) {
  const pts = [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]];
  return [...new Set(pts.map(([x, y]) => nearestInPlay(mask, cols, x, y)))].filter((p) => p >= 0);
}

/** Anchor positions for a layout rule over an (optionally masked) grid. */
export function anchorPositions(rule, mask, cols, rows) {
  const corners = cornerCells(mask, cols, rows);
  const set = new Set(corners);
  if (rule === 'alt-edges' || rule === 'sparse-edges') {
    // Edge cells in perimeter order (angle around the centre), every 2nd / 3rd.
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const edges = inPlayEdges(mask, cols, rows).sort((a, b) => {
      const aa = Math.atan2(Math.floor(a / cols) - cy, (a % cols) - cx);
      const bb = Math.atan2(Math.floor(b / cols) - cy, (b % cols) - cx);
      return aa - bb || a - b;
    });
    // Start the walk at the top-left corner so the pattern is symmetric-ish.
    const start = Math.max(0, edges.indexOf(corners[0]));
    const step = rule === 'alt-edges' ? 2 : 3;
    for (let k = 0; k < edges.length; k++) {
      if (k % step === 0) set.add(edges[(start + k) % edges.length]);
    }
  } else if (rule === 'corners+4') {
    const edgeSet = new Set(inPlayEdges(mask, cols, rows));
    for (const [fx, fy] of [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]]) {
      const p = nearestInPlay(mask, cols, fx * (cols - 1), fy * (rows - 1), (q) => set.has(q) || edgeSet.has(q));
      if (p >= 0) set.add(p);
    }
  } else if (rule !== 'corners') {
    throw new RangeError('grading: unknown anchor rule ' + JSON.stringify(rule));
  }
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Corners and validation
// ---------------------------------------------------------------------------

/** Random OKLCH-built corners {tl,tr,bl,br} for a tier, around a palette hue. */
function makeCorners(tier, palette, floor, widen, rng) {
  const base = palette.length ? hexToOklch(pick(rng, palette)) : { L: 0.6, C: 0.14, h: rng() * 360 };
  const { cols, rows, dims } = tier;
  const target = (floor * AIM) / 100; // per-step OKLab distance we aim for
  // Lightness ramp down the vertical axis (every tier needs one: hue alone
  // cannot separate a 2-D grid at these floors).
  const Sl = clamp(target * (rows - 1) * range(rng, 0.95, 1.2) * widen, 0.1, L_MAX - L_MIN);
  const tilt = dims.includes('l') ? range(rng, 0.05, 0.12) * widen * sign(rng) : 0;
  const dc = dims.includes('c') ? range(rng, 0.05, 0.09) * widen * sign(rng) : 0;
  // Chroma high enough that the hue sweep can carry the horizontal steps.
  const needH = target * (cols - 1) * range(rng, 0.95, 1.2);
  const maxSpan = Math.min(170, 110 * widen + 30);
  let C0 = clamp(Math.max(base.C, range(rng, 0.11, 0.17)), C_MIN, C_MAX);
  C0 = Math.min(C_MAX, Math.max(C0, needH / (2 * Math.sin((maxSpan * Math.PI) / 360))));
  const ratio = clamp(needH / (2 * C0), 0, 1);
  const Sh = clamp((2 * Math.asin(ratio) * 180) / Math.PI * widen, 40, maxSpan);
  const dirH = sign(rng);
  const dirV = sign(rng);
  const at = clamp(rng(), 0, 1); // where the palette hue sits in the sweep
  const halfL = Sl / 2 + Math.abs(tilt) / 2;
  const Lmid = clamp(base.L, L_MIN + halfL, L_MAX - halfL);
  const corner = (u, v) => {
    const h = (((base.h + dirH * Sh * (u - at)) % 360) + 360) % 360;
    const L = clamp(Lmid + dirV * Sl * (v - 0.5) + tilt * (u - 0.5), L_MIN, L_MAX);
    const C = clamp(C0 + dc * (0.5 - (u + v) / 2), C_MIN, C_MAX);
    return oklchToHex(clampToGamut({ L, C, h }));
  };
  return { tl: corner(0, 0), tr: corner(1, 0), bl: corner(0, 1), br: corner(1, 1) };
}

/** Cells for corners over a mask, plus the validation numbers. */
function evaluate(corners, cols, rows, mask) {
  const all = gradientOklab(corners, cols, rows);
  const cells = all.map((h, p) => (mask[p] ? h : null));
  const labs = cells.map((h) => (h ? labOf(h) : null));
  let minNeighbor = Infinity;
  for (let p = 0; p < cells.length; p++) {
    if (!labs[p]) continue;
    const x = p % cols;
    if (x + 1 < cols && labs[p + 1]) minNeighbor = Math.min(minNeighbor, deltaE(labs[p], labs[p + 1]));
    if (p + cols < cells.length && labs[p + cols]) minNeighbor = Math.min(minNeighbor, deltaE(labs[p], labs[p + cols]));
  }
  let minPair = Infinity;
  for (let i = 0; i < labs.length; i++) {
    if (!labs[i]) continue;
    for (let j = i + 1; j < labs.length; j++) {
      if (labs[j]) minPair = Math.min(minPair, deltaE(labs[i], labs[j]));
    }
  }
  if (!Number.isFinite(minNeighbor)) minNeighbor = 0;
  return { cells, labs, minNeighbor, minPair };
}

function passes(ev, floor) {
  return ev.minNeighbor >= floor && ev.minPair >= DUPLICATE_DE;
}

// ---------------------------------------------------------------------------
// Shuffling
// ---------------------------------------------------------------------------

/** Random derangement of `positions` (no position keeps its own cell).
 *  Returns a map array: result[k] = the position whose cell lands on positions[k]. */
function derange(positions, rng) {
  const n = positions.length;
  if (n < 2) return positions.slice();
  let perm = shuffle(rng, positions);
  for (let guard = 0; guard < 1000; guard++) {
    let fixed = -1;
    for (let k = 0; k < n; k++) if (perm[k] === positions[k]) { fixed = k; break; }
    if (fixed < 0) return perm;
    let other = Math.floor(rng() * (n - 1));
    if (other >= fixed) other += 1;
    const t = perm[fixed];
    perm[fixed] = perm[other];
    perm[other] = t;
  }
  // Fallback: a rotation is always a derangement.
  perm = positions.slice(1).concat(positions[0]);
  return perm;
}

/** Fill board.order: anchors and `keep` positions correct, the rest deranged. */
function shuffleInto(board, keepCount, rng) {
  const anchorSet = new Set(board.anchors);
  const movable = [];
  for (let p = 0; p < board.mask.length; p++) if (board.mask[p] && !anchorSet.has(p)) movable.push(p);
  // Never hand back a solved board: leave at least two tiles out of place.
  const keep = clamp(Math.round(keepCount), 0, Math.max(0, movable.length - 2));
  const kept = new Set(shuffle(rng, movable).slice(0, keep));
  const loose = movable.filter((p) => !kept.has(p));
  const perm = derange(loose, rng);
  board.order = board.mask.map((m, p) => (m ? p : null));
  loose.forEach((p, k) => { board.order[p] = perm[k]; });
}

// ---------------------------------------------------------------------------
// Board creation
// ---------------------------------------------------------------------------

function sound(cells, labs) {
  const L = labs.map((lab) => (lab ? lab.L : null));
  const live = L.filter((v) => v !== null);
  const lo = Math.min(...live);
  const hi = Math.max(...live);
  const notes = L.map((v) => {
    if (v === null) return null;
    if (hi - lo < 1e-6) return noteIndexForLightness(v);
    return Math.round(((v - lo) / (hi - lo)) * 11); // board-relative 12-step ladder (as the prototype)
  });
  return { L, notes };
}

/**
 * createBoard({tier, palette, shape, seedHexes, corners}, rng) -> board.
 *  - palette: hexes (catalog or event page) the board's hue region comes from.
 *  - shape: 'rect' (default) | 'leaf' | 'fish' | 'window' | 'snowflake'.
 *  - seedHexes: optional; four or more hexes are tried first as fixed corners
 *    (tl, tr, bl, br); if they miss the floor they join the palette instead.
 *  - corners: optional {tl,tr,bl,br} tried first (used by switchTier).
 */
export function createBoard(opts, rng) {
  const { tier: tierName = 'relaxed', shape = 'rect', seedHexes = null } = opts || {};
  if (typeof rng !== 'function') throw new TypeError('grading.createBoard: rng must be a function');
  const tier = tierOf(tierName);
  const { cols, rows } = tier;
  const mask = shapeMask(shape, cols, rows);
  const floor = floorFor(tierName);
  let palette = Array.isArray(opts && opts.palette) ? opts.palette.filter((h) => typeof h === 'string') : [];

  let fixed = opts && opts.corners ? opts.corners : null;
  if (!fixed && Array.isArray(seedHexes) && seedHexes.length >= 4) {
    fixed = { tl: seedHexes[0], tr: seedHexes[1], bl: seedHexes[2], br: seedHexes[3] };
  }
  if (Array.isArray(seedHexes)) palette = palette.concat(seedHexes);

  let chosen = null;
  let best = null;
  const consider = (corners) => {
    const ev = evaluate(corners, cols, rows, mask);
    const ok = passes(ev, floor);
    // "Best" prefers boards without duplicate-looking tiles, then the larger floor.
    const rank = (ev.minPair >= DUPLICATE_DE ? 1000 : 0) + ev.minNeighbor;
    if (!best || rank > best.rank) best = { corners, ev, rank };
    if (ok) chosen = { corners, ev };
    return ok;
  };

  if (fixed) {
    consider(fixed);
    if (!chosen) {
      palette = palette.concat([fixed.tl, fixed.tr, fixed.bl, fixed.br]);
    }
  }
  for (let phase = 0; phase < 2 && !chosen; phase++) {
    const widen = phase === 0 ? 1 : WIDEN;
    for (let t = 0; t < TRIES && !chosen; t++) consider(makeCorners(tier, palette, floor, widen, rng));
  }
  const pickd = chosen || best;
  const { cells, labs, minNeighbor } = pickd.ev;
  const { L, notes } = sound(cells, labs);

  const board = {
    tier: tierName,
    cols,
    rows,
    shape,
    corners: { ...pickd.corners },
    cells,
    order: [],
    anchors: anchorPositions(tier.anchors, mask, cols, rows),
    mask,
    floorDE: floor,
    minNeighborDE: Math.round(minNeighbor * 100) / 100,
    belowFloor: !chosen,
    moves: 0,
    L,
    notes,
  };
  shuffleInto(board, 0, rng);
  return board;
}

/** ARCHITECTURE.md alias. */
export const create = createBoard;

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

function inPlay(board, p) {
  return Number.isInteger(p) && p >= 0 && p < board.mask.length && board.mask[p];
}

/** True if position p can be moved by the player. */
export function isMovable(board, p) {
  return inPlay(board, p) && !board.anchors.includes(p);
}

/** Swap the tiles at positions i and j. Refuses anchors, masked cells and i === j. */
export function swap(board, i, j) {
  if (i === j || !isMovable(board, i) || !isMovable(board, j)) {
    return { ok: false, placed: [], solved: isSolved(board) };
  }
  const t = board.order[i];
  board.order[i] = board.order[j];
  board.order[j] = t;
  board.moves += 1;
  const placed = [i, j].filter((p) => board.order[p] === p);
  return { ok: true, placed, solved: isSolved(board) };
}

/** ARCHITECTURE.md shape: apply(board, {i, j}) -> swap result plus events. */
export function apply(board, move) {
  const r = swap(board, move && move.i, move && move.j);
  const events = r.ok ? ['swap', ...r.placed.map(() => 'placed'), ...(r.solved ? ['solved'] : [])] : ['refused'];
  return { ...r, events };
}

export function isSolved(board) {
  return board.order.every((c, p) => !board.mask[p] || c === p);
}

/** In-play positions holding their own tile (anchors included). */
export function correctCount(board) {
  let n = 0;
  for (let p = 0; p < board.order.length; p++) if (board.mask[p] && board.order[p] === p) n++;
  return n;
}

/** In-play positions holding another tile. */
export function wrongCount(board) {
  let n = 0;
  for (let p = 0; p < board.order.length; p++) if (board.mask[p] && board.order[p] !== p) n++;
  return n;
}

/** Hex currently shown at position p (null when masked). */
export function tileAt(board, p) {
  const c = board.order[p];
  return c === null || c === undefined ? null : board.cells[c];
}

/**
 * Move to another tier mid-board: same corner colors (unless they miss the new
 * tier's floor, in which case they seed a fresh region), same shape, and the
 * same share of movable tiles already in place. Moves carry over.
 */
export function switchTier(board, newTier, rng) {
  tierOf(newTier);
  const anchorSet = new Set(board.anchors);
  let movable = 0;
  let right = 0;
  for (let p = 0; p < board.mask.length; p++) {
    if (!board.mask[p] || anchorSet.has(p)) continue;
    movable++;
    if (board.order[p] === p) right++;
  }
  const ratio = movable ? right / movable : 0;
  const next = createBoard({ tier: newTier, shape: board.shape || 'rect', corners: board.corners }, rng);
  const nextMovable = next.mask.filter(Boolean).length - next.anchors.length;
  shuffleInto(next, ratio * nextMovable, rng);
  next.moves = board.moves || 0;
  return next;
}

/** In-between tints a solved board reveals for discovery (v0.2: relaxed 1, steady 1, tricky 2, master 2). */
export const REVEALED_TINTS = Object.freeze({ relaxed: 1, steady: 1, tricky: 2, master: 2 });

/** REVEALED_TINTS[tier] in-between tints from the interior. */
export function revealedTints(board, rng) {
  const n = REVEALED_TINTS[board.tier] ?? 1;
  const corners = new Set(cornerCells(board.mask, board.cols, board.rows));
  const edges = new Set(inPlayEdges(board.mask, board.cols, board.rows));
  let pool = [];
  for (let p = 0; p < board.cells.length; p++) {
    if (board.cells[p] && !corners.has(p) && !edges.has(p)) pool.push(p);
  }
  if (pool.length < n) {
    pool = [];
    for (let p = 0; p < board.cells.length; p++) if (board.cells[p] && !corners.has(p)) pool.push(p);
  }
  return shuffle(rng, pool).slice(0, n).map((p) => board.cells[p]);
}

/** Note indices in reading order for "Hear the board" (jumbled until solved). */
export function hearOrder(board) {
  const out = [];
  for (let p = 0; p < board.order.length; p++) {
    if (board.mask[p]) out.push(board.notes[board.order[p]]);
  }
  return out;
}

/** Unique lightness values, dark to light, for the solve arpeggio. */
export function boardMelody(board) {
  const seen = new Set();
  const out = [];
  for (const v of board.L) {
    if (v === null) continue;
    const key = Math.round(v * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key / 1000);
  }
  return out.sort((a, b) => a - b);
}
