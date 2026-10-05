/**
 * guide.js: the coach mechanism every subgame uses for its first-open script,
 * plus the "what's next" card and the "How this works" replay link.
 * Implements docs/V02-CONTRACTS.md "guide() coach mechanism" and
 * PLAN-v0.2 Theme D (UX-GUIDELINES-REVIEW §C Theme D item 1). The hygiene
 * rules live here, in the mechanism, not in each screen:
 *
 *  - a step that can end on an action ends on it (`endsOn: 'action'`); only
 *    information steps (`endsOn: 'got-it'`) get a "Got it" button;
 *  - at most 2 steps before the first action step (extra leading
 *    information steps are dropped, with a console.warn in dev);
 *  - at most 15 words a step (console.warn in dev);
 *  - the bubble never covers its anchor or the next target (rects measured,
 *    the side flips), and never shares the screen with a toast, a modal or a
 *    sheet, a screen's own dialog, another guide or the onboarding coach: it
 *    suspends visible toasts, and app.js's toast gate holds new ones while
 *    isGuideUp();
 *  - a step may wait for its trigger (`when(state)`), re-checked on every
 *    change and every 300 ms while the guide runs;
 *  - a guide runs once per id (persisted as state.onboarding.seen[id] through
 *    ctx.game.act(markGuideSeen)), and replay() runs it again from the
 *    "How this works" link in the subgame's header.
 *
 *   const g = guide('shelf', [
 *     { anchor: '[data-coach="shelf-first"]', text: 'Drag a vial onto its twin.',
 *       endsOn: 'action', event: 'merged' },
 *     { anchor: '[data-coach="shelf-chips"]', text: 'Six of one family in a row sell together.' },
 *   ], ctx, { screen: 'shelf' });
 *   g.start();                     // in show(); does nothing once seen
 *   g.stop();                      // in hide()
 *   header: ${howThisWorksHtml('shelf')}  (or the element from howThisWorks('shelf'))
 *
 * Step fields: anchor (selector), text (<= 15 words), when?(state), endsOn?
 * ('action' | 'got-it'; default 'action' when done/event is given), done?(state)
 * (ends an action step on a change), event? (game event name or names that end
 * it), next? (selector to keep clear; default the next step's anchor), side?
 * ('above' | 'below', preferred when it fits), portrait? (html of a speaking
 * character), kicker?. An action step with neither done nor event ends when
 * she taps its anchor.
 *
 * Coach markup and placement helpers (coachHtml, placeBubble, clippedRect,
 * visibleTarget, coachLayer, rectsIntersect) are exported so the onboarding
 * script can draw its marks with the same code.
 *
 * Pure (node-tested): wordCount, stepKind, validateSteps, markGuideSeen,
 * noteCoachDismissed, isSeen, placeBubble, rectsIntersect.
 */

import { h, raw, button } from './kit.js';
import * as overlay from './overlay.js';

export const MAX_WORDS = 15;
export const MAX_STEPS_BEFORE_ACTION = 2;
const POLL_MS = 300;

const hasDom = () => typeof document !== 'undefined';

function isDev() {
  if (typeof location === 'undefined') return false;
  return /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname || '') || /[?&]dev\b/.test(location.search || '');
}

// ---------------------------------------------------------------------------
// Pure: steps
// ---------------------------------------------------------------------------

/** wordCount(text) -> words separated by whitespace. */
export function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** stepKind(step) -> 'action' | 'got-it'. */
export function stepKind(step) {
  if (!step) return 'got-it';
  if (step.endsOn === 'action' || step.endsOn === 'got-it') return step.endsOn;
  return typeof step.done === 'function' || step.event ? 'action' : 'got-it';
}

/**
 * validateSteps(steps) -> {ok, problems: [string], steps: [normalized]}.
 * Enforces "at most 2 steps before the first action" by dropping the extra
 * leading information steps (a guide with no action step keeps 2 steps);
 * reports steps over 15 words or without an anchor or text.
 */
export function validateSteps(steps) {
  const problems = [];
  const list = (Array.isArray(steps) ? steps : []).filter(Boolean).map((s, i) => ({ ...s, endsOn: stepKind(s), _i: i }));
  for (const s of list) {
    if (!s.anchor) problems.push(`step ${s._i + 1} has no anchor`);
    if (!String(s.text || '').trim()) problems.push(`step ${s._i + 1} has no text`);
    const n = wordCount(s.text);
    if (n > MAX_WORDS) problems.push(`step ${s._i + 1} has ${n} words (at most ${MAX_WORDS})`);
  }
  const firstAction = list.findIndex((s) => s.endsOn === 'action');
  let out = list;
  if (firstAction < 0 && list.length > MAX_STEPS_BEFORE_ACTION) {
    problems.push(`${list.length} information steps and no action step (at most ${MAX_STEPS_BEFORE_ACTION}); the rest are dropped`);
    out = list.slice(0, MAX_STEPS_BEFORE_ACTION);
  } else if (firstAction > MAX_STEPS_BEFORE_ACTION) {
    problems.push(`${firstAction} steps before the first action (at most ${MAX_STEPS_BEFORE_ACTION}); the extra ones are dropped`);
    out = [...list.slice(0, MAX_STEPS_BEFORE_ACTION), ...list.slice(firstAction)];
  }
  return { ok: problems.length === 0, problems, steps: out.map(({ _i, ...s }) => s) };
}

/** isSeen(state, id) -> true once the guide has run to its end. */
export function isSeen(state, id) {
  const ob = state && state.onboarding;
  return !!(ob && ob.seen && ob.seen[id]);
}

/** markGuideSeen(state, {id}) -> {ok}. Pure; run through ctx.game.act. */
export function markGuideSeen(state, { id } = {}) {
  if (!state || !id) return { ok: false };
  if (!state.onboarding || typeof state.onboarding !== 'object') state.onboarding = { step: 0, done: false, flags: {} };
  if (!state.onboarding.seen || typeof state.onboarding.seen !== 'object') state.onboarding.seen = {};
  state.onboarding.seen[String(id)] = true;
  return { ok: true, id: String(id) };
}

/** noteCoachDismissed(state) -> {ok}. Local-only counter: she left a coach step without acting. */
export function noteCoachDismissed(state) {
  if (!state) return { ok: false };
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  state.stats.coachDismissed = (Number(state.stats.coachDismissed) || 0) + 1;
  return { ok: true, count: state.stats.coachDismissed };
}

// ---------------------------------------------------------------------------
// Pure: placement
// ---------------------------------------------------------------------------

/** rectsIntersect(a, b) -> overlap area in px² (0 when they only touch). */
export function rectsIntersect(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const hgt = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && hgt > 0 ? w * hgt : 0;
}

/**
 * placeBubble(anchor, {width, height}, {width, height} viewport, {side, avoid, gap=12, margin=8})
 * -> {left, top, side: 'above'|'below', arrowX, rect, covers, blocksNext}.
 * Tries the preferred side, then the other; picks the first where the bubble
 * fits on screen and overlaps neither the anchor nor any `avoid` rect (the
 * next target). Failing that, the placement that covers the least of the
 * anchor (then of the next target).
 */
export function placeBubble(anchor, size, viewport, { side = '', avoid = [], gap = 12, margin = 8 } = {}) {
  const w = Math.max(1, size.width);
  const hgt = Math.max(1, size.height);
  const vw = viewport.width;
  const vh = viewport.height;
  const cx = (anchor.left + anchor.right) / 2;
  const left = Math.max(margin + 4, Math.min(vw - margin - 4 - w, cx - w / 2));
  const order = side === 'above' ? ['above', 'below'] : side === 'below' ? ['below', 'above']
    : (vh - anchor.bottom >= anchor.top ? ['below', 'above'] : ['above', 'below']);
  const options = order.map((sd) => {
    const rawTop = sd === 'below' ? anchor.bottom + gap : anchor.top - gap - hgt;
    const top = Math.max(margin, Math.min(vh - margin - hgt, rawTop));
    const rect = { left, top, right: left + w, bottom: top + hgt };
    const covers = rectsIntersect(rect, anchor);
    const blocks = (avoid || []).filter(Boolean).reduce((n, r) => n + rectsIntersect(rect, r), 0);
    return { side: sd, left, top, rect, covers, blocks, fits: rawTop === top };
  });
  const clean = options.find((o) => o.fits && !o.covers && !o.blocks)
    || options.find((o) => !o.covers && !o.blocks)
    || options.slice().sort((a, b) => (a.covers - b.covers) || (a.blocks - b.blocks))[0];
  return {
    left: clean.left,
    top: clean.top,
    side: clean.side,
    arrowX: Math.max(16, Math.min(w - 16, cx - clean.left)),
    rect: clean.rect,
    covers: clean.covers > 0,
    blocksNext: clean.blocks > 0,
  };
}

// ---------------------------------------------------------------------------
// DOM helpers (shared with onboarding.js)
// ---------------------------------------------------------------------------

/** The part of el's box its scroll container (.screen-body) shows; null when mostly hidden. */
export function clippedRect(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  const box = el.closest && el.closest('.screen-body');
  if (!box) return r;
  const c = box.getBoundingClientRect();
  const top = Math.max(r.top, c.top);
  const bottom = Math.min(r.bottom, c.bottom);
  const left = Math.max(r.left, c.left);
  const right = Math.min(r.right, c.right);
  if (bottom - top < Math.min(24, r.height * 0.6) || right - left <= 0) return null;
  return { top, bottom, left, right, width: right - left, height: bottom - top };
}

/**
 * visibleTarget(selector, {scope, tabbar, filter}) -> the first matching
 * element that is on screen: inside `scope` (default the top screen) or the
 * tab bar, not in a hidden or covered screen, and passing `filter(el)`.
 */
export function visibleTarget(sel, { scope = null, tabbar = null, filter = null } = {}) {
  if (!hasDom() || !sel) return null;
  const top = scope || document.querySelector('#app > .screen.is-top:not([hidden])');
  const bar = tabbar || document.getElementById('tabbar');
  let list;
  try { list = document.querySelectorAll(sel); } catch (e) { return null; }
  for (const el of list) {
    const inTop = top && top.contains(el);
    const inBar = bar && !bar.hidden && bar.contains(el);
    if (!inTop && !inBar) continue;
    if (el.closest('[hidden]')) continue;
    if (filter && !filter(el)) continue;
    const r = clippedRect(el);
    if (r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) return el;
  }
  return null;
}

/** coachLayer(id='guide-layer') -> the fixed layer bubbles are drawn in. */
export function coachLayer(id = 'guide-layer') {
  if (!hasDom()) return null;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'coach-layer';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * coachHtml({text, actions:[{label, value, variant, attrs}], card, kicker, portrait, ring=true})
 * -> markup for one bubble (+ the ring around its anchor). Buttons carry
 * data-coach-action="value" plus any `attrs` (onboarding's data-step). `card`
 * draws the centered card variant (no arrow, no ring).
 */
export function coachHtml({ text = '', actions = [], card = false, kicker = '', portrait = '', ring = true } = {}) {
  const btns = (actions || []).map((a) => button(a.label, {
    small: true, variant: a.variant || (card ? 'primary' : 'paper'), attrs: { ...(a.attrs || {}), 'data-coach-action': a.value || 'ok' },
  }));
  const body = portrait
    ? h`<div class="coach-head"><span class="coach-portrait">${raw(String(portrait))}</span><div class="coach-text">${text}</div></div>`
    : h`<div class="coach-text">${text}</div>`;
  return h`<div class="coach-tag${card ? ' card' : ''}" role="note" aria-live="polite">${kicker ? h`<div class="coach-kicker">${kicker}</div>` : ''}${body}<div class="coach-row">${btns}</div></div>${ring && !card ? raw('<div class="coach-ring"></div>') : ''}`;
}

/** Position a drawn bubble (and its ring) beside `anchorEl`, clear of `avoidEls`. Returns placeBubble's result. */
export function positionBubble(layerEl, anchorEl, { side = '', avoidEls = [] } = {}) {
  const tag = layerEl && layerEl.querySelector('.coach-tag');
  if (!tag || !anchorEl) return null;
  const r = clippedRect(anchorEl) || anchorEl.getBoundingClientRect();
  const ring = layerEl.querySelector('.coach-ring');
  if (ring) {
    ring.style.left = `${Math.round(r.left - 4)}px`;
    ring.style.top = `${Math.round(r.top - 4)}px`;
    ring.style.width = `${Math.round(r.width + 8)}px`;
    ring.style.height = `${Math.round(r.height + 8)}px`;
  }
  const avoid = avoidEls.filter(Boolean).map((el) => el.getBoundingClientRect());
  const p = placeBubble(r, { width: tag.offsetWidth || 296, height: tag.offsetHeight || 90 },
    { width: innerWidth, height: innerHeight }, { side, avoid });
  tag.classList.toggle('below', p.side === 'below');
  tag.classList.toggle('above', p.side === 'above');
  tag.style.left = `${Math.round(p.left)}px`;
  tag.style.top = `${Math.round(p.top)}px`;
  tag.style.setProperty('--arrow-x', `${Math.round(p.arrowX)}px`);
  return p;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const registry = new Map(); // id -> instance
let showing = null;         // the instance whose bubble is on screen

/** True while any guide bubble is on screen (app.js holds toasts then). */
export function isGuideUp() {
  return !!showing;
}

/** replay(id): run guide `id` again from its first step (the "How this works" link). */
export function replay(id) {
  const g = registry.get(id);
  if (g) g.replay();
  return !!g;
}

function sheetOrDialogUp() {
  if (overlay.isOpen && overlay.isOpen()) return true;
  const top = document.querySelector('#app > .screen.is-top:not([hidden])');
  if (!top) return false;
  return [...top.querySelectorAll('[role="dialog"]')].some((el) => el.getClientRects().length > 0 && !el.closest('[hidden]'));
}

function otherCoachUp() {
  return !!document.querySelector('#coach-layer .coach-tag');
}

/**
 * guide(id, steps, ctx, {screen, onDone}) -> {start(), stop(), replay(), active, step}.
 * See the module comment for the step fields and the rules it enforces.
 */
export function guide(id, steps, ctx, opts = {}) {
  const { steps: list, problems } = validateSteps(steps);
  if (problems.length && isDev()) console.warn(`[guide ${id}] ${problems.join('; ')}`);
  let running = false;
  let replaying = false;
  let idx = 0;
  let shownKey = '';
  let shownAt = 0;
  let poll = 0;
  let unsubs = [];
  let layer = null;

  const state = () => ctx && ctx.game && ctx.game.state;
  const current = () => list[idx] || null;

  function hide() {
    if (layer && shownKey) layer.innerHTML = '';
    shownKey = '';
    if (showing === inst) showing = null;
  }

  function onScreen() {
    if (!opts.screen) return true;
    const top = ctx && typeof ctx.current === 'function' ? ctx.current() : null;
    return !!(top && top.id === opts.screen);
  }

  function advance() {
    if (!running) return;
    hide();
    idx++;
    if (idx >= list.length) finish();
    else setTimeout(tick, 0);
  }

  function finish() {
    const wasReplay = replaying;
    teardown();
    idx = 0;
    replaying = false;
    if (!wasReplay || !isSeen(state(), id)) {
      try { ctx.game.act(markGuideSeen, { id }); } catch (e) { /* ignore */ }
    }
    if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) { console.error(e); } }
  }

  function tick() {
    if (!running || !hasDom()) return;
    const step = current();
    if (!step) { finish(); return; }
    const s = state();
    if (step.endsOn === 'action' && typeof step.done === 'function') {
      let done = false;
      try { done = !!step.done(s); } catch (e) { done = false; }
      if (done) { advance(); return; }
    }
    let waiting = false;
    if (typeof step.when === 'function') {
      try { waiting = !step.when(s); } catch (e) { waiting = true; }
    }
    const busy = (showing && showing !== inst) || otherCoachUp() || sheetOrDialogUp() || !onScreen();
    const anchor = waiting || busy ? null : visibleTarget(step.anchor);
    if (!anchor) { hide(); return; }
    layer = coachLayer();
    const key = `${idx}:${step.text}`;
    if (key !== shownKey) {
      const actions = step.endsOn === 'got-it' ? [{ label: 'Got it', value: 'ok' }] : [];
      layer.innerHTML = String(coachHtml({ text: step.text, actions, portrait: step.portrait, kicker: step.kicker }));
      shownKey = key;
      shownAt = Date.now();
      showing = inst;
      // A bubble never shares the screen with a toast: the visible ones step aside.
      try { overlay.suspendToasts(); } catch (e) { /* ignore */ }
    }
    const nextSel = step.next || (list[idx + 1] && list[idx + 1].anchor);
    const nextEl = nextSel ? visibleTarget(nextSel) : null;
    positionBubble(layer, anchor, { side: step.side, avoidEls: nextEl && nextEl !== anchor ? [nextEl] : [] });
  }

  function onLayerClick(e) {
    const b = e.target.closest && e.target.closest('[data-coach-action]');
    if (!b || showing !== inst) return;
    if (b.dataset.coachAction === 'ok') advance();
  }

  function onDocClick(e) {
    const step = current();
    if (!step || showing !== inst || step.endsOn !== 'action' || step.done || step.event) return;
    const hit = e.target && e.target.closest && e.target.closest(step.anchor);
    if (hit) setTimeout(advance, 0);
  }

  function reposition() {
    if (shownKey) tick();
  }

  function teardown() {
    running = false;
    clearInterval(poll);
    poll = 0;
    for (const u of unsubs) { try { u(); } catch (e) { /* ignore */ } }
    unsubs = [];
    hide();
  }

  function subscribe() {
    const g = ctx.game;
    if (g && typeof g.on === 'function') {
      unsubs.push(g.on('change', () => tick()));
      const names = new Set();
      for (const s of list) for (const n of [].concat(s.event || [])) names.add(n);
      for (const n of names) {
        unsubs.push(g.on(n, () => {
          const step = current();
          if (step && [].concat(step.event || []).includes(n)) advance();
        }));
      }
    }
    if (overlay.onOverlayChange) unsubs.push(overlay.onOverlayChange(() => setTimeout(tick, 0)));
    if (hasDom()) {
      layer = coachLayer();
      layer.addEventListener('click', onLayerClick);
      unsubs.push(() => layer.removeEventListener('click', onLayerClick));
      document.addEventListener('click', onDocClick, true);
      unsubs.push(() => document.removeEventListener('click', onDocClick, true));
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
      unsubs.push(() => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); });
      poll = setInterval(tick, POLL_MS);
    }
  }

  function start() {
    if (running || !list.length) return running;
    if (!replaying && isSeen(state(), id)) return false;
    running = true;
    subscribe();
    tick();
    return true;
  }

  function stop() {
    if (!running) return;
    const step = current();
    // She left an action step's bubble without acting: a local-only counter.
    if (shownKey && step && step.endsOn === 'action' && Date.now() - shownAt > 400) {
      try { ctx.game.act(noteCoachDismissed, {}); } catch (e) { /* ignore */ }
    }
    teardown();
  }

  function replayFn() {
    teardown();
    idx = 0;
    replaying = true;
    start();
  }

  const inst = {
    id,
    steps: list,
    problems,
    start,
    stop,
    replay: replayFn,
    get active() { return running; },
    get shown() { return showing === inst; },
    get step() { return running ? idx : -1; },
  };
  const prev = registry.get(id);
  if (prev && prev !== inst) prev.stop();
  registry.set(id, inst);
  return inst;
}

// ---------------------------------------------------------------------------
// What's next + How this works
// ---------------------------------------------------------------------------

/**
 * whatsNext(ctx, {more, next, title, body}) -> Promise<'more'|'next'|null>.
 * The two-choice card after a first success or on leaving a subgame: two
 * equal buttons ("One more" / "Next: the catalog"). `more` and `next` are a
 * label or {label, run}; `run` is called only when she picks it. It never
 * navigates by itself; dismissing it does nothing.
 */
export function whatsNext(ctx, { more = 'One more', next = null, title = 'Nicely done', body = '' } = {}) {
  const m = typeof more === 'string' ? { label: more } : (more || { label: 'One more' });
  const n = typeof next === 'string' ? { label: next } : next;
  const actions = [{ label: m.label, variant: 'paper', value: 'more' }];
  if (n && n.label) actions.push({ label: n.label, variant: 'paper', value: 'next' });
  const open = (ctx && ctx.sheet) || overlay.sheet;
  return Promise.resolve(open({ title, body: body ? String(h`${body}`) : '', actions, cls: 'whats-next' })).then((v) => {
    const pick = v === 'more' ? m : v === 'next' ? n : null;
    if (pick && typeof pick.run === 'function') { try { pick.run(); } catch (e) { console.error(e); } }
    return v === 'more' || v === 'next' ? v : null;
  });
}

/** howThisWorksHtml(id, label) -> markup for a subgame header's replay link. */
export function howThisWorksHtml(id, label = 'How this works') {
  return h`<button type="button" class="how-link" data-tap data-guide-replay="${id}">${label}</button>`;
}

/** howThisWorks(id, label) -> a <button> that replays guide `id` when tapped. */
export function howThisWorks(id, label = 'How this works') {
  if (!hasDom()) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'how-link';
  b.dataset.tap = '';
  b.dataset.guideReplay = id;
  b.textContent = label;
  return b;
}

if (hasDom()) {
  // One delegated listener serves every "How this works" link, element or markup.
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-guide-replay]');
    if (b) replay(b.dataset.guideReplay);
  });
}

export default { guide, whatsNext, howThisWorks, howThisWorksHtml, replay, isGuideUp };
