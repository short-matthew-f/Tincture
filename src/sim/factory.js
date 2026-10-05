// factory.js — the production chain tick and every factory action (pure).
// Implements docs/DESIGN.md "The factory" (Sources → Grinders → Mixers → Vats →
// Sales, stations, rooms, apprentices, light active hooks: Rush, happy accidents)
// and "Storage and shipping" (production pauses when full, shop sells, fleet).
//
// tickFactory(state, now) is CLOSED FORM: one step covers any dt (a 3-day
// offline catch-up costs the same as a 250 ms tick). With a Dispatcher running
// routes it sub-steps (≤ 48 steps) so trips can drain storage while away.

import { MIXER, MIXER_PURCHASE, MILESTONES, GRINDER_KINDS_BY_ID, RUSH_COOLDOWN_MS, VEHICLES } from '../content/stations.js';
import { SOURCES_BY_ID, MAX_SOURCES_ERA1 } from '../content/sources.js';
import { ROOMS_BY_ID, slotsForRooms, MAX_SLOTS } from '../content/rooms.js';
import { APPRENTICES_BY_ID } from '../content/apprentices.js';
import { stateRng, uuid } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import {
  rates, stationCost, colorPrice, incomeMultiplier, shopPriceBonus, grinderPurityBonus,
  essenceOf, recipeShares, colorDef, flowMeter, discoveredCount, ESSENCE_STEP,
} from './economy.js';
import { capacity, stockTotal, addStock, takeStock, convertPurity, keepMap, PURITY_ORDER } from './storage.js';
import { resolveTrips, autoDispatch } from './shipping.js';
import { tickSpillover } from './shelf.js';
import { tickAdmission, unlock as unlockGallery } from './gallery.js';
import { undiscoveredNear, discover, isDiscovered } from './discovery.js';
import { puzzleReward } from './economy.js';
import { TIERS as PURIFY_TIERS } from '../puzzles/purify.js';

/**
 * Muddy batches (docs/V02-CONTRACTS.md "Purify"): a production-time clock, not a
 * per-batch roll. While any mixer produces, the next batch is due a random 2–3
 * minutes of production later (state.nextMuddyAt); at most MUDDY_PENDING_MAX
 * wait at once (a due batch past the cap is skipped, nothing lost), and one
 * catch-up tick (dt > MUDDY_CATCH_UP_MS: offline return, debug advance) adds at
 * most MUDDY_OFFLINE_MAX.
 */
export const MUDDY_WINDOW_MS = Object.freeze({ min: 120e3, max: 180e3 });
export const MUDDY_PENDING_MAX = 10;
export const MUDDY_OFFLINE_MAX = 3;
export const MUDDY_CATCH_UP_MS = 60e3; // = offline.CATCH_UP_MIN_MS (not imported: offline.js imports the sim)
/** Happy accidents: one per 4 h of production in Phase 1, 6 h later (v0.2 discovery slowdown). */
export const ACCIDENT_MS = Object.freeze({ phase1: 4 * 3600e3, later: 6 * 3600e3 });
export const ACCIDENT_TINT_DE = 8;
export const RUSH_SECONDS = 60;
export const SHOP_RESERVE_SHARE = 0.02;
export const RAW_BUFFER_SECONDS = 300;
export const PURE_SHARE_MAX = 0.9;
export const PHASE_GATES = Object.freeze({ 2: { colors: 10, room: 'mill-room' }, 3: { colors: 30, room: 'loading-yard' } });

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function flags(state) {
  if (!state.flags || typeof state.flags !== 'object') state.flags = {};
  return state.flags;
}

/** Coins straight into the purse (counts toward Renovate and lifetime). */
export function earn(state, coins) {
  const c = Math.max(0, num(coins));
  if (!c) return 0;
  state.coins = num(state.coins) + c;
  state.runEarned = num(state.runEarned) + c;
  if (!state.lifetime) state.lifetime = { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 };
  state.lifetime.earned = num(state.lifetime.earned) + c;
  return c;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

const muddyGap = (rng) => MUDDY_WINDOW_MS.min + (MUDDY_WINDOW_MS.max - MUDDY_WINDOW_MS.min) * rng();

/**
 * The muddy clock over [t0, t1] -> [{i: mixerIndex, at}] batches due. Time
 * without production (no mixer running, or storage full: 1 - runFrac) pushes
 * the clock back so only production time counts. `budget.left` caps a
 * catch-up tick.
 */
function muddyDue(state, r, t0, t1, runFrac, rng, budget) {
  const out = [];
  const mixers = state.stations.mixers ?? [];
  const producing = mixers.map((m, i) => i).filter((i) => mixers[i] && mixers[i].recipe && num(r.mixerJars[i]) > 0);
  const run = producing.length ? Math.max(0, Math.min(1, num(runFrac))) : 0;
  // Grace period: no muddy batches during the first-session tutorial. The
  // clock starts once onboarding is done, so her first batch lands 2-3 minutes
  // of production after that, never in the middle of the first order.
  if (state.onboarding && !state.onboarding.done && num(state.lifetime?.puzzles) < 2) { state.nextMuddyAt = 0; return out; }
  if (!(num(state.nextMuddyAt) > 0)) {
    if (!(run > 0)) return out;
    state.nextMuddyAt = t0 + muddyGap(rng);
  }
  if (run < 1) state.nextMuddyAt += (t1 - t0) * (1 - run);
  if (!(run > 0)) return out;
  while (state.nextMuddyAt <= t1 && budget.left > 0 && state.muddyBatches.length + out.length < MUDDY_PENDING_MAX) {
    out.push({ i: producing[Math.min(producing.length - 1, Math.floor(rng() * producing.length))], at: state.nextMuddyAt });
    budget.left--;
    state.nextMuddyAt += muddyGap(rng);
  }
  if (state.nextMuddyAt <= t1) state.nextMuddyAt = t1 + muddyGap(rng); // backlog or catch-up cap reached: skip
  return out;
}

/** The shop keeps half the display vats stocked (her working stock for paint,
 *  orders and crates) and sells only the surplus above it. */
export function shopReserve(state, capInfo = capacity(state)) {
  return Math.min(capInfo.total, SHOP_RESERVE_SHARE * capInfo.display);
}

/**
 * Closed-form stock flow over dt seconds: production R jars/s, shop rate s,
 * sales only above `reserve`, production pauses at `cap`. -> {produced, sold}.
 */
export function flow(stock0, R, s, reserve, cap, dt) {
  let st = Math.max(0, num(stock0));
  let produced = 0;
  let sold = 0;
  let rem = dt;
  if (!(dt > 0)) return { produced, sold };
  if (st < reserve) {
    if (!(R > 0)) return { produced, sold };
    const tA = (reserve - st) / R;
    if (tA >= rem) return { produced: R * rem, sold };
    produced += R * tA;
    st = reserve;
    rem -= tA;
  }
  if (R > s) {
    const tFull = Math.max(0, cap - st) / (R - s);
    produced += tFull >= rem ? R * rem : R * tFull + s * (rem - tFull);
    sold += s * rem;
  } else {
    const drain = s - R;
    const sellable = Math.max(0, st - reserve);
    const tE = drain > 0 ? sellable / drain : Infinity;
    produced += R * rem;
    sold += tE >= rem ? s * rem : sellable + R * rem;
  }
  return { produced, sold };
}

/** Closed-form production/sales over [t0, t1]. */
function step(state, t0, t1, muddyBudget = { left: Infinity }) {
  const dtMs = Math.max(0, t1 - t0);
  const dt = dtMs / 1000;
  if (!(dt > 0)) return { produced: 0, sold: 0, coins: 0 };
  const r = rates(state, t0);
  const R = r.jars;
  const s = r.shop;
  const capInfo = capacity(state);
  const cap = capInfo.total;
  // Shop keep reserve (storage.keepMap): kept jars are never sold, so they add
  // to the closed form's reserve (what each kept color will hold by t1, up to
  // its keep); sales come out of each color's surplus above its keep.
  const keeps = keepMap(state);
  let locked = 0;
  for (const [colorId, k] of Object.entries(keeps)) {
    locked += Math.min(k, num(state.stock?.[colorId]?.jars) + num(r.byColor?.[colorId]) * dt);
  }
  const reserve = shopReserve(state, capInfo) + locked;
  const stock0 = stockTotal(state);
  const { produced: p0, sold: s0 } = flow(stock0, R, s, reserve, cap, dt);
  let produced = p0;
  let sold = s0;
  produced = Math.max(0, num(produced));
  sold = Math.max(0, num(sold));
  const runFrac = R > 0 ? produced / (R * dt) : 0;
  if (R > 0) {
    const full = produced < R * dt - 1e-6;
    if (full && !flags(state).storageFull) emit(state, 'storageFull', { at: t1 });
    flags(state).storageFull = full;
  }

  // Distribute production per mixer (purity: pure share from grinders + essence; muddy batches).
  const rng = stateRng(state);
  const pureBase = grinderPurityBonus(state);
  const mixers = state.stations.mixers ?? [];
  if (!Array.isArray(state.muddyBatches)) state.muddyBatches = [];
  const due = muddyDue(state, r, t0, t1, runFrac, rng, muddyBudget);
  mixers.forEach((m, i) => {
    const jars = num(r.mixerJars[i]) * dt * runFrac;
    if (!(jars > 0)) return;
    let keep = jars;
    m.progress = num(m.progress) + jars;
    m.progress -= Math.floor(m.progress / MIXER.batchJars) * MIXER.batchJars;
    // A muddy batch is one mixer batch (MIXER.batchJars) set aside: from this
    // step's output first, the rest from that color's stock (lowest purity).
    const mine = due.filter((d) => d.i === i);
    const owed = [];
    for (const d of mine) {
      const take = Math.min(MIXER.batchJars, keep);
      keep -= take;
      owed.push({ at: d.at, take });
    }
    const pureShare = Math.min(PURE_SHARE_MAX, pureBase + ESSENCE_STEP * essenceOf(state, m.recipe));
    if (pureShare > 0) addStock(state, m.recipe, keep * pureShare, 'pure', { cap: false });
    addStock(state, m.recipe, keep * (1 - pureShare), 'standard', { cap: false });
    for (const o of owed) {
      const rest = MIXER.batchJars - o.take;
      const jarsOut = o.take + (rest > 0 ? takeStock(state, m.recipe, rest, { prefer: 'low' }).taken : 0);
      if (!(jarsOut > 1e-6)) continue;
      state.muddyBatches.push({
        id: uuid(rng), color: m.recipe, jars: jarsOut, value: jarsOut * colorPrice(state, m.recipe, 'muddy'), at: o.at, tier: null,
      });
      emit(state, 'muddy', { mixerIndex: i, colorId: m.recipe });
    }
  });

  // Shop sales: proportional to each color's stock above its keep reserve,
  // lowest purity first. Muddy batches set aside above come out of the shop's
  // share, so stock lands exactly where the closed form says (keeps split
  // ticks equal).
  let coins = 0;
  const total = stockTotal(state);
  const target = Math.max(0, stock0 + produced - sold);
  const surplus = {};
  let pool = 0;
  for (const colorId of Object.keys(state.stock ?? {})) {
    const x = Math.max(0, num(state.stock[colorId].jars) - num(keeps[colorId]));
    surplus[colorId] = x;
    pool += x;
  }
  sold = Math.max(0, Math.min(sold, total - target, pool));
  if (sold > 0 && pool > 0) {
    const share = Math.min(1, sold / pool);
    const bonus = shopPriceBonus(state);
    for (const colorId of Object.keys(surplus)) {
      if (!(surplus[colorId] > 0)) continue;
      const got = takeStock(state, colorId, surplus[colorId] * share, { prefer: 'low' });
      for (const pur of PURITY_ORDER) if (got.byPurity[pur] > 0) coins += got.byPurity[pur] * colorPrice(state, colorId, pur) * bonus;
    }
    coins *= incomeMultiplier(state, t0);
  }
  // Safety clamp: never above capacity (floating error).
  const over = stockTotal(state) - cap;
  if (over > 1e-6) {
    for (const colorId of Object.keys(state.stock)) {
      if (over <= 0) break;
      takeStock(state, colorId, over * (state.stock[colorId].jars / stockTotal(state)), { prefer: 'low' });
    }
  }
  if (coins > 0) {
    if (state.apprentices?.errandRunner) earn(state, coins);
    else state.pendingCollect = num(state.pendingCollect) + coins;
  }

  // Raw / pigment buffers (display only): excess supply accumulates, capped.
  for (const [p, sup] of Object.entries(r.raw)) {
    const used = num(r.pigment[p]) * runFrac;
    const extra = Math.max(0, sup - used);
    if (!state.raw) state.raw = {};
    state.raw[p] = Math.min(sup * RAW_BUFFER_SECONDS, num(state.raw[p]) + extra * dt);
  }
  if (!state.pigment) state.pigment = {};
  for (const [p, rate] of Object.entries(r.pigment)) state.pigment[p] = rate * MIXER.batchSeconds;

  // Happy accidents: one per 4 h (Phase 1) / 6 h (later) of running production.
  if (R > 0) {
    const f = flags(state);
    const interval = (state.phase ?? 1) <= 1 ? ACCIDENT_MS.phase1 : ACCIDENT_MS.later;
    if (!(f.accidentIn > 0)) f.accidentIn = interval;
    f.accidentIn -= dtMs * runFrac;
    let guard = 0;
    while (f.accidentIn <= 0 && guard++ < mixers.length + 1) {
      const candidates = mixers.map((m, i) => i).filter((i) => mixers[i].recipe && !mixers[i].accident && r.mixerJars[i] > 0);
      if (!candidates.length) { f.accidentIn = Math.max(f.accidentIn, 0); break; }
      const i = candidates[Math.floor(rng() * candidates.length) % candidates.length];
      const hex = colorDef(mixers[i].recipe)?.hex;
      const near = hex ? undiscoveredNear(state, hex, ACCIDENT_TINT_DE, { method: 'accident' }) : null;
      mixers[i].accident = near ? { kind: 'tint', colorId: near.color.id, hex: near.color.hex, at: t1 } : { kind: 'flawless', at: t1 };
      emit(state, 'accident', { mixerIndex: i, kind: mixers[i].accident.kind });
      f.accidentIn += interval * (0.75 + 0.5 * rng());
    }
    if (f.accidentIn <= 0) f.accidentIn = interval; // every mixer already glowing
  }
  return { produced, sold, coins };
}

function minRoutedTripMs(state) {
  let m = Infinity;
  for (const v of state.stations.fleet ?? []) {
    if (!v.route) continue;
    const def = VEHICLES.find((x) => x.id === v.kind);
    if (def) m = Math.min(m, def.tripMs);
  }
  return m;
}

/**
 * tickFactory(state, now) -> {produced, sold, coins, trips}. Advances everything
 * from state.lastTick to now: production, shop, muddy batches, accidents, fleet,
 * shelf spillover, gallery admission, boosts, Steward. Sets state.lastTick.
 */
export function tickFactory(state, now) {
  const t0 = num(state.lastTick, now);
  if (!(now > t0)) {
    state.lastTick = Math.max(t0, num(now, t0));
    return { produced: 0, sold: 0, coins: 0, trips: 0 };
  }
  const dt = now - t0;
  let steps = 1;
  if (state.apprentices?.dispatcher) {
    const trip = minRoutedTripMs(state);
    if (Number.isFinite(trip) && dt > trip) steps = Math.min(48, Math.ceil(dt / trip));
  }
  // Breakpoints: even sub-steps (Dispatcher) plus every boost expiry inside the
  // window, so a 10-minute boost counts for 10 minutes of a 3-day catch-up.
  const cuts = new Set();
  for (let k = 1; k < steps; k++) cuts.add(t0 + (dt * k) / steps);
  for (const b of state.boosts ?? []) if (num(b.until) > t0 && b.until < now) cuts.add(b.until);
  const points = [t0, ...[...cuts].sort((x, y) => x - y), now];
  const out = { produced: 0, sold: 0, coins: 0, trips: 0 };
  // A catch-up (offline return, debug advance) adds at most MUDDY_OFFLINE_MAX muddy batches.
  const muddyBudget = { left: dt > MUDDY_CATCH_UP_MS ? MUDDY_OFFLINE_MAX : Infinity };
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    const res = step(state, a, b, muddyBudget);
    out.produced += res.produced;
    out.sold += res.sold;
    out.coins += res.coins;
    out.trips += resolveTrips(state, b).trips;
    autoDispatch(state, b);
  }
  tickSpillover(state, now);
  tickAdmission(state, now);
  state.boosts = (state.boosts ?? []).filter((b) => num(b.until) > now);
  stewardTick(state, now);
  if (!(num(flags(state).firstTickAt) > 0)) flags(state).firstTickAt = now;
  state.lastTick = now;
  return out;
}

/** ARCHITECTURE.md alias. */
export const tick = tickFactory;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** collect(state, now) -> {coins}: the shop till into the purse. */
export function collect(state, now) { // eslint-disable-line no-unused-vars
  const coins = num(state.pendingCollect);
  state.pendingCollect = 0;
  earn(state, coins);
  return { coins };
}

function mixerIndex(args) {
  if (typeof args === 'number') return args;
  return num(args?.mixer ?? args?.index, -1);
}

/** rush(state, {mixer}, now) -> {ok, jars, readyAt}: one minute of the mixer's output, now. */
export function rush(state, args, now) {
  const i = mixerIndex(args);
  const m = state.stations.mixers?.[i];
  if (!m || !m.recipe) return { ok: false, reason: 'idle' };
  const readyAt = num(m.rushedAt) + RUSH_COOLDOWN_MS;
  // A rushedAt in the future means the device clock went back: never lock Rush for it.
  if (num(m.rushedAt) > 0 && num(m.rushedAt) <= now && now < readyAt) return { ok: false, reason: 'cooldown', readyAt };
  const rate = rates(state, now).mixerJars[i];
  const jars = Math.max(MIXER.batchJars, num(rate) * RUSH_SECONDS);
  const accepted = addStock(state, m.recipe, jars, 'standard');
  if (accepted <= 0) return { ok: false, reason: 'full' };
  m.rushedAt = now;
  return { ok: true, jars: accepted, readyAt: now + RUSH_COOLDOWN_MS };
}

/** Is a catalog color mixable with the pigments she owns? */
export function canMix(state, colorId) {
  const shares = recipeShares(colorId);
  if (!shares) return false;
  for (const p of Object.keys(shares)) {
    const src = Object.keys(state.stations.sources ?? {}).find((id) => (SOURCES_BY_ID[id]?.pigment ?? id) === p);
    if (!src || !(num(state.stations.sources[src]?.level) > 0)) return false;
  }
  return true;
}

/** assignRecipe(state, {mixer, colorId}) -> {ok}. colorId null clears the mixer. */
export function assignRecipe(state, args = {}) {
  const i = mixerIndex(args);
  const m = state.stations.mixers?.[i];
  if (!m) return { ok: false, reason: 'mixer' };
  if (args.colorId == null) { m.recipe = null; m.progress = 0; return { ok: true }; }
  if (!isDiscovered(state, args.colorId)) return { ok: false, reason: 'undiscovered' };
  if (!canMix(state, args.colorId)) return { ok: false, reason: 'unmixable' };
  if (m.recipe !== args.colorId) m.progress = 0;
  m.recipe = args.colorId;
  return { ok: true };
}

function normKind(kind) {
  switch (kind) {
    case 'sources': return 'source';
    case 'grinders': return 'grinder';
    case 'mixers': return 'mixer';
    case 'vats': return 'vat';
    case 'vehicle': case 'vehicles': return 'fleet';
    default: return kind;
  }
}

/**
 * buyUpgrade(state, {kind, index|id}, now) -> {ok, level, milestone, cost}.
 * kind: source (id) | grinder | mixer | vat | fleet (index) | shop | cellar.
 * A source at level 0 (unlocked by a hunter) is built by its first purchase.
 */
export function buyUpgrade(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  const kind = normKind(args.kind);
  const st = state.stations;
  let target;
  let cost;
  if (kind === 'source') {
    target = st.sources?.[args.id];
    if (!target) return { ok: false, reason: 'unknown' };
    if (!(num(target.level) > 0)) {
      const built = Object.values(st.sources).filter((s) => num(s.level) > 0).length;
      if (built >= MAX_SOURCES_ERA1) return { ok: false, reason: 'slots' };
    }
    cost = stationCost('source', num(target.level), args.id);
  } else if (kind === 'grinder' || kind === 'mixer' || kind === 'vat') {
    target = st[kind + 's']?.[args.index | 0];
    if (!target) return { ok: false, reason: 'unknown' };
    cost = stationCost(kind, target.level);
  } else if (kind === 'fleet') {
    target = st.fleet?.[args.index | 0];
    if (!target) return { ok: false, reason: 'unknown' };
    cost = stationCost('vehicle', target.level, target.kind);
  } else if (kind === 'shop') {
    target = st.shop;
    cost = stationCost('shop', target.level);
  } else if (kind === 'cellar') {
    cost = stationCost('cellar', num(state.cellarLevel, 1));
  } else {
    return { ok: false, reason: 'kind' };
  }
  if (!Number.isFinite(cost)) return { ok: false, reason: 'unknown' };
  if (num(state.coins) < cost) return { ok: false, reason: 'coins', cost };
  state.coins -= cost;
  let level;
  if (kind === 'cellar') {
    state.cellarLevel = num(state.cellarLevel, 1) + 1;
    level = state.cellarLevel;
  } else {
    target.level = num(target.level) + 1;
    level = target.level;
  }
  const milestone = kind !== 'cellar' && MILESTONES.includes(level);
  if (milestone) emit(state, 'milestone', { kind, level, index: args.index, id: args.id });
  questEvent(state, 'upgradeBought', 1, { kind, level });
  return { ok: true, level, milestone, cost };
}

/** upgradeGrinderKind(state, {index}) -> {ok, kind, cost}: Mortar → Millstone → Roller Mill. */
export function upgradeGrinderKind(state, args = {}) {
  const g = state.stations.grinders?.[mixerIndex({ index: args.index ?? args.grinder })];
  if (!g) return { ok: false, reason: 'unknown' };
  const def = GRINDER_KINDS_BY_ID[g.kind];
  if (!def || !def.next) return { ok: false, reason: 'max' };
  if (num(state.coins) < def.upgradeCost) return { ok: false, reason: 'coins', cost: def.upgradeCost };
  state.coins -= def.upgradeCost;
  g.kind = def.next;
  questEvent(state, 'upgradeBought', 1, { kind: 'grinderKind', grinder: g.kind });
  emit(state, 'milestone', { kind: 'grinder', level: g.level, grinderKind: g.kind });
  return { ok: true, kind: g.kind, cost: def.upgradeCost };
}

/**
 * Make station arrays match the slots her rooms give (only ever adds). Mixers
 * bought outright (buyMixer, `stations.mixersBought`) come on top of the rooms'
 * mixer slots, so a room bought later still adds its mixer; MAX_SLOTS caps both.
 */
export function syncSlots(state) {
  const slots = slotsForRooms(state.rooms ?? []);
  const st = state.stations;
  const mixers = Math.min(MAX_SLOTS.mixers, slots.mixers + mixersBought(state));
  while ((st.mixers ?? []).length < mixers) st.mixers.push(newMixer());
  while ((st.vats ?? []).length < slots.vats) st.vats.push({ level: 1, color: null });
  while ((st.grinders ?? []).length < slots.grinders) st.grinders.push({ kind: 'mortar', level: 1 });
  if (!st.fleet) st.fleet = [];
  while (st.fleet.length < slots.fleet) st.fleet.push({ kind: 'handcart', level: 1, route: null, departedAt: 0, arrivesAt: 0, cargo: null, packed: false });
  if (state.gallery) state.gallery.walls = Math.max(num(state.gallery.walls), slots.walls);
  return slots;
}

function newMixer() {
  return { recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null };
}

/** How many mixers she has bought outright this run (Renovate resets stations, so these too). */
export function mixersBought(state) {
  return Math.max(0, Math.floor(num(state?.stations?.mixersBought)));
}

/**
 * mixerPurchase(state) -> {cost, available, affordable, count}: the next mixer
 * bought outright (stations.js MIXER_PURCHASE: 60 Coins, ×6 for each one after),
 * available while her mixers are below MAX_SLOTS.mixers. Pure read.
 */
export function mixerPurchase(state) {
  const n = mixersBought(state);
  const count = (state?.stations?.mixers ?? []).length;
  const available = count < MAX_SLOTS.mixers && n < (MIXER_PURCHASE.maxBought ?? Infinity);
  const cost = MIXER_PURCHASE.baseCost * Math.pow(MIXER_PURCHASE.costGrowth, n);
  return { cost, available, affordable: available && num(state?.coins) >= cost, count };
}

/**
 * buyMixer(state, now) -> {ok, index, cost} | {ok:false, reason:'slots'|'coins', cost}.
 * Adds one mixer (level 1, no recipe) without a room: the cheap third mixer
 * right after the tutorial (docs/PLAN-v0.2.md Theme A.1). Emits 'mixer' {index}.
 */
export function buyMixer(state, now = 0) { // eslint-disable-line no-unused-vars
  const q = mixerPurchase(state);
  if (!q.available) return { ok: false, reason: 'slots', cost: q.cost };
  if (num(state.coins) < q.cost) return { ok: false, reason: 'coins', cost: q.cost };
  state.coins -= q.cost;
  state.stations.mixersBought = mixersBought(state) + 1;
  state.stations.mixers.push(newMixer());
  const index = state.stations.mixers.length - 1;
  emit(state, 'mixer', { index });
  questEvent(state, 'upgradeBought', 1, { kind: 'newMixer', level: 1 });
  return { ok: true, index, cost: q.cost };
}

/**
 * grantRoom(state, {id}, now) -> {ok, id}: the room is hers (slots, walls, the
 * unlock it IS, phase check) with no price or gate checks. buyRoom and
 * unlocks.buy / batchRebuy charge first and then call this.
 */
export function grantRoom(state, args = {}, now = 0) {
  const room = ROOMS_BY_ID[args.id];
  if (!room) return { ok: false, reason: 'unknown' };
  if ((state.rooms ?? []).includes(room.id)) return { ok: false, reason: 'owned' };
  state.rooms = [...(state.rooms ?? []), room.id];
  syncSlots(state);
  if (room.unlock) {
    if (!state.unlocks || typeof state.unlocks !== 'object') state.unlocks = {};
    const was = !!state.unlocks[room.unlock];
    state.unlocks[room.unlock] = true;
    if (Array.isArray(state.renovateReopen)) state.renovateReopen = state.renovateReopen.filter((x) => x !== room.unlock);
    if (room.unlock === 'gallery') unlockGallery(state, {}, now);
    if (!was) emit(state, 'unlock', { id: room.unlock });
  }
  emit(state, 'room', { id: room.id });
  checkPhase(state, {}, now);
  return { ok: true, id: room.id };
}

/**
 * buyRoom(state, {id}, now) -> {ok, reason?}. Needs Coins, catalog colors and the
 * room's phase. Gallery Wing and Loading Yard ARE the gallery / shipping unlocks
 * (content rooms `unlock`): buying either opens that system, at the room's price.
 */
export function buyRoom(state, args = {}, now = 0) {
  const room = ROOMS_BY_ID[args.id];
  if (!room) return { ok: false, reason: 'unknown' };
  if ((state.rooms ?? []).includes(room.id)) return { ok: false, reason: 'owned' };
  const colors = discoveredCount(state);
  if (colors < room.colorsRequired) return { ok: false, reason: 'colors', need: room.colorsRequired - colors };
  if ((state.phase ?? 1) < room.phase) return { ok: false, reason: 'phase', phase: room.phase };
  if (num(state.coins) < room.cost) return { ok: false, reason: 'coins', cost: room.cost };
  state.coins -= room.cost;
  return grantRoom(state, args, now);
}

/** setVatColor(state, {vat, colorId}) — which stock a display vat shows. */
export function setVatColor(state, args = {}) {
  const v = state.stations.vats?.[num(args.vat, -1)];
  if (!v) return { ok: false };
  v.color = args.colorId ?? null;
  return { ok: true };
}

/**
 * claimAccident(state, {mixer}, now) -> {ok, kind, discovered?, jars?}.
 * Tint: discovers the nearby undiscovered color (method 'accident'); flawless:
 * turns 10 minutes of that mixer's output (min 20 jars) into flawless stock.
 */
export function claimAccident(state, args, now = 0) {
  const i = mixerIndex(args);
  const m = state.stations.mixers?.[i];
  if (!m || !m.accident) return { ok: false };
  const acc = m.accident;
  m.accident = null;
  if (acc.kind === 'tint') {
    let id = acc.colorId && !isDiscovered(state, acc.colorId) ? acc.colorId : null;
    if (!id) {
      const hex = colorDef(m.recipe)?.hex ?? acc.hex;
      const near = hex ? undiscoveredNear(state, hex, ACCIDENT_TINT_DE, { method: 'accident' }) : null;
      id = near?.color.id ?? null;
    }
    if (id) {
      const d = discover(state, { colorId: id, method: 'accident' }, now);
      if (d) return { ok: true, kind: 'tint', discovered: d };
    }
  }
  const color = m.recipe;
  if (!color) return { ok: true, kind: 'flawless', jars: 0 };
  const want = Math.max(20, num(rates(state, now).mixerJars[i]) * 600);
  let jars = convertPurity(state, color, want, 'standard', 'flawless');
  if (jars < want) jars += convertPurity(state, color, want - jars, 'muddy', 'flawless');
  if (jars < want) jars += addStock(state, color, want - jars, 'flawless');
  return { ok: true, kind: 'flawless', jars };
}

/** buyApprentice(state, {id}) -> {ok}. */
export function buyApprentice(state, args = {}) {
  const a = APPRENTICES_BY_ID[args.id];
  if (!a) return { ok: false, reason: 'unknown' };
  if (!state.apprentices) state.apprentices = {};
  if (state.apprentices[a.id]) return { ok: false, reason: 'owned' };
  if ((state.phase ?? 1) < a.phase) return { ok: false, reason: 'phase', phase: a.phase };
  if (num(state.coins) < a.cost) return { ok: false, reason: 'coins', cost: a.cost };
  state.coins -= a.cost;
  state.apprentices[a.id] = true;
  if (a.id === 'steward') state.stewardOn = true;
  if (a.id === 'errandRunner' && num(state.pendingCollect) > 0) collect(state);
  emit(state, 'apprentice', { id: a.id });
  return { ok: true };
}

export function setSteward(state, args = {}) {
  state.stewardOn = !!args.on;
  return { ok: true, on: state.stewardOn };
}

/** addBoost(state, {kind:'production'|'income', mult, minutes}, now). Stacks additively (cap in economy). */
export function addBoost(state, args = {}, now = 0) {
  const kind = args.kind === 'income' ? 'income' : 'production';
  const mult = Math.max(0, num(args.mult, 0.5));
  const minutes = Math.max(0, num(args.minutes, 10));
  if (!Array.isArray(state.boosts)) state.boosts = [];
  const boost = { kind, mult, until: now + minutes * 60e3 };
  state.boosts.push(boost);
  return { ok: true, boost };
}

/** checkPhase(state) -> {phase, changed}. 2: 10 colors + Mill Room; 3: 30 colors + Loading Yard. */
export function checkPhase(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  const before = state.phase ?? 1;
  let phase = before;
  for (const p of [2, 3]) {
    const g = PHASE_GATES[p];
    if (phase === p - 1 && discoveredCount(state) >= g.colors && (state.rooms ?? []).includes(g.room)) phase = p;
  }
  if (phase !== before) {
    state.phase = phase;
    emit(state, 'phase', { phase });
  }
  return { phase, changed: phase !== before };
}

/** stewardTick(state, now) -> {bought}: auto-buy the flow meter's suggestion while affordable. */
export function stewardTick(state, now = 0) {
  if (!state.apprentices?.steward || !state.stewardOn) return { bought: 0 };
  let bought = 0;
  for (let k = 0; k < 5; k++) {
    const s = flowMeter(state, now).suggestion;
    if (!s || !(s.cost > 0) || s.kind === 'assign' || num(state.coins) < s.cost) break;
    const res = buyUpgrade(state, { kind: s.kind, index: s.index, id: s.id }, now);
    if (!res.ok) break;
    bought++;
  }
  return { bought };
}

/** sellStock(state, {colorId, jars}) -> {coins, jars}: direct sale (Mixing-bench surplus). */
export function sellStock(state, args = {}, now) {
  const got = takeStock(state, args.colorId, num(args.jars), { prefer: 'low' });
  let coins = 0;
  for (const p of PURITY_ORDER) if (got.byPurity[p] > 0) coins += got.byPurity[p] * colorPrice(state, args.colorId, p);
  coins *= incomeMultiplier(state, now);
  earn(state, coins);
  return { coins, jars: got.taken };
}

/** unlockSource(state, {id}) — a hunter brought it home: the station appears at level 1, as when hunters.resolveReturns unlocks one. */
export function unlockSource(state, args = {}) {
  if (!SOURCES_BY_ID[args.id]) return { ok: false };
  if (!state.stations.sources[args.id]) state.stations.sources[args.id] = { level: 1 };
  if (state.raw && state.raw[args.id] === undefined) state.raw[args.id] = 0;
  return { ok: true };
}

/**
 * purifyBatch(state, {batchId, tier}, now) -> {ok, jars, coins, reward, purity, tier}.
 * A solved tube sort on a difficulty tier (puzzles/purify.js TIERS): the
 * batch's jars go to stock at that tier's purity (pure / pure / flawless /
 * flawless; any that don't fit are sold at that purity, so nothing is lost)
 * and the puzzle reward is paid: economy.puzzleReward(tier, {k: TIERS[tier].k})
 * minutes of production (4 / 6 / 10 / 16). `coins` = overflow sales + reward.
 * Legacy call without `tier` ({purity}): purity only, no reward (v0.1 shape).
 */
export function purifyBatch(state, args = {}, now = 0) {
  const list = state.muddyBatches ?? [];
  const idx = list.findIndex((b) => b.id === args.batchId);
  if (idx < 0) return { ok: false };
  const b = list[idx];
  const t = PURIFY_TIERS[args.tier] ? args.tier : null;
  list.splice(idx, 1);
  const purity = t ? PURIFY_TIERS[t].purity : (args.purity === 'flawless' ? 'flawless' : 'pure');
  const kept = addStock(state, b.color, b.jars, purity);
  const rest = Math.max(0, b.jars - kept);
  const sold = earn(state, rest * colorPrice(state, b.color, purity) * incomeMultiplier(state, now));
  const reward = t ? earn(state, puzzleReward(state, t, { k: PURIFY_TIERS[t].k, now })) : 0;
  questEvent(state, 'batchPurified', 1, { colorId: b.color, purity, tier: t });
  return { ok: true, jars: kept, coins: sold + reward, reward, purity, tier: t };
}

/** muddyValue(state, now) -> coins every waiting muddy batch would sell for as is (the "Sell all" confirm line). */
export function muddyValue(state, now = 0) {
  let coins = 0;
  for (const b of state.muddyBatches ?? []) coins += num(b.jars) * colorPrice(state, b.color, 'muddy');
  return coins * incomeMultiplier(state, now);
}

/** sellMuddyBatch(state, {batchId}, now) -> {ok, coins}: ignoring is fine — muddy sells at 0.8×. */
export function sellMuddyBatch(state, args = {}, now = 0) {
  const list = state.muddyBatches ?? [];
  const idx = list.findIndex((b) => b.id === args.batchId);
  if (idx < 0) return { ok: false, coins: 0 };
  const b = list.splice(idx, 1)[0];
  const coins = earn(state, b.jars * colorPrice(state, b.color, 'muddy') * incomeMultiplier(state, now));
  return { ok: true, coins };
}

/** sellAllMuddy(state, args, now) -> {ok, batches, jars, coins}: "Sell all as is" (muddy, 0.8×). */
export function sellAllMuddy(state, args = {}, now = 0) {
  const list = Array.isArray(state.muddyBatches) ? state.muddyBatches : [];
  const t = typeof args === 'number' ? args : now;
  let jars = 0;
  let coins = 0;
  for (const b of list) {
    jars += num(b.jars);
    coins += num(b.jars) * colorPrice(state, b.color, 'muddy');
  }
  const batches = list.length;
  state.muddyBatches = [];
  const paid = earn(state, coins * incomeMultiplier(state, t));
  if (state.activePuzzles && state.activePuzzles.purify) state.activePuzzles.purify = null;
  return { ok: batches > 0, batches, jars, coins: paid };
}

