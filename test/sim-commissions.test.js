// Commissions: what counts, how she can fill each step, and that every offered
// commission can really be finished (playtest: "her blue tints don't seem to
// qualify", "the colors on her vat list don't update", "Banners seem to
// suffer the same problem").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { CATALOG } from '../src/content/catalog.js';
import { COMMISSIONS, getCommission } from '../src/content/commissions.js';

const NOW = Date.UTC(2026, 9, 5, 9);
const HOUR = 3600e3;

function workshop(ids = [], seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const id of ids) if (!s.catalog.discovered[id]) sim.discover(s, { colorId: id, method: 'debug' }, NOW);
  s.phase = 3;
  s.unlocks.commissions = true;
  s.unlocks.shelf = true;
  s._events = [];
  return s;
}

function withColors(n, seed = 1) {
  const s = createInitialState(NOW, seed);
  for (const c of CATALOG) {
    if (sim.discoveredCount(s) >= n) break;
    if (c.foundBy === 'commission' || c.tier === 'wild') continue;
    if (!s.catalog.discovered[c.id]) sim.discover(s, { colorId: c.id, method: 'debug' }, NOW);
  }
  s.phase = 3;
  s.unlocks.commissions = true;
  s.unlocks.shelf = true;
  s._events = [];
  return s;
}

function open(s, id) {
  const def = getCommission(id);
  s.commissions = { open: [{ id, started: NOW, steps: def.steps.map(() => ({ delivered: 0, colors: {}, done: false })) }], done: [] };
}

// --- Bug 1: "her blue tints don't seem to qualify" ---------------------------

test('every blue counts for a blue step: tints, shades and pale greyish blues', () => {
  const blue = { family: 'blue', jars: 2 };
  for (const id of ['woad', 'sky-blue', 'delft-blue', 'powder-blue', 'navy', 'storm-blue', 'cornflower']) {
    assert.ok(sim.commissions.stepAccepts(blue, id), `${id} counts as blue`);
  }
  // Not a blue.
  for (const id of ['madder', 'ochre', 'green', 'rose']) assert.ok(!sim.commissions.stepAccepts(blue, id), id);
});

test('a color named for a family counts for it ("Teal" is a teal, "Bottle Green" a green)', () => {
  assert.ok(sim.commissions.stepAccepts({ family: 'teal', jars: 1 }, 'teal'));
  assert.ok(sim.commissions.stepAccepts({ family: 'green', jars: 1 }, 'bottle-green'));
  assert.ok(sim.commissions.stepAccepts({ family: 'pink', jars: 1 }, 'shell-pink'));
});

test('Festival Banners counts bright tints and shades of red, orange, yellow and pink', () => {
  const step = getCommission('festival-banners').steps[0];
  for (const id of ['rose', 'coral', 'blush', 'peach', 'apricot', 'wheat', 'custard', 'maroon', 'rust', 'tobacco', 'quilt-patchwork']) {
    assert.ok(sim.commissions.stepAccepts(step, id), id);
  }
});

test('a blue tint she owns but has no jars of shows up, with a way to make it', () => {
  const s = workshop(['sky-blue']);
  open(s, 'harbor-lighthouse');
  s.stock = {};
  const g = sim.commissions.stepGuide(s, 'harbor-lighthouse', 0);
  const ids = g.owned.map((o) => o.id);
  assert.ok(ids.includes('sky-blue') && ids.includes('woad'), ids.join());
  assert.equal(g.ready, 0);
  assert.equal(g.action.kind, 'make');
  assert.equal(g.action.screen, 'workshop');
  assert.ok(g.action.params.assign, 'Take me there sets a mixer');
});

// --- Bug 2: wild hues and pigments could never be delivered ------------------

test('a wild-hue step is filled from the Merge Shelf (wild hues cannot be mixed into jars)', () => {
  const s = workshop(['harbor-teal']);
  open(s, 'harbor-lighthouse');
  const i = getCommission('harbor-lighthouse').steps.findIndex((x) => x.colorId === 'harbor-teal');
  let g = sim.commissions.stepGuide(s, 'harbor-lighthouse', i);
  assert.equal(g.kind, 'shelf');
  assert.equal(g.action.screen, 'shelf');
  sim.addVial(s, { colorId: 'harbor-teal' });
  g = sim.commissions.stepGuide(s, 'harbor-lighthouse', i);
  assert.equal(g.action.kind, 'deliver');
  const r = sim.commissions.deliver(s, { commissionId: 'harbor-lighthouse', stepIndex: i, colorId: 'harbor-teal' }, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.delivered, 1);
});

test('a wild hue she has not found yet points to the right hunt', () => {
  const s = workshop([]);
  s.unlocks.hunters = true;
  s.hunters = s.hunters || {};
  s.hunters.regionsUnlocked = ['meadow', 'quarry', 'coast'];
  open(s, 'harbor-lighthouse');
  const i = getCommission('harbor-lighthouse').steps.findIndex((x) => x.colorId === 'harbor-teal');
  const g = sim.commissions.stepGuide(s, 'harbor-lighthouse', i);
  assert.equal(g.action.kind, 'find');
  assert.equal(g.action.screen, 'map');
  assert.equal(g.action.params.regionId, 'coast');
});

test('"Umber" means colors made with umber, so the Potter\'s step can be filled', () => {
  const step = getCommission('potters-glaze').steps.find((x) => x.pigment === 'umber');
  assert.ok(sim.commissions.stepAccepts(step, 'burnt-sienna'));
  assert.ok(sim.commissions.stepAccepts(step, 'fawn'));
  assert.ok(!sim.commissions.stepAccepts(step, 'madder'));
});

// --- Bug 3: the shop sold the jars a commission was waiting for --------------

test('the shop keeps jars an open commission step can use', () => {
  const s = workshop(['sky-blue']);
  open(s, 'harbor-lighthouse');
  assert.ok(sim.keepOf(s, 'sky-blue') > 0);
  assert.equal(sim.keepOf(s, 'madder'), 0);
  // Her own setting still wins.
  sim.setKeep(s, { colorId: 'sky-blue', jars: 0 });
  assert.equal(sim.keepOf(s, 'sky-blue'), 0);
});

// --- Bug 4: commissions she could never finish -------------------------------

test('refresh only opens commissions she can finish from where she is', () => {
  for (const n of [30, 36, 45, 60]) {
    const s = withColors(n, n);
    s.commissions = { open: [], done: [] };
    sim.commissions.refresh(s, NOW);
    assert.ok(s.commissions.open.length >= 1, `something opens at ${n} colors`);
    for (const rec of s.commissions.open) {
      assert.equal(sim.commissions.commissionFeasible(s, rec.id), true, `${rec.id} at ${n}`);
      getCommission(rec.id).steps.forEach((_, i) => {
        const g = sim.commissions.stepGuide(s, rec.id, i);
        assert.ok(g.action && g.action.kind !== 'later', `${rec.id} step ${i}: ${JSON.stringify(g.action)}`);
      });
    }
  }
});

test('an untouched open commission she cannot finish waits for later, then comes back', () => {
  const s = withColors(50);
  s.unlocks.hunters = true;
  s.hunters.regionsUnlocked = ['meadow', 'quarry', 'coast', 'jungle'];
  open(s, 'cartographers-atlas'); // needs Obsidian from the Volcano: not open to her yet
  assert.equal(sim.commissions.commissionFeasible(s, 'cartographers-atlas'), false);
  sim.commissions.refresh(s, NOW);
  assert.ok(!s.commissions.open.some((r) => r.id === 'cartographers-atlas'));
  assert.ok(s.commissions.later.some((r) => r.id === 'cartographers-atlas'));
  // Once the Volcano opens it comes back when there is room.
  s.hunters.regionsUnlocked.push('volcano');
  s.commissions.open = [];
  sim.commissions.refresh(s, NOW);
  assert.ok(s.commissions.open.some((r) => r.id === 'cartographers-atlas'));
});

test('before the Hue Hunters are bought, a wild hue step says to open them first', () => {
  const s = withColors(32);
  s.unlocks.hunters = false;
  open(s, 'harbor-lighthouse');
  assert.equal(sim.commissions.commissionFeasible(s, 'harbor-lighthouse'), true);
  const i = getCommission('harbor-lighthouse').steps.findIndex((x) => x.colorId === 'harbor-teal');
  const g = sim.commissions.stepGuide(s, 'harbor-lighthouse', i);
  assert.equal(g.action.kind, 'hunters-open');
  assert.deepEqual(g.action.params, { unlock: 'hunters' });
});

test('set aside swaps a commission for another, keeping its progress', () => {
  const s = withColors(50);
  s.unlocks.hunters = true;
  s.hunters.regionsUnlocked = ['meadow', 'quarry', 'coast', 'jungle'];
  s.commissions = { open: [], done: [] };
  sim.commissions.refresh(s, NOW);
  const first = s.commissions.open[0];
  first.steps[0].delivered = 3;
  first.steps[0].colors = { woad: 3 };
  const r = sim.commissions.setAside(s, { commissionId: first.id }, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!s.commissions.open.some((x) => x.id === first.id));
  const kept = s.commissions.later.find((x) => x.id === first.id);
  assert.equal(kept.steps[0].delivered, 3);
});

test('old saves without commissions.later load and refresh', () => {
  const s = withColors(32);
  s.commissions = { open: [], done: [] };
  delete s.commissions.later;
  assert.doesNotThrow(() => sim.commissions.refresh(s, NOW));
  assert.ok(Array.isArray(s.commissions.later));
});

// --- Distinct-color rule, spelled out ---------------------------------------

test('stepGuide spells out the different-colors rule: which count so far and which she could add', () => {
  const s = withColors(40);
  open(s, 'festival-banners');
  const rec = s.commissions.open[0];
  rec.steps[0] = { delivered: 30, colors: { madder: 20, ochre: 10 }, done: false };
  const g = sim.commissions.stepGuide(s, 'festival-banners', 0);
  assert.equal(g.distinct, 10);
  assert.equal(g.distinctDone, 2);
  assert.equal(g.moreColors, 8);
  assert.ok(g.owned.find((o) => o.id === 'madder').used);
  assert.ok(g.owned.filter((o) => !o.used).length >= 8, 'she already owns enough other brights');
});

test('every commission step has at least as many qualifying catalog colors as it asks for', () => {
  for (const c of COMMISSIONS.filter((x) => !x.comingSoon)) {
    c.steps.forEach((st, i) => {
      const n = CATALOG.filter((col) => col.foundBy !== 'commission' && sim.commissions.stepAccepts(st, col.id)).length;
      assert.ok(n >= (st.distinct ?? 1), `${c.id} step ${i}: ${n} colors for ${st.distinct}`);
    });
  }
});

// --- The vat list ------------------------------------------------------------

test('vat choices include every color she has discovered, not only what is in stock', () => {
  const s = workshop(['sky-blue', 'navy']);
  s.stock = {};
  sim.addStock(s, 'woad', 5);
  const list = sim.vatChoices(s);
  const ids = list.map((c) => c.id);
  for (const id of ['woad', 'sky-blue', 'navy', 'madder']) assert.ok(ids.includes(id), id);
  assert.equal(list[0].id, 'woad', 'stocked colors first');
  assert.equal(list.find((c) => c.id === 'sky-blue').jars, 0);
  // Discovering a color adds it at once.
  sim.discover(s, { colorId: 'delft-blue', method: 'debug' }, NOW + HOUR);
  assert.ok(sim.vatChoices(s).some((c) => c.id === 'delft-blue'));
});
