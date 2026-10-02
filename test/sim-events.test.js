// Weekly events: rotation, themed points crossing track steps, rerun persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import { currentEvent, eventPoints, claimStep, eventTwist, eventPalette } from '../src/sim/events.js';
import { eventForWeek, EVENTS } from '../src/content/events.js';
import { isoWeekKey } from '../src/format.js';

const WEEK = 7 * 86400e3;
const W40 = Date.UTC(2026, 8, 30, 12); // Wed 2026-09-30, ISO week 40

test('eventForWeek rotates on an 8-week cycle', () => {
  assert.equal(isoWeekKey(W40), '2026-W40');
  assert.equal(eventForWeek('2026-W40').id, 'autumn-harvest');
  assert.equal(eventForWeek('2026-W41').id, 'deep-sea');
  assert.equal(eventForWeek('2026-W48').id, 'autumn-harvest');
  const seen = new Set();
  for (let w = 40; w < 48; w++) seen.add(eventForWeek(`2026-W${w}`).id);
  assert.equal(seen.size, EVENTS.length);
});

test('themed points cross track thresholds and emit steps', () => {
  const s = createInitialState(W40, 2);
  currentEvent(s, W40);
  assert.equal(s.event.key, 'autumn-harvest');
  assert.equal(s.event.region, 'orchard');
  assert.equal(eventPoints(s, 'board', 1, { family: 'blue' }), 0); // not themed
  assert.equal(eventPoints(s, 'board', 1, { event: true }), 15);
  assert.ok(s._events.some((e) => e.type === 'eventStep' && e.step === 1));
  eventPoints(s, 'order', 2, { family: 'orange' }); // +20 -> 35
  assert.equal(s.event.points, 35);
  assert.deepEqual(s._events.filter((e) => e.type === 'eventStep').map((e) => e.step), [1, 2]);
  const seals = s.seals;
  assert.equal(claimStep(s, { step: 1 }, W40).ok, true);
  assert.equal(s.seals, seals + 20);
  assert.equal(claimStep(s, { step: 1 }, W40).ok, false);
  assert.equal(claimStep(s, { step: 5 }, W40).ok, false);
  assert.equal(eventTwist(s).rules.boardShape, 'leaf');
  assert.ok(Array.isArray(eventPalette(s)));
});

test('progress persists across a week change and comes back on the rerun', () => {
  const s = createInitialState(W40, 3);
  currentEvent(s, W40);
  eventPoints(s, 'board', 3, { event: true }); // 45
  claimStep(s, { step: 1 }, W40);
  currentEvent(s, W40 + WEEK);
  assert.equal(s.event.key, 'deep-sea');
  assert.equal(s.event.points, 0);
  eventPoints(s, 'crate', 2, { family: 'teal' });
  assert.equal(s.event.points, 10);
  currentEvent(s, W40 + 8 * WEEK);
  assert.equal(s.event.key, 'autumn-harvest');
  assert.equal(s.event.points, 45);
  assert.deepEqual(s.event.claimed, [1]);
  assert.equal(s.eventProgress['deep-sea'].points, 10);
});
