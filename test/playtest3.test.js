// Playtest 3 (v0.2.2): bonus vials in shelf chip colors, the Seal shop,
// "send everyone out", and a weekly gallery taste she can actually paint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import { discover } from '../src/sim/discovery.js';
import { chipFor, setShelfColors, shelfColors } from '../src/sim/shelf.js';
import { sealOffers, buySealItem } from '../src/sim/seals.js';
import { unlockRegions, send, sendAll, idleHunters } from '../src/sim/hunters.js';
import { weeklyTaste } from '../src/sim/gallery.js';
import { colorFamily } from '../src/sim/economy.js';
import { CATALOG } from '../src/content/catalog.js';

const NOW = Date.UTC(2026, 9, 9, 12);

test('bonus vials land in a shelf chip color: itself, else its family chip, else the nearest chip', () => {
  const s = createInitialState(NOW, 3);
  s.unlocks.shelf = true;
  for (const id of ['orange', 'green', 'purple']) discover(s, { colorId: id, method: 'bench' }, NOW);
  setShelfColors(s, { colors: ['madder', 'woad'] });
  assert.deepEqual(shelfColors(s), ['madder', 'woad']);
  assert.equal(chipFor(s, 'madder'), 'madder');
  const sameFamily = CATALOG.find((c) => c.id !== 'woad' && colorFamily(c.id) === colorFamily('woad'));
  assert.equal(chipFor(s, sameFamily.id), 'woad');
  for (const c of CATALOG.slice(0, 60)) assert.ok(['madder', 'woad'].includes(chipFor(s, c.id)), c.id);
});

test('Seals buy boosts, a crate of shelf vials and calling the hunters home', () => {
  const s = createInitialState(NOW, 4);
  s.seals = 100;
  s.unlocks.shelf = true;
  const offers = sealOffers(s);
  assert.ok(offers.length >= 3);
  assert.equal(offers.find((o) => o.id === 'call-home').reason, 'home');
  const b = buySealItem(s, { id: 'quick-hands' }, NOW);
  assert.equal(b.ok, true);
  assert.equal(s.seals, 60);
  assert.ok(s.boosts.some((x) => x.kind === 'production' && x.until === NOW + 30 * 60e3));
  const v = buySealItem(s, { id: 'vial-crate' }, NOW);
  assert.equal(v.ok, true);
  assert.equal(v.vials, 6);
  const chips = shelfColors(s);
  assert.ok(s.shelf.cells.filter(Boolean).every((c) => chips.includes(c.color)));
  assert.equal(buySealItem(s, { id: 'market-day' }, NOW).reason, 'seals', 'never goes below zero');
  assert.equal(s.seals, 30);
});

test('send everyone out: each home hunter goes back where they last went', () => {
  const s = createInitialState(NOW, 7);
  s.phase = 2;
  s.unlocks.hunters = true;
  unlockRegions(s, {}, NOW);
  const home = idleHunters(s);
  assert.ok(home.length >= 1);
  const first = home[0];
  const region = s.hunters.regionsUnlocked[s.hunters.regionsUnlocked.length - 1];
  first.lastHaul = { region, duration: 'short', at: NOW - 1, seen: true };
  const res = sendAll(s, {}, NOW);
  assert.equal(res.ok, true);
  assert.equal(idleHunters(s).length, 0);
  const sentFirst = res.sent.find((x) => x.hunterId === first.id);
  assert.deepEqual([sentFirst.regionId, sentFirst.duration], [region, 'short']);
  assert.equal(sendAll(s, {}, NOW).ok, false, 'nobody left at home');
  assert.equal(send(s, { hunterId: first.id, regionId: region, duration: 'short' }, NOW).ok, false);
});

test('visitors only love a hue family she has a color in', () => {
  const s = createInitialState(NOW, 5);
  const owned = new Set(Object.keys(s.catalog.discovered).map(colorFamily));
  for (let w = 0; w < 30; w++) assert.ok(owned.has(weeklyTaste(NOW + w * 7 * 86400e3, s)), `week ${w}`);
});
