// The Hoop: level generation (pure; used at authoring time by
// gen-levels.mjs and by the tests). No window/document/Date.now/Math.random.
//
// A candidate is made the way a real tangle is: from a CLEAN hoop, by moves.
//   - deal 2S - links pegs and tie strands across them as non-crossing
//     chords; the first `links` times, two
//     neighboring ends of different strands are tied into one shared knot;
//   - deal colors (spread evenly), stitched-down knots (never both ends of a
//     strand, never a shared knot);
//   - scramble: `scramble` random moves with the real step rule (any knot but
//     a stitched one may be lifted, nothing comes free on the way), never
//     straight back to the peg a knot just left. Moves made this way make
//     genuine clasps and strands that cross more than once;
//   - keep it only if nothing would come free at once (every strand lies
//     under something: no strand crosses nothing, none lies over everything
//     it crosses), there are at least `minCross` crossings (and at most
//     `maxCross`), and hooked strands are present or absent as the knob
//     `clasp` asks;
//   - paint pegs: about half on empty pegs, half under a matching knot.
// gen-levels.mjs solves many candidates and keeps the one nearest the
// level's target.
import { crosses, buildLevel, newState, move, legalMoves, hookedPairs, totalCrossings, movers, pathOf, liftable } from './rules.js';

// Colors in the order levels bring them in (friendly, high-contrast ones first).
export const COLOR_ORDER = ['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l'];

const shuffle = (rng, a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** A clean hoop: { ends, links: [[cwEnd, ccwEnd]] } with non-crossing chords, or null. */
export function cleanHoop(rng, n, S, links = 0) {
  for (let tries = 0; tries < 200; tries++) {
    // random chords one at a time, long enough and crossing none placed before
    const ends = [];
    let ok = true;
    for (let s = 0; s < S && ok; s++) {
      const opts = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (ends.includes(a) || ends.includes(b)) continue;
        let cut = false;
        for (let t = 0; t < s && !cut; t++) if (crosses(n, a, b, ends[2 * t], ends[2 * t + 1])) cut = true;
        if (!cut) opts.push([a, b]);
      }
      if (!opts.length) { ok = false; break; }
      const [a, b] = opts[Math.floor(rng() * opts.length)];
      if (rng() < 0.5) ends.push(a, b); else ends.push(b, a);
    }
    if (!ok) continue;
    // shared knots: two ends of different strands, neighbors around the rim, share the first one's peg
    const byPeg = [...Array(2 * S).keys()].sort((x, y) => ends[x] - ends[y]);
    const lk = [];
    const used = new Set();
    const order = shuffle(rng, [...Array(2 * S).keys()]);
    for (const k of order) {
      if (lk.length >= links) break;
      const e1 = byPeg[k], e2 = byPeg[(k + 1) % (2 * S)];
      if ((e1 >> 1) === (e2 >> 1) || used.has(e1 >> 1) || used.has(e2 >> 1)) continue;
      used.add(e1 >> 1); used.add(e2 >> 1);
      ends[e2] = ends[e1];
      lk.push([e1, e2]);
    }
    if (lk.length < links) continue;
    // which tail leaves a shared knot on the clockwise side: the one whose far end comes first clockwise
    const cwOff = (e) => (((ends[e ^ 1] - ends[e]) % n) + n) % n;
    const links2 = lk.map(([a, b]) => (cwOff(a) < cwOff(b) ? [a, b] : [b, a]));
    return { ends, links: links2 };
  }
  return null;
}

/**
 * candidate(rng, knobs) -> level def (without id/name) or null.
 * knobs: { n, S, links=0, fixed=0, pegs=0, colors, layering=false,
 *          scramble, minCross, maxCross, clasp (true: must, false: must not) }
 */
export function candidate(rng, k) {
  const n = k.n, S = k.S;
  for (let tries = 0; tries < 60; tries++) {
    const clean = cleanHoop(rng, n, S, k.links || 0);
    if (!clean) return null;
    const K = Math.min(k.colors || 3, COLOR_ORDER.length);
    const pal = COLOR_ORDER.slice(0, K);
    const col = shuffle(rng, [...Array(S).keys()].map((s) => pal[s % K]));
    const linked = new Set(clean.links.flat());
    const fixed = [];
    for (const e of shuffle(rng, [...Array(2 * S).keys()].filter((e) => !linked.has(e)))) {
      if (fixed.length >= (k.fixed || 0)) break;
      if (fixed.includes(e ^ 1)) continue;
      fixed.push(e);
    }
    if (fixed.length < (k.fixed || 0)) continue;
    fixed.sort((a, b) => a - b);
    const base = {
      n, layering: !!k.layering,
      strands: [...Array(S).keys()].map((s) => ({ c: col[s], a: clean.ends[2 * s], b: clean.ends[2 * s + 1] })),
      fixed, links: clean.links, pegs: {},
    };
    let L;
    try { L = buildLevel({ id: 'clean', name: 'clean', ...base }); } catch { continue; }
    // scramble with real moves
    // (while some strand lies on top of everything, or crosses nothing, a
    // move carrying an end over one of its knots is preferred: something has
    // to lie over every strand, or it would lift right off)
    const free = { ...L, layering: false };
    let s = newState(L), last = null;
    for (let m = 0; m < 4 * k.scramble; m++) {
      const onTop = s.w.map((ws, i) => ws.every((c) => s.x[c][2] === i));
      if (m >= k.scramble && !onTop.some(Boolean)) break;
      let ms = legalMoves(free, s).filter(([e, q]) => !L.fixed[e] && !(last && last[0] === e && last[1] === q));
      if (onTop.some(Boolean) && rng() < 0.75) {
        const pick = ms.filter(([e, q]) => pathOf(L, s.ends, e, q).passed.some((r) => s.ends.some((p, t) => p === r && onTop[t >> 1] && !movers(L, e).some((x) => (x >> 1) === (t >> 1)))));
        if (pick.length) ms = pick;
      }
      if (!ms.length) break;
      const [e, q] = ms[Math.floor(rng() * ms.length)];
      const from = s.ends[e];
      const r = move(free, s, e, q, { scramble: true });
      if (!r.ok) continue;
      s = r.state;
      last = [e, from];
    }
    if (liftable(L, s).length) continue;
    const X = totalCrossings(L, s);
    if (X < (k.minCross ?? S) || X > (k.maxCross ?? 99)) continue;
    const hooked = hookedPairs(L, s).length > 0;
    if (k.clasp === true && !hooked) continue;
    if (k.clasp === false && hooked) continue;
    // painted pegs: about half empty, half under a matching single knot
    const pegCol = {};
    const usedPegs = new Set(s.ends);
    const empty = shuffle(rng, [...Array(n).keys()].filter((p) => !usedPegs.has(p)));
    const single = shuffle(rng, [...Array(2 * S).keys()].filter((e) => !linked.has(e) && !fixed.includes(e)));
    const want = k.pegs || 0;
    const nEmpty = Math.min(empty.length - 1, Math.ceil(want / 2));
    for (let i = 0; i < nEmpty; i++) pegCol[empty[i]] = col[Math.floor(rng() * S)];
    for (let i = 0; Object.keys(pegCol).length < want && i < single.length; i++) pegCol[s.ends[single[i]]] = col[single[i] >> 1];
    const def = {
      ...base,
      strands: [...Array(S).keys()].map((i) => ({ c: col[i], a: s.ends[2 * i], b: s.ends[2 * i + 1] })),
      pegs: pegCol, x: s.x, w: s.w,
    };
    try { buildLevel({ id: 'cand', name: 'cand', ...def }); } catch { continue; }
    return def;
  }
  return null;
}
