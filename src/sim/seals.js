// seals.js — what Seals buy (pure). docs/DESIGN.md "Economy": Seals reward
// engagement and buy boosts and small conveniences, never power that Coins
// cannot. Playtest 3: "she has 900 and it isn't clear where they're used",
// because nothing spent them. Prices follow the spec's "a typical boost costs 40".

import { emit } from './bus.js';
import { addBoost } from './factory.js';
import { recallAll } from './hunters.js';
import { addVial, unlocked as shelfUnlocked, shelfColors } from './shelf.js';
import { stateRng, pick } from '../rng.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

export const SEAL_SHOP = Object.freeze([
  Object.freeze({ id: 'quick-hands', name: 'Quick hands', cost: 40, blurb: 'Every mixer runs 50% faster for 30 minutes.', boost: { kind: 'production', mult: 0.5, minutes: 30 } }),
  Object.freeze({ id: 'market-day', name: 'Market day', cost: 60, blurb: 'Everything sells for 50% more for an hour.', boost: { kind: 'income', mult: 0.5, minutes: 60 } }),
  Object.freeze({ id: 'vial-crate', name: 'A crate of vials', cost: 30, blurb: 'Six vials in your shelf colors, right now.', vials: 6 }),
  Object.freeze({ id: 'call-home', name: 'Call the hunters home', cost: 50, blurb: 'Everyone out exploring comes home now with what they found.', recall: true }),
]);

export const SEAL_SHOP_BY_ID = Object.freeze(Object.fromEntries(SEAL_SHOP.map((x) => [x.id, x])));

/** Why an item cannot be bought right now (null when it can). */
function blocker(state, item) {
  if (num(state?.seals) < item.cost) return 'seals';
  if (item.vials) {
    if (!shelfUnlocked(state)) return 'shelf';
    if (!shelfColors(state).length) return 'shelf';
    if (!(state.shelf?.cells ?? []).some((c) => !c)) return 'full';
  }
  if (item.recall && !(state?.hunters?.roster ?? []).some((x) => x && x.state === 'out')) return 'home';
  return null;
}

/** sealOffers(state) -> [{...item, ok, reason}] for the shop list. */
export function sealOffers(state) {
  return SEAL_SHOP.map((item) => {
    const reason = blocker(state, item);
    return { ...item, ok: !reason, reason };
  });
}

/** buySealItem(state, {id}, now) -> {ok, reason?, cost, vials?, recalled?} */
export function buySealItem(state, args = {}, now = 0) {
  const item = SEAL_SHOP_BY_ID[args.id];
  if (!item) return { ok: false, reason: 'item' };
  const reason = blocker(state, item);
  if (reason) return { ok: false, reason, cost: item.cost };
  state.seals = num(state.seals) - item.cost;
  const res = { ok: true, cost: item.cost };
  if (item.boost) addBoost(state, item.boost, now);
  if (item.vials) {
    const rng = stateRng(state);
    const colors = shelfColors(state);
    let n = 0;
    for (let i = 0; i < item.vials; i++) {
      const cell = addVial(state, { colorId: pick(rng, colors) });
      if (cell === null || cell === undefined || cell === false) break;
      n++;
    }
    res.vials = n;
  }
  if (item.recall) res.recalled = recallAll(state, now);
  emit(state, 'sealsSpent', { id: item.id, cost: item.cost });
  return res;
}
