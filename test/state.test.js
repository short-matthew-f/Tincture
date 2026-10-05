import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_VERSION, SAVE_KEY, createInitialState, serialize, deserialize, migrate, mergeDefaults,
} from '../src/state.js';

const NOW = Date.UTC(2026, 9, 2, 12);

test('constants', () => {
  assert.equal(SAVE_VERSION, 3);
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
  assert.equal(s.stations.mixers.length, 2, 'two mixers from the start (v0.2)');
  assert.ok(s.stations.mixers.every((m) => m.recipe === null && m.level === 1));
  assert.equal(s.stations.vats.length, 3);
  assert.equal(s.stations.shop.level, 1);
  assert.deepEqual(s.stations.fleet, []);
  assert.equal(s.cellarLevel, 1);
  assert.deepEqual(s.stock, {});
  assert.deepEqual(Object.keys(s.catalog.discovered), ['madder', 'ochre', 'woad']);
  assert.deepEqual(s.catalog.discovered.ochre, { at: NOW, name: 'Ochre', custom: false, essence: 0 });
  assert.deepEqual(Object.values(s.apprentices), [false, false, false, false, false]);
  assert.equal(s.shelf.cols, 6);
  assert.equal(s.shelf.rows, 6);
  assert.equal(s.shelf.cells.length, 36);
  assert.ok(s.shelf.cells.every((c) => c === null));
  assert.equal(s.shelf.rowLabels, undefined);
  assert.equal(s.shelf.pausedRemainingMs, 0);
  assert.equal(s.nextMuddyAt, 0);
  assert.equal(s.stats.firstBottleAt, 0);
  assert.deepEqual(s.shelf.colors, []);
  assert.equal(s.shelf.waiting, 0);
  assert.deepEqual(s.unlocks, { shelf: false, hunters: false, gallery: false, shipping: false, commissions: false });
  assert.deepEqual(s.renovateReopen, []);
  assert.deepEqual(s.keep, {});
  assert.equal(s.settings.puzzleTier.purify, 'relaxed');
  assert.deepEqual(s.onboarding.seen, {});
  for (const k of ['lines', 'lineSkips', 'wrongDrops', 'rejectedDrags', 'coachDismissed']) assert.equal(s.stats[k], 0, k);
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
  const obj = { v: 2, savedAt: 0, state: { coins: 1 } };
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

// ---------------------------------------------------------------------------
// v1 (0.1.x) -> v2 (0.2) migration
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import * as sim from '../src/sim/index.js';

const FIXTURE = new URL('./fixtures/save-0.1.3.json', import.meta.url);

/** Every key path (objects only, arrays as leaves) of a plain object. */
function keyPaths(x, prefix = '', out = []) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    // Maps keyed by content ids are open-ended: only their presence counts.
    if (['catalog', 'stock', 'raw', 'pigment', 'sources', 'album', 'eventProgress', 'activePuzzles', 'flags', 'heritageSpent', 'keep', 'seen'].includes(k)) continue;
    keyPaths(v, p, out);
  }
  return out;
}

test('a real 0.1.3 save loads as v3, grants what it used, plays a tick, and has every v2 key', () => {
  const json = readFileSync(FIXTURE, 'utf8');
  const raw = JSON.parse(json);
  assert.equal(raw.v, 1);
  const T = raw.savedAt + 3600e3;
  const s = deserialize(json, T);
  assert.equal(s.v, SAVE_VERSION);
  // Granted: the shelf had containers, a hunter was hired; nothing else.
  assert.deepEqual(s.unlocks, { shelf: true, hunters: true, gallery: false, shipping: false, commissions: false });
  assert.equal(s.flags.whatsNew, '0.2');
  assert.equal(s.settings.puzzleTier.purify, 'relaxed');
  assert.deepEqual(s.onboarding.seen, {});
  assert.deepEqual(s.keep, {});
  assert.equal(s.shelf.waiting, 0);
  // v3: the 5x7 shelf is now 6x6, containers kept in reading order; chips = most frequent first.
  const old = raw.state.shelf.cells.filter(Boolean);
  assert.equal(s.shelf.cols, 6);
  assert.equal(s.shelf.cells.length, 36);
  assert.equal(s.shelf.rowLabels, undefined);
  assert.deepEqual(s.shelf.cells.filter(Boolean).map((c) => c.color), old.map((c) => c.color).slice(0, 36));
  const counts = {};
  for (const c of old) counts[c.color] = (counts[c.color] || 0) + 1;
  const shelfColors = [...new Set(old.map((c) => c.color))].sort((a, b) => counts[b] - counts[a]).slice(0, 5);
  assert.deepEqual(s.shelf.colors, shelfColors);
  assert.ok(s.stations.mixers.length >= 2);
  // Every key a fresh v2 state has, the migrated save has too.
  const fresh = createInitialState(T, 1);
  const have = new Set(keyPaths(s));
  const missing = keyPaths(fresh).filter((p) => !have.has(p) && !p.startsWith('_events'));
  assert.deepEqual(missing, []);
  // ...and it plays: a tick, the shelf and the map still work.
  const cells = s.shelf.cells.filter(Boolean).length;
  sim.tick(s, T + 60e3);
  assert.ok(sim.shelfUnlocked(s));
  assert.ok(sim.huntersUnlocked(s));
  assert.ok(s.shelf.cells.filter(Boolean).length >= cells);
  assert.ok(sim.next(s, T + 60e3).label);
  const bad = [];
  (function scan(x, p) {
    if (typeof x === 'number') { if (!Number.isFinite(x)) bad.push(p); return; }
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) scan(v, `${p}.${k}`);
  }(s, 'state'));
  assert.deepEqual(bad, []);
  assert.deepEqual(deserialize(serialize(s), T + 60e3).unlocks, s.unlocks, 'v2 round trip');
});

test('v1 -> v2: a one-mixer save gets its second mixer; gallery, yard and Phase 3 are granted', () => {
  const s = createInitialState(NOW, 3);
  const obj = JSON.parse(serialize(s));
  obj.v = 1;
  const st = obj.state;
  delete st.unlocks; delete st.keep; delete st.renovateReopen; delete st.onboarding.seen;
  delete st.shelf.colors; delete st.shelf.waiting; delete st.settings.puzzleTier.purify;
  for (const k of ['lines', 'lineSkips', 'wrongDrops', 'rejectedDrags', 'coachDismissed']) delete st.stats[k];
  st.stations.mixers = [{ recipe: 'madder', level: 4, progress: 0, rushedAt: 0, accident: null }];
  st.gallery.unlocked = true;
  st.rooms = ['bench', 'mill-room', 'loading-yard'];
  st.phase = 3;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.stations.mixers.length, 2);
  assert.equal(back.stations.mixers[0].recipe, 'madder');
  assert.deepEqual(back.unlocks, { shelf: false, hunters: false, gallery: true, shipping: true, commissions: true });
  assert.deepEqual(back.shelf.colors, []);
  assert.equal(back.flags.whatsNew, '0.2');
  for (const k of ['lines', 'lineSkips', 'wrongDrops', 'rejectedDrags', 'coachDismissed']) assert.equal(back.stats[k], 0, k);
});

// ---------------------------------------------------------------------------
// v2 (0.2.0) -> v3 (0.2.1) migration: the 6x6 shelf
// ---------------------------------------------------------------------------

import { stockOf } from '../src/sim/storage.js';

function v2Save(shelf, extra = {}) {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  obj.v = 2;
  obj.savedAt = NOW;
  obj.state.v = 2;
  obj.state.shelf = { colors: ['woad'], waiting: 0, nextSpilloverAt: NOW + 5000, ...shelf };
  delete obj.state.nextMuddyAt;
  delete obj.state.stats.firstBottleAt;
  Object.assign(obj.state, extra);
  return obj;
}
const c = (color, tier = 1, unit = 2) => ({ color, tier, golden: false, boost: 1, unit });

test('v2 -> v3: a 5x7 shelf becomes 6x6 in reading order; labels dropped; chips most frequent first', () => {
  const cells = new Array(35).fill(null);
  cells[0] = c('madder');
  cells[4] = c('ochre', 3); // row 0, col 4
  cells[5] = c('ochre'); // row 1, col 0
  cells[34] = c('ochre');
  const obj = v2Save({ cols: 5, rows: 7, cells, rowLabels: new Array(7).fill('red') }, { muddyBatches: [{ id: 'b1', color: 'madder', jars: 5, value: 4, at: NOW }] });
  const s = deserialize(JSON.stringify(obj), NOW);
  assert.equal(s.v, 3);
  assert.equal(s.shelf.cols, 6);
  assert.equal(s.shelf.rows, 6);
  assert.equal(s.shelf.cells.length, 36);
  assert.equal(s.shelf.rowLabels, undefined);
  assert.deepEqual(s.shelf.cells.slice(0, 4).map((x) => x && x.color), ['madder', 'ochre', 'ochre', 'ochre']);
  assert.ok(s.shelf.cells.slice(4).every((x) => x === null));
  assert.deepEqual(s.shelf.colors, ['ochre', 'madder']);
  assert.equal(s.shelf.nextSpilloverAt, NOW + 5000, 'spillover timer kept');
  assert.equal(s.stats.firstBottleAt, NOW, 'a Bottle on the shelf: golden vials allowed');
  assert.equal(s.nextMuddyAt, 0);
  assert.equal(s.muddyBatches[0].tier, null);
});

test('v2 -> v3: an expanded 6x9 shelf with more than 36 containers sends the extras to stock', () => {
  const cells = new Array(54).fill(null);
  for (let i = 0; i < 40; i++) cells[i] = c(i < 36 ? 'woad' : 'madder', i < 38 ? 1 : 2, 3);
  const obj = v2Save({ cols: 6, rows: 9, cells, rowLabels: new Array(9).fill(null) });
  obj.state.stock = {};
  const s = deserialize(JSON.stringify(obj), NOW);
  assert.equal(s.shelf.cells.length, 36);
  assert.equal(s.shelf.cells.filter(Boolean).length, 36);
  assert.ok(s.shelf.cells.every((x) => x.color === 'woad'));
  // Extras: two madder vials (3 jars each) and two madder jars (3 x 2.5 each).
  assert.ok(Math.abs(stockOf(s, 'madder') - (3 + 3 + 7.5 + 7.5)) < 1e-9);
  assert.deepEqual(s.shelf.colors, ['woad']);
  assert.equal(s.stats.firstBottleAt, 0, 'no Bottle yet');
  assert.deepEqual(deserialize(serialize(s), NOW).shelf.cells.length, 36, 'v3 round trip');
});

test('v2 -> v3: an empty shelf keeps the chips she had', () => {
  const s = deserialize(JSON.stringify(v2Save({ cols: 5, rows: 7, cells: new Array(35).fill(null), rowLabels: [] })), NOW);
  assert.deepEqual(s.shelf.colors, ['woad']);
  assert.equal(s.shelf.cells.length, 36);
});
