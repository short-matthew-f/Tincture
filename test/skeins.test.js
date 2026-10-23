// The Winding Room (Skein Stacks): the rules (ported from proto/test/skeins.test.js,
// against src/puzzles/skeins.js), the sim (unlock, yarns, levels, coins, hooks,
// undo never paying twice), the save round trip mid-level, old saves, Renovate,
// and the balance check against hand orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, COLORS, HANK, geometry, board, resolve, topRun, newLevel, place, clearPeg, swapTray,
  situation, emptyPegs, goalMet, botPlay, newSession, sessionPlace, sessionUndo, sessionClear, sessionSwap,
  genStack, hankName, levelTitle, isValidLevel, bestPlacement, botClearChoice,
} from '../src/puzzles/skeins.js';
import * as K from '../src/sim/skeins.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize, SAVE_VERSION } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { colorFamily } from '../src/sim/economy.js';
import { orderBasePay } from '../src/sim/orders.js';

const NOW = Date.UTC(2026, 9, 23, 9);

// --- rules (ported from the prototype's tests) ----------------------------------

// A straight row of 5 pegs: 0-1-2-3-4. Two rows: 0..3 on top, 4..7 below (odd row shifted right).
const ROW = geometry(['.....']);
const TWO = geometry(['....', '....']);

test('rules: odd-r neighbors and knots; every level 19-30 pegs, symmetric', () => {
  assert.deepEqual(ROW.nbr[2], [1, 3]);
  assert.deepEqual(TWO.nbr[1], [0, 2, 4, 5]);
  assert.deepEqual(TWO.nbr[4], [0, 1, 5]);
  const k = geometry(['...'], [[1, 0]]);
  assert.equal(k.cells[1].knot, true);
  assert.deepEqual(k.nbr[0], []);
  for (let li = 0; li < LEVELS.length; li++) {
    const b = board(li);
    const pegs = b.cells.filter((c) => !c.knot).length;
    assert.ok(pegs >= 19 && pegs <= 30, `${LEVELS[li].id} has ${pegs} pegs`);
    b.nbr.forEach((ns, i) => ns.forEach((j) => assert.ok(b.nbr[j].includes(i))));
  }
});

test('rules: 12 levels, colors rise 3 -> 6, goals rise; names in her colors', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(LEVELS[0].colors, 3);
  assert.equal(LEVELS[11].colors, 6);
  for (let i = 1; i < 12; i++) {
    assert.ok(LEVELS[i].colors >= LEVELS[i - 1].colors);
    assert.ok(LEVELS[i].goal.hanks >= LEVELS[i - 1].goal.hanks);
  }
  assert.equal(hankName(0), 'Madder red hank');
  assert.ok(COLORS.length >= 6);
  assert.equal(levelTitle(2), 'Walnut joins', 'the prototype name without her names');
  assert.equal(levelTitle(2, (c) => `C${c}`), 'C3 joins');
  assert.equal(levelTitle(6, (c) => `C${c}`), 'C4 for a shawl');
  assert.equal(levelTitle(0, (c) => `C${c}`), 'First skeins');
});

test('rules: the merge rule (pulls onto the longer run, ties, paths farthest first, cascades)', () => {
  let r = resolve([[], [1, 0, 0, 0], [0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r.stacks, [[], [1, 0, 0, 0, 0], [], [], []]);
  assert.deepEqual(r.steps, [{ type: 'move', from: 2, to: 1, color: 0, n: 1 }]);
  r = resolve([[0, 0], [1, 0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[0], [0, 0, 0, 0]);
  r = resolve([[0, 0], [0, 0], [], [], []], ROW.nbr, [1]);
  assert.deepEqual(r.stacks[1], [0, 0, 0, 0]);
  r = resolve([[0], [2, 0], [0, 0, 0], [], []], ROW.nbr, [0]);
  assert.deepEqual(r.steps.slice(0, 2), [{ type: 'move', from: 0, to: 1, color: 0, n: 1 }, { type: 'move', from: 1, to: 2, color: 0, n: 2 }]);
  r = resolve([[], [0, 0, 0], [2, 0], [2, 2], []], ROW.nbr, [2]);
  assert.deepEqual(r.stacks, [[], [0, 0, 0, 0], [], [2, 2, 2], []]);
});

test('rules: a top run of 10 lifts off as a hank and the color under it cascades', () => {
  const r = resolve([[2, 2], [2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.deepEqual(r.hanks, [0]);
  assert.deepEqual(r.steps, [
    { type: 'move', from: 2, to: 1, color: 0, n: 3 },
    { type: 'bundle', cell: 1, color: 0, n: 10 },
    { type: 'move', from: 1, to: 0, color: 2, n: 1 },
  ]);
  const r9 = resolve([[], [0, 0, 0, 0, 0, 0], [0, 0, 0], [], []], ROW.nbr, [2]);
  assert.equal(r9.hanks.length, 0);
  assert.equal(topRun(r9.stacks[1]), 9);
  assert.equal(HANK, 10);
});

test('rules: place validation, refill after 3, goal, determinism, undo round trip, nudges', () => {
  let s = newLevel(0, 42);
  assert.equal(place(s, 0, 999).ok, false);
  const e = emptyPegs(s);
  let r = place(s, 0, e[0]);
  assert.ok(r.ok);
  assert.equal(place(r.state, 0, e[1]).ok, false, 'tray slot 0 is used');
  s = place(r.state, 1, emptyPegs(r.state)[5]).state;
  r = place(s, 2, emptyPegs(s)[9]);
  assert.ok(r.refilled);
  const g = newLevel(0, 1);
  g.hanks = [0, 1, 2, 0, 1];
  const a = emptyPegs(g)[0];
  g.stacks[board(0).nbr[a][0]] = [0, 0, 0, 0, 0, 0, 0, 0];
  g.tray[0] = [0, 0];
  const done = place(g, 0, a);
  assert.ok(goalMet(done.state) && done.state.done);
  assert.deepEqual(newLevel(3, 99), newLevel(3, 99));
  assert.deepEqual(botPlay(5, 1234).state, botPlay(5, 1234).state);
  const t = newLevel(11, 5);
  for (let i = 0; i < 100; i++) { const x = genStack(t, 11); assert.ok(x.length >= 2 && x.length <= 6 && x.every((c) => c >= 0 && c < 6)); }
  let sess = newSession(1, 7);
  const snaps = [sess.state];
  for (let i = 0; i < 4; i++) { sess = sessionPlace(sess, sess.state.tray.findIndex(Boolean), emptyPegs(sess.state)[i % 3]).session; snaps.push(sess.state); }
  sess = sessionSwap(sess).session;
  for (let i = snaps.length - 1; i >= 0; i--) { sess = sessionUndo(sess).session; assert.deepEqual(sess.state, snaps[i]); }
  assert.deepEqual(sess.stats, { moves: 4, undos: 5, clears: 0, swaps: 1 });
  const full = newLevel(0, 3);
  board(0).cells.forEach((c, i) => { full.stacks[i] = [0, 10 + i]; });
  assert.equal(situation(full), 'stuck');
  const c = clearPeg(full, 4);
  assert.ok(c.ok && c.state.aside === 2);
  assert.ok(swapTray(full).ok);
  assert.equal(sessionClear({ ...newSession(0, 3), state: full }, 4).session.stats.clears, 1);
});

test('rules: the greedy bot finishes every level with few nudges', () => {
  for (let li = 0; li < LEVELS.length; li++) {
    for (const seed of [11, 3333]) {
      const r = botPlay(li, seed);
      assert.ok(r.done, `${LEVELS[li].id} finishes`);
      assert.ok(r.nudges <= (li < 4 ? 0 : li < 8 ? 2 : 10), `${LEVELS[li].id}: ${r.nudges} nudges`);
    }
  }
});

test('isValidLevel: a level that no longer fits its board is refused', () => {
  const s = newLevel(4, 9);
  assert.equal(isValidLevel(s), true);
  assert.equal(isValidLevel({ ...s, stacks: s.stacks.slice(1) }), false);
  const knot = board(4).cells.findIndex((c) => c.knot);
  assert.equal(isValidLevel({ ...s, stacks: s.stacks.map((x, i) => (i === knot ? [] : x)) }), false);
  assert.equal(isValidLevel({ ...s, tray: [[9, 9], null, null] }), false, 'a color out of range');
  assert.equal(isValidLevel({ ...s, v: 2 }), false);
  assert.equal(isValidLevel(null), false);
});

// --- the sim ---------------------------------------------------------------------

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s._events = [];
  return s;
}
function opened(n = 12, seed = 1) {
  const s = withColors(n, seed);
  s.coins = 2000;
  assert.equal(sim.unlocks.buy(s, { id: 'skeins' }, NOW).ok, true);
  s._events = [];
  return s;
}
/** The prototype's greedy bot, through the sim (a nudge when the board is full). */
function botStep(s) {
  const lv = s.skeins.sess.state;
  const m = bestPlacement(lv);
  if (m.t < 0) return K.clearPeg(s, { cell: botClearChoice(lv) });
  return K.place(s, { t: m.t, cell: m.cell }, NOW);
}
function playLevel(s, max = 600) {
  for (let i = 0; i < max && !s.skeins.sess.state.done; i++) assert.ok(botStep(s).ok);
  assert.ok(s.skeins.sess.state.done, 'the level finishes');
}

test('unlock: 12 colors, 1,500 coins; play needs it; Next names it', () => {
  const s = withColors(11);
  s.coins = 2000;
  const st = sim.unlocks.status(s, 'skeins');
  assert.deepEqual([st.cost, st.revealColors, st.revealed, st.name], [1500, 12, false, 'Winding Room']);
  assert.equal(K.startLevel(s, {}, NOW).reason, 'locked');
  const t = withColors(12);
  t.coins = 1500;
  t.unlocks.shelf = true;
  t.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'ochre'][i % 2]; });
  assert.match(sim.next(t, NOW).label, /^Open the Winding Room for 1(,500|\.5K)$/);
  assert.equal(sim.unlocks.buy(t, { id: 'skeins' }, NOW).ok, true);
  assert.equal(t.coins, 0);
  assert.equal(K.unlocked(t), true);
  assert.ok(K.ensureLevel(t, {}, NOW).ok);
  assert.equal(t.skeins.sess.state.level, 0);
});

test('yarns: six distinct discovered colors, one per hue family while she has them; slot 0 is her red', () => {
  const s = opened(12);
  const y = K.defaultYarns(s);
  assert.equal(y.length, 6);
  assert.equal(new Set(y).size, 6);
  assert.ok(y.every((id) => s.catalog.discovered[id]));
  const fams = new Set(Object.keys(s.catalog.discovered).map(colorFamily));
  assert.equal(new Set(y.map(colorFamily)).size, Math.min(6, fams.size));
  assert.equal(colorFamily(y[0]), 'red');
  K.ensureLevel(s, {}, NOW);
  assert.deepEqual(s.skeins.sess.state.colors, y);
  // Three colors only: the default never breaks (catalog colors fill in).
  assert.equal(new Set(K.defaultYarns(createInitialState(NOW, 1))).size, 6);
});

test('a whole level through the sim: hanks pay coins, hooks fire, the bonus once, the next level opens', () => {
  for (const seed of [1, 2]) {
    const s = opened(14, seed);
    s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
    s.quests.daily = [{ id: 'q-hank', type: 'test', event: 'hankTied', target: 4, progress: 0, done: false, claimed: false, reward: { seals: 1 } }];
    s.coins = 0;
    K.ensureLevel(s, {}, NOW);
    playLevel(s);
    const k = s.skeins;
    const hanks = k.sess.state.hanks.length;
    assert.ok(hanks >= LEVELS[0].goal.hanks);
    assert.ok(Math.abs(s.coins - k.sess.paid) < 1e-6, 'every coin went through pay()');
    const per = K.coinsPerHank(s, NOW);
    assert.ok(Math.abs(s.coins - (hanks * per + K.levelBonusCoins(s, NOW))) < 1e-6);
    const ev = s._events.map((e) => e.type);
    assert.equal(ev.filter((x) => x === 'hankTied').length, hanks);
    assert.equal(ev.filter((x) => x === 'skeinLevelDone').length, 1);
    const tied = s._events.filter((e) => e.type === 'hankTied').map((e) => e.payload && e.payload.colorId || e.colorId);
    assert.ok(tied.every((id) => k.sess.state.colors.includes(id)), 'hooks carry her color ids');
    assert.equal(s.quests.daily[0].progress, 4, "questEvent(state, 'hankTied') counts each hank");
    assert.equal(k.finished[0], true);
    assert.equal(k.levels, 1);
    assert.equal(k.hanks, hanks);
    assert.equal(s.lifetime.puzzles, 1);
    assert.equal(k.notes[0].finishes, 1);
    assert.ok(K.isOpen(s, 1) && !K.isOpen(s, 2));
    assert.equal(K.undo(s).ok, false, 'a finished level stays finished');
    assert.equal(K.place(s, { t: 0, cell: 0 }, NOW).ok, false);
    assert.equal(K.startLevel(s, { level: 2 }, NOW).reason, 'closed');
    assert.ok(K.startLevel(s, { level: 1, fresh: true }, NOW).ok);
    assert.equal(s.skeins.sess.state.level, 1);
    assert.equal(K.summary(s).playing, true);
  }
});

test('undo never pays a hank twice', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  let guard = 0;
  while (s.skeins.sess.state.hanks.length === 0 && guard++ < 300) botStep(s);
  const coins = s.coins;
  const hanks = s.skeins.sess.state.hanks.length;
  assert.ok(hanks > 0 && coins > 0);
  const lastMove = s.skeins.sess.past.at(-1);
  assert.ok(K.undo(s).ok);
  assert.deepEqual(s.skeins.sess.state, lastMove);
  // The same placement again ties the same hank: no coins, no event.
  s._events = [];
  for (let i = 0; i < 3 && s.skeins.sess.state.hanks.length < hanks; i++) botStep(s);
  assert.equal(s.skeins.sess.state.hanks.length >= hanks, true);
  assert.equal(s.coins, coins + (s.skeins.sess.state.hanks.length - hanks) * K.coinsPerHank(s, NOW));
  assert.ok(s._events.filter((e) => e.type === 'hankTied').length <= s.skeins.sess.state.hanks.length - hanks);
  assert.equal(s.skeins.sess.stats.undos, 1);
});

test('levels: stepping away parks a level, coming back resumes it exactly; fresh deals anew', () => {
  const s = opened(12);
  s.skeins.finished = { 0: true, 1: true };
  K.startLevel(s, { level: 1 }, NOW);
  botStep(s); botStep(s);
  const mid = JSON.stringify(s.skeins.sess.state);
  assert.ok(K.startLevel(s, { level: 0, fresh: true }, NOW).ok);
  assert.ok(s.skeins.other[1]);
  const back = K.startLevel(s, { level: 1 }, NOW);
  assert.ok(back.ok && back.resumed);
  assert.equal(JSON.stringify(s.skeins.sess.state), mid);
  assert.ok(!s.skeins.other[1]);
  assert.ok(K.startLevel(s, { level: 1, fresh: true }, NOW).ok);
  assert.equal(s.skeins.sess.state.moves, 0);
  assert.equal(K.maxOpen(s), 2);
});

test('nudges and glyphs through the sim', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  const lv = s.skeins.sess.state;
  const before = JSON.stringify(lv.tray);
  assert.ok(K.swapTray(s).ok);
  assert.notEqual(JSON.stringify(s.skeins.sess.state.tray), before);
  botStep(s);
  const cell = s.skeins.sess.state.stacks.findIndex((x) => x && x.length);
  assert.ok(K.clearPeg(s, { cell }).ok);
  assert.deepEqual(s.skeins.sess.stats, { moves: 1, undos: 0, clears: 1, swaps: 1 });
  assert.equal(K.situation(s), 'ok');
  assert.equal(K.glyphsOn(s), false);
  s.settings.colorblind = true;
  assert.equal(K.glyphsOn(s), true, 'colorblind turns the symbols on by default');
  K.setGlyphs(s, { on: false });
  assert.equal(K.glyphsOn(s), false, 'her own choice wins');
});

test('save round trip mid-level: a reload resumes exactly and deals the same stacks', () => {
  const s = opened(12);
  K.ensureLevel(s, {}, NOW);
  for (let i = 0; i < 7; i++) botStep(s);
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.skeins, s.skeins);
  K.ensureSkeins(back);
  assert.deepEqual(back.skeins, s.skeins, 'ensureSkeins keeps a good save as it is');
  for (let i = 0; i < 6; i++) { botStep(s); botStep(back); }
  assert.deepEqual(back.skeins.sess.state, s.skeins.sess.state);
  // The saved undo history is capped.
  for (let i = 0; i < 200 && !s.skeins.sess.state.done; i++) botStep(s);
  assert.ok(s.skeins.sess.past.length <= K.SAVE_HISTORY);
});

test('an older save (no skeins) loads with the Winding Room closed; a broken level is dropped', () => {
  const s = createInitialState(NOW, 4);
  const obj = JSON.parse(serialize(s));
  delete obj.state.skeins;
  delete obj.state.unlocks.skeins;
  obj.v = 3; obj.state.v = 3;
  const back = deserialize(JSON.stringify(obj), NOW);
  assert.equal(back.v, SAVE_VERSION);
  assert.equal(back.unlocks.skeins, false);
  assert.deepEqual(back.skeins, K.initialSkeins());
  const bad = opened(12);
  K.ensureLevel(bad, {}, NOW);
  bad.skeins.sess.state.stacks.pop();
  bad.skeins.other = { 3: { state: { v: 1 } } };
  K.ensureSkeins(bad);
  assert.equal(bad.skeins.sess, null);
  assert.deepEqual(bad.skeins.other, {});
  assert.ok(K.ensureLevel(bad, {}, NOW).dealt, 'a fresh level is dealt instead');
  const odd = JSON.parse(serialize(createInitialState(NOW, 4)));
  odd.state.skeins = { finished: 'x', sess: 7 };
  const o = deserialize(JSON.stringify(odd), NOW);
  K.ensureSkeins(o);
  assert.deepEqual(o.skeins.finished, {});
  assert.equal(o.skeins.sess, null);
  assert.equal(K.summary(o).hanks, 0);
});

test('Renovate closes the Winding Room (progress and the level stay); Keep the Swift holds it open', () => {
  const s = opened(30);
  K.ensureLevel(s, {}, NOW);
  playLevel(s);
  K.startLevel(s, { level: 1 }, NOW);
  botStep(s);
  const keep = JSON.stringify(s.skeins);
  s.phase = 3;
  s.runEarned = 4e8;
  assert.ok(sim.renovateCloses(s).includes('skeins'));
  assert.ok(sim.renovate(s, NOW + 60e3).ok);
  assert.equal(s.unlocks.skeins, false);
  assert.ok(s.renovateReopen.includes('skeins'));
  assert.equal(JSON.stringify(s.skeins), keep);
  const k = opened(30);
  k.heritage = 10;
  assert.ok(sim.buyHeritageNode(k, { id: 'keep-swift' }).ok);
  k.phase = 3;
  k.runEarned = 4e8;
  assert.ok(!sim.renovateCloses(k).includes('skeins'));
  sim.renovate(k, NOW + 60e3);
  assert.equal(k.unlocks.skeins, true);
});

test('balance: hand orders stay the best coins per active minute', () => {
  // A hand order pays PAY_MINUTES (2-4) minutes of income in 30-60 s: 2 to 8 (about 4)
  // income-minutes per active minute. A fast player places a stack every 3 s (the hops, chains
  // and the hank twist alone take 1-3 s); the Winding Room pays well under orders, bonus included.
  const SEC_PER_MOVE = 3;
  const rates = [];
  for (const li of [0, 5, 11]) {
    const s = opened(30, li + 1);
    s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
    for (let i = 0; i < li; i++) s.skeins.finished[i] = true;
    K.startLevel(s, { level: li, fresh: true }, NOW);
    s.coins = 0;
    playLevel(s);
    const minutes = (s.skeins.sess.stats.moves * SEC_PER_MOVE) / 60;
    const incomeMinute = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
    const rate = s.coins / incomeMinute / minutes;
    rates.push(rate);
    assert.ok(rate < 2.5, `level ${li + 1}: ${rate.toFixed(2)} income-minutes per active minute`);
    assert.ok(rate > 0.5, `level ${li + 1}: still worth a sit-down (${rate.toFixed(2)})`);
  }
  assert.ok(rates.reduce((a, b) => a + b, 0) / rates.length < 2, `on average under 2 (${rates.map((r) => r.toFixed(2))})`);
});

test('the summary read for the Puzzles hub', () => {
  const s = opened(12);
  assert.deepEqual(K.summary(s), { open: true, level: 0, playing: false, done: false, hanks: 0, goal: 6, finished: 0, hanksAll: 0, maxOpen: 0 });
  K.ensureLevel(s, {}, NOW);
  assert.equal(K.summary(s).playing, true);
});
