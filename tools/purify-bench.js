// tools/purify-bench.js — measure Purify boards: create() time, rated solution
// lengths against each tier's band, and the raw spread of random deals that the
// bands were calibrated from (docs/DESIGN.md "Purifying", src/puzzles/purify.js).
// Run: node tools/purify-bench.js [boards per tier = 200]

import * as P from '../src/puzzles/purify.js';
import { mulberry32, shuffle } from '../src/rng.js';
import { PIGMENTS } from '../src/content/pigments.js';

const N = Math.max(10, Number(process.argv[2]) || 200);
const TARGETS = ['#c0604a', '#eacac0', '#3e6a9e', '#6e9a5a', '#d39b2a', '#6e4a7e', '#8a8580', '#2f8a8a', '#d98a8f'];
const PALETTE = PIGMENTS.map((p) => p.hex).slice(0, 12);
const q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(f * b.length))] : NaN; };
const ms = (x) => x.toFixed(1);

console.log(`Purify boards, ${N} per tier (node ${process.version})\n`);
console.log('tier     band     raw deals p10/50/90   created p10/50/90   in band  fallback  create ms p50/p90/max  solve nodes p50/max');
for (const tier of P.TIER_IDS) {
  const t = P.TIERS[tier];
  // Raw random deals, solved and rated (what the band is drawn around).
  const raw = [];
  const nodes = [];
  for (let s = 0; s < N; s++) {
    const rng = mulberry32(s * 7919 + 13);
    const units = [];
    for (let c = 0; c < t.colors; c++) for (let k = 0; k < P.CAPACITY; k++) units.push(c);
    const sh = shuffle(rng, units);
    const tubes = [];
    for (let i = 0; i < t.tubes; i++) tubes.push(i < t.colors ? sh.slice(i * P.CAPACITY, (i + 1) * P.CAPACITY) : []);
    const r = P.solve({ tubes, capacity: P.CAPACITY });
    if (r.ok) { raw.push(r.length); nodes.push(r.nodes); }
  }
  // Real creates, timed.
  const pars = [];
  const times = [];
  let inBand = 0;
  let fallback = 0;
  for (let s = 0; s < N; s++) {
    const t0 = performance.now();
    const p = P.createForTier(tier, mulberry32(s * 97 + 3), { target: TARGETS[s % TARGETS.length], palette: PALETTE });
    times.push(performance.now() - t0);
    if (p.par == null) { fallback++; continue; }
    pars.push(p.par);
    if (p.par >= t.band[0] && p.par <= t.band[1]) inBand++;
  }
  console.log([
    tier.padEnd(8), `${t.band[0]}-${t.band[1]}`.padEnd(8),
    `${q(raw, 0.1)} / ${q(raw, 0.5)} / ${q(raw, 0.9)}`.padEnd(21),
    `${q(pars, 0.1)} / ${q(pars, 0.5)} / ${q(pars, 0.9)}`.padEnd(19),
    `${inBand}/${N}`.padEnd(8), String(fallback).padEnd(9),
    `${ms(q(times, 0.5))} / ${ms(q(times, 0.9))} / ${ms(Math.max(...times))}`.padEnd(22),
    `${q(nodes, 0.5)} / ${Math.max(...nodes)}`,
  ].join(' '));
}
