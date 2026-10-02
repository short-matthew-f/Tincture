// discovery.js — finding, naming and pinning catalog colors (pure).
// Implements docs/DESIGN.md "Discovery and the catalog": the Mixing bench
// discovers within ΔE 4 of an undiscovered cell, nearby cells shimmer as hints,
// each discovery gets a small ceremony (suggested name), every 10 colors is a
// catalog milestone (+2% income lives in economy.incomeMultiplier) and every 20
// colors unlocks a milestone canvas. Room/region unlock checks are the callers'.

import { CATALOG } from '../content/catalog.js';
import { suggestName, isNameOk } from '../content/names.js';
import { CANVASES } from '../content/canvases.js';
import { PIGMENTS, DROPS } from '../content/pigments.js';
import { SOURCES_BY_ID } from '../content/sources.js';
import { ERAS_BY_ID } from '../content/eras.js';
import { getEvent } from '../content/events.js';
import { deltaEHex, mixPaintHex } from '../color.js';
import { stateRng } from '../rng.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { eventPoints } from './events.js';
import { colorDef, discoveredCount } from './economy.js';

export const DISCOVER_DE = 4;
export const HINT_DE = 12;
export const MAX_PINS = 3;
export const NAME_MAX = 24;

/** Which catalog `foundBy` values each discovery method may reveal. */
const METHOD_FOUND_BY = Object.freeze({
  bench: ['mix'],
  mix: ['mix'],
  order: ['mix'],
  grade: ['grade', 'mix'],
  grading: ['grade', 'mix'],
  accident: ['accident', 'grade', 'mix'],
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export { discoveredCount };

export function isDiscovered(state, colorId) {
  return !!state?.catalog?.discovered?.[colorId];
}

/** Her name for a color (custom or catalog), falling back to the catalog/pigment name. */
export function displayName(state, colorId) {
  const d = state?.catalog?.discovered?.[colorId];
  if (d && d.name) return d.name;
  const c = colorDef(colorId);
  return c?.name ?? String(colorId ?? '');
}

/** [{id, name, hex, tier, essence, custom, at}] in discovery order. */
export function discoveredColors(state) {
  const out = [];
  for (const [id, d] of Object.entries(state?.catalog?.discovered ?? {})) {
    const c = colorDef(id);
    out.push({
      id, name: d.name || c?.name || id, hex: c?.hex ?? '#888888', tier: c?.tier ?? 'primary',
      essence: d.essence ?? 0, custom: !!d.custom, at: d.at ?? 0,
    });
  }
  return out;
}

function eventColorsFor(state) {
  const key = state?.event?.key;
  const ev = key ? getEvent(key) : null;
  if (!ev) return [];
  return ev.catalogPage.map((id) => colorDef(id)).filter((c) => c && c.hex);
}

/** Catalog colors that can still be discovered now: this era's pages + the running event's page. */
export function discoverableColors(state) {
  const era = state?.era ?? 1;
  const pages = ERAS_BY_ID[era]?.pages ?? [];
  const base = CATALOG.filter((c) => (c.era ?? 1) === era && (!c.page || pages.includes(c.page)));
  return [...base, ...eventColorsFor(state)].filter((c) => c && c.hex && !isDiscovered(state, c.id));
}

function allowedBy(method, c) {
  if (!method || !METHOD_FOUND_BY[method]) return true;
  if (c.event || c.foundBy === 'event') return true; // the running event's page
  if (c.tier === 'wild') return false;
  return !c.foundBy || METHOD_FOUND_BY[method].includes(c.foundBy);
}

/**
 * undiscoveredNear(state, hex, maxDE=4, {method}) -> {color, de} for the nearest
 * undiscovered catalog color within maxDE (this era's pages + current event page), or null.
 */
export function undiscoveredNear(state, hex, maxDE = DISCOVER_DE, opts = {}) {
  if (!hex) return null;
  let best = null;
  for (const c of discoverableColors(state)) {
    if (!allowedBy(opts.method, c)) continue;
    let de;
    try { de = deltaEHex(hex, c.hex); } catch { continue; }
    if (de <= maxDE && (!best || de < best.de)) best = { color: c, de };
  }
  return best;
}

/** Up to 3 undiscovered colors within ΔE 12 for the bench shimmer: [{id, hex, de}]. */
export function shimmerHints(state, hex, opts = {}) {
  if (!hex) return [];
  const out = [];
  for (const c of discoverableColors(state)) {
    if (!allowedBy(opts.method ?? 'bench', c)) continue;
    let de;
    try { de = deltaEHex(hex, c.hex); } catch { continue; }
    if (de <= HINT_DE) out.push({ id: c.id, hex: c.hex, de });
  }
  out.sort((a, b) => a.de - b.de);
  return out.slice(0, 3);
}

/** ARCHITECTURE.md alias. */
export const nearbyUndiscovered = shimmerHints;

// ---------------------------------------------------------------------------
// Discovering
// ---------------------------------------------------------------------------

function takenNames(state) {
  return Object.values(state?.catalog?.discovered ?? {}).map((d) => String(d.name ?? '').toLowerCase());
}

function milestoneCanvases() {
  return CANVASES.filter((c) => c && c.unlock && (c.unlock.type === 'milestone' || c.unlock.type === 'catalog'));
}

function milestoneColorsOf(c) {
  const u = c.unlock ?? {};
  return Number(u.colors ?? u.n ?? u.count ?? u.at ?? 0) || 0;
}

/**
 * discover(state, {colorId, method}, now) -> {colorId, hex, name, suggestedName,
 * milestone, canvas} or null if unknown/already found. Adds the color with its
 * catalog name, emits 'discover' (+ 'milestone' every 10, a canvas every 20).
 */
export function discover(state, args = {}, now = 0) {
  const { colorId, method = 'bench' } = args;
  const c = colorDef(colorId);
  if (!c || isDiscovered(state, colorId)) return null;
  if (!state.catalog) state.catalog = { discovered: {}, pinned: [] };
  state.catalog.discovered[colorId] = { at: now, name: c.name ?? colorId, custom: false, essence: 0 };
  if (!state.lifetime) state.lifetime = { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 };
  state.lifetime.discoveries = (state.lifetime.discoveries ?? 0) + 1;
  state.catalog.pinned = (state.catalog.pinned ?? []).filter((id) => id !== colorId);

  let suggestedName = c.name ?? colorId;
  try {
    const taken = takenNames(state).filter((n) => n !== String(c.name ?? '').toLowerCase());
    suggestedName = suggestName(c.hex, stateRng(state), { taken }) || suggestedName;
  } catch { /* names module optional shape */ }

  const count = discoveredCount(state);
  let milestone = null;
  if (count % 10 === 0) {
    milestone = { kind: 'catalog', level: count / 10, colors: count };
    emit(state, 'milestone', { kind: 'catalog', level: count / 10, colors: count });
  }
  let canvas = null;
  if (count % 20 === 0 && state.gallery) {
    const have = new Set(state.gallery.canvases ?? []);
    const list = milestoneCanvases();
    const exact = list.find((x) => milestoneColorsOf(x) === count && !have.has(x.id));
    const next = exact ?? list
      .filter((x) => !have.has(x.id) && milestoneColorsOf(x) <= count)
      .sort((a, b) => milestoneColorsOf(a) - milestoneColorsOf(b))[0];
    if (next) {
      state.gallery.canvases = [...(state.gallery.canvases ?? []), next.id];
      canvas = next.id;
    }
  }
  emit(state, 'discover', { colorId, hex: c.hex, method, suggestedName, name: c.name });
  questEvent(state, 'colorDiscovered', 1, { colorId, method, hex: c.hex });
  return { colorId, hex: c.hex, name: c.name, suggestedName, milestone, canvas };
}

/** tryDiscover(state, {hex, method, maxDE}, now) -> discover() result or null. */
export function tryDiscover(state, args = {}, now = 0) {
  const { hex, method = 'bench', maxDE = DISCOVER_DE } = args;
  const near = undiscoveredNear(state, hex, maxDE, { method });
  if (!near) return null;
  return discover(state, { colorId: near.color.id, method }, now);
}

// ---------------------------------------------------------------------------
// Naming and pins
// ---------------------------------------------------------------------------

function nameCheck(name) {
  try {
    const r = isNameOk(name);
    if (r && typeof r === 'object') return { ok: !!r.ok, reason: r.reason ?? null };
    return { ok: !!r, reason: r ? null : 'invalid' };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** nameColor(state, {colorId, name}) -> {ok, name?, reason?}. Names are unique (case-insensitive). */
export function nameColor(state, args = {}) {
  const { colorId } = args;
  const d = state?.catalog?.discovered?.[colorId];
  if (!d) return { ok: false, reason: 'unknown' };
  const name = String(args.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > NAME_MAX) return { ok: false, reason: name ? 'long' : 'empty' };
  const chk = nameCheck(name);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'invalid' };
  const lower = name.toLowerCase();
  for (const [id, other] of Object.entries(state.catalog.discovered)) {
    if (id !== colorId && String(other.name ?? '').toLowerCase() === lower) return { ok: false, reason: 'taken' };
  }
  const wasCustom = !!d.custom;
  d.name = name;
  d.custom = true;
  if (!wasCustom) questEvent(state, 'colorNamed', 1, { colorId, name });
  return { ok: true, name };
}

export function pinColor(state, args = {}) {
  const id = typeof args === 'string' ? args : args.colorId;
  if (!state.catalog.pinned) state.catalog.pinned = [];
  const pins = state.catalog.pinned;
  if (!id || isDiscovered(state, id) || !colorDef(id)) return { ok: false, reason: 'invalid' };
  if (pins.includes(id)) return { ok: true, pinned: pins.slice() };
  if (pins.length >= MAX_PINS) return { ok: false, reason: 'full' };
  pins.push(id);
  return { ok: true, pinned: pins.slice() };
}

export function unpinColor(state, args = {}) {
  const id = typeof args === 'string' ? args : args.colorId;
  state.catalog.pinned = (state.catalog.pinned ?? []).filter((x) => x !== id);
  return { ok: true, pinned: state.catalog.pinned.slice() };
}

// ---------------------------------------------------------------------------
// Mixing bench
// ---------------------------------------------------------------------------

/** Pigments she owns (a built source) plus the free white/black drops: [{id, name, hex}]. */
export function availablePigments(state) {
  const owned = new Set();
  for (const [id, s] of Object.entries(state?.stations?.sources ?? {})) {
    if ((s?.level ?? 0) > 0) owned.add(SOURCES_BY_ID[id]?.pigment ?? id);
  }
  for (const id of ['madder', 'ochre', 'woad']) owned.add(id);
  const out = PIGMENTS.filter((p) => owned.has(p.id)).map((p) => ({ id: p.id, name: p.name, hex: p.hex }));
  for (const d of DROPS) out.push({ id: d.id, name: d.name, hex: d.hex });
  return out;
}

/**
 * mixAtBench(state, {parts:[{id, hex, weight}]}, now) -> {hex, discovered, hints}.
 * A free experiment: within ΔE 4 of an undiscovered mixable cell, it's found.
 */
export function mixAtBench(state, args = {}, now = 0) {
  const parts = (args.parts ?? []).filter((p) => p && p.hex && Number.isFinite(p.weight) && p.weight > 0);
  if (!parts.length) return { hex: null, discovered: null, hints: [] };
  let hex;
  try { hex = mixPaintHex(parts.map((p) => ({ hex: p.hex, weight: p.weight }))); } catch { return { hex: null, discovered: null, hints: [] }; }
  const discovered = tryDiscover(state, { hex, method: 'bench' }, now);
  if (discovered) eventPoints(state, 'discover', 1, { colorId: discovered.colorId });
  return { hex, discovered, hints: shimmerHints(state, hex) };
}
