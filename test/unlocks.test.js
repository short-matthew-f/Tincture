// Coin-bought unlocks, spillover before the shelf, the shop keep reserve, the
// discovery slowdown and the single Next button (docs/V02-CONTRACTS.md, Theme A).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import {
  UNLOCKS, status, canBuy, buy, batchRebuy, rebuyQuote, tierRevealed, REBUY_SHARE,
} from '../src/sim/unlocks.js';
import { CATALOG } from '../src/content/catalog.js';
import * as grading from '../src/puzzles/grading.js';
import { mulberry32 } from '../src/rng.js';

const NOW = Date.UTC(2026, 9, 5, 9);
const MIN = 60e3;
const HOUR = 3600e3;

/** A fresh workshop with `n` discovered colors (the three primaries count). */
function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}

const events = (s, type) => s._events.filter((e) => e.type === type);

test('UNLOCKS: the contract table', () => {
  assert.deepEqual(UNLOCKS.map((u) => [u.id, u.revealColors, u.cost]), [
    ['shelf', 8, 400], ['hunters', 15, 2500], ['gallery', 25, 8000], ['shipping', 35, 40000], ['commissions', 30, 20000],
  ]);
  assert.equal(UNLOCKS.find((u) => u.id === 'gallery').room, 'gallery-wing');
  assert.equal(UNLOCKS.find((u) => u.id === 'shipping').room, 'loading-yard');
  assert.equal(UNLOCKS.find((u) => u.id === 'commissions').requiresPhase, 3);
  // The rooms that ARE unlocks cost the same and reveal at the same count.
  for (const u of UNLOCKS.filter((x) => x.room)) {
    const r = sim.ROOMS.find((x) => x.id === u.room);
    assert.equal(r.cost, u.cost, u.id);
    assert.equal(r.colorsRequired, u.revealColors, u.id);
    assert.equal(r.unlock, u.id);
  }
});

test('status: the price shows from the start; colors reveal it; nothing opens by itself', () => {
  const s = withColors(5);
  s.coins = 1e6;
  const st = status(s, 'shelf');
  assert.equal(st.cost, 400);
  assert.equal(st.colorsLeft, 3);
  assert.equal(st.revealed, false);
  assert.equal(st.affordable, true);
  assert.equal(st.open, false);
  assert.equal(canBuy(s, 'shelf'), false);
  assert.deepEqual(buy(s, { id: 'shelf' }, NOW), { ok: false, reason: 'colors', need: 3 });
  assert.equal(s.coins, 1e6);
  assert.equal(status(s, 'nope'), null);
  assert.equal(buy(s, { id: 'nope' }, NOW).reason, 'unknown');
  // 40 colors and Phase 2: still nothing is open until bought.
  const t = withColors(40);
  t.phase = 2;
  sim.tick(t, NOW + HOUR);
  for (const u of UNLOCKS) assert.equal(t.unlocks[u.id], false, u.id);
  assert.equal(sim.shelfUnlocked(t), false);
  assert.equal(sim.huntersUnlocked(t), false);
  assert.equal(sim.galleryOpen(t), false);
  assert.deepEqual(sim.availableRoutes(t, NOW), []);
});

test('buy(shelf): coins, flag, unlock event; once only', () => {
  const s = withColors(8);
  s.coins = 399;
  assert.deepEqual(buy(s, { id: 'shelf' }, NOW), { ok: false, reason: 'coins', cost: 400 });
  s.coins = 450;
  assert.equal(canBuy(s, 'shelf'), true);
  assert.deepEqual(buy(s, { id: 'shelf' }, NOW), { ok: true, id: 'shelf', cost: 400 });
  assert.equal(s.coins, 50);
  assert.equal(s.unlocks.shelf, true);
  assert.equal(sim.shelfUnlocked(s), true);
  assert.deepEqual(events(s, 'unlock').map((e) => e.id), ['shelf']);
  assert.equal(buy(s, { id: 'shelf' }, NOW).reason, 'open');
});

test('buy(hunters): the map window opens and Wren joins free', () => {
  const s = withColors(15);
  s.coins = 2500;
  assert.equal(buy(s, { id: 'hunters' }, NOW).ok, true);
  assert.equal(s.coins, 0);
  assert.ok(sim.huntersUnlocked(s));
  assert.ok(s.hunters.roster.some((h) => h.id === 'wren'));
  assert.ok(s.hunters.regionsUnlocked.includes('meadow'));
});

test('buy(gallery): buys the Gallery Wing once (the room IS the purchase); needs Phase 2', () => {
  const s = withColors(25);
  s.coins = 20000;
  assert.equal(buy(s, { id: 'gallery' }, NOW).reason, 'phase', 'the Wing is a Phase 2 room');
  s.phase = 2;
  assert.equal(buy(s, { id: 'gallery' }, NOW).ok, true);
  assert.equal(s.coins, 12000, 'charged 8,000 once');
  assert.ok(s.rooms.includes('gallery-wing'));
  assert.equal(s.unlocks.gallery, true);
  assert.equal(s.gallery.unlocked, true, 'the mirror follows');
  assert.ok(s.gallery.canvases.length > 0, 'starter canvases');
  assert.equal(events(s, 'unlock').length, 1);
  assert.equal(sim.buyRoom(s, { id: 'gallery-wing' }, NOW).reason, 'owned');
  // Buying the room from the rooms list is the same purchase.
  const t = withColors(25, 2);
  t.phase = 2;
  t.coins = 8000;
  assert.equal(sim.buyRoom(t, { id: 'gallery-wing' }, NOW).ok, true);
  assert.equal(t.unlocks.gallery, true);
  assert.equal(t.coins, 0);
  assert.equal(status(t, 'gallery').open, true);
});

test('buy(shipping): the Loading Yard opens routes and a fleet', () => {
  const s = withColors(35);
  s.phase = 2;
  s.coins = 40000;
  assert.equal(buy(s, { id: 'shipping' }, NOW).ok, true);
  assert.equal(s.coins, 0);
  assert.ok(s.rooms.includes('loading-yard'));
  assert.equal(s.stations.fleet.length, 3);
  assert.ok(sim.availableRoutes(s, NOW).length > 0);
});

test('buy(commissions): revealed in Phase 3; offers appear once bought', () => {
  const s = withColors(35);
  s.coins = 1e6;
  assert.equal(buy(s, { id: 'commissions' }, NOW).reason, 'phase');
  s.phase = 3;
  sim.tick(s, NOW + MIN);
  assert.deepEqual(s.commissions.open, [], 'Phase 3 alone opens nothing');
  assert.equal(buy(s, { id: 'commissions' }, NOW + MIN).ok, true);
  assert.ok(s.commissions.open.length > 0);
});

test('spillover before the shelf: vials wait behind the glass from 6 colors, cap 12, then land on the bought shelf', () => {
  const few = withColors(5);
  assert.equal(sim.assignRecipe(few, { mixer: 0, colorId: 'madder' }).ok, true);
  sim.tickFactory(few, NOW + MIN);
  sim.tickFactory(few, NOW + 5 * HOUR);
  assert.equal(few.shelf.waiting, 0, 'nothing waits below 6 colors');

  const s = withColors(8);
  assert.equal(sim.assignRecipe(s, { mixer: 0, colorId: 'madder' }).ok, true);
  assert.equal(sim.assignRecipe(s, { mixer: 1, colorId: 'woad' }).ok, true);
  sim.tickFactory(s, NOW + MIN); // schedules the first
  sim.tickFactory(s, NOW + 36 * MIN);
  assert.equal(s.shelf.waiting, 3);
  assert.ok(s.shelf.cells.every((c) => c === null), 'nothing on the closed shelf');
  assert.ok(events(s, 'shelfWaiting').length > 0);
  sim.tickFactory(s, NOW + 2 * 86400e3);
  assert.equal(s.shelf.waiting, 12, 'capped at 12');
  s.coins = 400;
  assert.equal(buy(s, { id: 'shelf' }, NOW + 2 * 86400e3).ok, true);
  assert.equal(s.shelf.waiting, 0);
  const vials = s.shelf.cells.filter(Boolean);
  assert.equal(vials.length, 12);
  assert.deepEqual([...new Set(vials.map((v) => v.color))].sort(), ['madder', 'woad']);
  assert.ok(vials.every((v) => v.tier === 1 && v.unit > 0));
  assert.deepEqual(s.shelf.colors, ['madder', 'woad']);
  // From now on spillover places real vials.
  sim.tickFactory(s, NOW + 2 * 86400e3 + 25 * MIN);
  assert.ok(s.shelf.cells.filter(Boolean).length > 12);
  assert.equal(s.shelf.waiting, 0);
});

test('shop keep reserve: pinned colors and started paintings keep 20 jars; explicit keep overrides', () => {
  const make = (seed) => {
    const s = withColors(6, seed);
    sim.discover(s, { colorId: 'orange', method: 'bench' }, NOW);
    assert.equal(sim.assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
    s.stations.shop.level = 200; // the shop sells far faster than the mixer makes
    s.apprentices.errandRunner = true;
    return s;
  };
  const plain = make(3);
  sim.tickFactory(plain, NOW + 6 * HOUR);
  // The shop sells down to its small working stock (factory.shopReserve).
  const plainLeft = sim.stockOf(plain, 'orange');
  assert.ok(Math.abs(plainLeft - sim.shopReserve(plain)) < 1, `the shop sells it down (left ${plainLeft})`);
  assert.equal(sim.keepOf(plain, 'orange'), 0);

  // catalog.pinned holds hunt targets (discovery unpins them), so a pinned
  // color with stock only arises from a direct write; the rule still holds.
  const pinned = make(3);
  pinned.catalog.pinned.push('orange');
  assert.equal(sim.keepOf(pinned, 'orange'), 20);
  sim.tickFactory(pinned, NOW + 6 * HOUR);
  assert.ok(sim.stockOf(pinned, 'orange') >= plainLeft + 20 - 0.5, `kept ${sim.stockOf(pinned, 'orange')}`);
  assert.ok(pinned.coins > 0, 'the surplus still sells');

  // Split ticks land where one long tick does.
  const split = make(3);
  split.catalog.pinned.push('orange');
  for (let k = 1; k <= 72; k++) sim.tickFactory(split, NOW + k * 5 * MIN);
  assert.ok(Math.abs(sim.stockOf(split, 'orange') - sim.stockOf(pinned, 'orange')) < 0.5,
    `split ${sim.stockOf(split, 'orange')} vs one ${sim.stockOf(pinned, 'orange')}`);

  const off = make(3);
  off.catalog.pinned.push('orange');
  assert.deepEqual(sim.setKeep(off, { colorId: 'orange', jars: 0 }), { ok: true, colorId: 'orange', jars: 0 });
  sim.tickFactory(off, NOW + 6 * HOUR);
  assert.ok(Math.abs(sim.stockOf(off, 'orange') - plainLeft) < 1e-6, 'keep 0 sells like before');

  const big = make(3);
  sim.setKeep(big, { colorId: 'orange', jars: 50 });
  assert.equal(big.keep.orange, 50);
  sim.tickFactory(big, NOW + 12 * HOUR);
  assert.ok(sim.stockOf(big, 'orange') >= plainLeft + 50 - 0.5);
  assert.equal(sim.setKeep(big, { colorId: 'orange', jars: null }).jars, 0, 'back to the default rule');
  assert.equal(sim.setKeep(big, { colorId: 'orange', jars: 'x' }).ok, false);

  // A started (unsigned) painting keeps its colors.
  const p = make(4);
  p.gallery.pieces.push({ id: 'p1', canvas: 'harbor-window', title: '', regions: { r0: 'orange' }, purity: {}, jars: {}, startedAt: NOW, signedAt: 0, value: 0, hung: false });
  assert.equal(sim.keepOf(p, 'orange'), 20);
  p.gallery.pieces[0].signedAt = NOW;
  assert.equal(sim.keepOf(p, 'orange'), 0, 'signed pieces no longer hold paint');
});

test('the Dispatcher never ships kept jars', () => {
  const s = withColors(35);
  s.phase = 2;
  s.coins = 40000;
  assert.equal(buy(s, { id: 'shipping' }, NOW).ok, true);
  s.apprentices.dispatcher = true;
  s.stations.fleet.forEach((v, i) => sim.setVehicleRoute(s, { vehicle: i, routeId: sim.availableRoutes(s, NOW).find((r) => r.any)?.id ?? sim.availableRoutes(s, NOW)[0].id }));
  sim.addStock(s, 'madder', 30, 'standard');
  sim.setKeep(s, { colorId: 'madder', jars: 30 });
  sim.autoDispatch(s, NOW);
  assert.equal(sim.stockOf(s, 'madder'), 30);
  assert.ok(s.stations.fleet.every((v) => !v.cargo));
});

test('Renovate closes the unlocks, lists them, and one half-price purchase reopens them all', () => {
  const s = withColors(40);
  s.phase = 2;
  s.coins = 1e6;
  for (const id of ['shelf', 'hunters', 'gallery', 'shipping']) assert.equal(buy(s, { id }, NOW).ok, true, id);
  s.phase = 3;
  assert.equal(buy(s, { id: 'commissions' }, NOW).ok, true);
  s.runEarned = 4e8;
  assert.deepEqual(sim.renovateCloses(s), ['shelf', 'hunters', 'gallery', 'shipping', 'commissions']);
  assert.equal(sim.renovate(s, NOW + MIN).ok, true);
  assert.deepEqual(Object.values(s.unlocks), [false, false, false, false, false]);
  assert.deepEqual(s.renovateReopen, ['shelf', 'hunters', 'gallery', 'shipping', 'commissions']);
  assert.equal(s.gallery.unlocked, false);
  const q = rebuyQuote(s);
  assert.equal(q.cost, Math.round((400 + 2500 + 8000 + 40000 + 20000) * REBUY_SHARE));
  assert.deepEqual(q.ids, s.renovateReopen);
  s.coins = q.cost - 1;
  assert.equal(batchRebuy(s, NOW + 2 * MIN).reason, 'coins');
  s.coins = q.cost;
  s._events = [];
  const r = batchRebuy(s, {}, NOW + 2 * MIN);
  assert.deepEqual(r, { ok: true, cost: q.cost, ids: q.ids });
  assert.equal(s.coins, 0);
  assert.deepEqual(Object.values(s.unlocks), [true, true, true, true, true]);
  assert.ok(s.rooms.includes('gallery-wing') && s.rooms.includes('loading-yard'), 'rooms come back with their unlocks');
  assert.equal(s.gallery.unlocked, true);
  assert.deepEqual(events(s, 'unlock').map((e) => e.id).sort(), [...q.ids].sort());
  assert.deepEqual(s.renovateReopen, []);
  assert.equal(batchRebuy(s, NOW).reason, 'none');
});

test('buying one unlock after Renovate takes it off the re-buy list', () => {
  const s = withColors(20);
  s.coins = 1e5;
  buy(s, { id: 'shelf' }, NOW);
  buy(s, { id: 'hunters' }, NOW);
  s.phase = 3;
  s.runEarned = 4e8;
  sim.renovate(s, NOW);
  s.coins = 400;
  assert.equal(buy(s, { id: 'shelf' }, NOW).ok, true);
  assert.deepEqual(rebuyQuote(s), { ids: ['hunters'], cost: 1250 });
});

test('Heritage keep-shelf / keep-map / keep-gallery skip the reset for that unlock', () => {
  const s = withColors(30);
  s.phase = 2;
  s.coins = 1e6;
  for (const id of ['shelf', 'hunters', 'gallery']) assert.equal(buy(s, { id }, NOW).ok, true, id);
  s.heritage = 10;
  for (const id of ['keep-shelf', 'keep-map', 'keep-gallery']) {
    const r = sim.buyHeritageNode(s, { id });
    assert.equal(r.ok, true, id);
    assert.equal(r.cost, 2);
  }
  assert.deepEqual(sim.heritageEffects(s).keepUnlocks, ['shelf', 'hunters', 'gallery']);
  assert.deepEqual(sim.renovateCloses(s), []);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.equal(sim.renovate(s, NOW).ok, true);
  assert.deepEqual(s.unlocks, { shelf: true, hunters: true, gallery: true, shipping: false, commissions: false });
  assert.deepEqual(s.renovateReopen, []);
  assert.equal(s.gallery.unlocked, true);
  assert.ok(sim.huntersUnlocked(s));
});

test('grading tiers are free and revealed by colors: Steady 10, Tricky 25, Master 45', () => {
  assert.equal(tierRevealed(withColors(3), 'relaxed'), true);
  for (const [tier, n] of [['steady', 10], ['tricky', 25], ['master', 45]]) {
    assert.equal(tierRevealed(withColors(n - 1), tier), false, tier);
    assert.equal(tierRevealed(withColors(n), tier), true, tier);
  }
  assert.equal(tierRevealed(withColors(90), 'nonsense'), false);
});

test('discovery slowdown: revealed tints 1/1/2/2; happy accidents every 4 h in Phase 1, 6 h later', () => {
  assert.deepEqual({ ...grading.REVEALED_TINTS }, { relaxed: 1, steady: 1, tricky: 2, master: 2 });
  const palette = CATALOG.slice(0, 12).map((c) => c.hex);
  for (const tier of ['relaxed', 'steady', 'tricky', 'master']) {
    const rng = mulberry32(7);
    const board = grading.createBoard({ tier, palette }, rng);
    assert.equal(grading.revealedTints(board, rng).length, grading.REVEALED_TINTS[tier], tier);
  }
  assert.equal(sim.ACCIDENT_MS.phase1, 4 * HOUR);
  assert.equal(sim.ACCIDENT_MS.later, 6 * HOUR);
});

test('next(): a recipe first, then an affordable unlock above upgrades, else the bottleneck, else Collect', () => {
  const s = withColors(8);
  let n = sim.next(s, NOW);
  assert.equal(n.action.kind, 'assign');
  assert.equal(n.why, 'recipe');
  sim.assignRecipe(s, { mixer: 0, colorId: 'madder' });
  n = sim.next(s, NOW);
  assert.equal(n.action.kind, 'assign', 'the idle second mixer');
  assert.equal(n.action.mixer, 1);
  sim.assignRecipe(s, { mixer: 1, colorId: 'woad' });
  s.coins = 0;
  s.pendingCollect = 0;
  n = sim.next(s, NOW);
  assert.ok(['navigate', 'collect'].includes(n.action.kind), n.label);
  s.coins = 500;
  n = sim.next(s, NOW);
  assert.equal(n.kind, 'unlock');
  assert.deepEqual(n.action, { kind: 'unlock', id: 'shelf' });
  assert.equal(n.label, 'Open the Merge Shelf for 400');
  assert.equal(n.cost, 400);
  assert.equal(n.affordable, true);
  buy(s, n.action, NOW);
  s.coins = 1e4;
  n = sim.next(s, NOW);
  assert.equal(n.kind, 'upgrade');
  assert.ok(['bottleneck', 'cheapest'].includes(n.why));
  assert.ok(n.cost <= s.coins);
  assert.equal(sim.buyUpgrade(s, { kind: n.action.upgrade, index: n.action.index, id: n.action.id }, NOW).ok, true);
  const json = JSON.stringify(s);
  sim.next(s, NOW);
  assert.equal(JSON.stringify(s), json, 'next() is a pure read');
  // After Renovate the batch re-buy comes first when affordable.
  const r = withColors(20);
  r.coins = 1e5;
  buy(r, { id: 'shelf' }, NOW);
  buy(r, { id: 'hunters' }, NOW);
  r.phase = 3;
  r.runEarned = 4e8;
  sim.renovate(r, NOW);
  sim.assignRecipe(r, { mixer: 0, colorId: 'madder' });
  sim.assignRecipe(r, { mixer: 1, colorId: 'woad' });
  r.coins = 2000;
  n = sim.next(r, NOW);
  assert.equal(n.kind, 'rebuy');
  assert.equal(n.cost, 1450);
  assert.equal(n.label, 'Reopen the Merge Shelf and Hue Hunters for 1.4K');
});

test('Almost there suggests an unlock that is ready to open', () => {
  const s = withColors(8);
  s.coins = 400;
  const items = sim.almostThere(s, NOW);
  assert.ok(items.some((i) => i.icon === 'unlock' && i.params.unlock === 'shelf' && /Merge Shelf is ready/.test(i.text)), JSON.stringify(items));
  const t = withColors(7);
  assert.ok(sim.almostThere(t, NOW).some((i) => i.icon === 'unlock' && /One more color and the Merge Shelf/.test(i.text)));
});
