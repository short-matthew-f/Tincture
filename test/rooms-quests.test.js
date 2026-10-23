// The Winding Room, Lifting Table and Dye Garden in quests and events: each has a daily
// quest type once its room is open, a how-to that sends her there (or to its price
// first), and event points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import { QUEST_TYPES, eligibleQuestTypes } from '../src/content/quests.js';
import { EVENTS, POINTS_PER, EVENT_POINT_HOW } from '../src/content/events.js';
import { questGuide, requirement } from '../src/sim/howto.js';
import { unlocksOf } from '../src/sim/quests.js';
import { eventPoints, currentEvent } from '../src/sim/events.js';

const ROOMS = [
  { id: 'skeins', quest: 'wind-hanks', event: 'hankTied', points: 'hank' },
  { id: 'lift', quest: 'lift-painting', event: 'paintingLifted', points: 'lifted' },
  { id: 'garden', quest: 'garden-visit', event: 'gardenVisit', points: 'harvest' },
];

for (const r of ROOMS) {
  test(`${r.id}: quest offered only once open, how-to goes to the room or its price`, () => {
    const s = createInitialState(0, 3);
    const has = () => eligibleQuestTypes(unlocksOf(s)).some((t) => t.id === r.quest);
    assert.equal(has(), false);
    const need = requirement(s, r.id);
    assert.ok(need && need.title, 'closed room names what to buy first');
    s.unlocks[r.id] = true;
    assert.equal(has(), true);
    assert.equal(requirement(s, r.id), null);
    const t = QUEST_TYPES.find((x) => x.id === r.quest);
    assert.equal(t.event, r.event);
    const g = questGuide(s, { type: r.quest, event: r.event, target: 1, progress: 0 });
    assert.equal(g.go.screen, r.id);
  });

  test(`${r.id}: event points in the event colors`, () => {
    assert.ok(POINTS_PER[r.points] > 0);
    assert.equal(EVENT_POINT_HOW[r.points].go.screen, r.id);
    const W40 = Date.UTC(2026, 8, 30, 12);
    const s = createInitialState(W40, 7);
    currentEvent(s, W40);
    const ev = EVENTS.find((e) => e.id === s.event.key);
    const before = s.event.points;
    assert.equal(eventPoints(s, r.points, 1, { family: ev.palette[0] }), POINTS_PER[r.points]);
    assert.equal(s.event.points, before + POINTS_PER[r.points]);
  });
}
