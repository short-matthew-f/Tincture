/**
 * workshop.js: the Workshop home screen (screen id `workshop`).
 *
 * Owns: the sticky HUD (title, coin pill with rolling number and rate, settings
 * gear, flow meter + its one suggested upgrade), the live workshop scene (ported
 * from docs/prototypes/Main.dc.html: map window, corkboard, three display vats,
 * merge shelf, mixing bench, Gallery door, plus a calendar, ledger book,
 * commissions scroll and loading yard), the Collect button, the "Almost there"
 * card, the stations panel (Sources, Grinders, Mixers, Vats, Cellar, Shop,
 * Fleet), the next-room card, the apprentices card and "Close up shop".
 * Implements docs/UI-CONTRACT.md and DESIGN.md "The factory", "Storage and
 * shipping > The flow meter", "Light active hooks", "Stopping points".
 *
 * Rendering: a stable DOM skeleton is built once in mount(). render(state) only
 * patches text/attributes in place, and rebuilds a section's innerHTML when that
 * section's signature changed (never while a pointer is down, so taps are not
 * lost). Every dynamic string goes through kit.h (escaped).
 *
 * Sheets (recipe picker, vat color, shipping, close-up confirm) are drawn inside
 * this screen's own <section> with `openSheet`, so they do not depend on the
 * app-level modal. `openSheet` and `closeUpFlow` are exported for ledger.js.
 *
 * data-action names used here: settings, collect, suggestion, open-map,
 * open-album, open-shelf, open-bench, open-gallery, open-quests, open-ledger,
 * open-commissions, open-yard, claim-accident, vat-color, toggle-panel, buy,
 * buy-grinder-kind, mixer-recipe, rush, buy-room, buy-apprentice,
 * steward-toggle, fleet-ship, fleet-route, buy-vehicle, almost, close-up,
 * close-up-reopen, locked.
 * data-coach targets: flow-meter (on the big suggestion button, which is always the
 * buyable one when anything is affordable), vats, shelf, map-window, gallery-door, mill-room,
 * close-up (plus bench, calendar, ledger-book, collect, loading-yard).
 */

import {
  h, raw, button, iconSvg, swatch, escapeHtml, lighten, safeHex, vatSvg, tag,
} from './kit.js';
import defaultFx from './fx.js';
import defaultAudio from './audio.js';
import defaultHaptics from './haptics.js';
import { ROOMS } from '../content/rooms.js';
import {
  GRINDER_KINDS_BY_ID, VEHICLES, VEHICLES_BY_ID, RUSH_COOLDOWN_MS, MIXER,
} from '../content/stations.js';
import { SOURCES_BY_ID, MAX_SOURCES_ERA1 } from '../content/sources.js';
import { APPRENTICES } from '../content/apprentices.js';
import { ROUTES_BY_ID } from '../content/routes.js';
import { getPigment } from '../content/pigments.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const doc = () => (typeof document !== 'undefined' ? document : null);
const A = (obj) => raw(Object.entries(obj).filter(([, v]) => v !== false && v != null)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`)).join(''));
const clamp01 = (x) => Math.max(0, Math.min(1, num(x)));
const cap1 = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const NEUTRAL = '#B7BDB3';

const ENTRY_COLORS = 8; // containers drawn on the scene's merge shelf

/**
 * A wait, never in seconds: "43 m", "15 h 24 m", or "under a minute". Rounds up
 * to the next whole minute so a countdown only changes once a minute.
 */
export function waitText(format, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'a moment';
  if (ms <= 60e3) return 'under a minute';
  return format.duration(Math.ceil(ms / 60e3) * 60e3);
}

// ---------------------------------------------------------------------------
// Styles (injected once; shared with ledger.js)
// ---------------------------------------------------------------------------

export function ensureStyles() {
  const d = doc();
  if (!d || d.getElementById('ws-style')) return;
  const s = d.createElement('style');
  s.id = 'ws-style';
  s.textContent = `
.ws-head { flex-direction: column; align-items: stretch; gap: 10px; padding-bottom: 10px; }
.ws-top { display: flex; align-items: center; gap: 10px; }
.ws-title { flex: 1 1 auto; min-width: 0; font-family: var(--font-display); font-weight: 400; font-size: 21px; line-height: 1.15; letter-spacing: .2px; }
.ws-pill { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 12px 4px 8px; border-radius: 999px; background: var(--paper); box-shadow: 0 2px 0 var(--shadow); }
.ws-pill .v { font-weight: 700; font-size: 16px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.ws-pill .r { font-size: 11px; line-height: 1.1; color: var(--ink-soft); }
.ws-gear { position: relative; }
.ws-dot { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--walnut); box-shadow: 0 0 0 2px var(--paper); }
.ws-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 10px; background: linear-gradient(var(--plaster), rgba(227,230,224,0)); pointer-events: none; }
.btn.ws-sugg { min-height: 48px; width: 100%; padding: 0 14px; }
.btn.ws-sugg[data-state="wait"] { background-color: var(--paper); color: var(--ink); box-shadow: var(--cut-sm); background-image: linear-gradient(90deg, rgba(226,176,74,.5) var(--p, 0%), rgba(226,176,74,0) var(--p, 0%)); }
.btn.ws-sugg[aria-disabled="true"] { opacity: 1; }
.ws-next { margin-top: -4px; font-size: 12px; line-height: 1.25; color: var(--ink-soft); text-align: center; }
.ws-head .seg-value { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-head .meter > .seg { padding: 8px 6px 8px 8px; }
.ws-tagpin { position: absolute; transform: translate(-50%, -50%); pointer-events: none; line-height: 1.1; }
.ws-tagpin.l { transform: translate(0, -50%); }
.ws-tagpin.ws-off { display: none; }
.ws-lbl { font-family: 'Figtree', system-ui, sans-serif; font-size: 10px; font-weight: 600; fill: #5E5148; pointer-events: none; }
.ws-body { gap: 12px; }
.ws-scene { position: relative; margin: 0 calc(-1 * var(--gutter)); line-height: 0; }
.ws-svg { width: 100%; height: auto; display: block; }
.ws-hit { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.ws-hit:active { transform: translateY(2px); }
.ws-hit:focus-visible > .ws-focus { stroke: var(--ink); stroke-width: 3; }
.ws-focus { fill: transparent; stroke: transparent; }
.ws-off { display: none; }
.ws-glow { animation: ws-glow 2.4s ease-in-out infinite; }
@keyframes ws-glow { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.ws-twinkle { animation: ws-twinkle 2.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes ws-twinkle { 0%, 100% { opacity: .5; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.1); } }
.ws-collect { min-height: 52px; font-size: 16px; gap: 8px; }
[data-screen="workshop"] .btn.small, .ws-sheet .btn.small { min-height: 44px; }
[data-screen="workshop"] .card > .card-title { font-family: var(--font-ui); font-weight: 600; font-size: 15px; }
.ws-panel { padding: 8px 14px; gap: 0; }
.ws-panel-head { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; text-align: left; }
.ws-panel-head .t { font-family: var(--font-ui); font-weight: 600; font-size: 15px; }
.ws-panel-head .s { margin-left: auto; font-size: 13px; color: var(--ink-soft); text-align: right; }
.ws-chev { transform: rotate(180deg); transition: transform 160ms var(--ease-out); color: var(--ink-soft); }
.ws-panel.open .ws-chev { transform: rotate(-90deg); }
.ws-rows { display: flex; flex-direction: column; }
.ws-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px dashed #CFC6B8; }
.ws-row .ws-lead { flex: 0 0 auto; display: flex; }
.ws-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ws-main .ws-t { font-size: 15px; font-weight: 600; line-height: 1.2; }
.ws-main .ws-t .ws-loan { margin-left: 6px; vertical-align: 2px; }
.ws-main .ws-s { font-size: 13px; color: var(--ink-soft); }
.ws-main .ws-hint { font-size: 12px; color: var(--walnut); }
.ws-actions { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; align-items: stretch; min-width: 84px; }
.ws-buy { flex-direction: column; gap: 1px; padding: 4px 10px; font-size: 12px; }
.ws-buy .l { font-size: 12px; font-weight: 600; }
.ws-buy .c { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ws-pickbtn { display: flex; align-items: center; justify-content: center; gap: 10px; text-align: left; min-width: 44px; min-height: 44px; }
.ws-claim { width: 100%; margin-top: 6px; }
.ws-sub-title { font-family: var(--font-ui); font-weight: 600; font-size: 14px; margin-top: 8px; color: var(--ink-soft); }
.ws-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ws-almost-row { display: flex; align-items: center; gap: 10px; min-height: 44px; width: 100%; text-align: left; font-size: 14px; }
.ws-almost-row .sw { width: 14px; height: 14px; border-radius: 4px; flex: 0 0 auto; }
.ws-closed { background: var(--walnut-deep); color: var(--paper); box-shadow: 0 3px 0 rgba(0,0,0,.6); }
.ws-sheet-wrap { position: absolute; inset: 0; z-index: 30; display: flex; align-items: flex-end; justify-content: center; }
.ws-sheet-back { position: absolute; inset: 0; background: rgba(42, 38, 34, .45); animation: fade-in 160ms ease-out both; }
.ws-sheet { position: relative; z-index: 1; overflow: hidden; }
.ws-sheet-foot { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; }
.ws-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ws-sheet-title { font-family: var(--font-ui); font-weight: 700; font-size: 20px; line-height: 1.15; }
.ws-sheet-body { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; }
.ws-pick { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 6px 8px; border-radius: 12px; background: var(--paper); box-shadow: var(--cut-sm); text-align: left; }
.ws-pick:active { transform: translateY(2px); box-shadow: var(--cut-press); }
.ws-pick.is-on { box-shadow: 0 0 0 2px var(--ink), var(--cut-sm); }
.ws-pick .pt { font-size: 15px; font-weight: 600; line-height: 1.2; }
.ws-pick .ps { font-size: 13px; color: var(--ink-soft); }
.ws-banner { padding: 8px 12px; border-radius: 10px; background: var(--glow); color: var(--glow-ink); box-shadow: 0 0 0 2px var(--glow-ring); font-size: 14px; font-weight: 600; }
.ws-stepper { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.ws-stepper .n { min-width: 34px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.ws-step { width: 44px; height: 44px; border-radius: 12px; background: var(--paper); box-shadow: 0 2px 0 var(--shadow); font-size: 20px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
.ws-step:active { transform: translateY(2px); }
.ws-step[aria-disabled="true"] { opacity: .4; }
.ws-actions-row { display: flex; gap: 10px; }
.ws-actions-row > .btn { flex: 1 1 0; }
.ws-dusk { position: absolute; inset: 0; z-index: 45; pointer-events: none; background: rgba(42, 38, 34, .38); animation: ws-dusk 1.5s ease-in-out both; display: flex; align-items: center; justify-content: center; }
.ws-dusk .shutter { position: absolute; left: 0; right: 0; top: 0; height: 34%; background: repeating-linear-gradient(#8A6A4C 0 14px, #6F5238 14px 16px); box-shadow: 0 4px 0 rgba(0,0,0,.35); animation: ws-shut 1.3s ease-in-out both; }
.ws-dusk .cap { position: relative; padding: 10px 18px; border-radius: 999px; background: var(--paper); font-weight: 600; font-size: 16px; box-shadow: var(--cut); }
@keyframes ws-dusk { 0% { background: rgba(42,38,34,0); } 30%, 80% { background: rgba(42,38,34,.38); } 100% { background: rgba(42,38,34,0); } }
@keyframes ws-shut { 0% { height: 0; } 70%, 100% { height: 34%; } }
.ws-switch-row { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.ws-switch-row .switch { position: relative; }
.ws-switch-row .switch::after { content: ''; position: absolute; inset: -8px -6px; }
.ws-need { font-size: 13px; color: var(--ink-soft); }
`;
  d.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Sheets (drawn inside a host <section>; exported for ledger.js)
// ---------------------------------------------------------------------------

/**
 * openSheet(host, {title, html, onAction, onClose}) -> {el, body, set(html), close()}.
 * A bottom sheet inside `host` (an absolutely positioned screen). Clicks on
 * [data-action] elements inside call onAction(name, element, event); clicks on
 * [data-sheet-close] (backdrop, close button) or Escape close it. Clicks are
 * stopped from bubbling so the host's own delegated handler never sees them.
 */
export function openSheet(host, { title = '', html = '', footer = '', onAction = null, onClose = null, closeButton = true } = {}) {
  const d = doc();
  const wrap = d.createElement('div');
  wrap.className = 'ws-sheet-wrap';
  wrap.innerHTML = String(h`<div class="ws-sheet-back" data-sheet-close></div>
<div class="sheet ws-sheet" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
<div class="ws-sheet-head"><div class="ws-sheet-title">${title}</div>
${closeButton ? h`<button type="button" class="btn-back" data-sheet-close data-tap aria-label="Close">${iconSvg('close', { size: 18 })}</button>` : ''}</div>
<div class="ws-sheet-body"></div><div class="ws-sheet-foot"></div></div>`);
  const body = wrap.querySelector('.ws-sheet-body');
  const panel = wrap.querySelector('.ws-sheet');
  body.innerHTML = String(html);
  const foot = wrap.querySelector('.ws-sheet-foot');
  foot.innerHTML = String(footer);
  foot.hidden = !footer;
  const previous = d.activeElement;
  let closed = false;
  const api = {
    el: wrap,
    body,
    set(next, nextFooter) {
      const top = body.scrollTop;
      body.innerHTML = String(next);
      body.scrollTop = top;
      if (nextFooter !== undefined) { foot.innerHTML = String(nextFooter); foot.hidden = !nextFooter; }
    },
    close() {
      if (closed) return;
      closed = true;
      wrap.remove();
      d.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus && d.contains(previous)) { try { previous.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (onClose) onClose();
    },
  };
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } }
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-sheet-close]')) { api.close(); return; }
    const a = e.target.closest('[data-action]');
    if (a && wrap.contains(a) && onAction) onAction(a.dataset.action, a, e);
  });
  d.addEventListener('keydown', onKey, true);
  host.appendChild(wrap);
  try { panel.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  return api;
}

/** The 1.5 s "lights dim, shutters lower" moment over `host`. */
function playDusk(host, fx) {
  const d = doc();
  const o = d.createElement('div');
  o.className = 'ws-dusk';
  o.innerHTML = '<div class="shutter"></div><div class="cap">Lights dim, shutters lower</div>';
  host.appendChild(o);
  if (fx && fx.dim) fx.dim(true);
  return new Promise((resolve) => setTimeout(() => {
    o.remove();
    if (fx && fx.dim) fx.dim(false);
    resolve();
  }, 1500));
}

/**
 * closeUpFlow(ctx, host) -> Promise<{fillMs, huntersSent, mixersQueued} | null>.
 * The shared "Close up shop" ritual: confirm sheet, closeUpShop, evening chord,
 * a 1.5 s dim. Resolves null when she chooses "Not yet".
 */
export function closeUpFlow(ctx, host) {
  const sim = ctx.sim;
  const fx = ctx.fx || defaultFx;
  const audio = ctx.audio || defaultAudio;
  const st = ctx.game.state;
  const idle = sim.hunters.unlocked(st) ? sim.hunters.idleHunters(st).length : 0;
  const empty = (st.stations.mixers || []).filter((m) => m && !m.recipe).length;
  const fillMs = sim.storage.fillTimeMs(st);
  const lines = [];
  if (idle) lines.push(`${idle === 1 ? 'Your hunter heads' : `${idle} hunters head`} out on an overnight trip.`);
  if (empty) lines.push(`${empty === 1 ? 'An idle mixer gets' : `${empty} idle mixers get`} a recipe.`);
  lines.push(Number.isFinite(fillMs) && fillMs > 0
    ? `Your vats fill in about ${waitText(ctx.format, fillMs)}.`
    : 'Everything is set for tomorrow.');
  return new Promise((resolve) => {
    let chosen = false;
    const sheet = openSheet(host, {
      title: 'Close up shop?',
      closeButton: false,
      html: String(h`<div class="stack stack-sm">${lines.map((l) => h`<div class="muted">${l}</div>`)}</div>
<div class="ws-actions-row mt-2">
${button('Not yet', { attrs: { 'data-action': 'cu-cancel' } })}
${button('Close up shop', { variant: 'primary', attrs: { 'data-action': 'cu-go' } })}
</div>`),
      onAction(name) {
        if (name === 'cu-cancel') { sheet.close(); return; }
        if (name !== 'cu-go' || chosen) return;
        chosen = true;
        sheet.close();
        const res = ctx.game.act(sim.closeUp.closeUpShop);
        audio.evening();
        (ctx.haptics || defaultHaptics).soft();
        playDusk(host, fx).then(() => resolve(res || { fillMs: sim.storage.fillTimeMs(ctx.game.state) }));
      },
      onClose() { if (!chosen) resolve(null); },
    });
  });
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let refs = {};
let visible = false;
let pointerDown = false;
let dirty = false;
let flushTimer = 0;
let ticker = 0;
let coinShown = null;
let coinHold = false;
let sheet = null;                 // {api, kind, ...params}
let closedInfo = null;            // {fillMs} after "Close up shop" this session
let almostCache = { at: -1e9, items: [] };
const sigs = {};
const vatKeys = ['', '', ''];
const PANEL_KEY = 'tincture.workshop.panels';
const openPanels = new Set(loadPanels());

function loadPanels() {
  try {
    const raw0 = localStorage.getItem(PANEL_KEY);
    if (raw0) return JSON.parse(raw0);
  } catch (e) { /* ignore */ }
  return ['sources', 'mixers'];
}
function savePanels() {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify([...openPanels])); } catch (e) { /* ignore */ }
}

const S = () => ctx.game.state;
const now = () => ctx.game.now();
const sim = () => ctx.sim;
const eco = () => ctx.sim.economy;
const fmt = (n) => ctx.format.num(n);
/** Per-second rates: small ones keep two decimals so a 0.04 jars/s shop never reads "0". */
const fmtRate = (n) => (Number.isFinite(n) && n > 0 && n < 0.1 ? n.toFixed(2) : fmt(n));
const fx = () => ctx.fx || defaultFx;
const audio = () => ctx.audio || defaultAudio;
const haptics = () => ctx.haptics || defaultHaptics;
const toast = (text, o) => { if (ctx.toast) ctx.toast(text, o); };
const act = (fn, args) => ctx.game.act(fn, args);
const hexOf = (id) => eco().colorHex(id);
const nameOf = (id) => sim().displayName(S(), id);

// ---------------------------------------------------------------------------
// Static markup
// ---------------------------------------------------------------------------

const GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><path d="M12 3 V5.5 M12 18.5 V21 M3 12 H5.5 M18.5 12 H21 M5.6 5.6 L7.4 7.4 M16.6 16.6 L18.4 18.4 M18.4 5.6 L16.6 7.4 M7.4 16.6 L5.6 18.4"/></svg>';

const SHELF_SLOTS = [
  [264, 166, 10, 26, 5, '#8FA77A'], [280, 166, 10, 26, 5, '#8FA77A'], [298, 170, 22, 22, 5, '#D98A8F'],
  [328, 162, 28, 30, 7, '#3E6A9E'], [264, 214, 10, 26, 5, '#E2B04A'], [282, 210, 26, 30, 7, '#B8433A'],
  [318, 214, 10, 26, 5, '#6E4A7E'], [336, 214, 10, 26, 5, '#6E4A7E'],
];

/** A hung paper tag over the scene (an HTML kit.tag, positioned in the 390 x 440 scene's percent space). */
function tagPin(key, x, y, anchor = 'c') {
  return `<span class="ws-tagpin ws-off${anchor === 'l' ? ' l' : ''}" data-tag="${key}" style="left:${(x / 390 * 100).toFixed(2)}%;top:${(y / 440 * 100).toFixed(2)}%"></span>`;
}

function hit(x, y, w, hgt) {
  return `<rect class="ws-focus" x="${x}" y="${y}" width="${w}" height="${hgt}" rx="8"/>`;
}

function sceneSvg() {
  const vats = [0, 1, 2].map((i) => {
    const bx = 38 + i * 66;
    return `<g class="ws-hit" data-action="vat-color" data-vat="${i}" data-tap role="button" tabindex="0" aria-label="Vat ${i + 1}: choose a color">
<g data-vat-art="${i}" transform="translate(${bx - 6} 138)"></g>${hit(bx - 4, 138, 58, 112)}</g>`;
  }).join('');
  const labels = [0, 1, 2].map((i) => {
    const cx = 65 + i * 66;
    return `<rect data-vat-plate="${i}" x="${cx - 30}" y="264" width="60" height="18" rx="3" fill="#F7F4EC" filter="url(#ws-cut)"/>
<text data-vat-label="${i}" x="${cx}" y="277" text-anchor="middle" fill="#2A2622" style="font-family:'Young Serif',Georgia,serif;font-size:10px">&#8203;</text>`;
  }).join('');
  const shelfSlots = SHELF_SLOTS.map(([x, y, w, hh, rx, fill], i) => `<rect data-shelf-slot="${i}" data-default="${fill}" x="${x}" y="${y}" width="${w}" height="${hh}" rx="${rx}" fill="${fill}"/>`).join('');
  return `<svg class="ws-svg" viewBox="0 0 390 440" role="group" aria-label="The workshop: map window, postcard board, display vats, merge shelf, mixing bench and the Gallery door">
<defs><filter id="ws-cut" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2.5" stdDeviation="0.4" style="flood-color:#2A2622;flood-opacity:0.25"/></filter></defs>
<rect x="0" y="0" width="390" height="440" fill="#E3E6E0"/>
<rect x="0" y="0" width="390" height="16" fill="#D3D8D0"/>
<rect x="0" y="360" width="390" height="80" fill="#9A6A47"/>
<rect x="0" y="360" width="390" height="6" fill="#7B5236"/>
<rect x="0" y="392" width="390" height="2" fill="#86593A"/>
<rect x="0" y="420" width="390" height="2" fill="#86593A"/>

<g class="ws-hit" data-action="open-map" data-coach="map-window" data-tap role="button" tabindex="0" aria-label="Map window: send hunters out">
<g filter="url(#ws-cut)">
<rect x="18" y="26" width="128" height="104" rx="8" fill="#7B5236"/>
<rect x="26" y="34" width="112" height="88" rx="4" fill="#CFE0E2"/>
<circle cx="112" cy="58" r="11" fill="#E2B04A"/>
<path d="M26 98 C50 76 72 80 92 92 C108 84 124 82 138 90 L138 122 L26 122 Z" fill="#8FA77A"/>
<path d="M26 108 C48 96 74 100 100 112 C116 106 128 106 138 110 L138 122 L26 122 Z" fill="#6E8B5E"/>
<rect x="80" y="34" width="4" height="88" fill="#7B5236"/>
<rect x="26" y="76" width="112" height="4" fill="#7B5236"/>
</g>${hit(18, 26, 128, 104)}</g>

<g class="ws-hit" data-action="open-quests" data-coach="calendar" data-tap role="button" tabindex="0" aria-label="Calendar: daily quests">
<g filter="url(#ws-cut)" transform="translate(156 38)">
<rect x="0" y="0" width="36" height="46" rx="3" fill="#F7F4EC"/>
<rect x="0" y="0" width="36" height="11" rx="3" fill="#7B5236"/>
<circle cx="9" cy="3" r="2" fill="#F7F4EC"/><circle cx="27" cy="3" r="2" fill="#F7F4EC"/>
<g fill="#B7BDB3"><rect x="5" y="17" width="5" height="5" rx="1"/><rect x="15" y="17" width="5" height="5" rx="1"/><rect x="25" y="17" width="5" height="5" rx="1"/><rect x="5" y="26" width="5" height="5" rx="1"/><rect x="25" y="26" width="5" height="5" rx="1"/><rect x="5" y="35" width="5" height="5" rx="1"/><rect x="15" y="35" width="5" height="5" rx="1"/></g>
<rect x="15" y="26" width="5" height="5" rx="1" fill="#2A2622"/>
</g>
<circle data-badge="quests" class="ws-off" cx="194" cy="40" r="5" fill="#7B5236" stroke="#F7F4EC" stroke-width="2"/>
<text class="ws-lbl" x="174" y="100" text-anchor="middle">Quests</text>
<rect class="ws-focus" x="148" y="34" width="48" height="72" rx="6"/></g>

<g class="ws-hit" data-action="open-commissions" data-coach="commissions" data-tap role="button" tabindex="0" aria-label="Commissions: jobs from patrons">
<g filter="url(#ws-cut)" transform="translate(205 40)">
<rect x="0" y="0" width="26" height="6" rx="3" fill="#7B5236"/>
<rect x="2" y="5" width="22" height="36" fill="#F7F4EC"/>
<rect x="0" y="40" width="26" height="6" rx="3" fill="#7B5236"/>
<rect x="6" y="12" width="14" height="2" fill="#B7BDB3"/><rect x="6" y="18" width="14" height="2" fill="#B7BDB3"/><rect x="6" y="24" width="9" height="2" fill="#B7BDB3"/>
<circle cx="18" cy="32" r="4" fill="#C99A2E"/>
</g><text class="ws-lbl" x="218" y="100" text-anchor="middle">Jobs</text>${hit(196, 34, 44, 72)}</g>

<g class="ws-hit" data-action="open-album" data-coach="corkboard" data-tap role="button" tabindex="0" aria-label="Postcard board: your album">
<g filter="url(#ws-cut)">
<rect x="236" y="28" width="134" height="96" rx="6" fill="#B98E64"/>
<rect x="242" y="34" width="122" height="84" rx="3" fill="#C9A277"/>
<g transform="rotate(-6 268 72)"><rect x="248" y="48" width="42" height="50" rx="2" fill="#F7F4EC"/><rect x="252" y="52" width="34" height="22" fill="#3E6A9E"/><rect x="252" y="64" width="34" height="10" fill="#7FA9C9"/></g>
<g transform="rotate(4 312 70)"><rect x="292" y="44" width="42" height="50" rx="2" fill="#F7F4EC"/><rect x="296" y="48" width="34" height="22" fill="#8FA77A"/><rect x="296" y="62" width="34" height="8" fill="#D39B2A"/></g>
<g transform="rotate(-2 346 80)"><rect x="330" y="58" width="30" height="40" rx="2" fill="#F7F4EC"/><rect x="333" y="61" width="24" height="16" fill="#6E4A7E"/></g>
<circle cx="269" cy="50" r="3" fill="#B8433A"/><circle cx="313" cy="46" r="3" fill="#3E6A9E"/><circle cx="345" cy="60" r="3" fill="#D39B2A"/>
</g>${hit(240, 28, 130, 96)}</g>

<g data-coach="vats" filter="url(#ws-cut)">${vats}
<rect x="14" y="248" width="222" height="12" rx="3" fill="#7B5236"/>
</g>

<g class="ws-hit" data-action="open-shelf" data-coach="shelf" data-tap role="button" tabindex="0" aria-label="Merge shelf">
<g filter="url(#ws-cut)">
<rect x="250" y="146" width="122" height="104" rx="6" fill="#7B5236"/>
<rect x="256" y="152" width="110" height="44" rx="2" fill="#5E3E28"/>
<rect x="256" y="200" width="110" height="44" rx="2" fill="#5E3E28"/>
${shelfSlots}
</g>
<path data-shelf-hint class="ws-off ws-twinkle" d="M269 210 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z" fill="#FFF3C4"/>
${hit(250, 146, 122, 104)}</g>

<g class="ws-hit" data-action="open-bench" data-coach="bench" data-tap role="button" tabindex="0" aria-label="Mixing bench">
<g filter="url(#ws-cut)">
<rect x="14" y="306" width="230" height="14" rx="3" fill="#7B5236"/>
<rect x="26" y="320" width="12" height="44" fill="#6A4630"/>
<rect x="220" y="320" width="12" height="44" fill="#6A4630"/>
<path d="M54 254 L146 254 L140 300 C138 306 62 306 60 300 Z" fill="#B87333"/>
<ellipse data-bench-paint cx="100" cy="254" rx="46" ry="9" fill="#DE7A2E"/>
<path data-bench-wave d="M70 254 C84 248 96 260 112 252 C122 248 128 252 132 254" fill="none" stroke="#F2A55E" style="stroke-width:3"/>
<rect x="56" y="270" width="88" height="5" fill="#995F2A"/>
<path d="M170 300 C170 278 210 278 210 300 Z" fill="#B9B3A8"/>
<rect x="198" y="258" width="7" height="34" rx="3" transform="rotate(28 201 275)" fill="#8E877C"/>
</g>${hit(14, 250, 192, 114)}</g>
${labels}

<g data-accident class="ws-off ws-glow" pointer-events="none">
<path d="M150 224 l3 -9 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 z" fill="#FFF3C4"/>
<path d="M44 236 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z" fill="#FFF3C4"/>
</g>
<g class="ws-hit ws-off" data-pill="accident" data-action="claim-accident" data-mixer="0" data-tap role="button" tabindex="0" aria-label="A happy accident is waiting: tap to claim">
<g filter="url(#ws-cut)"><rect x="104" y="208" width="66" height="26" rx="13" fill="#F7F4EC"/></g>
<text data-pill-text x="137" y="225" fill="#2A2622" text-anchor="middle" style="font-size:11px;font-weight:600;font-family:'Figtree',system-ui,sans-serif">Tap to claim</text>
<rect class="ws-focus" x="100" y="204" width="74" height="34" rx="14"/></g>

<g class="ws-hit" data-action="open-ledger" data-coach="ledger-book" data-tap role="button" tabindex="0" aria-label="Morning Ledger">
<g filter="url(#ws-cut)" transform="translate(214 288)">
<rect x="0" y="0" width="26" height="18" rx="2" fill="#F7F4EC"/>
<rect x="0" y="0" width="4" height="18" rx="1" fill="#5E3E28"/>
<rect x="8" y="5" width="14" height="2" fill="#B7BDB3"/><rect x="8" y="10" width="10" height="2" fill="#B7BDB3"/>
<path d="M20 0 V10 L22 8 L24 10 V0 Z" fill="#7B5236"/>
</g>
<circle data-badge="ledger" class="ws-off" cx="240" cy="289" r="5" fill="#7B5236" stroke="#F7F4EC" stroke-width="2"/>
<rect class="ws-focus" x="208" y="270" width="40" height="38" rx="6"/></g>

<g class="ws-hit" data-action="open-gallery" data-coach="gallery-door" data-tap role="button" tabindex="0" aria-label="Gallery door">
<g filter="url(#ws-cut)">
<path d="M270 360 L270 300 C270 272 290 258 316 258 C342 258 362 272 362 300 L362 360 Z" fill="#6A4630"/>
<path d="M280 360 L280 302 C280 280 296 268 316 268 C336 268 352 280 352 302 L352 360 Z" fill="#8A5E40"/>
<path d="M298 296 C298 284 306 278 316 278 C326 278 334 284 334 296 L334 312 L298 312 Z" fill="#2A2622"/>
<path d="M300 296 C300 286 307 281 315 280 L315 310 L300 310 Z" fill="#3E6A9E"/>
<path d="M317 280 C325 281 332 286 332 296 L332 310 L317 310 Z" fill="#D39B2A"/>
<circle cx="344" cy="330" r="4" fill="#E2B04A"/>
<rect x="282" y="232" width="68" height="22" rx="3" fill="#F7F4EC"/>
</g>
<text x="316" y="247" fill="#2A2622" text-anchor="middle" style="font-family:'Young Serif',Georgia,serif;font-size:12px">Gallery</text>
${hit(270, 232, 92, 128)}</g>

<g class="ws-hit" data-action="open-yard" data-coach="loading-yard" data-tap role="button" tabindex="0" aria-label="Loading yard: ship your colors">
<g filter="url(#ws-cut)">
<rect x="36" y="360" width="22" height="18" rx="2" fill="#C9A277"/>
<rect x="36" y="368" width="22" height="2" fill="#A87449"/>
<rect x="62" y="365" width="20" height="13" rx="2" fill="#B98E64"/>
<rect x="30" y="378" width="62" height="20" rx="3" fill="#7B5236"/>
<rect x="30" y="384" width="62" height="2" fill="#5E3E28"/>
<path d="M92 384 L112 372" stroke="#5E3E28" style="stroke-width:3;stroke-linecap:round" fill="none"/>
<circle cx="46" cy="402" r="9" fill="#5E3E28"/><circle cx="46" cy="402" r="3.5" fill="#B98E64"/>
<circle cx="78" cy="402" r="9" fill="#5E3E28"/><circle cx="78" cy="402" r="3.5" fill="#B98E64"/>
</g>${hit(24, 356, 96, 62)}</g>

</svg>${tagPin('map', 82, 130)}${tagPin('shelf', 311, 146)}${tagPin('gallery', 316, 332)}${tagPin('yard', 26, 426, 'l')}${tagPin('commissions', 218, 118)}`;
}

function shell() {
  return String(h`
<div class="screen-head ws-head">
  <div class="ws-top">
    <h1 class="ws-title">Tincture Workshop</h1>
    <div class="ws-pill" data-ref="pill" aria-live="off">
      ${iconSvg('coin', { size: 22 })}
      <div><div class="v num" data-ref="coins">0</div><div class="r" data-ref="rate">Just starting</div></div>
    </div>
    <button type="button" class="btn-back ws-gear" data-action="settings" data-tap aria-label="Settings">${raw(GEAR)}<span id="settings-dot" class="ws-dot" hidden></span></button>
  </div>
  <div class="meter" role="group" aria-label="Flow meter">
    <div class="seg" data-seg="make"><div class="seg-label">Make</div><div class="seg-value" data-ref="segMake">-</div></div>
    <div class="seg" data-seg="store"><div class="seg-label">Store</div><div class="seg-value" data-ref="segStore">-</div></div>
    <div class="seg" data-seg="ship"><div class="seg-label">Ship</div><div class="seg-value" data-ref="segShip">-</div></div>
  </div>
  <button type="button" class="btn btn-primary ws-sugg" data-action="suggestion" data-coach="flow-meter" data-ref="sugg" data-tap>Choose a recipe</button>
  <div class="ws-next" data-ref="next" hidden></div>
</div>
<div class="screen-body ws-body" data-ref="body">
  <button type="button" class="btn btn-primary block ws-collect" data-action="collect" data-coach="collect" data-ref="collect" data-tap hidden>Collect</button>
  <div class="ws-scene" data-ref="scene">${raw(sceneSvg())}</div>
  <div data-sec="almost"></div>
  <div class="stack" data-sec="panels">
    ${['sources', 'grinders', 'mixers', 'vats', 'cellar', 'shop', 'fleet'].map((k) => h`<div data-pw="${k}"></div>`)}
  </div>
  <div data-sec="rooms"></div>
  <div data-sec="apprentices"></div>
  <div data-sec="closeup"></div>
</div>`);
}

// ---------------------------------------------------------------------------
// Section signatures and builders
// ---------------------------------------------------------------------------

/** Replace a section's HTML when its signature changed. Returns true if rebuilt. */
function setSection(key, el, sig, build) {
  if (sigs[key] === sig) return false;
  if (pointerDown) { dirty = true; return false; }
  sigs[key] = sig;
  el.innerHTML = String(build());
  return true;
}

function coinIcon(size = 12) { return iconSvg('coin', { size }); }

function buyBtn(label, cost, attrs) {
  const s = S();
  const short = num(s.coins) < cost;
  return button(h`<span class="l">${label}</span><span class="c">${coinIcon(12)}${fmt(Math.ceil(cost))}</span>`, {
    cls: 'ws-buy',
    attrs: { ...attrs, 'data-cost': String(cost), 'aria-disabled': short ? 'true' : 'false' },
  });
}

function milestoneHint(level, what = 'output') {
  const m = eco().nextMilestone(level);
  return m ? `Level ${m}: ${what} doubles` : '';
}

function row({ key, lead = '', title, sub = '', hint = '', extra = '', actions = '' }) {
  return h`<div class="ws-row" data-row="${key}">${lead ? h`<div class="ws-lead">${lead}</div>` : ''}<div class="ws-main"><div class="ws-t">${title}</div>${sub ? h`<div class="ws-s">${sub}</div>` : ''}${hint ? h`<div class="ws-hint">${hint}</div>` : ''}${extra}</div>${actions ? h`<div class="ws-actions">${actions}</div>` : ''}</div>`;
}

function panel(key, title, summary, rows) {
  const open = openPanels.has(key);
  return h`<div class="card ws-panel${open ? ' open' : ''}">
<button type="button" class="ws-panel-head" data-action="toggle-panel" data-panel="${key}" data-tap aria-expanded="${open ? 'true' : 'false'}"><span class="t">${title}</span><span class="s">${summary}</span>${iconSvg('back', { size: 18, cls: 'ws-chev' })}</button>
${open ? h`<div class="ws-rows">${rows()}</div>` : ''}</div>`;
}

function fleetVisible(s) {
  return (s.phase ?? 1) >= 2 || (s.rooms || []).includes('loading-yard') || (s.stations.fleet || []).length > 0;
}

function panelSpec(key, s, t) {
  const st = s.stations;
  const pm = eco().productionMultiplier(s, t);
  switch (key) {
    case 'sources': {
      const ids = Object.keys(st.sources || {});
      const built = ids.filter((id) => num(st.sources[id].level) > 0).length;
      return {
        sig: ids.map((id) => `${id}:${st.sources[id].level}:${st.sources[id].eventLoan ? 'loan' : ''}`).join(','),
        summary: `${built} source${built === 1 ? '' : 's'}`,
        rows: () => ids.map((id) => {
          const L = num(st.sources[id].level);
          const def = SOURCES_BY_ID[id];
          const pig = getPigment(def?.pigment ?? id);
          const out = L > 0 ? eco().stationOutput('source', L, id) * pm : num(def?.baseRate, 1) * pm;
          // A source lent by the weekly event (Deep Sea twist) goes back at the week's end.
          const loan = st.sources[id].eventLoan ? h` <span class="tag ws-loan" data-loan="${id}">this week</span>` : '';
          return row({
            key: `source:${id}`,
            lead: swatch(pig?.hex ?? hexOf(id), 36),
            title: h`${def?.name ?? cap1(id)}${loan}`,
            sub: L > 0 ? `Level ${L} · ${fmtRate(out)} a second` : `Found by a hunter · ${fmtRate(out)} a second when built`,
            hint: L > 0 ? milestoneHint(L) : '',
            actions: buyBtn(L > 0 ? 'Level up' : 'Build', eco().stationCost('source', L, id), { 'data-action': 'buy', 'data-kind': 'source', 'data-id': id }),
          });
        }),
      };
    }
    case 'grinders': {
      const gs = st.grinders || [];
      return {
        sig: gs.map((g) => `${g.kind}:${g.level}`).join(','),
        summary: gs.map((g) => GRINDER_KINDS_BY_ID[g.kind]?.name ?? 'Grinder').join(', '),
        rows: () => gs.map((g, i) => {
          const def = GRINDER_KINDS_BY_ID[g.kind];
          const next = def?.next ? GRINDER_KINDS_BY_ID[def.next] : null;
          const out = eco().stationOutput('grinder', g.level, g.kind) * pm;
          const bonus = def?.purityBonus > 0 ? ` · ${Math.round(def.purityBonus * 100)}% purer batches` : '';
          return row({
            key: `grinder:${i}`,
            lead: swatch('#B9B3A8', 36),
            title: def?.name ?? 'Grinder',
            sub: `Level ${g.level} · ${fmt(out)} pigment/s${bonus}`,
            hint: milestoneHint(g.level),
            extra: next ? h`<div class="mt-1">${button(h`Upgrade to ${next.name}<span class="c" style="display:inline-flex;align-items:center;gap:4px">${coinIcon(12)}${fmt(def.upgradeCost)}</span>`, { small: true, cls: 'ws-buy-kind', attrs: { 'data-action': 'buy-grinder-kind', 'data-index': String(i), 'data-cost': String(def.upgradeCost), 'aria-disabled': num(s.coins) < def.upgradeCost ? 'true' : 'false' } })}</div>` : '',
            actions: buyBtn('Level up', eco().stationCost('grinder', g.level), { 'data-action': 'buy', 'data-kind': 'grinder', 'data-index': String(i) }),
          });
        }),
      };
    }
    case 'mixers': {
      const ms = st.mixers || [];
      const busy = ms.filter((m) => m.recipe).length;
      return {
        sig: ms.map((m) => `${m.recipe}:${m.level}:${m.accident ? 1 : 0}:${m.recipe ? nameOf(m.recipe) : ''}`).join(','),
        summary: busy === 0 ? `${ms.length} ready for a recipe` : busy === ms.length ? `${busy} busy` : `${busy} busy, ${ms.length - busy} free`,
        rows: () => ms.map((m, i) => {
          const rate = eco().stationOutput('mixer', m.level) * pm;
          const lead = m.recipe ? swatch(hexOf(m.recipe), 36) : h`<span class="swatch is-empty" style="--size:36px" aria-hidden="true"></span>`;
          const bar = m.recipe ? h`<div class="progress mt-1" role="progressbar" aria-label="Batch progress" data-mixer-bar="${i}"><span style="width:0%"></span></div>` : '';
          return row({
            key: `mixer:${i}`,
            lead: h`<button type="button" class="ws-pickbtn" data-action="mixer-recipe" data-mixer="${i}" data-tap aria-label="Choose a recipe for mixer ${i + 1}">${lead}</button>`,
            title: m.recipe ? `Mixer ${i + 1}: ${nameOf(m.recipe)}` : `Mixer ${i + 1}: choose a recipe`,
            sub: m.recipe ? `Level ${m.level} · ${fmtRate(rate)} jars/s · tap the swatch to change` : `Level ${m.level} · tap the swatch to pick what it makes`,
            hint: milestoneHint(m.level),
            extra: h`${bar}${m.accident ? button('A happy accident! Tap to claim', { small: true, cls: 'ws-claim', attrs: { 'data-action': 'claim-accident', 'data-mixer': String(i) } }) : ''}`,
            actions: h`${buyBtn('Level up', eco().stationCost('mixer', m.level), { 'data-action': 'buy', 'data-kind': 'mixer', 'data-index': String(i) })}${button('Rush', { small: true, cls: 'ws-rush', attrs: { 'data-action': 'rush', 'data-mixer': String(i), 'data-rush': String(i) } })}`,
          });
        }),
      };
    }
    case 'vats': {
      const vs = st.vats || [];
      let total = 0;
      for (const v of vs) total += eco().stationOutput('vat', v.level);
      return {
        sig: vs.map((v) => `${v.level}:${v.color}`).join(','),
        summary: `${vs.length} vats · ${fmt(total)} jars`,
        rows: () => vs.map((v, i) => row({
          key: `vat:${i}`,
          lead: h`<button type="button" class="ws-pickbtn" data-action="vat-color" data-vat="${i}" data-tap aria-label="Choose the color shown in vat ${i + 1}">${v.color ? swatch(hexOf(v.color), 36) : h`<span class="swatch is-empty" style="--size:36px" aria-hidden="true"></span>`}</button>`,
          title: `Vat ${i + 1}${v.color ? `: ${nameOf(v.color)}` : ''}`,
          sub: `Level ${v.level} · holds ${fmt(eco().stationOutput('vat', v.level))} jars`,
          hint: milestoneHint(v.level, 'capacity'),
          actions: buyBtn('Level up', eco().stationCost('vat', v.level), { 'data-action': 'buy', 'data-kind': 'vat', 'data-index': String(i) }),
        })),
      };
    }
    case 'cellar': {
      const lvl = num(s.cellarLevel, 1);
      const cap = sim().storage.capacity(s);
      return {
        sig: `${lvl}:${cap.cellar}`,
        summary: `Level ${lvl}`,
        rows: () => row({
          key: 'cellar',
          lead: swatch('#6A4630', 36),
          title: 'Cellar',
          sub: `Level ${lvl} · holds ${fmt(cap.cellar)} jars`,
          hint: 'Shared storage for everything not in a display vat',
          actions: buyBtn('Level up', eco().stationCost('cellar', lvl), { 'data-action': 'buy', 'data-kind': 'cellar' }),
        }),
      };
    }
    case 'shop': {
      const L = num(st.shop.level, 1);
      return {
        sig: String(L),
        summary: `Level ${L}`,
        rows: () => row({
          key: 'shop',
          lead: swatch('#C9A277', 36),
          title: 'Shop counter',
          sub: `Level ${L} · sells ${fmtRate(eco().stationOutput('shop', L))} jars/s · prices +${Math.round((eco().shopPriceBonus(s) - 1) * 100)}%`,
          hint: milestoneHint(L, 'selling'),
          actions: buyBtn('Level up', eco().stationCost('shop', L), { 'data-action': 'buy', 'data-kind': 'shop' }),
        }),
      };
    }
    case 'fleet': {
      if (!fleetVisible(s)) return null;
      const fl = st.fleet || [];
      const slots = sim().shipping.fleetSlots(s);
      const out = fl.filter((v) => num(v.arrivesAt) > 0).length;
      const dispatcher = !!s.apprentices?.dispatcher;
      return {
        sig: [fl.map((v) => `${v.kind}:${v.level}:${v.route}:${num(v.arrivesAt) > 0 ? 1 : 0}`).join(','), slots, dispatcher ? 1 : 0, s.era].join('|'),
        summary: fl.length ? `${out} out · ${fl.length - out} idle` : 'No vehicles yet',
        rows: () => {
          const owned = fl.map((v, i) => {
            const def = VEHICLES_BY_ID[v.kind];
            const busy = num(v.arrivesAt) > 0;
            const route = v.route ? ROUTES_BY_ID[v.route] : null;
            const capJ = eco().vehicleCapacity(v);
            return row({
              key: `fleet:${i}`,
              lead: swatch('#9A6A47', 36),
              title: `${def?.name ?? 'Vehicle'} · Level ${v.level}`,
              sub: h`<span data-veh-status="${i}">${busy ? 'Out' : 'Idle'}</span> · holds ${fmt(capJ)} jars`,
              hint: milestoneHint(v.level, 'capacity'),
              extra: dispatcher ? h`<div class="mt-1">${button(`Route: ${route ? route.name : 'none yet'}`, { small: true, attrs: { 'data-action': 'fleet-route', 'data-vehicle': String(i) } })}</div>` : '',
              actions: h`${busy ? '' : button('Ship', { variant: 'primary', small: true, attrs: { 'data-action': 'fleet-ship', 'data-vehicle': String(i) } })}${buyBtn('Level up', eco().stationCost('vehicle', v.level, v.kind), { 'data-action': 'buy', 'data-kind': 'fleet', 'data-index': String(i) })}`,
            });
          });
          const catalog = VEHICLES.filter((v) => v.era === (s.era ?? 1));
          const shop = slots > 0 ? catalog.map((v) => row({
            key: `veh:${v.id}`,
            lead: swatch('#C9A277', 36),
            title: v.name,
            sub: `Holds ${fmt(v.capacity)} jars · ${waitText(ctx.format, v.tripMs)} round trip`,
            hint: v.blurb,
            actions: buyBtn(fl.length < slots ? 'Buy' : 'Swap in', v.cost, { 'data-action': 'buy-vehicle', 'data-kind': v.id }),
          })) : [row({ key: 'veh:none', title: 'Build the Loading Yard', sub: 'It gives you room for carts and wagons.' })];
          return h`${owned}<div class="ws-sub-title">Vehicles</div>${shop}`;
        },
      };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Patching: everything that changes every tick, updated in place
// ---------------------------------------------------------------------------

function storeText(full, fillMs, capTotal) {
  if (full) return 'Full';
  if (!Number.isFinite(fillMs)) return `Holds ${fmt(capTotal)}`;
  const m = Math.max(0, Math.ceil(fillMs / 60e3));
  if (m <= 1) return 'Full soon';
  if (m < 60) return `Full in ${m} m`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `Full in ${hrs} h`;
  return `Full in ${Math.round(hrs / 24)} d`;
}

function patchHead(s, t, c) {
  const rate = eco().incomeRate(s, t);
  const rt = rate > 0 ? ctx.format.rate(rate) : 'Just starting';
  if (refs.rate.textContent !== rt) refs.rate.textContent = rt;
  patchCoins(s);

  const m = c.meter;
  const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const anyRecipe = (s.stations.mixers || []).some((x) => x && x.recipe);
  set(refs.segMake, m.make.rate > 0 ? `${fmtRate(m.make.rate)} jars/s` : anyRecipe ? 'Warming up' : 'Pick a recipe');
  set(refs.segShip, m.ship.rate > 0 ? `${fmtRate(m.ship.rate)} jars/s` : 'Standing by');
  const full = sim().storage.isFull(s);
  const fillMs = sim().storage.fillTimeMs(s);
  set(refs.segStore, storeText(full, fillMs, c.cap.total));
  for (const k of ['make', 'store', 'ship']) {
    const seg = root.querySelector(`[data-seg="${k}"]`);
    const on = m.weakest === k;
    if (seg.classList.contains('weakest') !== on) seg.classList.toggle('weakest', on);
  }

  // Suggestion button: always something she can tap when anything is affordable.
  const b = refs.sugg;
  const info = suggestionInfo(m.suggestion, s);
  set(b, info.text);
  if (b.dataset.state !== info.state) b.dataset.state = info.state;
  b.setAttribute('aria-disabled', info.state === 'wait' ? 'true' : 'false');
  const primary = info.state === 'go' && !(Math.floor(num(s.pendingCollect)) >= 1);
  if (b.classList.contains('btn-primary') !== primary) { b.classList.toggle('btn-primary', primary); b.classList.toggle('btn-paper', !primary); }
  b.style.setProperty('--p', `${Math.round(info.progress * 100)}%`);
  const o = info.act;
  b.dataset.kind = o?.kind || '';
  b.dataset.index = o?.index != null ? String(o.index) : '';
  b.dataset.id = o?.id || '';
  b.dataset.cost = String(o?.cost || 0);
  const nx = refs.next;
  if (nx.textContent !== info.next) nx.textContent = info.next;
  if (nx.hidden !== !info.next) nx.hidden = !info.next;
}

const NOUN = { grinder: 'the grinder', mixer: 'a mixer', vat: 'a vat', shop: 'the shop', fleet: 'the fleet', cellar: 'the cellar', room: 'a room' };

function nounFor(o) {
  if (o.kind === 'source') return o.id && SOURCES_BY_ID[o.id] ? `the ${SOURCES_BY_ID[o.id].name}` : 'a source';
  return NOUN[o.kind] || 'the workshop';
}

/** The cheapest upgrade she can buy right now (skips sources the slots would refuse). */
function cheapestAffordable(s) {
  const coins = num(s.coins);
  const srcs = s.stations.sources || {};
  const built = Object.values(srcs).filter((x) => num(x.level) > 0).length;
  let best = null;
  for (const o of eco().upgradeOptions(s)) {
    if (!(o.cost <= coins)) continue;
    if (o.kind === 'source' && !(num(srcs[o.id]?.level) > 0) && built >= MAX_SOURCES_ERA1) continue;
    if (!best || o.cost < best.cost) best = o;
  }
  return best;
}

/** "Level up the Ochre Pit for 7". */
function levelUpText(o, s) {
  const c = fmt(Math.ceil(o.cost));
  const st = s.stations;
  switch (o.kind) {
    case 'source': {
      const name = SOURCES_BY_ID[o.id]?.name ?? cap1(o.id);
      return num(st.sources[o.id]?.level) > 0 ? `Level up the ${name} for ${c}` : `Build the ${name} for ${c}`;
    }
    case 'grinder': return `Level up the ${(GRINDER_KINDS_BY_ID[st.grinders[o.index]?.kind]?.name ?? 'grinder').toLowerCase()} for ${c}`;
    case 'mixer': return `Level up Mixer ${o.index + 1} for ${c}`;
    case 'vat': return `Level up Vat ${o.index + 1} for ${c}`;
    case 'shop': return `Level up the shop counter for ${c}`;
    case 'fleet': return `Level up the ${(VEHICLES_BY_ID[st.fleet[o.index]?.kind]?.name ?? 'vehicle').toLowerCase()} for ${c}`;
    case 'cellar': return `Level up the cellar for ${c}`;
    default: return `Level up for ${c}`;
  }
}

/**
 * What the big button says and does. The flow meter's suggestion when she can
 * afford it; otherwise the cheapest upgrade she CAN afford, with the suggestion
 * as a quiet "Next:" line; otherwise a quiet progress button toward it.
 */
function suggestionInfo(sg, s) {
  if (!sg) return { text: 'Everything is humming', state: 'go', progress: 0, next: '', act: null };
  if (sg.kind === 'assign' || !(sg.cost > 0)) return { text: sg.label || 'Choose a recipe', state: 'go', progress: 0, next: '', act: sg };
  const coins = num(s.coins);
  const cost = Math.ceil(sg.cost);
  if (coins >= sg.cost) return { text: `Upgrade ${nounFor(sg)} for ${fmt(cost)}`, state: 'go', progress: 0, next: '', act: sg };
  const more = fmt(Math.max(1, Math.ceil(sg.cost - coins)));
  const alt = cheapestAffordable(s);
  if (alt) {
    return { text: levelUpText(alt, s), state: 'go', progress: 0, next: `Next: ${nounFor(sg)} for ${fmt(cost)} (${more} more)`, act: alt };
  }
  return { text: `${more} more coins to upgrade ${nounFor(sg)}`, state: 'wait', progress: clamp01(coins / sg.cost), next: '', act: sg };
}

function patchCoins(s) {
  if (coinHold) return;
  const to = Math.floor(num(s.coins));
  if (coinShown === null) { refs.coins.textContent = fmt(to); coinShown = to; return; }
  if (to === coinShown) return;
  const jump = Math.abs(to - coinShown) > Math.max(5, coinShown * 0.03);
  if (jump) fx().rollNumber(refs.coins, coinShown, to, { format: fmt });
  else refs.coins.textContent = fmt(to);
  coinShown = to;
}

function patchCollect(s) {
  const pending = Math.floor(num(s.pendingCollect));
  const b = refs.collect;
  const show = pending >= 1;
  if (b.hidden === show) b.hidden = !show;
  if (show) {
    const label = `Collect ${fmt(pending)} coins`;
    if (b.dataset.label !== label) {
      b.dataset.label = label;
      b.innerHTML = String(h`${coinIcon(20)}<span>${label}</span>`);
    }
  }
}

/** Hang (or take down) a paper tag over a scene object. `lock` tags carry the lock icon. */
function setTag(key, text, lock = true) {
  const g = root.querySelector(`[data-tag="${key}"]`);
  if (!g) return;
  const on = !!text;
  g.classList.toggle('ws-off', !on);
  if (!on) { delete g.dataset.text; return; }
  const sig = `${lock ? 1 : 0}|${text}`;
  if (g.dataset.text !== sig) {
    g.dataset.text = sig;
    g.innerHTML = String(tag(text, { icon: lock ? 'lock' : null }));
  }
}

const moreColors = (n) => `${n} more color${n === 1 ? '' : 's'}`;

/** The goal each locked scene object names, in the "N more" voice ('' when open). */
function lockGoals(s) {
  const sm = sim();
  const colors = sm.discoveredCount(s);
  const phase = s.phase ?? 1;
  const rooms = s.rooms || [];
  const goals = { map: '', shelf: '', gallery: '', commissions: '', yard: '', yardLock: true };
  if (!sm.hunters.unlocked(s)) goals.map = moreColors(Math.max(1, 10 - colors));
  if (!sm.shelf.unlocked(s)) goals.shelf = moreColors(Math.max(1, 5 - colors));
  const wing = rooms.includes('gallery-wing') || s.gallery?.unlocked;
  if (!wing) goals.gallery = colors < 20 ? moreColors(20 - colors) : phase < 2 ? 'Mill Room first' : 'Add the Gallery Wing';
  const yardOwned = rooms.includes('loading-yard');
  const fl = s.stations.fleet || [];
  if (!yardOwned) goals.yard = colors < 30 ? moreColors(30 - colors) : phase < 2 ? 'Mill Room first' : 'Add the Loading Yard';
  else if (fl.length === 0) { goals.yard = 'Add a cart'; goals.yardLock = false; }
  else { goals.yard = `${fl.filter((v) => !(num(v.arrivesAt) > 0)).length} ready`; goals.yardLock = false; }
  if (phase < 3) goals.commissions = colors < 30 ? moreColors(30 - colors) : 'Loading Yard first';
  return goals;
}

/** A vat's color name on one or two short lines (the plate is about 60 px wide). */
function vatLabelLines(name) {
  const clip = (x, n) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
  if (name.length <= 10) return [name];
  const words = name.split(' ');
  if (words.length > 1) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b2 = words.slice(k).join(' ');
      const score = Math.max(a.length, b2.length);
      if (!best || score < best.score) best = { a, b: b2, score };
    }
    return [clip(best.a, 11), clip(best.b, 11)];
  }
  return [clip(name, 11)];
}

function patchScene(s, t) {
  const sm = sim();

  // Display vats.
  for (let i = 0; i < 3; i++) {
    const v = (s.stations.vats || [])[i];
    const art = root.querySelector(`[data-vat-art="${i}"]`);
    const lab = root.querySelector(`[data-vat-label="${i}"]`);
    if (!v || !art) continue;
    const jars = v.color ? num(s.stock?.[v.color]?.jars) : 0;
    const capV = eco().stationOutput('vat', v.level);
    const ratio = capV > 0 ? clamp01(jars / capV) : 0;
    const key = `${v.color}|${Math.round(ratio * 60)}`;
    if (vatKeys[i] !== key) {
      vatKeys[i] = key;
      art.innerHTML = String(vatSvg(ratio, v.color ? hexOf(v.color) : NEUTRAL, { size: 66 }));
      const svg = art.querySelector('svg');
      if (svg) svg.setAttribute('aria-hidden', 'true');
    }
    const full = v.color ? nameOf(v.color) : 'Choose';
    if (lab.dataset.full !== full) {
      lab.dataset.full = full;
      const lines = vatLabelLines(full);
      const plate = root.querySelector(`[data-vat-plate="${i}"]`);
      const cx = Number(lab.getAttribute('x'));
      lab.setAttribute('y', lines.length > 1 ? '274' : '277');
      lab.style.fontSize = lines.length > 1 ? '9px' : '10px';
      lab.innerHTML = lines.map((ln, k) => `<tspan x="${cx}" dy="${k ? 10 : 0}">${escapeHtml(ln)}</tspan>`).join('');
      plate.setAttribute('height', lines.length > 1 ? '28' : '18');
    }
  }

  // Mixing bench: the pot shows the first mixer's color.
  const first = (s.stations.mixers || []).find((m) => m.recipe);
  const paintHex = first ? hexOf(first.recipe) : '#C9B79A';
  const paint = root.querySelector('[data-bench-paint]');
  if (paint.getAttribute('fill') !== paintHex) {
    paint.setAttribute('fill', paintHex);
    root.querySelector('[data-bench-wave]').setAttribute('stroke', lighten(paintHex, 0.35));
  }

  // Happy accident glow + pill.
  const acc = (s.stations.mixers || []).map((m, i) => (m.accident ? i : -1)).filter((i) => i >= 0);
  root.querySelector('[data-accident]').classList.toggle('ws-off', acc.length === 0);
  const pill = root.querySelector('[data-pill="accident"]');
  pill.classList.toggle('ws-off', acc.length === 0);
  if (acc.length) {
    pill.dataset.mixer = String(acc[0]);
    const txt = acc.length > 1 ? `Claim ${acc.length}` : 'Tap to claim';
    const pt = pill.querySelector('[data-pill-text]');
    if (pt.textContent !== txt) pt.textContent = txt;
  }

  // Merge shelf: containers tinted from her shelf; a sparkle when a merge waits.
  const shelfOpen = sm.shelf.unlocked(s);
  const cells = (s.shelf?.cells || []).filter(Boolean).slice(0, ENTRY_COLORS);
  root.querySelectorAll('[data-shelf-slot]').forEach((r, i) => {
    if (!shelfOpen) { r.classList.remove('ws-off'); r.setAttribute('fill', r.dataset.default); return; }
    const cell = cells[i];
    r.classList.toggle('ws-off', !cell);
    if (cell) r.setAttribute('fill', hexOf(cell.color));
  });
  const hint = root.querySelector('[data-shelf-hint]');
  hint.classList.toggle('ws-off', !(shelfOpen && sm.shelf.hints(s).length > 0));

  // Locked things stay visible: one paper-tag shape (kit.tag) naming the goal.
  const goals = lockGoals(s);
  setTag('map', goals.map);
  setTag('shelf', goals.shelf);
  setTag('gallery', goals.gallery);
  setTag('yard', goals.yard, goals.yardLock);
  setTag('commissions', goals.commissions);

  // Badges.
  root.querySelector('[data-badge="quests"]').classList.toggle('ws-off', !(sm.quests.questsReady(s) > 0));
  root.querySelector('[data-badge="ledger"]').classList.toggle('ws-off', !s.ledger?.pending);
}

function almostItems(s, t) {
  if (t - almostCache.at > 2000 || almostCache.at > t) {
    almostCache = { at: t, items: sim().ledger.almostThere(s, t) || [] };
  }
  return almostCache.items;
}

const ICON_HEX = {
  hunter: '#6E4A7E', commission: '#3E6A9E', canvas: '#2F8A8A', vial: '#8FA77A', swatch: '#D39B2A',
  room: '#7B5236', coin: '#C99A2E', pin: '#B8433A', collector: '#D98A8F', quest: '#3E6A9E', postcard: '#6E4A7E',
  sparkle: '#E2B04A', tube: '#8FA77A',
};

function itemHex(it) {
  const p = it.params || {};
  const id = p.color || p.colorId;
  if (id) { try { return hexOf(id); } catch (e) { /* fall through */ } }
  return ICON_HEX[it.icon] || '#7B5236';
}

function patchAlmost(s, t) {
  const items = almostItems(s, t);
  const sig = items.map((it) => `${it.icon}|${it.text}`).join('\n');
  setSection('almost', root.querySelector('[data-sec="almost"]'), sig, () => (items.length
    ? h`<div class="card" data-coach="almost-there"><div class="card-title">Almost there</div>${items.map((it, i) => h`<button type="button" class="ws-almost-row" data-action="almost" data-i="${i}" data-tap><span class="sw" style="background:${safeHex(itemHex(it))}"></span><span class="grow">${it.text}</span></button>`)}</div>`
    : ''));
}

function patchPanels(s, t) {
  for (const key of ['sources', 'grinders', 'mixers', 'vats', 'cellar', 'shop', 'fleet']) {
    const wrap = root.querySelector(`[data-pw="${key}"]`);
    const spec = panelSpec(key, s, t);
    if (!spec) { wrap.hidden = true; sigs[`p:${key}`] = 'none'; continue; }
    wrap.hidden = false;
    setSection(`p:${key}`, wrap, `${openPanels.has(key) ? 1 : 0}|${spec.sig}`, () => panel(key, cap1(key), spec.summary, spec.rows));
  }
  // Live bits: batch progress, rush cooldown, vehicle status.
  (s.stations.mixers || []).forEach((m, i) => {
    const bar = root.querySelector(`[data-mixer-bar="${i}"] > span`);
    if (bar) {
      const w = `${(clamp01(num(m.progress) / MIXER.batchJars) * 100).toFixed(1)}%`;
      if (bar.style.width !== w) bar.style.width = w;
    }
    const rb = root.querySelector(`[data-rush="${i}"]`);
    if (rb) {
      const readyAt = num(m.rushedAt) + RUSH_COOLDOWN_MS;
      const cooling = num(m.rushedAt) > 0 && t < readyAt;
      const label = !m.recipe ? 'Rush' : cooling ? (readyAt - t <= 60e3 ? 'Rush soon' : `Rush in ${waitText(ctx.format, readyAt - t)}`) : 'Rush';
      if (rb.textContent !== label) rb.textContent = label;
      rb.setAttribute('aria-disabled', !m.recipe || cooling ? 'true' : 'false');
    }
  });
  (s.stations.fleet || []).forEach((v, i) => {
    const el = root.querySelector(`[data-veh-status="${i}"]`);
    if (!el) return;
    const label = num(v.arrivesAt) > 0 ? `Out, back in ${waitText(ctx.format, v.arrivesAt - t)}` : 'Idle';
    if (el.textContent !== label) el.textContent = label;
  });
}

function nextRoom(s) {
  return ROOMS.find((r) => !(s.rooms || []).includes(r.id)) || null;
}

function patchRooms(s) {
  const r = nextRoom(s);
  const colors = sim().discoveredCount(s);
  const need = r ? Math.max(0, r.colorsRequired - colors) : 0;
  const lockedPhase = r && (s.phase ?? 1) < r.phase;
  const sig = r ? `${r.id}|${need}|${lockedPhase ? 1 : 0}` : 'none';
  setSection('rooms', root.querySelector('[data-sec="rooms"]'), sig, () => {
    if (!r) return '';
    // The lock is a paper tag naming the goal; the button only exists once the room can open.
    const goal = need > 0 ? moreColors(need) : lockedPhase ? (r.phase >= 3 ? 'Loading Yard first' : 'Mill Room first') : '';
    const hint = goal ? `Opens for ${fmt(r.cost)} coins` : 'Ready when you are';
    return h`<div class="card" data-coach="rooms"><div class="card-title">Next room</div>
<div class="ws-row" style="border-top:0;padding:4px 0" data-row="room:${r.id}"${r.id === 'mill-room' ? raw(' data-coach="mill-room"') : ''}><div class="ws-main"><div class="ws-t serif" style="font-family:var(--font-display);font-size:17px">${r.name}</div><div class="ws-s">${r.blurb}</div><div class="ws-hint">${hint}</div></div>
<div class="ws-actions">${goal ? tag(goal) : buyBtn('Open', r.cost, { 'data-action': 'buy-room', 'data-id': r.id, 'data-lock': '0' })}</div></div></div>`;
  });
}

function patchApprentices(s) {
  const owned = APPRENTICES.filter((a) => s.apprentices?.[a.id]);
  const avail = APPRENTICES.filter((a) => !s.apprentices?.[a.id] && a.phase <= (s.phase ?? 1));
  const sig = `${owned.map((a) => a.id).join(',')}|${avail.map((a) => a.id).join(',')}|${s.stewardOn ? 1 : 0}`;
  setSection('apprentices', root.querySelector('[data-sec="apprentices"]'), sig, () => {
    if (!owned.length && !avail.length) return '';
    return h`<div class="card"><div class="card-title">Apprentices</div>
${owned.length ? h`<div class="ws-chip-row">${owned.map((a) => h`<span class="chip">${iconSvg('check', { size: 14 })}${a.name}</span>`)}</div>` : ''}
${owned.some((a) => a.id === 'steward') ? h`<div class="ws-switch-row"><div class="grow"><div class="semi">Steward buys upgrades</div><div class="hint">Picks the cheapest fix for your weakest step.</div></div><button type="button" class="switch" role="switch" aria-checked="${s.stewardOn ? 'true' : 'false'}" aria-label="Steward" data-action="steward-toggle" data-tap></button></div>` : ''}
${avail.map((a) => row({
    key: `apprentice:${a.id}`,
    title: a.name,
    sub: a.blurb,
    actions: a.cost > 0 ? buyBtn('Hire', a.cost, { 'data-action': 'buy-apprentice', 'data-id': a.id }) : button('Hire (free)', { small: true, attrs: { 'data-action': 'buy-apprentice', 'data-id': a.id } }),
  }))}</div>`;
  });
}

function closeUpAvailable(s) {
  return (s.onboarding?.step ?? 0) >= 7 || s.onboarding?.done || (s.phase ?? 1) >= 2;
}

function patchCloseUp(s) {
  const on = closeUpAvailable(s);
  const sig = `${on ? 1 : 0}|${closedInfo ? 1 : 0}`;
  setSection('closeup', root.querySelector('[data-sec="closeup"]'), sig, () => {
    if (!on) return '';
    return button(closedInfo ? '' : 'Close up shop', {
      variant: closedInfo ? 'primary' : 'wood', block: true, cls: `tall ${closedInfo ? 'ws-closed' : ''}`,
      attrs: { 'data-action': closedInfo ? 'close-up-reopen' : 'close-up', 'data-coach': 'close-up', 'data-closeup-btn': '1' },
    });
  });
  const b = root.querySelector('[data-closeup-btn]');
  if (b && closedInfo) {
    const fill = sim().storage.fillTimeMs(s);
    const label = Number.isFinite(fill) && fill > 0 ? `Shop closed. Vats fill in ${waitText(ctx.format, fill)}` : 'Shop closed. Everything is set for tomorrow';
    if (b.textContent !== label) b.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Auto-assigning display vats (first stocked colors appear on their own)
// ---------------------------------------------------------------------------

let assigning = false;
function autoAssignVats(s) {
  if (assigning) return;
  const vats = s.stations.vats || [];
  if (!vats.some((v) => !v.color)) return;
  const used = new Set(vats.map((v) => v.color).filter(Boolean));
  const stocked = Object.entries(s.stock || {})
    .filter(([id, e]) => num(e?.jars) >= 0.5 && !used.has(id))
    .sort((a, b) => num(b[1].jars) - num(a[1].jars));
  if (!stocked.length) return;
  assigning = true;
  try {
    act((st) => {
      let k = 0;
      st.stations.vats.forEach((v, i) => {
        if (!v.color && stocked[k]) sim().factory.setVatColor(st, { vat: i, colorId: stocked[k++][0] });
      });
    });
  } finally { assigning = false; }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll(state) {
  if (!root || !refs.coins) return;
  const s = state || S();
  try {
    const t = now();
    autoAssignVats(s);
    const c = { meter: eco().flowMeter(s, t), cap: sim().storage.capacity(s) };
    patchHead(s, t, c);
    patchCollect(s);
    patchScene(s, t);
    patchAlmost(s, t);
    patchPanels(s, t);
    patchRooms(s);
    patchApprentices(s);
    patchCloseUp(s);
    patchAfford(s);
  } catch (e) {
    console.error('workshop render failed', e);
  }
}

function patchAfford(s) {
  const coins = num(s.coins);
  root.querySelectorAll('[data-cost]').forEach((b) => {
    const short = coins < num(Number(b.dataset.cost)) || b.dataset.lock === '1';
    if (b.dataset.action === 'suggestion') return; // handled in patchHead
    const v = short ? 'true' : 'false';
    if (b.getAttribute('aria-disabled') !== v) b.setAttribute('aria-disabled', v);
  });
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function closeSheet() { if (sheet) { const x = sheet; sheet = null; x.api.close(); } }

function pickRow({ action, attrs = {}, lead, title, sub = '', on = false, right = '' }) {
  return h`<button type="button" class="ws-pick${on ? ' is-on' : ''}" data-action="${action}"${A(attrs)} data-tap>${lead}<span class="grow"><span class="pt">${title}</span>${sub ? h`<br><span class="ps">${sub}</span>` : ''}</span>${right}</button>`;
}

function recipeSheetHtml(mi) {
  const s = S();
  const t = now();
  const m = s.stations.mixers[mi];
  const list = sim().discoveredColors(s)
    .filter((c) => sim().factory.canMix(s, c.id))
    .map((c) => ({ ...c, price: eco().colorPrice(s, c.id) }))
    .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  void t;
  return h`<div class="hint">Pick what Mixer ${mi + 1} makes. Only colors you have discovered, and can mix, appear here.</div>
${pickRow({ action: 'set-recipe', attrs: { 'data-mixer': String(mi), 'data-color': '' }, lead: h`<span class="swatch is-empty" style="--size:36px"></span>`, title: 'Rest this mixer', sub: 'It makes nothing until you pick again', on: !m.recipe })}
${list.length ? list.map((c) => pickRow({ action: 'set-recipe', attrs: { 'data-mixer': String(mi), 'data-color': c.id }, lead: swatch(c.hex, 36), title: c.name, sub: `Worth ${fmt(c.price)} Coins a jar`, on: m.recipe === c.id, right: m.recipe === c.id ? h`<span class="chip">Making now</span>` : '' })) : h`<div class="muted">Discover a color you can mix and it will show up here.</div>`}`;
}

function openRecipeSheet(mi) {
  closeSheet();
  const api = openSheet(root, {
    title: `Mixer ${mi + 1}: what to make`,
    html: String(recipeSheetHtml(mi)),
    onAction(name, el) {
      if (name !== 'set-recipe') return;
      const colorId = el.dataset.color || null;
      const res = act(sim().factory.assignRecipe, { mixer: mi, colorId });
      if (res && res.ok) {
        audio().cork();
        closeSheet();
        renderAll();
        const r = root.querySelector(`[data-row="mixer:${mi}"]`);
        fx().squash(r);
        if (colorId) toast(`Mixer ${mi + 1} is making ${nameOf(colorId)}`, { hex: hexOf(colorId) });
      } else toast('That recipe needs a pigment you do not have a source for yet.');
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'recipe' };
}

/**
 * Catalog "Assign to mixer": an idle mixer takes the color straight away;
 * when every mixer is busy she picks which one switches.
 */
function assignFromCatalog(colorId) {
  const s = S();
  const mixers = (s.stations && s.stations.mixers) || [];
  if (!colorId || !mixers.length) return;
  const apply = (mi) => {
    const res = act(sim().factory.assignRecipe, { mixer: mi, colorId });
    if (res && res.ok) {
      audio().cork();
      renderAll();
      fx().squash(root.querySelector(`[data-row="mixer:${mi}"]`));
      toast(`Mixer ${mi + 1} is making ${nameOf(colorId)}`, { hex: hexOf(colorId) });
    } else toast('That recipe needs a pigment you do not have a source for yet.');
  };
  const already = mixers.findIndex((m) => m && m.recipe === colorId);
  if (already >= 0) { toast(`Mixer ${already + 1} is already making ${nameOf(colorId)}`, { hex: hexOf(colorId) }); return; }
  const idle = mixers.findIndex((m) => m && !m.recipe);
  if (idle >= 0 || mixers.length === 1) { apply(idle >= 0 ? idle : 0); return; }
  closeSheet();
  const api = openSheet(root, {
    title: `Which mixer makes ${nameOf(colorId)}?`,
    html: String(h`${mixers.map((m, mi) => pickRow({ action: 'assign-to', attrs: { 'data-mixer': String(mi) }, lead: swatch(hexOf(m.recipe), 36), title: `Mixer ${mi + 1}`, sub: m.recipe ? `Making ${nameOf(m.recipe)} now` : 'Resting' }))}`),
    onAction(name, el) {
      if (name !== 'assign-to') return;
      closeSheet();
      apply(Number(el.dataset.mixer) || 0);
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'assign' };
}

function openVatSheet(vi) {
  closeSheet();
  const s = S();
  const v = s.stations.vats[vi];
  if (!v) return;
  const list = Object.entries(s.stock || {}).filter(([, e]) => num(e?.jars) > 0.05)
    .map(([id, e]) => ({ id, jars: num(e.jars), name: nameOf(id), hex: hexOf(id) }))
    .sort((a, b) => b.jars - a.jars);
  const html = h`<div class="hint">Choose which color Vat ${vi + 1} shows. The glass fills with how much of it you have.</div>
${pickRow({ action: 'set-vat', attrs: { 'data-vat': String(vi), 'data-color': '' }, lead: h`<span class="swatch is-empty" style="--size:36px"></span>`, title: 'Empty glass', on: !v.color })}
${list.length ? list.map((c) => pickRow({ action: 'set-vat', attrs: { 'data-vat': String(vi), 'data-color': c.id }, lead: swatch(c.hex, 36), title: c.name, sub: `${fmt(c.jars)} jars in stock`, on: v.color === c.id })) : h`<div class="muted">Make some color and it will be waiting here.</div>`}`;
  const api = openSheet(root, {
    title: `Vat ${vi + 1}`,
    html: String(html),
    onAction(name, el) {
      if (name !== 'set-vat') return;
      const colorId = el.dataset.color || null;
      act(sim().factory.setVatColor, { vat: vi, colorId });
      audio().glug(0.6);
      closeSheet();
      renderAll();
      if (colorId) {
        const svg = root.querySelector(`[data-vat-art="${vi}"] svg`);
        fx().pourFill(svg, hexOf(colorId), { x: 33, y: 100 });
      }
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'vat' };
}

// --- shipping ---------------------------------------------------------------

const famPlural = (f) => `${f}s`;

function demandText(routeId, t) {
  const r = ROUTES_BY_ID[routeId];
  const d = sim().shipping.currentDemand(S(), routeId, t);
  if (!r || !d.family) return '';
  return `${r.name} wants ${famPlural(d.family)} +${Math.round(d.bonus * 100)}%`;
}

function purityTake(entry, jars, high) {
  const order = high ? ['flawless', 'pure', 'standard', 'muddy'] : ['muddy', 'standard', 'pure', 'flawless'];
  const by = { muddy: 0, standard: 0, pure: 0, flawless: 0 };
  let left = jars;
  for (const p of order) {
    const take = Math.min(left, num(entry?.purity?.[p]));
    by[p] = take;
    left -= take;
    if (left <= 1e-9) break;
  }
  by.standard += Math.max(0, left);
  return by;
}

function bestPicks(routeId, capJars, t) {
  const s = S();
  const r = ROUTES_BY_ID[routeId];
  const d = sim().shipping.currentDemand(s, routeId, t);
  const list = Object.entries(s.stock || {}).filter(([, e]) => num(e?.jars) >= 1).map(([id, e]) => {
    const fam = eco().colorFamily(id);
    const on = !!r && (r.any || r.palette.includes(fam));
    return { id, jars: Math.floor(e.jars), score: (fam === d.family ? 2 : 0) + (on ? 1 : 0), price: eco().colorPrice(s, id) };
  }).sort((a, b) => b.score - a.score || b.price - a.price);
  const picks = {};
  let left = Math.floor(capJars);
  for (const x of list) {
    if (left <= 0) break;
    const j = Math.min(left, x.jars);
    if (j > 0) { picks[x.id] = j; left -= j; }
  }
  return picks;
}

function shipPicks(ss) {
  return Object.entries(ss.picks).filter(([, j]) => j > 0).map(([colorId, jars]) => ({ colorId, jars }));
}

function shipSheetHtml(ss) {
  const s = S();
  const t = now();
  const v = s.stations.fleet[ss.vehicle];
  const capJ = Math.floor(eco().vehicleCapacity(v));
  const routes = sim().shipping.availableRoutes(s, t);
  const route = ROUTES_BY_ID[ss.routeId];
  const stepN = Math.max(1, Math.floor(capJ / 10));
  const loaded = Object.values(ss.picks).reduce((a, b) => a + b, 0);
  const stock = Object.entries(s.stock || {}).filter(([, e]) => num(e?.jars) >= 1).map(([id, e]) => ({
    id, jars: Math.floor(e.jars), fam: eco().colorFamily(id), price: eco().colorPrice(s, id),
  }));
  const d = route ? sim().shipping.currentDemand(s, ss.routeId, t) : null;
  stock.sort((a, b) => ((b.fam === d?.family ? 2 : 0) + (route && (route.any || route.palette.includes(b.fam)) ? 1 : 0))
    - ((a.fam === d?.family ? 2 : 0) + (route && (route.any || route.palette.includes(a.fam)) ? 1 : 0)) || b.price - a.price);
  return h`<div class="hint">${VEHICLES_BY_ID[v.kind]?.name} holds ${fmt(capJ)} jars · ${waitText(ctx.format, sim().economy.vehicleTripMs(v))} round trip</div>
${route ? h`<div class="ws-banner">${demandText(ss.routeId, t)}</div>` : ''}
<div class="ws-sub-title" style="margin-top:0">Route</div>
${routes.map((r) => pickRow({ action: 'ship-route', attrs: { 'data-route': r.id }, lead: swatch(r.any ? '#B7BDB3' : '#9A6A47', 30), title: r.name, sub: r.blurb, on: r.id === ss.routeId }))}
<div class="ws-sub-title">Cargo · ${fmt(loaded)} jars loaded${capJ - loaded > 0 ? `, room for ${fmt(capJ - loaded)} more` : ', a full load'}</div>
${stock.length ? stock.map((c) => {
    const n = ss.picks[c.id] || 0;
    const wanted = route && (route.any || route.palette.includes(c.fam)) ? (c.fam === d?.family ? 'Wanted now' : 'Wanted') : '';
    return h`<div class="ws-pick" style="cursor:default">${swatch(hexOf(c.id), 36)}<span class="grow"><span class="pt">${nameOf(c.id)}</span><br><span class="ps">${fmt(c.jars)} on hand${wanted ? ` · ${wanted}` : ''}</span></span>
<span class="ws-stepper"><button type="button" class="ws-step" data-action="ship-step" data-color="${c.id}" data-delta="-${stepN}" data-tap aria-label="Less ${nameOf(c.id)}" aria-disabled="${n <= 0 ? 'true' : 'false'}">&minus;</button><span class="n num">${fmt(n)}</span><button type="button" class="ws-step" data-action="ship-step" data-color="${c.id}" data-delta="${stepN}" data-tap aria-label="More ${nameOf(c.id)}" aria-disabled="${n >= c.jars || loaded >= capJ ? 'true' : 'false'}">+</button></span></div>`;
  }) : h`<div class="muted">Make some color first, then come back to load the cart.</div>`}
<div class="ws-actions-row">${button('Fill best', { small: true, attrs: { 'data-action': 'ship-fill' } })}${button('Clear', { small: true, attrs: { 'data-action': 'ship-clear' } })}</div>`;
}

function shipFootHtml(ss) {
  const s = S();
  const t = now();
  const route = ROUTES_BY_ID[ss.routeId];
  const high = !!route?.wantsPurity;
  const cargo = shipPicks(ss).map((p) => ({ colorId: p.colorId, jars: p.jars, byPurity: purityTake(s.stock[p.colorId], p.jars, high) }));
  const value = route ? sim().shipping.cargoValue(s, ss.routeId, cargo, false, t) : 0;
  const packedValue = route ? sim().shipping.cargoValue(s, ss.routeId, cargo, true, t) : 0;
  const empty = cargo.length === 0;
  return h`<div class="semi">${empty ? 'Load some jars to see what they are worth' : `Worth about ${fmt(value)} Coins, or about ${fmt(packedValue)} packed by hand`}</div>
<div class="ws-actions-row">
${button('Pack by hand (+25%)', { cls: 'tall', attrs: { 'data-action': 'ship-pack', 'aria-disabled': empty ? 'true' : 'false' } })}
${button('Ship now', { variant: 'primary', cls: 'tall', attrs: { 'data-action': 'ship-go', 'aria-disabled': empty ? 'true' : 'false' } })}
</div>`;
}

function openShipSheet(vehicle) {
  closeSheet();
  const s = S();
  const t = now();
  const v = s.stations.fleet[vehicle];
  if (!v) return;
  const routes = sim().shipping.availableRoutes(s, t);
  if (!routes.length) { toast('Routes open up as your workshop grows.'); return; }
  const routeId = routes.some((r) => r.id === v.route) ? v.route : routes[0].id;
  const ss = { vehicle, routeId, picks: bestPicks(routeId, eco().vehicleCapacity(v), t) };
  const api = openSheet(root, {
    title: 'Send a shipment',
    html: String(shipSheetHtml(ss)),
    footer: String(shipFootHtml(ss)),
    onAction(name, el) {
      const st = S();
      const tt = now();
      const veh = st.stations.fleet[vehicle];
      const capJ = Math.floor(eco().vehicleCapacity(veh));
      const refresh = () => api.set(shipSheetHtml(ss), shipFootHtml(ss));
      if (name === 'ship-route') { ss.routeId = el.dataset.route; ss.picks = bestPicks(ss.routeId, capJ, tt); refresh(); return; }
      if (name === 'ship-fill') { ss.picks = bestPicks(ss.routeId, capJ, tt); refresh(); return; }
      if (name === 'ship-clear') { ss.picks = {}; refresh(); return; }
      if (name === 'ship-step') {
        const id = el.dataset.color;
        const delta = Number(el.dataset.delta);
        const have = Math.floor(num(st.stock[id]?.jars));
        const loaded = Object.values(ss.picks).reduce((a, b) => a + b, 0);
        let next = (ss.picks[id] || 0) + delta;
        next = Math.max(0, Math.min(have, next, (ss.picks[id] || 0) + (capJ - loaded)));
        ss.picks[id] = next;
        refresh();
        return;
      }
      if (name === 'ship-pack' || name === 'ship-go') {
        const cargo = shipPicks(ss).map((p) => ({ colorId: p.colorId, jars: Math.min(p.jars, Math.floor(num(st.stock[p.colorId]?.jars))) })).filter((p) => p.jars > 0);
        if (!cargo.length) { toast('Load a few jars first, then it is ready to roll.'); return; }
        if (name === 'ship-pack') {
          closeSheet();
          ctx.navigate('packing', { vehicle, routeId: ss.routeId, cargo });
          return;
        }
        const res = act(sim().shipping.dispatch, { vehicle, routeId: ss.routeId, cargo, packed: false });
        if (res && res.ok) {
          audio().clink(3);
          haptics().light();
          closeSheet();
          renderAll();
          toast(`Off to ${ROUTES_BY_ID[ss.routeId]?.name}, worth about ${fmt(res.value)}`);
          fx().squash(root.querySelector(`[data-row="fleet:${vehicle}"]`));
        } else toast('That vehicle is already on the road.');
      }
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'ship' };
}

function openRouteSheet(vehicle) {
  closeSheet();
  const s = S();
  const t = now();
  const v = s.stations.fleet[vehicle];
  if (!v) return;
  const routes = sim().shipping.availableRoutes(s, t);
  const html = h`<div class="hint">The Dispatcher sends this vehicle along its route as soon as it is loaded.</div>
${pickRow({ action: 'set-route', attrs: { 'data-route': '' }, lead: h`<span class="swatch is-empty" style="--size:30px"></span>`, title: 'No route yet', on: !v.route })}
${routes.map((r) => pickRow({ action: 'set-route', attrs: { 'data-route': r.id }, lead: swatch('#9A6A47', 30), title: r.name, sub: demandText(r.id, t) || r.blurb, on: v.route === r.id }))}`;
  const api = openSheet(root, {
    title: 'Dispatcher route',
    html: String(html),
    onAction(name, el) {
      if (name !== 'set-route') return;
      act(sim().shipping.setVehicleRoute, { vehicle, routeId: el.dataset.route || null });
      closeSheet();
      renderAll();
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'route' };
}

function openYardSheet() {
  closeSheet();
  const s = S();
  const t = now();
  const fl = s.stations.fleet || [];
  if (!(s.rooms || []).includes('loading-yard')) {
    const colors = sim().discoveredCount(s);
    const r = ROOMS.find((x) => x.id === 'loading-yard');
    toast(colors < r.colorsRequired ? `${moreColors(r.colorsRequired - colors)} and the Loading Yard can open` : 'The Loading Yard is waiting in the rooms list below.');
    return;
  }
  const routes = sim().shipping.availableRoutes(s, t);
  const html = h`${routes.map((r) => demandText(r.id, t)).filter(Boolean).map((x) => h`<div class="ws-banner">${x}</div>`)}
${fl.length ? fl.map((v, i) => {
    const busy = num(v.arrivesAt) > 0;
    const def = VEHICLES_BY_ID[v.kind];
    return pickRow({
      action: busy ? 'yard-busy' : 'yard-ship', attrs: { 'data-vehicle': String(i) }, lead: swatch('#9A6A47', 36),
      title: `${def?.name ?? 'Vehicle'} · Level ${v.level}`,
      sub: busy ? `Out, back in ${waitText(ctx.format, v.arrivesAt - t)}` : `Idle · holds ${fmt(eco().vehicleCapacity(v))} jars`,
      right: busy ? '' : h`<span class="chip">Ship</span>`,
    });
  }) : h`<div class="muted">No vehicles yet. Buy a cart in the Fleet panel below.</div>`}`;
  const api = openSheet(root, {
    title: 'Loading yard',
    html: String(html),
    onAction(name, el) {
      if (name === 'yard-ship') { openShipSheet(Number(el.dataset.vehicle)); }
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'yard' };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function lockedToast(msg) { toast(msg); }

function goto(screen, params) {
  if (screen === 'workshop') { focusPanel((params && (params.panel || params.upgrade)) || ''); return; }
  ctx.navigate(screen, params || {});
}

const UPGRADE_PANEL = { source: 'sources', grinder: 'grinders', mixer: 'mixers', vat: 'vats', shop: 'shop', fleet: 'fleet', cellar: 'cellar' };

function focusPanel(name) {
  if (name === 'bench') { ctx.navigate('bench', {}); return; }
  const key = UPGRADE_PANEL[name] || name;
  if (!['sources', 'grinders', 'mixers', 'vats', 'cellar', 'shop', 'fleet'].includes(key)) return;
  openPanels.add(key);
  savePanels();
  renderAll();
  const el = root.querySelector(`[data-pw="${key}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: fx().isReducedMotion() ? 'auto' : 'smooth' });
}

function needMore(cost) {
  const diff = Math.max(0, Math.ceil(cost - num(S().coins)));
  toast(`Just ${fmt(diff)} more Coins`);
}

function afterBuy(rowKey, res) {
  renderAll();
  const r = rowKey ? root.querySelector(`[data-row="${rowKey}"]`) : null;
  fx().squash(r);
  audio().thunk();
  haptics().light();
  if (res && res.milestone) {
    audio().clink(5);
    toast(`Level ${res.level}: output doubles!`);
  }
}

function buyFrom(el) {
  const kind = el.dataset.kind;
  const args = { kind };
  if (el.dataset.index !== undefined && el.dataset.index !== '') args.index = Number(el.dataset.index);
  if (el.dataset.id) args.id = el.dataset.id;
  const cost = Number(el.dataset.cost);
  if (cost > num(S().coins)) { needMore(cost); return; }
  const res = act(sim().factory.buyUpgrade, args);
  if (res && res.ok) {
    const key = kind === 'source' ? `source:${args.id}` : kind === 'cellar' || kind === 'shop' ? kind : `${kind}:${args.index}`;
    afterBuy(key, res);
  } else if (res && res.reason === 'slots') toast('All source slots are full for now. A hunter may find more room.');
  else if (res && res.reason === 'coins') needMore(res.cost);
}

async function doCollect() {
  const btn = refs.collect;
  const s = S();
  if (num(s.pendingCollect) < 1) return;
  coinHold = true;
  const flight = fx().flyTo(btn, refs.pill, '#C99A2E', { count: 6 });
  act(sim().factory.collect);
  audio().coins(6);
  haptics().ripple(3);
  renderAll();
  await flight;
  coinHold = false;
  patchCoins(S());
}

function doSuggestion(el) {
  const kind = el.dataset.kind;
  const s = S();
  if (kind === 'assign') { openRecipeSheet(Number(el.dataset.index || 0)); return; }
  if (!kind || kind === 'undefined') return;
  const cost = Number(el.dataset.cost);
  if (cost > num(s.coins)) { needMore(cost); return; }
  if (kind === 'room') {
    const res = act(sim().factory.buyRoom, { id: el.dataset.id });
    if (res && res.ok) afterBuy('', res);
    return;
  }
  const args = { kind };
  if (el.dataset.index !== '') args.index = Number(el.dataset.index);
  if (el.dataset.id) args.id = el.dataset.id;
  const res = act(sim().factory.buyUpgrade, args);
  if (res && res.ok) {
    const key = kind === 'source' ? `source:${args.id}` : kind === 'cellar' || kind === 'shop' ? kind : `${kind}:${args.index}`;
    afterBuy(key, res);
    fx().squash(refs.sugg);
  } else if (res && res.reason === 'coins') needMore(res.cost);
}

function doRush(el) {
  const i = Number(el.dataset.mixer);
  if (el.getAttribute('aria-disabled') === 'true') {
    const m = S().stations.mixers[i];
    toast(m && m.recipe ? rushWait(m) : 'Pick a recipe first, then rush it.');
    return;
  }
  const res = act(sim().factory.rush, { mixer: i });
  if (res && res.ok) {
    audio().glug(0.7);
    haptics().light();
    renderAll();
    fx().squash(root.querySelector(`[data-row="mixer:${i}"]`));
    toast(`Rushed ${fmt(res.jars)} jars`, { hex: hexOf(S().stations.mixers[i].recipe) });
  } else if (res && res.reason === 'full') toast('The vats are full, so there is no room for more yet.');
  else toast(rushWait(S().stations.mixers[i]));
}

/** "Rush again in 4 m": a gentle minutes-only note. */
function rushWait(m) {
  const left = num(m && m.rushedAt) + RUSH_COOLDOWN_MS - now();
  return left > 0 ? `Mixer is catching its breath. Rush again in ${waitText(ctx.format, left)}.` : 'Mixer is ready. Rush again.';
}

function doClaim(el) {
  const i = Number(el.dataset.mixer || 0);
  const res = act(sim().factory.claimAccident, { mixer: i });
  if (!res || !res.ok) return;
  audio().bell();
  haptics().success();
  renderAll();
  fx().ringBurst(el, '#E2B04A');
  if (res.kind === 'flawless') toast(res.jars > 0 ? `A flawless batch: ${fmt(res.jars)} jars` : 'A flawless batch for the shelf');
}

async function doCloseUp() {
  const r = await closeUpFlow(ctx, root);
  if (!r) return;
  closedInfo = { fillMs: r.fillMs };
  renderAll();
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.dataset.action;
  switch (a) {
    case 'settings': ctx.navigate('settings'); break;
    case 'collect': doCollect(); break;
    case 'suggestion': doSuggestion(el); break;
    case 'open-map':
      if (!sim().hunters.unlocked(S())) lockedToast(`Hunters set out once you have ${moreColors(10 - sim().discoveredCount(S()))}`);
      else ctx.navigate('map', {});
      break;
    case 'open-album': ctx.navigate('album', {}); break;
    case 'open-shelf':
      if (!sim().shelf.unlocked(S())) lockedToast(`${moreColors(5 - sim().discoveredCount(S()))} and the Merge Shelf opens`);
      else ctx.navigate('shelf', {});
      break;
    case 'open-bench': ctx.navigate('bench', {}); break;
    case 'open-gallery': {
      const s = S();
      const wing = (s.rooms || []).includes('gallery-wing') || s.gallery?.unlocked;
      if (!wing) {
        const need = 20 - sim().discoveredCount(s);
        lockedToast(need > 0 ? `${moreColors(need)} and the Gallery Wing can open` : 'The Gallery Wing is waiting in the rooms list below');
      } else ctx.navigate('gallery', {});
      break;
    }
    case 'open-quests': ctx.navigate('quests', {}); break;
    case 'open-ledger': ctx.navigate('ledger', {}); break;
    case 'open-commissions':
      if ((S().phase ?? 1) < 3) lockedToast(`Commissions open at 30 colors with the Loading Yard${sim().discoveredCount(S()) < 30 ? `: ${moreColors(30 - sim().discoveredCount(S()))} to go` : ''}`);
      else ctx.navigate('commissions', {});
      break;
    case 'open-yard': openYardSheet(); break;
    case 'claim-accident': doClaim(el); break;
    case 'vat-color': openVatSheet(Number(el.dataset.vat)); break;
    case 'toggle-panel': {
      const k = el.dataset.panel;
      if (openPanels.has(k)) openPanels.delete(k); else openPanels.add(k);
      savePanels();
      renderAll();
      break;
    }
    case 'buy': buyFrom(el); break;
    case 'buy-grinder-kind': {
      const cost = Number(el.dataset.cost);
      if (cost > num(S().coins)) { needMore(cost); break; }
      const i = Number(el.dataset.index);
      const res = act(sim().factory.upgradeGrinderKind, { index: i });
      if (res && res.ok) { afterBuy(`grinder:${i}`, { milestone: true, level: S().stations.grinders[i].level }); toast(`Upgraded to ${GRINDER_KINDS_BY_ID[res.kind]?.name}`); }
      break;
    }
    case 'mixer-recipe': openRecipeSheet(Number(el.dataset.mixer)); break;
    case 'rush': doRush(el); break;
    case 'buy-room': {
      const s = S();
      const r = ROOMS.find((x) => x.id === el.dataset.id);
      const need = r ? r.colorsRequired - sim().discoveredCount(s) : 0;
      if (need > 0) { toast(`${moreColors(need)} and this room opens`); break; }
      if (r && (s.phase ?? 1) < r.phase) { toast(`The ${r.name} opens after the ${r.phase >= 3 ? 'Loading Yard' : 'Mill Room'}`); break; }
      if (r && r.cost > num(s.coins)) { needMore(r.cost); break; }
      const res = act(sim().factory.buyRoom, { id: el.dataset.id });
      if (res && res.ok) { afterBuy('', { milestone: true }); toast(`${r.name} is open`); sigs.rooms = ''; }
      break;
    }
    case 'buy-apprentice': {
      const id = el.dataset.id;
      const ap = APPRENTICES.find((x) => x.id === id);
      if (ap && ap.cost > num(S().coins)) { needMore(ap.cost); break; }
      const res = act(sim().factory.buyApprentice, { id });
      if (res && res.ok) { afterBuy('', {}); toast(`${ap.name} joined the workshop`); }
      break;
    }
    case 'steward-toggle': act(sim().factory.setSteward, { on: !S().stewardOn }); renderAll(); break;
    case 'fleet-ship': openShipSheet(Number(el.dataset.vehicle)); break;
    case 'fleet-route': openRouteSheet(Number(el.dataset.vehicle)); break;
    case 'buy-vehicle': {
      const v = VEHICLES_BY_ID[el.dataset.kind];
      if (v && v.cost > num(S().coins)) { needMore(v.cost); break; }
      const res = act(sim().shipping.buyVehicle, { kind: el.dataset.kind });
      if (res && res.ok) afterBuy(`fleet:${res.index}`, {});
      else if (res && res.reason === 'slots') toast('Build the Loading Yard for room to park it');
      else if (res && res.reason === 'busy') toast('Wait for a vehicle to come home, then swap it in');
      else if (res && res.reason === 'same') toast('You already have that one in the yard');
      break;
    }
    case 'almost': {
      const it = almostCache.items[Number(el.dataset.i)];
      if (it) goto(it.screen, it.params);
      break;
    }
    case 'close-up': doCloseUp(); break;
    case 'close-up-reopen': closedInfo = null; sigs.closeup = ''; renderAll(); toast('Good morning! The shutters are up.'); break;
    default: break;
  }
}

function flush() {
  flushTimer = 0;
  if (dirty && !pointerDown) { dirty = false; renderAll(); }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const screen = {
  id: 'workshop',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    ensureStyles();
    root.innerHTML = shell();
    refs = {};
    root.querySelectorAll('[data-ref]').forEach((n) => { refs[n.dataset.ref] = n; });
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ws-hit')) {
        e.preventDefault();
        e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    root.addEventListener('pointerdown', () => { pointerDown = true; });
    const up = () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (dirty) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 80); }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    for (const k of Object.keys(sigs)) delete sigs[k];
    vatKeys.fill('');
    coinShown = null;
    renderAll(ctx.game.state);
  },

  show(params = {}) {
    if (!root) return;
    root.hidden = false;
    visible = true;
    almostCache = { at: -1e9, items: [] };
    closeSheet();
    renderAll();
    clearInterval(ticker);
    ticker = setInterval(() => { if (visible && !pointerDown) renderAll(); }, 1000);
    if (params.panel || params.upgrade) focusPanel(params.panel || params.upgrade);
    if (params.sheet === 'yard') openYardSheet();
    if (params.assign) assignFromCatalog(params.assign);
  },

  hide() {
    if (!root) return;
    visible = false;
    clearInterval(ticker);
    closeSheet();
    root.hidden = true;
  },

  render(state) {
    if (!visible && root && root.hidden) return;
    renderAll(state);
  },
};

export default screen;
export const id = screen.id;
export const mount = screen.mount;
export const show = screen.show;
export const hide = screen.hide;
export const render = screen.render;
