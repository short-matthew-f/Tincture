// sim/offline.js — offline catch-up: on boot and on return (>= 60 s away) the whole
// world advances in one closed-form tick, then the Morning Ledger is built from a
// before/after snapshot. Spec: DESIGN.md "Core loop" > "Check-in surface";
// ARCHITECTURE.md "Game loop". tick() is O(1) in elapsed time, so 3 days is instant.

import { snapshot, buildReturnSummary } from './ledger.js';
import { tick } from './index.js';

export const CATCH_UP_MIN_MS = 60e3;

/**
 * catchUp(state, now) -> LedgerSummary | null. Runs only when she has been away at
 * least a minute; stores the summary in state.ledger.pending and stamps lastSeenAt.
 */
export function catchUp(state, a, b) {
  const now = typeof a === 'number' ? a : b;
  if (!Number.isFinite(now)) return null;
  const last = Number.isFinite(state.lastSeenAt) ? state.lastSeenAt : (Number.isFinite(state.lastTick) ? state.lastTick : now);
  if (now - last < CATCH_UP_MIN_MS) return null;
  const before = snapshot(state);
  before.at = last;
  tick(state, now);
  const summary = buildReturnSummary(state, before, now);
  state.ledger ??= { pending: null, allCaughtUpAt: 0 };
  state.ledger.pending = summary;
  state.lastSeenAt = now;
  return summary;
}

/**
 * shiftClock(state, ms) -> state. Moves every saved moment and schedule `ms`
 * into the past: the loop clocks (lastTick, lastSeenAt) and everything that
 * waits on an absolute time (order refresh and Order Clerk, shelf spillover,
 * collector visit and offer, gallery admission, hunter trips and scouting
 * calls, fleet trips, Rush cooldowns, boosts, the coach-mark gap).
 *
 * Two callers: Game._fixClock when the device clock went backwards (shift by
 * how far the saved clocks are ahead, so trips and cooldowns keep the time
 * they had left: nothing granted, nothing lost), and the debug `advance(ms)`
 * (shift, then the catch-up runs as if `ms` had passed).
 */
export function shiftClock(state, ms) {
  const d = Number(ms);
  if (!state || !Number.isFinite(d) || d <= 0) return state;
  const back = (o, k) => { if (o && Number.isFinite(o[k]) && o[k] > 0) o[k] -= d; };
  back(state, 'lastTick');
  back(state, 'lastSeenAt');
  back(state.orders, 'nextRefreshAt');
  back(state.orders, 'nextClerkAt');
  back(state.shelf, 'nextSpilloverAt');
  back(state.gallery, 'nextCollectorAt');
  back(state.gallery, 'lastAdmissionAt');
  back(state.gallery && state.gallery.collectorOffer, 'until');
  back(state.onboarding && state.onboarding.flags, 'stepAt');
  for (const h of (state.hunters && state.hunters.roster) || []) {
    if (h && h.trip) { back(h.trip, 'departedAt'); back(h.trip, 'returnsAt'); back(h.trip, 'choiceOfferedAt'); }
  }
  for (const v of (state.stations && state.stations.fleet) || []) { back(v, 'departedAt'); back(v, 'arrivesAt'); }
  for (const m of (state.stations && state.stations.mixers) || []) back(m, 'rushedAt');
  for (const b of state.boosts || []) back(b, 'until');
  return state;
}
