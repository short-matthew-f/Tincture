/**
 * purify.js: the tube sort for muddy batches (overlay `purify`, fullscreen).
 *
 * Owns: tubes as tall glass SVGs with stacked layers (patterns in colorblind
 * mode), tap a tube to lift it (fx.lift: 106% and a grown shadow) then tap where
 * to pour, the stream arc, the pouring tube tipping back upright (spring soft),
 * layers landing with a wobble (spring soft on the layer group), `audio.glug`
 * per pour pitched to the fill, the cork popping in (spring heavy, medium haptic)
 * the moment a tube is full and one color (`isCorked`), unlimited Undo, "Add a tube" (only where the tier
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
 * Murky (puzzle.murky): every layer below a tube's top is drawn as cloudy
 * glass with a small "?" (never its color, never its colorblind pattern) until
 * it reaches the top; then the cloud clears off it (a short fade). The board's
 * chip is for this batch only (0.4.1): Murky off clears every cloudy layer in
 * place (a soft clearing fade, every pour kept, the batch pays the usual
 * amount: sim.factory.purifySolved reads puzzle.murky at completion); Murky on
 * starts the batch over ("Tap again" once she has poured). Her choice for new
 * batches (settings.purifyMurky) is its own line under "This batch".
 *
 * Back to solvable (0.4.1): after every pour the solver checks the shelf from
 * where it stands (puzzles/purify.verdict, a small node cap, cached by
 * position; running out of budget counts as solvable). A proven dead end shows
 * a note in the status card with "Back to solvable", which undoes quickly, in
 * sequence, to the latest shelf that is not proven dead (and "Add a tube" when
 * the free extra tube on Relaxed would sort it out).
 *
 * Back keeps the puzzle: it lives in state.activePuzzles.purify
 * ({batchId, color, puzzle, tier, startedAt}) until it is solved or the batch
 * is sold. Wrong pours are never red: an illegal pour is a quiet low tick.
 * sim.factory.purifyBatch already fires questEvent('batchPurified'); this
 * screen adds the event points (eventPoints('purify')) and the local counter
 * stats.purified.
 */

import { h, raw, backButton, button, swatch, iconSvg, safeHex } from './kit.js';
import { markGuideSeen } from './guide.js';
import {
  injectStyle, PZ_CSS, ensureActive, activeOf, createPurifyPuzzle, patternFill, ensureDefs, lightnessOf, coinsText,
  TIER_IDS, TIER_LABEL, murkyUnlocked, murkyChip, purifyMurky,
} from './puzzles.js';
import { verdictCache } from '../puzzles/backtrack.js';

const CSS = `
.pu-shelf { flex: 0 0 auto; position: relative; background: var(--walnut); border-radius: 18px; padding: 14px 10px 0; box-shadow: 0 4px 0 rgba(42,38,34,.3); display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.pu-row { position: relative; display: grid; grid-template-columns: repeat(var(--per), var(--col)); justify-content: center; padding-bottom: 12px; }
.pu-row::after { content: ''; position: absolute; left: -10px; right: -10px; bottom: 0; height: 12px; background: var(--walnut-deep); }
.pu-tube { display: flex; justify-content: center; align-items: flex-start; box-sizing: border-box; width: var(--col); border: 0; padding: 18px 0 0; background: transparent; position: relative; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.pu-tube svg { display: block; overflow: visible; width: var(--tw); height: auto; transition: transform 140ms var(--ease-out); }
.pu-tube.is-sel svg { transform: translateY(-16px); }
.pu-tube.is-goal svg { filter: drop-shadow(0 0 6px rgba(240, 196, 92, .95)); }
.pz-status .pu-goal { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: -2px; margin-right: 6px; box-shadow: inset 0 0 0 1.5px rgba(42,38,34,.3); }
.pu-tube:focus-visible { outline: 2px solid var(--paper); outline-offset: -2px; border-radius: 8px; }
.pu-layer-new, .pu-cork-new { transform-box: fill-box; transform-origin: 50% 100%; }
.pu-tube.fx-lifted { transform-origin: 50% 100%; }
.pu-tube svg.is-tipping { transform-origin: 50% 25%; }
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
.pu-clearing { animation: pu-clear 520ms var(--ease-out) 120ms both; }
@keyframes pu-clear { from { opacity: 1; } to { opacity: 0; } }
.pu-tierswitch-wrap { display: flex; flex-direction: column; gap: 10px; }
.pu-tierswitch-wrap:empty { display: none; }
.pu-murkyrow { flex: 1 1 100%; }
.pu-murkyrow .chip.pz-murky[disabled] { opacity: .75; cursor: default; }
.pu-batch { flex: 1 1 100%; display: flex; flex-direction: column; gap: 10px; }
.pu-batch > .cap, .pu-tierswitch .cap { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
.pu-pref { display: flex; align-items: center; gap: 10px; justify-content: space-between; border-top: 1px solid rgba(42,38,34,.1); padding-top: 8px; }
.pu-pref .hint { font-size: 12.5px; }
.pu-pref .btn { flex: 0 0 auto; min-height: 44px; }
.pz-status .pu-note { font-size: 14px; font-weight: 600; color: var(--ink); }
.pu-stuck { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 10px 12px; border-radius: var(--radius-sm, 10px); background: var(--glow, #F3E3B8); box-shadow: 0 0 0 1.5px var(--glow-ring, rgba(226,176,74,.6)); }
.pu-stuck .semi { font-weight: 600; }
.pu-stuck .row { display: flex; gap: 8px; flex-wrap: wrap; }
.pu-stuck .btn { min-height: 44px; flex: 1 1 auto; }
@media (prefers-reduced-motion: reduce) { .pu-tube svg { transition: none; } .pu-clearing { animation-duration: 120ms; animation-delay: 0ms !important; } }
html[data-motion="reduced"] .pu-clearing { animation-duration: 120ms; animation-delay: 0ms !important; }
`;

let C = null;
let ROOT = null;
const P = {
  visible: false, entry: null, sel: null, busy: false, celebrating: false, result: null,
  timers: [], cb: false, sig: '', el: {}, name: '', hex: '#B7BDB3', reward: null,
  lay: { per: 6, col: 51, tw: 44, L: 40, rows: 1 }, armed: null, guide: null, murkyGuide: null, tier: 'relaxed',
  // 0.4.1: a one-line note in the status card, the dead-end check (P.dead: the solver proves no
  // order of pours finishes from here; P.spare: the free extra tube would rescue it), and the
  // "Back to solvable" steps playing.
  note: '', dead: false, spare: false, stepping: false, checkTimer: 0,
};
let VCACHE = verdictCache(600);
let VFOR = '';
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
const hiddenOf = (puz, i) => C.puzzles.purify.hiddenCount(puz, i);
const isMurky = (e) => !!(e && e.puzzle && e.puzzle.murky);

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
    // The Murky bonus follows the puzzle's own flag at completion (cleared murk pays the usual amount).
    const done = sim.factory.purifySolved(s, { batchId: e.batchId, tier, puzzle: e.puzzle }, now);
    sim.events.eventPoints(s, 'purify', 1, { colorId });
    if (s.lifetime) s.lifetime.puzzles = (Number.isFinite(s.lifetime.puzzles) ? s.lifetime.puzzles : 0) + 1;
    if (!s.stats || typeof s.stats !== 'object') s.stats = {};
    s.stats.purified = (Number(s.stats.purified) || 0) + 1;
    ensureActive(s).purify = null;
    r.reward = {
      ok: !!done.ok, jars: done.jars || 0, coins: done.coins || 0, bonus: done.reward || 0,
      purity: done.purity || 'pure', tier, colorId, total: batch ? batch.jars : done.jars, murky: !!done.murky,
    };
  }
  return r;
}

const undoAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e ? C.puzzles.purify.undo(e.puzzle) : { ok: false };
};

/** Murky off for this batch, in place: every cloudy layer revealed, every pour kept (puzzles/purify.clearMurk). */
const clearMurkAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e ? C.puzzles.purify.clearMurk(e.puzzle) : { ok: false, revealed: [] };
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

/** Cloudy glass over a hidden layer: murky water, a soft swirl and a small "?" (no color, no pattern). */
const MURK = '#958B7A';
function murkLayer(y, L, cls = '') {
  const cy = y + L / 2;
  return `<g class="pu-murk${cls}" data-hidden="1"><rect x="5" y="${y}" width="34" height="${L}" fill="${MURK}"/>
<ellipse cx="15" cy="${cy - L * 0.18}" rx="9" ry="${L * 0.16}" fill="#FFFFFF" fill-opacity=".16"/><ellipse cx="29" cy="${cy + L * 0.2}" rx="8" ry="${L * 0.13}" fill="#2A2622" fill-opacity=".12"/>
<path d="M11 ${cy + 3} q5 -6 10 0 t10 0" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="1.6" stroke-linecap="round"/>
<text x="22" y="${cy + 4.5}" text-anchor="middle" font-size="13" font-weight="700" font-family="system-ui, sans-serif" fill="#FFFFFF" fill-opacity=".72">?</text></g>`;
}

/** One tube as an inline SVG. `newN` = layers that just landed; `corkNew` animates the cork in; `cleared` = layers whose cloud just lifted. */
function tubeSvg(puz, i, { newN = 0, corkNew = false, cleared = [], clearDelay = 0 } = {}) {
  const tube = puz.tubes[i];
  const cap = puz.capacity;
  const L = P.lay.L;
  const top = 16;
  const bodyH = cap * L;
  const H = top + bodyH + 4;
  const id = `pu${++uid}`;
  const yb = top + bodyH - 17;
  const shape = `M5 ${top} V${yb} A17 17 0 0 0 39 ${yb} V${top}`;
  const hidden = hiddenOf(puz, i);
  const layers = tube.map((c, k) => {
    const y = top + bodyH - (k + 1) * L;
    if (k < hidden) return `<g>${murkLayer(y, L)}<rect x="5" y="${y}" width="34" height="1.5" fill="#2A2622" fill-opacity=".18"/></g>`;
    const hex = puz.colors[c];
    const fresh = k >= tube.length - newN && newN > 0;
    const cls = fresh ? ' class="pu-layer-new"' : '';
    const dly = fresh ? ` style="--d:${150 + (k - (tube.length - newN)) * 60}ms"` : '';
    const rect = `<rect x="5" y="${y}" width="34" height="${L}" fill="${hex}"/>${C.game.state.settings && C.game.state.settings.colorblind ? `<rect x="5" y="${y}" width="34" height="${L}" fill="${patternFill(c)}"/>` : ''}`;
    const clearing = cleared.includes(k) ? murkLayer(y, L, ' pu-clearing').replace('<g class="pu-murk pu-clearing"', `<g class="pu-murk pu-clearing" style="animation-delay:${120 + clearDelay + k * 70}ms"`) : '';
    return `<g${cls}${dly}>${rect}${clearing}<rect x="5" y="${y}" width="34" height="1.5" fill="#2A2622" fill-opacity=".18"/></g>`;
  }).join('');
  const corked = isDone(puz, tube);
  const cork = corked ? `<g class="pu-cork${corkNew ? ' pu-cork-new' : ''}">${CORK}</g>` : '';
  return `<svg viewBox="0 0 44 ${H}" aria-hidden="true" focusable="false" data-h="${H}" data-l="${L}">
<defs><clipPath id="${id}"><path d="${shape} Z"/></clipPath></defs>
<path d="${shape} Z" fill="#2A2622" fill-opacity=".38"/>
<g clip-path="url(#${id})">${layers}</g>
<rect x="10" y="${top + 8}" width="4" height="${Math.max(10, bodyH - 36)}" rx="2" fill="#FFFFFF" fill-opacity=".45"/>
<path d="${shape}" fill="none" stroke="#2A2622" stroke-width="2.5" stroke-linecap="round"/>
${cork}</svg>`;
}

/** True for the batch's own color (the one she is purifying). */
function isGoalColor(hex) {
  try { return !!(hex && P.hex && C.color.deltaEHex(hex, P.hex) < 3); } catch { return false; }
}

function tubeButton(puz, i, opts) {
  const tube = puz.tubes[i];
  const lifted = P.sel === i ? ' is-sel' : '';
  const corked = isDone(puz, tube);
  const hidden = hiddenOf(puz, i);
  const label = tube.length
    ? `Tube ${i + 1}, ${tube.length} of ${puz.capacity} layers${corked ? ', corked' : ''}${hidden ? `, ${hidden} still cloudy` : ''}`
    : `Tube ${i + 1}, empty`;
  const goal = corked && isGoalColor(puz.colors[tube[0]]);
  return `<button type="button" class="pu-tube${lifted}${corked ? ' is-corked' : ''}${goal ? ' is-goal' : ''}" data-tube="${i}" aria-label="${label}${goal ? `, your ${P.name}` : ''}">${tubeSvg(puz, i, opts)}</button>`;
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
  let idx = puz.tubes.findIndex((t, i) => t.length === puz.capacity - 1 && t.every((c) => c === t[0]) && !hiddenOf(puz, i));
  if (idx < 0) idx = puz.tubes.findIndex((t) => isDone(puz, t));
  const el = idx >= 0 ? tubeEl(idx) : null;
  if (el) el.setAttribute('data-coach', 'purify-near');
  P.el.shelf.querySelectorAll('[data-coach="purify-murky"]').forEach((n) => n.removeAttribute('data-coach'));
  const m = puz.tubes.findIndex((t, i) => hiddenOf(puz, i) > 0);
  const mel = m >= 0 ? tubeEl(m) : null;
  if (mel) mel.setAttribute('data-coach', 'purify-murky');
}

function statusHtml(puz) {
  const total = puz.colors.length;
  const corked = puz.tubes.filter((t) => isDone(puz, t)).length;
  const left = total - corked;
  const hl = corked
    ? (left <= 0 ? 'Every color is corked' : `${corked} ${corked === 1 ? 'color' : 'colors'} corked, ${left} more to go`)
    : 'Pour each color into its own tube';
  const cloudy = C.puzzles.purify.hiddenTotal(puz);
  const murk = puz.murky ? (cloudy ? ` ${cloudy} cloudy ${cloudy === 1 ? 'layer clears' : 'layers clear'} as you pour.` : ' Every layer is clear now.') : '';
  const note = P.note ? h`<div class="pu-note" data-note role="status">${P.note}</div>` : '';
  const stuck = P.dead
    ? h`<div class="pu-stuck" data-stuck><div class="semi">This shelf has gotten tangled.</div><div class="hint">${P.spare ? 'The spare tube would sort it out, or step back to the last shelf that can still be sorted.' : 'No order of pours finishes it from here. Back to solvable takes back just the pours it needs.'}</div><div class="row">${button('Back to solvable', { variant: 'primary', small: true, attrs: { 'data-action': 'back-solvable' } })}${P.spare ? button('Add a tube', { small: true, cls: 'is-quiet', attrs: { 'data-action': 'add-tube' } }) : ''}</div></div>`
    : '';
  return h`${note}<div class="hl">${hl}</div><div class="dt"><span class="pu-goal" style="background:${safeHex(P.hex)}"></span>Your ${P.name} is in here with colors that got mixed in. Tap a tube, then tap where to pour: onto the same color or into an empty tube.${murk}</div>${stuck}`;
}

function updateStatus() {
  if (P.el.status && !P.result && P.entry) P.el.status.innerHTML = String(statusHtml(P.entry.puzzle));
}

/** Other revealed tiers she can restart this batch on. */
function otherTiers() {
  const cur = entryTier(P.entry);
  return TIER_IDS.filter((t) => t !== cur && tierRevealed(t));
}

/**
 * The Murky chip on the board, for this batch only (0.4.1):
 * - Murky with cloudy layers left: tap (then "Tap again") clears the murk in
 *   place; every pour stays and the batch pays the usual amount.
 * - Murky with nothing cloudy left: nothing to clear, the bonus is hers.
 * - Clear: tap starts this batch over Murky ("Tap again" once she has poured).
 * Her choice for new batches is the separate line below (settings.purifyMurky).
 */
function murkyHtml() {
  if (!P.entry || !murkyUnlocked(C, C.game.state)) return '';
  const puz = P.entry.puzzle;
  const on = isMurky(P.entry);
  const armed = P.armed === 'murky';
  const cloudy = on ? C.puzzles.purify.hiddenTotal(puz) : 0;
  let label = '';
  let line;
  let attrs = '';
  if (on && cloudy) {
    label = armed ? 'Clear the murk? Tap again' : '';
    line = 'Tap to clear the cloudy layers now. Your pours stay; this batch then pays the usual amount.';
  } else if (on) {
    line = 'Every layer is clear now. The Murky bonus is yours.';
    attrs = ' disabled';
  } else {
    label = armed ? 'Start over Murky? Tap again' : '';
    line = puz.murkCleared
      ? 'Murk cleared for this batch, so it pays the usual amount. Tap to start it over Murky.'
      : 'Start this batch over with cloudy lower layers. Pays 25% more.';
  }
  const chip = String(murkyChip(on, { action: 'murky-toggle', label }));
  return h`<div class="pz-murkyrow pu-murkyrow">${raw(attrs ? chip.replace('<button ', '<button disabled ') : chip)}<span class="hint">${line}</span></div>`;
}

/** Her remembered choice for new batches (settings.purifyMurky), set apart from this batch. */
function prefHtml() {
  if (!murkyUnlocked(C, C.game.state)) return '';
  const on = purifyMurky(C, C.game.state);
  return h`<div class="pu-pref" data-pref><span class="hint">New batches start ${on ? 'Murky' : 'clear'}.</span>${button(on ? 'Start them clear' : 'Start them Murky', { small: true, cls: 'is-quiet', attrs: { 'data-action': 'murky-pref' } })}</div>`;
}

function switchHtml() {
  const inner = `${murkyHtml()}${tierSwitchHtml()}`;
  if (!inner) return '';
  return `<div class="pu-batch"><div class="cap">This batch</div>${inner}${prefHtml()}</div>`;
}

function tierSwitchHtml() {
  const others = otherTiers();
  if (!others.length) return '';
  const armed = P.armed;
  const lbl = (t) => (armed === t ? `Start over on ${TIER_LABEL[t]}? Tap again` : `Start over on ${TIER_LABEL[t]}`);
  if (others.length === 1) {
    return h`<div class="pu-tierswitch">${button(lbl(others[0]), { cls: 'is-quiet', attrs: { 'data-action': 'restart-tier', 'data-tier': others[0] } })}</div>`;
  }
  return h`<div class="pu-tierswitch"><div class="cap">Start over on</div><div class="seg-control" role="group" aria-label="Start this batch over on">${others.map((t) => h`<button type="button" data-action="restart-tier" data-tier="${t}" data-tap aria-pressed="${armed === t ? 'true' : 'false'}">${armed === t ? 'Tap again' : TIER_LABEL[t]}</button>`)}</div></div>`;
}

function updateTools() {
  const e = P.entry;
  if (!e) return;
  const undo = ROOT.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !e.puzzle.history.length;
  const add = ROOT.querySelector('[data-tools] [data-action="add-tube"]');
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
<div class="titles"><div class="title">Purify</div><div class="subtitle" data-subtitle>${TIER_LABEL[P.tier]}${isMurky(e) ? ' · Murky' : ''} · ${P.name}</div></div>
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
  scheduleCheck();
}

// ---------------------------------------------------------------------------
// Dead ends and "Back to solvable" (0.4.1)
// ---------------------------------------------------------------------------

/** The verdict cache belongs to one puzzle (batch + start time). */
function cacheFor(e) {
  const id = e ? `${e.batchId}|${e.startedAt}|${e.puzzle.tubes.length}` : '';
  if (id !== VFOR) { VCACHE = verdictCache(600); VFOR = id; }
  return VCACHE;
}

/** After every pour, undo or new tube: ask the solver (small node cap, cached by position) whether this shelf is a dead end. */
function scheduleCheck() {
  clearTimeout(P.checkTimer);
  P.checkTimer = setTimeout(checkDead, 0); // after the pour is drawn
}

function checkDead() {
  P.checkTimer = 0;
  const e = P.entry;
  if (!e || !P.visible || P.result || P.celebrating || P.stepping) return;
  const pz = C.puzzles.purify;
  const puz = e.puzzle;
  const cache = cacheFor(e);
  const dead = !pz.isSolved(puz) && pz.verdict(puz, { cache }) === 'dead';
  const spare = dead && canExtra(e) && pz.spareHelps(puz, { cache });
  if (dead !== P.dead || spare !== P.spare) {
    P.dead = dead;
    P.spare = spare;
    updateStatus();
  }
}

const pause = (ms) => new Promise((res) => { if (ms <= 0) res(); else later(res, ms); });

/** Undo, step by step (quick, in sequence), back to the latest shelf the solver does not prove dead. */
async function backToSolvable() {
  const e = P.entry;
  if (!e || P.result || P.celebrating || P.stepping) return;
  const pz = C.puzzles.purify;
  const r = pz.backToSolvable(e.puzzle, { cache: cacheFor(e) });
  if (!r.steps) {
    P.dead = false;
    P.spare = false;
    P.note = 'You\u2019re on track. Every color can still be corked from here.';
    updateStatus();
    return;
  }
  P.stepping = true;
  P.armed = null;
  setSel(null);
  const gap = reduced() ? 0 : Math.max(90, Math.min(170, 900 / r.steps));
  let taken = 0;
  try {
    for (let k = 0; k < r.steps; k++) {
      if (P.entry !== e || !P.visible) break;
      const u = C.game.act(undoAct);
      if (!u || !u.ok) break;
      taken++;
      redrawTube(u.from);
      const back = redrawTube(u.to, { newN: reduced() ? 0 : u.moved });
      if (!reduced()) safe(() => landLayers(back));
      safe(() => C.audio.tick('deselect'));
      P.sig = sigOf(e);
      await pause(gap);
    }
  } finally {
    P.stepping = false;
  }
  if (P.entry !== e) return;
  safe(() => C.haptics.light());
  markCoach();
  P.sig = sigOf(e);
  P.dead = false;
  P.spare = false;
  P.note = `Took back ${taken} ${taken === 1 ? 'pour' : 'pours'}. Every color can be corked from here.`;
  updateStatus();
  updateTools();
  scheduleCheck();
}

/** Clear the murk on this batch, in place: the clouds lift off every hidden layer, every pour stays. */
function clearMurkNow() {
  const e = P.entry;
  const res = C.game.act(clearMurkAct);
  if (!res || !res.ok) return;
  P.armed = null;
  setSel(null);
  const byTube = new Map();
  for (const [i, k] of res.revealed) byTube.set(i, [...(byTube.get(i) || []), k]);
  let n = 0;
  for (const [i, ks] of byTube) redrawTube(i, { cleared: ks, clearDelay: reduced() ? 0 : (n++) * 45 });
  safe(() => C.audio.arpeggio(e.puzzle.colors.slice(0, 4).map((hx) => lightnessOf(C, hx))));
  safe(() => C.haptics.light());
  if (P.murkyGuide) { P.murkyGuide.stop(); P.murkyGuide = null; }
  const keepsMurky = purifyMurky(C, C.game.state);
  P.note = `Cleared the murk. This batch pays the usual amount.${keepsMurky ? ' New batches still start Murky.' : ''}`;
  const sub = ROOT.querySelector('[data-subtitle]');
  if (sub) sub.textContent = `${TIER_LABEL[P.tier]} · ${P.name}`;
  P.sig = sigOf(e);
  markCoach();
  updateStatus();
  updateTools();
  const chip = ROOT.querySelector('[data-action="murky-toggle"]');
  if (chip) safe(() => C.fx.squash(chip));
}

function sigOf(e) {
  return `${e.batchId}|${e.puzzle.moves}|${e.puzzle.history.length}|${e.puzzle.tubes.length}|${P.cb ? 1 : 0}|${entryTier(e)}|${e.puzzle.murky ? 1 : 0}`;
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
    if (o && o.classList.contains('is-sel')) {
      o.classList.remove('is-sel');
      o.removeAttribute('aria-pressed');
      safe(() => C.fx.settle(o)); // put down with the shared 3% overshoot
    }
  }
  P.sel = i;
  if (i !== null) {
    const n = tubeEl(i);
    if (n) {
      n.classList.add('is-sel');
      n.setAttribute('aria-pressed', 'true');
      safe(() => C.fx.lift(n)); // 106% and a grown shadow; the tube itself rises 16 px in CSS
    }
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

/** The pouring tube was held tipped toward its target: it settles back upright (spring soft). */
function tipBack(el, ra, rb) {
  const svg = el && el.querySelector('svg');
  if (!svg || !ra || !rb || reduced()) return;
  const dir = rb.left + rb.width / 2 >= ra.left + ra.width / 2 ? 1 : -1;
  svg.classList.add('is-tipping');
  const done = () => svg.classList.remove('is-tipping');
  const p = C.fx.spring(svg, {
    from: { transform: `translateY(-16px) rotate(${dir * 24}deg)` },
    to: { transform: 'translateY(0px) rotate(0deg)' },
    preset: 'soft',
  });
  if (p && p.then) p.then(done, done); else done();
}

/** New layers drop in with a wobble: spring soft on each layer group, staggered with the stream. */
function landLayers(el) {
  if (!el) return;
  el.querySelectorAll('.pu-layer-new').forEach((g, k) => {
    const d = Number.parseFloat(g.style.getPropertyValue('--d')) || 150 + k * 60;
    C.fx.spring(g, { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' }, preset: 'soft', fill: 'backwards', delay: d });
  });
}

/** The cork drops into the mouth and squashes on contact (spring heavy), as the pop sounds. */
function corkPop(el, atMs) {
  const g = el && el.querySelector('.pu-cork-new');
  if (!g) return;
  C.fx.spring(g, {
    from: { transform: 'translateY(-24px) scale(1.1, 0.9)', opacity: 0 },
    to: { transform: 'translateY(0px) scale(1, 1)', opacity: 1 },
    preset: 'heavy',
    fill: 'backwards',
    delay: Math.max(120, atMs - 160),
  });
}

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
  const hidBefore = hiddenOf(puz, from);
  const hidBeforeTo = hiddenOf(puz, to);
  const ra = svgRect(from); // measured before the tubes are redrawn
  const rb = svgRect(to);
  const res = C.game.act(pourAct, { from, to });
  if (!res || !res.ok) { setSel(null); return; }
  setSel(null);
  // Layers whose cloud lifted with this pour (the new top of the source; a corked tube clears whole).
  const range = (a, b) => { const r = []; for (let k = a; k < b; k++) r.push(k); return r; };
  const clearedFrom = range(hiddenOf(puz, from), Math.min(hidBefore, puz.tubes[from].length));
  const clearedTo = range(hiddenOf(puz, to), hidBeforeTo);
  const fromEl = redrawTube(from, { cleared: clearedFrom });
  const toEl = redrawTube(to, { newN: res.moved, corkNew: res.completedTube, cleared: clearedTo });
  if (clearedFrom.length) safe(() => C.audio.tink(lightnessOf(C, puz.colors[topOf(puz.tubes[from])]), 0.26, 0.16)); // a soft glassy note as the cloud lifts
  markCoach();
  safe(() => streamTo(ra, rb, puz.colors[colorIdx], before + res.moved, res.moved));
  safe(() => tipBack(fromEl, ra, rb));
  safe(() => landLayers(toEl));
  const hex = puz.colors[colorIdx];
  const Lc = lightnessOf(C, hex);
  const hz = clamp(C.color.noteHz(Lc), 247, 523);
  const len = safe(() => C.audio.glug((before + res.moved) / puz.capacity, { fromRatio: before / puz.capacity, layers: res.moved, hz })) || (0.32 + 0.2 * res.moved);
  safe(() => C.haptics.light());
  if (res.completedTube) {
    safe(() => C.audio.note(Lc, len + 0.02, 0.18, 0.8));
    safe(() => C.audio.cork(len + 0.14));
    safe(() => corkPop(toEl, (len + 0.14) * 1000));
    later(() => safe(() => C.haptics.medium()), (len + 0.14) * 1000);
  }
  P.note = '';
  updateStatus();
  updateTools();
  P.sig = sigOf(e);
  if (!res.solved) scheduleCheck();
  if (res.solved && res.reward) {
    P.celebrating = true;
    P.reward = res.reward;
    if (P.guide) { P.guide.stop(); P.guide = null; }
    if (P.murkyGuide) { P.murkyGuide.stop(); P.murkyGuide = null; }
    C.game.act(markGuideSeen, { id: 'purify' }); // she has finished a batch: the coach is done
    later(startCelebration, 440);
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
  later(finalize, 700);
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
<li class="coinline">${iconSvg('coin', { size: 18 })}<span>+<b data-roll>0</b> coins${r.coins > r.bonus + 0.0001 ? ', with jars that did not fit' : ' for sorting it'}${r.murky ? ', with the Murky bonus' : ''}</span></li>
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
  ROOT.querySelectorAll('[data-action="undo"],[data-action="add-tube"],[data-action="restart-tier"],[data-action="murky-toggle"],[data-action="back-solvable"]').forEach((b) => { b.disabled = true; });
  const sw = ROOT.querySelector('[data-tools]');
  if (sw) sw.hidden = true;
  if (cardEl) playReward(cardEl, r);
}

/** The ink stamp lands (fx.stamp), coins fan out to the total as it thunks, and the total rolls up from zero. */
function playReward(cardEl, r) {
  const roll = cardEl.querySelector('[data-roll]');
  const fmt = (v) => coinsText(C, v);
  const finish = () => { if (roll) roll.textContent = fmt(r.coins); };
  if (!roll) return;
  if (!(r.coins > 0)) { finish(); return; }
  const go = () => {
    if (P.result !== r) return;
    const from = cardEl.querySelector('.swatch') || cardEl;
    safe(() => C.fx.coinArc(from, roll, 8, { quiet: false }));
    safe(() => C.fx.rollNumber(roll, 0, r.coins, { ms: 600, format: fmt }));
    later(finish, 700); // exact total even if the roll was cut short
  };
  // The stamp makes contact about 165 ms in; the coins leave right behind it. Reduced motion fades the stamp in.
  safe(() => C.fx.stamp(cardEl, (PURITY_COPY[r.purity] || PURITY_COPY.pure).head, { hold: 450 }));
  later(go, reduced() ? 140 : 190);
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
  return !!p && p.tubes.some((t, i) => t.length === p.capacity - 1 && t.every((c) => c === t[0]) && !C.puzzles.purify.hiddenCount(p, i));
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
  if (P.murkyGuide) { P.murkyGuide.stop(); P.murkyGuide = null; }
  if (!P.entry || !C.guide) return;
  P.guide = C.guide('purify', coachSteps(), { screen: 'purify' });
  P.guide.start();
  // The first Murky board: one short bubble on a cloudy tube.
  if (isMurky(P.entry) && C.puzzles.purify.hiddenTotal(P.entry.puzzle) > 0) {
    P.murkyGuide = C.guide('purify-murky', [
      { anchor: '[data-coach="purify-murky"]', text: 'Cloudy layers clear up for good once they reach the top.', endsOn: 'got-it' },
    ], { screen: 'purify' });
    P.murkyGuide.start();
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function tapTube(i) {
  if (P.celebrating) { skip(); return; }
  if (P.result || P.stepping || !P.entry || !Number.isInteger(i)) return;
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
  if (P.stepping) return;
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
      P.note = '';
      updateStatus();
      updateTools();
      scheduleCheck();
    }
  } else if (act === 'back-solvable') {
    backToSolvable();
  } else if (act === 'murky-pref') {
    if (!murkyUnlocked(C, C.game.state)) return;
    const on = !purifyMurky(C, C.game.state);
    C.game.act((s, args) => C.sim.setSetting(s, { key: 'purifyMurky', value: args.on }), { on });
    updateTools();
  } else if (act === 'add-tube') {
    if (!P.entry || P.result) return;
    const r = C.game.act(addTubeAct);
    if (r && r.ok) {
      safe(() => C.audio.tick('select'));
      P.dead = false;
      P.spare = false;
      P.note = '';
      drawAll();
    }
  } else if (act === 'restart-tier') {
    if (!P.entry || P.result) return;
    const tier = a.dataset.tier;
    if (!TIER_IDS.includes(tier) || !tierRevealed(tier)) return;
    if (P.entry.puzzle.moves > 0 && P.armed !== tier) { P.armed = tier; updateTools(); return; }
    const batchId = P.entry.batchId;
    C.game.act((s, args, now) => createPurifyPuzzle(C, s, args, now), { batchId, tier, murky: isMurky(P.entry) });
    P.entry = activeOf(C.game.state).purify || null;
    resetBoardState();
    drawAll();
    startCoach();
  } else if (act === 'murky-toggle') {
    if (!P.entry || P.result || !murkyUnlocked(C, C.game.state)) return;
    if (isMurky(P.entry)) {
      // Murky off for this batch, in place (0.4.1): nothing restarts, every pour stays.
      if (!C.puzzles.purify.hiddenTotal(P.entry.puzzle)) return;
      if (P.armed !== 'murky') { P.armed = 'murky'; updateTools(); return; }
      clearMurkNow();
      return;
    }
    // Murky on: this batch starts over Murky (a confirm once she has poured). Her
    // choice for new batches stays as it is (the line below the chip sets that).
    if (P.entry.puzzle.moves > 0 && P.armed !== 'murky') { P.armed = 'murky'; updateTools(); return; }
    const batchId = P.entry.batchId;
    const tier = entryTier(P.entry);
    C.game.act((s, args, now) => createPurifyPuzzle(C, s, args, now), { batchId, tier, murky: true });
    P.entry = activeOf(C.game.state).purify || null;
    resetBoardState();
    drawAll();
    startCoach();
    const chip = ROOT.querySelector('[data-action="murky-toggle"]');
    if (chip) safe(() => C.fx.squash(chip));
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
    resetBoardState();
    drawAll();
    startCoach();
  }
}

/** A new board: no note, no stuck card until the check says so. */
function resetBoardState() {
  clearTimeout(P.checkTimer);
  P.checkTimer = 0;
  P.note = '';
  P.dead = false;
  P.spare = false;
  P.stepping = false;
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
    root.addEventListener('pointerdown', () => { if (P.celebrating) skip(); }, true); // any tap skips the celebration
    window.addEventListener('resize', relayout);
  },

  show(params = {}) {
    P.visible = true;
    clearTimers();
    if (P.result && !params.batchId && !(activeOf(C.game.state).purify)) return; // back from a ceremony: keep the result card
    P.result = null;
    P.celebrating = false;
    resetBoardState();
    P.entry = adopt(params);
    drawAll();
    startCoach();
  },

  hide() {
    P.visible = false;
    clearTimers();
    P.celebrating = false;
    P.result = null;
    resetBoardState();
    if (P.guide) { P.guide.stop(); P.guide = null; }
    if (P.murkyGuide) { P.murkyGuide.stop(); P.murkyGuide = null; }
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
    if (P.stepping) return;
    if (e !== P.entry || cb !== P.cb || (e && sigOf(e) !== P.sig)) {
      if (e !== P.entry) resetBoardState();
      P.entry = e;
      drawAll();
    }
  },
};
