// game.test.js — the Game loop with fake storage, a fake clock and fake timers
// (ARCHITECTURE.md "Game loop"). Pure Node: Game never touches the DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game, memoryStorage, AWAY_MS } from '../src/game.js';
import { SAVE_KEY, serialize, createInitialState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { seedFirstChain } from '../src/ui/onboarding.js';

const T0 = Date.UTC(2026, 9, 2, 9, 0, 0);
const DAY = 86400e3;

function fakeTimers() {
  let id = 0;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    setInterval: (fn, ms) => { intervals.set(++id, { fn, ms }); return id; },
    clearInterval: (i) => { intervals.delete(i); },
    setTimeout: (fn, ms) => { timeouts.set(++id, { fn, ms }); return id; },
    clearTimeout: (i) => { timeouts.delete(i); },
    intervals,
    timeouts,
    runIntervals(n = 1) { for (let k = 0; k < n; k++) for (const { fn } of [...intervals.values()]) fn(); },
    flushTimeouts() { const list = [...timeouts.values()]; timeouts.clear(); for (const { fn } of list) fn(); },
  };
}

function makeGame(opts = {}) {
  const clock = { t: opts.t ?? T0 };
  const timers = fakeTimers();
  const storage = opts.storage ?? memoryStorage();
  const game = new Game({ now: () => clock.t, storage, ...timers, ...opts.extra });
  return { game, clock, timers, storage };
}

test('a fresh game starts from createInitialState', () => {
  const { game } = makeGame();
  assert.equal(game.isNew, true);
  assert.equal(game.state.lastTick, T0);
  assert.equal(game.now(), T0);
  assert.ok(game.state.catalog.discovered.madder);
});

test('start() runs a 250 ms loop that ticks, emits change and saves', () => {
  const { game, clock, timers, storage } = makeGame();
  let changes = 0;
  game.on('change', () => { changes++; });
  game.start();
  assert.equal(timers.intervals.size, 1);
  assert.equal([...timers.intervals.values()][0].ms, 250);
  clock.t += 250;
  timers.runIntervals(1);
  assert.equal(changes, 1);
  assert.equal(game.state.lastTick, T0 + 250);
  assert.ok(game.state.orders.open.length >= 3, 'tick refreshed the order board');
  assert.ok(storage.getItem(SAVE_KEY), 'first tick saved');
  game.stop();
  assert.equal(timers.intervals.size, 0);
});

test('act runs the sim function, drains events, emits change and returns the result', () => {
  const { game } = makeGame();
  const seen = [];
  game.on('discover', (ev, meta) => seen.push([ev.colorId, meta.catchUp]));
  game.on('*', (type) => seen.push(type));
  let changes = 0;
  game.on('change', () => { changes++; });
  const res = game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  assert.equal(res.colorId, 'orange');
  assert.deepEqual(seen.filter(Array.isArray), [['orange', undefined]]);
  assert.ok(seen.includes('discover'));
  assert.ok(seen.includes('change'));
  assert.equal(changes, 1);
  assert.deepEqual(game.state._events, []);
});

test('act never throws and keeps the game alive when a sim function fails', () => {
  const { game } = makeGame();
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a);
  try {
    const res = game.act(() => { throw new Error('boom'); }, {});
    assert.equal(res, undefined);
    assert.equal(game.act('not a function'), undefined);
  } finally {
    console.error = orig;
  }
  assert.equal(errs.length, 2);
  assert.equal(game.act((s, a) => a + 1, 1), 2);
});

test('a throwing listener does not stop other listeners', () => {
  const { game } = makeGame();
  const orig = console.error;
  console.error = () => {};
  let ok = false;
  try {
    game.on('change', () => { throw new Error('bad screen'); });
    game.on('change', () => { ok = true; });
    game.act(() => 1);
  } finally {
    console.error = orig;
  }
  assert.ok(ok);
});

test('autosave is throttled to once a second', () => {
  const { game, clock, timers, storage } = makeGame();
  let writes = 0;
  const set = storage.setItem;
  storage.setItem = (k, v) => { writes++; set(k, v); };
  game.act(() => 1);
  assert.equal(writes, 1, 'first act saves at once');
  game.act(() => 2);
  game.act(() => 3);
  assert.equal(writes, 1, 'later acts within a second wait');
  assert.equal(timers.timeouts.size, 1);
  clock.t += 1000;
  timers.flushTimeouts();
  assert.equal(writes, 2);
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.savedAt, T0 + 1000);
  assert.equal(saved.state._events, undefined, '_events never saved');
});

test('suspend saves and stops the loop; resume restarts it', () => {
  const { game, clock, timers, storage } = makeGame();
  game.start();
  clock.t += 5000;
  game.suspend();
  assert.equal(timers.intervals.size, 0);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).savedAt, T0 + 5000);
  clock.t += 10e3;
  assert.equal(game.resume(), null, 'short absences do not open the ledger');
  assert.equal(timers.intervals.size, 1);
});

test('a save round-trips through the constructor', () => {
  const { game, storage } = makeGame();
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  game.save();
  const g2 = new Game({ now: () => T0 + 1000, storage, ...fakeTimers() });
  assert.equal(g2.isNew, false);
  assert.ok(g2.state.catalog.discovered.orange);
});

test('resume after 3 days runs the catch-up and emits return with a ledger', () => {
  const { game, clock, timers } = makeGame();
  game.act(sim.assignRecipe, { mixer: 0, colorId: 'madder' });
  game.start();
  clock.t += 1000;
  timers.runIntervals(1);
  game.suspend();
  clock.t += 3 * DAY;
  let summary = null;
  let order = [];
  game.on('return', (s) => { summary = s; order.push('return'); });
  game.on('*', (type) => { if (type !== 'return' && type !== 'change') order.push(type); });
  const res = game.resume();
  assert.ok(res, 'resume returns the summary');
  assert.equal(summary, res);
  assert.ok(summary.away >= 3 * DAY - 2000, `away ${summary.away}`);
  assert.ok(Array.isArray(summary.lines));
  assert.equal(game.state.ledger.pending, summary);
  assert.equal(game.state.lastTick, clock.t);
  assert.equal(order[0], 'return', 'return comes before catch-up domain events');
  assert.equal(timers.intervals.size, 1, 'loop running again');
});

test('start() on a save made long ago opens the ledger', () => {
  const storage = memoryStorage();
  const old = createInitialState(T0 - 2 * DAY, 7);
  storage.setItem(SAVE_KEY, serialize(old, T0 - 2 * DAY));
  const { game } = makeGame({ storage });
  let summary = null;
  game.on('return', (s) => { summary = s; });
  game.start();
  assert.ok(summary);
  assert.ok(summary.away >= AWAY_MS);
  game.stop();
});

test('a clock that went backwards does not freeze production', () => {
  const storage = memoryStorage();
  const future = createInitialState(T0 + 5 * DAY, 7);
  storage.setItem(SAVE_KEY, serialize(future, T0 + 5 * DAY));
  const { game, clock, timers } = makeGame({ storage });
  assert.equal(game.state.lastTick, T0, 'rebased to now');
  game.start();
  clock.t += 250;
  timers.runIntervals(1);
  assert.equal(game.state.lastTick, T0 + 250);
  game.stop();
});

test('exportSave / importSave round trip', () => {
  const { game, clock } = makeGame();
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  game.act(sim.nameColor, { colorId: 'orange', name: 'Hearth' });
  const text = game.exportSave();
  assert.equal(typeof text, 'string');

  const other = makeGame({ t: T0 + 10 * 60e3 });
  let imported = false;
  let summary = null;
  other.game.on('import', () => { imported = true; });
  other.game.on('return', (s) => { summary = s; });
  const res = other.game.importSave(text);
  assert.equal(res.ok, true);
  assert.ok(imported);
  assert.ok(summary, '10 minutes since export: catch-up ran');
  assert.equal(other.game.state.catalog.discovered.orange.name, 'Hearth');
  assert.equal(other.game.state.lastTick, other.clock.t);
  assert.ok(other.storage.getItem(SAVE_KEY).includes('Hearth'), 'import saved');
  void clock;

  const bad = other.game.importSave('{"nope":1}');
  assert.equal(bad.ok, false);
  assert.equal(other.game.state.catalog.discovered.orange.name, 'Hearth', 'a bad file changes nothing');
  assert.equal(other.game.importSave('not json').ok, false);
});

test('an unreadable save starts fresh and keeps a copy', () => {
  const storage = memoryStorage({ [SAVE_KEY]: '{broken' });
  const orig = console.error;
  console.error = () => {};
  try {
    const { game } = makeGame({ storage });
    assert.equal(game.isNew, true);
    assert.ok(game.loadError);
    assert.equal(storage.getItem(SAVE_KEY + '.unreadable'), '{broken');
  } finally {
    console.error = orig;
  }
});

test('setSetting saves the value and emits change', () => {
  const { game, storage } = makeGame();
  let changed = 0;
  game.on('change', () => { changed++; });
  assert.equal(game.setSetting('notation', 'sci').ok, true);
  assert.equal(game.state.settings.notation, 'sci');
  assert.equal(game.setSetting('notation', 'roman').ok, false);
  assert.equal(changed, 2);
  assert.ok(storage.getItem(SAVE_KEY).includes('"notation":"sci"'));
});

test('reset clears the save and starts over', () => {
  let reloaded = false;
  const { game, storage } = makeGame({ extra: { reload: () => { reloaded = true; } } });
  game.act(sim.discover, { colorId: 'orange', method: 'bench' });
  game.reset();
  assert.ok(!game.state.catalog.discovered.orange);
  assert.ok(reloaded);
  assert.ok(!storage.getItem(SAVE_KEY).includes('"orange"'));
});

test('seedFirstChain sets up a shelf where one drop chains', () => {
  const { game } = makeGame();
  for (const id of ['orange', 'marigold']) game.act(sim.discover, { colorId: id, method: 'bench' });
  const seeded = game.act(seedFirstChain, {});
  assert.ok(seeded && seeded.ok, 'seeded');
  const { from, to } = seeded;
  let chain = null;
  game.on('chain', (ev) => { chain = ev; });
  const res = game.act(sim.shelf.merge, { from, to });
  assert.equal(res.ok, true);
  assert.equal(res.steps.length, 2, 'vial + vial -> jar, then jar + jar -> bottle');
  assert.ok(chain, 'chain event emitted');
  assert.equal(game.act(seedFirstChain, {}).ok, false, 'seeds only once');
});

test('quest text pluralizes by amount', async () => {
  const { questText, getQuestType } = await import('../src/content/quests.js');
  assert.equal(questText(getQuestType('discover-color'), 1), 'Discover 1 new color');
  assert.equal(questText(getQuestType('discover-color'), 2), 'Discover 2 new colors');
  assert.equal(questText(getQuestType('fill-orders'), 1), 'Fill 1 order');
  assert.equal(questText(getQuestType('purify-batch'), 2), 'Purify 2 batches');
});
