// The Tangle Basket: UI, rendering and animation. Rules live in rules.js (pure),
// the zoom and pan arithmetic in view.js (pure).
//
// PAINTING. Every strand is pre-painted once into its own bitmap (yarn, ply,
// a halo of fiber hairs, glyphs; a soft shadow at half resolution; a gray
// "buried" look when it has one). The heap is painted bottom to top from
// those bitmaps, so at every ordinary crossing the later strand lies on top.
// Where yarn weaves the other way (a snarl's turned crossing) or a strand
// crosses itself, a small precomputed PATCH (the top strand's few units
// around the crossing, painted again) goes on top. Nothing is re-sorted.
// Strands that can't move are kept in a cached bitmap; strands that can move
// (raised ones, anything wiggling, glowing or fading) are drawn live on top,
// together with everything lying over them, and each frame repaints only the
// rectangles that changed.
//
// ZOOM. The window onto the board is a view { z, x, y } (view.js). While a
// finger pinches or drags, nothing is repainted: the canvas just moves (a CSS
// transform), over a backdrop of the whole basket. When the fingers lift, the
// heap is painted again at the new view, and strand bitmaps near the window
// are re-rasterized for the new zoom a few per frame, within a memory budget.
// A pulled strand leaves the heap at once and slithers along its own path on a
// full-screen overlay canvas, then winds onto its spool in the rack (DOM).
import {
  W, SPOOL, COLORS, HIDDEN_HEX, newGame, play, playNudge, undo, whyNot, canPull, isUncovered,
  isPinned, isPegged, showsColor, isDone, isStuck, canNudge, hint, groupOf, colorsOf, knitsInto, remaining, pickStrand, nearDist,
} from './rules.js';
import { LEVELS, MECHANICS, BANDS, levelById, readSave } from './levels.js';
import { fitView, clampView, toBoard, toScreen, zoomAt, panBy, pinchView, reachUnits, isFit } from './view.js';

const KEY = 'tincture.proto.tangle';
const HISTORY_SAVED = 300; // undo is unlimited in a session; the save keeps the last 300 steps
const TAP_SLOP = 10;       // css px a finger may drift and still be a tap
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 1);
const ease = (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;

// ---------- color ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;
const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toneOf = (hex) => ({
  base: hex, edge: mixHex(hex, '#24160A', 0.36), light: mixHex(hex, '#FFF6E4', 0.35), ink: lum(hex) > 0.28 ? 'rgba(42,30,20,.85)' : 'rgba(255,250,238,.95)',
  fuzz: mixHex(hex, '#FFF6E4', 0.3).replace('rgb(', 'rgba(').replace(')', ',.5)'),
  fuzzD: rgba(hex, 0.32),
});
const TONE = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toneOf(c.hex)]));
const GRAY = toneOf(HIDDEN_HEX);
const cname = (c) => COLORS[c].name;
const cshort = (c) => COLORS[c].short;

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
const glyphSvg = (c, cls = 'gl') => {
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

// ---------- yarn: geometry and paint ----------
// pts in any unit; w = yarn thickness in the same unit. Built once per strand
// for its bitmaps, for each patch (a stretch [from, to] of the arc: ply, hairs
// and glyphs keep the same places as on the whole strand), and per frame for a
// strand in motion. seed: fiber hairs differ strand to strand.
const LIGHT = [-0.5, -0.866];
const LIFT_UP = 0.17; // a raised strand sits this many yarn-widths up
function hash(a, b) { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
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

// ---------- save ----------
let data = readSave(null).data;
let rewound = null; // a basket that changed since the save: it starts fresh, with a word
function save() {
  try {
    const g = G ? { level: L.id, sig: L.sig, state: G.state, past: G.past.slice(-HISTORY_SAVED) } : null;
    localStorage.setItem(KEY, JSON.stringify({ ...data, cur: L ? L.id : data.cur, game: g }));
  } catch { /* storage may be blocked; play goes on */ }
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* a fresh start */ }
  const r = readSave(raw);
  data = r.data;
  rewound = r.reset;
}

// ---------- state ----------
let L = null, G = null, busy = false, skip = false, note = '', hinted = -1, tangled = false, howStep = 0;
let viewRack = null, viewSkeins = null; // what the rack and shelf show while animating
let queuedTap = null;
let winding = null; // the color going onto a spool right now
const skipWaiters = new Set();
const stats = { pulls: 0, blocked: 0, undos: 0, hints: 0, nudges: 0, zooms: 0, pans: 0 };

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
  try { await fn(); } catch (e) { console.error('The Tangle Basket: an animation was cut short', e); } finally {
    busy = false; skip = false;
    viewRack = null; viewSkeins = null; winding = null;
    showFly(false);
    for (const el of $$('.flying')) el.remove();
    for (const el of $$('.spool.winding')) el.classList.remove('winding');
    render();
    kick();
    scheduleBackdrop();
    afterMove();
    const q = queuedTap;
    queuedTap = null;
    if (q && !isDone(G.state)) setTimeout(() => tapAt(q.x, q.y), 0);
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
  const app = $('#app');
  const vw = document.documentElement.clientWidth;
  const availW = Math.min(vw, 480) - 24 - 18;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.classList.contains('basketwrap') || ch.classList.contains('sr') || ch.hidden) continue;
    // the message row can grow to two rows (a message, then Spare slot and Undo); keep room for it
    used += ch.classList.contains('msgrow') ? Math.max(ch.offsetHeight, 96) : ch.offsetHeight; n++;
  }
  used += n * 6 + 18 + 14;
  const availH = innerHeight - used;
  const B = L.board;
  const cssW = Math.max(220, Math.floor(Math.min(availW, (availH / B.h) * B.w)));
  const cssH = Math.round((cssW * B.h) / B.w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  HP.dpr = dpr; HP.fit = { w: cssW, h: cssH, s: cssW / B.w };
  HP.kr0 = dpr * HP.fit.s;
  const cv = $('#heap');
  HP.cv = cv; HP.ctx = cv.getContext('2d');
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
  const wrap = $('#heapWrap');
  wrap.style.width = `${cssW}px`; wrap.style.height = `${cssH}px`;
  HP.cache = document.createElement('canvas');
  HP.cache.width = cv.width; HP.cache.height = cv.height;
  HP.cctx = HP.cache.getContext('2d');
  HP.back = $('#heapBack'); HP.bctx = HP.back.getContext('2d');
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
    alpha: HP.fade[i], glyphs: data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null,
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
const glyphsOf = (s) => (data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null);
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
  const u = c.under, pu = L.poly[u], k = c.ku, end = c.tuck ? pu.length - 1 : 0;
  const tip = pu[end], back = pu[c.tuck ? Math.max(0, end - 6) : Math.min(pu.length - 1, 6)];
  const dl = Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1;
  const tx = (tip[0] - back[0]) / dl, ty = (tip[1] - back[1]) / dl;
  void k;
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
  gr.addColorStop(0, TONE[c].light); gr.addColorStop(0.55, COLORS[c].hex); gr.addColorStop(1, TONE[c].edge);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(hx - hr * 0.35, hy - hr * 0.38, hr * 0.22, 0, 7); ctx.fill();
  if (data.glyphs) drawGlyph(ctx, glyphOf(c), hx, hy, hr * 1.25, TONE[c].ink);
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
  ctx.strokeStyle = COLORS[c].hex; ctx.lineWidth = r * 0.3; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, 7); ctx.stroke();
  ctx.fillStyle = '#E6C997'; ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.18, r * 0.12, 0, 7); ctx.fill();
  if (data.glyphs) drawGlyph(ctx, glyphOf(c), x, y, r * 0.62, 'rgba(42,30,20,.85)');
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
  const glob = `${data.glyphs ? 'g' : ''}${HP.view.z},${HP.view.x},${HP.view.y}`;
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
  if (!HP.backStale) return;
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
    if (!HP.backStale || isFit(HP.view)) return;
    if (busy || GEST.active || HP.rasterQ.length) { scheduleBackdrop(); return; }
    paintBackdrop();
  }, 500);
}

// Springs: uncovered strands lift, buried colors fade in, glows fade out.
function physics(dt, now) {
  const st = G.state, rm = reduced();
  let moving = false;
  const Kk = 260, C = 2 * 0.78 * Math.sqrt(Kk); // about 2% overshoot
  for (let i = 0; i < L.n; i++) {
    const tgt = liftTarget(i, st) + (HP.glowUntil[i] > now ? 0.6 : 0);
    if (rm) { HP.lift[i] = tgt; HP.liftV[i] = 0; } else if (Math.abs(HP.lift[i] - tgt) > 0.002 || Math.abs(HP.liftV[i]) > 0.002) {
      const a = Kk * (tgt - HP.lift[i]) - C * HP.liftV[i];
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
function kick() { if (!raf && L) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
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
  const b = $('#fitBtn');
  if (!b || !L) return;
  const zoomed = !isFit(v);
  const deep = L.mechanics.includes('deep');
  b.hidden = !zoomed && !deep;
  b.dataset.mode = zoomed ? 'fit' : 'zoom';
  b.innerHTML = zoomed
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Fit'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>Zoom';
  b.setAttribute('aria-label', zoomed ? 'Fit the whole basket' : 'Zoom in');
}

const heapEl = $('#heap');
const localPt = (e) => { const r = $('#heapWrap').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
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
  if (!q) return;
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
function endPointer(e, cancel) {
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
}
heapEl.addEventListener('pointerup', (e) => endPointer(e, false));
heapEl.addEventListener('pointercancel', (e) => endPointer(e, true));
heapEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  beginGesture();
  const [x, y] = localPt(e);
  showGestureView(zoomAt(HP.fit, L.board, HP.gview || HP.view, Math.exp(-e.deltaY * 0.0015), x, y));
  clearTimeout(GEST.settleT);
  GEST.settleT = setTimeout(() => settleView(HP.gview || HP.view), 160);
}, { passive: false });
$('#fitBtn').addEventListener('click', () => {
  if (busy) skipAll();
  if (!isFit(HP.view)) animateView(fitView());
  else animateView(zoomAt(HP.fit, L.board, HP.view, 2.2, HP.fit.w / 2, HP.fit.h / 2));
});
$('#srList').addEventListener('click', (e) => { const b = e.target.closest('[data-strand]'); if (b) act(+b.dataset.strand, null); });

// The strand under a tap (css px from the window's corner), or -1.
function strandAt(px, py) {
  const p = toBoard(HP.fit, HP.view, px, py);
  return pickStrand(L, G.state, p, reachUnits(HP.fit, HP.view, W));
}
function tapAt(x, y) {
  if (!L || isDone(G.state)) return;
  if (busy) { queuedTap = { x, y }; skipAll(); return; }
  ensureAudio();
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
  const why = whyNot(L, G.state, i);
  if (!why) doPull(i);
  else if (why.reason !== 'gone') blocked(i, why, at);
}

// ---------- the overlay: strands in flight ----------
const FLY = { cv: null, ctx: null, dpr: 1, box: null };
function sizeFly() {
  const cv = $('#fly');
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
function slotEl(k) { return $(`#rack .slot[data-slot="${k}"]`); }
function spoolHTML(sp, k, hot) {
  const spare = k >= L.slots;
  const lab = sp ? `${cname(sp.c)} spool, ${sp.n >= SPOOL ? 'full' : `${SPOOL - sp.n} more to fill`}` : spare ? 'Spare slot, empty' : 'Empty slot';
  if (!sp) return `<div class="slot" data-slot="${k}" role="img" aria-label="${lab}"><div class="peg empty${spare ? ' spare' : ''}${hot ? ' hot' : ''}"></div><span class="cnt soft">${spare ? 'spare' : '&nbsp;'}</span></div>`;
  return `<div class="slot" data-slot="${k}" role="img" aria-label="${lab}"><div class="peg${spare ? ' spare' : ''}${hot ? ' hot' : ''}"><div class="spool" style="--c:${COLORS[sp.c].hex};--f:${(sp.n / SPOOL).toFixed(3)}"><i class="fl t"></i><i class="core"></i><i class="wrap"></i><i class="fl b"></i>${glyphSvg(sp.c)}</div></div><span class="cnt">${sp.n >= SPOOL ? 'full' : `${SPOOL - sp.n} more`}</span></div>`;
}
function renderRack(rack = viewRack || G.state.rack, hot = false) {
  const el = $('#rack');
  el.style.setProperty('--slots', rack.length);
  el.innerHTML = rack.map((sp, k) => spoolHTML(sp, k, hot && rack.every(Boolean))).join('');
}
function renderShelf(sk = viewSkeins || G.state.skeins) {
  $('#shelfCount').innerHTML = `Skeins <b>${sk.length}</b>`;
  $('#shelf').innerHTML = sk.map((c) => skeinSVG(c)).join('');
}

// ---------- render (DOM) ----------
function render() {
  if (!L) return;
  const s = G.state;
  document.body.classList.toggle('glyphs', !!data.glyphs);
  const idx = LEVELS.indexOf(L);
  $('#lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#lvName').textContent = L.name;
  renderToggles();
  renderRack();
  renderShelf();
  const stuck = !busy && isStuck(L, s);
  const offerSpare = !busy && !isDone(s) && (stuck || tangled);
  const sp = $('#stuckBtn');
  sp.hidden = !offerSpare;
  sp.textContent = canNudge(s) ? 'Add a spare slot' : 'Start over';
  $('#hintBtn').hidden = stuck;
  $('#hintBtn').disabled = isDone(s);
  $('#undoBtn').disabled = !G.past.length;
  $('#msg').textContent = message(s);
  renderFit();
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
    items.push(`<button type="button" data-strand="${i}">${groupName(g)}${extra}</button>`);
  }
  $('#srList').innerHTML = items.join('');
}

// ---------- pulling: the slither ----------
function doPull(i) {
  const before = G.state;
  const res = play(L, G, i);
  if (!res.ok) return;
  G = res.game;
  stats.pulls++;
  note = ''; hinted = -1; tangled = false;
  HP.backStale = true;
  save();
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
  const r = $('#heapWrap').getBoundingClientRect();
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
    const segLen = (p) => { let a = 0; for (let k = 1; k < p.length; k++) a += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return a; };
    const lens = order.map((m) => L.cum[m][L.cum[m].length - 1] * sc);
    const yarnLen = lens.reduce((a, b) => a + b, 0);
    void segLen;
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
        paintYarn(ctx, yarnGeom(part, w, { vari: !!s.c2, hairs: false }), { w, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, lift: 1.6, lite: tracks.length > 1, glyphs: data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null });
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
      const sp = slotEl(+slot)?.querySelector('.spool');
      if (!sp) continue;
      if (fill[slot] > 0 && !windingOn.has(slot)) { windingOn.add(slot); sp.classList.add('winding'); }
      sp.style.setProperty('--f', (Math.min(SPOOL, nBefore[slot] + fill[slot]) / SPOOL).toFixed(3));
    }
  }
  showFly(false);
  for (const el of $$('.spool.winding')) el.classList.remove('winding');
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
  const b = (el?.querySelector('.peg') || $('#rack')).getBoundingClientRect();
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
  const peg = slotEl(slot)?.querySelector('.peg');
  const spool = peg?.querySelector('.spool');
  viewSkeins.push(c);
  if (!spool || reduced() || skip) { renderShelf(); return; }
  await anim(spool, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.05)', offset: 0.45 }, { transform: 'translateY(-4px) scale(.98)', offset: 0.75 }, { transform: 'translateY(-6px)' }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
  const r = spool.getBoundingClientRect();
  const sk = document.createElement('div');
  sk.className = 'flying';
  sk.innerHTML = skeinSVG(c);
  sk.style.cssText = `position:fixed;z-index:45;pointer-events:none;left:${r.left + r.width / 2 - 30}px;top:${r.top + r.height / 2 - 18}px;width:60px;height:36px`;
  document.body.append(sk);
  spool.style.opacity = '0';
  await anim(sk, [
    { transform: 'scale(.4, .9) rotate(-150deg)', opacity: 0.4 },
    { transform: 'scale(1.05, .95) rotate(-10deg)', opacity: 1, offset: 0.6 },
    { transform: 'none', opacity: 1 },
  ], { duration: 320, easing: 'ease-out' });
  const shelf = $('#shelf').getBoundingClientRect();
  const tx = Math.min(shelf.right - 20, shelf.left + viewSkeins.length * 27 - 13) - (r.left + r.width / 2);
  const ty = shelf.bottom - 12 - (r.top + r.height / 2);
  await anim(sk, [{ transform: 'none' }, { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - 26}px) scale(.75) rotate(-8deg)`, offset: 0.5 }, { transform: `translate(${tx}px, ${ty}px) scale(.42)` }], { duration: 360, easing: 'cubic-bezier(.45,0,.6,1)', fill: 'forwards' });
  sk.remove();
  renderShelf();
  const last = $('#shelf svg:last-child');
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
      ? `Its end is tucked under the glowing strand. Free that one first.`
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
    if (onRack >= 0) setTimeout(() => slotEl(onRack)?.querySelector('.peg')?.classList.add('hot'), 0);
  } else if (why.reason === 'rack') {
    const cs = why.colors.map(cshort);
    note = `${intro}The rack is full, and there’s no ${cs.join(' or ')} spool yet. Finish a spool to make room.`;
    if (cs.length > 1) note = `${intro}${g.length > 1 ? 'They need' : 'This one needs'} ${cs.join(' and ')} spools, and the rack is full. Finish a spool to make room.`;
    const rk = $('#rack');
    rk.classList.remove('nudge'); void rk.offsetWidth; rk.classList.add('nudge');
  }
  sfx('soft');
  render();
  if (why.reason === 'rack') $$('#rack .peg').forEach((p) => p.classList.add('hot'));
  kick();
}

// ---------- undo, spare slot, hint, start over ----------
function doUndo() {
  if (busy) { skipAll(); return; }
  if (!G.past.length) return;
  const was = G.state;
  G = undo(G);
  stats.undos++;
  note = 'Undone.'; hinted = -1; tangled = false;
  HP.backStale = true;
  for (let i = 0; i < L.n; i++) if (was.out[i] && !G.state.out[i]) { HP.fade[i] = reduced() ? 1 : 0; HP.lift[i] = 1.4; }
  save();
  render();
  kick();
}
function doSpare() {
  if (busy) return;
  if (!canNudge(G.state)) { restart(); return; }
  G = playNudge(G);
  stats.nudges++;
  note = 'A spare slot, just for this basket.'; tangled = false; hinted = -1;
  save();
  render();
  const last = $$('#rack .slot').at(-1);
  if (last && !reduced()) anim(last, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
}
function doHint() {
  if (busy) { skipAll(); return; }
  stats.hints++;
  try {
    const h = hint(L, G.state);
    if (h.kind === 'pull') {
      hinted = h.strand; tangled = false; hintT0 = performance.now();
      const g = groupOf(L, h.strand), s = L.strands[h.strand];
      note = g.length > 1 && L.snarlOf[g[0]] >= 0
        ? 'Try this snarl next: its strands glow, and they come out together.'
        : `Try this ${showsColor(L, G.state, h.strand) ? cshort(s.c) : ''} strand next. It glows.`.replace('this  strand', 'this strand');
      revealStrand(h.strand);
    } else if (h.kind === 'tangled') {
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
  const s = G.state;
  if (isDone(s) && !finishing) {
    finishing = true;
    try {
      if (!data.done[L.id]) { data.done[L.id] = true; save(); }
      sfx('chord');
      if (!reduced()) {
        const pill = document.createElement('div');
        pill.className = 'cheer flying';
        pill.textContent = 'All untangled!';
        $('#basket').append(pill);
        await anim(pill, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -62%)' }], { duration: 1300, easing: 'ease-out' });
        pill.remove();
      }
    } finally {
      finishing = false;
      openFinish();
    }
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
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
function tone(freq, dur, type = 'sine', gain = 0.04, when = 0, slide = 0) {
  const t = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind, k = 0) {
  if (!data.sound || !AC || skip) return;
  try {
    if (kind === 'pluck') { tone(392, 0.16, 'triangle', 0.035, 0, 1.5); }
    else if (kind === 'tick') tone(523 * 2 ** (PENTA[k % PENTA.length] / 12), 0.07, 'sine', 0.018);
    else if (kind === 'pop') { tone(330, 0.14, 'sine', 0.06, 0, 1.8); tone(988, 0.08, 'triangle', 0.02, 0.05); }
    else if (kind === 'soft') tone(262, 0.12, 'sine', 0.025, 0, 0.85);
    else if (kind === 'chord') [0, 4, 7, 12].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.6, 'sine', 0.025, i * 0.07));
  } catch { /* sound is a nicety */ }
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  skipAll();
  L = levelById(id) || LEVELS[0];
  data.cur = L.id;
  const g = data.game;
  if (!fresh && g && g.level === L.id && g.sig === L.sig) G = { state: g.state, past: g.past };
  else G = newGame(L);
  skip = false;
  hinted = -1; note = ''; tangled = false;
  if (rewound === L.id && !fresh) { note = 'This basket was rewound since your last visit, so it starts fresh.'; rewound = null; }
  buildGeometry();
  render();
  sizeHeap();
  save();
  maybeIntro();
}

// ---------- sheets ----------
function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  const p = el.querySelector('.panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('.btn.primary') || el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { el.hidden = true; }
document.addEventListener('click', (e) => {
  const sh = e.target.closest('.sheet');
  if (sh && (e.target === sh || e.target.closest('[data-close]'))) closeSheet(sh);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const sh of $$('.sheet')) if (!sh.hidden && sh.id !== 'introSheet') closeSheet(sh);
});

function thumb(Lv) {
  const cv = document.createElement('canvas');
  cv.width = 80; cv.height = 112;
  const c = cv.getContext('2d');
  const k = 80 / Lv.board.w;
  c.scale(k, k);
  c.lineCap = c.lineJoin = 'round';
  Lv.poly.forEach((p, i) => {
    const s = Lv.strands[i];
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (let q = 3; q < p.length; q += 3) c.lineTo(p[q][0], p[q][1]);
    c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    c.strokeStyle = TONE[s.c].edge; c.lineWidth = W * 0.95; c.stroke();
    c.strokeStyle = s.q ? HIDDEN_HEX : COLORS[s.c].hex; c.lineWidth = W * 0.7; c.stroke();
  });
  return cv;
}
function openLevels() {
  const box = $('#lvList');
  box.innerHTML = '';
  const firstOf = {};
  LEVELS.forEach((Lv, i) => { for (const m of Lv.mechanics) if (!(m in firstOf)) firstOf[m] = i; });
  BANDS.forEach((band, bi) => {
    const to = bi + 1 < BANDS.length ? BANDS[bi + 1].from : LEVELS.length;
    const h = document.createElement('h3');
    h.className = 'band';
    h.textContent = band.name;
    const ul = document.createElement('ul');
    ul.className = 'lvls';
    for (let i = band.from; i < to; i++) {
      const Lv = LEVELS[i];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(Lv === L));
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${data.done[Lv.id] ? ', untangled' : ''}${fresh.length ? `, new: ${MECHANICS[fresh[0]].name.toLowerCase()}` : ''}`);
      b.append(thumb(Lv));
      if (data.done[Lv.id]) { const t = document.createElement('span'); t.className = 'tick'; t.textContent = '✓'; t.setAttribute('aria-hidden', 'true'); b.append(t); }
      const t = document.createElement('span');
      t.className = 't';
      t.innerHTML = `<b>${i + 1} · ${Lv.n} strands</b>${Lv.name}${fresh.length ? `<br><span class="chip">new: ${MECHANICS[fresh[0]].name.toLowerCase()}</span>` : ''}`;
      b.append(t);
      b.addEventListener('click', () => { closeSheet($('#levelSheet')); if (Lv !== L) startLevel(Lv.id, { fresh: !(data.game && data.game.level === Lv.id) }); });
      li.append(b);
      ul.append(li);
    }
    box.append(h, ul);
  });
  $('#restartBtn').textContent = 'Start this basket over';
  openSheet('#levelSheet');
  $('#levelSheet [aria-current="true"]')?.scrollIntoView({ block: 'center' });
}

function openFinish() {
  if (!isDone(G.state) || !$('#finishSheet').hidden) return;
  const s = G.state;
  const k = knitsInto(s.skeins);
  $('#finTitle').textContent = `${L.name}: all untangled`;
  $('#finSub').textContent = `${k.skeins} ${k.skeins === 1 ? 'skein' : 'skeins'} wound and on the shelf.`;
  const counts = {};
  for (const c of s.skeins) counts[c] = (counts[c] || 0) + 1;
  const piles = Object.keys(counts).map((c) => `<div class="pile"><div class="sk">${skeinSVG(c).repeat(Math.min(4, counts[c]))}</div><span class="tag">${cname(c)}${counts[c] > 1 ? ` ×${counts[c]}` : ''}</span></div>`);
  let rows = '';
  for (let i = 0; i < piles.length; i += 4) rows += `<div class="row">${piles.slice(i, i + 4).join('')}</div>`;
  $('#finShelf').innerHTML = rows;
  $('#finKnits').textContent = k.line;
  $('#finYards').textContent = `About ${k.yards} yards of worsted, at 100 yards to a 50 g skein.`;
  const idx = LEVELS.indexOf(L);
  const next = LEVELS.slice(idx + 1).find((x) => !data.done[x.id]) || LEVELS[(idx + 1) % LEVELS.length];
  $('#finNext').textContent = `Next: ${next.name}`;
  $('#finNext').onclick = () => { closeSheet($('#finishSheet')); startLevel(next.id, { fresh: true }); };
  openSheet('#finishSheet');
  if (!reduced()) $$('#finShelf .sk svg').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 60, fill: 'backwards', easing: 'ease-out' }));
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
};
function maybeIntro() {
  if (!data.seenHow) return;
  const fresh = L.mechanics.filter((m) => !data.seenIntro[m] && MECHANICS[m]);
  if (!fresh.length) return;
  $('#introTitle').textContent = fresh.length > 1 ? 'Some new things in the basket' : 'Something new in the basket';
  $('#introBody').innerHTML = fresh.map((m) => `<div class="item">${ICON[m] || ''}<p><strong>${MECHANICS[m].name}</strong>${MECHANICS[m].line}</p></div>`).join('');
  $('#introOk').onclick = () => { for (const m of fresh) data.seenIntro[m] = true; save(); closeSheet($('#introSheet')); };
  openSheet('#introSheet');
}

// How this works: three short steps.
const ILL = {
  pull: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <rect x="4" y="4" width="312" height="122" rx="16" fill="#ECE2CC"/>
    ${yarnIcon('M30 100C80 30 140 110 190 50', '#34588E', 16)}
    <path d="M38 108C92 44 146 116 202 60" fill="none" stroke="rgba(60,40,20,.16)" stroke-width="18" stroke-linecap="round"/>
    ${yarnIcon('M40 30C110 60 150 20 240 70', '#B9473A', 16)}
    <path d="M250 74 C 272 84 286 74 294 52" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
    <path d="M286 56l8-6 2 10" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  spools: `<svg class="ill" viewBox="0 0 320 110" aria-hidden="true">
    <rect x="10" y="20" width="200" height="74" rx="12" fill="#C9AA7C"/>
    ${[['#B9473A', 2], ['#34588E', 1], ['#5F8A3A', 0]].map(([c, n], i) => `<g transform="translate(${30 + i * 62},28)"><rect x="0" y="0" width="34" height="7" rx="3.5" fill="#B38A57"/><rect x="0" y="50" width="34" height="7" rx="3.5" fill="#B38A57"/><rect x="${12 - n * 5}" y="7" width="${10 + n * 10}" height="43" rx="4" fill="${n ? c : '#D6B888'}"/><text x="17" y="72" text-anchor="middle" font-size="11" font-family="Figtree, sans-serif" fill="#4A3A26">${n ? `${3 - n} more` : 'empty'}</text></g>`).join('')}
    <g transform="translate(232,34) scale(1.1)">${skeinSVG('m').replace('<svg viewBox="0 0 66 40" aria-hidden="true">', '').replace('</svg>', '')}</g>
    <path d="M206 50 C 216 40 222 40 230 46" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 6"/>
  </svg>`,
  plan: `<svg class="ill" viewBox="0 0 320 120" aria-hidden="true">
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
  $('#howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'on' : ''}"></i>`).join('');
  $('#howBack').disabled = howStep === 0;
  $('#howNext').textContent = howStep === HOW.length - 1 ? 'Start untangling' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#howSheet'); }

// ---------- wiring ----------
$('#undoBtn').addEventListener('click', doUndo);
$('#stuckBtn').addEventListener('click', doSpare);
$('#hintBtn').addEventListener('click', doHint);
$('#levelsBtn').addEventListener('click', () => { if (!busy) openLevels(); });
$('#howBtn').addEventListener('click', () => { if (!busy) openHow(); });
$('#howBtn2').addEventListener('click', () => { closeSheet($('#levelSheet')); openHow(); });
$('#glyphBtn').addEventListener('click', () => { data.glyphs = !data.glyphs; save(); buildSprites(HP.kr0); planRaster(); render(); kick(); });
// (both toggles sit in the Baskets sheet, beside Start over)
$('#soundBtn').addEventListener('click', () => { data.sound = !data.sound; save(); ensureAudio(); render(); sfx('pop'); });
$('#howBack').addEventListener('click', () => { if (howStep > 0) { howStep--; renderHow(); } });
$('#howNext').addEventListener('click', () => {
  if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
  closeSheet($('#howSheet'));
  if (!data.seenHow) { data.seenHow = true; save(); maybeIntro(); }
});
let restartArmed = 0;
$('#restartBtn').addEventListener('click', () => {
  if (!restartArmed && G.state.moves > 0 && !isDone(G.state)) {
    restartArmed = setTimeout(() => { restartArmed = 0; $('#restartBtn').textContent = 'Start this basket over'; }, 3000);
    $('#restartBtn').textContent = 'Tap again to start over';
    return;
  }
  clearTimeout(restartArmed); restartArmed = 0;
  closeSheet($('#levelSheet'));
  restart();
});
$('#finAgain').addEventListener('click', () => { closeSheet($('#finishSheet')); startLevel(L.id, { fresh: true }); });
$('#finAll').addEventListener('click', () => { closeSheet($('#finishSheet')); openLevels(); });
let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (L && !busy) { const v = HP.view; sizeHeap(); HP.view = clampView(HP.fit, L.board, v); setK(); HP.cacheFull = true; HP.full = true; planRaster(); render(); } }, 120); });
document.addEventListener('visibilitychange', () => { if (document.hidden && busy) skipAll(); });

// ---------- boot ----------
SPOT = spotSprite();
load();
startLevel(data.cur);
if (!data.seenHow) openHow();
else if (isDone(G.state)) openFinish();

// For quick checks from the console or a test harness (read-only peeks, and a view setter).
window.__tangle = {
  get level() { return L; }, get state() { return G.state; }, get busy() { return busy; }, get hinted() { return hinted; },
  get note() { return note; }, get stats() { return { ...stats }; }, get view() { return { ...HP.view }; }, get gesturing() { return GEST.active; },
  get perf() { return { frames: PERF.frames, dyn: HP.dyn.length, heap: PERF.heap.slice(), fly: PERF.fly.slice(), gesture: PERF.gesture.slice(), rasterLeft: HP.rasterQ.length }; },
  get wiggling() { return !!HP.wig; }, get glowing() { return HP.glowUntil.map((t, i) => (t > performance.now() ? i : -1)).filter((i) => i >= 0); },
  get tapped() { return HP.tapUntil > performance.now() ? HP.tapped.slice() : []; },
  get spriteMB() { let px = 0; for (const s of HP.spr) for (const k of ['flat', 'shadow', 'grayFlat', 'glow', 'tap']) if (s[k]) px += s[k].width * s[k].height; for (const p of HP.patches.values()) px += p.c.width * p.c.height; return (px * 4) / 1e6; },
  setView(v) { settleView(v); },
  // the page point of a strand's most open spot inside the window (for taps from a test)
  pointOf(i) {
    if (!L.poly[i]) return null;
    const r = $('#heapWrap').getBoundingClientRect(), s = G.state, v = HP.view;
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
  strandAt(x, y) { const r = $('#heapWrap').getBoundingClientRect(); return strandAt(x - r.left, y - r.top); },
  // time re-rasterizing strand bitmaps at a quality (ms per strand)
  rasterBench(q = 1, n = 6) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) rasterStrand(i, HP.kr0 * q);
    const t = (performance.now() - t0) / n;
    for (let i = 0; i < n; i++) rasterStrand(i, HP.kr0);
    HP.cacheFull = true; kick();
    return t;
  },
  // time the heap painter: a full cache rebuild, and an ordinary frame (ms)
  bench(n = 10) {
    const t0 = performance.now();
    for (let k = 0; k < n; k++) { HP.cacheFull = true; HP.full = true; drawHeap(performance.now()); }
    const t1 = performance.now();
    for (let k = 0; k < n; k++) { HP.full = true; drawHeap(performance.now()); }
    const t2 = performance.now();
    return { rebuild: (t1 - t0) / n, frame: (t2 - t1) / n, dyn: HP.dyn.length, strands: L.n - G.state.out.reduce((a, x) => a + x, 0) };
  },
};
