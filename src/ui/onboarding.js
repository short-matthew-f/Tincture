/**
 * onboarding.js: screen `onboarding` (the welcome card) and the
 * first-ten-minutes script, drawn with guide.js's guide() (one guide,
 * id GUIDE_ID 'first-ten'). Implements DESIGN.md "Fun and engagement > First
 * ten minutes" and the table in docs/UX-GUIDELINES-REVIEW.md §C:
 *
 *   step 0  welcome card ("You inherit a dusty dye workshop…")         0:00
 *   step 1  her first orange for a neighbor (a seeded madder + ochre order,
 *           tutorial pay); naming is the app's ceremony, the script waits
 *           for orange to be in the catalog; then Mixer 1 starts
 *           making it (one toast)                              bubble 1
 *   step 2  a Relaxed board in her own colors reveals one tint  1:30  bubble 2
 *           (on the Puzzles tab, then on the New board button; the board is
 *           marked data-mode="own" and the grading tier set to Relaxed)
 *   step 3  first upgrades: the Next button, only once what it
 *           offers is affordable (data-cost <= coins)          3:00  bubble 3
 *   step 4  the third mixer: when sim.next is 'mixer', one bubble on Next;
 *           ends on the 'mixer' event                           4:30  bubble 4
 *   step 5  the order board fills and, from 6 colors, the closed shelf
 *           collects vials (no bubble: the shelf's tag says
 *           "N vials waiting"); lasts DOORS_AFTER_MS            6:00
 *   step 6  one quiet "Got it" bubble on "Still to open" (Rooms & staff: the
 *           Mill Room goal, the window and door tags)           8:00  bubble 5
 *   step 7  Close up shop appears at the foot of the Workshop
 *           (workshop.js shows it from step 7); closing up, or a
 *           break of a minute or more ('return'), ends the tour  9:00
 *
 * At most 5 bubbles, at most 2 before her first action (step 1 is an action),
 * every bubble at most 15 words, every action step ending on its action. The
 * persisted step (state.onboarding.step) is the single source of truth: the
 * pure advanceScript() moves it from state (orange discovered, board solved,
 * Next tapped, a third mixer, time, Got it, close up), and each guide step
 * ends once the step has moved past it. Nothing blocks play: bubbles let taps
 * through, and an action bubble she leaves alone for STALL_MS gives way.
 *
 * The Merge Shelf is session two's landmark: the script no longer seeds a
 * chain. seedFirstChain stays exported for the shelf screen's own guide.
 *
 * Debug: window.tincture.debug.coachCount (distinct coach bubbles drawn while
 * the tour runs, any guide) and .coachTexts.
 *
 * While the tour runs, the subgame guides it walks her through (TOUR_DEFERS:
 * orders, matching, grading) are marked seen and handed back when it ends
 * (deferGuides / restoreDeferredGuides), so session one keeps to 5 bubbles.
 *
 * Pure helpers (fn(state, args, now), used through game.act and in tests):
 * setOnboarding, advanceScript, deferGuides, restoreDeferredGuides,
 * seedFirstOrder, seedFirstChain.
 */

import { h, raw, button } from './kit.js';
import { injectStyle } from './overlay.js';
import * as sim from '../sim/index.js';
import { getColor } from '../content/catalog.js';
import { guide, coachLayer } from './guide.js';

export const FIRST_ORDER_ID = 'o-first-orange';
export const GUIDE_ID = 'first-ten';
export const STEPS = Object.freeze({ welcome: 0, order: 1, board: 2, next: 3, mixer: 4, fills: 5, doors: 6, close: 7 });
/** The 6:00 beat (the board fills, the shelf collects) lasts this long before the 8:00 doors bubble. */
export const DOORS_AFTER_MS = 4 * 60e3;
/** An action bubble she leaves alone this long gives way to the next beat. */
export const STALL_MS = 8 * 60e3;

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function ob(state) {
  if (!state.onboarding || typeof state.onboarding !== 'object') state.onboarding = { step: 0, done: false, flags: {}, seen: {} };
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
  if (args.done && !o.done) {
    o.done = true;
    o.flags.doneAt = now;
    restoreDeferredGuides(state);
  }
  return { step: o.step, done: o.done, flags: { ...o.flags } };
}

/**
 * The subgame guides the tour itself walks her through (the order board, the
 * matching bench, the first grading board). While the tour runs they stay
 * quiet, so session one keeps to its 5 bubbles; when the tour ends they are
 * handed back (each screen then decides, e.g. an old hand skips its coach).
 */
export const TOUR_DEFERS = Object.freeze(['orders', 'matching', 'grading']);

/** deferGuides(state) -> {ids}: mark TOUR_DEFERS guides seen for the tour, remembering which. */
export function deferGuides(state) {
  const o = ob(state);
  if (!o.seen || typeof o.seen !== 'object') o.seen = {};
  const ids = TOUR_DEFERS.filter((id) => !o.seen[id]);
  for (const id of ids) o.seen[id] = true;
  o.flags.deferredGuides = [...new Set([...(o.flags.deferredGuides || []), ...ids])];
  return { ids };
}

/** restoreDeferredGuides(state) -> {ids}: hand the deferred guides back (tour over). */
export function restoreDeferredGuides(state) {
  const o = ob(state);
  const ids = Array.isArray(o.flags.deferredGuides) ? o.flags.deferredGuides : [];
  if (o.seen && typeof o.seen === 'object') for (const id of ids) delete o.seen[id];
  o.flags.deferredGuides = [];
  return { ids };
}

/** Has the script's step `step` been completed by what is in the state? */
function stepComplete(state, step, now) {
  const o = ob(state);
  const f = o.flags;
  const since = Number.isFinite(f.stepAt) ? now - f.stepAt : 0;
  const stalled = since >= STALL_MS;
  const mixers = ((state.stations && state.stations.mixers) || []).length;
  switch (step) {
    case STEPS.order: return !!(state.catalog && state.catalog.discovered && state.catalog.discovered.orange);
    case STEPS.board: return !!(f.boardSolved || f.firstTint) || stalled;
    case STEPS.next: return !!f.nextTapped || mixers >= 3 || stalled;
    case STEPS.mixer: return mixers >= 3 || stalled;
    case STEPS.fills: return since >= DOORS_AFTER_MS;
    case STEPS.doors: return !!f.doorsSeen;
    case STEPS.close: return num(state.stats && state.stats.lastCloseUpAt) > 0;
    default: return false;
  }
}

/**
 * Her named orange goes straight onto Mixer 1 (when it is idle), so the
 * workshop earns from the first minute and the first board pays from a real
 * income rate (economy.puzzleReward), as the balance walk assumes. Records
 * flags.firstRecipe for the UI's one-line note.
 */
function startFirstRecipe(state) {
  const m = state.stations && state.stations.mixers && state.stations.mixers[0];
  if (!m || m.recipe) return;
  const res = sim.factory.assignRecipe(state, { mixer: 0, colorId: 'orange' });
  if (res && res.ok) ob(state).flags.firstRecipe = 'orange';
}

/**
 * advanceScript(state, args, now) -> {step, done, changed}. Moves the persisted
 * step forward while the current one is complete (several at once when she ran
 * ahead); closing up at step 7 ends the tour. Never moves backwards, never
 * starts the tour (step 0 is the welcome card's).
 */
export function advanceScript(state, args = {}, now = 0) {
  const o = ob(state);
  if (o.done || !(o.step >= STEPS.order)) return { step: o.step, done: !!o.done, changed: false };
  let changed = false;
  if (!Number.isInteger(o.step)) { setOnboarding(state, { step: Math.floor(o.step) }, now); changed = true; } // 0.1's 5.5 / 6.5
  for (let guard = 0; guard < 8 && !o.done && stepComplete(state, o.step, now); guard++) {
    if (o.step === STEPS.order) startFirstRecipe(state);
    if (o.step >= STEPS.close) setOnboarding(state, { done: true }, now);
    else setOnboarding(state, { step: o.step + 1 }, now);
    changed = true;
  }
  return { step: o.step, done: !!o.done, changed };
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
 * Not used by the first-ten script any more (the shelf is session two); kept
 * for the shelf screen's own guide.
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
  for (let r = s.rows - 1; r >= 0 && row < 0; r--) { // nearest the thumb first
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

// ---------------------------------------------------------------------------
// Script (guide steps)
// ---------------------------------------------------------------------------
//
// One voice for the whole first session: warm, specific, second person,
// present tense. At most 15 words a bubble (guide.js warns in dev).

/** Next button kinds that are a real step forward (not Collect or Almost there). */
const NEXT_KINDS = new Set(['assign', 'upgrade', 'mixer', 'room', 'unlock', 'rebuy']);
const CEREMONIES = new Set(['naming', 'phase-beat', 'onboarding', '']);

let root = null;
let ctx = null;
let script = null;      // the running guide instance
const pendingKeys = new Set();
const coachTexts = new Set();
let watchedLayer = null;

function state() { return ctx.game.state; }
function stepNow() { return ob(state()).step; }
function isDone() { return !!ob(state()).done; }
function topId() { const t = ctx && typeof ctx.current === 'function' ? ctx.current() : null; return t ? t.id : ''; }

function nextPick(s) {
  try { return sim.next(s, ctx.game.now()); } catch (e) { return null; }
}

/** The Next button offers a real step she can take now: its price (data-cost) is within her coins. */
function nextReady(s) {
  const n = nextPick(s);
  if (!n || !NEXT_KINDS.has(n.kind)) return false;
  const cost = num(n.cost);
  return !(cost > 0) || cost <= num(s.coins);
}

const past = (n) => (s) => ob(s).done || ob(s).step > n;

/** The guide steps, one per bubble, keyed by script step. */
function scriptSteps() {
  return [
    { n: STEPS.order, anchor: '[data-coach="first-order"]', side: 'below',
      text: 'A neighbor would love orange. Tap here, then mix madder with ochre.',
      endsOn: 'action', done: past(STEPS.order) },
    { n: STEPS.board,
      anchor: '#app [data-coach="grading"] [data-action="new-grading"]:not([data-mode]), #tabbar [data-tab="puzzles"]',
      text: 'A calm puzzle in your own colors. Solving one often reveals a new tint.',
      endsOn: 'action', done: past(STEPS.board), when: (s) => ob(s).step >= STEPS.board && topId() !== 'grading' },
    { n: STEPS.next, anchor: '[data-coach="next"], #tabbar [data-tab="workshop"]',
      text: 'Your coins are ready. In the Workshop, Next picks what helps most.',
      endsOn: 'action', done: past(STEPS.next), when: (s) => ob(s).step >= STEPS.next && nextReady(s) },
    { n: STEPS.mixer, anchor: '[data-coach="next"]',
      text: 'A third mixer: three colors mixing at once.',
      endsOn: 'action', event: 'mixer', done: past(STEPS.mixer),
      when: (s) => ob(s).step >= STEPS.mixer && (nextPick(s) || {}).kind === 'mixer' },
    { n: STEPS.doors, anchor: '[data-coach="doors"], [data-segment="rooms"][aria-pressed="false"]',
      text: 'Rooms & staff: the Mill Room and all still to open, with prices.',
      endsOn: 'got-it', when: (s) => ob(s).step >= STEPS.doors && !ob(s).flags.doorsSeen && topId() === 'workshop' },
  ];
}

/** Start (or restart) the guide from the persisted step. */
function startScript() {
  if (script) { try { script.stop(); } catch (e) { /* ignore */ } script = null; }
  if (!ctx || typeof document === 'undefined') return;
  const o = ob(state());
  if (o.done || !(o.step >= STEPS.order) || o.step >= STEPS.close) return;
  const steps = scriptSteps().filter((st) => st.n >= Math.floor(o.step));
  if (!steps.length) return;
  script = guide(GUIDE_ID, steps, ctx, { onDone: onScriptDone });
  if (!script.start()) script = null;
}

function stopScript() {
  if (script) { try { script.stop(); } catch (e) { /* ignore */ } }
  script = null;
}

/** The last bubble ("Still to open") is read: Close up shop appears (workshop.js, from step 7). */
function onScriptDone() {
  script = null;
  later(() => {
    const o = ob(state());
    if (o.done) return;
    ctx.game.act(setOnboarding, { flags: { doorsSeen: true } });
    ctx.game.act(advanceScript, {});
    if (ob(state()).step >= STEPS.close && !ob(state()).flags.closeToast) {
      ctx.game.act(setOnboarding, { flags: { closeToast: true } });
      ctx.toast('Close up shop waits at the foot of the Workshop, whenever you want to stop.');
    }
  }, 'script-done');
}

function finishAll() {
  stopScript();
  ctx.game.act(setOnboarding, { done: true });
}

function relaxedTier() {
  const st = state().settings || {};
  if (st.puzzleTier && st.puzzleTier.grading === 'relaxed') return;
  try { ctx.game.act(sim.setPuzzleTier, { puzzle: 'grading', tier: 'relaxed' }); } catch (e) { /* ignore */ }
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

/**
 * Capture-phase taps: during the board beat whichever "new board" button she
 * taps makes a plain Relaxed rectangle in her own colors (puzzles.js reads
 * data-mode="own" and the remembered tier in its own handler, after this one);
 * a tap on Next ends the Next beat.
 */
function onCaptureClick(e) {
  if (!ctx || isDone() || !e.target || !e.target.closest) return;
  const step = stepNow();
  if (step === STEPS.board) {
    const t = e.target.closest('[data-screen="puzzles"] [data-action="new-grading"]');
    if (t) { t.dataset.mode = 'own'; relaxedTier(); }
  }
  if (step >= STEPS.order && step <= STEPS.next && !ob(state()).flags.nextTapped
    && e.target.closest('[data-screen="workshop"] [data-action="next"]')) {
    later(() => ctx.game.act(setOnboarding, { flags: { nextTapped: true } }), 'next-tapped');
  }
}

function onEvent(type, payload) {
  if (!ctx || isDone()) return;
  const step = stepNow();
  const p = payload || {};
  if (step <= STEPS.order && type === 'orderFilled' && p.orderId === FIRST_ORDER_ID) {
    later(() => {
      const d = state().catalog.discovered;
      if (!d.orange) ctx.game.act(sim.discover, { colorId: 'orange', method: 'order' });
    }, 'first-orange');
  }
  if (type === 'namingDone' && p.colorId === 'orange') later(() => ctx.game.act(setOnboarding, { flags: { named: true } }), 'named');
  if (step <= STEPS.board && (type === 'boardSolved' || (type === 'discover' && /grad/.test(String(p.method || ''))))) {
    later(() => ctx.game.act(setOnboarding, { flags: { boardSolved: true } }), 'board-solved');
  }
}

/**
 * observe(state, top): called by the app every render frame. Moves the
 * persisted step (the guide follows it: each bubble ends once the step has
 * moved past it). The guide itself is started once, at mount, when the tour
 * starts and after an import.
 */
function observe(s) {
  if (!ctx) return;
  const o = ob(s);
  if (o.done) { if (script) stopScript(); return; }
  if (!(o.step >= STEPS.order)) return;
  if (o.step === STEPS.board) relaxedTierOnce();
  if (o.flags.firstRecipe && !o.flags.firstRecipeNoted && !CEREMONIES.has(topId())) {
    later(() => {
      if (ob(state()).flags.firstRecipeNoted) return;
      ctx.game.act(setOnboarding, { flags: { firstRecipeNoted: true } });
      let name = 'your orange';
      try { name = sim.displayName(state(), 'orange') || name; } catch (e) { /* ignore */ }
      ctx.toast(`Mixer 1 is making ${name} now.`, { hex: (getColor('orange') || {}).hex });
    }, 'first-recipe');
  }
  let moves = false;
  try { moves = !Number.isInteger(o.step) || stepComplete(s, o.step, ctx.game.now()); } catch (e) { moves = false; }
  if (!moves) return;
  later(() => {
    const res = ctx.game.act(advanceScript, {});
    if (res && res.done) stopScript();
  }, 'advance');
}

let tierSet = false;
function relaxedTierOnce() {
  if (tierSet) return;
  tierSet = true;
  later(relaxedTier, 'relaxed');
}

// ---------------------------------------------------------------------------
// Bubble count (debug): every distinct bubble drawn while the tour runs
// ---------------------------------------------------------------------------

function watchBubbles() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const layer = coachLayer();
  if (!layer || layer === watchedLayer) return;
  watchedLayer = layer;
  new MutationObserver(() => {
    if (!ctx || isDone()) return;
    for (const tag of layer.querySelectorAll('.coach-tag')) {
      const t = (tag.querySelector('.coach-text') || tag).textContent.trim();
      if (t) coachTexts.add(t);
    }
  }).observe(layer, { childList: true, subtree: true });
}

function attachDebug(tries = 0) {
  if (typeof window === 'undefined') return;
  const d = window.tincture && window.tincture.debug;
  if (!d) { if (tries < 100) setTimeout(() => attachDebug(tries + 1), 50); return; }
  if (Object.prototype.hasOwnProperty.call(d, 'coachCount')) return;
  Object.defineProperty(d, 'coachCount', { get: () => coachTexts.size, enumerable: true });
  Object.defineProperty(d, 'coachTexts', { get: () => [...coachTexts], enumerable: true });
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------

injectStyle('onboarding-style', `
.screen[data-screen="onboarding"] { align-items: center; justify-content: center; padding: calc(16px + var(--safe-top)) 16px calc(16px + var(--safe-bottom)); background: var(--plaster); overflow-y: auto; }
.welcome-card { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 14px; text-align: center; }
.welcome-card .welcome-title { font-family: var(--font-display); font-size: 34px; line-height: 1.1; }
.welcome-card .welcome-lines { color: var(--ink-soft); font-size: 16px; line-height: 1.45; }
.welcome-card svg { width: 100%; height: auto; border-radius: 16px; box-shadow: 0 3px 0 var(--shadow); }
.welcome-skip { align-self: center; font-size: 13px; color: var(--ink-soft); text-decoration: underline; min-height: 44px; padding: 0 12px; }
`);

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
<path d="M0 142 H320" stroke="rgba(42,38,34,.25)" stroke-width="3"/>
</svg>`;
}

function drawWelcome() {
  if (!root) return;
  root.innerHTML = String(h`<div class="welcome-card">
    ${raw(welcomeArt())}
    <div class="welcome-title">Tincture</div>
    <div class="welcome-lines">You inherit a dusty dye workshop at the edge of Harbor Town. Three pigments wait on the bench, two mixers stand ready, and the town is hungry for color.</div>
    ${button('Open the shutters', { variant: 'primary', block: true, attrs: { 'data-action': 'welcome-start' } })}
    <button type="button" class="welcome-skip" data-tap data-action="welcome-skip">I have played before: skip the tour</button>
  </div>`);
}

function startTour() {
  ctx.game.act(deferGuides, {});
  ctx.game.act(seedFirstOrder, {});
  ctx.game.act(setOnboarding, { step: STEPS.order });
  try { ctx.audio.chord([0.5, 0.65, 0.8], 0.5); } catch (e) { /* ignore */ }
  ctx.navigate('orders');
  startScript();
}

const screen = {
  id: 'onboarding',
  fullscreen: true,
  enter: 'fade', // opaque from the first paint: the workshop never shows through

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
    document.addEventListener('click', onCaptureClick, true);
    for (const type of ['orderFilled', 'discover', 'namingDone', 'boardSolved']) ctx.game.on(type, (p) => onEvent(type, p));
    // Back from a break once Close up shop is showing: the tour is over, so the Morning
    // Ledger can open (app.js listens after this, and opens it only when done).
    ctx.game.on('return', () => {
      const o = ob(state());
      if (!o.done && o.step >= STEPS.close) finishAll();
    });
    // Old or imported saves that are clearly past the first session skip the tour.
    const s = state();
    const o = ob(s);
    if (!o.done && ((s.phase || 1) >= 2 || sim.discoveredCount(s) >= 10)) ctx.game.act(setOnboarding, { done: true });
    ctx.game.on('reset', () => { stopScript(); coachTexts.clear(); });
    ctx.game.on('import', () => { stopScript(); later(startScript, 'start'); });
    watchBubbles();
    attachDebug();
    later(startScript, 'start');
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
