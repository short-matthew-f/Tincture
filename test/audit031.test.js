// 0.3.1 audit (docs/AUDIT-0.3.1.md): the pure pieces behind the "does it work?" fixes.
// Kept light: one fresh state per test, no simulation runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../src/sim/index.js';
import { createInitialState } from '../src/state.js';
import { STATION_NOTES, EXPLAIN } from '../src/content/explain.js';
import { SOURCES_BY_ID } from '../src/content/sources.js';
import { GO_SCREENS, requirement } from '../src/sim/howto.js';

const NOW = Date.UTC(2026, 9, 19, 12);
const fresh = () => {
  const s = createInitialState(NOW, 42);
  s.onboarding.done = true;
  return s;
};

test('phaseGoal names the real Phase 3 gate: the Loading Yard asks 50 colors, not 30', () => {
  const s = fresh();
  const g = sim.factory.phaseGoal(s, 3);
  assert.equal(g.reached, false);
  assert.equal(g.room.id, 'loading-yard');
  assert.equal(g.colors, 50);
  assert.equal(g.hasRoom, false);
  assert.equal(g.roomColorsLeft, 50 - sim.discoveredCount(s));
  s.rooms.push('loading-yard');
  assert.equal(sim.factory.phaseGoal(s, 3).hasRoom, true);
});

test('the commissions how-to names the Loading Yard first', () => {
  const r = requirement(fresh(), 'commissions');
  assert.match(r.title, /Loading Yard/);
  assert.match(r.text, /50 colors/);
});

test('every note has words, and every explain destination is a real screen', () => {
  for (const [k, n] of Object.entries(STATION_NOTES)) {
    assert.ok(n.title && n.what && n.what.length > 20, `${k} note`);
  }
  for (const [k, x] of Object.entries(EXPLAIN)) {
    assert.ok(x.title && x.lines.length, `${k} explain`);
    if (x.go) assert.ok(GO_SCREENS.includes(x.go.screen), `${k} goes to ${x.go.screen}`);
  }
});

test('vat upgrades read as Bigger jars, and the blue source is not called a vat', () => {
  const opts = sim.economy.upgradeOptions(fresh());
  const vat = opts.find((o) => o.kind === 'vat');
  assert.match(vat.label, /^Bigger jars to level 2$/);
  assert.ok(!opts.some((o) => /\bVat\b/.test(o.label)));
  assert.equal(SOURCES_BY_ID.woad.name, 'Woad Field');
});

test('a new workshop gets a weekly quest it can finish: blocked steps become stand-ins', () => {
  const waits = new Set(['crateShipped', 'commissionDone', 'batchPurified', 'hunterSent', 'postcardCollected', 'postcardSetDone', 'regionsPainted', 'pieceSigned', 'merged']);
  for (let w = 0; w < 6; w++) {
    const s = createInitialState(NOW + w * 7 * 864e5, 7);
    sim.quests.rollWeekly(s, NOW + w * 7 * 864e5);
    const steps = s.quests.weekly.steps;
    assert.ok(steps.every((x) => !waits.has(x.event)), `${s.quests.weekly.id}: ${steps.map((x) => x.event).join(',')}`);
    assert.equal(new Set(steps.map((x) => x.event + (x.family || ''))).size, steps.length, 'no step twice');
  }
});

test('the Steward says what it bought', () => {
  const s = fresh();
  s.apprentices.steward = true;
  s.stewardOn = true;
  s.coins = 1e6;
  s.stations.mixers[0].recipe = 'orange';
  s._events = [];
  const res = sim.factory.stewardTick(s, NOW);
  assert.ok(res.bought > 0);
  const ev = s._events.find((e) => e.type === 'stewardBought');
  assert.ok(ev && ev.labels.length === res.bought);
});
