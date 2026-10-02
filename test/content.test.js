// Content integrity: unique ids, resolvable cross-references, spec numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCES, STARTING_SOURCES, MAX_SOURCES_ERA1, getSource } from '../src/content/sources.js';
import { ROOMS, MAX_SLOTS, slotsForRooms, getRoom } from '../src/content/rooms.js';
import { STATION_KINDS, GRINDER_KINDS, VEHICLES, RUSH_COOLDOWN_MS, SHOP, milestonesPassed, getVehicle } from '../src/content/stations.js';
import { ROUTES, FAMILIES, DEMAND_BONUS } from '../src/content/routes.js';
import { REGIONS, EVENT_REGION_IDS } from '../src/content/regions.js';
import { HUNTERS, TRAITS, DURATIONS, LEVELS, HAUL_CLASS, PITY_STEP, MAX_ROSTER, SCOUT_CHOICES, xpForLevel, levelForXp } from '../src/content/hunters.js';
import { APPRENTICES } from '../src/content/apprentices.js';
import { HERITAGE_TREE, HERITAGE_DIVISOR, HERITAGE_INCOME, heritageForRun } from '../src/content/heritage.js';
import { ERAS } from '../src/content/eras.js';
import { COMMISSIONS, getCommission } from '../src/content/commissions.js';
import { QUEST_TYPES, WEEKLY_QUESTS, QUEST_EVENTS, ALL_QUEST_EVENTS, QUEST_FLAGS, DAILY_COUNT, BANK_MAX_DAYS, eligibleQuestTypes } from '../src/content/quests.js';
import { EVENTS, ROTATION_WEEKS, eventForWeek, trackStepsReached } from '../src/content/events.js';

const PIGMENTS = ['madder', 'ochre', 'woad', 'saffron', 'indigo', 'murex', 'lapis', 'cochineal', 'umber', 'sulfur', 'bone-black', 'chalk-white'];
const GUARANTEED_CATALOG = ['madder', 'ochre', 'woad', 'orange', 'green', 'violet'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ids = (list) => list.map((x) => x.id);
const unique = (list, label) => assert.equal(new Set(list).size, list.length, `duplicate ids in ${label}`);

// Optional: cross-check against the sibling modules when they exist.
async function optional(path) {
  try { return await import(path); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return null; throw e; }
}

test('every content list has unique kebab-case ids', () => {
  const lists = { SOURCES, ROOMS, VEHICLES, GRINDER_KINDS, ROUTES, REGIONS, HUNTERS, HERITAGE_TREE, COMMISSIONS, QUEST_TYPES, WEEKLY_QUESTS, EVENTS };
  for (const [name, list] of Object.entries(lists)) {
    unique(ids(list), name);
    for (const x of list) assert.match(x.id, KEBAB, `${name}.${x.id}`);
  }
  unique(ids(APPRENTICES), 'APPRENTICES'); // camelCase (matches state.apprentices keys)
  unique(ids(ERAS).map(String), 'ERAS');
});

test('sources: starters and hunter-unlocked match the spec', () => {
  assert.deepEqual([...STARTING_SOURCES].sort(), ['madder', 'ochre', 'woad']);
  for (const id of STARTING_SOURCES) {
    const s = getSource(id);
    assert.equal(s.baseRate, STATION_KINDS.source.baseOutput); // starters share the station default (tools/balance/TUNING.md)
    assert.equal(s.baseCost, 10);
  }
  assert.ok(MAX_SOURCES_ERA1 === 8);
  const pig = SOURCES.map((s) => s.pigment);
  assert.deepEqual([...pig].sort(), [...PIGMENTS].sort(), 'one source per pigment');
  const want = { saffron: 'meadow', umber: 'quarry', murex: 'coast', lapis: 'quarry', indigo: 'jungle', cochineal: 'jungle', sulfur: 'volcano', 'bone-black': 'volcano', 'chalk-white': 'coast' };
  for (const [pigment, region] of Object.entries(want)) {
    const s = SOURCES.find((x) => x.pigment === pigment);
    assert.deepEqual({ ...s.unlock }, { type: 'region', region }, pigment);
  }
  for (const s of SOURCES) {
    assert.ok(s.baseRate > 0 && s.baseCost > 0);
    assert.ok(PIGMENTS.includes(s.pigment));
  }
});

test('sources and regions agree on which region unlocks which source', () => {
  const byRegion = new Map(REGIONS.map((r) => [r.id, r]));
  for (const s of SOURCES) {
    if (s.unlock.type !== 'region') continue;
    const r = byRegion.get(s.unlock.region);
    assert.ok(r, `${s.id}: region ${s.unlock.region} exists`);
    assert.ok(r.sourcesUnlocked.includes(s.id), `${r.id} lists ${s.id}`);
  }
  for (const r of REGIONS) for (const sid of r.sourcesUnlocked) assert.ok(getSource(sid), `${r.id} -> ${sid}`);
});

test('rooms: ordered by cost ascending, spec numbers, slot caps', () => {
  const costs = ROOMS.map((r) => r.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
  assert.equal(ROOMS[0].id, 'bench');
  const expect = { 'mill-room': [500, 10], 'mixing-hall': [3000, 18], cellar: [12000, 24], 'loading-yard': [40000, 30], atelier: [150000, 45], 'gallery-wing': [8000, 20], 'long-hall': [60000, 40], rotunda: [400000, 70] };
  for (const [id, [cost, colors]] of Object.entries(expect)) {
    assert.equal(getRoom(id).cost, cost, id);
    assert.equal(getRoom(id).colorsRequired, colors, id);
  }
  assert.equal(getRoom('cellar').adds.cellarMult, 4);
  assert.equal(getRoom('loading-yard').adds.fleetSlots, 3);
  assert.equal(getRoom('atelier').phase, 3);
  assert.deepEqual({ ...MAX_SLOTS }, { mixers: 6, vats: 12, grinders: 3, fleet: 6 });
  const all = slotsForRooms(ROOMS.map((r) => r.id));
  assert.equal(all.mixers, MAX_SLOTS.mixers);
  assert.equal(all.vats, MAX_SLOTS.vats);
  assert.equal(all.grinders, MAX_SLOTS.grinders);
  assert.ok(all.fleet <= MAX_SLOTS.fleet);
  assert.equal(slotsForRooms(['bench']).mixers, 1);
  for (const r of ROOMS) assert.ok([1, 2, 3].includes(r.phase));
});

test('stations: growth, milestones, vehicles, shop, rush', () => {
  for (const k of ['source', 'grinder', 'mixer', 'vat', 'shop', 'vehicle']) assert.ok(STATION_KINDS[k], k);
  assert.equal(STATION_KINDS.vat.costGrowth, 1.10);
  for (const k of ['source', 'grinder', 'mixer', 'shop', 'vehicle']) assert.equal(STATION_KINDS[k].costGrowth, 1.15);
  assert.deepEqual([...STATION_KINDS.source.milestones], [10, 25, 50, 100, 150, 200]);
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50, 100, 150, 199, 200, 999].map(milestonesPassed), [0, 0, 1, 1, 2, 2, 3, 4, 5, 5, 6, 6]);
  assert.deepEqual(GRINDER_KINDS.map((g) => g.id), ['mortar', 'millstone', 'roller-mill']);
  for (let i = 0; i < GRINDER_KINDS.length - 1; i++) {
    assert.ok(GRINDER_KINDS[i + 1].throughput > GRINDER_KINDS[i].throughput);
    assert.ok(GRINDER_KINDS[i + 1].purityBonus > GRINDER_KINDS[i].purityBonus);
    assert.ok(GRINDER_KINDS[i].upgradeCost > 0);
    assert.equal(GRINDER_KINDS[i].next, GRINDER_KINDS[i + 1].id);
  }
  assert.equal(GRINDER_KINDS.at(-1).upgradeCost, null);
  const min = 60e3;
  const h = getVehicle('handcart'), w = getVehicle('wagon'), b = getVehicle('river-barge');
  assert.deepEqual([h.capacity, h.tripMs, h.cost], [20, 10 * min, 2000]);
  assert.deepEqual([w.capacity, w.tripMs, w.cost], [80, 20 * min, 15000]);
  assert.deepEqual([b.capacity, b.tripMs, b.cost], [400, 45 * min, 90000]);
  const eraOf = (era) => VEHICLES.filter((v) => v.era === era).map((v) => v.id).sort();
  assert.deepEqual(eraOf(1), ['handcart', 'river-barge', 'wagon']);
  assert.deepEqual(eraOf(2), ['delivery-truck', 'steam-train']);
  assert.deepEqual(eraOf(3), ['airship', 'beam-relay', 'pneumatic-tube']);
  assert.equal(RUSH_COOLDOWN_MS, 10 * min);
  assert.equal(SHOP.baseSellRate, STATION_KINDS.shop.baseOutput); // value tuned in tools/balance/TUNING.md
  assert.equal(SHOP.priceBonusPerLevel, 0.01);
  for (const e of ERAS) for (const v of e.vehicles) assert.equal(getVehicle(v)?.era, e.id, v);
});

test('routes: families valid, palettes, unlocks, discovered markets', () => {
  const FAM = new Set(FAMILIES);
  for (const r of ROUTES) {
    assert.ok(r.palette.length > 0, r.id);
    for (const f of r.palette) assert.ok(FAM.has(f), `${r.id}: ${f}`);
    assert.ok(['phase', 'colors', 'discovered'].includes(r.unlock.type), r.id);
    if (r.unlock.type === 'discovered') assert.ok(REGIONS.some((g) => g.id === r.discoveredBy), `${r.id} discoveredBy`);
    assert.equal(r.demandDriftDays, 3);
  }
  const by = Object.fromEntries(ROUTES.map((r) => [r.id, r]));
  assert.equal(by['harbor-town'].premium, 0.4);
  assert.equal(by['festival-city'].premium, 0.35);
  assert.equal(by.abbey.premium, 0.5);
  assert.equal(by.abbey.wantsPurity, true);
  assert.equal(by['weavers-row'].premium, -0.3);
  assert.ok(by['weavers-row'].bulk && by['weavers-row'].unlimited);
  assert.equal(by.glassworks.discoveredBy, 'coast');
  assert.equal(by['dyers-guild'].discoveredBy, 'jungle');
  assert.equal(by.cartographers.discoveredBy, 'quarry');
  assert.deepEqual({ ...DEMAND_BONUS }, { min: 0.2, max: 0.6 });
});

test('regions: spec table, valid references, event regions exist', () => {
  const FAM = new Set(FAMILIES);
  const src = new Set(ids(SOURCES));
  for (const r of REGIONS) {
    for (const f of r.palette) assert.ok(FAM.has(f), `${r.id}: ${f}`);
    for (const p of r.hauls) assert.ok(PIGMENTS.includes(p), `${r.id} haul ${p}`);
    for (const s of r.sourcesUnlocked) assert.ok(src.has(s));
    assert.equal(r.postcards, 8);
    assert.ok(r.mapPos.x >= 0 && r.mapPos.x <= 100 && r.mapPos.y >= 0 && r.mapPos.y <= 100, `${r.id} mapPos`);
  }
  const by = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
  assert.deepEqual({ ...by.meadow.unlock }.type, 'hunters');
  assert.deepEqual([by.quarry, by.coast, by.jungle, by.volcano].map((r) => r.unlock.n), [15, 25, 40, 60]);
  assert.equal(by.glacier.unlock.type, 'era');
  assert.equal(by.dreamshore.unlock.n, 3);
  assert.deepEqual([...by.meadow.wildHues], ['meadow-green', 'clover-pink', 'honey-gold']);
  assert.deepEqual([...by.volcano.wildHues], ['lava-red', 'sulfur-yellow', 'obsidian', 'ash-grey']);
  assert.deepEqual([...EVENT_REGION_IDS].sort(), ['garden', 'hilltop', 'lantern-bridge', 'night-market', 'glacier-pass', 'orchard', 'reef', 'scriptorium'].sort());
  for (const e of EVENTS) {
    const r = by[e.region];
    assert.ok(r, `event ${e.id} region ${e.region} exists`);
    assert.equal(r.event, e.id);
  }
  for (const r of REGIONS.filter((x) => x.kind === 'event')) assert.ok(EVENTS.some((e) => e.id === r.event));
});

test('hunters: roster, traits, durations, levels', () => {
  assert.equal(HUNTERS.length, MAX_ROSTER);
  for (const h of HUNTERS) {
    assert.ok(TRAITS[h.trait], `${h.id} trait`);
    for (const k of ['name', 'voice', 'blurb']) assert.ok(h[k], `${h.id}.${k}`);
    assert.ok(h.hireCost >= 0 && h.hireColors >= 0);
  }
  assert.equal(HUNTERS.filter((h) => h.hireColors === 0).length, 3);
  const by = Object.fromEntries(HUNTERS.map((h) => [h.id, h]));
  assert.deepEqual([by.pip.hireColors, by.mireille.hireColors, by.osei.hireColors], [25, 35, 50]);
  assert.deepEqual(['wren', 'tobias', 'ines', 'pip', 'mireille', 'osei'].map((i) => by[i].trait), ['botanist', 'miner', 'diver', 'lucky', 'trader', 'scholar']);
  for (const t of Object.values(TRAITS)) for (const r of t.regions) assert.ok(REGIONS.some((g) => g.id === r), `trait region ${r}`);
  for (const p of PIGMENTS) assert.ok(HAUL_CLASS[p], `haul class ${p}`);
  assert.deepEqual([DURATIONS.short, DURATIONS.long, DURATIONS.overnight].map((d) => [d.ms, d.haul, d.wild, d.card]),
    [[30 * 60e3, 1, 0.03, 0.10], [4 * 3600e3, 6, 0.12, 0.35], [12 * 3600e3, 15, 0.25, 0.60]]);
  assert.equal(PITY_STEP, 0.02);
  assert.equal(xpForLevel(1), 0);
  for (let l = 2; l <= LEVELS.max; l++) assert.ok(xpForLevel(l) > xpForLevel(l - 1));
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(xpForLevel(5)), 5);
  assert.equal(levelForXp(xpForLevel(5) - 1), 4);
  assert.equal(levelForXp(1e9), LEVELS.max);
  assert.deepEqual(Object.keys(LEVELS.perks).map(Number), [5, 10, 15]);
  assert.ok(SCOUT_CHOICES.length >= 3);
  for (const c of SCOUT_CHOICES) assert.ok(c.a.text && c.b.text && c.a.effect && c.b.effect);
});

test('apprentices: spec table', () => {
  const by = Object.fromEntries(APPRENTICES.map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(by), ['errandRunner', 'orderClerk', 'dispatcher', 'packer', 'steward']);
  assert.deepEqual(Object.values(by).map((a) => a.phase), [1, 2, 2, 2, 3]);
  assert.equal(by.orderClerk.payoutMult, 0.7);
  for (const a of APPRENTICES) assert.ok(a.payoutMult <= 1 && a.cost >= 0);
});

test('heritage: tree is well-formed, formula constants', () => {
  assert.equal(HERITAGE_DIVISOR, 1e7);
  assert.equal(HERITAGE_INCOME, 0.05);
  assert.equal(heritageForRun(1e7), 1);
  assert.equal(heritageForRun(0), 0);
  assert.ok(HERITAGE_TREE.length >= 8);
  const apprenticeIds = new Set(ids(APPRENTICES));
  const effectKeys = ['startVats', 'startCoins', 'phaseSpeed', 'autoApprentice', 'startMixers'];
  for (const n of HERITAGE_TREE) {
    assert.equal(n.cost.length, n.maxLevel, n.id);
    const keys = Object.keys(n.effect);
    assert.equal(keys.length, 1);
    assert.ok(effectKeys.includes(keys[0]), `${n.id}: ${keys[0]}`);
    if (keys[0] === 'autoApprentice') assert.ok(apprenticeIds.has(n.effect.autoApprentice));
    for (let i = 1; i < n.cost.length; i++) assert.ok(n.cost[i] >= n.cost[i - 1]);
  }
});

test('eras: three eras, capstones resolve', () => {
  assert.deepEqual(ERAS.map((e) => [e.id, e.mixing, e.priceScale, e.colorCount, e.playable]), [
    [1, 'subtractive-muted', 1, 100, true], [2, 'subtractive-vivid', 1e3, 80, false], [3, 'additive', 1e6, 60, false]]);
  for (const e of ERAS) {
    const c = getCommission(e.capstoneCommission);
    assert.ok(c, `${e.id} capstone`);
    assert.ok(c.capstone);
    assert.equal(c.era, e.id);
  }
  assert.equal(getCommission('the-grand-catalogue').colorsRequired, 80);
});

test('commissions: steps reference valid families, pigments and wild hues', async () => {
  const FAM = new Set(FAMILIES);
  const wildIds = new Set(REGIONS.flatMap((r) => r.wildHues));
  const era1 = COMMISSIONS.filter((c) => c.era === 1);
  assert.ok(era1.length >= 10);
  for (const id of ['harbor-lighthouse', 'cathedral-window', 'festival-banners', 'the-grand-catalogue']) assert.ok(getCommission(id), id);
  assert.equal(era1.filter((c) => c.capstone).length, 1);
  for (const c of COMMISSIONS) {
    if (!c.comingSoon) assert.ok(c.steps.length > 0, c.id);
    assert.ok(c.reward.incomeMinutes >= 0 && 'signatureColor' in c.reward && c.reward.trophy, c.id);
    for (const s of c.steps) {
      const kinds = ['family', 'families', 'pigment', 'colorId'].filter((k) => s[k] !== undefined);
      assert.equal(kinds.length, 1, `${c.id}: exactly one selector`);
      assert.ok(s.jars > 0 && s.distinct >= 1);
      if (s.family) assert.ok(FAM.has(s.family), `${c.id}: ${s.family}`);
      if (s.families) for (const f of s.families) assert.ok(FAM.has(f), `${c.id}: ${f}`);
      if (s.pigment) assert.ok(PIGMENTS.includes(s.pigment), `${c.id}: ${s.pigment}`);
      if (s.colorId && !s.wild) assert.ok(GUARANTEED_CATALOG.includes(s.colorId), `${c.id}: ${s.colorId}`);
      if (s.wild) assert.ok(wildIds.has(s.colorId), `${c.id}: wild ${s.colorId} is a region wild hue`);
      if (s.purity) assert.equal(s.purity, 'pure');
      if (s.tier) assert.ok(s.tier >= 1 && s.tier <= 5);
    }
  }
  const lighthouse = getCommission('harbor-lighthouse');
  assert.ok(lighthouse.steps.some((s) => s.family === 'blue') && lighthouse.steps.some((s) => s.colorId === 'harbor-teal' && s.wild));
  assert.equal(getCommission('cathedral-window').steps.length, 8);
  assert.ok(getCommission('cathedral-window').steps.every((s) => s.purity === 'pure'));

  // If the catalog/pigments modules exist, cross-check them too.
  const cat = await optional('../src/content/catalog.js');
  if (cat?.CATALOG) {
    const catIds = new Set(cat.CATALOG.map((c) => c.id));
    for (const w of wildIds) assert.ok(catIds.has(w), `catalog has wild hue ${w}`);
    for (const g of GUARANTEED_CATALOG) assert.ok(catIds.has(g), `catalog has ${g}`);
  }
  const pig = await optional('../src/content/pigments.js');
  if (pig?.PIGMENTS) {
    const pids = new Set(pig.PIGMENTS.map((p) => p.id));
    for (const p of PIGMENTS) assert.ok(pids.has(p), `pigments has ${p}`);
  }
});

test('quests: events come from the fixed allowed set', () => {
  assert.deepEqual([...QUEST_EVENTS].sort(), ['batchPurified', 'boardSolved', 'colorDiscovered', 'colorNamed', 'crateShipped', 'hunterSent', 'merged', 'orderFilled', 'regionsPainted', 'upgradeBought']);
  for (const t of QUEST_TYPES) {
    assert.ok(QUEST_EVENTS.includes(t.event), `${t.id}: ${t.event}`);
    assert.ok(t.weight > 0);
    assert.ok(t.nRange[0] >= 1 && t.nRange[1] >= t.nRange[0]);
    assert.equal(t.reward.seals, 20);
    assert.equal(t.reward.boostMin, 10);
    if (t.requires.flag) assert.ok(QUEST_FLAGS.includes(t.requires.flag));
    if (t.text.includes('{region}')) for (const r of t.regions) assert.ok(REGIONS.some((g) => g.id === r), `${t.id}: ${r}`);
  }
  assert.equal(WEEKLY_QUESTS.length, 6);
  const FAM = new Set(FAMILIES);
  for (const w of WEEKLY_QUESTS) {
    assert.ok(w.steps.length >= 3 && w.steps.length <= 5, w.id);
    assert.equal(w.reward.seals, 150);
    assert.ok(['wild', 'gold-postcard', 'hunter-level'].includes(w.reward.rare), w.id);
    for (const s of w.steps) {
      assert.ok(ALL_QUEST_EVENTS.includes(s.event), `${w.id}: ${s.event}`);
      if (s.family) assert.ok(FAM.has(s.family));
      if (s.commission) assert.ok(getCommission(s.commission), `${w.id}: ${s.commission}`);
      if (s.region) assert.ok(REGIONS.some((g) => g.id === s.region));
    }
  }
  assert.equal(DAILY_COUNT, 3);
  assert.equal(BANK_MAX_DAYS, 2);
  // Phase-1 player with nothing unlocked can still be dealt at least DAILY_COUNT quest types.
  assert.ok(eligibleQuestTypes({ phase: 1 }).length >= DAILY_COUNT);
  assert.ok(eligibleQuestTypes({ phase: 2, hunters: true, gallery: true, shelf: true, fleet: true }).length === QUEST_TYPES.length);
});

test('events: 8 events, 10-step tracks, 12-color pages, rotation cycles all', () => {
  assert.equal(EVENTS.length, ROTATION_WEEKS);
  assert.deepEqual(ids(EVENTS), ['autumn-harvest', 'deep-sea', 'bloom-week', 'neon-night', 'winter-frost', 'festival-of-lanterns', 'golden-hour', 'ink-and-paper']);
  const FAM = new Set(FAMILIES);
  const allCanvases = [];
  for (const e of EVENTS) {
    for (const f of e.palette) assert.ok(FAM.has(f), `${e.id}: ${f}`);
    assert.equal(e.track.length, 10);
    assert.equal(e.catalogPage.length, 12);
    unique(e.catalogPage, `${e.id} catalogPage`);
    assert.equal(e.canvases.length, 2);
    allCanvases.push(...e.canvases);
    assert.deepEqual({ ...e.pointsPer }, { order: 10, board: 15, crate: 5, purify: 10, paint: 2 });
    assert.ok(Object.keys(e.twist.rules).length >= 1 && e.twist.text);
    let prev = 0, seals = 0;
    for (const s of e.track) {
      assert.ok(s.points > prev, `${e.id} step ${s.step} increasing`);
      prev = s.points;
      const keys = Object.keys(s.reward);
      assert.equal(keys.length, 1);
      assert.ok(['seals', 'cosmetic', 'canvas', 'vial', 'colorId'].includes(keys[0]));
      if (s.reward.colorId) assert.ok(e.catalogPage.includes(s.reward.colorId));
      if (s.reward.canvas) assert.ok(e.canvases.includes(s.reward.canvas));
      seals += s.reward.seals ?? 0;
    }
    assert.equal(e.track[5].points, 150, 'steps 1-6 ~ 20 minutes of play (150 points)');
    assert.equal(seals, 400);
    // 150 points is about 20 minutes: e.g. 6 orders + 3 boards + 9 crates .. sanity bound on per-action points.
    assert.ok(e.track[5].points / e.pointsPer.order <= 20);
  }
  unique(allCanvases, 'event canvases');
  const rules = Object.assign({}, ...EVENTS.map((e) => e.twist.rules));
  for (const k of ['boardShape', 'sourceUnlock', 'bouquetOrders', 'glowTiles', 'longTripBonus', 'packingLanterns', 'sunsetBoards', 'monochromeMaster']) assert.ok(k in rules, k);
  assert.equal(EVENTS[1].twist.rules.sourceUnlock, 'murex');
  assert.ok(SOURCES.some((s) => s.id === EVENTS[1].twist.rules.sourceUnlock));

  const seen = new Set();
  for (let w = 1; w <= 8; w++) seen.add(eventForWeek(`2026-W${String(w).padStart(2, '0')}`).id);
  assert.equal(seen.size, 8);
  assert.equal(eventForWeek('2026-W40').id, 'autumn-harvest');
  assert.equal(eventForWeek('2026-W41').id, 'deep-sea');
  assert.equal(eventForWeek('2026-W48').id, eventForWeek('2026-W40').id);
  assert.ok(eventForWeek('garbage'));
  assert.equal(trackStepsReached(EVENTS[0], 150), 6);
  assert.equal(trackStepsReached(EVENTS[0], 0), 0);
});
