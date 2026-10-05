// heritage.js — spec: DESIGN.md "Progression, eras and prestige" > "Renovate (soft prestige)"
//
//   Heritage earned = floor(sqrt(E_run / HERITAGE_DIVISOR));  income mult = 1 + HERITAGE_INCOME * H_total
//
// Heritage can also be spent in a small tree so each run starts smoother.
// cost: array indexed by (level - 1): cost[0] is the price of level 1, etc.
//       cost.length === maxLevel.
// effect (per level unless noted):
//   startVats       +n display vats at the start of every run
//   startMixers     +n mixer slots at the start of every run
//   startCoins      +n Coins at the start of every run
//   phaseSpeed      fractional production bonus while in Phases 1-2 (so early phases go faster)
//   autoApprentice  apprentice id that starts every run already hired (maxLevel 1)
//   keepUnlock      unlock id (src/sim/unlocks.js) that Renovate leaves open (maxLevel 1)

export const HERITAGE_DIVISOR = 1e7;
export const HERITAGE_INCOME = 0.05;
/** The game suggests renovating when projected gain exceeds this share of current Heritage. */
export const RENOVATE_SUGGEST_RATIO = 0.5;

const node = (o) => Object.freeze({ ...o, cost: Object.freeze(o.cost), effect: Object.freeze(o.effect) });

export const HERITAGE_TREE = Object.freeze([
  node({ id: 'deep-pockets', name: 'Deep Pockets', maxLevel: 5, cost: [1, 2, 4, 7, 11], effect: { startCoins: 2500 },
    blurb: 'Each run starts with a little more in the till.' }),
  node({ id: 'extra-vats', name: 'Spare Vats', maxLevel: 3, cost: [2, 4, 8], effect: { startVats: 1 },
    blurb: 'Start each run with another tall glass vat on the shelf.' }),
  node({ id: 'second-table', name: 'Second Table', maxLevel: 2, cost: [3, 8], effect: { startMixers: 1 },
    blurb: 'A spare mixer, ready on day one of every run.' }),
  node({ id: 'quick-hands', name: 'Quick Hands', maxLevel: 4, cost: [2, 4, 7, 11], effect: { phaseSpeed: 0.25 },
    blurb: 'Production runs 25% faster per level while you rebuild Phases 1 and 2.' }),
  node({ id: 'trusted-clerk', name: 'Trusted Clerk', maxLevel: 1, cost: [3], effect: { autoApprentice: 'orderClerk' },
    blurb: 'The Order Clerk returns every run, already hired.' }),
  node({ id: 'trusted-dispatcher', name: 'Trusted Dispatcher', maxLevel: 1, cost: [4], effect: { autoApprentice: 'dispatcher' },
    blurb: 'The Dispatcher returns every run, already hired.' }),
  node({ id: 'trusted-packer', name: 'Trusted Packer', maxLevel: 1, cost: [4], effect: { autoApprentice: 'packer' },
    blurb: 'The Packer returns every run, already hired.' }),
  node({ id: 'trusted-steward', name: 'Trusted Steward', maxLevel: 1, cost: [8], effect: { autoApprentice: 'steward' },
    blurb: 'The Steward returns every run, already hired.' }),
  node({ id: 'keep-shelf', name: 'Keep the Shelf', maxLevel: 1, cost: [2], effect: { keepUnlock: 'shelf' },
    blurb: 'The Merge Shelf stays open through every Renovate.' }),
  node({ id: 'keep-map', name: 'Keep the Map', maxLevel: 1, cost: [2], effect: { keepUnlock: 'hunters' },
    blurb: 'The map window stays open: your hunters set out on day one.' }),
  node({ id: 'keep-gallery', name: 'Keep the Gallery', maxLevel: 1, cost: [2], effect: { keepUnlock: 'gallery' },
    blurb: 'The Gallery stays open through every Renovate, visitors and all.' }),
]);

export const HERITAGE_BY_ID = Object.freeze(Object.fromEntries(HERITAGE_TREE.map((n) => [n.id, n])));
export const byId = HERITAGE_BY_ID;

export function getHeritageNode(id) {
  return HERITAGE_BY_ID[id] ?? null;
}

/** Heritage cost to buy the next level, given the current level; null at max. */
export function heritageCost(id, currentLevel) {
  const n = HERITAGE_BY_ID[id];
  if (!n || currentLevel >= n.maxLevel) return null;
  return n.cost[currentLevel];
}

/** floor(sqrt(runEarned / HERITAGE_DIVISOR)); guards bad input. */
export function heritageForRun(runEarned) {
  if (!(runEarned > 0)) return 0;
  return Math.floor(Math.sqrt(runEarned / HERITAGE_DIVISOR));
}

/** Income multiplier from total Heritage earned (spent or not). */
export function heritageIncomeMult(totalHeritage) {
  return 1 + HERITAGE_INCOME * Math.max(0, totalHeritage || 0);
}
