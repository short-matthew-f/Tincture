// sim/closeUp.js — "Close up shop": the ritual session ending. Sends every home
// hunter on an overnight trip to their best region, queues every idle mixer with
// the most valuable color she can make, and reports how long until the vats fill.
// Spec: DESIGN.md "Fun and engagement" > "Stopping points" (Close up shop).

import { REGIONS, getRegion } from '../content/regions.js';
import { TRAITS } from '../content/hunters.js';
import { fillTimeMs } from './storage.js';
import { colorPrice } from './economy.js';
import { assignRecipe, canMix } from './factory.js';
import { send, unlocked, postcardsForRegion, colorInfo, knowsColor, idleHunters } from './hunters.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

/** Region score for a hunter: unowned postcards + 2 per undiscovered wild hue (+ trait bonus). */
export function regionScore(state, hunter, regionId) {
  const r = getRegion(regionId);
  if (!r) return -Infinity;
  const cards = postcardsForRegion(regionId).filter((c) => !(state.album && state.album.cards[c.id])).length;
  const wilds = r.wildHues.filter((id) => colorInfo(id) && !knowsColor(state, id)).length;
  const t = TRAITS[hunter.trait];
  const traitBonus = t && t.regions && t.regions.includes(regionId) ? 2 : 0;
  const sources = r.sourcesUnlocked.filter((id) => !(state.stations.sources || {})[id]).length;
  return cards + 2 * wilds + traitBonus + sources;
}

/** bestRegion(state, hunter) -> region id she should send this hunter to tonight. */
export function bestRegion(state, hunter) {
  const open = ((state.hunters && state.hunters.regionsUnlocked) || [])
    .filter((id) => getRegion(id) && (getRegion(id).era ?? 1) <= (state.era ?? 1));
  let best = null;
  let bestScore = -Infinity;
  for (const id of open) {
    const s = regionScore(state, hunter, id);
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

function setRecipe(state, index, colorId) {
  const r = assignRecipe(state, { mixer: index, colorId });
  return !!(r && r.ok);
}

/**
 * closeUpShop(state, now) (or (state, args, now)) -> {fillMs, huntersSent:[{hunterId, regionId}], mixersQueued:[{index, colorId}]}
 */
export function closeUpShop(state, a, b) {
  const now = typeof a === 'number' ? a : fin(b, state.lastTick ?? 0);
  const huntersSent = [];
  if (unlocked(state)) {
    for (const h of idleHunters(state)) {
      const regionId = bestRegion(state, h);
      if (!regionId) continue;
      const r = send(state, { hunterId: h.id, regionId, duration: 'overnight' }, now);
      if (r.ok) huntersSent.push({ hunterId: h.id, regionId });
    }
  }
  const mixersQueued = [];
  const mixers = (state.stations && state.stations.mixers) || [];
  const known = Object.keys((state.catalog && state.catalog.discovered) || {});
  const makeable = known.filter((id) => canMix(state, id))
    .sort((x, y) => fin(colorPrice(state, y)) - fin(colorPrice(state, x)));
  mixers.forEach((m, index) => {
    if (!m || m.recipe) return;
    const busy = new Set(mixers.map((x) => x && x.recipe).filter(Boolean));
    const colorId = makeable.find((id) => !busy.has(id)) ?? makeable[0];
    if (colorId && setRecipe(state, index, colorId)) mixersQueued.push({ index, colorId });
  });
  state.stats ??= { sessionStartedAt: now, lastCloseUpAt: 0 };
  state.stats.lastCloseUpAt = now;
  const fillMs = fillTimeMs(state);
  return { fillMs, huntersSent, mixersQueued };
}
