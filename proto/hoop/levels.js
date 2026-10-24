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
  fixed: { name: 'Stitched-down knots', line: 'A knot with a brass tack is stitched to the hoop and stays put. Move the strand’s other end instead.' },
  pegs: { name: 'Painted pegs', line: 'A painted peg only takes yarn of its own color.' },
  links: { name: 'Shared knots', line: 'Two strands tied into one knot move together: lift the knot and both ends go.' },
  layering: { name: 'Over and under', line: 'Now what lies on top matters: you can lift a strand only when nothing lies over it. Knots that are ready wear a cream ring.' },
  spare: { name: 'Fewer spare pegs', line: 'Only two empty pegs to start with. Freeing a strand gives you two more.' },
};

// Generation knobs (see gen-levels.mjs): n pegs; S strands; colors; fixed
// (stitched-down knots); pegs (painted pegs); links (shared knots);
// layering; target = wanted random-player clear rate within 60 moves;
// par = [fewest, most] minimum moves allowed.
export const LEVEL_DEFS = [
  // ---- learning the hoop ----
  { id: 'first', name: 'First knots', knobs: { n: 12, S: 3, colors: 2, target: 0.95, par: [2, 2] } },
  { id: 'sampler', name: 'A little sampler', knobs: { n: 12, S: 4, colors: 2, target: 0.8, par: [2, 3] } },
  { id: 'floss', name: 'Embroidery floss', knobs: { n: 14, S: 5, colors: 3, target: 0.65, par: [3, 4] } },
  { id: 'workbag', name: 'The workbag', knobs: { n: 16, S: 6, colors: 3, target: 0.5, par: [4, 5] } },
  // ---- stitched-down knots ----
  { id: 'tacked', name: 'Tacked in place', knobs: { n: 14, S: 5, colors: 3, fixed: 2, target: 0.5, par: [3, 5] } },
  { id: 'basting', name: 'Basting stitches', knobs: { n: 16, S: 6, colors: 3, fixed: 3, target: 0.35, par: [4, 6] } },
  { id: 'couching', name: 'Couching', knobs: { n: 18, S: 7, colors: 4, fixed: 3, target: 0.25, par: [5, 7] } },
  // ---- painted pegs ----
  { id: 'painted', name: 'Painted pegs', knobs: { n: 16, S: 6, colors: 3, pegs: 3, target: 0.4, par: [4, 6] } },
  { id: 'colorway', name: 'Colorway', knobs: { n: 18, S: 7, colors: 4, pegs: 4, fixed: 1, target: 0.25, par: [5, 7] } },
  { id: 'fairisle', name: 'Fair Isle chart', knobs: { n: 18, S: 7, colors: 4, pegs: 5, fixed: 2, target: 0.15, par: [5, 8] } },
  // ---- shared knots ----
  { id: 'joined', name: 'Joined at the knot', knobs: { n: 16, S: 6, colors: 3, links: 1, target: 0.4, par: [3, 6] } },
  { id: 'fringe', name: 'Tying a fringe', knobs: { n: 18, S: 7, colors: 4, links: 2, target: 0.3, par: [4, 7] } },
  { id: 'macrame', name: 'Macramé', knobs: { n: 20, S: 8, colors: 4, links: 2, fixed: 1, pegs: 2, target: 0.2, par: [5, 8] } },
  // ---- over and under ----
  { id: 'overunder', name: 'Over and under', knobs: { n: 12, S: 4, colors: 2, layering: true, target: 0.35, par: [4, 6] } },
  { id: 'tabby', name: 'Plain weave', knobs: { n: 14, S: 5, colors: 3, layering: true, target: 0.15, par: [5, 8] } },
  { id: 'twill', name: 'Twill', knobs: { n: 16, S: 6, colors: 3, layering: true, target: 0.06, par: [7, 10] } },
  // ---- fewer spare pegs ----
  { id: 'snug', name: 'A snug hoop', knobs: { n: 16, S: 7, colors: 4, target: 0.12, par: [5, 7] } },
  { id: 'crewel', name: 'Crewelwork', knobs: { n: 18, S: 8, colors: 4, fixed: 2, pegs: 2, target: 0.06, par: [6, 9] } },
  { id: 'bargello', name: 'Bargello', knobs: { n: 19, S: 9, colors: 5, links: 1, fixed: 1, target: 0.04, par: [7, 10] } },
  // ---- the finale ----
  { id: 'heirloom', name: 'The heirloom sampler', knobs: { n: 18, S: 7, colors: 5, layering: true, fixed: 1, pegs: 2, target: 0.03, par: [8, 12] } },
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

// Ready-to-play levels: pegs + strands + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HOOPS[d.id]).map((d) => {
  const h = HOOPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, ...h.def });
  const mech = mechanicsOf(L);
  if (sparePegs(L) <= 2) mech.push('spare');
  return Object.assign(L, { solution: h.solution, par: parseMoves(h.solution).length, stats: h.stats, sig: levelSig(L), mechanics: mech });
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
