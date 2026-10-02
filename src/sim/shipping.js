// shipping.js — fleet, routes, demand drift and trips (pure).
// Implements docs/DESIGN.md "Storage and shipping › Shipping: fleet and routes"
// and "Packing (sorting tie-in)": routes want a palette and pay a premium,
// demand drifts every few days (seeded by route and window, so every device
// agrees), hand-packed crates ship +25%, the Dispatcher auto-ships at base
// value. No breakdowns, hazards or failures.
//
// Vehicle: {kind, level, route, departedAt, arrivesAt, cargo:[{colorId, jars, byPurity}]|null, packed}

import { ROUTES, ROUTES_BY_ID, DEMAND_BONUS, DEMAND_DRIFT_DAYS } from '../content/routes.js';
import { VEHICLES_BY_ID, PACKING_BONUS } from '../content/stations.js';
import { slotsForRooms } from '../content/rooms.js';
import { mulberry32 } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import {
  colorPrice, colorFamily, incomeMultiplier, vehicleCapacity, vehicleTripMs, discoveredCount,
} from './economy.js';
import { takeStock, addStock, PURITY_ORDER } from './storage.js';

const DAY = 86400e3;
const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/**
 * Special markets hunters have found (ids). `state.discoveredMarkets` is the
 * canonical list; `state.routesDiscovered` is the hunters' legacy mirror and is
 * folded in so a market found by either path opens its route.
 */
export function discoveredMarkets(state) {
  const a = Array.isArray(state?.discoveredMarkets) ? state.discoveredMarkets : [];
  const b = Array.isArray(state?.routesDiscovered) ? state.routesDiscovered : [];
  if (!b.length) return a;
  return [...new Set([...a, ...b])];
}

/** discoverMarket(state, {routeId}) — called by hunters when a trip finds a special market. */
export function discoverMarket(state, args = {}) {
  const r = ROUTES_BY_ID[args.routeId];
  if (!r || r.unlock.type !== 'discovered') return { ok: false };
  if (!state.discoveredMarkets) state.discoveredMarkets = [];
  if (state.discoveredMarkets.includes(r.id)) return { ok: false, already: true };
  state.discoveredMarkets.push(r.id);
  emit(state, 'market', { routeId: r.id });
  return { ok: true };
}

/** Routes open to her now. */
export function availableRoutes(state, now = 0) { // eslint-disable-line no-unused-vars
  const colors = discoveredCount(state);
  const markets = discoveredMarkets(state);
  return ROUTES.filter((r) => {
    const u = r.unlock;
    if (u.type === 'phase') return (state.phase ?? 1) >= u.phase;
    if (u.type === 'colors') return (state.phase ?? 1) >= 2 && colors >= u.n;
    if (u.type === 'discovered') return markets.includes(r.id);
    return false;
  });
}

/** currentDemand(state, routeId, now) -> {family, bonus, until}: drifts every DEMAND_DRIFT_DAYS. */
export function currentDemand(state, routeId, now = 0) {
  const r = ROUTES_BY_ID[routeId];
  if (!r) return { family: null, bonus: 0, until: 0 };
  const driftMs = (r.demandDriftDays ?? DEMAND_DRIFT_DAYS) * DAY;
  const window = Math.floor(num(now) / driftMs);
  const rng = mulberry32((hashString(routeId) ^ Math.imul(window + 1, 0x9e3779b1)) >>> 0);
  rng();
  const family = r.palette[Math.floor(rng() * r.palette.length) % r.palette.length];
  const raw = DEMAND_BONUS.min + (DEMAND_BONUS.max - DEMAND_BONUS.min) * rng();
  const bonus = Math.round(raw * 20) / 20; // nearest 5%
  return { family, bonus, until: (window + 1) * driftMs };
}

/** Price multiplier for one jar of `colorId` at `purity` on a route (premium + demand). */
export function routeMultiplier(state, routeId, colorId, purity, now) {
  const r = ROUTES_BY_ID[routeId];
  if (!r) return 1;
  const fam = colorFamily(colorId);
  let m = 1;
  const onPalette = r.any || r.palette.includes(fam);
  if (onPalette) {
    const purityOk = !r.wantsPurity || purity === 'pure' || purity === 'flawless';
    if (purityOk || r.premium < 0) m += r.premium;
  }
  const d = currentDemand(state, routeId, now);
  if (d.family && d.family === fam) m += d.bonus;
  return Math.max(0.1, m);
}

/** Coins a cargo would pay on a route (includes the income multiplier). */
export function cargoValue(state, routeId, cargo, packed, now) {
  let v = 0;
  for (const item of cargo ?? []) {
    const bp = item.byPurity ?? { standard: item.jars };
    for (const p of PURITY_ORDER) {
      const j = num(bp[p]);
      if (j > 0) v += j * colorPrice(state, item.colorId, p) * routeMultiplier(state, routeId, item.colorId, p, now);
    }
  }
  return num(v * (packed ? 1 + PACKING_BONUS : 1) * incomeMultiplier(state, now));
}

function vehicleAt(state, i) {
  return state?.stations?.fleet?.[i | 0] ?? null;
}

export function isIdle(v) {
  return !!v && !(num(v.arrivesAt) > 0);
}

function cargoJars(cargo) {
  return (cargo ?? []).reduce((s, c) => s + num(c.jars), 0);
}

/**
 * loadCargo(state, {vehicle, routeId, picks:[{colorId, jars}]}, now) -> {ok, cargo, jars}.
 * Takes stock (lowest purity first, except routes that want purity) up to capacity.
 */
export function loadCargo(state, args = {}, now = 0) { // eslint-disable-line no-unused-vars
  const v = vehicleAt(state, args.vehicle);
  if (!v || !isIdle(v)) return { ok: false, reason: 'busy', cargo: null, jars: 0 };
  const routeId = args.routeId ?? v.route;
  const r = ROUTES_BY_ID[routeId];
  if (r) v.route = routeId;
  let room = vehicleCapacity(v) - cargoJars(v.cargo);
  const cargo = v.cargo ? v.cargo.slice() : [];
  for (const pick of args.picks ?? []) {
    if (room <= 1e-9) break;
    const want = Math.min(room, Math.max(0, num(pick.jars)));
    if (!(want > 0)) continue;
    const got = takeStock(state, pick.colorId, want, { prefer: r?.wantsPurity ? 'high' : 'low' });
    if (got.taken <= 0) continue;
    const existing = cargo.find((c) => c.colorId === pick.colorId);
    if (existing) {
      existing.jars += got.taken;
      for (const p of PURITY_ORDER) existing.byPurity[p] = num(existing.byPurity[p]) + got.byPurity[p];
    } else {
      cargo.push({ colorId: pick.colorId, jars: got.taken, byPurity: got.byPurity });
    }
    room -= got.taken;
  }
  v.cargo = cargo.length ? cargo : null;
  return { ok: true, cargo: v.cargo, jars: cargoJars(v.cargo) };
}

/** Put a loaded (not yet departed) vehicle's cargo back into stock. */
export function unloadCargo(state, args = {}) {
  const v = vehicleAt(state, args.vehicle);
  if (!v || !isIdle(v) || !v.cargo) return { ok: false };
  for (const c of v.cargo) {
    for (const p of PURITY_ORDER) if (num(c.byPurity?.[p]) > 0) addStock(state, c.colorId, c.byPurity[p], p, { cap: false });
  }
  v.cargo = null;
  return { ok: true };
}

/**
 * dispatch(state, {vehicle, routeId, cargo?, packed}, now) -> {ok, arrivesAt, value}.
 * `cargo` (picks) is loaded first when given. Packed crates ship +25% unless the
 * Packer did it (auto-pack ships at base value).
 */
export function dispatch(state, args = {}, now = 0) {
  const v = vehicleAt(state, args.vehicle);
  if (!v || !isIdle(v)) return { ok: false, reason: 'busy' };
  const routeId = args.routeId ?? v.route;
  if (!ROUTES_BY_ID[routeId] || !availableRoutes(state, now).some((r) => r.id === routeId)) return { ok: false, reason: 'route' };
  if (Array.isArray(args.cargo) && args.cargo.length) {
    const picks = args.cargo.map((c) => ({ colorId: c.colorId, jars: c.jars }));
    loadCargo(state, { vehicle: args.vehicle, routeId, picks }, now);
  }
  if (!cargoJars(v.cargo)) return { ok: false, reason: 'empty' };
  v.route = routeId;
  v.packed = !!args.packed;
  v.departedAt = now;
  v.arrivesAt = now + vehicleTripMs(v);
  questEvent(state, 'crateShipped', 1, { routeId, packed: v.packed });
  eventPoints(state, 'crate', 1, { routeId });
  return { ok: true, arrivesAt: v.arrivesAt, value: cargoValue(state, routeId, v.cargo, v.packed, now) };
}

/** resolveTrips(state, now) -> {coins, trips}. Pays every vehicle home by `now`. */
export function resolveTrips(state, now = 0) {
  let coins = 0;
  let trips = 0;
  for (const v of state?.stations?.fleet ?? []) {
    if (!(num(v.arrivesAt) > 0) || v.arrivesAt > now) continue;
    const pay = cargoValue(state, v.route, v.cargo, v.packed, v.arrivesAt);
    coins += pay;
    trips++;
    v.departedAt = 0;
    v.arrivesAt = 0;
    v.cargo = null;
    v.packed = false;
  }
  if (coins > 0) {
    state.coins = num(state.coins) + coins;
    state.runEarned = num(state.runEarned) + coins;
    if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
    emit(state, 'shipped', { coins, trips });
  }
  return { coins, trips };
}

/** Best stock for a route: demand family, then on-palette, then the rest by price. */
function bestPicks(state, routeId, room, now) {
  const r = ROUTES_BY_ID[routeId];
  const d = currentDemand(state, routeId, now);
  const list = Object.entries(state.stock ?? {})
    .filter(([, e]) => num(e?.jars) > 0)
    .map(([colorId, e]) => {
      const fam = colorFamily(colorId);
      const on = r.any || r.palette.includes(fam);
      const score = (fam === d.family ? 2 : 0) + (on ? 1 : 0);
      return { colorId, jars: e.jars, score, price: colorPrice(state, colorId) };
    })
    .filter((x) => x.score > 0 || r.any)
    .sort((a, b) => b.score - a.score || b.price - a.price);
  const picks = [];
  let left = room;
  for (const x of list) {
    if (left <= 1e-9) break;
    const j = Math.min(left, x.jars);
    picks.push({ colorId: x.colorId, jars: j });
    left -= j;
  }
  return picks;
}

/**
 * autoDispatch(state, now) -> {dispatched}. Dispatcher: every idle vehicle with a
 * route is filled with the best-matching stock and sent (no packing bonus).
 * Waits for at least a quarter load so carts don't leave nearly empty.
 */
export function autoDispatch(state, now = 0) {
  if (!state?.apprentices?.dispatcher) return { dispatched: 0 };
  let dispatched = 0;
  const open = new Set(availableRoutes(state, now).map((r) => r.id));
  (state.stations.fleet ?? []).forEach((v, i) => {
    if (!isIdle(v) || !v.route || !open.has(v.route)) return;
    const cap = vehicleCapacity(v);
    const picks = bestPicks(state, v.route, cap - cargoJars(v.cargo), now);
    const avail = picks.reduce((s, p) => s + p.jars, 0) + cargoJars(v.cargo);
    if (avail < cap * 0.25) return;
    loadCargo(state, { vehicle: i, routeId: v.route, picks }, now);
    const res = dispatch(state, { vehicle: i, routeId: v.route, packed: false }, now);
    if (res.ok) dispatched++;
  });
  return { dispatched };
}

/** Set the route a vehicle runs (used by the Dispatcher). */
export function setVehicleRoute(state, args = {}) {
  const v = vehicleAt(state, args.vehicle);
  if (!v) return { ok: false };
  if (args.routeId && !ROUTES_BY_ID[args.routeId]) return { ok: false };
  v.route = args.routeId ?? null;
  return { ok: true };
}

export function fleetSlots(state) {
  return slotsForRooms(state?.rooms ?? []).fleet;
}

/**
 * buyVehicle(state, {kind, index?}) -> {ok, index, cost}. Adds a vehicle when a
 * fleet slot is free, otherwise replaces the given (or weakest) idle vehicle.
 */
export function buyVehicle(state, args = {}) {
  const def = VEHICLES_BY_ID[args.kind];
  if (!def || def.era !== (state.era ?? 1)) return { ok: false, reason: 'kind' };
  const slots = fleetSlots(state);
  if (slots <= 0) return { ok: false, reason: 'slots' };
  if (num(state.coins) < def.cost) return { ok: false, reason: 'coins', cost: def.cost };
  const fleet = state.stations.fleet ?? (state.stations.fleet = []);
  let index;
  if (fleet.length < slots) {
    fleet.push({ kind: def.id, level: 1, route: null, departedAt: 0, arrivesAt: 0, cargo: null, packed: false });
    index = fleet.length - 1;
  } else {
    if (Number.isInteger(args.index) && fleet[args.index] && isIdle(fleet[args.index])) index = args.index;
    else {
      let worst = -1;
      fleet.forEach((v, i) => {
        if (!isIdle(v) || v.cargo) return;
        if (worst < 0 || vehicleCapacity(v) < vehicleCapacity(fleet[worst])) worst = i;
      });
      index = worst;
    }
    if (index < 0 || !fleet[index]) return { ok: false, reason: 'busy' };
    if (fleet[index].kind === def.id) return { ok: false, reason: 'same' };
    fleet[index] = { kind: def.id, level: 1, route: fleet[index].route, departedAt: 0, arrivesAt: 0, cargo: null, packed: false };
  }
  state.coins -= def.cost;
  questEvent(state, 'upgradeBought', 1, { kind: 'vehicle', vehicle: def.id });
  return { ok: true, index, cost: def.cost };
}
