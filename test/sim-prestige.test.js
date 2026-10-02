// Renovate and Heritage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  heritagePreview, shouldSuggest, renovate, buyHeritageNode, heritageEffects, heritageAvailable,
} from '../src/sim/prestige.js';

const NOW = Date.UTC(2026, 9, 9, 12);

test('heritagePreview = floor(sqrt(E_run / 1e7))', () => {
  const s = createInitialState(NOW, 1);
  for (const [earned, h] of [[0, 0], [9.9e6, 0], [1e7, 1], [4e7, 2], [9.9e7, 3], [1e9, 10], [NaN, 0], [-5, 0]]) {
    s.runEarned = earned;
    assert.equal(heritagePreview(s), h, String(earned));
  }
});

test('suggest renovating when gain beats half of current Heritage (Phase 3)', () => {
  const s = createInitialState(NOW, 1);
  s.runEarned = 4e8; // +6
  assert.equal(shouldSuggest(s), false); // phase 1
  s.phase = 3;
  s.heritage = 10;
  assert.equal(shouldSuggest(s), true);
  s.heritage = 12;
  assert.equal(shouldSuggest(s), false);
});

test('renovate resets the factory and keeps catalog, gallery, essence, hunters', () => {
  const s = createInitialState(NOW, 4);
  s.phase = 3;
  s.coins = 123456;
  s.runEarned = 4e8;
  s.seals = 77;
  s.rooms = ['bench', 'mill-room', 'gallery-wing'];
  s.stations.sources.madder.level = 40;
  s.stations.sources.saffron = { level: 12 };
  s.stations.mixers.push({ recipe: 'orange', level: 9, progress: 0, rushedAt: 0, accident: null });
  s.stock = { madder: { jars: 50, purity: { muddy: 0, standard: 50, pure: 0, flawless: 0 } } };
  s.raw.madder = 99;
  s.catalog.discovered.madder.essence = 3;
  s.catalog.discovered.orange = { at: NOW, name: 'Sunrise', custom: true, essence: 1 };
  s.shelf.cells[0] = { color: 'madder', tier: 3, golden: false };
  s.gallery.unlocked = true;
  s.gallery.canvases = ['harbor-window'];
  s.gallery.pieces = [{ id: 'p1', canvas: 'harbor-window', title: 'Dawn', regions: {}, signedAt: NOW, value: 100, hung: true }];
  s.gallery.hung = ['p1'];
  s.gallery.walls = 8;
  s.hunters.roster = [{ id: 'wren', name: 'Wren', trait: 'botanist', level: 3, xp: 6, state: 'home', trip: null, pityStreak: 2, perks: [] }];
  s.album.cards['meadow-1'] = { count: 1, at: NOW };
  s.apprentices.orderClerk = true;
  const r = renovate(s, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.gained, 6);
  assert.equal(s.heritage, 6);
  assert.equal(s.lifetime.renovations, 1);
  assert.equal(s.coins, 0);
  assert.equal(s.runEarned, 0);
  assert.equal(s.phase, 1);
  assert.deepEqual(s.rooms, ['bench']);
  assert.equal(s.stations.sources.madder.level, 1);
  assert.deepEqual(s.stations.sources.saffron, { level: 1 });
  assert.equal(s.stations.mixers.length, 1);
  assert.deepEqual(s.stock, {});
  assert.equal(s.raw.madder, 0);
  assert.ok(s.shelf.cells.every((c) => c === null));
  // kept
  assert.equal(s.catalog.discovered.madder.essence, 3);
  assert.equal(s.catalog.discovered.orange.name, 'Sunrise');
  assert.equal(s.gallery.unlocked, true);
  assert.equal(s.gallery.pieces.length, 1);
  assert.deepEqual(s.gallery.canvases, ['harbor-window']);
  assert.equal(s.gallery.walls, 4);
  assert.equal(s.seals, 77);
  assert.equal(s.hunters.roster[0].level, 3);
  assert.ok(s.album.cards['meadow-1']);
  assert.equal(s.apprentices.orderClerk, true);
  assert.ok(s._events.some((e) => e.type === 'renovate' && e.heritage === 6));
  // not available before Phase 3
  assert.equal(renovate(s, NOW).ok, false);
});

test('Heritage tree: buy nodes, starting bonuses apply on the next run', () => {
  const s = createInitialState(NOW, 5);
  s.heritage = 10;
  assert.equal(buyHeritageNode(s, { id: 'deep-pockets' }).ok, true); // 1
  assert.equal(buyHeritageNode(s, { id: 'extra-vats' }).ok, true); // 2
  assert.equal(buyHeritageNode(s, { id: 'trusted-clerk' }).ok, true); // 3
  assert.equal(heritageAvailable(s), 4);
  assert.equal(s.apprentices.orderClerk, true);
  assert.equal(buyHeritageNode(s, { id: 'trusted-clerk' }).reason, 'max');
  assert.equal(buyHeritageNode(s, { id: 'trusted-steward' }).reason, 'heritage');
  const fx = heritageEffects(s);
  assert.deepEqual(fx, { startVats: 1, startCoins: 2500, startMixers: 0, phaseSpeed: 0, autoApprentices: ['orderClerk'] });
  s.phase = 3;
  s.runEarned = 0;
  renovate(s, NOW);
  assert.equal(s.coins, 2500);
  assert.equal(s.stations.vats.length, 4);
});
