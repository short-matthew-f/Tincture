import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, COLORS, HANK, geometry, board, resolve, topRun, newLevel, place, clearPeg, swapTray,
  situation, emptyPegs, goalMet, botPlay, newSession, sessionPlace, sessionUndo, sessionClear, sessionSwap,
  genStack, hankName,
} from '../skeins/rules.js';

// A straight row of 5 pegs: 0-1-2-3-4 (each touches only its row neighbors).
const ROW = geometry(['.....']);
// Two rows: 0..3 on top, 4..7 below (odd row shifted right).
// Neighbors of 1: 0, 2, 4, 5 (the row below sits half a peg right).
const TWO = geometry(['....', '....']);

test('geometry: odd-r neighbors and knots', () => {
  assert.deepEqual(ROW.nbr[2], [1, 3]);
  assert.deepEqual(TWO.nbr[1], [0, 2, 4, 5]);
  assert.deepEqual(TWO.nbr[4], [0, 1, 5]);
  const k = geometry(['...'], [[1, 0]]);
  assert.equal(k.cells[1].knot, true);
  assert.deepEqual(k.nbr[0], []);
  for (let li = 0; li < LEVELS.length; li++) {
    const b = board(li);
    const pegs = b.cells.filter((c) => !c.knot).length;
    assert.ok(pegs >= 19 && pegs <= 30, `${LEVELS[li].id} has ${pegs} pegs`);
    // symmetric neighbors
    b.nbr.forEach((ns, i) => ns.forEach((j) => assert.ok(b.nbr[j].includes(i))));
  }
});

test('levels: 12, colors rise 3 -> 6, goals rise', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(LEVELS[0].colors, 3);
  assert.equal(LEVELS[11].colors, 6);
  for (let i = 1; i < 12; i++) {
    assert.ok(LEVELS[i].colors >= LEVELS[i - 1].colors);
    assert.ok(LEVELS[i].goal.hanks >= LEVELS[i - 1].goal.hanks);
  }
  assert.equal(hankName(0), 'Madder red hank');
  assert.ok(COLORS.length >= 6);
});

test('merge: placed stack pulls a matching neighbor run onto the longer run', () => {
  // peg 1 has [weld, madder x3]; place [madder x1] on peg 2 -> the 1 madder hops onto peg 1.
  const stacks = [[], [1, 0, 0, 0], [0], [], []];
  const r = resolve(stacks, ROW.nbr, [2]);
  assert.deepEqual(r.stacks, [[], [1, 0, 0, 0, 0], [], [], []]);
  assert.deepEqual(r.steps, [{ type: 'move', from: 2, to: 1, color: 0, n: 1 }]);
  // input untouched
  assert.deepEqual(stacks[2], [0]);
});

test('merge: ties go to the clean pile, then to the placed peg', () => {
  // both runs are 2; peg 0 is pure madder, peg 1 has weld under -> peg 0 receives.
  let r = resolve([[0, 0], [1, 0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[0], [0, 0, 0, 0]);
  assert.deepEqual(r.stacks[1], [1]);
  // both pure and equal: the placed peg receives
  r = resolve([[0, 0], [0, 0], [], [], []], ROW.nbr, [0]);
  assert.deepEqual(r.stacks[0], [0, 0, 0, 0]);
  r = resolve([[0, 0], [0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[1], [0, 0, 0, 0]);
});

test('merge: a cluster gathers along paths, farthest first', () => {
  // madder tops on 0,1,2 (a line); peg 2 has the longest run -> 0 hops to 1, then 1 to 2.
  const r = resolve([[0], [2, 0], [0, 0, 0], [], []], ROW.nbr, [0]);
  assert.deepEqual(r.steps.slice(0, 2), [
    { type: 'move', from: 0, to: 1, color: 0, n: 1 },
    { type: 'move', from: 1, to: 2, color: 0, n: 2 },
  ]);
  assert.deepEqual(r.stacks, [[], [2], [0, 0, 0, 0, 0], [], []]);
});

test('cascade: a donor reveals a color that merges again', () => {
  // place [woad, madder] on peg 2 between [madder x3] (peg 1) and [woad x2] (peg 3).
  // madder hops 2 -> 1, revealing woad on peg 2, which joins peg 3's longer run.
  const r = resolve([[], [0, 0, 0], [2, 0], [2, 2], []], ROW.nbr, [2]);
  assert.deepEqual(r.steps, [
    { type: 'move', from: 2, to: 1, color: 0, n: 1 },
    { type: 'move', from: 2, to: 3, color: 2, n: 1 },
  ]);
  assert.deepEqual(r.stacks, [[], [0, 0, 0, 0], [], [2, 2, 2], []]);
});

test('bundling: a top run of 10 lifts off, then the color under it cascades', () => {
  // peg 1 has [woad, madder x7]; place [madder x3] on peg 2 -> 10 madder -> hank.
  // that reveals woad on peg 1, which merges with peg 0's woad.
  const r = resolve([[2, 2], [2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r.hanks, [0]);
  assert.deepEqual(r.steps, [
    { type: 'move', from: 2, to: 1, color: 0, n: 3 },
    { type: 'bundle', cell: 1, color: 0, n: 10 },
    { type: 'move', from: 1, to: 0, color: 2, n: 1 },
  ]);
  assert.deepEqual(r.stacks, [[2, 2, 2], [], [], [], []]);
  // 9 does not bundle
  const r9 = resolve([[], [0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.equal(r9.hanks.length, 0);
  assert.equal(topRun(r9.stacks[1]), 9);
  // more than 10 lifts the whole run
  const r12 = resolve([[], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r12.steps.at(-1), { type: 'bundle', cell: 1, color: 0, n: 12 });
  assert.equal(HANK, 10);
});

test('place: validation, tray refill after 3, hanks count toward the goal', () => {
  let s = newLevel(0, 42);
  assert.equal(s.tray.filter(Boolean).length, 3);
  assert.equal(place(s, 0, 999).ok, false);
  const e = emptyPegs(s);
  let r = place(s, 0, e[0]);
  assert.ok(r.ok);
  assert.equal(place(r.state, 0, e[1]).ok, false, 'tray slot 0 is used');
  if (r.state.stacks[e[0]].length) assert.equal(place(r.state, 1, e[0]).ok, false, 'peg taken');
  s = r.state;
  s = place(s, 1, emptyPegs(s)[5]).state;
  r = place(s, 2, emptyPegs(s)[9]);
  assert.ok(r.refilled);
  assert.equal(r.state.tray.filter(Boolean).length, 3);
  // goal: hand-build a nearly finished level
  const g = newLevel(0, 1);
  g.hanks = [0, 1, 2, 0, 1];
  const nb = board(0).nbr;
  const a = emptyPegs(g)[0], b = nb[a][0];
  g.stacks[b] = [0, 0, 0, 0, 0, 0, 0, 0];
  g.tray[0] = [0, 0];
  const done = place(g, 0, a);
  assert.deepEqual(done.hanks, [0]);
  assert.ok(goalMet(done.state));
  assert.equal(done.state.done, true);
  assert.equal(place(done.state, 1, emptyPegs(done.state)[0]).ok, false);
});

test('determinism: the same seed deals and plays the same game', () => {
  assert.deepEqual(newLevel(3, 99), newLevel(3, 99));
  assert.notDeepEqual(newLevel(3, 99).tray, newLevel(3, 100).tray);
  assert.deepEqual(botPlay(5, 1234).state, botPlay(5, 1234).state);
  // stacks are 2..maxH tall, colors in range
  const s = newLevel(11, 5);
  for (let i = 0; i < 200; i++) {
    const st = genStack(s, 11);
    assert.ok(st.length >= 2 && st.length <= 6);
    assert.ok(st.every((c) => c >= 0 && c < 6));
  }
});

test('undo round trip restores the exact state; stats keep counting', () => {
  let sess = newSession(1, 7);
  const start = sess.state;
  const snaps = [start];
  for (let i = 0; i < 6; i++) {
    const s = sess.state;
    const t = s.tray.findIndex(Boolean);
    sess = sessionPlace(sess, t, emptyPegs(s)[i % 3]).session;
    snaps.push(sess.state);
  }
  sess = sessionSwap(sess).session;
  for (let i = snaps.length - 1; i >= 0; i--) {
    sess = sessionUndo(sess).session;
    assert.deepEqual(sess.state, snaps[i]);
  }
  assert.equal(sessionUndo(sess).ok, false);
  assert.deepEqual(sess.stats, { moves: 6, undos: 7, clears: 0, swaps: 1 });
  // replaying after undo is deterministic too
  const again = sessionPlace(sess, 0, emptyPegs(start)[0]).session;
  assert.deepEqual(again.state, snaps[1]);
});

test('nudges: clear a peg, swap the tray, stuck and tight', () => {
  const s = newLevel(0, 3);
  // fill every peg with stacks whose tops never match (test-only colors 10+) -> stuck
  board(0).cells.forEach((c, i) => { s.stacks[i] = [0, 10 + i]; });
  assert.equal(emptyPegs(s).length, 0);
  assert.equal(situation(s), 'stuck');
  const c = clearPeg(s, 4);
  assert.ok(c.ok);
  assert.deepEqual(c.state.stacks[4], []);
  assert.equal(c.state.aside, 2);
  assert.equal(clearPeg(c.state, 4).ok, false, 'an empty peg has nothing to set aside');
  assert.notEqual(situation(c.state), 'stuck');
  const w = swapTray(s);
  assert.ok(w.ok);
  assert.notDeepEqual(w.state.tray, s.tray);
  assert.equal(w.state.rs !== s.rs, true);
  // tight: 2 empty pegs, nothing in the tray can merge
  const t = JSON.parse(JSON.stringify(c.state));
  t.stacks[5] = [];
  t.tray = [[7, 7], [8], null];
  assert.equal(situation(t), 'tight');
  // session counts nudges quietly
  let sess = { ...newSession(0, 3), state: s };
  sess = sessionClear(sess, 4).session;
  sess = sessionSwap(sess).session;
  assert.deepEqual(sess.stats, { moves: 0, undos: 0, clears: 1, swaps: 1 });
});

test('the greedy bot finishes every level with few nudges', () => {
  const report = [];
  for (let li = 0; li < LEVELS.length; li++) {
    const runs = [11, 222, 3333, 44444, 555555].map((seed) => botPlay(li, seed));
    for (const r of runs) assert.ok(r.done, `${LEVELS[li].id} finishes`);
    const nudges = runs.map((r) => r.nudges);
    const cap = li < 4 ? 0 : li < 8 ? 2 : 10;
    assert.ok(Math.max(...nudges) <= cap, `${LEVELS[li].id}: nudges ${nudges} <= ${cap}`);
    report.push(`${LEVELS[li].id}: moves ${runs.map((r) => r.moves).join('/')}, nudges ${nudges.join('/')}`);
  }
  if (process.env.SKEINS_REPORT) console.log(report.join('\n'));
});
