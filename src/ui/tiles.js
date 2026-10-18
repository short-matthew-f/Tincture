/**
 * tiles.js: the Tile Room (overlay `tiles`, fullscreen, home tab Puzzles).
 * Implements docs/PLAN-v0.3.md "Tile Room", ported from proto/tiles/ with
 * every fix from docs/UX-AUDIT-proto-crafts.md §1 (T1–T9).
 *
 * Owns: the dishes and the middle, her pattern lines and wall, the seconds
 * basket, Ida from the pottery next door, the glaze picker before a new wall
 * (five of her discovered colors, one per hue family, glyphs always on), the
 * end-of-wall summary, her finished mosaics, and the bottom action bar that
 * always holds the one next step: Ida's turn / Score the round / Deal round N
 * / Finish the round / Seconds basket / Start the wall / Start a new wall.
 *
 * Rules: src/puzzles/tiles.js (pure). Every step is a sim action in
 * src/sim/tiles.js run through ctx.game.act, so it is saved at once and a
 * reload resumes exactly (state.tiles.pending says Ida's turn or the scoring
 * is owed; the bar offers it, and it also runs by itself after a short pause,
 * as in the playtested prototype).
 *
 * Feel: a taken group flies (arc, lift, settle) to its line or the basket and
 * the rest slide to the middle; Ida's dish glows lilac before she takes it;
 * when the round is scored each tile flies from its line into the wall, a
 * "+N" floats up and the score rolls; coins arc to the coin chip; a finished
 * wall gets an ink stamp. Reduced motion turns every flight into a short fade.
 *
 * Never locked: `busy` is set only inside try/finally, a failed animation
 * settles the rules state without it, flying tiles are always removed, and a
 * tap that lands on tiles Ida just took selects nothing and says so (T1).
 * Wrong taps are never red: a line that cannot take the glaze simply does not
 * glow.
 */

import { h, raw, backButton, escapeHtml } from './kit.js';
import { injectStyle, coinsText, lightnessOf } from './puzzles.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';

const GLYPH_SVG = {
  dot: '<circle cx="12" cy="12" r="4.8"/>',
  diamond: '<path d="M12 5 19 12 12 19 5 12z"/>',
  ring: '<circle cx="12" cy="12" r="5.4" style="fill:none;stroke:var(--gl);stroke-width:2.6"/>',
  leaf: '<path d="M6 18C5.5 10 10.5 5.5 18.5 5.8 18.8 13.5 14 18.6 6 18z"/><path d="M7 17.2 14 10" style="stroke:rgba(0,0,0,.35);stroke-width:1.2;fill:none;stroke-linecap:round"/>',
  wave: '<path d="M4.5 12.5c2.2-4 4-4 6 0s3.8 4 6 0c.9-1.6 1.8-2.4 3-2.8" style="fill:none;stroke:var(--gl);stroke-width:2.6;stroke-linecap:round"/>',
};
const FAMILY_LABEL = {
  red: 'Reds', orange: 'Oranges', yellow: 'Yellows', green: 'Greens', teal: 'Teals', blue: 'Blues',
  violet: 'Violets', pink: 'Pinks', neutral: 'Neutrals',
};
const FAMILY_ORDER = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'];
const IDA_PAUSE_MS = 2300;
const MOSAICS_SHOWN = 8;

const IDA_FACE = `<svg class="tl-face" data-ida-face viewBox="0 0 44 44" role="img" aria-label="Ida from the pottery next door">
<rect width="44" height="44" fill="#F3E3B8"/><path d="M6 44c1-9 8-13 16-13s15 4 16 13z" fill="#3E6A9E"/>
<circle cx="22" cy="20" r="9" fill="#E8C3A0"/><path d="M12 21c-1-10 6-14 11-14 7 0 11 5 9 14-2-5-4-8-10-8s-8 3-10 8z" fill="#8C6512"/>
<circle cx="18.5" cy="20.5" r="1.1" fill="#2A2622"/><circle cx="25.5" cy="20.5" r="1.1" fill="#2A2622"/>
<path d="M18.5 24.5q3.5 3 7 0" stroke="#2A2622" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

const IDA_LINES = [
  (r, n) => `Dish ${r.dish + 1} had ${r.tiles} ${n}. Lovely, I will take those.`,
  (r, n, g) => `Ooh, ${n} ${g}s. They will sell nicely next door.`,
  (r, n) => `I could not resist the ${n} on dish ${r.dish + 1}.`,
  (r, n) => `${r.tiles} ${n} in one place. That is my kind of dish.`,
];

const CSS = `
#screen-tiles { --t: clamp(26px, calc((min(100vw, 520px) - 88px) / 10), 40px); --pitch: calc(var(--t) + 7px); }
#screen-tiles .tl-head .titles { min-width: 0; }
#screen-tiles .how-link { flex: 0 0 auto; min-width: 44px; max-width: 72px; min-height: 44px; padding: 0 2px; white-space: normal; text-align: center; line-height: 1.15; font-size: 12px; font-weight: 600; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
#screen-tiles .tl-body { gap: 10px; padding-bottom: 16px; }
.tl-top { display: flex; align-items: center; gap: 10px; }
.tl-score { display: flex; align-items: baseline; gap: 6px; }
.tl-score b { font: 400 36px/1 var(--font-display); font-variant-numeric: tabular-nums; min-width: 1ch; }
.tl-score small { color: var(--ink-soft); font-size: 13px; }
.tl-round { font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
.tl-coins { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: var(--paper); box-shadow: var(--cut-sm); font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
.tl-coins i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
.tl-face { width: 44px; height: 44px; border-radius: 50%; flex: none; overflow: hidden; box-shadow: var(--cut-sm); }
.tl-ida { display: flex; gap: 8px; align-items: center; }
.tl-ida p { flex: 1; font-size: 13px; line-height: 1.35; color: var(--ink-soft); background: var(--paper); border-radius: 12px; padding: 8px 10px; min-height: 3.1em; box-shadow: var(--cut-sm); }
.tl-card { padding: 8px; gap: 6px; }
.tl-cap { margin: 0 0 4px 2px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }

.tl-tile { --s: 44px; --gl: rgba(255,250,235,.92); position: relative; flex: none; width: var(--s); height: var(--s); margin: 0; padding: 0; border: 0; border-radius: 24%;
  background: linear-gradient(150deg, color-mix(in srgb, var(--b) 72%, #fff) 0%, var(--b) 48%, color-mix(in srgb, var(--b) 80%, #000) 100%);
  box-shadow: inset 0 1.5px 0 rgba(255,255,255,.5), inset 0 -2px 0 rgba(0,0,0,.24), inset 0 0 0 1px rgba(0,0,0,.14), 0 1.5px 1.5px rgba(42,38,34,.35);
  display: inline-grid; place-items: center; touch-action: manipulation; transition: transform .16s ease, box-shadow .16s ease; }
.tl-tile::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(120% 90% at 22% 12%, rgba(255,255,255,.38), rgba(255,255,255,0) 52%); }
.tl-tile svg { width: 58%; height: 58%; fill: var(--gl); stroke: none; position: relative; z-index: 1; filter: drop-shadow(0 .5px 0 rgba(0,0,0,.25)); pointer-events: none; }
.tl-c0 { --b: var(--g0); --gl: var(--gl0); } .tl-c1 { --b: var(--g1); --gl: var(--gl1); } .tl-c2 { --b: var(--g2); --gl: var(--gl2); }
.tl-c3 { --b: var(--g3); --gl: var(--gl3); } .tl-c4 { --b: var(--g4); --gl: var(--gl4); }
button.tl-tile { cursor: pointer; }
.tl-tile.is-sel { transform: translateY(-4px) scale(1.06); z-index: 2; box-shadow: inset 0 1.5px 0 rgba(255,255,255,.5), inset 0 -2px 0 rgba(0,0,0,.24), 0 0 0 2.5px var(--gold), 0 9px 10px rgba(42,38,34,.28); }
.tl-tile.is-ghost { opacity: .2; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
.tl-tile.is-ghost::after { display: none; }
#tl-fly { position: fixed; inset: 0; pointer-events: none; z-index: 60; }
#tl-fly .tl-tile { position: fixed; margin: 0; transition: none; }
#tl-fly .tl-pop { position: fixed; font: 400 20px var(--font-display); color: var(--gold-deep); text-shadow: 0 1px 0 #fff8; }

.tl-dishes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 4px; justify-items: center; }
.tl-dish { position: relative; display: grid; grid-template-columns: 44px 44px; grid-auto-rows: 44px; gap: 3px; padding: 5px; width: 100px; height: 100px; align-content: center; justify-content: center;
  border-radius: 30px; background: radial-gradient(circle at 35% 30%, #fffdf6, #EFE6D2 70%, #E2D6BB); box-shadow: inset 0 0 0 1px rgba(42,38,34,.12), var(--cut-sm); }
.tl-dish.is-empty { opacity: .5; box-shadow: inset 0 0 0 1px rgba(42,38,34,.12); }
.tl-dish.is-ida { box-shadow: inset 0 0 0 2.5px #C9A8D8, 0 0 0 4px rgba(201,168,216,.35), var(--cut-sm); }
.tl-dn { position: absolute; left: -3px; top: -3px; width: 18px; height: 18px; border-radius: 50%; background: var(--paper); box-shadow: 0 0 0 1px rgba(42,38,34,.15); display: grid; place-items: center; z-index: 3; font-size: 10px; color: var(--ink-soft); font-weight: 700; pointer-events: none; }
.tl-stock { align-self: center; justify-self: start; padding-left: 8px; font-size: 12px; color: var(--ink-soft); line-height: 1.6; }
.tl-stock b { color: var(--ink); font-weight: 600; }
.tl-center { display: flex; flex-wrap: wrap; gap: 3px; min-height: 52px; align-items: center; padding: 4px; border-radius: 12px; background: rgba(42,38,34,.045); }

.tl-board { display: flex; justify-content: center; gap: 12px; }
.tl-col { display: flex; flex-direction: column; }
.tl-lines { display: flex; flex-direction: column; }
.tl-line { position: relative; display: flex; justify-content: flex-end; align-items: center; gap: 3px; height: var(--pitch); padding: 0 2px; border-radius: 10px; width: calc(var(--t) * 5 + 16px); background: none; touch-action: manipulation; }
.tl-line::after { content: ''; position: absolute; left: 0; right: 0; top: -2px; bottom: -2px; }
.tl-line.is-ok { background: rgba(226,176,74,.26); box-shadow: 0 0 0 2px var(--gold); z-index: 1; }
.tl-line.is-no { opacity: .5; }
.tl-slot { width: var(--t); height: var(--t); border-radius: 24%; background: rgba(42,38,34,.07); box-shadow: inset 0 0 0 1.5px rgba(42,38,34,.12); display: grid; place-items: center; }
.tl-slot .tl-tile, .tl-cell .tl-tile { --s: var(--t); }
.tl-wall { display: grid; grid-template-columns: repeat(5, var(--t)); gap: 7px 3px; padding: 3.5px 0; }
.tl-cell { width: var(--t); height: var(--t); }

.tl-basket { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; padding: 8px 10px; border-radius: 14px; background: var(--paper); box-shadow: var(--cut); text-align: left; touch-action: manipulation; }
.tl-basket.is-ok { box-shadow: 0 0 0 2.5px var(--gold), var(--cut); background: #FBF0D4; }
.tl-basket .t { flex: 1; min-width: 0; }
.tl-basket strong { display: block; font-size: 13px; }
.tl-basket .t > span { font-size: 12px; color: var(--ink-soft); }
.tl-secs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; min-height: 8px; }
.tl-secs .tl-tile { --s: 24px; border-radius: 22%; }
.tl-secval { font: 400 22px var(--font-display); color: var(--gold-deep); }

.tl-foot { display: flex; gap: 8px; flex-wrap: wrap; }
.tl-foot .btn { min-height: 44px; }
.tl-sum { text-align: center; padding: 14px; gap: 6px; }
.tl-sum h2 { font: 400 22px var(--font-display); }
.tl-sumwall { display: flex; justify-content: center; margin: 8px 0; }
.tl-wall.is-big { --t: min(52px, calc((min(100vw, 520px) - 32px - 28px - 4 * 7px - 24px) / 5)); gap: 7px; padding: 12px; border-radius: 16px; background: linear-gradient(160deg, #E8DCC0, #D9CAA6); box-shadow: inset 0 0 0 2px rgba(107,74,50,.3), var(--cut); }
.tl-wall.is-big .tl-tile { --s: var(--t); }
.tl-wall.is-big .is-ghost { opacity: .12; }
.tl-break { text-align: left; }
.tl-break li { display: flex; justify-content: space-between; padding: 8px 2px; border-top: 1px solid rgba(42,38,34,.12); font-size: 14px; }
.tl-break b { color: var(--gold-deep); }
.tl-total { font: 400 40px/1 var(--font-display); margin-top: 6px; }

.tl-pick { gap: 10px; }
.tl-slots { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.tl-pslot { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px; border-radius: 12px; min-height: 44px; background: none; }
.tl-pslot.is-on { background: var(--glow); box-shadow: 0 0 0 2px var(--glow-ring); }
.tl-pslot .tl-tile { --s: 44px; }
.tl-pslot span { font-size: 11px; line-height: 1.15; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tl-fam { display: flex; flex-direction: column; gap: 4px; }
.tl-fam .row { display: flex; flex-wrap: wrap; gap: 6px; }
.tl-sw { width: 44px; height: 44px; border-radius: 12px; box-shadow: var(--cut-sm), inset 0 0 0 1px rgba(42,38,34,.12); position: relative; touch-action: manipulation; }
.tl-sw.is-in::after { content: ''; position: absolute; inset: -4px; border-radius: 15px; box-shadow: 0 0 0 2.5px var(--ink); }
.tl-mosaics { gap: 8px; }
.tl-mlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
.tl-m { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; color: var(--ink-soft); }
.tl-m b { color: var(--ink); font-size: 14px; }
.tl-mini { display: grid; grid-template-columns: repeat(5, 12px); gap: 2px; padding: 5px; border-radius: 8px; background: linear-gradient(160deg, #E8DCC0, #D9CAA6); box-shadow: inset 0 0 0 1px rgba(107,74,50,.3), var(--cut-sm); }
.tl-mini i { width: 12px; height: 12px; border-radius: 3px; }
.tl-mini i.is-ghost { opacity: .15; }
.tl-rules { font-size: 14px; color: var(--ink-soft); }
.tl-rules summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 600; color: var(--ink); }
.tl-rules ol { list-style: decimal; padding-left: 20px; line-height: 1.5; display: flex; flex-direction: column; gap: 4px; }

.tl-bar { flex: 0 0 auto; position: relative; z-index: 6; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; min-height: 64px;
  padding: 10px var(--gutter) calc(10px + var(--safe-bottom)); background: rgba(251,248,241,.98); box-shadow: 0 -3px 0 rgba(42,38,34,.08), 0 -8px 24px rgba(42,38,34,.08); }
.tl-bar .msg { flex: 1 1 190px; font-size: 14px; line-height: 1.3; font-weight: 500; }
.tl-bar .btn { min-height: 44px; flex: 0 0 auto; }
.tl-bar .btn-primary { min-height: 48px; }
@media (max-width: 420px) { .tl-bar .msg { flex-basis: 100%; } }
@media (prefers-reduced-motion: reduce) { .tl-tile { transition: none; } }
html[data-motion="reduced"] .tl-tile { transition: none; }
`;

let C = null;
let ROOT = null;
const U = {
  visible: false, busy: false, sel: null, timer: 0, idaMsg: '', busyMsg: '', note: '', view: 'play',
  pick: null, confirmNew: 0, guide: null, sig: '', el: {}, lastCoins: null, gen: 0,
};

const R = () => C.puzzles.tiles;
const T = () => C.sim.tiles;
const S = () => C.game.state;
const G = () => (S().tiles && S().tiles.game) || null;
const reduced = () => !!(C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
const $ = (sel) => (ROOT ? ROOT.querySelector(sel) : null);
const $$ = (sel, root = ROOT) => (root ? [...root.querySelectorAll(sel)] : []);
const esc = (s) => escapeHtml(String(s ?? ''));
const rectOf = (el) => el.getBoundingClientRect();

// ---------------------------------------------------------------------------
// Colors and tiles
// ---------------------------------------------------------------------------

function colorsOf(g) {
  return (g && Array.isArray(g.colors) && g.colors.length === 5) ? g.colors : T().gameColors(S());
}
const nameOf = (id) => safe(() => C.sim.displayName(S(), id)) || id;
const hexOf = (id) => safe(() => C.sim.economy.colorHex(id)) || '#B7BDB3';
const glyphName = (c) => R().GLYPHS[c];
const label = (c, ids) => `${nameOf(ids[c])} ${glyphName(c)}`;

/** Sets --g0..--g4 (glaze) and --gl0..--gl4 (glyph ink, dark on light glazes) on the screen. */
function applyGlazes(ids) {
  if (!ROOT) return;
  ids.forEach((id, i) => {
    const hex = hexOf(id);
    ROOT.style.setProperty(`--g${i}`, hex);
    ROOT.style.setProperty(`--gl${i}`, lightnessOf(C, hex) > 0.72 ? 'rgba(42,38,34,.72)' : 'rgba(255,250,235,.92)');
  });
  const fly = flyLayer();
  if (fly) for (let i = 0; i < 5; i++) {
    fly.style.setProperty(`--g${i}`, ROOT.style.getPropertyValue(`--g${i}`));
    fly.style.setProperty(`--gl${i}`, ROOT.style.getPropertyValue(`--gl${i}`));
  }
}

const glyphSvg = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH_SVG[glyphName(c)]}</svg>`;

function tile(c, { tag = 'span', cls = '', attrs = '' } = {}) {
  const t = tag === 'button' ? ' type="button" data-tap' : '';
  return `<${tag}${t} class="tl-tile tl-c${c} ${cls}" data-c="${c}" ${attrs}>${glyphSvg(c)}</${tag}>`;
}

function wallHtml(g, cls = '') {
  let out = `<div class="tl-wall ${cls}" role="img" aria-label="Wall mosaic, ${R().wallCount(g)} of 25 tiles set">`;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const k = R().wallColor(r, c);
    out += `<div class="tl-cell" data-r="${r}" data-col="${c}">${tile(k, { cls: g.wall[r][c] ? 'is-set' : 'is-ghost' })}</div>`;
  }
  return `${out}</div>`;
}

/** A small mosaic: 25 squares in the five glazes (ghosts where no tile was set). */
export function miniWallHtml(ctx, colors, wall) {
  const hex = (id) => safe(() => ctx.sim.economy.colorHex(id)) || '#B7BDB3';
  let out = '<div class="tl-mini" aria-hidden="true">';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const k = (((c - r) % 5) + 5) % 5;
    const on = typeof wall === 'string' ? wall[r * 5 + c] === '1' : !!(wall && wall[r] && wall[r][c]);
    out += `<i class="${on ? '' : 'is-ghost'}" style="background:${hex(colors[k])}"></i>`;
  }
  return `${out}</div>`;
}

// ---------------------------------------------------------------------------
// Fly layer and small effects (all honor reduced motion)
// ---------------------------------------------------------------------------

function flyLayer() {
  if (typeof document === 'undefined') return null;
  let l = document.getElementById('tl-fly');
  if (!l) {
    l = document.createElement('div');
    l.id = 'tl-fly';
    l.setAttribute('aria-hidden', 'true');
    document.body.appendChild(l);
  }
  return l;
}

function clearFlies() {
  const l = flyLayer();
  if (l) l.innerHTML = '';
}

function settle(el) {
  if (!el || reduced() || typeof el.animate !== 'function') return;
  safe(() => el.animate([{ transform: 'scale(1.14)' }, { transform: 'scale(.95)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }));
}

/** Fly a glazed tile from a DOMRect to an element (or rect). Resolves on landing. */
async function fly({ from, c, toEl, toRect, delay = 0, fade = false, onLand }) {
  const layer = flyLayer();
  if (!layer || !from || !U.visible) { if (onLand) onLand(); return; }
  const to = toRect || (toEl ? rectOf(toEl) : null);
  if (!to) { if (onLand) onLand(); return; }
  if (toEl) toEl.style.visibility = 'hidden';
  const el = document.createElement('div');
  el.className = `tl-tile tl-c${c}`;
  el.innerHTML = glyphSvg(c);
  Object.assign(el.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  layer.append(el);
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  const sc = from.width > 0 ? to.width / from.width : 1;
  const dist = Math.hypot(dx, dy);
  let anim = null;
  try {
    if (reduced()) {
      Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
      anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay, fill: 'backwards' });
    } else {
      const frames = [];
      const N = 12;
      const arc = Math.min(70, 18 + dist * 0.22);
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const lift = Math.sin(Math.PI * t);
        frames.push({
          transform: `translate(${dx * e}px, ${dy * e - arc * lift}px) scale(${1 + (sc - 1) * e + 0.08 * lift})`,
          filter: `drop-shadow(0 ${2 + 9 * lift}px ${2 + 8 * lift}px rgba(42,38,34,${0.2 + 0.15 * lift}))`,
          opacity: fade && t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1,
        });
      }
      anim = el.animate(frames, { duration: Math.min(780, 380 + dist * 0.38), delay, easing: 'linear', fill: 'both' });
    }
    await anim.finished.catch(() => {});
  } finally {
    el.remove();
    if (toEl) { toEl.style.visibility = ''; settle(toEl); }
  }
  if (onLand) onLand();
}

function stagger(list, step = 70) {
  return Promise.all(list.map((m, i) => fly({ ...m, delay: reduced() ? 0 : i * step })));
}

function floatText(rect, text) {
  const layer = flyLayer();
  if (!layer || reduced() || !rect || !U.visible) return;
  const el = document.createElement('div');
  el.className = 'tl-pop';
  el.textContent = text;
  Object.assign(el.style, { left: `${rect.left + rect.width / 2}px`, top: `${rect.top}px` });
  layer.append(el);
  const done = () => el.remove();
  safe(() => el.animate([{ opacity: 0, transform: 'translate(-50%,0)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'translate(-50%,-26px)' }], { duration: 900, easing: 'ease-out' }).finished.then(done, done));
  setTimeout(done, 1200);
}

/** Score roll with the progress clamped to [0, 1] (audit T9: fx.rollNumber clamps). */
function rollScore(from, to) {
  const el = $('[data-score]');
  if (!el) return Promise.resolve();
  return C.fx.rollNumber(el, from, to, { ms: 450, format: (v) => String(Math.round(v)) });
}

/** New center tiles per color, matched to the last N buttons of that color. */
function centerTargets(beforeCenter) {
  const g = G();
  const out = [];
  const have = [0, 0, 0, 0, 0];
  const was = [0, 0, 0, 0, 0];
  g.center.forEach((c) => { have[c] += 1; });
  beforeCenter.forEach((c) => { was[c] += 1; });
  const els = $$('[data-center] .tl-tile');
  for (let c = 0; c < 5; c++) {
    const n = have[c] - was[c];
    const mine = els.filter((e) => +e.dataset.c === c);
    for (let i = 0; i < n; i++) if (mine[mine.length - 1 - i]) out.push(mine[mine.length - 1 - i]);
  }
  return out;
}

function claimTarget(list, c) {
  const t = list.find((x) => +x.dataset.c === c && !x.__used);
  if (t) t.__used = true;
  return t || null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function unlocked() {
  return !!safe(() => T().unlocked(S()));
}

function skeleton() {
  const g = G();
  const how = C.guide && C.guide.howThisWorksHtml ? C.guide.howThisWorksHtml('tiles') : '';
  if (!unlocked()) {
    ROOT.innerHTML = String(h`<div class="screen-head tl-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Tile Room</div><div class="subtitle">Glazed tiles and a mosaic wall</div></div><div class="spacer"></div></div>
<div class="screen-body tl-body"><div class="card tl-card" style="padding:16px;gap:10px">
<div class="h3">The kiln is waiting</div>
<p class="hint">Glaze tiles in your own colors, draft them from the dishes and set them into a mosaic wall. Ida from the pottery next door plays along, if you like.</p>
<div data-lock>${unlockTag(C, 'tiles', { cls: 'pz-tag' })}</div></div></div>`);
    U.el = {};
    return;
  }
  ROOT.innerHTML = `<div class="screen-head tl-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Tile Room</div><div class="subtitle" data-subtitle></div></div>${how}</div>
<div class="screen-body tl-body" data-body>
<div class="tl-top"><div class="tl-score"><b data-score aria-live="polite">0</b><small>points</small></div><span class="tl-round" data-round></span><span class="tl-coins" data-coins-chip aria-label="Coins"><i></i><span data-coins>0</span></span></div>
<div class="tl-ida" data-ida data-coach="tiles-ida">${IDA_FACE}<p data-ida-msg aria-live="polite"></p></div>
<div data-play>
<section class="card tl-card" aria-label="Dishes" data-coach="tiles-dishes"><div class="tl-dishes" data-dishes></div><p class="tl-cap" style="margin-top:6px">The middle</p><div class="tl-center" data-center></div></section>
<section class="card tl-card" aria-label="Your board"><div class="tl-board"><div class="tl-col"><p class="tl-cap">Pattern lines</p><div class="tl-lines" data-lines data-coach="tiles-lines"></div></div><div class="tl-col"><p class="tl-cap">Wall</p><div data-wall></div></div></div></section>
<button type="button" class="tl-basket" data-basket data-tap aria-label="Seconds basket"><div class="t"><strong>Seconds basket</strong><span>+1 point each, sold as seconds</span><div class="tl-secs" data-secs></div></div><span class="tl-secval" data-secval>+0</span></button>
</div>
<div data-summary hidden></div>
<div data-picker hidden></div>
<div class="tl-foot" data-foot></div>
<div data-mosaics></div>
<details class="tl-rules"><summary>How the Tile Room works</summary><ol>
<li>Tap a tile in a dish: you take every tile of that glaze. The others slide to the middle. You can also take a glaze from the middle.</li>
<li>Choose a pattern line. A line holds one glaze, and not one already on that row of your wall.</li>
<li>Extra tiles go to the seconds basket and sell for +1 point each.</li>
<li>Ida next door takes a dish after each of your turns (most tiles of one glaze, ties go left) and sells them.</li>
<li>When the dishes are empty, full lines set one tile on the wall and score by their neighbors. Then tap <b>Deal round</b> in the bar. Finishing a wall row finishes the wall.</li>
<li>Points pay coins as they are scored, and a finished wall pays a little extra.</li>
</ol></details>
</div>
<div class="tl-bar" data-bar data-coach="tiles-bar"></div>`;
  U.el = { body: $('[data-body]') };
  applyGlazes(colorsOf(g));
}

function sourceCount() {
  const g = G();
  const src = U.sel.source === 'center' ? g.center : g.dishes[U.sel.index] || [];
  return src.filter((c) => c === U.sel.color).length;
}

function hintFor(ids) {
  if (!U.sel) return 'Tap a glaze in a dish or the middle to take every tile of it.';
  const legal = R().legalLines(G(), U.sel.color);
  const nm = `${sourceCount()} ${nameOf(ids[U.sel.color])}`;
  if (!legal.length) return `${nm}: these go to the seconds basket. Tap the basket.`;
  return `${nm}: tap a glowing pattern line, or the basket for seconds.`;
}

function renderBar() {
  const bar = $('[data-bar]');
  if (!bar) return;
  const st = S();
  const g = G();
  const t = st.tiles || {};
  const ids = colorsOf(g);
  let msg = '';
  let act = '';
  let undo = '';
  if (U.view === 'pick') {
    const playing = g && !g.over;
    msg = U.note || 'Five glazes, one from each family. Ready when you are.';
    act = `${playing ? '<button type="button" class="btn btn-paper" data-action="pick-cancel" data-tap>Keep playing</button>' : ''}<button type="button" class="btn btn-primary" data-action="start" data-tap>${playing ? 'Start over with these' : 'Start the wall'}</button>`;
  } else if (!g) {
    msg = 'Pick five glazes to begin.';
    act = '<button type="button" class="btn btn-primary" data-action="new" data-tap>Choose glazes</button>';
  } else if (g.over) {
    const fs = R().finalScore(g);
    msg = `Final score ${fs.total}. Well made.`;
    act = '<button type="button" class="btn btn-primary" data-action="again" data-tap>Start a new wall</button>';
  } else if (U.busy) {
    msg = U.busyMsg || 'Placing the tiles.';
  } else {
    const ph = T().phase(st);
    const legal = U.sel ? R().legalLines(g, U.sel.color) : [];
    const onlyMid = g.center.length && g.dishes.every((d) => !d.length);
    if (t.undo) undo = '<button type="button" class="btn btn-paper small" data-action="undo" data-tap>Undo</button>';
    if (ph === 'deal') {
      msg = Number.isFinite(t.lastGain) ? `Round ${g.round} is done: +${t.lastGain} points. The wall is set.` : `Round ${g.round} is done. The wall is set.`;
      act = `<button type="button" class="btn btn-primary" data-action="deal" data-tap>Deal round ${g.round + 1}</button>`;
    } else if (ph === 'pending' && !U.sel) {
      const over = R().roundOver(g);
      msg = over ? 'That was the last tile. Time to set the wall.' : 'Placed. Ida takes a dish next. You can still undo.';
      act = `<button type="button" class="btn btn-primary" data-action="go" data-tap>${over ? 'Score the round' : 'Ida’s turn'}</button>`;
    } else if (U.sel && !legal.length) {
      msg = hintFor(ids);
      act = '<button type="button" class="btn btn-primary" data-action="basket" data-tap>Seconds basket</button>';
    } else if (onlyMid && !U.sel) {
      msg = 'Only the middle is left. Take a glaze, or finish: the rest go to seconds (+1 each).';
      act = '<button type="button" class="btn btn-primary" data-action="sweep" data-tap>Finish the round</button>';
    } else {
      msg = U.note || hintFor(ids);
    }
  }
  bar.innerHTML = `<span class="msg" role="status">${esc(msg)}</span>${undo}${act}`;
}

function renderHead() {
  const st = S();
  const g = G();
  const t = st.tiles || {};
  const sub = $('[data-subtitle]');
  const score = $('[data-score]');
  const round = $('[data-round]');
  const rival = g ? g.rival : !!(t.settings && t.settings.rival);
  if (sub) sub.textContent = U.view === 'pick' || !g ? 'Glazes for a fresh wall' : g.over ? 'Finished' : g.rival ? 'With Ida from next door' : 'A quiet solo wall';
  if (round) round.textContent = g && !g.over ? `Round ${g.round}` : '';
  if (score && !U.busy) score.textContent = g ? String(g.over ? R().finalScore(g).total : g.score) : '0';
  const coins = $('[data-coins]');
  if (coins && !U.busy) coins.textContent = coinsText(C, st.coins);
  const ida = $('[data-ida]');
  if (ida) ida.hidden = !rival || (g && g.over) || U.view === 'pick';
  const m = $('[data-ida-msg]');
  if (m) m.textContent = U.idaMsg || 'Morning! I take the dish with the most of one glaze. Ties go to the left.';
}

function renderBoard() {
  const g = G();
  if (!g || !$('[data-dishes]')) return;
  const ids = colorsOf(g);
  const legal = U.sel ? R().legalLines(g, U.sel.color) : [];
  let dishes = '';
  for (let d = 0; d < 5; d++) {
    const tl = g.dishes[d];
    dishes += `<div class="tl-dish ${tl.length ? '' : 'is-empty'}" data-dish="${d}"><span class="tl-dn">${d + 1}</span>`;
    for (const c of tl) {
      const on = U.sel && U.sel.source === 'dish' && U.sel.index === d && U.sel.color === c;
      dishes += tile(c, { tag: 'button', cls: on ? 'is-sel' : '', attrs: `data-src="dish" data-i="${d}" aria-label="${esc(label(c, ids))}, dish ${d + 1}" aria-pressed="${!!on}"` });
    }
    dishes += '</div>';
  }
  const kiln = g.kiln.reduce((a, b) => a + b, 0);
  dishes += `<div class="tl-stock"><b>Bag</b> ${g.bag.length}<br><b>Kiln shelf</b> ${kiln}${g.rival ? `<br><b>Ida sold</b> ${g.rivalTiles}` : ''}</div>`;
  let center = '';
  for (const c of g.center) {
    const on = U.sel && U.sel.source === 'center' && U.sel.color === c;
    center += tile(c, { tag: 'button', cls: on ? 'is-sel' : '', attrs: `data-src="center" data-i="0" aria-label="${esc(label(c, ids))}, middle" aria-pressed="${!!on}"` });
  }
  $('[data-dishes]').innerHTML = dishes;
  $('[data-center]').innerHTML = center || '<span class="hint">The middle is empty for now.</span>';
  let lines = '';
  for (let i = 0; i < 5; i++) {
    const L = g.lines[i];
    const ok = U.sel && legal.includes(i);
    let slots = '';
    for (let k = 0; k <= i; k++) {
      const filled = k >= i + 1 - L.n;
      slots += `<span class="tl-slot" data-k="${k}">${filled ? tile(L.color) : ''}</span>`;
    }
    const has = L.n ? `, has ${L.n} ${esc(nameOf(ids[L.color]))}` : '';
    lines += `<button type="button" class="tl-line ${ok ? 'is-ok' : ''} ${U.sel && !ok ? 'is-no' : ''}" data-line="${i}" data-tap aria-label="Pattern line ${i + 1}, holds ${i + 1}${has}">${slots}</button>`;
  }
  $('[data-lines]').innerHTML = lines;
  $('[data-wall]').innerHTML = wallHtml(g);
  const basket = $('[data-basket]');
  basket.classList.toggle('is-ok', !!(U.sel && !legal.length));
  $('[data-secs]').innerHTML = g.seconds.map((c) => tile(c)).join('') || '<span class="hint">Empty</span>';
  $('[data-secval]').textContent = `+${g.seconds.length * R().SECOND_VALUE}`;
}

function renderSummary() {
  const box = $('[data-summary]');
  const g = G();
  if (!box || !g || !g.over) return;
  const fs = R().finalScore(g);
  const t = S().tiles || {};
  const best = Number(t.best) || 0;
  box.innerHTML = `<div class="card tl-sum" data-sumcard>
<h2>${g.exhausted ? 'The shelf is bare, and it looks lovely' : 'Your mosaic is finished'}</h2>
<p class="hint">Take a moment to look at it.</p>
<div class="tl-sumwall" data-sumwall>${wallHtml(g, 'is-big')}</div>
<ul class="tl-break">
<li><span>Placed tiles and seconds</span><b>+${g.score}</b></li>
<li><span>Complete rows (${fs.rowsDone} × ${R().BONUS.row})</span><b>+${fs.rows}</b></li>
<li><span>Complete columns (${fs.colsDone} × ${R().BONUS.col})</span><b>+${fs.cols}</b></li>
<li><span>All five of a glaze (${fs.colorsDone} × ${R().BONUS.color})</span><b>+${fs.colors}</b></li>
</ul>
<div class="tl-total">${fs.total}</div>
<p class="hint">points in all${best && fs.total >= best ? ', your best wall yet' : best ? ` (your best is ${best})` : ''}</p>
<p class="serif" style="font-size:16px">This wall earned <b data-sumcoins>${esc(coinsText(C, t.paid))}</b> coins. It joins your mosaics below.</p>
</div>`;
}

function renderPicker() {
  const box = $('[data-picker]');
  if (!box || !U.pick) return;
  const st = S();
  const sel = U.pick.colors;
  const byFam = new Map();
  for (const c of C.sim.discovery.discoveredColors(st)) {
    const f = C.sim.economy.colorFamily(c.id);
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f).push(c);
  }
  const fams = FAMILY_ORDER.filter((f) => byFam.has(f)).concat([...byFam.keys()].filter((f) => !FAMILY_ORDER.includes(f)));
  const q = T().quote(st, C.game.now());
  const slots = sel.map((id, i) => `<button type="button" class="tl-pslot ${i === U.pick.slot ? 'is-on' : ''}" data-action="pick-slot" data-slot="${i}" data-tap aria-pressed="${i === U.pick.slot}" aria-label="Glaze ${i + 1}: ${esc(nameOf(id))} ${glyphName(i)}">${tile(i)}<span>${esc(nameOf(id))}</span></button>`).join('');
  const lists = fams.map((f) => `<div class="tl-fam"><p class="tl-cap">${esc(FAMILY_LABEL[f] || f)}</p><div class="row">${byFam.get(f).map((c) => `<button type="button" class="tl-sw ${sel.includes(c.id) ? 'is-in' : ''}" style="background:${esc(c.hex)}" data-action="pick-color" data-color="${esc(c.id)}" data-tap aria-label="${esc(c.name)}${sel.includes(c.id) ? ', in the set' : ''}"></button>`).join('')}</div></div>`).join('');
  box.innerHTML = `<div class="card tl-pick" data-coach="tiles-pick">
<div class="h3">Glazes for this wall</div>
<p class="hint">Five of your colors, one from each family so they read apart. Each glaze keeps its own mark.</p>
<div class="tl-slots">${slots}</div>
<p class="hint">Tap a glaze above, then a color below to swap it in.</p>
${lists}
<p class="hint">Each point pays about ${esc(coinsText(C, q.perPoint))} ${q.perPoint < 1.5 ? 'coin' : 'coins'}, and a finished wall adds about ${esc(coinsText(C, q.wallBonus))}.</p>
</div>`;
}

function renderFoot() {
  const foot = $('[data-foot]');
  if (!foot) return;
  const st = S();
  const g = G();
  const rival = g && !g.over ? g.rival : !!(st.tiles && st.tiles.settings && st.tiles.settings.rival);
  const playing = g && !g.over && U.view !== 'pick';
  foot.innerHTML = `<button type="button" class="btn btn-paper small" data-action="rival" data-tap aria-pressed="${rival}">${rival ? 'Ida: playing' : 'Ida: resting'}</button>${playing ? `<button type="button" class="btn btn-paper small" data-action="new" data-tap>${U.confirmNew ? 'Tap again to start over' : 'New wall'}</button>` : ''}`;
}

function renderMosaics() {
  const box = $('[data-mosaics]');
  if (!box) return;
  const t = S().tiles || {};
  const list = (Array.isArray(t.mosaics) ? t.mosaics : []).slice().reverse();
  if (!list.length) { box.innerHTML = ''; return; }
  const shown = list.slice(0, MOSAICS_SHOWN);
  box.innerHTML = `<div class="card tl-card tl-mosaics" data-mosaic-list><div class="row between"><div class="h3">Your mosaics</div><span class="chip">${t.walls} finished${t.best ? ` · best ${t.best}` : ''}</span></div>
<div class="tl-mlist">${shown.map((m) => `<div class="tl-m">${miniWallHtml(C, m.colors || [], m.wall)}<b>${m.score} points</b><span>${m.rival ? 'with Ida' : 'solo'} · ${esc(coinsText(C, m.coins))} coins</span></div>`).join('')}</div>
${list.length > MOSAICS_SHOWN ? `<p class="hint">and ${list.length - MOSAICS_SHOWN} more, all kept with care.</p>` : ''}</div>`;
}

function renderAll() {
  if (!ROOT) return;
  if (!unlocked()) { if ($('[data-bar]') || !$('[data-lock]')) skeleton(); return; }
  if (!$('[data-bar]')) skeleton();
  const g = G();
  if (!g && U.view !== 'pick') openPicker(false);
  const pick = U.view === 'pick';
  applyGlazes(pick && U.pick ? U.pick.colors : colorsOf(g));
  const play = $('[data-play]');
  const sum = $('[data-summary]');
  const picker = $('[data-picker]');
  if (play) play.hidden = pick || !g || g.over;
  if (sum) sum.hidden = pick || !g || !g.over;
  if (picker) picker.hidden = !pick;
  if (!pick && g && !g.over) renderBoard();
  if (!pick && g && g.over) renderSummary();
  if (pick) renderPicker();
  renderHead();
  renderFoot();
  renderMosaics();
  renderBar();
  U.sig = sigOf(S());
}

function sigOf(st) {
  const t = st.tiles || {};
  return [unlocked(), t.game, t.pending, t.undo, t.settings && t.settings.rival, (t.mosaics || []).length, !!(st.settings && st.settings.colorblind)];
}
const sameSig = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

function openPicker(draw = true) {
  U.pick = { colors: T().nextGlazes(S()), slot: 0, rival: undefined };
  U.view = 'pick';
  U.note = '';
  U.sel = null;
  if (draw) {
    renderAll();
    const box = $('[data-picker]');
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  }
}

function pickColor(id) {
  const p = U.pick;
  if (!p || !id) return;
  const fam = C.sim.economy.colorFamily(id);
  const at = p.colors.indexOf(id);
  if (at >= 0) { p.slot = at; U.note = `${nameOf(id)} is already glaze ${at + 1}.`; renderAll(); return; }
  const famAt = p.colors.findIndex((c, i) => i !== p.slot && C.sim.economy.colorFamily(c) === fam);
  const slot = famAt >= 0 ? famAt : p.slot;
  const was = p.colors[slot];
  p.colors = p.colors.slice();
  p.colors[slot] = id;
  p.slot = slot;
  U.note = famAt >= 0
    ? `${nameOf(id)} takes the place of ${nameOf(was)}: one glaze per family keeps them apart.`
    : `${nameOf(id)} is glaze ${slot + 1} now.`;
  safe(() => C.audio.tink(lightnessOf(C, hexOf(id))));
  renderAll();
}

function startWall() {
  const p = U.pick;
  const colors = p ? p.colors.slice() : undefined;
  let r = C.game.act(T().startWall, { colors });
  if (!r || !r.ok) r = C.game.act(T().startWall, {});
  if (!r || !r.ok) { C.toast('The kiln needs a moment. Try again.'); return; }
  U.view = 'play';
  U.pick = null;
  U.note = '';
  U.sel = null;
  U.confirmNew = 0;
  U.idaMsg = G() && G().rival ? 'A fresh wall! I take the dish with the most of one glaze. Ties go left.' : '';
  renderAll();
  const body = U.el.body;
  if (body) body.scrollTop = 0;
  dealIn();
  if (U.guide) U.guide.start();
}

function dealIn() {
  if (reduced()) return;
  $$('[data-dishes] .tl-tile').forEach((t, i) => safe(() => t.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 25, fill: 'backwards', easing: 'ease-out' })));
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function armIda(ms = IDA_PAUSE_MS) {
  clearTimeout(U.timer);
  if (!U.visible) return;
  if (T().phase(S()) === 'pending') U.timer = setTimeout(() => { resolve(); }, ms);
}

async function place(line) {
  const s = U.sel;
  if (!s || U.busy) return;
  const before = G();
  const srcSel = s.source === 'center' ? '[data-center] .tl-tile' : `[data-dishes] .tl-tile[data-i="${s.index}"]`;
  const all = $$(srcSel).map((el) => ({ c: +el.dataset.c, rect: rectOf(el), el }));
  const res = C.game.act(T().take, { ...s, line });
  if (!res || !res.ok) { U.sel = null; renderAll(); return; }
  U.busy = true;
  U.busyMsg = '';
  const gen = U.gen;
  try {
    all.forEach((a) => { a.el.style.visibility = 'hidden'; });
    const picked = all.filter((a) => a.c === s.color);
    const rest = all.filter((a) => a.c !== s.color);
    const oldN = line >= 0 ? before.lines[line].n : 0;
    U.sel = null;
    U.note = '';
    renderAll();
    const m = res.moved;
    const lineEl = line >= 0 ? $(`[data-line="${line}"]`) : null;
    const secEls = $$('[data-secs] .tl-tile');
    const moves = [];
    picked.forEach((p, j) => {
      let toEl = null;
      if (j < m.placed && lineEl) {
        const slot = $$('.tl-slot', lineEl)[line - oldN - j];
        toEl = slot ? slot.firstElementChild : null;
      } else toEl = secEls[secEls.length - (m.count - j)] || null;
      moves.push({ from: p.rect, c: p.c, toEl });
    });
    if (s.source === 'dish') {
      const tg = centerTargets(before.center);
      rest.forEach((r) => moves.push({ from: r.rect, c: r.c, toEl: claimTarget(tg, r.c) }));
    }
    safe(() => C.audio.clink(Math.min(5, m.count)));
    await stagger(moves.filter((x) => x.toEl));
  } catch (err) {
    console.error('[tiles] place', err);
  } finally {
    clearFlies();
    U.busy = false;
    if (gen === U.gen) renderAll();
  }
  armIda();
}

async function idaMove() {
  const g = G();
  const pick = g.rival ? R().rivalChoice(g) : null;
  if (!pick) {
    C.game.act(T().idaTurn);
    if (g.rival) U.idaMsg = 'Nothing left for me this time. Enjoy the middle!';
    return;
  }
  const ids = colorsOf(g);
  const els = $$(`[data-dishes] .tl-tile[data-i="${pick.dish}"]`).map((el) => ({ c: +el.dataset.c, rect: rectOf(el), el }));
  const dishEl = $(`[data-dish="${pick.dish}"]`);
  if (dishEl) dishEl.classList.add('is-ida');
  U.idaMsg = IDA_LINES[(g.round + pick.dish + pick.tiles) % IDA_LINES.length](pick, nameOf(ids[pick.color]), glyphName(pick.color));
  const msgEl = $('[data-ida-msg]');
  if (msgEl) msgEl.textContent = U.idaMsg;
  await sleep(reduced() ? 80 : 380);
  const beforeCenter = g.center.slice();
  const r = C.game.act(T().idaTurn);
  if (!r || !r.ok) return;
  els.forEach((a) => { a.el.style.visibility = 'hidden'; });
  renderBoard();
  renderHead();
  const face = $('[data-ida-face]');
  const chip = face ? rectOf(face) : null;
  const moves = [];
  for (const a of els) if (a.c === pick.color && chip) moves.push({ from: a.rect, c: a.c, toRect: chip, fade: true });
  const tg = centerTargets(beforeCenter);
  els.filter((a) => a.c !== pick.color).forEach((a) => moves.push({ from: a.rect, c: a.c, toEl: claimTarget(tg, a.c) }));
  await stagger(moves.filter((x) => x.toEl || x.toRect));
}

async function finishRound() {
  const g = G();
  const shownFrom = g.score;
  U.busyMsg = 'The round is done. Tiles settle into the wall.';
  renderBar();
  const coinsBefore = Number(S().coins) || 0;
  // Positions first: the board on screen is still the old one (render waits while busy).
  const r = C.game.act(T().scoreRound, {});
  if (!r || !r.ok) return;
  await sleep(reduced() ? 60 : 300);
  let shown = shownFrom;
  for (const p of r.placements) {
    const slots = $$(`[data-line="${p.row}"] .tl-slot`);
    const fromTile = slots[p.row] && slots[p.row].firstElementChild;
    const cell = $(`.tl-cell[data-r="${p.row}"][data-col="${p.col}"]`);
    if (!fromTile || !cell) continue;
    const restTiles = slots.slice(0, p.row).map((sl) => sl.firstElementChild).filter(Boolean);
    const fromRect = rectOf(fromTile);
    fromTile.style.visibility = 'hidden';
    restTiles.forEach((t) => { if (!reduced()) safe(() => t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 320, fill: 'forwards' })); else t.style.opacity = 0; });
    await fly({
      from: fromRect, c: p.color, toRect: rectOf(cell), onLand: () => {
        cell.innerHTML = tile(p.color, { cls: 'is-set' });
        settle(cell.firstElementChild);
        if (!reduced()) safe(() => cell.firstElementChild.animate([{ boxShadow: '0 0 0 0 rgba(226,176,74,.9)' }, { boxShadow: '0 0 0 10px rgba(226,176,74,0)' }], { duration: 600 }));
        floatText(rectOf(cell), `+${p.points}`);
        safe(() => C.audio.tink(0.45 + p.row * 0.08));
      },
    });
    await rollScore(shown, shown + p.points);
    shown += p.points;
    await sleep(reduced() ? 0 : 140);
  }
  if (r.secondsCount) {
    $$('[data-secs] .tl-tile').forEach((t) => { if (!reduced()) safe(() => t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 400, fill: 'forwards' })); else t.style.opacity = 0; });
    const sv = $('[data-secval]');
    if (sv) floatText(rectOf(sv), `+${r.seconds}`);
    await rollScore(shown, shown + r.seconds);
    shown += r.seconds;
    await sleep(reduced() ? 0 : 300);
  }
  // Coins land on the chip (points pay as they are scored).
  const gained = (Number(S().coins) || 0) - coinsBefore;
  const chip = $('[data-coins-chip]');
  const coinsEl = $('[data-coins]');
  if (gained > 0 && chip && coinsEl) {
    const from = $('[data-wall]') || chip;
    const fmt = (v) => coinsText(C, v);
    await Promise.race([safe(() => C.fx.coinArc(from, chip, 8)) || Promise.resolve(), sleep(900)]);
    safe(() => C.fx.rollNumber(coinsEl, coinsBefore, coinsBefore + gained, { ms: 450, format: fmt }));
  }
  if (G() && G().rival && !G().over) U.idaMsg = 'Lovely work. Deal the next round whenever you are ready.';
}

async function resolve() {
  clearTimeout(U.timer);
  if (U.busy || T().phase(S()) !== 'pending') return;
  U.busy = true;
  U.sel = null;
  const gen = U.gen;
  U.busyMsg = R().roundOver(G()) ? '' : 'Ida is choosing a dish.';
  renderBar();
  renderFoot();
  try {
    if (!R().roundOver(G())) await idaMove();
    if (G() && !G().over && R().roundOver(G()) && T().phase(S()) === 'pending') await finishRound();
  } catch (err) {
    // Never leave the board locked: settle the rules state without the animation.
    console.error('[tiles] resolve', err);
    safe(() => {
      if (T().phase(S()) === 'pending' && !R().roundOver(G())) C.game.act(T().idaTurn);
      if (T().phase(S()) === 'pending' && R().roundOver(G())) C.game.act(T().scoreRound, {});
    });
  } finally {
    clearFlies();
    U.busy = false;
    U.busyMsg = '';
    if (gen === U.gen) renderAll();
  }
  if (gen !== U.gen) return;
  if (G() && G().over) celebrate();
  else armIda();
}

/** The finished wall is the reward: bring it into view, stamp it, and let the tiles shimmer in. */
function celebrate() {
  const card = $('[data-sumcard]');
  if (!card) return;
  if (card.scrollIntoView) card.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  if (!reduced()) {
    $$('[data-sumwall] .tl-tile').forEach((t, i) => safe(() => t.animate([{ opacity: 0, transform: 'translateY(8px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 28, fill: 'backwards', easing: 'ease-out' })));
  }
  const wall = $('[data-sumwall]');
  setTimeout(() => {
    safe(() => C.fx.stamp(wall || card, 'Finished', { hold: 900 }));
    safe(() => C.audio.chord([0.45, 0.6, 0.75, 0.9], 0.8));
    safe(() => C.haptics.success());
  }, reduced() ? 100 : 700);
}

function deal() {
  if (U.busy || T().phase(S()) !== 'deal') return;
  const r = C.game.act(T().deal, {});
  if (!r || !r.ok) { renderAll(); return; }
  U.note = '';
  if (r.over) { renderAll(); celebrate(); return; }
  U.idaMsg = G().rival ? `Round ${G().round}. Fresh dishes, same rules. Take your time.` : U.idaMsg;
  renderAll();
  const d = $('[data-dishes]');
  if (d && d.scrollIntoView) d.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
  dealIn();
}

async function sweep() {
  if (U.busy) return;
  if (T().phase(S()) === 'pending') await resolve();
  if (U.busy) return;
  const r = C.game.act(T().sweep);
  if (!r || !r.ok) { renderAll(); return; }
  U.sel = null;
  await resolve();
}

function undo() {
  if (U.busy) return;
  clearTimeout(U.timer);
  const r = C.game.act(T().undo);
  U.sel = null;
  U.note = '';
  if (r && r.ok) safe(() => C.audio.tick('deselect'));
  renderAll();
}

async function tapTile(el) {
  const key = { source: el.dataset.src, index: +el.dataset.i, color: +el.dataset.c };
  if (T().phase(S()) === 'pending') await resolve();
  const g = G();
  if (!g || g.over || U.busy) return;
  const still = (key.source === 'center' ? g.center : g.dishes[key.index] || []).includes(key.color);
  if (!still) {
    // Ida (or the round's end) took those tiles while she was tapping: say so, and select nothing (T1).
    U.sel = null;
    U.note = g.rival ? 'Ida took that dish just before you. Pick another glaze.' : '';
    renderAll();
    return;
  }
  const same = U.sel && U.sel.source === key.source && U.sel.index === key.index && U.sel.color === key.color;
  U.sel = same ? null : key;
  U.note = '';
  if (U.sel) safe(() => C.audio.tink(lightnessOf(C, hexOf(colorsOf(g)[key.color]))));
  renderAll();
}

function toggleRival() {
  const st = S();
  const g = G();
  const now = g && !g.over ? g.rival : !!(st.tiles && st.tiles.settings && st.tiles.settings.rival);
  C.game.act(T().setRival, { on: !now });
  U.idaMsg = !now ? 'Hello again! I will take a dish after each of your turns.' : '';
  renderAll();
  armIda();
}

function onClick(e) {
  if (!ROOT || !e.target.closest) return;
  const a = e.target.closest('[data-action]');
  if (a && ROOT.contains(a) && a.dataset.action === 'unlock-open') {
    ensureWorkshopStyles();
    openUnlockSheet(C, 'tiles', { host: ROOT });
    return;
  }
  if (U.busy) return;
  if (a && ROOT.contains(a)) {
    switch (a.dataset.action) {
      case 'undo': undo(); return;
      case 'go': resolve(); return;
      case 'deal': deal(); return;
      case 'sweep': sweep(); return;
      case 'basket': if (U.sel) place(-1); return;
      case 'rival': toggleRival(); return;
      case 'again': openPicker(); return;
      case 'new': {
        const g = G();
        if (g && !g.over && !U.confirmNew) {
          U.confirmNew = setTimeout(() => { U.confirmNew = 0; renderFoot(); }, 3000);
          renderFoot();
          return;
        }
        clearTimeout(U.confirmNew);
        U.confirmNew = 0;
        openPicker();
        return;
      }
      case 'pick-slot': if (U.pick) { U.pick.slot = Number(a.dataset.slot) || 0; U.note = ''; renderAll(); } return;
      case 'pick-color': pickColor(a.dataset.color); return;
      case 'pick-cancel': U.view = 'play'; U.pick = null; U.note = ''; renderAll(); armIda(); return;
      case 'start': startWall(); return;
      default: break;
    }
  }
  if (U.view === 'pick') return;
  const g = G();
  if (!g || g.over) return;
  const tl = e.target.closest('[data-src]');
  if (tl && ROOT.contains(tl)) { tapTile(tl); return; }
  const ln = e.target.closest('[data-line]');
  if (ln && U.sel) { place(+ln.dataset.line); return; }
  if (e.target.closest('[data-basket]') && U.sel) place(-1);
}

function onKey(e) {
  if (e.key === 'Escape' && U.visible && U.sel && !U.busy) { U.sel = null; renderAll(); }
}

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------

function coachSteps() {
  const moved = (st) => {
    const g = st && st.tiles && st.tiles.game;
    return !!g && (g.lines.some((L) => L.n > 0) || g.seconds.length > 0 || g.round > 1 || g.over);
  };
  return [
    { anchor: '[data-coach="tiles-dishes"]', text: 'Tap a glaze: you take every tile of it from that dish.', endsOn: 'action', done: (st) => !!U.sel || moved(st) },
    { anchor: '[data-coach="tiles-lines"]', text: 'Now tap a glowing pattern line to set them there.', endsOn: 'action', done: moved },
    { anchor: '[data-coach="tiles-bar"]', text: 'The bar down here always holds your next step.', endsOn: 'got-it', side: 'above' },
  ];
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/** debugTiles() -> {busy, sel, view, visible}: a read for tests (test/tiles.e2e.mjs). */
export function debugTiles() {
  return { busy: U.busy, sel: U.sel ? { ...U.sel } : null, view: U.view, visible: U.visible };
}

export default {
  id: 'tiles',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('tiles', CSS);
    root.addEventListener('click', onClick);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) U.guide = C.guide('tiles', coachSteps(), { screen: 'tiles' });
    // Bought from the workshop: offer the way in (two equal choices; nothing navigates by itself).
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        // On the Puzzle table its own card is the way in; elsewhere (the workshop's Next) offer it.
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'tiles'); };
        if (!p || p.id !== 'tiles' || U.visible || here()) return;
        setTimeout(() => {
          if (U.visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Tile Room is open',
            body: 'Glaze tiles in your colors and set a mosaic wall, whenever you like.',
            more: { label: 'Later' },
            next: { label: 'Go to the Tile Room', run: () => C.navigate('tiles') },
          });
        }, 300);
      });
    }
  },

  show() {
    U.visible = true;
    U.gen += 1;
    U.busy = false;
    U.sel = null;
    U.note = '';
    clearFlies();
    if (unlocked()) C.game.act(T().ensureTiles);
    if (U.view === 'pick' && G() && !G().over && !U.pick) U.view = 'play';
    if (!G() || U.view !== 'pick') { U.view = 'play'; U.pick = null; }
    skeleton();
    renderAll();
    if (U.guide && unlocked()) U.guide.start();
    // Reloaded mid-turn: Ida's turn (or the scoring) is still owed; it goes on by itself shortly.
    armIda(700);
  },

  hide() {
    U.visible = false;
    U.gen += 1;
    clearTimeout(U.timer);
    clearTimeout(U.confirmNew);
    U.confirmNew = 0;
    U.busy = false;
    clearFlies();
    if (U.guide) U.guide.stop();
  },

  render(state) {
    if (!ROOT || !U.visible || U.busy) return;
    const coins = $('[data-coins]');
    if (coins) { const t = coinsText(C, state.coins); if (coins.textContent !== t) coins.textContent = t; }
    if (!sameSig(sigOf(state), U.sig)) renderAll();
  },
};
