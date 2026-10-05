// router: the tab bar lights the top screen's home tab; back returns to where she came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, HOME_TABS, TABS, litTabFor, FOLLOW_IDS } from '../src/ui/router.js';

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

test('settings lights the Workshop wherever it opens (its gear lives there; audit shot [42])', () => {
  const { router, tabbar } = setup();
  router.navigate('catalog');
  router.navigate('settings');
  assert.deepEqual(tabbar.lit(), ['workshop']);
  router.back();
  assert.equal(router.current().id, 'catalog');
  assert.deepEqual(tabbar.lit(), ['catalog']);
  router.navigate('settings');
  assert.deepEqual(router.stack().map((s) => s.id), ['catalog', 'settings']);
  assert.equal(HOME_TABS.settings, 'workshop');
});

test('ceremonies light the home of the screen directly beneath them', () => {
  const { router, tabbar } = setup();
  router.navigate('map');
  router.navigate('phase-beat');
  assert.deepEqual(tabbar.lit(), ['map']);
  router.back();
  router.navigate('hunter');
  router.navigate('phase-beat');
  assert.deepEqual(tabbar.lit(), ['map'], 'phase-beat over the hunter lights the hunter\'s home');
  const r2 = setup();
  r2.router.navigate('orders');
  r2.router.navigate('shelf');
  r2.router.navigate('phase-beat');
  assert.deepEqual(r2.tabbar.lit(), ['workshop'], 'over the shelf: the shelf\'s home, not the Orders base');
  const r3 = setup();
  r3.router.navigate('phase-beat');
  assert.deepEqual(r3.tabbar.lit(), ['workshop'], 'with nothing beneath: the Workshop');
});

test('litTabFor: pure rule over a stack of ids', () => {
  assert.equal(litTabFor([]), 'workshop');
  assert.equal(litTabFor(['catalog']), 'catalog');
  assert.equal(litTabFor(['catalog', 'settings']), 'workshop');
  assert.equal(litTabFor(['map', 'phase-beat']), 'map');
  assert.equal(litTabFor(['map', 'phase-beat', 'onboarding']), 'map', 'followers stack: resolve down');
  assert.equal(litTabFor(['phase-beat']), 'workshop');
  assert.equal(litTabFor(['onboarding']), 'workshop');
  assert.equal(litTabFor(['orders', 'grading', 'phase-beat']), 'puzzles');
  assert.equal(litTabFor(['puzzles', 'naming']), 'catalog');
  assert.equal(litTabFor(['orders', 'mystery-screen']), 'workshop', 'unknown overlays live in the Workshop');
  assert.ok(FOLLOW_IDS.includes('phase-beat') && FOLLOW_IDS.includes('onboarding') && !FOLLOW_IDS.includes('settings'));
});

test('an overlay opened with nothing below sits on its home tab', () => {
  const { router, tabbar } = setup();
  router.navigate('grading');
  assert.deepEqual(router.stack().map((s) => s.id), ['puzzles', 'grading']);
  assert.deepEqual(tabbar.lit(), ['puzzles']);
  router.back();
  assert.equal(router.current().id, 'puzzles');
});
