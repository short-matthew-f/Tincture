// regions.js — spec: DESIGN.md "Hue Hunters and postcards" > "Regions" (table),
// "Weekly events" (event regions) and "Progression" (Glacier = Era 2,
// Dreamshore = Era 3).
//
// unlock: {type:'hunters'}          Meadow: opens when the hunters do
//         {type:'colors', n}        catalog size
//         {type:'era', n}           era reached
//         {type:'event'}            opens only while its weekly event runs (event regions have event: <event id>)
// palette: hue families signature to the region.
// hauls: pigment ids found as raw material there.
// wildHues: catalog ids that can only be found here.
// sourcesUnlocked: source ids (sources.js) whose station a hunter can unlock.
// mapPos: percent coordinates on the static illustrated map.

const r = (o) => Object.freeze({ postcards: 8, event: null, sourcesUnlocked: [], wildHues: [], era: 1, kind: 'home', ...o });
const fz = (a) => Object.freeze(a);

export const REGIONS = Object.freeze([
  r({ id: 'meadow', name: 'Meadow', unlock: fz({ type: 'hunters', n: 0 }), palette: fz(['green', 'yellow', 'pink']),
    hauls: fz(['saffron', 'madder', 'woad']), wildHues: fz(['meadow-green', 'clover-pink', 'honey-gold']),
    sourcesUnlocked: fz(['saffron']), mapPos: fz({ x: 22, y: 62 }),
    blurb: 'Rolling fields of greens, soft yellows and madder pinks.' }),
  r({ id: 'quarry', name: 'Quarry', unlock: fz({ type: 'colors', n: 15 }), palette: fz(['yellow', 'orange', 'neutral']),
    hauls: fz(['ochre', 'umber', 'lapis']), wildHues: fz(['slate-grey', 'umber-brown', 'ochre-rust']),
    sourcesUnlocked: fz(['umber', 'lapis']), mapPos: fz({ x: 48, y: 70 }),
    blurb: 'Warm cut stone: ochres, umbers and long slate shadows.' }),
  r({ id: 'coast', name: 'Coast', unlock: fz({ type: 'colors', n: 25 }), palette: fz(['teal', 'blue', 'violet']),
    hauls: fz(['murex', 'woad', 'chalk-white']), wildHues: fz(['murex-purple', 'sea-glass', 'harbor-teal']),
    sourcesUnlocked: fz(['murex', 'chalk-white']), mapPos: fz({ x: 80, y: 58 }),
    blurb: 'Teals, sea blues and the rare murex purple.' }),
  r({ id: 'jungle', name: 'Jungle', unlock: fz({ type: 'colors', n: 40 }), palette: fz(['green', 'red', 'violet']),
    hauls: fz(['indigo', 'cochineal', 'saffron']), wildHues: fz(['cochineal-red', 'parrot-green', 'orchid']),
    sourcesUnlocked: fz(['indigo', 'cochineal']), mapPos: fz({ x: 38, y: 30 }),
    blurb: 'Vivid greens, bright parrots and cochineal reds.' }),
  r({ id: 'volcano', name: 'Volcano', unlock: fz({ type: 'colors', n: 60 }), palette: fz(['neutral', 'yellow', 'red']),
    hauls: fz(['sulfur', 'bone-black', 'ochre']), wildHues: fz(['lava-red', 'sulfur-yellow', 'obsidian', 'ash-grey']),
    sourcesUnlocked: fz(['sulfur', 'bone-black']), mapPos: fz({ x: 70, y: 22 }),
    blurb: 'Warm blacks, sulfur yellows and iron reds.' }),
  r({ id: 'glacier', name: 'Glacier', unlock: fz({ type: 'era', n: 2 }), palette: fz(['blue', 'neutral', 'violet']),
    hauls: fz(['chalk-white', 'lapis']), era: 2, mapPos: fz({ x: 14, y: 12 }),
    blurb: 'Ice blues, clean whites and pale violets. (Coming with Era 2.)' }),
  r({ id: 'dreamshore', name: 'Dreamshore', unlock: fz({ type: 'era', n: 3 }), palette: fz(['violet', 'teal', 'pink']),
    hauls: fz([]), era: 3, mapPos: fz({ x: 90, y: 10 }),
    blurb: 'Impossible, glowing hues. (Coming with Era 3.)' }),
  // Event regions: one per weekly event, with an 8-card postcard set each.
  r({ id: 'orchard', name: 'Orchard', kind: 'event', event: 'autumn-harvest', unlock: fz({ type: 'event' }), palette: fz(['orange', 'red', 'yellow']),
    hauls: fz(['madder', 'ochre', 'umber']), mapPos: fz({ x: 30, y: 82 }), blurb: 'Rust leaves and golden fruit.' }),
  r({ id: 'reef', name: 'Reef', kind: 'event', event: 'deep-sea', unlock: fz({ type: 'event' }), palette: fz(['teal', 'blue', 'neutral']),
    hauls: fz(['murex', 'woad', 'chalk-white']), mapPos: fz({ x: 88, y: 76 }), blurb: 'Teals and pearls under the waves.' }),
  r({ id: 'garden', name: 'Garden', kind: 'event', event: 'bloom-week', unlock: fz({ type: 'event' }), palette: fz(['pink', 'violet', 'green']),
    hauls: fz(['madder', 'saffron', 'woad']), mapPos: fz({ x: 12, y: 44 }), blurb: 'Pinks and lilacs in full bloom.' }),
  r({ id: 'night-market', name: 'Night Market', kind: 'event', event: 'neon-night', unlock: fz({ type: 'event' }), palette: fz(['pink', 'green', 'blue']),
    hauls: fz(['cochineal', 'indigo', 'sulfur']), mapPos: fz({ x: 58, y: 48 }), blurb: 'Glowing signs and electric brights.' }),
  r({ id: 'glacier-pass', name: 'Glacier Pass', kind: 'event', event: 'winter-frost', unlock: fz({ type: 'event' }), palette: fz(['blue', 'neutral']),
    hauls: fz(['lapis', 'chalk-white']), mapPos: fz({ x: 26, y: 6 }), blurb: 'Ice blues and silver snow.' }),
  r({ id: 'lantern-bridge', name: 'Lantern Bridge', kind: 'event', event: 'festival-of-lanterns', unlock: fz({ type: 'event' }), palette: fz(['orange', 'red', 'yellow']),
    hauls: fz(['madder', 'saffron', 'ochre']), mapPos: fz({ x: 62, y: 86 }), blurb: 'Warm paper lanterns over still water.' }),
  r({ id: 'hilltop', name: 'Hilltop', kind: 'event', event: 'golden-hour', unlock: fz({ type: 'event' }), palette: fz(['pink', 'yellow', 'violet']),
    hauls: fz(['saffron', 'madder', 'indigo']), mapPos: fz({ x: 50, y: 14 }), blurb: 'Peach skies and honey light.' }),
  r({ id: 'scriptorium', name: 'Scriptorium', kind: 'event', event: 'ink-and-paper', unlock: fz({ type: 'event' }), palette: fz(['neutral', 'blue']),
    hauls: fz(['bone-black', 'umber', 'indigo']), mapPos: fz({ x: 74, y: 40 }), blurb: 'Inks, sepias and quiet paper.' }),
]);

export const REGIONS_BY_ID = Object.freeze(Object.fromEntries(REGIONS.map((x) => [x.id, x])));
export const byId = REGIONS_BY_ID;

/** The five Era 1 home regions that unlock by progress (excludes Glacier, Dreamshore, events). */
export const ERA1_REGION_IDS = fz(REGIONS.filter((x) => x.kind === 'home' && x.era === 1).map((x) => x.id));
export const EVENT_REGION_IDS = fz(REGIONS.filter((x) => x.kind === 'event').map((x) => x.id));

export function getRegion(id) {
  return REGIONS_BY_ID[id] ?? null;
}

export function regionForEvent(eventId) {
  return REGIONS.find((x) => x.event === eventId) ?? null;
}

/** Is a progression-unlocked region open for this (era, colorCount)? Event regions are decided by the event system. */
export function isRegionUnlocked(region, { era = 1, colors = 0, hunters = false } = {}) {
  const u = region.unlock;
  if (u.type === 'hunters') return !!hunters;
  if (u.type === 'colors') return colors >= u.n;
  if (u.type === 'era') return era >= u.n;
  return false;
}
