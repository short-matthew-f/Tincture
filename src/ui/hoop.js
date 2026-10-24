/**
 * hoop.js: The Hoop (overlay `hoop`, fullscreen, home tab Puzzles).
 * Ported from proto/hoop/app.js and index.html, the playtested prototype: the
 * same rules and hoops (103 of them, in chapters), strands as curves with
 * over and under at every crossing, clasps (hooked strands, with their marks),
 * the taut-pull, lift-offs, stitched knots, painted pegs, shared knots, the
 * carried end sliding over the knots it passes and the yarn settling into its
 * new lie, strands coming free onto the shelf of skeins, the hint, the
 * unlimited undo, the intro cards, the three-step "How this works" sheet and
 * the finish sheet.
 *
 * What changed for the game: every move is a sim action (src/sim/hoop.js, run
 * through ctx.game.act), so it is saved at once and a reload mid-hoop resumes
 * exactly; the yarn is in her own discovered colors (sim.hoop.yarns, fixed
 * when a hoop starts) and named by her names; hoops open one after another,
 * and the hoop list shows chapters, ticks, stars, the next hoop and a Continue
 * button; a cleared hoop pays coins, and the first clear at or under par adds
 * a small star bonus (the finish sheet says so, gently, and says when the par
 * is the best found rather than proven); settings (sound, color symbols,
 * hooked marks) live in state.hoop.settings; sounds come from ctx.audio, gated
 * by the hoop's own toggle and the game's; motion honors
 * ctx.fx.isReducedMotion(); the first visit teaches itself with a guide() whose
 * first step is the action, and the "?" sheet keeps the prototype's three
 * illustrated steps. Every class and id is prefixed `hp-` and every rule is
 * scoped to #screen-hoop.
 *
 * PAINTING (as the prototype, made cheaper for the big hoops). One canvas holds
 * the hoop: the wood, linen and pegs are painted once per size into a bitmap;
 * the strands at rest go into a cached bitmap on top of that; a second canvas
 * over it (the top layer) holds what moves: a lifted or carried strand, glows,
 * hooked marks, knots, strands coming free. Over and under is drawn per
 * crossing: strands go down in a base order, and each crossing that order
 * gets wrong is patched (a small disk where the linen and the strands near it
 * are repainted in the order the crossing demands). What the game does on top:
 *   - the layout of a new position starts from the last one's (a warm start:
 *     each strand's points begin where its yarn lay), so it settles in far
 *     fewer sweeps; the picture is the same (it is the unique Tutte drawing);
 *   - while the yarn settles after a move, only the strands that really move
 *     are repainted each frame: the rest, and the patches among them, are
 *     painted once into the cache for the whole settle, and the plan of which
 *     crossing needs a patch is worked out once, its disks riding along with
 *     their crossings;
 *   - after a move the cached bitmap is repainted only inside the box the
 *     changed strands cover (old and new), when everything else lies exactly
 *     where it did; otherwise in full;
 *   - the hoop list's thumbnails are laid out a few per frame and kept.
 *
 * Never locked: every animated action goes through run() (busy is reset in
 * finally), tweens and WAAPI have timer fallbacks, and a tap while busy
 * fast-forwards.
 */

import { h, raw, button, backButton, escapeHtml } from './kit.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import {
  COLORS, canLift, whyNotTo, targets, endsAt, isDone, remaining, movers, totalCrossings, yarnLine,
  newState, nearestAt, hookedPairs, canLiftOff, solutionStep, wayFrom, stateKey, parseMoves, formatMoves, move,
} from '../puzzles/hoop.js';
import { layout, plan, distTo, baseOrder, topAt, hookMarks } from '../puzzles/hoop-layout.js';
import { LEVELS, MECHANICS, CHAPTERS, levelById, chapterOf, firstIntro } from '../puzzles/hoop-levels.js';

let C = null;
let ROOT = null;
const S = () => C.game.state;
const HS = () => C.sim.hoop;
const set = () => (S().hoop && S().hoop.settings) || { sound: true, glyphs: null, hooks: true };
const glyphsOn = () => { try { return !!HS().glyphsOn(S()); } catch { return false; } };
const hooksOn = () => set().hooks !== false;
const $ = (s) => (ROOT ? ROOT.querySelector(s) : null);
const $$ = (s) => (ROOT ? [...ROOT.querySelectorAll(s)] : []);
// (asked every frame, by every strand: the answer is kept for half a second)
const RM = { t: -1e9, v: false };
const reduced = () => { const t = performance.now(); if (t - RM.t > 500) { RM.t = t; RM.v = !!(C && C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion()); } return RM.v; };
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 1);
const ease = (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const TAU = Math.PI * 2;
const esc = (s) => escapeHtml(String(s ?? ''));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const LINEN = '#EFE6D2';

// ---------- color: her yarns for the eight dye keys ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toneOf = (hex) => ({ base: hex, edge: mixHex(hex, '#24160A', 0.36), light: mixHex(hex, '#FFF6E4', 0.35), ink: lum(hex) > 0.28 ? 'rgba(42,30,20,.85)' : 'rgba(255,250,238,.95)' });
let YARN = {};   // key -> her color id
let HEX = {};    // key -> hex
let TONE = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toneOf(c.hex)]));
const hexOf = (c) => HEX[c] || (COLORS[c] && COLORS[c].hex) || '#999999';
function nameOfId(id) { try { return C.sim.displayName(S(), id); } catch { return id; } }
const cname = (c) => (YARN[c] ? nameOfId(YARN[c]) : COLORS[c].short);
const cshort = (c) => cname(c);
function hexesFor(y) {
  const out = {};
  for (const k of Object.keys(COLORS)) {
    let hx = null;
    try { hx = y && y[k] ? C.sim.economy.colorHex(y[k]) : null; } catch { hx = null; }
    out[k] = /^#[0-9a-f]{6}$/i.test(hx || '') ? hx : COLORS[k].hex;
  }
  return out;
}
function setYarns(y) {
  YARN = { ...(y || {}) };
  HEX = hexesFor(YARN);
  TONE = Object.fromEntries(Object.keys(COLORS).map((k) => [k, toneOf(HEX[k])]));
}

// ---------- glyphs (colorblind help) ----------
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const GLYPHS = {
  dot: { f: circ(12, 12, 6) },
  diamond: { f: 'M12 3 20.5 12 12 21 3.5 12z' },
  ring: { s: circ(12, 12, 6.2), w: 3.4 },
  wave: { s: 'M3 13c2.5-4.4 4.5-4.4 7 0s4.5 4.4 7 0c1-1.8 2-2.6 3.5-3', w: 3.2 },
  heart: { f: 'M12 20.5s-8-4.9-8-10.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 8 2.5c0 5.7-8 10.6-8 10.6z' },
  leaf: { f: 'M4.5 19.5C4 11 9.5 5 19.5 4.5c.4 9-5.2 15-15 15z' },
  moon: { f: 'M15.5 3A9 9 0 1 0 21 15.4 7.4 7.4 0 0 1 15.5 3z' },
  sun: { f: circ(12, 12, 4.6), s: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1', w: 2.4 },
};
const glyphOf = (c) => GLYPHS[COLORS[c].glyph];
const P2D = new Map();
const pathsOf = (g) => {
  if (!P2D.has(g)) P2D.set(g, { f: g.f ? new Path2D(g.f) : null, s: g.s ? new Path2D(g.s) : null, w: g.w });
  return P2D.get(g);
};
function drawGlyph(ctx, g, x, y, size, ink) {
  const p = pathsOf(g);
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.translate(-12, -12);
  ctx.fillStyle = ctx.strokeStyle = ink;
  if (p.f) ctx.fill(p.f);
  if (p.s) { ctx.lineWidth = p.w; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(p.s); }
  ctx.restore();
}

// A wound skein: a twisted hank, tied in the middle.
function skeinSVG(c, hex = hexOf(c)) {
  return `<svg viewBox="0 0 66 40" aria-hidden="true">
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="${hex}"/>
    <path d="M10 20C10 11 24 9 31 17M10 21C11 29 24 31 31 23M56 20C56 11 42 9 35 17M56 21C55 29 42 31 35 23" fill="none" stroke="rgba(255,250,235,.38)" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M14 20C15 14 23 13 29 18M14 21C15 26 23 27 29 22M52 20C51 14 43 13 37 18M52 21C51 26 43 27 37 22" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
    <rect x="29.5" y="11" width="7" height="18" rx="2.5" fill="#EFE6D2" stroke="rgba(42,38,34,.35)" stroke-width="1"/>
    <path d="M30 16h6M30 20h6M30 24h6" stroke="rgba(42,38,34,.3)" stroke-width="1"/>
  </svg>`;
}
const STAR = (filled) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6 6.6 19.5l1.1-6.1L3.2 9.2l6.1-.8z" fill="${filled ? '#E2B04A' : 'none'}" stroke="${filled ? '#A9781C' : 'rgba(42,38,34,.35)'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// ---------- yarn: geometry and paint (after the Tangle Basket) ----------
const LIGHT = [-0.5, -0.866];
// s0: arc length before pts[0] on the whole strand (a slice keeps its ply in step).
function yarnGeom(pts, w, s0 = 0) {
  const n = pts.length;
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  const len = cum[n - 1] || 0.001;
  const path = new Path2D();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < n; k++) path.lineTo(pts[k][0], pts[k][1]);
  let seg = 0;
  const at = (s) => {
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const a = pts[seg], b = pts[Math.min(n - 1, seg + 1)];
    const sl = cum[seg + 1] - cum[seg] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[seg]) / sl));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / sl, (b[1] - a[1]) / sl];
  };
  // ply: a diagonal groove and a highlight every pitch, like a two-ply twist
  const grooves = new Path2D(), shines = new Path2D();
  const pitch = w * 0.55, r = w * 0.36, a = w * 0.34;
  const first = pitch * 0.5 - s0 + Math.ceil((s0 - pitch * 0.5) / pitch) * pitch;
  for (let s = Math.max(0, first); s < len - (s0 ? 0 : w * 0.25); s += pitch) {
    const [x, y, tx, ty] = at(s);
    const nx = -ty, ny = tx;
    grooves.moveTo(x + nx * r - tx * a * 0.5, y + ny * r - ty * a * 0.5);
    grooves.lineTo(x - nx * r + tx * a * 0.5, y - ny * r + ty * a * 0.5);
    const o = w * 0.2;
    shines.moveTo(x + nx * r * 0.7 + tx * (o - a * 0.35), y + ny * r * 0.7 + ty * (o - a * 0.35));
    shines.lineTo(x - nx * r * 0.7 + tx * (o + a * 0.35), y - ny * r * 0.7 + ty * (o + a * 0.35));
  }
  // roundness: a sheen on the lit side, a shade on the other
  const sheen = new Path2D(), shade = new Path2D();
  for (let k = 0; k < n; k++) {
    const p = pts[Math.max(0, k - 1)], q = pts[Math.min(n - 1, k + 1)];
    const dl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / dl, ny = (q[0] - p[0]) / dl;
    const d = nx * LIGHT[0] + ny * LIGHT[1];
    const ox = nx * d * w * 0.24, oy = ny * d * w * 0.24;
    if (k === 0) { sheen.moveTo(pts[k][0] + ox, pts[k][1] + oy); shade.moveTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); } else { sheen.lineTo(pts[k][0] + ox, pts[k][1] + oy); shade.lineTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); }
  }
  // glyph spots: a third and two thirds along
  const spots = [at(len * 0.34), at(len * 0.66)].map((p) => [p[0], p[1]]);
  const mid = at(len * 0.5);
  return { path, grooves, shines, sheen, shade, spots, len, mid: [mid[0], mid[1]] };
}
// o: { w, tone, lift, glow, alpha, glyph, fast }
// fast (yarn on the move, for a few frames): shadow, edge and body only.
const pathGeom = (pts) => { const path = new Path2D(); path.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]); return { path }; };
function paintYarn(ctx, g, o) {
  const w = o.w, lift = o.lift || 0;
  ctx.save();
  if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = Math.max(0, o.alpha);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // one soft shadow on the linen and on whatever lies under: it is what
  // makes over and under read at a glance (one wide stroke; raster is the cost)
  const k = 1 + Math.max(0, lift) * 1.6;
  if (!o.noShadow) {
    ctx.save();
    ctx.translate(w * 0.16 * k, w * 0.28 * k);
    ctx.strokeStyle = `rgba(60,40,20,${0.24 + 0.04 * lift})`; ctx.lineWidth = w * 1.38; ctx.stroke(g.path);
    ctx.restore();
  }
  if (o.glow > 0) {
    ctx.strokeStyle = `rgba(242,190,70,${0.55 * o.glow})`; ctx.lineWidth = w * 2.1; ctx.stroke(g.path);
    ctx.strokeStyle = `rgba(255,243,205,${0.85 * o.glow})`; ctx.lineWidth = w * 1.45; ctx.stroke(g.path);
  }
  const t = o.tone;
  ctx.strokeStyle = t.edge; ctx.lineWidth = w; ctx.stroke(g.path);
  ctx.strokeStyle = t.base; ctx.lineWidth = w * 0.8; ctx.stroke(g.path);
  if (o.fast || !g.shade) { ctx.restore(); return; }
  ctx.strokeStyle = 'rgba(28,16,6,.13)'; ctx.lineWidth = w * 0.22; ctx.stroke(g.shade);
  ctx.strokeStyle = 'rgba(255,250,238,.2)'; ctx.lineWidth = w * 0.2; ctx.stroke(g.sheen);
  ctx.strokeStyle = 'rgba(28,16,6,.3)'; ctx.lineWidth = w * 0.1; ctx.stroke(g.grooves);
  ctx.strokeStyle = 'rgba(255,248,230,.22)'; ctx.lineWidth = w * 0.08; ctx.stroke(g.shines);
  if (o.glyph) for (const [x, y] of g.spots) drawGlyph(ctx, glyphOf(o.glyph), x, y, w * 0.8, TONE[o.glyph].ink);
  ctx.restore();
}

// ---------- styles ----------
const CSS = `
#screen-hoop { --hp-wood-d: #8E6A42; --hp-wood-l: #D2AF7E; --hp-gold: #E2B04A; --hp-gold-soft: #F3E3B8; --hp-accent: #8C6512; --hp-card: #FBF8F1; --hp-line: rgba(42,38,34,.14);
  background: radial-gradient(120% 70% at 50% 0%, #F8F3E8 0%, #F4EFE4 60%, #EDE4D2 100%); overscroll-behavior-y: none; }
#screen-hoop [hidden] { display: none !important; }
#screen-hoop .screen-head.hp-head { background: transparent; gap: 4px; padding: calc(4px + var(--safe-top)) 12px 2px; max-width: 480px; width: 100%; margin: 0 auto; }
#screen-hoop .hp-app { display: flex; flex-direction: column; gap: 6px; padding: 0 12px calc(8px + var(--safe-bottom)); max-width: 480px; width: 100%; margin: 0 auto; overflow-x: hidden; }
#screen-hoop .hp-closed { padding: 16px 16px 24px; max-width: 480px; margin: 0 auto; width: 100%; }
#screen-hoop .hp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
#screen-hoop .hp-sr:focus-within { position: static; width: auto; height: auto; clip: auto; white-space: normal; display: flex; flex-wrap: wrap; gap: 6px; }
#screen-hoop .hp-sr button { min-height: 44px; }
#screen-hoop .btn:disabled { opacity: .45; }
#screen-hoop .btn[aria-pressed="true"] { background: #F3E3B8; box-shadow: 0 0 0 2px var(--hp-gold), 0 3px 0 rgba(42,38,34,.18); }
#screen-hoop .btn.hp-lit { box-shadow: 0 0 0 2px var(--hp-gold), 0 3px 0 rgba(42,38,34,.18); }

/* top bar */
#screen-hoop .hp-iconbtn { appearance: none; border: 0; background: none; min-width: 44px; min-height: 44px; display: grid; place-items: center; border-radius: 12px; color: var(--ink-soft); cursor: pointer; font: inherit; font-size: 22px; touch-action: manipulation; }
#screen-hoop .hp-iconbtn:active { background: rgba(42,38,34,.06); }
#screen-hoop .hp-levelbtn { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; padding: 0 10px; justify-content: flex-start; }
#screen-hoop .hp-levelbtn .hp-nm { font: 400 17px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#screen-hoop .hp-levelbtn .hp-no { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-soft); white-space: nowrap; }
#screen-hoop .hp-levelbtn .hp-chev { margin-left: auto; color: var(--ink-soft); font-size: 13px; }
#screen-hoop .hp-tog { flex: 0 0 auto; min-width: 44px; padding: 0 8px; font-size: 15px; }
#screen-hoop .hp-settings .btn svg { width: 18px; height: 18px; vertical-align: -4px; margin-right: 4px; }

/* the skein shelf beside the hoop */
#screen-hoop .hp-shelfrow { display: flex; align-items: flex-end; gap: 8px; min-height: 30px; flex: none; font-size: 12px; color: var(--ink-soft); position: relative; }
#screen-hoop .hp-shelfrow::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; border-radius: 2px; background: linear-gradient(var(--hp-wood-l), var(--hp-wood-d)); box-shadow: 0 2px 0 rgba(42,38,34,.12); }
#screen-hoop .hp-shelfrow b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
#hp-moveCount { padding-bottom: 7px; white-space: nowrap; }
#hp-shelf { flex: 1; display: flex; gap: 1px; overflow: hidden; height: 26px; align-items: flex-end; padding-bottom: 4px; min-width: 0; }
#hp-shelf svg { flex: none; width: 27px; height: 17px; }
#hp-shelf .hp-slot { flex: none; width: 25px; height: 15px; margin: 1px; border-radius: 8px; border: 1.5px dashed rgba(42,38,34,.18); }

/* the hoop */
#screen-hoop .hp-hoopwrap { position: relative; display: flex; justify-content: center; align-items: flex-start; flex: none; margin-top: 4px; }
#screen-hoop .hp-grow { flex: 1 1 0; min-height: 0; }
#hp-hoop { display: block; touch-action: none; cursor: pointer; -webkit-user-select: none; user-select: none; }
#hp-top, #hp-motion, #hp-pegfx { position: absolute; pointer-events: none; }
#hp-pegfx i { position: absolute; border-radius: 50%; box-sizing: border-box; }
#hp-pegfx .hp-pg { background: rgba(242,190,70,.24); border: 1.8px solid rgba(200,140,30,.78); animation: hp-pulse 1.5s ease-in-out infinite; }
#hp-pegfx .hp-pg.hp-over { background: rgba(242,190,70,.55); border: 2.5px solid rgba(200,140,30,.95); animation: none; }
#hp-pegfx .hp-hr { background: rgba(242,190,70,.3); border: 2.2px dashed rgba(190,130,20,.9); animation: hp-pulse 1.5s ease-in-out 3; }
#hp-pegfx .hp-ps { border: 1.6px solid rgba(107,99,90,.6); animation: hp-shake .4s ease-out forwards; }
@keyframes hp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
@keyframes hp-shake { 0% { transform: translateX(0); opacity: 1; } 25% { transform: translateX(2px); } 50% { transform: translateX(-2px); } 75% { transform: translateX(1px); } 100% { transform: none; opacity: 0; } }
html[data-motion="reduced"] #hp-pegfx i { animation: none; }
@media (prefers-reduced-motion: reduce) { #hp-pegfx i { animation: none; } }
#screen-hoop .hp-cheer { position: absolute; left: 50%; top: 46%; z-index: 6; pointer-events: none; transform: translate(-50%, -50%); font: 400 23px var(--font-display); color: #4A3A26; background: rgba(251,246,234,.92); padding: 7px 16px; border-radius: 999px; box-shadow: 0 2px 10px rgba(42,38,34,.18); white-space: nowrap; }
.hp-flying { position: fixed; z-index: 45; pointer-events: none; width: 44px; height: 28px; left: 0; top: 0; }
.hp-flying svg { width: 100%; height: 100%; overflow: visible; }

/* message and actions, in thumb reach */
#hp-msg { margin: 0; min-height: 40px; font-size: 14px; line-height: 1.35; font-weight: 500; display: flex; align-items: center; }
#screen-hoop .hp-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; flex: none; }
#screen-hoop .hp-actions .btn { padding: 0 6px; white-space: nowrap; }

/* sheets (inside the screen) */
#screen-hoop .hp-sheet { position: absolute; inset: 0; z-index: 60; background: rgba(42,38,34,.32); display: flex; align-items: flex-end; justify-content: center; }
#screen-hoop .hp-panel { width: 100%; max-width: 480px; max-height: 92%; overflow-y: auto; overflow-x: hidden; background: #F4EFE4; border-radius: 20px 20px 0 0; padding: 14px 16px calc(16px + var(--safe-bottom)); box-shadow: 0 -8px 30px rgba(42,38,34,.2); }
#screen-hoop .hp-sheet h2 { font: 400 24px var(--font-display); margin: 4px 0 6px; }
#screen-hoop .hp-x { float: right; }
#screen-hoop .hp-settings { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
#screen-hoop .hp-continue { width: 100%; margin-top: 10px; }
#screen-hoop .hp-band { font: 600 11px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); margin: 16px 2px 6px; display: flex; justify-content: space-between; gap: 8px; }
#screen-hoop .hp-band span { font-weight: 600; letter-spacing: 0; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#screen-hoop .hp-lvls { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
#screen-hoop .hp-lvls button { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 8px; text-align: left; border: 0; border-radius: 12px; background: var(--hp-card); box-shadow: 0 1px 0 var(--hp-line); padding: 6px 8px; cursor: pointer; position: relative; font: inherit; color: inherit; }
#screen-hoop .hp-lvls button[aria-current="true"] { box-shadow: 0 0 0 2px var(--hp-gold); background: #FBF3DD; }
#screen-hoop .hp-lvls button.hp-next:not([aria-current="true"]) { box-shadow: 0 0 0 2px var(--hp-gold), 0 2px 6px rgba(226,176,74,.35); }
#screen-hoop .hp-lvls button.hp-locked { cursor: default; background: rgba(251,248,241,.55); }
#screen-hoop .hp-lvls button.hp-locked .hp-t { color: var(--ink-soft); }
#screen-hoop .hp-lvls .hp-th, #screen-hoop .hp-lvls .hp-lockthumb { flex: none; width: 48px; height: 48px; border-radius: 50%; }
#screen-hoop .hp-lvls .hp-th { background: #EFE6D2; box-shadow: inset 0 0 0 3px #C9A06A; display: block; }
#screen-hoop .hp-lvls .hp-lockthumb { display: grid; place-items: center; color: rgba(42,38,34,.35); background: #EDE3CF; box-shadow: inset 0 0 0 3px rgba(201,160,106,.45); }
#screen-hoop .hp-lvls .hp-lockthumb svg { width: 18px; height: 18px; }
#screen-hoop .hp-lvls .hp-t { min-width: 0; font-size: 13px; line-height: 1.25; }
#screen-hoop .hp-lvls .hp-t b { display: block; font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
#screen-hoop .hp-lvls .hp-chip { display: inline-block; margin-top: 2px; font-size: 10px; font-weight: 700; color: #6A5A1E; background: var(--hp-gold-soft); border-radius: 999px; padding: 1px 6px; }
#screen-hoop .hp-tick { position: absolute; left: 38px; top: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--hp-gold-soft); box-shadow: 0 0 0 2px #fff, 0 1px 2px rgba(42,38,34,.3); display: grid; place-items: center; color: #6A5A1E; font-size: 12px; font-weight: 800; }
#screen-hoop .hp-lvstar { position: absolute; right: 6px; top: 4px; width: 14px; height: 14px; }
#screen-hoop .hp-lvstar svg { width: 14px; height: 14px; display: block; }
#screen-hoop .hp-steps { display: flex; gap: 6px; justify-content: center; margin: 10px 0; }
#screen-hoop .hp-steps i { width: 8px; height: 8px; border-radius: 50%; background: rgba(42,38,34,.18); }
#screen-hoop .hp-steps i.hp-on { background: var(--hp-accent); }
#screen-hoop .hp-how p { font-size: 15px; line-height: 1.45; margin: 8px 0; }
#screen-hoop .hp-how svg.hp-ill { display: block; width: 100%; max-width: 320px; height: auto; margin: 6px auto; }
#screen-hoop .hp-how .how-link { display: flex; margin: 8px auto 0; }
#screen-hoop .hp-row2 { display: flex; gap: 8px; margin-top: 12px; }
#screen-hoop .hp-row2 .btn { flex: 1; }
#screen-hoop .hp-intro .hp-item { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
#screen-hoop .hp-intro .hp-item svg { flex: none; width: 56px; height: 56px; }
#screen-hoop .hp-intro .hp-item p { margin: 0; font-size: 15px; line-height: 1.4; }
#screen-hoop .hp-intro .hp-item strong { display: block; font: 400 17px var(--font-display); }

/* finish */
#screen-hoop .hp-finish { text-align: center; }
#screen-hoop .hp-finrow { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 12px 0 6px; }
#hp-finHoop { width: 104px; height: 104px; flex: none; }
#screen-hoop .hp-finrow .hp-cap { font-size: 12px; color: var(--ink-soft); margin-top: 2px; }
#screen-hoop .hp-bigshelf { flex: 1; min-width: 0; padding: 8px 4px 0; border-radius: 12px; background: linear-gradient(180deg, #F3EAD8, #EADBBE); }
#screen-hoop .hp-bigshelf .hp-row { display: flex; justify-content: center; align-items: flex-end; flex-wrap: wrap; gap: 4px 2px; padding-bottom: 5px; border-bottom: 8px solid var(--hp-wood-d); box-shadow: 0 2px 0 rgba(42,38,34,.15); margin-bottom: 10px; }
#screen-hoop .hp-pile { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 0 1 31%; min-width: 0; }
#screen-hoop .hp-pile .hp-sk { display: flex; flex-direction: column-reverse; align-items: center; }
#screen-hoop .hp-pile .hp-sk svg { width: 44px; height: 27px; margin-top: -10px; }
#screen-hoop .hp-pile .hp-sk svg:last-child { margin-top: 0; }
#screen-hoop .hp-pile .hp-tag { font-size: 11px; line-height: 1.2; color: var(--ink); background: var(--hp-card); padding: 2px 5px; border-radius: 6px; box-shadow: 0 1px 0 var(--hp-line); max-width: 100%; overflow-wrap: anywhere; }
#screen-hoop .hp-par { display: inline-flex; align-items: center; gap: 8px; margin: 6px auto 2px; padding: 6px 12px; border-radius: 16px; background: var(--hp-card); box-shadow: 0 1px 0 var(--hp-line); font-size: 14px; text-align: left; }
#screen-hoop .hp-par svg { width: 22px; height: 22px; flex: none; }
#screen-hoop .hp-knits { font: 400 17px/1.35 var(--font-display); margin: 8px 0 2px; }
#screen-hoop .hp-finish .btn { width: 100%; margin-top: 8px; }
#screen-hoop .hp-reward { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px 10px; margin: 6px 0 4px; font-size: 14px; }
#screen-hoop .hp-reward .hp-coins { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-variant-numeric: tabular-nums; }
#screen-hoop .hp-reward .hp-coins i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
#screen-hoop .hp-reward .hp-again { color: var(--ink-soft); font-size: 13px; }

/* the Puzzles hub card */
.hp-card .hp-cardrow { display: flex; align-items: center; gap: 12px; }
.hp-card .hp-thumb { flex: none; line-height: 0; }
.hp-card .hp-thumb svg { display: block; width: 60px; height: 60px; }

@media (prefers-reduced-motion: reduce) { #screen-hoop .hp-panel { animation: none; } }
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('hp-style')) return;
  const el = document.createElement('style');
  el.id = 'hp-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------- the screen's own state ----------
let L = null, G = null, busy = false, skip = false, note = '', howStep = 0;
let held = -1;          // the end whose knot is lifted (tap, then tap a peg)
let drag = null;        // { e, pt, over, touch } while a knot follows a finger
let view = null;        // what the hoop shows during a move: { state, carry?, morph? }
let tangled = false;
let visible = false, gen = 0, guideApi = null, built = false, lastSig = '', listHint = '';
const shelfHold = new Set(); // freed strands whose skein hasn't reached the shelf yet
const skipWaiters = new Set();
const stats = { moves: 0, undos: 0, hints: 0, blocked: 0, drags: 0, liftoffs: 0 };

function ownAnimations() {
  if (!ROOT) return [];
  try { if (ROOT.getAnimations) return ROOT.getAnimations({ subtree: true }); } catch { /* fall through */ }
  try { return document.getAnimations().filter((a) => a.effect && a.effect.target && ROOT.contains(a.effect.target)); } catch { return []; }
}
function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  for (const a of ownAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
  for (const el of document.querySelectorAll('.hp-flying')) { try { for (const a of el.getAnimations()) a.finish(); } catch { /* fine */ } }
}
// A time-bounded tween: t is clamped, a thrown step ends it, a stalled frame
// clock (hidden tab) can't hold it, and skipAll() jumps it to the end.
function tween(ms, step) {
  return new Promise((resolve) => {
    let finished = false;
    const fin = () => {
      if (finished) return;
      finished = true; skipWaiters.delete(fin); clearTimeout(guard);
      try { step(1); } catch (e) { console.error(e); }
      resolve();
    };
    const t0 = performance.now();
    const frame = (now) => {
      if (finished) return;
      if (skip) { fin(); return; }
      const t = clamp01((now - t0) / ms);
      try { step(t); } catch (e) { console.error(e); fin(); return; }
      if (t < 1) requestAnimationFrame(frame); else fin();
    };
    const guard = setTimeout(fin, ms + 400);
    skipWaiters.add(fin);
    if (skip || ms <= 0) { fin(); return; }
    requestAnimationFrame(frame);
  });
}
function wait(ms) {
  if (skip || ms <= 0) return Promise.resolve();
  return new Promise((r) => {
    const done = () => { clearTimeout(t); skipWaiters.delete(done); r(); };
    const t = setTimeout(done, ms);
    skipWaiters.add(done);
  });
}
// WAAPI with a timer fallback, so a paused or failed animation can never hang play.
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
  if (busy) return;
  const myGen = gen;
  busy = true; skip = false;
  render();
  try { await fn(); } catch (e) { console.error('The Hoop: an animation was cut short', e); } finally {
    busy = false; skip = false;
    view = null; FX.slide = null; FX.leaving = []; FX.tug = null; MORPH.live = null; shelfHold.clear();
    for (const el of document.querySelectorAll('.hp-flying')) el.remove();
    if (myGen === gen && visible && G) {
      render();
      kick();
      if (undoAfter) { undoAfter = false; doUndo(); } else afterMove();
    } else undoAfter = false;
  }
}

// ---------- layout ----------
const HG = { cv: null, ctx: null, bg: null, dpr: 1, css: 300, cx: 150, cy: 150, Rout: 140, Rin: 124, Rk: 132, pr: 6, w: 9, ang: [], peg: [] };
function sizeHoop() {
  const app = $('#hp-app');
  if (!app || !L) return;
  const vw = app.clientWidth || document.documentElement.clientWidth;
  const cs = getComputedStyle(app);
  const padH = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const availW = Math.min(vw, 480) - padH;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.classList.contains('hp-hoopwrap') || ch.classList.contains('hp-sr') || ch.classList.contains('hp-grow') || ch.hidden) continue;
    used += ch.id === 'hp-msg' ? Math.max(ch.offsetHeight, 58) : ch.offsetHeight; n++;
  }
  used += n * 6 + 10;
  const availH = (app.clientHeight || innerHeight) - padV - used;
  const css = Math.max(240, Math.floor(Math.min(availW, Math.max(availH, 260), 460)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  HG.dpr = dpr; HG.css = css; HG.cx = css / 2; HG.cy = css / 2 + 3;
  HG.Rout = css / 2 - 10;
  const band = Math.max(15, Math.min(21, css * 0.052));
  HG.Rin = HG.Rout - band;
  HG.Rk = (HG.Rout + HG.Rin) / 2;
  const spacing = (2 * Math.PI * HG.Rk) / L.n;
  HG.pr = Math.max(4.5, Math.min(7.2, spacing * 0.2));
  HG.w = Math.max(7, Math.min(10.5, css * 0.027, spacing * 0.36));
  HG.ang = [...Array(L.n).keys()].map((i) => -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / L.n);
  HG.peg = HG.ang.map((a) => [HG.cx + Math.cos(a) * HG.Rk, HG.cy + Math.sin(a) * HG.Rk]);
  const cv = $('#hp-hoop');
  HG.cv = cv;
  cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr);
  cv.style.width = `${css}px`; cv.style.height = `${css}px`;
  // The base is composed off screen and handed over as a bitmap when it
  // changes ('bitmaprenderer'): a page commit then never copies it again. A
  // browser without OffscreenCanvas paints it in place (a plain 2d canvas).
  if (BASE.cv !== cv) {
    // (a new canvas each time the screen is built: its context comes with it)
    BASE.cv = cv;
    let br = null;
    try { br = typeof OffscreenCanvas === 'function' ? cv.getContext('bitmaprenderer') : null; } catch { br = null; }
    BASE.mode = br ? 'bitmap' : '2d';
    BASE.out = br || cv.getContext('2d');
  }
  if (BASE.mode === 'bitmap') { BASE.off = new OffscreenCanvas(cv.width, cv.height); HG.ctx = BASE.off.getContext('2d'); } else HG.ctx = BASE.out;
  buildBg();
  CACHE.cv = document.createElement('canvas');
  CACHE.cv.width = cv.width; CACHE.cv.height = cv.height;
  // a plain bitmap (not a recorded list of strokes replayed on every blit)
  CACHE.ctx = CACHE.cv.getContext('2d', { willReadFrequently: true });
  // the top layer sits exactly over the hoop and lets taps through
  const top = $('#hp-top');
  TOP.cv = top; TOP.ctx = top.getContext('2d');
  top.width = cv.width; top.height = cv.height;
  top.style.width = `${css}px`; top.style.height = `${css}px`;
  top.style.left = `${cv.offsetLeft}px`; top.style.top = `${cv.offsetTop}px`;
  TOP.sig = ''; TOP.box = null; top.hidden = true;
  const mo = $('#hp-motion');
  MOTION.cv = mo; MOTION.ctx = mo.getContext('2d'); MOTION.dpr = 1;
  mo.width = Math.round(css); mo.height = Math.round(css);
  mo.style.width = `${css}px`; mo.style.height = `${css}px`;
  mo.style.left = `${cv.offsetLeft}px`; mo.style.top = `${cv.offsetTop}px`;
  MOTION.box = null; MOTION.sig = ''; mo.hidden = true;
  const fx = $('#hp-pegfx');
  fx.style.left = `${cv.offsetLeft}px`; fx.style.top = `${cv.offsetTop}px`; fx.style.width = `${css}px`; fx.style.height = `${css}px`;
  PEGFX.sig = '';
  BASE.sig = '';
  CACHE.sig = ''; CACHE.drawn = null;
  PX.clear();
  kick();
}
// Strands at rest live in a cached bitmap with the hoop; each frame redraws
// only what moves and the crossings it takes part in.
const CACHE = { cv: null, ctx: null, sig: '', drawn: null };
// Three layers, each repainted only when what it shows changes, and each
// shown only while it has something on it (a browser copies every canvas on
// the page at each frame it draws, changed or not): the base (the cache, every
// knot at rest and the hooked marks), the top layer (what is live at rest: a
// lifted or glowing strand, its patches, a lifted knot; cleared only inside
// the box it painted last) and the motion layer below.
const TOP = { cv: null, ctx: null, sig: '', box: null };
const BASE = { sig: '', mode: null, out: null, off: null, cv: null };
// While something is on the move (a carried end, the yarn settling, strands
// coming free), it is painted on its own layer at one device pixel per css
// pixel: a canvas that changes every frame costs in proportion to its pixels,
// and moving yarn needs no more. It comes to rest on the sharp layers.
const MOTION = { cv: null, ctx: null, dpr: 1, box: null, sig: '' };
// The glowing pegs, the hint's ring and a peg's little shake are DOM rings
// animated by CSS, so a held knot's pulse never repaints a canvas.
const PEGFX = { sig: '' };

function hash(a, b) { let x = (a * 374761393 + b * 668265263) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
// The still parts: the linen in the hoop, the wooden ring, the brass screw, the pegs.
function buildBg() {
  const c = document.createElement('canvas');
  c.width = HG.cv.width; c.height = HG.cv.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.scale(HG.dpr, HG.dpr);
  const { cx, cy, Rout, Rin } = HG;
  x.save();
  x.fillStyle = 'rgba(70,50,25,.16)';
  x.beginPath(); x.arc(cx + 2, cy + 5, Rout + 2, 0, TAU); x.fill();
  x.restore();
  // linen, stretched taut
  x.save();
  x.beginPath(); x.arc(cx, cy, Rin + 1, 0, TAU); x.clip();
  x.fillStyle = LINEN; x.fillRect(0, 0, HG.css, HG.css);
  const st = 2;
  x.fillStyle = 'rgba(150,120,80,.075)';
  for (let y = 0; y < HG.css; y += st) x.fillRect(0, y, HG.css, 0.6);
  x.fillStyle = 'rgba(150,120,80,.055)';
  for (let xx = 0; xx < HG.css; xx += st) x.fillRect(xx, 0, 0.6, HG.css);
  x.fillStyle = 'rgba(255,255,255,.1)';
  for (let k = 0; k < 500; k++) x.fillRect(hash(k, 1) * HG.css, hash(k, 2) * HG.css, 3, 0.7);
  const v = x.createRadialGradient(cx, cy, Rin * 0.55, cx, cy, Rin);
  v.addColorStop(0, 'rgba(90,60,30,0)'); v.addColorStop(1, 'rgba(90,60,30,.16)');
  x.fillStyle = v; x.fillRect(0, 0, HG.css, HG.css);
  x.restore();
  // the wooden ring (outer hoop over inner hoop)
  const ring = (r0, r1, light, dark) => {
    const gr = x.createLinearGradient(cx - Rout, cy - Rout, cx + Rout, cy + Rout);
    gr.addColorStop(0, light); gr.addColorStop(1, dark);
    x.beginPath(); x.arc(cx, cy, r1, 0, TAU); x.moveTo(cx + r0, cy); x.arc(cx, cy, r0, TAU, 0, true); x.fillStyle = gr; x.fill();
  };
  ring(Rin, Rout, '#E2C08E', '#B88E58');
  x.save();
  x.beginPath(); x.arc(cx, cy, Rout, 0, TAU); x.moveTo(cx + Rin, cy); x.arc(cx, cy, Rin, TAU, 0, true); x.clip();
  for (let k = 0; k < 9; k++) {
    const r = Rin + ((k + 0.5) / 9) * (Rout - Rin);
    x.strokeStyle = `rgba(110,72,34,${0.06 + 0.07 * hash(k, 7)})`; x.lineWidth = 0.7 + hash(k, 3);
    const a0 = hash(k, 5) * 6.28;
    x.beginPath(); x.arc(cx, cy, r, a0, a0 + 2 + hash(k, 9) * 3.5); x.stroke();
  }
  x.restore();
  x.strokeStyle = 'rgba(90,58,26,.45)'; x.lineWidth = 1;
  x.beginPath(); x.arc(cx, cy, Rout - 0.5, 0, TAU); x.stroke();
  x.beginPath(); x.arc(cx, cy, Rin + 0.5, 0, TAU); x.stroke();
  x.strokeStyle = 'rgba(255,240,210,.45)';
  x.beginPath(); x.arc(cx, cy, Rout - 2, Math.PI * 1.05, Math.PI * 1.7); x.stroke();
  // the brass screw at the top, between two pegs
  const sw = Math.min(16, (2 * Math.PI * HG.Rk) / L.n * 0.42);
  x.save();
  x.translate(cx, cy - Rout);
  x.fillStyle = 'rgba(60,40,20,.25)'; x.fillRect(-sw / 2 + 1, -7, sw, Rout - Rin + 8);
  const bg2 = x.createLinearGradient(-sw / 2, 0, sw / 2, 0);
  bg2.addColorStop(0, '#9C7A3C'); bg2.addColorStop(0.45, '#E8CC7C'); bg2.addColorStop(1, '#8A6A30');
  x.fillStyle = bg2; x.fillRect(-sw / 2, -8, sw, Rout - Rin + 6);
  x.fillStyle = '#C9A55A'; x.beginPath(); x.arc(0, -8, sw * 0.42, 0, TAU); x.fill();
  x.strokeStyle = 'rgba(70,50,20,.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-sw * 0.3, -8); x.lineTo(sw * 0.3, -8); x.stroke();
  x.restore();
  // pegs
  for (let i = 0; i < L.n; i++) {
    const [px, py] = HG.peg[i];
    const pc = L.pegColor[i];
    x.fillStyle = 'rgba(60,40,20,.35)'; x.beginPath(); x.arc(px + 0.8, py + 1.4, HG.pr + 0.6, 0, TAU); x.fill();
    const g = x.createRadialGradient(px - HG.pr * 0.35, py - HG.pr * 0.4, HG.pr * 0.1, px, py, HG.pr);
    if (pc) { g.addColorStop(0, TONE[pc].light); g.addColorStop(0.6, hexOf(pc)); g.addColorStop(1, TONE[pc].edge); } else { g.addColorStop(0, '#F2DDB4'); g.addColorStop(0.65, '#C9A06A'); g.addColorStop(1, '#94703F'); }
    x.fillStyle = g; x.beginPath(); x.arc(px, py, HG.pr, 0, TAU); x.fill();
    if (pc) {
      // a painted peg wears a thin cream ring so it reads as paint, not yarn
      x.strokeStyle = 'rgba(255,248,230,.85)'; x.lineWidth = 1.2; x.beginPath(); x.arc(px, py, HG.pr + 1.4, 0, TAU); x.stroke();
      if (glyphsOn()) drawGlyph(x, glyphOf(pc), px, py, HG.pr * 1.25, TONE[pc].ink);
    }
  }
  HG.bg = c;
}

// ---------- strand shapes ----------
// hoop-layout.js places every strand in the unit disk (knots at radius 1); here
// it is scaled to the hoop. One layout per state, kept while the state lives.
// A new state's layout starts where the last one's yarn lay (warm), so it
// settles in a fraction of the sweeps.
const toPx = ([x, y]) => [HG.cx + x * HG.Rk, HG.cy + y * HG.Rk];
const LAY = new WeakMap();
let lastLay = null; // { L, lay } the newest layout made, for the next warm start
const LAYSTAT = { n: 0, ms: 0, sweeps: 0 };
function layOf(s) {
  let r = LAY.get(s);
  if (!r) {
    const t0 = performance.now();
    const warm = lastLay && lastLay.L === L ? lastLay.lay.raw : null;
    r = layout(L, s, { warm });
    LAYSTAT.n++; LAYSTAT.ms += performance.now() - t0; LAYSTAT.sweeps += r.sweeps || 0;
    LAY.set(s, r);
    lastLay = { L, lay: r };
  }
  return r;
}
// The layout in css px (cached per layout and hoop size). A strand a move did
// not touch (the same knots, the same crossings in the same order, each with
// the same strand on top and the same sign) and that the new drawing moves by
// less than REUSE_PX keeps the very yarn it had (its points and its painted
// geometry): the settle leaves it be, and the cache repaints only the box of
// what changed (ensureCache compares curves by identity).
const PX = new Map();
const REUSE_PX = 0.5;
let lastPx = null; // the newest picture made, to reuse unchanged strands from
const wordOf = (s, i) => s.w[i].map((c) => { const X = s.x[c]; return `${X[0] === i ? X[1] : X[0]}${X[2] === i ? '+' : '-'}${X[3]}`; }).join(' ');
function pxOf(s) {
  const lay = layOf(s);
  let r = PX.get(lay);
  if (!r) {
    const strands = {}, geom = {};
    const prev = lastPx && lastPx.L === L && lastPx.css === HG.css ? lastPx : null;
    for (const [i, pts] of Object.entries(lay.strands)) {
      const mine = pts.map(toPx);
      const old = prev && prev.strands[i];
      if (old && old.length === mine.length && prev.s.ends[2 * i] === s.ends[2 * i] && prev.s.ends[2 * i + 1] === s.ends[2 * i + 1] && wordOf(prev.s, +i) === wordOf(s, +i)) {
        let d = 0;
        for (let k = 0; k < mine.length && d < REUSE_PX; k++) d = Math.max(d, Math.abs(mine[k][0] - old[k][0]), Math.abs(mine[k][1] - old[k][1]));
        if (d < REUSE_PX) { strands[i] = old; if (prev.geom[i]) geom[i] = prev.geom[i]; continue; }
      }
      strands[i] = mine;
    }
    const crossings = lay.crossings.map((X) => ({ ...X, p: toPx(X.p) }));
    r = { strands, crossings, geom, marks: hookMarks(s, crossings), s, L, css: HG.css };
    if (PX.size > 60) PX.clear();
    PX.set(lay, r);
    lastPx = r;
  }
  return r;
}
const pxGeom = (P, i) => P.geom[i] || (P.geom[i] = yarnGeom(P.strands[i], HG.w));
// Index in strand i's curve of the crossing nearest end e, or the far end.
function cutAt(P, s, e) {
  const i = e >> 1, c = nearestAt(s.w, e), pts = P.strands[i];
  if (c < 0) return e & 1 ? 0 : pts.length - 1;
  const X = P.crossings.find((Y) => Y.c === c);
  return X.a === i ? X.ka : X.kb;
}
// The strand with the end(s) in `ends` carried to point pt: everything up to
// its nearest crossing stays put, the rest rises over everything to pt. The
// point count stays the same, so crossing indices still hold.
function carried(P, s, i, ends, pt) {
  let pts = P.strands[i];
  for (const e of ends) {
    if ((e >> 1) !== i) continue;
    const k = cutAt(P, s, e), n = pts.length;
    const from = e & 1 ? k : 0, to = e & 1 ? n - 1 : k;
    const anchor = pts[k];
    const tip = pt;
    const cnt = to - from;
    if (cnt < 1) continue;
    // a soft curve: leave the anchor along the strand, bow a little inward
    const nb = pts[e & 1 ? Math.max(0, k - 1) : Math.min(n - 1, k + 1)];
    const dx = anchor[0] - nb[0], dy = anchor[1] - nb[1], dl = Math.hypot(dx, dy) || 1;
    const span = Math.hypot(tip[0] - anchor[0], tip[1] - anchor[1]);
    const ctl = [anchor[0] + (dx / dl) * span * 0.35, anchor[1] + (dy / dl) * span * 0.35];
    const seg = [];
    for (let j = 0; j <= cnt; j++) {
      const t = j / cnt, u = 1 - t;
      seg.push([u * u * anchor[0] + 2 * u * t * ctl[0] + t * t * tip[0], u * u * anchor[1] + 2 * u * t * ctl[1] + t * t * tip[1]]);
    }
    const out = pts.slice();
    if (e & 1) for (let j = 0; j <= cnt; j++) out[k + j] = seg[j];
    else for (let j = 0; j <= cnt; j++) out[k - j] = seg[j];
    pts = out;
  }
  return pts;
}
// A held (tapped) knot lifts the strand's end a little, up to its nearest crossing.
function liftedEnd(P, s, i, e, up) {
  const pts = P.strands[i], k = cutAt(P, s, e), n = pts.length;
  const out = pts.slice();
  const [ex, ey] = pts[e & 1 ? n - 1 : 0];
  const ax = (HG.cx - ex) / HG.Rk, ay = (HG.cy - ey) / HG.Rk; // toward the middle
  const span = Math.abs((e & 1 ? n - 1 : 0) - k) || 1;
  for (let j = 0; j <= span; j++) {
    const idx = e & 1 ? k + j : k - j;
    const f = (j / span) ** 1.5 * up;
    out[idx] = [pts[idx][0] + ax * 7 * f, pts[idx][1] + ay * 7 * f - 4 * f];
  }
  return out;
}

// ---------- effects state ----------
const FX = {
  lift: [], liftV: [], glowUntil: [], glow: [], alpha: [],
  slide: null,   // { movers, pt: [x,y] } the moving knot's position (css px)
  tug: null,     // { e, t0 }
  leaving: [],   // [{ s, pts, a, b, t0, dur }]
  wig: null,     // { e, t0 } a knot that can't be lifted gives a little shake
  pegShake: null,// { q, t0 }
  hint: null,    // { end, to, t0 }
  heldT0: 0,
};
function resetFx() {
  const n = L.S;
  FX.lift = Array(n).fill(0); FX.liftV = Array(n).fill(0);
  FX.glowUntil = Array(n).fill(0); FX.glow = Array(n).fill(0); FX.alpha = Array(n).fill(1);
  FX.slide = null; FX.tug = null; FX.leaving = []; FX.wig = null; FX.pegShake = null; FX.hint = null;
}
const curState = () => (view ? view.state : G.state);

// ---------- drawing ----------
const PERF = { frames: 0, draw: [], rebuilds: 0, partial: 0, sec: { shape: 0, plan: 0, cache: 0, blit: 0, pegs: 0, live: 0 } };
const tick = (k, t0) => { const t = performance.now(); PERF.sec[k] += t - t0; return t; };
let raf = 0, lastT = 0, heldPulseUntil = 0;
function kick() { if (!raf && visible && L && G && HG.ctx) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
  if (!visible || !L || !G || !HG.ctx) return;
  let more = false;
  const w0 = performance.now();
  try {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    more = physics(dt, now);
    draw(now);
    more = more || !!FX.slide || !!FX.tug || !!(view && view.morph) || FX.leaving.length > 0 || (FX.wig && now - FX.wig.t0 < 520) || (FX.pegShake && now - FX.pegShake.t0 < 420) ||
      (FX.hint && now - FX.hint.t0 < HINT_MS + 50) || (held >= 0 && now < heldPulseUntil + 50) || !!drag || FX.glowUntil.some((t) => t > now - 400);
  } catch (e) {
    console.error('The Hoop: a frame was skipped', e);
  }
  PERF.frames++;
  PERF.draw.push(performance.now() - w0);
  if (PERF.draw.length > 3000) PERF.draw.shift();
  if (more) raf = requestAnimationFrame(frame);
}

// Springs: a lifted strand rises, glows fade.
function physics(dt, now) {
  const rm = reduced();
  let moving = false;
  for (let i = 0; i < L.S; i++) {
    const lifted = (held >= 0 && movers(L, held).some((m) => (m >> 1) === i)) || (drag && movers(L, drag.e).some((m) => (m >> 1) === i)) || (FX.slide && FX.slide.movers.some((m) => (m >> 1) === i));
    const ft = lifted ? 1 : 0;
    if (rm) { FX.lift[i] = ft; FX.liftV[i] = 0; } else if (Math.abs(FX.lift[i] - ft) > 0.003 || Math.abs(FX.liftV[i]) > 0.003) {
      const a = 320 * (ft - FX.lift[i]) - 2 * 0.7 * Math.sqrt(320) * FX.liftV[i];
      FX.liftV[i] += a * dt; FX.lift[i] += FX.liftV[i] * dt;
      moving = true;
    } else { FX.lift[i] = ft; FX.liftV[i] = 0; }
    if (FX.glowUntil[i] > now) { FX.glow[i] = Math.min(1, FX.glow[i] + dt * 7); moving = true; } else if (FX.glow[i] > 0) { FX.glow[i] = Math.max(0, FX.glow[i] - dt * 2.4); moving = true; }
    if (FX.alpha[i] < 1) { FX.alpha[i] = rm ? 1 : Math.min(1, FX.alpha[i] + dt * 4); moving = true; }
  }
  return moving;
}

const HINT_MS = 3 * 2 * Math.PI * 240;
// (in steps of a tenth: a glow that breathes needs no more, and each step repaints a layer)
const pulse = (now, t0, until) => (reduced() || now - t0 > until ? 0.85 : Math.round((0.55 + 0.45 * Math.cos((now - t0) / 240)) * 10) / 10);

// The carried end(s) right now: { ends, pt } or null.
function carrying() {
  if (FX.slide) return { ends: FX.slide.movers, pt: FX.slide.pt };
  if (drag && drag.pt) return { ends: movers(L, drag.e), pt: drag.pt };
  return null;
}
// Where a knot is drawn now (css px), and how lifted it is (0..1).
function knotAt(e, s, now) {
  const cr = carrying();
  if (cr && cr.ends.includes(e)) return { p: cr.pt, up: 1 };
  const p = HG.peg[s.ends[e]];
  const lifted = held >= 0 && movers(L, held).includes(e);
  const up = lifted ? Math.max(0, FX.lift[e >> 1]) : 0;
  let x = p[0], y = p[1];
  if (up) { const a = HG.ang[s.ends[e]]; x -= Math.cos(a) * up * 7; y -= Math.sin(a) * up * 7 + up * 3; }
  if (FX.wig && FX.wig.e === e) {
    const t = clamp01((now - FX.wig.t0) / 500);
    const amp = 3.2 * Math.sin(t * Math.PI * 6) * (1 - t);
    const a = HG.ang[s.ends[e]] + Math.PI / 2;
    x += Math.cos(a) * amp; y += Math.sin(a) * amp;
  }
  return { p: [x, y], up };
}

// Strands repainted every frame: moving, lifted, glowing, fading or hinted.
function liveSet(s, now) {
  const D = new Set();
  if (view && view.morph) { for (const i of MORPH.live || []) if (!s.out[i]) D.add(i); return D; }
  for (let i = 0; i < L.S; i++) {
    if (s.out[i]) continue;
    if (FX.lift[i] > 0.002 || FX.glow[i] > 0 || FX.glowUntil[i] > now || FX.alpha[i] < 1 || (FX.hint && (FX.hint.end >> 1) === i)) D.add(i);
  }
  for (const e of [held, drag ? drag.e : -1, ...(FX.slide ? FX.slide.movers : [])]) if (e >= 0) for (const m of movers(L, e)) D.add(m >> 1);
  return D;
}
// This frame's curves (css px) and crossings: the layout, with a carried or
// held end moved, or a morph from the picture before a move to the one after.
function frameShape(s, D) {
  if (view && view.morph) return morphShape(view.morph);
  const P = pxOf(s);
  const curves = { ...P.strands };
  const cr = carrying();
  for (const i of D) {
    if (cr && cr.ends.some((e) => (e >> 1) === i)) curves[i] = carried(P, s, i, cr.ends, cr.pt);
    else if (held >= 0 && movers(L, held).some((m) => (m >> 1) === i) && FX.lift[i] > 0.002) curves[i] = liftedEnd(P, s, i, movers(L, held).find((m) => (m >> 1) === i), FX.lift[i]);
  }
  return { curves, crossings: P.crossings, P };
}
// Resample a polyline to n points by arc length.
function resample(pts, n) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const len = cum[cum.length - 1] || 1e-9, out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (len * k) / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const t = clamp01((d - cum[j]) / ((cum[j + 1] - cum[j]) || 1e-9));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}
const MORPH_N = 48;
// The settle after a move: { from: { i: pts }, to: { i: pts }, xb: [crossings
// after, each with its fraction along both strands], t }. Only the strands that
// really move (MORPH.live) are repainted each frame; the others are already in
// the cache at their new lie (their patches with them), and the plan of the
// live strands' patches is made once, its disks riding along with their
// crossings (no search per frame).
const MORPH = { live: null, plan: null, still: 0 };
const MORPH_STILL = 0.6; // css px: a strand that moves less than this over the whole settle is drawn at rest
function setupMorph(mo, P1) {
  const live = [];
  for (const i of Object.keys(mo.to)) {
    const A = mo.from[i], B = mo.to[i];
    let d = 0;
    if (!A) d = Infinity; else for (let k = 0; k < B.length; k++) d = Math.max(d, Math.abs(A[k][0] - B[k][0]) + Math.abs(A[k][1] - B[k][1]));
    if (d > MORPH_STILL) live.push(+i);
  }
  MORPH.live = live;
  MORPH.still = Object.keys(mo.to).length - live.length;
  // the plan once, on the new picture (the order of every crossing is fixed through the settle)
  const liveSet0 = new Set(live);
  const base = baseOrder(Object.keys(P1.strands).map(Number), P1.crossings);
  MORPH.plan = plan(P1.strands, P1.crossings, { w: HG.w, live: liveSet0, order: base, liveOnly: true });
  MORPH.base = base;
  // each live patch's crossing, to follow it
  const byPair = new Map(mo.xb.map((X) => [X.c, X]));
  for (const X of MORPH.plan.livePatches) {
    const near = mo.xb.find((Y) => Math.hypot(P1.crossings.find((Z) => Z.c === Y.c).p[0] - X.p[0], P1.crossings.find((Z) => Z.c === Y.c).p[1] - X.p[1]) < 1e-6);
    X.follow = near ? byPair.get(near.c) : null;
  }
}
function morphShape(mo) {
  const t = ease(mo.t), curves = {};
  const live = MORPH.live ? new Set(MORPH.live) : null;
  for (const i of Object.keys(mo.to)) {
    const A = mo.from[i], B = mo.to[i];
    if (live && !live.has(+i)) { curves[i] = B; continue; }
    curves[i] = A ? A.map((p, k) => [p[0] + (B[k][0] - p[0]) * t, p[1] + (B[k][1] - p[1]) * t]) : B;
  }
  return { curves, crossings: null, P: null };
}
// Where each crossing sits along its two strands, as fractions of arc length.
function fractions(P) {
  const frac = (pts, k) => { let a = 0, b = 0; for (let j = 1; j < pts.length; j++) { const d = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); b += d; if (j <= k) a += d; } return b ? a / b : 0; };
  return P.crossings.map((X) => ({ ...X, fa: frac(P.strands[X.a], X.ka), fb: frac(P.strands[X.b], X.kb) }));
}

function styleOf(i, now) {
  const hintGlow = FX.hint && (FX.hint.end >> 1) === i ? pulse(now, FX.hint.t0, HINT_MS) * 0.8 : 0;
  return { w: HG.w, tone: TONE[L.color[i]], lift: FX.lift[i], glow: Math.max(FX.glow[i], hintGlow), alpha: FX.alpha[i], glyph: glyphsOn() ? L.color[i] : null };
}
const restStyle = (i) => ({ w: HG.w, tone: TONE[L.color[i]], glyph: glyphsOn() ? L.color[i] : null });
// A patch: the strands near a crossing, repainted in its order.
// (each strand only where it comes near the disk: a slice, its ply in step)
function paintPatch(c, X, ptsOf, style, fast = false) {
  c.save();
  c.beginPath(); c.arc(X.p[0], X.p[1], X.r, 0, TAU); c.clip();
  X.order.forEach((i, k) => {
    const g = sliceGeom(ptsOf(i), X.p, X.r + 2.2 * HG.w, fast);
    if (g) paintYarn(c, g, { ...style(i), glyph: null, fast, noShadow: k === 0 });
  });
  c.restore();
}
// The part of a strand within reach of a point, as yarn geometry in step with the whole.
function sliceGeom(pts, p, reach, fast = false) {
  let lo = -1, hi = -1, acc = 0, s0 = 0;
  const r2 = reach * reach;
  for (let k = 0; k < pts.length; k++) {
    if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const dx = pts[k][0] - p[0], dy = pts[k][1] - p[1];
    if (dx * dx + dy * dy <= r2) { if (lo < 0) { lo = k; s0 = acc; } hi = k; }
  }
  if (lo < 0) return null;
  if (lo > 0) { lo--; s0 -= Math.hypot(pts[lo + 1][0] - pts[lo][0], pts[lo + 1][1] - pts[lo][1]); }
  hi = Math.min(pts.length - 1, hi + 1);
  return fast ? pathGeom(pts.slice(lo, hi + 1)) : yarnGeom(pts.slice(lo, hi + 1), HG.w, s0);
}
// The cache: the hoop and every strand at rest (with their patches). When only
// some strands changed since it was painted (the same layout object for the
// rest, so the same yarn, exactly), only the box they cover is repainted.
function boxOf(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function ensureCache(s, D, P, plan0) {
  const sig = `${glyphsOn() ? 'g' : ''}|${stateKeyOf(s)}|${[...D].sort().join(',')}|${HG.css}`;
  if (sig === CACHE.sig) return;
  CACHE.sig = sig;
  const c = CACHE.ctx;
  const glyph = glyphsOn();
  // what is in the cache now, strand by strand: its curve (exact identity) and paint
  const want = {};
  for (const i of plan0.rest) want[i] = P.strands[i];
  const was = CACHE.drawn;
  let box = null;
  if (was && was.css === HG.css && was.glyph === glyph && was.L === L) {
    const changed = new Set();
    for (const i of new Set([...Object.keys(want), ...Object.keys(was.curves)])) if (want[i] !== was.curves[i]) changed.add(+i);
    // a patch that changed (a crossing came, went, or changed order) repaints too
    const pk = (X) => `${X.p[0].toFixed(2)},${X.p[1].toFixed(2)},${X.r.toFixed(2)},${X.order.join('.')}`;
    const nowKeys = new Set(plan0.restPatches.map(pk));
    const oldPatches = was.patches.filter((X) => !nowKeys.has(X.key));
    const oldKeys = new Set(was.patches.map((X) => X.key));
    const newPatches = plan0.restPatches.filter((X) => !oldKeys.has(pk(X)));
    if (changed.size + oldPatches.length + newPatches.length === 0) { CACHE.drawn = { ...was, patches: plan0.restPatches.map((X) => ({ key: pk(X), p: X.p, r: X.r })) }; return; }
    if (changed.size <= Math.max(2, Object.keys(want).length / 2)) {
      const pad = HG.w * 2.4;
      const boxes = [];
      for (const i of changed) { if (was.curves[i]) boxes.push(boxOf(was.curves[i], pad)); if (want[i]) boxes.push(boxOf(want[i], pad)); }
      for (const X of [...oldPatches, ...newPatches]) boxes.push([X.p[0] - X.r - pad, X.p[1] - X.r - pad, X.p[0] + X.r + pad, X.p[1] + X.r + pad]);
      if (boxes.length) box = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (box) {
    // the box in device px, snapped outward so no half pixel is left behind
    const d = HG.dpr;
    const bx = Math.max(0, Math.floor(box[0] * d)), by = Math.max(0, Math.floor(box[1] * d));
    const bw = Math.min(CACHE.cv.width, Math.ceil(box[2] * d)) - bx, bh = Math.min(CACHE.cv.height, Math.ceil(box[3] * d)) - by;
    c.save();
    c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
    c.clearRect(bx, by, bw, bh);
    c.drawImage(HG.bg, bx, by, bw, bh, bx, by, bw, bh);
    c.setTransform(d, 0, 0, d, 0, 0);
    const inBox = (pts) => { const b = boxOf(pts, HG.w * 1.5); return b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]; };
    for (const i of plan0.rest) if (inBox(P.strands[i])) paintYarn(c, pxGeom(P, i), restStyle(i));
    for (const X of plan0.restPatches) if (X.p[0] + X.r > box[0] && X.p[0] - X.r < box[2] && X.p[1] + X.r > box[1] && X.p[1] - X.r < box[3]) paintPatch(c, X, (i) => P.strands[i], restStyle);
    c.restore();
    PERF.partial++;
  } else {
    c.clearRect(0, 0, CACHE.cv.width, CACHE.cv.height);
    c.drawImage(HG.bg, 0, 0);
    c.setTransform(HG.dpr, 0, 0, HG.dpr, 0, 0);
    for (const i of plan0.rest) paintYarn(c, pxGeom(P, i), restStyle(i));
    for (const X of plan0.restPatches) paintPatch(c, X, (i) => P.strands[i], restStyle);
    PERF.rebuilds++;
  }
  const pk = (X) => `${X.p[0].toFixed(2)},${X.p[1].toFixed(2)},${X.r.toFixed(2)},${X.order.join('.')}`;
  CACHE.drawn = { css: HG.css, glyph, L, curves: want, patches: plan0.restPatches.map((X) => ({ key: pk(X), p: X.p, r: X.r })) };
}
// a cheap identity for a state (the cache's signature)
const SKEY = new WeakMap();
let skeyN = 0;
const stateKeyOf = (s) => { let k = SKEY.get(s); if (!k) { k = ++skeyN; SKEY.set(s, k); } return k; };
// The rest plan depends only on the state and which strands are live.
let restPlan = { key: '', plan: null, base: null };

function draw(now) {
  const c = HG.ctx, s = curState();
  let t = performance.now();
  const D = liveSet(s, now);
  const morph = !!(view && view.morph);
  const sh = frameShape(s, D);
  t = tick('shape', t);
  let P0;
  if (!morph) {
    const key = `${stateKeyOf(s)}|${[...D].sort().join(',')}|${HG.css}`;
    if (restPlan.key !== key) {
      const base = baseOrder(Object.keys(sh.P.strands).map(Number), sh.crossings);
      restPlan = { key, base, plan: plan(sh.P.strands, sh.crossings, { w: HG.w, live: D, order: base }) };
    }
    P0 = restPlan.plan;
    t = tick('plan', t);
    ensureCache(s, D, sh.P, P0);
    t = tick('cache', t);
  } else if (view.morph.cached !== CACHE.sig || !CACHE.sig) {
    // the settle: the still strands at their new lie, in the cache, once
    const P1 = pxOf(view.state);
    const key = `${stateKeyOf(view.state)}|${MORPH.live.slice().sort().join(',')}|${HG.css}`;
    if (restPlan.key !== key) {
      const base = MORPH.base || baseOrder(Object.keys(P1.strands).map(Number), P1.crossings);
      restPlan = { key, base, plan: plan(P1.strands, P1.crossings, { w: HG.w, live: new Set(MORPH.live), order: base }) };
    }
    ensureCache(view.state, new Set(MORPH.live), P1, restPlan.plan);
    view.morph.cached = CACHE.sig;
    t = tick('cache', t);
  }
  const r2 = (v) => Math.round(v * 100);
  // Which knots move this frame (they go on the top layer); the rest rest on the base.
  const cr = carrying();
  const dyn = new Set();
  for (let e = 0; e < 2 * L.S; e++) {
    if (s.out[e >> 1]) continue;
    const K = knotAt(e, s, now);
    if (K.up > 0 || (FX.tug && movers(L, FX.tug.e).includes(e)) || (FX.wig && FX.wig.e === e && now - FX.wig.t0 < 520) || FX.alpha[e >> 1] < 1
      || (FX.hint && (FX.hint.end === e || FX.hint.end === L.link[e]) && now - FX.hint.t0 < HINT_MS + 50)) {
      dyn.add(e);
      if (L.link[e] >= 0) dyn.add(L.link[e]);
    }
  }
  const dynKey = [...dyn].sort((a, b) => a - b).join(',');
  // The base: the cache, every knot at rest, the hooked marks. Composed only when one of them changes.
  const bsig = [CACHE.sig, stateKeyOf(s), stateKeyOf(G.state), busy ? 1 : 0, morph ? 1 : 0, dynKey, hooksOn() ? 1 : 0, glyphsOn() ? 1 : 0, HG.css].join('|');
  if (bsig !== BASE.sig) {
    BASE.sig = bsig;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, HG.cv.width, HG.cv.height); // the hoop's edges are see-through: never paint over last frame
    c.drawImage(CACHE.cv, 0, 0);
    c.setTransform(HG.dpr, 0, 0, HG.dpr, 0, 0);
    // hooked marks: a small pair of linked rings where two strands hook
    LAST.marks = !morph && hooksOn() && sh.P ? sh.P.marks : [];
    for (const m of LAST.marks) drawHookMark(c, m.p);
    drawKnots(c, now, s, (e) => !dyn.has(e));
    if (BASE.mode === 'bitmap') BASE.out.transferFromImageBitmap(BASE.off.transferToImageBitmap());
    t = tick('blit', t);
  }
  pegEffects(now);
  t = tick('pegs', t);
  // The top layer (or, while something moves, the motion layer): live strands,
  // their patches, strands coming free, the knots that move. Only repainted
  // when something on it changes, cleared only inside the box it painted last
  // time, and hidden while it is empty.
  const slot = (t0, ms) => (t0 !== undefined && now - t0 < ms ? Math.round((now - t0) / 12) : '');
  const sig = [
    stateKeyOf(s), stateKeyOf(G.state), morph ? `m${view.morph.t.toFixed(3)}` : '', [...D].join(','),
    [...D].map((i) => `${r2(FX.lift[i])},${r2(FX.glow[i])},${r2(FX.alpha[i])}`).join(';'),
    FX.hint ? r2(pulse(now, FX.hint.t0, HINT_MS)) : '', cr ? `${cr.pt[0].toFixed(1)},${cr.pt[1].toFixed(1)}` : '',
    FX.leaving.map((f) => slot(f.t0, f.dur + 50) + (now < f.t0 ? 'w' : '')).join(','), slot(FX.wig && FX.wig.t0, 520), slot(FX.tug && FX.tug.t0, 260),
    busy ? 1 : 0, held, dynKey, glyphsOn() ? 1 : 0, HG.css,
  ].join('|');
  const layer = busy ? MOTION : TOP, other = busy ? TOP : MOTION;
  if (other.box !== null) {
    // what was on the other layer goes: everything moving is on this one now
    const o = other.ctx, d = other === MOTION ? MOTION.dpr : HG.dpr;
    o.setTransform(1, 0, 0, 1, 0, 0);
    clearBox(o, other.box, d);
    other.box = null; other.sig = '';
    other.cv.hidden = true;
  }
  if (sig !== layer.sig) {
    layer.sig = sig;
    const o = layer.ctx, d = layer === MOTION ? MOTION.dpr : HG.dpr;
    o.setTransform(1, 0, 0, 1, 0, 0);
    if (layer.box) clearBox(o, layer.box, d); else o.clearRect(0, 0, layer.cv.width, layer.cv.height);
    o.setTransform(d, 0, 0, d, 0, 0);
    layer.box = drawTop(o, now, s, sh, D, morph, P0, dyn);
    layer.cv.hidden = !layer.box;
  }
  tick('live', t);
}
// The glowing pegs for a lifted knot, the hint's ring, a peg's shake: DOM rings (see PEGFX).
function pegEffects(now) {
  const box = $('#hp-pegfx');
  if (!box) return;
  const liftE = drag ? drag.e : held;
  const ts = liftE >= 0 && !busy ? targets(L, G.state, liftE) : [];
  const over = drag ? drag.over : -1;
  const hintTo = FX.hint && FX.hint.to >= 0 && now - FX.hint.t0 < HINT_MS + 50 ? FX.hint.to : -1;
  const shake = FX.pegShake && now - FX.pegShake.t0 < 420 ? FX.pegShake : null;
  if (FX.pegShake && !shake) FX.pegShake = null;
  const sig = `${ts.join(',')}|${over}|${hintTo}|${FX.hint ? FX.hint.t0 : 0}|${shake ? `${shake.q}@${shake.t0}` : ''}|${HG.css}`;
  if (sig === PEGFX.sig) return;
  PEGFX.sig = sig;
  const ring = (q, cls, r) => { const [x, y] = HG.peg[q]; return `<i class="${cls}" style="left:${(x - r).toFixed(1)}px;top:${(y - r).toFixed(1)}px;width:${(2 * r).toFixed(1)}px;height:${(2 * r).toFixed(1)}px"></i>`; };
  let html = '';
  for (const q of ts) html += ring(q, q === over ? 'hp-pg hp-over' : 'hp-pg', HG.pr + (q === over ? 8 : 5));
  if (hintTo >= 0) html += ring(hintTo, 'hp-hr', HG.pr + 9);
  if (shake) html += ring(shake.q, 'hp-ps', HG.pr + 4);
  box.innerHTML = html;
}
// Clear a box (css px) on a layer with d device px per css px, snapped outward.
function clearBox(o, b, d = HG.dpr) {
  const x0 = Math.max(0, Math.floor(b[0] * d) - 1), y0 = Math.max(0, Math.floor(b[1] * d) - 1);
  const x1 = Math.min(o.canvas.width, Math.ceil(b[2] * d) + 1), y1 = Math.min(o.canvas.height, Math.ceil(b[3] * d) + 1);
  if (x1 > x0 && y1 > y0) o.clearRect(x0, y0, x1 - x0, y1 - y0);
}
const grow = (a, b) => (!a ? b : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
// Returns the box (css px) it painted in, or null.
function drawTop(c, now, s, sh, D, morph, P0, dyn) {
  // live strands, then every crossing they take part in that needs a patch
  let LP;
  if (morph) {
    // the plan made once for the settle; each disk rides along with its crossing
    LP = MORPH.plan;
    for (const X of LP.livePatches) {
      const F = X.follow;
      if (!F) continue;
      const ka = Math.round(F.fa * (MORPH_N - 1)), kb = Math.round(F.fb * (MORPH_N - 1));
      const pa = sh.curves[F.a][ka], pb = sh.curves[F.b][kb];
      X.p = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    }
  } else {
    LP = plan(sh.curves, sh.crossings, { w: HG.w, live: D, order: restPlan.base, liveOnly: true });
  }
  let box = null;
  const geo = {};
  const geomOf = (i) => geo[i] || (geo[i] = morph ? pathGeom(sh.curves[i]) : sh.curves[i] === sh.P.strands[i] ? pxGeom(sh.P, i) : yarnGeom(sh.curves[i], HG.w));
  const st = (i) => ({ ...styleOf(i, now), fast: morph });
  for (const i of LP.live) { paintYarn(c, geomOf(i), st(i)); box = grow(box, boxOf(sh.curves[i], HG.w * 2.6)); }
  for (const X of LP.livePatches) { paintPatch(c, X, (i) => sh.curves[i], st, morph); box = grow(box, [X.p[0] - X.r - 2, X.p[1] - X.r - 2, X.p[0] + X.r + 2, X.p[1] + X.r + 2]); }
  LAST.curves = sh.curves; LAST.plan = LP; LAST.restPlan = morph ? restPlan.plan : P0; LAST.crossings = morph ? null : sh.crossings;
  // strands coming free
  for (const f of FX.leaving) { drawLeaving(c, f, now); box = grow(box, boxOf(f.pts, HG.w * 3.4)); }
  // the knots that move, on top of their yarn
  const kb = drawKnots(c, now, s, (e) => dyn.has(e));
  if (kb) box = grow(box, kb);
  return box;
}
// Knots: each one wanted (a shared knot once), on top of the yarn. Returns the box they cover.
function drawKnots(c, now, s, want) {
  let box = null;
  const doneLink = new Set();
  for (let i = 0; i < L.S; i++) {
    if (s.out[i]) continue;
    for (const e of [2 * i, 2 * i + 1]) {
      if (doneLink.has(e) || !want(e)) continue;
      const lk = L.link[e];
      if (lk >= 0) doneLink.add(lk);
      const K = knotAt(e, s, now);
      const hintK = FX.hint && (FX.hint.end === e || FX.hint.end === lk) ? pulse(now, FX.hint.t0, HINT_MS) : 0;
      let scale = 1 + 0.32 * K.up;
      if (FX.tug && movers(L, FX.tug.e).includes(e)) {
        const tt = clamp01((now - FX.tug.t0) / 240);
        scale = tt < 0.4 ? 1.32 - (0.5 * tt) / 0.4 : 0.82 + 0.18 * easeOut((tt - 0.4) / 0.6);
      }
      // over and under: knots she can lift now wear a soft cream ring
      const ready = L.layering && !busy && !K.up && !L.fixed[e] && !canLift(L, G.state, e);
      drawKnot(c, K.p, e, { scale, up: K.up, tone2: lk >= 0 ? TONE[L.color[lk >> 1]] : null, hint: hintK, alpha: FX.alpha[i], ready });
      const rr = HG.w * scale * 2.2 + 6;
      box = grow(box, [K.p[0] - rr, K.p[1] - rr, K.p[0] + rr, K.p[1] + rr + K.up * 6]);
    }
  }
  return box;
}
const LAST = { curves: null, plan: null, restPlan: null, crossings: null, marks: [] };
function drawHookMark(c, p) {
  const r = Math.max(2.6, HG.w * 0.36), dx = r * 0.62;
  c.save();
  c.globalAlpha = 0.92;
  c.lineWidth = 3; c.strokeStyle = 'rgba(60,40,20,.55)';
  for (const sx of [-1, 1]) { c.beginPath(); c.arc(p[0] + sx * dx, p[1], r, 0, TAU); c.stroke(); }
  c.lineWidth = 1.5; c.strokeStyle = '#F6E7B8';
  c.beginPath(); c.arc(p[0] - dx, p[1], r, 0, TAU); c.stroke();
  c.beginPath(); c.arc(p[0] + dx, p[1], r, Math.PI * 0.75, Math.PI * 2.25); c.stroke(); // the second ring passes through the first
  c.restore();
}

// A knot: a round of yarn on the peg with two little tails toward the rim.
function drawKnot(c, p, e, { scale = 1, up = 0, tone2 = null, hint: hk = 0, alpha = 1, ready = false } = {}) {
  const i = e >> 1, w = HG.w * scale, t = TONE[L.color[i]];
  const [x, y] = p;
  const a = Math.atan2(y - HG.cy, x - HG.cx);
  c.save();
  c.globalAlpha = alpha;
  if (hk > 0) { c.fillStyle = `rgba(242,190,70,${0.5 * hk})`; c.beginPath(); c.arc(x, y, w * 1.45, 0, TAU); c.fill(); }
  if (ready) { c.strokeStyle = 'rgba(255,250,236,.95)'; c.lineWidth = 2.2; c.beginPath(); c.arc(x, y, w * 1.02, 0, TAU); c.stroke(); }
  c.fillStyle = `rgba(50,30,12,${0.26 + 0.1 * up})`;
  c.beginPath(); c.arc(x + 1 + up * 3, y + 1.5 + up * 5, w * 0.72, 0, TAU); c.fill();
  c.lineCap = 'round';
  for (const sd of [-0.5, 0.45]) {
    const ta = a + sd;
    const ex = x + Math.cos(ta) * w * 1.25, ey = y + Math.sin(ta) * w * 1.25;
    c.strokeStyle = t.edge; c.lineWidth = w * 0.42;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * w * 0.7, y + Math.sin(a) * w * 0.7, ex, ey); c.stroke();
    c.strokeStyle = (sd < 0 || !tone2 ? t : tone2).base; c.lineWidth = w * 0.3;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * w * 0.7, y + Math.sin(a) * w * 0.7, ex, ey); c.stroke();
  }
  const r = w * (tone2 ? 0.82 : 0.72);
  c.fillStyle = t.edge; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  if (tone2) {
    c.fillStyle = t.base; c.beginPath(); c.arc(x, y, r * 0.84, a + Math.PI / 2, a + Math.PI * 1.5); c.fill();
    c.fillStyle = tone2.base; c.beginPath(); c.arc(x, y, r * 0.84, a - Math.PI / 2, a + Math.PI / 2); c.fill();
    c.strokeStyle = tone2.edge; c.lineWidth = w * 0.12; c.beginPath(); c.moveTo(x + Math.cos(a + Math.PI / 2) * r * 0.84, y + Math.sin(a + Math.PI / 2) * r * 0.84); c.lineTo(x - Math.cos(a + Math.PI / 2) * r * 0.84, y - Math.sin(a + Math.PI / 2) * r * 0.84); c.stroke();
  } else {
    c.fillStyle = t.base; c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.fill();
  }
  c.strokeStyle = 'rgba(28,16,6,.32)'; c.lineWidth = w * 0.1;
  c.beginPath(); c.arc(x, y, r * 0.5, a - 0.9, a + 0.9); c.stroke();
  c.beginPath(); c.arc(x, y, r * 0.5, a + Math.PI - 0.9, a + Math.PI + 0.9); c.stroke();
  c.fillStyle = 'rgba(255,248,230,.4)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.32, r * 0.24, 0, TAU); c.fill();
  if (L.fixed[e]) {
    // a brass tack holds it down
    const tr = Math.max(4.2, r * 0.68);
    const g = c.createRadialGradient(x - tr * 0.3, y - tr * 0.35, tr * 0.08, x, y, tr);
    g.addColorStop(0, '#FFF1C2'); g.addColorStop(0.5, '#D7AE52'); g.addColorStop(1, '#7E5E22');
    c.fillStyle = 'rgba(40,25,8,.4)'; c.beginPath(); c.arc(x + 0.9, y + 1.4, tr, 0, TAU); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(x, y, tr, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(80,55,15,.8)'; c.lineWidth = 0.9; c.beginPath(); c.arc(x, y, tr, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(x - tr * 0.32, y - tr * 0.36, tr * 0.22, 0, TAU); c.fill();
  } else if (glyphsOn()) {
    drawGlyph(c, glyphOf(L.color[i]), x, y, r * 1.15, t.ink);
  }
  c.restore();
}

// A strand coming free: it glows and loosens, slips off its pegs toward its
// middle, then a little skein flies to the shelf (DOM).
function drawLeaving(c, f, now) {
  if (now < f.t0) { paintYarn(c, f.g || (f.g = yarnGeom(f.pts, HG.w)), { w: HG.w, tone: TONE[L.color[f.s]] }); return; }
  const t = clamp01((now - f.t0) / f.dur);
  const pts = f.pts;
  const A = pts[0], B = pts[pts.length - 1];
  const glow = Math.min(1, t * 4);
  const slip = clamp01((t - 0.35) / 0.65);
  let part = pts;
  if (slip > 0) {
    const len = f.len || (f.len = yarnGeom(pts, HG.w).len);
    const cut = len * 0.5 * ease(slip);
    part = sliceBy(pts, cut, len - cut);
  }
  if (part.length < 2) return;
  const g = slip > 0 ? pathGeom(part) : (f.g || (f.g = yarnGeom(pts, HG.w)));
  const rise = ease(Math.min(1, t * 2.2));
  c.save();
  c.translate(0, -rise * HG.w * 0.9);
  paintYarn(c, g, { w: HG.w, tone: TONE[L.color[f.s]], lift: 0.6 + 1.4 * rise, glow, alpha: 1 - slip * 0.35 });
  c.restore();
  if (slip < 0.5) {
    for (const p of [A, B]) {
      c.save(); c.globalAlpha = 1 - slip * 2;
      c.fillStyle = TONE[L.color[f.s]].base; c.beginPath(); c.arc(p[0], p[1], HG.w * 0.55 * (1 - slip), 0, TAU); c.fill();
      c.restore();
    }
  }
}
function sliceBy(pts, a, b) {
  const out = [];
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const s0 = acc, s1 = acc + d;
    if (s1 >= a && s0 <= b) {
      const ta = Math.max(0, (a - s0) / (d || 1)), tb = Math.min(1, (b - s0) / (d || 1));
      if (!out.length) out.push([p[0] + (q[0] - p[0]) * ta, p[1] + (q[1] - p[1]) * ta]);
      out.push([p[0] + (q[0] - p[0]) * tb, p[1] + (q[1] - p[1]) * tb]);
    }
    acc = s1;
  }
  return out;
}

// ---------- hit testing: each peg owns a wedge of the hoop ----------
// A tap anywhere from the middle of the linen out past the rim, within half a
// peg's angle, is that peg (with 20 pegs a wedge is about 48 px wide at the
// rim and runs 90 px deep, far more than the 44 px minimum).
function pegAt(x, y) {
  const dx = x - HG.cx, dy = y - HG.cy;
  const r = Math.hypot(dx, dy) / HG.Rk;
  if (r < 0.42 || r > 1.32) return -1;
  const a = Math.atan2(dy, dx) + Math.PI / 2;
  const k = Math.round((a / (2 * Math.PI)) * L.n - 0.5);
  return ((k % L.n) + L.n) % L.n;
}
const canvasXY = (e) => { const r = HG.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const pageOf = (p) => { const r = HG.cv.getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };

// ---------- input ----------
let down = null;
const DRAG_LIFT = 26; // a dragged knot rides above a finger so she can see it
function bindHoop(hoopEl) {
  hoopEl.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || !L || !G) return;
    if (busy) { skipAll(); return; }
    const [x, y] = canvasXY(e);
    const q = pegAt(x, y);
    // a press on yarn, away from the knots: the strand's middle
    let strand = -1;
    if (held < 0) {
      let nearKnot = Infinity;
      for (const p of G.state.ends) if (p >= 0) nearKnot = Math.min(nearKnot, Math.hypot(HG.peg[p][0] - x, HG.peg[p][1] - y));
      if (nearKnot > Math.max(30, HG.w * 3)) strand = strandUnder(x, y);
      else if (L.liftoff && nearKnot > Math.max(18, HG.w * 2)) {
        // a short strand pulled taut across another's knot, tucked by the rim:
        // right on its yarn, clear of its own knots, it can still be lifted off
        const i = strandUnder(x, y);
        const own = i >= 0 ? Math.min(...[0, 1].map((k) => { const p = G.state.ends[2 * i + k]; return Math.hypot(HG.peg[p][0] - x, HG.peg[p][1] - y); })) : 0;
        if (i >= 0 && own > Math.max(30, HG.w * 3) && !canLiftOff(L, G.state, i)) strand = i;
      }
    }
    down = { id: e.pointerId, x, y, q, touch: e.pointerType !== 'mouse', moved: false, strand };
    try { hoopEl.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  hoopEl.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id || busy) return;
    const [x, y] = canvasXY(e);
    if (!drag) {
      if (Math.hypot(x - down.x, y - down.y) < 10) return;
      if (down.strand >= 0) { down.moved = true; return; } // a strand's middle: picked up on release
      // a drag starts only from a knot that can be lifted
      const st = G.state;
      const es = down.q >= 0 ? endsAt(L, st, down.q) : [];
      if (!es.length) { down.moved = true; return; }
      const e0 = Math.min(...es);
      if (canLift(L, st, e0) || !targets(L, st, e0).length) { down.moved = true; liftAt(down.q); return; }
      if (held >= 0 && held !== e0) held = -1;
      drag = { e: e0, over: -1, pt: null, touch: down.touch };
      held = -1;
      FX.heldT0 = performance.now(); heldPulseUntil = FX.heldT0 + 2400;
      FX.hint = null;
      stats.drags++;
      sfx('lift');
      note = 'Let go over a glowing peg to tie it there.';
      render();
    }
    const pt = [x, y - (drag.touch ? DRAG_LIFT : 0)];
    drag.pt = pt;
    let over = pegAt(pt[0], pt[1]);
    if (over >= 0 && whyNotTo(L, G.state, drag.e, over)) over = -1;
    if (over < 0) {
      // the nearest valid peg within reach of the knot, so near misses still land
      let best = -1, bd = Infinity;
      for (const q of targets(L, G.state, drag.e)) { const d = Math.hypot(HG.peg[q][0] - pt[0], HG.peg[q][1] - pt[1]); if (d < bd) { bd = d; best = q; } }
      if (bd < Math.max(30, HG.pr * 4)) over = best;
    }
    drag.over = over;
    kick();
  });
  hoopEl.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const d = down;
    down = null;
    if (drag) {
      const dg = drag;
      drag = null;
      if (dg.over >= 0) { doMove(dg.e, dg.over, dg.pt); return; }
      note = 'Put back. Drag a knot onto a glowing peg, or tap it and then a peg.';
      render(); kick();
      return;
    }
    if (d.strand >= 0) { strandTap(d.strand); return; }
    if (d.moved) return;
    // a tap on the yarn itself, away from any knot: show where the handles are
    if (held < 0 && !busy && (d.q < 0 || !endsAt(L, G.state, d.q).length)) {
      const i = strandUnder(d.x, d.y);
      if (i >= 0) { strandTap(i); return; }
    }
    tapPeg(d.q);
  });
  hoopEl.addEventListener('pointercancel', () => { down = null; if (drag) { drag = null; render(); kick(); } });
}
// The strand whose yarn lies under a point (the one on top there), or -1.
function strandUnder(x, y) {
  const P = pxOf(G.state);
  const reach = Math.max(14, HG.w * 1.5);
  const near = Object.keys(P.strands).map(Number).filter((i) => distTo(P.strands[i], [x, y]) <= reach);
  if (near.length <= 1) return near.length ? near[0] : -1;
  const sub = {};
  for (const i of near) sub[i] = P.strands[i];
  const pl = plan(sub, P.crossings.filter((X) => near.includes(X.a) && near.includes(X.b)), { w: HG.w });
  const top = topAt(sub, pl, [x, y], reach * 2);
  return top >= 0 ? top : near[0];
}
// A tap (or drag) on a strand's middle: before the lift-off band, a reminder
// that the knots are the handles; from it on, a lift-off if the strand lies
// on top of everything, or why not.
function strandTap(i) {
  if (busy || isDone(G.state)) return;
  const now = performance.now();
  if (L.liftoff) {
    const why = canLiftOff(L, G.state, i);
    if (!why) { doLiftOff(i); return; }
    if (why.reason === 'under') {
      for (const b of why.blockers) FX.glowUntil[b] = now + 1300;
      const hookedTo = why.blockers.filter((b) => hookedPairs(L, G.state).some(([a, c]) => (a === i && c === b) || (a === b && c === i)));
      note = hookedTo.length
        ? 'Hooked with the glowing strand, so it can’t lift off yet. Unhook them first.'
        : `The glowing ${why.blockers.length === 1 ? 'strand lies' : 'strands lie'} over it. Only a strand on top of everything lifts off.`;
    } else if (why.reason === 'stitched') note = 'A brass tack holds this strand to the hoop, so it stays on. Move its other end instead.';
    else note = `To move the ${cshort(L.color[i])} strand, tap one of its knots.`;
    FX.glowUntil[i] = now + 600;
    sfx('soft');
    render(); kick();
    return;
  }
  FX.glowUntil[i] = now + 900;
  note = `To move the ${cshort(L.color[i])} strand, tap one of its knots, where it’s tied to a peg.`;
  sfx('soft');
  render(); kick();
}

function tapPeg(q) {
  if (!L || busy || isDone(G.state)) return;
  const st = G.state;
  if (q < 0) {
    if (held >= 0) { held = -1; note = ''; render(); kick(); }
    return;
  }
  const es = endsAt(L, st, q);
  if (held >= 0) {
    if (es.some((e) => movers(L, held).includes(e))) { held = -1; note = 'Put back.'; sfx('soft'); render(); kick(); return; }
    const why = whyNotTo(L, st, held, q);
    if (!why) { doMove(held, q, null); return; }
    if (why === 'taken') { liftAt(q); return; }
    FX.pegShake = { q, t0: performance.now() };
    if (why === 'color') note = `That painted peg only takes ${cshort(L.pegColor[q])} yarn.`;
    else if (why === 'around') note = 'A shared knot can’t go round past either of its own strands’ far knots.';
    sfx('soft');
    render(); kick();
    return;
  }
  if (!es.length) { note = 'Tap a knot first, then an empty peg.'; FX.pegShake = { q, t0: performance.now() }; render(); kick(); return; }
  liftAt(q);
}

function liftAt(q) {
  const st = G.state;
  const es = endsAt(L, st, q);
  const e = Math.min(...es);
  const why = canLift(L, st, e);
  const now = performance.now();
  if (why) {
    stats.blocked++;
    held = -1;
    FX.wig = reduced() ? null : { e, t0: now };
    if (why.reason === 'fixed') note = 'This knot is stitched down with a brass tack. Move the strand’s other end instead.';
    else if (why.reason === 'under') {
      for (const b of why.blockers) FX.glowUntil[b] = now + 1300;
      note = why.blockers.length === 1 ? 'The glowing strand lies over this one, near its knot. Move it first.' : `${why.blockers.length} glowing strands lie over this one, near its knot. Move them first.`;
    }
    sfx('soft');
    render(); kick();
    return;
  }
  const ts = targets(L, st, e);
  if (!ts.length) {
    held = -1;
    FX.wig = reduced() ? null : { e, t0: now };
    note = 'No empty peg this knot can go to yet. Free a strand to make room.';
    sfx('soft');
    render(); kick();
    return;
  }
  held = e;
  FX.heldT0 = now; heldPulseUntil = now + 2400;
  const hk = FX.hint;
  if (hk && hk.end !== e && hk.end !== L.link[e]) FX.hint = null;
  sfx('lift');
  note = L.link[e] >= 0 ? 'Both strands lift with the shared knot. Tap a glowing peg to tie it there.' : 'Now tap a glowing peg to tie it there. Tap the knot again to put it back.';
  render(); kick();
}

// ---------- the game state, through the sim ----------
function syncG() {
  const cur = HS().current(S());
  G = cur ? { state: cur.s, past: cur.past } : null;
  if (cur) setYarns(cur.yarns);
  lastSig = sigOfGame();
  return cur;
}
function sigOfGame() {
  const g = S().hoop && S().hoop.game;
  return g ? `${g.level}|${g.moves.length}|${g.moves[g.moves.length - 1] ?? ''}` : 'none';
}

// ---------- the move: carry over, settle into place, maybe come free ----------
function doMove(e, q, fromPt) {
  const before = G.state;
  const hooked0 = hookedPairs(L, before).length;
  const res = C.game.act(HS().move, { end: e, to: q });
  if (!res || !res.ok) { held = -1; syncG(); render(); kick(); return; }
  syncG();
  stats.moves++;
  held = -1; note = ''; tangled = false;
  const hk = FX.hint;
  FX.hint = null;
  const ms = res.movers;
  const start = fromPt || knotAt(e, before, performance.now()).p;
  const end = HG.peg[q];
  view = { state: before };
  for (const f of res.freed) shelfHold.add(f.s);
  // the new picture, with any strand about to come free still in place
  // (the very state object when nothing does, so its layout and cache carry on)
  let after = res.state;
  if (res.freed.length) {
    after = { ...res.state, ends: res.state.ends.slice(), out: res.state.out.slice() };
    for (const f of res.freed) { after.ends[2 * f.s] = f.a; after.ends[2 * f.s + 1] = f.b; after.out[f.s] = 0; }
  }
  run(async () => {
    FX.slide = { movers: ms, pt: start };
    kick();
    const dist = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const ctrl = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const pull = Math.min(0.35, dist / (HG.Rk * 4));
    ctrl[0] += (HG.cx - ctrl[0]) * pull; ctrl[1] += (HG.cy - ctrl[1]) * pull;
    const dur = reduced() ? 0 : Math.max(220, Math.min(460, 200 + dist * 0.9));
    await tween(dur, (t) => {
      const u = ease(t), v1 = 1 - u;
      FX.slide.pt = [v1 * v1 * start[0] + 2 * v1 * u * ctrl[0] + u * u * end[0], v1 * v1 * start[1] + 2 * v1 * u * ctrl[1] + u * u * end[1]];
    });
    // tie, and the yarn settles into its new lie: every old crossing keeps
    // its over and under, the new ones land with the carried end on top
    const P0 = pxOf(before), P1 = pxOf(after);
    const from = {}, to = {};
    for (const i of Object.keys(P1.strands)) {
      const a = P0.strands[i] ? (ms.some((m) => (m >> 1) === +i) ? carried(P0, before, +i, ms, end) : P0.strands[i]) : null;
      to[i] = resample(P1.strands[i], MORPH_N);
      from[i] = a ? resample(a, MORPH_N) : to[i];
    }
    const mo = { from, to, xb: fractions(P1), t: 0 };
    setupMorph(mo, P1);
    view = { state: after, morph: mo };
    FX.slide = null;
    FX.tug = { e, t0: performance.now() };
    sfx('tie');
    kick();
    await tween(reduced() ? 0 : 300, (t) => { mo.t = t; });
    view = { state: after };
    MORPH.live = null;
    FX.tug = null;
    if (res.freed.length) {
      view = { state: res.state };
      await comeFree(res.freed.map((f) => ({ ...f, pts: pxOf(after).strands[f.s] })));
    }
    view = null;
    note = afterNote(res, hk, hooked0);
  });
}

// ---------- lift it off: a strand on top of everything, picked off by its middle ----------
function doLiftOff(i) {
  const before = G.state;
  const res = C.game.act(HS().move, { end: 2 * i, to: -1 });
  if (!res || !res.ok) { syncG(); render(); kick(); return; }
  syncG();
  stats.moves++; stats.liftoffs++;
  held = -1; note = ''; tangled = false;
  const hk = FX.hint;
  FX.hint = null;
  for (const f of res.freed) shelfHold.add(f.s);
  run(async () => {
    // it rises, glowing, and winds away (a lifted strand first, then any
    // strand that crosses nothing now); the yarn it lay on settles back
    const Pa = pxOf(before), Pb = pxOf(res.state);
    const from = {}, to = {};
    for (const k of Object.keys(Pb.strands)) { to[k] = resample(Pb.strands[k], MORPH_N); from[k] = Pa.strands[k] ? resample(Pa.strands[k], MORPH_N) : to[k]; }
    let mo = null;
    if (Object.keys(to).length) { mo = { from, to, xb: fractions(Pb), t: 0 }; setupMorph(mo, Pb); }
    view = mo ? { state: res.state, morph: mo } : { state: res.state };
    sfx('lift');
    await Promise.all([
      comeFree(res.freed.map((f) => ({ ...f, round: f.lifted ? 0 : 1, pts: Pa.strands[f.s] }))),
      wait(reduced() ? 0 : 240).then(() => (view && view.morph ? tween(reduced() ? 0 : 420, (t) => { view.morph.t = t; }) : null)).then(() => { view = { state: res.state }; MORPH.live = null; }),
    ]);
    view = null;
    note = afterNote(res, hk, hookedPairs(L, before).length);
  });
}

function afterNote(res, hk, hooked0) {
  const s = G.state;
  if (isDone(s)) return 'Every strand is free. Lovely work.';
  const left = remaining(s), x = totalCrossings(L, s);
  const togo = `${x} ${x === 1 ? 'crossing' : 'crossings'} left, ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
  if (res.liftoff) {
    const lifted = res.freed.filter((f) => f.lifted), rest = res.freed.filter((f) => !f.lifted);
    const what = lifted.length === 1 ? `the ${cshort(L.color[lifted[0].s])} strand` : 'both strands of the shared knot';
    return `You lifted ${what} right off.${rest.length ? ` ${rest.length === 1 ? `The ${cshort(L.color[rest[0].s])} strand` : `${rest.length} more strands`}, crossing nothing now, came free too.` : ''} ${togo}`;
  }
  if (res.freed.length === 1) return `The ${cshort(L.color[res.freed[0].s])} strand ${res.pulled ? 'pulled straight and ' : ''}came free. ${togo}`;
  if (res.freed.length > 1) return `${res.freed.length === 2 ? 'Two' : res.freed.length === 3 ? 'Three' : res.freed.length} strands came free at once! ${togo}`;
  if (res.pulled) return `The yarn pulled taut. ${togo}`;
  const hooked = hookedPairs(L, s).length;
  if (hooked > hooked0) return `Hooked: the end went over a knot and now loops round its strand. Carry it back to let go. ${togo}`;
  void hk;
  return togo;
}

async function comeFree(freed) {
  const now = performance.now();
  const dur = reduced() ? 260 : 700;
  const shelfSlots = $$('#hp-shelf .hp-slot');
  FX.leaving = freed.map((f, k) => ({ ...f, t0: now + (f.round || 0) * (reduced() ? 0 : 260) + k * 60, dur }));
  sfx('free', freed.length);
  kick();
  try { if (C.haptics) C.haptics.light(); } catch { /* fine */ }
  await wait(dur * 0.7 + Math.max(...freed.map((f) => (f.round || 0) * 260)) + (freed.length - 1) * 60);
  // a skein for each, off to the shelf
  const flights = freed.map((f, k) => {
    const g = yarnGeom(f.pts, HG.w);
    const from = pageOf(g.mid);
    const slot = shelfSlots.find((el) => +el.dataset.s === f.s) || $('#hp-shelf');
    if (!slot) return Promise.resolve();
    const r = slot.getBoundingClientRect();
    const to = [r.left + r.width / 2, r.top + r.height / 2];
    const el = document.createElement('div');
    el.className = 'hp-flying';
    el.innerHTML = skeinSVG(L.color[f.s]);
    el.style.transform = `translate(${from[0] - 22}px, ${from[1] - 14}px)`;
    document.body.append(el);
    if (reduced()) return Promise.resolve();
    return anim(el, [
      { transform: `translate(${from[0] - 22}px, ${from[1] - 14}px) scale(.3) rotate(-160deg)`, opacity: 0.4 },
      { transform: `translate(${from[0] - 22}px, ${from[1] - 14}px) scale(1.15) rotate(-12deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${(from[0] + to[0]) / 2 - 22}px, ${Math.min(from[1], to[1]) - 50}px) scale(.95) rotate(-6deg)`, offset: 0.7 },
      { transform: `translate(${to[0] - 22}px, ${to[1] - 14}px) scale(.68)` },
    ], { duration: 620, delay: k * 90, easing: 'cubic-bezier(.4,0,.5,1)', fill: 'forwards' });
  });
  await wait(dur * 0.3);
  FX.leaving = [];
  await Promise.all(flights);
  for (const el of document.querySelectorAll('.hp-flying')) el.remove();
  shelfHold.clear();
  renderShelf();
  const got = $$('#hp-shelf svg').filter((sv) => freed.some((f) => +sv.dataset.s === f.s));
  for (const sv of got) anim(sv, [{ transform: 'translateY(-6px) scale(1.12)' }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
}

// ---------- undo, hint, start over ----------
let undoAfter = false;
function doUndo() {
  if (busy) { undoAfter = true; skipAll(); return; }
  if (!G || !G.past.length) return;
  const was = G.state;
  C.game.act(HS().undo);
  syncG();
  stats.undos++;
  held = -1; drag = null; tangled = false; FX.hint = null;
  const now = performance.now();
  for (let i = 0; i < L.S; i++) {
    if (was.out[i] && !G.state.out[i]) FX.alpha[i] = reduced() ? 1 : 0;
    if (was.ends[2 * i] !== G.state.ends[2 * i] || was.ends[2 * i + 1] !== G.state.ends[2 * i + 1] || was.w[i].length !== G.state.w[i].length) FX.glowUntil[i] = now + 350;
  }
  note = 'Undone.';
  render(); kick();
}
// Hint: the next move of a way out she can follow to the end. The stored
// solution when she is on it; else a way found from here and kept, so the
// next hints follow it (each hint is instant and they never contradict each
// other); else, when a quick search finds none, how many moves to undo to get
// back to a position whose way is known (her start always is), Undo lit.
const HINTMEM = { L: null, keys: null, path: null, solved: null };
function knownWays() {
  if (HINTMEM.L !== L) {
    HINTMEM.L = L; HINTMEM.path = null; HINTMEM.keys = null;
    // the positions along the stored solution
    const keys = new Set();
    let t = newState(L);
    keys.add(stateKey(L, t));
    for (const [e, q] of parseMoves(L.solution)) { const r = move(L, t, e, q); if (!r.ok) break; t = r.state; keys.add(stateKey(L, t)); }
    HINTMEM.solved = keys;
  }
  return HINTMEM;
}
function nextFromMemory(s) {
  const mem = knownWays();
  const known = solutionStep(L, s);
  if (known) return known;
  if (mem.path) {
    const k = mem.keys.indexOf(stateKey(L, s));
    if (k >= 0 && k < mem.path.length) { const m = solutionStep(L, s, formatMoves(mem.path.slice(k))); if (m) return m; }
  }
  return null;
}
function doHint() {
  if (busy) { skipAll(); return; }
  if (!G) return;
  stats.hints++;
  held = -1;
  const show = (m) => {
    FX.hint = { end: m[0], to: m[1], t0: performance.now() };
    tangled = false;
    const c = L.color[m[0] >> 1];
    note = m[1] < 0 ? `Try lifting the glowing ${cshort(c)} strand right off: tap its middle.` : `Try the glowing ${cshort(c)} knot on the peg ringed in gold.`;
  };
  try {
    const s = G.state;
    let m = nextFromMemory(s);
    if (!m) {
      const w = wayFrom(L, s, { cap: 300 });
      if (w.path && w.path.length) {
        const mem = knownWays();
        mem.path = w.path; mem.keys = [];
        let t = s;
        for (const [e, q] of w.path) { mem.keys.push(stateKey(L, t)); t = move(L, t, e, q).state; }
        m = w.path[0];
      } else if (w.tangled) {
        FX.hint = null; tangled = true;
        note = 'This hoop has gotten into a knot: no way out from here. Undo a few steps, or start over.';
      }
    }
    if (m) show(m);
    else if (!tangled) {
      // back to where a way is known: the newest earlier position on the stored solution, or on the way found before
      const mem = knownWays();
      const seen = new Set([...mem.solved, ...(mem.keys || [])]);
      let back = 0;
      for (let k = G.past.length - 1; k >= 0; k--) if (seen.has(stateKey(L, G.past[k]))) { back = G.past.length - k; break; }
      FX.hint = null; tangled = true;
      note = back > 0
        ? `This one has wandered off the ways I know. Undo ${back} ${back === 1 ? 'move' : 'moves'} and I’ll show you from there.`
        : 'Look for a knot you could carry so its strand crosses fewer others.';
    }
  } catch (e) {
    console.error(e);
    note = 'Look for a knot you could carry so its strand crosses fewer others.';
  }
  render(); kick();
}
let restartArmed = 0;
function doRestart() {
  if (busy || !G) return;
  const b = $('#hp-restartBtn');
  if (!restartArmed && G.state.moves > 0 && !isDone(G.state)) {
    restartArmed = setTimeout(() => { restartArmed = 0; const bb = $('#hp-restartBtn'); if (bb) bb.textContent = 'Start over'; }, 3000);
    if (b) b.textContent = 'Tap again';
    return;
  }
  clearTimeout(restartArmed); restartArmed = 0;
  if (b) b.textContent = 'Start over';
  startLevel(L.id, { fresh: true });
  note = 'A fresh start.';
  render();
}

let finishing = false;
async function afterMove() {
  if (!G || !visible || !isDone(G.state) || finishing) return;
  finishing = true;
  const myGen = gen;
  try {
    sfx('chord');
    if (!reduced()) {
      const pill = document.createElement('div');
      pill.className = 'hp-cheer hp-flying';
      pill.style.position = 'absolute';
      pill.textContent = 'All free!';
      $('#hp-hoopwrap').append(pill);
      await anim(pill, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -62%)' }], { duration: 1200, easing: 'ease-out' });
      pill.remove();
    }
  } finally {
    finishing = false;
    if (myGen === gen && visible) openFinish();
  }
}

// ---------- sound (soft, optional; through ctx.audio, so it also follows the game's sound setting) ----------
function sfx(kind, k = 1) {
  if (!set().sound || skip || !C || !C.audio) return;
  try {
    if (kind === 'lift') C.audio.tink(392 * 1.25, 0, 0.1);
    else if (kind === 'tie') { C.audio.tink(523, 0, 0.1); C.audio.tink(392, 0.05, 0.08); }
    else if (kind === 'free') C.audio.chain(Math.min(4, Math.max(0, k)));
    else if (kind === 'soft') C.audio.tick('select');
    else if (kind === 'chord') C.audio.chord([0.55, 0.68, 0.8]);
  } catch { /* sound is a nicety */ }
}

// ---------- render (DOM) ----------
function render() {
  if (!L || !G || !$('#hp-shelf')) return;
  const s = G.state;
  const idx = LEVELS.indexOf(L);
  $('#hp-lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#hp-lvName').textContent = L.name;
  renderShelf();
  $('#hp-moveCount').innerHTML = `Moves <b>${s.moves}</b>`;
  $('#hp-undoBtn').disabled = !G.past.length;
  $('#hp-undoBtn').classList.toggle('hp-lit', tangled);
  $('#hp-hintBtn').disabled = isDone(s);
  $('#hp-msg').textContent = message(s);
  const hk = hookedPairs(L, s).length;
  $('#hp-hoop').setAttribute('aria-label', `An embroidery hoop with ${L.n} pegs and ${remaining(s)} strands of yarn still tied across it, ${totalCrossings(L, s)} crossings${hk ? `, ${hk} ${hk === 1 ? 'pair' : 'pairs'} hooked together` : ''}.`);
  renderSr();
}
function renderToggles() {
  const hb = $('#hp-hookBtn');
  if (!hb) return;
  const hooks = hooksOn(), g = glyphsOn(), snd = !!set().sound;
  hb.setAttribute('aria-pressed', String(hooks));
  hb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="15" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Hooked marks: ${hooks ? 'on' : 'off'}`;
  const gb = $('#hp-glyphBtn');
  gb.setAttribute('aria-pressed', String(g));
  gb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS.heart.f}" fill="currentColor"/></svg>Color symbols: ${g ? 'on' : 'off'}`;
  const sb = $('#hp-soundBtn');
  sb.setAttribute('aria-pressed', String(snd));
  sb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${snd ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>Soft sounds: ${snd ? 'on' : 'off'}`;
}
// One place per strand on the shelf: dashed until its skein lands there.
function renderShelf() {
  const s = G.state;
  const on = (i) => s.out[i] && !shelfHold.has(i);
  $('#hp-shelf').innerHTML = [...Array(L.S).keys()].map((i) => (on(i) ? skeinSVG(L.color[i]).replace('<svg ', `<svg data-s="${i}" `) : `<span class="hp-slot" data-s="${i}"></span>`)).join('');
  const n = s.out.filter(Boolean).length;
  $('#hp-shelfCount').textContent = `${n} of ${L.S} strands free`;
}
function message(s) {
  if (busy && !note) return 'Retying…';
  if (note) return note;
  if (isDone(s)) return 'Every strand is free. Lovely work.';
  if (!s.moves) {
    if (LEVELS.indexOf(L) === 0) return 'Tap a knot to lift it, then tap a glowing peg to retie it. A strand that crosses nothing comes free.';
    return `Lift a knot and retie it on an empty peg. Drag works too. Par is ${L.par}.`;
  }
  const x = totalCrossings(L, s), left = remaining(s);
  return `${x} ${x === 1 ? 'crossing' : 'crossings'} left, ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
}
// Keyboards and screen readers: the knots as buttons, then the pegs for the lifted one.
function renderSr() {
  const s = G.state;
  const items = [];
  if (held >= 0) {
    for (const q of targets(L, s, held)) items.push(`<button type="button" data-peg="${q}">Tie it on peg ${q + 1}</button>`);
    items.push(`<button type="button" data-peg="${s.ends[held]}">Put it back</button>`);
  } else if (!isDone(s)) {
    for (let e = 0; e < 2 * L.S; e++) {
      if (s.out[e >> 1] || (L.link[e] >= 0 && L.link[e] < e)) continue;
      const lk = L.link[e];
      const what = lk >= 0 ? `shared ${cshort(L.color[e >> 1])} and ${cshort(L.color[lk >> 1])} knot` : `${cshort(L.color[e >> 1])} knot`;
      const why = canLift(L, s, e);
      items.push(`<button type="button" data-peg="${s.ends[e]}">Lift the ${esc(what)} on peg ${s.ends[e] + 1}${why ? (why.reason === 'fixed' ? ' (stitched down)' : ' (under another strand)') : ''}</button>`);
    }
    if (L.liftoff) for (let i = 0; i < L.S; i++) if (!s.out[i] && !canLiftOff(L, s, i) && L.units[L.unitOf[i]][0] === i) items.push(`<button type="button" data-strand="${i}">Lift the ${esc(cshort(L.color[i]))} strand right off</button>`);
  }
  $('#hp-srList').innerHTML = items.join('');
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  skipAll();
  closeAllSheets(['hp-levelSheet']);
  const t = S().hoop;
  let r;
  if (fresh || id !== t.cur || !t.game) r = C.game.act(HS().startHoop, { levelId: id, fresh });
  else r = C.game.act(HS().openHoop);
  if (r && !r.ok && r.reason === 'closed') C.game.act(HS().openHoop);
  syncG();
  if (!G) { C.game.act(HS().startHoop, { levelId: S().hoop.cur, fresh: true }); syncG(); }
  L = levelById(S().hoop.cur) || LEVELS[0];
  skip = false;
  held = -1; drag = null; view = null; note = ''; tangled = false;
  MORPH.live = null;
  if (!fresh && G && G.past.length && !isDone(G.state)) note = 'Back where you left it.';
  resetFx();
  render();
  sizeHoop();
  maybeIntro();
}

// ---------- sheets ----------
function openSheet(sel) {
  const el = $(sel);
  if (!el) return;
  el.hidden = false;
  const p = el.querySelector('.hp-panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('.btn-primary') || el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { if (el) el.hidden = true; }
function closeAllSheets(except = []) { for (const sh of $$('.hp-sheet')) if (!except.includes(sh.id)) sh.hidden = true; }

// A little picture of a hoop: the ring and the strands as they lie, over and
// under at each crossing. Laid out quickly (few sweeps: a thumbnail needs no
// more) and kept per level, colors and size.
const THUMBS = new Map();
function thumb(Lv, size, hexes, st = null) {
  const key = `${Lv.id}|${size}|${st ? stateKeyOf(st) : 0}|${Object.values(hexes).join('')}`;
  const have = THUMBS.get(key);
  if (have) return have;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * 2;
  const c = cv.getContext('2d');
  c.scale(2, 2);
  const cx = size / 2, cy = size / 2, R = size / 2 - 3;
  c.fillStyle = LINEN; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  c.strokeStyle = '#C9A06A'; c.lineWidth = Math.max(2.5, size * 0.06); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  c.lineCap = 'round'; c.lineJoin = 'round';
  let lay;
  try { lay = layout(Lv, st || newState(Lv), { iters: 400, tol: 1e-5 }); } catch { return cv; }
  const T = (p) => [cx + p[0] * (R - 1), cy + p[1] * (R - 1)];
  const curves = {};
  for (const [i, pts] of Object.entries(lay.strands)) curves[i] = pts.map(T);
  const stroke = (i) => {
    const pts = curves[i];
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]);
    c.strokeStyle = 'rgba(240,231,212,.95)'; c.lineWidth = Math.max(2.4, size * 0.055); c.stroke();
    c.strokeStyle = hexes[Lv.color[i]]; c.lineWidth = Math.max(1.6, size * 0.035); c.stroke();
  };
  for (const i of baseOrder(Object.keys(curves).map(Number), lay.crossings)) stroke(+i);
  for (const X of lay.crossings) {
    const p = T(X.p);
    c.save(); c.beginPath(); c.arc(p[0], p[1], Math.max(3, size * 0.07), 0, TAU); c.clip(); stroke(X.top); c.restore();
  }
  if (THUMBS.size > 240) THUMBS.clear();
  THUMBS.set(key, cv);
  return cv;
}
/** key -> hex for her yarns (the hoop on the frame's, else the next hoop's). */
function yarnHexes() {
  let y = {};
  try { y = HS().yarns(S()); } catch { /* catalog fallbacks */ }
  return hexesFor(y);
}
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/></svg>';

let thumbJob = 0;
function openLevels() {
  const box = $('#hp-lvList');
  box.innerHTML = '';
  const t = S().hoop;
  const done = (t && t.done) || {};
  const maxOpen = HS().maxOpen(S());
  const nextId = HS().continueId(S());
  const firstOf = firstIntro();
  const hexes = yarnHexes();
  const cont = levelById(nextId);
  const ci = LEVELS.indexOf(cont);
  const cb = $('#hp-continueBtn');
  cb.textContent = `Continue: ${ci + 1} · ${cont.name}`;
  cb.dataset.level = nextId;
  const hl = $('#hp-lvHint');
  hl.textContent = listHint || 'Hoops open one after another. A tick means every strand came free; a star, at or under par.';
  listHint = '';
  const want = []; // [el, Lv] thumbnails still to draw
  CHAPTERS.forEach((ch, bi) => {
    const to = Math.min(LEVELS.length, bi + 1 < CHAPTERS.length ? CHAPTERS[bi + 1].from : LEVELS.length);
    if (ch.from >= LEVELS.length) return;
    const h3 = document.createElement('h3');
    h3.className = 'hp-band';
    let cleared = 0;
    for (let i = ch.from; i < to; i++) if (done[LEVELS[i].id]) cleared++;
    h3.innerHTML = `${esc(`${bi + 1} · ${ch.name}`)}<span>${cleared === to - ch.from ? 'all clear ✓' : cleared ? `${cleared} cleared` : esc(ch.theme)}</span>`;
    const ul = document.createElement('ul');
    ul.className = 'hp-lvls';
    for (let i = ch.from; i < to; i++) {
      const Lv = LEVELS[i];
      const open = i <= maxOpen || !!done[Lv.id];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-tap', '');
      b.dataset.level = Lv.id;
      b.setAttribute('aria-current', String(Lv === L));
      if (Lv.id === nextId) b.classList.add('hp-next');
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      const star = HS().starred(S(), Lv.id);
      if (!open) {
        b.classList.add('hp-locked');
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-label', `${i + 1}. ${Lv.name}, opens after hoop ${i}`);
        const lk = document.createElement('span');
        lk.className = 'hp-lockthumb';
        lk.innerHTML = LOCK_SVG;
        b.append(lk);
      } else {
        b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${done[Lv.id] ? ', cleared' : ''}${star ? ', with a star' : ''}${Lv.id === nextId ? ', next' : ''}${fresh.length ? `, new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : ''}`);
        const th = document.createElement('canvas');
        th.className = 'hp-th';
        th.width = th.height = 96;
        b.append(th);
        want.push([th, Lv]);
        if (done[Lv.id]) { const tk = document.createElement('span'); tk.className = 'hp-tick'; tk.textContent = '✓'; tk.setAttribute('aria-hidden', 'true'); b.append(tk); }
        if (star) { const sp = document.createElement('span'); sp.className = 'hp-lvstar'; sp.innerHTML = STAR(true); b.append(sp); }
      }
      const tt = document.createElement('span');
      tt.className = 'hp-t';
      const chip = open && Lv.id === nextId && Lv !== L ? 'next' : open && fresh.length ? `new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : '';
      tt.innerHTML = `<b>${i + 1} · ${Lv.stats.strands} strands</b>${esc(Lv.name)}${chip ? `<br><span class="hp-chip">${esc(chip)}</span>` : ''}`;
      b.append(tt);
      li.append(b);
      ul.append(li);
    }
    box.append(h3, ul);
  });
  const hookBtn = $('#hp-restartBtn2');
  if (hookBtn) hookBtn.textContent = 'Start this hoop over';
  renderToggles();
  openSheet('#hp-levelSheet');
  ($('#hp-levelSheet [aria-current="true"]') || $('#hp-levelSheet .hp-next'))?.scrollIntoView({ block: 'center' });
  // thumbnails a few per frame, nearest the current one first, so the list opens at once
  const me = ++thumbJob;
  const cur = Math.max(0, LEVELS.indexOf(L));
  want.sort((a, b) => Math.abs(LEVELS.indexOf(a[1]) - cur) - Math.abs(LEVELS.indexOf(b[1]) - cur));
  const step = () => {
    if (me !== thumbJob || $('#hp-levelSheet').hidden) return;
    const t0 = performance.now();
    while (want.length && performance.now() - t0 < 8) {
      const [el, Lv] = want.shift();
      const src = thumb(Lv, 48, hexes);
      el.getContext('2d').drawImage(src, 0, 0, 96, 96);
    }
    if (want.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function coinsText(n) {
  const v = Number.isFinite(n) ? n : 0;
  const x = v < 100 ? Math.max(v > 0 ? 1 : 0, Math.round(v)) : v;
  return C.format && C.format.num ? C.format.num(x) : String(Math.round(x));
}
/** The finish sheet's reward line: what this hoop paid (state.hoop.last). */
function rewardHtml() {
  const last = S().hoop && S().hoop.last;
  if (!last || last.levelId !== L.id) return '';
  const n = coinsText(last.coins || 0);
  return `<span class="hp-coins" data-hp-coins><i aria-hidden="true"></i>+${esc(n)} ${n === '1' ? 'coin' : 'coins'}</span>${last.bonus > 0 ? '<span class="hp-again">with a star bonus</span>' : last.repeat ? '<span class="hp-again">cleared again</span>' : ''}`;
}

function openFinish() {
  if (!G || !isDone(G.state) || !$('#hp-finishSheet') || !$('#hp-finishSheet').hidden) return;
  const s = G.state;
  const y = yarnLine(L.S);
  $('#hp-finTitle').textContent = `${L.name}: all free`;
  $('#hp-finSub').textContent = `${L.S} strands slipped off the hoop and wound into skeins.`;
  const counts = {};
  for (const c of L.color) counts[c] = (counts[c] || 0) + 1;
  const piles = Object.keys(counts).map((c) => `<div class="hp-pile"><div class="hp-sk">${skeinSVG(c).repeat(Math.min(4, counts[c]))}</div><span class="hp-tag">${esc(cname(c))}${counts[c] > 1 ? ` ×${counts[c]}` : ''}</span></div>`);
  let rows = '';
  for (let i = 0; i < piles.length; i += 3) rows += `<div class="hp-row">${piles.slice(i, i + 3).join('')}</div>`;
  $('#hp-finShelf').innerHTML = rows;
  const fh = $('#hp-finHoop');
  const tc = thumb(L, 104, { ...HEX });
  fh.width = tc.width; fh.height = tc.height;
  fh.getContext('2d').drawImage(tc, 0, 0);
  const star = s.moves <= L.par;
  const proven = !!(L.stats && L.stats.optimal);
  let parLine;
  if (star && s.moves < L.par) parLine = `Untangled in ${s.moves} moves, tidier than the best way we had found (${L.par}). Lovely.`;
  else if (star) parLine = `Untangled in ${s.moves} moves, ${proven ? 'the tidiest it can be done' : 'as tidy as anyone has found'}.`;
  else parLine = `Untangled in ${s.moves} moves${L.liftoff ? ' (each lift-off counts as one)' : ''}. ${proven ? 'Par' : 'The tidiest way found so far'} is ${L.par}; the star is there if you’d like another go.`;
  $('#hp-finPar').innerHTML = `${STAR(star)}<span>${esc(parLine)}</span>`;
  $('#hp-finKnits').textContent = y.line;
  const rw = rewardHtml();
  const rEl = $('#hp-finReward');
  rEl.innerHTML = rw;
  rEl.hidden = !rw;
  const next = levelById(HS().nextLevelId(S(), L.id)) || LEVELS[0];
  $('#hp-finNext').textContent = `Next: ${next.name}`;
  $('#hp-finNext').dataset.level = next.id;
  openSheet('#hp-finishSheet');
  if (!reduced()) $$('#hp-finShelf .hp-sk svg').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 60, fill: 'backwards', easing: 'ease-out' }));
  if (rw && C.audio && set().sound) { try { C.audio.coins(4); } catch { /* fine */ } }
}

// Intro cards: one line for each new thing, the first time it appears.
const hoopIcon = (inner) => `<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23" fill="#EFE6D2"/><circle cx="28" cy="28" r="23" fill="none" stroke="#C9A06A" stroke-width="5"/>${inner}</svg>`;
const yarnLineSvg = (d, col, w = 4.5) => `<path d="${d}" fill="none" stroke="${mixHex(col, '#24160A', 0.36)}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w * 0.72}" stroke-linecap="round"/>`;
const ICON = {
  clasp: hoopIcon(`${yarnLineSvg('M10 18C20 22 32 22 36 30S30 40 22 34', '#34588E')}${yarnLineSvg('M46 38C36 34 24 34 20 26S26 16 34 22', '#B9473A')}<path d="M27.5 33.6C29.5 35 31.5 35.8 33 35.8" fill="none" stroke="${mixHex('#34588E', '#24160A', 0.36)}" stroke-width="4.5" stroke-linecap="round"/><path d="M27.5 33.6C29.5 35 31.5 35.8 33 35.8" fill="none" stroke="#34588E" stroke-width="3.2" stroke-linecap="round"/>`),
  liftoff: hoopIcon(`<path d="M10 40C20 34 36 34 46 40" fill="none" stroke="rgba(60,40,20,.25)" stroke-width="7" stroke-linecap="round" transform="translate(2 4)"/>${yarnLineSvg('M10 34C20 28 36 28 46 34', '#B9473A')}${yarnLineSvg('M20 46C24 36 30 24 36 12', '#34588E', 3.6)}<path d="M28 22v-12M23 15l5-5 5 5" fill="none" stroke="#8C6512" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  fixed: hoopIcon(`${yarnLineSvg('M8 22C20 28 34 36 44 44', '#B9473A')}<circle cx="8" cy="22" r="4" fill="#B9473A"/><circle cx="8" cy="22" r="2.2" fill="#D7AE52"/>`),
  pegs: hoopIcon(`<circle cx="28" cy="5" r="4" fill="#34588E" stroke="#FFF8E6" stroke-width="1.2"/><circle cx="51" cy="28" r="4" fill="#B9473A" stroke="#FFF8E6" stroke-width="1.2"/>${yarnLineSvg('M28 6C30 22 40 30 50 28', '#34588E')}`),
  links: hoopIcon(`${yarnLineSvg('M10 16C24 26 30 34 42 46', '#B9473A')}${yarnLineSvg('M10 16C22 18 36 16 48 22', '#34588E')}<circle cx="10" cy="16" r="4.6" fill="#7A3A2C"/><path d="M6 16a4 4 0 0 1 8 0z" fill="#B9473A"/><path d="M6 16a4 4 0 0 0 8 0z" fill="#34588E"/>`),
  layering: hoopIcon(`${yarnLineSvg('M8 30C20 26 36 30 48 26', '#D6A92E')}<path d="M26 8C25 22 31 36 30 48" fill="none" stroke="rgba(60,40,20,.25)" stroke-width="7" stroke-linecap="round" transform="translate(1.5 2)"/>${yarnLineSvg('M26 8C25 22 31 36 30 48', '#5F8A3A')}`),
  spare: hoopIcon(`${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => { const a = -Math.PI / 2 + (2 * Math.PI * (k + 0.5)) / 10; const x = 28 + Math.cos(a) * 23, y = 28 + Math.sin(a) * 23; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${k === 2 || k === 7 ? '#F3E3B8' : '#94703F'}" ${k === 2 || k === 7 ? 'stroke="#C8901E" stroke-width="1.2"' : ''}/>`; }).join('')}`),
};
let introFresh = [];
function maybeIntro() {
  const seen = (S().hoop && S().hoop.seenIntro) || {};
  const fresh = L.mechanics.filter((m) => !seen[m] && MECHANICS[m]);
  if (!fresh.length) return;
  introFresh = fresh;
  $('#hp-introTitle').textContent = fresh.length > 1 ? 'Some new things on the hoop' : 'Something new on the hoop';
  $('#hp-introBody').innerHTML = fresh.map((m) => `<div class="hp-item">${ICON[m] || ''}<p><strong>${esc(MECHANICS[m].name)}</strong>${esc(MECHANICS[m].line)}</p></div>`).join('');
  openSheet('#hp-introSheet');
}

// How this works: three short steps.
const ILL = {
  lift: `<svg class="hp-ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="160" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    ${yarnLineSvg('M112 33C140 60 170 80 206 98', '#34588E', 8)}
    <circle cx="206" cy="98" r="6" fill="#34588E"/>
    <circle cx="112" cy="33" r="9" fill="#2A4470" opacity=".25" transform="translate(3 5)"/><circle cx="112" cy="33" r="8" fill="#34588E"/>
    <circle cx="218" cy="50" r="10" fill="rgba(242,190,70,.35)" stroke="#C8901E" stroke-width="2"/>
    <path d="M122 30C160 10 196 22 210 40" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
    <path d="M204 34l8 8-10 3" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  free: `<svg class="hp-ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="120" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    <path d="M72 40C100 60 130 70 170 72" fill="none" stroke="rgba(242,190,70,.6)" stroke-width="16" stroke-linecap="round"/>
    ${yarnLineSvg('M72 40C100 60 130 70 170 72', '#B9473A', 8)}
    ${yarnLineSvg('M96 112C104 92 112 78 130 10', '#5F8A3A', 8)}
    <g transform="translate(232,46) scale(1.2)">${skeinSVG('m', '#B9473A').replace('<svg viewBox="0 0 66 40" aria-hidden="true">', '').replace('</svg>', '')}</g>
    <path d="M176 66C196 56 210 54 226 60" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
  </svg>`,
  room: `<svg class="hp-ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="160" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => { const a = -Math.PI / 2 + (2 * Math.PI * (k + 0.5)) / 12; const x = 160 + Math.cos(a) * 58, y = 65 + Math.sin(a) * 58; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${k === 1 || k === 2 ? '#F3E3B8' : '#A9804C'}" ${k === 1 || k === 2 ? 'stroke="#C8901E" stroke-width="1.5"' : ''}/>`; }).join('')}
    ${yarnLineSvg(`M${(160 + Math.cos(-Math.PI / 2 + Math.PI / 12) * 58).toFixed(1)} ${(65 + Math.sin(-Math.PI / 2 + Math.PI / 12) * 58).toFixed(1)}C170 40 196 44 ${(160 + Math.cos(-Math.PI / 2 + (7 * Math.PI) / 12) * 58).toFixed(1)} ${(65 + Math.sin(-Math.PI / 2 + (7 * Math.PI) / 12) * 58).toFixed(1)}`, '#D6A92E', 7)}
  </svg>`,
};
const HOW = [
  { t: 'Lift a knot, retie it', ill: 'lift', p: 'Tap a knot on a peg to lift it, then tap one of the glowing empty pegs to tie it there. Or just drag the knot across. The end is carried over the knots it passes, and whatever lay over the strand still does.' },
  { t: 'Cross nothing, come free', ill: 'free', p: 'Strands cross where one lies over another, and two can cross more than once, even hook round each other (a small pair of rings marks a hook). Yarn lying on top of everything it crosses (or under everything) pulls taut after each move. A strand that crosses nothing at all slips off its pegs and winds onto a skein, and its two pegs are yours to use.' },
  { t: 'Any empty peg', ill: 'room', p: 'Tie a knot on any empty peg. The end you carry goes the way round that doesn’t pass its own other knot. The later hoops reward a little planning: the move that drops the most crossings now isn’t always the way out. Undo is free, Hint glows a good next move, and there are no timers and no way to lose.' },
];
function renderHow() {
  const st = HOW[howStep];
  $('#hp-howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#hp-howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'hp-on' : ''}"></i>`).join('');
  $('#hp-howBack').disabled = howStep === 0;
  $('#hp-howNext').textContent = howStep === HOW.length - 1 ? 'Start untangling' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#hp-howSheet'); }

// ---------- markup ----------
function lockedSkeleton() {
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">The Hoop</div><div class="subtitle">Yarn tied across a hoop, freed one strand at a time</div></div><div class="spacer"></div></div>
<div class="screen-body"><div class="hp-closed"><div class="card" style="padding:16px;gap:10px">
<div class="h3">The embroidery frame is waiting</div>
<p class="hint">Strands of yarn are tied across a wooden hoop, crossing and hooking each other. Carry a knot to another peg until each strand crosses nothing and slips free. Each hoop you clear pays coins.</p>
<div data-lock>${unlockTag(C, 'hoop', { cls: 'pz-tag' })}</div></div></div></div>`);
  built = false;
}

function skeleton() {
  const btn = (id, label, attrs = '', variant = 'btn-paper') => `<button type="button" class="btn ${variant} small" data-tap id="${id}"${attrs}>${label}</button>`;
  const how = C.guide && C.guide.howThisWorksHtml ? String(C.guide.howThisWorksHtml('hoop', 'Show me on the hoop')) : '';
  ROOT.innerHTML = `<div class="screen-head hp-head">${String(backButton('Back to the puzzle table'))}
<button type="button" class="btn btn-paper small hp-levelbtn" data-tap id="hp-levelsBtn" aria-haspopup="dialog"><span class="hp-no" id="hp-lvNo">1/${LEVELS.length}</span><span class="hp-nm" id="hp-lvName"></span><span class="hp-chev" aria-hidden="true">&#9662;</span></button>
<button type="button" class="btn btn-paper small hp-tog" data-tap id="hp-howBtn" aria-haspopup="dialog" aria-label="How this works">?</button>
</div>
<div class="screen-body hp-app" id="hp-app">
<div class="hp-shelfrow"><span id="hp-shelfCount" class="hp-sr"></span><div id="hp-shelf" aria-hidden="true"></div><span id="hp-moveCount">Moves <b>0</b></span></div>
<section class="hp-hoopwrap" id="hp-hoopwrap" aria-label="The hoop" data-coach="hoop-frame">
<canvas id="hp-hoop" role="img" aria-label="An embroidery hoop with yarn tied across it"></canvas>
<canvas id="hp-top" aria-hidden="true"></canvas>
<canvas id="hp-motion" aria-hidden="true"></canvas>
<div id="hp-pegfx" aria-hidden="true"></div>
</section>
<div class="hp-sr" id="hp-srList" aria-label="Knots you can move"></div>
<p id="hp-msg" role="status" aria-live="polite" data-coach="hoop-msg"></p>
<div class="hp-grow"></div>
<div class="hp-actions">
${btn('hp-undoBtn', 'Undo')}
${btn('hp-hintBtn', 'Hint')}
${btn('hp-restartBtn', 'Start over')}
</div>
</div>

<div class="hp-sheet" id="hp-levelSheet" role="dialog" aria-modal="true" aria-labelledby="hp-lvTitle" hidden>
<div class="hp-panel">
<button type="button" class="hp-iconbtn hp-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="hp-lvTitle">Hoops</h2>
<p class="hint" id="hp-lvHint" style="margin:0"></p>
${btn('hp-continueBtn', 'Continue', '', 'btn-primary').replace('class="btn btn-primary small"', 'class="btn btn-primary small hp-continue"')}
<div class="hp-settings">
${btn('hp-howBtn2', 'How this works')}
${btn('hp-glyphBtn', 'Color symbols: off', ' aria-pressed="false"')}
${btn('hp-hookBtn', 'Hooked marks: on', ' aria-pressed="true"')}
${btn('hp-soundBtn', 'Soft sounds: on', ' aria-pressed="true"')}
</div>
<div id="hp-lvList"></div>
</div></div>

<div class="hp-sheet" id="hp-howSheet" role="dialog" aria-modal="true" aria-labelledby="hp-howTitle" hidden>
<div class="hp-panel hp-how">
<button type="button" class="hp-iconbtn hp-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="hp-howTitle">How this works</h2>
<div id="hp-howBody"></div>
<div class="hp-steps" id="hp-howDots"></div>
<div class="hp-row2">${btn('hp-howBack', 'Back')}${btn('hp-howNext', 'Next', '', 'btn-primary')}</div>
${how}
</div></div>

<div class="hp-sheet" id="hp-introSheet" role="dialog" aria-modal="true" aria-labelledby="hp-introTitle" hidden>
<div class="hp-panel hp-intro">
<h2 id="hp-introTitle">Something new on the hoop</h2>
<div id="hp-introBody"></div>
<button type="button" class="btn btn-primary" data-tap id="hp-introOk" style="width:100%;margin-top:8px">Lovely, let’s untangle</button>
</div></div>

<div class="hp-sheet" id="hp-finishSheet" role="dialog" aria-modal="true" aria-labelledby="hp-finTitle" hidden>
<div class="hp-panel hp-finish">
<h2 id="hp-finTitle">All free</h2>
<p class="muted" id="hp-finSub" style="margin:0"></p>
<div class="hp-finrow">
<div><canvas id="hp-finHoop" aria-hidden="true"></canvas><div class="hp-cap">The hoop as you found it</div></div>
<div class="hp-bigshelf" id="hp-finShelf"></div>
</div>
<div class="hp-par" id="hp-finPar"></div>
<div class="hp-reward" id="hp-finReward" aria-live="polite" hidden></div>
<p class="hp-knits" id="hp-finKnits"></p>
${btn('hp-finNext', 'Next hoop', '', 'btn-primary')}
${btn('hp-finAgain', 'Untangle this one again')}
${btn('hp-finAll', 'All hoops')}
</div></div>`;
  bindHoop($('#hp-hoop'));
  built = true;
}

// ---------- wiring (one delegated listener) ----------
function onClick(e) {
  if (!ROOT || !e.target || !e.target.closest) return;
  const t = e.target;
  const unlockBtn = t.closest('[data-action="unlock-open"]');
  if (unlockBtn && ROOT.contains(unlockBtn)) { ensureWorkshopStyles(); openUnlockSheet(C, 'hoop', { host: ROOT }); return; }
  if (!built) return;
  const sh = t.closest('.hp-sheet');
  if (sh && (t === sh || t.closest('[data-close]'))) { if (sh.id !== 'hp-introSheet') closeSheet(sh); return; }
  if (t.closest('[data-guide-replay]')) { closeAllSheets(); return; }
  const srs = t.closest('#hp-srList [data-strand]');
  if (srs) { strandTap(+srs.dataset.strand); return; }
  const srp = t.closest('#hp-srList [data-peg]');
  if (srp) { tapPeg(+srp.dataset.peg); return; }
  const lv = t.closest('#hp-lvList [data-level]');
  if (lv) {
    if (lv.classList.contains('hp-locked')) {
      const i = LEVELS.findIndex((x) => x.id === lv.dataset.level);
      $('#hp-lvHint').textContent = `Hoop ${i + 1} opens once hoop ${i} is cleared.`;
      return;
    }
    closeSheet($('#hp-levelSheet'));
    if (lv.dataset.level !== L.id) startLevel(lv.dataset.level);
    return;
  }
  const id = (t.closest('button[id]') || {}).id || '';
  switch (id) {
    case 'hp-undoBtn': doUndo(); return;
    case 'hp-hintBtn': doHint(); return;
    case 'hp-restartBtn': doRestart(); return;
    case 'hp-levelsBtn': if (!busy) openLevels(); return;
    case 'hp-howBtn': if (!busy) openHow(); return;
    case 'hp-howBtn2': closeSheet($('#hp-levelSheet')); openHow(); return;
    case 'hp-continueBtn': { const nx = $('#hp-continueBtn').dataset.level; closeSheet($('#hp-levelSheet')); if (nx && nx !== L.id) startLevel(nx); return; }
    case 'hp-glyphBtn':
      C.game.act(HS().setSetting, { key: 'glyphs', value: !glyphsOn() });
      buildBg(); CACHE.sig = ''; CACHE.drawn = null; TOP.sig = ''; renderToggles(); render(); kick();
      return;
    case 'hp-hookBtn': C.game.act(HS().setSetting, { key: 'hooks', value: !hooksOn() }); TOP.sig = ''; renderToggles(); render(); kick(); return;
    case 'hp-soundBtn': C.game.act(HS().setSetting, { key: 'sound', value: !set().sound }); renderToggles(); sfx('tie'); return;
    case 'hp-howBack': if (howStep > 0) { howStep--; renderHow(); } return;
    case 'hp-howNext':
      if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
      closeSheet($('#hp-howSheet'));
      return;
    case 'hp-introOk': C.game.act(HS().seeIntro, { mechanics: introFresh }); closeSheet($('#hp-introSheet')); return;
    case 'hp-finNext': { const nx = $('#hp-finNext').dataset.level || L.id; closeSheet($('#hp-finishSheet')); startLevel(nx, { fresh: true }); return; }
    case 'hp-finAgain': closeSheet($('#hp-finishSheet')); startLevel(L.id, { fresh: true }); return;
    case 'hp-finAll': closeSheet($('#hp-finishSheet')); openLevels(); return;
    default: break;
  }
}

function onKey(e) {
  if (!visible || e.key !== 'Escape') return;
  let closed = false;
  for (const sh of $$('.hp-sheet')) if (!sh.hidden && sh.id !== 'hp-introSheet') { closeSheet(sh); closed = true; }
  if (!closed && held >= 0) { held = -1; note = ''; render(); kick(); }
}

let rz = 0;
function onResize() {
  if (!visible || !built) return;
  clearTimeout(rz);
  rz = setTimeout(() => { if (L && G && !busy && !drag && visible) { sizeHoop(); render(); } }, 120);
}
function onVisibility() { if (document.hidden && busy) skipAll(); }

// ---------- the guide ----------
function coachSteps() {
  const moved = (st) => !!(st && st.hoop && st.hoop.game && st.hoop.game.moves.length > 0);
  return [
    { anchor: '[data-coach="hoop-frame"]', text: 'Tap a knot, then a glowing empty peg to retie it there.', endsOn: 'action', done: moved },
    { anchor: '[data-coach="hoop-msg"]', text: 'A strand crossing nothing comes free. Undo and Hint are always free.', endsOn: 'got-it', side: 'above' },
  ];
}

// ---------- the Puzzles hub card ----------
const CARD = { key: '', svg: '' };
/** A small picture of the hoop on the frame as it lies now (cached by its position). */
function thumbSvg(state) {
  let cur = null;
  try { cur = C.sim.hoop.current(state); } catch { cur = null; }
  const sum = C.sim.hoop.summary(state);
  const Lv = cur ? cur.L : levelById(sum.levelId);
  if (!Lv) return '';
  const st = cur ? cur.s : newState(Lv);
  const hexes = hexesFor(cur ? cur.yarns : (() => { try { return C.sim.hoop.yarns(state); } catch { return {}; } })());
  const key = `${Lv.id}|${cur ? cur.moves.join(' ') : ''}|${Object.values(hexes).join('')}`;
  if (CARD.key === key) return CARD.svg;
  let lay;
  try { lay = layout(Lv, st, { iters: 400, tol: 1e-5 }); } catch { return ''; }
  const T = (p) => `${(30 + p[0] * 25).toFixed(1)} ${(30 + p[1] * 25).toFixed(1)}`;
  const pathOf = (pts) => `M${pts.map(T).join('L')}`;
  let body = '';
  const order = baseOrder(Object.keys(lay.strands).map(Number), lay.crossings);
  for (const i of order) {
    const d = pathOf(lay.strands[i]);
    body += `<path d="${d}" fill="none" stroke="rgba(240,231,212,.95)" stroke-width="3.2" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${hexes[Lv.color[i]]}" stroke-width="2" stroke-linecap="round"/>`;
  }
  const svg = `<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="${LINEN}"/>${body}<circle cx="30" cy="30" r="27" fill="none" stroke="#C9A06A" stroke-width="4"/></svg>`;
  CARD.key = key; CARD.svg = svg;
  return svg;
}

/** The Puzzles hub card (ui/puzzles.js): the hoop on the frame at a glance, or the price tag. */
export function hoopCardHtml(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.hoop) return '';
  if (!C) C = ctx;
  injectCss();
  const sum = ctx.sim.hoop.summary(state);
  if (!sum.open) {
    return h`<div class="card hp-card" id="pz-hoop" data-coach="hoop-card">
<div class="h3">The Hoop</div>
<div class="hint">Yarn tied across an embroidery hoop: carry knots to new pegs until every strand crosses nothing and slips free.</div>
<div class="pz-tiertag">${unlockTag(ctx, 'hoop', { cls: 'pz-tag' })}</div>
</div>`;
  }
  let line;
  if (sum.cleared) line = `${sum.name} is clear. The next hoop is ready when you are.`;
  else if (sum.playing) line = `Hoop ${sum.index + 1} of ${sum.total} · ${sum.name} · ${plural(sum.left, 'strand', 'strands')} to go`;
  else line = `Hoop ${sum.index + 1} of ${sum.total} · ${sum.name}. ${sum.chapter}: retie knots, no timers.`;
  const stats2 = sum.done ? `${plural(sum.done, 'hoop', 'hoops')} cleared` : '';
  return h`<div class="card hp-card" id="pz-hoop" data-coach="hoop-card">
<div class="row between"><div class="h3">The Hoop</div>${stats2 ? h`<span class="chip">${stats2}</span>` : ''}</div>
<div class="hp-cardrow"><span class="hp-thumb">${raw(thumbSvg(state))}</span><div class="hint grow">${line}</div></div>
${button(sum.playing ? 'Continue untangling' : 'Go to the hoop', { variant: 'primary', block: true, attrs: { 'data-action': 'open-hoop' } })}
</div>`;
}

/** What the hub card depends on (ui/puzzles.js redraws when it changes). */
export function hoopCardSig(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.hoop) return 0;
  const u = ctx.sim.unlocks.status(state, 'hoop');
  const t = state.hoop;
  const g = t && t.game;
  return [u && u.revealed, u && u.affordable, u && u.open, t && t.cur, g ? g.moves.length : -1, t ? Object.keys(t.done || {}).length : 0];
}

// ---------- screen ----------
/** debugHoop() -> reads and a few levers for tests (test/hoop.e2e.mjs); the prototype's window.__hoop. */
export function debugHoop() {
  return {
    get level() { return L ? L.id : null; }, get state() { return G ? G.state : null; }, get busy() { return busy; }, get held() { return held; }, get visible() { return visible; },
    get note() { return note; }, get hint() { return FX.hint && { ...FX.hint }; }, get stats() { return { ...stats }; }, get yarns() { return { ...YARN }; },
    get perf() { return { frames: PERF.frames, draw: PERF.draw.slice(), rebuilds: PERF.rebuilds, partial: PERF.partial, sec: { ...PERF.sec }, layout: { ...LAYSTAT } }; },
    resetPerf() { PERF.frames = 0; PERF.draw.length = 0; PERF.rebuilds = 0; PERF.partial = 0; for (const k of Object.keys(PERF.sec)) PERF.sec[k] = 0; LAYSTAT.n = 0; LAYSTAT.ms = 0; LAYSTAT.sweeps = 0; },
    // the page point of peg q (its knot)
    pegPoint(q) { return pageOf(HG.peg[q]); },
    // the base canvas's pixel at a point of the hoop (css px from its corner): what is really on screen there
    basePixel(x = HG.cx, y = HG.cy) {
      const c = document.createElement('canvas'); c.width = HG.cv.width; c.height = HG.cv.height;
      const g = c.getContext('2d'); g.drawImage(HG.cv, 0, 0);
      return [...g.getImageData(Math.round(x * HG.dpr), Math.round(y * HG.dpr), 1, 1).data];
    },
    get center() { return [HG.cx, HG.cy]; },
    get geom() { return { css: HG.css, Rk: HG.Rk, w: HG.w, pr: HG.pr }; },
    // the hooked marks drawn last frame (page points, with their two strands)
    get marks() { return LAST.marks.map((m) => ({ a: m.a, b: m.b, p: pageOf(m.p) })); },
    // the next move of the stored solution from here (or null when off it)
    nextMove() { return G ? solutionStep(L, G.state) : null; },
    // a page point on strand i's middle, well clear of knots and other yarn (or null)
    strandMid(i) {
      const P = pxOf(G.state), pts = P.strands[i];
      if (!pts) return null;
      let best = null, bd = -1;
      for (let k = Math.floor(pts.length * 0.2); k < pts.length * 0.8; k++) {
        let d = Infinity;
        for (const [j, o] of Object.entries(P.strands)) if (+j !== i) d = Math.min(d, distTo(o, pts[k]));
        G.state.ends.forEach((p, e) => { if (p >= 0) d = Math.min(d, Math.hypot(HG.peg[p][0] - pts[k][0], HG.peg[p][1] - pts[k][1]) - ((e >> 1) === i ? 30 : 20)); });
        if (d > bd) { bd = d; best = pts[k]; }
      }
      return best ? pageOf(best) : null;
    },
    // what was painted last frame: who lies on top at each drawn crossing (css px)
    drawnTops() {
      if (!LAST.curves || !LAST.crossings) return [];
      const full = { rest: LAST.restPlan ? LAST.restPlan.rest : [], restPatches: LAST.restPlan ? LAST.restPlan.restPatches : [], live: LAST.plan.live, livePatches: LAST.plan.livePatches };
      return LAST.crossings.map((X) => ({ a: X.a, b: X.b, top: X.top, p: X.p, drawn: topAt(LAST.curves, full, X.p, HG.w, [X.a, X.b]) }));
    },
    // time the painter: a full rebuild of the resting strands, and an ordinary frame (ms)
    bench(n = 20) {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) { CACHE.sig = ''; CACHE.drawn = null; TOP.sig = ''; restPlan.key = ''; draw(performance.now()); }
      const t1 = performance.now();
      for (let k = 0; k < n; k++) draw(performance.now());
      return { rebuild: (t1 - t0) / n, frame: (performance.now() - t1) / n };
    },
  };
}

function unlocked() {
  try { return !!HS().unlocked(S()); } catch { return false; }
}

export default {
  id: 'hoop',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectCss();
    root.addEventListener('click', onClick);
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) guideApi = C.guide('hoop', coachSteps(), { screen: 'hoop' });
    // Bought somewhere else (the workshop's Next): offer the way in (two equal choices; nothing navigates by itself).
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'hoop'); };
        if (!p || p.id !== 'hoop' || visible || here()) return;
        setTimeout(() => {
          if (visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Hoop is open',
            body: 'Yarn is tied across an embroidery hoop, ready to be untangled one strand at a time.',
            more: { label: 'Later' },
            next: { label: 'Go to the hoop', run: () => C.navigate('hoop') },
          });
        }, 300);
      });
    }
  },

  show(params = {}) {
    visible = true;
    gen += 1;
    busy = false; skip = false; finishing = false; undoAfter = false;
    if (!unlocked()) { lockedSkeleton(); return; }
    C.game.act(HS().ensureHoop);
    skeleton();
    const want = params && typeof params.levelId === 'string' ? params.levelId : S().hoop.cur;
    startLevel(want);
    if (G && isDone(G.state)) openFinish();
    if (guideApi) guideApi.start();
  },

  hide() {
    visible = false;
    gen += 1;
    busy = false; skip = false; finishing = false; undoAfter = false;
    for (const f of [...skipWaiters]) f();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    for (const el of document.querySelectorAll('.hp-flying')) el.remove();
    if (ROOT) closeAllSheets();
    clearTimeout(restartArmed); restartArmed = 0;
    held = -1; drag = null; down = null; view = null; MORPH.live = null;
    thumbJob++;
    if (CACHE.cv) { CACHE.cv.width = 0; CACHE.cv.height = 0; CACHE.cv = null; CACHE.ctx = null; CACHE.sig = ''; CACHE.drawn = null; }
    HG.ctx = null; BASE.sig = ''; BASE.off = null;
    if (guideApi) guideApi.stop();
  },

  render(state) {
    if (!ROOT || !visible) return;
    if (!built) { if (unlocked()) this.show(); return; }
    if (busy) return;
    // A game changed under the hoop (an imported save, a reset): pick it up again.
    if (state.hoop && sigOfGame() !== lastSig) startLevel(state.hoop.cur);
  },
};
