// The Tile Room in quests and events: a daily quest type once the room is open, a how-to
// that sends her there (or to its price first), and event points for a finished wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import { QUEST_TYPES, eligibleQuestTypes } from '../src/content/quests.js';
import { EVENTS, POINTS_PER, EVENT_POINT_HOW } from '../src/content/events.js';
import { questGuide, requirement } from '../src/sim/howto.js';
import { unlocksOf } from '../src/sim/quests.js';
import { eventPoints, currentEvent } from '../src/sim/events.js';

test('tile-rounds quest is offered only once the Tile Room is open', () => {
  const s = createInitialState(0, 3);
  const has = () => eligibleQuestTypes(unlocksOf(s)).some((t) => t.id === 'tile-rounds');
  assert.equal(has(), false);
  s.unlocks.tiles = true;
  assert.equal(has(), true);
  const t = QUEST_TYPES.find((x) => x.id === 'tile-rounds');
  assert.equal(t.event, 'tilesRound');
  assert.equal(t.go.screen, 'tiles');
});

test('Tile Room how-to points at its price while it is closed, and at the room once open', () => {
  const s = createInitialState(0, 3);
  const need = requirement(s, 'tiles');
  assert.ok(need && need.title.includes('Tile Room'), JSON.stringify(need));
  s.unlocks.tiles = true;
  assert.equal(requirement(s, 'tiles'), null);
  const g = questGuide(s, { type: 'tile-rounds', event: 'tilesRound', target: 2, progress: 0 });
  assert.equal(g.go.screen, 'tiles');
  assert.equal(g.need, null);
});

test('a finished wall in the event colors earns event points', () => {
  assert.equal(POINTS_PER.mosaic, 30);
  assert.equal(EVENT_POINT_HOW.mosaic.go.screen, 'tiles');
  const W40 = Date.UTC(2026, 8, 30, 12);
  const s = createInitialState(W40, 7);
  currentEvent(s, W40);
  const ev = EVENTS.find((e) => e.id === s.event.key);
  assert.ok(ev, 'an event is running');
  const before = s.event.points;
  assert.equal(eventPoints(s, 'mosaic', 1, { families: [], family: ev.palette[0] }), 30);
  assert.equal(s.event.points, before + 30);
});
