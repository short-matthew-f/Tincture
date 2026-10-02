import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  unlock, startPiece, paintRegion, signPiece, hang, unhang, tickAdmission, weeklyTaste,
  visitorComment, acceptCollector, pieceValue, regionCost, ADMISSION_RATE, COLLECTOR_MS,
} from '../src/sim/gallery.js';
import { addStock, stockOf } from '../src/sim/storage.js';
import { incomeMultiplier } from '../src/sim/economy.js';
import { getCanvas } from '../src/content/canvases.js';
import { FAMILIES } from '../src/content/routes.js';
import { mulberry32 } from '../src/rng.js';

const NOW = Date.UTC(2026, 9, 2, 12);

function regionsOf(canvas) {
  return Array.isArray(canvas.regions) ? canvas.regions : Object.entries(canvas.regions).map(([id, v]) => ({ id, ...v }));
}

function galleryState() {
  const s = createInitialState(NOW, 21);
  s.cellarLevel = 200; // plenty of room for paint
  const r = unlock(s, {}, NOW);
  assert.equal(r.ok, true);
  assert.ok(s.gallery.unlocked);
  assert.ok(s.gallery.canvases.length >= 1);
  return s;
}

test('gallery: painting consumes size x 3 jars, highest purity first; repaint allowed', () => {
  const s = galleryState();
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const region = regionsOf(getCanvas(canvasId))[0];
  const need = regionCost(canvasId, region.id);
  assert.equal(need, Math.max(1, region.size ?? 1) * 3);
  // Not enough paint: refused, nothing taken.
  assert.equal(paintRegion(s, { pieceId, regionId: region.id, colorId: 'madder' }, NOW).reason, 'stock');
  addStock(s, 'madder', need, 'standard');
  addStock(s, 'madder', need, 'pure');
  const r = paintRegion(s, { pieceId, regionId: region.id, colorId: 'madder' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.purity, 'pure');
  assert.equal(stockOf(s, 'madder'), need);
  addStock(s, 'woad', need);
  assert.equal(paintRegion(s, { pieceId, regionId: region.id, colorId: 'woad' }, NOW).ok, true);
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  assert.equal(piece.regions[region.id], 'woad');
});

test('gallery: sign value, hang, admission accrues, comments, collector', () => {
  const s = galleryState();
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const regions = regionsOf(getCanvas(canvasId));
  assert.equal(signPiece(s, { pieceId, title: 'Too soon' }, NOW).reason, 'unpainted');
  const colors = ['madder', 'ochre', 'woad'];
  regions.forEach((rg, i) => {
    const c = colors[i % 3];
    addStock(s, c, regionCost(canvasId, rg.id));
    assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: c }, NOW).ok, true);
  });
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  const preview = pieceValue(s, piece, NOW);
  const sig = signPiece(s, { pieceId, title: 'Harbor at Dawn' }, NOW);
  assert.equal(sig.ok, true);
  assert.ok(sig.value > 0);
  assert.ok(Math.abs(sig.value - preview.value) < 1e-9);
  // Value = paint × rarity × variety × taste; three primaries → rarity 1, variety +6%.
  assert.equal(sig.breakdown.rarity, 1);
  assert.ok(Math.abs(sig.breakdown.variety - 1.06) < 1e-9);
  assert.equal(piece.title, 'Harbor at Dawn');
  assert.equal(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'madder' }, NOW).ok, false, 'signed pieces are final');

  assert.equal(hang(s, { pieceId }).ok, true);
  assert.deepEqual(s.gallery.hung, [pieceId]);
  s.lastTick = NOW;
  tickAdmission(s, NOW);
  const before = s.coins;
  tickAdmission(s, NOW + 3600e3);
  const expected = sig.value * ADMISSION_RATE * 3600 * incomeMultiplier(s, NOW + 3600e3);
  assert.ok(Math.abs(s.coins - before - expected) < 1e-6 * Math.max(1, expected));

  const text = visitorComment(s, pieceId, mulberry32(3));
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
  assert.ok(!/\{\w+\}/.test(text), 'all placeholders filled');

  // A collector arrives within about two days.
  tickAdmission(s, NOW + 2 * COLLECTOR_MS);
  assert.ok(s.gallery.collectorOffer, 'collector offer');
  assert.equal(s.gallery.collectorOffer.pieceId, pieceId);
  const c0 = s.coins;
  const acc = acceptCollector(s, {}, NOW + 2 * COLLECTOR_MS);
  assert.equal(acc.ok, true);
  assert.ok(s.coins > c0);
  assert.equal(s.gallery.pieces.length, 1, 'she keeps the original');

  assert.equal(unhang(s, { pieceId }).ok, true);
  assert.deepEqual(s.gallery.hung, []);
});

test('gallery: weekly taste is a hue family and changes by week', () => {
  const t = weeklyTaste(NOW);
  assert.ok(FAMILIES.includes(t));
  const weeks = new Set();
  for (let w = 0; w < 9; w++) weeks.add(weeklyTaste(NOW + w * 7 * 86400e3));
  assert.ok(weeks.size > 1);
});
