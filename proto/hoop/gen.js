// The Hoop: level generation (pure; used at authoring time by
// gen-levels.mjs and by the tests). No window/document/Date.now/Math.random.
//
// A candidate is dealt from a seeded rng:
//   - pick 2S - links distinct pegs and pair them into strands, each at least
//     `reach` pegs apart; the first `links` pairs of strands share a knot;
//   - keep it only if every strand crosses at least one other (nothing is
//     free before she starts) and the tangle is not one tight clump: at
//     least `minCross` crossings in all;
//   - deal colors (spread evenly over the strands), stitched-down knots (never
//     both ends of a strand, never a shared knot) and painted pegs (half on
//     empty pegs, half under a matching knot).
// gen-levels.mjs solves many candidates and keeps the one whose difficulty is
// nearest the level's target.
import { REACH, cdist, crosses, buildLevel } from './rules.js';

// Colors in the order levels bring them in (friendly, high-contrast ones first).
export const COLOR_ORDER = ['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l'];

const shuffle = (rng, a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * candidate(rng, knobs) -> level def (without id/name) or null.
 * knobs: { n, S, links=0, fixed=0, pegs=0, colors, layering=false, reach=3, minCross }
 */
export function candidate(rng, k) {
  const n = k.n, S = k.S, links = k.links || 0, reach = k.reach ?? REACH;
  const need = 2 * S - links;
  if (need > n - 2) return null;
  for (let tries = 0; tries < 300; tries++) {
    const pegs = shuffle(rng, [...Array(n).keys()]).slice(0, need);
    // end slots: strands 2i and 2i+1 (i < links) share a knot: end 2*(2i)+1 and end 2*(2i+1)
    const ends = Array(2 * S).fill(-1);
    let pi = 0;
    const linkPairs = [];
    for (let i = 0; i < links; i++) {
      const a = 2 * i, b = 2 * i + 1;
      const p = pegs[pi++];
      ends[2 * a + 1] = p; ends[2 * b] = p;
      linkPairs.push([2 * a + 1, 2 * b]);
    }
    for (let e = 0; e < 2 * S; e++) if (ends[e] < 0) ends[e] = pegs[pi++];
    let ok = true;
    for (let s = 0; s < S && ok; s++) if (cdist(n, ends[2 * s], ends[2 * s + 1]) < reach) ok = false;
    if (!ok) continue;
    const cnt = Array(S).fill(0);
    let total = 0;
    for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
      if (crosses(n, ends[2 * a], ends[2 * a + 1], ends[2 * b], ends[2 * b + 1])) { cnt[a]++; cnt[b]++; total++; }
    }
    if (cnt.some((c) => c === 0)) continue;
    if (total < (k.minCross ?? Math.ceil(S * 0.9))) continue;
    // colors: an even spread, shuffled
    const K = Math.min(k.colors || 3, COLOR_ORDER.length);
    const pal = COLOR_ORDER.slice(0, K);
    const col = shuffle(rng, [...Array(S).keys()].map((s) => pal[s % K]));
    // stitched-down knots
    const fixed = [];
    const cand = shuffle(rng, [...Array(2 * S).keys()].filter((e) => !linkPairs.some((p) => p.includes(e))));
    for (const e of cand) {
      if (fixed.length >= (k.fixed || 0)) break;
      if (fixed.includes(e ^ 1)) continue;
      fixed.push(e);
    }
    if (fixed.length < (k.fixed || 0)) continue;
    fixed.sort((a, b) => a - b);
    // painted pegs: about half empty, half under a matching single knot
    const pegCol = {};
    const used = new Set(ends);
    const empty = shuffle(rng, [...Array(n).keys()].filter((p) => !used.has(p)));
    const single = shuffle(rng, [...Array(2 * S).keys()].filter((e) => !linkPairs.some((p) => p.includes(e)) && !fixed.includes(e)));
    const want = k.pegs || 0;
    const nEmpty = Math.min(empty.length - 1, Math.ceil(want / 2));
    for (let i = 0; i < nEmpty; i++) pegCol[empty[i]] = col[Math.floor(rng() * S)];
    for (let i = 0; Object.keys(pegCol).length < want && i < single.length; i++) pegCol[ends[single[i]]] = col[single[i] >> 1];
    const def = {
      n, reach, layering: !!k.layering,
      strands: [...Array(S).keys()].map((s) => ({ c: col[s], a: ends[2 * s], b: ends[2 * s + 1] })),
      fixed, links: linkPairs, pegs: pegCol,
    };
    try { buildLevel({ id: 'cand', name: 'cand', ...def }); } catch { continue; }
    return def;
  }
  return null;
}
