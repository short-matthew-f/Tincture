// The Tile Room: rules (ported from proto/test/tiles-rules.test.js and extended),
// the sim turn flow, glazes, coins, hooks, the save round trip and Renovate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, take, legalLines, rivalTurn, rivalChoice, endRound, dealRound, finalScore, sweepMiddle,
  countTiles, placementScore, roundOver, wallColor, wallCol, isValidGame, TOTAL_TILES, BONUS,
} from '../src/puzzles/tiles.js';
import * as T from '../src/sim/tiles.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { colorFamily } from '../src/sim/economy.js';
import { orderBasePay } from '../src/sim/orders.js';

const NOW = Date.UTC(2026, 9, 18, 9);
const emptyWall = () => Array.from({ length: 5 }, () => Array(5).fill(false));
const fresh = (seed = 7, o) => newGame(seed, o);
// After hand-editing a game, pad/trim the bag so the total is 100 again.
function balance(s) {
  while (countTiles(s) > TOTAL_TILES) s.bag.pop();
  while (countTiles(s) < TOTAL_TILES) s.bag.push(0);
  return s;
}
function setup(dishes, center = []) {
  const s = fresh();
  for (const d of s.dishes) s.bag.push(...d);
  s.dishes = dishes.map((d) => d.slice());
  while (s.dishes.length < 5) s.dishes.push([]);
  for (const t of s.dishes.flat()) s.bag.splice(s.bag.indexOf(t), 1);
  s.center = center.slice();
  for (const t of center) s.bag.splice(s.bag.indexOf(t), 1);
  assert.equal(countTiles(s), TOTAL_TILES);
  return s;
}

// --- rules (ported) -----------------------------------------------------------

test('new game: 100 tiles, 5 full dishes, round 1; same seed same bag', () => {
  const s = fresh();
  assert.equal(countTiles(s), TOTAL_TILES);
  assert.equal(s.round, 1);
  assert.ok(s.dishes.every((d) => d.length === 4));
  assert.equal(s.bag.length, 80);
  assert.equal(s.score, 0);
  assert.ok(isValidGame(s));
  assert.deepEqual(fresh(5), fresh(5));
  assert.notDeepEqual(fresh(5).dishes, fresh(6).dishes);
  assert.deepEqual(newGame(9, { colors: ['a', 'b', 'c', 'd', 'e'] }).colors, ['a', 'b', 'c', 'd', 'e']);
});

test('wall layout is a shifted Latin square', () => {
  for (let r = 0; r < 5; r++) {
    const seen = new Set();
    for (let c = 0; c < 5; c++) { seen.add(wallColor(r, c)); assert.equal(wallCol(r, wallColor(r, c)), c); }
    assert.equal(seen.size, 5);
  }
  assert.equal(wallColor(1, 0), 4);
  assert.equal(wallColor(1, 1), 0);
});

test('legalLines: empty lines legal, mixed colour and set-in-wall blocked', () => {
  const s = fresh();
  assert.deepEqual(legalLines(s, 0), [0, 1, 2, 3, 4]);
  s.lines[2] = { color: 1, n: 1 };
  assert.deepEqual(legalLines(s, 0), [0, 1, 3, 4]);
  s.lines[0] = { color: 1, n: 1 };
  assert.deepEqual(legalLines(s, 1), [1, 2, 3, 4]);
  s.wall[3][wallCol(3, 4)] = true;
  assert.ok(!legalLines(s, 4).includes(3));
});

test('take from a dish: all of a colour, rest slide to the middle, overflow to seconds; input untouched', () => {
  const s = setup([[0, 0, 1, 2]]);
  const r = take(s, { source: 'dish', index: 0, color: 0, line: 0 });
  assert.ok(r.ok);
  assert.deepEqual(r.moved, { source: 'dish', index: 0, color: 0, count: 2, line: 0, placed: 1, overflow: 1, slid: 2 });
  assert.deepEqual(r.state.seconds, [0]);
  assert.deepEqual(r.state.center, [1, 2]);
  assert.equal(countTiles(r.state), TOTAL_TILES);
  assert.deepEqual(s.center, []);
  const c = take(setup([], [1, 1, 3, 3, 3]), { source: 'center', color: 3, line: 3 });
  assert.deepEqual(c.state.center, [1, 1]);
  assert.deepEqual(c.state.lines[3], { color: 3, n: 3 });
});

test('take rejects illegal moves; the seconds basket is always legal', () => {
  const s = setup([[0, 0, 1, 2]]);
  assert.equal(take(s, { source: 'dish', index: 0, color: 4, line: 0 }).ok, false);
  assert.equal(take(s, { source: 'dish', index: 1, color: 0, line: 0 }).ok, false);
  s.lines[1] = { color: 2, n: 1 };
  assert.equal(take(s, { source: 'dish', index: 0, color: 0, line: 1 }).reason, 'illegal');
  const r = take(s, { source: 'dish', index: 0, color: 0, line: -1 });
  assert.deepEqual(r.state.seconds, [0, 0]);
  assert.equal(take({ ...s, over: true }, { source: 'dish', index: 0, color: 0, line: -1 }).reason, 'over');
});

test('scoring examples: alone 1, runs count, a joined row and column add both', () => {
  const w = emptyWall();
  w[0][0] = true;
  assert.equal(placementScore(w, 2, 2), 1);
  w[0][1] = true;
  assert.equal(placementScore(w, 0, 1), 2);
  const w3 = emptyWall();
  w3[2][0] = w3[2][1] = true;
  w3[3][2] = w3[4][2] = true;
  w3[2][2] = true;
  assert.equal(placementScore(w3, 2, 2), 3 + 3);
  const w5 = emptyWall(); w5[2][2] = true; w5[4][4] = true;
  assert.equal(placementScore(w5, 3, 3), 1, 'diagonals and gaps do not count');
  const full = emptyWall().map((r) => r.map(() => true));
  assert.equal(placementScore(full, 2, 2), 10, 'a full cross scores 5 + 5');
});

test('endRound: full lines set in row order and chain, rest to the kiln, seconds +1 each', () => {
  const s = fresh();
  s.lines[0] = { color: 2, n: 1 };
  s.lines[2] = { color: 0, n: 3 };
  s.lines[3] = { color: 1, n: 2 };
  s.seconds = [4, 4];
  s.dishes = [[], [], [], [], []];
  balance(s);
  const r = endRound(s);
  assert.equal(countTiles(r.state), TOTAL_TILES);
  assert.deepEqual(r.placements.map((p) => [p.row, p.col, p.color, p.points]), [[0, wallCol(0, 2), 2, 1], [2, wallCol(2, 0), 0, 1]]);
  assert.equal(r.state.score, 4);
  assert.equal(r.state.kiln[0], 2);
  assert.equal(r.state.kiln[4], 2);
  assert.deepEqual(r.state.lines[3], { color: 1, n: 2 });
  const c = fresh();
  c.wall[0][0] = true;
  c.lines[1] = { color: 0, n: 2 };
  c.lines[0] = { color: 1, n: 1 };
  balance(c);
  assert.deepEqual(endRound(c).placements.map((p) => p.points), [2, 2]);
});

test('the wall ends after a row completes; bonuses rows x2, cols x7, colours x10', () => {
  const s = fresh();
  for (let c = 0; c < 4; c++) s.wall[0][c] = true;
  s.score = 10;
  s.lines[0] = { color: wallColor(0, 4), n: 1 };
  balance(s);
  const r = endRound(s);
  assert.equal(r.gameOver, true);
  assert.equal(r.placements[0].points, 5);
  assert.equal(finalScore(r.state).total, r.state.score + BONUS.row);
  const f = fresh();
  f.wall = Array.from({ length: 5 }, () => Array(5).fill(true));
  f.score = 100;
  const fs = finalScore(f);
  assert.deepEqual([fs.rows, fs.cols, fs.colors, fs.total], [10, 35, 50, 195]);
  const k = fresh();
  for (let r2 = 0; r2 < 5; r2++) k.wall[r2][wallCol(r2, 3)] = true;
  assert.equal(finalScore(k).colorsDone, 1);
});

test('the bag refills from the kiln shelf; a bare shelf ends the wall', () => {
  const s = fresh();
  s.dishes = [[], [], [], [], []];
  s.bag = [];
  s.kiln = [20, 20, 20, 20, 0];
  s.rivalTiles = 20;
  const d = dealRound(s);
  assert.equal(countTiles(d), TOTAL_TILES);
  assert.equal(d.bag.length, 60);
  assert.deepEqual(dealRound(s), d, 'refill shuffle is deterministic');
  const e = dealRound({ ...fresh(), bag: [], kiln: [0, 0, 0, 0, 0], dishes: [[], [], [], [], []], rivalTiles: 80 });
  assert.equal(e.over, true);
  assert.equal(e.exhausted, true);
});

test('Ida: most of one colour on a dish, ties left then lower colour; rests when off', () => {
  const s = setup([[0, 1, 2, 3], [4, 4, 1, 1], [2, 2, 2, 0], [3, 3, 3, 3]]);
  assert.deepEqual(rivalChoice(s), { dish: 3, color: 3, tiles: 4 });
  const r = rivalTurn(setup([[0, 1, 2, 3], [4, 4, 1, 1], [2, 2, 0, 0]]));
  assert.deepEqual([r.dish, r.color, r.tiles], [1, 1, 2]);
  assert.deepEqual(r.state.center, [4, 4]);
  assert.equal(countTiles(r.state), TOTAL_TILES);
  const off = fresh(11, { rival: false });
  assert.equal(rivalTurn(off).dish, -1);
  assert.deepEqual(rivalTurn(off).state, off);
});

test('sweepMiddle: only once the dishes are empty', () => {
  let s = fresh(11, { rival: false });
  assert.equal(sweepMiddle(s).ok, false);
  s = { ...s, dishes: s.dishes.map(() => []), center: [0, 0, 2, 4], bag: s.bag.concat([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]).slice(4) };
  const r = sweepMiddle(s);
  assert.equal(r.count, 4);
  assert.equal(roundOver(r.state), true);
  assert.equal(sweepMiddle(r.state).ok, false);
});

test('isValidGame rejects a game whose tiles do not add up or whose shape is off', () => {
  const g = fresh();
  assert.ok(isValidGame(g));
  assert.equal(isValidGame({ ...g, bag: g.bag.slice(1) }), false);
  assert.equal(isValidGame({ ...g, dishes: g.dishes.slice(1) }), false);
  assert.equal(isValidGame({ ...g, v: 99 }), false);
  assert.equal(isValidGame(null), false);
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
function opened(n = 20, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 6000;
  assert.equal(sim.unlocks.buy(s, { id: 'tiles' }, NOW).ok, true);
  s._events = [];
  return s;
}

/** One greedy turn through the sim (first source, first colour, the lowest-row legal line else seconds). */
function playTurn(s) {
  const g = s.tiles.game;
  const srcs = [...g.dishes.map((_, i) => ['dish', i]), ['center', 0]];
  for (const [source, index] of srcs) {
    const tiles = source === 'center' ? g.center : g.dishes[index];
    if (!tiles.length) continue;
    const color = tiles[0];
    const lines = legalLines(g, color);
    const r = T.take(s, { source, index, color, line: lines.length ? lines[lines.length - 1] : -1 }, NOW);
    assert.ok(r.ok, JSON.stringify(r));
    return true;
  }
  return false;
}
/** Plays the whole bar flow until the wall is finished; returns turns taken. */
function playWall(s) {
  let turns = 0;
  for (let guard = 0; guard < 600; guard++) {
    const ph = T.phase(s);
    if (ph === 'over') return turns;
    if (ph === 'play') { assert.ok(playTurn(s)); turns++; } else if (ph === 'pending') {
      if (!roundOver(s.tiles.game)) T.idaTurn(s);
      else assert.ok(T.scoreRound(s, {}, NOW).ok);
    } else if (ph === 'deal') assert.ok(T.deal(s, {}, NOW).ok);
    assert.equal(countTiles(s.tiles.game), TOTAL_TILES);
  }
  throw new Error('wall did not finish');
}

test('unlock: 20 colors, 5,000 coins; a wall needs it; Next names it', () => {
  const s = withColors(19);
  s.coins = 6000;
  const st = sim.unlocks.status(s, 'tiles');
  assert.deepEqual([st.cost, st.revealColors, st.revealed], [5000, 20, false]);
  assert.equal(T.startWall(s, {}, NOW).reason, 'locked');
  const t = withColors(20);
  t.coins = 5000;
  assert.equal(sim.unlocks.status(t, 'tiles').canBuy, true);
  t.unlocks.shelf = t.unlocks.hunters = t.unlocks.skeins = t.unlocks.lift = true; // already bought: Next points at the Tile Room
  t.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'ochre'][i % 2]; });
  assert.match(sim.next(t, NOW).label, /^Open the Tile Room for 5/);
  assert.equal(sim.unlocks.buy(t, { id: 'tiles' }, NOW).ok, true);
  assert.equal(t.coins, 0);
  assert.equal(T.unlocked(t), true);
});

test('glazes: five discovered colors from five families; shelf chips first; picker checks', () => {
  const s = opened(20);
  const g = T.defaultGlazes(s);
  assert.equal(g.length, 5);
  assert.equal(new Set(g.map(colorFamily)).size, 5);
  assert.ok(g.every((id) => s.catalog.discovered[id]));
  const chip = Object.keys(s.catalog.discovered).find((id) => colorFamily(id) === colorFamily(g[1]) && id !== g[1]) || g[1];
  s.shelf.colors = [chip];
  assert.equal(T.defaultGlazes(s)[0], chip, 'her Merge Shelf chip leads');
  assert.equal(T.checkGlazes(s, g).ok, true);
  assert.equal(T.checkGlazes(s, g.slice(0, 4)).reason, 'count');
  assert.equal(T.checkGlazes(s, [...g.slice(0, 4), g[0]]).reason, 'count');
  const undiscovered = CATALOG.find((c) => !s.catalog.discovered[c.id]).id;
  assert.equal(T.checkGlazes(s, [...g.slice(0, 4), undiscovered]).reason, 'discovered');
  const sameFam = Object.keys(s.catalog.discovered).find((id) => colorFamily(id) === colorFamily(g[0]) && id !== g[0]);
  if (sameFam) assert.equal(T.checkGlazes(s, [sameFam, ...g.slice(1, 4), g[0]]).reason, 'family');
  assert.equal(T.setGlazes(s, { colors: g }).ok, true);
  assert.deepEqual(T.nextGlazes(s), g);
  const w = T.startWall(s, {}, NOW);
  assert.deepEqual(w.colors, g);
  assert.deepEqual(s.tiles.game.colors, g);
  // Three colors only (no Tile Room yet, but the default never breaks): five distinct ids.
  assert.equal(new Set(T.defaultGlazes(createInitialState(NOW, 1))).size, 5);
});

test('a whole wall through the sim, Ida on and off: tiles conserved, coins paid, mosaic recorded, hooks emitted', () => {
  for (const rival of [true, false]) {
    for (const seed of [1, 2, 3]) {
      const s = opened(20, seed);
      s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; }); // a workshop that earns
      s.coins = 0;
      assert.ok(T.startWall(s, { rival }, NOW).ok);
      assert.equal(s.tiles.game.rival, rival);
      const turns = playWall(s);
      const t = s.tiles;
      assert.equal(t.game.over, true);
      assert.equal(t.walls, 1);
      assert.equal(t.mosaics.length, 1);
      const m = t.mosaics[0];
      const fs = finalScore(t.game);
      assert.equal(m.score, fs.total);
      assert.equal(t.best, fs.total);
      assert.equal(m.wall.length, 25);
      assert.equal(m.rival, rival);
      assert.ok(s.coins > 0 && Math.abs(s.coins - t.paid) < 1e-6, 'every coin went through pay()');
      const types = s._events.map((e) => e.type);
      assert.ok(types.includes('tilesWall'));
      assert.ok(types.includes('tilesRound'));
      assert.equal(types.filter((x) => x === 'mosaicFinished').length, 1);
      // Modest: ten of her turns (a minute or more of play) earn less than one hand order (30-60 s).
      assert.ok(s.coins / turns < 0.1 * orderBasePay(s, 3), `seed ${seed}: ${s.coins} over ${turns} turns`);
      // Nothing more to do but start again.
      assert.equal(T.take(s, { source: 'dish', index: 0, color: 0, line: -1 }, NOW).reason, 'over');
      assert.equal(T.deal(s, {}, NOW).ok, false);
    }
  }
});

test('coins follow her income: points x POINT_MINUTES of an order, plus a wall bonus', () => {
  const s = opened(20);
  const q = T.quote(s, NOW);
  assert.ok(Math.abs(q.perPoint - orderBasePay(s, 1) * T.POINT_MINUTES * sim.incomeMultiplier(s, NOW)) < 1e-9);
  assert.ok(Math.abs(q.wallBonus - orderBasePay(s, T.WALL_MINUTES) * sim.incomeMultiplier(s, NOW)) < 1e-9);
  // A richer workshop pays more per point.
  const rich = opened(20);
  rich.stations.sources.madder.level = 60;
  rich.stations.shop.level = 60;
  sim.tick(rich, NOW + 1000);
  assert.ok(T.quote(rich, NOW + 1000).perPoint >= q.perPoint);
});

test('turn flow: take -> Ida -> score -> deal; undo until Ida moves; Ida resting skips her turn', () => {
  const s = opened(20);
  T.startWall(s, { rival: true }, NOW);
  assert.equal(T.phase(s), 'play');
  const before = JSON.stringify(s.tiles.game);
  assert.ok(playTurn(s));
  assert.equal(T.phase(s), 'pending');
  assert.equal(T.take(s, { source: 'center', color: 0, line: -1 }, NOW).reason, 'pending');
  assert.ok(T.undo(s).ok);
  assert.equal(JSON.stringify(s.tiles.game), before);
  assert.equal(T.phase(s), 'play');
  assert.ok(playTurn(s));
  const ida = T.idaTurn(s);
  assert.ok(ida.ok && ida.dish >= 0);
  assert.equal(T.undo(s).ok, false, 'Undo closes once Ida moves');
  assert.ok(T.setRival(s, { on: false }).ok);
  assert.ok(playTurn(s));
  assert.equal(T.phase(s), 'play', 'no Ida turn while she rests');
  assert.equal(s.tiles.settings.rival, false);
  assert.equal(s.tiles.game.rival, false);
});

test('Finish the round: the middle goes to seconds and the scoring is owed', () => {
  const s = opened(20);
  T.startWall(s, { rival: false }, NOW);
  const g = s.tiles.game;
  // Move every dish tile into the middle (as if the dishes had been drafted).
  g.center = g.center.concat(...g.dishes).sort((a, b) => a - b);
  g.dishes = g.dishes.map(() => []);
  assert.ok(isValidGame(g));
  const n = g.center.length;
  const r = T.sweep(s);
  assert.deepEqual(r, { ok: true, count: n });
  assert.equal(T.phase(s), 'pending');
  const sc = T.scoreRound(s, {}, NOW);
  assert.equal(sc.points, n);
  assert.equal(T.phase(s), 'deal');
  assert.equal(T.scoreRound(s, {}, NOW).ok, false, 'never scored twice');
  assert.ok(T.deal(s, {}, NOW).ok);
  assert.equal(s.tiles.game.round, 2);
});

test('save round trip mid-turn: reload resumes exactly (pending Ida turn, undo, deal step)', () => {
  const s = opened(20);
  T.startWall(s, { rival: true }, NOW);
  playTurn(s);
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.tiles, s.tiles);
  assert.equal(T.phase(back), 'pending');
  // Both continue identically (the bag's seed is in the game).
  T.idaTurn(s); T.idaTurn(back);
  assert.deepEqual(back.tiles.game, s.tiles.game);
  // Round over and scored: the deal step survives a reload too.
  for (let i = 0; i < 200 && T.phase(s) !== 'deal' && T.phase(s) !== 'over'; i++) {
    const ph = T.phase(s);
    if (ph === 'play') playTurn(s);
    else if (!roundOver(s.tiles.game)) T.idaTurn(s);
    else T.scoreRound(s, {}, NOW);
  }
  const b2 = deserialize(serialize(s, NOW), NOW);
  assert.equal(T.phase(b2), T.phase(s));
  assert.deepEqual(b2.tiles, s.tiles);
});

test('a 0.2.x save (v3, no tiles) loads with the Tile Room closed and a fresh shelf', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.tiles;
  delete obj.state.unlocks.tiles;
  obj.v = 3; obj.state.v = 3;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.tiles, false);
  assert.deepEqual(back.tiles, T.initialTiles());
  // A broken saved game is dropped, never locks the room.
  const bad = createInitialState(NOW, 4);
  bad.tiles.game = { v: 1, bag: [1, 2] };
  bad.tiles.pending = true;
  T.ensureTiles(bad);
  assert.equal(bad.tiles.game, null);
  assert.equal(bad.tiles.pending, false);
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.tiles = { settings: 'x' };
  const o = deserialize(JSON.stringify(odd), NOW);
  assert.deepEqual(o.tiles.settings, { rival: true });
  assert.deepEqual(o.tiles.mosaics, []);
});

test('Renovate closes the Tile Room (mosaics and the wall stay); Keep the Kiln holds it open', () => {
  const s = opened(30);
  T.startWall(s, {}, NOW);
  playWall(s);
  T.startWall(s, {}, NOW);
  playTurn(s);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('tiles'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.tiles, false);
  assert.ok(s.renovateReopen.includes('tiles'));
  assert.equal(s.tiles.mosaics.length, 1);
  assert.ok(s.tiles.game && !s.tiles.game.over, 'the wall in progress waits for her');
  const k = opened(30);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-kiln' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('tiles'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.tiles, true);
});

test('the summary read for the Puzzles hub', () => {
  const s = opened(20);
  assert.deepEqual(T.summary(s), { open: true, playing: false, round: 0, score: 0, placed: 0, walls: 0, best: 0, phase: 'none' });
  T.startWall(s, {}, NOW);
  assert.equal(T.summary(s).playing, true);
  assert.equal(T.summary(s).round, 1);
});
