import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, take, legalLines, rivalTurn, rivalChoice, endRound, dealRound, finalScore,
  countTiles, placementScore, roundOver, wallColor, wallCol, coinValue, TOTAL_TILES,
} from '../tiles/rules.js';

const emptyWall = () => Array.from({ length: 5 }, () => Array(5).fill(false));
const fresh = (seed = 7, o) => newGame(seed, o);
// Test helper: after hand-editing a state, pad/trim the bag so the total is 100 again.
function balance(s) {
  while (countTiles(s) > TOTAL_TILES) s.bag.pop();
  while (countTiles(s) < TOTAL_TILES) s.bag.push(0);
  return s;
}

test('new game: 100 tiles, 5 full dishes, round 1', () => {
  const s = fresh();
  assert.equal(countTiles(s), TOTAL_TILES);
  assert.equal(s.round, 1);
  assert.ok(s.dishes.every((d) => d.length === 4));
  assert.equal(s.bag.length, 80);
  assert.equal(s.score, 0);
});

test('same seed gives same bag; different seed differs', () => {
  assert.deepEqual(fresh(5), fresh(5));
  assert.notDeepEqual(fresh(5).dishes, fresh(6).dishes);
});

test('wall layout is a shifted Latin square', () => {
  for (let r = 0; r < 5; r++) {
    const seen = new Set();
    for (let c = 0; c < 5; c++) { seen.add(wallColor(r, c)); assert.equal(wallCol(r, wallColor(r, c)), c); }
    assert.equal(seen.size, 5);
  }
  assert.equal(wallColor(0, 0), 0);
  assert.equal(wallColor(1, 0), 4);
  assert.equal(wallColor(1, 1), 0);
});

test('legalLines: empty lines legal, mixed colour and set-in-wall blocked', () => {
  let s = fresh();
  assert.deepEqual(legalLines(s, 0), [0, 1, 2, 3, 4]);
  s.lines[2] = { color: 1, n: 1 };
  assert.deepEqual(legalLines(s, 0), [0, 1, 3, 4]);
  assert.deepEqual(legalLines(s, 1), [0, 1, 2, 3, 4]);
  s.lines[0] = { color: 1, n: 1 }; // full
  assert.deepEqual(legalLines(s, 1), [1, 2, 3, 4]);
  s.wall[3][wallCol(3, 4)] = true;
  assert.ok(!legalLines(s, 4).includes(3));
  assert.ok(legalLines(s, 3).includes(3));
});

function setup(dishes, center = []) {
  const s = fresh();
  // keep conservation honest: push displaced tiles back into the bag
  for (const d of s.dishes) s.bag.push(...d);
  s.dishes = dishes.map((d) => d.slice());
  while (s.dishes.length < 5) s.dishes.push([]);
  for (const t of s.dishes.flat()) s.bag.splice(s.bag.indexOf(t), 1);
  s.center = center.slice();
  for (const t of center) s.bag.splice(s.bag.indexOf(t), 1);
  assert.equal(countTiles(s), TOTAL_TILES);
  return s;
}

test('take from dish: all of colour taken, rest slide to centre, overflow to seconds', () => {
  const s = setup([[0, 0, 1, 2]]);
  const r = take(s, { source: 'dish', index: 0, color: 0, line: 0 });
  assert.ok(r.ok);
  assert.deepEqual(r.moved, { source: 'dish', index: 0, color: 0, count: 2, line: 0, placed: 1, overflow: 1, slid: 2 });
  assert.deepEqual(r.state.lines[0], { color: 0, n: 1 });
  assert.deepEqual(r.state.seconds, [0]);
  assert.deepEqual(r.state.center, [1, 2]);
  assert.deepEqual(r.state.dishes[0], []);
  assert.equal(countTiles(r.state), TOTAL_TILES);
  assert.deepEqual(s.center, []); // input untouched
});

test('take from centre takes only that colour', () => {
  const s = setup([], [1, 1, 3, 3, 3]);
  const r = take(s, { source: 'center', color: 3, line: 3 });
  assert.ok(r.ok);
  assert.deepEqual(r.state.center, [1, 1]);
  assert.deepEqual(r.state.lines[3], { color: 3, n: 3 });
  assert.equal(r.overflow, 0);
});

test('take rejects illegal moves and accepts the seconds basket always', () => {
  const s = setup([[0, 0, 1, 2]]);
  assert.equal(take(s, { source: 'dish', index: 0, color: 4, line: 0 }).ok, false);
  assert.equal(take(s, { source: 'dish', index: 1, color: 0, line: 0 }).ok, false);
  s.lines[1] = { color: 2, n: 1 };
  assert.equal(take(s, { source: 'dish', index: 0, color: 0, line: 1 }).reason, 'illegal');
  const r = take(s, { source: 'dish', index: 0, color: 0, line: -1 });
  assert.ok(r.ok);
  assert.deepEqual(r.state.seconds, [0, 0]);
  assert.equal(r.moved.placed, 0);
});

test('adding to a partly filled line and overflowing it', () => {
  const s = setup([[2, 2, 2, 2]]);
  s.lines[2] = { color: 2, n: 2 };
  balance(s);
  const r = take(s, { source: 'dish', index: 0, color: 2, line: 2 });
  assert.deepEqual([r.moved.placed, r.moved.overflow], [1, 3]);
  assert.equal(r.state.lines[2].n, 3);
  assert.equal(r.state.seconds.length, 3);
});

test('scoring: single tile 1; row of 3 adjacent; row2+col2 join = 6', () => {
  const w = emptyWall();
  w[0][0] = true;
  assert.equal(placementScore(w, 2, 2), 1);
  w[0][1] = true;
  assert.equal(placementScore(w, 0, 1), 2);
  const w2 = emptyWall();
  w2[1][1] = w2[1][2] = true; w2[1][3] = true;
  assert.equal(placementScore(w2, 1, 3), 3);
  const w3 = emptyWall();
  w3[2][0] = w3[2][1] = true;      // row of 2 left of (2,2)
  w3[3][2] = w3[4][2] = true;      // column of 2 below (2,2)
  w3[2][2] = true;
  assert.equal(placementScore(w3, 2, 2), 3 + 3);
  const w4 = emptyWall();
  w4[0][0] = w4[1][0] = w4[2][0] = true;
  assert.equal(placementScore(w4, 2, 0), 3);
  const w5 = emptyWall(); w5[2][2] = true; w5[4][4] = true; // diagonal/gap neighbours do not count
  assert.equal(placementScore(w5, 3, 3), 1);
});

test('endRound: full lines move to wall, rest to kiln, seconds sell +1 each', () => {
  let s = fresh();
  // build a state with line 0 full (colour 2), line 2 full (colour 0), line 3 partial, 2 seconds
  s.lines[0] = { color: 2, n: 1 };
  s.lines[2] = { color: 0, n: 3 };
  s.lines[3] = { color: 1, n: 2 };
  s.seconds = [4, 4];
  s.dishes = [[], [], [], [], []];
  balance(s);
  const before = countTiles(s);
  const r = endRound(s);
  assert.equal(countTiles(r.state), before);
  assert.deepEqual(r.placements.map((p) => [p.row, p.col, p.color, p.points]), [[0, wallCol(0, 2), 2, 1], [2, wallCol(2, 0), 0, 1]]);
  assert.equal(r.seconds, 2);
  assert.equal(r.state.score, 1 + 1 + 2);
  assert.equal(r.state.kiln[0], 2); // rest of the 3-line
  assert.equal(r.state.kiln[4], 2); // seconds back on the shelf
  assert.deepEqual(r.state.lines[3], { color: 1, n: 2 }); // partial stays
  assert.equal(r.gameOver, false);
});

test('endRound scores in row order and chains neighbours', () => {
  const s = fresh();
  s.wall[0][0] = true; // colour 0 at row 0
  s.lines[1] = { color: 0, n: 2 }; // row 1: colour 0 goes to col 1, directly below-right: not adjacent to (0,0)
  s.lines[0] = { color: 1, n: 1 };  // row 0 col 1 -> joins (0,0): h=2, then...
  balance(s);
  const r = endRound(s);
  // row0 col1: h=2 (0,0)+(0,1), v=1 -> 2.  row1 col1: h=1, v=2 (0,1)+(1,1) -> 2
  assert.deepEqual(r.placements.map((p) => p.points), [2, 2]);
});

test('game ends after the round in which a wall row completes; bonuses', () => {
  const s = fresh();
  for (let c = 0; c < 4; c++) s.wall[0][c] = true;
  s.score = 10;
  s.lines[0] = { color: wallColor(0, 4), n: 1 };
  balance(s);
  const r = endRound(s);
  assert.equal(r.gameOver, true);
  assert.equal(r.state.over, true);
  assert.equal(r.placements[0].points, 5);
  const f = finalScore(r.state);
  assert.equal(f.rowsDone, 1);
  assert.equal(f.rows, 2);
  assert.equal(f.cols, 0);
  assert.equal(f.total, r.state.score + 2);
  assert.equal(coinValue(f.total), f.total * 8);
});

test('end bonuses: full wall = 5 rows*2 + 5 cols*7 + 5 colours*10', () => {
  const s = fresh();
  s.wall = Array.from({ length: 5 }, () => Array(5).fill(true));
  s.score = 100;
  const f = finalScore(s);
  assert.deepEqual([f.rows, f.cols, f.colors, f.total], [10, 35, 50, 195]);
});

test('colour bonus counts a colour with all 5 placed', () => {
  const s = fresh();
  for (let r = 0; r < 5; r++) s.wall[r][wallCol(r, 3)] = true;
  const f = finalScore(s);
  assert.equal(f.colorsDone, 1);
  assert.equal(f.colors, 10);
  assert.equal(f.rowsDone, 0);
});

test('bag refills from kiln shelf when empty; conservation holds', () => {
  const s = fresh();
  s.dishes = [[], [], [], [], []];
  s.bag = [];
  s.kiln = [20, 20, 20, 20, 0]; // 80 on the shelf, 20 elsewhere (padded below)
  s.rivalTiles = 20;
  assert.equal(countTiles(s), TOTAL_TILES);
  const d = dealRound(s);
  assert.equal(countTiles(d), TOTAL_TILES);
  assert.equal(d.bag.length, 60);
  assert.deepEqual(d.kiln, [0, 0, 0, 0, 0]);
  assert.ok(d.dishes.every((x) => x.length === 4));
  assert.ok(d.dishes.flat().every((c) => c < 4));
  assert.deepEqual(dealRound(s), d); // refill shuffle is deterministic
});

test('dealRound with a short supply fills what it can; none left ends the game', () => {
  const s = fresh();
  s.bag = [1, 2, 3]; s.kiln = [0, 0, 0, 0, 0]; s.dishes = [[], [], [], [], []];
  const d = dealRound(s);
  assert.deepEqual(d.dishes.map((x) => x.length), [3, 0, 0, 0, 0]);
  assert.equal(d.over, false);
  const e = dealRound({ ...d, bag: [], dishes: [[], [], [], [], []] });
  assert.equal(e.over, true);
});

test('rival: most tiles of one colour, ties go left, rest slide to centre', () => {
  const s = setup([[0, 1, 2, 3], [4, 4, 1, 1], [2, 2, 2, 0], [3, 3, 3, 3]]);
  assert.deepEqual(rivalChoice(s), { dish: 3, color: 3, tiles: 4 });
  const s2 = setup([[0, 1, 2, 3], [4, 4, 1, 1], [2, 2, 0, 0]]);
  const r = rivalTurn(s2);
  assert.equal(r.dish, 1); assert.equal(r.color, 1); assert.equal(r.tiles, 2); // lower colour first within a dish
  assert.deepEqual(r.state.center, [4, 4]);
  assert.equal(r.state.rivalTiles, 2);
  assert.equal(countTiles(r.state), TOTAL_TILES);
});

test('rival is deterministic and does nothing when off or dishes empty', () => {
  const a = fresh(11), b = fresh(11);
  assert.deepEqual(rivalTurn(a), rivalTurn(b));
  const off = fresh(11, { rival: false });
  const r = rivalTurn(off);
  assert.equal(r.dish, -1);
  assert.deepEqual(r.state, off);
  const empty = setup([]);
  assert.equal(rivalTurn(empty).dish, -1);
});

test('full scripted games conserve tiles and finish', () => {
  for (const seed of [1, 2, 3, 4, 5, 99]) {
    for (const rival of [true, false]) {
      let s = newGame(seed, { rival });
      let guard = 0;
      while (!s.over && guard++ < 400) {
        // greedy: pick first non-empty source/colour, first legal line else seconds
        let moved = false;
        const srcs = [...s.dishes.map((_, i) => ['dish', i]), ['center', 0]];
        for (const [source, index] of srcs) {
          const tiles = source === 'center' ? s.center : s.dishes[index];
          if (!tiles.length) continue;
          const color = tiles[0];
          const lines = legalLines(s, color);
          const r = take(s, { source, index, color, line: lines.length ? lines[lines.length - 1] : -1 });
          assert.ok(r.ok);
          s = r.state; moved = true;
          assert.equal(countTiles(s), TOTAL_TILES);
          s = rivalTurn(s).state;
          assert.equal(countTiles(s), TOTAL_TILES);
          break;
        }
        assert.ok(moved || roundOver(s));
        if (roundOver(s)) {
          const e = endRound(s);
          assert.equal(countTiles(e.state), TOTAL_TILES);
          s = e.gameOver ? e.state : dealRound(e.state);
          assert.equal(countTiles(s), TOTAL_TILES);
        }
      }
      assert.ok(s.over, `seed ${seed} rival ${rival} finished`);
      assert.ok(finalScore(s).total >= s.score);
    }
  }
});

test('finish the round: once the dishes are empty, the middle can go to the seconds basket', async () => {
  const R = await import('../tiles/rules.js');
  let s = R.newGame(11, { rival: false });
  assert.equal(R.sweepMiddle(s).ok, false, 'not while dishes still hold tiles');
  s = { ...s, dishes: s.dishes.map(() => []), center: [0, 0, 2, 4] };
  const before = s.seconds.length;
  const r = R.sweepMiddle(s);
  assert.equal(r.ok, true);
  assert.equal(r.count, 4);
  assert.equal(r.state.seconds.length, before + 4);
  assert.equal(R.roundOver(r.state), true);
  assert.equal(R.sweepMiddle(r.state).ok, false, 'nothing left to sweep');
});
