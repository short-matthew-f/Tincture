// review.test.js — robustness checks from the final review (docs/INTEGRATION-NOTES.md):
// old saves, long and backwards clocks, crowded states, reload-safe cooldowns,
// apprentices with an empty till, and the formulas that must never yield NaN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game, memoryStorage } from '../src/game.js';
import {
  SAVE_KEY, SAVE_VERSION, createInitialState, serialize, deserialize,
} from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { CATALOG } from '../src/content/catalog.js';
import { HUNTERS } from '../src/content/hunters.js';
import { RUSH_COOLDOWN_MS } from '../src/content/stations.js';

const T0 = Date.UTC(2026, 9, 2, 9, 0, 0);
const MIN = 60e3;
const DAY = 86400e3;

/** Every number reachable from `x` (path list of the bad ones). */
function badNumbers(x, path = 'state', out = [], seen = new Set()) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) out.push(`${path} = ${x}`);
    return out;
  }
  if (!x || typeof x !== 'object' || seen.has(x)) return out;
  seen.add(x);
  for (const [k, v] of Object.entries(x)) badNumbers(v, `${path}.${k}`, out, seen);
  return out;
}

const mixable = CATALOG.filter((c) => Array.isArray(c.recipe) && c.recipe.every((r) => ['madder', 'ochre', 'woad', 'white', 'black'].includes(r.pigment)));

/** A Phase 2 workshop in full swing: mixers busy, hunters hired, apprentices on. */
function busyState(seed = 11) {
  const s = createInitialState(T0, seed);
  for (const c of CATALOG.slice(0, 40)) sim.discover(s, { colorId: c.id, method: 'debug' }, T0);
  s.coins = 5e6;
  s._events = [];
  for (const id of ['mill-room', 'mixing-hall', 'cellar', 'loading-yard']) sim.buyRoom(s, { id }, T0);
  s.phase = 2;
  s.unlocks.hunters = true; // the map window is bought (v0.2)
  sim.unlockRegions(s, {}, T0);
  for (const h of HUNTERS) sim.hunters.hire(s, { hunterId: h.id });
  s.stations.mixers.forEach((m, i) => {
    const id = mixable[(i * 7) % mixable.length].id;
    sim.discover(s, { colorId: id, method: 'debug' }, T0);
    assert.equal(sim.assignRecipe(s, { mixer: i, colorId: id }).ok, true);
  });
  assert.ok(s.stations.mixers.length >= 3, 'rooms added mixers');
  assert.ok(s.hunters.roster.length >= 4, 'hunters hired');
  for (const a of ['errandRunner', 'orderClerk', 'dispatcher', 'packer', 'steward']) s.apprentices[a] = true;
  s.stewardOn = true;
  sim.tick(s, T0 + 1000);
  s._events = [];
  return s;
}

test('a v1 save missing newer keys loads with every default (deep enough)', () => {
  const s = createInitialState(T0, 5);
  const obj = JSON.parse(serialize(s));
  obj.v = 1;
  delete obj.state.settings.puzzleTier;
  delete obj.state.activePuzzles;
  delete obj.state.gallery.collectorOffer;
  delete obj.state.gallery.nextCollectorAt;
  delete obj.state.gallery.walls;
  obj.state.gallery.pieces = null;
  delete obj.state.onboarding.flags;
  delete obj.state.orders.reputation;
  delete obj.state.quests.bank;
  delete obj.state.lifetime.renovations;
  delete obj.state.stations.fleet;
  delete obj.state.pendingCollect;
  const back = deserialize(JSON.stringify(obj), T0);
  assert.equal(back.v, SAVE_VERSION);
  assert.deepEqual(back.settings.puzzleTier, { grading: 'relaxed', purify: 'relaxed' });
  assert.deepEqual(back.activePuzzles, {});
  assert.equal(back.gallery.collectorOffer, null);
  assert.equal(back.gallery.nextCollectorAt, 0);
  assert.equal(back.gallery.walls, 4);
  assert.deepEqual(back.gallery.pieces, []);
  assert.deepEqual(back.onboarding.flags, {});
  assert.equal(back.orders.reputation, 0);
  assert.equal(back.quests.bank, 0);
  assert.equal(back.lifetime.renovations, 0);
  assert.deepEqual(back.stations.fleet, []);
  assert.equal(back.pendingCollect, 0);
  // ...and it plays.
  sim.tick(back, T0 + 5 * MIN);
  assert.deepEqual(badNumbers(back), []);
});

test('JSON that is not a Tincture save is refused', () => {
  assert.throws(() => deserialize(JSON.stringify({ v: 1, state: { coins: 5 } }), T0));
  assert.throws(() => deserialize(JSON.stringify({ v: 1, state: { stations: {}, catalog: [] } }), T0));
});

test('catchUp over 30 days finishes in under 3 s and leaves no NaN or Infinity', () => {
  const s = busyState();
  for (const h of s.hunters.roster) sim.send(s, { hunterId: h.id, regionId: 'meadow', duration: 'overnight' }, T0 + 1000);
  const t = Date.now(); // eslint-disable-line no-restricted-properties
  const summary = sim.catchUp(s, T0 + 30 * DAY);
  const ms = Date.now() - t;
  assert.ok(summary, 'a ledger');
  assert.ok(ms < 3000, `catch-up took ${ms} ms`);
  assert.deepEqual(badNumbers(s), []);
  assert.deepEqual(badNumbers(summary, 'summary'), []);
  assert.equal(s.lastTick, T0 + 30 * DAY);
});

test('the clock moved back a day: production keeps flowing, trips keep their time left', () => {
  const storage = memoryStorage();
  const clock = { t: T0 };
  const game = new Game({ now: () => clock.t, storage, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} });
  const s = game.state;
  s.phase = 2;
  s.unlocks.hunters = true; // the map window is bought (v0.2)
  sim.unlockRegions(s, {}, T0);
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  assert.equal(game.act(sim.assignRecipe, { mixer: 0, colorId: 'orange' }).ok, true);
  game.act(sim.send, { hunterId: 'wren', regionId: 'meadow', duration: 'long' });
  clock.t += 10 * MIN;
  game.tick();
  const left = s.hunters.roster[0].trip.returnsAt - clock.t;
  const quests = s.quests.daily.map((q) => q.id).join();
  clock.t -= DAY; // the device clock jumps back a day
  game.tick();
  assert.equal(s.lastTick, clock.t, 'loop clock rebased');
  assert.equal(s.hunters.roster[0].trip.returnsAt - clock.t, left, 'the trip keeps its time left');
  assert.equal(s.quests.daily.map((q) => q.id).join(), quests, 'no fresh dailies for going back in time');
  const made = () => sim.stockTotal(s) + s.pendingCollect + s.lifetime.earned; // stock, or sold by the shop
  const before = made();
  clock.t += 5 * MIN;
  game.tick();
  assert.ok(made() > before, 'production flows');
  assert.deepEqual(badNumbers(s), []);
  // ...and when the clock comes back, nothing extra is granted.
  const bank = s.quests.bank;
  clock.t += DAY;
  game.resume();
  assert.equal(s.quests.bank, bank);
  assert.deepEqual(badNumbers(s), []);
});

test('importSave with garbage keeps the current game', () => {
  const storage = memoryStorage();
  const game = new Game({ now: () => T0, storage });
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  const before = game.exportSave();
  for (const junk of ['', 'not json', '[]', 'null', '{"v":1}', '{"v":1,"state":{"coins":5}}', '{"v":999,"state":{"stations":{},"catalog":{}}}']) {
    const r = game.importSave(junk);
    assert.equal(r.ok, false, junk);
  }
  assert.ok(game.state.catalog.discovered.orange);
  assert.equal(game.exportSave(), before);
});

test('reset clears the save and the per-viewer notes, then reloads', () => {
  let reloaded = 0;
  const storage = memoryStorage({ 'tincture.ui.hunterCards': '{"wren":[]}', 'tincture.ui.backpackSeen': '5', 'tincture.workshop.panels': '[]' });
  const game = new Game({ now: () => T0, storage, reload: () => { reloaded++; } });
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  game.save();
  game.reset();
  assert.equal(reloaded, 1);
  assert.ok(!game.state.catalog.discovered.orange);
  assert.ok(!storage.getItem(SAVE_KEY).includes('"orange"'));
  assert.equal(storage.getItem('tincture.ui.hunterCards'), null);
  assert.equal(storage.getItem('tincture.ui.backpackSeen'), null);
  assert.equal(storage.getItem('tincture.workshop.panels'), '[]', 'layout preferences stay');
});

test('a full shelf, full storage, every hunter out and 10 open orders tick without error', () => {
  const s = busyState(3);
  s.shelf.cells = s.shelf.cells.map(() => ({ color: 'orange', tier: 1, golden: false }));
  for (const h of s.hunters.roster) sim.send(s, { hunterId: h.id, regionId: 'meadow', duration: 'short' }, T0 + 2000);
  assert.ok(s.hunters.roster.every((h) => h.state === 'out'));
  const cap = sim.capacity(s).total;
  sim.addStock(s, 'orange', cap * 2, 'standard');
  assert.ok(sim.isFull(s));
  while (s.orders.open.length < 10) s.orders.open.push(sim.generateOrder(s, undefined, T0));
  for (let k = 1; k <= 20; k++) sim.tick(s, T0 + 2000 + k * 7 * MIN);
  sim.catchUp(s, T0 + 2 * DAY);
  assert.deepEqual(badNumbers(s), []);
  assert.ok(s.hunters.roster.every((h) => h.state === 'home'), 'everyone came home');
  assert.ok(sim.stockTotal(s) <= sim.capacity(s).total + 1e-6);
});

test('the Rush cooldown survives a reload', () => {
  const s = createInitialState(T0, 9);
  sim.discover(s, { colorId: 'orange', method: 'bench' }, T0);
  assert.equal(sim.assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  assert.equal(sim.rush(s, { mixer: 0 }, T0 + MIN).ok, true);
  const back = deserialize(serialize(s), T0 + 2 * MIN);
  const again = sim.rush(back, { mixer: 0 }, T0 + 2 * MIN);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'cooldown');
  assert.equal(sim.rush(back, { mixer: 0 }, T0 + MIN + RUSH_COOLDOWN_MS).ok, true);
});

test('Renovate twice in a row: the second is refused or harmless', () => {
  const s = busyState(5);
  s.phase = 3;
  s.runEarned = 4e9;
  const first = sim.renovate(s, T0 + MIN);
  assert.equal(first.ok, true);
  const heritage = s.heritage;
  const second = sim.renovate(s, T0 + 2 * MIN);
  assert.equal(second.ok, false, 'nothing to gain right after a Renovate');
  assert.equal(s.heritage, heritage);
  sim.tick(s, T0 + 3 * MIN);
  assert.deepEqual(badNumbers(s), []);
});

test('the Order Clerk, Dispatcher and Steward never spend an empty till', () => {
  const s = busyState(7);
  s.coins = 0;
  s.pendingCollect = 0;
  const levels = JSON.stringify(s.stations);
  const fleet = s.stations.fleet.length;
  // Short ticks so the shop cannot earn enough for the Steward's next upgrade.
  sim.tick(s, s.lastTick + 1);
  assert.ok(s.coins >= 0);
  assert.equal(sim.stewardTick(s, s.lastTick).bought, 0);
  assert.equal(sim.autoFillOrders(s, s.lastTick + 60 * MIN).coins >= 0, true);
  assert.ok(s.coins >= 0, `coins ${s.coins}`);
  assert.equal(s.stations.fleet.length, fleet);
  const after = JSON.parse(JSON.stringify(s.stations));
  const lv = (st) => JSON.stringify([Object.values(st.sources).map((x) => x.level), st.grinders.map((x) => x.level), st.mixers.map((x) => x.level), st.vats.map((x) => x.level), st.shop.level, st.fleet.map((x) => x.level)]);
  assert.equal(lv(after), lv(JSON.parse(levels)), 'nothing bought');
});

test('flowMeter never returns NaN, even with nothing produced', () => {
  const states = [createInitialState(T0, 1), busyState(2)];
  const idle = busyState(4);
  idle.stations.mixers.forEach((m) => { m.recipe = null; });
  states.push(idle);
  const empty = createInitialState(T0, 1);
  empty.stations.sources = {};
  empty.stations.grinders = [];
  states.push(empty);
  for (const s of states) {
    const f = sim.flowMeter(s, T0);
    const nan = [];
    (function scan(x, p) {
      if (typeof x === 'number') { if (Number.isNaN(x)) nan.push(p); return; }
      if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) scan(v, p + '.' + k);
    }(f, 'flow'));
    assert.deepEqual(nan, []);
    assert.ok(['make', 'store', 'ship'].includes(f.weakest));
    assert.ok(f.suggestion && typeof f.suggestion.label === 'string');
  }
});

test('puzzleReward is always a positive finite number', () => {
  const weird = createInitialState(T0, 1);
  weird.stations = { sources: {}, grinders: [], mixers: [], vats: [], shop: null, fleet: [] };
  weird.boosts = [{ kind: 'income', mult: NaN, until: Infinity }];
  const states = [createInitialState(T0, 1), busyState(6), weird, {}];
  for (const s of states) {
    for (const tier of ['relaxed', 'steady', 'tricky', 'master', 'nonsense']) {
      const r = sim.puzzleReward(s, tier);
      assert.ok(Number.isFinite(r) && r > 0, `${tier}: ${r}`);
    }
  }
});

test('map tab dot: a waiting scouting choice or an unread haul (a pure read)', () => {
  const s = createInitialState(T0, 12);
  s.phase = 2;
  s.unlocks.hunters = true; // the map window is bought (v0.2)
  sim.unlockRegions(s, {}, T0);
  assert.deepEqual(sim.mapAttention(s, T0), { choices: 0, hauls: 0 });
  sim.send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'long' }, T0);
  const trip = s.hunters.roster[0].trip;
  assert.ok(trip.choiceOfferedAt > T0);
  const copy = JSON.stringify(s);
  assert.equal(sim.mapAttention(s, trip.choiceOfferedAt).choices, 1);
  assert.equal(JSON.stringify(s), copy, 'reading mutates nothing');
  sim.choose(s, { hunterId: 'wren', pick: 'a' }, trip.choiceOfferedAt);
  assert.equal(sim.mapAttention(s, trip.choiceOfferedAt).choices, 0);
  sim.resolveReturns(s, trip.returnsAt);
  assert.equal(sim.mapAttention(s, trip.returnsAt).hauls, 1);
  assert.equal(sim.markHaulsSeen(s).marked, 1);
  assert.deepEqual(sim.mapAttention(s, trip.returnsAt), { choices: 0, hauls: 0 });
  assert.equal(deserialize(serialize(s), trip.returnsAt).hunters.roster[0].lastHaul.seen, true, 'seen survives a reload');
});
