// The Hoop: the twenty-three hoops (pure data). Pegs, strands, solutions and stats
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

// Ready-to-play levels: pegs, strands and words + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HOOPS[d.id]).map((d) => {
  const h = HOOPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, ...h.def });
  const mech = mechanicsOf(L);
  if (sparePegs(L) <= 2) mech.push('spare');
  return Object.assign(L, { solution: h.solution, par: parseMoves(h.solution).length, stats: h.stats, sig: levelSig(L), mechanics: mech });
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
