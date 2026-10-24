// puzzles/skeins.js — Skein Stacks, the Winding Room's rules (pure).
// Mirrored in proto/skeins/rules.js (the prototype imports the same levels
// from proto/skeins/levels.js; test/skeins.test.js checks the copies match).
// The first 12 levels are the playtested prototype's, unchanged: a level that
// uses none of the newer mechanics deals, merges and bundles exactly as before,
// so a saved level resumes on the same tray. The levels, chapters and the
// mechanics' intro cards live in ./skeins-levels.js. The sim
// (src/sim/skeins.js) maps color indices 0..5 to her discovered color ids
// (level.colors) and owns coins, hooks and progress.
//
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
//   1. Bundle: if any stack's top run is 10 or more (8 on a spindle peg; pegs
//      scanned in index order), that whole run lifts off as one hank, and the
//      peg is queued. A hank tied next to a snarl loosens it, and next to a
//      felted stack wakes it (queued: it can merge now).
//   2. Otherwise take the next queued peg that has a neighbor with the same top
//      color (if the queue is empty, scan every peg in index order as a
//      safety net). Its "cluster" is every non-empty, awake stack connected to
//      it through neighbors sharing that top color c.
//   3. Every top run of c in the cluster gathers onto ONE receiving stack: the
//      stack that will end up with the most c on top for the fewest hops, i.e.
//        a. the longest top run of c already;
//        a2. ties: a spindle peg (levels with spindles only);
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
// THE NEWER MECHANICS (each level lists its own; ./skeins-levels.js MECHANICS)
//   snarl:   a peg tangled shut; a hank tied on a neighboring peg loosens it
//            for good (state.snarl: the pegs still snarled).
//   felt:    a stack dealt at the start, felted fast: it neither gives nor
//            takes yarn until a hank is tied next to it (state.felt).
//   spindle: a spindle peg twists a top run of 8 into a hank.
//   preview: the next tray shows under this one (state.next).
//   goals:   order (exact colored hanks for a customer), basket (a gentle
//            count of trays: finishing within it earns a ribbon, and the tray
//            simply keeps coming after it), untie (every snarl loose and every
//            felted stack awake).
//
// NO FAIL STATE
//   "stuck" = the board has no empty peg while the tray still has a stack.
//   "tight" = 2 or fewer empty pegs and no tray stack merges anywhere.
//   Then the UI offers Undo (unlimited) or a free nudge: clear a peg (its
//   stack is set aside) or swap the tray (3 fresh stacks). Nudges are counted
//   quietly in the session stats, never shown as a cost.

import { SHAPES, LEVELS, CHAPTERS, MECHANICS } from './skeins-levels.js';

export { SHAPES, LEVELS, CHAPTERS, MECHANICS };
export const VERSION = 1;
export const HANK = 10; // a top run of this many lifts off as a hank
export const SPINDLE_HANK = 8; // ... and this many on a spindle peg

export const COLORS = [
  { id: 'madder', name: 'Madder red', hex: '#C0573B', glyph: 'dot' },
  { id: 'weld', name: 'Weld yellow', hex: '#D5AE3C', glyph: 'diamond' },
  { id: 'woad', name: 'Woad blue', hex: '#4C76A6', glyph: 'ring' },
  { id: 'walnut', name: 'Walnut brown', hex: '#6E4B33', glyph: 'wave' },
  { id: 'cochineal', name: 'Cochineal pink', hex: '#B04F7A', glyph: 'heart' },
  { id: 'nettle', name: 'Nettle green', hex: '#728F4C', glyph: 'leaf' },
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
/** geometry(shapeRows, knots) -> { cells: [{col,row,knot}], nbr: number[][], cols, rows, minX } */
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
  const minX = Math.min(...cells.map((c) => c.col + (c.row & 1) * 0.5));
  return { cells, nbr, rows: rowsStr.length, cols: Math.max(...rowsStr.map((r) => r.length)), minX, at };
}

/** cellsAt(b, list) -> peg indices for [[col,row]...] (sorted; unknown spots are skipped). */
function cellsAt(b, list) {
  return (list || []).map(([c, r]) => b.at.get(`${c},${r}`)).filter((i) => i !== undefined && !b.cells[i].knot).sort((a, b2) => a - b2);
}

/**
 * board(levelIndex) -> geometry of that level (memoized, read-only), plus the
 * level's marked pegs: snarls, felts, spindles (index lists), thr (per-peg hank
 * size, only when the level has spindles) and spin (Set of spindle pegs).
 */
export function board(li) {
  if (!boards.has(li)) {
    const L = LEVELS[li];
    const b = geometry(SHAPES[L.shape], L.knots);
    b.snarls = cellsAt(b, L.snarls);
    b.felts = cellsAt(b, L.felt);
    b.spindles = cellsAt(b, L.spindles);
    b.spin = b.spindles.length ? new Set(b.spindles) : null;
    b.thr = b.spin ? b.cells.map((_, i) => (b.spin.has(i) ? SPINDLE_HANK : HANK)) : null;
    boards.set(li, b);
  }
  return boards.get(li);
}

/** The hank size on peg `cell` of level li (8 on a spindle, else 10). */
export function hankAt(li, cell) {
  const b = board(li);
  return b.thr ? b.thr[cell] : HANK;
}

// ---------- levels: chapters, mechanics, goals ----------

/** chapterOf(li) -> index into CHAPTERS. */
export function chapterOf(li) {
  let at = 0;
  for (let c = 0; c < CHAPTERS.length; c++) {
    if (li < at + CHAPTERS[c].levels) return c;
    at += CHAPTERS[c].levels;
  }
  return CHAPTERS.length - 1;
}
/** chapterStart(c) -> the first level index of chapter c. */
export function chapterStart(c) {
  let at = 0;
  for (let k = 0; k < c && k < CHAPTERS.length; k++) at += CHAPTERS[k].levels;
  return at;
}

/** levelMechanics(li) -> the mechanic ids level li uses (see MECHANICS). */
export function levelMechanics(li) {
  const L = LEVELS[li];
  if (!L) return [];
  const g = L.goal || {};
  const out = [];
  if (L.snarls && L.snarls.length) out.push('snarl');
  if (g.order) out.push('order');
  if (g.trays) out.push('basket');
  if (L.felt && L.felt.length) out.push('felt');
  if (L.spindles && L.spindles.length) out.push('spindle');
  if (L.preview) out.push('preview');
  if (g.untie) out.push('untie');
  return out;
}

const firstUse = new Map();
/** introducedAt(li) -> the mechanics level li shows for the first time (its intro cards). */
export function introducedAt(li) {
  if (!firstUse.size) {
    LEVELS.forEach((_, i) => levelMechanics(i).forEach((m) => { if (!firstUse.has(m)) firstUse.set(m, i); }));
  }
  return levelMechanics(li).filter((m) => firstUse.get(m) === li);
}

/**
 * goalOf(li) -> { hanks, colors: {colorIndex: n}, order, who, trays, untie }.
 * hanks: hanks in all (an order's total when the level is an order);
 * colors: hanks owed in set colors (an order's lines); trays: the basket (0: none).
 */
export function goalOf(li) {
  const g = (LEVELS[li] && LEVELS[li].goal) || {};
  const colors = g.order || g.colors || {};
  const sum = Object.values(colors).reduce((a, n) => a + n, 0);
  return {
    hanks: g.order ? Math.max(g.hanks || 0, sum) : g.hanks || 0,
    colors,
    order: !!g.order,
    who: g.who || '',
    trays: g.trays || 0,
    untie: !!g.untie,
  };
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
 * resolve(stacks, nbr, queue, opts?) -> { stacks, steps, hanks, felt, snarl }
 * Runs THE MERGE RULE above on a copy. opts (levels with the newer mechanics):
 *   thr: per-peg hank size, spin: Set of spindle pegs, felt / snarl: peg lists.
 * steps (in order) are
 *   { type: 'move', from, to, color, n }   n tiles hop from -> to, one at a time
 *   { type: 'bundle', cell, color, n }     a top run of n lifts off as a hank
 *   { type: 'wake', cell }                 a felted stack wakes (after a hank next to it)
 *   { type: 'loosen', cell }               a snarl comes loose (after a hank next to it)
 * hanks: the color index of each hank made, in order.
 */
export function resolve(stacks0, nbr, queue0 = [], opts = {}) {
  const stacks = stacks0.map((s) => (s ? s.slice() : s));
  const queue = queue0.slice();
  const steps = [], hanks = [];
  const thr = opts.thr || null;
  const spin = opts.spin || null;
  const felt = opts.felt && opts.felt.length ? new Set(opts.felt) : null;
  const snarl = opts.snarl && opts.snarl.length ? new Set(opts.snarl) : null;
  const live = felt
    ? (i) => stacks[i] && stacks[i].length && !felt.has(i)
    : (i) => stacks[i] && stacks[i].length;
  const hasMatch = (i) => live(i) && nbr[i].some((j) => live(j) && top(stacks[j]) === top(stacks[i]));
  let guard = 0;
  for (;;) {
    if (++guard > 5000) throw new Error('resolve did not settle');
    // 1. bundles
    let bundled = false;
    for (let i = 0; i < stacks.length; i++) {
      if (felt && felt.has(i)) continue;
      const n = topRun(stacks[i]);
      if (n >= (thr ? thr[i] : HANK)) {
        const c = top(stacks[i]);
        stacks[i].length -= n;
        steps.push({ type: 'bundle', cell: i, color: c, n });
        hanks.push(c);
        queue.push(i);
        if (felt || snarl) {
          for (const j of nbr[i]) {
            if (felt && felt.has(j)) { felt.delete(j); steps.push({ type: 'wake', cell: j }); queue.push(j); }
            if (snarl && snarl.has(j)) { snarl.delete(j); steps.push({ type: 'loosen', cell: j }); }
          }
        }
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
    const score = spin
      ? (i) => [topRun(stacks[i]), spin.has(i) ? 1 : 0, topRun(stacks[i]) === stacks[i].length ? 1 : 0, i === seed ? 1 : 0, -i]
      : (i) => [topRun(stacks[i]), topRun(stacks[i]) === stacks[i].length ? 1 : 0, i === seed ? 1 : 0, -i];
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
  const out = { stacks, steps, hanks };
  if (opts.felt) out.felt = felt ? [...felt].sort((a, b) => a - b) : [];
  if (opts.snarl) out.snarl = snarl ? [...snarl].sort((a, b) => a - b) : [];
  return out;
}

/** The merge options of a level state (empty for the first 12 levels: the plain rule). */
function optsOf(s) {
  const b = board(s.level);
  if (!b.thr && !s.felt && !s.snarl) return {};
  const o = {};
  if (b.thr) { o.thr = b.thr; o.spin = b.spin; }
  if (s.felt) o.felt = s.felt;
  if (s.snarl) o.snarl = s.snarl;
  return o;
}

// ---------- tray generation ----------
/**
 * genStack(state, li) -> number[]  (advances state.rs; mutates the given state)
 * Height 2..maxH. A share `mono` are one color; the rest have 2 (or rarely 3)
 * bands. The TOP color is biased toward colors already showing on the board
 * (weight 1 + 2 x stacks showing it; felted stacks do not count) and toward
 * goal colors still owed, so a reasonable player usually has a merge to make.
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
  if (s.felt && s.felt.length) {
    s.stacks.forEach((st, i) => { if (st && st.length && !s.felt.includes(i)) w[top(st)] += pull; });
  } else {
    for (const st of s.stacks) if (st && st.length) w[top(st)] += pull;
  }
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

/** A felted stack for the start of a level: 3-5 tiles in 1-2 bands (advances state.rs). */
function genFelt(s, li) {
  const K = LEVELS[li].colors;
  const h = 3 + pick(s, 3);
  const nb = rand(s) < 0.5 ? 1 : 2;
  const a = pick(s, K);
  let b = pick(s, K - 1);
  if (b >= a) b++;
  const cut = nb === 1 ? 0 : 1 + pick(s, h - 1);
  const out = [];
  for (let i = 0; i < h; i++) out.push(i < cut ? b : a);
  return out;
}

function refill(s, li) {
  if (s.next) {
    s.tray = s.next;
    s.next = [genStack(s, li), genStack(s, li), genStack(s, li)];
  } else {
    s.tray = [genStack(s, li), genStack(s, li), genStack(s, li)];
  }
  s.deals++;
}

// ---------- level state ----------
export function newLevel(li, seed) {
  const b = board(li);
  const L = LEVELS[li];
  const s = {
    v: VERSION, level: li, seed: seed >>> 0, rs: seed >>> 0,
    stacks: b.cells.map((c) => (c.knot ? null : [])),
    tray: [null, null, null], hanks: [], aside: 0, moves: 0, deals: 0, done: false,
  };
  if (b.snarls.length) s.snarl = b.snarls.slice();
  if (b.felts.length) {
    s.felt = b.felts.slice();
    for (const i of s.felt) s.stacks[i] = genFelt(s, li);
  }
  if (L.preview) {
    s.tray = [genStack(s, li), genStack(s, li), genStack(s, li)];
    s.next = [genStack(s, li), genStack(s, li), genStack(s, li)];
    s.deals++;
  } else refill(s, li);
  return s;
}

export function goalOwed(s, li = s.level) {
  const colors = goalOf(li).colors;
  const owed = {};
  for (const c in colors) owed[c] = colors[c] - s.hanks.filter((h) => h === +c).length;
  return owed;
}
export function goalMet(s, li = s.level) {
  const g = goalOf(li);
  if (s.hanks.length < g.hanks) return false;
  if (g.untie && ((s.snarl && s.snarl.length) || (s.felt && s.felt.length))) return false;
  return Object.values(goalOwed(s, li)).every((n) => n <= 0);
}

/** Trays left in the level's basket (0 when it has no basket or it is used up). */
export function traysLeft(s, li = s.level) {
  const t = goalOf(li).trays;
  return t ? Math.max(0, t - s.deals) : 0;
}
/** Did she finish (or is she still) within the basket? (true for a level without one) */
export function withinBasket(s, li = s.level) {
  const t = goalOf(li).trays;
  return !t || s.deals <= t;
}

const snarled = (s, i) => !!(s.snarl && s.snarl.includes(i));
const felted = (s, i) => !!(s.felt && s.felt.includes(i));
export { snarled as isSnarled, felted as isFelted };

export const emptyPegs = (s) => s.stacks.reduce((a, st, i) => (st && !st.length && !snarled(s, i) ? a.concat(i) : a), []);

/**
 * place(state, trayIndex, cell) -> { ok, reason?, state, steps, hanks, refilled }
 */
export function place(state, t, cell) {
  if (state.done) return { ok: false, reason: 'done', state };
  if (!(t >= 0 && t < 3) || !state.tray[t]) return { ok: false, reason: 'tray', state };
  const st = state.stacks[cell];
  if (!st) return { ok: false, reason: 'peg', state };
  if (snarled(state, cell)) return { ok: false, reason: 'snarl', state };
  if (st.length) return { ok: false, reason: 'taken', state };
  const s = clone(state);
  s.stacks[cell] = s.tray[t];
  s.tray[t] = null;
  s.moves++;
  const r = resolve(s.stacks, board(s.level).nbr, [cell], optsOf(s));
  s.stacks = r.stacks;
  if (r.felt) s.felt = r.felt;
  if (r.snarl) s.snarl = r.snarl;
  s.hanks.push(...r.hanks);
  if (goalMet(s)) s.done = true;
  let refilled = false;
  if (!s.done && s.tray.every((x) => !x)) { refill(s, s.level); refilled = true; }
  return { ok: true, state: s, steps: r.steps, hanks: r.hanks, refilled };
}

/** Nudge: set the stack on a peg aside (it leaves the board, not a hank; a felted one too). */
export function clearPeg(state, cell) {
  const st = state.stacks[cell];
  if (state.done || !st || !st.length) return { ok: false, state };
  const s = clone(state);
  s.aside += st.length;
  s.stacks[cell] = [];
  if (s.felt) s.felt = s.felt.filter((i) => i !== cell);
  if (goalMet(s)) s.done = true;
  return { ok: true, state: s, removed: st.slice() };
}

/** Nudge: three fresh stacks in the tray (with a preview: the next tray moves up). */
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

// ---------- the bots ----------
/**
 * bestPlacement(state) -> { t, cell, gain } (t = -1 when no empty peg).
 * The prototype's greedy pick: the placement that moves the most tiles (a hank
 * counts 20 extra); if nothing merges, the first tray stack on the first empty peg.
 */
export function bestPlacement(state) {
  const empty = emptyPegs(state);
  let best = { t: -1, cell: -1, gain: 0 };
  if (!empty.length) return best;
  const nbr = board(state.level).nbr;
  const opts = optsOf(state);
  const awake = (j) => state.stacks[j] && state.stacks[j].length && !felted(state, j);
  for (let t = 0; t < 3; t++) {
    const tr = state.tray[t];
    if (!tr) continue;
    if (best.t < 0) best = { t, cell: empty[0], gain: 0 };
    for (const cell of empty) {
      // only a peg next to a matching top can merge
      if (!nbr[cell].some((j) => awake(j) && top(state.stacks[j]) === top(tr))) continue;
      const stacks = state.stacks.slice();
      stacks[cell] = tr;
      const r = resolve(stacks, nbr, [cell], opts);
      const gain = r.steps.reduce((a, x) => a + (x.type === 'move' ? x.n : x.type === 'bundle' ? 20 : 0), 0);
      if (gain > best.gain) best = { t, cell, gain };
    }
  }
  return best;
}

/** The greedy bot's nudge when the board is full: clear the tallest stack (ties: lowest peg). */
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

// The planning bot: looks ahead through every stack left in the tray (a beam
// over placements, scored by how the board reads once the tray is placed), so
// it keeps pegs open, buries fewer colors and aims for the goal. Used to verify
// every level offline (proto/skeins/survey.mjs) and as the hint for tests.

/** A light copy for the planner: only what the merge rule and the score read. */
function lite(s) {
  return { level: s.level, stacks: s.stacks, tray: s.tray, hanks: s.hanks, felt: s.felt, snarl: s.snarl };
}
function litePlace(x, t, cell, b) {
  const tr = x.tray[t];
  const stacks = x.stacks.slice();
  stacks[cell] = tr;
  const tray = x.tray.slice();
  tray[t] = null;
  const awake = (j) => stacks[j] && stacks[j].length && !(x.felt && x.felt.includes(j));
  const merges = b.nbr[cell].some((j) => j !== cell && awake(j) && top(stacks[j]) === top(tr));
  if (!merges) return { level: x.level, stacks, tray, hanks: x.hanks, felt: x.felt, snarl: x.snarl, gain: 0 };
  const opts = {};
  if (b.thr) { opts.thr = b.thr; opts.spin = b.spin; }
  if (x.felt) opts.felt = x.felt;
  if (x.snarl) opts.snarl = x.snarl;
  const r = resolve(stacks, b.nbr, [cell], opts);
  return {
    level: x.level, stacks: r.stacks, tray, hanks: r.hanks.length ? x.hanks.concat(r.hanks) : x.hanks,
    felt: r.felt || x.felt, snarl: r.snarl || x.snarl, gain: r.steps.length,
  };
}

/** How promising a board reads (higher is better). */
function scoreOf(x, b, g) {
  let v = x.hanks.length * 60;
  for (const c in g.colors) {
    let have = 0;
    for (const h of x.hanks) if (h === +c) have++;
    v += Math.min(have, g.colors[c]) * 140;
  }
  const locked = (x.snarl ? x.snarl.length : 0) + (x.felt ? x.felt.length : 0);
  v -= locked * (g.untie ? 110 : 18);
  let empty = 0;
  const S = x.stacks;
  for (let i = 0; i < S.length; i++) {
    const st = S[i];
    if (!st) continue;
    if (!st.length) { if (!(x.snarl && x.snarl.includes(i))) empty++; continue; }
    const isFelt = x.felt && x.felt.includes(i);
    // bands buried under the top
    let nb = 1;
    for (let k = 1; k < st.length; k++) if (st[k] !== st[k - 1]) nb++;
    v -= (nb - 1) * (isFelt ? 2 : 6) + st.length * 0.6;
    if (isFelt) continue;
    const run = topRun(st);
    const need = b.thr ? b.thr[i] : HANK;
    v += (run * run * 10) / (need * need) * 2.2;
    // the band under the top run matches a neighbor's top: a merge waiting
    const under = st.length > run ? st[st.length - run - 1] : -1;
    if (under >= 0) for (const j of b.nbr[i]) { const o = S[j]; if (o && o.length && o[o.length - 1] === under) v += 2.5; }
    // a goal color on top
    if (g.colors[top(st)] !== undefined) v += 1;
  }
  v += empty * 9;
  if (empty < 4) v -= (4 - empty) * (4 - empty) * 14;
  // a run growing beside a snarl or a felted stack: the hank there frees it
  if (locked) {
    const w = g.untie ? 70 : 12;
    for (const i of (x.snarl || []).concat(x.felt || [])) {
      let near = 0;
      for (const j of b.nbr[i]) {
        const o = S[j];
        if (!o || !o.length || (x.felt && x.felt.includes(j))) continue;
        const r = topRun(o) / (b.thr ? b.thr[j] : HANK);
        if (r > near) near = r;
      }
      v += near * near * w;
    }
  }
  return v;
}

function plan(x, b, g, depth, beam) {
  const empty = [];
  for (let i = 0; i < x.stacks.length; i++) {
    const st = x.stacks[i];
    if (st && !st.length && !(x.snarl && x.snarl.includes(i))) empty.push(i);
  }
  const seen = new Set();
  const cands = [];
  for (let t = 0; t < 3; t++) {
    const tr = x.tray[t];
    if (!tr) continue;
    const key = tr.join(',');
    if (seen.has(key)) continue; // the same stack twice: one is enough
    seen.add(key);
    for (const cell of empty) {
      const y = litePlace(x, t, cell, b);
      cands.push({ t, cell, y, v: scoreOf(y, b, g) });
    }
  }
  if (!cands.length) return { v: scoreOf(x, b, g), t: -1, cell: -1 };
  cands.sort((p, q) => q.v - p.v || p.t - q.t || p.cell - q.cell);
  if (depth <= 1 || !cands[0].y.tray.some(Boolean)) return cands[0];
  let best = null;
  for (const c of cands.slice(0, beam)) {
    const sub = c.y.tray.some(Boolean) ? plan(c.y, b, g, depth - 1, Math.max(2, beam >> 1)) : { v: c.v };
    // every tray stack gets placed before the next deal: judge the board after all of them
    const v = sub.v + c.v * 0.001;
    if (!best || v > best.v) best = { t: c.t, cell: c.cell, v };
  }
  return best;
}

/**
 * botMove(state, {beam}) -> {t, cell} | {clear: cell} | null (done).
 * The planning bot's next step: a placement looking ahead through the whole
 * tray, or, when no peg is free, the clear that leaves the best board.
 */
export function botMove(state, { beam = 6 } = {}) {
  if (state.done) return null;
  const b = board(state.level);
  const g = goalOf(state.level);
  const x = lite(state);
  if (!emptyPegs(state).length) {
    let best = -1, bv = -Infinity;
    state.stacks.forEach((st, i) => {
      if (!st || !st.length) return;
      const stacks = state.stacks.slice();
      stacks[i] = [];
      const v = scoreOf({ ...x, stacks, felt: x.felt && x.felt.filter((k) => k !== i) }, b, g) - st.length * 0.5;
      if (v > bv) { bv = v; best = i; }
    });
    return { clear: best };
  }
  const p = plan(x, b, g, 3, beam);
  return { t: p.t, cell: p.cell };
}

/**
 * botSolve(li, seed, {maxMoves, beam}) -> { done, moves, nudges, hanks, deals, aside, tight, state }
 * Plays a level with the planning bot; nudges are the pegs it had to clear,
 * tight the share of its placements made with 3 or fewer free pegs.
 */
export function botSolve(li, seed, { maxMoves = 600, beam = 6 } = {}) {
  let s = newLevel(li, seed), nudges = 0, tight = 0;
  while (!s.done && s.moves < maxMoves) {
    const m = botMove(s, { beam });
    if (m.clear !== undefined) { s = clearPeg(s, m.clear).state; nudges++; continue; }
    if (emptyPegs(s).length <= 3) tight++;
    s = place(s, m.t, m.cell).state;
  }
  return { done: s.done, moves: s.moves, nudges, hanks: s.hanks.length, deals: s.deals, aside: s.aside, tight: tight / Math.max(1, s.moves), state: s };
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

// ---------- game additions: names in her colors, save validation ----------

/** levelTitle(li, nameOf) -> the level's name, {k} filled with nameOf(k) (her name for color k); the prototype's name without nameOf. */
export function levelTitle(li, nameOf) {
  const L = LEVELS[li];
  if (!L) return '';
  if (!L.title || typeof nameOf !== 'function') return L.name;
  return L.title.replace(/\{(\d)\}/g, (_, k) => String(nameOf(+k)));
}

const isInt = (x) => Number.isInteger(x);
const subsetOf = (x, all) => Array.isArray(x) && x.every((i) => isInt(i) && all.includes(i)) && new Set(x).size === x.length;
/**
 * isValidLevel(s) -> boolean: a saved level state that still fits its board
 * (same pegs and knots, colors in range, a tray of 3, counters finite, the
 * level's snarls, felted stacks and next tray where it has them). A level that
 * fails is dropped by the sim instead of locking the room.
 */
export function isValidLevel(s) {
  if (!s || typeof s !== 'object' || s.v !== VERSION) return false;
  if (!isInt(s.level) || s.level < 0 || s.level >= LEVELS.length) return false;
  const b = board(s.level);
  const L = LEVELS[s.level];
  const K = L.colors;
  const okStack = (st) => Array.isArray(st) && st.every((c) => isInt(c) && c >= 0 && c < K);
  const okTray = (tr) => Array.isArray(tr) && tr.length === 3 && tr.every((t) => t === null || (okStack(t) && t.length > 0));
  if (!Array.isArray(s.stacks) || s.stacks.length !== b.cells.length) return false;
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i].knot ? s.stacks[i] !== null : !okStack(s.stacks[i])) return false;
  }
  if (!okTray(s.tray)) return false;
  if (!Array.isArray(s.hanks) || !s.hanks.every((c) => isInt(c) && c >= 0 && c < K)) return false;
  for (const k of ['rs', 'seed', 'aside', 'moves', 'deals']) if (!Number.isFinite(s[k])) return false;
  if (b.snarls.length ? !(subsetOf(s.snarl, b.snarls) && s.snarl.every((i) => !s.stacks[i].length)) : s.snarl !== undefined) return false;
  if (b.felts.length ? !(subsetOf(s.felt, b.felts) && s.felt.every((i) => s.stacks[i].length > 0)) : s.felt !== undefined) return false;
  if (L.preview ? !(okTray(s.next) && s.next.every(Boolean)) : s.next !== undefined) return false;
  return typeof s.done === 'boolean';
}

/** isValidSession(sess, li?) -> boolean: {state, past, stats} with a valid state (on level li when given). */
export function isValidSession(sess, li) {
  if (!sess || typeof sess !== 'object' || !isValidLevel(sess.state)) return false;
  if (li !== undefined && sess.state.level !== li) return false;
  return Array.isArray(sess.past) && !!sess.stats && typeof sess.stats === 'object';
}
