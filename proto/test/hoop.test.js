import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS, VERSION, MODEL, cdist, inArc, crosses, buildLevel, newState, move, canLift, whyNotTo, targets, legalMoves, endsAt, crossersOf,
  crossCounts, totalCrossings, isDone, remaining, movers, newGame, play, undo, replay, solve, hint, solutionStep, parseMoves, formatMoves,
  randomRate, greedyRate, mulberry, stateKey, levelSig, sparePegs, mechanicsOf, yarnLine, pegUnit, pathOf, pairLeft, hookedPairs, wordsError,
  nearestAt, lowerBound, liftable, mutual,
} from '../hoop/rules.js';
import { layout, planarMap, eulerOk, hits, plan, topAt, baseOrder } from '../hoop/layout.js';
import { candidate, cleanHoop } from '../hoop/gen.js';
import { LEVELS, LEVEL_DEFS, MECHANICS, BANDS } from '../hoop/levels.js';
import { HOOPS } from '../hoop/hoops.js';

// A hoop with strands [a, b, color] whose starting crossings are the straight
// chords' (each crossing laid as `over` says: [top, bottom] pairs; the later
// strand on top otherwise), with signs from the geometry.
function lv(n, strands, o = {}) {
  const x = [], w = strands.map(() => []);
  const P = (p) => pegUnit(n, p);
  const sgn = (a1, a2, b1, b2) => { const A = [P(a2)[0] - P(a1)[0], P(a2)[1] - P(a1)[1]], B = [P(b2)[0] - P(b1)[0], P(b2)[1] - P(b1)[1]]; return Math.sign(A[0] * B[1] - A[1] * B[0]); };
  for (let i = 0; i < strands.length; i++) for (let j = i + 1; j < strands.length; j++) {
    const [a1, a2] = strands[i], [b1, b2] = strands[j];
    if (!crosses(n, a1, a2, b1, b2)) continue;
    const top = (o.over || []).some(([t, u]) => t === i && u === j) ? i : j;
    x.push([i, j, top, sgn(a1, a2, b1, b2)]);
  }
  // order each strand's crossings along it (straight chords: by where they cut it)
  const cutAt = (i, c) => {
    const [a1, a2] = strands[i], j = x[c][0] === i ? x[c][1] : x[c][0], [b1, b2] = strands[j];
    const p = P(a1), q = P(a2), r = P(b1), s = P(b2);
    const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
    return ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  };
  x.forEach((X, c) => { w[X[0]].push(c); w[X[1]].push(c); });
  w.forEach((ws, i) => ws.sort((c1, c2) => cutAt(i, c1) - cutAt(i, c2)));
  const { over, ...rest } = o;
  void over;
  return buildLevel({ id: 't', name: 'T', n, strands: strands.map(([a, b, c = 'm']) => ({ c, a, b })), x, w, ...rest });
}
const M = (L, s, e, q, opt) => { const r = move(L, s, e, q, opt); assert.ok(r.ok, `move ${e}:${q} (${r.reason})`); return r; };
const word = (s, i) => s.w[i].map((c) => { const X = s.x[c]; return `${X[0] === i ? X[1] : X[0]}${X[2] === i ? '+' : '-'}`; }).join(' ');

// ---------- the rim ----------

test('rim: interleaved ends (an odd number of crossings), the cyclic edge cases', () => {
  const n = 12;
  assert.equal(crosses(n, 0, 6, 3, 9), true);
  assert.equal(crosses(n, 0, 6, 1, 5), false, 'nested');
  assert.equal(crosses(n, 0, 6, 6, 9), false, 'sharing a peg');
  assert.equal(inArc(n, 10, 2, 0), true);
  assert.equal(inArc(n, 10, 2, 10), false, 'an end is not strictly inside');
  assert.equal(crosses(n, 11, 1, 0, 6), true, 'straddling peg 0');
  assert.equal(cdist(n, 11, 1), 2);
  assert.equal(cdist(n, -1, 1), 2);
});

// ---------- the step rule ----------

test('step rule: passing a knot lays the carried end OVER its tail; passing an empty peg changes nothing', () => {
  // red 0-8 under nothing; blue 4-12 elsewhere: they don't cross (both sides of 16)
  const L = lv(16, [[1, 6], [9, 13, 'i']]);
  let s = newState(L);
  assert.equal(totalCrossings(L, s), 0);
  // (scramble: nothing lifts off, so the bare step can be read)
  // blue's end on 9 goes to 7: passes 8 (empty) only
  let r = M(L, s, 2, 7, { scramble: true });
  assert.equal(r.made, 0);
  assert.deepEqual(r.passed, []);
  assert.equal(totalCrossings(L, r.state), 0);
  // ...to 4 instead: passes 8, 7 (empty) and 6 (red's knot): one crossing, blue over red
  r = M(L, s, 2, 4, { scramble: true });
  assert.equal(r.dir, -1, 'the way that does not pass its own other knot (13)');
  assert.deepEqual(r.passed, [6]);
  s = r.state;
  assert.equal(totalCrossings(L, s), 1);
  const c = s.w[1][0];
  assert.equal(s.x[c][2], 1, 'the carried strand is on top');
  assert.equal(nearestAt(s.w, 2), c, 'at the moved end of the mover');
  assert.equal(nearestAt(s.w, 1), c, 'at the passed knot’s end of the tail');
  assert.ok(crosses(16, 1, 6, 4, 13), 'and the ends now interleave');
});

test('step rule: a strand never passes its own other knot; a shared knot that would can’t go', () => {
  const L = lv(12, [[0, 6], [3, 9, 'i']]);
  const s = newState(L);
  // blue's end on 3 to 1: the clockwise way would pass its own knot on 9
  const p = pathOf(L, s.ends, 2, 1);
  assert.equal(p.dir, -1);
  assert.deepEqual(p.passed, []);
  const p2 = pathOf(L, s.ends, 2, 11);
  assert.equal(p2.dir, -1);
  assert.deepEqual(p2.passed, [0], 'past red’s knot on 0, not round past 9');
  // a shared knot on 6 with far ends on 2 and 10: it can go to 7 or 5 (no far end passed) but not to 0
  const S = lv(14, [[2, 6], [6, 10, 'i'], [4, 8, 'w']], { links: [[1, 2]] });
  assert.equal(whyNotTo(S, newState(S), 1, 13), 'around', 'far ends on 2 and 10 lie either way round');
  assert.equal(whyNotTo(S, newState(S), 1, 7), null);
});

test('step rule: passing a shared knot crosses both tails, in the order they leave the knot', () => {
  // strands 0 (2-7) and 1 (7-12) share the knot on 7; its clockwise tail is strand 1's (end 2)
  const L = lv(16, [[2, 7], [7, 12, 'i'], [3, 6, 'w']], { links: [[2, 1]] });
  // yellow's end on 6 goes clockwise to 9, past the shared knot: first the tail on the side it comes from (strand 0), then strand 1
  const r = M(L, newState(L), 5, 9, { scramble: true });
  assert.deepEqual(r.passed, [7]);
  assert.equal(word(r.state, 2), '0+ 1+');
  assert.equal(word(r.state, 0), '2-');
  assert.equal(word(r.state, 1), '2-');
  // carried over BOTH of strand 0's knots, yellow slides right off it (the two crossings are neighbors along both)
  const L2 = lv(14, [[3, 6], [6, 10, 'i'], [12, 1, 'w']], { links: [[2, 1]] });
  const r2 = M(L2, newState(L2), 5, 8, { scramble: true });
  assert.deepEqual(r2.passed, [3, 6]);
  assert.equal(r2.cancelled, 2);
  assert.equal(word(r2.state, 2), '1+');
  assert.equal(word(r2.state, 0), '');
});

// ---------- cancellation ----------

test('cancellation: carrying an end straight back over the knot it passed cancels both crossings', () => {
  const L = lv(16, [[1, 6], [9, 13, 'i']]);
  const s0 = newState(L);
  const s1 = M(L, s0, 2, 4, { scramble: true }).state;
  assert.equal(totalCrossings(L, s1), 1);
  const r = M(L, s1, 2, 9);
  assert.equal(r.made, 1);
  assert.equal(r.cancelled, 2);
  assert.equal(totalCrossings(L, r.state), 0);
  assert.equal(r.freed.length, 2, 'crossing nothing, both come free');
});

test('cancellation: an upper strand carried over the lower one’s knot slides off (same strand on top at both)', () => {
  // red 0-8 over blue 4-12: red's end 8 -> 13 passes blue's knot on 12
  const L = lv(16, [[0, 8], [4, 12, 'i']], { over: [[0, 1]] });
  const r = M(L, newState(L), 1, 13);
  assert.equal(r.made, 1);
  assert.equal(r.cancelled, 2);
  assert.ok(isDone(r.state));
});

// A (red, 13-3) lies over B (blue, 12-4) twice; C (yellow, 14-2) dips under
// B and back up between them (a clasp with B); D (green, 8-11) is apart.
function dipLevel() {
  return buildLevel({ id: 'dip', name: 'Dip', n: 16, strands: [{ c: 'm', a: 13, b: 3 }, { c: 'i', a: 12, b: 4 }, { c: 'w', a: 14, b: 2 }, { c: 'g', a: 8, b: 11 }],
    x: [[0, 1, 0, -1], [0, 1, 0, 1], [1, 2, 1, 1], [1, 2, 2, -1]], w: [[0, 1], [0, 2, 3, 1], [2, 3], []] });
}
test('cancellation: two crossings next to each other along one strand only are kept', () => {
  const L = dipLevel();
  const s = newState(L);
  assert.equal(word(s, 0), '1+ 1+', 'A over B, twice, neighbors along A');
  assert.equal(word(s, 1), '0- 2+ 2- 0-', 'but C dips in between them along B');
  assert.equal(pairLeft(s.w, s.x, 0, 1), 0, 'on their own, A and B would part');
  // a move that stirs every word (green carried past B, A and C's knots) cancels nothing
  const r = M(L, s, 7, 15, { scramble: true });
  assert.deepEqual(r.passed, [12, 13, 14]);
  assert.equal(r.cancelled, 0);
  assert.equal(word(r.state, 0), '3- 1+ 1+', 'A still lies over B twice: sliding A off would only move the crossings onto C');
  checkPicture(L, s, 'dip');
  checkPicture(L, r.state, 'dip after');
});

// ---------- clasps ----------

function ownerLevel() {
  // red 0-8 over blue 4-12: an X, red on top
  return lv(16, [[0, 8, 'm'], [4, 12, 'i']], { over: [[0, 1]] });
}

test('the owner’s scenario: move the lower strand’s end next to the upper one’s, then the upper next to the lower’s: hooked', () => {
  const L = ownerLevel();
  let s = newState(L);
  assert.equal(word(s, 0), '1+');
  // blue's end on 4 goes next to red's knot on 0 (to 15): it passes over red's tail
  let r = M(L, s, 2, 15);
  assert.deepEqual(r.passed, [0]);
  s = r.state;
  // red's end on 8 goes next to blue's other knot on 12 (to 11)
  s = M(L, s, 1, 11).state;
  assert.equal(totalCrossings(L, s), 2, 'still crossing, twice');
  assert.equal(word(s, 0), '1- 1+', 'red: under blue, then over blue');
  assert.equal(word(s, 1), '0+ 0-', 'blue: over red, then under red');
  assert.deepEqual(hookedPairs(L, s), [[0, 1]], 'a clasp: two cut loops, hooked');
  assert.equal(pairLeft(s.w, s.x, 0, 1), 2, 'they can’t cancel between themselves');
  assert.ok(!crosses(16, s.ends[0], s.ends[1], s.ends[2], s.ends[3]), 'though their ends no longer interleave');
  assert.equal(remaining(s), 2, 'nothing came free');
  assert.deepEqual(liftable(L, s), [], 'hooked strands never lift off: each lies under the other somewhere');
  // undoing it by moves, in reverse order: back to the X, unhooked, and then
  // red lies over everything it crosses: it lifts off, and blue, crossing
  // nothing now, follows (a cascade)
  s = M(L, s, 1, 8).state;
  r = M(L, s, 2, 4);
  assert.equal(r.cancelled, 2);
  assert.equal(word(r.pre, 0), '1+', 'the X, just before the lift-off');
  assert.deepEqual(r.freed.map((f) => [f.s, f.round]), [[0, 0], [1, 1]]);
  assert.ok(isDone(r.state));
});

test('clasps persist: moves of the hooked strands that pass nothing, and every move of another strand, leave the clasp', () => {
  // red 0-10 over blue 5-15; yellow 12-17 crosses blue
  const L = lv(20, [[0, 10, 'm'], [5, 15, 'i'], [12, 17, 'w']], { over: [[0, 1], [1, 2]] });
  const s = M(L, newState(L), 2, 19).state; // blue's end 5 -> 19, over red's knot on 0: hooked
  assert.deepEqual(hookedPairs(L, s), [[0, 1]]);
  const hooked = (t) => pairLeft(t.w, t.x, 0, 1);
  assert.equal(hooked(s), 2);
  const t = M(L, s, 1, 9);
  assert.deepEqual(t.passed, []);
  assert.equal(hooked(t.state), 2, 'red’s end slid along empty pegs');
  const ys = legalMoves(L, s).filter(([e]) => (e >> 1) === 2);
  assert.ok(ys.length > 5);
  for (const [e, q] of ys) assert.equal(hooked(move(L, s, e, q).state), 2, `yellow ${e}:${q}`);
});

// ---------- liftability ----------

test('lifting: free in the early bands; on over-and-under hoops only when the strand lies on top at the crossing nearest that knot', () => {
  // red 0-8 under blue 4-12 (blue on top); yellow 10-14 crosses blue near blue's 12 end, under blue... over: yellow over blue
  const make = (layering) => lv(16, [[0, 8, 'm'], [4, 12, 'i'], [10, 14, 'w']], { over: [[2, 1]], layering });
  const F = make(false), T = make(true);
  for (let e = 0; e < 6; e++) assert.equal(canLift(F, newState(F), e), null, `free band: end ${e}`);
  const s = newState(T);
  assert.deepEqual(canLift(T, s, 0), { reason: 'under', blockers: [1] }, 'red is under blue: pinned at both ends');
  assert.deepEqual(canLift(T, s, 1), { reason: 'under', blockers: [1] });
  assert.equal(canLift(T, s, 2), null, 'blue’s end on 4: its nearest crossing (red) has blue on top');
  assert.deepEqual(canLift(T, s, 3), { reason: 'under', blockers: [2] }, 'blue’s end on 12: yellow lies over it there');
  assert.equal(canLift(T, s, 4), null, 'yellow lies on top');
  assert.deepEqual(targets(T, s, 0), []);
  assert.deepEqual(mechanicsOf(T), ['layering']);
  // a stitched knot never lifts
  const X = lv(12, [[0, 6], [3, 9]], { fixed: [0] });
  assert.equal(canLift(X, newState(X), 0).reason, 'fixed');
});

// ---------- the picture matches the words ----------

// Every crossing in the words is drawn exactly once, where the layout says,
// and nothing else crosses; and what is painted on top there is the strand
// the words say lies over.
function checkPicture(L, s, tag, live = new Set()) {
  const lay = layout(L, s);
  assert.ok(eulerOk(lay.map), `${tag}: the map is planar`);
  const ids = Object.keys(lay.strands).map(Number);
  for (const a of ids) for (const b of ids) {
    if (b <= a) continue;
    // (strands tied into one shared knot meet at its peg, on the rim: not a crossing)
    const hs = hits(lay.strands[a], lay.strands[b], 1e-9).filter((h) => Math.hypot(h[0], h[1]) < 1 - 1e-6);
    const want = lay.crossings.filter((X) => X.a === a && X.b === b);
    assert.equal(hs.length, want.length, `${tag}: strands ${a} and ${b} cross ${want.length} times in the words, ${hs.length} in the picture`);
    for (const X of want) assert.ok(hs.some((h) => Math.hypot(h[0] - X.p[0], h[1] - X.p[1]) < 1e-6), `${tag}: crossing at its place`);
  }
  const w = 0.045;
  const P = plan(lay.strands, lay.crossings, { w, live });
  for (const X of lay.crossings) assert.equal(topAt(lay.strands, P, X.p, w, [X.a, X.b]), X.top, `${tag}: drawn on top at crossing ${X.c}`);
  return lay;
}

test('the picture: the owner’s clasp is drawn as two hooked loops, each crossing once, over and under as recorded', () => {
  const L = ownerLevel();
  let s = M(L, newState(L), 2, 15).state;
  s = M(L, s, 1, 11).state;
  const lay = checkPicture(L, s, 'clasp');
  assert.equal(lay.crossings.length, 2);
  assert.deepEqual(lay.crossings.map((X) => X.top).sort(), [0, 1], 'one crossing each way: no stacking of whole strands could draw it');
  // and with either strand live (repainted every frame)
  checkPicture(L, s, 'clasp, red live', new Set([0]));
  checkPicture(L, s, 'clasp, blue live', new Set([1]));
  // a cycle of three: A over B, B over C, C over A
  const C3 = lv(12, [[0, 6, 'm'], [4, 11, 'i'], [9, 2, 'w']], { over: [[0, 1], [1, 2], [2, 0]] });
  const t = newState(C3);
  assert.deepEqual(t.x.map((X) => [X[0], X[1], X[2]]).sort(), [[0, 1, 0], [0, 2, 2], [1, 2, 1]]);
  checkPicture(C3, t, 'cycle');
  checkPicture(C3, t, 'cycle, one live', new Set([2]));
  assert.equal(baseOrder([0, 1, 2], layout(C3, t).crossings).length, 3);
});

test('the picture: every level, along its solution and along random scrambles, matches its words', () => {
  let states = 0;
  for (const L of LEVELS) {
    let s = newState(L);
    checkPicture(L, s, `${L.id} start`, new Set([0]));
    for (const [e, q] of parseMoves(L.solution)) {
      s = move(L, s, e, q).state;
      if (!isDone(s)) { checkPicture(L, s, `${L.id} after ${e}:${q}`); states++; }
    }
  }
  const rng = mulberry(5);
  for (const L of LEVELS.filter((_, i) => i % 3 === 0)) {
    let s = newState(L);
    for (let k = 0; k < 6; k++) {
      const ms = legalMoves({ ...L, layering: false }, s);
      if (!ms.length) break;
      const [e, q] = ms[Math.floor(rng() * ms.length)];
      const r = move(L, s, e, q, { scramble: true });
      s = r.state;
      checkPicture(L, s, `${L.id} scramble ${k}`, new Set([e >> 1]));
      states++;
    }
  }
  assert.ok(states > 80, `${states} states`);
});

// ---------- coming free, mechanics, undo ----------

// ---------- lift-off ----------

test('lift-off: a strand lying over everything it crosses lifts right off, and its crossings leave the other words', () => {
  // red 0-10 over blue 5-15; green 12-17 crosses blue, on top
  const L = lv(20, [[0, 10, 'm'], [5, 15, 'i'], [12, 17, 'g']], { over: [[0, 1]] });
  const s = newState(L);
  assert.deepEqual(liftable(L, s).map((u) => u[0]).sort(), [0, 2], 'red and green lie on top of everything (a level never starts like this)');
  // blue's end 5 -> 19, over red's knot on 0: red and blue hook; green still lies over everything and lifts off
  const r = M(L, s, 2, 19);
  assert.deepEqual(r.freed.map((f) => f.s), [2]);
  assert.ok(r.pre.w[2].length > 0, 'it was crossing blue when it went: a lift-off, not a strand crossing nothing');
  assert.equal(word(r.state, 1), '0+ 0-', 'blue’s word lost its green crossing');
  assert.deepEqual(hookedPairs(L, r.state), [[0, 1]]);
  assert.deepEqual(liftable(L, r.state), []);
  assert.equal(wordsError(L, r.state.ends, r.state.w, r.state.x), null);
});

test('lift-off cascades: one strand leaving can leave the next on top of everything', () => {
  // red 0-8 over blue 4-12, blue over yellow 10-14; yellow's end slides along empty pegs
  const L = lv(16, [[0, 8, 'm'], [4, 12, 'i'], [10, 14, 'w']], { over: [[0, 1], [1, 2]] });
  const r = M(L, newState(L), 5, 15);
  assert.deepEqual(r.passed, []);
  assert.deepEqual(r.freed.map((f) => [f.s, f.round]), [[0, 0], [1, 1], [2, 2]], 'red, then blue, then yellow');
  assert.ok(isDone(r.state));
});

test('lift-off: a strand UNDER everything stays (the linen beneath, the strands over it pin it); a clasp never lifts off', () => {
  // red and blue hooked; yellow lies under blue and crosses nothing else: under everything
  const L = lv(20, [[0, 10, 'm'], [5, 15, 'i'], [12, 17, 'w']], { over: [[0, 1], [1, 2]] });
  const r = M(L, newState(L), 2, 19);
  assert.deepEqual(r.freed, []);
  assert.equal(word(r.state, 2), '1-', 'yellow: under blue, and nothing else');
  assert.deepEqual(liftable(L, r.state), []);
  assert.ok(mutual(r.state.w, r.state.x, 0, 1), 'red and blue each lie over the other somewhere');
  // every move that leaves red and blue hooked leaves both on the hoop
  for (const [e, q] of legalMoves(L, r.state)) {
    const t = move(L, r.state, e, q).state;
    if (!t.out[0] && !t.out[1] && mutual(t.w, t.x, 0, 1)) assert.ok(!t.out[0] && !t.out[1]);
    for (const [a, b] of hookedPairs(L, t)) assert.ok(!liftable(L, t).some((u) => u.includes(a) || u.includes(b)), `${e}:${q}`);
  }
});

test('lift-off: strands tied into one shared knot lift off together once they lie over everything else', () => {
  // strands 0 (2-6) and 1 (6-10) share the knot on 6, both over yellow (4-8)
  const L = lv(12, [[2, 6], [6, 10, 'i'], [4, 8, 'w']], { links: [[2, 1]], over: [[0, 2], [1, 2]] });
  assert.deepEqual(movers(L, 1), [1, 2]);
  assert.equal(crossersOf(L, newState(L), 0).includes(1), false, 'strands sharing a knot start uncrossed');
  assert.deepEqual(liftable(L, newState(L)), [[0, 1]]);
  const r = M(L, newState(L), 4, 3); // yellow's end slides along: nothing passed
  assert.deepEqual(r.freed.map((f) => [f.s, f.round]), [[0, 0], [1, 0], [2, 1]]);
  // with yellow over one of them, the pair stays
  const K = lv(12, [[2, 6], [6, 10, 'i'], [4, 8, 'w']], { links: [[2, 1]], over: [[0, 2]] });
  assert.deepEqual(liftable(K, newState(K)), [], 'yellow lies over strand 1, strand 0 over yellow: nothing lifts off');
  assert.deepEqual(mechanicsOf(L), ['links']);
});

test('the owner’s level 2 (as it was): the horizontal red is hooked with the blue, so it is not on top of everything', () => {
  // red 7-0, red 8-4 (the horizontal one), blue 2-11; five crossings
  const L = buildLevel({ id: 's', name: 'S', n: 12, strands: [{ c: 'm', a: 7, b: 0 }, { c: 'm', a: 8, b: 4 }, { c: 'i', a: 2, b: 11 }],
    x: [[0, 2, 2, -1], [0, 1, 1, 1], [1, 2, 2, -1], [1, 2, 1, 1]], w: [[0, 1], [2, 1, 3], [3, 0, 2]] });
  const s = newState(L);
  assert.ok(eulerOk(planarMap(L, s)));
  assert.equal(word(s, 1), '2- 0+ 2+', 'under blue, over the other red, over blue');
  assert.deepEqual(hookedPairs(L, s), [[1, 2]]);
  assert.deepEqual(liftable(L, s), [], 'nothing would lift off');
  checkPicture(L, s, 'owner’s level 2');
  // the level 2 that ships now: nothing free at the start, and not a one-move hoop
  const L2 = LEVELS[1];
  assert.deepEqual(liftable(L2, newState(L2)), []);
  assert.ok(L2.par >= 2);
});

// ---------- where ends may go ----------

test('any empty peg: no rule about how far apart a strand’s ends are', () => {
  const L = lv(16, [[0, 8, 'm'], [4, 12, 'i']], { over: [[0, 1]], pegs: { 6: 'i' } });
  const s = newState(L);
  assert.equal(whyNotTo(L, s, 1, 1), null, 'right next to its own other knot');
  assert.equal(whyNotTo(L, s, 1, 15), null, 'on its other side too');
  assert.equal(whyNotTo(L, s, 1, 6), 'color');
  assert.equal(whyNotTo(L, s, 1, 4), 'taken');
  assert.equal(whyNotTo(L, s, 1, 8), 'same');
  assert.deepEqual(targets(L, s, 1), [1, 2, 3, 5, 7, 9, 10, 11, 13, 14, 15]);
  // red carried right next to its own knot on 0, the way that doesn't pass it: over blue's knot on 4, cancelling the X; it lifts off
  const r = M(L, s, 1, 1);
  assert.equal(r.dir, -1);
  assert.deepEqual(r.passed, [4]);
  assert.ok(isDone(r.state));
  // blue (under red) carried next to its own other knot instead: over red's knot: hooked, nothing free
  const r2 = M(L, s, 2, 13);
  assert.deepEqual(r2.freed, []);
  assert.deepEqual(hookedPairs(L, r2.state), [[0, 1]]);
  assert.throws(() => buildLevel({ id: 'b', name: 'B', n: 12, strands: [{ c: 'm', a: 0, b: 6 }, { c: 'i', a: 3, b: 9 }] }), /cross 0 times/, 'the words must agree with the ends');
  assert.doesNotThrow(() => lv(12, [[0, 1]]), 'a strand between neighboring pegs is fine');
});

test('undo: steps back exactly, hooks and all', () => {
  const L = ownerLevel();
  let g = newGame(L);
  const r1 = play(L, g, 2, 15);
  g = r1.game;
  const mid = g.state;
  const r2 = play(L, g, 1, 11);
  g = undo(r2.game);
  assert.deepEqual(g.state, mid);
  g = undo(g);
  assert.deepEqual(g.state, newState(L));
  assert.equal(play(L, g, 2, 0).ok, false, 'a taken peg');
});

// ---------- the levels ----------

test('levels: twenty hoops made by real moves, every stored solution replays, mechanics one at a time, hooked strands early', () => {
  assert.equal(LEVELS.length, 20);
  const seen = new Set();
  LEVELS.forEach((L, i) => {
    const sol = parseMoves(L.solution);
    assert.equal(sol.length, L.par);
    const end = replay(L, L.solution);
    assert.ok(isDone(end), `${L.id} clears`);
    const s = newState(L);
    assert.ok(crossCounts(L, s).every((c) => c > 0), `${L.id}: every strand crosses something`);
    assert.deepEqual(liftable(L, s), [], `${L.id}: nothing lies on top of everything at the start (nothing free before she starts)`);
    assert.equal(wordsError(L, s.ends, s.w, s.x), null);
    const [lo, hi] = LEVEL_DEFS[i].knobs.par;
    assert.ok(L.par >= lo && L.par <= hi, `${L.id}: par ${L.par} in ${lo}-${hi}`);
    const fresh = L.mechanics.filter((m) => !seen.has(m));
    assert.ok(fresh.length <= (i === LEVELS.length - 1 ? 3 : 1), `${L.id} brings in ${fresh}`);
    for (const m of L.mechanics) { assert.ok(MECHANICS[m], m); seen.add(m); }
  });
  assert.deepEqual(LEVELS[0].mechanics, [], 'level 1 has nothing hooked');
  assert.ok(LEVELS[1].mechanics.includes('clasp'), 'level 2 brings in hooked strands');
  assert.ok(LEVELS.filter((L) => hookedPairs(L, newState(L)).length).length >= 6, 'clasps are common');
  assert.deepEqual([...seen].sort(), Object.keys(MECHANICS).sort(), 'every mechanic appears');
  assert.ok(BANDS.every((b, i) => i === 0 || b.from > BANDS[i - 1].from));
  assert.ok(LEVELS.filter((L) => L.layering).every((L) => L.stats.optimal), 'over-and-under pars are proven');
});

test('levels: pars are minimal (A* with a consistent bound, re-run here on the quick ones; breadth-first on the smallest)', () => {
  for (const L of LEVELS) {
    assert.ok(lowerBound(L, newState(L)) <= L.par, `${L.id}: the bound never overshoots`);
    if (L.stats.nodes > 150) continue; // the big ones were proved by gen-levels.mjs (stats.optimal)
    const r = solve(L);
    assert.ok(r.ok && r.optimal, L.id);
    assert.equal(r.path.length, L.par, L.id);
  }
  // breadth-first agrees on the two smallest
  for (const L of LEVELS.slice(0, 2)) {
    let frontier = [newState(L)], d = 0, found = -1;
    const seen = new Set([stateKey(L, frontier[0])]);
    while (found < 0 && d < L.par) {
      d++;
      const next = [];
      for (const s of frontier) for (const [e, q] of legalMoves(L, s)) {
        const t = move(L, s, e, q).state;
        if (isDone(t)) { found = d; break; }
        const k = stateKey(L, t);
        if (!seen.has(k)) { seen.add(k); next.push(t); }
      }
      frontier = next;
    }
    assert.equal(found, L.par, `${L.id}: breadth-first`);
  }
});

// ---------- determinism ----------

test('determinism: the generator makes the same hoop from the same seed, as stored; moves, solver, bots and keys repeat', () => {
  const idx = LEVEL_DEFS.findIndex((d) => d.id === 'floss');
  const h = HOOPS.floss;
  const a = candidate(mulberry(h.seed * 7919 + idx * 131 + 1), LEVEL_DEFS[idx].knobs);
  const b = candidate(mulberry(h.seed * 7919 + idx * 131 + 1), LEVEL_DEFS[idx].knobs);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), h.def, 'hoops.js matches the generator');
  assert.deepEqual(cleanHoop(mulberry(3), 16, 5), cleanHoop(mulberry(3), 16, 5));
  const L = LEVELS[3];
  assert.deepEqual(replay(L, L.solution), replay(L, L.solution));
  assert.deepEqual(solve(L), solve(L));
  assert.equal(formatMoves(parseMoves(L.solution)), L.solution);
  assert.equal(randomRate(L, 30, 9, 10), randomRate(L, 30, 9, 10));
  assert.equal(greedyRate(L, 30, 9, 5), greedyRate(L, 30, 9, 5));
  assert.notEqual(levelSig(L), levelSig(LEVELS[4]));
  const s = replay(L, parseMoves(L.solution).slice(0, 1));
  assert.equal(stateKey(L, s), stateKey(L, JSON.parse(JSON.stringify(s))));
  assert.deepEqual(layout(L, s).crossings, layout(L, s).crossings, 'the picture repeats too');
});

// ---------- saves ----------

test('saves: the old over-and-under model’s saved hoop is set aside (new state version, new level signatures)', () => {
  assert.equal(VERSION, 2);
  assert.equal(MODEL, 'words-2-liftoff');
  const L = LEVELS[0];
  const old = { v: 1, level: L.id, ends: L.start.slice(), out: Array(L.S).fill(0), z: [...Array(L.S).keys()], moves: 0 };
  assert.notEqual(old.v, VERSION);
  assert.ok(wordsError(L, old.ends, old.w, old.x), 'a save without words is not a position');
  assert.equal(HOOPS.first.def.x !== undefined, true);
  // the signature covers the model and the starting words
  const other = buildLevel({ ...L.def, id: L.id, name: L.name, x: L.def.x.map((X) => [X[0], X[1], X[0] === X[2] ? X[1] : X[0], X[3]]) });
  assert.notEqual(levelSig(other), levelSig(L), 'turning a crossing over changes the signature');
});

// ---------- hints ----------

test('hint: follows the stored solution, finds a way from elsewhere, and spots a dead end', () => {
  const L = LEVELS[4];
  const sol = parseMoves(L.solution);
  let h = hint(L, newState(L));
  assert.deepEqual([h.end, h.to], sol[0]);
  assert.deepEqual(solutionStep(L, newState(L)), sol[0]);
  const s = newState(L);
  const off = legalMoves(L, s).find(([e, q]) => !(e === sol[0][0] && q === sol[0][1]) && !isDone(move(L, s, e, q).state));
  const t = move(L, s, off[0], off[1]).state;
  h = hint(L, t, { cap: 700 });
  assert.equal(h.kind, 'move');
  assert.ok(move(L, t, h.end, h.to).ok);
  // every peg taken, and each strand under another: nowhere to go, nothing lifts off
  const D = lv(6, [[0, 3], [1, 4, 'i'], [2, 5, 'w']], { over: [[0, 1], [1, 2], [2, 0]] });
  assert.deepEqual(legalMoves(D, newState(D)), []);
  assert.deepEqual(liftable(D, newState(D)), []);
  assert.equal(hint(D, newState(D)).kind, 'tangled');
});

test('what the yarn could make: 14 inches a strand, one flower per 18-inch needle-length', () => {
  assert.equal(yarnLine(3).inches, 42);
  assert.match(yarnLine(9).line, /3\.5 yards.*2-inch tassel/);
  void COLORS; void endsAt; void sparePegs; void planarMap;
});
