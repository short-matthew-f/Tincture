// apprentices.js — spec: DESIGN.md "The factory" > "Apprentices"
// "Automation always pays less than doing it by hand."
//
// ids are camelCase to match state.apprentices keys in ARCHITECTURE.md.
// automates: the chore. phase: phase at which she can hire them.
// payoutMult: share of hand-done payout (Order Clerk fills at 70%).
// packBonus: whether the crate packing bonus applies (Packer: no bonus).

const a = (o) => Object.freeze({ payoutMult: 1, packBonus: null, ...o });

export const APPRENTICES = Object.freeze([
  a({ id: 'errandRunner', name: 'Errand Runner', automates: 'collect-shop-income', phase: 1, cost: 0,
    blurb: 'Pops down to the counter and brings the shop income back for you.' }),
  a({ id: 'orderClerk', name: 'Order Clerk', automates: 'fill-simple-orders', phase: 2, cost: 25000, payoutMult: 0.7,
    blurb: 'Fills the simple orders for you, at 70% of what you would earn by hand.' }),
  a({ id: 'dispatcher', name: 'Dispatcher', automates: 'auto-ship', phase: 2, cost: 60000,
    blurb: 'Sends carts out on your chosen routes the moment they are loaded.' }),
  a({ id: 'packer', name: 'Packer', automates: 'auto-pack-crates', phase: 2, cost: 45000, packBonus: 0,
    blurb: 'Packs every crate for you, without the hand-packed bonus.' }),
  a({ id: 'steward', name: 'Steward', automates: 'auto-buy-bottleneck', phase: 3, cost: 150000,
    blurb: 'Buys the cheapest upgrade for your weakest step. Toggle on or off.' }),
]);

export const APPRENTICES_BY_ID = Object.freeze(Object.fromEntries(APPRENTICES.map((x) => [x.id, x])));
export const byId = APPRENTICES_BY_ID;

export function getApprentice(id) {
  return APPRENTICES_BY_ID[id] ?? null;
}
