import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACES, SPECIES, DYES, FACTS, MODES, R0, OPENING, JAR, GOAT, FIND_KINDS, COMBO_GAP, COMBO_SPAN, TEETER,
  generate, greedyFinish, newVisit, gather, isDone, restoreVisit, basketRadius, fits, teeters, massToFit, growthOf,
  nearestGatherable, nextUp, startCoverage, tally, unitsOf, jarsLabel, pickFact, buildGrid, queryGrid, mulberry32, placeDyes,
  levelsOf, levelInfo, comboAdd, comboOpen, comboLabel, newGoat, goatStep, goatCanEat, findAt, breezeCatches,
  goalFor, goalProgress, skyAt, clockLabel, harvestScore, betterScore, harvestSeed, isBig,
} from '../garden/rules.js';

const SEEDS = [1, 2, 3, 42, 1234];
// generation is the slow part; share gardens between tests (tests never mutate them)
const memo = new Map();
const gen = (place, seed, mode = 'wander') => {
  const k = `${place}|${seed}|${mode}`;
  if (!memo.has(k)) memo.set(k, generate(place, seed, mode));
  return memo.get(k);
};
const isLand = (q) => SPECIES[q.s].landmark;
const isGrand = (q) => SPECIES[q.s].grand;

test('generation is deterministic for a seed and mode, and differs between seeds', () => {
  for (const p of PLACES) {
    assert.deepEqual(generate(p.id, 7), gen(p.id, 7));
    assert.notDeepEqual(gen(p.id, 7).plants, gen(p.id, 8).plants);
    const h = harvestSeed(p.id);
    assert.deepEqual(generate(p.id, h, 'harvest'), gen(p.id, h, 'harvest'));
  }
});

test('harvest seeds are fixed per place (fair bests), and a daily seed changes by date', () => {
  for (const p of PLACES) {
    assert.equal(harvestSeed(p.id), harvestSeed(p.id));
    assert.notEqual(harvestSeed(p.id, '2026-10-23'), harvestSeed(p.id));
    assert.notEqual(harvestSeed(p.id, '2026-10-23'), harvestSeed(p.id, '2026-10-24'));
  }
  assert.equal(new Set(PLACES.map((p) => harvestSeed(p.id))).size, PLACES.length);
});

test('the rules never use Math.random', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used in rules'); };
  try {
    for (const p of PLACES) {
      generate(p.id, 5);
      const g = gen(p.id, harvestSeed(p.id), 'harvest');
      const goat = newGoat(g), taken = new Uint8Array(g.plants.length), grid = buildGrid(g.plants, g.W, g.H, 64);
      for (let k = 0; k < 200; k++) goatStep(g, goat, taken, grid, { x: g.start.x, y: g.start.y, r: R0 });
      goalFor(g); levelsOf(g); comboLabel(comboAdd(null, 0, 'marigold'));
    }
  } finally { Math.random = orig; }
});

test('gardens are well formed and much denser than before, with landmarks, grand plants and finds', () => {
  for (const p of PLACES) for (const seed of SEEDS) {
    const g = gen(p.id, seed);
    assert.ok(g.plants.length >= 320 && g.plants.length <= 560, `${p.id} has ${g.plants.length}`);
    g.plants.forEach((q, i) => {
      assert.equal(q.id, i);
      assert.ok(SPECIES[q.s], q.s);
      assert.ok(q.x - q.r >= 0 && q.x + q.r <= g.W && q.y - q.r >= 0 && q.y + q.r <= g.H, `${p.id} plant ${i} inside`);
    });
    for (let i = 1; i < g.plants.length; i++) assert.ok(g.plants[i].y >= g.plants[i - 1].y, 'sorted back to front');
    for (const [s, n] of p.mix) if (isBig(s)) assert.equal(g.plants.filter((q) => q.s === s).length, n, `${p.id} ${s}`);
    assert.ok(g.plants.filter(isLand).length >= 2, `${p.id} has landmarks`);
    // landmarks dwarf the grand plants, which dwarf everything else
    const maxPlain = Math.max(...g.plants.filter((q) => !isBig(q.s)).map((q) => q.r));
    const minGrand = Math.min(...g.plants.filter(isGrand).map((q) => q.r));
    const maxGrand = Math.max(...g.plants.filter(isGrand).map((q) => q.r));
    assert.ok(minGrand > maxPlain && Math.min(...g.plants.filter(isLand).map((q) => q.r)) > maxGrand * 1.15);
    // swathes: most small plants have a neighbor of their own kind close by (rows and patches)
    const small = g.plants.filter((q) => q.r < 13);
    const grid = buildGrid(g.plants, g.W, g.H, 64);
    const kin = small.filter((q) => queryGrid(grid, q.x - 40, q.y - 40, q.x + 40, q.y + 40).some((j) => j !== q.id && g.plants[j].s === q.s && Math.hypot(g.plants[j].x - q.x, g.plants[j].y - q.y) < q.r * 2.6));
    assert.ok(kin.length / small.length > 0.75, `${p.id} swathes ${(kin.length / small.length).toFixed(2)}`);
    // finds: 2 brims, 2 breezes, sometimes a spindle, all inside the field
    const kinds = g.finds.map((f) => f.k).sort();
    assert.ok(kinds.filter((k) => k === 'brim').length === 2 && kinds.filter((k) => k === 'breeze').length === 2);
    assert.ok(kinds.filter((k) => k === 'spindle').length <= 1);
    for (const f of g.finds) assert.ok(FIND_KINDS[f.k] && f.x > 0 && f.x < g.W && f.y > 0 && f.y < g.H);
  }
  // a harvest field is bigger and fuller, so two minutes never runs out of things to gather
  for (const p of PLACES) {
    const g = gen(p.id, harvestSeed(p.id), 'harvest'), w = gen(p.id, 1);
    assert.ok(g.W > w.W && g.H > w.H && g.plants.length > w.plants.length * 1.25, `${p.id} harvest ${g.plants.length}`);
  }
});

test('every place finishes in Wander (and in a harvest): greedy smallest-first gathers it all', () => {
  const cases = [];
  for (const p of PLACES) { for (const seed of SEEDS) cases.push(gen(p.id, seed)); cases.push(gen(p.id, harvestSeed(p.id), 'harvest')); }
  for (const g of cases) {
    const res = greedyFinish(g);
    assert.ok(res.ok, `${g.place} ${g.mode} seed ${g.seed} stuck after ${res.gathered}`);
    let v = newVisit();
    for (const i of res.order) {
      assert.ok(fits(g, g.plants[i], v.mass));
      v = gather(g, v, i);
    }
    assert.ok(isDone(g, v));
  }
});

test('never a dead state in Wander: while plants remain, something fits (in any gathering order)', () => {
  const rnd = mulberry32(3);
  for (const p of PLACES) {
    const g = gen(p.id, 11);
    let v = newVisit();
    const have = new Uint8Array(g.plants.length);
    const order = g.plants.map((q, i) => i).sort((a, b) => g.plants[a].r - g.plants[b].r);
    while (!isDone(g, v)) {
      const lim = OPENING * basketRadius(g, v.mass);
      const ok = [];
      for (const i of order) { if (g.plants[i].r > lim) break; if (!have[i]) ok.push(i); }
      assert.ok(ok.length > 0, `${p.id}: nothing fits with ${v.got.length} gathered`);
      const i = ok[Math.floor(rnd() * ok.length)]; // a random fitting plant, not the smallest
      v = gather(g, v, i); have[i] = 1;
    }
  }
});

test('something is always within reach at the start, and the start is ringed by small plants', () => {
  for (const p of PLACES) for (const seed of SEEDS.slice(0, 2)) {
    const g = gen(p.id, seed);
    assert.ok(startCoverage(g, 50) <= 200, `${p.id} coverage ${startCoverage(g, 50)}`);
    const i = nearestGatherable(g, newVisit(), g.start.x, g.start.y);
    assert.ok(i >= 0);
    assert.ok(Math.hypot(g.plants[i].x - g.start.x, g.plants[i].y - g.start.y) < 50);
  }
});

test('growth curve: starts small, grows monotonically, grand plants late, landmarks only at the very end', () => {
  for (const p of PLACES) for (const seed of SEEDS) {
    const g = gen(p.id, seed);
    assert.equal(basketRadius(g, 0), R0);
    for (const q of g.plants) assert.equal(fits(g, q, 0), q.r < 8, `${p.id} ${q.s}`);
    const res = greedyFinish(g);
    let v = newVisit(), prev = basketRadius(g, 0), grandAt = -1, landAt = -1;
    res.order.forEach((i, k) => {
      v = gather(g, v, i);
      const r = basketRadius(g, v.mass);
      assert.ok(r > prev);
      prev = r;
      if (grandAt < 0 && g.plants.some((q) => isGrand(q) && fits(g, q, v.mass))) grandAt = k + 1;
      if (landAt < 0 && g.plants.some((q) => isLand(q) && fits(g, q, v.mass))) landAt = k + 1;
    });
    const n = g.plants.length;
    assert.ok(grandAt / n > 0.62 && grandAt / n < 0.9, `${p.id} seed ${seed}: grand fits at ${(grandAt / n * 100).toFixed(0)}%`);
    assert.ok(landAt / n >= 0.85 && landAt > grandAt, `${p.id} seed ${seed}: landmark fits at ${(landAt / n * 100).toFixed(0)}%`);
    // the last landmark is the very last thing to fit
    const lastLand = Math.max(...res.order.map((i, k) => (isLand(g.plants[i]) ? k : -1)));
    assert.equal(lastLand, n - 1);
    // a huge size range: the final basket is many times the starting one
    assert.ok(prev / R0 > 7 && prev / R0 < 9.5, `${p.id} grows ${prev / R0}`);
  }
  // in a harvest the landmarks come within reach sooner, but still only in the last stretch
  for (const p of PLACES) {
    const g = gen(p.id, harvestSeed(p.id), 'harvest');
    const res = greedyFinish(g);
    let m = 0, landAt = -1;
    for (let k = 0; k < res.order.length && landAt < 0; k++) { m += growthOf(g.plants[res.order[k]]); if (g.plants.some((q) => isLand(q) && fits(g, q, m))) landAt = k + 1; }
    const f = landAt / g.plants.length;
    assert.ok(f > 0.6 && f < 0.9, `${p.id} harvest landmark at ${(f * 100).toFixed(0)}%`);
  }
});

test('rim physics: a plant a little too big teeters; a much bigger one does not', () => {
  const g = gen('meadow', 3);
  const lim = OPENING * basketRadius(g, 0);
  assert.ok(teeters(g, { r: lim * 1.1 }, 0));
  assert.ok(!teeters(g, { r: lim * 0.9 }, 0), 'it fits, so it just drops in');
  assert.ok(!teeters(g, { r: lim * TEETER * 1.05 }, 0));
});

test('basket levels line up with the plant-size steps, and are monotone', () => {
  for (const p of PLACES) for (const mode of ['wander', 'harvest']) {
    const g = mode === 'wander' ? gen(p.id, 2) : gen(p.id, harvestSeed(p.id), 'harvest');
    const L = levelsOf(g);
    assert.ok(L.length >= 5 && L.length <= 12, `${p.id} ${L.length} steps`);
    for (let k = 1; k < L.length; k++) assert.ok(L[k].mass > L[k - 1].mass, 'thresholds rise');
    // every kind that is not in reach at the start has exactly one step
    const kinds = new Set(g.plants.filter((q) => !fits(g, q, 0)).map((q) => q.s));
    assert.deepEqual(new Set(L.flatMap((x) => x.species)), kinds);
    for (const step of L) {
      for (const s of step.species) {
        const minR = Math.min(...g.plants.filter((q) => q.s === s).map((q) => q.r));
        assert.ok(fits(g, { r: minR }, step.mass + 1e-6), `${s} fits at its step`);
      }
      // just below the step, its first kind is still out of reach: the step is when it comes in
      const s0 = step.species[0];
      const minR0 = Math.min(...g.plants.filter((q) => q.s === s0).map((q) => q.r));
      assert.ok(!fits(g, { r: minR0 }, step.mass * 0.999 - 1e-6));
    }
    // levelInfo: monotone level and progress between steps
    let prev = levelInfo(g, 0);
    assert.equal(prev.level, 1);
    assert.deepEqual(prev.next, L[0].species);
    const total = greedyFinish(g).mass;
    for (let k = 1; k <= 400; k++) {
      const m = (total * k) / 400, info = levelInfo(g, m);
      assert.ok(info.level >= prev.level && info.level <= prev.level + 3);
      if (info.level === prev.level) assert.ok(info.progress >= prev.progress - 1e-9);
      assert.ok(info.progress >= 0 && info.progress <= 1);
      prev = info;
    }
    assert.equal(prev.level, L.length + 1);
    assert.equal(prev.next, null);
    for (let k = 0; k < L.length; k++) assert.equal(levelInfo(g, L[k].mass).level, k + 2);
  }
});

test('gather: only fitting, not-yet-gathered plants; mass adds the plant growth; a wide brim lets bigger in', () => {
  const g = gen('meadow', 3);
  const big = g.plants.findIndex(isLand);
  const v0 = newVisit();
  assert.equal(gather(g, v0, big), v0);
  const small = g.plants.findIndex((q) => fits(g, q, 0));
  const v1 = gather(g, v0, small);
  assert.deepEqual(v1.got, [small]);
  assert.equal(v1.mass, growthOf(g.plants[small]));
  assert.equal(gather(g, v1, small), v1);
  assert.deepEqual(v0.got, [], 'pure: the old visit is unchanged');
  const need = massToFit(g, g.plants[big].r);
  assert.ok(fits(g, g.plants[big], need + 1e-9) && !fits(g, g.plants[big], need * 0.99));
  // the brim: a plant just too big fits with the wider opening
  const near = g.plants.findIndex((q) => !fits(g, q, 0) && fits(g, q, 0, OPENING * FIND_KINDS.brim.open));
  assert.ok(near >= 0);
  assert.equal(gather(g, v0, near).got.length, 0);
  assert.deepEqual(gather(g, v0, near, OPENING * FIND_KINDS.brim.open).got, [near]);
});

test('restoreVisit keeps saved ids in order and drops junk and repeats', () => {
  const g = gen('forest', 4);
  const ids = greedyFinish(g).order.slice(0, 60);
  const v = restoreVisit(g, [...ids, 9999, -1, 'x', 1.5, ids[0]]);
  assert.deepEqual(v.got, ids);
  assert.ok(Math.abs(v.mass - ids.reduce((s, i) => s + growthOf(g.plants[i]), 0)) < 1e-9);
  assert.deepEqual(restoreVisit(g, null), newVisit());
});

test('combos: gathers close together are one sweep, a pause or a long run starts another', () => {
  let c = null;
  for (let k = 0; k < 12; k++) c = comboAdd(c, k * 0.1, 'marigold');
  assert.equal(c.n, 12);
  assert.equal(comboLabel(c), 'A whole row of marigolds! ×12');
  assert.ok(comboOpen(c, 1.1 + COMBO_GAP * 0.9) && !comboOpen(c, 1.1 + COMBO_GAP + 0.01));
  assert.equal(comboAdd(c, 1.1 + COMBO_GAP + 0.01, 'woad').n, 1, 'a pause starts a new sweep');
  let d = null;
  for (let k = 0; k * 0.2 <= COMBO_SPAN + 0.5; k++) d = comboAdd(d, k * 0.2, 'woad');
  assert.ok(d.n < 6, 'a sweep is bounded in time');
  let e = null;
  ['chamomile', 'marigold', 'woad', 'chamomile', 'weld', 'marigold'].forEach((s, k) => { e = comboAdd(e, k * 0.1, s); });
  assert.equal(comboLabel(e), 'A lovely handful! ×6');
  assert.equal(comboLabel(comboAdd(null, 0, 'woad')), '');
  const f = comboAdd(c, 1.15, 'marigold');
  assert.equal(c.n, 12, 'pure: the old combo is unchanged');
  assert.equal(f.n, 13);
});

test('the goat: deterministic per tick, never takes landmarks or grand plants, startled by a big basket', () => {
  for (const p of PLACES) {
    const g = gen(p.id, harvestSeed(p.id), 'harvest');
    const grid = buildGrid(g.plants, g.W, g.H, 64);
    const run = () => {
      const goat = newGoat(g), taken = new Uint8Array(g.plants.length), eaten = [];
      const b = { x: g.start.x, y: g.start.y, r: R0 };
      for (let k = 0; k < 120 / GOAT.dt; k++) { const i = goatStep(g, goat, taken, grid, b); if (i >= 0) { taken[i] = 2; eaten.push(i); } }
      return { goat, eaten };
    };
    const a = run(), b = run();
    assert.deepEqual(a.eaten, b.eaten);
    assert.deepEqual(a.goat, b.goat);
    assert.ok(a.eaten.length >= 15 && a.eaten.length <= 140, `${p.id} goat ate ${a.eaten.length}`);
    for (const i of a.eaten) {
      assert.ok(goatCanEat(g.plants[i]) && !isBig(g.plants[i].s), `${p.id} goat ate ${g.plants[i].s}`);
      assert.ok(g.plants[i].r <= GOAT.eatMax);
    }
    assert.equal(a.goat.eaten, a.eaten.length);
    assert.ok(a.goat.x >= 0 && a.goat.x <= g.W && a.goat.y >= 0 && a.goat.y <= g.H);
  }
  // even parked on top of a landmark for a long time, it never eats one
  const g = gen('meadow', harvestSeed('meadow'), 'harvest');
  const grid = buildGrid(g.plants, g.W, g.H, 64);
  const lm = g.plants.find(isLand);
  const goat = newGoat(g); goat.x = lm.x; goat.y = lm.y;
  const taken = new Uint8Array(g.plants.length);
  for (const q of g.plants) if (goatCanEat(q)) taken[q.id] = 1; // nothing small left
  for (let k = 0; k < 2000; k++) assert.equal(goatStep(g, goat, taken, grid, { x: 0, y: 0, r: R0 }), -1);
  // a small basket alongside is ignored; a big basket next to it makes it hop away
  const g2 = newGoat(g), t2 = new Uint8Array(g.plants.length);
  goatStep(g, g2, t2, grid, { x: g2.x + 10, y: g2.y, r: GOAT.scareR - 1 });
  assert.notEqual(g2.state, 'hop');
  const x0 = g2.x;
  goatStep(g, g2, t2, grid, { x: g2.x + 10, y: g2.y, r: GOAT.scareR + 10 });
  assert.equal(g2.state, 'hop');
  assert.equal(g2.startled, 1);
  for (let k = 0; k < 5; k++) goatStep(g, g2, t2, grid, { x: x0 + 10, y: g2.y, r: GOAT.scareR + 10 });
  assert.ok(g2.x < x0, 'it hops away from the basket');
});

test('finds: picked up when the basket reaches them; a breeze draws in nearby fitting plants', () => {
  const g = gen('shore', 2);
  const f = g.finds[0];
  assert.equal(findAt(g, new Set(), f.x + 30, f.y, 10), -1);
  assert.equal(findAt(g, new Set(), f.x + 8, f.y, 10), 0);
  assert.equal(findAt(g, new Set([0]), f.x + 8, f.y, 10), -1);
  const small = g.plants.find((q) => fits(g, q, 0));
  assert.ok(breezeCatches(g, small, 0, small.x + R0 * 2, small.y));
  assert.ok(!breezeCatches(g, small, 0, small.x + 200, small.y));
  const big = g.plants.find(isGrand);
  assert.ok(!breezeCatches(g, big, 0, big.x, big.y), 'a breeze never carries what does not fit');
});

test('goal: a mid-size plant from this garden, counted and met', () => {
  for (const p of PLACES) {
    const g = gen(p.id, 5);
    const goal = goalFor(g);
    assert.deepEqual(goalFor(g), goal);
    const mine = g.plants.filter((q) => q.s === goal.s);
    assert.ok(goal.need >= 4 && goal.need <= 12 && mine.length >= goal.need);
    assert.ok(!isBig(goal.s) && SPECIES[goal.s].r >= 13);
    assert.match(goal.text, new RegExp(`^Gather enough for ${DYES[goal.dye].name.toLowerCase()}: ${goal.need} `));
    assert.deepEqual(goalProgress(g, goal, []), { have: 0, need: goal.need, met: false });
    const ids = mine.map((q) => q.id);
    assert.equal(goalProgress(g, goal, ids.slice(0, goal.need - 1)).met, false);
    assert.deepEqual(goalProgress(g, goal, ids.slice(0, goal.need)), { have: goal.need, need: goal.need, met: true });
    assert.equal(goalProgress(g, goal, ids).have, goal.need);
  }
});

test('the harvest clock: a sun from east to west, golden then dusky; a gentle clock line', () => {
  const a = skyAt(0), m = skyAt(0.5), e = skyAt(1);
  assert.ok(a.sx < 0.01 && Math.abs(m.sx - 0.5) < 1e-9 && e.sx > 0.99);
  assert.ok(m.sy < a.sy && m.sy < e.sy, 'highest at noon');
  assert.equal(a.phase, 'day'); assert.equal(skyAt(0.7).phase, 'golden'); assert.equal(skyAt(0.9).phase, 'evening'); assert.equal(e.phase, 'dusk');
  assert.equal(a.gold, 0); assert.ok(skyAt(0.79).gold > 0.9 && e.dusk === 1);
  assert.equal(clockLabel(120), '2:00'); assert.equal(clockLabel(59.2), '1:00'); assert.equal(clockLabel(5), '0:05'); assert.equal(clockLabel(-3), '0:00');
  assert.equal(MODES.harvest.secs, 120);
  assert.ok(!MODES.wander.timed && !MODES.wander.goat && MODES.harvest.timed && MODES.harvest.goat);
});

test('harvest score: whole jars and the final basket level; bests compare jars, then size', () => {
  const g = gen('cactus', harvestSeed('cactus'), 'harvest');
  const order = greedyFinish(g).order.slice(0, 200);
  let v = newVisit();
  for (const i of order) v = gather(g, v, i);
  const s = harvestScore(g, v.got, v.mass);
  const units = order.reduce((t, i) => t + unitsOf(g.plants[i]), 0);
  assert.equal(s.units, units);
  assert.equal(s.jars, Math.floor(units / JAR));
  assert.equal(s.plants, 200);
  assert.equal(s.level, levelInfo(g, v.mass).level);
  assert.deepEqual(harvestScore(g, [], 0), { jars: 0, units: 0, plants: 0, level: 1, spare: 0 });
  assert.equal(harvestScore(g, v.got, v.mass, 37.6).spare, 38);
  assert.ok(betterScore({ jars: 40, level: 8, units: 980, spare: 20 }, { jars: 40, level: 8, units: 980, spare: 12 }), 'a faster clear wins a tie');
  assert.ok(betterScore(s, null));
  assert.ok(betterScore({ jars: 41, level: 3, units: 990 }, { jars: 40, level: 9, units: 989 }));
  assert.ok(betterScore({ jars: 40, level: 9, units: 1 }, { jars: 40, level: 8, units: 999 }));
  assert.ok(!betterScore({ jars: 40, level: 8, units: 980 }, { jars: 40, level: 8, units: 980 }), 'a tie is not a new best');
});

test('haul tally: units and plants add up per dye, sorted most first', () => {
  const g = gen('hillside', 5);
  const ids = greedyFinish(g).order.slice(0, 160);
  const t = tally(g, ids);
  const want = {};
  for (const i of ids) {
    const d = SPECIES[g.plants[i].s].dye;
    want[d] = want[d] || { units: 0, plants: 0 };
    want[d].units += unitsOf(g.plants[i]);
    want[d].plants += 1;
  }
  assert.equal(t.length, Object.keys(want).length);
  for (const row of t) {
    assert.equal(row.units, want[row.dye].units);
    assert.equal(row.plants, want[row.dye].plants);
    assert.equal(row.jars, row.units / JAR);
    assert.equal(row.name, DYES[row.dye].name);
  }
  for (let k = 1; k < t.length; k++) assert.ok(t[k - 1].units >= t[k].units);
  assert.equal(t.reduce((s, r) => s + r.plants, 0), 160);
  assert.deepEqual(tally(g, []), []);
});

test('jar labels and names read naturally', () => {
  assert.equal(jarsLabel(3), 'a little jar');
  assert.equal(jarsLabel(20), 'most of a jar');
  assert.equal(jarsLabel(24), '1 jar');
  assert.equal(jarsLabel(36), '1½ jars');
  assert.equal(jarsLabel(72), '3 jars');
  for (const p of PLACES) for (const d of placeDyes(p.id)) assert.match(DYES[d].name, /^[A-Z][a-z' -]+ (yellow|gold|orange|rust|tan|blue|gray|pink|purple|red|brown|crimson)$/);
  assert.ok(placeDyes('meadow').includes('weld') && placeDyes('meadow').includes('madder'));
  for (const s of Object.values(SPECIES)) {
    assert.ok(s.many && s.many === s.many.toLowerCase(), s.name);
    if (s.landmark) assert.match(s.the, /^the [a-z ]+$/);
  }
});

test('facts: one for every species, about something she gathered', () => {
  for (const s of Object.values(SPECIES)) assert.ok(FACTS[s.fact], s.name);
  const g = gen('cactus', 6);
  const ids = greedyFinish(g).order;
  const f = pickFact(g, ids, 0);
  assert.equal(f.key, 'cosmos', 'the biggest find (the potting shed) leads');
  const keys = new Set(ids.map((i) => SPECIES[g.plants[i].s].fact));
  for (let n = 0; n < 5; n++) assert.ok(keys.has(pickFact(g, ids, n).key));
  assert.ok(pickFact(g, [], 0).text.length > 20, 'a fact even with an empty basket');
});

test('nextUp names the next size to fit and tracks progress', () => {
  const g = gen('meadow', 1);
  let v = newVisit();
  const first = nextUp(g, v);
  assert.ok(first && !fits(g, { r: Math.min(...g.plants.filter((q) => q.s === first.species).map((q) => q.r)) }, 0));
  assert.equal(first.progress, 0);
  for (const i of greedyFinish(g).order) v = gather(g, v, i);
  assert.equal(nextUp(g, v), null);
});

test('spatial grid returns every plant near a point', () => {
  const g = gen('shore', 1);
  const grid = buildGrid(g.plants, g.W, g.H, 64);
  const x = 400, y = 600, r = 50;
  const got = new Set(queryGrid(grid, x - r - 64, y - r - 64, x + r + 64, y + r + 64));
  for (const q of g.plants) if (Math.hypot(q.x - x, q.y - y) <= r) assert.ok(got.has(q.id));
});

test('OPENING and R0 keep the first tier, and only it, gatherable', () => {
  const smallest = Math.min(...Object.values(SPECIES).map((s) => s.r));
  assert.ok(smallest * 1.05 <= OPENING * R0);
});
