import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  unlock, startPiece, paintRegion, signPiece, hang, unhang, tickAdmission, weeklyTaste,
  visitorComment, acceptCollector, pieceValue, sizeFactor, clearRegion, paintRate, discardPiece,
  sellPiece, sellOffer, canvasAvailable, SELL_MULT,
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

test('gallery: painting is free: stock is untouched and none is needed', () => {
  const s = producing(galleryState());
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const regions = regionsOf(getCanvas(canvasId));
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  assert.equal(stockOf(s, 'madder'), 0);
  addStock(s, 'woad', 7);
  const before = JSON.stringify(s.stock);
  // No stock on hand is fine; a stocked color is not drawn down either.
  assert.deepEqual(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'madder' }, NOW), { ok: true });
  assert.equal(paintRegion(s, { pieceId, regionId: regions[1].id, colorId: 'woad' }, NOW).ok, true);
  assert.equal(JSON.stringify(s.stock), before, 'stock unchanged');
  assert.equal(stockOf(s, 'woad'), 7);
  assert.equal(piece.regions[regions[0].id], 'madder');
  // Repainting is free too; unknown regions and undiscovered colors are refused.
  assert.equal(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'woad' }, NOW).ok, true);
  assert.equal(piece.regions[regions[0].id], 'woad');
  assert.equal(paintRegion(s, { pieceId, regionId: 'nope', colorId: 'woad' }, NOW).reason, 'region');
  assert.equal(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'not-a-color' }, NOW).reason, 'color');
});

test('gallery: a finished piece is worth a modest, positive PAINT_SECONDS of production, nudged by canvas size', () => {
  const s = producing(galleryState());
  const jps = rates(s, NOW).jars;
  assert.ok(jps > MIN_PAINT_RATE);
  assert.equal(paintRate(s, NOW), jps);
  const canvasId = s.gallery.canvases[0];
  const regions = regionsOf(getCanvas(canvasId));
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  assert.equal(piece.paintRate, jps, 'rate locked at start');
  assert.equal(pieceValue(s, piece, NOW).value, 0, 'bare canvas');
  for (const rg of regions) paintRegion(s, { pieceId, regionId: rg.id, colorId: 'woad' }, NOW);
  const stock0 = JSON.stringify(s.stock);
  const v = pieceValue(s, piece, NOW);
  // She upgrades mid-piece: this piece keeps its own rate.
  s.stations.mixers[0].level *= 2;
  assert.equal(pieceValue(s, piece, NOW).value, v.value);
  // Value = rate × PAINT_SECONDS × size nudge × price × rarity × variety × taste.
  const expect = jps * PAINT_SECONDS * sizeFactor(canvasId) * colorPrice(s, 'woad') * VALUE_MULT * v.rarity * v.variety * v.taste;
  assert.ok(v.value > 0 && Math.abs(v.value - expect) < 1e-9 * expect);
  // Modest: at most a few minutes of income at one coin per jar-price, never absurd.
  const incomePerSec = jps * colorPrice(s, 'woad');
  assert.ok(v.value < 20 * 60 * incomePerSec, `${v.value} vs ${incomePerSec}/s`);
  assert.ok(v.value > 60 * incomePerSec, 'worth more than a minute of production');
  const sig = signPiece(s, { pieceId, title: '' }, NOW + 1000);
  assert.ok(Math.abs(sig.value - v.value) < 1e-9 * v.value);
  assert.equal(JSON.stringify(s.stock), stock0, 'signing spends nothing');
  // Admission repays the piece's colors within a day or so.
  const repayH = jps * PAINT_SECONDS * colorPrice(s, 'woad') / (sig.value * ADMISSION_RATE) / 3600;
  assert.ok(repayH > 1 && repayH < 24, `repays in ${repayH.toFixed(1)} h`);
});

test('gallery: a new player with no production still gets a small positive piece value; bigger canvases are worth a little more', () => {
  const s = galleryState();
  assert.equal(rates(s, NOW).jars, 0);
  assert.equal(paintRate(s, NOW), MIN_PAINT_RATE);
  assert.ok(sizeFactor('no-such-canvas') === 1);
  let small = Infinity; let big = 0;
  for (const canvasId of s.gallery.canvases) {
    const { pieceId } = startPiece(s, { canvasId }, NOW);
    for (const rg of regionsOf(getCanvas(canvasId))) paintRegion(s, { pieceId, regionId: rg.id, colorId: 'madder' }, NOW);
    const v = pieceValue(s, s.gallery.pieces.find((p) => p.id === pieceId), NOW).value;
    assert.ok(v > 0 && v < 2000, `${canvasId}: ${v}`);
    small = Math.min(small, v); big = Math.max(big, v);
  }
  assert.ok(sizeFactor('patchwork-quilt') > sizeFactor('painted-plate'));
  assert.ok(sizeFactor('heritage-tapestry') <= 1.6 && sizeFactor('painted-plate') >= 0.75);
  assert.ok(big >= small);
});

test('gallery: old pieces with jars/purity fields still load, price and sign', () => {
  const s = galleryState();
  const canvasId = s.gallery.canvases[0];
  const regions = regionsOf(getCanvas(canvasId));
  s.gallery.pieces.push({ id: 'old', canvas: canvasId, title: '', regions: Object.fromEntries(regions.map((r) => [r.id, 'madder'])),
    purity: Object.fromEntries(regions.map((r) => [r.id, 'pure'])), jars: Object.fromEntries(regions.map((r) => [r.id, 9999])), startedAt: NOW, signedAt: 0, value: 0, hung: false });
  const v = pieceValue(s, s.gallery.pieces[0], NOW).value;
  assert.ok(v > 0 && v < 2000, `jars field ignored: ${v}`);
  assert.equal(signPiece(s, { pieceId: 'old', title: 'Old' }, NOW).ok, true);
});

test('gallery: clearRegion undoes a pane on an unsigned piece', () => {
  const s = galleryState();
  const canvasId = s.gallery.canvases[0];
  const regions = regionsOf(getCanvas(canvasId));
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  assert.equal(paintRegion(s, { pieceId, regionId: regions[0].id, colorId: 'madder' }, NOW).ok, true);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, true);
  assert.equal(piece.regions[regions[0].id], undefined);
  assert.equal(stockOf(s, 'madder'), 0);
  assert.equal(pieceValue(s, piece, NOW).value, 0);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, false, 'already bare');
  assert.equal(clearRegion(s, { pieceId: 'nope', regionId: regions[0].id }).ok, false);
  // Signed pieces are final.
  for (const rg of regions) {
    assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: 'ochre' }, NOW).ok, true);
  }
  assert.equal(signPiece(s, { pieceId, title: 'Done' }, NOW).ok, true);
  assert.equal(clearRegion(s, { pieceId, regionId: regions[0].id }).ok, false);
  assert.equal(piece.regions[regions[0].id], 'ochre');
  assert.equal(discardPiece(s, { pieceId }).ok, false, 'signed pieces stay');
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
    assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: c }, NOW).ok, true);
  });
  const piece = s.gallery.pieces.find((p) => p.id === pieceId);
  const preview = pieceValue(s, piece, NOW);
  const sig = signPiece(s, { pieceId, title: 'Harbor at Dawn' }, NOW);
  assert.equal(sig.ok, true);
  assert.ok(sig.value > 0);
  assert.ok(Math.abs(sig.value - preview.value) < 1e-9);
  // Value = paint value × rarity × variety × taste; three primaries → rarity 1, variety +6%.
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

/** A fully painted, signed piece; returns {s, canvasId, pieceId, value, regions}. */
function signedPiece(s = galleryState(), title = 'Harbor at Dawn') {
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const regions = regionsOf(getCanvas(canvasId));
  for (const rg of regions) {
    assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: 'madder' }, NOW).ok, true);
  }
  const sig = signPiece(s, { pieceId, title }, NOW);
  assert.equal(sig.ok, true);
  return { s, canvasId, pieceId, value: sig.value, regions };
}

test('gallery: selling a signed piece pays value x2 once and removes it', () => {
  const { s, pieceId, value, canvasId } = signedPiece();
  const now = NOW + 5000;
  const offer = sellOffer(s, pieceId, now);
  assert.equal(SELL_MULT, 2);
  assert.ok(Math.abs(offer.coins - value * 2 * incomeMultiplier(s, now)) < 1e-9);
  const c0 = s.coins;
  const r = sellPiece(s, { pieceId }, now);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.coins - offer.coins) < 1e-9);
  assert.ok(Math.abs(s.coins - c0 - r.coins) < 1e-9);
  assert.equal(s.gallery.pieces.length, 0, 'the piece leaves the archive');
  // Once only.
  const again = sellPiece(s, { pieceId }, now);
  assert.equal(again.ok, false);
  assert.ok(Math.abs(s.coins - c0 - r.coins) < 1e-9, 'no second payment');
  // The canvas can be painted again.
  assert.equal(canvasAvailable(s, canvasId), true);
  assert.equal(startPiece(s, { canvasId }, now).ok, true);
});

test('gallery: selling a hung piece takes it down and updates the wall count and admission', () => {
  const { s, pieceId } = signedPiece();
  assert.equal(hang(s, { pieceId }).ok, true);
  assert.equal(s.gallery.hung.length, 1);
  s.lastTick = NOW;
  assert.ok(tickAdmission(s, NOW + 1000).coins > 0);
  const offer = { pieceId, pay: 1, until: NOW + 1e9 };
  s.gallery.collectorOffer = offer;
  assert.equal(sellPiece(s, { pieceId }, NOW + 2000).ok, true);
  assert.deepEqual(s.gallery.hung, []);
  assert.equal(s.gallery.collectorOffer, null, 'a visiting collector offer for the sold piece is withdrawn');
  const c = s.coins;
  const t = tickAdmission(s, NOW + 3600e3);
  assert.equal(t.coins, 0, 'nothing hung, no admission');
  assert.equal(s.coins, c);
});

test('gallery: a sold piece leaves a record, newest last, with its thumbnail', () => {
  const { s, pieceId, canvasId, regions } = signedPiece();
  const piece = s.gallery.pieces[0];
  const painted = { ...piece.regions };
  const r = sellPiece(s, { pieceId }, NOW + 9000);
  assert.equal(s.gallery.sold.length, 1);
  const rec = s.gallery.sold[0];
  assert.equal(rec.id, pieceId);
  assert.equal(rec.canvas, canvasId);
  assert.equal(rec.title, 'Harbor at Dawn');
  assert.equal(rec.soldAt, NOW + 9000);
  assert.equal(rec.coins, r.coins);
  assert.deepEqual(rec.thumb, painted);
  assert.equal(Object.keys(rec.thumb).length, regions.length);
  // A second sale appends.
  const b = signedPiece(s, 'Second');
  sellPiece(s, { pieceId: b.pieceId }, NOW + 10000);
  assert.deepEqual(s.gallery.sold.map((x) => x.title), ['Harbor at Dawn', 'Second']);
});

test('gallery: only signed pieces can be sold; unsigned ones are scrapped', () => {
  const s = producing(galleryState());
  const canvasId = s.gallery.canvases[0];
  const { pieceId } = startPiece(s, { canvasId }, NOW);
  const rg = regionsOf(getCanvas(canvasId))[0];
  assert.equal(paintRegion(s, { pieceId, regionId: rg.id, colorId: 'madder' }, NOW).ok, true);
  const coins = s.coins;
  assert.equal(sellPiece(s, { pieceId }, NOW).ok, false, 'unsigned pieces cannot be sold');
  assert.equal(sellPiece(s, { pieceId: 'nope' }, NOW).ok, false);
  assert.equal(s.gallery.pieces.length, 1);
  const d = discardPiece(s, { pieceId });
  assert.equal(d.ok, true);
  assert.equal(d.panes, 1);
  assert.equal(s.gallery.pieces.length, 0);
  assert.equal(s.coins, coins, 'no coins either');
  assert.equal(s.gallery.sold.length, 0, 'scrapping is not a sale');
  assert.equal(discardPiece(s, { pieceId }).ok, false);
  // The canvas is free again.
  assert.equal(canvasAvailable(s, canvasId), true);
  const again = startPiece(s, { canvasId }, NOW);
  assert.equal(again.ok, true);
  assert.deepEqual(s.gallery.pieces[0].regions, {});
  assert.equal(canvasAvailable(s, 'not-a-canvas'), false);
});
