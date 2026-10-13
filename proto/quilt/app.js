// Quilt designer UI. Geometry, layout, cutting and quilting math live in the
// pure modules next to this file; this file draws and listens.
import * as Stash from '../fabric/stash.js';

const { ensureStarters, fabrics: stashFabrics, onStashChange } = Stash;
import * as K from './blocks.js';
import * as Q from './layout.js';
import * as C from './cutting.js';
import * as P from './quilting.js';

const STORE_KEY = 'tincture.proto.quilt';
const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(3, window.devicePixelRatio || 1);
const MISSING = '#D8CFBD';

const THREADS = [
  { name: 'Cream', hex: '#EFE6D2' }, { name: 'Linen', hex: '#CDBF9F' }, { name: 'Weld gold', hex: '#D9A63A' },
  { name: 'Madder', hex: '#B8433A' }, { name: 'Indigo', hex: '#2C3E66' }, { name: 'Sage', hex: '#8A9A6B' },
  { name: 'Walnut', hex: '#6B4A32' }, { name: 'Charcoal', hex: '#2E2B28' },
];

/* ------------------------------------------------------------------ state */

let store = { v: 1, current: null, saved: [], hintDone: false };
let design = Q.defaultDesign();
let history = [];
let stash = [];
const ui = { tab: 'block', view: 'quilt', tool: 'fill', brush: 'D', edit: 0, joinSel: -1, z: 1, px: 0, py: 0, notice: '', removed: null };

const SESSION_KEY = 'tincture.proto.quilt.session';

/** True if a design can be laid out and cut without throwing. */
function usable(d) {
  try { Q.layoutQuilt(d); C.cuttingPlan(d, (f) => Q.resolveRole(d, f)); return true; } catch { return false; }
}

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && s.v === 1) store = { ...store, ...s, saved: Array.isArray(s.saved) ? s.saved.filter((x) => x && x.design) : [] };
  } catch { /* storage blocked: start fresh */ }
  if (store.current) {
    let d = null;
    try { d = Q.normalizeDesign(store.current); } catch { d = null; }
    if (d && usable(d)) design = d;
    else {
      // Never let a damaged save lock the page: keep a copy, open the sample.
      try { localStorage.setItem(`${STORE_KEY}.rescued`, JSON.stringify(store.current)); } catch { /* full */ }
      store.current = null;
      ui.notice = 'Your last quilt could not be opened, so here is the sample. Your saved quilts are safe.';
    }
  }
  // Undo history and the open tab survive a reload (iOS reloads tabs left in the background).
  try {
    const ss = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (ss && Array.isArray(ss.history)) history = ss.history.filter((x) => typeof x === 'string').slice(-40);
    if (ss && typeof ss.tab === 'string') ui.tab = ss.tab;
  } catch { /* no session storage */ }
}
function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ history: history.slice(-40), tab: ui.tab })); } catch { /* full or blocked */ }
}
function saveStore() {
  store.current = design;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {
    // Too full: keep the newest gallery items.
    while (store.saved.length > 1) {
      store.saved.pop();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return; } catch { /* keep trimming */ }
    }
  }
}

function commit(next, { keep = false } = {}) {
  if (!usable(next)) {
    toast('That change would not lay out, so the quilt stays as it was.');
    return false;
  }
  if (!keep) {
    history.push(JSON.stringify(design));
    if (history.length > 80) history.shift();
  }
  design = next;
  saveStore();
  saveSession();
  invalidate();
  flashMini();
  return true;
}
function undo() {
  if (!history.length) { toast('Nothing to undo yet.'); return; }
  try { design = Q.normalizeDesign(JSON.parse(history.pop())); } catch { /* skip a bad step */ }
  ui.joinSel = -1;
  saveStore();
  saveSession();
  invalidate();
  flashMini();
  toast('Undone.');
}
function syncUndo() {
  for (const id of ['undoBtn', 'dockUndo']) $(id).setAttribute('aria-disabled', String(!history.length));
}
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------------------------------------------------------------- fabrics */

const fabCache = new Map(); // id -> { f, src (canvas|img), w }

function fabricById(id) { return stash.find((f) => f.id === id) || null; }
function fabricName(id) {
  if (K.ROLES.includes(id)) return fabricName(design.palette[id]);
  const f = fabricById(id);
  if (f) return f.name;
  // Taken out of the stash since it was sewn in: keep calling it by its name.
  const gone = fabCache.get(id)?.f.name;
  return gone ? `${gone} (no longer in your stash)` : 'A fabric no longer in your stash';
}
function fabricImg(id) {
  const rid = Q.resolveRole(design, id);
  return fabricById(rid)?.img || '';
}

async function loadFabrics() {
  stash = stashFabrics();
  // Keep palette pointing at real fabrics.
  const ids = new Set(stash.map((f) => f.id));
  for (const r of K.ROLES) if (!ids.has(design.palette[r]) && stash.length) design.palette[r] = stash[K.ROLES.indexOf(r) % stash.length].id;
  await Promise.all(stash.map(async (f) => {
    const have = fabCache.get(f.id);
    if (have && have.f.img === f.img && have.f.repeat === f.repeat) { have.f = f; return; }
    const img = new Image();
    img.src = f.img;
    try { await img.decode(); } catch { return; }
    let src = img;
    if (f.repeat === false) {
      // A one-off piece: mirror it into a 2×2 tile so there are no seams.
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth * 2; cv.height = img.naturalHeight * 2;
      const c = cv.getContext('2d');
      const w = img.naturalWidth, h = img.naturalHeight;
      c.drawImage(img, 0, 0);
      c.save(); c.translate(2 * w, 0); c.scale(-1, 1); c.drawImage(img, 0, 0); c.restore();
      c.save(); c.translate(0, 2 * h); c.scale(1, -1); c.drawImage(img, 0, 0); c.restore();
      c.save(); c.translate(2 * w, 2 * h); c.scale(-1, -1); c.drawImage(img, 0, 0); c.restore();
      src = cv;
    }
    fabCache.set(f.id, { f, src, px: f.repeat === false ? img.naturalWidth : img.naturalWidth, span: f.repeat === false ? 2 : 1 });
  }));
}

const patternCache = new WeakMap();
function patternFor(ctx, id) {
  let m = patternCache.get(ctx);
  if (!m) { m = new Map(); patternCache.set(ctx, m); }
  if (m.has(id)) return m.get(id);
  const fc = fabCache.get(id);
  const pat = fc ? ctx.createPattern(fc.src, 'repeat') : null;
  m.set(id, pat);
  return pat;
}

/** Fills a path with a fabric at true scale. seed varies where each piece was cut. */
function fillFabric(ctx, path, id, seed, off, unmirror) {
  const fc = fabCache.get(id);
  const pat = fc && patternFor(ctx, id);
  if (!pat) { ctx.fillStyle = fabricById(id)?.color || MISSING; ctx.fill(path); return; }
  const inches = fc.f.inches || 8;
  const k = inches / fc.px; // inches per image pixel
  const ox = Q.hash3(seed, 'x', id) * inches * fc.span + (off ? off[0] : 0);
  const oy = Q.hash3(seed, 'y', id) * inches * fc.span + (off ? off[1] : 0);
  let m = new DOMMatrix();
  if (unmirror) m = m.translate(unmirror.cx, unmirror.cy).scale(unmirror.sx, unmirror.sy).translate(-unmirror.cx, -unmirror.cy);
  m = m.translate(ox, oy).scale(k, k);
  pat.setTransform(m);
  ctx.fillStyle = pat;
  ctx.fill(path);
}

function polyPath(pts) {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}

/* ------------------------------------------------------------- drawing */

let resolver = (f) => Q.resolveRole(design, f);
function refreshResolver() { resolver = Q.makeResolver(design, stash); }

/** Draws one block in its own frame (0..B inches), already transformed. */
function drawBlockLocal(ctx, block, B, inst, opts = {}) {
  const k = B / block.n;
  const seam = opts.seam ?? 0.035;
  const unmirror = inst && (inst.mirrorX || inst.mirrorY) ? { cx: B / 2, cy: B / 2, sx: inst.mirrorX ? -1 : 1, sy: inst.mirrorY ? -1 : 1 } : null;
  const patches = K.blockPatches(block);
  const paths = [];
  for (const p of patches) {
    const path = polyPath(p.pts.map(([x, y]) => [x * k, y * k]));
    paths.push(path);
    const unit = block.units[p.unit];
    const id = opts.resolve ? opts.resolve(p.fill) : resolver(p.fill, inst ? inst.i : -1);
    fillFabric(ctx, path, id, `${inst ? inst.i : 'e'}-${p.unit}-${p.patch}`, unit.off?.[p.patch], unmirror);
  }
  if (seam > 0) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(52,36,20,.26)';
    ctx.lineWidth = seam;
    for (const path of paths) ctx.stroke(path);
  }
}

function drawPieces(ctx, layout, seam) {
  for (const p of layout.pieces) {
    const path = polyPath(p.pts);
    fillFabric(ctx, path, resolver(p.fill, -1), `${p.kind}-${p.pts[0][0].toFixed(2)}-${p.pts[0][1].toFixed(2)}`, null, null);
    ctx.strokeStyle = 'rgba(52,36,20,.24)';
    ctx.lineWidth = seam;
    ctx.stroke(path);
  }
}

/**
 * What the quilting depends on. Fabrics do not move stitches, so sewing a new
 * fabric into a patch never recomputes them; only the pattern, the quilt's
 * size and (for ditch and echo) the piecing geometry do.
 */
function quiltingKey(layout) {
  const q = design.quilting || {};
  const key = [q.pattern, q.spacing, q.border, layout.w, layout.h, design.borders.map((b) => b.w)];
  if (['ditch', 'echo', 'curves', 'sqsq'].includes(q.pattern)) {
    const geo = (b) => [b.n, b.units.map((u) => [u.x, u.y, u.w, u.h, u.t, u.rot, u.flip])];
    key.push(design.size, design.rows, design.cols, design.setting, design.alt, design.sash.w, design.sash.outer,
      design.rotate, design.mirror, design.blocks.map(geo));
  }
  return JSON.stringify(key);
}
/**
 * Polylines to Path2D, in batches: one path holding thousands of small
 * closed shapes (pebbles, curves in every patch) strokes many times slower
 * than the same shapes split into a few hundred paths.
 */
function toPath(paths, batch = 2500) {
  const out = [];
  let path = new Path2D();
  let inPath = 0;
  let count = 0;
  for (const pl of paths) {
    const pts = pl.pts;
    if (pts.length < 2) continue;
    count += pts.length;
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    if (pl.closed) path.closePath();
    inPath += pts.length;
    if (inPath >= batch) { out.push(path); path = new Path2D(); inPath = 0; }
  }
  if (inPath) out.push(path);
  return { path: out, count };
}
let qPath = { key: '', center: null, border: null, clip: null, count: 0 };
function quiltingPath(layout) {
  const key = quiltingKey(layout);
  if (qPath.key === key) return qPath;
  const l = P.quiltingLayers(design, layout, design.quilting);
  const c = toPath(l.center);
  const b = toPath(l.border);
  qPath = { key, center: c.path, border: b.count ? b.path : null, clip: l.clip, count: c.count + b.count };
  return qPath;
}

function drawQuilting(ctx, layout, k) {
  const q = design.quilting;
  if (!q || q.pattern === 'none') return;
  const { center, border, clip, count } = quiltingPath(layout);
  const inner = new Path2D();
  // Stitches stop at the binding.
  inner.rect(0.375, 0.375, layout.w - 0.75, layout.h - 0.75);
  if (clip) {
    const c = new Path2D(); c.rect(clip.x, clip.y, clip.w, clip.h);
    stitch(ctx, center, c, q, count, k);
    if (border) {
      const ring = new Path2D(); ring.rect(0.375, 0.375, layout.w - 0.75, layout.h - 0.75); ring.rect(clip.x, clip.y, clip.w, clip.h);
      stitch(ctx, border, ring, q, count, k, 'evenodd');
    }
  } else stitch(ctx, center, inner, q, count, k);
}

function stitch(ctx, path, clipPath, q, count, k, rule = 'nonzero') {
  const px = 1 / k; // one device pixel in inches
  ctx.save();
  ctx.clip(clipPath, rule);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // The batting puffs up between the lines; the stitches sink in. Dense
  // quilting gets one soft shadow pass instead of three (it is the same look
  // at that density, at a third of the cost).
  const ditch = q.pattern === 'ditch';
  const puff = count > 60000 ? [[0.3, 0.12]] : [[0.42, 0.045], [0.26, 0.06], [0.13, 0.08]];
  for (const [w, a] of puff) {
    ctx.strokeStyle = `rgba(40,24,8,${a * (ditch ? 1.3 : 1)})`;
    ctx.lineWidth = Math.max(w, px * 1.2);
    for (const pp of path) ctx.stroke(pp);
  }
  ctx.save();
  ctx.translate(-Math.max(0.05, px), -Math.max(0.05, px));
  ctx.strokeStyle = 'rgba(255,252,240,.16)';
  ctx.lineWidth = Math.max(0.09, px);
  for (const pp of path) ctx.stroke(pp);
  ctx.restore();
  // The thread
  ctx.strokeStyle = q.thread || '#EFE6D2';
  ctx.globalAlpha = ditch ? 0.35 : 0.92;
  ctx.lineWidth = Math.max(0.035, px * 0.9);
  if (k > 14) ctx.setLineDash([0.12, 0.045]);
  for (const pp of path) ctx.stroke(pp);
  ctx.restore();
}

function drawBinding(ctx, layout, k) {
  const bw = 0.375;
  const p = new Path2D();
  p.rect(0, 0, layout.w, layout.h);
  p.rect(bw, bw, layout.w - 2 * bw, layout.h - 2 * bw);
  ctx.save();
  ctx.clip(p, 'evenodd');
  const outer = new Path2D(); outer.rect(0, 0, layout.w, layout.h);
  fillFabric(ctx, outer, resolver(design.binding, -1), 'binding', null, null);
  // Rolled edge: light on the outside, a shadow where it meets the quilt.
  const g = ctx.createLinearGradient(0, 0, bw, 0);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(40,24,8,.28)';
  ctx.lineWidth = Math.max(0.05, 1 / k);
  ctx.strokeRect(bw, bw, layout.w - 2 * bw, layout.h - 2 * bw);
  ctx.strokeStyle = 'rgba(255,250,235,.22)';
  ctx.lineWidth = Math.max(0.06, 1 / k);
  ctx.strokeRect(0.08, 0.08, layout.w - 0.16, layout.h - 0.16);
  ctx.restore();
  void g;
}

/** Renders the whole quilt into ctx at k px per inch (ctx untransformed). */
function renderQuilt(ctx, k, { quilting = true, base = true } = {}) {
  if (!base) {
    const layout = Q.layoutQuilt(design);
    ctx.save(); ctx.scale(k, k); drawQuilting(ctx, layout, k); ctx.restore();
    return layout;
  }
  const layout = Q.layoutQuilt(design);
  ctx.save();
  ctx.scale(k, k);
  const seam = Math.max(0.03, 0.7 / k);
  drawPieces(ctx, layout, seam);
  for (const inst of layout.blocks) {
    if (inst.kind !== 'block') continue;
    const block = design.blocks[inst.which] || design.blocks[0];
    const B = inst.size;
    ctx.save();
    ctx.translate(inst.cx, inst.cy);
    ctx.rotate((inst.angle * Math.PI) / 180);
    ctx.rotate((inst.rot * Math.PI) / 2);
    ctx.scale(inst.mirrorX ? -1 : 1, inst.mirrorY ? -1 : 1);
    ctx.translate(-B / 2, -B / 2);
    drawBlockLocal(ctx, block, B, inst, { seam });
    ctx.restore();
  }
  drawBinding(ctx, layout, k);
  if (quilting) drawQuilting(ctx, layout, k);
  // A whisper of light across the cloth.
  const g = ctx.createLinearGradient(0, 0, layout.w, layout.h);
  g.addColorStop(0, 'rgba(255,248,230,.07)');
  g.addColorStop(1, 'rgba(40,24,8,.07)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, layout.w, layout.h);
  ctx.restore();
  return layout;
}

/* --------------------------------------------------- the quilt view */

const qc = $('quilt');
const qbox = $('quiltBox');
// Two layers: the patchwork, and the quilting stitched over it. Sewing a new
// fabric into a patch redraws only the patchwork; the stitches (the costly
// part on a big quilt) are redrawn only when they themselves change.
const off = document.createElement('canvas');
const offQ = document.createElement('canvas');
let offK = 0;
let offDirty = true;
let layoutCache = null;
let stitchedKey = ''; // what offQ holds: quilting key @ k
let stitchedQ = ''; // ... and the quilting key alone
let stitchTimer = 0;
let lastStitchMs = 0;
let hiResTimer = 0;
let lastZoomAt = 0;
let gestureActive = false;
// Under iOS Safari's canvas size limit, leaving room for the export canvas.
const MAX_SIDE = 3072;

function boxSize() { return { w: qbox.clientWidth, h: qbox.clientHeight }; }
function fitK() {
  const { w, h } = boxSize();
  const s = Q.quiltSize(design);
  return Math.min((w - 28) / s.w, (h - 28) / s.h);
}

function renderOff(k) {
  const s = Q.quiltSize(design);
  k = Math.min(k, MAX_SIDE / Math.max(s.w, s.h));
  off.width = Math.ceil(s.w * k);
  off.height = Math.ceil(s.h * k);
  const ctx = off.getContext('2d');
  ctx.clearRect(0, 0, off.width, off.height);
  offK = k;
  offDirty = false; // before drawing: a failure must not retry every frame
  layoutCache = renderQuilt(ctx, k, { quilting: false });
}

function quiltingNow() {
  const layout = layoutCache || Q.layoutQuilt(design);
  const q = design.quilting?.pattern === 'none' ? 'none' : quiltingKey(layout);
  return { q, key: `${q}@${offK}` };
}

function renderStitches() {
  stitchTimer = 0;
  if (gestureActive) { stitchTimer = setTimeout(renderStitches, 200); return; }
  const { q, key } = quiltingNow();
  if (stitchedKey === key) return;
  const t0 = performance.now();
  try {
    offQ.width = off.width;
    offQ.height = off.height;
    const ctx = offQ.getContext('2d');
    ctx.clearRect(0, 0, offQ.width, offQ.height);
    if (q !== 'none') renderQuilt(ctx, offK, { base: false });
  } catch (err) {
    console.error(err);
  } finally {
    // Recorded even after a failure, so a bad pattern is never retried in a loop.
    stitchedKey = key;
    stitchedQ = q;
    lastStitchMs = performance.now() - t0;
    $('stitchTag').hidden = true;
    schedule();
  }
}

let raf = 0;
function invalidate() {
  offDirty = true;
  refreshResolver();
  schedule();
  renderPanels();
}
function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    try { drawView(); } catch (err) { console.error(err); }
  });
}

function sizeBox() {
  const s = Q.quiltSize(design);
  const w = qbox.clientWidth || 360;
  const want = Math.round(Math.max(300, Math.min(window.innerHeight * 0.66, 560, w * (s.h / s.w) + 28)));
  if (Math.abs(qbox.clientHeight - want) > 1) qbox.style.height = `${want}px`;
}

function drawView() {
  sizeBox();
  const { w, h } = boxSize();
  if (qc.width !== Math.round(w * DPR) || qc.height !== Math.round(h * DPR)) { qc.width = Math.round(w * DPR); qc.height = Math.round(h * DPR); }
  const k = fitK() * ui.z;
  const want = k * DPR;
  const base = Math.max(want, fitK() * DPR * 1.5);
  if (offDirty) renderOff(base);
  else if (want > offK * 1.15 + 0.01) {
    // Sharpen after the pinch settles, not on every step of it.
    if (gestureActive || performance.now() - lastZoomAt < 180) {
      clearTimeout(hiResTimer);
      hiResTimer = setTimeout(() => { hiResTimer = 0; schedule(); }, 220);
    } else renderOff(base);
  }
  const s = Q.quiltSize(design);
  const ctx = qc.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, w, h);
  clampPan();
  const qw = s.w * k;
  const qh = s.h * k;
  const x = (w - qw) / 2 + ui.px;
  const y = (h - qh) / 2 + ui.py;
  ctx.save();
  ctx.shadowColor = 'rgba(42,30,18,.28)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x, y, qw, qh);
  ctx.restore();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, x, y, qw, qh);
  const now = quiltingNow();
  // Stitches of the same pattern at another zoom are still right, just softer.
  if (stitchedQ === now.q && now.q !== 'none' && offQ.width) ctx.drawImage(offQ, x, y, qw, qh);
  if (stitchedKey !== now.key) {
    if (stitchedQ !== now.q && lastStitchMs > 120) $('stitchTag').hidden = false;
    if (!stitchTimer) stitchTimer = setTimeout(renderStitches, 30);
  }
  const zoomed = ui.z > 1.01;
  qbox.classList.toggle('zoomed', zoomed);
  $('zoomHint').textContent = zoomed ? 'Drag to look around. Fit shows the whole quilt.' : 'Pinch or double-tap to look closer.';
  drawMini();
}

function clampPan() {
  const { w, h } = boxSize();
  const s = Q.quiltSize(design);
  const k = fitK() * ui.z;
  const mx = Math.max(0, (s.w * k - w) / 2 + 30);
  const my = Math.max(0, (s.h * k - h) / 2 + 30);
  ui.px = Math.max(-mx, Math.min(mx, ui.px));
  ui.py = Math.max(-my, Math.min(my, ui.py));
}

function zoomAt(f, cx, cy) {
  const { w, h } = boxSize();
  const z0 = ui.z;
  const z1 = Math.max(1, Math.min(10, z0 * f));
  // keep the point under (cx,cy) fixed
  const ox = cx - w / 2 - ui.px;
  const oy = cy - h / 2 - ui.py;
  ui.px -= ox * (z1 / z0 - 1);
  ui.py -= oy * (z1 / z0 - 1);
  ui.z = z1;
  if (ui.z <= 1.001) { ui.px = 0; ui.py = 0; }
  lastZoomAt = performance.now();
  // Looking closer means up close: stand back is a whole-quilt view.
  if (ui.z > 1.01 && ui.view === 'back') setView('quilt');
  schedule();
}

(function quiltGestures() {
  const pts = new Map();
  let last = null;
  let down = null; // a one-finger touch that may still be a tap
  let lastTap = null;
  qbox.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ui.z > 1.01 || pts.size > 1) { try { qbox.setPointerCapture(e.pointerId); } catch { /* already gone */ } }
    last = null;
    gestureActive = true;
    down = pts.size === 1 ? { t: e.timeStamp, x: e.clientX, y: e.clientY, moved: false } : null;
    if (pts.size > 1) lastTap = null;
  });
  qbox.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.moved = true;
    const arr = [...pts.values()];
    const r = qbox.getBoundingClientRect();
    if (arr.length >= 2) {
      const [a, b] = arr;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      if (last && last.d) {
        zoomAt(d / last.d, m.x, m.y);
        ui.px += m.x - last.m.x; ui.py += m.y - last.m.y;
      }
      last = { d, m };
    } else if (ui.z > 1.01) {
      const a = arr[0];
      if (last && last.p) { ui.px += a.x - last.p.x; ui.py += a.y - last.p.y; schedule(); }
      last = { p: a };
    }
  });
  const end = (e) => {
    const had = pts.delete(e.pointerId);
    last = null;
    // A double tap is two real taps close together: a quick flick to scroll
    // the page (which the browser cancels) never counts, so scrolling past
    // the quilt can't zoom it by surprise.
    if (e.type === 'pointerup' && had && down && !down.moved && !pts.size && e.timeStamp - down.t < 350) {
      const tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (lastTap && tap.t - lastTap.t < 380 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40) {
        const r = qbox.getBoundingClientRect();
        zoomAt(ui.z > 1.5 ? 1 / ui.z : 2.5, tap.x - r.left, tap.y - r.top);
        lastTap = null;
      } else lastTap = tap;
    } else if (e.type === 'pointercancel' || (down && down.moved)) lastTap = null;
    down = null;
    if (!pts.size) { gestureActive = false; schedule(); }
  };
  qbox.addEventListener('pointerup', end);
  qbox.addEventListener('pointercancel', end);
  qbox.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = qbox.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('zIn').onclick = () => { const { w, h } = boxSize(); zoomAt(1.6, w / 2, h / 2); };
  $('zOut').onclick = () => { const { w, h } = boxSize(); zoomAt(1 / 1.6, w / 2, h / 2); };
  $('zFit').onclick = () => { ui.z = 1; ui.px = 0; ui.py = 0; schedule(); };
}());

function setView(v) {
  ui.view = v;
  for (const x of $('viewSeg').children) x.setAttribute('aria-pressed', String(x.dataset.v === v));
  qbox.classList.toggle('back', v === 'back');
  qbox.classList.toggle('value', v === 'value');
  $('viewTag').textContent = v === 'back' ? 'From across the room' : 'Value only: lights and darks';
  if (v === 'back') { ui.z = 1; ui.px = 0; ui.py = 0; }
  schedule();
}
$('viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setView(b.dataset.v);
});

/* ------------------------------------------- the quilt, kept in view */

// When the quilt scrolls out of sight (every control lives below it), a small
// live copy docks at the bottom with Undo, so each change shows where it
// lands. Tapping it goes back up to the quilt and the tabs.
const dock = $('dock');
const mini = $('mini');
let quiltSeen = true;
let miniFlash = 0;
function drawMini() {
  if (dock.hidden || !off.width) return;
  const s = Q.quiltSize(design);
  // As big as a phone can spare (about a seventh of the screen), so a
  // secondary pattern from a turn or mirror can actually be seen down here.
  const H = Math.round(Math.max(76, Math.min(124, window.innerHeight * 0.15)));
  const W = Math.max(40, Math.min(170, Math.round((H * s.w) / s.h)));
  document.documentElement.style.setProperty('--dockH', `${H + 14}px`);
  const hh = Math.round(Math.min(H, (W * s.h) / s.w));
  if (mini.width !== W * DPR || mini.height !== hh * DPR) {
    mini.width = W * DPR; mini.height = hh * DPR;
    mini.style.width = `${W}px`; mini.style.height = `${hh}px`;
  }
  const c = mini.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, mini.width, mini.height);
  c.imageSmoothingQuality = 'high';
  c.drawImage(off, 0, 0, mini.width, mini.height);
  if (stitchedQ === quiltingNow().q && offQ.width) c.drawImage(offQ, 0, 0, mini.width, mini.height);
  mini.classList.toggle('value', ui.view === 'value');
}
function setDock(show) {
  dock.hidden = !show;
  document.body.classList.toggle('docked', show);
  if (show) { $('dockCap').textContent = $('quiltCaption').textContent.split(' · ').slice(0, 2).join(' · '); drawMini(); }
}
function flashMini() {
  if (dock.hidden || reduceMotion) return;
  mini.classList.remove('flash');
  void mini.offsetWidth;
  mini.classList.add('flash');
  clearTimeout(miniFlash);
  miniFlash = setTimeout(() => mini.classList.remove('flash'), 500);
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    for (const en of entries) quiltSeen = en.intersectionRatio > 0.35;
    setDock(!quiltSeen);
  }, { threshold: [0, 0.2, 0.35, 0.5, 1] }).observe(qbox);
}
$('dockQuilt').onclick = () => {
  $('quiltCard').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
};
$('dockUndo').onclick = undo;

function caption() {
  const s = Q.quiltSize(design);
  const layout = Q.layoutQuilt(design);
  const counts = Q.blockCounts(layout);
  const names = [design.blocks[0].name];
  const parts = [`${counts.pieced[0]} ${design.blocks[0].name}`];
  if (counts.pieced[1]) { parts.push(`${counts.pieced[1]} ${design.blocks[1].name}`); names.push(design.blocks[1].name); }
  if (counts.plain) parts.push(`${counts.plain} plain`);
  $('quiltCaption').innerHTML = `<b>${C.fmtFrac(s.w)} × ${C.fmtFrac(s.h)} in</b> finished · ${Q.sizeName(s.w, s.h)} · ${parts.join(', ')} block${counts.total > 1 ? 's' : ''} at ${design.size}"`;
}

/* -------------------------------------------------------- block editor */

const bc = $('blockCv');
let blockPx = 300;
let pending = null; // fussy drag state

function editBlock() { return design.blocks[ui.edit] || design.blocks[0]; }

function drawEditor() {
  const rect = $('blockWrap').getBoundingClientRect();
  blockPx = Math.max(200, Math.round(rect.width || 300));
  const px = Math.round(blockPx * DPR);
  if (bc.width !== px) { bc.width = px; bc.height = px; }
  const ctx = bc.getContext('2d');
  const block = editBlock();
  const B = design.size;
  const k = px / B;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  ctx.save();
  ctx.scale(k, k);
  drawBlockLocal(ctx, block, B, null, { seam: 1.4 / k, resolve: (f) => Q.resolveRole(design, f) });
  // Unit outlines and grid
  const cell = B / block.n;
  ctx.lineWidth = 2.2 / k;
  ctx.strokeStyle = 'rgba(251,248,241,.55)';
  for (const u of block.units) ctx.strokeRect(u.x * cell, u.y * cell, u.w * cell, u.h * cell);
  ctx.setLineDash([4 / k, 4 / k]);
  ctx.lineWidth = 1 / k;
  ctx.strokeStyle = 'rgba(42,38,34,.35)';
  for (const u of block.units) ctx.strokeRect(u.x * cell, u.y * cell, u.w * cell, u.h * cell);
  ctx.setLineDash([]);
  if (ui.press && block.units[ui.press.unit]) {
    // Immediate acknowledgement under the finger, before the tap resolves.
    const pp = K.blockPatches(block).find((q) => q.unit === ui.press.unit && q.patch === ui.press.patch);
    if (pp) {
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = 'rgba(251,248,241,.95)';
      ctx.stroke(polyPath(pp.pts.map(([x, y]) => [x * cell, y * cell])));
    }
  }
  if (ui.tool === 'join' && ui.joinSel >= 0 && block.units[ui.joinSel]) {
    const u = block.units[ui.joinSel];
    ctx.lineWidth = 4 / k;
    ctx.strokeStyle = '#E2B04A';
    ctx.strokeRect(u.x * cell + 2 / k, u.y * cell + 2 / k, u.w * cell - 4 / k, u.h * cell - 4 / k);
  }
  ctx.restore();
}

function hitPatch(e) {
  const r = bc.getBoundingClientRect();
  const block = editBlock();
  const x = ((e.clientX - r.left) / r.width) * block.n;
  const y = ((e.clientY - r.top) / r.height) * block.n;
  const patches = K.blockPatches(block);
  for (let i = patches.length - 1; i >= 0; i--) if (K.pointInPoly([x, y], patches[i].pts)) return { ...patches[i], x, y };
  const ui2 = K.unitAt(block, Math.floor(x), Math.floor(y));
  return ui2 >= 0 ? { unit: ui2, patch: 0, x, y } : null;
}

function withBlock(fn, opts) {
  const d = clone(design);
  const b = d.blocks[ui.edit];
  const nb = fn(b);
  if (!nb) return false;
  d.blocks[ui.edit] = nb;
  commit(d, opts);
  return true;
}

// Touch model. The block fills most of a phone's width, so a swipe that
// starts on it must still scroll the page: every tool acts on a tap (finger
// down and up without travelling), Fabric also paints along a sideways drag,
// and only Fussy (which needs to drag any way) holds the page still.
const SLOP = 10;
function setTool(t) {
  ui.tool = t;
  ui.joinSel = -1;
  for (const x of $('toolSeg').children) x.setAttribute('aria-pressed', String(x.dataset.t === t));
  bc.style.touchAction = t === 'fussy' ? 'none' : 'pan-y';
  $('brushes').classList.toggle('idle', t !== 'fill');
  toolHint();
  brushLabel();
  drawEditor();
}

function tapAction(hit) {
  const t = ui.tool;
  if (t === 'fill') paintAt(hit, false);
  else if (t === 'shape') {
    withBlock((b) => { b.units[hit.unit] = K.nextShape(b.units[hit.unit]); return b; });
    toolHint(`${K.SHAPES[editBlock().units[hit.unit].t].name}. Tap again for the next shape.`);
  } else if (t === 'turn') {
    withBlock((b) => { b.units[hit.unit] = K.turnUnit(b.units[hit.unit]); return b; });
    toolHint('Turned a quarter. Tap again to keep turning.');
  } else if (t === 'join') {
    const block = editBlock();
    if (ui.joinSel < 0) {
      ui.joinSel = hit.unit;
      const u = block.units[hit.unit];
      toolHint(u.w * u.h > 1 ? 'Tap a neighbor to join it, or the same unit again to split it.' : 'Now tap a neighbor to join them.');
      drawEditor();
    } else if (ui.joinSel === hit.unit) {
      const ok = withBlock((b) => K.splitUnit(b, hit.unit));
      ui.joinSel = -1;
      toolHint(ok ? 'Split back into squares.' : 'That one is a single square already. Pick a unit, then a neighbor to join them.');
      drawEditor();
    } else {
      const sel = ui.joinSel;
      ui.joinSel = -1;
      const ok = withBlock((b) => K.joinUnits(b, sel, hit.unit));
      toolHint(ok ? 'Joined. Two squares side by side make a flying geese unit.' : 'Those two make an L, not a rectangle. Pick a unit, then a neighbor beside it.');
      drawEditor();
    }
  }
}

bc.addEventListener('pointerdown', (e) => {
  if (pending) return; // a second finger: ignore it
  const hit = hitPatch(e);
  if (!hit) return;
  ui.press = hit;
  drawEditor();
  if (ui.tool === 'fussy') {
    try { bc.setPointerCapture(e.pointerId); } catch { /* gone */ }
    pending = { id: e.pointerId, mode: 'fussy', unit: hit.unit, patch: hit.patch, x: e.clientX, y: e.clientY, started: false };
  } else {
    pending = { id: e.pointerId, mode: 'tap', hit, x0: e.clientX, y0: e.clientY, mouse: e.pointerType === 'mouse' };
  }
});
bc.addEventListener('pointermove', (e) => {
  if (!pending || e.pointerId !== pending.id) return;
  if (pending.mode === 'tap') {
    const dx = e.clientX - pending.x0;
    const dy = e.clientY - pending.y0;
    if (Math.hypot(dx, dy) < SLOP) return;
    if (ui.tool === 'fill' && (pending.mouse || Math.abs(dx) > Math.abs(dy))) {
      // A sideways drag with Fabric: sew along it, as one undo step.
      try { bc.setPointerCapture(e.pointerId); } catch { /* gone */ }
      paintAt(pending.hit, false);
      pending = { id: e.pointerId, mode: 'paint' };
    } else {
      pending = null; // the page is scrolling
      ui.press = null;
      drawEditor();
      return;
    }
  }
  if (pending.mode === 'paint') {
    const hit = hitPatch(e);
    if (hit) paintAt(hit, true);
  } else if (pending.mode === 'fussy') {
    const r = bc.getBoundingClientRect();
    const inPerPx = design.size / r.width;
    const dx = (e.clientX - pending.x) * inPerPx;
    const dy = (e.clientY - pending.y) * inPerPx;
    pending.x = e.clientX; pending.y = e.clientY;
    const first = !pending.started;
    pending.started = true;
    const d = first ? clone(design) : design;
    const u = d.blocks[ui.edit].units[pending.unit];
    if (!u.off) u.off = [];
    const o = u.off[pending.patch] || [0, 0];
    u.off[pending.patch] = [o[0] + dx, o[1] + dy];
    if (first) commit(d); else { offDirty = true; drawEditor(); schedule(); }
  }
});
bc.addEventListener('pointerup', (e) => {
  const p = pending;
  if (!p || e.pointerId !== p.id) return;
  pending = null;
  ui.press = null;
  try {
    if (p.mode === 'tap') tapAction(p.hit);
    else if (p.mode === 'fussy' && p.started) { saveStore(); invalidate(); }
  } finally { drawEditor(); }
});
bc.addEventListener('pointercancel', (e) => {
  if (pending && e.pointerId !== pending.id) return;
  if (pending?.mode === 'fussy' && pending.started) { saveStore(); invalidate(); }
  pending = null;
  ui.press = null;
  drawEditor();
});

function paintAt(hit, dragging) {
  const block = editBlock();
  const u = block.units[hit.unit];
  if (!u || u.f[hit.patch] === ui.brush) return;
  if (dragging) {
    // one undo step per stroke
    u.f[hit.patch] = ui.brush;
    saveStore();
    invalidate();
  } else {
    withBlock((b) => { b.units[hit.unit].f[hit.patch] = ui.brush; return b; });
  }
}

const TOOL_HINTS = {
  fill: 'Tap a patch to sew in the fabric you picked, or drag sideways across a row.',
  shape: 'Tap a unit to change its shape: square, half-square triangle, quarter-square, and more.',
  turn: 'Tap a unit to give it a quarter turn.',
  join: 'Tap a unit, then a neighbor, to join them into one bigger piece. Tap a joined unit twice to split it.',
  fussy: 'Fussy cut: drag inside a patch to slide the fabric, so the motif you love lands in the middle. The page holds still while this tool is on.',
};
function toolHint(t) { $('toolHint').textContent = t || TOOL_HINTS[ui.tool]; }

/** Says, in words, which fabric a tap sews (the chips alone are just colors). */
function brushLabel() {
  const el = $('brushLabel');
  const role = K.ROLES.includes(ui.brush);
  const name = `${role ? `${K.ROLE_NAMES[ui.brush]}: ` : ''}${fabricName(ui.brush)}`;
  el.innerHTML = '';
  if (ui.tool === 'fill') el.append('Sewing with ', Object.assign(document.createElement('b'), { textContent: name }));
  else el.append(`${$('toolSeg').querySelector('[aria-pressed="true"]')?.textContent || ''} tool on. Pick a fabric to sew again.`);
}

$('toolSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setTool(b.dataset.t);
});
$('whichSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  ui.edit = Number(b.dataset.w);
  ui.joinSel = -1;
  renderBlockPanel();
});
$('undoBtn').onclick = undo;
$('libBtn').onclick = openLibrary;

function renderGridSeg() {
  const seg = $('gridSeg');
  seg.innerHTML = '';
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const b = document.createElement('button');
    b.textContent = String(n);
    b.setAttribute('aria-label', `Fresh ${n} by ${n} grid`);
    b.setAttribute('aria-pressed', String(editBlock().n === n && editBlock().from === undefined));
    b.onclick = () => {
      withBlock(() => K.plainGrid(n, 'L'));
      toast(`A fresh ${n} × ${n} grid. Undo brings the old block back.`);
    };
    seg.append(b);
  }
}

function brushChip(fill, label) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.style.backgroundImage = `url(${fabricImg(fill)})`;
  b.setAttribute('aria-pressed', String(ui.brush === fill));
  b.setAttribute('aria-label', `${label ? K.ROLE_NAMES[fill] + ': ' : ''}${fabricName(fill)}`);
  if (label) { const s = document.createElement('span'); s.className = 'badge'; s.textContent = label; b.append(s); }
  b.onclick = () => {
    ui.brush = fill;
    if (ui.tool !== 'fill') setTool('fill');
    toolHint(`${label ? K.ROLE_NAMES[fill] + ' — ' : ''}${fabricName(fill)}. Tap a patch to sew it in.`);
    renderBrushes();
    brushLabel();
  };
  return b;
}

/** When every fabric has been let go: say so, and offer the way back. */
function emptyStash() {
  const box = el('div', { class: 'note' }, el('p', { style: 'margin:0 0 6px', text: 'Your stash is empty, so the quilt shows plain stand-ins. Dye some fabrics, or bring the starter fabrics back.' }));
  const row = el('div', { class: 'row' });
  if (typeof Stash.restoreStarters === 'function') {
    row.append(el('button', { class: 'btn small', text: 'Bring back the starters', onclick: async () => {
      Stash.restoreStarters();
      try { await loadFabrics(); } catch (err) { console.error(err); }
      invalidate();
      toast('The starter fabrics are back in your stash.');
    } }));
  }
  row.append(el('a', { class: 'linkbtn', href: '../dye/', text: 'Dye fabrics →' }));
  box.append(row);
  return box;
}

function renderBrushes() {
  const el = $('brushes');
  const sl = el.scrollLeft;
  el.innerHTML = '';
  for (const r of K.ROLES) el.append(brushChip(r, r));
  const sep = document.createElement('span'); sep.className = 'chip sep'; el.append(sep);
  for (const f of stash) el.append(brushChip(f.id, ''));
  el.scrollLeft = sl;
  el.classList.toggle('idle', ui.tool !== 'fill');
}

function renderBlockPanel() {
  // Block 2 only exists in the quilt with "Every other block: Block 2";
  // never leave the editor on a block the quilt doesn't show.
  if (design.alt !== 'block2' && ui.edit !== 0) { ui.edit = 0; ui.joinSel = -1; }
  const b = editBlock();
  $('blockName').textContent = b.name;
  const cell = design.size / b.n;
  $('blockMeta').textContent = `${b.n} × ${b.n} grid · ${design.size}" block · ${C.fmtFrac(cell)}" units`;
  syncUndo();
  const ws = $('whichSeg');
  ws.hidden = design.alt !== 'block2';
  for (const x of ws.children) x.setAttribute('aria-pressed', String(Number(x.dataset.w) === ui.edit));
  renderBrushes();
  brushLabel();
  $('stashNote').replaceChildren(...(stash.length ? [] : [emptyStash()]));
  renderGridSeg();
  drawEditor();
}

/* --------------------------------------------------------------- sheets */

function openSheet(build) {
  const inner = $('sheetInner');
  inner.innerHTML = '';
  build(inner);
  $('overlay').classList.add('open');
  $('sheet').classList.add('open');
  $('sheet').scrollTop = 0;
}
function closeSheet() { $('overlay').classList.remove('open'); $('sheet').classList.remove('open'); }
$('overlay').onclick = closeSheet;

function sheetHead(inner, title, sub) {
  const h = document.createElement('div');
  h.className = 'shead';
  h.innerHTML = `<div><h3></h3>${sub ? '<div class="hint"></div>' : ''}</div>`;
  h.querySelector('h3').textContent = title;
  if (sub) h.querySelector('.hint').textContent = sub;
  const x = document.createElement('button');
  x.className = 'btn small'; x.textContent = 'Close'; x.onclick = closeSheet;
  h.append(x);
  inner.append(h);
}

/** Runs fn with another design in place (for drawing previews), then puts yours back. */
function withDesign(d, fn) {
  const keep = design;
  design = d;
  refreshResolver();
  try { return fn(); } finally { design = keep; refreshResolver(); }
}

function openLibrary() {
  openSheet((inner) => {
    sheetHead(inner, 'Block library', 'Traditional blocks in your Light, Medium, Dark and Accent fabrics. Undo brings back the block you had.');
    const blockCard = (item) => {
      const b = document.createElement('button');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 220;
      const ctx = cv.getContext('2d');
      const k = 220 / design.size;
      ctx.scale(k, k);
      drawBlockLocal(ctx, K.libraryBlock(item.id), design.size, null, { seam: 1 / k, resolve: (f) => Q.resolveRole(design, f) });
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = item.name;
      b.append(cv, nm);
      b.title = item.note;
      b.setAttribute('aria-label', `${item.name}: ${item.note}`);
      b.onclick = () => {
        const d = clone(design);
        d.blocks[ui.edit] = K.libraryBlock(item.id);
        if (ui.edit === 0 && d.name && /^(Ohio Star throw|.* quilt)$/.test(d.name)) d.name = `${item.name} quilt`;
        commit(d);
        closeSheet();
        toast(`${item.name}: ${item.note}`);
      };
      return b;
    };
    for (const g of K.GROUPS) {
      inner.append(el('h4', { class: 'libh', text: g.name }));
      const grid = el('div', { class: 'libgrid' });
      for (const id of g.ids) { const item = K.LIBRARY.find((x) => x.id === id); if (item) grid.append(blockCard(item)); }
      inner.append(grid);
    }
    if (ui.edit !== 0) return; // layouts change the whole quilt, so only from the first block
    inner.append(el('h4', { class: 'libh', text: 'Whole-quilt layouts' }));
    inner.append(el('p', { class: 'hint', style: 'margin:0 0 8px', text: 'These set the blocks, the setting and the size together. Your fabrics and borders stay; Undo brings back your quilt.' }));
    const grid = el('div', { class: 'libgrid' });
    for (const pre of Q.LAYOUT_PRESETS) {
      const d = Q.applyPreset(design, pre.id);
      const thumb = { ...d, borders: [] };
      const cv = document.createElement('canvas');
      const s = Q.quiltSize(thumb);
      const k = 220 / Math.max(s.w, s.h);
      cv.width = Math.ceil(s.w * k); cv.height = Math.ceil(s.h * k);
      try { withDesign(thumb, () => renderQuilt(cv.getContext('2d'), k, { quilting: false })); } catch (err) { console.error(err); }
      const b = el('button', { 'aria-label': `${pre.name}: ${pre.note}`, title: pre.note, onclick: () => {
        if (commit(d)) { ui.edit = 0; closeSheet(); toast(`${pre.name}: ${pre.note}`); $('quiltCard').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
      } }, el('span', { class: 'lthumb' }, cv), el('span', { class: 'nm', text: pre.name }));
      grid.append(b);
    }
    inner.append(grid);
  });
}

function openFabricPicker(title, current, onPick, { roles = true } = {}) {
  openSheet((inner) => {
    sheetHead(inner, title);
    const grid = document.createElement('div');
    grid.className = 'stashgrid';
    const add = (fill, name, badge) => {
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', String(current === fill));
      b.innerHTML = '<i class="sw"></i><span class="nm"></span>';
      b.querySelector('.sw').style.backgroundImage = `url(${fabricImg(fill)})`;
      b.querySelector('.nm').textContent = badge ? `${badge} · ${name}` : name;
      b.onclick = () => { closeSheet(); onPick(fill); };
      grid.append(b);
    };
    if (roles) for (const r of K.ROLES) add(r, fabricName(r), K.ROLE_NAMES[r]);
    for (const f of stash) add(f.id, f.name, '');
    inner.append(grid);
    const p = document.createElement('p');
    p.className = 'hint';
    p.innerHTML = 'Want something only you have? <a href="../dye/">Dye your own fabrics &rarr;</a>';
    inner.append(p);
  });
}

function fabButton(fill, onPick, title) {
  const b = document.createElement('button');
  b.className = 'fabbtn';
  b.innerHTML = '<i></i><span></span>';
  b.querySelector('i').style.backgroundImage = `url(${fabricImg(fill)})`;
  b.querySelector('span').textContent = K.ROLES.includes(fill) ? `${K.ROLE_NAMES[fill]}` : fabricName(fill);
  b.setAttribute('aria-label', `${title}: ${fabricName(fill)}`);
  b.onclick = () => openFabricPicker(title, fill, onPick);
  return b;
}

/* ------------------------------------------------------------- panels */

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

function seg(options, value, onPick, label, fill = false) {
  const s = el('div', { class: `seg${fill ? ' fill' : ''}`, role: 'group', 'aria-label': label });
  for (const [v, text] of options) {
    s.append(el('button', { 'aria-pressed': String(v === value), text, onclick: () => onPick(v) }));
  }
  return s;
}

function stepper(value, onStep, label, fmt = String) {
  return el('div', { class: 'stepper' },
    el('button', { 'aria-label': `Fewer ${label}`, text: '−', onclick: () => onStep(-1) }),
    el('output', { text: fmt(value) }),
    el('button', { 'aria-label': `More ${label}`, text: '+', onclick: () => onStep(1) }));
}

function setting(label, ...kids) {
  return el('div', { class: 'setting' }, el('span', { class: 'lbl', text: label }), ...kids);
}

function change(fn) { const d = clone(design); fn(d); commit(d); }

function renderLayout() {
  const p = $('panel-layout');
  p.innerHTML = '';
  const d = design;
  const straight = d.setting === 'straight';
  p.append(el('h2', { text: 'Set the blocks' }));
  p.append(setting('Setting', seg([['straight', 'Straight'], ['onpoint', 'On point']], d.setting, (v) => change((x) => { x.setting = v; }), 'Setting')));
  p.append(el('p', { class: 'hint tip', text: straight ? 'Straight: blocks in rows and columns. On point turns them 45° into diamonds, with setting triangles filling the edges.' : 'On point: blocks turned 45° into diamonds; setting triangles fill the sides and corner triangles the corners.' }));
  const si = Q.BLOCK_SIZES.indexOf(d.size);
  p.append(el('div', { class: 'setting' }, el('span', { class: 'lbl', text: 'Finished block size' }),
    stepper(d.size, (st) => change((x) => { const i = si < 0 ? Q.BLOCK_SIZES.indexOf(12) : si; x.size = Q.BLOCK_SIZES[Math.max(0, Math.min(Q.BLOCK_SIZES.length - 1, i + st))]; }), 'inches', (v) => `${v}"`)));
  p.append(el('p', { class: 'hint tip', text: 'Finished size, as sewn into the quilt; the cutting list adds the seam allowances.' }));
  p.append(setting(straight ? 'Blocks across' : 'Blocks across (on point)', stepper(d.cols, (s) => change((x) => { x.cols = Math.max(1, Math.min(16, x.cols + s)); }), 'columns')));
  p.append(setting(straight ? 'Blocks down' : 'Blocks down (on point)', stepper(d.rows, (s) => change((x) => { x.rows = Math.max(1, Math.min(16, x.rows + s)); }), 'rows')));
  p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Every other block' }),
    seg([['none', 'Same block'], ['plain', 'Plain'], ['block2', 'Block 2']], d.alt, (v) => change((x) => { x.alt = v; }), 'Alternate blocks', true)));
  if (d.alt === 'plain') p.append(setting('Plain block fabric', fabButton(d.altFill, (f) => change((x) => { x.altFill = f; }), 'Plain blocks')));
  if (d.alt === 'block2') {
    p.append(setting('Second block', el('button', { class: 'btn small', text: `${d.blocks[1].name} — change`, onclick: () => { ui.edit = 1; showTab('block'); openLibrary(); } })));
  }
  if (straight) {
    p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Sashing' }),
      seg(Q.SASH_WIDTHS.map((w) => [w, w ? `${C.fmtFrac(w)}"` : 'None']), d.sash.w, (v) => change((x) => { x.sash.w = v; }), 'Sashing width', true),
      el('span', { class: 'hint', text: 'Strips sewn between the blocks. Cornerstones are the small squares where they cross.' })));
    if (d.sash.w) {
      p.append(setting('Sashing', fabButton(d.sash.fill, (f) => change((x) => { x.sash.fill = f; }), 'Sashing')));
      p.append(setting('Cornerstones', fabButton(d.sash.stone, (f) => change((x) => { x.sash.stone = f; }), 'Cornerstones')));
      p.append(setting('Sashing around the outside', seg([[true, 'Yes'], [false, 'No']], d.sash.outer !== false, (v) => change((x) => { x.sash.outer = v; }), 'Outer sashing')));
    }
  } else {
    p.append(setting('Setting triangles', fabButton(d.settingFill, (f) => change((x) => { x.settingFill = f; }), 'Setting and corner triangles')));
  }

  p.append(el('h2', { text: 'Secondary patterns', style: 'margin-top:14px' }));
  p.append(el('p', { class: 'hint', style: 'margin:0 0 6px', text: 'Turn or mirror every other block. Watch the corners where four blocks meet: new stars, chains and pinwheels appear.' }));
  const turn = el('div', { class: 'seg grid3', role: 'group', 'aria-label': 'Turn blocks' });
  for (const [v, text] of [['none', 'None'], ['alt', 'Every other'], ['quad', 'Four ways'], ['barn', 'Barn raising'], ['furrows', 'Furrows'], ['lightning', 'Lightning']]) {
    turn.append(el('button', { 'aria-pressed': String(d.rotate === v), text, onclick: () => change((x) => { x.rotate = v; }) }));
  }
  p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Turn' }), turn,
    el('span', { class: 'hint', text: 'Barn raising, straight furrows and streak of lightning are the classic ways to turn half-square triangles (and log cabins).' })));
  p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Mirror' }),
    seg([['none', 'None'], ['cols', 'Columns'], ['rows', 'Rows'], ['both', 'Both']], d.mirror, (v) => change((x) => { x.mirror = v; }), 'Mirror blocks', true)));

  p.append(el('h2', { text: 'Borders and binding', style: 'margin-top:14px' }));
  d.borders.forEach((b, i) => {
    const wi = Q.BORDER_WIDTHS.indexOf(b.w);
    p.append(el('div', { class: 'setting' },
      el('span', { class: 'lbl', text: `Border ${i + 1}` }),
      el('div', { class: 'row' },
        stepper(b.w, (s) => change((x) => { const j = Math.max(0, Math.min(Q.BORDER_WIDTHS.length - 1, (wi < 0 ? 3 : wi) + s)); x.borders[i].w = Q.BORDER_WIDTHS[j]; }), 'inches', (v) => `${C.fmtFrac(v)}"`),
        fabButton(b.fill, (f) => change((x) => { x.borders[i].fill = f; }), `Border ${i + 1}`),
        el('button', { class: 'linkbtn', text: 'Remove', onclick: () => { change((x) => { x.borders.splice(i, 1); }); toast(`Border ${i + 1} removed. Undo brings it back.`); } }))));
  });
  p.append(el('div', { class: 'row', style: 'margin:8px 0' }, el('button', { class: 'btn small', text: d.borders.length ? 'Add another border' : 'Add a border',
    onclick: () => change((x) => { x.borders.push({ w: x.borders.length ? 4 : 2, fill: x.borders.length ? 'D' : 'L' }); }) })));
  p.append(setting('Binding', fabButton(d.binding, (f) => change((x) => { x.binding = f; }), 'Binding')));
  p.append(el('p', { class: 'hint tip', text: 'Binding is the narrow strip folded over the raw edge to finish the quilt.' }));
}

function renderFabrics() {
  const p = $('panel-fabrics');
  p.innerHTML = '';
  const d = design;
  p.append(el('h2', { text: 'Your values' }));
  p.append(el('p', { class: 'hint', style: 'margin:0 0 6px', text: 'Library blocks place Light, Medium and Dark for you. Change a fabric here and every patch that uses it follows.' }));
  for (const r of K.ROLES) {
    p.append(el('div', { class: 'valrow' }, el('span', { class: 'lbl', html: `${K.ROLE_NAMES[r]}<small>${Q.valueBand(fabricById(d.palette[r])?.color || '#888')} value</small>` }),
      fabButton(d.palette[r], (f) => change((x) => { x.palette[r] = Q.resolveRole(x, f); }), K.ROLE_NAMES[r])));
  }
  const bar = el('div', { class: 'valuebar', 'aria-label': 'Where each fabric sits from dark to light' });
  for (const r of ['L', 'M', 'D']) {
    const f = fabricById(d.palette[r]);
    const v = Q.valueOf(f?.color || '#888');
    bar.append(el('i', { style: `left:${Math.max(3, Math.min(97, v))}%;background:${f?.color || MISSING};color:${v > 55 ? '#2A2622' : '#FBF8F1'}`, text: r }));
  }
  p.append(bar);
  const vL = Q.valueOf(fabricById(d.palette.L)?.color || '#888');
  const vD = Q.valueOf(fabricById(d.palette.D)?.color || '#888');
  p.append(el('p', { class: 'hint', style: 'margin:4px 0 0', text: Math.abs(vL - vD) > 35 ? 'Your light and dark sit far apart: the pattern will read from across the room.' : 'Your light and dark sit close together: a soft, blended look. Try Value view above to see it.' }));

  p.append(el('h2', { text: 'Swap two fabrics', style: 'margin-top:16px' }));
  const used = Q.usedFills(d).map((f) => Q.resolveRole(d, f)).filter((v, i, a) => a.indexOf(v) === i);
  if (!ui.swapA || !used.includes(ui.swapA)) ui.swapA = used[0];
  if (!ui.swapB || !used.includes(ui.swapB) || ui.swapB === ui.swapA) ui.swapB = used.find((x) => x !== ui.swapA) || used[0];
  const pickUsed = (cur, set) => () => openSheet((inner) => {
    sheetHead(inner, 'Fabrics in this quilt');
    const g = el('div', { class: 'stashgrid' });
    for (const id of used) {
      const b = el('button', { 'aria-pressed': String(id === cur) }, el('i', { class: 'sw', style: `background-image:url(${fabricImg(id)})` }), el('span', { class: 'nm', text: fabricName(id) }));
      b.onclick = () => { set(id); closeSheet(); renderFabrics(); };
      g.append(b);
    }
    inner.append(g);
  });
  const fa = el('button', { class: 'fabbtn', onclick: pickUsed(ui.swapA, (v) => { ui.swapA = v; }) }, el('i', { style: `background-image:url(${fabricImg(ui.swapA)})` }), el('span', { text: fabricName(ui.swapA) }));
  const fb = el('button', { class: 'fabbtn', onclick: pickUsed(ui.swapB, (v) => { ui.swapB = v; }) }, el('i', { style: `background-image:url(${fabricImg(ui.swapB)})` }), el('span', { text: fabricName(ui.swapB) }));
  p.append(el('div', { class: 'row' }, fa, el('span', { text: '⇄', 'aria-hidden': 'true', style: 'font-size:20px' }), fb));
  p.append(el('div', { class: 'row' }, el('button', { class: 'btn small primary', text: 'Swap them everywhere', onclick: () => {
    commit(Q.swapFabrics(design, ui.swapA, ui.swapB));
    [ui.swapA, ui.swapB] = [ui.swapB, ui.swapA];
    toast('Swapped. Undo swaps them back.');
  } })));

  p.append(el('h2', { text: 'How the fabrics fall', style: 'margin-top:16px' }));
  const mode = d.rings ? 'rings' : d.scrappy.on ? 'scrappy' : 'planned';
  p.append(el('p', { class: 'hint', style: 'margin:0 0 6px', text: mode === 'rings'
    ? 'Rings: every block takes one fabric by its ring around the center (Dark, Accent, Medium, Accent 2, Light, and round again), as in Trip Around the World.'
    : mode === 'scrappy' ? 'Scrappy: each block draws its own fabric from the same color family in your stash, the way a scrap quilt comes together.'
      : 'Planned: every block uses the fabrics as you placed them.' }));
  p.append(el('div', { class: 'row' },
    seg([['planned', 'Planned'], ['scrappy', 'Scrappy'], ['rings', 'Rings']], mode, (v) => change((x) => { x.scrappy.on = v === 'scrappy'; x.rings = v === 'rings'; if (v === 'rings') x.setting = 'straight'; }), 'How the fabrics fall'),
    d.scrappy.on ? el('button', { class: 'btn small', text: 'Shuffle the scraps', onclick: () => change((x) => { x.scrappy.seed = (x.scrappy.seed || 1) + 1; }) }) : null));

  p.append(el('h2', { text: 'Your stash', style: 'margin-top:16px' }));
  if (!stash.length) p.append(emptyStash());
  const g = el('div', { class: 'stashgrid' });
  for (const f of stash) {
    g.append(el('div', { style: 'text-align:center' }, el('i', { class: 'sw', style: `display:block;background-image:url(${f.img})` }),
      el('span', { class: 'nm', text: `${f.name}${f.inches ? ` · ${C.fmtFrac(f.inches)}" repeat` : ''}` })));
  }
  p.append(g);
  p.append(el('p', { html: '<a href="../dye/">Dye your own fabrics &rarr;</a> New fabrics show up here as soon as they are out of the dye pot.', class: 'hint', style: 'margin-top:10px' }));
}

/* A small picture of each quilting design over four of your blocks, so the
   choice is made by eye (and at the density chosen), not from names. */
const qThumbs = new Map();
function quiltingThumb(pattern, sp, border = 'same', withBorder = false, onlyCached = false) {
  const geo = JSON.stringify([design.size, design.blocks[0].n, design.blocks[0].units.map((u) => [u.x, u.y, u.w, u.h, u.t, u.rot, u.f[0]])]);
  const key = `${pattern}|${sp}|${border}|${withBorder}|${geo}|${design.palette.L}|${design.palette.D}|${design.quilting.thread}`;
  if (qThumbs.has(key)) return qThumbs.get(key);
  if (onlyCached) return null;
  const mini = Q.normalizeDesign({ ...clone(design), rows: 2, cols: 2, setting: 'straight', alt: 'none', rotate: 'none', mirror: 'none', rings: false,
    sash: { ...design.sash, w: 0 }, borders: withBorder ? [{ w: Math.max(3, design.size / 3), fill: 'D' }] : [], quilting: { pattern, spacing: sp, border } });
  const L = Q.layoutQuilt(mini);
  const S = 72;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * DPR;
  const c = cv.getContext('2d');
  const k = (S * DPR) / Math.max(L.w, L.h);
  c.scale(k, k);
  c.fillStyle = '#F7F1E4';
  c.fillRect(0, 0, L.w, L.h);
  c.globalAlpha = 0.45;
  for (const p of [...Q.quiltPatches(mini, L), ...L.pieces]) {
    c.fillStyle = fabricById(Q.resolveRole(mini, p.fill))?.color || MISSING;
    c.fill(polyPath(p.pts));
  }
  c.globalAlpha = 1;
  const l = P.quiltingLayers(mini, L, mini.quilting);
  c.strokeStyle = '#2A2622';
  c.lineWidth = Math.max(0.06, 1.1 / k);
  c.lineJoin = 'round';
  if (pattern !== 'none') for (const pp of [...toPath(l.center).path, ...toPath(l.border).path]) c.stroke(pp);
  const url = cv.toDataURL('image/png');
  if (qThumbs.size > 120) qThumbs.clear();
  qThumbs.set(key, url);
  return url;
}

function nearestDensity(sp) {
  return P.DENSITIES.reduce((b, d) => (Math.abs(d.sp - sp) < Math.abs(b.sp - sp) ? d : b)).sp;
}

function renderQuiltingPanel() {
  const p = $('panel-quilting');
  p.innerHTML = '';
  const q = design.quilting;
  const sp = q.spacing;
  const cur = P.PATTERNS.find((x) => x.id === q.pattern) || P.PATTERNS[0];
  p.append(el('h2', { text: 'Quilting design' }));
  p.append(el('p', { class: 'hint tip', html: '' }, el('b', { text: cur.name }), document.createTextNode(`: ${cur.note}`)));
  // Pictures not drawn yet are filled in a few at a time after the panel
  // shows, so a tap here answers at once.
  const later = [];
  const card = (pat) => {
    const img = el('img', { alt: '' });
    const url = quiltingThumb(pat.id, sp, 'same', false, true);
    if (url) img.src = url; else later.push([img, pat.id]);
    return el('button', { 'aria-pressed': String(q.pattern === pat.id), 'aria-label': `${pat.name}: ${pat.note}`, onclick: () => change((x) => { x.quilting.pattern = pat.id; }) },
      img, el('span', { text: pat.name }));
  };
  const fill = () => {
    const t0 = performance.now();
    while (later.length && performance.now() - t0 < 40) {
      const [img, id] = later.shift();
      if (img.isConnected) { try { img.src = quiltingThumb(id, sp); } catch (err) { console.error(err); } }
    }
    if (later.length) setTimeout(fill, 16);
  };
  setTimeout(fill, 30);
  const top = el('div', { class: 'qgrid' }, card(P.PATTERNS[0]));
  p.append(top);
  for (const g of P.PATTERN_GROUPS) {
    p.append(el('h3', { class: 'qh', text: g.name }));
    const grid = el('div', { class: 'qgrid' });
    for (const pat of P.PATTERNS.filter((x) => x.group === g.id)) grid.append(card(pat));
    p.append(grid);
  }
  if (q.pattern !== 'none' && q.pattern !== 'ditch') {
    p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Density' }),
      seg(P.DENSITIES.map((d) => [d.sp, d.name]), nearestDensity(sp), (v) => change((x) => { x.quilting.spacing = v; }), 'Quilting density', true),
      el('span', { class: 'hint', text: `Lines about ${C.fmtFrac(nearestDensity(sp))}" apart. Denser quilting is flatter and stiffer; airy quilting stays soft.` })));
  }
  if (q.pattern !== 'none' && design.borders.length) {
    const bp = el('div', { class: 'seg grid3', role: 'group', 'aria-label': 'Border quilting' });
    for (const b of P.BORDER_PATTERNS) {
      bp.append(el('button', { 'aria-pressed': String((q.border || 'same') === b.id), onclick: () => change((x) => { x.quilting.border = b.id; }) },
        el('span', { text: b.id === 'same' ? 'Same' : b.name })));
    }
    p.append(el('div', { class: 'setting col' }, el('span', { class: 'lbl', text: 'Borders' }), bp,
      el('span', { class: 'hint', text: q.border && q.border !== 'same' ? 'The center design stops at the borders, and the borders get their own.' : 'The center design runs right across the borders, edge to edge.' })));
  }
  if (P.quiltingLoosened(design, Q.layoutQuilt(design), q)) {
    p.append(el('p', { class: 'note', text: 'On a quilt this big the preview draws this pattern a little looser than you asked, so the page stays quick. Your stitching can be as dense as you like.' }));
  }
  p.append(el('h2', { text: 'Thread', style: 'margin-top:12px' }));
  const t = el('div', { class: 'threads' });
  for (const th of THREADS) {
    t.append(el('button', { 'aria-label': `${th.name} thread`, 'aria-pressed': String(q.thread === th.hex), style: `background:${th.hex}`, onclick: () => change((x) => { x.quilting.thread = th.hex; }) }));
  }
  p.append(t);
  p.append(el('p', { class: 'hint', style: 'margin-top:10px', text: 'Zoom in on the quilt to see the stitches and the soft puff of the batting between them.' }));
}

function renderCutting() {
  const p = $('panel-cutting');
  p.innerHTML = '';
  const layout = Q.layoutQuilt(design);
  const plan = C.cuttingPlan(design, resolver, layout);
  const s = plan.size;
  p.append(el('h2', { text: 'Cutting list' }));
  const sum = el('div', { class: 'summary' },
    el('div', {}, el('b', { text: `${C.fmtFrac(s.w)} × ${C.fmtFrac(s.h)}"` }), el('span', { text: `finished · ${Q.sizeName(s.w, s.h)}` })),
    el('div', {}, el('b', { text: `${plan.fabrics.length}` }), el('span', { text: 'fabrics in the top' })),
    el('div', {}, el('b', { text: C.fmtYd(plan.backing.yards) }), el('span', { text: `backing: ${plan.backing.panels} width${plan.backing.panels > 1 ? 's' : ''} of ${C.fmtFrac(plan.backing.length)}"` })),
    el('div', {}, el('b', { text: `${C.fmtFrac(plan.batting.w)} × ${C.fmtFrac(plan.batting.h)}"` }), el('span', { text: 'batting' })));
  p.append(sum);
  p.append(el('p', { class: 'hint', style: 'margin:8px 0 4px', text: 'Every size includes ¼" seam allowances. Strips are cut across the width of fabric (WOF), counted as 42" usable. Yardage rounds up to the next ⅛ yd; add a little if you prewash.' }));
  for (const n of plan.notes) p.append(el('div', { class: 'note', text: n }));
  for (const f of plan.fabrics) {
    const box = el('div', { class: 'fabcut' });
    box.append(el('header', {}, el('i', { style: `background-image:url(${fabricImg(f.fab)})` }),
      el('div', {}, el('b', { text: fabricName(f.fab) }), el('span', { class: 'hint', text: `${C.fmtFrac(f.inches)}" of WOF strips` })),
      el('span', { class: 'yd', text: C.fmtYd(f.yards) })));
    const ul = el('ul');
    for (const c of f.cuts) {
      const t = C.cutText(c, fabricName);
      ul.append(el('li', {}, el('div', { class: 'h', text: t.head }), el('div', { class: 's', text: t.sub })));
    }
    box.append(ul);
    p.append(box);
  }
  const bk = plan.backing;
  p.append(el('div', { class: 'fabcut' }, el('header', {}, el('div', {}, el('b', { text: 'Backing' }),
    el('span', { class: 'hint', text: `${bk.panels} width${bk.panels > 1 ? 's' : ''} of ${C.fmtFrac(bk.length)}", seamed ${bk.dir === 'vertical' ? 'side by side' : 'top to bottom'}, for a ${C.fmtFrac(bk.w)} × ${C.fmtFrac(bk.h)}" back (4" extra all round)` })),
  el('span', { class: 'yd', text: C.fmtYd(bk.yards) }))));
  p.append(el('div', { class: 'fabcut' }, el('header', {}, el('div', {}, el('b', { text: 'Binding' }),
    el('span', { class: 'hint', text: `${plan.binding.strips} strips 2½" × WOF, ${Math.round(plan.binding.length)}" joined (perimeter plus 12")` })),
  el('span', { class: 'yd', text: C.fmtYd(plan.binding.yards) }))));
}

function renderSaved() {
  const p = $('panel-saved');
  p.innerHTML = '';
  p.append(el('h2', { text: 'This quilt' }));
  const name = el('input', { type: 'text', value: design.name || '', 'aria-label': 'Quilt name', maxlength: '60' });
  name.addEventListener('change', () => { design.name = name.value.trim() || 'My quilt'; saveStore(); });
  p.append(name);
  const pic = el('button', { class: 'btn small', id: 'picBtn', text: exporting ? 'Making the picture…' : 'Save a picture', onclick: exportPng });
  if (exporting) pic.setAttribute('aria-disabled', 'true');
  p.append(el('div', { class: 'row', style: 'margin-top:8px' },
    el('button', { class: 'btn small primary', text: 'Save to my quilts', onclick: () => {
      design.name = name.value.trim() || 'My quilt';
      const thumb = thumbnail();
      const s = Q.quiltSize(design);
      const existing = store.saved.findIndex((x) => x.name === design.name);
      const item = { id: existing >= 0 ? store.saved[existing].id : `q-${Date.now().toString(36)}`, name: design.name, size: `${C.fmtFrac(s.w)} × ${C.fmtFrac(s.h)}"`, design: clone(design), thumb, at: Date.now() };
      if (existing >= 0) store.saved.splice(existing, 1);
      store.saved.unshift(item);
      ui.removed = null;
      saveStore();
      renderSaved();
      toast(existing >= 0 ? `Updated “${design.name}” in My quilts.` : `Saved “${design.name}”.`);
    } }),
    pic,
    el('button', { class: 'btn small', text: 'Start from the sample', onclick: () => { commit(Q.normalizeDesign(Q.defaultDesign())); toast('The Ohio Star sample is back. Undo returns your quilt.'); } })));
  p.append(el('p', { class: 'hint tip', text: 'Saving under a name you already used updates that quilt.' }));
  p.append(el('h2', { text: 'My quilts', style: 'margin-top:16px' }));
  if (ui.removed) {
    const r = ui.removed;
    p.append(el('div', { class: 'note row', style: 'justify-content:space-between' }, el('span', { text: `“${r.item.name}” is out of My quilts.` }),
      el('button', { class: 'btn small', text: 'Put it back', onclick: () => {
        store.saved.splice(Math.min(r.index, store.saved.length), 0, r.item);
        ui.removed = null;
        saveStore();
        renderSaved();
        toast(`“${r.item.name}” is back.`);
      } })));
  }
  if (!store.saved.length) { p.append(el('p', { class: 'hint', text: 'Quilts you save show up here, ready to pick up again.' })); return; }
  const g = el('div', { class: 'gallery' });
  store.saved.forEach((it, index) => {
    g.append(el('div', { class: 'item' },
      el('button', { class: 'open', 'aria-label': `Open ${it.name}`, onclick: () => {
        let d = null;
        try { d = Q.normalizeDesign(clone(it.design)); } catch { d = null; }
        if (!d || !commit(d)) { toast(`“${it.name}” could not be opened.`); return; }
        ui.edit = 0;
        toast(`Opened “${it.name}”. Undo goes back to the quilt you had.`);
        $('quiltCard').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      } },
      el('img', { src: it.thumb, alt: '' }), el('b', { text: it.name }), el('span', { text: it.size || '' })),
      el('button', { class: 'linkbtn', text: 'Remove', 'aria-label': `Remove ${it.name}`, onclick: () => {
        store.saved = store.saved.filter((x) => x.id !== it.id);
        ui.removed = { item: it, index };
        saveStore();
        renderSaved();
      } })));
  });
  p.append(g);
}

function thumbnail() {
  try {
    const s = Q.quiltSize(design);
    const k = 220 / Math.max(s.w, s.h);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(s.w * k); cv.height = Math.ceil(s.h * k);
    renderQuilt(cv.getContext('2d'), k, { quilting: false });
    return cv.toDataURL('image/jpeg', 0.82);
  } catch { return ''; }
}

let exporting = false;
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function exportPng() {
  if (exporting) return;
  exporting = true;
  if (ui.tab === 'saved') renderSaved();
  try {
    await nextPaint(); // let "Making the picture…" show before the work starts
    const s = Q.quiltSize(design);
    const k = Math.min(24, 2800 / Math.max(s.w, s.h));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(s.w * k); cv.height = Math.ceil(s.h * k);
    renderQuilt(cv.getContext('2d'), k);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    cv.width = cv.height = 0; // hand the memory back (iOS counts it)
    if (!blob) { toast('The picture did not come out this time. Try again in a moment.'); return; }
    const fname = `${(design.name || 'quilt').replace(/[^\w\- ]+/g, '').trim() || 'quilt'}.png`;
    // On a phone, the share sheet is where "Save Image" (to Photos) lives.
    const file = typeof File === 'function' ? new File([blob], fname, { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: design.name || 'My quilt' }); return; } catch (err) {
        if (err?.name === 'AbortError') return; // she closed the sheet
        // Not allowed here (e.g. the tap was too long ago): download instead.
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Your quilt picture is downloading.');
  } catch (err) {
    console.error(err);
    toast('The picture did not come out this time. Try again in a moment.');
  } finally {
    exporting = false;
    if (ui.tab === 'saved') renderSaved();
  }
}

/* ---------------------------------------------------------------- tabs */

function showTab(t) {
  if (!document.getElementById(`panel-${t}`)) t = 'block';
  if (t !== 'saved') ui.removed = null;
  ui.tab = t;
  saveSession();
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${t}`;
  renderPanels();
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showTab(b.dataset.tab);
});

function renderPanels() {
  // A panel that fails to draw must not take the rest of the page with it.
  try { caption(); } catch (err) { console.error(err); }
  syncUndo();
  const t = ui.tab;
  const fn = { block: renderBlockPanel, layout: renderLayout, fabrics: renderFabrics, quilting: renderQuiltingPanel, cutting: renderCutting, saved: renderSaved }[t];
  try { fn?.(); } catch (err) {
    console.error(err);
    $(`panel-${t}`).append(el('p', { class: 'note', text: 'This panel could not be drawn for this quilt. Undo, or try another tab.' }));
  }
  if (!dock.hidden) $('dockCap').textContent = $('quiltCaption').textContent.split(' · ').slice(0, 2).join(' · ');
}

let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), Math.max(2600, msg.length * 55));
}

/* ---------------------------------------------------------------- boot */

function hint() {
  const h = $('hint');
  h.hidden = !!store.hintDone;
  $('hintOk').onclick = () => { store.hintDone = true; saveStore(); h.hidden = true; };
  $('hintGo').onclick = () => {
    store.hintDone = true; saveStore(); h.hidden = true;
    showTab('block');
    document.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };
}

async function boot() {
  try {
    try { ensureStarters(); } catch (err) { console.error(err); }
    loadStore();
    try { await loadFabrics(); } catch (err) { console.error(err); }
    refreshResolver();
    hint();
    setTool('fill');
    showTab(ui.tab);
    schedule();
    saveStore();
    if (ui.notice) toast(ui.notice);
  } catch (err) {
    // Whatever happened, leave a working page: the sample quilt and every control.
    console.error(err);
    design = Q.defaultDesign();
    history = [];
    try { refreshResolver(); showTab('block'); schedule(); } catch { /* nothing more to do */ }
    toast('The designer started fresh with the sample quilt.');
  }
  window.addEventListener('resize', () => { offDirty = true; schedule(); drawEditor(); });
  onStashChange(async () => {
    try { await loadFabrics(); } catch (err) { console.error(err); }
    invalidate();
  });
  document.documentElement.dataset.ready = '1';
}

// For the screenshot harness and the curious.
window.__quilt = {
  get design() { return design; },
  set(d) { commit(Q.normalizeDesign(d)); },
  get stitchMs() { return lastStitchMs; },
  ui, showTab, openLibrary, renderQuilt, Q, K, C, P,
};

boot();
