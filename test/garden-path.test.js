// The Garden Path: 108 numbered gardens (src/puzzles/garden-path.js) and their
// sim (src/sim/garden.js: path progress, goals, stars, pay, saves).
// Cheap checks run on every garden (generation, the greedy feasibility check
// with gates, goals and stars reachable, landmarks last, gates as asked); the
// headless autopilot runs on a sample here and on all 108 in
// `node tools/garden-path-check.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/puzzles/garden.js';
import * as P from '../src/puzzles/garden-path.js';
import * as G from '../src/sim/garden.js';
import * as sim from '../src/sim/index.js';
import { createInitialState, serialize, deserialize } from '../src/state.js';
import { CATALOG } from '../src/content/catalog.js';
import { orderBasePay } from '../src/sim/orders.js';

const NOW = Date.UTC(2026, 9, 24, 9);

function opened(lv = 10, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= 22) break;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s.coins = 6000;
  assert.equal(sim.unlocks.buy(s, { id: 'garden' }, NOW).ok, true);
  s.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; m.level = lv; });
  for (const k of Object.keys(s.stations.sources)) s.stations.sources[k].level = lv;
  s.stations.grinders.forEach((x) => { x.level = lv; });
  s.stations.vats.forEach((x) => { x.level = lv; });
  s.stations.shop.level = lv;
  sim.tick(s, NOW + 1000);
  s.coins = 0;
  s._events = [];
  return s;
}
/** Mark the first n gardens done (as if played). */
function walked(s, n) {
  for (const l of P.LEVELS.slice(0, n)) s.garden.path.done[l.id] = { stars: 1, at: NOW };
}

// --- the path's shape ---------------------------------------------------------------

test('108 gardens in nine chapters of twelve, in order, each with one goal and two extra stars', () => {
  assert.ok(P.LEVELS.length >= 100);
  assert.equal(P.LEVELS.length, 108);
  assert.equal(P.CHAPTERS.length, 9);
  for (const c of P.CHAPTERS) assert.equal(P.chapterLevels(c.id).length, 12, c.id);
  assert.equal(new Set(P.LEVELS.map((l) => l.id)).size, P.LEVELS.length);
  assert.equal(new Set(P.LEVELS.map((l) => l.seed)).size, P.LEVELS.length, 'every garden has its own fixed seed');
  P.LEVELS.forEach((l, k) => {
    assert.equal(l.n, k + 1);
    assert.equal(P.levelIndex(l.id), k);
    assert.ok(P.goalText(l.goal, l).length > 5, l.id);
    assert.equal(l.stars.length, 2, l.id);
    for (const st of l.stars) assert.ok(P.goalText(st, l), `${l.id} star`);
    if (l.stars.some((st) => st.t === 'dusk')) assert.ok(l.dusk > 0, `${l.id}: a dusk star needs a sun`);
    if (l.dusk) assert.ok(l.stars.some((st) => st.t === 'dusk'), `${l.id}: a sunny garden offers the dusk star`);
    if (l.stars.some((st) => st.t === 'cat')) assert.ok(l.cat, l.id);
    if (l.goal.t === 'float' || l.stars.some((st) => st.t === 'float')) assert.ok(l.stream, l.id);
  });
  // every kind of goal is used, many times
  const kinds = {};
  for (const l of P.LEVELS) kinds[l.goal.t] = (kinds[l.goal.t] || 0) + 1;
  for (const k of ['gather', 'jars', 'landmark', 'level', 'all']) assert.ok(kinds[k] >= 6, `${k}: ${kinds[k]}`);
  assert.ok(kinds.float >= 4, `float: ${kinds.float}`);
  assert.ok(P.LEVELS.filter((l) => l.dusk).length >= 8, 'a gentle before-dusk garden now and then');
});

test('new plants and new mechanics come one at a time, each with an intro card and a true, careful fact', () => {
  const firsts = {};
  for (const l of P.LEVELS) for (const m of P.introFor(l.id).mechanics) firsts[m] = l;
  for (const m of ['stream', 'gates', 'cat', 'goat', 'dusk', 'finds']) assert.ok(firsts[m], m);
  for (const m of ['stream', 'gates', 'cat']) {
    const l = firsts[m];
    assert.deepEqual([...P.introFor(l.id).mechanics], [m], `${m} is the only new thing in ${l.id}`);
    assert.ok(P.MECHANICS[m].text.length > 40);
  }
  // the three new mechanics arrive in three different chapters
  assert.equal(new Set(['stream', 'gates', 'cat'].map((m) => firsts[m].chapter)).size, 3);
  const plants = P.LEVELS.flatMap((l) => P.introFor(l.id).plants);
  for (const s of ['tansy', 'japIndigo', 'safflower', 'hibiscus', 'goldenrod', 'susan', 'elder', 'poke', 'frenchMarigold', 'rhubarb', 'alkanet', 'osage', 'cutch', 'crottle', 'orchil',
    'hive', 'barrow', 'bales', 'scarecrow', 'well', 'dyehouse']) {
    assert.ok(plants.includes(s), `${s} is introduced`);
    assert.ok(R.FACTS[R.SPECIES[s].fact], `${s} has a fact`);
  }
  for (const l of P.LEVELS) assert.ok(P.introFor(l.id).plants.length <= 2, `${l.id}: at most two new plants at once`);
  assert.match(R.SPECIES.poke.note, /not for eating/);
  assert.match(R.FACTS.pokeweed, /poisonous/);
  assert.match(R.FACTS.crottle + R.FACTS.orchil, /fallen|brought down/, 'lichens: gather only what has fallen');
  for (const s of ['shed', 'hive', 'barrow', 'bales', 'scarecrow', 'well', 'dyehouse']) assert.ok(R.SPECIES[s].landmark && R.SPECIES[s].the, s);
});

// --- every garden can be finished ------------------------------------------------------

test('every garden: finishable (gates included), its goal and stars reachable, landmarks last, gates as asked', () => {
  let plants = 0;
  for (const l of P.LEVELS) {
    const g = P.pathGarden(l.id);
    plants = Math.max(plants, g.plants.length);
    const fin = P.pathFinish(g);
    assert.ok(fin.ok, `${l.id}: stuck after ${fin.gathered} of ${g.plants.length}`);
    for (const [s, n] of l.mix) if (R.isBig(s)) assert.equal(g.plants.filter((p) => p.s === s).length, n, `${l.id}: ${s} placed`);
    const sc = P.score(l, g, fin.order, { sweep: 99, spindle: true, sun: true, beforeDusk: true });
    assert.ok(sc.met, `${l.id}: goal`);
    assert.equal(sc.stars, 3, `${l.id}: all stars reachable`);
    if (l.stars.some((st) => st.t === 'spindle')) assert.ok(g.finds.some((f) => f.k === 'spindle'), `${l.id}: a spindle to find`);
    for (const h of g.hedges || []) assert.equal(h.level, h.asked, `${l.id}: gate at Basket ${h.asked}`);
    // growth bands: a landmark only comes in after most of the garden
    const lm = fin.order.findIndex((i) => R.SPECIES[g.plants[i].s].landmark);
    if (lm >= 0) assert.ok(lm >= fin.order.length * 0.8, `${l.id}: landmark at ${lm} of ${fin.order.length}`);
    if (l.goal.t === 'level') assert.ok(l.goal.n <= R.levelsOf(g).length + 1, l.id);
    if (l.cat) assert.ok(g.plants.every((p) => Math.hypot(p.x - g.cat.x, p.y - g.cat.y) > 20 || p.fl), `${l.id}: the cat has a clear spot`);
  }
  // within the existing performance budget: no denser than the densest classic harvest field
  const classic = Math.max(...R.PLACES.map((p) => R.generate(p.id, R.harvestSeed(p.id), 'harvest').plants.length));
  assert.ok(plants <= classic, `densest path garden ${plants} plants, densest classic ${classic}`);
});

test('generation is pure and fixed: the same garden every time; the five places are untouched', () => {
  for (const id of ['spring-1', 'stream-5', 'indigo-12', 'dyehouse-12']) {
    const l = P.LEVEL_BY_ID[id];
    const a = R.generateFrom(P.placeOf(l), l.seed, R.MODES.path);
    const b = R.generateFrom(P.placeOf(l), l.seed, R.MODES.path);
    assert.deepEqual(a, b);
    assert.equal(P.pathGarden(id), P.pathGarden(id), 'memoized');
  }
  const g = P.pathGarden('stream-1');
  const f = g.plants.find((p) => p.fl);
  assert.ok(f, 'a stream garden has floating plants');
  const a = R.floatPos(g, f, 0), b = R.floatPos(g, f, 10);
  assert.ok(Math.abs(b.x - a.x - g.stream.v * 10) < 1e-6 || b.x < a.x, 'they drift downstream (and come round again)');
  assert.ok(Math.abs(b.y - (R.streamY(g.stream, b.x) + f.dy)) < 1e-9);
});

test('autopilot sample: each mechanic\'s garden, a sunny one and the densest are finished and their goals met', () => {
  for (const id of ['spring-1', 'stream-1', 'indigo-3', 'cottage-1', 'shore-8', 'dyehouse-12']) {
    const l = P.LEVEL_BY_ID[id];
    const run = P.autoplay(l, { maxT: 600 });
    assert.ok(run.done, `${id}: autopilot finished (${run.got.length})`);
    assert.ok(run.goalAt !== null, `${id}: goal met`);
    if (l.dusk) assert.ok(run.goalAt <= l.dusk * 0.4, `${id}: the sunny goal at ${run.goalAt.toFixed(0)} s of ${l.dusk} s`);
  }
});

test('gates: a hedge stops the basket until its gate opens, and only the gateway lets it through', () => {
  const g = P.pathGarden('indigo-1');
  const h = g.hedges[0];
  const below = h.y + 30, above = h.y - 30;
  assert.ok(P.hedgeStep(g, h.x, below, h.x, above, 0).blocked, 'closed');
  assert.ok(P.hedgeStep(g, h.x + h.gap * 3, below, h.x + h.gap * 3, above, h.mass).blocked, 'open, but not at the gateway');
  const through = P.hedgeStep(g, h.x, below, h.x, above, h.mass);
  assert.ok(!through.blocked && through.y === above, 'through the open gate');
  const behind = g.plants.find((p) => p.need);
  assert.ok(behind && behind.y < h.y);
  let v = { got: [], mass: h.mass - 1 };
  assert.equal(R.gather(g, v, behind.id, 9).got.length, 0, 'behind a closed gate');
  v = { got: [], mass: Math.max(h.mass, R.massToFit(g, behind.r)) };
  assert.equal(R.gather(g, v, behind.id).got.length, 1);
  // the cat
  const c = P.pathGarden('cottage-1');
  assert.ok(P.catWakes(c.cat, c.cat.x + 5, c.cat.y, R.R0));
  assert.ok(!P.catWakes(c.cat, c.cat.x + 80, c.cat.y, R.R0));
  const spot = P.catNextSpot(c, c.cat.x, c.cat.y);
  assert.ok(Math.hypot(spot.x - c.cat.x, spot.y - c.cat.y) > 100, 'it pads off somewhere quieter');
});

// --- the sim ----------------------------------------------------------------------------

test('path progress: gardens open in order; the goal met opens the next at once; stars never block', () => {
  const s = opened(10);
  const l1 = P.LEVELS[0], l2 = P.LEVELS[1];
  assert.equal(G.pathOpen(s, l1.id), true);
  assert.equal(G.pathOpen(s, l2.id), false);
  assert.equal(G.finishVisit(s, { mode: 'path', levelId: l2.id, got: [] }, NOW).reason, 'locked');
  assert.equal(G.saveVisit(s, { mode: 'path', place: l2.id, seed: l2.seed, got: [] }).ok, false);
  const g = P.pathGarden(l1.id);
  const fin = P.pathFinish(g).order;
  // just short of the goal: nothing recorded
  const want = g.plants.map((p, i) => i).filter((i) => g.plants[i].s === l1.goal.s);
  const some = fin.filter((i) => !want.includes(i)).slice(0, 30).concat(want.slice(0, l1.goal.n - 1));
  assert.equal(G.reachGoal(s, { levelId: l1.id, got: some }, NOW).met, false);
  assert.equal(G.pathOpen(s, l2.id), false);
  // the goal met mid-visit: done, the next garden open, nothing paid yet
  const got = some.concat(want.slice(l1.goal.n - 1, l1.goal.n));
  const coins0 = s.coins;
  const r = G.reachGoal(s, { levelId: l1.id, got }, NOW);
  assert.deepEqual([r.met, r.first, r.next], [true, true, l2.id]);
  assert.equal(s.coins, coins0);
  assert.equal(G.pathOpen(s, l2.id), true);
  assert.ok(s._events.some((e) => e.type === 'gardenPath'));
  assert.equal(G.reachGoal(s, { levelId: l1.id, got }, NOW).first, false, 'once');
  // banking the visit: pay like a Wander visit, the goal paying like the bonus goal, 1 star (no extras)
  const f = G.finishVisit(s, { mode: 'path', levelId: l1.id, seed: l1.seed, got, flags: {}, firstMet: true }, NOW);
  assert.ok(f.ok);
  const jars = R.tally(g, got).reduce((n, t) => n + t.units, 0) / R.JAR;
  assert.ok(Math.abs(f.coins - (jars * G.coinsPerJar(s, NOW) + G.goalCoins(s, NOW))) < 1e-6);
  assert.equal(f.path.stars, 1);
  assert.equal(f.path.first, true);
  assert.equal(s.garden.path.done[l1.id].stars, 1);
  // play it again for all three stars: the best is kept, a smaller replay never lowers it
  const all = G.finishVisit(s, { mode: 'path', levelId: l1.id, got: fin, flags: { sweep: 99 } }, NOW);
  assert.equal(all.path.stars, 3);
  assert.equal(s.garden.path.done[l1.id].stars, 3);
  G.finishVisit(s, { mode: 'path', levelId: l1.id, got: [] }, NOW);
  assert.equal(s.garden.path.done[l1.id].stars, 3);
  const sum = G.pathSummary(s);
  assert.deepEqual([sum.done, sum.total, sum.stars, sum.next], [1, 108, 3, l2.id]);
  assert.equal(G.summary(s).path.done, 1);
});

test('path stars: the cat, a sweep, the spindle and the dusk star (only with the sun, and only before dusk)', () => {
  const s = opened(10);
  walked(s, 107);
  const pick = (t) => P.LEVELS.find((l) => l.stars.some((st) => st.t === t));
  for (const t of ['cat', 'dusk', 'spindle']) {
    const l = pick(t);
    const g = P.pathGarden(l.id);
    const order = P.pathFinish(g).order;
    const base = { sweep: 99, catWoke: false, spindle: true, sun: true, beforeDusk: true };
    assert.equal(G.finishVisit(s, { mode: 'path', levelId: l.id, got: order, flags: base }, NOW).path.stars, 3, `${l.id} all`);
    const off = t === 'cat' ? { catWoke: true } : t === 'spindle' ? { spindle: false } : { sun: false };
    assert.equal(G.finishVisit(s, { mode: 'path', levelId: l.id, got: order, flags: { ...base, ...off } }, NOW).path.stars, 2, `${l.id} without ${t}`);
  }
  // a sunny garden met without the sun still counts: the next garden opens
  const d = pick('dusk');
  const t = opened(10);
  walked(t, d.n - 1);
  const r = G.finishVisit(t, { mode: 'path', levelId: d.id, got: P.pathFinish(P.pathGarden(d.id)).order, flags: {} }, NOW);
  assert.ok(r.path.met);
  assert.equal(G.pathOpen(t, P.LEVELS[d.n].id), true);
});

test('path saves: a path visit resumes; progress survives a save round trip; old saves get an empty path; junk is repaired', () => {
  const s = opened(10);
  walked(s, 3);
  const l = P.LEVELS[3];
  const got = P.pathFinish(P.pathGarden(l.id)).order.slice(0, 12);
  assert.ok(G.saveVisit(s, { mode: 'path', place: l.id, seed: l.seed, got, x: 10.4, y: 20.6, found: [], cw: true, sw: 7 }).ok);
  assert.deepEqual(G.summary(s).wandering, { placeId: l.id, plants: 12, mode: 'path' });
  G.seeIntro(s, { key: 'm:stream' });
  const back = deserialize(serialize(s, NOW), NOW + 1000);
  assert.deepEqual(back.garden.path, s.garden.path);
  assert.deepEqual(back.garden.cur, { place: l.id, mode: 'path', gen: P.PATH_GEN, seed: l.seed, got, x: 10, y: 21, found: [], cw: true, sw: 7 });
  // banking it clears the waiting visit and keeps her flags for the stars
  const f = G.finishVisit(back, { mode: 'path', levelId: l.id, got, flags: { catWoke: true } }, NOW);
  assert.ok(f.ok && back.garden.cur === null);
  // an old save (no path yet) loads with an empty path; the garden's other keys are kept
  const old = JSON.parse(serialize(opened(10), NOW));
  delete old.state.garden.path;
  old.state.garden.bests = { meadow: { jars: 4, level: 5, units: 100, plants: 80, spare: 0 } };
  old.state.garden.spindles = 2;
  const o = deserialize(JSON.stringify(old), NOW);
  G.ensureGarden(o);
  assert.deepEqual(o.garden.path, { done: {}, seen: {} });
  assert.equal(o.garden.bests.meadow.jars, 4);
  assert.equal(o.garden.spindles, 2);
  // junk
  const bad = opened(10);
  bad.garden.path = { done: { 'spring-1': { stars: 9 }, 'mars-1': { stars: 1 }, 'spring-2': 'x' }, seen: { ok: true, no: 1 } };
  bad.garden.cur = { place: 'spring-1', mode: 'path', gen: P.PATH_GEN, seed: 12345, got: [1] };
  G.ensureGarden(bad);
  assert.deepEqual(bad.garden.path, { done: { 'spring-1': { stars: 3, at: 0 } }, seen: { ok: true } });
  assert.equal(bad.garden.cur, null, 'a path visit with the wrong seed is not resumed');
});

test('modest pay: a path garden pays like a Wander visit, under hand orders per active minute', () => {
  for (const lv of [10, 25]) {
    const s = opened(lv);
    walked(s, 108);
    const unit = orderBasePay(s, 1) * sim.incomeMultiplier(s, NOW);
    for (const id of ['spring-6', 'shore-12', 'indigo-12', 'dyehouse-12']) {
      const l = P.LEVEL_BY_ID[id];
      const run = P.autoplay(l, { maxT: 600 });
      const t = JSON.parse(JSON.stringify(s));
      t._events = [];
      const r = G.finishVisit(t, { mode: 'path', levelId: id, got: run.got, flags: { sweep: run.sweep } }, NOW);
      const value = r.coins + r.stock.reduce((n, e) => n + e.added * sim.colorPrice(t, e.colorId), 0);
      const botMin = Math.max(run.secs, 1) / 60;
      assert.ok(value / botMin < 3 * unit * 2, `lv${lv} ${id}: ideal ${(value / botMin / unit).toFixed(2)} order-minutes a minute`);
      assert.ok(value / (botMin * 3) < 3 * unit, `lv${lv} ${id}: her pace ${(value / botMin / 3 / unit).toFixed(2)}`);
    }
  }
});
