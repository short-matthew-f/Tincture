/**
 * onboarding.js: screen `onboarding` (the welcome card) and the
 * first-ten-minutes coach script driven by `state.onboarding`.
 * Implements DESIGN.md "Fun and engagement > First ten minutes":
 *
 *   step 0  welcome card ("You inherit a dusty dye workshop…")
 *   step 1  mix the first orange for a customer (a seeded madder + ochre order),
 *           then name it (the discovery ceremony)
 *   step 2  grade a Relaxed board (it can reveal a tint)
 *   step 3  first upgrades; the flow meter's glowing bottleneck
 *   step 4  at 5 colors the Merge Shelf opens, seeded so the first drop chains
 *   step 5  the order board fills; the Mill Room goal (10 colors)
 *   step 6  locked but visible: the hunters' map window, then the Gallery door
 *   step 7  Close up shop, ending the session on a promise -> done
 *
 * Coach marks are small paper tags in #coach-layer pointing at
 * `[data-coach="…"]` targets that screens expose (first-order, grading,
 * flow-meter, shelf, mill-room, map-window, gallery-door, close-up; on the
 * shelf the seeded cell `[data-cell="N"]`). A missing target shows a centered
 * card instead. Nothing blocks play: a pointing tag lets taps through to what
 * lies under it (only its button is tappable), every mark has "Got it" (advances the
 * script) and steps also complete on their own from domain events and state.
 *
 * Pure helpers (fn(state, args, now), used through game.act and in tests):
 * setOnboarding, seedFirstOrder, seedFirstChain.
 */

import { h, raw, button } from './kit.js';
import { injectStyle } from './overlay.js';
import * as sim from '../sim/index.js';
import { getColor } from '../content/catalog.js';

export const FIRST_ORDER_ID = 'o-first-orange';
const INFO_GAP_MS = 30e3; // informational steps wait this long after the previous step

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function ob(state) {
  if (!state.onboarding || typeof state.onboarding !== 'object') state.onboarding = { step: 0, done: false, flags: {} };
  if (!state.onboarding.flags || typeof state.onboarding.flags !== 'object') state.onboarding.flags = {};
  return state.onboarding;
}

/** setOnboarding(state, {step, done, flags}, now) -> onboarding copy. */
export function setOnboarding(state, args = {}, now = 0) {
  const o = ob(state);
  if (Number.isFinite(args.step) && args.step !== o.step) {
    o.step = args.step;
    o.flags.stepAt = now;
  }
  if (args.flags && typeof args.flags === 'object') Object.assign(o.flags, args.flags);
  if (args.done) {
    o.done = true;
    o.flags.doneAt = now;
  }
  return { step: o.step, done: o.done, flags: { ...o.flags } };
}

/** seedFirstOrder(state, args, now) -> {ok, orderId}. Posts the tutorial order: orange from madder + ochre. */
export function seedFirstOrder(state, args = {}, now = 0) {
  if (!state.orders || !Array.isArray(state.orders.open)) state.orders = { open: [], nextRefreshAt: 0, reputation: 0, filledCount: 0, ...(state.orders || {}) };
  const b = state.orders;
  if (!Array.isArray(b.open)) b.open = [];
  if (b.open.some((o) => o && o.id === FIRST_ORDER_ID)) return { ok: false, reason: 'posted', orderId: FIRST_ORDER_ID };
  const orange = getColor('orange');
  let base = {};
  try { base = sim.generateOrder(state, undefined, now) || {}; } catch (e) { base = {}; }
  const order = {
    ...base,
    id: FIRST_ORDER_ID,
    kind: 'match',
    target: orange ? orange.hex : '#c56731',
    recipe: [{ pigment: 'madder', weight: 1 }, { pigment: 'ochre', weight: 1 }],
    container: null,
    postedAt: now,
    customer: 'A neighbor',
    pay: Number.isFinite(base.pay) ? base.pay : 1,
    minutes: Number.isFinite(base.minutes) ? base.minutes : 3,
    tutorial: true,
  };
  b.open.unshift(order);
  while (b.open.length > 6) b.open.pop();
  ob(state).flags.firstOrderId = FIRST_ORDER_ID;
  return { ok: true, orderId: FIRST_ORDER_ID };
}

/**
 * seedFirstChain(state, {colorId?}) -> {ok, from, to, colorId}. Places
 * [vial][ ][vial][jar] in one row of the Merge Shelf, so dragging the first
 * vial onto the second makes a jar that chains into a bottle. Once only.
 */
export function seedFirstChain(state, args = {}) {
  const o = ob(state);
  if (o.flags.chainSeeded) return { ok: false, reason: 'done' };
  const s = state.shelf;
  if (!s || !Array.isArray(s.cells) || !(s.cols >= 4)) return { ok: false, reason: 'shelf' };
  const discovered = Object.keys((state.catalog && state.catalog.discovered) || {});
  const colorId = args.colorId
    || (discovered.includes('orange') ? 'orange' : null)
    || discovered.find((id) => !['madder', 'ochre', 'woad'].includes(id))
    || discovered[0];
  if (!colorId) return { ok: false, reason: 'color' };
  let row = -1;
  for (let r = 0; r < s.rows && row < 0; r++) {
    const base = r * s.cols;
    if ([0, 1, 2, 3].every((k) => !s.cells[base + k])) row = r;
  }
  if (row < 0) return { ok: false, reason: 'full' };
  const added = [
    sim.shelf.addVial(state, { colorId, tier: 1 }),
    sim.shelf.addVial(state, { colorId, tier: 1 }),
    sim.shelf.addVial(state, { colorId, tier: 2 }),
  ];
  if (added.some((i) => i === null || i === undefined)) {
    for (const i of added) if (i !== null && i !== undefined) s.cells[i] = null;
    return { ok: false, reason: 'full' };
  }
  const items = added.map((i) => s.cells[i]);
  for (const i of added) s.cells[i] = null;
  const base = row * s.cols;
  s.cells[base] = items[0];
  s.cells[base + 2] = items[1];
  s.cells[base + 3] = items[2];
  o.flags.chainSeeded = true;
  o.flags.chainCells = { from: base, to: base + 2, jar: base + 3 };
  return { ok: true, from: base, to: base + 2, colorId };
}

function levelSum(state) {
  const st = state.stations || {};
  let n = 0;
  for (const v of Object.values(st.sources || {})) n += Number(v && v.level) || 0;
  for (const k of ['grinders', 'mixers', 'vats', 'fleet']) for (const v of st[k] || []) n += Number(v && v.level) || 0;
  n += Number(st.shop && st.shop.level) || 0;
  return n;
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

/**
 * Each step: screen (where its target lives), targets (selectors, first
 * visible wins), text, ok (button label), info (informational: waits
 * INFO_GAP_MS after the previous step), ready(state) (may it show yet?).
 */
const STEPS = {
  1: { screen: 'orders', targets: ['[data-coach="first-order"]', `[data-order="${FIRST_ORDER_ID}"]`],
    text: 'A neighbor wants orange. Open the order and mix madder with ochre.', away: 'Your first customer is waiting on the order board.' },
  2: { screen: 'puzzles', targets: ['[data-coach="grading"]'],
    text: 'Try a Relaxed grading board: slide the tiles into a smooth gradient. A solved board can reveal a new tint.',
    away: 'A grading board is ready in Puzzles. Solved boards can reveal new tints.' },
  3: { screen: 'workshop', targets: ['[data-screen="workshop"] [data-action="suggestion"]', '[data-coach="flow-meter"]'],
    text: 'The flow meter above finds your slowest step, and this button fixes it: tap it for the upgrade that helps most.',
    away: 'Your workshop has coins to spend. The flow meter shows what to upgrade.' },
  4: { screen: 'shelf', targets: [],
    text: 'The Merge Shelf is open. Drag the left vial onto its twin and watch it chain.',
    away: 'Five colors: your Merge Shelf is open, with a few vials waiting.',
    ready: (s) => sim.discoveredCount(s) >= sim.shelf.UNLOCK_COLORS },
  5: { screen: 'workshop', targets: ['[data-coach="mill-room"]'], info: true,
    text: 'Orders keep coming in. At 10 colors the Mill Room opens: another grinder and another mixer.' },
  6: { screen: 'workshop', targets: ['[data-coach="map-window"]'], info: true,
    text: 'Beyond this window your hunters wait. They set out once your catalog reaches 10 colors.' },
  6.5: { screen: 'workshop', targets: ['[data-coach="gallery-door"]'], info: true,
    text: 'The Gallery door opens a little later. You will paint with every color you make.' },
  7: { screen: 'workshop', targets: ['[data-coach="close-up"]'], info: true,
    text: 'When you are ready to stop, Close up shop: hunters head out overnight and the vats keep filling.' },
};
const ORDER = [1, 2, 3, 4, 5, 6, 6.5, 7];
const CEREMONIES = new Set(['naming', 'phase-beat', 'onboarding']);

const nextStep = (step) => {
  const i = ORDER.indexOf(step);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
};

injectStyle('onboarding-style', `
#coach-layer { position: fixed; inset: 0; z-index: 30; pointer-events: none; }
#coach-layer .coach-tag { position: fixed; left: 0; top: 0; width: min(300px, calc(100vw - 24px)); pointer-events: auto; background: var(--paper); color: var(--ink); border-radius: 12px; padding: 12px 12px 10px; box-shadow: 0 3px 0 var(--shadow); display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.35; animation: pop-in 200ms var(--ease-out) both; }
#coach-layer .coach-tag::before { content: ''; position: absolute; left: var(--arrow-x, 50%); width: 14px; height: 14px; background: var(--paper); transform: translateX(-50%) rotate(45deg); }
#coach-layer .coach-tag:not(.card) { border: 2px solid var(--glow-ring); background: var(--glow); pointer-events: none; }
#coach-layer .coach-tag:not(.card) button { pointer-events: auto; }
#coach-layer .coach-tag:not(.card)::before { background: var(--glow); }
#coach-layer .coach-tag.below::before { top: -9px; border-top: 2px solid var(--glow-ring); border-left: 2px solid var(--glow-ring); }
#coach-layer .coach-tag.above::before { bottom: -9px; border-bottom: 2px solid var(--glow-ring); border-right: 2px solid var(--glow-ring); }
#coach-layer .coach-tag.card { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(340px, calc(100vw - 32px)); padding: 16px; gap: 10px; text-align: center; animation: fade-in 160ms ease-out both; }
#coach-layer .coach-tag.card::before { display: none; }
#coach-layer .coach-row { display: flex; gap: 8px; justify-content: flex-end; }
#coach-layer .coach-tag.card .coach-row { justify-content: center; }
#coach-layer .coach-kicker { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; }
#coach-layer .coach-ring { position: fixed; left: 0; top: 0; border-radius: 14px; box-shadow: 0 0 0 3px var(--glow-ring), 0 0 0 7px rgba(185,131,28,.18); pointer-events: none; animation: breathe 1.6s ease-in-out infinite; }
.screen[data-screen="onboarding"] { align-items: center; justify-content: center; padding: 16px; }
.welcome-card { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 14px; text-align: center; }
.welcome-card .welcome-title { font-family: var(--font-display); font-size: 34px; line-height: 1.1; }
.welcome-card .welcome-lines { color: var(--ink-soft); font-size: 16px; line-height: 1.45; }
.welcome-card svg { width: 100%; height: auto; border-radius: 16px; box-shadow: 0 3px 0 var(--shadow); }
.welcome-skip { align-self: center; font-size: 13px; color: var(--ink-soft); text-decoration: underline; min-height: 44px; padding: 0 12px; }
`);

let root = null;
let ctx = null;
let layer = null;
let shownKey = '';
let awayHidden = new Set(); // steps whose "away" card she closed with "Not now" (this session)
const pendingKeys = new Set();

function state() { return ctx.game.state; }
function stepNow() { return ob(state()).step; }
function isDone() { return !!ob(state()).done; }

function advance(from) {
  const o = ob(state());
  if (o.done || o.step !== from) return;
  const to = nextStep(from);
  if (to === null) ctx.game.act(setOnboarding, { done: true });
  else ctx.game.act(setOnboarding, { step: to });
  onEnter(to);
}

function finishAll() {
  ctx.game.act(setOnboarding, { done: true });
  clearLayer();
}

/** Side effects when a step begins. */
function onEnter(step) {
  if (step === 2) {
    try { ctx.game.act(sim.setPuzzleTier, { puzzle: 'grading', tier: 'relaxed' }); } catch (e) { /* ignore */ }
  }
  if (step === 3) ctx.game.act(setOnboarding, { flags: { levelsAt: levelSum(state()) } });
}

/** Defer game.act out of event handlers and render (we may be inside a drain). Deduped by key. */
function later(fn, key = fn.toString()) {
  if (pendingKeys.has(key)) return;
  pendingKeys.add(key);
  setTimeout(() => {
    pendingKeys.delete(key);
    try { fn(); } catch (e) { console.error('[onboarding]', e); }
  }, 0);
}

/** Step completion from state (runs every render frame). */
function checkState(s) {
  const o = ob(s);
  if (o.done) return;
  const step = o.step;
  const d = s.catalog && s.catalog.discovered ? s.catalog.discovered : {};
  if (step === 1 && d.orange) { later(() => advance(1)); return; }
  if (step === 3) {
    if (!Number.isFinite(o.flags.levelsAt)) { later(() => ctx.game.act(setOnboarding, { flags: { levelsAt: levelSum(state()) } })); return; }
    if (levelSum(s) >= o.flags.levelsAt + 3) { later(() => advance(3)); return; }
  }
  if (step === 4 && STEPS[4].ready(s) && !o.flags.chainSeeded) {
    later(() => {
      const res = ctx.game.act(seedFirstChain, {});
      if (!res || !res.ok) ctx.game.act(setOnboarding, { flags: { chainSeeded: true, chainCells: null } });
    });
    return;
  }
  if (step === 4 && o.flags.chainSeeded) {
    const cells = o.flags.chainCells;
    const shelf = s.shelf && s.shelf.cells;
    if (!cells || !shelf || !shelf[cells.from] || !shelf[cells.to]) { later(() => advance(4)); return; }
  }
  if (step === 5 && (s.rooms || []).includes('mill-room')) { later(() => advance(5)); return; }
  if (step === 7 && s.stats && s.stats.lastCloseUpAt > 0) later(() => advance(7));
}

function onEvent(type, payload) {
  if (!ctx || isDone()) return;
  const step = stepNow();
  const p = payload || {};
  if (step <= 1 && type === 'orderFilled' && p.orderId === FIRST_ORDER_ID) {
    later(() => {
      const d = state().catalog.discovered;
      if (!d.orange) ctx.game.act(sim.discover, { colorId: 'orange', method: 'order' });
    });
  }
  if (step === 2 && (type === 'boardSolved' || type === 'puzzleSolved' || (type === 'discover' && /grad/.test(String(p.method || ''))))) {
    later(() => advance(2));
  }
  if (step === 4 && (type === 'chain' || type === 'merged')) later(() => advance(4));
}

// ---------------------------------------------------------------------------
// Coach layer
// ---------------------------------------------------------------------------

function ensureLayer() {
  if (layer) return layer;
  layer = document.getElementById('coach-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'coach-layer';
    document.body.appendChild(layer);
  }
  layer.addEventListener('click', onLayerClick);
  return layer;
}

function clearLayer() {
  if (layer) layer.innerHTML = '';
  shownKey = '';
}

function onLayerClick(e) {
  const b = e.target.closest('[data-coach-action]');
  if (!b) return;
  const step = Number(b.dataset.step);
  const action = b.dataset.coachAction;
  if (action === 'ok') advance(step);
  else if (action === 'go') {
    const def = STEPS[step];
    clearLayer();
    if (def) ctx.navigate(def.screen);
  } else if (action === 'later') {
    awayHidden.add(step);
    clearLayer();
  } else if (action === 'skip-all') finishAll();
}

function visibleTarget(sel, topSection, tabbar) {
  let list;
  try { list = document.querySelectorAll(sel); } catch (e) { return null; }
  for (const el of list) {
    if (!(topSection && topSection.contains(el)) && !(tabbar && tabbar.contains(el))) continue;
    const r = clipped(el);
    if (r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) return el;
  }
  return null;
}

/** The part of el's box that its scroll container actually shows (null when none). */
function clipped(el) {
  const r = el.getBoundingClientRect();
  const box = el.closest('.screen-body');
  if (!box) return r;
  const c = box.getBoundingClientRect();
  const top = Math.max(r.top, c.top);
  const bottom = Math.min(r.bottom, c.bottom);
  const left = Math.max(r.left, c.left);
  const right = Math.min(r.right, c.right);
  // Mostly hidden under the header or the tab bar: not a target to point at.
  if (bottom - top < Math.min(24, r.height * 0.6) || right - left <= 0) return null;
  return { top, bottom, left, right, width: right - left, height: bottom - top };
}

function targetsFor(step, s) {
  const def = STEPS[step];
  const out = [...(def.targets || [])];
  if (step === 4) {
    const cells = ob(s).flags.chainCells;
    if (cells) out.push(`[data-screen="shelf"] [data-cell="${cells.from}"]`);
    out.push('[data-coach="shelf-first"]', '[data-coach="shelf"]');
  }
  return out;
}

function tagHtml(step, text, { card = false, away = false } = {}) {
  const actions = away
    ? h`${button('Not now', { small: true, attrs: { 'data-coach-action': 'later', 'data-step': step } })}${button('Show me', { small: true, variant: 'primary', attrs: { 'data-coach-action': 'go', 'data-step': step } })}`
    : button('Got it', { small: true, variant: card ? 'primary' : 'paper', attrs: { 'data-coach-action': 'ok', 'data-step': step } });
  return h`<div class="coach-tag ${card ? 'card' : ''}" role="note" aria-live="polite">
    ${card ? h`<div class="coach-kicker">Getting started</div>` : ''}
    <div class="coach-text">${text}</div>
    <div class="coach-row">${actions}</div>
  </div>${card ? '' : h`<div class="coach-ring"></div>`}`;
}

function place(target) {
  const tag = layer.querySelector('.coach-tag');
  const ring = layer.querySelector('.coach-ring');
  if (!tag || !target) return;
  const r = clipped(target) || target.getBoundingClientRect();
  if (ring) {
    ring.style.left = `${Math.round(r.left - 4)}px`;
    ring.style.top = `${Math.round(r.top - 4)}px`;
    ring.style.width = `${Math.round(r.width + 8)}px`;
    ring.style.height = `${Math.round(r.height + 8)}px`;
  }
  const w = tag.offsetWidth || 300;
  const hgt = tag.offsetHeight || 100;
  const vw = innerWidth;
  const vh = innerHeight;
  const below = r.bottom + 12 + hgt < vh - 8 || r.top - 12 - hgt < 8;
  const top = below ? Math.min(vh - hgt - 8, r.bottom + 12) : Math.max(8, r.top - 12 - hgt);
  const cx = r.left + r.width / 2;
  const left = Math.max(12, Math.min(vw - 12 - w, cx - w / 2));
  tag.classList.toggle('below', below);
  tag.classList.toggle('above', !below);
  tag.style.left = `${Math.round(left)}px`;
  tag.style.top = `${Math.round(top)}px`;
  tag.style.setProperty('--arrow-x', `${Math.max(16, Math.min(w - 16, cx - left))}px`);
}

/** observe(state, top): called by the app every render frame. */
function observe(s, top) {
  if (!ctx || typeof document === 'undefined') return;
  const o = ob(s);
  if (o.done) { if (shownKey) clearLayer(); return; }
  checkState(s);
  ensureLayer();
  const step = o.step;
  const def = STEPS[step];
  const topId = top && top.id;
  const modalOpen = !!(document.getElementById('modal') && !document.getElementById('modal').hidden);
  const topSection = topId ? document.querySelector(`#app > [data-screen="${topId}"]`) : null;
  // A screen's own sheet or dialog is up (recipe picker, row labels, ...): never cover it.
  const dialogOpen = !!(topSection && [...topSection.querySelectorAll('[role="dialog"]')]
    .some((el) => el.getClientRects().length > 0 && !el.closest('[hidden]')));
  if (!def || !topId || CEREMONIES.has(topId) || modalOpen || dialogOpen || (def.ready && !def.ready(s))
    || (def.info && ctx.game.now() - (Number(o.flags.stepAt) || 0) < INFO_GAP_MS)
    || (step === 4 && !o.flags.chainSeeded)) {
    if (shownKey) clearLayer();
    return;
  }
  const tabbar = document.getElementById('tabbar');
  let target = null;
  for (const sel of targetsFor(step, s)) {
    target = visibleTarget(sel, topSection, tabbar);
    if (target) break;
  }
  let key;
  let html;
  if (target) {
    key = `t:${step}`;
    html = tagHtml(step, def.text);
  } else if (topId === def.screen) {
    key = `c:${step}`;
    html = tagHtml(step, def.text, { card: true });
  } else if (ctx.isTab && ctx.isTab(topId) && !awayHidden.has(step) && !def.info) {
    key = `a:${step}`;
    html = tagHtml(step, def.away || def.text, { card: true, away: true });
  } else if (def.info && ctx.isTab && ctx.isTab(topId) && !awayHidden.has(step)) {
    key = `i:${step}`;
    html = tagHtml(step, def.text, { card: true });
  } else {
    if (shownKey) clearLayer();
    return;
  }
  if (key !== shownKey) {
    layer.innerHTML = String(html);
    shownKey = key;
  }
  if (target) place(target);
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------

function welcomeArt() {
  return `<svg viewBox="0 0 320 170" aria-hidden="true">
<rect width="320" height="170" fill="#E3E6E0"/>
<path d="M0 34 L160 8 L320 34 V42 H0 Z" fill="#B7BDB3"/>
<rect x="206" y="52" width="70" height="56" rx="4" fill="#FFF6DF" stroke="#7B5236" stroke-width="5"/>
<path d="M241 52 V108 M206 80 H276" stroke="#7B5236" stroke-width="3.5"/>
<path d="M0 142 H320 V170 H0 Z" fill="#D3D8D0"/>
<rect x="36" y="100" width="150" height="12" rx="2" fill="#7B5236"/>
<rect x="46" y="112" width="9" height="30" fill="#5E3E28"/><rect x="167" y="112" width="9" height="30" fill="#5E3E28"/>
<rect x="56" y="76" width="22" height="24" rx="5" fill="#F2F4F0" stroke="#2A2622" stroke-width="2"/><rect x="56" y="86" width="22" height="14" rx="4" fill="#B8433A"/>
<rect x="88" y="70" width="22" height="30" rx="5" fill="#F2F4F0" stroke="#2A2622" stroke-width="2"/><rect x="88" y="84" width="22" height="16" rx="4" fill="#D39B2A"/>
<rect x="120" y="78" width="22" height="22" rx="5" fill="#F2F4F0" stroke="#2A2622" stroke-width="2"/><rect x="120" y="88" width="22" height="12" rx="4" fill="#3E6A9E"/>
<circle cx="160" cy="92" r="7" fill="#F7F4EC" stroke="#2A2622" stroke-width="2"/>
<path d="M226 128 C236 118 250 118 258 128" fill="none" stroke="rgba(42,38,34,.25)" stroke-width="3" stroke-linecap="round"/>
<path d="M0 142 H320" stroke="rgba(42,38,34,.25)" stroke-width="3"/>
</svg>`;
}

function drawWelcome() {
  if (!root) return;
  root.innerHTML = String(h`<div class="welcome-card">
    ${raw(welcomeArt())}
    <div class="welcome-title">Tincture</div>
    <div class="welcome-lines">You inherit a dusty dye workshop at the edge of Harbor Town: three pigments, one mixer, and a town that wants color.</div>
    ${button('Open the shutters', { variant: 'primary', block: true, attrs: { 'data-action': 'welcome-start' } })}
    <button type="button" class="welcome-skip" data-tap data-action="welcome-skip">I have played before: skip the tour</button>
  </div>`);
}

function startTour() {
  const res = ctx.game.act(seedFirstOrder, {});
  void res;
  ctx.game.act(setOnboarding, { step: 1 });
  try { ctx.audio.chord([0.5, 0.65, 0.8], 0.5); } catch (e) { /* ignore */ }
  ctx.navigate('orders');
}

const screen = {
  id: 'onboarding',
  fullscreen: true,

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      if (t.dataset.action === 'welcome-start') startTour();
      else if (t.dataset.action === 'welcome-skip') {
        finishAll();
        ctx.navigate('workshop');
      }
    });
    const events = ['orderFilled', 'discover', 'named', 'chain', 'boardSolved', 'puzzleSolved', 'merged'];
    for (const type of events) ctx.game.on(type, (p) => onEvent(type, p));
    // Old or imported saves that are clearly past the first session skip the tour.
    const s = state();
    const o = ob(s);
    if (!o.done && ((s.phase || 1) >= 2 || sim.discoveredCount(s) >= 10)) ctx.game.act(setOnboarding, { done: true });
    ctx.game.on('reset', () => { awayHidden = new Set(); clearLayer(); });
    ctx.game.on('import', () => { awayHidden = new Set(); clearLayer(); });
  },

  show() {
    drawWelcome();
  },

  hide() {},

  render() {},

  observe,
};

/** True when the welcome card should open at boot. */
export function needsWelcome(s) {
  const o = ob(s);
  return !o.done && o.step === 0;
}

export { observe };
export default screen;
