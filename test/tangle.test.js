// The Tangle Basket: the shipped data matches the playtested prototype (rules
// code, packed heaps, names, chapters), the packed geometry still hashes to
// each basket's stored signature, a sample of stored solutions replays (the
// prototype's tests replay and re-prove every basket), the difficulty ramp,
// and the sim: unlock, pulls, undo, the spare slot, order, pay (once, repeats
// less, modest against hand orders), hooks, yarns in her colors, the save
// round trip mid-basket, old saves, Renovate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/puzzles/tangle.js';
import * as V from '../src/puzzles/tangle-view.js';
import { LEVELS, LEVEL_IDS, LEVEL_DEFS, MECHANICS, CHAPTERS, MAX_BUILT, levelById, chapterOf, ctrlOf, sigOf } from '../src/puzzles/tangle-levels.js';
import { HEAPS } from '../src/puzzles/tangle-heaps.js';
import * as PR from '../proto/tangle/rules.js';
import * as PV from '../proto/tangle/view.js';
import * as P from '../proto/tangle/levels.js';
import * as T from '../src/sim/tangle.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { EVENTS } from '../src/content/events.js';
import { orderBasePay, PAY_MINUTES } from '../src/sim/orders.js';
import { colorFamily } from '../src/sim/economy.js';
import { deltaEHex } from '../src/color.js';
import { unlockLabel } from '../src/sim/next.js';
import { currentEvent } from '../src/sim/events.js';

const NOW = Date.UTC(2026, 9, 23, 9);
const FIRST_29 = ['first', 'scraps', 'leftovers', 'plan', 'cat', 'joins', 'magic', 'pinned', 'blocking', 'snarl', 'stripes', 'festival', 'bottom',
  'thrift', 'attic', 'deep', 'small', 'swap', 'destash', 'tucked', 'pegboard', 'ring', 'studio', 'guild', 'stash', 'felted', 'moths', 'nest', 'everything'];

// --- the data and the rules -------------------------------------------------------

test('the rules, the view arithmetic and the heaps are the prototype’s, unchanged', () => {
  for (const [k, f] of Object.entries(PR)) {
    if (typeof f === 'function') assert.equal(String(R[k]), String(f), `rules ${k}`);
    else assert.deepEqual(R[k], f, `rules ${k}`);
  }
  assert.deepEqual(Object.keys(R).sort(), Object.keys(PR).sort());
  for (const [k, f] of Object.entries(PV)) assert.equal(String(V[k]), String(f), `view ${k}`);
  assert.equal(readFileSync(new URL('../src/puzzles/tangle-heaps.js', import.meta.url), 'utf8'), readFileSync(new URL('../proto/tangle/heaps.js', import.meta.url), 'utf8'),
    'tangle-heaps.js is a copy of proto/tangle/heaps.js');
});

test('109 baskets in the prototype’s order, names and chapters; the first 29 kept as they were', () => {
  assert.ok(LEVELS.length >= 100 && LEVELS.length <= 110, `${LEVELS.length} baskets`);
  assert.deepEqual(LEVEL_IDS.slice(0, 29), FIRST_29);
  assert.deepEqual(LEVEL_DEFS.map((d) => [d.id, d.name, d.intro]), P.LEVEL_DEFS.map((d) => [d.id, d.name, d.intro]));
  assert.deepEqual(LEVEL_IDS, P.LEVELS.map((L) => L.id));
  assert.deepEqual({ ...MECHANICS }, Object.fromEntries(Object.entries(P.MECHANICS).map(([k, v]) => [k, { ...v }])));
  assert.deepEqual(CHAPTERS.map((c) => ({ ...c })), P.CHAPTERS);
  assert.equal(new Set(LEVEL_IDS).size, LEVEL_IDS.length);
  // chapters of about ten, each named, covering every basket in order
  assert.equal(CHAPTERS[0].from, 0);
  CHAPTERS.forEach((c, k) => {
    const to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    assert.ok(to - c.from >= 9 && to - c.from <= 11, `${c.name}: ${to - c.from} baskets`);
    assert.ok(c.name && c.fiber);
    assert.equal(chapterOf(c.from), c);
  });
  // every mechanic has a line, and each new one arrives alone
  const firstAt = {};
  LEVELS.forEach((L, i) => { for (const m of L.mechanics) { assert.ok(MECHANICS[m], `${L.id}: ${m}`); if (!(m in firstAt)) firstAt[m] = i; } });
  assert.deepEqual(Object.keys(firstAt).sort(), Object.keys(MECHANICS).sort());
  const intros = Object.values(firstAt).sort((a, b) => a - b);
  for (let i = 1; i < intros.length; i++) assert.ok(intros[i] > intros[i - 1], 'never two new things in one basket');
  assert.ok(firstAt.rack3 >= 29, 'the travel rack is new in the later chapters');
  for (const L of LEVELS) assert.ok([3, 4, 5].includes(L.slots));
});

test('the packed geometry still hashes to every basket’s stored signature (and the prototype’s), built only when read', () => {
  const was = LEVELS.filter((L) => L.isBuilt).length;
  assert.ok(was <= MAX_BUILT);
  const L0 = levelById('ropewalk');
  assert.ok(L0 && L0.n > 0 && L0.mechanics.length && L0.stats.pulls > 0, 'light fields read without building');
  for (const L of LEVELS) {
    assert.equal(sigOf(L), L.sig, `${L.id}: geometry hash`);
    assert.equal(L.sig, HEAPS[L.id].sig);
    assert.equal(L.n, L.strands.length);
    assert.ok(LEVELS.filter((x) => x.isBuilt).length <= MAX_BUILT, 'only a few baskets stay built');
  }
  assert.equal(levelById('first').sig, P.levelById('first').sig);
  assert.equal(levelById('rainbow').sig, P.levelById('rainbow').sig);
  // a released basket builds again, the same
  const L = levelById('cat');
  const cross = L.cross.length;
  L.release();
  assert.equal(L.isBuilt, false);
  assert.equal(L.cross.length, cross);
  // the thumbnails' control points come straight from the packed data
  const c = ctrlOf('first');
  assert.equal(c.length, 6);
  assert.deepEqual(c[0].pts[0], [HEAPS.first.strands[0].p[0], HEAPS.first.strands[0].p[1]]);
});

test('stored solutions replay to a clear basket with the shipped rules (a sample; proto/test replays and re-proves all)', () => {
  const sample = ['first', 'cat', 'snarl', 'deep', 'everything', 'shearing', 'boll', 'retting', 'cocoon', 'kid', 'macrame', 'combing', 'downy', 'rainbow'];
  for (const id of sample) {
    const L = levelById(id);
    assert.ok(L, id);
    const s = R.replay(L, L.solution);
    assert.ok(R.isDone(s), `${id} clears`);
    assert.equal(s.extra, 0, `${id}: no spare slot`);
    assert.ok(s.rack.every((x) => x === null), `${id}: every spool popped`);
    assert.ok(R.unitsBalanced(L));
  }
  // the solver proves a couple quickly too
  for (const id of ['first', 'combing']) assert.ok(R.solve(levelById(id), undefined, { cap: 300000 }).ok);
});

test('difficulty: harder within each chapter, a small reset at each new chapter, the last chapters the gnarliest', () => {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rate = (i) => LEVELS[i].stats.random;
  for (let k = 3; k < CHAPTERS.length; k++) {
    const c = CHAPTERS[k], to = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].from : LEVELS.length;
    const rs = [];
    for (let i = c.from; i < to; i++) rs.push(rate(i));
    const half = Math.floor(rs.length / 2);
    assert.ok(avg(rs.slice(0, half)) > avg(rs.slice(half)), `${c.name}: gets harder`);
    assert.ok(rate(c.from) > rate(c.from - 1), `${c.name}: starts a little easier than the last chapter ended`);
    assert.ok(LEVELS[to - 1].n >= LEVELS[c.from].n || LEVELS[to - 1].slots < LEVELS[c.from].slots, `${c.name}: the finale is no smaller`);
  }
  assert.ok(LEVELS.slice(-8).every((L) => L.n >= 36 && L.stats.depth >= 5));
  assert.ok(LEVELS.at(-1).n >= 55 && LEVELS.at(-1).n <= 60);
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
function opened(n = 28, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 9500;
  assert.equal(sim.unlocks.buy(s, { id: 'tangle' }, NOW).ok, true);
  s._events = [];
  return s;
}
const solutionOf = (L) => L.solution.split(' ').map(Number);
function playAll(s, L, now = NOW) {
  let r = null;
  for (const m of solutionOf(L)) { r = T.pull(s, { strand: m }, now); assert.ok(r.ok, `${L.id} ${m}: ${r.reason}`); }
  return r;
}

test('unlock: revealed at 28 colors for 9,000 coins; nothing plays while it is closed', () => {
  const s = withColors(27);
  const u = sim.unlocks.status(s, 'tangle');
  assert.deepEqual([u.revealColors, u.cost, u.revealed], [28, 9000, false]);
  assert.equal(T.openBasket(s).reason, 'locked');
  assert.equal(T.pull(s, { strand: 0 }, NOW).reason, 'locked');
  const o = opened(28);
  assert.equal(o.coins, 500);
  assert.equal(T.unlocked(o), true);
  assert.match(unlockLabel('tangle', 9000), /^Open the Tangle Basket for 9(,000|K)$/);
});

test('pulls through the sim: reasons, undo, the spare slot once, restart; baskets open in order', () => {
  const s = opened();
  assert.deepEqual(T.openBasket(s), { ok: true, levelId: 'first' });
  const L = levelById('first');
  const sol = solutionOf(L);
  const covered = [...Array(L.n).keys()].find((i) => R.whyNot(L, R.newState(L), i)?.reason === 'covered');
  const blocked = T.pull(s, { strand: covered }, NOW);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'covered');
  assert.equal(T.pull(s, { strand: 99 }, NOW).reason, 'bad');
  const r = T.pull(s, { strand: sol[0] }, NOW);
  assert.ok(r.ok && r.events.length >= 1 && r.group.includes(sol[0]));
  assert.deepEqual(s.tangle.game.moves, [sol[0]]);
  assert.ok(T.nudge(s).ok);
  assert.equal(T.nudge(s).reason, 'nudge', 'one spare slot per basket');
  assert.equal(T.current(s).s.rack.length, 6);
  assert.ok(T.undo(s).ok && T.undo(s).ok);
  assert.equal(T.undo(s).reason, 'none');
  assert.deepEqual(T.current(s).s, R.newState(L));
  // order: basket 2 waits for basket 1
  assert.equal(T.isOpen(s, 1), false);
  assert.equal(T.startBasket(s, { levelId: 'scraps' }).reason, 'closed');
  assert.equal(T.startBasket(s, { levelId: 'nope' }).reason, 'unknown');
  T.pull(s, { strand: sol[0] }, NOW);
  assert.ok(T.restart(s).ok);
  assert.deepEqual(s.tangle.game.moves, []);
  playAll(s, L);
  assert.equal(T.isOpen(s, 1), true);
  assert.equal(T.isOpen(s, 2), false);
  assert.equal(T.maxOpen(s), 1);
  assert.equal(T.continueId(s), 'scraps');
  assert.equal(T.nextLevelId(s, 'first'), 'scraps');
  // an unfinished basket she steps away from waits for her
  assert.ok(T.startBasket(s, { levelId: 'scraps' }).ok);
  const s2 = solutionOf(levelById('scraps'));
  T.pull(s, { strand: s2[0] }, NOW);
  assert.ok(T.startBasket(s, { levelId: 'first' }).ok);
  assert.deepEqual(Object.keys(s.tangle.other), ['scraps']);
  assert.equal(T.continueId(s), 'scraps', 'Continue goes back to the unfinished one');
  const back = T.startBasket(s, { levelId: 'scraps' });
  assert.ok(back.ok && back.resumed);
  assert.deepEqual(s.tangle.game.moves, [s2[0]]);
});

test('a finished basket pays coins scaled to income and expected time, once; repeats a quarter; hooks fire', () => {
  const s = opened(28, 2);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  s._events = [];
  s.quests.daily = [{ id: 'q1', type: 'untangle-baskets', event: 'basketUntangled', target: 2, progress: 0, done: false, claimed: false }];
  T.openBasket(s);
  const L = levelById('first');
  const q = T.quote(s, 'first', NOW);
  assert.ok(Math.abs(q.coins - T.basketMinutes(L) * orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW)) < 1e-9);
  assert.equal(q.repeat, false);
  const coins0 = s.coins;
  const r = playAll(s, L);
  assert.ok(r.finished, 'the last pull finishes it');
  assert.ok(Math.abs(s.coins - coins0 - q.coins) < 1e-6, 'coins as quoted');
  assert.equal(s.tangle.done.first, 1);
  assert.equal(s.tangle.untangled, 1);
  assert.equal(s.tangle.last.levelId, 'first');
  assert.equal(s.quests.daily[0].progress, 1, "questEvent(state, 'basketUntangled', 1, {levelId})");
  assert.equal(s._events.filter((e) => e.type === 'basketUntangled').length, 1);
  const yarns = s.tangle.game.yarns;
  assert.deepEqual(r.finished.colors.sort(), [...new Set(L.colors.map((k) => yarns[k]))].sort(), 'eventPoints gets her yarn ids');
  // Undo the last pull and finish again: nothing is paid twice.
  const c1 = s.coins;
  assert.ok(T.undo(s).ok);
  const again = T.pull(s, { strand: solutionOf(L).pop() }, NOW);
  assert.ok(again.ok && !again.finished);
  assert.equal(s.coins, c1);
  assert.equal(s.tangle.done.first, 1);
  // Untangled again from the start: a quarter of the coins.
  T.startBasket(s, { levelId: 'first', fresh: true });
  const q2 = T.quote(s, 'first', NOW);
  assert.ok(q2.repeat && Math.abs(q2.coins - q.coins * T.REPEAT_SHARE) < 1e-6);
  const c2 = s.coins;
  playAll(s, L);
  assert.ok(Math.abs(s.coins - c2 - q2.coins) < 1e-6);
  assert.equal(s.tangle.done.first, 2);
  assert.equal(s.quests.daily[0].progress, 2);
});

test('event points for a finished basket whose yarn includes the event’s colors', () => {
  const W40 = Date.UTC(2026, 8, 30, 12);
  const s = opened(28, 4);
  currentEvent(s, W40);
  const ev = EVENTS.find((e) => e.id === s.event.key);
  T.openBasket(s);
  const fams = Object.values(s.tangle.game.yarns).map(colorFamily);
  assert.ok(fams.some((f) => ev.palette.includes(f)), 'her eight yarns cover the event’s families');
  const before = s.event.points;
  playAll(s, levelById('first'), W40);
  const used = levelById('first').colors.map((k) => colorFamily(s.tangle.game.yarns[k]));
  const themed = used.some((f) => ev.palette.includes(f));
  assert.equal(s.event.points - before, themed ? 20 : 0);
});

test('pay stays modest: at most 1.2 income-minutes per estimated active minute, under hand orders even at double speed', () => {
  const s = opened(30, 4);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
  sim.tick(s, NOW + 60e3);
  const minute = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
  assert.ok(minute > 0);
  for (const L of LEVELS) {
    const mins = T.estimatedSeconds(L) / 60;
    const perMin = T.quote(s, L.id, NOW).coins / minute / mins;
    assert.ok(perMin <= 1.2 + 1e-9, `${L.id}: ${perMin.toFixed(2)} income-minutes per active minute`);
    assert.ok(perMin * 2 <= PAY_MINUTES.min * 1.15, `${L.id} at double speed`);
    assert.ok(T.basketMinutes(L) >= T.MIN_MINUTES);
  }
  assert.ok(T.basketMinutes(levelById('rainbow')) > T.basketMinutes(levelById('first')) * 4, 'bigger baskets pay more');
});

test('yarns: her discovered colors, one per hue family where she can, fixed for the basket', () => {
  const s = opened(28, 5);
  const y = T.defaultYarns(s);
  const ids = T.YARN_ORDER.map((k) => y[k]);
  assert.equal(new Set(ids).size, 8, 'eight distinct colors');
  for (const id of ids) assert.ok(s.catalog.discovered[id], `${id} is one of hers`);
  for (const id of ids) assert.ok(deltaEHex(sim.economy.colorHex(id), R.HIDDEN_HEX) >= T.YARN_MIN_DE, `${id} never looks like a buried strand`);
  const fams = ids.map(colorFamily);
  const famsAvail = new Set(Object.keys(s.catalog.discovered).filter((id) => deltaEHex(sim.economy.colorHex(id), R.HIDDEN_HEX) >= T.YARN_MIN_DE && deltaEHex(sim.economy.colorHex(id), '#ECE2CC') >= T.YARN_MIN_DE).map(colorFamily)).size;
  assert.equal(new Set(fams).size, Math.min(8, famsAvail), 'distinct hue families first');
  T.openBasket(s);
  const fixed = { ...s.tangle.game.yarns };
  for (const c of CATALOG.slice(40, 60)) if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  assert.deepEqual(T.current(s).yarns, fixed, 'a new color never repaints the basket in play');
  // with few colors she still gets eight yarns (catalog colors fill in)
  const few = createInitialState(NOW, 6);
  assert.equal(new Set(Object.values(T.defaultYarns(few))).size, 8);
});

test('save round trip mid-basket: reload resumes exactly and plays on identically', () => {
  const st = opened(28, 7);
  for (const id of ['first', 'scraps', 'leftovers']) { T.startBasket(st, { levelId: id }); playAll(st, levelById(id)); }
  T.startBasket(st, { levelId: 'plan' });
  const L = levelById('plan');
  const sol = solutionOf(L);
  for (const m of sol.slice(0, 7)) assert.ok(T.pull(st, { strand: m }, NOW).ok);
  T.nudge(st);
  const back = deserialize(serialize(st, NOW), NOW + 1000);
  assert.deepEqual(back.tangle, st.tangle);
  assert.deepEqual(T.current(back).s, T.current(st).s);
  assert.equal(T.current(back).past.length, 8);
  for (const m of sol.slice(7)) assert.ok(T.pull(back, { strand: m }, NOW).ok);
  assert.ok(T.current(back).done);
  assert.equal(back.tangle.done.plan, 1);
  T.setSetting(st, { key: 'glyphs', value: true });
  T.seeIntro(st, { mechanics: ['rack'] });
  const b2 = deserialize(serialize(st, NOW), NOW);
  assert.equal(b2.tangle.settings.glyphs, true);
  assert.equal(T.glyphsOn(b2), true);
  assert.equal(b2.tangle.seenIntro.rack, true);
  assert.equal(T.setSetting(st, { key: 'nope', value: true }).ok, false);
});

test('old saves load: no tangle section, no unlock; a broken or outdated game is set aside', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.tangle;
  delete obj.state.unlocks.tangle;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.tangle, false);
  assert.deepEqual(back.tangle, T.initialTangle());
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.tangle = { settings: 'x', done: { first: 2, nope: 1 } };
  const o = deserialize(JSON.stringify(odd), NOW);
  assert.deepEqual(o.tangle.settings, { sound: true, glyphs: null });
  T.ensureTangle(o);
  assert.deepEqual(o.tangle.done, { first: 2 });
  const bad = opened();
  bad.tangle.game = { level: 'first', sig: levelById('first').sig, moves: [0, 0, 0, 0, 0], paid: false };
  T.ensureTangle(bad);
  assert.equal(bad.tangle.game, null, 'pulls that no longer replay');
  bad.tangle.game = { level: 'first', sig: 'old', moves: [], paid: false };
  T.ensureTangle(bad);
  assert.equal(bad.tangle.game, null, 'a basket that changed');
  bad.tangle.cur = 'gone';
  T.ensureTangle(bad);
  assert.equal(bad.tangle.cur, 'first');
  bad.tangle.cur = 'everything';
  T.ensureTangle(bad);
  assert.equal(bad.tangle.cur, 'first', 'a basket not open yet falls back to the furthest open one');
  assert.equal(T.current(bad), null);
  assert.deepEqual(T.openBasket(bad), { ok: true, levelId: 'first' });
});

test('Renovate closes the basket (untangled baskets and the one on the table stay); Keep the Basket holds it open', () => {
  const s = opened(30);
  T.openBasket(s);
  playAll(s, levelById('first'));
  T.startBasket(s, { levelId: 'scraps' });
  T.pull(s, { strand: solutionOf(levelById('scraps'))[0] }, NOW);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('tangle'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.tangle, false);
  assert.ok(s.renovateReopen.includes('tangle'));
  assert.equal(s.tangle.done.first, 1);
  assert.equal(s.tangle.game.moves.length, 1, 'the basket on the table waits for her');
  const k = opened(30);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-basket' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('tangle'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.tangle, true);
});

test('the summary read for the Puzzles hub', () => {
  const s = opened();
  let sum = T.summary(s);
  assert.equal(sum.open, true);
  assert.equal(sum.levelId, 'first');
  assert.equal(sum.playing, false);
  assert.equal(sum.total, LEVELS.length);
  assert.equal(sum.chapter, CHAPTERS[0].name);
  T.openBasket(s);
  T.pull(s, { strand: solutionOf(levelById('first'))[0] }, NOW);
  sum = T.summary(s);
  assert.ok(sum.playing && sum.left === levelById('first').n - 1 && sum.out.length === levelById('first').n);
});
