// The Dye Garden: the port of the prototype's rules (light: the full rule suite
// runs in proto/test/garden.test.js), the sim (unlock, visits, pay, stock,
// bests, spindles, hooks), the save round trip, Renovate, and the balance check
// that keeps hand orders the best coins per active minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/puzzles/garden.js';
import * as P from '../proto/garden/rules.js';
import * as G from '../src/sim/garden.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { REGIONS } from '../src/content/regions.js';
import { orderBasePay } from '../src/sim/orders.js';
import { freeSpace, stockOf } from '../src/sim/storage.js';
import { dayKey } from '../src/format.js';

const NOW = Date.UTC(2026, 9, 18, 9);
const DAY = dayKey(NOW);

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}
/** A 22-color workshop that earns (stations at `lv`), with the garden bought. */
function opened(lv = 10, seed = 1) {
  const s = withColors(22, seed);
  s.coins = 6000;
  assert.equal(sim.unlocks.buy(s, { id: 'garden' }, NOW).ok, true);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; m.level = lv; });
  for (const k of Object.keys(s.stations.sources)) s.stations.sources[k].level = lv;
  s.stations.grinders.forEach((x) => { x.level = lv; });
  s.stations.vats.forEach((x) => { x.level = lv; });
  s.stations.shop.level = lv;
  sim.tick(s, NOW + 1000);
  s.coins = 0;
  s._events = [];
  return s;
}
/** The first n plants of smallest-first order (always gatherable in that order). */
const firstN = (g, n) => R.greedyFinish(g).order.slice(0, n);

/** An ideal autopilot (straight at the nearest plant that fits, full speed): a lower bound on a visit's time. */
function bot(g, maxT = Infinity) {
  let v = R.newVisit();
  const taken = new Uint8Array(g.plants.length);
  const grid = R.buildGrid(g.plants, g.W, g.H, 64);
  let x = g.start.x, y = g.start.y, t = 0, target = -1, next = 0;
  const dt = 1 / 20;
  while (t < maxT && !R.isDone(g, v) && t < 1800) {
    t += dt;
    const br = R.basketRadius(g, v.mass);
    const speed = 100 * Math.pow(br / R.R0, 0.6); // world units/s at the screen's top speed (300 px/s over the zoom)
    if (t > next || target < 0 || taken[target]) { target = R.nearestGatherable(g, v, x, y, taken); next = t + 0.25; }
    if (target < 0) break;
    const p = g.plants[target];
    const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1, m = Math.min(d, speed * dt);
    x += (dx / d) * m; y += (dy / d) * m;
    for (const i of R.queryGrid(grid, x - br - 64, y - br - 64, x + br + 64, y + br + 64)) {
      if (taken[i]) continue;
      if (R.fits(g, g.plants[i], v.mass) && R.over(x, y, R.basketRadius(g, v.mass), g.plants[i])) { v = R.gather(g, v, i); taken[i] = 1; }
    }
  }
  return { got: v.got, secs: t };
}

// --- the port ----------------------------------------------------------------------

test('the rules are the prototype\'s: same gardens, goals and scores; places sit by map regions', () => {
  for (const [id, seed, mode] of [['meadow', 7, 'wander'], ['cactus', R.harvestSeed('cactus'), 'harvest']]) {
    const a = R.generate(id, seed, mode), b = P.generate(id, seed, mode);
    assert.deepEqual(a, b);
    assert.deepEqual(R.goalFor(a), P.goalFor(b));
    assert.ok(R.greedyFinish(a).ok);
  }
  assert.equal(R.GEN, P.GEN);
  const regionIds = new Set(REGIONS.map((r) => r.id));
  for (const p of R.PLACES) assert.ok(regionIds.has(R.PLACE_REGION[p.id]), p.id);
  // gardenFor shares one generated garden (and keeps answers identical).
  const g1 = R.gardenFor('shore', 99);
  assert.equal(R.gardenFor('shore', 99), g1);
  assert.deepEqual(g1, R.generate('shore', 99));
});

// --- unlock --------------------------------------------------------------------------

test('unlock: revealed at 22 colors for 6,000 coins; Next names it; nothing pays before it', () => {
  const s = withColors(21);
  s.coins = 7000;
  const st = sim.unlocks.status(s, 'garden');
  assert.deepEqual([st.cost, st.revealColors, st.revealed], [6000, 22, false]);
  assert.equal(G.finishVisit(s, { placeId: 'meadow', mode: 'wander', seed: 5, got: [] }, NOW).reason, 'locked');
  const t = withColors(22);
  t.coins = 6000;
  for (const id of sim.unlocks.UNLOCK_IDS) if (id !== 'garden' && sim.unlocks.status(t, id).revealed) t.unlocks[id] = true;
  t.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'ochre'][i % 2]; });
  assert.match(sim.next(t, NOW).label, /^Open the Dye Garden for 6/);
  assert.equal(sim.unlocks.buy(t, { id: 'garden' }, NOW).ok, true);
  assert.equal(t.coins, 0);
  assert.equal(G.unlocked(t), true);
});

// --- visits --------------------------------------------------------------------------

test('a Wander visit banks coins scaled to income, a few jars of her nearest colors, and the dye shelf', () => {
  const s = opened(10);
  const g = R.gardenFor('meadow', 4242);
  const got = firstN(g, 160);
  const haul = R.tally(g, got);
  const units = haul.reduce((n, t) => n + t.units, 0);
  G.saveVisit(s, { place: 'meadow', seed: 4242, got: got.slice(0, 10), x: 100, y: 120, found: [] });
  assert.equal(s.garden.cur.got.length, 10);
  const stock0 = JSON.parse(JSON.stringify(s.stock));
  const keep0 = JSON.stringify(s.keep);
  const r = G.finishVisit(s, { placeId: 'meadow', mode: 'wander', seed: 4242, got: [...got, got[0], -3, 99999] }, NOW);
  assert.ok(r.ok);
  assert.equal(r.plants, 160, 'junk and repeats are dropped');
  assert.equal(r.units, units);
  const perJar = G.coinsPerJar(s, NOW);
  assert.ok(Math.abs(perJar - orderBasePay(s, 1) * G.JAR_MINUTES * sim.incomeMultiplier(s, NOW)) < 1e-9);
  const goalMet = R.goalProgress(g, R.goalFor(g), got).met;
  assert.ok(Math.abs(r.coins - ((units / R.JAR) * perJar + (goalMet ? G.goalCoins(s, NOW) : 0))) < 1e-6);
  assert.ok(Math.abs(s.coins - r.coins) < 1e-6, 'coins land');
  // stock: her nearest discovered colors, at least one jar per dye, STOCK_MAX at most
  const total = r.stock.reduce((n, e) => n + e.added, 0);
  assert.ok(total >= 1 && total <= G.STOCK_MAX);
  for (const e of r.stock) {
    assert.ok(s.catalog.discovered[e.colorId], e.colorId);
    assert.ok(Math.abs(stockOf(s, e.colorId) - (stock0[e.colorId] ? stock0[e.colorId].jars : 0) - e.added) < 1e-9);
    for (const d of e.dyes) assert.equal(G.nearestColor(s, d), e.colorId);
  }
  assert.equal(JSON.stringify(s.keep), keep0, 'her keep reserves are untouched');
  // the dye shelf, the visit count, the visit in progress cleared
  for (const t of haul) assert.equal(s.garden.shelf[t.dye], t.units);
  assert.equal(s.garden.visits, 1);
  assert.equal(s.garden.cur, null);
  assert.deepEqual(s.garden.last.placeId, 'meadow');
  assert.ok(s._events.some((e) => e.type === 'gardenVisit'));
  // an empty stroll pays nothing and fires no hooks
  s._events = [];
  const coins = s.coins;
  const e = G.finishVisit(s, { placeId: 'forest', mode: 'wander', seed: 8, got: [] }, NOW);
  assert.ok(e.ok);
  assert.equal(s.coins, coins);
  assert.deepEqual(e.stock, []);
});

test('hooks: one gardenVisit quest step and harvest event points per finished visit', () => {
  const s = opened(10);
  s.quests.daily = [{ id: 'q-garden', type: 'gardenVisit', event: 'gardenVisit', target: 2, progress: 0, done: false, claimed: false, reward: { seals: 1 } }];
  const g = R.gardenFor('shore', 31);
  G.finishVisit(s, { placeId: 'shore', mode: 'wander', seed: 31, got: firstN(g, 40) }, NOW);
  assert.equal(s.quests.daily[0].progress, 1);
  G.finishVisit(s, { placeId: 'shore', mode: 'wander', seed: 32, got: [] }, NOW);
  assert.equal(s.quests.daily[0].progress, 1, 'an empty stroll is not a visit');
  // eventPoints is called with the colors; with no harvest points defined yet it simply adds nothing
  s.event = null;
  assert.doesNotThrow(() => G.finishVisit(s, { placeId: 'shore', mode: 'wander', seed: 33, got: firstN(R.gardenFor('shore', 33), 5) }, NOW));
});

test('storage caps the stock (the rest stays on the dye shelf), and the coins still land', () => {
  const s = opened(10);
  const ids = Object.keys(s.catalog.discovered);
  // fill storage to one jar of room
  sim.addStock(s, ids[0], Math.max(0, freeSpace(s) - 1), 'standard', {});
  assert.ok(freeSpace(s) <= 1.0001);
  const g = R.gardenFor('hillside', 77);
  const r = G.finishVisit(s, { placeId: 'hillside', mode: 'wander', seed: 77, got: firstN(g, 200) }, NOW);
  assert.ok(r.ok && r.coins > 0);
  assert.ok(r.stock.reduce((n, e) => n + e.added, 0) <= 1.0001);
  assert.ok(r.stockLeft >= 1);
  assert.ok(freeSpace(s) >= -1e-9);
});

test('harvest: the fixed garden keeps fair bests, today\'s garden its own; other seeds are not harvests', () => {
  const s = opened(10);
  const seed = R.harvestSeed('cactus');
  const g = R.gardenFor('cactus', seed, 'harvest');
  assert.equal(G.finishVisit(s, { placeId: 'cactus', mode: 'harvest', seed: 1234, got: [] }, NOW).reason, 'seed');
  const a = G.finishVisit(s, { placeId: 'cactus', mode: 'harvest', seed, day: DAY, got: firstN(g, 120), reason: 'dusk', spare: 40 }, NOW);
  assert.ok(a.ok && a.isNew && !a.daily);
  assert.equal(a.score.spare, 0, 'spare sun counts only when everything is gathered');
  assert.equal(s.garden.bests.cactus.jars, a.score.jars);
  const b = G.finishVisit(s, { placeId: 'cactus', mode: 'harvest', seed, day: DAY, got: firstN(g, 60), reason: 'home' }, NOW);
  assert.ok(!b.isNew && b.prev.jars === a.score.jars, 'a smaller harvest keeps the best');
  const daySeed = R.harvestSeed('cactus', DAY);
  const d = G.finishVisit(s, { placeId: 'cactus', mode: 'harvest', seed: daySeed, day: DAY, got: firstN(R.gardenFor('cactus', daySeed, 'harvest'), 30), reason: 'dusk' }, NOW);
  assert.ok(d.ok && d.daily && d.isNew);
  assert.equal(s.garden.daily.day, DAY);
  assert.ok(s.garden.daily.bests.cactus);
  assert.equal(G.bestOf(s, 'cactus').jars, a.score.jars);
  assert.equal(G.bestOf(s, 'cactus', { daily: true, day: DAY }).jars, d.score.jars);
  assert.equal(G.bestOf(s, 'cactus', { daily: true, day: '2026-01-01' }), null);
  assert.equal(s.garden.cur, null);
});

test('spindles: kept at once, once per garden; settings; summary', () => {
  const s = opened(10);
  const key = G.spindleKey('forest', 'wander', 9);
  assert.equal(G.hasSpindle(s, key), false);
  assert.deepEqual(G.keepSpindle(s, { key }), { ok: true, count: 1, isNew: true });
  assert.equal(G.keepSpindle(s, { key }).isNew, false);
  assert.equal(s.garden.spindles, 1);
  assert.ok(G.hasSpindle(s, key));
  assert.equal(s.garden.settings.sound, false, 'garden sounds are off by default');
  assert.ok(G.setSetting(s, { key: 'sound', value: true }).ok);
  assert.equal(s.garden.settings.sound, true);
  assert.equal(G.setSetting(s, { key: 'nope', value: 1 }).ok, false);
  G.saveVisit(s, { place: 'forest', seed: 9, got: [1, 2, 3], x: 10, y: 20, found: [0] });
  const sum = G.summary(s);
  assert.deepEqual(sum.wandering, { placeId: 'forest', plants: 3 });
  assert.equal(sum.open, true);
  assert.equal(sum.spindles, 1);
});

// --- saves -----------------------------------------------------------------------------

test('save round trip resumes a Wander visit; old saves load with the garden closed; broken parts repair', () => {
  const s = opened(10);
  G.saveVisit(s, { place: 'meadow', seed: 55, got: firstN(R.gardenFor('meadow', 55), 30), x: 301.4, y: 402.6, found: [1] });
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.garden, s.garden);
  assert.equal(back.garden.cur.x, 301);
  // a save from before the garden (no garden, no unlock key)
  const old = JSON.parse(serialize(createInitialState(NOW, 4)));
  delete old.state.garden;
  delete old.state.unlocks.garden;
  const o = deserialize(JSON.stringify(old), NOW);
  assert.equal(o.v, SAVE_VERSION);
  assert.equal(o.unlocks.garden, false);
  assert.deepEqual(o.garden, G.initialGarden());
  // broken pieces never lock the garden
  const bad = createInitialState(NOW, 4);
  bad.garden = { cur: { place: 'meadow', gen: R.GEN + 1, seed: 3, mode: 'wander', got: [1] }, bests: { meadow: { jars: 'x' }, mars: { jars: 3 } }, shelf: { weld: 30, nope: 4, woad: -1 }, settings: 'loud', spindleKeys: 'x' };
  G.ensureGarden(bad);
  assert.equal(bad.garden.cur, null, 'a visit from another garden layout is dropped');
  assert.deepEqual(Object.keys(bad.garden.bests), ['meadow']);
  assert.deepEqual(bad.garden.shelf, { weld: 30 });
  assert.deepEqual(bad.garden.settings, { sound: false, today: false });
  assert.deepEqual(bad.garden.spindleKeys, []);
});

test('Renovate closes the garden (her shelf, bests and spindles stay); Keep the Garden Gate holds it', () => {
  const s = opened(10);
  G.finishVisit(s, { placeId: 'meadow', mode: 'wander', seed: 3, got: firstN(R.gardenFor('meadow', 3), 50) }, NOW);
  G.keepSpindle(s, { key: 'x' });
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('garden'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.garden, false);
  assert.ok(s.renovateReopen.includes('garden'));
  assert.equal(s.garden.visits, 1);
  assert.equal(s.garden.spindles, 1);
  assert.ok(Object.keys(s.garden.shelf).length > 0);
  const k = opened(10);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-garden' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('garden'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.garden, true);
});

// --- balance ---------------------------------------------------------------------------

test('modest pay: hand orders stay the best coins per active minute (tools/balance/TUNING.md "Dye Garden")', () => {
  for (const lv of [10, 25]) {
    const s = opened(lv);
    const unit = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW); // one minute of order pay
    const handFast = 3 * unit * 2; // a 3-minute order every 30 s: the quick end of hand orders
    const handSlow = 3 * unit; // one a minute
    for (const [placeId, mode] of [['meadow', 'wander'], ['hillside', 'wander'], ['meadow', 'harvest']]) {
      const seed = mode === 'harvest' ? R.harvestSeed(placeId) : 777;
      const g = R.gardenFor(placeId, seed, mode);
      const b = bot(g, mode === 'harvest' ? R.MODES.harvest.secs : Infinity);
      const t = JSON.parse(JSON.stringify(s));
      t._events = [];
      const r = G.finishVisit(t, { placeId, mode, seed, got: b.got, reason: 'home' }, NOW);
      const value = r.coins + r.stock.reduce((n, e) => n + e.added * sim.colorPrice(t, e.colorId), 0);
      const botMin = Math.max(b.secs, 1) / 60;
      // A human steers far less directly than this ideal autopilot: count her at a third of its pace,
      // and a harvest at its two minutes.
      const herMin = mode === 'harvest' ? R.MODES.harvest.secs / 60 : botMin * 3;
      assert.ok(value / botMin < handFast, `lv${lv} ${placeId}/${mode}: ideal ${(value / botMin / unit).toFixed(2)} order-minutes a minute`);
      assert.ok(value / herMin < handSlow, `lv${lv} ${placeId}/${mode}: her pace ${(value / herMin / unit).toFixed(2)} order-minutes a minute`);
    }
  }
});
