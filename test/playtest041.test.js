// 0.4.1 playtest fixes: Purify's Murky turned off mid-puzzle (in place, every
// pour kept, the pay follows the puzzle's own flag), "Back to solvable" for
// Purify and the Lifting Table (history -> index of the last solvable
// position), and the Lifting Table's hint that always answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/rng.js';
import * as purify from '../src/puzzles/purify.js';
import * as R from '../src/puzzles/lift.js';
import * as PR from '../proto/lift/rules.js';
import { lastSolvable, verdictCache } from '../src/puzzles/backtrack.js';
import { LEVELS, levelById } from '../src/puzzles/lift-levels.js';
import { LEVELS as PROTO_LEVELS } from '../proto/lift/levels.js';
import * as T from '../src/sim/lift.js';
import * as sim from '../src/sim/index.js';
import { purifySolved } from '../src/sim/factory.js';
import { createInitialState } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';

const NOW = Date.UTC(2026, 9, 24, 9);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------------------
// The shared walk back
// ---------------------------------------------------------------------------

test('lastSolvable: history verdicts -> the newest solvable index (unknown counts unless skipped)', () => {
  const at = (vs) => (i) => vs[i];
  assert.equal(lastSolvable(4, at(['solvable', 'solvable', 'dead', 'dead'])), 1);
  assert.equal(lastSolvable(3, at(['solvable', 'solvable', 'solvable'])), 2, 'already solvable: no steps');
  assert.equal(lastSolvable(4, at(['solvable', 'unknown', 'dead', 'dead'])), 1, 'unknown counts as solvable (the button never lies)');
  assert.equal(lastSolvable(4, at(['solvable', 'unknown', 'dead', 'dead']), { unknown: 'skip' }), 0, 'provable only: skip unknown');
  assert.equal(lastSolvable(3, at(['dead', 'dead', 'dead'])), 0, 'nothing qualifies: the fresh puzzle');
  assert.equal(lastSolvable(3, at(['solvable', 'dead', 'stop']), { fallback: () => 7 }), 7, 'a spent budget falls back');
  const asked = [];
  lastSolvable(5, (i) => { asked.push(i); return i === 3 ? 'solvable' : 'dead'; });
  assert.deepEqual(asked, [4, 3], 'asks lazily, newest first');
  const c = verdictCache(2);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.has('a'), false, 'the cache stays bounded');
  assert.equal(c.get('c'), 3);
});

// ---------------------------------------------------------------------------
// Purify: Murky off mid-puzzle
// ---------------------------------------------------------------------------

test('purify: clearMurk reveals every cloudy layer in place and keeps every pour; undo never re-hides', () => {
  const rng = mulberry32(41);
  const p = purify.createForTier('steady', rng, { palette: [], murky: true });
  assert.ok(purify.hiddenTotal(p) > 0);
  const r = purify.solve(p, { nodeCap: 20000 });
  assert.ok(r.ok);
  for (const [a, b] of r.moves.slice(0, 3)) assert.ok(purify.pour(p, a, b).ok);
  const tubes = JSON.stringify(p.tubes);
  const history = JSON.stringify(p.history);
  const cloudy = purify.hiddenTotal(p);
  assert.ok(cloudy > 0, 'some layers are still cloudy');
  const res = purify.clearMurk(p);
  assert.equal(res.ok, true);
  assert.equal(res.revealed.length, cloudy, 'every cloudy layer is named for the clearing animation');
  assert.equal(p.murky, false);
  assert.equal(p.murkCleared, true);
  assert.ok(p.hidden.every((n) => n === 0), 'hidden counts zeroed');
  assert.equal(purify.hiddenTotal(p), 0);
  assert.equal(JSON.stringify(p.tubes), tubes, 'the shelf is untouched');
  assert.equal(JSON.stringify(p.history), history, 'every pour is kept');
  assert.equal(p.moves, 3);
  // Undo across the switch works and nothing turns cloudy again.
  for (let k = 0; k < 3; k++) assert.equal(purify.undo(p).ok, true);
  assert.equal(purify.hiddenTotal(p), 0);
  // And the rest of the solve still finishes the board.
  for (const [a, b] of r.moves) assert.ok(purify.pour(p, a, b).ok);
  assert.ok(purify.isSolved(p));
  assert.equal(purify.clearMurk(p).ok, false, 'a clear puzzle has nothing to clear');
  // JSON round trip (the save).
  const back = JSON.parse(JSON.stringify(p));
  assert.equal(back.murky, false);
  assert.equal(purify.hiddenTotal(back), 0);
});

function payState() {
  const s = createInitialState(NOW, 9);
  s.onboarding.done = true;
  s.muddyBatches = [{ id: 'b', color: 'orange', jars: 4, value: 1, at: NOW, tier: null }];
  return s;
}

test('purify: the pay reads the puzzle\'s own Murky flag at completion (cleared murk pays the usual amount)', () => {
  const rng = mulberry32(7);
  const murkyP = purify.createForTier('tricky', rng, { palette: [], murky: true });
  const clearedP = JSON.parse(JSON.stringify(murkyP));
  purify.clearMurk(clearedP);
  const plainP = { ...JSON.parse(JSON.stringify(murkyP)), murky: false };
  delete plainP.hidden;
  const a = purifySolved(payState(), { batchId: 'b', tier: 'tricky', puzzle: murkyP }, NOW);
  const b = purifySolved(payState(), { batchId: 'b', tier: 'tricky', puzzle: clearedP }, NOW);
  const c = purifySolved(payState(), { batchId: 'b', tier: 'tricky', puzzle: plainP }, NOW);
  assert.equal(a.murky, true);
  assert.equal(b.murky, false, 'cleared murk: no Murky bonus');
  assert.ok(close(b.reward, c.reward), 'cleared pays exactly the usual amount');
  assert.ok(close(a.reward, c.reward * purify.MURKY.pay), 'a board kept Murky still pays 25% more');
  assert.equal(sim.factory.purifySolved, purifySolved, 'reachable as sim.factory.purifySolved');
});

// ---------------------------------------------------------------------------
// Purify: dead ends and Back to solvable
// ---------------------------------------------------------------------------

const board = (tubes, capacity = 4) => ({ tubes, capacity, colors: [], history: [], moves: 0, extraTubeUsed: false });

test('purify: verdict proves dead ends only, cached by position; cap reached reads unknown', () => {
  // Two colors in two full, mixed tubes and no empty tube: no pour at all.
  const stuck = board([[0, 1, 0, 1], [1, 0, 1, 0]], 4);
  assert.equal(purify.verdict(stuck), 'dead');
  assert.equal(purify.isDeadEnd(stuck), true);
  const fine = board([[0, 1, 0, 1], [1, 0, 1, 0], [], []]);
  assert.equal(purify.verdict(fine), 'solvable');
  const cache = verdictCache();
  assert.equal(purify.verdict(stuck, { cache }), 'dead');
  assert.equal(cache.size, 1);
  const flipped = board([[1, 0, 1, 0], [0, 1, 0, 1]]);
  assert.equal(purify.positionKey(flipped), purify.positionKey(board([[0, 1, 0, 1], [1, 0, 1, 0]])), 'tube order does not matter');
  const big = purify.createForTier('master', mulberry32(3), { palette: [] });
  assert.equal(purify.verdict(big, { nodeCap: 1 }), 'unknown', 'a spent cap is unknown, never dead');
  // The spare tube rescues a shelf that is dead without it.
  const spare = { ...board([[0, 1, 0, 1], [1, 0, 1, 0]]), extraTube: true };
  assert.equal(purify.spareHelps(spare), true);
  assert.equal(purify.spareHelps({ ...spare, extraTubeUsed: true }), false);
  assert.equal(purify.spareHelps({ ...spare, extraTube: false }), false);
});

test('purify: backToSolvable (history -> index) lands on the newest position that is not dead', () => {
  let found = 0;
  for (let seed = 1; seed <= 60 && found < 6; seed++) {
    const rng = mulberry32(seed);
    const p = purify.createForTier(seed % 2 ? 'tricky' : 'master', rng, { palette: [], murky: seed % 3 === 0 });
    for (let k = 0; k < 40; k++) {
      const moves = [];
      for (let a = 0; a < p.tubes.length; a++) for (let b = 0; b < p.tubes.length; b++) if (purify.canPour(p, a, b)) moves.push([a, b]);
      if (!moves.length || purify.isSolved(p)) break;
      const [a, b] = moves[Math.floor(rng() * moves.length)];
      purify.pour(p, a, b);
      if (purify.verdict(p) === 'dead') break;
    }
    if (purify.verdict(p) !== 'dead') continue;
    found++;
    const states = purify.historyTubes(p);
    assert.equal(states.length, p.history.length + 1);
    assert.deepEqual(states[states.length - 1], p.tubes, 'the last position is now');
    const cache = verdictCache();
    const r = purify.backToSolvable(p, { cache });
    assert.ok(r.steps >= 1);
    assert.equal(r.index, p.history.length - r.steps);
    const at = (i) => purify.verdict({ tubes: states[i], capacity: p.capacity }, { nodeCap: purify.BACK_NODE_CAP });
    assert.notEqual(at(r.index), 'dead', 'the target is not a dead end');
    for (let i = r.index + 1; i < states.length; i++) assert.equal(at(i), 'dead', 'everything after it is');
    // Undoing that many pours reaches exactly that shelf, and it finishes.
    for (let k = 0; k < r.steps; k++) assert.ok(purify.undo(p).ok);
    assert.deepEqual(p.tubes, states[r.index]);
    assert.equal(purify.backToSolvable(p).steps, 0, 'on track: nothing to take back');
    assert.equal(purify.hiddenTotal(p) >= 0, true);
  }
  assert.ok(found >= 3, `found ${found} dead ends to step back from`);
});

// ---------------------------------------------------------------------------
// The Lifting Table: dead ends, Back to solvable, the hint
// ---------------------------------------------------------------------------

/** A casual player (seeded) on L until the rules prove a dead end: [states] or null. */
function playIntoDeadEnd(Rules, L, seed) {
  const rng = mulberry32(seed);
  const states = [Rules.newState(L)];
  let s = states[0];
  for (let k = 0; k < 160 && !Rules.isDone(s); k++) {
    const ms = Rules.legalMoves(L, s);
    if (!ms.length) break;
    const places = ms.filter((m) => m.t === 'place');
    const pool = places.length && rng() < 0.85 ? places : ms;
    s = Rules.apply(L, s, pool[Math.floor(rng() * pool.length)]).state;
    states.push(s);
    if (Rules.isStuck(L, s)) return states;
  }
  return Rules.verdict(L, s) === 'dead' ? states : null;
}

test('lift: verdict says dead only when proved; backToSolvableIndex finds a provably solvable position', () => {
  let found = 0;
  for (const id of ['cherries', 'cottage', 'village', 'teapot']) {
    const L = levelById(id);
    for (let seed = 1; seed <= 6; seed++) {
      const states = playIntoDeadEnd(R, L, seed);
      if (!states) continue;
      found++;
      const now = states[states.length - 1];
      assert.equal(R.verdict(L, now), 'dead');
      const idx = R.backToSolvableIndex(L, states);
      assert.ok(idx < states.length - 1, `${id}/${seed}: steps back`);
      const s = states[idx];
      const proved = R.isDone(s) || !!R.onSolution(L, s) || R.solve(L, s, { cap: R.BACK_CAP }).ok;
      assert.ok(proved, `${id}/${seed}: position ${idx} is provably solvable`);
      break;
    }
  }
  assert.ok(found >= 2, `found ${found} dead ends`);
  // The fresh painting is solvable and on the stored solution.
  for (const L of LEVELS.slice(0, 4)) assert.equal(R.verdict(L, R.newState(L)), 'solvable');
});

test('lift: bestHint always answers with a legal move, a guess when the solver is out of budget, or dead', () => {
  const L = levelById('sampler');
  const sol = L.solution.split(' ');
  let s = R.newState(L);
  for (const m of sol.slice(0, 12)) s = R.apply(L, s, R.decodeMove(m)).state;
  assert.equal(R.bestHint(L, s).kind, 'solution', 'on the stored solution: its next move');
  // Off the stored path, with no budget to speak of: a sensible guess, never nothing.
  const off = R.apply(L, s, R.legalMoves(L, s).find((m) => R.encodeMove(m) !== sol[12])).state;
  const h = R.bestHint(L, off, { cap: 1 });
  assert.ok(['lift', 'guess', 'dead'].includes(h.kind), h.kind);
  if (h.kind !== 'dead') assert.ok(R.isLegal(L, off, h.move), 'the guess is a legal move');
  // A guess exists for every non-stuck position along a casual game.
  const rng = mulberry32(5);
  let t = R.newState(L);
  for (let k = 0; k < 40 && !R.isDone(t); k++) {
    if (R.isStuck(L, t)) { assert.equal(R.bestHint(L, t, { cap: 1 }).kind, 'dead'); break; }
    const g = R.guessMove(L, t);
    assert.ok(g && R.isLegal(L, t, g.move), `step ${k}: a legal guess`);
    const ms = R.legalMoves(L, t);
    t = R.apply(L, t, ms[Math.floor(rng() * ms.length)]).state;
  }
  // A stuck table reads dead.
  const states = playIntoDeadEnd(R, levelById('village'), 1) || playIntoDeadEnd(R, levelById('village'), 2);
  assert.ok(states);
  assert.equal(R.bestHint(levelById('village'), states[states.length - 1]).kind, 'dead');
  assert.equal(R.bestHint(L, R.replay(L, L.solution)).kind, 'none', 'a cleared painting has nothing to hint');
});

test('lift: the bigger paintings answer a hint within a small node budget', () => {
  for (const id of ['harbor', 'mittens', 'sampler', 'birdhouse']) {
    const L = levelById(id);
    const rng = mulberry32(id.length);
    let s = R.newState(L);
    for (let k = 0; k < 25 && !R.isDone(s) && !R.isStuck(L, s); k++) {
      const ms = R.legalMoves(L, s).filter((m) => m.t === 'place');
      if (!ms.length) break;
      s = R.apply(L, s, ms[Math.floor(rng() * ms.length)]).state;
    }
    if (R.isDone(s)) continue;
    const t0 = process.hrtime.bigint();
    const h = R.bestHint(L, s);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(h.kind !== 'none', `${id}: an answer (${h.kind})`);
    assert.ok(ms < 400, `${id}: ${ms.toFixed(0)} ms`);
  }
});

test('lift: the prototype rules carry the same verdict, hint and walk back', () => {
  const L = PROTO_LEVELS.find((l) => l.id === 'village');
  const states = playIntoDeadEnd(PR, L, 1) || playIntoDeadEnd(PR, L, 2);
  assert.ok(states);
  const idx = PR.backToSolvableIndex(L, states);
  const S = levelById('village');
  const srcStates = playIntoDeadEnd(R, S, 1) || playIntoDeadEnd(R, S, 2);
  assert.equal(idx, R.backToSolvableIndex(S, srcStates), 'same answer from both copies');
  assert.equal(PR.bestHint(L, states[states.length - 1]).kind, 'dead');
});

function liftState() {
  const s = createInitialState(NOW, 3);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= 18) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s.coins = 4000;
  assert.equal(sim.unlocks.buy(s, { id: 'lift' }, NOW).ok, true);
  s._events = [];
  return s;
}

test('lift sim: deadEnd and backToSolvable trim her moves to a solvable position; the spare spot is not spent', () => {
  const s = liftState();
  const L = levelById('village');
  const states = playIntoDeadEnd(R, L, 1) || playIntoDeadEnd(R, L, 2);
  assert.ok(states);
  // Replay the same moves through the sim (moves are recovered from consecutive states).
  for (const P of LEVELS.slice(0, LEVELS.indexOf(L))) s.lift.done[P.id] = 1; // paintings open in order
  assert.ok(T.startPainting(s, { levelId: 'village' }).ok);
  for (let i = 1; i < states.length; i++) {
    const m = R.legalMoves(L, states[i - 1]).find((x) => JSON.stringify(R.apply(L, states[i - 1], x).state) === JSON.stringify(states[i]));
    assert.ok(m);
    assert.ok(T.move(s, { move: R.encodeMove(m) }, NOW).ok);
  }
  assert.equal(T.deadEnd(s), true);
  assert.equal(T.history(s).length, states.length);
  const n = s.lift.game.moves.length;
  const r = T.backToSolvable(s);
  assert.equal(r.ok, true);
  assert.ok(r.steps >= 1);
  assert.equal(s.lift.game.moves.length, n - r.steps);
  assert.equal(T.deadEnd(s), false);
  assert.equal(R.canNudge(T.current(s).s), true, 'the once-per-painting spare spot is still there');
  assert.equal(T.backToSolvable(s).steps, 0, 'on track: nothing taken back');
  // An explicit index (a screen that walked there itself) is honored.
  T.move(s, { move: R.encodeMove(R.legalMoves(L, T.current(s).s)[0]) }, NOW);
  const k = s.lift.game.moves.length;
  assert.equal(T.backToSolvable(s, { index: 0 }).steps, k);
  assert.equal(s.lift.game.moves.length, 0);
});
