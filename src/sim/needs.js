// needs.js — what her open goals ask for, and what she can really find (pure).
//
// Playtest (Candace): "I can't make the colors the quests ask for, and when I try
// to make new ones the orders never line up with what I need." Two causes:
//   1. The weekly "Discover 5 new blues" counted colors she can never find by
//      herself (a commission's signature color, a past event's limited color, a
//      pigment no open region sells), so it was dealt when only one blue was left.
//   2. Nothing steered orders or grading boards toward the families her quest,
//      commission or event wanted, so finding the last few blues was pure luck.
// This module is the one honest answer both use: `findableInFamily` (colors she
// can find with what is open now, the same test commissions use) and
// `wantedColors` (the undiscovered colors her open goals point at, that an order
// or a grading board can actually reveal).

import { discoverableColors, isDiscovered } from './discovery.js';
import { familyOfColor } from './hunters.js';
import { howToFind, stepGuide } from './commissions.js';
import { getEvent } from '../content/events.js';
import { colorDef } from './economy.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

/**
 * findableInFamily(state, family) -> [{id, how}] undiscovered colors of that hue
 * family she can find from where she is now (bench, grading board, a pigment a
 * hunter can bring from an open region, a wild hue of an open region). Commission
 * signature colors and limited event colors are left out: they come from finishing
 * that commission or event, not from looking for them.
 */
export function findableInFamily(state, family) {
  const out = [];
  let list = [];
  try { list = discoverableColors(state); } catch { list = []; }
  for (const c of list) {
    if (!c || familyOfColor(c.id) !== family) continue;
    let f = null;
    try { f = howToFind(state, c.id); } catch { f = null; }
    if (f) out.push({ id: c.id, how: f.how });
  }
  return out;
}

/** Families the running weekly quest still wants new colors of: {family: colors still to find}. */
export function weeklyFamilyNeeds(state) {
  const out = {};
  const w = state?.quests?.weekly;
  if (!w || w.done || !Array.isArray(w.steps)) return out;
  for (const s of w.steps) {
    if (!s || s.done || s.event !== 'colorDiscovered' || !s.family) continue;
    const left = Math.max(0, fin(s.n) - fin(s.progress));
    if (left > 0) out[s.family] = Math.max(out[s.family] ?? 0, left);
  }
  return out;
}

/** The running event's color families ([] when none). */
export function eventFamilies(state) {
  const ev = state?.event?.key ? getEvent(state.event.key) : null;
  return ev && Array.isArray(ev.palette) ? ev.palette.slice() : [];
}

/**
 * wantedColors(state, {via}) -> [color ids] undiscovered colors her open goals point
 * at that `via` can reveal: 'order' (matching an order: mixed colors whose pigments
 * she has) or 'grade' (a solved grading board: graded or mixed colors whose pigments
 * she has). Weekly family steps first, then open commission steps.
 */
export function wantedColors(state, { via = 'order' } = {}) {
  const hows = via === 'grade' ? ['bench', 'grade'] : ['bench'];
  const foundBy = via === 'grade' ? ['mix', 'grade'] : ['mix'];
  const out = [];
  const add = (id, how) => {
    if (!id || out.includes(id) || isDiscovered(state, id) || !hows.includes(how)) return;
    const c = colorDef(id);
    if (!c || !foundBy.includes(c.foundBy)) return;
    out.push(id);
  };
  for (const fam of Object.keys(weeklyFamilyNeeds(state))) {
    for (const f of findableInFamily(state, fam)) add(f.id, f.how);
  }
  for (const rec of state?.commissions?.open ?? []) {
    if (!rec || !Array.isArray(rec.steps)) continue;
    rec.steps.forEach((p, i) => {
      if (p && p.done) return;
      let g = null;
      try { g = stepGuide(state, rec.id, i, rec); } catch { g = null; }
      if (!g || g.done || g.kind !== 'stock') return;
      // Only when she has nothing of her own to deliver or make for it.
      if (g.action && g.action.kind !== 'find') return;
      for (const f of g.findable) add(f.id, f.how);
    });
  }
  return out;
}

/**
 * steerTints(state, tints, rng) -> tints. A solved grading board reveals in-between
 * tints; while a goal needs a color a board can reveal, the first tint becomes one
 * of those colors, so solving boards reliably moves "Discover 5 new blues" along.
 */
export function steerTints(state, tints = [], rng = null) {
  if (!Array.isArray(tints) || !tints.length) return tints;
  const wanted = wantedColors(state, { via: 'grade' });
  if (!wanted.length) return tints;
  const r = typeof rng === 'function' ? fin(rng(), 0) : 0;
  const id = wanted[Math.floor(r * wanted.length) % wanted.length];
  const hex = colorDef(id)?.hex;
  if (!hex) return tints;
  return [hex, ...tints.slice(1)];
}
