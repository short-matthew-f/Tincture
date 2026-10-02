/**
 * naming.js: screen `naming`, the discovery ceremony and naming prompt.
 * Implements DESIGN.md "Discovery and the catalog > Discovery moment" and the
 * "New color discovered" row of "Interaction spec": the screen dims 20%, the
 * swatch slides into its page, the name is revealed letter by letter (tap to
 * skip), the four-note motif plays with a success haptic, then the naming
 * prompt: keep the suggested name or type her own. Her name is saved with
 * sim.nameColor and shows everywhere (orders, vats, routes).
 *
 * show({colorId, hex, method, suggestedName, name}) — normally opened by
 * ctx.celebrate('discover', payload), which queues one ceremony at a time.
 * If show() is called while a ceremony is already on screen, the new payload
 * waits in a local queue (belt and braces). Emits on the game bus:
 *   'named'      {colorId, name}            when she keeps or types a name
 *   'namingDone' {colorId, named:boolean}   when the ceremony closes
 * The dim is this screen's own translucent backdrop (fx.dim's layer sits above
 * #app, so it would dim the card too).
 */

import { h, button, safeHex } from './kit.js';
import { injectStyle } from './overlay.js';

injectStyle('naming-style', `
.screen[data-screen="naming"] { background: rgba(42,38,34,.2); align-items: center; justify-content: center; padding: 16px; animation: fade-in 200ms ease-out both; }
.naming-card { width: 100%; max-width: 380px; background: var(--paper); border-radius: 18px; box-shadow: 0 4px 0 var(--shadow); padding: 18px; display: flex; flex-direction: column; gap: 12px; text-align: center; }
.naming-kicker { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; }
.naming-swatch { align-self: center; width: 132px; height: 132px; border-radius: 22px; box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 2px rgba(42,38,34,.12); animation: naming-slide 520ms var(--ease-out) both; }
.naming-name { font-family: var(--font-display); font-size: 28px; line-height: 1.15; min-height: 1.2em; overflow-wrap: anywhere; }
.naming-name .ch { display: inline-block; opacity: 0; animation: naming-letter 160ms var(--ease-out) forwards; white-space: pre; }
.naming-name.is-done .ch { animation: none; opacity: 1; }
.naming-lines { color: var(--ink-soft); font-size: 14px; line-height: 1.4; display: flex; flex-direction: column; gap: 2px; }
.naming-input { width: 100%; min-height: 48px; border-radius: 12px; border: 2px solid var(--plaster-line); background: #fff; padding: 8px 12px; font-family: var(--font-display); font-size: 22px; text-align: center; color: var(--ink); }
.naming-input:focus { outline: none; border-color: var(--walnut); }
.naming-note { font-size: 13px; color: var(--ink-soft); min-height: 1.2em; }
.naming-actions { display: flex; flex-direction: column; gap: 8px; }
.naming-skip { font-size: 12px; color: var(--ink-soft); }
@keyframes naming-slide { from { opacity: 0; transform: translateY(28px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes naming-letter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
html[data-motion="reduced"] .naming-swatch, html[data-motion="reduced"] .naming-name .ch { animation: fade-in 120ms ease-out both; animation-delay: 0ms !important; }
`);

const LETTER_MS = 55;
const REVEAL_MAX_MS = 1500;
const PAGE_NAMES = { wheel: 'Wheel', tints: 'Tints', shades: 'Shades', earths: 'Earths', wild: 'Wild Hues' };

let root = null;
let ctx = null;
let active = null;     // {payload, stage:'reveal'|'prompt'|'edit', suggestion, note, named}
const pending = [];
let revealTimer = null;

function contentColor(id) {
  const c = ctx && ctx.content;
  if (!c) return null;
  if (typeof c.getColor === 'function') {
    const x = c.getColor(id);
    if (x) return x;
  }
  return (c.CATALOG || []).find((x) => x.id === id) || (c.EVENT_COLORS || []).find((x) => x.id === id) || null;
}

function pageLine(colorId) {
  const c = contentColor(colorId);
  if (!c || !c.page) return '';
  const state = ctx.game.state;
  const found = (ctx.content.CATALOG || []).filter((x) => x.page === c.page && state.catalog.discovered[x.id]).length;
  const label = PAGE_NAMES[c.page] || c.page;
  return found <= 1 ? `The first color on the ${label} page.` : `Joins the ${label} page, now ${found} colors strong.`;
}

function recipeLine(colorId) {
  try {
    if (ctx.sim && typeof ctx.sim.canMix === 'function' && ctx.sim.canMix(ctx.game.state, colorId)) {
      return 'Its recipe is now available to your mixers.';
    }
  } catch (e) { /* ignore */ }
  const c = contentColor(colorId);
  if (c && c.foundBy === 'hunt') return 'A wild hue: your hunters found it far from home.';
  return '';
}

function suggestionFor(p) {
  if (p.suggestedName) return p.suggestedName;
  const c = ctx.content || {};
  try {
    const taken = Object.values(ctx.game.state.catalog.discovered || {}).map((d) => d.name);
    if (typeof c.suggestName === 'function') return c.suggestName(p.hex, Math.random, { taken });
  } catch (e) { /* ignore */ }
  return p.name || (contentColor(p.colorId) || {}).name || 'New Color';
}

function nameHtml(text, animate) {
  const chars = [...String(text)];
  const step = Math.min(LETTER_MS, Math.floor(REVEAL_MAX_MS / Math.max(1, chars.length)));
  return h`<div class="naming-name${animate ? '' : ' is-done'}" aria-label="${text}">${chars.map((ch, i) =>
    h`<span class="ch" aria-hidden="true" style="animation-delay:${300 + i * step}ms">${ch}</span>`)}</div>`;
}

function draw() {
  if (!root || !active) return;
  const p = active.payload;
  const hex = safeHex(p.hex || (contentColor(p.colorId) || {}).hex);
  let inner;
  if (active.stage === 'reveal') {
    inner = h`
      <div class="naming-kicker">A new color</div>
      <div class="naming-swatch" style="background:${hex}"></div>
      ${nameHtml(active.suggestion, true)}
      <div class="naming-skip">Tap to continue</div>`;
  } else if (active.stage === 'prompt') {
    inner = h`
      <div class="naming-kicker">A new color</div>
      <div class="naming-swatch" style="background:${hex};animation:none"></div>
      ${nameHtml(active.suggestion, false)}
      <div class="naming-lines">
        ${pageLine(p.colorId) ? h`<div>${pageLine(p.colorId)}</div>` : ''}
        ${recipeLine(p.colorId) ? h`<div>${recipeLine(p.colorId)}</div>` : ''}
      </div>
      <div class="naming-actions">
        ${button('Keep this name', { variant: 'primary', block: true, attrs: { 'data-action': 'keep' } })}
        ${button('Name it yourself', { block: true, attrs: { 'data-action': 'edit' } })}
      </div>`;
  } else {
    inner = h`
      <div class="naming-kicker">Name your color</div>
      <div class="naming-swatch" style="background:${hex};animation:none;width:96px;height:96px"></div>
      <label class="sr-only" for="naming-input">Color name</label>
      <input id="naming-input" class="naming-input" type="text" maxlength="24" autocomplete="off" autocapitalize="words" spellcheck="false" value="${active.draft}">
      <div class="naming-note" role="status">${active.note || 'Letters, spaces, hyphens and apostrophes.'}</div>
      <div class="naming-actions">
        ${button('Save this name', { variant: 'primary', block: true, attrs: { 'data-action': 'save' } })}
        ${button('Use the suggestion', { block: true, attrs: { 'data-action': 'keep' } })}
      </div>`;
  }
  root.innerHTML = String(h`<div class="naming-card" role="dialog" aria-modal="true" aria-label="New color">${inner}</div>`);
  if (active.stage === 'edit') {
    const input = root.querySelector('input');
    if (input) {
      try { input.focus({ preventScroll: true }); input.select(); } catch (e) { /* ignore */ }
    }
  } else if (active.stage === 'prompt') {
    const b = root.querySelector('[data-action="keep"]');
    if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
}

function toPrompt() {
  clearTimeout(revealTimer);
  revealTimer = null;
  if (!active || active.stage !== 'reveal') return;
  active.stage = 'prompt';
  draw();
}

function start(payload) {
  active = { payload, stage: 'reveal', suggestion: suggestionFor(payload), note: '', named: false };
  active.draft = active.suggestion;
  draw();
  try { ctx.audio.motif(); } catch (e) { /* ignore */ }
  try { ctx.haptics.success(); } catch (e) { /* ignore */ }
  const reduced = ctx.fx && ctx.fx.isReducedMotion && ctx.fx.isReducedMotion();
  const ms = reduced ? 500 : Math.min(REVEAL_MAX_MS, 300 + [...active.suggestion].length * LETTER_MS + 500);
  clearTimeout(revealTimer);
  revealTimer = setTimeout(toPrompt, ms);
}

const REASONS = {
  taken: 'Another color already has that name. Try a little twist on it.',
  long: 'A little shorter, please: up to 24 letters.',
  empty: 'Give it a name, even a tiny one.',
  invalid: 'Letters, spaces, hyphens and apostrophes work best.',
};

function commit(name) {
  const p = active.payload;
  let res = null;
  try { res = ctx.game.act(ctx.sim.nameColor, { colorId: p.colorId, name }); } catch (e) { res = null; }
  if (res && res.ok) {
    active.named = true;
    ctx.game.emit('named', { colorId: p.colorId, name: res.name });
    try { ctx.toast(`${res.name} joins your catalog`, { hex: p.hex }); } catch (e) { /* ignore */ }
    finish();
    return true;
  }
  return res;
}

function finish() {
  const p = active && active.payload;
  const named = !!(active && active.named);
  active = null;
  clearTimeout(revealTimer);
  if (p) ctx.game.emit('namingDone', { colorId: p.colorId, named });
  if (pending.length) { start(pending.shift()); return; }
  ctx.back();
}

function onClick(e) {
  if (!active) return;
  if (active.stage === 'reveal') { toPrompt(); return; }
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (action === 'edit') {
    active.stage = 'edit';
    active.note = '';
    draw();
  } else if (action === 'keep') {
    const res = commit(active.suggestion);
    if (res !== true) finish(); // suggestion clashed: keep the catalog name, never block
  } else if (action === 'save') {
    const input = root.querySelector('input');
    const name = input ? input.value.trim().replace(/\s+/g, ' ') : '';
    active.draft = name;
    const res = commit(name);
    if (res !== true) {
      active.note = REASONS[(res && res.reason) || 'invalid'] || REASONS.invalid;
      const note = root.querySelector('.naming-note');
      if (note) note.textContent = active.note;
      else draw();
    }
  }
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Enter' && active.stage === 'edit') {
    e.preventDefault();
    const b = root.querySelector('[data-action="save"]');
    if (b) b.click();
  }
}

const screen = {
  id: 'naming',
  transparent: true,
  fullscreen: true,
  enter: 'fade',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
  },

  show(params = {}) {
    if (!params || !params.colorId) {
      if (!active) ctx.back();
      return;
    }
    if (active && active.payload.colorId !== params.colorId) {
      if (!pending.some((x) => x.colorId === params.colorId)) pending.push(params);
      return;
    }
    if (active) return;
    start(params);
  },

  hide() {
    // Leaving early (phone back): the color keeps its catalog name.
    if (active) {
      const p = active.payload;
      const named = active.named;
      active = null;
      clearTimeout(revealTimer);
      try { ctx.game.emit('namingDone', { colorId: p.colorId, named }); } catch (e) { /* ignore */ }
    }
    pending.length = 0;
  },

  render() {},

  /** True while a ceremony is on screen (app uses it to hold other ceremonies). */
  isBusy: () => !!active,
};

export default screen;
