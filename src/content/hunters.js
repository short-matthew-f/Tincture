// hunters.js — spec: DESIGN.md "Hue Hunters and postcards" > "The team",
// "Expeditions" (durations, scouting choice, pity timer) and "Postcards".
//
// Roster of 3 at unlock, growing to 6 (hired with Coins plus a catalog milestone).
// Chance fields in TRAITS and DURATIONS: wild/card values on DURATIONS are the
// base probabilities; trait wildBonus/cardBonus are RELATIVE (x1.25 = +25% of the base);
// haulBonus is a fraction added to the haul multiplier for matching hauls.

export const MAX_ROSTER = 6;
export const START_ROSTER = 3;
export const PITY_STEP = 0.02; // wild-hue chance +2% per trip without one; resets on a find

/** What kind of material a pigment is, for trait haul bonuses (Botanist: plant, Miner: mineral, Diver: sea). */
export const HAUL_CLASS = Object.freeze({
  madder: 'plant', woad: 'plant', saffron: 'plant', indigo: 'plant', cochineal: 'plant',
  ochre: 'mineral', umber: 'mineral', lapis: 'mineral', sulfur: 'mineral', 'bone-black': 'mineral',
  murex: 'sea', 'chalk-white': 'sea',
});

const t = (o) => Object.freeze({
  haulBonus: 0, haulClass: null, regions: Object.freeze([]), regionOdds: 0,
  wildBonus: 0, cardBonus: 0, marketBonus: 0, extraTint: 0, ...o,
});

// regionOdds: relative +% to wild and postcard odds when in one of `regions`.
export const TRAITS = Object.freeze({
  botanist: t({ id: 'botanist', name: 'Botanist', blurb: '+50% plant-based haul; better odds in Meadow and Jungle.',
    haulBonus: 0.5, haulClass: 'plant', regions: Object.freeze(['meadow', 'jungle']), regionOdds: 0.25 }),
  miner: t({ id: 'miner', name: 'Miner', blurb: '+50% mineral haul; better odds in Quarry and Volcano.',
    haulBonus: 0.5, haulClass: 'mineral', regions: Object.freeze(['quarry', 'volcano']), regionOdds: 0.25 }),
  diver: t({ id: 'diver', name: 'Diver', blurb: '+50% sea haul; better odds at Coast and Reef.',
    haulBonus: 0.5, haulClass: 'sea', regions: Object.freeze(['coast', 'reef']), regionOdds: 0.25 }),
  lucky: t({ id: 'lucky', name: 'Lucky', blurb: '+25% wild-hue and postcard odds anywhere.',
    wildBonus: 0.25, cardBonus: 0.25 }),
  trader: t({ id: 'trader', name: 'Trader', blurb: 'Discovers special markets more often.',
    marketBonus: 1.0 }), // x2 the base special-market discovery chance on any trip
  scholar: t({ id: 'scholar', name: 'Scholar', blurb: 'Extra catalog notes; +1 tint revealed on hauls.',
    extraTint: 1 }),
});

export const TRAIT_IDS = Object.freeze(Object.keys(TRAITS));

/** Base special-market discovery chance per trip (Trader multiplies by 1 + marketBonus). */
export const MARKET_DISCOVERY_CHANCE = 0.05;

export const HUNTERS = Object.freeze([
  { id: 'wren', name: 'Wren', trait: 'botanist', voice: 'warm', hireCost: 0, hireColors: 0,
    blurb: 'Knows every leaf by name and apologizes to the ones she steps on.' },
  { id: 'tobias', name: 'Tobias', trait: 'miner', voice: 'dry', hireCost: 400, hireColors: 0,
    blurb: 'Quiet, dusty, and always certain the good rock is one hill further.' },
  { id: 'ines', name: 'Ines', trait: 'diver', voice: 'breezy', hireCost: 1000, hireColors: 0,
    blurb: 'Surfaces with a grin, a net full of shells and salt in her hair.' },
  { id: 'pip', name: 'Pip', trait: 'lucky', voice: 'bright', hireCost: 20000, hireColors: 25,
    blurb: 'Trips over the best finds, which is somehow a plan.' },
  { id: 'mireille', name: 'Mireille', trait: 'trader', voice: 'smooth', hireCost: 80000, hireColors: 35,
    blurb: 'Befriends every merchant within a day\'s walk and remembers their names.' },
  { id: 'osei', name: 'Osei', trait: 'scholar', voice: 'thoughtful', hireCost: 250000, hireColors: 50,
    blurb: 'Fills notebooks with careful notes on exactly why that blue is blue.' },
].map((h) => Object.freeze(h)));

export const HUNTERS_BY_ID = Object.freeze(Object.fromEntries(HUNTERS.map((h) => [h.id, h])));
export const byId = HUNTERS_BY_ID;

export function getHunter(id) {
  return HUNTERS_BY_ID[id] ?? null;
}

export function getTrait(id) {
  return TRAITS[id] ?? null;
}

/** Expedition durations: haul multiplier, base wild-hue chance, base postcard chance. */
export const DURATIONS = Object.freeze({
  short: Object.freeze({ id: 'short', ms: 30 * 60e3, haul: 1, wild: 0.03, card: 0.10, label: '30 min', scouting: false }),
  long: Object.freeze({ id: 'long', ms: 4 * 3600e3, haul: 6, wild: 0.12, card: 0.35, label: '4 h', scouting: true }),
  overnight: Object.freeze({ id: 'overnight', ms: 12 * 3600e3, haul: 15, wild: 0.25, card: 0.60, label: '12 h', scouting: true }),
});

export const DURATION_IDS = Object.freeze(['short', 'long', 'overnight']);

// Levels 1..20; one xp per completed trip. Reaching level L+1 from L takes
// 2 + floor(L / 2) trips. Each level adds +5% haul.
export const LEVELS = Object.freeze({
  max: 20,
  haulPerLevel: 0.05,
  perks: Object.freeze({
    5: Object.freeze({ id: 'swift-boots', text: 'Trips take 10% less time.', tripTimeMult: 0.9 }),
    10: Object.freeze({ id: 'second-look', text: 'Rolls for an extra postcard on every trip.', extraPostcardRolls: 1 }),
    15: Object.freeze({ id: 'second-wind', text: 'Learns a second trait.', secondTrait: true }),
  }),
});

/** Trips needed to climb from `level` to `level + 1`. */
export function xpToNext(level) {
  return 2 + Math.floor(level / 2);
}

/** Total trips completed required to be at `level` (level 1 = 0 trips). */
export function xpForLevel(level) {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/** Level for a given lifetime trip count (capped at LEVELS.max). */
export function levelForXp(xp) {
  let l = 1;
  while (l < LEVELS.max && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** Perks earned at or below `level` (perk keys are levels 5, 10, 15). */
export function perksAtLevel(level) {
  return Object.entries(LEVELS.perks).filter(([l]) => Number(l) <= level).map(([, p]) => p);
}

// Scouting choices (4 h and 12 h trips; ignoring picks one at random).
// effect keys: haul (+fraction of haul), wild (+absolute wild chance), card (+absolute postcard chance), tint (+tints revealed).
export const SCOUT_CHOICES = Object.freeze([
  { id: 'river-or-ridge', prompt: 'A river bends one way and a ridge climbs the other.',
    a: { text: 'Follow the river', effect: { haul: 0.2 } }, b: { text: 'Climb the ridge', effect: { wild: 0.05 } } },
  { id: 'smoke-or-song', prompt: 'There is a curl of smoke ahead, and someone singing behind.',
    a: { text: 'Visit the campfire', effect: { card: 0.10 } }, b: { text: 'Follow the song', effect: { wild: 0.05 } } },
  { id: 'cave-or-meadow', prompt: 'A cool cave mouth, or a bright open slope?',
    a: { text: 'Peek into the cave', effect: { haul: 0.2 } }, b: { text: 'Cross the open slope', effect: { tint: 1 } } },
  { id: 'market-or-trail', prompt: 'A busy little stall by the road, and a quiet trail beyond it.',
    a: { text: 'Chat with the stallholder', effect: { card: 0.10 } }, b: { text: 'Take the quiet trail', effect: { haul: 0.2 } } },
  { id: 'dawn-or-dusk', prompt: 'The light is perfect now, but it will be even better in an hour.',
    a: { text: 'Sketch right now', effect: { tint: 1 } }, b: { text: 'Wait for golden light', effect: { wild: 0.05 } } },
].map((c) => Object.freeze(c)));

export function getScoutChoice(id) {
  return SCOUT_CHOICES.find((c) => c.id === id) ?? null;
}
