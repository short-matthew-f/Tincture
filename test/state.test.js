import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_VERSION, SAVE_KEY, createInitialState, serialize, deserialize, migrate, mergeDefaults,
} from '../src/state.js';

const NOW = Date.UTC(2026, 9, 2, 12);

test('constants', () => {
  assert.equal(SAVE_VERSION, 1);
  assert.equal(SAVE_KEY, 'tincture.save');
});

test('createInitialState shape', () => {
  const s = createInitialState(NOW, 99);
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.seed, 99);
  assert.equal(s.createdAt, NOW);
  assert.equal(s.lastTick, NOW);
  assert.equal(s.lastSeenAt, NOW);
  assert.deepEqual(Object.keys(s.stations.sources), ['madder', 'ochre', 'woad']);
  assert.equal(s.stations.grinders.length, 1);
  assert.equal(s.stations.grinders[0].kind, 'mortar');
  assert.equal(s.stations.mixers.length, 1);
  assert.equal(s.stations.mixers[0].recipe, null);
  assert.equal(s.stations.vats.length, 3);
  assert.equal(s.stations.shop.level, 1);
  assert.deepEqual(s.stations.fleet, []);
  assert.equal(s.cellarLevel, 1);
  assert.deepEqual(s.stock, {});
  assert.deepEqual(Object.keys(s.catalog.discovered), ['madder', 'ochre', 'woad']);
  assert.deepEqual(s.catalog.discovered.ochre, { at: NOW, name: 'Ochre', custom: false, essence: 0 });
  assert.deepEqual(Object.values(s.apprentices), [false, false, false, false, false]);
  assert.equal(s.shelf.cols, 5);
  assert.equal(s.shelf.rows, 7);
  assert.equal(s.shelf.cells.length, 35);
  assert.ok(s.shelf.cells.every((c) => c === null));
  assert.deepEqual(s.shelf.rowLabels, new Array(7).fill(null));
  assert.deepEqual(s.hunters, { roster: [], regionsUnlocked: [] });
  assert.equal(s.event, null);
  assert.deepEqual(s.rooms, ['bench']);
  assert.deepEqual(s._events, []);
  assert.equal(s.settings.notation, 'short');
  assert.equal(s.settings.puzzleTier.grading, 'relaxed');
  assert.equal(s.quests.weekly, null);
  assert.deepEqual(s.commissions, { open: [], done: [] });
});

test('createInitialState instances are independent', () => {
  const a = createInitialState(NOW, 1), b = createInitialState(NOW, 1);
  a.shelf.cells[0] = { color: 'x' };
  a.stations.vats[0].level = 5;
  assert.equal(b.shelf.cells[0], null);
  assert.equal(b.stations.vats[0].level, 1);
});

test('seed defaults to a uint32 derived from now', () => {
  const s = createInitialState(NOW);
  assert.ok(Number.isInteger(s.seed) && s.seed >= 0 && s.seed < 2 ** 32);
});

test('serialize/deserialize round trip strips _events', () => {
  const s = createInitialState(NOW, 5);
  s.coins = 123.5;
  s._events.push({ type: 'discover' });
  const json = serialize(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.v, SAVE_VERSION);
  assert.equal(typeof parsed.savedAt, 'number');
  assert.equal('_events' in parsed.state, false);
  assert.deepEqual(s._events, [{ type: 'discover' }]); // input untouched
  const back = deserialize(json, NOW + 1000);
  assert.equal(back.coins, 123.5);
  assert.deepEqual(back._events, []);
  const expected = createInitialState(NOW, 5);
  expected.coins = 123.5;
  assert.deepEqual(back, expected);
});

test('deserialize throws on garbage', () => {
  assert.throws(() => deserialize('not json', NOW));
  assert.throws(() => deserialize('[]', NOW));
  assert.throws(() => deserialize('{"v":1}', NOW));
  assert.throws(() => deserialize('null', NOW));
  assert.throws(() => deserialize(JSON.stringify({ v: 999, state: {} }), NOW));
});

test('migrate is a no-op at current version', () => {
  const obj = { v: 1, savedAt: 0, state: { coins: 1 } };
  const out = migrate(obj);
  assert.equal(out.v, SAVE_VERSION);
  assert.equal(out.state.coins, 1);
});

test('mergeDefaults adds a missing key and deep-merges settings', () => {
  const s = createInitialState(NOW, 5);
  delete s.album;
  delete s.settings.colorblind;
  delete s.settings.puzzleTier;
  delete s._events;
  s.settings.sound = false;
  s.coins = 7;
  mergeDefaults(s, NOW);
  assert.deepEqual(s.album, { cards: {}, setsDone: [] });
  assert.equal(s.settings.colorblind, false);
  assert.equal(s.settings.sound, false);
  assert.equal(s.settings.puzzleTier.grading, 'relaxed');
  assert.equal(s.coins, 7);
  assert.deepEqual(s._events, []);
});

test('deserialize fills fields missing from an old save', () => {
  const s = createInitialState(NOW, 5);
  const obj = JSON.parse(serialize(s));
  delete obj.state.stats;
  delete obj.state.settings.notifyVats;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.stats.sessionStartedAt, NOW);
  assert.equal(back.settings.notifyVats, false);
});
