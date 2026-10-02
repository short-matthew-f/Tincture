// sources.js — spec: DESIGN.md "The factory" > "Production chain" and "Stations"
// (Source row: starts with 3, Era 1 max 8; hunters unlock more).
//
// Owns: raw-material source stations. One source per pigment; the source id IS
// the pigment id (matches state.stations.sources keyed by pigment id). Raw rate is
// "raw material per second at level 1"; output(L) = baseRate * L * 2^milestones.
// Cost(L) = baseCost * 1.15^L (see stations.js).
//
// unlock: { type:'start' } | { type:'region', region:'<region id>' }
// A region unlock means the source can be bought once that region has been
// unlocked AND a hunter has returned from it with that pigment (sim decides).

export const MAX_SOURCES_ERA1 = 8;

export const SOURCES = Object.freeze([
  // Starters (the three Era 1 primaries).
  { id: 'madder', name: 'Madder Patch', pigment: 'madder', baseRate: 1.0, baseCost: 10, unlock: { type: 'start' } },
  { id: 'ochre', name: 'Ochre Pit', pigment: 'ochre', baseRate: 1.0, baseCost: 10, unlock: { type: 'start' } },
  { id: 'woad', name: 'Woad Vat', pigment: 'woad', baseRate: 1.0, baseCost: 10, unlock: { type: 'start' } },
  // Hunter-unlocked.
  { id: 'saffron', name: 'Saffron Field', pigment: 'saffron', baseRate: 1.6, baseCost: 120, unlock: { type: 'region', region: 'meadow' } },
  { id: 'umber', name: 'Umber Quarry', pigment: 'umber', baseRate: 2.2, baseCost: 400, unlock: { type: 'region', region: 'quarry' } },
  { id: 'lapis', name: 'Lapis Seam', pigment: 'lapis', baseRate: 3.0, baseCost: 1500, unlock: { type: 'region', region: 'quarry' } },
  { id: 'murex', name: 'Murex Cove', pigment: 'murex', baseRate: 3.5, baseCost: 2500, unlock: { type: 'region', region: 'coast' } },
  { id: 'chalk-white', name: 'Chalk Cliff', pigment: 'chalk-white', baseRate: 2.6, baseCost: 900, unlock: { type: 'region', region: 'coast' } },
  { id: 'indigo', name: 'Indigo Terrace', pigment: 'indigo', baseRate: 4.0, baseCost: 6000, unlock: { type: 'region', region: 'jungle' } },
  { id: 'cochineal', name: 'Cochineal Grove', pigment: 'cochineal', baseRate: 4.5, baseCost: 9000, unlock: { type: 'region', region: 'jungle' } },
  { id: 'sulfur', name: 'Sulfur Vent', pigment: 'sulfur', baseRate: 5.5, baseCost: 24000, unlock: { type: 'region', region: 'volcano' } },
  { id: 'bone-black', name: 'Soot Hearth', pigment: 'bone-black', baseRate: 5.0, baseCost: 20000, unlock: { type: 'region', region: 'volcano' } },
].map((x) => Object.freeze({ ...x, unlock: Object.freeze(x.unlock) })));

export const SOURCES_BY_ID = Object.freeze(Object.fromEntries(SOURCES.map((s) => [s.id, s])));
export const byId = SOURCES_BY_ID;

export function getSource(id) {
  return SOURCES_BY_ID[id] ?? null;
}

/** The source that produces a given pigment id, or null. */
export function getSourceForPigment(pigmentId) {
  return SOURCES.find((s) => s.pigment === pigmentId) ?? null;
}

export const STARTING_SOURCES = Object.freeze(SOURCES.filter((s) => s.unlock.type === 'start').map((s) => s.id));
