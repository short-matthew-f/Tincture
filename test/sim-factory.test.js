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
  assert.equal(stationCost('source', 0, 'madder'), 10);
  assert.ok(close(stationCost('mixer', 11) / stationCost('mixer', 10), 1.15, 1e-9));
  assert.ok(close(stationCost('grinder', 5) / stationCost('grinder', 4), 1.15, 1e-9));
  assert.ok(close(stationCost('vat', 21) / stationCost('vat', 20), 1.10, 1e-9));
  assert.ok(close(stationCost('vats', 3) / stationCost('vats', 2), 1.10, 1e-9));
  // output(L) = b * L * 2^m
  assert.equal(stationOutput('mixer', 9), 0.5 * 9);
  assert.equal(stationOutput('mixer', 10), 0.5 * 10 * 2);
  assert.equal(stationOutput('mixer', 25), 0.5 * 25 * 4);
  assert.equal(stationOutput('source', 1, 'saffron'), 1.6);
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
  const extra = CATALOG.filter((c) => !s.catalog.discovered[c.id]).slice(0, 7);
  for (const c of extra) discover(s, { colorId: c.id, method: 'hunt' }, NOW);
  assert.equal(Object.keys(s.catalog.discovered).length, 10);
  const r2 = buyRoom(s, { id: 'mill-room' }, NOW);
  assert.equal(r2.ok, true);
  assert.equal(s.stations.mixers.length, 2);
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
