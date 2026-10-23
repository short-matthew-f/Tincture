// The Tangle Basket: UI, rendering and animation. Rules live in rules.js (pure).
//
// The heap is one canvas in board units (100 x 140). Strands that nothing can
// move (covered, not animating) are painted bottom to top into a cached
// bitmap; strands that can move (uncovered ones sit slightly raised, plus
// anything wiggling, glowing or fading) are drawn on top every frame, together
// with everything lying over them, so the over/under order is always right.
// A pulled strand leaves the heap at once and slithers along its own path on a
// full-screen overlay canvas, then winds onto its spool in the rack (DOM).
import {
  W, BOARD, SPOOL, COLORS, HIDDEN_HEX, nearDist, newGame, play, playNudge, undo, whyNot, canPull, isUncovered,
  isPinned, showsColor, isDone, isStuck, canNudge, hint, groupOf, colorsOf, knitsInto, remaining, VERSION,
} from './rules.js';
import { LEVELS, MECHANICS, BANDS, levelById } from './levels.js';

const KEY = 'tincture.proto.tangle';
const HISTORY_SAVED = 300; // undo is unlimited in a session; the save keeps the last 300 steps
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : Number.isFinite(t) ? t : 1);
const ease = (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;

// ---------- color ----------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const lum = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toneOf = (hex) => ({ base: hex, edge: mixHex(hex, '#24160A', 0.36), light: mixHex(hex, '#FFF6E4', 0.35), ink: lum(hex) > 0.28 ? 'rgba(42,30,20,.85)' : 'rgba(255,250,238,.95)' });
const TONE = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toneOf(c.hex)]));
const GRAY = toneOf(HIDDEN_HEX);
const cname = (c) => COLORS[c].name;
const cshort = (c) => COLORS[c].short;

// ---------- glyphs (colorblind help), on strands, pins and spools ----------
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
// for the heap (board units) and per frame for a strand in motion.
const LIGHT = [-0.5, -0.866];
const LIFT_UP = 0.17; // a raised strand sits this many yarn-widths up
function yarnGeom(pts, w, { vari = false } = {}) {
  const n = pts.length;
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  const len = cum[n - 1] || 0.001;
  const path = new Path2D();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < n; k++) path.lineTo(pts[k][0], pts[k][1]);
  const walker = () => {
    let seg = 0;
    return (s) => {
      while (seg < n - 2 && cum[seg + 1] < s) seg++;
      const a = pts[seg], b = pts[Math.min(n - 1, seg + 1)];
      const sl = cum[seg + 1] - cum[seg] || 1;
      const t = Math.max(0, Math.min(1, (s - cum[seg]) / sl));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / sl, (b[1] - a[1]) / sl];
    };
  };
  // ply: a diagonal groove and a highlight every pitch, like a two-ply twist
  const grooves = new Path2D(), shines = new Path2D();
  const pitch = w * 0.52, r = w * 0.36, a = w * 0.34;
  const at = walker();
  for (let s = pitch * 0.5; s < len - w * 0.25; s += pitch) {
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
  for (let k = 0; k < n; k += 2) {
    const p = pts[Math.max(0, k - 1)], q = pts[Math.min(n - 1, k + 1)];
    const dl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / dl, ny = (q[0] - p[0]) / dl;
    const d = nx * LIGHT[0] + ny * LIGHT[1];
    const ox = nx * d * w * 0.24, oy = ny * d * w * 0.24;
    if (k === 0) { sheen.moveTo(pts[k][0] + ox, pts[k][1] + oy); shade.moveTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); } else { sheen.lineTo(pts[k][0] + ox, pts[k][1] + oy); shade.lineTo(pts[k][0] - ox * 1.1, pts[k][1] - oy * 1.1); }
  }
  // where glyphs go (centered in a color band on two-color yarn)
  const spots = [];
  const at2 = walker();
  const dash = w * 1.7;
  if (vari) {
    for (let k = 1; (k + 0.5) * dash < len - w; k += 3) { const p = at2((k + 0.5) * dash); spots.push([p[0], p[1], k % 2]); }
  } else {
    for (let s = Math.min(9, len / 2); s < len - 2; s += 22) { const p = at2(s); spots.push([p[0], p[1], 0]); }
  }
  return { path, grooves, shines, sheen, shade, spots, len, dash: [dash, dash] };
}

// o: { w, tone, tone2, lift, glow, hidden, alpha, glyphs: [c, c2] | null, shadow }
function paintYarn(ctx, g, o) {
  const w = o.w, lift = o.lift || 0;
  ctx.save();
  if (o.alpha !== undefined && o.alpha < 1) ctx.globalAlpha = Math.max(0, o.alpha);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
    ctx.strokeStyle = `rgba(255,252,240,${0.85 * o.tapped})`; ctx.lineWidth = w * 1.5; ctx.stroke(g.path);
  }
  if (o.glow > 0) {
    ctx.strokeStyle = `rgba(242,190,70,${0.55 * o.glow})`; ctx.lineWidth = w * 1.85; ctx.stroke(g.path);
    ctx.strokeStyle = `rgba(255,243,205,${0.85 * o.glow})`; ctx.lineWidth = w * 1.32; ctx.stroke(g.path);
  }
  const body = (t, t2) => {
    ctx.strokeStyle = t.edge; ctx.lineWidth = w; ctx.stroke(g.path);
    ctx.strokeStyle = t.base; ctx.lineWidth = w * 0.8; ctx.stroke(g.path);
    if (t2) {
      ctx.setLineDash(g.dash); ctx.lineCap = 'butt';
      ctx.strokeStyle = t2.edge; ctx.lineWidth = w; ctx.stroke(g.path);
      ctx.strokeStyle = t2.base; ctx.lineWidth = w * 0.8; ctx.stroke(g.path);
      ctx.setLineDash([]); ctx.lineCap = 'round';
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
let data = { v: 1, cur: LEVELS[0].id, done: {}, glyphs: false, sound: false, seenHow: false, seenIntro: {}, game: null };
function save() {
  try {
    const g = G ? { level: L.id, sig: L.sig, state: G.state, past: G.past.slice(-HISTORY_SAVED) } : null;
    localStorage.setItem(KEY, JSON.stringify({ ...data, cur: L ? L.id : data.cur, game: g }));
  } catch { /* storage may be blocked; play goes on */ }
}
function validState(Lv, s) {
  if (!s || s.v !== VERSION || s.level !== Lv.id || !Array.isArray(s.out) || s.out.length !== Lv.n) return false;
  if (!s.out.every((x) => x === 0 || x === 1)) return false;
  if (!Number.isInteger(s.extra) || s.extra < 0 || s.extra > 1 || !Number.isInteger(s.moves) || s.moves < 0) return false;
  if (!Array.isArray(s.rack) || s.rack.length !== Lv.slots + s.extra || !Array.isArray(s.skeins)) return false;
  // the rack must agree with what has been pulled
  const cnt = {};
  for (let i = 0; i < Lv.n; i++) if (s.out[i]) for (const c of colorsOf(Lv, i)) cnt[c] = (cnt[c] || 0) + 1;
  const onRack = {};
  for (const x of s.rack) {
    if (x === null) continue;
    if (!x || !Lv.colors.includes(x.c) || !Number.isInteger(x.n) || x.n < 1 || x.n >= SPOOL || onRack[x.c]) return false;
    onRack[x.c] = x.n;
  }
  for (const c of Lv.colors) if ((cnt[c] || 0) % SPOOL !== (onRack[c] || 0)) return false;
  const sk = Object.values(cnt).reduce((a, v) => a + Math.floor(v / SPOOL), 0);
  return s.skeins.length === sk && s.skeins.every((c) => Lv.colors.includes(c));
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === 'object' && o.v === 1) {
      const done = {};
      if (o.done && typeof o.done === 'object') for (const id of Object.keys(o.done)) if (levelById(id) && o.done[id]) done[id] = true;
      data = {
        ...data, cur: typeof o.cur === 'string' ? o.cur : data.cur, done,
        glyphs: !!o.glyphs, sound: !!o.sound, seenHow: !!o.seenHow,
        seenIntro: o.seenIntro && typeof o.seenIntro === 'object' ? o.seenIntro : {},
        game: o.game && typeof o.game === 'object' ? o.game : null,
      };
    }
  } catch { /* a fresh start */ }
  if (!levelById(data.cur)) data.cur = LEVELS[0].id;
}

// ---------- state ----------
let L = null, G = null, busy = false, skip = false, note = '', hinted = -1, tangled = false, howStep = 0;
let viewRack = null, viewSkeins = null; // what the rack and shelf show while animating
let queuedTap = null;
let winding = null; // the color going onto a spool right now
const skipWaiters = new Set();
const stats = { pulls: 0, blocked: 0, undos: 0, hints: 0, nudges: 0 };

function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  for (const a of document.getAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
}
function wait(ms) {
  if (skip || ms <= 0) return Promise.resolve();
  return new Promise((r) => {
    const done = () => { clearTimeout(t); skipWaiters.delete(done); r(); };
    const t = setTimeout(done, ms);
    skipWaiters.add(done);
  });
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
    afterMove();
    const q = queuedTap;
    queuedTap = null;
    if (q && !isDone(G.state)) setTimeout(() => tapAt(q.x, q.y), 0);
  }
}

// ---------- the heap painter ----------
const HP = {
  cv: null, ctx: null, cache: null, cctx: null, bg: null, dpr: 1, scale: 3, cssW: 300, cssH: 375, k: 1,
  geo: [], spotsByU: [], cacheSig: '', dyn: [], dynSet: new Set(),
  lift: [], liftV: [], hid: [], glow: [], glowUntil: [], fade: [], wig: null, pinFx: [], tapped: [], tapUntil: 0, spr: [], lastSig: [], lastDrawn: [], full: true,
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
function hash(a, b) { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildBg() {
  const c = document.createElement('canvas');
  c.width = HP.cv.width; c.height = HP.cv.height;
  const x = c.getContext('2d');
  // a linen lining with a soft weave and a little depth at the edges
  x.fillStyle = '#ECE2CC'; x.fillRect(0, 0, c.width, c.height);
  const st = Math.max(2, Math.round(HP.dpr * 2));
  x.fillStyle = 'rgba(150,120,80,.07)';
  for (let y = 0; y < c.height; y += st) x.fillRect(0, y, c.width, 1);
  x.fillStyle = 'rgba(150,120,80,.05)';
  for (let xx = 0; xx < c.width; xx += st) x.fillRect(xx, 0, 1, c.height);
  x.fillStyle = 'rgba(255,255,255,.08)';
  for (let k = 0; k < 900; k++) x.fillRect(hash(k, 1) * c.width, hash(k, 2) * c.height, st * 2, 1);
  const v = x.createRadialGradient(c.width / 2, c.height * 0.46, c.width * 0.25, c.width / 2, c.height / 2, c.width * 0.85);
  v.addColorStop(0, 'rgba(90,60,30,0)'); v.addColorStop(1, 'rgba(90,60,30,.22)');
  x.fillStyle = v; x.fillRect(0, 0, c.width, c.height);
  HP.bg = c;
}

function buildGeometry() {
  HP.geo = L.poly.map((p, i) => yarnGeom(p, W, { vari: !!L.strands[i].c2 }));
  HP.spotsByU = L.poly.map(() => []);
  for (const s of L.spots) HP.spotsByU[s.u].push(s);
  const n = L.n, st = G.state;
  HP.lift = Array(n).fill(0); HP.liftV = Array(n).fill(0);
  for (let i = 0; i < n; i++) HP.lift[i] = liftTarget(i, st);
  HP.hid = L.strands.map((_, i) => (showsColor(L, st, i) ? 0 : 1));
  HP.glow = Array(n).fill(0); HP.glowUntil = Array(n).fill(0); HP.fade = Array(n).fill(1);
  HP.wig = null; HP.pinFx = []; HP.cacheSig = ''; HP.lastSig = []; HP.lastDrawn = []; HP.full = true;
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
  const cssW = Math.max(220, Math.floor(Math.min(availW, (availH / BOARD.h) * BOARD.w)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  HP.dpr = dpr; HP.cssW = cssW; HP.scale = cssW / BOARD.w; HP.cssH = Math.round(HP.scale * BOARD.h);
  HP.k = dpr * HP.scale;
  const cv = $('#heap');
  HP.cv = cv; HP.ctx = cv.getContext('2d');
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(HP.cssH * dpr);
  cv.style.width = `${cssW}px`; cv.style.height = `${HP.cssH}px`;
  HP.cache = document.createElement('canvas');
  HP.cache.width = cv.width; HP.cache.height = cv.height;
  HP.cctx = HP.cache.getContext('2d');
  buildBg();
  buildSprites();
  sizeFly();
  kick();
}

const liftTarget = (i, st) => (st.out[i] ? 0 : isUncovered(L, st, i) ? (isPinned(L, st, i) ? 0.5 : 1) : 0);

// Strands drawn live this frame: anything that moves, plus everything lying
// over it (so they still cover it), plus a knot partner lying over it.
function dynamicSet(now) {
  const st = G.state, D = new Set();
  for (let i = 0; i < L.n; i++) {
    if (st.out[i] && HP.fade[i] >= 1) continue;
    const moving = isUncovered(L, st, i) || Math.abs(HP.lift[i]) > 0.01 || Math.abs(HP.liftV[i]) > 0.01 ||
      HP.glow[i] > 0.001 || HP.glowUntil[i] > now || HP.fade[i] < 1 || i === hinted || (HP.tapUntil > now && HP.tapped.includes(i)) ||
      Math.abs(HP.hid[i] - (showsColor(L, st, i) ? 0 : 1)) > 0.001 || (HP.wig && HP.wig.ids.includes(i));
    if (moving) D.add(i);
  }
  const stack = [...D];
  while (stack.length) {
    const i = stack.pop();
    const ups = L.over[i].slice();
    if (L.partner[i] > i) ups.push(L.partner[i]);
    for (const j of ups) if (!st.out[j] && !D.has(j)) { D.add(j); stack.push(j); }
  }
  return D;
}

// The hint breathes three times, then holds still (no endless redraws).
let hintT0 = 0;
const HINT_MS = 3 * 2 * Math.PI * 260;
const hintGlow = (now) => (reduced() || now - hintT0 > HINT_MS ? 0.9 : 0.55 + 0.45 * Math.cos((now - hintT0) / 260));
function strandStyle(i, now) {
  const s = L.strands[i];
  const gl = Math.max(HP.glow[i], i === hinted ? hintGlow(now) : 0);
  return {
    w: W, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, lift: HP.lift[i], glow: gl, hidden: HP.hid[i],
    tapped: HP.tapUntil > now && HP.tapped.includes(i) ? Math.min(1, (HP.tapUntil - now) / 300) : 0,
    alpha: HP.fade[i], glyphs: data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null,
  };
}
// Contact shadows where strand i lies over another (device px, identity transform).
function drawSpots(ctx, i) {
  const st = G.state, k = HP.k, r = W * 1.05 * k;
  for (const sp of HP.spotsByU[i]) if (!st.out[sp.l] || HP.fade[sp.l] < 1) ctx.drawImage(SPOT, sp.x * k - r, sp.y * k - r, 2 * r, 2 * r);
}

// ---------- sprites: each strand pre-painted once per layout ----------
// body (yarn, ply, glyphs), a half-resolution soft shadow, the gray "buried"
// look for strands that have one, and glow halos made the first time they're
// needed. Drawing the heap is then a few bitmap copies per strand.
const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };
function freeSprites() {
  for (const sp of HP.spr) if (sp) for (const key of ['body', 'shadow', 'gray', 'glow', 'tap', 'flat', 'flatGray']) freeCanvas(sp[key]);
  HP.spr = [];
}
function paintSprite(sp, fn, res = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(sp.w * res)); c.height = Math.max(1, Math.ceil(sp.h * res));
  const x = c.getContext('2d');
  x.setTransform(HP.k * res, 0, 0, HP.k * res, -sp.x * res, -sp.y * res);
  fn(x);
  return c;
}
function buildSprites() {
  freeSprites();
  const k = HP.k, pad = W * 1.15;
  HP.spr = L.poly.map((poly, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const X0 = Math.floor((x0 - pad) * k), Y0 = Math.floor((y0 - pad) * k);
    const sp = { x: X0, y: Y0, w: Math.ceil((x1 + pad) * k) - X0, h: Math.ceil((y1 + pad) * k) - Y0, body: null, shadow: null, gray: null, glow: null, tap: null };
    const s = L.strands[i], g = HP.geo[i];
    sp.body = paintSprite(sp, (c) => paintYarn(c, g, { w: W, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, shadow: false, glyphs: data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null }));
    sp.shadow = paintSprite(sp, (c) => {
      c.lineCap = c.lineJoin = 'round';
      c.strokeStyle = 'rgba(60,40,20,.2)'; c.lineWidth = W * 1.22; c.stroke(g.path);
      c.translate(W * 0.07, W * 0.14);
      c.strokeStyle = 'rgba(60,40,20,.08)'; c.lineWidth = W * 1.62; c.stroke(g.path);
    }, 0.5);
    if (s.q) sp.gray = paintSprite(sp, (c) => paintYarn(c, g, { w: W, tone: GRAY, shadow: false, qmarks: true }));
    // at rest, in the cache: shadow and body in one bitmap (and a gray one if it can be buried)
    const flat = (top) => paintSprite(sp, (c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(sp.shadow, W * 0.1 * k, W * 0.18 * k, sp.w, sp.h);
      c.drawImage(top, 0, 0);
    });
    sp.flat = flat(sp.body);
    if (sp.gray) sp.flatGray = flat(sp.gray);
    return sp;
  });
  HP.cacheSig = ''; HP.full = true;
}
function haloOf(i, kind) {
  const sp = HP.spr[i];
  if (!sp[kind]) {
    const g = HP.geo[i];
    sp[kind] = paintSprite(sp, (c) => {
      c.lineCap = c.lineJoin = 'round';
      if (kind === 'glow') {
        c.strokeStyle = 'rgba(242,190,70,.55)'; c.lineWidth = W * 1.85; c.stroke(g.path);
        c.strokeStyle = 'rgba(255,243,205,.85)'; c.lineWidth = W * 1.32; c.stroke(g.path);
      } else {
        c.strokeStyle = 'rgba(255,252,240,.85)'; c.lineWidth = W * 1.5; c.stroke(g.path);
      }
    });
  }
  return sp[kind];
}
// One strand from its sprites (identity transform, device px).
function blitStrand(ctx, i, o) {
  const sp = HP.spr[i], k = HP.k;
  const lift = o.lift || 0, kk = 1 + Math.max(0, lift) * 2;
  const up = Math.round(lift * W * LIFT_UP * k * 4) / 4;
  const a = o.alpha === undefined ? 1 : Math.max(0, o.alpha);
  ctx.globalAlpha = a;
  ctx.drawImage(sp.shadow, sp.x + W * 0.1 * kk * k, sp.y + W * 0.18 * kk * k, sp.w, sp.h);
  if (o.tapped > 0) { ctx.globalAlpha = a * o.tapped; ctx.drawImage(haloOf(i, 'tap'), sp.x, sp.y - up); }
  if (o.glow > 0) { ctx.globalAlpha = a * Math.min(1, o.glow); ctx.drawImage(haloOf(i, 'glow'), sp.x, sp.y - up); }
  ctx.globalAlpha = a;
  ctx.drawImage(sp.body, sp.x, sp.y - up);
  if (o.hidden > 0 && sp.gray) { ctx.globalAlpha = a * Math.min(1, o.hidden); ctx.drawImage(sp.gray, sp.x, sp.y - up); }
  ctx.globalAlpha = 1;
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
  // the wrap: a band of the first color around the middle
  ctx.strokeStyle = ta.edge; ctx.lineWidth = w * 0.36; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-w * 0.05, -w * 0.6); ctx.quadraticCurveTo(w * 0.18, 0, -w * 0.05, w * 0.6); ctx.stroke();
  ctx.strokeStyle = ta.base; ctx.lineWidth = w * 0.24;
  ctx.beginPath(); ctx.moveTo(-w * 0.05, -w * 0.58); ctx.quadraticCurveTo(w * 0.18, 0, -w * 0.05, w * 0.58); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,230,.4)'; ctx.lineWidth = w * 0.07;
  ctx.beginPath(); ctx.ellipse(-w * 0.42, -w * 0.12, w * 0.26, w * 0.3, 0, 3.3, 4.6); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(w * 0.3, -w * 0.12, w * 0.26, w * 0.3, 0, 3.3, 4.6); ctx.stroke();
  ctx.restore();
}
function drawKnot(ctx, i, lift = 0) {
  const a = Math.min(i, L.partner[i]), b = Math.max(i, L.partner[i]);
  const pa = L.poly[a], j = pa[pa.length - 1], q = pa[pa.length - 4];
  const up = lift * W * LIFT_UP;
  knotAt(ctx, [j[0], j[1] - up], Math.atan2(j[1] - q[1], j[0] - q[0]), TONE[L.strands[a].c], TONE[L.strands[b].c], W);
}
// A strand with its pin and knot. ctx comes in with the identity transform.
function drawStrand(ctx, i, now, style = strandStyle(i, now)) {
  const w = HP.wig;
  const k = HP.k;
  let live = null;
  if (w && w.ids.includes(i)) {
    // a wiggle bends the yarn near the tap, so this one is painted live
    const t = clamp01((now - w.t0) / w.dur);
    const amp = 1.5 * Math.sin(t * Math.PI * 5) * (1 - t);
    if (Math.abs(amp) > 0.01) {
      const poly = L.poly[i], cum = L.cum[i], s0 = w.at[i];
      live = yarnGeom(poly.map((p, j) => {
        const q = poly[Math.min(poly.length - 1, j + 1)], r = poly[Math.max(0, j - 1)];
        const dl = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
        const f = amp * Math.exp(-(((cum[j] - s0) / 13) ** 2));
        return [p[0] - ((q[1] - r[1]) / dl) * f, p[1] + ((q[0] - r[0]) / dl) * f];
      }), W, { vari: !!L.strands[i].c2 });
    }
  }
  if (live) {
    const sp = HP.spr[i], kk = 1 + Math.max(0, style.lift || 0) * 2;
    ctx.drawImage(sp.shadow, sp.x + W * 0.1 * kk * k, sp.y + W * 0.18 * kk * k, sp.w, sp.h);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    paintYarn(ctx, live, { ...style, shadow: false, lite: true });
  } else blitStrand(ctx, i, style);
  const st = G.state;
  const pinned = L.pinBy[i] >= 0 && !st.out[L.pinBy[i]];
  const knot = L.partner[i] >= 0 && L.partner[i] < i;
  if (pinned || knot) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (pinned) drawPin(ctx, i, { lift: style.lift, glow: HP.glow[i] > 0 && HP.glowPin === i ? HP.glow[i] : 0, alpha: style.alpha });
    if (knot) drawKnot(ctx, i, style.lift);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function ensureCache(now) {
  const D = dynamicSet(now);
  const st = G.state;
  let sig = data.glyphs ? 'g' : '';
  for (let i = 0; i < L.n; i++) if (!st.out[i] && !D.has(i)) sig += `${i}${showsColor(L, st, i) ? '' : 'h'}${isPinned(L, st, i) ? 'p' : ''},`;
  HP.dynSet = D;
  HP.dyn = [...D].sort((a, b) => a - b);
  if (sig === HP.cacheSig) return false;
  HP.cacheSig = sig;
  const c = HP.cctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, HP.cache.width, HP.cache.height);
  c.drawImage(HP.bg, 0, 0);
  for (let i = 0; i < L.n; i++) {
    if (st.out[i] || D.has(i)) continue;
    drawSpots(c, i);
    const sp = HP.spr[i];
    c.drawImage(!showsColor(L, st, i) && sp.flatGray ? sp.flatGray : sp.flat, sp.x, sp.y);
    if ((L.pinBy[i] >= 0 && isPinned(L, st, i)) || (L.partner[i] >= 0 && L.partner[i] < i)) {
      c.setTransform(HP.k, 0, 0, HP.k, 0, 0);
      if (isPinned(L, st, i)) drawPin(c, i);
      if (L.partner[i] >= 0 && L.partner[i] < i) drawKnot(c, i, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  return true;
}

// Each frame repaints only where something changed: the rectangles of live
// strands whose look moved since the last frame (and of strands that just
// left the live set), with every live strand that overlaps them redrawn on top
// of the cached heap in order. A rebuilt cache or a new layout repaints all.
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function drawHeap(now) {
  const c = HP.ctx, k = HP.k, st = G.state;
  const rebuilt = ensureCache(now);
  const m = W * 1.3 * k;
  const rectOf = (i) => { const sp = HP.spr[i]; return [sp.x - m, sp.y - m, sp.x + sp.w + m, sp.y + sp.h + m]; };
  const styles = new Map(), rects = [];
  for (const i of HP.dyn) {
    if (st.out[i] && HP.fade[i] >= 1) continue;
    const y = strandStyle(i, now);
    styles.set(i, y);
    const wig = HP.wig && HP.wig.ids.includes(i);
    const sig = `${y.lift.toFixed(3)}|${y.glow.toFixed(3)}|${y.hidden.toFixed(3)}|${(y.alpha ?? 1).toFixed(3)}|${y.tapped.toFixed(3)}|${wig ? now : ''}|${isPinned(L, st, i) ? 1 : 0}|${HP.glowPin === i ? 1 : 0}`;
    if (HP.lastSig[i] !== sig) { HP.lastSig[i] = sig; rects.push(rectOf(i)); }
  }
  for (const i of HP.lastDrawn) if (!styles.has(i)) { rects.push(rectOf(i)); HP.lastSig[i] = ''; }
  HP.lastDrawn = [...styles.keys()];
  for (const f of HP.pinFx) {
    const p = L.poly[f.i][L.pinAt[f.i]], r = W * 4 * k;
    rects.push([p[0] * k - r, p[1] * k - r * 1.5, p[0] * k + r, p[1] * k + r]);
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
  for (const i of HP.dyn) {
    const y = styles.get(i);
    if (!y) continue;
    if (!full) { const r = rectOf(i); if (!rects.some((q) => overlaps(r, q))) continue; }
    drawSpots(c, i);
    drawStrand(c, i, now, y);
  }
  // pins popping out
  c.setTransform(k, 0, 0, k, 0, 0);
  for (let j = HP.pinFx.length - 1; j >= 0; j--) {
    const f = HP.pinFx[j];
    const t = clamp01((now - f.t0) / 420);
    drawPin(c, f.i, { off: ease(t) * W * 2.2, alpha: 1 - t, lift: 1 });
    if (t >= 1) HP.pinFx.splice(j, 1);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!full) c.restore();
  HP.full = false;
}

// Springs: uncovered strands lift, buried colors fade in, glows fade out.
function physics(dt, now) {
  const st = G.state, rm = reduced();
  let moving = false;
  const K = 260, C = 2 * 0.78 * Math.sqrt(K); // about 2% overshoot
  for (let i = 0; i < L.n; i++) {
    const tgt = liftTarget(i, st) + (HP.glowUntil[i] > now ? 0.6 : 0);
    if (rm) { HP.lift[i] = tgt; HP.liftV[i] = 0; } else if (Math.abs(HP.lift[i] - tgt) > 0.002 || Math.abs(HP.liftV[i]) > 0.002) {
      const a = K * (tgt - HP.lift[i]) - C * HP.liftV[i];
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
    more = more || !!HP.wig || HP.pinFx.length > 0 || (hinted >= 0 && now - hintT0 < HINT_MS + 50) || HP.tapUntil > now - 50;
  } catch (e) {
    console.error('The Tangle Basket: a frame was skipped', e);
  }
  PERF.frames++;
  PERF.heap.push(performance.now() - w0);
  if (PERF.heap.length > 2000) PERF.heap.shift();
  if (more) raf = requestAnimationFrame(frame);
}
const PERF = { frames: 0, heap: [], fly: [] }; // main-thread ms per heap frame and per in-flight frame

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
  let b = FLY.box || [Infinity, Infinity, -Infinity, -Infinity];
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
  if (!s.moves) return LEVELS.indexOf(L) === 0
    ? 'Tap a strand that sits raised, with nothing lying on top. It slides out and winds onto a spool.'
    : 'Raised strands have nothing on top. Tap one to pull it free.';
  const left = remaining(s);
  if (s.rack.every(Boolean)) return `The rack is full: pull a color that’s already on a spool. ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
  return `Lovely. ${left} ${left === 1 ? 'strand' : 'strands'} to go.`;
}

// Screen readers and keyboards: the strands with nothing on top, as buttons.
function renderSr() {
  const s = G.state;
  const items = [];
  for (let i = 0; i < L.n; i++) {
    if (s.out[i] || !isUncovered(L, s, i) || groupOf(L, i)[0] !== i && isUncovered(L, s, groupOf(L, i)[0])) continue;
    const g = groupOf(L, i);
    const name = g.map((m) => `${colorsOf(L, m).map(cname).join(' and ')} strand`).join(' knotted to a ');
    const extra = isPinned(L, s, i) ? ', pinned' : !canPull(L, s, i) ? ', waiting for room on the rack' : '';
    items.push(`<button type="button" data-strand="${i}">${name}${extra}</button>`);
  }
  $('#srList').innerHTML = items.join('');
}

// ---------- input ----------
let down = null;
const heapEl = $('#heap');
heapEl.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  down = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
heapEl.addEventListener('pointerup', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 16;
  down = null;
  if (moved) return;
  const r = heapEl.getBoundingClientRect();
  tapAt(e.clientX - r.left, e.clientY - r.top);
});
heapEl.addEventListener('pointercancel', () => { down = null; });
$('#srList').addEventListener('click', (e) => { const b = e.target.closest('[data-strand]'); if (b) act(+b.dataset.strand, null); });

/**
 * The strand under a tap (css px from the canvas corner), or -1.
 * Within reach (22 px, or half the yarn plus 6 px): the nearest strand that can
 * be pulled; else the nearest one with nothing on top; else the topmost strand
 * whose body is under the finger; else the nearest.
 */
function strandAt(px, py) {
  const sc = HP.scale;
  const p = [px / sc, py / sc];
  const R = Math.max(22, (W / 2) * sc + 6) / sc;
  const s = G.state;
  const cands = [];
  for (let i = 0; i < L.n; i++) {
    if (s.out[i]) continue;
    const d = nearDist(p, L.poly[i], L.grids[i]);
    if (d <= R) cands.push({ i, d });
  }
  if (!cands.length) return -1;
  const near = (a, b) => a.d - b.d || b.i - a.i;
  const pullable = cands.filter((c) => canPull(L, s, c.i)).sort(near);
  if (pullable.length) return pullable[0].i;
  const free = cands.filter((c) => isUncovered(L, s, c.i)).sort(near);
  if (free.length) return free[0].i;
  const onBody = cands.filter((c) => c.d <= W / 2 + 2 / sc);
  if (onBody.length) return Math.max(...onBody.map((c) => c.i));
  return cands.sort(near)[0].i;
}
function tapAt(x, y) {
  if (!L || isDone(G.state)) return;
  if (busy) { queuedTap = { x, y }; skipAll(); return; }
  ensureAudio();
  const i = strandAt(x, y);
  if (i < 0) return;
  act(i, [x / HP.scale, y / HP.scale]);
}
function act(i, at) {
  if (busy) { skipAll(); return; }
  const why = whyNot(L, G.state, i);
  if (!why) doPull(i);
  else if (why.reason !== 'gone') blocked(i, why, at);
}

// ---------- pulling: the slither ----------
function doPull(i) {
  const before = G.state;
  const res = play(L, G, i);
  if (!res.ok) return;
  G = res.game;
  stats.pulls++;
  note = ''; hinted = -1; tangled = false;
  save();
  for (const m of res.group) HP.fade[m] = 1;
  // pins this pull lets out
  for (let s = 0; s < L.n; s++) if (L.pinBy[s] >= 0 && res.group.includes(L.pinBy[s]) && !G.state.out[s]) HP.pinFx.push({ i: s, t0: performance.now() });
  viewRack = before.rack.map((x) => (x ? { ...x } : null));
  viewSkeins = before.skeins.slice();
  winding = res.events[0].c;
  run(async () => {
    kick();
    sfx('pluck');
    await slither(res.group, res.events);
  });
}

async function slither(group, events) {
  const r = heapEl.getBoundingClientRect();
  const sc = HP.scale;
  const first = events[0];
  // the track: the strand (or knotted pair) in page px, then a curve to its spool
  const members = group.map((m) => ({ m, pts: L.poly[m].map(([x, y]) => [r.left + x * sc, r.top + y * sc]) }));
  let pts = members[0].pts.slice();
  if (members.length > 1) pts = pts.concat(members[1].pts.slice(1));
  const target = spoolCenter(first.slot);
  const d0 = Math.hypot(pts[0][0] - target[0], pts[0][1] - target[1]);
  const d1 = Math.hypot(pts[pts.length - 1][0] - target[0], pts[pts.length - 1][1] - target[1]);
  let order = members.map((x) => x.m);
  if (d0 < d1) { pts.reverse(); order = order.reverse(); }
  const segLen = (p) => { let a = 0; for (let k = 1; k < p.length; k++) a += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return a; };
  const lens = order.map((m) => segLen(L.poly[m]) * sc);
  const yarnLen = lens.reduce((a, b) => a + b, 0);
  const E = pts[pts.length - 1], F = pts[Math.max(0, pts.length - 4)];
  const tl = Math.hypot(E[0] - F[0], E[1] - F[1]) || 1;
  const T = [(E[0] - F[0]) / tl, (E[1] - F[1]) / tl];
  const span = Math.hypot(target[0] - E[0], target[1] - E[1]);
  const c1 = [E[0] + T[0] * Math.min(110, span * 0.45), E[1] + T[1] * Math.min(110, span * 0.45)];
  const c2 = [target[0], target[1] + Math.min(120, span * 0.5)];
  const bez = [];
  const nb = Math.max(8, Math.ceil(span / 5));
  for (let k = 1; k <= nb; k++) {
    const t = k / nb, u = 1 - t;
    bez.push([u * u * u * E[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * target[0], u * u * u * E[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * target[1]]);
  }
  const track = pts.concat(bez);
  const cum = [0];
  for (let k = 1; k < track.length; k++) cum.push(cum[k - 1] + Math.hypot(track[k][0] - track[k - 1][0], track[k][1] - track[k - 1][1]));
  const total = cum[cum.length - 1];
  const w = W * sc;
  const spoolEl = () => slotEl(first.slot)?.querySelector('.spool');
  // the spool appears (fresh) before the yarn arrives
  if (first.fresh) { viewRack[first.slot] = { c: first.c, n: 0 }; renderRack(); }
  const nBefore = first.n - 1;
  const ctx = FLY.ctx;
  showFly(true);
  const rm = reduced();
  const dur = rm ? 220 : Math.max(560, Math.min(1050, total / 1.3));
  let ticked = 0, winding = false;
  await tween(dur, (t) => {
    const w0 = performance.now();
    try { flyFrame(t); } finally { PERF.fly.push(performance.now() - w0); if (PERF.fly.length > 2000) PERF.fly.shift(); }
  });
  function flyFrame(t) {
    flyBegin();
    if (rm) {
      // reduced motion: the strand fades where it lay, and the spool fills
      const a = 1 - t;
      let off = 0;
      for (const m of order) {
        const len = segLen(L.poly[m]) * sc;
        const part = slice(track, cum, off, off + len);
        off += len;
        flyMark(part, w * 2.4);
        if (part.length > 1) paintYarn(ctx, yarnGeom(part, w, { vari: !!L.strands[m].c2 }), { w, tone: TONE[L.strands[m].c], tone2: L.strands[m].c2 ? TONE[L.strands[m].c2] : null, lift: 1, alpha: a });
      }
      const sp = spoolEl();
      if (sp) sp.style.setProperty('--f', ((nBefore + t) / SPOOL).toFixed(3));
      return;
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
      paintYarn(ctx, yarnGeom(part, w, { vari: !!s.c2 }), { w, tone: TONE[s.c], tone2: s.c2 ? TONE[s.c2] : null, lift: 1.6, glyphs: data.glyphs ? (s.c2 ? [s.c, s.c2] : [s.c]) : null });
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
    const sp = spoolEl();
    if (sp) {
      if (wound > 0 && !winding) { winding = true; sp.classList.add('winding'); }
      sp.style.setProperty('--f', ((nBefore + wound) / SPOOL).toFixed(3));
    }
    if (wound > 0 && wound * 4 > ticked + 1) { ticked++; sfx('tick', first.n * 2 + ticked); }
  }
  showFly(false);
  const sp = spoolEl();
  if (sp) sp.classList.remove('winding');
  await landEvent(first);
  for (const ev of events.slice(1)) {
    if (ev.slot !== first.slot || ev.fresh) await hop(first.slot, ev);
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
// A second length (the other color of a two-color strand, or the second of a
// knotted pair) hops over to its own spool.
async function hop(fromSlot, ev) {
  if (ev.fresh) { viewRack[ev.slot] = { c: ev.c, n: 0 }; renderRack(); }
  const a = spoolCenter(fromSlot), b = spoolCenter(ev.slot);
  if (reduced() || skip) return;
  const ctx = FLY.ctx, sc = HP.scale, w = W * sc;
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
    paintYarn(ctx, yarnGeom(pts, w * 0.8), { w: w * 0.8, tone: s, lift: 1.4 });
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
  HP.tapped = g; HP.tapUntil = now + 1100;
  HP.glowPin = -1;
  const glowFor = (list, ms = 1300) => { for (const j of list) HP.glowUntil[j] = now + ms; };
  const kind = (m) => `${colorsOf(L, m).map(cshort).join(' and ')}`;
  if (why.reason === 'covered') {
    glowFor(why.blockers);
    const n = why.blockers.length;
    const knot = g.length > 1 ? `This one is knotted to a ${showsColor(L, G.state, g.find((m) => m !== i)) ? kind(g.find((m) => m !== i)) : 'buried'} strand, so they come out together. ` : '';
    const what = g.length > 1 ? 'them' : showsColor(L, G.state, i) ? `this ${kind(i)} one` : 'this one';
    note = `${knot}${n === 1 ? `One strand lies over ${what}. Free the glowing strand first.` : `${n} strands lie over ${what}. Free the glowing ones first.`}`;
  } else if (why.reason === 'pinned') {
    glowFor(why.pins);
    const pinned = g.find((m) => isPinned(L, G.state, m));
    HP.glowPin = pinned; HP.glowUntil[pinned] = Math.max(HP.glowUntil[pinned], now + 1300);
    note = `Pinned in place. The pin comes out when you pull the glowing ${kind(why.pins[0])} strand, the color of its glass head.`;
  } else if (why.reason === 'rack') {
    const cs = why.colors.map(cshort);
    note = `The rack is full, and there’s no ${cs.join(' or ')} spool yet. Finish a spool to make room.`;
    if (cs.length > 1) note = `This one needs ${cs.join(' and ')} spools, and the rack is full. Finish a spool to make room.`;
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
      const s = L.strands[h.strand];
      note = `Try this ${showsColor(L, G.state, h.strand) ? cshort(s.c) : ''} strand next. It glows.`.replace('this  strand', 'this strand');
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
  if (!fresh && g && g.level === L.id && g.sig === L.sig && validState(L, g.state) && Array.isArray(g.past)) {
    G = { state: g.state, past: g.past.filter((s) => validState(L, s)) };
  } else {
    G = newGame(L);
  }
  skip = false;
  hinted = -1; note = ''; tangled = false;
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
  cv.width = 80; cv.height = 100;
  const c = cv.getContext('2d');
  c.scale(0.8, 0.8);
  c.lineCap = c.lineJoin = 'round';
  Lv.poly.forEach((p, i) => {
    const s = Lv.strands[i];
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (let k = 3; k < p.length; k += 3) c.lineTo(p[k][0], p[k][1]);
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
  $('#finYards').textContent = `About ${k.yards} yards of worsted, at 100 yards to a 50\u00a0g skein.`;
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
  pin: `<svg viewBox="0 0 56 56">${yarnIcon('M4 34C18 22 34 40 52 26', '#D6A92E')}<path d="M24 40 35 20" stroke="#9AA2A8" stroke-width="2" stroke-linecap="round"/><circle cx="36" cy="18" r="5" fill="#34588E"/><circle cx="34.5" cy="16.5" r="1.4" fill="#fff" opacity=".8"/></svg>`,
  variegated: `<svg viewBox="0 0 56 56">${yarnIcon('M4 38C16 18 36 44 52 18', '#B9473A')}<path d="M4 38C16 18 36 44 52 18" fill="none" stroke="#D6A92E" stroke-width="5.2" stroke-dasharray="7 7"/></svg>`,
  big: `<svg viewBox="0 0 56 56">${yarnIcon('M4 16C20 30 34 6 52 22', '#5F8A3A', 5)}${yarnIcon('M6 42C20 22 32 46 50 34', '#B8467A', 5)}${yarnIcon('M14 6C22 22 18 36 30 52', '#34588E', 5)}${yarnIcon('M44 6C36 24 46 36 38 52', '#D9782B', 5)}</svg>`,
  buried: `<svg viewBox="0 0 56 56">${yarnIcon('M4 30C18 18 36 42 52 28', HIDDEN_HEX)}${yarnIcon('M26 4C22 22 34 34 28 52', '#674A8C')}<text x="12" y="20" font-size="13" font-family="Georgia" fill="#6A5235">?</text></svg>`,
  rack4: `<svg viewBox="0 0 56 56"><rect x="6" y="12" width="44" height="32" rx="6" fill="#C9AA7C"/>${['#B9473A', '#34588E', '#D6A92E', '#5F8A3A'].map((c, i) => spoolIcon(13 + i * 10, c, 0.6)).join('')}</svg>`,
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
$('#glyphBtn').addEventListener('click', () => { data.glyphs = !data.glyphs; save(); buildSprites(); render(); kick(); });
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
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (L && !busy) { sizeHeap(); render(); } }, 120); });
document.addEventListener('visibilitychange', () => { if (document.hidden && busy) skipAll(); });

// ---------- boot ----------
SPOT = spotSprite();
load();
startLevel(data.cur);
if (!data.seenHow) openHow();
else if (isDone(G.state)) openFinish();

// For quick checks from the console or a test harness (read-only peeks).
window.__tangle = {
  get level() { return L; }, get state() { return G.state; }, get busy() { return busy; }, get hinted() { return hinted; },
  get note() { return note; }, get stats() { return { ...stats }; }, get perf() { return { frames: PERF.frames, dyn: HP.dyn.length, heap: PERF.heap.slice(), fly: PERF.fly.slice() }; },
  get wiggling() { return !!HP.wig; }, get glowing() { return HP.glowUntil.map((t, i) => (t > performance.now() ? i : -1)).filter((i) => i >= 0); },
  // the page point of a strand's most open spot (for taps from a test)
  pointOf(i) {
    if (!L.poly[i]) return null;
    const r = heapEl.getBoundingClientRect(), s = G.state;
    let best = null, bs = -1;
    L.poly[i].forEach((p, k) => {
      if (k % 2) return;
      let clear = Infinity;
      for (let j = i + 1; j < L.n; j++) if (!s.out[j]) clear = Math.min(clear, nearDist(p, L.poly[j], L.grids[j]));
      for (let j = 0; j < i; j++) if (!s.out[j]) clear = Math.min(clear, nearDist(p, L.poly[j], L.grids[j]) + 0.01);
      if (clear > bs) { bs = clear; best = p; }
    });
    return { x: r.left + best[0] * HP.scale, y: r.top + best[1] * HP.scale };
  },
  strandAt(x, y) { const r = heapEl.getBoundingClientRect(); return strandAt(x - r.left, y - r.top); },
  // time the heap painter: a full cache rebuild, and an ordinary frame (ms)
  bench(n = 10) {
    const t0 = performance.now();
    for (let k = 0; k < n; k++) { HP.cacheSig = ''; HP.full = true; drawHeap(performance.now()); }
    const t1 = performance.now();
    for (let k = 0; k < n; k++) { HP.full = true; drawHeap(performance.now()); }
    const t2 = performance.now();
    return { rebuild: (t1 - t0) / n, frame: (t2 - t1) / n, dyn: HP.dyn.length, strands: L.n - remainingCount() };
  },
};
const remainingCount = () => G.state.out.reduce((a, x) => a + x, 0);
