// render.js — draws a knitting state (engine.js) on a canvas: the fabric as
// real stitches (right side or wrong side), a knitting chart, and a tube view
// for pieces knit in the round.

import { layout, rsOrder } from './engine.js';

const SW = 16; // stitch width in px at zoom 1
const SH = 12; // row height (knit stitches are wider than tall)

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xcccccc;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const t = f < 0 ? 0 : 255;
  const k = Math.abs(f);
  return `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
}
function lum(hex) { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

function sizeCanvas(canvas, w, h) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function yarnHex(s, id) { return (s.yarns.find((y) => y.id === id) || {}).hex || '#cccccc'; }

/** A yarn strand from a to b with body, shadow and highlight. */
function strand(ctx, pts, hex, w) {
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = shade(hex, -0.38); ctx.lineWidth = w + 1.4; ctx.stroke();
  path(); ctx.strokeStyle = hex; ctx.lineWidth = w; ctx.stroke();
  ctx.save(); ctx.translate(-w * 0.12, -w * 0.16);
  path(); ctx.strokeStyle = shade(hex, lum(hex) > 0.8 ? 0.55 : 0.3); ctx.globalAlpha = 0.55; ctx.lineWidth = w * 0.32; ctx.stroke();
  ctx.restore();
}

function knitV(ctx, cx, cy, w, h, hex, opts = {}) {
  const top = cy - h * 0.62 - (opts.tall ? h : 0);
  const bot = cy + h * 0.5;
  const bx = cx + (opts.dx || 0);
  const half = w * 0.4;
  const lw = w * 0.34;
  const tilt = opts.tilt || 0;
  const tl = [cx - half + tilt, top];
  const tr = [cx + half + tilt, top];
  if (opts.tbl) {
    strand(ctx, [tr, [bx - w * 0.1, bot]], hex, lw);
    strand(ctx, [tl, [bx + w * 0.1, bot]], hex, lw);
  } else {
    strand(ctx, [tl, [bx, bot]], hex, lw);
    strand(ctx, [tr, [bx, bot]], hex, lw);
    if (opts.double) { strand(ctx, [[tl[0] + w * 0.12, top + 2], [bx, bot - 1]], hex, lw * 0.7); strand(ctx, [[tr[0] - w * 0.12, top + 2], [bx, bot - 1]], hex, lw * 0.7); }
  }
}

function purlBump(ctx, cx, cy, w, h, hex, opts = {}) {
  const lw = h * 0.5;
  const y = cy + (opts.dy || 0);
  strand(ctx, [[cx - w * 0.46, y - h * 0.08], [cx - w * 0.15, y + h * 0.16], [cx + w * 0.15, y + h * 0.16], [cx + w * 0.46, y - h * 0.08]], hex, lw);
}

function hole(ctx, cx, cy, w, h, hex) {
  ctx.fillStyle = 'rgba(42,38,34,.62)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.05, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  strand(ctx, [[cx - w * 0.48, cy - h * 0.5], [cx, cy - h * 0.62], [cx + w * 0.48, cy - h * 0.5]], hex, h * 0.28);
}

/**
 * drawFabric(canvas, s, {face:'RS'|'WS', zoom, highlight}) -> {width, height, rowY(y)}.
 * Rows grow upward (the newest row at the top), like the work on the needles.
 */
export function drawFabric(canvas, s, opts = {}) {
  const face = opts.face || 'RS';
  const z = opts.zoom || 1;
  const w = SW * z;
  const h = SH * z;
  const L = layout(s);
  const pad = 16 * z;
  const cols = Math.max(1, L.maxX - L.minX + 1);
  const width = Math.max(opts.minWidth || 0, cols * w + pad * 2);
  const height = (L.maxY + 2) * h + pad * 2;
  const ctx = sizeCanvas(canvas, width, height);
  ctx.fillStyle = '#D8CFBE';
  ctx.fillRect(0, 0, width, height);
  const offX = (width - cols * w) / 2;
  const X = (x) => (face === 'RS' ? x - L.minX : L.maxX - x) * w + w / 2 + offX;
  const Y = (y) => pad + (L.maxY + 1 - y) * h;
  const flip = face === 'WS';
  const cells = s.cells.filter((c) => !Number.isNaN(L.x[c.id]));
  // Lower rows first; within a row, back cable stitches before front ones.
  cells.sort((a, b) => a.y - b.y || ((a.cable && a.cable.front) ? 1 : 0) - ((b.cable && b.cable.front) ? 1 : 0));
  for (const c of cells) {
    const cx = X(L.x[c.id]);
    const cy = Y(c.y);
    const hex = yarnHex(s, c.color);
    const appear = flip ? (c.face === 'k' ? 'p' : 'k') : c.face;
    if (c.castOn && c.pass === -1) {
      strand(ctx, [[cx - w * 0.45, cy + h * 0.1], [cx, cy + h * 0.35], [cx + w * 0.45, cy + h * 0.1]], hex, h * 0.4);
      continue;
    }
    if (c.bindOff) {
      strand(ctx, [[cx - w * 0.5, cy - h * 0.1], [cx + w * 0.4, cy - h * 0.35]], hex, h * 0.34);
      strand(ctx, [[cx - w * 0.5, cy - h * 0.1], [cx + w * 0.4, cy + h * 0.15]], hex, h * 0.34);
      continue;
    }
    let dx = 0;
    if (c.parents.length) {
      const px = c.top !== null && c.top !== undefined ? L.x[c.top] : c.parents.reduce((n, p) => n + L.x[p], 0) / c.parents.length;
      const raw = flip ? -(px - L.x[c.id]) : px - L.x[c.id];
      // Lean, never stretch: a stitch's foot moves at most most of a stitch toward where it came from.
      dx = Math.max(-0.75, Math.min(0.75, raw)) * w * 0.8;
    }
    if (c.cable && c.cable.front) { ctx.save(); ctx.shadowColor = 'rgba(42,38,34,.35)'; ctx.shadowBlur = 3 * z; ctx.shadowOffsetY = 1.5 * z; }
    if (c.yo && !c.parents.length) hole(ctx, cx, cy, w, h, hex);
    else if (c.slip) {
      // A slipped stitch stretches over two rows in its own color.
      if (appear === 'k') knitV(ctx, cx, cy, w, h, hex, { tall: true, dx });
      else purlBump(ctx, cx, cy, w, h, hex);
      if (c.slip.float && c.slip.float === face) strand(ctx, [[cx - w * 0.55, cy + h * 0.1], [cx + w * 0.55, cy + h * 0.1]], yarnHex(s, c.slip.yarn), h * 0.3);
      if (c.shawl) strand(ctx, [[cx - w * 0.4, cy - h * 0.3], [cx, cy + h * 0.2], [cx + w * 0.4, cy - h * 0.3]], yarnHex(s, c.shawl), h * 0.28);
    } else if (c.brioche === 'k' && appear === 'k') knitV(ctx, cx, cy, w, h, hex, { tall: true, dx });
    else if (appear === 'k') knitV(ctx, cx, cy, w, h, hex, { dx, tbl: c.tbl, double: c.double, tilt: c.lean && !c.parents.length ? (c.lean === 'L' ? -1 : 1) * w * 0.12 * (flip ? -1 : 1) : 0 });
    else purlBump(ctx, cx, cy, w, h, hex);
    if (c.cable && c.cable.front) ctx.restore();
    if (c.wrapped) strand(ctx, [[cx - w * 0.45, cy + h * 0.32], [cx + w * 0.45, cy + h * 0.32]], hex, h * 0.22);
  }
  // Stranded colorwork floats lie on the wrong side.
  if (flip) drawFloats(ctx, s, L, X, Y, w, h);
  if (opts.highlight !== undefined && opts.highlight !== null && s.cells[opts.highlight]) {
    const c = s.cells[opts.highlight];
    if (!Number.isNaN(L.x[c.id])) {
      ctx.strokeStyle = '#E2B04A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(X(L.x[c.id]), Y(c.y), w * 0.7, h * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return { width, height, rowTop: (y) => Y(y) - h, layout: L };
}

function drawFloats(ctx, s, L, X, Y, w, h) {
  for (const pass of s.passes) {
    const ids = rsOrder(s, pass).filter((id) => !s.cells[id].slip && !s.cells[id].bindOff);
    const byColor = new Map();
    for (const id of ids) { const c = s.cells[id]; if (!byColor.has(c.color)) byColor.set(c.color, []); byColor.get(c.color).push(c); }
    if (byColor.size < 2) continue;
    for (const [color, list] of byColor) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        if (Math.abs(L.x[b.id] - L.x[a.id]) < 1.5) continue;
        const y = Y(a.y) + h * 0.15;
        strand(ctx, [[X(L.x[a.id]), y], [X(L.x[b.id]), y]], yarnHex(s, color), h * 0.26);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chart (as seen from the right side; RS rows read right to left)
// ---------------------------------------------------------------------------

const SYMBOL = {
  k2tog: '/', k3tog: '/', p2tog: '/', sk2p: '\\', sssk: '\\', ssk: '\\', ssp: '\\', s2kp: 'Λ', p3tog: '/',
  m1l: 'ML', m1r: 'MR', m1lp: 'ML', m1rp: 'MR', lli: 'L', rli: 'R', kfb: 'Y', pfb: 'Y', co: 'ω', brk: '∩', brp: '∪', sl1yo: 'V',
};

export function drawChart(canvas, s, opts = {}) {
  const z = opts.zoom || 1;
  const cs = Math.round(18 * z);
  const L = layout(s);
  const passes = s.passes.filter((p) => p.cells.length);
  const cols = Math.round(L.maxX - L.minX) + 1;
  const padL = 34;
  const padR = 34;
  const width = Math.max(opts.minWidth || 0, cols * cs + padL + padR);
  const height = passes.length * cs + 24;
  const ctx = sizeCanvas(canvas, width, height);
  ctx.fillStyle = '#FBF8F1';
  ctx.fillRect(0, 0, width, height);
  const ox = (width - cols * cs) / 2;
  // "No stitch" background.
  ctx.fillStyle = '#CFC7B8';
  ctx.fillRect(ox, 12, cols * cs, passes.length * cs);
  ctx.font = `600 ${Math.round(cs * 0.55)}px Figtree, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cables = [];
  passes.forEach((pass, i) => {
    const top = 12 + (passes.length - 1 - i) * cs;
    for (const id of rsOrder(s, pass)) {
      const c = s.cells[id];
      if (c.bindOff && c.parents.length === 0) continue;
      const col = Math.round(L.x[id] - L.minX);
      const x = ox + col * cs;
      const hex = yarnHex(s, c.color);
      ctx.fillStyle = shade(hex, 0.55);
      ctx.fillRect(x, top, cs, cs);
      ctx.strokeStyle = 'rgba(42,38,34,.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, cs - 1, cs - 1);
      ctx.fillStyle = '#2A2622';
      ctx.strokeStyle = '#2A2622';
      const mx = x + cs / 2;
      const my = top + cs / 2;
      if (c.bindOff) { ctx.beginPath(); ctx.arc(mx, my + cs * 0.15, cs * 0.25, Math.PI, 0); ctx.stroke(); }
      else if (c.yo) { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(mx, my, cs * 0.27, 0, Math.PI * 2); ctx.stroke(); }
      else if (c.cable) {
        cables.push({ c, mx, top, col });
        if (c.face === 'p') { ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.fill(); }
      } else if (c.slip) ctx.fillText('V', mx, my + 1);
      else if (SYMBOL[c.op]) ctx.fillText(SYMBOL[c.op], mx, my + 1);
      else if (c.tbl) ctx.fillText('β', mx, my + 1);
      else if (c.face === 'p') { ctx.beginPath(); ctx.arc(mx, my, cs * 0.12, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#6B635A';
    ctx.font = `600 ${Math.round(cs * 0.5)}px Figtree, system-ui, sans-serif`;
    // RS row numbers on the right, WS on the left; rounds on the right.
    const label = String(pass.number);
    if (pass.side === 'RS') ctx.fillText(label, ox + cols * cs + 14, top + cs / 2);
    else ctx.fillText(label, ox - 14, top + cs / 2);
    ctx.font = `600 ${Math.round(cs * 0.55)}px Figtree, system-ui, sans-serif`;
  });
  // Cable crossings on top of the cells: each stitch's line runs from where it
  // came from (bottom) to where it lands (top); the front ones drawn bold, last.
  cables.sort((a, b) => (a.c.cable.front ? 1 : 0) - (b.c.cable.front ? 1 : 0));
  for (const { c, mx, top } of cables) {
    const from = ox + Math.round(L.x[c.parents[0]] - L.minX) * cs + cs / 2;
    ctx.strokeStyle = c.cable.front ? '#2A2622' : 'rgba(42,38,34,.55)';
    ctx.lineWidth = c.cable.front ? 3 : 1.6;
    ctx.lineCap = 'round';
    if (c.cable.front) {
      ctx.save(); ctx.strokeStyle = '#FBF8F1'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(from, top + cs - 2); ctx.lineTo(mx, top + 2); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(from, top + cs - 2); ctx.lineTo(mx, top + 2); ctx.stroke();
  }
  return { width, height };
}

// ---------------------------------------------------------------------------
// Tube: a piece knit in the round, seen as the object (a hat, a sock leg)
// ---------------------------------------------------------------------------

export function drawTube(canvas, s, opts = {}) {
  const z = opts.zoom || 1;
  const w = SW * z * 0.9;
  const h = SH * z * 0.9;
  const L = layout(s);
  const rows = new Map();
  for (const c of s.cells) {
    if (Number.isNaN(L.x[c.id]) || c.bindOff) continue;
    const key = c.pass;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(c);
  }
  let maxN = 1;
  for (const r of rows.values()) maxN = Math.max(maxN, r.length);
  const R0 = (maxN * w) / (2 * Math.PI);
  const width = Math.max(opts.minWidth || 0, R0 * 2 + 60);
  const height = (L.maxY + 2) * h + 60;
  const ctx = sizeCanvas(canvas, width, height);
  ctx.fillStyle = '#D8CFBE';
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const drawList = [];
  for (const [, list] of rows) {
    // A round's circumference is its stitch count: fewer stitches, a smaller circle (a crown closes).
    const ordered = list.slice().sort((a, b) => L.x[a.id] - L.x[b.id]);
    const n = ordered.length;
    const R = (n * w) / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const c = ordered[i];
      const theta = ((i + 0.5) / n) * Math.PI * 2 + (opts.spin || 0);
      const depth = Math.cos(theta);
      if (depth < -0.05) continue;
      drawList.push({ c, sx: cx + R * Math.sin(theta), sy: 30 + (L.maxY + 1 - c.y) * h, depth, n });
    }
  }
  drawList.sort((a, b) => a.depth - b.depth);
  for (const d of drawList) {
    const hex = shade(yarnHex(s, d.c.color), -0.35 * (1 - d.depth));
    const ww = Math.max(2, w * Math.max(0.15, d.depth));
    if (d.c.face === 'k') knitV(ctx, d.sx, d.sy, ww, h, hex, { tall: !!d.c.slip });
    else purlBump(ctx, d.sx, d.sy, ww, h, hex);
  }
  return { width, height };
}
