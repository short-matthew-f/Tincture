// The Winding Room (Skein Stacks): the rules (ported from proto/test/skeins.test.js,
// against src/puzzles/skeins.js), the 112 levels in chapters and the newer
// mechanics (snarls, felted stacks, spindles, the next-tray peek, orders, the
// basket, untangle goals), the planning bot on a sample of levels (the full
// check is proto/skeins/survey.mjs), the sim (unlock, yarns, levels, coins,
// hooks, undo never paying twice, chapters, Continue, intro cards), the save
// round trip mid-level, old saves, Renovate, and the balance check against
// hand orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LEVELS, COLORS, HANK, SPINDLE_HANK, SHAPES, CHAPTERS, MECHANICS, geometry, board, resolve, topRun, newLevel, place, clearPeg, swapTray,
  situation, emptyPegs, goalMet, botPlay, botSolve, botMove, newSession, sessionPlace, sessionUndo, sessionClear, sessionSwap,
  genStack, hankName, levelTitle, isValidLevel, bestPlacement, botClearChoice, goalOf, levelMechanics, introducedAt,
  chapterOf, chapterStart, traysLeft, withinBasket, hankAt,
} from '../src/puzzles/skeins.js';
import * as K from '../src/sim/skeins.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { colorFamily } from '../src/sim/economy.js';
import { orderBasePay } from '../src/sim/orders.js';

const NOW = Date.UTC(2026, 9, 23, 9);
const li = (id) => LEVELS.findIndex((L) => L.id === id);
const firstWith = (m) => LEVELS.findIndex((_, i) => levelMechanics(i).includes(m));

// --- rules (ported from the prototype's tests) ----------------------------------

// A straight row of 5 pegs: 0-1-2-3-4. Two rows: 0..3 on top, 4..7 below (odd row shifted right).
const ROW = geometry(['.....']);
const TWO = geometry(['....', '....']);

test('rules: odd-r neighbors and knots; every board 19-41 pegs, connected, symmetric neighbors, marks on real pegs', () => {
  assert.deepEqual(ROW.nbr[2], [1, 3]);
  assert.deepEqual(TWO.nbr[1], [0, 2, 4, 5]);
  assert.deepEqual(TWO.nbr[4], [0, 1, 5]);
  const k = geometry(['...'], [[1, 0]]);
  assert.equal(k.cells[1].knot, true);
  assert.deepEqual(k.nbr[0], []);
  for (let i = 0; i < LEVELS.length; i++) {
    const L = LEVELS[i];
    const b = board(i);
    const pegs = b.cells.map((c, j) => j).filter((j) => !b.cells[j].knot);
    assert.ok(pegs.length >= 19 && pegs.length <= 41, `${L.id} has ${pegs.length} pegs`);
    b.nbr.forEach((ns, a) => ns.forEach((j) => assert.ok(b.nbr[j].includes(a))));
    const seen = new Set([pegs[0]]);
    const q = [pegs[0]];
    while (q.length) for (const j of b.nbr[q.pop()]) if (!seen.has(j)) { seen.add(j); q.push(j); }
    assert.equal(seen.size, pegs.length, `${L.id}: every peg is reachable`);
    for (const key of ['knots', 'snarls', 'felt', 'spindles']) {
      for (const [c, r] of L[key] || []) assert.ok(b.at.has(`${c},${r}`), `${L.id}: ${key} [${c},${r}] is on the board`);
    }
    assert.equal(b.snarls.length, (L.snarls || []).length);
    assert.equal(b.felts.length, (L.felt || []).length);
    assert.equal(b.spindles.length, (L.spindles || []).length);
    // a snarl or a felted stack always has a plain peg beside it, so a hank can be tied there
    for (const j of b.snarls.concat(b.felts)) {
      assert.ok(b.nbr[j].some((n) => !b.snarls.includes(n) && !b.felts.includes(n)), `${L.id}: peg ${j} can be freed`);
    }
  }
});

// The prototype's 12 levels, verbatim: her progress and a saved level depend on them.
const ORIGINAL_12 = [
  { id: 'l1', name: 'First skeins', shape: 'hex19', colors: 3, goal: { hanks: 6 }, maxH: 4, mono: 0.55, tri: 0 },
  { id: 'l2', name: 'A basket of three', shape: 'hex19', colors: 3, goal: { hanks: 10 }, maxH: 5, mono: 0.45, tri: 0.05 },
  { id: 'l3', name: 'Walnut joins', title: '{3} joins', shape: 'wide24', colors: 4, goal: { hanks: 10 }, maxH: 5, mono: 0.4, tri: 0.1 },
  { id: 'l4', name: 'Square shelf', shape: 'rect25', colors: 4, goal: { hanks: 12 }, maxH: 5, mono: 0.3, tri: 0.15 },
  { id: 'l5', name: 'Knots in the wood', shape: 'wide24', knots: [[2, 2], [3, 2]], colors: 4, goal: { hanks: 12, colors: { 2: 3 } }, maxH: 5, mono: 0.3, tri: 0.2, pull: 1 },
  { id: 'l6', name: 'Cochineal arrives', title: '{4} arrives', shape: 'rect30', colors: 5, goal: { hanks: 15 }, maxH: 5, mono: 0.25, tri: 0.25, pull: 1 },
  { id: 'l7', name: 'Pink for a shawl', title: '{4} for a shawl', shape: 'big29', knots: [[3, 0], [0, 2], [6, 2]], colors: 5, goal: { hanks: 15, colors: { 4: 4 } }, maxH: 6, mono: 0.2, tri: 0.3, pull: 1 },
  { id: 'l8', name: 'Long table', shape: 'rect30', knots: [[1, 2], [3, 3]], colors: 5, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 1 },
  { id: 'l9', name: 'Nettle green', title: '{5}', shape: 'big29', colors: 6, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 0.5 },
  { id: 'l10', name: 'A sweater\'s worth', shape: 'rect30', knots: [[2, 1], [2, 4]], colors: 6, goal: { hanks: 20, colors: { 5: 3, 3: 3 } }, maxH: 6, mono: 0.2, tri: 0.35, pull: 1 },
  { id: 'l11', name: 'Market day', shape: 'big29', knots: [[1, 1], [5, 3]], colors: 6, goal: { hanks: 22 }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
  { id: 'l12', name: 'The whole dye shed', shape: 'big29', colors: 6, goal: { hanks: 25, colors: { 0: 5, 2: 5 } }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
];

test('levels: the first 12 are the prototype\'s, verbatim, and deal exactly as before', () => {
  assert.deepEqual(LEVELS.slice(0, 12).map((L) => ({ ...L })), ORIGINAL_12);
  assert.deepEqual(SHAPES.hex19, [' ...', '....', '.....', '....', ' ...']);
  assert.deepEqual(SHAPES.big29, [' .....', '......', '.......', '......', ' .....']);
  // fingerprints taken from the 0.4.0 rules: the same seed deals the same trays and plays the same game
  assert.deepEqual(newLevel(0, 42).tray, [[2, 2, 2], [1, 1, 1], [0, 2]]);
  assert.deepEqual(newLevel(11, 7).tray, [[5, 5], [4, 4, 2, 2], [0, 0, 3]]);
  const g = botPlay(9, 1234);
  assert.deepEqual([g.moves, g.hanks, g.nudges], [104, 20, 14]);
  assert.deepEqual(g.state.hanks, [5, 2, 5, 4, 3, 0, 4, 2, 1, 3, 5, 0, 4, 5, 3, 5, 1, 0, 2, 3]);
  let s = newLevel(6, 99);
  for (let i = 0; i < 10; i++) { const m = bestPlacement(s); s = place(s, m.t, m.cell).state; }
  assert.equal(s.rs, 1128212745);
  assert.deepEqual(s.tray, [null, [0, 0, 0, 1, 1], [3, 3, 4, 4]]);
  for (let i = 0; i < 12; i++) {
    const n = newLevel(i, 5);
    assert.ok(!('snarl' in n) && !('felt' in n) && !('next' in n), `${LEVELS[i].id} carries no new fields`);
    assert.deepEqual(levelMechanics(i), []);
  }
});

test('levels: 112 in 11 chapters of about ten, unique ids, names in her colors, goals in range', () => {
  assert.equal(LEVELS.length, 112);
  assert.ok(LEVELS.length >= 100 && LEVELS.length <= 120);
  assert.equal(CHAPTERS.reduce((a, c) => a + c.levels, 0), LEVELS.length);
  assert.ok(CHAPTERS.every((c) => c.levels >= 9 && c.levels <= 12 && c.name && c.blurb && c.id));
  assert.equal(new Set(CHAPTERS.map((c) => c.id)).size, CHAPTERS.length);
  assert.deepEqual(LEVELS.map((L) => L.id), LEVELS.map((_, i) => `l${i + 1}`));
  assert.equal(new Set(LEVELS.map((L) => L.name)).size, LEVELS.length, 'every level has its own name');
  assert.equal(chapterOf(0), 0);
  assert.equal(chapterOf(11), 0);
  assert.equal(chapterOf(12), 1);
  assert.equal(chapterOf(111), CHAPTERS.length - 1);
  assert.equal(chapterStart(1), 12);
  for (let i = 0; i < LEVELS.length; i++) {
    const L = LEVELS[i];
    const g = goalOf(i);
    assert.ok(SHAPES[L.shape], `${L.id}: shape ${L.shape}`);
    assert.ok(L.colors >= 3 && L.colors <= 6 && L.maxH >= 4 && L.maxH <= 6, L.id);
    assert.ok(g.hanks >= (g.order ? 5 : 6) && g.hanks <= 30, `${L.id}: ${g.hanks} hanks`);
    for (const c of Object.keys(g.colors)) assert.ok(+c >= 0 && +c < L.colors, `${L.id}: color ${c} is in play`);
    if (L.title) assert.match(levelTitle(i, (c) => `C${c}`), /C\d/);
  }
  assert.equal(hankName(0), 'Madder red hank');
  assert.ok(COLORS.length >= 6);
  assert.equal(levelTitle(2), 'Walnut joins', 'the prototype name without her names');
  assert.equal(levelTitle(2, (c) => `C${c}`), 'C3 joins');
  assert.equal(levelTitle(6, (c) => `C${c}`), 'C4 for a shawl');
  assert.equal(levelTitle(0, (c) => `C${c}`), 'First skeins');
  // the silhouettes asked for
  for (const s of ['heart35', 'heart23', 'heart37', 'star37', 'star20', 'flower25', 'sheep', 'mitten', 'teapot']) {
    assert.ok(LEVELS.some((L) => L.shape === s), `a level on the ${s} board`);
  }
  assert.ok(new Set(LEVELS.map((L) => L.shape)).size >= 25, 'plenty of boards');
});

test('levels: the newer mechanics arrive one at a time, each with an intro card, and keep coming back', () => {
  const order = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const fresh = introducedAt(i);
    assert.ok(fresh.length <= 1, `${LEVELS[i].id} introduces ${fresh.join(' and ')}`);
    order.push(...fresh);
    for (const m of levelMechanics(i)) assert.ok(MECHANICS[m] && MECHANICS[m].name && MECHANICS[m].line, `${m} has a card`);
  }
  assert.deepEqual(order, ['snarl', 'order', 'basket', 'felt', 'spindle', 'preview', 'untie']);
  assert.deepEqual(Object.keys(MECHANICS).sort(), order.slice().sort());
  // each is introduced in its own chapter (the second level of it, after a warm-up), and used again later
  for (const m of order) {
    const at = firstWith(m);
    assert.equal(at - chapterStart(chapterOf(at)), 1, `${m} arrives on the second level of its chapter`);
    assert.ok(LEVELS.filter((_, i) => levelMechanics(i).includes(m)).length >= 4, `${m} comes back`);
  }
});

test('rules: the merge rule (pulls onto the longer run, ties, paths farthest first, cascades)', () => {
  let r = resolve([[], [1, 0, 0, 0], [0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r.stacks, [[], [1, 0, 0, 0, 0], [], [], []]);
  assert.deepEqual(r.steps, [{ type: 'move', from: 2, to: 1, color: 0, n: 1 }]);
  r = resolve([[0, 0], [1, 0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[0], [0, 0, 0, 0]);
  r = resolve([[0, 0], [0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[1], [0, 0, 0, 0]);
  r = resolve([[0], [2, 0], [0, 0, 0], [], []], ROW.nbr, [0]);
  assert.deepEqual(r.steps.slice(0, 2), [{ type: 'move', from: 0, to: 1, color: 0, n: 1 }, { type: 'move', from: 1, to: 2, color: 0, n: 2 }]);
  r = resolve([[], [0, 0, 0], [2, 0], [2, 2], []], ROW.nbr, [2]);
  assert.deepEqual(r.stacks, [[], [0, 0, 0, 0], [], [2, 2, 2], []]);
});

test('rules: a top run of 10 lifts off as a hank and the color under it cascades', () => {
  const r = resolve([[2, 2], [2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r.hanks, [0]);
  assert.deepEqual(r.steps, [
    { type: 'move', from: 2, to: 1, color: 0, n: 3 },
    { type: 'bundle', cell: 1, color: 0, n: 10 },
    { type: 'move', from: 1, to: 0, color: 2, n: 1 },
  ]);
  const r9 = resolve([[], [0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.equal(r9.hanks.length, 0);
  assert.equal(topRun(r9.stacks[1]), 9);
  assert.equal(HANK, 10);
});

test('mechanics in the merge rule: snarls loosen and felted stacks wake beside a hank; spindles twist 8', () => {
  // row 0-1-2-3-4: a hank tied on 1 loosens the snarl on 0 and wakes the felted stack on 2
  let r = resolve([[], [3, 0, 0, 0, 0, 0, 0, 0], [1, 1, 0], [0, 0], []], ROW.nbr, [3], { snarl: [0], felt: [2] });
  // the felted [1,1,0] on 2 sits between 1 and 3: it neither gives nor takes, so 3's 0s cannot reach 1
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.felt, [2]);
  r = resolve([[], [3, 0, 0, 0, 0, 0, 0, 0], [1, 1, 0], [0, 0], [0, 0]], ROW.nbr, [4], { snarl: [0], felt: [2] });
  assert.deepEqual(r.steps, [{ type: 'move', from: 3, to: 4, color: 0, n: 2 }], 'a tie goes to the placed peg; the felted stack stays out of it');
  r = resolve([[], [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 0], [], []], ROW.nbr, [1], { snarl: [0], felt: [2] });
  assert.deepEqual(r.steps.slice(0, 3), [{ type: 'bundle', cell: 1, color: 0, n: 11 }, { type: 'loosen', cell: 0 }, { type: 'wake', cell: 2 }]);
  assert.deepEqual(r.snarl, []);
  assert.deepEqual(r.felt, []);
  // the woken stack joins in: its 0 on top has no 0 beside it now, nothing more moves
  assert.deepEqual(r.stacks, [[], [3], [1, 1, 0], [], []]);
  // spindle on peg 2: 8 bundles there, and on a tie of runs the spindle receives
  const thr = [10, 10, 8, 10, 10];
  r = resolve([[], [0, 0, 0, 0], [0, 0, 0, 0], [], []], ROW.nbr, [1], { thr, spin: new Set([2]) });
  assert.deepEqual(r.steps, [{ type: 'move', from: 1, to: 2, color: 0, n: 4 }, { type: 'bundle', cell: 2, color: 0, n: 8 }]);
  assert.equal(SPINDLE_HANK, 8);
  const sp = firstWith('spindle');
  assert.equal(hankAt(sp, board(sp).spindles[0]), 8);
  assert.equal(hankAt(0, 3), 10);
});

test('mechanics through place(): no placing on a snarl; untie, order and basket goals; the next tray moves up', () => {
  // snarls
  const sn = firstWith('snarl');
  let s = newLevel(sn, 3);
  const knot = s.snarl[0];
  assert.equal(place(s, 0, knot).reason, 'snarl');
  assert.ok(!emptyPegs(s).includes(knot));
  assert.equal(isValidLevel(s), true);
  assert.equal(isValidLevel({ ...s, snarl: undefined }), false, 'a snarl level carries its snarls');
  assert.equal(isValidLevel({ ...newLevel(0, 3), snarl: [] }), false, 'an older level carries none');
  // felted stacks: dealt at the start (seeded), resting, and a nudge can set one aside
  const fe = firstWith('felt');
  s = newLevel(fe, 9);
  assert.deepEqual(newLevel(fe, 9), s, 'deterministic');
  assert.ok(s.felt.length && s.felt.every((i) => s.stacks[i].length >= 3 && s.stacks[i].length <= 5));
  const c = clearPeg(s, s.felt[0]);
  assert.ok(c.ok && !c.state.felt.includes(s.felt[0]));
  // untangle: hanks alone are not enough
  const un = firstWith('untie');
  s = newLevel(un, 4);
  s.hanks = new Array(goalOf(un).hanks).fill(0);
  assert.equal(goalMet(s), false);
  assert.equal(goalMet({ ...s, snarl: [], felt: s.felt ? [] : undefined }), true);
  // an order: only its colors count
  const or = firstWith('order');
  const g = goalOf(or);
  assert.ok(g.order && g.who && g.hanks === Object.values(g.colors).reduce((a, n) => a + n, 0));
  s = newLevel(or, 4);
  s.hanks = new Array(30).fill(1);
  assert.equal(goalMet(s), false, 'thirty weld hanks do not fill an order for madder and woad');
  s.hanks = Object.entries(g.colors).flatMap(([col, n]) => new Array(n).fill(+col));
  assert.equal(goalMet(s), true);
  // the basket: counts down, then spare trays keep coming (never a fail)
  const ba = firstWith('basket');
  s = newLevel(ba, 4);
  const trays = goalOf(ba).trays;
  assert.ok(trays > 5);
  assert.equal(traysLeft(s), trays - 1);
  for (let k = 0; k < trays + 3; k++) s = swapTray(s).state;
  assert.equal(traysLeft(s), 0);
  assert.equal(withinBasket(s), false);
  assert.ok(s.tray.every(Boolean), 'the tray still refills');
  assert.equal(situation(s), 'ok');
  // the peek: the next tray is the one dealt next
  const pv = firstWith('preview');
  s = newLevel(pv, 8);
  assert.ok(s.next && s.next.length === 3 && s.next.every(Boolean));
  const peek = s.next;
  for (let t = 0; t < 3; t++) s = place(s, t, emptyPegs(s)[t * 5]).state;
  assert.deepEqual(s.tray, peek, 'the peeked tray is the tray she gets');
  assert.ok(s.next.every(Boolean));
  assert.deepEqual(swapTray(s).state.tray, s.next, 'a swap brings the peeked tray up too');
  assert.equal(isValidLevel({ ...s, next: null }), false);
});

test('rules: place validation, refill after 3, goal, determinism, undo round trip, nudges', () => {
  let s = newLevel(0, 42);
  assert.equal(place(s, 0, 999).ok, false);
  const e = emptyPegs(s);
  let r = place(s, 0, e[0]);
  assert.ok(r.ok);
  assert.equal(place(r.state, 0, e[1]).ok, false, 'tray slot 0 is used');
  s = place(r.state, 1, emptyPegs(r.state)[5]).state;
  r = place(s, 2, emptyPegs(s)[9]);
  assert.ok(r.refilled);
  const g = newLevel(0, 1);
  g.hanks = [0, 1, 2, 0, 1];
  const a = emptyPegs(g)[0];
  g.stacks[board(0).nbr[a][0]] = [0, 0, 0, 0, 0, 0, 0, 0];
  g.tray[0] = [0, 0];
  const done = place(g, 0, a);
  assert.ok(goalMet(done.state) && done.state.done);
  assert.deepEqual(newLevel(3, 99), newLevel(3, 99));
  assert.deepEqual(botPlay(5, 1234).state, botPlay(5, 1234).state);
  const t = newLevel(11, 5);
  for (let i = 0; i < 100; i++) { const x = genStack(t, 11); assert.ok(x.length >= 2 && x.length <= 6 && x.every((c) => c >= 0 && c < 6)); }
  let sess = newSession(1, 7);
  const snaps = [sess.state];
  for (let i = 0; i < 4; i++) { sess = sessionPlace(sess, sess.state.tray.findIndex(Boolean), emptyPegs(sess.state)[i % 3]).session; snaps.push(sess.state); }
  sess = sessionSwap(sess).session;
  for (let i = snaps.length - 1; i >= 0; i--) { sess = sessionUndo(sess).session; assert.deepEqual(sess.state, snaps[i]); }
  assert.deepEqual(sess.stats, { moves: 4, undos: 5, clears: 0, swaps: 1 });
  const full = newLevel(0, 3);
  board(0).cells.forEach((c, i) => { full.stacks[i] = [0, 10 + i]; });
  assert.equal(situation(full), 'stuck');
  const c = clearPeg(full, 4);
  assert.ok(c.ok && c.state.aside === 2);
  assert.ok(swapTray(full).ok);
  assert.equal(sessionClear({ ...newSession(0, 3), state: full }, 4).session.stats.clears, 1);
  assert.deepEqual(botMove(full), { clear: botMove(full).clear });
  assert.ok(botMove(full).clear >= 0);
});

test('bots: the greedy bot still finishes the first 12; the planner finishes a sample of every chapter and mechanic with few nudges', () => {
  for (let i = 0; i < 12; i++) {
    for (const seed of [11, 3333]) {
      const r = botPlay(i, seed);
      assert.ok(r.done, `${LEVELS[i].id} finishes`);
      assert.ok(r.nudges <= (i < 4 ? 0 : i < 8 ? 2 : 10), `${LEVELS[i].id}: ${r.nudges} nudges`);
    }
  }
  // one level a chapter (rotating through each chapter) and the first of each mechanic; all 112 x 10 seeds: proto/skeins/survey.mjs
  const sample = new Set(CHAPTERS.map((ch, c) => chapterStart(c) + ((c * 3 + 2) % ch.levels)));
  for (const m of Object.keys(MECHANICS)) sample.add(firstWith(m));
  sample.add(LEVELS.length - 1);
  for (const i of sample) {
    for (const seed of [5, 2024]) {
      const r = botSolve(i, seed);
      assert.ok(r.done, `${LEVELS[i].id} finishes (seed ${seed})`);
      assert.ok(r.nudges <= 3, `${LEVELS[i].id}: ${r.nudges} nudges (seed ${seed})`);
      if (goalOf(i).trays) assert.ok(r.deals <= goalOf(i).trays, `${LEVELS[i].id}: within its basket`);
    }
  }
});

test('the levels and rules are mirrored in the prototype', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(read('../proto/skeins/levels.js'), read('../src/puzzles/skeins-levels.js'));
  assert.equal(read('../proto/skeins/rules.js'), read('../src/puzzles/skeins.js').replace("from './skeins-levels.js'", "from './levels.js'"));
});

test('isValidLevel: a level that no longer fits its board is refused', () => {
  const s = newLevel(4, 9);
  assert.equal(isValidLevel(s), true);
  assert.equal(isValidLevel({ ...s, stacks: s.stacks.slice(1) }), false);
  const knot = board(4).cells.findIndex((c) => c.knot);
  assert.equal(isValidLevel({ ...s, stacks: s.stacks.map((x, i) => (i === knot ? [] : x)) }), false);
  assert.equal(isValidLevel({ ...s, tray: [[9, 9], null, null] }), false, 'a color out of range');
  assert.equal(isValidLevel({ ...s, v: 2 }), false);
  assert.equal(isValidLevel(null), false);
  assert.equal(isValidLevel({ ...s, level: LEVELS.length }), false);
  for (let i = 12; i < LEVELS.length; i += 7) assert.equal(isValidLevel(newLevel(i, i)), true, LEVELS[i].id);
});

// --- the sim ---------------------------------------------------------------------

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}
function opened(n = 12, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 2000;
  assert.equal(sim.unlocks.buy(s, { id: 'skeins' }, NOW).ok, true);
  s._events = [];
  return s;
}
/** The planning bot, through the sim (a nudge when the board is full). */
function botStep(s) {
  const lv = s.skeins.sess.state;
  const m = botMove(lv);
  if (m.clear !== undefined) return K.clearPeg(s, { cell: m.clear }, NOW);
  return K.place(s, { t: m.t, cell: m.cell }, NOW);
}
/** The prototype's greedy bot, through the sim (kept for the first levels' checks). */
function greedyStep(s) {
  const lv = s.skeins.sess.state;
  const m = bestPlacement(lv);
  if (m.t < 0) return K.clearPeg(s, { cell: botClearChoice(lv) }, NOW);
  return K.place(s, { t: m.t, cell: m.cell }, NOW);
}
function playLevel(s, max = 600, step = botStep) {
  for (let i = 0; i < max && !s.skeins.sess.state.done; i++) assert.ok(step(s).ok);
  assert.ok(s.skeins.sess.state.done, 'the level finishes');
}
const finishUpTo = (s, n) => { for (let i = 0; i < n; i++) s.skeins.finished[i] = true; };

test('unlock: 12 colors, 1,500 coins; play needs it; Next names it', () => {
  const s = withColors(11);
  s.coins = 2000;
  const st = sim.unlocks.status(s, 'skeins');
  assert.deepEqual([st.cost, st.revealColors, st.revealed, st.name], [1500, 12, false, 'Winding Room']);
  assert.equal(K.startLevel(s, {}, NOW).reason, 'locked');
  const t = withColors(12);
  t.coins = 1500;
  t.unlocks.shelf = true;
  t.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'ochre'][i % 2]; });
  assert.match(sim.next(t, NOW).label, /^Open the Winding Room for 1(,500|\.5K)$/);
  assert.equal(sim.unlocks.buy(t, { id: 'skeins' }, NOW).ok, true);
  assert.equal(t.coins, 0);
  assert.equal(K.unlocked(t), true);
  assert.ok(K.ensureLevel(t, {}, NOW).ok);
  assert.equal(t.skeins.sess.state.level, 0);
});

test('yarns: six distinct discovered colors, one per hue family while she has them; slot 0 is her red', () => {
  const s = opened(12);
  const y = K.defaultYarns(s);
  assert.equal(y.length, 6);
  assert.equal(new Set(y).size, 6);
  assert.ok(y.every((id) => s.catalog.discovered[id]));
  const fams = new Set(Object.keys(s.catalog.discovered).map(colorFamily));
  assert.equal(new Set(y.map(colorFamily)).size, Math.min(6, fams.size));
  assert.equal(colorFamily(y[0]), 'red');
  K.ensureLevel(s, {}, NOW);
  assert.deepEqual(s.skeins.sess.state.colors, y);
  // Three colors only: the default never breaks (catalog colors fill in).
  assert.equal(new Set(K.defaultYarns(createInitialState(NOW, 1))).size, 6);
});

test('a whole level through the sim: hanks pay coins, hooks fire, the bonus once, the next level opens', () => {
  for (const seed of [1, 2]) {
    const s = opened(14, seed);
    s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
    s.quests.daily = [{ id: 'q-hank', type: 'test', event: 'hankTied', target: 4, progress: 0, done: false, claimed: false, reward: { seals: 1 } }];
    s.coins = 0;
    K.ensureLevel(s, {}, NOW);
    playLevel(s, 600, greedyStep);
    const k = s.skeins;
    const hanks = k.sess.state.hanks.length;
    assert.ok(hanks >= LEVELS[0].goal.hanks);
    assert.ok(Math.abs(s.coins - k.sess.paid) < 1e-6, 'every coin went through pay()');
    const per = K.coinsPerHank(s, NOW);
    assert.ok(Math.abs(s.coins - (hanks * per + K.levelBonusCoins(s, NOW))) < 1e-6);
    const ev = s._events.map((e) => e.type);
    assert.equal(ev.filter((x) => x === 'hankTied').length, hanks);
    assert.equal(ev.filter((x) => x === 'skeinLevelDone').length, 1);
    const tied = s._events.filter((e) => e.type === 'hankTied').map((e) => e.payload && e.payload.colorId || e.colorId);
    assert.ok(tied.every((id) => k.sess.state.colors.includes(id)), 'hooks carry her color ids');
    assert.equal(s.quests.daily[0].progress, 4, "questEvent(state, 'hankTied') counts each hank");
    assert.equal(k.finished[0], true);
    assert.equal(k.levels, 1);
    assert.equal(k.hanks, hanks);
    assert.equal(s.lifetime.puzzles, 1);
    assert.equal(k.notes[0].finishes, 1);
    assert.ok(K.isOpen(s, 1) && !K.isOpen(s, 2));
    assert.equal(K.undo(s).ok, false, 'a finished level stays finished');
    assert.equal(K.place(s, { t: 0, cell: 0 }, NOW).ok, false);
    assert.equal(K.startLevel(s, { level: 2 }, NOW).reason, 'closed');
    assert.ok(K.startLevel(s, { level: 1, fresh: true }, NOW).ok);
    assert.equal(s.skeins.sess.state.level, 1);
    assert.equal(K.summary(s).playing, true);
  }
});

test('undo never pays a hank twice', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  let guard = 0;
  while (s.skeins.sess.state.hanks.length === 0 && guard++ < 300) greedyStep(s);
  const coins = s.coins;
  const hanks = s.skeins.sess.state.hanks.length;
  assert.ok(hanks > 0 && coins > 0);
  const lastMove = s.skeins.sess.past.at(-1);
  assert.ok(K.undo(s).ok);
  assert.deepEqual(s.skeins.sess.state, lastMove);
  // The same placement again ties the same hank: no coins, no event.
  s._events = [];
  for (let i = 0; i < 3 && s.skeins.sess.state.hanks.length < hanks; i++) greedyStep(s);
  assert.equal(s.skeins.sess.state.hanks.length >= hanks, true);
  assert.equal(s.coins, coins + (s.skeins.sess.state.hanks.length - hanks) * K.coinsPerHank(s, NOW));
  assert.ok(s._events.filter((e) => e.type === 'hankTied').length <= s.skeins.sess.state.hanks.length - hanks);
  assert.equal(s.skeins.sess.stats.undos, 1);
});

test('levels: stepping away parks a level, coming back resumes it exactly; fresh deals anew', () => {
  const s = opened(12);
  s.skeins.finished = { 0: true, 1: true };
  K.startLevel(s, { level: 1 }, NOW);
  botStep(s); botStep(s);
  const mid = JSON.stringify(s.skeins.sess.state);
  assert.ok(K.startLevel(s, { level: 0, fresh: true }, NOW).ok);
  assert.ok(s.skeins.other[1]);
  const back = K.startLevel(s, { level: 1 }, NOW);
  assert.ok(back.ok && back.resumed);
  assert.equal(JSON.stringify(s.skeins.sess.state), mid);
  assert.ok(!s.skeins.other[1]);
  assert.ok(K.startLevel(s, { level: 1, fresh: true }, NOW).ok);
  assert.equal(s.skeins.sess.state.moves, 0);
  assert.equal(K.maxOpen(s), 2);
});

test('chapters, Continue and the intro cards through the sim', () => {
  const s = opened(12);
  assert.equal(K.nextLevel(s), 0);
  let ch = K.chapters(s);
  assert.equal(ch.length, CHAPTERS.length);
  assert.deepEqual([ch[0].first, ch[0].count, ch[0].finished, ch[0].open, ch[1].open], [0, 12, 0, true, false]);
  // her 12 finished levels open chapter 2; Continue points at level 13
  finishUpTo(s, 12);
  ch = K.chapters(s);
  assert.deepEqual([ch[0].finished, ch[1].open, ch[1].first, ch[2].open], [12, true, 12, false]);
  assert.equal(K.nextLevel(s), 12);
  assert.equal(K.maxOpen(s), 12);
  // a level on the table, unfinished, is what Continue resumes
  K.startLevel(s, { level: 3, fresh: true }, NOW);
  botStep(s);
  assert.equal(K.nextLevel(s), 3);
  // the snarl level's card, then never again
  const sn = firstWith('snarl');
  finishUpTo(s, sn);
  assert.ok(K.startLevel(s, { level: sn }, NOW).ok);
  assert.deepEqual(K.introsFor(s, sn), ['snarl']);
  assert.deepEqual(K.introsFor(s, 0), []);
  K.seeIntro(s, { mechanics: ['snarl', 'nonsense'] });
  assert.deepEqual(s.skeins.seen, { snarl: true });
  assert.deepEqual(K.introsFor(s, sn), []);
  const sum = K.summary(s);
  assert.deepEqual([sum.level, sum.chapter, sum.chapterName, sum.levels, sum.next], [sn, chapterOf(sn), CHAPTERS[chapterOf(sn)].name, LEVELS.length, sn]);
  // every level finished: Continue rests
  finishUpTo(s, LEVELS.length);
  s.skeins.sess.state.done = true;
  assert.equal(K.nextLevel(s), -1);
});

test('a level with snarls, felted stacks or a basket: played, saved mid-level, the ribbon noted', () => {
  for (const m of ['snarl', 'felt', 'spindle', 'preview', 'basket', 'untie', 'order']) {
    const i = firstWith(m);
    const s = opened(12, i);
    finishUpTo(s, i);
    assert.ok(K.startLevel(s, { level: i }, NOW).ok);
    for (let k = 0; k < 9; k++) botStep(s);
    const back = deserialize(serialize(s, NOW), NOW + 1000);
    K.ensureSkeins(back);
    assert.deepEqual(back.skeins.sess.state, s.skeins.sess.state, `${m}: a reload resumes exactly`);
    for (let k = 0; k < 5; k++) { botStep(s); botStep(back); }
    assert.deepEqual(back.skeins.sess.state, s.skeins.sess.state, `${m}: and deals the same stacks`);
    playLevel(s);
    assert.equal(s.skeins.finished[i], true);
    const done = s._events.filter((e) => e.type === 'skeinLevelDone').at(-1);
    const p = done.payload || done;
    if (m === 'basket') {
      assert.equal(p.neat, withinBasket(s.skeins.sess.state));
      assert.equal(!!s.skeins.notes[i].neat, p.neat);
    } else assert.equal(p.neat, false);
  }
});

test('nudges and glyphs through the sim', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  const lv = s.skeins.sess.state;
  const before = JSON.stringify(lv.tray);
  assert.ok(K.swapTray(s).ok);
  assert.notEqual(JSON.stringify(s.skeins.sess.state.tray), before);
  botStep(s);
  const cell = s.skeins.sess.state.stacks.findIndex((x) => x && x.length);
  assert.ok(K.clearPeg(s, { cell }).ok);
  assert.deepEqual(s.skeins.sess.stats, { moves: 1, undos: 0, clears: 1, swaps: 1 });
  assert.equal(K.situation(s), 'ok');
  assert.equal(K.glyphsOn(s), false);
  s.settings.colorblind = true;
  assert.equal(K.glyphsOn(s), true, 'colorblind turns the symbols on by default');
  K.setGlyphs(s, { on: false });
  assert.equal(K.glyphsOn(s), false, 'her own choice wins');
});

test('save round trip mid-level: a reload resumes exactly and deals the same stacks', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  for (let i = 0; i < 7; i++) botStep(s);
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.skeins, s.skeins);
  K.ensureSkeins(back);
  assert.deepEqual(back.skeins, s.skeins, 'ensureSkeins keeps a good save as it is');
  for (let i = 0; i < 6; i++) { botStep(s); botStep(back); }
  assert.deepEqual(back.skeins.sess.state, s.skeins.sess.state);
  // The saved undo history is capped.
  for (let i = 0; i < 200 && !s.skeins.sess.state.done; i++) botStep(s);
  assert.ok(s.skeins.sess.past.length <= K.SAVE_HISTORY);
});

test('her 0.4.0 save: the first 12 levels\' progress and a level mid-play carry over', () => {
  // the shape 0.4.0 saved: no `seen`, finished levels by index, a level 6 in play and a parked level 3
  const s = opened(12);
  finishUpTo(s, 7);
  K.startLevel(s, { level: 3, fresh: true }, NOW);
  for (let i = 0; i < 4; i++) greedyStep(s);
  K.startLevel(s, { level: 6, fresh: true }, NOW);
  for (let i = 0; i < 5; i++) greedyStep(s);
  const obj = JSON.parse(serialize(s, NOW));
  delete obj.state.skeins.seen;
  const keep = JSON.stringify(obj.state.skeins);
  const back = deserialize(JSON.stringify(obj), NOW + 1000);
  K.ensureSkeins(back);
  const { seen, ...rest } = back.skeins;
  assert.deepEqual(seen, {});
  assert.equal(JSON.stringify(rest), keep, 'progress, the level in play and the parked level are kept');
  assert.equal(K.maxOpen(back), 7);
  assert.ok(K.startLevel(back, { level: 3 }, NOW).resumed, 'the parked level resumes');
  // with all 12 finished, chapter 2 opens
  finishUpTo(back, 12);
  assert.equal(K.isOpen(back, 12), true);
  assert.equal(K.isOpen(back, 13), false);
});

test('an older save (no skeins) loads with the Winding Room closed; a broken level is dropped', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.skeins;
  delete obj.state.unlocks.skeins;
  obj.v = 3; obj.state.v = 3;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.skeins, false);
  assert.deepEqual(back.skeins, K.initialSkeins());
  const bad = opened(12);
  K.ensureLevel(bad, {}, NOW);
  bad.skeins.sess.state.stacks.pop();
  bad.skeins.other = { 3: { state: { v: 1 } } };
  K.ensureSkeins(bad);
  assert.equal(bad.skeins.sess, null);
  assert.deepEqual(bad.skeins.other, {});
  assert.ok(K.ensureLevel(bad, {}, NOW).dealt, 'a fresh level is dealt instead');
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.skeins = { finished: 'x', sess: 7, seen: [1] };
  const o = deserialize(JSON.stringify(odd), NOW);
  K.ensureSkeins(o);
  assert.deepEqual(o.skeins.finished, {});
  assert.deepEqual(o.skeins.seen, {});
  assert.equal(o.skeins.sess, null);
  assert.equal(K.summary(o).hanks, 0);
});

test('Renovate closes the Winding Room (progress and the level stay); Keep the Swift holds it open', () => {
  const s = opened(30);
  K.ensureLevel(s, {}, NOW);
  playLevel(s);
  K.startLevel(s, { level: 1 }, NOW);
  botStep(s);
  const keep = JSON.stringify(s.skeins);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('skeins'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.skeins, false);
  assert.ok(s.renovateReopen.includes('skeins'));
  assert.equal(JSON.stringify(s.skeins), keep);
  const k = opened(30);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-swift' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('skeins'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.skeins, true);
});

test('balance: hand orders stay the best coins per active minute, across sampled later levels', () => {
  // A hand order pays PAY_MINUTES (2-4) minutes of income in 30-60 s: 2 to 8 (about 4)
  // income-minutes per active minute. A fast player places a stack every 3 s (the hops, chains
  // and the hank twist alone take 1-3 s); the Winding Room pays well under orders, bonus included.
  // The planning bot wastes fewer placements than she would, so this is the high end.
  const SEC_PER_MOVE = 3;
  const rates = [];
  const sample = [0, 5, 11, li('l24'), li('l40'), firstWith('felt'), firstWith('spindle'), li('l89'), firstWith('preview'), li('l94'), li('l112')];
  for (const i of sample) {
    const s = opened(30, i + 1);
    s.stations.mixers.forEach((m, k) => { m.recipe = ['madder', 'woad'][k % 2]; });
    finishUpTo(s, i);
    K.startLevel(s, { level: i, fresh: true }, NOW);
    s.coins = 0;
    playLevel(s);
    const minutes = ((s.skeins.sess.stats.moves + s.skeins.sess.stats.clears) * SEC_PER_MOVE) / 60;
    const incomeMinute = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
    const rate = s.coins / incomeMinute / minutes;
    rates.push(rate);
    assert.ok(rate < 2.5, `level ${i + 1}: ${rate.toFixed(2)} income-minutes per active minute`);
    assert.ok(rate > 0.5, `level ${i + 1}: still worth a sit-down (${rate.toFixed(2)})`);
  }
  assert.ok(rates.reduce((a, b) => a + b, 0) / rates.length < 2, `on average under 2 (${rates.map((r) => r.toFixed(2))})`);
  assert.equal(K.HANK_MINUTES, 0.2, 'a hank pays as before');
  assert.equal(K.LEVEL_MINUTES, 0.75);
});

test('the summary read for the Puzzles hub', () => {
  const s = opened(12);
  assert.deepEqual(K.summary(s), {
    open: true, level: 0, playing: false, done: false, hanks: 0, goal: 6, finished: 0, hanksAll: 0, maxOpen: 0,
    next: 0, levels: LEVELS.length, chapter: 0, chapterName: CHAPTERS[0].name,
  });
  K.ensureLevel(s, {}, NOW);
  assert.equal(K.summary(s).playing, true);
  const or = firstWith('order');
  finishUpTo(s, or);
  K.startLevel(s, { level: or }, NOW);
  assert.equal(K.summary(s).goal, goalOf(or).hanks, 'an order shows its total');
});
