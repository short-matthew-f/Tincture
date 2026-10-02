// Quests: daily roll, disabled types, progress + claim, reroll, catch-up bank, weekly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  rollDaily, reroll, questEvent, claim, rollWeekly, claimWeekly, unlocksOf, bankSeals,
} from '../src/sim/quests.js';
import { eligibleQuestTypes, QUEST_TYPES, DAILY_COUNT, BANK_MAX_DAYS, SEALS_PER_DAY } from '../src/content/quests.js';

const DAY = 86400e3;
const NOW = new Date(2026, 9, 2, 12).getTime(); // local noon

test('daily roll gives three eligible quests, once per day', () => {
  const s = createInitialState(NOW, 5);
  const list = rollDaily(s, NOW);
  assert.equal(list.length, DAILY_COUNT);
  const ok = eligibleQuestTypes(unlocksOf(s), []).map((t) => t.id);
  for (const q of list) {
    assert.ok(ok.includes(q.type), q.type);
    assert.ok(q.target >= 1);
    assert.equal(q.progress, 0);
  }
  assert.equal(new Set(list.map((q) => q.type)).size, DAILY_COUNT);
  assert.equal(rollDaily(s, NOW + 3600e3), null);
});

test('disabled quest types are never dealt', () => {
  const s = createInitialState(NOW, 6);
  const keep = ['fill-orders', 'solve-board', 'discover-color'];
  s.settings.disabledQuestTypes = QUEST_TYPES.map((t) => t.id).filter((id) => !keep.includes(id));
  for (let d = 0; d < 5; d++) {
    const list = rollDaily(s, NOW + d * DAY);
    for (const q of list) assert.ok(keep.includes(q.type), q.type);
  }
});

test('questEvent completes a quest and claim pays Seals plus a boost', () => {
  const s = createInitialState(NOW, 8);
  rollDaily(s, NOW);
  const q = s.quests.daily[0];
  const type = QUEST_TYPES.find((t) => t.id === q.type);
  questEvent(s, type.event, q.target - 1, { region: q.region });
  assert.equal(q.done, q.target - 1 >= q.target);
  assert.equal(claim(s, { questId: q.id }, NOW).ok, q.done);
  questEvent(s, type.event, 5, { region: q.region });
  assert.equal(q.done, true);
  assert.ok(s._events.some((e) => e.type === 'questDone' && e.questId === q.id));
  const r = claim(s, { questId: q.id }, NOW);
  assert.equal(r.ok, true);
  assert.equal(s.seals, q.reward.seals);
  assert.ok(s.boosts.some((b) => b.kind === 'production'));
  assert.equal(claim(s, { questId: q.id }, NOW).ok, false);
});

test('one free reroll per day', () => {
  const s = createInitialState(NOW, 9);
  rollDaily(s, NOW);
  const [a, b] = s.quests.daily;
  const r = reroll(s, { questId: a.id }, NOW);
  assert.equal(r.ok, true);
  assert.notEqual(s.quests.daily[0].id, a.id);
  assert.equal(reroll(s, { questId: b.id }, NOW).ok, false);
  rollDaily(s, NOW + DAY);
  assert.equal(reroll(s, { questId: s.quests.daily[1].id }, NOW + DAY).ok, true);
});

test('catch-up bank carries missed days, capped at two', () => {
  const s = createInitialState(NOW, 10);
  rollDaily(s, NOW);
  rollDaily(s, NOW + DAY); // yesterday's three dailies went unclaimed: one day banked
  assert.equal(s.quests.bank, 1);
  rollDaily(s, NOW + 6 * DAY);
  assert.equal(s.quests.bank, BANK_MAX_DAYS);
  assert.equal(bankSeals(s), BANK_MAX_DAYS * SEALS_PER_DAY);
  const q = s.quests.daily[0];
  questEvent(s, q.event, q.target, { region: q.region });
  const r = claim(s, { questId: q.id }, NOW + 6 * DAY);
  assert.equal(r.bankSeals, BANK_MAX_DAYS * SEALS_PER_DAY);
  assert.equal(s.seals, q.reward.seals + BANK_MAX_DAYS * SEALS_PER_DAY);
  assert.equal(s.quests.bank, 0);
});

test('weekly quest rolls per ISO week and pays a rare', () => {
  const s = createInitialState(NOW, 11);
  const w = rollWeekly(s, NOW);
  assert.ok(w && w.steps.length >= 3);
  assert.equal(rollWeekly(s, NOW + DAY), null);
  for (const st of w.steps) questEvent(s, st.event, st.n, { region: st.region, family: st.family, commission: st.commission });
  assert.equal(w.done, true);
  const seals = s.seals;
  const r = claimWeekly(s, {}, NOW);
  assert.equal(r.ok, true);
  assert.ok(s.seals >= seals + 150);
  assert.ok(r.rare);
});
