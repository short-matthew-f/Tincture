// sim/events.js — the weekly event: 8-week rotation keyed by ISO week, event points
// from themed activity, the 10-step track and its rewards, and the rerun rule
// (progress is saved per event id in state.eventProgress, so a missed week comes back).
// Spec: DESIGN.md "Quests and weekly events" > "Weekly events"; "Economy" (Seals).
//
// eventPoints(state, kind, amount = 1, meta = {}) is the cross-module hook: orders,
// boards, crates, purifies and paint call it. Activity counts when it is themed:
// meta.event === true (boards/orders built from the event palette), or meta.family /
// meta.colorId falls in the event's palette families.

import { eventForWeek, getEvent, trackStepsReached, POINTS_PER } from '../content/events.js';
import { eraPreviewColors } from '../content/eras.js';
import { hueFamily } from '../color.js';
import { EVENT_REGION_IDS } from '../content/regions.js';
import { getSource } from '../content/sources.js';
import { isoWeekKey } from '../format.js';
import { stateRng, pick } from '../rng.js';
import { emit } from './bus.js';
import { discover } from './discovery.js';
import { addVial, chipFor } from './shelf.js';
import { familyOfColor, colorInfo, eventColors, allColors } from './hunters.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

function saveProgress(state) {
  const e = state.event;
  if (!e || !e.key) return;
  if (!state.eventProgress || typeof state.eventProgress !== 'object') state.eventProgress = {};
  state.eventProgress[e.key] = { points: fin(e.points), claimed: [...(e.claimed || [])] };
}

/**
 * currentEvent(state, now) — makes state.event match this ISO week's event, restoring
 * saved progress for reruns and opening the event region for the week. Returns state.event.
 */
export function currentEvent(state, now = 0) {
  const wk = isoWeekKey(now);
  if (state.event && state.event.weekKey === wk && state.event.key) return state.event;
  saveProgress(state);
  const ev = eventForWeek(wk);
  const saved = (state.eventProgress && state.eventProgress[ev.id]) || { points: 0, claimed: [] };
  state.event = {
    key: ev.id,
    weekKey: wk,
    points: fin(saved.points),
    claimed: Array.isArray(saved.claimed) ? [...saved.claimed] : [],
    region: ev.region,
  };
  saveProgress(state);
  // Open this week's event region on the map (and close last week's).
  if (state.hunters && Array.isArray(state.hunters.regionsUnlocked)) {
    const h = state.hunters;
    h.regionsUnlocked = h.regionsUnlocked.filter((id) => !EVENT_REGION_IDS.includes(id) || id === ev.region);
    const anyHunters = Array.isArray(h.roster) && h.roster.length > 0;
    if (anyHunters && !h.regionsUnlocked.includes(ev.region)) h.regionsUnlocked.push(ev.region);
  }
  applySourceTwist(state, ev);
  emit(state, 'eventStarted', { event: ev.id });
  return state.event;
}

/**
 * Twist `sourceUnlock` (Deep Sea: "Murex Cove opens for the week"): lends the
 * source station for the event's week, marked `eventLoan`. At the next week
 * change a loaned station goes back unless a hunter has since opened it for
 * good (hunters.js drops the mark then).
 */
function applySourceTwist(state, ev) {
  const st = state.stations && state.stations.sources;
  if (!st) return;
  for (const [id, v] of Object.entries(st)) if (v && v.eventLoan && v.eventLoan !== ev.id) delete st[id];
  const sid = ev.twist && ev.twist.rules && ev.twist.rules.sourceUnlock;
  if (!sid || !getSource(sid) || st[sid]) return;
  st[sid] = { level: 1, eventLoan: ev.id };
  if (state.raw && state.raw[sid] === undefined) state.raw[sid] = 0;
  if (state.pigment && state.pigment[sid] === undefined) state.pigment[sid] = 0;
  emit(state, 'sourceUnlocked', { sourceId: sid, event: ev.id });
}

function activeEventDef(state) {
  return state.event && state.event.key ? getEvent(state.event.key) : null;
}

function hexFamily(hex) {
  try { return hueFamily(hex); } catch { return null; }
}

/**
 * Is an activity with this meta themed for the running event? meta.event (true or
 * the event id), meta.family, meta.colorId (an event-page color, or one in the
 * event's families), meta.colors (any of them), meta.hex / meta.hexes (an order's
 * target: its hue family). Under Festival of Lanterns (rules.packingLanterns) a
 * packed shipment (kind 'crate', meta.packed) counts whatever its colors.
 */
export function isThemed(state, meta = {}, kind = null) {
  const ev = activeEventDef(state);
  if (!ev || !meta) return false;
  if (meta.event === true || meta.event === ev.id) return true;
  if (kind === 'crate' && meta.packed && ev.twist.rules.packingLanterns) return true;
  if (meta.family && ev.palette.includes(meta.family)) return true;
  if (meta.colorId) {
    if (typeof meta.colorId === 'string' && meta.colorId.startsWith(ev.id + '-')) return true;
    if (ev.palette.includes(familyOfColor(meta.colorId))) return true;
  }
  if (Array.isArray(meta.colors) && meta.colors.some((c) => (typeof c === 'string' && c.startsWith(ev.id + '-')) || ev.palette.includes(familyOfColor(c)))) return true;
  const hexes = [meta.hex, ...(Array.isArray(meta.hexes) ? meta.hexes : [])].filter((x) => typeof x === 'string');
  return hexes.some((hx) => ev.palette.includes(hexFamily(hx)));
}

/**
 * eventPoints(state, kind, amount = 1, meta = {}) — adds POINTS_PER[kind] x amount for
 * themed activity; emits 'eventStep' {step} for each newly reached track step. Returns
 * the points added.
 */
export function eventPoints(state, kind, amount = 1, meta = {}) {
  const ev = activeEventDef(state);
  if (!ev) return 0;
  const per = POINTS_PER[kind];
  const pts = fin(per) * fin(Number(amount));
  if (!(pts > 0) || !isThemed(state, meta || {}, kind)) return 0;
  const before = trackStepsReached(ev, fin(state.event.points));
  state.event.points = fin(state.event.points) + pts;
  const after = trackStepsReached(ev, state.event.points);
  for (let s = before + 1; s <= after; s++) emit(state, 'eventStep', { step: s });
  saveProgress(state);
  return pts;
}

/** Steps reached but not yet claimed. */
export function claimableSteps(state) {
  const ev = activeEventDef(state);
  if (!ev) return [];
  const reached = trackStepsReached(ev, fin(state.event.points));
  const out = [];
  for (let s = 1; s <= reached; s++) if (!state.event.claimed.includes(s)) out.push(s);
  return out;
}

/** claimStep(state, {step}, now) — grants that track step's reward. */
export function claimStep(state, { step } = {}, now = 0) {
  const ev = activeEventDef(state);
  if (!ev) return { ok: false, reason: 'no-event' };
  const s = ev.track.find((x) => x.step === step);
  if (!s) return { ok: false, reason: 'unknown' };
  if (fin(state.event.points) < s.points) return { ok: false, reason: 'not-reached' };
  if (state.event.claimed.includes(step)) return { ok: false, reason: 'claimed' };
  const r = s.reward;
  const granted = { step };
  if (r.seals) {
    state.seals = fin(state.seals) + r.seals;
    granted.seals = r.seals;
  }
  if (r.colorId) {
    if (colorInfo(r.colorId) && !(state.catalog.discovered && state.catalog.discovered[r.colorId])) {
      discover(state, { colorId: r.colorId, method: 'event' }, now);
    }
    granted.colorId = r.colorId;
  }
  if (r.canvas) {
    if (!state.gallery) state.gallery = { canvases: [] };
    if (!Array.isArray(state.gallery.canvases)) state.gallery.canvases = [];
    if (!state.gallery.canvases.includes(r.canvas)) state.gallery.canvases.push(r.canvas);
    granted.canvas = r.canvas;
  }
  if (r.vial) {
    const rng = stateRng(state);
    const known = Object.keys(state.catalog.discovered || {});
    let colors = ev.vialColors.filter((id) => known.includes(id));
    if (!colors.length) colors = known.filter((id) => ev.palette.includes(familyOfColor(id)));
    if (!colors.length) colors = known;
    granted.vials = [];
    for (let i = 0; i < r.vial && colors.length; i++) {
      const colorId = chipFor(state, pick(rng, colors));
      if (!colorId) break;
      const res = addVial(state, { colorId, tier: 1, golden: false });
      if (res !== false && res !== null && !(res && res.ok === false)) granted.vials.push(colorId);
    }
  }
  if (r.cosmetic) {
    state.cosmetics ??= [];
    if (!state.cosmetics.includes(r.cosmetic)) state.cosmetics.push(r.cosmetic);
    granted.cosmetic = r.cosmetic;
  }
  state.event.claimed.push(step);
  saveProgress(state);
  return { ok: true, ...granted };
}

/**
 * eventPalette(state) -> hexes for event boards/orders: the event's limited catalog page
 * (EVENT_COLORS); falls back to Era catalog colors in the event's families.
 */
export function eventPalette(state) {
  const ev = activeEventDef(state);
  if (!ev) return [];
  let hexes = eventColors(ev.id).map((c) => c.hex).filter(Boolean);
  if (!hexes.length) hexes = ev.catalogPage.map((id) => colorInfo(id)).filter(Boolean).map((c) => c.hex);
  if (!hexes.length) hexes = allColors().filter((c) => c.hex && ev.palette.includes(familyOfColor(c.id))).map((c) => c.hex);
  // Neon Night's sneak peek: the Era 2 preview colors join this week's boards.
  if (ev.twist.rules.previewEra) hexes = hexes.concat(eraPreviewColors(ev.twist.rules.previewEra).map((c) => c.hex));
  return hexes;
}

/**
 * eraPreview(state) -> the running event's Era preview colors ([{id, name, hex, era, note}]),
 * empty unless its twist has rules.previewEra. Previews are shown, never discovered.
 */
export function eraPreview(state) {
  const ev = activeEventDef(state);
  const era = ev && ev.twist.rules.previewEra;
  return era ? eraPreviewColors(era) : [];
}

/** Is a twist rule on for the running event? (e.g. twistOn(state, 'bouquetOrders')) */
export function twistOn(state, rule) {
  const ev = activeEventDef(state);
  return !!(ev && ev.twist.rules[rule]);
}

/** eventTwist(state) -> {id, text, rules} for the running event, or null. */
export function eventTwist(state) {
  const ev = activeEventDef(state);
  return ev ? { id: ev.id, text: ev.twist.text, rules: ev.twist.rules } : null;
}

/** Track view: [{step, points, reward, reached, claimed}]. */
export function eventTrack(state) {
  const ev = activeEventDef(state);
  if (!ev) return [];
  const pts = fin(state.event.points);
  return ev.track.map((s) => ({ step: s.step, points: s.points, reward: s.reward, reached: pts >= s.points, claimed: state.event.claimed.includes(s.step) }));
}
