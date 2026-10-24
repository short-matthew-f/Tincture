// Authoring tool (not loaded by the page): deals candidate hoops for every
// level from a clean hoop with real moves, keeps the one nearest the level's
// target, finds its way out (minimal where the solver can prove it), measures
// how hard it is, and writes hoops.js (compact; see the decoder there).
// Run from the repo root:
//   node proto/hoop/gen-levels.mjs                     (every level not stored yet)
//   ONLY=twill,heirloom node proto/hoop/gen-levels.mjs (just these; the rest are kept)
//   ALL=1 node proto/hoop/gen-levels.mjs               (every level after the opening 23 again)
//   WORKERS=4 (default: the machine's cores, at most 4)
// Deterministic: the same code and seeds always write the same file, whatever
// the number of workers (each level is made on its own, from its own seeds, and
// the file is written in level order).
//
// THE OPENING 23 (knobs without `ceil`) were made by the first pipeline: solve
// many candidates, keep the one nearest the wanted par and greedy rate. They
// are kept exactly as stored unless ONLY names them.
//
// THE HARDER HOOPS (knobs with `ceil`, levels.js "HARDER HOOPS"): the cheap
// tests come first, so most candidates cost a few milliseconds:
//   1. deal (gen.js candidate): crossings within [minCross, maxCross], at least
//      `hooked` hooked pairs;
//   2. the greedy screen: SCREEN_RUNS greedy players, stopping as soon as more
//      of them clear it than the ceiling allows (most candidates fail here
//      after a few quick clears);
//   3. the stored greedy rate (GREEDY_RUNS players, seed RANDOM_SEED; the same
//      as rules.js greedyRate with a fresh memo) must stay under the ceiling too;
//   4. a way out: a best-first search (rules.js bestFirst) within a node cap,
//      and a beam (beamSearch) when that one is longer than the level allows;
//      the way out must lie in the level's par range (the wide search on the
//      kept hoop may then find a shorter one: a better par, kept).
// Up to WANT survivors are scored (greedy rate near ceil - 0.1, more clasps
// better) and the best kept. Its way out is then shortened with a wider beam
// and a gentler best-first, and proved minimal when the bound already equals
// it, or (for a short one, at most four moves over the bound) when A* finishes
// within PROOF_CAP; otherwise its par is marked best found (stats.optimal false).
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { LEVEL_DEFS, CHAPTERS, difficulty } from './levels.js';
import { candidate, unscramble } from './gen.js';
import {
  buildLevel, solve, replay, isDone, randomRate, greedyPlayout, mulberry, formatMoves, sparePegs, newState, totalCrossings, hookedPairs,
  bestFirst, beamSearch, lowerBound, COLORS,
} from './rules.js';

const SEEDS = +(process.env.SEEDS || 60);
export const RANDOM_K = 60, RANDOM_SEED = 4242, RANDOM_RUNS = 400, GREEDY_RUNS = 40;
const SCREEN_CAP = 6000;   // the first pipeline: a candidate must be solved this fast to be kept
const CAP = 120000;        // the first pipeline: the proof of the kept one
// the harder hoops
const HARD_SEEDS = +(process.env.HARD_SEEDS || 400); // candidates dealt at most per level
const SCREEN_RUNS = 10;    // greedy players in the quick screen
const WANT = 5;            // survivors scored before choosing
const WAY_CAP = 1500;      // nodes for each quick way out
const PROOF_CAP = +(process.env.PROOF_CAP || 12000);
const HARD_RANDOM_RUNS = 120;
const r3 = (x) => Math.round(x * 1000) / 1000;

function greedy(L, seed, runs, memo = null) {
  const g = mulberry(seed);
  let ok = 0, moves = 0;
  for (let r = 0; r < runs; r++) { const m = greedyPlayout(L, g, RANDOM_K, memo); if (m > 0) { ok++; moves += m; } }
  return { rate: ok / runs, moves: ok ? Math.round((moves / ok) * 10) / 10 : null };
}

// ---------- the first pipeline (the opening 23) ----------

// The scramble played backwards, with every move dropped that it can do
// without; or a weighted search (quick, not minimal): the shorter. (Since
// yarn pulls taut, the scramble played backwards often no longer undoes it:
// then a greedier search.)
function bestFound(L, def, k) {
  let path = unscramble(L, def);
  if (path) {
    for (let i = path.length - 1; i >= 0; i--) {
      const p2 = path.slice(0, i).concat(path.slice(i + 1));
      try { if (isDone(replay(L, p2))) path = p2; } catch { /* needed */ }
    }
  }
  const w = solve(L, undefined, { cap: Math.round((k.cap || SCREEN_CAP) / 2), weight: 1.6 });
  if (w.ok && (!path || w.path.length < path.length)) path = w.path;
  if (!path) { const g = solve(L, undefined, { cap: k.cap || SCREEN_CAP, weight: 3 }); if (g.ok) path = g.path; }
  return path ? { ok: true, path, nodes: (k.cap || SCREEN_CAP), optimal: false } : null;
}

function generateFirst(idx) {
  const d = LEVEL_DEFS[idx], k = d.knobs;
  const t0 = Date.now();
  const cands = [];
  let tried = 0, unsolved = 0;
  for (let seed = 1; seed <= (k.seeds || SEEDS); seed++) {
    const def = candidate(mulberry(seed * 7919 + idx * 131 + 1), k);
    if (!def) continue;
    tried++;
    const L = buildLevel({ id: d.id, name: d.name, ...def });
    let sol = solve(L, undefined, { cap: k.cap || SCREEN_CAP });
    if (!sol.ok && k.best) sol = bestFound(L, def, k);
    if (!sol || !sol.ok) { unsolved++; continue; }
    const par = sol.path.length;
    const off = (par < k.par[0] ? k.par[0] - par : par > k.par[1] ? par - k.par[1] : 0) + (sol.optimal ? 0 : 0.3);
    const gq = off >= 1 ? null : greedy(L, 99 + seed, 12);
    cands.push({ score: off >= 1 ? off + 1 : off + Math.abs(gq.rate - k.target), seed, def, L, sol });
  }
  if (!cands.length) throw new Error(`${d.id}: no solvable candidate (${tried} dealt, ${unsolved} unsolved)`);
  cands.sort((a, b) => a.score - b.score || a.sol.nodes - b.sol.nodes || a.seed - b.seed);
  const head = cands.slice(0, 3);
  for (const x of head) {
    const par = x.sol.path.length;
    const off = (par < k.par[0] ? k.par[0] - par : par > k.par[1] ? par - k.par[1] : 0) + (x.sol.optimal ? 0 : 0.3);
    x.gq = greedy(x.L, RANDOM_SEED, GREEDY_RUNS);
    x.score = off + Math.abs(x.gq.rate - k.target);
  }
  head.sort((a, b) => a.score - b.score || a.sol.nodes - b.sol.nodes || a.seed - b.seed);
  const x = head[0];
  let sol = x.sol;
  if (!sol.optimal && !k.best) { const p = solve(x.L, undefined, { cap: CAP }); if (p.ok) sol = p; }
  if (!isDone(replay(x.L, sol.path))) throw new Error(`${d.id}: solution does not replay`);
  const s0 = newState(x.L);
  return {
    id: d.id, seed: x.seed, def: x.def, solution: formatMoves(sol.path),
    stats: {
      pegs: x.L.n, strands: x.L.S, spare: sparePegs(x.L), colors: x.L.colors.length, crossings: totalCrossings(x.L, s0), hooked: hookedPairs(x.L, s0).length,
      par: sol.path.length, optimal: sol.optimal, nodes: sol.nodes,
      random: r3(randomRate(x.L, RANDOM_K, RANDOM_SEED, RANDOM_RUNS)), greedy: r3(x.gq.rate), greedyMoves: x.gq.moves,
    },
    ms: Date.now() - t0, tried, kept: cands.length,
  };
}

// ---------- the harder hoops ----------

/** The greedy screen: false as soon as more than `ceil` of SCREEN_RUNS players clear it. */
function screen(L, seed, ceil, memo) {
  const g = mulberry(seed);
  const allowed = Math.floor(ceil * SCREEN_RUNS + 1e-9);
  let ok = 0;
  for (let r = 0; r < SCREEN_RUNS; r++) {
    if (greedyPlayout(L, g, RANDOM_K, memo) > 0 && ++ok > allowed) return false;
  }
  return true;
}
/**
 * A way out, or null. Quick (for a survivor): one best-first search, and a
 * beam only when that one is too long for the level. Wide (for the kept
 * hoop): beams of three widths and two more best-first searches, the shortest.
 */
function wayOut(L, { wide = false, hi = Infinity } = {}) {
  const tries = wide
    ? [() => beamSearch(L, undefined, { width: 30, cap: 2000 }), () => beamSearch(L, undefined, { width: 100, cap: 2500 }), () => beamSearch(L, undefined, { width: 300, cap: 4500 }),
      () => bestFirst(L, undefined, { cap: 4000, lam: 1.5 }), () => bestFirst(L, undefined, { cap: 3000, lam: 6 })]
    : [() => bestFirst(L, undefined, { cap: WAY_CAP, lam: 3 }), () => beamSearch(L, undefined, { width: 100, cap: WAY_CAP })];
  let best = null;
  for (const f of tries) {
    const r = f();
    if (r.ok && (!best || r.path.length < best.length)) best = r.path;
    // (quick: no way out within the cap is a hoop too knotted to keep; one short enough is enough)
    if (!wide && (!best || best.length <= hi)) break;
  }
  return best;
}

function generateHard(idx) {
  const d = LEVEL_DEFS[idx], k = d.knobs;
  const t0 = Date.now();
  const target = Math.max(0, k.ceil - 0.1);
  const outOf = (par) => (par < k.par[0] ? k.par[0] - par : par > k.par[1] ? par - k.par[1] : 0);
  const kept = [];
  let tried = 0, screened = 0, solved = 0;
  // where the time goes (ms): dealing, the greedy screen, quick ways out, the
  // stored greedy rate, then for the kept one the wide search, the proof, the random rate
  const T = { deal: 0, screen: 0, way: 0, greedy: 0, wide: 0, proof: 0, random: 0 };
  let tk = Date.now();
  const lap = (k2) => { const t = Date.now(); T[k2] += t - tk; tk = t; };
  for (let seed = 1; seed <= (k.seeds || HARD_SEEDS) && kept.length < WANT; seed++) {
    tk = Date.now();
    const def = candidate(mulberry(seed * 7919 + idx * 131 + 1), k);
    if (!def) { lap('deal'); continue; }
    tried++;
    const L = buildLevel({ id: d.id, name: d.name, ...def });
    lap('deal');
    // (the greedy players share what they have worked out at each position)
    const memo = new Map();
    const passed = screen(L, 77 + seed, k.ceil, memo);
    lap('screen');
    if (!passed) continue;
    screened++;
    // (a fresh memo: the stored rate is exactly what greedyRate gives on its own)
    const gq = greedy(L, RANDOM_SEED, GREEDY_RUNS, new Map());
    lap('greedy');
    if (gq.rate > k.ceil + 1e-9) continue;
    const path = wayOut(L, { hi: k.par[1] });
    lap('way');
    if (!path || outOf(path.length) > 0) continue;
    solved++;
    const hk = hookedPairs(L, newState(L)).length;
    kept.push({ seed, def, L, path, gq, hk, score: Math.abs(gq.rate - target) - 0.02 * Math.min(hk, 5) });
  }
  if (!kept.length) throw new Error(`${d.id}: nothing kept (${tried} dealt, ${screened} past the greedy screen, ${solved} with a way out in range)`);
  kept.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.seed - b.seed);
  const x = kept[0];
  // shorten the way out, then try to prove it
  let path = x.path;
  tk = Date.now();
  const wide = wayOut(x.L, { wide: true });
  if (wide && wide.length < path.length) path = wide;
  lap('wide');
  let optimal = false, nodes = 0;
  const lb = lowerBound(x.L, newState(x.L));
  if (lb >= path.length) optimal = true;
  else if (path.length <= 9 && path.length - lb <= 4) {
    const p = solve(x.L, undefined, { cap: PROOF_CAP });
    nodes = p.nodes;
    if (p.ok) { optimal = true; if (p.path.length < path.length) path = p.path; }
  }
  lap('proof');
  if (!isDone(replay(x.L, path))) throw new Error(`${d.id}: solution does not replay`);
  const s0 = newState(x.L);
  return {
    id: d.id, seed: x.seed, def: x.def, solution: formatMoves(path),
    stats: {
      pegs: x.L.n, strands: x.L.S, spare: sparePegs(x.L), colors: x.L.colors.length, crossings: totalCrossings(x.L, s0), hooked: x.hk,
      par: path.length, optimal, nodes, bound: lb,
      random: r3((() => { tk = Date.now(); const r = randomRate(x.L, RANDOM_K, RANDOM_SEED, HARD_RANDOM_RUNS); lap('random'); return r; })()), greedy: r3(x.gq.rate), greedyMoves: x.gq.moves,
    },
    ms: Date.now() - t0, tried, screened, solved, kept: kept.length, T,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IX = {};
for (let k = 0; k < 64; k++) IX[B64[k]] = k;
/**
 * The packed def: 'n flags | strands | fixed | links | pegs | words', fields
 * split by '|'. n: one char. flags: 'L' over and under, 'O' lift it off.
 * strands: three chars each (color key, peg a, peg b). fixed: one char an end.
 * links: two chars a shared knot. pegs: two chars a painted peg (peg, color).
 * words: one per strand, split by '.'; strand s's crossing with strand o is
 * one char: o * 4 + bits. When o > s it is new (bit 1: o on top, bit 0: sign
 * > 0) and takes the next id; when o < s it is the k-th crossing of o with s
 * along o's word (k < 3 in the bits; else bits 3 and one more char for k).
 */
export function packHoop(def) {
  const S = def.strands.length, c = (v) => B64[v];
  const out = [c(def.n) + (def.layering ? 'L' : '') + (def.liftoff ? 'O' : '')];
  out.push(def.strands.map((s) => s.c + c(s.a) + c(s.b)).join(''));
  out.push((def.fixed || []).map(c).join(''));
  out.push((def.links || []).map(([a, b]) => c(a) + c(b)).join(''));
  out.push(Object.entries(def.pegs || {}).map(([p, col]) => c(+p) + col).join(''));
  const pairs = new Map(); // "o,s" -> crossing ids in o's word order
  const words = [];
  for (let s = 0; s < S; s++) {
    let t = '';
    for (const id of def.w[s]) {
      const X = def.x[id], o = X[0] === s ? X[1] : X[0];
      if (o > s) {
        t += c(o * 4 + (X[2] === o ? 2 : 0) + (X[3] > 0 ? 1 : 0));
        const key = s + ',' + o;
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(id);
      } else {
        const k = pairs.get(o + ',' + s).indexOf(id);
        t += k < 3 ? c(o * 4 + k) : c(o * 4 + 3) + c(k);
      }
    }
    words.push(t);
  }
  out.push(words.join('.'));
  return out.join('|');
}
/** unpackHoop(str) -> the def (crossings numbered in reading order, as the generator leaves them). */
export function unpackHoop(str) {
  const [head, st, fx, lk, pg, ws] = str.split('|');
  const n = IX[head[0]];
  const strands = [];
  for (let k = 0; k < st.length; k += 3) strands.push({ c: st[k], a: IX[st[k + 1]], b: IX[st[k + 2]] });
  const links = [];
  for (let k = 0; k < lk.length; k += 2) links.push([IX[lk[k]], IX[lk[k + 1]]]);
  const pegs = {};
  for (let k = 0; k < pg.length; k += 2) pegs[IX[pg[k]]] = pg[k + 1];
  const x = [], w = strands.map(() => []), pairs = new Map();
  ws.split('.').forEach((t, s) => {
    for (let k = 0; k < t.length; k++) {
      const v = IX[t[k]], o = v >> 2, bits = v & 3;
      if (o > s) {
        x.push([s, o, bits & 2 ? o : s, bits & 1 ? 1 : -1]);
        const key = s + ',' + o;
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(x.length - 1);
        w[s].push(x.length - 1);
      } else {
        let j = bits;
        if (bits === 3) j = IX[t[++k]];
        const id = pairs.get(o + ',' + s)[j];
        w[s].push(id);
      }
    }
  });
  const fl = head.slice(1);
  return { n, layering: fl.includes('L'), liftoff: fl.includes('O'), strands, fixed: [...fx].map((ch) => IX[ch]), links, pegs, x, w };
}
// (the same doc comments, written into hoops.js above the functions' own source)
const PACK_DOC = `/**
 * The packed def: 'n flags | strands | fixed | links | pegs | words', fields
 * split by '|'. n: one char. flags: 'L' over and under, 'O' lift it off.
 * strands: three chars each (color key, peg a, peg b). fixed: one char an end.
 * links: two chars a shared knot. pegs: two chars a painted peg (peg, color).
 * words: one per strand, split by '.'; strand s's crossing with strand o is
 * one char: o * 4 + bits. When o > s it is new (bit 1: o on top, bit 0: sign
 * > 0) and takes the next id; when o < s it is the k-th crossing of o with s
 * along o's word (k < 3 in the bits; else bits 3 and one more char for k).
 */`;
const UNPACK_DOC = '/** unpackHoop(str) -> the def (crossings numbered in reading order, as the generator leaves them). */';
const PACK_SRC = [`const B64 = '${B64}';`, 'const IX = {};', 'for (let k = 0; k < 64; k++) IX[B64[k]] = k;', PACK_DOC, `export ${packHoop}`, UNPACK_DOC, `export ${unpackHoop}`].join('\n');

const generateOne = (idx) => (LEVEL_DEFS[idx].knobs.ceil === undefined ? generateFirst(idx) : generateHard(idx));

// ---------- workers, and the file ----------

if (!isMainThread) {
  parentPort.on('message', (idx) => {
    try { parentPort.postMessage({ idx, res: generateOne(idx) }); } catch (e) { parentPort.postMessage({ idx, err: String(e && e.stack || e) }); }
  });
} else {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  let old = {};
  try { old = (await import('./hoops.js')).HOOPS; } catch { /* first run */ }
  const todo = [];
  // (a later chapter is laid out in order of difficulty after dealing, so a
  // level named in ONLY brings its whole chapter with it)
  const chapterIds = (i) => { const k = CHAPTERS.findLastIndex((c) => c.from <= i); const to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVEL_DEFS.length; return LEVEL_DEFS.slice(CHAPTERS[k].from, to).map((x) => x.id); };
  const named = only ? new Set(only.flatMap((id) => { const i = LEVEL_DEFS.findIndex((d) => d.id === id); return i < 0 ? [] : LEVEL_DEFS[i].knobs.ceil === undefined ? [id] : chapterIds(i); })) : null;
  LEVEL_DEFS.forEach((d, i) => {
    if (named) { if (named.has(d.id)) todo.push(i); return; }
    if (process.env.ALL && d.knobs.ceil !== undefined) { todo.push(i); return; }
    if (!old[d.id]) todo.push(i);
  });
  todo.sort((a, b) => b - a); // the big ones first, so the workers finish together
  const t0 = Date.now();
  const results = new Map();
  const nW = Math.max(1, Math.min(todo.length, +(process.env.WORKERS || Math.min(4, availableParallelism()))));
  await new Promise((resolve, reject) => {
    if (!todo.length) { resolve(); return; }
    let next = 0, live = 0;
    for (let w = 0; w < nW; w++) {
      const wk = new Worker(new URL(import.meta.url));
      live++;
      const feed = () => { if (next < todo.length) wk.postMessage(todo[next++]); else { wk.terminate(); if (--live === 0) resolve(); } };
      wk.on('message', ({ idx, res, err }) => {
        if (err) { reject(new Error(err)); return; }
        results.set(idx, res);
        const s = res.stats;
        console.log(`${String(idx + 1).padStart(3)} ${res.id.padEnd(12)} pegs ${String(s.pegs).padStart(2)} strands ${s.strands} spare ${s.spare} par ${String(s.par).padStart(2)}${s.optimal ? ' proved' : ' found '} greedy ${(s.greedy * 100).toFixed(0).padStart(3)}% random ${(s.random * 100).toFixed(0).padStart(3)}% crossings ${String(s.crossings).padStart(2)} hooked ${s.hooked}  [${res.kept} kept of ${res.tried} dealt${res.screened !== undefined ? `, ${res.screened} past the screen` : ''}] ${(res.ms / 1000).toFixed(1)} s`);
        feed();
      });
      wk.on('error', reject);
      feed();
    }
  });
  const entries = LEVEL_DEFS.map((d, i) => results.get(i) || (old[d.id] ? { id: d.id, ...old[d.id] } : null)).filter(Boolean);
  // Within each of the later chapters, the hoops dealt go in order of
  // difficulty (levels.js): each keeps its seed and the slot whose knobs dealt
  // it (stats.dealt), so it can be made again.
  for (let k = 0; k < CHAPTERS.length; k++) {
    const from = CHAPTERS[k].from, to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVEL_DEFS.length;
    if (LEVEL_DEFS.slice(from, to).some((d) => d.knobs.ceil === undefined)) continue;
    const slots = entries.filter((o) => { const i = LEVEL_DEFS.findIndex((d) => d.id === o.id); return i >= from && i < to; });
    if (slots.length !== to - from) continue;
    const hoops = slots.map((o) => ({ seed: o.seed, def: o.def, solution: o.solution, stats: { ...o.stats, dealt: o.stats.dealt || o.id } }));
    hoops.sort((a, b) => difficulty(a.stats) - difficulty(b.stats) || (a.stats.dealt < b.stats.dealt ? -1 : 1));
    slots.forEach((o, j) => Object.assign(o, hoops[j]));
  }
  const body = entries.map((o) => `  ${o.id}: ${JSON.stringify([packHoop(o.def), o.seed, o.solution, o.stats])},`);
  const src = `// Generated by gen-levels.mjs. Do not edit by hand; edit levels.js or the
// generator and run: node proto/hoop/gen-levels.mjs
// (The game ships a copy of this file as src/puzzles/hoop-data.js.)
//
// Each hoop is one line: [its def packed into one string (packHoop, below),
// seed, solution, stats].
// def: n pegs; strands { c color, a, b pegs at the start }; fixed end ids (end
// 2s is at a, 2s+1 at b); links (shared knots, the clockwise tail's end
// first); pegs { peg: color } painted pegs; layering; liftoff; x crossings
// [a, b, top, sign] and w words (each strand's crossings from end 2s to
// 2s+1), made by scrambling a clean hoop with real moves.
// solution: "end:peg" moves ("2s:-1" lifts strand s off), minimal where
// stats.optimal (A*, or a bound that already equals it), else the best found.
// stats: spare = empty pegs at the start; crossings and hooked (pairs of
// strands hooked together) at the start; par = moves in the solution; nodes =
// positions A* expanded; bound = the solver's lower bound at the start;
// random = how often a player who makes any legal move at random clears the
// hoop within ${RANDOM_K} moves (seed ${RANDOM_SEED}; ${RANDOM_RUNS} runs for the opening 23,
// ${HARD_RANDOM_RUNS} after); greedy = a player with no lookahead who always leaves the
// fewest crossings (${GREEDY_RUNS} runs, same limit and seed), greedyMoves = its
// average moves when it clears.
${PACK_SRC}
const RAW = {
${body.join('\n')}
};
export const HOOPS = Object.fromEntries(Object.entries(RAW).map(([id, [packed, seed, solution, stats]]) => [id, { seed, def: unpackHoop(packed), solution, stats }]));
`;
  writeFileSync(new URL('./hoops.js', import.meta.url), src);
  console.log(`wrote hoops.js: ${entries.length} hoops, ${results.size} made in ${((Date.now() - t0) / 1000).toFixed(1)} s with ${nW} workers`);
  const tot = {};
  for (const r of results.values()) for (const [k2, v] of Object.entries(r.T || {})) tot[k2] = (tot[k2] || 0) + v;
  if (Object.keys(tot).length) console.log(`worker time by phase (s): ${Object.entries(tot).map(([k2, v]) => `${k2} ${(v / 1000).toFixed(0)}`).join(', ')}`);
}

void COLORS;
