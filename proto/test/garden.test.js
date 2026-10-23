import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACES, SPECIES, DYES, FACTS, R0, OPENING, JAR, generate, greedyFinish, newVisit, gather, isDone, restoreVisit,
  basketRadius, fits, massToFit, nearestGatherable, nextUp, startCoverage, tally, unitsOf, jarsLabel, pickFact,
  buildGrid, queryGrid, mulberry32, placeDyes,
} from '../garden/rules.js';

const SEEDS = [1, 2, 3, 42, 1234, 99999];

test('generation is deterministic for a seed, and differs between seeds', () => {
  for (const p of PLACES) {
    assert.deepEqual(generate(p.id, 7), generate(p.id, 7));
    assert.notDeepEqual(generate(p.id, 7).plants, generate(p.id, 8).plants);
  }
});

test('the rules never use Math.random', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used in rules'); };
  try { for (const p of PLACES) generate(p.id, 5); } finally { Math.random = orig; }
});

test('gardens are well formed: inside the field, ids are indices, at most ~250 plants', () => {
  for (const p of PLACES) for (const seed of SEEDS) {
    const g = generate(p.id, seed);
    assert.ok(g.plants.length >= 120 && g.plants.length <= 260, `${p.id} has ${g.plants.length}`);
    g.plants.forEach((q, i) => {
      assert.equal(q.id, i);
      assert.ok(SPECIES[q.s], q.s);
      assert.ok(q.x - q.r >= 0 && q.x + q.r <= g.W && q.y - q.r >= 0 && q.y + q.r <= g.H, `${p.id} plant ${i} inside`);
    });
    for (let i = 1; i < g.plants.length; i++) assert.ok(g.plants[i].y >= g.plants[i - 1].y, 'sorted back to front');
    assert.equal(g.plants.filter((q) => SPECIES[q.s].grand).length, p.mix.find(([s]) => SPECIES[s].grand)[1]);
  }
});

test('every place finishes in growth order: greedy smallest-first gathers it all', () => {
  for (const p of PLACES) for (const seed of SEEDS) {
    const g = generate(p.id, seed);
    const res = greedyFinish(g);
    assert.ok(res.ok, `${p.id} seed ${seed} stuck after ${res.gathered}`);
    // and playing it through the visit API agrees
    let v = newVisit();
    for (const i of res.order) {
      assert.ok(fits(g, g.plants[i], v.mass));
      v = gather(g, v, i);
    }
    assert.ok(isDone(g, v));
  }
});

test('never a dead state: while plants remain, something fits (in any gathering order)', () => {
  const rnd = mulberry32(3);
  for (const p of PLACES) {
    const g = generate(p.id, 11);
    let v = newVisit();
    while (!isDone(g, v)) {
      const have = new Set(v.got);
      const ok = g.plants.map((q, i) => i).filter((i) => !have.has(i) && fits(g, g.plants[i], v.mass));
      assert.ok(ok.length > 0, `${p.id}: nothing fits with ${v.got.length} gathered`);
      v = gather(g, v, ok[Math.floor(rnd() * ok.length)]); // a random fitting plant, not the smallest
    }
  }
});

test('something is always within reach at the start, and the start is ringed by small plants', () => {
  for (const p of PLACES) for (const seed of SEEDS.slice(0, 3)) {
    const g = generate(p.id, seed);
    assert.ok(startCoverage(g, 50) <= 240, `${p.id} coverage ${startCoverage(g, 50)}`);
    const v = newVisit();
    const i = nearestGatherable(g, v, g.start.x, g.start.y);
    assert.ok(i >= 0);
    assert.ok(Math.hypot(g.plants[i].x - g.start.x, g.plants[i].y - g.start.y) < 60);
  }
});

test('a nearest-first walk always has a next plant, and every step is a short-ish trip', () => {
  for (const p of PLACES) {
    const g = generate(p.id, 2);
    let v = newVisit(), x = g.start.x, y = g.start.y, far = 0;
    while (!isDone(g, v)) {
      const i = nearestGatherable(g, v, x, y);
      assert.ok(i >= 0);
      far = Math.max(far, Math.hypot(g.plants[i].x - x, g.plants[i].y - y));
      x = g.plants[i].x; y = g.plants[i].y;
      v = gather(g, v, i);
    }
    assert.ok(far < Math.max(g.W, g.H), `${p.id} longest trip ${far}`);
  }
});

test('growth curve: starts small, grows monotonically, grand plants fit only near the end', () => {
  for (const p of PLACES) for (const seed of SEEDS) {
    const g = generate(p.id, seed);
    assert.equal(basketRadius(g, 0), R0);
    // at the start, only the smallest tier fits
    for (const q of g.plants) assert.equal(fits(g, q, 0), q.r < 8, `${p.id} ${q.s}`);
    const res = greedyFinish(g);
    let v = newVisit(), prev = basketRadius(g, 0), grandAt = -1;
    res.order.forEach((i, k) => {
      v = gather(g, v, i);
      const r = basketRadius(g, v.mass);
      assert.ok(r > prev);
      prev = r;
      if (grandAt < 0 && g.plants.some((q) => SPECIES[q.s].grand && fits(g, q, v.mass))) grandAt = k + 1;
    });
    const frac = grandAt / g.plants.length;
    assert.ok(frac > 0.7 && frac < 0.97, `${p.id} seed ${seed}: grand fits at ${(frac * 100).toFixed(0)}%`);
    // the final basket is several times the starting one
    assert.ok(prev / R0 > 5 && prev / R0 < 8, `${p.id} grows ${prev / R0}`);
  }
});

test('gather: only fitting, not-yet-gathered plants; mass adds the plant radius', () => {
  const g = generate('meadow', 3);
  const big = g.plants.findIndex((q) => SPECIES[q.s].grand);
  const v0 = newVisit();
  assert.equal(gather(g, v0, big), v0);
  const small = g.plants.findIndex((q) => fits(g, q, 0));
  const v1 = gather(g, v0, small);
  assert.deepEqual(v1.got, [small]);
  assert.equal(v1.mass, g.plants[small].r);
  assert.equal(gather(g, v1, small), v1);
  assert.deepEqual(v0.got, [], 'pure: the old visit is unchanged');
  const need = massToFit(g, g.plants[big].r);
  assert.ok(fits(g, g.plants[big], need + 1e-9) && !fits(g, g.plants[big], need * 0.99));
});

test('restoreVisit replays saved ids and drops junk', () => {
  const g = generate('forest', 4);
  const res = greedyFinish(g);
  const ids = res.order.slice(0, 60);
  const v = restoreVisit(g, [...ids].reverse().concat([9999, -1]));
  assert.equal(v.got.length, 60);
  assert.ok(Math.abs(v.mass - ids.reduce((s, i) => s + g.plants[i].r, 0)) < 1e-9);
});

test('haul tally: units and plants add up per dye, sorted most first', () => {
  const g = generate('hillside', 5);
  const ids = greedyFinish(g).order.slice(0, 120);
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
  assert.equal(t.reduce((s, r) => s + r.plants, 0), 120);
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
});

test('facts: one for every species, about something she gathered', () => {
  for (const s of Object.values(SPECIES)) assert.ok(FACTS[s.fact], s.name);
  const g = generate('cactus', 6);
  const ids = greedyFinish(g).order;
  const f = pickFact(g, ids, 0);
  assert.equal(f.key, 'cochineal', 'the biggest find leads');
  const keys = new Set(ids.map((i) => SPECIES[g.plants[i].s].fact));
  for (let n = 0; n < 5; n++) assert.ok(keys.has(pickFact(g, ids, n).key));
  assert.ok(pickFact(g, [], 0).text.length > 20, 'a fact even with an empty basket');
});

test('nextUp names the next size to fit and tracks progress', () => {
  const g = generate('meadow', 8);
  let v = newVisit();
  const first = nextUp(g, v);
  assert.ok(first && !fits(g, { r: Math.min(...g.plants.filter((q) => q.s === first.species).map((q) => q.r)) }, 0));
  assert.equal(first.progress, 0);
  for (const i of greedyFinish(g).order) v = gather(g, v, i);
  assert.equal(nextUp(g, v), null);
});

test('spatial grid returns every plant near a point', () => {
  const g = generate('shore', 9);
  const grid = buildGrid(g.plants, g.W, g.H, 64);
  const x = 400, y = 600, r = 50;
  const got = new Set(queryGrid(grid, x - r - 64, y - r - 64, x + r + 64, y + r + 64));
  for (const q of g.plants) if (Math.hypot(q.x - x, q.y - y) <= r) assert.ok(got.has(q.id));
});

test('OPENING and R0 keep the first tier, and only it, gatherable', () => {
  const smallest = Math.min(...Object.values(SPECIES).map((s) => s.r));
  assert.ok(smallest * 1.05 <= OPENING * R0);
});
