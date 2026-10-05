// sim/unlocks.js — coin-bought systems (pure).
// Implements docs/V02-CONTRACTS.md "Unlocks" and docs/PLAN-v0.2.md Theme A.4:
// every system is bought with coins; colors only REVEAL the price ("Shelf: 8
// colors · 400 coins"). Nothing opens by itself. Gallery Wing and Loading Yard
// are rooms: buying the unlock buys the room (the room's price IS the unlock's).
// Unlocks reset on Renovate (prestige.js records state.renovateReopen) unless a
// Heritage keep-* node holds them; batchRebuy then reopens the lot at half price.
// Grading tiers stay free and are revealed by colors (tierRevealed).

import { emit } from './bus.js';
import { discoveredCount } from './economy.js';
import { grantRoom } from './factory.js';
import { openWaiting } from './shelf.js';
import { unlockRegions } from './hunters.js';
import { unlock as unlockGallery } from './gallery.js';
import { refresh as refreshCommissions } from './commissions.js';
import { ROOMS_BY_ID } from '../content/rooms.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

export const UNLOCKS = Object.freeze([
  { id: 'shelf', name: 'Merge Shelf', revealColors: 8, cost: 400, object: 'shelf' },
  { id: 'hunters', name: 'Hue Hunters', revealColors: 15, cost: 2500, object: 'map-window' },
  { id: 'gallery', name: 'Gallery Wing', revealColors: 25, cost: 8000, room: 'gallery-wing' }, // the room IS the purchase
  { id: 'shipping', name: 'Loading Yard', revealColors: 35, cost: 40000, room: 'loading-yard' }, // the room IS the purchase
  { id: 'commissions', name: 'Commissions', revealColors: 30, cost: 20000, requiresPhase: 3 },
].map((u) => Object.freeze(u)));

export const UNLOCKS_BY_ID = Object.freeze(Object.fromEntries(UNLOCKS.map((u) => [u.id, u])));
export const UNLOCK_IDS = Object.freeze(UNLOCKS.map((u) => u.id));

/** After Renovate, one batch purchase reopens everything for this share of the sum of prices. */
export const REBUY_SHARE = 0.5;

/** Grading tiers: always free, each revealed at this many colors (docs/PLAN-v0.2.md amendments). */
export const TIER_REVEAL = Object.freeze({ relaxed: 0, steady: 10, tricky: 25, master: 45 });

function unlocksOf(state) {
  if (!state.unlocks || typeof state.unlocks !== 'object' || Array.isArray(state.unlocks)) state.unlocks = {};
  return state.unlocks;
}

/** isUnlocked(state, id) -> has she bought (or kept) this system? */
export function isUnlocked(state, id) {
  return !!state?.unlocks?.[id];
}

/** Phase the purchase needs: its own requiresPhase, or its room's phase. */
function phaseNeeded(def) {
  const room = def.room ? ROOMS_BY_ID[def.room] : null;
  return Math.max(num(def.requiresPhase, 1), num(room?.phase, 1));
}

/**
 * status(state, id) -> {id, name, cost, revealColors, colorsLeft, revealed,
 * affordable, open, canBuy, phase, phaseOk, room, object} or null for an
 * unknown id. `revealed` = colors met AND phase met (the price shows from the
 * start; `revealed` says whether it can be bought yet).
 */
export function status(state, id) {
  const def = UNLOCKS_BY_ID[id];
  if (!def) return null;
  const colors = discoveredCount(state);
  const colorsLeft = Math.max(0, def.revealColors - colors);
  const phase = phaseNeeded(def);
  const phaseOk = num(state?.phase, 1) >= phase;
  const revealed = colorsLeft === 0 && phaseOk;
  const affordable = num(state?.coins) >= def.cost;
  const open = isUnlocked(state, id);
  return {
    id: def.id, name: def.name, cost: def.cost, revealColors: def.revealColors, colorsLeft, revealed,
    affordable, open, canBuy: !open && revealed && affordable, phase, phaseOk,
    room: def.room ?? null, object: def.object ?? null,
  };
}

/** statusAll(state) -> status for every unlock, in UNLOCKS order. */
export function statusAll(state) {
  return UNLOCKS.map((u) => status(state, u.id));
}

/** canBuy(state, id) -> boolean (revealed, affordable, not yet open). */
export function canBuy(state, id) {
  const st = status(state, typeof id === 'object' && id ? id.id : id);
  return !!st && st.canBuy;
}

/**
 * Opens one unlock (no charge): its room for gallery / shipping, the waiting
 * vials for the shelf, Wren for the hunters, the first commissions. Emits
 * 'unlock' {id} once.
 */
function openUnlock(state, id, now, extra = {}) {
  const def = UNLOCKS_BY_ID[id];
  const u = unlocksOf(state);
  const was = !!u[id];
  if (def.room && !(state.rooms ?? []).includes(def.room)) {
    // grantRoom sets unlocks[id] (content rooms `unlock`) and emits 'unlock'.
    grantRoom(state, { id: def.room }, now);
    u[id] = true;
  } else {
    u[id] = true;
    if (id === 'gallery') unlockGallery(state, {}, now);
    if (!was) emit(state, 'unlock', { id, ...extra });
  }
  if (id === 'shelf') openWaiting(state);
  if (id === 'hunters') unlockRegions(state, {}, now);
  if (id === 'commissions') refreshCommissions(state, now);
  if (Array.isArray(state.renovateReopen)) state.renovateReopen = state.renovateReopen.filter((x) => x !== id);
}

/**
 * buy(state, {id}, now) -> {ok, id, cost} | {ok:false, reason:'unknown'|'open'|'colors'|'phase'|'coins', ...}.
 * Deducts coins, sets unlocks[id] (and buys the room for gallery / shipping,
 * charged once: the room's cost IS the unlock's), emits 'unlock' {id}.
 */
export function buy(state, args = {}, now = 0) {
  const id = typeof args === 'string' ? args : args?.id;
  const st = status(state, id);
  if (!st) return { ok: false, reason: 'unknown' };
  if (st.open) return { ok: false, reason: 'open' };
  if (st.colorsLeft > 0) return { ok: false, reason: 'colors', need: st.colorsLeft };
  if (!st.phaseOk) return { ok: false, reason: 'phase', phase: st.phase };
  if (!st.affordable) return { ok: false, reason: 'coins', cost: st.cost };
  state.coins = num(state.coins) - st.cost;
  openUnlock(state, id, now);
  return { ok: true, id, cost: st.cost };
}

/**
 * rebuyQuote(state) -> {ids, cost}: what one batch purchase would reopen after
 * Renovate (state.renovateReopen minus anything already open) and its price
 * (sum of prices × REBUY_SHARE, rounded).
 */
export function rebuyQuote(state) {
  const ids = (Array.isArray(state?.renovateReopen) ? state.renovateReopen : [])
    .filter((id, i, a) => UNLOCKS_BY_ID[id] && a.indexOf(id) === i && !isUnlocked(state, id));
  const sum = ids.reduce((s, id) => s + UNLOCKS_BY_ID[id].cost, 0);
  return { ids, cost: Math.round(sum * REBUY_SHARE) };
}

/**
 * batchRebuy(state, now) / batchRebuy(state, args, now) -> {ok, cost, ids}:
 * after Renovate, one purchase reopens everything that was open before (rooms
 * included, no colour or phase re-check: she earned them last run).
 */
export function batchRebuy(state, a, b) {
  const now = typeof a === 'number' ? a : num(b, num(state?.lastTick));
  const { ids, cost } = rebuyQuote(state);
  if (!ids.length) return { ok: false, reason: 'none', cost: 0, ids: [] };
  if (num(state.coins) < cost) return { ok: false, reason: 'coins', cost, ids };
  state.coins = num(state.coins) - cost;
  for (const id of ids) openUnlock(state, id, now, { batch: true });
  state.renovateReopen = [];
  return { ok: true, cost, ids };
}

/** tierRevealed(state, tier) -> boolean: Relaxed always; Steady 10, Tricky 25, Master 45 colors. Always free. */
export function tierRevealed(state, tier) {
  const need = TIER_REVEAL[tier];
  if (need === undefined) return false;
  return discoveredCount(state) >= need;
}
