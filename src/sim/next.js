// sim/next.js — the workshop's single "Next" button (pure read).
// Implements docs/V02-CONTRACTS.md "Single Next button" and docs/PLAN-v0.2.md
// amendments (Theme A "Workshop split"): ONE primary on the home screen. It
// picks one thing, in this order:
//   1. a mixer with no recipe while nothing is being made ("Choose a recipe"),
//      or an idle mixer while a discovered color nobody makes is mixable
//   2. the half-price re-buy after Renovate, when affordable
//   3. an unlock whose colors are met, when affordable ("Open the Merge Shelf for 400")
//   4. a room whose colors are met, or another mixer (factory.buyMixer: 60
//      Coins, ×6 each), when affordable; the cheaper of the two first
//   5. the flow meter's suggestion, when affordable
//   6. the cheapest affordable upgrade, ONLY in Phase 1 and while the flow
//      meter's pick is more than twice her Coins away (see below)
//   7. the Almost-there item nearest completion
//   8. Collect (the shop's till, or simply "Collect" when there is nothing)
// Never mutates state.
//
// The 'cheapest' fallback rule (tools/balance/TUNING.md change 9). Rule 6
// applies only in Phase 1 (her first sessions, and the start of each run after
// Renovate) and only while the flow meter's pick costs more than twice her
// Coins (CHEAPEST_FALLBACK). So early on a tap of Next nearly always buys
// something, but once she is halfway to the bottleneck Next stops spending
// her Coins on cheap Level ups and shows Almost there / Collect until the
// pick (or the 60-Coin mixer, rule 4) is affordable. From
// Phase 2 on, Next always saves for the bottleneck. Without the halfway check
// the 6.9-Coin starter sources ate every Coin and the third mixer was never
// bought in the first session on half the seeds; without the phase limit a
// player who always took the cheapest Level up spread her Coins over stations
// that were not the limit.

import { formatNumber } from '../format.js';
import { ROOMS } from '../content/rooms.js';
import { flowMeter, upgradeOptions, discoveredCount } from './economy.js';
import { statusAll, rebuyQuote, UNLOCKS_BY_ID } from './unlocks.js';
import { almostThere } from './ledger.js';
import { canMix, mixerPurchase } from './factory.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

/**
 * Rule 6 (the cheapest affordable upgrade) applies up to `maxPhase`, and only
 * while the flow meter's pick costs more than `savingRatio` × her Coins.
 */
export const CHEAPEST_FALLBACK = Object.freeze({ maxPhase: 1, savingRatio: 2 });

const ARTICLE = { shelf: 'the ', hunters: 'the ', gallery: 'the ', shipping: 'the ', commissions: '' };

/** "Open the Merge Shelf for 400" style label for an unlock. */
export function unlockLabel(id, cost, notation) {
  const def = UNLOCKS_BY_ID[id];
  if (!def) return '';
  return `Open ${ARTICLE[id] ?? ''}${def.name} for ${formatNumber(cost ?? def.cost, notation)}`;
}

function pick(kind, label, action, cost, affordable, why) {
  const out = { kind, label, action: { kind, ...action }, affordable: !!affordable, why };
  if (Number.isFinite(cost)) out.cost = cost;
  return out;
}

function upgradeAction(o) {
  const a = { upgrade: o.kind };
  if (o.index !== undefined) a.index = o.index;
  if (o.id !== undefined) a.id = o.id;
  return a;
}

/**
 * next(state, now) -> {kind, label, action:{kind, ...}, cost?, affordable, why}.
 * why: 'recipe'|'rebuy'|'unlock'|'room'|'mixer'|'bottleneck' (the flow meter's
 * pick)|'cheapest'|'almost'|'collect' — which rule above chose it.
 * action.kind: 'assign' {mixer} | 'rebuy' {ids} | 'unlock' {id} | 'room' {id}
 * | 'mixer' {} (factory.buyMixer) | 'upgrade' {upgrade, index?, id?}
 * | 'navigate' {screen, params} | 'collect'.
 * (`upgrade` is the buyUpgrade kind: source|grinder|mixer|vat|shop|fleet|cellar.)
 */
export function next(state, now = num(state?.lastTick)) {
  const coins = num(state?.coins);
  const notation = state?.settings?.notation;
  const fm = flowMeter(state, now);

  // 1. Nothing is being made: a recipe first.
  const s = fm.suggestion;
  if (s && s.kind === 'assign') return pick('assign', s.label, { mixer: num(s.index) }, 0, true, 'recipe');
  const mixers = state?.stations?.mixers ?? [];
  const idle = mixers.findIndex((m) => m && !m.recipe);
  if (idle >= 0) {
    const making = new Set(mixers.map((m) => m && m.recipe).filter(Boolean));
    const spare = Object.keys(state?.catalog?.discovered ?? {}).some((id) => !making.has(id) && canMix(state, id));
    if (spare) return pick('assign', `Set Mixer ${idle + 1} to a color`, { mixer: idle }, 0, true, 'recipe');
  }

  // 2. Reopen what Renovate closed, in one purchase.
  const rq = rebuyQuote(state);
  if (rq.ids.length && coins >= rq.cost) {
    const list = rq.ids.map((id) => UNLOCKS_BY_ID[id].name);
    const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    return pick('rebuy', `Reopen the ${names} for ${formatNumber(rq.cost, notation)}`, { ids: rq.ids.slice() }, rq.cost, true, 'rebuy');
  }

  // 3. An unlock she can buy now (cheapest first).
  const ready = statusAll(state).filter((u) => u && u.canBuy).sort((a, b) => a.cost - b.cost);
  if (ready.length) {
    const u = ready[0];
    return pick('unlock', unlockLabel(u.id, u.cost, notation), { id: u.id }, u.cost, true, 'unlock');
  }

  // 4. A room whose colors are met (rooms that ARE unlocks are covered above),
  //    or another mixer: whichever is cheaper.
  const colors = discoveredCount(state);
  const owned = new Set(state?.rooms ?? []);
  const room = ROOMS.find((r) => !owned.has(r.id) && !r.unlock && r.cost > 0
    && colors >= r.colorsRequired && num(state?.phase, 1) >= r.phase && coins >= r.cost);
  const mq = mixerPurchase(state);
  if (mq.affordable && (!room || mq.cost < room.cost)) {
    return pick('mixer', `Buy Mixer ${mq.count + 1} for ${formatNumber(mq.cost, notation)}`, {}, mq.cost, true, 'mixer');
  }
  if (room) return pick('room', `Open the ${room.name} for ${formatNumber(room.cost, notation)}`, { id: room.id }, room.cost, true, 'room');

  // 5. The flow meter's suggestion.
  if (s && Number.isFinite(s.cost) && s.cost > 0 && coins >= s.cost) {
    return pick('upgrade', s.label, upgradeAction(s), s.cost, true, 'bottleneck');
  }

  // 6. The cheapest affordable upgrade: Phase 1 only, and only while she is
  //    less than halfway to the flow meter's pick (see the header).
  const target = s && Number.isFinite(s.cost) ? s.cost : Infinity;
  if (num(state?.phase, 1) <= CHEAPEST_FALLBACK.maxPhase && target > CHEAPEST_FALLBACK.savingRatio * coins) {
    let best = null;
    for (const o of upgradeOptions(state)) if (o.cost <= coins && (!best || o.cost < best.cost)) best = o;
    if (best) return pick('upgrade', best.label, upgradeAction(best), best.cost, true, 'cheapest');
  }

  // 7. The nearest Almost-there item she can act on now (a commission step
  //    with nothing eligible in stock is `blocked` and stays in the ledger only).
  const near = almostThere(state, now).find((i) => i && !i.blocked);
  if (near) return pick('navigate', near.text, { screen: near.screen, params: near.params ?? {} }, undefined, true, 'almost');

  // 8. Collect.
  const till = num(state?.pendingCollect);
  return pick('collect', till > 0 ? `Collect ${formatNumber(till, notation)}` : 'Collect', {}, undefined, true, 'collect');
}
