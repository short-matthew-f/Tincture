/**
 * shelf.js: the Merge Shelf (overlay `shelf`), a 6 x 6 match shelf.
 *
 * Owns: the 6x6 grid sized to ONE screen (no page scroll at 390x844 or
 * 375x667 with the tab bar showing), containers drawn with kit.containerSvg
 * plus a family glyph (a small cork mark, always on), the five color chips
 * above the board (a chooser sheet per chip), drag and drop through
 * fx.drag (board-local hit testing, ghost above the finger, hysteresis and
 * magnet all live in fx.js), tap-tap as the fallback, the merge / chain /
 * Cask-to-Essence visuals, and THE LINE SEQUENCE (PLAN-v0.2 Theme B): a full
 * row, column or diagonal of one hue family resolves in the sim (coins are
 * credited at once); this screen plays it back in about 1.5 s, skippable by
 * a tap. Implements DESIGN.md "The Merge Shelf" and the Merge, Chain merge,
 * Essence earned rows of "Interaction feel > Interaction spec".
 *
 * Sound and touch: a merge plays audio.clink(tier) with a medium haptic (heavy
 * for a Cask). The app plays audio.chain (the 'chain' event) and the Essence
 * bell, flying the star from the cell marked data-essence-from (set on the
 * drop target around the act). This screen plays one audio.note per container
 * in a line (no per-step haptic), then heavy on the pop; fx.stamp / fx.coinArc
 * bring their own medium / ripple haptics.
 *
 * Header: the screen head carries the title, "How this works" and a small
 * coin counter (the coin arc's target); under it ONE line ("A new vial in
 * about 9 m · 2 Essence", or "The shelf is resting: make room for new vials");
 * tapping a container turns that line into the sell row (Sell / Done).
 *
 * data-actions: chip, pick-color, reset-colors, sell, done, close-sheet.
 * Cells carry data-cell="<index>" and data-color. Coach anchors:
 * data-coach="shelf" (board), "shelf-first" (the first container with a twin),
 * "shelf-chips" (the chip row), "shelf-info" (the header line).
 *
 * Local counters (through game.act): stats.wrongDrops (a drop that resolves
 * to -1), stats.rejectedDrags (a drag that was cancelled), stats.lineSkips
 * (sim.shelf.skipLine, a tap through a line sequence).
 */

import { h, raw, backButton, button, iconSvg, containerSvg, CONTAINER_NAMES, safeHex } from './kit.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';

export const COLS = 6;
export const ROWS = 6;
const N = COLS * ROWS;
const GAP = 5;          // gap between cells (px)
const BPAD = 8;         // board frame padding (px); also the drag bounds' frame
const ROW_H = 44;       // the info line and the chip row
const MAX_CELL_W = 64;

/** The line sequence's beats (ms). Total about 1.5 s; see playLines. */
export const TIMING = Object.freeze({
  lean: 60,        // between lean-ins (a)
  leanDur: 110,
  squash: 140,     // (b) squash, then pop 140: 280 in all
  pop: 140,
  hold: 350,       // (c) glowing hold
  holdFirst: 500,  // ...her first line ever
  tip: 130,        // (d) the container tips as the coins leave
  stampAt: 120,    // the stamp lands about 285 ms after (d) starts
  clear: 150,      // (e) shimmer and clear
  chain: 90,       // chain steps
});

const FAMILIES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'];
const FAMILY_HEX = {
  red: '#B8433A', orange: '#D9792E', yellow: '#D9A93A', green: '#6E9A55', teal: '#3F8F8A',
  blue: '#3E6A9E', violet: '#7A5A9A', pink: '#D98A9F', neutral: '#9A9288',
};

/**
 * Family glyphs: one distinct tiny shape per hue family, drawn on a 10 x 10
 * grid and set on a cork disc, so the rule "lines match on family" has a cue
 * that does not rely on color. red circle, orange triangle, yellow square,
 * green diamond, teal four-point star, blue plus, violet hexagon, pink heart,
 * neutral bar.
 */
export const FAMILY_GLYPHS = Object.freeze({
  red: '<circle cx="5" cy="5" r="3.3"/>',
  orange: '<path d="M5 1.3 L9.1 8.5 H0.9 Z"/>',
  yellow: '<rect x="1.9" y="1.9" width="6.2" height="6.2" rx="0.5"/>',
  green: '<path d="M5 0.7 L9.3 5 L5 9.3 L0.7 5 Z"/>',
  teal: '<path d="M5 0.3 C5.5 3.5 6.5 4.5 9.7 5 C6.5 5.5 5.5 6.5 5 9.7 C4.5 6.5 3.5 5.5 0.3 5 C3.5 4.5 4.5 3.5 5 0.3 Z"/>',
  blue: '<path d="M3.9 1.1 H6.1 V3.9 H8.9 V6.1 H6.1 V8.9 H3.9 V6.1 H1.1 V3.9 H3.9 Z"/>',
  violet: '<path d="M5 0.9 L8.7 3 V7 L5 9.1 L1.3 7 V3 Z"/>',
  pink: '<path d="M5 9 C1 6.2 0.7 3.7 2.3 2.5 C3.4 1.7 4.6 2.2 5 3.2 C5.4 2.2 6.6 1.7 7.7 2.5 C9.3 3.7 9 6.2 5 9 Z"/>',
  neutral: '<rect x="0.9" y="3.9" width="8.2" height="2.2" rx="1.1"/>',
});

const CSS = `
#screen-shelf .screen-head .titles{display:flex;flex-direction:column;align-items:center}
#screen-shelf .how-link{min-height:24px;padding:0 8px;line-height:1;position:relative}
#screen-shelf .how-link::before{content:'';position:absolute;inset:-10px -8px}
#screen-shelf .sh-coins{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:76px;height:34px;padding:0 10px 0 8px;border-radius:999px;background:var(--paper);box-shadow:var(--cut-sm);font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}
#screen-shelf .screen-body{overflow:hidden;gap:6px;padding-top:4px;padding-bottom:8px}
#screen-shelf .sh-info{flex:0 0 auto;height:${ROW_H}px;display:flex;align-items:center;gap:8px}
#screen-shelf .sh-line{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;line-height:1.2;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#screen-shelf .sh-line.is-rest{color:var(--ink-soft)}
#screen-shelf .sh-sel{display:flex;align-items:center;gap:8px;width:100%}
#screen-shelf .sh-sel .grow{min-width:0;flex:1 1 auto;line-height:1.2}
#screen-shelf .sh-sel .btn.small{min-height:44px;padding-left:14px;padding-right:14px}
#screen-shelf .sh-mini{flex:0 0 auto;width:26px}
#screen-shelf .sh-chips{flex:0 0 auto;height:${ROW_H}px;display:flex;align-items:center;gap:6px}
#screen-shelf .sh-chips-cap{flex:0 0 auto;width:40px;font-size:11px;font-weight:600;line-height:1.1;color:var(--ink-soft)}
#screen-shelf .sh-chip{flex:1 1 0;min-width:0;height:${ROW_H}px;border-radius:12px;background:var(--paper);box-shadow:var(--cut-sm);display:flex;align-items:center;justify-content:center;position:relative;border:0;padding:0;color:var(--ink)}
#screen-shelf .sh-chip:active{transform:translateY(2px);box-shadow:var(--cut-press)}
#screen-shelf .sh-chip.is-empty{background:transparent;box-shadow:inset 0 0 0 2px rgba(42,38,34,.18);color:var(--ink-soft)}
.sh-sw{position:relative;display:inline-block;width:26px;height:26px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(42,38,34,.3);flex:0 0 auto}
.sh-sw .sh-fam{position:absolute;right:-6px;bottom:-5px}
.sh-vial{position:relative;transform-origin:50% 100%}
#screen-shelf .sh-vial{width:var(--vw,38px);height:calc(var(--vw,38px)*1.375)}
.sh-vial>svg{display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
.sh-vial .sh-fam{position:absolute;right:-4px;top:-1px}
.sh-fam{display:inline-block;width:14px;height:14px;pointer-events:none;line-height:0}
.sh-fam svg{display:block;width:100%;height:100%;overflow:visible}
#screen-shelf .sh-board{position:relative;flex:0 0 auto;align-self:center;background:#7B5236;border-radius:14px;padding:${BPAD}px;box-shadow:0 4px 0 rgba(42,38,34,.3);display:grid;grid-template-columns:repeat(${COLS},var(--cw,50px));grid-auto-rows:var(--ch,60px);column-gap:${GAP}px;row-gap:var(--rowgap,${GAP}px);-webkit-user-select:none;user-select:none}
#screen-shelf .sh-board.is-locked{opacity:.55;pointer-events:none}
#screen-shelf .sh-cell{width:var(--cw,50px);height:var(--ch,60px);border-radius:9px;background:#5E3E28;box-shadow:inset 0 3px 0 rgba(0,0,0,.25),0 2px 0 #8A5F3F;display:flex;align-items:flex-end;justify-content:center;padding:0 0 3px;position:relative;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
#screen-shelf .sh-cell.has-item{touch-action:none;cursor:grab}
#screen-shelf .sh-cell.is-drag-source .sh-vial{opacity:.3}
#screen-shelf .sh-cell::before,#screen-shelf .sh-cell::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none}
#screen-shelf .sh-cell.is-guide::before{background:var(--fam,#fff);opacity:.26;box-shadow:inset 0 0 0 2px var(--fam,#fff)}
#screen-shelf .sh-cell.is-sel{box-shadow:0 0 0 3px #F7F4EC,0 0 0 5px #E2B04A,inset 0 3px 0 rgba(0,0,0,.25)}
#screen-shelf .sh-cell.is-partner{box-shadow:inset 0 0 0 2px rgba(226,176,74,.95),inset 0 3px 0 rgba(0,0,0,.25),0 2px 0 #8A5F3F}
#screen-shelf .sh-cell.is-target{box-shadow:inset 0 0 0 2px rgba(247,244,236,.85),inset 0 3px 0 rgba(0,0,0,.25),0 2px 0 #8A5F3F}
#screen-shelf .sh-cell.is-target.is-mergeable{box-shadow:inset 0 0 0 3px #E2B04A,0 0 10px rgba(226,176,74,.7),0 2px 0 #8A5F3F}
#screen-shelf .sh-cell.is-shimmer{overflow:hidden}
#screen-shelf .sh-cell.is-shimmer::after{background:linear-gradient(105deg,transparent 15%,rgba(255,246,223,.9) 50%,transparent 85%);transform:translateX(-100%);animation:sh-shim ${TIMING.clear}ms ease-out forwards}
@keyframes sh-shim{to{transform:translateX(100%)}}
#screen-shelf .sh-over{position:absolute;inset:0;z-index:6;pointer-events:none}
#screen-shelf .sh-big{position:absolute;display:flex;align-items:center;justify-content:center}
#screen-shelf .sh-bigv{transform-origin:50% 60%}
#screen-shelf .sh-bigv svg{display:block;overflow:visible}
#screen-shelf .sh-bigv.is-glow{filter:drop-shadow(0 0 7px rgba(255,226,140,.95)) drop-shadow(0 0 16px rgba(226,176,74,.7));animation:sh-glow 420ms ease-in-out infinite alternate}
@keyframes sh-glow{from{filter:drop-shadow(0 0 5px rgba(255,226,140,.8)) drop-shadow(0 0 10px rgba(226,176,74,.5))}to{filter:drop-shadow(0 0 9px rgba(255,236,170,1)) drop-shadow(0 0 20px rgba(226,176,74,.8))}}
#screen-shelf .sh-band{position:absolute}
#screen-shelf .sh-whisper{position:absolute;max-width:92%;padding:5px 9px;border-radius:8px;background:var(--paper);color:var(--ink);box-shadow:var(--cut-sm);font-size:12px;font-weight:600;line-height:1.25;text-align:center;animation:sh-whisper 2400ms ease-out both}
@keyframes sh-whisper{0%{opacity:0;transform:translateY(4px)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
#screen-shelf .sh-layer{position:absolute;inset:0;z-index:20;background:rgba(42,38,34,.45);display:flex;align-items:flex-end;justify-content:center;animation:fade-in 160ms ease-out both}
#screen-shelf .sh-layer[hidden]{display:none}
#screen-shelf .sh-pick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:46vh;overflow-y:auto;padding:2px}
#screen-shelf .sh-opt{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 10px;border-radius:12px;border:0;background:var(--plaster);color:var(--ink);font:inherit;font-size:13px;font-weight:600;text-align:left;box-shadow:var(--cut-sm)}
#screen-shelf .sh-opt[aria-pressed="true"]{box-shadow:0 0 0 3px var(--ink)}
#screen-shelf .sh-opt .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-star{position:fixed;left:0;top:0;pointer-events:none;z-index:70;will-change:transform,opacity}
html[data-motion="reduced"] #screen-shelf .sh-bigv.is-glow{animation:none}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('shelf-css')) return;
  const s = document.createElement('style');
  s.id = 'shelf-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let root = null;
let ctx = null;
let fx = fxDefault;
let audio = audioDefault;
let haptics = hapticsDefault;
let dragH = null;

const ui = {
  sel: null,         // selected cell (tap-tap + the sell row)
  vis: new Array(N).fill(null), // what the board DOM shows (equals the state except mid-sequence)
  hold: 0,           // > 0: a play is running; the board is not rebuilt
  lock: 0,           // > 0: nothing may be picked up (merge visuals, the line's lean and squash)
  seq: null,         // the running line sequence
  epoch: 0,
  merged: false,     // she merged something this visit (guide gate)
  skeleton: false,
  sig: '',
  rowSig: '',
  chipSig: '',
  sheet: null,
  lay: null,         // {cw, ch, vw, gap}
  coinLocks: 0,      // > 0: the coin pill shows ui.coinShown
  coinShown: 0,
  dragMoved: false,
  quiet: false,      // hide() cancelling a drag: not a rejected drag
  guides: [],
};

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);
const hexOf = (id) => sim().colorHex(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (fn) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };

function anim(elm, keyframes, options) {
  if (!elm || typeof elm.animate !== 'function') return Promise.resolve();
  try {
    return elm.animate(keyframes, options).finished.then(() => undefined, () => undefined);
  } catch (e) { return Promise.resolve(); }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function snap(st) {
  return st.shelf.cells.slice(0, N).map((c) => (c ? { color: c.color, tier: c.tier, golden: !!c.golden } : null));
}

function neighborsOf(i) {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const out = [];
  if (r > 0) out.push(i - COLS);
  if (r < ROWS - 1) out.push(i + COLS);
  if (c > 0) out.push(i - 1);
  if (c < COLS - 1) out.push(i + 1);
  return out;
}

/** Every row, column and main diagonal as index lists (the sim's own order). */
export function lineSlots() {
  const out = [];
  for (let r = 0; r < ROWS; r++) out.push({ kind: 'row', cells: Array.from({ length: COLS }, (_, c) => r * COLS + c) });
  for (let c = 0; c < COLS; c++) out.push({ kind: 'col', cells: Array.from({ length: ROWS }, (_, r) => r * COLS + c) });
  out.push({ kind: 'diag', cells: Array.from({ length: 6 }, (_, k) => k * COLS + k) });
  out.push({ kind: 'diag', cells: Array.from({ length: 6 }, (_, k) => k * COLS + (COLS - 1 - k)) });
  return out;
}

/**
 * Does any line of `kind` ('row' | 'col' | 'diag') hold five containers of one
 * family with the sixth spot not completing it? `cells` are {color, golden}
 * objects or null; `familyOf(colorId)` names the hue family. Golden counts as
 * any family. Used to teach columns and diagonals the first time five line up.
 */
export function hasFive(cells, kind, familyOf) {
  for (const slot of lineSlots()) {
    if (slot.kind !== kind) continue;
    const items = slot.cells.map((i) => cells[i]);
    const filled = items.filter(Boolean);
    if (filled.length < 5) continue;
    const goldens = filled.filter((x) => x.golden).length;
    const counts = {};
    for (const x of filled) if (!x.golden) counts[familyOf(x.color)] = (counts[familyOf(x.color)] || 0) + 1;
    const best = Math.max(0, ...Object.values(counts));
    if (best + goldens >= 5 && filled.length === 6 && best + goldens === 6) continue; // complete: it resolves
    if (best + goldens >= 5) return true;
  }
  return false;
}

function famOf(colorId) {
  try { return sim().colorFamily(colorId); } catch (e) { return 'neutral'; }
}

/** The glyph for a family: a cork disc with a small ink shape. */
export function familyGlyphHtml(family, size = 14) {
  const g = FAMILY_GLYPHS[family] || FAMILY_GLYPHS.neutral;
  return raw(`<span class="sh-fam" data-family="${FAMILY_GLYPHS[family] ? family : 'neutral'}" style="width:${size}px;height:${size}px"><svg viewBox="-1.6 -1.6 13.2 13.2" aria-hidden="true"><circle cx="5" cy="5" r="6.2" fill="#C9A277" stroke="#5E3E28" stroke-width="0.9"/><g fill="#2A2622">${g}</g></svg></span>`);
}

function cellName(st, c) {
  if (!c) return '';
  const tierName = CONTAINER_NAMES[c.tier] || 'Container';
  return c.golden ? `Golden ${tierName.toLowerCase()}` : `${sim().displayName(st, c.color)} ${tierName.toLowerCase()}`;
}

function totalEssence(st) {
  let n = 0;
  for (const d of Object.values(st.catalog?.discovered || {})) n += Math.min(sim().ESSENCE_MAX, d.essence || 0);
  return n;
}

function lightnessOf(hex) {
  try { return ctx.color.hexToOklch(hex).L; } catch (e) { return 0.6; }
}

// ---------------------------------------------------------------------------
// Layout: one screen, no scroll
// ---------------------------------------------------------------------------

/**
 * Pure: the cell size for a body `W` x `H` px (the board's own outer box).
 * cell = min((W - 2*pad - 5*gap) / 6, (H - 2*pad - 5*gap) / 6): square cells
 * unless there is height to spare, then up to 1.3x taller (and a wider row gap).
 */
export function fitBoard(W, H, { gap = GAP, pad = BPAD, maxCell = MAX_CELL_W } = {}) {
  const byW = Math.floor((W - 2 * pad - (COLS - 1) * gap) / COLS);
  const byH = Math.floor((H - 2 * pad - (ROWS - 1) * gap) / ROWS);
  const cw = Math.max(24, Math.min(byW, byH, maxCell));
  const ch = Math.max(cw, Math.min(Math.round(cw * 1.3), byH));
  const extra = H - (2 * pad + ROWS * ch + (ROWS - 1) * gap);
  const rowGap = gap + Math.max(0, Math.min(7, Math.floor(extra / (ROWS - 1))));
  const vw = Math.max(20, Math.min(Math.round(cw * 0.92), Math.floor((ch - 4) * 80 / 110)));
  return { cw, ch, vw, gap, rowGap };
}

function layout() {
  const body = root && q('[data-ref=body]');
  if (!body || !body.clientWidth) return null;
  const cs = getComputedStyle(body);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const rowGapPx = parseFloat(cs.rowGap) || 0;
  const W = body.clientWidth - padX;
  let used = padY;
  let n = 0;
  for (const c of body.children) {
    if (c.classList.contains('sh-board')) continue;
    used += c.offsetHeight;
    n++;
  }
  used += rowGapPx * n;
  const H = body.clientHeight - used;
  const lay = fitBoard(W, H);
  ui.lay = lay;
  const board = q('[data-ref=board]');
  board.style.setProperty('--cw', `${lay.cw}px`);
  board.style.setProperty('--ch', `${lay.ch}px`);
  board.style.setProperty('--vw', `${lay.vw}px`);
  board.style.setProperty('--rowgap', `${lay.rowGap}px`);
  return lay;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function vialHtml(c) {
  const vw = (ui.lay && ui.lay.vw) || 38;
  return h`<div class="sh-vial">${containerSvg(c.tier, hexOf(c.color), { golden: !!c.golden, size: vw, label: '' })}${familyGlyphHtml(famOf(c.color), 14)}</div>`;
}

function cellAttrs(st, c) {
  const fam = c ? (c.golden ? 'any family' : `${famOf(c.color)} family`) : '';
  return {
    label: c ? `${cellName(st, c)}, ${fam}` : 'Empty spot',
  };
}

function cellHtml(st, i, c) {
  const { label } = cellAttrs(st, c);
  return h`<div class="sh-cell${c ? ' has-item' : ''}" data-cell="${i}"${c ? h` data-color="${c.color}" data-tap` : ''} role="button" tabindex="${c ? 0 : -1}" aria-label="${label}">${c ? vialHtml(c) : ''}</div>`;
}

function boardHtml(st) {
  const cells = [];
  for (let i = 0; i < N; i++) cells.push(cellHtml(st, i, ui.vis[i]));
  return h`${cells}<div class="sh-over" data-ref="over"></div>`;
}

function skeleton() {
  root.innerHTML = String(h`
<div class="screen-head">
  ${backButton('Back to the workshop')}
  <div class="titles"><div class="title">Merge Shelf</div>${howThisWorksHtml('shelf')}</div>
  <span class="sh-coins" data-ref="coinpill" role="status" aria-label="Coins">${iconSvg('coin', { size: 18 })}<span data-ref="coins">0</span></span>
</div>
<div class="screen-body" data-ref="body">
  <div class="sh-info" data-ref="info" data-coach="shelf-info"></div>
  <div class="sh-chips" data-ref="chips" data-coach="shelf-chips"></div>
  <div class="sh-board" data-ref="board" data-coach="shelf"></div>
</div>
<div class="sh-layer" data-ref="layer" data-action="close-sheet" hidden></div>`);
  ui.skeleton = true;
  ui.sig = '';
  ui.rowSig = '';
  ui.chipSig = '';
  ui.lay = null;
}

// ---------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------

function setCoinText(v) {
  const el = q('[data-ref=coins]');
  if (el) el.textContent = ctx.format.num(v);
}

function infoText(st, now) {
  const sh = sim().shelf;
  const s = st.shelf;
  let text;
  let rest = false;
  if (!sh.unlocked(st)) {
    text = 'The shelf is waiting to be opened';
    rest = true;
  } else if (sh.spilloverPaused(st)) {
    text = 'The shelf is resting: make room for new vials';
    rest = true;
  } else if (!(s.nextSpilloverAt > 0)) {
    text = s.pausedRemainingMs > 0 ? 'Vials pause while your mixers rest' : 'Vials arrive while your mixers run';
  } else {
    const ms = s.nextSpilloverAt - now;
    text = ms <= 0 ? 'A new vial is on its way' : `A new vial in ${ctx.format.until(ms)}`;
  }
  const ess = totalEssence(st);
  if (ess > 0 && !rest) text += ` · ${ess} Essence`;
  return { text, rest };
}

function updateInfo(st, now) {
  const info = q('[data-ref=info]');
  const c = ui.sel === null ? null : st.shelf.cells[ui.sel];
  if (ui.sel !== null && !c) ui.sel = null;
  if (!c) {
    const { text, rest } = infoText(st, now);
    const key = `t:${text}:${rest}`;
    if (ui.rowSig !== key) {
      ui.rowSig = key;
      info.innerHTML = String(h`<div class="sh-line${rest ? ' is-rest' : ''}" aria-live="polite">${text}</div>`);
    }
    return;
  }
  const value = ctx.format.num(sim().shelf.containerValue(st, ui.sel, now));
  const name = cellName(st, c);
  const key = `s:${ui.sel}:${c.color}:${c.tier}:${c.golden ? 1 : 0}:${value}`;
  if (ui.rowSig === key) return;
  ui.rowSig = key;
  info.innerHTML = String(h`<div class="sh-sel">
  <div class="sh-mini">${containerSvg(c.tier, hexOf(c.color), { golden: !!c.golden, size: 26 })}</div>
  <div class="grow"><div class="semi ellipsis">${name}</div><div class="small muted">Sells for ${value} Coins${c.golden && sim().shelf.goldenAllowed(st) ? '. Merge it to double a partner' : ''}</div></div>
  ${button('Done', { small: true, attrs: { 'data-action': 'done' } })}
  ${button('Sell', { small: true, variant: 'primary', attrs: { 'data-action': 'sell' } })}
</div>`);
}

function updateCoins(st) {
  if (ui.coinLocks > 0) return;
  setCoinText(st.coins || 0);
}

function updateChips(st) {
  const colors = sim().shelf.shelfColors(st);
  const key = colors.join(',') + '|' + colors.map((id) => sim().displayName(st, id)).join(',');
  if (key === ui.chipSig) return;
  ui.chipSig = key;
  const chips = [];
  for (let k = 0; k < sim().shelf.MAX_COLORS; k++) {
    const id = colors[k];
    if (id) {
      const name = sim().displayName(st, id);
      const fam = famOf(id);
      chips.push(h`<button type="button" class="sh-chip" data-tap data-action="chip" data-slot="${k}" aria-label="${name}, ${fam} family. New vials come in this color. Change it"><span class="sh-sw" style="background:${safeHex(hexOf(id))}">${familyGlyphHtml(fam, 14)}</span></button>`);
    } else {
      chips.push(h`<button type="button" class="sh-chip is-empty" data-tap data-action="chip" data-slot="${k}" aria-label="Add a vial color">${iconSvg('plus', { size: 18 })}</button>`);
    }
  }
  q('[data-ref=chips]').innerHTML = String(h`<span class="sh-chips-cap">New vials</span>${chips}`);
}

function boardSig(st) {
  return [
    ui.lay ? `${ui.lay.cw}x${ui.lay.ch}x${ui.lay.vw}x${ui.lay.rowGap}` : '-',
    sim().shelf.unlocked(st),
    snap(st).map((c) => (c ? `${c.color}:${c.tier}:${c.golden ? 1 : 0}` : '-')).join(','),
    Object.values(st.catalog?.discovered || {}).map((d) => d.name).join('|'),
  ].join('#');
}

function markFirstPartner(st) {
  const board = q('[data-ref=board]');
  board.querySelectorAll('[data-coach="shelf-first"]').forEach((n) => n.removeAttribute('data-coach'));
  const hints = sim().shelf.hints(st);
  if (!hints.length) return;
  const first = hints.reduce((a, b) => (a > b ? a : b)); // the lowest row: nearest the thumb
  const el = cellEl(first);
  if (el) el.setAttribute('data-coach', 'shelf-first');
}

function applyHints(st) {
  const board = q('[data-ref=board]');
  const hints = new Set(sim().shelf.hints(st));
  const dragging = dragH && dragH.active;
  board.querySelectorAll('.sh-cell').forEach((cell) => {
    const i = +cell.dataset.cell;
    const v = cell.querySelector('.sh-vial');
    if (v) fx.pulse(v, hints.has(i) && !(dragging && cell.classList.contains('is-drag-source')));
    cell.classList.toggle('is-sel', ui.sel === i);
    cell.classList.toggle('is-partner', !dragging && ui.sel !== null && ui.sel !== i && !!st.shelf.cells[i] && sim().shelf.canMerge(st.shelf.cells[ui.sel], st.shelf.cells[i]));
  });
  markFirstPartner(st);
}

function refresh(force = false) {
  if (!root || !ctx || !ui.skeleton) return;
  const st = state();
  const now = ctx.game.now();
  updateCoins(st);
  updateChips(st);
  updateInfo(st, now);
  if (ui.hold > 0 || (dragH && dragH.active)) return;
  ui.vis = snap(st);
  if (!ui.lay || force) layout();
  const sig = boardSig(st);
  if (force || sig !== ui.sig) {
    ui.sig = sig;
    const board = q('[data-ref=board]');
    board.classList.toggle('is-locked', !sim().shelf.unlocked(st));
    board.innerHTML = String(boardHtml(st));
  }
  if (ui.sel !== null && !st.shelf.cells[ui.sel]) ui.sel = null;
  applyHints(st);
  updateInfo(st, now);
}

// ---------------------------------------------------------------------------
// Cell helpers (the visual state)
// ---------------------------------------------------------------------------

function cellEl(i) {
  return root ? q(`.sh-cell[data-cell="${i}"]`) : null;
}
function vialEl(i) {
  const c = cellEl(i);
  return c ? c.querySelector('.sh-vial') : null;
}
function overEl() {
  return root ? q('[data-ref=over]') : null;
}

/** Redraw one cell from ui.vis. */
function setCell(i) {
  const el = cellEl(i);
  if (!el) return;
  const c = ui.vis[i];
  const st = state();
  const { label } = cellAttrs(st, c);
  el.classList.toggle('has-item', !!c);
  el.classList.remove('is-drag-source');
  el.setAttribute('aria-label', label);
  el.tabIndex = c ? 0 : -1;
  if (c) {
    el.setAttribute('data-tap', '');
    el.setAttribute('data-color', String(c.color).replace(/[^\w-]/g, ''));
    el.innerHTML = String(vialHtml(c));
  } else {
    el.removeAttribute('data-tap');
    el.removeAttribute('data-color');
    el.innerHTML = '';
  }
}

function relRect(el) {
  const o = overEl().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height, right: r.right - o.left, bottom: r.bottom - o.top };
}

function endHold() {
  ui.hold = Math.max(0, ui.hold - 1);
  if (ui.hold === 0 && ui.skeleton) { ui.vis = snap(state()); refresh(true); }
}

// ---------------------------------------------------------------------------
// Merge visuals
// ---------------------------------------------------------------------------

function pop(el) {
  const v = el && el.querySelector('.sh-vial');
  if (!v) return Promise.resolve();
  if (fx.isReducedMotion()) { fx.fade(v); return Promise.resolve(); }
  return anim(v, [
    { transform: 'scale(0.6)' },
    { transform: 'scale(1.1)', offset: 0.6 },
    { transform: 'scale(1)' },
  ], { duration: 190, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' });
}

/** A gold star rises off the Cask and fades (reduced motion: a fade in place). */
function starLift(fromEl) {
  const a = fromEl.getBoundingClientRect();
  const layer = document.getElementById('fx-layer') || document.body;
  const star = document.createElement('div');
  star.className = 'sh-star';
  star.innerHTML = String(iconSvg('star', { size: 26 }));
  star.style.margin = '-13px 0 0 -13px';
  layer.appendChild(star);
  const x = a.left + a.width / 2;
  const y = a.top + a.height / 2;
  const rm = fx.isReducedMotion();
  return anim(star, rm
    ? [{ transform: `translate(${x}px,${y}px)`, opacity: 0 }, { transform: `translate(${x}px,${y}px)`, opacity: 1 }, { transform: `translate(${x}px,${y}px)`, opacity: 0 }]
    : [
      { transform: `translate(${x}px,${y}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x}px,${y - 30}px) scale(1.3)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x}px,${y - 46}px) scale(1.1)`, opacity: 0 },
    ], { duration: rm ? 240 : 520, easing: 'ease-out' }).then(() => star.remove());
}

async function playMerge(from, to, before, res, essBefore) {
  const reduced = fx.isReducedMotion();
  const steps = res.steps || [];
  const first = steps[0];
  if (!first) return;
  ui.vis = before.map((c) => (c ? { ...c } : null));
  const board = q('[data-ref=board]');
  board.querySelectorAll('.pulse').forEach((n) => n.classList.remove('pulse'));
  board.querySelectorAll('.is-target,.is-mergeable,.is-sel,.is-partner,.is-guide').forEach((n) => n.classList.remove('is-target', 'is-mergeable', 'is-sel', 'is-partner', 'is-guide'));

  // Step 0: lean in, squash, pop one size bigger.
  const fromV = vialEl(from);
  const toV = vialEl(to);
  if (!reduced && fromV && toV) {
    const a = fromV.getBoundingClientRect();
    const b = toV.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    await Promise.all([
      anim(fromV, [
        { transform: 'translate(0,0) rotate(0deg)' },
        { transform: `translate(${dx * 0.78}px,${dy * 0.78}px) rotate(${dx >= 0 ? 8 : -8}deg) scale(0.96)` },
      ], { duration: 100, easing: 'ease-in', fill: 'forwards' }),
      anim(toV, [{ transform: 'scale(1)' }, { transform: 'scale(1.07,0.9)' }], { duration: 100, easing: 'ease-out', fill: 'forwards' }),
    ]);
  }
  ui.vis[from] = null;
  setCell(from);
  const golden0 = !!(before[from] && before[to] && before[from].golden && before[to].golden);
  ui.vis[to] = { color: first.colorId, tier: first.tier, golden: golden0 };
  setCell(to);
  fx.ringBurst(cellEl(to), safeHex(hexOf(first.colorId)));
  audio.clink(first.tier);
  if (first.tier >= 5) haptics.heavy(); else haptics.medium();
  let popP = pop(cellEl(to));

  // Chain steps, TIMING.chain ms apart (the app plays the scale from the 'chain' event).
  for (let k = 1; k < steps.length; k++) {
    await wait(TIMING.chain);
    const cur = ui.vis[to];
    const n = neighborsOf(to).find((i) => {
      const x = ui.vis[i];
      return x && cur && !x.golden && !cur.golden && x.color === cur.color && x.tier === cur.tier;
    });
    if (n !== undefined) {
      const nV = vialEl(n);
      const nCell = n;
      if (!reduced && nV) {
        const a = nV.getBoundingClientRect();
        const b = cellEl(to).getBoundingClientRect();
        anim(nV, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${b.left + b.width / 2 - a.left - a.width / 2}px,${b.top + b.height / 2 - a.top - a.height / 2}px) scale(0.7)`, opacity: 0.2 }], { duration: 90, easing: 'ease-in', fill: 'forwards' });
      }
      ui.vis[nCell] = null;
      setTimeout(() => setCell(nCell), 90);
    }
    const s = steps[k];
    ui.vis[to] = { color: s.colorId, tier: s.tier, golden: false };
    setCell(to);
    fx.ringBurst(cellEl(to), safeHex(hexOf(s.colorId)), { size: 60 });
    haptics.light();
    popP = pop(cellEl(to));
  }
  await popP;

  // Cask -> Essence: a star lifts off the Cask. The app's 'essence' handler plays the
  // bell and flies the dot from [data-essence-from] (set on this cell) to the catalog.
  if (res.essence) {
    const v = vialEl(to);
    const lift = starLift(cellEl(to));
    anim(v, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9) translateY(-6px)' }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
    await lift;
    ui.vis[to] = null;
    setCell(to);
    await wait(500); // the dot's flight to the catalog tab
  }
  const ess = totalEssence(state());
  if (res.essence && ess !== essBefore) updateInfo(state(), ctx.game.now());
}

// ---------------------------------------------------------------------------
// The line sequence
// ---------------------------------------------------------------------------

function holdCoins(startValue) {
  ui.coinLocks++;
  ui.coinShown = startValue;
  setCoinText(startValue);
}
function releaseCoins() {
  ui.coinLocks = Math.max(0, ui.coinLocks - 1);
  if (ui.coinLocks === 0) setCoinText(state().coins || 0);
}
function rollCoins(from, to, ms = 420) {
  const el = q('[data-ref=coins]');
  if (!el) return Promise.resolve();
  ui.coinShown = to;
  return fx.rollNumber(el, from, to, { ms, format: ctx.format.num });
}

function dominantColor(cells) {
  const counts = new Map();
  for (const i of cells) {
    const c = ui.vis[i];
    if (c && !c.golden) counts.set(c.color, (counts.get(c.color) || 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [id, k] of counts) if (k > n) { best = id; n = k; }
  if (best) return best;
  const any = cells.map((i) => ui.vis[i]).find(Boolean);
  return any ? any.color : 'madder';
}

function endSeq(seq, { tapped = false } = {}) {
  if (!seq || seq.over) return;
  seq.over = true;
  seq.skipped = true;
  seq.tapped = tapped;
  if (seq.skipRes) seq.skipRes();
}

/**
 * playLines(res, release) -> Promise. `res` is the sim's resolveLines result
 * ({lines:[{cells,family,tier,coins}], tier, coins, double, cells, essence}).
 * The sim has already credited the coins and cleared the cells; ui.vis still
 * holds the six containers of each line. `release()` is called when the
 * board may be used again (from the glowing hold on).
 *
 *  (a) lean-ins from the ends inward, 60 ms apart, one note each (no haptic)
 *  (b) squash into one container at the line's centre, pop one tier bigger
 *      (ring burst, clink, heavy haptic), 280 ms
 *  (c) glowing hold, 350 ms (500 ms for her first line ever)
 *  (d) the container tips, coins arc to the header's coin pill and the counter
 *      rolls up, "Sold" is stamped on the line (medium haptic); "Double line"
 *      for two lines at once (two arcs that join)
 *  (e) shimmer and clear, 150 ms
 * A tap anywhere (until the hold, then anywhere but a cell) jumps to the end.
 */
async function playLines(res, release) {
  if (ui.seq) endSeq(ui.seq);
  const reduced = fx.isReducedMotion();
  const st = state();
  const over = overEl();
  if (!over) { release(); return; }
  const seq = { over: false, skipped: false, tapped: false, free: false, nodes: [], skipRes: null, skipP: null, cells: new Set(res.cells) };
  seq.skipP = new Promise((r) => { seq.skipRes = r; });
  ui.seq = seq;
  const pause = (ms) => (seq.skipped ? Promise.resolve() : Promise.race([wait(ms), seq.skipP]));
  const coinsEnd = st.coins || 0;
  const coinsStart = Math.max(0, coinsEnd - (res.coins || 0));
  holdCoins(coinsStart);
  const lines = res.lines || [];
  const lineInfo = lines.map((ln) => {
    const rects = ln.cells.map((i) => relRect(cellEl(i)));
    const cx = rects.reduce((a, r) => a + r.left + r.width / 2, 0) / rects.length;
    const cy = rects.reduce((a, r) => a + r.top + r.height / 2, 0) / rects.length;
    return { ln, cx, cy, hex: safeHex(hexOf(dominantColor(ln.cells))), color: dominantColor(ln.cells), rects };
  });

  const onDown = (e) => {
    if (seq.over) return;
    const cell = e.target && e.target.closest && e.target.closest('.sh-cell');
    if (seq.free && cell && root.contains(cell)) return; // a new drag outside the line is welcome
    endSeq(seq, { tapped: true });
  };
  root.addEventListener('pointerdown', onDown, true);

  const arcs = [];
  try {
    // (a) lean-ins, ends inward
    const order = [0, 5, 1, 4, 2, 3];
    const leaned = new Set();
    for (let k = 0; k < order.length && !seq.skipped; k++) {
      for (const li of lineInfo) {
        const idx = li.ln.cells[order[k]];
        if (idx === undefined || leaned.has(idx)) continue;
        leaned.add(idx);
        const v = vialEl(idx);
        const cell = ui.vis[idx];
        if (cell) audio.note(lightnessOf(hexOf(cell.color)), 0, 0.18, 0.5);
        if (!v) continue;
        if (reduced) { fx.fade(v); continue; }
        const r = relRect(cellEl(idx));
        const dx = (li.cx - (r.left + r.width / 2)) * 0.3;
        const dy = (li.cy - (r.top + r.height / 2)) * 0.3;
        const rot = dx > 1 ? 7 : dx < -1 ? -7 : (order[k] % 2 ? 5 : -5);
        anim(v, [{ transform: 'translate(0,0) rotate(0deg)' }, { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(1.04)` }], { duration: TIMING.leanDur, easing: 'ease-out', fill: 'forwards' });
      }
      await pause(TIMING.lean);
    }

    // (b) squash into one container at the line's centre, pop one tier bigger
    const bigs = [];
    if (!seq.skipped) {
      if (!reduced) {
        const jobs = [];
        for (const li of lineInfo) {
          for (const idx of li.ln.cells) {
            const v = vialEl(idx);
            if (!v) continue;
            const r = relRect(cellEl(idx));
            const dx = li.cx - (r.left + r.width / 2);
            const dy = li.cy - (r.top + r.height / 2);
            jobs.push(anim(v, [
              { transform: 'translate(0,0) scale(1)', opacity: 1 },
              { transform: `translate(${dx}px,${dy}px) scale(0.55,0.8)`, opacity: 0.85 },
            ], { duration: TIMING.squash, easing: 'ease-in', fill: 'forwards' }));
          }
        }
        await Promise.race([Promise.all(jobs), seq.skipP]);
      }
    }
    if (!seq.skipped) {
      const bw = Math.round(((ui.lay && ui.lay.vw) || 38) * 1.5);
      const bh = Math.round(bw * 110 / 80);
      for (const li of lineInfo) {
        for (const idx of li.ln.cells) { ui.vis[idx] = null; setCell(idx); }
      }
      for (const li of lineInfo) {
        const wrap = document.createElement('div');
        wrap.className = 'sh-big';
        wrap.style.cssText = `left:${li.cx - bw / 2}px;top:${li.cy - bh / 2}px;width:${bw}px;height:${bh}px`;
        wrap.innerHTML = `<div class="sh-bigv">${String(containerSvg(li.ln.tier, li.hex, { size: bw }))}</div>`;
        over.appendChild(wrap);
        seq.nodes.push(wrap);
        bigs.push({ wrap, inner: wrap.firstElementChild, li });
        if (res.essence && res.essence.length && li.ln.tier >= 5) wrap.setAttribute('data-essence-from', '');
      }
      audio.clink(res.tier || 3);
      haptics.heavy();
      const pops = [];
      for (const b of bigs) {
        fx.ringBurst(b.wrap, b.li.hex, { size: 96 });
        pops.push(reduced
          ? (fx.fade(b.inner), Promise.resolve())
          : anim(b.inner, [{ transform: 'scale(0.5)', opacity: 0.6 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.65 }, { transform: 'scale(1)', opacity: 1 }], { duration: TIMING.pop, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' }));
      }
      await Promise.race([Promise.all(pops), seq.skipP]);
    }

    // (c) from here on the cells outside the line take a new drag
    seq.free = true;
    release();
    if (!seq.skipped) {
      for (const b of bigs) b.inner.classList.add('is-glow');
      await pause(((state().stats && state().stats.lines) | 0) <= 1 ? TIMING.holdFirst : TIMING.hold);
    }

    // (d) tip, coins to the pill, the stamp
    let rolled = false;
    const startRoll = () => {
      if (rolled || seq.skipped) return;
      rolled = true;
      rollCoins(coinsStart, coinsEnd, 420);
    };
    if (!seq.skipped) {
      const pill = q('[data-ref=coinpill]');
      let bandNode = null;
      {
        // The "row" the stamp lands on: the union of every line's cells.
        const rects = lineInfo.flatMap((li) => li.rects);
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        bandNode = document.createElement('div');
        bandNode.className = 'sh-band';
        bandNode.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
        over.appendChild(bandNode);
        seq.nodes.push(bandNode);
      }
      bigs.forEach((b, k) => {
        const n = Math.max(8, Math.min(14, 8 + 2 * ((b.li.ln.tier || 1) - 1)));
        arcs.push(fx.coinArc(b.wrap, pill, n, { quiet: k > 0, onArrive: (i) => { if (i === 0) startRoll(); } }));
        if (!reduced) {
          anim(b.inner, [
            { transform: 'rotate(0deg) translate(0,0)', opacity: 1 },
            { transform: 'rotate(58deg) translate(10px,4px)', opacity: 0.85, offset: 0.7 },
            { transform: 'rotate(66deg) translate(12px,6px)', opacity: 0 },
          ], { duration: TIMING.tip + 120, easing: 'ease-in', fill: 'forwards' });
        } else {
          anim(b.inner, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
        }
      });
      await pause(TIMING.stampAt);
      if (!seq.skipped) {
        fx.stamp(bandNode, res.double ? 'Double line' : 'Sold', { hold: 520, hex: '#8C6512' }).then((node) => { if (node) seq.nodes.push(node); });
      }
      await pause(TIMING.tip + 120 - TIMING.stampAt + 40);

      // (e) shimmer and clear
      if (!seq.skipped) {
        for (const li of lineInfo) {
          for (const idx of li.ln.cells) {
            const cell = cellEl(idx);
            if (!cell) continue;
            if (reduced) fx.fade(cell); else { cell.classList.add('is-shimmer'); setTimeout(() => cell.classList.remove('is-shimmer'), TIMING.clear + 40); }
          }
        }
        for (const b of bigs) b.wrap.remove();
        await pause(TIMING.clear);
      }
      if (!seq.skipped) await Promise.race([Promise.all(arcs), seq.skipP]);
    }
  } catch (e) {
    console.error('[shelf] line sequence', e);
  } finally {
    // The end state, however we got here: cells cleared, coins in, nodes gone.
    root.removeEventListener('pointerdown', onDown, true);
    for (const n of seq.nodes) {
      if (n.classList && n.classList.contains('fx-stamp') && !seq.skipped) continue; // lets the stamp fade on its own
      try { n.remove(); } catch (e) { /* ignore */ }
    }
    if (seq.skipped) document.querySelectorAll('#fx-layer .fx-coin, #fx-layer .fx-ring').forEach((n) => n.remove());
    for (const idx of res.cells) {
      if (state().shelf.cells[idx]) continue; // a container landed here since: the final sync draws it
      ui.vis[idx] = null;
      setCell(idx);
    }
    root.querySelectorAll('.sh-cell.is-shimmer').forEach((n) => n.classList.remove('is-shimmer'));
    releaseCoins();
    if (seq.tapped && !seq.counted) {
      seq.counted = true;
      try { ctx.game.act(sim().shelf.skipLine, {}); } catch (e) { /* ignore */ }
    }
    seq.over = true;
    if (ui.seq === seq) ui.seq = null;
    release();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function noteWrongDrop(s) {
  if (!s.stats || typeof s.stats !== 'object') s.stats = {};
  s.stats.wrongDrops = (Number(s.stats.wrongDrops) || 0) + 1;
  return { ok: true };
}
function noteRejectedDrag(s) {
  if (!s.stats || typeof s.stats !== 'object') s.stats = {};
  s.stats.rejectedDrags = (Number(s.stats.rejectedDrags) || 0) + 1;
  return { ok: true };
}

function whisper(toIndex, text) {
  const over = overEl();
  const cell = cellEl(toIndex);
  if (!over || !cell) return;
  const r = relRect(cell);
  const n = document.createElement('div');
  n.className = 'sh-whisper';
  n.textContent = text;
  n.setAttribute('role', 'status');
  over.appendChild(n);
  const w = n.offsetWidth;
  const bw = over.clientWidth;
  const left = Math.max(4, Math.min(bw - w - 4, r.left + r.width / 2 - w / 2));
  n.style.left = `${left}px`;
  n.style.top = `${Math.max(2, r.top - n.offsetHeight - 4)}px`;
  setTimeout(() => n.remove(), 2500);
}

function doMerge(from, to) {
  const st = state();
  const before = snap(st);
  const essBefore = totalEssence(st);
  ui.sel = null;
  ui.hold++;
  ui.lock++;
  const release = once(() => { ui.lock = Math.max(0, ui.lock - 1); });
  const toEl = cellEl(to);
  if (toEl) toEl.setAttribute('data-essence-from', ''); // origin for the app's Essence flight
  const res = ctx.game.act(sim().shelf.merge, { from, to });
  if (!res || !res.ok) {
    if (toEl) toEl.removeAttribute('data-essence-from');
    release();
    endHold();
    return;
  }
  ui.merged = true;
  ctx.game.emit('shelfMerged', { from, to, tier: res.steps[res.steps.length - 1].tier });
  (async () => {
    try {
      await playMerge(from, to, before, res, essBefore);
      if (res.lines) { await wait(TIMING.chain); await playLines(res.lines, release); }
    } catch (e) { console.error('[shelf] merge', e); }
    release();
    const t = cellEl(to);
    if (t) t.removeAttribute('data-essence-from');
    endHold();
  })();
}

function doMove(from, to) {
  const st = state();
  const before = snap(st);
  const a = before[from];
  const b = before[to];
  ui.sel = null;
  if (ui.hold === 0) ui.vis = before.map((c) => (c ? { ...c } : null));
  ui.hold++;
  const release = once(() => { ui.lock = Math.max(0, ui.lock - 1); });
  ui.lock++;
  const res = ctx.game.act(sim().shelf.move, { from, to });
  if (!res || !res.ok) { release(); endHold(); return; }
  ui.vis[to] = a ? { ...a } : null;
  ui.vis[from] = b ? { ...b } : null;
  setCell(from);
  setCell(to);
  audio.tick();
  haptics.light();
  const tv = vialEl(to);
  if (tv) fx.settle(tv);
  // A quiet name label when the two are the same family (or the same color, a different size).
  if (a && b) {
    const nameA = sim().displayName(st, a.color);
    const nameB = sim().displayName(st, b.color);
    if (a.color === b.color && a.tier !== b.tier) whisper(to, `${nameA}: sizes differ, so they swap places`);
    else if (a.color !== b.color && !a.golden && !b.golden && famOf(a.color) === famOf(b.color)) whisper(to, `${nameA} and ${nameB}: same family, different colors`);
  }
  (async () => {
    try {
      if (res.lines) { await wait(TIMING.chain); await playLines(res.lines, release); }
    } catch (e) { console.error('[shelf] move', e); }
    release();
    endHold();
  })();
}

function doSell(i) {
  const st = state();
  const c = st.shelf.cells[i];
  if (!c) return;
  const el = cellEl(i);
  const v = el && el.querySelector('.sh-vial');
  const before = st.coins || 0;
  ui.sel = null;
  ui.hold++;
  const res = ctx.game.act(sim().shelf.sell, { cell: i });
  if (!res || !res.ok) { endHold(); return; }
  updateInfo(state(), ctx.game.now());
  holdCoins(before);
  const end = state().coins || 0;
  const pill = q('[data-ref=coinpill]');
  (async () => {
    try {
      if (v && !fx.isReducedMotion()) anim(v, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6) translateY(-10px)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
      let rolled = false;
      await fx.coinArc(el, pill, 8, { onArrive: (k) => { if (k === 0 && !rolled) { rolled = true; rollCoins(before, end, 360); } } });
      await wait(360);
    } catch (e) { console.error('[shelf] sell', e); }
    releaseCoins();
    endHold();
  })();
}

function tapCell(i) {
  if (ui.lock) return;
  const st = state();
  const cells = st.shelf.cells;
  const c = cells[i];
  if (ui.sel === null) {
    if (c) { ui.sel = i; refresh(true); }
    return;
  }
  if (ui.sel === i) { ui.sel = null; refresh(true); return; }
  const from = ui.sel;
  if (!c) { doMove(from, i); return; }
  if (sim().shelf.canMerge(cells[from], c)) { doMerge(from, i); return; }
  ui.sel = i;
  refresh(true);
}

// ---------------------------------------------------------------------------
// Chips and the chooser sheet
// ---------------------------------------------------------------------------

function openChooser(slot) {
  const st = state();
  const colors = sim().shelf.shelfColors(st);
  const cur = colors[slot];
  ui.sheet = slot;
  const ids = Object.keys(st.catalog?.discovered || {}).sort((a, b) => {
    const fa = FAMILIES.indexOf(famOf(a));
    const fb = FAMILIES.indexOf(famOf(b));
    return fa - fb || String(sim().displayName(st, a)).localeCompare(String(sim().displayName(st, b)));
  });
  const layer = q('[data-ref=layer]');
  layer.hidden = false;
  layer.innerHTML = String(h`<div class="sheet" role="dialog" aria-label="Choose a vial color">
  <div class="center"><div class="h2">${cur ? `New vials: ${sim().displayName(st, cur)}` : 'Add a vial color'}</div><div class="hint">Pick the color for this spot. Containers already on the shelf stay.</div></div>
  <div class="sh-pick">${ids.map((id) => h`<button type="button" class="sh-opt" data-tap data-action="pick-color" data-id="${id}" aria-pressed="${colors.includes(id)}"><span class="sh-sw" style="background:${safeHex(hexOf(id))}">${familyGlyphHtml(famOf(id), 14)}</span><span class="nm">${sim().displayName(st, id)}</span></button>`)}</div>
  ${button('Use the usual mix', { block: true, attrs: { 'data-action': 'reset-colors' } })}
</div>`);
}

function closeSheet() {
  ui.sheet = null;
  const layer = root && q('[data-ref=layer]');
  if (layer) { layer.hidden = true; layer.innerHTML = ''; }
}

function pickColor(id) {
  const st = state();
  const colors = [...sim().shelf.shelfColors(st)];
  const slot = ui.sheet === null ? colors.length : ui.sheet;
  const j = colors.indexOf(id);
  const old = colors[slot];
  if (j >= 0 && j !== slot) {
    if (old) colors[j] = old; else colors.splice(j, 1);
  }
  if (slot < colors.length) colors[Math.min(slot, colors.length - 1)] = id; else colors.push(id);
  ctx.game.act(sim().shelf.setShelfColors, { colors: [...new Set(colors)] });
  closeSheet();
  ui.chipSig = '';
  refresh(true);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onClick(e) {
  const cell = e.target.closest('.sh-cell');
  if (cell && root.contains(cell)) {
    const i = +cell.dataset.cell;
    const has = !!state().shelf.cells[i];
    if (has && e.detail !== 0) return; // pointer taps on containers arrive through fx.drag's onTap
    tapCell(i);
    return;
  }
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  if (a === 'close-sheet') { if (e.target === t) closeSheet(); return; }
  if (a === 'chip') { openChooser(+t.dataset.slot); return; }
  if (a === 'pick-color') { pickColor(t.dataset.id); return; }
  if (a === 'reset-colors') {
    ctx.game.act(sim().shelf.setShelfColors, { colors: [] });
    closeSheet();
    ui.chipSig = '';
    refresh(true);
    return;
  }
  if (a === 'done') { ui.sel = null; refresh(true); return; }
  if (a === 'sell') { if (ui.sel !== null && !ui.lock) doSell(ui.sel); }
}

function onKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest && e.target.closest('.sh-cell');
  if (!cell) return;
  e.preventDefault();
  tapCell(+cell.dataset.cell);
}

// ---------------------------------------------------------------------------
// Drag (fx.drag does the work; this screen adds the preview and the drop)
// ---------------------------------------------------------------------------

function clearPreview() {
  if (!root) return;
  root.querySelectorAll('.sh-cell.is-target,.sh-cell.is-partner,.sh-cell.is-guide').forEach((n) => {
    n.classList.remove('is-target', 'is-mergeable', 'is-partner', 'is-guide');
    n.style.removeProperty('--fam');
  });
}

/** Cells where dropping `from`'s container would complete a family line, with the family. */
export function lineGuides(cells, from, findLines, canMerge) {
  const a = cells[from];
  const out = new Map();
  if (!a) return out;
  for (let e = 0; e < cells.length; e++) {
    if (e === from) continue;
    const b = cells[e];
    if (b && canMerge(a, b)) continue; // that drop merges
    const sim2 = cells.map((c) => (c ? { ...c } : null));
    sim2[e] = { ...a };
    sim2[from] = b ? { ...b } : null;
    const found = findLines({ shelf: { cols: COLS, rows: ROWS, cells: sim2 } });
    if (found.length) out.set(e, found[0].family);
  }
  return out;
}

function onDragStart(info) {
  ui.dragMoved = true;
  if (ui.sel !== null) { ui.sel = null; ui.rowSig = ''; updateInfo(state(), ctx.game.now()); }
  const st = state();
  const cells = st.shelf.cells;
  const from = info.from;
  const board = q('[data-ref=board]');
  board.querySelectorAll('.pulse').forEach((n) => n.classList.remove('pulse'));
  for (let i = 0; i < N; i++) {
    if (i !== from && cells[i] && sim().shelf.canMerge(cells[from], cells[i])) {
      const el = cellEl(i);
      if (el) el.classList.add('is-partner');
    }
  }
  const guides = lineGuides(cells, from, sim().shelf.findLines, sim().shelf.canMerge);
  for (const [i, fam] of guides) {
    const el = cellEl(i);
    if (!el) continue;
    el.classList.add('is-guide');
    el.style.setProperty('--fam', FAMILY_HEX[fam] || '#fff');
  }
}

function onDragMove(to, info) {
  root.querySelectorAll('.sh-cell.is-target').forEach((n) => n.classList.remove('is-target', 'is-mergeable'));
  if (to < 0 || to === info.from) return;
  const cells = state().shelf.cells;
  const el = cellEl(to);
  if (!el) return;
  el.classList.add('is-target');
  if (sim().shelf.canMerge(cells[info.from], cells[to])) el.classList.add('is-mergeable');
}

function onDragDrop(to, info) {
  const from = info.from;
  ui.dragMoved = false;
  clearPreview();
  if (to < 0) { ctx.game.act(noteWrongDrop, {}); refresh(true); return; }
  if (to === from) { refresh(true); return; }
  const cells = state().shelf.cells;
  if (!cells[from]) { refresh(true); return; }
  const target = cells[to];
  if (target && sim().shelf.canMerge(cells[from], target)) doMerge(from, to);
  else doMove(from, to);
}

function onDragCancel() {
  clearPreview();
  const moved = ui.dragMoved;
  ui.dragMoved = false;
  if (moved && !ui.quiet) ctx.game.act(noteRejectedDrag, {});
  refresh(true);
}

function onDragTap(info) {
  tapCell(info.from);
}

// ---------------------------------------------------------------------------
// First open: seed, migration note, guides
// ---------------------------------------------------------------------------

const num = (x) => (Number.isFinite(x) ? x : 0);

function seedIfNeeded() {
  const st = state();
  if (!sim().shelf.unlocked(st)) return;
  const seen = (st.onboarding && st.onboarding.seen) || {};
  if (seen.shelf || seen.shelfSeeded) return;
  if (st.shelf.cells.filter(Boolean).length >= 2) return;
  const colorId = sim().shelf.shelfColors(st)[0];
  if (!colorId) return;
  const bottom = Array.from({ length: COLS }, (_, c) => (ROWS - 1) * COLS + c).filter((i) => !st.shelf.cells[i]);
  const prefer = [31, 34].filter((i) => bottom.includes(i));
  const spots = [...prefer, ...bottom.filter((i) => !prefer.includes(i))].slice(0, 2);
  if (spots.length < 2) return;
  for (const cell of spots) ctx.game.act(sim().shelf.addVial, { colorId, tier: 1, cell });
  ctx.game.act(markGuideSeen, { id: 'shelfSeeded' });
  ctx.game.act(markGuideSeen, { id: 'shelfRules' }); // a new player is taught the rules by the coach
}

function firstOpenNotes(hadContainers) {
  const st = state();
  const seen = (st.onboarding && st.onboarding.seen) || {};
  if (seen.shelfRules || !hadContainers) return;
  const veteran = (st.flags && st.flags.whatsNew === '0.2') || num(st.stats && st.stats.firstBottleAt) > 0;
  if (seen.shelf || veteran) {
    ctx.toast('The shelf is now 6 by 6. Six of a family in a line sell together.', { ms: 6500 });
    if (!seen.shelf) ctx.game.act(markGuideSeen, { id: 'shelf' }); // she knows how to merge: no first-merge coach
  }
  ctx.game.act(markGuideSeen, { id: 'shelfRules' });
}

function startGuides() {
  for (const g of ui.guides) { try { g.stop(); } catch (e) { /* ignore */ } }
  ui.guides = [];
  if (typeof ctx.guide !== 'function') return;
  const opts = { screen: 'shelf' };
  const familyOf = (id) => famOf(id);
  ui.guides.push(ctx.guide('shelf', [
    { anchor: '[data-coach="shelf-first"]', text: 'Drag a vial onto its twin.', endsOn: 'action', event: 'shelfMerged' },
    { anchor: '[data-coach="shelf-chips"]', text: 'Six of one color family in a row or column sell together.', endsOn: 'got-it', side: 'above', when: () => ui.merged },
  ], opts));
  ui.guides.push(ctx.guide('shelfCols', [
    { anchor: '[data-coach="shelf-chips"]', text: 'A column of six sells the same way.', endsOn: 'got-it', side: 'above', when: () => hasFive(snap(state()), 'col', familyOf) },
  ], opts));
  ui.guides.push(ctx.guide('shelfDiags', [
    { anchor: '[data-coach="shelf-chips"]', text: 'Corner to corner counts as a line too.', endsOn: 'got-it', side: 'above', when: () => hasFive(snap(state()), 'diag', familyOf) },
  ], opts));
  setTimeout(() => { for (const g of ui.guides) { try { g.start(); } catch (e) { console.error(e); } } }, 320);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function stopEverything({ quiet = true } = {}) {
  ui.quiet = quiet;
  if (ui.seq) endSeq(ui.seq);
  if (dragH) dragH.cancel();
  ui.quiet = false;
  clearPreview();
}

function onResize() {
  if (!root || !ui.skeleton || root.hidden) return;
  if (ui.hold > 0 || (dragH && dragH.active)) return;
  layout();
  refresh(true);
}

const screen = {
  id: 'shelf',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    fx = ctx.fx || fxDefault;
    audio = ctx.audio || audioDefault;
    haptics = ctx.haptics || hapticsDefault;
    injectCss();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.sh-cell')) e.preventDefault(); });
    // "How this works" replays the coach from its first step.
    root.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-guide-replay]');
      if (b) ui.merged = false;
    });
    dragH = fx.drag(root, {
      handle: '.sh-cell.has-item',
      board: () => fx.measureGrid([...root.querySelectorAll('.sh-cell')], COLS, { pad: BPAD }),
      magnet: (i, from) => (sim().shelf.canMerge(state().shelf.cells[from], state().shelf.cells[i]) ? 1 : 0),
      liftEl: (src) => src.querySelector('.sh-vial'),
      canStart: (src) => !ui.lock && !!state().shelf.cells[+src.dataset.cell],
      onStart: onDragStart,
      onMove: onDragMove,
      onDrop: onDragDrop,
      onTap: onDragTap,
      onCancel: onDragCancel,
    });
    window.addEventListener('resize', onResize);
  },

  show() {
    stopEverything();
    ui.epoch++;
    ui.sel = null;
    ui.hold = 0;
    ui.lock = 0;
    ui.coinLocks = 0;
    ui.merged = false;
    ui.seq = null;
    skeleton();
    const hadContainers = state().shelf.cells.some(Boolean);
    seedIfNeeded();
    firstOpenNotes(hadContainers);
    refresh(true);
    requestAnimationFrame(() => { if (ui.skeleton && ui.hold === 0) refresh(true); });
    startGuides();
  },

  hide() {
    stopEverything();
    for (const g of ui.guides) { try { g.stop(); } catch (e) { /* ignore */ } }
    closeSheet();
  },

  render() {
    refresh(false);
  },

  reveal() {
    refresh(true);
  },
};

export default screen;
export const mount = screen.mount;
