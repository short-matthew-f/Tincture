/**
 * overlay.js: toasts, modals and bottom sheets on #toasts / #modal.
 *
 * Owns: toast(text, {hex, ms, action, kind}), setToastGate(fn),
 * suspendToasts(), clearToasts(), placeToasts(), modal({...}) -> Promise, sheet({...})
 * -> Promise, isOpen(), dismissTop(), closeAll(), and injectStyle(id, css) for
 * the app-level UI modules (naming, phase-beat, onboarding) that keep their
 * small styles next to their code. Implements docs/UI-CONTRACT.md `ctx.toast`,
 * `ctx.modal`, `ctx.sheet` and ARCHITECTURE.md "UI kit" (.toast, .modal,
 * .sheet in style.css).
 *
 * Modals and sheets queue: one is visible at a time; the next opens when the
 * current one settles. Backdrop tap and Escape dismiss a dismissable one
 * (resolving `null`). Every button carries data-tap (tick + haptic).
 */

import { h, raw, escapeHtml, safeHex } from './kit.js';

const doc = () => (typeof document !== 'undefined' ? document : null);

/** Add a <style id=…> once. */
export function injectStyle(id, css) {
  const d = doc();
  if (!d || d.getElementById(id)) return;
  const s = d.createElement('style');
  s.id = id;
  s.textContent = css;
  d.head.appendChild(s);
}

injectStyle('overlay-style', `
.toast { display: inline-flex; align-items: center; gap: 8px; }
.toast .toast-dot { width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto; box-shadow: 0 0 0 1.5px rgba(42,38,34,.18); }
.sheet .modal-title { font-family: var(--font-display); font-size: 22px; line-height: 1.15; }
.sheet .actions { display: flex; gap: 10px; }
.sheet .actions.stacked { flex-direction: column; }
.modal .modal-body, .sheet .modal-body { color: var(--ink-soft); font-size: 15px; line-height: 1.4; }
.modal .actions.stacked { flex-direction: column; }
`);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
//
// Rules (docs/UX-AUDIT.md "Toasts and modals", Top 12 #6):
//  - a small paper slip just below the visible screen's head (measured on every
//    toast, so a tall head or a sticky sub-head is never covered);
//  - at most MAX_TOASTS on screen, the oldest leaves first; a tap dismisses;
//  - the same text within DEDUPE_MS shows once (its timer refreshes);
//  - informational toasts (kind 'info', the app's domain events) collapse into
//    one slip: a second one within DEDUPE_MS joins the first as a sentence;
//  - a gate (setToastGate, set by app.js) may hold a toast (a coach mark, a
//    ceremony or a puzzle is up) or drop it (a discovery while the naming
//    screen already shows it). Held toasts show once the gate opens; held
//    action feedback older than HOLD_ACTION_MS is stale and dropped.

const MAX_TOASTS = 2;
const DEFAULT_MS = 2400;
const DEDUPE_MS = 3000;
const HOLD_ACTION_MS = 4000;
const MAX_HELD = 3;

let gate = null;          // fn({text, kind}) -> 'show' | 'hold' | 'drop'
const held = [];          // [{text, opts, at}]
let heldTimer = null;
const recent = new Map(); // text -> last shown at (ms)

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** setToastGate(fn): fn({text, kind}) -> 'show' | 'hold' | 'drop'. null clears it. */
export function setToastGate(fn) {
  gate = typeof fn === 'function' ? fn : null;
}

function toastsEl() {
  const d = doc();
  if (!d) return null;
  let el = d.getElementById('toasts');
  if (!el) {
    el = d.createElement('div');
    el.id = 'toasts';
    el.setAttribute('aria-live', 'polite');
    d.body.appendChild(el);
  }
  return el;
}

/** Put the toast host just under the visible screen's head (never over it). */
function placeHost(host) {
  const d = doc();
  let y = null;
  try {
    const top = d.querySelector('#app > .screen.is-top:not([hidden])')
      || [...d.querySelectorAll('#app > .screen:not([hidden])')].pop();
    const head = top && top.querySelector('.screen-head');
    if (head) {
      const r = head.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0) y = r.bottom + 8;
    }
  } catch (e) { /* measuring is best effort */ }
  if (y !== null) host.style.setProperty('--toast-top', `${Math.round(y)}px`);
  else host.style.removeProperty('--toast-top');
}

function removeToast(t) {
  if (!t || t._leaving) return;
  t._leaving = true;
  clearTimeout(t._timer);
  t.classList.add('is-leaving');
  setTimeout(() => t.remove(), 170);
}

function liveToasts(host) {
  return [...host.querySelectorAll('.toast')].filter((x) => !x._leaving);
}

function arm(t, ms) {
  clearTimeout(t._timer);
  t._timer = setTimeout(() => removeToast(t), Math.max(800, ms));
}

const sentence = (x) => {
  const v = String(x).trim();
  return /[.!?…]$/.test(v) ? v : `${v}.`;
};

function judge(text, kind) {
  if (!gate) return 'show';
  try { return gate({ text: String(text), kind }) || 'show'; } catch (e) { return 'show'; }
}

function pumpHeld() {
  clearTimeout(heldTimer);
  heldTimer = null;
  const now = nowMs();
  while (held.length) {
    const item = held[0];
    const kind = item.opts.kind || 'action';
    if (kind === 'action' && now - item.at > HOLD_ACTION_MS) { held.shift(); continue; }
    const verdict = judge(item.text, kind);
    if (verdict === 'hold') break;
    held.shift();
    if (verdict === 'drop') continue;
    showToast(item.text, item.opts);
  }
  if (held.length) heldTimer = setTimeout(pumpHeld, 400);
}

function hold(text, opts) {
  const at = nowMs();
  const same = held.find((x) => x.text === String(text));
  if (same) same.at = at;
  else held.push({ text: String(text), opts, at });
  while (held.length > MAX_HELD) held.shift();
  if (!heldTimer) heldTimer = setTimeout(pumpHeld, 400);
}

function showToast(text, opts) {
  const { hex = null, ms = DEFAULT_MS, action = null, kind = 'action' } = opts || {};
  const host = toastsEl();
  if (!host) return { dismiss() {} };
  const str = String(text);
  const now = nowMs();
  placeHost(host);
  const live = liveToasts(host);

  // The same words within a few seconds: one slip, its timer refreshed.
  const twin = live.find((x) => x._text === str || (x._parts && x._parts.includes(str)));
  if (twin) { arm(twin, ms); recent.set(str, now); return { dismiss: () => removeToast(twin) }; }
  if (!action && now - (recent.get(str) || -1e9) < DEDUPE_MS) return { dismiss() {} };
  recent.set(str, now);
  for (const [k, at] of recent) if (now - at > DEDUPE_MS) recent.delete(k);

  // Informational news collapses into one slip ("A quest is ready. A postcard: ...").
  if (kind === 'info' && !action) {
    const info = live.find((x) => x._kind === 'info' && now - x._at < DEDUPE_MS && x._parts.length < 3);
    if (info) {
      info._parts.push(str);
      info._at = now;
      const span = info.querySelector('[data-toast-text]');
      if (span) span.textContent = info._parts.map(sentence).join(' ');
      arm(info, ms + 600);
      return { dismiss: () => removeToast(info) };
    }
  }

  const t = doc().createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t._text = str;
  t._parts = [str];
  t._kind = kind;
  t._at = now;
  t.innerHTML = String(h`${hex ? raw(`<span class="toast-dot" style="background:${safeHex(hex)}"></span>`) : ''}<span data-toast-text>${str}</span>${action ? h`<button type="button" class="btn btn-paper small" data-tap>${action.label}</button>` : ''}`);
  if (action) {
    const b = t.querySelector('button');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      removeToast(t);
      try { action.onClick && action.onClick(); } catch (err) { console.error(err); }
    });
  }
  t.addEventListener('click', () => removeToast(t)); // a tap anywhere on a toast dismisses it
  host.appendChild(t);
  const all = liveToasts(host);
  while (all.length > MAX_TOASTS) removeToast(all.shift());
  arm(t, ms);
  return { dismiss: () => removeToast(t) };
}

/**
 * toast(text, {hex, ms=2400, action:{label, onClick}, kind='action'|'info'|'discovery'}) -> {dismiss}.
 * `kind` (optional): 'action' is direct feedback to a tap (the default),
 * 'info' is news from the world (collapses with other news), 'discovery' is a
 * color joining the catalog (dropped while the naming screen shows it).
 */
export function toast(text, opts = {}) {
  const o = opts || {};
  const kind = o.kind || 'action';
  const verdict = judge(text, kind);
  if (verdict === 'drop') return { dismiss() {} };
  if (verdict === 'hold') {
    hold(text, { ...o, kind });
    return { dismiss() { const i = held.findIndex((x) => x.text === String(text)); if (i >= 0) held.splice(i, 1); } };
  }
  return showToast(text, { ...o, kind });
}

/**
 * suspendToasts(): take the visible toasts off screen (a coach mark is about
 * to appear). News ('info') goes back in the held queue and shows when the
 * gate opens; action feedback is stale by then and simply leaves.
 */
export function suspendToasts() {
  const host = toastsEl();
  if (!host) return;
  for (const t of liveToasts(host)) {
    if (t._kind === 'info') for (const part of t._parts) hold(part, { kind: 'info' });
    removeToast(t);
  }
}

/** placeToasts(): move the toast stack under the (new) visible screen's head. */
export function placeToasts() {
  const host = doc() && doc().getElementById('toasts');
  if (host && liveToasts(host).length) placeHost(host);
}

/** clearToasts(): remove every toast, visible and held. */
export function clearToasts() {
  held.length = 0;
  clearTimeout(heldTimer);
  heldTimer = null;
  const host = toastsEl();
  if (host) for (const t of liveToasts(host)) removeToast(t);
}

// ---------------------------------------------------------------------------
// Modal and sheet
// ---------------------------------------------------------------------------

const queue = [];
let current = null; // {opts, resolve, kind, prevFocus}
const listeners = new Set();

/** Subscribe to open/close (the router keeps history in step). */
export function onOverlayChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => { try { fn(!!current); } catch (e) { /* ignore */ } });

function modalEl() {
  const d = doc();
  if (!d) return null;
  let el = d.getElementById('modal');
  if (!el) {
    el = d.createElement('div');
    el.id = 'modal';
    el.hidden = true;
    d.body.appendChild(el);
  }
  return el;
}

function actionsHtml(actions, stacked) {
  return h`<div class="actions${stacked ? ' stacked' : ''}">${actions.map((a, i) => {
    const cls = a.variant === 'primary' ? 'btn-primary' : a.variant === 'wood' ? 'btn-wood' : 'btn-paper';
    return h`<button type="button" class="btn ${cls}" data-tap data-overlay-action="${i}">${a.label}</button>`;
  })}</div>`;
}

function render(item) {
  const el = modalEl();
  const { opts, kind } = item;
  const actions = Array.isArray(opts.actions) && opts.actions.length
    ? opts.actions
    : [{ label: kind === 'sheet' ? 'Close' : 'OK', variant: 'primary', value: true }];
  item.actions = actions;
  const stacked = kind === 'sheet' || actions.length > 2 || actions.some((a) => String(a.label).length > 18);
  const body = opts.body === undefined || opts.body === null ? '' : raw(String(opts.body));
  const titleId = 'overlay-title';
  el.className = kind === 'sheet' ? 'bottom' : '';
  el.innerHTML = String(h`<div class="${kind === 'sheet' ? 'sheet' : 'modal'}${opts.cls ? ' ' + opts.cls : ''}" role="dialog" aria-modal="true" ${raw(opts.title ? `aria-labelledby="${titleId}"` : 'aria-label="Dialog"')}>
    ${opts.title ? h`<div class="modal-title" id="${titleId}">${opts.title}</div>` : ''}
    ${body ? h`<div class="modal-body">${body}</div>` : ''}
    ${actionsHtml(actions, stacked)}
  </div>`);
  el.hidden = false;
  const first = el.querySelector('[data-overlay-action]');
  if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

function settle(value) {
  const item = current;
  if (!item) return;
  current = null;
  const el = modalEl();
  if (el) { el.hidden = true; el.innerHTML = ''; el.className = ''; }
  try { item.resolve(value); } catch (e) { /* ignore */ }
  if (item.prevFocus && item.prevFocus.focus) { try { item.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  if (queue.length) open(queue.shift());
  else notify();
}

function open(item) {
  current = item;
  item.prevFocus = doc() ? doc().activeElement : null;
  render(item);
  notify();
}

let wired = false;
function wire() {
  if (wired || !doc()) return;
  wired = true;
  const el = modalEl();
  el.addEventListener('click', (e) => {
    if (!current) return;
    const b = e.target.closest('[data-overlay-action]');
    if (b) {
      const a = current.actions[Number(b.dataset.overlayAction)] || {};
      settle(a.value !== undefined ? a.value : a.label);
      return;
    }
    if (e.target === el && current.opts.dismissable !== false) settle(null);
  });
  doc().addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && current.opts.dismissable !== false) settle(null);
  });
}

function enqueue(kind, opts = {}) {
  return new Promise((resolve) => {
    if (!doc()) { resolve(null); return; }
    wire();
    const item = { kind, opts: opts || {}, resolve };
    if (current) queue.push(item);
    else open(item);
  });
}

/**
 * modal({title, body (html string), actions:[{label, variant, value}], dismissable=true, cls})
 * -> Promise<value> (null when dismissed by backdrop / Escape / back).
 */
export function modal(opts) {
  return enqueue('modal', opts);
}

/** sheet({title, body, actions, dismissable=true}) -> Promise<value>. Bottom sheet. */
export function sheet(opts) {
  return enqueue('sheet', opts);
}

/** True while a modal or sheet is showing. */
export function isOpen() {
  return !!current;
}

/** Back button: dismiss the visible modal/sheet. Returns true if one was showing. */
export function dismissTop() {
  if (!current) return false;
  if (current.opts.dismissable !== false) settle(null);
  return true;
}

/** Close everything (queued ones resolve null too). */
export function closeAll() {
  while (queue.length) { const q = queue.shift(); try { q.resolve(null); } catch (e) { /* ignore */ } }
  if (current) settle(null);
}

export { escapeHtml };

export default { toast, setToastGate, suspendToasts, clearToasts, placeToasts, modal, sheet, isOpen, dismissTop, closeAll, onOverlayChange, injectStyle };
