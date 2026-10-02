// canvases.js — Gallery canvas designs (pure data, generated at import time).
// Implements docs/DESIGN.md "The Gallery › Painting" (line-art designs split
// into 12 to 60 regions; larger regions use more jars) and "Where canvases
// come from" (6 starters, a canvas every 20 colors, one per completed postcard
// set, 2 per weekly event, large Heritage canvases). Art direction: flat
// papercut panes with ink leading on top (docs/prototypes/Gallery.dc.html).
//
// Canvas: { id, name, kind, frame, viewBox: '0 0 300 400',
//           regions: [{ id: 'r0', d: '<svg path>', size: 1|2|3 }],
//           outline: '<svg path of the whole design, for the backing/frame>',
//           leading: '<svg path for ink lines, drawn on top>',
//           unlock: { type: 'start'|'milestone'|'postcards'|'commission'|'event'|'heritage', n?|region?|id? },
//           suggestedPalette: [hue family] }
//
// Geometry comes from the small helpers below (grid, rings, bands, hexes,
// leaves...) so designs are a few lines each; the exported data is plain
// arrays of {id, d, size}. Regions never overlap. `size` is by area:
// under 1800 square units is 1, under 4500 is 2, otherwise 3.

const VIEWBOX = '0 0 300 400';
const SMALL = 1800;
const MEDIUM = 4500;

// ---------------------------------------------------------------------------
// Path helpers. Every helper returns { d, area }.
// ---------------------------------------------------------------------------

const num = (n) => {
  const r = Math.round(n * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
};
const pt = ([x, y]) => `${num(x)} ${num(y)}`;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Point at radius r and angle a (degrees clockwise from 12 o'clock). */
const polar = (cx, cy, r, a) => {
  const rad = (a * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
};

function shoelace(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Closed polygon. */
function poly(points) {
  return { d: 'M' + points.map(pt).join(' L') + ' Z', area: shoelace(points) };
}

function rect(x, y, w, h) {
  return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
}

function roundRect(x, y, w, h, r) {
  const d = `M${pt([x + r, y])} H${num(x + w - r)} A${r} ${r} 0 0 1 ${pt([x + w, y + r])}` +
    ` V${num(y + h - r)} A${r} ${r} 0 0 1 ${pt([x + w - r, y + h])} H${num(x + r)}` +
    ` A${r} ${r} 0 0 1 ${pt([x, y + h - r])} V${num(y + r)} A${r} ${r} 0 0 1 ${pt([x + r, y])} Z`;
  return { d, area: w * h - (4 - Math.PI) * r * r };
}

function circle(cx, cy, r) {
  return {
    d: `M${pt([cx - r, cy])} A${r} ${r} 0 1 1 ${pt([cx + r, cy])} A${r} ${r} 0 1 1 ${pt([cx - r, cy])} Z`,
    area: Math.PI * r * r,
  };
}

function ellipse(cx, cy, rx, ry) {
  return {
    d: `M${pt([cx, cy - ry])} A${rx} ${ry} 0 1 1 ${pt([cx, cy + ry])} A${rx} ${ry} 0 1 1 ${pt([cx, cy - ry])} Z`,
    area: Math.PI * rx * ry,
  };
}

/** Annular sector (r0 = 0 gives a pie slice) from angle a0 to a1 clockwise. */
function wedge(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const area = 0.5 * (r1 * r1 - r0 * r0) * ((a1 - a0) * Math.PI) / 180;
  if (r0 <= 0) {
    return {
      d: `M${pt([cx, cy])} L${pt(polar(cx, cy, r1, a0))} A${r1} ${r1} 0 ${large} 1 ${pt(polar(cx, cy, r1, a1))} Z`,
      area,
    };
  }
  return {
    d: `M${pt(polar(cx, cy, r0, a0))} L${pt(polar(cx, cy, r1, a0))} A${r1} ${r1} 0 ${large} 1 ${pt(polar(cx, cy, r1, a1))}` +
      ` L${pt(polar(cx, cy, r0, a1))} A${r0} ${r0} 0 ${large} 0 ${pt(polar(cx, cy, r0, a0))} Z`,
    area,
  };
}

/** Concentric rings split into wedges: specs [{r0, r1, n, offset?}];
 *  a ring with r0 = 0 and n = 1 is a full disc. */
function rings(cx, cy, specs) {
  const out = [];
  for (const { r0, r1, n, offset = 0 } of specs) {
    if (r0 === 0 && n === 1) { out.push(circle(cx, cy, r1)); continue; }
    const step = 360 / n;
    for (let i = 0; i < n; i++) out.push(wedge(cx, cy, r0, r1, offset + i * step, offset + (i + 1) * step));
  }
  return out;
}

/** cols x rows cells (rounded when radius > 0) with a gap between them. */
function grid(x, y, w, h, cols, rows, { gap = 0, radius = 0 } = {}) {
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = x + i * (cw + gap);
      const cy = y + j * (ch + gap);
      out.push(radius > 0 ? roundRect(cx, cy, cw, ch, radius) : rect(cx, cy, cw, ch));
    }
  }
  return out;
}

/** Quadratic Bezier point. */
const qAt = (p0, c, p1, t) => [
  (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
  (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
];
const sampleQ = (p0, c, p1, n = 12) => Array.from({ length: n }, (_, i) => qAt(p0, c, p1, (i + 1) / n));

/** A closed shape of straight and quadratic segments: start, then
 *  [x, y] (line) or [cx, cy, x, y] (quadratic) items. */
function qshape(start, segs) {
  let d = `M${pt(start)}`;
  const samples = [start];
  let cur = start;
  for (const s of segs) {
    if (s.length === 2) { d += ` L${pt(s)}`; samples.push(s); cur = s; }
    else {
      const c = [s[0], s[1]];
      const p = [s[2], s[3]];
      d += ` Q${pt(c)} ${pt(p)}`;
      samples.push(...sampleQ(cur, c, p));
      cur = p;
    }
  }
  return { d: d + ' Z', area: shoelace(samples) };
}

/** Unit normal (left of the direction a -> b). */
function normal(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

/** Almond leaf from base to tip, bulging `bulge` units on each side. */
function leaf(base, tip, bulge) {
  const mid = lerp(base, tip, 0.5);
  const n = normal(base, tip);
  const c1 = [mid[0] + n[0] * bulge * 2, mid[1] + n[1] * bulge * 2];
  const c2 = [mid[0] - n[0] * bulge * 2, mid[1] - n[1] * bulge * 2];
  return qshape(base, [[...c1, ...tip], [...c2, ...base]]);
}

/** A leaf split into four regions by its midrib and two side veins. */
function veinedLeaf(base, tip, bulge) {
  const mid = lerp(base, tip, 0.5);
  const rib = lerp(base, tip, 0.62);
  const n = normal(base, tip);
  const out = [];
  for (const side of [1, -1]) {
    const c = [mid[0] + side * n[0] * bulge * 2, mid[1] + side * n[1] * bulge * 2];
    // de Casteljau split of base -> c -> tip at t = 0.5.
    const ca = lerp(base, c, 0.5);
    const cb = lerp(c, tip, 0.5);
    const e = lerp(ca, cb, 0.5);
    out.push(qshape(base, [[...ca, ...e], rib]));
    out.push(qshape(rib, [e, [...cb, ...tip]]));
  }
  return out;
}

/** Petal from the rim of a center disc (radius r0) out to a tip at radius r1. */
function petal(cx, cy, r0, r1, a, half, ctrlR, ctrlHalf) {
  const b1 = polar(cx, cy, r0, a - half);
  const b2 = polar(cx, cy, r0, a + half);
  const c1 = polar(cx, cy, ctrlR, a - ctrlHalf);
  const c2 = polar(cx, cy, ctrlR, a + ctrlHalf);
  const tip = polar(cx, cy, r1, a);
  const theta = (2 * half * Math.PI) / 180;
  const segment = (r0 * r0 / 2) * (theta - Math.sin(theta));
  const samples = [b1, ...sampleQ(b1, c1, tip), ...sampleQ(tip, c2, b2)];
  return {
    d: `M${pt(b1)} Q${pt(c1)} ${pt(tip)} Q${pt(c2)} ${pt(b2)} A${r0} ${r0} 0 0 0 ${pt(b1)} Z`,
    area: shoelace(samples) - segment,
  };
}

/** Horizontal bands between chevron (zigzag) seams, each split into `cols`.
 *  2 * teeth must be divisible by cols so splits land on seam vertices. */
function bands(x, y, w, h, n, { teeth = 5, amp = 10, cols = 1 } = {}) {
  const steps = teeth * 2;
  const seam = (k) => Array.from({ length: steps + 1 }, (_, t) => {
    const flat = k === 0 || k === n;
    return [x + (w * t) / steps, y + (h * k) / n + (flat ? 0 : (t % 2 ? amp / 2 : -amp / 2))];
  });
  const per = steps / cols;
  const out = [];
  for (let k = 0; k < n; k++) {
    const top = seam(k);
    const bottom = seam(k + 1);
    for (let c = 0; c < cols; c++) {
      const a = c * per;
      const b = (c + 1) * per;
      out.push(poly([...top.slice(a, b + 1), ...bottom.slice(a, b + 1).reverse()]));
    }
  }
  return out;
}

/** Rows between gentle wave seams (sampled), split into equal columns. */
function waveRows(x, y, w, h, cols, rows, amp) {
  const samplesPerCol = 6;
  const steps = cols * samplesPerCol;
  const seam = (k) => Array.from({ length: steps + 1 }, (_, t) => {
    const flat = k === 0 || k === rows;
    const px = x + (w * t) / steps;
    const wave = flat ? 0 : amp * Math.sin(((t / steps) * 2 + k * 0.45) * Math.PI);
    return [px, y + (h * k) / rows + wave];
  });
  const out = [];
  for (let k = 0; k < rows; k++) {
    const top = seam(k);
    const bottom = seam(k + 1);
    for (let c = 0; c < cols; c++) {
      const a = c * samplesPerCol;
      const b = a + samplesPerCol;
      out.push(poly([...top.slice(a, b + 1), ...bottom.slice(a, b + 1).reverse()]));
    }
  }
  return out;
}

/** Deterministic integer hash -> [0, 1). */
function hash01(i, j, k) {
  let h = Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(j + 0x7f4a, 0xc2b2ae35) ^ Math.imul(k + 0x1b87, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Grid whose interior vertices are nudged, like hand-cut map fields. */
function jitterGrid(x, y, w, h, cols, rows, jitter, seed) {
  const v = (i, j) => {
    const edgeX = i === 0 || i === cols;
    const edgeY = j === 0 || j === rows;
    const jx = edgeX ? 0 : (hash01(i, j, seed) * 2 - 1) * jitter;
    const jy = edgeY ? 0 : (hash01(i, j, seed + 1) * 2 - 1) * jitter;
    return [x + (w * i) / cols + jx, y + (h * j) / rows + jy];
  };
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) out.push(poly([v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)]));
  }
  return out;
}

/** Pointy-top hexagon. */
function hexagon(cx, cy, r) {
  return poly(Array.from({ length: 6 }, (_, i) => polar(cx, cy, r, i * 60)));
}

/** Offset rows of pointy-top hexagons; cell radius R, drawn radius r. */
function hexGrid(cx, cy, cols, rows, R, r = R) {
  const hw = Math.sqrt(3) * R;
  const totalW = hw * (cols + 0.5);
  const totalH = 2 * R + 1.5 * R * (rows - 1);
  const x0 = cx - totalW / 2 + hw / 2;
  const y0 = cy - totalH / 2 + R;
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) out.push(hexagon(x0 + i * hw + (j % 2 ? hw / 2 : 0), y0 + j * 1.5 * R, r));
  }
  return out;
}

/** Each cell of a cols x rows grid split into two triangles along a diagonal
 *  (alternating direction makes the classic pinwheel quilt). */
function triangleQuilt(x, y, w, h, cols, rows) {
  const cw = w / cols;
  const ch = h / rows;
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = [x + i * cw, y + j * ch];
      const b = [a[0] + cw, a[1]];
      const c = [a[0] + cw, a[1] + ch];
      const d = [a[0], a[1] + ch];
      if ((i + j) % 2) out.push(poly([a, b, d]), poly([b, c, d]));
      else out.push(poly([a, b, c]), poly([a, c, d]));
    }
  }
  return out;
}

/** Each cell of a grid split into four triangles by both diagonals (trellis). */
function crossGrid(x, y, w, h, cols, rows) {
  const cw = w / cols;
  const ch = h / rows;
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = [x + i * cw, y + j * ch];
      const b = [a[0] + cw, a[1]];
      const c = [a[0] + cw, a[1] + ch];
      const d = [a[0], a[1] + ch];
      const m = [a[0] + cw / 2, a[1] + ch / 2];
      out.push(poly([a, b, m]), poly([b, c, m]), poly([c, d, m]), poly([d, a, m]));
    }
  }
  return out;
}

/** Round-topped window: a fan of `fan` wedges (around a hub of radius `hub`,
 *  if any) over a cols x rows grid of rectangular panes. */
function archWindow({ x0, x1, cy, y1, fan, hub = 0, fanRings = null, cols, rows }) {
  const cx = (x0 + x1) / 2;
  const r = (x1 - x0) / 2;
  const out = [];
  if (hub > 0) out.push(wedge(cx, cy, 0, hub, -90, 90));
  const ringSpecs = fanRings || [{ r0: hub, r1: r, n: fan }];
  for (const { r0, r1, n } of ringSpecs) {
    const step = 180 / n;
    for (let i = 0; i < n; i++) out.push(wedge(cx, cy, r0, r1, -90 + i * step, -90 + (i + 1) * step));
  }
  out.push(...grid(x0, cy, x1 - x0, y1 - cy, cols, rows));
  return out;
}

/** Outline of a round-topped window. */
function archOutline(x0, x1, cy, y1) {
  const r = (x1 - x0) / 2;
  return `M${num(x0)} ${num(y1)} V${num(cy)} A${num(r)} ${num(r)} 0 0 1 ${num(x1)} ${num(cy)} V${num(y1)} Z`;
}

/** Four corner spandrels between a circle and its bounding square. */
function spandrels(cx, cy, r) {
  const k = r * r * (1 - Math.PI / 4);
  const T = [cx, cy - r];
  const B = [cx, cy + r];
  const Lp = [cx - r, cy];
  const Rp = [cx + r, cy];
  return [
    { d: `M${pt([cx - r, cy - r])} L${pt(T)} A${r} ${r} 0 0 0 ${pt(Lp)} Z`, area: k },
    { d: `M${pt([cx + r, cy - r])} L${pt(Rp)} A${r} ${r} 0 0 0 ${pt(T)} Z`, area: k },
    { d: `M${pt([cx + r, cy + r])} L${pt(B)} A${r} ${r} 0 0 0 ${pt(Rp)} Z`, area: k },
    { d: `M${pt([cx - r, cy + r])} L${pt(Lp)} A${r} ${r} 0 0 0 ${pt(B)} Z`, area: k },
  ];
}

/** Equilateral pointed arch over [x, x + w] springing at y. */
function pointedArch(x, y, w) {
  const apex = [x + w / 2, y - (w * Math.sqrt(3)) / 2];
  return {
    d: `M${pt([x, y])} A${num(w)} ${num(w)} 0 0 1 ${pt(apex)} A${num(w)} ${num(w)} 0 0 1 ${pt([x + w, y])} Z`,
    area: w * w * (Math.PI / 3 - Math.sqrt(3) / 4),
  };
}

/** A paper lantern split into three lobes by two ribs. */
function lantern(cx, cy, rx, ry, rib) {
  const top = [cx, cy - ry];
  const bot = [cx, cy + ry];
  const side = (Math.PI * (rx - rib) * ry) / 2;
  return [
    { d: `M${pt(top)} A${rx} ${ry} 0 0 0 ${pt(bot)} A${rib} ${ry} 0 0 1 ${pt(top)} Z`, area: side },
    ellipse(cx, cy, rib, ry),
    { d: `M${pt(top)} A${rx} ${ry} 0 0 1 ${pt(bot)} A${rib} ${ry} 0 0 0 ${pt(top)} Z`, area: side },
  ];
}

/** A scalloped awning stripe: rectangle with a curved lower edge. */
function awningStripe(x, y, w, h, drop) {
  return qshape([x, y], [[x + w, y], [x + w, y + h], [x + w / 2, y + h + drop * 2, x, y + h]]);
}

// ---------------------------------------------------------------------------
// Canvas assembly
// ---------------------------------------------------------------------------

const sizeOf = (area) => (area < SMALL ? 1 : area < MEDIUM ? 2 : 3);

function canvas({ id, name, kind, frame, unlock, palette, shapes, outline, extraLeading = '', leading = null }) {
  const regions = shapes.map((s, i) => Object.freeze({ id: 'r' + i, d: s.d, size: sizeOf(s.area) }));
  const ink = leading || [outline, ...regions.map((r) => r.d), extraLeading].filter(Boolean).join(' ');
  return Object.freeze({
    id, name, kind, frame, viewBox: VIEWBOX,
    regions: Object.freeze(regions),
    outline,
    leading: ink,
    unlock: Object.freeze(unlock),
    suggestedPalette: Object.freeze(palette),
  });
}

const rectOutline = (x, y, w, h) => `M${num(x)} ${num(y)} H${num(x + w)} V${num(y + h)} H${num(x)} Z`;
const circleOutline = (cx, cy, r) => circle(cx, cy, r).d;
const hexOutline = (cx, cy, r) => hexagon(cx, cy, r).d;

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

/** The 16-pane harbor window from docs/prototypes/Gallery.dc.html, verbatim. */
function harborWindow() {
  const panes = [
    { d: 'M132 110 A18 18 0 1 1 168 110 A18 18 0 1 1 132 110 Z', area: 1018 },
    { d: 'M150 70 A40 40 0 0 1 190 110 L168 110 A18 18 0 0 0 150 92 Z', area: 1002 },
    { d: 'M190 110 A40 40 0 0 1 150 150 L150 128 A18 18 0 0 0 168 110 Z', area: 1002 },
    { d: 'M150 150 A40 40 0 0 1 110 110 L132 110 A18 18 0 0 0 150 128 Z', area: 1002 },
    { d: 'M110 110 A40 40 0 0 1 150 70 L150 92 A18 18 0 0 0 132 110 Z', area: 1002 },
    { d: 'M40 160 L40 130 A110 110 0 0 1 150 20 L150 70 A40 40 0 0 0 110 110 A40 40 0 0 0 150 150 L150 160 Z', area: 9300 },
    { d: 'M260 160 L260 130 A110 110 0 0 0 150 20 L150 70 A40 40 0 0 1 190 110 A40 40 0 0 1 150 150 L150 160 Z', area: 9300 },
    rect(40, 160, 73, 66),
    rect(40, 226, 73, 68),
    rect(40, 294, 73, 66),
    rect(187, 160, 73, 66),
    rect(187, 226, 73, 68),
    rect(187, 294, 73, 66),
    { d: 'M113 160 L187 160 L187 260 L150 200 L113 260 Z', area: 5180 },
    { d: 'M150 200 L187 260 L150 320 L113 260 Z', area: 4440 },
    { d: 'M113 360 L187 360 L187 260 L150 320 L113 260 Z', area: 5180 },
  ];
  const leading = [
    'M40 360 L40 130 A110 110 0 0 1 260 130 L260 360 Z',
    'M110 110 A40 40 0 1 1 190 110 A40 40 0 1 1 110 110 Z',
    'M132 110 A18 18 0 1 1 168 110 A18 18 0 1 1 132 110 Z',
    'M150 20 L150 92 M150 128 L150 160 M110 110 L132 110 M168 110 L190 110',
    'M40 160 L260 160 M113 160 L113 360 M187 160 L187 360 M40 226 L113 226 M40 294 L113 294 M187 226 L260 226 M187 294 L260 294',
    'M150 200 L187 260 L150 320 L113 260 Z',
  ].join(' ');
  return canvas({
    id: 'harbor-window', name: 'Harbor Window', kind: 'window', frame: 'window', unlock: { type: 'start' },
    palette: ['blue', 'teal', 'yellow', 'neutral'], shapes: panes,
    outline: 'M40 360 L40 130 A110 110 0 0 1 260 130 L260 360 Z', leading,
  });
}

function tileMosaic() {
  return canvas({
    id: 'tile-mosaic', name: 'Tile Mosaic', kind: 'mosaic', frame: 'tile', unlock: { type: 'start' },
    palette: ['red', 'orange', 'yellow', 'neutral'],
    shapes: grid(24, 44, 252, 312, 5, 6, { gap: 6, radius: 6 }),
    outline: rectOutline(16, 36, 268, 328),
  });
}

function paintedPlate() {
  return canvas({
    id: 'painted-plate', name: 'Painted Plate', kind: 'plate', frame: 'plate', unlock: { type: 'start' },
    palette: ['blue', 'yellow', 'neutral'],
    shapes: rings(150, 200, [{ r0: 0, r1: 32, n: 1 }, { r0: 32, r1: 78, n: 5 }, { r0: 78, r1: 125, n: 6, offset: 30 }]),
    outline: circleOutline(150, 200, 136),
  });
}

function patchworkQuilt() {
  return canvas({
    id: 'patchwork-quilt', name: 'Patchwork Quilt', kind: 'quilt', frame: 'quilt', unlock: { type: 'start' },
    palette: ['red', 'pink', 'yellow', 'green'],
    shapes: triangleQuilt(30, 50, 240, 300, 4, 5),
    outline: rectOutline(22, 42, 256, 316),
  });
}

function tapestry() {
  return canvas({
    id: 'tapestry', name: 'Woven Tapestry', kind: 'tapestry', frame: 'tapestry', unlock: { type: 'start' },
    palette: ['red', 'orange', 'violet', 'neutral'],
    shapes: bands(40, 40, 220, 330, 9, { teeth: 5, amp: 12, cols: 2 }),
    outline: rectOutline(40, 40, 220, 330),
    extraLeading: 'M28 32 H272',
  });
}

function botanicalPrint() {
  const cx = 150;
  const cy = 110;
  const shapes = [circle(cx, cy, 22)];
  for (let i = 0; i < 6; i++) shapes.push(petal(cx, cy, 22, 72, i * 60, 22, 52, 26));
  shapes.push(rect(146, 186, 8, 166));
  for (const by of [232, 282, 332]) shapes.push(leaf([146, by], [68, by - 34], 13));
  for (const by of [212, 262, 312]) shapes.push(leaf([154, by], [232, by - 34], 13));
  shapes.push(rect(40, 352, 110, 20), rect(150, 352, 110, 20));
  return canvas({
    id: 'botanical-print', name: 'Botanical Print', kind: 'print', frame: 'print', unlock: { type: 'start' },
    palette: ['green', 'pink', 'yellow'], shapes,
    outline: rectOutline(28, 24, 244, 360),
    extraLeading: 'M150 132 V186',
  });
}

// Milestones: a new canvas every 20 colors.

function roseWindow() {
  const cx = 150;
  const cy = 160;
  const r = 110;
  const shapes = [
    ...rings(cx, cy, [{ r0: 0, r1: 30, n: 1 }, { r0: 30, r1: 68, n: 6 }, { r0: 68, r1: r, n: 12, offset: 15 }]),
    ...spandrels(cx, cy, r),
    rect(40, 282, 220, 84),
  ];
  return canvas({
    id: 'rose-window', name: 'Rose Window', kind: 'window', frame: 'window', unlock: { type: 'milestone', n: 20 },
    palette: ['red', 'blue', 'violet', 'yellow'], shapes,
    outline: rectOutline(40, 50, 220, 316),
  });
}

function mapTile() {
  return canvas({
    id: 'map-tile', name: 'Map Tile', kind: 'mosaic', frame: 'tile', unlock: { type: 'milestone', n: 40 },
    palette: ['green', 'yellow', 'teal', 'neutral'],
    shapes: jitterGrid(30, 40, 240, 320, 4, 5, 16, 11),
    outline: rectOutline(30, 40, 240, 320),
  });
}

function lanternRow() {
  const shapes = [];
  const ys = [204, 230, 192, 230, 204];
  const ry = 64;
  const stringY = (x) => {
    const t = (x - 12) / 276;
    return 92 + 96 * t * (1 - t);
  };
  ys.forEach((cy, i) => shapes.push(...lantern(42 + 54 * i, cy, 23, ry, 8)));
  const hangers = ys.map((cy, i) => `M${42 + 54 * i} ${cy - ry} V${num(stringY(42 + 54 * i))}`).join(' ');
  const caps = ys.map((cy, i) => `M${30 + 54 * i} ${cy - ry} H${54 + 54 * i} M${30 + 54 * i} ${cy + ry} H${54 + 54 * i}`).join(' ');
  return canvas({
    id: 'lantern-row', name: 'Lantern Row', kind: 'print', frame: 'print', unlock: { type: 'milestone', n: 60 },
    palette: ['orange', 'red', 'yellow'], shapes,
    outline: rectOutline(12, 70, 276, 250),
    extraLeading: `M12 92 Q150 140 288 92 ${hangers} ${caps}`,
  });
}

function riverQuilt() {
  return canvas({
    id: 'river-quilt', name: 'River Quilt', kind: 'quilt', frame: 'quilt', unlock: { type: 'milestone', n: 80 },
    palette: ['blue', 'teal', 'green', 'neutral'],
    shapes: waveRows(30, 50, 240, 300, 6, 5, 9),
    outline: rectOutline(22, 42, 256, 316),
  });
}

function sunburstPlate() {
  return canvas({
    id: 'sunburst-plate', name: 'Sunburst Plate', kind: 'plate', frame: 'plate', unlock: { type: 'milestone', n: 100 },
    palette: ['yellow', 'orange', 'red'],
    shapes: rings(150, 200, [{ r0: 0, r1: 28, n: 1 }, { r0: 28, r1: 128, n: 15 }]),
    outline: circleOutline(150, 200, 138),
  });
}

// Postcard sets: each completed region set unlocks a canvas of that place.

function meadowWindow() {
  return canvas({
    id: 'meadow-window', name: 'Meadow Window', kind: 'window', frame: 'window', unlock: { type: 'postcards', region: 'meadow' },
    palette: ['green', 'yellow', 'pink'],
    shapes: archWindow({ x0: 50, x1: 250, cy: 140, y1: 370, fan: 6, cols: 3, rows: 4 }),
    outline: archOutline(50, 250, 140, 370),
  });
}

function quarryMosaic() {
  const rows = [[0.28, 0.22, 0.3, 0.2], [0.2, 0.32, 0.24, 0.24], [0.3, 0.2, 0.22, 0.28], [0.24, 0.26, 0.3, 0.2], [0.22, 0.3, 0.2, 0.28]];
  const x0 = 26;
  const w = 248;
  const gap = 5;
  const h = (312 - gap * 4) / 5;
  const shapes = [];
  rows.forEach((fr, j) => {
    const usable = w - gap * (fr.length - 1);
    let x = x0;
    for (const f of fr) {
      const bw = usable * f;
      shapes.push(roundRect(x, 44 + j * (h + gap), bw, h, 4));
      x += bw + gap;
    }
  });
  return canvas({
    id: 'quarry-mosaic', name: 'Quarry Mosaic', kind: 'mosaic', frame: 'tile', unlock: { type: 'postcards', region: 'quarry' },
    palette: ['orange', 'yellow', 'neutral'], shapes,
    outline: rectOutline(18, 36, 264, 328),
  });
}

function coastWindow() {
  const shapes = [circle(150, 52, 20)];
  const lw = 40;
  const gap = 12;
  for (let i = 0; i < 4; i++) {
    const x = 52 + i * (lw + gap);
    shapes.push(pointedArch(x, 110, lw));
    shapes.push(...grid(x, 110, lw, 260, 1, 4));
  }
  return canvas({
    id: 'coast-window', name: 'Coast Window', kind: 'window', frame: 'window', unlock: { type: 'postcards', region: 'coast' },
    palette: ['teal', 'blue', 'violet'], shapes,
    outline: archOutline(40, 260, 120, 370),
  });
}

function junglePrint() {
  const shapes = [
    ...veinedLeaf([147, 318], [42, 222], 30),
    ...veinedLeaf([153, 286], [262, 196], 30),
    ...veinedLeaf([147, 226], [62, 112], 26),
    ...veinedLeaf([153, 196], [238, 84], 26),
    poly([[147, 168], [153, 168], [153, 364], [147, 364]]),
    circle(150, 150, 13),
    circle(150, 112, 10),
    rect(36, 364, 228, 14),
  ];
  return canvas({
    id: 'jungle-print', name: 'Jungle Print', kind: 'print', frame: 'print', unlock: { type: 'postcards', region: 'jungle' },
    palette: ['green', 'red', 'teal', 'pink'], shapes,
    outline: rectOutline(24, 24, 252, 364),
  });
}

function volcanoPlate() {
  return canvas({
    id: 'volcano-plate', name: 'Volcano Plate', kind: 'plate', frame: 'plate', unlock: { type: 'postcards', region: 'volcano' },
    palette: ['red', 'orange', 'neutral'],
    shapes: rings(150, 200, [{ r0: 0, r1: 26, n: 1 }, { r0: 26, r1: 70, n: 5, offset: 36 }, { r0: 70, r1: 125, n: 12 }]),
    outline: circleOutline(150, 200, 136),
  });
}

// Weekly events: two themed canvases per event.

function harvestWindow() {
  return canvas({
    id: 'harvest-window', name: 'Harvest Window', kind: 'window', frame: 'window', unlock: { type: 'event', id: 'autumn-harvest' },
    palette: ['orange', 'red', 'yellow'],
    shapes: archWindow({ x0: 40, x1: 260, cy: 150, y1: 370, fan: 5, hub: 30, cols: 2, rows: 5 }),
    outline: archOutline(40, 260, 150, 370),
  });
}

function leafMosaic() {
  const shapes = [];
  const cw = 80;
  const ch = 52;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * cw;
      const y = 44 + j * ch;
      const flip = (i + j) % 2;
      shapes.push(flip ? leaf([x + 8, y + ch - 8], [x + cw - 8, y + 8], 13) : leaf([x + 8, y + 8], [x + cw - 8, y + ch - 8], 13));
    }
  }
  return canvas({
    id: 'leaf-mosaic', name: 'Leaf Mosaic', kind: 'mosaic', frame: 'tile', unlock: { type: 'event', id: 'autumn-harvest' },
    palette: ['orange', 'yellow', 'red', 'green'], shapes,
    outline: rectOutline(22, 36, 256, 328),
  });
}

function coralWindow() {
  return canvas({
    id: 'coral-window', name: 'Coral Window', kind: 'window', frame: 'window', unlock: { type: 'event', id: 'deep-sea' },
    palette: ['teal', 'pink', 'blue'],
    shapes: rings(150, 200, [{ r0: 0, r1: 35, n: 1 }, { r0: 35, r1: 78, n: 6 }, { r0: 78, r1: 120, n: 8, offset: 22.5 }]),
    outline: circleOutline(150, 200, 132),
  });
}

function pearlPlate() {
  return canvas({
    id: 'pearl-plate', name: 'Pearl Plate', kind: 'plate', frame: 'plate', unlock: { type: 'event', id: 'deep-sea' },
    palette: ['neutral', 'teal', 'blue'],
    shapes: rings(150, 200, [{ r0: 0, r1: 40, n: 1 }, { r0: 40, r1: 125, n: 12 }]),
    outline: circleOutline(150, 200, 136),
  });
}

function bouquetQuilt() {
  const shapes = [
    rect(30, 40, 240, 40),
    rect(30, 320, 240, 40),
    rect(30, 80, 40, 240),
    rect(230, 80, 40, 240),
    ...grid(70, 80, 160, 240, 4, 4),
  ];
  return canvas({
    id: 'bouquet-quilt', name: 'Bouquet Quilt', kind: 'quilt', frame: 'quilt', unlock: { type: 'event', id: 'bloom-week' },
    palette: ['pink', 'violet', 'green'], shapes,
    outline: rectOutline(30, 40, 240, 320),
  });
}

function trellisPrint() {
  return canvas({
    id: 'trellis-print', name: 'Trellis Print', kind: 'print', frame: 'print', unlock: { type: 'event', id: 'bloom-week' },
    palette: ['green', 'pink', 'violet'],
    shapes: crossGrid(40, 40, 220, 320, 2, 2),
    outline: rectOutline(40, 40, 220, 320),
  });
}

function neonSignWindow() {
  return canvas({
    id: 'neon-sign-window', name: 'Neon Sign Window', kind: 'window', frame: 'window', unlock: { type: 'event', id: 'neon-night' },
    palette: ['pink', 'violet', 'green', 'yellow'],
    shapes: bands(50, 40, 200, 320, 7, { teeth: 4, amp: 18, cols: 2 }),
    outline: rectOutline(50, 40, 200, 320),
  });
}

function nightMarketPrint() {
  const shapes = [];
  for (let s = 0; s < 3; s++) {
    const x0 = 22 + s * 88;
    shapes.push(circle(x0 + 40, 92, 12));
    for (let k = 0; k < 4; k++) shapes.push(awningStripe(x0 + k * 20, 120, 20, 44, 6));
    shapes.push(rect(x0, 260, 80, 46));
  }
  const posts = [0, 1, 2].map((s) => `M${22 + s * 88 + 4} 170 V260 M${22 + s * 88 + 76} 170 V260`).join(' ');
  return canvas({
    id: 'night-market-print', name: 'Night Market Print', kind: 'print', frame: 'print', unlock: { type: 'event', id: 'neon-night' },
    palette: ['pink', 'orange', 'violet', 'yellow'], shapes,
    outline: rectOutline(14, 60, 272, 260),
    extraLeading: `${posts} M14 104 Q150 86 286 104`,
  });
}

function frostWindow() {
  const cx = 150;
  const cy = 200;
  const R = 128;
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    const v1 = polar(cx, cy, R, i * 60);
    const v2 = polar(cx, cy, R, (i + 1) * 60);
    const o = [cx, cy];
    const a1 = lerp(o, v1, 0.4);
    const a2 = lerp(o, v2, 0.4);
    const b1 = lerp(o, v1, 0.72);
    const b2 = lerp(o, v2, 0.72);
    shapes.push(poly([o, a1, a2]), poly([a1, b1, b2, a2]), poly([b1, v1, v2, b2]));
  }
  return canvas({
    id: 'frost-window', name: 'Frost Window', kind: 'window', frame: 'window', unlock: { type: 'event', id: 'winter-frost' },
    palette: ['blue', 'teal', 'neutral'], shapes,
    outline: hexOutline(cx, cy, R),
  });
}

function snowflakeMosaic() {
  return canvas({
    id: 'snowflake-mosaic', name: 'Snowflake Mosaic', kind: 'mosaic', frame: 'tile', unlock: { type: 'event', id: 'winter-frost' },
    palette: ['blue', 'neutral', 'violet'],
    shapes: hexGrid(150, 200, 4, 5, 31, 28),
    outline: rectOutline(24, 64, 252, 272),
  });
}

function lanternPlate() {
  return canvas({
    id: 'lantern-plate', name: 'Lantern Plate', kind: 'plate', frame: 'plate', unlock: { type: 'event', id: 'festival-of-lanterns' },
    palette: ['orange', 'red', 'yellow'],
    shapes: rings(150, 200, [{ r0: 0, r1: 30, n: 1 }, { r0: 30, r1: 80, n: 5 }, { r0: 80, r1: 125, n: 10, offset: 18 }]),
    outline: circleOutline(150, 200, 136),
  });
}

function paperLanternTapestry() {
  return canvas({
    id: 'paper-lantern-tapestry', name: 'Paper Lantern Tapestry', kind: 'tapestry', frame: 'tapestry', unlock: { type: 'event', id: 'festival-of-lanterns' },
    palette: ['red', 'orange', 'yellow'],
    shapes: bands(40, 40, 220, 330, 6, { teeth: 6, amp: 16, cols: 3 }),
    outline: rectOutline(40, 40, 220, 330),
    extraLeading: 'M28 32 H272',
  });
}

function sunsetWindow() {
  return canvas({
    id: 'sunset-window', name: 'Sunset Window', kind: 'window', frame: 'window', unlock: { type: 'event', id: 'golden-hour' },
    palette: ['orange', 'pink', 'violet', 'yellow'],
    shapes: archWindow({
      x0: 40, x1: 260, cy: 160, y1: 370, hub: 35,
      fanRings: [{ r0: 35, r1: 70, n: 3 }, { r0: 70, r1: 110, n: 5 }], cols: 2, rows: 3,
    }),
    outline: archOutline(40, 260, 160, 370),
  });
}

function honeyHillPrint() {
  return canvas({
    id: 'honey-hill-print', name: 'Honey Hill Print', kind: 'print', frame: 'print', unlock: { type: 'event', id: 'golden-hour' },
    palette: ['yellow', 'orange', 'violet'],
    shapes: hexGrid(150, 200, 4, 4, 34),
    outline: rectOutline(10, 70, 280, 260),
  });
}

function inkwellPlate() {
  return canvas({
    id: 'inkwell-plate', name: 'Inkwell Plate', kind: 'plate', frame: 'plate', unlock: { type: 'event', id: 'ink-and-paper' },
    palette: ['neutral', 'blue', 'red'],
    shapes: rings(150, 200, [{ r0: 0, r1: 34, n: 1 }, { r0: 34, r1: 80, n: 4, offset: 45 }, { r0: 80, r1: 125, n: 7 }]),
    outline: circleOutline(150, 200, 136),
  });
}

function manuscriptPrint() {
  const shapes = [
    rect(40, 30, 110, 12), rect(150, 30, 110, 12),
    rect(40, 358, 110, 12), rect(150, 358, 110, 12),
    rect(40, 42, 12, 158), rect(40, 200, 12, 158),
    rect(248, 42, 12, 158), rect(248, 200, 12, 158),
    rect(68, 60, 60, 60),
    rect(140, 66, 92, 14), rect(140, 98, 92, 14),
    rect(68, 140, 164, 14), rect(68, 172, 164, 14), rect(68, 204, 120, 14),
    rect(68, 240, 164, 98),
  ];
  return canvas({
    id: 'manuscript-print', name: 'Manuscript Print', kind: 'print', frame: 'print', unlock: { type: 'event', id: 'ink-and-paper' },
    palette: ['neutral', 'red', 'blue', 'yellow'], shapes,
    outline: rectOutline(40, 30, 220, 340),
  });
}

// Heritage tree: large prestige canvases.

function grandRotundaWindow() {
  const cx = 150;
  const cy = 150;
  const r = 120;
  const shapes = [
    ...rings(cx, cy, [
      { r0: 0, r1: 22, n: 1 }, { r0: 22, r1: 55, n: 8 }, { r0: 55, r1: 88, n: 16 }, { r0: 88, r1: r, n: 16, offset: 11.25 },
    ]),
    ...spandrels(cx, cy, r),
    ...grid(30, 280, 240, 92, 3, 1),
  ];
  return canvas({
    id: 'grand-rotunda-window', name: 'Grand Rotunda Window', kind: 'window', frame: 'window', unlock: { type: 'heritage', id: 'grand-rotunda-window' },
    palette: ['blue', 'violet', 'red', 'yellow', 'teal'], shapes,
    outline: rectOutline(30, 30, 240, 342),
  });
}

function heritageTapestry() {
  return canvas({
    id: 'heritage-tapestry', name: 'Heritage Tapestry', kind: 'tapestry', frame: 'tapestry', unlock: { type: 'heritage', id: 'heritage-tapestry' },
    palette: ['red', 'orange', 'yellow', 'green', 'blue', 'violet'],
    shapes: bands(30, 34, 240, 340, 12, { teeth: 5, amp: 8, cols: 5 }),
    outline: rectOutline(30, 34, 240, 340),
    extraLeading: 'M18 26 H282',
  });
}

/** Every canvas: 6 starters, 5 milestones, 5 postcard sets, 16 event, 2 heritage. */
export const CANVASES = Object.freeze([
  harborWindow(), tileMosaic(), paintedPlate(), patchworkQuilt(), tapestry(), botanicalPrint(),
  roseWindow(), mapTile(), lanternRow(), riverQuilt(), sunburstPlate(),
  meadowWindow(), quarryMosaic(), coastWindow(), junglePrint(), volcanoPlate(),
  harvestWindow(), leafMosaic(), coralWindow(), pearlPlate(), bouquetQuilt(), trellisPrint(),
  neonSignWindow(), nightMarketPrint(), frostWindow(), snowflakeMosaic(), lanternPlate(), paperLanternTapestry(),
  sunsetWindow(), honeyHillPrint(), inkwellPlate(), manuscriptPrint(),
  grandRotundaWindow(), heritageTapestry(),
]);

const BY_ID = new Map(CANVASES.map((c) => [c.id, c]));

/** Canvas by id, or undefined. */
export function getCanvas(id) {
  return BY_ID.get(id);
}

/** The six designs available when the Gallery opens. */
export function starterCanvases() {
  return CANVASES.filter((c) => c.unlock.type === 'start');
}
