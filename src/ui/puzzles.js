/**
 * puzzles.js: the Puzzle table (tab screen `puzzles`) plus the helpers the three
 * puzzle overlays (grading.js, purify.js, packing.js) share.
 *
 * Owns: the tier picker (Relaxed / Steady / Tricky / Master, remembered per
 * board type through sim.settings.setPuzzleTier) with its reward preview, "New
 * grading board" / "Continue board", the gentle "Try Tricky?" nudge after three
 * fast solves, the muddy-batch list (Purify, or sell as is at 0.8x), the event
 * board banner, and the packing note. Implements DESIGN.md "Active play"
 * (Grading tiers, Purifying, Packing, Reward scaling) and "UX > Screens".
 *
 * Persistence: live puzzles live in `state.activePuzzles`
 *   { grading: board|null,
 *     purify:  {batchId, color, puzzle, startedAt}|null,
 *     packing: {vehicle, routeId, picks, loadPicks, puzzle, lanterns}|null,
 *     pendingTints: [hex] }          // tints a solved board still owes the catalog
 * Every mutation goes through `ctx.game.act(sim-style fn)` so saves happen.
 *
 * Named exports below are shared with the overlays; the default export is the
 * screen object required by docs/UI-CONTRACT.md.
 */

import { h, raw, button, swatch, iconSvg, safeHex, lockTag } from './kit.js';
import { stateRng } from '../rng.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import { deltaEHex } from '../color.js';

// ---------------------------------------------------------------------------
// Shared constants and small helpers
// ---------------------------------------------------------------------------

export const TIER_IDS = ['relaxed', 'steady', 'tricky', 'master'];
export const TIER_LABEL = { relaxed: 'Relaxed', steady: 'Steady', tricky: 'Tricky', master: 'Master' };
const GRID = { relaxed: '4 × 5 tiles', steady: '6 × 8 tiles', tricky: '8 × 10 tiles', master: '9 × 12 tiles' };
/** One plain line under the selected tier. */
const TIER_HINT = {
  relaxed: 'Calm and roomy: a gentle gradient to settle.',
  steady: 'A bigger board with a little more to think about.',
  tricky: 'Close shades side by side, for sharp eyes.',
  master: 'The full gradient, with a bonus roll on top.',
};
/** Event twists that change grading boards (palette and/or frame). */
const BOARD_RULES = ['boardShape', 'glowTiles', 'sunsetBoards', 'monochromeMaster'];
const SHAPE_FRAME = { leaf: 'Leaf', snowflake: 'Snowflake', fish: 'Fish', window: 'Window' };

/** Hue family -> a representative hex for palette chips on crates. */
export const FAMILY_HEX = {
  red: '#B8433A', orange: '#DE7A2E', yellow: '#D39B2A', green: '#6E9A5A', teal: '#2F8A8A',
  blue: '#3E6A9E', violet: '#6E4A7E', pink: '#D98A8F', neutral: '#8A8580',
};
export const FAMILY_ORDER = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'];
export const familyName = (f) => (f ? f[0].toUpperCase() + f.slice(1) : '');

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

/** state.activePuzzles, created on demand (call only from inside act). */
export function ensureActive(s) {
  if (!s.activePuzzles || typeof s.activePuzzles !== 'object') s.activePuzzles = {};
  const a = s.activePuzzles;
  if (a.grading === undefined) a.grading = null;
  if (a.purify === undefined) a.purify = null;
  if (a.packing === undefined) a.packing = null;
  if (!Array.isArray(a.pendingTints)) a.pendingTints = [];
  return a;
}

/** Read-only view of activePuzzles (never creates anything). */
export function activeOf(state) {
  return (state && state.activePuzzles) || {};
}

/** Remembered grading tier (settings.puzzleTier.grading). */
export function rememberedTier(state) {
  const t = state && state.settings && state.settings.puzzleTier && state.settings.puzzleTier.grading;
  return TIER_IDS.includes(t) ? t : 'relaxed';
}

/** OKLab lightness of a hex (for notes). */
export function lightnessOf(ctx, hex) {
  try { return ctx.color.rgbToOklab(ctx.color.hexToRgb(hex)).L; } catch { return 0.6; }
}

/** The running event's board twist, or null when it does not touch boards. */
export function boardTwist(ctx, state) {
  let tw = null;
  try { tw = ctx.sim.events.eventTwist(state); } catch { tw = null; }
  if (!tw || !tw.rules || !BOARD_RULES.some((k) => tw.rules[k])) return null;
  return tw;
}

/** "Leaf frame" / "Neon Night frame": the themed frame name for an event board. */
export function frameName(ctx, eventId, shape) {
  if (shape && SHAPE_FRAME[shape]) return `${SHAPE_FRAME[shape]} frame`;
  let name = eventId;
  try {
    const ev = (ctx.content.EVENTS || []).find((e) => e.id === eventId);
    if (ev) name = ev.name;
  } catch { /* names are cosmetic */ }
  return `${name} frame`;
}

/**
 * Where the Loading Yard stands: {open, req, need}. The yard is a room (checkPhase gates Phase 3
 * on it); packing only ever starts from a loaded vehicle there.
 */
export function yardStatus(ctx, state) {
  const rooms = (state && state.rooms) || [];
  if (rooms.includes('loading-yard')) return { open: true, req: 0, need: 0 };
  let req = 30;
  try {
    const r = (ctx.content.ROOMS || []).find((x) => x.id === 'loading-yard');
    if (r && Number.isFinite(r.colorsRequired)) req = r.colorsRequired;
  } catch { /* the gate falls back to 30 colors */ }
  let have = 0;
  try { have = ctx.sim.discoveredCount(state); } catch { have = 0; }
  return { open: false, req, need: Math.max(1, req - have) };
}

/** "Shipping opens at 30 colors - 12 more": the paper tag for a yard that is not open yet. */
export function yardTag(y) {
  return lockTag(`Shipping opens at ${y.req} colors \u00b7 ${y.need} more`, { cls: 'pz-tag' });
}

/** Coins for display: whole numbers while small ("about 2 coins"), then the usual K/M short form. */
export function coinsText(ctx, n) {
  const v = Number.isFinite(n) ? n : 0;
  const x = v < 100 ? Math.max(v > 0 ? 1 : 0, Math.round(v)) : v;
  return ctx.format && ctx.format.num ? ctx.format.num(x) : Math.round(x).toLocaleString();
}

/** Plain minutes, never seconds: "12 minutes", "2 hours 5 minutes". */
export function gentleDuration(ms) {
  const m = Math.max(1, Math.ceil((Number.isFinite(ms) ? ms : 0) / 60000));
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  const hrs = Math.floor(m / 60);
  const rest = m % 60;
  const hs = `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  return rest ? `${hs} ${rest} ${rest === 1 ? 'minute' : 'minutes'}` : hs;
}

export function eventName(ctx, eventId) {
  try {
    const ev = (ctx.content.EVENTS || []).find((e) => e.id === eventId);
    if (ev) return ev.name;
  } catch { /* ignore */ }
  return 'Event';
}

// ---------------------------------------------------------------------------
// Sim-style helpers (all run inside ctx.game.act)
// ---------------------------------------------------------------------------

/** Make a fresh grading board and store it as the active one. `own` skips the event palette. */
export function createGradingBoard(ctx, s, { tier, own = false } = {}, now = 0) {
  const t = TIER_IDS.includes(tier) ? tier : rememberedTier(s);
  const tw = own ? null : boardTwist(ctx, s);
  let palette = [];
  if (tw) {
    try { palette = ctx.sim.events.eventPalette(s) || []; } catch { palette = []; }
  }
  const themed = !!(tw && palette.length);
  if (!palette.length) palette = ctx.sim.discovery.discoveredColors(s).map((c) => c.hex);
  let shape = themed && tw.rules.boardShape ? tw.rules.boardShape : 'rect';
  if (!ctx.puzzles.grading.SHAPES.includes(shape)) shape = 'rect';
  const board = ctx.puzzles.grading.createBoard({ tier: t, palette, shape }, stateRng(s));
  board.event = themed ? tw.id : null;
  board.glow = !!(themed && tw.rules.glowTiles);
  board.startedAt = now;
  ensureActive(s).grading = board;
  return board;
}

/** Turn pendingTints into discoveries (the app shows the naming ceremony on 'discover'). */
export function flushTints(ctx, s, now = 0) {
  const a = ensureActive(s);
  const found = [];
  const list = a.pendingTints.slice();
  a.pendingTints = [];
  for (const hex of list) {
    const r = ctx.sim.discovery.tryDiscover(s, { hex, method: 'grade' }, now);
    if (r) found.push({ colorId: r.colorId, hex: r.hex, name: r.name });
  }
  // DESIGN.md "First ten minutes": her first Relaxed board always reveals a tint,
  // so the nearest tint the board points at is hers even when it sits past ΔE 4.
  const ob = s.onboarding && typeof s.onboarding === 'object' ? s.onboarding : null;
  const first = !!(ob && !ob.done && !(ob.flags && ob.flags.firstTint));
  if (!found.length && first && list.length) {
    const r = ctx.sim.discovery.tryDiscover(s, { hex: list[0], method: 'grade', maxDE: Infinity }, now);
    if (r) found.push({ colorId: r.colorId, hex: r.hex, name: r.name });
  }
  if (found.length && ob) ob.flags = { ...(ob.flags || {}), firstTint: true };
  return found;
}

/** Create the tube-sort puzzle for a muddy batch and store it. Returns the entry or null. */
export function createPurifyPuzzle(ctx, s, { batchId } = {}, now = 0) {
  const batch = (s.muddyBatches || []).find((b) => b.id === batchId);
  if (!batch) return null;
  const hex = ctx.sim.economy.colorHex(batch.color);
  const near = ctx.sim.discovery.discoveredColors(s)
    .map((c) => ({ hex: c.hex, de: deltaEHex(c.hex, hex) }))
    .sort((a, b) => a.de - b.de)
    .slice(0, 8)
    .map((c) => c.hex);
  const palette = [hex, ...near];
  const rate = num(ctx.sim.economy.incomeRate(s, now));
  const minutes = rate > 0 ? num(batch.value) / (rate * 60) : 0;
  const size = ctx.puzzles.purify.sizeForBatch(minutes);
  const rng = stateRng(s);
  let puzzle = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    puzzle = ctx.puzzles.purify.create(size, rng, { palette });
    if (puzzle.colors.some((c) => deltaEHex(c, hex) < 3)) break; // her batch's own color is in the tubes
  }
  const entry = { batchId, color: batch.color, puzzle, startedAt: now };
  ensureActive(s).purify = entry;
  return entry;
}

// ---------------------------------------------------------------------------
// Shared DOM helpers: styles, pattern defs, stamps
// ---------------------------------------------------------------------------

const styled = new Set();

/** Inject a <style> once per id into document.head. */
export function injectStyle(id, css) {
  if (typeof document === 'undefined' || styled.has(id)) return;
  styled.add(id);
  const el = document.createElement('style');
  el.id = `pz-style-${id}`;
  el.textContent = css;
  document.head.appendChild(el);
}

const PATTERN_DEFS = `
<pattern id="pzp-0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="6" fill="#2A2622" fill-opacity=".5"/></pattern>
<pattern id="pzp-1" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.5" fill="#2A2622" fill-opacity=".5"/></pattern>
<pattern id="pzp-2" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="2.2" height="6" fill="#2A2622" fill-opacity=".5"/></pattern>
<pattern id="pzp-3" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#2A2622" fill-opacity=".45"/><rect x="4" y="4" width="4" height="4" fill="#2A2622" fill-opacity=".45"/></pattern>
<pattern id="pzp-4" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="2.2" fill="#2A2622" fill-opacity=".5"/></pattern>
<pattern id="pzp-5" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0 L7 7 M7 0 L0 7" stroke="#2A2622" stroke-opacity=".5" stroke-width="1.3" fill="none"/></pattern>
<pattern id="pzp-6" width="8" height="6" patternUnits="userSpaceOnUse"><path d="M0 4 L2 1 L4 4 L6 1 L8 4" stroke="#2A2622" stroke-opacity=".55" stroke-width="1.3" fill="none"/></pattern>
<pattern id="pzp-7" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="2.2" height="6" fill="#2A2622" fill-opacity=".5"/></pattern>
<pattern id="pzp-8" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="2.6" fill="none" stroke="#2A2622" stroke-opacity=".5" stroke-width="1.3"/></pattern>`;

/** Put the shared colorblind pattern <defs> into the page once. */
export function ensureDefs() {
  if (typeof document === 'undefined' || document.getElementById('pz-defs')) return;
  const holder = document.createElement('div');
  holder.id = 'pz-defs';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  holder.innerHTML = `<svg width="0" height="0" focusable="false"><defs>${PATTERN_DEFS}</defs></svg>`;
  document.body.appendChild(holder);
}

/** url(#...) fill for pattern i (colorblind overlays on tube layers and jars). */
export const patternFill = (i) => `url(#pzp-${((Math.floor(i) % 9) + 9) % 9})`;

/** An effort stamp: ring, label and a small star. `tone` picks the ink. */
export function stampSvg(label, { sub = 'SOLVED', tone = '#7B5236', size = 92, double = false } = {}) {
  const t = safeHex(tone, '#7B5236');
  return raw(`<svg class="pz-stamp" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${String(label)} effort stamp">
<g transform="rotate(-12 60 60)" fill="none" stroke="${t}">
<circle cx="60" cy="60" r="54" stroke-width="4"/>
<circle cx="60" cy="60" r="46" stroke-width="1.6"${double ? '' : ' stroke-dasharray="2 4"'}/>
${double ? '<circle cx="60" cy="60" r="40" stroke-width="1.2"/>' : ''}
<text x="60" y="63" text-anchor="middle" fill="${t}" stroke="none" style="font-family:'Young Serif',Georgia,serif;font-size:21px;letter-spacing:.5px">${String(label).toUpperCase()}</text>
<text x="60" y="82" text-anchor="middle" fill="${t}" stroke="none" style="font-family:'Figtree',system-ui,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px">${sub}</text>
<path d="M60 26 l3 6 l6.5 .9 l-4.7 4.5 l1.1 6.4 l-5.9 -3.1 l-5.9 3.1 l1.1 -6.4 l-4.7 -4.5 l6.5 -.9 z" fill="${t}" stroke="none"/>
</g></svg>`);
}

export const STAMP_TONE = { steady: '#7B5236', tricky: '#8C6512', master: '#2A2622' };

export const PZ_CSS = `
.pz-body { gap: 12px; }
.pz-empty { text-align: center; padding: 28px 16px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.pz-empty .h2, .pz-hub .h3 { font-family: var(--font-ui); font-weight: 600; }
.pz-empty .btn { min-width: 220px; }
.pz-tag, .pz-hub .tag, .pz-empty .tag { white-space: normal; font-size: 12px; line-height: 1.25; padding-top: 5px; padding-bottom: 5px; }
.pz-name { font-family: var(--font-display); font-weight: 400; }
.pz-status { gap: 3px; }
.pz-status .hl { font-family: var(--font-ui); font-weight: 600; font-size: 17px; line-height: 1.25; }
.pz-status .dt { font-size: 14px; color: var(--ink-soft); }
.pz-actions { display: flex; gap: 10px; }
.pz-actions > .btn { flex: 1 1 auto; min-height: 48px; padding: 0 12px; white-space: nowrap; }
.pz-actions.stack { flex-direction: column; }
.pz-result { gap: 10px; animation: pz-rise 260ms var(--ease-out) both; }
.pz-result .hl { font-family: var(--font-ui); font-weight: 600; font-size: 19px; line-height: 1.2; }
.pz-result .tints { display: flex; flex-direction: column; gap: 8px; }
.pz-result .tints .row { gap: 10px; }
.pz-result .tints .nm { font-size: 17px; line-height: 1.2; }
.pz-result .lines { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.pz-result .lines li { display: flex; align-items: center; gap: 8px; }
.pz-result .lines b { font-weight: 700; }
.pz-result .chips { display: flex; flex-wrap: nowrap; flex: 0 0 auto; gap: 8px; }
.pz-stamp { display: block; filter: drop-shadow(0 1px 0 rgba(42,38,34,.25)); }
@keyframes pz-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes pz-stamp-in { 0% { opacity: 0; transform: scale(1.5) rotate(-6deg); } 60% { opacity: 1; transform: scale(.96); } 100% { opacity: .94; transform: none; } }
.pz-nudge { background: var(--paper); border-radius: var(--radius-sm); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--cut-sm); }
.pz-hub .pz-tiertag { display: flex; }
.pz-hub .pz-tiertag .tag { white-space: normal; }
.pz-hub .tierline { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--ink-soft); }
.pz-hub .seg-control > button { min-height: 44px; }
.pz-hub .btn.small, .pz-nudge .btn.small { min-height: 44px; }
.pz-hub .btn.quiet { box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 1.5px rgba(42,38,34,.2); }
.pz-hub .tierdesc { min-height: 18px; }
.pz-hub .reward { font-weight: 700; color: var(--ink); }
.pz-hub .banner { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--glow); box-shadow: 0 0 0 1.5px var(--glow-ring); font-size: 13px; }
.pz-hub .batch { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; }
.pz-hub .batch + .batch { border-top: 1px solid rgba(42,38,34,.1); }
.pz-hub .batch .btn { justify-content: center; }
`;

// ---------------------------------------------------------------------------
// The Puzzle table screen
// ---------------------------------------------------------------------------

let C = null;      // ctx
let ROOT = null;
let SIG = '';
let section = null;

function fmt(n) {
  return C.format && C.format.num ? C.format.num(n) : Math.round(n).toLocaleString();
}

function rewardOf(state, tier) {
  const tiers = C.sim.PUZZLE_TIERS || {};
  const def = tiers[tier] || { k: 8, mult: 1 };
  return C.sim.economy.puzzleReward(state, tier, { ...def });
}

function build(state) {
  const tier = rememberedTier(state);
  const tiers = C.sim.PUZZLE_TIERS || {};
  const def = tiers[tier] || { k: 8, mult: 1 };
  const reward = rewardOf(state, tier);
  const active = activeOf(state);
  const board = active.grading;
  const tw = boardTwist(C, state);
  const fast = num(state.stats && state.stats.fastSolves);
  const revealed = (t) => !C.sim.unlocks || C.sim.unlocks.tierRevealed(state, t);
  const nudge = fast >= 3 && (tier === 'relaxed' || tier === 'steady') && revealed('tricky');

  let boardInfo = '';
  if (board) {
    const wrong = C.puzzles.grading.wrongCount(board);
    boardInfo = h`<div class="hint">A ${TIER_LABEL[board.tier] || 'Relaxed'} board is waiting: ${wrong === 1 ? 'one more tile' : `${wrong} more tiles`} to settle.</div>`;
  }

  let banner = '';
  if (tw) {
    const shape = tw.rules.boardShape;
    banner = h`<div class="banner">${iconSvg('star', { size: 18 })}<div><b>${eventName(C, tw.id)}</b> boards use the event colors. ${frameName(C, tw.id, shape)}.</div></div>`;
  }

  // Only the revealed tiers show, one more with each milestone; a paper tag names the next one.
  const shown = TIER_IDS.filter((t) => t === tier || revealed(t));
  const lockedNext = TIER_IDS.find((t) => !revealed(t));
  const needColors = lockedNext ? C.sim.unlocks.TIER_REVEAL[lockedNext] : 0;
  const moreToGo = lockedNext ? Math.max(1, needColors - C.sim.discoveredCount(state)) : 0;
  const seg = h`<div class="seg-control" role="group" aria-label="Difficulty">${shown.map((t) => h`<button type="button" data-action="tier" data-tier="${t}" data-tap aria-pressed="${t === tier ? 'true' : 'false'}">${TIER_LABEL[t]}</button>`)}</div>
${lockedNext ? h`<div class="pz-tiertag" data-tier-tag>${lockTag(`${TIER_LABEL[lockedNext]} at ${needColors} colors \u2014 ${moreToGo} more`, { cls: 'pz-tag' })}</div>` : ''}`;

  const gradingCard = h`<div class="card" id="pz-grading" data-coach="grading">
<div class="row between"><div class="h3">Grading boards</div><span class="chip">${GRID[tier]}</span></div>
<div class="hint">Put a gradient back in order. Solving reveals new tints and a production boost.</div>
${banner}
${seg}
<div class="hint tierdesc">${TIER_HINT[tier]}</div>
<div class="tierline"><span>Reward: <span class="reward">about ${coinsText(C, reward)} coins</span></span>${tier === 'master' ? h`<span>plus a bonus roll</span>` : ''}</div>
${nudge ? h`<div class="pz-nudge"><div class="semi">You are gliding through these. Try Tricky?</div><div class="row"><button type="button" class="btn btn-primary small" data-action="try-tricky" data-tap>Try Tricky</button><button type="button" class="btn small" data-action="dismiss-nudge" data-tap>Maybe later</button></div></div>` : ''}
${boardInfo}
${board
    ? h`<div class="row"><div class="grow">${button('Continue board', { variant: 'primary', block: true, attrs: { 'data-action': 'continue-grading' } })}</div>${button('New board', { small: true, attrs: { 'data-action': 'new-grading' } })}</div>`
    : button('New grading board', { variant: 'primary', block: true, cls: 'tall', attrs: { 'data-action': 'new-grading' } })}
${tw ? h`<button type="button" class="btn small block quiet" data-action="new-grading" data-mode="own" data-tap>New board in my own colors</button>` : ''}
</div>`;

  const batches = state.muddyBatches || [];
  const pur = active.purify;
  const batchRows = batches.map((b) => {
    const name = C.sim.displayName ? C.sim.displayName(state, b.color) : b.color;
    const hex = C.sim.economy.colorHex(b.color);
    const going = pur && pur.batchId === b.id;
    const jars = Math.max(1, Math.round(num(b.jars)));
    return h`<div class="batch">
<div class="row">${swatch(hex, 40, { label: name })}<div class="grow"><div class="semi pz-name">${name}</div><div class="hint">${jars} ${jars === 1 ? 'jar' : 'jars'}${going ? ', a pour is under way' : ''}</div></div></div>
${button(going ? `Continue purifying ${name}` : `Purify a batch of ${name} (${jars} ${jars === 1 ? 'jar' : 'jars'})`, { variant: 'primary', block: true, attrs: { 'data-action': 'purify', 'data-batch': b.id } })}
${button('Sell as is for 80% of the price', { small: true, block: true, cls: 'quiet', attrs: { 'data-action': 'sell-muddy', 'data-batch': b.id } })}
</div>`;
  });
  const purifyCard = h`<div class="card" id="pz-purify">
<div class="row between"><div class="h3">Purify</div>${batches.length ? h`<span class="chip">${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}</span>` : ''}</div>
<div class="hint">Sort the layers of a muddy batch into pure tubes. A pure batch sells for 50% more.</div>
${batches.length ? batchRows : h`<div class="hint">Muddy batches come from fast mixers. When one is made, it waits here for you.</div>
${button('Go to the workshop', { block: true, cls: 'quiet', attrs: { 'data-action': 'to-workshop' } })}`}
</div>`;

  const pk = active.packing;
  const yard = yardStatus(C, state);
  const packAction = pk
    ? button('Continue packing', { variant: 'primary', block: true, attrs: { 'data-action': 'continue-packing' } })
    : yard.open
      ? button('Go to the Loading Yard', { block: true, cls: 'quiet', attrs: { 'data-action': 'to-yard' } })
      : h`<div class="pz-tiertag">${unlockTag(C, 'shipping', { cls: 'pz-tag' })}</div>`;
  const packingCard = h`<div class="card" id="pz-packing">
<div class="h3">Packing</div>
<div class="hint">Packing happens when you ship a crate: sort the jars into route crates before a cart leaves. A clean crate ships at +25%.</div>
${packAction}
</div>`;

  return h`<div class="screen-head is-left"><div class="titles"><div class="title">Puzzle table</div><div class="subtitle">Short, calm, and always worth it</div></div></div>
<div class="screen-body pz-body pz-hub">${gradingCard}${purifyCard}${packingCard}</div>`;
}

function sigOf(state) {
  const a = activeOf(state);
  const tier = rememberedTier(state);
  const tw = boardTwist(C, state);
  return JSON.stringify([
    tier, fmt(rewardOf(state, tier)), a.grading ? [a.grading.tier, C.puzzles.grading.wrongCount(a.grading)] : 0,
    a.purify ? a.purify.batchId : 0, a.packing ? 1 : 0, tw ? tw.id : 0,
    (state.muddyBatches || []).map((b) => [b.id, Math.round(num(b.jars))]),
    (() => { const y = yardStatus(C, state); const u = C.sim.unlocks.status(state, 'shipping'); return [y.open, y.need, u.revealed, u.affordable]; })(),
    num(state.stats && state.stats.fastSolves) >= 3,
    C.sim.discoveredCount(state),
  ]);
}

function draw(state, force = false) {
  const sig = sigOf(state);
  if (!force && sig === SIG) return;
  SIG = sig;
  const body = ROOT.querySelector('.screen-body');
  const top = body ? body.scrollTop : 0;
  ROOT.innerHTML = build(state);
  const nb = ROOT.querySelector('.screen-body');
  if (nb) nb.scrollTop = top;
}

function startGrading(mode) {
  const own = mode === 'own';
  C.game.act((s, _a, now) => createGradingBoard(C, s, { tier: rememberedTier(s), own }, now));
  C.navigate('grading', { fresh: true });
}

function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !ROOT.contains(t)) return;
  const act = t.dataset.action;
  if (act === 'unlock-open') { ensureWorkshopStyles(); openUnlockSheet(C, t.dataset.unlock, { host: ROOT }); return; }
  if (act === 'tier') {
    const tier = t.dataset.tier;
    if (C.sim.unlocks && !C.sim.unlocks.tierRevealed(C.game.state, tier)) return;
    C.game.act((s, a) => {
      if (a.tier === 'tricky' || a.tier === 'master') { s.stats = s.stats || {}; s.stats.fastSolves = 0; }
      return C.sim.settings.setPuzzleTier(s, { puzzle: 'grading', tier: a.tier });
    }, { tier });
    draw(C.game.state, true);
  } else if (act === 'new-grading') {
    startGrading(t.dataset.mode);
  } else if (act === 'continue-grading') {
    C.navigate('grading', {});
  } else if (act === 'try-tricky') {
    C.game.act((s) => {
      s.stats = s.stats || {};
      s.stats.fastSolves = 0;
      return C.sim.settings.setPuzzleTier(s, { puzzle: 'grading', tier: 'tricky' });
    });
    draw(C.game.state, true);
  } else if (act === 'dismiss-nudge') {
    C.game.act((s) => { s.stats = s.stats || {}; s.stats.fastSolves = 0; });
    draw(C.game.state, true);
  } else if (act === 'purify') {
    const batchId = t.dataset.batch;
    const cur = activeOf(C.game.state).purify;
    if (!cur || cur.batchId !== batchId) {
      const made = C.game.act((s, a, now) => createPurifyPuzzle(C, s, a, now), { batchId });
      if (!made) { C.toast('That batch is already taken care of.'); return; }
    }
    C.navigate('purify', { batchId });
  } else if (act === 'sell-muddy') {
    const batchId = t.dataset.batch;
    const res = C.game.act((s, a, now) => {
      const r = C.sim.factory.sellMuddyBatch(s, a, now);
      if (s.activePuzzles && s.activePuzzles.purify && s.activePuzzles.purify.batchId === a.batchId) s.activePuzzles.purify = null;
      return r;
    }, { batchId });
    if (res && res.ok) C.toast(`Sold for ${coinsText(C, res.coins)} coins`);
    draw(C.game.state, true);
  } else if (act === 'continue-purify') {
    C.navigate('purify', {});
  } else if (act === 'continue-packing') {
    C.navigate('packing', { from: 'puzzles' });
  } else if (act === 'to-workshop') {
    C.navigate('workshop', {});
  } else if (act === 'to-yard') {
    C.navigate('workshop', { sheet: 'yard' });
  }
}

export default {
  id: 'puzzles',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('shared', PZ_CSS);
    root.addEventListener('click', onClick);
  },

  show(params = {}) {
    section = params.puzzle || null;
    const st = C.game.state;
    if (activeOf(st).pendingTints && activeOf(st).pendingTints.length) {
      C.game.act((s, _a, now) => flushTints(C, s, now));
    }
    draw(C.game.state, true);
    if (section) {
      const el = ROOT.querySelector(`#pz-${section}`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    }
  },

  hide() {},

  render(state) {
    if (!ROOT) return;
    draw(state);
  },
};
