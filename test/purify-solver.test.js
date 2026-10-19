// Purify 0.3.3: the solver, rated boards and tier bands, Tricky/Master color
// distinctness, and Murky (hidden layers) with undo, saves and old saves.
// Kept small: every board here is created and solved in a few milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/rng.js';
import { deltaEHex, hexToOklch } from '../src/color.js';
import { PIGMENTS } from '../src/content/pigments.js';
import * as purify from '../src/puzzles/purify.js';

const PALETTE = PIGMENTS.map((p) => p.hex).slice(0, 12);
const roundTrip = (x) => JSON.parse(JSON.stringify(x));
const board = (tubes, capacity = 4) => ({ tubes, capacity, colors: [], history: [], moves: 0, extraTubeUsed: false });

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

test('solver: solves known boards, and the moves replay through pour()', () => {
  const known = [
    board([[0, 1, 0, 1], [1, 0, 1, 0], [], []]),
    board([[0, 0, 1, 1], [1, 1, 0, 0], []]),
    board([[0, 1, 2, 0], [2, 1, 0, 1], [1, 2, 0, 2], [], []]),
  ];
  for (const p of known) {
    const r = purify.solve(p);
    assert.equal(r.ok, true);
    assert.equal(r.length, r.moves.length);
    assert.ok(purify.verify(p, r.moves));
    for (const [a, b] of r.moves) assert.equal(purify.pour(p, a, b).ok, true);
    assert.equal(purify.isSolved(p), true);
  }
  // Already solved: no pours, and the heuristic reads zero only there.
  const solved = board([[0, 0, 0, 0], [], [1, 1, 1, 1]]);
  assert.equal(purify.heuristic(solved), 0);
  assert.deepEqual(purify.solve(solved).moves, []);
  assert.ok(purify.heuristic(board([[0, 0], [0, 0], [1, 1, 1, 1]])) > 0, 'a split color is not solved');
  assert.ok(purify.heuristic(board([[0, 1, 0, 1], [1, 0, 1, 0], [], []])) > 0);
});

test('solver: a dead end says so, and the node cap bounds the search', () => {
  const stuck = purify.solve(board([[0, 1], [1, 0]], 2));
  assert.equal(stuck.ok, false);
  assert.equal(stuck.reason, 'stuck');
  const capped = purify.solve(board([[0, 1, 2, 0], [2, 1, 0, 1], [1, 2, 0, 2], [], []]), { nodeCap: 1 });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'budget');
  assert.ok(capped.nodes <= 1);
  assert.equal(purify.verify(board([[0, 1], [1, 0], []], 2), [[0, 2], [0, 2]]), false);
});

// ---------------------------------------------------------------------------
// Rated boards
// ---------------------------------------------------------------------------

test('created boards are verified solvable and land in their tier band', () => {
  for (const tier of purify.TIER_IDS) {
    const { band, colors } = purify.TIERS[tier];
    assert.ok(Array.isArray(band) && band[0] < band[1], tier);
    for (let s = 1; s <= 5; s++) {
      const p = purify.createForTier(tier, mulberry32(s * 101 + colors), { palette: PALETTE, target: PALETTE[s] });
      assert.ok(Number.isInteger(p.par), `${tier} ${s} rated`);
      assert.ok(p.par >= band[0] && p.par <= band[1], `${tier} seed ${s}: ${p.par} outside ${band}`);
      const counts = new Array(colors).fill(0);
      for (const t of p.tubes) for (const c of t) counts[c]++;
      assert.ok(counts.every((n) => n === p.capacity));
      assert.equal(purify.isSolved(p), false);
      assert.ok(!p.tubes.some((t, i) => t.length && purify.isCorked(p, i)), 'nothing opens corked');
      const r = purify.solve(p);
      assert.ok(r.ok && purify.verify(p, r.moves), `${tier} seed ${s} solvable`);
      assert.deepEqual(roundTrip(p), p);
    }
  }
  // Harder tiers take more pours.
  const median = (tier) => {
    const pars = [1, 2, 3, 4, 5].map((s) => purify.createForTier(tier, mulberry32(900 + s), { palette: PALETTE }).par).sort((a, b) => a - b);
    return pars[2];
  };
  const m = purify.TIER_IDS.map(median);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] > m[i - 1], `medians ${m}`);
});

test('when the search budget runs out the board is the plain scramble, still solvable', () => {
  const p = purify.create({ tier: 'master', nodeBudget: 0 }, mulberry32(4), { palette: PALETTE });
  assert.equal(p.par, null);
  assert.equal(p.tubes.length, 11);
  assert.equal(purify.isSolved(p), false);
  const r = purify.solve(p, { nodeCap: 50000 });
  assert.ok(r.ok && purify.verify(p, r.moves));
});

// ---------------------------------------------------------------------------
// Colors by tier
// ---------------------------------------------------------------------------

test('Tricky and Master: the batch, a couple of neighbors, and the rest strongly distinct', () => {
  const targets = ['#c0604a', '#eacac0', '#3e6a9e', '#6e4a7e', '#d39b2a', '#8a8580'];
  for (const tier of ['tricky', 'master']) {
    targets.forEach((target, k) => {
      const p = purify.createForTier(tier, mulberry32(50 + k), { target, palette: PALETTE });
      const cs = p.colors;
      assert.equal(new Set(cs).size, purify.TIERS[tier].colors);
      assert.ok(cs.some((c) => deltaEHex(c, target) < 3), 'the batch color is in the tubes');
      const nearest = cs.map((c) => Math.min(...cs.filter((o) => o !== c).map((o) => deltaEHex(c, o))));
      const close = nearest.filter((d) => d < purify.DISTINCT_DE).length;
      assert.ok(close <= purify.TIERS[tier].family, `${tier} ${target}: ${close} colors closer than ${purify.DISTINCT_DE}`);
      assert.ok(Math.min(...nearest) >= 10, 'the family stays tellable apart');
      for (const c of cs) {
        if (deltaEHex(c, target) < 3) continue;
        assert.ok(hexToOklch(c).L <= 0.86, `${c}: no near-white impurities`);
        assert.ok(deltaEHex(c, purify.EMPTY_GLASS) >= 16, `${c}: not mistakable for empty glass`);
      }
      // All but the family sit well away from the batch color.
      assert.ok(cs.filter((c) => deltaEHex(c, target) >= purify.DISTINCT_DE).length >= cs.length - purify.TIERS[tier].family);
    });
  }
  assert.equal(purify.TIERS.relaxed.family, null);
  assert.equal(purify.TIERS.steady.family, null);
});

// ---------------------------------------------------------------------------
// Murky
// ---------------------------------------------------------------------------

test('Murky: only each top shows; a layer clears for good once it reaches the top', () => {
  const p = purify.createForTier('steady', mulberry32(8), { palette: PALETTE, murky: true });
  assert.equal(p.murky, true);
  assert.equal(p.hidden.length, p.tubes.length);
  p.tubes.forEach((t, i) => {
    assert.equal(purify.hiddenCount(p, i), Math.max(0, t.length - 1));
    if (t.length) assert.equal(purify.isHidden(p, i, t.length - 1), false, 'the top shows');
  });
  const start = purify.hiddenTotal(p);
  assert.ok(start > 0);
  // Play the solution: cloudy layers only ever go down, undo never re-hides, and a solve is all clear.
  const { moves } = purify.solve(p);
  let last = start;
  for (const [a, b] of moves) {
    const lenA = p.tubes[a].length;
    const hidA = purify.hiddenCount(p, a);
    purify.pour(p, a, b);
    if (p.tubes[a].length) {
      assert.equal(purify.isHidden(p, a, p.tubes[a].length - 1), false, 'the new top of the source shows');
      assert.equal(purify.hiddenCount(p, a), Math.min(hidA, p.tubes[a].length - 1));
    }
    assert.ok(p.tubes[a].length < lenA);
    const now = purify.hiddenTotal(p);
    assert.ok(now <= last);
    // Undo and redo: nothing is hidden again.
    const snap = roundTrip(p.hidden);
    assert.equal(purify.undo(p).ok, true);
    assert.ok(p.hidden.every((n, i) => n <= snap[i] + 0), 'undo never re-hides');
    assert.equal(purify.hiddenTotal(p) <= now, true);
    assert.equal(purify.pour(p, a, b).ok, true);
    last = purify.hiddenTotal(p);
    for (let i = 0; i < p.tubes.length; i++) if (purify.isCorked(p, i)) assert.equal(purify.hiddenCount(p, i), 0, 'a corked tube shows whole');
  }
  assert.equal(purify.isSolved(p), true);
  assert.equal(purify.hiddenTotal(p), 0);
  // Undo all the way back: still nothing re-hidden.
  while (p.history.length) purify.undo(p);
  assert.equal(purify.hiddenTotal(p), 0);
});

test('Murky: the reveal state saves and loads, and old saves read as fully revealed', () => {
  const p = purify.createForTier('relaxed', mulberry32(3), { palette: PALETTE, murky: true });
  const { moves } = purify.solve(p);
  purify.pour(p, ...moves[0]);
  purify.pour(p, ...moves[1]);
  const back = roundTrip(p);
  assert.deepEqual(back, p);
  for (let i = 0; i < p.tubes.length; i++) assert.equal(purify.hiddenCount(back, i), purify.hiddenCount(p, i));
  // The free extra tube on Relaxed arrives clear.
  assert.equal(purify.addTube(back).ok, true);
  assert.equal(purify.hiddenCount(back, back.tubes.length - 1), 0);
  assert.equal(back.hidden.length, back.tubes.length);

  // A 0.3.2 save: an in-progress puzzle with no reveal data at all.
  const old = { tubes: [[0, 1, 0, 1], [1, 0, 1, 0], [], []], capacity: 4, colors: ['#c0604a', '#3e6a9e'], history: [{ from: 0, to: 2, n: 1 }], moves: 1, extraTubeUsed: false, tier: 'relaxed', extraTube: true };
  const o = roundTrip(old);
  assert.equal(purify.hiddenTotal(o), 0);
  assert.equal(purify.isHidden(o, 0, 0), false);
  assert.equal(purify.pour(o, 0, 2).ok, true);
  assert.equal(purify.undo(o).ok, true);
  assert.equal(o.hidden, undefined, 'an old puzzle is left as it was');
  // Murky flag with a missing or broken hidden list: everything shows.
  assert.equal(purify.hiddenTotal({ ...roundTrip(old), murky: true }), 0);
  assert.equal(purify.hiddenCount({ ...roundTrip(old), murky: true, hidden: ['x', null] }, 0), 0);
  // A plain board has no Murky fields.
  const plain = purify.createForTier('relaxed', mulberry32(3), { palette: PALETTE });
  assert.equal(plain.murky, undefined);
  assert.equal(plain.hidden, undefined);
});
