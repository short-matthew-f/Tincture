// Marbling and origami prototype: UI, canvas rendering, interaction, animation.
// The ink maths lives in marble.js and the flat-folding geometry in fold.js (both pure).
import {
  INKS, BATH_COLOR, LIMITS, createBath, snapshot, restore, beginDrop, growDrop, maintain, stylusStep, combStep, swirlStep,
  resample, starterOps, applyOp, STARTERS, mulberry32, runStarter, countVerts, pathNormal, combOffsets, dropInk,
} from './marble.js';
import {
  MODELS, getModel, buildStates, finalState, modelBounds, stackBounds, planFold, creaseSegments, reflectPoint, applyM, mul,
} from './fold.js';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'tincture.proto.marbling';
const MAX_SHEETS = 8;
const MAX_SHELF = 12;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const dprOf = () => Math.min(2, window.devicePixelRatio || 1);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const say = (msg) => { $('#live').textContent = msg; };

// ------------------------------------------------------------------ storage (everything wrapped: private windows throw)
const store = { sheets: [], shelf: [], seq: 1 };
const sheetImgs = new Map(); // id -> drawable (canvas or loaded Image)

function loadStore() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (o && typeof o === 'object') {
      if (Array.isArray(o.sheets)) store.sheets = o.sheets.filter((s) => s && s.id && s.data).slice(0, MAX_SHEETS);
      if (Array.isArray(o.shelf)) store.shelf = o.shelf.filter((s) => s && s.id && s.thumb && getModel(s.model)).slice(0, MAX_SHELF);
      store.seq = Number(o.seq) || store.sheets.length + store.shelf.length + 1;
    }
  } catch { /* fresh start */ }
}
function saveStore() {
  const write = () => localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, seq: store.seq, sheets: store.sheets, shelf: store.shelf }));
  for (let i = 0; i < 8; i++) {
    try { write(); return true; } catch {
      if (store.sheets.length > 1) store.sheets.pop(); // quota: let the oldest sheet go
      else if (store.shelf.length > 1) store.shelf.pop();
      else break;
    }
  }
  return false;
}
loadStore();

function loadSheetImages() {
  for (const s of store.sheets) {
    if (sheetImgs.has(s.id)) continue;
    const img = new Image();
    img.onload = () => { sheetImgs.set(s.id, img); refreshImages(); };
    img.src = s.data;
  }
}

// ------------------------------------------------------------------ paper grain (deterministic)
let grainPattern = null;
function makeGrain(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const id = g.createImageData(128, 128);
  let seed = 12345;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < id.data.length; i += 4) {
    const v = r();
    const dark = v < 0.5;
    id.data[i] = dark ? 90 : 255;
    id.data[i + 1] = dark ? 70 : 250;
    id.data[i + 2] = dark ? 40 : 240;
    id.data[i + 3] = Math.floor(r() * (dark ? 22 : 30));
  }
  g.putImageData(id, 0, 0);
  // a few long fibres
  g.strokeStyle = 'rgba(120,95,60,.07)';
  g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x = r() * 128, y = r() * 128, a = r() * 6.28, l = 6 + r() * 14;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  grainPattern = ctx.createPattern(c, 'repeat');
}

// ================================================================== MARBLING
const bathCanvas = $('#bath');
const bctx = bathCanvas.getContext('2d');
let bath = createBath();
let inkColor = INKS[2].hex;
let tool = 'drop';
let tines = 7;
const COMB_SPACING = { 5: 120, 7: 100, 9: 84 };
let undoStack = [];
let busy = false; // starter or paper animation playing
let runner = null; // scripted starter
let blooms = []; // drops still opening
let dirty = true;
let pointer = null;
let swirlDir = 1;
const queue = [];
let lastFrame = 0;

let renderScale = 1;
function resizeBath() {
  const r = bathCanvas.getBoundingClientRect();
  if (!r.width) return;
  const px = Math.max(100, Math.round(r.width * dprOf() * renderScale));
  if (bathCanvas.width !== px) { bathCanvas.width = px; bathCanvas.height = px; }
  dirty = true;
}
new ResizeObserver(resizeBath).observe(bathCanvas);

function polyPath(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}

// A slightly deeper shade of each ink for its edge (inks darken a little where they meet the size).
const edgeCache = new Map();
function edgeColor(hex) {
  let e = edgeCache.get(hex);
  if (!e) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c, to) => Math.round(c * 0.72 + to * 0.28);
    e = `rgba(${mix((n >> 16) & 255, 30)},${mix((n >> 8) & 255, 20)},${mix(n & 255, 12)},.7)`;
    edgeCache.set(hex, e);
  }
  return e;
}

// Paint the bath into any square canvas context (the live tray and the sheet capture share this).
function paintBath(ctx, b, px) {
  const k = px / b.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BATH_COLOR;
  ctx.fillRect(0, 0, px, px);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, px / 520) / k;
  for (const ink of b.inks) {
    polyPath(ctx, ink.pts);
    ctx.fillStyle = ink.color;
    ctx.fill();
    ctx.strokeStyle = edgeColor(ink.color);
    ctx.stroke();
  }
}

function dropRadius(ms) { return 54 + 150 * (1 - Math.exp(-ms / 750)); }

function paintOverlay(now) {
  const k = bathCanvas.width / bath.size;
  bctx.setTransform(k, 0, 0, k, 0, 0);
  const px = 1 / k;
  const p = pointer;
  if (!p || busy) return;
  bctx.lineWidth = 2 * dprOf() * px;
  if (p.mode === 'drop') {
    const r = reduce.matches ? 70 : dropRadius(now - p.t0);
    bctx.globalAlpha = 0.32;
    bctx.fillStyle = inkColor;
    bctx.beginPath(); bctx.arc(p.x, p.y, r, 0, 6.2832); bctx.fill();
    bctx.globalAlpha = 0.9;
    bctx.strokeStyle = '#2A2622';
    bctx.setLineDash([6 * dprOf() * px, 5 * dprOf() * px]);
    bctx.beginPath(); bctx.arc(p.x, p.y, r, 0, 6.2832); bctx.stroke();
    bctx.setLineDash([]);
    bctx.globalAlpha = 1;
  } else if (p.mode === 'stylus') {
    bctx.strokeStyle = 'rgba(42,38,34,.7)';
    bctx.beginPath(); bctx.arc(p.x, p.y, 9, 0, 6.2832); bctx.stroke();
  } else if (p.mode === 'comb') {
    const n = p.nrm || [0, 1];
    bctx.strokeStyle = 'rgba(42,38,34,.6)';
    for (const o of combOffsets(tines, COMB_SPACING[tines])) {
      bctx.beginPath(); bctx.arc(p.x + n[0] * o, p.y + n[1] * o, 6, 0, 6.2832); bctx.stroke();
    }
  } else if (p.mode === 'swirl') {
    bctx.strokeStyle = 'rgba(42,38,34,.55)';
    bctx.setLineDash([4 * dprOf() * px, 6 * dprOf() * px]);
    bctx.beginPath(); bctx.arc(p.x, p.y, 90, 0, 6.2832); bctx.stroke();
    bctx.setLineDash([]);
  }
}

function toBath(e) {
  const r = bathCanvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * bath.size, ((e.clientY - r.top) / r.height) * bath.size];
}

function pushUndo() {
  undoStack.push(snapshot(bath));
  if (undoStack.length > LIMITS.maxUndo) undoStack.shift();
  syncButtons();
}
function syncButtons() {
  $('#undo').setAttribute('aria-disabled', undoStack.length ? 'false' : 'true');
}

function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* optional */ } }

bathCanvas.addEventListener('pointerdown', (e) => {
  if (busy) { if (runner) runner.fast = true; return; }
  if (pointer) return;
  e.preventDefault();
  try { bathCanvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
  const [x, y] = toBath(e);
  pushUndo();
  pointer = { id: e.pointerId, mode: tool, x, y, lx: x, ly: y, t0: performance.now(), travelled: 0, nrm: null, start: [x, y] };
  if (tool === 'swirl') { swirlDir = -swirlDir; pointer.dir = swirlDir; }
  dirty = true;
});
bathCanvas.addEventListener('pointermove', (e) => {
  if (!pointer || e.pointerId !== pointer.id) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    const [x, y] = toBath(ev);
    pointer.x = x; pointer.y = y;
    if (pointer.mode === 'stylus' || pointer.mode === 'comb') queue.push([x, y]);
  }
  dirty = true;
});
function endPointer(e, cancel) {
  if (!pointer || e.pointerId !== pointer.id) return;
  const p = pointer;
  pointer = null;
  flushQueue(p);
  if (p.mode === 'drop') {
    if (cancel) { undoStack.pop(); syncButtons(); } else {
      const r = dropRadius(performance.now() - p.t0);
      const h = beginDrop(bath, p.x, p.y, inkColor);
      blooms.push({ h, target: r, t0: performance.now(), dur: reduce.matches ? 1 : 190 });
      vibrate(8);
    }
  } else if (p.mode === 'stylus' || p.mode === 'comb') {
    maintain(bath);
  }
  dirty = true;
}
bathCanvas.addEventListener('pointerup', (e) => endPointer(e, false));
bathCanvas.addEventListener('pointercancel', (e) => endPointer(e, true));
bathCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Pull the queued stylus/comb points into the bath (one frame's worth at a time).
function flushQueue(p) {
  if (!p || !queue.length) { queue.length = 0; return; }
  for (const [x, y] of queue) {
    if (p.mode === 'stylus') {
      if (Math.hypot(x - p.lx, y - p.ly) < 1.5) continue;
      stylusStep(bath, [p.lx, p.ly], [x, y], LIMITS.stylusC);
      p.lx = x; p.ly = y;
    } else if (p.mode === 'comb') {
      if (!p.nrm) {
        if (Math.hypot(x - p.start[0], y - p.start[1]) < 16) continue;
        p.nrm = pathNormal([p.start, [x, y]]);
        p.lx = p.start[0]; p.ly = p.start[1];
      }
      if (Math.hypot(x - p.lx, y - p.ly) < 1.5) continue;
      combStep(bath, [p.lx, p.ly], [x, y], p.nrm, tines, COMB_SPACING[tines], LIMITS.combC);
      p.lx = x; p.ly = y;
    }
  }
  queue.length = 0;
  dirty = true;
}

// ------------------------------------------------------------------ the frame loop
function stepBlooms(now) {
  if (!blooms.length) return;
  for (const b of blooms) {
    const t = clamp((now - b.t0) / b.dur, 0, 1);
    growDrop(bath, b.h, Math.max(b.h.r, b.target * easeOut(t)));
  }
  const before = blooms.length;
  blooms = blooms.filter((b) => now - b.t0 < b.dur);
  if (blooms.length !== before) { for (const b of blooms) void b; maintain(bath); }
  dirty = true;
}

function stepRunner(now, dt) {
  const r = runner;
  if (!r) return;
  const speed = r.fast ? 40000 : 4000; // bath units per second
  let budget = Math.min(dt, 100) / 1000 * speed;
  const tEnd = performance.now() + 13; // never hog a frame, whatever the phone
  let guard = 0;
  while (guard++ < (r.fast ? 4000 : 200)) {
    if (performance.now() > tEnd) return;
    if (!r.cur) {
      if (r.i >= r.ops.length) { if (!blooms.length) { finishRunner(); } return; }
      const op = r.ops[r.i];
      if (op.t === 'drop') {
        if (!r.fast && now < r.nextAt) return;
        const h = beginDrop(bath, op.x, op.y, op.color);
        blooms.push({ h, target: op.r, t0: now, dur: r.fast || reduce.matches ? 1 : 170 });
        r.nextAt = now + 40;
        r.i++;
        if (r.fast && r.i % 8 === 0) return;
        continue;
      }
      if (!r.fast && now < r.nextAt) return;
      if (blooms.length) { for (const b of blooms) growDrop(bath, b.h, b.target); blooms = []; }
      r.cur = { op, pts: resample(op.pts, 10), idx: 1, nrm: pathNormal(op.pts) };
    }
    const c = r.cur;
    if (budget <= 0) return;
    const a = c.pts[c.idx - 1], b = c.pts[c.idx];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (c.op.tool === 'comb') combStep(bath, a, b, c.nrm, c.op.tines, c.op.spacing, c.op.c);
    else stylusStep(bath, a, b, c.op.c);
    budget -= Math.max(len, 1);
    dirty = true;
    c.idx++;
    if (c.idx >= c.pts.length) { r.cur = null; r.i++; r.nextAt = now + 90; if (!r.fast) return; }
  }
}

function finishRunner() {
  runner = null;
  busy = false;
  maintain(bath);
  note('');
  $('#tip').textContent = 'That is your bath. Lay a sheet on it when you like it, or keep pulling.';
  say('Starter finished.');
  dirty = true;
}

let noteTimer = 0;
function note(msg, ms = 0) {
  const el = $('#trayNote');
  el.textContent = msg;
  el.classList.toggle('on', !!msg);
  clearTimeout(noteTimer);
  if (msg && ms) noteTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function frame(now) {
  const dt = lastFrame ? now - lastFrame : 16;
  lastFrame = now;
  if (pointer && pointer.mode === 'swirl' && !busy) {
    swirlStep(bath, pointer.x, pointer.y, 90, pointer.dir * 0.05 * (Math.min(dt, 34) / 16.7), LIMITS.swirlC);
    dirty = true;
  }
  if (pointer) flushQueue(pointer);
  stepBlooms(now);
  stepRunner(now, dt);
  if (pointer && pointer.mode === 'drop') dirty = true;
  if (!$('#viewMarble').hidden) {
    // a very busy bath is drawn a little softer while it is moving, then sharp again once it rests
    const v = countVerts(bath);
    const moving = busy || pointer || blooms.length;
    const want = moving ? (v > 22000 ? 0.55 : v > 12000 ? 0.75 : 1) : 1;
    if (want !== renderScale) { renderScale = want; resizeBath(); }
  }
  if (dirty && bathCanvas.width > 0 && !$('#viewMarble').hidden) {
    dirty = false;
    paintBath(bctx, bath, bathCanvas.width);
    paintOverlay(now);
  }
  if (foldVisible()) foldFrame(now);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ controls
const palette = $('#palette');
INKS.forEach((ink, i) => {
  const b = document.createElement('button');
  b.setAttribute('aria-label', ink.name);
  b.setAttribute('aria-pressed', i === 2 ? 'true' : 'false');
  b.title = ink.name;
  b.innerHTML = `<i style="background:${ink.hex}"></i>`;
  b.addEventListener('click', () => {
    inkColor = ink.hex;
    palette.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    say(ink.name);
  });
  palette.appendChild(b);
});

const TIPS = {
  drop: 'Tap to drop ink. Press and hold for a bigger drop. Drops can land inside older drops.',
  stylus: 'Drag a fine stylus through the ink. It carries the colour along with it.',
  comb: 'Swipe across the bath. The comb pulls several lines at once.',
  swirl: 'Press and hold to stir a gentle vortex. Slide your finger to move it.',
};
function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'));
  $('#combOpts').classList.toggle('on', t === 'comb');
  $('#tip').textContent = TIPS[t];
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#tineSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tines = Number(b.dataset.n);
  $('#tineSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
});
setTool('drop');

$('#undo').addEventListener('click', () => {
  if (busy || !undoStack.length) return;
  restore(bath, undoStack.pop());
  blooms = [];
  syncButtons();
  dirty = true;
  say('Undone.');
});
$('#clear').addEventListener('click', () => {
  if (busy) return;
  if (bath.inks.length) pushUndo();
  bath = createBath();
  blooms = [];
  dirty = true;
  note('The bath is clear and still.', 1600);
});

const starterBox = $('#starters');
for (const s of STARTERS) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.innerHTML = `<span>${s.name}</span><small>${s.note}</small>`;
  b.addEventListener('click', () => startStarter(s.id));
  starterBox.appendChild(b);
}

function startStarter(id) {
  if (busy) return;
  pushUndo();
  bath = createBath();
  blooms = [];
  const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  runner = { ops: starterOps(id, rng), i: 0, cur: null, nextAt: 0, fast: reduce.matches, id };
  busy = true;
  const meta = STARTERS.find((s) => s.id === id);
  note(`${meta.name}. Tap to skip ahead.`);
  $('#tip').textContent = meta.note;
  dirty = true;
}

// ------------------------------------------------------------------ lay the paper
const fly = $('#fly');
const fctx = fly.getContext('2d');

function newSheetId() { return 's' + store.seq++; }

function captureSheet() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  paintBath(c.getContext('2d'), bath, 512);
  return c;
}

function addSheet(canvas) {
  const id = newSheetId();
  const data = canvas.toDataURL('image/jpeg', 0.74);
  store.sheets.unshift({ id, t: Date.now(), data });
  while (store.sheets.length > MAX_SHEETS) { const gone = store.sheets.pop(); sheetImgs.delete(gone.id); }
  sheetImgs.set(id, canvas);
  saveStore();
  return id;
}

function sizeFly() {
  const d = dprOf();
  fly.width = Math.round(window.innerWidth * d);
  fly.height = Math.round(window.innerHeight * d);
  fly.style.width = window.innerWidth + 'px';
  fly.style.height = window.innerHeight + 'px';
  return d;
}

function drawSheetQuad(ctx, d, cx, cy, w, opt) {
  // opt: {scaleY, rot, face:'back'|'front', img, alpha, ghost, shadow}
  ctx.save();
  ctx.translate(cx * d, cy * d);
  ctx.rotate(opt.rot || 0);
  ctx.scale(1, opt.scaleY);
  const half = (w * d) / 2;
  ctx.shadowColor = `rgba(42,38,34,${0.34 * (opt.shadow ?? 1)})`;
  ctx.shadowBlur = 26 * d * (opt.shadow ?? 1);
  ctx.shadowOffsetY = 14 * d * (opt.shadow ?? 1) * Math.sign(opt.scaleY || 1);
  ctx.globalAlpha = opt.alpha ?? 1;
  ctx.fillStyle = '#EFE6D2';
  ctx.fillRect(-half, -half, half * 2, half * 2);
  ctx.shadowColor = 'transparent';
  if (opt.face === 'front') {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(opt.img, -half, -half, half * 2, half * 2);
  } else {
    if (grainPattern) { ctx.fillStyle = grainPattern; ctx.fillRect(-half, -half, half * 2, half * 2); }
    if (opt.ghost) { ctx.globalAlpha = opt.ghost; ctx.drawImage(opt.img, -half, -half, half * 2, half * 2); }
  }
  ctx.restore();
}

function layPaper() {
  if (busy) return;
  if (!bath.inks.length) { note('Float a little ink first, then lay the paper.', 2200); return; }
  busy = true;
  const sheetCanvas = captureSheet();
  const id = addSheet(sheetCanvas);
  pushUndo(); // so the ink can be brought back with Undo
  renderDrawer(id);
  const d = sizeFly();
  fly.classList.add('on');
  const tr = bathCanvas.getBoundingClientRect();
  const thumb = $('#drawer .thumb');
  const tt = thumb ? thumb.getBoundingClientRect() : null;
  const from = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2, w: tr.width };
  const to = tt ? { x: tt.left + tt.width / 2, y: tt.top + tt.height / 2, w: tt.width } : { x: from.x, y: from.y + tr.height * 0.7, w: 60 };
  const T = reduce.matches
    ? { lower: 0, soak: 0, lift: 350, fly: 450 }
    : { lower: 850, soak: 480, lift: 950, fly: 700 };
  const t0 = performance.now();
  let cleared = false;
  note('');
  say('Laying the paper on the bath.');
  const tick = () => {
    const t = performance.now() - t0;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fly.width, fly.height);
    if (t < T.lower + T.soak + T.lift + T.fly) {
      if (reduce.matches) {
        if (!cleared) { bath = createBath(); cleared = true; dirty = true; }
        const a = clamp(t / 250, 0, 1);
        const fl = clamp((t - T.lift) / T.fly, 0, 1);
        drawSheetQuad(fctx, d, from.x + (to.x - from.x) * ease(fl), from.y + (to.y - from.y) * ease(fl), from.w + (to.w - from.w) * ease(fl), { scaleY: 1, face: 'front', img: sheetCanvas, alpha: a, shadow: 0.7 });
      } else if (t < T.lower) {
        const e = ease(t / T.lower);
        drawSheetQuad(fctx, d, from.x, from.y - (1 - e) * 70, from.w * (1.14 - 0.14 * e), { scaleY: 1, rot: (1 - e) * -0.06, face: 'back', img: sheetCanvas, shadow: 1 - 0.8 * e });
      } else if (t < T.lower + T.soak) {
        const e = (t - T.lower) / T.soak;
        drawSheetQuad(fctx, d, from.x, from.y, from.w, { scaleY: 1, face: 'back', img: sheetCanvas, ghost: 0.55 * easeOut(e), shadow: 0.2 });
      } else if (t < T.lower + T.soak + T.lift) {
        if (!cleared) { bath = createBath(); blooms = []; cleared = true; dirty = true; }
        const e = ease((t - T.lower - T.soak) / T.lift);
        const phi = Math.PI * clamp((e - 0.1) / 0.85, 0, 1);
        const face = phi < Math.PI / 2 ? 'back' : 'front';
        drawSheetQuad(fctx, d, from.x, from.y - e * 54, from.w * (1 + 0.05 * e), {
          scaleY: Math.max(0.02, Math.abs(Math.cos(phi))), rot: Math.sin(phi) * 0.03, face, img: sheetCanvas, ghost: face === 'back' ? 0.55 * (1 - phi / 1.6) : 0, shadow: 0.2 + 0.7 * e,
        });
      } else {
        const e = ease((t - T.lower - T.soak - T.lift) / T.fly);
        drawSheetQuad(fctx, d, from.x + (to.x - from.x) * e, from.y - 54 + (to.y - from.y + 54) * e, from.w * 1.05 + (to.w - from.w * 1.05) * e, { scaleY: 1, face: 'front', img: sheetCanvas, shadow: 0.9 - 0.7 * e });
      }
      requestAnimationFrame(tick);
      return;
    }
    fly.classList.remove('on');
    busy = false;
    const el = $(`#drawer .thumb[data-id="${id}"]`);
    if (el) { el.classList.remove('arriving'); el.classList.add('landed'); }
    note('Your paper is resting in the drawer.', 2600);
    $('#tip').textContent = 'The bath is still. Float more ink, or tap the sheet in the drawer to fold it.';
    say('Paper added to the drawer.');
  };
  requestAnimationFrame(tick);
}
$('#lay').addEventListener('click', layPaper);

// ------------------------------------------------------------------ drawer
function tiltOf(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ((h % 5) - 2) * 0.9; }

function thumbButton(s, opts = {}) {
  const b = document.createElement('button');
  b.className = 'thumb' + (opts.arriving ? ' arriving' : '');
  b.dataset.id = s.id;
  b.style.setProperty('--tilt', tiltOf(s.id) + 'deg');
  b.setAttribute('aria-label', 'Marbled sheet ' + s.id.slice(1));
  const img = document.createElement('img');
  img.src = s.data;
  img.alt = '';
  b.appendChild(img);
  return b;
}

function renderDrawer(arrivingId) {
  const box = $('#drawer');
  box.innerHTML = '';
  for (const s of store.sheets) {
    const b = thumbButton(s, { arriving: s.id === arrivingId });
    b.addEventListener('click', () => openFold(s.id));
    box.appendChild(b);
  }
}

// ================================================================== FOLDING
let selSheet = null;
let fold = null;

function foldVisible() { return !$('#viewFold').hidden && fold && !$('#foldStage').hidden; }

function sheetImg(id) { return sheetImgs.get(id) || null; }

// ---- tabs
function showTab(which) {
  const marble = which === 'marble';
  $('#viewMarble').hidden = !marble;
  $('#viewFold').hidden = marble;
  $('#tabMarble').setAttribute('aria-pressed', marble ? 'true' : 'false');
  $('#tabFold').setAttribute('aria-pressed', marble ? 'false' : 'true');
  if (marble) { resizeBath(); dirty = true; } else { renderPicker(); resizeStage(); }
}
$('#tabMarble').addEventListener('click', () => showTab('marble'));
$('#tabFold').addEventListener('click', () => showTab('fold'));

function openFold(sheetId) {
  selSheet = sheetId;
  showTab('fold');
  if (fold) leaveStage();
  renderPicker();
  window.scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' });
}

// ---- drawing the paper
function camFor(bounds, W, H, pad = 1.2) {
  const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
  return { s: Math.min(W / (bw * pad), H / (bh * pad)), cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2, W, H };
}
function camMatrix(cam, d) {
  return [cam.s * d, 0, 0, cam.s * d, (cam.W / 2 - cam.cx * cam.s) * d, (cam.H / 2 - cam.cy * cam.s) * d];
}

const PAPER_BACK = '#EFE6D2';

// G maps world -> device pixels. extra: { shade, shadow:{blur,dy,alpha}, face }
function drawLayer(ctx, G, layer, img, extra = {}) {
  const poly = layer.poly;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const [x, y] = applyM(G, poly[i][0], poly[i][1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  const face = extra.face ?? layer.face;
  if (extra.shadow) {
    ctx.save();
    ctx.shadowColor = `rgba(42,30,18,${extra.shadow.alpha})`;
    ctx.shadowBlur = extra.shadow.blur;
    ctx.shadowOffsetY = extra.shadow.dy;
    ctx.fillStyle = PAPER_BACK;
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.clip();
  if (face > 0 && img) {
    const M = mul(G, mul(layer.m, [1 / img.width, 0, 0, 1 / img.height, 0, 0]));
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.fillStyle = face > 0 ? '#D9CDB4' : PAPER_BACK;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (grainPattern) {
    ctx.fillStyle = grainPattern;
    ctx.globalAlpha = face > 0 ? 0.5 : 1;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
  }
  if (extra.shade) {
    ctx.fillStyle = `rgba(36,24,12,${extra.shade})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, ctx.canvas.width / 420);
  ctx.strokeStyle = 'rgba(60,40,20,.34)';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawStackTo(ctx, G, stack, img, opts = {}) {
  for (let i = 0; i < stack.length; i++) {
    drawLayer(ctx, G, stack[i], img, { shadow: opts.shadow === false ? null : { blur: (opts.blur ?? 5) * (opts.d || 1), dy: (opts.dy ?? 2) * (opts.d || 1), alpha: opts.alpha ?? 0.22 } });
  }
}

// affine of the swinging flap at progress t (0..1) about the crease line
function flapMatrix(line, t, mountain) {
  const th = Math.PI * t, c = Math.cos(th), sn = Math.sin(th);
  const [ux, uy] = line.u, [nx, ny] = line.n;
  const k = (mountain ? -1 : 1) * 0.16 * sn;
  // A = u u^T + k u n^T + c n n^T  (x' = A (x - p) + p + lift)
  const a00 = ux * ux + k * ux * nx + c * nx * nx;
  const a01 = ux * uy + k * ux * ny + c * nx * ny;
  const a10 = uy * ux + k * uy * nx + c * ny * nx;
  const a11 = uy * uy + k * uy * ny + c * ny * ny;
  const px = line.p[0], py = line.p[1];
  const lift = (mountain ? 0.04 : -0.14) * sn;
  return { M: [a00, a10, a01, a11, px - (a00 * px + a01 * py), py - (a10 * px + a11 * py) + lift], c, sn };
}

function drawFoldFrame(ctx, cam, d, plan, t, img) {
  const base = camMatrix(cam, d);
  const mountain = plan.dir === 'mountain';
  const { M, c, sn } = flapMatrix(plan.line, t, mountain);
  const G = mul(base, M);
  const flap = c >= 0 ? plan.moving : plan.moving.slice().reverse();
  const shadowStay = { blur: 5 * d, dy: 2 * d, alpha: 0.22 };
  const drawStay = () => { for (const l of plan.stay) drawLayer(ctx, base, l, img, { shadow: shadowStay }); };
  const drawFlap = () => {
    for (const l of flap) {
      drawLayer(ctx, G, l, img, {
        face: c >= 0 ? l.face : -l.face,
        shade: (mountain ? 0.3 : 0.22) * sn,
        shadow: { blur: (5 + 16 * sn) * d, dy: (2 + 12 * sn) * d, alpha: 0.22 + 0.12 * sn },
      });
    }
  };
  if (mountain) { drawFlap(); drawStay(); } else { drawStay(); drawFlap(); }
}

// ---- dashed crease + arrow
function drawHints(ctx, cam, d, stack, step, now, line) {
  const base = camMatrix(cam, d);
  const segs = creaseSegments(stack, line);
  const P = (pt) => applyM(base, pt[0], pt[1]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round';
  const dash = step.dir === 'mountain' ? [10 * d, 4 * d, 2 * d, 4 * d] : [9 * d, 6 * d];
  const off = reduce.matches ? 0 : -(now / 40) * d;
  for (const [a, b] of segs) {
    const [x0, y0] = P(a), [x1, y1] = P(b);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(251,248,241,.92)';
    ctx.lineWidth = 5 * d;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash(dash);
    ctx.lineDashOffset = off;
    ctx.strokeStyle = '#2A2622';
    ctx.lineWidth = 2.2 * d;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.setLineDash([]);
  // arrow from the moving point to where it will land
  const from = step.move;
  const to = reflectPoint(from, line);
  const [fx, fy] = P(from), [tx, ty] = P(to);
  const mx = (fx + tx) / 2, my = (fy + ty) / 2;
  const len = Math.hypot(tx - fx, ty - fy);
  if (len > 6 * d) {
    let px = -(ty - fy) / len, py = (tx - fx) / len;
    if (py > 0) { px = -px; py = -py; } // bow upward on screen
    const bow = Math.min(len * 0.32, 60 * d);
    const cx = mx + px * bow, cy = my + py * bow;
    const grow = reduce.matches ? 1 : 0.5 + 0.5 * Math.sin(now / 420);
    const stroke = (w, col) => {
      ctx.lineWidth = w * d; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(cx, cy, tx, ty); ctx.stroke();
      const ang = Math.atan2(ty - cy, tx - cx);
      const hl = (11 + 2 * grow) * d;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang - 0.45) * hl, ty - Math.sin(ang - 0.45) * hl);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang + 0.45) * hl, ty - Math.sin(ang + 0.45) * hl);
      ctx.stroke();
    };
    stroke(6.5, 'rgba(251,248,241,.95)');
    stroke(3, '#8C6512');
    ctx.fillStyle = '#8C6512';
    ctx.beginPath(); ctx.arc(fx, fy, 4.5 * d, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

// ---- stage
const stage = $('#stage');
const sctx = stage.getContext('2d');

function resizeStage() {
  const r = stage.getBoundingClientRect();
  if (!r.width) return;
  const d = dprOf();
  stage.width = Math.round(r.width * d);
  stage.height = Math.round(r.height * d);
  if (fold) { fold.W = r.width; fold.H = r.height; fold.baseCam = camFor(fold.bounds, r.width, r.height, 1.22); if (!fold.finished) fold.cam = fold.baseCam; }
}
new ResizeObserver(() => { resizeStage(); }).observe(stage);

function startModel(modelId) {
  const model = getModel(modelId);
  if (!model) return;
  if (!selSheet && store.sheets.length) selSheet = store.sheets[0].id;
  if (!selSheet) return;
  const states = buildStates(model);
  $('#foldPick').hidden = true;
  $('#foldStage').hidden = false;
  fold = { model, states, step: 0, stack: states[0], sheet: selSheet, t: 0, anim: null, drag: null, finished: false, finishT: 0, bounds: modelBounds(model), plan: null, W: 0, H: 0 };
  resizeStage();
  const r = stage.getBoundingClientRect();
  fold.W = r.width; fold.H = r.height;
  fold.baseCam = camFor(fold.bounds, r.width, r.height, 1.22);
  fold.cam = fold.baseCam;
  syncFoldUI();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function leaveStage() {
  fold = null;
  $('#foldStage').hidden = true;
  $('#foldPick').hidden = false;
  $('#nameCard').hidden = true;
}

function curPlan() {
  if (!fold || fold.finished) return null;
  if (!fold.plan || fold.plan.stackRef !== fold.stack) {
    fold.plan = planFold(fold.stack, fold.model.steps[fold.step]);
    fold.plan.stackRef = fold.stack;
  }
  return fold.plan;
}

function syncFoldUI() {
  const f = fold;
  const n = f.model.steps.length;
  const dots = $('#dots');
  dots.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    el.className = i < f.step ? 'done' : i === f.step && !f.finished ? 'now' : '';
    dots.appendChild(el);
  }
  $('#stepCount').textContent = f.finished ? 'Finished' : `Step ${f.step + 1} of ${n}`;
  $('#stepText').textContent = f.finished ? `Your ${f.model.name.toLowerCase()} is done.` : f.model.steps[f.step].text + (f.model.steps[f.step].dir === 'mountain' ? ' (Fold it backwards, away from you.)' : '');
  $('#foldUndo').setAttribute('aria-disabled', f.step > 0 && !f.anim ? 'false' : 'true');
  $('#foldGo').hidden = f.finished;
  $('#nameCard').hidden = !f.finished;
  if (f.finished) {
    $('#mName').textContent = f.model.name;
    $('#mNote').textContent = f.model.blurb;
    say(`Finished: ${f.model.name}.`);
  } else say($('#stepText').textContent);
}

function beginFoldAnim(to) {
  const f = fold;
  if (!f || f.finished) return;
  const from = f.t;
  if (reduce.matches) { f.t = to; if (to >= 1) completeFold(); else f.t = 0; return; }
  const dur = Math.max(120, 620 * Math.abs(to - from));
  f.anim = { from, to, t0: performance.now(), dur };
  syncFoldUI();
}

function completeFold() {
  const f = fold;
  const plan = curPlan();
  f.stack = plan.result;
  f.step++;
  f.t = 0;
  f.anim = null;
  f.plan = null;
  vibrate(10);
  if (f.step >= f.model.steps.length) {
    f.finished = true;
    f.finishT = reduce.matches ? 1 : 0;
    f.finishCam = camFor(stackBounds(f.stack), f.W, f.H, 1.5);
    if (reduce.matches) f.cam = f.finishCam;
  }
  syncFoldUI();
}

function foldFrame(now) {
  const f = fold;
  if (!f || !stage.width) return;
  if (f.anim) {
    const a = f.anim;
    const u = clamp((now - a.t0) / a.dur, 0, 1);
    f.t = a.from + (a.to - a.from) * ease(u);
    if (u >= 1) {
      f.t = a.to;
      f.anim = null;
      if (a.to >= 1) completeFold(); else { f.t = 0; syncFoldUI(); }
    }
  }
  if (f.finished && f.finishT < 1) {
    f.finishT = clamp(f.finishT + 0.016 / 0.9, 0, 1);
    const e = ease(f.finishT);
    const A = f.baseCam, B = f.finishCam;
    f.cam = { s: A.s + (B.s - A.s) * e, cx: A.cx + (B.cx - A.cx) * e, cy: A.cy + (B.cy - A.cy) * e, W: A.W, H: A.H };
  }
  const d = dprOf();
  const img = sheetImg(f.sheet);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, stage.width, stage.height);
  if (f.finished) {
    const e = ease(f.finishT);
    const g = sctx.createRadialGradient(stage.width / 2, stage.height / 2, 10, stage.width / 2, stage.height / 2, stage.width * 0.55);
    g.addColorStop(0, `rgba(243,217,139,${0.45 * e})`);
    g.addColorStop(1, 'rgba(243,217,139,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, stage.width, stage.height);
    const G = camMatrix(f.cam, d);
    drawStackTo(sctx, G, f.stack, img, { d, blur: 5 + 14 * e, dy: 2 + 9 * e, alpha: 0.22 + 0.12 * e });
    return;
  }
  const plan = curPlan();
  if (f.t > 0.0001) drawFoldFrame(sctx, f.cam, d, plan, f.t, img);
  else {
    drawStackTo(sctx, camMatrix(f.cam, d), f.stack, img, { d });
    drawHints(sctx, f.cam, d, f.stack, f.model.steps[f.step], now, plan.line);
  }
}

// ---- stage interaction: tap folds, drag moves the flap by hand
stage.addEventListener('pointerdown', (e) => {
  const f = fold;
  if (!f || f.finished || f.anim || f.drag) return;
  e.preventDefault();
  try { stage.setPointerCapture(e.pointerId); } catch { /* ok */ }
  const r = stage.getBoundingClientRect();
  const step = f.model.steps[f.step];
  const plan = curPlan();
  const toScreen = (pt) => [(pt[0] - f.cam.cx) * f.cam.s + f.cam.W / 2, (pt[1] - f.cam.cy) * f.cam.s + f.cam.H / 2];
  const a = toScreen(step.move), b = toScreen(reflectPoint(step.move, plan.line));
  const vx = b[0] - a[0], vy = b[1] - a[1];
  f.drag = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, vx, vy, len: Math.hypot(vx, vy) || 1, moved: false };
});
stage.addEventListener('pointermove', (e) => {
  const f = fold;
  if (!f || !f.drag || e.pointerId !== f.drag.id) return;
  const r = stage.getBoundingClientRect();
  const dx = e.clientX - r.left - f.drag.x0, dy = e.clientY - r.top - f.drag.y0;
  if (!f.drag.moved && Math.hypot(dx, dy) < 8) return;
  f.drag.moved = true;
  const proj = (dx * f.drag.vx + dy * f.drag.vy) / (f.drag.len * f.drag.len);
  f.t = clamp(proj, 0, 1);
});
function endStage(e, cancel) {
  const f = fold;
  if (!f || !f.drag || e.pointerId !== f.drag.id) return;
  const moved = f.drag.moved;
  f.drag = null;
  if (cancel) { beginFoldAnim(0); return; }
  if (!moved) beginFoldAnim(1); else beginFoldAnim(f.t > 0.4 ? 1 : 0);
}
stage.addEventListener('pointerup', (e) => endStage(e, false));
stage.addEventListener('pointercancel', (e) => endStage(e, true));

$('#foldGo').addEventListener('click', () => { if (fold && !fold.anim && !fold.finished) beginFoldAnim(1); });
$('#foldUndo').addEventListener('click', () => {
  const f = fold;
  if (!f || f.anim || f.step === 0) return;
  f.step = f.finished ? f.model.steps.length - 1 : f.step - 1;
  f.finished = false;
  f.finishT = 0;
  f.cam = f.baseCam;
  f.stack = f.states[f.step];
  f.t = 0;
  f.plan = null;
  syncFoldUI();
});
$('#choose').addEventListener('click', () => { leaveStage(); renderPicker(); });
$('#again').addEventListener('click', () => { leaveStage(); renderPicker(); window.scrollTo({ top: 0 }); });

// ---- picker
function renderPicker() {
  const box = $('#sheetPick');
  box.innerHTML = '';
  if (selSheet && !store.sheets.some((s) => s.id === selSheet)) selSheet = null;
  if (!selSheet && store.sheets.length) selSheet = store.sheets[0].id;
  for (const s of store.sheets) {
    const b = thumbButton(s);
    b.setAttribute('aria-pressed', s.id === selSheet ? 'true' : 'false');
    b.addEventListener('click', () => { selSheet = s.id; renderPicker(); });
    box.appendChild(b);
  }
  $('#sample').hidden = store.sheets.length > 0;
  $('#recycle').hidden = !store.sheets.length;
  const grid = $('#models');
  grid.innerHTML = '';
  for (const m of MODELS) {
    const b = document.createElement('button');
    b.className = 'model';
    b.innerHTML = `<canvas width="152" height="152"></canvas><b>${m.name}</b><span>${m.blurb}</span>`;
    b.addEventListener('click', () => {
      if (!selSheet) { note('', 0); makeSample(); }
      startModel(m.id);
    });
    grid.appendChild(b);
    drawPreview(b.querySelector('canvas'), m, sheetImg(selSheet));
  }
  renderShelf();
}

function drawPreview(canvas, model, img) {
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const stack = finalState(model);
  const cam = camFor(stackBounds(stack), canvas.width, canvas.height, 1.3);
  drawStackTo(c, camMatrix({ ...cam }, 1), stack, img, { d: canvas.width / 76, blur: 3, dy: 2 });
}

function refreshImages() {
  if (!$('#viewFold').hidden && !fold) renderPicker();
}

$('#sample').addEventListener('click', () => { makeSample(); renderPicker(); });
$('#recycle').addEventListener('click', () => {
  if (!selSheet) return;
  store.sheets = store.sheets.filter((s) => s.id !== selSheet);
  sheetImgs.delete(selSheet);
  selSheet = null;
  saveStore();
  renderDrawer();
  renderPicker();
});

function makeSample() {
  const b = createBath();
  runStarter(b, 'gelgit', mulberry32(20261013), 20);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  paintBath(c.getContext('2d'), b, 512);
  selSheet = addSheet(c);
  renderDrawer();
}

// ---- shelf
function makeThumb(model, img) {
  const c = document.createElement('canvas');
  c.width = c.height = 240;
  const g = c.getContext('2d');
  const stack = finalState(model);
  const cam = camFor(stackBounds(stack), 240, 240, 1.45);
  drawStackTo(g, camMatrix(cam, 1), stack, img, { d: 2, blur: 8, dy: 5, alpha: 0.3 });
  return c.toDataURL('image/png');
}

$('#toShelf').addEventListener('click', () => {
  const f = fold;
  if (!f || !f.finished) return;
  const thumb = makeThumb(f.model, sheetImg(f.sheet));
  store.shelf.unshift({ id: 'p' + store.seq++, model: f.model.id, sheet: f.sheet, t: Date.now(), thumb });
  while (store.shelf.length > MAX_SHELF) store.shelf.pop();
  saveStore();
  renderShelf();
  $('#nameCard').querySelector('p').textContent = `The ${f.model.name.toLowerCase()} is on your shelf.`;
  say('Put on the shelf.');
});

function renderShelf() {
  const box = $('#shelf');
  box.innerHTML = '';
  for (const item of store.shelf) {
    const b = document.createElement('button');
    const m = getModel(item.model);
    b.setAttribute('aria-label', m.name);
    b.innerHTML = `<img alt="" src="${item.thumb}">`;
    b.addEventListener('click', () => showPiece(item));
    box.appendChild(b);
  }
}

let shownPiece = null;
function showPiece(item) {
  shownPiece = item;
  const m = getModel(item.model);
  $('#dImg').src = item.thumb;
  $('#dName').textContent = m.name;
  $('#dNote').textContent = m.blurb;
  $('#dialog').classList.add('open');
  $('#dClose').focus();
}
function closePiece() { $('#dialog').classList.remove('open'); shownPiece = null; }
$('#dClose').addEventListener('click', closePiece);
$('#dialog').addEventListener('click', (e) => { if (e.target === $('#dialog')) closePiece(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePiece(); });
$('#dRemove').addEventListener('click', () => {
  if (shownPiece) { store.shelf = store.shelf.filter((s) => s.id !== shownPiece.id); saveStore(); renderShelf(); }
  closePiece();
});

// ------------------------------------------------------------------ start
bctxInit();
function bctxInit() {
  makeGrain(bctx);
  renderDrawer();
  loadSheetImages();
  syncButtons();
  resizeBath();
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => { dirty = true; });

// handy for tests and poking around from the console
window.__marbling = {
  get bath() { return bath; },
  get fold() { return fold; },
  store, paint() { paintBath(bctx, bath, bathCanvas.width); bctx.getImageData(0, 0, 1, 1); }, setTool, startStarter, layPaper, openFold, startModel, showTab,
  get busy() { return busy; }, countVerts: () => countVerts(bath), dropInk: (x, y, r, c) => dropInk(bath, x, y, r, c), applyOp: (op) => applyOp(bath, op), setBath: (b) => { bath = b; dirty = true; },
};
