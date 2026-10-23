import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  W, SPOOL, NUDGES, COLORS, buildLevel, spline, minDist, newState, pull, whyNot, canPull, legalPulls, isStuck, isDone,
  isUncovered, isPinned, showsColor, coveredBy, nudge, canNudge, newGame, play, playNudge, undo, replay, solve, hint,
  solutionStep, acyclic, unitsBalanced, mechanicsOf, randomRate, carefulRate, knitsInto, levelSig, groupOf, mulberry,
} from '../tangle/rules.js';
import { makeHeap, dealLevel, candidate, ancestors, VIS_MIN } from '../tangle/gen.js';
import { LEVELS, LEVEL_DEFS, MECHANICS, BANDS } from '../tangle/levels.js';
import { HEAPS } from '../tangle/heaps.js';

// Straight strands make hand-built heaps easy to reason about.
const H = (y, c, x0 = 10, x1 = 90) => ({ c, p: [x0, y, x1, y] });   // horizontal
const V = (x, c, y0 = 10, y1 = 90) => ({ c, p: [x, y0, x, y1] });   // vertical
const lv = (strands, o = {}) => buildLevel({ id: 't', name: 'T', slots: 5, strands, ...o });
const P = (L, s, i) => { const r = pull(L, s, i); assert.ok(r.ok, `pull ${i}: ${r.reason}`); return r.state; };

// ---------- geometry and over/under ----------

test('splines pass through their control points and are finely sampled', () => {
  const pts = spline([[10, 10], [40, 30], [70, 10]]);
  assert.deepEqual(pts[0], [10, 10]);
  assert.deepEqual(pts.at(-1), [70, 10]);
  assert.ok(pts.some(([x, y]) => Math.abs(x - 40) < 1e-9 && Math.abs(y - 30) < 1e-9), 'passes through the middle point');
  for (let k = 1; k < pts.length; k++) assert.ok(Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) <= 1.5);
});

test('over/under: a later strand lies over an earlier one wherever their bodies touch', () => {
  const L = lv([H(50, 'm'), V(50, 'i'), H(80, 'w', 60, 90), V(20, 'g', 60, 100)]);
  assert.deepEqual(L.over[0], [1], 'the vertical lies over the first horizontal');
  assert.deepEqual(L.under[1], [0]);
  assert.deepEqual(L.over[1], [], 'nothing lies over the vertical: the short horizontal starts 10 units to its right');
  assert.ok(minDist(L.poly[1], L.poly[2], L.grids[2]) > W);
  assert.deepEqual(L.over[2], []);
  assert.deepEqual(L.over[3], []);
});

test('over/under: crossing, touching and clear pairs', () => {
  const L = lv([H(50, 'm'), V(50, 'i'), H(50 + W * 0.5, 'w', 70, 95), H(50 + W * 2, 'g', 70, 95)]);
  assert.ok(L.over[0].includes(1), 'a crossing');
  assert.ok(L.over[0].includes(2), 'running alongside, closer than W: touching');
  assert.ok(!L.over[0].includes(3), 'two widths apart: clear');
  assert.ok(L.spots.some((s) => s.u === 1 && s.l === 0), 'a contact shadow where 1 crosses 0');
  const sp = L.spots.find((s) => s.u === 1 && s.l === 0);
  assert.ok(Math.abs(sp.x - 50) < 1.5 && Math.abs(sp.y - 50) < 1.5, 'the shadow sits on the crossing');
});

test('pullability: only an uncovered strand comes out; pulling the top uncovers the one below', () => {
  const L = lv([H(50, 'm'), V(50, 'i'), V(30, 'w')]);
  let s = newState(L);
  assert.deepEqual(coveredBy(L, s, 0), [1, 2]);
  assert.equal(isUncovered(L, s, 0), false);
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'covered');
  assert.deepEqual(w.blockers.sort(), [1, 2]);
  assert.deepEqual(legalPulls(L, s), [1, 2]);
  s = P(L, s, 1);
  assert.deepEqual(coveredBy(L, s, 0), [2]);
  assert.equal(canPull(L, s, 0), false);
  s = P(L, s, 2);
  assert.equal(canPull(L, s, 0), true);
  assert.equal(whyNot(L, s, 1).reason, 'gone');
  assert.equal(pull(L, s, 1).ok, false);
});

// ---------- spools ----------

test('spools: a strand winds onto its color, a new color takes the leftmost empty slot, three pop as a skein', () => {
  const L = lv([H(10, 'm'), H(25, 'i'), H(40, 'm'), H(55, 'm'), H(70, 'i'), H(85, 'i')]);
  let s = newState(L);
  let r = pull(L, s, 0);
  assert.deepEqual(r.events, [{ m: 0, c: 'm', slot: 0, n: 1, fresh: true, popped: false }]);
  s = r.state;
  s = P(L, s, 1);
  assert.deepEqual(s.rack.slice(0, 2), [{ c: 'm', n: 1 }, { c: 'i', n: 1 }]);
  s = P(L, s, 2);
  assert.deepEqual(s.rack[0], { c: 'm', n: 2 });
  r = pull(L, s, 3);
  assert.deepEqual(r.events, [{ m: 3, c: 'm', slot: 0, n: 3, fresh: false, popped: true }]);
  s = r.state;
  assert.equal(s.rack[0], null, 'the full spool popped off and freed its slot');
  assert.deepEqual(s.skeins, ['m']);
  s = P(L, s, 4);
  assert.deepEqual(s.rack[1], { c: 'i', n: 2 }, 'indigo kept its own spool');
  s = P(L, s, 5);
  assert.ok(isDone(s));
  assert.deepEqual(s.skeins, ['m', 'i']);
  assert.ok(s.rack.every((x) => x === null));
  assert.equal(s.moves, 6);
});

test('a full rack: only colors already on it can come out', () => {
  const strands = ['m', 'i', 'w', 'g', 'c', 'n', 'm', 'm'].map((c, k) => H(8 + k * 10, c));
  const L = lv(strands, { slots: 5 });
  let s = newState(L);
  for (const i of [0, 1, 2, 3, 4]) s = P(L, s, i);
  assert.ok(s.rack.every(Boolean));
  const w = whyNot(L, s, 5);
  assert.equal(w.reason, 'rack');
  assert.deepEqual(w.colors, ['n']);
  assert.equal(canPull(L, s, 6), true, 'madder is on the rack');
  s = P(L, s, 6);
  s = P(L, s, 7); // madder completes and frees a slot
  assert.equal(canPull(L, s, 5), true, 'now walnut fits');
  assert.equal(s.rack.findIndex((x) => !x), 0);
});

// ---------- mechanics ----------

test('knots: two strands tied end to end come out together, and both must be free', () => {
  // 0 ends where 1 starts; 2 lies over 1 only
  const L = lv([{ c: 'm', p: [10, 50, 50, 50] }, { c: 'i', p: [50, 50, 90, 50] }, V(70, 'w'), V(20, 'g', 60, 90)], { knots: [[0, 1]] });
  assert.equal(L.partner[0], 1);
  assert.ok(!L.over[0].includes(1), 'knot partners never block each other');
  assert.deepEqual(groupOf(L, 1), [0, 1]);
  let s = newState(L);
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'covered', 'the partner is covered, so the pair waits');
  assert.deepEqual(w.blockers, [2]);
  assert.deepEqual(legalPulls(L, s), [2, 3], 'a pair is listed once, by its lower index');
  s = P(L, s, 2);
  const r = pull(L, s, 1);
  assert.ok(r.ok);
  assert.deepEqual(r.group, [0, 1]);
  assert.deepEqual(r.events.map((e) => e.c), ['m', 'i'], 'both lengths wind on');
  assert.ok(r.state.out[0] && r.state.out[1]);
  assert.equal(r.state.moves, 2, 'one pull');
  assert.ok(mechanicsOf(L).includes('knot'));
});

test('pins: a pinned strand waits for the strand its pin names; pins that make a loop are rejected', () => {
  const L = lv([H(30, 'm'), H(60, 'i'), H(90, 'w')], { pins: [[0, 2]] });
  assert.ok(L.pinAt[0] >= 0);
  let s = newState(L);
  assert.equal(isUncovered(L, s, 0), true);
  assert.equal(isPinned(L, s, 0), true);
  const w = whyNot(L, s, 0);
  assert.equal(w.reason, 'pinned');
  assert.deepEqual(w.pins, [2]);
  s = P(L, s, 2);
  assert.equal(isPinned(L, s, 0), false);
  assert.ok(canPull(L, s, 0));
  // a loop: 0 pinned by 1, while 1 lies under... 1 lies over 0 and 0 pins 1? Build: 1 over 0, and 1 pinned by 0
  const loop = lv([H(50, 'm'), V(50, 'i')], { pins: [[1, 0]] });
  assert.equal(acyclic(loop), false);
  assert.equal(solve(loop).ok, false);
  assert.ok(mechanicsOf(L).includes('pin'));
});

test('two-color yarn: one length to each color, and it needs room for both', () => {
  const L = lv([{ c: 'm', c2: 'i', p: [10, 20, 90, 20] }, H(40, 'm'), H(55, 'm'), H(70, 'i'), H(85, 'i')], { slots: 5 });
  assert.ok(unitsBalanced(L));
  assert.deepEqual(L.units, { m: 3, i: 3 });
  let s = newState(L);
  const r = pull(L, s, 0);
  assert.deepEqual(r.events.map((e) => [e.c, e.slot, e.n]), [['m', 0, 1], ['i', 1, 1]]);
  s = r.state;
  for (const i of [1, 2, 3, 4]) s = P(L, s, i);
  assert.ok(isDone(s));
  assert.deepEqual(s.skeins.sort(), ['i', 'm']);
  // room: a full rack with madder on it, no indigo: blocked; once madder can complete first, a slot opens
  const L2 = lv([H(10, 'g'), H(20, 'w'), H(30, 'c'), H(40, 'n'), H(50, 'm'), H(60, 'm'), { c: 'm', c2: 'i', p: [10, 72, 90, 72] }, H(82, 'i'), H(92, 'i')], { slots: 5 });
  let t = newState(L2);
  for (const i of [0, 1, 2, 3, 4]) t = P(L2, t, i);
  const blocked = whyNot(L2, t, 6);
  assert.equal(blocked.reason, 'rack');
  assert.deepEqual(blocked.colors, ['i']);
  t = P(L2, t, 5); // madder at 2 of 3
  const r2 = pull(L2, t, 6);
  assert.ok(r2.ok, 'madder winds first, completes, and frees the slot indigo needs');
  assert.deepEqual(r2.events.map((e) => [e.c, e.popped]), [['m', true], ['i', false]]);
  assert.ok(mechanicsOf(L).includes('variegated'));
});

test('buried colors: gray while covered, colored once uncovered; the rules ignore it', () => {
  const plain = lv([H(50, 'm'), V(50, 'i')]);
  const L = lv([{ ...H(50, 'm'), q: 1 }, V(50, 'i')]);
  let s = newState(L);
  assert.equal(showsColor(L, s, 0), false);
  assert.equal(showsColor(L, s, 1), true);
  assert.deepEqual(legalPulls(L, s), legalPulls(plain, newState(plain)));
  s = P(L, s, 1);
  assert.equal(showsColor(L, s, 0), true);
  assert.ok(mechanicsOf(L).includes('buried'));
  assert.ok(mechanicsOf(lv([H(50, 'm')], { slots: 4 })).includes('rack4'));
});

// ---------- undo, stuck, the nudge ----------

test('undo: a round trip restores every state exactly, and replay agrees', () => {
  const L = LEVELS.find((x) => x.id === 'joins');
  let g = newGame(L);
  const states = [g.state];
  const moves = L.solution.split(' ').map(Number).slice(0, 8);
  for (const m of moves) { const r = play(L, g, m); assert.ok(r.ok); g = r.game; states.push(g.state); }
  assert.deepEqual(g.state, replay(L, moves));
  for (let k = moves.length - 1; k >= 0; k--) { g = undo(g); assert.deepEqual(g.state, states[k]); }
  assert.equal(g.past.length, 0);
  assert.equal(undo(g), g, 'nothing more to undo');
  const bad = play(L, g, L.over.findIndex((o) => o.length > 0));
  assert.equal(bad.ok, false, 'a covered strand does not change the game');
  assert.equal(bad.game, g);
});

test('stuck: a full rack with nothing that matches; one spare slot, then only Undo or Start over', () => {
  // two slots. Weld verticals lie over the last madder and indigo strands.
  const L = lv([H(10, 'm'), H(20, 'i'), H(30, 'w'), H(60, 'm'), H(70, 'm'), H(80, 'i'), V(50, 'w', 50, 100), H(90, 'i'), V(80, 'w', 50, 100)], { slots: 2 });
  assert.ok(unitsBalanced(L));
  let g = newGame(L);
  g = play(L, g, 0).game;
  g = play(L, g, 1).game;
  const s = g.state;
  assert.deepEqual(s.rack, [{ c: 'm', n: 1 }, { c: 'i', n: 1 }]);
  assert.deepEqual(legalPulls(L, s), []);
  assert.equal(whyNot(L, s, 2).reason, 'rack');
  assert.equal(whyNot(L, s, 3).reason, 'covered');
  assert.ok(isStuck(L, s));
  assert.ok(canNudge(s));
  const g2 = playNudge(g);
  const t = g2.state;
  assert.equal(t.rack.length, 3);
  assert.equal(t.extra, 1);
  assert.deepEqual(legalPulls(L, t), [2, 8], 'the spare slot lets weld out (indigo 7 still lies over weld 6)');
  assert.equal(canNudge(t), false);
  assert.equal(nudge(t), t, 'only one spare slot per basket');
  assert.equal(NUDGES, 1);
  const end = replay(L, [2, 8, 7, 6, 3, 4, 5], t);
  assert.ok(isDone(end));
  assert.deepEqual(end.skeins, ['w', 'm', 'i']);
  assert.deepEqual(undo(g2).state, s, 'the spare slot can be undone');
});

test('stuck detection on a real basket, and the nudge through the game history', () => {
  const L = LEVELS.find((x) => x.id === 'small');
  // a random player who gets stuck
  let found = null;
  for (let seed = 1; seed < 400 && !found; seed++) {
    const rng = mulberry(seed);
    let s = newState(L);
    const moves = [];
    for (;;) { const ms = legalPulls(L, s); if (!ms.length) break; const m = ms[Math.floor(rng() * ms.length)]; moves.push(m); s = pull(L, s, m).state; }
    if (!isDone(s)) found = moves;
  }
  assert.ok(found, 'some random order gets stuck');
  let g = newGame(L);
  for (const m of found) g = play(L, g, m).game;
  assert.ok(isStuck(L, g.state));
  assert.ok(g.state.rack.every(Boolean), 'stuck means the rack is full');
  const h = hint(L, g.state);
  assert.equal(h.kind, 'tangled');
  const g2 = playNudge(g);
  assert.equal(g2.past.length, g.past.length + 1, 'the spare slot can be undone too');
  assert.equal(isStuck(L, g2.state), false);
  assert.equal(playNudge(g2), g2);
  assert.deepEqual(undo(g2).state, g.state);
});

// ---------- solver and hints ----------

test('solver: finds an order, proves a dead end, and hints follow the stored solution', () => {
  // one slot, nothing covered: every madder must come out before any indigo (or the other way round)
  const L = lv([H(8, 'm'), H(18, 'i'), H(28, 'm'), H(38, 'i'), H(48, 'm'), H(58, 'i')], { slots: 1 });
  const r = solve(L);
  assert.ok(r.ok);
  assert.ok(isDone(replay(L, r.path)));
  const s1 = P(L, newState(L), 0);
  assert.equal(whyNot(L, s1, 1).reason, 'rack');
  assert.deepEqual(legalPulls(L, s1), [2, 4]);
  // one slot; three indigo verticals lie over madder 0. Pulling madder 4 first opens
  // the only slot to madder while the last madder is still buried: a dead end.
  const D = lv([H(50, 'm'), V(30, 'i'), V(50, 'i'), V(70, 'i'), H(20, 'm', 80, 95), H(80, 'm', 80, 95)], { slots: 1 });
  assert.deepEqual(D.over[0], [1, 2, 3]);
  assert.ok(solve(D).ok, 'indigo first clears it');
  const t = P(D, newState(D), 4);
  const dead = solve(D, t);
  assert.equal(dead.ok, false);
  assert.equal(dead.exhausted, true);
  assert.equal(hint(D, t).kind, 'tangled');
  assert.ok(isStuck(D, P(D, t, 5)));
  // hints on a real basket follow the stored solution
  const Lv = LEVELS[3];
  const first = Number(Lv.solution.split(' ')[0]);
  assert.equal(solutionStep(Lv, newState(Lv), Lv.solution), first);
  assert.deepEqual(hint(Lv, newState(Lv)), { kind: 'pull', strand: first });
  const off = P(Lv, newState(Lv), legalPulls(Lv, newState(Lv)).find((m) => m !== first));
  const h = hint(Lv, off);
  assert.ok(h.kind === 'pull' ? canPull(Lv, off, h.strand) : h.kind === 'tangled', 'off the stored path, the solver still points somewhere useful');
});

// ---------- the levels ----------

test('twenty baskets: generated, balanced, acyclic, with one new thing at a time', () => {
  assert.equal(LEVELS.length, 20);
  assert.equal(LEVEL_DEFS.length, 20);
  assert.equal(new Set(LEVELS.map((L) => L.id)).size, 20);
  for (const L of LEVELS) {
    assert.ok(HEAPS[L.id], `${L.id} generated`);
    assert.ok(unitsBalanced(L), `${L.id}: every color fills whole spools`);
    assert.ok(acyclic(L), `${L.id}: no loops`);
    for (const s of L.strands) assert.ok(COLORS[s.c] && (!s.c2 || COLORS[s.c2]));
    for (const m of L.mechanics) assert.ok(MECHANICS[m], `${L.id}: ${m} has an intro line`);
    assert.ok(L.slots === 4 || L.slots === 5);
  }
  const firstAt = {};
  LEVELS.forEach((L, i) => { for (const m of L.mechanics) if (!(m in firstAt)) firstAt[m] = i; });
  assert.deepEqual(Object.keys(firstAt).sort(), Object.keys(MECHANICS).sort(), 'every mechanic is used');
  const intros = Object.values(firstAt).sort((a, b) => a - b);
  for (let i = 1; i < intros.length; i++) assert.ok(intros[i] > intros[i - 1], 'never two new things in one basket');
  for (const L of LEVELS.slice(0, 3)) assert.equal(L.mechanics.length, 0, `${L.id} teaches the basics only`);
  assert.ok(LEVELS.at(-1).n >= 30, 'the last heap is big');
  assert.equal(BANDS[0].from, 0);
  for (const b of BANDS) assert.ok(LEVELS[b.from], b.name);
});

test('every basket: the stored solution replays to a clear board with no spare slot', () => {
  for (const L of LEVELS) {
    const moves = L.solution.split(' ').map(Number);
    let s = newState(L);
    for (const m of moves) {
      const r = pull(L, s, m);
      assert.ok(r.ok, `${L.id}: pull ${m} (${r.reason})`);
      s = r.state;
    }
    assert.ok(isDone(s), `${L.id} clears`);
    assert.equal(s.extra, 0);
    assert.ok(s.rack.every((x) => x === null), `${L.id}: every spool popped`);
    assert.equal(s.skeins.length, Object.values(L.units).reduce((a, b) => a + b, 0) / SPOOL);
    assert.equal(moves.length, L.stats.pulls);
    assert.equal(moves.length, L.n - L.knots.length);
  }
});

test('every basket agrees with what she sees: pairs clearly cross or clearly keep apart, and every strand shows', () => {
  for (const L of LEVELS) {
    for (let i = 0; i < L.n; i++) {
      for (let j = i + 1; j < L.n; j++) {
        if (L.partner[i] === j) continue;
        const d = minDist(L.poly[i], L.poly[j], L.grids[j]);
        assert.ok(d < 0.75 * W || d > 1.25 * W, `${L.id}: strands ${i} and ${j} are ${(d / W).toFixed(2)} W apart`);
      }
      // at least VIS_MIN of each strand is in view at the start (sampled)
      let vis = 0, tot = 0;
      for (let k = 0; k < L.poly[i].length; k += 3) {
        tot++;
        if (L.over[i].every((j) => minDist([L.poly[i][k]], L.poly[j], L.grids[j]) >= 0.6 * W)) vis++;
      }
      assert.ok(vis / tot >= VIS_MIN - 0.08, `${L.id}: strand ${i} shows ${(vis / tot).toFixed(2)}`);
    }
  }
});

test('every pin and knot matters: she meets each one along the stored solution', () => {
  for (const L of LEVELS) {
    const above = ancestors(L);
    for (const [p, by] of L.pins) assert.ok(!above[p].has(by), `${L.id}: the pin on ${p} adds something (${by} is not already over it)`);
    if (!L.pins.length && !L.knots.length) continue;
    let s = newState(L);
    const pinFelt = new Set(), knotFelt = new Set();
    for (const m of L.solution.split(' ').map(Number)) {
      for (const [p] of L.pins) if (whyNot(L, s, p)?.reason === 'pinned') pinFelt.add(p);
      for (const [a, b] of L.knots) if (!s.out[a] && isUncovered(L, s, a) !== isUncovered(L, s, b)) knotFelt.add(a);
      s = pull(L, s, m).state;
    }
    if (L.pins.length) assert.ok(pinFelt.size >= 1, `${L.id}: a pin holds an uncovered strand at some point`);
    if (L.knots.length) assert.ok(knotFelt.size >= 1, `${L.id}: a knot holds back a free strand at some point`);
  }
  // the very first pin basket shows every pin at work
  const first = LEVELS.find((L) => L.mechanics.includes('pin'));
  let s = newState(first);
  const felt = new Set();
  for (const m of first.solution.split(' ').map(Number)) { for (const [p] of first.pins) if (whyNot(first, s, p)?.reason === 'pinned') felt.add(p); s = pull(first, s, m).state; }
  assert.equal(felt.size, first.pins.length);
});

test('difficulty: early baskets are gentle, later ones need planning (stored stats)', () => {
  const r = LEVELS.map((L) => L.stats.random);
  for (const x of r.slice(0, 3)) assert.equal(x, 1);
  assert.ok(r.slice(-3).every((x) => x <= 0.2), 'the last baskets: few random orders clear');
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(r.slice(0, 7)) > avg(r.slice(7, 14)) && avg(r.slice(7, 14)) > avg(r.slice(14)), 'clear rates fall band by band');
  for (const L of LEVELS) if (L.strands.some((s) => s.q)) assert.ok(L.stats.careful - L.stats.blind <= 0.1, `${L.id}: buried colors never turn it into luck`);
});

// ---------- determinism ----------

test('determinism: the same seed gives the same heap, deal, rates and solution', () => {
  const knobs = { n: 9, len: [55, 80], colors: 3, slots: 5, knots: 1, pins: 1 };
  let seed = 1;
  while (!candidate(knobs, seed, 1) && seed < 40) seed++;
  const a = candidate(knobs, seed, 1), b = candidate(knobs, seed, 1);
  assert.ok(a, 'some seed makes a basket');
  assert.deepEqual(a, b);
  assert.equal(a.pins.length, 1);
  const h1 = makeHeap(mulberry(77), { n: 6, len: [60, 90] }), h2 = makeHeap(mulberry(77), { n: 6, len: [60, 90] });
  assert.deepEqual(h1, h2);
  assert.deepEqual(dealLevel(h1, mulberry(5), { colors: 2 }), dealLevel(h2, mulberry(5), { colors: 2 }));
  const L = LEVELS[6];
  assert.equal(randomRate(L, 9, 30), randomRate(L, 9, 30));
  assert.equal(carefulRate(L, 9, 20), carefulRate(L, 9, 20));
  assert.deepEqual(solve(L).path, solve(L).path);
  const again = buildLevel({ id: L.id, name: L.name, slots: HEAPS[L.id].slots, strands: HEAPS[L.id].strands, knots: HEAPS[L.id].knots, pins: HEAPS[L.id].pins });
  assert.deepEqual(again.over, L.over);
  assert.equal(levelSig(again), L.sig);
  assert.notEqual(levelSig(LEVELS[0]), levelSig(LEVELS[1]));
  // the stored stats were measured with the generator's seeds
  assert.equal(randomRate(LEVELS[3], 4242, 400), LEVELS[3].stats.random);
});

// ---------- what it knits up into ----------

test('the finished shelf: yardage and a sensible project', () => {
  assert.deepEqual(knitsInto(['m', 'i']), { skeins: 2, yards: 200, what: 'a hat or a pair of mittens', line: 'Enough for a hat or a pair of mittens.' });
  assert.match(knitsInto(['m', 'i', 'w', 'g']).what, /stripes/);
  assert.match(knitsInto(Array(12).fill('m')).what, /adult sweater/);
  assert.match(knitsInto(Array(5).fill('m')).what, /scarf/);
  for (const L of LEVELS) {
    const k = knitsInto(replay(L, L.solution).skeins);
    assert.ok(k.yards >= 200 && k.yards <= 1200, `${L.id}: ${k.yards} yards`);
  }
});
