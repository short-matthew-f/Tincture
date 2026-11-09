// Playtest (Candace): "I can't complete quests because I can't make the colors
// being requested; quests and games don't know what is in stock; when I make new
// colors I can't get requests that line up with what I need."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { CATALOG, getColor } from '../src/content/catalog.js';
import { mulberry32 } from '../src/rng.js';

const NOW = Date.UTC(2026, 9, 5, 9);

function weeklyBlues(s, n = 5, progress = 0) {
  s.quests = s.quests || {};
  s.quests.weekly = {
    id: 'blue-hour', weekKey: '2026-W41', done: false, claimed: false, reward: { seals: 150, rare: 'wild' },
    steps: [
      { event: 'colorDiscovered', n, text: `Discover ${n} new blues`, family: 'blue', progress, done: false },
      { event: 'boardSolved', n: 2, text: 'Solve 2 grading boards', progress: 0, done: false },
    ],
  };
  s.quests.weeklyKey = '2026-W41';
}

function findAllBlues(s, keep = 0) {
  const blues = sim.needs.findableInFamily(s, 'blue').map((f) => f.id);
  for (const id of blues.slice(keep)) sim.discover(s, { colorId: id, method: 'debug' }, NOW);
  return blues.slice(0, keep);
}

test('findable blues leave out commission signature colors and limited event colors', () => {
  const s = createInitialState(NOW, 1);
  const ids = sim.needs.findableInFamily(s, 'blue').map((f) => f.id);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const c = getColor(id);
    if (!c) continue; // an event-page color has no catalog entry
    assert.notEqual(c.foundBy, 'commission', id);
    assert.notEqual(c.foundBy, 'event', id);
  }
  const signature = CATALOG.filter((c) => c.foundBy === 'commission' && c.family === 'blue').map((c) => c.id);
  assert.ok(signature.length, 'the catalog has blue signature colors');
  for (const id of signature) assert.ok(!ids.includes(id), `${id} is not something she can find by looking`);
});

test('a weekly "Discover 5 new blues" with one blue left to find asks only for what is left', () => {
  const s = createInitialState(NOW, 1);
  findAllBlues(s, 1);
  weeklyBlues(s, 5, 1);
  assert.equal(sim.quests.reviewWeekly(s), true);
  const st = s.quests.weekly.steps[0];
  assert.equal(st.n, 2);
  assert.equal(st.text, 'Discover 2 new blues');
  assert.equal(st.done, false);
  // Finding that last blue finishes it.
  sim.discover(s, { colorId: sim.needs.findableInFamily(s, 'blue')[0].id, method: 'debug' }, NOW);
  assert.equal(s.quests.weekly.steps[0].done, true);
});

test('a weekly family step with nothing left to find becomes a stand-in she can do', () => {
  const s = createInitialState(NOW, 1);
  findAllBlues(s, 0);
  weeklyBlues(s, 3, 0);
  sim.quests.reviewWeekly(s);
  const st = s.quests.weekly.steps[0];
  assert.notEqual(st.event, 'colorDiscovered');
  assert.equal(st.standIn, true);
  assert.equal(st.family, undefined);
});

test('a fresh weekly roll never asks for more of a family than she can find', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const s = createInitialState(NOW, seed);
    findAllBlues(s, 2);
    s.quests.weeklyKey = null;
    // Week 41 is the blue week in the rotation.
    sim.quests.rollWeekly(s, Date.UTC(2026, 9, 6, 9));
    for (const st of s.quests.weekly.steps) {
      if (st.event === 'colorDiscovered' && st.family) {
        assert.ok(sim.needs.findableInFamily(s, st.family).length >= st.n, `seed ${seed}: ${st.text}`);
      }
    }
  }
});

test('while a weekly step wants blues, new orders often ask for a blue she has not found', () => {
  const s = createInitialState(NOW, 3);
  weeklyBlues(s, 5, 0);
  const wanted = sim.needs.wantedColors(s, { via: 'order' });
  assert.ok(wanted.length, 'some blues can be found by matching an order');
  const rng = mulberry32(7);
  let hits = 0;
  for (let k = 0; k < 200; k++) {
    s.orders.open = [];
    const o = sim.orders.generateOrder(s, rng, NOW);
    if (o.colorId && wanted.includes(o.colorId)) hits++;
  }
  assert.ok(hits >= 40, `${hits} of 200 orders ask for a wanted blue`);
});

test('only one order for a needed color waits on the board at a time', () => {
  const s = createInitialState(NOW, 3);
  weeklyBlues(s, 5, 0);
  const wanted = sim.needs.wantedColors(s, { via: 'order' });
  s.orders.open = [{ id: 'x', kind: 'match', target: getColor(wanted[0]).hex, recipe: getColor(wanted[0]).recipe, colorId: wanted[0], customer: 'Ada' }];
  assert.equal(sim.orders.leanRecipes(s, sim.orders.orderCatalogRecipes(s), () => 0), null);
});

test('a solved grading board reveals a blue while the weekly step wants one', () => {
  const s = createInitialState(NOW, 2);
  weeklyBlues(s, 5, 0);
  const tints = sim.needs.steerTints(s, ['#808080'], () => 0);
  const r = sim.discovery.tryDiscover(s, { hex: tints[0], method: 'grade' }, NOW);
  assert.ok(r, 'the steered tint is a real discovery');
  assert.equal(sim.commissions.stepAccepts({ family: 'blue', jars: 1 }, r.colorId), true);
  assert.equal(s.quests.weekly.steps[0].progress, 1);
  // With no goal wanting a color, the board's own tints are untouched.
  const t = createInitialState(NOW, 2);
  assert.deepEqual(sim.needs.steerTints(t, ['#808080'], () => 0), ['#808080']);
});

test('a commission step is not offered on a jar or two of a color she cannot make more of', () => {
  const s = createInitialState(NOW, 1);
  s.phase = 3;
  s.unlocks.commissions = true;
  sim.discover(s, { colorId: 'clay', method: 'debug' }, NOW);
  assert.equal(sim.factory.canMix(s, 'clay'), false);
  const feasible = (jars) => {
    s.stock = { clay: { jars, purity: { muddy: 0, standard: jars, pure: 0, flawless: 0 } } };
    return sim.commissions.commissionFeasible(s, 'potters-glaze');
  };
  assert.equal(feasible(1), false, 'one jar does not cover a 30-jar umber step');
  assert.equal(feasible(29), false);
  assert.equal(feasible(30), true, 'thirty jars on hand do');
});
