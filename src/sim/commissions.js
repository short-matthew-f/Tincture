// sim/commissions.js — multi-step commissions: two to three open at once, never
// expiring; steps filled by delivering stock (or a merged shelf container); rewards
// are a big Coin payout, a signature catalog color and a workshop trophy. Also the
// era capstone and Era Advance (Era 2 is not playable yet: "coming in a later update").
// Spec: DESIGN.md "Progression, eras and prestige" > "Commissions", "Era Advance".
//
// State: state.commissions = {open:[{id, started, steps:[{delivered, colors:{id:jars}, done}]}], done:[id]}
// Step requirements are read from content by commission id (never copied into the save).

import { availableCommissions, getCommission, OPEN_COMMISSIONS } from '../content/commissions.js';
import { getEra, capstoneColorsRequired } from '../content/eras.js';
import { emit } from './bus.js';
import { questEvent } from './quests.js';
import { discover, discoveredCount } from './discovery.js';
import { takeStock, stockOf } from './storage.js';
import { incomeRate, cheapestUpgrade } from './economy.js';
import { earn } from './factory.js';
import { familyOfColor, colorInfo } from './hunters.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

function ensure(state) {
  if (!state.commissions || typeof state.commissions !== 'object') state.commissions = { open: [], done: [] };
  if (!Array.isArray(state.commissions.open)) state.commissions.open = [];
  if (!Array.isArray(state.commissions.done)) state.commissions.done = [];
  return state.commissions;
}

function newRecord(def, now) {
  return { id: def.id, started: now, steps: def.steps.map(() => ({ delivered: 0, colors: {}, done: false })) };
}

/** The current era's capstone commission definition (or null). */
export function capstoneDef(state) {
  const era = getEra(state.era ?? 1);
  return era ? getCommission(era.capstoneCommission) : null;
}

/** Commissions are a coin-bought unlock (Phase 3, src/sim/unlocks.js). */
export function commissionsOpen(state) {
  return (state?.phase ?? 1) >= 3 && !!state?.unlocks?.commissions;
}

/**
 * refresh(state, now) — keeps up to three commissions open (once bought in Phase 3, by catalog
 * size), adding the era capstone on top when ~80% of the catalog is found.
 * Returns the ids added.
 */
export function refresh(state, now = 0) {
  const c = ensure(state);
  // drop records whose content vanished between versions
  c.open = c.open.filter((x) => x && getCommission(x.id));
  const added = [];
  if (!commissionsOpen(state)) return added;
  const colors = discoveredCount(state);
  const taken = new Set([...c.open.map((x) => x.id), ...c.done]);
  const pool = availableCommissions({ era: state.era ?? 1, phase: state.phase ?? 3, colors })
    .filter((d) => !taken.has(d.id))
    .sort((a, b) => a.colorsRequired - b.colorsRequired);
  const regular = () => c.open.filter((x) => !getCommission(x.id).capstone).length;
  while (regular() < OPEN_COMMISSIONS.max && pool.length) {
    const def = pool.shift();
    c.open.push(newRecord(def, now));
    added.push(def.id);
  }
  const cap = capstoneDef(state);
  if (cap && !cap.comingSoon && !taken.has(cap.id) && colors >= Math.max(cap.colorsRequired, capstoneColorsRequired(state.era ?? 1))) {
    c.open.push(newRecord(cap, now));
    added.push(cap.id);
  }
  for (const id of added) emit(state, 'commissionOffered', { id });
  return added;
}

/** Does a color satisfy a step's color rule (ignores purity/tier)? */
export function stepAccepts(stepDef, colorId) {
  if (!colorId) return false;
  if (stepDef.colorId) return colorId === stepDef.colorId;
  if (stepDef.pigment) return colorId === stepDef.pigment;
  const fam = familyOfColor(colorId);
  if (stepDef.family) return fam === stepDef.family;
  if (stepDef.families) return stepDef.families.includes(fam);
  return false;
}

function distinctCount(prog) {
  return Object.keys(prog.colors || {}).filter((k) => prog.colors[k] > 0).length;
}

function stepComplete(def, prog) {
  return fin(prog.delivered) >= def.jars - 1e-9 && distinctCount(prog) >= (def.distinct ?? 1);
}

/** How many more jars this step will accept of `colorId` (keeps room for the distinct rule). */
export function stepRoom(def, prog, colorId) {
  const remaining = Math.max(0, def.jars - fin(prog.delivered));
  const has = prog.colors[colorId] > 0;
  const distinctAfter = distinctCount(prog) + (has ? 0 : 1);
  const missing = Math.max(0, (def.distinct ?? 1) - distinctAfter);
  return Math.max(0, remaining - missing);
}

/**
 * deliver(state, {commissionId, stepIndex, colorId, jars}, now) — hands stock to a step.
 * Purity steps take only pure-or-better jars. Container (tier) steps consume one
 * merged shelf container of that tier or higher. Completes the commission when every
 * step is done. Returns {ok, delivered, stepDone, completed}.
 */
export function deliver(state, { commissionId, stepIndex, colorId, jars } = {}, now = 0) {
  const c = ensure(state);
  const rec = c.open.find((x) => x.id === commissionId);
  if (!rec) return { ok: false, reason: 'unknown' };
  const def = getCommission(commissionId);
  const sDef = def && def.steps[stepIndex];
  const prog = rec.steps[stepIndex];
  if (!sDef || !prog) return { ok: false, reason: 'step' };
  if (prog.done) return { ok: false, reason: 'done' };

  let delivered = 0;
  if (sDef.tier) {
    const cells = (state.shelf && state.shelf.cells) || [];
    const idx = cells.findIndex((cell) => cell && (cell.tier ?? 1) >= sDef.tier
      && (colorId ? cell.color === colorId : true) && stepAccepts(sDef, cell.color));
    if (idx < 0) return { ok: false, reason: 'no-container' };
    const used = cells[idx].color;
    cells[idx] = null;
    delivered = 1;
    prog.colors[used] = fin(prog.colors[used]) + 1;
  } else {
    if (!stepAccepts(sDef, colorId)) return { ok: false, reason: 'wrong-color' };
    const room = stepRoom(sDef, prog, colorId);
    const want = Math.min(room, Number.isFinite(jars) && jars > 0 ? jars : room);
    if (!(want > 0)) return { ok: false, reason: 'need-variety' };
    const opts = sDef.purity ? { minPurity: sDef.purity, prefer: 'low' } : { prefer: 'low' };
    const r = takeStock(state, colorId, want, opts);
    delivered = fin(r && r.taken);
    if (!(delivered > 0)) return { ok: false, reason: 'no-stock' };
    prog.colors[colorId] = fin(prog.colors[colorId]) + delivered;
  }
  prog.delivered = fin(prog.delivered) + delivered;
  if (stepComplete(sDef, prog)) prog.done = true;
  let completed = null;
  if (rec.steps.every((s) => s.done)) completed = complete(state, { commissionId }, now);
  return { ok: true, delivered, stepDone: prog.done, completed };
}

/** Coins a commission pays: incomeMinutes of idle income, never less than the cheapest upgrade. */
export function commissionPay(state, commissionId) {
  const def = getCommission(commissionId);
  if (!def) return 0;
  const byIncome = fin(def.reward.incomeMinutes) * fin(incomeRate(state)) * 60;
  const floor = fin(cheapestUpgrade(state) && cheapestUpgrade(state).cost);
  return Math.max(byIncome, floor);
}

/** complete(state, {commissionId}, now) — pays out once every step is done. */
export function complete(state, { commissionId } = {}, now = 0) {
  const c = ensure(state);
  const i = c.open.findIndex((x) => x.id === commissionId);
  if (i < 0) return { ok: false, reason: 'unknown' };
  const rec = c.open[i];
  if (!rec.steps.every((s) => s.done)) return { ok: false, reason: 'not-done' };
  const def = getCommission(commissionId);
  const coins = commissionPay(state, commissionId);
  earn(state, coins);
  let signature = null;
  const sig = def.reward.signatureColor;
  if (sig && colorInfo(sig) && !(state.catalog.discovered && state.catalog.discovered[sig])) {
    discover(state, { colorId: sig, method: 'commission' }, now);
    signature = sig;
  }
  state.trophies ??= [];
  if (def.reward.trophy && !state.trophies.includes(def.reward.trophy)) state.trophies.push(def.reward.trophy);
  c.open.splice(i, 1);
  if (!c.done.includes(commissionId)) c.done.push(commissionId);
  questEvent(state, 'commissionDone', 1, { commission: commissionId });
  emit(state, 'commissionDone', { id: commissionId });
  if (def.capstone) emit(state, 'capstoneDone', { id: commissionId });
  return { ok: true, id: commissionId, coins, signatureColor: signature, trophy: def.reward.trophy };
}

/** Progress view of an open commission: [{def step, delivered, distinct, done, need}] */
export function commissionProgress(state, commissionId) {
  const rec = ensure(state).open.find((x) => x.id === commissionId);
  const def = getCommission(commissionId);
  if (!rec || !def) return null;
  return def.steps.map((s, i) => {
    const p = rec.steps[i] || { delivered: 0, colors: {}, done: false };
    return { ...s, delivered: fin(p.delivered), distinctDone: distinctCount(p), done: !!p.done, need: Math.max(0, s.jars - fin(p.delivered)) };
  });
}

/** Colors in stock that a step would accept (for the delivery picker). */
export function eligibleStock(state, commissionId, stepIndex) {
  const def = getCommission(commissionId);
  const sDef = def && def.steps[stepIndex];
  if (!sDef) return [];
  return Object.keys(state.stock || {}).filter((id) => stepAccepts(sDef, id) && stockOf(state, id) > 0);
}

/** capstoneReady(state) — has this era's capstone commission been completed? */
export function capstoneReady(state) {
  const cap = capstoneDef(state);
  return !!cap && ensure(state).done.includes(cap.id);
}

/**
 * eraAdvance(state) — Era 2 is not playable in this build: always {ok:false,
 * reason:'coming-soon'} and a 'comingSoon' event ("coming in a later update").
 * `capstoneReady` tells the UI whether she has actually earned it.
 */
export function eraAdvance(state) {
  const ready = capstoneReady(state);
  emit(state, 'comingSoon', { era: (state.era ?? 1) + 1, capstoneReady: ready });
  return { ok: false, reason: 'coming-soon', capstoneReady: ready };
}

export { refresh as refreshCommissions, deliver as deliverCommission, complete as completeCommission };
