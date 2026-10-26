/**
 * tangle.js: The Tangle Basket (overlay `tangle`, fullscreen, home tab Puzzles).
 * Ported from proto/tangle/app.js and index.html, the playtested prototype: the
 * same rules and baskets (109 of them, in chapters), the woven yarn with its
 * per-crossing over and under, snarls, tucks, pins and pegs, the rack of
 * spools and the shelf of skeins, the slither onto a spool, the pinch-zoom of
 * the deep baskets, the hint, the unlimited undo and the one spare rack place,
 * the intro cards, the three-step "How this works" sheet and the finish sheet.
 *
 * What changed for the game: every pull is a sim action (src/sim/tangle.js,
 * run through ctx.game.act), so it is saved at once and a reload mid-basket
 * resumes exactly; the yarn is in her own discovered colors (sim.tangle.yarns,
 * fixed when a basket starts) and named by her names; baskets open one after
 * another, and the basket list shows chapters, ticks, the next basket and a
 * Continue button; a finished basket pays coins (the finish sheet says how
 * many); settings (sound, color symbols) live in state.tangle.settings; sounds
 * come from ctx.audio, gated by the basket's own toggle and the game's; motion
 * honors ctx.fx.isReducedMotion(); the first visit teaches itself with a
 * guide() whose first step is the action, and the "?" sheet keeps the
 * prototype's three illustrated steps. Every class and id is prefixed `tb-`
 * and every rule is scoped to #screen-tangle.
 *
 * PAINTING (as the prototype). Every strand is pre-painted once into its own
 * bitmap (yarn, ply, a halo of fiber hairs, glyphs; a soft shadow at half
 * resolution; a gray "buried" look when it has one). The heap is painted bottom
 * to top from those bitmaps; where yarn weaves the other way (a snarl's turned
 * crossing) or a strand crosses itself, a small precomputed patch goes on top.
 * Strands that can't move are kept in a cached bitmap; strands that can move
 * are drawn live on top, and each frame repaints only the rectangles that
 * changed. While a finger pinches or drags nothing is repainted: the canvas
 * moves with a CSS transform over a half-resolution backdrop of the whole
 * basket; when the fingers lift, the heap is painted at the new view and strand
 * bitmaps near the window are re-rasterized a few per frame within a memory
 * budget. A pulled strand slithers along its own path on an overlay canvas,
 * then winds onto its spool in the rack (DOM).
 *
 * Never locked: every animated action goes through run() (busy is reset in
 * finally), tweens and WAAPI have timer fallbacks, and a tap while busy
 * fast-forwards (a tap on the heap is queued and replayed).
 */

import { h, raw, button, backButton, escapeHtml } from './kit.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import { restBits, restingResult, openRestSheet, isResting, restingNote } from './rest.js';
import {
  W, SPOOL, COLORS, HIDDEN_HEX, whyNot, canPull, isUncovered, isPinned, isPegged, showsColor, isDone, isStuck, canNudge,
  hint, groupOf, colorsOf, knitsInto, remaining, pickStrand, nearDist,
} from '../puzzles/tangle.js';
import { LEVELS, MECHANICS, CHAPTERS, levelById, chapterOf, ctrlOf } from '../puzzles/tangle-levels.js';
import { fitView, clampView, toBoard, toScreen, zoomAt, panBy, pinchView, reachUnits, isFit } from '../puzzles/tangle-view.js';

let C = null;
let ROOT = null;
const S = () => C.game.state;
const TS = () => C.sim.tangle;
const set = () => (S().tangle && S().tangle.settings) || { sound: true, glyphs: null };
const glyphsOn = () => { try { return !!TS().glyphsOn(S()); } catch { return false; } };
const $ = (s) => (ROOT ? ROOT.querySelector(s) : null);
const $$ = (s) => (ROOT ? [...ROOT.querySelectorAll(s)] : []);
const reduced = () => !!(C && C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 1);
const ease = (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
const esc = (s) => escapeHtml(String(s ?? ''));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const TAP_SLOP = 10; // css px a finger may drift and still be a tap

// ---------- color: her yarns for the eight dye keys ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;
const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toneOf = (hex) => ({
  base: hex, edge: mixHex(hex, '#24160A', 0.36), light: mixHex(hex, '#FFF6E4', 0.35), ink: lum(hex) > 0.28 ? 'rgba(42,30,20,.85)' : 'rgba(255,250,238,.95)',
  fuzz: mixHex(hex, '#FFF6E4', 0.3).replace('rgb(', 'rgba(').replace(')', ',.5)'),
  fuzzD: rgba(hex, 0.32),
});
let YARN = {};   // key -> her color id
let HEX = {};    // key -> hex
let TONE = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toneOf(c.hex)]));
const GRAY = toneOf(HIDDEN_HEX);
const hexOf = (c) => HEX[c] || (COLORS[c] && COLORS[c].hex) || '#999999';
function nameOfId(id) { try { return C.sim.displayName(S(), id); } catch { return id; } }
const cname = (c) => (YARN[c] ? nameOfId(YARN[c]) : COLORS[c].name);
const cshort = (c) => cname(c);
function setYarns(y) {
  YARN = { ...(y || {}) };
  HEX = {};
  for (const k of Object.keys(COLORS)) {
    let hx = null;
    try { hx = YARN[k] ? C.sim.economy.colorHex(YARN[k]) : null; } catch { hx = null; }
    HEX[k] = /^#[0-9a-f]{6}$/i.test(hx || '') ? hx : COLORS[k].hex;
  }
  TONE = Object.fromEntries(Object.keys(COLORS).map((k) => [k, toneOf(HEX[k])]));
}

// ---------- glyphs (colorblind help), on strands, pins, pegs and spools ----------
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
const QMARK = { s: 'M8.6 9.2a3.5 3.5 0 1 1 5 3.2c-1 .5-1.6 1.2-1.6 2.4v.6', w: 3, f: circ(12, 18.6, 1.7) };
const glyphOf = (c) => GLYPHS[COLORS[c].glyph];
const glyphSvg = (c, cls = 'tb-gl') => {
  const g = glyphOf(c);
  const ink = TONE[c].ink;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${g.f ? `<path d="${g.f}" fill="${ink}"/>` : ''}${g.s ? `<path d="${g.s}" fill="none" stroke="${ink}" stroke-width="${g.w}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`;
};
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

// A finished skein: a twisted hank, tied in the middle.
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

// ---------- yarn: geometry and paint (the prototype's, unchanged) ----------
const LIGHT = [-0.5, -0.866];
const LIFT_UP = 0.17; // a raised strand sits this many yarn-widths up
function hash(a, b) { let x = (a * 374761393 + b * 668265263) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
function yarnGeom(pts, w, { vari = false, from = 0, to = Infinity, seed = 0, hairs = true } = {}) {
  const n = pts.length;
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  const len = cum[n - 1] || 0.001;
  to = Math.min(to, len);
  let k0 = 0, k1 = n - 1;
  while (k0 < n - 1 && cum[k0 + 1] <= from) k0++;
  while (k1 > 0 && cum[k1 - 1] >= to) k1--;
  const path = new Path2D();
  path.moveTo(pts[k0][0], pts[k0][1]);
  for (let k = k0 + 1; k <= k1; k++) path.lineTo(pts[k][0], pts[k][1]);
  const at = (s) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], sl = cum[hi] - cum[lo] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[lo]) / sl));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / sl, (b[1] - a[1]) / sl];
  };
  // ply: a diagonal groove and a highlight every pitch, like a two-ply twist
  const grooves = new Path2D(), shines = new Path2D();
  const pitch = w * 0.52, r = w * 0.36, a = w * 0.34;
  for (let s = pitch * (Math.ceil(Math.max(from, 0) / pitch - 0.5) + 0.5); s < Math.min(to, len - w * 0.25); s += pitch) {
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
  let first = true;
  for (let k = k0; k <= k1; k++) {
    const p = pts[Math.max(0, k - 1)], q = pts[Math.min(n - 1, k + 1)];
    const dl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / dl, ny = (q[0] - p[0]) / dl;
    const d = nx * LIGHT[0] + ny * LIGHT[1];
    const ox = nx * d * w * 0.24, oy = ny * d * w * 0.24;
    if (first) { sheen.moveTo(pts[k][0] + ox, pts[k][1] + oy); shade.moveTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); first = false; } else { sheen.lineTo(pts[k][0] + ox, pts[k][1] + oy); shade.lineTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); }
  }
  // a halo of fiber hairs at the edges (light and dark), placed by arc length
  const hairL = new Path2D(), hairD = new Path2D();
  if (hairs) {
    const step = w * 0.11;
    for (let m = Math.ceil(Math.max(from, 0) / step); m * step < Math.min(to, len); m++) {
      const h1 = hash(seed + 1, m), h2 = hash(seed + 7, m), h3 = hash(seed + 13, m);
      if (h1 > 0.55) continue;
      const [x, y, tx, ty] = at(m * step);
      const side = h2 < 0.5 ? -1 : 1, nx = -ty * side, ny = tx * side;
      const ang = (h3 - 0.5) * 1.6, ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = nx * ca - tx * sa * side, dy = ny * ca - ty * sa * side;
      const len2 = w * (0.1 + 0.26 * hash(seed + 19, m) ** 2);
      const sx = x + nx * w * 0.42, sy = y + ny * w * 0.42;
      const P = h1 < 0.3 ? hairL : hairD;
      P.moveTo(sx, sy); P.quadraticCurveTo(sx + dx * len2 * 0.6 + tx * len2 * 0.2, sy + dy * len2 * 0.6 + ty * len2 * 0.2, sx + dx * len2, sy + dy * len2);
    }
  }
  // where glyphs go (centered in a color band on two-color yarn)
  const spots = [];
  const dash = w * 1.7;
  if (vari) {
    for (let k = 1; (k + 0.5) * dash < len - w; k += 3) { const s = (k + 0.5) * dash; if (s >= from - w && s <= to + w) { const p = at(s); spots.push([p[0], p[1], k % 2]); } }
  } else {
    for (let s = Math.min(9, len / 2); s < len - 2; s += 22) if (s >= from - w && s <= to + w) { const p = at(s); spots.push([p[0], p[1], 0]); }
  }
  return { path, grooves, shines, sheen, shade, hairL, hairD, spots, len, dash: [dash, dash], dashOff: cum[k0], tip0: k0 === 0, tip1: k1 === n - 1 };
}

// o: { w, tone, tone2, lift, glow, hidden, alpha, glyphs: [c, c2] | null, shadow, butt, lite, qmarks }
function paintYarn(ctx, g, o) {
  const w = o.w, lift = o.lift || 0;
  ctx.save();
  if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = Math.max(0, o.alpha);
  const cap = o.butt ? 'butt' : 'round';
  ctx.lineCap = cap; ctx.lineJoin = 'round';
  if (o.shadow !== false) {
    const k = 1 + Math.max(0, lift) * 2;
    ctx.save();
    ctx.translate(w * 0.1 * k, w * 0.18 * k);
    ctx.strokeStyle = 'rgba(60,40,20,.2)'; ctx.lineWidth = w * 1.22; ctx.stroke(g.path);
    ctx.translate(w * 0.07 * k, w * 0.14 * k);
    ctx.strokeStyle = 'rgba(60,40,20,.08)'; ctx.lineWidth = w * 1.62; ctx.stroke(g.path);
    ctx.restore();
  }
  if (lift) ctx.translate(0, -lift * w * LIFT_UP);
  if (o.tapped > 0) {
    ctx.strokeStyle = `rgba(255,236,190,${0.55 * o.tapped})`; ctx.lineWidth = w * 1.95; ctx.stroke(g.path);
    ctx.strokeStyle = `rgba(255,253,244,${0.95 * o.tapped})`; ctx.lineWidth = w * 1.45; ctx.stroke(g.path);
  }
  if (o.glow > 0) {
    ctx.strokeStyle = `rgba(242,190,70,${0.6 * o.glow})`; ctx.lineWidth = w * 1.9; ctx.stroke(g.path);
    ctx.strokeStyle = `rgba(255,243,205,${0.9 * o.glow})`; ctx.lineWidth = w * 1.36; ctx.stroke(g.path);
  }
  const body = (t, t2) => {
    if (!o.lite) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = t.fuzzD; ctx.lineWidth = w * 0.035; ctx.stroke(g.hairD);
      ctx.strokeStyle = t.fuzz; ctx.lineWidth = w * 0.03; ctx.stroke(g.hairL);
      ctx.lineCap = cap;
    }
    ctx.strokeStyle = t.edge; ctx.lineWidth = w; ctx.stroke(g.path);
    ctx.strokeStyle = t.base; ctx.lineWidth = w * 0.8; ctx.stroke(g.path);
    if (t2) {
      ctx.setLineDash(g.dash); ctx.lineDashOffset = g.dashOff || 0; ctx.lineCap = 'butt';
      ctx.strokeStyle = t2.edge; ctx.lineWidth = w; ctx.stroke(g.path);
      ctx.strokeStyle = t2.base; ctx.lineWidth = w * 0.8; ctx.stroke(g.path);
      ctx.setLineDash([]); ctx.lineCap = cap;
    }
    if (!o.lite) { ctx.strokeStyle = 'rgba(28,16,6,.13)'; ctx.lineWidth = w * 0.22; ctx.stroke(g.shade); }
    if (!o.lite) { ctx.strokeStyle = 'rgba(255,250,238,.2)'; ctx.lineWidth = w * 0.2; ctx.stroke(g.sheen); }
    ctx.strokeStyle = 'rgba(28,16,6,.3)'; ctx.lineWidth = w * 0.1; ctx.stroke(g.grooves);
    ctx.strokeStyle = 'rgba(255,248,230,.22)'; ctx.lineWidth = w * 0.08; ctx.stroke(g.shines);
  };
  body(o.tone, o.tone2);
  const hid = o.hidden || 0;
  if (hid > 0) {
    ctx.globalAlpha *= hid;
    body(GRAY, null);
    ctx.globalAlpha /= hid;
  }
  if (hid > 0.5 || o.qmarks) {
    for (const [x, y] of g.spots) drawGlyph(ctx, QMARK, x, y, w * 0.82, 'rgba(70,60,48,.75)');
  } else if (o.glyphs) {
    for (const [x, y, k] of g.spots) {
      const c = o.glyphs[k] || o.glyphs[0];
      drawGlyph(ctx, glyphOf(c), x, y, w * 0.78, TONE[c].ink);
    }
  }
  ctx.restore();
}

// ---------- styles (the prototype's, scoped and prefixed) ----------
const CSS = `
#screen-tangle { --tb-wood: #B48A5A; --tb-wood-d: #8E6A42; --tb-wood-l: #D2AF7E; --tb-gold: #E2B04A; --tb-gold-soft: #F3E3B8; --tb-accent: #8C6512; --tb-card: #FBF8F1; --tb-line: rgba(42,38,34,.14);
  background: radial-gradient(120% 70% at 50% 0%, #F8F3E8 0%, #F4EFE4 60%, #EDE4D2 100%); overscroll-behavior-y: none; }
#screen-tangle [hidden] { display: none !important; }
#screen-tangle .screen-head.tb-head { background: transparent; gap: 4px; padding: calc(4px + var(--safe-top)) 12px 2px; max-width: 480px; width: 100%; margin: 0 auto; }
#screen-tangle .tb-app { gap: 6px; padding: 0 12px calc(8px + var(--safe-bottom)); max-width: 480px; width: 100%; margin: 0 auto; overflow-x: hidden; }
#screen-tangle .tb-closed { padding: 16px 16px 24px; max-width: 480px; margin: 0 auto; width: 100%; }
#screen-tangle .tb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
#screen-tangle .tb-sr:focus-within { position: static; width: auto; height: auto; clip: auto; white-space: normal; }
#screen-tangle .btn:disabled { opacity: .45; }
#screen-tangle .btn[aria-pressed="true"] { background: #F3E3B8; box-shadow: 0 0 0 2px var(--tb-gold), 0 3px 0 rgba(42,38,34,.18); }

/* top bar */
#screen-tangle .tb-iconbtn { appearance: none; border: 0; background: none; min-width: 44px; min-height: 44px; display: grid; place-items: center; border-radius: 12px; color: var(--ink-soft); cursor: pointer; text-decoration: none; font: inherit; font-size: 22px; touch-action: manipulation; }
#screen-tangle .tb-iconbtn:active { background: rgba(42,38,34,.06); }
#screen-tangle .tb-levelbtn { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; padding: 0 10px; justify-content: flex-start; }
#screen-tangle .tb-levelbtn .tb-nm { font: 400 17px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#screen-tangle .tb-levelbtn .tb-no { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-soft); white-space: nowrap; }
#screen-tangle .tb-levelbtn .tb-chev { margin-left: auto; color: var(--ink-soft); font-size: 13px; }
#screen-tangle .tb-tog { flex: 0 0 auto; min-width: 44px; padding: 0 8px; font-size: 15px; }
#screen-tangle .tb-settings .btn svg { width: 18px; height: 18px; vertical-align: -4px; margin-right: 4px; }

/* the finished-skein shelf */
#screen-tangle .tb-shelfrow { display: flex; align-items: flex-end; gap: 8px; height: 26px; flex: none; font-size: 12px; color: var(--ink-soft); position: relative; }
#screen-tangle .tb-shelfrow::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; border-radius: 2px; background: linear-gradient(var(--tb-wood-l), var(--tb-wood-d)); box-shadow: 0 2px 0 rgba(42,38,34,.12); }
#screen-tangle .tb-shelfrow b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
#tb-shelfCount { padding-bottom: 6px; white-space: nowrap; }
#tb-shelf { flex: 1; display: flex; gap: 1px; overflow: hidden; height: 22px; align-items: flex-end; padding-bottom: 3px; }
#tb-shelf svg { flex: none; width: 26px; height: 17px; }

/* the rack of spools */
#screen-tangle .tb-rack { display: grid; flex: none; grid-template-columns: repeat(var(--slots, 5), minmax(0, 1fr)); gap: 6px; padding: 7px 8px 5px; border-radius: 14px;
  background: repeating-linear-gradient(90deg, rgba(0,0,0,.03) 0 1px, transparent 1px 21px), linear-gradient(#CDAF83, #B8996B); box-shadow: inset 0 1px 0 rgba(255,240,210,.5), 0 3px 0 rgba(42,38,34,.16); }
#screen-tangle .tb-rack.tb-nudge { animation: tb-nudge .32s ease-in-out; }
@keyframes tb-nudge { 0%, 100% { transform: none; } 30% { transform: translateX(3px); } 65% { transform: translateX(-2px); } }
#screen-tangle .tb-slot { position: relative; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }
#screen-tangle .tb-peg { position: relative; width: 100%; max-width: 64px; height: 62px; display: grid; place-items: end center; }
#screen-tangle .tb-peg::after { content: ''; position: absolute; left: 14%; right: 14%; bottom: 0; height: 5px; border-radius: 50%; background: rgba(70,46,22,.28); }
#screen-tangle .tb-peg.tb-empty::before { content: ''; position: absolute; left: 50%; bottom: 3px; width: 6px; height: 40px; margin-left: -3px; border-radius: 3px; background: linear-gradient(90deg, #8E6A42, #C9A472, #8E6A42); box-shadow: 0 1px 0 rgba(42,38,34,.2); }
#screen-tangle .tb-peg.tb-spare { outline: 2px dashed var(--tb-gold); outline-offset: -2px; border-radius: 10px; }
#screen-tangle .tb-peg.tb-hot { animation: tb-hot 1.1s ease-in-out 2; border-radius: 10px; }
@keyframes tb-hot { 0%, 100% { box-shadow: 0 0 0 0 rgba(226,176,74,0); } 50% { box-shadow: 0 0 0 4px rgba(226,176,74,.55); } }
#screen-tangle .tb-cnt { font-size: 11px; font-weight: 700; line-height: 14px; color: rgba(42,38,34,.72); white-space: nowrap; font-variant-numeric: tabular-nums; }
#screen-tangle .tb-cnt.tb-soft { font-weight: 600; color: rgba(42,38,34,.5); }

/* a spool: two wooden flanges, the core, and the yarn wound on it */
#screen-tangle .tb-spool { --c: #999; --f: 0; position: relative; width: 40px; height: 54px; margin-bottom: 2px; }
#screen-tangle .tb-spool .tb-fl { position: absolute; left: 0; right: 0; height: 8px; border-radius: 50%; background: radial-gradient(70% 90% at 45% 35%, #E2C493, #B38A57 70%, #8E6A42); box-shadow: 0 1px 0 rgba(42,38,34,.25); z-index: 2; }
#screen-tangle .tb-spool .tb-fl.tb-t { top: 0; } #screen-tangle .tb-spool .tb-fl.tb-b { bottom: 0; }
#screen-tangle .tb-spool .tb-core { position: absolute; left: 50%; top: 4px; bottom: 4px; width: 14px; margin-left: -7px; background: linear-gradient(90deg, #9C7A4C, #D6B888 45%, #9C7A4C); z-index: 1; }
#screen-tangle .tb-spool .tb-wrap { position: absolute; top: 6px; bottom: 6px; left: 50%; width: calc(14px + var(--f) * 22px); transform: translateX(-50%); border-radius: 6px; z-index: 1; opacity: calc(var(--f) * 8);
  background:
    linear-gradient(90deg, rgba(0,0,0,.28), rgba(0,0,0,0) 30%, rgba(255,255,255,.18) 50%, rgba(0,0,0,0) 70%, rgba(0,0,0,.3)),
    repeating-linear-gradient(115deg, rgba(255,248,230,.22) 0 1.6px, rgba(0,0,0,0) 1.6px 3.4px, rgba(0,0,0,.16) 3.4px 4.4px, rgba(0,0,0,0) 4.4px 5.6px),
    var(--c);
  background-size: 100% 100%, 22px 100%, 100% 100%; transition: width .18s ease-out; }
#screen-tangle .tb-spool.tb-winding .tb-wrap { animation: tb-wind .22s linear infinite; }
@keyframes tb-wind { to { background-position: 0 0, 22px 0, 0 0; } }
#screen-tangle .tb-spool.tb-winding { animation: tb-wobble .22s ease-in-out infinite; }
@keyframes tb-wobble { 50% { transform: rotate(1.2deg); } }
#screen-tangle .tb-spool .tb-gl { position: absolute; left: 50%; top: 50%; width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px; z-index: 3; display: none; filter: drop-shadow(0 0 1.5px rgba(255,255,255,.8)); }
#screen-tangle.tb-glyphs .tb-spool .tb-gl { display: block; }
#screen-tangle .tb-spool.tb-hinted, #screen-tangle .tb-peg.tb-hinted { animation: tb-hot 1.1s ease-in-out infinite; border-radius: 10px; }

/* the basket */
#screen-tangle .tb-basketwrap { position: relative; display: flex; justify-content: center; align-items: center; flex: 1 0 auto; }
#screen-tangle .tb-basket { position: relative; padding: 9px; border-radius: 28px;
  background:
    repeating-linear-gradient(45deg, rgba(90,60,28,.16) 0 3px, rgba(255,240,210,.08) 3px 7px),
    repeating-linear-gradient(-45deg, rgba(90,60,28,.12) 0 3px, rgba(255,240,210,.06) 3px 7px),
    linear-gradient(160deg, #C9A06A, #A9804C 60%, #8C6638);
  box-shadow: inset 0 0 0 1px rgba(42,38,34,.3), inset 0 2px 0 rgba(255,236,200,.4), 0 5px 12px rgba(42,38,34,.22); }
#screen-tangle .tb-heapwrap { position: relative; overflow: hidden; border-radius: 20px; background: #ECE2CC; touch-action: none; isolation: isolate; }
#tb-heap, #tb-heapBack { display: block; transform-origin: 0 0; -webkit-user-select: none; user-select: none; }
#tb-heap { position: relative; touch-action: none; cursor: pointer; }
#tb-heapBack { position: absolute; left: 0; top: 0; visibility: hidden; pointer-events: none; }
#screen-tangle .tb-fitbtn { position: absolute; right: 14px; bottom: 14px; z-index: 5; display: inline-flex; align-items: center; gap: 4px; min-width: 44px; min-height: 44px; padding: 0 12px 0 9px;
  border: 0; border-radius: 22px; background: rgba(251,248,241,.9); color: var(--ink); font: 600 14px var(--font-ui); box-shadow: 0 2px 8px rgba(42,38,34,.22); cursor: pointer; touch-action: manipulation; }
#screen-tangle .tb-fitbtn svg { width: 20px; height: 20px; }
#screen-tangle .tb-fitbtn:active { transform: translateY(1px); }
#screen-tangle .tb-cheer { position: absolute; left: 50%; top: 42%; z-index: 6; pointer-events: none; transform: translate(-50%, -50%); font: 400 23px var(--font-display); color: #4A3A26; background: rgba(251,246,234,.9); padding: 7px 16px; border-radius: 999px; box-shadow: 0 2px 10px rgba(42,38,34,.18); white-space: nowrap; }
#tb-fly { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 40; visibility: hidden; }

/* message row: in thumb reach */
#screen-tangle .tb-msgrow { display: flex; align-items: center; gap: 6px; min-height: 48px; flex: none; flex-wrap: wrap; }
#tb-msg { flex: 1 1 150px; margin: 0; font-size: 14px; line-height: 1.3; font-weight: 500; }
#screen-tangle .tb-msgrow .tb-btns { display: flex; gap: 6px; margin-left: auto; }
#screen-tangle .tb-msgrow .btn { white-space: nowrap; }

/* sheets (inside the screen) */
#screen-tangle .tb-sheet { position: absolute; inset: 0; z-index: 60; background: rgba(42,38,34,.32); display: flex; align-items: flex-end; justify-content: center; }
#screen-tangle .tb-panel { width: 100%; max-width: 480px; max-height: 92%; overflow-y: auto; overflow-x: hidden; background: #F4EFE4; border-radius: 20px 20px 0 0; padding: 14px 16px calc(16px + var(--safe-bottom)); box-shadow: 0 -8px 30px rgba(42,38,34,.2); }
#screen-tangle .tb-sheet h2 { font: 400 24px var(--font-display); margin: 4px 0 6px; }
#screen-tangle .tb-x { float: right; }
#screen-tangle .tb-settings { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
#screen-tangle .tb-continue { width: 100%; margin-top: 10px; }
#screen-tangle .tb-band { font: 600 11px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); margin: 16px 2px 6px; display: flex; justify-content: space-between; gap: 8px; }
#screen-tangle .tb-band span { font-weight: 600; letter-spacing: 0; text-transform: none; white-space: nowrap; }
#screen-tangle .tb-lvls { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
#screen-tangle .tb-lvls button { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 8px; text-align: left; border: 0; border-radius: 12px; background: var(--tb-card); box-shadow: 0 1px 0 var(--tb-line); padding: 6px 8px; cursor: pointer; position: relative; font: inherit; color: inherit; }
#screen-tangle .tb-lvls button[aria-current="true"] { box-shadow: 0 0 0 2px var(--tb-gold); background: #FBF3DD; }
#screen-tangle .tb-lvls button.tb-next:not([aria-current="true"]) { box-shadow: 0 0 0 2px var(--tb-gold), 0 2px 6px rgba(226,176,74,.35); }
#screen-tangle .tb-lvls button.tb-locked { cursor: default; background: rgba(251,248,241,.55); }
#screen-tangle .tb-lvls button.tb-locked .tb-t { color: var(--ink-soft); }
#screen-tangle .tb-lvls canvas, #screen-tangle .tb-lvls .tb-lockthumb { flex: none; width: 40px; height: 50px; border-radius: 7px; background: #EDE3CF; box-shadow: inset 0 0 0 1px rgba(42,38,34,.12); }
#screen-tangle .tb-lvls .tb-lockthumb { display: grid; place-items: center; color: rgba(42,38,34,.35); }
#screen-tangle .tb-lvls .tb-lockthumb svg { width: 18px; height: 18px; }
#screen-tangle .tb-lvls .tb-t { min-width: 0; font-size: 13px; line-height: 1.25; }
#screen-tangle .tb-lvls .tb-t b { display: block; font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
#screen-tangle .tb-lvls .tb-chip { display: inline-block; margin-top: 2px; font-size: 10px; font-weight: 700; color: #6A5A1E; background: var(--tb-gold-soft); border-radius: 999px; padding: 1px 6px; }
#screen-tangle .tb-tick { position: absolute; left: 34px; top: 4px; width: 20px; height: 20px; border-radius: 50%; background: var(--tb-gold-soft); box-shadow: 0 0 0 2px #fff, 0 1px 2px rgba(42,38,34,.3); display: grid; place-items: center; color: #6A5A1E; font-size: 12px; font-weight: 800; }
#screen-tangle .tb-steps { display: flex; gap: 6px; justify-content: center; margin: 10px 0; }
#screen-tangle .tb-steps i { width: 8px; height: 8px; border-radius: 50%; background: rgba(42,38,34,.18); }
#screen-tangle .tb-steps i.tb-on { background: var(--tb-accent); }
#screen-tangle .tb-how p { font-size: 15px; line-height: 1.45; margin: 8px 0; }
#screen-tangle .tb-how svg.tb-ill { display: block; width: 100%; max-width: 320px; height: auto; margin: 6px auto; }
#screen-tangle .tb-how .how-link { display: flex; margin: 8px auto 0; }
#screen-tangle .tb-row2 { display: flex; gap: 8px; margin-top: 12px; }
#screen-tangle .tb-row2 .btn { flex: 1; }
#screen-tangle .tb-intro .tb-item { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
#screen-tangle .tb-intro .tb-item svg { flex: none; width: 56px; height: 56px; }
#screen-tangle .tb-intro .tb-item p { margin: 0; font-size: 15px; line-height: 1.4; }
#screen-tangle .tb-intro .tb-item strong { display: block; font: 400 17px var(--font-display); }

/* finish: the shelf of skeins */
#screen-tangle .tb-finish { text-align: center; }
#screen-tangle .tb-bigshelf { margin: 14px 0 10px; padding: 10px 6px 0; border-radius: 12px; background: linear-gradient(180deg, #F3EAD8, #EADBBE); }
#screen-tangle .tb-bigshelf .tb-row { display: flex; justify-content: center; align-items: flex-end; flex-wrap: wrap; gap: 6px 4px; padding-bottom: 6px; border-bottom: 9px solid var(--tb-wood-d); box-shadow: 0 2px 0 rgba(42,38,34,.15); margin-bottom: 12px; }
#screen-tangle .tb-pile { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 0 1 23%; min-width: 0; }
#screen-tangle .tb-pile .tb-sk { display: flex; flex-direction: column-reverse; align-items: center; }
#screen-tangle .tb-pile .tb-sk svg { width: 50px; height: 30px; margin-top: -11px; }
#screen-tangle .tb-pile .tb-sk svg:last-child { margin-top: 0; }
#screen-tangle .tb-pile .tb-tag { font-size: 11px; line-height: 1.2; color: var(--ink); background: var(--tb-card); padding: 2px 6px; border-radius: 6px; box-shadow: 0 1px 0 var(--tb-line); max-width: 100%; overflow-wrap: anywhere; }
#screen-tangle .tb-knits { font: 400 18px/1.35 var(--font-display); margin: 4px 0 2px; }
#screen-tangle .tb-finish .btn { width: 100%; margin-top: 8px; }
#screen-tangle .tb-reward { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px 10px; margin: 6px 0 4px; font-size: 14px; }
#screen-tangle .tb-reward .tb-coins { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-variant-numeric: tabular-nums; }
#screen-tangle .tb-reward .tb-coins i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
#screen-tangle .tb-reward .tb-again { color: var(--ink-soft); font-size: 13px; }

/* the Puzzles hub card */
.tb-card .tb-cardrow { display: flex; align-items: center; gap: 12px; }
.tb-card .tb-thumb { flex: none; padding: 3px; border-radius: 9px; background: linear-gradient(160deg, #C9A06A, #8C6638); box-shadow: 0 2px 0 rgba(42,38,34,.18); line-height: 0; }
.tb-card .tb-thumb svg { display: block; width: 46px; height: 64px; border-radius: 7px; background: #ECE2CC; }

@media (prefers-reduced-motion: reduce) {
  #screen-tangle .tb-spool.tb-winding, #screen-tangle .tb-spool.tb-winding .tb-wrap, #screen-tangle .tb-peg.tb-hot, #screen-tangle .tb-spool.tb-hinted, #screen-tangle .tb-peg.tb-hinted, #screen-tangle .tb-rack.tb-nudge { animation: none; }
  #screen-tangle .tb-spool .tb-wrap { transition: none; }
  #screen-tangle .tb-peg.tb-hot, #screen-tangle .tb-peg.tb-hinted { box-shadow: 0 0 0 3px rgba(226,176,74,.6); }
}
html[data-motion="reduced"] #screen-tangle .tb-spool.tb-winding, html[data-motion="reduced"] #screen-tangle .tb-spool.tb-winding .tb-wrap, html[data-motion="reduced"] #screen-tangle .tb-peg.tb-hot,
html[data-motion="reduced"] #screen-tangle .tb-spool.tb-hinted, html[data-motion="reduced"] #screen-tangle .tb-peg.tb-hinted, html[data-motion="reduced"] #screen-tangle .tb-rack.tb-nudge { animation: none; }
html[data-motion="reduced"] #screen-tangle .tb-spool .tb-wrap { transition: none; }
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('tb-style')) return;
  const el = document.createElement('style');
  el.id = 'tb-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------- the screen's own state ----------
let L = null, G = null, busy = false, skip = false, note = '', hinted = -1, tangled = false, howStep = 0;
let viewRack = null, viewSkeins = null; // what the rack and shelf show while animating
let queuedTap = null;
let winding = null; // the color going onto a spool right now
let visible = false, gen = 0, guideApi = null, built = false, lastSig = '', listHint = '';
const skipWaiters = new Set();
const stats = { pulls: 0, blocked: 0, undos: 0, hints: 0, nudges: 0, zooms: 0, pans: 0 };

function ownAnimations() {
  if (!ROOT) return [];
  try { if (ROOT.getAnimations) return ROOT.getAnimations({ subtree: true }); } catch { /* fall through */ }
  try { return document.getAnimations().filter((a) => a.effect && a.effect.target && ROOT.contains(a.effect.target)); } catch { return []; }
}
function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  for (const a of ownAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
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
  try { await fn(); } catch (e) { console.error('The Tangle Basket: an animation was cut short', e); } finally {
    busy = false; skip = false;
    viewRack = null; viewSkeins = null; winding = null;
    showFly(false);
    for (const el of $$('.tb-flying')) el.remove();
    for (const el of $$('.tb-spool.tb-winding')) el.classList.remove('tb-winding');
    if (myGen === gen && visible && G) {
      render();
      kick();
      scheduleBackdrop();
      afterMove();
      const q = queuedTap;
      queuedTap = null;
      if (q && !isDone(G.state)) setTimeout(() => tapAt(q.x, q.y), 0);
    } else queuedTap = null;
  }
}

// ---------- the heap painter ----------
const HP = {
  cv: null, ctx: null, cache: null, cctx: null, back: null, bctx: null, backStale: true, tile: null, dpr: 1,
  fit: { w: 300, h: 420, s: 3 }, view: fitView(), gview: null, K: 1, kr0: 1,
  spr: [], patches: new Map(), PX: [], tuckX: [], dyn: [], dynSet: new Set(),
  lift: [], liftV: [], hid: [], glow: [], glowUntil: [], fade: [], wig: null, pinFx: [], tapped: [], tapUntil: 0, lastSig: [], lastDrawn: [], full: true,
  rasterQ: [], cacheFull: true, cacheDirty: new Set(), ckeys: null, cglob: '', backT: 0,
};
let SPOT = null;
function spotSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(50,30,12,.42)'); g.addColorStop(0.5, 'rgba(50,30,12,.18)'); g.addColorStop(1, 'rgba(50,30,12,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}
// The linen lining, as a small tile that repeats (the weave keeps its size on screen).
function linenTile(dpr) {
  const c = document.createElement('canvas');
  const n = Math.round(48 * dpr);
  c.width = c.height = n;
  const x = c.getContext('2d');
  x.fillStyle = '#ECE2CC'; x.fillRect(0, 0, n, n);
  const st = Math.max(2, Math.round(dpr * 2));
  x.fillStyle = 'rgba(150,120,80,.07)';
  for (let y = 0; y < n; y += st) x.fillRect(0, y, n, 1);
  x.fillStyle = 'rgba(150,120,80,.05)';
  for (let xx = 0; xx < n; xx += st) x.fillRect(xx, 0, 1, n);
  x.fillStyle = 'rgba(255,255,255,.08)';
  for (let k = 0; k < 40; k++) x.fillRect(hash(k, 1) * n, hash(k, 2) * n, st * 2, 1);
  return c;
}
// The board's lining under the window v, into ctx (device px).
function paintLining(ctx, v, K, wpx, hpx) {
  const pat = ctx.createPattern(HP.tile, 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().translateSelf(-((v.x * K) % HP.tile.width), -((v.y * K) % HP.tile.height)));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, wpx, hpx);
  const B = L.board;
  const cx = (B.w / 2 - v.x) * K, cy = (B.h * 0.46 - v.y) * K;
  const g = ctx.createRadialGradient(cx, cy, B.w * 0.25 * K, (B.w / 2 - v.x) * K, (B.h / 2 - v.y) * K, B.w * 0.85 * K);
  g.addColorStop(0, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,.22)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, wpx, hpx);
}

function buildGeometry() {
  const n = L.n, st = G.state;
  HP.PX = L.cross.filter((c) => c.self || c.over < c.under); // crossings drawn as patches
  HP.tuckX = L.cross.filter((c) => c.tuck >= 0);
  HP.spotsOf = L.poly.map(() => []);
  for (const c of L.cross) if (!c.self && c.over > c.under) HP.spotsOf[c.over].push(c);
  HP.lift = Array(n).fill(0); HP.liftV = Array(n).fill(0);
  for (let i = 0; i < n; i++) HP.lift[i] = liftTarget(i, st);
  HP.hid = L.strands.map((_, i) => (showsColor(L, st, i) ? 0 : 1));
  HP.glow = Array(n).fill(0); HP.glowUntil = Array(n).fill(0); HP.fade = Array(n).fill(1);
  HP.wig = null; HP.pinFx = []; HP.cacheFull = true; HP.lastSig = []; HP.lastDrawn = []; HP.full = true;
  HP.view = fitView(); HP.gview = null; HP.backStale = true;
}

function sizeHeap() {
  const app = $('#tb-app');
  if (!app || !L) return;
  const vw = app.clientWidth || document.documentElement.clientWidth;
  const availW = Math.min(vw, 480) - 24 - 18;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.classList.contains('tb-basketwrap') || ch.classList.contains('tb-sr') || ch.hidden) continue;
    // the message row can grow to two rows (a message, then Spare slot and Undo); keep room for it
    used += ch.classList.contains('tb-msgrow') ? Math.max(ch.offsetHeight, 96) : ch.offsetHeight; n++;
  }
  used += n * 6 + 18 + 14;
  const cs = getComputedStyle(app);
  const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const availH = (app.clientHeight || innerHeight) - padV - used;
  const B = L.board;
  const cssW = Math.max(220, Math.floor(Math.min(availW, (availH / B.h) * B.w)));
  const cssH = Math.round((cssW * B.h) / B.w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  HP.dpr = dpr; HP.fit = { w: cssW, h: cssH, s: cssW / B.w };
  HP.kr0 = dpr * HP.fit.s;
  const cv = $('#tb-heap');
  HP.cv = cv; HP.ctx = cv.getContext('2d');
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
  const wrap = $('#tb-heapWrap');
  wrap.style.width = `${cssW}px`; wrap.style.height = `${cssH}px`;
  HP.cache = document.createElement('canvas');
  HP.cache.width = cv.width; HP.cache.height = cv.height;
  HP.cctx = HP.cache.getContext('2d');
  HP.back = $('#tb-heapBack'); HP.bctx = HP.back.getContext('2d');
  HP.back.width = Math.ceil(cv.width / 2); HP.back.height = Math.ceil(cv.height / 2); // half resolution: it only fills in while fingers move
  HP.back.style.width = `${cssW}px`; HP.back.style.height = `${cssH}px`;
  HP.tile = linenTile(dpr);
  HP.view = clampView(HP.fit, B, HP.view);
  setK();
  buildSprites(HP.kr0);
  sizeFly();
  kick();
}
function setK() {
  // device px per board unit; the window's corner snapped to whole device px, so bitmaps stay crisp
  HP.K = HP.dpr * HP.fit.s * HP.view.z;
  HP.view = { ...HP.view, x: Math.round(HP.view.x * HP.K) / HP.K, y: Math.round(HP.view.y * HP.K) / HP.K };
}

const liftTarget = (i, st) => (st.out[i] ? 0 : isUncovered(L, st, i) ? (isPinned(L, st, i) || isPegged(L, st, i) ? 0.5 : 1) : 0);

// Strands drawn live this frame: anything that moves, plus everything lying
// over it (so they still cover it), plus a knot partner.
function dynamicSet(now) {
  const st = G.state, D = new Set();
  for (let i = 0; i < L.n; i++) {
    if (st.out[i] && HP.fade[i] >= 1) continue;
    const moving = isUncovered(L, st, i) || Math.abs(HP.lift[i]) > 0.01 || Math.abs(HP.liftV[i]) > 0.01 ||
      HP.glow[i] > 0.001 || HP.glowUntil[i] > now || HP.fade[i] < 1 || (hinted >= 0 && groupOf(L, hinted).includes(i)) || (HP.tapUntil > now && HP.tapped.includes(i)) ||
      Math.abs(HP.hid[i] - (showsColor(L, st, i) ? 0 : 1)) > 0.001 || (HP.wig && HP.wig.ids.includes(i));
    if (moving) D.add(i);
  }
  const stack = [...D];
  while (stack.length) {
    const i = stack.pop();
    const ups = L.over[i].slice();
    if (L.partner[i] >= 0) ups.push(L.partner[i]);
    for (const j of ups) if ((!st.out[j] || HP.fade[j] < 1) && !D.has(j)) { D.add(j); stack.push(j); }
  }
  return D;
}

// The hint breathes three times, then holds still (no endless redraws).
let hintT0 = 0;
const HINT_MS = 3 * 2 * Math.PI * 260;
const hintGlow = (now) => (reduced() || now - hintT0 > HINT_MS ? 0.9 : 0.55 + 0.45 * Math.cos((now - hintT0) / 260));
function strandStyle(i, now) {
  const s = L.strands[i];
  const gl = Math.max(HP.glow[i], hinted >= 0 && groupOf(L, hinted).includes(i) ? hintGlow(now) : 0);
  return {
    w: W, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, lift: HP.lift[i], glow: gl, hidden: HP.hid[i],
    tapped: HP.tapUntil > now && HP.tapped.includes(i) ? Math.min(1, (HP.tapUntil - now) / 300) : 0,
    alpha: HP.fade[i], glyphs: glyphsOn() ? (s.c2 ? [s.c, s.c2] : [s.c]) : null,
  };
}

// ---------- bitmaps: each strand (and each patch) pre-painted ----------
// A bitmap covers a board rectangle [bx, by, bw, bh] at kr device px per unit.
// Drawing it at another zoom just scales it, until it is re-rasterized.
const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };
function freeSprite(sp) { if (sp) for (const key of ['flat', 'shadow', 'grayFlat', 'glow', 'tap']) freeCanvas(sp[key]); }
function freeSprites() { for (const sp of HP.spr) freeSprite(sp); HP.spr = []; for (const p of HP.patches.values()) freeCanvas(p.c); HP.patches.clear(); }
function paintBitmap(r, kr, fn, res = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(r.bw * kr * res)); c.height = Math.max(1, Math.ceil(r.bh * kr * res));
  const x = c.getContext('2d');
  x.setTransform(kr * res, 0, 0, kr * res, -r.bx * kr * res, -r.by * kr * res);
  fn(x);
  return c;
}
const glyphsOf = (s) => (glyphsOn() ? (s.c2 ? [s.c, s.c2] : [s.c]) : null);
const PAD = W * 1.25;
function spriteRect(i, kr) {
  const [x0, y0, x1, y1] = L.boxes[i];
  const bx = Math.floor((x0 - PAD) * kr) / kr, by = Math.floor((y0 - PAD) * kr) / kr;
  return { bx, by, bw: Math.ceil((x1 + PAD - bx) * kr) / kr, bh: Math.ceil((y1 + PAD - by) * kr) / kr };
}
function rasterStrand(i, kr) {
  const old = HP.spr[i];
  const r = spriteRect(i, kr);
  const s = L.strands[i], g = yarnGeom(L.poly[i], W, { vari: !!s.c2, seed: i * 31 + 7 });
  const sp = { ...r, kr, flat: null, shadow: null, grayFlat: null, glow: null, tap: null };
  sp.shadow = paintBitmap(r, kr, (c) => {
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = 'rgba(60,40,20,.2)'; c.lineWidth = W * 1.22; c.stroke(g.path);
    c.translate(W * 0.07, W * 0.14);
    c.strokeStyle = 'rgba(60,40,20,.08)'; c.lineWidth = W * 1.62; c.stroke(g.path);
  }, 0.5);
  // at rest: its soft shadow and the yarn in one bitmap (one copy per strand to paint the heap)
  const withShadow = (paint) => (c) => {
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(sp.shadow, W * 0.1 * kr, W * 0.18 * kr, Math.ceil(r.bw * kr), Math.ceil(r.bh * kr));
    c.restore();
    paint(c);
  };
  sp.flat = paintBitmap(r, kr, withShadow((c) => paintYarn(c, g, { w: W, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, shadow: false, glyphs: glyphsOf(s) })));
  if (s.q) sp.grayFlat = paintBitmap(r, kr, withShadow((c) => paintYarn(c, g, { w: W, tone: GRAY, shadow: false, qmarks: true })));
  HP.spr[i] = sp;
  if (old) freeSprite(old);
  // its patches follow
  for (const [key, p] of HP.patches) if (p.s === i) { freeCanvas(p.c); HP.patches.delete(key); }
}
function buildSprites(kr) {
  freeSprites();
  for (let i = 0; i < L.n; i++) rasterStrand(i, kr);
  HP.rasterQ = [];
  HP.cacheFull = true; HP.full = true; HP.backStale = true;
}
// Halos as rings around the yarn (its own body cut out), drawn over it: the
// gold glow of a strand in the way, and the soft cream light shared by every
// strand of a tapped snarl or knotted pair.
function haloOf(i, kind) {
  const sp = HP.spr[i];
  if (!sp[kind]) {
    const g = yarnGeom(L.poly[i], W, { hairs: false });
    sp[kind] = paintBitmap(sp, sp.kr, (c) => {
      c.lineCap = c.lineJoin = 'round';
      if (kind === 'glow') {
        c.strokeStyle = 'rgba(242,190,70,.6)'; c.lineWidth = W * 1.9; c.stroke(g.path);
        c.strokeStyle = 'rgba(255,243,205,.9)'; c.lineWidth = W * 1.36; c.stroke(g.path);
      } else {
        c.strokeStyle = 'rgba(255,236,190,.55)'; c.lineWidth = W * 1.95; c.stroke(g.path);
        c.strokeStyle = 'rgba(255,253,244,.95)'; c.lineWidth = W * 1.45; c.stroke(g.path);
      }
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = '#000'; c.lineWidth = W * 0.98; c.stroke(g.path);
    });
  }
  return sp[kind];
}
// The patch for a crossing: the top strand's few units either side of it,
// painted again (gray when it is buried).
function patchOf(c, gray) {
  const key = `${c.id}|${gray ? 1 : 0}`;
  let p = HP.patches.get(key);
  const o = c.over, sp = HP.spr[o];
  if (p && p.kr === sp.kr) return p;
  if (p) freeCanvas(p.c);
  const s = L.strands[o], cu = L.cum[o], at = cu[c.ko];
  const from = Math.max(0, at - c.r), to = Math.min(cu[cu.length - 1], at + c.r);
  const g = yarnGeom(L.poly[o], W, { vari: !!s.c2, from, to, seed: o * 31 + 7 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < cu.length; k++) if (cu[k] >= from - 1 && cu[k] <= to + 1) { const q = L.poly[o][k]; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const kr = sp.kr, pad = W * 1.1;
  const bx = Math.floor((x0 - pad) * kr) / kr, by = Math.floor((y0 - pad) * kr) / kr;
  const r = { bx, by, bw: Math.ceil((x1 + pad - bx) * kr) / kr, bh: Math.ceil((y1 + pad - by) * kr) / kr };
  const canvas = paintBitmap(r, kr, (x) => paintYarn(x, g, gray ? { w: W, tone: GRAY, shadow: false, qmarks: true, butt: true } : { w: W, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, shadow: false, glyphs: glyphsOf(s), butt: true }));
  p = { ...r, kr, c: canvas, s: o };
  HP.patches.set(key, p);
  return p;
}

// Board rect -> device px under the painted view.
const devX = (bx) => (bx - HP.view.x) * HP.K;
const devY = (by) => (by - HP.view.y) * HP.K;
function blitRect(ctx, img, r, up = 0) { ctx.drawImage(img, devX(r.bx), devY(r.by) - up, r.bw * HP.K, r.bh * HP.K); }
// Contact shadows where strand i lies over another drawn before it.
function drawSpots(ctx, list, up = 0) {
  const K = HP.K, rr = W * 1.05 * K;
  for (const c of list) ctx.drawImage(SPOT, devX(c.x) - rr, devY(c.y) - rr - up * 0.5, 2 * rr, 2 * rr);
}
// One strand from its bitmaps (identity transform, device px).
function blitStrand(ctx, i, o) {
  const sp = HP.spr[i], K = HP.K;
  const lift = o.lift || 0, kk = 1 + Math.max(0, lift) * 2;
  const up = Math.round(lift * W * LIFT_UP * K * 4) / 4;
  const a = o.alpha === undefined ? 1 : Math.max(0, o.alpha);
  if (lift > 0.01) {
    // raised: a wider shadow left on the heap below
    ctx.globalAlpha = a * Math.min(1, lift);
    ctx.drawImage(sp.shadow, devX(sp.bx) + W * 0.1 * kk * K, devY(sp.by) + W * 0.18 * kk * K, sp.bw * K, sp.bh * K);
  }
  const hid = sp.grayFlat ? Math.min(1, o.hidden || 0) : 0;
  ctx.globalAlpha = a;
  if (hid < 1) blitRect(ctx, sp.flat, sp, up);
  if (hid > 0) { ctx.globalAlpha = a * (hid < 1 ? hid : 1); blitRect(ctx, sp.grayFlat, sp, up); }
  if (o.tapped > 0) { ctx.globalAlpha = a * o.tapped; blitRect(ctx, haloOf(i, 'tap'), sp, up); }
  if (o.glow > 0) { ctx.globalAlpha = a * Math.min(1, o.glow); blitRect(ctx, haloOf(i, 'glow'), sp, up); }
  ctx.globalAlpha = 1;
}
function drawPatch(ctx, c, o) {
  const lift = o.lift || 0, up = Math.round(lift * W * LIFT_UP * HP.K * 4) / 4;
  const a = o.alpha === undefined ? 1 : Math.max(0, o.alpha);
  if (!c.self) { ctx.globalAlpha = a; drawSpots(ctx, [c], up); }
  const p = patchOf(c, false);
  ctx.globalAlpha = a;
  blitRect(ctx, p.c, p, up);
  if (o.hidden > 0 && L.strands[c.over].q) { ctx.globalAlpha = a * Math.min(1, o.hidden); const q = patchOf(c, true); blitRect(ctx, q.c, q, up); }
  ctx.globalAlpha = 1;
}
// A tucked end: a crease where it dives under, and a few fibers peeking out past the edge.
function drawTuck(ctx, c, alpha = 1) {
  const u = c.under, pu = L.poly[u], end = c.tuck ? pu.length - 1 : 0;
  const tip = pu[end], back = pu[c.tuck ? Math.max(0, end - 6) : Math.min(pu.length - 1, 6)];
  const dl = Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1;
  const tx = (tip[0] - back[0]) / dl, ty = (tip[1] - back[1]) / dl;
  const K = HP.K;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setTransform(K, 0, 0, K, -HP.view.x * K, -HP.view.y * K);
  // fibers: past the top strand's far edge, in the tucked strand's color
  const t = TONE[L.strands[u].c];
  const over = L.poly[c.over][c.ko];
  const ox = over[0] + tx * W * 0.62, oy = over[1] + ty * W * 0.62;
  ctx.lineCap = 'round';
  // a soft crease where it dives under
  const ix = over[0] - tx * W * 0.62, iy = over[1] - ty * W * 0.62;
  const gr = ctx.createRadialGradient(ix, iy, 0, ix, iy, W * 0.55);
  gr.addColorStop(0, 'rgba(40,24,10,.32)'); gr.addColorStop(1, 'rgba(40,24,10,0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ix, iy, W * 0.55, 0, 7); ctx.fill();
  for (let m = 0; m < 7; m++) {
    const a = (hash(u, m) - 0.5) * 1.5, ca = Math.cos(a), sa = Math.sin(a);
    const dx = tx * ca - ty * sa, dy = tx * sa + ty * ca, len = W * (0.3 + 0.4 * hash(u + 3, m));
    const sx = ox + (hash(u + 5, m) - 0.5) * W * 0.4 * -ty, sy = oy + (hash(u + 5, m) - 0.5) * W * 0.4 * tx;
    ctx.strokeStyle = m % 3 ? t.base : t.edge; ctx.lineWidth = W * (0.07 + 0.04 * hash(u + 9, m));
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + dx * len * 0.5 + dy * len * 0.25, sy + dy * len * 0.5 - dx * len * 0.25, sx + dx * len, sy + dy * len); ctx.stroke();
  }
  ctx.restore();
}
// The pin: a dressmaker's pin across the strand, its glass head the color of
// the strand that lets it out.
function pinGeom(i) {
  const by = L.pinBy[i];
  const p = L.poly[i][L.pinAt[i]];
  let best = null, bd = Infinity;
  for (const q of L.poly[by]) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
  const vx = (best[0] - p[0]) / (bd || 1), vy = (best[1] - p[1]) / (bd || 1);
  return { p, vx, vy, c: L.strands[by].c };
}
function drawPin(ctx, i, { lift = 0, glow = 0, off = 0, alpha = 1 } = {}) {
  const { p, vx, vy, c } = pinGeom(i);
  const up = lift * W * LIFT_UP;
  const x = p[0] + vx * off, y = p[1] + vy * off - up - off * 0.6;
  const a = [x - vx * W * 0.75, y - vy * W * 0.75], b = [x + vx * W * 0.62, y + vy * W * 0.62];
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(40,28,14,.28)'; ctx.lineWidth = 0.75;
  ctx.beginPath(); ctx.moveTo(a[0] + 0.5, a[1] + 0.9); ctx.lineTo(b[0] + 0.5, b[1] + 0.9); ctx.stroke();
  ctx.strokeStyle = '#D9DDE0'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = '#8E969C'; ctx.lineWidth = 0.22;
  ctx.beginPath(); ctx.moveTo(a[0], a[1] + 0.2); ctx.lineTo(b[0], b[1] + 0.2); ctx.stroke();
  const hx = b[0] + vx * 1.6, hy = b[1] + vy * 1.6, hr = W * 0.42;
  if (glow > 0) { ctx.fillStyle = `rgba(242,190,70,${0.7 * glow})`; ctx.beginPath(); ctx.arc(hx, hy, hr * 1.9, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(40,28,14,.3)'; ctx.beginPath(); ctx.arc(hx + 0.5, hy + 0.9, hr, 0, 7); ctx.fill();
  const gr = ctx.createRadialGradient(hx - hr * 0.35, hy - hr * 0.4, hr * 0.1, hx, hy, hr);
  gr.addColorStop(0, TONE[c].light); gr.addColorStop(0.55, hexOf(c)); gr.addColorStop(1, TONE[c].edge);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(hx - hr * 0.35, hy - hr * 0.38, hr * 0.22, 0, 7); ctx.fill();
  if (glyphsOn()) drawGlyph(ctx, glyphOf(c), hx, hy, hr * 1.25, TONE[c].ink);
  ctx.restore();
}
// The peg: a turned wooden peg standing in the basket, the strand looped round
// it, and a yarn band in the color of the skein that lets it out.
function drawPeg(ctx, i, { lift = 0, glow = 0, off = 0, alpha = 1 } = {}) {
  const pg = L.pegs.find((p) => p[0] === i);
  if (!pg) return;
  const [, c, px, py] = pg;
  const r = W * 0.5, up = lift * W * LIFT_UP + off;
  const x = px, y = py - up;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow > 0) { ctx.fillStyle = `rgba(242,190,70,${0.6 * glow})`; ctx.beginPath(); ctx.arc(x, y, r * 2, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(40,28,14,.32)'; ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.55 + off * 0.5, r * 1.05, r * 0.95, 0, 0, 7); ctx.fill();
  const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  gr.addColorStop(0, '#F0D7A8'); gr.addColorStop(0.6, '#C99A5E'); gr.addColorStop(1, '#8E6A42');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  // the colored band
  ctx.strokeStyle = TONE[c].edge; ctx.lineWidth = r * 0.42; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 7); ctx.stroke();
  ctx.strokeStyle = hexOf(c); ctx.lineWidth = r * 0.3; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 7); ctx.stroke();
  ctx.fillStyle = '#E6C997'; ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.18, r * 0.12, 0, 7); ctx.fill();
  if (glyphsOn()) drawGlyph(ctx, glyphOf(c), x, y, r * 0.62, 'rgba(42,30,20,.85)');
  ctx.restore();
}
// The knot where two strands are tied end to end: two lumps along the yarn
// and a wrap around the middle.
function knotAt(ctx, j, ang, ta, tb, w) {
  ctx.save();
  ctx.translate(j[0], j[1]);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(50,30,12,.24)'; ctx.beginPath(); ctx.ellipse(w * 0.1, w * 0.22, w * 0.95, w * 0.66, 0, 0, 7); ctx.fill();
  for (const [dx, t] of [[-w * 0.36, ta], [w * 0.36, tb]]) {
    ctx.fillStyle = t.edge; ctx.beginPath(); ctx.ellipse(dx, 0, w * 0.55, w * 0.62, 0, 0, 7); ctx.fill();
    ctx.fillStyle = t.base; ctx.beginPath(); ctx.ellipse(dx, 0, w * 0.45, w * 0.52, 0, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = ta.edge; ctx.lineWidth = w * 0.36; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-w * 0.05, -w * 0.6); ctx.quadraticCurveTo(w * 0.18, 0, -w * 0.05, w * 0.6); ctx.stroke();
  ctx.strokeStyle = ta.base; ctx.lineWidth = w * 0.24;
  ctx.beginPath(); ctx.moveTo(-w * 0.05, -w * 0.58); ctx.quadraticCurveTo(w * 0.18, 0, -w * 0.05, w * 0.58); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,230,.4)'; ctx.lineWidth = w * 0.07;
  ctx.beginPath(); ctx.ellipse(-w * 0.42, -w * 0.12, w * 0.26, w * 0.3, 0, 3.3, 4.6); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(w * 0.3, -w * 0.12, w * 0.26, w * 0.3, 0, 3.3, 4.6); ctx.stroke();
  ctx.restore();
}
const knotOf = (i) => L.knots.find((k) => k.includes(i));
function drawKnot(ctx, i, lift = 0) {
  const [a, b] = knotOf(i);
  const pa = L.poly[a], j = pa[pa.length - 1], q = pa[Math.max(0, pa.length - 4)];
  const up = lift * W * LIFT_UP;
  knotAt(ctx, [j[0], j[1] - up], Math.atan2(j[1] - q[1], j[0] - q[0]), TONE[L.strands[a].c], TONE[L.strands[b].c], W);
}
// What sits on a strand: its pin, its peg, its knot (drawn last, above patches).
function drawFixings(ctx, i, style) {
  const st = G.state;
  const pinned = L.pinBy[i] >= 0 && !st.out[L.pinBy[i]];
  const pegged = !!L.pegC[i] && isPegged(L, st, i);
  const knot = knotOf(i) && knotOf(i)[0] === i;
  if (!pinned && !pegged && !knot) return;
  const K = HP.K;
  ctx.setTransform(K, 0, 0, K, -HP.view.x * K, -HP.view.y * K);
  if (pinned) drawPin(ctx, i, { lift: style.lift, glow: HP.glow[i] > 0 && HP.glowPin === i ? HP.glow[i] : 0, alpha: style.alpha });
  if (pegged) drawPeg(ctx, i, { lift: style.lift, glow: HP.glow[i] > 0 && HP.glowPin === i ? HP.glow[i] : 0, alpha: style.alpha });
  if (knot) drawKnot(ctx, i, style.lift);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
// A strand in the live layer (identity transform). A wiggling one is painted
// from its bent path; anything else from its bitmaps.
function drawStrand(ctx, i, now, style = strandStyle(i, now)) {
  const w = HP.wig;
  const K = HP.K;
  let live = null;
  if (w && w.ids.includes(i)) {
    const t = clamp01((now - w.t0) / w.dur);
    const amp = 1.5 * Math.sin(t * Math.PI * 5) * (1 - t);
    if (Math.abs(amp) > 0.01) {
      const poly = L.poly[i], cum = L.cum[i], s0 = w.at[i];
      live = yarnGeom(poly.map((p, j) => {
        const q = poly[Math.min(poly.length - 1, j + 1)], r = poly[Math.max(0, j - 1)];
        const dl = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
        const f = amp * Math.exp(-(((cum[j] - s0) / 13) ** 2));
        return [p[0] - ((q[1] - r[1]) / dl) * f, p[1] + ((q[0] - r[0]) / dl) * f];
      }), W, { vari: !!L.strands[i].c2, hairs: false });
    }
  }
  if (live) {
    const sp = HP.spr[i], kk = 1 + Math.max(0, style.lift || 0) * 2;
    ctx.drawImage(sp.shadow, devX(sp.bx) + W * 0.1 * kk * K, devY(sp.by) + W * 0.18 * kk * K, sp.bw * K, sp.bh * K);
    ctx.setTransform(K, 0, 0, K, -HP.view.x * K, -HP.view.y * K);
    paintYarn(ctx, live, { ...style, shadow: false, lite: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else blitStrand(ctx, i, style);
}

// The cache: the lining and every strand that can't move, bottom to top,
// then the patches, tucks, pins, pegs and knots among them. When strands come
// and go, only their rectangles are repainted (a new view repaints all).
// Returns false (nothing changed), true (all repainted) or the device-px
// rectangles repainted.
const rectsArea = (rs) => rs.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0);
function paintCache(c, D, clip) {
  const st = G.state, K = HP.K;
  const inCache = (i) => !st.out[i] && !D.has(i);
  const W0 = HP.cache.width, H0 = HP.cache.height;
  const hit = clip
    ? (x0, y0, x1, y1) => clip.some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1])
    : (x0, y0, x1, y1) => x0 < W0 && x1 > 0 && y0 < H0 && y1 > 0;
  const hitR = (r) => hit(devX(r.bx), devY(r.by), devX(r.bx + r.bw), devY(r.by + r.bh));
  const hitP = (x, y, rad) => hit(devX(x) - rad, devY(y) - rad, devX(x) + rad, devY(y) + rad);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (clip) { c.save(); c.beginPath(); for (const r of clip) c.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]); c.clip(); }
  paintLining(c, HP.view, K, W0, H0);
  const plain = { lift: 0, alpha: 1 };
  for (let i = 0; i < L.n; i++) {
    if (!inCache(i) || !hitR(HP.spr[i])) continue;
    drawSpots(c, HP.spotsOf[i].filter((x) => inCache(x.under)));
    blitStrand(c, i, { ...plain, hidden: showsColor(L, st, i) ? 0 : 1 });
  }
  const far = W * 3 * K;
  for (const x of HP.PX) if (inCache(x.over) && inCache(x.under) && hitP(x.x, x.y, x.r * K + far)) drawPatch(c, x, { ...plain, hidden: showsColor(L, st, x.over) ? 0 : 1 });
  for (const x of HP.tuckX) if (inCache(x.over) && inCache(x.under) && hitP(x.x, x.y, far)) drawTuck(c, x);
  for (let i = 0; i < L.n; i++) if (inCache(i) && hitR(HP.spr[i])) drawFixings(c, i, plain);
  if (clip) c.restore();
}
function ensureCache(now) {
  const D = dynamicSet(now);
  const st = G.state;
  HP.dynSet = D;
  HP.dyn = [...D].sort((a, b) => a - b);
  const glob = `${glyphsOn() ? 'g' : ''}${HP.view.z},${HP.view.x},${HP.view.y}`;
  const keys = [];
  for (let i = 0; i < L.n; i++) keys.push(st.out[i] || D.has(i) ? '' : `c${showsColor(L, st, i) ? '' : 'h'}${isPinned(L, st, i) || isPegged(L, st, i) ? 'p' : ''}`);
  if (glob !== HP.cglob || HP.cacheFull || !HP.ckeys) {
    HP.cglob = glob; HP.ckeys = keys; HP.cacheFull = false; HP.cacheDirty.clear();
    paintCache(HP.cctx, D, null);
    return true;
  }
  const m = W * 2.2 * HP.K;
  const rects = [];
  for (let i = 0; i < L.n; i++) {
    if (keys[i] === HP.ckeys[i] && !HP.cacheDirty.has(i)) continue;
    const sp = HP.spr[i];
    rects.push([devX(sp.bx) - m, devY(sp.by) - m, devX(sp.bx + sp.bw) + m, devY(sp.by + sp.bh) + m]);
  }
  HP.ckeys = keys; HP.cacheDirty.clear();
  if (!rects.length) return false;
  if (rectsArea(rects) > 0.6 * HP.cache.width * HP.cache.height) { paintCache(HP.cctx, D, null); return true; }
  paintCache(HP.cctx, D, rects);
  return rects;
}

// Each frame repaints only where something changed: the rectangles of live
// strands whose look moved since the last frame (and of strands that just
// left the live set), with every live strand that overlaps them redrawn on top
// of the cached heap in order, then their patches. A rebuilt cache, a new view
// or a new layout repaints all.
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function drawHeap(now) {
  const c = HP.ctx, K = HP.K, st = G.state;
  const changed = ensureCache(now);
  const rebuilt = changed === true;
  const m = W * 1.3 * K;
  const rectOf = (i) => { const sp = HP.spr[i]; return [devX(sp.bx) - m, devY(sp.by) - m, devX(sp.bx + sp.bw) + m, devY(sp.by + sp.bh) + m]; };
  const styles = new Map(), rects = [];
  for (const i of HP.dyn) {
    if (st.out[i] && HP.fade[i] >= 1) continue;
    const y = strandStyle(i, now);
    styles.set(i, y);
    const wig = HP.wig && HP.wig.ids.includes(i);
    const sig = `${y.lift.toFixed(3)}|${y.glow.toFixed(3)}|${y.hidden.toFixed(3)}|${(y.alpha ?? 1).toFixed(3)}|${y.tapped.toFixed(3)}|${wig ? now : ''}|${isPinned(L, st, i) || isPegged(L, st, i) ? 1 : 0}|${HP.glowPin === i ? 1 : 0}`;
    if (HP.lastSig[i] !== sig) { HP.lastSig[i] = sig; rects.push(rectOf(i)); }
  }
  for (const i of HP.lastDrawn) if (!styles.has(i)) { rects.push(rectOf(i)); HP.lastSig[i] = ''; }
  if (Array.isArray(changed)) rects.push(...changed);
  HP.lastDrawn = [...styles.keys()];
  for (const f of HP.pinFx) {
    const p = f.peg ? [f.peg[2], f.peg[3]] : L.poly[f.i][L.pinAt[f.i]], r = W * 4 * K;
    rects.push([devX(p[0]) - r, devY(p[1]) - r * 1.5, devX(p[0]) + r, devY(p[1]) + r]);
  }
  const full = rebuilt || HP.full;
  if (!full && !rects.length) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!full) {
    c.save();
    c.beginPath();
    for (const r of rects) c.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    c.clip();
  }
  c.drawImage(HP.cache, 0, 0);
  const touched = new Set();
  for (const i of HP.dyn) {
    const y = styles.get(i);
    if (!y) continue;
    if (!full) { const r = rectOf(i); if (!rects.some((q) => overlaps(r, q))) continue; }
    touched.add(i);
    drawSpots(c, HP.spotsOf[i].filter((x) => !st.out[x.under] || HP.fade[x.under] < 1), Math.round(y.lift * W * LIFT_UP * K * 4) / 4);
    drawStrand(c, i, now, y);
  }
  for (const x of HP.PX) {
    if (!touched.has(x.over) && !touched.has(x.under)) continue;
    const yo = styles.get(x.over);
    if (!yo || (!styles.has(x.under) && !x.self)) continue;
    drawPatch(c, x, yo);
  }
  for (const x of HP.tuckX) if (styles.has(x.under) && (touched.has(x.under) || touched.has(x.over))) drawTuck(c, x, styles.get(x.under).alpha ?? 1);
  for (const i of touched) drawFixings(c, i, styles.get(i));
  // pins and pegs popping out
  c.setTransform(K, 0, 0, K, -HP.view.x * K, -HP.view.y * K);
  for (let j = HP.pinFx.length - 1; j >= 0; j--) {
    const f = HP.pinFx[j];
    const t = clamp01((now - f.t0) / 460);
    if (f.peg) drawPeg(c, f.i, { off: ease(t) * W * 1.6, alpha: 1 - t, lift: 1 });
    else drawPin(c, f.i, { off: ease(t) * W * 2.2, alpha: 1 - t, lift: 1 });
    if (t >= 1) HP.pinFx.splice(j, 1);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!full) c.restore();
  HP.full = false;
}

// The whole basket at the fit view (half resolution), behind the window, for
// while she pinches or drags. Painted when the page is idle, so it's ready.
function paintBackdrop() {
  if (!HP.backStale || !HP.bctx) return;
  HP.backStale = false;
  const keep = { view: HP.view, K: HP.K };
  HP.view = fitView(); HP.K = (HP.dpr * HP.fit.s) / 2;
  const c = HP.bctx, st = G.state;
  c.setTransform(1, 0, 0, 1, 0, 0);
  paintLining(c, HP.view, HP.K, HP.back.width, HP.back.height);
  const here = (i) => !st.out[i];
  const plain = { lift: 0, alpha: 1 };
  for (let i = 0; i < L.n; i++) if (here(i)) { drawSpots(c, HP.spotsOf[i].filter((x) => here(x.under))); blitStrand(c, i, { ...plain, hidden: showsColor(L, st, i) ? 0 : 1 }); }
  for (const x of HP.PX) if (here(x.over) && here(x.under)) drawPatch(c, x, { ...plain, hidden: showsColor(L, st, x.over) ? 0 : 1 });
  HP.view = keep.view; HP.K = keep.K;
}

function scheduleBackdrop() {
  if (isFit(HP.view) || !HP.backStale) return;
  clearTimeout(HP.backT);
  HP.backT = setTimeout(() => {
    if (!visible || !G || !HP.backStale || isFit(HP.view)) return;
    if (busy || GEST.active || HP.rasterQ.length) { scheduleBackdrop(); return; }
    paintBackdrop();
  }, 500);
}

// Springs: uncovered strands lift, buried colors fade in, glows fade out.
function physics(dt, now) {
  const st = G.state, rm = reduced();
  let moving = false;
  const Kk = 260, Cc = 2 * 0.78 * Math.sqrt(Kk); // about 2% overshoot
  for (let i = 0; i < L.n; i++) {
    const tgt = liftTarget(i, st) + (HP.glowUntil[i] > now ? 0.6 : 0);
    if (rm) { HP.lift[i] = tgt; HP.liftV[i] = 0; } else if (Math.abs(HP.lift[i] - tgt) > 0.002 || Math.abs(HP.liftV[i]) > 0.002) {
      const a = Kk * (tgt - HP.lift[i]) - Cc * HP.liftV[i];
      HP.liftV[i] += a * dt; HP.lift[i] += HP.liftV[i] * dt;
      moving = true;
    } else { HP.lift[i] = tgt; HP.liftV[i] = 0; }
    const ht = showsColor(L, st, i) ? 0 : 1;
    if (HP.hid[i] !== ht) {
      HP.hid[i] = rm ? ht : ht < HP.hid[i] ? Math.max(ht, HP.hid[i] - dt * 2.6) : Math.min(ht, HP.hid[i] + dt * 5);
      moving = true;
    }
    if (HP.glowUntil[i] > now) { HP.glow[i] = Math.min(1, HP.glow[i] + dt * 8); moving = true; } else if (HP.glow[i] > 0) { HP.glow[i] = Math.max(0, HP.glow[i] - dt * 2.2); moving = true; }
    if (HP.fade[i] < 1) { HP.fade[i] = rm ? 1 : Math.min(1, HP.fade[i] + dt * 4.5); moving = true; }
  }
  return moving;
}

// Bitmaps re-rasterized for a new zoom, a few per frame (nearest the window
// first), set aside, and swapped in together with one repaint at the end.
function rasterStep(budgetMs) {
  const t0 = performance.now();
  if (!HP.pending) HP.pending = [];
  while (HP.rasterQ.length && performance.now() - t0 < budgetMs) {
    const { i, kr } = HP.rasterQ.shift();
    if (!HP.spr[i] || HP.spr[i].kr === kr) continue;
    const keep = HP.spr[i];
    HP.spr[i] = null;
    rasterStrand(i, kr);
    HP.pending.push([i, HP.spr[i]]);
    HP.spr[i] = keep;
  }
  if (!HP.rasterQ.length && HP.pending.length) {
    for (const [i, sp] of HP.pending) {
      freeSprite(HP.spr[i]);
      HP.spr[i] = sp;
      for (const [key, p] of HP.patches) if (p.s === i) { freeCanvas(p.c); HP.patches.delete(key); }
    }
    HP.pending = [];
    HP.cacheFull = true; HP.full = true; HP.lastSig = [];
  }
  return HP.rasterQ.length > 0;
}
const SPRITE_BUDGET = 14e6; // device px of strand bitmaps near the window at once (about 56 MB)
function planRaster() {
  const v = HP.view, kr0 = HP.kr0;
  const want = Math.min(2.5, v.z);
  const ww = HP.fit.w / (HP.fit.s * v.z), wh = HP.fit.h / (HP.fit.s * v.z);
  const m = 0.25;
  const box = [v.x - ww * m, v.y - wh * m, v.x + ww * (1 + m), v.y + wh * (1 + m)];
  const near = [];
  for (let i = 0; i < L.n; i++) {
    if (G.state.out[i]) continue;
    const r = spriteRect(i, kr0);
    if (r.bx < box[2] && r.bx + r.bw > box[0] && r.by < box[3] && r.by + r.bh > box[1]) near.push({ i, area: r.bw * r.bh * (L.strands[i].q ? 2.25 : 1.25) });
  }
  const total = near.reduce((a, x) => a + x.area, 0) * kr0 * kr0;
  const q = Math.max(1, Math.min(want, Math.sqrt(SPRITE_BUDGET / Math.max(1, total))));
  const kr = kr0 * (q < 1.05 ? 1 : Math.round(q * 4) / 4);
  const cx = v.x + ww / 2, cy = v.y + wh / 2;
  near.sort((a, b) => { const A = L.boxes[a.i], B = L.boxes[b.i]; return Math.hypot((A[0] + A[2]) / 2 - cx, (A[1] + A[3]) / 2 - cy) - Math.hypot((B[0] + B[2]) / 2 - cx, (B[1] + B[3]) / 2 - cy); });
  for (const [, sp] of HP.pending || []) freeSprite(sp);
  HP.pending = [];
  HP.rasterQ = near.filter((x) => HP.spr[x.i].kr !== kr).map((x) => ({ i: x.i, kr }));
  // far ones go back to the base size (freeing memory) after the near ones
  for (let i = 0; i < L.n; i++) if (HP.spr[i].kr !== kr0 && !near.some((x) => x.i === i)) HP.rasterQ.push({ i, kr: kr0 });
  kick();
}

let raf = 0, lastT = 0;
function kick() { if (!raf && visible && L && G && HP.ctx) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
  if (!visible || !L || !G || !HP.ctx) return;
  let more = false;
  const w0 = performance.now();
  try {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    more = physics(dt, now);
    if (HP.wig && now - HP.wig.t0 > HP.wig.dur) { HP.wig = null; more = true; }
    drawHeap(now);
    if (!GEST.active && HP.rasterQ.length) more = rasterStep(Math.max(1, 7 - (performance.now() - w0))) || more || true;
    more = more || !!HP.wig || HP.pinFx.length > 0 || (hinted >= 0 && now - hintT0 < HINT_MS + 50) || HP.tapUntil > now - 50 || HP.rasterQ.length > 0;
  } catch (e) {
    console.error('The Tangle Basket: a frame was skipped', e);
  }
  PERF.frames++;
  PERF.heap.push(performance.now() - w0);
  if (PERF.heap.length > 4000) PERF.heap.shift();
  if (more) raf = requestAnimationFrame(frame);
}
const PERF = { frames: 0, heap: [], fly: [], gesture: [] }; // main-thread ms per heap frame, per in-flight frame, per gesture move

// ---------- the view: pinch, drag, double-tap, Fit ----------
const GEST = { active: false, ptrs: new Map(), mode: null, v0: null, a0: null, b0: null, start: null, lastEmptyTap: null, settleT: 0 };
// While a gesture runs: move the painted canvas (and the backdrop) with CSS only.
function showGestureView(v) {
  HP.gview = v;
  const R = HP.view, s = HP.fit.s;
  const k = v.z / R.z, tx = (R.x - v.x) * s * v.z, ty = (R.y - v.y) * s * v.z;
  HP.cv.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  const back = HP.back;
  back.style.transform = `translate(${-v.x * s * v.z}px, ${-v.y * s * v.z}px) scale(${v.z})`;
  back.style.visibility = isFit(R) ? 'hidden' : 'visible';
  renderFit(v);
}
function beginGesture() {
  if (GEST.active) return;
  GEST.active = true;
  if (!isFit(HP.view)) paintBackdrop();
}
// The fingers lifted: paint at the new view, and plan sharper bitmaps.
function settleView(v) {
  GEST.active = false;
  if (!L || !HP.cv) return;
  const before = HP.view;
  HP.view = clampView(HP.fit, L.board, v);
  setK();
  HP.gview = null;
  HP.cv.style.transform = '';
  HP.back.style.visibility = 'hidden';
  HP.back.style.transform = '';
  if (before.z !== HP.view.z || before.x !== HP.view.x || before.y !== HP.view.y) {
    HP.full = true;
    if (before.z !== HP.view.z) stats.zooms++; else stats.pans++;
    planRaster();
  }
  renderFit(HP.view);
  scheduleBackdrop();
  kick();
}
// A smooth move to a view (Fit, double-tap), then settle.
async function animateView(to) {
  beginGesture();
  const from = HP.gview || HP.view;
  await tween(reduced() ? 0 : 240, (t) => {
    const e = ease(t);
    const z = from.z + (to.z - from.z) * e;
    showGestureView({ z, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
  });
  settleView(to);
}
function renderFit(v = HP.view) {
  const b = $('#tb-fitBtn');
  if (!b || !L) return;
  const zoomed = !isFit(v);
  const deep = L.mechanics.includes('deep');
  b.hidden = !zoomed && !deep;
  const mode = zoomed ? 'fit' : 'zoom';
  if (b.dataset.mode === mode) return;
  b.dataset.mode = mode;
  b.innerHTML = zoomed
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Fit'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>Zoom';
  b.setAttribute('aria-label', zoomed ? 'Fit the whole basket' : 'Zoom in');
}

const localPt = (e) => { const r = $('#tb-heapWrap').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function bindHeap(heapEl) {
  heapEl.addEventListener('pointerdown', (e) => {
    const p = localPt(e);
    GEST.ptrs.set(e.pointerId, { p0: p, p });
    try { heapEl.setPointerCapture(e.pointerId); } catch { /* fine */ }
    if (GEST.ptrs.size === 1) {
      GEST.mode = 'tap'; GEST.v0 = HP.view; GEST.start = p;
    } else if (GEST.ptrs.size === 2) {
      // a second finger: a pinch (never a tap)
      const [a, b] = [...GEST.ptrs.values()];
      GEST.mode = 'pinch'; GEST.v0 = HP.gview || HP.view; GEST.a0 = a.p; GEST.b0 = b.p;
      beginGesture();
    }
  });
  heapEl.addEventListener('pointermove', (e) => {
    const q = GEST.ptrs.get(e.pointerId);
    if (!q || !L) return;
    q.p = localPt(e);
    const t0 = performance.now();
    if (GEST.mode === 'tap' && Math.hypot(q.p[0] - GEST.start[0], q.p[1] - GEST.start[1]) > TAP_SLOP) {
      // a drag: it moves the window (when zoomed in), and is not a tap
      GEST.mode = 'pan'; GEST.v0 = HP.view; GEST.start = q.p;
      beginGesture();
    }
    if (GEST.mode === 'pan') showGestureView(panBy(HP.fit, L.board, GEST.v0, q.p[0] - GEST.start[0], q.p[1] - GEST.start[1]));
    else if (GEST.mode === 'pinch' && GEST.ptrs.size >= 2) {
      const [a, b] = [...GEST.ptrs.values()];
      showGestureView(pinchView(HP.fit, L.board, GEST.v0, GEST.a0, GEST.b0, a.p, b.p));
    }
    if (GEST.mode === 'pan' || GEST.mode === 'pinch') { PERF.gesture.push(performance.now() - t0); if (PERF.gesture.length > 2000) PERF.gesture.shift(); }
  });
  const endPointer = (e, cancel) => {
    const q = GEST.ptrs.get(e.pointerId);
    if (!q) return;
    GEST.ptrs.delete(e.pointerId);
    if (GEST.mode === 'tap' && !cancel) {
      GEST.mode = null;
      tapAt(q.p[0], q.p[1]);
      return;
    }
    if (GEST.mode === 'pinch' && GEST.ptrs.size === 1) {
      // one finger stays down: carry on as a drag from here
      const [r] = [...GEST.ptrs.values()];
      GEST.mode = 'pan'; GEST.v0 = HP.gview || HP.view; GEST.start = r.p;
      return;
    }
    if (!GEST.ptrs.size) {
      const v = HP.gview;
      GEST.mode = null;
      if (v) settleView(v); else if (GEST.active) settleView(HP.view);
    }
  };
  heapEl.addEventListener('pointerup', (e) => endPointer(e, false));
  heapEl.addEventListener('pointercancel', (e) => endPointer(e, true));
  heapEl.addEventListener('wheel', (e) => {
    if (!L) return;
    e.preventDefault();
    beginGesture();
    const [x, y] = localPt(e);
    showGestureView(zoomAt(HP.fit, L.board, HP.gview || HP.view, Math.exp(-e.deltaY * 0.0015), x, y));
    clearTimeout(GEST.settleT);
    GEST.settleT = setTimeout(() => settleView(HP.gview || HP.view), 160);
  }, { passive: false });
}
function fitTapped() {
  if (busy) skipAll();
  if (!isFit(HP.view)) animateView(fitView());
  else animateView(zoomAt(HP.fit, L.board, HP.view, 2.2, HP.fit.w / 2, HP.fit.h / 2));
}

// The strand under a tap (css px from the window's corner), or -1.
function strandAt(px, py) {
  const p = toBoard(HP.fit, HP.view, px, py);
  return pickStrand(L, G.state, p, reachUnits(HP.fit, HP.view, W));
}
function tapAt(x, y) {
  if (!L || !G || isDone(G.state)) return;
  if (busy) { queuedTap = { x, y }; skipAll(); return; }
  const i = strandAt(x, y);
  if (i < 0) {
    // an empty spot: a second tap there soon after is a double-tap (fit, or zoom in)
    const now = performance.now(), last = GEST.lastEmptyTap;
    if (last && now - last.t < 340 && Math.hypot(x - last.x, y - last.y) < 36) {
      GEST.lastEmptyTap = null;
      if (!isFit(HP.view)) animateView(fitView());
      else animateView(zoomAt(HP.fit, L.board, HP.view, 2.2, x, y));
    } else GEST.lastEmptyTap = { t: now, x, y };
    return;
  }
  GEST.lastEmptyTap = null;
  act(i, toBoard(HP.fit, HP.view, x, y));
}
function act(i, at) {
  if (busy) { skipAll(); return; }
  if (!G) return;
  const why = whyNot(L, G.state, i);
  if (!why) doPull(i);
  else if (why.reason !== 'gone') blocked(i, why, at);
}

// ---------- the overlay: strands in flight ----------
const FLY = { cv: null, ctx: null, dpr: 1, box: null };
function sizeFly() {
  const cv = $('#tb-fly');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  FLY.cv = cv; FLY.ctx = cv.getContext('2d'); FLY.dpr = dpr;
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  cv.style.width = `${innerWidth}px`; cv.style.height = `${innerHeight}px`;
}
// The overlay is only shown while something is in flight: an empty
// full-screen layer still costs compositing time on every frame.
function clearFly() {
  if (!FLY.ctx) return;
  FLY.ctx.setTransform(1, 0, 0, 1, 0, 0);
  FLY.ctx.clearRect(0, 0, FLY.cv.width, FLY.cv.height);
}
function showFly(on) { if (FLY.cv) FLY.cv.style.visibility = on ? 'visible' : 'hidden'; if (!on) clearFly(); FLY.box = null; }
// Clear last frame's drawing only, then remember what this frame covers (css px).
function flyBegin() {
  const c = FLY.ctx, d = FLY.dpr, b = FLY.box;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (b) c.clearRect(Math.floor(b[0] * d), Math.floor(b[1] * d), Math.ceil((b[2] - b[0]) * d) + 2, Math.ceil((b[3] - b[1]) * d) + 2);
  else c.clearRect(0, 0, FLY.cv.width, FLY.cv.height);
  FLY.box = null;
  c.setTransform(d, 0, 0, d, 0, 0);
}
function flyMark(pts, pad) {
  const b = FLY.box || [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) { if (x - pad < b[0]) b[0] = x - pad; if (y - pad < b[1]) b[1] = y - pad; if (x + pad > b[2]) b[2] = x + pad; if (y + pad > b[3]) b[3] = y + pad; }
  FLY.box = b;
}

// A sub-polyline of track between arc lengths a and b.
function slice(track, cum, a, b) {
  const out = [];
  const lerp = (s) => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const t = clamp01((s - cum[lo]) / ((cum[hi] - cum[lo]) || 1));
    return [track[lo][0] + (track[hi][0] - track[lo][0]) * t, track[lo][1] + (track[hi][1] - track[lo][1]) * t];
  };
  if (b - a < 0.5) return out;
  out.push(lerp(a));
  let k = 0;
  while (k < cum.length && cum[k] <= a) k++;
  for (; k < cum.length && cum[k] < b; k++) out.push(track[k]);
  out.push(lerp(b));
  return out;
}

// ---------- rack and shelf ----------
function slotEl(k) { return $(`#tb-rack .tb-slot[data-slot="${k}"]`); }
function spoolHTML(sp, k, hot) {
  const spare = k >= L.slots;
  const lab = sp ? `${cname(sp.c)} spool, ${sp.n >= SPOOL ? 'full' : `${SPOOL - sp.n} more to fill`}` : spare ? 'Spare slot, empty' : 'Empty slot';
  if (!sp) return `<div class="tb-slot" data-slot="${k}" role="img" aria-label="${esc(lab)}"><div class="tb-peg tb-empty${spare ? ' tb-spare' : ''}${hot ? ' tb-hot' : ''}"></div><span class="tb-cnt tb-soft">${spare ? 'spare' : '&nbsp;'}</span></div>`;
  return `<div class="tb-slot" data-slot="${k}" role="img" aria-label="${esc(lab)}"><div class="tb-peg${spare ? ' tb-spare' : ''}${hot ? ' tb-hot' : ''}"><div class="tb-spool" style="--c:${hexOf(sp.c)};--f:${(sp.n / SPOOL).toFixed(3)}"><i class="tb-fl tb-t"></i><i class="tb-core"></i><i class="tb-wrap"></i><i class="tb-fl tb-b"></i>${glyphSvg(sp.c)}</div></div><span class="tb-cnt">${sp.n >= SPOOL ? 'full' : `${SPOOL - sp.n} more`}</span></div>`;
}
function renderRack(rack = viewRack || G.state.rack, hot = false) {
  const el = $('#tb-rack');
  if (!el) return;
  el.style.setProperty('--slots', rack.length);
  el.innerHTML = rack.map((sp, k) => spoolHTML(sp, k, hot && rack.every(Boolean))).join('');
}
function renderShelf(sk = viewSkeins || G.state.skeins) {
  const c = $('#tb-shelfCount');
  if (!c) return;
  c.innerHTML = `Skeins <b>${sk.length}</b>`;
  $('#tb-shelf').innerHTML = sk.map((x) => skeinSVG(x)).join('');
}

// ---------- render (DOM) ----------
function render() {
  if (!L || !G || !$('#tb-rack')) return;
  const s = G.state;
  ROOT.classList.toggle('tb-glyphs', glyphsOn());
  const idx = LEVELS.indexOf(L);
  $('#tb-lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#tb-lvName').textContent = L.name;
  renderToggles();
  renderRack();
  renderShelf();
  const stuck = !busy && isStuck(L, s);
  const offerSpare = !busy && !isDone(s) && (stuck || tangled);
  const sp = $('#tb-stuckBtn');
  sp.hidden = !offerSpare;
  sp.textContent = canNudge(s) ? 'Add a spare slot' : 'Start over';
  $('#tb-hintBtn').hidden = stuck;
  $('#tb-hintBtn').disabled = isDone(s);
  $('#tb-undoBtn').disabled = !G.past.length;
  $('#tb-msg').textContent = message(s);
  renderFit();
  renderSr();
}

function renderToggles() {
  const gb = $('#tb-glyphBtn');
  if (!gb) return;
  const g = glyphsOn(), snd = !!set().sound;
  gb.setAttribute('aria-pressed', String(g));
  gb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS.heart.f}" fill="currentColor"/></svg>Color symbols: ${g ? 'on' : 'off'}`;
  const sb = $('#tb-soundBtn');
  sb.setAttribute('aria-pressed', String(snd));
  sb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${snd ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>Soft sounds: ${snd ? 'on' : 'off'}`;
}

function message(s) {
  if (busy && !note) return winding ? `Winding onto the ${cshort(winding)} spool…` : 'Winding…';
  if (note) return note;
  if (isDone(s)) return 'All untangled. Lovely work.';
  if (isStuck(L, s)) {
    return canNudge(s)
      ? 'The rack is full and no free strand matches a spool. Undo a step, or take a spare slot.'
      : 'The rack is full again. Undo a few steps, or start this basket fresh.';
  }
  if (!s.moves) {
    if (LEVELS.indexOf(L) === 0) return 'Tap a strand that sits raised, with nothing lying on top. It slides out and winds onto a spool.';
    if (L.mechanics.includes('deep')) return 'A deep one. Pinch to look closer; raised strands have nothing on top.';
    return 'Raised strands have nothing on top. Tap one to pull it free.';
  }
  const left = remaining(s);
  if (s.rack.every(Boolean)) return `The rack is full: pull a color that’s already on a spool. ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
  return `Lovely. ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
}

// Screen readers and keyboards: the strands with nothing on top, as buttons.
const groupName = (g) => {
  const names = g.map((m) => `${colorsOf(L, m).map(cname).join(' and ')} strand`);
  if (g.length > 1 && L.snarlOf[g[0]] >= 0) return `${names.join(', ')}, snarled together`;
  return names.join(' knotted to a ');
};
function renderSr() {
  const s = G.state;
  const items = [];
  for (let i = 0; i < L.n; i++) {
    const g = groupOf(L, i);
    if (s.out[i] || g[0] !== i || !g.every((m) => isUncovered(L, s, m))) continue;
    const extra = g.some((m) => isPinned(L, s, m)) ? ', pinned' : g.some((m) => isPegged(L, s, m)) ? ', looped round a peg' : !canPull(L, s, i) ? ', waiting for room on the rack' : '';
    items.push(`<button type="button" data-strand="${i}">${esc(groupName(g))}${extra}</button>`);
  }
  $('#tb-srList').innerHTML = items.join('');
}

// ---------- the game state, through the sim ----------
function syncG() {
  const cur = TS().current(S());
  G = cur ? { state: cur.s, past: cur.past } : null;
  if (cur) setYarns(cur.yarns);
  lastSig = sigOfGame();
  return cur;
}
function sigOfGame() {
  const g = S().tangle && S().tangle.game;
  return g ? `${g.level}|${g.moves.length}|${g.moves[g.moves.length - 1] ?? ''}` : 'none';
}

// ---------- pulling: the slither ----------
function doPull(i) {
  const before = G.state;
  const res = C.game.act(TS().pull, { strand: i });
  if (!res || !res.ok) { syncG(); render(); return; }
  syncG();
  stats.pulls++;
  note = ''; hinted = -1; tangled = false;
  HP.backStale = true;
  for (const m of res.group) HP.fade[m] = 1;
  // pins this pull lets out, and pegs a finished skein lets out
  const now = performance.now();
  for (let s = 0; s < L.n; s++) if (L.pinBy[s] >= 0 && res.group.includes(L.pinBy[s]) && !G.state.out[s]) HP.pinFx.push({ i: s, t0: now });
  for (const pg of L.pegs) if (!G.state.out[pg[0]] && !before.skeins.includes(pg[1]) && G.state.skeins.includes(pg[1])) HP.pinFx.push({ i: pg[0], t0: now + 900, peg: pg });
  viewRack = before.rack.map((x) => (x ? { ...x } : null));
  viewSkeins = before.skeins.slice();
  winding = res.events[0].c;
  run(async () => {
    kick();
    sfx('pluck');
    await slither(res.group, res.events);
  });
}

// Every strand of the pull slithers out along its own path at once (a knotted
// pair as one length, the knot riding between), each toward its spool; then
// the lengths land in winding order, and full spools pop off.
async function slither(group, events) {
  const r = $('#tb-heapWrap').getBoundingClientRect();
  const v = HP.view, sc = HP.fit.s * v.z;
  const scr = (p) => { const q = toScreen(HP.fit, v, p[0], p[1]); return [r.left + q[0], r.top + q[1]]; };
  const firstOf = (m) => events.find((e) => e.m === m);
  const knot = group.length === 2 && L.partner[group[0]] === group[1];
  const paths = knot ? [knotOf(group[0])] : group.map((m) => [m]);
  const tracks = [];
  for (const members of paths) {
    let pts = L.poly[members[0]].map(scr);
    if (members.length > 1) pts = pts.concat(L.poly[members[1]].slice(1).map(scr));
    const ev = events.find((e) => members.includes(e.m));
    const target = spoolCenter(ev.slot);
    let order = members.slice();
    const d0 = Math.hypot(pts[0][0] - target[0], pts[0][1] - target[1]);
    const d1 = Math.hypot(pts[pts.length - 1][0] - target[0], pts[pts.length - 1][1] - target[1]);
    if (d0 < d1) { pts.reverse(); order = order.reverse(); }
    const lens = order.map((m) => L.cum[m][L.cum[m].length - 1] * sc);
    const yarnLen = lens.reduce((a, b) => a + b, 0);
    const E = pts[pts.length - 1], F = pts[Math.max(0, pts.length - 4)];
    const tl = Math.hypot(E[0] - F[0], E[1] - F[1]) || 1;
    const T = [(E[0] - F[0]) / tl, (E[1] - F[1]) / tl];
    const span = Math.hypot(target[0] - E[0], target[1] - E[1]);
    const c1 = [E[0] + T[0] * Math.min(110, span * 0.45), E[1] + T[1] * Math.min(110, span * 0.45)];
    const c2 = [target[0], target[1] + Math.min(120, span * 0.5)];
    const nb = Math.max(8, Math.ceil(span / 5));
    for (let k = 1; k <= nb; k++) {
      const t = k / nb, u = 1 - t;
      pts.push([u * u * u * E[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * target[0], u * u * u * E[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * target[1]]);
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    tracks.push({ order, track: pts, cum, total: cum[cum.length - 1], lens, yarnLen, slot: ev.slot, ev });
  }
  // zoomed in, the yarn slims down to its usual size on the way to the rack
  const wAt = (t) => W * (sc + (HP.fit.s - sc) * ease(t));
  let w = wAt(0);
  // spools that start fresh appear before the yarn arrives
  const nBefore = {};
  for (const t of tracks) {
    if (t.ev.fresh && !viewRack[t.slot]) viewRack[t.slot] = { c: t.ev.c, n: 0 };
    if (!(t.slot in nBefore)) nBefore[t.slot] = viewRack[t.slot] && viewRack[t.slot].c === t.ev.c ? viewRack[t.slot].n : 0;
  }
  renderRack();
  const ctx = FLY.ctx;
  showFly(true);
  const rm = reduced();
  const longest = Math.max(...tracks.map((t) => t.total));
  const dur = rm ? 220 : Math.max(560, Math.min(1150, longest / 1.3));
  const ticked = {}, windingOn = new Set();
  await tween(dur, (t) => {
    const w0 = performance.now();
    try { flyFrame(t); } finally { PERF.fly.push(performance.now() - w0); if (PERF.fly.length > 2000) PERF.fly.shift(); }
  });
  function flyFrame(t) {
    flyBegin();
    w = wAt(t);
    const fill = {};
    for (const tr of tracks) {
      const { order, track, cum, total, lens, yarnLen } = tr;
      if (rm) {
        // reduced motion: the strands fade where they lay, and the spools fill
        let off = 0;
        for (const m of order) {
          const len = L.cum[m][L.cum[m].length - 1] * sc;
          const part = slice(track, cum, off, off + len);
          off += len;
          flyMark(part, w * 2.4);
          if (part.length > 1) paintYarn(ctx, yarnGeom(part, w, { vari: !!L.strands[m].c2, hairs: false }), { w, tone: TONE[L.strands[m].c], tone2: L.strands[m].c2 ? TONE[L.strands[m].c2] : null, lift: 1, alpha: 1 - t, lite: true });
        }
        fill[tr.slot] = (fill[tr.slot] || 0) + t;
        continue;
      }
      const d = total * ease(t);
      let off = d;
      for (let k = 0; k < order.length; k++) {
        const m = order[k];
        const a = off, b = Math.min(total, off + lens[k]);
        off += lens[k];
        if (b - a < 0.5) continue;
        const part = slice(track, cum, a, b);
        if (part.length < 2) continue;
        flyMark(part, w * 2.4);
        const s = L.strands[m];
        paintYarn(ctx, yarnGeom(part, w, { vari: !!s.c2, hairs: false }), { w, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, lift: 1.6, lite: tracks.length > 1, glyphs: glyphsOn() ? (s.c2 ? [s.c, s.c2] : [s.c]) : null });
        if (k === 0 && order.length > 1 && a + lens[0] < total) {
          // the knot rides along between the two
          const kp = slice(track, cum, Math.max(0, a + lens[0] - 3), a + lens[0]);
          if (kp.length > 1) {
            const q = kp[kp.length - 1], o = kp[0];
            knotAt(ctx, [q[0], q[1] - 1.6 * w * LIFT_UP], Math.atan2(q[1] - o[1], q[0] - o[0]), TONE[L.strands[order[0]].c], TONE[L.strands[order[1]].c], w);
          }
        }
      }
      const wound = clamp01((d + yarnLen - total) / yarnLen);
      fill[tr.slot] = (fill[tr.slot] || 0) + wound;
      if (wound > 0 && wound * 4 > (ticked[tr.slot] || 0) + 1) { ticked[tr.slot] = (ticked[tr.slot] || 0) + 1; sfx('tick', tr.ev.n * 2 + ticked[tr.slot]); }
    }
    for (const slot of Object.keys(fill)) {
      const sp = slotEl(+slot)?.querySelector('.tb-spool');
      if (!sp) continue;
      if (fill[slot] > 0 && !windingOn.has(slot)) { windingOn.add(slot); sp.classList.add('tb-winding'); }
      sp.style.setProperty('--f', (Math.min(SPOOL, nBefore[slot] + fill[slot]) / SPOOL).toFixed(3));
    }
  }
  showFly(false);
  for (const el of $$('.tb-spool.tb-winding')) el.classList.remove('tb-winding');
  // land every length in winding order; a second length of a strand hops to its own spool
  const landed = new Set();
  for (const ev of events) {
    const own = firstOf(ev.m);
    if (landed.has(ev.m) && own && own.slot !== ev.slot) await hop(own.slot, ev);
    else if (ev.fresh && !viewRack[ev.slot]) { viewRack[ev.slot] = { c: ev.c, n: 0 }; renderRack(); }
    landed.add(ev.m);
    await landEvent(ev);
  }
}

function spoolCenter(slot) {
  const el = slotEl(slot);
  const b = (el?.querySelector('.tb-peg') || $('#tb-rack')).getBoundingClientRect();
  return [b.left + b.width / 2, b.top + b.height * 0.52];
}
// One length is on its spool: count it, and pop a full spool off as a skein.
async function landEvent(ev) {
  viewRack[ev.slot] = { c: ev.c, n: ev.n };
  if (!ev.popped) { renderRack(); return; }
  renderRack();
  await popSpool(ev.slot, ev.c);
  viewRack[ev.slot] = null;
  renderRack();
}
// A second length (the other color of a two-color strand) hops over to its own spool.
async function hop(fromSlot, ev) {
  if (ev.fresh) { viewRack[ev.slot] = { c: ev.c, n: 0 }; renderRack(); }
  const a = spoolCenter(fromSlot), b = spoolCenter(ev.slot);
  if (reduced() || skip) return;
  const ctx = FLY.ctx, w = W * HP.fit.s;
  const s = TONE[ev.c];
  showFly(true);
  await tween(300, (t) => {
    flyBegin();
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const u = clamp01(ease(t) * 1.25 - 0.25 + k / 48);
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(Math.PI * u) * 38]);
    }
    flyMark(pts, w * 2.4);
    paintYarn(ctx, yarnGeom(pts, w * 0.8, { hairs: false }), { w: w * 0.8, tone: s, lift: 1.4, lite: true });
  });
  showFly(false);
}
async function popSpool(slot, c) {
  sfx('pop');
  const peg = slotEl(slot)?.querySelector('.tb-peg');
  const spool = peg?.querySelector('.tb-spool');
  viewSkeins.push(c);
  if (!spool || reduced() || skip) { renderShelf(); return; }
  await anim(spool, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.05)', offset: 0.45 }, { transform: 'translateY(-4px) scale(.98)', offset: 0.75 }, { transform: 'translateY(-6px)' }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
  const r = spool.getBoundingClientRect();
  const sk = document.createElement('div');
  sk.className = 'tb-flying';
  sk.innerHTML = skeinSVG(c);
  sk.style.cssText = `position:fixed;z-index:45;pointer-events:none;left:${r.left + r.width / 2 - 30}px;top:${r.top + r.height / 2 - 18}px;width:60px;height:36px`;
  ROOT.append(sk);
  spool.style.opacity = '0';
  await anim(sk, [
    { transform: 'scale(.4, .9) rotate(-150deg)', opacity: 0.4 },
    { transform: 'scale(1.05, .95) rotate(-10deg)', opacity: 1, offset: 0.6 },
    { transform: 'none', opacity: 1 },
  ], { duration: 320, easing: 'ease-out' });
  const shelf = $('#tb-shelf').getBoundingClientRect();
  const tx = Math.min(shelf.right - 20, shelf.left + viewSkeins.length * 27 - 13) - (r.left + r.width / 2);
  const ty = shelf.bottom - 12 - (r.top + r.height / 2);
  await anim(sk, [{ transform: 'none' }, { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - 26}px) scale(.75) rotate(-8deg)`, offset: 0.5 }, { transform: `translate(${tx}px, ${ty}px) scale(.42)` }], { duration: 360, easing: 'cubic-bezier(.45,0,.6,1)', fill: 'forwards' });
  sk.remove();
  renderShelf();
  const last = $('#tb-shelf svg:last-child');
  anim(last, [{ transform: 'translateY(-6px) scale(1.05)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
}

// ---------- a blocked tap: a gentle wiggle, and what is in the way glows ----------
function blocked(i, why, at) {
  stats.blocked++;
  const now = performance.now();
  const g = why.group || [i];
  const s0 = {};
  for (const m of g) {
    let best = L.cum[m][L.cum[m].length - 1] / 2;
    if (at && m === i) {
      let bd = Infinity;
      L.poly[m].forEach((p, k) => { const d = Math.hypot(p[0] - at[0], p[1] - at[1]); if (d < bd) { bd = d; best = L.cum[m][k]; } });
    } else if (why.reason === 'pinned' && L.pinBy[m] >= 0) best = L.cum[m][L.pinAt[m]];
    s0[m] = best;
  }
  if (!reduced()) HP.wig = { ids: g, at: s0, t0: now, dur: 460 };
  // a snarl (or knotted pair) shows all its strands together: a soft shared highlight
  HP.tapped = g; HP.tapUntil = now + (g.length > 1 ? 1700 : 1100);
  HP.glowPin = -1;
  const glowFor = (list, ms = 1300) => { for (const j of list) HP.glowUntil[j] = now + ms; };
  const kind = (m) => `${colorsOf(L, m).map(cshort).join(' and ')}`;
  const snarled = g.length > 1 && L.snarlOf[g[0]] >= 0;
  const intro = snarled ? `${g.length === 2 ? 'These two' : `These ${g.length}`} strands are snarled together, so they come out as one. ` : g.length > 1 ? `This one is knotted to a ${showsColor(L, G.state, g.find((m) => m !== i)) ? kind(g.find((m) => m !== i)) : 'buried'} strand, so they come out together. ` : '';
  if (why.reason === 'covered') {
    glowFor(why.blockers);
    const n = why.blockers.length;
    const what = g.length > 1 ? 'them' : showsColor(L, G.state, i) ? `this ${kind(i)} one` : 'this one';
    const tucked = HP.tuckX.some((c) => g.includes(c.under) && why.blockers.includes(c.over));
    note = tucked && n === 1 && g.length === 1
      ? 'Its end is tucked under the glowing strand. Free that one first.'
      : `${intro}${n === 1 ? `One strand lies over ${what}. Free the glowing strand first.` : `${n} strands lie over ${what}. Free the glowing ones first.`}`;
  } else if (why.reason === 'pinned') {
    glowFor(why.pins);
    const pinned = g.find((m) => isPinned(L, G.state, m));
    HP.glowPin = pinned; HP.glowUntil[pinned] = Math.max(HP.glowUntil[pinned], now + 1300);
    note = `${intro}Pinned in place. The pin comes out when you pull the glowing ${kind(why.pins[0])} strand, the color of its glass head.`;
  } else if (why.reason === 'pegged') {
    const pegged = g.find((m) => isPegged(L, G.state, m));
    HP.glowPin = pegged; HP.glowUntil[pegged] = Math.max(HP.glowUntil[pegged], now + 1300);
    const c = why.pegs[0];
    const onRack = G.state.rack.findIndex((x) => x && x.c === c);
    note = `${intro}Looped round a peg. The peg lifts out once a ${cshort(c)} skein is finished${onRack >= 0 ? `: ${SPOOL - G.state.rack[onRack].n} more ${cshort(c)} to go` : ''}.`;
    if (onRack >= 0) setTimeout(() => slotEl(onRack)?.querySelector('.tb-peg')?.classList.add('tb-hot'), 0);
  } else if (why.reason === 'rack') {
    const cs = why.colors.map(cshort);
    note = `${intro}The rack is full, and there’s no ${cs.join(' or ')} spool yet. Finish a spool to make room.`;
    if (cs.length > 1) note = `${intro}${g.length > 1 ? 'They need' : 'This one needs'} ${cs.join(' and ')} spools, and the rack is full. Finish a spool to make room.`;
    const rk = $('#tb-rack');
    rk.classList.remove('tb-nudge'); void rk.offsetWidth; rk.classList.add('tb-nudge');
  }
  sfx('soft');
  render();
  if (why.reason === 'rack') $$('#tb-rack .tb-peg').forEach((p) => p.classList.add('tb-hot'));
  kick();
}

// ---------- undo, spare slot, hint, start over ----------
function doUndo() {
  if (busy) { skipAll(); return; }
  if (!G || !G.past.length) return;
  const was = G.state;
  C.game.act(TS().undo);
  syncG();
  stats.undos++;
  note = 'Undone.'; hinted = -1; tangled = false;
  HP.backStale = true;
  for (let i = 0; i < L.n; i++) if (was.out[i] && !G.state.out[i]) { HP.fade[i] = reduced() ? 1 : 0; HP.lift[i] = 1.4; }
  render();
  kick();
}
function doSpare() {
  if (busy || !G) return;
  if (!canNudge(G.state)) { restart(); return; }
  C.game.act(TS().nudge);
  syncG();
  stats.nudges++;
  note = 'A spare slot, just for this basket.'; tangled = false; hinted = -1;
  render();
  const last = $$('#tb-rack .tb-slot').at(-1);
  if (last && !reduced()) anim(last, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
}
function doHint() {
  if (busy) { skipAll(); return; }
  if (!G) return;
  stats.hints++;
  try {
    const hn = hint(L, G.state);
    if (hn.kind === 'pull') {
      hinted = hn.strand; tangled = false; hintT0 = performance.now();
      const g = groupOf(L, hn.strand), s = L.strands[hn.strand];
      note = g.length > 1 && L.snarlOf[g[0]] >= 0
        ? 'Try this snarl next: its strands glow, and they come out together.'
        : `Try this ${showsColor(L, G.state, hn.strand) ? cshort(s.c) : ''} strand next. It glows.`.replace('this  strand', 'this strand');
      revealStrand(hn.strand);
    } else if (hn.kind === 'tangled') {
      hinted = -1; tangled = true;
      note = canNudge(G.state)
        ? 'This one has gotten tangled: no order clears it from here. Undo a few steps, or take a spare slot.'
        : 'This one has gotten tangled: no order clears it from here. Undo a few steps, or start fresh.';
    }
  } catch (e) {
    console.error(e);
    note = 'Try a raised strand whose color is already on a spool.';
  }
  render();
  kick();
}
// When zoomed in, bring a strand into the window (for a hint).
function revealStrand(i) {
  if (isFit(HP.view)) return;
  const v = HP.view, ww = HP.fit.w / (HP.fit.s * v.z), wh = HP.fit.h / (HP.fit.s * v.z);
  const b = L.boxes[i];
  const inside = L.poly[i].some((p, k) => k % 4 === 0 && p[0] > v.x + 3 && p[0] < v.x + ww - 3 && p[1] > v.y + 3 && p[1] < v.y + wh - 3);
  if (inside) return;
  animateView(clampView(HP.fit, L.board, { z: v.z, x: (b[0] + b[2]) / 2 - ww / 2, y: (b[1] + b[3]) / 2 - wh / 2 }));
}
function restart() {
  if (busy) return;
  startLevel(L.id, { fresh: true });
}

let finishing = false;
async function afterMove() {
  if (!G || !visible) return;
  const s = G.state;
  if (isDone(s) && !finishing) {
    finishing = true;
    const myGen = gen;
    try {
      sfx('chord');
      if (!reduced()) {
        const pill = document.createElement('div');
        pill.className = 'tb-cheer tb-flying';
        pill.textContent = 'All untangled!';
        $('#tb-basket').append(pill);
        await anim(pill, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -62%)' }], { duration: 1300, easing: 'ease-out' });
        pill.remove();
      }
    } finally {
      finishing = false;
      if (myGen === gen && visible) openFinish();
    }
  }
}

// ---------- sound (soft, optional; through ctx.audio, so it also follows the game's sound setting) ----------
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
function sfx(kind, k = 0) {
  if (!set().sound || skip || !C || !C.audio) return;
  try {
    if (kind === 'pluck') C.audio.tink(392 * 1.25, 0, 0.12);
    else if (kind === 'tick') C.audio.tink(523 * 2 ** (PENTA[k % PENTA.length] / 12), 0, 0.06);
    else if (kind === 'pop') C.audio.cork();
    else if (kind === 'soft') C.audio.tick('select');
    else if (kind === 'chord') C.audio.chord([0.55, 0.68, 0.8]);
  } catch { /* sound is a nicety */ }
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  skipAll();
  closeAllSheets(['tb-levelSheet']);
  const t = S().tangle;
  let r;
  if (fresh || id !== t.cur || !t.game) r = C.game.act(TS().startBasket, { levelId: id, fresh });
  else r = C.game.act(TS().openBasket);
  if (r && !r.ok && r.reason === 'closed') C.game.act(TS().openBasket);
  syncG();
  if (!G) { C.game.act(TS().startBasket, { levelId: S().tangle.cur, fresh: true }); syncG(); }
  if (!G) { setTimeout(() => { if (visible) C.back(); openRestSheet(C, 'tangle'); }, 0); return; } // resting with nothing to show (Responsibility mode)
  if (restingResult(r)) openRestSheet(C, 'tangle'); // what is on the table stays
  L = levelById(S().tangle.cur) || LEVELS[0];
  skip = false;
  hinted = -1; note = ''; tangled = false;
  if (r && r.resumed && G && G.past.length) note = 'Back where you left it.';
  buildGeometry();
  render();
  sizeHeap();
  maybeIntro();
}

// ---------- sheets ----------
function openSheet(sel) {
  const el = $(sel);
  if (!el) return;
  el.hidden = false;
  const p = el.querySelector('.tb-panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('.btn-primary') || el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { if (el) el.hidden = true; }
function closeAllSheets(except = []) { for (const sh of $$('.tb-sheet')) if (!except.includes(sh.id)) sh.hidden = true; }

/** A thumbnail of a basket from its control points (never builds the heap). */
/** key -> hex for her yarns (the basket on the table's, else the next basket's). */
function yarnHexes() {
  let y = {};
  try { y = TS().yarns(S()); } catch { /* catalog fallbacks */ }
  const out = {};
  for (const key of Object.keys(COLORS)) { let hx = null; try { hx = y[key] ? C.sim.economy.colorHex(y[key]) : null; } catch { hx = null; } out[key] = hx || COLORS[key].hex; }
  return out;
}
function thumb(id, hexes, w = 80, hgt = 112) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = hgt;
  const Lv = levelById(id);
  const c = cv.getContext('2d');
  const k = w / Lv.board.w;
  c.scale(k, k);
  c.lineCap = c.lineJoin = 'round';
  const hx = (key) => hexes[key];
  for (const s of ctrlOf(id)) {
    const p = s.pts;
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (let q = 1; q < p.length - 1; q++) c.quadraticCurveTo(p[q][0], p[q][1], (p[q][0] + p[q + 1][0]) / 2, (p[q][1] + p[q + 1][1]) / 2);
    c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    const base = hx(s.c);
    c.strokeStyle = toneOf(base).edge; c.lineWidth = W * 0.95; c.stroke();
    c.strokeStyle = s.q ? HIDDEN_HEX : base; c.lineWidth = W * 0.7; c.stroke();
  }
  return cv;
}
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/></svg>';

function openLevels() {
  const box = $('#tb-lvList');
  box.innerHTML = '';
  const t = S().tangle;
  const done = (t && t.done) || {};
  const maxOpen = TS().maxOpen(S());
  const nextId = TS().continueId(S());
  const firstOf = {};
  LEVELS.forEach((Lv, i) => { for (const m of Lv.mechanics) if (!(m in firstOf)) firstOf[m] = i; });
  const hexes = yarnHexes();
  const cont = levelById(nextId);
  const ci = LEVELS.indexOf(cont);
  const cb = $('#tb-continueBtn');
  cb.textContent = `Continue: ${ci + 1} · ${cont.name}`;
  cb.dataset.level = nextId;
  const hl = $('#tb-lvHint');
  hl.textContent = listHint || 'Baskets open one after another. A tick means you’ve untangled it.';
  listHint = '';
  CHAPTERS.forEach((ch, bi) => {
    const to = Math.min(LEVELS.length, bi + 1 < CHAPTERS.length ? CHAPTERS[bi + 1].from : LEVELS.length);
    if (ch.from >= LEVELS.length) return;
    const h3 = document.createElement('h3');
    h3.className = 'tb-band';
    let untangled = 0;
    for (let i = ch.from; i < to; i++) if (done[LEVELS[i].id]) untangled++;
    h3.innerHTML = `${esc(`${bi + 1} · ${ch.name}`)}<span>${untangled === to - ch.from ? 'all untangled ✓' : untangled ? `${untangled} untangled` : esc(ch.fiber)}</span>`;
    const ul = document.createElement('ul');
    ul.className = 'tb-lvls';
    for (let i = ch.from; i < to; i++) {
      const Lv = LEVELS[i];
      const open = i <= maxOpen || !!done[Lv.id];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-tap', '');
      b.dataset.level = Lv.id;
      b.setAttribute('aria-current', String(Lv === L));
      if (Lv.id === nextId) b.classList.add('tb-next');
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      if (!open) {
        b.classList.add('tb-locked');
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-label', `${i + 1}. ${Lv.name}, opens after basket ${i}`);
        const lk = document.createElement('span');
        lk.className = 'tb-lockthumb';
        lk.innerHTML = LOCK_SVG;
        b.append(lk);
      } else {
        b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${done[Lv.id] ? ', untangled' : ''}${Lv.id === nextId ? ', next' : ''}${fresh.length ? `, new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : ''}`);
        b.append(thumb(Lv.id, hexes));
        if (done[Lv.id]) { const tk = document.createElement('span'); tk.className = 'tb-tick'; tk.textContent = '✓'; tk.setAttribute('aria-hidden', 'true'); b.append(tk); }
      }
      const tt = document.createElement('span');
      tt.className = 'tb-t';
      const chip = open && Lv.id === nextId && Lv !== L ? 'next' : open && fresh.length ? `new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : '';
      tt.innerHTML = `<b>${i + 1} · ${Lv.n} strands</b>${esc(Lv.name)}${chip ? `<br><span class="tb-chip">${esc(chip)}</span>` : ''}`;
      b.append(tt);
      li.append(b);
      ul.append(li);
    }
    box.append(h3, ul);
  });
  $('#tb-restartBtn').textContent = 'Start this basket over';
  renderToggles();
  openSheet('#tb-levelSheet');
  ($('#tb-levelSheet [aria-current="true"]') || $('#tb-levelSheet .tb-next'))?.scrollIntoView({ block: 'center' });
}

function coinsText(n) {
  const v = Number.isFinite(n) ? n : 0;
  const x = v < 100 ? Math.max(v > 0 ? 1 : 0, Math.round(v)) : v;
  return C.format && C.format.num ? C.format.num(x) : String(Math.round(x));
}

/** The finish sheet's reward line: what this basket paid (state.tangle.last). */
function rewardHtml() {
  const last = S().tangle && S().tangle.last;
  if (!last || last.levelId !== L.id) return '';
  const n = coinsText(last.coins || 0);
  return `<span class="tb-coins" data-tb-coins><i aria-hidden="true"></i>+${esc(n)} ${n === '1' ? 'coin' : 'coins'}</span>${last.repeat ? '<span class="tb-again">untangled again</span>' : ''}`;
}

function openFinish() {
  if (!G || !isDone(G.state) || !$('#tb-finishSheet') || !$('#tb-finishSheet').hidden) return;
  const s = G.state;
  const k = knitsInto(s.skeins);
  $('#tb-finTitle').textContent = `${L.name}: all untangled`;
  $('#tb-finSub').textContent = `${k.skeins} ${k.skeins === 1 ? 'skein' : 'skeins'} wound and on the shelf.`;
  const counts = {};
  for (const c of s.skeins) counts[c] = (counts[c] || 0) + 1;
  const piles = Object.keys(counts).map((c) => `<div class="tb-pile"><div class="tb-sk">${skeinSVG(c).repeat(Math.min(4, counts[c]))}</div><span class="tb-tag">${esc(cname(c))}${counts[c] > 1 ? ` ×${counts[c]}` : ''}</span></div>`);
  let rows = '';
  for (let i = 0; i < piles.length; i += 4) rows += `<div class="tb-row">${piles.slice(i, i + 4).join('')}</div>`;
  $('#tb-finShelf').innerHTML = rows;
  $('#tb-finKnits').textContent = k.line;
  $('#tb-finYards').textContent = `About ${k.yards} yards of worsted, at 100 yards to a 50 g skein.`;
  const rw = rewardHtml();
  const rEl = $('#tb-finReward');
  rEl.innerHTML = rw;
  rEl.hidden = !rw;
  const next = levelById(TS().nextLevelId(S(), L.id)) || LEVELS[0];
  $('#tb-finNext').textContent = `Next: ${next.name}`;
  $('#tb-finNext').dataset.level = next.id;
  // Responsibility mode: resting, Next and Again wait; a leaf note says until when.
  {
    const resting = isResting(C, 'tangle');
    let rn = $('#tb-finRest');
    if (!rn) { rn = document.createElement('div'); rn.id = 'tb-finRest'; $('#tb-finNext').before(rn); }
    rn.innerHTML = resting ? String(restingNote(C, 'tangle')) : String(restBits(C, S(), 'tangle').line);
    $('#tb-finNext').hidden = resting;
    $('#tb-finAgain').hidden = resting;
  }
  openSheet('#tb-finishSheet');
  if (!reduced()) $$('#tb-finShelf .tb-sk svg').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 60, fill: 'backwards', easing: 'ease-out' }));
  if (rw && C.audio && set().sound) { try { C.audio.coins(4); } catch { /* fine */ } }
}

// Intro cards: one line for each new thing, the first time it appears.
const yarnIcon = (d, col, w = 7) => `<path d="${d}" fill="none" stroke="${mixHex(col, '#24160A', 0.36)}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w * 0.75}" stroke-linecap="round"/>`;
const spoolIcon = (x, col, f = 1) => `<rect x="${x - 6}" y="16" width="12" height="3" rx="1.5" fill="#B38A57"/><rect x="${x - 6}" y="37" width="12" height="3" rx="1.5" fill="#B38A57"/><rect x="${x - 2.5 - f * 2.5}" y="19" width="${5 + f * 5}" height="18" rx="2" fill="${col}"/>`;
const ICON = {
  rack: `<svg viewBox="0 0 56 56"><rect x="2" y="12" width="52" height="32" rx="6" fill="#C9AA7C"/>${['#B9473A', '#34588E', '#D6A92E', '#5F8A3A', '#B8467A'].map((c, i) => spoolIcon(8 + i * 10, c, 0.6)).join('')}</svg>`,
  knot: `<svg viewBox="0 0 56 56">${yarnIcon('M4 40C14 40 18 28 28 28', '#B9473A')}${yarnIcon('M28 28C38 28 42 16 52 16', '#34588E')}<circle cx="28" cy="28" r="5.5" fill="#7A3A2C"/><circle cx="27" cy="27.5" r="3.6" fill="#B9473A"/><circle cx="30" cy="29" r="3.2" fill="#34588E"/></svg>`,
  weave: `<svg viewBox="0 0 56 56">${yarnIcon('M4 30C14 10 26 10 30 26S44 46 52 24', '#34588E')}${yarnIcon('M10 6C16 20 18 34 14 50', '#D6A92E')}${yarnIcon('M44 6C38 22 40 36 46 50', '#B9473A')}${yarnIcon('M30 26C31 29 32 32 34 35', '#34588E')}</svg>`,
  pin: `<svg viewBox="0 0 56 56">${yarnIcon('M4 34C18 22 34 40 52 26', '#D6A92E')}<path d="M24 40 35 20" stroke="#9AA2A8" stroke-width="2" stroke-linecap="round"/><circle cx="36" cy="18" r="5" fill="#34588E"/><circle cx="34.5" cy="16.5" r="1.4" fill="#fff" opacity=".8"/></svg>`,
  snarl: `<svg viewBox="0 0 56 56">${yarnIcon('M6 34C18 10 34 10 50 30', '#B9473A')}${yarnIcon('M6 22C20 46 36 46 50 22', '#34588E')}${yarnIcon('M40 17C44 20 47 24 50 30', '#B9473A')}<circle cx="28" cy="28" r="22" fill="none" stroke="#F2BE46" stroke-width="2" stroke-dasharray="3 4" opacity=".8"/></svg>`,
  variegated: `<svg viewBox="0 0 56 56">${yarnIcon('M4 38C16 18 36 44 52 18', '#B9473A')}<path d="M4 38C16 18 36 44 52 18" fill="none" stroke="#D6A92E" stroke-width="5.2" stroke-dasharray="7 7"/></svg>`,
  big: `<svg viewBox="0 0 56 56">${yarnIcon('M4 16C20 30 34 6 52 22', '#5F8A3A', 5)}${yarnIcon('M6 42C20 22 32 46 50 34', '#B8467A', 5)}${yarnIcon('M14 6C22 22 18 36 30 52', '#34588E', 5)}${yarnIcon('M44 6C36 24 46 36 38 52', '#D9782B', 5)}</svg>`,
  buried: `<svg viewBox="0 0 56 56">${yarnIcon('M4 30C18 18 36 42 52 28', HIDDEN_HEX)}${yarnIcon('M26 4C22 22 34 34 28 52', '#674A8C')}<text x="12" y="20" font-size="13" font-family="Georgia" fill="#6A5235">?</text></svg>`,
  deep: `<svg viewBox="0 0 56 56">${yarnIcon('M4 18C18 30 30 8 52 20', '#5F8A3A', 4)}${yarnIcon('M4 38C20 26 34 48 52 34', '#B8467A', 4)}<circle cx="30" cy="27" r="13" fill="rgba(251,248,241,.55)" stroke="#6B635A" stroke-width="3"/><path d="M39 36l9 9" stroke="#6B635A" stroke-width="4" stroke-linecap="round"/><path d="M30 21v12M24 27h12" stroke="#6B635A" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  rack4: `<svg viewBox="0 0 56 56"><rect x="6" y="12" width="44" height="32" rx="6" fill="#C9AA7C"/>${['#B9473A', '#34588E', '#D6A92E', '#5F8A3A'].map((c, i) => spoolIcon(13 + i * 10, c, 0.6)).join('')}</svg>`,
  tuck: `<svg viewBox="0 0 56 56">${yarnIcon('M4 40C16 34 24 30 31 28', '#D6A92E')}${yarnIcon('M30 4C26 20 28 36 34 52', '#34588E')}<path d="M37 27l5-2M37 29l6 1M36 31l4 3" stroke="#B48A1E" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  peg: `<svg viewBox="0 0 56 56">${yarnIcon('M4 44C14 40 22 34 24 28A6.5 6.5 0 1 1 34 32C38 40 46 44 52 46', '#5F8A3A')}<circle cx="29" cy="27" r="5.5" fill="#C99A5E" stroke="#8E6A42" stroke-width="1"/><circle cx="29" cy="27" r="3.6" fill="none" stroke="#B9473A" stroke-width="2.2"/></svg>`,
  snarl3: `<svg viewBox="0 0 56 56">${yarnIcon('M8 40C18 12 34 10 46 26', '#B9473A', 6)}${yarnIcon('M44 14C40 40 22 48 10 34', '#34588E', 6)}${yarnIcon('M16 14C32 18 48 28 40 48', '#D6A92E', 6)}<circle cx="28" cy="29" r="23" fill="none" stroke="#F2BE46" stroke-width="2" stroke-dasharray="3 4" opacity=".8"/></svg>`,
  rack3: `<svg viewBox="0 0 56 56"><rect x="11" y="12" width="34" height="32" rx="6" fill="#C9AA7C"/>${['#B9473A', '#34588E', '#D6A92E'].map((c, i) => spoolIcon(18 + i * 10, c, 0.6)).join('')}</svg>`,
};
let introFresh = [];
function maybeIntro() {
  const seen = (S().tangle && S().tangle.seenIntro) || {};
  const fresh = L.mechanics.filter((m) => !seen[m] && MECHANICS[m]);
  if (!fresh.length) return;
  introFresh = fresh;
  $('#tb-introTitle').textContent = fresh.length > 1 ? 'Some new things in the basket' : 'Something new in the basket';
  $('#tb-introBody').innerHTML = fresh.map((m) => `<div class="tb-item">${ICON[m] || ''}<p><strong>${esc(MECHANICS[m].name)}</strong>${esc(MECHANICS[m].line)}</p></div>`).join('');
  openSheet('#tb-introSheet');
}

// How this works: three short steps.
const ILL = {
  pull: `<svg class="tb-ill" viewBox="0 0 320 130" aria-hidden="true">
    <rect x="4" y="4" width="312" height="122" rx="16" fill="#ECE2CC"/>
    ${yarnIcon('M30 100C80 30 140 110 190 50', '#34588E', 16)}
    <path d="M38 108C92 44 146 116 202 60" fill="none" stroke="rgba(60,40,20,.16)" stroke-width="18" stroke-linecap="round"/>
    ${yarnIcon('M40 30C110 60 150 20 240 70', '#B9473A', 16)}
    <path d="M250 74 C 272 84 286 74 294 52" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
    <path d="M286 56l8-6 2 10" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  spools: `<svg class="tb-ill" viewBox="0 0 320 110" aria-hidden="true">
    <rect x="10" y="20" width="200" height="74" rx="12" fill="#C9AA7C"/>
    ${[['#B9473A', 2], ['#34588E', 1], ['#5F8A3A', 0]].map(([c, n], i) => `<g transform="translate(${30 + i * 62},28)"><rect x="0" y="0" width="34" height="7" rx="3.5" fill="#B38A57"/><rect x="0" y="50" width="34" height="7" rx="3.5" fill="#B38A57"/><rect x="${12 - n * 5}" y="7" width="${10 + n * 10}" height="43" rx="4" fill="${n ? c : '#D6B888'}"/><text x="17" y="72" text-anchor="middle" font-size="11" font-family="Figtree, sans-serif" fill="#4A3A26">${n ? `${3 - n} more` : 'empty'}</text></g>`).join('')}
    <g transform="translate(232,34) scale(1.1)">${skeinSVG('m', '#B9473A').replace('<svg viewBox="0 0 66 40" aria-hidden="true">', '').replace('</svg>', '')}</g>
    <path d="M206 50 C 216 40 222 40 230 46" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 6"/>
  </svg>`,
  plan: `<svg class="tb-ill" viewBox="0 0 320 120" aria-hidden="true">
    <rect x="10" y="10" width="300" height="56" rx="12" fill="#C9AA7C"/>
    ${['#B9473A', '#34588E', '#D6A92E', '#5F8A3A', '#B8467A'].map((c, i) => `<g transform="translate(${26 + i * 58},16)"><rect x="0" y="0" width="28" height="6" rx="3" fill="#B38A57"/><rect x="0" y="38" width="28" height="6" rx="3" fill="#B38A57"/><rect x="7" y="6" width="14" height="32" rx="3" fill="${c}"/></g>`).join('')}
    ${yarnIcon('M30 100C80 80 120 112 170 92', '#674A8C', 12)}
    ${yarnIcon('M190 104C230 86 260 112 300 92', '#34588E', 12)}
    <path d="M245 84 C 236 76 236 72 236 66" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 6"/>
  </svg>`,
};
const HOW = [
  { t: 'Pull a free strand', ill: 'pull', p: 'Strands that sit raised have nothing lying on top of them. Tap one anywhere along its length, and it slides out along its own path and winds onto a spool. A strand that is still covered just gives a little wiggle, and whatever lies on it glows.' },
  { t: 'Spools by color', ill: 'spools', p: 'A strand winds onto the spool of its color if one is on the rack, or starts a new spool in an empty slot. Three strands fill a spool, and it pops off as a finished skein.' },
  { t: 'Plan the rack', ill: 'plan', p: 'When every slot holds a spool, only colors already on the rack can come out, so choose your order with care. Undo is free, Hint is always there, and if you get stuck you can take one spare slot per basket. No timers, and no way to lose.' },
];
function renderHow() {
  const st = HOW[howStep];
  $('#tb-howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#tb-howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'tb-on' : ''}"></i>`).join('');
  $('#tb-howBack').disabled = howStep === 0;
  $('#tb-howNext').textContent = howStep === HOW.length - 1 ? 'Start untangling' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#tb-howSheet'); }

// ---------- markup ----------
function lockedSkeleton() {
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Tangle Basket</div><div class="subtitle">Yarn untangled, strand by strand</div></div><div class="spacer"></div></div>
<div class="screen-body"><div class="tb-closed"><div class="card" style="padding:16px;gap:10px">
<div class="h3">The basket is waiting</div>
<p class="hint">A heap of yarn waits to be untangled. Pull a strand with nothing on top, wind it onto a spool, and plan which colors go first. Each basket you untangle pays coins.</p>
<div data-lock>${unlockTag(C, 'tangle', { cls: 'pz-tag' })}</div></div></div></div>`);
  built = false;
}

function skeleton() {
  const btn = (id, label, attrs = '', variant = 'btn-paper') => `<button type="button" class="btn ${variant} small" data-tap id="${id}"${attrs}>${label}</button>`;
  const how = C.guide && C.guide.howThisWorksHtml ? String(C.guide.howThisWorksHtml('tangle', 'Show me in the basket')) : '';
  ROOT.innerHTML = `<div class="screen-head tb-head">${String(backButton('Back to the puzzle table'))}
<button type="button" class="btn btn-paper small tb-levelbtn" data-tap id="tb-levelsBtn" aria-haspopup="dialog"><span class="tb-no" id="tb-lvNo">1/${LEVELS.length}</span><span class="tb-nm" id="tb-lvName"></span><span class="tb-chev" aria-hidden="true">&#9662;</span></button>
<button type="button" class="btn btn-paper small tb-tog" data-tap id="tb-howBtn" aria-haspopup="dialog" aria-label="How this works">?</button>
</div>
<div class="screen-body tb-app" id="tb-app">
<div class="tb-shelfrow"><span id="tb-shelfCount">Skeins <b>0</b></span><div id="tb-shelf" aria-hidden="true"></div></div>
<section class="tb-rack" id="tb-rack" aria-label="The spool rack" data-coach="tangle-rack"></section>
<section class="tb-basketwrap" aria-label="The yarn heap">
<div class="tb-basket" id="tb-basket" data-coach="tangle-heap">
<div class="tb-heapwrap" id="tb-heapWrap"><canvas id="tb-heapBack" aria-hidden="true"></canvas><canvas id="tb-heap" role="img" aria-label="A heap of yarn strands"></canvas></div>
<button type="button" class="tb-fitbtn" data-tap id="tb-fitBtn" hidden>Fit</button>
</div>
</section>
<div class="tb-sr" id="tb-srList" aria-label="Strands you can reach"></div>
<div class="tb-msgrow" data-coach="tangle-msg">
<p id="tb-msg" role="status" aria-live="polite"></p>
<span class="tb-btns">
${btn('tb-stuckBtn', 'Add a spare slot', ' hidden', 'btn-primary')}
${btn('tb-hintBtn', 'Hint')}
${btn('tb-undoBtn', 'Undo')}
</span>
</div>
</div>
<canvas id="tb-fly" aria-hidden="true"></canvas>

<div class="tb-sheet" id="tb-levelSheet" role="dialog" aria-modal="true" aria-labelledby="tb-lvTitle" hidden>
<div class="tb-panel">
<button type="button" class="tb-iconbtn tb-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="tb-lvTitle">Baskets</h2>
<p class="hint" id="tb-lvHint" style="margin:0"></p>
${btn('tb-continueBtn', 'Continue', '', 'btn-primary').replace('class="btn btn-primary small"', 'class="btn btn-primary small tb-continue"')}
<div class="tb-settings">
${btn('tb-restartBtn', 'Start this basket over')}
${btn('tb-howBtn2', 'How this works')}
${btn('tb-glyphBtn', 'Color symbols: off', ' aria-pressed="false"')}
${btn('tb-soundBtn', 'Soft sounds: on', ' aria-pressed="true"')}
</div>
<div id="tb-lvList"></div>
</div></div>

<div class="tb-sheet" id="tb-howSheet" role="dialog" aria-modal="true" aria-labelledby="tb-howTitle" hidden>
<div class="tb-panel tb-how">
<button type="button" class="tb-iconbtn tb-x" data-tap data-close aria-label="Close">&#10005;</button>
<h2 id="tb-howTitle">How this works</h2>
<div id="tb-howBody"></div>
<div class="tb-steps" id="tb-howDots"></div>
<div class="tb-row2">${btn('tb-howBack', 'Back')}${btn('tb-howNext', 'Next', '', 'btn-primary')}</div>
${how}
</div></div>

<div class="tb-sheet" id="tb-introSheet" role="dialog" aria-modal="true" aria-labelledby="tb-introTitle" hidden>
<div class="tb-panel tb-intro">
<h2 id="tb-introTitle">Something new in the basket</h2>
<div id="tb-introBody"></div>
<button type="button" class="btn btn-primary" data-tap id="tb-introOk" style="width:100%;margin-top:8px">Lovely, let's untangle</button>
</div></div>

<div class="tb-sheet" id="tb-finishSheet" role="dialog" aria-modal="true" aria-labelledby="tb-finTitle" hidden>
<div class="tb-panel tb-finish">
<h2 id="tb-finTitle">All untangled</h2>
<p class="muted" id="tb-finSub" style="margin:0"></p>
<div class="tb-bigshelf" id="tb-finShelf"></div>
<p class="tb-knits" id="tb-finKnits"></p>
<p class="hint" id="tb-finYards" style="margin:0 0 6px"></p>
<div class="tb-reward" id="tb-finReward" aria-live="polite" hidden></div>
${btn('tb-finNext', 'Next basket', '', 'btn-primary')}
${btn('tb-finAgain', 'Untangle this one again')}
${btn('tb-finAll', 'All baskets')}
</div></div>`;
  bindHeap($('#tb-heap'));
  built = true;
}

// ---------- wiring (one delegated listener) ----------
let restartArmed = 0;
function onClick(e) {
  if (!ROOT || !e.target || !e.target.closest) return;
  const t = e.target;
  const unlockBtn = t.closest('[data-action="unlock-open"]');
  if (unlockBtn && ROOT.contains(unlockBtn)) { ensureWorkshopStyles(); openUnlockSheet(C, 'tangle', { host: ROOT }); return; }
  if (!built) return;
  // sheets: the backdrop or a close button
  const sh = t.closest('.tb-sheet');
  if (sh && (t === sh || t.closest('[data-close]'))) { if (sh.id !== 'tb-introSheet') closeSheet(sh); return; }
  if (t.closest('[data-guide-replay]')) { closeAllSheets(); return; }
  const sr = t.closest('#tb-srList [data-strand]');
  if (sr) { act(+sr.dataset.strand, null); return; }
  const lv = t.closest('#tb-lvList [data-level]');
  if (lv) {
    if (lv.classList.contains('tb-locked')) {
      const i = LEVELS.findIndex((x) => x.id === lv.dataset.level);
      listHint = `Basket ${i + 1} opens once basket ${i} is untangled.`;
      $('#tb-lvHint').textContent = listHint;
      listHint = '';
      return;
    }
    closeSheet($('#tb-levelSheet'));
    if (lv.dataset.level !== L.id) startLevel(lv.dataset.level);
    return;
  }
  const id = (t.closest('button[id]') || {}).id || '';
  switch (id) {
    case 'tb-undoBtn': doUndo(); return;
    case 'tb-stuckBtn': doSpare(); return;
    case 'tb-hintBtn': doHint(); return;
    case 'tb-fitBtn': fitTapped(); return;
    case 'tb-levelsBtn': if (!busy) openLevels(); return;
    case 'tb-howBtn': if (!busy) openHow(); return;
    case 'tb-howBtn2': closeSheet($('#tb-levelSheet')); openHow(); return;
    case 'tb-continueBtn': { const nx = $('#tb-continueBtn').dataset.level; closeSheet($('#tb-levelSheet')); if (nx && nx !== L.id) startLevel(nx); return; }
    case 'tb-glyphBtn':
      C.game.act(TS().setSetting, { key: 'glyphs', value: !glyphsOn() });
      buildSprites(HP.kr0); planRaster(); render(); kick();
      return;
    case 'tb-soundBtn': C.game.act(TS().setSetting, { key: 'sound', value: !set().sound }); renderToggles(); sfx('pop'); return;
    case 'tb-howBack': if (howStep > 0) { howStep--; renderHow(); } return;
    case 'tb-howNext':
      if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
      closeSheet($('#tb-howSheet'));
      return;
    case 'tb-introOk': C.game.act(TS().seeIntro, { mechanics: introFresh }); closeSheet($('#tb-introSheet')); return;
    case 'tb-restartBtn':
      if (!restartArmed && G && G.state.moves > 0 && !isDone(G.state)) {
        restartArmed = setTimeout(() => { restartArmed = 0; const b = $('#tb-restartBtn'); if (b) b.textContent = 'Start this basket over'; }, 3000);
        $('#tb-restartBtn').textContent = 'Tap again to start over';
        return;
      }
      clearTimeout(restartArmed); restartArmed = 0;
      closeSheet($('#tb-levelSheet'));
      restart();
      return;
    case 'tb-finNext': { const nx = $('#tb-finNext').dataset.level || L.id; closeSheet($('#tb-finishSheet')); startLevel(nx, { fresh: true }); return; }
    case 'tb-finAgain': closeSheet($('#tb-finishSheet')); startLevel(L.id, { fresh: true }); return;
    case 'tb-finAll': closeSheet($('#tb-finishSheet')); openLevels(); return;
    default: break;
  }
}

function onKey(e) {
  if (!visible || e.key !== 'Escape') return;
  for (const sh of $$('.tb-sheet')) if (!sh.hidden && sh.id !== 'tb-introSheet') closeSheet(sh);
}

let rz = 0;
function onResize() {
  if (!visible || !built) return;
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (L && G && !busy && visible) { const v = HP.view; sizeHeap(); HP.view = clampView(HP.fit, L.board, v); setK(); HP.cacheFull = true; HP.full = true; planRaster(); render(); }
  }, 120);
}
function onVisibility() { if (document.hidden && busy) skipAll(); }

// ---------- the guide ----------
function coachSteps() {
  const pulled = (st) => !!(st && st.tangle && st.tangle.game && st.tangle.game.moves.length > 0);
  return [
    { anchor: '[data-coach="tangle-heap"]', text: 'Tap a raised strand: nothing lies on top of it.', endsOn: 'action', done: pulled },
    { anchor: '[data-coach="tangle-rack"]', text: 'It winds onto a spool. Three of a color make a skein.', endsOn: 'got-it', side: 'below' },
    { anchor: '[data-coach="tangle-msg"]', text: 'Hint and Undo are always free, and there is no way to lose.', endsOn: 'got-it', side: 'above' },
  ];
}

// ---------- the Puzzles hub card ----------
/** A small picture of a basket from its control points (strands already pulled are left out). */
function thumbSvg(id, out) {
  const Lv = levelById(id);
  if (!Lv) return '';
  const hexes = yarnHexes();
  const hx = (key) => hexes[key];
  let paths = '';
  ctrlOf(id).forEach((s, i) => {
    if (out && out[i]) return;
    const p = s.pts;
    let d = `M${p[0][0]} ${p[0][1]}`;
    for (let q = 1; q < p.length - 1; q++) d += `Q${p[q][0]} ${p[q][1]} ${(p[q][0] + p[q + 1][0]) / 2} ${(p[q][1] + p[q + 1][1]) / 2}`;
    d += `L${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
    const base = hx(s.c);
    paths += `<path d="${d}" fill="none" stroke="${toneOf(base).edge}" stroke-width="${W * 0.95}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${s.q ? HIDDEN_HEX : base}" stroke-width="${W * 0.7}" stroke-linecap="round"/>`;
  });
  return `<svg viewBox="0 0 ${Lv.board.w} ${Lv.board.h}" aria-hidden="true">${paths}</svg>`;
}

/** The Puzzles hub card (ui/puzzles.js): the basket on the table at a glance, or the price tag. */
export function tangleCardHtml(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.tangle) return '';
  if (!C) C = ctx;
  injectCss();
  const sum = ctx.sim.tangle.summary(state);
  if (!sum.open) {
    return h`<div class="card tb-card" id="pz-tangle" data-coach="tangle-card">
<div class="h3">Tangle Basket</div>
<div class="hint">A heap of yarn to untangle, one free strand at a time, wound onto spools in your own colors.</div>
<div class="pz-tiertag">${unlockTag(ctx, 'tangle', { cls: 'pz-tag' })}</div>
</div>`;
  }
  let line;
  if (sum.cleared) line = `${sum.name} is untangled. The next basket is ready when you are.`;
  else if (sum.playing) line = `Basket ${sum.index + 1} of ${sum.total} · ${sum.name} · ${plural(sum.left, 'strand', 'strands')} to go`;
  else line = `Basket ${sum.index + 1} of ${sum.total} · ${sum.name}. ${sum.chapter}: pull free strands, no timers.`;
  const stats2 = sum.done ? `${plural(sum.done, 'basket', 'baskets')} untangled` : '';
  const rest = restBits(ctx, state, 'tangle');
  return h`<div class="card tb-card" id="pz-tangle" data-coach="tangle-card">
<div class="row between"><div class="h3">Tangle Basket</div>${stats2 ? h`<span class="chip">${stats2}</span>` : ''}</div>
<div class="tb-cardrow"><span class="tb-thumb">${raw(thumbSvg(sum.levelId, sum.out))}</span><div class="hint grow">${line}</div></div>
${rest.block || button(sum.playing ? 'Continue untangling' : 'Go to the basket', { variant: 'primary', block: true, attrs: { 'data-action': 'open-tangle' } })}
${rest.line}
</div>`;
}

/** What the hub card depends on (ui/puzzles.js redraws when it changes). */
export function tangleCardSig(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.tangle) return 0;
  const u = ctx.sim.unlocks.status(state, 'tangle');
  const t = state.tangle;
  const g = t && t.game;
  return [u && u.revealed, u && u.affordable, u && u.open, t && t.cur, g ? g.moves.length : -1, t ? Object.keys(t.done || {}).length : 0];
}

// ---------- screen ----------
/** debugTangle() -> reads and a few levers for tests (test/tangle.e2e.mjs); the prototype's window.__tangle. */
export function debugTangle() {
  return {
    get busy() { return busy; }, get visible() { return visible; }, get level() { return L ? L.id : null; }, get state() { return G ? G.state : null; },
    get hinted() { return hinted; }, get note() { return note; }, get stats() { return { ...stats }; }, get view() { return { ...HP.view }; }, get gesturing() { return GEST.active; },
    get perf() { return { frames: PERF.frames, dyn: HP.dyn.length, heap: PERF.heap.slice(), fly: PERF.fly.slice(), gesture: PERF.gesture.slice(), rasterLeft: HP.rasterQ.length }; },
    get glowing() { return HP.glowUntil.map((t, i) => (t > performance.now() ? i : -1)).filter((i) => i >= 0); },
    get tapped() { return HP.tapUntil > performance.now() ? HP.tapped.slice() : []; },
    get spriteMB() { let px = 0; for (const s of HP.spr) for (const k of ['flat', 'shadow', 'grayFlat', 'glow', 'tap']) if (s && s[k]) px += s[k].width * s[k].height; for (const p of HP.patches.values()) px += p.c.width * p.c.height; return (px * 4) / 1e6; },
    get yarns() { return { ...YARN }; },
    resetPerf() { PERF.heap.length = 0; PERF.fly.length = 0; PERF.gesture.length = 0; },
    setView(v) { settleView(v); },
    // the page point of a strand's most open spot inside the window (for taps from a test)
    pointOf(i) {
      if (!L || !L.poly[i]) return null;
      const r = $('#tb-heapWrap').getBoundingClientRect(), s = G.state, v = HP.view;
      let best = null, bs = -1;
      L.poly[i].forEach((p, k) => {
        if (k % 2) return;
        const q = toScreen(HP.fit, v, p[0], p[1]);
        if (q[0] < 8 || q[1] < 8 || q[0] > HP.fit.w - 8 || q[1] > HP.fit.h - 8) return;
        let clear = Infinity;
        for (let j = 0; j < L.n; j++) if (j !== i && !s.out[j]) clear = Math.min(clear, nearDist(p, L.poly[j], L.grids[j]) + (j < i ? 0.01 : 0));
        if (clear > bs) { bs = clear; best = q; }
      });
      return best ? { x: r.left + best[0], y: r.top + best[1] } : null;
    },
    strandAt(x, y) { const r = $('#tb-heapWrap').getBoundingClientRect(); return strandAt(x - r.left, y - r.top); },
    // time the heap painter: a full cache rebuild, and an ordinary frame (ms)
    bench(n = 10) {
      const t0 = performance.now();
      for (let k = 0; k < n; k++) { HP.cacheFull = true; HP.full = true; drawHeap(performance.now()); }
      const t1 = performance.now();
      for (let k = 0; k < n; k++) { HP.full = true; drawHeap(performance.now()); }
      const t2 = performance.now();
      return { rebuild: (t1 - t0) / n, frame: (t2 - t1) / n, dyn: HP.dyn.length, strands: L.n - G.state.out.reduce((a, x) => a + x, 0) };
    },
    rasterBench(q = 1, n = 6) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) rasterStrand(i, HP.kr0 * q);
      const t = (performance.now() - t0) / n;
      for (let i = 0; i < n; i++) rasterStrand(i, HP.kr0);
      HP.cacheFull = true; kick();
      return t;
    },
  };
}

function unlocked() {
  try { return !!TS().unlocked(S()); } catch { return false; }
}

export default {
  id: 'tangle',

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
    if (typeof document !== 'undefined') SPOT = spotSprite();
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) guideApi = C.guide('tangle', coachSteps(), { screen: 'tangle' });
    // Bought somewhere else (the workshop's Next): offer the way in (two equal choices; nothing navigates by itself).
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'tangle'); };
        if (!p || p.id !== 'tangle' || visible || here()) return;
        setTimeout(() => {
          if (visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Tangle Basket is open',
            body: 'A heap of yarn is waiting, ready to be pulled free and wound onto spools.',
            more: { label: 'Later' },
            next: { label: 'Go to the basket', run: () => C.navigate('tangle') },
          });
        }, 300);
      });
    }
  },

  show(params = {}) {
    visible = true;
    gen += 1;
    busy = false; skip = false; queuedTap = null; finishing = false;
    if (!unlocked()) { lockedSkeleton(); return; }
    C.game.act(TS().ensureTangle);
    skeleton();
    const want = params && typeof params.levelId === 'string' ? params.levelId : S().tangle.cur;
    startLevel(want);
    if (G && isDone(G.state)) openFinish();
    if (guideApi) guideApi.start();
  },

  hide() {
    visible = false;
    gen += 1;
    busy = false; skip = false; queuedTap = null; finishing = false;
    for (const f of [...skipWaiters]) f();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    clearTimeout(HP.backT);
    showFly(false);
    for (const el of $$('.tb-flying')) el.remove();
    if (ROOT) closeAllSheets();
    clearTimeout(restartArmed); restartArmed = 0;
    GEST.ptrs.clear(); GEST.active = false; GEST.mode = null;
    // Let the bitmaps go (a deep basket holds tens of MB of them); they are rebuilt on show.
    freeSprites();
    if (HP.cache) { freeCanvas(HP.cache); HP.cache = null; }
    HP.ctx = null;
    if (guideApi) guideApi.stop();
  },

  render(state) {
    if (!ROOT || !visible) return;
    if (!built) { if (unlocked()) this.show(); return; }
    if (busy) return;
    // A game changed under the basket (an imported save, a reset): pick it up again.
    if (state.tangle && sigOfGame() !== lastSig) startLevel(state.tangle.cur);
  },
};
