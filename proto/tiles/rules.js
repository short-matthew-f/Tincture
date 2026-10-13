// The Tile Room: pure rules. No window/document/Date.now/Math.random.
// All randomness comes from a mulberry32 seed stored in the state (state.rs),
// so a saved game restores the same bag. Every function returns a new state.

export const COLORS = ['madder', 'ochre', 'woad', 'sage', 'walnut'];
export const HEX = ['#B8433A', '#D9A63A', '#3E6A9E', '#8A9A6B', '#6B4A32'];
export const GLYPHS = ['dot', 'diamond', 'ring', 'leaf', 'wave'];
export const TOTAL_TILES = 100;
export const DISHES = 5;
export const DISH_SIZE = 4;
export const SECOND_VALUE = 1;
export const COIN_RATE = 8; // prototype-only: points -> coins

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

// Wall layout: row r, column c holds colour (c - r) mod 5.
export const wallColor = (r, c) => (((c - r) % 5) + 5) % 5;
export const wallCol = (r, color) => (color + r) % 5;

export function newGame(seed, { rival = true } = {}) {
  const s = {
    v: 1, seed: seed >>> 0, rs: seed >>> 0, rival: !!rival, round: 0,
    bag: [], kiln: [0, 0, 0, 0, 0],
    dishes: [[], [], [], [], []], center: [],
    lines: Array.from({ length: 5 }, () => ({ color: null, n: 0 })),
    wall: Array.from({ length: 5 }, () => [false, false, false, false, false]),
    seconds: [], rivalTiles: 0, score: 0, over: false, exhausted: false,
  };
  for (let c = 0; c < 5; c++) for (let i = 0; i < 20; i++) s.bag.push(c);
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

export function take(state, { source, index = 0, color, line }) {
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

// Ida: takes the colour group with the most tiles of one colour on any dish;
// ties go to the leftmost dish, then the lowest colour. The rest slide to the centre.
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

export function roundOver(state) {
  return state.center.length === 0 && state.dishes.every((d) => !d.length);
}

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

// Does not deal the next round: call dealRound(state) when not gameOver.
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

export function finalScore(state) {
  const w = state.wall;
  let rowsDone = 0, colsDone = 0, colorsDone = 0;
  for (let r = 0; r < 5; r++) if (w[r].every(Boolean)) rowsDone++;
  for (let c = 0; c < 5; c++) if (w.every((row) => row[c])) colsDone++;
  for (let k = 0; k < 5; k++) if (w.every((row, r) => row[wallCol(r, k)])) colorsDone++;
  const rows = rowsDone * 2, cols = colsDone * 7, colors = colorsDone * 10;
  return { rowsDone, colsDone, colorsDone, rows, cols, colors, bonus: rows + cols + colors, total: state.score + rows + cols + colors };
}

export const coinValue = (points) => points * COIN_RATE;

// Conservation check: always TOTAL_TILES.
export function countTiles(s) {
  const dishes = s.dishes.reduce((n, d) => n + d.length, 0);
  const lines = s.lines.reduce((n, l) => n + l.n, 0);
  const wall = s.wall.reduce((n, r) => n + r.filter(Boolean).length, 0);
  return s.bag.length + s.kiln.reduce((a, b) => a + b, 0) + dishes + s.center.length + lines + wall + s.seconds.length + s.rivalTiles;
}
