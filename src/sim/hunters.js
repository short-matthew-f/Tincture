// sim/hunters.js — Hue Hunters, expeditions, scouting choices, wild hues with a
// pity timer, postcards and the album, special markets, hunter levels and perks.
// Spec: DESIGN.md "Hue Hunters and postcards" (all) and "Fun and engagement" >
// "Gentle surprises" (companion postcard). Pure: no Date.now(), randomness via
// stateRng(state). Every exported action has the shape fn(state, args, now).

import {
  HUNTERS, getHunter, TRAITS, TRAIT_IDS, DURATIONS, PITY_STEP, MAX_ROSTER, HAUL_CLASS,
  MARKET_DISCOVERY_CHANCE, levelForXp, perksAtLevel, SCOUT_CHOICES, getScoutChoice,
} from '../content/hunters.js';
import { REGIONS, getRegion, isRegionUnlocked, EVENT_REGION_IDS } from '../content/regions.js';
import { MAX_SOURCES_ERA1, getSource } from '../content/sources.js';
import { marketsDiscoverableIn } from '../content/routes.js';
import { getPigment } from '../content/pigments.js';
import { getEvent } from '../content/events.js';
import * as CAT from '../content/catalog.js';
import * as PC from '../content/postcards.js';
import * as CV from '../content/canvases.js';
import { hueFamily, deltaEHex } from '../color.js';
import { stateRng, pick, weightedPick } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { discover, tryDiscover, discoveredCount } from './discovery.js';
import { addVial } from './shelf.js';
import { discoverMarket } from './shipping.js';

export const BASE_HAUL = 20;              // raw units per pigment for a 1x haul at level 0
export const SET_HAUL_BONUS = 0.05;       // completed postcard set: +5% haul in that region
export const DUPLICATE_SEALS = 5;         // a duplicate postcard converts to Seals
export const COMPANION_CHANCE = 1 / 15;   // long+ trips: a bonus card with a second hunter's note
export const HAUL_VIAL_CHANCE = 0.2;      // hauls sometimes include a vial of a regional color
export const SCHOLAR_TINT_DE = 8;         // Scholar reveals an undiscovered tint within this ΔE of a haul pigment
export const SCOUT_AT = 0.4;
const TINT_FOUND_BY = Object.freeze(['grade', 'mix']); // Scholar notes reveal grading/mixing cells only              // scouting choice radios in at 40% of a long/overnight trip
export const HUNTERS_UNLOCK_COLORS = 10;  // end of Phase 1

// ---------------------------------------------------------------------------
// Shared catalog helpers (also used by the other sim modules in this folder).
// catalog.js may be absent in early builds; everything degrades to empty lists.
// ---------------------------------------------------------------------------

function eventColorList() {
  const ec = CAT.EVENT_COLORS;
  if (!ec) return [];
  if (Array.isArray(ec)) return ec;
  if (typeof ec === 'object') {
    const out = [];
    for (const [eventId, v] of Object.entries(ec)) {
      const list = Array.isArray(v) ? v : (v && Array.isArray(v.colors) ? v.colors : []);
      for (const c of list) out.push(c && c.event ? c : { ...c, event: eventId });
    }
    return out;
  }
  return [];
}

let _index = null;
function colorIndex() {
  if (_index) return _index;
  const map = new Map();
  for (const c of (Array.isArray(CAT.CATALOG) ? CAT.CATALOG : [])) if (c && c.id) map.set(c.id, c);
  for (const c of eventColorList()) if (c && c.id && !map.has(c.id)) map.set(c.id, c);
  _index = map;
  return map;
}

/** Catalog (or event-page) color by id, or null. */
export function colorInfo(id) {
  return colorIndex().get(id) ?? null;
}

/** Every Era catalog color (not event pages). */
export function allColors() {
  return Array.isArray(CAT.CATALOG) ? CAT.CATALOG : [];
}

/** Event-page colors for an event id (array of catalog-shaped colors). */
export function eventColors(eventId) {
  return eventColorList().filter((c) => c.event === eventId || (typeof c.id === 'string' && c.id.startsWith(eventId + '-')));
}

/** Hue family of a color id ('neutral' when unknown). */
export function familyOfColor(id) {
  const c = colorInfo(id);
  if (c) {
    if (c.family) return c.family;
    try { return hueFamily(c.hex); } catch { return 'neutral'; }
  }
  const p = getPigment(id);
  if (p) { try { return hueFamily(p.hex); } catch { return 'neutral'; } }
  return 'neutral';
}

export function knowsColor(state, id) {
  return !!(state.catalog && state.catalog.discovered && state.catalog.discovered[id]);
}

function postcardList() {
  return Array.isArray(PC.POSTCARDS) ? PC.POSTCARDS : [];
}

/** Postcards of a region's set (8 for home and event regions). */
export function postcardsForRegion(regionId) {
  return postcardList().filter((c) => c.region === regionId);
}

function canvasList() {
  const cv = CV.CANVASES;
  if (Array.isArray(cv)) return cv;
  if (cv && typeof cv === 'object') return Object.values(cv);
  return [];
}

function isRareCard(card) {
  return !!(card && (card.rare || card.n === 8));
}

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

// ---------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------

function ensureHunters(state) {
  if (!state.hunters || typeof state.hunters !== 'object') state.hunters = { roster: [], regionsUnlocked: [] };
  if (!Array.isArray(state.hunters.roster)) state.hunters.roster = [];
  if (!Array.isArray(state.hunters.regionsUnlocked)) state.hunters.regionsUnlocked = [];
  if (!state.album || typeof state.album !== 'object') state.album = { cards: {}, setsDone: [] };
  if (!state.album.cards) state.album.cards = {};
  if (!Array.isArray(state.album.setsDone)) state.album.setsDone = [];
  state.routesDiscovered ??= [];
  return state.hunters;
}

/** Hunters unlock at the end of Phase 1: phase >= 2 or 10 colors discovered. */
export function unlocked(state) {
  return (state.phase ?? 1) >= 2 || discoveredCount(state) >= HUNTERS_UNLOCK_COLORS;
}

function newHunterRecord(def) {
  return {
    id: def.id, name: def.name, trait: def.trait, trait2: null,
    level: 1, xp: 0, state: 'home', trip: null, pityStreak: 0, perks: [], lastHaul: null,
  };
}

/**
 * unlockRegions(state, args, now) — applies REGIONS unlock rules (hunters / colors / era)
 * and the current weekly event's region. Also seats every free hunter (hire cost 0, no
 * catalog requirement) the moment hunters unlock. Returns newly unlocked region ids.
 */
export function unlockRegions(state) {
  const h = ensureHunters(state);
  if (!unlocked(state)) return [];
  const added = [];
  for (const def of HUNTERS) {
    if ((def.hireCost ?? 0) === 0 && (def.hireColors ?? 0) === 0 && !h.roster.some((x) => x.id === def.id) && h.roster.length < MAX_ROSTER) {
      h.roster.push(newHunterRecord(def));
      emit(state, 'hunterHired', { hunterId: def.id });
    }
  }
  const ctx = { era: state.era ?? 1, colors: discoveredCount(state), hunters: true };
  for (const r of REGIONS) {
    if (r.kind === 'event') continue;
    if (!h.regionsUnlocked.includes(r.id) && isRegionUnlocked(r, ctx)) {
      h.regionsUnlocked.push(r.id);
      added.push(r.id);
      emit(state, 'regionUnlocked', { region: r.id });
    }
  }
  // Event regions: only the current week's is open (progress for reruns lives in eventProgress).
  const evRegion = state.event && state.event.region;
  h.regionsUnlocked = h.regionsUnlocked.filter((id) => !EVENT_REGION_IDS.includes(id) || id === evRegion);
  if (evRegion && !h.regionsUnlocked.includes(evRegion)) {
    h.regionsUnlocked.push(evRegion);
    added.push(evRegion);
  }
  return added;
}

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

/** canHire(state, {hunterId}) -> {ok, reason?, cost} */
export function canHire(state, { hunterId } = {}) {
  const h = ensureHunters(state);
  const def = getHunter(hunterId);
  if (!def) return { ok: false, reason: 'unknown' };
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  if (h.roster.some((x) => x.id === hunterId)) return { ok: false, reason: 'hired' };
  if (h.roster.length >= MAX_ROSTER) return { ok: false, reason: 'full' };
  if (discoveredCount(state) < (def.hireColors ?? 0)) return { ok: false, reason: 'colors', need: def.hireColors - discoveredCount(state) };
  if (fin(state.coins) < (def.hireCost ?? 0)) return { ok: false, reason: 'coins', cost: def.hireCost };
  return { ok: true, cost: def.hireCost ?? 0 };
}

/** hire(state, {hunterId}) — Coins plus a catalog milestone; roster max 6. */
export function hire(state, args = {}) {
  const chk = canHire(state, args);
  if (!chk.ok) return chk;
  const def = getHunter(args.hunterId);
  state.coins = fin(state.coins) - chk.cost;
  state.hunters.roster.push(newHunterRecord(def));
  emit(state, 'hunterHired', { hunterId: def.id });
  return { ok: true, hunterId: def.id, cost: chk.cost };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export function getRosterHunter(state, hunterId) {
  return ensureHunters(state).roster.find((x) => x.id === hunterId) ?? null;
}

function traitsOf(hunter) {
  const out = [];
  if (hunter.trait && TRAITS[hunter.trait]) out.push(TRAITS[hunter.trait]);
  if (hunter.trait2 && TRAITS[hunter.trait2] && hunter.trait2 !== hunter.trait) out.push(TRAITS[hunter.trait2]);
  return out;
}

function perkValue(hunter, key, dflt) {
  let v = dflt;
  for (const p of perksAtLevel(hunter.level ?? 1)) if (p[key] !== undefined) v = p[key];
  return v;
}

/** Trip length in ms for a hunter (level 5 perk: 10% shorter). */
export function tripMs(hunter, duration) {
  const d = DURATIONS[duration];
  if (!d) return 0;
  return Math.round(d.ms * perkValue(hunter, 'tripTimeMult', 1));
}

function regionOpen(state, regionId) {
  const r = getRegion(regionId);
  if (!r) return false;
  if ((r.era ?? 1) > (state.era ?? 1)) return false;
  return ensureHunters(state).regionsUnlocked.includes(regionId);
}

/** canSend(state, {hunterId, regionId, duration}) -> {ok, reason?} */
export function canSend(state, { hunterId, regionId, duration } = {}) {
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const hunter = getRosterHunter(state, hunterId);
  if (!hunter) return { ok: false, reason: 'unknown-hunter' };
  if (hunter.state === 'out') return { ok: false, reason: 'out' };
  if (!DURATIONS[duration]) return { ok: false, reason: 'duration' };
  if (!regionOpen(state, regionId)) return { ok: false, reason: 'region' };
  return { ok: true };
}

/** send(state, {hunterId, regionId, duration}, now) — starts an expedition. */
export function send(state, args = {}, now = 0) {
  const chk = canSend(state, args);
  if (!chk.ok) return chk;
  const { hunterId, regionId, duration } = args;
  const hunter = getRosterHunter(state, hunterId);
  const ms = tripMs(hunter, duration);
  const d = DURATIONS[duration];
  const trip = {
    region: regionId, duration, departedAt: now, returnsAt: now + ms,
    choice: null, choiceOfferedAt: null, scoutId: null, choiceSeen: false,
  };
  if (d.scouting) {
    trip.choiceOfferedAt = now + Math.round(ms * SCOUT_AT);
    trip.scoutId = pick(stateRng(state), SCOUT_CHOICES).id;
  }
  hunter.state = 'out';
  hunter.trip = trip;
  questEvent(state, 'hunterSent', 1, { region: regionId });
  emit(state, 'hunterSent', { hunterId, region: regionId, duration });
  return { ok: true, hunterId, returnsAt: trip.returnsAt };
}

// ---------------------------------------------------------------------------
// Scouting choice
// ---------------------------------------------------------------------------

/**
 * offerChoice(state, {hunterId}, now) -> the pending choice {hunterId, id, prompt, a, b}
 * or null. Without a hunterId, scans every hunter, emits 'scoutChoice' once per trip
 * when its radio-in time passes, and returns the list of pending choices.
 */
export function offerChoice(state, args = {}, now = 0) {
  const h = ensureHunters(state);
  const view = (hunter) => {
    const c = getScoutChoice(hunter.trip.scoutId);
    return c ? { hunterId: hunter.id, id: c.id, prompt: c.prompt, a: c.a, b: c.b } : null;
  };
  const pending = (hunter) => hunter.state === 'out' && hunter.trip && hunter.trip.scoutId
    && hunter.trip.choice === null && hunter.trip.choiceOfferedAt !== null
    && hunter.trip.choiceOfferedAt <= now && hunter.trip.returnsAt > now;
  if (args && args.hunterId) {
    const hunter = getRosterHunter(state, args.hunterId);
    return hunter && pending(hunter) ? view(hunter) : null;
  }
  const out = [];
  for (const hunter of h.roster) {
    if (!pending(hunter)) continue;
    if (!hunter.trip.choiceSeen) {
      hunter.trip.choiceSeen = true;
      emit(state, 'scoutChoice', { hunterId: hunter.id });
    }
    const v = view(hunter);
    if (v) out.push(v);
  }
  return out;
}

/** choose(state, {hunterId, pick:'a'|'b'}) — answer a scouting radio call. */
export function choose(state, { hunterId, pick: which } = {}, now) {
  const hunter = getRosterHunter(state, hunterId);
  if (!hunter || hunter.state !== 'out' || !hunter.trip || !hunter.trip.scoutId) return { ok: false, reason: 'no-choice' };
  if (which !== 'a' && which !== 'b') return { ok: false, reason: 'pick' };
  if (hunter.trip.choice) return { ok: false, reason: 'chosen' };
  if (Number.isFinite(now) && hunter.trip.choiceOfferedAt !== null && now < hunter.trip.choiceOfferedAt) return { ok: false, reason: 'not-yet' };
  hunter.trip.choice = which;
  return { ok: true, hunterId, pick: which };
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

function scoutEffect(state, trip) {
  if (!trip.scoutId) return {};
  const c = getScoutChoice(trip.scoutId);
  if (!c) return {};
  let which = trip.choice;
  if (which !== 'a' && which !== 'b') which = stateRng(state)() < 0.5 ? 'a' : 'b'; // ignoring picks one at random
  trip.choice = which;
  return c[which].effect || {};
}

function regionOddsMult(traits, regionId) {
  let m = 1;
  for (const t of traits) if (t.regions && t.regions.includes(regionId)) m += t.regionOdds || 0;
  return m;
}

/** Raw haul for one pigment for this hunter in this region (before randomness). */
export function haulPerPigment(state, hunter, regionId, duration, pigmentId) {
  const d = DURATIONS[duration];
  if (!d) return 0;
  let mult = d.haul * BASE_HAUL * (1 + 0.05 * (hunter.level ?? 1));
  let trait = 1;
  for (const t of traitsOf(hunter)) if (t.haulClass && HAUL_CLASS[pigmentId] === t.haulClass) trait += t.haulBonus || 0;
  mult *= trait;
  if (state.album && state.album.setsDone && state.album.setsDone.includes(regionId)) mult *= 1 + SET_HAUL_BONUS;
  const ev = state.event && getEvent(state.event.key);
  const longBonus = ev && ev.twist && ev.twist.rules ? ev.twist.rules.longTripBonus : 0;
  if (longBonus && (duration === 'long' || duration === 'overnight')) mult *= 1 + longBonus;
  return fin(mult);
}

/** Card odds for one roll on a trip (base x trait, plus scouting). Exported for the map's send sheet. */
export function cardChance(hunter, regionId, duration, scout = {}) {
  const d = DURATIONS[duration];
  if (!d) return 0;
  const traits = traitsOf(hunter);
  let rel = regionOddsMult(traits, regionId);
  for (const t of traits) rel += t.cardBonus || 0;
  return Math.min(1, d.card * rel + (scout.card || 0));
}

/** Wild-hue odds: base + pity streak, lucky/region traits, scouting. */
export function wildChance(hunter, regionId, duration, scout = {}) {
  const d = DURATIONS[duration];
  if (!d) return 0;
  const traits = traitsOf(hunter);
  let rel = regionOddsMult(traits, regionId);
  for (const t of traits) rel += t.wildBonus || 0;
  return Math.min(1, d.wild * rel + fin(hunter.pityStreak) * PITY_STEP + (scout.wild || 0));
}

function canvasForRegion(regionId) {
  const list = canvasList();
  const byUnlock = list.find((c) => c && c.unlock && typeof c.unlock === 'object' && c.unlock.region === regionId
    && /postcard|set|album/i.test(String(c.unlock.type ?? c.unlock.kind ?? '')));
  if (byUnlock) return byUnlock.id;
  const byRegion = list.find((c) => c && c.unlock && typeof c.unlock === 'object' && c.unlock.region === regionId);
  if (byRegion) return byRegion.id;
  const byId = list.find((c) => c && typeof c.id === 'string' && c.id.startsWith(regionId + '-'));
  return byId ? byId.id : null;
}

/**
 * addPostcard(state, cardId, now, {companion}) — puts a card in the album. Duplicates
 * convert to Seals. Completing a region's set records it, unlocks that place's canvas
 * and emits 'setComplete'. Returns {id, rare, duplicate, seals, setComplete}.
 */
export function addPostcard(state, cardId, now = 0, extra = {}) {
  ensureHunters(state);
  const card = postcardList().find((c) => c.id === cardId);
  if (!card) return null;
  const rare = isRareCard(card);
  const prev = state.album.cards[cardId];
  const res = { id: cardId, rare, duplicate: false, seals: 0, setComplete: null, ...extra };
  if (prev && prev.count > 0) {
    prev.count += 1;
    res.duplicate = true;
    res.seals = DUPLICATE_SEALS;
    state.seals = fin(state.seals) + DUPLICATE_SEALS;
  } else {
    state.album.cards[cardId] = { count: 1, at: now };
    questEvent(state, 'postcardCollected', 1, { region: card.region });
  }
  emit(state, 'postcard', { id: cardId, rare, duplicate: res.duplicate });
  const region = card.region;
  if (!state.album.setsDone.includes(region)) {
    const set = postcardsForRegion(region);
    if (set.length > 0 && set.every((c) => state.album.cards[c.id] && state.album.cards[c.id].count > 0)) {
      state.album.setsDone.push(region);
      res.setComplete = region;
      const canvas = canvasForRegion(region);
      if (canvas && state.gallery) {
        if (!Array.isArray(state.gallery.canvases)) state.gallery.canvases = [];
        if (!state.gallery.canvases.includes(canvas)) state.gallery.canvases.push(canvas);
        res.canvas = canvas;
      }
      questEvent(state, 'postcardSetDone', 1, { region });
      emit(state, 'setComplete', { region });
    }
  }
  return res;
}

function drawCard(state, regionId, allowRare) {
  const set = postcardsForRegion(regionId).filter((c) => allowRare || !isRareCard(c));
  if (set.length === 0) return null;
  const owned = (c) => state.album.cards[c.id] && state.album.cards[c.id].count > 0;
  return weightedPick(stateRng(state), set, (c) => (owned(c) ? 1 : 4)) ?? null;
}

function regionalColors(state, region) {
  const ids = Object.keys((state.catalog && state.catalog.discovered) || {});
  const wild = ids.filter((id) => region.wildHues.includes(id));
  if (wild.length) return wild;
  return ids.filter((id) => region.palette.includes(familyOfColor(id)));
}

function resolveOne(state, hunter, now) {
  const trip = hunter.trip;
  const region = getRegion(trip.region);
  const rng = stateRng(state);
  const d = DURATIONS[trip.duration] ?? DURATIONS.short;
  const duration = d.id;
  const longPlus = duration === 'long' || duration === 'overnight';
  const scout = scoutEffect(state, trip);
  const traits = traitsOf(hunter);
  const summary = {
    hunterId: hunter.id, name: hunter.name, region: trip.region, duration,
    raw: {}, wild: null, postcards: [], seals: 0, vial: null, market: null,
    tints: [], sourceUnlocked: null, levelUp: null, at: now,
  };

  // 1. Raw materials (feed sources directly).
  const hauls = region ? region.hauls : [];
  for (const pid of hauls) {
    const base = haulPerPigment(state, hunter, trip.region, duration, pid) * (1 + (scout.haul || 0));
    const amt = fin(base * (0.85 + 0.3 * rng()));
    if (amt <= 0) continue;
    state.raw[pid] = fin(state.raw[pid]) + amt;
    summary.raw[pid] = amt;
  }

  // 2. A new source station (one per return, Era 1 cap).
  if (region && region.sourcesUnlocked.length) {
    const srcs = state.stations.sources || {};
    const owned = Object.keys(srcs).filter((sid) => !(srcs[sid] && srcs[sid].eventLoan)); // event loans are not hers yet
    const next = region.sourcesUnlocked.find((sid) => !owned.includes(sid) && getSource(sid));
    if (next && owned.length < MAX_SOURCES_ERA1) {
      state.stations.sources[next] = { level: Math.max(1, Number(srcs[next] && srcs[next].level) || 0) };
      if (state.raw[next] === undefined) state.raw[next] = 0;
      if (state.pigment && state.pigment[next] === undefined) state.pigment[next] = 0;
      summary.sourceUnlocked = next;
      emit(state, 'sourceUnlocked', { sourceId: next, region: trip.region });
      const pigmentId = getSource(next).pigment;
      if (colorInfo(pigmentId) && !knowsColor(state, pigmentId)) discover(state, { colorId: pigmentId, method: 'hunt' }, now);
    }
  }

  // 3. Wild hue with pity timer.
  const wilds = region ? region.wildHues.filter((id) => colorInfo(id) && !knowsColor(state, id)) : [];
  if (wilds.length) {
    if (rng() < wildChance(hunter, trip.region, duration, scout)) {
      const colorId = pick(rng, wilds);
      discover(state, { colorId, method: 'hunt' }, now);
      summary.wild = colorId;
      hunter.pityStreak = 0;
    } else {
      hunter.pityStreak = fin(hunter.pityStreak) + 1;
    }
  }

  // 4. Postcards (+1 roll at level 10; rare only on long/overnight; companion card).
  const rolls = 1 + perkValue(hunter, 'extraPostcardRolls', 0);
  const pc = cardChance(hunter, trip.region, duration, scout);
  const takeCard = (extra) => {
    const card = drawCard(state, trip.region, longPlus);
    if (!card) return;
    const r = addPostcard(state, card.id, now, extra);
    if (r) { summary.postcards.push(r); summary.seals += r.seals; }
  };
  for (let i = 0; i < rolls; i++) if (rng() < pc) takeCard({});
  if (longPlus && rng() < COMPANION_CHANCE) {
    const others = state.hunters.roster.filter((x) => x.id !== hunter.id);
    takeCard({ companion: others.length ? pick(rng, others).id : null });
  }

  // 5. Special markets (Trader x2).
  const markets = marketsDiscoverableIn(trip.region)
    .filter((r) => !state.routesDiscovered.includes(r.id) && !(state.discoveredMarkets || []).includes(r.id));
  if (markets.length) {
    let mult = 1;
    for (const t of traits) mult += t.marketBonus || 0;
    if (rng() < MARKET_DISCOVERY_CHANCE * mult) {
      const m = pick(rng, markets);
      state.routesDiscovered.push(m.id);
      discoverMarket(state, { routeId: m.id }); // shipping's list (emits 'market')
      summary.market = m.id;
    }
  }

  // 6. Scholar (and the scouting "tint" effect): reveal tints near the haul pigments.
  let tints = (scout.tint || 0);
  for (const t of traits) tints += t.extraTint || 0;
  for (let i = 0; i < tints; i++) {
    const near = [];
    for (const c of allColors()) {
      if (!c.hex || knowsColor(state, c.id) || c.tier === 'wild' || (c.era ?? 1) !== (state.era ?? 1)) continue;
      if (c.foundBy && !TINT_FOUND_BY.includes(c.foundBy)) continue;
      let best = Infinity;
      for (const pid of hauls) {
        const p = getPigment(pid);
        if (p) best = Math.min(best, deltaEHex(p.hex, c.hex));
      }
      if (best <= SCHOLAR_TINT_DE) near.push(c);
    }
    if (!near.length) break;
    const c = pick(rng, near);
    const r = tryDiscover(state, { hex: c.hex, method: 'grade' }, now);
    if (r) summary.tints.push(r.colorId ?? r.id ?? c.id);
  }

  // 7. Sometimes a vial of a regional color.
  if (region && rng() < HAUL_VIAL_CHANCE) {
    const colors = regionalColors(state, region);
    if (colors.length) {
      const colorId = pick(rng, colors);
      const r = addVial(state, { colorId, tier: 1, golden: false });
      if (r !== false && r !== null && !(r && r.ok === false)) summary.vial = colorId;
    }
  }

  // 8. Experience, levels and perks.
  const before = hunter.level ?? 1;
  hunter.xp = fin(hunter.xp) + 1;
  hunter.level = levelForXp(hunter.xp);
  hunter.perks = perksAtLevel(hunter.level).map((p) => p.id);
  if (perkValue(hunter, 'secondTrait', false) && !hunter.trait2) {
    hunter.trait2 = pick(rng, TRAIT_IDS.filter((t) => t !== hunter.trait)) ?? null;
  }
  if (hunter.level > before) summary.levelUp = hunter.level;

  hunter.state = 'home';
  hunter.trip = null;
  hunter.lastHaul = summary;
  emit(state, 'hunterReturn', {
    hunterId: hunter.id,
    haul: summary.raw,
    wild: summary.wild ?? undefined,
    postcard: summary.postcards.length ? summary.postcards[0].id : undefined,
  });
  return summary;
}

/** resolveReturns(state, now) — every hunter whose returnsAt <= now comes home. */
export function resolveReturns(state, now = 0) {
  const h = ensureHunters(state);
  offerChoice(state, {}, now);
  const due = h.roster
    .filter((x) => x.state === 'out' && x.trip && Number.isFinite(x.trip.returnsAt) && x.trip.returnsAt <= now)
    .sort((a, b) => a.trip.returnsAt - b.trip.returnsAt);
  const out = [];
  for (const hunter of due) out.push(resolveOne(state, hunter, now));
  // A stray 'out' with a broken trip should never get stuck.
  for (const hunter of h.roster) if (hunter.state === 'out' && !hunter.trip) hunter.state = 'home';
  return out;
}

/** recallAll(state, now) — every hunter out comes home right away with their haul. */
export function recallAll(state, now = 0) {
  const h = ensureHunters(state);
  for (const x of h.roster) if (x.state === 'out' && x.trip) x.trip.returnsAt = Math.min(x.trip.returnsAt, now);
  return resolveReturns(state, now);
}

/** tripsSummary(state, now) -> per-hunter status for the map. */
export function tripsSummary(state, now = 0) {
  const h = ensureHunters(state);
  return h.roster.map((x) => {
    if (x.state !== 'out' || !x.trip) {
      return { hunterId: x.id, name: x.name, trait: x.trait, level: x.level, state: 'home', lastHaul: x.lastHaul ?? null };
    }
    const total = Math.max(1, x.trip.returnsAt - x.trip.departedAt);
    const remainingMs = Math.max(0, x.trip.returnsAt - now);
    return {
      hunterId: x.id, name: x.name, trait: x.trait, level: x.level, state: 'out',
      region: x.trip.region, duration: x.trip.duration, returnsAt: x.trip.returnsAt,
      remainingMs, progress: Math.min(1, Math.max(0, 1 - remainingMs / total)),
      choicePending: !!offerChoice(state, { hunterId: x.id }, now),
    };
  });
}

/** Home hunters available to send. */
export function idleHunters(state) {
  return ensureHunters(state).roster.filter((x) => x.state !== 'out');
}

// Aliases matching ARCHITECTURE.md naming.
export { send as sendHunter, hire as hireHunter, choose as chooseScout };
