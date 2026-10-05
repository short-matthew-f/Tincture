// tools/balance/sim-player.js — a scripted player that drives the REAL engine
// (src/sim) through a multi-day schedule. Implements docs/DESIGN.md "Balance
// model and testing" (profiles, greedy buyer, always-progress check, Gallery and
// Merge Shelf modeling) on top of the actual game rules instead of the old
// spreadsheet model. Used by tools/balance/run.js (tables) and
// test/balance.test.js (the "Automated balance tests" list).
//
// simulate({profile, seed, days, puzzles, tier}) -> RunResult (see bottom).
//
// Everything is deterministic: the engine's randomness lives in state.seed and
// the player's own choices (boards, tints) use a mulberry32 seeded from `seed`.

import * as sim from '../../src/sim/index.js';
import { createInitialState } from '../../src/state.js';
import * as grading from '../../src/puzzles/grading.js';
import * as matching from '../../src/puzzles/matching.js';
import { mulberry32 } from '../../src/rng.js';
import { ROOMS } from '../../src/content/rooms.js';
import { HUNTERS, DURATIONS } from '../../src/content/hunters.js';
import { APPRENTICES_BY_ID } from '../../src/content/apprentices.js';
import { GRINDER_KINDS_BY_ID } from '../../src/content/stations.js';
import { getPigment } from '../../src/content/pigments.js';
import { getCanvas } from '../../src/content/canvases.js';
import { ROUTES_BY_ID } from '../../src/content/routes.js';

const { economy, factory, storage, shelf, gallery, hunters, prestige, discovery, orders, shipping, closeUp, unlocks } = sim;

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
/** Monday 2026-10-05 00:00 UTC: calendar day 0 of every run. */
export const T0 = Date.UTC(2026, 9, 5, 0, 0, 0);

/** Minutes of her time one puzzle takes, by tier (spec "Difficulty tiers"). */
export const TIER_MINUTES = Object.freeze({ relaxed: 1, steady: 1.5, tricky: 2.5, master: 4 });

/** Player profiles (spec "The model"). puzzlesAt(i) = puzzles at the i-th check-in of a day. */
export const PROFILES = Object.freeze({
  forgetful: Object.freeze({ id: 'forgetful', name: 'Forgetful', hours: [8, 20], tier: 'relaxed', puzzlesAt: (i) => (i === 0 ? 1 : 0) }),
  casual: Object.freeze({ id: 'casual', name: 'Casual', hours: [8, 12, 16, 20], tier: 'steady', puzzlesAt: () => 2 }),
  engaged: Object.freeze({ id: 'engaged', name: 'Engaged', hours: [7, 10, 13, 16, 19, 22], tier: 'tricky', puzzlesAt: () => 4 }),
});

/** The greedy buyer keeps this offline window (spec "Buying strategy"). */
export const WINDOW_TARGET_MS = 8 * HOUR;
/** Orders filled by hand per check-in, at Great. */
export const ORDERS_PER_CHECKIN = 2;
/** Gallery: a piece uses about this much production in paint (set by the engine, sim/gallery.js PAINT_SECONDS). */
export const PAINT_PRODUCTION_MS = gallery.PAINT_SECONDS * 1000;
/** Renovate once the suggestion shows and the gain reaches this. */
export const RENOVATE_MIN_GAIN = 10;
/** Shelf: keep at least this share of cells free (sell Bottles+ beyond it). */
export const SHELF_FREE_SHARE = 1 / 3;

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

/** Offline window the way the spec model defines it: capacity ÷ production (ms). */
export function offlineWindowMs(state) {
  const r = economy.rates(state);
  if (!(r.jars > 0)) return Infinity;
  return storage.capacity(state).total / r.jars * 1000;
}

function nextRoom(state) {
  const owned = new Set(state.rooms ?? []);
  for (const room of ROOMS) {
    if (owned.has(room.id) || room.unlock) continue; // Gallery Wing / Loading Yard are unlocks (savingGoal)
    if ((state.phase ?? 1) < room.phase) continue;
    return room;
  }
  return null;
}

/**
 * A purchase she is saving for, or null: the cheapest of the next room with its
 * color gate met, every coin-bought unlock whose colors (and phase) are met
 * (v0.2, src/sim/unlocks.js: shelf, hunters, gallery, shipping, commissions) and
 * the half-price re-buy after Renovate; then the Dispatcher.
 */
function savingGoal(state) {
  const goals = [];
  const rq = unlocks.rebuyQuote(state);
  if (rq.ids.length) goals.push({ kind: 'rebuy', cost: rq.cost });
  const room = nextRoom(state);
  if (room && discovery.discoveredCount(state) >= room.colorsRequired) {
    goals.push({ kind: 'room', id: room.id, cost: room.cost });
  }
  for (const u of unlocks.statusAll(state)) {
    if (u && !u.open && u.revealed) goals.push({ kind: 'unlock', id: u.id, cost: u.cost });
  }
  if (goals.length) return goals.sort((a, b) => a.cost - b.cost)[0];
  const disp = APPRENTICES_BY_ID.dispatcher;
  if ((state.stations.fleet ?? []).length && !state.apprentices?.dispatcher && (state.phase ?? 1) >= disp.phase) {
    return { kind: 'apprentice', id: 'dispatcher', cost: disp.cost };
  }
  return null;
}

function buyGoal(state, goal, now) {
  if (goal.kind === 'rebuy') return unlocks.batchRebuy(state, {}, now).ok;
  if (goal.kind === 'unlock') return unlocks.buy(state, { id: goal.id }, now).ok;
  if (goal.kind === 'room') return factory.buyRoom(state, { id: goal.id }, now).ok;
  if (goal.kind === 'apprentice') return factory.buyApprentice(state, { id: goal.id }).ok;
  return false;
}

function cheapest(list) {
  let best = null;
  for (const o of list) if (Number.isFinite(o.cost) && (!best || o.cost < best.cost)) best = o;
  return best;
}

function buyOption(state, o, now) {
  return factory.buyUpgrade(state, { kind: o.kind, index: o.index, id: o.id }, now).ok;
}

/**
 * Greedy buyer (spec "Buying strategy"): keep the offline window at 8 hours,
 * then buy the bottleneck's cheapest upgrade (flow meter suggestion), saving
 * for the next room once its color gate is met. Returns the number of buys.
 */
export function buyGreedy(state, now, ctx) {
  let bought = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const fm = economy.flowMeter(state, now);
    if (ctx) ctx.meterCalls++;
    // 1. Offline window. Storage never changes production, so buy it against a fixed rate.
    const R = fm.make.rate;
    if (R > 0 && fm.store.windowMs < WINDOW_TARGET_MS) {
      const need = R * WINDOW_TARGET_MS / 1000;
      let ok = true;
      while (storage.capacity(state).total < need) {
        const o = cheapestStorage(state);
        if (!(state.coins >= o.cost) || !buyOption(state, o, now)) { ok = false; break; }
        bought++;
      }
      if (!ok) break; // saving for storage
      continue;
    }
    // 2. Saving goal: the re-buy, a room or an unlock whose colors are met (or the Dispatcher).
    const goal = savingGoal(state);
    if (goal) {
      if (state.coins >= goal.cost && buyGoal(state, goal, now)) {
        bought++;
        if (ctx) ctx.buys[goal.kind] = (ctx.buys[goal.kind] ?? 0) + 1;
        assignRecipes(state, now);
        setRoutes(state, now);
        continue;
      }
      break; // saving
    }
    // 3. Hunters: hire when affordable.
    if (hireHunters(state, ctx)) { bought++; continue; }
    // 4. The workshop's single Next button (sim.next): unlocks, rooms, the flow
    //    meter's suggestion, then the cheapest affordable upgrade.
    let nx = sim.next(state, now);
    if (nx.action.kind === 'assign') { assignRecipes(state, now); nx = sim.next(state, now); }
    const a = nx.action;
    if (a.kind === 'rebuy' && unlocks.batchRebuy(state, {}, now).ok) { bought++; continue; }
    if (a.kind === 'unlock' && unlocks.buy(state, { id: a.id }, now).ok) { bought++; assignRecipes(state, now); continue; }
    if (a.kind === 'room' && factory.buyRoom(state, { id: a.id }, now).ok) { bought++; assignRecipes(state, now); setRoutes(state, now); continue; }
    // The greedy buyer saves for the bottleneck instead of taking next()'s
    // "cheapest affordable upgrade" fallback (spec "Buying strategy").
    if (a.kind !== 'upgrade' || nx.why !== 'bottleneck') break;
    const s = { kind: a.upgrade, index: a.index, id: a.id, cost: nx.cost };
    if (s.kind === 'grinder') {
      // A better grinder kind when it is affordable (Mortar → Millstone → Roller Mill).
      const g = state.stations.grinders.findIndex((x) => GRINDER_KINDS_BY_ID[x.kind]?.next);
      const def = g >= 0 ? GRINDER_KINDS_BY_ID[state.stations.grinders[g].kind] : null;
      if (def && state.coins >= def.upgradeCost && def.upgradeCost <= 20 * num(s.cost, Infinity)) {
        if (factory.upgradeGrinderKind(state, { index: g }).ok) { bought++; continue; }
      }
    }
    if (Number.isFinite(s.cost) && state.coins >= s.cost && buyOption(state, s, now)) {
      bought++;
      if (ctx) ctx.buys[s.kind] = (ctx.buys[s.kind] ?? 0) + 1;
      continue;
    }
    break;
  }
  return bought;
}

function cheapestStorage(state) {
  let best = { kind: 'cellar', cost: economy.stationCost('cellar', num(state.cellarLevel, 1)) };
  (state.stations.vats ?? []).forEach((v, index) => {
    const cost = economy.stationCost('vat', v.level);
    if (cost < best.cost) best = { kind: 'vat', index, cost };
  });
  return best;
}

function hireHunters(state, ctx) {
  if (!hunters.unlocked(state)) return false;
  for (const def of HUNTERS) {
    const chk = hunters.canHire(state, { hunterId: def.id });
    if (chk.ok) {
      hunters.hire(state, { hunterId: def.id });
      if (ctx) ctx.hires++;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Factory chores
// ---------------------------------------------------------------------------

/** Most valuable mixable colors first, spread one per mixer. */
export function assignRecipes(state) {
  const known = Object.keys(state.catalog?.discovered ?? {});
  const makeable = known.filter((id) => factory.canMix(state, id))
    .map((id) => ({ id, price: economy.colorPrice(state, id) }))
    .sort((a, b) => b.price - a.price || (a.id < b.id ? -1 : 1));
  const mixers = state.stations.mixers ?? [];
  // A mixer keeps its color only while it is among the top N distinct picks (N = mixers).
  const want = makeable.slice(0, mixers.length).map((x) => x.id);
  const keep = new Set();
  const settled = new Set();
  mixers.forEach((m, i) => {
    if (m.recipe && want.includes(m.recipe) && !keep.has(m.recipe)) { keep.add(m.recipe); settled.add(i); }
  });
  const free = want.filter((id) => !keep.has(id));
  mixers.forEach((m, i) => {
    if (settled.has(i)) return;
    const id = free.shift() ?? makeable[0]?.id;
    if (id && id !== m.recipe) factory.assignRecipe(state, { mixer: i, colorId: id });
  });
}

function claimAccidents(state, now, ctx) {
  (state.stations.mixers ?? []).forEach((m, i) => {
    if (!m.accident) return;
    const r = factory.claimAccident(state, { mixer: i }, now);
    if (r.discovered) ctx.discoveries.accident++;
  });
}

function handleMuddy(state, now, puzzles) {
  for (const b of [...(state.muddyBatches ?? [])]) {
    if (puzzles) factory.purifyBatch(state, { batchId: b.id, purity: 'pure' }, now);
    else factory.sellMuddyBatch(state, { batchId: b.id }, now);
  }
}

/** Routes for the fleet: one vehicle per open route, best premium on her palette first. */
function setRoutes(state, now) {
  const fleet = state.stations.fleet ?? [];
  if (!fleet.length) return;
  const open = shipping.availableRoutes(state, now);
  if (!open.length) return;
  const byColor = economy.rates(state, now).byColor;
  const total = Object.values(byColor).reduce((s, x) => s + x, 0) || 1;
  const scored = open.map((r) => {
    let on = 0;
    for (const [c, j] of Object.entries(byColor)) if (r.any || r.palette.includes(economy.colorFamily(c))) on += j;
    return { id: r.id, score: (on / total) * (1 + r.premium), any: r.any };
  }).sort((a, b) => b.score - a.score);
  // The last vehicle always runs the any-color route so nothing is left behind.
  const anyRoute = scored.find((x) => x.any) ?? scored[0];
  fleet.forEach((v, i) => {
    const pickR = i === fleet.length - 1 ? anyRoute : scored[i % scored.length];
    v.route = pickR.id;
  });
}

function handDispatch(state, now) {
  if (state.apprentices?.dispatcher) return;
  (state.stations.fleet ?? []).forEach((v, i) => {
    if (!shipping.isIdle(v) || !v.route || !ROUTES_BY_ID[v.route]) return;
    const cap = economy.vehicleCapacity(v);
    const picks = Object.entries(state.stock ?? {})
      .map(([colorId, e]) => ({ colorId, jars: e.jars, price: economy.colorPrice(state, colorId) }))
      .sort((a, b) => b.price - a.price);
    let left = cap;
    const cargo = [];
    for (const p of picks) {
      if (left <= 0) break;
      const j = Math.min(left, p.jars);
      cargo.push({ colorId: p.colorId, jars: j });
      left -= j;
    }
    if (cargo.length) shipping.dispatch(state, { vehicle: i, routeId: v.route, cargo, packed: false }, now);
  });
}

// ---------------------------------------------------------------------------
// Active play
// ---------------------------------------------------------------------------

function palette(state) {
  return discovery.discoveredColors(state).map((c) => c.hex);
}

/** One grading board: her time passes, she is paid, revealed tints may be discovered. */
function playPuzzle(state, tier, rng, now, ctx) {
  const board = grading.createBoard({ tier, palette: palette(state) }, rng);
  const reward = economy.puzzleReward(state, tier, { now });
  factory.earn(state, reward);
  ctx.puzzleCoins += reward;
  ctx.puzzles++;
  state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  let found = 0;
  for (const hex of grading.revealedTints(board, rng)) {
    if (discovery.tryDiscover(state, { hex, method: 'grade' }, now)) found++;
  }
  ctx.discoveries.grade += found;
  return found;
}

function hexOfPigment(id) {
  if (id === 'white') return matching.DROPS[0].hex;
  if (id === 'black') return matching.DROPS[1].hex;
  return getPigment(id)?.hex ?? '#888888';
}

/** Drops that land at Great (ΔE 2–5): the real recipe nudged by a drop; exact recipe if none does. */
function greatDrops(order) {
  const base = matching.recipeDrops(order.recipe, hexOfPigment);
  for (const scale of [2, 3, 4]) {
    for (let k = 0; k < base.length; k++) {
      for (const d of [1, -1]) {
        const drops = base.map((x, i) => ({ ...x, count: x.count * scale + (i === k ? d : 0) }));
        if (drops.some((x) => x.count < 0)) continue;
        const sc = matching.score(order.target, matching.blend(drops));
        if (sc.tier === 'great') return drops;
      }
    }
  }
  return base;
}

function fillOrders(state, now, ctx) {
  let filled = 0;
  for (const o of [...(state.orders?.open ?? [])]) {
    if (filled >= ORDERS_PER_CHECKIN) break;
    if (o.kind !== 'match' || !o.recipe) continue;
    const before = state.coins;
    const r = orders.submitOrder(state, { orderId: o.id, drops: greatDrops(o) }, now);
    if (!r.ok) continue;
    ctx.orderCoins += state.coins - before;
    if (r.discovered) ctx.discoveries.order++;
    filled++;
  }
}

// ---------------------------------------------------------------------------
// Merge Shelf
// ---------------------------------------------------------------------------

function tendShelf(state, now, ctx) {
  if (!shelf.unlocked(state)) return;
  const s = state.shelf;
  // Merge greedily, lowest tier first; golden vials join the best partner.
  for (let guard = 0; guard < 200; guard++) {
    let done = false;
    for (let tier = 1; tier < shelf.MAX_TIER && !done; tier++) {
      const groups = new Map();
      s.cells.forEach((c, i) => {
        if (!c || c.tier !== tier || c.golden) return;
        if (!groups.has(c.color)) groups.set(c.color, []);
        groups.get(c.color).push(i);
      });
      for (const list of groups.values()) {
        if (list.length >= 2) {
          const r = shelf.merge(state, { from: list[0], to: list[1] });
          if (r.ok) { done = true; ctx.merges++; if (r.essence) ctx.essence++; break; }
        }
      }
      if (done) break;
      const golden = s.cells.findIndex((c) => c && c.golden && c.tier === tier);
      if (golden >= 0) {
        const partner = s.cells.findIndex((c, i) => i !== golden && c && c.tier === tier && !c.golden);
        if (partner >= 0) {
          const r = shelf.merge(state, { from: golden, to: partner });
          if (r.ok) { done = true; ctx.merges++; if (r.essence) ctx.essence++; }
        }
      }
    }
    if (!done) break;
  }
  // Sell Bottles and up of colors whose Essence is full, then keep a third of the shelf free.
  const sellCell = (i) => {
    const r = shelf.sell(state, { cell: i }, now);
    if (r.ok) ctx.shelfCoins += r.coins;
  };
  s.cells.forEach((c, i) => {
    if (c && c.tier >= 3 && economy.essenceOf(state, c.color) >= economy.ESSENCE_MAX) sellCell(i);
  });
  const freeTarget = Math.ceil(s.cells.length * SHELF_FREE_SHARE);
  const free = () => s.cells.filter((c) => !c).length;
  if (free() < freeTarget) {
    const order = s.cells.map((c, i) => ({ c, i })).filter((x) => x.c && x.c.tier >= 3)
      .sort((a, b) => a.c.tier - b.c.tier);
    for (const x of order) { if (free() >= freeTarget) break; sellCell(x.i); }
  }
  if (free() < freeTarget) {
    const order = s.cells.map((c, i) => ({ c, i })).filter((x) => x.c).sort((a, b) => a.c.tier - b.c.tier);
    for (const x of order) { if (free() >= freeTarget) break; sellCell(x.i); }
  }
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function paintPiece(state, now, ctx) {
  const g = state.gallery;
  if (!g?.unlocked || !g.canvases.length) return;
  // Every canvas costs the same (gallery.PAINT_SECONDS of production), so she
  // works through her canvases in turn.
  const canvasId = g.canvases[ctx.pieces % g.canvases.length];
  const canvas = getCanvas(canvasId);
  if (!canvas) return;
  const left = {};
  for (const [id, e] of Object.entries(state.stock ?? {})) left[id] = e.jars;
  const colors = Object.keys(left)
    .filter((id) => state.catalog.discovered[id])
    .map((id) => ({ id, v: economy.colorPrice(state, id) * (gallery.RARITY[economy.colorTier(id)] ?? 1) }))
    .sort((a, b) => b.v - a.v);
  if (!colors.length) return;
  // Plan first (round-robin over her best colors, for variety), then paint.
  const plan = [];
  let k = 0;
  for (const r of canvas.regions) {
    const need = gallery.regionCost(state, canvasId, r.id);
    let chosen = null;
    for (let t = 0; t < colors.length; t++) {
      const c = colors[(k + t) % colors.length];
      if (left[c.id] >= need) { chosen = c.id; k = (k + t + 1) % Math.min(colors.length, 8); break; }
    }
    if (!chosen) return; // not enough paint today
    left[chosen] -= need;
    plan.push([r.id, chosen]);
  }
  const start = gallery.startPiece(state, { canvasId }, now);
  if (!start.ok) return;
  for (const [regionId, colorId] of plan) {
    const r = gallery.paintRegion(state, { pieceId: start.pieceId, regionId, colorId }, now);
    if (!r.ok) { gallery.discardPiece(state, { pieceId: start.pieceId }); return; }
  }
  const signed = gallery.signPiece(state, { pieceId: start.pieceId, title: '' }, now);
  if (!signed.ok) return;
  ctx.pieces++;
  hangBest(state);
}

function hangBest(state) {
  const g = state.gallery;
  const signed = g.pieces.filter((p) => p.signedAt).sort((a, b) => b.value - a.value);
  const walls = num(g.walls, 4);
  const best = new Set(signed.slice(0, walls).map((p) => p.id));
  for (const id of [...g.hung]) if (!best.has(id)) gallery.unhang(state, { pieceId: id });
  for (const id of best) gallery.hang(state, { pieceId: id });
}

// ---------------------------------------------------------------------------
// Hunters
// ---------------------------------------------------------------------------

function sendHunters(state, now, untilNext, lastOfDay) {
  if (!hunters.unlocked(state)) return;
  for (const h of hunters.idleHunters(state)) {
    const regionId = closeUp.bestRegion(state, h);
    if (!regionId) continue;
    let duration = null;
    if (lastOfDay) duration = 'overnight';
    else {
      for (const d of ['overnight', 'long', 'short']) {
        if (hunters.tripMs(h, d) <= untilNext) { duration = d; break; }
      }
    }
    if (!duration || !DURATIONS[duration]) continue;
    hunters.send(state, { hunterId: h.id, regionId, duration }, now);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** What Renovate must keep: signed pieces, canvases and Essence stars. */
function keptSnapshot(state) {
  return {
    pieces: (state.gallery?.pieces ?? []).filter((p) => p.signedAt).length,
    canvases: (state.gallery?.canvases ?? []).length,
    essence: essenceStats(state).total,
  };
}

/** Heritage tree: a little start money, then spare vats, then Quick Hands (cheapest useful first). */
const HERITAGE_PLAN = ['deep-pockets', 'extra-vats', 'deep-pockets', 'quick-hands', 'deep-pockets', 'extra-vats', 'quick-hands', 'second-table'];
function spendHeritage(state) {
  for (let guard = 0; guard < 40; guard++) {
    let bought = false;
    for (const id of HERITAGE_PLAN) {
      if (prestige.buyHeritageNode(state, { id }).ok) { bought = true; break; }
    }
    if (!bought) break;
  }
}

function emptyDay() {
  return {
    earned: 0, puzzleCoins: 0, orderCoins: 0, admission: 0, shelfCoins: 0,
    incomeRate: 0, discovered: 0, phase: 1, renovations: 0, windowMinH: Infinity,
    essenceAvg: 0, essenceTotal: 0, pieces: 0, worstGapMin: 0, puzzles: 0,
  };
}

function essenceStats(state) {
  const vals = Object.values(state.catalog?.discovered ?? {}).map((d) => num(d.essence)).filter((e) => e > 0);
  const total = vals.reduce((s, x) => s + x, 0);
  return { avg: vals.length ? total / vals.length : 0, total };
}

/**
 * simulate({profile:'casual', seed:1, days:21, puzzles:true, tier?, ledger:false}) -> {
 *   profile, seed, tier, puzzles,
 *   days: [{earned, puzzleCoins, orderCoins, shelfCoins, admission, admissionShare, shelfShare,
 *           puzzleShare, incomeRate, discovered, phase, renovations, windowMinH, essenceAvg,
 *           essenceTotal, pieces, puzzles}]   (calendar days; day 0 starts at midnight before install),
 *   milestones: {phase2, phase3, renovate, colors50, galleryOpen}  (days since install, or null),
 *   renovations: [days since install], renovateKept, worstGapMin, worstGapAt, activeMinutes,
 *   puzzleCoins, orderCoins, shelfCoins, earned, colors, discoveries, found (by method),
 *   meterCalls, buys (by kind), pieces, essence, hires, state, ms }
 * `tier` overrides the profile's puzzle tier (the doc's Difficulty tiers table);
 * `ledger: true` opens the Morning Ledger (sim.catchUp) at every check-in.
 */
export function simulate(opts = {}) {
  const t0 = Date.now();
  const prof = PROFILES[opts.profile ?? 'casual'];
  if (!prof) throw new Error('unknown profile ' + opts.profile);
  const days = opts.days ?? 21;
  const seed = (opts.seed ?? 1) >>> 0;
  const doPuzzles = opts.puzzles !== false;
  const ledger = !!opts.ledger;
  const tier = opts.tier ?? prof.tier;
  const minutes = TIER_MINUTES[tier];
  const rng = mulberry32((seed * 2654435761 + 12345) >>> 0);

  const start = T0 + prof.hours[0] * HOUR;
  const state = createInitialState(start, seed);
  factory.buyApprentice(state, { id: 'errandRunner' });
  const dayStats = Array.from({ length: days }, emptyDay);
  const ms = { phase2: null, phase3: null, renovate: null, colors50: null, galleryOpen: null };
  const renovations = [];
  const ctx = {
    puzzleCoins: 0, orderCoins: 0, shelfCoins: 0, puzzles: 0, pieces: 0, merges: 0, essence: 0, hires: 0,
    discoveries: { grade: 0, order: 0, accident: 0 },
    found: {},
    meterCalls: 0,
    buys: {},
  };
  // The Game drains transient sim events after every act/tick; so does the player.
  const drain = () => {
    for (const e of state._events ?? []) {
      if (e && e.type === 'discover') ctx.found[e.method ?? '?'] = (ctx.found[e.method ?? '?'] ?? 0) + 1;
    }
    state._events = [];
  };
  let worstGap = 0;
  let worstGapAt = null;
  let activeMinutes = 0;
  let lastEarned = num(state.lifetime.earned);
  let checkinNo = 0;
  let renovateKept = true;

  const dayOf = (t) => Math.min(days - 1, Math.max(0, Math.floor((t - T0) / DAY)));
  const sinceStart = (t) => (t - start) / DAY;
  const credit = (t) => {
    const d = dayOf(t);
    const e = num(state.lifetime.earned);
    dayStats[d].earned += e - lastEarned;
    lastEarned = e;
    return d;
  };
  const advance = (t, checkin = false) => {
    // Admission accrues at a constant rate between check-ins (walls change only while she plays).
    const dt = Math.max(0, t - num(state.lastTick, t)) / 1000;
    const adm = state.gallery?.unlocked ? gallery.admissionRate(state, state.lastTick) * dt : 0;
    // sim.tick is the same world step catchUp runs; catchUp also builds the Morning
    // Ledger, which the player never reads, so it is only used when asked (opts.ledger).
    if (checkin && ledger && t - num(state.lastSeenAt, t) >= 60e3) sim.catchUp(state, t);
    else sim.tick(state, t);
    if (checkin) state.lastSeenAt = t;
    dayStats[dayOf(t)].admission += adm;
    drain();
  };
  const marks = (t) => {
    const at = sinceStart(t);
    if (ms.phase2 === null && state.phase >= 2) ms.phase2 = at;
    if (ms.phase3 === null && state.phase >= 3) ms.phase3 = at;
    if (ms.colors50 === null && discovery.discoveredCount(state) >= 50) ms.colors50 = at;
    if (ms.galleryOpen === null && state.gallery?.unlocked) ms.galleryOpen = at;
  };

  const schedule = [];
  for (let d = 0; d < days; d++) {
    prof.hours.forEach((h, i) => schedule.push({ t: T0 + d * DAY + h * HOUR, day: d, index: i, last: i === prof.hours.length - 1 }));
  }
  const end = T0 + days * DAY;

  for (let n = 0; n < schedule.length; n++) {
    const ci = schedule[n];
    let now = ci.t;
    const nextT = n + 1 < schedule.length ? schedule[n + 1].t : end;
    advance(now, true);
    const d = ci.day;
    factory.collect(state, now);
    claimAccidents(state, now, ctx);
    handleMuddy(state, now, doPuzzles);
    assignRecipes(state, now);
    tendShelf(state, now, ctx);
    if (doPuzzles) fillOrders(state, now, ctx);
    buyGreedy(state, now, ctx);
    marks(now);

    // Puzzles: after every one, is something affordable?
    const nPuzzles = doPuzzles ? prof.puzzlesAt(ci.index) : 0;
    let streak = 0;
    for (let p = 0; p < nPuzzles; p++) {
      // Her minutes pass; the world catches up once after the session (below), so
      // the affordability check ignores the few minutes of idle income (conservative).
      now += minutes * 60e3;
      const found = playPuzzle(state, tier, rng, now, ctx);
      activeMinutes += minutes;
      const affordable = economy.cheapestUpgrade(state).cost <= state.coins;
      if (affordable) {
        const gap = (streak + 1) * minutes;
        if (gap > worstGap) { worstGap = gap; worstGapAt = sinceStart(now); }
        streak = 0;
      } else {
        streak++;
      }
      if (found) assignRecipes(state, now);
      buyGreedy(state, now, ctx);
      marks(now);
    }
    if (nPuzzles > 0) { advance(now); factory.collect(state, now); }
    if (streak > 0) {
      const gap = (streak + 1) * minutes; // unresolved at the end of the session: assume one more puzzle
      if (gap > worstGap) { worstGap = gap; worstGapAt = sinceStart(now); }
    }
    dayStats[d].puzzles += nPuzzles;

    // Gallery at half of her check-ins.
    if (checkinNo % 2 === 1) paintPiece(state, now, ctx);
    hangBest(state);
    checkinNo++;

    // Renovate.
    if (prestige.shouldSuggest(state) && prestige.heritagePreview(state) >= RENOVATE_MIN_GAIN) {
      spendHeritage(state); // tree effects apply as the new run starts
      const before = keptSnapshot(state);
      const r = prestige.renovate(state, now);
      if (r.ok) {
        const after = keptSnapshot(state);
        if (after.pieces < before.pieces || after.canvases < before.canvases || after.essence < before.essence) renovateKept = false;
        renovations.push(sinceStart(now));
        if (ms.renovate === null) ms.renovate = sinceStart(now);
        assignRecipes(state, now);
        buyGreedy(state, now, ctx);
        hangBest(state);
      }
    }

    sendHunters(state, now, nextT - now, ci.last);
    setRoutes(state, now);
    handDispatch(state, now);
    buyGreedy(state, now, ctx);
    marks(now);

    drain();
    const ds = dayStats[d];
    credit(now);
    ds.incomeRate = economy.incomeRate(state, now) + (state.gallery?.unlocked ? gallery.admissionRate(state, now) : 0);
    ds.discovered = discovery.discoveredCount(state);
    ds.phase = Math.max(ds.phase, state.phase);
    ds.renovations = renovations.length;
    ds.windowMinH = Math.min(ds.windowMinH, offlineWindowMs(state) / HOUR);
    const es = essenceStats(state);
    ds.essenceAvg = es.avg;
    ds.essenceTotal = es.total;
    ds.pieces = ctx.pieces;
    ds.puzzleCoinsCum = ctx.puzzleCoins;
    ds.orderCoinsCum = ctx.orderCoins;
    ds.shelfCoinsCum = ctx.shelfCoins;
  }
  // Coins earned between the last check-in and the end of the last day.
  advance(end - 1);
  credit(end - 1);

  // Per-day puzzle / order / shelf coins from the cumulative columns.
  let pc = 0; let oc = 0; let sc = 0;
  for (const ds of dayStats) {
    const a = num(ds.puzzleCoinsCum, pc); const b = num(ds.orderCoinsCum, oc); const c = num(ds.shelfCoinsCum, sc);
    ds.puzzleCoins = a - pc; ds.orderCoins = b - oc; ds.shelfCoins = c - sc;
    pc = a; oc = b; sc = c;
    ds.admissionShare = ds.earned > 0 ? ds.admission / ds.earned : 0;
    ds.shelfShare = ds.earned > 0 ? ds.shelfCoins / ds.earned : 0;
    ds.puzzleShare = ds.earned > 0 ? ds.puzzleCoins / ds.earned : 0;
  }

  return {
    profile: prof.id, seed, tier, puzzles: doPuzzles, days: dayStats, milestones: ms, renovations,
    worstGapMin: worstGap, worstGapAt, activeMinutes, puzzleCoins: ctx.puzzleCoins, orderCoins: ctx.orderCoins,
    shelfCoins: ctx.shelfCoins, earned: num(state.lifetime.earned), colors: discovery.discoveredCount(state),
    renovateKept, discoveries: ctx.discoveries, found: ctx.found, meterCalls: ctx.meterCalls, buys: ctx.buys, pieces: ctx.pieces, essence: ctx.essence, hires: ctx.hires,
    state, ms: Date.now() - t0,
  };
}

/** A run result without the live `state` (for workers, tables and tests). */
export function summarize(result) {
  const { state, ...rest } = result; // eslint-disable-line no-unused-vars
  return rest;
}
