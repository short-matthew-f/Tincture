import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  W, SPOOL, NUDGES, COLORS, BOARD, TOUCH, buildLevel, spline, arcLengths, minRadius, nearDist, newState, pull, whyNot, canPull, legalPulls, isStuck,
  isDone, isUncovered, isPinned, isPegged, showsColor, coveredBy, nudge, canNudge, newGame, play, playNudge, undo, replay, solve, hint,
  solutionStep, acyclic, clearsWithRoom, dependencyCycles, sccs, depths, unitsBalanced, mechanicsOf, randomRate, carefulRate, knitsInto,
  levelSig, groupOf, mulberry, pickStrand, validState, VERSION,
} from '../tangle/rules.js';
import { makeHeap, dealLevel, candidate, ancestors, APART, OVER_MAX, R_MIN } from '../tangle/gen.js';
import { readFileSync } from 'node:fs';
import { LEVELS, LEVEL_DEFS, MECHANICS, BANDS, CHAPTERS, readSave, levelById } from '../tangle/levels.js';
import { HEAPS } from '../tangle/heaps.js';
import { heapsSource, packPoints } from '../tangle/gen-levels.mjs';
import { fitView, clampView, toBoard, toScreen, zoomAt, panBy, pinchView, reachUnits, ZMAX } from '../tangle/view.js';

// Straight strands and simple waves make hand-built heaps easy to reason about.
const H = (y, c, x0 = 10, x1 = 90) => ({ c, p: [x0, y, x1, y] });   // horizontal
const V = (x, c, y0 = 10, y1 = 90) => ({ c, p: [x, y0, x, y1] });   // vertical
// a vertical-ish wave that crosses the line y = 50 three times (at about x = 30, 50, 70)
const WAVE = (c) => ({ c, p: [20, 30, 30, 50, 40, 70, 50, 50, 60, 30, 70, 50, 80, 70] });
const lv = (strands, o = {}) => buildLevel({ id: 't', name: 'T', slots: 5, strands, ...o });
const P = (L, s, i) => { const r = pull(L, s, i); assert.ok(r.ok, `pull ${i}: ${r.reason}`); return r.state; };

// ---------- geometry ----------

test('centripetal splines pass through their control points, are finely sampled and never kink', () => {
  const pts = spline([[10, 10], [40, 30], [70, 10]]);
  assert.deepEqual(pts[0], [10, 10]);
  assert.deepEqual(pts.at(-1), [70, 10]);
  assert.ok(pts.some(([x, y]) => Math.abs(x - 40) < 1e-9 && Math.abs(y - 30) < 1e-9), 'passes through the middle point');
  for (let k = 1; k < pts.length; k++) assert.ok(Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) <= 1.5);
  // every shipped strand bends no tighter than R_MIN
  for (const L of LEVELS) for (let i = 0; i < L.n; i++) assert.ok(minRadius(L.poly[i], L.cum[i]) >= R_MIN * W - 1e-6, `${L.id}: strand ${i} bends too tightly`);
});

// ---------- per-crossing over and under ----------

test('per-crossing blocking: each crossing has its own over/under, and any one lying over a strand holds it', () => {
  // a horizontal and two verticals; by default later strands lie on top
  const L = lv([H(50, 'm'), V(30, 'i'), V(70, 'w')]);
  assert.equal(L.cross.length, 2);
  assert.deepEqual(L.over[0], [1, 2]);
  // turn the crossing with strand 2: now 0 lies over 2 there
  const F = lv([H(50, 'm'), V(30, 'i'), V(70, 'w')], { flips: [[0, 2, 0]] });
  assert.deepEqual(F.over[0], [1], 'only strand 1 lies over 0 now');
  assert.deepEqual(F.over[2], [0], 'and 0 lies over 2');
  let s = newState(F);
  assert.equal(whyNot(F, s, 0).reason, 'covered');
  assert.deepEqual(whyNot(F, s, 0).blockers, [1]);
  assert.equal(whyNot(F, s, 2).reason, 'covered', 'the later strand is held by the earlier one at their turned crossing');
  assert.deepEqual(legalPulls(F, s), [1]);
  s = P(F, s, 1);
  s = P(F, s, 0);
  assert.ok(canPull(F, s, 2));
  // a strand that weaves: over the first neighbor, under the next
  const weave = lv([V(30, 'i'), V(70, 'w'), H(50, 'm')], { flips: [[1, 2, 0]] });
  assert.deepEqual(weave.over[0], [2], 'the horizontal lies over the left one...');
  assert.deepEqual(weave.over[2], [1], '...and under the right one');
  assert.equal(weave.snarls.length, 0);
});

test('crossing the same neighbor several times: each crossing counts, and they are listed in order along the strand', () => {
  const L = lv([H(50, 'm'), WAVE('i')]);
  const xs = L.cross.filter((c) => !c.self);
  assert.equal(xs.length, 3);
  assert.deepEqual(xs.map((c) => c.ord), [0, 1, 2]);
  assert.ok(xs[0].x < xs[1].x && xs[1].x < xs[2].x);
  for (const c of xs) assert.equal(c.over, 1);
});

test('a strand may cross itself (a loop); that never holds it', () => {
  // a loop: right, up and round, back down across itself
  const L = lv([{ c: 'm', p: [10, 50, 40, 50, 55, 40, 50, 25, 35, 25, 30, 40, 45, 55, 60, 70, 90, 70] }]);
  const self = L.cross.filter((c) => c.self);
  assert.equal(self.length, 1);
  assert.equal(self[0].over, 0);
  assert.ok(self[0].ko > self[0].ku, 'by default the later pass lies on top');
  const F = lv([{ c: 'm', p: [10, 50, 40, 50, 55, 40, 50, 25, 35, 25, 30, 40, 45, 55, 60, 70, 90, 70] }], { flips: [[0, 0, 0]] });
  assert.ok(F.cross[0].ko < F.cross[0].ku);
  assert.deepEqual(L.over[0], []);
  assert.ok(canPull(L, newState(L), 0));
});

// ---------- snarls ----------

test('snarls: strands lying over and under each other are detected as one, and only rings are snarls', () => {
  // the wave crosses the line three times; turning the middle crossing interlocks them
  const S = lv([H(50, 'm'), WAVE('i'), V(85, 'w', 20, 90)], { flips: [[0, 1, 1]] });
  assert.deepEqual(S.snarls, [[0, 1]]);
  assert.deepEqual(groupOf(S, 1), [0, 1]);
  assert.deepEqual(dependencyCycles(S), [[0, 1]]);
  assert.ok(acyclic(S), 'with the snarl taken as one, no cycle is left');
  assert.ok(mechanicsOf(S).includes('snarl'));
  // a ring of three: 1 over 0, 2 over 1, 0 over 2
  const R = lv([V(30, 'm'), V(70, 'i'), { c: 'w', p: [10, 30, 90, 70] }], {});
  void R;
  const tri = lv([{ c: 'm', p: [10, 20, 90, 60] }, { c: 'i', p: [10, 60, 90, 20] }, V(50, 'w', 5, 95)]);
  assert.equal(tri.cross.length, 3, 'three strands crossing each other');
  const ring = lv(tri.strands.map((s) => ({ c: s.c, p: s.ctrl.flat() })), { flips: [[0, 2, 0]] });
  assert.deepEqual(ring.snarls, [[0, 1, 2]]);
  assert.ok(mechanicsOf(ring).includes('snarl3'));
  // sccs on its own
  assert.deepEqual(sccs([[1], [2], [0], [4], []]), [[0, 1, 2]]);
  assert.deepEqual(sccs([[1], [], [3], [2]]), [[2, 3]]);
});

test('every basket: the only cycles anywhere are its snarls, each a true ring, and pins and pegs add none', () => {
  for (const L of LEVELS) {
    const h = HEAPS[L.id];
    assert.deepEqual(L.snarls, h.snarls, `${L.id}: the snarls found are the ones generated`);
    assert.deepEqual(dependencyCycles(L), L.snarls, `${L.id}: every cycle (crossings and pins) is exactly a snarl`);
    assert.ok(acyclic(L), `${L.id}: with snarls and knots taken as one, the dependency graph has no cycle`);
    assert.ok(clearsWithRoom(L), `${L.id}: with room on the rack, everything comes out (pegs too)`);
    for (const s of L.snarls) {
      assert.ok(s.length === 2 || s.length === 3, `${L.id}: snarls of two or three`);
      // a true ring: from any member, the "lies over" links inside the snarl reach every other member
      for (const a of s) {
        const seen = new Set([a]), stack = [a];
        while (stack.length) { const x = stack.pop(); for (const y of L.over[x]) if (s.includes(y) && !seen.has(y)) { seen.add(y); stack.push(y); } }
        assert.equal(seen.size, s.length, `${L.id}: snarl ${s} is strongly connected`);
      }
      for (const m of s) assert.ok(!L.knots.flat().includes(m) && L.pinBy[m] < 0 && !L.pegC[m], `${L.id}: snarled strands carry no knot, pin or peg`);
    }
  }
  // and the same holds for fresh deals from the generator (on a shipped heap's geometry)
  const src = HEAPS.deep;
  const heap = { ctrl: src.strands.map((x) => { const c = []; for (let k = 0; k < x.p.length; k += 2) c.push([x.p[k], x.p[k + 1]]); return c; }), knots: [], pegs: [], board: { w: src.board[0], h: src.board[1] } };
  let made = 0;
  for (let seed = 1; seed < 12 && made < 2; seed++) {
    const def = dealLevel(heap, mulberry(seed), { colors: 4, snarl2: 2, snarl3: 1, pins: 1 });
    if (!def) continue;
    made++;
    const L = buildLevel({ id: 'g', name: 'g', slots: 5, ...def });
    assert.deepEqual(dependencyCycles(L), def.snarls);
    assert.equal(def.snarls.length, 3);
    assert.ok(acyclic(L) && clearsWithRoom(L));
  }
  assert.ok(made >= 1, 'the generator makes snarled baskets');
});

test('a snarl comes out together, once nothing outside it lies over it, and needs rack room for all its strands', () => {
  // 0 and 1 snarled; 2 lies over 1 only (a short line across the wave's last rise)
  const L = lv([H(50, 'm'), WAVE('i'), H(62, 'w', 66, 95)], { flips: [[0, 1, 1]] });
  assert.deepEqual(L.snarls, [[0, 1]]);
  assert.ok(L.over[1].includes(2));
  let s = newState(L);
  assert.ok(isUncovered(L, s, 0), 'snarl partners do not hold each other');
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'covered');
  assert.deepEqual(w.blockers, [2]);
  assert.deepEqual(w.group, [0, 1]);
  s = P(L, s, 2);
  const r = pull(L, s, 1);
  assert.ok(r.ok);
  assert.deepEqual(r.group, [0, 1]);
  assert.deepEqual(r.events.map((e) => [e.m, e.c]), [[0, 'm'], [1, 'i']], 'both wind on, in one pull');
  assert.equal(r.state.moves, 2);
  assert.ok(r.state.out[0] && r.state.out[1]);
  // rack room: a full rack with madder on it but no indigo holds the snarl (short strands off to the side)
  const side = (k, c) => H(5 + 7 * k, c, 86, 98);
  const R = lv([side(0, 'g'), side(1, 'w'), side(2, 'c'), side(3, 'n'), side(4, 'm'), H(50, 'm'), WAVE('i'), side(10, 'm'), side(11, 'i'), side(12, 'i'), side(13, 'g'), side(14, 'g'), side(15, 'w'), side(16, 'w'), side(17, 'c'), side(18, 'c'), side(19, 'n'), side(20, 'n')], { flips: [[5, 6, 1]] });
  assert.deepEqual(R.snarls, [[5, 6]]);
  let t = newState(R);
  for (const i of [0, 1, 2, 3, 4]) t = P(R, t, i);
  const blocked = whyNot(R, t, 5);
  assert.equal(blocked.reason, 'rack');
  assert.deepEqual(blocked.colors, ['i']);
  // madder at one: the snarl's madder doesn't complete it, so indigo still has no room
  assert.equal(canPull(R, t, 6), false);
  t = P(R, t, 7); // madder at two: now the snarl's madder completes it, frees the slot, and indigo fits
  const ok = pull(R, t, 6);
  assert.ok(ok.ok, 'madder winds first, completes, and frees the place indigo needs');
  assert.deepEqual(ok.events.map((e) => [e.c, e.popped]), [['m', true], ['i', false]]);
  // the solver treats the snarl as one pull
  const sol = solve(R);
  assert.ok(sol.ok);
  assert.equal(sol.path.length, R.n - 1);
});

// ---------- tucks and pegs ----------

test('tucks: a tip resting under another strand is held by it (drawn as a tuck); a tip on top just rests there', () => {
  // the vertical stops just short of the horizontal's middle
  const T = lv([{ c: 'i', p: [50, 10, 50, 48.9] }, H(50, 'm')]);
  assert.equal(T.cross.length, 1);
  const c = T.cross[0];
  assert.equal(c.under, 0);
  assert.equal(c.tuck, 1, "the vertical's end is tucked");
  assert.equal(T.tucks, 1);
  assert.ok(mechanicsOf(T).includes('tuck'));
  assert.equal(whyNot(T, newState(T), 0).reason, 'covered');
  assert.deepEqual(whyNot(T, newState(T), 0).blockers, [1]);
  // the same tip lying on top: not a tuck, and it holds the other strand
  const R = lv([{ c: 'i', p: [50, 10, 50, 48.9] }, H(50, 'm')], { flips: [[0, 1, 0]] });
  assert.equal(R.cross[0].tuck, -1);
  assert.equal(R.tucks, 0);
  assert.ok(!mechanicsOf(R).includes('tuck'));
  assert.equal(whyNot(R, newState(R), 1).reason, 'covered');
  // a crossing well along the strand is never a tuck
  assert.equal(lv([V(50, 'i'), H(50, 'm')]).tucks, 0);
});

test('pegs: a strand looped round a peg waits for a finished skein of the peg color', () => {
  const L = lv([H(10, 'm'), H(25, 'i'), H(40, 'i'), H(55, 'i'), H(70, 'm'), H(85, 'm')], { pegs: [[0, 'i', 50, 13]] });
  assert.ok(mechanicsOf(L).includes('peg'));
  let s = newState(L);
  assert.ok(isUncovered(L, s, 0) && isPegged(L, s, 0));
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'pegged');
  assert.deepEqual(w.pegs, ['i']);
  s = P(L, s, 1); s = P(L, s, 2);
  assert.equal(whyNot(L, s, 0).reason, 'pegged', 'two indigo wound: not a skein yet');
  s = P(L, s, 3);
  assert.deepEqual(s.skeins, ['i']);
  assert.equal(isPegged(L, s, 0), false, 'the indigo skein is on the shelf: the peg lifts out');
  assert.ok(canPull(L, s, 0));
  assert.ok(clearsWithRoom(L));
  assert.ok(solve(L).ok);
  // a peg waiting on a color that can only finish with the pegged strand itself never lifts
  const stuck = lv([H(10, 'i'), H(25, 'i'), H(40, 'i')], { pegs: [[0, 'i', 50, 13]] });
  assert.equal(clearsWithRoom(stuck), false);
  assert.equal(solve(stuck).ok, false);
});

test('pins: a pinned strand waits for the strand its pin names; pins that make a loop are rejected', () => {
  const L = lv([H(30, 'm'), H(60, 'i'), H(90, 'w')], { pins: [[0, 2]] });
  let s = newState(L);
  assert.equal(isUncovered(L, s, 0), true);
  assert.equal(isPinned(L, s, 0), true);
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'pinned');
  assert.deepEqual(w.pins, [2]);
  s = P(L, s, 2);
  assert.ok(canPull(L, s, 0));
  const loop = lv([H(50, 'm'), V(50, 'i')], { pins: [[1, 0]] });
  assert.equal(acyclic(loop), false);
  assert.deepEqual(dependencyCycles(loop), [[0, 1]], 'a cycle through a pin is not a snarl...');
  assert.deepEqual(loop.snarls, [], '...so it is a broken level');
  assert.equal(solve(loop).ok, false);
});

// ---------- spools, knots, two-color yarn, buried colors ----------

test('spools: a strand winds onto its color, a new color takes the leftmost empty slot, three pop as a skein', () => {
  const L = lv([H(10, 'm'), H(25, 'i'), H(40, 'm'), H(55, 'm'), H(70, 'i'), H(85, 'i')]);
  let s = newState(L);
  let r = pull(L, s, 0);
  assert.deepEqual(r.events, [{ m: 0, c: 'm', slot: 0, n: 1, fresh: true, popped: false }]);
  s = r.state;
  s = P(L, s, 1);
  assert.deepEqual(s.rack.slice(0, 2), [{ c: 'm', n: 1 }, { c: 'i', n: 1 }]);
  s = P(L, s, 2);
  r = pull(L, s, 3);
  assert.deepEqual(r.events, [{ m: 3, c: 'm', slot: 0, n: 3, fresh: false, popped: true }]);
  s = r.state;
  assert.equal(s.rack[0], null);
  assert.deepEqual(s.skeins, ['m']);
  s = P(L, s, 4); s = P(L, s, 5);
  assert.ok(isDone(s));
  assert.deepEqual(s.skeins, ['m', 'i']);
  // a full rack: only colors already on it can come out
  const F = lv(['m', 'i', 'w', 'g', 'c', 'n', 'm', 'm'].map((c, k) => H(8 + k * 10, c)));
  let t = newState(F);
  for (const i of [0, 1, 2, 3, 4]) t = P(F, t, i);
  assert.equal(whyNot(F, t, 5).reason, 'rack');
  t = P(F, t, 6); t = P(F, t, 7);
  assert.ok(canPull(F, t, 5), 'madder completed and freed a slot');
});

test('knots, two-color yarn and buried colors', () => {
  const K = lv([{ c: 'm', p: [10, 50, 50, 50] }, { c: 'i', p: [50, 50, 90, 50] }, V(70, 'w'), V(20, 'g', 60, 90)], { knots: [[0, 1]] });
  assert.ok(!K.over[0].includes(1), 'knot partners never block each other');
  assert.deepEqual(groupOf(K, 1), [0, 1]);
  assert.equal(whyNot(K, newState(K), 0).reason, 'covered');
  const r = pull(K, P(K, newState(K), 2), 1);
  assert.ok(r.ok);
  assert.deepEqual(r.events.map((e) => e.c), ['m', 'i']);
  const V2 = lv([{ c: 'm', c2: 'i', p: [10, 20, 90, 20] }, H(40, 'm'), H(55, 'm'), H(70, 'i'), H(85, 'i')]);
  assert.deepEqual(V2.units, { m: 3, i: 3 });
  assert.deepEqual(pull(V2, newState(V2), 0).events.map((e) => [e.c, e.slot]), [['m', 0], ['i', 1]]);
  const B = lv([{ ...H(50, 'm'), q: 1 }, V(50, 'i')]);
  let s = newState(B);
  assert.equal(showsColor(B, s, 0), false);
  s = P(B, s, 1);
  assert.equal(showsColor(B, s, 0), true);
  assert.ok(mechanicsOf(B).includes('buried'));
});

// ---------- undo, stuck, the nudge ----------

test('undo round trip, stuck detection and the one spare slot', () => {
  const L = LEVELS.find((x) => x.id === 'joins');
  let g = newGame(L);
  const states = [g.state];
  const moves = L.solution.split(' ').map(Number).slice(0, 8);
  for (const m of moves) { const r = play(L, g, m); assert.ok(r.ok); g = r.game; states.push(g.state); }
  assert.deepEqual(g.state, replay(L, moves));
  for (let k = moves.length - 1; k >= 0; k--) { g = undo(g); assert.deepEqual(g.state, states[k]); }
  // two slots, weld verticals over the last madder and indigo
  const S = lv([H(10, 'm'), H(20, 'i'), H(30, 'w'), H(60, 'm'), H(70, 'm'), H(80, 'i'), V(50, 'w', 50, 100), H(90, 'i'), V(80, 'w', 50, 100)], { slots: 2 });
  let h = play(S, newGame(S), 0).game;
  h = play(S, h, 1).game;
  assert.ok(isStuck(S, h.state));
  const h2 = playNudge(h);
  assert.equal(h2.state.rack.length, 3);
  assert.equal(canNudge(h2.state), false);
  assert.equal(nudge(h2.state), h2.state);
  assert.equal(NUDGES, 1);
  assert.ok(isDone(replay(S, [2, 8, 7, 6, 3, 4, 5], h2.state)));
  assert.deepEqual(undo(h2).state, h.state);
});

test('solver: finds an order, proves a dead end, and hints follow the stored solution', () => {
  const D = lv([H(50, 'm'), V(30, 'i'), V(50, 'i'), V(70, 'i'), H(20, 'm', 80, 95), H(80, 'm', 80, 95)], { slots: 1 });
  assert.ok(solve(D).ok);
  const t = P(D, newState(D), 4);
  const dead = solve(D, t);
  assert.equal(dead.ok, false);
  assert.equal(dead.exhausted, true);
  assert.equal(hint(D, t).kind, 'tangled');
  const Lv = LEVELS[3];
  const first = Number(Lv.solution.split(' ')[0]);
  assert.equal(solutionStep(Lv, newState(Lv), Lv.solution), first);
  assert.deepEqual(hint(Lv, newState(Lv)), { kind: 'pull', strand: first });
});

// ---------- the levels ----------

test('the baskets: generated, balanced, one new thing at a time, deep ones late', () => {
  assert.ok(LEVELS.length >= 100 && LEVELS.length <= 110, `${LEVELS.length} baskets`);
  assert.equal(LEVEL_DEFS.length, LEVELS.length);
  assert.equal(new Set(LEVELS.map((L) => L.id)).size, LEVELS.length);
  for (const L of LEVELS) {
    assert.ok(unitsBalanced(L), `${L.id}: every color fills whole spools`);
    for (const s of L.strands) assert.ok(COLORS[s.c] && (!s.c2 || COLORS[s.c2]));
    for (const m of L.mechanics) assert.ok(MECHANICS[m], `${L.id}: ${m} has an intro line`);
    assert.ok(L.slots === 3 || L.slots === 4 || L.slots === 5);
    assert.deepEqual(mechanicsOf(L), HEAPS[L.id].mech, `${L.id}: the stored mechanics are the ones it has`);
    assert.ok(Math.abs(L.board.h / L.board.w - BOARD.h / BOARD.w) < 0.01, `${L.id}: the board keeps its shape`);
  }
  const firstAt = {};
  LEVELS.forEach((L, i) => { for (const m of L.mechanics) if (!(m in firstAt)) firstAt[m] = i; });
  assert.deepEqual(Object.keys(firstAt).sort(), Object.keys(MECHANICS).sort(), 'every mechanic is used');
  const intros = Object.values(firstAt).sort((a, b) => a - b);
  for (let i = 1; i < intros.length; i++) assert.ok(intros[i] > intros[i - 1], 'never two new things in one basket');
  for (const L of LEVELS.slice(0, 3)) assert.equal(L.mechanics.length, 0, `${L.id} teaches the basics only`);
  for (const L of LEVELS.slice(0, 5)) assert.equal(L.snarls.length + L.tucks + L.pegs.length, 0, `${L.id} is gentle`);
  assert.ok(firstAt.snarl < firstAt.snarl3, '2-strand snarls come before 3-strand ones');
  const late = LEVELS.slice(-8);
  assert.ok(late.every((L) => L.n >= 36), 'the late baskets are big');
  assert.ok(LEVELS.at(-1).n >= 55 && LEVELS.at(-1).n <= 60);
  assert.ok(late.every((L) => L.stats.depth >= 5), 'with strands 5 or more layers down');
  assert.equal(BANDS[0].from, 0);
  for (const b of BANDS) assert.ok(LEVELS[b.from], b.name);
  // chapters of about ten, each named for a fiber
  CHAPTERS.forEach((c, k) => {
    const to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    assert.ok(to - c.from >= 9 && to - c.from <= 11, `${c.name}: ${to - c.from} baskets`);
  });
  // the first 29 are the baskets the playtest knew
  assert.deepEqual(LEVELS.slice(0, 29).map((L) => L.id), ['first', 'scraps', 'leftovers', 'plan', 'cat', 'joins', 'magic', 'pinned', 'blocking', 'snarl', 'stripes', 'festival', 'bottom',
    'thrift', 'attic', 'deep', 'small', 'swap', 'destash', 'tucked', 'pegboard', 'ring', 'studio', 'guild', 'stash', 'felted', 'moths', 'nest', 'everything']);
  // each chapter after the first three climbs, after a small reset
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let k = 3; k < CHAPTERS.length; k++) {
    const c = CHAPTERS[k], to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    const r = LEVELS.slice(c.from, to).map((L) => L.stats.random);
    assert.ok(avg(r.slice(0, 5)) > avg(r.slice(5)), `${c.name} climbs`);
    assert.ok(LEVELS[c.from].stats.random > LEVELS[c.from - 1].stats.random, `${c.name} starts with a small reset`);
  }
});

test('heaps.js is exactly what the generator writes from its own decoded data: the packing is lossless and every stored signature is the geometry\'s hash', () => {
  const entries = LEVEL_DEFS.filter((d) => HEAPS[d.id]).map((d) => ({ id: d.id, ...HEAPS[d.id] }));
  assert.equal(heapsSource(entries), readFileSync(new URL('../tangle/heaps.js', import.meta.url), 'utf8'));
  for (const L of LEVELS) assert.equal(levelSig(L), HEAPS[L.id].sig, `${L.id}: signature`);
  // packing round-trips any tenths, and refuses what it cannot hold
  const pts = [12.3, 45.6, 19.3, 40.6, 19.3, 40.6, 2.1, 59.9];
  const S = HEAPS.first.strands[0];
  assert.ok(S.p.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9));
  assert.ok(packPoints(pts).length === 4 + 3 * 3);
  assert.throws(() => packPoints([1.25, 2]));
  assert.throws(() => packPoints([1, 2, 40, 2]));
});

test('every basket: the stored solution replays to a clear board with no spare slot, and the solver proves it within its cap', () => {
  for (const L of LEVELS) {
    const moves = L.solution.split(' ').map(Number);
    let s = newState(L);
    for (const m of moves) { const r = pull(L, s, m); assert.ok(r.ok, `${L.id}: pull ${m} (${r.reason})`); s = r.state; }
    assert.ok(isDone(s), `${L.id} clears`);
    assert.equal(s.extra, 0);
    assert.ok(s.rack.every((x) => x === null), `${L.id}: every spool popped`);
    assert.equal(moves.length, L.stats.pulls);
    const groups = new Set(L.group.map((g) => g[0])).size;
    assert.equal(moves.length, groups, `${L.id}: one pull per strand, knotted pair or snarl`);
    const sol = solve(L, undefined, { cap: 300000 });
    assert.ok(sol.ok, `${L.id}: proved within the node cap`);
    assert.equal(sol.nodes, L.stats.nodes);
  }
});

test('every basket agrees with what she sees: strands clearly lie on each other or clearly keep apart', () => {
  for (const L of LEVELS) {
    for (const c of L.cross) {
      const p = L.poly[c.a][c.ka], q = L.poly[c.b][c.kb];
      assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < OVER_MAX * W + 0.05, `${L.id}: crossing ${c.id} overlaps clearly`);
    }
    // no near-miss slivers: wherever two strands come within APART, they cross there
    for (let i = 0; i < L.n; i++) {
      for (let k = 0; k < L.poly[i].length; k += 2) {
        for (let j = 0; j < L.n; j++) {
          if (j === i || L.partner[i] === j) continue;
          const b = L.boxes[j], p = L.poly[i][k];
          if (p[0] < b[0] - 7 || p[0] > b[2] + 7 || p[1] < b[1] - 7 || p[1] > b[3] + 7) continue;
          const d = nearDist(p, L.poly[j], L.grids[j]);
          if (d < APART * W - 0.2 && d >= TOUCH * W + 0.2) {
            // only on the way into or out of a place where they clearly lie on each other
            let deep = false;
            for (const dir of [-1, 1]) {
              for (let q = k; q >= 0 && q < L.poly[i].length && !deep; q += dir) {
                const e = nearDist(L.poly[i][q], L.poly[j], L.grids[j]);
                if (e >= APART * W) break;
                if (e < OVER_MAX * W) deep = true;
              }
            }
            assert.ok(deep, `${L.id}: strand ${i} sample ${k} passes ${(d / W).toFixed(2)} W from strand ${j} without lying on it`);
          }
        }
      }
    }
  }
});

test('every pin and knot matters: she meets each one along the stored solution', () => {
  for (const L of LEVELS) {
    const above = ancestors(L);
    for (const [p, by] of L.pins) assert.ok(!above[p].has(by), `${L.id}: the pin on ${p} adds something`);
    if (!L.pins.length && !L.knots.length && !L.pegs.length) continue;
    let s = newState(L);
    const pinFelt = new Set(), knotFelt = new Set(), pegFelt = new Set();
    for (const m of L.solution.split(' ').map(Number)) {
      for (const [p] of L.pins) if (whyNot(L, s, p)?.reason === 'pinned') pinFelt.add(p);
      for (const [p] of L.pegs) if (whyNot(L, s, p)?.reason === 'pegged') pegFelt.add(p);
      for (const [a, b] of L.knots) if (!s.out[a] && isUncovered(L, s, a) !== isUncovered(L, s, b)) knotFelt.add(a);
      s = pull(L, s, m).state;
    }
    if (L.pins.length) assert.ok(pinFelt.size >= 1, `${L.id}: a pin holds an uncovered strand at some point`);
    if (L.knots.length) assert.ok(knotFelt.size >= 1, `${L.id}: a knot holds back a free strand at some point`);
    if (L.pegs.length) assert.ok(pegFelt.size >= 1, `${L.id}: a peg holds an uncovered strand at some point`);
  }
});

test('difficulty: early baskets are gentle, later ones need planning, and buried colors never turn it into luck', () => {
  const r = LEVELS.map((L) => L.stats.random);
  for (const x of r.slice(0, 3)) assert.equal(x, 1);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(r.slice(0, 7)) > avg(r.slice(7, 16)) && avg(r.slice(7, 16)) > avg(r.slice(16)), 'clear rates fall band by band');
  assert.ok(r.slice(-4).every((x) => x <= 0.12), 'the gnarly ones: few random orders clear');
  for (const L of LEVELS) if (L.strands.some((s) => s.q)) assert.ok(L.stats.careful - L.stats.blind <= 0.1, `${L.id}: buried colors never turn it into luck`);
  const deep = LEVELS.find((L) => L.id === 'deep');
  assert.equal(Math.max(...depths(deep)), deep.stats.depth);
});

// ---------- tapping at any zoom ----------

test('hit testing is the same at every zoom and pan (pure): a screen point maps to the board point under it', () => {
  const L = LEVELS.find((x) => x.id === 'deep');
  const fit = { w: 348, h: 487, s: 348 / L.board.w };
  const s = newState(L);
  const views = [fitView(), zoomAt(fit, L.board, fitView(), 2, 100, 200), zoomAt(fit, L.board, fitView(), ZMAX, 300, 80), panBy(fit, L.board, zoomAt(fit, L.board, fitView(), 2.5, 174, 240), -60, 40)];
  let checked = 0;
  for (let i = 0; i < L.n; i++) {
    for (const p of [L.poly[i][Math.floor(L.poly[i].length / 3)], L.poly[i][Math.floor(L.poly[i].length / 2)]]) {
      for (const v of views) {
        const [sx, sy] = toScreen(fit, v, p[0], p[1]);
        if (sx < 0 || sy < 0 || sx > fit.w || sy > fit.h) continue;
        const b = toBoard(fit, v, sx, sy);
        assert.ok(Math.hypot(b[0] - p[0], b[1] - p[1]) < 1e-9, 'screen and board round-trip');
        // what is picked depends only on the board point and the finger's reach there
        const r = reachUnits(fit, v, W);
        assert.equal(pickStrand(L, s, b, r), pickStrand(L, s, p, r));
        // a strand that can come out is picked by a tap on it at any zoom
        if (canPull(L, s, i)) { assert.equal(pickStrand(L, s, b, r), i, `pullable strand ${i} at zoom ${v.z.toFixed(2)}`); checked++; }
      }
    }
  }
  assert.ok(checked >= 8);
  // zoomed right in, a tap on any strand's open stretch picks that strand
  const close = zoomAt(fit, L.board, fitView(), ZMAX, 174, 240);
  for (let i = 0; i < L.n; i++) {
    const k = L.poly[i].findIndex((p, q) => q % 3 === 0 && L.poly.every((o, j) => j === i || nearDist(p, o, L.grids[j]) > 2 * W));
    if (k < 0) continue;
    assert.equal(pickStrand(L, s, L.poly[i][k], reachUnits(fit, close, W)), i, `strand ${i}, zoomed in`);
  }
  // the finger's reach is fixed on screen, so it shrinks on the board as she zooms in
  assert.ok(reachUnits(fit, { z: 3, x: 0, y: 0 }, W) < reachUnits(fit, fitView(), W));
  // a pinch keeps the board point between the fingers under them, and views stay on the board
  const v0 = fitView();
  const v1 = pinchView(fit, L.board, v0, [100, 200], [200, 200], [80, 200], [220, 200]);
  assert.ok(Math.abs(v1.z - 1.4) < 1e-9);
  const m0 = toBoard(fit, v0, 150, 200), m1 = toBoard(fit, v1, 150, 200);
  assert.ok(Math.hypot(m0[0] - m1[0], m0[1] - m1[1]) < 1e-9);
  const c = clampView(fit, L.board, { z: 9, x: -50, y: 1e4 });
  assert.equal(c.z, ZMAX);
  assert.equal(c.x, 0);
  assert.ok(Math.abs(c.y - (L.board.h - L.board.h / ZMAX)) < 1e-9);
  // an empty spot picks nothing
  assert.equal(pickStrand(lv([H(50, 'm')]), newState(lv([H(50, 'm')])), [50, 120], 4), -1);
});

// ---------- the save ----------

test('save compatibility: old progress carries over; a basket that changed starts fresh, cleanly', () => {
  const L = LEVELS.find((x) => x.id === 'cat');
  // a save from the previous version: ticks, settings, seen cards, and a game on a basket whose geometry changed
  const old = { v: 1, cur: 'cat', done: { first: true, scraps: true, gone: true }, glyphs: true, sound: false, seenHow: true, seenIntro: { rack: true, knot: 1, nonsense: true },
    game: { level: 'cat', sig: 'oldsig', state: { v: 1, level: 'cat', out: Array(21).fill(0).map((_, k) => (k < 3 ? 1 : 0)), rack: [{ c: 'n', n: 1 }, null, null, null, null], skeins: [], extra: 0, moves: 3 }, past: [] } };
  const r = readSave(old);
  assert.deepEqual(r.data.done, { first: true, scraps: true }, 'ticks kept for baskets that still exist');
  assert.equal(r.data.cur, 'cat');
  assert.equal(r.data.glyphs, true);
  assert.deepEqual(r.data.seenIntro, { rack: true, knot: true });
  assert.equal(r.data.game, null, 'the old game is set aside');
  assert.equal(r.reset, 'cat', 'and the page can say the basket was rewound');
  // a current game is kept exactly
  let s = newState(L);
  const m = L.solution.split(' ').map(Number);
  s = pull(L, s, m[0]).state;
  const cur = readSave({ v: 1, cur: 'cat', done: {}, game: { level: 'cat', sig: L.sig, state: s, past: [newState(L)] } });
  assert.deepEqual(cur.data.game.state, s);
  assert.equal(cur.reset, null);
  // a forged state is refused
  const bad = { ...s, out: s.out.map(() => 1) };
  assert.equal(validState(L, bad), false);
  assert.equal(readSave({ v: 1, game: { level: 'cat', sig: L.sig, state: bad, past: [] } }).data.game, null);
  // nothing usable: defaults
  for (const junk of [null, 'x', { v: 2 }, { v: 1, cur: 42, done: 'yes' }]) {
    const d = readSave(junk).data;
    assert.equal(d.cur, LEVELS[0].id);
    assert.deepEqual(d.done, {});
  }
  assert.equal(VERSION, 1);
  assert.ok(levelById('first'));
});

// ---------- determinism ----------

test('determinism: the same seed gives the same heap, deal, crossings, rates and solution', () => {
  const knobs = { n: 6, len: [55, 75], loop: 0.5, colors: 2, slots: 5, knots: 1, pins: 1, tries: 30 };
  let seed = 1, a = null;
  while (!(a = candidate(knobs, seed, 1)) && seed < 40) seed++;
  const b = candidate(knobs, seed, 1);
  assert.ok(a, 'some seed makes a basket');
  assert.deepEqual(a, b);
  const hk = { n: 4, len: [60, 90], loop: 0.8, tries: 25 };
  const h1 = makeHeap(mulberry(77), hk), h2 = makeHeap(mulberry(77), hk);
  assert.ok(h1);
  assert.deepEqual(h1, h2);
  assert.deepEqual(dealLevel(h1, mulberry(5), { colors: 2 }), dealLevel(h2, mulberry(5), { colors: 2 }));
  const L = LEVELS.find((x) => x.id === 'snarl');
  assert.equal(randomRate(L, 9, 30), randomRate(L, 9, 30));
  assert.equal(carefulRate(L, 9, 20), carefulRate(L, 9, 20));
  assert.deepEqual(solve(L).path, solve(L).path);
  const h = HEAPS[L.id];
  const again = buildLevel({ id: L.id, name: L.name, slots: h.slots, board: h.board, strands: h.strands, knots: h.knots, pins: h.pins, pegs: h.pegs, flips: h.flips });
  assert.deepEqual(again.cross, L.cross);
  assert.deepEqual(again.over, L.over);
  assert.equal(levelSig(again), L.sig);
  assert.notEqual(levelSig(LEVELS[0]), levelSig(LEVELS[1]));
  // the stored stats were measured with the generator's seeds
  assert.ok(Math.abs(randomRate(LEVELS[3], 4242, 400) - LEVELS[3].stats.random) < 0.001);
});

// ---------- what it knits up into ----------

test('the finished shelf: yardage and a sensible project', () => {
  assert.deepEqual(knitsInto(['m', 'i']), { skeins: 2, yards: 200, what: 'a hat or a pair of mittens', line: 'Enough for a hat or a pair of mittens.' });
  assert.match(knitsInto(Array(5).fill('m')).what, /scarf/);
  assert.match(knitsInto(Array(20).fill('m')).what, /throw/);
  for (const L of LEVELS) {
    const k = knitsInto(replay(L, L.solution).skeins);
    assert.ok(k.yards >= 200 && k.yards <= 2200, `${L.id}: ${k.yards} yards`);
  }
});
