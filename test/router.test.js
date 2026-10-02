// router: the tab bar lights the top screen's home tab; back returns to where she came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, HOME_TABS, TABS } from '../src/ui/router.js';

function fakeTabbar() {
  const buttons = TABS.map((id) => {
    const attrs = {};
    return {
      dataset: { tab: id },
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      attrs,
    };
  });
  return { hidden: false, buttons, querySelectorAll: () => buttons, lit: () => buttons.filter((b) => b.attrs['aria-current'] === 'page').map((b) => b.dataset.tab) };
}

function setup() {
  const ids = [...TABS, 'shelf', 'settings', 'hunter', 'grading', 'commissions', 'naming', 'phase-beat', 'quests'];
  const screens = Object.fromEntries(ids.map((id) => [id, { module: {}, section: null }]));
  const tabbar = fakeTabbar();
  const router = createRouter({ screens, tabbar, history: null });
  return { router, tabbar };
}

test('home tabs: shelf lives in the workshop, hunter on the map, grading in puzzles', () => {
  assert.equal(HOME_TABS.shelf, 'workshop');
  assert.equal(HOME_TABS.hunter, 'map');
  assert.equal(HOME_TABS.grading, 'puzzles');
  assert.equal(HOME_TABS.commissions, 'orders');
  assert.equal(HOME_TABS.naming, 'catalog');
});

test('Orders -> Shelf lights the Workshop tab; back returns to Orders', () => {
  const { router, tabbar } = setup();
  router.navigate('orders');
  assert.deepEqual(tabbar.lit(), ['orders']);
  router.navigate('shelf');
  assert.deepEqual(tabbar.lit(), ['workshop']);
  router.back();
  assert.equal(router.current().id, 'orders');
  assert.deepEqual(tabbar.lit(), ['orders']);
});

test('settings and ceremonies follow the screen below', () => {
  const { router, tabbar } = setup();
  router.navigate('map');
  router.navigate('settings');
  assert.deepEqual(tabbar.lit(), ['map']);
  router.navigate('hunter');
  assert.deepEqual(tabbar.lit(), ['map']);
  router.navigate('phase-beat');
  assert.deepEqual(tabbar.lit(), ['map']);
});

test('an overlay opened with nothing below sits on its home tab', () => {
  const { router, tabbar } = setup();
  router.navigate('grading');
  assert.deepEqual(router.stack().map((s) => s.id), ['puzzles', 'grading']);
  assert.deepEqual(tabbar.lit(), ['puzzles']);
  router.back();
  assert.equal(router.current().id, 'puzzles');
});
