// puzzles/hoop-levels.js — The Hoop's hoops (pure data): names, chapters and
// the intro lines from proto/hoop/levels.js, and the hoops themselves from
// hoop-data.js (a copy of proto/hoop/hoops.js: each def packed into one
// string, unpacked when it loads). test/hoop.test.js checks they match.
//
// The first twenty-three are the playtested opening, unchanged (ids, hoops,
// pars). From level 24 on every hoop was kept only if a greedy player (always
// the move leaving the fewest crossings) mostly fails it: see proto/hoop/
// levels.js "HARDER HOOPS" for the ceilings and gen-levels.mjs for the screen.
//
// A level is built (words checked, crossings renumbered, its signature hashed;
// well under a millisecond each) on first read: LEVELS holds light records
// whose id, name, n, S, color, solution, par, stats and mechanics are ready at
// once (read straight from the packed data), and whose rules fields build the
// level when something touches them. The list and the hub card never build a
// hoop they only show... except for thumbnails, which need the words.
import { HOOPS } from './hoop-data.js';
import { buildLevel, mechanicsOf, levelSig, sparePegs, parseMoves } from './hoop.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = Object.freeze({
  clasp: Object.freeze({ name: 'Hooked strands', line: 'Hooked: these two loop around each other (a small pair of rings marks the hook). Carry an end back past the knot it hooked to let them go.' }),
  liftoff: Object.freeze({ name: 'Lift it off', line: 'Lift it off: a strand lying on top of everything can be picked straight off. Tap its middle; it counts as a move. A hooked strand never lifts off.' }),
  fixed: Object.freeze({ name: 'Stitched-down knots', line: 'A knot with a brass tack is stitched to the hoop and stays put. Move the strand’s other end instead.' }),
  pegs: Object.freeze({ name: 'Painted pegs', line: 'A painted peg only takes yarn of its own color.' }),
  links: Object.freeze({ name: 'Shared knots', line: 'Two strands tied into one knot move together: lift the knot and both ends go.' }),
  layering: Object.freeze({ name: 'Over and under', line: 'Now what lies on top matters: a knot lifts only when its strand lies on top at the crossing nearest that knot. Knots that are ready wear a cream ring.' }),
  spare: Object.freeze({ name: 'Fewer spare pegs', line: 'Only two empty pegs to start with. Freeing a strand gives you two more.' }),
});

// [id, name] in play order (proto/hoop/levels.js LEVEL_DEFS, without the dealing knobs).
const DEFS = [
  ['first', 'First knots'], ['sampler', 'A little sampler'], ['floss', 'Embroidery floss'], ['workbag', 'The workbag'],
  ['tacked', 'Tacked in place'], ['basting', 'Basting stitches'], ['couching', 'Couching'],
  ['painted', 'Painted pegs'], ['colorway', 'Colorway'], ['fairisle', 'Fair Isle chart'],
  ['joined', 'Joined at the knot'], ['fringe', 'Tying a fringe'], ['macrame', 'Macramé'],
  ['lifting', 'Lifting off'], ['pickout', 'Picking out'], ['unpick', 'Unpicking a mistake'],
  ['overunder', 'Over and under'], ['tabby', 'Plain weave'], ['twill', 'Twill'],
  ['snug', 'A snug hoop'], ['crewel', 'Crewelwork'], ['bargello', 'Bargello'],
  ['heirloom', 'The heirloom sampler'],
  // Crewel wool
  ['jacobean', 'Jacobean leaves'], ['woolonlinen', 'Wool on linen'], ['longshort', 'Long and short'], ['frenchknots', 'French knots'], ['bullion', 'Bullion roses'],
  ['trellis', 'Trellis couching'], ['satin', 'Satin stitch'], ['seedstitch', 'Seed stitch'], ['treeoflife', 'The tree of life'], ['hangings', 'The bed hangings'],
  // Cross-stitch
  ['aida', 'Aida cloth'], ['halfcross', 'Half cross'], ['backstitch', 'Backstitch outline'], ['counted', 'Counted thread'], ['alphabet', 'The alphabet row'],
  ['strawberry', 'Strawberry border'], ['assisi', 'Assisi work'], ['holbein', 'Holbein stitch'], ['pulled', 'Pulled thread'], ['house', 'The house sampler'],
  // Blackwork
  ['blacksilk', 'Black silk'], ['spanish', 'Spanish work'], ['diaper', 'Diaper pattern'], ['doublerun', 'Double running'], ['strapwork', 'Strapwork'],
  ['cuffs', 'Tudor cuffs'], ['knotwork', 'Knotwork'], ['interlace', 'Interlace'], ['coif', 'The coif'], ['sleeves', 'A pair of sleeves'],
  // Goldwork
  ['japan', 'Japan thread'], ['pearlpurl', 'Pearl purl'], ['ornue', 'Or nué'], ['couchedgold', 'Couched gold'], ['checkpurl', 'Check purl'],
  ['paddedkid', 'Padded kid'], ['spangles', 'Spangles'], ['brightcheck', 'Bright check'], ['banner', 'The church banner'], ['mitre', 'The mitre'],
  // Stumpwork
  ['wired', 'Wired petals'], ['buttonhole', 'Detached buttonhole'], ['padded', 'Padded strawberry'], ['raised', 'Raised leaves'], ['honeysuckle', 'A slip of honeysuckle'],
  ['caterpillar', 'The caterpillar'], ['picots', 'Woven picots'], ['turkeywork', 'Turkey work'], ['casket', 'The casket'], ['mirror', 'The mirror frame'],
  // Sashiko
  ['running', 'Running stitch'], ['hitomezashi', 'Hitomezashi'], ['asanoha', 'Asanoha'], ['seigaiha', 'Seigaiha waves'], ['shippo', 'Shippo rings'],
  ['kakinohana', 'Kakinohana'], ['boro', 'Boro patches'], ['kogin', 'Kogin'], ['indigocoat', 'The indigo coat'], ['hikeshi', 'The fireman’s jacket'],
  // Silk shading
  ['silkfloss', 'Silk floss'], ['splitstitch', 'Split stitch'], ['needlepaint', 'Needle painting'], ['petals', 'Shaded petals'], ['kingfisher', 'A kingfisher'],
  ['peony', 'The peony'], ['paradise', 'Bird of paradise'], ['mothwings', 'Moth wings'], ['chinesesilk', 'Chinese silk'], ['suzhou', 'The Suzhou screen'],
  // Heirlooms
  ['grandlinen', 'Grandmother’s linen'], ['christening', 'The christening gown'], ['whitework', 'Whitework'], ['hardanger', 'Hardanger'], ['ayrshire', 'Ayrshire needlework'],
  ['opus', 'Opus anglicanum'], ['bayeux', 'The Bayeux stitch'], ['cope', 'The cope'], ['wedding', 'The wedding sampler'], ['familytree', 'The family tree'],
];
export const LEVEL_DEFS = Object.freeze(DEFS.map(([id, name]) => Object.freeze({ id, name })));

// Chapters of about ten, each named for a kind of needlework (the opening
// three follow the prototype's mechanic bands; from the fourth on each mixes
// them, and starts a little easier than the last one ended).
export const CHAPTERS = Object.freeze([
  { id: 'first-stitches', name: 'First stitches', theme: 'a little sampler', from: 0 },
  { id: 'workbasket', name: 'The workbasket', theme: 'floss, pegs and shared knots', from: 7 },
  { id: 'finer-work', name: 'The finer work', theme: 'over and under', from: 16 },
  { id: 'crewel-wool', name: 'Crewel wool', theme: 'wool on linen', from: 23 },
  { id: 'cross-stitch', name: 'Cross-stitch', theme: 'counted thread', from: 33 },
  { id: 'blackwork', name: 'Blackwork', theme: 'black silk, shared knots', from: 43 },
  { id: 'goldwork', name: 'Goldwork', theme: 'couched gold, few spare pegs', from: 53 },
  { id: 'stumpwork', name: 'Stumpwork', theme: 'raised work, many clasps', from: 63 },
  { id: 'sashiko', name: 'Sashiko', theme: 'indigo and running stitch', from: 73 },
  { id: 'silk-shading', name: 'Silk shading', theme: 'needle painting', from: 83 },
  { id: 'heirlooms', name: 'Heirlooms', theme: 'the finest work', from: 93 },
].map((c) => Object.freeze(c)));

const LAZY = ['n', 'S', 'color', 'start', 'fixed', 'link', 'cwSide', 'pegColor', 'layering', 'liftoff', 'unitOf', 'units', 'colors', 'def', 'startW', 'startX', 'sig', 'mechanics'];

function lazyLevel(d, h) {
  const L = { id: d.id, name: d.name, solution: h.solution, par: parseMoves(h.solution).length, stats: h.stats };
  const build = () => {
    const B = buildLevel({ id: d.id, name: d.name, ...h.def });
    const mech = mechanicsOf(B);
    if (sparePegs(B) <= 2) mech.push('spare');
    B.sig = levelSig(B);
    B.mechanics = mech;
    for (const k of LAZY) Object.defineProperty(L, k, { value: B[k], writable: true, configurable: true, enumerable: true });
  };
  for (const k of LAZY) Object.defineProperty(L, k, { get() { build(); return L[k]; }, configurable: true, enumerable: true });
  Object.defineProperty(L, 'isBuilt', { get: () => Object.getOwnPropertyDescriptor(L, 'sig').get === undefined, enumerable: false });
  return L;
}

export const LEVELS = Object.freeze(LEVEL_DEFS.filter((d) => HOOPS[d.id]).map((d) => lazyLevel(d, HOOPS[d.id])));
export const LEVEL_IDS = Object.freeze(LEVELS.map((L) => L.id));
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
/** levelById(id) -> the level (a light record that builds itself on first rules read), or null. */
export const levelById = (id) => BY_ID.get(id) || null;
/** indexOf(id) -> its place in play order (0-based), or -1. */
export const indexOf = (id) => LEVEL_IDS.indexOf(id);
/** chapterOf(i) -> the chapter level i belongs to. */
export const chapterOf = (i) => CHAPTERS.reduce((a, c) => (i >= c.from ? c : a), CHAPTERS[0]);
/** chapterIndex(i) -> 0-based chapter number of level i. */
export const chapterIndex = (i) => CHAPTERS.indexOf(chapterOf(i));
/** firstIntro(): mechanic -> index of the first level that has it (for the list's "new:" chips). */
export function firstIntro() {
  const out = {};
  LEVELS.forEach((L, i) => { for (const m of L.mechanics) if (!(m in out)) out[m] = i; });
  return out;
}
