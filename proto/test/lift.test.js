import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLevel, newState, apply, legalMoves, settle, isDone, isStuck, nudge, canNudge, benchCap, exposedColor, openColor,
  isCovered, laneOpen, blockedReason, newGame, play, playNudge, undo, replay, solve, hint, capacitiesMatch, capacityByColor,
  decodeMove, encodeMove, stateKey, parseRow, parseLane, laneString, generateQueues, chooseCap, fitCap, mulberry,
  mechanicsOf, casualRate, levelSig, solutionStep, intendedOrder, minParks, firstMoveSurvey, CAPS,
} from '../lift/rules.js';
import { LEVELS, LEVEL_DEFS, PALETTE, MECHANICS, CHAPTERS } from '../lift/levels.js';
import { SOURCES } from '../lift/art-sources.js';
import { ART as ART_GEN } from '../lift/art.js';
import { ART_IMPORTED } from '../lift/art-imported.js';
import { QUEUES } from '../lift/queues.js';
import { decodePNG, encodePNG, importPNG, quantize, downsample } from '../lift/import-art.mjs';
import { deflateSync } from 'node:zlib';

const tiny = (o) => buildLevel({ id: 'tiny', name: 'Tiny', slots: 4, bench: 3, ...o });
const P = (L, s, str) => apply(L, s, decodeMove(str));
const run = (L, str, s = newState(L)) => replay(L, str, s);

// ---------- the level list ----------

test('the level list: 100 to 110 paintings, palette colors, capacities match, mechanics known', () => {
  assert.ok(LEVELS.length >= 100 && LEVELS.length <= 110, `${LEVELS.length} levels`);
  assert.equal(new Set(LEVELS.map((L) => L.id)).size, LEVELS.length, 'ids are unique');
  for (const L of LEVELS) {
    assert.ok(L.colors.length >= 3 && L.colors.length <= 10, `${L.id} has ${L.colors.length} colors`);
    for (const c of L.colors) assert.ok(PALETTE[c], `${L.id}: ${c} is in the palette`);
    assert.ok(capacitiesMatch(L), `${L.id}: jar capacity equals cell count per color`);
    assert.ok(L.lanes.length && L.lanes.every((l) => l.length > 0), `${L.id}: every lane has jars`);
    for (const m of L.mechanics) assert.ok(MECHANICS[m], `${L.id}: ${m} has an intro line`);
    assert.ok(L.stats && L.solution, `${L.id}: generated`);
  }
  // later pictures are denser: the first chapters' mid and late levels are at
  // least 22 columns and 24 rows; from chapter 4 on, every picture is at least
  // 18x24 with 6 to 10 colors, and each chapter ends on big pictures
  for (const L of LEVELS.slice(8, 27)) assert.ok(L.W >= 22 && L.H >= 24, `${L.id} is ${L.W}x${L.H}`);
  assert.ok(LEVELS.slice(19, 27).every((L) => L.W * L.H >= 800), 'the whole table: big pictures');
  for (const c of CHAPTERS.slice(3)) {
    const ls = LEVELS.slice(c.from, c.to);
    for (const L of ls) {
      assert.ok(L.W >= 18 && L.H >= 24, `${L.id} is ${L.W}x${L.H}`);
      assert.ok(L.colors.length >= 6 && L.colors.length <= 10, `${L.id} has ${L.colors.length} colors`);
    }
    assert.ok(ls.slice(-3).every((L) => L.W * L.H >= 900), `${c.id} ends on big pictures`);
  }
});

test('chapters: ten rooms that tile the list; each new painting has a picture, a slot size and knobs', () => {
  assert.equal(CHAPTERS.length, 10);
  CHAPTERS.forEach((c, i) => {
    assert.equal(c.from, i ? CHAPTERS[i - 1].to : 0);
    for (const L of LEVELS.slice(c.from, c.to)) assert.equal(L.chapter, c.id);
  });
  assert.equal(CHAPTERS[9].to, LEVELS.length);
  assert.deepEqual(CHAPTERS.slice(0, 3).map((c) => c.to - c.from), [10, 9, 8], 'the first 27 keep their order');
  for (const d of LEVEL_DEFS.slice(27)) {
    assert.ok(Array.isArray(d.size) && d.art.length === d.size[1] && d.art[0].length >= d.size[0], `${d.id}: drawn at its slot size`);
    assert.ok(ART_GEN[d.id] || ART_IMPORTED[d.id], `${d.id} has a picture`);
    assert.ok(!(ART_GEN[d.id] && ART_IMPORTED[d.id] && SOURCES[d.id] === undefined), `${d.id}: one source of truth`);
    assert.ok(d.gen && d.gen.target > 0 && d.gen.target < 1 && d.gen.caps.length, `${d.id} has knobs`);
  }
  for (const id of Object.keys(SOURCES)) assert.ok(LEVEL_DEFS.some((d) => d.id === id && d.size), `${id}: an imported picture has a painting and a slot size`);
  // no near-duplicates among the pictures: no two share more than half their cells at the same size
  const sameSize = {};
  for (const L of LEVELS) (sameSize[`${L.W}x${L.H}`] ||= []).push(L);
  for (const group of Object.values(sameSize)) for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
    let same = 0;
    for (let r = 0; r < group[a].H; r++) for (let c = 0; c < group[a].W; c++) if (group[a].cells[r][c] === group[b].cells[r][c]) same++;
    assert.ok(same / (group[a].W * group[a].H) < 0.5, `${group[a].id} and ${group[b].id} look alike`);
  }
});

test('mechanics arrive one at a time, in band order, each with its intro level', () => {
  const firstAt = {};
  LEVELS.forEach((L, i) => { for (const m of L.mechanics) if (!(m in firstAt)) firstAt[m] = i; });
  assert.deepEqual(Object.keys(MECHANICS).sort(), Object.keys(firstAt).sort(), 'every mechanic is used');
  const intros = Object.values(firstAt).sort((a, b) => a - b);
  for (let i = 1; i < intros.length; i++) assert.ok(intros[i] > intros[i - 1], 'never two new mechanics on one painting');
  assert.ok(firstAt.mystery >= 4 && firstAt.linked > firstAt.mystery && firstAt.mixing > firstAt.linked &&
    firstAt.cloth > firstAt.mixing && firstAt.key > firstAt.cloth && firstAt.belt3 > firstAt.key && firstAt.bench2 > firstAt.belt3 &&
    firstAt.crock > firstAt.bench2 && firstAt.leftover > firstAt.crock);
  for (const L of LEVELS.slice(0, 4)) assert.equal(L.mechanics.length, 0, `${L.id} teaches the basics only`);
  // the two newer mechanics are introduced alone, each on its own painting
  assert.deepEqual(LEVELS[firstAt.crock].mechanics, ['crock']);
  assert.deepEqual(LEVELS[firstAt.leftover].mechanics, ['leftover']);
  assert.ok(firstAt.crock >= CHAPTERS[3].to, 'new mechanics wait until the remix chapters have warmed up');
});

test('every level is solvable with no nudge: the stored solution replays to a clear picture', () => {
  for (const L of LEVELS) {
    const s = run(L, L.solution);
    assert.ok(isDone(s), `${L.id} clears`);
    assert.equal(s.extra, 0, 'no spare bench spot used');
    assert.equal(s.shelf.length, L.lanes.reduce((a, l) => a + l.length, 0) + L.left.length, `${L.id}: every jar ends on the shelf`);
    assert.equal(s.belt.length + s.bench.length, 0);
    assert.equal(L.solution.split(' ').length, L.stats.moves);
  }
});

test('the solver independently solves the early levels within a small node cap', () => {
  for (const L of LEVELS.slice(0, 6)) {
    const r = solve(L, undefined, { cap: 4000 });
    assert.ok(r.ok, `${L.id} solved`);
    assert.ok(isDone(replay(L, r.path)));
  }
});

test('difficulty climbs across the first 27 paintings\' mechanic bands (casual clears, traps, parking, length)', () => {
  const band = (a, b) => LEVELS.slice(a, b).map((L) => L.stats);
  const mean = (xs, k) => xs.reduce((s, x) => s + x[k], 0) / xs.length;
  // bands: learning the table 0-3, mystery/tied/mixing 4-12, the whole table 19-26
  const early = band(0, 4), mid = band(4, 13), late = band(19, 27);
  assert.ok(mean(early, 'casual') >= 0.8, 'early levels teach: casual players nearly always clear');
  assert.ok(mean(early, 'casual') > mean(mid, 'casual') && mean(mid, 'casual') > mean(late, 'casual'), 'casual clears fall band by band');
  assert.ok(Math.max(...late.map((x) => x.casual)) < 0.1, 'the hardest levels: under 10% for a random player');
  assert.ok(mean(early, 'trapSteps') < mean(mid, 'trapSteps') && mean(mid, 'trapSteps') < mean(late, 'trapSteps'), 'more traps to dodge');
  assert.ok(mean(early, 'moves') < mean(mid, 'moves') && mean(mid, 'moves') < mean(late, 'moves'), 'longer paintings');
  assert.ok(late.every((x) => x.parks >= 1), 'every late level needs parking');
  assert.ok(early.every((x) => x.parks === 0 && x.trapSteps === 0), 'early levels need no parking');
});

test('chapters 4 to 10: each starts gentler than the last ended, then climbs', () => {
  const mean = (xs, k) => xs.reduce((s, x) => s + x[k], 0) / xs.length;
  CHAPTERS.slice(3).forEach((c, i) => {
    const st = LEVELS.slice(c.from, c.to).map((L) => L.stats);
    const first = st.slice(0, 4), last = st.slice(-4);
    assert.ok(mean(first, 'casual') > 2 * mean(last, 'casual'), `${c.id}: casual clears fall`);
    assert.ok(mean(first, 'trapSteps') < mean(last, 'trapSteps'), `${c.id}: more traps to dodge`);
    assert.ok(mean(first, 'moves') < mean(last, 'moves'), `${c.id}: longer paintings`);
    assert.ok(Math.max(...last.map((x) => x.casual)) <= 0.1, `${c.id}: its last paintings need planning`);
    assert.ok(last.some((x) => x.parks >= 1), `${c.id}: something to park by the end`);
    const prev = LEVELS[c.from - 1].stats;
    assert.ok(st[0].casual > prev.casual + 0.1, `${c.id} starts gentler than the room before ended`);
    if (i > 0) assert.ok(st[0].casual <= LEVELS[CHAPTERS[i + 2].from].stats.casual + 0.05, `${c.id} starts a little firmer than the room before started`);
  });
});

test('stored casual rates are honest (recomputed for two levels)', () => {
  for (const id of ['sun', 'skein']) {
    const L = LEVELS.find((x) => x.id === id);
    assert.equal(casualRate(L, 4242, 100), L.stats.casual, `${id} casual rate`);
  }
});

test('art parsing: run-length and literal rows', () => {
  assert.equal(parseRow('s3 r s2'), 'sssrss');
  assert.equal(parseRow('ssr rr'), 'ssrrr');
  assert.equal(parseRow('s3rs2'), 'sssrss', 'run-length without spaces');
  assert.equal(parseRow('s12'), 's'.repeat(12));
  assert.throws(() => buildLevel({ id: 'x', name: 'X', art: ['s3', 's2'] }), /wide/);
  assert.throws(() => parseRow('s3 R'), /bad art/);
  for (const d of LEVEL_DEFS) assert.ok(QUEUES[d.id], `${d.id} has queues`);
});

// ---------- the core rules ----------

test('bottom exposure: only the lowest remaining cell of a column lifts', () => {
  const L = tiny({ art: ['a b', 'b a'], queues: ['a2', 'b2'] });
  let s = newState(L);
  assert.equal(exposedColor(L, s, 0), 'b');
  assert.equal(exposedColor(L, s, 1), 'a');
  let r = P(L, s, 'L0');
  s = r.state;
  assert.deepEqual(s.h, [2, 1]);
  assert.equal(exposedColor(L, s, 1), 'b', 'lifting exposes the cell above');
  assert.equal(s.belt[0].n, 1, 'the jar waits half full');
  r = P(L, s, 'L1');
  assert.ok(isDone(r.state));
  assert.equal(r.passes.length, 2);
  assert.deepEqual(r.passes[0].lifts.map((x) => x.c).join(''), 'bb');
});

test('the train: a jar further back sees what the jar in front exposed', () => {
  const L = tiny({ art: ['a', 'a', 'b'], queues: ['a1', 'a1', 'b1'] });
  let s = newState(L);
  s = P(L, s, 'L0').state;
  s = P(L, s, 'L1').state;
  const r = P(L, s, 'L2');
  assert.ok(isDone(r.state));
  assert.equal(r.passes.length, 2);
  assert.deepEqual(r.passes[1].lifts.map((x) => [x.id, x.row, x.tick]), [['0.0', 1, 0], ['1.0', 0, 1]]);
});

test('one cell per column per pass, full jars go to the shelf, empty-handed jars wait', () => {
  const L = tiny({ art: ['a', 'a', 'a'], queues: ['a3'] });
  const r = P(L, newState(L), 'L0');
  assert.equal(r.passes.length, 3);
  assert.ok(r.passes.every((p) => p.lifts.length === 1));
  assert.deepEqual(r.state.shelf.map((j) => j.c + j.cap), ['a3']);
  const L2 = tiny({ art: ['b', 'a'], queues: ['b1 a1'] });
  const w = P(L2, newState(L2), 'L0').state;
  assert.equal(w.belt.length, 1);
  assert.equal(w.belt[0].n, 0);
});

test('parking: a belt jar goes to the bench and back', () => {
  const L = tiny({ art: ['b', 'a'], queues: ['b1 a1'], slots: 1, bench: 1 });
  let s = P(L, newState(L), 'L0').state;
  assert.deepEqual(legalMoves(L, s).map(encodeMove), ['P0']);
  s = run(L, 'P0 L0 U0', s);
  assert.ok(isDone(s));
  assert.throws(() => P(L, s, 'L0'), /illegal/);
});

test('undo round trips back to the start, unlimited', () => {
  const L = LEVELS[2];
  let g = newGame(L);
  const seen = [JSON.stringify(g.state)];
  for (const str of L.solution.split(' ').slice(0, 10)) {
    g = play(L, g, decodeMove(str)).game;
    seen.push(JSON.stringify(g.state));
  }
  g = playNudge(g);
  seen.push(JSON.stringify(g.state));
  for (let i = seen.length - 1; i > 0; i--) {
    assert.equal(JSON.stringify(g.state), seen[i]);
    g = undo(g);
  }
  assert.equal(JSON.stringify(g.state), seen[0]);
  assert.equal(undo(g), g, 'undo at the start is a no-op');
});

test('stuck detection and the free nudge, once per painting', () => {
  const L = tiny({ art: ['a', 'b'], queues: ['a1 b1'], slots: 1, bench: 0 });
  let s = P(L, newState(L), 'L0').state;
  assert.ok(isStuck(L, s));
  assert.equal(solve(L, s).exhausted, true, 'proved tangled');
  assert.equal(hint(L, s, 20000, '').kind, 'tangled');
  assert.ok(canNudge(s));
  s = nudge(s);
  assert.equal(benchCap(L, s), 1);
  assert.ok(!isStuck(L, s));
  assert.ok(!canNudge(s), 'only one spare spot');
  assert.equal(nudge(s), s, 'a second nudge does nothing');
  let g = { state: s, past: [] };
  assert.equal(playNudge(g), g);
  const r = solve(L, s);
  assert.deepEqual(r.path, ['P0', 'L0', 'U0']);
  // not stuck while there is room for the next jar
  const L2 = tiny({ art: ['a', 'b'], queues: ['a1 b1'], slots: 2, bench: 0 });
  assert.ok(!isStuck(L2, P(L2, newState(L2), 'L0').state));
  g = newGame(L2);
  assert.ok(!isStuck(L2, g.state));
});

test('solver: a known small board, shortest by BFS; hints follow the stored solution', () => {
  const L = tiny({ art: ['b', 'a'], queues: ['b1 a1'], slots: 1, bench: 1 });
  const r = solve(L, undefined, { bfs: true });
  assert.deepEqual(r.path, ['L0', 'P0', 'L0', 'U0']);
  assert.deepEqual(hint(L, newState(L), 20000, '').move, { t: 'place', i: 0 });
  // on a real level the hint is the stored solution's next move, even after a nudge
  const Lv = LEVELS[10];
  const moves = Lv.solution.split(' ');
  const s = run(Lv, moves.slice(0, 7).join(' '));
  assert.equal(encodeMove(hint(Lv, s).move), moves[7]);
  assert.equal(encodeMove(solutionStep(Lv, nudge(s), Lv.solution)), moves[7]);
  assert.equal(solutionStep(Lv, P(Lv, newState(Lv), moves[0] === 'L0' ? 'L1' : 'L0').state, Lv.solution), null, 'off the path');
});

test('state keys ignore bench order and the spare spot; settle is a no-op on a settled state', () => {
  const L = LEVELS[0];
  const s = run(L, L.solution.split(' ').slice(0, 3).join(' '));
  assert.equal(stateKey(settle(L, s).state), stateKey(s));
  assert.equal(settle(L, s).passes.length, 0);
  assert.equal(stateKey(nudge(s)), stateKey(s));
});

// ---------- the new mechanics ----------

test('mystery jars: "?" is display only; the rules play them like any jar', () => {
  assert.deepEqual(parseLane('r3 ?b2'), [{ c: 'r', cap: 3 }, { c: 'b', cap: 2, q: true }]);
  const art = ['b b', 'r r'];
  const A = tiny({ art, queues: ['r2 ?b2'] }), B = tiny({ art, queues: ['r2 b2'] });
  assert.ok(mechanicsOf(A).has('mystery') && !mechanicsOf(B).has('mystery'));
  assert.equal(stateKey(run(A, 'L0')), stateKey(run(B, 'L0')));
  assert.ok(isDone(run(A, 'L0 L0')));
  assert.equal(laneString(A.lanes[0]), 'r2 ?b2');
});

test('tied jars go on the belt together and need two free places', () => {
  const L = tiny({ art: ['b a', 'a b'], queues: ['a2=b2'], slots: 2, bench: 1 });
  assert.deepEqual(L.lanes[0].map((j) => !!j.link), [true, false]);
  assert.equal(laneString(L.lanes[0]), 'a2=b2');
  const r = P(L, newState(L), 'L0');
  assert.ok(isDone(r.state), 'both jars rode together and cleared it');
  assert.equal(r.state.moves, 1, 'one tap');
  // with one place free the pair waits; parking makes room
  const M = tiny({ art: ['c c', 'a b', 'b a'], queues: ['c2', 'a2=b2'], slots: 2, bench: 1 });
  const s = P(M, newState(M), 'L0').state; // c waits (c is buried under b and a)
  assert.ok(!legalMoves(M, s).some((m) => m.t === 'place' && m.i === 1), 'pair needs two places');
  assert.equal(blockedReason(M, s, { t: 'place', i: 1 }), 'tied');
  const sol = solve(M, s);
  assert.ok(sol.ok && sol.path[0] === 'P0', 'the solver parks to make room');
  assert.ok(isDone(replay(M, sol.path, s)));
  assert.throws(() => parseLane('a1=b1=c1'), /two/);
});

test('mixing jars lift two colors in set amounts and cork when both are full', () => {
  const L = tiny({ art: ['r o', 'o r', 'r o'], queues: ['r3+o3'] });
  assert.deepEqual(capacityByColor(L.lanes), { r: 3, o: 3 });
  assert.ok(capacitiesMatch(L) && mechanicsOf(L).has('mixing'));
  const r = P(L, newState(L), 'L0');
  assert.ok(isDone(r.state));
  assert.deepEqual(r.state.shelf, [{ id: '0.0', c: 'r', cap: 3, c2: 'o', cap2: 3 }]);
  // not full until both parts are: a 2+1 jar on 2 r and 2 o lifts 2 r and 1 o, then waits for nothing more
  const M = tiny({ art: ['o o', 'r r'], queues: ['r2+o1 o1'] });
  const s = P(M, newState(M), 'L0').state;
  assert.equal(s.shelf.length, 1, 'r2 and o1 filled: corked');
  assert.deepEqual(s.h, [0, 1]);
  const N = tiny({ art: ['b b', 'r o'], queues: ['r1+o2 b2 o0'.replace(' o0', '')] });
  const t = P(N, newState(N), 'L0').state;
  assert.equal(t.belt.length, 1, 'o part still wants one more: the jar waits');
  assert.deepEqual([t.belt[0].n, t.belt[0].n2], [1, 1]);
  assert.throws(() => parseLane('r2+r2'), /two colors/);
});

test('muslin cloth: nothing lifts through it until a column beside it is bare', () => {
  // three columns, middle covered: a jar of the middle color waits until a side column is bare
  const L = tiny({ art: ['a b c', 'a b c'], cover: [1], queues: ['b2', 'a2', 'c2'] });
  let s = newState(L);
  assert.ok(isCovered(L, s, 1));
  assert.equal(openColor(L, s, 1), null);
  assert.equal(exposedColor(L, s, 1), 'b', 'the color still shows through the muslin');
  s = P(L, s, 'L0').state;
  assert.equal(s.belt[0].n, 0, 'b waits under the cloth');
  s = P(L, s, 'L1').state;
  assert.ok(isDone({ h: [s.h[0]] }) && !isCovered(L, s, 1), 'column 0 bare: the cloth lifts');
  assert.equal(s.h[1], 0, 'and the waiting jar lifted column 1 in the same settle');
  assert.ok(isDone(P(L, s, 'L2').state));
  assert.ok(mechanicsOf(L).has('cloth'));
  // an edge column only needs its one neighbor
  const E = tiny({ art: ['a b'], cover: [0], queues: ['a1', 'b1'] });
  assert.ok(isDone(run(E, 'L0 L1')));
});

test('keys: a locked lane opens once its key cell has been lifted', () => {
  const L = tiny({ art: ['b a', 'a a'], queues: ['a3', 'b1'], locks: [[1, 1, 1]] });
  let s = newState(L);
  assert.ok(!laneOpen(L, s, 1));
  assert.equal(blockedReason(L, s, { t: 'place', i: 1 }), 'locked');
  assert.ok(!legalMoves(L, s).some((m) => m.i === 1 && m.t === 'place'));
  s = P(L, s, 'L0').state;
  assert.ok(laneOpen(L, s, 1), 'key cell lifted');
  assert.ok(isDone(P(L, s, 'L1').state));
  assert.ok(mechanicsOf(L).has('key'));
  assert.throws(() => buildLevel({ id: 'k', name: 'K', art: ['a'], queues: ['a1'], locks: [[3, 0, 0]] }), /lock/);
  // stuck: the only lane left is locked and nothing can lift
  const S = tiny({ art: ['a', 'b'], queues: ['a1', 'b1'], locks: [[1, 0, 0]], slots: 1, bench: 0 });
  assert.ok(isStuck(S, P(S, newState(S), 'L0').state));
});

test('stuck counts tied pairs: one free place and a tied pair in front is stuck when nothing can rest', () => {
  const L = tiny({ art: ['c c', 'a b', 'b a'], queues: ['c1', 'a2=b2', 'c1'], slots: 2, bench: 0 });
  const s = P(L, newState(L), 'L0').state;
  assert.ok(!isStuck(L, s), 'the other single jar can still go on');
  const s2 = P(L, s, 'L2').state;
  assert.ok(isStuck(L, s2));
  assert.ok(isStuck(L, nudge(s2)), 'one spare spot is not enough: the pair needs two places');
  const W = tiny({ art: ['c c', 'a b', 'b a'], queues: ['c1', 'a2=b2', 'c1'], slots: 2, bench: 2 });
  assert.ok(!isStuck(W, P(W, P(W, newState(W), 'L0').state, 'L2').state), 'two bench spots: both jars rest and the pair goes on');
});

// ---------- the generator ----------

test('generator: capacities never leave a 1 or 2 remainder; fitted caps fit', () => {
  const rng = mulberry(3);
  for (let rem = 3; rem < 80; rem++) {
    const c = chooseCap(rem, rng);
    assert.ok(rem - c === 0 || rem - c >= 3, `rem ${rem} cap ${c}`);
    for (let avail = 0; avail < 25; avail += 3) {
      const f = fitCap(rem, avail, CAPS);
      if (f !== null) assert.ok(f <= avail && f >= 3 && (rem - f === 0 || rem - f >= 3), `fit ${rem}/${avail} -> ${f}`);
    }
  }
});

test('generator: intended orders play out, dealt lanes match, keys and mystery are placed fairly', () => {
  const def = LEVEL_DEFS.find((d) => d.id === 'birdhouse');
  const base = buildLevel(def);
  const io = intendedOrder(base, mulberry(5), { caps: def.gen.caps, future: 0.3, link: 0.3, mix: 0.3 });
  assert.ok(io && io.units.length > 10);
  assert.ok(io.units.every((u) => u.length === 1 || (u.length === 2 && u[0].link)));
  const g = generateQueues(base, { lanes: 4, seed: 9, ...def.gen, mystery: 0.5, locks: 1 });
  const L = buildLevel({ ...def, queues: g.queues, locks: g.locks });
  assert.ok(capacitiesMatch(L));
  assert.equal(g.locks.length, 1);
  const [lane, r, c] = g.locks[0];
  assert.ok(lane === 3 && r < L.H && c < L.W);
  for (const l of L.lanes) {
    assert.ok(!l[0].q, 'a lane never starts with a mystery jar');
    l.forEach((j, i) => { if (i > 0 && l[i - 1].link) assert.ok(!j.q, 'the second of a tied pair shows with its partner'); });
  }
  assert.ok(isDone(replay(L, g.moves)), 'the intended play clears it: solvable by construction');
  // deterministic
  assert.deepEqual(generateQueues(base, { lanes: 4, seed: 9, ...def.gen, mystery: 0.5, locks: 1 }), g);
});

test('generator: muslin it chooses, crocks and jars left out stay solvable by construction', () => {
  const def = LEVEL_DEFS.find((d) => d.id === 'snail');
  const base = buildLevel(def);
  for (const knobs of [{ cloth: 2 }, { crock: 0.4 }, { left: 2 }, { left: 1, crock: 0.3, cloth: 1, locks: 1, mystery: 0.3 }]) {
    const g = generateQueues(base, { lanes: 4, seed: 5, ...def.gen, ...knobs });
    assert.ok(g, JSON.stringify(knobs));
    const L = buildLevel({ ...def, queues: g.queues, locks: g.locks, cover: g.cover || undefined, left: g.left });
    assert.ok(capacitiesMatch(L), 'capacities equal cell counts');
    assert.ok(isDone(replay(L, g.moves)), `the intended play clears it (${JSON.stringify(knobs)})`);
    if (knobs.cloth) assert.equal(g.cover.length, knobs.cloth);
    if (knobs.left) assert.equal(L.left.length, knobs.left);
    if (knobs.crock) assert.ok(g.queues.join(' ').includes('!'), 'some crocks');
    assert.deepEqual(generateQueues(base, { lanes: 4, seed: 5, ...def.gen, ...knobs }), g, 'deterministic');
  }
});

test('difficulty tools: parking and first-move surveys on small boards', () => {
  const L = tiny({ art: ['b', 'a'], queues: ['b1 a1'], slots: 1, bench: 1 });
  assert.deepEqual(minParks(L), { parks: 1, exact: true, nodes: minParks(L).nodes });
  const F = tiny({ art: ['a', 'b'], queues: ['a1', 'b1'], slots: 1, bench: 0 });
  assert.deepEqual(firstMoveSurvey(F), { total: 2, losing: 1, unknown: 0 });
});

test('level signatures change when a painting or its jars change', () => {
  const a = tiny({ art: ['a b'], queues: ['a1', 'b1'] });
  const b = tiny({ art: ['a b'], queues: ['a1', '?b1'] });
  const c = tiny({ art: ['b a'], queues: ['a1', 'b1'] });
  assert.equal(levelSig(a), levelSig(tiny({ art: ['a b'], queues: ['a1', 'b1'] })));
  assert.notEqual(levelSig(a), levelSig(b));
  assert.notEqual(levelSig(a), levelSig(c));
  for (const L of LEVELS) assert.equal(L.sig, levelSig(L));
});

// ---------- importing painted pictures ----------

// A PNG whose rows use every filter type, built by hand (the fixture lives in memory).
function filteredPNG(W, H, rgb) {
  const bpp = 3, stride = W * bpp, rows = [];
  const px = (y, x) => (y < 0 || x < 0 ? 0 : rgb[y * stride + x]);
  for (let y = 0; y < H; y++) {
    const f = y % 5, line = [f];
    for (let x = 0; x < stride; x++) {
      const v = px(y, x), a = x >= bpp ? px(y, x - bpp) : 0, b = px(y - 1, x), c = x >= bpp ? px(y - 1, x - bpp) : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      line.push((v - pred) & 255);
    }
    rows.push(...line);
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([len, td, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('import-art: the PNG decoder handles every row filter and RGBA', () => {
  const W = 7, H = 10, rgb = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.push((x * 37 + y * 11) & 255, (x * 5 + y * 71) & 255, (x * y * 13) & 255);
  const img = decodePNG(filteredPNG(W, H, rgb));
  assert.equal(img.W, W); assert.equal(img.H, H);
  for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) assert.equal(img.data[i * 4 + k], rgb[i * 3 + k]);
  const rgba = new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255]);
  const back = decodePNG(encodePNG(2, 1, rgba, true));
  assert.deepEqual([...back.data], [...rgba]);
  assert.throws(() => decodePNG(Buffer.from('nope')), /PNG/);
});

test('import-art: area-averaged, palette-quantized, color budget and tiny regions merged', () => {
  // a 40x40 picture: sky on top, a madder sun, green below, plus a 1-pixel speck
  const W = 40, H = 40, rgba = new Uint8Array(W * H * 4);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = y < 26 ? hex(PALETTE.s.hex) : hex(PALETTE.g.hex);
    if ((x - 20) ** 2 + (y - 12) ** 2 < 64) c = hex(PALETTE.r.hex);
    if (x === 3 && y === 3) c = [0, 0, 0];
    rgba.set([...c, 255], (y * W + x) * 4);
  }
  const rows = importPNG(encodePNG(W, H, rgba), { W: 10, H: 10, colors: 3 });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.length === 10 && /^[sgr]+$/.test(r)), rows.join('/'));
  assert.equal(rows[0], 'ssssssssss');
  assert.equal(rows[9], 'gggggggggg');
  assert.ok(rows[3].includes('r'));
  // crop to aspect: a wide image keeps its middle
  const labs = downsample({ W: 4, H: 2, data: new Uint8Array(32).fill(255) }, 1, 1);
  assert.equal(labs.length, 1);
  // budget: at most N colors, and a one-cell island joins its neighbors
  const q = quantize(downsample(decodePNG(encodePNG(W, H, rgba)), 20, 20), 20, 20, { colors: 3, min: 3 });
  assert.ok(new Set(q.join('')).size <= 3, 'a picture keeps at least three colors and at most the budget');
  // no 4-connected region smaller than 3 cells survives
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    if (seen.has(i)) continue;
    const k = q[Math.floor(i / 20)][i % 20], st = [i], reg = [];
    seen.add(i);
    while (st.length) { const j = st.pop(); reg.push(j); const x = j % 20, y = Math.floor(j / 20); for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { const n = b * 20 + a; if (a >= 0 && b >= 0 && a < 20 && b < 20 && !seen.has(n) && q[b][a] === k) { seen.add(n); st.push(n); } } }
    assert.ok(reg.length >= 3, `region of ${k} with ${reg.length} cells`);
  }
  const grid = buildLevel({ id: 'imp', name: 'Imp', art: rows });
  assert.equal(grid.W, 10);
});
