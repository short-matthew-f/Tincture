// stations.js — spec: DESIGN.md "The factory" > "Stations" and "Upgrade curves";
// "Storage and shipping" > "Shipping: fleet and routes"; "Light active hooks"
// (Rush); "Economy" (Color value, scale x1,000 / x1,000,000 for Eras 2 and 3).
//
//   cost(L)   = baseCost * costGrowth^L          (1.15; vats 1.10)
//   output(L) = baseOutput * L * 2^milestonesPassed(L)
//
// Pure constants + helpers. sim/economy.js owns the actual cost/output math.

export const MILESTONES = Object.freeze([10, 25, 50, 100, 150, 200]);

/** How many milestone doublings a station at `level` has earned. */
export function milestonesPassed(level) {
  let n = 0;
  for (const m of MILESTONES) if (level >= m) n++;
  return n;
}

/**
 * Per-kind upgrade curve. baseOutput units differ per kind:
 *  source  raw/s per level (each source overrides via sources.js baseRate)
 *  grinder pigment/s per level (see GRINDER_KINDS for the kind multiplier)
 *  mixer   jars/s per level (= MIXER.batchJars / MIXER.batchSeconds)
 *  vat     jar capacity per level
 *  shop    jars/s sold per level
 *  vehicle capacity multiplier per level (vehicles carry VEHICLES[x].capacity at level 1)
 */
export const STATION_KINDS = Object.freeze({
  source:  Object.freeze({ id: 'source',  name: 'Source',  baseCost: 6,    costGrowth: 1.15, baseOutput: 0.08,  milestones: MILESTONES }),
  grinder: Object.freeze({ id: 'grinder', name: 'Grinder', baseCost: 100,  costGrowth: 1.15, baseOutput: 0.16,  milestones: MILESTONES }),
  mixer:   Object.freeze({ id: 'mixer',   name: 'Mixer',   baseCost: 250,  costGrowth: 1.15, baseOutput: 0.04,  milestones: MILESTONES }),
  vat:     Object.freeze({ id: 'vat',     name: 'Display vat', baseCost: 60, costGrowth: 1.10, baseOutput: 400, milestones: MILESTONES }),
  shop:    Object.freeze({ id: 'shop',    name: 'Shop counter', baseCost: 40, costGrowth: 1.15, baseOutput: 0.04, milestones: MILESTONES }),
  vehicle: Object.freeze({ id: 'vehicle', name: 'Fleet vehicle', baseCost: 2000, costGrowth: 1.15, baseOutput: 1.0, milestones: MILESTONES }),
});

export const STATION_KIND_IDS = Object.freeze(Object.keys(STATION_KINDS));

export function getStationKind(kind) {
  return STATION_KINDS[kind] ?? null;
}

// Mixer batch: one batch yields `batchJars` jars and takes `batchSeconds` at level 1
// (output rate above = batchJars / batchSeconds per level before milestones).
export const MIXER = Object.freeze({ batchJars: 5, batchSeconds: 125, pigmentPerJar: 1 });

// Buying another mixer outright (factory.buyMixer, docs/PLAN-v0.2.md Theme A.1):
// a cheap station purchase that adds a mixer slot without a room, the first
// session's "new possibility". The n-th bought mixer costs baseCost · costGrowth^n
// (60, 360, 2,160, ...), until the mixers reach rooms.js MAX_SLOTS.mixers.
export const MIXER_PURCHASE = Object.freeze({ baseCost: 60, costGrowth: 6, maxBought: 2 }); // rooms add the rest

// Display vat / cellar capacity (jars). Cellar capacity is a single shared number
// that the Cellar room multiplies (rooms.js adds.cellarMult).
export const VAT = Object.freeze({ baseCapacity: 400 });
export const CELLAR = Object.freeze({ baseCapacity: 1600, baseCost: 150, costGrowth: 1.10, capacityPerLevel: 800 });

// Grinders: Mortar, then Millstone, then Roller Mill. throughput = pigment/s at level 1.
// purityBonus is added to the pure/flawless chance of a batch; upgradeCost is the Coin
// price to swap this slot to the next kind (null on the last).
export const GRINDER_KINDS = Object.freeze([
  { id: 'mortar', name: 'Mortar', throughput: 0.16, purityBonus: 0, upgradeCost: 1500, next: 'millstone' },
  { id: 'millstone', name: 'Millstone', throughput: 0.96, purityBonus: 0.05, upgradeCost: 25000, next: 'roller-mill' },
  { id: 'roller-mill', name: 'Roller Mill', throughput: 4.8, purityBonus: 0.12, upgradeCost: null, next: null },
].map((g) => Object.freeze(g)));

export const GRINDER_KINDS_BY_ID = Object.freeze(Object.fromEntries(GRINDER_KINDS.map((g) => [g.id, g])));

export function getGrinderKind(id) {
  return GRINDER_KINDS_BY_ID[id] ?? null;
}

const MIN = 60e3;
const v = (o) => Object.freeze(o);

// Vehicles by era. capacity in jars at level 1; tripMs one-way-and-back trip time at
// level 1; cost in Coins. Era 2 numbers are the Era 1 shape scaled x1,000 and Era 3
// x1,000,000 (spec "Color value"); later eras also get faster trips.
export const VEHICLES = Object.freeze([
  v({ id: 'handcart', name: 'Handcart', era: 1, capacity: 20, tripMs: 10 * MIN, cost: 2000, blurb: 'Slow, charming, small loads.' }),
  v({ id: 'wagon', name: 'Wagon', era: 1, capacity: 80, tripMs: 20 * MIN, cost: 15000, blurb: 'Two sturdy horses and a canvas roof.' }),
  v({ id: 'river-barge', name: 'River Barge', era: 1, capacity: 400, tripMs: 45 * MIN, cost: 90000, blurb: 'Drifts downriver heavy with crates.' }),
  v({ id: 'delivery-truck', name: 'Delivery Truck', era: 2, capacity: 20e3, tripMs: 6 * MIN, cost: 2e6, blurb: 'Rattles to the city and back before lunch.' }),
  v({ id: 'steam-train', name: 'Steam Train', era: 2, capacity: 400e3, tripMs: 20 * MIN, cost: 90e6, blurb: 'A whole carriage of color, whistling home.' }),
  v({ id: 'airship', name: 'Airship', era: 3, capacity: 20e6, tripMs: 3 * MIN, cost: 2e9, blurb: 'Drifts over the rooftops with a glow.' }),
  v({ id: 'pneumatic-tube', name: 'Pneumatic Tube', era: 3, capacity: 80e6, tripMs: 30e3, cost: 15e9, blurb: 'Fwoomp. Delivered.' }),
  v({ id: 'beam-relay', name: 'Beam Relay', era: 3, capacity: 400e6, tripMs: 5e3, cost: 90e9, blurb: 'Color, but as light, and nearly instant.' }),
]);

export const VEHICLES_BY_ID = Object.freeze(Object.fromEntries(VEHICLES.map((x) => [x.id, x])));

export function getVehicle(id) {
  return VEHICLES_BY_ID[id] ?? null;
}

export function vehiclesForEra(era) {
  return VEHICLES.filter((x) => x.era === era);
}

// Rush: tap a mixer to fill its batch instantly, once per mixer per 10 minutes.
export const RUSH_COOLDOWN_MS = 10 * MIN;

// Standing shop (slow, automatic income): jars/s at level 1, +1% price per level.
export const SHOP = Object.freeze({ baseSellRate: 0.04, priceBonusPerLevel: 0.01 });

// Packing bonus for a well-packed crate (spec "Packing (sorting tie-in)").
export const PACKING_BONUS = 0.25;

export const byId = Object.freeze({ stations: STATION_KINDS, grinders: GRINDER_KINDS_BY_ID, vehicles: VEHICLES_BY_ID });
