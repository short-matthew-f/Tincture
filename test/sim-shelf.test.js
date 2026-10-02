import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  TIERS, TIER_VALUES, unlocked, addVial, canMerge, merge, sell, tickSpillover, containerValue,
  setRowLabel, tidyRows, hints, move, expand, SPILLOVER_MS,
} from '../src/sim/shelf.js';
import { assignRecipe, tickFactory } from '../src/sim/factory.js';
import { discover } from '../src/sim/discovery.js';
import { stockOf } from '../src/sim/storage.js';
import { colorFamily } from '../src/sim/economy.js';
import { CATALOG } from '../src/content/catalog.js';

const NOW = Date.UTC(2026, 9, 2, 12);

function shelfState() {
  const s = createInitialState(NOW, 5);
  discover(s, { colorId: 'orange', method: 'bench' }, NOW);
  const more = CATALOG.find((c) => !s.catalog.discovered[c.id]);
  discover(s, { colorId: more.id, method: 'hunt' }, NOW);
  return s;
}

const vial = (color, tier = 1, extra = {}) => ({ color, tier, golden: false, boost: 1, unit: 10, ...extra });

test('shelf: tiers and unlock at 5 colors', () => {
  assert.deepEqual(TIERS.map((t) => t.id), ['vial', 'jar', 'bottle', 'urn', 'cask']);
  assert.deepEqual(TIER_VALUES, [1, 2.5, 6, 15, 40]);
  for (let t = 1; t < 5; t++) assert.ok(TIER_VALUES[t] > 2 * TIER_VALUES[t - 1], 'merging always pays');
  const s = createInitialState(NOW, 1);
  assert.equal(unlocked(s), false);
  assert.equal(unlocked(shelfState()), true);
});

test('shelf: chain merge climbs the ladder and records each step', () => {
  const s = shelfState();
  const c = s.shelf.cells;
  c[0] = vial('madder', 2);
  c[1] = vial('madder', 1);
  c[2] = vial('madder', 3);
  c[6] = vial('madder', 1); // row 1, col 1 (below cell 1)
  assert.equal(canMerge(c[6], c[1]), true);
  assert.deepEqual(hints(s).sort((a, b) => a - b), [1, 6]);
  const r = merge(s, { from: 6, to: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((x) => x.tier), [2, 3, 4]);
  assert.equal(s.shelf.cells[1].tier, 4);
  assert.equal(s.shelf.cells[0], null);
  assert.equal(s.shelf.cells[2], null);
  assert.equal(s.shelf.cells[6], null);
  assert.ok(s._events.some((e) => e.type === 'chain' && e.steps.length === 3));
  assert.equal(merge(s, { from: 1, to: 1 }).ok, false);
});

test('shelf: merging never changes color; golden keeps the other color and doubles value', () => {
  const s = shelfState();
  const c = s.shelf.cells;
  c[0] = vial('madder');
  c[1] = vial('woad');
  assert.equal(canMerge(c[0], c[1]), false);
  c[2] = vial('woad', 1, { golden: true });
  c[10] = vial('madder');
  assert.equal(merge(s, { from: 2, to: 0 }).ok, true);
  assert.equal(c[0].color, 'madder');
  assert.equal(c[0].tier, 2);
  assert.equal(c[0].boost, 2);
  assert.equal(c[0].golden, false);
  const plain = vial('madder', 2);
  c[20] = plain;
  assert.ok(Math.abs(containerValue(s, 0) - 2 * containerValue(s, 20)) < 1e-9);
});

test('shelf: forming a Cask grants Essence and consumes it', () => {
  const s = shelfState();
  s.shelf.cells[0] = vial('ochre', 4);
  s.shelf.cells[1] = vial('ochre', 4);
  const r = merge(s, { from: 0, to: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.essence, { colorId: 'ochre', essence: 1 });
  assert.equal(s.catalog.discovered.ochre.essence, 1);
  assert.equal(s.shelf.cells[1], null);
  assert.ok(s._events.some((e) => e.type === 'essence' && e.colorId === 'ochre'));
});

test('shelf: sell pays tier value, tidy rows add 10%', () => {
  const s = shelfState();
  s.shelf.cells[0] = vial('woad', 3);
  const base = containerValue(s, 0);
  setRowLabel(s, { row: 0, family: colorFamily('woad') });
  assert.equal(tidyRows(s)[0], true);
  assert.ok(Math.abs(containerValue(s, 0) - base * 1.1) < 1e-9);
  const coins = s.coins;
  const r = sell(s, { cell: 0 }, NOW);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(s.coins - coins - base * 1.1) < 1e-9);
  assert.equal(s.shelf.cells[0], null);
  // move: into empty, then swap
  s.shelf.cells[3] = vial('madder');
  assert.equal(move(s, { from: 3, to: 4 }).ok, true);
  assert.equal(s.shelf.cells[4].color, 'madder');
});

test('shelf: spillover adds vials while producing; a full shelf stops it without touching the factory', () => {
  const s = shelfState();
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  tickSpillover(s, NOW); // schedules the first vial
  tickFactory(s, NOW + 35 * 60e3);
  const n = s.shelf.cells.filter(Boolean).length;
  assert.ok(n >= 3, `three vials in 35 minutes (got ${n})`);
  assert.ok(s.shelf.cells.filter(Boolean).every((x) => x.color === 'orange' && x.unit > 0));
  // Fill it.
  for (let i = 0; i < s.shelf.cells.length; i++) if (!s.shelf.cells[i]) s.shelf.cells[i] = vial('madder');
  assert.equal(addVial(s, { colorId: 'orange' }), null);
  const stockBefore = stockOf(s, 'orange');
  const snapshot = JSON.stringify(s.shelf.cells);
  tickFactory(s, NOW + 5 * 3600e3);
  assert.equal(JSON.stringify(s.shelf.cells), snapshot, 'nothing added to a full shelf');
  assert.ok(s.shelf.nextSpilloverAt > NOW + 5 * 3600e3 - 1 && s.shelf.nextSpilloverAt <= NOW + 5 * 3600e3 + SPILLOVER_MS);
  assert.ok(stockOf(s, 'orange') >= stockBefore, 'factory keeps producing');
});

test('shelf: expand to 6x9 keeps containers in place', () => {
  const s = shelfState();
  s.shelf.cells[7] = vial('madder'); // row 1 col 2
  s.coins = 60000;
  assert.equal(expand(s, {}, NOW).ok, true);
  assert.equal(s.shelf.cols, 6);
  assert.equal(s.shelf.rows, 9);
  assert.equal(s.shelf.cells.length, 54);
  assert.equal(s.shelf.cells[1 * 6 + 2].color, 'madder');
});
