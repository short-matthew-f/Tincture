// puzzles/tiles.js — the Tile Room's rules (pure; docs/PLAN-v0.3.md "Tile Room").
// Ported from proto/tiles/rules.js (playtested; docs/UX-AUDIT-proto-crafts.md §1).
//
// Dishes of glazed tiles in five colours: take every tile of one colour from a
// dish (the rest slide to the middle) or from the middle, set them on a
// staircase pattern line, and a full line sets one tile into a 5 × 5 wall that
// scores by its neighbours. Extra tiles go to the seconds basket (+1 each, they
// sell as seconds; never a penalty). Ida from the pottery next door takes one
// dish after each of her turns by a stated rule. Finishing a wall row ends the
// wall after that round; end bonuses for rows, columns and whole colours.
//
// No window/document/Date.now/Math.random. All randomness comes from a
// mulberry32 seed carried in the game (`rs`), so a saved game restores the
// same bag. Every function takes a game and returns a NEW game (the input is
// never mutated), so a game is plain JSON and lives in state.tiles.game.
//
// Colours are indices 0..4 here; the sim maps them to her color ids
// (game.colors). Glyphs keep the five apart without colour (colorblind).

export const GLYPHS = Object.freeze(['dot', 'diamond', 'ring', 'leaf', 'wave']);
export const TOTAL_TILES = 100;
export const PER_COLOR = 20;
export const DISHES = 5;
export const DISH_SIZE = 4;
export const SECOND_VALUE = 1;
export const GAME_VERSION = 1;
/** End bonuses: each complete row, each complete column, each colour with all five placed. */
export const BONUS = Object.freeze({ row: 2, col: 7, color: 10 });

const clone = (s) => JSON.parse(JSON.stringify(s));

function rand(s) {
  s.rs = (s.rs + 0x6D2B79F5) >>> 0;
  let t = s.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(arr, s) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Wall layout: row r, column c holds colour (c - r) mod 5 (a shifted Latin square). */
export const wallColor = (r, c) => (((c - r) % 5) + 5) % 5;
/** The column where colour `color` sits on row r. */
export const wallCol = (r, color) => (color + r) % 5;

/**
 * newGame(seed, {rival, colors}) -> a game dealt for round 1. `colors` (her
 * five glaze ids) is carried along untouched for the sim and the UI.
 */
export function newGame(seed, { rival = true, colors = null } = {}) {
  const s0 = (Number(seed) >>> 0) || 1;
  const s = {
    v: GAME_VERSION, seed: s0, rs: s0, rival: !!rival, round: 0,
    bag: [], kiln: [0, 0, 0, 0, 0],
    dishes: [[], [], [], [], []], center: [],
    lines: Array.from({ length: 5 }, () => ({ color: null, n: 0 })),
    wall: Array.from({ length: 5 }, () => [false, false, false, false, false]),
    seconds: [], rivalTiles: 0, score: 0, over: false, exhausted: false,
  };
  if (Array.isArray(colors)) s.colors = colors.slice(0, 5);
  for (let c = 0; c < 5; c++) for (let i = 0; i < PER_COLOR; i++) s.bag.push(c);
  shuffle(s.bag, s);
  return dealRound(s);
}

function draw(s) {
  if (!s.bag.length) {
    const list = [];
    for (let c = 0; c < 5; c++) for (let i = 0; i < s.kiln[c]; i++) list.push(c);
    s.kiln = [0, 0, 0, 0, 0];
    shuffle(list, s);
    s.bag = list;
  }
  return s.bag.pop();
}

/** dealRound(game) -> the next round dealt (bag refills from the kiln shelf); none left ends the wall. */
export function dealRound(state) {
  const s = clone(state);
  s.round += 1;
  s.center = [];
  for (let d = 0; d < DISHES; d++) {
    s.dishes[d] = [];
    for (let i = 0; i < DISH_SIZE; i++) {
      const t = draw(s);
      if (t === undefined) break;
      s.dishes[d].push(t);
    }
  }
  if (s.dishes.every((d) => !d.length)) { s.over = true; s.exhausted = true; }
  return s;
}

const countOf = (arr, c) => arr.reduce((n, x) => n + (x === c ? 1 : 0), 0);

/** legalLines(game, color) -> pattern line indices that can take `color`. */
export function legalLines(state, color) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const L = state.lines[i];
    if (L.n >= i + 1) continue;
    if (L.n > 0 && L.color !== color) continue;
    if (state.wall[i][wallCol(i, color)]) continue;
    out.push(i);
  }
  return out;
}

export function sourceTiles(state, source, index) {
  return source === 'center' ? state.center : state.dishes[index] || [];
}

/**
 * take(game, {source:'dish'|'center', index, color, line}) -> {ok, state, moved, overflow} | {ok:false, reason}.
 * line -1 sends every tile to the seconds basket (always legal).
 */
export function take(state, { source, index = 0, color, line } = {}) {
  if (!state || state.over) return { ok: false, reason: 'over' };
  if (source !== 'dish' && source !== 'center') return { ok: false, reason: 'source' };
  if (source === 'dish' && !(index >= 0 && index < DISHES)) return { ok: false, reason: 'index' };
  if (!(color >= 0 && color < 5)) return { ok: false, reason: 'color' };
  const src = sourceTiles(state, source, index);
  const count = countOf(src, color);
  if (!count) return { ok: false, reason: 'empty' };
  if (!Number.isInteger(line) || line < -1 || line > 4) return { ok: false, reason: 'line' };
  if (line >= 0 && !legalLines(state, color).includes(line)) return { ok: false, reason: 'illegal' };
  const s = clone(state);
  const rest = src.filter((c) => c !== color);
  let slid = 0;
  if (source === 'dish') {
    s.dishes[index] = [];
    s.center = s.center.concat(rest).sort((a, b) => a - b);
    slid = rest.length;
  } else {
    s.center = rest;
  }
  let placed = 0;
  if (line >= 0) {
    const L = s.lines[line];
    placed = Math.min(count, line + 1 - L.n);
    L.color = color;
    L.n += placed;
  }
  const overflow = count - placed;
  for (let i = 0; i < overflow; i++) s.seconds.push(color);
  return { ok: true, state: s, moved: { source, index, color, count, line, placed, overflow, slid }, overflow };
}

/**
 * sweepMiddle(game) -> {ok, state, count}. Once every dish is empty she may
 * finish the round: whatever is left in the middle goes to the seconds basket
 * (it sells there), and the round ends as usual.
 */
export function sweepMiddle(state) {
  if (!state || state.over || state.dishes.some((d) => d.length) || !state.center.length) return { ok: false, count: 0, state };
  const s = clone(state);
  const count = s.center.length;
  for (const c of s.center) s.seconds.push(c);
  s.center = [];
  return { ok: true, count, state: s };
}

/**
 * Ida's stated rule: the colour group with the most tiles of one colour on any
 * dish; ties go to the leftmost dish, then the lowest colour. Returns
 * {dish, color, tiles} or null (no dish holds a tile).
 */
export function rivalChoice(state) {
  let best = null;
  for (let d = 0; d < DISHES; d++) {
    for (let c = 0; c < 5; c++) {
      const n = countOf(state.dishes[d], c);
      if (n && (!best || n > best.tiles)) best = { dish: d, color: c, tiles: n };
    }
  }
  return best;
}

/** rivalTurn(game) -> {dish, color, tiles, leftover, state}; dish -1 when she rests or nothing is left. */
export function rivalTurn(state) {
  const pick = state.rival ? rivalChoice(state) : null;
  const s = clone(state);
  if (!pick) return { dish: -1, color: -1, tiles: 0, leftover: 0, state: s };
  const rest = s.dishes[pick.dish].filter((c) => c !== pick.color);
  s.dishes[pick.dish] = [];
  s.center = s.center.concat(rest).sort((a, b) => a - b);
  s.rivalTiles += pick.tiles;
  return { ...pick, leftover: rest.length, state: s };
}

/** True when the dishes and the middle are empty (time to set the wall). */
export function roundOver(state) {
  return state.center.length === 0 && state.dishes.every((d) => !d.length);
}

/** Points for a tile placed at (r, c): 1 alone, else the length of each joined row/column run. */
export function placementScore(wall, r, c) {
  let h = 1, v = 1;
  for (let x = c - 1; x >= 0 && wall[r][x]; x--) h++;
  for (let x = c + 1; x < 5 && wall[r][x]; x++) h++;
  for (let y = r - 1; y >= 0 && wall[y][c]; y--) v++;
  for (let y = r + 1; y < 5 && wall[y][c]; y++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

export const rowDone = (wall, r) => wall[r].every(Boolean);
export const anyRowDone = (wall) => wall.some((_, r) => rowDone(wall, r));

/**
 * endRound(game) -> {placements:[{row, col, color, points}], seconds, secondsCount, gameOver, state}.
 * Full lines set a tile in row order (each scores against what is already
 * set); the rest of each full line and the seconds go back to the kiln shelf.
 * Does not deal the next round: call dealRound(state) when not gameOver.
 */
export function endRound(state) {
  const s = clone(state);
  const placements = [];
  for (let r = 0; r < 5; r++) {
    const L = s.lines[r];
    if (L.n !== r + 1) continue;
    const col = wallCol(r, L.color);
    s.wall[r][col] = true;
    const points = placementScore(s.wall, r, col);
    s.score += points;
    placements.push({ row: r, col, color: L.color, points });
    s.kiln[L.color] += r; // the rest of the line returns to the shelf
    L.color = null; L.n = 0;
  }
  const seconds = s.seconds.length * SECOND_VALUE;
  s.score += seconds;
  for (const c of s.seconds) s.kiln[c] += 1;
  const secondsCount = s.seconds.length;
  s.seconds = [];
  const gameOver = anyRowDone(s.wall);
  if (gameOver) s.over = true;
  return { placements, seconds, secondsCount, gameOver, state: s };
}

/** finalScore(game) -> {rowsDone, colsDone, colorsDone, rows, cols, colors, bonus, total}. */
export function finalScore(state) {
  const w = state.wall;
  let rowsDone = 0, colsDone = 0, colorsDone = 0;
  for (let r = 0; r < 5; r++) if (w[r].every(Boolean)) rowsDone++;
  for (let c = 0; c < 5; c++) if (w.every((row) => row[c])) colsDone++;
  for (let k = 0; k < 5; k++) if (w.every((row, r) => row[wallCol(r, k)])) colorsDone++;
  const rows = rowsDone * BONUS.row, cols = colsDone * BONUS.col, colors = colorsDone * BONUS.color;
  return { rowsDone, colsDone, colorsDone, rows, cols, colors, bonus: rows + cols + colors, total: state.score + rows + cols + colors };
}

/** Tiles set on the wall. */
export function wallCount(state) {
  return state.wall.reduce((n, r) => n + r.filter(Boolean).length, 0);
}

/** Conservation check: always TOTAL_TILES. */
export function countTiles(s) {
  const dishes = s.dishes.reduce((n, d) => n + d.length, 0);
  const lines = s.lines.reduce((n, l) => n + l.n, 0);
  return s.bag.length + s.kiln.reduce((a, b) => a + b, 0) + dishes + s.center.length + lines + wallCount(s) + s.seconds.length + s.rivalTiles;
}

const isColor = (x) => Number.isInteger(x) && x >= 0 && x < 5;
const colorList = (a) => Array.isArray(a) && a.every(isColor);

/**
 * isValidGame(game) -> boolean: the shape a saved game must have to resume
 * (and its tiles add up). A save that fails it starts a fresh wall instead.
 */
export function isValidGame(g) {
  try {
    if (!g || typeof g !== 'object' || g.v !== GAME_VERSION) return false;
    if (!Number.isInteger(g.rs) && !Number.isFinite(g.rs)) return false;
    if (!colorList(g.bag) || !colorList(g.center) || !colorList(g.seconds)) return false;
    if (!Array.isArray(g.kiln) || g.kiln.length !== 5 || !g.kiln.every((n) => Number.isInteger(n) && n >= 0)) return false;
    if (!Array.isArray(g.dishes) || g.dishes.length !== DISHES || !g.dishes.every(colorList)) return false;
    if (!Array.isArray(g.lines) || g.lines.length !== 5) return false;
    for (let i = 0; i < 5; i++) {
      const L = g.lines[i];
      if (!L || !Number.isInteger(L.n) || L.n < 0 || L.n > i + 1) return false;
      if (L.n > 0 && !isColor(L.color)) return false;
    }
    if (!Array.isArray(g.wall) || g.wall.length !== 5 || !g.wall.every((r) => Array.isArray(r) && r.length === 5)) return false;
    if (!Number.isFinite(g.score) || !Number.isInteger(g.round) || !Number.isInteger(g.rivalTiles)) return false;
    return countTiles(g) === TOTAL_TILES;
  } catch (e) {
    return false;
  }
}
