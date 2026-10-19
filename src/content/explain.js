// explain.js — "what is this for?" notes (0.3.1 audit, docs/AUDIT-0.3.1.md).
// Pure data. Each note is one or two short plain sentences: what the thing is for,
// then what a player does with it. The workshop's station notes (tap any row or the
// scene's jars), the Seals note and the Close up shop note read these. Copy rules:
// positive framing, no countdown pressure, plain US English.

/** Station notes, keyed by station kind (the workshop's rows and scene objects). */
export const STATION_NOTES = Object.freeze({
  source: Object.freeze({
    title: 'Sources',
    what: 'A source gathers one raw pigment, a little every second: madder for reds, ochre for yellows, woad for blues. Hunters find more sources out on the map.',
    tip: 'Level it up when your grinders and mixers are waiting for pigment.',
  }),
  grinder: Object.freeze({
    title: 'Grinders',
    what: 'A grinder turns raw pigment into fine powder that the mixers can use. Better grinders make purer jars, and pure jars sell for more.',
    tip: 'Level it up when the sources make more than the grinder can keep up with.',
  }),
  mixer: Object.freeze({
    title: 'Mixers and their jars',
    what: 'A mixer makes one color of your choice and pours it into its jar. The shop sells from the jars, and orders, commissions and carts take from them too.',
    tip: 'Change the color any time. Level it up to make that color faster, or Rush for a quick batch now.',
  }),
  jars: Object.freeze({
    title: 'Bigger jars',
    what: 'Jars hold what your mixers make while you are away. When every jar and the cellar are full, the mixers rest until something sells.',
    tip: 'Bigger jars mean a longer time away before the workshop fills up. Nothing is ever lost when it is full.',
  }),
  cellar: Object.freeze({
    title: 'Cellar',
    what: 'The cellar is extra room for jars beyond the glass jars on display. Together they set how long the workshop runs on its own.',
    tip: 'A bigger cellar means a longer time away, the same as bigger jars.',
  }),
  shop: Object.freeze({
    title: 'Shop counter',
    what: 'The shop sells your jars to Harbor Town a little every second and keeps the coins in the till. Tap the coin pill to collect them.',
    tip: 'Level it up to sell faster and at better prices. Keep jars back for a color on its jar note.',
  }),
  vehicle: Object.freeze({
    title: 'Carts and the fleet',
    what: 'Carts carry jars to towns that pay more than the shop, especially for the colors they want this week.',
    tip: 'Tap Ship to load one. Pack by hand for a quarter more, or hire the Dispatcher to send them out for you.',
  }),
  steward: Object.freeze({
    title: 'The Steward',
    what: 'While it is on, the Steward buys the cheapest upgrade for your slowest step (Make, Store or Ship) whenever you have the coins.',
    tip: 'Turn it off whenever you would rather choose upgrades yourself.',
  }),
  apprentice: Object.freeze({
    title: 'Apprentices',
    what: 'Apprentices take a chore off your hands for good. They work while you are away, too.',
    tip: 'Doing a chore by hand always pays a little more, so hire them when the chore stops being fun.',
  }),
});

/** Concepts explained from anywhere (a tap on a Seals mention, the Close up shop button). */
export const EXPLAIN = Object.freeze({
  seals: Object.freeze({
    title: 'What Seals are for',
    lines: Object.freeze([
      'Seals are wax stamps you earn from quests, the weekly event, spare postcards and lucky grading bonuses.',
      'Spend them in the Seal shop under Quests: a boost to your mixers, a busy market day, a crate of vials for the shelf, or calling your hunters home early.',
      'They never expire, so save them for whenever a boost helps.',
    ]),
    go: Object.freeze({ screen: 'quests', params: Object.freeze({ section: 'seal-shop' }) }),
    cta: 'Open the Seal shop',
  }),
  closeup: Object.freeze({
    title: 'What Close up shop does',
    lines: Object.freeze([
      'A little ritual for when you put the phone down. Every hunter at home sets out on an overnight trip, and every resting mixer gets the best color you can make.',
      'Nothing pauses: the shop keeps selling and the mixers keep filling your jars while you are away.',
    ]),
    go: null,
    cta: '',
  }),
  meter: Object.freeze({
    title: 'Make, Store and Ship',
    lines: Object.freeze([
      'Make is how many jars your mixers make each second. Store is how long until your jars and cellar are full. Ship is how many jars the shop and carts sell each second.',
      'The outlined one is the slowest step right now, and the big button below suggests what would help it most.',
    ]),
    go: null,
    cta: '',
  }),
  reputation: Object.freeze({
    title: 'Reputation stars',
    lines: Object.freeze([
      'Every Perfect match earns a star. They are a keepsake of your best mixing and never go down.',
      'As stars add up, customers start asking for subtler blends, so there is always a fresh little challenge.',
    ]),
    go: null,
    cta: '',
  }),
  banners: Object.freeze({
    title: 'Event banners',
    lines: Object.freeze([
      'Each weekly event has a keepsake banner at step 6 of its track. Once you earn it, it hangs over your workshop for good.',
    ]),
    go: Object.freeze({ screen: 'quests', params: Object.freeze({ section: 'event' }) }),
    cta: 'See this week\'s event',
  }),
});

export function stationNote(kind) {
  return STATION_NOTES[kind] ?? null;
}

export function explain(id) {
  return EXPLAIN[id] ?? null;
}
