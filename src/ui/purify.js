/**
 * purify.js: the tube sort for muddy batches (overlay `purify`, fullscreen).
 *
 * Owns: tubes as tall glass SVGs with stacked layers (patterns in colorblind
 * mode), tap a tube to lift it then tap where to pour, the stream arc with a
 * wobbling landing, `audio.glug` per pour, the cork the moment a tube is full
 * and one color (`isCorked`), unlimited Undo, "Add a tube" (only where the tier
 * allows it: Relaxed, once), the "Start this batch on ..." tier switch, and the
 * solve: every non-empty tube corked, then sim.factory.purifyBatch pays the
 * batch at the tier's purity plus the puzzle reward. Implements DESIGN.md
 * "Active play > Purifying", "Interaction feel" (Tube-sort pour), PLAN-v0.2
 * Theme C (tiers, strict solve, whole-column hit area, 11 tubes at 375 wide,
 * just-in-time cork teaching) and the accessibility note (patterns on layers).
 *
 * Hit areas: the whole tube column, including the headroom above the glass, is
 * the target, and a tap anywhere on the shelf (gaps, planks) resolves to the
 * nearest column of the nearest row from the pointer's x and y.
 *
 * Back keeps the puzzle: it lives in state.activePuzzles.purify
 * ({batchId, color, puzzle, tier, startedAt}) until it is solved or the batch
 * is sold. Wrong pours are never red: an illegal pour is a quiet low tick.
 * sim.factory.purifyBatch already fires questEvent('batchPurified'); this
 * screen adds the event points (eventPoints('purify')) and the local counter
 * stats.purified.
 */

import { h, raw, backButton, button, swatch, iconSvg } from './kit.js';
import { markGuideSeen } from './guide.js';
import {
  injectStyle, PZ_CSS, ensureActive, activeOf, createPurifyPuzzle, patternFill, ensureDefs, lightnessOf, coinsText,
  TIER_IDS, TIER_LABEL,
} from './puzzles.js';

const CSS = `
.pu-shelf { flex: 0 0 auto; position: relative; background: var(--walnut); border-radius: 18px; padding: 14px 10px 0; box-shadow: 0 4px 0 rgba(42,38,34,.3); display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.pu-row { position: relative; display: grid; grid-template-columns: repeat(var(--per), var(--col)); justify-content: center; padding-bottom: 12px; }
.pu-row::after { content: ''; position: absolute; left: -10px; right: -10px; bottom: 0; height: 12px; background: var(--walnut-deep); }
.pu-tube { display: flex; justify-content: center; align-items: flex-start; box-sizing: border-box; width: var(--col); border: 0; padding: 18px 0 0; background: transparent; position: relative; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.pu-tube svg { display: block; overflow: visible; width: var(--tw); height: auto; transition: transform 140ms var(--ease-out); }
.pu-tube.is-sel svg { transform: translateY(-16px); }
.pu-tube:focus-visible { outline: 2px solid var(--paper); outline-offset: -2px; border-radius: 8px; }
.pu-layer-new { transform-box: fill-box; transform-origin: 50% 100%; animation: pu-land 320ms var(--ease-out) var(--d, 150ms) backwards; }
@keyframes pu-land { 0% { transform: scaleY(0); } 60% { transform: scaleY(1.07); } 100% { transform: scaleY(1); } }
.pu-cork-new { transform-box: fill-box; transform-origin: 50% 100%; animation: pu-cork 340ms var(--ease-out) var(--cd, 330ms) backwards; }
@keyframes pu-cork { 0% { transform: translateY(-22px); opacity: 0; } 55% { transform: translateY(2px) scale(1.08, .88); opacity: 1; } 100% { transform: none; opacity: 1; } }
.pu-stream { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 5; }
.pu-stream path { fill: none; stroke-linecap: round; filter: drop-shadow(0 1px 0 rgba(42,38,34,.35)); }
.pu-head .titles { min-width: 0; }
.pu-head .subtitle { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pu-head .how-link { flex: 0 0 auto; min-width: 44px; max-width: 64px; padding: 0 2px; white-space: normal; text-align: center; line-height: 1.15; font-size: 12px; }
.pz-body > .pz-status, .pz-body > .pz-result { flex: 0 0 auto; }
.pu-tools { flex: 0 0 auto; display: flex; gap: 10px; flex-wrap: wrap; }
.pu-tools .btn { flex: 1 1 0; min-height: 48px; }
.pu-tools .pu-tierswitch { flex: 1 1 100%; display: flex; flex-direction: column; gap: 6px; }
.pu-tierswitch .cap { font-size: 13px; color: var(--ink-soft); }
.pu-tierswitch .seg-control > button { min-height: 44px; }
.pu-undo { min-height: 44px; min-width: 64px; padding: 0 14px; font-size: 14px; }
.pu-empty-actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: 100%; max-width: 260px; }
.pu-empty-actions .btn.is-quiet, .pu-tools .btn.is-quiet { box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 1.5px rgba(42,38,34,.2); }
.pu-purity { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
.pu-result .coinline b { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .pu-layer-new, .pu-cork-new { animation: none; } .pu-tube svg { transition: none; } }
`;

let C = null;
let ROOT = null;
const P = {
  visible: false, entry: null, sel: null, busy: false, celebrating: false, result: null,
  timers: [], cb: false, sig: '', el: {}, name: '', hex: '#B7BDB3', reward: null,
  lay: { per: 6, col: 51, tw: 44, L: 40, rows: 1 }, armed: null, guide: null, tier: 'relaxed',
};
let uid = 0;

const later = (fn, ms) => { const id = setTimeout(fn, ms); P.timers.push(id); return id; };
const clearTimers = () => { P.timers.forEach(clearTimeout); P.timers = []; };
const reduced = () => !!(C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

const topOf = (t) => (t.length ? t[t.length - 1] : null);
const isDone = (puz, t) => t.length === puz.capacity && t.every((c) => c === t[0]);
const entryTier = (e) => (e && TIER_IDS.includes(e.tier) ? e.tier : (e && e.puzzle && TIER_IDS.includes(e.puzzle.tier) ? e.puzzle.tier : 'relaxed'));
const canExtra = (e) => !!(e && e.puzzle.extraTube !== false && C.puzzles.purify.extraTubeAllowed(entryTier(e)));
const tierRevealed = (t) => !C.sim.unlocks || C.sim.unlocks.tierRevealed(C.game.state, t);

// ---------------------------------------------------------------------------
// Layout: how many tubes per row, how wide
// ---------------------------------------------------------------------------

const MIN_COL = 28; // never narrower than this
const COMFY_COL = 40; // one row only while every column keeps at least this
const MAX_COL = 51; // 44 px of glass plus a 7 px gap

/** layoutFor(n, avail) -> {per, rows, col, tw, L}: one row if it fits comfortably, else two (a third for tiny screens). */
function layoutFor(n, avail) {
  let rows = 1;
  while (rows < 3 && Math.floor(avail / Math.ceil(n / rows)) < (rows === 1 ? COMFY_COL : MIN_COL + 8)) rows++;
  const per = Math.ceil(n / rows);
  const col = clamp(Math.floor(avail / per), MIN_COL, MAX_COL);
  const tw = Math.min(44, col - 6);
  const L = rows === 1 ? 40 : 34;
  return { per, rows, col, tw, L };
}

function shelfAvail() {
  const sh = P.el.shelf;
  const w = (sh && sh.clientWidth) || ((ROOT && ROOT.clientWidth) || window.innerWidth) - 32;
  return Math.max(180, w - 20);
}

// ---------------------------------------------------------------------------
// Sim-style actions
// ---------------------------------------------------------------------------

function pourAct(s, args, now) {
  const e = s.activePuzzles && s.activePuzzles.purify;
  if (!e) return { ok: false };
  const r = C.puzzles.purify.pour(e.puzzle, args.from, args.to);
  if (r.ok && r.solved) {
    const sim = C.sim;
    const batch = (s.muddyBatches || []).find((b) => b.id === e.batchId);
    const colorId = e.color;
    const tier = entryTier(e);
    const done = sim.factory.purifyBatch(s, { batchId: e.batchId, tier }, now);
    sim.events.eventPoints(s, 'purify', 1, { colorId });
    if (s.lifetime) s.lifetime.puzzles = (Number.isFinite(s.lifetime.puzzles) ? s.lifetime.puzzles : 0) + 1;
    if (!s.stats || typeof s.stats !== 'object') s.stats = {};
    s.stats.purified = (Number(s.stats.purified) || 0) + 1;
    ensureActive(s).purify = null;
    r.reward = {
      ok: !!done.ok, jars: done.jars || 0, coins: done.coins || 0, bonus: done.reward || 0,
      purity: done.purity || 'pure', tier, colorId, total: batch ? batch.jars : done.jars,
    };
  }
  return r;
}

const undoAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e ? C.puzzles.purify.undo(e.puzzle) : { ok: false };
};

const addTubeAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e && canExtra(e) ? C.puzzles.purify.addTube(e.puzzle) : { ok: false };
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** The cork: a lip and a tapered plug, sitting in the mouth of the tube. */
const CORK = `<path d="M11.5 8 H32.5 L31 18 H13 Z" fill="#C9A277" stroke="#2A2622" stroke-width="2" stroke-linejoin="round"/>
<rect x="8" y="1.5" width="28" height="7.5" rx="3.5" fill="#D9B88A" stroke="#2A2622" stroke-width="2"/>
<path d="M13 5.2 H31" stroke="#7B5236" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>
<circle cx="18" cy="13" r="1" fill="#7B5236" fill-opacity=".5"/><circle cx="25" cy="14.2" r="1.1" fill="#7B5236" fill-opacity=".5"/><circle cx="29" cy="11.8" r=".9" fill="#7B5236" fill-opacity=".5"/>`;

/** One tube as an inline SVG. `newN` = layers that just landed; `corkNew` animates the cork in. */
function tubeSvg(puz, i, { newN = 0, corkNew = false } = {}) {
  const tube = puz.tubes[i];
  const cap = puz.capacity;
  const L = P.lay.L;
  const top = 16;
  const bodyH = cap * L;
  const H = top + bodyH + 4;
  const id = `pu${++uid}`;
  const yb = top + bodyH - 17;
  const shape = `M5 ${top} V${yb} A17 17 0 0 0 39 ${yb} V${top}`;
  const layers = tube.map((c, k) => {
    const y = top + bodyH - (k + 1) * L;
    const hex = puz.colors[c];
    const fresh = k >= tube.length - newN && newN > 0;
    const cls = fresh ? ' class="pu-layer-new"' : '';
    const dly = fresh ? ` style="--d:${150 + (k - (tube.length - newN)) * 60}ms"` : '';
    const rect = `<rect x="5" y="${y}" width="34" height="${L}" fill="${hex}"/>${C.game.state.settings && C.game.state.settings.colorblind ? `<rect x="5" y="${y}" width="34" height="${L}" fill="${patternFill(c)}"/>` : ''}`;
    return `<g${cls}${dly}>${rect}<rect x="5" y="${y}" width="34" height="1.5" fill="#2A2622" fill-opacity=".18"/></g>`;
  }).join('');
  const corked = isDone(puz, tube);
  const cork = corked ? `<g class="pu-cork${corkNew ? ' pu-cork-new' : ''}">${CORK}</g>` : '';
  return `<svg viewBox="0 0 44 ${H}" aria-hidden="true" focusable="false" data-h="${H}" data-l="${L}">
<defs><clipPath id="${id}"><path d="${shape} Z"/></clipPath></defs>
<path d="${shape} Z" fill="#F2F4F0" fill-opacity=".9"/>
<g clip-path="url(#${id})">${layers}</g>
<rect x="10" y="${top + 8}" width="4" height="${Math.max(10, bodyH - 36)}" rx="2" fill="#FFFFFF" fill-opacity=".45"/>
<path d="${shape}" fill="none" stroke="#2A2622" stroke-width="2.5" stroke-linecap="round"/>
${cork}</svg>`;
}

function tubeButton(puz, i, opts) {
  const tube = puz.tubes[i];
  const lifted = P.sel === i ? ' is-sel' : '';
  const corked = isDone(puz, tube);
  const label = tube.length
    ? `Tube ${i + 1}, ${tube.length} of ${puz.capacity} layers${corked ? ', corked' : ''}`
    : `Tube ${i + 1}, empty`;
  return `<button type="button" class="pu-tube${lifted}${corked ? ' is-corked' : ''}" data-tube="${i}" aria-label="${label}">${tubeSvg(puz, i, opts)}</button>`;
}

function shelfHtml(puz) {
  const n = puz.tubes.length;
  const { per } = P.lay;
  const rows = [];
  for (let r = 0; r * per < n; r++) {
    const cells = [];
    for (let i = r * per; i < Math.min(n, (r + 1) * per); i++) cells.push(tubeButton(puz, i));
    rows.push(`<div class="pu-row" style="--per:${per}">${cells.join('')}</div>`);
  }
  return rows.join('');
}

function applyLayoutVars() {
  const sh = P.el.shelf;
  if (!sh) return;
  sh.style.setProperty('--col', `${P.lay.col}px`);
  sh.style.setProperty('--tw', `${P.lay.tw}px`);
}

/** Mark the one tube the cork coach points at: the first one layer from full, else the first corked. */
function markCoach() {
  const puz = P.entry && P.entry.puzzle;
  if (!puz || !P.el.shelf) return;
  P.el.shelf.querySelectorAll('[data-coach="purify-near"]').forEach((n) => n.removeAttribute('data-coach'));
  let idx = puz.tubes.findIndex((t) => t.length === puz.capacity - 1 && t.every((c) => c === t[0]));
  if (idx < 0) idx = puz.tubes.findIndex((t) => isDone(puz, t));
  const el = idx >= 0 ? tubeEl(idx) : null;
  if (el) el.setAttribute('data-coach', 'purify-near');
}

function statusHtml(puz) {
  const total = puz.colors.length;
  const corked = puz.tubes.filter((t) => isDone(puz, t)).length;
  const left = total - corked;
  const hl = corked
    ? (left <= 0 ? 'Every color is corked' : `${corked} ${corked === 1 ? 'color' : 'colors'} corked, ${left} more to go`)
    : 'Pour each color into its own tube';
  return h`<div class="hl">${hl}</div><div class="dt">Tap a tube, then tap where to pour. You can pour onto the same color or into an empty tube.</div>`;
}

function updateStatus() {
  if (P.el.status && !P.result && P.entry) P.el.status.innerHTML = String(statusHtml(P.entry.puzzle));
}

/** Other revealed tiers she can restart this batch on. */
function otherTiers() {
  const cur = entryTier(P.entry);
  return TIER_IDS.filter((t) => t !== cur && tierRevealed(t));
}

function switchHtml() {
  const others = otherTiers();
  if (!others.length) return '';
  const armed = P.armed;
  const lbl = (t) => (armed === t ? `Start over on ${TIER_LABEL[t]}? Tap again` : `Start this batch on ${TIER_LABEL[t]}`);
  if (others.length === 1) {
    return h`<div class="pu-tierswitch">${button(lbl(others[0]), { cls: 'is-quiet', attrs: { 'data-action': 'restart-tier', 'data-tier': others[0] } })}</div>`;
  }
  return h`<div class="pu-tierswitch"><div class="cap">Start this batch on</div><div class="seg-control" role="group" aria-label="Start this batch on">${others.map((t) => h`<button type="button" data-action="restart-tier" data-tier="${t}" data-tap aria-pressed="${armed === t ? 'true' : 'false'}">${armed === t ? 'Tap again' : TIER_LABEL[t]}</button>`)}</div></div>`;
}

function updateTools() {
  const e = P.entry;
  if (!e) return;
  const undo = ROOT.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !e.puzzle.history.length;
  const add = ROOT.querySelector('[data-action="add-tube"]');
  if (add) {
    add.disabled = !!e.puzzle.extraTubeUsed;
    add.textContent = e.puzzle.extraTubeUsed ? 'Extra tube added' : 'Add a tube';
  }
  const sw = ROOT.querySelector('[data-switch]');
  if (sw) sw.innerHTML = String(switchHtml());
}

function emptyHtml() {
  return h`<div class="screen-head">${backButton('Back to the puzzle table')}<div class="titles"><div class="title">Purify</div></div><div class="spacer"></div></div>
<div class="screen-body pz-body"><div class="card pz-empty"><div class="h2">All batches are sparkling</div><div class="hint">Muddy batches come from fast mixers. When one is made, it waits for you on the puzzle table.</div><div class="pu-empty-actions">${button('Back to the table', { variant: 'primary', block: true, attrs: { 'data-action': 'done' } })}${button('Go to the workshop', { block: true, cls: 'is-quiet', attrs: { 'data-action': 'to-workshop' } })}</div></div></div>`;
}

function drawAll() {
  const state = C.game.state;
  P.cb = !!(state.settings && state.settings.colorblind);
  P.sel = null;
  P.armed = null;
  const e = P.entry;
  if (!e) {
    ROOT.innerHTML = String(emptyHtml());
    P.el = {};
    return;
  }
  const puz = e.puzzle;
  P.sig = sigOf(e);
  P.name = C.sim.displayName ? C.sim.displayName(state, e.color) : e.color;
  P.hex = C.sim.economy.colorHex(e.color);
  P.tier = entryTier(e);
  const addBtn = canExtra(e)
    ? button(puz.extraTubeUsed ? 'Extra tube added' : 'Add a tube', { disabled: puz.extraTubeUsed, cls: 'is-quiet', attrs: { 'data-action': 'add-tube' } })
    : '';
  ROOT.innerHTML = String(h`<div class="screen-head pu-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Purify</div><div class="subtitle" data-subtitle>${TIER_LABEL[P.tier]} · ${P.name}</div></div>
${C.guide.howThisWorksHtml('purify')}
<button type="button" class="btn pu-undo" data-action="undo" data-tap${puz.history.length ? '' : ' disabled'}>Undo</button></div>
<div class="screen-body pz-body">
<div class="pu-shelf" data-shelf data-coach="purify-board"></div>
<div class="card pz-status" data-status data-coach="purify-status"></div>
<div class="pu-tools" data-tools>${addBtn}<div data-switch class="pu-tierswitch-wrap" style="flex:1 1 100%">${switchHtml()}</div></div>
</div>`);
  P.el = { shelf: ROOT.querySelector('[data-shelf]'), status: ROOT.querySelector('[data-status]') };
  P.lay = layoutFor(puz.tubes.length, shelfAvail());
  applyLayoutVars();
  P.el.shelf.innerHTML = shelfHtml(puz);
  markCoach();
  updateStatus();
}

function sigOf(e) {
  return `${e.batchId}|${e.puzzle.moves}|${e.puzzle.history.length}|${e.puzzle.tubes.length}|${P.cb ? 1 : 0}|${entryTier(e)}`;
}

function tubeEl(i) {
  return P.el.shelf && P.el.shelf.querySelector(`[data-tube="${i}"]`);
}

function redrawTube(i, opts) {
  const old = tubeEl(i);
  if (!old) return null;
  const t = document.createElement('div');
  t.innerHTML = tubeButton(P.entry.puzzle, i, opts);
  const fresh = t.firstElementChild;
  old.replaceWith(fresh);
  return fresh;
}

function setSel(i) {
  if (P.sel !== null) {
    const o = tubeEl(P.sel);
    if (o) { o.classList.remove('is-sel'); o.removeAttribute('aria-pressed'); }
  }
  P.sel = i;
  if (i !== null) {
    const n = tubeEl(i);
    if (n) { n.classList.add('is-sel'); n.setAttribute('aria-pressed', 'true'); }
  }
}

/** Re-measure the shelf and rebuild it when the layout changed (rotation, resize). */
function relayout() {
  if (!P.visible || !P.entry || !P.el.shelf || P.celebrating || P.result) return;
  const lay = layoutFor(P.entry.puzzle.tubes.length, shelfAvail());
  const same = ['per', 'col', 'tw', 'L'].every((k) => lay[k] === P.lay[k]);
  if (same) return;
  P.lay = lay;
  applyLayoutVars();
  P.el.shelf.innerHTML = shelfHtml(P.entry.puzzle);
  setSel(null);
  markCoach();
}

// ---------------------------------------------------------------------------
// Hit testing: columns and gaps resolve to the nearest tube
// ---------------------------------------------------------------------------

/** tubeAtPoint(x, y) -> index of the tube whose column is nearest the pointer (row by y, then column by x). */
function tubeAtPoint(x, y) {
  const rows = [...P.el.shelf.querySelectorAll('.pu-row')];
  let best = null;
  let bestDy = Infinity;
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    if (dy < bestDy) { bestDy = dy; best = r; }
  }
  if (!best) return null;
  let pick = null;
  let bestDx = Infinity;
  for (const t of best.querySelectorAll('[data-tube]')) {
    const b = t.getBoundingClientRect();
    const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
    const mid = Math.abs(x - (b.left + b.width / 2));
    const score = dx * 1000 + mid;
    if (score < bestDx) { bestDx = score; pick = t; }
  }
  return pick ? Number(pick.dataset.tube) : null;
}

// ---------------------------------------------------------------------------
// Pour
// ---------------------------------------------------------------------------

function streamTo(a, b, hex, newLen, moved) {
  if (!a || !b || reduced() || !P.el.shelf) return;
  const sr = P.el.shelf.getBoundingClientRect();
  const k = a.width / 44; // svg scale (tubes can be narrower than 44 px)
  const L = P.lay.L;
  const cap = P.entry.puzzle.capacity;
  const x1 = a.left + a.width / 2 - sr.left;
  const y1 = a.top - sr.top + 2 * k; // from the (lifted) mouth
  const x2 = b.left + b.width / 2 - sr.left;
  const y2 = b.top - sr.top + (16 + (cap - newLen) * L) * k;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pu-stream');
  svg.setAttribute('width', sr.width);
  svg.setAttribute('height', sr.height);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M${x1} ${y1} Q${x2} ${y1 - 34} ${x2} ${y2}`);
  path.setAttribute('stroke', hex);
  path.setAttribute('stroke-width', String(Math.max(3, 5 * k)));
  svg.appendChild(path);
  P.el.shelf.appendChild(svg);
  const len = path.getTotalLength ? path.getTotalLength() : 200;
  path.style.strokeDasharray = String(len);
  const dur = 360 + moved * 60;
  const anim = path.animate
    ? path.animate([
      { strokeDashoffset: len, offset: 0 },
      { strokeDashoffset: 0, offset: 0.4 },
      { strokeDashoffset: 0, offset: 0.7 },
      { strokeDashoffset: -len, offset: 1 },
    ], { duration: dur, easing: 'ease-in-out', fill: 'both' })
    : null;
  const end = () => svg.remove();
  if (anim) anim.finished.then(end, end); else setTimeout(end, dur);
}

const svgRect = (i) => {
  const b = tubeEl(i);
  const s = b && b.querySelector('svg');
  return s ? s.getBoundingClientRect() : null;
};

function pour(from, to) {
  const e = P.entry;
  const puz = e.puzzle;
  if (!C.puzzles.purify.canPour(puz, from, to)) {
    safe(() => C.audio.tick('miss'));
    const t = puz.tubes[to];
    setSel(t.length && !isDone(puz, t) ? to : null);
    return;
  }
  const before = puz.tubes[to].length;
  const colorIdx = topOf(puz.tubes[from]);
  const ra = svgRect(from); // measured before the tubes are redrawn
  const rb = svgRect(to);
  const res = C.game.act(pourAct, { from, to });
  if (!res || !res.ok) { setSel(null); return; }
  setSel(null);
  redrawTube(from);
  redrawTube(to, { newN: res.moved, corkNew: res.completedTube });
  markCoach();
  safe(() => streamTo(ra, rb, puz.colors[colorIdx], before + res.moved, res.moved));
  const hex = puz.colors[colorIdx];
  const Lc = lightnessOf(C, hex);
  const hz = clamp(C.color.noteHz(Lc), 247, 523);
  const len = safe(() => C.audio.glug((before + res.moved) / puz.capacity, { fromRatio: before / puz.capacity, layers: res.moved, hz })) || (0.32 + 0.2 * res.moved);
  safe(() => C.haptics.light());
  if (res.completedTube) {
    safe(() => C.audio.note(Lc, len + 0.02, 0.18, 0.8));
    safe(() => C.audio.cork(len + 0.14));
    later(() => safe(() => C.haptics.medium()), (len + 0.14) * 1000);
  }
  updateStatus();
  updateTools();
  P.sig = sigOf(e);
  if (res.solved && res.reward) {
    P.celebrating = true;
    P.reward = res.reward;
    if (P.guide) { P.guide.stop(); P.guide = null; }
    C.game.act(markGuideSeen, { id: 'purify' }); // she has finished a batch: the coach is done
    later(startCelebration, 480);
  }
}

// ---------------------------------------------------------------------------
// Celebration and result
// ---------------------------------------------------------------------------

function startCelebration() {
  if (!P.celebrating) return;
  const puz = P.entry ? P.entry.puzzle : null;
  const colors = (puz ? puz.colors : []).map((hx) => lightnessOf(C, hx));
  safe(() => C.fx.shimmerSweep(P.el.shelf, { ms: 800 }));
  safe(() => C.audio.arpeggio(colors));
  safe(() => C.haptics.success());
  later(finalize, 780);
}

function skip() {
  if (!P.celebrating) return;
  clearTimers();
  finalize();
}

const PURITY_COPY = {
  pure: { head: 'Pure', sells: 'sells for 50% more' },
  flawless: { head: 'Flawless', sells: 'sells for 2×' },
};

function finalize() {
  if (!P.celebrating) return;
  clearTimers();
  P.celebrating = false;
  const r = P.reward;
  P.result = r;
  P.tier = r.tier || P.tier;
  const more = (C.game.state.muddyBatches || []).filter((b) => b.id !== (P.entry && P.entry.batchId));
  const jarsIn = Math.max(0, Math.round(r.jars));
  const pc = PURITY_COPY[r.purity] || PURITY_COPY.pure;
  const card = h`<div class="card pz-result pu-result" data-result>
<div class="row">${swatch(P.hex, 44, { label: P.name })}<div class="grow"><div class="hl" data-purity>${pc.head} batch of <span class="pz-name">${P.name}</span>: ${pc.sells}</div></div></div>
<ul class="lines">
<li>${iconSvg('check', { size: 18 })}<span>${jarsIn} ${jarsIn === 1 ? 'jar' : 'jars'} of ${pc.head.toLowerCase()} ${P.name} added to your stock</span></li>
<li class="coinline">${iconSvg('coin', { size: 18 })}<span>+<b data-roll>0</b> coins${r.coins > r.bonus + 0.0001 ? ', with jars that did not fit' : ' for sorting it'}</span></li>
</ul>
<div class="pz-actions">${more.length ? button('Next batch', { variant: 'primary', attrs: { 'data-action': 'next-batch', 'data-batch': more[0].id } }) : ''}${button('Back to the table', { variant: more.length ? 'paper' : 'primary', attrs: { 'data-action': 'done' } })}</div>
</div>`;
  let cardEl = null;
  if (P.el.status) {
    const wrap = document.createElement('div');
    wrap.innerHTML = String(card);
    cardEl = wrap.firstElementChild;
    P.el.status.replaceWith(cardEl);
    P.el.status = null;
  }
  ROOT.querySelectorAll('[data-action="undo"],[data-action="add-tube"],[data-action="restart-tier"]').forEach((b) => { b.disabled = true; });
  const sw = ROOT.querySelector('[data-tools]');
  if (sw) sw.hidden = true;
  if (cardEl) playReward(cardEl, r);
}

/** The ink stamp lands, coins fan out to the total, which rolls up from zero. */
function playReward(cardEl, r) {
  const roll = cardEl.querySelector('[data-roll]');
  const fmt = (v) => coinsText(C, v);
  const finish = () => { if (roll) roll.textContent = fmt(r.coins); };
  if (!roll) return;
  if (!(r.coins > 0)) { finish(); return; }
  const go = () => {
    const from = cardEl.querySelector('.swatch') || cardEl;
    safe(() => C.fx.coinArc(from, roll, 8, { quiet: false }));
    safe(() => C.fx.rollNumber(roll, 0, r.coins, { ms: 600, format: fmt }));
    later(finish, 700); // exact total even if the roll was cut short
  };
  if (reduced()) { go(); return; }
  const stampP = safe(() => C.fx.stamp(cardEl, (PURITY_COPY[r.purity] || PURITY_COPY.pure).head, { hold: 500 }));
  if (stampP && stampP.then) stampP.then(() => { if (P.result === r) later(go, 120); }, go);
  else go();
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

const pz = () => {
  const e = C.game.state.activePuzzles && C.game.state.activePuzzles.purify;
  return e && e.puzzle;
};
const nearFull = () => {
  const p = pz();
  return !!p && p.tubes.some((t) => t.length === p.capacity - 1 && t.every((c) => c === t[0]));
};
const anyCork = () => {
  const p = pz();
  return !!p && p.tubes.some((t) => isDone(p, t));
};

function coachSteps() {
  return [
    { anchor: '[data-coach="purify-board"]', text: 'Pour a top layer onto a matching color', endsOn: 'action', done: () => { const p = pz(); return !!p && p.moves > 0; } },
    { anchor: '[data-coach="purify-near"]', text: 'A full tube of one color gets corked', endsOn: 'got-it', when: () => nearFull() || anyCork() },
    { anchor: '[data-coach="purify-status"]', text: 'Cork every tube to finish', endsOn: 'got-it', when: () => anyCork() },
  ];
}

function startCoach() {
  if (P.guide) { P.guide.stop(); P.guide = null; }
  if (!P.entry || !C.guide) return;
  P.guide = C.guide('purify', coachSteps(), { screen: 'purify' });
  P.guide.start();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function tapTube(i) {
  if (P.celebrating) { skip(); return; }
  if (P.result || !P.entry || !Number.isInteger(i)) return;
  const puz = P.entry.puzzle;
  const tubes = puz.tubes;
  if (!tubes[i]) return;
  if (P.armed) { P.armed = null; updateTools(); }
  if (P.sel === null) {
    if (!tubes[i].length || isDone(puz, tubes[i])) { safe(() => C.audio.tick('blocked')); return; }
    setSel(i);
    safe(() => C.audio.tick('select'));
    safe(() => C.haptics.light());
  } else if (P.sel === i) {
    setSel(null);
    safe(() => C.audio.tick('deselect'));
  } else {
    pour(P.sel, i);
  }
}

function onClick(e) {
  if (e.target.closest('[data-shelf]') && ROOT.contains(e.target)) {
    if (P.celebrating) { skip(); return; }
    if (!P.entry || P.result || !P.el.shelf) return;
    // A pointer tap resolves by position (columns, gaps and planks all count);
    // a keyboard "click" has no position, so it uses the focused tube.
    const hasPos = e.detail > 0 || e.clientX || e.clientY;
    const btn = e.target.closest('[data-tube]');
    const i = hasPos || !btn ? tubeAtPoint(e.clientX, e.clientY) : Number(btn.dataset.tube);
    tapTube(i);
    return;
  }
  const a = e.target.closest('[data-action]');
  if (!a || !ROOT.contains(a)) return;
  const act = a.dataset.action;
  if (act === 'undo') {
    if (!P.entry || P.result) return;
    const r = C.game.act(undoAct);
    if (r && r.ok) {
      setSel(null);
      redrawTube(r.from);
      redrawTube(r.to);
      markCoach();
      safe(() => C.audio.tick('deselect'));
      safe(() => C.haptics.light());
      P.sig = sigOf(P.entry);
      updateStatus();
      updateTools();
    }
  } else if (act === 'add-tube') {
    if (!P.entry || P.result) return;
    const r = C.game.act(addTubeAct);
    if (r && r.ok) {
      safe(() => C.audio.tick('select'));
      drawAll();
    }
  } else if (act === 'restart-tier') {
    if (!P.entry || P.result) return;
    const tier = a.dataset.tier;
    if (!TIER_IDS.includes(tier) || !tierRevealed(tier)) return;
    if (P.entry.puzzle.moves > 0 && P.armed !== tier) { P.armed = tier; updateTools(); return; }
    const batchId = P.entry.batchId;
    C.game.act((s, args, now) => createPurifyPuzzle(C, s, args, now), { batchId, tier });
    P.entry = activeOf(C.game.state).purify || null;
    drawAll();
    startCoach();
  } else if (act === 'done') {
    P.result = null;
    C.back();
  } else if (act === 'to-workshop') {
    P.result = null;
    C.navigate('workshop', {});
  } else if (act === 'next-batch') {
    const batchId = a.dataset.batch;
    const tier = P.tier;
    P.result = null;
    clearTimers();
    C.game.act((s, args, now) => createPurifyPuzzle(C, s, args, now), { batchId, tier });
    P.entry = activeOf(C.game.state).purify;
    drawAll();
    startCoach();
  }
}

function adopt(params) {
  const st = C.game.state;
  let e = activeOf(st).purify;
  const want = params && params.batchId;
  const batches = st.muddyBatches || [];
  if (e && !batches.some((b) => b.id === e.batchId)) {
    C.game.act((s) => { ensureActive(s).purify = null; });
    e = null;
  }
  if (want && (!e || e.batchId !== want)) {
    if (batches.some((b) => b.id === want)) {
      C.game.act((s, a, now) => createPurifyPuzzle(C, s, a, now), { batchId: want, tier: params.tier });
    }
  } else if (!e && !want && batches.length) {
    C.game.act((s, a, now) => createPurifyPuzzle(C, s, a, now), { batchId: batches[0].id });
  }
  return activeOf(C.game.state).purify || null;
}

export default {
  id: 'purify',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('shared', PZ_CSS);
    injectStyle('purify', CSS);
    ensureDefs();
    root.addEventListener('click', onClick);
    window.addEventListener('resize', relayout);
  },

  show(params = {}) {
    P.visible = true;
    clearTimers();
    if (P.result && !params.batchId && !(activeOf(C.game.state).purify)) return; // back from a ceremony: keep the result card
    P.result = null;
    P.celebrating = false;
    P.entry = adopt(params);
    drawAll();
    startCoach();
  },

  hide() {
    P.visible = false;
    clearTimers();
    P.celebrating = false;
    P.result = null;
    if (P.guide) { P.guide.stop(); P.guide = null; }
  },

  render(state) {
    if (!ROOT || !P.visible || P.celebrating || P.result) return;
    const e = activeOf(state).purify || null;
    if (e && e === P.entry) {
      // A newly revealed tier (a discovery elsewhere) shows up in the switch without a redraw.
      const sw = ROOT.querySelector('[data-switch]');
      const html = String(switchHtml());
      if (sw && sw.dataset.html !== html) { sw.dataset.html = html; sw.innerHTML = html; }
    }
    const cb = !!(state.settings && state.settings.colorblind);
    if (e !== P.entry || cb !== P.cb || (e && sigOf(e) !== P.sig)) {
      P.entry = e;
      drawAll();
    }
  },
};
