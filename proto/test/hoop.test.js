import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REACH, COLORS, cdist, inArc, crosses, buildLevel, newState, move, canLift, whyNotTo, targets, legalMoves, endsAt, crossersOf,
  crossCounts, totalCrossings, isDone, remaining, movers, newGame, play, undo, replay, solve, hint, solutionStep, parseMoves,
  formatMoves, randomRate, greedyRate, mulberry, stateKey, levelSig, sparePegs, mechanicsOf, yarnLine, chordCurve, lamFor,
  LAM_SLACK, LAM_TAUT, warp,
} from '../hoop/rules.js';
import { candidate } from '../hoop/gen.js';
import { LEVELS, LEVEL_DEFS, MECHANICS, BANDS } from '../hoop/levels.js';
import { HOOPS } from '../hoop/hoops.js';

const lv = (n, strands, o = {}) => buildLevel({ id: 't', name: 'T', n, strands: strands.map(([a, b, c = 'm']) => ({ c, a, b })), ...o });
const M = (L, s, e, q) => { const r = move(L, s, e, q); assert.ok(r.ok, `move ${e}:${q} (${r.reason})`); return r; };

// ---------- the crossing rule ----------

test('crossing: interleaved pegs cross; nested, side-by-side and shared pegs do not', () => {
  const n = 12;
  assert.equal(crosses(n, 0, 6, 3, 9), true, 'two diameters');
  assert.equal(crosses(n, 0, 6, 1, 5), false, 'nested on one side');
  assert.equal(crosses(n, 0, 3, 5, 9), false, 'side by side');
  assert.equal(crosses(n, 0, 6, 6, 9), false, 'sharing a peg is not a crossing');
  assert.equal(crosses(n, 0, 6, 0, 3), false, 'sharing a peg, other side');
  assert.equal(crosses(n, 0, 1, 2, 11), false, 'neighbors: nothing lies between them');
});

test('crossing: order of ends and of strands never matters', () => {
  const n = 14;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (const [c, d] of [[1, 8], [3, 10], [12, 2], [5, 6]]) {
    if (a === b) continue;
    const x = crosses(n, a, b, c, d);
    assert.equal(crosses(n, b, a, c, d), x);
    assert.equal(crosses(n, a, b, d, c), x);
    assert.equal(crosses(n, c, d, a, b), x);
  }
});

test('crossing: the cyclic edge cases around peg 0', () => {
  const n = 12;
  // the clockwise run from 10 to 2 is 11, 0, 1
  assert.equal(inArc(n, 10, 2, 0), true);
  assert.equal(inArc(n, 10, 2, 11), true);
  assert.equal(inArc(n, 10, 2, 5), false);
  assert.equal(inArc(n, 10, 2, 10), false, 'an end is not strictly inside');
  assert.equal(inArc(n, 10, 2, 2), false);
  assert.equal(crosses(n, 10, 2, 0, 5), true, 'wraps past 0 and crosses');
  assert.equal(crosses(n, 10, 2, 11, 1), false, 'wraps past 0, nested');
  assert.equal(crosses(n, 11, 0, 5, 6), false, 'the last and first pegs are neighbors');
  assert.equal(crosses(n, 11, 1, 0, 6), true, 'straddling peg 0');
  assert.equal(cdist(n, 11, 1), 2, 'distance wraps the short way');
  assert.equal(cdist(n, 0, 6), 6);
  assert.equal(cdist(n, -1, 1), 2, 'negative input is taken around the hoop');
});

test('crossing: matches straight-chord geometry for every pair of chords on a 12-peg hoop', () => {
  const n = 12;
  const P = (p) => [Math.cos((2 * Math.PI * p) / n), Math.sin((2 * Math.PI * p) / n)];
  const side = (o, a, b) => Math.sign((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]));
  const segX = (p, q, r, s) => side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
  const chords = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) chords.push([a, b]);
  for (const [a, b] of chords) for (const [c, d] of chords) {
    if (new Set([a, b, c, d]).size < 4) continue;
    assert.equal(crosses(n, a, b, c, d), segX(P(a), P(b), P(c), P(d)), `${a}-${b} vs ${c}-${d}`);
  }
});

test('the picture: each strand drawn with its own slack shows exactly the rule’s crossings', () => {
  const segX = (p, q, r, s) => {
    const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
    const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
    if (!(t >= 0 && t < 1 && u >= 0 && u < 1)) return false;
    return Math.hypot(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t) < 1 - 1e-6; // not at a knot
  };
  const count = (A, B) => { let c = 0; for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) if (segX(A[i - 1], A[i], B[j - 1], B[j])) c++; return c; };
  let pairs = 0;
  for (const n of [12, 18, 24]) {
    // one strand from peg 0; the other anywhere (rotation covers the rest)
    for (let b = REACH; b <= n - REACH; b += n > 12 ? 2 : 1) for (let c = 1; c < n; c++) for (let d = c + REACH; d < n; d += 2) {
      if (new Set([0, b, c, d]).size < 4 || cdist(n, c, d) < REACH) continue;
      const want = crosses(n, 0, b, c, d) ? 1 : 0;
      for (const [la, lb] of [[LAM_TAUT, LAM_SLACK], [LAM_SLACK, LAM_TAUT]]) {
        assert.equal(count(chordCurve(n, 0, b, la, 24), chordCurve(n, c, d, lb, 24)), want, `n ${n}: 0-${b} (${la}) vs ${c}-${d} (${lb})`);
        pairs++;
      }
    }
  }
  assert.ok(pairs > 500);
  // knots stay on their pegs, and slack follows crossings
  const [x, y] = warp(1, 0, 0.5);
  assert.ok(Math.abs(x - 1) < 1e-9 && Math.abs(y) < 1e-9);
  assert.equal(lamFor(1), LAM_SLACK);
  assert.equal(lamFor(4), LAM_TAUT);
  assert.ok(lamFor(2) < lamFor(1) && lamFor(3) < lamFor(2));
});

// ---------- moves ----------

test('moves: only to an empty peg, at least REACH pegs from the other end', () => {
  const L = lv(12, [[0, 6], [3, 9]]);
  const s = newState(L);
  assert.equal(whyNotTo(L, s, 1, 3), 'taken');
  assert.equal(whyNotTo(L, s, 1, 6), 'same');
  assert.equal(whyNotTo(L, s, 1, 2), 'reach', 'two pegs from its other end');
  assert.equal(whyNotTo(L, s, 1, 10), 'reach', 'two pegs the other way round');
  assert.equal(whyNotTo(L, s, 1, 4), null);
  assert.deepEqual(targets(L, s, 1), [4, 5, 7, 8]);
  assert.equal(move(L, s, 1, 2).ok, false);
  assert.equal(move(L, s, 1, 3).reason, 'taken');
  assert.equal(move(L, s, 9, 4).reason, 'gone', 'no such end');
  const r = M(L, s, 1, 8);
  assert.equal(r.state.moves, 1);
  assert.equal(r.from, 6);
  assert.deepEqual(r.state.ends.slice(0, 2), [0, 8]);
  assert.deepEqual(s.ends, [0, 6, 3, 9], 'the old state is untouched');
  assert.deepEqual(r.state.z, [1, 0], 'the moved strand is laid on top');
  // every legal move is a real one
  for (const [e, q] of legalMoves(L, s)) assert.ok(move(L, s, e, q).ok);
  assert.throws(() => lv(12, [[0, 2]]), /too short/);
  assert.throws(() => lv(12, [[0, 5], [5, 9]]), /two knots/);
});

// ---------- coming free ----------

test('freeing: a strand that crosses nothing slips off and frees its pegs', () => {
  const L = lv(12, [[0, 6], [3, 9, 'i'], [1, 4, 'w'], [8, 11, 'g']]);
  let s = newState(L);
  assert.deepEqual(crossCounts(L, s), [1, 3, 1, 1]);
  assert.equal(totalCrossings(L, s), 3);
  const r = M(L, s, 2, 5); // the indigo knot on 3 goes to 5: 5-9 no longer crosses 1-4
  assert.deepEqual(r.freed, [{ s: 2, a: 1, b: 4 }]);
  s = r.state;
  assert.equal(s.out[2], 1);
  assert.deepEqual(s.ends.slice(4, 6), [-1, -1]);
  assert.deepEqual(endsAt(L, s, 1), [], 'its pegs are empty again');
  assert.equal(whyNotTo(L, s, 7, 1), null, 'and ready to use');
  assert.equal(remaining(s), 3);
  assert.equal(canLift(L, s, 4).reason, 'gone');
  assert.deepEqual(crossCounts(L, s), [1, 2, 0, 1], 'the others still cross, so they stay');
  assert.deepEqual(crossersOf(L, s, 1), [0, 3]);
  assert.equal(isDone(s), false);
});

test('freeing: one move can free several strands at once, and the last frees the hoop', () => {
  // 1-4 nests inside 0-5; 2-8 crosses both of them
  const L = lv(12, [[0, 5], [1, 4, 'i'], [2, 8, 'w']]);
  const s = newState(L);
  assert.deepEqual(crossCounts(L, s), [1, 1, 2]);
  const r = M(L, s, 4, 11); // strand 2 becomes 11-8: it crosses nothing, and then neither do the other two
  assert.deepEqual(r.freed.map((f) => f.s).sort(), [0, 1, 2]);
  assert.ok(isDone(r.state));
  assert.equal(remaining(r.state), 0);
});

// ---------- mechanics ----------

test('stitched-down knots: that end can’t move, the other end can', () => {
  const L = lv(12, [[0, 6], [3, 9]], { fixed: [0] });
  const s = newState(L);
  assert.equal(canLift(L, s, 0).reason, 'fixed');
  assert.deepEqual(targets(L, s, 0), []);
  assert.equal(move(L, s, 0, 1).reason, 'fixed');
  assert.ok(move(L, s, 1, 8).ok);
  assert.ok(!legalMoves(L, s).some(([e]) => e === 0));
  assert.deepEqual(mechanicsOf(L), ['fixed']);
  assert.throws(() => lv(12, [[0, 6]], { fixed: [0, 1] }), /both ends/);
});

test('painted pegs: only yarn of that color may be tied there', () => {
  const L = lv(12, [[0, 6, 'm'], [3, 9, 'i']], { pegs: { 8: 'i', 4: 'm' } });
  const s = newState(L);
  assert.equal(whyNotTo(L, s, 1, 8), 'color', 'madder on an indigo peg');
  assert.equal(whyNotTo(L, s, 3, 8), null, 'indigo on the indigo peg');
  assert.equal(whyNotTo(L, s, 1, 4), null, 'madder on the madder peg');
  assert.ok(!targets(L, s, 1).includes(8));
  assert.deepEqual(mechanicsOf(L), ['pegs']);
  assert.throws(() => lv(12, [[0, 6, 'm']], { pegs: { 0: 'i' } }), /color/);
});

test('shared knots: both ends move together, never cross each other, and come free together', () => {
  // strands 0 (2-6) and 1 (6-10) share the knot on peg 6 (ends 1 and 2); strand 2 (4-8) crosses both
  const L = lv(12, [[2, 6], [6, 10, 'i'], [4, 8, 'w']], { links: [[1, 2]] });
  const s = newState(L);
  assert.deepEqual(movers(L, 1), [1, 2]);
  assert.deepEqual(movers(L, 2), [2, 1]);
  assert.equal(crossersOf(L, s, 0).includes(1), false, 'strands sharing a knot do not cross');
  assert.deepEqual(crossCounts(L, s), [1, 1, 2]);
  assert.equal(whyNotTo(L, s, 1, 0), 'reach', 'too close to strand 0’s far end');
  assert.equal(whyNotTo(L, s, 1, 11), 'reach', 'too close to strand 1’s far end');
  let r = M(L, s, 5, 11); // strand 2 becomes 4-11
  r = M(L, r.state, 4, 7); // strand 2 becomes 7-11: it no longer crosses strand 0
  assert.deepEqual(crossCounts(L, r.state), [0, 1, 1]);
  assert.deepEqual(r.freed, [], 'strand 0 crosses nothing, but its partner does, so neither leaves');
  r = M(L, r.state, 3, 3); // strand 1 becomes 6-3, around the far side: nothing crosses anything
  assert.deepEqual(r.freed.map((f) => f.s).sort(), [0, 1, 2]);
  assert.ok(isDone(r.state));
  // lifting the shared knot moves both ends to one peg
  const L2 = lv(14, [[0, 7], [7, 11, 'i'], [3, 9, 'w']], { links: [[1, 2]] });
  const m = M(L2, newState(L2), 2, 5);
  assert.equal(m.state.ends[1], 5);
  assert.equal(m.state.ends[2], 5);
  assert.deepEqual(m.movers, [2, 1]);
  const lm = legalMoves(L2, newState(L2));
  assert.ok(lm.some(([e]) => e === 1) && !lm.some(([e]) => e === 2), 'a shared knot is listed once, by its lower end');
  assert.deepEqual(mechanicsOf(L2), ['links']);
  assert.throws(() => lv(12, [[0, 6], [3, 9]], { links: [[1, 2]] }), /apart/);
});

test('over and under: a strand lifts only when nothing over it crosses it; a moved strand goes on top', () => {
  // later strands lie higher. 0: 6-10, 1: 8-0 over it; 2: 2-5, 3: 1-4 over that.
  const L = lv(12, [[6, 10], [8, 0, 'i'], [2, 5, 'w'], [1, 4, 'g']], { layering: true });
  const s = newState(L);
  assert.deepEqual(canLift(L, s, 0), { reason: 'under', blockers: [1] });
  assert.deepEqual(canLift(L, s, 4), { reason: 'under', blockers: [3] });
  assert.equal(canLift(L, s, 2), null, 'strand 1 only crosses a strand below it');
  assert.equal(canLift(L, s, 6), null, 'the top strand can always be lifted');
  const r = M(L, s, 3, 11); // strand 1 becomes 8-11, still over strand 0
  assert.deepEqual(r.state.z, [0, 3, 1, 2], 'laid down on top of everything');
  assert.deepEqual(canLift(L, r.state, 0).blockers, [1]);
  // the same position without the rule: anything may move
  const P = lv(12, [[6, 10], [8, 0, 'i'], [2, 5, 'w'], [1, 4, 'g']]);
  assert.equal(canLift(P, newState(P), 0), null);
  assert.deepEqual(mechanicsOf(L), ['layering']);
});

test('fewer spare pegs: the working space is the empty pegs at the start', () => {
  assert.equal(sparePegs(lv(12, [[0, 6], [3, 9]])), 8);
  assert.equal(sparePegs(lv(12, [[2, 6], [6, 10, 'i'], [4, 8, 'w']], { links: [[1, 2]] })), 7, 'a shared knot takes one peg');
  const snug = LEVELS.find((L) => L.id === 'snug');
  assert.equal(sparePegs(snug), 2);
  assert.ok(snug.mechanics.includes('spare'));
});

// ---------- undo ----------

test('undo: steps back exactly, including strands that came free', () => {
  const L = lv(12, [[0, 5], [1, 4, 'i'], [2, 8, 'w']]);
  let g = newGame(L);
  assert.equal(undo(g), g, 'nothing to undo');
  const r1 = play(L, g, 1, 6);
  assert.ok(r1.ok);
  g = r1.game;
  const mid = g.state;
  const r2 = play(L, g, 4, 11);
  assert.ok(isDone(r2.game.state));
  g = undo(r2.game);
  assert.deepEqual(g.state, mid);
  assert.equal(g.past.length, 1);
  g = undo(g);
  assert.deepEqual(g.state, newState(L));
  assert.equal(play(L, g, 5, 3).ok, false, 'an illegal move leaves the game alone');
  assert.equal(play(L, g, 5, 3).game, g);
});

// ---------- the levels ----------

test('levels: twenty hoops, every one cleared by its stored solution, mechanics one at a time', () => {
  assert.equal(LEVELS.length, 20);
  assert.equal(LEVEL_DEFS.length, 20);
  const seen = new Set();
  LEVELS.forEach((L, i) => {
    const sol = parseMoves(L.solution);
    assert.equal(sol.length, L.par);
    assert.equal(L.stats.par, L.par);
    const end = replay(L, L.solution);
    assert.ok(isDone(end), `${L.id} clears`);
    assert.equal(end.moves, L.par);
    const s = newState(L);
    assert.ok(crossCounts(L, s).every((c) => c > 0), `${L.id}: nothing is free before she starts`);
    assert.ok(L.n >= 12 && L.n <= 24, `${L.id}: ${L.n} pegs`);
    const [lo, hi] = LEVEL_DEFS[i].knobs.par;
    assert.ok(L.par >= lo && L.par <= hi, `${L.id}: par ${L.par} in ${lo}-${hi}`);
    const fresh = L.mechanics.filter((m) => !seen.has(m));
    assert.ok(fresh.length <= (i === LEVELS.length - 1 ? 3 : 1), `${L.id} brings in ${fresh}`);
    for (const m of L.mechanics) { assert.ok(MECHANICS[m], m); seen.add(m); }
    for (const c of L.color) assert.ok(COLORS[c]);
  });
  assert.deepEqual([...seen].sort(), Object.keys(MECHANICS).sort(), 'every mechanic appears');
  assert.ok(BANDS.every((b, i) => i === 0 || b.from > BANDS[i - 1].from));
});

test('levels: the stored par is the minimum on the smaller hoops (A* with an admissible bound)', () => {
  for (const L of LEVELS) {
    if (L.stats.nodes > 700) continue; // the big ones were proved by gen-levels.mjs
    const r = solve(L);
    assert.ok(r.ok && r.optimal, L.id);
    assert.equal(r.path.length, L.par, L.id);
    assert.ok(isDone(replay(L, r.path)));
  }
});

test('levels: difficulty broadly climbs (random clear rate within 60 moves)', () => {
  const first = LEVELS[0].stats.random, last = LEVELS.at(-1).stats.random;
  assert.ok(first > 0.9 && last < 0.1, `${first} -> ${last}`);
  for (const L of LEVELS) assert.ok(L.stats.random >= 0 && L.stats.random <= 1 && L.stats.spare >= 2);
});

// ---------- determinism ----------

test('determinism: the generator deals the same hoop from the same seed, as stored', () => {
  const idx = LEVEL_DEFS.findIndex((d) => d.id === 'floss');
  const h = HOOPS.floss;
  const a = candidate(mulberry(h.seed * 7919 + idx * 131 + 1), LEVEL_DEFS[idx].knobs);
  const b = candidate(mulberry(h.seed * 7919 + idx * 131 + 1), LEVEL_DEFS[idx].knobs);
  assert.deepEqual(a, b);
  assert.deepEqual(a, h.def, 'hoops.js matches the generator');
  assert.notDeepEqual(candidate(mulberry(h.seed * 7919 + idx * 131 + 2), LEVEL_DEFS[idx].knobs), a);
});

test('determinism: moves, the solver, the bots and the level fingerprint repeat exactly', () => {
  const L = LEVELS[3];
  assert.deepEqual(replay(L, L.solution), replay(L, L.solution));
  const r1 = solve(L), r2 = solve(L);
  assert.deepEqual(r1, r2);
  assert.equal(formatMoves(parseMoves(L.solution)), L.solution);
  assert.equal(randomRate(L, 60, 9, 40), randomRate(L, 60, 9, 40));
  assert.equal(greedyRate(L, 60, 9, 20), greedyRate(L, 60, 9, 20));
  assert.equal(levelSig(L), levelSig(L));
  assert.notEqual(levelSig(L), levelSig(LEVELS[4]));
  const s = replay(L, parseMoves(L.solution).slice(0, 1));
  assert.equal(stateKey(L, s), stateKey(L, JSON.parse(JSON.stringify(s))));
});

// ---------- hints ----------

test('hint: follows the stored solution, finds a way from anywhere else, and spots a dead end', () => {
  const L = LEVELS[4];
  const sol = parseMoves(L.solution);
  let h = hint(L, newState(L));
  assert.deepEqual([h.end, h.to], sol[0]);
  assert.deepEqual(solutionStep(L, newState(L)), sol[0]);
  // off the path: still a legal move that leads somewhere
  const s = newState(L);
  const off = legalMoves(L, s).find(([e, q]) => !(e === sol[0][0] && q === sol[0][1]));
  const t = move(L, s, off[0], off[1]).state;
  h = hint(L, t);
  assert.equal(h.kind, 'move');
  assert.ok(move(L, t, h.end, h.to).ok);
  // every hint followed in turn clears the hoop
  let u = t;
  for (let k = 0; k < 30 && !isDone(u); k++) { const x = hint(L, u); u = move(L, u, x.end, x.to).state; }
  assert.ok(isDone(u));
  assert.equal(hint(L, u).kind, 'none');
  // two stitched-down strands with nowhere to go: no way out
  const D = buildLevel({ id: 'd', name: 'D', n: 6, strands: [{ c: 'm', a: 0, b: 3 }, { c: 'i', a: 1, b: 4 }], fixed: [0, 2] });
  assert.deepEqual(legalMoves(D, newState(D)), []);
  assert.equal(hint(D, newState(D)).kind, 'tangled');
  assert.equal(solve(D).exhausted, true);
});

// ---------- the finishing line ----------

test('what the yarn could make: 14 inches a strand, one flower per 18-inch needle-length', () => {
  const a = yarnLine(3);
  assert.equal(a.inches, 42);
  assert.equal(a.flowers, 2);
  assert.match(a.line, /42 inches/);
  const b = yarnLine(9);
  assert.equal(b.inches, 126);
  assert.equal(b.flowers, 7);
  assert.match(b.line, /3\.5 yards.*2-inch tassel/);
});
