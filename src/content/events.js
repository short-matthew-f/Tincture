// events.js — spec: DESIGN.md "Quests and weekly events" > "Weekly events"
// (table, event track, rerun rule) and "Economy" (up to 400 Seals from an event track).
//
// Each week runs one themed event. Events rotate on an 8-week cycle keyed by ISO week
// number (week % 8; 2026-W40 -> index 0 -> autumn-harvest) and progress is saved per
// event key, so a missed week comes back.
//
// track: 10 steps. `points` is the CUMULATIVE event-point threshold. Steps 1-6 end at
// 150 points (about 20 minutes of themed play); steps 7-10 are for enthusiasts.
// Rewards are {seals:n} | {colorId} | {canvas} | {vial:n} | {cosmetic}; seals across the
// 10 steps total 400.
// catalogPage: 12 limited-edition color ids (the catalog module should define them).
// vialColors: which of those colors appear as event-colored vials on the Merge Shelf.
// twist.rules: machine-readable flags consumed by puzzles/sim.

export const ROTATION_WEEKS = 8;

/** Event points per themed action (spec: "fed by event points from any themed activity"). */
export const POINTS_PER = Object.freeze({ order: 10, board: 15, crate: 5, purify: 10, paint: 2, bouquet: 30, mosaic: 30, hank: 4, lifted: 25, harvest: 20 });

/**
 * How to earn each kind of event point (the Quests screen's "How to earn event points").
 *   label   the action, as a short line ("Fill an order in the event's colors")
 *   how     one plain sentence on what counts
 *   go      { screen, params? } where to do it
 *   needs   (optional) a NEED_KEYS entry from quests.js
 *   rule    (optional) the twist rule this source only exists under (bouquet: bouquetOrders)
 * {families} in text is replaced with the event's color families ("pinks, violets or greens").
 */
const src = (label, how, screen, params, cta, needs = null, rule = null) => Object.freeze({
  label, how, go: Object.freeze({ screen, params: Object.freeze({ ...(params || {}) }) }), cta, needs, rule,
});
export const EVENT_POINT_HOW = Object.freeze({
  order: src('Fill an order in the event\'s colors', 'Any order whose color is one of the {families} counts, however close your match.', 'orders', null, 'Open Orders'),
  bouquet: src('Fill a bouquet order', 'A bouquet asks for a few flowers in the event\'s colors. Fill every flower and the whole bouquet earns points.', 'orders', null, 'Open Orders', null, 'bouquetOrders'),
  board: src('Solve an event grading board', 'While the event runs, new grading boards use its colors and frame. Any difficulty counts.', 'puzzles', { puzzle: 'grading' }, 'Open grading boards'),
  purify: src('Purify a batch in the event\'s colors', 'A muddy batch of one of the {families} counts when you sort it clean.', 'puzzles', { puzzle: 'purify' }, 'Open Purify', 'factory'),
  crate: src('Ship a crate with the event\'s colors', 'A shipment that carries jars of the {families} counts.', 'workshop', { panel: 'fleet' }, 'Open Shipping', 'shipping'),
  hank: src('Wind a hank in the Winding Room', 'A hank of any of the {families} counts.', 'skeins', null, 'Open the Winding Room', 'skeins'),
  lifted: src('Lift a painting at the Lifting Table', 'A finished painting counts when its jars hold any of the {families}.', 'lift', null, 'Open the Lifting Table', 'lift'),
  harvest: src('Gather in the Dye Garden', 'A visit counts when your basket brings home dyes of the {families}.', 'garden', null, 'Open the Dye Garden', 'garden'),
  mosaic: src('Finish a Tile Room wall', 'A finished wall glazed with any of the {families} counts.', 'tiles', null, 'Open the Tile Room', 'tiles'),
  paint: src('Paint a Gallery region in the event\'s colors', 'Each region you paint with one of the {families} counts.', 'gallery', null, 'Open the Gallery', 'gallery'),
});

/** Plain words for hue families ("pinks, violets or greens"). */
export const FAMILY_WORDS = Object.freeze({
  red: 'reds', orange: 'oranges', yellow: 'yellows', green: 'greens', teal: 'teals',
  blue: 'blues', violet: 'violets', pink: 'pinks', neutral: 'whites, greys and blacks',
});

export function familiesText(families = [], joiner = 'or') {
  const w = families.map((f) => FAMILY_WORDS[f] || f);
  if (w.length <= 1) return w.join('');
  return `${w.slice(0, -1).join(', ')} ${joiner} ${w[w.length - 1]}`;
}

/** Chance per trip that a hunter brings a limited color home from the event's region. */
export const EVENT_HUE_CHANCE = Object.freeze({ short: 0.25, long: 0.6, overnight: 0.9 });

// Cumulative thresholds: steps 1-6 -> 150 (about 20 minutes), steps 7-10 -> 400.
const THRESHOLDS = Object.freeze([10, 30, 55, 85, 115, 150, 210, 280, 350, 420]);

function buildTrack(id, canvases) {
  const rewards = [
    { seals: 20 },
    { colorId: `${id}-1` },
    { seals: 30 },
    { canvas: canvases[0] },
    { vial: 3 },
    { cosmetic: `${id}-banner` },
    { seals: 90 },
    { canvas: canvases[1] },
    { seals: 120 },
    { seals: 140 },
  ];
  return Object.freeze(rewards.map((reward, i) => Object.freeze({ step: i + 1, points: THRESHOLDS[i], reward: Object.freeze(reward) })));
}

function event({ id, name, palette, region, twist, rules, how, go, cta, canvases }) {
  return Object.freeze({
    id, name,
    palette: Object.freeze(palette),
    region,
    // twist.how explains it in a sentence; twist.go is where to see it (Quests > event sheet).
    twist: Object.freeze({
      text: twist, rules: Object.freeze(rules), how,
      go: Object.freeze({ screen: go.screen, params: Object.freeze({ ...(go.params || {}) }) }), cta,
    }),
    track: buildTrack(id, canvases),
    catalogPage: Object.freeze(Array.from({ length: 12 }, (_, i) => `${id}-${i + 1}`)),
    vialColors: Object.freeze([`${id}-1`, `${id}-2`, `${id}-3`]),
    canvases: Object.freeze(canvases),
    pointsPer: POINTS_PER,
  });
}

// In rotation order. Every event's grading boards use its colors and a themed
// frame (spec: "Event orders and boards using the palette, with themed frames"),
// so boardShape is set on all eight; the twist text names what is special.
const BOARDS = { screen: 'puzzles', params: { puzzle: 'grading' } };
export const EVENTS = Object.freeze([
  event({ id: 'autumn-harvest', name: 'Autumn Harvest', palette: ['orange', 'red', 'yellow'], region: 'orchard',
    twist: 'Grading boards are shaped like falling leaves.', rules: { boardShape: 'leaf' },
    how: 'Start a new grading board this week and it comes in a leaf frame, in the harvest colors.', go: BOARDS, cta: 'Try a leaf board',
    canvases: ['harvest-window', 'leaf-mosaic'] }),
  event({ id: 'deep-sea', name: 'Deep Sea', palette: ['teal', 'blue', 'neutral'], region: 'reef',
    twist: 'Murex Cove opens for the week.', rules: { sourceUnlock: 'murex', boardShape: 'fish' },
    how: 'A Murex source is lent to your workshop for the week: it makes murex purple for your mixes. Grading boards swim in a fish frame.', go: { screen: 'workshop', params: { panel: 'sources' } }, cta: 'See Murex Cove',
    canvases: ['coral-window', 'pearl-plate'] }),
  event({ id: 'bloom-week', name: 'Bloom Week', palette: ['pink', 'violet', 'green'], region: 'garden',
    twist: 'Bouquet orders ask for several colors at once.', rules: { bouquetOrders: true, boardShape: 'flower' },
    how: 'About one new order in three is a bouquet: a few flowers in pinks, violets and greens. Mix each flower, or hand over jars you have in stock.', go: { screen: 'orders' }, cta: 'See the orders',
    canvases: ['bouquet-quilt', 'trellis-print'] }),
  event({ id: 'neon-night', name: 'Neon Night', palette: ['pink', 'green', 'blue', 'violet'], region: 'night-market',
    twist: 'Glowing grading boards, with a sneak peek at four Era 2 colors.', rules: { glowTiles: true, previewEra: 2 },
    how: 'New grading boards glow and borrow the Era 2 preview colors. The four previews are on the event page of your Catalog.', go: { screen: 'catalog', params: { page: 'event' } }, cta: 'See the preview',
    canvases: ['neon-sign-window', 'night-market-print'] }),
  event({ id: 'winter-frost', name: 'Winter Frost', palette: ['blue', 'neutral', 'teal'], region: 'glacier-pass',
    twist: 'Snowflake boards, and long hunter trips are 25% richer.', rules: { boardShape: 'snowflake', longTripBonus: 0.25 },
    how: 'Long and overnight hunter trips bring home a quarter more raw pigment this week. Grading boards come in a snowflake frame.', go: { screen: 'map' }, cta: 'Send a long trip',
    canvases: ['frost-window', 'snowflake-mosaic'] }),
  event({ id: 'festival-of-lanterns', name: 'Festival of Lanterns', palette: ['orange', 'red', 'yellow'], region: 'lantern-bridge',
    twist: 'Packing strings lanterns: every packed shipment earns event points.', rules: { packingLanterns: true, boardShape: 'lantern' },
    how: 'Pack a shipment before it leaves and you string lanterns as you sort: each packed shipment counts for the event, whatever its colors.', go: { screen: 'workshop', params: { panel: 'fleet' } }, cta: 'Open Shipping',
    canvases: ['lantern-plate', 'paper-lantern-tapestry'] }),
  event({ id: 'golden-hour', name: 'Golden Hour', palette: ['pink', 'yellow', 'violet'], region: 'hilltop',
    twist: 'Sunset boards: honey light at the top, dusk at the bottom.', rules: { sunsetBoards: true, boardShape: 'sunset' },
    how: 'New grading boards are setting suns: always lightest and warmest at the top, deepening to dusk at the bottom.', go: BOARDS, cta: 'Try a sunset board',
    canvases: ['sunset-window', 'honey-hill-print'] }),
  event({ id: 'ink-and-paper', name: 'Ink and Paper', palette: ['neutral', 'blue'], region: 'scriptorium',
    twist: 'Monochrome boards: one ink, from pale wash to deep.', rules: { monochromeMaster: true, boardShape: 'scroll' },
    how: 'New grading boards are a single ink on a scroll: read them by lightness and strength, a gentle test for a master\'s eye.', go: BOARDS, cta: 'Try an ink board',
    canvases: ['inkwell-plate', 'manuscript-print'] }),
]);

export const EVENTS_BY_ID = Object.freeze(Object.fromEntries(EVENTS.map((e) => [e.id, e])));
export const byId = EVENTS_BY_ID;

export function getEvent(id) {
  return EVENTS_BY_ID[id] ?? null;
}

/** Event running in an ISO week key like '2026-W40'. Unparseable keys fall back to the first event. */
export function eventForWeek(weekKey) {
  const m = /W(\d+)/.exec(String(weekKey));
  const n = m ? parseInt(m[1], 10) : 0;
  return EVENTS[((n % ROTATION_WEEKS) + ROTATION_WEEKS) % ROTATION_WEEKS];
}

/** Highest track step reached with `points` (0 when none). */
export function trackStepsReached(event, points) {
  let n = 0;
  for (const s of event.track) if (points >= s.points) n++;
  return n;
}
