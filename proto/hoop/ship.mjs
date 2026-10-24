// Authoring tool (not loaded by the page): copies The Hoop's rules, drawing
// and hoops from the prototype into the game, so the two never drift apart.
// Run from the repo root after rules.js, layout.js or gen-levels.mjs changed
// anything:
//   node proto/hoop/ship.mjs
// It writes
//   src/puzzles/hoop.js         rules.js, unchanged under a two-line header
//   src/puzzles/hoop-layout.js  layout.js, importing ./hoop.js
//   src/puzzles/hoop-data.js    hoops.js, byte for byte
// The game's level list (src/puzzles/hoop-levels.js: names, chapters, the
// intro lines) is written by hand; test/hoop.test.js checks all four match the
// prototype.
import { readFileSync, writeFileSync } from 'node:fs';

const P = new URL('./', import.meta.url);
const SRC = new URL('../../src/puzzles/', import.meta.url);
const read = (f) => readFileSync(new URL(f, P), 'utf8');

const rules = read('rules.js');
writeFileSync(new URL('hoop.js', SRC), `// puzzles/hoop.js — The Hoop's rules: a copy of proto/hoop/rules.js written by
// proto/hoop/ship.mjs (do not edit here; edit the prototype and ship it).
${rules}`);

const layout = read('layout.js');
if (!layout.includes("from './rules.js';")) throw new Error('layout.js: its import of rules.js moved');
writeFileSync(new URL('hoop-layout.js', SRC), `// puzzles/hoop-layout.js — The Hoop's drawing of the words: a copy of
// proto/hoop/layout.js written by proto/hoop/ship.mjs (do not edit here).
${layout.replace("from './rules.js';", "from './hoop.js';")}`);

writeFileSync(new URL('hoop-data.js', SRC), read('hoops.js'));
console.log('shipped hoop.js, hoop-layout.js and hoop-data.js');
