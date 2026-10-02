// sim/ledger.js — the Morning Ledger: a snapshot before time passes, the return
// summary built after (every line a tap target), the "Almost there" strip of nearly
// finished things, and the "All caught up" stopping point.
// Spec: DESIGN.md "Core loop" > "Check-in surface"; "Fun and engagement" >
// "Open loops", "Stopping points". Positive framing everywhere ("2 more colors").
//
// LedgerSummary {away, produced:[{color, jars}], shipped, coinsEarned, huntersHome:[],
//   postcards:[], ordersPosted, vials, canvases:[], collector, questsReady,
//   almostThere:[{icon, text, screen, params?}], lines:[{icon, text, screen, params?}]}

import { formatNumber, formatDuration } from '../format.js';
import { getRegion } from '../content/regions.js';
import { ROOMS } from '../content/rooms.js';
import { getCommission } from '../content/commissions.js';
import * as CV from '../content/canvases.js';
import { emit } from './bus.js';
import { displayName, discoveredCount } from './discovery.js';
import { incomeRate, cheapestUpgrade } from './economy.js';
import { allColors, familyOfColor, colorInfo } from './hunters.js';
import { questsReady } from './quests.js';
import { claimableSteps } from './events.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
export const CONTAINER_NAMES = Object.freeze(['Vial', 'Jar', 'Bottle', 'Urn', 'Cask']);
const containerName = (tier) => CONTAINER_NAMES[Math.max(1, Math.min(5, tier)) - 1];

function nameOf(state, colorId) {
  try { return displayName(state, colorId) || colorId; } catch { return colorId; }
}

function plural(n, one, many) {
  return `${formatNumber(n)} ${n === 1 ? one : (many ?? one + 's')}`;
}

function canvasDef(id) {
  const cv = CV.CANVASES;
  const list = Array.isArray(cv) ? cv : (cv && typeof cv === 'object' ? Object.values(cv) : []);
  return list.find((c) => c && c.id === id) ?? null;
}

/** snapshot(state) — the "before" picture for buildReturnSummary. */
export function snapshot(state) {
  const stock = {};
  for (const [id, e] of Object.entries(state.stock || {})) stock[id] = fin(e && e.jars);
  const roster = (state.hunters && state.hunters.roster) || [];
  return {
    at: fin(state.lastSeenAt ?? state.lastTick),
    coins: fin(state.coins),
    earned: fin(state.lifetime && state.lifetime.earned),
    stock,
    huntersOut: roster.filter((h) => h.state === 'out').map((h) => h.id),
    albumCards: Object.keys((state.album && state.album.cards) || {}),
    albumCount: Object.keys((state.album && state.album.cards) || {}).length,
    ordersCount: ((state.orders && state.orders.open) || []).length,
    orderIds: ((state.orders && state.orders.open) || []).map((o) => o && o.id),
    shelfCount: ((state.shelf && state.shelf.cells) || []).filter(Boolean).length,
    questsDone: ((state.quests && state.quests.daily) || []).filter((q) => q.done).length,
    canvases: [...((state.gallery && state.gallery.canvases) || [])],
    collector: !!(state.gallery && state.gallery.collectorOffer),
    discovered: Object.keys((state.catalog && state.catalog.discovered) || {}),
    shipped: fin(state.stats && state.stats.shipped),
    filled: fin(state.orders && state.orders.filledCount),
  };
}

function pinnedLine(state, id) {
  const c = colorInfo(id) || {};
  const fam = familyOfColor(id);
  const region = c.region ? getRegion(c.region) : null;
  const how = {
    mix: { text: `Your pinned ${fam}: try a new mix at the bench`, screen: 'workshop', params: { panel: 'bench' } },
    grade: { text: `Your pinned ${fam}: a grading board may reveal it`, screen: 'puzzles', params: { puzzle: 'grading' } },
    hunt: { text: `Your pinned ${fam}: send a hunter${region ? ` to the ${region.name}` : ''}`, screen: 'map', params: region ? { region: region.id } : {} },
    commission: { text: `Your pinned ${fam}: it comes from a commission`, screen: 'orders', params: { tab: 'commissions' } },
    accident: { text: `Your pinned ${fam}: keep the mixers busy for a happy accident`, screen: 'workshop', params: { panel: 'mixers' } },
  }[c.foundBy] ?? { text: `Your pinned ${fam} is waiting to be found`, screen: 'catalog', params: {} };
  return { icon: 'pin', text: how.text, screen: how.screen, params: { colorId: id, ...how.params } };
}

/** buildReturnSummary(state, before, now) -> LedgerSummary. */
export function buildReturnSummary(state, before, now = 0) {
  const b = before || snapshot(state);
  const away = Math.max(0, fin(now) - fin(b.at));
  const lines = [];

  // Produced: positive stock change per color (biggest first).
  const produced = [];
  for (const [id, e] of Object.entries(state.stock || {})) {
    const d = fin(e && e.jars) - fin(b.stock[id]);
    if (d >= 0.5) produced.push({ color: id, jars: d });
  }
  produced.sort((x, y) => y.jars - x.jars);
  if (produced.length) {
    const total = produced.reduce((s, p) => s + p.jars, 0);
    const top = produced.slice(0, 2).map((p) => nameOf(state, p.color)).join(' and ');
    lines.push({ icon: 'jar', text: `Made ${plural(Math.round(total), 'jar')} of color, mostly ${top}`, screen: 'workshop' });
  }

  const coinsEarned = Math.max(0, fin(state.lifetime && state.lifetime.earned) - b.earned);
  if (coinsEarned >= 1) lines.push({ icon: 'coin', text: `Earned ${formatNumber(Math.round(coinsEarned))} Coins while you were away`, screen: 'workshop' });

  const shipped = Math.max(0, fin(state.stats && state.stats.shipped) - b.shipped);
  if (shipped >= 1) lines.push({ icon: 'cart', text: `Shipped ${plural(Math.round(shipped), 'jar')} down the road`, screen: 'workshop', params: { panel: 'fleet' } });

  // Hunters home.
  const roster = (state.hunters && state.hunters.roster) || [];
  const huntersHome = [];
  for (const id of b.huntersOut) {
    const h = roster.find((x) => x.id === id);
    if (!h || h.state === 'out') continue;
    const haul = h.lastHaul || {};
    const region = getRegion(haul.region);
    huntersHome.push({ hunterId: id, name: h.name, region: haul.region ?? null, wild: haul.wild ?? null });
    const where = region ? ` from the ${region.name}` : '';
    const extra = haul.wild ? ` with ${nameOf(state, haul.wild)}` : '';
    lines.push({ icon: 'hunter', text: `${h.name} is home${where}${extra}`, screen: 'map', params: { hunterId: id } });
  }

  // Postcards waiting.
  const postcards = Object.keys((state.album && state.album.cards) || {}).filter((id) => !b.albumCards.includes(id));
  if (postcards.length) lines.push({ icon: 'postcard', text: postcards.length === 1 ? 'A new postcard to open' : `${postcards.length} new postcards to open`, screen: 'album', params: { cards: postcards } });

  // Orders posted (new ids on the board).
  const ordersNow = ((state.orders && state.orders.open) || []).map((o) => o && o.id);
  const ordersPosted = ordersNow.filter((id) => id && !b.orderIds.includes(id)).length;
  if (ordersPosted) lines.push({ icon: 'order', text: ordersPosted === 1 ? 'A new order on the board' : `${ordersPosted} new orders on the board`, screen: 'orders' });

  // Vials on the shelf.
  const shelfNow = ((state.shelf && state.shelf.cells) || []).filter(Boolean).length;
  const vials = Math.max(0, shelfNow - b.shelfCount);
  if (vials) lines.push({ icon: 'vial', text: vials === 1 ? 'A vial is waiting on the shelf' : `${vials} vials waiting on the shelf`, screen: 'shelf' });

  // New canvases.
  const canvases = ((state.gallery && state.gallery.canvases) || []).filter((id) => !b.canvases.includes(id));
  for (const id of canvases) {
    const c = canvasDef(id);
    lines.push({ icon: 'canvas', text: `A new canvas to paint: ${c && c.name ? c.name : id}`, screen: 'gallery', params: { canvas: id } });
  }

  // Collector.
  const collector = !!(state.gallery && state.gallery.collectorOffer) && !b.collector;
  if (state.gallery && state.gallery.collectorOffer) lines.push({ icon: 'collector', text: 'A collector would love a print of your work', screen: 'gallery', params: { collector: true } });

  // New colors.
  const newColors = Object.keys((state.catalog && state.catalog.discovered) || {}).filter((id) => !b.discovered.includes(id));
  if (newColors.length) lines.push({ icon: 'swatch', text: newColors.length === 1 ? `${nameOf(state, newColors[0])} joined your catalog` : `${newColors.length} new colors joined your catalog`, screen: 'catalog', params: { colors: newColors } });

  // Things to tap (accidents, muddy batches, quests, event steps).
  const accidents = ((state.stations && state.stations.mixers) || []).filter((m) => m && m.accident).length;
  if (accidents) lines.push({ icon: 'sparkle', text: accidents === 1 ? 'A happy accident is waiting at a mixer' : `${accidents} happy accidents are waiting`, screen: 'workshop', params: { panel: 'mixers' } });
  const muddy = (state.muddyBatches || []).length;
  if (muddy) lines.push({ icon: 'tube', text: muddy === 1 ? 'A batch is ready to purify' : `${muddy} batches are ready to purify`, screen: 'puzzles', params: { puzzle: 'purify' } });
  const qr = questsReady(state);
  if (qr) lines.push({ icon: 'quest', text: qr === 1 ? 'A quest is ready to claim' : `${qr} quests are ready to claim`, screen: 'quests' });
  const steps = claimableSteps(state).length;
  if (steps) lines.push({ icon: 'event', text: steps === 1 ? 'An event reward is ready' : `${steps} event rewards are ready`, screen: 'quests', params: { section: 'event' } });

  // Pinned goals with a suggested next step.
  for (const id of ((state.catalog && state.catalog.pinned) || []).slice(0, 3)) {
    if (state.catalog.discovered && state.catalog.discovered[id]) continue;
    lines.push(pinnedLine(state, id));
  }

  const summary = {
    away,
    awayText: formatDuration(away),
    produced,
    shipped,
    coinsEarned,
    huntersHome,
    postcards,
    ordersPosted,
    vials,
    canvases,
    collector,
    questsReady: qr,
    newColors,
    almostThere: almostThere(state, now),
    lines,
    builtAt: now,
  };
  return summary;
}

// ---------------------------------------------------------------------------
// Almost there
// ---------------------------------------------------------------------------

/**
 * almostThere(state, now) -> 3 to 5 nearly finished things [{icon, text, screen, params, score}]
 * (fewer only when fewer exist). Lower score = closer to done.
 */
export function almostThere(state, now = state.lastTick ?? 0) {
  const items = [];

  // A hunter nearly home.
  for (const h of (state.hunters && state.hunters.roster) || []) {
    if (h.state !== 'out' || !h.trip) continue;
    const total = Math.max(1, h.trip.returnsAt - h.trip.departedAt);
    const left = Math.max(0, h.trip.returnsAt - now) / total;
    const region = getRegion(h.trip.region);
    items.push({ icon: 'hunter', text: `${h.name} is on the way home${region ? ` from the ${region.name}` : ''}`, screen: 'map', params: { hunterId: h.id }, score: left });
  }

  // A commission step nearly done.
  for (const rec of (state.commissions && state.commissions.open) || []) {
    const def = getCommission(rec.id);
    if (!def) continue;
    def.steps.forEach((s, i) => {
      const p = rec.steps[i];
      if (!p || p.done) return;
      const delivered = fin(p.delivered);
      if (delivered <= 0) return;
      const need = Math.max(0, s.jars - delivered);
      const what = s.tier ? `${containerName(s.tier)}` : `${plural(Math.ceil(need), 'jar')}`;
      items.push({ icon: 'commission', text: `${what} more for ${def.name}`, screen: 'orders', params: { commissionId: rec.id, stepIndex: i }, score: need / Math.max(1, s.jars) });
    });
  }

  // A canvas half painted.
  for (const piece of (state.gallery && state.gallery.pieces) || []) {
    if (!piece || piece.signedAt) continue;
    const def = canvasDef(piece.canvas);
    const total = def && Array.isArray(def.regions) ? def.regions.length : 0;
    const painted = Object.keys(piece.regions || {}).length;
    if (!total || painted <= 0 || painted >= total) continue;
    const left = total - painted;
    items.push({ icon: 'canvas', text: `${plural(left, 'region')} to finish ${def.name ?? 'your canvas'}`, screen: 'gallery', params: { pieceId: piece.id }, score: left / total });
  }
  // Every region painted but unsigned: one tap from done.
  for (const piece of (state.gallery && state.gallery.pieces) || []) {
    if (!piece || piece.signedAt) continue;
    const def = canvasDef(piece.canvas);
    const total = def && Array.isArray(def.regions) ? def.regions.length : 0;
    if (total && Object.keys(piece.regions || {}).length >= total) {
      items.push({ icon: 'canvas', text: `${def.name ?? 'A painting'} is ready to sign`, screen: 'gallery', params: { pieceId: piece.id }, score: 0 });
    }
  }

  // A container one merge from the next tier.
  const cells = (state.shelf && state.shelf.cells) || [];
  const seen = new Map();
  for (const c of cells) {
    if (!c || (c.tier ?? 1) >= 5) continue;
    const k = `${c.color}|${c.tier ?? 1}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  let bestPair = null;
  for (const [k, n] of seen) {
    if (n < 2) continue;
    const [color, t] = k.split('|');
    const tier = Number(t);
    if (!bestPair || tier > bestPair.tier) bestPair = { color, tier };
  }
  if (bestPair) {
    items.push({ icon: 'vial', text: `Two ${nameOf(state, bestPair.color)} ${containerName(bestPair.tier).toLowerCase()}s are one merge from a ${containerName(bestPair.tier + 1)}`, screen: 'shelf', params: { color: bestPair.color }, score: 0.1 });
  }

  // A catalog page two cells from complete.
  const pages = new Map();
  for (const c of allColors()) {
    if ((c.era ?? 1) !== (state.era ?? 1) || !c.page) continue;
    const pg = pages.get(c.page) || { total: 0, missing: 0 };
    pg.total++;
    if (!(state.catalog.discovered && state.catalog.discovered[c.id])) pg.missing++;
    pages.set(c.page, pg);
  }
  for (const [page, pg] of pages) {
    if (pg.missing >= 1 && pg.missing <= 2) {
      const label = page.charAt(0).toUpperCase() + page.slice(1);
      items.push({ icon: 'swatch', text: `${pg.missing === 1 ? 'One more color finishes' : 'Two more colors finish'} the ${label} page`, screen: 'catalog', params: { page }, score: pg.missing / Math.max(1, pg.total) });
    }
  }

  // The next room two colors away.
  const colors = discoveredCount(state);
  const rooms = state.rooms || [];
  const nextRoom = ROOMS.find((r) => !rooms.includes(r.id) && r.colorsRequired > colors);
  if (nextRoom && nextRoom.colorsRequired - colors <= 2) {
    const n = nextRoom.colorsRequired - colors;
    items.push({ icon: 'room', text: `${n === 1 ? 'One more color opens' : 'Two more colors open'} the ${nextRoom.name}`, screen: 'catalog', score: n / 10 });
  }

  // An upgrade affordable soon (or now).
  const up = cheapestUpgrade(state);
  if (up && Number.isFinite(up.cost)) {
    const short = up.cost - fin(state.coins);
    const rate = fin(incomeRate(state, now));
    if (short <= 0) {
      items.push({ icon: 'coin', text: `${up.label ?? 'An upgrade'} is ready to buy`, screen: 'workshop', params: { upgrade: up.kind }, score: 0.05 });
    } else if (rate > 0 && short / rate <= 600) {
      items.push({ icon: 'coin', text: `${up.label ?? 'The next upgrade'} is nearly affordable`, screen: 'workshop', params: { upgrade: up.kind }, score: Math.min(1, short / rate / 600) });
    }
  }

  items.sort((x, y) => x.score - y.score);
  // Keep variety: at most two items with the same icon.
  const out = [];
  const perIcon = {};
  for (const it of items) {
    if ((perIcon[it.icon] || 0) >= 2) continue;
    perIcon[it.icon] = (perIcon[it.icon] || 0) + 1;
    out.push(it);
    if (out.length >= 5) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// All caught up
// ---------------------------------------------------------------------------

/** pendingItems(state) — little things still waiting for a tap. */
export function pendingItems(state) {
  const out = [];
  if (state.ledger && state.ledger.pending) out.push('ledger');
  if (questsReady(state)) out.push('quests');
  if (claimableSteps(state).length) out.push('event');
  if (((state.stations && state.stations.mixers) || []).some((m) => m && m.accident)) out.push('accident');
  if ((state.muddyBatches || []).length) out.push('muddy');
  if (state.gallery && state.gallery.collectorOffer) out.push('collector');
  return out;
}

/** isAllCaughtUp(state) — every Ledger item handled. */
export function isAllCaughtUp(state) {
  return pendingItems(state).length === 0;
}

/**
 * markCaughtUp(state, args, now) — dismisses the Ledger; when nothing else is waiting
 * the All caught up stamp lands ('allCaughtUp').
 */
export function markCaughtUp(state, args, now) {
  const t = typeof args === 'number' ? args : fin(now, state.lastTick ?? 0);
  state.ledger ??= { pending: null, allCaughtUpAt: 0 };
  state.ledger.pending = null;
  if (!isAllCaughtUp(state)) return { ok: false, remaining: pendingItems(state) };
  state.ledger.allCaughtUpAt = t;
  emit(state, 'allCaughtUp', {});
  return { ok: true };
}
