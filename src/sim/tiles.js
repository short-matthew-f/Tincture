// sim/tiles.js — the Tile Room as sim actions on state (pure; docs/PLAN-v0.3.md "Tile Room").
// The rules live in src/puzzles/tiles.js; this module owns the save shape, her
// glazes, the turn flow (her take -> Ida's turn -> score the round -> deal), the
// coins, the finished mosaics, and the hooks for quests and events.
//
// state.tiles = {
//   game: TilesGame|null,     // puzzles/tiles.js game (+ game.colors: her five glaze ids)
//   pending: false,           // her move is placed; Ida's turn and/or the scoring is owed
//   undo: TilesGame|null,     // the game before her last take (Undo until Ida moves)
//   paid: 0,                  // coins this wall has paid so far
//   lastGain: null,           // points the last scored round added (the bar's "Round N is done: +X")
//   walls: 0, best: 0,        // finished walls, best final score
//   settings: { rival: true },// Ida plays (her setting; new walls start with it)
//   glazes: [],               // the five glaze ids she picked last (empty: defaults)
//   mosaics: [Mosaic],        // finished walls, newest last (MOSAIC_KEEP kept)
// }
// Mosaic = {id, at, score, base, bonus, coins, colors:[5 ids], wall:'25 chars of 0/1', rival, rounds, exhausted}
//
// A reload mid-turn resumes exactly: every step is one act (saved at once), and
// `pending` says which follow-up is owed. The game is plain JSON and its bag is
// seeded from state.seed (stateRng) when a wall starts.
//
// Coins (kept modest so hand orders stay the best coins per active minute):
//   every point (placed tiles, seconds, end bonuses) pays POINT_MINUTES of an
//   order's base pay (orders.orderBasePay(state, 1)), and a finished wall adds
//   WALL_MINUTES more; both × incomeMultiplier. orderBasePay follows her income,
//   so the Tile Room stays relevant in every era. See tools/balance/TUNING.md
//   "Tile Room" for the reasoning.
//
// Hooks for quests and events (only existing exports are called):
//   questEvent(state, 'tilesRound', 1, {points}) per round scored
//   questEvent(state, 'mosaicFinished', 1, {score, colors}) per finished wall
//   eventPoints(state, 'mosaic', 1, {colors}) per finished wall
// Domain events (bus): 'tilesRound' {round, points, coins}, 'mosaicFinished'
// {mosaicId, score, coins, walls}, 'tilesWall' {colors} (a new wall starts).

import * as R from '../puzzles/tiles.js';
import { emit } from './bus.js';
import { stateRng } from '../rng.js';
import { deltaEHex } from '../color.js';
import { colorFamily, colorHex, incomeMultiplier } from './economy.js';
import { earn } from './factory.js';
import { orderBasePay } from './orders.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { CATALOG } from '../content/catalog.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** One point pays this many minutes of an order's base pay. */
export const POINT_MINUTES = 0.05;
/** A finished wall pays this many minutes of an order's base pay on top. */
export const WALL_MINUTES = 3;
/** Finished mosaics kept on the shelf (oldest leave first). */
export const MOSAIC_KEEP = 24;
export const GLAZE_COUNT = 5;

/** Fresh state.tiles (createInitialState uses it). */
export function initialTiles() {
  return {
    game: null, pending: false, undo: null, paid: 0, lastGain: null,
    walls: 0, best: 0, settings: { rival: true }, glazes: [], mosaics: [],
  };
}

/**
 * ensureTiles(state) -> state.tiles, repaired in place: missing keys filled,
 * a saved game that no longer adds up (or an undo snapshot that does not)
 * dropped, so a broken save never locks the Tile Room.
 */
export function ensureTiles(state) {
  if (!isObj(state.tiles)) state.tiles = initialTiles();
  const t = state.tiles;
  const d = initialTiles();
  for (const k of Object.keys(d)) if (t[k] === undefined) t[k] = d[k];
  if (!isObj(t.settings)) t.settings = { rival: true };
  if (typeof t.settings.rival !== 'boolean') t.settings.rival = true;
  if (t.game !== null && !R.isValidGame(t.game)) { t.game = null; t.pending = false; t.undo = null; }
  if (t.undo !== null && !R.isValidGame(t.undo)) t.undo = null;
  if (!t.game) { t.pending = false; t.undo = null; }
  t.pending = !!t.pending;
  if (!Array.isArray(t.glazes)) t.glazes = [];
  if (!Array.isArray(t.mosaics)) t.mosaics = [];
  t.walls = Math.max(0, Math.floor(num(t.walls)));
  t.best = Math.max(0, num(t.best));
  t.paid = Math.max(0, num(t.paid));
  if (t.lastGain !== null && !Number.isFinite(t.lastGain)) t.lastGain = null;
  return t;
}

/** Has she bought the Tile Room (src/sim/unlocks.js 'tiles')? */
export function unlocked(state) {
  return !!(state && state.unlocks && state.unlocks.tiles);
}

// ---------------------------------------------------------------------------
// Glazes: her five colors
// ---------------------------------------------------------------------------

const discoveredIds = (state) => Object.keys((state && state.catalog && state.catalog.discovered) || {});

/** Number of hue families among her discovered colors. */
export function familiesAvailable(state) {
  return new Set(discoveredIds(state).map(colorFamily)).size;
}

function spread(pool, chosen, n, { newFamily }) {
  const out = chosen.slice();
  const fams = new Set(out.map(colorFamily));
  while (out.length < n) {
    let best = null;
    let bestScore = -1;
    for (const id of pool) {
      if (out.includes(id)) continue;
      if (newFamily && fams.has(colorFamily(id))) continue;
      const hex = colorHex(id);
      const near = out.length ? Math.min(...out.map((o) => deltaEHex(hex, colorHex(o)))) : 100;
      if (near > bestScore) { best = id; bestScore = near; }
    }
    if (!best) break;
    out.push(best);
    fams.add(colorFamily(best));
  }
  return out;
}

/**
 * defaultGlazes(state) -> five discovered color ids from different hue
 * families: the glazes she picked last, then her Merge Shelf chips, then the
 * discovered colors that sit furthest apart. Falls back to any distinct
 * discovered colors when she has fewer than five families (glyphs keep them
 * apart), and to catalog colors only when she has fewer than five colors.
 */
export function defaultGlazes(state) {
  const disc = discoveredIds(state);
  const t = isObj(state && state.tiles) ? state.tiles : {};
  const prefer = [...(Array.isArray(t.glazes) ? t.glazes : []), ...((state && state.shelf && Array.isArray(state.shelf.colors)) ? state.shelf.colors : [])]
    .filter((id, i, a) => typeof id === 'string' && disc.includes(id) && a.indexOf(id) === i);
  const out = [];
  const fams = new Set();
  for (const id of prefer) {
    if (out.length >= GLAZE_COUNT) break;
    const f = colorFamily(id);
    if (fams.has(f)) continue;
    fams.add(f);
    out.push(id);
  }
  let list = spread(disc, out, GLAZE_COUNT, { newFamily: true });
  if (list.length < GLAZE_COUNT) list = spread(disc, list, GLAZE_COUNT, { newFamily: false });
  if (list.length < GLAZE_COUNT) list = spread(CATALOG.map((c) => c.id), list, GLAZE_COUNT, { newFamily: false });
  return list.slice(0, GLAZE_COUNT);
}

/**
 * checkGlazes(state, ids) -> {ok, reason?}: five distinct discovered colors,
 * each from its own hue family (when she has five families to choose from).
 * reasons: 'count' | 'discovered' | 'family'.
 */
export function checkGlazes(state, ids) {
  if (!Array.isArray(ids) || ids.length !== GLAZE_COUNT || new Set(ids).size !== GLAZE_COUNT) return { ok: false, reason: 'count' };
  const disc = new Set(discoveredIds(state));
  if (!ids.every((id) => typeof id === 'string' && disc.has(id))) return { ok: false, reason: 'discovered' };
  const fams = new Set(ids.map(colorFamily));
  if (fams.size < Math.min(GLAZE_COUNT, familiesAvailable(state))) return { ok: false, reason: 'family' };
  return { ok: true };
}

/** The glazes the next wall would use: her picked set when still valid, else defaults. */
export function nextGlazes(state) {
  const t = isObj(state && state.tiles) ? state.tiles : {};
  const mine = Array.isArray(t.glazes) ? t.glazes : [];
  return checkGlazes(state, mine).ok ? mine.slice() : defaultGlazes(state);
}

/** setGlazes(state, {colors}) -> {ok, reason?}: remembers her five for the next wall. */
export function setGlazes(state, { colors } = {}) {
  const t = ensureTiles(state);
  const chk = checkGlazes(state, colors);
  if (!chk.ok) return chk;
  t.glazes = colors.slice();
  return { ok: true };
}

/** The five ids of the game in play (or the next wall's). */
export function gameColors(state) {
  const g = state && state.tiles && state.tiles.game;
  if (g && Array.isArray(g.colors) && g.colors.length === GLAZE_COUNT) return g.colors.slice();
  return nextGlazes(state);
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

/** Coins one point pays now. */
export function coinsPerPoint(state, now) {
  return Math.max(0, num(orderBasePay(state, 1) * POINT_MINUTES * incomeMultiplier(state, now)));
}

/** Coins a finished wall adds on top of its points. */
export function wallBonusCoins(state, now) {
  return Math.max(0, num(orderBasePay(state, WALL_MINUTES) * incomeMultiplier(state, now)));
}

/** quote(state, now) -> {perPoint, wallBonus} for the screen's reward line. */
export function quote(state, now) {
  return { perPoint: coinsPerPoint(state, now), wallBonus: wallBonusCoins(state, now) };
}

function pay(state, coins) {
  const t = ensureTiles(state);
  const c = earn(state, coins);
  t.paid = num(t.paid) + c;
  return c;
}

// ---------------------------------------------------------------------------
// The turn flow (each step one act)
// ---------------------------------------------------------------------------

/** phase(state) -> 'none'|'over'|'pending'|'deal'|'play': what the bottom bar offers next. */
export function phase(state) {
  const t = state && state.tiles;
  const g = t && t.game;
  if (!g) return 'none';
  if (g.over) return 'over';
  if (t.pending) return 'pending';
  if (R.roundOver(g)) return t.lastGain === null && hasScoring(g) ? 'pending' : 'deal';
  return 'play';
}

/**
 * startWall(state, {colors?, rival?}, now) -> {ok, colors} | {ok:false, reason}.
 * A new wall in her five glazes (default nextGlazes). A wall in progress is
 * replaced (the screen confirms first). reasons: 'locked' | glaze reasons.
 */
export function startWall(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  if (!unlocked(state)) return { ok: false, reason: 'locked' };
  const t = ensureTiles(state);
  const colors = Array.isArray(args.colors) ? args.colors.slice() : nextGlazes(state);
  const chk = checkGlazes(state, colors);
  if (!chk.ok && Array.isArray(args.colors)) return chk;
  const use = chk.ok ? colors : defaultGlazes(state);
  if (typeof args.rival === 'boolean') t.settings.rival = args.rival;
  const seed = Math.floor(stateRng(state)() * 4294967296) >>> 0;
  t.game = R.newGame(seed || 1, { rival: t.settings.rival, colors: use });
  t.glazes = use.slice();
  t.pending = false;
  t.undo = null;
  t.paid = 0;
  t.lastGain = null;
  emit(state, 'tilesWall', { colors: use.slice() });
  return { ok: true, colors: use.slice() };
}

/**
 * take(state, {source, index, color, line}, now) -> {ok, moved, pending} | {ok:false, reason}.
 * Her turn. Afterwards Ida's turn (or the scoring) is owed when she plays or the round is over.
 * reasons: 'none' | 'over' | 'pending' (resolve Ida's turn first) | rule reasons.
 */
export function take(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  const t = ensureTiles(state);
  const g = t.game;
  if (!g) return { ok: false, reason: 'none' };
  if (g.over) return { ok: false, reason: 'over' };
  if (t.pending) return { ok: false, reason: 'pending' };
  const r = R.take(g, { source: args.source, index: num(args.index), color: args.color, line: args.line });
  if (!r.ok) return r;
  t.undo = g;
  t.game = r.state;
  t.pending = !!(r.state.rival || R.roundOver(r.state));
  t.lastGain = null;
  return { ok: true, moved: r.moved, pending: t.pending };
}

/** undo(state) -> {ok}: takes back her last take (until Ida moves or the round is scored). */
export function undo(state) {
  const t = ensureTiles(state);
  if (!t.game || !t.undo || t.game.over) return { ok: false, reason: 'none' };
  t.game = t.undo;
  t.undo = null;
  t.pending = false;
  return { ok: true };
}

/**
 * idaTurn(state) -> {ok, dish, color, tiles, leftover, roundOver}. Ida takes
 * her dish (when she plays and a dish holds tiles); the Undo window closes.
 * `pending` stays set only when the round is now over (the scoring is owed).
 */
export function idaTurn(state) {
  const t = ensureTiles(state);
  const g = t.game;
  if (!g || g.over || !t.pending) return { ok: false, reason: 'none', dish: -1 };
  t.undo = null;
  let res = { dish: -1, color: -1, tiles: 0, leftover: 0 };
  if (!R.roundOver(g)) {
    const r = R.rivalTurn(g);
    t.game = r.state;
    res = { dish: r.dish, color: r.color, tiles: r.tiles, leftover: r.leftover };
  }
  const over = R.roundOver(t.game);
  t.pending = over;
  return { ok: true, ...res, roundOver: over };
}

/**
 * sweep(state) -> {ok, count}: "Finish the round" once only the middle is
 * left; those tiles go to the seconds basket and the scoring is owed.
 */
export function sweep(state) {
  const t = ensureTiles(state);
  const g = t.game;
  if (!g || g.over) return { ok: false, count: 0 };
  if (t.pending && !R.roundOver(g)) idaTurn(state); // a pending Ida turn first
  const r = R.sweepMiddle(t.game);
  if (!r.ok) return { ok: false, count: 0 };
  t.game = r.state;
  t.undo = null;
  t.pending = true;
  return { ok: true, count: r.count };
}

/**
 * scoreRound(state, args, now) -> {ok, round, placements, seconds, secondsCount,
 * points, coins, gameOver, final?}. Full lines set their tiles, seconds sell,
 * the round's points pay coins. When a wall row is complete (or the shelf ran
 * bare) the wall finishes: end bonuses, the completion bonus, a mosaic.
 */
export function scoreRound(state, args = {}, now = 0) {
  const t = ensureTiles(state);
  const g = t.game;
  if (!g || g.over || !R.roundOver(g)) return { ok: false, reason: 'none' };
  if (!t.pending && !(t.lastGain === null && hasScoring(g))) return { ok: false, reason: 'scored' };
  const e = R.endRound(g);
  t.game = e.state;
  t.pending = false;
  t.undo = null;
  const points = e.placements.reduce((n, p) => n + p.points, 0) + e.seconds;
  t.lastGain = points;
  const coins = pay(state, points * coinsPerPoint(state, now));
  questEvent(state, 'tilesRound', 1, { points });
  emit(state, 'tilesRound', { round: g.round, points, coins });
  const out = {
    ok: true, round: g.round, placements: e.placements, seconds: e.seconds, secondsCount: e.secondsCount,
    points, coins, gameOver: e.gameOver,
  };
  if (e.gameOver) out.final = finishWall(state, now);
  return out;
}

/**
 * deal(state) -> {ok, round, over, final?}: deals the next round once the
 * last one is scored. A bare shelf (no tiles left anywhere) finishes the wall.
 */
export function deal(state, args = {}, now = 0) {
  const t = ensureTiles(state);
  const g = t.game;
  if (!g || g.over || t.pending || !R.roundOver(g)) return { ok: false, reason: 'none' };
  if (t.lastGain === null && hasScoring(g)) return { ok: false, reason: 'score' };
  t.game = R.dealRound(g);
  t.lastGain = null;
  t.undo = null;
  if (t.game.over) return { ok: true, round: t.game.round, over: true, final: finishWall(state, now) };
  return { ok: true, round: t.game.round, over: false };
}

/** Is there anything for endRound to score (a full line or a second)? */
function hasScoring(g) {
  return g.seconds.length > 0 || g.lines.some((L, i) => L.n === i + 1);
}

function wallString(g) {
  return g.wall.map((row) => row.map((x) => (x ? '1' : '0')).join('')).join('');
}

/** End bonuses, the completion bonus and the mosaic record (the game is already over). */
function finishWall(state, now) {
  const t = ensureTiles(state);
  const g = t.game;
  g.over = true;
  const fs = R.finalScore(g);
  const bonusCoins = pay(state, fs.bonus * coinsPerPoint(state, now));
  const wallCoins = pay(state, wallBonusCoins(state, now));
  t.walls = num(t.walls) + 1;
  t.best = Math.max(num(t.best), fs.total);
  t.pending = false;
  t.undo = null;
  const colors = Array.isArray(g.colors) ? g.colors.slice() : gameColors(state);
  const mosaic = {
    id: `mosaic-${t.walls}`, at: num(now), score: fs.total, base: g.score, bonus: fs.bonus,
    coins: Math.round(num(t.paid)), colors, wall: wallString(g), rival: !!g.rival, rounds: g.round, exhausted: !!g.exhausted,
  };
  t.mosaics.push(mosaic);
  if (t.mosaics.length > MOSAIC_KEEP) t.mosaics.splice(0, t.mosaics.length - MOSAIC_KEEP);
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  questEvent(state, 'mosaicFinished', 1, { score: fs.total, colors });
  eventPoints(state, 'mosaic', 1, { colors });
  emit(state, 'mosaicFinished', { mosaicId: mosaic.id, score: fs.total, coins: mosaic.coins, walls: t.walls });
  return { ...fs, bonusCoins, wallCoins, coins: mosaic.coins, mosaicId: mosaic.id };
}

/** setRival(state, {on}) -> {ok, rival}: Ida plays or rests (this wall and the next). */
export function setRival(state, { on } = {}) {
  const t = ensureTiles(state);
  t.settings.rival = !!on;
  const g = t.game;
  if (g && !g.over) {
    t.game = { ...g, rival: !!on };
    if (t.pending && !R.roundOver(t.game) && !on) t.pending = false;
  }
  return { ok: true, rival: t.settings.rival };
}

/** summary(state) -> a cheap read for the Puzzles hub card. */
export function summary(state) {
  const t = state && state.tiles;
  const g = t && t.game;
  return {
    open: unlocked(state),
    playing: !!(g && !g.over),
    round: g ? g.round : 0,
    score: g ? g.score : 0,
    placed: g ? R.wallCount(g) : 0,
    walls: t ? num(t.walls) : 0,
    best: t ? num(t.best) : 0,
    phase: phase(state),
  };
}
