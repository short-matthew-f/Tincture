// Order targets are appealing and exactly reachable (docs/DESIGN.md "Matching
// (orders)", "Mixing model" and the pillar "Color is the content"): generated
// from real recipes of her starter pigments, clear rather than muddy, varied
// on the board, and the onboarding's first order is still an orange.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/rng.js';
import { hexToOklch, hueFamily, deltaEHex, mixPaintHex, WHITE, BLACK } from '../src/color.js';
import { createInitialState } from '../src/state.js';
import { createOrder, TARGET_RULES } from '../src/puzzles/matching.js';
import { refreshOrders, generateOrder, orderCatalogRecipes, MAX_OPEN, MAX_PER_FAMILY, REFRESH_MS } from '../src/sim/orders.js';
import { availablePigments } from '../src/sim/discovery.js';
import { getPigment } from '../src/content/pigments.js';
import { getColor } from '../src/content/catalog.js';
import { seedFirstOrder } from '../src/ui/onboarding.js';

const NOW = Date.UTC(2026, 9, 2, 12);
const hexOf = (id) => (id === 'white' ? WHITE : id === 'black' ? BLACK : getPigment(id).hex);
const recipeHex = (recipe) => mixPaintHex(recipe.map((r) => ({ hex: hexOf(r.pigment), weight: r.weight })));
const STARTERS = ['madder', 'ochre', 'woad'];

function targets(state) {
  return state.orders.open.filter((o) => o.target).map((o) => o.target);
}

test('order targets: 500 orders from the starter pigments are clear, comfortable and Perfect-reachable', () => {
  const s = createInitialState(NOW, 1);
  const pigments = availablePigments(s).filter((p) => p.id !== 'white' && p.id !== 'black');
  assert.deepEqual(pigments.map((p) => p.id).sort(), [...STARTERS].sort());
  const catalogRecipes = orderCatalogRecipes(s);
  const rng = mulberry32(2026);
  const chroma = [];
  let white = 0;
  let catalog = 0;
  for (let i = 0; i < 500; i++) {
    const o = createOrder({ pigments, difficulty: (i % 5) / 4, catalogRecipes }, rng);
    const { L, C } = hexToOklch(o.target);
    chroma.push(C);
    assert.ok(L >= TARGET_RULES.lightness[0] && L <= TARGET_RULES.lightness[1], `${o.target} L ${L}`);
    assert.ok(o.recipe.every((r) => [...STARTERS, 'white', 'black'].includes(r.pigment)));
    assert.equal(o.target, recipeHex(o.recipe), 'the target is exactly its recipe, so Perfect is reachable');
    assert.notEqual(hueFamily(o.target), 'neutral');
    if (o.recipe.some((r) => r.pigment === 'white')) white++;
    if (o.colorId) {
      catalog++;
      assert.equal(o.target, getColor(o.colorId).hex, 'a catalog target is that catalog color');
    }
  }
  chroma.sort((a, b) => a - b);
  const median = chroma[Math.floor(chroma.length / 2)];
  const vivid = chroma.filter((c) => c >= 0.07).length / chroma.length;
  assert.ok(median >= 0.09, `median chroma ${median}`);
  assert.ok(vivid >= 0.7, `${(vivid * 100).toFixed(1)}% have chroma ≥ 0.07`);
  assert.ok(white >= 150 && white <= 350, `${white} of 500 are tints`);
  assert.ok(catalog >= 150 && catalog <= 350, `${catalog} of 500 are catalog colors`);
});

test('order targets: catalog orders are colors she can mix and discover by matching', () => {
  const s = createInitialState(NOW, 1);
  const list = orderCatalogRecipes(s);
  assert.ok(list.length >= 10);
  for (const c of list) {
    assert.equal(getColor(c.id).foundBy, 'mix');
    assert.ok(c.recipe.every((r) => [...STARTERS, 'white', 'black'].includes(r.pigment)), c.id);
    assert.equal(recipeHex(c.recipe), c.hex, c.id);
  }
  assert.ok(list.some((c) => c.id === 'orange'));
  assert.ok(!list.some((c) => c.id === 'madder'), 'a bare pigment is not an order');
  assert.ok(!list.some((c) => c.id === 'bunting-red'), 'needs pigments she does not have yet');
});

test('order targets: a full board spreads hues, stays distinct and never repeats a customer', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const s = createInitialState(NOW, seed);
    refreshOrders(s, NOW);
    refreshOrders(s, NOW + 30 * REFRESH_MS);
    assert.equal(s.orders.open.length, MAX_OPEN);
    const t = targets(s);
    const families = {};
    for (const h of t) families[hueFamily(h)] = (families[hueFamily(h)] ?? 0) + 1;
    assert.ok(Math.max(...Object.values(families)) <= MAX_PER_FAMILY, `seed ${seed}: ${JSON.stringify(families)}`);
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) assert.ok(deltaEHex(t[i], t[j]) >= 8, `seed ${seed}: ${t[i]} vs ${t[j]}`);
    }
    assert.ok(t.filter((h) => hexToOklch(h).C < TARGET_RULES.minChroma).length <= 1, `seed ${seed}: one muted order at most`);
    const customers = s.orders.open.map((o) => o.customer);
    assert.equal(new Set(customers).size, customers.length, `seed ${seed}: ${customers}`);
    for (const o of s.orders.open.filter((x) => x.kind === 'match')) assert.equal(o.target, recipeHex(o.recipe));
  }
});

test('order targets: refilling after orders are taken keeps the board varied', () => {
  const s = createInitialState(NOW, 77);
  refreshOrders(s, NOW + 30 * REFRESH_MS);
  for (let k = 0; k < 40; k++) {
    s.orders.open.splice(k % s.orders.open.length, 1);
    s.orders.open.push(generateOrder(s, undefined, NOW));
    const t = targets(s);
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) assert.ok(deltaEHex(t[i], t[j]) >= 8);
    }
    const customers = s.orders.open.map((o) => o.customer);
    assert.equal(new Set(customers).size, customers.length);
  }
});

test('order targets: the tutorial first order is still madder + ochre orange', () => {
  const s = createInitialState(NOW, 5);
  refreshOrders(s, NOW);
  const r = seedFirstOrder(s, {}, NOW);
  assert.equal(r.ok, true);
  const o = s.orders.open[0];
  assert.equal(o.tutorial, true);
  assert.deepEqual(o.recipe, [{ pigment: 'madder', weight: 1 }, { pigment: 'ochre', weight: 1 }]);
  assert.equal(o.target, recipeHex(o.recipe));
  const { h } = hexToOklch(o.target);
  assert.ok(h >= 40 && h <= 80, `hue ${h}`);
});
