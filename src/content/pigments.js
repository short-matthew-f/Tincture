// pigments.js — Era 1 pigments and the two free drops (pure data).
// Implements docs/DESIGN.md "The factory › Production chain" (three starting
// sources, hunters unlock more) and "Active play › Matching" (drops of her
// pigments plus white and black). Referenced by id everywhere in state.
// Catalog recipes (src/content/catalog.js) name these ids plus 'white'/'black'.

import { WHITE, BLACK } from '../color.js';

const freeze = (list) => Object.freeze(list.map((p) => Object.freeze(p)));

/** Era 1 pigments. `start` pigments are owned from the first minute; the rest
 *  arrive with hunter hauls. `source` is the id of the station that makes it. */
export const PIGMENTS = freeze([
  { id: 'madder', name: 'Madder Red', hex: '#b8433a', start: true, tier: 'primary', source: 'madder', blurb: 'Dug from the roots of a scrambling vine. Warm, honest red.' },
  { id: 'ochre', name: 'Yellow Ochre', hex: '#d39b2a', start: true, tier: 'primary', source: 'ochre', blurb: 'Golden earth from the pit behind the workshop.' },
  { id: 'woad', name: 'Woad Blue', hex: '#3e6a9e', start: true, tier: 'primary', source: 'woad', blurb: 'Steeped from woad leaves until the vat turns the sky.' },
  { id: 'saffron', name: 'Saffron', hex: '#e8a63b', start: false, tier: 'primary', source: 'saffron', blurb: 'Crocus threads from the meadow. A little goes a long way.' },
  { id: 'indigo', name: 'Indigo', hex: '#2e3f6e', start: false, tier: 'primary', source: 'indigo', blurb: 'Deep blue from terraced leaves, darker than any woad.' },
  { id: 'murex', name: 'Murex', hex: '#6e4a7e', start: false, tier: 'primary', source: 'murex', blurb: 'Sea-snail purple from the coast. Once worth more than gold.' },
  { id: 'lapis', name: 'Lapis', hex: '#2f4fb0', start: false, tier: 'primary', source: 'lapis', blurb: 'Ground from blue stone flecked with gold.' },
  { id: 'cochineal', name: 'Cochineal', hex: '#c0233f', start: false, tier: 'primary', source: 'cochineal', blurb: 'Crimson from tiny jungle beetles on the prickly pear.' },
  { id: 'umber', name: 'Umber', hex: '#6b4a2b', start: false, tier: 'primary', source: 'umber', blurb: 'Brown clay from the quarry, rich with iron.' },
  { id: 'sulfur', name: 'Sulfur', hex: '#d8c83a', start: false, tier: 'primary', source: 'sulfur', blurb: 'Bright crystals from the volcano vents. Mind the smell.' },
  { id: 'bone-black', name: 'Bone Black', hex: '#2b2b2e', start: false, tier: 'primary', source: 'bone-black', blurb: 'Soft charred black, the kindest black for shading.' },
  { id: 'chalk-white', name: 'Chalk White', hex: '#efebe0', start: false, tier: 'primary', source: 'chalk-white', blurb: 'Cliff chalk, washed and sieved. Lifts any color.' },
]);

/** The two free drops always available on the mixing bench. */
export const DROPS = freeze([
  { id: 'white', hex: WHITE, name: 'White' },
  { id: 'black', hex: BLACK, name: 'Black' },
]);

const BY_ID = new Map([...PIGMENTS, ...DROPS].map((p) => [p.id, p]));

/** Pigment (or drop: 'white' | 'black') by id, or undefined. */
export function getPigment(id) {
  return BY_ID.get(id);
}

/** Hex of a pigment or drop id; throws on an unknown id (recipes must be valid). */
export function pigmentHex(id) {
  const p = BY_ID.get(id);
  if (!p) throw new RangeError('pigmentHex: unknown pigment ' + JSON.stringify(id));
  return p.hex;
}

/** The pigments owned from the start. */
export function startPigments() {
  return PIGMENTS.filter((p) => p.start);
}
