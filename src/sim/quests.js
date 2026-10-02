// sim/quests.js — daily quests (3/day, weighted by unlocks, one free reroll, disabled
// types), progress hooks, the catch-up bank (up to 2 missed days) and the weekly quest.
// Spec: DESIGN.md "Quests and weekly events" > "Daily quests", "Weekly quest";
// "Economy" (Seals, boosts). No streaks: unfinished dailies simply expire, and their
// value flows into the catch-up bank instead of being lost.
//
// questEvent(state, type, amount = 1, meta = {}) is the cross-module progress hook:
// any sim function that completes a player-facing action calls it.

import {
  eligibleQuestTypes, questText, getQuestType, DAILY_COUNT, BANK_MAX_DAYS, SEALS_PER_DAY,
  WEEKLY_QUESTS, weeklyQuestForWeek, getWeeklyQuest, WEEKLY_SEALS,
} from '../content/quests.js';
import { getRegion, REGIONS } from '../content/regions.js';
import { dayKey, isoWeekKey } from '../format.js';
import { stateRng, randInt, weightedPick, pick, uuid } from '../rng.js';
import { emit } from './bus.js';
import { addBoost } from './factory.js';
import { discover } from './discovery.js';
import {
  unlocked as huntersUnlocked, familyOfColor, colorInfo, knowsColor, postcardsForRegion, addPostcard,
} from './hunters.js';
import { levelForXp, xpForLevel, perksAtLevel, LEVELS } from '../content/hunters.js';

export const QUEST_BOOST_MULT = 0.5;  // the 10-minute production boost: +50%
export const SHELF_UNLOCK_COLORS = 5; // the Merge Shelf opens at 5 colors

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

function ensureQuests(state) {
  if (!state.quests || typeof state.quests !== 'object') {
    state.quests = { daily: [], dailyDate: null, rerollUsed: false, weekly: null, weeklyKey: null, bank: 0 };
  }
  const q = state.quests;
  if (!Array.isArray(q.daily)) q.daily = [];
  if (!Number.isFinite(q.bank)) q.bank = 0;
  return q;
}

function colorCount(state) {
  return Object.keys((state.catalog && state.catalog.discovered) || {}).length;
}

/** unlocksOf(state) -> {phase, hunters, gallery, shelf, fleet} for quest eligibility. */
export function unlocksOf(state) {
  const shelfCells = state.shelf && Array.isArray(state.shelf.cells) ? state.shelf.cells : [];
  return {
    phase: state.phase ?? 1,
    hunters: huntersUnlocked(state),
    gallery: !!(state.gallery && state.gallery.unlocked),
    shelf: colorCount(state) >= SHELF_UNLOCK_COLORS || shelfCells.some((c) => c),
    fleet: !!(state.stations && Array.isArray(state.stations.fleet) && state.stations.fleet.length > 0),
  };
}

function regionName(id) {
  const r = getRegion(id);
  return r ? r.name : id;
}

function makeQuest(state, type, rng, dk, i) {
  let region = null;
  if (type.regions) {
    const open = (state.hunters && state.hunters.regionsUnlocked) || [];
    const choices = type.regions.filter((r) => open.includes(r));
    if (!choices.length) return null;
    region = pick(rng, choices);
  }
  const target = randInt(rng, type.nRange[0], type.nRange[1]);
  return {
    id: `${dk}-${i}-${uuid(rng)}`,
    type: type.id,
    event: type.event,
    region,
    text: questText(type, target, region ? regionName(region) : ''),
    target,
    progress: 0,
    done: false,
    claimed: false,
    reward: { seals: type.reward.seals, boostMin: type.reward.boostMin },
  };
}

function drawQuests(state, count, dk, excludeTypes = [], startIndex = 0) {
  const rng = stateRng(state);
  const pool = eligibleQuestTypes(unlocksOf(state), (state.settings && state.settings.disabledQuestTypes) || [])
    .filter((t) => !excludeTypes.includes(t.id));
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < count && guard++ < 40) {
    let candidates = pool.filter((t) => !used.has(t.id));
    if (!candidates.length) candidates = pool; // fewer eligible types than slots: repeats are fine
    if (!candidates.length) break;
    const type = weightedPick(rng, candidates, (t) => t.weight);
    if (!type) break;
    used.add(type.id);
    const q = makeQuest(state, type, rng, dk, startIndex + out.length);
    if (q) out.push(q);
  }
  return out;
}

function daysBetween(fromKey, toKey) {
  const parse = (k) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  const d = Math.round((parse(toKey) - parse(fromKey)) / 86400000);
  return Number.isFinite(d) ? d : 0;
}

/**
 * rollDaily(state, now) — when the local day changes: unclaimed dailies expire, their
 * value (and any wholly skipped days) goes into the catch-up bank (<= 2 days), then
 * three fresh quests are drawn. Returns the new list, or null if today is already rolled.
 */
export function rollDaily(state, now = 0) {
  const q = ensureQuests(state);
  const dk = dayKey(now);
  if (q.dailyDate === dk) return null;
  if (q.dailyDate) {
    const gap = daysBetween(q.dailyDate, dk);
    if (gap > 0) {
      const count = Math.max(1, q.daily.length || DAILY_COUNT);
      const unclaimed = q.daily.filter((x) => !x.claimed).length;
      let missed = unclaimed / count + Math.max(0, gap - 1);
      // keep thirds clean so the bank pays whole Seals
      missed = Math.round(missed * DAILY_COUNT) / DAILY_COUNT;
      q.bank = Math.min(BANK_MAX_DAYS, fin(q.bank) + missed);
    }
  }
  q.daily = drawQuests(state, DAILY_COUNT, dk);
  q.dailyDate = dk;
  q.rerollUsed = false;
  return q.daily;
}

/** reroll(state, {questId}, now) — one free reroll per day. */
export function reroll(state, { questId } = {}, now = 0) {
  const q = ensureQuests(state);
  if (q.rerollUsed) return { ok: false, reason: 'used' };
  const i = q.daily.findIndex((x) => x.id === questId);
  if (i < 0) return { ok: false, reason: 'unknown' };
  if (q.daily[i].claimed || q.daily[i].done) return { ok: false, reason: 'done' };
  const dk = q.dailyDate ?? dayKey(now);
  const exclude = q.daily.map((x) => x.type);
  let fresh = drawQuests(state, 1, dk, exclude, 10 + i)[0];
  if (!fresh) fresh = drawQuests(state, 1, dk, [q.daily[i].type], 10 + i)[0];
  if (!fresh) return { ok: false, reason: 'no-alternative' };
  q.daily[i] = fresh;
  q.rerollUsed = true;
  return { ok: true, quest: fresh };
}

function metaFamily(meta) {
  if (meta.family) return meta.family;
  if (meta.colorId) return familyOfColor(meta.colorId);
  return null;
}

function stepMatches(step, meta) {
  if (step.region && meta.region !== step.region) return false;
  if (step.family && metaFamily(meta) !== step.family) return false;
  if (step.commission && (meta.commission ?? meta.commissionId ?? meta.id) !== step.commission) return false;
  return true;
}

/**
 * questEvent(state, type, amount = 1, meta = {}) — progress every daily and weekly step
 * listening to `type`. meta.region / meta.family / meta.colorId / meta.commission narrow
 * targeted quests. Returns the number of quests or steps advanced.
 */
export function questEvent(state, type, amount = 1, meta = {}) {
  const q = ensureQuests(state);
  const n = fin(Number(amount), 0);
  if (n <= 0) return 0;
  meta = meta || {};
  let touched = 0;
  for (const quest of q.daily) {
    if (quest.done || quest.claimed) continue;
    const ev = quest.event ?? (getQuestType(quest.type) || {}).event;
    if (ev !== type) continue;
    if (quest.region && meta.region !== quest.region) continue;
    quest.progress = Math.min(quest.target, fin(quest.progress) + n);
    touched++;
    if (quest.progress >= quest.target) {
      quest.done = true;
      emit(state, 'questDone', { questId: quest.id });
    }
  }
  const w = q.weekly;
  if (w && !w.done && Array.isArray(w.steps)) {
    for (const step of w.steps) {
      if (step.done || step.event !== type || !stepMatches(step, meta)) continue;
      step.progress = Math.min(step.n, fin(step.progress) + n);
      touched++;
      if (step.progress >= step.n) step.done = true;
    }
    if (w.steps.length && w.steps.every((s) => s.done)) {
      w.done = true;
      emit(state, 'weeklyDone', { weeklyId: w.id });
    }
  }
  return touched;
}

/** Seals the catch-up bank would pay right now. */
export function bankSeals(state) {
  return Math.round(fin(ensureQuests(state).bank) * SEALS_PER_DAY);
}

/** claim(state, {questId}, now) — Seals + a 10-minute production boost (+ the bank). */
export function claim(state, { questId } = {}, now = 0) {
  const q = ensureQuests(state);
  const quest = q.daily.find((x) => x.id === questId);
  if (!quest) return { ok: false, reason: 'unknown' };
  if (!quest.done) return { ok: false, reason: 'not-done' };
  if (quest.claimed) return { ok: false, reason: 'claimed' };
  quest.claimed = true;
  const seals = fin(quest.reward && quest.reward.seals);
  const bank = bankSeals(state);
  state.seals = fin(state.seals) + seals + bank;
  q.bank = 0;
  const minutes = fin(quest.reward && quest.reward.boostMin);
  if (minutes > 0) addBoost(state, { kind: 'production', mult: QUEST_BOOST_MULT, minutes }, now);
  return { ok: true, seals, bankSeals: bank, boostMin: minutes };
}

// ---------------------------------------------------------------------------
// Weekly quest
// ---------------------------------------------------------------------------

const STEP_NEEDS = {
  hunterSent: (u) => u.hunters,
  postcardCollected: (u) => u.hunters,
  postcardSetDone: (u) => u.hunters,
  commissionDone: (u) => u.phase >= 3,
  regionsPainted: (u) => u.gallery,
  pieceSigned: (u) => u.gallery,
  merged: (u) => u.shelf,
  crateShipped: (u) => u.fleet,
  batchPurified: (u) => u.phase >= 2,
};

function weeklyFeasible(state, wq) {
  const u = unlocksOf(state);
  const open = (state.hunters && state.hunters.regionsUnlocked) || [];
  return wq.steps.every((s) => {
    const need = STEP_NEEDS[s.event];
    if (need && !need(u)) return false;
    if (s.region && !open.includes(s.region)) return false;
    if (s.commission) {
      const c = state.commissions || {};
      if ((c.done || []).includes(s.commission)) return false;
      if (!(c.open || []).some((x) => x.id === s.commission)) return false;
    }
    return true;
  });
}

/** rollWeekly(state, now) — a new weekly quest each ISO week (rotation, skipping ones she can't do yet). */
export function rollWeekly(state, now = 0) {
  const q = ensureQuests(state);
  const wk = isoWeekKey(now);
  if (q.weeklyKey === wk) return null;
  const first = weeklyQuestForWeek(wk);
  const start = Math.max(0, WEEKLY_QUESTS.indexOf(first));
  let chosen = null;
  for (let i = 0; i < WEEKLY_QUESTS.length; i++) {
    const wq = WEEKLY_QUESTS[(start + i) % WEEKLY_QUESTS.length];
    if (weeklyFeasible(state, wq)) { chosen = wq; break; }
  }
  if (!chosen) chosen = getWeeklyQuest('blue-hour') ?? first;
  q.weekly = {
    id: chosen.id,
    weekKey: wk,
    steps: chosen.steps.map((s) => ({
      event: s.event, n: s.n, text: s.text, progress: 0, done: false,
      ...(s.family ? { family: s.family } : {}),
      ...(s.region ? { region: s.region } : {}),
      ...(s.commission ? { commission: s.commission } : {}),
    })),
    done: false,
    claimed: false,
    reward: { seals: chosen.reward.seals ?? WEEKLY_SEALS, rare: chosen.reward.rare },
  };
  q.weeklyKey = wk;
  return q.weekly;
}

function grantWild(state, now) {
  const rng = stateRng(state);
  const open = (state.hunters && state.hunters.regionsUnlocked) || [];
  let pool = [];
  for (const r of REGIONS) if (open.includes(r.id)) pool.push(...r.wildHues);
  pool = pool.filter((id) => colorInfo(id) && !knowsColor(state, id));
  if (!pool.length) {
    // nothing left in her open regions: any Era 1 wild hue she lacks
    for (const r of REGIONS) if ((r.era ?? 1) <= (state.era ?? 1)) pool.push(...r.wildHues);
    pool = pool.filter((id) => colorInfo(id) && !knowsColor(state, id));
  }
  if (!pool.length) return null;
  const colorId = pick(rng, pool);
  discover(state, { colorId, method: 'hunt' }, now);
  return { kind: 'wild', colorId };
}

function grantGoldPostcard(state, now) {
  const rng = stateRng(state);
  const open = (state.hunters && state.hunters.regionsUnlocked) || [];
  const regions = open.length ? open : ['meadow'];
  let cards = [];
  for (const r of regions) cards.push(...postcardsForRegion(r).filter((c) => c.rare || c.n === 8));
  if (!cards.length) return null;
  const unowned = cards.filter((c) => !(state.album && state.album.cards[c.id]));
  const card = pick(rng, unowned.length ? unowned : cards);
  const res = addPostcard(state, card.id, now);
  return res ? { kind: 'gold-postcard', postcardId: card.id, duplicate: res.duplicate } : null;
}

function grantHunterLevel(state) {
  const roster = (state.hunters && state.hunters.roster) || [];
  const eligible = roster.filter((h) => (h.level ?? 1) < LEVELS.max);
  if (!eligible.length) return null;
  const h = eligible.reduce((a, b) => ((b.level ?? 1) < (a.level ?? 1) ? b : a));
  const target = Math.min(LEVELS.max, (h.level ?? 1) + 1);
  h.xp = Math.max(fin(h.xp), xpForLevel(target));
  h.level = levelForXp(h.xp);
  h.perks = perksAtLevel(h.level).map((p) => p.id);
  return { kind: 'hunter-level', hunterId: h.id, level: h.level };
}

/** claimWeekly(state, args, now) — Seals plus a guaranteed rare (wild hue, gold postcard or hunter level). */
export function claimWeekly(state, args = {}, now = 0) {
  if (typeof args === 'number' && now === 0) now = args; // tolerate claimWeekly(state, now)
  const q = ensureQuests(state);
  const w = q.weekly;
  if (!w) return { ok: false, reason: 'none' };
  if (!w.done) return { ok: false, reason: 'not-done' };
  if (w.claimed) return { ok: false, reason: 'claimed' };
  w.claimed = true;
  const seals = fin(w.reward && w.reward.seals, WEEKLY_SEALS);
  state.seals = fin(state.seals) + seals;
  const order = { wild: [grantWild, grantGoldPostcard, grantHunterLevel],
    'gold-postcard': [grantGoldPostcard, grantWild, grantHunterLevel],
    'hunter-level': [grantHunterLevel, grantWild, grantGoldPostcard] }[w.reward && w.reward.rare] ?? [grantWild, grantGoldPostcard, grantHunterLevel];
  let rare = null;
  for (const fn of order) { rare = fn(state, now); if (rare) break; }
  if (!rare) { state.seals += 50; rare = { kind: 'seals', seals: 50 }; }
  return { ok: true, seals, rare };
}

/** Claimable quest count (dailies done but unclaimed, plus the weekly). */
export function questsReady(state) {
  const q = ensureQuests(state);
  let n = q.daily.filter((x) => x.done && !x.claimed).length;
  if (q.weekly && q.weekly.done && !q.weekly.claimed) n++;
  return n;
}

export { claim as claimQuest, reroll as rerollQuest };
