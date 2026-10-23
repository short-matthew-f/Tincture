import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLevel, newState, apply, legalMoves, settle, isDone, isStuck, nudge, benchCap, exposedColor,
  newGame, play, playNudge, undo, replay, solve, hint, capacitiesMatch, decodeMove, encodeMove,
  stateKey, parseRow, generateQueues, chooseCap, mulberry,
} from '../lift/rules.js';
import { LEVELS, PALETTE } from '../lift/levels.js';

const tiny = (o) => buildLevel({ id: 'tiny', name: 'Tiny', slots: 4, bench: 3, ...o });
const P = (L, s, str) => apply(L, s, decodeMove(str));

test('every level: 3 to 7 palette colors, capacities match cell counts', () => {
  assert.equal(LEVELS.length, 12);
  for (const L of LEVELS) {
    assert.ok(L.colors.length >= 3 && L.colors.length <= 7, `${L.id} has ${L.colors.length} colors`);
    for (const c of L.colors) assert.ok(PALETTE[c], `${L.id}: ${c} is in the palette`);
    assert.ok(capacitiesMatch(L), `${L.id}: jar capacity equals cell count per color`);
    assert.ok(L.lanes.every((l) => l.length > 0));
  }
  // rising in size
  const sizes = LEVELS.map((L) => L.W * L.H);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], 'levels grow');
});

test('every level is solvable: the stored solution clears it', () => {
  for (const L of LEVELS) {
    const s = replay(L, L.solution);
    assert.ok(isDone(s), `${L.id} clears`);
    assert.equal(s.shelf.length, L.lanes.reduce((a, l) => a + l.length, 0), `${L.id}: every jar ends on the shelf`);
    assert.equal(s.belt.length + s.bench.length, 0);
  }
});

test('the solver independently solves every level within a small node cap', () => {
  for (const L of LEVELS) {
    const r = solve(L, undefined, { cap: 5000 });
    assert.ok(r.ok, `${L.id} solved`);
    assert.ok(isDone(replay(L, r.path)));
  }
});

test('art parsing is run-length', () => {
  assert.equal(parseRow('s3 r s2'), 'sssrss');
  assert.throws(() => buildLevel({ id: 'x', name: 'X', art: ['s3', 's2'] }), /wide/);
});

test('bottom exposure: only the lowest remaining cell of a column lifts', () => {
  // row 0 is the top
  const L = tiny({ art: ['a b', 'b a'], queues: ['a2', 'b2'] });
  let s = newState(L);
  assert.equal(exposedColor(L, s, 0), 'b');
  assert.equal(exposedColor(L, s, 1), 'a');
  // a2 lifts the a at the bottom of column 1; the a at the top of column 0 is buried.
  let r = P(L, s, 'L0');
  s = r.state;
  assert.deepEqual(s.h, [2, 1]);
  assert.equal(exposedColor(L, s, 1), 'b', 'lifting exposes the cell above');
  assert.equal(s.belt[0].n, 1, 'the jar waits half full');
  assert.equal(r.passes.length, 1);
  assert.deepEqual(r.passes[0].lifts.map((x) => [x.col, x.row]), [[1, 1]]);
  // b2 lifts both b's in one pass; that exposes the last a, which the waiting jar lifts next pass.
  r = P(L, s, 'L1');
  s = r.state;
  assert.ok(isDone(s));
  assert.equal(r.passes.length, 2);
  assert.deepEqual(r.passes[0].lifts.map((x) => x.c).join(''), 'bb');
});

test('the train: a jar further back sees what the jar in front exposed', () => {
  // one column: a, a, b from the top. Two a-jars wait, then b1 opens the column.
  const L = tiny({ art: ['a', 'a', 'b'], queues: ['a1', 'a1', 'b1'] });
  let s = newState(L);
  s = P(L, s, 'L0').state;
  s = P(L, s, 'L1').state;
  assert.equal(s.belt.length, 2, 'both wait');
  const r = P(L, s, 'L2');
  assert.ok(isDone(r.state));
  assert.equal(r.passes.length, 2);
  assert.deepEqual(r.passes[1].lifts.map((x) => [x.id, x.row, x.tick]), [['0.0', 1, 0], ['1.0', 0, 1]]);
});

test('one cell per column per pass, and passes repeat until nothing lifts', () => {
  const L = tiny({ art: ['a', 'a', 'a'], queues: ['a3'] });
  const r = P(L, newState(L), 'L0');
  assert.equal(r.passes.length, 3);
  assert.ok(r.passes.every((p) => p.lifts.length === 1));
  assert.ok(isDone(r.state));
});

test('jars leave the belt when full and go to the shelf; a jar with nothing to lift waits', () => {
  const L = tiny({ art: ['b b b', 'a a a'], queues: ['a3 b2 b1'] });
  let s = newState(L);
  let r = P(L, s, 'L0');
  s = r.state;
  assert.equal(s.belt.length, 0, 'the full jar left');
  assert.deepEqual(s.shelf.map((j) => j.c + j.cap), ['a3']);
  assert.deepEqual(r.passes[0].filled, ['0.0']);
  s = P(L, s, 'L0').state; // b2 fills from columns 0 and 1
  assert.deepEqual(s.h, [0, 0, 1]);
  assert.equal(s.shelf.length, 2);
  // a jar that finds nothing waits
  const L2 = tiny({ art: ['b', 'a'], queues: ['b1 a1'] });
  const w = P(L2, newState(L2), 'L0').state;
  assert.equal(w.belt.length, 1);
  assert.equal(w.belt[0].n, 0);
});

test('parking: a belt jar goes to the bench and back', () => {
  const L = tiny({ art: ['b', 'a'], queues: ['b1 a1'], slots: 1, bench: 1 });
  let s = P(L, newState(L), 'L0').state; // b waits, belt full
  assert.deepEqual(legalMoves(L, s).map(encodeMove), ['P0']);
  s = P(L, s, 'P0').state;
  assert.equal(s.bench.length, 1);
  s = P(L, s, 'L0').state; // a lifts, leaves; b is exposed
  assert.equal(s.belt.length, 0);
  s = P(L, s, 'U0').state;
  assert.ok(isDone(s));
  assert.throws(() => P(L, s, 'L0'), /illegal/);
});

test('undo round trips back to the start, unlimited', () => {
  const L = LEVELS[2];
  let g = newGame(L);
  const start = JSON.stringify(g.state);
  const seen = [JSON.stringify(g.state)];
  for (const str of L.solution.split(' ').slice(0, 12)) {
    g = play(L, g, decodeMove(str)).game;
    seen.push(JSON.stringify(g.state));
  }
  g = playNudge(g);
  seen.push(JSON.stringify(g.state));
  for (let i = seen.length - 1; i > 0; i--) {
    assert.equal(JSON.stringify(g.state), seen[i]);
    g = undo(g);
  }
  assert.equal(JSON.stringify(g.state), start);
  assert.equal(undo(g), g, 'undo at the start is a no-op');
});

test('stuck detection and the free nudge', () => {
  const L = tiny({ art: ['a', 'b'], queues: ['a1 b1'], slots: 1, bench: 0 });
  let s = P(L, newState(L), 'L0').state; // a waits; belt and bench full
  assert.ok(isStuck(L, s));
  assert.equal(legalMoves(L, s).length, 0);
  const t = solve(L, s);
  assert.equal(t.ok, false);
  assert.equal(t.exhausted, true, 'proved tangled');
  assert.equal(hint(L, s).kind, 'tangled');
  s = nudge(s);
  assert.equal(benchCap(L, s), 1);
  assert.ok(!isStuck(L, s));
  const r = solve(L, s);
  assert.ok(r.ok);
  assert.deepEqual(r.path, ['P0', 'L0', 'U0']);
  assert.ok(isDone(replay(L, r.path, s)));
  // not stuck while there is room
  const L2 = tiny({ art: ['a', 'b'], queues: ['a1 b1'], slots: 2, bench: 0 });
  assert.ok(!isStuck(L2, P(L2, newState(L2), 'L0').state));
});

test('solver: a known small board, shortest by BFS', () => {
  const L = tiny({ art: ['b', 'a'], queues: ['b1 a1'], slots: 1, bench: 1 });
  const r = solve(L, undefined, { bfs: true });
  assert.ok(r.ok);
  assert.deepEqual(r.path, ['L0', 'P0', 'L0', 'U0']);
  const L2 = tiny({ art: ['a b', 'b a'], queues: ['a2', 'b2'] });
  assert.equal(solve(L2, undefined, { bfs: true }).path.length, 2);
  const h = hint(L, newState(L));
  assert.equal(h.kind, 'solution');
  assert.deepEqual(h.move, { t: 'place', i: 0 });
});

test('state keys ignore bench order; settle is a no-op on a settled state', () => {
  const L = LEVELS[0];
  const s = replay(L, L.solution.split(' ').slice(0, 3).join(' '));
  assert.equal(stateKey(settle(L, s).state), stateKey(s));
  assert.equal(settle(L, s).passes.length, 0);
});

test('generator: capacities never leave a 1 or 2 remainder, and dealt queues match', () => {
  const rng = mulberry(3);
  for (let rem = 3; rem < 60; rem++) {
    const c = chooseCap(rem, rng);
    assert.ok(rem - c === 0 || rem - c >= 3, `rem ${rem} cap ${c}`);
  }
  const base = buildLevel({ id: 'g', name: 'G', art: LEVELS[3].cells.map((r) => r.split('').join(' ')) });
  const g = generateQueues(base, { lanes: 3, seed: 7, future: 0.3 });
  const L = buildLevel({ id: 'g', name: 'G', art: LEVELS[3].cells.map((r) => r.split('').join(' ')), queues: g.queues });
  assert.ok(capacitiesMatch(L));
  assert.ok(solve(L, undefined, { cap: 20000 }).ok);
});
