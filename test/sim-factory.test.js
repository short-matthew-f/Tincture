import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  stationCost, stationOutput, nextMilestone, puzzleReward, cheapestUpgrade, incomeRate,
  colorPrice, incomeMultiplier, flowMeter, rates,
} from '../src/sim/economy.js';
import {
  tickFactory, collect, buyUpgrade, buyRoom, assignRecipe, rush, addBoost, checkPhase, flow,
} from '../src/sim/factory.js';
import { capacity, stockTotal, stockOf, addStock, takeStock, isFull } from '../src/sim/storage.js';
import { discover } from '../src/sim/discovery.js';
import { CATALOG } from '../src/content/catalog.js';
import {
  currentDemand, dispatch, resolveTrips, autoDispatch, availableRoutes, routeMultiplier, setVehicleRoute,
} from '../src/sim/shipping.js';
import { syncSlots, claimAccident, buyApprentice } from '../src/sim/factory.js';
import { colorFamily } from '../src/sim/economy.js';
import { STATION_KINDS } from '../src/content/stations.js';
import { SOURCES_BY_ID } from '../src/content/sources.js';

const NOW = Date.UTC(2026, 9, 2, 12);
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function orangeState(seed = 7) {
  const s = createInitialState(NOW, seed);
  discover(s, { colorId: 'orange', method: 'bench' }, NOW);
  const r = assignRecipe(s, { mixer: 0, colorId: 'orange' });
  assert.equal(r.ok, true, 'orange is assignable');
  return s;
}

const close = (a, b, rel = 0.01) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

test('economy: cost curves grow 1.15 (vats 1.10), milestones double output', () => {
  assert.equal(stationCost('source', 0, 'madder'), 6); // TUNING.md change 7 (was 10)
  assert.ok(close(stationCost('mixer', 11) / stationCost('mixer', 10), 1.15, 1e-9));
  assert.ok(close(stationCost('grinder', 5) / stationCost('grinder', 4), 1.15, 1e-9));
  assert.ok(close(stationCost('vat', 21) / stationCost('vat', 20), 1.10, 1e-9));
  assert.ok(close(stationCost('vats', 3) / stationCost('vats', 2), 1.10, 1e-9));
  // output(L) = b * L * 2^m
  // Base outputs are tuned by tools/balance (TUNING.md); the formula is what is fixed.
  const b = STATION_KINDS.mixer.baseOutput;
  assert.equal(stationOutput('mixer', 9), b * 9);
  assert.equal(stationOutput('mixer', 10), b * 10 * 2);
  assert.equal(stationOutput('mixer', 25), b * 25 * 4);
  assert.equal(stationOutput('source', 1, 'saffron'), SOURCES_BY_ID.saffron.baseRate);
  assert.equal(stationOutput('vat', 0), 0);
  assert.equal(nextMilestone(1), 10);
  assert.equal(nextMilestone(10), 25);
  assert.equal(nextMilestone(200), null);
});

test('economy: prices, purity and multipliers', () => {
  const s = createInitialState(NOW, 1);
  const p = colorPrice(s, 'madder');
  assert.ok(p > 0);
  assert.ok(close(colorPrice(s, 'madder', 'muddy'), p * 0.8, 1e-9));
  assert.ok(close(colorPrice(s, 'madder', 'flawless'), p * 2, 1e-9));
  s.catalog.discovered.madder.essence = 2;
  assert.ok(close(colorPrice(s, 'madder'), p * 1.1, 1e-9));
  assert.equal(incomeMultiplier(s), 1);
  s.heritage = 4;
  assert.ok(close(incomeMultiplier(s), 1.2, 1e-9));
  addBoost(s, { kind: 'income', mult: 5, minutes: 10 }, NOW);
  assert.ok(close(incomeMultiplier(s, NOW), 1.2 * 3, 1e-9), 'boosts cap at +200%');
});

test('economy: puzzle reward floor dominates early', () => {
  const s = createInitialState(NOW, 1);
  assert.equal(incomeRate(s), 0);
  const cmin = cheapestUpgrade(s).cost;
  assert.ok(cmin > 0 && Number.isFinite(cmin));
  assert.ok(close(puzzleReward(s, 'relaxed'), 0.25 * cmin, 1e-9));
  assert.ok(close(puzzleReward(s, 'master'), 0.25 * 4 * cmin, 1e-9));
  const o = orangeState();
  const r = incomeRate(o);
  assert.ok(r > 0);
  assert.ok(close(puzzleReward(o, 'steady'), Math.max(12 * r * 60, 0.25 * 1.5 * cheapestUpgrade(o).cost), 1e-9));
});

test('factory: an orange mixer has stock after an hour; shop earns into the till', () => {
  const s = orangeState();
  tickFactory(s, NOW + HOUR);
  assert.ok(stockOf(s, 'orange') > 0, 'stock accumulates');
  assert.ok(s.pendingCollect > 0, 'shop sold surplus');
  assert.equal(s.lastTick, NOW + HOUR);
  const before = s.coins;
  const res = collect(s, NOW + HOUR);
  assert.ok(res.coins > 0);
  assert.ok(close(s.coins, before + res.coins, 1e-9));
  assert.equal(s.pendingCollect, 0);
  assert.ok(s.runEarned >= res.coins - 1e-9);
});

test('factory: tick is closed form (3 days == two 1.5-day ticks within 1%)', () => {
  const a = orangeState(11);
  const b = orangeState(11);
  tickFactory(a, NOW + 3 * DAY);
  tickFactory(b, NOW + 1.5 * DAY);
  tickFactory(b, NOW + 3 * DAY);
  assert.ok(close(stockTotal(a), stockTotal(b)), `stock ${stockTotal(a)} vs ${stockTotal(b)}`);
  assert.ok(close(a.pendingCollect, b.pendingCollect), `coins ${a.pendingCollect} vs ${b.pendingCollect}`);
  // And a 3-day tick is fast.
  const c = orangeState(12);
  const t0 = performance.now();
  tickFactory(c, NOW + 30 * DAY);
  assert.ok(performance.now() - t0 < 200);
});

test('factory: production pauses when storage is full, nothing is lost', () => {
  const s = orangeState();
  s.stations.mixers[0].level = 3; // 1.5 jars/s vs shop 0.5 jars/s
  const r = rates(s);
  assert.ok(r.jars > r.shop);
  tickFactory(s, NOW + DAY);
  const cap = capacity(s).total;
  assert.ok(Math.abs(stockTotal(s) - cap) < 1e-6, 'storage is full');
  assert.equal(isFull(s), true);
  assert.equal(s.flags.storageFull, true);
  const till = s.pendingCollect;
  tickFactory(s, NOW + DAY + HOUR);
  assert.ok(Math.abs(stockTotal(s) - cap) < 1e-6, 'still exactly full');
  assert.ok(s.pendingCollect > till, 'shop keeps selling while full');
  assert.equal(addStock(s, 'orange', 10), 0, 'no room left');
  assert.ok(Number.isFinite(flowMeter(s).store.fillMs));
});

test('storage: add/take respect capacity and purity preference', () => {
  const s = createInitialState(NOW, 3);
  const cap = capacity(s);
  assert.equal(cap.total, cap.display + cap.cellar);
  assert.equal(addStock(s, 'madder', 10, 'pure'), 10);
  assert.equal(addStock(s, 'madder', 10, 'muddy'), 10);
  const hi = takeStock(s, 'madder', 5, { prefer: 'high' });
  assert.equal(hi.byPurity.pure, 5);
  const lo = takeStock(s, 'madder', 5, { prefer: 'low' });
  assert.equal(lo.byPurity.muddy, 5);
  assert.equal(stockOf(s, 'madder'), 10);
  assert.equal(addStock(s, 'ochre', 1e9), cap.total - 10);
  assert.equal(takeStock(s, 'nope', 3).taken, 0);
});

test('closed-form flow helper: reserve, full and drain cases', () => {
  // Below reserve: no sales.
  assert.deepEqual(flow(0, 1, 1, 100, 1000, 50), { produced: 50, sold: 0 });
  // Fills to cap then produces only what the shop sells.
  const f = flow(100, 2, 1, 100, 200, 1000);
  assert.ok(close(100 + f.produced - f.sold, 200, 1e-9));
  // Drains to the reserve when the shop outsells production.
  const d = flow(150, 0, 1, 100, 200, 1000);
  assert.equal(d.sold, 50);
});

test('factory: buyUpgrade deducts coins and refuses when poor', () => {
  const s = createInitialState(NOW, 1);
  const cost = stationCost('mixer', 1);
  s.coins = cost - 1;
  assert.equal(buyUpgrade(s, { kind: 'mixer', index: 0 }, NOW).ok, false);
  assert.equal(s.stations.mixers[0].level, 1);
  s.coins = cost + 5;
  const r = buyUpgrade(s, { kind: 'mixer', index: 0 }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.level, 2);
  assert.ok(close(s.coins, 5, 1e-9));
  s.coins = 1e9;
  assert.equal(buyUpgrade(s, { kind: 'source', id: 'madder' }, NOW).level, 2);
  assert.equal(buyUpgrade(s, { kind: 'vat', index: 2 }, NOW).level, 2);
  assert.equal(buyUpgrade(s, { kind: 'shop' }, NOW).level, 2);
  assert.equal(buyUpgrade(s, { kind: 'cellar' }, NOW).level, 2);
  s.stations.mixers[0].level = 9;
  const m = buyUpgrade(s, { kind: 'mixer', index: 0 }, NOW);
  assert.equal(m.milestone, true);
  assert.ok(s._events.some((e) => e.type === 'milestone' && e.level === 10));
});

test('factory: buyRoom enforces colorsRequired, adds slots, gates phase 2', () => {
  const s = createInitialState(NOW, 1);
  s.coins = 1e6;
  const r1 = buyRoom(s, { id: 'mill-room' }, NOW);
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'colors');
  assert.equal(s.coins, 1e6);
  // Mill Room: 15 colors (TUNING.md change 8; the Phase 2 gate's 10 colors is met first).
  const extra = CATALOG.filter((c) => !s.catalog.discovered[c.id]).slice(0, 12);
  for (const c of extra) discover(s, { colorId: c.id, method: 'hunt' }, NOW);
  assert.equal(Object.keys(s.catalog.discovered).length, 15);
  const r2 = buyRoom(s, { id: 'mill-room' }, NOW);
  assert.equal(r2.ok, true);
  assert.equal(s.stations.mixers.length, 3, 'two at the start + the Mill Room');
  assert.equal(s.stations.grinders.length, 2);
  assert.ok(s.rooms.includes('mill-room'));
  assert.equal(s.phase, 2, 'phase 2 at 10 colors + Mill Room');
  assert.ok(s._events.some((e) => e.type === 'phase' && e.phase === 2));
  assert.equal(checkPhase(s, {}, NOW).changed, false);
  assert.equal(buyRoom(s, { id: 'mill-room' }, NOW).reason, 'owned');
});

test('factory: rush adds a batch now and then cools down for 10 minutes', () => {
  const s = orangeState();
  const r = rush(s, { mixer: 0 }, NOW);
  assert.equal(r.ok, true);
  assert.ok(stockOf(s, 'orange') > 0);
  assert.equal(rush(s, { mixer: 0 }, NOW + 60e3).ok, false);
  assert.equal(rush(s, { mixer: 0 }, NOW + 10 * 60e3).ok, true);
});

test('factory: assignRecipe only takes discovered mixable colors', () => {
  const s = createInitialState(NOW, 1);
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, false);
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'madder' }).ok, true);
});


function yardState() {
  const s = orangeState(41);
  s.phase = 2;
  s.rooms.push('loading-yard');
  s.unlocks.shipping = true; // the Loading Yard IS the shipping unlock (v0.2)
  syncSlots(s);
  return s;
}

test('shipping: demand drifts by window, trips pay premium + demand, packed +25%', () => {
  const s = yardState();
  assert.equal(s.stations.fleet.length, 3);
  assert.ok(availableRoutes(s, NOW).some((r) => r.id === 'harbor-town'));
  const d = currentDemand(s, 'harbor-town', NOW);
  assert.ok(['blue', 'teal'].includes(d.family));
  assert.ok(d.bonus >= 0.2 && d.bonus <= 0.6);
  assert.deepEqual(currentDemand(s, 'harbor-town', NOW + 1000), d, 'stable within a window');
  addStock(s, 'woad', 40);
  const r = dispatch(s, { vehicle: 0, routeId: 'harbor-town', cargo: [{ colorId: 'woad', jars: 20 }], packed: true }, NOW);
  assert.equal(r.ok, true);
  assert.equal(stockOf(s, 'woad'), 20);
  assert.equal(dispatch(s, { vehicle: 0, routeId: 'harbor-town', cargo: [{ colorId: 'woad', jars: 5 }] }, NOW).ok, false, 'busy');
  assert.equal(resolveTrips(s, r.arrivesAt - 1).trips, 0);
  const coins = s.coins;
  const res = resolveTrips(s, r.arrivesAt);
  assert.equal(res.trips, 1);
  const m = routeMultiplier(s, 'harbor-town', 'woad', 'standard', r.arrivesAt);
  const expected = 20 * colorPrice(s, 'woad') * m * 1.25 * incomeMultiplier(s, r.arrivesAt);
  assert.ok(Math.abs(s.coins - coins - expected) < 1e-9);
  if (colorFamily('woad') === 'blue' || colorFamily('woad') === 'teal') assert.ok(m >= 1.4);
  assert.equal(s.stations.fleet[0].arrivesAt, 0, 'vehicle is home');
});

test('shipping: the Dispatcher ships on its own, also across a long absence', () => {
  const s = yardState();
  s.stations.mixers[0].level = 5;
  s.apprentices.dispatcher = true;
  s.apprentices.errandRunner = true;
  setVehicleRoute(s, { vehicle: 0, routeId: 'weavers-row' });
  addStock(s, 'orange', 100);
  const a = autoDispatch(s, NOW);
  assert.equal(a.dispatched, 1);
  const coins = s.coins;
  tickFactory(s, NOW + 3 * DAY);
  assert.ok(s.coins > coins);
  assert.ok(Number.isFinite(s.coins));
});

test('factory: happy accidents appear with running production and can be claimed', () => {
  const s = orangeState(5);
  tickFactory(s, NOW + 8 * HOUR);
  const m = s.stations.mixers[0];
  assert.ok(m.accident, 'a mixer glows after hours of production');
  assert.ok(s._events.some((e) => e.type === 'accident' && e.mixerIndex === 0));
  const before = Object.keys(s.catalog.discovered).length;
  const r = claimAccident(s, { mixer: 0 }, NOW + 8 * HOUR);
  assert.equal(r.ok, true);
  if (r.kind === 'tint') assert.equal(Object.keys(s.catalog.discovered).length, before + 1);
  else assert.ok(s.stock.orange.purity.flawless > 0);
  assert.equal(m.accident, null);
});

test('factory: Errand Runner auto-collects shop income', () => {
  const s = orangeState(6);
  assert.equal(buyApprentice(s, { id: 'errandRunner' }).ok, true);
  tickFactory(s, NOW + HOUR);
  assert.ok(s.coins > 0);
  assert.equal(s.pendingCollect ?? 0, 0);
});

test('factory: a boost that ends mid-tick only counts until it ends', () => {
  const s = orangeState(8);
  s.cellarLevel = 5000; // never full
  const base = rates(s, NOW).jars;
  addBoost(s, { kind: 'production', mult: 1, minutes: 10 }, NOW);
  assert.ok(Math.abs(rates(s, NOW).jars - 2 * base) < 1e-9);
  const out = tickFactory(s, NOW + HOUR);
  assert.ok(Math.abs(out.produced - base * (2 * 600 + 3000)) < 1e-6, `${out.produced}`);
  assert.equal(s.boosts.length, 0, 'expired boosts are cleared');
});

// ---------------------------------------------------------------------------
// Muddy batches (v0.2 Theme C): a production-time clock, backlog 10, offline 3
// ---------------------------------------------------------------------------

import {
  MUDDY_PENDING_MAX, MUDDY_OFFLINE_MAX, MUDDY_WINDOW_MS, purifyBatch, sellMuddyBatch, sellAllMuddy, muddyValue,
} from '../src/sim/factory.js';
import { catchUp } from '../src/sim/offline.js';
import { isAllCaughtUp, pendingItems, buildReturnSummary, snapshot } from '../src/sim/ledger.js';
import { TIERS as PURIFY_TIERS } from '../src/puzzles/purify.js';

function muddyState(seed = 3) {
  const s = orangeState(seed);
  s.onboarding.done = true; // the tutorial grace period is over
  assert.equal(assignRecipe(s, { mixer: 1, colorId: 'madder' }).ok, true);
  s.stations.mixers.forEach((m) => { m.level = 20; }); // fast mixers: the old per-batch roll flooded here
  s.cellarLevel = 400; // storage never fills: production runs the whole time
  return s;
}

test('muddy: over 8 hours of play, at most one batch per 2 minutes and never more than 10 waiting', () => {
  const s = muddyState();
  const spawned = [];
  let t = NOW;
  let maxPending = 0;
  for (let k = 1; k <= 8 * 360; k++) { // 10-second ticks
    t = NOW + k * 10e3;
    const before = new Set(s.muddyBatches.map((b) => b.id));
    tickFactory(s, t);
    for (const b of s.muddyBatches) if (!before.has(b.id)) spawned.push(b);
    maxPending = Math.max(maxPending, s.muddyBatches.length);
    // She sorts the backlog now and then (every 40 minutes), but not always.
    if (k % 240 === 0 && k < 6 * 360) sellAllMuddy(s, {}, t);
  }
  assert.ok(maxPending <= MUDDY_PENDING_MAX, `pending ${maxPending}`);
  assert.equal(maxPending, MUDDY_PENDING_MAX, 'the backlog does reach its cap when left alone');
  assert.ok(spawned.length <= (8 * 60) / 2, `at most one per 2 min (got ${spawned.length})`);
  assert.ok(spawned.length >= 20, `purify stays frequent (got ${spawned.length})`);
  for (let i = 1; i < spawned.length; i++) {
    assert.ok(spawned[i].at - spawned[i - 1].at >= MUDDY_WINDOW_MS.min - 1, `gap ${spawned[i].at - spawned[i - 1].at}`);
  }
  for (const b of spawned) {
    assert.equal(b.tier, null, 'tier chosen when she opens it');
    assert.ok(b.jars > 0 && b.value > 0);
    assert.ok(['orange', 'madder'].includes(b.color));
  }
});

test('muddy: nothing spawns while no mixer produces; the clock counts production time only', () => {
  const s = createInitialState(NOW, 4);
  tickFactory(s, NOW + 2 * HOUR);
  assert.equal(s.muddyBatches.length, 0);
  assert.equal(s.nextMuddyAt, 0);
  const m = muddyState(5);
  tickFactory(m, NOW + 1000);
  const due = m.nextMuddyAt;
  assert.ok(due >= NOW + MUDDY_WINDOW_MS.min && due <= NOW + 1000 + MUDDY_WINDOW_MS.max);
  m.stations.mixers.forEach((x) => { x.recipe = null; });
  tickFactory(m, NOW + 1000 + HOUR);
  assert.equal(m.muddyBatches.length, 0, 'an idle hour adds nothing');
  assert.ok(Math.abs(m.nextMuddyAt - (due + HOUR)) < 1, 'the idle hour pushed the clock back');
});

test('muddy: an offline catch-up adds at most 3 batches', () => {
  const s = muddyState(8);
  tickFactory(s, NOW + 1000);
  s.lastSeenAt = NOW + 1000;
  const summary = catchUp(s, NOW + 3 * DAY);
  assert.ok(summary);
  assert.equal(s.muddyBatches.length, MUDDY_OFFLINE_MAX);
  // A one-hour absence: still 3 at most.
  sellAllMuddy(s, {}, NOW + 3 * DAY);
  catchUp(s, NOW + 3 * DAY + HOUR);
  assert.ok(s.muddyBatches.length <= MUDDY_OFFLINE_MAX);
  // Live play after the return keeps the 2-3 minute pace.
  const n = s.muddyBatches.length;
  for (let k = 1; k <= 60; k++) tickFactory(s, NOW + 3 * DAY + HOUR + k * 10e3);
  assert.ok(s.muddyBatches.length - n <= 5 && s.muddyBatches.length - n >= 3, `${s.muddyBatches.length - n} in 10 minutes`);
});

test('muddy: purifyBatch sets purity by tier and pays the puzzle reward', () => {
  const expectPurity = { relaxed: 'pure', steady: 'pure', tricky: 'flawless', master: 'flawless' };
  for (const tier of Object.keys(PURIFY_TIERS)) {
    const s = muddyState(11);
    s.muddyBatches = [{ id: 'b', color: 'orange', jars: 5, value: 1, at: NOW, tier: null }];
    const reward = puzzleReward(s, tier, { k: PURIFY_TIERS[tier].k, now: NOW });
    const coins = s.coins;
    const before = s.stock.orange ? s.stock.orange.purity[expectPurity[tier]] : 0;
    const r = purifyBatch(s, { batchId: 'b', tier }, NOW);
    assert.equal(r.ok, true);
    assert.equal(r.purity, expectPurity[tier]);
    assert.equal(r.tier, tier);
    assert.ok(reward > 0);
    assert.ok(close(r.reward, reward, 1e-9));
    assert.ok(close(s.coins - coins, r.coins, 1e-9));
    assert.ok(r.coins >= reward - 1e-9);
    assert.ok(close(s.stock.orange.purity[expectPurity[tier]] - before, 5, 1e-9), tier);
    assert.equal(s.muddyBatches.length, 0);
  }
  // Bigger tiers pay more minutes.
  const s = muddyState(12);
  const ks = Object.keys(PURIFY_TIERS).map((t) => puzzleReward(s, t, { k: PURIFY_TIERS[t].k, now: NOW }));
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i] >= ks[i - 1]);
  assert.equal(purifyBatch(s, { batchId: 'missing', tier: 'relaxed' }, NOW).ok, false);
});

test('muddy: sellAllMuddy sells every batch as is in one go', () => {
  const s = muddyState(13);
  s.muddyBatches = [
    { id: 'a', color: 'orange', jars: 5, value: 0, at: NOW, tier: null },
    { id: 'b', color: 'madder', jars: 3, value: 0, at: NOW, tier: null },
  ];
  s.activePuzzles = { purify: { batchId: 'a' } };
  const total = muddyValue(s, NOW);
  const expect = (5 * colorPrice(s, 'orange', 'muddy') + 3 * colorPrice(s, 'madder', 'muddy')) * incomeMultiplier(s, NOW);
  assert.ok(close(total, expect, 1e-9));
  const coins = s.coins;
  const r = sellAllMuddy(s, {}, NOW);
  assert.deepEqual({ ok: r.ok, batches: r.batches, jars: r.jars }, { ok: true, batches: 2, jars: 8 });
  assert.ok(close(r.coins, expect, 1e-9));
  assert.ok(close(s.coins - coins, expect, 1e-9));
  assert.deepEqual(s.muddyBatches, []);
  assert.equal(s.activePuzzles.purify, null);
  assert.equal(sellAllMuddy(s, {}, NOW).ok, false);
  assert.equal(sellMuddyBatch(s, { batchId: 'a' }, NOW).ok, false);
});

test('muddy: waiting batches never block All caught up; the Ledger line is optional', () => {
  const s = createInitialState(NOW, 14);
  s.muddyBatches = [1, 2, 3].map((i) => ({ id: `m${i}`, color: 'madder', jars: 5, value: 4, at: NOW, tier: null }));
  assert.ok(!pendingItems(s).includes('muddy'));
  assert.equal(isAllCaughtUp(s), true);
  const before = snapshot(s);
  const summary = buildReturnSummary(s, before, NOW + HOUR);
  const line = summary.lines.find((l) => l.icon === 'tube');
  assert.ok(line, 'the Ledger still mentions them');
  assert.equal(line.text, '3 muddy batches to sort, if you like');
  assert.equal(line.optional, true);
});
