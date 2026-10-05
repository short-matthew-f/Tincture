// rooms.js — spec: DESIGN.md "The factory" > "Workshop rooms" (Bench, Mill Room,
// Mixing Hall, Cellar, Loading Yard, Atelier) plus "The Gallery" > "The gallery
// walls" (Gallery Wing, Long Hall, Rotunda).
//
// Rooms cost Coins plus a catalog requirement (colorsRequired). The array is
// ordered by cost ascending (so Gallery Wing sits between Mixing Hall and Cellar).
// adds: station slots / walls / cellar multiplier granted by the room.
// unlock: the coin-bought system (src/sim/unlocks.js) this room IS. Buying the
// room opens it, and its colorsRequired is that unlock's reveal count
// (docs/V02-CONTRACTS.md "Unlocks": Gallery Wing 25, Loading Yard 35).

const NONE = { mixerSlots: 0, vatSlots: 0, grinderSlots: 0, fleetSlots: 0, walls: 0, cellarMult: 1 };
const adds = (o) => Object.freeze({ ...NONE, ...o });

export const ROOMS = Object.freeze([
  { id: 'bench', name: 'The Bench', cost: 0, colorsRequired: 0, phase: 1, adds: adds({}),
    blurb: 'Where it all begins: one mortar, a few jars and a sunny window.' },
  { id: 'mill-room', name: 'Mill Room', cost: 1500, colorsRequired: 15, phase: 1, adds: adds({ grinderSlots: 1, mixerSlots: 1 }),
    blurb: 'Stone floors and room for a second grinder and mixer.' },
  { id: 'mixing-hall', name: 'Mixing Hall', cost: 3000, colorsRequired: 18, phase: 2, adds: adds({ mixerSlots: 2, vatSlots: 3 }),
    blurb: 'High windows, long tables and three more tall glass vats.' },
  { id: 'gallery-wing', name: 'Gallery Wing', cost: 8000, colorsRequired: 25, phase: 2, unlock: 'gallery', adds: adds({ walls: 4 }),
    blurb: 'Quiet white walls, waiting for your first paintings.' },
  { id: 'cellar', name: 'Cellar', cost: 12000, colorsRequired: 24, phase: 2, adds: adds({ vatSlots: 3, cellarMult: 4 }),
    blurb: 'Cool, dark and deep: four times the storage for everything else.' },
  { id: 'loading-yard', name: 'Loading Yard', cost: 40000, colorsRequired: 50, phase: 2, unlock: 'shipping', adds: adds({ fleetSlots: 3, mixerSlots: 1 }),
    blurb: 'Carts, crates and the smell of rope. Time to ship.' },
  { id: 'long-hall', name: 'Long Hall', cost: 60000, colorsRequired: 40, phase: 3, adds: adds({ walls: 8 }),
    blurb: 'A long skylit hall with eight more walls to hang.' },
  { id: 'atelier', name: 'Atelier', cost: 150000, colorsRequired: 45, phase: 3, adds: adds({ mixerSlots: 1, vatSlots: 3, grinderSlots: 1 }),
    blurb: 'The grading table lives here, with room for serious work.' },
  { id: 'rotunda', name: 'Rotunda', cost: 400000, colorsRequired: 70, phase: 3, adds: adds({ walls: 12 }),
    blurb: 'A domed round room: twelve walls and an echo that loves color.' },
].map((r) => Object.freeze(r)));

/** Era 1 slot caps (spec "Stations" table). Fleet unlocks in Phase 2. */
export const MAX_SLOTS = Object.freeze({ mixers: 6, vats: 12, grinders: 3, fleet: 6 });

/** What the player owns before buying any room (spec "Stations": starts with; two mixers since v0.2). */
export const STARTING_SLOTS = Object.freeze({ mixers: 2, vats: 3, grinders: 1, fleet: 0, walls: 0, cellarMult: 1 });

export const ROOMS_BY_ID = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, r])));
export const byId = ROOMS_BY_ID;

export function getRoom(id) {
  return ROOMS_BY_ID[id] ?? null;
}

/** Totals from a list of owned room ids, clamped to MAX_SLOTS. */
export function slotsForRooms(roomIds) {
  const t = { ...STARTING_SLOTS };
  for (const id of roomIds) {
    const r = ROOMS_BY_ID[id];
    if (!r) continue;
    t.mixers += r.adds.mixerSlots;
    t.vats += r.adds.vatSlots;
    t.grinders += r.adds.grinderSlots;
    t.fleet += r.adds.fleetSlots;
    t.walls += r.adds.walls;
    t.cellarMult *= r.adds.cellarMult;
  }
  t.mixers = Math.min(t.mixers, MAX_SLOTS.mixers);
  t.vats = Math.min(t.vats, MAX_SLOTS.vats);
  t.grinders = Math.min(t.grinders, MAX_SLOTS.grinders);
  t.fleet = Math.min(t.fleet, MAX_SLOTS.fleet);
  return t;
}
