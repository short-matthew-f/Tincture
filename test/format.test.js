import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNumber, formatDuration, formatCountdown, formatRate, isoWeekKey, dayKey, pct,
} from '../src/format.js';

test('formatNumber below 1000', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(3.46), '3.5');
  assert.equal(formatNumber(12.6), '13');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(999.4), '999');
  assert.equal(formatNumber(-42), '-42');
  assert.equal(formatNumber(NaN), '0');
});

test('formatNumber short suffixes', () => {
  assert.equal(formatNumber(1000), '1K');
  assert.equal(formatNumber(1234), '1.2K');
  assert.equal(formatNumber(999.6), '1K');
  assert.equal(formatNumber(999999), '1M');
  assert.equal(formatNumber(1234567), '1.2M');
  assert.equal(formatNumber(3.4e9), '3.4B');
  assert.equal(formatNumber(5.6e12), '5.6T');
  assert.equal(formatNumber(1e15), '1Qa');
  assert.equal(formatNumber(2.5e18), '2.5Qi');
  assert.equal(formatNumber(1e21), '1Sx');
  assert.equal(formatNumber(1e24), '1Sp');
  assert.equal(formatNumber(1e27), '1Oc');
  assert.equal(formatNumber(1e30), '1No');
  assert.equal(formatNumber(1e33), '1Dc');
  assert.equal(formatNumber(1e40), '1e40');
});

test('formatNumber sci', () => {
  assert.equal(formatNumber(1234567, 'sci'), '1.23e6');
  assert.equal(formatNumber(1e15, 'sci'), '1e15');
  assert.equal(formatNumber(999999, 'sci'), '999999');
  assert.equal(formatNumber(1500, 'sci'), '1500');
  assert.equal(formatNumber(7, 'sci'), '7');
});

test('formatDuration', () => {
  assert.equal(formatDuration((6 * 60 + 20) * 60000), '6 h 20 m');
  assert.equal(formatDuration(45 * 60000), '45 m');
  assert.equal(formatDuration(30000), '30 s');
  assert.equal(formatDuration((2 * 24 + 3) * 3600000), '2 d 3 h');
  assert.equal(formatDuration(6 * 3600000), '6 h');
  assert.equal(formatDuration(90000), '1 m 30 s');
  assert.equal(formatDuration(0), '0 s');
  assert.equal(formatDuration(-5000), '0 s');
});

test('formatCountdown never negative', () => {
  assert.equal(formatCountdown(-1), 'now');
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(400), '1 s');
  assert.equal(formatCountdown(45 * 60000), '45 m');
});

test('formatRate', () => {
  assert.equal(formatRate(38), '+38/s');
  assert.equal(formatRate(1500), '+1.5K/s');
  assert.equal(formatRate(0.5), '+0.5/s');
  assert.equal(formatRate(0), '+0/s');
  assert.equal(formatRate(-3), '-3/s');
});

test('isoWeekKey', () => {
  assert.equal(isoWeekKey(Date.UTC(2026, 9, 2, 12)), '2026-W40');
  assert.equal(isoWeekKey(Date.UTC(2026, 0, 1)), '2026-W01');
  assert.equal(isoWeekKey(Date.UTC(2021, 0, 3)), '2020-W53'); // Sunday belongs to prior ISO year
  assert.equal(isoWeekKey(Date.UTC(2024, 11, 30)), '2025-W01');
});

test('dayKey uses local date', () => {
  const d = new Date(2026, 9, 2, 13, 30);
  assert.equal(dayKey(d.getTime()), '2026-10-02');
  assert.equal(dayKey(new Date(2026, 0, 5, 0, 1).getTime()), '2026-01-05');
});

test('pct', () => {
  assert.equal(pct(0.25), '+25%');
  assert.equal(pct(-0.1), '-10%');
  assert.equal(pct(0.025), '+2.5%');
  assert.equal(pct(0), '0%');
  assert.equal(pct(2), '+200%');
});
