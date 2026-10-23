// The Lifting Table: the shipped data matches the playtested prototype, a few
// stored solutions replay with the shipped rules (proto/test/lift.test.js
// covers every painting), and the sim: unlock, moves, undo, the spare bench
// spot, the pay (coins and stock, capacity and keep respected, repeats), the
// hooks, the save round trip mid-painting, old saves, Renovate, the balance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/puzzles/lift.js';
import { LEVELS, LEVEL_IDS, PALETTE, MECHANICS, BANDS, levelById } from '../src/puzzles/lift-levels.js';
import { ART } from '../src/puzzles/lift-art.js';
import { QUEUES } from '../src/puzzles/lift-queues.js';
import * as P from '../proto/lift/levels.js';
import { QUEUES as PROTO_QUEUES } from '../proto/lift/queues.js';
import * as T from '../src/sim/lift.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { orderBasePay, PAY_MINUTES } from '../src/sim/orders.js';
import { capacity, stockTotal, stockOf } from '../src/sim/storage.js';

const NOW = Date.UTC(2026, 9, 23, 9);

// --- the data and the rules -------------------------------------------------------

test('27 paintings, the same as the prototype: art cell for cell, lanes, keys, solutions, signatures', () => {
  assert.equal(LEVELS.length, 27);
  assert.equal(P.LEVELS.length, LEVELS.length);
  LEVELS.forEach((L, i) => {
    const Q = P.LEVELS[i];
    assert.equal(L.id, Q.id);
    assert.deepEqual(L.cells, Q.cells, `${L.id} art`);
    assert.equal(L.sig, Q.sig, `${L.id} signature`);
    assert.equal(L.solution, Q.solution);
    assert.deepEqual(L.mechanics, Q.mechanics);
    assert.deepEqual([L.slots, L.bench, L.cover, L.locks], [Q.slots, Q.bench, Q.cover, Q.locks]);
  });
  assert.deepEqual(QUEUES, PROTO_QUEUES, 'lift-queues.js is a copy of proto/lift/queues.js');
  assert.deepEqual(PALETTE, P.PALETTE);
  assert.deepEqual(MECHANICS, P.MECHANICS);
  assert.deepEqual(BANDS, P.BANDS);
  for (const id of Object.keys(ART)) assert.ok(levelById(id), `${id}: shipped art belongs to a painting`);
  assert.deepEqual(LEVEL_IDS, LEVELS.map((L) => L.id));
  for (const L of LEVELS) assert.ok(R.capacitiesMatch(L), `${L.id}: jar capacity equals cell count per color`);
});

test('stored solutions replay to a clear picture with the shipped rules (a handful; proto covers all)', () => {
  for (const id of ['sun', 'tulip', 'skein', 'cherries', 'quilt', 'birdhouse']) {
    const L = levelById(id);
    const s = R.replay(L, L.solution);
    assert.ok(R.isDone(s), `${id} clears`);
    assert.equal(s.extra, 0);
    assert.equal(s.shelf.length, L.lanes.reduce((a, l) => a + l.length, 0));
  }
});

test('rules: nothing lifts through muslin, keys lock lanes, tied jars need two places, the nudge is once', () => {
  const tiny = (o) => R.buildLevel({ id: 'tiny', name: 'Tiny', slots: 4, bench: 3, ...o });
  const L = tiny({ art: ['rb', 'rb'], queues: ['r2', 'b2'], cover: [1] });
  let s = R.newState(L);
  assert.equal(R.openColor(L, s, 1), null, 'covered column');
  s = R.apply(L, s, { t: 'place', i: 1 }).state;
  assert.equal(s.belt.length, 1, 'the blue jar waits under the cloth');
  s = R.apply(L, s, { t: 'place', i: 0 }).state;
  assert.ok(R.isDone(s), 'the bare red column lifts the cloth, then blue follows');
  const K = tiny({ art: ['rb', 'rb'], queues: ['r2', 'b2'], locks: [[1, 1, 0]] });
  const k0 = R.newState(K);
  assert.equal(R.blockedReason(K, k0, { t: 'place', i: 1 }), 'locked');
  const k1 = R.apply(K, k0, { t: 'place', i: 0 }).state;
  assert.ok(R.laneOpen(K, k1, 1));
  const Tl = R.buildLevel({ id: 't', name: 'T', slots: 2, bench: 1, art: ['rb', 'rb'], queues: ['r2=b2'] });
  const t0 = R.stage(Tl, R.newState(Tl), { t: 'place', i: 0 });
  assert.equal(t0.belt.length, 2, 'a tied pair goes on together');
  const n1 = R.nudge(R.newState(L));
  assert.equal(R.benchCap(L, n1), 4);
  assert.equal(R.canNudge(n1), false);
});

// --- the sim ------------------------------------------------------------------------

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}
function opened(n = 18, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 4000;
  assert.equal(sim.unlocks.buy(s, { id: 'lift' }, NOW).ok, true);
  s._events = [];
  return s;
}
const playAll = (s, L, now = NOW) => {
  let r = null;
  for (const m of L.solution.split(' ')) { r = T.move(s, { move: m }, now); assert.ok(r.ok, `${L.id} ${m}: ${r.reason}`); }
  return r;
};

test('unlock: revealed at 18 colors for 3,500 coins; nothing plays while it is closed', () => {
  const s = withColors(17);
  const u = sim.unlocks.status(s, 'lift');
  assert.deepEqual([u.revealColors, u.cost, u.revealed], [18, 3500, false]);
  assert.equal(T.openEasel(s).reason, 'locked');
  assert.equal(T.move(s, { move: 'L0' }, NOW).reason, 'locked');
  const o = opened(18);
  assert.equal(o.coins, 500);
  assert.equal(T.unlocked(o), true);
  assert.ok(o._events.length === 0 || o._events.every((e) => e.type !== 'paintingLifted'));
});

test('moves through the sim: legal checks with reasons, undo, the spare spot once, restart and any painting', () => {
  const s = opened();
  assert.deepEqual(T.openEasel(s), { ok: true, levelId: 'sun' });
  const r = T.move(s, { move: 'L1' }, NOW);
  assert.ok(r.ok && r.passes.length > 0 && r.staged.belt.length >= 1);
  assert.deepEqual(s.lift.game.moves, ['L1']);
  assert.equal(T.move(s, { move: 'X9' }, NOW).reason, 'bad');
  assert.equal(T.move(s, { move: 'U0' }, NOW).reason, 'bad', 'nothing on the bench');
  assert.equal(T.current(s).past.length, 1);
  assert.ok(T.nudge(s, {}, NOW).ok);
  assert.equal(T.nudge(s, {}, NOW).reason, 'nudge', 'one spare spot per painting');
  assert.equal(R.benchCap(T.current(s).L, T.current(s).s), 4);
  assert.ok(T.undo(s).ok);
  assert.ok(T.undo(s).ok);
  assert.equal(T.undo(s).reason, 'none');
  assert.deepEqual(T.current(s).s, R.newState(levelById('sun')));
  T.move(s, { move: 'L1' }, NOW);
  assert.ok(T.restart(s).ok);
  assert.deepEqual(s.lift.game.moves, []);
  assert.equal(T.startPainting(s, { levelId: 'nope' }).reason, 'unknown');
  assert.ok(T.startPainting(s, { levelId: 'teacup' }).ok);
  assert.equal(s.lift.cur, 'teacup');
  assert.equal(T.current(s).L.id, 'teacup');
});

test('a finished painting pays coins scaled to income and stock of her nearest colors, once; hooks fire', () => {
  const s = opened(18, 2);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  s._events = [];
  s.quests.daily = [{ id: 'q1', type: 'lift-test', event: 'paintingLifted', target: 2, progress: 0, done: false, claimed: false }];
  T.openEasel(s);
  const L = levelById('sun');
  const q = T.quote(s, 'sun', NOW);
  assert.ok(Math.abs(q.coins - orderBasePay(s, T.paintMinutes(L)) * sim.incomeMultiplier(s, NOW)) < 1e-9);
  const coins0 = s.coins;
  const stock0 = stockTotal(s);
  const r = playAll(s, L);
  assert.ok(r.finished, 'the last move finishes it');
  assert.ok(Math.abs(s.coins - coins0 - q.coins) < 1e-6, 'coins as quoted (nothing overflowed)');
  const jars = q.stock.reduce((a, it) => a + it.jars, 0);
  assert.ok(jars >= 3 && jars <= 6, `a small amount of stock (${jars} jars)`);
  assert.ok(Math.abs(stockTotal(s) - stock0 - jars) < 1e-9);
  for (const it of q.stock) {
    assert.ok(s.catalog.discovered[it.colorId], 'stock goes to a discovered color');
    for (const k of it.from) assert.equal(T.nearestDiscovered(s, PALETTE[k].hex), it.colorId);
  }
  assert.equal(s.lift.done.sun, 1);
  assert.equal(s.lift.lifted, 1);
  assert.equal(s.lift.last.levelId, 'sun');
  assert.equal(s.quests.daily[0].progress, 1, "questEvent(state, 'paintingLifted', 1, {levelId})");
  assert.equal(s._events.filter((e) => e.type === 'paintingLifted').length, 1);
  assert.deepEqual(r.finished.colors, q.stock.map((it) => it.colorId), 'eventPoints gets the nearest discovered ids');
  // Undo the last move and finish again: nothing is paid twice.
  const c1 = s.coins;
  assert.ok(T.undo(s).ok);
  const again = T.move(s, { move: L.solution.split(' ').pop() }, NOW);
  assert.ok(again.ok && !again.finished);
  assert.equal(s.coins, c1);
  assert.equal(s.lift.done.sun, 1);
  // Lifted again from the start: a quarter of the coins.
  T.startPainting(s, { levelId: 'sun' });
  const q2 = T.quote(s, 'sun', NOW);
  assert.ok(q2.repeat && Math.abs(q2.coins - q.coins * T.REPEAT_SHARE) < 1e-6);
  const c2 = s.coins;
  playAll(s, L);
  assert.ok(Math.abs(s.coins - c2 - q2.coins) < 1e-6);
  assert.equal(s.lift.done.sun, 2);
  assert.equal(s.quests.daily[0].progress, 2);
});

test('stock respects storage capacity (the rest sells at once) and never touches kept jars', () => {
  const s = opened(18, 3);
  const cap = capacity(s).total;
  const L = levelById('sun');
  const q = T.quote(s, 'sun', NOW);
  const target = q.stock[0].colorId;
  s.keep = { [target]: 0 };
  // Fill storage to one jar short of capacity with a color that is not in the reward.
  s.stock = { umber: { jars: cap - 1, purity: { muddy: 0, standard: cap - 1, pure: 0, flawless: 0 } } };
  T.openEasel(s);
  const coins0 = s.coins;
  const r = playAll(s, L);
  assert.ok(stockTotal(s) <= cap + 1e-9, 'never above capacity');
  assert.ok(r.finished.sold > 0, 'the jars that did not fit sold');
  assert.ok(s.coins - coins0 > r.finished.coins);
  assert.equal(stockOf(s, 'umber'), cap - 1, 'other stock untouched');
  assert.deepEqual(s.keep, { [target]: 0 }, 'her keep settings untouched');
});

test('pay stays modest: at most 1.2 income-minutes per estimated active minute, under hand orders', () => {
  const s = opened(20, 4);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  const minute = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
  assert.ok(minute > 0);
  for (const L of LEVELS) {
    const mins = T.estimatedSeconds(L) / 60;
    const perMin = T.quote(s, L.id, NOW).coins / minute / mins;
    assert.ok(perMin <= 1.2 + 1e-9, `${L.id}: ${perMin.toFixed(2)} income-minutes per active minute`);
    // Even twice as fast as the estimate, a painting pays no more than the cheapest order per minute.
    assert.ok(perMin * 2 <= PAY_MINUTES.min * 1.15, `${L.id} at double speed`);
    assert.ok(T.paintMinutes(L) >= T.MIN_MINUTES);
  }
  // Bigger paintings pay more.
  assert.ok(T.paintMinutes(levelById('fox')) > T.paintMinutes(levelById('sun')) * 10);
});

test('save round trip mid-painting: reload resumes exactly and plays on identically', () => {
  const s = opened();
  T.startPainting(s, { levelId: 'skein' });
  const L = levelById('skein');
  const moves = L.solution.split(' ');
  for (const m of moves.slice(0, 12)) assert.ok(T.move(s, { move: m }, NOW).ok);
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.lift, s.lift);
  assert.deepEqual(T.current(back).s, T.current(s).s);
  assert.equal(T.current(back).past.length, 12);
  for (const m of moves.slice(12)) { assert.ok(T.move(back, { move: m }, NOW).ok); }
  assert.ok(T.current(back).done);
  assert.equal(back.lift.done.skein, 1);
  // Settings and intro cards persist.
  T.setSetting(s, { key: 'fast', value: true });
  T.seeIntro(s, { mechanics: ['mystery'] });
  const b2 = deserialize(serialize(s, NOW), NOW);
  assert.equal(b2.lift.settings.fast, true);
  assert.equal(b2.lift.seenIntro.mystery, true);
  assert.equal(T.setSetting(s, { key: 'nope', value: true }).ok, false);
});

test('old saves load: no lift section, no unlock; a broken or outdated game is set aside', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.lift;
  delete obj.state.unlocks.lift;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.lift, false);
  assert.deepEqual(back.lift, T.initialLift());
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.lift = { settings: 'x', done: { sun: 2, nope: 1 } };
  const o = deserialize(JSON.stringify(odd), NOW);
  assert.deepEqual(o.lift.settings, { fast: false, sound: true, glyphs: true });
  T.ensureLift(o);
  assert.deepEqual(o.lift.done, { sun: 2 });
  const bad = opened();
  bad.lift.game = { level: 'sun', sig: levelById('sun').sig, moves: ['L0', 'U7'], paid: false };
  T.ensureLift(bad);
  assert.equal(bad.lift.game, null, 'moves that no longer replay');
  bad.lift.game = { level: 'sun', sig: 'old', moves: [], paid: false };
  T.ensureLift(bad);
  assert.equal(bad.lift.game, null, 'a picture that changed');
  bad.lift.cur = 'gone';
  T.ensureLift(bad);
  assert.equal(bad.lift.cur, 'sun');
  assert.equal(T.current(bad), null);
  assert.deepEqual(T.openEasel(bad), { ok: true, levelId: 'sun' });
});

test('Renovate closes the table (lifted paintings and the easel stay); Keep the Easel holds it open', () => {
  const s = opened(30);
  T.openEasel(s);
  playAll(s, levelById('sun'));
  T.startPainting(s, { levelId: 'tulip' });
  T.move(s, { move: levelById('tulip').solution.split(' ')[0] }, NOW);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('lift'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.lift, false);
  assert.ok(s.renovateReopen.includes('lift'));
  assert.equal(s.lift.done.sun, 1);
  assert.equal(s.lift.game.moves.length, 1, 'the painting on the easel waits for her');
  const k = opened(30);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-easel' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('lift'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.lift, true);
});

test('the summary read for the Puzzles hub, and the next painting', () => {
  const s = opened();
  assert.equal(T.summary(s).open, true);
  assert.equal(T.summary(s).levelId, 'sun');
  assert.equal(T.summary(s).playing, false);
  T.openEasel(s);
  T.move(s, { move: 'L1' }, NOW);
  const sum = T.summary(s);
  assert.ok(sum.playing && sum.progress > 0 && sum.progress < 1 && sum.h.length === 8);
  assert.equal(T.nextLevelId(s, 'sun'), 'tulip');
  s.lift.done.tulip = 1;
  assert.equal(T.nextLevelId(s, 'sun'), 'teacup');
  assert.equal(T.nextLevelId(s, 'sampler'), 'sun');
});
