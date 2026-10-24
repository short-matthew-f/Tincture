// proto/skeins/survey.mjs — verifies every Skein Stacks level offline with the
// planning bot (src/puzzles/skeins.js botSolve) on several seeds, and reports
// a compact table per chapter and per level: the bot's nudges (pegs it had to
// clear; average and most), its placements, trays used against the basket, and
// a casual player's feel of it (it merges greedily, else drops the stack on a
// seeded-random empty peg): "snug", the share of its placements made with 3 or
// fewer free pegs, and its nudges (a * marks a level it cannot finish: one
// that asks for aim, like untangling every snarl).
//
// Run: node proto/skeins/survey.mjs [--seeds N] [--levels] [--boards] [--from L --to L]
// Exit code 1 when a level does not finish, or the bot needs more than
// MAX_NUDGES on any seed.

import * as R from '../../src/puzzles/skeins.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const SEEDS = [11, 3333, 5, 77, 2024, 31337, 8, 4242, 99, 123457].slice(0, opt('--seeds', 6));
const FROM = opt('--from', 1) - 1;
const TO = Math.min(R.LEVELS.length, opt('--to', R.LEVELS.length));
export const MAX_NUDGES = 3;

function boardArt(li) {
  const b = R.board(li);
  const L = R.LEVELS[li];
  const s = R.newLevel(li, 1);
  const mark = (i) => {
    const c = b.cells[i];
    if (c.knot) return '##';
    if (b.snarls.includes(i)) return 'xx';
    if (b.felts.includes(i)) return 'ff';
    if (b.spindles.includes(i)) return '@@';
    return '()';
  };
  const rows = [];
  for (let r = 0; r < b.rows; r++) {
    let line = r & 1 ? ' ' : '';
    for (let c = 0; c < b.cols; c++) {
      const i = b.cells.findIndex((x) => x.col === c && x.row === r);
      line += i < 0 ? '  ' : mark(i);
    }
    rows.push(line.replace(/\s+$/, ''));
  }
  return `${L.id} ${L.name} (${L.shape}, ${s.stacks.filter((x) => x !== null).length} pegs)\n${rows.join('\n')}`;
}

/** A casual player: the biggest merge if there is one, else a random stack on a random empty peg. */
function casualPlay(li, seed, maxMoves = 400) {
  let s = R.newLevel(li, seed), nudges = 0, snug = 0;
  let r = Math.imul(seed, 2654435761) >>> 0;
  const rnd = () => { r = (r + 0x6D2B79F5) >>> 0; let t = r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  while (!s.done && s.moves < maxMoves) {
    const empty = R.emptyPegs(s);
    if (!empty.length) { s = R.clearPeg(s, R.botClearChoice(s)).state; nudges++; continue; }
    if (empty.length <= 3) snug++;
    const m = R.bestPlacement(s);
    if (m.gain > 0) { s = R.place(s, m.t, m.cell).state; continue; }
    const ts = [0, 1, 2].filter((t) => s.tray[t]);
    s = R.place(s, ts[Math.floor(rnd() * ts.length)], empty[Math.floor(rnd() * empty.length)]).state;
  }
  return { done: s.done, nudges, moves: s.moves, snug: snug / Math.max(1, s.moves) };
}

const t0 = Date.now();
const per = [];
let fails = 0;
for (let li = FROM; li < TO; li++) {
  const runs = SEEDS.map((sd) => R.botSolve(li, sd));
  const casual = SEEDS.map((sd) => casualPlay(li, sd));
  const g = R.goalOf(li);
  const row = {
    li, id: R.LEVELS[li].id, name: R.LEVELS[li].name, ch: R.chapterOf(li),
    done: runs.every((r) => r.done),
    nAvg: runs.reduce((a, r) => a + r.nudges, 0) / runs.length,
    nMax: Math.max(...runs.map((r) => r.nudges)),
    moves: runs.reduce((a, r) => a + r.moves, 0) / runs.length,
    deals: Math.max(...runs.map((r) => r.deals)),
    trays: g.trays,
    casual: casual.reduce((a, r) => a + r.nudges, 0) / casual.length,
    cDone: casual.filter((r) => r.done).length / casual.length,
    snug: casual.reduce((a, r) => a + r.snug, 0) / casual.length,
    colors: R.LEVELS[li].colors,
    mech: R.levelMechanics(li),
  };
  if (!row.done || row.nMax > MAX_NUDGES) fails++;
  per.push(row);
  if (args.includes('--boards')) console.log(boardArt(li) + '\n');
}

const f1 = (x) => x.toFixed(1);
if (args.includes('--levels')) {
  console.log('level                              mechanics            k  nudges avg/max  placements  trays(basket)  casual: nudges snug');
  for (const r of per) {
    console.log(`${(r.id + ' ' + r.name).padEnd(34).slice(0, 34)} ${r.mech.join(',').padEnd(20).slice(0, 20)} ${r.colors} ${f1(r.nAvg).padStart(5)} / ${String(r.nMax).padEnd(4)}  ${f1(r.moves).padStart(9)}  ${String(r.deals).padStart(5)}${r.trays ? `(${r.trays})` : '    '}            ${f1(r.casual).padStart(4)}${r.cDone < 1 ? '*' : ' '} ${(r.snug * 100).toFixed(0).padStart(3)}%${r.done && r.nMax <= MAX_NUDGES ? '' : '  <-- CHECK'}`);
  }
  console.log('');
}
console.log('| Chapter | Levels | Bot nudges avg | Bot nudges max | Avg placements (first -> last) | Casual nudges avg | Casual snug |');
console.log('|---|---|---|---|---|---|---|');
for (let c = 0; c < R.CHAPTERS.length; c++) {
  const rows = per.filter((r) => r.ch === c);
  if (!rows.length) continue;
  const s = R.chapterStart(c);
  const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  console.log(`| ${c + 1}. ${R.CHAPTERS[c].name} | ${s + 1}-${s + R.CHAPTERS[c].levels} | ${avg('nAvg').toFixed(2)} | ${Math.max(...rows.map((r) => r.nMax))} | ${f1(avg('moves'))} (${rows[0].moves.toFixed(0)} -> ${rows[rows.length - 1].moves.toFixed(0)}) | ${avg('casual').toFixed(2)} | ${(avg('snug') * 100).toFixed(1)}% |`);
}
console.log(`\n${per.length} levels x ${SEEDS.length} seeds in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${fails ? `${fails} level(s) need a look` : `every level finishes with at most ${MAX_NUDGES} nudges`}`);
process.exit(fails ? 1 : 0);
