import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  unlock, startPiece, paintRegion, signPiece, hang, unhang, tickAdmission, weeklyTaste,
  visitorComment, acceptCollector, pieceValue, regionCost, clearRegion, paintRate, discardPiece,
  ADMISSION_RATE, COLLECTOR_MS, PAINT_SECONDS, MIN_PAINT_RATE, VALUE_MULT,
} from '../src/sim/gallery.js';
import { addStock, stockOf } from '../src/sim/storage.js';
import { incomeMultiplier, rates, colorPrice } from '../src/sim/economy.js';
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

/** A running factory: one mixer on madder at `level` (sources and grinder not limiting). */
function producing(s, level = 40) {
  for (const src of Object.values(s.stations.sources)) src.level = 2 * level;
  for (const g of s.stations.grinders) g.level = 2 * level;
  s.stations.mixers[0].recipe = 'madder';
  s.stations.mixers[0].level = level;
  return s;
}

const sizeOf = (r) => Math.max(1, r.size ?? 1);

test('gallery: a canvas costs PAINT_SECONDS of current production, split by region size', () => {
  const s = producing(galleryState());
  const jps = rates(s, NOW).jars;
  assert.ok(jps > MIN_PAINT_RATE, 'the factory is running');
  assert.equal(paintRate(s, NOW), jps);
  for (const canvasId of s.gallery.canvases) {
    const regions = regionsOf(getCanvas(canvasId));
    const total = regions.reduce((a, r) => a + sizeOf(r), 0);
    let sum = 0;
    for (const r of regions) {
      const c = regionCost(s, canvasId, r.id);
      assert.equal(c, Math.max(1, Math.round(sizeOf(r) / total * jps * PAINT_SECONDS)), `${canvasId}/${r.id}`);
      sum += c;
    }
    // Rounding per region keeps the whole canvas within half a jar per region of the target.
    assert.ok(Math.abs(sum - jps * PAINT_SECONDS) <= regions.length / 2 + 1e-9, `${canvasId}: ${sum}`);
  }
  // Bigger regions cost more; the price follows production as the factory grows.
  const canvasId = s.gallery.canvases.find((id) => new Set(regionsOf(getCanvas(id)).map(sizeOf)).size > 1);
  const rs = [...regionsOf(getCanvas(canvasId))].sort((a, b) => sizeOf(a) - sizeOf(b));
  assert.ok(regionCost(s, canvasId, rs.at(-1).id) > regionCost(s, canvasId, rs[0].id));
  const before = regionCost(s, canvasId, rs.at(-1).id);
  s.stations.mixers[0].level *= 2;
  const grown = rates(s, NOW).jars / jps;
  assert.ok(grown > 1.5, `production x${grown}`);
  const after = regionCost(s, canvasId, rs.at(-1).id);
  assert.ok(Math.abs(after - grown * before) <= grown, `${before} -> ${after} (x${grown})`);
  assert.equal(regionCost(s, canvasId, 'no-such-region'), 0);
});

test('gallery: a new player with no production still pays at least one jar a region', () => {
  const s = galleryState();
  assert.equal(rates(s, NOW).jars, 0);
  assert.equal(paintRate(s, NOW), MIN_PAINT_RATE);
  for (const canvasId of s.gallery.canvases) {
    const regions = regionsOf(getCanvas(canvasId));
    const total = regions.reduce((a, r) => a + sizeOf(r), 0);
    for (const r of regions) {
      const c = regionCost(s, canvasId, r.id);
      assert.ok(Number.isInteger(c) && c >= 1);
      assert.equal(c, Math.max(1, Math.round(sizeOf(r) / total * MIN_PAINT_RATE * PAINT_SECONDS)));
    }
  }
  // The old call shape (no state) prices at the floor.
  const canvasId = s.gallery.canvases[0];
  const r0 = regionsOf(getCanvas(canvasId))[0];
  assert.equal(regionCost(canvasId, r0.id), regionCost(s, canvasId, r0.id));
});

test('gallery: the paint price is locked when the piece starts and stored per region', () => {
  const s = producing(galleryState());
  const canvasId = s.gallery.canvases[0];
  const regions = regionsOf(getCanvas(canvasId));
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  assert.equal(piece.paintRate, rates(s, NOW).jars);
  const locked = regions.map((r) => regionCost(s, canvasId, r.id, pieceId));
  // She upgrades mid-piece: new pieces get the new price, this one keeps its own.
  s.stations.mixers[0].level *= 2;
  assert.ok(regionCost(s, canvasId, regions[0].id) > locked[0]);
  regions.forEach((rg, i) => {
    assert.equal(regionCost(s, canvasId, rg.id, pieceId), locked[i]);
    addStock(s, 'woad', locked[i]);
    const r = paintRegion(s, { pieceId, regionId: rg.id, colorId: 'woad' }, NOW + 60e3);
    assert.equal(r.ok, true);
    assert.equal(r.jars, locked[i]);
    assert.equal(piece.jars[rg.id], locked[i]);
  });
  assert.equal(stockOf(s, 'woad'), 0);
  // Value = Σ stored jars × price × factors; signing agrees with the preview.
  const v = pieceValue(s, piece, NOW);
  const paint = locked.reduce((a, n) => a + n, 0) * colorPrice(s, 'woad');
  assert.ok(Math.abs(v.paint - paint) < 1e-9 * paint);
  assert.ok(Math.abs(v.value - paint * VALUE_MULT * v.rarity * v.variety * v.taste) < 1e-9 * v.value);
  const sig = signPiece(s, { pieceId, title: '' }, NOW + 120e3);
  assert.ok(Math.abs(sig.value - v.value) < 1e-9 * v.value);
  // Admission repays the paint's sale value within a day (spec: about 11 hours
  // for a typical piece; a primary-only piece is the slowest case).
  const repayH = paint / (sig.value * ADMISSION_RATE) / 3600;
  assert.ok(repayH > 4 && repayH < 24, `repays in ${repayH.toFixed(1)} h`);
});

test('gallery: clearRegion undoes a pane on an unsigned piece without a refund', () => {
  const s = galleryState();
  const canvasId = s.gallery.canvases[0];
  const regions = regionsOf(getCanvas(canvasId));
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  const need = regionCost(s, canvasId, regions[0].id, pieceId);
  addStock(s, 'madder', need);
  assert.equal(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'madder' }, NOW).ok, true);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, true);
  assert.equal(piece.regions[regions[0].id], undefined);
  assert.equal(piece.purity[regions[0].id], undefined);
  assert.equal(piece.jars[regions[0].id], undefined);
  assert.equal(stockOf(s, 'madder'), 0, 'paint is not refunded');
  assert.equal(pieceValue(s, piece, NOW).value, 0);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, false, 'already bare');
  assert.equal(clearRegion(s, { pieceId: 'nope', regionId: regions[0].id }).ok, false);
  // Signed pieces are final.
  for (const rg of regions) {
    addStock(s, 'ochre', regionCost(s, canvasId, rg.id, pieceId));
    assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: 'ochre' }, NOW).ok, true);
  }
  assert.equal(signPiece(s, { pieceId, title: 'Done' }, NOW).ok, true);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, false);
  assert.equal(piece.regions[regions[0].id], 'ochre');
  assert.equal(discardPiece(s, { pieceId }).ok, false, 'signed pieces stay');
});

test('gallery: painting consumes regionCost jars, highest purity first; repaint allowed', () => {
  const s = producing(galleryState());
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const region = regionsOf(getCanvas(canvasId))[0];
  const need = regionCost(s, canvasId, region.id, pieceId);
  assert.ok(need > 1, `${need} jars`);
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
    addStock(s, c, regionCost(s, canvasId, rg.id, pieceId));
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
