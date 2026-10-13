// app.js — the Dye Studio page. All the cloth maths lives in dyecore.js / resist.js (pure) and
// ../fabric/textures.js (weave). This file is the hands: pointers, pots, animations, the stash.

import { BASES, DYES, weaveField, shadeCloth, absorbOf, colorOfAbsorb, lookOf, drawBase, mulberry32, tileDataURL, hexRgb, rgbHex, REF } from '../fabric/textures.js';
import { ensureStarters, fabrics, addFabric, removeFabric, renameFabric, onStashChange, newId } from '../fabric/stash.js';
import {
  N_DEFAULT, POTS, BASE_DYE, createPiece, replay, applyOp, composite, dipAmount, dyeOf, dyeAbsorb, OXIDIZING, VAT_GREEN,
  bundleColor, sectionColor, dominantColor, mixSubtractive, mainDyes, makeName, tileInfo, iceComponents, waxStroke, R,
} from './dyecore.js';
import * as M from '../marbling/marble.js';

const N = N_DEFAULT;
const $ = (s) => document.querySelector(s);
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

// ------------------------------------------------------------------ techniques
const TECHS = [
  { id: 'solid', name: 'Solid', kind: 'solid' },
  { id: 'ombre', name: 'Ombré', kind: 'ombre' },
  { id: 'batik', name: 'Batik', kind: 'batik' },
  { id: 'shibori', name: 'Shibori', kind: 'shibori' },
  { id: 'tiedye', name: 'Tie-dye', kind: 'tiedye' },
  { id: 'ice', name: 'Ice dye', kind: 'ice' },
  { id: 'marbling', name: 'Marbling', kind: 'marbled' },
  { id: 'block', name: 'Block print', kind: 'block' },
];
const BIND_VERB = { itajime: 'Fold and clamp', arashi: 'Wrap the pole', kumo: 'Bind the points', mokume: 'Stitch and gather' };

// ------------------------------------------------------------------ state
const store = {
  get(k, d) { try { const v = localStorage.getItem('tincture.proto.dye.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tincture.proto.dye.' + k, JSON.stringify(v)); } catch { /* fine */ } },
};
const S = {
  tech: store.get('tech', 'batik'),
  base: store.get('base', 'batik-cotton'),
  seed: 1 + (Date.now() % 9973),
  ops: [],
  piece: null,
  wf: null,
  dye: 'indigo',
  mottle: 'mottled',
  depth: 0.62, lift: false,
  waxTool: 'tjanting', tjap: 'kawung',
  shib: { kind: 'kumo', fold: 'square', clamp: 'circle', count: 'few', rows: 13 },
  tie: 'spiral', tieN: 4,
  block: 'ginkgo', blockSize: 'small', helper: 'halfdrop', blockRot: 0,
  mtool: 'drop', bath: M.createBath(), bathUndo: [], bathOpen: true,
  loupe: false, busy: false, fast: false,
  overlay: null, // transient drawing hook: (ctx, W) => void
  dispA: null, // absorbance override while animating
  reveal: null, // { kind, t, from }
  lastKept: null,
};
if (!TECHS.some((t) => t.id === S.tech)) S.tech = 'batik';
if (!BASES.some((b) => b.id === S.base)) S.base = 'batik-cotton';
let opSeed = 1;
const nextSeed = () => (S.seed * 31 + (opSeed++) * 7919) % 100000;

// ------------------------------------------------------------------ canvas
const stage = $('#stage');
const view = $('#view');
const vctx = view.getContext('2d');
const comp = document.createElement('canvas');
comp.width = comp.height = N;
const cctx = comp.getContext('2d');
const img = cctx.createImageData(N, N);
let W = 0, dpr = 1;

function resize() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  if (w !== W) { W = w; view.width = view.height = W; }
  requestDraw();
}
new ResizeObserver(resize).observe(stage);

function renderComp(rect) {
  composite(img.data, S.piece, S.wf, { A: S.dispA || undefined, rect });
  if (rect) cctx.putImageData(img, 0, 0, rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
  else cctx.putImageData(img, 0, 0);
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

function anim(ms, fn) {
  return new Promise((resolve) => {
    if (reduceMQ.matches || S.fast || ms <= 0) { fn(1); resolve(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1 && !S.fast) requestAnimationFrame(step); else { if (t < 1) fn(1); resolve(); }
    };
    requestAnimationFrame(step);
  });
}
const wait = (ms) => (reduceMQ.matches || S.fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

// ------------------------------------------------------------------ piece & ops
function viewMode() {
  if (S.tech === 'marbling' && S.bathOpen) return 'bath';
  if (S.piece.bind) return 'bundle';
  return 'cloth';
}

function rebuild() {
  S.piece = replay(S.base, S.seed, S.ops, N);
  S.wf = weaveField(S.base, N, 1);
  scrunchCanvas = null;
  if (S.piece.bind) {
    // the outside of the bundle is the cloth as it was when it was tied
    let i = S.ops.length - 1;
    while (i >= 0 && S.ops[i].t !== 'bind') i--;
    const pre = replay(S.base, S.seed, S.ops.slice(0, Math.max(0, i)), N);
    const d = new ImageData(N, N);
    composite(d.data, pre, S.wf);
    bundleBase().getContext('2d').putImageData(d, 0, 0);
  }
  renderComp();
  refresh();
}
let _bb = null;
function bundleBase() { if (!_bb) { _bb = document.createElement('canvas'); _bb.width = _bb.height = N; } return _bb; }

function pushOp(op, { applied = false } = {}) {
  if (op.t === 'bind') bundleBase().getContext('2d').drawImage(comp, 0, 0);
  S.ops.push(op);
  if (applied) return {};
  const res = applyOp(S.piece, op);
  if (op.t === 'bind' || op.t === 'unbind') scrunchCanvas = null;
  return res;
}

function refresh() {
  $('#undoBtn').setAttribute('aria-disabled', S.ops.length || (viewMode() === 'bath' && S.bathUndo.length) ? 'false' : 'true');
  const b = BASES.find((x) => x.id === S.base);
  const p = S.piece;
  const bits = [b.name];
  if (p.meta.waxed && p.wax.some((v) => v > 0.05)) bits.push('wax on');
  if (p.bind) bits.push(p.bindKind === 'ice' ? 'on the ice' : 'bound');
  $('#tag').textContent = bits.join(' · ');
  updatePanelState();
  requestDraw();
}

let sayTimer = 0;
function say(text, ms = 2600) {
  const s = $('#say');
  s.textContent = text;
  s.classList.toggle('on', !!text);
  clearTimeout(sayTimer);
  if (text && ms) sayTimer = setTimeout(() => s.classList.remove('on'), ms);
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2800);
}

// ------------------------------------------------------------------ drawing
const TABLE = '#E9E0CD';
function drawTable(ctx) {
  ctx.fillStyle = TABLE;
  ctx.fillRect(0, 0, W, W);
  const g = ctx.createRadialGradient(W * 0.5, W * 0.45, W * 0.1, W * 0.5, W * 0.5, W * 0.75);
  g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(120,100,70,.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
}

function draw() {
  if (!W || !S.piece) return;
  const ctx = vctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const mode = viewMode();
  if (S.reveal) drawReveal(ctx);
  else if (mode === 'bath') drawBath(ctx);
  else if (mode === 'bundle') drawBundle(ctx);
  else {
    ctx.drawImage(comp, 0, 0, W, W);
    if (S.tech === 'ombre' && !S.busy) drawWaterlineGuide(ctx);
    if (S.tech === 'block') drawBlockGuides(ctx);
  }
  if (S.overlay) S.overlay(ctx, W);
  if (loupe) drawLoupe(ctx);
}

const mulColor = (a, k = 1) => `rgb(${colorOfAbsorb(a.map((v) => v * k)).map((v) => Math.round(Math.min(255, v * 255 / 252))).join(',')})`;

// ---- dye liquid (shown while the cloth is in the pot)
function drawLiquid(ctx, level, hex, t) {
  // level: 0 = waterline at the bottom, 1 = over the top
  const y = W * (1 - level);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, W);
  for (let x = 0; x <= W; x += W / 40) ctx.lineTo(x, y + Math.sin(x / W * 9 + t * 3) * W * 0.006 + Math.sin(x / W * 23 - t * 5) * W * 0.003);
  ctx.lineTo(W, W); ctx.closePath();
  ctx.globalAlpha = 0.3; ctx.fillStyle = hex; ctx.fill();
  ctx.globalAlpha = 0.55; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2 * dpr; ctx.stroke();
  // a few drifting highlights
  ctx.globalAlpha = 0.18; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr;
  for (let i = 0; i < 5; i++) {
    const yy = y + (W - y) * ((i * 0.21 + t * 0.05) % 1);
    if (yy < y + 6) continue;
    const xx = ((i * 0.37 + t * 0.04) % 1) * W;
    ctx.beginPath(); ctx.ellipse(xx, yy, W * 0.08, W * 0.012, 0, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function drawWaterlineGuide(ctx) {
  const y = W * (1 - S.depth);
  ctx.save();
  ctx.setLineDash([8 * dpr, 6 * dpr]);
  ctx.strokeStyle = 'rgba(42,38,34,.75)'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  ctx.setLineDash([]);
  const hx = W - 28 * dpr;
  ctx.fillStyle = '#FBF8F1'; ctx.strokeStyle = 'rgba(42,38,34,.75)';
  ctx.beginPath(); ctx.arc(hx, y, 14 * dpr, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(42,38,34,.8)';
  ctx.beginPath(); ctx.moveTo(hx - 5 * dpr, y - 3 * dpr); ctx.lineTo(hx, y - 8 * dpr); ctx.lineTo(hx + 5 * dpr, y - 3 * dpr); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hx - 5 * dpr, y + 3 * dpr); ctx.lineTo(hx, y + 8 * dpr); ctx.lineTo(hx + 5 * dpr, y + 3 * dpr); ctx.fill();
  ctx.font = `600 ${12 * dpr}px Figtree, sans-serif`;
  ctx.fillStyle = 'rgba(251,248,241,.92)';
  const label = 'dye line';
  const tw = ctx.measureText(label).width;
  ctx.fillRect(8 * dpr, y - 22 * dpr, tw + 12 * dpr, 18 * dpr);
  ctx.fillStyle = '#2A2622'; ctx.fillText(label, 14 * dpr, y - 9 * dpr);
  ctx.restore();
}

// ---- bundles (what the cloth looks like while it is tied, clamped or on the ice)
let scrunchCanvas = null;
function scrunch() {
  if (scrunchCanvas) return scrunchCanvas;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'); const d = x.createImageData(N, N);
  const r = S.piece.bind.resist;
  for (let p = 0; p < N * N; p++) {
    const v = r[p], o = p * 4;
    const light = v > 0.3;
    d.data[o] = light ? 255 : 70; d.data[o + 1] = light ? 255 : 55; d.data[o + 2] = light ? 255 : 40;
    d.data[o + 3] = light ? Math.min(255, (v - 0.3) * 220) : Math.min(255, (0.3 - v) * 130);
  }
  x.putImageData(d, 0, 0);
  scrunchCanvas = c;
  return c;
}

function drawBundle(ctx, extraA = [0, 0, 0]) {
  const p = S.piece, kind = p.bindKind;
  drawTable(ctx);
  const outA = p.bundleA.map((v, k) => v + extraA[k]);
  if (kind === 'itajime') return drawPacket(ctx, outA);
  if (kind === 'arashi') return drawPole(ctx, outA);
  if (kind === 'tie-spiral' || kind === 'tie-bullseye' || kind === 'tie-crumple') return drawTieBundle(ctx);
  // kumo, mokume, ice: the cloth lies flat, with its bindings / ice on top
  ctx.save();
  const inset = kind === 'ice' ? 0.04 : 0.06;
  const x0 = W * inset, s = W * (1 - 2 * inset);
  ctx.shadowColor = 'rgba(60,40,20,.28)'; ctx.shadowBlur = 14 * dpr; ctx.shadowOffsetY = 5 * dpr;
  ctx.drawImage(bundleBase(), x0, x0, s, s);
  ctx.shadowColor = 'transparent';
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = mulColor(outA); ctx.fillRect(x0, x0, s, s);
  ctx.globalCompositeOperation = 'source-over';
  if (kind === 'ice') {
    ctx.globalAlpha = 0.85; ctx.drawImage(scrunch(), x0, x0, s, s); ctx.globalAlpha = 1;
    drawIce(ctx, x0, s);
  } else if (kind === 'kumo') {
    for (const q of p.bind.pts) drawCone(ctx, x0 + q.x * s, x0 + q.y * s, q.R * s, outA);
  } else if (kind === 'mokume') {
    drawGathers(ctx, x0, s);
  }
  ctx.restore();
}

function drawPacket(ctx, outA) {
  const op = [...S.ops].reverse().find((o) => o.t === 'bind');
  const o = (op && op.opts) || {};
  const folds = o.folds || 4;
  const P = W * 0.5;
  ctx.save();
  ctx.translate(W / 2, W / 2 + W * 0.02);
  ctx.rotate(-0.07);
  const tri = o.fold === 'triangle';
  const shape = (dx, dy) => {
    ctx.beginPath();
    if (tri) { ctx.moveTo(-P / 2 + dx, -P / 2 + dy); ctx.lineTo(P / 2 + dx, -P / 2 + dy); ctx.lineTo(P / 2 + dx, P / 2 + dy); ctx.closePath(); } else ctx.rect(-P / 2 + dx, -P / 2 + dy, P, P);
  };
  // the stack of folded layers, seen at the edges
  for (let i = 7; i >= 1; i--) {
    shape(i * 1.2 * dpr, i * 1.9 * dpr);
    ctx.fillStyle = mulColor(outA, 1 + i * 0.06); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.save();
  shape(0, 0); ctx.clip();
  const src = N / folds;
  ctx.drawImage(bundleBase(), 0, 0, src, src, -P / 2, -P / 2, P, P);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = mulColor(outA); ctx.fillRect(-P / 2, -P / 2, P, P);
  ctx.restore();
  // the boards
  const board = (fn) => {
    ctx.save();
    ctx.shadowColor = 'rgba(40,25,10,.4)'; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = 4 * dpr;
    fn(); const g = ctx.createLinearGradient(-P / 2, -P / 2, P / 2, P / 2);
    g.addColorStop(0, '#D8B07C'); g.addColorStop(1, '#A87C4C');
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.strokeStyle = 'rgba(110,70,30,.25)'; ctx.lineWidth = 1.2 * dpr;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(-P, i * P * 0.06); ctx.bezierCurveTo(-P / 3, i * P * 0.06 + 6 * dpr, P / 3, i * P * 0.06 - 6 * dpr, P, i * P * 0.06); ctx.stroke(); }
    ctx.restore();
  };
  const c = o.clamp || 'circle';
  const at = (u, v) => [-P / 2 + u * P, -P / 2 + v * P];
  if (c === 'square') board(() => { const [x, y] = at(0.25, 0.25); ctx.beginPath(); ctx.rect(x, y, P * 0.5, P * 0.5); });
  else if (c === 'corner') board(() => { const [x, y] = at(0, 0); ctx.beginPath(); ctx.arc(x, y, P * 0.46, 0, TAU); });
  else if (c === 'bars') { board(() => { const [x, y] = at(0.425, -0.08); ctx.beginPath(); ctx.roundRect(x, y, P * 0.15, P * 1.16, 4 * dpr); }); board(() => { const [x, y] = at(-0.08, 0.425); ctx.beginPath(); ctx.roundRect(x, y, P * 1.16, P * 0.15, 4 * dpr); }); }
  else if (c === 'triangle') board(() => { const [x, y] = at(0.18, 0.18); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(...at(0.82, 0.18)); ctx.lineTo(...at(0.82, 0.7)); ctx.closePath(); });
  else if (tri) board(() => { const [x, y] = at(0.62, 0.3); ctx.beginPath(); ctx.arc(x, y, P * 0.22, 0, TAU); });
  else board(() => { const [x, y] = at(0.5, 0.5); ctx.beginPath(); ctx.arc(x, y, P * 0.27, 0, TAU); });
  // cords holding it all together
  ctx.strokeStyle = '#F2EBDD'; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-P * 0.62, -P * 0.1); ctx.quadraticCurveTo(0, -P * 0.02, P * 0.62, P * 0.06); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-P * 0.08, -P * 0.62); ctx.quadraticCurveTo(-P * 0.02, 0, P * 0.06, P * 0.62); ctx.stroke();
  ctx.restore();
}

function drawPole(ctx, outA) {
  ctx.save();
  ctx.translate(W / 2, W / 2);
  ctx.rotate(-0.62 - Math.PI / 2 + Math.PI);
  const L = W * 1.25, r = W * 0.12;
  const cyl = (x0, x1, c0, c1) => {
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, c1); g.addColorStop(0.35, c0); g.addColorStop(0.55, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x0, -r, x1 - x0, 2 * r, r * 0.3); ctx.fill();
  };
  ctx.shadowColor = 'rgba(40,25,10,.3)'; ctx.shadowBlur = 16 * dpr; ctx.shadowOffsetY = 8 * dpr;
  cyl(-L / 2, L / 2, '#C9CED2', '#8E979E');
  ctx.shadowColor = 'transparent';
  const a = -L * 0.3, b = L * 0.32;
  const col = mulColor(outA);
  const dark = mulColor(outA, 1.5);
  const g = ctx.createLinearGradient(0, -r * 1.12, 0, r * 1.12);
  g.addColorStop(0, dark); g.addColorStop(0.4, col); g.addColorStop(0.6, col); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(a, -r * 1.12, b - a, r * 2.24, r * 0.4); ctx.fill();
  // paper-white cloth under the color for the lighter pleat tops
  const rng = mulberry32(5);
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = a + 4 * dpr + rng() * (b - a - 8 * dpr), tilt = (rng() - 0.5) * r * 0.5;
    ctx.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.22)';
    ctx.lineWidth = (0.8 + rng() * 1.8) * dpr;
    ctx.beginPath(); ctx.moveTo(x - tilt, -r * 1.08); ctx.quadraticCurveTo(x + tilt * 0.3, 0, x + tilt, r * 1.08); ctx.stroke();
  }
  // thread, wound round and round
  ctx.strokeStyle = 'rgba(245,238,225,.75)'; ctx.lineWidth = 1.3 * dpr;
  for (let x = a + 6 * dpr; x < b - 6 * dpr; x += 7 * dpr) { ctx.beginPath(); ctx.moveTo(x, -r * 1.12); ctx.lineTo(x + 5 * dpr, r * 1.12); ctx.stroke(); }
  ctx.restore();
}

function drawCone(ctx, x, y, R, outA) {
  const r = Math.max(6 * dpr, R * 0.36);
  ctx.save();
  ctx.shadowColor = 'rgba(40,25,10,.35)'; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetX = 3 * dpr; ctx.shadowOffsetY = 5 * dpr;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#F6F0E4'); g.addColorStop(1, '#CFC5B2');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(120,105,85,.55)'; ctx.lineWidth = 1 * dpr;
  for (let k = 0.28; k < 1; k += 0.14) { ctx.beginPath(); ctx.arc(x, y, r * k, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = mulColor(outA); ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, TAU); ctx.fill();
}

function drawGathers(ctx, x0, s) {
  const op = [...S.ops].reverse().find((o) => o.t === 'bind');
  const rows = (op && op.opts && op.opts.rows) || 13;
  const rng = mulberry32(9);
  for (let i = 0; i < rows; i++) {
    const y = x0 + (i + 0.5) / rows * s;
    for (let x = x0 + 3 * dpr; x < x0 + s; x += (3 + rng() * 4) * dpr) {
      ctx.strokeStyle = rng() < 0.5 ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.2)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(x, y - s / rows * 0.42); ctx.lineTo(x + (rng() - 0.5) * 3 * dpr, y + s / rows * 0.42); ctx.stroke();
    }
    ctx.strokeStyle = '#F4EEE2'; ctx.lineWidth = 1.6 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + s, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0 + s, y); ctx.quadraticCurveTo(x0 + s + 8 * dpr, y + 6 * dpr, x0 + s + 4 * dpr, y + 14 * dpr); ctx.stroke();
  }
}

function drawIce(ctx, x0, s) {
  const rng = mulberry32(21);
  const p = S.piece;
  // powder first (it sits on the ice and in the gaps)
  for (const sp of p.sprinkles) {
    const comps = iceComponents(dyeOf(sp.dye).hex);
    const r2 = mulberry32(sp.seed);
    for (let i = 0; i < 90; i++) {
      const a = r2() * TAU, d = Math.sqrt(r2()) * s * 0.09;
      ctx.fillStyle = comps[Math.floor(r2() * comps.length)].hex;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x0 + sp.x * s + Math.cos(a) * d, x0 + sp.y * s + Math.sin(a) * d, (1 + r2() * 1.8) * dpr, (1 + r2() * 1.8) * dpr);
    }
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 16; i++) {
    const cx = x0 + (0.08 + rng() * 0.84) * s, cy = x0 + (0.08 + rng() * 0.84) * s, sz = (0.1 + rng() * 0.06) * s, rot = rng() * 1.2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.fillStyle = 'rgba(225,238,245,.32)'; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath(); ctx.roundRect(-sz / 2, -sz / 2, sz, sz, sz * 0.22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.roundRect(-sz * 0.36, -sz * 0.38, sz * 0.32, sz * 0.12, sz * 0.06); ctx.fill();
    ctx.restore();
  }
}

function tieGeom() { return { cx: W / 2, cy: W / 2, R: W * 0.42 }; }
function drawTieBundle(ctx) {
  const p = S.piece, kind = p.bindKind, n = p.bind.n;
  const { cx, cy, R } = tieGeom();
  ctx.save();
  ctx.shadowColor = 'rgba(40,25,10,.3)'; ctx.shadowBlur = 16 * dpr; ctx.shadowOffsetY = 7 * dpr;
  const blob = (k0, k1) => {
    ctx.beginPath();
    if (kind === 'tie-crumple') {
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const a = (k0 + (k1 - k0) * i / steps) * TAU;
        const rr = R * (0.86 + 0.12 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 7));
        if (i === 0) { ctx.moveTo(cx, cy); }
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
    } else { ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, k0 * TAU, k1 * TAU); ctx.closePath(); }
  };
  ctx.fillStyle = sectionColor(p, 0); blob(0, 1); ctx.fill();
  ctx.shadowColor = 'transparent';
  if (kind === 'tie-bullseye') {
    for (let k = n - 1; k >= 0; k--) { ctx.fillStyle = sectionColor(p, k); ctx.beginPath(); ctx.arc(cx, cy, R * (k + 1) / n, 0, TAU); ctx.fill(); }
  } else {
    for (let k = 0; k < n; k++) { ctx.fillStyle = sectionColor(p, k); blob(k / n, (k + 1) / n); ctx.fill(); }
  }
  // folds
  ctx.save();
  blob(0, 1); ctx.clip();
  const rng = mulberry32(3);
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const a0 = rng() * TAU;
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.16)';
    ctx.lineWidth = (1 + rng() * 2) * dpr;
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.05) {
      const r = R * t;
      const a = kind === 'tie-spiral' ? a0 + t * 1.8 : kind === 'tie-bullseye' ? a0 : a0 + Math.sin(t * 6 + i) * 0.3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const sh = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.05);
  sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, W);
  ctx.restore();
  // rubber bands / thread
  ctx.strokeStyle = '#6E6155'; ctx.lineWidth = 3.2 * dpr;
  if (kind === 'tie-bullseye') {
    for (let k = 1; k < n; k++) { ctx.beginPath(); ctx.arc(cx, cy, R * k / n, 0, TAU); ctx.stroke(); }
  } else {
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02); ctx.stroke();
    }
  }
  ctx.restore();
}

function tieSectionAt(x, y) {
  const p = S.piece;
  const { cx, cy, R } = tieGeom();
  const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
  if (r > R * 1.05) return -1;
  const n = p.bind.n;
  if (p.bindKind === 'tie-bullseye') return Math.min(n - 1, Math.floor(r / R * n));
  const a = (Math.atan2(dy, dx) / TAU + 1) % 1;
  return Math.min(n - 1, Math.floor(a * n));
}

// ---- reveal: unbinding, unfolding, rinsing
function drawReveal(ctx) {
  const rv = S.reveal, t = ease(rv.t);
  drawTable(ctx);
  if (rv.kind === 'itajime') {
    const folds = rv.folds || 4;
    const P = 1 / folds;
    const tx = Math.min(1, t * 2), ty = Math.max(0, t * 2 - 1);
    const wv = P + (1 - P) * tx, hv = P + (1 - P) * ty;
    const sx = W * (0.5 - wv / 2), sy = W * (0.5 - hv / 2);
    ctx.drawImage(comp, 0, 0, N * wv, N * hv, sx, sy, W * wv, W * hv);
    // creases fade as it opens
    ctx.strokeStyle = `rgba(0,0,0,${0.25 * (1 - t)})`; ctx.lineWidth = 1.5 * dpr;
    for (let i = 1; i < folds; i++) {
      if (i * P < wv) { ctx.beginPath(); ctx.moveTo(sx + W * i * P, sy); ctx.lineTo(sx + W * i * P, sy + W * hv); ctx.stroke(); }
      if (i * P < hv) { ctx.beginPath(); ctx.moveTo(sx, sy + W * i * P); ctx.lineTo(sx + W * wv, sy + W * i * P); ctx.stroke(); }
    }
    return;
  }
  // everything else: the bundle relaxes and the cloth opens out
  ctx.save();
  ctx.globalAlpha = 1 - t;
  if (rv.bundle) ctx.drawImage(rv.bundle, 0, 0, W, W);
  ctx.globalAlpha = t;
  ctx.translate(W / 2, W / 2);
  const s = 0.55 + 0.45 * t;
  ctx.rotate((rv.kind === 'tie-spiral' ? -1.4 : rv.kind === 'arashi' ? 0.5 : 0.15) * (1 - t));
  ctx.scale(s, s);
  ctx.drawImage(comp, -W / 2, -W / 2, W, W);
  ctx.restore();
}

async function unbindWithReveal() {
  const p = S.piece;
  if (!p.bind) return;
  const kind = p.bindKind;
  const bindOp = [...S.ops].reverse().find((o) => o.t === 'bind');
  const snap = document.createElement('canvas'); snap.width = snap.height = W;
  drawBundle(snap.getContext('2d'));
  pushOp({ t: 'unbind' });
  renderComp();
  S.reveal = { kind, t: 0, folds: bindOp && bindOp.opts && bindOp.opts.folds, bundle: snap };
  S.busy = true;
  say(kind === 'ice' ? 'Rinsing out the ice water…' : kind.startsWith('tie') ? 'Rinse, cut the bands, open it out…' : 'Unbinding…', 2200);
  await anim(kind === 'itajime' ? 1700 : 1300, (t) => { S.reveal.t = t; draw(); });
  S.reveal = null; S.busy = false;
  refresh();
}

// ---- ice melting: blooms appear as the ice goes
async function melt() {
  const p = S.piece;
  if (!p.bind || p.bindKind !== 'ice') return;
  if (!p.sprinkles.length) { say('Sprinkle some dye on the ice first'); return; }
  const before = Float32Array.from(p.A);
  // the dye is already in p.A; show it arriving
  S.busy = true;
  say('The ice is melting…', 2400);
  const disp = new Float32Array(p.A.length);
  S.dispA = disp;
  pushOp({ t: 'unbind' });
  const bundle = document.createElement('canvas'); bundle.width = bundle.height = W;
  await anim(1800, (t) => {
    const k = ease(t);
    // blooms grow from their strongest parts outward
    for (let i = 0; i < disp.length; i++) { const v = p.A[i]; disp[i] = v * Math.min(1, k * (1 + v)); }
    renderComp(); draw();
  });
  S.dispA = null; S.busy = false;
  renderComp(); refresh();
  void before;
}

// ---- marbling bath
const marbleColors = new Map(POTS.map((d) => [d.hex, d.id]));
function bathPath(ctx, pts, k) {
  ctx.beginPath();
  ctx.moveTo(pts[0] * k, pts[1] * k);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * k, pts[i + 1] * k);
  ctx.closePath();
}
function edgeColor(hex) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${Math.round(r * 0.72 + 8)},${Math.round(g * 0.72 + 6)},${Math.round(b * 0.72 + 3)},.7)`;
}
function paintBath(ctx, px, bg = true) {
  const k = px / M.BATH_SIZE;
  if (bg) { ctx.fillStyle = M.BATH_COLOR; ctx.fillRect(0, 0, px, px); }
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, px / 520);
  for (const ink of S.bath.inks) {
    bathPath(ctx, ink.pts, k);
    ctx.fillStyle = ink.color; ctx.fill();
    ctx.strokeStyle = edgeColor(ink.color); ctx.stroke();
  }
}
function drawBath(ctx) {
  // the tray: a shallow rim, then the size
  ctx.fillStyle = '#8D8578'; ctx.fillRect(0, 0, W, W);
  ctx.save();
  const m = 6 * dpr;
  ctx.beginPath(); ctx.roundRect(m, m, W - 2 * m, W - 2 * m, 10 * dpr); ctx.clip();
  ctx.translate(m, m);
  paintBath(ctx, W - 2 * m);
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, W, W);
  g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.06)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
}
function bathPoint(e) {
  const r = stage.getBoundingClientRect();
  const m = 6 / r.width;
  return [((e.clientX - r.left) / r.width - m) / (1 - 2 * m) * M.BATH_SIZE, ((e.clientY - r.top) / r.height - m) / (1 - 2 * m) * M.BATH_SIZE];
}
function bathSnapshot() { S.bathUndo.push(M.snapshot(S.bath)); if (S.bathUndo.length > 14) S.bathUndo.shift(); }

function marbleDelta() {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  paintBath(x, N, false);
  const d = x.getImageData(0, 0, N, N).data;
  const delta = new Float32Array(N * N * 3);
  const lut = [0, 1, 2].map((k) => Float32Array.from({ length: 256 }, (_, v) => Math.max(0, -Math.log(Math.max(4, v) / REF[k]))));
  const bd = BASE_DYE[S.base] || BASE_DYE['quilting-cotton'];
  const rng = mulberry32(nextSeed());
  for (let p = 0; p < N * N; p++) {
    const a = d[p * 4 + 3] / 255;
    if (!a) continue;
    const u = a * bd.uptake * (0.86 + 0.14 * rng());
    for (let k = 0; k < 3; k++) delta[p * 3 + k] = lut[k][d[p * 4 + k]] * u;
  }
  return delta;
}

async function layCloth() {
  if (!S.bath.inks.length) { say('Float some colors on the bath first'); return; }
  S.busy = true;
  const dyes = [...new Set(S.bath.inks.map((i) => marbleColors.get(i.color)).filter(Boolean))];
  say('Laying the cloth on the bath…', 1800);
  await anim(900, (t) => {
    S.overlay = (ctx) => {
      // the cloth rolls down onto the bath from the top edge
      const h = W * ease(t);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 12 * dpr; ctx.shadowOffsetY = 4 * dpr;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(comp, 0, 0, N, N * Math.max(0.001, ease(t)), 0, 0, W, Math.max(1, h));
      ctx.restore();
    };
    draw();
  });
  const delta = marbleDelta();
  pushOp({ t: 'marble', delta, dyes });
  renderComp();
  S.bath = M.createBath(); S.bathUndo = []; S.bathOpen = false;
  S.overlay = null;
  // lift it off: the print is on the cloth
  await anim(700, (t) => {
    S.overlay = (ctx) => { ctx.fillStyle = `rgba(233,224,205,${1 - t})`; ctx.fillRect(0, 0, W, W); };
    draw();
  });
  S.overlay = null; S.busy = false;
  say('Lifted! The bath is skimmed clean for another layer.', 2600);
  refresh(); renderPanel();
}

// ---- block printing
const BLOCK_SIZES = { small: 0.2, large: 1 / 3 };
function blockPositions() { return R.repeatGrid(BLOCK_SIZES[S.blockSize], S.helper); }
function drawBlockGuides(ctx) {
  if (S.helper === 'free') return;
  const s = BLOCK_SIZES[S.blockSize];
  ctx.save();
  ctx.strokeStyle = 'rgba(42,38,34,.28)'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 4 * dpr]);
  for (const [x, y] of blockPositions()) {
    for (const dy of [-1, 0, 1]) {
      const yy = (y + dy) * W;
      if (yy < -s * W || yy > W + s * W) continue;
      ctx.strokeRect((x - s / 2) * W + 2 * dpr, yy - s * W / 2 + 2 * dpr, s * W - 4 * dpr, s * W - 4 * dpr);
    }
  }
  ctx.restore();
}
const blockImgCache = new Map();
function blockFace(id, px, ink) {
  const key = id + px + ink;
  if (blockImgCache.has(key)) return blockImgCache.get(key);
  const S2 = Math.round(px);
  const m = R.blockMask(id, S2);
  const c = document.createElement('canvas'); c.width = c.height = S2;
  const x = c.getContext('2d'); const d = x.createImageData(S2, S2);
  const [ir, ig, ib] = hexRgb(ink);
  for (let i = 0; i < S2 * S2; i++) {
    const v = m[i], o = i * 4;
    d.data[o] = 185 + (ir - 185) * v * 0.85; d.data[o + 1] = 140 + (ig - 140) * v * 0.85; d.data[o + 2] = 90 + (ib - 90) * v * 0.85; d.data[o + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  blockImgCache.set(key, c);
  return c;
}

async function stampAt(u, v, quick = false) {
  let x = u, y = v;
  if (S.helper !== 'free') {
    let best = 1e9;
    for (const [px, py] of blockPositions()) for (const dy of [-1, 0, 1]) {
      const d = (px - u) ** 2 + (py + dy - v) ** 2;
      if (d < best) { best = d; x = px; y = (py + dy + 1) % 1; }
    }
  }
  const s = BLOCK_SIZES[S.blockSize];
  const op = { t: 'stamp', block: S.block, x, y, size: s, rot: S.blockRot, dye: S.dye, seed: nextSeed() };
  if (!quick) {
    const face = blockFace(S.block, Math.round(s * W), dyeOf(S.dye).hex);
    await anim(170, (t) => {
      S.overlay = (ctx) => {
        const k = 1.25 - 0.25 * t, sz = s * W * k;
        ctx.save(); ctx.globalAlpha = 0.35 + 0.6 * t;
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14 * dpr * (1 - t); ctx.shadowOffsetY = 10 * dpr * (1 - t);
        ctx.translate(x * W, y * W); ctx.rotate(S.blockRot * Math.PI / 2);
        ctx.drawImage(face, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      };
      draw();
    });
  }
  pushOp(op);
  renderComp();
  S.overlay = null;
  refresh();
}

async function stampAllOver() {
  S.busy = true;
  const pos = blockPositions();
  for (const [x, y] of pos) { await stampAt(x, y, true); draw(); await wait(70); }
  S.busy = false;
  refresh();
}

// ---- tjap (copper wax stamp) and the tjanting
const WAX_R = { tjanting: 0.0046, bold: 0.0085, brush: 0.022 };
async function tjapAt(u, v) {
  const op = { t: 'tjap', block: S.tjap, x: u, y: v, size: 0.24, rot: 0, seed: nextSeed() };
  await anim(160, (t) => {
    S.overlay = (ctx) => {
      ctx.save(); ctx.globalAlpha = 0.5 * (1 - t) + 0.3;
      ctx.fillStyle = '#B87333';
      const sz = 0.24 * W * (1.2 - 0.2 * t);
      ctx.beginPath(); ctx.roundRect(u * W - sz / 2, v * W - sz / 2, sz, sz, 8 * dpr); ctx.fill();
      ctx.restore();
    };
    draw();
  });
  S.overlay = null;
  pushOp(op);
  renderComp();
  refresh();
}
async function tjapAllOver() {
  S.busy = true;
  const pos = R.repeatGrid(0.25, 'halfdrop');
  for (const [x, y] of pos) { pushOp({ t: 'tjap', block: S.tjap, x, y, size: 0.24, rot: 0, seed: nextSeed() }); renderComp(); draw(); await wait(60); }
  S.busy = false; refresh();
}

// ------------------------------------------------------------------ dipping
function soak(ms) { return 0.28 + 1.05 * (1 - Math.exp(-ms / 1500)); }

let dip = null;
function dipOp() {
  const op = { t: 'dip', dye: S.dye, s: 1, seed: nextSeed() };
  if (S.tech === 'solid') op.mottle = S.mottle === 'mottled' ? 0.7 : 0.05;
  else op.mottle = S.tech === 'batik' ? 0.15 : 0.3;
  if (S.tech === 'ombre') { op.depth = S.depth; op.lift = S.lift; }
  return op;
}
function startDip(force = false) {
  if ((S.busy && !force) || dip) return;
  if (viewMode() === 'bath') return;
  const op = dipOp();
  const absorb = dyeAbsorb(op.dye);
  const bound = !!S.piece.bind;
  if (bound && S.piece.bind.coord) { say('Squirt dye onto the sections of the bundle instead'); return; }
  const unit = bound ? null : dipAmount(S.piece, { ...op, s: 1 });
  dip = { op, absorb, unit, t0: performance.now(), bound, disp: bound ? null : new Float32Array(S.piece.A.length) };
  say(OXIDIZING.has(op.dye) ? 'In the vat… hold for a deeper blue' : 'Soaking… hold for a deeper shade', 0);
  const loop = (now) => {
    if (!dip) return;
    const ms = reduceMQ.matches ? 1500 : now - dip.t0;
    const s = soak(ms);
    dip.s = s;
    const level = Math.min(1, ms / 260);
    if (dip.bound) {
      const extra = absorb.map((v) => v * s);
      S.overlay = (ctx) => { drawBundle(ctx, extra); drawLiquid(ctx, (op.depth ?? 1) * level + 0.06, dyeOf(op.dye).hex, now / 1000); };
    } else {
      const A = S.piece.A, u = dip.unit, d = dip.disp;
      for (let p = 0; p < u.length; p++) { const v = u[p] * s; const q = p * 3; d[q] = A[q] + v * absorb[0]; d[q + 1] = A[q + 1] + v * absorb[1]; d[q + 2] = A[q + 2] + v * absorb[2]; }
      S.dispA = d; renderComp(); S.dispA = null;
      S.overlay = (ctx) => drawLiquid(ctx, ((op.depth ?? 1) >= 1 ? 1.05 : op.depth) * level, dyeOf(op.dye).hex, now / 1000);
    }
    updateHoldFill(s);
    draw();
    dip.raf = requestAnimationFrame(loop);
  };
  dip.raf = requestAnimationFrame(loop);
}
async function endDip() {
  if (!dip) return;
  const d = dip; dip = null;
  cancelAnimationFrame(d.raf);
  const s = d.s || soak(reduceMQ.matches ? 1500 : performance.now() - d.t0);
  const op = { ...d.op, s: Math.round(s * 1000) / 1000 };
  S.busy = true;
  const res = pushOp(op);
  updateHoldFill(0);
  // the pot drains away
  const lvl = (op.depth ?? 1) >= 1 ? 1.05 : op.depth;
  renderComp();
  await anim(380, (t) => { S.overlay = (ctx) => { if (d.bound) drawBundle(ctx); drawLiquid(ctx, lvl * (1 - t), dyeOf(op.dye).hex, t); }; draw(); });
  S.overlay = null;
  if (OXIDIZING.has(op.dye) && res.amount && !reduceMQ.matches && !S.fast) {
    // out of the vat it is yellow-green, and turns blue as the air gets to it
    say('Watch it turn from green to blue in the air', 2400);
    const green = absorbOf(VAT_GREEN);
    const disp = new Float32Array(S.piece.A.length);
    const A = S.piece.A, amt = res.amount, ab = res.absorb;
    await anim(1600, (t) => {
      const k = ease(t);
      const mix = [0, 1, 2].map((c) => green[c] + (ab[c] - green[c]) * k);
      for (let p = 0; p < amt.length; p++) { const v = amt[p]; const q = p * 3; disp[q] = A[q] + v * (mix[0] - ab[0]); disp[q + 1] = A[q + 1] + v * (mix[1] - ab[1]); disp[q + 2] = A[q + 2] + v * (mix[2] - ab[2]); }
      S.dispA = disp; renderComp(); S.dispA = null; draw();
    });
    renderComp();
  } else if (OXIDIZING.has(op.dye) && d.bound && !reduceMQ.matches && !S.fast) {
    say('Green in the vat, blue in the air', 2000);
  } else say('');
  S.busy = false;
  refresh();
}
let holdFills = [];
function updateHoldFill(s) {
  for (const f of holdFills) f.style.width = `${Math.min(100, (s / 1.33) * 100)}%`;
}

async function demoDip(opts, ms) {
  Object.assign(S, opts);
  if (opts.dye) pickDye(opts.dye);
  startDip(true);
  await wait(ms);
  if (dip && (reduceMQ.matches || S.fast)) dip.s = soak(ms);
  await endDip();
}

// ------------------------------------------------------------------ pointer on the stage
let gesture = null;
let loupe = null;
function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
stage.addEventListener('pointerdown', (e) => {
  if (S.busy || dip) return;
  stage.setPointerCapture(e.pointerId);
  const [u, v] = stagePoint(e);
  if (S.loupe && viewMode() === 'cloth') { loupe = { u, v }; requestDraw(); gesture = { kind: 'loupe' }; return; }
  const mode = viewMode();
  if (mode === 'bath') return bathDown(e);
  if (mode === 'bundle') {
    const p = S.piece;
    if (p.bind.coord) {
      const k = tieSectionAt(u * W, v * W);
      if (k < 0) return;
      const op = { t: 'squirt', k, dye: S.dye, s: 1.05, seed: nextSeed() };
      pushOp(op); renderComp();
      squirtFx(u, v);
      refresh();
      say(`${dyeOf(S.dye).name} on section ${k + 1}`, 1400);
    } else if (p.bindKind === 'ice') {
      const x0 = 0.04, s = 0.92;
      const op = { t: 'ice', x: Math.min(1, Math.max(0, (u - x0) / s)), y: Math.min(1, Math.max(0, (v - x0) / s)), dye: S.dye, s: 1.1, seed: nextSeed() };
      pushOp(op); renderComp(); refresh();
    } else say('Dip it in a pot, then open it up');
    return;
  }
  if (S.tech === 'batik') {
    if (S.waxTool === 'tjap') { tjapAt(u, v); return; }
    const op = { t: 'wax', tool: S.waxTool === 'brush' ? 'brush' : 'tjanting', pts: [u, v], r: WAX_R[S.waxTool], seed: nextSeed() };
    gesture = { kind: 'wax', op };
    const rect = waxStroke(S.piece, op.pts, op.r, op.seed, op.tool, 0);
    renderComp(rect); requestDraw();
    say('');
    return;
  }
  if (S.tech === 'ombre') { gesture = { kind: 'line' }; S.depth = Math.min(0.97, Math.max(0.05, 1 - v)); requestDraw(); return; }
  if (S.tech === 'block') { stampAt(u, v); return; }
  say(S.tech === 'solid' ? 'Choose a pot below and hold to dip' : 'Follow the steps below');
});
stage.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  if (gesture.kind === 'loupe') { const [u, v] = stagePoint(e); loupe = { u, v }; requestDraw(); return; }
  if (gesture.kind === 'bath') return bathMove(evs);
  if (gesture.kind === 'line') { const [, v] = stagePoint(e); S.depth = Math.min(0.97, Math.max(0.05, 1 - v)); requestDraw(); return; }
  if (gesture.kind === 'wax') {
    const op = gesture.op;
    let rect = null;
    for (const ev of evs) {
      const [u, v] = stagePoint(ev);
      const lx = op.pts[op.pts.length - 2], ly = op.pts[op.pts.length - 1];
      if (Math.hypot(u - lx, v - ly) < 0.002) continue;
      op.pts.push(u, v);
      const r = waxStroke(S.piece, op.pts, op.r, op.seed, op.tool, op.pts.length / 2 - 1);
      rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r;
    }
    if (rect && rect[2] > rect[0]) { renderComp(rect); requestDraw(); }
  }
});
function endGesture() {
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (g.kind === 'loupe') { loupe = null; requestDraw(); return; }
  if (g.kind === 'bath') return bathUp();
  if (g.kind === 'wax') { pushOp(g.op, { applied: true }); refresh(); }
  if (g.kind === 'line') refresh();
}
stage.addEventListener('pointerup', endGesture);
stage.addEventListener('pointercancel', endGesture);

function squirtFx(u, v) {
  const hex = dyeOf(S.dye).hex;
  anim(420, (t) => {
    S.overlay = t < 1 ? (ctx) => { ctx.save(); ctx.globalAlpha = 0.6 * (1 - t); ctx.fillStyle = hex; ctx.beginPath(); ctx.arc(u * W, v * W, (10 + 40 * t) * dpr, 0, TAU); ctx.fill(); ctx.restore(); } : null;
    draw();
  });
}

// ---- marbling gestures
let dropH = null;
function bathDown(e) {
  const p = bathPoint(e);
  bathSnapshot();
  const hex = dyeOf(S.dye).hex;
  if (S.mtool === 'drop') {
    dropH = M.beginDrop(S.bath, p[0], p[1], hex);
    gesture = { kind: 'bath', tool: 'drop', t0: performance.now(), p };
    const grow = () => {
      if (!gesture || gesture.tool !== 'drop') return;
      const ms = performance.now() - gesture.t0;
      const r = reduceMQ.matches ? 80 : 40 + 120 * (1 - Math.exp(-ms / 700));
      M.growDrop(S.bath, dropH, r);
      draw();
      gesture.raf = requestAnimationFrame(grow);
    };
    grow();
  } else gesture = { kind: 'bath', tool: S.mtool, last: p, start: p, nrm: null };
  refresh();
}
function bathMove(evs) {
  const g = gesture;
  if (g.tool === 'drop') return;
  for (const ev of evs) {
    const p = bathPoint(ev);
    if (Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < 6) continue;
    if (g.tool === 'stylus') M.stylusStep(S.bath, g.last, p);
    else {
      if (!g.nrm) {
        if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 24) continue;
        g.nrm = M.pathNormal([g.start, p]);
        g.tines = M.basinOffsets(g.start, g.nrm, 70);
      }
      M.combStep(S.bath, g.last, p, g.nrm, g.tines, 70);
    }
    g.last = p;
  }
  requestDraw();
}
function bathUp() {
  if (dropH) { cancelAnimationFrame(gesture?.raf); dropH = null; }
  M.maintain(S.bath);
  requestDraw();
}

// ---- loupe: look closer at the threads
function drawLoupe(ctx) {
  const D = Math.round(150 * dpr);
  const span = 0.2; // of the cloth width
  const T = Math.max(8, Math.round(512 / lookOf(S.base).pitch * span));
  const wf = weaveField(S.base, D, 1, T + (T & 1));
  const A = new Float32Array(D * D * 3);
  const PA = S.piece.A;
  const cx = loupe.u * N, cy = loupe.v * N, sp = span * N;
  for (let y = 0; y < D; y++) {
    const sy = Math.min(N - 1, Math.max(0, Math.floor(cy - sp / 2 + (y / D) * sp)));
    for (let x = 0; x < D; x++) {
      const sx = Math.min(N - 1, Math.max(0, Math.floor(cx - sp / 2 + (x / D) * sp)));
      const q = (sy * N + sx) * 3, o = (y * D + x) * 3;
      A[o] = PA[q]; A[o + 1] = PA[q + 1]; A[o + 2] = PA[q + 2];
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = D;
  const x = c.getContext('2d'); const d = x.createImageData(D, D);
  shadeCloth(d.data, D, wf, { A });
  x.putImageData(d, 0, 0);
  const lx = Math.min(W - D / 2 - 6, Math.max(D / 2 + 6, loupe.u * W)), ly = Math.max(D / 2 + 6, loupe.v * W - D * 0.75);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14 * dpr; ctx.shadowOffsetY = 4 * dpr;
  ctx.beginPath(); ctx.arc(lx, ly, D / 2, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip(); ctx.drawImage(c, lx - D / 2, ly - D / 2);
  ctx.restore();
  ctx.strokeStyle = '#FBF8F1'; ctx.lineWidth = 4 * dpr; ctx.beginPath(); ctx.arc(lx, ly, D / 2, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(42,38,34,.5)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(lx, ly, D / 2 + 2 * dpr, 0, TAU); ctx.stroke();
}

// ------------------------------------------------------------------ panel UI
function seg(options, value, onChange, label) {
  const s = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const [v, text] of options) {
    s.append(el('button', { 'aria-pressed': String(v === value), onclick: () => { if (S.busy) return; for (const b of s.children) b.setAttribute('aria-pressed', String(b === s.querySelector(`[data-v="${v}"]`))); onChange(v); }, 'data-v': v }, text));
  }
  return s;
}
function step(n, title, desc, ...body) {
  return el('div', { class: 'step' },
    el('div', { class: 'h' }, el('span', { class: 'n' }, String(n)), el('span', { class: 't' }, title)),
    desc ? el('div', { class: 'd' }, desc) : null,
    el('div', { class: 'body' }, ...body));
}
function renderPots() {
  const g = $('#pots');
  g.textContent = '';
  for (const d of POTS) {
    g.append(el('button', { class: 'pot', 'aria-pressed': String(d.id === S.dye), 'aria-label': d.name, 'data-dye': d.id, onclick: () => pickDye(d.id) },
      el('i', { style: `background: radial-gradient(circle at 40% 35%, ${mixHex(d.hex, '#ffffff', 0.18)}, ${d.hex} 55%, ${mixHex(d.hex, '#000000', 0.3)})` }), el('span', {}, d.name)));
  }
  updateDockDye();
}
function pickDye(id) {
  S.dye = id;
  for (const x of document.querySelectorAll('.pot')) x.setAttribute('aria-pressed', String(x.dataset.dye === id));
  for (const sw of document.querySelectorAll('.hold .sw')) sw.style.background = dyeOf(id).hex;
  updateDockDye();
  if (S.tech === 'marbling') openBath();
}
function updateDockDye() {
  const d = dyeOf(S.dye);
  const what = { solid: 'Dye pot', ombre: 'Dye pot', batik: 'Dye pot', shibori: 'Vat', tiedye: 'Squeeze bottle', ice: 'Dye powder', marbling: 'Ink', block: 'Ink' }[S.tech] || 'Dye';
  $('#dockLabel').textContent = what;
  $('#dockDye').innerHTML = `<b>${d.name}</b>`;
  const pot = document.querySelector(`.pot[data-dye="${S.dye}"]`);
  if (pot && pot.scrollIntoView && !renderPots.scrolled) { renderPots.scrolled = true; pot.scrollIntoView({ block: 'nearest', inline: 'center' }); }
}
function renderDock() {
  const act = $('#dockAct');
  act.textContent = '';
  holdFills = holdFills.filter((f) => f.isConnected);
  const t = S.tech, p = S.piece;
  if (t === 'solid' || t === 'ombre' || t === 'batik' || t === 'shibori') act.append(holdButton('Hold to dip'));
  else if (t === 'tiedye') act.append(p.bind ? action('Rinse and open', unbindWithReveal, 'btn primary') : action('Tie it', tieUp, 'btn primary'));
  else if (t === 'ice') act.append(p.bind ? action('Let it melt', melt, 'btn primary') : action('Scrunch it and pile on ice', iceUp, 'btn primary'));
  else if (t === 'marbling') act.append(S.bathOpen ? action('Lay the cloth', layCloth, 'btn primary') : action('Float more colors', async () => { openBath(); renderDock(); }, 'btn'));
  else if (t === 'block') act.append(action('Stamp all over', stampAllOver, 'btn primary'));
  if (t === 'shibori' && p.bind) act.append(action('Open it', unbindWithReveal, 'btn'));
  for (const b of act.querySelectorAll('.btn')) b.style.minHeight = '48px';
  updateDockDye();
}

function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * t)); }
function holdButton(label) {
  const fill = el('span', { class: 'fill' });
  holdFills.push(fill);
  const b = el('button', { class: 'btn primary hold' }, fill, el('i', { class: 'sw', style: `background:${dyeOf(S.dye).hex}` }), el('span', {}, label));
  b.setAttribute('aria-label', label + ' (press and hold)');
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); startDip(); });
  b.addEventListener('pointerup', () => endDip());
  b.addEventListener('pointercancel', () => endDip());
  b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startDip(); } });
  b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') endDip(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}
function action(label, fn, cls = 'btn') {
  return el('button', { class: cls, onclick: async () => { if (S.busy) return; await fn(); } }, label);
}

const thumbCache = new Map();
function thumb(key, ops, base = 'quilting-cotton', px = 64) {
  const c = el('canvas', { width: px * 2, height: px * 2 });
  const paint = () => {
    let url = thumbCache.get(key);
    if (!url) {
      const n = 128;
      const p = replay(base, 3, ops, n);
      const wf = weaveField(base, n, 1, 64);
      const t = document.createElement('canvas'); t.width = t.height = n;
      const x = t.getContext('2d'); const d = x.createImageData(n, n);
      composite(d.data, p, wf); x.putImageData(d, 0, 0);
      url = t; thumbCache.set(key, t);
    }
    c.getContext('2d').drawImage(url, 0, 0, c.width, c.height);
  };
  if (thumbCache.has(key)) paint(); else setTimeout(paint, 30 + thumbCache.size * 15);
  return c;
}
function picks(items, value, onChange, label) {
  const g = el('div', { class: 'picks', role: 'group', 'aria-label': label });
  for (const it of items) {
    g.append(el('button', { class: 'pick', 'aria-pressed': String(it.id === value), 'data-id': it.id, onclick: () => {
      if (S.busy) return;
      for (const b of g.children) b.setAttribute('aria-pressed', String(b.dataset.id === it.id));
      onChange(it.id);
    } }, it.canvas, it.name));
  }
  return g;
}

function clothRow() {
  const wrap = el('div', {});
  const grid = el('div', { class: 'bases', role: 'group', 'aria-label': 'Cloth' });
  const note = el('p', { class: 'baseNote' });
  const setNote = () => { const b = BASES.find((x) => x.id === S.base); note.innerHTML = `<b>${b.name}.</b> ${b.note} ${BASE_TIP[b.id] || ''}`; };
  for (const b of BASES) {
    const c = el('canvas', { width: 96, height: 96 });
    drawBase(c.getContext('2d'), 96, b.id, mixSubtractive([{ hex: '#3E6A9E', s: 0.45 }], lookOf(b.id).paper), mulberry32(4), { threads: 14 });
    grid.append(el('button', { class: 'base', 'aria-pressed': String(b.id === S.base), 'aria-label': b.name, 'data-id': b.id, onclick: () => {
      if (S.busy || S.base === b.id) return;
      S.base = b.id; store.set('base', b.id);
      for (const x of grid.children) x.setAttribute('aria-pressed', String(x.dataset.id === b.id));
      setNote();
      rebuild();
      if (S.ops.length) say(`Your piece, on ${b.name.toLowerCase()}`);
    } }, c));
  }
  setNote();
  wrap.append(grid, note);
  return wrap;
}
const BASE_TIP = {
  'quilting-cotton': 'Takes dye evenly.',
  'batik-cotton': 'Colors come out clear and bright.',
  linen: 'Dye goes on softer and mottled; the natural oatmeal shows through.',
  flannel: 'The nap softens every color.',
  voile: 'Takes dye lightly and wicks it far.',
  chambray: 'The white weft keeps colors light and heathered.',
  'shot-cotton': 'The weft takes the dye a different way, so it shimmers.',
};

let panelRefs = {};
function renderPanel() {
  const P = $('#panel');
  P.textContent = '';
  holdFills = [];
  panelRefs = {};
  const t = S.tech;
  let n = 1;
  P.append(step(n++, 'Choose the cloth', null, clothRow()));
  if (t === 'solid') {
        P.append(step(n++, 'Dip', 'Pick a pot below, then hold the button: the longer you hold, the deeper the shade. Dip again to deepen it, or in another pot to overdye.',
      el('div', { class: 'row' }, seg([['even', 'Stir often (even)'], ['mottled', 'Leave it (mottled)']], S.mottle, (v) => { S.mottle = v; }, 'Stirring'))));
  } else if (t === 'ombre') {
        P.append(step(n++, 'Set the dye line', 'Drag up or down on the cloth to choose how deep it goes in.',
      seg([['still', 'Hold it still'], ['lift', 'Lift slowly']], S.lift ? 'lift' : 'still', (v) => { S.lift = v === 'lift'; }, 'Dip style')));
    P.append(step(n++, 'Dip', 'Pick a pot below and hold to dip. For a stepped ombré, raise the line and dip again for a shorter soak.'));
  } else if (t === 'batik') {
    const tools = seg([['tjanting', 'Fine line'], ['bold', 'Bold line'], ['brush', 'Brush'], ['tjap', 'Tjap']], S.waxTool, (v) => { S.waxTool = v; renderPanel(); }, 'Wax tool');
    const extra = S.waxTool === 'tjap'
      ? el('div', {}, picks(R.TJAPS.map((b) => ({ ...b, canvas: thumb('tjap-' + b.id, [{ t: 'tjap', block: b.id, x: 0.5, y: 0.5, size: 0.9, seed: 1 }, { t: 'dip', dye: 'indigo', s: 0.8, seed: 1 }]) })), S.tjap, (v) => { S.tjap = v; }, 'Tjap'),
        el('div', { class: 'row', style: 'margin-top:8px' }, action('Stamp all over', tjapAllOver)))
      : null;
    P.append(step(n++, 'Draw with hot wax', S.waxTool === 'tjap' ? 'Tap the cloth to press the copper tjap.' : 'Drag on the cloth with the tjanting (a little copper pot of hot wax). Slow down for a fatter line. Wax keeps the color it covers.', tools, extra));
    P.append(step(n++, 'Dye', 'Pick a pot below and hold to dip. Light colors first, darker over them: each dip mixes with the last.'));
    P.append(step(n++, 'Wax more, dye darker', 'Repeat 2 and 3 as often as you like.'));
    P.append(step(n++, 'Crackle (if you like)', 'Crumple the waxed cloth; the dye seeps into the cracks.', action('Crumple the cloth', crumpleFx)));
    P.append(step(n++, 'Boil off the wax', null, action('Boil it off', boilFx, 'btn primary')));
  } else if (t === 'shibori') {
    const k = S.shib.kind;
    const items = R.SHIBORI.map((s) => ({ ...s, canvas: thumb('shib-' + s.id, [{ t: 'bind', kind: s.id, opts: {}, seed: 2 }, { t: 'dip', dye: 'indigo', s: 1, seed: 1 }]) }));
    const opts = k === 'itajime'
      ? el('div', {}, el('div', { class: 'row' }, seg([['square', 'Squares'], ['triangle', 'Triangles']], S.shib.fold, (v) => { S.shib.fold = v; }, 'Fold')),
        el('div', { class: 'row' }, seg([['circle', 'Circle'], ['square', 'Square'], ['corner', 'Corner'], ['bars', 'Sticks']], S.shib.clamp, (v) => { S.shib.clamp = v; }, 'Clamp')))
      : k === 'kumo' ? el('div', { class: 'row' }, seg([['one', 'One'], ['few', 'A few'], ['many', 'Many']], S.shib.count, (v) => { S.shib.count = v; }, 'Points'))
      : k === 'mokume' ? el('div', { class: 'row' }, seg([['18', 'Close rows'], ['13', 'Medium'], ['9', 'Wide rows']], String(S.shib.rows), (v) => { S.shib.rows = +v; }, 'Rows')) : null;
    const bindBtn = action(BIND_VERB[k], bindShibori, 'btn primary');
    panelRefs.bindBtn = bindBtn;
    P.append(step(n++, 'Bind', R.SHIBORI.find((s) => s.id === k).note,
      picks(items, k, (v) => { S.shib.kind = v; renderPanel(); }, 'Binding'), opts ? el('div', { style: 'margin-top:8px' }, opts) : null, el('div', { class: 'row', style: 'margin-top:8px' }, bindBtn)));
    P.append(step(n++, 'Dip', 'Pick a vat below and hold to dip. Indigo is the classic; several short dips build a deeper blue.'));
    const open = action('Unbind and open', unbindWithReveal, 'btn primary');
    panelRefs.openBtn = open;
    P.append(step(n++, 'Open it up', null, open));
  } else if (t === 'tiedye') {
    const items = R.TIES.map((s) => ({ ...s, canvas: thumb('tie-' + s.id, [{ t: 'bind', kind: 'tie-' + s.id, opts: { n: 4 }, seed: 2 }, ...[0, 1, 2, 3].map((k) => ({ t: 'squirt', k, dye: ['madder', 'weld', 'woad', 'cochineal'][k], s: 1, seed: k }))]) }));
    const tieBtn = action('Tie it', tieUp, 'btn primary');
    panelRefs.bindBtn = tieBtn;
    P.append(step(n++, 'Fold and tie', R.TIES.find((s) => s.id === S.tie).note, picks(items, S.tie, (v) => { S.tie = v; renderPanel(); }, 'Fold'),
      el('div', { class: 'row', style: 'margin-top:8px' }, seg([['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']], String(S.tieN), (v) => { S.tieN = +v; }, 'Sections'), el('span', { class: 'fine' }, 'sections'), tieBtn)));
    P.append(step(n++, 'Squirt the dye', 'Pick a color below, then tap a section of the bundle. Neighbouring colors bleed together.'));
    const open = action('Rinse and open', unbindWithReveal, 'btn primary');
    panelRefs.openBtn = open;
    P.append(step(n++, 'Rinse and open', null, open));
  } else if (t === 'ice') {
    const pile = action('Scrunch it and pile on ice', iceUp, 'btn primary');
    panelRefs.bindBtn = pile;
    P.append(step(n++, 'Scrunch and ice', 'The cloth goes on a rack in loose folds, ice on top.', pile));
    P.append(step(n++, 'Sprinkle dye powder', 'Pick a color below and tap the ice. Each powder splits into the colors it is made of as the ice melts.'));
    const m = action('Let it melt', melt, 'btn primary');
    panelRefs.openBtn = m;
    P.append(step(n++, 'Let it melt, then rinse', null, m));
  } else if (t === 'marbling') {
    const tools = seg([['drop', 'Drop'], ['stylus', 'Stylus'], ['comb', 'Comb']], S.mtool, (v) => { S.mtool = v; openBath(); }, 'Marbling tool');
    const pats = el('div', { class: 'row' }, ...M.STARTERS.map((st) => action(st.name, async () => { openBath(); bathSnapshot(); M.runStarter(S.bath, st.id, mulberry32(nextSeed()), 24); refresh(); }, 'btn small')));
    P.append(step(n++, 'Float the colors', 'Hold to drop ink (longer = bigger), then pull a stylus or comb through.', el('div', { class: 'row' }, tools), el('div', { class: 'row' }, el('span', { class: 'fine' }, 'Or start from'), pats),
      el('div', { class: 'row' }, action('Skim the bath clean', () => { bathSnapshot(); S.bath = M.createBath(); refresh(); }, 'btn small'))));
    P.append(step(n++, 'Lay the cloth', 'One smooth roll, then lift. Each lay takes the whole bath.', action('Lay the cloth', layCloth, 'btn primary')));
  } else if (t === 'block') {
    const items = R.BLOCKS.map((b) => ({ ...b, canvas: thumb('blk-' + b.id, [{ t: 'stamp', block: b.id, x: 0.5, y: 0.5, size: 0.86, dye: 'madder', seed: 2 }]) }));
    P.append(step(n++, 'Choose a carved block', null, picks(items, S.block, (v) => { S.block = v; }, 'Block')));
        P.append(step(n++, 'Ink it and stamp', 'Pick an ink below, then tap the cloth to stamp. The guide snaps each print into a repeat.',
      el('div', { class: 'row' }, seg([['free', 'Free'], ['grid', 'Grid'], ['halfdrop', 'Half-drop']], S.helper, (v) => { S.helper = v; requestDraw(); }, 'Guide')),
      el('div', { class: 'row' }, seg([['small', 'Small block'], ['large', 'Large block']], S.blockSize, (v) => { S.blockSize = v; requestDraw(); }, 'Block size'),
        action('Turn', () => { S.blockRot = (S.blockRot + 1) % 4; say(`Block turned ${S.blockRot * 90}°`, 1200); }, 'btn small')),
      el('div', { class: 'row' }, action('Stamp all over', stampAllOver))));
  }
  renderDock();
  updatePanelState();
}

function updatePanelState() {
  const p = S.piece;
  if (!p) return;
  const bound = !!p.bind;
  if (panelRefs.bindBtn) panelRefs.bindBtn.setAttribute('aria-disabled', String(bound));
  if (panelRefs.openBtn) panelRefs.openBtn.setAttribute('aria-disabled', String(!bound));
  const key = S.tech + '|' + bound + '|' + S.bathOpen;
  if (key !== updatePanelState.key) { updatePanelState.key = key; renderDock(); }
}

function renderTechs() {
  const row = $('#techs');
  row.textContent = '';
  const thumbs = {
    solid: [{ t: 'dip', dye: 'madder', s: 1, mottle: 0.7, seed: 1 }],
    ombre: [{ t: 'dip', dye: 'woad', s: 0.5, depth: 0.85, seed: 1 }, { t: 'dip', dye: 'woad', s: 0.7, depth: 0.5, seed: 2 }],
    batik: [{ t: 'tjap', block: 'kawung', x: 0.5, y: 0.5, size: 0.8, seed: 1 }, { t: 'dip', dye: 'ochre', s: 0.6, seed: 1 }, { t: 'crackle', seed: 2 }, { t: 'dip', dye: 'walnut', s: 1, seed: 2 }, { t: 'boil' }],
    shibori: [{ t: 'bind', kind: 'kumo', opts: { count: 'one' }, seed: 2 }, { t: 'dip', dye: 'indigo', s: 1, seed: 1 }],
    tiedye: [{ t: 'bind', kind: 'tie-spiral', opts: { n: 4 }, seed: 2 }, ...[0, 1, 2, 3].map((k) => ({ t: 'squirt', k, dye: ['madder', 'weld', 'woad', 'cochineal'][k], s: 1, seed: k }))],
    ice: [{ t: 'bind', kind: 'ice', seed: 2 }, { t: 'ice', x: 0.35, y: 0.4, dye: 'logwood', seed: 1 }, { t: 'ice', x: 0.7, y: 0.65, dye: 'cochineal', seed: 2 }],
    marbling: [],
    block: [{ t: 'stamp', block: 'leaf', x: 0.5, y: 0.5, size: 0.85, dye: 'madder', seed: 2 }],
  };
  const sur = el('button', { class: 'chip', id: 'surpriseChip', onclick: () => surprise() },
    el('span', { html: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="12" fill="#F3E3B8"/><path d="M12 5l1.6 4.4L18 11l-4.4 1.6L12 17l-1.6-4.4L6 11l4.4-1.6z" fill="#8C6512"/></svg>', style: 'display:inline-flex' }), 'Surprise me');
  row.append(sur);
  for (const t of TECHS) {
    let c;
    if (t.id === 'marbling') { c = el('canvas', { width: 64, height: 64 }); paintMarbleThumb(c); } else c = thumb('tech-' + t.id, thumbs[t.id], 'quilting-cotton', 32);
    row.append(el('button', { class: 'chip', 'aria-pressed': String(t.id === S.tech), 'data-id': t.id, onclick: () => setTech(t.id) }, c, t.name));
  }
}
function paintMarbleThumb(c) {
  const b = M.createBath();
  M.runStarter(b, 'gelgit', mulberry32(3), 40);
  const x = c.getContext('2d');
  x.fillStyle = M.BATH_COLOR; x.fillRect(0, 0, 64, 64);
  const k = 64 / M.BATH_SIZE;
  for (const ink of b.inks) { bathPath(x, ink.pts, k); x.fillStyle = ink.color; x.fill(); }
}

async function setTech(id) {
  if (S.busy) return;
  if (S.piece.bind) {
    const k = S.piece.bindKind;
    const keepBound = (id === 'shibori' && R.SHIBORI.some((s) => s.id === k)) || (id === 'tiedye' && k.startsWith('tie-')) || (id === 'ice' && k === 'ice');
    if (!keepBound) { if (k === 'ice') await melt(); else await unbindWithReveal(); }
  }
  S.tech = id; store.set('tech', id);
  for (const b of document.querySelectorAll('#techs .chip[data-id]')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  if (id === 'marbling') S.bathOpen = true;
  updatePanelState.key = null;
  renderPanel();
  refresh();
  const hints = {
    solid: 'Pick a pot, then hold to dip', ombre: 'Drag on the cloth to set the dye line', batik: 'Drag on the cloth to draw with hot wax',
    shibori: 'Choose a binding, then bind the cloth', tiedye: 'Choose a fold, then tie it', ice: 'Scrunch the cloth and pile on ice',
    marbling: 'Tap and hold the bath to float a drop of ink', block: 'Tap the cloth to stamp',
  };
  say(hints[id]);
}
function openBath() { if (!S.bathOpen) { S.bathOpen = true; refresh(); } }

// ---- step actions
async function bindShibori() {
  if (S.piece.bind) { say('Open this one up first'); return; }
  const k = S.shib.kind;
  const opts = k === 'itajime' ? { fold: S.shib.fold, clamp: S.shib.clamp, folds: 4 } : k === 'kumo' ? { count: S.shib.count } : k === 'mokume' ? { rows: S.shib.rows } : {};
  S.busy = true;
  say({ itajime: 'Folding it up and clamping the boards…', arashi: 'Wrapping it round the pole…', kumo: 'Pinching up points and binding them…', mokume: 'Stitching rows and pulling them tight…' }[k], 1800);
  await anim(500, (t) => { S.overlay = (ctx) => { ctx.fillStyle = `rgba(233,224,205,${t})`; ctx.fillRect(0, 0, W, W); }; draw(); });
  pushOp({ t: 'bind', kind: k, opts, seed: nextSeed() });
  await anim(400, (t) => { S.overlay = (ctx) => { ctx.fillStyle = `rgba(233,224,205,${1 - t})`; ctx.fillRect(0, 0, W, W); }; draw(); });
  S.overlay = null; S.busy = false;
  refresh();
}
async function tieUp() {
  if (S.piece.bind) { say('Rinse and open this one first'); return; }
  S.busy = true;
  say({ spiral: 'Pinch, twist, twist, twist… and band it', bullseye: 'Pull up the middle and band it into rings', crumple: 'Scrunch it into a lump and band it' }[S.tie], 1800);
  await anim(450, (t) => { S.overlay = (ctx) => { ctx.fillStyle = `rgba(233,224,205,${t})`; ctx.fillRect(0, 0, W, W); }; draw(); });
  pushOp({ t: 'bind', kind: 'tie-' + S.tie, opts: { n: S.tieN }, seed: nextSeed() });
  await anim(350, (t) => { S.overlay = (ctx) => { ctx.fillStyle = `rgba(233,224,205,${1 - t})`; ctx.fillRect(0, 0, W, W); }; draw(); });
  S.overlay = null; S.busy = false;
  refresh();
  say('Now tap a section to squirt dye on it', 2400);
}
async function iceUp() {
  if (S.piece.bind) return;
  pushOp({ t: 'bind', kind: 'ice', seed: nextSeed() });
  refresh();
  say('Now pick a color and tap the ice', 2400);
}
async function crumpleFx() {
  if (!S.piece.meta.waxed || !S.piece.wax.some((v) => v > 0.3)) { say('Crackle needs wax on the cloth first'); return; }
  S.busy = true;
  say('Crumple, crumple… the cold wax cracks', 1800);
  await anim(700, (t) => {
    S.overlay = (ctx) => {
      const k = Math.sin(t * Math.PI);
      ctx.save(); ctx.globalAlpha = 0.25 * k;
      ctx.fillStyle = '#000';
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(W * ((i * 0.37) % 1), W * ((i * 0.61) % 1), W * 0.25 * k, W * 0.04, i, 0, TAU); ctx.fill(); }
      ctx.restore();
    };
    draw();
  });
  S.overlay = null;
  pushOp({ t: 'crackle', seed: nextSeed() });
  renderComp();
  S.busy = false;
  refresh();
  say('Cracked. Dye it now and the color runs into the veins', 2600);
}
async function boilFx() {
  if (!S.piece.meta.waxed || !S.piece.wax.some((v) => v > 0.02)) { say('No wax on the cloth right now'); return; }
  S.busy = true;
  say('Into the boiling water… the wax floats away', 2000);
  const before = document.createElement('canvas'); before.width = before.height = N;
  before.getContext('2d').drawImage(comp, 0, 0);
  pushOp({ t: 'boil' });
  renderComp();
  await anim(1300, (t) => {
    S.overlay = (ctx) => {
      ctx.save(); ctx.globalAlpha = 1 - ease(t); ctx.drawImage(before, 0, 0, W, W); ctx.restore();
      // bubbles
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 24; i++) { const x = ((i * 0.618) % 1) * W, y = W * (1 - ((t * 1.4 + i * 0.13) % 1)); ctx.beginPath(); ctx.arc(x, y, (2 + (i % 4)) * dpr, 0, TAU); ctx.fill(); }
    };
    draw();
  });
  S.overlay = null; S.busy = false;
  refresh();
  say('There it is!', 1600);
}

// ------------------------------------------------------------------ undo / reset / keep
$('#undoBtn').addEventListener('click', () => {
  if (S.busy) return;
  if (viewMode() === 'bath' && S.bathUndo.length) { M.restore(S.bath, S.bathUndo.pop()); refresh(); return; }
  if (!S.ops.length) return;
  S.ops.pop();
  rebuild();
});
$('#resetBtn').addEventListener('click', () => {
  if (S.busy) return;
  S.ops = []; S.seed = 1 + ((S.seed * 7 + 13) % 9973);
  S.bath = M.createBath(); S.bathUndo = []; S.bathOpen = S.tech === 'marbling';
  rebuild();
  say('A fresh piece of cloth', 1400);
});
$('#loupeBtn').addEventListener('click', () => {
  S.loupe = !S.loupe;
  $('#loupeBtn').setAttribute('aria-pressed', String(S.loupe));
  say(S.loupe ? 'Touch the cloth to look at the threads' : '', 2000);
});

function tileCanvas() {
  const t = document.createElement('canvas'); t.width = t.height = 384;
  const x = t.getContext('2d');
  // what goes in the stash is the finished cloth: no wax, untied
  const d = new ImageData(N, N);
  composite(d.data, S.piece, S.wf, { noWax: true });
  const c = document.createElement('canvas'); c.width = c.height = N;
  c.getContext('2d').putImageData(d, 0, 0);
  x.imageSmoothingQuality = 'high';
  x.drawImage(c, 0, 0, 384, 384);
  return t;
}

$('#keepBtn').addEventListener('click', () => keep());
async function keep() {
  if (S.busy) return;
  if (S.piece.bind) { if (S.piece.bindKind === 'ice') await melt(); else await unbindWithReveal(); }
  const tech = TECHS.find((t) => t.id === S.tech);
  const p = S.piece;
  const t0 = performance.now();
  const tile = tileCanvas();
  const data = tile.getContext('2d').getImageData(0, 0, 384, 384).data;
  const color = dominantColor(data);
  const dyes = mainDyes(p);
  const kind = tech.kind;
  const name = makeName({ kind, base: S.base, dyes, shibori: p.meta.shibori, tie: p.meta.tie, block: p.meta.block, crackle: p.meta.crackle }, fabrics().map((f) => f.name));
  const { repeat, inches } = tileInfo(kind);
  const f = addFabric({
    id: newId('dye'), name, base: S.base, kind, color, colors: dyes.length ? dyes.map((id) => dyeOf(id).hex) : [color],
    img: tileDataURL(tile, 0.86), inches, repeat, starter: false, createdAt: Date.now(),
  });
  S.lastKept = f.id;
  window.__lastTileMs = performance.now() - t0;
  flyToStash(f.img);
  renderStashButton();
  toast(`In your stash: ${name}`);
}

function flyToStash(src) {
  const from = stage.getBoundingClientRect(), to = $('#stashBtn').getBoundingClientRect();
  if (reduceMQ.matches) { $('#stashBtn').classList.add('bump'); setTimeout(() => $('#stashBtn').classList.remove('bump'), 600); return; }
  const im = el('img', { class: 'fly', src, alt: '' });
  const size = 120;
  Object.assign(im.style, { left: `${from.left + from.width / 2 - size / 2}px`, top: `${from.top + from.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.append(im);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const dx = to.left + 14 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    im.style.transform = `translate(${dx}px, ${dy}px) scale(.2) rotate(-12deg)`;
    im.style.opacity = '0.4';
  }));
  setTimeout(() => { im.remove(); $('#stashBtn').classList.add('bump'); setTimeout(() => $('#stashBtn').classList.remove('bump'), 600); }, 720);
}

// ------------------------------------------------------------------ stash drawer
function renderStashButton() {
  const fs = fabrics();
  const st = $('#stashStack'); st.textContent = '';
  const mine = fs.filter((f) => !f.starter);
  const show = (mine.length ? mine : fs).slice(-3).reverse();
  for (const f of show) st.append(el('img', { src: f.img, alt: '' }));
  $('#stashBtn').setAttribute('aria-label', `Your stash, ${fs.length} fabrics`);
}
let detailId = null;
function renderSheet() {
  const inner = $('#sheetInner');
  inner.textContent = '';
  const fs = fabrics();
  const mine = fs.filter((f) => !f.starter).reverse();
  const starters = fs.filter((f) => f.starter);
  inner.append(el('div', { class: 'sheetTop' }, el('h3', {}, 'Your stash'), el('button', { class: 'btn small', onclick: closeSheet }, 'Done')));
  inner.append(el('p', { class: 'hint' }, mine.length ? `${mine.length} dyed by you, ${starters.length} from the starter bundle. Tap one to rename it.` : 'Everything you keep from the studio lands here. The starter bundle is here to begin with.'));
  if (detailId) {
    const f = fs.find((x) => x.id === detailId);
    if (f) {
      const input = el('input', { type: 'text', value: f.name, 'aria-label': 'Fabric name', maxlength: 60 });
      const base = BASES.find((b) => b.id === f.base);
      inner.append(el('div', { class: 'detail' }, el('img', { src: f.img, alt: f.name }),
        el('div', { class: 'meta' }, input,
          el('div', { class: 'fine' }, `${base ? base.name : f.base} · ${f.kind} · ${f.inches} in tile${f.repeat ? ', repeats' : ', one-off'}`),
          el('div', { class: 'row' },
            el('button', { class: 'btn small primary', onclick: () => { renameFabric(f.id, input.value.trim() || f.name); detailId = null; renderSheet(); renderStashButton(); } }, 'Save name'),
            el('button', { class: 'btn small', onclick: () => { removeFabric(f.id); detailId = null; renderSheet(); renderStashButton(); toast(`${f.name} put away`); } }, f.starter ? 'Hide' : 'Remove'),
            el('button', { class: 'btn small', onclick: () => { detailId = null; renderSheet(); } }, 'Close')))));
    }
  }
  const grid = (list) => el('div', { class: 'swatches' }, ...list.map((f) => el('button', { class: 'swatch' + (f.id === S.lastKept ? ' new' : ''), onclick: () => { detailId = f.id; renderSheet(); $('#sheet').scrollTop = 0; } },
    el('img', { src: f.img, alt: '', loading: 'lazy' }), el('b', {}, f.name), el('small', {}, (BASES.find((b) => b.id === f.base) || { name: '' }).name))));
  if (mine.length) inner.append(grid(mine));
  inner.append(el('a', { class: 'quiltLink', href: '../quilt/' }, 'Use them in the Quilt Designer →'));
  if (starters.length) { inner.append(el('h2', { class: 'fine', style: 'margin:16px 0 0;text-transform:uppercase;letter-spacing:.08em;font-weight:700' }, 'Starter bundle')); inner.append(grid(starters)); }
}
function openSheet() { detailId = null; renderSheet(); $('#sheet').classList.add('open'); $('#overlay').classList.add('open'); }
function closeSheet() { $('#sheet').classList.remove('open'); $('#overlay').classList.remove('open'); }
$('#stashBtn').addEventListener('click', openSheet);
$('#overlay').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
onStashChange(() => { renderStashButton(); if ($('#sheet').classList.contains('open')) renderSheet(); });

// ------------------------------------------------------------------ surprise me: little demos
const DEMOS = ['batik', 'kumo', 'spiral', 'ice', 'block', 'marble', 'itajime', 'ombre', 'arashi'];
let demoIx = store.get('demo', 0) % DEMOS.length;

function wavy(y, amp, freq, phase = 0, x0 = 0.04, x1 = 0.96) {
  const p = [];
  for (let x = x0; x <= x1; x += 0.006) p.push(x, y + amp * Math.sin(x * freq + phase) + amp * 0.3 * Math.sin(x * freq * 2.3 + phase));
  return p;
}
async function drawWaxAnimated(pts, tool = 'tjanting') {
  const op = { t: 'wax', tool: tool === 'brush' ? 'brush' : 'tjanting', pts: pts.slice(0, 2), r: WAX_R[tool], seed: nextSeed() };
  waxStroke(S.piece, op.pts, op.r, op.seed, op.tool, 0);
  const n = pts.length / 2;
  const per = Math.max(1, Math.round(n / 40));
  for (let i = 1; i < n; i++) {
    op.pts.push(pts[i * 2], pts[i * 2 + 1]);
    waxStroke(S.piece, op.pts, op.r, op.seed, op.tool, i);
    if (i % per === 0 && !S.fast && !reduceMQ.matches) { renderComp(); draw(); await new Promise((r) => requestAnimationFrame(r)); }
  }
  pushOp(op, { applied: true });
  renderComp(); draw();
}

async function surprise() {
  if (S.busy && S.demo) { S.fast = true; return; }
  if (S.busy) return;
  closeSheet();
  const which = DEMOS[demoIx];
  demoIx = (demoIx + 1) % DEMOS.length; store.set('demo', demoIx);
  const chip = $('#surpriseChip');
  chip.lastChild.textContent = 'Skip to the end';
  S.demo = true;
  const startClean = async (tech, base) => {
    S.busy = false;
    await setTech(tech);
    S.base = base; S.ops = []; S.seed = 1 + ((S.seed * 7 + 13) % 9973);
    rebuild(); renderPanel();
    S.busy = true;
    window.scrollTo({ top: 0, behavior: reduceMQ.matches ? 'auto' : 'smooth' });
  };
  try {
    if (which === 'batik') {
      await startClean('batik', 'batik-cotton');
      say('Hot wax keeps the cloth white', 2000);
      for (let i = 0; i < 4; i++) await drawWaxAnimated(wavy(0.12 + i * 0.25, 0.03, 13, i));
      for (const [x, y] of [[0.25, 0.245], [0.75, 0.245], [0.5, 0.5], [0.25, 0.755], [0.75, 0.755]]) { pushOp({ t: 'tjap', block: 'star', x, y, size: 0.2, seed: nextSeed() }); renderComp(); draw(); await wait(120); }
      await demoDip({ dye: 'weld' }, 900);
      say('More wax keeps the yellow', 1600);
      for (const [x, y] of [[0.5, 0.245], [0.25, 0.5], [0.75, 0.5], [0.5, 0.755]]) { pushOp({ t: 'tjap', block: 'kawung', x, y, size: 0.2, seed: nextSeed() }); renderComp(); draw(); await wait(120); }
      await drawWaxAnimated(wavy(0.37, 0.02, 9, 2), 'bold');
      await crumpleFx(); S.busy = true;
      await demoDip({ dye: 'indigo' }, 1000);
      await boilFx();
    } else if (which === 'kumo' || which === 'itajime' || which === 'arashi') {
      await startClean('shibori', which === 'arashi' ? 'linen' : 'quilting-cotton');
      S.shib.kind = which;
      if (which === 'itajime') { S.shib.fold = 'triangle'; S.shib.clamp = 'circle'; }
      renderPanel();
      await bindShibori(); S.busy = true;
      await wait(500);
      await demoDip({ dye: 'indigo' }, 900);
      await wait(250);
      await demoDip({ dye: 'indigo' }, 900);
      await wait(300);
      await unbindWithReveal();
    } else if (which === 'spiral') {
      await startClean('tiedye', 'quilting-cotton');
      S.tie = 'spiral'; S.tieN = 6; renderPanel();
      await tieUp(); S.busy = true;
      const cols = ['madder', 'ochre', 'weld', 'sage', 'woad', 'logwood'];
      for (let k = 0; k < 6; k++) {
        pickDye(cols[k]);
        pushOp({ t: 'squirt', k, dye: cols[k], s: 1.05, seed: nextSeed() });
        const a = (k + 0.5) / 6 * TAU;
        squirtFx(0.5 + Math.cos(a) * 0.25, 0.5 + Math.sin(a) * 0.25);
        refresh(); await wait(300);
      }
      renderComp();
      await wait(400);
      await unbindWithReveal();
    } else if (which === 'ice') {
      await startClean('ice', 'quilting-cotton');
      await iceUp();
      const spots = [[0.25, 0.25, 'logwood'], [0.72, 0.22, 'charcoal'], [0.5, 0.52, 'cochineal'], [0.2, 0.75, 'woad'], [0.78, 0.72, 'ochre'], [0.5, 0.88, 'indigo'], [0.88, 0.45, 'madder'], [0.12, 0.48, 'sage']];
      for (const [x, y, d] of spots) { pickDye(d); pushOp({ t: 'ice', x, y, dye: d, s: 1.1, seed: nextSeed() }); refresh(); await wait(220); }
      renderComp();
      await wait(300);
      await melt();
    } else if (which === 'block') {
      await startClean('block', 'linen');
      S.block = 'ginkgo'; S.helper = 'halfdrop'; S.blockSize = 'small'; pickDye('indigo'); renderPanel();
      await stampAllOver(); S.busy = true;
      S.block = 'rosette'; pickDye('madder'); S.helper = 'grid'; S.blockSize = 'large';
      for (const [x, y] of [[1 / 6, 1 / 6], [0.5, 0.5], [5 / 6, 5 / 6]]) { await stampAt(x, y); await wait(120); }
    } else if (which === 'marble') {
      await startClean('marbling', 'quilting-cotton');
      S.bathOpen = true; refresh();
      const ops = M.starterOps('nonpareil', mulberry32(nextSeed()));
      for (const op of ops) { M.applyOp(S.bath, op, 24); draw(); if (!S.fast && !reduceMQ.matches) await new Promise((r) => requestAnimationFrame(r)); }
      await wait(300);
      await layCloth();
    } else if (which === 'ombre') {
      await startClean('ombre', 'voile');
      pickDye('cochineal');
      for (const [d, ms] of [[0.9, 500], [0.65, 700], [0.42, 900], [0.2, 1300]]) { S.depth = d; draw(); await wait(250); await demoDip({ dye: 'cochineal', depth: d }, ms); }
    }
  } finally {
    S.demo = false; S.fast = false; S.busy = false;
    chip.lastChild.textContent = 'Surprise me';
    renderPanel(); refresh();
  }
  say('Like it? Tap Keep it to add it to your stash', 3200);
}

// ------------------------------------------------------------------ start
ensureStarters();
renderPots();
renderStashButton();
renderTechs();
rebuild();
renderPanel();
resize();
say({ batik: 'Drag on the cloth to draw with hot wax' }[S.tech] || 'Tap Surprise me to watch a piece get made', 3600);

// for tests and the curious
window.__dye = { S, rebuild, renderComp, keep, surprise, setTech, startDip, endDip, pushOp, refresh, renderPanel, draw, unbindWithReveal, melt, layCloth, stampAllOver, tjapAllOver, boilFx, crumpleFx, bindShibori, tieUp, iceUp, drawWaxAnimated, openSheet, M };
