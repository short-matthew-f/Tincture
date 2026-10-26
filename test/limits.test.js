// Responsibility mode (src/sim/limits.js): the pure rules, and every subgame's
// sim entry point recording a play (and resuming never doing so).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/sim/limits.js';
import * as sim from '../src/sim/index.js';
import * as puzzles from '../src/puzzles/index.js';
import { createInitialState, serialize, deserialize } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { createGradingBoard, createPurifyPuzzle } from '../src/ui/puzzles.js';

const NOW = Date.UTC(2026, 9, 26, 15);
const MIN = 60e3;

function withColors(n = 40, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  for (const id of Object.keys(s.unlocks)) s.unlocks[id] = true;
  s._events = [];
  return s;
}

// --- the rules -------------------------------------------------------------------

test('limits: defaults are on, 5 plays within an hour, for new and old saves', () => {
  const s = createInitialState(NOW, 1);
  assert.deepEqual([s.settings.responsibleMode, s.settings.playLimit, s.settings.playWindowMin], [true, 5, 60]);
  assert.deepEqual(s.plays, {});
  const old = JSON.parse(serialize(s, NOW));
  delete old.state.settings.responsibleMode;
  delete old.state.settings.playLimit;
  delete old.state.settings.playWindowMin;
  delete old.state.plays;
  const back = deserialize(JSON.stringify(old), NOW);
  assert.deepEqual([back.settings.responsibleMode, back.settings.playLimit, back.settings.playWindowMin], [true, 5, 60]);
  assert.deepEqual(back.plays, {});
  assert.deepEqual(L.config(back), { on: true, limit: 5, windowMin: 60, windowMs: 60 * MIN });
  // Settings are validated: only the offered choices stick.
  assert.equal(sim.setSetting(back, { key: 'playLimit', value: 8 }).ok, true);
  assert.equal(sim.setSetting(back, { key: 'playLimit', value: 7 }).ok, false);
  assert.equal(sim.setSetting(back, { key: 'playWindowMin', value: 120 }).ok, true);
  assert.equal(sim.setSetting(back, { key: 'responsibleMode', value: false }).ok, true);
  assert.deepEqual(L.config(back), { on: false, limit: 8, windowMin: 120, windowMs: 120 * MIN });
});

test('limits: the count, playsLeft, canStart and readyAt', () => {
  const s = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) {
    assert.equal(L.canStart(s, 'hoop', NOW + i * MIN), true);
    assert.equal(L.playsLeft(s, 'hoop', NOW + i * MIN), 5 - i);
    assert.equal(L.recordStart(s, 'hoop', NOW + i * MIN).counted, true);
  }
  const t = NOW + 10 * MIN;
  assert.equal(L.playsLeft(s, 'hoop', t), 0);
  assert.equal(L.canStart(s, 'hoop', t), false);
  assert.equal(L.readyAt(s, 'hoop', t), NOW + 60 * MIN, 'the oldest play ages out an hour after it began');
  const st = L.status(s, 'hoop', t);
  assert.equal(st.resting, true);
  assert.equal(st.used, 5);
  assert.deepEqual(L.gate(s, 'hoop', t), { ok: false, reason: 'resting', game: 'hoop', readyAt: NOW + 60 * MIN, limit: 5, windowMin: 60 });
  assert.equal(s.plays.hoop.length, 5, 'a refused start records nothing');
  // Before any play: no readyAt.
  assert.equal(L.readyAt(s, 'tiles', t), null);
});

test('limits: the window prunes old plays; the moment the oldest ages out, one more is free', () => {
  const s = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) L.recordStart(s, 'tiles', NOW + i * 5 * MIN);
  const ready = L.readyAt(s, 'tiles', NOW + 30 * MIN);
  assert.equal(ready, NOW + 60 * MIN);
  assert.equal(L.canStart(s, 'tiles', ready - 1), false);
  assert.equal(L.canStart(s, 'tiles', ready), true);
  assert.equal(L.playsLeft(s, 'tiles', ready), 1);
  L.recordStart(s, 'tiles', ready);
  assert.equal(s.plays.tiles.length, 5, 'recording prunes the play that aged out');
  assert.equal(L.canStart(s, 'tiles', ready + 1), false);
  // A shorter window: 30 minutes.
  sim.setSetting(s, { key: 'playWindowMin', value: 30 });
  assert.equal(L.canStart(s, 'tiles', ready + 1), true, 'only the plays in the last half hour count');
  L.prune(s, NOW + 10 * 60 * MIN);
  assert.equal(s.plays.tiles, undefined, 'a game with no plays left in the window is dropped');
});

test('limits: a lower limit than plays already made waits until enough age out', () => {
  const s = createInitialState(NOW, 1);
  sim.setSetting(s, { key: 'playLimit', value: 10 });
  for (let i = 0; i < 6; i++) L.recordStart(s, 'lift', NOW + i * MIN);
  sim.setSetting(s, { key: 'playLimit', value: 3 });
  const t = NOW + 10 * MIN;
  assert.equal(L.playsLeft(s, 'lift', t), 0);
  assert.equal(L.readyAt(s, 'lift', t), NOW + 3 * MIN + 60 * MIN, 'four must age out to be under three');
  assert.equal(L.canStart(s, 'lift', NOW + 63 * MIN), true);
});

test('limits: turning the mode off lifts every limit at once; turning it on keeps the plays', () => {
  const s = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) L.recordStart(s, 'garden', NOW + i);
  assert.equal(L.canStart(s, 'garden', NOW + 10), false);
  sim.setSetting(s, { key: 'responsibleMode', value: false });
  assert.equal(L.canStart(s, 'garden', NOW + 10), true);
  assert.equal(L.playsLeft(s, 'garden', NOW + 10), Infinity);
  assert.equal(L.readyAt(s, 'garden', NOW + 10), null);
  assert.equal(L.status(s, 'garden', NOW + 10).resting, false);
  assert.deepEqual(L.startPlay(s, { game: 'garden' }, NOW + 11), { ok: true, counted: false });
  assert.equal(s.plays.garden.length, 5, 'plays made with the mode off are not kept; the earlier ones are');
  sim.setSetting(s, { key: 'responsibleMode', value: true });
  assert.equal(L.canStart(s, 'garden', NOW + 12), false, 'back on: the same five plays count again');
});

test('limits: clock skew drops plays from the future; shiftClock moves plays with the clocks', () => {
  const s = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) L.recordStart(s, 'skeins', NOW + i * MIN);
  // The device clock went back two hours: those plays are "in the future" now and drop out.
  const back = NOW - 2 * 60 * MIN;
  assert.equal(L.canStart(s, 'skeins', back), true);
  assert.equal(L.playsLeft(s, 'skeins', back), 5);
  L.recordStart(s, 'skeins', back);
  assert.deepEqual(s.plays.skeins, [back]);
  // Time passing (offline.shiftClock, as debug.advance does): an hour later they are free.
  const t = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) L.recordStart(t, 'hoop', NOW);
  assert.equal(L.canStart(t, 'hoop', NOW), false);
  sim.shiftClock(t, 60 * MIN);
  assert.equal(L.canStart(t, 'hoop', NOW), true);
});

test('limits: each game counts separately; junk in the save never breaks it', () => {
  const s = createInitialState(NOW, 1);
  for (let i = 0; i < 5; i++) L.recordStart(s, 'grading', NOW);
  for (const id of L.LIMIT_GAMES) assert.equal(L.canStart(s, id, NOW), id !== 'grading', id);
  assert.equal(L.recordStart(s, 'workshop', NOW).ok, false, 'only the subgames are limited');
  s.plays = { hoop: ['x', null, NaN, NOW], tiles: 'nope' };
  assert.equal(L.playsLeft(s, 'hoop', NOW), 4);
  assert.equal(L.playsLeft(s, 'tiles', NOW), 5);
  L.prune(s, NOW);
  assert.deepEqual(s.plays, { hoop: [NOW] });
  s.plays = null;
  assert.equal(L.canStart(s, 'hoop', NOW), true);
  L.recordStart(s, 'hoop', NOW);
  assert.deepEqual(s.plays, { hoop: [NOW] });
});

// --- every subgame's sim entry point -------------------------------------------------

const used = (s, id) => L.playsIn(s, id, NOW + 59 * MIN).length;

test('limits: the Hoop, the Tangle Basket — new plays count, resuming and Start over never do', () => {
  for (const [id, S, start, open] of [['hoop', sim.hoop, 'startHoop', 'openHoop'], ['tangle', sim.tangle, 'startBasket', 'openBasket']]) {
    const s = withColors();
    const first = S.LEVEL_IDS[0];
    assert.equal(S[open](s, {}, NOW).ok, true);
    assert.equal(used(s, id), 1, `${id}: the first open deals a fresh one`);
    assert.equal(S[open](s, {}, NOW).ok, true);
    assert.equal(S[start](s, { levelId: first }, NOW).resumed, true);
    assert.equal(S[start](s, { levelId: first, fresh: true }, NOW).ok, true, 'Start over');
    assert.equal(S.restart(s, {}, NOW).ok, true);
    assert.equal(used(s, id), 1, `${id}: resume, reopen and Start over never count`);
    for (let i = 2; i <= 5; i++) {
      s[id].done[first] = 1; s[id].game.paid = true; // finished: "again" is a new play
      assert.equal(S[start](s, { levelId: first, fresh: true }, NOW + i).ok, true);
      assert.equal(used(s, id), i);
    }
    s[id].game.paid = true;
    const r = S[start](s, { levelId: first, fresh: true }, NOW + 9);
    assert.equal(r.reason, 'resting', `${id}: a sixth play rests`);
    assert.equal(r.readyAt, NOW + 60 * MIN);
    assert.equal(s[id].game.paid, true, 'the finished one stays on the table');
    s[id].game.paid = false;
    assert.equal(S[start](s, { levelId: first, fresh: true }, NOW + 9).ok, true, `${id}: mid-play she finishes (Start over is never blocked)`);
  }
});

test('limits: the Lifting Table, the Winding Room and the Tile Room', () => {
  const s = withColors();
  const lift = sim.lift;
  assert.equal(lift.openEasel(s, {}, NOW).ok, true);
  assert.equal(lift.openEasel(s, {}, NOW).ok, true);
  assert.equal(lift.restart(s, {}, NOW).ok, true, 'Start this painting over');
  assert.equal(used(s, 'lift'), 1);
  s.lift.game.paid = true;
  assert.equal(lift.startPainting(s, { levelId: s.lift.cur }, NOW).ok, true, 'lift it again');
  assert.equal(used(s, 'lift'), 2);

  const k = sim.skeins;
  assert.equal(k.ensureLevel(s, {}, NOW).ok, true);
  assert.equal(used(s, 'skeins'), 1);
  assert.equal(k.startLevel(s, { level: 0 }, NOW).resumed, true);
  assert.equal(k.startLevel(s, { level: 0, fresh: true }, NOW).ok, true, 'Start this level over');
  assert.equal(used(s, 'skeins'), 1);
  s.skeins.sess.state.done = true;
  assert.equal(k.startLevel(s, { level: 0, fresh: true }, NOW).ok, true, 'Play this level again');
  assert.equal(used(s, 'skeins'), 2);

  const T = sim.tiles;
  assert.equal(T.startWall(s, {}, NOW).ok, true);
  assert.equal(T.startWall(s, {}, NOW).ok, true, 'Start over with these: the wall under way');
  assert.equal(used(s, 'tiles'), 1);
  s.tiles.game = { ...s.tiles.game, over: true };
  assert.equal(T.startWall(s, {}, NOW).ok, true, 'a new wall');
  assert.equal(used(s, 'tiles'), 2);
});

test('limits: the Dye Garden, grading boards and Purify', () => {
  const s = withColors();
  for (let i = 0; i < 5; i++) assert.equal(sim.garden.beginVisit(s, { mode: i % 2 ? 'harvest' : 'path' }, NOW).ok, true);
  assert.equal(sim.garden.beginVisit(s, { mode: 'wander' }, NOW).reason, 'resting');

  const ctx = { sim, puzzles, content: { EVENTS: [] } };
  for (let i = 0; i < 5; i++) assert.ok(createGradingBoard(ctx, s, {}, NOW), `board ${i + 1}`);
  assert.equal(used(s, 'grading'), 5);
  const kept = s.activePuzzles.grading;
  assert.equal(createGradingBoard(ctx, s, {}, NOW), null, 'a sixth board rests');
  assert.equal(s.activePuzzles.grading, kept, 'and the board she has stays');

  s.muddyBatches = [1, 2].map((i) => ({ id: `m${i}`, color: 'orange', jars: 5, value: 1, at: NOW, tier: null }));
  assert.ok(createPurifyPuzzle(ctx, s, { batchId: 'm1' }, NOW));
  assert.ok(createPurifyPuzzle(ctx, s, { batchId: 'm1', tier: 'relaxed', murky: true }, NOW), 'this batch again (Murky on) is Start over');
  assert.equal(used(s, 'purify'), 1);
  assert.equal(L.inProgress(s, 'purify'), true);
  for (let i = 0; i < 4; i++) L.recordStart(s, 'purify', NOW);
  assert.equal(createPurifyPuzzle(ctx, s, { batchId: 'm2' }, NOW), null, 'a new batch rests');
  assert.ok(createPurifyPuzzle(ctx, s, { batchId: 'm1' }, NOW), 'the batch under way never rests');
});
