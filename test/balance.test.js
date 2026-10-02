// Balance regression suite: docs/DESIGN.md "Balance model and testing" ›
// "Automated balance tests". Drives the real engine with the scripted players in
// tools/balance/sim-player.js (5 seeds per profile, 21 days, run across worker
// threads by tools/balance/parallel.js) plus a few unit checks. Tuning notes and
// the pacing table live in tools/balance/TUNING.md; `node tools/balance/run.js`
// prints the full tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJobs } from '../tools/balance/parallel.js';
import {
  jobsFor, group, median, coinsPerActiveMinute, minWindowAfterDay1, PROFILE_ORDER, TIER_ORDER,
} from '../tools/balance/report.js';
import { createInitialState } from '../src/state.js';
import { score, SCORE_TIERS } from '../src/puzzles/matching.js';
import { mulberry32 } from '../src/rng.js';
import { discover } from '../src/sim/discovery.js';
import { assignRecipe, tickFactory } from '../src/sim/factory.js';
import { rates, incomeMultiplier } from '../src/sim/economy.js';
import {
  TIER_VALUES, MAX_TIER, addVial, containerValue, merge, unlocked as shelfUnlocked,
} from '../src/sim/shelf.js';
import { refreshOrders, submitOrder } from '../src/sim/orders.js';
import { renovate } from '../src/sim/prestige.js';

const SEEDS = 5;
const DAYS = 21;
const NOW = Date.UTC(2026, 9, 5, 8);
const HOUR = 3600e3;

// All 45 runs (3 profiles × with/without puzzles × 5 seeds, plus Casual at
// Relaxed, Tricky and Master), started once and shared by every test below.
const runs = runJobs(jobsFor({ seeds: SEEDS, days: DAYS })).then(group);

test('balance runs complete for every profile and tier', async () => {
  const g = await runs;
  for (const p of PROFILE_ORDER) {
    assert.equal(g[p]?.length, SEEDS, p);
    assert.equal(g[p + '-np']?.length, SEEDS, p + ' no puzzles');
  }
  for (const t of TIER_ORDER) assert.equal(g['casual@' + t]?.length, SEEDS, t);
});

test('active play: an upgrade is affordable within 5 minutes of continuous puzzles (every profile, seed, day)', async () => {
  const g = await runs;
  const withPuzzles = [...PROFILE_ORDER, ...TIER_ORDER.map((t) => 'casual@' + t)];
  for (const k of withPuzzles) {
    for (const r of g[k]) {
      assert.ok(r.activeMinutes > 0, `${k} seed ${r.seed} played`);
      assert.ok(r.worstGapMin <= 5, `${k} seed ${r.seed}: worst gap ${r.worstGapMin} min on day ${r.worstGapAt?.toFixed(1)}`);
    }
  }
});

test('a no-puzzle Casual player reaches Phase 2 within 3 days', async () => {
  const g = await runs;
  for (const r of g['casual-np']) {
    assert.ok(r.milestones.phase2 !== null && r.milestones.phase2 <= 3, `seed ${r.seed}: Phase 2 on day ${r.milestones.phase2}`);
  }
});

test('the Casual profile first reaches Renovate between day 5 and day 8', async () => {
  const g = await runs;
  const days = g.casual.map((r) => r.milestones.renovate);
  const m = median(days);
  assert.ok(m !== null && m >= 5 && m <= 8, `median first Renovate day ${m} (runs: ${days.join(', ')})`);
});

test('Relaxed reaches Renovate within 2 days of Master on Casual sessions', async () => {
  const g = await runs;
  const relaxed = median(g['casual@relaxed'].map((r) => r.milestones.renovate));
  const master = median(g['casual@master'].map((r) => r.milestones.renovate));
  assert.ok(relaxed !== null && master !== null, 'both tiers renovate');
  assert.ok(relaxed - master <= 2, `Relaxed day ${relaxed} vs Master day ${master}`);
});

test('no tier earns more than 1.6× Relaxed\'s Coins per active minute', async () => {
  const g = await runs;
  const base = median(g['casual@relaxed'].map(coinsPerActiveMinute));
  assert.ok(base > 0);
  for (const t of TIER_ORDER) {
    const ratio = median(g['casual@' + t].map(coinsPerActiveMinute)) / base;
    // Master sits close to the cap (doc model: 1.57×); see tools/balance/TUNING.md.
    assert.ok(ratio <= 1.6, `${t}: ${ratio.toFixed(2)}× Relaxed`);
  }
});

test('after day 1 the offline window never falls below 4 hours for any profile', async () => {
  const g = await runs;
  for (const [k, list] of Object.entries(g)) {
    for (const r of list) {
      const w = minWindowAfterDay1(r);
      assert.ok(w >= 4, `${k} seed ${r.seed}: offline window ${w.toFixed(2)} h`);
    }
  }
});

test('Gallery admission settles between 10% and 20% of Casual income by day 14', async () => {
  const g = await runs;
  const share = median(g.casual.map((r) => r.days[13].admissionShare));
  // Paint is priced from production (sim/gallery.js PAINT_SECONDS of mixer
  // output per canvas), so a piece's value keeps pace with income.
  assert.ok(share >= 0.1 && share <= 0.2, `admission share ${(100 * share).toFixed(1)}%`);
});

test('paintings, canvases and Essence survive every Renovate in the simulation', async () => {
  const g = await runs;
  let renovations = 0;
  for (const list of Object.values(g)) {
    for (const r of list) {
      renovations += r.renovations.length;
      assert.equal(r.renovateKept, true, `${r.profile} seed ${r.seed}`);
    }
  }
  assert.ok(renovations > 0, 'the simulation renovates');
  assert.ok(g.casual.some((r) => r.pieces > 0 && r.essence > 0), 'Casual paints and earns Essence');
});

// ---------------------------------------------------------------------------
// Unit checks
// ---------------------------------------------------------------------------

test('any matching submission pays at least 70%', () => {
  const rng = mulberry32(77);
  const rand = () => '#' + [0, 1, 2].map(() => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 500; i++) assert.ok(score(rand(), rand()).pct >= 0.7);
  assert.ok(score('#3e6a9e', null).pct >= 0.7, 'an empty jar');
  assert.ok(Math.min(...SCORE_TIERS.map((t) => t.pct)) >= 0.7);
  // Through the sim: the worst possible mix still pays 70% of the posted pay.
  const s = createInitialState(NOW, 3);
  refreshOrders(s, NOW);
  const o = s.orders.open.find((x) => x.kind === 'match');
  assert.ok(o, 'a match order is posted');
  const res = submitOrder(s, { orderId: o.id, drops: [{ id: 'black', hex: '#000000', count: 9 }] }, NOW);
  assert.equal(res.ok, true);
  assert.ok(res.coins >= 0.7 * o.pay * incomeMultiplier(s, NOW) - 1e-9, `${res.coins} vs pay ${o.pay}`);
});

test('merging two containers is worth more than selling them separately, at every tier', () => {
  for (let t = 1; t < MAX_TIER; t++) {
    assert.ok(TIER_VALUES[t] > 2 * TIER_VALUES[t - 1], `tier ${t} → ${t + 1}`);
  }
  for (let tier = 1; tier < MAX_TIER; tier++) {
    const s = createInitialState(NOW, 5);
    s.catalog.discovered.madder.essence = 10; // a full color keeps its Cask on the shelf
    const a = addVial(s, { colorId: 'madder', tier, unit: 3 });
    const b = addVial(s, { colorId: 'madder', tier, unit: 3 });
    const apart = containerValue(s, a, NOW) + containerValue(s, b, NOW);
    const r = merge(s, { from: a, to: b });
    assert.equal(r.ok, true);
    assert.ok(containerValue(s, b, NOW) > apart, `tier ${tier}`);
  }
});

function orangeFactory(seed) {
  const s = createInitialState(NOW, seed);
  for (const id of ['orange', 'green', 'olive', 'marigold']) discover(s, { colorId: id, method: 'bench' }, NOW);
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  s.stations.mixers[0].level = 12;
  s.cellarLevel = 400; // storage never fills in this test
  return s;
}

test('a full Merge Shelf never pauses or reduces factory production', () => {
  const full = orangeFactory(9);
  const empty = orangeFactory(9);
  assert.equal(shelfUnlocked(full), true);
  for (let i = 0; i < full.shelf.cells.length; i++) addVial(full, { colorId: 'green', unit: 1 });
  assert.equal(full.shelf.cells.filter(Boolean).length, full.shelf.cells.length, 'shelf is full');
  assert.equal(rates(full, NOW).jars, rates(empty, NOW).jars);
  let pf = 0;
  let pe = 0;
  for (const h of [3, 6, 12, 24]) {
    pf += tickFactory(full, NOW + h * HOUR).produced;
    pe += tickFactory(empty, NOW + h * HOUR).produced;
  }
  assert.ok(pe > 0);
  assert.ok(Math.abs(pf - pe) <= 1e-9 * pe, `full ${pf} vs empty ${pe}`);
  assert.ok(empty.shelf.cells.some(Boolean), 'spillover still lands on a shelf with room');
});

test('paintings, canvases and Essence stars survive Renovate', () => {
  const s = createInitialState(NOW, 11);
  s.phase = 3;
  s.runEarned = 1e9;
  s.gallery.unlocked = true;
  s.gallery.canvases = ['harbor-window', 'tile-mosaic'];
  s.gallery.pieces = [{ id: 'p-1', canvas: 'harbor-window', title: 'Harbor', regions: {}, purity: {}, jars: {}, startedAt: NOW, signedAt: NOW, value: 500, hung: true }];
  s.gallery.hung = ['p-1'];
  s.catalog.discovered.madder.essence = 4;
  const r = renovate(s, NOW + HOUR);
  assert.equal(r.ok, true);
  assert.equal(s.gallery.pieces.length, 1);
  assert.deepEqual(s.gallery.canvases, ['harbor-window', 'tile-mosaic']);
  assert.equal(s.catalog.discovered.madder.essence, 4);
});
