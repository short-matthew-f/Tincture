// The Hoop: the shipped rules, drawing and hoops match the playtested
// prototype (rules and layout code, the packed data byte for byte, names,
// chapters, intro lines), the opening 23 kept as they were, a sample of stored
// solutions replays (the prototype's tests replay and check the pictures of
// every hoop), the difficulty (greedy ceilings, the ramp), and the sim: unlock,
// moves, lift-offs, undo, order, pay (once, repeats a quarter, the star bonus
// once, modest against hand orders), hooks, yarns in her colors, the save
// round trip mid-hoop, old saves, Renovate, the hub summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/puzzles/hoop.js';
import * as LY from '../src/puzzles/hoop-layout.js';
import { LEVELS, LEVEL_IDS, LEVEL_DEFS, MECHANICS, CHAPTERS, levelById, chapterOf, firstIntro } from '../src/puzzles/hoop-levels.js';
import { HOOPS } from '../src/puzzles/hoop-data.js';
import * as PR from '../proto/hoop/rules.js';
import * as PL from '../proto/hoop/layout.js';
import * as P from '../proto/hoop/levels.js';
import { HOOPS as PH } from '../proto/hoop/hoops.js';
import * as H from '../src/sim/hoop.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { EVENTS } from '../src/content/events.js';
import { orderBasePay, PAY_MINUTES } from '../src/sim/orders.js';
import { colorFamily } from '../src/sim/economy.js';
import { deltaEHex } from '../src/color.js';
import { unlockLabel } from '../src/sim/next.js';
import { currentEvent } from '../src/sim/events.js';

const NOW = Date.UTC(2026, 9, 24, 9);
const OPENING = ['first', 'sampler', 'floss', 'workbag', 'tacked', 'basting', 'couching', 'painted', 'colorway', 'fairisle', 'joined', 'fringe',
  'macrame', 'lifting', 'pickout', 'unpick', 'overunder', 'tabby', 'twill', 'snug', 'crewel', 'bargello', 'heirloom'];

// --- the data and the rules -------------------------------------------------------

test('levels build only when the rules read them; the light fields are ready at once', () => {
  const L = levelById('familytree');
  assert.ok(L && L.par > 0 && L.stats.strands > 0 && L.solution, 'light fields');
  assert.equal(L.isBuilt, false);
  assert.ok(L.n >= 18 && L.S === L.stats.strands);
  assert.equal(L.isBuilt, true);
  assert.equal(L.sig, R.levelSig(L));
  assert.equal(L.par, R.parseMoves(L.solution).length);
  assert.equal(L.stats.par, L.par);
  // the packed data decodes to the prototype's defs
  assert.deepEqual(HOOPS.familytree.def, PH.familytree.def);
});

test('the rules, the drawing and the hoops are the prototype’s, unchanged', () => {
  for (const [k, f] of Object.entries(PR)) {
    if (typeof f === 'function') assert.equal(String(R[k]), String(f), `rules ${k}`);
    else assert.deepEqual(R[k], f, `rules ${k}`);
  }
  assert.deepEqual(Object.keys(R).sort(), Object.keys(PR).sort());
  for (const [k, f] of Object.entries(PL)) {
    if (typeof f === 'function') assert.equal(String(LY[k]), String(f), `layout ${k}`);
    else assert.deepEqual(LY[k], f, `layout ${k}`);
  }
  assert.equal(readFileSync(new URL('../src/puzzles/hoop-data.js', import.meta.url), 'utf8'), readFileSync(new URL('../proto/hoop/hoops.js', import.meta.url), 'utf8'),
    'hoop-data.js is a copy of proto/hoop/hoops.js (node proto/hoop/ship.mjs)');
});

test('103 hoops in the prototype’s order, names and chapters; the opening 23 kept as they were', () => {
  assert.ok(LEVELS.length >= 100 && LEVELS.length <= 110, `${LEVELS.length} hoops`);
  assert.deepEqual(LEVEL_IDS.slice(0, 23), OPENING);
  assert.deepEqual(LEVEL_DEFS.map((d) => [d.id, d.name]), P.LEVEL_DEFS.map((d) => [d.id, d.name]));
  assert.deepEqual(LEVEL_IDS, P.LEVELS.map((L) => L.id));
  assert.deepEqual(Object.fromEntries(Object.entries(MECHANICS).map(([k, v]) => [k, { ...v }])), P.MECHANICS);
  assert.deepEqual(CHAPTERS.map((c) => ({ ...c })), P.CHAPTERS);
  assert.equal(new Set(LEVEL_IDS).size, LEVEL_IDS.length);
  // the opening hoops are the playtested ones: same signatures and pars as the prototype's
  for (const id of OPENING) {
    const L = levelById(id), Q = P.levelById(id);
    assert.equal(L.sig, Q.sig, id);
    assert.equal(L.solution, Q.solution, id);
  }
  // chapters of about ten (the opening three follow the mechanic bands), each named, covering every hoop in order
  assert.equal(CHAPTERS[0].from, 0);
  CHAPTERS.forEach((c, k) => {
    const to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    assert.ok(to - c.from >= 7 && to - c.from <= 11, `${c.name}: ${to - c.from} hoops`);
    assert.ok(c.name && c.theme);
    assert.equal(chapterOf(c.from), c);
  });
  // every mechanic has a line, and each new one arrives alone (all in the opening)
  const firstAt = firstIntro();
  assert.deepEqual(Object.keys(firstAt).sort(), Object.keys(MECHANICS).sort());
  for (const i of Object.values(firstAt)) assert.ok(i < 23, 'the new things all come in the opening');
});

test('stored solutions replay to a clear hoop with the shipped rules (a sample; proto/test checks every hoop)', () => {
  for (const id of ['first', 'sampler', 'joined', 'lifting', 'overunder', 'bargello', 'heirloom', 'jacobean', 'house', 'sleeves', 'mitre', 'wired', 'hikeshi', 'suzhou', 'familytree']) {
    const L = levelById(id);
    const s = R.replay(L, L.solution);
    assert.ok(R.isDone(s), `${id} clears`);
    assert.equal(s.moves, L.par);
    assert.ok(R.lowerBound(L, R.newState(L)) <= L.par, `${id}: the bound never overshoots`);
  }
  // a short hoop's par is proved here too
  const r = R.solve(levelById('first'));
  assert.ok(r.ok && r.optimal && r.path.length === levelById('first').par);
});

test('difficulty: the greedy player mostly fails the later hoops; harder within each chapter, a small reset at each new one', () => {
  for (let k = 3; k < CHAPTERS.length; k++) {
    const c = CHAPTERS[k], to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    const late = k >= 7;
    for (let i = c.from; i < to; i++) {
      const st = LEVELS[i].stats;
      assert.ok(st.greedy <= (late ? 0.2 : 0.5) + 1e-9, `${LEVELS[i].id}: greedy clears ${st.greedy}`);
      if (i > c.from) assert.ok(P.difficulty(st) >= P.difficulty(LEVELS[i - 1].stats), `${LEVELS[i].id}: no easier than the one before it`);
      assert.ok(st.crossings <= 34 && st.hooked >= 1, `${LEVELS[i].id}: readable, with a clasp`);
    }
    assert.ok(P.difficulty(LEVELS[c.from].stats) < P.difficulty(LEVELS[c.from - 1].stats), `${c.name}: starts a little easier than the last chapter ended`);
  }
  // the stored greedy rate is what the rules give (a quick one, recomputed)
  for (const id of ['jacobean', 'aida']) {
    const L = levelById(id);
    assert.equal(Math.round(R.greedyRate(L, 60, 4242, 40, new Map()) * 1000) / 1000, L.stats.greedy, id);
  }
  // the opening is gentle: the greedy player clears nearly all of it
  assert.ok(LEVELS.slice(0, 20).every((L) => L.stats.greedy >= 0.95));
});

// --- the sim ------------------------------------------------------------------------

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}
function opened(n = 34, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 14500;
  assert.equal(sim.unlocks.buy(s, { id: 'hoop' }, NOW).ok, true);
  s._events = [];
  return s;
}
const solutionOf = (L) => R.parseMoves(L.solution);
function playAll(s, L, now = NOW, moves = solutionOf(L)) {
  let r = null;
  for (const [e, q] of moves) { r = H.move(s, { end: e, to: q }, now); assert.ok(r.ok, `${L.id} ${e}:${q}: ${r.reason}`); }
  return r;
}

test('unlock: revealed at 34 colors for 14,000 coins; nothing plays while it is closed', () => {
  const s = withColors(33);
  const u = sim.unlocks.status(s, 'hoop');
  assert.deepEqual([u.revealColors, u.cost, u.revealed], [34, 14000, false]);
  assert.equal(H.openHoop(s).reason, 'locked');
  assert.equal(H.move(s, { end: 0, to: 3 }, NOW).reason, 'locked');
  const o = opened(34);
  assert.equal(o.coins, 500);
  assert.equal(H.unlocked(o), true);
  assert.match(unlockLabel('hoop', 14000), /^Open the Hoop for 14(,000|K)$/);
});

test('moves through the sim: reasons, lift-offs, undo, restart; hoops open in order', () => {
  const s = opened();
  assert.deepEqual(H.openHoop(s), { ok: true, levelId: 'first' });
  const L = levelById('first');
  const sol = solutionOf(L);
  assert.equal(H.move(s, { end: 99, to: 0 }, NOW).reason, 'bad');
  const taken = H.move(s, { end: 0, to: L.start[2] }, NOW);
  assert.equal(taken.ok, false);
  assert.equal(taken.reason, 'taken');
  assert.equal(H.move(s, { end: 0, to: -1 }, NOW).reason, 'band', 'no lift-off before its band');
  const r = H.move(s, { end: sol[0][0], to: sol[0][1] }, NOW);
  assert.ok(r.ok && r.movers.length === 1 && Array.isArray(r.freed));
  assert.deepEqual(s.hoop.game.moves, [`${sol[0][0]}:${sol[0][1]}`]);
  assert.ok(H.undo(s).ok);
  assert.equal(H.undo(s).reason, 'none');
  assert.deepEqual(H.current(s).s, R.newState(L));
  // order: hoop 2 waits for hoop 1
  assert.equal(H.isOpen(s, 1), false);
  assert.equal(H.startHoop(s, { levelId: 'sampler' }).reason, 'closed');
  assert.equal(H.startHoop(s, { levelId: 'nope' }).reason, 'unknown');
  H.move(s, { end: sol[0][0], to: sol[0][1] }, NOW);
  assert.ok(H.restart(s).ok);
  assert.deepEqual(s.hoop.game.moves, []);
  playAll(s, L);
  assert.ok(H.current(s).done);
  assert.equal(H.move(s, { end: 0, to: 3 }, NOW).reason, 'done');
  assert.equal(H.isOpen(s, 1), true);
  assert.equal(H.isOpen(s, 2), false);
  assert.equal(H.maxOpen(s), 1);
  assert.equal(H.continueId(s), 'sampler');
  assert.equal(H.nextLevelId(s, 'first'), 'sampler');
  // an unfinished hoop she steps away from waits for her
  assert.ok(H.startHoop(s, { levelId: 'sampler' }).ok);
  const s2 = solutionOf(levelById('sampler'));
  H.move(s, { end: s2[0][0], to: s2[0][1] }, NOW);
  assert.ok(H.startHoop(s, { levelId: 'first' }).ok);
  assert.deepEqual(Object.keys(s.hoop.other), ['sampler']);
  assert.equal(H.continueId(s), 'sampler', 'Continue goes back to the unfinished one');
  const back = H.startHoop(s, { levelId: 'sampler' });
  assert.ok(back.ok && back.resumed);
  assert.equal(s.hoop.game.moves.length, 1);
  // a lift-off hoop: a strand on top of everything lifts off as a move
  const t = opened(34, 3);
  t.hoop.done = Object.fromEntries(LEVEL_IDS.slice(0, LEVEL_IDS.indexOf('lifting')).map((id) => [id, 1]));
  assert.ok(H.startHoop(t, { levelId: 'lifting' }).ok);
  const LL = levelById('lifting');
  let st = H.current(t).s, lifted = null;
  for (const [e, q] of solutionOf(LL)) {
    const off = [...Array(LL.S).keys()].find((i) => !st.out[i] && !R.canLiftOff(LL, st, i));
    if (off !== undefined) { lifted = H.move(t, { end: 2 * off, to: -1 }, NOW); break; }
    assert.ok(H.move(t, { end: e, to: q }, NOW).ok);
    st = H.current(t).s;
  }
  assert.ok(lifted && lifted.ok && lifted.liftoff && lifted.freed[0].lifted, 'a lift-off is a move of its own');
  assert.match(t.hoop.game.moves.at(-1), /:-1$/);
});

test('a cleared hoop pays coins scaled to income and expected time, once; repeats a quarter; the star adds a little, once; hooks fire', () => {
  const s = opened(34, 2);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  s._events = [];
  s.quests.daily = [{ id: 'q1', type: 'clear-hoops', event: 'hoopUntangled', target: 2, progress: 0, done: false, claimed: false }];
  H.openHoop(s);
  const L = levelById('first');
  const one = H.hoopMinutes(L) * orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
  const q = H.quote(s, 'first', NOW, { moves: L.par });
  assert.ok(Math.abs(q.coins - one) < 1e-9);
  assert.ok(q.star && Math.abs(q.bonus - one * H.STAR_SHARE) < 1e-9, 'at par: the star bonus');
  assert.equal(H.quote(s, 'first', NOW, { moves: L.par + 1 }).bonus, 0, 'over par: no bonus, never a penalty');
  const coins0 = s.coins;
  const r = playAll(s, L);
  assert.ok(r.finished, 'the last move finishes it');
  assert.ok(Math.abs(s.coins - coins0 - one * (1 + H.STAR_SHARE)) < 1e-6, 'coins as quoted, with the star');
  assert.equal(s.hoop.done.first, 1);
  assert.equal(s.hoop.best.first, L.par);
  assert.equal(H.starred(s, 'first'), true);
  assert.equal(s.hoop.finished, 1);
  assert.equal(s.hoop.last.levelId, 'first');
  assert.equal(s.quests.daily[0].progress, 1, "questEvent(state, 'hoopUntangled', 1, {levelId})");
  assert.equal(s._events.filter((e) => e.type === 'hoopUntangled').length, 1);
  const yarns = s.hoop.game.yarns;
  assert.deepEqual(r.finished.colors.sort(), [...new Set(L.colors.map((k) => yarns[k]))].sort(), 'eventPoints gets her yarn ids');
  // Undo the last move and finish again: nothing is paid twice.
  const c1 = s.coins;
  assert.ok(H.undo(s).ok);
  const last = solutionOf(L).pop();
  const again = H.move(s, { end: last[0], to: last[1] }, NOW);
  assert.ok(again.ok && !again.finished);
  assert.equal(s.coins, c1);
  assert.equal(s.hoop.done.first, 1);
  // Cleared again from the start: a quarter, and the star bonus is not paid again.
  H.startHoop(s, { levelId: 'first', fresh: true });
  const q2 = H.quote(s, 'first', NOW, { moves: L.par });
  assert.ok(q2.repeat && Math.abs(q2.coins - one * H.REPEAT_SHARE) < 1e-6 && q2.bonus === 0);
  const c2 = s.coins;
  playAll(s, L);
  assert.ok(Math.abs(s.coins - c2 - q2.coins) < 1e-6);
  assert.equal(s.hoop.done.first, 2);
  assert.equal(s.quests.daily[0].progress, 2);
});

test('event points for a cleared hoop whose yarn includes the event’s colors', () => {
  const W40 = Date.UTC(2026, 8, 30, 12);
  const s = opened(34, 4);
  currentEvent(s, W40);
  const ev = EVENTS.find((e) => e.id === s.event.key);
  H.openHoop(s);
  const before = s.event.points;
  playAll(s, levelById('first'), W40);
  const used = levelById('first').colors.map((k) => colorFamily(s.hoop.game.yarns[k]));
  const themed = used.some((f) => ev.palette.includes(f));
  assert.equal(s.event.points - before, themed ? 20 : 0);
});

test('pay stays modest: at most 1.2 income-minutes per estimated active minute (star included), under hand orders', () => {
  const s = opened(36, 4);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  const minute = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
  assert.ok(minute > 0);
  for (const L of LEVELS) {
    const mins = H.estimatedSeconds(L) / 60;
    const q = H.quote(s, L.id, NOW, { moves: L.par });
    const perMin = (q.coins + q.bonus) / minute / mins;
    assert.ok(perMin <= 1.2 + 1e-9, `${L.id}: ${perMin.toFixed(2)} income-minutes per active minute`);
    assert.ok(perMin * 2 <= PAY_MINUTES.min * 1.15 + 1e-9, `${L.id} at double speed is still under hand orders`);
    assert.ok(H.hoopMinutes(L) >= H.MIN_MINUTES);
  }
  assert.ok(H.hoopMinutes(levelById('familytree')) > H.hoopMinutes(levelById('first')) * 1.5, 'bigger hoops pay more');
});

test('yarns: her discovered colors, one per hue family where she can, never lost in the linen, fixed for the hoop', () => {
  const s = opened(34, 5);
  const y = H.defaultYarns(s);
  const ids = H.YARN_ORDER.map((k) => y[k]);
  assert.equal(new Set(ids).size, 8, 'eight distinct colors');
  for (const id of ids) assert.ok(s.catalog.discovered[id], `${id} is one of hers`);
  for (const id of ids) assert.ok(deltaEHex(sim.economy.colorHex(id), H.LINEN) >= H.YARN_MIN_DE, `${id} stands out from the linen`);
  const famsAvail = new Set(Object.keys(s.catalog.discovered).filter((id) => deltaEHex(sim.economy.colorHex(id), H.LINEN) >= H.YARN_MIN_DE).map(colorFamily)).size;
  assert.equal(new Set(ids.map(colorFamily)).size, Math.min(8, famsAvail), 'distinct hue families first');
  H.openHoop(s);
  const fixed = { ...s.hoop.game.yarns };
  for (const c of CATALOG.slice(40, 60)) if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  assert.deepEqual(H.current(s).yarns, fixed, 'a new color never repaints the hoop in play');
  const few = createInitialState(NOW, 6);
  assert.equal(new Set(Object.values(H.defaultYarns(few))).size, 8, 'with few colors, catalog colors fill in');
});

test('save round trip mid-hoop: reload resumes exactly and plays on identically', () => {
  const st = opened(34, 7);
  for (const id of ['first', 'sampler', 'floss']) { H.startHoop(st, { levelId: id }); playAll(st, levelById(id)); }
  H.startHoop(st, { levelId: 'workbag' });
  const L = levelById('workbag');
  const sol = solutionOf(L);
  for (const [e, q] of sol.slice(0, 2)) assert.ok(H.move(st, { end: e, to: q }, NOW).ok);
  const back = deserialize(serialize(st, NOW), NOW + 1000);
  assert.deepEqual(back.hoop, st.hoop);
  assert.deepEqual(H.current(back).s, H.current(st).s);
  assert.equal(H.current(back).past.length, 2);
  for (const [e, q] of sol.slice(2)) assert.ok(H.move(back, { end: e, to: q }, NOW).ok);
  assert.ok(H.current(back).done);
  assert.equal(back.hoop.done.workbag, 1);
  H.setSetting(st, { key: 'glyphs', value: true });
  H.setSetting(st, { key: 'hooks', value: false });
  H.seeIntro(st, { mechanics: ['clasp'] });
  const b2 = deserialize(serialize(st, NOW), NOW);
  assert.equal(b2.hoop.settings.glyphs, true);
  assert.equal(b2.hoop.settings.hooks, false);
  assert.equal(H.glyphsOn(b2), true);
  assert.equal(b2.hoop.seenIntro.clasp, true);
  assert.equal(H.setSetting(st, { key: 'nope', value: true }).ok, false);
});

test('old saves load: no hoop section, no unlock; a broken or outdated game is set aside', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.hoop;
  delete obj.state.unlocks.hoop;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.hoop, false);
  assert.deepEqual(back.hoop, H.initialHoop());
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.hoop = { settings: 'x', done: { first: 2, nope: 1 }, best: { first: 3, gone: 2 } };
  const o = deserialize(JSON.stringify(odd), NOW);
  assert.deepEqual(o.hoop.settings, { sound: true, glyphs: null, hooks: true });
  H.ensureHoop(o);
  assert.deepEqual(o.hoop.done, { first: 2 });
  assert.deepEqual(o.hoop.best, { first: 3 });
  const bad = opened();
  bad.hoop.game = { level: 'first', sig: levelById('first').sig, moves: ['0:0', 'x'], paid: false };
  H.ensureHoop(bad);
  assert.equal(bad.hoop.game, null, 'moves that no longer replay');
  bad.hoop.game = { level: 'first', sig: 'old', moves: [], paid: false };
  H.ensureHoop(bad);
  assert.equal(bad.hoop.game, null, 'a hoop that changed');
  bad.hoop.cur = 'gone';
  H.ensureHoop(bad);
  assert.equal(bad.hoop.cur, 'first');
  bad.hoop.cur = 'familytree';
  H.ensureHoop(bad);
  assert.equal(bad.hoop.cur, 'first', 'a hoop not open yet falls back to the furthest open one');
  assert.equal(H.current(bad), null);
  assert.deepEqual(H.openHoop(bad), { ok: true, levelId: 'first' });
});

test('Renovate closes the Hoop (cleared hoops and the one on the frame stay); Keep the Hoop holds it open', () => {
  const s = opened(36);
  H.openHoop(s);
  playAll(s, levelById('first'));
  H.startHoop(s, { levelId: 'sampler' });
  const m = solutionOf(levelById('sampler'))[0];
  H.move(s, { end: m[0], to: m[1] }, NOW);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('hoop'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.hoop, false);
  assert.ok(s.renovateReopen.includes('hoop'));
  assert.equal(s.hoop.done.first, 1);
  assert.equal(s.hoop.game.moves.length, 1, 'the hoop on the frame waits for her');
  const k = opened(36);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-hoop' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('hoop'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.hoop, true);
});

test('the summary read for the Puzzles hub', () => {
  const s = opened();
  let sum = H.summary(s);
  assert.equal(sum.open, true);
  assert.equal(sum.levelId, 'first');
  assert.equal(sum.playing, false);
  assert.equal(sum.total, LEVELS.length);
  assert.equal(sum.chapter, CHAPTERS[0].name);
  H.openHoop(s);
  const m = solutionOf(levelById('first'))[0];
  H.move(s, { end: m[0], to: m[1] }, NOW);
  sum = H.summary(s);
  assert.ok(sum.playing && sum.moves === 1 && sum.strands === levelById('first').S);
});
