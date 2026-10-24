// puzzles/tangle-levels.js — The Tangle Basket's baskets (pure data): names,
// chapters and mechanics from proto/tangle/levels.js, and the heaps from
// tangle-heaps.js (a copy of proto/tangle/heaps.js: control points packed as
// text, unpacked when it loads). test/tangle.test.js checks the two match.
//
// A basket is built (splines, crossings, snarls; a few ms, up to ~10 ms for the
// biggest on a laptop) only when something reads its geometry: LEVELS holds
// light records whose id, name, n, slots, board, mechanics, solution, stats and
// sig are ready at once, and whose other fields build the basket on first
// read. At most MAX_BUILT baskets stay built; the oldest goes back to its light
// record (and builds again if it is read again), so a long session never holds
// a hundred heaps in memory. The list and the hub card draw from the packed
// control points (ctrlOf) and never build a heap they only show.
import { HEAPS } from './tangle-heaps.js';
import { buildLevel, levelSig } from './tangle.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = Object.freeze({
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
});

// [id, name, intro?] in play order; intro: a card for something that isn't a
// rule change (the knobs that made each basket stay in the prototype).
const DEFS = [
  ['first', 'First tangle'],
  ['scraps', 'A handful of scraps'],
  ['leftovers', 'The leftovers bag'],
  ['plan', 'Six colors, five spools', 'rack'],
  ['cat', 'The cat got into it'],
  ['joins', 'Joined ends'],
  ['magic', 'Magic knots', 'weave'],
  ['pinned', 'Pinned to the board'],
  ['blocking', 'Blocking day'],
  ['snarl', 'Interlocked'],
  ['stripes', 'Self-striping'],
  ['festival', 'After the fiber festival'],
  ['bottom', 'The bottom of the bag', 'big'],
  ['thrift', 'The thrift-store bag'],
  ['attic', 'Grandma’s attic'],
  ['deep', 'The deep end'],
  ['small', 'A smaller rack'],
  ['swap', 'Swap meet'],
  ['destash', 'Destash day'],
  ['tucked', 'Tucked in'],
  ['pegboard', 'The pegboard'],
  ['ring', 'Ring around'],
  ['studio', 'The studio floor'],
  ['guild', 'Guild night'],
  ['stash', 'The whole stash'],
  ['felted', 'Felted in the wash'],
  ['moths', 'Moths in the cupboard'],
  ['nest', 'The rat’s nest'],
  ['everything', 'Everything at once'],
  ['shearing', 'Shearing day'],
  ['skirting', 'The skirting table'],
  ['lanolin', 'Lanolin and lavender'],
  ['carding', 'Carding batts'],
  ['roving', 'A basket of roving'],
  ['drafting', 'Drafting by the fire'],
  ['plying', 'Two-ply evening'],
  ['worsted', 'Worsted and woollen'],
  ['fairisle', 'Fair Isle leftovers'],
  ['fleecefair', 'The fleece fair'],
  ['boll', 'Boll season'],
  ['gin', 'Gin day'],
  ['slub', 'Slubby cotton'],
  ['dishcloth', 'Dishcloth yarn'],
  ['crochet', 'Crochet thread'],
  ['mercer', 'Mercerized shine'],
  ['twine', 'Kitchen twine'],
  ['quilting', 'Quilting thread'],
  ['denim', 'Denim scraps'],
  ['mill', 'The cotton mill'],
  ['retting', 'The retting pond'],
  ['scutch', 'Scutching'],
  ['hackle', 'Through the hackle'],
  ['tow', 'A tangle of tow'],
  ['distaff', 'The distaff'],
  ['bleach', 'On the bleaching green'],
  ['damask', 'Damask napkins'],
  ['lace', 'Bobbin lace'],
  ['sail', 'Sailcloth'],
  ['flaxwheel', 'The flax wheel'],
  ['mulberry', 'Mulberry leaves'],
  ['cocoon', 'Cocoons'],
  ['reeling', 'Reeling'],
  ['noil', 'Silk noil'],
  ['tussah', 'Tussah'],
  ['hankies', 'Silk hankies'],
  ['throwing', 'The throwster'],
  ['sari', 'Sari silk ribbons'],
  ['floss', 'Embroidery floss'],
  ['silkroad', 'The silk road'],
  ['huacaya', 'Huacaya'],
  ['suri', 'Suri locks'],
  ['kid', 'Kid mohair'],
  ['halo', 'A brushed halo'],
  ['boucle', 'Bouclé loops'],
  ['llama', 'Llama trek'],
  ['cria', 'Cria fleece'],
  ['mohair', 'Mohair curls'],
  ['altiplano', 'Altiplano market'],
  ['andes', 'Over the Andes'],
  ['hemp', 'Hemp cord'],
  ['jute', 'Jute sacks'],
  ['sisal', 'Sisal'],
  ['coir', 'Coir and coconut'],
  ['macrame', 'Macramé'],
  ['netting', 'Mending the nets'],
  ['rigging', 'Ship’s rigging'],
  ['bellrope', 'The bell rope'],
  ['hawser', 'Hawser laid'],
  ['ropewalk', 'The ropewalk'],
  ['combing', 'Combing the goats'],
  ['bunny', 'The angora bunny'],
  ['qiviut', 'Qiviut'],
  ['yak', 'Yak down'],
  ['vicuna', 'Vicuña'],
  ['camel', 'Camel hair'],
  ['possum', 'Possum blend'],
  ['pashmina', 'Pashmina'],
  ['downy', 'Down and fluff'],
  ['luxury', 'The luxury drawer'],
  ['madder', 'The madder bath'],
  ['weld', 'Weld yellow'],
  ['woad', 'The woad vat'],
  ['logwood', 'Logwood chips'],
  ['cochineal', 'Cochineal'],
  ['walnut', 'Walnut hulls'],
  ['onion', 'Onion skins'],
  ['mordant', 'Mordant day'],
  ['exhaust', 'Exhaust baths'],
  ['rainbow', 'Every color at once'],
];
export const LEVEL_DEFS = Object.freeze(DEFS.map(([id, name, intro]) => Object.freeze(intro ? { id, name, intro } : { id, name })));

// Chapters of about ten baskets, each named for a fiber. Within a chapter the
// baskets get harder; each chapter starts a little easier than the last one
// ended, then climbs higher.
export const CHAPTERS = Object.freeze([
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
].map((c) => Object.freeze(c)));

/** MAX_BUILT: baskets kept built at once (the one on the table, the one before, a test or two). */
export const MAX_BUILT = 4;

const LAZY = ['strands', 'poly', 'cum', 'grids', 'boxes', 'cross', 'crossOf', 'over', 'under', 'snarls', 'snarlOf', 'group', 'partner',
  'pinBy', 'pinAt', 'pegC', 'pegs', 'colors', 'units', 'knots', 'pins', 'flips', 'tucks'];
const built = [];

function lazyLevel(d, h) {
  const L = {
    id: d.id, name: d.name, slots: h.slots, board: { w: h.board[0], h: h.board[1] }, n: h.stats.strands,
    solution: h.solution, stats: h.stats, sig: h.sig, mechanics: [...new Set([...(d.intro ? [d.intro] : []), ...h.mech])],
  };
  const lazy = () => {
    for (const k of LAZY) Object.defineProperty(L, k, { get() { build(); return L[k]; }, configurable: true, enumerable: true });
  };
  const build = () => {
    const B = buildLevel({ id: d.id, name: d.name, slots: h.slots, board: h.board, strands: h.strands, knots: h.knots, pins: h.pins, pegs: h.pegs, flips: h.flips });
    for (const k of LAZY) Object.defineProperty(L, k, { value: B[k], writable: true, configurable: true, enumerable: true });
    built.push(L);
    while (built.length > MAX_BUILT) { const old = built.shift(); if (old !== L && !built.includes(old)) old.release(); }
  };
  Object.defineProperty(L, 'release', { value: () => { const i = built.indexOf(L); if (i >= 0) built.splice(i, 1); lazy(); }, enumerable: false });
  Object.defineProperty(L, 'isBuilt', { get: () => built.includes(L), enumerable: false });
  lazy();
  return L;
}

export const LEVELS = Object.freeze(LEVEL_DEFS.filter((d) => HEAPS[d.id]).map((d) => lazyLevel(d, HEAPS[d.id])));
export const LEVEL_IDS = Object.freeze(LEVELS.map((L) => L.id));
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
/** levelById(id) -> the basket (a light record that builds itself on first geometry read), or null. */
export const levelById = (id) => BY_ID.get(id) || null;
/** indexOf(id) -> its place in play order (0-based), or -1. */
export const indexOf = (id) => LEVEL_IDS.indexOf(id);
/** chapterOf(i) -> the chapter basket i belongs to. */
export const chapterOf = (i) => CHAPTERS.reduce((a, c) => (i >= c.from ? c : a), CHAPTERS[0]);
/** chapterIndex(i) -> 0-based chapter number of basket i. */
export const chapterIndex = (i) => CHAPTERS.indexOf(chapterOf(i));

/** ctrlOf(id) -> each strand's control points [[x, y], ...] and colors, without building the basket (for thumbnails). */
export function ctrlOf(id) {
  const h = HEAPS[id];
  if (!h) return [];
  return h.strands.map((s) => {
    const pts = [];
    for (let k = 0; k < s.p.length; k += 2) pts.push([s.p[k], s.p[k + 1]]);
    return { c: s.c, c2: s.c2 || null, q: !!s.q, pts };
  });
}

/** Recompute a built basket's signature (tests: the packed geometry still hashes to the stored sig). */
export const sigOf = (L) => levelSig(L);
