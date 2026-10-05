// sim/prestige.js — Renovate (soft prestige) and the Heritage tree.
// Spec: DESIGN.md "Progression, eras and prestige" > "Renovate (soft prestige)":
//   Heritage earned = floor(sqrt(E_run / 1e7)); income multiplier = 1 + 0.05 · H_total.
// Renovate resets stations, Coins, rooms, raw/pigment/stock, shelf contents, orders,
// boosts, the phase and the coin-bought unlocks (src/sim/unlocks.js; those open
// before are listed in state.renovateReopen for one half-price batch re-buy, and
// Heritage keep-* nodes hold theirs open); it keeps the catalog (with Essence), hunters (recalled home
// with their hauls), album, apprentices, Heritage, Seals, quests, the event, finished
// commissions, trophies, cosmetics and the whole Gallery (paintings never reset).
//
// state.heritage is Heritage earned in total (it drives the income multiplier);
// state.heritageSpent maps tree node id -> level; available = earned - spent cost.

import {
  HERITAGE_TREE, getHeritageNode, heritageCost, heritageForRun, RENOVATE_SUGGEST_RATIO,
} from '../content/heritage.js';
import { createInitialState } from '../state.js';
import { emit } from './bus.js';
import { recallAll } from './hunters.js';
import { addCanvas } from './gallery.js';
import { UNLOCK_IDS } from './unlocks.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
export const RENOVATE_PHASE = 3;
const BASE_WALLS = 4;
/** Heritage canvases (content unlock {type:'heritage'}): granted on the Nth Renovate. */
export const HERITAGE_CANVASES = Object.freeze([
  { renovations: 1, canvasId: 'grand-rotunda-window' },
  { renovations: 3, canvasId: 'heritage-tapestry' },
]);

/** heritagePreview(state) -> Heritage a Renovate would grant now. */
export function heritagePreview(state) {
  return heritageForRun(fin(state.runEarned));
}

/** canRenovate(state) -> {ok, reason?, gain} (available from Phase 3). */
export function canRenovate(state) {
  const gain = heritagePreview(state);
  if ((state.phase ?? 1) < RENOVATE_PHASE) return { ok: false, reason: 'phase', gain };
  return { ok: true, gain };
}

/** shouldSuggest(state) — projected gain exceeds 50% of current Heritage. */
export function shouldSuggest(state) {
  if ((state.phase ?? 1) < RENOVATE_PHASE) return false;
  const gain = heritagePreview(state);
  return gain > 0 && gain > RENOVATE_SUGGEST_RATIO * fin(state.heritage);
}

/** Heritage spent on tree nodes so far. */
export function heritageSpentTotal(state) {
  let total = 0;
  for (const [id, lvl] of Object.entries(state.heritageSpent || {})) {
    const n = getHeritageNode(id);
    if (!n) continue;
    for (let i = 0; i < Math.min(fin(lvl), n.maxLevel); i++) total += n.cost[i];
  }
  return total;
}

/** Heritage available to spend in the tree. */
export function heritageAvailable(state) {
  return Math.max(0, fin(state.heritage) - heritageSpentTotal(state));
}

/** heritageEffects(state) -> {startVats, startCoins, startMixers, phaseSpeed, autoApprentices:[id], keepUnlocks:[id]}. */
export function heritageEffects(state) {
  const out = { startVats: 0, startCoins: 0, startMixers: 0, phaseSpeed: 0, autoApprentices: [], keepUnlocks: [] };
  for (const n of HERITAGE_TREE) {
    const lvl = Math.min(n.maxLevel, fin(state.heritageSpent && state.heritageSpent[n.id]));
    if (lvl <= 0) continue;
    const e = n.effect;
    if (e.startVats) out.startVats += e.startVats * lvl;
    if (e.startCoins) out.startCoins += e.startCoins * lvl;
    if (e.startMixers) out.startMixers += e.startMixers * lvl;
    if (e.phaseSpeed) out.phaseSpeed += e.phaseSpeed * lvl;
    if (e.autoApprentice && !out.autoApprentices.includes(e.autoApprentice)) out.autoApprentices.push(e.autoApprentice);
    if (e.keepUnlock && !out.keepUnlocks.includes(e.keepUnlock)) out.keepUnlocks.push(e.keepUnlock);
  }
  return out;
}

/** buyHeritageNode(state, {id}) — spends Heritage on the next level of a tree node. */
export function buyHeritageNode(state, { id } = {}) {
  const n = getHeritageNode(id);
  if (!n) return { ok: false, reason: 'unknown' };
  state.heritageSpent ??= {};
  const lvl = fin(state.heritageSpent[id]);
  const cost = heritageCost(id, lvl);
  if (cost === null) return { ok: false, reason: 'max' };
  if (heritageAvailable(state) < cost) return { ok: false, reason: 'heritage', cost };
  state.heritageSpent[id] = lvl + 1;
  // Trusted apprentices join right away, not just next run.
  if (n.effect.autoApprentice && state.apprentices) state.apprentices[n.effect.autoApprentice] = true;
  emit(state, 'heritageBought', { id, level: lvl + 1 });
  return { ok: true, id, level: lvl + 1, cost };
}

/**
 * grantHeritageCanvases(state) -> [canvasId] newly granted. The first Renovate
 * earns the Grand Rotunda Window, the third the Heritage Tapestry (content
 * unlock {type:'heritage'}). Runs from the world tick right after a Renovate
 * (and fixes up saves that renovated before this existed); idempotent.
 */
export function grantHeritageCanvases(state) {
  const n = fin(state && state.lifetime && state.lifetime.renovations);
  const out = [];
  if (!(n > 0) || !state.gallery) return out;
  const have = Array.isArray(state.gallery.canvases) ? state.gallery.canvases : [];
  for (const hc of HERITAGE_CANVASES) {
    if (n >= hc.renovations && !have.includes(hc.canvasId) && addCanvas(state, { canvasId: hc.canvasId }).ok) out.push(hc.canvasId);
  }
  return out;
}

/**
 * renovateCloses(state) -> [unlock id] that a Renovate now would close (open
 * now, not held by a Heritage keep-* node). The Renovate sheet lists them.
 */
export function renovateCloses(state) {
  const keep = heritageEffects(state).keepUnlocks;
  return UNLOCK_IDS.filter((id) => state?.unlocks?.[id] && !keep.includes(id));
}

/** Fresh starting stations for a new run, with Heritage tree bonuses applied. */
export function startingStations(state, now) {
  const fresh = createInitialState(now, 1).stations;
  const fx = heritageEffects(state);
  for (let i = 0; i < fx.startVats; i++) fresh.vats.push({ level: 1, color: null });
  for (let i = 0; i < fx.startMixers; i++) fresh.mixers.push({ recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null });
  // Sources her hunters opened stay open (back to level 1); only levels reset.
  for (const [id, v] of Object.entries((state.stations && state.stations.sources) || {})) {
    if (!fresh.sources[id]) fresh.sources[id] = v && v.eventLoan ? { level: 1, eventLoan: v.eventLoan } : { level: 1 };
  }
  return fresh;
}

/**
 * renovate(state, now) — soft prestige. Returns {ok, gained, heritage, returns}.
 * Accepts renovate(state, now) or renovate(state, args, now).
 */
export function renovate(state, a, b) {
  const now = typeof a === 'number' ? a : fin(b, state.lastTick ?? 0);
  const chk = canRenovate(state);
  if (!chk.ok) return chk;
  const gained = chk.gain;
  state.heritage = fin(state.heritage) + gained;
  state.lifetime ??= { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 };
  state.lifetime.renovations = fin(state.lifetime.renovations) + 1;
  const fx = heritageEffects(state);

  // Coin-bought unlocks close (Heritage keep-* nodes hold theirs open); what was
  // open is listed for the one-purchase re-buy (unlocks.batchRebuy).
  const before = state.unlocks && typeof state.unlocks === 'object' ? state.unlocks : {};
  const unlocks = {};
  const reopen = [];
  for (const id of UNLOCK_IDS) {
    const kept = !!before[id] && fx.keepUnlocks.includes(id);
    unlocks[id] = kept;
    if (before[id] && !kept) reopen.push(id);
  }
  state.unlocks = unlocks;
  state.renovateReopen = reopen;

  // Factory: back to the bench.
  state.stations = startingStations(state, now);
  state.cellarLevel = 1;
  state.rooms = ['bench'];
  state.coins = fx.startCoins;
  state.runEarned = 0;
  state.phase = 1;
  for (const k of Object.keys(state.raw || {})) state.raw[k] = 0;
  for (const k of Object.keys(state.pigment || {})) state.pigment[k] = 0;
  for (const id of Object.keys(state.stations.sources)) {
    state.raw[id] ??= 0;
    state.pigment[id] ??= 0;
  }
  state.stock = {};
  state.muddyBatches = [];
  state.boosts = [];
  if (state.orders) {
    state.orders.open = [];
    state.orders.nextRefreshAt = 0;
  }
  if (state.shelf && Array.isArray(state.shelf.cells)) {
    state.shelf.cells = state.shelf.cells.map(() => null); // Essence lives in the catalog and stays
    state.shelf.nextSpilloverAt = 0;
    state.shelf.waiting = 0;
  }
  for (const ap of fx.autoApprentices) if (state.apprentices) state.apprentices[ap] = true;

  // Gallery persists whole: paintings, wall slots and canvases survive Renovate
  // (DESIGN.md). Rebuying a room never adds walls twice: factory.syncSlots sets
  // walls = max(current, rooms-derived).
  // The Gallery closes with its unlock (pieces stay); `unlocked` mirrors it.
  if (state.gallery) {
    state.gallery.walls = Math.max(BASE_WALLS, fin(state.gallery.walls, BASE_WALLS));
    state.gallery.unlocked = !!state.unlocks.gallery;
  }

  state.lastTick = now;
  // Hunters come home now, and their hauls start the new run.
  const returns = recallAll(state, now);
  emit(state, 'renovate', { heritage: gained, closed: reopen.slice() });
  return { ok: true, gained, heritage: state.heritage, returns };
}
