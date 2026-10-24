// The Hoop: UI, rendering and animation. Rules live in rules.js (pure); the
// picture of the words lives in layout.js (pure).
//
// One canvas holds the hoop. The wood, the linen and the pegs are painted
// once per layout into a bitmap; the strands at rest are painted on top of
// that into a cached bitmap; each frame repaints only what moves (springs,
// a carried knot, a glow) and the crossings it is part of.
// Over and under is drawn per crossing, never by stacking whole strands: the
// strands go down in a base order, and every crossing the base order gets
// wrong is patched: inside a small disk the linen and every strand near it
// are repainted in the order that crossing (and any crossing beside it)
// demands. A clasp, which no stacking can draw, is two patches.
// A carried end rises above everything only past its nearest crossing: every
// crossing it already has keeps its over and under, all the way through the
// retie.
// The yarn painting (ply grooves, sheen, shade, soft shadow) follows the
// Tangle Basket's approach.
import {
  COLORS, newGame, play, undo, canLift, whyNotTo, targets, endsAt, isDone, remaining, movers, hint, totalCrossings, yarnLine, VERSION,
  newState, nearestAt, wordsError, hookedPairs,
} from './rules.js';
import { layout, plan, distTo, baseOrder, topAt } from './layout.js';
import { LEVELS, MECHANICS, BANDS, levelById } from './levels.js';

const KEY = 'tincture.proto.hoop';
const HISTORY_SAVED = 300; // undo is unlimited in a session; the save keeps the last 300 steps
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = { t: -1e9, v: false };
const reduced = () => { const t = performance.now(); if (t - RM.t > 500) { RM.t = t; RM.v = matchMedia('(prefers-reduced-motion: reduce)').matches; } return RM.v; };
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 1);
const ease = (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const TAU = Math.PI * 2;

// ---------- color ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toneOf = (hex) => ({ base: hex, edge: mixHex(hex, '#24160A', 0.36), light: mixHex(hex, '#FFF6E4', 0.35), ink: lum(hex) > 0.28 ? 'rgba(42,30,20,.85)' : 'rgba(255,250,238,.95)' });
const TONE = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toneOf(c.hex)]));
const cshort = (c) => COLORS[c].short;

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
function skeinSVG(c) {
  const col = COLORS[c].hex;
  return `<svg viewBox="0 0 66 40" aria-hidden="true">
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="${col}"/>
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
  ctx.save();
  ctx.translate(w * 0.16 * k, w * 0.28 * k);
  ctx.strokeStyle = `rgba(60,40,20,${0.24 + 0.04 * lift})`; ctx.lineWidth = w * 1.38; ctx.stroke(g.path);
  ctx.restore();
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

// ---------- save ----------
let data = { v: 1, cur: LEVELS[0].id, done: {}, star: {}, glyphs: false, sound: false, seenHow: false, seenIntro: {}, game: null };
function save() {
  try {
    const g = G ? { level: L.id, sig: L.sig, state: G.state, past: G.past.slice(-HISTORY_SAVED) } : null;
    localStorage.setItem(KEY, JSON.stringify({ ...data, cur: L ? L.id : data.cur, game: g }));
  } catch { /* storage may be blocked; play goes on */ }
}
function validState(Lv, s) {
  if (!s || s.v !== VERSION || s.level !== Lv.id || !Array.isArray(s.ends) || s.ends.length !== 2 * Lv.S) return false;
  if (!Array.isArray(s.out) || s.out.length !== Lv.S) return false;
  if (!Number.isInteger(s.moves) || s.moves < 0) return false;
  const at = new Map();
  for (let e = 0; e < 2 * Lv.S; e++) {
    const p = s.ends[e], gone = !!s.out[e >> 1];
    if (gone ? p !== -1 : !(Number.isInteger(p) && p >= 0 && p < Lv.n)) return false;
    if (gone) continue;
    if (Lv.fixed[e] && p !== Lv.start[e]) return false;
    if (Lv.link[e] >= 0 && s.ends[Lv.link[e]] !== p) return false;
    if (at.has(p) && Lv.link[e] !== at.get(p)) return false;
    at.set(p, e);
  }
  try { return !wordsError(Lv, s.ends, s.w, s.x) && s.w.every((ws, i) => !s.out[i] || !ws.length); } catch { return false; }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === 'object' && o.v === 1) {
      const clean = (m) => { const r = {}; if (m && typeof m === 'object') for (const id of Object.keys(m)) if (levelById(id) && m[id]) r[id] = true; return r; };
      data = {
        ...data, cur: typeof o.cur === 'string' ? o.cur : data.cur, done: clean(o.done), star: clean(o.star),
        glyphs: !!o.glyphs, sound: !!o.sound, seenHow: !!o.seenHow,
        seenIntro: o.seenIntro && typeof o.seenIntro === 'object' ? o.seenIntro : {},
        game: o.game && typeof o.game === 'object' ? o.game : null,
      };
    }
  } catch { /* a fresh start */ }
  if (!levelById(data.cur)) data.cur = LEVELS[0].id;
}

// ---------- state ----------
let L = null, G = null, busy = false, skip = false, note = '', howStep = 0;
let held = -1;          // the end whose knot is lifted (tap, then tap a peg)
let drag = null;        // { e, pt, over, touch } while a knot follows a finger
let view = null;        // what the hoop shows during a move: { state, carry?, morph? }
let tangled = false;
const shelfHold = new Set(); // freed strands whose skein hasn't reached the shelf yet
const skipWaiters = new Set();
const stats = { moves: 0, undos: 0, hints: 0, blocked: 0, drags: 0 };

function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  for (const a of document.getAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
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
  busy = true; skip = false;
  render();
  try { await fn(); } catch (e) { console.error('The Hoop: an animation was cut short', e); } finally {
    busy = false; skip = false;
    view = null; FX.slide = null; FX.leaving = []; FX.tug = null; shelfHold.clear();
    for (const el of $$('.flying')) el.remove();
    render();
    kick();
    if (undoAfter) { undoAfter = false; doUndo(); } else afterMove();
  }
}

// ---------- layout ----------
const HG = { cv: null, ctx: null, bg: null, dpr: 1, css: 300, cx: 150, cy: 150, Rout: 140, Rin: 124, Rk: 132, pr: 6, w: 9, ang: [], peg: [] };
function sizeHoop() {
  const app = $('#app');
  const vw = document.documentElement.clientWidth;
  const availW = Math.min(vw, 480) - 24;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.id === 'hoopwrap' || ch.classList.contains('sr') || ch.classList.contains('grow') || ch.hidden) continue;
    used += ch.id === 'msg' ? Math.max(ch.offsetHeight, 58) : ch.offsetHeight; n++;
  }
  used += n * 6 + 16;
  const availH = innerHeight - used;
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
  const cv = $('#hoop');
  HG.cv = cv; HG.ctx = cv.getContext('2d');
  cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr);
  cv.style.width = `${css}px`; cv.style.height = `${css}px`;
  buildBg();
  CACHE.cv = document.createElement('canvas');
  CACHE.cv.width = cv.width; CACHE.cv.height = cv.height;
  CACHE.ctx = CACHE.cv.getContext('2d');
  CACHE.sig = '';
  PX.clear();
  kick();
}
// Strands at rest live in a cached bitmap with the hoop; each frame redraws
// only what moves and the crossings it takes part in.
const CACHE = { cv: null, ctx: null, sig: '' };

function hash(a, b) { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// The still parts: the linen in the hoop, the wooden ring, the brass screw, the pegs.
function buildBg() {
  const c = document.createElement('canvas');
  c.width = HG.cv.width; c.height = HG.cv.height;
  const x = c.getContext('2d');
  x.scale(HG.dpr, HG.dpr);
  const { cx, cy, Rout, Rin } = HG;
  // soft shadow of the hoop on the table
  x.save();
  x.fillStyle = 'rgba(70,50,25,.16)';
  x.beginPath(); x.arc(cx + 2, cy + 5, Rout + 2, 0, TAU); x.fill();
  x.restore();
  // linen, stretched taut
  x.save();
  x.beginPath(); x.arc(cx, cy, Rin + 1, 0, TAU); x.clip();
  x.fillStyle = '#EFE6D2'; x.fillRect(0, 0, HG.css, HG.css);
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
    if (pc) { g.addColorStop(0, TONE[pc].light); g.addColorStop(0.6, COLORS[pc].hex); g.addColorStop(1, TONE[pc].edge); } else { g.addColorStop(0, '#F2DDB4'); g.addColorStop(0.65, '#C9A06A'); g.addColorStop(1, '#94703F'); }
    x.fillStyle = g; x.beginPath(); x.arc(px, py, HG.pr, 0, TAU); x.fill();
    if (pc) {
      // a painted peg wears a thin cream ring so it reads as paint, not yarn
      x.strokeStyle = 'rgba(255,248,230,.85)'; x.lineWidth = 1.2; x.beginPath(); x.arc(px, py, HG.pr + 1.4, 0, TAU); x.stroke();
      if (data.glyphs) drawGlyph(x, glyphOf(pc), px, py, HG.pr * 1.25, TONE[pc].ink);
    }
  }
  HG.bg = c;
}

// ---------- strand shapes ----------
// layout.js places every strand in the unit disk (knots at radius 1); here it
// is scaled to the hoop. One layout per state, kept while the state lives.
const toPx = ([x, y]) => [HG.cx + x * HG.Rk, HG.cy + y * HG.Rk];
const LAY = new WeakMap();
function layOf(s) {
  let r = LAY.get(s);
  if (!r) { r = layout(L, s); LAY.set(s, r); }
  return r;
}
// The layout in css px (cached per layout and hoop size).
const PX = new Map();
function pxOf(s) {
  const lay = layOf(s);
  let r = PX.get(lay);
  if (!r) {
    const strands = {};
    for (const [i, pts] of Object.entries(lay.strands)) strands[i] = pts.map(toPx);
    const crossings = lay.crossings.map((X) => ({ ...X, p: toPx(X.p) }));
    r = { strands, crossings, geom: {} };
    if (PX.size > 60) PX.clear();
    PX.set(lay, r);
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
    const from = e & 1 ? k : 0, to = e & 1 ? n - 1 : k; // indices to replace (inclusive of the end)
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
  const S = L.S;
  FX.lift = Array(S).fill(0); FX.liftV = Array(S).fill(0);
  FX.glowUntil = Array(S).fill(0); FX.glow = Array(S).fill(0); FX.alpha = Array(S).fill(1);
  FX.slide = null; FX.tug = null; FX.leaving = []; FX.wig = null; FX.pegShake = null; FX.hint = null;
}
const curState = () => (view ? view.state : G.state);

// ---------- drawing ----------
const PERF = { frames: 0, draw: [], rebuilds: 0 };
let raf = 0, lastT = 0, heldPulseUntil = 0;
function kick() { if (!raf && L && HG.ctx) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
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
const pulse = (now, t0, until) => (reduced() || now - t0 > until ? 0.85 : 0.55 + 0.45 * Math.cos((now - t0) / 240));

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
  if (view && view.morph) { for (let i = 0; i < L.S; i++) if (!s.out[i]) D.add(i); return D; }
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
// mo: { from: { i: pts }, to: { i: pts }, xb: [crossings after, each with
// its fraction along both strands], t }. The crossings of the new picture
// ride along the morphing yarn at their fractions, so every patch follows
// its crossing and lands exactly on it (no search per frame).
function morphShape(mo) {
  const t = ease(mo.t), curves = {};
  for (const i of Object.keys(mo.to)) {
    const A = mo.from[i], B = mo.to[i];
    curves[i] = A ? A.map((p, k) => [p[0] + (B[k][0] - p[0]) * t, p[1] + (B[k][1] - p[1]) * t]) : B;
  }
  const crossings = mo.xb.map((X) => {
    const ka = Math.round(X.fa * (MORPH_N - 1)), kb = Math.round(X.fb * (MORPH_N - 1));
    const pa = curves[X.a][ka], pb = curves[X.b][kb];
    return { ...X, p: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], ka, kb, r: HG.w * 1.6 };
  });
  return { curves, crossings, P: null };
}
// Where each crossing sits along its two strands, as fractions of arc length.
function fractions(P) {
  const frac = (pts, k) => { let a = 0, b = 0; for (let j = 1; j < pts.length; j++) { const d = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); b += d; if (j <= k) a += d; } return b ? a / b : 0; };
  return P.crossings.map((X) => ({ ...X, fa: frac(P.strands[X.a], X.ka), fb: frac(P.strands[X.b], X.kb) }));
}

function styleOf(i, now) {
  const hintGlow = FX.hint && (FX.hint.end >> 1) === i ? pulse(now, FX.hint.t0, HINT_MS) * 0.8 : 0;
  return { w: HG.w, tone: TONE[L.color[i]], lift: FX.lift[i], glow: Math.max(FX.glow[i], hintGlow), alpha: FX.alpha[i], glyph: data.glyphs ? L.color[i] : null };
}
const restStyle = (i) => ({ w: HG.w, tone: TONE[L.color[i]], glyph: data.glyphs ? L.color[i] : null });
// A patch: the linen and the strands near a crossing, repainted in its order.
// (each strand only where it comes near the disk: a slice, its ply in step)
function paintPatch(c, X, ptsOf, style, fast = false) {
  c.save();
  c.beginPath(); c.arc(X.p[0], X.p[1], X.r, 0, TAU); c.clip();
  c.setTransform(1, 0, 0, 1, 0, 0);
  const d = Math.ceil((X.r + 3) * HG.dpr), cx = X.p[0] * HG.dpr, cy = X.p[1] * HG.dpr;
  c.drawImage(HG.bg, cx - d, cy - d, 2 * d, 2 * d, cx - d, cy - d, 2 * d, 2 * d);
  c.setTransform(HG.dpr, 0, 0, HG.dpr, 0, 0);
  for (const i of X.order) {
    const g = sliceGeom(ptsOf(i), X.p, X.r + 2.2 * HG.w, fast);
    if (g) paintYarn(c, g, { ...style(i), glyph: null, fast });
  }
  c.restore();
}
// The part of a strand within reach of a point, as yarn geometry in step with the whole.
function sliceGeom(pts, p, reach, fast = false) {
  let lo = -1, hi = -1, acc = 0, s0 = 0;
  for (let k = 0; k < pts.length; k++) {
    if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (Math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]) <= reach) { if (lo < 0) { lo = k; s0 = acc; } hi = k; }
  }
  if (lo < 0) return null;
  if (lo > 0) { lo--; s0 -= Math.hypot(pts[lo + 1][0] - pts[lo][0], pts[lo + 1][1] - pts[lo][1]); }
  hi = Math.min(pts.length - 1, hi + 1);
  return fast ? pathGeom(pts.slice(lo, hi + 1)) : yarnGeom(pts.slice(lo, hi + 1), HG.w, s0);
}
function ensureCache(s, D, P, plan0) {
  const sig = `${data.glyphs ? 'g' : ''}|${stateKeyOf(s)}|${[...D].sort().join(',')}|${HG.css}`;
  if (sig === CACHE.sig) return;
  CACHE.sig = sig;
  const c = CACHE.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, CACHE.cv.width, CACHE.cv.height);
  c.drawImage(HG.bg, 0, 0);
  c.setTransform(HG.dpr, 0, 0, HG.dpr, 0, 0);
  for (const i of plan0.rest) paintYarn(c, pxGeom(P, i), restStyle(i));
  for (const X of plan0.restPatches) paintPatch(c, X, (i) => P.strands[i], restStyle);
  PERF.rebuilds++;
}
// a cheap identity for a state (the cache's signature)
const SKEY = new WeakMap();
let skeyN = 0;
const stateKeyOf = (s) => { let k = SKEY.get(s); if (!k) { k = ++skeyN; SKEY.set(s, k); } return k; };
// The rest plan depends only on the state and which strands are live.
let restPlan = { key: '', plan: null };

function draw(now) {
  const c = HG.ctx, s = curState();
  const D = liveSet(s, now);
  const sh = frameShape(s, D);
  const morph = !!(view && view.morph);
  let P0;
  if (!morph) {
    const key = `${stateKeyOf(s)}|${[...D].sort().join(',')}|${HG.css}`;
    if (restPlan.key !== key) {
      const base = baseOrder(Object.keys(sh.P.strands).map(Number), sh.crossings);
      restPlan = { key, base, plan: plan(sh.P.strands, sh.crossings, { w: HG.w, live: D, order: base }) };
    }
    P0 = restPlan.plan;
    ensureCache(s, D, sh.P, P0);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, HG.cv.width, HG.cv.height); // the hoop's edges are see-through: never paint over last frame
  c.drawImage(morph ? HG.bg : CACHE.cv, 0, 0);
  c.setTransform(HG.dpr, 0, 0, HG.dpr, 0, 0);
  // valid pegs for the lifted knot glow softly
  const liftE = drag ? drag.e : held;
  if (liftE >= 0 && !busy) {
    const ts = targets(L, G.state, liftE);
    const a = pulse(now, FX.heldT0, 2400);
    for (const q of ts) {
      const [x, y] = HG.peg[q];
      const over = drag && drag.over === q;
      c.fillStyle = `rgba(242,190,70,${over ? 0.55 : 0.22 * a + 0.08})`;
      c.beginPath(); c.arc(x, y, HG.pr + (over ? 8 : 5), 0, TAU); c.fill();
      c.strokeStyle = `rgba(200,140,30,${over ? 0.95 : 0.45 + 0.4 * a})`; c.lineWidth = over ? 2.5 : 1.8;
      c.beginPath(); c.arc(x, y, HG.pr + (over ? 8 : 5), 0, TAU); c.stroke();
    }
  }
  // the hint's target peg
  if (FX.hint) {
    const a = pulse(now, FX.hint.t0, HINT_MS);
    const [x, y] = HG.peg[FX.hint.to];
    c.fillStyle = `rgba(242,190,70,${0.35 * a})`; c.beginPath(); c.arc(x, y, HG.pr + 9, 0, TAU); c.fill();
    c.strokeStyle = `rgba(190,130,20,${0.5 + 0.45 * a})`; c.lineWidth = 2.2; c.setLineDash([4, 3]);
    c.beginPath(); c.arc(x, y, HG.pr + 9, 0, TAU); c.stroke(); c.setLineDash([]);
  }
  // an invalid peg gives a tiny shake
  if (FX.pegShake) {
    const t = clamp01((now - FX.pegShake.t0) / 400);
    if (t < 1) {
      const [x, y] = HG.peg[FX.pegShake.q];
      c.strokeStyle = `rgba(107,99,90,${0.6 * (1 - t)})`; c.lineWidth = 1.6;
      c.beginPath(); c.arc(x + Math.sin(t * 30) * 2 * (1 - t), y, HG.pr + 4, 0, TAU); c.stroke();
    } else FX.pegShake = null;
  }
  // live strands, then every crossing they take part in that needs a patch
  const live = morph ? new Set(Object.keys(sh.curves).map(Number)) : D;
  const LP = morph
    ? plan(sh.curves, sh.crossings, { w: HG.w, live })
    : plan(sh.curves, sh.crossings, { w: HG.w, live, order: restPlan.base, liveOnly: true });
  const geo = {};
  const geomOf = (i) => geo[i] || (geo[i] = morph ? pathGeom(sh.curves[i]) : sh.curves[i] === sh.P.strands[i] ? pxGeom(sh.P, i) : yarnGeom(sh.curves[i], HG.w));
  const st = (i) => ({ ...styleOf(i, now), fast: morph });
  for (const i of LP.live) paintYarn(c, geomOf(i), st(i));
  for (const X of LP.livePatches) paintPatch(c, X, (i) => sh.curves[i], st, morph);
  LAST.curves = sh.curves; LAST.plan = LP; LAST.restPlan = P0; LAST.crossings = sh.crossings;
  // strands coming free
  for (const f of FX.leaving) drawLeaving(c, f, now);
  // knots on top of everything, so they are always there to tap
  const doneLink = new Set();
  for (let i = 0; i < L.S; i++) {
    if (s.out[i]) continue;
    for (const e of [2 * i, 2 * i + 1]) {
      if (doneLink.has(e)) continue;
      const lk = L.link[e];
      if (lk >= 0) doneLink.add(lk);
      const K = knotAt(e, s, now);
      const hintK = FX.hint && (FX.hint.end === e || FX.hint.end === lk) ? pulse(now, FX.hint.t0, HINT_MS) : 0;
      let scale = 1 + 0.32 * K.up;
      if (FX.tug && movers(L, FX.tug.e).includes(e)) {
        const t = clamp01((now - FX.tug.t0) / 240);
        scale = t < 0.4 ? 1.32 - (0.5 * t) / 0.4 : 0.82 + 0.18 * easeOut((t - 0.4) / 0.6);
      }
      // over and under: knots she can lift now wear a soft cream ring
      const ready = L.layering && !busy && !K.up && !L.fixed[e] && !canLift(L, G.state, e);
      drawKnot(c, K.p, e, { scale, up: K.up, tone2: lk >= 0 ? TONE[L.color[lk >> 1]] : null, hint: hintK, alpha: FX.alpha[i], ready });
    }
  }
}
const LAST = { curves: null, plan: null, restPlan: null, crossings: null };

// A knot: a round of yarn on the peg with two little tails toward the rim.
function drawKnot(c, p, e, { scale = 1, up = 0, tone2 = null, hint: hk = 0, alpha = 1, ready = false } = {}) {
  const i = e >> 1, w = HG.w * scale, t = TONE[L.color[i]];
  const [x, y] = p;
  const a = Math.atan2(y - HG.cy, x - HG.cx);
  c.save();
  c.globalAlpha = alpha;
  if (hk > 0) { c.fillStyle = `rgba(242,190,70,${0.5 * hk})`; c.beginPath(); c.arc(x, y, w * 1.45, 0, TAU); c.fill(); }
  if (ready) { c.strokeStyle = 'rgba(255,250,236,.95)'; c.lineWidth = 2.2; c.beginPath(); c.arc(x, y, w * 1.02, 0, TAU); c.stroke(); }
  // shadow, more when lifted
  c.fillStyle = `rgba(50,30,12,${0.26 + 0.1 * up})`;
  c.beginPath(); c.arc(x + 1 + up * 3, y + 1.5 + up * 5, w * 0.72, 0, TAU); c.fill();
  // tails
  c.lineCap = 'round';
  for (const s of [-0.5, 0.45]) {
    const ta = a + s;
    const ex = x + Math.cos(ta) * w * 1.25, ey = y + Math.sin(ta) * w * 1.25;
    c.strokeStyle = t.edge; c.lineWidth = w * 0.42;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * w * 0.7, y + Math.sin(a) * w * 0.7, ex, ey); c.stroke();
    c.strokeStyle = (s < 0 || !tone2 ? t : tone2).base; c.lineWidth = w * 0.3;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * w * 0.7, y + Math.sin(a) * w * 0.7, ex, ey); c.stroke();
  }
  // body
  const r = w * (tone2 ? 0.82 : 0.72);
  c.fillStyle = t.edge; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  if (tone2) {
    c.fillStyle = t.base; c.beginPath(); c.arc(x, y, r * 0.84, a + Math.PI / 2, a + Math.PI * 1.5); c.fill();
    c.fillStyle = tone2.base; c.beginPath(); c.arc(x, y, r * 0.84, a - Math.PI / 2, a + Math.PI / 2); c.fill();
    c.strokeStyle = tone2.edge; c.lineWidth = w * 0.12; c.beginPath(); c.moveTo(x + Math.cos(a + Math.PI / 2) * r * 0.84, y + Math.sin(a + Math.PI / 2) * r * 0.84); c.lineTo(x - Math.cos(a + Math.PI / 2) * r * 0.84, y - Math.sin(a + Math.PI / 2) * r * 0.84); c.stroke();
  } else {
    c.fillStyle = t.base; c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.fill();
  }
  // the wrap of the knot
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
  } else if (data.glyphs) {
    drawGlyph(c, glyphOf(L.color[i]), x, y, r * 1.15, t.ink);
  }
  c.restore();
}

// A strand coming free: it glows and loosens, slips off its pegs toward its
// middle, then a little skein flies to the shelf (DOM).
function drawLeaving(c, f, now) {
  if (now < f.t0) { paintYarn(c, yarnGeom(f.pts, HG.w), { w: HG.w, tone: TONE[L.color[f.s]] }); return; } // its turn in the cascade is coming
  const t = clamp01((now - f.t0) / f.dur);
  const pts = f.pts;
  const A = pts[0], B = pts[pts.length - 1];
  const glow = Math.min(1, t * 4);
  const slip = clamp01((t - 0.35) / 0.65);
  let part = pts;
  if (slip > 0) {
    const g0 = yarnGeom(pts, HG.w);
    const cut = g0.len * 0.5 * ease(slip);
    part = sliceBy(pts, cut, g0.len - cut);
  }
  if (part.length < 2) return;
  // it rises off the linen (its shadow falls away), glowing, then slips off its pegs
  const g = yarnGeom(part, HG.w);
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
// peg's angle, is that peg. With 20 pegs a wedge is about 48 px wide at the
// rim and runs 90 px deep, far more than the 44 px minimum.
function pegAt(x, y) {
  const dx = x - HG.cx, dy = y - HG.cy;
  const r = Math.hypot(dx, dy) / HG.Rk;
  if (r < 0.42 || r > 1.32) return -1;
  let a = Math.atan2(dy, dx) + Math.PI / 2;
  const k = Math.round((a / (2 * Math.PI)) * L.n - 0.5);
  return ((k % L.n) + L.n) % L.n;
}
const canvasXY = (e) => { const r = HG.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const pageOf = (p) => { const r = HG.cv.getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };

// ---------- input ----------
let down = null;
const DRAG_LIFT = 26; // a dragged knot rides above a finger so she can see it
const hoopEl = $('#hoop');
hoopEl.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || !L) return;
  ensureAudio();
  if (busy) { skipAll(); return; }
  const [x, y] = canvasXY(e);
  const q = pegAt(x, y);
  down = { id: e.pointerId, x, y, q, touch: e.pointerType !== 'mouse', moved: false };
  try { hoopEl.setPointerCapture(e.pointerId); } catch { /* fine */ }
});
hoopEl.addEventListener('pointermove', (e) => {
  if (!down || e.pointerId !== down.id || busy) return;
  const [x, y] = canvasXY(e);
  if (!drag) {
    if (Math.hypot(x - down.x, y - down.y) < 10) return;
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
  if (over >= 0 && whyNotTo(L, G.state, drag.e, over)) {
    // the nearest valid peg within reach of the knot, so near misses still land
    over = -1;
  }
  if (over < 0) {
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
  if (d.moved) return;
  // a tap on the yarn itself, away from any knot: show where the handles are
  if (held < 0 && !busy && (d.q < 0 || !endsAt(L, G.state, d.q).length)) {
    const i = strandUnder(d.x, d.y);
    if (i >= 0) { strandTap(i); return; }
  }
  tapPeg(d.q);
});
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
function strandTap(i) {
  const now = performance.now();
  FX.glowUntil[i] = now + 900;
  note = `To move the ${cshort(L.color[i])} strand, tap one of its knots, where it’s tied to a peg.`;
  sfx('soft');
  render(); kick();
}
hoopEl.addEventListener('pointercancel', () => { down = null; if (drag) { drag = null; render(); kick(); } });

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
    note = 'There’s no empty peg this knot can go to yet. Free a strand to make room.';
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

// ---------- the move: carry over, settle into place, maybe come free ----------
function doMove(e, q, fromPt) {
  const before = G.state;
  const hooked0 = hookedPairs(L, before).length;
  const res = play(L, G, e, q);
  if (!res.ok) { held = -1; render(); kick(); return; }
  G = res.game;
  stats.moves++;
  held = -1; note = ''; tangled = false;
  const hk = FX.hint;
  FX.hint = null;
  save();
  const ms = res.movers;
  const start = fromPt || knotAt(e, before, performance.now()).p;
  const end = HG.peg[q];
  // what the hoop shows meanwhile: the old picture, the end carried over it
  view = { state: before };
  for (const f of res.freed) shelfHold.add(f.s);
  // the new picture just before anything lifts off (the very state object
  // when nothing does, so its layout and cache carry on)
  const after = res.pre;
  run(async () => {
    FX.slide = { movers: ms, pt: start };
    kick();
    // carry: over the others, arcing a little toward the middle of the hoop
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
    view = { state: after, morph: { from, to, xb: fractions(P1), t: 0 } };
    FX.slide = null;
    FX.tug = { e, t0: performance.now() };
    sfx('tie');
    kick();
    await tween(reduced() ? 0 : 300, (t) => { view.morph.t = t; });
    view = { state: after };
    FX.tug = null;
    if (res.freed.length) {
      // lift-off: the freed strands rise, glow and wind away, round by round
      // (one lifting off can leave another on top of everything), while the
      // yarn left behind settles into its new lie
      const Pa = pxOf(after), Pb = pxOf(res.state);
      const from2 = {}, to2 = {};
      for (const i of Object.keys(Pb.strands)) { to2[i] = resample(Pb.strands[i], MORPH_N); from2[i] = Pa.strands[i] ? resample(Pa.strands[i], MORPH_N) : to2[i]; }
      if (Object.keys(to2).length) view = { state: res.state, morph: { from: from2, to: to2, xb: fractions(Pb), t: 0 } };
      else view = { state: res.state };
      const rounds = Math.max(...res.freed.map((f) => f.round));
      await Promise.all([
        comeFree(res.freed.map((f) => ({ ...f, pts: Pa.strands[f.s], lifted: after.w[f.s].length > 0 }))),
        wait(reduced() ? 0 : 260 * rounds + 120).then(() => (view && view.morph ? tween(reduced() ? 0 : 420, (t) => { view.morph.t = t; }) : null)).then(() => { view = { state: res.state }; }),
      ]);
    }
    view = null;
    note = afterNote(res, hk, hooked0);
  });
}

function afterNote(res, hk, hooked0) {
  const s = G.state;
  if (isDone(s)) return 'Every strand is free. Lovely work.';
  const left = remaining(s), x = totalCrossings(L, s);
  const togo = `${x} ${x === 1 ? 'crossing' : 'crossings'} left, ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
  const how = res.freed.some((f) => res.pre.w[f.s].length) ? 'lifted right off' : 'came free';
  if (res.freed.length === 1) return `The ${cshort(L.color[res.freed[0].s])} strand ${how}. ${togo}`;
  if (res.freed.length > 1) return `${res.freed.length === 2 ? 'Two' : res.freed.length === 3 ? 'Three' : res.freed.length} strands ${how} at once! ${togo}`;
  const hooked = hookedPairs(L, s).length;
  if (hooked > hooked0) return `Hooked: the end went over a knot and now loops round its strand. Carry it back to let go. ${togo}`;
  return togo;
}

async function comeFree(freed) {
  const now = performance.now();
  const dur = reduced() ? 260 : 700;
  const shelfSlots = $$('#shelf .slot');
  FX.leaving = freed.map((f, k) => ({ ...f, t0: now + (f.round || 0) * (reduced() ? 0 : 260) + k * 60, dur }));
  sfx('free', freed.length);
  kick();
  if (navigator.vibrate && !reduced()) { try { navigator.vibrate(12); } catch { /* fine */ } }
  await wait(dur * 0.7 + Math.max(...freed.map((f) => (f.round || 0) * 260)) + (freed.length - 1) * 60);
  // a skein for each, off to the shelf
  const flights = freed.map((f, k) => {
    const g = yarnGeom(f.pts, HG.w);
    const from = pageOf(g.mid);
    const slot = shelfSlots.find((el) => +el.dataset.s === f.s) || $('#shelf');
    const r = slot.getBoundingClientRect();
    const to = [r.left + r.width / 2, r.top + r.height / 2];
    const el = document.createElement('div');
    el.className = 'flying';
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
  for (const el of $$('.flying')) el.remove();
  shelfHold.clear();
  renderShelf();
  const got = $$('#shelf svg').filter((sv) => freed.some((f) => +sv.dataset.s === f.s));
  for (const sv of got) anim(sv, [{ transform: 'translateY(-6px) scale(1.12)' }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
}

// ---------- undo, hint, start over ----------
let undoAfter = false;
function doUndo() {
  if (busy) { undoAfter = true; skipAll(); return; }
  if (!G.past.length) return;
  const was = G.state;
  G = undo(G);
  stats.undos++;
  held = -1; drag = null; tangled = false; FX.hint = null;
  const now = performance.now();
  for (let i = 0; i < L.S; i++) {
    if (was.out[i] && !G.state.out[i]) FX.alpha[i] = reduced() ? 1 : 0;
    if (was.ends[2 * i] !== G.state.ends[2 * i] || was.ends[2 * i + 1] !== G.state.ends[2 * i + 1] || was.w[i].length !== G.state.w[i].length) FX.glowUntil[i] = now + 350;
  }
  note = 'Undone.';
  save();
  render(); kick();
}
function doHint() {
  if (busy) { skipAll(); return; }
  stats.hints++;
  held = -1;
  try {
    const h = hint(L, G.state, { cap: 300 }); // off the stored path: a short search, then the best-looking move
    if (h.kind === 'move') {
      FX.hint = { end: h.end, to: h.to, t0: performance.now() };
      tangled = false;
      const c = L.color[h.end >> 1];
      note = `Try the glowing ${cshort(c)} knot on the peg ringed in gold.`;
    } else if (h.kind === 'tangled') {
      FX.hint = null; tangled = true;
      note = 'This hoop has gotten into a knot: no way out from here. Undo a few steps, or start over.';
    }
  } catch (e) {
    console.error(e);
    note = 'Look for a strand you could lift so it crosses fewer others.';
  }
  render(); kick();
}
let restartArmed = 0;
function doRestart() {
  if (busy) return;
  if (!restartArmed && G.state.moves > 0 && !isDone(G.state)) {
    restartArmed = setTimeout(() => { restartArmed = 0; $('#restartBtn').textContent = 'Start over'; }, 3000);
    $('#restartBtn').textContent = 'Tap again';
    return;
  }
  clearTimeout(restartArmed); restartArmed = 0;
  $('#restartBtn').textContent = 'Start over';
  startLevel(L.id, { fresh: true });
  note = 'A fresh start.';
  render();
}

let finishing = false;
async function afterMove() {
  if (!isDone(G.state) || finishing) return;
  finishing = true;
  try {
    const par = L.par, moves = G.state.moves;
    data.done[L.id] = true;
    if (moves <= par) data.star[L.id] = true;
    save();
    sfx('chord');
    if (!reduced()) {
      const pill = document.createElement('div');
      pill.className = 'cheer flying';
      pill.style.position = 'absolute';
      pill.textContent = 'All free!';
      $('#hoopwrap').append(pill);
      await anim(pill, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -62%)' }], { duration: 1200, easing: 'ease-out' });
      pill.remove();
    }
  } finally {
    finishing = false;
    openFinish();
  }
}

// ---------- sound (soft, optional, never before a gesture) ----------
let AC = null;
function ensureAudio() {
  if (!data.sound) return;
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch { AC = null; }
}
function tone(freq, dur, type = 'sine', gain = 0.04, when = 0, slide = 0) {
  const t = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind, k = 1) {
  if (!data.sound || !AC || skip) return;
  try {
    if (kind === 'lift') tone(330, 0.12, 'triangle', 0.03, 0, 1.25);
    else if (kind === 'tie') { tone(523, 0.06, 'sine', 0.03); tone(392, 0.09, 'triangle', 0.022, 0.05, 0.9); }
    else if (kind === 'free') [0, 4, 7, 12, 16].slice(0, 2 + Math.min(3, k)).forEach((s, i) => tone(440 * 2 ** (s / 12), 0.35, 'sine', 0.03, i * 0.06));
    else if (kind === 'soft') tone(262, 0.12, 'sine', 0.022, 0, 0.85);
    else if (kind === 'chord') [0, 4, 7, 12].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.7, 'sine', 0.026, i * 0.08));
  } catch { /* sound is a nicety */ }
}

// ---------- render (DOM) ----------
function render() {
  if (!L) return;
  const s = G.state;
  const idx = LEVELS.indexOf(L);
  $('#lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#lvName').textContent = L.name;
  renderToggles();
  renderShelf();
  $('#moveCount').innerHTML = `Moves <b>${s.moves}</b>`;
  $('#undoBtn').disabled = !G.past.length;
  $('#undoBtn').classList.toggle('lit', tangled);
  $('#hintBtn').disabled = isDone(s);
  $('#msg').textContent = message(s);
  const hk = hookedPairs(L, s).length;
  hoopEl.setAttribute('aria-label', `An embroidery hoop with ${L.n} pegs and ${remaining(s)} strands of yarn still tied across it, ${totalCrossings(L, s)} crossings${hk ? `, ${hk} ${hk === 1 ? 'pair' : 'pairs'} hooked together` : ''}.`);
  renderSr();
}
function renderToggles() {
  const gb = $('#glyphBtn');
  gb.setAttribute('aria-pressed', String(!!data.glyphs));
  gb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS.heart.f}" fill="currentColor"/></svg>Color symbols: ${data.glyphs ? 'on' : 'off'}`;
  const sb = $('#soundBtn');
  sb.setAttribute('aria-pressed', String(!!data.sound));
  sb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${data.sound ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>Soft sounds: ${data.sound ? 'on' : 'off'}`;
}
// One place per strand on the shelf: dashed until its skein lands there.
function renderShelf() {
  const s = G.state;
  const on = (i) => s.out[i] && !shelfHold.has(i);
  $('#shelf').innerHTML = [...Array(L.S).keys()].map((i) => (on(i) ? skeinSVG(L.color[i]).replace('<svg ', `<svg data-s="${i}" `) : `<span class="slot" data-s="${i}"></span>`)).join('');
  const n = s.out.filter(Boolean).length;
  $('#shelfCount').textContent = `${n} of ${L.S} strands free`;
}
function message(s) {
  if (busy && !note) return 'Retying…';
  if (note) return note;
  if (isDone(s)) return 'Every strand is free. Lovely work.';
  if (!s.moves) {
    if (LEVELS.indexOf(L) === 0) return 'Tap a knot to lift it, then tap a glowing peg to retie it. A strand that crosses nothing comes free.';
    return 'Lift a knot and retie it on an empty peg. Drag works too.';
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
      items.push(`<button type="button" data-peg="${s.ends[e]}">Lift the ${what} on peg ${s.ends[e] + 1}${why ? (why.reason === 'fixed' ? ' (stitched down)' : ' (under another strand)') : ''}</button>`);
    }
  }
  $('#srList').innerHTML = items.join('');
}
$('#srList').addEventListener('click', (e) => { const b = e.target.closest('[data-peg]'); if (b) { ensureAudio(); tapPeg(+b.dataset.peg); } });

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  skipAll();
  L = levelById(id) || LEVELS[0];
  data.cur = L.id;
  const g = data.game;
  if (!fresh && g && g.level === L.id && g.sig === L.sig && validState(L, g.state) && Array.isArray(g.past)) {
    G = { state: g.state, past: g.past.filter((s) => validState(L, s)) };
  } else {
    G = newGame(L);
  }
  skip = false;
  held = -1; drag = null; view = null; note = ''; tangled = false;
  resetFx();
  render();
  sizeHoop();
  save();
  maybeIntro();
}

// ---------- sheets ----------
function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  const p = el.querySelector('.panel');
  anim(p, [{ transform: 'translateY(40px)' }, { transform: 'none' }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('.btn.primary') || el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { el.hidden = true; }
document.addEventListener('click', (e) => {
  const sh = e.target.closest('.sheet');
  if (sh && sh.id !== 'introSheet' && (e.target === sh || e.target.closest('[data-close]'))) closeSheet(sh);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  let closed = false;
  for (const sh of $$('.sheet')) if (!sh.hidden && sh.id !== 'introSheet') { closeSheet(sh); closed = true; }
  if (!closed && held >= 0) { held = -1; note = ''; render(); kick(); }
});

// A little picture of a hoop: the ring and the strands as they lie, over and under at each crossing.
function thumb(Lv, size, st = newState(Lv)) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * 2;
  const c = cv.getContext('2d');
  c.scale(2, 2);
  const cx = size / 2, cy = size / 2, R = size / 2 - 3;
  c.fillStyle = '#EFE6D2'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  c.strokeStyle = '#C9A06A'; c.lineWidth = Math.max(2.5, size * 0.06); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  c.lineCap = 'round'; c.lineJoin = 'round';
  let lay;
  try { lay = layout(Lv, st, { iters: 1500 }); } catch { return cv; }
  const T = (p) => [cx + p[0] * (R - 1), cy + p[1] * (R - 1)];
  const curves = {};
  for (const [i, pts] of Object.entries(lay.strands)) curves[i] = pts.map(T);
  const stroke = (i) => {
    const pts = curves[i];
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]);
    c.strokeStyle = 'rgba(240,231,212,.95)'; c.lineWidth = Math.max(2.4, size * 0.055); c.stroke();
    c.strokeStyle = COLORS[Lv.color[i]].hex; c.lineWidth = Math.max(1.6, size * 0.035); c.stroke();
  };
  for (const i of baseOrder(Object.keys(curves).map(Number), lay.crossings)) stroke(+i);
  for (const X of lay.crossings) {
    const p = T(X.p);
    c.save(); c.beginPath(); c.arc(p[0], p[1], Math.max(3, size * 0.07), 0, TAU); c.clip(); stroke(X.top); c.restore();
  }
  return cv;
}
function openLevels() {
  const box = $('#lvList');
  box.innerHTML = '';
  const firstOf = {};
  LEVELS.forEach((Lv, i) => { for (const m of Lv.mechanics) if (!(m in firstOf)) firstOf[m] = i; });
  BANDS.forEach((band, bi) => {
    const to = bi + 1 < BANDS.length ? BANDS[bi + 1].from : LEVELS.length;
    if (band.from >= LEVELS.length) return;
    const h = document.createElement('h3');
    h.className = 'band';
    h.textContent = band.name;
    const ul = document.createElement('ul');
    ul.className = 'lvls';
    for (let i = band.from; i < Math.min(to, LEVELS.length); i++) {
      const Lv = LEVELS[i];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(Lv === L));
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${data.done[Lv.id] ? ', untangled' : ''}${data.star[Lv.id] ? ', with a star' : ''}${fresh.length ? `, new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : ''}`);
      b.append(thumb(Lv, 48));
      if (data.done[Lv.id]) { const t = document.createElement('span'); t.className = 'tick'; t.textContent = '✓'; t.setAttribute('aria-hidden', 'true'); b.append(t); }
      if (data.star[Lv.id]) { const t = document.createElement('span'); t.className = 'lvstar'; t.innerHTML = STAR(true); b.append(t); }
      const t = document.createElement('span');
      t.className = 't';
      t.innerHTML = `<b>${i + 1} · ${Lv.S} strands</b>${Lv.name}${fresh.length ? `<br><span class="chip">new: ${MECHANICS[fresh[0]].name.toLowerCase()}</span>` : ''}`;
      b.append(t);
      b.addEventListener('click', () => { closeSheet($('#levelSheet')); if (Lv !== L) startLevel(Lv.id, { fresh: !(data.game && data.game.level === Lv.id) }); });
      li.append(b);
      ul.append(li);
    }
    box.append(h, ul);
  });
  openSheet('#levelSheet');
  $('#levelSheet [aria-current="true"]')?.scrollIntoView({ block: 'center' });
}

function openFinish() {
  if (!isDone(G.state) || !$('#finishSheet').hidden) return;
  const s = G.state;
  const y = yarnLine(L.S);
  $('#finTitle').textContent = `${L.name}: all free`;
  $('#finSub').textContent = `${L.S} strands slipped off the hoop and wound into skeins.`;
  const counts = {};
  for (const c of L.color) counts[c] = (counts[c] || 0) + 1;
  const piles = Object.keys(counts).map((c) => `<div class="pile"><div class="sk">${skeinSVG(c).repeat(Math.min(4, counts[c]))}</div><span class="tag">${cshort(c)}${counts[c] > 1 ? ` ×${counts[c]}` : ''}</span></div>`);
  let rows = '';
  for (let i = 0; i < piles.length; i += 3) rows += `<div class="row">${piles.slice(i, i + 3).join('')}</div>`;
  $('#finShelf').innerHTML = rows;
  const fh = $('#finHoop');
  const t = thumb(L, 104);
  fh.width = t.width; fh.height = t.height;
  fh.getContext('2d').drawImage(t, 0, 0);
  const star = s.moves <= L.par;
  $('#finPar').innerHTML = star
    ? `${STAR(true)}<span>Untangled in ${s.moves} moves, the tidiest it can be done.</span>`
    : `${STAR(false)}<span>Untangled in ${s.moves} moves. Par is ${L.par}; the star is there if you’d like another go.</span>`;
  $('#finKnits').textContent = y.line;
  const idx = LEVELS.indexOf(L);
  const next = LEVELS.slice(idx + 1).find((x) => !data.done[x.id]) || LEVELS[(idx + 1) % LEVELS.length];
  $('#finNext').textContent = `Next: ${next.name}`;
  $('#finNext').onclick = () => { closeSheet($('#finishSheet')); startLevel(next.id, { fresh: true }); };
  openSheet('#finishSheet');
  if (!reduced()) $$('#finShelf .sk svg').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 60, fill: 'backwards', easing: 'ease-out' }));
}

// Intro cards: one line for each new thing, the first time it appears.
const hoopIcon = (inner) => `<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23" fill="#EFE6D2"/><circle cx="28" cy="28" r="23" fill="none" stroke="#C9A06A" stroke-width="5"/>${inner}</svg>`;
const yarnLineSvg = (d, col, w = 4.5) => `<path d="${d}" fill="none" stroke="${mixHex(col, '#24160A', 0.36)}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w * 0.72}" stroke-linecap="round"/>`;
const ICON = {
  // two loops hooked through each other: red goes under blue, then over it
  clasp: hoopIcon(`${yarnLineSvg('M10 18C20 22 32 22 36 30S30 40 22 34', '#34588E')}${yarnLineSvg('M46 38C36 34 24 34 20 26S26 16 34 22', '#B9473A')}<path d="M27.5 33.6C29.5 35 31.5 35.8 33 35.8" fill="none" stroke="${mixHex('#34588E', '#24160A', 0.36)}" stroke-width="4.5" stroke-linecap="round"/><path d="M27.5 33.6C29.5 35 31.5 35.8 33 35.8" fill="none" stroke="#34588E" stroke-width="3.2" stroke-linecap="round"/>`),
  fixed: hoopIcon(`${yarnLineSvg('M8 22C20 28 34 36 44 44', '#B9473A')}<circle cx="8" cy="22" r="4" fill="#B9473A"/><circle cx="8" cy="22" r="2.2" fill="#D7AE52"/>`),
  pegs: hoopIcon(`<circle cx="28" cy="5" r="4" fill="#34588E" stroke="#FFF8E6" stroke-width="1.2"/><circle cx="51" cy="28" r="4" fill="#B9473A" stroke="#FFF8E6" stroke-width="1.2"/>${yarnLineSvg('M28 6C30 22 40 30 50 28', '#34588E')}`),
  links: hoopIcon(`${yarnLineSvg('M10 16C24 26 30 34 42 46', '#B9473A')}${yarnLineSvg('M10 16C22 18 36 16 48 22', '#34588E')}<circle cx="10" cy="16" r="4.6" fill="#7A3A2C"/><path d="M6 16a4 4 0 0 1 8 0z" fill="#B9473A"/><path d="M6 16a4 4 0 0 0 8 0z" fill="#34588E"/>`),
  layering: hoopIcon(`${yarnLineSvg('M8 30C20 26 36 30 48 26', '#D6A92E')}<path d="M26 8C25 22 31 36 30 48" fill="none" stroke="rgba(60,40,20,.25)" stroke-width="7" stroke-linecap="round" transform="translate(1.5 2)"/>${yarnLineSvg('M26 8C25 22 31 36 30 48', '#5F8A3A')}`),
  spare: hoopIcon(`${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => { const a = -Math.PI / 2 + (2 * Math.PI * (k + 0.5)) / 10; const x = 28 + Math.cos(a) * 23, y = 28 + Math.sin(a) * 23; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${k === 2 || k === 7 ? '#F3E3B8' : '#94703F'}" ${k === 2 || k === 7 ? 'stroke="#C8901E" stroke-width="1.2"' : ''}/>`; }).join('')}`),
};
function maybeIntro() {
  if (!data.seenHow) return;
  const fresh = L.mechanics.filter((m) => !data.seenIntro[m] && MECHANICS[m]);
  if (!fresh.length) return;
  $('#introTitle').textContent = fresh.length > 1 ? 'Some new things on the hoop' : 'Something new on the hoop';
  $('#introBody').innerHTML = fresh.map((m) => `<div class="item">${ICON[m] || ''}<p><strong>${MECHANICS[m].name}</strong>${MECHANICS[m].line}</p></div>`).join('');
  $('#introOk').onclick = () => { for (const m of fresh) data.seenIntro[m] = true; save(); closeSheet($('#introSheet')); };
  openSheet('#introSheet');
}

// How this works: three short steps.
const ILL = {
  lift: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="160" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    ${yarnLineSvg('M112 33C140 60 170 80 206 98', '#34588E', 8)}
    <circle cx="206" cy="98" r="6" fill="#34588E"/>
    <circle cx="112" cy="33" r="9" fill="#2A4470" opacity=".25" transform="translate(3 5)"/><circle cx="112" cy="33" r="8" fill="#34588E"/>
    <circle cx="218" cy="50" r="10" fill="rgba(242,190,70,.35)" stroke="#C8901E" stroke-width="2"/>
    <path d="M122 30C160 10 196 22 210 40" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
    <path d="M204 34l8 8-10 3" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  free: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="120" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    <path d="M72 40C100 60 130 70 170 72" fill="none" stroke="rgba(242,190,70,.6)" stroke-width="16" stroke-linecap="round"/>
    ${yarnLineSvg('M72 40C100 60 130 70 170 72', '#B9473A', 8)}
    ${yarnLineSvg('M96 112C104 92 112 78 130 10', '#5F8A3A', 8)}
    <g transform="translate(232,46) scale(1.2)">${skeinSVG('m').replace('<svg viewBox="0 0 66 40" aria-hidden="true">', '').replace('</svg>', '')}</g>
    <path d="M176 66C196 56 210 54 226 60" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
  </svg>`,
  room: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <circle cx="160" cy="65" r="58" fill="#EFE6D2" stroke="#C9A06A" stroke-width="9"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => { const a = -Math.PI / 2 + (2 * Math.PI * (k + 0.5)) / 12; const x = 160 + Math.cos(a) * 58, y = 65 + Math.sin(a) * 58; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${k === 1 || k === 2 ? '#F3E3B8' : '#A9804C'}" ${k === 1 || k === 2 ? 'stroke="#C8901E" stroke-width="1.5"' : ''}/>`; }).join('')}
    ${yarnLineSvg(`M${(160 + Math.cos(-Math.PI / 2 + Math.PI / 12) * 58).toFixed(1)} ${(65 + Math.sin(-Math.PI / 2 + Math.PI / 12) * 58).toFixed(1)}C170 40 196 44 ${(160 + Math.cos(-Math.PI / 2 + (7 * Math.PI) / 12) * 58).toFixed(1)} ${(65 + Math.sin(-Math.PI / 2 + (7 * Math.PI) / 12) * 58).toFixed(1)}`, '#D6A92E', 7)}
  </svg>`,
};
const HOW = [
  { t: 'Lift a knot, retie it', ill: 'lift', p: 'Tap a knot on a peg to lift it, then tap one of the glowing empty pegs to tie it there. Or just drag the knot across. The end is carried over the knots it passes, and whatever lay over the strand still does.' },
  { t: 'On top of everything, off it comes', ill: 'free', p: 'A strand lying on top of everything it crosses lifts right off. Strands can cross more than once and even hook round each other; one that lies under anything stays. A freed strand winds onto a skein, and its two pegs are yours to use.' },
  { t: 'Any empty peg', ill: 'room', p: 'Tie a knot on any empty peg. The end you carry goes the way round that doesn’t pass its own other knot. Undo is free, Hint glows a good next move, and there are no timers and no way to lose.' },
];
function renderHow() {
  const st = HOW[howStep];
  $('#howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'on' : ''}"></i>`).join('');
  $('#howBack').disabled = howStep === 0;
  $('#howNext').textContent = howStep === HOW.length - 1 ? 'Start untangling' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#howSheet'); }

// ---------- wiring ----------
$('#undoBtn').addEventListener('click', doUndo);
$('#hintBtn').addEventListener('click', doHint);
$('#restartBtn').addEventListener('click', doRestart);
$('#levelsBtn').addEventListener('click', () => { if (!busy) openLevels(); });
$('#howBtn').addEventListener('click', () => { if (!busy) openHow(); });
$('#howBtn2').addEventListener('click', () => { closeSheet($('#levelSheet')); openHow(); });
$('#glyphBtn').addEventListener('click', () => { data.glyphs = !data.glyphs; save(); buildBg(); CACHE.sig = ''; render(); kick(); });
$('#soundBtn').addEventListener('click', () => { data.sound = !data.sound; save(); ensureAudio(); render(); sfx('tie'); });
$('#howBack').addEventListener('click', () => { if (howStep > 0) { howStep--; renderHow(); } });
$('#howNext').addEventListener('click', () => {
  if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
  closeSheet($('#howSheet'));
  if (!data.seenHow) { data.seenHow = true; save(); maybeIntro(); }
});
$('#finAgain').addEventListener('click', () => { closeSheet($('#finishSheet')); startLevel(L.id, { fresh: true }); });
$('#finAll').addEventListener('click', () => { closeSheet($('#finishSheet')); openLevels(); });
let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (L && !busy && !drag) { sizeHoop(); render(); } }, 120); });
document.addEventListener('visibilitychange', () => { if (document.hidden && busy) skipAll(); });

// ---------- boot ----------
load();
startLevel(data.cur);
if (!data.seenHow) openHow();
else if (isDone(G.state)) openFinish();

// For quick checks from the console or a test harness (read-only peeks).
window.__hoop = {
  get level() { return L; }, get state() { return G.state; }, get busy() { return busy; }, get held() { return held; },
  get note() { return note; }, get hint() { return FX.hint && { ...FX.hint }; }, get stats() { return { ...stats }; },
  get perf() { return { frames: PERF.frames, draw: PERF.draw.slice(), rebuilds: PERF.rebuilds }; },
  // the page point of peg q (its knot)
  pegPoint(q) { return pageOf(HG.peg[q]); },
  get geom() { return { css: HG.css, Rk: HG.Rk, w: HG.w, pr: HG.pr }; },
  // what was painted last frame: who lies on top at each drawn crossing (css px)
  drawnTops() {
    if (!LAST.curves) return [];
    const full = { rest: LAST.restPlan ? LAST.restPlan.rest : [], restPatches: LAST.restPlan ? LAST.restPlan.restPatches : [], live: LAST.plan.live, livePatches: LAST.plan.livePatches };
    return LAST.crossings.map((X) => ({ a: X.a, b: X.b, top: X.top, p: X.p, drawn: topAt(LAST.curves, full, X.p, HG.w, [X.a, X.b]) }));
  },
  // the page point a fraction t along strand i as drawn now
  strandPoint(i, t) { const P = pxOf(G.state); const pts = P.strands[i]; return pts ? pageOf(pts[Math.round(t * (pts.length - 1))]) : null; },
  // time the painter: a full rebuild of the resting strands, and an ordinary frame (ms)
  bench(n = 20) {
    const t0 = performance.now();
    for (let k = 0; k < n; k++) { CACHE.sig = ''; restPlan.key = ''; draw(performance.now()); }
    const t1 = performance.now();
    for (let k = 0; k < n; k++) draw(performance.now());
    return { rebuild: (t1 - t0) / n, frame: (performance.now() - t1) / n };
  },
};
