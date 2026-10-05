// sim/index.js — one import for every game rule, plus the world tick.
// ARCHITECTURE.md "Sim" / "Game loop": tick(state, now) advances everything in one
// closed-form step (O(1) in elapsed time), so it is safe at dt = 0 and at dt = 3 days.
//
// Every module is re-exported with `export *`. Names defined in more than one module
// are resolved explicitly below: `discoveredCount` (discovery), `ESSENCE_MAX` (economy).
// `unlocked` exists in hunters and shelf, so it is NOT exported bare: use
// `huntersUnlocked` / `shelfUnlocked`. Each module is also available as a namespace
// (e.g. `hunters.send`, `shelf.unlocked`, `unlocks.buy`). The coin-bought unlocks
// (unlocks.js: UNLOCKS, status, canBuy, buy, batchRebuy, tierRevealed, ...) and
// the workshop's single Next button (`next`, next.js) are exported bare too.

import { currentEvent } from './events.js';
import { rollDaily, rollWeekly } from './quests.js';
import { tickFactory, checkPhase } from './factory.js';
import { resolveReturns, unlockRegions } from './hunters.js';
import { refreshOrders, autoFillOrders } from './orders.js';
import { refresh as refreshCommissions } from './commissions.js';
import { grantHeritageCanvases } from './prestige.js';

export * from './economy.js';
export * from './factory.js';
export * from './storage.js';
export * from './shipping.js';
export * from './orders.js';
export * from './discovery.js';
export * from './shelf.js';
export * from './gallery.js';
export * from './hunters.js';
export * from './quests.js';
export * from './events.js';
export * from './commissions.js';
export * from './prestige.js';
export * from './ledger.js';
export * from './offline.js';
export * from './closeUp.js';
export * from './settings.js';
export * from './unlocks.js';
export { next, unlockLabel } from './next.js';
export { emit } from './bus.js';

export * as economy from './economy.js';
export * as factory from './factory.js';
export * as storage from './storage.js';
export * as shipping from './shipping.js';
export * as orders from './orders.js';
export * as discovery from './discovery.js';
export * as shelf from './shelf.js';
export * as gallery from './gallery.js';
export * as hunters from './hunters.js';
export * as quests from './quests.js';
export * as events from './events.js';
export * as commissions from './commissions.js';
export * as prestige from './prestige.js';
export * as ledger from './ledger.js';
export * as offline from './offline.js';
export * as closeUp from './closeUp.js';
export * as settings from './settings.js';
export * as unlocks from './unlocks.js';

// Explicit resolutions of names exported by more than one module.
export { unlocked as huntersUnlocked } from './hunters.js';
export { unlocked as shelfUnlocked } from './shelf.js';
export { discoveredCount } from './discovery.js';
export { ESSENCE_MAX } from './economy.js';

/**
 * tick(state, now) — the world step: event week, quest rolls, factory (production,
 * trips, spillover, admission, accidents), hunter returns, orders, commissions,
 * region unlocks, phase gates, Heritage canvases. Returns {hunters: returnSummaries}.
 */
export function tick(state, now) {
  if (!state || !Number.isFinite(now)) return { hunters: [] };
  currentEvent(state, now);
  rollDaily(state, now);
  rollWeekly(state, now);
  tickFactory(state, now);
  const returns = resolveReturns(state, now);
  refreshOrders(state, now);
  autoFillOrders(state, now); // Order Clerk (autoDispatch already runs inside tickFactory)
  refreshCommissions(state, now);
  unlockRegions(state, {}, now);
  checkPhase(state, {}, now);
  grantHeritageCanvases(state);
  // Visiting collectors are scheduled by gallery.tickAdmission (inside tickFactory).
  state.lastTick = Math.max(Number.isFinite(state.lastTick) ? state.lastTick : now, now);
  return { hunters: returns };
}
