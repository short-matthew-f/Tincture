/**
 * overlay.js: toasts, modals and bottom sheets on #toasts / #modal.
 *
 * Owns: toast(text, {hex, ms, action}), modal({...}) -> Promise, sheet({...})
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

const MAX_TOASTS = 3;

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
.toast .toast-dot { width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto; box-shadow: 0 0 0 1.5px rgba(247,244,236,.7); }
.sheet .modal-title { font-family: var(--font-display); font-size: 22px; line-height: 1.15; }
.sheet .actions { display: flex; gap: 10px; }
.sheet .actions.stacked { flex-direction: column; }
.modal .modal-body, .sheet .modal-body { color: var(--ink-soft); font-size: 15px; line-height: 1.4; }
.modal .actions.stacked { flex-direction: column; }
`);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

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

function removeToast(t) {
  if (!t || t._leaving) return;
  t._leaving = true;
  clearTimeout(t._timer);
  t.classList.add('is-leaving');
  setTimeout(() => t.remove(), 170);
}

/**
 * toast(text, {hex, ms=2400, action:{label, onClick}}) -> {dismiss}.
 * Small paper toast just below the screen head (style.css #toasts: head height +
 * safe area, so it never covers the back button or title); at most 3 stacked
 * (the oldest leaves first); a tap dismisses it.
 */
export function toast(text, { hex = null, ms = 2400, action = null } = {}) {
  const host = toastsEl();
  if (!host) return { dismiss() {} };
  const t = doc().createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = String(h`${hex ? raw(`<span class="toast-dot" style="background:${safeHex(hex)}"></span>`) : ''}<span>${text}</span>${action ? h`<button type="button" class="btn btn-paper small" data-tap>${action.label}</button>` : ''}`);
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
  const live = [...host.querySelectorAll('.toast')].filter((x) => !x._leaving);
  while (live.length > MAX_TOASTS) removeToast(live.shift());
  t._timer = setTimeout(() => removeToast(t), Math.max(800, ms));
  return { dismiss: () => removeToast(t) };
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

export default { toast, modal, sheet, isOpen, dismissTop, closeAll, onOverlayChange, injectStyle };
