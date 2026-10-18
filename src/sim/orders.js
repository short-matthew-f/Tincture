// orders.js — the order board and Matching payouts (pure).
// Implements docs/DESIGN.md "Active play › Matching (orders)": 3–6 orders wait
// on the board indefinitely, each target generated from a real recipe of her
// pigments (so Perfect is always reachable); Perfect 150% + a reputation star
// (and a bonus vial), Great 120%, Good 100%, Close 70% — never a fail. Also
// "Anything you love" orders (about 1 in 10, Gentle surprises), container orders
// (an Urn of …, Merge Shelf), the Order Clerk at 70% and the hand-delivery bonus.
// The board stays a sampler of color, not mud: targets avoid the ones already
// open (ΔE ≥ 8), at most 2 per hue family, about half are real catalog colors
// she can discover by matching, and no customer appears twice.
//
// Order {id, kind:'match'|'any'|'container'|'bouquet', target, recipe, pay, minutes,
//        container:null|{color, tier}, postedAt, customer,
//        flowers?:[{target, recipe, colorId?, filled, tier, coins}], event?}
//
// Bouquet orders (Bloom Week's twist, rules.bouquetOrders; DESIGN.md "Weekly
// events": "Bouquet orders (multi-color matching)"): while the twist runs about
// 1 in 3 new orders is a bouquet of 3 flowers, one per event color family, each
// from its own real recipe. Each flower is filled on its own, by mixing it at the
// jar (submitOrder with {flower, drops}) or by handing over BOUQUET_JARS jars of a
// stocked color close to it ({flower, colorId}); each flower pays like an order
// times BOUQUET_BONUS, and the finished bouquet counts as one filled order and
// earns the 'bouquet' event points. The Order Clerk never fills a bouquet.

import { createOrder, blend, score } from '../puzzles/matching.js';
import { getEvent } from '../content/events.js';
import { CUSTOMER_NAMES } from '../content/names.js';
import { deltaEHex, hueFamily } from '../color.js';
import { mixableColors } from '../content/catalog.js';
import { stateRng, uuid, pick, shuffle } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import {
  incomeRate, incomeMultiplier, cheapestUpgrade, colorDef, colorTier, flowMeter, tutorialReward,
} from './economy.js';
import { takeStock, stockOf, BOUQUET_KEEP } from './storage.js';
import { availablePigments, tryDiscover, discoveredColors } from './discovery.js';
import { addVial, chipFor, unlocked as shelfUnlocked, takeContainer, tierValue, shelfColors } from './shelf.js';

export const MIN_OPEN = 3;
export const MAX_OPEN = 6;
export const REFRESH_MS = 20 * 60e3;
export const CLERK_MS = 10 * 60e3;
export const CLERK_PAYOUT = 0.7;
export const CLERK_DE = 10;
export const CLERK_JARS = 3;
export const ANY_CHANCE = 0.1;
export const ANY_MULT = 1.3;
export const ANY_TIER_BONUS = Object.freeze({ primary: 1, secondary: 1.1, tertiary: 1.2, earth: 1.2, tint: 1.35, shade: 1.35, wild: 1.6 });
export const CONTAINER_CHANCE = 1 / 8;
/** At most this many container orders wait on the board at once (they need a merge, not a mix). */
export const MAX_CONTAINER_OPEN = 1;
export const HAND_DELIVER_BONUS = 1.5;
export const PAY_MINUTES = Object.freeze({ min: 2, max: 4 });
export const PAY_FLOOR = 0.25;

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

function board(state) {
  if (!state.orders) state.orders = { open: [], nextRefreshAt: 0, reputation: 0, filledCount: 0 };
  if (!Array.isArray(state.orders.open)) state.orders.open = [];
  return state.orders;
}

/** Base pay (before the income multiplier): minutes of income, floored at 25% of the cheapest upgrade. */
export function orderBasePay(state, minutes = 3) {
  const mult = incomeMultiplier(state);
  const r = mult > 0 ? incomeRate(state) / mult : 0;
  return Math.max(num(minutes) * 60 * r, PAY_FLOOR * num(cheapestUpgrade(state).cost), 1);
}

/** 1.5× when shipping is the bottleneck (Phase 2+): hand delivery helps. */
export function handDeliverBonus(state, now) {
  if ((state.phase ?? 1) < 2) return 1;
  return flowMeter(state, now).weakest === 'ship' ? HAND_DELIVER_BONUS : 1;
}

export const MAX_PER_FAMILY = 2;

/** Bouquet orders (Bloom Week): share of new orders, flowers per bouquet, pay bonus per flower. */
export const BOUQUET_CHANCE = 1 / 3;
export const BOUQUET_FLOWERS = 3;
export const BOUQUET_BONUS = 1.25;
/** Jars of a stocked color that fill one flower, and how close (ΔE) that color must be. */
export const BOUQUET_JARS = BOUQUET_KEEP; // the shop keeps this many back for an open flower (storage.js)
export const BOUQUET_STOCK_DE = 10;
/** At most this many bouquets wait on the board at once. */
export const MAX_BOUQUET_OPEN = 2;

function orderPigments(state) {
  return availablePigments(state).filter((p) => p.id !== 'white' && p.id !== 'black');
}

/** Era 1 catalog colors an order can ask for: mixable from her pigments and drops, and discoverable by matching. */
export function orderCatalogRecipes(state) {
  const have = new Set(availablePigments(state).map((p) => p.id));
  const era = state?.era ?? 1;
  return mixableColors()
    .filter((c) => (c.era ?? 1) === era && c.foundBy === 'mix' && c.recipe.length >= 2 && c.recipe.every((r) => have.has(r.pigment)))
    .map((c) => ({ id: c.id, hex: c.hex, recipe: c.recipe, discovered: !!state?.catalog?.discovered?.[c.id] }));
}

/** What the open board already shows: target hexes, families at their cap, customers. */
function boardContext(state) {
  const open = Array.isArray(state.orders?.open) ? state.orders.open : [];
  const avoidHexes = open.flatMap((o) => (o && Array.isArray(o.flowers) ? o.flowers.map((f) => f.target) : [o && o.target]))
    .filter((h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h));
  const perFamily = {};
  for (const h of avoidHexes) { const f = hueFamily(h); perFamily[f] = (perFamily[f] ?? 0) + 1; }
  const avoidFamilies = Object.keys(perFamily).filter((f) => perFamily[f] >= MAX_PER_FAMILY);
  const customers = new Set(open.map((o) => o && o.customer).filter(Boolean));
  const containers = open.filter((o) => o && o.kind === 'container').length;
  const bouquets = open.filter((o) => o && o.kind === 'bouquet').length;
  return { avoidHexes, avoidFamilies, customers, containers, bouquets };
}

/** Colors a container order may ask for: the shelf's chips, because those are the vials that actually arrive. */
export function containerOrderColors(state) {
  return shelfUnlocked(state) ? shelfColors(state) : [];
}

/** The running event when its twist asks for bouquet orders, else null. */
export function bouquetEvent(state) {
  const ev = state?.event?.key ? getEvent(state.event.key) : null;
  return ev && ev.twist.rules.bouquetOrders ? ev : null;
}

/**
 * makeBouquet(state, rng, families, avoidHexes) -> [{target, recipe, colorId?}] or null.
 * One flower per family (shuffled), each a real recipe of her pigments whose hue
 * family is that family, ΔE ≥ 6 from each other (≥ 4 from the board). Null when fewer
 * than 2 flowers fit (then a plain order is posted instead).
 */
export function makeBouquet(state, rng, families = [], avoidHexes = []) {
  const pigments = orderPigments(state);
  if (!pigments.length || !families.length) return null;
  const catalog = orderCatalogRecipes(state);
  const flowers = [];
  const order = shuffle(rng, families);
  for (let round = 0; round < 2 && flowers.length < BOUQUET_FLOWERS; round++) {
    for (const fam of order) {
      if (flowers.length >= BOUQUET_FLOWERS) break;
      if (round === 0 && flowers.some((f) => f.family === fam)) continue;
      const inFam = catalog.filter((c) => hueFamily(c.hex) === fam);
      for (let k = 0; k < 16; k++) {
        // Flowers are checked against each other here, not through createOrder's board
        // rules (those allow one muted target per board, and garden pinks are often soft).
        const o = createOrder({ pigments, difficulty: 0.2, catalogRecipes: inFam, catalogChance: 0.6 }, rng);
        if (hueFamily(o.target) !== fam) continue;
        if (flowers.some((f) => deltaEHex(f.target, o.target) < 6)) continue;
        if (avoidHexes.some((hx) => deltaEHex(hx, o.target) < 4)) continue;
        flowers.push({ family: fam, target: o.target, recipe: o.recipe, ...(o.colorId ? { colorId: o.colorId } : {}) });
        break;
      }
    }
  }
  if (flowers.length < 2) return null;
  return flowers.map(({ target, recipe, colorId }) => ({ target, recipe, ...(colorId ? { colorId } : {}), filled: false, tier: null, coins: 0 }));
}

/**
 * bouquetStock(state, flower) -> [{colorId, de, jars}] stocked colors (≥ BOUQUET_JARS jars)
 * within BOUQUET_STOCK_DE of the flower, closest first: what she can hand over right now.
 */
export function bouquetStock(state, flower) {
  if (!flower || !flower.target) return [];
  const out = [];
  for (const [colorId, e] of Object.entries(state.stock ?? {})) {
    const jars = num(e?.jars);
    if (jars < BOUQUET_JARS) continue;
    const hex = colorDef(colorId)?.hex;
    if (!hex) continue;
    const de = deltaEHex(flower.target, hex);
    if (de <= BOUQUET_STOCK_DE) out.push({ colorId, de, jars });
  }
  return out.sort((a, b) => a.de - b.de);
}

/** generateOrder(state, rng, now) -> Order (not yet posted), chosen to sit well beside the open board. */
export function generateOrder(state, rng = stateRng(state), now = 0) {
  const ctx = boardContext(state);
  const minutes = PAY_MINUTES.min + (PAY_MINUTES.max - PAY_MINUTES.min) * rng();
  const names = CUSTOMER_NAMES ?? [];
  const fresh = names.filter((n) => !ctx.customers.has(n));
  const customer = pick(rng, fresh.length ? fresh : names) ?? 'A neighbor';
  const base = { id: 'o-' + uuid(rng), postedAt: now, customer, minutes, pay: orderBasePay(state, minutes), container: null };
  // Bloom Week: about 1 in 3 new orders is a bouquet (at most MAX_BOUQUET_OPEN wait at once).
  const bev = bouquetEvent(state);
  if (bev && ctx.bouquets < MAX_BOUQUET_OPEN && rng() < BOUQUET_CHANCE) {
    const flowers = makeBouquet(state, rng, bev.palette, ctx.avoidHexes);
    if (flowers) return { ...base, kind: 'bouquet', target: flowers[0].target, recipe: null, flowers, event: bev.id };
  }
  const roll = rng();
  if (roll < ANY_CHANCE) return { ...base, kind: 'any', target: null, recipe: null };
  // A container order asks for one of the shelf's own chip colors (the vials she
  // actually receives), and only one waits at a time: a board of jars nobody can
  // merge would block her for a day.
  if ((state.phase ?? 1) >= 2 && ctx.containers < MAX_CONTAINER_OPEN && rng() < CONTAINER_CHANCE) {
    const color = pick(rng, containerOrderColors(state));
    if (color) {
      const tier = 2 + Math.floor(rng() * 2);
      return { ...base, kind: 'container', target: colorDef(color)?.hex ?? null, recipe: null, container: { color, tier } };
    }
  }
  const difficulty = Math.min(1, 0.3 * ((state.phase ?? 1) - 1) + 0.02 * num(state.orders?.reputation));
  const o = createOrder({
    pigments: orderPigments(state),
    difficulty,
    avoidHexes: ctx.avoidHexes,
    avoidFamilies: ctx.avoidFamilies,
    catalogRecipes: orderCatalogRecipes(state),
  }, rng);
  return { ...base, kind: 'match', target: o.target, recipe: o.recipe };
}

/**
 * refreshOrders(state, now) -> {added}. Keeps at least 3 open (filled at once),
 * posts one more every 20 minutes up to 6. Orders never expire. Each new order
 * is generated against the board as it stands (see generateOrder).
 */
export function refreshOrders(state, now = 0) {
  const b = board(state);
  const rng = stateRng(state);
  let added = 0;
  // Keep at most MAX_CONTAINER_OPEN container orders (older saves could pile up
  // three): the extras are passed on and replaced with fresh orders.
  let containers = 0;
  for (let i = 0; i < b.open.length; i++) {
    const o = b.open[i];
    if (!o || o.kind !== 'container') continue;
    if (++containers > MAX_CONTAINER_OPEN) { b.open.splice(i, 1); i--; }
  }
  while (b.open.length < MIN_OPEN) { b.open.push(generateOrder(state, rng, now)); added++; }
  if (!(num(b.nextRefreshAt) > 0)) b.nextRefreshAt = now + REFRESH_MS;
  while (b.nextRefreshAt <= now && b.open.length < MAX_OPEN) {
    b.open.push(generateOrder(state, rng, b.nextRefreshAt));
    b.nextRefreshAt += REFRESH_MS;
    added++;
  }
  if (b.nextRefreshAt <= now) b.nextRefreshAt = now + REFRESH_MS;
  if (added) emit(state, 'orders', { added });
  return { added };
}

/**
 * passOrder(state, {orderId}, now) -> {ok, reason?}. Lets a container order go
 * to another shop: it leaves the board and a fresh order takes its place. Only
 * container orders can be passed on (match orders never fail, and an
 * "anything you love" order takes any discovered color).
 */
export function passOrder(state, args = {}, now = 0) {
  const b = board(state);
  const idx = b.open.findIndex((o) => o && o.id === args.orderId);
  if (idx < 0) return { ok: false, reason: 'order' };
  if (b.open[idx].kind !== 'container') return { ok: false, reason: 'kind' };
  b.open.splice(idx, 1);
  b.passed = num(b.passed) + 1;
  refreshOrders(state, now);
  emit(state, 'orderPassed', { orderId: args.orderId });
  return { ok: true };
}

function nearestDiscovered(state, hex) {
  let best = null;
  for (const c of discoveredColors(state)) {
    const de = deltaEHex(hex, c.hex);
    if (!best || de < best.de) best = { id: c.id, de };
  }
  return best?.id ?? null;
}

function payOut(state, coins) {
  state.coins = num(state.coins) + coins;
  state.runEarned = num(state.runEarned) + coins;
  if (state.lifetime) state.lifetime.earned = num(state.lifetime.earned) + coins;
}

/**
 * submitOrder(state, {orderId, drops:[{id,hex,count}] | colorId | cell}, now)
 * -> {ok, tier, pct, coins, de, mixHex, discovered, vialCell}.
 * match: scored by ΔE (never fails, ≥70%); any: a discovered color she picks
 * (1.3× and a rarity bonus); container: a shelf container of that color and size.
 */
export function submitOrder(state, args = {}, now = 0) {
  const b = board(state);
  const idx = b.open.findIndex((o) => o.id === args.orderId);
  if (idx < 0) return { ok: false, reason: 'order' };
  const order = b.open[idx];
  const base = Math.max(num(order.pay), orderBasePay(state, order.minutes ?? 3));
  const mult = incomeMultiplier(state, now) * handDeliverBonus(state, now);
  let res;
  if (order.kind === 'bouquet') return submitFlower(state, b, idx, order, base, mult, args, now);
  if (order.kind === 'any') {
    const id = args.colorId;
    if (!id || !state.catalog?.discovered?.[id]) return { ok: false, reason: 'color' };
    const pct = ANY_MULT * (ANY_TIER_BONUS[colorTier(id)] ?? 1);
    res = { tier: 'loved', pct, colorId: id };
  } else if (order.kind === 'container') {
    const cell = state.shelf?.cells?.[args.cell];
    const want = order.container;
    if (!cell || !want || cell.color !== want.color || cell.tier < want.tier) return { ok: false, reason: 'container' };
    takeContainer(state, { cell: args.cell });
    res = { tier: 'container', pct: 1 + 0.5 * want.tier * (tierValue(cell.tier) / tierValue(want.tier)) };
  } else {
    const mixHex = args.hex ?? blend(args.drops ?? []);
    const sc = score(order.target, mixHex);
    res = { tier: sc.tier, pct: sc.pct, de: sc.de, mixHex, star: sc.star };
    if (mixHex) res.discovered = tryDiscover(state, { hex: mixHex, method: 'order' }, now);
  }
  let coins = num(base * res.pct * mult);
  // The onboarding's first order also pays a tutorial reward: one cheapest upgrade.
  if (order.tutorial) {
    res.tutorialBonus = tutorialReward(state);
    coins += res.tutorialBonus;
  }
  payOut(state, coins);
  b.open.splice(idx, 1);
  b.filledCount = num(b.filledCount) + 1;
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  if (res.tier === 'perfect') {
    b.reputation = num(b.reputation) + 1;
    if (shelfUnlocked(state)) {
      const near = nearestDiscovered(state, order.target);
      const color = near ? chipFor(state, near) : null;
      if (color) res.vialCell = addVial(state, { colorId: color });
    }
  }
  questEvent(state, 'orderFilled', 1, { tier: res.tier, kind: order.kind });
  eventPoints(state, 'order', 1, { tier: res.tier, target: order.target, hex: order.target, colorId: res.colorId ?? order.container?.color ?? null });
  emit(state, 'orderFilled', { orderId: order.id, tier: res.tier, coins });
  refreshOrders(state, now);
  return { ok: true, coins, ...res };
}

/**
 * One flower of a bouquet: {flower, drops|hex} mixes it (scored like a match, never
 * fails), {flower, colorId} hands over BOUQUET_JARS jars of a stocked color within
 * BOUQUET_STOCK_DE. Pays base × pct × BOUQUET_BONUS. When the last flower is in,
 * the bouquet leaves the board, counts as a filled order and earns 'bouquet' points.
 */
function submitFlower(state, b, idx, order, base, mult, args, now) {
  const fi = Number(args.flower);
  const flower = Number.isInteger(fi) ? order.flowers?.[fi] : null;
  if (!flower) return { ok: false, reason: 'flower' };
  if (flower.filled) return { ok: false, reason: 'filled' };
  let res;
  if (args.colorId) {
    const hex = colorDef(args.colorId)?.hex;
    if (!hex || stockOf(state, args.colorId) < BOUQUET_JARS - 1e-9) return { ok: false, reason: 'stock' };
    const sc = score(flower.target, hex);
    if (!(sc.de <= BOUQUET_STOCK_DE)) return { ok: false, reason: 'color' };
    takeStock(state, args.colorId, BOUQUET_JARS, { prefer: 'low' });
    res = { tier: sc.tier, pct: sc.pct, de: sc.de, mixHex: hex, star: sc.star, fromStock: args.colorId };
  } else {
    const mixHex = args.hex ?? blend(args.drops ?? []);
    const sc = score(flower.target, mixHex);
    res = { tier: sc.tier, pct: sc.pct, de: sc.de, mixHex, star: sc.star };
    if (mixHex) res.discovered = tryDiscover(state, { hex: mixHex, method: 'order' }, now);
  }
  const coins = num(base * res.pct * mult * BOUQUET_BONUS);
  payOut(state, coins);
  flower.filled = true;
  flower.tier = res.tier;
  flower.coins = coins;
  if (res.tier === 'perfect') b.reputation = num(b.reputation) + 1;
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  const left = order.flowers.filter((f) => !f.filled).length;
  const complete = left === 0;
  let points = 0;
  if (complete) {
    b.open.splice(idx, 1);
    b.filledCount = num(b.filledCount) + 1;
    questEvent(state, 'orderFilled', 1, { tier: res.tier, kind: 'bouquet' });
    points = eventPoints(state, 'bouquet', 1, { event: order.event || true });
    emit(state, 'orderFilled', { orderId: order.id, tier: res.tier, coins, bouquet: true });
    refreshOrders(state, now);
  }
  return {
    ok: true, coins, ...res,
    bouquet: { flower: fi, left, total: order.flowers.length, complete, points, coins: order.flowers.reduce((s2, f) => s2 + num(f.coins), 0) },
  };
}

/**
 * autoFillOrders(state, now) -> {filled, coins}. Order Clerk: every 10 minutes
 * fills one 'match' order from stock within ΔE 10 (3 jars), at 70% payout.
 * Bouquets, container and "anything you love" orders are always left for her.
 */
export function autoFillOrders(state, now = 0) {
  if (!state.apprentices?.orderClerk) return { filled: 0, coins: 0 };
  const b = board(state);
  if (!(num(b.nextClerkAt) > 0)) { b.nextClerkAt = now + CLERK_MS; return { filled: 0, coins: 0 }; }
  let filled = 0;
  let coins = 0;
  while (b.nextClerkAt <= now && filled < MAX_OPEN) {
    b.nextClerkAt += CLERK_MS;
    let done = false;
    for (let i = 0; i < b.open.length && !done; i++) {
      const o = b.open[i];
      if (o.kind !== 'match' || !o.target) continue;
      let best = null;
      for (const [colorId, e] of Object.entries(state.stock ?? {})) {
        if (num(e?.jars) < CLERK_JARS) continue;
        const hex = colorDef(colorId)?.hex;
        if (!hex) continue;
        const de = deltaEHex(o.target, hex);
        if (de <= CLERK_DE && (!best || de < best.de)) best = { colorId, de };
      }
      if (!best) continue;
      takeStock(state, best.colorId, CLERK_JARS, { prefer: 'low' });
      const pay = num(Math.max(num(o.pay), orderBasePay(state, o.minutes ?? 3)) * CLERK_PAYOUT * incomeMultiplier(state, now));
      payOut(state, pay);
      coins += pay;
      b.open.splice(i, 1);
      b.filledCount = num(b.filledCount) + 1;
      filled++;
      done = true;
    }
    if (!done) { b.nextClerkAt = now + CLERK_MS; break; }
  }
  if (b.nextClerkAt <= now) b.nextClerkAt = now + CLERK_MS;
  if (filled) refreshOrders(state, now);
  return { filled, coins };
}

