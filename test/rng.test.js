import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, nextRandom, stateRng, pick, weightedPick, shuffle, randInt, chance, uuid,
} from '../src/rng.js';

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 100; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('nextRandom advances state.seed and matches mulberry32', () => {
  const state = { seed: 123456 };
  const ref = mulberry32(123456);
  const before = state.seed;
  const first = nextRandom(state);
  assert.notEqual(state.seed, before);
  assert.ok(Number.isInteger(state.seed) && state.seed >= 0 && state.seed < 2 ** 32);
  assert.equal(first, ref());
  assert.equal(nextRandom(state), ref());
  const s2 = { seed: 123456 };
  const r = stateRng(s2);
  assert.equal(r(), first);
});

test('seed round-trips through JSON mid-stream', () => {
  const s1 = { seed: 7 };
  nextRandom(s1); nextRandom(s1);
  const s2 = JSON.parse(JSON.stringify(s1));
  assert.equal(nextRandom(s1), nextRandom(s2));
});

test('pick', () => {
  const r = mulberry32(1);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) assert.ok(arr.includes(pick(r, arr)));
  assert.equal(pick(r, []), undefined);
});

test('weightedPick respects zero weights and proportions', () => {
  const r = mulberry32(5);
  const items = [{ id: 'a', w: 0 }, { id: 'b', w: 1 }, { id: 'c', w: 0 }, { id: 'd', w: 3 }];
  const counts = { b: 0, d: 0 };
  for (let i = 0; i < 4000; i++) {
    const it = weightedPick(r, items, (x) => x.w);
    assert.ok(it.id === 'b' || it.id === 'd');
    counts[it.id]++;
  }
  assert.ok(counts.d > counts.b * 2);
  assert.equal(weightedPick(r, items, () => 0), undefined);
  assert.equal(weightedPick(() => 0.9999999, [1, 2], (x) => (x === 2 ? 0 : 1)), 1);
});

test('shuffle returns a new permutation, deterministic', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const copy = arr.slice();
  const s = shuffle(mulberry32(9), arr);
  assert.deepEqual(arr, copy);
  assert.notEqual(s, arr);
  assert.deepEqual([...s].sort((a, b) => a - b), arr);
  assert.deepEqual(s, shuffle(mulberry32(9), arr));
});

test('randInt is inclusive on both ends', () => {
  const r = mulberry32(3);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(randInt(r, 2, 5));
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
  assert.equal(randInt(r, 4, 4), 4);
});

test('chance', () => {
  const r = mulberry32(11);
  assert.equal(chance(r, 0), false);
  assert.equal(chance(r, 1), true);
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (chance(r, 0.25)) hits++;
  assert.ok(hits > 800 && hits < 1200);
});

test('uuid is 8 base36 chars and deterministic', () => {
  const id = uuid(mulberry32(1));
  assert.match(id, /^[0-9a-z]{8}$/);
  assert.equal(id, uuid(mulberry32(1)));
  assert.notEqual(id, uuid(mulberry32(2)));
});
