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
