// Integration fixes across modules (docs/INTEGRATION-NOTES.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, deserialize, serialize } from '../src/state.js';
import { availableRoutes } from '../src/sim/shipping.js';
import { unlockSource } from '../src/sim/factory.js';
import { currentEvent } from '../src/sim/events.js';
import { EVENTS } from '../src/content/events.js';
import { ROUTES } from '../src/content/routes.js';
import { suggestName } from '../src/content/names.js';
import { isoWeekKey } from '../src/format.js';
import { CATALOG } from '../src/content/catalog.js';
import { mulberry32 } from '../src/rng.js';

const NOW = Date.UTC(2026, 9, 9, 12);
const WEEK = 7 * 86400e3;

test('a market found by hunters (routesDiscovered) opens its route', () => {
  const s = createInitialState(NOW, 1);
  const market = ROUTES.find((r) => r.unlock.type === 'discovered');
  assert.ok(market);
  assert.ok(!availableRoutes(s).some((r) => r.id === market.id));
  s.routesDiscovered.push(market.id);
  assert.ok(availableRoutes(s).some((r) => r.id === market.id));
  const back = deserialize(serialize(s, NOW), NOW);
  assert.ok(back.discoveredMarkets.includes(market.id), 'loading folds the legacy list into discoveredMarkets');
});

test('state defaults: activePuzzles and stats.fastSolves', () => {
  const s = createInitialState(NOW, 1);
  assert.deepEqual(s.activePuzzles, {});
  assert.equal(s.stats.fastSolves, 0);
  const old = JSON.parse(serialize(s, NOW));
  delete old.state.activePuzzles;
  delete old.state.stats.fastSolves;
  const back = deserialize(JSON.stringify(old), NOW);
  assert.deepEqual(back.activePuzzles, {});
  assert.equal(back.stats.fastSolves, 0);
});

test('a hunter-unlocked source starts at level 1 on every path', () => {
  const s = createInitialState(NOW, 1);
  assert.equal(unlockSource(s, { id: 'murex' }).ok, true);
  assert.deepEqual(s.stations.sources.murex, { level: 1 });
});

test('Deep Sea lends Murex Cove for its week and takes it back after', () => {
  assert.ok(EVENTS.some((e) => e.id === 'deep-sea'));
  let t = NOW;
  for (let i = 0; i < 20; i++) {
    const n = Number(/W(\d+)/.exec(isoWeekKey(t))[1]);
    if (EVENTS[n % EVENTS.length].id === 'deep-sea') break;
    t += WEEK;
  }
  const s = createInitialState(t, 1);
  s.event = null;
  currentEvent(s, t);
  assert.equal(s.event.key, 'deep-sea');
  assert.equal(s.stations.sources.murex.level, 1);
  assert.equal(s.stations.sources.murex.eventLoan, 'deep-sea');
  currentEvent(s, t + WEEK);
  assert.equal(s.stations.sources.murex, undefined, 'the loan ends with the week');
  // Owned for good: stays.
  s.event = null;
  currentEvent(s, t);
  delete s.stations.sources.murex.eventLoan;
  currentEvent(s, t + WEEK);
  assert.ok(s.stations.sources.murex);
});

test('suggested names never use "-ish" hue words', () => {
  const rng = mulberry32(7);
  for (const c of CATALOG.slice(0, 60)) {
    for (let i = 0; i < 6; i++) {
      const n = suggestName(c.hex, rng);
      assert.ok(!/Reddish|Orangey|Yellowish|Greenish|Tealish|Bluish|Purplish|Pinkish|Greyish/.test(n), n);
    }
  }
});
