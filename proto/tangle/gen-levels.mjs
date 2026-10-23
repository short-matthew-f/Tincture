// Authoring tool (not loaded by the page): builds every basket's heap, proves
// each one solvable with the solver (no spare slot), measures how much
// planning it needs, and writes heaps.js. Run from the repo root:
//   node proto/tangle/gen-levels.mjs              (all levels, in worker threads)
//   ONLY=cat,attic node proto/tangle/gen-levels.mjs   (just these; the rest are kept)
// Deterministic: the same code and seeds always write the same file.
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { LEVEL_DEFS } from './levels.js';
import { makeHeap, heapCandidate } from './gen.js';
import {
  buildLevel, solve, replay, isDone, randomRate, carefulRate, trapSurvey, acyclic, unitsBalanced, mulberry, newState, isUncovered,
} from './rules.js';

const SEEDS = +(process.env.SEEDS || 14);
const DEALS = +(process.env.DEALS || 14);
export const RANDOM_SEED = 4242, RANDOM_RUNS = 400, CAREFUL_RUNS = 200;
const LUCK_GAP = 0.1; // buried colors may cost a careful player at most this much

const lenFor = (k) => k.len;
const r1 = (x) => Math.round(x * 1000) / 1000;

function generateOne(idx) {
  const def = LEVEL_DEFS[idx];
  const k = def.knobs;
  const t0 = Date.now();
  const cands = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const heap = makeHeap(mulberry(seed * 7919 + idx * 131 + 1), { n: k.n, len: lenFor(k), cross: k.n <= 9 ? 2 : 1, knots: k.knots || 0, tries: 140 });
    if (!heap) continue;
    for (let d = 0; d < DEALS; d++) {
      const c = heapCandidate(heap, k, seed, d);
      if (!c) continue;
      const L = buildLevel({ id: def.id, name: def.name, ...c });
      if (!acyclic(L) || !unitsBalanced(L)) continue;
      const rate = randomRate(L, 99 + seed + d, 80);
      const free0 = [...Array(L.n).keys()].filter((i) => isUncovered(L, newState(L), i)).length;
      // early baskets: show some layering (not everything free at the start)
      const layering = k.target >= 0.99 ? Math.max(0, free0 / L.n - 0.5) : 0;
      cands.push({ d: Math.abs(rate - k.target) + layering, seed, deal: d, c, L, rate });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.seed - b.seed || a.deal - b.deal);
  // re-rank the closest few by the rate that gets stored
  const head = cands.slice(0, 10);
  for (const x of head) x.d = Math.abs(randomRate(x.L, RANDOM_SEED, RANDOM_RUNS) - k.target);
  head.sort((a, b) => a.d - b.d || a.seed - b.seed || a.deal - b.deal);
  cands.splice(0, head.length, ...head);
  let tried = 0;
  for (const x of cands) {
    if (++tried > 40) break;
    const sol = solve(x.L, undefined, { cap: 300000 });
    if (!sol.ok) continue;
    if (!isDone(replay(x.L, sol.path))) throw new Error(`${def.id}: solution does not replay`);
    const buried = x.L.strands.some((s) => s.q);
    const careful = carefulRate(x.L, RANDOM_SEED, CAREFUL_RUNS);
    const blind = buried ? carefulRate(x.L, RANDOM_SEED, CAREFUL_RUNS, { blind: true }) : careful;
    if (buried && careful - blind > LUCK_GAP) continue; // hidden colors must not turn it into luck
    const tr = trapSurvey(x.L, sol.path, 3000);
    const free0 = [...Array(x.L.n).keys()].filter((i) => isUncovered(x.L, newState(x.L), i)).length;
    return {
      id: def.id, seed: x.seed, deal: x.deal, slots: x.c.slots,
      strands: x.c.strands, knots: x.c.knots, pins: x.c.pins,
      solution: sol.path.join(' '),
      stats: {
        strands: x.L.n, colors: x.L.colors.length, slots: x.c.slots, pulls: sol.path.length, nodes: sol.nodes,
        random: r1(randomRate(x.L, RANDOM_SEED, RANDOM_RUNS)), careful: r1(careful), blind: r1(blind),
        traps: tr.traps, trapSteps: tr.trapSteps, free: free0,
      },
      ms: Date.now() - t0, candidates: cands.length,
    };
  }
  throw new Error(`${def.id}: no solvable, fair basket among the closest candidates`);
}

if (!isMainThread) {
  parentPort.on('message', (idx) => {
    try { parentPort.postMessage({ idx, res: generateOne(idx) }); } catch (e) { parentPort.postMessage({ idx, err: String(e.stack || e) }); }
  });
} else {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  let old = {};
  try { old = (await import('./heaps.js')).HEAPS; } catch { /* first run */ }
  const todo = LEVEL_DEFS.map((d, i) => i).filter((i) => !only || only.includes(LEVEL_DEFS[i].id));
  const results = new Map();
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    let next = 0, busy = 0;
    const n = Math.min(todo.length, Math.max(1, availableParallelism()));
    for (let w = 0; w < n; w++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next >= todo.length) { worker.terminate(); if (!busy) resolve(); return; }
        busy++; worker.postMessage(todo[next++]);
      };
      worker.on('message', ({ idx, res, err }) => {
        busy--;
        if (err) { reject(new Error(err)); return; }
        results.set(idx, res);
        const s = res.stats;
        console.log(`${res.id.padEnd(10)} strands ${String(s.strands).padStart(2)}  colors ${s.colors}  slots ${s.slots}  pulls ${String(s.pulls).padStart(2)}  nodes ${String(s.nodes).padStart(5)}  random ${(s.random * 100).toFixed(0).padStart(3)}%  careful ${(s.careful * 100).toFixed(0).padStart(3)}%  blind ${(s.blind * 100).toFixed(0).padStart(3)}%  traps ${s.traps}@${s.trapSteps}  free ${s.free}  ${(res.ms / 1000).toFixed(1)} s`);
        if (results.size === todo.length) { worker.terminate(); resolve(); } else feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
  const entries = LEVEL_DEFS.map((d, i) => results.get(i) || (old[d.id] ? { id: d.id, ...old[d.id] } : null)).filter(Boolean);
  const strandSrc = (s) => `{ c: '${s.c}'${s.c2 ? `, c2: '${s.c2}'` : ''}${s.q ? ', q: 1' : ''}, p: [${s.p.join(',')}] }`;
  const body = entries.map((o) => `  ${o.id}: {
    seed: ${o.seed}, deal: ${o.deal}, slots: ${o.slots},
    strands: [
${o.strands.map((s) => `      ${strandSrc(s)},`).join('\n')}
    ],
    knots: ${JSON.stringify(o.knots)}, pins: ${JSON.stringify(o.pins)},
    solution: '${o.solution}',
    stats: ${JSON.stringify(o.stats).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},
  },`).join('\n');
  writeFileSync(new URL('./heaps.js', import.meta.url),
`// Generated by gen-levels.mjs. Do not edit by hand; edit levels.js or the
// generator and run: node proto/tangle/gen-levels.mjs
// Strands are listed bottom to top; p is the control points x0,y0,x1,y1,...
// stats: strands; colors; rack slots; pulls in the stored solution; solver
// nodes to find it; random = how often a player who pulls any allowed strand
// at random clears the basket (seed ${RANDOM_SEED}, ${RANDOM_RUNS} runs); careful = a greedy
// player with no lookahead (${CAREFUL_RUNS} runs); blind = the same player when buried
// colors stay hidden; traps = other allowed pulls along the solution that a
// quick search proves leave no way out, trapSteps = steps with at least one;
// free = strands with nothing on top at the start.
export const HEAPS = {
${body}
};
`);
  console.log(`wrote heaps.js in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
