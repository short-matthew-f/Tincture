// Offline catch-up: a 3-day return builds a Ledger with produced lines; no NaN anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import { catchUp } from '../src/sim/offline.js';
import { tick, discover, unlockRegions, send, closeUpShop, almostThere, isAllCaughtUp, markCaughtUp } from '../src/sim/index.js';

const NOW = Date.UTC(2026, 9, 2, 18);
const DAY = 86400e3;

/** Deep scan: every number reachable from `x` is finite (no NaN / Infinity). */
function findNaN(x, path = 'state', seen = new Set()) {
  if (typeof x === 'number') return Number.isFinite(x) ? null : path;
  if (!x || typeof x !== 'object' || seen.has(x)) return null;
  seen.add(x);
  for (const [k, v] of Object.entries(x)) {
    const bad = findNaN(v, `${path}.${k}`, seen);
    if (bad) return bad;
  }
  return null;
}

function factoryState(seed) {
  const s = createInitialState(NOW, seed);
  for (const id of ['orange', 'green', 'violet']) discover(s, { colorId: id, method: 'mix' }, NOW);
  s.stations.mixers[0].recipe = 'orange';
  s.coins = 50;
  return s;
}

test('catchUp is a no-op under a minute', () => {
  const s = factoryState(1);
  assert.equal(catchUp(s, NOW + 30e3), null);
});

test('tick is safe at dt = 0 and dt = 3 days', () => {
  const s = factoryState(2);
  tick(s, NOW);
  tick(s, NOW);
  assert.equal(findNaN(s), null);
  tick(s, NOW + 3 * DAY);
  assert.equal(findNaN(s), null);
  assert.equal(s.lastTick, NOW + 3 * DAY);
});

test('a 3-day catch-up returns a summary with produced lines and no NaN', () => {
  const s = factoryState(3);
  s.phase = 2;
  unlockRegions(s, {}, NOW);
  send(s, { hunterId: 'wren', regionId: 'meadow', duration: 'overnight' }, NOW);
  tick(s, NOW);
  const t0 = performance.now();
  const sum = catchUp(s, NOW + 3 * DAY);
  assert.ok(performance.now() - t0 < 2000, 'catch-up is fast');
  assert.ok(sum);
  assert.equal(sum.away, 3 * DAY);
  assert.ok(sum.produced.length > 0, 'something was produced');
  assert.ok(sum.lines.length > 0);
  for (const l of sum.lines) {
    assert.equal(typeof l.icon, 'string');
    assert.equal(typeof l.text, 'string');
    assert.equal(typeof l.screen, 'string');
  }
  assert.ok(sum.huntersHome.some((h) => h.hunterId === 'wren'));
  assert.ok(Array.isArray(sum.almostThere) && sum.almostThere.length <= 5);
  assert.equal(s.ledger.pending, sum);
  assert.equal(s.lastSeenAt, NOW + 3 * DAY);
  assert.equal(findNaN(s), null);
  assert.equal(findNaN(sum, 'summary'), null);
});

test('close up shop sends idle hunters overnight and queues mixers; caught-up stamp', () => {
  const s = factoryState(4);
  s.phase = 2;
  s.stations.mixers[0].recipe = null;
  unlockRegions(s, {}, NOW);
  const r = closeUpShop(s, NOW);
  assert.ok(r.huntersSent.some((h) => h.hunterId === 'wren'));
  assert.equal(s.hunters.roster[0].trip.duration, 'overnight');
  assert.ok(s.stations.mixers[0].recipe, 'mixer queued');
  assert.equal(s.stats.lastCloseUpAt, NOW);
  assert.ok('fillMs' in r);
  assert.ok(almostThere(s, NOW).length >= 1);
  s.ledger.pending = { lines: [] };
  assert.equal(isAllCaughtUp(s), false);
  const m = markCaughtUp(s, {}, NOW);
  assert.equal(m.ok, isAllCaughtUp(s));
});
