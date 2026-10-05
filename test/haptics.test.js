// haptics.js throttle rule: within 80 ms a stronger haptic overrides a weaker one; same or weaker is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const nav = globalThis.navigator || {};
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
globalThis.navigator.vibrate = (p) => { calls.push(p); return true; };
const { haptics } = await import('../src/ui/haptics.js');

const later = (ms) => new Promise((r) => setTimeout(r, ms));

test('a stronger haptic inside the 80 ms window overrides the weaker one', async () => {
  calls.length = 0;
  await later(100);
  assert.equal(haptics.light(), true);
  assert.equal(haptics.medium(), true, 'medium after light is not dropped');
  assert.equal(haptics.light(), false, 'weaker inside the window is dropped');
  assert.equal(haptics.medium(), false, 'same strength inside the window is dropped');
  assert.equal(haptics.success(), true, 'success overrides medium');
  assert.equal(haptics.heavy(), false, 'heavy ranks with success');
  assert.deepEqual(calls, [[10], [20], [15, 40, 25]]);
  await later(100);
  assert.equal(haptics.soft(), true, 'a new window takes anything');
});
