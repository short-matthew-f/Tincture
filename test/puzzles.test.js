import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/rng.js';
import { hexToOklch, oklchToHex, deltaEHex, mixPaintHex, inGamut, hueFamily, HUE_FAMILIES, WHITE, BLACK } from '../src/color.js';
import { PIGMENTS } from '../src/content/pigments.js';
import * as grading from '../src/puzzles/grading.js';
import * as matching from '../src/puzzles/matching.js';
import * as purify from '../src/puzzles/purify.js';
import * as packing from '../src/puzzles/packing.js';
import * as puzzles from '../src/puzzles/index.js';

const HEX = /^#[0-9a-f]{6}$/;
const PALETTE = PIGMENTS.map((p) => p.hex);
const roundTrip = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

test('grading TIERS match the spec table', () => {
  const { TIERS } = grading;
  assert.deepEqual(roundTrip(TIERS), {
    relaxed: { cols: 4, rows: 5, anchors: 'alt-edges', neighborDE: 12, dims: ['h'], k: 8, mult: 1 },
    steady: { cols: 6, rows: 8, anchors: 'sparse-edges', neighborDE: 8, dims: ['h', 'l'], k: 12, mult: 1.5 },
    tricky: { cols: 8, rows: 10, anchors: 'corners+4', neighborDE: 5, dims: ['h', 'l'], k: 20, mult: 2.5 },
    master: { cols: 9, rows: 12, anchors: 'corners', neighborDE: 3, dims: ['h', 'l', 'c'], k: 32, mult: 4 },
  });
  assert.equal(puzzles.GRADING_TIERS, TIERS);
  // Validation floors keep the tier ordering.
  const floors = grading.TIER_NAMES.map(grading.floorFor);
  for (let i = 1; i < floors.length; i++) assert.ok(floors[i] < floors[i - 1]);
});

/** Solve by swapping each position's own tile home; returns the swap count. */
function solveBySwaps(board) {
  let swaps = 0;
  for (let p = 0; p < board.order.length; p++) {
    if (!board.mask[p] || board.order[p] === p) continue;
    const q = board.order.indexOf(p);
    const r = grading.swap(board, p, q);
    assert.ok(r.ok, `swap ${p}<->${q} refused`);
    assert.ok(r.placed.includes(p));
    swaps++;
  }
  return swaps;
}

for (const tier of grading.TIER_NAMES) {
  test(`grading ${tier}: 20 boards are fair, shuffled and solvable`, () => {
    let below = 0;
    for (let s = 0; s < 20; s++) {
      const rng = mulberry32(1000 + s);
      const board = grading.createBoard({ tier, palette: [PALETTE[s % PALETTE.length], PALETTE[(s * 7) % PALETTE.length]] }, rng);
      const { cols, rows } = grading.TIERS[tier];
      assert.equal(board.cells.length, cols * rows);
      assert.deepEqual(roundTrip(board), board, 'board must be plain JSON data');

      // Floor (or flagged), and no duplicate-looking tiles.
      if (board.belowFloor) below++;
      else assert.ok(board.minNeighborDE >= board.floorDE - 1e-9, `${tier} seed ${s}: ${board.minNeighborDE}`);
      const live = board.cells.filter(Boolean);
      for (const h of live) {
        assert.match(h, HEX);
        assert.ok(inGamut(hexToOklch(h)), `${h} out of gamut`);
      }
      if (!board.belowFloor) {
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) assert.ok(deltaEHex(live[i], live[j]) >= grading.DUPLICATE_DE - 0.5);
        }
      }

      // Shuffle: anchors untouched, not solved, ≥ 60% of movable tiles displaced.
      assert.equal(grading.isSolved(board), false);
      assert.ok(board.anchors.length >= 4);
      for (const a of board.anchors) {
        assert.ok(board.mask[a]);
        assert.equal(board.order[a], a);
      }
      const movable = board.order.map((_, p) => p).filter((p) => grading.isMovable(board, p));
      const displaced = movable.filter((p) => board.order[p] !== p).length;
      assert.ok(displaced >= 0.6 * movable.length);
      assert.equal(grading.correctCount(board) + grading.wrongCount(board), live.length);
      assert.deepEqual([...board.order.filter((c) => c !== null)].sort((a, b) => a - b),
        board.order.map((c, p) => (c === null ? null : p)).filter((p) => p !== null));

      // Swap then swap back restores the order.
      const before = board.order.slice();
      const [i, j] = movable;
      assert.equal(grading.swap(board, i, j).ok, true);
      assert.equal(grading.swap(board, i, j).ok, true);
      assert.deepEqual(board.order, before);
      assert.equal(board.moves, 2);
      // Refusals: anchors, same cell.
      assert.equal(grading.swap(board, board.anchors[0], i).ok, false);
      assert.equal(grading.swap(board, i, i).ok, false);
      assert.equal(board.moves, 2);

      // Sound helpers.
      const notes = grading.hearOrder(board);
      assert.equal(notes.length, live.length);
      assert.ok(notes.every((n) => Number.isInteger(n) && n >= 0 && n <= 11));
      const melody = grading.boardMelody(board);
      for (let k = 1; k < melody.length; k++) assert.ok(melody[k] > melody[k - 1]);

      // Solving by placing every tile yields isSolved.
      solveBySwaps(board);
      assert.equal(grading.isSolved(board), true);
      assert.equal(grading.wrongCount(board), 0);

      const tints = grading.revealedTints(board, rng);
      assert.equal(tints.length, tier === 'tricky' || tier === 'master' ? 2 : 1);
      for (const t of tints) assert.ok(live.includes(t));
    }
    if (below) console.warn(`grading ${tier}: ${below}/20 boards below floor`);
    assert.ok(below <= 2, `${tier}: ${below}/20 boards below floor`);
  });
}

test('grading shapes mask out cells and keep > 50% in play', () => {
  for (const shape of grading.SHAPES) {
    for (const tier of grading.TIER_NAMES) {
      const board = grading.createBoard({ tier, shape, palette: PALETTE }, mulberry32(77));
      const inPlay = board.mask.filter(Boolean).length;
      assert.ok(inPlay / board.mask.length > 0.5, `${shape}/${tier}`);
      board.mask.forEach((m, p) => {
        assert.equal(board.cells[p] === null, !m);
        assert.equal(board.order[p] === null, !m);
      });
      if (shape !== 'rect') assert.ok(inPlay < board.mask.length, `${shape}/${tier} masks something`);
      const masked = board.mask.indexOf(false);
      if (masked >= 0) {
        const movable = board.order.findIndex((_, p) => grading.isMovable(board, p));
        assert.equal(grading.swap(board, masked, movable).ok, false);
      }
      assert.equal(grading.isSolved(board), false);
      solveBySwaps(board);
      assert.equal(grading.isSolved(board), true);
    }
  }
});

test('grading switchTier keeps progress, anchors and corners', () => {
  const rng = mulberry32(4242);
  const board = grading.createBoard({ tier: 'steady', palette: PALETTE }, rng);
  // Put about half of the movable tiles home.
  const movable = board.order.map((_, p) => p).filter((p) => grading.isMovable(board, p));
  for (const p of movable.slice(0, Math.floor(movable.length / 2))) {
    if (board.order[p] !== p) grading.swap(board, p, board.order.indexOf(p));
  }
  const ratio = (b) => {
    const mv = b.order.map((_, p) => p).filter((p) => grading.isMovable(b, p));
    return mv.filter((p) => b.order[p] === p).length / mv.length;
  };
  const r0 = ratio(board);
  for (const tier of grading.TIER_NAMES) {
    const next = grading.switchTier(board, tier, rng);
    assert.equal(next.tier, tier);
    assert.equal(next.cells.length, grading.TIERS[tier].cols * grading.TIERS[tier].rows);
    for (const a of next.anchors) {
      assert.ok(next.mask[a]);
      assert.equal(next.order[a], a);
    }
    assert.equal(grading.isSolved(next), false);
    assert.ok(Math.abs(ratio(next) - r0) < 0.2, `${tier}: ratio ${ratio(next)} vs ${r0}`);
    assert.equal(next.moves, board.moves);
    if (!next.belowFloor) assert.ok(next.minNeighborDE >= next.floorDE - 1e-9);
  }
  // Same tier with the same corners keeps the exact colors.
  const same = grading.switchTier(board, 'steady', rng);
  assert.deepEqual(same.corners, board.corners);
  assert.deepEqual(same.cells, board.cells);
});

test('grading apply mirrors swap and reports events', () => {
  const board = grading.create({ tier: 'relaxed', palette: PALETTE }, mulberry32(3));
  const [i, j] = board.order.map((_, p) => p).filter((p) => grading.isMovable(board, p));
  const r = grading.apply(board, { i, j });
  assert.equal(r.ok, true);
  assert.ok(r.events.includes('swap'));
  assert.deepEqual(grading.apply(board, { i, j: i }).events, ['refused']);
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const OWNED = PIGMENTS.slice(0, 6).map(({ id, hex }) => ({ id, hex }));
const hexOf = (id) => (id === 'white' ? WHITE : id === 'black' ? BLACK : PIGMENTS.find((p) => p.id === id).hex);

test('matching score thresholds', () => {
  const base = '#3e6a9e';
  assert.deepEqual(matching.score(base, base), { de: 0, tier: 'perfect', pct: 1.5, star: true });
  const lch = hexToOklch(base);
  const seen = new Set();
  for (let dL = 0; dL <= 0.4; dL += 0.005) {
    const other = oklchToHex({ ...lch, L: lch.L + dL });
    const s = matching.score(base, other);
    const de = deltaEHex(base, other);
    const want = de < 2 ? ['perfect', 1.5] : de < 5 ? ['great', 1.2] : de < 10 ? ['good', 1.0] : ['close', 0.7];
    assert.equal(s.tier, want[0]);
    assert.equal(s.pct, want[1]);
    assert.equal(s.star, want[0] === 'perfect');
    seen.add(s.tier);
  }
  assert.deepEqual([...seen].sort(), ['close', 'good', 'great', 'perfect']);
  // Never fails: the worst possible mix still pays 70%.
  assert.equal(matching.score('#ffffff', '#000000').pct, 0.7);
  assert.equal(matching.score(base, null).pct, 0.7);
});

test('matching closeness needle', () => {
  assert.equal(matching.closeness('#b8433a', '#b8433a'), 1);
  assert.equal(matching.closeness('#ffffff', '#000000'), 0);
  const mid = matching.closeness('#b8433a', '#c8533a');
  assert.ok(mid > 0 && mid < 1);
  assert.equal(matching.closeness('#b8433a', null), 0);
});

test('matching orders: real recipes, Perfect is reachable', () => {
  for (let s = 0; s < 60; s++) {
    const rng = mulberry32(s);
    const difficulty = (s % 5) / 4;
    const order = matching.createOrder({ pigments: OWNED, rng, difficulty });
    assert.equal(order.kind, 'mix');
    assert.match(order.target, HEX);
    assert.deepEqual(roundTrip(order), order);
    const pigs = order.recipe.filter((r) => r.pigment !== 'white' && r.pigment !== 'black');
    assert.ok(pigs.length >= 1 && pigs.length <= 3);
    // A lone pigment always carries a drop, so the target is a tint or shade, never the pigment itself.
    if (pigs.length === 1) assert.ok(order.recipe.length >= 2);
    assert.equal(new Set(order.recipe.map((r) => r.pigment)).size, order.recipe.length);
    for (const r of order.recipe) assert.ok(Number.isInteger(r.weight) && r.weight >= 1 && r.weight <= 4);
    assert.equal(order.parts, order.recipe.reduce((a, r) => a + r.weight, 0));
    const mix = matching.blend(matching.recipeDrops(order.recipe, hexOf));
    const sc = matching.score(order.target, mix);
    assert.ok(sc.de < 0.5);
    assert.equal(sc.tier, 'perfect');
    assert.equal(mix, mixPaintHex(order.recipe.map((r) => ({ hex: hexOf(r.pigment), weight: r.weight }))));
  }
  // No drops when they are excluded; one pigment is enough to make an order.
  const noDrops = matching.createOrder({ pigments: OWNED, includeDrops: false, difficulty: 1 }, mulberry32(9));
  assert.ok(noDrops.recipe.every((r) => r.pigment !== 'white' && r.pigment !== 'black'));
  const solo = matching.createOrder({ pigments: OWNED.slice(0, 1), rng: mulberry32(1) });
  assert.ok(solo.recipe.length >= 1);
  // Drops passed as pigments are not counted as pigments.
  assert.throws(() => matching.createOrder({ pigments: [{ id: 'white', hex: WHITE }], rng: mulberry32(1) }), RangeError);
});

test('matching orders: a catalog recipe is used as-is, and the board is avoided', () => {
  const catalogRecipes = [{ id: 'orange', hex: '#c56731', recipe: [{ pigment: 'madder', weight: 1 }, { pigment: 'ochre', weight: 1 }] }];
  const o = matching.createOrder({ pigments: OWNED, catalogRecipes, catalogChance: 1 }, mulberry32(3));
  assert.equal(o.colorId, 'orange');
  assert.equal(o.target, '#c56731');
  assert.deepEqual(o.recipe, catalogRecipes[0].recipe);
  // A catalog color sitting on the board already (or one she cannot mix) falls back to a generated recipe.
  const avoided = matching.createOrder({ pigments: OWNED, catalogRecipes, catalogChance: 1, avoidHexes: ['#c56731'] }, mulberry32(3));
  assert.equal(avoided.colorId, undefined);
  assert.ok(deltaEHex(avoided.target, '#c56731') >= 8);
  const unmixable = matching.createOrder({ pigments: OWNED.slice(1, 3), catalogRecipes, catalogChance: 1 }, mulberry32(3));
  assert.equal(unmixable.colorId, undefined);
  // Families at their cap are skipped.
  for (let s = 0; s < 20; s++) {
    const g = matching.createOrder({ pigments: OWNED, avoidFamilies: ['orange', 'red'] }, mulberry32(100 + s));
    assert.ok(!['orange', 'red'].includes(hueFamily(g.target)), g.target);
  }
  // Nothing can pass (every hex on the board), yet an order is still produced, Perfect-reachable.
  const crowded = Array.from({ length: 40 }, (_, k) => oklchToHex({ L: 0.3 + 0.015 * k, C: 0.09, h: (k * 37) % 360 }));
  const f = matching.createOrder({ pigments: OWNED, avoidHexes: crowded, avoidFamilies: [...HUE_FAMILIES] }, mulberry32(5));
  assert.match(f.target, HEX);
  assert.equal(f.target, mixPaintHex(f.recipe.map((r) => ({ hex: hexOf(r.pigment), weight: r.weight }))));
});

test('matching blend, any-you-love and bouquet', () => {
  assert.equal(matching.blend([]), null);
  assert.equal(matching.blend([{ id: 'woad', hex: '#3e6a9e', count: 0 }]), null);
  assert.equal(matching.blend([{ id: 'woad', hex: '#3e6a9e', count: 3 }]), '#3e6a9e');
  const green = matching.blend([{ id: 'woad', hex: '#3e6a9e', count: 1 }, { id: 'sulfur', hex: '#d8c83a', count: 1 }]);
  assert.match(green, HEX);
  assert.deepEqual(matching.createAnyYouLoveOrder(), { kind: 'any', recipe: null, target: null, parts: 0 });
  const b = matching.createBouquetOrder({ pigments: OWNED }, mulberry32(12));
  assert.equal(b.kind, 'bouquet');
  assert.ok(b.targets.length >= 2 && b.targets.length <= 3);
  assert.deepEqual(b.targets, b.orders.map((o) => o.target));
});

// ---------------------------------------------------------------------------
// Purify
// ---------------------------------------------------------------------------

/** DFS tube-sort solver with visited-state hashing. Returns moves or null.
 *  Strict goal (v0.2): every non-empty tube full and one color (corked). */
function solveTubes(p, nodeCap = 200000) {
  const cap = p.capacity;
  const key = (tubes) => tubes.map((t) => t.join(',')).sort().join('|');
  const solved = (tubes) => tubes.every((t) => !t.length || (t.length === cap && t.every((c) => c === t[0])));
  const seen = new Set();
  let nodes = 0;
  const path = [];
  const dfs = (tubes) => {
    if (solved(tubes)) return true;
    if (++nodes > nodeCap) return false;
    const k = key(tubes);
    if (seen.has(k)) return false;
    seen.add(k);
    const moves = [];
    for (let a = 0; a < tubes.length; a++) {
      const A = tubes[a];
      if (!A.length) continue;
      const c = A[A.length - 1];
      let run = 0;
      for (let i = A.length - 1; i >= 0 && A[i] === c; i--) run++;
      const uni = run === A.length;
      let movedToEmpty = false;
      for (let b = 0; b < tubes.length; b++) {
        if (b === a) continue;
        const B = tubes[b];
        if (B.length >= cap) continue;
        if (B.length && B[B.length - 1] !== c) continue;
        if (!B.length && (uni || movedToEmpty)) continue; // pointless or symmetric
        if (!B.length) movedToEmpty = true;
        const n = Math.min(run, cap - B.length);
        const score = (B.length ? 2 : 0) + (n === run ? 1 : 0) + (B.length + n === cap ? 2 : 0);
        moves.push({ a, b, n, score });
      }
    }
    moves.sort((x, y) => y.score - x.score);
    for (const m of moves) {
      const next = tubes.map((t) => t.slice());
      next[m.b].push(...next[m.a].splice(next[m.a].length - m.n, m.n));
      path.push([m.a, m.b]);
      if (dfs(next)) return true;
      path.pop();
    }
    return false;
  };
  return dfs(p.tubes.map((t) => t.slice())) ? path.slice() : null;
}

test('purify sizes scale with batch value', () => {
  assert.deepEqual(purify.sizeForBatch(0), { colors: 4, tubes: 6 });
  assert.deepEqual(purify.sizeForBatch(1e9), { colors: 9, tubes: 11 });
  let last = 0;
  for (const v of [0, 3, 6, 20, 45, 90, 200, 1000]) {
    const { colors, tubes } = purify.sizeForBatch(v);
    assert.ok(colors >= last && colors >= 4 && colors <= 9);
    assert.equal(tubes, colors + 2);
    last = colors;
  }
});

test('purify tiers: sizes, expected minutes, rewards and the extra-tube rule', () => {
  assert.deepEqual(Object.keys(purify.TIERS), ['relaxed', 'steady', 'tricky', 'master']);
  assert.deepEqual(purify.sizeForTier('relaxed'), { colors: 4, tubes: 6 });
  assert.deepEqual(purify.sizeForTier('steady'), { colors: 6, tubes: 8 });
  assert.deepEqual(purify.sizeForTier('tricky'), { colors: 8, tubes: 10 });
  assert.deepEqual(purify.sizeForTier('master'), { colors: 9, tubes: 11 });
  assert.deepEqual(purify.sizeForTier('nope'), { colors: 4, tubes: 6 });
  assert.deepEqual(['relaxed', 'steady', 'tricky', 'master'].map(purify.expectedMinutes), [1, 2, 3, 5]);
  assert.deepEqual(Object.values(purify.TIERS).map((t) => t.purity), ['pure', 'pure', 'flawless', 'flawless']);
  assert.deepEqual(Object.values(purify.TIERS).map((t) => t.k), [4, 6, 10, 16]);
  for (const tier of purify.TIER_IDS) {
    const p = purify.createForTier(tier, mulberry32(7), { palette: PALETTE });
    assert.equal(p.tier, tier);
    assert.equal(p.colors.length, purify.TIERS[tier].colors);
    assert.equal(p.tubes.length, purify.TIERS[tier].tubes);
    const n = p.tubes.length;
    const r = purify.addTube(p);
    assert.equal(r.ok, tier === 'relaxed', `extra tube on ${tier}`);
    assert.equal(p.tubes.length, tier === 'relaxed' ? n + 1 : n);
    assert.equal(purify.apply(p, { addTube: true }).events[0], 'refused');
  }
});

test('purify: 30 instances per tier are valid and solvable to the strict rule', () => {
  for (const tier of ['relaxed', 'steady', 'tricky', 'master']) {
    const colors = purify.TIERS[tier].colors;
    for (let s = 0; s < 30; s++) {
      const p = purify.createForTier(tier, mulberry32(colors * 1000 + s), { palette: PALETTE });
      assert.equal(p.tubes.length, colors + 2);
      assert.equal(p.colors.length, colors);
      assert.equal(new Set(p.colors).size, colors);
      p.colors.forEach((h) => assert.match(h, HEX));
      assert.deepEqual(roundTrip(p), p);
      const counts = new Array(colors).fill(0);
      for (const t of p.tubes) {
        assert.ok(t.length <= p.capacity);
        for (const c of t) counts[c]++;
      }
      assert.ok(counts.every((n) => n === 4));
      assert.equal(purify.isSolved(p), false);
      const path = solveTubes(p);
      assert.ok(path, `colors ${colors} seed ${s} not solved`);
      // Replay the solution through the real API.
      for (const [a, b] of path) {
        assert.equal(purify.pour(p, a, b).ok, true);
        assert.ok(p.tubes.every((t) => t.length <= p.capacity));
      }
      assert.equal(purify.isSolved(p), true);
    }
  }
});

test('purify pour, undo, addTube and isSolved', () => {
  const p = purify.create({ colors: 5 }, mulberry32(5), {});
  assert.equal(p.colors.length, 5);
  const snapshot = roundTrip(p.tubes);
  let pours = 0;
  for (let a = 0; a < p.tubes.length && pours < 6; a++) {
    for (let b = 0; b < p.tubes.length && pours < 6; b++) {
      if (!purify.canPour(p, a, b)) {
        if (a !== b) assert.equal(purify.pour(p, a, b).ok, false);
        continue;
      }
      const r = purify.pour(p, a, b);
      assert.equal(r.ok, true);
      assert.ok(r.moved >= 1);
      pours++;
    }
  }
  assert.ok(pours > 0);
  assert.equal(p.history.length, pours);
  while (p.history.length) assert.equal(purify.undo(p).ok, true);
  assert.deepEqual(p.tubes, snapshot);
  assert.equal(purify.undo(p).ok, false);

  const n = p.tubes.length;
  assert.equal(purify.addTube(p).ok, true);
  assert.equal(p.tubes.length, n + 1);
  assert.equal(p.extraTubeUsed, true);
  assert.equal(purify.addTube(p).ok, false);

  const solved = { tubes: [[0, 0, 0, 0], [1, 1, 1, 1], [], [2, 2, 2, 2]], capacity: 4, colors: [], history: [], moves: 0, extraTubeUsed: false };
  assert.equal(purify.isSolved(solved), true);
  assert.equal(purify.isCorked(solved, 0), true);
  assert.equal(purify.isCorked(solved, 2), false);
  solved.tubes[2] = [2, 2];
  solved.tubes[3] = [2, 2];
  assert.equal(purify.isSolved(solved), false, 'one color split over two tubes: sorted but not corked');
  solved.tubes[3] = [2, 1];
  assert.equal(purify.isSolved(solved), false);

  // Pour moves as much of the top run as fits and reports a completed tube.
  const q = { tubes: [[1, 0, 0, 0], [0], [2, 1], []], capacity: 4, colors: [], history: [], moves: 0, extraTubeUsed: false };
  const r = purify.pour(q, 0, 1);
  assert.deepEqual(r, { ok: true, moved: 3, completedTube: true, solved: false });
  assert.equal(purify.pour(q, 0, 1).ok, false); // full
  assert.equal(purify.pour(q, 3, 0).ok, false); // empty source
  assert.equal(purify.pour(q, 1, 2).ok, false); // top colors differ
  // Every non-empty tube is one color now, but not full: not solved (strict rule).
  assert.deepEqual(purify.pour(q, 2, 3), { ok: true, moved: 1, completedTube: false, solved: false });
  assert.equal(q.moves, 2);
  // Pour the lone 1s together and the 2 back: [[1,1], [0x4], [2], []] still open...
  assert.deepEqual(purify.pour(q, 3, 0), { ok: true, moved: 1, completedTube: false, solved: false });
  const done = { tubes: [[1, 1, 1], [0, 0, 0, 0], [1], []], capacity: 4, colors: [], history: [], moves: 0, extraTubeUsed: false };
  assert.deepEqual(purify.pour(done, 2, 0), { ok: true, moved: 1, completedTube: true, solved: true });
});

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

const ROUTES = [
  { id: 'harbor-town', name: 'Harbor Town', palette: ['blue', 'teal'] },
  { id: 'festival', name: 'Festival City', palette: ['red', 'orange', 'pink'] },
  { id: 'weavers-row', name: "Weavers' Row", palette: [] },
];
const JARS = [
  { color: 'woad', hex: '#3e6a9e', family: 'blue' },
  { color: 'harbor-teal', hex: '#2f8a8a', family: 'teal' },
  { color: 'madder', hex: '#b8433a', family: 'red' },
  { color: 'marigold', hex: '#de7a2e', family: 'orange' },
  { color: 'umber', hex: '#6b4a2b' },
];
const crateFor = (family) => (['blue', 'teal'].includes(family) ? 'harbor-town' : ['red', 'orange', 'pink'].includes(family) ? 'festival' : 'weavers-row');

test('packing: clean run earns the bonus, finishes after every jar', () => {
  const p = packing.create({ routes: ROUTES, jars: JARS, rng: mulberry32(1) });
  assert.equal(p.conveyor.length, JARS.length);
  assert.deepEqual(roundTrip(p), p);
  let last;
  while (!p.done) last = packing.drop(p, crateFor(packing.currentJar(p).family));
  assert.equal(last.done, true);
  assert.equal(p.index, JARS.length);
  assert.equal(packing.drop(p, 'festival').ok, false);
  const r = packing.result(p);
  assert.equal(r.clean, true);
  assert.equal(r.bonus, 0.25);
  assert.equal(r.perCrate['harbor-town'].count, 2);
  assert.ok(Object.values(r.perCrate).every((c) => c.clean));
  assert.equal(packing.isSolved(p), true);
});

test('packing: a missort is neutral, only that crate loses its bonus', () => {
  const p = packing.create({ routes: ROUTES, jars: JARS }, mulberry32(2));
  let missed = false;
  while (!p.done) {
    const jar = packing.currentJar(p);
    if (!missed && jar.family === 'blue') {
      const d = packing.drop(p, 'festival');
      assert.equal(d.ok, true);
      assert.equal(d.clean, false);
      missed = true;
    } else {
      assert.equal(packing.drop(p, crateFor(jar.family)).clean, true);
    }
  }
  const r = packing.result(p);
  assert.equal(r.clean, false);
  assert.equal(r.bonus, 0);
  assert.equal(r.missorts, 1);
  assert.equal(r.perCrate.festival.clean, false);
  assert.equal(r.perCrate['harbor-town'].clean, true);
  assert.equal(packing.drop(packing.create({ routes: ROUTES, jars: JARS }, mulberry32(3)), 'nowhere').ok, false);
});
