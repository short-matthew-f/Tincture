// The Hoop: the hoops (pure data). Pegs, strands, solutions and stats live in
// hoops.js, written by gen-levels.mjs. The first twenty-three are the
// playtested opening, kept exactly as they were (ids, hoops and pars); the
// eighty after them are made to need planning (see HARDER HOOPS below).
//
// WHY A STRAND COMES FREE ON ITS OWN (not only with its whole color)
// We measured both rules on the same dealt hoops (gen-levels.mjs, see the
// notes in the report). Freeing by color raised the minimum moves by only 0
// to 2, but a greedy player wandered 2 to 3 times longer, and a random player
// almost never cleared even a 14-peg hoop in 60 moves. It added length, not
// insight: a strand that is already clear just sits there, holding two pegs,
// with nothing to tell her why. Freeing each strand the moment it crosses
// nothing pays off every good move with a glow and two pegs of new working
// space, and the later mechanics (stitched-down knots, painted pegs, shared
// knots, over and under, fewer spare pegs) bring the planning, each with a
// reason she can see.
import { HOOPS } from './hoops.js';
import { buildLevel, mechanicsOf, levelSig, sparePegs, parseMoves } from './rules.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = {
  clasp: { name: 'Hooked strands', line: 'Hooked: these two loop around each other (a small pair of rings marks the hook). Carry an end back past the knot it hooked to let them go.' },
  liftoff: { name: 'Lift it off', line: 'Lift it off: a strand lying on top of everything can be picked straight off. Tap its middle; it counts as a move. A hooked strand never lifts off.' },
  fixed: { name: 'Stitched-down knots', line: 'A knot with a brass tack is stitched to the hoop and stays put. Move the strand’s other end instead.' },
  pegs: { name: 'Painted pegs', line: 'A painted peg only takes yarn of its own color.' },
  links: { name: 'Shared knots', line: 'Two strands tied into one knot move together: lift the knot and both ends go.' },
  layering: { name: 'Over and under', line: 'Now what lies on top matters: a knot lifts only when its strand lies on top at the crossing nearest that knot. Knots that are ready wear a cream ring.' },
  spare: { name: 'Fewer spare pegs', line: 'Only two empty pegs to start with. Freeing a strand gives you two more.' },
};

// Generation knobs (see gen.js and gen-levels.mjs): n pegs; S strands;
// colors; fixed (stitched-down knots); pegs (painted pegs); links (shared
// knots); layering; scramble = moves made from a clean hoop; clasp = start
// with hooked strands (true) or without (false); par = [fewest, most]
// minimum moves allowed; maxCross = most crossings at the start (more can't
// be read on a phone); target = wanted greedy-player clear rate; cap and
// seeds: the solver's node budget for proving a par, and how many
// candidates to deal; best: where the solver can't prove a par within the
// cap, keep the best way out found (the scramble played backwards, shortened,
// or a weighted search), marked unproven; hooked: at least this many hooked
// pairs; liftoff: the lift-off move is allowed (its band and every one after).
export const LEVEL_DEFS = [
  // ---- learning the hoop ----
  { id: 'first', name: 'First knots', knobs: { n: 12, S: 3, colors: 2, scramble: 5, clasp: false, cap: 20000, seeds: 40, target: 1, par: [3, 3] } },
  { id: 'sampler', name: 'A little sampler', knobs: { n: 12, S: 3, colors: 2, scramble: 5, clasp: true, cap: 20000, seeds: 40, target: 1, par: [3, 4] } },
  { id: 'floss', name: 'Embroidery floss', knobs: { n: 14, S: 4, colors: 3, scramble: 5, cap: 20000, seeds: 30, target: 0.9, par: [3, 4] } },
  { id: 'workbag', name: 'The workbag', knobs: { n: 14, S: 4, colors: 3, scramble: 6, cap: 25000, seeds: 30, target: 0.8, par: [4, 5] } },
  // ---- stitched-down knots ----
  { id: 'tacked', name: 'Tacked in place', knobs: { n: 14, S: 4, colors: 3, fixed: 2, scramble: 6, cap: 25000, seeds: 30, target: 0.7, par: [4, 5] } },
  { id: 'basting', name: 'Basting stitches', knobs: { n: 16, S: 5, colors: 3, fixed: 2, scramble: 7, cap: 25000, seeds: 20, best: true, target: 0.6, par: [5, 6] } },
  { id: 'couching', name: 'Couching', knobs: { n: 16, S: 5, colors: 4, fixed: 3, scramble: 8, cap: 20000, seeds: 16, best: true, target: 0.5, par: [5, 7] } },
  // ---- painted pegs ----
  { id: 'painted', name: 'Painted pegs', knobs: { n: 16, S: 5, colors: 3, pegs: 3, scramble: 7, cap: 20000, seeds: 16, best: true, target: 0.6, par: [5, 6] } },
  { id: 'colorway', name: 'Colorway', knobs: { n: 16, S: 5, colors: 4, pegs: 4, fixed: 1, scramble: 8, cap: 20000, seeds: 16, best: true, target: 0.5, par: [5, 7] } },
  { id: 'fairisle', name: 'Fair Isle chart', knobs: { n: 18, S: 6, colors: 4, pegs: 5, fixed: 2, scramble: 9, cap: 12000, seeds: 12, best: true, target: 0.4, par: [6, 7] } },
  // ---- shared knots ----
  { id: 'joined', name: 'Joined at the knot', knobs: { n: 16, S: 5, colors: 3, links: 1, scramble: 7, cap: 20000, seeds: 16, best: true, target: 0.6, par: [5, 6] } },
  { id: 'fringe', name: 'Tying a fringe', knobs: { n: 18, S: 6, colors: 4, links: 2, scramble: 8, cap: 12000, seeds: 12, best: true, target: 0.5, par: [6, 7] } },
  { id: 'macrame', name: 'Macramé', knobs: { n: 18, S: 6, colors: 4, links: 2, fixed: 1, pegs: 2, scramble: 9, cap: 12000, seeds: 12, best: true, target: 0.4, par: [6, 8] } },
  // ---- lift it off (from here on, a strand on top of everything can be picked off) ----
  { id: 'lifting', name: 'Lifting off', knobs: { n: 16, S: 5, colors: 3, liftoff: true, scramble: 8, cap: 20000, seeds: 16, best: true, target: 0.6, par: [5, 6] } },
  { id: 'pickout', name: 'Picking out', knobs: { n: 18, S: 6, colors: 4, liftoff: true, scramble: 9, cap: 12000, seeds: 12, best: true, target: 0.5, par: [6, 7] } },
  { id: 'unpick', name: 'Unpicking a mistake', knobs: { n: 18, S: 6, colors: 4, liftoff: true, hooked: 2, scramble: 11, cap: 12000, seeds: 12, best: true, target: 0.4, par: [7, 8] } },
  // ---- over and under ----
  { id: 'overunder', name: 'Over and under', knobs: { n: 14, S: 5, colors: 2, layering: true, liftoff: true, scramble: 9, cap: 15000, seeds: 16, best: true, target: 0.6, par: [6, 8] } },
  { id: 'tabby', name: 'Plain weave', knobs: { n: 16, S: 6, colors: 3, layering: true, liftoff: true, scramble: 10, cap: 12000, seeds: 12, best: true, target: 0.4, par: [7, 9] } },
  { id: 'twill', name: 'Twill', knobs: { n: 18, S: 6, colors: 3, layering: true, liftoff: true, scramble: 12, cap: 12000, seeds: 12, best: true, target: 0.3, par: [8, 10] } },
  // ---- fewer spare pegs ----
  { id: 'snug', name: 'A snug hoop', knobs: { n: 16, S: 7, colors: 4, liftoff: true, scramble: 11, cap: 8000, seeds: 10, best: true, target: 0.4, par: [8, 10] } },
  { id: 'crewel', name: 'Crewelwork', knobs: { n: 18, S: 8, colors: 4, liftoff: true, fixed: 2, pegs: 2, scramble: 12, cap: 8000, seeds: 10, best: true, target: 0.3, par: [9, 11] } },
  { id: 'bargello', name: 'Bargello', knobs: { n: 19, S: 9, colors: 5, liftoff: true, links: 1, fixed: 1, scramble: 13, maxCross: 40, cap: 8000, seeds: 10, best: true, target: 0.2, par: [10, 12] } },
  // ---- the finale ----
  { id: 'heirloom', name: 'The heirloom sampler', knobs: { n: 20, S: 8, colors: 5, layering: true, liftoff: true, fixed: 1, pegs: 2, hooked: 2, scramble: 14, maxCross: 40, cap: 8000, seeds: 20, best: true, target: 0.2, par: [9, 12] } },
];

export const BANDS = [
  { name: 'Learning the hoop', from: 0 },
  { name: 'Stitched-down knots', from: 4 },
  { name: 'Painted pegs', from: 7 },
  { name: 'Shared knots', from: 10 },
  { name: 'Lift it off', from: 13 },
  { name: 'Over and under', from: 16 },
  { name: 'Fewer spare pegs', from: 19 },
  { name: 'The finale', from: 22 },
];

// HARDER HOOPS (levels 24 on)
// The opening hoops are kind: a player who always takes the move leaving the
// fewest crossings (the greedy player, rules.js greedyPlayout) clears nearly
// all of them. From level 24 every hoop is dealt the same way (real moves from
// a clean hoop) and then KEPT ONLY IF that greedy player mostly fails: its
// clear rate within 60 moves must stay under the level's `ceil` (about one in
// two in the middle chapters, one in five or fewer in the late ones). On such
// a hoop the move that drops the most crossings now is often the one that
// leaves her going round in circles; the way out takes a step that looks
// sideways first. The levers are the playtested ones, combined: hooked
// strands (a clasp can't be pulled taut, so it has to be undone by hand),
// stitched knots that force the long way round, painted pegs, shared knots,
// over-and-under liftability, and fewer spare pegs. Hoops with more clasps
// are preferred. No new rules: the physics is the opening's.
//
// Within a chapter the ceiling falls (and the hoops grow); each chapter starts
// a little easier than the last one ended.
//   ceil: [first, last] greedy clear-rate ceiling across the chapter
//   par: [fewest, most] moves in the way out kept (proven minimal where the
//        solver can, else the best found, marked so)
//   knob(t): the dealing knobs at t = 0 (first hoop) .. 1 (last)
const lerp = (a, b, t) => a + (b - a) * t;
const ri = (a, b, t) => Math.round(lerp(a, b, t));
const NEW_CHAPTERS = [
  {
    id: 'crewel-wool', name: 'Crewel wool', theme: 'wool on linen', ceil: [0.5, 0.4], par: [5, 10],
    knob: (t) => ({ n: ri(15, 16, t), S: ri(5, 6, t), colors: 4, liftoff: true, layering: true, fixed: ri(1, 2, t), pegs: ri(2, 3, t), hooked: 1, scramble: ri(10, 12, t), maxCross: 22 }),
    levels: [['jacobean', 'Jacobean leaves'], ['woolonlinen', 'Wool on linen'], ['longshort', 'Long and short'], ['frenchknots', 'French knots'], ['bullion', 'Bullion roses'],
      ['trellis', 'Trellis couching'], ['satin', 'Satin stitch'], ['seedstitch', 'Seed stitch'], ['treeoflife', 'The tree of life'], ['hangings', 'The bed hangings']],
  },
  {
    id: 'cross-stitch', name: 'Cross-stitch', theme: 'counted thread', ceil: [0.5, 0.35], par: [6, 11],
    knob: (t) => ({ n: 16, S: 6, colors: 4, liftoff: true, layering: true, fixed: 2, pegs: ri(2, 3, t), hooked: 2, scramble: ri(11, 12, t), maxCross: 24 }),
    levels: [['aida', 'Aida cloth'], ['halfcross', 'Half cross'], ['backstitch', 'Backstitch outline'], ['counted', 'Counted thread'], ['alphabet', 'The alphabet row'],
      ['strawberry', 'Strawberry border'], ['assisi', 'Assisi work'], ['holbein', 'Holbein stitch'], ['pulled', 'Pulled thread'], ['house', 'The house sampler']],
  },
  {
    id: 'blackwork', name: 'Blackwork', theme: 'black silk, shared knots', ceil: [0.45, 0.3], par: [6, 12],
    knob: (t) => ({ n: ri(16, 17, t), S: 6, colors: 4, liftoff: true, layering: true, links: ri(1, 2, t), fixed: 1, pegs: 2, hooked: 2, scramble: ri(11, 13, t), maxCross: 26 }),
    levels: [['blacksilk', 'Black silk'], ['spanish', 'Spanish work'], ['diaper', 'Diaper pattern'], ['doublerun', 'Double running'], ['strapwork', 'Strapwork'],
      ['cuffs', 'Tudor cuffs'], ['knotwork', 'Knotwork'], ['interlace', 'Interlace'], ['coif', 'The coif'], ['sleeves', 'A pair of sleeves']],
  },
  {
    id: 'goldwork', name: 'Goldwork', theme: 'couched gold, few spare pegs', ceil: [0.4, 0.25], par: [7, 13],
    knob: (t) => ({ n: ri(16, 17, t), S: 7, colors: 4, liftoff: true, layering: true, fixed: 2, pegs: 2, hooked: 2, scramble: ri(12, 14, t), maxCross: 28 }),
    levels: [['japan', 'Japan thread'], ['pearlpurl', 'Pearl purl'], ['ornue', 'Or nué'], ['couchedgold', 'Couched gold'], ['checkpurl', 'Check purl'],
      ['paddedkid', 'Padded kid'], ['spangles', 'Spangles'], ['brightcheck', 'Bright check'], ['banner', 'The church banner'], ['mitre', 'The mitre']],
  },
  {
    id: 'stumpwork', name: 'Stumpwork', theme: 'raised work, many clasps', ceil: [0.2, 0.15], par: [8, 14],
    knob: (t) => ({ n: 18, S: 7, colors: 4, liftoff: true, layering: true, fixed: 2, pegs: 3, hooked: ri(3, 4, t), scramble: ri(13, 14, t), maxCross: 30 }),
    levels: [['wired', 'Wired petals'], ['buttonhole', 'Detached buttonhole'], ['padded', 'Padded strawberry'], ['raised', 'Raised leaves'], ['honeysuckle', 'A slip of honeysuckle'],
      ['caterpillar', 'The caterpillar'], ['picots', 'Woven picots'], ['turkeywork', 'Turkey work'], ['casket', 'The casket'], ['mirror', 'The mirror frame']],
  },
  {
    id: 'sashiko', name: 'Sashiko', theme: 'indigo and running stitch', ceil: [0.2, 0.1], par: [8, 15],
    knob: (t) => ({ n: ri(18, 19, t), S: ri(7, 8, t), colors: 4, liftoff: true, layering: true, links: 1, fixed: 2, pegs: 3, hooked: 3, scramble: ri(14, 15, t), maxCross: 30 }),
    levels: [['running', 'Running stitch'], ['hitomezashi', 'Hitomezashi'], ['asanoha', 'Asanoha'], ['seigaiha', 'Seigaiha waves'], ['shippo', 'Shippo rings'],
      ['kakinohana', 'Kakinohana'], ['boro', 'Boro patches'], ['kogin', 'Kogin'], ['indigocoat', 'The indigo coat'], ['hikeshi', 'The fireman’s jacket']],
  },
  {
    id: 'silk-shading', name: 'Silk shading', theme: 'needle painting', ceil: [0.15, 0.05], par: [9, 16],
    knob: (t) => ({ n: ri(19, 20, t), S: 8, colors: 5, liftoff: true, layering: true, links: 1, fixed: 2, pegs: 3, hooked: 3, scramble: ri(15, 16, t), maxCross: 32 }),
    levels: [['silkfloss', 'Silk floss'], ['splitstitch', 'Split stitch'], ['needlepaint', 'Needle painting'], ['petals', 'Shaded petals'], ['kingfisher', 'A kingfisher'],
      ['peony', 'The peony'], ['paradise', 'Bird of paradise'], ['mothwings', 'Moth wings'], ['chinesesilk', 'Chinese silk'], ['suzhou', 'The Suzhou screen']],
  },
  {
    id: 'heirlooms', name: 'Heirlooms', theme: 'the finest work', ceil: [0.1, 0], par: [10, 17],
    knob: (t) => ({ n: 20, S: ri(8, 9, t), colors: 5, liftoff: true, layering: true, links: ri(1, 2, t), fixed: 2, pegs: 3, hooked: 3, scramble: ri(16, 17, t), maxCross: 34 }),
    levels: [['grandlinen', 'Grandmother’s linen'], ['christening', 'The christening gown'], ['whitework', 'Whitework'], ['hardanger', 'Hardanger'], ['ayrshire', 'Ayrshire needlework'],
      ['opus', 'Opus anglicanum'], ['bayeux', 'The Bayeux stitch'], ['cope', 'The cope'], ['wedding', 'The wedding sampler'], ['familytree', 'The family tree']],
  },
];
for (const ch of NEW_CHAPTERS) {
  ch.levels.forEach(([id, name], k) => {
    const t = ch.levels.length > 1 ? k / (ch.levels.length - 1) : 0;
    const ceil = Math.round(lerp(ch.ceil[0], ch.ceil[1], t) * 100) / 100;
    LEVEL_DEFS.push({ id, name, knobs: { ...ch.knob(t), ceil, par: ch.par.slice() } });
  });
}

/**
 * difficulty(stats) -> a single number for ordering hoops: how often the
 * greedy player fails (weighted most), the moves the way out takes, the
 * crossings to read, and the clasps to undo by hand. Within each of the eight
 * later chapters the generator lays the hoops it dealt out in this order, so
 * each chapter climbs, and each starts below where the last one ended.
 */
export const difficulty = (st) => (1 - st.greedy) * 8 + st.par + st.crossings / 5 + st.hooked / 2;

// Chapters of about ten, each named for a kind of needlework. The opening
// three follow the mechanic bands above; from the fourth on, each mixes them.
export const CHAPTERS = [
  { id: 'first-stitches', name: 'First stitches', theme: 'a little sampler', from: 0 },
  { id: 'workbasket', name: 'The workbasket', theme: 'floss, pegs and shared knots', from: 7 },
  { id: 'finer-work', name: 'The finer work', theme: 'over and under', from: 16 },
  ...NEW_CHAPTERS.map((ch, k) => ({ id: ch.id, name: ch.name, theme: ch.theme, from: 23 + 10 * k })),
];
/** chapterOf(i) -> the chapter level i belongs to. */
export const chapterOf = (i) => CHAPTERS.reduce((a, c) => (i >= c.from ? c : a), CHAPTERS[0]);

// Ready-to-play levels: pegs, strands and words + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HOOPS[d.id]).map((d) => {
  const h = HOOPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, ...h.def });
  const mech = mechanicsOf(L);
  if (sparePegs(L) <= 2) mech.push('spare');
  return Object.assign(L, { solution: h.solution, par: parseMoves(h.solution).length, stats: h.stats, sig: levelSig(L), mechanics: mech });
});
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
export const levelById = (id) => BY_ID.get(id) || null;
