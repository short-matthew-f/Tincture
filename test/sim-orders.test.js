import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  refreshOrders, submitOrder, orderBasePay, autoFillOrders, handDeliverBonus, MIN_OPEN, MAX_OPEN, REFRESH_MS,
} from '../src/sim/orders.js';
import { addStock } from '../src/sim/storage.js';
import { getPigment } from '../src/content/pigments.js';
import { WHITE } from '../src/color.js';

const NOW = Date.UTC(2026, 9, 2, 12);

function manualOrder(s, target = '#3e6a9e') {
  const o = { id: 'o-test', kind: 'match', target, recipe: [{ pigment: 'woad', weight: 1 }], pay: 0, minutes: 3, container: null, postedAt: NOW, customer: 'Test' };
  s.orders.open.push(o);
  return o;
}

test('orders: the board keeps 3 to 6 open, one more every 20 minutes', () => {
  const s = createInitialState(NOW, 31);
  refreshOrders(s, NOW);
  assert.equal(s.orders.open.length, MIN_OPEN);
  for (const o of s.orders.open) {
    assert.ok(o.pay > 0);
    if (o.kind === 'match') {
      assert.match(o.target, /^#[0-9a-f]{6}$/);
      assert.ok(o.recipe.every((r) => ['madder', 'ochre', 'woad', 'white', 'black'].includes(r.pigment)));
    }
  }
  refreshOrders(s, NOW + REFRESH_MS);
  assert.equal(s.orders.open.length, MIN_OPEN + 1);
  refreshOrders(s, NOW + 30 * REFRESH_MS);
  assert.equal(s.orders.open.length, MAX_OPEN);
});

test('orders: a perfect match pays 150% plus a reputation star', () => {
  const s = createInitialState(NOW, 31);
  manualOrder(s);
  const base = orderBasePay(s, 3);
  assert.equal(handDeliverBonus(s, NOW), 1);
  const before = s.coins; // the till starts with STARTING_COINS
  const r = submitOrder(s, { orderId: 'o-test', drops: [{ id: 'woad', hex: getPigment('woad').hex, count: 2 }] }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'perfect');
  assert.ok(Math.abs(r.coins - base * 1.5) < 1e-9, `${r.coins} vs ${base * 1.5}`);
  assert.equal(s.coins, before + r.coins);
  assert.equal(s.orders.reputation, 1);
  assert.equal(s.orders.filledCount, 1);
  assert.ok(s.orders.open.length >= MIN_OPEN, 'board refilled');
});

test('orders: a far-off mix is "close": pays 70% and never fails', () => {
  const s = createInitialState(NOW, 31);
  manualOrder(s, '#2e3f6e');
  const base = orderBasePay(s, 3);
  const r = submitOrder(s, { orderId: 'o-test', drops: [{ id: 'white', hex: WHITE, count: 1 }] }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'close');
  assert.ok(Math.abs(r.coins - base * 0.7) < 1e-9);
  assert.equal(s.orders.reputation, 0);
  // Even an empty jar pays 70%.
  manualOrder(s, '#2e3f6e');
  const e = submitOrder(s, { orderId: 'o-test', drops: [] }, NOW);
  assert.equal(e.ok, true);
  assert.equal(e.pct, 0.7);
});

test('orders: "anything you love" pays 1.3x for any discovered color', () => {
  const s = createInitialState(NOW, 31);
  s.orders.open.push({ id: 'o-any', kind: 'any', target: null, recipe: null, pay: 0, minutes: 3, container: null, postedAt: NOW, customer: 'Test' });
  const base = orderBasePay(s, 3);
  assert.equal(submitOrder(s, { orderId: 'o-any', colorId: 'not-mine' }, NOW).ok, false);
  const r = submitOrder(s, { orderId: 'o-any', colorId: 'madder' }, NOW);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.coins - base * 1.3) < 1e-9);
});

test('orders: the Order Clerk fills matching orders from stock at 70%', () => {
  const s = createInitialState(NOW, 31);
  s.apprentices.orderClerk = true;
  manualOrder(s, getPigment('woad').hex);
  addStock(s, 'woad', 10);
  autoFillOrders(s, NOW); // schedules
  const base = orderBasePay(s, 3);
  const r = autoFillOrders(s, NOW + 10 * 60e3);
  assert.equal(r.filled, 1);
  assert.ok(Math.abs(r.coins - base * 0.7) < 1e-9);
  assert.ok(!s.orders.open.some((o) => o.id === 'o-test'));
});

test('orders: the onboarding tutorial order pays one cheapest upgrade on top', async () => {
  const { cheapestUpgrade, tutorialReward } = await import('../src/sim/economy.js');
  const { STARTING_COINS } = await import('../src/state.js');
  const s = createInitialState(NOW, 31);
  assert.equal(s.coins, STARTING_COINS);
  assert.ok(STARTING_COINS >= 3 * cheapestUpgrade(s).cost, 'the drawer alone buys a few first upgrades');
  const o = manualOrder(s);
  o.tutorial = true;
  const base = orderBasePay(s, 3);
  const bonus = tutorialReward(s);
  assert.equal(bonus, cheapestUpgrade(s).cost);
  const r = submitOrder(s, { orderId: 'o-test', drops: [{ id: 'woad', hex: getPigment('woad').hex, count: 1 }] }, NOW);
  assert.equal(r.tier, 'perfect');
  assert.equal(r.tutorialBonus, bonus);
  assert.ok(Math.abs(r.coins - (base * 1.5 + bonus)) < 1e-9);
  assert.ok(s.coins - STARTING_COINS >= cheapestUpgrade(s).cost, 'the first order alone pays for an upgrade');
});

test('orders: only one container order waits at a time, in a shelf chip color, and it can be passed on', async () => {
  const { passOrder, MAX_CONTAINER_OPEN, containerOrderColors } = await import('../src/sim/orders.js');
  const { setShelfColors } = await import('../src/sim/shelf.js');
  const s = createInitialState(NOW, 31);
  s.phase = 2;
  s.unlocks.shelf = true;
  setShelfColors(s, { colors: ['madder', 'woad'] });
  assert.deepEqual(containerOrderColors(s), ['madder', 'woad']);
  // An older save could have piled up three: the board keeps one and refills the rest.
  for (let i = 0; i < 3; i++) {
    s.orders.open.push({ id: 'o-c' + i, kind: 'container', target: '#000000', recipe: null, pay: 0, minutes: 3, container: { color: 'ochre', tier: 2 }, postedAt: NOW, customer: 'C' + i });
  }
  refreshOrders(s, NOW);
  assert.equal(s.orders.open.filter((o) => o.kind === 'container').length, MAX_CONTAINER_OPEN);
  assert.equal(s.orders.open[0].id, 'o-c0', 'the oldest container order stays');
  assert.ok(s.orders.open.length >= MIN_OPEN);
  // Over many refreshes new container orders only ask for chip colors and never stack up.
  for (let k = 0; k < 400; k++) {
    s.orders.open = s.orders.open.filter((o) => o.kind === 'container');
    refreshOrders(s, NOW + k * REFRESH_MS);
    const cs = s.orders.open.filter((o) => o.kind === 'container');
    assert.ok(cs.length <= MAX_CONTAINER_OPEN, 'never more than one');
    for (const c of cs) if (c.id !== 'o-c0') assert.ok(['madder', 'woad'].includes(c.container.color), c.container.color);
  }
  // Passing the stuck one on replaces it with a fresh order.
  const before = s.orders.open.length;
  assert.equal(passOrder(s, { orderId: 'nope' }, NOW).ok, false);
  const m = s.orders.open.find((o) => o.kind === 'match');
  if (m) assert.equal(passOrder(s, { orderId: m.id }, NOW).ok, false, 'only container orders can be passed on');
  assert.equal(passOrder(s, { orderId: 'o-c0' }, NOW).ok, true);
  assert.ok(!s.orders.open.some((o) => o.id === 'o-c0'));
  assert.ok(s.orders.open.length >= Math.min(before, MIN_OPEN));
  assert.equal(s.orders.passed, 1);
});
