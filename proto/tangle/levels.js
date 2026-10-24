// The Tangle Basket: the baskets (pure data). Geometry, colors, solutions
// and stats live in heaps.js, written by gen-levels.mjs (compact: control
// points packed as text, unpacked when heaps.js loads).
//
// A level is built (splines, crossings, snarls) only when something reads its
// geometry: LEVELS holds light records whose id, name, n, slots, board,
// mechanics, solution and stats are ready at once, and whose other fields
// build the level the first time one of them is read. So 109 baskets load as
// fast as one, and the basket list never builds a heap it only shows.
import { HEAPS } from './heaps.js';
import { buildLevel, levelSig, validState, VERSION } from './rules.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = {
  rack: { name: 'A full rack', line: 'Five spools fit on the rack, and this heap has six colors. Finish a spool to make room before starting a new color.' },
  knot: { name: 'Knotted ends', line: 'Two strands knotted end to end come out together, so both need to be free.' },
  weave: { name: 'Woven yarn', line: 'Longer strands loop and weave: over one neighbor, under the next. Look at each crossing to see which lies on top.' },
  pin: { name: 'Pins', line: 'A pinned strand stays put until the strand matching its pin’s glass head is pulled.' },
  snarl: { name: 'Snarls', line: 'Two strands that lie over and under each other are snarled. Tap one to see its partner glow; they come out together once nothing else lies on them.' },
  variegated: { name: 'Two-color yarn', line: 'A two-color strand winds onto two spools, one length to each color.' },
  big: { name: 'A bigger heap', line: 'More strands, and all eight colors. Same rules, more to untangle.' },
  buried: { name: 'Buried colors', line: 'A strand still under others looks undyed gray until you uncover it.' },
  deep: { name: 'A deep heap', line: 'Pinch (or tap Zoom) to look closer, and drag to look around. Double-tap an empty spot, or tap Fit, to see the whole basket again.' },
  rack4: { name: 'A smaller rack', line: 'Only four spools fit on the rack in these baskets.' },
  tuck: { name: 'Tucked ends', line: 'An end tucked under another strand is held there, just like a crossing. Free the strand on top first.' },
  peg: { name: 'Pegs', line: 'A strand looped round a peg stays put until you finish a skein in the color of the peg’s band. Then the peg lifts out.' },
  snarl3: { name: 'Bigger snarls', line: 'Three strands can snarl in a ring, each over the next. Tap one to see all three; they come out together.' },
  rack3: { name: 'A travel rack', line: 'Only three spools fit on this little rack, so finish a color before you start another.' },
};

// Baskets 30 and on: one helper keeps the knobs consistent. The board grows
// with the strand count (about 16.5 strands per 100 x 140), big heaps lie
// deeper and loopier, and `o` remixes the mechanics. Tucks get two more resting
// tips than they need.
const sizeFor = (n) => Math.max(1.15, Math.round(Math.sqrt(n / 16.5) * 100) / 100);
function B(id, name, n, target, o = {}) {
  const big = n >= 36;
  const knobs = { n, len: big ? [75, 110] : [65, 95], size: sizeFor(n), loop: big ? 0.75 : 0.65, colors: 8, slots: 5, target, ...o };
  if (n >= 33 && knobs.depth === undefined) knobs.depth = n >= 39 ? 6 : 5;
  if (knobs.tucks && knobs.tips === undefined) knobs.tips = knobs.tucks + 2;
  return { id, name, knobs };
}
// Random-player clear rates from `a` down to `b` across a chapter (evenly on a log scale).
const ramp = (a, b, k, of = 10) => Math.round(Math.exp(Math.log(a) + ((Math.log(b) - Math.log(a)) * k) / (of - 1)) * 1000) / 1000;

const MORE = [
  // ---- chapter 4: fleece and roving (wool) ----
  ...[
    ['shearing', 'Shearing day', 33, { knots: 2, snarl2: 1 }],
    ['skirting', 'The skirting table', 33, { pins: 2, snarl2: 1 }],
    ['lanolin', 'Lanolin and lavender', 36, { knots: 2, pins: 1, snarl2: 1, tucks: 1 }],
    ['carding', 'Carding batts', 36, { snarl2: 2, loop: 0.8 }],
    ['roving', 'A basket of roving', 39, { knots: 3, snarl2: 1, tucks: 2 }],
    ['drafting', 'Drafting by the fire', 39, { pins: 2, knots: 2, snarl2: 2 }],
    ['plying', 'Two-ply evening', 42, { vari: 3, knots: 2, snarl2: 2, snarl3: 1 }],
    ['worsted', 'Worsted and woollen', 45, { slots: 4, knots: 2, pins: 2, snarl2: 2 }],
    ['fairisle', 'Fair Isle leftovers', 48, { slots: 4, vari: 3, buried: 0.3, snarl2: 2, snarl3: 1, tucks: 2 }],
    ['fleecefair', 'The fleece fair', 51, { slots: 4, knots: 3, pins: 2, pegs: 1, snarl2: 2, snarl3: 1, tucks: 2 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.22, 0.04, k), o)),
  // ---- chapter 5: cotton bolls ----
  ...[
    ['boll', 'Boll season', 33, { vari: 3, snarl2: 1 }],
    ['gin', 'Gin day', 36, { buried: 0.35, snarl2: 1 }],
    ['slub', 'Slubby cotton', 36, { vari: 3, tucks: 2, snarl2: 1 }],
    ['dishcloth', 'Dishcloth yarn', 39, { buried: 0.35, knots: 2, snarl2: 2 }],
    ['crochet', 'Crochet thread', 39, { vari: 3, buried: 0.3, tucks: 2, snarl2: 1 }],
    ['mercer', 'Mercerized shine', 42, { slots: 4, vari: 3, snarl2: 2 }],
    ['twine', 'Kitchen twine', 42, { knots: 3, pins: 1, buried: 0.3, snarl2: 2 }],
    ['quilting', 'Quilting thread', 45, { slots: 4, vari: 3, tucks: 3, snarl2: 2, snarl3: 1 }],
    ['denim', 'Denim scraps', 48, { slots: 4, buried: 0.35, vari: 3, snarl2: 2, tucks: 2 }],
    ['mill', 'The cotton mill', 51, { slots: 4, vari: 3, buried: 0.35, knots: 2, pins: 2, snarl2: 3, snarl3: 1, tucks: 2 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.2, 0.035, k), o)),
  // ---- chapter 6: flax and linen ----
  ...[
    ['retting', 'The retting pond', 33, { pegs: 1, snarl2: 1 }],
    ['scutch', 'Scutching', 36, { tucks: 3, snarl2: 1 }],
    ['hackle', 'Through the hackle', 39, { pegs: 2, tucks: 2, snarl2: 1 }],
    ['tow', 'A tangle of tow', 39, { snarl3: 1, snarl2: 1, tucks: 2 }],
    ['distaff', 'The distaff', 42, { pegs: 2, knots: 2, snarl2: 2 }],
    ['bleach', 'On the bleaching green', 42, { slots: 4, tucks: 3, pegs: 1, snarl2: 1 }],
    ['damask', 'Damask napkins', 45, { slots: 4, snarl3: 1, snarl2: 2, pins: 2 }],
    ['lace', 'Bobbin lace', 48, { pegs: 2, tucks: 3, snarl3: 1, snarl2: 2, vari: 3 }],
    ['sail', 'Sailcloth', 51, { slots: 4, knots: 3, pegs: 2, snarl2: 2, tucks: 2 }],
    ['flaxwheel', 'The flax wheel', 54, { slots: 4, pegs: 2, tucks: 3, snarl2: 3, snarl3: 1, pins: 2, buried: 0.3 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.18, 0.03, k), o)),
  // ---- chapter 7: reeled silk ----
  ...[
    ['mulberry', 'Mulberry leaves', 36, { snarl2: 2, loop: 0.85 }],
    ['cocoon', 'Cocoons', 36, { slots: 4, snarl3: 1, snarl2: 1, loop: 0.85 }],
    ['reeling', 'Reeling', 39, { snarl2: 3, buried: 0.3 }],
    ['noil', 'Silk noil', 42, { snarl3: 1, snarl2: 2, tucks: 2 }],
    ['tussah', 'Tussah', 42, { slots: 4, snarl2: 2, vari: 3 }],
    ['hankies', 'Silk hankies', 45, { slots: 4, snarl3: 2, snarl2: 1, buried: 0.3 }],
    ['throwing', 'The throwster', 48, { slots: 4, snarl2: 3, snarl3: 1, knots: 2 }],
    ['sari', 'Sari silk ribbons', 48, { vari: 3, snarl3: 1, snarl2: 3, tucks: 2, pins: 1 }],
    ['floss', 'Embroidery floss', 51, { slots: 4, buried: 0.35, snarl3: 2, snarl2: 2, pegs: 1 }],
    ['silkroad', 'The silk road', 54, { slots: 4, snarl2: 4, snarl3: 2, knots: 2, pins: 2, tucks: 3, vari: 3 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.16, 0.028, k), o)),
  // ---- chapter 8: alpaca and mohair (the smaller rack throughout) ----
  ...[
    ['huacaya', 'Huacaya', 36, { snarl2: 1, vari: 3 }],
    ['suri', 'Suri locks', 39, { buried: 0.35, snarl2: 1 }],
    ['kid', 'Kid mohair', 39, { pins: 2, snarl2: 2 }],
    ['halo', 'A brushed halo', 42, { buried: 0.35, vari: 3, snarl2: 1, tucks: 2 }],
    ['boucle', 'Bouclé loops', 42, { snarl2: 2, snarl3: 1, loop: 0.85 }],
    ['llama', 'Llama trek', 45, { knots: 2, pins: 2, buried: 0.3, snarl2: 2 }],
    ['cria', 'Cria fleece', 45, { vari: 3, tucks: 3, snarl2: 2, pegs: 1 }],
    ['mohair', 'Mohair curls', 48, { buried: 0.35, snarl2: 3, snarl3: 1, pins: 1 }],
    ['altiplano', 'Altiplano market', 51, { vari: 3, buried: 0.35, knots: 2, snarl2: 2, snarl3: 1, tucks: 2 }],
    ['andes', 'Over the Andes', 54, { vari: 3, buried: 0.35, pins: 2, pegs: 2, snarl2: 3, snarl3: 1, tucks: 3 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.15, 0.025, k), { slots: 4, ...o })),
  // ---- chapter 9: the ropewalk (hemp, jute and sisal) ----
  ...[
    ['hemp', 'Hemp cord', 39, { knots: 3, snarl2: 1 }],
    ['jute', 'Jute sacks', 39, { knots: 3, pegs: 1, snarl2: 1 }],
    ['sisal', 'Sisal', 42, { knots: 2, pins: 2, pegs: 1, snarl2: 2 }],
    ['coir', 'Coir and coconut', 45, { knots: 3, snarl3: 1, snarl2: 2, tucks: 2 }],
    ['macrame', 'Macramé', 45, { slots: 4, knots: 4, snarl2: 2 }],
    ['netting', 'Mending the nets', 48, { knots: 3, pegs: 2, pins: 2, snarl2: 2, tucks: 2 }],
    ['rigging', 'Ship’s rigging', 51, { slots: 4, knots: 3, snarl3: 1, snarl2: 3, pins: 2 }],
    ['bellrope', 'The bell rope', 51, { slots: 4, knots: 3, pegs: 2, vari: 3, snarl2: 2, tucks: 3 }],
    ['hawser', 'Hawser laid', 54, { slots: 4, knots: 4, pins: 2, pegs: 1, snarl2: 3, snarl3: 1, buried: 0.3 }],
    ['ropewalk', 'The ropewalk', 57, { slots: 4, knots: 4, pins: 3, pegs: 2, snarl2: 3, snarl3: 2, tucks: 3, vari: 3 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.14, 0.02, k), o)),
  // ---- chapter 10: cashmere and angora (the travel rack) ----
  ...[
    ['combing', 'Combing the goats', 24, { slots: 3, colors: 5 }],
    ['bunny', 'The angora bunny', 27, { slots: 3, colors: 6, snarl2: 1 }],
    ['qiviut', 'Qiviut', 30, { slots: 3, colors: 6, knots: 2 }],
    ['yak', 'Yak down', 30, { slots: 3, colors: 6, snarl2: 1, pins: 1 }],
    ['vicuna', 'Vicuña', 33, { slots: 3, colors: 7, snarl2: 1, tucks: 2 }],
    ['camel', 'Camel hair', 36, { slots: 4, snarl2: 2, buried: 0.35, vari: 3 }],
    ['possum', 'Possum blend', 36, { slots: 3, colors: 7, snarl2: 1, knots: 2 }],
    ['pashmina', 'Pashmina', 39, { slots: 4, snarl2: 2, snarl3: 1, pins: 2 }],
    ['downy', 'Down and fluff', 42, { slots: 3, colors: 7, snarl2: 2, tucks: 2 }],
    ['luxury', 'The luxury drawer', 45, { slots: 4, pins: 1, buried: 0.35, vari: 3, snarl2: 2, snarl3: 1, pegs: 1, knots: 2 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.2, 0.03, k), o)),
  // ---- chapter 11: the dye pots ----
  ...[
    ['madder', 'The madder bath', 42, { snarl2: 2, knots: 2, pins: 1, tucks: 2 }],
    ['weld', 'Weld yellow', 42, { slots: 4, vari: 3, snarl2: 2, snarl3: 1 }],
    ['woad', 'The woad vat', 45, { buried: 0.35, snarl2: 2, pegs: 1, tucks: 2 }],
    ['logwood', 'Logwood chips', 48, { slots: 4, knots: 3, pins: 2, snarl2: 2, snarl3: 1 }],
    ['cochineal', 'Cochineal', 48, { slots: 4, vari: 3, buried: 0.35, snarl2: 3, tucks: 3 }],
    ['walnut', 'Walnut hulls', 51, { slots: 4, pegs: 2, knots: 2, snarl2: 3, snarl3: 1, pins: 2 }],
    ['onion', 'Onion skins', 51, { slots: 4, vari: 3, buried: 0.35, snarl2: 3, snarl3: 2, tucks: 3, pegs: 1 }],
    ['mordant', 'Mordant day', 54, { slots: 4, knots: 3, pins: 2, pegs: 2, snarl2: 3, snarl3: 1, tucks: 3 }],
    ['exhaust', 'Exhaust baths', 54, { slots: 4, vari: 3, buried: 0.35, knots: 2, pins: 2, snarl2: 4, snarl3: 2, tucks: 3 }],
    ['rainbow', 'Every color at once', 57, { slots: 4, knots: 3, pins: 3, pegs: 2, vari: 3, buried: 0.35, snarl2: 4, snarl3: 2, tucks: 4 }],
  ].map(([id, name, n, o], k) => B(id, name, n, ramp(0.1, 0.015, k), o)),
];

// Generation knobs (see gen-levels.mjs): n strands; len range (board units);
// size: the board is size times 100 x 140; loop: how loopy (0 to 1); colors
// in play; slots on the rack; knots; pins; pegs; vari (two-color strands);
// buried (share of covered strands shown gray); snarl2 / snarl3 (snarls of two
// and three strands); tucks (tips tucked under, from `tips` resting tips);
// depth (wanted layers); target random-player clear rate.
// intro: a card for something that isn't a rule change.
export const LEVEL_DEFS = [
  // ---- learning the basket ----
  { id: 'first', name: 'First tangle', knobs: { n: 6, len: [70, 95], colors: 2, slots: 5, depth: 2, target: 1 } },
  { id: 'scraps', name: 'A handful of scraps', knobs: { n: 9, len: [65, 90], colors: 3, slots: 5, depth: 2, target: 1 } },
  { id: 'leftovers', name: 'The leftovers bag', knobs: { n: 15, len: [55, 80], colors: 5, slots: 5, depth: 3, target: 1 } },
  { id: 'plan', name: 'Six colors, five spools', intro: 'rack', knobs: { n: 18, len: [55, 80], colors: 6, slots: 5, target: 0.75 } },
  { id: 'cat', name: 'The cat got into it', knobs: { n: 21, len: [50, 75], colors: 7, slots: 5, target: 0.55 } },
  // ---- knots and weaving ----
  { id: 'joins', name: 'Joined ends', knobs: { n: 21, len: [55, 80], colors: 6, slots: 5, knots: 2, target: 0.6 } },
  { id: 'magic', name: 'Magic knots', intro: 'weave', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.8, colors: 7, slots: 5, knots: 3, target: 0.4 } },
  // ---- pins ----
  { id: 'pinned', name: 'Pinned to the board', knobs: { n: 21, len: [65, 95], size: 1.05, loop: 0.5, colors: 7, slots: 5, pins: 2, target: 0.5 } },
  { id: 'blocking', name: 'Blocking day', knobs: { n: 24, len: [65, 95], size: 1.1, loop: 0.5, colors: 7, slots: 5, pins: 3, knots: 2, target: 0.35 } },
  // ---- snarls ----
  { id: 'snarl', name: 'Interlocked', knobs: { n: 24, len: [70, 100], size: 1.15, loop: 0.7, colors: 7, slots: 5, snarl2: 1, target: 0.4 } },
  // ---- two-color yarn ----
  { id: 'stripes', name: 'Self-striping', knobs: { n: 21, len: [65, 95], size: 1.1, loop: 0.6, colors: 7, slots: 5, vari: 3, snarl2: 1, target: 0.45 } },
  { id: 'festival', name: 'After the fiber festival', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 8, slots: 5, vari: 3, knots: 2, pins: 1, snarl2: 1, target: 0.3 } },
  // ---- a bigger heap ----
  { id: 'bottom', name: 'The bottom of the bag', intro: 'big', knobs: { n: 30, len: [60, 90], size: 1.2, loop: 0.6, colors: 8, slots: 5, snarl2: 1, target: 0.3 } },
  // ---- buried colors ----
  { id: 'thrift', name: 'The thrift-store bag', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 7, slots: 5, buried: 0.4, snarl2: 1, target: 0.35 } },
  { id: 'attic', name: 'Grandma’s attic', knobs: { n: 27, len: [65, 95], size: 1.2, loop: 0.6, colors: 8, slots: 5, buried: 0.4, knots: 2, vari: 3, snarl2: 1, target: 0.25 } },
  // ---- a deep heap ----
  { id: 'deep', name: 'The deep end', knobs: { n: 39, len: [80, 115], size: 1.5, loop: 0.7, colors: 8, slots: 5, snarl2: 2, depth: 6, target: 0.25 } },
  // ---- a smaller rack ----
  { id: 'small', name: 'A smaller rack', knobs: { n: 18, len: [60, 90], size: 1.05, loop: 0.5, colors: 6, slots: 4, snarl2: 1, target: 0.35 } },
  { id: 'swap', name: 'Swap meet', knobs: { n: 21, len: [60, 90], size: 1.1, loop: 0.5, colors: 6, slots: 4, knots: 2, pins: 1, snarl2: 1, target: 0.25 } },
  { id: 'destash', name: 'Destash day', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 7, slots: 4, vari: 3, buried: 0.3, snarl2: 1, target: 0.2 } },
  // ---- tucks, pegs and rings ----
  { id: 'tucked', name: 'Tucked in', knobs: { n: 36, len: [75, 110], size: 1.45, loop: 0.7, colors: 8, slots: 5, tucks: 3, tips: 5, snarl2: 1, depth: 5, target: 0.25 } },
  { id: 'pegboard', name: 'The pegboard', knobs: { n: 36, len: [75, 110], size: 1.45, loop: 0.7, colors: 8, slots: 5, pegs: 2, tucks: 2, tips: 4, snarl2: 1, depth: 5, target: 0.2 } },
  { id: 'ring', name: 'Ring around', knobs: { n: 39, len: [75, 110], size: 1.5, loop: 0.7, colors: 8, slots: 5, snarl3: 1, snarl2: 1, tucks: 1, tips: 3, depth: 6, target: 0.2 } },
  // ---- the whole stash ----
  { id: 'studio', name: 'The studio floor', knobs: { n: 42, len: [75, 110], size: 1.55, loop: 0.7, colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, snarl2: 2, tucks: 2, tips: 4, depth: 6, target: 0.15 } },
  { id: 'guild', name: 'Guild night', knobs: { n: 45, len: [75, 110], size: 1.6, loop: 0.75, colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, buried: 0.3, snarl2: 2, snarl3: 1, tucks: 2, tips: 4, depth: 6, target: 0.1 } },
  { id: 'stash', name: 'The whole stash', knobs: { n: 48, len: [75, 110], size: 1.65, loop: 0.75, colors: 8, slots: 4, knots: 3, pins: 2, pegs: 1, vari: 3, buried: 0.35, snarl2: 2, snarl3: 1, tucks: 2, tips: 4, depth: 6, target: 0.08 } },
  // ---- truly gnarly ----
  { id: 'felted', name: 'Felted in the wash', knobs: { n: 48, len: [75, 108], size: 1.7, loop: 0.8, colors: 8, slots: 4, knots: 2, pins: 2, pegs: 1, snarl2: 3, snarl3: 1, tucks: 3, tips: 5, depth: 6, target: 0.06 } },
  { id: 'moths', name: 'Moths in the cupboard', knobs: { n: 51, len: [75, 106], size: 1.75, loop: 0.8, colors: 8, slots: 4, knots: 2, pins: 2, pegs: 2, vari: 3, buried: 0.35, snarl2: 3, snarl3: 1, tucks: 3, tips: 5, depth: 6, target: 0.05 } },
  { id: 'nest', name: 'The rat’s nest', knobs: { n: 54, len: [75, 105], size: 1.82, loop: 0.85, colors: 8, slots: 4, knots: 3, pins: 2, pegs: 2, snarl2: 3, snarl3: 2, tucks: 3, tips: 5, depth: 6, target: 0.04 } },
  { id: 'everything', name: 'Everything at once', knobs: { n: 57, len: [75, 105], size: 1.9, loop: 0.85, colors: 8, slots: 4, knots: 3, pins: 3, pegs: 2, vari: 3, buried: 0.35, snarl2: 4, snarl3: 2, tucks: 4, tips: 6, depth: 6, target: 0.03 } },
  // ---- baskets 30 to 109: eight more chapters, each with a fiber of its own ----
  ...MORE,
];

// Chapters of about ten baskets, each named for a fiber (or where yarn gets
// to). Within a chapter the baskets get harder; each chapter starts a little
// easier than the last one ended, then climbs higher.
export const CHAPTERS = [
  { id: 'odds', name: 'Odds and ends', fiber: 'scrap yarn', from: 0 },
  { id: 'festival', name: 'The fiber festival', fiber: 'festival finds', from: 10 },
  { id: 'guild', name: 'Guild night', fiber: 'the guild’s stash', from: 20 },
  { id: 'wool', name: 'Fleece and roving', fiber: 'wool', from: 29 },
  { id: 'cotton', name: 'Cotton bolls', fiber: 'cotton', from: 39 },
  { id: 'linen', name: 'Flax and linen', fiber: 'linen', from: 49 },
  { id: 'silk', name: 'Reeled silk', fiber: 'silk', from: 59 },
  { id: 'alpaca', name: 'Alpaca and mohair', fiber: 'alpaca and mohair', from: 69 },
  { id: 'rope', name: 'The ropewalk', fiber: 'hemp, jute and sisal', from: 79 },
  { id: 'cashmere', name: 'Cashmere and angora', fiber: 'cashmere and angora', from: 89 },
  { id: 'dyepots', name: 'The dye pots', fiber: 'every dye on the shelf', from: 99 },
];
// The basket list's headings (the prototype's first list had smaller bands; chapters replace them).
export const BANDS = CHAPTERS;
/** chapterOf(i) -> the chapter basket i belongs to. */
export const chapterOf = (i) => CHAPTERS.reduce((a, c) => (i >= c.from ? c : a), CHAPTERS[0]);

// Ready-to-play levels: geometry + colors + a known solution (verified by the tests).
// Built on first read of any geometry field (see the top of this file).
const LAZY = ['strands', 'poly', 'cum', 'grids', 'boxes', 'cross', 'crossOf', 'over', 'under', 'snarls', 'snarlOf', 'group', 'partner',
  'pinBy', 'pinAt', 'pegC', 'pegs', 'colors', 'units', 'knots', 'pins', 'flips', 'tucks', 'sig'];
function lazyLevel(d, h) {
  const mech = [...(d.intro ? [d.intro] : []), ...(h.mech || [])];
  const L = {
    id: d.id, name: d.name, slots: h.slots, board: { w: h.board[0], h: h.board[1] }, n: h.stats.strands,
    solution: h.solution, stats: h.stats, mechanics: [...new Set(mech)],
  };
  const build = () => {
    const B = buildLevel({ id: d.id, name: d.name, slots: h.slots, board: h.board, strands: h.strands, knots: h.knots, pins: h.pins, pegs: h.pegs, flips: h.flips });
    B.sig = levelSig(B);
    for (const k of LAZY) Object.defineProperty(L, k, { value: B[k], writable: true, configurable: true, enumerable: true });
  };
  for (const k of LAZY) Object.defineProperty(L, k, { get() { build(); return L[k]; }, configurable: true, enumerable: true });
  return L;
}
export const LEVELS = LEVEL_DEFS.filter((d) => HEAPS[d.id]).map((d) => lazyLevel(d, HEAPS[d.id]));
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
export const levelById = (id) => BY_ID.get(id) || null;

// ---------- the save ----------
// What a save may hold: { v: 1, cur, done: { id: true }, glyphs, sound, seenHow,
// seenIntro: { mechanic: true }, game: { level, sig, state, past } }.
// readSave(raw) -> { data, reset } turns whatever was stored into clean data.
// Progress from an older version carries over: ticks and seen cards stay, and
// a basket in progress is kept only if that basket is still exactly the same
// (its signature); otherwise `reset` names it, so the page can say it was
// rewound and starts fresh.
export function readSave(raw) {
  const data = { v: 1, cur: LEVELS[0].id, done: {}, glyphs: false, sound: false, seenHow: false, seenIntro: {}, game: null };
  let reset = null;
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return { data, reset };
  if (raw.done && typeof raw.done === 'object') for (const id of Object.keys(raw.done)) if (levelById(id) && raw.done[id]) data.done[id] = true;
  data.cur = typeof raw.cur === 'string' && levelById(raw.cur) ? raw.cur : LEVELS[0].id;
  data.glyphs = !!raw.glyphs; data.sound = !!raw.sound; data.seenHow = !!raw.seenHow;
  if (raw.seenIntro && typeof raw.seenIntro === 'object') for (const k of Object.keys(raw.seenIntro)) if (MECHANICS[k] && raw.seenIntro[k]) data.seenIntro[k] = true;
  const g = raw.game;
  if (g && typeof g === 'object' && typeof g.level === 'string') {
    const L = levelById(g.level);
    if (L && g.sig === L.sig && validState(L, g.state) && Array.isArray(g.past)) {
      data.game = { level: L.id, sig: L.sig, state: g.state, past: g.past.filter((s) => validState(L, s)) };
    } else if (L && g.state && Array.isArray(g.state.out) && g.state.out.some(Boolean) && g.state.v === VERSION) reset = L.id;
  }
  return { data, reset };
}
