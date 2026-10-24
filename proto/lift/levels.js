// The Lifting Table's paintings, ready to play (pure data): the definitions in
// chapters.js with their lanes, keys, muslin, jars left out, stored solutions
// and stats from queues.js (written by gen-levels.mjs).
import { QUEUES } from './queues.js';
import { LEVEL_DEFS, CHAPTERS, MECHANICS, PALETTE } from './chapters.js';
import { buildLevel, mechanicsOf, levelSig } from './rules.js';

export { LEVEL_DEFS, CHAPTERS, MECHANICS, PALETTE };

// Ready-to-play levels: art + lanes + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.map((d) => {
  const q = QUEUES[d.id] || { queues: [], locks: [], solution: '', stats: null };
  if (!d.art) throw new Error(`${d.id}: no picture (art.js or art-imported.js)`);
  const L = buildLevel({ ...d, queues: q.queues, locks: q.locks, cover: q.cover || d.cover, left: q.left });
  const mech = mechanicsOf(L);
  if (L.slots < 4) mech.add('belt3');
  if (L.bench < 3) mech.add('bench2');
  return { ...L, chapter: d.chapter, solution: q.solution, stats: q.stats, sig: levelSig(L), mechanics: [...mech] };
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
export const chapterOf = (id) => CHAPTERS.find((c) => c.id === (levelById(id) || {}).chapter) || null;
