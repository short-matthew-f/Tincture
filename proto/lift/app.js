// The Lifting Table: UI, rendering and animation. Rules live in rules.js (pure).
// The painting is one canvas. Each column is drawn as a single slice of a
// pre-painted picture, resting on the bottom edge: as paint lifts from the
// bottom, what's left slumps down (visual only; the rule is still "each
// column's lowest cell is exposed").
import {
  newGame, play, playNudge, undo, stage, isLegal, isDone, isStuck, benchCap, canNudge, blockedReason,
  frontJar, laneLeft, laneOpen, canLift, isCovered, jarColors, VERSION,
  bestHint, guessMove, frontUnit, verdict, backToSolvableSteps, stateKey,
} from './rules.js';
import { LEVELS, PALETTE, MECHANICS, BANDS, levelById } from './levels.js';

const KEY = 'tincture.proto.lift';
const HISTORY_SAVED = 400; // undo is unlimited in a session; the save keeps the last 400 steps
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

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
const glyphSvg = (c, cls = 'gl') => {
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
  const [L, A, B] = a.map((v, i) => v * (1 - t) + b[i] * t);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((v) => fromLin(v).toString(16).padStart(2, '0')).join('')}`;
}
const jarHex = (j) => (j.c2 ? mixHex(j.c, j.cap, j.c2, j.cap2) : PALETTE[j.c].hex);

// ---------- save ----------
let data = { v: 2, cur: LEVELS[0].id, done: {}, glyphs: true, seenHow: false, seenIntro: {}, sound: false, fast: false, game: null };
function save() {
  try {
    const g = G ? { level: L.id, sig: L.sig, state: G.state, past: G.past.slice(-HISTORY_SAVED) } : null;
    localStorage.setItem(KEY, JSON.stringify({ ...data, cur: L ? L.id : data.cur, game: g }));
  } catch { /* storage may be blocked; play goes on */ }
}
const isJar = (j) => j && typeof j === 'object' && typeof j.c === 'string' && PALETTE[j.c] && Number.isInteger(j.cap);
function validState(Lv, s) {
  return !!s && s.v === VERSION && s.level === Lv.id && Array.isArray(s.h) && s.h.length === Lv.W &&
    s.h.every((x) => Number.isInteger(x) && x >= 0 && x <= Lv.H) && Array.isArray(s.lp) && s.lp.length === Lv.lanes.length &&
    s.lp.every((p, i) => Number.isInteger(p) && p >= 0 && p <= Lv.lanes[i].length) &&
    Array.isArray(s.belt) && Array.isArray(s.bench) && Array.isArray(s.shelf) && s.belt.length <= Lv.slots &&
    s.belt.every(isJar) && s.bench.every(isJar) && Number.isInteger(s.extra) && s.extra >= 0 && s.extra <= 1;
}
// Saves from the first version (twelve pictures) keep their settings and the
// "lifted" marks of pictures that are still on the wall; their games are set aside.
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === 'object' && (o.v === 1 || o.v === 2)) {
      const done = {};
      if (o.done && typeof o.done === 'object') for (const id of Object.keys(o.done)) if (levelById(id) && o.done[id]) done[id] = true;
      data = {
        ...data,
        cur: typeof o.cur === 'string' ? o.cur : data.cur,
        done, glyphs: o.glyphs !== false, seenHow: !!o.seenHow,
        seenIntro: o.v === 2 && o.seenIntro && typeof o.seenIntro === 'object' ? o.seenIntro : {},
        sound: o.v === 2 && !!o.sound, fast: o.v === 2 && !!o.fast,
        game: o.v === 2 ? o.game : null,
      };
    }
  } catch { /* a fresh start */ }
  if (!levelById(data.cur)) data.cur = LEVELS[0].id;
}

// ---------- state ----------
let L = null, G = null, busy = false, skip = false, queued = null, hinted = null, note = '', howStep = 0;
// dead: the rules prove no order of jars clears it from here; pendingHint: Hint
// tapped while the belt ran (answers once it settles); stepping: Back to solvable.
let dead = false, deadTimer = 0, pendingHint = false, stepping = false;
const VERDICTS = new Map();
let lastOpen = [];
const skipWaiters = new Set();

function wait(ms) {
  if (skip || ms <= 0) return Promise.resolve();
  return new Promise((r) => {
    const done = () => { clearTimeout(t); skipWaiters.delete(done); r(); };
    const t = setTimeout(done, ms);
    skipWaiters.add(done);
  });
}
function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  if (TL) TL.skip = true;
  settleNow();
  for (const a of document.getAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
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
  busy = true; skip = false;
  try { await fn(); } catch (e) { console.error('The Lifting Table: an animation was cut short', e); } finally {
    busy = false; skip = false;
    TL = null;
    $('#belt').classList.remove('running');
    for (const el of $$('.flying')) el.remove();
    if (PT.h.join() !== G.state.h.join()) syncPainter(G.state); else kick();
    render();
    afterMove();
    const q = queued;
    queued = null;
    if (q && !isDone(G.state)) { pendingHint = false; setTimeout(() => act(q), 0); } else {
      scheduleDeadCheck();
      if (pendingHint) { pendingHint = false; if (!isDone(G.state)) setTimeout(doHint, 0); }
    }
  }
}

// ---------- the painter: one canvas, columns that slump ----------
const PT = {
  cv: null, ctx: null, fx: null, fctx: null, dcs: 8, cs: 8, dpr: 1, paint: null, bare: null,
  h: [], off: [], vel: [], cloth: [], dirty: new Set(), parts: [], carts: [], fxH: 0, ledgeY: 0, keyCells: [],
};
const MAX_PARTS = 240;
const GRAV = 70; // cells per second squared

function hash(a, b, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildPainter() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cv = $('#pic');
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
  const fx = $('#fx'), easel = $('#easel'), pic = $('#pic'), ledge = $('#ledge');
  const er = easel.getBoundingClientRect(), pr = pic.getBoundingClientRect(), lr = ledge.getBoundingClientRect();
  const w = pr.width, h = lr.bottom - pr.top + 6;
  fx.style.left = `${pr.left - er.left}px`; fx.style.top = `${pr.top - er.top}px`;
  fx.style.width = `${w}px`; fx.style.height = `${h}px`;
  fx.width = Math.round(w * PT.dpr); fx.height = Math.round(h * PT.dpr);
  PT.fx = fx; PT.fctx = fx.getContext('2d'); PT.fctx.setTransform(PT.dpr, 0, 0, PT.dpr, 0, 0);
  PT.fxH = h; PT.ledgeY = lr.top - pr.top; PT.cssW = w;
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
  } else if (data.glyphs && d >= 9) {
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
function kick() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
function frame(now) {
  raf = 0;
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
  const app = $('#app');
  // Belt and bench share a row when every slot can stay 44 px wide or more
  // (counting the spare spot); otherwise the bench sits under the belt.
  const rowW = Math.min(innerWidth, 480) - 24;
  $('#table').classList.toggle('stack', (L.slots + L.bench + 1) * 47 + 56 > rowW);
  const wAvail = Math.min(innerWidth, 480) - 24 - 10;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.id === 'easel' || ch.hidden) continue;
    used += ch.offsetHeight; n++;
  }
  used += n * 5 + 6 + 10 + 14 + 10; // gaps, easel post, frame, ledge, breathing room
  const hAvail = innerHeight - used;
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
  const cls = `jar ${j.c2 ? 'mix' : ''} ${full ? 'full' : ''} ${hide ? 'mystery' : ''} ${extra}`;
  return `<span class="${cls}" data-id="${id}" style="--jc:${PALETTE[j.c].hex};--jc2:${PALETTE[c2].hex};--mix:${jarHex(j)};color:${glyphInk(j.c)}">` +
    '<span class="cork"></span><span class="neck"></span>' +
    `<span class="glass"><span class="tint"></span><span class="fill2" style="transform:scaleY(${f2})"></span><span class="fill" style="transform:scaleY(${f1})"></span><span class="blend"></span><span class="band"></span><span class="shine"></span>${hide ? '' : glyphSvg(j.c) + (j.c2 ? glyphSvg(j.c2) : '')}</span>` +
    `<span class="num">${hide ? '?' : label}</span></span>`;
}
const jarName = (j) => (j.c2 ? `${cname(j.c)} and ${cname(j.c2)} mixing jar` : `${cname(j.c)} jar`);

const TIE = '<svg class="tie" viewBox="0 0 30 22" aria-hidden="true"><path d="M2 4 C 10 18, 20 18, 28 6" fill="none" stroke="#8C6512" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 2"/><circle cx="15" cy="15" r="2.6" fill="#B08A5E"/></svg>';
const LOCK = '<svg class="lock" viewBox="0 0 30 34" aria-hidden="true"><path d="M8 15v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#6A4E12" stroke-width="3.2"/><rect x="4" y="14" width="22" height="18" rx="4" fill="#E2B04A" stroke="#6A4E12" stroke-width="1.6"/><circle cx="15" cy="22" r="2.4" fill="#6A4E12"/><path d="M15 23v4" stroke="#6A4E12" stroke-width="2"/></svg>';

function render(s = G.state) {
  document.body.classList.toggle('glyphs', !!data.glyphs);
  const idx = LEVELS.indexOf(L);
  $('#lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#lvName').textContent = L.name;
  const gb = $('#glyphBtn');
  gb.setAttribute('aria-pressed', String(!!data.glyphs));
  gb.innerHTML = glyphSvg('p', '').replace('<svg', '<svg fill="currentColor"');
  const sb = $('#soundBtn');
  sb.setAttribute('aria-pressed', String(!!data.sound));
  sb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${data.sound ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;

  // shelf
  $('#shelfCount').innerHTML = `Shelf <b>${s.shelf.length}</b>`;
  $('#shelf').innerHTML = s.shelf.slice(-48).map((j) => `<span class="mini" style="--jc:${jarHex(j)}"></span>`).join('');

  // belt and bench
  const table = $('#table');
  table.style.setProperty('--beltfr', `${L.slots}fr`);
  table.style.setProperty('--benchfr', `${benchCap(L, s)}fr`);
  const belt = $('#belt');
  belt.style.setProperty('--slots', L.slots);
  belt.classList.toggle('fast', !!data.fast);
  let bh = '<span class="tread"></span><span class="roller l"></span><span class="roller r"></span>';
  for (let i = 0; i < L.slots; i++) {
    const j = s.belt[i];
    if (j) {
      const waiting = !busy && !canLift(L, s, j);
      bh += `<button type="button" class="slotbtn" data-where="belt" data-i="${i}" aria-label="${jarName(j)} on the belt, ${j.n + (j.n2 || 0)} of ${j.cap + (j.cap2 || 0)}${waiting ? ', waiting' : ''}. Tap to rest it on the bench.">${jarHTML(j, { n: j.n, n2: j.n2 || 0, extra: waiting ? 'waiting' : '' })}</button>`;
    } else bh += '<span class="spot"></span>';
  }
  belt.innerHTML = bh;
  const bench = $('#bench');
  const bc = benchCap(L, s);
  bench.style.setProperty('--benchn', bc);
  let nh = '';
  for (let i = 0; i < bc; i++) {
    const j = s.bench[i];
    if (j) nh += `<button type="button" class="slotbtn" data-where="bench" data-i="${i}" aria-label="${jarName(j)} resting on the bench, ${j.n + (j.n2 || 0)} of ${j.cap + (j.cap2 || 0)}. Tap to put it back on the belt.">${jarHTML(j, { n: j.n, n2: j.n2 || 0 })}</button>`;
    else nh += `<span class="spot ${i >= L.bench ? 'new' : ''}">${i >= L.bench ? 'spare' : ''}</span>`;
  }
  bench.innerHTML = nh;
  $('#benchNote').textContent = `${s.bench.length}/${bc}`;
  $('#beltNote').textContent = `${s.belt.length}/${L.slots}`;

  // lanes
  const lanes = $('#lanes');
  lanes.style.setProperty('--lanes', L.lanes.length);
  let lh = '';
  const opened = [];
  L.lanes.forEach((lane, i) => {
    const p = s.lp[i];
    const f = frontJar(L, s, i);
    const open = laneOpen(L, s, i);
    if (open && lastOpen[i] === false) opened.push(i);
    lh += `<div class="lane ${open ? '' : 'locked'}" data-lane-box="${i}">`;
    if (f) {
      const unit = f.link ? 'tied pair' : 'jar';
      const label = `${jarName(f)}${f.link ? `, tied to a ${jarName(lane[p + 1])}` : ''}, holds ${f.cap + (f.cap2 || 0)}. ${open ? `Tap to set the ${unit} on the belt.` : 'This lane is locked until its key cell is lifted.'}`;
      lh += `<button type="button" class="front" data-lane="${i}" aria-label="${label}">${jarHTML(f, { id: `${i}.${p}` })}${f.link ? TIE : ''}</button>`;
      lh += '<div class="next">';
      for (let k = 1; k <= 2; k++) {
        const nj = lane[p + k];
        if (!nj) continue;
        const hide = nj.q && !(k === 1 && f.link);
        lh += jarHTML(nj, { id: `${i}.${p + k}`, hide });
      }
      lh += '</div>';
      const more = laneLeft(L, s, i) - 3;
      if (!open) lh += LOCK;
      else if (more > 0) lh += `<span class="more">+${more}</span>`;
    } else {
      lh += '<span class="done">All set out</span>';
    }
    lh += '</div>';
  });
  lanes.innerHTML = lh;
  lastOpen = L.lanes.map((_, i) => laneOpen(L, s, i));
  if (!reduced()) for (const i of opened) anim($(`[data-lane-box="${i}"] .front`), [{ transform: 'scale(.85)' }, { transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });

  // buttons, message
  const stuck = !busy && isStuck(L, s);
  const showBack = !busy && !stepping && !isDone(s) && (stuck || dead) && G.past.length > 0;
  const sb2 = $('#stuckBtn');
  sb2.hidden = !stuck || (showBack && !canNudge(s));
  sb2.textContent = canNudge(s) ? (showBack ? 'Spare spot' : 'Add a bench spot') : 'Start over';
  sb2.classList.toggle('primary', !showBack);
  $('#backBtn').hidden = !showBack;
  $('#hintBtn').hidden = stuck;
  $('#undoBtn').disabled = !G.past.length || stepping;
  $('#hintBtn').disabled = isDone(s) || stepping;
  $('#msg').textContent = busy ? 'Lifting…' : message(s);
  const row = $('.msgrow');
  row.classList.toggle('wide', [...row.querySelectorAll('.btn')].filter((b) => !b.hidden).length >= 3);

  if (hinted && !busy) {
    const el = targetFor(hinted);
    if (el) el.querySelector('.jar')?.classList.add('hinted');
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
  if (m.t === 'place') return $(`#lanes .front[data-lane="${m.i}"]`);
  if (m.t === 'park') return $(`#belt .slotbtn[data-i="${m.i}"]`);
  return $(`#bench .slotbtn[data-i="${m.i}"]`);
}

// ---------- jar motion ----------
function snapRects() {
  const out = new Map();
  for (const el of $$('#belt .jar, #bench .jar, #lanes .jar')) out.set(el.dataset.id, el.getBoundingClientRect());
  return out;
}
async function flip(before, dur = 180) {
  if (reduced() || skip) return;
  const jobs = [];
  for (const el of $$('#belt .jar, #bench .jar, #lanes .front .jar')) {
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
const jarEl = (id) => $(`#belt .jar[data-id="${id}"]`);
function setJarFill(el, j) {
  if (!el) return;
  const tot = j.cap + (j.cap2 || 0);
  const f = el.querySelector('.fill'), f2 = el.querySelector('.fill2');
  if (f) f.style.transform = `scaleY(${j.n / tot})`;
  if (f2) f2.style.transform = `scaleY(${(j.n + (j.n2 || 0)) / tot})`;
  const n = el.querySelector('.num');
  if (n) n.textContent = j.c2 ? `${j.n}+${j.n2}` : `${j.n}/${j.cap}`;
  el.classList.remove('waiting');
}

async function corkAndFly(id) {
  const el = jarEl(id);
  if (!el) return;
  el.classList.add('full');
  sfx('pop');
  if (reduced() || skip) return;
  const r = el.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'flying';
  pop.textContent = 'pop!';
  pop.style.cssText = `position:fixed;z-index:45;pointer-events:none;font:400 16px var(--font-display);color:#6A5A1E;text-shadow:0 1px 0 #fff;left:${r.left + r.width / 2}px;top:${r.top}px;transform:translate(-50%,-100%)`;
  document.body.append(pop);
  anim(pop, [{ opacity: 0, transform: 'translate(-50%, -80%)' }, { opacity: 1, transform: 'translate(-50%, -140%)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%, -210%)' }], { duration: 650, easing: 'ease-out' }).then(() => pop.remove());
  await anim(el.querySelector('.cork'), [{ transform: 'translateY(-16px)', opacity: 0 }, { transform: 'translateY(2px)', opacity: 1, offset: 0.65 }, { transform: 'translateY(-2px)', offset: 0.85 }, { transform: 'none', opacity: 1 }], { duration: 170, easing: 'ease-in' });
  await anim(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.18, .9)', offset: 0.35 }, { transform: 'scale(.94, 1.08)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  const sr = $('#shelf').getBoundingClientRect();
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
  const speed = data.fast ? 0.5 : 1;
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
  // carriages for the active pass
  return new Promise((resolve) => {
    TL = { t0: performance.now(), dur: t, events, i: 0, d, resolve, passes, per, total: 0, skip: false, corks: [], passStart: 0 };
    // If frames stop (a hidden tab), finish the run anyway so the table never stays busy.
    const guard = setTimeout(() => { if (TL && TL.resolve === resolve) { TL.skip = true; stepTimeline(performance.now()); } }, t + 2500);
    TL.guard = guard;
    $('#belt').classList.add('running');
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
  el.className = 'combo flying';
  el.textContent = `${word} · ${n} cells`;
  $('#easel').append(el);
  sfx('chord');
  anim(el, [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.06)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -55%) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%, -75%) scale(1)' }], { duration: 1300, easing: 'ease-out' }).then(() => el.remove());
}

// ---------- actions ----------
function act(m) {
  // Lane taps queue up (lane numbers never shift); belt and bench slots can
  // shift while jars leave, so those taps only fast-forward.
  if (stepping) return;
  if (busy) { if (m.t === 'place') queued = m; pendingHint = false; skipAll(); return; }
  note = '';
  if (!isLegal(L, G.state, m)) { explainBlocked(m); return; }
  hinted = null;
  dead = false;
  ensureAudio();
  const staged = stage(L, G.state, m);
  const res = play(L, G, m);
  G = res.game;
  save();
  run(async () => {
    const before = snapRects();
    render(staged);
    $('#msg').textContent = res.passes.length ? 'Lifting…' : message(staged);
    sfx('clink');
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
    if (k) { anim($('#frame'), [{ boxShadow: '0 0 0 0 rgba(226,176,74,0)' }, { boxShadow: '0 0 0 5px rgba(226,176,74,.7)' }, { boxShadow: '0 0 0 0 rgba(226,176,74,0)' }], { duration: reduced() ? 0 : 700 }); }
    return;
  }
  if (G.state.belt.length >= L.slots || why === 'tied') anim($('#belt'), [{ transform: 'translateX(0)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: reduced() ? 0 : 260 });
}

function doUndo() {
  if (stepping) return;
  if (busy) { pendingHint = false; skipAll(); return; }
  if (!G.past.length) return;
  note = ''; hinted = null; dead = false;
  const before = snapRects();
  G = undo(G);
  save();
  syncPainter(G.state);
  render();
  flip(before, 200);
  scheduleDeadCheck();
}

// ---------- dead ends and "Back to solvable" ----------
function verdictOf(s) {
  const k = `${L.id}|${s.extra}|${s.moves}|${stateKey(s)}`;
  if (!VERDICTS.has(k)) {
    VERDICTS.set(k, verdict(L, s));
    if (VERDICTS.size > 500) VERDICTS.delete(VERDICTS.keys().next().value);
  }
  return VERDICTS.get(k);
}
function scheduleDeadCheck() {
  clearTimeout(deadTimer);
  deadTimer = setTimeout(() => {
    deadTimer = 0;
    if (!G || busy || stepping || revealing || isDone(G.state)) return;
    let d = false;
    try { d = verdictOf(G.state) === 'dead'; } catch (e) { console.error(e); }
    if (d !== dead) { dead = d; render(); }
  }, 40);
}
// Walk back (in slices) to the latest position the rules prove solvable, then
// take the moves back quickly, one after another. The spare spot is not spent.
async function doBack() {
  if (!G || stepping) return;
  if (busy) { skipAll(); return; }
  const states = [...G.past, G.state];
  stepping = true;
  hinted = null;
  note = 'Finding a good spot to step back to…';
  render();
  let idx = states.length - 1;
  try {
    const it = backToSolvableSteps(L, states);
    for (;;) {
      const t0 = performance.now();
      let r;
      do { r = it.next(); } while (!r.done && performance.now() - t0 < 14);
      if (r.done) { idx = r.value; break; }
      await nap(0);
    }
  } catch (e) { console.error(e); }
  const steps = states.length - 1 - idx;
  if (steps <= 0) {
    stepping = false; dead = false;
    note = 'You\u2019re on track. This painting can still be cleared from here.';
    render();
    return;
  }
  const gap = reduced() ? 0 : Math.max(70, Math.min(160, 1100 / steps));
  try {
    for (let k = 0; k < steps; k++) {
      const before = snapRects();
      G = undo(G);
      syncPainter(G.state);
      note = `Stepping back… ${k + 1} of ${steps}`;
      render();
      if (gap) { flip(before, Math.min(160, gap)); await nap(gap); }
    }
  } finally { stepping = false; }
  save();
  dead = false;
  note = `Took back ${steps} ${steps === 1 ? 'move' : 'moves'}. This painting can be cleared from here.`;
  render();
  scheduleDeadCheck();
}

function restart() {
  if (busy) return;
  startLevel(L.id, { fresh: true });
}

function doStuck() {
  if (busy || stepping) return;
  if (canNudge(G.state)) {
    G = playNudge(G);
    note = 'A spare bench spot, just for this painting.';
    hinted = null;
    dead = false;
    save();
    render();
    scheduleDeadCheck();
  } else restart();
}

// One line that names the jar the hint points at.
function hintLine(hn) {
  const m = hn.move, s = G.state, guess = hn.kind === 'guess';
  if (m.t === 'place') {
    const u = frontUnit(L, s, m.i);
    const nm = u.length > 1 ? `tied ${jarName(u[0])} and ${jarName(u[1])}` : jarName(u[0]);
    return guess ? `Try the ${nm} next: its color is close to the bottom edge.` : `Try the ${nm} next.`;
  }
  if (m.t === 'park') return `${guess ? 'To make room, try' : 'Try'} resting the ${jarName(s.belt[m.i])} on the bench.`;
  return `Try bringing the ${jarName(s.bench[m.i])} back to the belt.`;
}

// Always visible feedback: a tap while the belt runs fast-forwards it and then
// answers; a budget the solver can't settle gives a sensible guess; a proven
// dead end says so and offers Back to solvable.
function doHint() {
  if (!G || stepping) return;
  if (busy) { pendingHint = true; skipAll(); return; }
  if (isDone(G.state)) return;
  hinted = null;
  note = 'Looking…';
  render();
  const at = G.state;
  setTimeout(() => {
    if (!G || busy || stepping || G.state !== at) return;
    let hn;
    try { hn = bestHint(L, G.state); } catch (e) { console.error(e); try { hn = guessMove(L, G.state); } catch { hn = null; } }
    if (!hn || hn.kind === 'dead') {
      dead = true; hinted = null;
      note = 'This one has gotten tangled: no order of jars clears it from here. Back to solvable takes back just the moves it needs' + (canNudge(G.state) ? ', or take a spare bench spot.' : '.');
      render();
      return;
    }
    if (hn.kind === 'none') { note = ''; render(); return; }
    hinted = hn.move;
    note = hintLine(hn);
    render();
    const el = targetFor(hinted);
    if (el) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* fine */ } }
  }, 20);
}

let revealing = false;
async function afterMove() {
  if (!isDone(G.state) || revealing) return;
  if (!data.done[L.id]) { data.done[L.id] = true; save(); }
  revealing = true;
  try {
    if (!reduced()) {
      const pill = document.createElement('div');
      pill.className = 'reveal flying';
      pill.textContent = 'The bare canvas, and the sketch beneath';
      $('#easel').append(pill);
      sfx('chord');
      await anim(pill, [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -6px)' }], { duration: 1500, easing: 'ease-out' });
      pill.remove();
    }
  } finally {
    revealing = false;
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
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
function tone(freq, dur, type = 'sine', gain = 0.04, when = 0) {
  const t = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind, k = 0) {
  if (!data.sound || !AC || skip) return;
  try {
    if (kind === 'plink') tone(440 * 2 ** (PENTA[Math.floor(k) % PENTA.length] / 12), 0.12, 'sine', 0.025);
    else if (kind === 'pop') { tone(190, 0.12, 'sine', 0.06); tone(820, 0.05, 'triangle', 0.02); }
    else if (kind === 'clink') tone(1320, 0.06, 'triangle', 0.018);
    else if (kind === 'chord') [0, 4, 7].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.5, 'sine', 0.025, i * 0.06));
  } catch { /* sound is a nicety */ }
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  if (TL) { TL.skip = true; }
  L = levelById(id) || LEVELS[0];
  data.cur = L.id;
  const g = data.game;
  if (!fresh && g && g.level === L.id && g.sig === L.sig && validState(L, g.state) && Array.isArray(g.past)) {
    G = { state: g.state, past: g.past.filter((s) => validState(L, s)) };
  } else {
    G = newGame(L);
  }
  hinted = null; note = ''; dead = false; pendingHint = false; stepping = false;
  lastOpen = L.lanes.map((_, i) => laneOpen(L, G.state, i));
  render();
  sizePic();
  save();
  maybeIntro();
  scheduleDeadCheck();
}

// ---------- sheets ----------
function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  const p = el.querySelector('.panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { el.hidden = true; }
document.addEventListener('click', (e) => {
  const sh = e.target.closest('.sheet');
  if (sh && (e.target === sh || e.target.closest('[data-close]'))) closeSheet(sh);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const sh of $$('.sheet')) if (!sh.hidden && sh.id !== 'finishSheet' && sh.id !== 'introSheet') closeSheet(sh);
});

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
  const wall = $('#wall');
  wall.innerHTML = '';
  const firstOf = {};
  LEVELS.forEach((Lv, i) => { for (const m of Lv.mechanics) if (!(m in firstOf)) firstOf[m] = i; });
  BANDS.forEach((band, bi) => {
    const to = bi + 1 < BANDS.length ? BANDS[bi + 1].from : LEVELS.length;
    const h = document.createElement('h3');
    h.textContent = band.name;
    const ul = document.createElement('ul');
    ul.className = 'gallery';
    for (let i = band.from; i < to; i++) {
      const Lv = LEVELS[i];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(Lv === L));
      const fresh = Object.keys(firstOf).filter((m) => firstOf[m] === i);
      b.setAttribute('aria-label', `${i + 1}. ${Lv.name}${data.done[Lv.id] ? ', lifted' : ''}${fresh.length ? `, introduces ${fresh.map((m) => MECHANICS[m].name.toLowerCase()).join(' and ')}` : ''}`);
      const fr = document.createElement('span');
      fr.className = 'fr';
      fr.append(thumb(Lv, 72, 90));
      if (data.done[Lv.id]) { const t = document.createElement('span'); t.className = 'tick'; t.textContent = '✓'; fr.append(t); }
      b.append(fr);
      const t = document.createElement('span');
      t.className = 't';
      t.innerHTML = `<b>${i + 1}.</b> ${Lv.name}`;
      b.append(t);
      if (fresh.length) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = `new: ${MECHANICS[fresh[0]].name.toLowerCase()}`; b.append(c); }
      b.addEventListener('click', () => { closeSheet($('#levelSheet')); if (Lv !== L) startLevel(Lv.id, { fresh: true }); });
      li.append(b);
      ul.append(li);
    }
    wall.append(h, ul);
  });
  $('#restartBtn').textContent = 'Start this painting over';
  $('#fastBtn').setAttribute('aria-pressed', String(!!data.fast));
  openSheet('#levelSheet');
  $('#levelSheet [aria-current="true"]')?.scrollIntoView({ block: 'center' });
}

function openFinish() {
  if (!isDone(G.state) || !$('#finishSheet').hidden) return;
  $('#finTitle').textContent = `Your ${L.noun}, lifted`;
  const s = G.state;
  $('#finSub').textContent = `${s.shelf.length} jars of pigment, corked and on the shelf.`;
  const cv = thumb(L, Math.min(240, innerWidth - 80), 230);
  cv.id = 'finThumb';
  $('#finThumb').replaceWith(cv);
  $('#finJars').innerHTML = s.shelf.map((j) => jarHTML(j, { n: j.cap, n2: j.cap2 || 0, id: `f${j.id}` })).join('');
  const idx = LEVELS.indexOf(L);
  const next = LEVELS.slice(idx + 1).find((x) => !data.done[x.id]) || LEVELS[(idx + 1) % LEVELS.length];
  $('#finNext').textContent = `Next: ${next.name}`;
  $('#finNext').onclick = () => { closeSheet($('#finishSheet')); startLevel(next.id, { fresh: true }); };
  openSheet('#finishSheet');
  if (!reduced()) {
    anim(cv, [{ opacity: 0, transform: 'scale(.94)', filter: 'sepia(1) brightness(1.15)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 700, easing: 'ease-out' });
    $$('#finJars .jar').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(1100, i * 18), fill: 'backwards', easing: 'ease-out' }));
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
function maybeIntro() {
  if (!data.seenHow) return;
  const fresh = L.mechanics.filter((m) => !data.seenIntro[m]);
  if (!fresh.length) return;
  $('#introTitle').textContent = fresh.length > 1 ? 'Some new things on the table' : 'Something new on the table';
  $('#introBody').innerHTML = fresh.map((m) => `<div class="item">${ICON[m]}<p><strong>${MECHANICS[m].name}</strong>${MECHANICS[m].line}</p></div>`).join('');
  $('#introOk').onclick = () => { for (const m of fresh) data.seenIntro[m] = true; save(); closeSheet($('#introSheet')); };
  openSheet('#introSheet');
}

// How this works: three short steps.
const ILL = {
  pick: `<svg class="ill" viewBox="0 0 320 120" aria-hidden="true">
    <rect x="20" y="8" width="280" height="38" rx="10" fill="#4A3F36"/>
    <g>${[0, 1, 2, 3].map((i) => `<rect x="${36 + i * 68}" y="14" width="36" height="26" rx="6" fill="none" stroke="rgba(255,250,235,.25)" stroke-dasharray="4 3" stroke-width="2"/>`).join('')}</g>
    ${[['#b8433a', 60], ['#3e6a9e', 160], ['#d39b2a', 260]].map(([c, x]) => `<rect x="${x - 16}" y="70" width="32" height="38" rx="7" fill="${c}" opacity=".35" stroke="rgba(42,38,34,.4)" stroke-width="1.5"/><rect x="${x - 16}" y="70" width="32" height="7" rx="3" fill="${c}"/>`).join('')}
    <path d="M160 64 V50" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M152 56l8-9 8 9" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  lift: `<svg class="ill" viewBox="0 0 320 140" aria-hidden="true">
    ${[0, 1, 2, 3, 4, 5, 6].map((c) => { const hh = [3, 4, 2, 4, 4, 3, 4][c]; return [0, 1, 2, 3].map((r) => (r < 4 - hh ? `<rect x="${90 + c * 20}" y="${6 + r * 20}" width="20" height="20" fill="#EFE7D6"/>` : `<rect x="${90 + c * 20}" y="${6 + r * 20}" width="20" height="20" fill="${r === 3 && c % 3 === 0 ? '#b8433a' : '#8babc5'}"/>`)).join(''); }).join('')}
    <rect x="86" y="88" width="148" height="7" rx="3" fill="#B48A5A"/>
    <path d="M70 112 H250" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M242 104l9 8-9 8" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="160" cy="72" r="2.4" fill="#8babc5"/><circle cx="163" cy="80" r="2" fill="#8babc5"/>
  </svg>`,
  plan: `<svg class="ill" viewBox="0 0 320 120" aria-hidden="true">
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
  $('#howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'on' : ''}"></i>`).join('');
  $('#howBack').disabled = howStep === 0;
  $('#howNext').textContent = howStep === HOW.length - 1 ? 'Start lifting' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#howSheet'); }

// ---------- wiring ----------
$('#lanes').addEventListener('click', (e) => {
  const b = e.target.closest('.front');
  if (b) act({ t: 'place', i: +b.dataset.lane });
});
$('#belt').addEventListener('click', (e) => {
  const b = e.target.closest('.slotbtn');
  if (b) act({ t: 'park', i: +b.dataset.i });
  else if (busy) skipAll();
});
$('#bench').addEventListener('click', (e) => {
  const b = e.target.closest('.slotbtn');
  if (b) act({ t: 'unpark', i: +b.dataset.i });
});
$('#easel').addEventListener('click', () => { if (busy) skipAll(); });
$('#undoBtn').addEventListener('click', doUndo);
$('#stuckBtn').addEventListener('click', doStuck);
$('#hintBtn').addEventListener('click', doHint);
$('#backBtn').addEventListener('click', doBack);
$('#backMenuBtn').addEventListener('click', () => { $('#levelSheet').hidden = true; doBack(); });
$('#levelsBtn').addEventListener('click', () => { if (!busy) openLevels(); });
$('#howBtn').addEventListener('click', () => { if (!busy) openHow(); });
$('#glyphBtn').addEventListener('click', () => { data.glyphs = !data.glyphs; save(); render(); syncPainter(G.state); });
$('#soundBtn').addEventListener('click', () => { data.sound = !data.sound; save(); ensureAudio(); render(); sfx('clink'); });
$('#fastBtn').addEventListener('click', () => { data.fast = !data.fast; save(); $('#fastBtn').setAttribute('aria-pressed', String(data.fast)); render(); });
$('#howBack').addEventListener('click', () => { if (howStep > 0) { howStep--; renderHow(); } });
$('#howNext').addEventListener('click', () => {
  if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
  closeSheet($('#howSheet'));
  if (!data.seenHow) { data.seenHow = true; save(); maybeIntro(); }
});
let restartArmed = 0;
$('#restartBtn').addEventListener('click', () => {
  if (!restartArmed) {
    restartArmed = setTimeout(() => { restartArmed = 0; $('#restartBtn').textContent = 'Start this painting over'; }, 3000);
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
addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (L && !busy) sizePic(); }); });

// ---------- boot ----------
load();
startLevel(data.cur);
if (!data.seenHow) openHow();
else if (isDone(G.state)) openFinish();

// For quick checks from the console or a test harness (no effect on play).
window.__lift = {
  get level() { return L; }, get state() { return G.state; }, get busy() { return busy; },
  get painter() { return { h: PT.h.slice(), parts: PT.parts.length, cs: PT.cs }; },
};
