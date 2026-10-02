// orders.js — the order board and Matching payouts (pure).
// Implements docs/DESIGN.md "Active play › Matching (orders)": 3–6 orders wait
// on the board indefinitely, each target generated from a real recipe of her
// pigments (so Perfect is always reachable); Perfect 150% + a reputation star
// (and a bonus vial), Great 120%, Good 100%, Close 70% — never a fail. Also
// "Anything you love" orders (about 1 in 10, Gentle surprises), container orders
// (an Urn of …, Merge Shelf), the Order Clerk at 70% and the hand-delivery bonus.
//
// Order {id, kind:'match'|'any'|'container', target, recipe, pay, minutes,
//        container:null|{color, tier}, postedAt, customer}

import { createOrder, blend, score } from '../puzzles/matching.js';
import { CUSTOMER_NAMES } from '../content/names.js';
import { deltaEHex } from '../color.js';
import { stateRng, uuid, pick } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import {
  incomeRate, incomeMultiplier, cheapestUpgrade, colorDef, colorTier, flowMeter,
} from './economy.js';
import { takeStock } from './storage.js';
import { availablePigments, tryDiscover, discoveredColors } from './discovery.js';
import { addVial, unlocked as shelfUnlocked, takeContainer, tierValue } from './shelf.js';

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

function orderPigments(state) {
  return availablePigments(state).filter((p) => p.id !== 'white' && p.id !== 'black');
}

/** generateOrder(state, rng, now) -> Order (not yet posted). */
export function generateOrder(state, rng = stateRng(state), now = 0) {
  const minutes = PAY_MINUTES.min + (PAY_MINUTES.max - PAY_MINUTES.min) * rng();
  const customer = pick(rng, CUSTOMER_NAMES ?? []) ?? 'A neighbor';
  const base = { id: 'o-' + uuid(rng), postedAt: now, customer, minutes, pay: orderBasePay(state, minutes), container: null };
  const roll = rng();
  if (roll < ANY_CHANCE) return { ...base, kind: 'any', target: null, recipe: null };
  if ((state.phase ?? 1) >= 2 && shelfUnlocked(state) && rng() < CONTAINER_CHANCE) {
    const colors = discoveredColors(state);
    const assigned = (state.stations?.mixers ?? []).map((m) => m.recipe).filter(Boolean);
    const color = pick(rng, assigned.length ? assigned : colors.map((c) => c.id));
    if (color) {
      const tier = 2 + Math.floor(rng() * 2);
      return { ...base, kind: 'container', target: colorDef(color)?.hex ?? null, recipe: null, container: { color, tier } };
    }
  }
  const difficulty = Math.min(1, 0.3 * ((state.phase ?? 1) - 1) + 0.02 * num(state.orders?.reputation));
  const o = createOrder({ pigments: orderPigments(state), difficulty }, rng);
  return { ...base, kind: 'match', target: o.target, recipe: o.recipe };
}

/**
 * refreshOrders(state, now) -> {added}. Keeps at least 3 open (filled at once),
 * posts one more every 20 minutes up to 6. Orders never expire.
 */
export function refreshOrders(state, now = 0) {
  const b = board(state);
  const rng = stateRng(state);
  let added = 0;
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
  const coins = num(base * res.pct * mult);
  payOut(state, coins);
  b.open.splice(idx, 1);
  b.filledCount = num(b.filledCount) + 1;
  if (state.lifetime) state.lifetime.puzzles = num(state.lifetime.puzzles) + 1;
  if (res.tier === 'perfect') {
    b.reputation = num(b.reputation) + 1;
    if (shelfUnlocked(state)) {
      const color = nearestDiscovered(state, order.target);
      if (color) res.vialCell = addVial(state, { colorId: color });
    }
  }
  questEvent(state, 'orderFilled', 1, { tier: res.tier, kind: order.kind });
  eventPoints(state, 'order', 1, { tier: res.tier, target: order.target });
  emit(state, 'orderFilled', { orderId: order.id, tier: res.tier, coins });
  refreshOrders(state, now);
  return { ok: true, coins, ...res };
}

/**
 * autoFillOrders(state, now) -> {filled, coins}. Order Clerk: every 10 minutes
 * fills one 'match' order from stock within ΔE 10 (3 jars), at 70% payout.
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

