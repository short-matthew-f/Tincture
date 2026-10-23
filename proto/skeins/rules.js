// Skein Stacks: pure rules. No window/document/Date.now/Math.random.
// All randomness comes from a mulberry32 seed carried in the state (state.rs),
// so a saved game deals the same stacks again. Every function returns new data.
//
// THE RULES
// - The board is a honeycomb of pegs (pointy-top hexes, rows offset "odd-r":
//   odd rows sit half a peg to the right). A few pegs are knots (blocked).
//   Each peg holds a stack of yarn tiles, bottom to top; a tile is a color index.
// - The tray offers 3 stacks (2-6 tiles in 1-3 color bands). She places a tray
//   stack on any empty peg. When all 3 are placed, the tray refills.
// - A stack's "top run" is the unbroken run of its top color, counted from the top.
//
// THE MERGE RULE (exact, deterministic)
//   After a placement, the changed pegs go in a queue (the placed peg first).
//   Repeat until nothing changes:
//   1. Bundle: if any stack's top run is 10 or more (pegs scanned in index
//      order), that whole run lifts off as one hank, and the peg is queued.
//   2. Otherwise take the next queued peg that has a neighbor with the same top
//      color (if the queue is empty, scan every peg in index order as a
//      safety net). Its "cluster" is every non-empty stack connected to it
//      through neighbors sharing that top color c.
//   3. Every top run of c in the cluster gathers onto ONE receiving stack: the
//      stack that will end up with the most c on top for the fewest hops, i.e.
//        a. the longest top run of c already;
//        b. ties: a stack that is c all the way down (a clean pile);
//        c. ties: the peg that was just placed or changed (the queued peg);
//        d. ties: the lowest peg index.
//   4. Tiles travel peg to peg along the shortest path inside the cluster
//      (breadth-first from the receiver, neighbors in index order): the stacks
//      farthest from the receiver move first (ties: lower peg index), each
//      handing its whole current top run of c to its parent on that path, so a
//      chain reads as a line of hops into the receiver.
//   5. Every donor is queued (in peg order): it now shows a new top color, or
//      is empty. Go to 1.
//   Bundling a run reveals the color under it, which can start a new cascade.
//
// NO FAIL STATE
//   "stuck" = the board has no empty peg while the tray still has a stack.
//   "tight" = 2 or fewer empty pegs and no tray stack merges anywhere.
//   Then the UI offers Undo (unlimited) or a free nudge: clear a peg (its
//   stack is set aside) or swap the tray (3 fresh stacks). Nudges are counted
//   quietly in the session stats, never shown as a cost.

export const VERSION = 1;
export const HANK = 10; // a top run of this many lifts off as a hank

export const COLORS = [
  { id: 'madder', name: 'Madder red', hex: '#C0573B', glyph: 'dot' },
  { id: 'weld', name: 'Weld yellow', hex: '#D5AE3C', glyph: 'diamond' },
  { id: 'woad', name: 'Woad blue', hex: '#4C76A6', glyph: 'ring' },
  { id: 'walnut', name: 'Walnut brown', hex: '#6E4B33', glyph: 'wave' },
  { id: 'cochineal', name: 'Cochineal pink', hex: '#B04F7A', glyph: 'heart' },
  { id: 'nettle', name: 'Nettle green', hex: '#728F4C', glyph: 'leaf' },
];

// Shapes: '.' peg, '#' knot (blocked), ' ' nothing. Odd rows sit half a peg right.
export const SHAPES = {
  hex19: [' ...', '....', '.....', '....', ' ...'],
  wide24: [' ....', '.....', '......', '.....', ' ....'],
  rect25: ['.....', '.....', '.....', '.....', '.....'],
  rect30: ['.....', '.....', '.....', '.....', '.....', '.....'],
  big29: [' .....', '......', '.......', '......', ' .....'],
};

// colors: how many of COLORS are in play. goal.colors: { colorIndex: hanks }.
// maxH: tallest tray stack. mono: share of single-color tray stacks; tri: share
// with three bands (the rest have two). pull (default 2): top-color bias.
export const LEVELS = [
  { id: 'l1', name: 'First skeins', shape: 'hex19', colors: 3, goal: { hanks: 6 }, maxH: 4, mono: 0.55, tri: 0 },
  { id: 'l2', name: 'A basket of three', shape: 'hex19', colors: 3, goal: { hanks: 10 }, maxH: 5, mono: 0.45, tri: 0.05 },
  { id: 'l3', name: 'Walnut joins', shape: 'wide24', colors: 4, goal: { hanks: 10 }, maxH: 5, mono: 0.4, tri: 0.1 },
  { id: 'l4', name: 'Square shelf', shape: 'rect25', colors: 4, goal: { hanks: 12 }, maxH: 5, mono: 0.3, tri: 0.15 },
  { id: 'l5', name: 'Knots in the wood', shape: 'wide24', knots: [[2, 2], [3, 2]], colors: 4, goal: { hanks: 12, colors: { 2: 3 } }, maxH: 5, mono: 0.3, tri: 0.2, pull: 1 },
  { id: 'l6', name: 'Cochineal arrives', shape: 'rect30', colors: 5, goal: { hanks: 15 }, maxH: 5, mono: 0.25, tri: 0.25, pull: 1 },
  { id: 'l7', name: 'Pink for a shawl', shape: 'big29', knots: [[3, 0], [0, 2], [6, 2]], colors: 5, goal: { hanks: 15, colors: { 4: 4 } }, maxH: 6, mono: 0.2, tri: 0.3, pull: 1 },
  { id: 'l8', name: 'Long table', shape: 'rect30', knots: [[1, 2], [3, 3]], colors: 5, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 1 },
  { id: 'l9', name: 'Nettle green', shape: 'big29', colors: 6, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 0.5 },
  { id: 'l10', name: 'A sweater\'s worth', shape: 'rect30', knots: [[2, 1], [2, 4]], colors: 6, goal: { hanks: 20, colors: { 5: 3, 3: 3 } }, maxH: 6, mono: 0.2, tri: 0.35, pull: 1 },
  { id: 'l11', name: 'Market day', shape: 'big29', knots: [[1, 1], [5, 3]], colors: 6, goal: { hanks: 22 }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
  { id: 'l12', name: 'The whole dye shed', shape: 'big29', colors: 6, goal: { hanks: 25, colors: { 0: 5, 2: 5 } }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
];

// ---------- rng ----------
function rand(s) {
  s.rs = (s.rs + 0x6D2B79F5) >>> 0;
  let t = s.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, n) => Math.floor(rand(s) * n);

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- board geometry ----------
const boards = new Map();
/** geometry(shapeRows, knots) -> { cells: [{col,row,knot}], nbr: number[][], cols, rows } */
export function geometry(rowsStr, knotList = []) {
  const knots = new Set(knotList.map(([c, r]) => `${c},${r}`));
  const cells = [];
  const at = new Map();
  rowsStr.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === ' ') return;
      at.set(`${col},${row}`, cells.length);
      cells.push({ col, row, knot: ch === '#' || knots.has(`${col},${row}`) });
    });
  });
  const nbr = cells.map(({ col, row, knot }) => {
    if (knot) return [];
    const d = row & 1
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    return d.map(([dc, dr]) => at.get(`${col + dc},${row + dr}`))
      .filter((i) => i !== undefined && !cells[i].knot)
      .sort((a, b) => a - b);
  });
  return { cells, nbr, rows: rowsStr.length, cols: Math.max(...rowsStr.map((r) => r.length)) };
}
/** board(levelIndex) -> geometry of that level (memoized, read-only). */
export function board(li) {
  if (!boards.has(li)) boards.set(li, geometry(SHAPES[LEVELS[li].shape], LEVELS[li].knots));
  return boards.get(li);
}

// ---------- stacks ----------
export const top = (st) => (st && st.length ? st[st.length - 1] : -1);
export function topRun(st) {
  if (!st || !st.length) return 0;
  const c = st[st.length - 1];
  let n = 0;
  for (let i = st.length - 1; i >= 0 && st[i] === c; i--) n++;
  return n;
}
export const bands = (st) => {
  const out = [];
  for (const c of st || []) {
    if (out.length && out[out.length - 1].c === c) out[out.length - 1].n++;
    else out.push({ c, n: 1 });
  }
  return out;
};

/**
 * resolve(stacks, nbr, queue) -> { stacks, steps, hanks }
 * Runs THE MERGE RULE above on a copy. steps (in order) are
 *   { type: 'move', from, to, color, n }   n tiles hop from -> to, one at a time
 *   { type: 'bundle', cell, color, n }     a top run of n lifts off as a hank
 * hanks: the color index of each hank made, in order.
 */
export function resolve(stacks0, nbr, queue0 = []) {
  const stacks = stacks0.map((s) => (s ? s.slice() : s));
  const queue = queue0.slice();
  const steps = [], hanks = [];
  const live = (i) => stacks[i] && stacks[i].length;
  const hasMatch = (i) => live(i) && nbr[i].some((j) => live(j) && top(stacks[j]) === top(stacks[i]));
  let guard = 0;
  for (;;) {
    if (++guard > 5000) throw new Error('resolve did not settle');
    // 1. bundles
    let bundled = false;
    for (let i = 0; i < stacks.length; i++) {
      const n = topRun(stacks[i]);
      if (n >= HANK) {
        const c = top(stacks[i]);
        stacks[i].length -= n;
        steps.push({ type: 'bundle', cell: i, color: c, n });
        hanks.push(c);
        queue.push(i);
        bundled = true;
        break;
      }
    }
    if (bundled) continue;
    // 2. next seed
    let seed = -1;
    while (queue.length) {
      const x = queue.shift();
      if (hasMatch(x)) { seed = x; break; }
    }
    if (seed < 0) {
      for (let i = 0; i < stacks.length; i++) if (hasMatch(i)) { seed = i; break; }
    }
    if (seed < 0) break;
    const c = top(stacks[seed]);
    const comp = [seed];
    const inComp = new Set(comp);
    for (let k = 0; k < comp.length; k++) {
      for (const j of nbr[comp[k]]) {
        if (!inComp.has(j) && live(j) && top(stacks[j]) === c) { inComp.add(j); comp.push(j); }
      }
    }
    // 3. receiver
    const score = (i) => [topRun(stacks[i]), topRun(stacks[i]) === stacks[i].length ? 1 : 0, i === seed ? 1 : 0, -i];
    let recv = comp[0];
    for (const i of comp) {
      const a = score(i), b = score(recv);
      for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) { if (a[k] > b[k]) recv = i; break; } }
    }
    // 4. paths inside the cluster, breadth-first from the receiver
    const dist = new Map([[recv, 0]]), parent = new Map();
    const order = [recv];
    for (let k = 0; k < order.length; k++) {
      const u = order[k];
      for (const j of nbr[u]) {
        if (inComp.has(j) && !dist.has(j)) { dist.set(j, dist.get(u) + 1); parent.set(j, u); order.push(j); }
      }
    }
    const donors = comp.filter((i) => i !== recv).sort((a, b) => dist.get(b) - dist.get(a) || a - b);
    for (const d of donors) {
      const n = topRun(stacks[d]);
      const to = parent.get(d);
      for (let k = 0; k < n; k++) stacks[to].push(stacks[d].pop());
      steps.push({ type: 'move', from: d, to, color: c, n });
    }
    // 5. donors show something new
    queue.push(...donors.slice().sort((a, b) => a - b));
  }
  return { stacks, steps, hanks };
}

// ---------- tray generation ----------
/**
 * genStack(state, li) -> number[]  (advances state.rs; mutates the given state)
 * Height 2..maxH. A share `mono` are one color; the rest have 2 (or rarely 3)
 * bands. The TOP color is biased toward colors already showing on the board
 * (weight 1 + 2 x stacks showing it) and toward goal colors still owed, so a
 * reasonable player usually has a merge to make.
 */
export function genStack(s, li) {
  const L = LEVELS[li];
  const K = L.colors;
  const h = 2 + pick(s, L.maxH - 1);
  const r = rand(s);
  let nb = r < L.mono ? 1 : r < 1 - (L.tri ?? 0.12) ? 2 : 3;
  nb = Math.min(nb, h);
  const w = new Array(K).fill(1);
  const pull = L.pull ?? 2;
  for (const st of s.stacks) if (st && st.length) w[top(st)] += pull;
  const owed = goalOwed(s, li);
  for (const c in owed) if (owed[c] > 0) w[c] += 2;
  const tw = w.reduce((a, b) => a + b, 0);
  let x = rand(s) * tw, topC = 0;
  for (; topC < K - 1; topC++) { x -= w[topC]; if (x < 0) break; }
  // band sizes: split h into nb parts, each >= 1
  const sizes = new Array(nb).fill(1);
  for (let k = nb; k < h; k++) sizes[pick(s, nb)]++;
  const cols = [topC];
  for (let k = 1; k < nb; k++) {
    let c = pick(s, K - 1);
    if (c >= cols[k - 1]) c++;
    cols.push(c);
  }
  // cols[0] is the top band; build bottom -> top
  const out = [];
  for (let k = nb - 1; k >= 0; k--) for (let i = 0; i < sizes[k]; i++) out.push(cols[k]);
  return out;
}

function refill(s, li) {
  s.tray = [genStack(s, li), genStack(s, li), genStack(s, li)];
  s.deals++;
}

// ---------- level state ----------
export function newLevel(li, seed) {
  const b = board(li);
  const s = {
    v: VERSION, level: li, seed: seed >>> 0, rs: seed >>> 0,
    stacks: b.cells.map((c) => (c.knot ? null : [])),
    tray: [null, null, null], hanks: [], aside: 0, moves: 0, deals: 0, done: false,
  };
  refill(s, li);
  return s;
}

export function goalOwed(s, li = s.level) {
  const g = LEVELS[li].goal;
  const owed = {};
  for (const c in g.colors || {}) owed[c] = g.colors[c] - s.hanks.filter((h) => h === +c).length;
  return owed;
}
export function goalMet(s, li = s.level) {
  const g = LEVELS[li].goal;
  if (s.hanks.length < g.hanks) return false;
  return Object.values(goalOwed(s, li)).every((n) => n <= 0);
}

export const emptyPegs = (s) => s.stacks.reduce((a, st, i) => (st && !st.length ? a.concat(i) : a), []);

/**
 * place(state, trayIndex, cell) -> { ok, reason?, state, steps, hanks, refilled }
 */
export function place(state, t, cell) {
  if (state.done) return { ok: false, reason: 'done', state };
  if (!(t >= 0 && t < 3) || !state.tray[t]) return { ok: false, reason: 'tray', state };
  const st = state.stacks[cell];
  if (!st) return { ok: false, reason: 'peg', state };
  if (st.length) return { ok: false, reason: 'taken', state };
  const s = clone(state);
  s.stacks[cell] = s.tray[t];
  s.tray[t] = null;
  s.moves++;
  const r = resolve(s.stacks, board(s.level).nbr, [cell]);
  s.stacks = r.stacks;
  s.hanks.push(...r.hanks);
  if (goalMet(s)) s.done = true;
  let refilled = false;
  if (!s.done && s.tray.every((x) => !x)) { refill(s, s.level); refilled = true; }
  return { ok: true, state: s, steps: r.steps, hanks: r.hanks, refilled };
}

/** Nudge: set the stack on a peg aside (it leaves the board, not a hank). */
export function clearPeg(state, cell) {
  const st = state.stacks[cell];
  if (state.done || !st || !st.length) return { ok: false, state };
  const s = clone(state);
  s.aside += st.length;
  s.stacks[cell] = [];
  return { ok: true, state: s, removed: st.slice() };
}

/** Nudge: three fresh stacks in the tray. */
export function swapTray(state) {
  if (state.done) return { ok: false, state };
  const s = clone(state);
  refill(s, s.level);
  return { ok: true, state: s };
}

/** How the board feels: 'ok', 'tight' or 'stuck' (see NO FAIL STATE). */
export function situation(state) {
  if (state.done) return 'done';
  const empty = emptyPegs(state);
  if (!empty.length) return 'stuck';
  if (empty.length > 2) return 'ok';
  return bestPlacement(state).gain > 0 ? 'ok' : 'tight';
}

// ---------- the bot ----------
/**
 * bestPlacement(state) -> { t, cell, gain } (t = -1 when no empty peg).
 * Greedy: the placement that moves the most tiles (a hank counts 20 extra);
 * if nothing merges, the first tray stack on the first empty peg.
 */
export function bestPlacement(state) {
  const empty = emptyPegs(state);
  let best = { t: -1, cell: -1, gain: 0 };
  if (!empty.length) return best;
  const nbr = board(state.level).nbr;
  for (let t = 0; t < 3; t++) {
    const tr = state.tray[t];
    if (!tr) continue;
    if (best.t < 0) best = { t, cell: empty[0], gain: 0 };
    for (const cell of empty) {
      // only a peg next to a matching top can merge
      if (!nbr[cell].some((j) => state.stacks[j] && state.stacks[j].length && top(state.stacks[j]) === top(tr))) continue;
      const stacks = state.stacks.slice();
      stacks[cell] = tr;
      const r = resolve(stacks, nbr, [cell]);
      const gain = r.steps.reduce((a, x) => a + (x.type === 'move' ? x.n : 20), 0);
      if (gain > best.gain) best = { t, cell, gain };
    }
  }
  return best;
}

/** The bot's nudge when the board is full: clear the tallest stack (ties: lowest peg). */
export function botClearChoice(state) {
  let bi = -1;
  state.stacks.forEach((st, i) => { if (st && (bi < 0 || st.length > state.stacks[bi].length)) bi = i; });
  return bi;
}

/** Play a level with the greedy bot. -> { done, moves, nudges, hanks, aside } */
export function botPlay(li, seed, maxMoves = 600) {
  let s = newLevel(li, seed), nudges = 0;
  while (!s.done && s.moves < maxMoves) {
    const m = bestPlacement(s);
    if (m.t < 0) { s = clearPeg(s, botClearChoice(s)).state; nudges++; continue; }
    s = place(s, m.t, m.cell).state;
  }
  return { done: s.done, moves: s.moves, nudges, hanks: s.hanks.length, aside: s.aside, state: s };
}

// ---------- session: undo and quiet stats ----------
export const HISTORY_CAP = 400;
export function newSession(li, seed) {
  return { state: newLevel(li, seed), past: [], stats: { moves: 0, undos: 0, clears: 0, swaps: 0 } };
}
const push = (sess, state, stat) => ({
  state,
  past: sess.past.concat([sess.state]).slice(-HISTORY_CAP),
  stats: { ...sess.stats, [stat]: sess.stats[stat] + 1 },
});
export function sessionPlace(sess, t, cell) {
  const r = place(sess.state, t, cell);
  if (!r.ok) return { ...r, session: sess };
  return { ...r, session: push(sess, r.state, 'moves') };
}
export function sessionClear(sess, cell) {
  const r = clearPeg(sess.state, cell);
  if (!r.ok) return { ...r, session: sess };
  return { ...r, session: push(sess, r.state, 'clears') };
}
export function sessionSwap(sess) {
  const r = swapTray(sess.state);
  if (!r.ok) return { ...r, session: sess };
  return { ...r, session: push(sess, r.state, 'swaps') };
}
/** Undo restores the previous state exactly; the stats keep counting (they are ours, not hers). */
export function sessionUndo(sess) {
  if (!sess.past.length) return { ok: false, session: sess };
  return {
    ok: true,
    session: { state: sess.past[sess.past.length - 1], past: sess.past.slice(0, -1), stats: { ...sess.stats, undos: sess.stats.undos + 1 } },
  };
}

export const hankName = (c) => `${COLORS[c].name} hank`;
