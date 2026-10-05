// gallery.js — painting, signing, hanging, admission, visitors (pure).
// Implements docs/DESIGN.md "The Gallery": paint canvases region by region with
// any color she owns, unlimited repaint until signed, value from rarity ×
// purity (via price) × variety × weekly taste, admission 2×10^-5 of value per
// second (auto-collected), visitor comments in
// her color names, a visiting collector about every 2 days (3× value for a
// print; she keeps the original). Pieces survive every reset.
//
// Paint scales with her factory (docs/DESIGN.md "Balance model › Gallery and
// Merge Shelf in the simulation": each piece uses 20 minutes of production in
// paint). A whole canvas costs PAINT_SECONDS of her current mixer output,
// split across regions by size; the rate is locked when the piece is started
// (`paintRate`) so panes don't change price mid-piece, and every region's jars
// are stored at paint time so the value preview and the signed value agree.
//
// gallery.sold: [{id, canvas, title, soldAt, coins, thumb:{regionId: colorId}}], oldest first (memory
// cards for pieces sold to a collector; the piece itself is gone).
//
// Piece {id, canvas, title, regions:{regionId: colorId}, purity:{regionId: p},
//        jars:{regionId: n}, paintRate, startedAt, signedAt, value, hung}

import { CANVASES, getCanvas, starterCanvases } from '../content/canvases.js';
import { VISITOR_COMMENTS, COMMENT_PLACES, fillComment } from '../content/names.js';
import { FAMILIES } from '../content/routes.js';
import { isoWeekKey } from '../format.js';
import { stateRng, uuid } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { colorPrice, colorTier, colorFamily, incomeMultiplier, rates } from './economy.js';
import { takeStock, PURITY_ORDER } from './storage.js';
import { displayName } from './discovery.js';

/** Legacy fixed price (jars per unit of region size); only a fallback for old saves. */
export const JARS_PER_SIZE = 3;
/** A whole canvas costs this many seconds of her current production in paint. */
export const PAINT_SECONDS = 150;
/** Production floor (jars/s) for pricing paint, so the first canvases are cheap but not free. */
export const MIN_PAINT_RATE = 0.05;
/** Piece value multiplier on the paint's sale value (with rarity, variety, taste). */
export const VALUE_MULT = 1;
export const ADMISSION_RATE = 2e-5;
export const RARITY = Object.freeze({ primary: 1, secondary: 1.2, tertiary: 1.5, earth: 1.5, tint: 2, shade: 2, wild: 3 });
export const VARIETY_STEP = 0.02;
export const VARIETY_CAP = 0.4;
export const TASTE_BONUS = 0.25;
export const COLLECTOR_MS = 2 * 86400e3;
export const COLLECTOR_MULT = 3;
export const START_WALLS = 4;
/** A collector who buys the original pays this many times its signed value. */
export const SELL_MULT = 2;
/** Most "sold" memories kept in the save (the Gallery shows 12). */
export const SOLD_KEEP = 60;

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function gal(state) {
  if (!state.gallery) {
    state.gallery = { unlocked: false, canvases: [], pieces: [], walls: START_WALLS, hung: [], taste: null, nextCollectorAt: 0, collectorOffer: null };
  }
  const g = state.gallery;
  if (!Array.isArray(g.pieces)) g.pieces = [];
  if (!Array.isArray(g.hung)) g.hung = [];
  if (!Array.isArray(g.canvases)) g.canvases = [];
  if (!Array.isArray(g.sold)) g.sold = [];
  return g;
}

function canvasDef(id) {
  try { return getCanvas(id) ?? CANVASES.find((c) => c.id === id) ?? null; } catch { return null; }
}

function regionList(canvas) {
  const r = canvas?.regions;
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') return Object.entries(r).map(([id, v]) => ({ id, ...v }));
  return [];
}

function findPiece(state, pieceId) {
  return gal(state).pieces.find((p) => p.id === pieceId) ?? null;
}

/**
 * galleryOpen(state) — the Gallery is a coin-bought unlock (the Gallery Wing,
 * src/sim/unlocks.js): reads state.unlocks.gallery. `gallery.unlocked` mirrors
 * it (kept in step by unlock() and prestige.renovate); hand-built states with
 * no `unlocks` block fall back to that mirror.
 */
export function galleryOpen(state) {
  if (state?.unlocks && typeof state.unlocks === 'object') return !!state.unlocks.gallery;
  return !!state?.gallery?.unlocked;
}

/**
 * unlock(state) — the Gallery Wing opens: state.unlocks.gallery, starter
 * canvases (first time only), 4 walls. Idempotent.
 */
export function unlock(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  const g = gal(state);
  if (!state.unlocks || typeof state.unlocks !== 'object') state.unlocks = {};
  const wasOpen = !!state.unlocks.gallery && g.unlocked;
  state.unlocks.gallery = true;
  if (wasOpen) return { ok: false, already: true };
  g.unlocked = true;
  let starters = [];
  try { starters = starterCanvases(); } catch { starters = []; }
  const ids = starters.map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean);
  g.canvases = [...new Set([...g.canvases, ...ids])];
  g.walls = Math.max(num(g.walls, START_WALLS), START_WALLS);
  if (!g.taste) g.taste = weeklyTaste(now);
  emit(state, 'gallery', { unlocked: true });
  return { ok: true, canvases: g.canvases.slice() };
}

/** Add a canvas design to her collection (postcard sets, commissions, events, Heritage). */
export function addCanvas(state, args = {}) {
  const g = gal(state);
  if (!args.canvasId || g.canvases.includes(args.canvasId)) return { ok: false };
  g.canvases.push(args.canvasId);
  emit(state, 'canvas', { canvasId: args.canvasId });
  return { ok: true };
}

/** startPiece(state, {canvasId}, now) -> {ok, pieceId}. */
export function startPiece(state, args = {}, now = 0) {
  const g = gal(state);
  if (!galleryOpen(state)) return { ok: false, reason: 'locked' };
  if (!g.canvases.includes(args.canvasId) || !canvasDef(args.canvasId)) return { ok: false, reason: 'canvas' };
  const id = 'p-' + uuid(stateRng(state));
  g.pieces.push({ id, canvas: args.canvasId, title: '', regions: {}, purity: {}, jars: {}, paintRate: paintRate(state, now), startedAt: now, signedAt: 0, value: 0, hung: false });
  return { ok: true, pieceId: id };
}

/** Production (mixer jars/s) that paint is priced from, floored at MIN_PAINT_RATE. */
export function paintRate(state, now) {
  let jars = 0;
  try { jars = num(rates(state, now).jars); } catch { jars = 0; }
  return Math.max(MIN_PAINT_RATE, jars);
}

const sizeOf = (r) => Math.max(1, num(r?.size, 1));

/**
 * regionCost(state, canvasId, regionId, pieceId?) -> jars that region needs:
 * max(1, round(size / canvas size × production jars/s × PAINT_SECONDS)).
 * With `pieceId` it uses the rate locked when that piece was started. The old
 * call shape regionCost(canvasId, regionId) prices at the production floor.
 */
export function regionCost(state, canvasId, regionId, pieceId) {
  if (typeof state === 'string') { pieceId = undefined; regionId = canvasId; canvasId = state; state = null; }
  const regions = regionList(canvasDef(canvasId));
  const r = regions.find((x) => x.id === regionId);
  if (!r) return 0;
  const total = regions.reduce((s, x) => s + sizeOf(x), 0);
  const piece = pieceId && state ? findPiece(state, pieceId) : null;
  const rate = piece && num(piece.paintRate) > 0 ? piece.paintRate : (state ? paintRate(state) : MIN_PAINT_RATE);
  return Math.max(1, Math.round(sizeOf(r) / total * rate * PAINT_SECONDS));
}

/**
 * paintRegion(state, {pieceId, regionId, colorId}, now) -> {ok, jars, purity}.
 * Uses regionCost jars of the color (at the piece's locked rate), highest
 * purity first, and records them in piece.jars. Repainting is unlimited until
 * signed (the earlier paint is not refunded).
 */
export function paintRegion(state, args = {}, now = 0) {
  const p = findPiece(state, args.pieceId);
  if (!p || p.signedAt) return { ok: false, reason: 'piece' };
  if (!(num(p.paintRate) > 0)) p.paintRate = paintRate(state, now); // pieces started before paint scaled
  const need = regionCost(state, p.canvas, args.regionId, p.id);
  if (!need) return { ok: false, reason: 'region' };
  if (!state.catalog?.discovered?.[args.colorId]) return { ok: false, reason: 'color' };
  const have = num(state.stock?.[args.colorId]?.jars);
  if (have < need - 1e-9) return { ok: false, reason: 'stock', need, have };
  const got = takeStock(state, args.colorId, need, { prefer: 'high' });
  let purity = 'standard';
  let best = -1;
  for (const q of PURITY_ORDER) if (got.byPurity[q] > best + 1e-9) { best = got.byPurity[q]; purity = q; }
  p.regions[args.regionId] = args.colorId;
  p.purity[args.regionId] = purity;
  p.jars[args.regionId] = got.taken;
  questEvent(state, 'regionsPainted', 1, { colorId: args.colorId });
  eventPoints(state, 'paint', 1, { colorId: args.colorId });
  return { ok: true, jars: got.taken, purity };
}

/** Week's visitor taste: a hue family chosen by ISO week. */
export function weeklyTaste(now = 0) {
  const key = isoWeekKey(now);
  const m = /(\d+)-W(\d+)/.exec(key);
  const n = m ? Number(m[1]) * 53 + Number(m[2]) : 0;
  return FAMILIES[n % FAMILIES.length];
}

/** Value breakdown of a (possibly unsigned) piece. */
export function pieceValue(state, piece, now = 0) {
  const canvas = canvasDef(piece.canvas);
  const regions = regionList(canvas);
  const painted = regions.filter((r) => piece.regions[r.id]);
  if (!painted.length) return { value: 0, paint: 0, rarity: 1, variety: 1, taste: 1, mult: VALUE_MULT };
  let paint = 0;
  let rar = 0;
  const distinct = new Set();
  let tasteCount = 0;
  const taste = weeklyTaste(now);
  for (const r of painted) {
    const c = piece.regions[r.id];
    const jars = num(piece.jars?.[r.id], sizeOf(r) * JARS_PER_SIZE);
    paint += jars * colorPrice(state, c, piece.purity?.[r.id] ?? 'standard');
    rar += RARITY[colorTier(c)] ?? 1;
    distinct.add(c);
    if (colorFamily(c) === taste) tasteCount++;
  }
  const rarity = rar / painted.length;
  const variety = 1 + Math.min(VARIETY_CAP, VARIETY_STEP * distinct.size);
  const tasteMult = tasteCount / painted.length >= 0.5 ? 1 + TASTE_BONUS : 1;
  return { value: num(paint * VALUE_MULT * rarity * variety * tasteMult), paint, rarity, variety, taste: tasteMult, mult: VALUE_MULT };
}

/** signPiece(state, {pieceId, title}, now) -> {ok, value}. Every region must be painted. */
export function signPiece(state, args = {}, now = 0) {
  const p = findPiece(state, args.pieceId);
  if (!p || p.signedAt) return { ok: false, reason: 'piece' };
  const regions = regionList(canvasDef(p.canvas));
  const missing = regions.filter((r) => !p.regions[r.id]).length;
  if (missing > 0) return { ok: false, reason: 'unpainted', missing };
  const v = pieceValue(state, p, now);
  p.value = v.value;
  p.title = String(args.title ?? '').trim().slice(0, 40) || canvasDef(p.canvas)?.name || 'Untitled';
  p.signedAt = now;
  questEvent(state, 'pieceSigned', 1, { pieceId: p.id, value: p.value });
  emit(state, 'signed', { pieceId: p.id, value: p.value });
  return { ok: true, value: p.value, breakdown: v };
}

/**
 * clearRegion(state, {pieceId, regionId}) -> {ok}. Undo for an unsigned piece:
 * the region goes back to bare paper. The paint is not refunded.
 */
export function clearRegion(state, args = {}) {
  const p = findPiece(state, args.pieceId);
  if (!p || p.signedAt) return { ok: false, reason: 'piece' };
  if (!p.regions?.[args.regionId]) return { ok: false, reason: 'region' };
  delete p.regions[args.regionId];
  if (p.purity) delete p.purity[args.regionId];
  if (p.jars) delete p.jars[args.regionId];
  return { ok: true };
}

/**
 * Scrap an unsigned piece: it leaves the easel, the jars already spent stay
 * spent (no refund), and its canvas is free to paint again. Signed pieces
 * stay (see sellPiece).
 */
export function discardPiece(state, args = {}) {
  const g = gal(state);
  const i = g.pieces.findIndex((p) => p.id === args.pieceId && !p.signedAt);
  if (i < 0) return { ok: false };
  const [p] = g.pieces.splice(i, 1);
  return { ok: true, canvas: p.canvas, panes: Object.keys(p.regions || {}).length };
}

/**
 * canvasAvailable(state, canvasId) -> can she start a piece on this canvas?
 * Designs are never used up: she owns the canvas, so a sold or scrapped
 * piece's canvas (and one still on the easel or on a wall) can be painted
 * again at any time.
 */
export function canvasAvailable(state, canvasId) {
  return gal(state).canvases.includes(canvasId) && !!canvasDef(canvasId);
}

/**
 * sellOffer(state, pieceId, now) -> {pieceId, coins, value} | null: what a collector
 * pays for a signed piece's original: its signed value × SELL_MULT × income multiplier.
 */
export function sellOffer(state, pieceId, now = 0) {
  const p = findPiece(state, pieceId);
  if (!p || !p.signedAt) return null;
  const value = num(p.value) > 0 ? num(p.value) : pieceValue(state, p, now).value;
  return { pieceId: p.id, value, coins: value * SELL_MULT * incomeMultiplier(state, now) };
}

/**
 * sellPiece(state, {pieceId}, now) -> {ok, coins}. A collector buys the original
 * of a SIGNED piece: pays once, the piece comes off its wall (if hung) and out
 * of `pieces`, and a memory record goes to `gallery.sold`. Her canvas stays hers.
 */
export function sellPiece(state, args = {}, now = 0) {
  const g = gal(state);
  const offer = sellOffer(state, args.pieceId, now);
  if (!offer) return { ok: false, reason: 'piece' };
  const p = findPiece(state, args.pieceId);
  const coins = num(offer.coins);
  g.hung = g.hung.filter((id) => id !== p.id);
  g.pieces = g.pieces.filter((x) => x.id !== p.id);
  if (g.collectorOffer && g.collectorOffer.pieceId === p.id) g.collectorOffer = null;
  g.sold.push({ id: p.id, canvas: p.canvas, title: p.title || canvasDef(p.canvas)?.name || 'Untitled', soldAt: now, coins, thumb: { ...p.regions } });
  if (g.sold.length > SOLD_KEEP) g.sold.splice(0, g.sold.length - SOLD_KEEP);
  state.coins = num(state.coins) + coins;
  state.runEarned = num(state.runEarned) + coins;
  if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
  questEvent(state, 'pieceSold', 1, { pieceId: p.id, coins });
  emit(state, 'pieceSold', { pieceId: p.id, coins });
  return { ok: true, coins };
}

export function hang(state, args = {}) {
  const g = gal(state);
  const p = findPiece(state, args.pieceId);
  if (!p || !p.signedAt) return { ok: false, reason: 'piece' };
  if (p.hung) return { ok: true };
  if (g.hung.length >= num(g.walls, START_WALLS)) return { ok: false, reason: 'walls' };
  p.hung = true;
  g.hung.push(p.id);
  return { ok: true };
}

export function unhang(state, args = {}) {
  const g = gal(state);
  const p = findPiece(state, args.pieceId);
  if (!p || !p.hung) return { ok: false };
  p.hung = false;
  g.hung = g.hung.filter((id) => id !== p.id);
  return { ok: true };
}

/** Admission coins per second right now. */
export function admissionRate(state, now) {
  const g = gal(state);
  let v = 0;
  for (const id of g.hung) v += num(findPiece(state, id)?.value);
  return v * ADMISSION_RATE * incomeMultiplier(state, now);
}

/**
 * tickAdmission(state, now) -> {coins}. Hung pieces earn 2e-5 × value per second
 * (auto-collected); also refreshes the weekly taste and schedules collectors.
 */
export function tickAdmission(state, now = 0) {
  const g = gal(state);
  const last = num(g.lastAdmissionAt, num(state.lastTick, now));
  g.lastAdmissionAt = now;
  if (!galleryOpen(state)) return { coins: 0 };
  g.taste = weeklyTaste(now);
  const dt = Math.max(0, now - last) / 1000;
  const coins = admissionRate(state, now) * dt;
  if (coins > 0) {
    state.coins = num(state.coins) + coins;
    state.runEarned = num(state.runEarned) + coins;
    if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
  }
  tickCollector(state, now);
  return { coins };
}

function tickCollector(state, now) {
  const g = gal(state);
  if (!g.hung.length) return;
  const rng = stateRng(state);
  if (!(num(g.nextCollectorAt) > 0)) { g.nextCollectorAt = now + COLLECTOR_MS * (0.75 + 0.5 * rng()); return; }
  if (g.collectorOffer && !(g.collectorOffer.until > now)) g.collectorOffer = null;
  if (now < g.nextCollectorAt || g.collectorOffer) return;
  const id = g.hung[Math.floor(rng() * g.hung.length) % g.hung.length];
  const p = findPiece(state, id);
  const next = now + COLLECTOR_MS * (0.75 + 0.5 * rng());
  g.nextCollectorAt = next;
  if (!p) return;
  g.collectorOffer = { pieceId: id, pay: num(p.value) * COLLECTOR_MULT * incomeMultiplier(state, now), until: next };
  emit(state, 'collector', { pieceId: id, pay: g.collectorOffer.pay });
}

/** collectorOffer(state, now) -> the visiting collector's offer {pieceId, pay, until} or null (schedules the next visit). */
export function collectorOffer(state, now = 0) {
  if (!galleryOpen(state)) return null;
  tickCollector(state, now);
  return gal(state).collectorOffer ?? null;
}

/** acceptCollector(state, args, now) -> {ok, coins}: sells a print; she keeps the original. */
export function acceptCollector(state, args = {}, now = 0) {
  const g = gal(state);
  const o = g.collectorOffer;
  if (!o || (num(o.until) > 0 && now > o.until)) return { ok: false };
  g.collectorOffer = null;
  const coins = num(o.pay);
  state.coins = num(state.coins) + coins;
  state.runEarned = num(state.runEarned) + coins;
  if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
  const p = findPiece(state, o.pieceId);
  if (p) p.prints = num(p.prints) + 1;
  return { ok: true, coins };
}

export function declineCollector(state) {
  gal(state).collectorOffer = null;
  return { ok: true };
}

/**
 * visitorComment(state, pieceId, rng) -> string. A short visitor note that uses
 * her name for one of the colors on the piece (the most-used one, usually).
 */
export function visitorComment(state, pieceId, rng = stateRng(state)) {
  const p = findPiece(state, pieceId);
  if (!p) return '';
  const counts = {};
  for (const c of Object.values(p.regions)) counts[c] = (counts[c] ?? 0) + 1;
  const colors = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!colors.length) return '';
  const pickIdx = (n) => Math.min(n - 1, Math.floor(rng() * n));
  const color = displayName(state, colors[rng() < 0.6 ? 0 : pickIdx(colors.length)]);
  const tpl = VISITOR_COMMENTS[pickIdx(VISITOR_COMMENTS.length)];
  const place = COMMENT_PLACES[pickIdx(COMMENT_PLACES.length)];
  return fillComment(tpl, { color, place });
}
