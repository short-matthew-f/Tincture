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
  const r = submitOrder(s, { orderId: 'o-test', drops: [{ id: 'woad', hex: getPigment('woad').hex, count: 2 }] }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'perfect');
  assert.ok(Math.abs(r.coins - base * 1.5) < 1e-9, `${r.coins} vs ${base * 1.5}`);
  assert.equal(s.coins, r.coins);
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
