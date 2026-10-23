// The Tangle Basket: the twenty baskets (pure data). Geometry, colors,
// solutions and stats live in heaps.js, written by gen-levels.mjs.
import { HEAPS } from './heaps.js';
import { buildLevel, mechanicsOf, levelSig } from './rules.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = {
  rack: { name: 'A full rack', line: 'Five spools fit on the rack, and this heap has six colors. Finish a spool to make room before starting a new color.' },
  knot: { name: 'Knotted ends', line: 'Two strands knotted end to end come out together, so both need to be free.' },
  pin: { name: 'Pins', line: 'A pinned strand stays put until the strand matching its pin’s glass head is pulled.' },
  variegated: { name: 'Two-color yarn', line: 'A two-color strand winds onto two spools, one length to each color.' },
  big: { name: 'A bigger heap', line: 'More strands, shorter ones, and all eight colors. Same rules, more to untangle.' },
  buried: { name: 'Buried colors', line: 'A strand still under others looks undyed gray until you uncover it.' },
  rack4: { name: 'A smaller rack', line: 'Only four spools fit on the rack in these baskets.' },
};

// Generation knobs (see gen-levels.mjs): n strands; len range (board units);
// colors in play; slots on the rack; knots; pins; vari (two-color strands);
// buried (share of covered strands shown gray); target random-player clear rate.
// intro: a card for something that isn't a rule change.
export const LEVEL_DEFS = [
  // ---- learning the basket ----
  { id: 'first', name: 'First tangle', knobs: { n: 6, len: [68, 96], colors: 2, slots: 5, target: 1 } },
  { id: 'scraps', name: 'A handful of scraps', knobs: { n: 9, len: [60, 88], colors: 3, slots: 5, target: 1 } },
  { id: 'leftovers', name: 'The leftovers bag', knobs: { n: 15, len: [52, 76], colors: 5, slots: 5, target: 1 } },
  { id: 'plan', name: 'Six colors, five spools', intro: 'rack', knobs: { n: 18, len: [46, 70], colors: 6, slots: 5, target: 0.75 } },
  { id: 'cat', name: 'The cat got into it', knobs: { n: 21, len: [44, 66], colors: 7, slots: 5, target: 0.55 } },
  // ---- knots ----
  { id: 'joins', name: 'Joined ends', knobs: { n: 21, len: [44, 66], colors: 6, slots: 5, knots: 2, target: 0.6 } },
  { id: 'magic', name: 'Magic knots', knobs: { n: 24, len: [40, 62], colors: 7, slots: 5, knots: 3, target: 0.4 } },
  // ---- pins ----
  { id: 'pinned', name: 'Pinned to the board', knobs: { n: 21, len: [44, 66], colors: 7, slots: 5, pins: 2, target: 0.5 } },
  { id: 'blocking', name: 'Blocking day', knobs: { n: 24, len: [40, 62], colors: 7, slots: 5, pins: 3, knots: 2, target: 0.35 } },
  // ---- two-color yarn ----
  { id: 'stripes', name: 'Self-striping', knobs: { n: 21, len: [44, 66], colors: 7, slots: 5, vari: 3, target: 0.45 } },
  { id: 'festival', name: 'After the fiber festival', knobs: { n: 24, len: [40, 62], colors: 8, slots: 5, vari: 3, knots: 2, pins: 1, target: 0.3 } },
  // ---- a bigger heap ----
  { id: 'bottom', name: 'The bottom of the bag', intro: 'big', knobs: { n: 27, len: [38, 56], colors: 8, slots: 5, target: 0.3 } },
  // ---- buried colors ----
  { id: 'thrift', name: 'The thrift-store bag', knobs: { n: 24, len: [40, 62], colors: 7, slots: 5, buried: 0.4, target: 0.35 } },
  { id: 'attic', name: 'Grandma’s attic', knobs: { n: 27, len: [38, 56], colors: 8, slots: 5, buried: 0.4, knots: 2, vari: 3, target: 0.25 } },
  // ---- a smaller rack ----
  { id: 'small', name: 'A smaller rack', knobs: { n: 18, len: [46, 70], colors: 6, slots: 4, target: 0.35 } },
  { id: 'swap', name: 'Swap meet', knobs: { n: 21, len: [44, 66], colors: 6, slots: 4, knots: 2, pins: 1, target: 0.25 } },
  { id: 'destash', name: 'Destash day', knobs: { n: 24, len: [40, 62], colors: 7, slots: 4, vari: 3, buried: 0.3, target: 0.2 } },
  // ---- the whole stash ----
  { id: 'studio', name: 'The studio floor', knobs: { n: 27, len: [38, 56], colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, target: 0.15 } },
  { id: 'guild', name: 'Guild night', knobs: { n: 30, len: [34, 52], colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, buried: 0.3, target: 0.1 } },
  { id: 'stash', name: 'The whole stash', knobs: { n: 33, len: [34, 50], colors: 8, slots: 4, knots: 3, pins: 2, vari: 3, buried: 0.35, target: 0.08 } },
];

export const BANDS = [
  { name: 'Learning the basket', from: 0 },
  { name: 'Knotted ends', from: 5 },
  { name: 'Pins', from: 7 },
  { name: 'Two-color yarn', from: 9 },
  { name: 'A bigger heap', from: 11 },
  { name: 'Buried colors', from: 12 },
  { name: 'A smaller rack', from: 14 },
  { name: 'The whole stash', from: 17 },
];

// Ready-to-play levels: geometry + colors + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HEAPS[d.id]).map((d) => {
  const h = HEAPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, slots: h.slots, strands: h.strands, knots: h.knots, pins: h.pins });
  const mech = mechanicsOf(L);
  if (d.intro) mech.unshift(d.intro);
  return { ...L, solution: h.solution, stats: h.stats, sig: levelSig(L), mechanics: mech };
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
