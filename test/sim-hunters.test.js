// Hunters: expeditions, hauls, pity timer, album sets, levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  unlocked, unlockRegions, send, canSend, resolveReturns, hire, addPostcard, postcardsForRegion,
  tripMs, wildChance, choose, offerChoice, tripsSummary, SET_HAUL_BONUS, haulPerPigment,
} from '../src/sim/hunters.js';
import { xpForLevel, DURATIONS, PITY_STEP } from '../src/content/hunters.js';
import { getRegion } from '../src/content/regions.js';

const NOW = Date.UTC(2026, 9, 2, 9);
const MIN = 60e3;

function fresh(seed = 7) {
  const s = createInitialState(NOW, seed);
  s.phase = 2;
  unlockRegions(s, {}, NOW);
  return s;
}

test('hunters unlock at the end of Phase 1 and Wren joins free', () => {
  const s = createInitialState(NOW, 1);
  assert.equal(unlocked(s), false);
  assert.deepEqual(unlockRegions(s, {}, NOW), []);
  s.phase = 2;
  assert.equal(unlocked(s), true);
  unlockRegions(s, {}, NOW);
  assert.ok(s.hunters.roster.some((h) => h.id === 'wren'));
  assert.ok(s.hunters.regionsUnlocked.includes('meadow'));
  assert.ok(!s.hunters.regionsUnlocked.includes('volcano'));
});

test('hire costs coins and respects requirements', () => {
  const s = fresh();
  assert.equal(hire(s, { hunterId: 'tobias' }).reason, 'coins');
  s.coins = 500;
  assert.equal(hire(s, { hunterId: 'tobias' }).ok, true);
  assert.equal(s.coins, 100);
  s.coins = 1e6;
  assert.equal(hire(s, { hunterId: 'pip' }).reason, 'colors');
});

test('send and return yields raw haul, xp and a ledger record', () => {
  const s = fresh();
  assert.equal(canSend(s, { hunterId: 'wren', regionId: 'volcano', duration: 'short' }).ok, false);
  const r = send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'short' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.returnsAt, NOW + 30 * MIN);
  assert.equal(send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'short' }, NOW).ok, false);
  assert.deepEqual(resolveReturns(s, NOW + 29 * MIN), []);
  const before = { ...s.raw };
  const out = resolveReturns(s, NOW + 30 * MIN);
  assert.equal(out.length, 1);
  for (const pid of getRegion('meadow').hauls) assert.ok((s.raw[pid] ?? 0) > (before[pid] ?? 0), pid);
  const w = s.hunters.roster.find((h) => h.id === 'wren');
  assert.equal(w.state, 'home');
  assert.equal(w.xp, 1);
  assert.ok(w.lastHaul && w.lastHaul.region === 'meadow');
  assert.ok(s._events.some((e) => e.type === 'hunterReturn' && e.hunterId === 'wren'));
  // first meadow return opens the Saffron Field
  assert.deepEqual(s.stations.sources.saffron, { level: 1 });
});

test('same seed, same haul (deterministic)', () => {
  const run = () => {
    const s = fresh(99);
    send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'long' }, NOW);
    resolveReturns(s, NOW + 5 * 3600e3);
    return JSON.stringify({ raw: s.raw, album: s.album, seed: s.seed });
  };
  assert.equal(run(), run());
});

test('pity timer rises on misses and resets on a wild find', () => {
  const s = fresh(3);
  const w = s.hunters.roster.find((h) => h.id === 'wren');
  let t = NOW;
  let misses = 0;
  for (let i = 0; i < 30 && misses < 2; i++) {
    const before = w.pityStreak;
    send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'short' }, t);
    t += 31 * MIN;
    const [ret] = resolveReturns(s, t);
    if (!ret.wild) { assert.equal(w.pityStreak, before + 1); misses++; } else assert.equal(w.pityStreak, 0);
  }
  assert.ok(misses >= 1);
  const chanceBefore = wildChance(w, 'meadow', 'short');
  assert.ok(chanceBefore >= DURATIONS.short.wild + w.pityStreak * PITY_STEP - 1e-9);
  w.pityStreak = 100; // forces a find
  const known = Object.keys(s.catalog.discovered).length;
  send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'short' }, t);
  const [ret] = resolveReturns(s, t + 31 * MIN);
  assert.ok(ret.wild, 'wild hue found');
  assert.ok(getRegion('meadow').wildHues.includes(ret.wild));
  assert.ok(s.catalog.discovered[ret.wild]);
  assert.ok(Object.keys(s.catalog.discovered).length > known);
  assert.equal(w.pityStreak, 0);
});

test('album: duplicates give Seals; a full set completes with a haul bonus', () => {
  const s = fresh();
  const set = postcardsForRegion('meadow');
  assert.equal(set.length, 8);
  const w = s.hunters.roster[0];
  const haulBefore = haulPerPigment(s, w, 'meadow', 'short', 'saffron');
  for (const c of set.slice(0, 7)) addPostcard(s, c.id, NOW);
  assert.equal(s.album.setsDone.includes('meadow'), false);
  const seals = s.seals;
  const dup = addPostcard(s, set[0].id, NOW);
  assert.equal(dup.duplicate, true);
  assert.equal(s.seals, seals + 5);
  assert.equal(s.album.cards[set[0].id].count, 2);
  const last = addPostcard(s, set[7].id, NOW);
  assert.equal(last.setComplete, 'meadow');
  assert.ok(s.album.setsDone.includes('meadow'));
  assert.ok(s._events.some((e) => e.type === 'setComplete' && e.region === 'meadow'));
  const haulAfter = haulPerPigment(s, w, 'meadow', 'short', 'saffron');
  assert.ok(Math.abs(haulAfter / haulBefore - (1 + SET_HAUL_BONUS)) < 1e-9);
});

test('levels up from trips; level 5 trips are 10% shorter', () => {
  const s = fresh();
  const w = s.hunters.roster[0];
  w.xp = xpForLevel(2) - 1;
  send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'short' }, NOW);
  const [ret] = resolveReturns(s, NOW + 31 * MIN);
  assert.equal(w.level, 2);
  assert.equal(ret.levelUp, 2);
  w.level = 5;
  assert.equal(tripMs(w, 'long'), Math.round(DURATIONS.long.ms * 0.9));
});

test('long trips radio in a scouting choice at 40%', () => {
  const s = fresh();
  send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'long' }, NOW);
  assert.equal(offerChoice(s, { hunterId: 'wren' }, NOW + 60 * MIN), null);
  const at = NOW + Math.round(DURATIONS.long.ms * 0.4);
  const list = offerChoice(s, {}, at);
  assert.equal(list.length, 1);
  assert.ok(s._events.some((e) => e.type === 'scoutChoice' && e.hunterId === 'wren'));
  assert.equal(choose(s, { hunterId: 'wren', pick: 'b' }, at).ok, true);
  assert.equal(choose(s, { hunterId: 'wren', pick: 'a' }, at).ok, false);
  const view = tripsSummary(s, at);
  assert.equal(view[0].state, 'out');
  assert.ok(view[0].progress > 0.39 && view[0].progress < 0.41);
});
