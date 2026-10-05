// factory.buyMixer (the cheap third mixer, docs/PLAN-v0.2.md Theme A.1) and the
// rules sim.next uses to offer it and to fall back to the cheapest upgrade
// (src/sim/next.js header; tools/balance/TUNING.md changes 9 and 10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../src/sim/index.js';
import { createInitialState } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { MIXER_PURCHASE } from '../src/content/stations.js';
import { MAX_SLOTS } from '../src/content/rooms.js';
import { CHEAPEST_FALLBACK } from '../src/sim/next.js';

const NOW = Date.UTC(2026, 9, 5, 8);

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}

test('buyMixer: 60 Coins for the third mixer, ×6 for each one after', () => {
  assert.deepEqual({ ...MIXER_PURCHASE }, { baseCost: 60, costGrowth: 6, maxBought: 2 });
  const s = withColors(5);
  assert.equal(s.stations.mixers.length, 2);
  assert.deepEqual(sim.mixerPurchase(s), { cost: 60, available: true, affordable: false, count: 2 });
  const no = sim.buyMixer(s, NOW);
  assert.deepEqual(no, { ok: false, reason: 'coins', cost: 60 });
  assert.equal(s.stations.mixers.length, 2);
  s.coins = 100;
  const r = sim.buyMixer(s, NOW);
  assert.deepEqual(r, { ok: true, index: 2, cost: 60 });
  assert.equal(s.coins, 40);
  assert.equal(s.stations.mixers.length, 3);
  assert.deepEqual(s.stations.mixers[2], { recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null });
  assert.equal(sim.mixersBought(s), 1);
  assert.ok(s._events.some((e) => e.type === 'mixer' && e.index === 2));
  assert.equal(sim.mixerPurchase(s).cost, 360);
  assert.equal(sim.buyMixer(s, NOW).reason, 'coins');
});

test('buyMixer: a room bought later still adds its mixer; MAX_SLOTS caps both', () => {
  const s = withColors(15);
  s.coins = 1e7;
  assert.equal(sim.buyMixer(s, NOW).ok, true);
  assert.equal(sim.buyRoom(s, { id: 'mill-room' }, NOW).ok, true);
  assert.equal(s.stations.mixers.length, 4, 'two at the start + one bought + the Mill Room');
  while (sim.mixerPurchase(s).available) assert.equal(sim.buyMixer(s, NOW).ok, true);
  assert.equal(s.stations.mixers.length, 5, 'at most two bought mixers; rooms add the rest');
  assert.equal(sim.buyMixer(s, NOW).reason, 'slots');
  for (const c of CATALOG) if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  assert.equal(sim.buyRoom(s, { id: 'mixing-hall' }, NOW).ok, true);
  assert.equal(s.stations.mixers.length, MAX_SLOTS.mixers, 'the Mixing Hall fills the last slot; never above the cap');
});

test('buyMixer: Renovate resets the bought mixers with the other stations', () => {
  const s = withColors(20);
  s.coins = 1e4;
  sim.buyMixer(s, NOW);
  sim.buyMixer(s, NOW);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.equal(sim.renovate(s, NOW + 60e3).ok, true);
  assert.equal(sim.mixersBought(s), 0);
  assert.equal(sim.mixerPurchase(s).cost, 60);
});

test('next(): the cheapest upgrade only in Phase 1, and only while the bottleneck is more than twice her Coins', () => {
  assert.deepEqual({ ...CHEAPEST_FALLBACK }, { maxPhase: 1, savingRatio: 2 });
  const s = withColors(5);
  sim.assignRecipe(s, { mixer: 0, colorId: 'madder' });
  sim.assignRecipe(s, { mixer: 1, colorId: 'woad' });
  s.pendingCollect = 0;
  const pick = sim.flowMeter(s, NOW).suggestion;
  const cheapest = sim.cheapestUpgrade(s);
  assert.ok(pick.cost > cheapest.cost, 'the bottleneck costs more than the cheapest Level up');
  // Far from the bottleneck: Next buys the cheapest Level up.
  s.coins = Math.min(pick.cost / CHEAPEST_FALLBACK.savingRatio - 0.01, 59);
  assert.ok(s.coins >= cheapest.cost);
  let n = sim.next(s, NOW);
  assert.equal(n.why, 'cheapest');
  assert.equal(n.cost, cheapest.cost);
  // Past halfway (and short of the 60-Coin mixer): Next saves for it.
  assert.ok(pick.cost < MIXER_PURCHASE.baseCost, `bottleneck ${pick.cost}`);
  s.coins = pick.cost - 0.01;
  n = sim.next(s, NOW);
  assert.ok(['almost', 'collect'].includes(n.why), n.why);
  // From Phase 2 on, never the cheapest fallback.
  s.phase = 2;
  s.coins = cheapest.cost;
  n = sim.next(s, NOW);
  assert.ok(['almost', 'collect'].includes(n.why), n.why);
});
