// Authoring tool (not loaded by the page): builds every basket's heap, proves
// each one solvable with the solver (no spare slot) within a node cap,
// measures how much planning it needs, and writes heaps.js. Run from the repo root:
//   node proto/tangle/gen-levels.mjs              (all levels, in worker threads)
//   ONLY=cat,attic node proto/tangle/gen-levels.mjs   (just these; the rest are kept)
// Deterministic: the same code and seeds always write the same file.
// heaps.js is written after every finished basket (so a long run keeps what it
// made), and a basket that cannot be made is reported and skipped (the run
// goes on; fix its knobs and run it again with ONLY=).
//   WORKERS=n   worker threads (default: every core)
// The file stores control points packed as text (see packPoints): one tenth of
// a unit is exact, so the unpacked numbers are exactly the ones generated.
import { writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { LEVEL_DEFS } from './levels.js';
import { makeHeap, heapCandidate } from './gen.js';
import {
  buildLevel, solve, replay, isDone, randomRate, carefulRate, acyclic, unitsBalanced, mulberry, newState, isUncovered,
  dependencyCycles, clearsWithRoom, depths, whyNot, pull, mechanicsOf, levelSig,
} from './rules.js';

const SEEDS = +(process.env.SEEDS || 40);   // geometry seeds tried at most
const HEAPS_WANTED = +(process.env.HEAPS || 4); // stop once this many heaps came out
const DEALS = +(process.env.DEALS || 12);
const MORE_HEAPS = +(process.env.MORE_HEAPS || 6); // extra heaps for the gnarliest (target < 0.1)
export const RANDOM_SEED = 4242, RANDOM_RUNS = 400, CAREFUL_RUNS = 200;
export const NODE_CAP = 300000;
const LUCK_GAP = 0.1; // buried colors may cost a careful player at most this much
const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

export function boardOf(k) { const s = k.size || 1; return { w: r1(100 * s), h: r1(140 * s) }; }
export function heapKnobs(k) {
  return {
    n: k.n, len: k.len, cross: k.n <= 9 ? 2 : k.n <= 24 ? 3 : 4, loop: k.loop || 0, knots: k.knots || 0,
    pegs: k.pegs || 0, tips: k.tips || 0, board: boardOf(k), tries: 140,
  };
}

// Along a solution, does every kind of fixing actually hold a free strand back at some point?
function felt(L, path) {
  let s = newState(L);
  const pin = new Set(), peg = new Set(), knot = new Set();
  for (const m of path) {
    for (const [p] of L.pins) if (whyNot(L, s, p)?.reason === 'pinned') pin.add(p);
    for (const [p] of L.pegs) if (whyNot(L, s, p)?.reason === 'pegged') peg.add(p);
    for (const [a, b] of L.knots) if (!s.out[a] && isUncovered(L, s, a) !== isUncovered(L, s, b)) knot.add(a);
    s = pull(L, s, m).state;
  }
  return (!L.pins.length || pin.size) && (!L.pegs.length || peg.size) && (!L.knots.length || knot.size);
}

export function generateOne(idx) {
  const def = LEVEL_DEFS[idx];
  const k = def.knobs;
  const t0 = Date.now();
  const cands = [];
  let heaps = 0;
  const want = HEAPS_WANTED + (k.target < 0.1 ? MORE_HEAPS : 0); // the gnarliest get more heaps to choose from
  for (let seed = 1; seed <= SEEDS && heaps < want; seed++) {
    const heap = makeHeap(mulberry(seed * 7919 + idx * 131 + 1), heapKnobs(k));
    if (!heap) continue;
    heaps++;
    for (let d = 0; d < DEALS; d++) {
      const c = heapCandidate(heap, k, seed, d);
      if (!c) continue;
      const L = buildLevel({ id: def.id, name: def.name, ...c });
      if (!acyclic(L) || !unitsBalanced(L)) continue;
      const rate = randomRate(L, 99 + seed + d, 60);
      const free0 = [...Array(L.n).keys()].filter((i) => isUncovered(L, newState(L), i)).length;
      // early baskets: show some layering (not everything free at the start)
      const layering = k.target >= 0.99 ? Math.abs(free0 / L.n - 0.4) : 0;
      cands.push({ d: Math.abs(rate - k.target) + layering, layering, seed, deal: d, c, L, rate });
    }
  }
  if (!cands.length) throw new Error(`${def.id}: no heap came out (${heaps} heaps)`);
  cands.sort((a, b) => a.d - b.d || a.seed - b.seed || a.deal - b.deal);
  // re-rank the closest few by the rate that gets stored
  const head = cands.slice(0, 8);
  for (const x of head) x.d = Math.abs(randomRate(x.L, RANDOM_SEED, RANDOM_RUNS) - k.target) + x.layering;
  head.sort((a, b) => a.d - b.d || a.seed - b.seed || a.deal - b.deal);
  cands.splice(0, head.length, ...head);
  let tried = 0;
  for (const x of cands) {
    if (++tried > 30) break;
    const sol = solve(x.L, undefined, { cap: NODE_CAP });
    if (!sol.ok) continue;
    if (!felt(x.L, sol.path)) continue; // every pin, peg and knot holds something back along the way
    if (!isDone(replay(x.L, sol.path))) throw new Error(`${def.id}: solution does not replay`);
    if (JSON.stringify(dependencyCycles(x.L)) !== JSON.stringify(x.L.snarls) || !clearsWithRoom(x.L)) throw new Error(`${def.id}: a cycle that is not a snarl`);
    const buried = x.L.strands.some((s) => s.q);
    const careful = carefulRate(x.L, RANDOM_SEED, CAREFUL_RUNS);
    const blind = buried ? carefulRate(x.L, RANDOM_SEED, CAREFUL_RUNS, { blind: true }) : careful;
    if (buried && careful - blind > LUCK_GAP) continue; // hidden colors must not turn it into luck
    const free0 = [...Array(x.L.n).keys()].filter((i) => isUncovered(x.L, newState(x.L), i)).length;
    return {
      id: def.id, seed: x.seed, deal: x.deal, slots: x.c.slots, board: x.c.board,
      strands: x.c.strands, knots: x.c.knots, pins: x.c.pins, pegs: x.c.pegs, flips: x.c.flips, snarls: x.c.snarls,
      solution: sol.path.join(' '),
      stats: {
        strands: x.L.n, colors: x.L.colors.length, slots: x.c.slots, pulls: sol.path.length, nodes: sol.nodes,
        random: r3(randomRate(x.L, RANDOM_SEED, RANDOM_RUNS)), careful: r3(careful), blind: r3(blind),
        snarls: x.L.snarls.length, rings: x.L.snarls.filter((s) => s.length > 2).length, depth: Math.max(...depths(x.L)),
        crossings: x.L.cross.length, loops: x.L.cross.filter((c) => c.self).length, tucks: x.L.tucks, pegs: x.L.pegs.length, free: free0,
      },
      ms: Date.now() - t0, candidates: cands.length, heaps,
    };
  }
  throw new Error(`${def.id}: no solvable, fair basket among the closest candidates`);
}

// ---------- the packed file ----------
// A strand's control points, in tenths of a unit: the first point as two
// 12-bit numbers (4 characters), then each next point as the step from the one
// before, two 9-bit numbers (3 characters, steps within +-255 tenths).
const PACK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function packPoints(p) {
  let out = '', px = 0, py = 0;
  for (let k = 0; k < p.length; k += 2) {
    const x = Math.round(p[k] * 10), y = Math.round(p[k + 1] * 10);
    if (Math.abs(x / 10 - p[k]) > 1e-9 || Math.abs(y / 10 - p[k + 1]) > 1e-9) throw new Error(`point ${p[k]},${p[k + 1]} is not in tenths`);
    if (k === 0) {
      if (x < 0 || y < 0 || x >= 4096 || y >= 4096) throw new Error(`point ${x},${y} is off the packable board`);
      out += PACK[x >> 6] + PACK[x & 63] + PACK[y >> 6] + PACK[y & 63];
    } else {
      const dx = x - px + 256, dy = y - py + 256;
      if (dx < 0 || dy < 0 || dx > 511 || dy > 511) throw new Error(`a step of ${x - px},${y - py} tenths is too long to pack`);
      const v = dx * 512 + dy;
      out += PACK[v >> 12] + PACK[(v >> 6) & 63] + PACK[v & 63];
    }
    px = x; py = y;
  }
  return out;
}
// The same decoder is written into heaps.js (so the file stands alone, and the
// game's copy of it too).
export const UNPACK_SRC = `const PACK = '${PACK}';
const IX = {};
for (let k = 0; k < 64; k++) IX[PACK[k]] = k;
// Control points in tenths of a unit: a first point (two 12-bit numbers), then steps (two 9-bit numbers each).
function unpackPoints(s) {
  const p = [];
  let x = 0, y = 0;
  for (let k = 0; k < s.length;) {
    if (k === 0) { x = IX[s[0]] * 64 + IX[s[1]]; y = IX[s[2]] * 64 + IX[s[3]]; k = 4; } else {
      const v = IX[s[k]] * 4096 + IX[s[k + 1]] * 64 + IX[s[k + 2]];
      x += (v >> 9) - 256; y += (v & 511) - 256; k += 3;
    }
    p.push(x / 10, y / 10);
  }
  return p;
}
// A strand token: its color key, a second color key for two-color yarn, '*' when buried.
function unpackStrands(cs, ps) {
  const pts = ps.split(' ');
  return cs.split(' ').map((t, i) => {
    const s = { c: t[0] };
    if (t[1] && t[1] !== '*') s.c2 = t[1];
    if (t.endsWith('*')) s.q = 1;
    s.p = unpackPoints(pts[i]);
    return s;
  });
}`;
const strandToken = (s) => `${s.c}${s.c2 || ''}${s.q ? '*' : ''}`;

/** The text of heaps.js for these entries (in LEVEL_DEFS order). */
export function heapsSource(entries) {
  const body = entries.map((o) => {
    const L = buildLevel({ id: o.id, name: o.id, slots: o.slots, board: o.board, strands: o.strands, knots: o.knots, pins: o.pins, pegs: o.pegs, flips: o.flips });
    return `  ${o.id}: {
    seed: ${o.seed}, deal: ${o.deal}, slots: ${o.slots}, board: ${JSON.stringify(o.board)}, sig: '${levelSig(L)}', mech: ${JSON.stringify(mechanicsOf(L))},
    cs: '${o.strands.map(strandToken).join(' ')}',
    ps: '${o.strands.map((s) => packPoints(s.p)).join(' ')}',
    knots: ${JSON.stringify(o.knots)}, pins: ${JSON.stringify(o.pins)}, pegs: ${JSON.stringify(o.pegs)},
    flips: ${JSON.stringify(o.flips)}, snarls: ${JSON.stringify(o.snarls)},
    solution: '${o.solution}',
    stats: ${JSON.stringify(o.stats).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},
  },`;
  }).join('\n');
  return `// Generated by gen-levels.mjs. Do not edit by hand; edit levels.js or the
// generator and run: node proto/tangle/gen-levels.mjs
// (The game ships a copy of this file as src/puzzles/tangle-heaps.js.)
// Strands are listed bottom to top. cs: one token per strand (color key, a
// second key for two-color yarn, '*' when buried); ps: its control points,
// packed (see unpackPoints). sig: the level's signature (rules.js levelSig), a
// hash of its geometry; mech: what mechanicsOf finds in it.
// board: [w, h]; flips: crossings [a, b, k] (the k-th crossing of strands a < b)
// where the lower strand lies on top; snarls: the strands that come out together;
// pegs: [strand, color, x, y].
// stats: strands; colors; rack slots; pulls in the stored solution; solver
// nodes to find it; random = how often a player who pulls any allowed strand
// at random clears the basket (seed ${RANDOM_SEED}, ${RANDOM_RUNS} runs); careful = a greedy
// player with no lookahead (${CAREFUL_RUNS} runs); blind = the same player when buried
// colors stay hidden; snarls (rings = snarls of three); depth = the most
// strands lying one above another over any strand; crossings; loops (a strand
// crossing itself); tucks; pegs; free = strands with nothing on top at the start.
${UNPACK_SRC}

const RAW = {
${body}
};

// A basket's strands are unpacked the first time they are read (so loading
// this file costs next to nothing, whatever the number of baskets).
export const HEAPS = {};
for (const [id, h] of Object.entries(RAW)) {
  const { cs, ps, ...rest } = h;
  let strands = null;
  HEAPS[id] = Object.defineProperty(rest, 'strands', { get: () => strands || (strands = unpackStrands(cs, ps)), enumerable: true });
}
`;
}

function writeHeaps(entries) {
  const url = new URL('./heaps.js', import.meta.url);
  const tmp = new URL('./heaps.js.tmp', import.meta.url);
  writeFileSync(tmp, heapsSource(entries));
  renameSync(tmp, url);
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (!isMainThread) {
  parentPort.on('message', (idx) => {
    try { parentPort.postMessage({ idx, res: generateOne(idx) }); } catch (e) { parentPort.postMessage({ idx, err: String(e.stack || e) }); }
  });
} else if (isEntry) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  let old = {};
  try { old = (await import('./heaps.js')).HEAPS; } catch { /* first run */ }
  // biggest first, so the slow ones start early
  const todo = LEVEL_DEFS.map((d, i) => i).filter((i) => !only || only.includes(LEVEL_DEFS[i].id)).sort((a, b) => LEVEL_DEFS[b].knobs.n - LEVEL_DEFS[a].knobs.n || a - b);
  const results = new Map();
  const failed = [];
  const t0 = Date.now();
  const entries = () => LEVEL_DEFS.map((d, i) => results.get(i) || (old[d.id] && old[d.id].board ? { id: d.id, ...old[d.id] } : null)).filter(Boolean);
  if (!todo.length) writeHeaps(entries());
  else await new Promise((resolve) => {
    let next = 0, finished = 0;
    const n = Math.min(todo.length, Math.max(1, +(process.env.WORKERS || availableParallelism())));
    for (let w = 0; w < n; w++) {
      const worker = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next >= todo.length) { worker.terminate(); return; }
        worker.postMessage(todo[next++]);
      };
      worker.on('message', ({ idx, res, err }) => {
        finished++;
        if (err) {
          failed.push(LEVEL_DEFS[idx].id);
          console.log(`${LEVEL_DEFS[idx].id.padEnd(10)} FAILED: ${err.split('\n')[0]}`);
        } else {
          results.set(idx, res);
          writeHeaps(entries());
          const s = res.stats;
          console.log(`${res.id.padEnd(10)} n ${String(s.strands).padStart(2)}  colors ${s.colors}  slots ${s.slots}  pulls ${String(s.pulls).padStart(2)}  nodes ${String(s.nodes).padStart(6)}  random ${(s.random * 100).toFixed(0).padStart(3)}%  careful ${(s.careful * 100).toFixed(0).padStart(3)}%  blind ${(s.blind * 100).toFixed(0).padStart(3)}%  snarls ${s.snarls}(${s.rings})  depth ${s.depth}  x ${s.crossings} loops ${s.loops} tucks ${s.tucks} pegs ${s.pegs} free ${s.free}  ${(res.ms / 1000).toFixed(1)} s (${res.heaps} heaps, ${res.candidates} deals)`);
        }
        if (finished === todo.length) { worker.terminate(); resolve(); } else feed();
      });
      worker.on('error', (e) => { console.log(`worker error: ${e && e.stack}`); });
      feed();
    }
  });
  console.log(`wrote heaps.js in ${((Date.now() - t0) / 1000).toFixed(1)} s${failed.length ? `; not made: ${failed.join(',')}` : ''}`);
}
