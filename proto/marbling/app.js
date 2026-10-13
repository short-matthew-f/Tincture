// Marbling and origami prototype: UI, canvas rendering, interaction, animation.
// The ink maths lives in marble.js and the flat-folding geometry in fold.js (both pure).
import {
  INKS, BATH_COLOR, LIMITS, createBath, snapshot, restore, beginDrop, growDrop, maintain, stylusStep, combStep, swirlStep,
  resample, basinOffsets, starterOps, applyOp, STARTERS, mulberry32, runStarter, countVerts, pathNormal, combOffsets, dropInk,
  serializeBath, deserializeBath,
} from './marble.js';
import {
  buildStates, finalState, modelBounds, stackBounds, planStep, stepOps, creaseSegments, applyM, mul, modelDecor,
  poseItems, planHints, edgeFlags, finalPull, finishBounds, isPullStep, centroid, area, reflectPoint, poseBounds, unionBounds,
} from './fold.js';
import { MODELS, LEVELS, getModel } from './models.js';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'tincture.proto.marbling';
const BATH_KEY = 'tincture.proto.marbling.bath'; // the ink on the bath, so a reload keeps her work
const UI_KEY = 'tincture.proto.marbling.ui'; // which tab, and where she is in a fold
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
try { bath = deserializeBath(JSON.parse(localStorage.getItem(BATH_KEY) || 'null')); } catch { bath = createBath(); }
let bathSaveTimer = 0;
function saveBath(now = false) {
  clearTimeout(bathSaveTimer);
  const write = () => {
    if (pointer || tail || runner) return; // only a settled bath is written
    try {
      if (bath.inks.length) localStorage.setItem(BATH_KEY, JSON.stringify(serializeBath(bath)));
      else localStorage.removeItem(BATH_KEY);
    } catch { try { localStorage.removeItem(BATH_KEY); } catch { /* storage unavailable */ } }
  };
  if (now) write(); else bathSaveTimer = setTimeout(write, 1200);
}
window.addEventListener('pagehide', () => saveBath(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveBath(true); });
let inkColor = INKS[2].hex;
let tool = 'drop';
let tines = 70; // gap between tines, in bath units (the comb always spans the basin)
const COMB_SPACING = {};
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

function polyPath(ctx, p, stride = 1) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  const st = p.length > 240 ? stride : 1; // small drops always keep every vertex
  for (let i = 2 * st; i < p.length; i += 2 * st) ctx.lineTo(p[i], p[i + 1]);
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
// fast: while ink is moving on a very busy bath, skip every 2nd/3rd vertex and the edge
// stroke (a 48k-vertex bath took ~300 ms a frame to paint); the resting bath and every
// captured sheet are painted in full.
function paintBath(ctx, b, px, fast = false) {
  const verts = fast ? countVerts(b) : 0;
  const stride = !fast || verts < 12000 ? 1 : verts < 26000 ? 2 : 3;
  const k = px / b.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BATH_COLOR;
  ctx.fillRect(0, 0, px, px);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, px / 520) / k;
  for (const ink of b.inks) {
    polyPath(ctx, ink.pts, stride);
    ctx.fillStyle = ink.color;
    ctx.fill();
    if (stride > 1) continue;
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
    // The comb reaches wall to wall: show every tine across the basin.
    const n = p.nrm || [0, 1];
    const offs = p.offs || basinOffsets([p.x, p.y], n, tines);
    const ox = p.x;
    bctx.strokeStyle = 'rgba(42,38,34,.55)';
    bctx.lineWidth = 1.5 * dprOf() * px;
    bctx.beginPath();
    bctx.moveTo(ox + n[0] * offs[0], p.y + n[1] * offs[0]);
    bctx.lineTo(ox + n[0] * offs[offs.length - 1], p.y + n[1] * offs[offs.length - 1]);
    bctx.stroke();
    for (const o of offs) {
      bctx.beginPath(); bctx.arc(ox + n[0] * o, p.y + n[1] * o, 5, 0, 6.2832); bctx.stroke();
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
  settleTail();
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
  if (p.mode === 'drop') {
    if (cancel) { undoStack.pop(); syncButtons(); } else {
      const r = dropRadius(performance.now() - p.t0);
      const h = beginDrop(bath, p.x, p.y, inkColor);
      blooms.push({ h, target: r, t0: performance.now(), dur: reduce.matches ? 1 : 190 });
      vibrate(8);
    }
  } else if (p.mode === 'stylus' || p.mode === 'comb') {
    if (queue.length) tail = p; else maintain(bath);
  }
  dirty = true;
  saveBath();
}
bathCanvas.addEventListener('pointerup', (e) => endPointer(e, false));
bathCanvas.addEventListener('pointercancel', (e) => endPointer(e, true));
bathCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Pull the queued stylus/comb points into the bath (one frame's worth at a time).
// Pull the queued stylus/comb points into the bath. With a time budget (ms) the work stops
// between sub-steps and the rest waits for the next frame, so the tool overlay keeps up with
// the finger and the ink follows a moment later instead of the whole page stalling.
function flushQueue(p, budget = Infinity) {
  if (!p || !queue.length) { queue.length = 0; return; }
  const t0 = performance.now();
  let i = 0;
  for (; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (p.mode === 'stylus' || p.mode === 'comb') {
      if (p.mode === 'comb' && !p.nrm) {
        if (Math.hypot(x - p.start[0], y - p.start[1]) < 16) continue;
        p.nrm = pathNormal([p.start, [x, y]]);
        p.offs = basinOffsets(p.start, p.nrm, tines);
        p.lx = p.start[0]; p.ly = p.start[1];
      }
      const c = p.mode === 'comb' ? LIMITS.combC : LIMITS.stylusC;
      let len = Math.hypot(x - p.lx, y - p.ly);
      if (len < 1.5) continue;
      while (len >= 1.5) {
        const k = Math.min(1, (0.9 * c) / len); // one engine sub-step at a time
        const q = [p.lx + (x - p.lx) * k, p.ly + (y - p.ly) * k];
        if (p.mode === 'comb') combStep(bath, [p.lx, p.ly], q, p.nrm, p.offs, 0, c);
        else stylusStep(bath, [p.lx, p.ly], q, c);
        p.lx = q[0]; p.ly = q[1];
        len = Math.hypot(x - p.lx, y - p.ly);
        if (performance.now() - t0 > budget) break;
      }
      if (len >= 1.5) break; // out of time partway along this point
    }
    if (performance.now() - t0 > budget) { i++; break; }
  }
  queue.splice(0, i);
  dirty = true;
}
let tail = null; // a stylus/comb stroke whose ink is still catching up after the finger lifted
function settleTail() {
  if (!tail) return;
  flushQueue(tail);
  queue.length = 0;
  maintain(bath);
  tail = null;
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
      r.cur = { op, pts: resample(op.pts, starterStep(op)), idx: 1, nrm: pathNormal(op.pts) };
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

// combStep/stylusStep already subdivide every segment at 0.9 c, so resampling finer than
// that only repeats work (it made Bouquet take 20 s, and "skip ahead" barely helped).
function starterStep(op) { return 0.9 * (op.c || (op.tool === 'comb' ? LIMITS.combC : LIMITS.stylusC)); }

// Stop a starter where it is: the bath keeps what has been drawn so far and is hers again.
function stopRunner() {
  if (!runner) return;
  runner = null;
  busy = false;
  for (const b of blooms) growDrop(bath, b.h, b.target);
  blooms = [];
  maintain(bath);
  note('');
  dirty = true;
}

function finishRunner() {
  runner = null;
  busy = false;
  maintain(bath);
  note('');
  $('#tip').textContent = 'That is your bath. Lay a sheet on it when you like it, or keep pulling.';
  say('Starter finished.');
  dirty = true;
  saveBath();
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
  requestAnimationFrame(frame);
  try { frameBody(now); } catch (err) {
    console.error(err);
    if (runner) stopRunner();
    if (fold) { fold.anim = null; fold.hold = null; fold.drag = null; fold.t = 0; }
    pointer = null;
  }
}
function frameBody(now) {
  const dt = lastFrame ? Math.max(0, now - lastFrame) : 16;
  lastFrame = now;
  if (pointer && pointer.mode === 'swirl' && !busy) {
    swirlStep(bath, pointer.x, pointer.y, 90, pointer.dir * 0.05 * (Math.min(dt, 34) / 16.7), LIMITS.swirlC);
    dirty = true;
  }
  if (pointer) flushQueue(pointer, 12);
  else if (tail) { flushQueue(tail, 12); if (!queue.length) { maintain(bath); tail = null; saveBath(); } }
  stepBlooms(now);
  stepRunner(now, dt);
  if (pointer && pointer.mode === 'drop') dirty = true;
  if (!$('#viewMarble').hidden) {
    // a very busy bath is drawn a little softer while it is moving, then sharp again once it rests
    const v = countVerts(bath);
    const moving = busy || pointer || tail || blooms.length;
    const want = moving ? (v > 22000 ? 0.55 : v > 12000 ? 0.75 : 1) : 1;
    if (want !== renderScale) { renderScale = want; resizeBath(); }
  }
  if (dirty && bathCanvas.width > 0 && !$('#viewMarble').hidden) {
    dirty = false;
    paintBath(bctx, bath, bathCanvas.width, !!(busy || pointer || tail || blooms.length));
    paintOverlay(now);
  }
  if (foldVisible()) foldFrame(now);
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
  comb: 'Draw the comb in any direction. It reaches wall to wall, like a real marbling comb.',
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
  if (runner) { stopRunner(); say('Starter stopped.'); } // Undo during a starter takes the bath back to before it
  if (busy || !undoStack.length) return;
  tail = null; queue.length = 0;
  restore(bath, undoStack.pop());
  blooms = [];
  syncButtons();
  dirty = true;
  saveBath();
  say('Undone.');
});
$('#clear').addEventListener('click', () => {
  stopRunner();
  if (busy) return;
  tail = null; queue.length = 0;
  if (bath.inks.length) pushUndo();
  bath = createBath();
  blooms = [];
  dirty = true;
  saveBath();
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
  stopRunner(); // a new starter replaces one that is still playing
  if (busy) return;
  settleTail();
  pushUndo();
  bath = createBath();
  blooms = [];
  const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  runner = { ops: starterOps(id, rng), i: 0, cur: null, nextAt: 0, fast: reduce.matches, id };
  busy = true;
  const meta = STARTERS.find((s) => s.id === id);
  note(`${meta.name}. Tap the bath to skip ahead, or Undo to stop.`);
  $('#tip').textContent = meta.note;
  dirty = true;
  // The starters sit below the tray: bring the bath into view so she sees it happen.
  const tr = $('.tray').getBoundingClientRect();
  if (tr.top < 0 || tr.bottom > window.innerHeight) {
    window.scrollTo({ top: window.scrollY + tr.top - 8, behavior: reduce.matches ? 'auto' : 'smooth' });
  }
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
  stopRunner(); // lay what is on the bath now
  if (busy) return;
  settleTail();
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
    try { tickBody(); } catch (err) {
      console.error(err);
      fly.classList.remove('on');
      busy = false;
      const el = $(`#drawer .thumb[data-id="${id}"]`);
      if (el) el.classList.remove('arriving');
    }
  };
  const tickBody = () => {
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
    saveBath();
    const dr = $('#drawer').getBoundingClientRect();
    note(dr.top > window.innerHeight ? 'Your paper is resting in the drawer, further down.' : 'Your paper is resting in the drawer.', 2600);
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
function saveUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({
      tab: $('#viewFold').hidden ? 'marble' : 'fold',
      fold: fold ? { model: fold.model.id, sheet: fold.sheet, step: fold.finished ? fold.model.steps.length : fold.step } : null,
    }));
  } catch { /* optional */ }
}
function showTab(which) {
  const marble = which === 'marble';
  $('#viewMarble').hidden = !marble;
  $('#viewFold').hidden = marble;
  $('#tabMarble').setAttribute('aria-pressed', marble ? 'true' : 'false');
  $('#tabFold').setAttribute('aria-pressed', marble ? 'false' : 'true');
  if (marble) { resizeBath(); dirty = true; } else { renderPicker(); resizeStage(); }
  saveUI();
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

function tracePoly(ctx, G, poly) {
  for (let i = 0; i < poly.length; i++) {
    const [x, y] = applyM(G, poly[i][0], poly[i][1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// G maps world -> device pixels. extra: { shade, face, edges (per-edge: true = a flat crease, drawn faintly) }
function drawLayer(ctx, G, layer, img, extra = {}) {
  const poly = layer.poly;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  tracePoly(ctx, G, poly);
  const face = extra.face ?? layer.face;
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
    ctx.fillStyle = `rgba(36,24,12,${Math.min(0.6, extra.shade)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (extra.light) {
    ctx.fillStyle = `rgba(255,252,244,${Math.min(0.3, extra.light)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();
  // edges: real edges and folds firmly, flat creases (folded and opened again) faintly
  const lw = Math.max(1, ctx.canvas.width / 420);
  const n = poly.length;
  const pts = poly.map(([x, y]) => applyM(G, x, y));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const crease of [true, false]) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < n; i++) {
      const isCrease = !!(extra.edges && extra.edges[i]);
      if (isCrease !== crease) continue;
      const a = pts[i], b = pts[(i + 1) % n];
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      any = true;
    }
    if (!any) continue;
    ctx.lineWidth = crease ? lw * 0.8 : lw;
    ctx.strokeStyle = crease ? (face > 0 ? 'rgba(255,250,240,.28)' : 'rgba(60,40,20,.16)') : 'rgba(60,40,20,.38)';
    ctx.stroke();
  }
}

// one soft shadow under the whole piece (cheaper and calmer than a shadow per layer)
function drawShadow(ctx, list, opts) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = `rgba(42,30,18,${opts.alpha ?? 0.24})`;
  ctx.shadowBlur = (opts.blur ?? 6) * (opts.d || 1);
  ctx.shadowOffsetY = (opts.dy ?? 3) * (opts.d || 1);
  ctx.fillStyle = PAPER_BACK;
  ctx.beginPath();
  for (const [G, poly] of list) tracePoly(ctx, G, poly);
  ctx.fill('nonzero');
  ctx.restore();
}

function drawStackTo(ctx, G, stack, img, opts = {}) {
  if (opts.shadow !== false) drawShadow(ctx, stack.map((l) => [G, l.poly]), opts);
  const flags = edgeFlags(stack);
  for (let i = 0; i < stack.length; i++) drawLayer(ctx, G, stack[i], img, { edges: flags[i] });
}

// a posed plan (fold in progress, or a three-dimensional pulled piece)
function drawPose(ctx, base, plan, t, img, opts = {}) {
  const items = poseItems(plan, t);
  if (!plan.itemFlags) plan.itemFlags = new Map(edgeFlags(plan.items.map((it) => it.piece)).map((f, i) => [plan.items[i].piece, f]));
  if (opts.shadow !== false) drawShadow(ctx, items.map((o) => [mul(base, o.M), o.piece.poly]), opts);
  for (const o of items) {
    drawLayer(ctx, mul(base, o.M), o.piece, img, { face: o.face, shade: o.shade, light: o.light, edges: o.moved && t > 0.02 && t < 0.98 ? null : plan.itemFlags.get(o.piece) });
  }
}

// ---- pen marks (eyes, noses) on a finished model
function drawDecor(ctx, G, shapes, alpha = 1) {
  if (!shapes || !shapes.length) return;
  const s = Math.hypot(G[0], G[1]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const sh of shapes) {
    if (sh.t === 'dot') {
      const [x, y] = applyM(G, sh.x, sh.y);
      ctx.fillStyle = sh.fill;
      ctx.beginPath(); ctx.arc(x, y, sh.r * s, 0, 6.2832); ctx.fill();
    } else if (sh.t === 'ellipse') {
      const [x, y] = applyM(G, sh.x, sh.y);
      ctx.fillStyle = sh.fill;
      ctx.beginPath(); ctx.ellipse(x, y, sh.rx * s, sh.ry * s, sh.rot || 0, 0, 6.2832); ctx.fill();
    } else if (sh.t === 'poly') {
      ctx.fillStyle = sh.fill;
      ctx.beginPath();
      sh.pts.forEach((p, i) => { const [x, y] = applyM(G, p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill();
    } else if (sh.t === 'line') {
      ctx.strokeStyle = sh.color;
      ctx.lineWidth = Math.max(1, sh.w * s);
      ctx.beginPath();
      sh.pts.forEach((p, i) => { const [x, y] = applyM(G, p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
  ctx.restore();
}

// the finished piece: flat, or in the pose its last "pull" step leaves it in
function drawFinished(ctx, G, model, img, opts = {}) {
  const pull = finalPull(model);
  const stack = finalState(model);
  const shapes = modelDecor(model, stack);
  if (!pull) {
    drawStackTo(ctx, G, stack, img, opts);
    drawDecor(ctx, G, shapes, opts.decorAlpha ?? 1);
    return;
  }
  drawPose(ctx, G, pull, 1, img, opts);
  // pen marks ride on the piece of paper they were drawn on
  const items = poseItems(pull, 1);
  for (const sh of shapes) {
    const at = sh.t === 'dot' || sh.t === 'ellipse' ? [sh.x, sh.y] : sh.pts[0];
    for (let i = items.length - 1; i >= 0; i--) {
      if (insidePoly(items[i].piece.poly, at)) { if (items[i].nz > 0) drawDecor(ctx, mul(G, items[i].M), [sh], opts.decorAlpha ?? 1); break; }
    }
  }
}
function insidePoly(poly, p) {
  return poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9; });
}

// ---- what a step does, in origami words (shown above the instruction)
function stepKind(step) {
  if (step.kind) return step.kind;
  const ops = stepOps(step);
  const o = ops[0];
  if (o.type === 'pull') return 'Open it out';
  if (o.type === 'turn') return 'Turn over';
  if (o.type === 'rotate') return 'Rotate';
  if (o.kind) return o.kind;
  if (o.type === 'multi') return o.parts.every((p) => p.z === 'same') ? 'Fold and unfold' : 'Collapse';
  if (o.unfold) return 'Fold and unfold';
  if (o.place === 'inside') return 'Inside reverse fold';
  if (o.place === 'outside') return 'Outside reverse fold';
  return ops.every((x) => x.dir === 'mountain') ? 'Mountain fold' : 'Valley fold';
}

// ---- diagram marks: crease lines (valley dashed, mountain dash-dot) and an arrow for the motion
function arrowFor(stepPlan, step) {
  const p = stepPlan.plans[0];
  if (step.arrow) return { from: step.arrow[0], to: step.arrow[1] };
  if (p.kind === 'fold') {
    const from = p.op.move;
    return { from, to: p.unfold ? reflectPoint(from, p.line) : p.landing(from), back: p.unfold };
  }
  if (p.kind === 'turn' || p.kind === 'rotate') return null;
  // the piece that travels furthest shows the way
  const crease = p.kind === 'multi' && p.op.parts.every((q) => q.z === 'same');
  const tt = crease ? 0.5 : 1;
  let best = null;
  const items = poseItems(p, tt, [0, 0]);
  for (const o of items) {
    if (!o.moved) continue;
    const c = centroid(o.piece.poly);
    const e = applyM(o.M, c[0], c[1]);
    const dd = Math.hypot(e[0] - c[0], e[1] - c[1]) * Math.sqrt(area(o.piece.poly));
    if (!best || dd > best.dd) best = { dd, from: c, to: e };
  }
  return best && { from: best.from, to: best.to, back: crease };
}

function drawArrow(ctx, P, from, to, d, now, back) {
  const [fx, fy] = P(from), [tx, ty] = P(to);
  const len = Math.hypot(tx - fx, ty - fy);
  if (len < 6 * d) return;
  const mx = (fx + tx) / 2, my = (fy + ty) / 2;
  let px = -(ty - fy) / len, py = (tx - fx) / len;
  if (py > 0) { px = -px; py = -py; } // bow upward on screen
  const bow = Math.min(len * 0.32, 60 * d);
  const cx = mx + px * bow, cy = my + py * bow;
  const grow = reduce.matches ? 1 : 0.5 + 0.5 * Math.sin(now / 420);
  const head = (x, y, ang, hl) => {
    ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang - 0.45) * hl, y - Math.sin(ang - 0.45) * hl);
    ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang + 0.45) * hl, y - Math.sin(ang + 0.45) * hl);
  };
  const stroke = (w, col) => {
    ctx.lineWidth = w * d; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(cx, cy, tx, ty);
    head(tx, ty, Math.atan2(ty - cy, tx - cx), (11 + 2 * grow) * d);
    if (back) head(fx, fy, Math.atan2(fy - cy, fx - cx), (9 + 2 * grow) * d); // fold and unfold: it comes back
    ctx.stroke();
  };
  stroke(6.5, 'rgba(251,248,241,.95)');
  stroke(3, '#8C6512');
  ctx.fillStyle = '#8C6512';
  if (!back) { ctx.beginPath(); ctx.arc(fx, fy, 4.5 * d, 0, 6.2832); ctx.fill(); }
}

function drawHints(ctx, cam, d, stack, step, now, stepPlan) {
  const base = camMatrix(cam, d);
  const P = (pt) => applyM(base, pt[0], pt[1]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round';
  const off = reduce.matches ? 0 : -(now / 40) * d;
  const kind = stepPlan.plans[0].kind;
  for (const p of stepPlan.plans) {
    let segs;
    if (p.kind === 'fold') segs = creaseSegments(p.before, p.line).map(([a, b]) => ({ a, b, dir: p.dir === 'mountain' && !p.place ? 'mountain' : 'valley' }));
    else segs = planHints(p);
    for (const sg of segs) {
      const [x0, y0] = P(sg.a), [x1, y1] = P(sg.b);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(251,248,241,.92)';
      ctx.lineWidth = 5 * d;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.setLineDash(sg.dir === 'mountain' ? [10 * d, 4 * d, 2 * d, 4 * d] : [9 * d, 6 * d]);
      ctx.lineDashOffset = off;
      ctx.strokeStyle = '#2A2622';
      ctx.lineWidth = 2.2 * d;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  if (kind === 'turn' || kind === 'rotate') {
    // a turning arrow under the paper
    const b = stackBounds(stack);
    const [cx, cy0] = P([(b.x0 + b.x1) / 2, b.y1]);
    const r = Math.min(70 * d, (b.x1 - b.x0) * cam.s * d * 0.45);
    const cy = Math.min(cy0, ctx.canvas.height - r * 0.28 - 30 * d);
    const grow = reduce.matches ? 1 : 0.5 + 0.5 * Math.sin(now / 420);
    for (const [w, col] of [[6.5, 'rgba(251,248,241,.95)'], [3, '#8C6512']]) {
      ctx.lineWidth = w * d; ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 14 * d, r, r * 0.28, 0, Math.PI * 0.15, Math.PI * 0.95);
      const ex = cx + r * Math.cos(Math.PI * 0.15), ey = cy + 14 * d + r * 0.28 * Math.sin(Math.PI * 0.15);
      const hl = (11 + 2 * grow) * d;
      ctx.moveTo(ex, ey); ctx.lineTo(ex + hl * 0.2, ey - hl);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - hl * 0.9, ey + hl * 0.2);
      ctx.stroke();
    }
  } else if (kind === 'pull') {
    // gentle arrows from where the paper will move
    const p = stepPlan.plans[0];
    const pulse = reduce.matches ? 1 : 0.6 + 0.4 * Math.sin(now / 300);
    const items = poseItems(p, 0.35);
    const seen = [];
    for (const o of items) {
      if (!o.moved) continue;
      const c = centroid(o.piece.poly);
      const e = applyM(o.M, c[0], c[1]);
      if (Math.hypot(e[0] - c[0], e[1] - c[1]) < 0.03 || seen.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 0.35)) continue;
      seen.push(c);
      // at least a finger's length on screen
      const [sx, sy] = P(c), [ex, ey] = P(e);
      const k = Math.max(1.6, (64 * d) / Math.max(1, Math.hypot(ex - sx, ey - sy)));
      ctx.globalAlpha = pulse;
      drawArrow(ctx, P, c, [c[0] + (e[0] - c[0]) * k, c[1] + (e[1] - c[1]) * k], d, now, false);
      ctx.globalAlpha = 1;
      if (seen.length >= 3) break;
    }
  } else {
    const ar = stepPlan.arrow;
    if (ar) drawArrow(ctx, P, ar.from, ar.to, d, now, ar.back);
  }
  for (const [from, to] of step.arrows || []) drawArrow(ctx, P, from, to, d, now, false);
  ctx.restore();
}

// ---- framing: each step gets a camera that fits what happens in it; the camera eases between steps, never mid-fold
function stepCam(f, i) {
  f.cams = f.cams || [];
  if (f.cams[i]) return f.cams[i];
  let b = unionBounds(stackBounds(f.states[i]), stackBounds(f.states[Math.min(i + 1, f.states.length - 1)]));
  if (i < f.model.steps.length) {
    const { plans } = planStep(f.states[i], f.model.steps[i]);
    for (const p of plans) for (const t of [0.25, 0.5, 0.75, 1]) b = unionBounds(b, poseBounds(p, t));
  }
  const cam = camFor(b, f.W, f.H, 1.3);
  cam.s = Math.min(cam.s, f.baseCam.s * 2.4);
  f.cams[i] = cam;
  return cam;
}
function aimCam(f, now, instant) {
  if (!f.W) return;
  const to = f.finished ? f.finishCam : stepCam(f, f.step);
  if (instant || reduce.matches || !f.cam) { f.cam = to; f.camMove = null; return; }
  f.camMove = { from: { ...f.cam }, to, t0: now };
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
  if (fold) {
    fold.W = r.width; fold.H = r.height; fold.baseCam = camFor(fold.bounds, r.width, r.height, 1.18); fold.cams = [];
    fold.finishCam = camFor(finishBounds(fold.model), r.width, r.height, 1.4);
    aimCam(fold, performance.now(), true);
  }
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
  fold = { model, states, step: 0, stack: states[0], sheet: selSheet, t: 0, anim: null, drag: null, finished: false, finishT: 0, bounds: modelBounds(model), plan: null, W: 0, H: 0, idle: performance.now(), nudge: null };
  resizeStage();
  const r = stage.getBoundingClientRect();
  fold.W = r.width; fold.H = r.height;
  fold.baseCam = camFor(fold.bounds, r.width, r.height, 1.18);
  fold.cams = [];
  fold.cam = null;
  aimCam(fold, performance.now(), true);
  syncFoldUI();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function leaveStage() {
  fold = null;
  saveUI();
  $('#foldStage').hidden = true;
  $('#foldPick').hidden = false;
  $('#nameCard').hidden = true;
}

function curPlan() {
  if (!fold || fold.finished) return null;
  if (!fold.plan || fold.plan.stackRef !== fold.stack) {
    const step = fold.model.steps[fold.step];
    fold.plan = planStep(fold.stack, step);
    fold.plan.stackRef = fold.stack;
    fold.plan.arrow = arrowFor(fold.plan, step);
  }
  return fold.plan;
}

function singleMountain(step) { const o = stepOps(step); return o.length === 1 && o[0].dir === 'mountain' && !o[0].place && !o[0].type && !o[0].unfold; }
const isPull = (f) => !f.finished && isPullStep(f.model.steps[f.step]);

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
  dots.classList.toggle('many', n > 12);
  $('#stepCount').textContent = f.finished ? 'Finished' : `Step ${f.step + 1} of ${n}`;
  const step = f.finished ? null : f.model.steps[f.step];
  $('#stepKind').textContent = step ? stepKind(step) : '';
  $('#stepKind').hidden = !step;
  $('#stepText').textContent = f.finished ? `Your ${f.model.name.toLowerCase()} is done.` : step.text + (singleMountain(step) ? ' (Fold it backwards, away from you.)' : '');
  $('#foldUndo').setAttribute('aria-disabled', f.step > 0 && !f.anim ? 'false' : 'true');
  const go = $('#foldGo');
  go.hidden = f.finished;
  go.textContent = step ? (step.cta || (stepKind(step) === 'Turn over' ? 'Turn it over' : stepKind(step) === 'Rotate' ? 'Turn it' : 'Fold it')) : 'Fold it';
  go.classList.toggle('pull', !!step && isPullStep(step));
  const sn = $('#stageNote');
  sn.textContent = step && isPullStep(step) ? (step.prompt || 'Tap, press and hold, or drag the paper') : '';
  sn.classList.toggle('on', !!step && isPullStep(step) && !f.anim);
  $('#stage').classList.toggle('pullstep', !!step && isPullStep(step));
  const wasHidden = $('#nameCard').hidden;
  $('#nameCard').hidden = !f.finished;
  saveUI();
  if (f.finished && wasHidden) {
    // the next step (shelf, or fold another) is on this card: make sure she can see it
    requestAnimationFrame(() => {
      const r = $('#nameCard').getBoundingClientRect();
      if (r.bottom > window.innerHeight) window.scrollBy({ top: r.bottom - window.innerHeight + 12, behavior: reduce.matches ? 'auto' : 'smooth' });
    });
  }
  if (f.finished) {
    $('#mName').textContent = f.model.name;
    $('#mNote').textContent = f.model.blurb;
    say(`Finished: ${f.model.name}.`);
  } else say($('#stepKind').textContent + '. ' + $('#stepText').textContent);
}

function touch() { if (fold) { fold.idle = performance.now(); fold.nudge = null; $('#foldGo').classList.remove('nudge'); } }

function beginFoldAnim(to) {
  const f = fold;
  if (!f || f.finished) return;
  touch();
  const from = f.t;
  if (reduce.matches) { f.t = to; if (to >= 1) completeFold(); else f.t = 0; return; }
  const step = f.model.steps[f.step];
  const ops = stepOps(step);
  const heavy = ops.some((o) => o.type === 'multi' || o.type === 'pull' || o.place);
  const base = isPullStep(step) ? 1900 : heavy ? 1500 : ops[0].type === 'turn' ? 900 : 700;
  const dur = Math.max(140, base * Math.pow(ops.length, 0.6) * Math.abs(to - from));
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
  touch();
  vibrate(10);
  if (f.step >= f.model.steps.length) {
    f.finished = true;
    f.finishT = reduce.matches ? 1 : 0;
    f.finishCam = camFor(finishBounds(f.model), f.W, f.H, 1.4);
    f.camFinishFrom = { ...f.cam };
    if (reduce.matches) f.cam = f.finishCam;
  } else aimCam(f, performance.now());
  syncFoldUI();
}

// a gentle show of the motion when she pauses on a step (never a timer she can see, never a failure)
const IDLE_MS = 5200, IDLE_PULL_MS = 3200, NUDGE_MS = 1300;
function stepIdle(f, now) {
  if (f.finished || f.anim || f.drag) return;
  const pull = isPull(f);
  if (f.nudge) {
    const u = (now - f.nudge.t0) / NUDGE_MS;
    if (u >= 1) { f.nudge = null; f.t = 0; f.idle = now; return; }
    f.t = (pull ? 0.32 : 0.2) * Math.sin(Math.PI * u) * (u < 0.5 ? 1 : 1);
    return;
  }
  if (now - f.idle > (pull ? IDLE_PULL_MS : IDLE_MS)) {
    $('#foldGo').classList.add('nudge');
    if (!reduce.matches) f.nudge = { t0: now };
    else f.idle = now;
  }
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
  } else if (f.hold) {
    f.t = Math.min(1, f.t + 0.016 / 1.6);
    if (f.t >= 1) { f.hold = null; completeFold(); }
  } else stepIdle(f, now);
  if (f.camMove) {
    const u = clamp((now - f.camMove.t0) / 520, 0, 1), e = ease(u), A = f.camMove.from, B = f.camMove.to;
    f.cam = { s: A.s + (B.s - A.s) * e, cx: A.cx + (B.cx - A.cx) * e, cy: A.cy + (B.cy - A.cy) * e, W: B.W, H: B.H };
    if (u >= 1) f.camMove = null;
  }
  if (f.finished && f.finishT < 1) {
    f.finishT = clamp(f.finishT + 0.016 / 0.9, 0, 1);
    const e = ease(f.finishT);
    const A = f.camFinishFrom || f.baseCam, B = f.finishCam;
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
    drawFinished(sctx, camMatrix(f.cam, d), f.model, img, { d, blur: 6 + 12 * e, dy: 3 + 8 * e, alpha: 0.24 + 0.1 * e, decorAlpha: e });
    return;
  }
  const plan = curPlan();
  const base = camMatrix(f.cam, d);
  if (f.t > 0.0001) {
    const N = plan.plans.length;
    const u = Math.min(f.t * N, N - 1e-6);
    const i = Math.floor(u);
    drawPose(sctx, base, plan.plans[i], u - i, img, { d });
  } else {
    drawStackTo(sctx, base, f.stack, img, { d });
    drawHints(sctx, f.cam, d, f.stack, f.model.steps[f.step], now, plan);
  }
}

// ---- stage interaction: tap folds, drag moves the paper by hand, press and hold pulls it open
function dragVector(f) {
  const plan = curPlan();
  const toScreen = (pt) => [(pt[0] - f.cam.cx) * f.cam.s + f.cam.W / 2, (pt[1] - f.cam.cy) * f.cam.s + f.cam.H / 2];
  const ar = plan.arrow;
  if (ar && !isPull(f)) {
    const a = toScreen(ar.from), b = toScreen(ar.to);
    const vx = b[0] - a[0], vy = b[1] - a[1], l = Math.hypot(vx, vy);
    if (l > 20) return { vx, vy, len: l };
  }
  return { vx: 0, vy: -1, len: 0, free: true }; // turning over or opening out: any steady drag moves it along
}
stage.addEventListener('pointerdown', (e) => {
  const f = fold;
  if (!f || f.finished || f.anim || f.drag) return;
  e.preventDefault();
  touch();
  if (f.t > 0) f.t = 0; // a nudge was showing
  try { stage.setPointerCapture(e.pointerId); } catch { /* ok */ }
  const r = stage.getBoundingClientRect();
  f.drag = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, moved: false, ...dragVector(f), t0: performance.now() };
  if (isPull(f)) f.drag.holdTimer = setTimeout(() => { if (fold && fold.drag && !fold.drag.moved) fold.hold = true; }, 220);
});
stage.addEventListener('pointermove', (e) => {
  const f = fold;
  if (!f || !f.drag || e.pointerId !== f.drag.id) return;
  const r = stage.getBoundingClientRect();
  const dx = e.clientX - r.left - f.drag.x0, dy = e.clientY - r.top - f.drag.y0;
  if (!f.drag.moved && Math.hypot(dx, dy) < 8) return;
  f.drag.moved = true;
  f.hold = null;
  touch();
  if (f.drag.free) f.t = clamp(Math.hypot(dx, dy) / Math.min(f.W, 320), 0, 1);
  else f.t = clamp((dx * f.drag.vx + dy * f.drag.vy) / (f.drag.len * f.drag.len), 0, 1);
});
function endStage(e, cancel) {
  const f = fold;
  if (!f || !f.drag || e.pointerId !== f.drag.id) return;
  const { moved, holdTimer } = f.drag;
  clearTimeout(holdTimer);
  f.drag = null;
  const held = f.hold;
  f.hold = null;
  if (cancel) { beginFoldAnim(0); return; }
  if (held || !moved) beginFoldAnim(1);
  else beginFoldAnim(f.t > (isPull(f) ? 0.15 : 0.4) ? 1 : 0);
}
stage.addEventListener('pointerup', (e) => endStage(e, false));
stage.addEventListener('pointercancel', (e) => endStage(e, true));

$('#foldGo').addEventListener('click', () => { if (fold && !fold.anim && !fold.finished) { fold.nudge = null; fold.t = 0; beginFoldAnim(1); } });
$('#foldUndo').addEventListener('click', () => {
  const f = fold;
  if (!f || f.anim || f.step === 0) return;
  f.step = f.finished ? f.model.steps.length - 1 : f.step - 1;
  f.finished = false;
  f.finishT = 0;
  f.stack = f.states[f.step];
  f.t = 0;
  f.plan = null;
  touch();
  aimCam(f, performance.now());
  syncFoldUI();
});
$('#choose').addEventListener('click', () => { leaveStage(); renderPicker(); });
$('#again').addEventListener('click', () => { leaveStage(); renderPicker(); window.scrollTo({ top: 0 }); });

// ---- picker
const LEVEL_NOTE = { Easy: 'a few folds', Medium: 'squash and reverse folds', Patient: 'long ones, petal folds' };

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
  for (const level of LEVELS) {
    const list = MODELS.filter((m) => m.level === level);
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.className = 'lvl';
    h.innerHTML = `${level} <span>${LEVEL_NOTE[level]}</span>`;
    grid.appendChild(h);
    const row = document.createElement('div');
    row.className = 'models';
    for (const m of list) {
      const b = document.createElement('button');
      b.className = 'model';
      b.innerHTML = `<canvas width="152" height="152"></canvas><b>${m.name}</b><span>${m.blurb}</span>`;
      b.addEventListener('click', () => {
        if (!selSheet) { note('', 0); makeSample(); }
        startModel(m.id);
      });
      row.appendChild(b);
      drawPreview(b.querySelector('canvas'), m, sheetImg(selSheet));
    }
    grid.appendChild(row);
  }
  renderShelf();
}

function drawPreview(canvas, model, img) {
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const cam = camFor(finishBounds(model), canvas.width, canvas.height, 1.22);
  drawFinished(c, camMatrix({ ...cam }, 1), model, img, { d: canvas.width / 76, blur: 3, dy: 2 });
}

function refreshImages() {
  if (!$('#viewFold').hidden && !fold) renderPicker();
}

$('#sample').addEventListener('click', () => { makeSample(); renderPicker(); });
// Letting a sheet go, or taking a piece down, removes something she made: ask with a second tap.
function armed(btn, label, again) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.textContent = again;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
  return false;
}
$('#recycle').addEventListener('click', () => {
  if (!selSheet) return;
  if (!armed($('#recycle'), 'Let this sheet go', 'Tap again to let it go')) return;
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
  const cam = camFor(finishBounds(model), 240, 240, 1.3);
  drawFinished(g, camMatrix(cam, 1), model, img, { d: 2, blur: 8, dy: 5, alpha: 0.3 });
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
  if (!armed($('#dRemove'), 'Take it down', 'Tap again to take it down')) return;
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
  setTimeout(restoreUI, 0); // after window.__marbling exists
}
function restoreUI() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch { /* fresh */ }
  if (!o || o.tab !== 'fold') return;
  showTab('fold');
  const f0 = o.fold;
  if (!f0 || !getModel(f0.model) || !store.sheets.some((s) => s.id === f0.sheet)) return;
  selSheet = f0.sheet;
  const go = () => {
    startModel(f0.model);
    const n = Math.max(0, Math.min(fold.model.steps.length, Number(f0.step) || 0));
    if (n) window.__marbling.jump(n);
  };
  // the sheet image loads asynchronously; fold as soon as it is there (or straight away without it)
  if (sheetImgs.has(f0.sheet)) go(); else { let tries = 0; const wait = () => (sheetImgs.has(f0.sheet) || tries++ > 40 ? go() : setTimeout(wait, 50)); wait(); }
}
window.addEventListener('resize', () => { dirty = true; });

// handy for tests and poking around from the console
window.__marbling = {
  get bath() { return bath; },
  get fold() { return fold; },
  jump(n) { const f = fold; if (!f) return; f.step = n; f.stack = f.states[n]; f.t = 0; f.plan = null; f.anim = null; f.nudge = null; f.finished = n >= f.model.steps.length; if (f.finished) { f.finishCam = camFor(finishBounds(f.model), f.W, f.H, 1.4); f.cam = f.finishCam; f.finishT = 1; } else { aimCam(f, 0, true); } touch(); syncFoldUI(); },
  setT(t) { if (fold) { fold.t = t; fold.idle = performance.now() + 1e9; } },
  store, paint() { paintBath(bctx, bath, bathCanvas.width); bctx.getImageData(0, 0, 1, 1); }, setTool, startStarter, layPaper, openFold, startModel, showTab,
  get busy() { return busy; }, countVerts: () => countVerts(bath), dropInk: (x, y, r, c) => dropInk(bath, x, y, r, c), applyOp: (op) => applyOp(bath, op), setBath: (b) => { bath = b; dirty = true; },
};
