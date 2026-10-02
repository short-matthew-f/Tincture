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
export const POINTS_PER = Object.freeze({ order: 10, board: 15, crate: 5, purify: 10, paint: 2 });

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

function event({ id, name, palette, region, twist, rules, canvases }) {
  return Object.freeze({
    id, name,
    palette: Object.freeze(palette),
    region,
    twist: Object.freeze({ text: twist, rules: Object.freeze(rules) }),
    track: buildTrack(id, canvases),
    catalogPage: Object.freeze(Array.from({ length: 12 }, (_, i) => `${id}-${i + 1}`)),
    vialColors: Object.freeze([`${id}-1`, `${id}-2`, `${id}-3`]),
    canvases: Object.freeze(canvases),
    pointsPer: POINTS_PER,
  });
}

// In rotation order.
export const EVENTS = Object.freeze([
  event({ id: 'autumn-harvest', name: 'Autumn Harvest', palette: ['orange', 'red', 'yellow'], region: 'orchard',
    twist: 'Grading boards are shaped like falling leaves.', rules: { boardShape: 'leaf' },
    canvases: ['harvest-window', 'leaf-mosaic'] }),
  event({ id: 'deep-sea', name: 'Deep Sea', palette: ['teal', 'blue', 'neutral'], region: 'reef',
    twist: 'Murex Cove opens for the week.', rules: { sourceUnlock: 'murex' },
    canvases: ['coral-window', 'pearl-plate'] }),
  event({ id: 'bloom-week', name: 'Bloom Week', palette: ['pink', 'violet', 'green'], region: 'garden',
    twist: 'Bouquet orders ask for several colors at once.', rules: { bouquetOrders: true },
    canvases: ['bouquet-quilt', 'trellis-print'] }),
  event({ id: 'neon-night', name: 'Neon Night', palette: ['pink', 'green', 'blue', 'violet'], region: 'night-market',
    twist: 'Tiles glow, and a few Era 2 colors are previewed.', rules: { glowTiles: true, previewEra: 2 },
    canvases: ['neon-sign-window', 'night-market-print'] }),
  event({ id: 'winter-frost', name: 'Winter Frost', palette: ['blue', 'neutral', 'teal'], region: 'glacier-pass',
    twist: 'Snowflake boards, and long hunter trips are 25% richer.', rules: { boardShape: 'snowflake', longTripBonus: 0.25 },
    canvases: ['frost-window', 'snowflake-mosaic'] }),
  event({ id: 'festival-of-lanterns', name: 'Festival of Lanterns', palette: ['orange', 'red', 'yellow'], region: 'lantern-bridge',
    twist: 'Packing doubles as stringing lanterns.', rules: { packingLanterns: true },
    canvases: ['lantern-plate', 'paper-lantern-tapestry'] }),
  event({ id: 'golden-hour', name: 'Golden Hour', palette: ['pink', 'yellow', 'violet'], region: 'hilltop',
    twist: 'Gradient sunset boards.', rules: { sunsetBoards: true },
    canvases: ['sunset-window', 'honey-hill-print'] }),
  event({ id: 'ink-and-paper', name: 'Ink and Paper', palette: ['neutral', 'blue'], region: 'scriptorium',
    twist: 'Monochrome Master boards.', rules: { monochromeMaster: true },
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
