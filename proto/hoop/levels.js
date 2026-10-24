// The Hoop: the twenty hoops (pure data). Pegs, strands, solutions and stats
// live in hoops.js, written by gen-levels.mjs.
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
  clasp: { name: 'Hooked strands', line: 'Hooked: these two loop around each other, so neither lies on top of everything. Carry an end back past the knot it hooked to let them go. (A strand lying on top of everything it crosses lifts right off.)' },
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
// candidates to deal.
export const LEVEL_DEFS = [
  // ---- learning the hoop ----
  { id: 'first', name: 'First knots', knobs: { n: 12, S: 3, colors: 2, scramble: 3, maxCross: 8, clasp: false, target: 1, par: [2, 2] } },
  { id: 'sampler', name: 'A little sampler', knobs: { n: 12, S: 3, colors: 2, scramble: 4, maxCross: 9, clasp: true, target: 1, par: [2, 3] } },
  { id: 'floss', name: 'Embroidery floss', knobs: { n: 14, S: 4, colors: 3, scramble: 4, maxCross: 12, target: 0.9, par: [2, 3] } },
  { id: 'workbag', name: 'The workbag', knobs: { n: 16, S: 5, colors: 3, scramble: 5, maxCross: 15, target: 0.8, par: [3, 4] } },
  // ---- stitched-down knots ----
  { id: 'tacked', name: 'Tacked in place', knobs: { n: 14, S: 4, colors: 3, fixed: 2, scramble: 5, maxCross: 12, target: 0.7, par: [2, 4] } },
  { id: 'basting', name: 'Basting stitches', knobs: { n: 16, S: 5, colors: 3, fixed: 2, scramble: 6, maxCross: 15, target: 0.6, par: [3, 4] } },
  { id: 'couching', name: 'Couching', knobs: { n: 18, S: 6, colors: 4, fixed: 3, scramble: 6, maxCross: 18, target: 0.5, par: [3, 5] } },
  // ---- painted pegs ----
  { id: 'painted', name: 'Painted pegs', knobs: { n: 16, S: 5, colors: 3, pegs: 3, scramble: 6, maxCross: 15, target: 0.6, par: [3, 4] } },
  { id: 'colorway', name: 'Colorway', knobs: { n: 18, S: 6, colors: 4, pegs: 4, fixed: 1, scramble: 7, maxCross: 18, target: 0.5, par: [3, 5] } },
  { id: 'fairisle', name: 'Fair Isle chart', knobs: { n: 18, S: 6, colors: 4, pegs: 5, fixed: 2, scramble: 8, maxCross: 20, target: 0.4, par: [4, 6] } },
  // ---- shared knots ----
  { id: 'joined', name: 'Joined at the knot', knobs: { n: 16, S: 5, colors: 3, links: 1, scramble: 5, maxCross: 15, target: 0.6, par: [2, 4] } },
  { id: 'fringe', name: 'Tying a fringe', knobs: { n: 18, S: 6, colors: 4, links: 2, scramble: 6, maxCross: 18, target: 0.5, par: [3, 5] } },
  { id: 'macrame', name: 'Macramé', knobs: { n: 20, S: 7, colors: 4, links: 2, fixed: 1, pegs: 2, scramble: 7, maxCross: 22, target: 0.4, par: [4, 6] } },
  // ---- over and under ----
  { id: 'overunder', name: 'Over and under', knobs: { n: 12, S: 4, colors: 2, layering: true, scramble: 5, maxCross: 14, target: 0.6, par: [3, 4] } },
  { id: 'tabby', name: 'Plain weave', knobs: { n: 14, S: 5, colors: 3, layering: true, scramble: 6, maxCross: 16, target: 0.4, par: [3, 5] } },
  { id: 'twill', name: 'Twill', knobs: { n: 16, S: 6, colors: 3, layering: true, scramble: 8, maxCross: 20, target: 0.3, par: [4, 7] } },
  // ---- fewer spare pegs ----
  { id: 'snug', name: 'A snug hoop', knobs: { n: 14, S: 6, colors: 4, scramble: 6, maxCross: 18, target: 0.4, par: [3, 5] } },
  { id: 'crewel', name: 'Crewelwork', knobs: { n: 16, S: 7, colors: 4, fixed: 2, pegs: 2, scramble: 7, maxCross: 20, target: 0.3, par: [4, 6] } },
  { id: 'bargello', name: 'Bargello', knobs: { n: 19, S: 9, colors: 5, links: 1, fixed: 1, scramble: 6, maxCross: 24, cap: 20000, target: 0.2, par: [4, 7] } },
  // ---- the finale ----
  { id: 'heirloom', name: 'The heirloom sampler', knobs: { n: 18, S: 7, colors: 5, layering: true, fixed: 1, pegs: 2, scramble: 9, maxCross: 24, target: 0.2, par: [5, 8] } },
];


export const BANDS = [
  { name: 'Learning the hoop', from: 0 },
  { name: 'Stitched-down knots', from: 4 },
  { name: 'Painted pegs', from: 7 },
  { name: 'Shared knots', from: 10 },
  { name: 'Over and under', from: 13 },
  { name: 'Fewer spare pegs', from: 16 },
  { name: 'The finale', from: 19 },
];

// Ready-to-play levels: pegs, strands and words + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HOOPS[d.id]).map((d) => {
  const h = HOOPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, ...h.def });
  const mech = mechanicsOf(L);
  if (sparePegs(L) <= 2) mech.push('spare');
  return Object.assign(L, { solution: h.solution, par: parseMoves(h.solution).length, stats: h.stats, sig: levelSig(L), mechanics: mech });
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
