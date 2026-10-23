// Authoring tool (not loaded by the page): deals the lane queues for every
// level, proves each one solvable with the solver (no nudge), measures how much
// planning it needs, and writes queues.js. Run from the repo root:
//   node proto/lift/gen-levels.mjs            (all levels, 4 worker threads)
//   ONLY=fox,owl node proto/lift/gen-levels.mjs   (just these; the rest are kept)
// Deterministic: the same code and seeds always write the same file.
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { LEVEL_DEFS } from './levels.js';
import {
  buildLevel, generateQueues, solve, casualRate, replay, isDone, capacitiesMatch, firstMoveSurvey, minParks, trapSurvey,
} from './rules.js';

const SEEDS = +(process.env.SEEDS || 24);
const FITS = [0.95, 0.8, 0.65, 0.5, 0.35];
const SOLVE_CAP = 60000;
const RERANK = 12;
export const CASUAL_SEED = 4242, CASUAL_RUNS = 100;

function generateOne(idx) {
  const def = LEVEL_DEFS[idx];
  const t0 = Date.now();
  const base = buildLevel(def);
  const gen = def.gen || {};
  const cands = [];
  for (const fit of FITS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generateQueues(base, { lanes: def.lanes, seed: seed + Math.round(fit * 1000), ...gen, fit });
      if (!g) continue;
      const L = buildLevel({ ...def, queues: g.queues, locks: g.locks });
      if (!capacitiesMatch(L)) throw new Error(`${def.id}: capacities do not match`);
      const rate = casualRate(L, 99 + seed, 40);
      cands.push({ d: Math.abs(rate - gen.target), fit, seed, g, L, rate });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.seed - b.seed || b.fit - a.fit);
  // The quick 40-run estimate is noisy, so re-rank the closest few by the rate
  // that gets stored (the 100-run casual measure) before picking one.
  const head = cands.slice(0, RERANK);
  for (const c of head) c.d = Math.abs(casualRate(c.L, CASUAL_SEED, CASUAL_RUNS) - gen.target);
  head.sort((a, b) => a.d - b.d || a.seed - b.seed || b.fit - a.fit);
  cands.splice(0, head.length, ...head);
  // Late levels (target under 15%) all sit near 0% casual, so among the
  // closest few solved layouts keep the one with the most trap steps.
  const late = gen.target < 0.15;
  const want = late ? 5 : 1;
  const solved = [];
  let tried = 0;
  for (const c of cands) {
    if (++tried > 16 || solved.length >= want) break;
    if (late && c.d > 0.08 && solved.length) break;
    const sol = solve(c.L, undefined, { cap: SOLVE_CAP });
    if (!sol.ok) continue;
    if (!isDone(replay(c.L, sol.path))) throw new Error(`${def.id}: solution does not replay`);
    solved.push({ c, sol, tr: trapSurvey(c.L, sol.path) });
  }
  solved.sort((a, b) => b.tr.trapSteps - a.tr.trapSteps);
  for (const { c, sol, tr } of solved) {
    const casual = casualRate(c.L, CASUAL_SEED, CASUAL_RUNS);
    const survey = firstMoveSurvey(c.L, 20000, 150000);
    const mp = minParks(c.L, undefined, 30000);
    const parksInSolution = sol.path.filter((m) => m[0] === 'P').length;
    return {
      id: def.id, seed: c.seed, fit: c.fit, queues: c.g.queues, locks: c.g.locks, solution: sol.path.join(' '),
      stats: {
        jars: c.g.intended, moves: sol.path.length, nodes: sol.nodes, casual,
        firstMoves: survey.total, losing: survey.losing, unknown: survey.unknown,
        parks: mp.exact ? mp.parks : parksInSolution, parksExact: mp.exact,
        traps: tr.traps, trapSteps: tr.trapSteps,
      },
      ms: Date.now() - t0, candidates: cands.length,
    };
  }
  throw new Error(`${def.id}: no solvable layout found among the closest candidates`);
}

if (!isMainThread) {
  parentPort.on('message', (idx) => {
    try { parentPort.postMessage({ idx, res: generateOne(idx) }); } catch (e) { parentPort.postMessage({ idx, err: String(e.stack || e) }); }
  });
} else {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const old = only ? (await import('./queues.js')).QUEUES : {};
  const todo = LEVEL_DEFS.map((d, i) => i).filter((i) => !only || only.includes(LEVEL_DEFS[i].id));
  const results = new Map();
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    let next = 0, busy = 0;
    const n = Math.min(todo.length, Math.max(1, availableParallelism()));
    for (let w = 0; w < n; w++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: {} });
      const feed = () => {
        if (next >= todo.length) { worker.terminate(); if (!busy) resolve(); return; }
        busy++; worker.postMessage(todo[next++]);
      };
      worker.on('message', ({ idx, res, err }) => {
        busy--;
        if (err) { reject(new Error(err)); return; }
        results.set(idx, res);
        const s = res.stats;
        console.log(`${res.id.padEnd(13)} jars ${String(s.jars).padStart(3)}  moves ${String(s.moves).padStart(3)}  nodes ${String(s.nodes).padStart(6)}  casual ${(s.casual * 100).toFixed(0).padStart(3)}%  losing ${s.losing}/${s.firstMoves}${s.unknown ? ` (?${s.unknown})` : ''}  parks ${s.parks}${s.parksExact ? '' : '+'}  traps ${s.traps}@${s.trapSteps}  fit ${res.fit}  ${(res.ms / 1000).toFixed(1)} s`);
        if (results.size === todo.length) { worker.terminate(); resolve(); } else feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
  void workerData;
  const entries = LEVEL_DEFS.map((d, i) => results.get(i) || (old[d.id] ? { id: d.id, ...old[d.id] } : null)).filter(Boolean);
  const body = entries.map((o) => `  ${o.id}: {\n    seed: ${o.seed}, fit: ${o.fit},\n    queues: [\n${o.queues.map((q) => `      '${q}',`).join('\n')}\n    ],\n    locks: ${JSON.stringify(o.locks)},\n    solution: '${o.solution}',\n    stats: ${JSON.stringify(o.stats).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},\n  },`).join('\n');
  writeFileSync(new URL('./queues.js', import.meta.url),
`// Generated by gen-levels.mjs. Do not edit by hand; edit levels.js or the
// generator and run: node proto/lift/gen-levels.mjs
// stats: jars in the level; solver solution length in moves and nodes expanded;
// casual = how often a random "lift when you can" player clears it without help
// (seed ${CASUAL_SEED}, ${CASUAL_RUNS} runs); losing / firstMoves = first moves proved to leave
// no clear (unknown = search ran out); parks = fewest parks any clear needs
// (parksExact false: an upper bound from the stored solution); traps = other
// moves along the solution that a quick search proves dead, trapSteps = how
// many steps have at least one.
export const QUEUES = {
${body}
};
`);
  console.log(`wrote queues.js in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
