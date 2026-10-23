// The Lifting Table: palette and hand-made pictures (pure data).
// Art rows are literal letters ("sssoosss") or run-length ("s3 o2 s3").
// Lane queues, keys, solutions and stats live in queues.js (written by gen-levels.mjs).
import { QUEUES } from './queues.js';
import { ART as ART_GEN } from './art.js';
import { ART_IMPORTED } from './art-imported.js';
import { PALETTE } from './palette.js';
import { buildLevel, mechanicsOf, levelSig } from './rules.js';

// Pictures composed by art-gen.mjs, plus any imported from painted sources by
// import-art.mjs (an imported picture with the same id wins).
const ART = { ...ART_GEN, ...ART_IMPORTED };

export { PALETTE };

// What each mechanic is called, and the one line that introduces it.
export const MECHANICS = {
  mystery: { name: 'Mystery jars', line: 'A “?” jar keeps its color secret until it reaches the front of its lane.' },
  linked: { name: 'Tied jars', line: 'Two jars tied with string go onto the belt together, so they need two free places.' },
  mixing: { name: 'Mixing jars', line: 'A mixing jar lifts two colors, a set amount of each, and they blend as it fills.' },
  cloth: { name: 'Muslin cloth', line: 'Nothing lifts through the muslin. It lifts away once a column beside it is bare.' },
  key: { name: 'Keys', line: 'A padlocked lane opens once you lift its key cell out of the painting.' },
  belt3: { name: 'A shorter belt', line: 'Only three jars ride the belt at once on this painting.' },
  bench2: { name: 'A smaller bench', line: 'The bench has two resting spots here, so park with care.' },
};

// Generation knobs (see gen-levels.mjs): lanes; target casual clear rate; and
// the chances the generator uses for each mechanic.
export const LEVEL_DEFS = [
  // ---- learning the table ----
  { id: 'sun', name: 'Morning sun', noun: 'morning sun', lanes: 2, gen: { target: 0.95, caps: [5, 8, 10] },
    art: ['ssssssss', 'sssoosss', 'ssooooss', 'ssooooss', 'sssoosss', 'ssssssss', 'gggsssgg', 'gggggggg'] },
  { id: 'tulip', name: 'Tulip', noun: 'tulip', lanes: 2, gen: { target: 0.9, future: 0.05 },
    art: ['ccccccccc', 'ccrcrcrcc', 'ccrrrrrcc', 'ccrrprrcc', 'cccrrrccc', 'ccccgcccc', 'cggcgcggc', 'ccgggggcc',
      'cckkkkkcc', 'ccckkkccc', 'ccckkkccc'] },
  { id: 'teacup', name: 'Teacup', noun: 'teacup', lanes: 3, gen: { target: 0.85, future: 0.1 },
    art: ['hhhhhhhhhhh', 'hhhhchchhhh', 'hhhchchhhhh', 'hcaaaaaachh', 'hccbccbccch', 'hcbcbcbcchc', 'hccbccbccch',
      'hhcccccchhh', 'hllllllllhh', 'hhhhhhhhhhh'] },
  { id: 'sail', name: 'Sailboat', noun: 'sailboat', lanes: 3, gen: { target: 0.8, future: 0.15 },
    art: ['sssssssssss', 'ssssskrssss', 'sssscksssss', 'ssscckcssss', 'ssccckccsss', 'scccckcccss', 'sssssksssss',
      'skkkkkkkkks', 'sskkkkkkkss', 'bbbbbbbbbbb', 'bbsbbbbbsbb'] },
  // ---- mystery jars ----
  { id: 'skein', name: 'Skein of wool', noun: 'skein', lanes: 3, art: ART.skein, gen: { target: 0.6, future: 0.15, mystery: 0.35, caps: [5, 8, 10, 12] } },
  { id: 'mushrooms', name: 'Toadstools', noun: 'toadstools', lanes: 3, art: ART.mushrooms, gen: { target: 0.5, future: 0.2, mystery: 0.3, caps: [8, 10, 12, 15] } },
  { id: 'sheep', name: 'Sheep in the meadow', noun: 'sheep', lanes: 4, art: ART.sheep, gen: { target: 0.42, future: 0.25, mystery: 0.3, caps: [8, 10, 12, 15] } },
  // ---- tied jars ----
  { id: 'cherries', name: 'Cherries', noun: 'cherries', lanes: 3, art: ART.cherries, gen: { target: 0.45, future: 0.15, link: 0.3, caps: [8, 10, 12, 15] } },
  { id: 'cottage', name: 'Cottage garden', noun: 'cottage garden', lanes: 4, art: ART.cottage, gen: { target: 0.3, future: 0.25, link: 0.25, mystery: 0.2, caps: [8, 10, 12, 15, 20] } },
  { id: 'apple', name: 'Apple tree', noun: 'apple tree', lanes: 4, art: ART.apple, gen: { target: 0.17, future: 0.3, link: 0.25, mystery: 0.25, caps: [8, 10, 12, 15, 20] } },
  // ---- mixing jars ----
  { id: 'lighthouse', name: 'Lighthouse at sunset', noun: 'lighthouse', lanes: 4, art: ART.lighthouse, gen: { target: 0.3, future: 0.25, mix: 0.35, caps: [10, 12, 15, 20] } },
  { id: 'cat', name: 'Cat on the sill', noun: 'cat', lanes: 4, art: ART.cat, gen: { target: 0.2, future: 0.3, mix: 0.25, link: 0.2, mystery: 0.25, caps: [10, 12, 15, 20] } },
  { id: 'teapot', name: 'Tea for two', noun: 'tea table', lanes: 4, art: ART.teapot, gen: { target: 0.12, future: 0.35, mix: 0.25, link: 0.2, mystery: 0.25, caps: [10, 12, 15, 20] } },
  // ---- muslin cloth ----
  { id: 'quilt', name: 'Quilt on the line', noun: 'quilt', lanes: 4, cover: [13], art: ART.quilt, gen: { target: 0.1, future: 0.15, mix: 0.1, caps: [10, 12, 15, 20] } },
  { id: 'hedgehog', name: 'Hedgehog in the leaves', noun: 'hedgehog', lanes: 4, cover: [12], art: ART.hedgehog, gen: { target: 0.07, future: 0.2, mix: 0.2, link: 0.2, mystery: 0.3, caps: [10, 12, 15, 20] } },
  { id: 'bee', name: 'Bee and clover', noun: 'bee and clover', lanes: 4, cover: [6, 17], art: ART.bee, gen: { target: 0.05, future: 0.25, mix: 0.25, link: 0.2, mystery: 0.3, caps: [10, 12, 15, 20] } },
  // ---- keys ----
  { id: 'birdhouse', name: 'Birdhouse', noun: 'birdhouse', lanes: 4, art: ART.birdhouse, gen: { target: 0.06, future: 0.3, link: 0.15, locks: 1, caps: [10, 12, 15, 20] } },
  { id: 'loom', name: 'Half-woven cloth', noun: 'weaving', lanes: 4, art: ART.loom, gen: { target: 0.04, future: 0.4, mix: 0.2, link: 0.2, mystery: 0.25, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'owl', name: 'Owl at night', noun: 'owl', lanes: 4, cover: [12], art: ART.owl, gen: { target: 0.03, future: 0.4, mix: 0.25, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  // ---- the whole table ----
  { id: 'fox', name: 'Fox in autumn leaves', noun: 'fox', lanes: 4, slots: 3, cover: [14], art: ART.fox, gen: { target: 0.08, future: 0.35, mix: 0.2, link: 0.15, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'harbor', name: 'Harbor', noun: 'harbor', lanes: 4, slots: 3, cover: [12, 24], art: ART.harbor, gen: { target: 0.07, future: 0.4, mix: 0.25, link: 0.15, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'wheel', name: 'Spinning wheel', noun: 'spinning wheel', lanes: 4, slots: 3, cover: [20], art: ART.wheel, gen: { target: 0.06, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'dyepot', name: 'Dye pot on the fire', noun: 'dye pot', lanes: 4, slots: 3, bench: 2, cover: [14], art: ART.dyepot, gen: { target: 0.03, future: 0.5, mix: 0.3, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'strawberries', name: 'Bowl of strawberries', noun: 'strawberries', lanes: 4, slots: 3, bench: 2, cover: [7, 20], art: ART.strawberries, gen: { target: 0.05, future: 0.4, mix: 0.3, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'mittens', name: 'Mittens on the line', noun: 'mittens', lanes: 4, slots: 3, bench: 2, cover: [15], art: ART.mittens, gen: { target: 0.04, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'village', name: 'Village at dusk', noun: 'village', lanes: 4, slots: 3, bench: 2, cover: [10, 20], art: ART.village, gen: { target: 0.03, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'sampler', name: 'Cross-stitch sampler', noun: 'sampler', lanes: 4, slots: 3, bench: 2, cover: [14, 15], art: ART.sampler, gen: { target: 0.02, future: 0.45, mix: 0.3, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
];

// Bands for the gallery wall and the difficulty checks.
export const BANDS = [
  { name: 'Learning the table', from: 0 },
  { name: 'Mystery jars', from: 4 },
  { name: 'Tied jars', from: 7 },
  { name: 'Mixing jars', from: 10 },
  { name: 'Muslin cloth', from: 13 },
  { name: 'Keys', from: 16 },
  { name: 'The whole table', from: 19 },
];

// Ready-to-play levels: art + lanes + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.map((d) => {
  const q = QUEUES[d.id] || { queues: [], locks: [], solution: '', stats: null };
  const L = buildLevel({ ...d, queues: q.queues, locks: q.locks });
  const mech = mechanicsOf(L);
  if (L.slots < 4) mech.add('belt3');
  if (L.bench < 3) mech.add('bench2');
  return { ...L, solution: q.solution, stats: q.stats, sig: levelSig(L), mechanics: [...mech] };
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
