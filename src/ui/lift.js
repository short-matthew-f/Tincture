/**
 * lift.js: The Lifting Table (overlay `lift`, fullscreen, home tab Puzzles).
 * Ported from proto/lift/app.js and index.html, the playtested prototype: the
 * same rules, 27 paintings and mechanics, the one painted canvas whose columns
 * slump like melting sand as paint lifts from the bottom, the grains pouring
 * into the jars, the belt and bench, the lanes, the gallery wall, the hint, the
 * unlimited undo and the free spare bench spot, the mechanic intro cards, the
 * three-step "How this works" sheet and the finish sheet.
 *
 * What changed for the game: every move is a sim action (src/sim/lift.js, run
 * through ctx.game.act), so it is saved at once and a reload mid-painting
 * resumes exactly; a finished painting pays coins and adds a little stock (the
 * finish sheet says how much); settings (fast belt, sound, color symbols) live
 * in state.lift.settings; sounds come from ctx.audio (a plink at a pentatonic
 * note per lifted cell, a cork pop, a chord), gated by the table's own sound
 * toggle and the game's; motion honors ctx.fx.isReducedMotion(); the first
 * visit teaches itself with a guide() whose first step is the action, and the
 * "?" sheet keeps the prototype's three illustrated steps. Every class and id
 * is prefixed `lf-` and every rule is scoped to #screen-lift.
 *
 * Performance (phones): one canvas for the painting (columns drawn as slices of
 * a pre-painted picture; only dirty columns redraw) and one canvas for the
 * grains and the carriages, with a capped particle pool (MAX_PARTS) and none
 * under reduced motion, exactly as the prototype.
 *
 * Never locked: every animated action goes through run() (busy is reset in
 * finally), WAAPI has a timer fallback, the belt's timeline has a guard timer,
 * and a tap while busy fast-forwards (lane taps queue up).
 */

import { h, raw, button, backButton, escapeHtml } from './kit.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import { LEVELS, PALETTE, MECHANICS, BANDS, levelById } from '../puzzles/lift-levels.js';
import * as R from '../puzzles/lift.js';

const {
  isLegal, isDone, isStuck, benchCap, canNudge, blockedReason, frontJar, laneLeft, laneOpen, canLift, isCovered,
  encodeMove, bestHint, guessMove, frontUnit,
} = R;

let C = null;
let ROOT = null;
const S = () => C.game.state;
const LS = () => C.sim.lift;
const set = () => (S().lift && S().lift.settings) || { fast: false, sound: true, glyphs: true };
const $ = (s) => (ROOT ? ROOT.querySelector(s) : null);
const $$ = (s) => (ROOT ? [...ROOT.querySelectorAll(s)] : []);
const reduced = () => !!(C && C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const esc = (s) => escapeHtml(String(s ?? ''));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- glyphs (colorblind help), shared by jars (SVG) and the canvas ----------
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const GLYPHS = {
  wave: { s: 'M3 13c2.5-4 4.5-4 7 0s4.5 4 7 0c1-1.6 2-2.4 3.5-2.8', w: 2.8 },
  cloud: { f: 'M6.5 18h11a4 4 0 0 0 .3-8 5.6 5.6 0 0 0-10.7-1.2A4.6 4.6 0 0 0 6.5 18z' },
  sun: { f: circ(12, 12, 4.2), s: 'M12 2.8v2.8M12 18.4v2.8M2.8 12h2.8M18.4 12h2.8M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2', w: 2.2 },
  leaf: { f: 'M5 19C4.5 11 9.5 5.5 19 5c.3 8.5-5 14-14 14z' },
  sprout: { f: 'M11 21v-8.2C7.2 12.6 4.6 10 4.5 5.6 8.6 5.6 11 8.2 11.2 11.4 11.8 8.2 14.3 6 18.5 6c-.1 3.8-2.7 6.3-6.3 6.5V21z' },
  heart: { f: 'M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z' },
  down: { f: 'M4 6h16l-8 13z' },
  ring: { s: circ(12, 12, 6), w: 3 },
  drop: { f: 'M12 3.5c3.5 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6 6-11z' },
  square: { f: 'M7 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 17V7A1.5 1.5 0 0 1 7 5.5z' },
  slash: { s: 'M6.5 17.5l11-11', w: 3.6 },
  pebble: { f: 'M12 7c5 0 8.5 2.2 8.5 5s-3.5 5-8.5 5-8.5-2.2-8.5-5S7 7 12 7z' },
  flower: { f: circ(12, 7.6, 3.7) + circ(12, 16.4, 3.7) + circ(7.6, 12, 3.7) + circ(16.4, 12, 3.7) },
  chevron: { s: 'M4 8.5l8 7.5 8-7.5', w: 3.2 },
  moon: { f: 'M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5z' },
  star: { f: 'M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.8l-5.6 3 1.3-6.2L3 9.3l6.3-.7z' },
  diamond: { f: 'M12 3 20.5 12 12 21 3.5 12z' },
  triangle: { f: 'M12 4 21 19.5H3z' },
  flame: { f: 'M12 2.5c.6 3.8 6 6 6 11.5a6 6 0 0 1-12 0c0-3 1.6-4.6 2.8-6.8.9 1.7 1.8 2.5 2.9 2.9.6-2.6.6-5.1.3-7.6z' },
  bars: { s: 'M6 5v14M12 5v14M18 5v14', w: 3 },
  grain: { f: circ(7, 15.5, 2.7) + circ(12, 7.5, 2.7) + circ(17, 15.5, 2.7) },
  shell: { f: 'M12 4.5a8 8 0 0 1 8 8.5H4a8 8 0 0 1 8-8.5zM9 15h6v4H9z' },
  cross: { s: 'M6 6l12 12M18 6 6 18', w: 3.2 },
  dot: { f: circ(12, 12, 5.5) },
  bell: { f: 'M12 3a6 6 0 0 1 6 6v5l2 3H4l2-3V9a6 6 0 0 1 6-6zM10 18.5h4a2 2 0 0 1-4 0z' },
  spade: { f: 'M12 2.8c4 4 8 6.6 8 10.2a4 4 0 0 1-6.6 3.1L14 21h-4l.6-4.9A4 4 0 0 1 4 13c0-3.6 4-6.2 8-10.2z' },
};
const glyphOf = (c) => GLYPHS[PALETTE[c].glyph];
const glyphSvg = (c, cls = 'lf-gl') => {
  const g = glyphOf(c);
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${g.f ? `<path d="${g.f}"/>` : ''}${g.s ? `<path d="${g.s}" fill="none" stroke="currentColor" stroke-width="${g.w}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`;
};
const PATHS = {};
const glyphPaths = (c) => {
  if (!PATHS[c]) { const g = glyphOf(c); PATHS[c] = { f: g.f ? new Path2D(g.f) : null, s: g.s ? new Path2D(g.s) : null, w: g.w }; }
  return PATHS[c];
};

// ---------- color helpers ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = (v) => Math.round(255 * clamp01(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
function lum(hex) { const [r, g, b] = rgbOf(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const glyphInk = (c) => (lum(PALETTE[c].hex) > 0.36 ? 'rgba(42,38,34,.78)' : 'rgba(255,250,235,.95)');
const cname = (c) => PALETTE[c].name;
// Two pigments blended in OKLab, weighted by amount (a mixing jar's corked color).
function mixHex(c1, w1, c2, w2) {
  const lab = (hex) => {
    const [r, g, b] = rgbOf(hex).map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const a = lab(PALETTE[c1].hex), b = lab(PALETTE[c2].hex), t = w2 / (w1 + w2);
  const [L0, A, B] = a.map((v, i) => v * (1 - t) + b[i] * t);
  const l = (L0 + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L0 - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L0 - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((v) => fromLin(v).toString(16).padStart(2, '0')).join('')}`;
}
const jarHex = (j) => (j.c2 ? mixHex(j.c, j.cap, j.c2, j.cap2) : PALETTE[j.c].hex);

// ---------- styles ----------
const CSS = `
#screen-lift { --lf-glass: rgba(255,253,246,.74); --lf-wood: #B48A5A; --lf-wood-d: #8E6A42; --lf-wood-l: #CFAA77; --lf-gold: #E2B04A; --lf-accent: #8C6512; --lf-card: #FBF8F1;
  background: radial-gradient(120% 70% at 50% 0%, #F8F3E8 0%, #F4EFE4 60%, #EDE4D2 100%); overscroll-behavior-y: none; }
#screen-lift [hidden] { display: none !important; }
#screen-lift .screen-head.lf-head { background: transparent; gap: 4px; padding: calc(6px + var(--safe-top)) 12px 2px; max-width: 480px; width: 100%; margin: 0 auto; }
#screen-lift .lf-app { gap: 5px; padding: 0 12px calc(8px + var(--safe-bottom)); max-width: 480px; width: 100%; margin: 0 auto; overflow-x: hidden; }
#screen-lift .lf-closed { padding: 16px 16px 24px; max-width: 480px; margin: 0 auto; width: 100%; }
#screen-lift .btn[aria-pressed="true"] { background: #F3E3B8; box-shadow: 0 0 0 2px var(--lf-gold), 0 3px 0 rgba(42,38,34,.18); }
#screen-lift .lf-iconbtn { appearance: none; border: 0; background: none; min-width: 44px; min-height: 44px; display: grid; place-items: center; border-radius: 12px; color: var(--ink-soft); cursor: pointer; font-size: 22px; touch-action: manipulation; }
#screen-lift .lf-iconbtn:active { background: rgba(42,38,34,.06); }
#screen-lift .lf-levelbtn { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; padding: 0 10px; justify-content: flex-start; }
#screen-lift .lf-levelbtn .lf-nm { font: 400 17px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#screen-lift .lf-levelbtn .lf-no { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-soft); white-space: nowrap; }
#screen-lift .lf-levelbtn .lf-chev { margin-left: auto; color: var(--ink-soft); font-size: 13px; }
#screen-lift .lf-tog { flex: 0 0 auto; min-width: 44px; padding: 0 8px; font-size: 13px; }
#screen-lift .lf-tog svg { width: 19px; height: 19px; display: inline-block; vertical-align: -4px; }

/* the shelf of corked jars */
.lf-shelfrow { display: flex; align-items: flex-end; gap: 8px; height: 24px; flex: none; font-size: 12px; color: var(--ink-soft); position: relative; }
.lf-shelfrow::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; border-radius: 2px; background: linear-gradient(var(--lf-wood-l), var(--lf-wood-d)); box-shadow: 0 2px 0 rgba(42,38,34,.12); }
.lf-shelfrow b { color: var(--ink); font-weight: 600; }
#lf-shelfCount { padding-bottom: 5px; white-space: nowrap; }
#lf-shelf { flex: 1; display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 1px; overflow: hidden; height: 20px; align-items: flex-end; padding-bottom: 4px; }
.lf-mini { flex: none; width: 8px; height: 13px; border-radius: 2px 2px 3px 3px; background: var(--jc); box-shadow: inset 0 0 0 1px rgba(42,38,34,.25); position: relative; }
.lf-mini::before { content: ''; position: absolute; left: 2px; right: 2px; top: -3px; height: 3px; border-radius: 1px; background: #B08A5E; }

/* the easel: a framed canvas resting on a ledge, the belt's track */
.lf-easel { position: relative; display: flex; flex-direction: column; align-items: center; padding-top: 6px; flex: none; }
.lf-easel::before { content: ''; position: absolute; top: 0; left: 50%; width: 10px; margin-left: -5px; height: 12px; background: linear-gradient(90deg, var(--lf-wood-d), var(--lf-wood-l), var(--lf-wood-d)); border-radius: 2px; }
.lf-frame { position: relative; padding: 5px; border-radius: 6px; background: linear-gradient(160deg, #CDA978, #A47E50 60%, #8E6A42); box-shadow: inset 0 0 0 1px rgba(42,38,34,.3), inset 0 1px 0 rgba(255,240,210,.5), 0 4px 10px rgba(42,38,34,.18); }
#lf-pic { display: block; border-radius: 2px; background: #EFE7D6; touch-action: manipulation; }
.lf-ledge { position: relative; height: 13px; margin-top: -1px; border-radius: 3px 3px 6px 6px; background: linear-gradient(var(--lf-wood-l), var(--lf-wood) 55%, var(--lf-wood-d)); box-shadow: 0 2px 0 rgba(42,38,34,.15); }
.lf-ledge::before, .lf-ledge::after { content: ''; position: absolute; top: 12px; width: 7px; height: 9px; background: var(--lf-wood-d); border-radius: 0 0 3px 3px; }
.lf-ledge::before { left: 14%; transform: skewX(14deg); } .lf-ledge::after { right: 14%; transform: skewX(-14deg); }
#lf-fx { position: absolute; pointer-events: none; z-index: 5; }
.lf-combo { position: absolute; left: 50%; top: 40%; z-index: 6; pointer-events: none; transform: translate(-50%, -50%); font: 400 22px var(--font-display); color: #6A4E12; text-shadow: 0 1px 0 #FFF8E6, 0 0 12px rgba(255,236,190,.9); white-space: nowrap; }

/* belt and bench share the table */
.lf-table { display: grid; grid-template-columns: var(--beltfr, 4fr) var(--benchfr, 3fr); gap: 8px; margin-top: 8px; flex: none; }
.lf-table.lf-stack { grid-template-columns: 1fr; gap: 3px; }
.lf-table.lf-stack #lf-bench { grid-template-columns: repeat(var(--benchn), minmax(0, 66px)); justify-content: start; min-height: 64px; }
.lf-table.lf-stack .lf-rail { min-height: 64px; }
.lf-table.lf-stack .lf-spot, .lf-table.lf-stack .lf-slotbtn { min-height: 54px; }
.lf-lbl { margin: 0 0 2px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); display: flex; justify-content: space-between; }
.lf-lbl span { font-weight: 600; letter-spacing: 0; text-transform: none; }
.lf-rail { position: relative; display: grid; gap: 3px; padding: 5px 6px; border-radius: 12px; min-height: 70px; align-items: center; }
#lf-belt { grid-template-columns: repeat(var(--slots), minmax(0, 1fr)); background: #4A3F36; box-shadow: inset 0 0 0 1px rgba(0,0,0,.25), inset 0 2px 3px rgba(0,0,0,.3); overflow: hidden; padding-left: 12px; padding-right: 12px; }
#lf-belt .lf-tread { position: absolute; left: -24px; right: -24px; top: 6px; bottom: 6px; border-radius: 6px; background: repeating-linear-gradient(90deg, #6A5B4E 0 9px, #5A4C40 9px 12px); box-shadow: inset 0 2px 0 rgba(255,255,255,.08), inset 0 -2px 0 rgba(0,0,0,.2); will-change: transform; }
#lf-belt .lf-roller { position: absolute; top: 50%; width: 16px; height: 16px; margin-top: -8px; border-radius: 50%; background: conic-gradient(#A89A8A 0 25%, #7D7062 0 50%, #A89A8A 0 75%, #7D7062 0); box-shadow: 0 0 0 2px #3A312A; will-change: transform; z-index: 1; }
#lf-belt .lf-roller.lf-l { left: -4px; } #lf-belt .lf-roller.lf-r { right: -4px; }
#lf-belt.lf-running .lf-tread { animation: lf-tread .36s linear infinite; }
#lf-belt.lf-running .lf-roller { animation: lf-spin .5s linear infinite; }
#lf-belt.lf-fast.lf-running .lf-tread { animation-duration: .2s; }
@keyframes lf-tread { to { transform: translateX(12px); } }
@keyframes lf-spin { to { transform: rotate(360deg); } }
#lf-bench { grid-template-columns: repeat(var(--benchn), minmax(0, 1fr)); background: linear-gradient(#D8C3A0, #C9B08A); box-shadow: inset 0 0 0 1px rgba(42,38,34,.15), 0 3px 0 rgba(42,38,34,.14); }
.lf-spot { position: relative; z-index: 2; min-height: 58px; border-radius: 10px; border: 2px dashed rgba(255,250,235,.22); display: grid; place-items: center; font-size: 10px; color: rgba(255,250,235,.45); }
#lf-bench .lf-spot { border-color: rgba(42,38,34,.16); color: rgba(42,38,34,.4); }
.lf-spot.lf-new { border-color: var(--lf-gold); }

.lf-slotbtn, .lf-lane .lf-front { position: relative; z-index: 2; appearance: none; border: 0; background: none; padding: 0; margin: 0; width: 100%; min-height: 58px; min-width: 0; border-radius: 10px; display: grid; place-items: center; cursor: pointer; touch-action: manipulation; -webkit-user-select: none; user-select: none; }
.lf-slotbtn:active, .lf-lane .lf-front:active { background: rgba(255,250,235,.12); }
.lf-slotbtn:focus-visible, .lf-lane .lf-front:focus-visible { outline: 3px solid var(--lf-gold); outline-offset: 1px; }

/* jars */
.lf-jar { --jc: #999; --jc2: var(--jc); appearance: none; border: 0; padding: 0; margin: 0 auto; background: none; width: 40px; height: 56px; position: relative; display: block; flex: none; }
.lf-jar .lf-cork { position: absolute; left: 11px; right: 11px; top: 0; height: 8px; border-radius: 3px 3px 2px 2px; background: linear-gradient(#C4A06E, #9C7A4C); box-shadow: inset 0 -1px 0 rgba(0,0,0,.2); opacity: 0; transform: translateY(-8px); }
.lf-jar .lf-neck { position: absolute; left: 10px; right: 10px; top: 5px; height: 7px; border-radius: 3px; background: var(--lf-glass); box-shadow: inset 0 0 0 1.5px rgba(42,38,34,.3); }
.lf-jar .lf-glass { position: absolute; left: 2px; right: 2px; top: 10px; bottom: 14px; border-radius: 8px 8px 10px 10px; background: var(--lf-glass); box-shadow: inset 0 0 0 1.5px rgba(42,38,34,.34), 0 2px 0 rgba(42,38,34,.14); overflow: hidden; }
.lf-jar .lf-tint { position: absolute; inset: 0; background: linear-gradient(90deg, var(--jc) 50%, var(--jc2) 50%); opacity: .3; }
.lf-jar .lf-fill, .lf-jar .lf-fill2 { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; transform-origin: 50% 100%; transform: scaleY(0); transition: transform .16s ease-out; }
.lf-jar .lf-fill { background: var(--jc); z-index: 1; }
.lf-jar .lf-fill2 { background: var(--jc2); }
.lf-jar .lf-fill::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: rgba(255,255,255,.28); }
.lf-jar .lf-blend { position: absolute; inset: 0; background: var(--mix); opacity: 0; z-index: 2; transition: opacity .5s ease; }
.lf-jar.lf-full .lf-blend { opacity: 1; }
.lf-jar .lf-shine { position: absolute; left: 4px; top: 4px; width: 3px; bottom: 6px; border-radius: 2px; background: rgba(255,255,255,.45); z-index: 3; }
.lf-jar .lf-band { position: absolute; left: 0; right: 0; top: 0; height: 6px; background: linear-gradient(90deg, var(--jc) 50%, var(--jc2) 50%); z-index: 3; }
.lf-jar .lf-gl { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -7px 0 0 -9px; fill: currentColor; display: none; z-index: 4; filter: drop-shadow(0 0 1px rgba(255,255,255,.5)); }
.lf-jar.lf-mix .lf-gl { width: 13px; height: 13px; margin: -6px 0 0 -13px; }
.lf-jar.lf-mix .lf-gl + .lf-gl { margin-left: 0; }
#screen-lift.lf-glyphs .lf-jar .lf-gl { display: block; }
.lf-jar .lf-num { position: absolute; left: -6px; right: -6px; bottom: 0; text-align: center; font: 700 11px/13px var(--font-ui); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
#lf-belt .lf-jar .lf-num { color: #FFF8E6; }
.lf-jar.lf-full .lf-cork { opacity: 1; transform: none; }
.lf-jar.lf-hinted { animation: lf-hintpulse 1.1s ease-in-out infinite; border-radius: 12px; }
@keyframes lf-hintpulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(226,176,74,.85); } 50% { box-shadow: 0 0 0 7px rgba(226,176,74,.55); } }
.lf-jar.lf-waiting .lf-glass { box-shadow: inset 0 0 0 1.5px rgba(42,38,34,.34), 0 0 0 2px rgba(255,248,225,.35); }
.lf-jar.lf-mystery .lf-glass { background: repeating-linear-gradient(45deg, #D9C7A6 0 4px, #CDB894 4px 8px); }
.lf-jar.lf-mystery .lf-tint, .lf-jar.lf-mystery .lf-band, .lf-jar.lf-mystery .lf-gl { display: none !important; }
.lf-jar.lf-mystery .lf-glass::after { content: '?'; position: absolute; inset: 0; display: grid; place-items: center; font: 400 18px var(--font-display); color: #6A5235; }

/* message row */
.lf-msgrow { display: flex; align-items: center; gap: 6px; min-height: 46px; flex: none; }
#lf-msg { flex: 1; margin: 0; font-size: 13.5px; line-height: 1.3; font-weight: 500; }
.lf-msgrow .btn { flex: 0 0 auto; white-space: nowrap; }
/* three buttons (a dead end): the message takes its own line above them */
.lf-msgrow.lf-wide { flex-wrap: wrap; row-gap: 4px; }
.lf-msgrow.lf-wide #lf-msg { flex: 1 1 100%; min-height: calc(3 * 1.3em); }
.lf-msgrow.lf-wide .btn { flex: 1 1 auto; }
#lf-msg.lf-hintmsg { font-weight: 600; }

/* supply lanes: the worktable */
.lf-lanes { display: grid; grid-template-columns: repeat(var(--lanes), minmax(0, 1fr)); gap: 6px; padding: 7px 6px 6px; border-radius: 14px; margin-top: auto; flex: none;
  background: repeating-linear-gradient(90deg, rgba(0,0,0,.025) 0 1px, transparent 1px 23px), linear-gradient(#CBAE82, #B8996B); box-shadow: inset 0 1px 0 rgba(255,240,210,.5), 0 3px 0 rgba(42,38,34,.16); }
.lf-lane { position: relative; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px; min-width: 0; }
.lf-lane .lf-front { min-height: 60px; background: rgba(255,250,235,.28); }
.lf-lane .lf-next { display: flex; flex-direction: column; align-items: center; gap: 0; }
.lf-lane .lf-next .lf-jar { width: 20px; height: 28px; pointer-events: none; opacity: .92; }
.lf-lane .lf-next .lf-jar .lf-cork { left: 6px; right: 6px; height: 4px; } .lf-lane .lf-next .lf-jar .lf-neck { left: 5px; right: 5px; top: 2px; height: 4px; }
.lf-lane .lf-next .lf-jar .lf-glass { top: 5px; bottom: 1px; border-radius: 4px 4px 6px 6px; }
.lf-lane .lf-next .lf-jar .lf-num, .lf-lane .lf-next .lf-jar .lf-gl, .lf-lane .lf-next .lf-jar .lf-shine { display: none !important; }
.lf-lane .lf-next .lf-jar.lf-mystery .lf-glass::after { font-size: 11px; }
.lf-lane .lf-next .lf-jar + .lf-jar { opacity: .7; }
.lf-lane .lf-more { position: absolute; right: 0; bottom: -3px; font-size: 10px; font-weight: 700; color: rgba(42,38,34,.6); }
.lf-lane .lf-done { grid-column: 1 / -1; min-height: 60px; display: grid; place-items: center; font-size: 11px; color: rgba(42,38,34,.6); text-align: center; }
.lf-lane .lf-tie { position: absolute; left: 50%; top: 50%; width: 30px; height: 22px; margin: -16px 0 0 2px; pointer-events: none; z-index: 3; }
.lf-lane.lf-locked .lf-front .lf-jar { filter: grayscale(.4) brightness(.92); }
.lf-lane .lf-lock { position: absolute; z-index: 4; left: 50%; top: 50%; transform: translate(-70%, -50%); width: 30px; height: 34px; pointer-events: none; }

/* sheets (inside the screen) */
#screen-lift .lf-sheet { position: absolute; inset: 0; z-index: 60; background: rgba(42,38,34,.32); display: flex; align-items: flex-end; justify-content: center; }
#screen-lift .lf-panel { width: 100%; max-width: 480px; max-height: 92%; overflow-y: auto; overflow-x: hidden; background: #F4EFE4; border-radius: 20px 20px 0 0; padding: 14px 16px calc(16px + var(--safe-bottom)); box-shadow: 0 -8px 30px rgba(42,38,34,.2); }
#screen-lift .lf-sheet h2 { font: 400 24px var(--font-display); margin: 4px 0 6px; }
#screen-lift .lf-x { float: right; }
.lf-wall { background: repeating-linear-gradient(90deg, rgba(140,101,18,.05) 0 2px, transparent 2px 26px), #EFE6D3; border-radius: 14px; padding: 6px 10px 12px; margin-top: 10px; }
.lf-wall h3 { font: 600 11px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); margin: 10px 2px 6px; }
.lf-gallery { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; }
.lf-gallery button { width: 100%; min-height: 44px; display: flex; flex-direction: column; align-items: center; gap: 5px; border: 0; background: none; padding: 4px 2px; border-radius: 10px; cursor: pointer; position: relative; }
.lf-gallery .lf-fr { padding: 4px; background: linear-gradient(160deg, #CDA978, #9C774A); border-radius: 4px; box-shadow: 0 3px 5px rgba(42,38,34,.22); position: relative; }
.lf-gallery .lf-fr::before { content: ''; position: absolute; top: -7px; left: 50%; width: 1px; height: 7px; background: rgba(42,38,34,.4); }
.lf-gallery canvas { display: block; image-rendering: pixelated; width: 72px; height: auto; border-radius: 1px; }
.lf-gallery .lf-t { font-size: 11.5px; line-height: 1.2; text-align: center; color: var(--ink); }
.lf-gallery .lf-t b { font-variant-numeric: tabular-nums; color: var(--ink-soft); font-weight: 700; }
.lf-gallery button[aria-current="true"] { background: rgba(226,176,74,.22); box-shadow: 0 0 0 2px var(--lf-gold); }
.lf-tick { position: absolute; right: -6px; bottom: -6px; width: 22px; height: 22px; border-radius: 50%; background: #F3E3B8; box-shadow: 0 0 0 2px #fff, 0 1px 2px rgba(42,38,34,.3); display: grid; place-items: center; color: #6A5A1E; font-size: 13px; font-weight: 800; }
.lf-chip { font-size: 9.5px; font-weight: 700; color: #6A5A1E; background: #F3E3B8; border-radius: 999px; padding: 2px 6px; }
.lf-settings { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.lf-steps { display: flex; gap: 6px; justify-content: center; margin: 10px 0; }
.lf-steps i { width: 8px; height: 8px; border-radius: 50%; background: rgba(42,38,34,.18); }
.lf-steps i.lf-on { background: var(--lf-accent); }
.lf-how p { font-size: 15px; line-height: 1.45; margin: 8px 0; }
.lf-how svg.lf-ill { display: block; width: 100%; max-width: 320px; height: auto; margin: 6px auto; }
.lf-row2 { display: flex; gap: 8px; margin-top: 12px; }
.lf-row2 .btn { flex: 1; }
.lf-how .how-link { display: flex; margin: 8px auto 0; }
.lf-intro .lf-item { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
.lf-intro .lf-item svg { flex: none; width: 52px; height: 52px; }
.lf-intro .lf-item p { margin: 0; font-size: 15px; line-height: 1.4; }
.lf-intro .lf-item strong { display: block; font: 400 17px var(--font-display); }

/* finish */
.lf-finish { text-align: center; }
.lf-finish canvas { image-rendering: pixelated; border-radius: 3px; box-shadow: 0 0 0 6px #C9A779, 0 0 0 7px #8E6A42, 0 3px 0 rgba(42,38,34,.18); margin: 14px auto 16px; display: block; }
.lf-jarrow { display: flex; flex-wrap: wrap; justify-content: center; gap: 3px 1px; margin: 0 0 12px; max-height: 120px; overflow: hidden; }
.lf-jarrow .lf-jar { width: 18px; height: 26px; }
.lf-jarrow .lf-jar .lf-cork { left: 5px; right: 5px; height: 4px; } .lf-jarrow .lf-jar .lf-neck { left: 4px; right: 4px; top: 2px; height: 4px; }
.lf-jarrow .lf-jar .lf-glass { top: 5px; bottom: 1px; border-radius: 4px 4px 6px 6px; }
.lf-jarrow .lf-jar .lf-num, .lf-jarrow .lf-jar .lf-gl, .lf-jarrow .lf-jar .lf-shine { display: none !important; }
.lf-finish .btn { width: 100%; margin-top: 8px; }
.lf-reward { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px 10px; margin: 0 0 6px; font-size: 14px; }
.lf-reward .lf-coins { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.lf-reward .lf-coins i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
.lf-reward .lf-st { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-soft); }
.lf-reward .lf-st i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(42,38,34,.2); }
.lf-reveal { position: absolute; left: 50%; bottom: 18%; transform: translateX(-50%); z-index: 7; pointer-events: none; font: 400 19px var(--font-display); color: #4A3A26; background: rgba(251,246,234,.86); padding: 6px 14px; border-radius: 999px; box-shadow: 0 2px 8px rgba(42,38,34,.15); white-space: nowrap; }

/* the Puzzles hub card */
.lf-card .lf-cardrow { display: flex; align-items: center; gap: 12px; }
.lf-card .lf-thumb { flex: none; padding: 3px; border-radius: 3px; background: linear-gradient(160deg, #CDA978, #9C774A); box-shadow: 0 2px 0 rgba(42,38,34,.18); line-height: 0; }
.lf-card .lf-thumb svg { display: block; width: 52px; height: auto; max-height: 64px; }

@media (prefers-reduced-motion: reduce) {
  .lf-jar .lf-fill, .lf-jar .lf-fill2, .lf-jar .lf-blend { transition: none; }
  #lf-belt.lf-running .lf-tread, #lf-belt.lf-running .lf-roller { animation: none; }
  .lf-jar.lf-hinted { animation: none; box-shadow: 0 0 0 4px rgba(226,176,74,.7); }
}
html[data-motion="reduced"] .lf-jar .lf-fill, html[data-motion="reduced"] .lf-jar .lf-fill2, html[data-motion="reduced"] .lf-jar .lf-blend { transition: none; }
html[data-motion="reduced"] #lf-belt.lf-running .lf-tread, html[data-motion="reduced"] #lf-belt.lf-running .lf-roller { animation: none; }
html[data-motion="reduced"] .lf-jar.lf-hinted { animation: none; box-shadow: 0 0 0 4px rgba(226,176,74,.7); }
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('lf-style')) return;
  const el = document.createElement('style');
  el.id = 'lf-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------- the screen's own state ----------
let L = null, G = null, busy = false, skip = false, queued = null, hinted = null, note = '', howStep = 0;
// 0.4.1: `dead` = the rules prove no order of jars clears the painting from here
// (checked after every move, cached by position); `pendingHint` = Hint was
// tapped while the belt ran (it answers once the belt settles); `stepping` =
// "Back to solvable" is walking back.
let dead = false, deadTimer = 0, pendingHint = false, stepping = false, laidOut = false;
let lastOpen = [];
let visible = false, gen = 0, guideApi = null, built = false, lastSig = '';
const skipWaiters = new Set();

function wait(ms) {
  if (skip || ms <= 0) return Promise.resolve();
  return new Promise((r) => {
    const done = () => { clearTimeout(t); skipWaiters.delete(done); r(); };
    const t = setTimeout(done, ms);
    skipWaiters.add(done);
  });
}
function ownAnimations() {
  if (!ROOT) return [];
  try { if (ROOT.getAnimations) return ROOT.getAnimations({ subtree: true }); } catch { /* fall through */ }
  try { return document.getAnimations().filter((a) => a.effect && a.effect.target && ROOT.contains(a.effect.target)); } catch { return []; }
}
function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  if (TL) TL.skip = true;
  settleNow();
  for (const a of ownAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
  kick();
}
// WAAPI with a timer fallback, so a paused or failed animation can never hang the table.
function anim(el, frames, opts) {
  if (!el || !el.animate) return Promise.resolve();
  const o = { ...opts, duration: Math.max(0, opts.duration || 0), delay: Math.max(0, opts.delay || 0) };
  try {
    const a = el.animate(frames, o);
    if (skip) a.finish();
    return Promise.race([a.finished.then(() => {}, () => {}), nap(o.duration + o.delay + 400)]);
  } catch { return Promise.resolve(); }
}

// Every animated action goes through here: whatever happens, busy is reset.
async function run(fn) {
  if (busy) { skipAll(); return; }
  const myGen = gen;
  busy = true; skip = false;
  try { await fn(); } catch (e) { console.error('The Lifting Table: an animation was cut short', e); } finally {
    busy = false; skip = false;
    TL = null;
    if (myGen === gen && ROOT && G) {
      $('#lf-belt')?.classList.remove('lf-running');
      for (const el of $$('.lf-flying')) el.remove();
      if (PT.h.join() !== G.state.h.join()) syncPainter(G.state); else kick();
      render();
      afterMove();
      const q = queued;
      queued = null;
      if (q && !isDone(G.state)) { pendingHint = false; setTimeout(() => act(q), 0); } else {
        scheduleDeadCheck();
        if (pendingHint) { pendingHint = false; if (!isDone(G.state)) setTimeout(doHint, 0); }
      }
    } else { queued = null; pendingHint = false; }
  }
}

// ---------- the painter: one canvas, columns that slump ----------
const PT = {
  cv: null, ctx: null, fx: null, fctx: null, dcs: 8, cs: 8, dpr: 1, paint: null, bare: null,
  h: [], off: [], vel: [], cloth: [], dirty: new Set(), parts: [], carts: [], fxH: 0, ledgeY: 0, keyCells: [],
};
const MAX_PARTS = 240;
const GRAV = 70; // cells per second squared

function hash(a, b, c = 0) { let x = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

function buildPainter() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cv = $('#lf-pic');
  const d = Math.max(3, Math.round(PT.cs * dpr));
  PT.dpr = dpr; PT.dcs = d; PT.cv = cv; PT.ctx = cv.getContext('2d');
  cv.width = L.W * d; cv.height = L.H * d;
  cv.style.width = `${(L.W * d) / dpr}px`; cv.style.height = `${(L.H * d) / dpr}px`;
  // the painted picture, with brush streaks and grain
  const paint = document.createElement('canvas');
  paint.width = cv.width; paint.height = cv.height;
  const p = paint.getContext('2d');
  for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
    const k = L.cells[r][c], x = c * d, y = r * d;
    p.fillStyle = PALETTE[k].hex; p.fillRect(x, y, d, d);
    const h1 = hash(r, c), h2 = hash(c, r, 7);
    p.fillStyle = h1 > 0.5 ? 'rgba(255,255,255,.11)' : 'rgba(40,30,20,.07)';
    p.fillRect(x, y, d, d);
    if (d >= 6) {
      p.fillStyle = 'rgba(255,250,240,.09)';
      p.fillRect(x + d * 0.12, y + d * (0.12 + 0.3 * h2), d * (0.55 + 0.3 * h1), Math.max(1, d * 0.16));
      p.fillStyle = 'rgba(40,28,18,.06)';
      p.fillRect(x + d * (0.3 * h1), y + d * (0.62 + 0.2 * h1), d * 0.6, Math.max(1, d * 0.14));
    }
  }
  const grain = document.createElement('canvas');
  grain.width = grain.height = 48;
  const gx = grain.getContext('2d'), gd = gx.createImageData(48, 48);
  for (let i = 0; i < 48 * 48; i++) { const v = hash(i, 11) * 255; gd.data[i * 4] = gd.data[i * 4 + 1] = gd.data[i * 4 + 2] = v; gd.data[i * 4 + 3] = 22; }
  gx.putImageData(gd, 0, 0);
  p.fillStyle = p.createPattern(grain, 'repeat'); p.globalCompositeOperation = 'overlay'; p.fillRect(0, 0, paint.width, paint.height);
  p.globalCompositeOperation = 'source-over';
  PT.paint = paint;
  // the bare canvas: linen weave and a faint pencil sketch of the picture
  const bare = document.createElement('canvas');
  bare.width = cv.width; bare.height = cv.height;
  const b = bare.getContext('2d');
  b.fillStyle = '#EFE7D6'; b.fillRect(0, 0, bare.width, bare.height);
  b.fillStyle = 'rgba(140,110,70,.07)';
  const step = Math.max(2, Math.round(dpr * 2));
  for (let y = 0; y < bare.height; y += step) b.fillRect(0, y, bare.width, 1);
  for (let x = 0; x < bare.width; x += step) b.fillRect(x, 0, 1, bare.height);
  b.globalAlpha = 0.1;
  for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) { b.fillStyle = PALETTE[L.cells[r][c]].hex; b.fillRect(c * d, r * d, d, d); }
  b.globalAlpha = 1;
  b.fillStyle = 'rgba(70,58,46,.32)';
  const lw = Math.max(1, Math.round(dpr * 0.8));
  for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
    if (c + 1 < L.W && L.cells[r][c] !== L.cells[r][c + 1]) b.fillRect((c + 1) * d - (lw >> 1), r * d, lw, d);
    if (r + 1 < L.H && L.cells[r][c] !== L.cells[r + 1][c]) b.fillRect(c * d, (r + 1) * d - (lw >> 1), d, lw);
  }
  PT.bare = bare;
  // muslin
  const mus = document.createElement('canvas');
  mus.width = mus.height = Math.max(4, Math.round(4 * dpr));
  const m = mus.getContext('2d');
  m.fillStyle = 'rgba(250,244,228,.58)'; m.fillRect(0, 0, mus.width, mus.height);
  m.fillStyle = 'rgba(160,140,110,.35)'; m.fillRect(0, 0, mus.width, Math.max(1, dpr * 0.7)); m.fillRect(0, 0, Math.max(1, dpr * 0.7), mus.height);
  PT.muslin = PT.ctx.createPattern(mus, 'repeat');
  PT.keyCells = L.locks.map((k) => k && { r: k.r, c: k.c });
  layoutFx();
}

function layoutFx() {
  const fx = $('#lf-fx'), easel = $('#lf-easel'), pic = $('#lf-pic'), ledge = $('#lf-ledge');
  const er = easel.getBoundingClientRect(), pr = pic.getBoundingClientRect(), lr = ledge.getBoundingClientRect();
  const w = pr.width, hh = lr.bottom - pr.top + 6;
  fx.style.left = `${pr.left - er.left}px`; fx.style.top = `${pr.top - er.top}px`;
  fx.style.width = `${w}px`; fx.style.height = `${hh}px`;
  fx.width = Math.round(w * PT.dpr); fx.height = Math.round(hh * PT.dpr);
  PT.fx = fx; PT.fctx = fx.getContext('2d'); PT.fctx.setTransform(PT.dpr, 0, 0, PT.dpr, 0, 0);
  PT.fxH = hh; PT.ledgeY = lr.top - pr.top; PT.cssW = w;
}

// Snap the canvas to a state (no motion).
function syncPainter(s) {
  PT.h = s.h.slice();
  PT.off = s.h.map(() => 0); PT.vel = s.h.map(() => 0);
  PT.cloth = s.h.map((_, c) => (isCovered(L, s, c) ? 1 : 0));
  for (let c = 0; c < L.W; c++) PT.dirty.add(c);
  kick();
}
function settleNow() {
  for (let c = 0; c < PT.off.length; c++) { if (PT.off[c] || PT.vel[c]) { PT.off[c] = 0; PT.vel[c] = 0; PT.dirty.add(c); } }
  PT.parts.length = 0; PT.carts.length = 0;
}

function drawColumn(c) {
  const { ctx, dcs: d, paint, bare } = PT, H = L.H;
  if (!ctx || !paint) return;
  ctx.drawImage(bare, c * d, 0, d, H * d, c * d, 0, d, H * d);
  const n = PT.h[c];
  if (n <= 0) return;
  const top = Math.round((H - n - PT.off[c]) * d);
  ctx.drawImage(paint, c * d, 0, d, n * d, c * d, top, d, n * d);
  // the exposed (bottom) cell gets a soft lip so it reads as "next"
  const by = top + (n - 1) * d;
  ctx.fillStyle = 'rgba(255,250,235,.35)';
  ctx.fillRect(c * d, by + d - Math.max(1, Math.round(d * 0.14)), d, Math.max(1, Math.round(d * 0.14)));
  // keys
  PT.keyCells.forEach((k) => { if (k && k.c === c && k.r < n) drawKey(c * d, top + k.r * d, d); });
  // muslin
  if (PT.cloth[c] > 0.01) {
    ctx.save(); ctx.globalAlpha = PT.cloth[c];
    ctx.fillStyle = PT.muslin; ctx.fillRect(c * d, top - Math.round(d * 0.3), d, n * d + Math.round(d * 0.3));
    ctx.fillStyle = 'rgba(176,138,94,.9)'; ctx.fillRect(c * d, top - Math.round(d * 0.3), d, Math.max(1, Math.round(d * 0.16)));
    ctx.restore();
  } else if (set().glyphs && d >= 9) {
    const k = L.cells[n - 1][c], g = glyphPaths(k), s = d * 0.62;
    ctx.save(); ctx.translate(c * d + (d - s) / 2, by + (d - s) / 2); ctx.scale(s / 24, s / 24);
    ctx.fillStyle = ctx.strokeStyle = glyphInk(k);
    if (g.f) ctx.fill(g.f);
    if (g.s) { ctx.lineWidth = g.w; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(g.s); }
    ctx.restore();
  }
}
function drawKey(x, y, d) {
  const ctx = PT.ctx;
  ctx.save();
  ctx.strokeStyle = '#E2B04A'; ctx.lineWidth = Math.max(1, d * 0.12);
  ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, d - ctx.lineWidth, d - ctx.lineWidth);
  ctx.fillStyle = '#F3D27A'; ctx.strokeStyle = '#6A4E12'; ctx.lineWidth = Math.max(1, d * 0.06);
  ctx.beginPath(); ctx.arc(x + d * 0.36, y + d * 0.5, d * 0.17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillRect(x + d * 0.5, y + d * 0.44, d * 0.34, d * 0.12);
  ctx.fillRect(x + d * 0.72, y + d * 0.5, d * 0.08, d * 0.16);
  ctx.restore();
}

function physics(dt) {
  let moving = false;
  for (let c = 0; c < PT.off.length; c++) {
    if (PT.off[c] > 0 || PT.vel[c] !== 0) {
      PT.vel[c] += GRAV * dt;
      PT.off[c] -= PT.vel[c] * dt;
      if (PT.off[c] <= 0) {
        if (PT.vel[c] > 3) { PT.vel[c] = -PT.vel[c] * 0.3; PT.off[c] = 0.0001; } else { PT.off[c] = 0; PT.vel[c] = 0; }
      }
      PT.dirty.add(c);
      moving = true;
    }
    const want = G && !isDoneCol(c) && coveredNow(c) ? 1 : 0;
    if (PT.cloth[c] !== want) {
      PT.cloth[c] = want ? 1 : Math.max(0, PT.cloth[c] - dt * 2.4);
      if (reduced() || skip) PT.cloth[c] = want;
      PT.dirty.add(c); moving = moving || PT.cloth[c] !== want;
    }
  }
  return moving;
}
const isDoneCol = (c) => PT.h[c] <= 0;
const coveredNow = (c) => !!L.cover[c] && PT.h[c] > 0 && !((c > 0 && PT.h[c - 1] === 0) || (c < L.W - 1 && PT.h[c + 1] === 0));

function drawDirty() {
  for (const c of PT.dirty) drawColumn(c);
  PT.dirty.clear();
}

// Particles: grains pouring into the jar on the ledge, and loose grains
// trickling down the slumping columns. A capped pool; none under reduced motion.
function spawn(x, y, vx, vy, col, life, kind) {
  if (PT.parts.length >= MAX_PARTS || reduced() || skip) return;
  PT.parts.push({ x, y, vx, vy, col, life, kind });
}
function pour(col, row, hex) {
  const cs = PT.dcs / PT.dpr;
  const x = (col + 0.5) * cs, y = (L.H - 0.5) * cs;
  for (let i = 0; i < 5; i++) spawn(x + (hash(col, row, i) - 0.5) * cs * 0.8, y + (hash(row, col, i) - 0.5) * cs * 0.6, (hash(i, row) - 0.5) * 18, 10 + hash(col, i) * 30, hex, 0.9, 'pour');
  // a loose grain or two tumbles down the slope at the top of the column
  const topY = (L.H - PT.h[col] - PT.off[col]) * cs;
  const left = col > 0 ? PT.h[col - 1] : 0, right = col < L.W - 1 ? PT.h[col + 1] : 0;
  const dir = left < right ? -1 : 1;
  if (PT.h[col] > 1 && hash(col, row, 3) < 0.6) spawn(x, topY + cs * 0.3, dir * (14 + hash(row, col) * 16), 0, PALETTE[L.cells[0][col]].hex, 1.2, 'trickle');
}
function drawFx(dt) {
  const ctx = PT.fctx;
  if (!ctx) return false;
  ctx.clearRect(0, 0, PT.cssW, PT.fxH);
  const cs = PT.dcs / PT.dpr;
  const s = Math.max(1.4, cs * 0.24);
  for (let i = PT.parts.length - 1; i >= 0; i--) {
    const p = PT.parts[i];
    p.life -= dt; p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    let dead = p.life <= 0 || p.y > PT.ledgeY + 6;
    if (p.kind === 'trickle') {
      const c = Math.max(0, Math.min(L.W - 1, Math.floor(p.x / cs)));
      const surf = (L.H - PT.h[c] - Math.max(0, PT.off[c])) * cs;
      if (p.y >= surf) dead = true;
    }
    if (dead) { PT.parts.splice(i, 1); continue; }
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  // little carriages riding the ledge
  for (const k of PT.carts) {
    const x = k.x * cs;
    ctx.fillStyle = 'rgba(255,253,246,.92)'; ctx.fillRect(x - 4, PT.ledgeY - 5, 8, 10);
    ctx.fillStyle = k.hex; ctx.fillRect(x - 3, PT.ledgeY - 1 - 5 * k.fill, 6, 1 + 5 * k.fill);
    ctx.fillStyle = '#9C7A4C'; ctx.fillRect(x - 2, PT.ledgeY - 7, 4, 2);
  }
  return PT.parts.length > 0 || PT.carts.length > 0;
}

let raf = 0, lastT = 0;
function kick() { if (!raf && visible && L) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
  if (!visible || !L) return;
  let more = false;
  try {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (TL) more = stepTimeline(now) || more;
    more = physics(dt) || more;
    drawDirty();
    more = drawFx(dt) || more;
  } catch (e) {
    console.error('The Lifting Table: a frame was skipped', e);
    if (TL) TL.skip = true;
    more = !!TL;
  }
  if (more) raf = requestAnimationFrame(frame);
}

// ---------- layout ----------
function sizePic() {
  const app = $('#lf-app');
  if (!app || !L) return;
  // Belt and bench share a row when every slot can stay 44 px wide or more
  // (counting the spare spot); otherwise the bench sits under the belt.
  const width = app.clientWidth || innerWidth;
  const rowW = Math.min(width, 480) - 24;
  $('#lf-table').classList.toggle('lf-stack', (L.slots + L.bench + 1) * 47 + 56 > rowW);
  const wAvail = Math.min(width, 480) - 24 - 10;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.id === 'lf-easel' || ch.hidden) continue;
    used += ch.offsetHeight; n++;
  }
  used += n * 5 + 6 + 10 + 14 + 10; // gaps, easel post, frame, ledge, breathing room
  const cs = getComputedStyle(app);
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const hAvail = (app.clientHeight || innerHeight) - padV - used;
  PT.cs = Math.max(4, Math.min(40, wAvail / L.W, hAvail / L.H));
  buildPainter();
  syncPainter(G.state);
}

// ---------- render (DOM) ----------
function jarHTML(j, { n = null, n2 = null, id = j.id, extra = '', hide = false } = {}) {
  const hasFill = n !== null;
  const tot = j.cap + (j.cap2 || 0);
  const f1 = hasFill ? n / tot : 0, f2 = hasFill ? (n + (n2 || 0)) / tot : 0;
  const full = hasFill && n >= j.cap && (!j.c2 || n2 >= j.cap2);
  const label = j.c2 ? (hasFill ? `${n}+${n2}` : `${j.cap}+${j.cap2}`) : hasFill ? `${n}/${j.cap}` : `${j.cap}`;
  const c2 = j.c2 || j.c;
  const cls = `lf-jar ${j.c2 ? 'lf-mix' : ''} ${full ? 'lf-full' : ''} ${hide ? 'lf-mystery' : ''} ${extra}`;
  return `<span class="${cls}" data-id="${id}" style="--jc:${PALETTE[j.c].hex};--jc2:${PALETTE[c2].hex};--mix:${jarHex(j)};color:${glyphInk(j.c)}">` +
    '<span class="lf-cork"></span><span class="lf-neck"></span>' +
    `<span class="lf-glass"><span class="lf-tint"></span><span class="lf-fill2" style="transform:scaleY(${f2})"></span><span class="lf-fill" style="transform:scaleY(${f1})"></span><span class="lf-blend"></span><span class="lf-band"></span><span class="lf-shine"></span>${hide ? '' : glyphSvg(j.c) + (j.c2 ? glyphSvg(j.c2) : '')}</span>` +
    `<span class="lf-num">${hide ? '?' : label}</span></span>`;
}
const jarName = (j) => (j.c2 ? `${cname(j.c)} and ${cname(j.c2)} mixing jar` : `${cname(j.c)} jar`);

const TIE = '<svg class="lf-tie" viewBox="0 0 30 22" aria-hidden="true"><path d="M2 4 C 10 18, 20 18, 28 6" fill="none" stroke="#8C6512" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 2"/><circle cx="15" cy="15" r="2.6" fill="#B08A5E"/></svg>';
const LOCK = '<svg class="lf-lock" viewBox="0 0 30 34" aria-hidden="true"><path d="M8 15v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#6A4E12" stroke-width="3.2"/><rect x="4" y="14" width="22" height="18" rx="4" fill="#E2B04A" stroke="#6A4E12" stroke-width="1.6"/><circle cx="15" cy="22" r="2.4" fill="#6A4E12"/><path d="M15 23v4" stroke="#6A4E12" stroke-width="2"/></svg>';

function render(s = G && G.state) {
  if (!ROOT || !L || !s || !$('#lf-belt')) return;
  const st = set();
  ROOT.classList.toggle('lf-glyphs', !!st.glyphs);
  const idx = LEVELS.indexOf(L);
  $('#lf-lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#lf-lvName').textContent = L.name;
  const gb = $('#lf-glyphBtn');
  gb.setAttribute('aria-pressed', String(!!st.glyphs));
  gb.innerHTML = glyphSvg('p', '').replace('<svg', '<svg fill="currentColor"');
  const sb = $('#lf-soundBtn');
  sb.setAttribute('aria-pressed', String(!!st.sound));
  sb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${st.sound ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;

  // shelf
  $('#lf-shelfCount').innerHTML = `Shelf <b>${s.shelf.length}</b>`;
  $('#lf-shelf').innerHTML = s.shelf.slice(-48).map((j) => `<span class="lf-mini" style="--jc:${jarHex(j)}"></span>`).join('');

  // belt and bench
  const table = $('#lf-table');
  table.style.setProperty('--beltfr', `${L.slots}fr`);
  table.style.setProperty('--benchfr', `${benchCap(L, s)}fr`);
  const belt = $('#lf-belt');
  belt.style.setProperty('--slots', L.slots);
  belt.classList.toggle('lf-fast', !!st.fast);
  let bh = '<span class="lf-tread"></span><span class="lf-roller lf-l"></span><span class="lf-roller lf-r"></span>';
  for (let i = 0; i < L.slots; i++) {
    const j = s.belt[i];
    if (j) {
      const waiting = !busy && !canLift(L, s, j);
      bh += `<button type="button" class="lf-slotbtn" data-tap data-where="belt" data-i="${i}" aria-label="${jarName(j)} on the belt, ${j.n + (j.n2 || 0)} of ${j.cap + (j.cap2 || 0)}${waiting ? ', waiting' : ''}. Tap to rest it on the bench.">${jarHTML(j, { n: j.n, n2: j.n2 || 0, extra: waiting ? 'lf-waiting' : '' })}</button>`;
    } else bh += '<span class="lf-spot"></span>';
  }
  belt.innerHTML = bh;
  const bench = $('#lf-bench');
  const bc = benchCap(L, s);
  bench.style.setProperty('--benchn', bc);
  let nh = '';
  for (let i = 0; i < bc; i++) {
    const j = s.bench[i];
    if (j) nh += `<button type="button" class="lf-slotbtn" data-tap data-where="bench" data-i="${i}" aria-label="${jarName(j)} resting on the bench, ${j.n + (j.n2 || 0)} of ${j.cap + (j.cap2 || 0)}. Tap to put it back on the belt.">${jarHTML(j, { n: j.n, n2: j.n2 || 0 })}</button>`;
    else nh += `<span class="lf-spot ${i >= L.bench ? 'lf-new' : ''}">${i >= L.bench ? 'spare' : ''}</span>`;
  }
  bench.innerHTML = nh;
  $('#lf-benchNote').textContent = `${s.bench.length}/${bc}`;
  $('#lf-beltNote').textContent = `${s.belt.length}/${L.slots}`;

  // lanes
  const lanes = $('#lf-lanes');
  lanes.style.setProperty('--lanes', L.lanes.length);
  let lh = '';
  const opened = [];
  L.lanes.forEach((lane, i) => {
    const p = s.lp[i];
    const f = frontJar(L, s, i);
    const open = laneOpen(L, s, i);
    if (open && lastOpen[i] === false) opened.push(i);
    lh += `<div class="lf-lane ${open ? '' : 'lf-locked'}" data-lane-box="${i}">`;
    if (f) {
      const unit = f.link ? 'tied pair' : 'jar';
      const label = `${jarName(f)}${f.link ? `, tied to a ${jarName(lane[p + 1])}` : ''}, holds ${f.cap + (f.cap2 || 0)}. ${open ? `Tap to set the ${unit} on the belt.` : 'This lane is locked until its key cell is lifted.'}`;
      lh += `<button type="button" class="lf-front" data-tap data-lane="${i}" aria-label="${label}">${jarHTML(f, { id: `${i}.${p}` })}${f.link ? TIE : ''}</button>`;
      lh += '<div class="lf-next">';
      for (let k = 1; k <= 2; k++) {
        const nj = lane[p + k];
        if (!nj) continue;
        const hide = nj.q && !(k === 1 && f.link);
        lh += jarHTML(nj, { id: `${i}.${p + k}`, hide });
      }
      lh += '</div>';
      const more = laneLeft(L, s, i) - 3;
      if (!open) lh += LOCK;
      else if (more > 0) lh += `<span class="lf-more">+${more}</span>`;
    } else {
      lh += '<span class="lf-done">All set out</span>';
    }
    lh += '</div>';
  });
  lanes.innerHTML = lh;
  lastOpen = L.lanes.map((_, i) => laneOpen(L, s, i));
  if (!reduced()) for (const i of opened) anim($(`[data-lane-box="${i}"] .lf-front`), [{ transform: 'scale(.85)' }, { transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });

  // buttons, message
  const stuck = !busy && isStuck(L, s);
  const showBack = !busy && !stepping && !isDone(s) && (stuck || dead) && G.past.length > 0;
  const sb2 = $('#lf-stuckBtn');
  // With "Back to solvable" on offer, "Start over" stays in the gallery sheet.
  sb2.hidden = !stuck || (showBack && !canNudge(s));
  sb2.textContent = canNudge(s) ? (showBack ? 'Spare spot' : 'Add a bench spot') : 'Start over';
  sb2.classList.toggle('btn-primary', !showBack);
  sb2.classList.toggle('btn-paper', showBack);
  $('#lf-backBtn').hidden = !showBack;
  $('#lf-hintBtn').hidden = stuck;
  $('#lf-undoBtn').disabled = !G.past.length || stepping;
  $('#lf-hintBtn').disabled = isDone(s) || stepping;
  const msgEl = $('#lf-msg');
  msgEl.textContent = busy ? 'Lifting…' : message(s);
  msgEl.classList.toggle('lf-hintmsg', !!(hinted && note && !busy));
  const row = $('.lf-msgrow');
  const shown = [...row.querySelectorAll('.btn')].filter((b) => !b.hidden).length;
  const wide = shown >= 3;
  // Three buttons (a dead end): the message takes its own line above them and
  // the painting makes room, once, when that layout comes or goes (never for a
  // message that is merely longer, so the painting does not jump).
  if (row.classList.contains('lf-wide') !== wide) {
    row.classList.toggle('lf-wide', wide);
    if (laidOut && !busy) requestAnimationFrame(() => { if (visible && L && G && !busy) sizePic(); });
  }
  laidOut = true;

  if (hinted && !busy) {
    const el = targetFor(hinted);
    if (el) el.querySelector('.lf-jar')?.classList.add('lf-hinted');
  }
}

function message(s) {
  if (note) return note;
  if (isDone(s)) return 'All lifted. Lovely work.';
  if (isStuck(L, s)) {
    if (!G.past.length) return 'The table is full for now. Start this painting fresh from the gallery wall.';
    return canNudge(s)
      ? 'The table is full for now. Back to solvable takes back just the moves it needs, or take one free spare bench spot.'
      : 'The table is full for now. Back to solvable takes back just the moves it needs.';
  }
  if (dead) return 'This one has gotten tangled: no order of jars clears it from here. Back to solvable takes back just the moves it needs.';
  const waiting = s.belt.filter((j) => !canLift(L, s, j));
  if (s.belt.length >= L.slots) {
    return s.bench.length < benchCap(L, s)
      ? 'The belt is full. Tap a waiting jar to rest it on the bench.'
      : 'Belt and bench are full. A bench jar can swap back in when its color shows.';
  }
  if (!s.moves) return 'Tap a jar at the bottom. It lifts its color from the bottom edge, and the paint above settles down.';
  if (waiting.length === 1) return `${jarName(waiting[0])} waits until its color reaches the bottom edge.`;
  if (waiting.length > 1) return `${waiting.length} jars are waiting for their colors to reach the bottom edge.`;
  return 'Lifting nicely. Choose the next jar.';
}

function targetFor(m) {
  if (m.t === 'place') return $(`#lf-lanes .lf-front[data-lane="${m.i}"]`);
  if (m.t === 'park') return $(`#lf-belt .lf-slotbtn[data-i="${m.i}"]`);
  return $(`#lf-bench .lf-slotbtn[data-i="${m.i}"]`);
}

// ---------- jar motion ----------
function snapRects() {
  const out = new Map();
  for (const el of $$('#lf-belt .lf-jar, #lf-bench .lf-jar, #lf-lanes .lf-jar')) out.set(el.dataset.id, el.getBoundingClientRect());
  return out;
}
async function flip(before, dur = 180) {
  if (reduced() || skip) return;
  const jobs = [];
  for (const el of $$('#lf-belt .lf-jar, #lf-bench .lf-jar, #lf-lanes .lf-front .lf-jar')) {
    const a = before.get(el.dataset.id);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const sc = b.width ? a.width / b.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.02) continue;
    jobs.push(anim(el, [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: 'none' }], { duration: dur, easing: 'cubic-bezier(.3,.7,.4,1)' }));
  }
  await Promise.all(jobs);
}
const jarEl = (id) => $(`#lf-belt .lf-jar[data-id="${id}"]`);
function setJarFill(el, j) {
  if (!el) return;
  const tot = j.cap + (j.cap2 || 0);
  const f = el.querySelector('.lf-fill'), f2 = el.querySelector('.lf-fill2');
  if (f) f.style.transform = `scaleY(${j.n / tot})`;
  if (f2) f2.style.transform = `scaleY(${(j.n + (j.n2 || 0)) / tot})`;
  const n = el.querySelector('.lf-num');
  if (n) n.textContent = j.c2 ? `${j.n}+${j.n2}` : `${j.n}/${j.cap}`;
  el.classList.remove('lf-waiting');
}

async function corkAndFly(id) {
  const el = jarEl(id);
  if (!el) return;
  el.classList.add('lf-full');
  sfx('pop');
  if (reduced() || skip) return;
  const r = el.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'lf-flying';
  pop.textContent = 'pop!';
  pop.style.cssText = `position:fixed;z-index:45;pointer-events:none;font:400 16px var(--font-display);color:#6A5A1E;text-shadow:0 1px 0 #fff;left:${r.left + r.width / 2}px;top:${r.top}px;transform:translate(-50%,-100%)`;
  document.body.append(pop);
  anim(pop, [{ opacity: 0, transform: 'translate(-50%, -80%)' }, { opacity: 1, transform: 'translate(-50%, -140%)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%, -210%)' }], { duration: 650, easing: 'ease-out' }).then(() => pop.remove());
  await anim(el.querySelector('.lf-cork'), [{ transform: 'translateY(-16px)', opacity: 0 }, { transform: 'translateY(2px)', opacity: 1, offset: 0.65 }, { transform: 'translateY(-2px)', offset: 0.85 }, { transform: 'none', opacity: 1 }], { duration: 170, easing: 'ease-in' });
  await anim(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.18, .9)', offset: 0.35 }, { transform: 'scale(.94, 1.08)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  const sr = $('#lf-shelf').getBoundingClientRect();
  const tx = sr.left + 6 - (r.left + r.width / 2), ty = sr.bottom - 10 - (r.top + r.height / 2);
  await anim(el, [
    { transform: 'none', opacity: 1 },
    { transform: `translate(${tx * 0.45}px, ${ty * 0.45 - 40}px) scale(.7) rotate(-12deg)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${tx}px, ${ty}px) scale(.22) rotate(-20deg)`, opacity: 0.4 },
  ], { duration: 340, easing: 'cubic-bezier(.45,0,.7,.6)', fill: 'forwards' });
}

// ---------- the belt run: one timeline for all its passes ----------
let TL = null;
function startTimeline(staged, passes) {
  const d = JSON.parse(JSON.stringify(staged));
  const rm = reduced();
  const speed = set().fast ? 0.5 : 1;
  const per = rm ? 60 : Math.max(60, Math.min(320, 820 / passes.length)) * speed;
  const events = [];
  let t = 0;
  passes.forEach((pass, p) => {
    const beltLen = Math.max(1, ...pass.lifts.map((x) => x.tick - x.col + 1));
    const span = L.W + beltLen;
    for (const lift of pass.lifts) events.push({ at: t + (lift.tick / span) * per, lift });
    events.push({ at: t + per, pass: p, filled: pass.filled, start: t, span, beltLen });
    t += per;
  });
  return new Promise((resolve) => {
    TL = { t0: performance.now(), dur: t, events, i: 0, d, resolve, passes, per, total: 0, skip: false, corks: [], passStart: 0 };
    // If frames stop (a hidden tab), finish the run anyway so the table never stays busy.
    const guard = setTimeout(() => { if (TL && TL.resolve === resolve) { TL.skip = true; stepTimeline(performance.now()); } }, t + 2500);
    TL.guard = guard;
    $('#lf-belt').classList.add('lf-running');
    kick();
  });
}
function stepTimeline(now) {
  const tl = TL;
  const el = tl.skip || skip ? Infinity : now - tl.t0;
  while (tl.i < tl.events.length && tl.events[tl.i].at <= el) fire(tl, tl.events[tl.i++]);
  // carriages: one per belt jar, riding along the ledge for the current pass
  PT.carts.length = 0;
  if (!reduced() && !(tl.skip || skip) && el < tl.dur) {
    const p = Math.min(tl.passes.length - 1, Math.floor(el / tl.per));
    const local = clamp01((el - p * tl.per) / tl.per);
    const span = L.W + tl.d.belt.length;
    tl.d.belt.forEach((j, k) => {
      const x = local * span - k - 0.5;
      if (x > -1 && x < L.W + 1) PT.carts.push({ x, hex: jarHex(j), fill: (j.n + (j.n2 || 0)) / (j.cap + (j.cap2 || 0)) });
    });
  }
  if (tl.i >= tl.events.length) {
    clearTimeout(tl.guard);
    TL = null;
    PT.carts.length = 0;
    Promise.all(tl.corks).then(tl.resolve);
    return false;
  }
  return true;
}
let lastPlink = 0;
function fire(tl, ev) {
  const d = tl.d;
  if (ev.lift) {
    const { col, row, id, c } = ev.lift;
    PT.h[col] = row;
    if (!reduced() && !skip && !tl.skip) { PT.off[col] = Math.min(6, PT.off[col] + 1); pour(col, row, PALETTE[c].hex); } else { PT.off[col] = 0; PT.vel[col] = 0; }
    PT.dirty.add(col);
    const j = d.belt.find((x) => x.id === id);
    if (j) { if (c === j.c && j.n < j.cap) j.n++; else j.n2++; setJarFill(jarEl(id), j); }
    tl.total++;
    const now = performance.now();
    if (now - lastPlink > 45 && !tl.skip) { lastPlink = now; sfx('plink', L.colors.indexOf(c) + Math.min(10, tl.total / 4)); }
  } else if (ev.filled && ev.filled.length) {
    for (const id of ev.filled) tl.corks.push(corkAndFly(id));
    for (const id of ev.filled) {
      const j = d.belt.find((x) => x.id === id);
      if (j) d.shelf.push(j);
    }
    d.belt = d.belt.filter((x) => !ev.filled.includes(x.id));
  }
}

function showCombo(n) {
  if (n < 12 || reduced()) return;
  const word = n >= 45 ? 'Grand sweep' : n >= 25 ? 'Lovely sweep' : 'Nice sweep';
  const el = document.createElement('div');
  el.className = 'lf-combo lf-flying';
  el.textContent = `${word} · ${n} cells`;
  $('#lf-easel').append(el);
  sfx('chord');
  anim(el, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.06)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -55%) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%, -75%) scale(1)' }], { duration: 1300, easing: 'ease-out' }).then(() => el.remove());
}

// ---------- the game state, through the sim ----------
function syncG() {
  const cur = LS().current(S());
  G = cur ? { state: cur.s, past: cur.past } : null;
  lastSig = sigOfGame();
  return cur;
}
function sigOfGame() {
  const g = S().lift && S().lift.game;
  return g ? `${g.level}|${g.moves.length}|${g.moves[g.moves.length - 1] || ''}` : 'none';
}

// ---------- actions ----------
function act(m) {
  // Lane taps queue up (lane numbers never shift); belt and bench slots can
  // shift while jars leave, so those taps only fast-forward.
  if (stepping) return;
  if (busy) { if (m.t === 'place') queued = m; pendingHint = false; skipAll(); return; }
  if (!G) return;
  note = '';
  if (!isLegal(L, G.state, m)) { explainBlocked(m); return; }
  hinted = null;
  dead = false;
  const res = C.game.act(LS().move, { move: encodeMove(m) });
  if (!res || !res.ok) { syncG(); render(); return; }
  const staged = res.staged;
  syncG();
  run(async () => {
    const before = snapRects();
    render(staged);
    $('#lf-msg').textContent = res.passes.length ? 'Lifting…' : message(staged);
    await flip(before);
    if (res.passes.length) {
      const total = res.passes.reduce((a, p) => a + p.lifts.length, 0);
      await startTimeline(staged, res.passes);
      showCombo(total);
      const b2 = snapRects();
      render(G.state);
      await flip(b2, 200);
    }
  });
}

function explainBlocked(m) {
  const why = blockedReason(L, G.state, m);
  note = why === 'locked' ? 'This lane opens when you lift its key cell, the one with the little brass key.'
    : why === 'tied' ? 'These two jars are tied together, so they need two free places on the belt.'
      : why === 'bench' ? 'The bench is full. Bring a jar back to the belt first.'
        : 'The belt is full. Rest a belt jar on the bench to make room.';
  render();
  if (why === 'locked') {
    const k = L.locks[m.i];
    if (k) { anim($('#lf-frame'), [{ boxShadow: '0 0 0 0 rgba(226,176,74,0)' }, { boxShadow: '0 0 0 5px rgba(226,176,74,.7)' }, { boxShadow: '0 0 0 0 rgba(226,176,74,0)' }], { duration: reduced() ? 0 : 700 }); }
    return;
  }
  if (G.state.belt.length >= L.slots || why === 'tied') anim($('#lf-belt'), [{ transform: 'translateX(0)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: reduced() ? 0 : 260 });
}

function doUndo() {
  if (stepping) return;
  if (busy) { pendingHint = false; skipAll(); return; }
  if (!G || !G.past.length) return;
  note = ''; hinted = null; dead = false;
  const before = snapRects();
  C.game.act(LS().undo);
  syncG();
  syncPainter(G.state);
  render();
  flip(before, 200);
  scheduleDeadCheck();
}

// ---------- dead ends and "Back to solvable" (0.4.1) ----------
/** After every move: do the rules prove this painting can't be cleared from here? (small node cap, cached by position) */
function scheduleDeadCheck() {
  clearTimeout(deadTimer);
  deadTimer = setTimeout(() => {
    deadTimer = 0;
    if (!visible || !G || busy || stepping || revealing) return;
    let d = false;
    try { d = !!LS().deadEnd(S()); } catch (e) { console.error(e); }
    if (d !== dead) { dead = d; render(); }
  }, 40);
}

/**
 * Back to solvable: walk back through her moves (a few positions per slice, so
 * the table stays responsive) to the latest one the rules prove solvable, then
 * take the moves back quickly, one after another. The spare bench spot is not
 * spent. From the gallery menu on a painting that is fine, it says so.
 */
async function doBack() {
  if (!G || stepping) return;
  if (busy) { skipAll(); return; }
  const states = LS().history(S());
  const myGen = gen;
  stepping = true;
  hinted = null;
  note = 'Finding a good spot to step back to…';
  render();
  let idx = states.length - 1;
  try {
    const it = R.backToSolvableSteps(L, states);
    for (;;) {
      const t0 = performance.now();
      let r;
      do { r = it.next(); } while (!r.done && performance.now() - t0 < 14);
      if (r.done) { idx = r.value; break; }
      await nap(0);
      if (myGen !== gen) return;
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (myGen !== gen) stepping = false;
  }
  const steps = states.length - 1 - idx;
  if (steps <= 0) {
    stepping = false;
    dead = false;
    note = 'You\u2019re on track. This painting can still be cleared from here.';
    render();
    return;
  }
  try {
    if (reduced()) {
      C.game.act(LS().backToSolvable, { index: idx });
      syncG();
      syncPainter(G.state);
    } else {
      const gap = Math.max(70, Math.min(160, 1100 / steps));
      for (let k = 0; k < steps; k++) {
        if (myGen !== gen) return;
        const before = snapRects();
        C.game.act(LS().undo);
        syncG();
        syncPainter(G.state);
        note = `Stepping back… ${k + 1} of ${steps}`;
        render();
        flip(before, Math.min(160, gap));
        sfx('plink', steps - k);
        await nap(gap);
      }
    }
  } finally {
    if (myGen === gen) stepping = false;
  }
  if (myGen !== gen) return;
  dead = false;
  note = `Took back ${plural(steps, 'move', 'moves')}. This painting can be cleared from here.`;
  render();
  try { if (C.haptics) C.haptics.light(); } catch { /* fine */ }
  scheduleDeadCheck();
}

function restart() {
  if (busy) return;
  startLevel(L.id, { fresh: true });
}

function doStuck() {
  if (busy || stepping || !G) return;
  if (canNudge(G.state)) {
    C.game.act(LS().nudge);
    syncG();
    note = 'A spare bench spot, just for this painting.';
    hinted = null;
    dead = false;
    render();
    scheduleDeadCheck();
  } else restart();
}

/** One line that names the jar the hint points at (and why, when it is a best guess). */
function hintLine(hn) {
  const m = hn.move;
  const s = G.state;
  const guess = hn.kind === 'guess';
  if (m.t === 'place') {
    const u = frontUnit(L, s, m.i);
    const nm = u.length > 1 ? `tied ${jarName(u[0])} and ${jarName(u[1])}` : jarName(u[0]);
    return guess ? `Try the ${nm} next: its color is close to the bottom edge.` : `Try the ${nm} next.`;
  }
  if (m.t === 'park') {
    const nm = jarName(s.belt[m.i]);
    return guess ? `To make room, try resting the ${nm} on the bench.` : `Try resting the ${nm} on the bench.`;
  }
  return `Try bringing the ${jarName(s.bench[m.i])} back to the belt.`;
}

/**
 * Hint (0.4.1). Always visible feedback: "Looking…" at once, then the jar glows
 * and the line names it. A tap while the belt runs fast-forwards it and answers
 * as soon as it settles (it used to only fast-forward, so Hint seemed to do
 * nothing). When the solver can't decide within its budget the hint is a
 * sensible guess, never nothing; a proven dead end says so and offers "Back to
 * solvable".
 */
function doHint() {
  if (!G || stepping) return;
  if (busy) { pendingHint = true; skipAll(); return; }
  if (isDone(G.state)) return;
  hinted = null;
  note = 'Looking…';
  render();
  const myGen = gen;
  const key = sigOfGame();
  setTimeout(() => {
    if (myGen !== gen || !G || busy || stepping || key !== sigOfGame()) return;
    let hn;
    try { hn = bestHint(L, G.state); } catch (e) {
      console.error(e);
      try { hn = guessMove(L, G.state); } catch { hn = null; }
    }
    if (!hn || hn.kind === 'dead') {
      dead = true;
      hinted = null;
      note = canNudge(G.state)
        ? 'This one has gotten tangled: no order of jars clears it from here. Back to solvable takes back just the moves it needs, or take a spare bench spot.'
        : 'This one has gotten tangled: no order of jars clears it from here. Back to solvable takes back just the moves it needs.';
      render();
      const b = $('#lf-backBtn');
      if (b && !b.hidden) anim(b, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: reduced() ? 0 : 320, easing: 'ease-out' });
      return;
    }
    if (hn.kind === 'none') { note = ''; render(); return; }
    hinted = hn.move;
    note = hintLine(hn);
    render();
    const el = targetFor(hinted);
    if (el) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* fine */ }
      const jar = el.querySelector('.lf-jar');
      if (jar && !reduced()) anim(jar, [{ transform: 'none' }, { transform: 'translateY(-5px) scale(1.06)' }, { transform: 'none' }], { duration: 360, easing: 'ease-out' });
    }
  }, 20);
}

let revealing = false;
async function afterMove() {
  if (!G || !isDone(G.state) || revealing) return;
  const myGen = gen;
  revealing = true;
  try {
    if (!reduced()) {
      const pill = document.createElement('div');
      pill.className = 'lf-reveal lf-flying';
      pill.textContent = 'The bare canvas, and the sketch beneath';
      $('#lf-easel').append(pill);
      sfx('chord');
      await anim(pill, [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -6px)' }], { duration: 1500, easing: 'ease-out' });
      pill.remove();
    }
  } finally {
    revealing = false;
    if (myGen === gen && visible) openFinish();
  }
}

// ---------- sound (soft, optional; through ctx.audio, so it also follows the game's sound setting) ----------
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
function sfx(kind, k = 0) {
  if (!set().sound || skip || !C || !C.audio) return;
  try {
    if (kind === 'plink') C.audio.tink(440 * 2 ** (PENTA[Math.floor(k) % PENTA.length] / 12), 0, 0.12);
    else if (kind === 'pop') C.audio.cork();
    else if (kind === 'chord') C.audio.chord([0.55, 0.68, 0.8]);
  } catch { /* sound is a nicety */ }
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  if (TL) { TL.skip = true; }
  if (fresh || id !== S().lift.cur) C.game.act(LS().startPainting, { levelId: id });
  else C.game.act(LS().openEasel);
  syncG();
  L = levelById(S().lift.cur) || LEVELS[0];
  if (!G) { C.game.act(LS().startPainting, { levelId: L.id }); syncG(); }
  hinted = null; note = ''; dead = false; pendingHint = false; stepping = false; laidOut = false;
  lastOpen = L.lanes.map((_, i) => laneOpen(L, G.state, i));
  render();
  sizePic();
  maybeIntro();
  scheduleDeadCheck();
}

// ---------- sheets ----------
function openSheet(sel) {
  const el = $(sel);
  if (!el) return;
  el.hidden = false;
  const p = el.querySelector('.lf-panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { if (el) el.hidden = true; }
function closeAllSheets() { for (const sh of $$('.lf-sheet')) sh.hidden = true; }

function thumb(Lv, maxW, maxH) {
  const cv = document.createElement('canvas');
  const k = Math.max(1, Math.floor(Math.min(maxW / Lv.W, maxH / Lv.H)));
  cv.width = Lv.W * k; cv.height = Lv.H * k;
  const ctx = cv.getContext('2d');
  for (let r = 0; r < Lv.H; r++) for (let c = 0; c < Lv.W; c++) {
    ctx.fillStyle = PALETTE[Lv.cells[r][c]].hex;
    ctx.fillRect(c * k, r * k, k, k);
  }
  return cv;
}

function openLevels() {
  const wall = $('#lf-wall');
  wall.innerHTML = '';
  const done = (S().lift && S().lift.done) || {};
  const firstOf = {};
  LEVELS.forEach((Lv, i) => { for (const m of Lv.mechanics) if (!(m in firstOf)) firstOf[m] = i; });
  BANDS.forEach((band, bi) => {
    const to = bi + 1 < BANDS.length ? BANDS[bi + 1].from : LEVELS.length;
    const h3 = document.createElement('h3');
    h3.textContent = band.name;
    const ul = document.createElement('ul');
    ul.className = 'lf-gallery';
    for (let i = band.from; i < to; i++) {
      const Lv = LEVELS[i];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.level = Lv.id;
      b.setAttribute('data-tap', '');
      b.setAttribute('aria-current', String(Lv === L));
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${done[Lv.id] ? ', lifted' : ''}${fresh.length ? `, introduces ${fresh.map((m) => MECHANICS[m].name.toLowerCase()).join(' and ')}` : ''}`);
      const fr = document.createElement('span');
      fr.className = 'lf-fr';
      fr.append(thumb(Lv, 72, 90));
      if (done[Lv.id]) { const t = document.createElement('span'); t.className = 'lf-tick'; t.textContent = '✓'; fr.append(t); }
      b.append(fr);
      const t = document.createElement('span');
      t.className = 'lf-t';
      t.innerHTML = `<b>${i + 1}.</b> ${esc(Lv.name)}`;
      b.append(t);
      if (fresh.length) { const c = document.createElement('span'); c.className = 'lf-chip'; c.textContent = `new: ${MECHANICS[fresh[0]].name.toLowerCase()}`; b.append(c); }
      li.append(b);
      ul.append(li);
    }
    wall.append(h3, ul);
  });
  $('#lf-restartBtn').textContent = 'Start this painting over';
  $('#lf-fastBtn').setAttribute('aria-pressed', String(!!set().fast));
  openSheet('#lf-levelSheet');
  $('#lf-levelSheet [aria-current="true"]')?.scrollIntoView({ block: 'center' });
}

function coinsText(n) {
  const v = Number.isFinite(n) ? n : 0;
  const x = v < 100 ? Math.max(v > 0 ? 1 : 0, Math.round(v)) : v;
  return C.format && C.format.num ? C.format.num(x) : String(Math.round(x));
}

/** The finish sheet's reward line: what this painting paid (state.lift.last). */
function rewardHtml() {
  const last = S().lift && S().lift.last;
  if (!last || last.levelId !== L.id) return '';
  const coins = (last.coins || 0) + (last.sold || 0);
  const stock = (last.stock || []).filter((it) => it.jars > 0);
  const name = (id) => { try { return C.sim.displayName(S(), id); } catch { return id; } };
  const hex = (id) => { try { return C.sim.economy.colorHex(id) || '#B7BDB3'; } catch { return '#B7BDB3'; } };
  let out = `<span class="lf-coins" data-lf-coins><i aria-hidden="true"></i>+${esc(coinsText(coins))} coins</span>`;
  for (const it of stock.slice(0, 6)) out += `<span class="lf-st"><i style="background:${esc(hex(it.colorId))}" aria-hidden="true"></i>${esc(plural(Math.round(it.jars), 'jar', 'jars'))} of ${esc(name(it.colorId))}</span>`;
  return out;
}

function openFinish() {
  if (!G || !isDone(G.state) || !$('#lf-finishSheet') || !$('#lf-finishSheet').hidden) return;
  $('#lf-finTitle').textContent = `Your ${L.noun}, lifted`;
  const s = G.state;
  $('#lf-finSub').textContent = `${s.shelf.length} jars of pigment, corked and on the shelf.`;
  const rw = rewardHtml();
  const rEl = $('#lf-finReward');
  rEl.innerHTML = rw;
  rEl.hidden = !rw;
  const cv = thumb(L, Math.min(240, (ROOT.clientWidth || innerWidth) - 80), 230);
  cv.id = 'lf-finThumb';
  $('#lf-finThumb').replaceWith(cv);
  $('#lf-finJars').innerHTML = s.shelf.map((j) => jarHTML(j, { n: j.cap, n2: j.cap2 || 0, id: `f${j.id}` })).join('');
  const next = levelById(LS().nextLevelId(S(), L.id)) || LEVELS[0];
  $('#lf-finNext').textContent = `Next: ${next.name}`;
  $('#lf-finNext').dataset.level = next.id;
  openSheet('#lf-finishSheet');
  if (!reduced()) {
    anim(cv, [{ opacity: 0, transform: 'scale(.94)', filter: 'sepia(1) brightness(1.15)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 700, easing: 'ease-out' });
    $$('#lf-finJars .lf-jar').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(1100, i * 18), fill: 'backwards', easing: 'ease-out' }));
    const coinEl = $('[data-lf-coins]');
    if (coinEl && C.audio && set().sound) { try { C.audio.coins(4); } catch { /* fine */ } }
  }
}

// Intro cards: one line for each mechanic the first time it appears.
const ICON = {
  mystery: '<svg viewBox="0 0 52 52"><rect x="12" y="10" width="28" height="36" rx="8" fill="#D9C7A6" stroke="#6A5235" stroke-width="2"/><text x="26" y="36" text-anchor="middle" font-size="22" font-family="Georgia" fill="#6A5235">?</text></svg>',
  linked: '<svg viewBox="0 0 52 52"><rect x="4" y="14" width="18" height="28" rx="6" fill="#b8433a"/><rect x="30" y="14" width="18" height="28" rx="6" fill="#3e6a9e"/><path d="M13 22 C 22 36, 30 36, 39 22" fill="none" stroke="#8C6512" stroke-width="2.4" stroke-dasharray="3 2"/></svg>',
  mixing: '<svg viewBox="0 0 52 52"><rect x="12" y="8" width="28" height="38" rx="8" fill="#FFFDF6" stroke="#6A5235" stroke-width="2"/><rect x="14" y="30" width="24" height="14" rx="5" fill="#b8433a"/><rect x="14" y="20" width="24" height="10" fill="#d39b2a"/></svg>',
  cloth: '<svg viewBox="0 0 52 52"><rect x="6" y="8" width="40" height="38" fill="#8babc5"/><rect x="18" y="6" width="14" height="40" fill="rgba(250,244,228,.85)"/><path d="M18 6h14" stroke="#B08A5E" stroke-width="3"/></svg>',
  key: '<svg viewBox="0 0 52 52"><circle cx="18" cy="26" r="8" fill="#F3D27A" stroke="#6A4E12" stroke-width="2"/><path d="M26 26h18M38 26v7M43 26v5" stroke="#6A4E12" stroke-width="3"/></svg>',
  belt3: '<svg viewBox="0 0 52 52"><rect x="4" y="18" width="44" height="18" rx="6" fill="#4A3F36"/><g fill="#eee4c8">' + [10, 22, 34].map((x) => `<rect x="${x}" y="21" width="8" height="12" rx="2"/>`).join('') + '</g></svg>',
  bench2: '<svg viewBox="0 0 52 52"><rect x="8" y="22" width="36" height="10" rx="4" fill="#C9B08A"/><path d="M12 32v10M40 32v10" stroke="#8E6A42" stroke-width="3"/><g fill="#eee4c8"><rect x="13" y="10" width="10" height="12" rx="3"/><rect x="29" y="10" width="10" height="12" rx="3"/></g></svg>',
};
let introFresh = [];
function maybeIntro() {
  const seen = (S().lift && S().lift.seenIntro) || {};
  const fresh = L.mechanics.filter((m) => !seen[m]);
  if (!fresh.length) return;
  introFresh = fresh;
  $('#lf-introTitle').textContent = fresh.length > 1 ? 'Some new things on the table' : 'Something new on the table';
  $('#lf-introBody').innerHTML = fresh.map((m) => `<div class="lf-item">${ICON[m]}<p><strong>${MECHANICS[m].name}</strong>${MECHANICS[m].line}</p></div>`).join('');
  openSheet('#lf-introSheet');
}

// How this works: three short steps.
const ILL = {
  pick: `<svg class="lf-ill" viewBox="0 0 320 120" aria-hidden="true">
    <rect x="20" y="8" width="280" height="38" rx="10" fill="#4A3F36"/>
    <g>${[0, 1, 2, 3].map((i) => `<rect x="${36 + i * 68}" y="14" width="36" height="26" rx="6" fill="none" stroke="rgba(255,250,235,.25)" stroke-dasharray="4 3" stroke-width="2"/>`).join('')}</g>
    ${[['#b8433a', 60], ['#3e6a9e', 160], ['#d39b2a', 260]].map(([c, x]) => `<rect x="${x - 16}" y="70" width="32" height="38" rx="7" fill="${c}" opacity=".35" stroke="rgba(42,38,34,.4)" stroke-width="1.5"/><rect x="${x - 16}" y="70" width="32" height="7" rx="3" fill="${c}"/>`).join('')}
    <path d="M160 64 V50" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M152 56l8-9 8 9" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  lift: `<svg class="lf-ill" viewBox="0 0 320 140" aria-hidden="true">
    ${[0, 1, 2, 3, 4, 5, 6].map((c) => { const hh = [3, 4, 2, 4, 4, 3, 4][c]; return [0, 1, 2, 3].map((r) => (r < 4 - hh ? `<rect x="${90 + c * 20}" y="${6 + r * 20}" width="20" height="20" fill="#EFE7D6"/>` : `<rect x="${90 + c * 20}" y="${6 + r * 20}" width="20" height="20" fill="${r === 3 && c % 3 === 0 ? '#b8433a' : '#8babc5'}"/>`)).join(''); }).join('')}
    <rect x="86" y="88" width="148" height="7" rx="3" fill="#B48A5A"/>
    <path d="M70 112 H250" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M242 104l9 8-9 8" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="160" cy="72" r="2.4" fill="#8babc5"/><circle cx="163" cy="80" r="2" fill="#8babc5"/>
  </svg>`,
  plan: `<svg class="lf-ill" viewBox="0 0 320 120" aria-hidden="true">
    <rect x="10" y="10" width="180" height="46" rx="10" fill="#4A3F36"/>
    ${['#b8433a', '#3e6a9e', '#758054', '#d39b2a'].map((c, i) => `<rect x="${22 + i * 42}" y="16" width="28" height="34" rx="6" fill="#FFFDF6"/><rect x="${23 + i * 42}" y="${32 - i * 3}" width="26" height="${17 + i * 3}" rx="5" fill="${c}"/>`).join('')}
    <rect x="204" y="10" width="106" height="46" rx="10" fill="#C9B08A"/>
    ${[0, 1].map((i) => `<rect x="${216 + i * 46}" y="16" width="34" height="34" rx="7" fill="none" stroke="rgba(42,38,34,.25)" stroke-dasharray="4 3" stroke-width="2"/>`).join('')}
    <path d="M150 62 C 170 96, 220 96, 236 58" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
  </svg>`,
};
const HOW = [
  { t: 'Pick a jar', ill: 'pick', p: 'A painting has come into the workshop, and you lift its pigments back out into jars. Tap the front jar of a lane to set it on the belt. You can see the next two jars in each lane, so you can plan ahead.' },
  { t: 'Paint lifts from the bottom', ill: 'lift', p: 'Jars ride the belt along the bottom edge. Over each column, a jar lifts the lowest cell if it is the jar\'s color, one cell per column each time around, and the paint above settles down into the gap. A full jar is corked with a pop and goes to the shelf.' },
  { t: 'Room to plan', ill: 'plan', p: 'A jar whose color hasn\'t reached the bottom yet waits on the belt. Tap a belt jar to rest it on the bench, and tap it there to bring it back. Undo is free, there are no timers, and there\'s no way to lose. Later paintings bring new jars and surprises, one at a time.' },
];
function renderHow() {
  const st = HOW[howStep];
  $('#lf-howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#lf-howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'lf-on' : ''}"></i>`).join('');
  $('#lf-howBack').disabled = howStep === 0;
  $('#lf-howNext').textContent = howStep === HOW.length - 1 ? 'Start lifting' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#lf-howSheet'); }

// ---------- markup ----------
function lockedSkeleton() {
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Lifting Table</div><div class="subtitle">Paintings lifted back into jars</div></div><div class="spacer"></div></div>
<div class="screen-body"><div class="lf-closed"><div class="card" style="padding:16px;gap:10px">
<div class="h3">The easel is waiting</div>
<p class="hint">A painting comes into the workshop, and you lift its pigments back out into jars along a little belt. Each painting you clear pays coins and paint.</p>
<div data-lock>${unlockTag(C, 'lift', { cls: 'pz-tag' })}</div></div></div></div>`);
  built = false;
}

function skeleton() {
  const btn = (id, label, attrs = '') => `<button type="button" class="btn btn-paper small" data-tap id="${id}"${attrs}>${label}</button>`;
  const how = C.guide && C.guide.howThisWorksHtml ? String(C.guide.howThisWorksHtml('lift', 'Show me on the table')) : '';
  ROOT.innerHTML = `<div class="screen-head lf-head">${String(backButton('Back to the puzzle table'))}
<button type="button" class="btn btn-paper small lf-levelbtn" data-tap id="lf-levelsBtn" aria-haspopup="dialog"><span class="lf-no" id="lf-lvNo">1/${LEVELS.length}</span><span class="lf-nm" id="lf-lvName"></span><span class="lf-chev" aria-hidden="true">&#9662;</span></button>
<button type="button" class="btn btn-paper small lf-tog" data-tap id="lf-soundBtn" aria-pressed="false" aria-label="Soft sounds"></button>
<button type="button" class="btn btn-paper small lf-tog" data-tap id="lf-glyphBtn" aria-pressed="true" aria-label="Color symbols"></button>
<button type="button" class="btn btn-paper small lf-tog" data-tap id="lf-howBtn" aria-haspopup="dialog" aria-label="How this works">?</button>
</div>
<div class="screen-body lf-app" id="lf-app">
<div class="lf-shelfrow"><span id="lf-shelfCount">Shelf</span><div id="lf-shelf" aria-hidden="true"></div></div>
<section class="lf-easel" id="lf-easel" aria-label="The painting" data-coach="lift-easel">
<div class="lf-frame" id="lf-frame"><canvas id="lf-pic" role="img" aria-label="The painting"></canvas></div>
<div class="lf-ledge" id="lf-ledge" aria-hidden="true"></div>
<canvas id="lf-fx" aria-hidden="true"></canvas>
</section>
<div class="lf-table" id="lf-table">
<section aria-label="The belt"><p class="lf-lbl">Belt <span id="lf-beltNote">rides the bottom edge</span></p><div class="lf-rail" id="lf-belt"></div></section>
<section aria-label="The bench"><p class="lf-lbl">Bench <span id="lf-benchNote"></span></p><div class="lf-rail" id="lf-bench"></div></section>
</div>
<div class="lf-msgrow" data-coach="lift-msg">
<p id="lf-msg" role="status" aria-live="polite"></p>
${btn('lf-stuckBtn', 'Add a bench spot', ' hidden').replace('btn-paper', 'btn-primary')}
${btn('lf-backBtn', 'Back to solvable', ' hidden').replace('btn-paper', 'btn-primary')}
${btn('lf-hintBtn', 'Hint')}
${btn('lf-undoBtn', 'Undo')}
</div>
<section class="lf-lanes" id="lf-lanes" aria-label="Jars waiting to go on the belt" data-coach="lift-lanes"></section>
</div>

<div class="lf-sheet" id="lf-levelSheet" role="dialog" aria-modal="true" aria-labelledby="lf-lvTitle" hidden>
<div class="lf-panel">
<button type="button" class="lf-iconbtn lf-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="lf-lvTitle">The gallery wall</h2>
<p class="hint" style="margin:0">Any painting, in any order.</p>
<div class="lf-settings">${btn('lf-backMenuBtn', 'Back to solvable')}${btn('lf-restartBtn', 'Start this painting over')}${btn('lf-fastBtn', 'Fast belt', ' aria-pressed="false"')}</div>
<div class="lf-wall" id="lf-wall"></div>
</div></div>

<div class="lf-sheet" id="lf-howSheet" role="dialog" aria-modal="true" aria-labelledby="lf-howTitle" hidden>
<div class="lf-panel lf-how">
<button type="button" class="lf-iconbtn lf-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="lf-howTitle">How this works</h2>
<div id="lf-howBody"></div>
<div class="lf-steps" id="lf-howDots"></div>
<div class="lf-row2">${btn('lf-howBack', 'Back')}${btn('lf-howNext', 'Next').replace('btn-paper', 'btn-primary')}</div>
${how}
<p class="hint" style="margin:12px 0 0;font-size:13px;color:var(--ink-soft)">Some paintings started as images from a local image model, then were turned into pixels by hand-tuned tools.</p>
</div></div>

<div class="lf-sheet" id="lf-introSheet" role="dialog" aria-modal="true" aria-labelledby="lf-introTitle" hidden>
<div class="lf-panel lf-intro">
<h2 id="lf-introTitle">Something new on the table</h2>
<div id="lf-introBody"></div>
<button type="button" class="btn btn-primary" data-tap id="lf-introOk" style="width:100%;margin-top:8px">Lovely, let's lift</button>
</div></div>

<div class="lf-sheet" id="lf-finishSheet" role="dialog" aria-modal="true" aria-labelledby="lf-finTitle" hidden>
<div class="lf-panel lf-finish">
<h2 id="lf-finTitle">Your painting, lifted</h2>
<p class="muted" id="lf-finSub" style="margin:0"></p>
<canvas id="lf-finThumb"></canvas>
<div class="lf-jarrow" id="lf-finJars"></div>
<div class="lf-reward" id="lf-finReward" aria-live="polite" hidden></div>
${btn('lf-finNext', 'Next painting').replace('btn-paper', 'btn-primary')}
${btn('lf-finAgain', 'Lift this one again')}
${btn('lf-finAll', 'The gallery wall')}
</div></div>`;
  built = true;
}

// ---------- wiring (one delegated listener) ----------
let restartArmed = 0;
function onClick(e) {
  if (!ROOT || !e.target || !e.target.closest) return;
  const t = e.target;
  const unlockBtn = t.closest('[data-action="unlock-open"]');
  if (unlockBtn && ROOT.contains(unlockBtn)) { ensureWorkshopStyles(); openUnlockSheet(C, 'lift', { host: ROOT }); return; }
  if (!built) return;
  // sheets: the backdrop or a close button
  const sh = t.closest('.lf-sheet');
  if (sh && (t === sh || t.closest('[data-close]'))) { closeSheet(sh); return; }
  if (t.closest('[data-guide-replay]')) { closeAllSheets(); return; }
  const lv = t.closest('#lf-wall [data-level]');
  if (lv) { closeSheet($('#lf-levelSheet')); if (lv.dataset.level !== L.id) startLevel(lv.dataset.level, { fresh: true }); return; }
  const id = (t.closest('button[id]') || {}).id || '';
  switch (id) {
    case 'lf-undoBtn': doUndo(); return;
    case 'lf-stuckBtn': doStuck(); return;
    case 'lf-hintBtn': doHint(); return;
    case 'lf-backBtn': doBack(); return;
    case 'lf-backMenuBtn': closeSheet($('#lf-levelSheet')); doBack(); return;
    case 'lf-levelsBtn': if (!busy) openLevels(); return;
    case 'lf-howBtn': if (!busy) openHow(); return;
    case 'lf-glyphBtn': C.game.act(LS().setSetting, { key: 'glyphs', value: !set().glyphs }); render(); if (G) syncPainter(G.state); return;
    case 'lf-soundBtn': C.game.act(LS().setSetting, { key: 'sound', value: !set().sound }); render(); sfx('pop'); return;
    case 'lf-fastBtn': C.game.act(LS().setSetting, { key: 'fast', value: !set().fast }); $('#lf-fastBtn').setAttribute('aria-pressed', String(!!set().fast)); render(); return;
    case 'lf-howBack': if (howStep > 0) { howStep--; renderHow(); } return;
    case 'lf-howNext':
      if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
      closeSheet($('#lf-howSheet'));
      return;
    case 'lf-introOk': C.game.act(LS().seeIntro, { mechanics: introFresh }); closeSheet($('#lf-introSheet')); return;
    case 'lf-restartBtn':
      if (!restartArmed) {
        restartArmed = setTimeout(() => { restartArmed = 0; const b = $('#lf-restartBtn'); if (b) b.textContent = 'Start this painting over'; }, 3000);
        $('#lf-restartBtn').textContent = 'Tap again to start over';
        return;
      }
      clearTimeout(restartArmed); restartArmed = 0;
      closeSheet($('#lf-levelSheet'));
      restart();
      return;
    case 'lf-finNext': { const nx = $('#lf-finNext').dataset.level || L.id; closeSheet($('#lf-finishSheet')); startLevel(nx, { fresh: true }); return; }
    case 'lf-finAgain': closeSheet($('#lf-finishSheet')); startLevel(L.id, { fresh: true }); return;
    case 'lf-finAll': closeSheet($('#lf-finishSheet')); openLevels(); return;
    default: break;
  }
  const front = t.closest('#lf-lanes .lf-front');
  if (front) { act({ t: 'place', i: +front.dataset.lane }); return; }
  if (t.closest('#lf-belt')) {
    const b = t.closest('.lf-slotbtn');
    if (b) act({ t: 'park', i: +b.dataset.i });
    else if (busy) skipAll();
    return;
  }
  const bb = t.closest('#lf-bench .lf-slotbtn');
  if (bb) { act({ t: 'unpark', i: +bb.dataset.i }); return; }
  if (t.closest('#lf-easel')) { if (busy) skipAll(); }
}

function onKey(e) {
  if (!visible || e.key !== 'Escape') return;
  for (const sh of $$('.lf-sheet')) if (!sh.hidden && sh.id !== 'lf-finishSheet' && sh.id !== 'lf-introSheet') closeSheet(sh);
}

let rz = 0;
function onResize() {
  if (!visible || !built) return;
  cancelAnimationFrame(rz);
  rz = requestAnimationFrame(() => { if (L && G && !busy && visible) sizePic(); });
}

// ---------- the guide ----------
function coachSteps() {
  const moved = (st) => !!(st && st.lift && st.lift.game && st.lift.game.moves.length > 0);
  return [
    { anchor: '[data-coach="lift-lanes"]', text: 'Tap a front jar to set it on the belt.', endsOn: 'action', done: moved },
    { anchor: '[data-coach="lift-easel"]', text: 'Jars lift their color from the bottom edge. The paint above settles.', endsOn: 'got-it', side: 'below' },
    { anchor: '[data-coach="lift-msg"]', text: 'Hint and Undo are always free, and there is no way to lose.', endsOn: 'got-it', side: 'above' },
  ];
}

// ---------- the Puzzles hub card ----------
/** A small picture of a painting (lifted cells show the bare linen). */
function thumbSvg(Lv, hgt) {
  let out = `<svg viewBox="0 0 ${Lv.W} ${Lv.H}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${Lv.W}" height="${Lv.H}" fill="#EFE7D6"/>`;
  for (let r = 0; r < Lv.H; r++) {
    let c = 0;
    while (c < Lv.W) {
      const lifted = hgt && r >= hgt[c];
      const k = lifted ? null : Lv.cells[r][c];
      let e = c + 1;
      while (e < Lv.W && (hgt && r >= hgt[e] ? null : Lv.cells[r][e]) === k) e++;
      if (k) out += `<rect x="${c}" y="${r}" width="${e - c}" height="1" fill="${PALETTE[k].hex}"/>`;
      c = e;
    }
  }
  return `${out}</svg>`;
}

/** The Puzzles hub card (ui/puzzles.js): the painting on the easel at a glance, or the price tag. */
export function liftCardHtml(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.lift) return '';
  if (!C) C = ctx;
  injectCss();
  const sum = ctx.sim.lift.summary(state);
  if (!sum.open) {
    return h`<div class="card lf-card" id="pz-lift" data-coach="lift-card">
<div class="h3">Lifting Table</div>
<div class="hint">A painting comes in to be lifted back into jars, one calm jar at a time along a little belt.</div>
<div class="pz-tiertag">${unlockTag(ctx, 'lift', { cls: 'pz-tag' })}</div>
</div>`;
  }
  const Lv = levelById(sum.levelId) || LEVELS[0];
  const pct = Math.round(sum.progress * 100);
  let line;
  if (sum.cleared) line = `${Lv.name} is lifted. The next painting is ready when you are.`;
  else if (sum.playing) line = `Painting ${sum.index + 1} of ${sum.total} · ${Lv.name} · ${pct}% lifted`;
  else line = `Painting ${sum.index + 1} of ${sum.total} · ${Lv.name}. Lift its pigments back into jars, no timers.`;
  const stats = sum.done ? `${plural(sum.done, 'painting', 'paintings')} lifted` : '';
  return h`<div class="card lf-card" id="pz-lift" data-coach="lift-card">
<div class="row between"><div class="h3">Lifting Table</div>${stats ? h`<span class="chip">${stats}</span>` : ''}</div>
<div class="lf-cardrow"><span class="lf-thumb">${raw(thumbSvg(Lv, sum.h))}</span><div class="hint grow">${line}</div></div>
${button(sum.playing ? 'Continue lifting' : 'Go to the easel', { variant: 'primary', block: true, attrs: { 'data-action': 'open-lift' } })}
</div>`;
}

/** What the hub card depends on (ui/puzzles.js redraws when it changes). */
export function liftCardSig(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.lift) return 0;
  const u = ctx.sim.unlocks.status(state, 'lift');
  const g = state.lift && state.lift.game;
  return [u && u.revealed, u && u.affordable, u && u.open, state.lift && state.lift.cur, g ? g.moves.length : -1, state.lift ? Object.keys(state.lift.done || {}).length : 0];
}

// ---------- screen ----------
/** debugLift() -> {busy, level, visible, painter}: a read for tests (test/lift.e2e.mjs). */
export function debugLift() {
  return {
    busy, visible, level: L ? L.id : null, revealing, dead, stepping, pendingHint,
    painter: { h: PT.h.slice(), parts: PT.parts.length, cs: PT.cs, maxParts: MAX_PARTS },
    canvases: ROOT ? ROOT.querySelectorAll('canvas').length : 0,
  };
}

function unlocked() {
  try { return !!LS().unlocked(S()); } catch { return false; }
}

export default {
  id: 'lift',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectCss();
    root.addEventListener('click', onClick);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) guideApi = C.guide('lift', coachSteps(), { screen: 'lift' });
    // Bought somewhere else (the workshop's Next): offer the way in (two equal choices; nothing navigates by itself).
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'lift'); };
        if (!p || p.id !== 'lift' || visible || here()) return;
        setTimeout(() => {
          if (visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Lifting Table is open',
            body: 'A painting is on the easel, ready to be lifted back into jars.',
            more: { label: 'Later' },
            next: { label: 'Go to the easel', run: () => C.navigate('lift') },
          });
        }, 300);
      });
    }
  },

  show() {
    visible = true;
    gen += 1;
    busy = false; skip = false; queued = null; TL = null; revealing = false;
    if (!unlocked()) { lockedSkeleton(); return; }
    C.game.act(LS().ensureLift);
    skeleton();
    startLevel(S().lift.cur);
    if (G && isDone(G.state)) openFinish();
    if (guideApi) guideApi.start();
  },

  hide() {
    visible = false;
    gen += 1;
    if (TL) { TL.skip = true; clearTimeout(TL.guard); }
    TL = null;
    busy = false; skip = false; queued = null; revealing = false; pendingHint = false; stepping = false;
    clearTimeout(deadTimer); deadTimer = 0;
    for (const f of [...skipWaiters]) f();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    PT.parts.length = 0; PT.carts.length = 0;
    for (const el of document.querySelectorAll('.lf-flying')) el.remove();
    if (ROOT) closeAllSheets();
    clearTimeout(restartArmed); restartArmed = 0;
    if (guideApi) guideApi.stop();
  },

  render(state) {
    if (!ROOT || !visible) return;
    if (!built) { if (unlocked()) this.show(); return; }
    if (busy || revealing || stepping) return;
    // A game changed under the table (an imported save, a reset): pick it up again.
    if (sigOfGame() !== lastSig) startLevel(state.lift.cur);
  },
};
