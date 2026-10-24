// Authoring tool (not loaded by the page): copies the Lifting Table's data from
// the prototype into the game, so the two never drift apart. Run from the repo
// root after art-gen.mjs, import-art.mjs or gen-levels.mjs changed anything:
//   node proto/lift/ship.mjs
// It writes
//   src/puzzles/lift-levels.js  palette, mechanics, chapters and the paintings
//                               (only what play needs: no generator knobs)
//   src/puzzles/lift-art.js     every painting's picture, one compact string each
//   src/puzzles/lift-queues.js  lanes, keys, muslin, jars left out, solutions, stats
// test/lift.test.js checks the game's copy matches the prototype cell for cell.
import { writeFileSync } from 'node:fs';
import { LEVEL_DEFS, CHAPTERS, MECHANICS, PALETTE } from './levels.js';
import { QUEUES } from './queues.js';
import { parseRow, rowString } from './rules.js';

const SRC = new URL('../../src/puzzles/', import.meta.url);
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const obj = (o) => `{ ${Object.entries(o).map(([k, v]) => `${/^[a-z_]\w*$/i.test(k) ? k : q(k)}: ${Array.isArray(v) ? `[${v.map((x) => (typeof x === 'string' ? q(x) : JSON.stringify(x))).join(', ')}]` : typeof v === 'string' ? q(v) : JSON.stringify(v)}`).join(', ')} }`;

// ---- the pictures: rows in compact run-length form, joined by "/" ----
const art = LEVEL_DEFS.map((d) => `  ${d.id}: '${d.art.map((r) => rowString(parseRow(r))).join('/')}',`);
writeFileSync(new URL('lift-art.js', SRC), `// puzzles/lift-art.js — The Lifting Table's pictures (pure data), written by
// proto/lift/ship.mjs from the prototype's art (proto/lift/art.js, composed by
// art-gen.mjs, and art-imported.js, from painted sources by import-art.mjs).
// One string a picture: its rows joined by "/", each row as runs of a palette
// letter (lift-levels.js PALETTE) followed by the run's length when it is over
// one ("s3o2s3" = sssoosss); puzzles/lift.js parseRow reads them. Do not edit by
// hand: re-run the proto tools and ship.mjs (test/lift.test.js checks they match
// the prototype cell for cell).
export const ART = {
${art.join('\n')}
};
`);

// ---- the lanes, keys, solutions and stats: a copy of proto/lift/queues.js ----
const qbody = LEVEL_DEFS.map((d) => {
  const o = QUEUES[d.id];
  if (!o) throw new Error(`${d.id}: no queues yet (run gen-levels.mjs)`);
  return `  ${d.id}: {\n    seed: ${o.seed}, fit: ${o.fit},\n    queues: [\n${o.queues.map((x) => `      '${x}',`).join('\n')}\n    ],\n    locks: ${JSON.stringify(o.locks)},\n${o.cover ? `    cover: ${JSON.stringify(o.cover)},\n` : ''}${o.left ? `    left: [${o.left.map(q).join(', ')}],\n` : ''}    solution: '${o.solution}',\n    stats: ${JSON.stringify(o.stats).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},\n  },`;
}).join('\n');
writeFileSync(new URL('lift-queues.js', SRC), `// puzzles/lift-queues.js — The Lifting Table's lanes, keys, muslin, jars left
// out, stored solutions and difficulty stats (pure data), copied from
// proto/lift/queues.js (written by proto/lift/gen-levels.mjs) by
// proto/lift/ship.mjs. Do not edit by hand: regenerate in proto/lift/, then
// ship (test/lift.test.js checks they match).
// stats: jars in the level; solver solution length in moves and nodes expanded;
// casual = how often a random "lift when you can" player clears it without help
// (seed 4242, 100 runs); losing / firstMoves = first moves proved to leave
// no clear (unknown = search ran out); parks = fewest parks any clear needs
// (parksExact false: an upper bound from the stored solution); traps = other
// moves along the solution that a quick search proves dead, trapSteps = how
// many steps have at least one.
export const QUEUES = {
${qbody}
};
`);

// ---- palette, mechanics, chapters and the paintings ----
const pal = Object.entries(PALETTE).map(([k, v]) => `  ${k}: ${obj(v)},`).join('\n');
const mech = Object.entries(MECHANICS).map(([k, v]) => `  ${k}: ${obj(v)},`).join('\n');
const chs = CHAPTERS.map((c) => `  ${obj(c)},`).join('\n');
const defs = LEVEL_DEFS.map((d) => {
  const extra = {};
  if (d.slots !== undefined) extra.slots = d.slots;
  if (d.bench !== undefined) extra.bench = d.bench;
  if (d.cover) extra.cover = d.cover;
  return `  [${q(d.id)}, ${q(d.name)}, ${q(d.noun)}, ${q(d.chapter)}${Object.keys(extra).length ? `, ${obj(extra)}` : ''}],`;
}).join('\n');
writeFileSync(new URL('lift-levels.js', SRC), `// puzzles/lift-levels.js — The Lifting Table's palette, mechanics, chapters and
// paintings (pure data), written by proto/lift/ship.mjs from proto/lift/chapters.js
// (the prototype is the source; its generator knobs stay there). Pictures live in
// lift-art.js; lanes, keys, muslin, jars left out, stored solutions and stats in
// lift-queues.js. Do not edit by hand: edit the prototype and ship
// (test/lift.test.js checks the two match painting for painting).
import { QUEUES } from './lift-queues.js';
import { ART } from './lift-art.js';
import { buildLevel, mechanicsOf, levelSig } from './lift.js';

// Soft natural pigments, one letter each. Glyph names map to the shapes in
// src/ui/lift.js (color symbols for colorblind play).
export const PALETTE = Object.freeze({
${pal}
});

// What each mechanic is called, and the one line that introduces it.
export const MECHANICS = Object.freeze({
${mech}
});

// The gallery wall's rooms, in order: paintings [from, to) of LEVELS. A chapter
// opens once every painting of the one before is lifted; inside a chapter, each
// painting opens once the one before it is lifted (src/sim/lift.js).
export const CHAPTERS = Object.freeze([
${chs}
].map((c) => Object.freeze(c)));

// [id, name, noun, chapter, {slots, bench, cover}] in play order.
const DEFS = [
${defs}
];

// Ready-to-play levels: art + lanes + a known solution (verified by the tests).
export const LEVELS = DEFS.map(([id, name, noun, chapter, extra = {}]) => {
  const q = QUEUES[id] || { queues: [], locks: [], solution: '', stats: null };
  const L = buildLevel({ id, name, noun, ...extra, art: ART[id].split('/'), queues: q.queues, locks: q.locks, cover: q.cover || extra.cover, left: q.left });
  const mech = mechanicsOf(L);
  if (L.slots < 4) mech.add('belt3');
  if (L.bench < 3) mech.add('bench2');
  return { ...L, chapter, solution: q.solution, stats: q.stats, sig: levelSig(L), mechanics: [...mech] };
});
export const LEVEL_IDS = Object.freeze(LEVELS.map((L) => L.id));
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
export const levelById = (id) => BY_ID.get(id) || null;
const CH_BY_ID = new Map(CHAPTERS.map((c, i) => [c.id, i]));
/** chapterIndex(levelId) -> the index in CHAPTERS of the chapter a painting hangs in (-1 when unknown). */
export const chapterIndex = (id) => { const L = BY_ID.get(id); return L ? CH_BY_ID.get(L.chapter) : -1; };
`);
console.log(`shipped ${LEVEL_DEFS.length} paintings in ${CHAPTERS.length} chapters to src/puzzles/lift-{levels,art,queues}.js`);
