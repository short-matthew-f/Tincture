// proto/skeins/gen-levels.mjs — authoring tool for Skein Stacks' levels.
// Writes proto/skeins/levels.js and src/puzzles/skeins-levels.js (the same
// text) from the design table below: board silhouettes, chapters, the newer
// mechanics' intro cards and every level. Marks given as a count (snarls,
// felted stacks, spindles, knots) are placed by farthest-point spread from the
// board's middle, so the data file holds plain [col,row] lists. A basket of
// `trays: 'auto'` is measured with the planning bot: the most trays it used on
// eight seeds, plus three (gentle: a ribbon, never a fail).
//
// Run: node proto/skeins/gen-levels.mjs        (then node proto/skeins/survey.mjs)
// The first 12 levels are the playtested prototype's and must never change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = [path.join(HERE, 'levels.js'), path.join(ROOT, 'src', 'puzzles', 'skeins-levels.js')];

// ---------------------------------------------------------------------------
// Boards: '.' peg, '#' knot, ' ' nothing. Odd rows sit half a peg right.
// ---------------------------------------------------------------------------
const SHAPES = {
  // the prototype's five
  hex19: [' ...', '....', '.....', '....', ' ...'],
  wide24: [' ....', '.....', '......', '.....', ' ....'],
  rect25: ['.....', '.....', '.....', '.....', '.....'],
  rect30: ['.....', '.....', '.....', '.....', '.....', '.....'],
  big29: [' .....', '......', '.......', '......', ' .....'],
  // plain tables
  hex37: ['  ....', ' .....', ' ......', '.......', ' ......', ' .....', '  ....'],
  round31: ['  ..', '.....', '......', '.....', '......', '.....', '  ..'],
  rect36: ['......', '......', '......', '......', '......', '......'],
  rect40: ['.......', '......', '.......', '......', '.......', '......'],
  diamond25: ['   .', '  ..', '  ...', ' ....', ' .....', ' ....', '  ...', '  ..', '   .'],
  // silhouettes
  heart35: [' .. ..', '......', '.......', '......', ' .....', ' ....', '  ...'],
  heart23: ['.. ..', '....', '.....', '....', ' ...', ' ..', '  .'],
  heart37: [' .. ..', '......', '.......', '......', ' .....', ' ....', '  ...', '  ..'],
  star37: ['   .', '  ..', '.......', '......', ' .....', '......', '.......', '  ..', '   .'],
  star20: ['  .', ' ..', '.....', '....', '.....', ' ..', '  .'],
  flower25: ['  .  .', '  ...', '  ....', '.......', '  ....', '  ...', '  .  .'],
  sheep: [' . . .', '.......', '........', '.......', '......', ' .  .'],
  mitten: ['   ...', '  ....', '.  ....', '. ....', '......', ' .....', '  ....', ' .....', ' ....'],
  teapot: ['   ..', '  ...', '.  ....', '........', ' .......', ' ......', '  ....'],
  spool30: ['......', ' ....', '  ...', ' ....', '......', '.......'],
  leaf: ['    ..', '  ....', ' .....', '......', '.....', '....', '...', '..'],
  bell: ['   .', '  ..', '  ...', ' ....', ' .....', '......', '.......', '  ..'],
  tree25: ['   .', '  ..', '  ...', ' ....', '  ...', ' ....', ' .....', '  ..', '   .'],
  cup: ['......', '.......', '......', '.......', ' .....', ' ....'],
  stall: ['   .', '  ...', ' .....', '.......', '. ... .', '.......', '.  . .'],
  sock: ['  ...', '  ..', '  ...', '  ..', '  ...', ' ....', '......', '.....'],
  hat: ['   .', '  ..', '  ...', ' ....', ' .....', '......', '.......', '......'],
  moon: ['  ...', ' ...', ' ..', '...', ' ..', ' ...', '  ...'],
  bowl30: ['........', '.......', ' ......', ' .....', '  ....'],
  skein27: [' ..  ..', '... ...', '.......', '... ...', ' ..  ..'],
  butterfly: ['..   ..', '......', ' .....', '  ..', ' .....', '......', '..   ..'],
};

// ---------------------------------------------------------------------------
// Chapters (about ten levels each; a small reset at each start) and the
// newer mechanics' intro cards (shown the first time a level uses one).
// ---------------------------------------------------------------------------
const CHAPTERS = [
  { id: 'dye-shed', name: 'The dye shed', blurb: 'Your first skeins, one color at a time.', levels: 12 },
  { id: 'sheep', name: 'Sheep to shawl', blurb: 'Fresh fleece, and a few snarls to work loose.', levels: 10 },
  { id: 'dye-day', name: 'Dye day', blurb: 'Pots on the boil and orders on the line.', levels: 10 },
  { id: 'market', name: 'Market stall', blurb: 'A basket of trays and customers to please.', levels: 10 },
  { id: 'winter', name: 'Winter knitting', blurb: 'Mittens, hats and felted stacks by the fire.', levels: 10 },
  { id: 'mill', name: 'The mill', blurb: 'Spindle pegs that twist a hank from just eight.', levels: 10 },
  { id: 'tea', name: 'Tea and patterns', blurb: 'A peek at the next tray while the kettle sings.', levels: 10 },
  { id: 'love', name: 'Love knots', blurb: 'Hearts to fill and knots to untangle.', levels: 10 },
  { id: 'fair', name: 'Harvest fair', blurb: 'Everything you know, shown off at the fair.', levels: 10 },
  { id: 'night', name: 'Starry nights', blurb: 'Stars and moons for the long evenings.', levels: 10 },
  { id: 'shawl', name: 'The great shawl', blurb: 'Every skill, one last generous shawl.', levels: 10 },
];

const MECHANICS = {
  snarl: { name: 'Snarls', line: 'A snarled peg is tangled shut. Tie a hank on a peg beside it and the snarl comes loose, so you have one more peg.' },
  order: { name: 'Orders', line: 'A customer asks for set colors. Wind those hanks and the order is filled. Any other hanks still pay.' },
  basket: { name: 'A basket of trays', line: 'This level comes with a basket of trays. Finish before it is empty for a ribbon. If it runs out, trays simply keep coming.' },
  felt: { name: 'Felted stacks', line: 'Some stacks start felted fast. They rest until a hank is tied beside them, then they wake and slide like any other.' },
  spindle: { name: 'Spindle pegs', line: 'A spindle twists just 8 of one color into a hank. When runs tie, the spindle gets the yarn.' },
  preview: { name: 'A peek at the next tray', line: 'The next tray waits under this one, so you can plan a little ahead.' },
  untie: { name: 'Untangle it all', line: 'This one finishes when every snarl is loose and every felted stack is awake, as well as the hanks.' },
};

// ---------------------------------------------------------------------------
// The levels. The first 12 are the prototype's, verbatim. The rest:
//   [name, shape, {k colors, h hanks, H maxH, m mono, t tri, p pull (fixed;
//    otherwise set by THE RAMP below; tier picks a preset there),
//    kn knots (count or [[col,row]]), sn snarls, fe felted stacks, sp spindles,
//    pv preview, cols {color: n}, order {color: n}, who, trays 'auto'|n, untie,
//    title (with {k} for her name of color k)}]
// ---------------------------------------------------------------------------
const ORIGINAL = [
  { id: 'l1', name: 'First skeins', shape: 'hex19', colors: 3, goal: { hanks: 6 }, maxH: 4, mono: 0.55, tri: 0 },
  { id: 'l2', name: 'A basket of three', shape: 'hex19', colors: 3, goal: { hanks: 10 }, maxH: 5, mono: 0.45, tri: 0.05 },
  { id: 'l3', name: 'Walnut joins', title: '{3} joins', shape: 'wide24', colors: 4, goal: { hanks: 10 }, maxH: 5, mono: 0.4, tri: 0.1 },
  { id: 'l4', name: 'Square shelf', shape: 'rect25', colors: 4, goal: { hanks: 12 }, maxH: 5, mono: 0.3, tri: 0.15 },
  { id: 'l5', name: 'Knots in the wood', shape: 'wide24', knots: [[2, 2], [3, 2]], colors: 4, goal: { hanks: 12, colors: { 2: 3 } }, maxH: 5, mono: 0.3, tri: 0.2, pull: 1 },
  { id: 'l6', name: 'Cochineal arrives', title: '{4} arrives', shape: 'rect30', colors: 5, goal: { hanks: 15 }, maxH: 5, mono: 0.25, tri: 0.25, pull: 1 },
  { id: 'l7', name: 'Pink for a shawl', title: '{4} for a shawl', shape: 'big29', knots: [[3, 0], [0, 2], [6, 2]], colors: 5, goal: { hanks: 15, colors: { 4: 4 } }, maxH: 6, mono: 0.2, tri: 0.3, pull: 1 },
  { id: 'l8', name: 'Long table', shape: 'rect30', knots: [[1, 2], [3, 3]], colors: 5, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 1 },
  { id: 'l9', name: 'Nettle green', title: '{5}', shape: 'big29', colors: 6, goal: { hanks: 18 }, maxH: 6, mono: 0.15, tri: 0.35, pull: 0.5 },
  { id: 'l10', name: 'A sweater\'s worth', shape: 'rect30', knots: [[2, 1], [2, 4]], colors: 6, goal: { hanks: 20, colors: { 5: 3, 3: 3 } }, maxH: 6, mono: 0.2, tri: 0.35, pull: 1 },
  { id: 'l11', name: 'Market day', shape: 'big29', knots: [[1, 1], [5, 3]], colors: 6, goal: { hanks: 22 }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
  { id: 'l12', name: 'The whole dye shed', shape: 'big29', colors: 6, goal: { hanks: 25, colors: { 0: 5, 2: 5 } }, maxH: 6, mono: 0.1, tri: 0.4, pull: 1 },
];

const DESIGN = [
  // ---- 2. Sheep to shawl: snarls ----
  ['Shearing day', 'sheep', { k: 4, h: 12, H: 5 }],
  ['Snarls in the fleece', 'hex37', { k: 4, h: 12, H: 5, sn: 3 }],
  ['Carding', 'round31', { k: 4, h: 14, H: 5, sn: 4 }],
  ['Washing the wool', 'rect36', { k: 5, h: 15, H: 5, sn: 3, kn: 2 }],
  ['The spinning wheel', 'hex37', { k: 5, h: 16, H: 6, kn: [[3, 3]], sn: 4 }],
  ['Lambs in the field', 'sheep', { k: 5, h: 17, H: 6, sn: 4 }],
  ['Plying', 'rect36', { k: 5, h: 18, H: 6, sn: 4, cols: { 1: 4 }, title: 'Plying {1}' }],
  ['The ram', 'sheep', { k: 6, h: 18, H: 6, sn: 3 }],
  ['Blocking the shawl', 'rect40', { k: 6, h: 21, H: 6, sn: 5, kn: 2 }],
  ['Sheep to shawl', 'sheep', { k: 6, h: 22, H: 6, sn: 4, cols: { 0: 4, 5: 4 } }],
  // ---- 3. Dye day: orders ----
  ['Madder roots', 'flower25', { k: 4, h: 10, H: 5, title: '{0} roots' }],
  ['An order for the weaver', 'leaf', { k: 4, order: { 0: 3, 2: 2 }, who: 'the weaver', H: 5 }],
  ['Weld in bloom', 'flower25', { k: 4, h: 12, H: 5, cols: { 1: 4 }, title: '{1} in bloom' }],
  ['The indigo vat', 'bowl30', { k: 5, order: { 2: 5, 3: 3 }, who: 'the dyer next door', H: 5, title: 'The {2} vat' }],
  ['Leaf print', 'leaf', { k: 5, h: 15, H: 6, sn: 3 }],
  ['Marigold heads', 'flower25', { k: 5, order: { 1: 4, 4: 3, 0: 2 }, who: 'the quilter', H: 6, kn: [[3, 3]] }],
  ['Mordant morning', 'bowl30', { k: 5, h: 18, H: 6, sn: 3 }],
  ['Rainbow line', 'rect40', { k: 6, order: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, who: 'the school', H: 6, kn: 2 }],
  ['Flowers in the pot', 'flower25', { k: 6, h: 18, H: 6, cols: { 4: 4 }, tier: 3 }],
  ['Hung out to dry', 'rect40', { k: 6, order: { 5: 5, 2: 4, 0: 4, 3: 3 }, who: 'the mill shop', H: 6, sn: 3 }],
  // ---- 4. Market stall: the basket ----
  ['Setting up', 'stall', { k: 4, h: 12, H: 5 }],
  ['A basket of trays', 'bowl30', { k: 4, h: 12, H: 5, trays: 'auto' }],
  ['First customer', 'stall', { k: 4, order: { 2: 4, 1: 3 }, who: 'a farmer\'s wife', H: 5, trays: 'auto' }],
  ['Bartering', 'cup', { k: 5, h: 15, H: 5, trays: 'auto' }],
  ['Ribbon stall', 'stall', { k: 5, h: 15, H: 6, sn: 3, trays: 'auto' }],
  ['Market crowd', 'rect40', { k: 5, h: 18, H: 6, kn: 3 }],
  ['Rainy market', 'cup', { k: 6, h: 17, H: 6, trays: 'auto' }],
  ['Bulk order', 'bowl30', { k: 6, order: { 3: 6, 0: 5, 4: 4 }, who: 'a tailor', H: 6, trays: 'auto' }],
  ['Sold out', 'stall', { k: 6, h: 18, H: 6, sn: 3 }],
  ['Packing up', 'rect40', { k: 6, h: 22, H: 6, sn: 4, trays: 'auto' }],
  // ---- 5. Winter knitting: felted stacks ----
  ['First frost', 'star37', { k: 4, h: 12, H: 5 }],
  ['Felted mittens', 'mitten', { k: 4, h: 12, H: 5, fe: 3 }],
  ['Bobble hat', 'hat', { k: 4, h: 14, H: 5, fe: 4 }],
  ['Stocking', 'sock', { k: 4, h: 12, H: 5, fe: 3 }],
  ['Snowflake', 'star37', { k: 5, h: 16, H: 6, kn: [[3, 4]], fe: 4 }],
  ['By the fire', 'hex37', { k: 5, h: 17, H: 6, fe: 4, sn: 2 }],
  ['Fir tree', 'tree25', { k: 5, h: 13, H: 6, fe: 3 }],
  ['Cable knit', 'mitten', { k: 6, order: { 0: 4, 5: 4, 2: 3 }, who: 'Grandma', H: 6, fe: 5 }],
  ['Long nights', 'hat', { k: 6, h: 19, H: 6, fe: 4, trays: 'auto' }],
  ['Midwinter', 'star37', { k: 6, h: 22, H: 6, fe: 5, sn: 2 }],
  // ---- 6. The mill: spindle pegs ----
  ['Down to the mill', 'spool30', { k: 4, h: 12, H: 5 }],
  ['The great spindle', 'hex37', { k: 4, h: 14, H: 5, sp: 1 }],
  ['Water wheel', 'round31', { k: 5, h: 15, H: 5, sp: 2, kn: [[2, 3]] }],
  ['Bobbins', 'spool30', { k: 5, h: 16, H: 6, sp: 2 }],
  ['Twisting room', 'skein27', { k: 5, h: 16, H: 6, sp: 2, sn: 2 }],
  ['Carding engine', 'rect40', { k: 5, h: 19, H: 6, sp: 2, fe: 3 }],
  ['Mill race', 'skein27', { k: 6, h: 17, H: 6, sp: 1, sn: 2, tier: 2 }],
  ['Spool of thread', 'spool30', { k: 6, order: { 1: 5, 3: 4, 4: 4 }, who: 'the haberdasher', H: 6, sp: 2 }],
  ['Night shift', 'hex37', { k: 6, h: 22, H: 6, sp: 2, sn: 3, trays: 'auto' }],
  ['The mill bell', 'bell', { k: 6, h: 22, H: 6, sp: 2, fe: 3 }],
  // ---- 7. Tea and patterns: a peek at the next tray ----
  ['Kettle on', 'teapot', { k: 4, h: 12, H: 5 }],
  ['A peek at the pattern', 'cup', { k: 5, h: 14, H: 5, pv: true }],
  ['Tea cosy', 'teapot', { k: 5, h: 15, H: 6, pv: true, fe: 3 }],
  ['Cup and saucer', 'cup', { k: 5, order: { 4: 5, 1: 4 }, who: 'the tea room', H: 6, pv: true, sn: 2 }],
  ['Button box', 'round31', { k: 5, h: 15, H: 6, pv: true, kn: [[2, 2], [3, 2], [2, 4], [3, 4]] }],
  ['Pattern book', 'rect36', { k: 6, h: 18, H: 6, pv: true, sp: 2 }],
  ['Biscuit tin', 'rect40', { k: 6, h: 20, H: 6, pv: true, sn: 4 }],
  ['Butterfly stitch', 'butterfly', { k: 6, h: 18, H: 6, pv: true, fe: 3 }],
  ['Second pot', 'teapot', { k: 6, h: 21, H: 6, pv: true, sn: 3 }],
  ['Tea party', 'cup', { k: 6, order: { 0: 5, 2: 4, 4: 4, 5: 3 }, who: 'the vicarage', H: 6, pv: true, trays: 'auto' }],
  // ---- 8. Love knots: untangle goals ----
  ['Sweetheart', 'heart35', { k: 4, h: 12, H: 5 }],
  ['Love knots', 'heart35', { k: 4, h: 10, H: 5, m: 0.35, t: 0.12, p: 1.5, sn: 4, untie: true }],
  ['Hearts and flowers', 'flower25', { k: 5, h: 12, H: 5, m: 0.3, t: 0.15, p: 1.2, fe: 3, untie: true }],
  ['Little heart', 'heart23', { k: 4, h: 11, H: 5 }],
  ['Valentine', 'heart37', { k: 5, order: { 4: 5, 0: 5 }, who: 'a sweetheart', H: 6, sn: 3 }],
  ['Ribbon and lace', 'butterfly', { k: 5, h: 15, H: 6, m: 0.2, t: 0.3, p: 1, sn: 3, fe: 2, untie: true }],
  ['Posy', 'flower25', { k: 6, h: 15, H: 6, pv: true }],
  ['Two hearts', 'heart37', { k: 6, h: 20, H: 6, sp: 2, sn: 3 }],
  ['Keepsake', 'heart35', { k: 6, h: 18, H: 6, m: 0.12, t: 0.35, p: 0.8, sn: 3, fe: 3, untie: true }],
  ['Love knot shawl', 'heart37', { k: 6, h: 23, H: 6, m: 0.12, t: 0.4, p: 0.8, sn: 4, untie: true, cols: { 4: 5 } }],
  // ---- 9. Harvest fair: everything, shown off ----
  ['Fair morning', 'bowl30', { k: 4, h: 13, H: 5 }],
  ['Apple bobbing', 'round31', { k: 5, h: 14, H: 5, sn: 3 }],
  ['Prize fleece', 'sheep', { k: 5, h: 16, H: 6, fe: 4 }],
  ['Bell ringers', 'bell', { k: 5, h: 16, H: 6, sp: 2 }],
  ['Leaf pile', 'leaf', { k: 5, h: 16, H: 6, pv: true, sn: 2 }],
  ['Judging table', 'rect40', { k: 6, order: { 2: 5, 5: 5, 1: 4 }, who: 'the judges', H: 6, trays: 'auto', kn: 2 }],
  ['Harvest moon', 'moon', { k: 4, h: 10, H: 6, sp: 1 }],
  ['Wheat sheaf', 'diamond25', { k: 5, h: 14, H: 6, fe: 2, pv: true }],
  ['Ribbon winner', 'stall', { k: 6, h: 19, H: 6, m: 0.12, t: 0.35, p: 0.8, sn: 3, sp: 1, untie: true }],
  ['Harvest supper', 'bowl30', { k: 6, order: { 0: 5, 1: 4, 3: 4, 5: 3 }, who: 'the whole village', H: 6, fe: 3, trays: 'auto' }],
  // ---- 10. Starry nights ----
  ['First star', 'star20', { k: 3, h: 10, H: 5 }],
  ['Crescent', 'moon', { k: 4, h: 10, H: 5, pv: true }],
  ['Lantern', 'bell', { k: 5, h: 15, H: 6, sn: 3 }],
  ['Shooting star', 'star37', { k: 5, h: 17, H: 6, sp: 2 }],
  ['Night owl', 'hex37', { k: 5, h: 18, H: 6, m: 0.2, t: 0.3, p: 1, fe: 4, untie: true }],
  ['North star', 'star37', { k: 6, h: 19, H: 6, sp: 1, sn: 4 }],
  ['Snow at night', 'star37', { k: 6, h: 19, H: 6, m: 0.15, t: 0.35, p: 1, fe: 4, sn: 2, untie: true, pv: true }],
  ['Constellation', 'diamond25', { k: 5, h: 15, H: 6, sn: 2 }],
  ['Moonlit loom', 'rect40', { k: 6, order: { 2: 5, 4: 5, 3: 5 }, who: 'the night weaver', H: 6, sp: 2, trays: 'auto' }],
  ['Starry shawl', 'star37', { k: 6, h: 24, H: 6, sn: 3, fe: 3 }],
  // ---- 11. The great shawl ----
  ['Casting on', 'rect36', { k: 4, h: 14, H: 5 }],
  ['The border', 'hex37', { k: 5, h: 16, H: 6, sn: 3, sp: 1 }],
  ['Lace panel', 'butterfly', { k: 5, h: 16, H: 6, fe: 3, pv: true }],
  ['Colorwork', 'rect40', { k: 6, order: { 0: 4, 1: 4, 2: 4, 4: 4 }, who: 'a shawl pattern', H: 6, sn: 3 }],
  ['Fringe', 'skein27', { k: 6, h: 17, H: 6, sp: 2, fe: 2 }],
  ['Blocking pins', 'round31', { k: 6, h: 18, H: 6, m: 0.15, t: 0.35, p: 1, kn: [[2, 2], [3, 4]], sn: 3, untie: true }],
  ['Steam and press', 'teapot', { k: 6, h: 21, H: 6, fe: 4, pv: true, trays: 'auto' }],
  ['Folded in tissue', 'sheep', { k: 6, h: 22, H: 6, sp: 2, sn: 3 }],
  ['A ribbon on top', 'heart37', { k: 6, order: { 4: 6, 0: 5, 5: 5, 2: 4 }, who: 'a dear friend', H: 6, fe: 3, sn: 2 }],
  ['The great shawl', 'rect40', { k: 6, h: 30, H: 6, sn: 4, fe: 3, sp: 2, cols: { 0: 5, 2: 5, 4: 5 } }],
];

// ---------------------------------------------------------------------------
// Placing marks: farthest-point spread from the middle of the board
// ---------------------------------------------------------------------------
function cellsOf(rows) {
  const cells = [];
  rows.forEach((line, row) => [...line].forEach((ch, col) => { if (ch !== ' ') cells.push({ col, row, x: col + (row & 1) * 0.5, y: row * 0.866 }); }));
  return cells;
}
function nbrOf(cells, i) {
  const { col, row } = cells[i];
  const d = row & 1 ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([dc, dr]) => cells.findIndex((c) => c.col === col + dc && c.row === row + dr)).filter((j) => j >= 0);
}

/** marks for one level: { knots, snarls, felt, spindles } as [[col,row]] lists */
function placeMarks(shape, o) {
  const cells = cellsOf(SHAPES[shape]);
  const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c.y, 0) / cells.length;
  const used = new Set();
  const out = {};
  const coord = (i) => [cells[i].col, cells[i].row];
  const idxOf = ([c, r]) => cells.findIndex((x) => x.col === c && x.row === r);
  const dist = (i, j) => Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y);
  const dc = (i) => Math.hypot(cells[i].x - cx, cells[i].y - cy);
  const rad = Math.max(...cells.map((_, i) => dc(i)));
  const blocked = new Set(); // knots
  const take = (key, spec, { center = false, minFree = 2 } = {}) => {
    if (spec === undefined) return;
    if (Array.isArray(spec)) {
      out[key] = spec;
      for (const p of spec) { const i = idxOf(p); if (i < 0) throw new Error(`${shape}: ${key} ${p} is not a peg`); used.add(i); if (key === 'knots') blocked.add(i); }
      return;
    }
    const chosen = [];
    for (let n = 0; n < spec; n++) {
      let best = -1, bv = -Infinity;
      for (let pass = 0; pass < 2 && best < 0; pass++) for (let i = 0; i < cells.length; i++) {
        if (used.has(i)) continue;
        const nb = nbrOf(cells, i).filter((j) => !blocked.has(j));
        if (nb.length < 3) continue;
        // a mark keeps at least minFree plain pegs beside it (so a hank can be tied there)
        if (nb.filter((j) => !used.has(j)).length < minFree) continue;
        if (!pass && [...used].some((j) => nbrOf(cells, i).includes(j))) continue; // marks keep apart (when there is room)
        const others = [...used];
        const md = others.length ? Math.min(...others.map((j) => dist(i, j))) : 99;
        // the first spindle sits in the middle; the rest spread out over the middle ring
        const v = (center && !chosen.length ? -dc(i) * 10 : Math.min(md, 4.5) * 10 - Math.abs(dc(i) - 0.55 * rad) * 6 + nb.length * 2) - i * 1e-6;
        if (v > bv) { bv = v; best = i; }
      }
      if (best < 0) throw new Error(`${shape}: no room for ${key} #${n + 1}`);
      chosen.push(best);
      used.add(best);
      if (key === 'knots') blocked.add(best);
    }
    out[key] = chosen.sort((a, b) => a - b).map(coord);
  };
  take('knots', o.kn, { minFree: 3 });
  take('spindles', o.sp, { center: true, minFree: 3 });
  take('snarls', o.sn, { minFree: 3 });
  take('felt', o.fe, { minFree: 3 });
  return out;
}

// ---------------------------------------------------------------------------
// Build, measure the baskets, write
// ---------------------------------------------------------------------------
function build(trays = {}, tuned = {}) {
  const levels = ORIGINAL.map((l) => ({ ...l }));
  DESIGN.forEach(([name, shape, o], k) => {
    const id = `l${13 + k}`;
    const m = placeMarks(shape, o);
    const goal = {};
    if (o.order) { goal.order = o.order; if (o.who) goal.who = o.who; } else goal.hanks = o.h;
    if (o.cols) goal.colors = o.cols;
    if (o.trays) goal.trays = trays[id] || 0;
    if (o.untie) goal.untie = true;
    const L = { id, name };
    if (o.title) L.title = o.title;
    L.shape = shape;
    if (m.knots) L.knots = m.knots;
    if (m.snarls) L.snarls = m.snarls;
    if (m.felt) L.felt = m.felt;
    if (m.spindles) L.spindles = m.spindles;
    if (o.pv) L.preview = true;
    const mix = o.m !== undefined ? { mono: o.m, tri: o.t, pull: o.p } : PRESETS[tuned[id] || 0];
    Object.assign(L, { colors: o.k, goal, maxH: o.H, mono: mix.mono, tri: mix.tri });
    if (mix.pull !== undefined) L.pull = mix.pull;
    levels.push(L);
  });
  return levels;
}

function q(s) { return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
function levelLine(L) {
  const parts = [`id: ${q(L.id)}`, `name: ${q(L.name)}`];
  if (L.title) parts.push(`title: ${q(L.title)}`);
  parts.push(`shape: ${q(L.shape)}`);
  for (const k of ['knots', 'snarls', 'felt', 'spindles']) if (L[k]) parts.push(`${k}: ${JSON.stringify(L[k]).replace(/,/g, ', ')}`);
  if (L.preview) parts.push('preview: true');
  parts.push(`colors: ${L.colors}`);
  const g = [];
  if (L.goal.hanks !== undefined) g.push(`hanks: ${L.goal.hanks}`);
  if (L.goal.order) g.push(`order: { ${Object.entries(L.goal.order).map(([c, n]) => `${c}: ${n}`).join(', ')} }`);
  if (L.goal.who) g.push(`who: ${q(L.goal.who)}`);
  if (L.goal.colors) g.push(`colors: { ${Object.entries(L.goal.colors).map(([c, n]) => `${c}: ${n}`).join(', ')} }`);
  if (L.goal.trays) g.push(`trays: ${L.goal.trays}`);
  if (L.goal.untie) g.push('untie: true');
  parts.push(`goal: { ${g.join(', ')} }`);
  parts.push(`maxH: ${L.maxH}`, `mono: ${L.mono}`, `tri: ${L.tri}`);
  if (L.pull !== undefined) parts.push(`pull: ${L.pull}`);
  return `  { ${parts.join(', ')} },`;
}

function source(levels) {
  let at = 0;
  const lines = [];
  CHAPTERS.forEach((c, ci) => {
    lines.push(`  // ---- ${ci + 1}. ${c.name} ----`);
    for (let k = 0; k < c.levels; k++) lines.push(levelLine(levels[at + k]));
    at += c.levels;
  });
  return `// Skein Stacks: the levels, chapters, boards and the newer mechanics' intro
// cards (data only). GENERATED by proto/skeins/gen-levels.mjs: edit the design
// table there and run it; it writes this same text to proto/skeins/levels.js
// and src/puzzles/skeins-levels.js (test/skeins.test.js checks they match).
// Level ids are kept for good: a save refers to levels by their place in LEVELS.
//
// Boards: '.' peg, '#' knot, ' ' nothing. Odd rows sit half a peg right.
// A level: shape, knots/snarls/felt/spindles ([col,row] lists), preview,
// colors (how many of the six), goal {hanks | order+who, colors (set-color
// hanks owed), trays (a gentle basket), untie}, and the tray's make-up: maxH
// (tallest tray stack), mono (share of one-color stacks), tri (share with
// three bands), pull (top-color bias toward the board, default 2).
// title (game only): the name with {k} standing for her name of color k.

export const SHAPES = {
${Object.entries(SHAPES).map(([k, rows]) => `  ${k}: [${rows.map(q).join(', ')}],`).join('\n')}
};

export const CHAPTERS = [
${CHAPTERS.map((c) => `  { id: ${q(c.id)}, name: ${q(c.name)}, blurb: ${q(c.blurb)}, levels: ${c.levels} },`).join('\n')}
];

export const MECHANICS = {
${Object.entries(MECHANICS).map(([k, m]) => `  ${k}: { name: ${q(m.name)}, line: ${q(m.line)} },`).join('\n')}
};

export const LEVELS = [
${lines.join('\n')}
];
`;
}

function write(levels) {
  const text = source(levels);
  for (const f of OUT) fs.writeFileSync(f, text);
  return text;
}

const total = CHAPTERS.reduce((a, c) => a + c.levels, 0);
if (ORIGINAL.length + DESIGN.length !== total) throw new Error(`chapters hold ${total} levels, the table has ${ORIGINAL.length + DESIGN.length}`);

// ---------------------------------------------------------------------------
// THE RAMP: a level without a fixed tray mix (m/t/p) takes a preset from this
// ladder by its place in the chapter (a reset at each chapter start, the intro
// level kept gentle), one step firmer from chapter 7 on; `tier` overrides it.
// The merge rule is forgiving (a careless player almost never fills a board;
// proto/skeins/survey.mjs measures it), so the ramp is mostly felt through
// more colors, mixed trays with weaker top-color pull, bigger goals and more
// marks on the board, and the planning bot verifies each level.
// ---------------------------------------------------------------------------
const tuned = {};
const PRESETS = [
  { mono: 0.4, tri: 0.1, pull: 1.5 },
  { mono: 0.3, tri: 0.2, pull: 1.2 },
  { mono: 0.2, tri: 0.3, pull: 1 },
  { mono: 0.12, tri: 0.38, pull: 0.8 },
  { mono: 0.06, tri: 0.45, pull: 0.5 },
  { mono: 0.02, tri: 0.55, pull: 0.3 },
];
const RAMP = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
const tierOf = (k, o) => {
  if (o.tier !== undefined) return o.tier;
  let at = ORIGINAL.length, ch = 1;
  while (k + ORIGINAL.length >= at + CHAPTERS[ch].levels) { at += CHAPTERS[ch].levels; ch++; }
  const pos = k + ORIGINAL.length - at;
  return Math.min(PRESETS.length - 1, RAMP[pos] + (ch >= 6 && pos > 1 ? 1 : 0));
};
DESIGN.forEach(([, , o], k) => { tuned[`l${13 + k}`] = tierOf(k, o); });

// pass 1: write the levels, then measure the baskets with the planning bot
const first = build({}, tuned);
write(first);
const R = await import(pathToFileURL(path.join(ROOT, 'src', 'puzzles', 'skeins.js')).href + `?t=${Date.now()}`);
const trays = {};
const SEEDS = [11, 3333, 5, 77, 2024, 31337, 8, 4242];
DESIGN.forEach(([, , o], k) => {
  if (o.trays !== 'auto') return;
  const li = 12 + k;
  const deals = SEEDS.map((sd) => R.botSolve(li, sd).deals);
  trays[`l${li + 1}`] = Math.max(...deals) + 3;
});
const final = build(trays, tuned);
write(final);
console.log(`wrote ${final.length} levels in ${CHAPTERS.length} chapters to\n  ${OUT.join('\n  ')}`);
console.log('baskets:', JSON.stringify(trays));
