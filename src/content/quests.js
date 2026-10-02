// quests.js — spec: DESIGN.md "Quests and weekly events" > "Daily quests" and
// "Weekly quest"; "Economy" (about 60 Seals/day from dailies, 150/week from the
// weekly quest).
//
// Dailies: three per day, drawn from QUEST_TYPES weighted toward what she has
// unlocked; one free reroll; no streaks; a catch-up bank holds up to 2 missed days.
//
// QUEST_TYPES entries:
//   text        template with {n} (target amount) and {region} (region name)
//   event       the progress hook name sim calls: questEvent(state, event, amount)
//   requires    { phase: n } minimum phase and/or { flag: 'hunters'|'gallery'|'shelf'|'fleet' }
//   weight      relative draw weight
//   nRange      [min, max] target amount (inclusive)
//   regions     (optional) region ids to fill {region} from
//   reward      { seals, boostMin }  Seals + a production boost of boostMin minutes

/** Progress hooks a quest may listen to. Keep this list authoritative. */
export const QUEST_EVENTS = Object.freeze([
  'orderFilled', 'boardSolved', 'hunterSent', 'crateShipped', 'batchPurified',
  'colorNamed', 'merged', 'regionsPainted', 'colorDiscovered', 'upgradeBought',
]);

/** Extra hooks only the weekly quest uses. */
export const WEEKLY_EVENTS = Object.freeze(['commissionDone', 'postcardSetDone', 'pieceSigned', 'postcardCollected']);

export const ALL_QUEST_EVENTS = Object.freeze([...QUEST_EVENTS, ...WEEKLY_EVENTS]);

export const QUEST_FLAGS = Object.freeze(['hunters', 'gallery', 'shelf', 'fleet']);

export const DAILY_COUNT = 3;
export const BANK_MAX_DAYS = 2;
export const DAILY_REROLLS = 1;
export const SEALS_PER_DAY = 60;
export const DAILY_REWARD = Object.freeze({ seals: 20, boostMin: 10 });
export const WEEKLY_SEALS = 150;

const q = (o) => Object.freeze({ reward: DAILY_REWARD, regions: null, ...o,
  requires: Object.freeze({ ...o.requires }), nRange: Object.freeze(o.nRange) });

export const QUEST_TYPES = Object.freeze([
  q({ id: 'fill-orders', text: 'Fill {n} orders', event: 'orderFilled', requires: { phase: 1 }, weight: 10, nRange: [2, 3] }),
  q({ id: 'solve-board', text: 'Solve {n} grading board', event: 'boardSolved', requires: { phase: 1 }, weight: 10, nRange: [1, 2] }),
  q({ id: 'name-color', text: 'Name {n} new color', event: 'colorNamed', requires: { phase: 1 }, weight: 6, nRange: [1, 1] }),
  q({ id: 'discover-color', text: 'Discover {n} new color', event: 'colorDiscovered', requires: { phase: 1 }, weight: 8, nRange: [1, 2] }),
  q({ id: 'buy-upgrades', text: 'Buy {n} upgrades', event: 'upgradeBought', requires: { phase: 1 }, weight: 8, nRange: [3, 5] }),
  q({ id: 'merge-bottle', text: 'Merge {n} Bottle', event: 'merged', requires: { flag: 'shelf' }, weight: 7, nRange: [1, 3] }),
  q({ id: 'paint-regions', text: 'Paint {n} regions', event: 'regionsPainted', requires: { flag: 'gallery' }, weight: 7, nRange: [8, 12] }),
  q({ id: 'send-hunter', text: 'Send a hunter to the {region}', event: 'hunterSent', requires: { flag: 'hunters' }, weight: 8, nRange: [1, 1],
    regions: ['meadow', 'quarry', 'coast', 'jungle', 'volcano'] }),
  q({ id: 'ship-crates', text: 'Ship {n} crates', event: 'crateShipped', requires: { flag: 'fleet' }, weight: 7, nRange: [3, 5] }),
  q({ id: 'purify-batch', text: 'Purify {n} batch', event: 'batchPurified', requires: { phase: 2 }, weight: 6, nRange: [1, 2] }),
]);

export const QUEST_TYPES_BY_ID = Object.freeze(Object.fromEntries(QUEST_TYPES.map((x) => [x.id, x])));
export const byId = QUEST_TYPES_BY_ID;

export function getQuestType(id) {
  return QUEST_TYPES_BY_ID[id] ?? null;
}

/**
 * Quest types she can be dealt right now.
 * unlocks: { phase, hunters, gallery, shelf, fleet } (booleans for flags)
 * disabled: ids she turned off in settings.
 */
export function eligibleQuestTypes(unlocks = {}, disabled = []) {
  const phase = unlocks.phase ?? 1;
  return QUEST_TYPES.filter((t) => {
    if (disabled.includes(t.id)) return false;
    if (t.requires.phase && phase < t.requires.phase) return false;
    if (t.requires.flag && !unlocks[t.requires.flag]) return false;
    return true;
  });
}

/** Fill a quest text template. */
export function questText(type, n, regionName = '') {
  return type.text.replace('{n}', String(n)).replace('{region}', regionName);
}

const wq = (o) => Object.freeze({ ...o, steps: Object.freeze(o.steps.map((s) => Object.freeze(s))),
  reward: Object.freeze({ seals: WEEKLY_SEALS, ...o.reward }) });

// Weekly quest: one goal of 3 to 5 steps, about 3 to 4 check-ins. Reward: a guaranteed
// rare (wild hue, gold postcard or hunter level) plus Seals.
// step: { event, n, text, family?, commission?, region? }
export const WEEKLY_QUESTS = Object.freeze([
  wq({ id: 'ocean-week', name: 'The Ocean Week', blurb: 'The sea is calling: paint it, send for it, name it.',
    steps: [
      { event: 'hunterSent', n: 1, region: 'coast', text: 'Send a hunter to the Coast' },
      { event: 'colorDiscovered', n: 3, family: 'blue', text: 'Discover 3 new blues' },
      { event: 'colorNamed', n: 1, text: 'Name a new color' },
      { event: 'commissionDone', n: 1, commission: 'ocean-mural', text: 'Complete the Ocean commission' },
    ], reward: { rare: 'wild' } }),
  wq({ id: 'blue-hour', name: 'Five Blues', blurb: 'A week for blues, from pale to deep.',
    steps: [
      { event: 'colorDiscovered', n: 5, family: 'blue', text: 'Discover 5 new blues' },
      { event: 'boardSolved', n: 2, text: 'Solve 2 grading boards' },
      { event: 'orderFilled', n: 3, text: 'Fill 3 orders' },
    ], reward: { rare: 'wild' } }),
  wq({ id: 'postcard-week', name: 'Postcards Home', blurb: 'Hunters write home. Finish a whole set.',
    steps: [
      { event: 'hunterSent', n: 3, text: 'Send hunters on 3 trips' },
      { event: 'postcardCollected', n: 4, text: 'Collect 4 postcards' },
      { event: 'postcardSetDone', n: 1, text: 'Finish a postcard set' },
    ], reward: { rare: 'gold-postcard' } }),
  wq({ id: 'busy-bench', name: 'The Busy Bench', blurb: 'A cheerful week of orders, mixing and upgrades.',
    steps: [
      { event: 'orderFilled', n: 5, text: 'Fill 5 orders' },
      { event: 'batchPurified', n: 2, text: 'Purify 2 batches' },
      { event: 'upgradeBought', n: 8, text: 'Buy 8 upgrades' },
      { event: 'crateShipped', n: 6, text: 'Ship 6 crates' },
    ], reward: { rare: 'hunter-level' } }),
  wq({ id: 'gallery-week', name: 'Gallery Week', blurb: 'Paint something you are proud of.',
    steps: [
      { event: 'regionsPainted', n: 20, text: 'Paint 20 regions' },
      { event: 'pieceSigned', n: 1, text: 'Sign a finished piece' },
      { event: 'merged', n: 3, text: 'Merge 3 Bottles' },
    ], reward: { rare: 'gold-postcard' } }),
  wq({ id: 'big-project', name: 'A Big Project', blurb: 'Take on a commission from start to finish.',
    steps: [
      { event: 'colorDiscovered', n: 2, text: 'Discover 2 new colors' },
      { event: 'orderFilled', n: 3, text: 'Fill 3 orders' },
      { event: 'crateShipped', n: 4, text: 'Ship 4 crates' },
      { event: 'commissionDone', n: 1, text: 'Complete a commission' },
      { event: 'colorNamed', n: 1, text: 'Name a new color' },
    ], reward: { rare: 'hunter-level' } }),
]);

export const WEEKLY_QUESTS_BY_ID = Object.freeze(Object.fromEntries(WEEKLY_QUESTS.map((w) => [w.id, w])));

export function getWeeklyQuest(id) {
  return WEEKLY_QUESTS_BY_ID[id] ?? null;
}

/** Weekly quest for an ISO week key like '2026-W40' (rotates by week number). */
export function weeklyQuestForWeek(weekKey) {
  const m = /W(\d+)/.exec(String(weekKey));
  const n = m ? parseInt(m[1], 10) : 0;
  return WEEKLY_QUESTS[n % WEEKLY_QUESTS.length];
}
