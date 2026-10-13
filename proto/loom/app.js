// Floor-loom prototype UI. All drafting math lives in draft.js (pure).
import * as D from './draft.js';
import * as Z from './puzzles.js';
import * as W from './wif.js';

const STORE_KEY = 'tincture.proto.loom';
const PUZZLE_KEY = 'tincture.proto.loom.puzzles';
const LIBRARY_KEY = 'tincture.proto.loom.library';
const $ = (id) => document.getElementById(id);
const INK = '#2A2622';
const CARD = '#FBF8F1';
const LINE = '#E4DBC8';
const FONT = "'Figtree', system-ui, sans-serif";

/* ------------------------------------------------------------------ state */

let draft = D.buildPreset('twill22');
const ui = {
  view: 'cloth', // cloth | grid | color
  side: 'face', // face | back
  cell: 28,
  weaving: false,
  painting: false,
  brush: '#B8433A',
  weftColor: '#B8433A',
  shown: 0, // picks visible in the weave-mode cloth
  dir: 1, // shuttle direction, alternates
  floatOn: false,
  floatLimit: 4,
  selecting: false,
  sel: null, // { kind: 'ends'|'picks', a, b, done }
  puzzle: null, // { id, target, solved }
};
let studio = null; // the studio draft stashed while a puzzle is open
let puzzleStore = { solved: {}, drafts: {}, hints: {} };
let library = [];
let history = [];

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || !raw.draft) return;
    draft = D.normalizeDraft(raw.draft);
    Object.assign(ui, {
      view: ['cloth', 'grid', 'color'].includes(raw.ui?.view) ? raw.ui.view : 'cloth',
      side: raw.ui?.side === 'back' ? 'back' : 'face',
      cell: Math.max(16, Math.min(44, Number(raw.ui?.cell) || 28)),
      brush: /^#[0-9a-f]{6}$/i.test(raw.ui?.brush) ? raw.ui.brush : ui.brush,
      weftColor: /^#[0-9a-f]{6}$/i.test(raw.ui?.weftColor) ? raw.ui.weftColor : ui.weftColor,
      floatOn: !!raw.ui?.floatOn,
      floatLimit: Math.max(1, Math.min(12, Number(raw.ui?.floatLimit) || 4)),
    });
  } catch { /* storage unavailable or corrupt: start from the default draft */ }
}
function loadStores() {
  try { const p = JSON.parse(localStorage.getItem(PUZZLE_KEY) || 'null'); if (p) puzzleStore = { solved: {}, drafts: {}, hints: {}, ...p }; } catch { /* ignore */ }
  try { const l = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); if (Array.isArray(l)) library = l.filter((x) => x && x.draft); } catch { /* ignore */ }
}
function saveLibrary() { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch { /* ignore */ } }
function save() {
  if (ui.puzzle) {
    puzzleStore.drafts[ui.puzzle.id] = draft;
    try { localStorage.setItem(PUZZLE_KEY, JSON.stringify(puzzleStore)); } catch { /* ignore */ }
    return;
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: 1, draft,
      ui: { view: ui.view, side: ui.side, cell: ui.cell, brush: ui.brush, weftColor: ui.weftColor, floatOn: ui.floatOn, floatLimit: ui.floatLimit },
    }));
  } catch { /* ignore */ }
}

function commit(next, { quiet = false } = {}) {
  if (next === draft) return;
  history.push(draft);
  if (history.length > 200) history.shift();
  draft = next;
  save();
  if (!quiet) renderAll();
}
function undo() {
  if (!history.length) return;
  finishAnim();
  draft = history.pop();
  ui.shown = D.wovenCount(draft);
  save();
  renderAll();
}

/* ------------------------------------------------------------ color utils */

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
/** f < 1 darkens toward a warm shadow, f > 1 lightens toward warm white. */
function shade(hex, f) {
  const c = rgb(hex);
  if (f < 1) return toHex(c.map((v, i) => v * f + [30, 20, 12][i] * (1 - f) * 0.35));
  const t = f - 1;
  return toHex(c.map((v, i) => v + ([255, 248, 232][i] - v) * t));
}
function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fit(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/* ---------------------------------------------------------- cloth drawing */

/**
 * Draw cloth into a rectangle. Pick 0 at the bottom (cloth grows upward);
 * end 0 at the right (ends are numbered from the right). The back view is the
 * inverse of the face, turned over like a page (so left and right swap).
 *   rows: array of picks to draw, bottom to top, each {p, y} top y of the row.
 */
function drawClothRows(ctx, d, dd, opts) {
  const { x0, cell, rows, view, back, clip, e0 = 0, e1 = d.threading.length } = opts;
  const E = e1 - e0;
  const bg = '#5A4D40';
  const col = (e) => (back ? e - e0 : E - 1 - (e - e0)); // screen column of end e
  const cellTop = (e, r) => (back ? (dd[r.p][e] === 'warp' ? 'weft' : 'warp') : dd[r.p][e]);
  const colorOf = (e, r) => (cellTop(e, r) === 'warp' ? d.warpColors[e] : d.weftColors[r.p]);
  if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }

  if (view === 'grid' || view === 'color') {
    for (const r of rows) {
      for (let e = e0; e < e1; e++) {
        const x = x0 + col(e) * cell;
        const warp = cellTop(e, r) === 'warp';
        ctx.fillStyle = view === 'grid' ? (warp ? INK : '#FFFDF8') : colorOf(e, r);
        ctx.fillRect(x, r.y, cell, cell);
      }
    }
    ctx.strokeStyle = view === 'grid' ? '#B9AE98' : 'rgba(42,38,34,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const yTop = rows.length ? Math.min(...rows.map((r) => r.y)) : 0;
    const yBot = rows.length ? Math.max(...rows.map((r) => r.y)) + cell : 0;
    for (let c = 0; c <= E; c++) { ctx.moveTo(x0 + c * cell + 0.5, yTop); ctx.lineTo(x0 + c * cell + 0.5, yBot); }
    for (const r of rows) { ctx.moveTo(x0, r.y + 0.5); ctx.lineTo(x0 + E * cell, r.y + 0.5); }
    ctx.moveTo(x0, yBot - 0.5); ctx.lineTo(x0 + E * cell, yBot - 0.5);
    ctx.stroke();
    if (clip) ctx.restore();
    return;
  }

  // Cloth: threads over a dark ground so the gaps read as shadow between yarns.
  if (rows.length) {
    const yTop = Math.min(...rows.map((r) => r.y));
    const yBot = Math.max(...rows.map((r) => r.y)) + cell;
    ctx.fillStyle = bg;
    ctx.fillRect(x0, yTop, E * cell, yBot - yTop);
  }
  const pad = cell * 0.05;
  const ext = cell * 0.16;
  const rowIndex = rows.map((r) => r);

  const paintBar = (x, y, w, h, color, vertical, capA, capB, seed) => {
    const base = shade(color, 1 + (seed - 0.5) * 0.08);
    rr(ctx, x, y, w, h, (vertical ? w : h) * 0.42);
    const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(base, 0.74));
    g.addColorStop(0.22, shade(base, 1.1));
    g.addColorStop(0.5, base);
    g.addColorStop(0.82, shade(base, 0.86));
    g.addColorStop(1, shade(base, 0.7));
    ctx.fillStyle = g;
    ctx.fill();
    // thread dives under the crossing thread at each end of a run
    ctx.save();
    ctx.clip();
    const len = vertical ? h : w;
    const sh = Math.min(len * 0.5, cell * 0.38);
    const dark = 'rgba(28,18,10,.42)';
    const clear = 'rgba(28,18,10,0)';
    const mk = (a0, a1, atStart) => {
      const gg = vertical
        ? ctx.createLinearGradient(0, atStart ? y : y + h, 0, atStart ? y + sh : y + h - sh)
        : ctx.createLinearGradient(atStart ? x : x + w, 0, atStart ? x + sh : x + w - sh, 0);
      gg.addColorStop(0, a0); gg.addColorStop(1, a1);
      ctx.fillStyle = gg;
      ctx.fillRect(x, y, w, h);
    };
    if (capA) mk(dark, clear, true);
    if (capB) mk(dark, clear, false);
    ctx.restore();
  };

  const yMin = rows.length ? Math.min(...rows.map((r) => r.y)) : 0;
  const yMax = rows.length ? Math.max(...rows.map((r) => r.y)) + cell : 0;
  const inClip = (y0, y1) => [Math.max(y0, yMin - 1e6), Math.min(y1, yMax + 1e6)];
  void inClip;

  // warp threads: runs down each column. rows are bottom-to-top; screen order is top-to-bottom.
  const ordered = rowIndex.slice().sort((a, b) => a.y - b.y);
  for (let e = e0; e < e1; e++) {
    const x = x0 + col(e) * cell + pad;
    let i = 0;
    while (i < ordered.length) {
      if (cellTop(e, ordered[i]) !== 'warp') { i++; continue; }
      let j = i;
      while (j + 1 < ordered.length && cellTop(e, ordered[j + 1]) === 'warp') j++;
      const yA = ordered[i].y;
      const yB = ordered[j].y + cell;
      const capA = i > 0;
      const capB = j < ordered.length - 1;
      paintBar(x, yA - (capA ? ext : 0), cell - 2 * pad, yB - yA + (capA ? ext : 0) + (capB ? ext : 0), d.warpColors[e], true, capA, capB, hash(e, ordered[i].p));
      i = j + 1;
    }
  }
  // weft threads: runs along each pick
  for (const r of ordered) {
    const y = r.y + pad;
    let c = 0;
    // walk screen columns left to right
    const endAt = (sc) => (back ? e0 + sc : e1 - 1 - sc);
    while (c < E) {
      if (cellTop(endAt(c), r) !== 'weft') { c++; continue; }
      let k = c;
      while (k + 1 < E && cellTop(endAt(k + 1), r) === 'weft') k++;
      const xA = x0 + c * cell;
      const xB = x0 + (k + 1) * cell;
      const capA = c > 0;
      const capB = k < E - 1;
      paintBar(xA - (capA ? ext : 0), y, xB - xA + (capA ? ext : 0) + (capB ? ext : 0), cell - 2 * pad, d.weftColors[r.p], false, capA, capB, hash(r.p, c + 77));
      c = k + 1;
    }
  }
  if (clip) ctx.restore();
}

/** Soft marks over cells of a boolean [pick][end] matrix (pick 0 at the bottom). */
function overlayCells(ctx, mat, { x0, y0, cell, E, P, back, fill, ring = false }) {
  ctx.save();
  for (let p = 0; p < P; p++) {
    for (let e = 0; e < E; e++) {
      if (!mat[p]?.[e]) continue;
      const x = x0 + (back ? e : E - 1 - e) * cell;
      const y = y0 + (P - 1 - p) * cell;
      rr(ctx, x + 1, y + 1, cell - 2, cell - 2, Math.max(2, cell * 0.25));
      ctx.fillStyle = fill; ctx.fill();
      if (ring) { ctx.strokeStyle = 'rgba(140,101,18,.55)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  ctx.restore();
}

function drawCloth() {
  if (ui.puzzle) { drawPuzzle(); return; }
  const canvas = $('cloth');
  const d = draft;
  const dd = D.drawdown(d);
  const E = d.threading.length;
  const P = d.treadling.length;
  const W = Math.floor($('clothWrap').clientWidth || 340);
  const cell = Math.max(3, Math.min(W / E, 380 / P, 24));
  const H = Math.ceil(P * cell) + 16;
  const ctx = fit(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ECE4D2';
  ctx.fillRect(0, 0, W, H);
  const x0 = (W - E * cell) / 2;
  const rows = [];
  for (let p = 0; p < P; p++) rows.push({ p, y: 8 + (P - 1 - p) * cell });
  drawClothRows(ctx, d, dd, { x0, cell, rows, view: ui.view, back: ui.side === 'back' });
  if (ui.floatOn) overlayCells(ctx, D.floatCells(d, ui.floatLimit, ui.side), { x0, y0: 8, cell, E, P, back: ui.side === 'back', fill: 'rgba(226,176,74,.55)', ring: true });
  const f = D.floats(d);
  $('clothCaption').textContent = (ui.side === 'back'
    ? 'The back: every crossing is the reverse of the face, turned over like a page. '
    : 'The face, from above. ')
    + 'Pick 1 is at the bottom and the cloth grows upward.'
    + (ui.view === 'grid' ? ' Dark squares are warp on top.' : '')
    + (ui.floatOn ? ` Golden marks show floats longer than ${ui.floatLimit}.` : '');
}

/* ------------------------------------------------------------ draft canvas */

function layoutDraft(d, cell) {
  const E = d.threading.length;
  const P = d.treadling.length;
  const S = d.shafts;
  const right = d.mode === 'liftplan' ? S : d.treadles;
  const gut = 30;
  const gap = Math.round(cell * 0.5);
  const numH = 16;
  const chipH = Math.round(cell * 0.78);
  const L = { E, P, S, right, cell, gut, gap, numH, chipH };
  L.x0 = gut;
  L.xr = L.x0 + E * cell + gap;
  L.xw = L.xr + right * cell + gap;
  L.W = L.xw + cell + 10;
  L.yChip = numH;
  L.yThr = L.yChip + chipH + 4;
  L.yDraw = L.yThr + S * cell + gap;
  L.H = L.yDraw + P * cell + 10;
  return L;
}

function drawDraft() {
  const d = draft;
  const L = layoutDraft(d, ui.cell);
  const canvas = $('draft');
  const ctx = fit(canvas, L.W, L.H);
  const { cell, E, P, S } = L;
  ctx.fillStyle = CARD;
  ctx.fillRect(0, 0, L.W, L.H);
  const dd = D.drawdown(d);

  const box = (x, y, on, fill = INK) => {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    if (on) { rr(ctx, x + 2.5, y + 2.5, cell - 5, cell - 5, 4); ctx.fillStyle = fill; ctx.fill(); }
  };
  const label = (txt, x, y, align = 'center', size = 10, color = '#6B635A') => {
    ctx.fillStyle = color; ctx.font = `600 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x, y);
  };

  // end numbers (from the right) and warp color chips
  const everyEnd = cell >= 22 ? 1 : 2;
  for (let e = 0; e < E; e++) {
    const x = L.x0 + (E - 1 - e) * cell;
    if ((e + 1) % everyEnd === 0 || e === 0) label(String(e + 1), x + cell / 2, L.numH / 2);
    rr(ctx, x + 1.5, L.yChip, cell - 3, L.chipH, 5);
    ctx.fillStyle = d.warpColors[e]; ctx.fill();
    ctx.strokeStyle = 'rgba(42,38,34,.28)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // threading
  for (let s = 0; s < S; s++) {
    const y = L.yThr + (S - 1 - s) * cell;
    label(String(s + 1), L.gut - 8, y + cell / 2, 'right', 11);
    for (let e = 0; e < E; e++) box(L.x0 + (E - 1 - e) * cell, y, d.threading[e] === s);
  }
  // right block header
  if (d.mode === 'liftplan') {
    for (let s = 0; s < S; s++) label(String(s + 1), L.xr + s * cell + cell / 2, L.yThr - 9);
  } else {
    for (let t = 0; t < d.treadles; t++) label(String(t + 1), L.xr + t * cell + cell / 2, L.yThr - 9);
    for (let s = 0; s < S; s++) {
      const y = L.yThr + (S - 1 - s) * cell;
      for (let t = 0; t < d.treadles; t++) box(L.xr + t * cell, y, d.tieup[s][t]);
    }
  }
  // drawdown, treadling / lift plan, weft chips
  for (let p = 0; p < P; p++) {
    const y = L.yDraw + (P - 1 - p) * cell;
    label(String(p + 1), L.gut - 8, y + cell / 2, 'right', 11);
    for (let e = 0; e < E; e++) {
      const x = L.x0 + (E - 1 - e) * cell;
      ctx.fillStyle = dd[p][e] === 'warp' ? INK : '#FFFDF8';
      ctx.fillRect(x, y, cell, cell);
    }
    if (d.mode === 'liftplan') {
      const set = new Set(d.liftplan[p]);
      for (let s = 0; s < S; s++) box(L.xr + s * cell, y, set.has(s));
    } else {
      for (let t = 0; t < d.treadles; t++) box(L.xr + t * cell, y, d.treadling[p] === t);
    }
    rr(ctx, L.xw + 1.5, y + 1.5, cell - 3, cell - 3, 5);
    ctx.fillStyle = d.weftColors[p]; ctx.fill();
    ctx.strokeStyle = 'rgba(42,38,34,.28)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // drawdown grid lines + repeat guides
  ctx.strokeStyle = 'rgba(107,99,90,.28)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let e = 0; e <= E; e++) { const x = L.x0 + e * cell + 0.5; ctx.moveTo(x, L.yDraw); ctx.lineTo(x, L.yDraw + P * cell); }
  for (let p = 0; p <= P; p++) { const y = L.yDraw + p * cell + 0.5; ctx.moveTo(L.x0, y); ctx.lineTo(L.x0 + E * cell, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(42,38,34,.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let e = 4; e < E; e += 4) { const x = L.x0 + (E - e) * cell; ctx.moveTo(x, L.yDraw); ctx.lineTo(x, L.yDraw + P * cell); }
  for (let p = 4; p < P; p += 4) { const y = L.yDraw + (P - p) * cell; ctx.moveTo(L.x0, y); ctx.lineTo(L.x0 + E * cell, y); }
  ctx.stroke();

  if (ui.floatOn) overlayCells(ctx, D.floatCells(d, ui.floatLimit, 'face'), { x0: L.x0, y0: L.yDraw, cell, E, P, back: false, fill: 'rgba(226,176,74,.6)' });
  if (ui.sel) {
    const s = ui.sel;
    const lo = Math.min(s.a, s.b);
    const hi = Math.max(s.a, s.b);
    ctx.fillStyle = 'rgba(226,176,74,.22)';
    ctx.strokeStyle = '#C99A2E';
    ctx.lineWidth = 2;
    if (s.kind === 'ends') {
      const x = L.x0 + (E - 1 - hi) * cell;
      const w = (hi - lo + 1) * cell;
      ctx.fillRect(x, L.yChip, w, L.yDraw + P * cell - L.yChip);
      ctx.strokeRect(x, L.yChip, w, L.yDraw + P * cell - L.yChip);
    } else {
      const y = L.yDraw + (P - 1 - hi) * cell;
      const h = (hi - lo + 1) * cell;
      ctx.fillRect(L.gut - 4, y, L.xw + cell - L.gut + 4, h);
      ctx.strokeRect(L.gut - 4, y, L.xw + cell - L.gut + 4, h);
    }
  }
  // paint strips sit over the color chips so a drag there paints, while other drags still scroll
  const ws = $('warpStrip');
  Object.assign(ws.style, { left: `${L.x0}px`, top: `${L.yChip - 3}px`, width: `${E * cell}px`, height: `${L.chipH + 6}px` });
  const fs = $('weftStrip');
  Object.assign(fs.style, { left: `${L.xw - 3}px`, top: `${L.yDraw}px`, width: `${cell + 6}px`, height: `${P * cell}px` });
  $('draftCaption').textContent = (d.shed === 'sinking'
    ? 'Sinking shed: tied shafts go down, the rest rise. '
    : 'Rising shed: tied shafts lift. ')
    + 'Ends read from the right; picks read upward. Tap a square to set it, tap a color chip to dye it.';
  return L;
}

function hitDraft(L, d, x, y) {
  const { cell, E, P, S } = L;
  const inX = (a, n) => x >= a && x < a + n * cell;
  if (y >= L.yChip && y < L.yChip + L.chipH && inX(L.x0, E)) {
    return { area: 'warpchip', end: E - 1 - Math.floor((x - L.x0) / cell) };
  }
  if (y >= L.yThr && y < L.yThr + S * cell) {
    const s = S - 1 - Math.floor((y - L.yThr) / cell);
    if (inX(L.x0, E)) return { area: 'thread', end: E - 1 - Math.floor((x - L.x0) / cell), shaft: s };
    if (d.mode !== 'liftplan' && inX(L.xr, L.right)) return { area: 'tie', shaft: s, treadle: Math.floor((x - L.xr) / cell) };
  }
  if (y >= L.yDraw && y < L.yDraw + P * cell) {
    const p = P - 1 - Math.floor((y - L.yDraw) / cell);
    if (inX(L.xr, L.right)) {
      const c = Math.floor((x - L.xr) / cell);
      return d.mode === 'liftplan' ? { area: 'lift', pick: p, shaft: c } : { area: 'tread', pick: p, treadle: c };
    }
    if (x >= L.xw && x < L.xw + cell) return { area: 'weftchip', pick: p };
  }
  return null;
}

/* ------------------------------------------------------- pointer handling */

function initDraftInput() {
  const canvas = $('draft');
  let down = null;
  canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }; });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = ev.timeStamp - down.t < 1500;
    down = null;
    if (moved > 14 || !quick) return;
    const r = canvas.getBoundingClientRect();
    const L = layoutDraft(draft, ui.cell);
    tapDraft(hitDraft(L, draft, ev.clientX - r.left, ev.clientY - r.top));
  });

  // paint strips: drag across chips to set many at once
  const strip = (el, kind) => {
    let active = false;
    let work = null;
    const apply = (ev) => {
      const L = layoutDraft(draft, ui.cell);
      const r = el.getBoundingClientRect();
      let i;
      if (kind === 'warp') {
        const col = Math.floor((ev.clientX - r.left) / L.cell);
        i = L.E - 1 - Math.max(0, Math.min(L.E - 1, col));
        work = D.setWarpColor(work, i, ui.brush);
      } else {
        const row = Math.floor((ev.clientY - r.top) / L.cell);
        i = L.P - 1 - Math.max(0, Math.min(L.P - 1, row));
        work = D.setWeftColor(work, i, ui.brush);
      }
      const prev = draft;
      draft = work;
      drawDraft(); drawCloth();
      draft = prev;
    };
    el.addEventListener('pointerdown', (ev) => {
      active = true; work = draft; el.setPointerCapture(ev.pointerId); apply(ev); ev.preventDefault();
    });
    el.addEventListener('pointermove', (ev) => { if (active) apply(ev); });
    const end = () => {
      if (!active) return;
      active = false;
      const w = work; work = null;
      commit(w);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  strip($('warpStrip'), 'warp');
  strip($('weftStrip'), 'weft');
}

function selTap(kind, i) {
  const s = ui.sel;
  if (!s || s.kind !== kind || s.done) ui.sel = { kind, a: i, b: i, done: false };
  else { s.b = i; s.done = true; }
  renderAll();
}

function tapDraft(h) {
  if (!h) return;
  if (ui.selecting) {
    if (h.area === 'thread' || h.area === 'warpchip') selTap('ends', h.end);
    else if (h.area === 'tread' || h.area === 'lift' || h.area === 'weftchip') selTap('picks', h.pick);
    return;
  }
  if (h.area === 'thread') commit(D.toggleThreading(draft, h.end, h.shaft));
  else if (h.area === 'tie') commit(D.toggleTieup(draft, h.shaft, h.treadle));
  else if (h.area === 'tread') commit(D.toggleTreadling(draft, h.pick, h.treadle));
  else if (h.area === 'lift') commit(D.toggleLift(draft, h.pick, h.shaft));
  // One rule for color chips: a tap dyes it with the chosen dye (the strips over
  // the chips normally catch this first; this is the same behaviour as a fallback).
  else if (h.area === 'warpchip') commit(D.setWarpColor(draft, h.end, ui.brush));
  else if (h.area === 'weftchip') commit(D.setWeftColor(draft, h.pick, ui.brush));
}

/* -------------------------------------------------------------- sheets */

function openSheet(title, node) {
  const inner = $('sheetInner');
  inner.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = title;
  inner.append(h, node);
  const close = document.createElement('button');
  close.className = 'btn';
  close.textContent = 'Close';
  close.style.marginTop = '8px';
  close.onclick = closeSheet;
  inner.append(close);
  $('overlay').classList.add('open');
  $('sheet').classList.add('open');
}
function closeSheet() {
  $('overlay').classList.remove('open');
  $('sheet').classList.remove('open');
}
$('overlay').addEventListener('click', closeSheet);

function swatch(c, pressed) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c.hex;
  b.setAttribute('aria-label', c.name);
  b.setAttribute('aria-pressed', String(pressed));
  return b;
}

function openPalette(title, onPick, current, allLabel) {
  const wrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'palette';
  let scope = 'one';
  D.PALETTE.forEach((c) => {
    const cell = document.createElement('div');
    const b = swatch(c, c.hex.toLowerCase() === (current || '').toLowerCase());
    b.onclick = () => { closeSheet(); onPick(c.hex, scope); };
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = c.name;
    cell.append(b, n);
    grid.append(cell);
  });
  wrap.append(grid);
  if (allLabel) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '12px';
    const seg = document.createElement('div');
    seg.className = 'seg';
    [['one', 'Just this one'], ['all', allLabel]].forEach(([v, t]) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.setAttribute('aria-pressed', String(v === scope));
      b.onclick = () => { scope = v; [...seg.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
      seg.append(b);
    });
    row.append(seg);
    wrap.append(row);
  }
  openSheet(title, wrap);
}

function openPresets() {
  const wrap = document.createElement('div');
  D.PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'preset';
    const cv = document.createElement('canvas');
    const t = document.createElement('div');
    t.innerHTML = '<div class="t"></div><div class="n"></div>';
    t.firstChild.textContent = p.name;
    t.lastChild.textContent = p.note;
    b.append(cv, t);
    wrap.append(b);
    const pd = D.buildPreset(p.id);
    const ctx = fit(cv, 64, 64);
    const n = Math.min(16, pd.threading.length, pd.treadling.length);
    const cell = 64 / n;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ p: i, y: (n - 1 - i) * cell });
    drawClothRows(ctx, pd, D.drawdown(pd), { x0: 0, cell, rows, view: 'cloth', back: false, e0: 0, e1: n });
    b.onclick = () => {
      closeSheet();
      history.push(draft);
      draft = pd;
      ui.shown = D.wovenCount(draft);
      save();
      renderAll();
    };
  });
  openSheet('Presets', wrap);
}

function openClear() {
  const wrap = document.createElement('div');
  [
    ['Threading', D.clearThreading], ['Tie-up', D.clearTieup], ['Treadling', D.clearTreadling],
    ['Colors', (d) => D.clearColors(d)], ['Everything (start a blank draft)', D.clearAll],
  ].forEach(([t, fn]) => {
    const b = document.createElement('button');
    b.className = 'btn listbtn';
    b.textContent = t;
    b.onclick = () => { closeSheet(); ui.shown = 0; commit(fn(draft)); ui.shown = D.wovenCount(draft); renderAll(); };
    wrap.append(b);
  });
  const p = document.createElement('p');
  p.className = 'caption';
  p.textContent = 'You can always undo.';
  wrap.append(p);
  openSheet('Clear', wrap);
}

/* ---------------------------------------------------------------- controls */

function setPressed(seg, attr, val) {
  [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))));
}

function bindControls() {
  $('viewSeg').onclick = (e) => { const v = e.target.dataset?.v; if (v) { ui.view = v; save(); renderAll(); } };
  $('sideSeg').onclick = (e) => { const s = e.target.dataset?.s; if (s) { ui.side = s; save(); renderAll(); } };
  $('presetsBtn').onclick = openPresets;
  $('undoBtn').onclick = undo;
  $('wUndo').onclick = undo;
  $('dyeWarp').onclick = () => commit(D.setAllWarpColors(draft, ui.brush));
  $('dyeWeft').onclick = () => commit(D.setAllWeftColors(draft, ui.brush));
  $('weaveBtn').onclick = () => setWeaving(true);
  $('doneBtn').onclick = () => setWeaving(false);
  $('curColor').onclick = () => openPalette('Weft color', (hex) => { ui.weftColor = hex; save(); renderAll(); }, ui.weftColor);
  $('zoomIn').onclick = () => { ui.cell = Math.min(44, ui.cell + 4); save(); renderAll(); };
  $('zoomOut').onclick = () => { ui.cell = Math.max(16, ui.cell - 4); save(); renderAll(); };
  $('shedSeg').onclick = (e) => { const v = e.target.dataset?.v; if (v) commit(D.setShed(draft, v)); };
  $('modeSeg').onclick = (e) => { const v = e.target.dataset?.v; if (v) commit(D.setMode(draft, v)); };
  $('shaftSeg').onclick = (e) => { const n = Number(e.target.dataset?.n); if (n) commit(D.setShafts(draft, n)); };
  $('repThread').onclick = () => commit(D.repeatThreadingToFill(draft));
  $('repTread').onclick = () => commit(D.repeatTreadlingToFill(draft));
  $('mirThread').onclick = () => commit(D.mirrorThreading(draft));
  $('mirTread').onclick = () => commit(D.mirrorTreadling(draft));
  $('clearBtn').onclick = openClear;
  $('tromp').onclick = () => commit(D.trompAsWrit(draft));
  $('puzzlesBtn').onclick = openPuzzleList;
  $('libraryBtn').onclick = openLibrary;
  $('wifBtn').onclick = openWif;
  $('selectBtn').onclick = () => { ui.selecting = !ui.selecting; if (!ui.selecting) ui.sel = null; renderAll(); };
  $('floatBtn').onclick = () => { ui.floatOn = !ui.floatOn; save(); renderAll(); };
  $('floatStep').querySelectorAll('button').forEach((b) => { b.onclick = () => { ui.floatLimit = Math.max(1, Math.min(12, ui.floatLimit + Number(b.dataset.d))); save(); renderAll(); }; });
  bindPuzzleCard();
  bindSelBar();

  const steps = { treadles: D.setTreadles, ends: D.setEnds, picks: D.setPicks };
  const keyOf = { treadles: (d) => d.treadles, ends: (d) => d.threading.length, picks: (d) => d.treadling.length };
  document.querySelectorAll('.stepper[data-step]').forEach((st) => {
    const name = st.dataset.step;
    st.querySelectorAll('button').forEach((b) => {
      let timer = null;
      let rep = null;
      const bump = () => commit(steps[name](draft, keyOf[name](draft) + Number(b.dataset.d)));
      const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; };
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        bump();
        timer = setTimeout(() => { rep = setInterval(bump, 90); }, 400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => b.addEventListener(n, stop));
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); bump(); } });
    });
  });
}

function renderBrushes() {
  const box = $('brushes');
  box.replaceChildren();
  D.PALETTE.forEach((c) => {
    const b = swatch(c, c.hex.toLowerCase() === ui.brush.toLowerCase());
    b.onclick = () => { ui.brush = c.hex; save(); renderBrushes(); };
    box.append(b);
  });
}

function renderControls() {
  const d = draft;
  document.body.classList.toggle('selecting', !!ui.selecting);
  document.body.classList.toggle('weaving', ui.weaving);
  document.body.classList.toggle('puzzling', !!ui.puzzle);
  $('floatBtn').setAttribute('aria-pressed', String(ui.floatOn));
  $('floatBtn').classList.toggle('on', ui.floatOn);
  $('floatStep').style.display = ui.floatOn ? 'inline-flex' : 'none';
  $('floatVal').textContent = `>${ui.floatLimit}`;
  $('undoBtn').setAttribute('aria-disabled', String(!history.length));
  $('wUndo').setAttribute('aria-disabled', String(!history.length));
  setPressed($('viewSeg'), 'v', ui.view);
  setPressed($('sideSeg'), 's', ui.side);
  setPressed($('shedSeg'), 'v', d.shed);
  setPressed($('modeSeg'), 'v', d.mode);
  const seg = $('shaftSeg');
  const opts = [...new Set([4, 8, d.shafts])].sort((a, b) => a - b);
  seg.replaceChildren(...opts.map((n) => {
    const b = document.createElement('button');
    b.textContent = String(n);
    b.dataset.n = String(n);
    b.setAttribute('aria-pressed', String(n === d.shafts));
    return b;
  }));
  const vals = { treadles: d.treadles, ends: d.threading.length, picks: d.treadling.length };
  document.querySelectorAll('.stepper[data-step]').forEach((st) => { st.querySelector('output').textContent = vals[st.dataset.step]; });
  $('zoomVal').textContent = String(Math.round((ui.cell / 28) * 100)) + '%';
  $('treadles').closest('#weaveBar') && renderTreadles();
  $('curColor').style.background = ui.weftColor;
  const pick = D.wovenCount(d);
  $('weaveCaption').textContent = `Pick ${pick}. Tap a treadle to open the shed and throw the shuttle.`;
  // info line
  const f = D.floats(d);
  const longest = Math.max(f.warp, f.weft);
  $('info').innerHTML = `<b>${d.threading.length}</b> ends &middot; <b>${d.treadling.length}</b> picks &middot; <b>${d.shafts}</b> shafts &middot; longest floats: warp <b>${f.warp}</b>, weft <b>${f.weft}</b>`
    + (longest >= 6 ? `<span class="note">long floats (${longest})</span>` : '');
}

/* -------------------------------------------------------------- weave mode */

let treadleSig = '';
function renderTreadles(force) {
  const d = draft;
  const box = $('treadles');
  const sig = JSON.stringify([d.mode, d.shafts, d.treadles, d.tieup, ui.marked]);
  if (!force && sig === treadleSig) return;
  treadleSig = sig;
  box.replaceChildren();
  if (d.mode === 'liftplan') {
    box.style.gridTemplateColumns = `repeat(${Math.min(d.shafts, 8)}, 1fr)`;
    const marked = new Set(ui.marked || []);
    for (let s = 0; s < d.shafts; s++) {
      const b = document.createElement('button');
      b.className = 'shaftbtn';
      b.textContent = String(s + 1);
      b.setAttribute('aria-pressed', String(marked.has(s)));
      b.onclick = () => { if (marked.has(s)) marked.delete(s); else marked.add(s); ui.marked = [...marked]; renderTreadles(true); };
      box.append(b);
    }
    const go = document.createElement('button');
    go.className = 'btn primary';
    go.style.cssText = 'grid-column: 1 / -1; min-height: 56px; font-size: 18px';
    go.textContent = 'Throw pick';
    go.onclick = () => throwPick(ui.marked || []);
    box.append(go);
    return;
  }
  box.style.gridTemplateColumns = '';
  for (let t = 0; t < d.treadles; t++) {
    const b = document.createElement('button');
    b.className = 'treadle';
    b.setAttribute('aria-label', `Treadle ${t + 1}`);
    const dots = document.createElement('div');
    dots.className = 'dots';
    dots.style.gridTemplateColumns = `repeat(${Math.min(d.shafts, 4)}, 5px)`;
    for (let s = d.shafts - 1; s >= 0; s--) {
      const i = document.createElement('i');
      if (d.tieup[s][t]) i.className = 'on';
      dots.append(i);
    }
    const n = document.createElement('b');
    n.textContent = String(t + 1);
    b.append(n, dots);
    b.onclick = () => throwPick(t);
    box.append(b);
  }
}

function setWeaving(on) {
  finishAnim();
  ui.weaving = on;
  ui.shown = D.wovenCount(draft);
  renderAll();
  window.scrollTo(0, 0);
}

const anim = { active: false, t0: 0, p: 0, lifted: new Set(), dir: 1 };
const DURATION = 1150;
let raf = 0;

function throwPick(what) {
  finishAnim();
  if (Array.isArray(what) && !what.length && draft.mode === 'liftplan') { /* an empty shed is still a pick */ }
  ui.dir = -ui.dir || 1;
  commit(D.appendPick(draft, what, ui.weftColor), { quiet: true });
  const p = D.wovenCount(draft) - 1;
  ui.shown = p;
  anim.active = true;
  anim.t0 = performance.now();
  anim.p = p;
  anim.lifted = new Set(D.liftedShafts(draft, p));
  anim.dir = ui.dir;
  renderControls();
  tick();
}
function finishAnim() {
  if (!anim.active) return;
  anim.active = false;
  cancelAnimationFrame(raf);
  ui.shown = D.wovenCount(draft);
  drawStage(0, true);
  renderControls();
}
function tick() {
  const t = (performance.now() - anim.t0) / DURATION;
  if (t >= 1) { finishAnim(); return; }
  drawStage(t, false);
  raf = requestAnimationFrame(tick);
}

const ease = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The loom view: warp threads, the open shed, the shuttle, the reed, and the cloth below the fell. */
function drawStage(t, idle) {
  const canvas = $('cloth');
  const d = draft;
  const E = d.threading.length;
  const W = Math.floor($('clothWrap').clientWidth || 340);
  const H = 400;
  const ctx = fit(canvas, W, H);
  const cell = Math.max(4, Math.min(W / E, 22));
  const x0 = (W - E * cell) / 2;
  const bottom = H - 6;
  const maxCloth = 190;
  // phases
  const open = idle ? 0 : ease(clamp01(t / 0.18)) * (1 - ease(clamp01((t - 0.9) / 0.1)));
  const sp = idle ? 0 : clamp01((t - 0.18) / 0.44); // shuttle progress
  const bt = idle ? 0 : clamp01((t - 0.62) / 0.24); // beat progress
  const beat = ease(bt);
  const ret = idle ? 0 : ease(clamp01((t - 0.86) / 0.14));
  const shownF = ui.shown + (idle ? 0 : beat);
  const fell = bottom - Math.min(shownF * cell, maxCloth);
  const yTopOf = (k) => fell + (shownF - 1 - k) * cell;

  // background
  const bgG = ctx.createLinearGradient(0, 0, 0, H);
  bgG.addColorStop(0, '#E3D9C3'); bgG.addColorStop(1, '#ECE4D2');
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

  const yShed = Math.max(60, fell - 62);
  const yRowC = yTopOf(anim.p) + cell / 2;
  const wy = idle ? yShed : yShed + (yRowC - yShed) * beat;
  const reedRest = yShed - 26;
  const reedY = idle ? reedRest : (bt > 0 && ret === 0 ? reedRest + (wy - cell * 0.62 - reedRest) * beat : (wy - cell * 0.62) + (reedRest - (wy - cell * 0.62)) * ret);
  const sc = (e) => E - 1 - e;
  const cx = (e) => x0 + sc(e) * cell + cell / 2;
  const lifted = anim.active && !idle ? anim.lifted : new Set();
  const isUp = (e) => d.threading[e] != null && lifted.has(d.threading[e]);

  // warp threads, lowered first
  const thread = (e, up) => {
    const x = cx(e);
    const w = Math.max(1.6, cell * 0.34);
    ctx.fillStyle = up ? shade(d.warpColors[e], 0.9) : shade(d.warpColors[e], 0.95 - 0.12 * open);
    ctx.fillRect(x - w / 2, 0, w, fell);
    ctx.fillStyle = 'rgba(255,250,235,.22)';
    ctx.fillRect(x - w / 2, 0, Math.max(0.8, w * 0.28), fell);
  };
  for (let e = 0; e < E; e++) if (!isUp(e) || idle) thread(e, false);
  // heddle bar (back of the shed)
  ctx.fillStyle = 'rgba(107,74,50,.55)';
  ctx.fillRect(x0 - 6, 14, E * cell + 12, 5);
  ctx.fillStyle = 'rgba(107,74,50,.3)';
  ctx.fillRect(x0 - 6, 21, E * cell + 12, 2);

  // the weft thread laid by the shuttle (in front of lowered warps, behind raised ones)
  const dir = anim.dir;
  const startX = dir > 0 ? x0 - 10 : x0 + E * cell + 10;
  const endX = dir > 0 ? x0 + E * cell + 10 : x0 - 10;
  const shX = startX + (endX - startX) * (idle ? 0 : sp);
  const thick = Math.max(2.5, cell * 0.62);
  if (!idle && t >= 0.18) {
    const wx0 = Math.min(startX, shX);
    const wx1 = Math.max(startX, shX);
    const wc = d.weftColors[anim.p];
    const g = ctx.createLinearGradient(0, wy - thick / 2, 0, wy + thick / 2);
    g.addColorStop(0, shade(wc, 0.78)); g.addColorStop(0.3, shade(wc, 1.12)); g.addColorStop(0.7, wc); g.addColorStop(1, shade(wc, 0.72));
    rr(ctx, wx0, wy - thick / 2, wx1 - wx0, thick, thick * 0.45);
    ctx.fillStyle = g; ctx.fill();
  }
  // raised warps over the weft, with a soft shadow so they read as lifted
  if (!idle && open > 0.01) {
    for (let e = 0; e < E; e++) {
      if (!isUp(e)) continue;
      const x = cx(e);
      const w = Math.max(2.2, cell * 0.5);
      ctx.save();
      ctx.shadowColor = 'rgba(42,38,34,.45)';
      ctx.shadowBlur = 5 * open;
      ctx.shadowOffsetX = 2 * open;
      ctx.shadowOffsetY = 3 * open;
      const ly0 = yShed - 34 * open - 6;
      const ly1 = yShed + 34 * open + 6;
      const gg = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      const c = d.warpColors[e];
      gg.addColorStop(0, shade(c, 0.78)); gg.addColorStop(0.3, shade(c, 1.12)); gg.addColorStop(0.7, c); gg.addColorStop(1, shade(c, 0.74));
      rr(ctx, x - w / 2, ly0, w, ly1 - ly0, w * 0.45);
      ctx.fillStyle = gg; ctx.fill();
      ctx.restore();
      // continue the thread above and below the raised stretch
      ctx.fillStyle = shade(c, 0.95);
      const tw = Math.max(1.6, cell * 0.34);
      ctx.fillRect(x - tw / 2, 0, tw, ly0 + 2);
      ctx.fillRect(x - tw / 2, ly1 - 2, tw, fell - ly1 + 2);
    }
  }
  // shuttle
  if (!idle && t >= 0.12 && t < 0.7) {
    const sx = t < 0.18 ? startX : shX;
    const sl = 58;
    const sh = 17;
    ctx.save();
    ctx.translate(sx, wy);
    if (dir < 0) ctx.scale(-1, 1);
    ctx.shadowColor = 'rgba(42,38,34,.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(-sl / 2, 0);
    ctx.quadraticCurveTo(-sl / 4, -sh / 2 - 2, sl / 2 - 4, -2);
    ctx.quadraticCurveTo(sl / 2 + 2, 0, sl / 2 - 4, 2);
    ctx.quadraticCurveTo(-sl / 4, sh / 2 + 2, -sl / 2, 0);
    const sg = ctx.createLinearGradient(0, -sh / 2, 0, sh / 2);
    sg.addColorStop(0, '#9A6E4A'); sg.addColorStop(0.5, '#6B4A32'); sg.addColorStop(1, '#4C3322');
    ctx.fillStyle = sg; ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(ctx, -10, -sh / 2 + 3, 20, sh - 6, 4);
    ctx.fillStyle = d.weftColors[anim.p]; ctx.fill();
    ctx.restore();
  }
  // reed (a comb that beats the weft to the fell)
  const rY = reedY;
  ctx.fillStyle = '#7A5638';
  ctx.fillRect(x0 - 8, rY - 7, E * cell + 16, 5);
  ctx.fillStyle = 'rgba(42,38,34,.35)';
  for (let e = 0; e <= E; e++) ctx.fillRect(x0 + e * cell - 0.5, rY - 2, 1, 9);
  ctx.fillStyle = 'rgba(42,38,34,.18)';
  ctx.fillRect(x0 - 8, rY + 7, E * cell + 16, 2);

  // the cloth, below the fell. Older rows only; the pick in flight is drawn as a thread above.
  const dd = D.drawdown(d);
  const rows = [];
  for (let k = 0; k < ui.shown; k++) {
    const y = yTopOf(k);
    if (y + cell > fell - 0.5 && y < bottom + cell) rows.push({ p: k, y });
  }
  ctx.fillStyle = '#E3D9C3';
  ctx.fillRect(x0 - 2, fell, E * cell + 4, bottom - fell + 6);
  if (rows.length) {
    drawClothRows(ctx, d, dd, { x0, cell, rows, view: 'cloth', back: false, clip: { x: x0, y: fell, w: E * cell, h: bottom - fell + 4 } });
  }
  // selvedge shadow at the fell
  const fg = ctx.createLinearGradient(0, fell, 0, fell + 8);
  fg.addColorStop(0, 'rgba(42,38,34,.35)'); fg.addColorStop(1, 'rgba(42,38,34,0)');
  ctx.fillStyle = fg; ctx.fillRect(x0, fell, E * cell, 8);

}

/* ------------------------------------------------------------ puzzles */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function enterPuzzle(id) {
  const pz = Z.getPuzzle(id);
  if (!pz) return;
  if (ui.puzzle) save(); else studio = { draft, history, shown: ui.shown };
  finishAnim();
  draft = puzzleStore.drafts[id] ? D.normalizeDraft(puzzleStore.drafts[id]) : Z.startDraft(pz);
  history = [];
  ui.puzzle = { id, target: Z.targetOf(pz), match: null };
  ui.sel = null; ui.selecting = false; ui.painting = false; ui.weaving = false;
  closeSheet();
  renderAll();
  window.scrollTo(0, 0);
}
function leavePuzzle() {
  if (!ui.puzzle) return;
  save();
  ui.puzzle = null;
  if (studio) { draft = studio.draft; history = studio.history; ui.shown = studio.shown; studio = null; }
  ui.sel = null; ui.selecting = false;
  renderAll();
}
function nextPuzzleId() {
  const i = Z.PUZZLES.findIndex((p) => p.id === ui.puzzle.id);
  return Z.PUZZLES[(i + 1) % Z.PUZZLES.length].id;
}

function renderPuzzleCard() {
  const card = $('puzzleCard');
  if (!ui.puzzle) { card.replaceChildren(); return; }
  const pz = Z.getPuzzle(ui.puzzle.id);
  const hints = puzzleStore.hints[pz.id] || 0;
  const stages = Z.hintStages(pz);
  const m = Z.bestMatch(draft, ui.puzzle.target, { structureOnly: pz.structureOnly });
  ui.puzzle.match = m;
  const pct = Math.floor(Z.progress(draft, ui.puzzle.target, { structureOnly: pz.structureOnly }) * 100);
  const solved = m.score >= 1;
  if (solved && !puzzleStore.solved[pz.id]) { puzzleStore.solved[pz.id] = true; save(); }
  const hintLabel = hints < stages.length ? `Hint: show the ${stages[hints]}` : 'All hints shown';
  card.innerHTML = `
    <h2>Match the cloth &middot; puzzle ${pz.level} of ${Z.PUZZLES.length}</h2>
    <div class="pz-title">${esc(pz.title)}</div>
    <p class="pz-customer">&ldquo;${esc(pz.customer)}&rdquo;</p>
    <p class="caption" style="margin:0">Your loom: <b>${pz.shafts}</b> shafts, <b>${pz.treadles}</b> treadles &middot; <b>${pz.ends}</b> ends &times; <b>${pz.picks}</b> picks &middot; ${pz.structureOnly ? 'any colors will do' : 'the colors matter here'}</p>
    <div class="pz-cloths">
      <figure><canvas id="pzTarget" aria-label="The cloth ordered"></canvas><figcaption>The order</figcaption></figure>
      <figure class="mine${solved ? ' glow' : ''}"><canvas id="pzMine" aria-label="Your cloth"></canvas><figcaption>Your cloth</figcaption></figure>
    </div>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="fill" style="width:${Math.max(3, pct)}%"></div></div>
    <p class="caption">${solved ? 'Every cell matches.' : `${pct}% of the way there. Matching areas glow softly.`}</p>
    <div class="seg" id="pzView" role="group" aria-label="Cloth view" style="margin-bottom:8px">
      ${['cloth', 'grid', 'color'].map((v) => `<button data-act="view" data-v="${v}" aria-pressed="${ui.view === v}">${{ cloth: 'Cloth', grid: 'Grid', color: 'Colors' }[v]}</button>`).join('')}
    </div>
    ${solved ? `<div class="solved"><b>It matches!</b>The ${esc(pz.title.toLowerCase())} is just what they hoped for. Thank you, weaver.<div class="row"><button class="btn primary" data-act="next">Next puzzle</button><button class="btn" data-act="list">All puzzles</button></div></div>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn" data-act="hint" ${hints >= stages.length ? 'aria-disabled="true"' : ''}>${hintLabel}</button>
      <button class="btn" data-act="list">Puzzles</button>
      <button class="btn" data-act="reset">Start over</button>
      <button class="btn" data-act="leave">Back to my studio</button>
    </div>`;
  drawPuzzle();
}

function drawPuzzle() {
  const tc = $('pzTarget');
  const mc = $('pzMine');
  if (!tc || !mc || !ui.puzzle) return;
  const pz = Z.getPuzzle(ui.puzzle.id);
  const W0 = Math.floor(tc.parentElement.clientWidth || 160);
  const t = ui.puzzle.target;
  const draw = (cv, d, mask) => {
    const E = d.threading.length;
    const P = d.treadling.length;
    const cell = Math.max(3, Math.min(W0 / E, 170 / P, 20));
    const w = Math.ceil(E * cell);
    const h = Math.ceil(P * cell);
    const ctx = fit(cv, w, h);
    const rows = [];
    for (let p = 0; p < P; p++) rows.push({ p, y: (P - 1 - p) * cell });
    drawClothRows(ctx, d, D.drawdown(d), { x0: 0, cell, rows, view: ui.view, back: false });
    if (mask) overlayCells(ctx, mask, { x0: 0, y0: 0, cell, E, P, back: false, fill: 'rgba(255,222,130,.38)' });
  };
  draw(tc, t, null);
  draw(mc, draft, Z.matchMask(draft, t, { structureOnly: pz.structureOnly }));
  void pz;
}

function bindPuzzleCard() {
  $('puzzleCard').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || !ui.puzzle) return;
    const pz = Z.getPuzzle(ui.puzzle.id);
    const act = b.dataset.act;
    if (act === 'view') { ui.view = b.dataset.v; save(); renderAll(); }
    else if (act === 'leave') leavePuzzle();
    else if (act === 'next') enterPuzzle(nextPuzzleId());
    else if (act === 'list') openPuzzleList();
    else if (act === 'reset') { history.push(draft); draft = Z.startDraft(pz); save(); renderAll(); }
    else if (act === 'hint') {
      const stages = Z.hintStages(pz);
      const n = puzzleStore.hints[pz.id] || 0;
      if (n >= stages.length) return;
      puzzleStore.hints[pz.id] = n + 1;
      commit(Z.applyHint(draft, pz, stages[n]));
    }
  });
}

function openPuzzleList() {
  const wrap = document.createElement('div');
  Z.PUZZLES.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'preset';
    const done = puzzleStore.solved[p.id];
    const started = !!puzzleStore.drafts[p.id];
    b.innerHTML = `<div style="flex:1"><div class="t">${p.level}. ${esc(p.title)}${done ? ' &middot; matched' : ''}</div><div class="n">${p.shafts} shafts, ${p.treadles} treadles, ${p.ends}&times;${p.picks}${p.structureOnly ? '' : ' &middot; colors matter'}${!done && started ? ' &middot; in progress' : ''}</div></div>`;
    b.onclick = () => enterPuzzle(p.id);
    wrap.append(b);
  });
  openSheet('Match the cloth', wrap);
}

/* ------------------------------------------------------------ selection bar */

function renderSelBar() {
  const bar = $('selBar');
  $('selectBtn').setAttribute('aria-pressed', String(ui.selecting));
  $('selectBtn').classList.toggle('on', ui.selecting);
  bar.style.display = ui.selecting ? 'block' : 'none';
  if (!ui.selecting) return;
  const s = ui.sel;
  let text = 'Tap the first and last end in the threading, or the first and last pick in the treadling.';
  if (s) {
    const lo = Math.min(s.a, s.b) + 1;
    const hi = Math.max(s.a, s.b) + 1;
    text = `${s.kind === 'ends' ? 'Ends' : 'Picks'} ${lo}${hi > lo ? `–${hi}` : ''} selected${s.done ? '' : ' (tap another to extend)'}.`;
  }
  bar.innerHTML = `<div class="hint">${esc(text)}</div>
    <div class="row">
      <button class="btn small" data-sel="repeat" ${s ? '' : 'aria-disabled="true"'}>Repeat</button>
      <button class="btn small" data-sel="mirror" ${s ? '' : 'aria-disabled="true"'}>Mirror</button>
      <button class="btn small" data-sel="up" ${s ? '' : 'aria-disabled="true"'}>Shift +1</button>
      <button class="btn small" data-sel="down" ${s ? '' : 'aria-disabled="true"'}>Shift &minus;1</button>
      <button class="btn small" data-sel="clear">Clear selection</button>
    </div>
    <div class="hint" style="margin-top:6px">Repeat fills everything after the range. Mirror writes a reversed copy after it. Shift moves shafts (or treadles) up or down.</div>`;
}
function bindSelBar() {
  $('selBar').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-sel]');
    if (!b) return;
    const s = ui.sel;
    const op = b.dataset.sel;
    if (op === 'clear') { ui.sel = null; renderAll(); return; }
    if (!s) return;
    const fn = { repeat: () => D.repeatRange(draft, s.kind, s.a, s.b), mirror: () => D.mirrorRange(draft, s.kind, s.a, s.b), up: () => D.shiftRange(draft, s.kind, s.a, s.b, 1), down: () => D.shiftRange(draft, s.kind, s.a, s.b, -1) }[op];
    commit(fn());
  });
}

/* ---------------------------------------------------------------- library */

function thumb(cv, d, size) {
  const ctx = fit(cv, size, size);
  const n = Math.min(16, d.threading.length, d.treadling.length);
  const cell = size / n;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ p: i, y: (n - 1 - i) * cell });
  drawClothRows(ctx, d, D.drawdown(d), { x0: 0, cell, rows, view: 'cloth', back: false, e0: 0, e1: n });
}

function openLibrary() {
  const wrap = document.createElement('div');
  wrap.className = 'stack';
  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'Name this draft';
  name.maxLength = 60;
  name.value = '';
  name.setAttribute('aria-label', 'Draft name');
  const save1 = document.createElement('button');
  save1.className = 'btn primary';
  save1.textContent = 'Save current draft';
  save1.onclick = () => {
    const nm = name.value.trim() || `Draft ${library.length + 1}`;
    library.unshift({ id: `d${Date.now().toString(36)}${library.length}`, name: nm, draft: JSON.parse(JSON.stringify(draft)) });
    saveLibrary();
    openLibrary();
  };
  const top = document.createElement('div');
  top.className = 'row';
  top.append(name, save1);
  name.style.flex = '1 1 160px';
  wrap.append(top);
  if (!library.length) {
    const p = document.createElement('p');
    p.className = 'caption';
    p.textContent = 'Nothing saved yet. Save a draft you like and it will wait for you here.';
    wrap.append(p);
  }
  library.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'libitem';
    const cv = document.createElement('canvas');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const d = D.normalizeDraft(it.draft);
    meta.innerHTML = `<b>${esc(it.name)}</b><span>${d.threading.length} ends &middot; ${d.treadling.length} picks &middot; ${d.shafts} shafts</span>`;
    const mk = (t, fn, cls = '') => { const b = document.createElement('button'); b.className = `btn small ${cls}`; b.textContent = t; b.onclick = fn; return b; };
    row.append(cv, meta,
      mk('Open', () => { closeSheet(); history.push(draft); draft = d; ui.shown = D.wovenCount(draft); save(); renderAll(); }, 'primary'),
      mk('Duplicate', () => { library.splice(library.indexOf(it) + 1, 0, { id: `d${Date.now().toString(36)}${library.length}`, name: `${it.name} (copy)`, draft: JSON.parse(JSON.stringify(it.draft)) }); saveLibrary(); openLibrary(); }),
      mk('Remove', () => { library = library.filter((x) => x !== it); saveLibrary(); openLibrary(); }));
    wrap.append(row);
    requestAnimationFrame(() => thumb(cv, d, 56));
  });
  openSheet('Draft library', wrap);
}

/* -------------------------------------------------------------------- WIF */

function openWif() {
  const wrap = document.createElement('div');
  wrap.className = 'stack';
  const title = document.createElement('input');
  title.type = 'text';
  title.placeholder = 'Title for the file (optional)';
  title.setAttribute('aria-label', 'Title');
  const exp = document.createElement('button');
  exp.className = 'btn primary';
  exp.textContent = 'Export .wif';
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.style.display = 'none';
  const say = (t) => { msg.textContent = t; msg.style.display = t ? 'block' : 'none'; };
  exp.onclick = () => {
    const text = W.writeWif(draft, { title: title.value.trim(), date: new Date().toDateString() });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (title.value.trim() || 'tincture-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft';
    a.href = url; a.download = `${slug}.wif`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Saved ${slug}.wif to your downloads.`);
  };
  const head = document.createElement('div');
  head.className = 'row';
  head.append(title, exp);
  title.style.flex = '1 1 160px';

  const ta = document.createElement('textarea');
  ta.id = 'wifText';
  ta.placeholder = 'Paste WIF text here, or pick a file below';
  ta.setAttribute('aria-label', 'WIF text');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.wif,.txt,text/plain';
  file.setAttribute('aria-label', 'Pick a WIF file');
  file.onchange = async () => { const f = file.files[0]; if (f) { ta.value = await f.text(); say(`Loaded ${f.name}. Tap Import to open it.`); } };
  const imp = document.createElement('button');
  imp.className = 'btn primary';
  imp.id = 'wifImport';
  imp.textContent = 'Import';
  imp.onclick = () => {
    try {
      const r = W.parseWif(ta.value);
      history.push(draft);
      draft = r.draft;
      ui.shown = D.wovenCount(draft);
      save();
      renderAll();
      say(`Opened ${r.title ? `“${r.title}”: ` : ''}${r.draft.threading.length} ends, ${r.draft.treadling.length} picks, ${r.draft.shafts} shafts.${r.warnings.length ? ' Notes: ' + r.warnings.join(' ') : ''}`);
    } catch (e) {
      say(`That text didn't read as a WIF draft yet. ${e.message}`);
    }
  };
  wrap.append(head, msg);
  if (!ui.puzzle) wrap.append(ta, file, imp);
  openSheet('WIF: weaving information file', wrap);
}

/* -------------------------------------------------------------------- main */

function renderAll() {
  renderControls();
  if (ui.weaving) {
    if (!anim.active) drawStage(0, true);
  } else {
    if (ui.puzzle) renderPuzzleCard(); else drawCloth();
    drawDraft();
    renderBrushes();
    renderSelBar();
  }
}

load();
loadStores();
ui.shown = D.wovenCount(draft);
bindControls();
initDraftInput();
renderAll();
let lastW = window.innerWidth;
window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; renderAll(); } });
if (document.fonts?.ready) document.fonts.ready.then(() => { if (!ui.weaving) drawDraft(); });
