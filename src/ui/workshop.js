/**
 * workshop.js: the Workshop home screen (screen id `workshop`).
 *
 * Home (docs/V02-CONTRACTS.md, PLAN-v0.2 Theme A): the sticky head (title, the coin pill, which
 * becomes the Collect button with a "Collect 1.2K" label when the till has coins, the flow meter
 * and ONE primary "Next" button rendered from sim.next), the live scene (map window, corkboard,
 * display vats, mixer jars, merge shelf, bench, Gallery door, plus calendar, ledger book, jobs
 * scroll and loading yard), a 44 px sticky segmented control (Stations | Shipping once the yard
 * is bought | Rooms & staff) that shows one section at a time and remembers the last one in
 * localStorage['tincture.workshop.segment'], then "Almost there" and "Close up shop" at the bottom.
 * Deep links show({panel, upgrade, row, index, unlock, rebuy, sheet, vat, assign}) pick the segment,
 * scroll the row into view and flash it once. Scene objects are shortcuts: a mixer jar opens
 * Stations at that mixer, a vat opens its detail sheet, the yard opens Shipping.
 *
 * Locked things carry a price tag (kit.lockTag, then a paper button once the colors are met) and
 * open the "What this opens" sheet; buying plays a 1.5 s ceremony in the scene and emits
 * ctx.game 'unlocked' {id, object}. Level up rows show before -> after.
 *
 * Rendering: a stable DOM skeleton is built once in mount(). render(state) only patches
 * text/attributes in place, and rebuilds a section's innerHTML when that section's signature
 * changed (never while a pointer is down, so taps are not lost). Every dynamic string goes
 * through kit.h (escaped).
 *
 * Exports for other screens: openSheet(host, opts) and closeUpFlow(ctx, host) (ledger.js), plus
 * unlockTag(ctx, id), openUnlockSheet(ctx, id, {host}), unlockCeremony(objectId) and
 * openRecipeSheet(ctx, {mixer, colorId, onDone, host}), and ensureStyles().
 * Theme F (feel): also exports the touch-feel helpers the six order/workshop screens share (bindTouchFeel,
 * a thin wrapper over fx.touchFeel; squashOnce, flipLabel; PRESS_SEL).
 *
 * data-action names used here: settings, collect (the coin pill), next, segment, open-map,
 * open-album, open-shelf, open-bench, open-gallery, open-quests, open-ledger, open-commissions,
 * open-yard, goto-mixers, unlock-open, unlock-buy (in the sheet), keep-step (vat sheet), claim-accident,
 * vat-color, toggle-panel, buy, buy-grinder-kind, mixer-recipe, rush, buy-room, buy-apprentice,
 * steward-toggle, fleet-ship, fleet-route, buy-vehicle, almost, dismiss-whatsnew, close-up,
 * close-up-reopen.
 * data-coach targets: next (the big button), collect (the coin pill), vats, shelf, map-window,
 * gallery-door, mill-room, close-up, doors (plus bench, calendar, ledger-book, commissions,
 * loading-yard, almost-there, rooms).
 */

import {
  h, raw, button, iconSvg, swatch, escapeHtml, lighten, safeHex, vatSvg, tag, lockTag,
} from './kit.js';
import defaultFx, { touchFeel } from './fx.js';
import defaultAudio from './audio.js';
import defaultHaptics from './haptics.js';
import { ROOMS } from '../content/rooms.js';
import {
  GRINDER_KINDS_BY_ID, VEHICLES, VEHICLES_BY_ID, RUSH_COOLDOWN_MS, MIXER,
} from '../content/stations.js';
import { SOURCES_BY_ID } from '../content/sources.js';
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
// Touch feel (bindTouchFeel wraps fx.touchFeel; squashOnce and flipLabel are
// local to this screen group). The action always fires on
// release at once (a plain click); everything here is cosmetic and passive, so
// it never blocks scrolling and never waits for an animation.
// ---------------------------------------------------------------------------

export const PRESS_SEL = '.btn, .btn-back, .ws-step, .ws-pill[data-collect="on"], .seg-control > button, .ws-panel-head, .ws-almost-row, .switch';

const reduced = (fxo) => !!(fxo && fxo.isReducedMotion && fxo.isReducedMotion());

/**
 * bindTouchFeel(root, fx, {press, lift}): a thin wrapper over fx.touchFeel (press defaults to PRESS_SEL).
 * `lift` things scale up while held and settle on release (`data-lift="1.02"` picks a gentler scale and the
 * `.is-held` style); `press` things spring back after the CSS collapse. See fx.touchFeel for the 80 ms hold,
 * 6 px move-cancel and pointercancel rules.
 */
export function bindTouchFeel(rootEl, fxo, { press = PRESS_SEL, lift = '' } = {}) {
  const tf = fxo && typeof fxo.touchFeel === 'function' ? fxo.touchFeel : touchFeel;
  return tf(rootEl, { press, lift });
}

/** One squash per element per frame, and a new one replaces a running one: rapid taps never queue. */
const squashing = new WeakMap();
export function squashOnce(fxo, el) {
  if (!el) return Promise.resolve();
  if (squashing.has(el)) return squashing.get(el);
  const prev = typeof el.getAnimations === 'function' ? el.getAnimations().filter((a) => a.constructor === Animation && a.effect && a.effect.getTiming().duration === 250) : [];
  prev.forEach((a) => a.cancel());
  const p = Promise.resolve(fxo.squash(el));
  squashing.set(el, p);
  requestAnimationFrame(() => squashing.delete(el));
  return p;
}

/** A tiny paper flip when a button's label changes: fade and scale in, 120 ms. */
export function flipLabel(fxo, el) {
  if (!el) return Promise.resolve();
  if (reduced(fxo)) return fxo.fade(el);
  if (typeof el.animate !== 'function') return Promise.resolve();
  try {
    return el.animate([{ opacity: 0.25, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' }).finished.then(() => undefined, () => undefined);
  } catch (e) { return Promise.resolve(); }
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
.ws-title { flex: 1 1 auto; min-width: 0; font-family: var(--font-display); font-weight: 400; font-size: 18px; line-height: 1.15; letter-spacing: .2px; }
.ws-pill { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 12px 4px 8px; border-radius: 999px; background: var(--paper); box-shadow: 0 2px 0 var(--shadow); }
.ws-pill .v { font-weight: 700; font-size: 16px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.ws-pill .r { font-size: 11px; line-height: 1.1; color: var(--ink-soft); }
.ws-gear { position: relative; }
.ws-dot { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--walnut); box-shadow: 0 0 0 2px var(--paper); }
.ws-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 10px; background: linear-gradient(var(--plaster), rgba(227,230,224,0)); pointer-events: none; }
.btn.ws-sugg { min-height: 48px; width: 100%; padding: 0 14px; }
.btn.ws-sugg[data-state="wait"] { background-image: linear-gradient(90deg, rgba(247,244,236,.3) var(--p, 0%), rgba(247,244,236,0) var(--p, 0%)); }
.btn.ws-sugg[aria-disabled="true"] { opacity: 1; }
.ws-next { margin-top: -4px; font-size: 12px; line-height: 1.25; color: var(--ink-soft); text-align: center; }
.ws-head .seg-value { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-head .meter > .seg { padding: 8px 6px 8px 8px; }
.ws-tagpin { position: absolute; transform: translate(-50%, -50%); pointer-events: none; line-height: 1.1; z-index: 2; }
.ws-tagpin.l { transform: translate(0, -50%); }
.ws-tagpin.ws-off { display: none; }
.ws-lbl { font-family: 'Figtree', system-ui, sans-serif; font-size: 10px; font-weight: 600; fill: #5E5148; pointer-events: none; }
.ws-body { gap: 12px; }
.ws-scene { position: relative; margin: 0 calc(-1 * var(--gutter)); line-height: 0; }
.ws-svg { width: 100%; height: auto; display: block; }
.ws-hit { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
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
.ws-pick.is-held, .ws-sugg.is-held { box-shadow: 0 5px 0 var(--shadow); }
.ws-hit, .ws-pick, .ws-step, .ws-pill, .ws-panel-head, .ws-sugg { touch-action: manipulation; }
.ws-halo { pointer-events: none; }
.ws-halo.pulse { transform-box: fill-box; transform-origin: 50% 50%; animation-duration: 1.8s; }
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
.ws-dusk { position: absolute; inset: 0; z-index: 45; touch-action: manipulation; }
.ws-shutter { position: absolute; inset: 0; z-index: 3; overflow: hidden; border-radius: inherit; pointer-events: none; display: flex; align-items: flex-end; justify-content: center; line-height: 1.3;
  background: repeating-linear-gradient(#8A6A4C 0 14px, #6F5238 14px 16px); box-shadow: inset 0 -12px 0 rgba(0,0,0,.28), 0 5px 0 rgba(0,0,0,.35); }
.ws-shutter .cap { margin-bottom: 18px; padding: 8px 16px; border-radius: 999px; background: var(--paper); font-weight: 600; font-size: 15px; box-shadow: var(--cut); }
.ws-vglow { opacity: 0; pointer-events: none; transition: opacity 400ms ease-out; }
.ws-scene.is-dusk .ws-vglow { opacity: .6; }
.ws-shutter .vg { position: absolute; width: 74px; height: 120px; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(closest-side, rgba(255, 224, 140, .95), rgba(255, 214, 120, .45) 60%, rgba(255, 214, 120, 0)); pointer-events: none; }
.ws-switch-row { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.ws-switch-row .switch { position: relative; }
.ws-need { font-size: 13px; color: var(--ink-soft); }
.ws-pill { position: relative; flex: 0 0 auto; }
.ws-pill[data-collect="on"] { background: var(--glow); box-shadow: 0 0 0 2px var(--glow-ring), 0 2px 0 var(--shadow); cursor: pointer; animation: ws-pill-pulse 2.4s ease-in-out infinite; }
.ws-pill[data-collect="on"] .r { color: var(--glow-ink); font-weight: 700; font-size: 12px; }
.ws-pill[data-collect="on"]:active { transform: translateY(2px); animation: none; }
@keyframes ws-pill-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
.ws-segbar { position: sticky; top: 0; z-index: 3; margin: 0 calc(-1 * var(--gutter)); padding: 4px var(--gutter); background: var(--plaster); }
.ws-segbar .seg-control { padding: 0; gap: 3px; }
.ws-segbar .seg-control > button { min-height: 44px; padding: 0 6px; white-space: nowrap; }
.ws-segbar .seg-control > button[hidden] { display: none; }
.ws-body [data-sec]:empty { display: none; }
.ws-pane { display: flex; flex-direction: column; gap: 12px; }
.ws-pane[hidden] { display: none; }
.ws-pane [data-pw], .ws-pane [data-sec], .ws-pane .ws-row { scroll-margin-top: 58px; }
.ws-flash { animation: ws-flash 1.3s ease-out 1; border-radius: 12px; }
@keyframes ws-flash { 0% { box-shadow: 0 0 0 0 rgba(185,131,28,0); } 22% { box-shadow: 0 0 0 4px var(--glow-ring); background-color: var(--glow); } 100% { box-shadow: 0 0 0 0 rgba(185,131,28,0); } }
.ws-tagpin { display: flex; flex-direction: column; gap: 4px; align-items: center; width: max-content; max-width: var(--tw, 150px); }
.ws-tagpin.l { align-items: flex-start; }
.ws-tagpin .tag { white-space: normal; max-width: var(--tw, 150px); line-height: 1.2; padding-top: 4px; padding-bottom: 4px; text-align: left; }
.ws-tagpin .ws-waiting { background: var(--glow); color: var(--glow-ink); }
.ws-unlockbtn { position: relative; min-height: 44px; padding: 6px 12px; font-size: 12px; line-height: 1.2; text-align: left; justify-content: flex-start; max-width: 100%; white-space: normal; }
.ws-tagpin .ws-unlockbtn { pointer-events: auto; max-width: var(--tw, 150px); }
.ws-main .tag, .ws-actions .tag { white-space: normal; max-width: 100%; text-align: left; line-height: 1.25; padding-top: 4px; padding-bottom: 4px; }
.ws-main .ws-unlockbtn { max-width: 100%; }
.ws-unlockbtn.is-next { background: #FFF6DF; box-shadow: 0 0 0 2.5px var(--ink), 0 3px 0 var(--shadow); font-weight: 700; }
.ws-unlockbtn.is-ready { font-weight: 700; }
.ws-dim { opacity: .55; }
.ws-ill { display: flex; justify-content: center; padding: 6px 0 2px; }
.ws-ill svg { width: 100%; max-width: 250px; max-height: 190px; height: auto; overflow: visible; }
.ws-ill .ws-pulse { animation: ws-pulse 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes ws-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
.ws-unlock-name { font-family: var(--font-display); font-size: 20px; line-height: 1.2; text-align: center; }
.ws-unlock-says { font-size: 15px; line-height: 1.35; text-align: center; }
.ws-unlock-price { display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; font-size: 17px; font-variant-numeric: tabular-nums; }
.ws-unlock-note { font-size: 13px; color: var(--ink-soft); text-align: center; }
.ws-cer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; overflow: visible; }
.ws-cer-tag { position: absolute; z-index: 6; pointer-events: none; }
.ws-note { background: var(--paper); }
.ws-note ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; line-height: 1.35; }
.ws-keep { display: flex; align-items: center; gap: 8px; }
.ws-keep .grow { min-width: 0; }
.ws-vat-head { display: flex; align-items: center; gap: 12px; }
.ws-vat-facts { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.ws-use { font-size: 12px; color: var(--walnut); }
@media (prefers-reduced-motion: reduce) { .ws-pill[data-collect="on"], .ws-ill .ws-pulse, .ws-flash { animation: none; } }
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

/**
 * The Close up shop moment (1.5 s at most, skippable with a tap): the lights dim (fx.dim), a drawn
 * shutter lowers over the scene card with a heavy spring, the vats glow, then it all lifts away.
 * `target` is the card the shutter drops over (default: the workshop scene, else the ledger page).
 */
function playDusk(host, fxo, target) {
  const d = doc();
  const skip = d.createElement('div');
  skip.className = 'ws-dusk';
  skip.setAttribute('aria-hidden', 'true');
  host.appendChild(skip);
  const scene = target || host.querySelector('.ws-scene') || host.querySelector('.ld-page');
  const shutter = d.createElement('div');
  shutter.className = 'ws-shutter';
  // In the workshop the vats glow through the slats (positions are the scene's, in percent of its 390 x 440 art).
  const glows = scene && scene.classList.contains('ws-scene')
    ? [0, 1, 2].map((i) => `<i class="vg" style="left:${((65 + i * 66) / 390 * 100).toFixed(1)}%;top:${(196 / 440 * 100).toFixed(1)}%"></i>`).join('') : '';
  shutter.innerHTML = `${glows}<div class="cap">Shutters down for the night</div>`;
  if (scene) {
    try {
      const r = scene.getBoundingClientRect();
      if (r.top < 40 || r.bottom > innerHeight) scene.scrollIntoView({ block: 'start', behavior: 'auto' }); // instant: a smooth scroll would swallow the tap that skips the ritual
    } catch (e) { /* ignore */ }
    scene.appendChild(shutter);
    scene.classList.add('is-dusk');
  }
  if (fxo && fxo.dim) fxo.dim(true);
  if (scene && fxo.spring) fxo.spring(shutter, { from: { transform: 'translateY(-100%)' }, to: { transform: 'translateY(0%)' }, preset: 'heavy', fill: 'forwards' });
  return new Promise((resolve) => {
    let over = false;
    let tLift = 0;
    let tEnd = 0;
    const finish = () => {
      if (over) return;
      over = true;
      clearTimeout(tLift);
      clearTimeout(tEnd);
      skip.remove();
      shutter.remove();
      if (scene) scene.classList.remove('is-dusk');
      if (fxo && fxo.dim) fxo.dim(false);
      resolve();
    };
    skip.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); finish(); });
    tLift = setTimeout(() => {
      if (over) return;
      if (fxo && fxo.dim) fxo.dim(false);
      if (!reduced(fxo) && typeof shutter.animate === 'function') {
        try { shutter.animate([{ transform: 'translateY(0%)' }, { transform: 'translateY(-100%)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }); } catch (e) { /* ignore */ }
      } else if (typeof shutter.animate === 'function') {
        try { shutter.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }); } catch (e) { /* ignore */ }
      }
    }, 1200);
    tEnd = setTimeout(finish, 1500);
  });
}

/**
 * closeUpFlow(ctx, host) -> Promise<{fillMs, huntersSent, mixersQueued} | null>.
 * The shared "Close up shop" ritual: confirm sheet, closeUpShop, evening chord,
 * a 1.5 s dim. Resolves null when she chooses "Not yet".
 */
export function closeUpFlow(ctx, host, { target = null } = {}) {
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
        playDusk(host, fx, target).then(() => resolve(res || { fillMs: sim.storage.fillTimeMs(ctx.game.state) }));
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
const vatPrev = [null, null, null]; // {color, ratio} last drawn, so a changed fill level can spring
let jarCount = null;
const renderMemo = { on: false, has: false, next: null }; // sim.next computed once per render
let segment = 'stations';
let ceremonySnap = null;
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

const MAX_JARS = 6; // mixer jars drawn on the bench's lower shelf

/** A hung paper tag over the scene (an HTML kit.tag, positioned in the 390 x 440 scene's percent space). */
function tagPin(key, x, y, tw = 150, anchor = 'c') {
  return `<span class="ws-tagpin ws-off${anchor === 'l' ? ' l' : ''}" data-tag="${key}" style="left:${(x / 390 * 100).toFixed(2)}%;top:${(y / 440 * 100).toFixed(2)}%;--tw:${tw}px"></span>`;
}

function hit(x, y, w, hgt) {
  return `<rect class="ws-focus" x="${x}" y="${y}" width="${w}" height="${hgt}" rx="8"/>`;
}

// The scene's objects, drawn once and reused by the "What this opens" sheet.
// `f` is the id of the drop-shadow filter in the SVG that hosts the drawing.
const artWindow = (f) => `<g filter="url(#${f})">
<rect x="18" y="26" width="128" height="104" rx="8" fill="#7B5236"/>
<rect x="26" y="34" width="112" height="88" rx="4" fill="#CFE0E2"/>
<circle cx="112" cy="58" r="11" fill="#E2B04A"/>
<path d="M26 98 C50 76 72 80 92 92 C108 84 124 82 138 90 L138 122 L26 122 Z" fill="#8FA77A"/>
<path d="M26 108 C48 96 74 100 100 112 C116 106 128 106 138 110 L138 122 L26 122 Z" fill="#6E8B5E"/>
<rect x="80" y="34" width="4" height="88" fill="#7B5236"/>
<rect x="26" y="76" width="112" height="4" fill="#7B5236"/>
</g>`;

const SHUTTER_HALF = (x, w) => `<rect x="${x}" y="34" width="${w}" height="88" rx="3" fill="#8A6A4C"/><g fill="#6F5238"><rect x="${x}" y="46" width="${w}" height="2"/><rect x="${x}" y="58" width="${w}" height="2"/><rect x="${x}" y="70" width="${w}" height="2"/><rect x="${x}" y="82" width="${w}" height="2"/><rect x="${x}" y="94" width="${w}" height="2"/><rect x="${x}" y="106" width="${w}" height="2"/></g>`;

const artShelf = (f, { vials = true } = {}) => `<g filter="url(#${f})">
<rect x="250" y="146" width="122" height="104" rx="6" fill="#7B5236"/>
<rect x="256" y="152" width="110" height="44" rx="2" fill="#5E3E28"/>
<rect x="256" y="200" width="110" height="44" rx="2" fill="#5E3E28"/>
${vials ? SHELF_SLOTS.map(([x, y, w, hh, rx, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${rx}" fill="${fill}"/>`).join('') : ''}
</g>`;

const artDoor = (f) => `<g filter="url(#${f})">
<path d="M270 360 L270 300 C270 272 290 258 316 258 C342 258 362 272 362 300 L362 360 Z" fill="#6A4630"/>
<path d="M280 360 L280 302 C280 280 296 268 316 268 C336 268 352 280 352 302 L352 360 Z" fill="#8A5E40"/>
<path d="M298 296 C298 284 306 278 316 278 C326 278 334 284 334 296 L334 312 L298 312 Z" fill="#2A2622"/>
<path d="M300 296 C300 286 307 281 315 280 L315 310 L300 310 Z" fill="#3E6A9E"/>
<path d="M317 280 C325 281 332 286 332 296 L332 310 L317 310 Z" fill="#D39B2A"/>
<circle cx="344" cy="330" r="4" fill="#E2B04A"/>
<rect x="282" y="232" width="68" height="22" rx="3" fill="#F7F4EC"/>
</g>
<text x="316" y="247" fill="#2A2622" text-anchor="middle" style="font-family:'Young Serif',Georgia,serif;font-size:12px">Gallery</text>`;

const CART = `<rect x="36" y="360" width="22" height="18" rx="2" fill="#C9A277"/>
<rect x="36" y="368" width="22" height="2" fill="#A87449"/>
<rect x="62" y="365" width="20" height="13" rx="2" fill="#B98E64"/>
<rect x="30" y="378" width="62" height="20" rx="3" fill="#7B5236"/>
<rect x="30" y="384" width="62" height="2" fill="#5E3E28"/>
<path d="M92 384 L112 372" stroke="#5E3E28" style="stroke-width:3;stroke-linecap:round" fill="none"/>
<circle cx="46" cy="402" r="9" fill="#5E3E28"/><circle cx="46" cy="402" r="3.5" fill="#B98E64"/>
<circle cx="78" cy="402" r="9" fill="#5E3E28"/><circle cx="78" cy="402" r="3.5" fill="#B98E64"/>`;
const artYard = (f) => `<g filter="url(#${f})" data-art="yard">${CART}</g>`;

const artJobs = (f) => `<g filter="url(#${f})">
<rect x="0" y="0" width="26" height="6" rx="3" fill="#7B5236"/>
<rect x="2" y="5" width="22" height="36" fill="#F7F4EC"/>
<rect x="0" y="40" width="26" height="6" rx="3" fill="#7B5236"/>
<rect x="6" y="12" width="14" height="2" fill="#B7BDB3"/><rect x="6" y="18" width="14" height="2" fill="#B7BDB3"/><rect x="6" y="24" width="9" height="2" fill="#B7BDB3"/>
<circle cx="18" cy="32" r="4" fill="#C99A2E"/>
</g>`;

function mixerJarsSvg() {
  let out = '<rect x="38" y="352" width="182" height="5" rx="2" fill="#5E3E28"/>';
  for (let i = 0; i < MAX_JARS; i++) {
    const x = 44 + i * 28;
    out += `<g class="ws-hit ws-off" data-jar="${i}" data-action="goto-mixers" data-mixer="${i}" data-tap role="button" tabindex="0" aria-label="Mixer ${i + 1}: open the mixers list">
<g filter="url(#ws-cut)"><rect x="${x + 3}" y="322" width="14" height="5" rx="2" fill="#C9A277"/>
<rect x="${x}" y="326" width="20" height="26" rx="6" fill="#F2F4F0"/>
<rect data-jar-fill="${i}" x="${x}" y="338" width="20" height="14" rx="6" fill="#B7BDB3"/>
<rect x="${x}" y="326" width="20" height="26" rx="6" fill="none" stroke="#2A2622" stroke-width="1.6"/></g>
<rect class="ws-focus" x="${x - 4}" y="316" width="28" height="42" rx="6"/></g>`;
  }
  return out;
}

/** What each unlock opens in the scene, what it does, and how the sheet draws it. */
const UNLOCK_INFO = {
  shelf: {
    object: 'shelf', short: 'Shelf', says: 'Drag matching vials together to merge them, and line up six of one color family to sell them together.',
    vb: '240 140 142 120', art: (f) => artShelf(f),
  },
  hunters: {
    object: 'map-window', short: 'Map window', says: 'Hue Hunters head out from the window and come back with new colors, sources and postcards.',
    vb: '8 18 148 122', art: (f) => artWindow(f),
  },
  gallery: {
    object: 'gallery-door', short: 'Gallery', says: 'Paint with the jars you make and hang your pieces, and visitors pay admission to see them.',
    vb: '256 226 120 140', art: (f) => artDoor(f),
  },
  shipping: {
    object: 'yard', short: 'Loading yard', says: 'Carts carry your jars to towns that pay more, and crates you pack by hand earn extra.',
    vb: '20 352 110 66', art: (f) => artYard(f),
  },
  commissions: {
    object: 'commissions', short: 'Commissions', says: 'Big projects for the town, delivered a few jars at a time, with trophies for the workshop.',
    vb: '-6 -6 38 58', art: (f) => artJobs(f),
  },
};
const ROOM_UNLOCK = { 'gallery-wing': 'gallery', 'loading-yard': 'shipping' };

function sceneSvg() {
  const vats = [0, 1, 2].map((i) => {
    const bx = 38 + i * 66;
    return `<g class="ws-hit" data-action="vat-color" data-vat="${i}" data-tap role="button" tabindex="0" aria-label="Vat ${i + 1}: details">
<ellipse class="ws-vglow" cx="${bx + 27}" cy="196" rx="40" ry="66" fill="#FFD878"/><g data-vat-art="${i}" transform="translate(${bx - 6} 138)"></g>${hit(bx - 4, 138, 58, 112)}</g>`;
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
${artWindow('ws-cut')}
<g data-shutters="map" class="ws-off">${SHUTTER_HALF(26, 54)}${SHUTTER_HALF(84, 54)}<rect x="18" y="26" width="128" height="104" rx="8" fill="none" stroke="#5E3E28" stroke-width="2"/></g>
${hit(18, 26, 128, 104)}</g>

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
<g transform="translate(205 40)">${artJobs('ws-cut')}</g>
<g data-veil="commissions" class="ws-off"><rect x="203" y="38" width="30" height="50" rx="4" fill="#E3E6E0" fill-opacity=".55"/></g>
<text class="ws-lbl" x="218" y="100" text-anchor="middle">Jobs</text>${hit(196, 34, 44, 72)}</g>

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
<g data-shelf-cover class="ws-off">
<rect x="256" y="152" width="110" height="92" rx="2" fill="#F2F4F0" fill-opacity=".58"/>
<path d="M262 156 L286 156 L262 196 Z" fill="#FFFFFF" fill-opacity=".4"/>
<g fill="#CFC6B8" fill-opacity=".85"><circle cx="270" cy="228" r="2"/><circle cx="296" cy="236" r="1.6"/><circle cx="324" cy="224" r="2.2"/><circle cx="352" cy="234" r="1.8"/><circle cx="340" cy="176" r="1.6"/><circle cx="288" cy="190" r="1.4"/></g>
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
</g>${hit(14, 250, 192, 56)}</g>
${mixerJarsSvg()}
${labels}

<g data-accident class="ws-off ws-glow" pointer-events="none">
<path d="M150 224 l3 -9 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 z" fill="#FFF3C4"/>
<path d="M44 236 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z" fill="#FFF3C4"/>
</g>
<rect class="ws-halo ws-off" data-accident-halo x="99" y="203" width="76" height="36" rx="18" fill="none" stroke="#B9831C" stroke-opacity=".6" stroke-width="2.5"/>
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
${artDoor('ws-cut')}
<g data-veil="gallery" class="ws-off"><path d="M270 360 L270 300 C270 272 290 258 316 258 C342 258 362 272 362 300 L362 360 Z" fill="#E3E6E0" fill-opacity=".5"/>
<g transform="translate(305 326)" fill="none" stroke="#2A2622" stroke-width="2.4" stroke-linecap="round"><rect x="0" y="8" width="22" height="16" rx="3" fill="#F7F4EC"/><path d="M5 8 V4 A6 6 0 0 1 17 4 V8"/></g></g>
${hit(270, 232, 92, 128)}</g>

<g class="ws-hit" data-action="open-yard" data-coach="loading-yard" data-tap role="button" tabindex="0" aria-label="Loading yard: ship your colors">
${artYard('ws-cut')}
<g data-veil="yard" class="ws-off"><rect x="26" y="356" width="92" height="52" rx="6" fill="#9A6A47" fill-opacity=".55"/><path d="M26 392 H118" stroke="#C9A277" stroke-width="3" stroke-dasharray="7 5" stroke-linecap="round"/></g>
${hit(24, 356, 96, 62)}</g>

</svg>${tagPin('map', 82, 84, 112)}${tagPin('shelf', 311, 200, 104)}${tagPin('gallery', 316, 318, 100)}${tagPin('yard', 12, 412, 200, 'l')}${tagPin('commissions', 214, 120, 190)}`;
}

function shell() {
  return String(h`
<div class="screen-head ws-head">
  <div class="ws-top">
    <h1 class="ws-title">Tincture Workshop</h1>
    <div class="ws-pill" data-ref="pill" data-coach="collect" aria-live="off">
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
  <button type="button" class="btn btn-primary ws-sugg" data-action="next" data-coach="next" data-ref="sugg" data-cost="0" data-lift="1.025" data-tap>Next</button>
  <div class="ws-next" data-ref="next" hidden></div>
</div>
<div class="screen-body ws-body" data-ref="body">
  <div data-sec="whatsnew"></div>
  <div class="ws-scene" data-ref="scene">${raw(sceneSvg())}</div>
  <div class="ws-segbar" data-ref="segbar">
    <div class="seg-control" role="group" aria-label="Workshop sections">
      <button type="button" data-action="segment" data-segment="stations" data-tap aria-pressed="true">Stations</button>
      <button type="button" data-action="segment" data-segment="shipping" data-tap aria-pressed="false" hidden>Shipping</button>
      <button type="button" data-action="segment" data-segment="rooms" data-tap aria-pressed="false">Rooms &amp; staff</button>
    </div>
  </div>
  <div class="ws-pane" data-pane="stations">
    ${['sources', 'grinders', 'mixers', 'vats', 'cellar', 'shop'].map((k) => h`<div data-pw="${k}"></div>`)}
  </div>
  <div class="ws-pane" data-pane="shipping" hidden>
    <div data-pw="fleet"></div>
  </div>
  <div class="ws-pane" data-pane="rooms" hidden>
    <div data-sec="rooms"></div>
    <div data-sec="doors"></div>
    <div data-sec="apprentices"></div>
  </div>
  <div data-sec="almost"></div>
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
  return !!(s.unlocks && s.unlocks.shipping) || (s.stations.fleet || []).length > 0;
}

/** "0.08 → 0.11 a second": a Level up row's before and after. */
const ba = (before, after, unit) => `${fmtRate(before)} \u2192 ${fmtRate(after)} ${unit}`;

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
          const outNext = eco().stationOutput('source', L + 1, id) * pm;
          // A source lent by the weekly event (Deep Sea twist) goes back at the week's end.
          const loan = st.sources[id].eventLoan ? h` <span class="tag ws-loan" data-loan="${id}">this week</span>` : '';
          return row({
            key: `source:${id}`,
            lead: swatch(pig?.hex ?? hexOf(id), 36),
            title: h`${def?.name ?? cap1(id)}${loan}`,
            sub: L > 0 ? `Level ${L} · ${ba(out, outNext, 'a second')}` : `Found by a hunter · ${fmtRate(out)} a second when built`,
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
          const outNext = eco().stationOutput('grinder', g.level + 1, g.kind) * pm;
          const bonus = def?.purityBonus > 0 ? ` · ${Math.round(def.purityBonus * 100)}% purer batches` : '';
          return row({
            key: `grinder:${i}`,
            lead: swatch('#B9B3A8', 36),
            title: def?.name ?? 'Grinder',
            sub: `Level ${g.level} · ${ba(out, outNext, 'pigment a second')}${bonus}`,
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
      const mq = sim().factory.mixerPurchase(s);
      return {
        sig: ms.map((m) => `${m.recipe}:${m.level}:${m.accident ? 1 : 0}:${m.recipe ? nameOf(m.recipe) : ''}`).join(',') + `|${mq.available ? Math.round(mq.cost) : 'x'}`,
        summary: busy === 0 ? `${ms.length} ready for a recipe` : busy === ms.length ? `${busy} busy` : `${busy} busy, ${ms.length - busy} free`,
        rows: () => h`${ms.map((m, i) => {
          const rate = eco().stationOutput('mixer', m.level) * pm;
          const rateNext = eco().stationOutput('mixer', m.level + 1) * pm;
          const lead = m.recipe ? swatch(hexOf(m.recipe), 36) : h`<span class="swatch is-empty" style="--size:36px" aria-hidden="true"></span>`;
          const bar = m.recipe ? h`<div class="progress mt-1" role="progressbar" aria-label="Batch progress" data-mixer-bar="${i}"><span style="width:0%"></span></div>` : '';
          return row({
            key: `mixer:${i}`,
            lead: h`<button type="button" class="ws-pickbtn" data-action="mixer-recipe" data-mixer="${i}" data-tap aria-label="Choose a recipe for mixer ${i + 1}">${lead}</button>`,
            title: m.recipe ? `Mixer ${i + 1}: ${nameOf(m.recipe)}` : `Mixer ${i + 1}: choose a recipe`,
            sub: `Level ${m.level} · ${ba(rate, rateNext, 'jars a second')}`,
            hint: milestoneHint(m.level),
            extra: h`<div class="ws-use">${m.recipe ? 'Tap the swatch to change what it makes' : 'Tap the swatch to pick what it makes'}</div>${bar}${m.accident ? button('A happy accident! Tap to claim', { small: true, cls: 'ws-claim', attrs: { 'data-action': 'claim-accident', 'data-mixer': String(i) } }) : ''}`,
            actions: h`${buyBtn('Level up', eco().stationCost('mixer', m.level), { 'data-action': 'buy', 'data-kind': 'mixer', 'data-index': String(i) })}${button('Rush', { small: true, cls: 'ws-rush', attrs: { 'data-action': 'rush', 'data-mixer': String(i), 'data-rush': String(i) } })}`,
          });
        })}${mq.available ? row({
          key: 'mixer:new',
          lead: h`<span class="swatch is-empty" style="--size:36px" aria-hidden="true"></span>`,
          title: 'Add a mixer',
          sub: 'Another jar on the bench: one more recipe running at once',
          actions: buyBtn('Buy', mq.cost, { 'data-action': 'buy-mixer' }),
        }) : ''}`,
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
          sub: `Level ${v.level} · holds ${fmt(eco().stationOutput('vat', v.level))} \u2192 ${fmt(eco().stationOutput('vat', v.level + 1))} jars`,
          hint: milestoneHint(v.level, 'capacity'),
          actions: buyBtn('Level up', eco().stationCost('vat', v.level), { 'data-action': 'buy', 'data-kind': 'vat', 'data-index': String(i) }),
        })),
      };
    }
    case 'cellar': {
      const lvl = num(s.cellarLevel, 1);
      const cap = sim().storage.capacity(s);
      const capNext = sim().storage.capacity({ ...s, cellarLevel: lvl + 1 });
      return {
        sig: `${lvl}:${cap.cellar}`,
        summary: `Level ${lvl}`,
        rows: () => row({
          key: 'cellar',
          lead: swatch('#6A4630', 36),
          title: 'Cellar',
          sub: `Level ${lvl} · holds ${fmt(cap.cellar)} \u2192 ${fmt(capNext.cellar)} jars`,
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
          sub: `Level ${L} · sells ${ba(eco().stationOutput('shop', L), eco().stationOutput('shop', L + 1), 'jars a second')} · prices +${Math.round((eco().shopPriceBonus(s) - 1) * 100)}% \u2192 +${Math.round((eco().shopPriceBonus({ stations: { shop: { level: L + 1 } } }) - 1) * 100)}%`,
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
              sub: h`<span data-veh-status="${i}">${busy ? 'Out' : 'Idle'}</span> · holds ${fmt(capJ)} \u2192 ${fmt(eco().vehicleCapacity({ ...v, level: v.level + 1 }))} jars`,
              hint: milestoneHint(v.level, 'capacity'),
              extra: dispatcher ? h`<div class="mt-1">${button(`Route: ${route ? route.name : 'none yet'}`, { small: true, attrs: { 'data-action': 'fleet-route', 'data-vehicle': String(i) } })}</div>` : '',
              actions: h`${busy ? '' : button('Ship', { small: true, attrs: { 'data-action': 'fleet-ship', 'data-vehicle': String(i) } })}${buyBtn('Level up', eco().stationCost('vehicle', v.level, v.kind), { 'data-action': 'buy', 'data-kind': 'fleet', 'data-index': String(i) })}`,
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
  patchPill(s, t);

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
  patchNext(s, t);
}

/** sim.next(state, now) -> {label, action, cost?, affordable}, or null before the sim has one. */
function nextOf(s, t) {
  if (renderMemo.on) {
    if (renderMemo.has) return renderMemo.next;
    renderMemo.has = true;
  }
  let n = null;
  try { n = typeof sim().next === 'function' ? sim().next(s, t) || null : null; } catch (e) { console.error('next failed', e); }
  if (renderMemo.on) renderMemo.next = n;
  return n;
}

/** The unlock id Next is pointing at ('' when it points at an upgrade, Collect or a screen). */
function nextUnlockId(n) {
  const a = n && n.action;
  if (!a || typeof a !== 'object') return '';
  return (a.kind === 'unlock' || a.type === 'unlock') ? String(a.id || '') : '';
}

/** The ONE primary button on home: whatever sim.next says is the next good thing. */
function patchNext(s, t) {
  const b = refs.sugg;
  const n = nextOf(s, t);
  const coins = num(s.coins);
  const cost = num(n && n.cost);
  const waiting = !!n && cost > 0 && n.affordable === false;
  const label = (n && n.label) || 'Everything is humming';
  if (b.textContent !== label) {
    const had = b.dataset.shown === '1';
    b.textContent = label;
    b.dataset.shown = '1';
    if (had) flipLabel(fx(), b);
  }
  const state = waiting ? 'wait' : 'go';
  if (b.dataset.state !== state) b.dataset.state = state;
  b.setAttribute('aria-disabled', waiting ? 'true' : 'false');
  b.style.setProperty('--p', `${Math.round(clamp01(cost > 0 ? coins / cost : 0) * 100)}%`);
  b.dataset.cost = String(cost > 0 ? cost : 0);
  const a = n && n.action;
  b.dataset.kind = (a && (a.kind || a.type)) || '';
  const hint = waiting ? `${fmt(Math.max(1, Math.ceil(cost - coins)))} more coins` : '';
  const nx = refs.next;
  if (nx.textContent !== hint) nx.textContent = hint;
  if (nx.hidden !== !hint) nx.hidden = !hint;
}

/** The coin pill: coins and rate; when the till has coins waiting it becomes the Collect button. */
function patchPill(s, t) {
  const rate = eco().incomeRate(s, t);
  const pending = Math.floor(num(s.pendingCollect));
  const on = pending >= 1;
  const p = refs.pill;
  if ((p.dataset.collect === 'on') !== on) {
    if (on) {
      p.dataset.collect = 'on';
      p.dataset.action = 'collect';
      p.setAttribute('role', 'button');
      p.setAttribute('tabindex', '0');
      p.setAttribute('data-tap', '');
    } else {
      delete p.dataset.collect;
      delete p.dataset.action;
      p.removeAttribute('role');
      p.removeAttribute('tabindex');
      p.removeAttribute('data-tap');
      p.removeAttribute('aria-label');
    }
  }
  if (on) p.setAttribute('aria-label', `Collect ${fmt(pending)} coins`);
  const rt = on ? `Collect ${fmt(pending)}` : rate > 0 ? ctx.format.rate(rate) : 'Just starting';
  if (refs.rate.textContent !== rt) refs.rate.textContent = rt;
  patchCoins(s);
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

/** Hang (or take down) a paper tag, or a paper button, over a scene object. */
function setTag(key, html) {
  const g = root.querySelector(`[data-tag="${key}"]`);
  if (!g) return;
  const str = String(html || '');
  const on = !!str;
  g.classList.toggle('ws-off', !on);
  if (!on) { delete g.dataset.sig; return; }
  if (g.dataset.sig !== str) {
    g.dataset.sig = str;
    g.innerHTML = str;
  }
}

const moreColors = (n) => `${n} more color${n === 1 ? '' : 's'}`;

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

/**
 * Animate a vat's liquid from `fromRatio` to `toRatio`: the freshly drawn fill rects start offset by the
 * difference and spring to rest. The body rect is drawn 98 units taller (the glass clips it) so a draining level
 * never shows a gap. Skips tiny changes and an emptied vat (no fill layer to move).
 */
function springFill(svg, fromRatio, toRatio) {
  const layer = svg.querySelector('[data-fill-layer]');
  const d = 98 * (toRatio - fromRatio);
  if (!layer || Math.abs(d) < 0.4) return;
  layer.querySelectorAll('rect').forEach((r, i) => {
    if (i === 0) r.setAttribute('height', String(Number(r.getAttribute('height')) + 98)); // the body; the surface band keeps its 7 units
    fx().spring(r, { from: { transform: `translateY(${d.toFixed(2)}px)` }, to: { transform: 'translateY(0px)' }, preset: 'soft' });
  });
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
      const before = vatPrev[i];
      vatPrev[i] = { color: v.color, ratio };
      art.innerHTML = String(vatSvg(ratio, v.color ? hexOf(v.color) : NEUTRAL, { size: 66 }));
      const svg = art.querySelector('svg');
      if (svg) {
        svg.setAttribute('aria-hidden', 'true');
        // The level rises (or drops) on a soft spring instead of snapping to the new height.
        if (before && before.color === v.color && visible) springFill(svg, before.ratio, ratio);
      }
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
  // The pill's halo breathes (fx.pulse); the tappable pill itself stays still, so it is easy to hit and to automate.
  const halo = root.querySelector('[data-accident-halo]');
  halo.classList.toggle('ws-off', acc.length === 0);
  fx().pulse(halo, acc.length > 0);
  if (acc.length) {
    pill.dataset.mixer = String(acc[0]);
    const txt = acc.length > 1 ? `Claim ${acc.length}` : 'Tap to claim';
    const pt = pill.querySelector('[data-pill-text]');
    if (pt.textContent !== txt) pt.textContent = txt;
  }

  // Mixer jars on the bench's lower shelf: one per mixer, tinted by its recipe; the newest pops in.
  const mixers = s.stations.mixers || [];
  root.querySelectorAll('[data-jar]').forEach((g) => {
    const i = Number(g.dataset.jar);
    const m = mixers[i];
    g.classList.toggle('ws-off', !m);
    if (!m) return;
    const fill = g.querySelector('[data-jar-fill]');
    const hex = m.recipe ? hexOf(m.recipe) : 'none';
    const want = hex === 'none' ? 'transparent' : hex;
    if (fill.getAttribute('fill') !== want) fill.setAttribute('fill', want);
    g.setAttribute('aria-label', `Mixer ${i + 1}${m.recipe ? `: ${nameOf(m.recipe)}` : ': resting'}. Open the mixers list`);
  });
  if (jarCount !== null && mixers.length > jarCount) {
    // A new mixer jar springs into the scene with weight (the heavy spring: a cask landing on a shelf).
    const g = root.querySelector(`[data-jar="${mixers.length - 1}"]`);
    if (g) fx().spring(g, { from: { transform: 'translateY(-26px)', opacity: 0 }, to: { transform: 'translateY(0px)', opacity: 1 }, preset: 'heavy' });
  }
  jarCount = mixers.length;

  // Locked things stay visible: veils and shutters on the object, plus a price tag naming the goal.
  const U = (id) => sim().unlocks.status(s, id);
  const uShelf = U('shelf');
  const uHunt = U('hunters');
  const uGal = U('gallery');
  const uShip = U('shipping');
  const uComm = U('commissions');

  // Merge shelf: closed behind dusty glass with the vials that are waiting; open: her containers.
  const shelfOpen = !!uShelf.open;
  const cells = (s.shelf?.cells || []).filter(Boolean).slice(0, ENTRY_COLORS);
  const waitingN = Math.max(0, Math.floor(num(s.shelf?.waiting)));
  const chips = (s.shelf?.colors || []).filter(Boolean);
  root.querySelectorAll('[data-shelf-slot]').forEach((r, i) => {
    if (!shelfOpen) {
      const show = i < Math.min(waitingN, SHELF_SLOTS.length);
      r.classList.toggle('ws-off', !show);
      if (show) r.setAttribute('fill', chips.length ? hexOf(chips[i % chips.length]) : r.dataset.default);
      return;
    }
    const cell = cells[i];
    r.classList.toggle('ws-off', !cell);
    if (cell) r.setAttribute('fill', hexOf(cell.color));
  });
  root.querySelector('[data-shelf-cover]').classList.toggle('ws-off', shelfOpen);
  const hint = root.querySelector('[data-shelf-hint]');
  hint.classList.toggle('ws-off', !(shelfOpen && sm.shelf.hints(s).length > 0));

  root.querySelector('[data-shutters="map"]').classList.toggle('ws-off', !!uHunt.open);
  root.querySelector('[data-veil="gallery"]').classList.toggle('ws-off', !!uGal.open);
  root.querySelector('[data-veil="yard"]').classList.toggle('ws-off', !!uShip.open);
  root.querySelector('[data-veil="commissions"]').classList.toggle('ws-off', !!uComm.open);

  setTag('map', unlockTag(ctx, 'hunters'));
  setTag('shelf', unlockTag(ctx, 'shelf'));
  setTag('gallery', unlockTag(ctx, 'gallery'));
  setTag('commissions', unlockTag(ctx, 'commissions'));
  if (!uShip.open) setTag('yard', unlockTag(ctx, 'shipping'));
  else {
    const fl = s.stations.fleet || [];
    const ready = fl.filter((v) => !(num(v.arrivesAt) > 0)).length;
    setTag('yard', fl.length === 0 ? tag('Add a cart', { icon: null }) : tag(`${ready} ready`, { icon: null }));
  }

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
  sparkle: '#E2B04A', tube: '#8FA77A', unlock: '#7B5236', cart: '#9A6A47',
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

/** The next room she can buy with the Next-room card (the Gallery Wing and Loading Yard are unlocks, listed under Still to open). */
function nextRoom(s) {
  return ROOMS.find((r) => !(s.rooms || []).includes(r.id) && !ROOM_UNLOCK[r.id]) || null;
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

/** "Still to open": every locked system with its price tag (or paper button) in one place. */
function patchDoors(s) {
  const list = (sim().unlocks.UNLOCKS || []).map((u) => sim().unlocks.status(s, u.id)).filter((u) => u && !u.open);
  const nextId = nextUnlockId(nextOf(s, now()));
  const sig = list.map((u) => `${u.id}:${u.revealed ? 1 : 0}:${u.affordable ? 1 : 0}:${u.colorsLeft}:${nextId === u.id ? 1 : 0}`).join(',') + `|${num(s.shelf?.waiting)}`;
  setSection('doors', root.querySelector('[data-sec="doors"]'), sig, () => {
    if (!list.length) return '';
    return h`<div class="card" data-coach="doors"><div class="card-title">Still to open</div>
${list.map((u) => row({
    key: `unlock:${u.id}`,
    title: UNLOCK_INFO[u.id]?.short ? `${UNLOCK_INFO[u.id].short}` : u.name,
    sub: UNLOCK_INFO[u.id]?.says || '',
    extra: h`<div class="mt-1">${unlockTag(ctx, u.id)}</div>`,
  }))}</div>`;
  });
}

function patchSegments(s) {
  const shipOn = !!(s.unlocks && s.unlocks.shipping) || (s.stations.fleet || []).length > 0;
  const btn = root.querySelector('[data-segment="shipping"]');
  if (btn && btn.hidden === shipOn) btn.hidden = !shipOn;
  if (!shipOn && segment === 'shipping') setSegment('stations', { remember: false });
  else applySegment();
}

/** The one-time "What changed in 0.2" paper note for saves that came from 0.1. */
function patchWhatsNew(s) {
  const on = s.flags && s.flags.whatsNew === '0.2';
  setSection('whatsnew', root.querySelector('[data-sec="whatsnew"]'), on ? 'on' : 'off', () => (on
    ? h`<div class="card ws-note" data-whatsnew><div class="card-title">What changed in 0.2</div>
<ul>
<li>The shelf is now 6 by 6. Six of one color family in a line sell together.</li>
<li>The shelf, the map window and the gallery are opened with coins. Their tags show the price.</li>
<li>Purify has difficulty levels, and you pick one on the Puzzles table.</li>
</ul>
${button('Got it', { small: true, attrs: { 'data-action': 'dismiss-whatsnew' } })}</div>`
    : ''));
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
      variant: 'wood', block: true, cls: `tall ${closedInfo ? 'ws-closed' : ''}`,
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
  renderMemo.on = true;
  renderMemo.has = false;
  try {
    const t = now();
    autoAssignVats(s);
    const c = { meter: eco().flowMeter(s, t), cap: sim().storage.capacity(s) };
    patchHead(s, t, c);
    patchSegments(s);
    patchWhatsNew(s);
    patchScene(s, t);
    patchAlmost(s, t);
    patchPanels(s, t);
    patchRooms(s);
    patchDoors(s);
    patchApprentices(s);
    patchCloseUp(s);
    patchAfford(s);
  } catch (e) {
    console.error('workshop render failed', e);
  } finally {
    renderMemo.on = false;
  }
}

function patchAfford(s) {
  const coins = num(s.coins);
  root.querySelectorAll('[data-cost]').forEach((b) => {
    const short = coins < num(Number(b.dataset.cost)) || b.dataset.lock === '1';
    if (b.dataset.action === 'next') return; // handled in patchNext
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

// --- unlocks: the shared price tag, the "What this opens" sheet and the ceremony -----------------

const UNLOCK_LABEL = {
  shelf: 'the Merge Shelf', hunters: 'the map window', gallery: 'the Gallery Wing', shipping: 'the Loading Yard', commissions: 'Commissions',
};

/** sim.unlocks.status for one id (null when the sim has no such unlock). */
function unlockStatus(id) {
  try { return sim().unlocks.status(S(), id) || null; } catch (e) { return null; }
}

/**
 * unlockTag(ctx, id) -> html for a locked thing, '' once it is open.
 * Before the reveal: a paper lock tag with the price from the start ("Shelf: 8 colors · 400 coins — 3 more colors").
 * After: a real paper button ("Open the Merge Shelf for 400") that opens the "What this opens" sheet;
 * it takes the primary look only when it is also the Next button's choice. The shelf's tag leads with
 * "N vials waiting" from 6 colors on.
 */
export function unlockTag(c, id, { cls = '' } = {}) {
  if (!ctx) ctx = c;
  const u = unlockStatus(id);
  if (!u || u.open) return raw('');
  const info = UNLOCK_INFO[id] || {};
  let main;
  if (!u.revealed) {
    const goal = u.colorsLeft > 0 ? moreColors(u.colorsLeft) : id === 'commissions' ? 'after the Loading Yard' : 'soon';
    main = lockTag(`${info.short || u.name}: ${u.revealColors} colors · ${fmt(u.cost)} coins — ${goal}`, { cls });
  } else {
    const isNext = nextUnlockId(nextOf(S(), now())) === id;
    main = button(`Open ${UNLOCK_LABEL[id] || u.name} for ${fmt(u.cost)}`, {
      cls: `ws-unlockbtn${isNext ? ' is-next' : ''}${u.affordable ? ' is-ready' : ''} ${cls}`.trim(),
      attrs: { 'data-action': 'unlock-open', 'data-unlock': id, 'data-cost': String(u.cost), 'aria-disabled': u.affordable ? 'false' : 'true' },
    });
  }
  const waiting = id === 'shelf' ? Math.max(0, Math.floor(num(S().shelf && S().shelf.waiting))) : 0;
  const wait = waiting > 0 && sim().discoveredCount(S()) >= 6
    ? h`<span class="tag ws-waiting">${waiting} ${waiting === 1 ? 'vial' : 'vials'} waiting</span>` : '';
  return h`${wait}${main}`;
}

function illustrationSvg(info) {
  return h`<svg viewBox="${info.vb}" role="img" aria-label="${info.short}" xmlns="http://www.w3.org/2000/svg">
<defs><filter id="ws-cut-s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2.5" stdDeviation="0.4" style="flood-color:#2A2622;flood-opacity:0.25"/></filter></defs>
<g class="ws-pulse">${raw(info.art('ws-cut-s'))}</g></svg>`;
}

/**
 * openUnlockSheet(ctx, id, {host}) -> sheet api. The "What this opens" sheet: a small looping drawing of
 * the object (2% pulse), one sentence, the price, and "Open it for N" / "Not yet". Buying calls
 * sim.unlocks.buy, plays unlockCeremony(object) when the workshop is on screen, then emits 'unlocked'.
 * `host` is the screen's <section> to draw into (default: the workshop).
 */
export function openUnlockSheet(c, id, { host = null } = {}) {
  if (!ctx) ctx = c;
  const info = UNLOCK_INFO[id];
  const u = unlockStatus(id);
  const hostEl = host || root;
  if (!info || !u || !hostEl) return null;
  if (u.open) { toast(`${u.name} is already open`); return null; }
  if (hostEl === root) closeSheet();
  const render = () => {
    const st = unlockStatus(id) || u;
    const waiting = id === 'shelf' ? Math.max(0, Math.floor(num(S().shelf && S().shelf.waiting))) : 0;
    const more = Math.max(1, Math.ceil(num(st.cost) - num(S().coins)));
    const goal = st.colorsLeft > 0 ? `${moreColors(st.colorsLeft)} to open it` : id === 'commissions' ? 'Opens after the Loading Yard' : 'Not ready to open yet';
    const body = h`<div class="ws-ill">${illustrationSvg(info)}</div>
<div class="ws-unlock-name">${st.name}</div>
<div class="ws-unlock-says">${info.says}</div>
${waiting > 0 ? h`<div class="ws-unlock-note">${waiting} ${waiting === 1 ? 'vial is' : 'vials are'} waiting behind the glass and will be on the shelf the moment it opens.</div>` : ''}
<div class="ws-unlock-price">${coinIcon(18)}${fmt(st.cost)} coins</div>`;
    const foot = st.revealed
      ? h`${st.affordable ? '' : h`<div class="ws-unlock-note">${fmt(more)} more coins and it is yours.</div>`}
<div class="ws-actions-row">${button('Not yet', { attrs: { 'data-sheet-close': '' }, cls: 'tall' })}${button(`Open it for ${fmt(st.cost)}`, { variant: 'primary', cls: 'tall', attrs: { 'data-action': 'unlock-buy', 'data-unlock': id, 'aria-disabled': st.affordable ? 'false' : 'true' } })}</div>`
      : h`<div class="ws-unlock-note">${lockTag(goal)}</div>
<div class="ws-actions-row">${button('Not yet', { attrs: { 'data-sheet-close': '' }, cls: 'tall' })}</div>`;
    return { body, foot };
  };
  const first = render();
  const api = openSheet(hostEl, {
    title: 'What this opens',
    html: String(first.body),
    footer: String(first.foot),
    onAction(name) {
      if (name === 'unlock-buy') doUnlockBuy(c, id, api, hostEl);
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  if (hostEl === root) sheet = { api, kind: 'unlock', id };
  return api;
}

/** Buy an unlock (through its sheet), play the ceremony in the scene, then tell the guides. */
async function doUnlockBuy(c, id, api, hostEl) {
  const info = UNLOCK_INFO[id];
  const u = unlockStatus(id);
  if (!info || !u || u.open) { if (api) api.close(); return false; }
  if (!u.affordable) { toast(`Just ${fmt(Math.max(1, Math.ceil(u.cost - num(S().coins))))} more Coins`); return false; }
  if (api) api.close();
  snapshotCeremony(info.object);
  const res = c.game.act(c.sim.unlocks.buy, { id });
  if (!res || !res.ok) { toast('That one is not ready to open yet.'); return false; }
  audio().thunk(1.2);
  haptics().medium();
  const here = visible && (!hostEl || hostEl === root);
  if (here) await unlockCeremony(info.object);
  else toast(`${u.name} is open`);
  if (c.game.emit) c.game.emit('unlocked', { id, object: info.object });
  return true;
}

/** Capture what the ceremony needs from the scene before the purchase changes it (the tag that tears away). */
function snapshotCeremony(object) {
  ceremonySnap = null;
  if (!root || object !== 'gallery-door') return;
  const t = root.querySelector('[data-tag="gallery"]');
  if (t && !t.classList.contains('ws-off')) ceremonySnap = { tag: t.cloneNode(true) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(name, attrs = {}) {
  const n = doc().createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
function svgFrag(markup) {
  const g = svgNode('g');
  g.innerHTML = markup;
  return g;
}
const anim = (el, frames, opts) => (el && el.animate ? el.animate(frames, { fill: 'both', ...opts }).finished.catch(() => {}) : Promise.resolve());

/**
 * unlockCeremony(objectId) -> Promise. A 1.5 s moment in the scene when something opens:
 * 'shelf' dust puffs off the glass and the waiting vials drop onto it; 'map-window' knocks, then the
 * shutters swing open; 'gallery-door' the paper tag tears away and the door glows; 'yard' a cart rolls
 * in; 'commissions' the scroll unrolls. Resolves immediately when the workshop is not on screen.
 */
export function unlockCeremony(objectId) {
  const key = UNLOCK_INFO[objectId] ? UNLOCK_INFO[objectId].object : objectId;
  const snap = ceremonySnap;
  ceremonySnap = null;
  const scene = root && root.querySelector('.ws-scene');
  if (!scene || !visible || !doc()) return Promise.resolve();
  const reduced = fx().isReducedMotion();
  const layer = svgNode('svg', { class: 'ws-cer', viewBox: '0 0 390 440', 'aria-hidden': 'true' });
  layer.innerHTML = '<defs><radialGradient id="ws-cer-glow"><stop offset="0" stop-color="#FFF3C4" stop-opacity=".95"/><stop offset="1" stop-color="#FFF3C4" stop-opacity="0"/></radialGradient></defs>';
  scene.appendChild(layer);
  const jobs = [];
  const glow = (cx, cy, rx, ry, ms = 1100) => {
    const e = svgNode('ellipse', { cx, cy, rx, ry, fill: 'url(#ws-cer-glow)', opacity: 0 });
    e.style.transformBox = 'fill-box';
    e.style.transformOrigin = 'center';
    layer.appendChild(e);
    jobs.push(anim(e, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.25)' }], { duration: ms, easing: 'ease-out' }));
  };

  if (reduced) {
    if (key === 'shelf') glow(311, 198, 70, 60, 500);
    else if (key === 'map-window') glow(82, 78, 80, 62, 500);
    else if (key === 'gallery-door') glow(316, 312, 60, 70, 500);
    else if (key === 'yard') glow(70, 384, 60, 36, 500);
    else glow(218, 64, 24, 36, 500);
  } else if (key === 'shelf') {
    audio().knock();
    const cover = svgNode('rect', { x: 256, y: 152, width: 110, height: 92, rx: 2, fill: '#F2F4F0', 'fill-opacity': 0.58 });
    layer.appendChild(cover);
    jobs.push(anim(cover, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 520, easing: 'ease-in' }));
    for (let i = 0; i < 9; i++) {
      const puff = svgNode('circle', { cx: 262 + i * 12.5, cy: 190 + (i % 3) * 18, r: 3 + (i % 3), fill: '#D9D2C4', opacity: 0 });
      puff.style.transformBox = 'fill-box';
      puff.style.transformOrigin = 'center';
      layer.appendChild(puff);
      jobs.push(anim(puff, [
        { opacity: 0, transform: 'translate(0,0) scale(.6)' },
        { opacity: 0.9, transform: 'translate(0,-8px) scale(1)', offset: 0.3 },
        { opacity: 0, transform: `translate(${(i % 2 ? 1 : -1) * (8 + i * 2)}px,-30px) scale(1.9)` },
      ], { duration: 720, delay: i * 35, easing: 'ease-out' }));
    }
    let n = 0;
    root.querySelectorAll('[data-shelf-slot]:not(.ws-off)').forEach((r) => {
      const d = 360 + n * 55;
      n += 1;
      jobs.push(anim(r, [
        { transform: 'translateY(-48px)', opacity: 0 },
        { transform: 'translateY(3px)', opacity: 1, offset: 0.72 },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: 380, delay: d, easing: 'ease-in', fill: 'backwards' }));
    });
    setTimeout(() => audio().clink(3), 420);
  } else if (key === 'map-window') {
    const left = svgFrag(SHUTTER_HALF(26, 54));
    const right = svgFrag(SHUTTER_HALF(84, 54));
    left.style.transformBox = 'fill-box';
    left.style.transformOrigin = '0% 50%';
    right.style.transformBox = 'fill-box';
    right.style.transformOrigin = '100% 50%';
    layer.append(left, right);
    const knock = (dir) => [
      { transform: 'scaleX(1) translateX(0)', offset: 0 },
      { transform: `scaleX(1) translateX(${dir * 2}px)`, offset: 0.08 },
      { transform: 'scaleX(1) translateX(0)', offset: 0.16 },
      { transform: `scaleX(1) translateX(${dir * 2}px)`, offset: 0.24 },
      { transform: 'scaleX(1) translateX(0)', offset: 0.32 },
      { transform: 'scaleX(1) translateX(0)', offset: 0.4 },
      { transform: 'scaleX(0.05) translateX(0)', offset: 1 },
    ];
    jobs.push(anim(left, knock(1), { duration: 1150, easing: 'ease-in-out' }));
    jobs.push(anim(right, knock(-1), { duration: 1150, easing: 'ease-in-out' }));
    audio().knock();
    setTimeout(() => audio().knock(), 200);
    setTimeout(() => audio().bell(), 480);
    glow(82, 78, 70, 56, 900);
  } else if (key === 'gallery-door') {
    glow(316, 312, 60, 74, 1200);
    audio().bell();
    if (snap && snap.tag) {
      const t = snap.tag;
      t.classList.add('ws-cer-tag');
      t.classList.remove('ws-off');
      scene.appendChild(t);
      jobs.push(anim(t, [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: 'translate(-46%, -40%) rotate(-6deg)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-30%, 120%) rotate(24deg)', opacity: 0 },
      ], { duration: 700, easing: 'ease-in' }).then(() => t.remove()));
    }
  } else if (key === 'yard') {
    const cart = svgNode('g');
    cart.innerHTML = CART.replace(/<circle cx="(46|78)" cy="402" r="9" fill="#5E3E28"\/><circle cx="\1" cy="402" r="3.5" fill="#B98E64"\/>/g,
      (m) => `<g data-wheel style="transform-box:fill-box;transform-origin:center">${m}</g>`);
    layer.appendChild(cart);
    const real = root.querySelector('[data-art="yard"]');
    jobs.push(anim(real, [{ opacity: 0 }, { opacity: 0 }], { duration: 1000, fill: 'none' }));
    jobs.push(anim(cart, [{ transform: 'translateX(-150px)' }, { transform: 'translateX(4px)', offset: 0.85 }, { transform: 'translateX(0)' }], { duration: 1000, delay: 60, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'forwards' }));
    cart.querySelectorAll('[data-wheel]').forEach((w) => jobs.push(anim(w, [{ transform: 'rotate(-540deg)' }, { transform: 'rotate(0deg)' }], { duration: 1000, delay: 60, easing: 'cubic-bezier(.22,.8,.3,1)' })));
    for (let i = 0; i < 4; i++) {
      const p = svgNode('circle', { cx: 30 + i * 6, cy: 408, r: 3, fill: '#D9D2C4', opacity: 0 });
      layer.appendChild(p);
      jobs.push(anim(p, [{ opacity: 0, transform: 'translate(-40px,0) scale(.6)' }, { opacity: 0.8, offset: 0.4 }, { opacity: 0, transform: 'translate(-10px,-14px) scale(1.6)' }], { duration: 700, delay: 500 + i * 60, easing: 'ease-out' }));
    }
    setTimeout(() => audio().thunk(0.7), 900);
    glow(70, 384, 56, 34, 1000);
  } else {
    const scroll = svgNode('g', { transform: 'translate(205 40)' });
    scroll.innerHTML = artJobs('ws-cut');
    scroll.style.transformBox = 'fill-box';
    scroll.style.transformOrigin = '50% 0%';
    layer.appendChild(scroll);
    jobs.push(anim(scroll, [{ transform: 'translate(205px,40px) scaleY(.15)' }, { transform: 'translate(205px,40px) scaleY(1.08)', offset: 0.7 }, { transform: 'translate(205px,40px) scaleY(1)' }], { duration: 700, easing: 'ease-out' }));
    glow(218, 64, 26, 38, 1000);
    audio().clink(2);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      layer.remove();
      resolve();
    };
    Promise.all(jobs).then(finish);
    setTimeout(finish, reduced ? 650 : 1500);
    if (!jobs.length) finish();
  });
}

// --- mixer picker (the recipe sheet) -------------------------------------------------------------

/**
 * One relevant use for a color, most specific first: a painting on the easel that uses it, a started
 * painting it suits, a shipping route that pays extra for its family, else what a jar sells for.
 */
function useLine(colorId) {
  const s = S();
  const t = now();
  const fam = eco().colorFamily(colorId);
  const pieces = ((s.gallery && s.gallery.pieces) || []).filter((p) => p && !p.signedAt);
  for (const p of pieces) {
    const cv = ctx.content.getCanvas ? ctx.content.getCanvas(p.canvas) : null;
    if (cv && Object.values(p.regions || {}).includes(colorId)) return `Used in your ${cv.name}`;
  }
  for (const p of pieces) {
    const cv = ctx.content.getCanvas ? ctx.content.getCanvas(p.canvas) : null;
    if (cv && (cv.suggestedPalette || []).includes(fam)) return `Suggested for your ${cv.name}`;
  }
  if (s.unlocks && s.unlocks.shipping) {
    try {
      for (const r of sim().shipping.availableRoutes(s, t)) {
        const d = sim().shipping.currentDemand(s, r.id, t);
        if (d && d.family && d.family === fam) return `${r.name} pays +${Math.round(d.bonus * 100)}% for ${famPlural(fam)}`;
      }
    } catch (e) { /* no routes yet */ }
  }
  const worth = Math.round(eco().colorPrice(s, colorId));
  return `Worth ${fmt(worth)} ${worth === 1 ? 'Coin' : 'Coins'} a jar`;
}

function recipeSheetHtml(mi, colorId) {
  const s = S();
  const m = s.stations.mixers[mi];
  const list = sim().discoveredColors(s)
    .filter((c) => sim().factory.canMix(s, c.id))
    .map((c) => ({ ...c, price: eco().colorPrice(s, c.id) }))
    .sort((a, b) => (b.id === colorId) - (a.id === colorId) || b.price - a.price || a.name.localeCompare(b.name));
  return h`<div class="hint">Pick what Mixer ${mi + 1} makes. Only colors you have discovered, and can mix, appear here.</div>
${pickRow({ action: 'set-recipe', attrs: { 'data-mixer': String(mi), 'data-color': '' }, lead: h`<span class="swatch is-empty" style="--size:36px"></span>`, title: 'Rest this mixer', sub: 'It makes nothing until you pick again', on: !m.recipe })}
${list.length ? list.map((c) => pickRow({ action: 'set-recipe', attrs: { 'data-mixer': String(mi), 'data-color': c.id }, lead: swatch(c.hex, 36), title: c.name, sub: useLine(c.id), on: m.recipe === c.id, right: m.recipe === c.id ? h`<span class="chip">Making now</span>` : '' })) : h`<div class="muted">Discover a color you can mix and it will show up here.</div>`}`;
}

function mixerPickerHtml(colorId) {
  const s = S();
  const mixers = s.stations.mixers || [];
  const can = sim().factory.canMix(s, colorId);
  return h`<div class="hint">${can ? `Pick a mixer to make ${nameOf(colorId)}.` : `${nameOf(colorId)} needs a pigment you do not have a source for yet. A hunter may find one.`}</div>
<div class="ws-use">${useLine(colorId)}</div>
${can ? mixers.map((m, mi) => pickRow({
    action: 'assign-to', attrs: { 'data-mixer': String(mi) },
    lead: m.recipe ? swatch(hexOf(m.recipe), 36) : h`<span class="swatch is-empty" style="--size:36px"></span>`,
    title: `Mixer ${mi + 1}`, sub: m.recipe === colorId ? 'Making it now' : m.recipe ? `Making ${nameOf(m.recipe)} now` : 'Resting, ready for a recipe',
    on: m.recipe === colorId, right: !m.recipe ? h`<span class="chip">Free</span>` : '',
  })) : ''}`;
}

/**
 * openRecipeSheet(ctx, {mixer, colorId, onDone, host}) -> sheet api.
 * With a `mixer` index: what that mixer makes (colorId is listed first). With only a `colorId`: which
 * mixer should make it. Each color shows one relevant use. After a pick the sheet closes and
 * onDone({mixer, colorId}) runs. `host` is the screen's <section> to draw over (default: the workshop),
 * which is how the easel opens it without leaving the painting.
 */
export function openRecipeSheet(c, { mixer = null, colorId = null, onDone = null, host = null } = {}) {
  if (!ctx) ctx = c;
  const hostEl = host || root;
  if (!hostEl) return null;
  closeSheet();
  const byColor = !Number.isInteger(mixer) && colorId;
  const picked = (mi, cid) => {
    const res = act(sim().factory.assignRecipe, { mixer: mi, colorId: cid });
    if (res && res.ok) {
      audio().cork();
      api.close();
      if (visible) renderAll();
      if (hostEl === root) squashOnce(fx(), root.querySelector(`[data-row="mixer:${mi}"]`));
      if (cid) toast(`Mixer ${mi + 1} is making ${nameOf(cid)}`, { hex: hexOf(cid) });
      if (onDone) onDone({ mixer: mi, colorId: cid });
    } else toast('That recipe needs a pigment you do not have a source for yet.');
  };
  const api = openSheet(hostEl, {
    title: byColor ? `Which mixer makes ${nameOf(colorId)}?` : `Mixer ${mixer + 1}: what to make`,
    html: String(byColor ? mixerPickerHtml(colorId) : recipeSheetHtml(mixer, colorId)),
    onAction(name, el) {
      if (name === 'set-recipe') picked(mixer, el.dataset.color || null);
      else if (name === 'assign-to') picked(Number(el.dataset.mixer) || 0, colorId);
    },
    onClose() { if (sheet && sheet.api === api) sheet = null; },
  });
  sheet = { api, kind: 'recipe' };
  return api;
}

/**
 * Catalog "Assign to mixer": an idle mixer takes the color straight away;
 * when every mixer is busy she picks which one switches.
 */
function assignFromCatalog(colorId) {
  const s = S();
  const mixers = (s.stations && s.stations.mixers) || [];
  if (!colorId || !mixers.length) return;
  const already = mixers.findIndex((m) => m && m.recipe === colorId);
  if (already >= 0) { toast(`Mixer ${already + 1} is already making ${nameOf(colorId)}`, { hex: hexOf(colorId) }); return; }
  const idle = mixers.findIndex((m) => m && !m.recipe);
  if (idle >= 0 || mixers.length === 1) {
    const mi = idle >= 0 ? idle : 0;
    const res = act(sim().factory.assignRecipe, { mixer: mi, colorId });
    if (res && res.ok) {
      audio().cork();
      renderAll();
      squashOnce(fx(), root.querySelector(`[data-row="mixer:${mi}"]`));
      toast(`Mixer ${mi + 1} is making ${nameOf(colorId)}`, { hex: hexOf(colorId) });
    } else toast('That recipe needs a pigment you do not have a source for yet.');
    return;
  }
  openRecipeSheet(ctx, { colorId });
}

// --- vat detail sheet -------------------------------------------------------------------------------

const KEEP_STEP = 5;

/** Jars kept back from the shop for painting (state.keep; the sim defaults 20 for pinned and painting colors). */
function keepOf(colorId) {
  return num(sim().storage.keepOf(S(), colorId));
}

function vatSheetHtml(vi) {
  const s = S();
  const v = s.stations.vats[vi];
  const capV = eco().stationOutput('vat', v.level);
  const jars = v.color ? num(s.stock?.[v.color]?.jars) : 0;
  const pm = eco().productionMultiplier(s, now());
  const rate = v.color ? (s.stations.mixers || []).filter((m) => m && m.recipe === v.color).reduce((a, m) => a + eco().stationOutput('mixer', m.level) * pm, 0) : 0;
  const fill = !v.color ? 'Choose a color to fill this vat'
    : jars >= capV ? 'The glass is full'
      : rate > 0 ? `Fills in about ${waitText(ctx.format, (capV - jars) / rate * 1000)}` : 'No mixer is making it right now';
  const keep = v.color ? keepOf(v.color) : 0;
  const list = Object.entries(s.stock || {}).filter(([, e]) => num(e?.jars) > 0.05)
    .map(([id, e]) => ({ id, jars: num(e.jars), name: nameOf(id), hex: hexOf(id) }))
    .sort((a, b) => b.jars - a.jars);
  return h`<div class="ws-vat-head">${v.color ? swatch(hexOf(v.color), 52) : h`<span class="swatch is-empty" style="--size:52px" aria-hidden="true"></span>`}
<div class="ws-vat-facts"><div class="semi">${v.color ? nameOf(v.color) : 'Empty glass'}</div><div>${fmt(jars)} of ${fmt(capV)} jars</div><div class="muted">${fill}</div></div></div>
${v.color ? h`<div class="ws-pick" style="cursor:default"><span class="grow"><span class="pt">Keep ${fmt(keep)} ${keep === 1 ? 'jar' : 'jars'} for painting</span><br><span class="ps">The shop sells only above this</span></span>
<span class="ws-stepper"><button type="button" class="ws-step" data-action="keep-step" data-color="${v.color}" data-delta="-${KEEP_STEP}" data-tap aria-label="Keep fewer jars" aria-disabled="${keep <= 0 ? 'true' : 'false'}">&minus;</button><span class="n num" data-keep-n>${fmt(keep)}</span><button type="button" class="ws-step" data-action="keep-step" data-color="${v.color}" data-delta="${KEEP_STEP}" data-tap aria-label="Keep more jars">+</button></span></div>` : ''}
<div class="ws-sub-title">Show a different color</div>
${pickRow({ action: 'set-vat', attrs: { 'data-vat': String(vi), 'data-color': '' }, lead: h`<span class="swatch is-empty" style="--size:36px"></span>`, title: 'Empty glass', on: !v.color })}
${list.length ? list.map((c) => pickRow({ action: 'set-vat', attrs: { 'data-vat': String(vi), 'data-color': c.id }, lead: swatch(c.hex, 36), title: c.name, sub: `${fmt(c.jars)} jars in stock`, on: v.color === c.id })) : h`<div class="muted">Make some color and it will be waiting here.</div>`}`;
}

function openVatSheet(vi) {
  closeSheet();
  const v = S().stations.vats[vi];
  if (!v) return;
  const api = openSheet(root, {
    title: `Vat ${vi + 1}`,
    html: String(vatSheetHtml(vi)),
    onAction(name, el) {
      if (name === 'keep-step') {
        const colorId = el.dataset.color;
        const next = Math.max(0, Math.min(Math.floor(sim().storage.capacity(S()).total), keepOf(colorId) + Number(el.dataset.delta)));
        act(sim().storage.setKeep, { colorId, jars: next });
        audio().tick();
        api.set(vatSheetHtml(vi));
        return;
      }
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
          squashOnce(fx(), root.querySelector(`[data-row="fleet:${vehicle}"]`));
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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const SEGMENT_KEY = 'tincture.workshop.segment';
const SEGMENTS = ['stations', 'shipping', 'rooms'];
const STATION_PANELS = ['sources', 'grinders', 'mixers', 'vats', 'cellar', 'shop'];
const PANEL_SEGMENT = { fleet: 'shipping', rooms: 'rooms', apprentices: 'rooms', doors: 'rooms', unlocks: 'rooms' };

function loadSegment() {
  try {
    const v = localStorage.getItem(SEGMENT_KEY);
    if (SEGMENTS.includes(v)) return v;
  } catch (e) { /* storage can be blocked */ }
  return 'stations';
}

/** Show the active segment's pane and press its button (cheap; runs every render). */
function applySegment() {
  root.querySelectorAll('[data-segment]').forEach((b) => {
    const on = b.dataset.segment === segment;
    if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
  });
  root.querySelectorAll('[data-pane]').forEach((p) => {
    const on = p.dataset.pane === segment;
    if (p.hidden === on) p.hidden = !on;
  });
}

function setSegment(name, { remember = true } = {}) {
  if (!SEGMENTS.includes(name)) return;
  segment = name;
  if (remember) { try { localStorage.setItem(SEGMENT_KEY, name); } catch (e) { /* ignore */ } }
  applySegment();
}

/** Scroll a row or panel under the sticky bars and flash it once. */
function scrollFlash(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    if (el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: fx().isReducedMotion() ? 'auto' : 'smooth' });
    el.classList.remove('ws-flash');
    void el.offsetWidth;
    el.classList.add('ws-flash');
    setTimeout(() => el.classList.remove('ws-flash'), 1400);
  });
}

/** Deep-link params for the workshop: {panel|upgrade, row, index, unlock, rebuy, sheet, vat, assign}. */
function applyParams(params) {
  if (!params) return;
  if (params.panel || params.upgrade) focusPanel(params.panel || params.upgrade, { row: params.row, index: params.index });
  if (params.unlock) openUnlockSheet(ctx, params.unlock);
  if (params.rebuy) {
    const b = root.querySelector('.screen-body');
    if (b) b.scrollTop = 0;
    scrollFlash(refs.sugg);
  }
  if (params.sheet === 'yard') focusPanel('fleet');
  if (params.sheet === 'unlock' && params.id) openUnlockSheet(ctx, params.id);
  if (params.sheet === 'vat' && Number.isInteger(params.vat)) openVatSheet(params.vat);
  if (params.assign) assignFromCatalog(params.assign);
}

function goto(screen, params) {
  if (screen === 'workshop') { applyParams(params); return; }
  ctx.navigate(screen, params || {});
}

const UPGRADE_PANEL = { source: 'sources', grinder: 'grinders', mixer: 'mixers', vat: 'vats', shop: 'shop', fleet: 'fleet', cellar: 'cellar' };

/**
 * Deep link into a section: picks the segment, opens the panel, scrolls the row (or panel) into view
 * and flashes it once. `name` is a panel ('mixers', 'fleet', 'rooms') or an upgrade kind ('mixer').
 */
function focusPanel(name, { row = '', index = null } = {}) {
  if (name === 'bench') { ctx.navigate('bench', {}); return; }
  const key = UPGRADE_PANEL[name] || name;
  const seg = PANEL_SEGMENT[key] || (STATION_PANELS.includes(key) ? 'stations' : '');
  if (!seg) return;
  if (seg === 'shipping' && !fleetVisible(S())) { openUnlockSheet(ctx, 'shipping'); return; }
  if (key === 'fleet' || STATION_PANELS.includes(key)) { openPanels.add(key); savePanels(); }
  setSegment(seg);
  renderAll();
  const rowKey = row || (index != null && UPGRADE_PANEL[name] ? `${name}:${index}` : '');
  const target = (rowKey && root.querySelector(`[data-row="${rowKey}"]`))
    || root.querySelector(`[data-pw="${key}"]`) || root.querySelector(`[data-sec="${key === 'unlocks' ? 'doors' : key}"]`);
  scrollFlash(target);
}

function needMore(cost) {
  const diff = Math.max(0, Math.ceil(cost - num(S().coins)));
  toast(`Just ${fmt(diff)} more Coins`);
}

/** The level number in a row's sub line ("Level 3 · ..."), or null. */
function levelOf(rowEl) {
  const m = rowEl && /^Level (\d+)/.exec((rowEl.querySelector('.ws-s') || {}).textContent || '');
  return m ? Number(m[1]) : null;
}

/** Roll the "Level N" number in a freshly drawn row from `from` to its new value. */
function rollLevel(rowEl, from) {
  const sub = rowEl && rowEl.querySelector('.ws-s');
  const to = levelOf(rowEl);
  if (!sub || from === null || to === null || to === from) return;
  const m = /^(Level )(\d+)([\s\S]*)$/.exec(sub.textContent);
  sub.textContent = '';
  const n = doc().createElement('span');
  n.className = 'num';
  sub.append(m[1], n, m[3]);
  fx().rollNumber(n, from, to, { ms: 360, format: (v) => String(Math.round(v)) });
}

function afterBuy(rowKey, res, before = null) {
  renderAll();
  const r = rowKey ? root.querySelector(`[data-row="${rowKey}"]`) : null;
  squashOnce(fx(), r);
  audio().thunk();
  haptics().medium();
  rollLevel(r, before);
  if (res && res.milestone) {
    audio().clink(5);
    if (r) fx().ringBurst(r.querySelector('.ws-lead') || r, '#E2B04A', { size: 56 });
    toast(`Level ${res.level}: output doubles!`);
  }
}

/** The row's current level, read before a buy redraws it (so the new number can roll). */
function levelBefore(rowKey) {
  return rowKey ? levelOf(root.querySelector(`[data-row="${rowKey}"]`)) : null;
}

function buyFrom(el) {
  const kind = el.dataset.kind;
  const args = { kind };
  if (el.dataset.index !== undefined && el.dataset.index !== '') args.index = Number(el.dataset.index);
  if (el.dataset.id) args.id = el.dataset.id;
  const cost = Number(el.dataset.cost);
  if (cost > num(S().coins)) { needMore(cost); return; }
  const key = kind === 'source' ? `source:${args.id}` : kind === 'cellar' || kind === 'shop' ? kind : `${kind}:${args.index}`;
  const before = levelBefore(key);
  const res = act(sim().factory.buyUpgrade, args);
  if (res && res.ok) {
    afterBuy(key, res, before);
  } else if (res && res.reason === 'slots') toast('All source slots are full for now. A hunter may find more room.');
  else if (res && res.reason === 'coins') needMore(res.cost);
}

async function doCollect() {
  const s = S();
  const pending = Math.floor(num(s.pendingCollect));
  if (pending < 1) return;
  const from = Math.floor(num(s.coins));
  coinHold = true;
  // Coins fan out of the scene (the shop counter's till), hang a beat, then converge on the pill. The first
  // coin to land starts the counter rolling up (it slows at the end); the last one squashes the pill.
  const n = Math.max(8, Math.min(14, 8 + Math.floor(Math.log10(pending + 1) * 2)));
  let rolled = false;
  const flight = typeof fx().coinArc === 'function'
    ? fx().coinArc(refs.scene, refs.pill, n, {
      onArrive: (i) => {
        if (!rolled) { rolled = true; fx().rollNumber(refs.coins, from, Math.floor(num(S().coins)), { ms: 520, format: fmt }); }
        if (i === n - 1 || fx().isReducedMotion()) squashOnce(fx(), refs.pill);
      },
    })
    : fx().flyTo(refs.scene, refs.pill, '#C99A2E', { count: 6 });
  act(sim().factory.collect);
  if (typeof fx().coinArc !== 'function') { audio().coins(6); haptics().ripple(3); }
  renderAll();
  await flight;
  if (!rolled) squashOnce(fx(), refs.pill);
  coinShown = Math.floor(num(S().coins));
  coinHold = false;
  patchCoins(S());
}

/** The Next button: do what sim.next says (buy the upgrade, open the sheet, pick a recipe, go there, collect). */
function doNext() {
  const s = S();
  const n = nextOf(s, now());
  const a = n && n.action;
  if (!a) return;
  switch (a.kind) {
    case 'assign': openRecipeSheet(ctx, { mixer: num(a.mixer) }); break;
    case 'unlock': openUnlockSheet(ctx, a.id); break;
    case 'rebuy': {
      const res = act(sim().unlocks.batchRebuy);
      if (res && res.ok) { afterBuy('', {}); toast('Everything is open again'); }
      else if (res && res.reason === 'coins') needMore(res.cost);
      break;
    }
    case 'room': {
      const res = act(sim().factory.buyRoom, { id: a.id });
      if (res && res.ok) { afterBuy('', res); squashOnce(fx(), refs.sugg); }
      else if (res && res.reason === 'coins') needMore(res.cost);
      break;
    }
    case 'upgrade': {
      const args = { kind: a.upgrade };
      if (a.index !== undefined) args.index = a.index;
      if (a.id) args.id = a.id;
      const key = a.upgrade === 'source' ? `source:${a.id}` : a.upgrade === 'cellar' || a.upgrade === 'shop' ? a.upgrade : `${a.upgrade}:${a.index}`;
      const before = levelBefore(key);
      const res = act(sim().factory.buyUpgrade, args);
      if (res && res.ok) {
        afterBuy(key, res, before);
        squashOnce(fx(), refs.sugg);
      } else if (res && res.reason === 'coins') needMore(res.cost);
      else if (res && res.reason === 'slots') toast('All source slots are full for now. A hunter may find more room.');
      break;
    }
    case 'mixer': {
      const res = act(sim().factory.buyMixer);
      if (res && res.ok) {
        afterBuy('mixer:new', res);
        squashOnce(fx(), refs.sugg);
        toast(`Mixer ${res.index + 1} is ready. Pick what it makes.`);
      } else if (res && res.reason === 'coins') needMore(res.cost);
      break;
    }
    case 'navigate': goto(a.screen, a.params); break;
    case 'collect':
      if (num(s.pendingCollect) >= 1) doCollect();
      else toast('The till is empty for now. Your shop is selling.');
      break;
    default: break;
  }
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
    squashOnce(fx(), root.querySelector(`[data-row="mixer:${i}"]`));
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

/** A scene object: open its screen when it is open, otherwise the "What this opens" sheet. */
function openOrBuy(id, go) {
  const u = unlockStatus(id);
  if (u && !u.open) openUnlockSheet(ctx, id);
  else go();
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.dataset.action;
  switch (a) {
    case 'settings': break; // the app's own click handler opens Settings; navigating here too would fire twice
    case 'collect': doCollect(); break;
    case 'next': doNext(); break;
    case 'open-map': openOrBuy('hunters', () => ctx.navigate('map', {})); break;
    case 'open-album': ctx.navigate('album', {}); break;
    case 'open-shelf': openOrBuy('shelf', () => ctx.navigate('shelf', {})); break;
    case 'open-bench': ctx.navigate('bench', {}); break;
    case 'open-gallery': openOrBuy('gallery', () => ctx.navigate('gallery', {})); break;
    case 'open-quests': ctx.navigate('quests', {}); break;
    case 'open-ledger': ctx.navigate('ledger', {}); break;
    case 'open-commissions': openOrBuy('commissions', () => ctx.navigate('commissions', {})); break;
    case 'open-yard': openOrBuy('shipping', () => focusPanel('fleet')); break;
    case 'goto-mixers': focusPanel('mixers', { row: `mixer:${Number(el.dataset.mixer) || 0}` }); break;
    case 'unlock-open': openUnlockSheet(ctx, el.dataset.unlock); break;
    case 'segment': setSegment(el.dataset.segment); break;
    case 'dismiss-whatsnew': act((st) => { if (st.flags) delete st.flags.whatsNew; }); sigs.whatsnew = ''; renderAll(); break;
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
    case 'mixer-recipe': openRecipeSheet(ctx, { mixer: Number(el.dataset.mixer) }); break;
    case 'buy-mixer': {
      const q = sim().factory.mixerPurchase(S());
      if (!q.affordable) { needMore(q.cost); break; }
      const res = act(sim().factory.buyMixer);
      if (res && res.ok) { afterBuy(`mixer:${res.index}`, res); toast(`Mixer ${res.index + 1} is ready. Pick what it makes.`); }
      break;
    }
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
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && (e.target.classList.contains('ws-hit') || (e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON'))) {
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
    vatPrev.fill(null);
    bindTouchFeel(root, fx(), { lift: '.ws-hit, .ws-pick, .ws-sugg' });
    coinShown = null;
    jarCount = null;
    segment = loadSegment();
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
    applyParams(params);
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
