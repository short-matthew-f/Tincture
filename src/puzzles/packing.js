// packing.js — crate sort before a shipment (pure, JSON-serializable state).
// Implements docs/DESIGN.md "Active play › Packing (crate sort)" and
// "Storage and shipping › Packing (sorting tie-in)": jars arrive on a conveyor
// in mixed order, she drops each into a route crate (crates show the route's
// palette of hue families). A clean crate ships at +25%; missorts are neutral
// and just ship at base value. The lantern-stringing event twist is the same
// mechanic with a flag for the UI.

import { hueFamily } from '../color.js';
import { shuffle } from '../rng.js';

export const CLEAN_BONUS = 0.25;

function resolveRng(opts, rng) {
  const r = typeof rng === 'function' ? rng : opts && opts.rng;
  if (typeof r !== 'function') throw new TypeError('packing: an rng function is required');
  return r;
}

/** True when a route crate welcomes a jar of this hue family. */
export function accepts(route, family) {
  if (!route) return false;
  if (route.any || !route.palette || route.palette.length === 0) return true;
  return route.palette.includes(family);
}

/**
 * create({routes:[{id, name, palette:[family], any?, capacity?}],
 *         jars:[{color, hex, family?}], rng, twist?:'lanterns'}, rng?) -> puzzle
 * {routes, conveyor:[jar], crates:{routeId:[jar]}, index:0, missorts:0, done:false}
 * Only plain copies of routes and jars are stored (save-safe).
 */
export function create(opts, rngArg) {
  const rng = resolveRng(opts, rngArg);
  const routes = ((opts && opts.routes) || []).map((r) => ({
    id: r.id,
    name: r.name || r.id,
    palette: Array.isArray(r.palette) ? r.palette.slice() : [],
    any: !!r.any,
    ...(Number.isFinite(r.capacity) ? { capacity: r.capacity } : {}),
  }));
  if (!routes.length) throw new RangeError('packing.create: need at least one route');
  const jars = ((opts && opts.jars) || []).map((j) => ({
    color: j.color,
    hex: j.hex,
    family: j.family || (j.hex ? hueFamily(j.hex) : 'neutral'),
  }));
  const crates = {};
  for (const r of routes) crates[r.id] = [];
  const p = { routes, conveyor: shuffle(rng, jars), crates, index: 0, missorts: 0, done: jars.length === 0 };
  if (opts && opts.twist) p.twist = opts.twist;
  return p;
}

/** The jar waiting at the front of the conveyor (null when done). */
export function currentJar(p) {
  return p.done ? null : p.conveyor[p.index] || null;
}

/** Drop the current jar into a route's crate. Missorts are fine, just not clean. */
export function drop(p, routeId) {
  const route = p.routes.find((r) => r.id === routeId);
  if (p.done || !route) return { ok: false, clean: false, done: p.done };
  const jar = p.conveyor[p.index];
  const clean = accepts(route, jar.family);
  if (!clean) p.missorts += 1;
  p.crates[routeId].push(jar);
  p.index += 1;
  p.done = p.index >= p.conveyor.length;
  const out = { ok: true, clean, done: p.done };
  if (Number.isFinite(route.capacity)) out.crateFull = p.crates[routeId].length >= route.capacity;
  return out;
}

/** ARCHITECTURE.md shape: apply(p, {routeId}). */
export function apply(p, move) {
  const r = drop(p, move && move.routeId);
  const events = r.ok ? [r.clean ? 'clean' : 'missort', ...(r.done ? ['done'] : [])] : ['refused'];
  return { ...r, events };
}

/** The whole run is solved once every jar is packed. */
export function isSolved(p) {
  return p.done;
}

/**
 * result(p) -> {clean, bonus, missorts, cleanCrates, perCrate:{routeId:{count, clean, bonus}}}
 * `clean`/`bonus` describe the whole shipment (no missorts -> +25%); per-crate
 * values let the shipper pay +25% on each clean crate even if another missed.
 */
export function result(p) {
  const perCrate = {};
  let cleanCrates = 0;
  for (const r of p.routes) {
    const jars = p.crates[r.id] || [];
    const clean = jars.every((j) => accepts(r, j.family));
    const bonus = clean && jars.length > 0 ? CLEAN_BONUS : 0;
    if (bonus) cleanCrates++;
    perCrate[r.id] = { count: jars.length, clean, bonus };
  }
  const clean = p.missorts === 0;
  return { clean, bonus: clean ? CLEAN_BONUS : 0, missorts: p.missorts, cleanCrates, perCrate };
}
