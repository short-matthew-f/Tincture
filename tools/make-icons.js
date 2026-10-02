#!/usr/bin/env node
// Tincture — tools/make-icons.js
//
//   node tools/make-icons.js
//
// Regenerates icons/icon.svg and the PNGs (icon-192, icon-512,
// icon-512-maskable, apple-touch-icon) with NO dependencies: the artwork is one
// shape list (rounded rects and circles, optionally clipped), emitted both as
// SVG and rasterized by a small signed-distance-field renderer into a PNG
// written with node:zlib. Because both outputs come from the same list, the
// SVG and the PNGs cannot drift apart.
//
// The art: a papercut glass vial standing on a walnut shelf on plaster, three
// stacked pigment bands (madder, ochre, woad), ink outline, straight-down cut
// shadow.
//
// Variants:
//   rounded   plaster rounded square, transparent corners, art at 1.00
//             (icon.svg, icon-192.png, icon-512.png)
//   square    full-bleed plaster, art at 0.92 (apple-touch-icon.png, 180 px;
//             iOS applies its own mask)
//   maskable  full-bleed plaster, art at 0.74 so everything sits inside the
//             central 80% safe circle (icon-512-maskable.png)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.resolve(HERE, '..', 'icons');

const C = {
  plaster: '#E3E6E0',
  glass: '#F2F4F0',
  cork: '#C9A277',
  walnut: '#7B5236',
  walnutDeep: '#5E3E28',
  ink: '#2A2622',
  madder: '#B8433A',
  madderLight: '#D06A60',
  ochre: '#D39B2A',
  woad: '#3E6A9E',
  white: '#FFFFFF',
};

// --------------------------------------------------------------- shape list
// All coordinates are in a 512 x 512 space. kind: 'rrect' (rect when r = 0,
// circle when r = w/2 = h/2). Optional: opacity, stroke {color,width}, clip
// (id of an earlier shape marked `def`), def (id; shape drawn only as a clip
// source when `clipOnly`).

const BODY = { x: 196, y: 108, w: 120, h: 290, r: 60 };

function art() {
  const s = [];
  const rr = (x, y, w, h, r, fill, extra = {}) => s.push({ kind: 'rrect', x, y, w, h, r, fill, ...extra });
  // shelf, with its cut shadow
  rr(76, 406, 360, 36, 8, C.ink, { opacity: 0.25, dy: 9 });
  rr(76, 398, 360, 36, 8, C.walnut);
  rr(76, 398, 360, 8, 4, C.walnutDeep, { opacity: 0.35 });
  // vial: cut shadow, cork, glass
  rr(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r, C.ink, { opacity: 0.25, dy: 12 });
  rr(216, 62, 80, 52, 14, C.cork);
  rr(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r, C.glass, { id: 'body' });
  // three pigment bands, clipped to the glass (madder top, ochre, woad bottom)
  rr(180, 150, 152, 84, 0, C.madder, { clip: 'body' });
  rr(180, 150, 152, 12, 0, C.madderLight, { clip: 'body' });
  rr(180, 234, 152, 82, 0, C.ochre, { clip: 'body' });
  rr(180, 316, 152, 90, 0, C.woad, { clip: 'body' });
  // soft glass highlight strip
  rr(222, 134, 18, 220, 9, C.white, { opacity: 0.5, clip: 'body' });
  // ink outline
  rr(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r, null, { stroke: { color: C.ink, width: 12 } });
  return s;
}

// --------------------------------------------------------------------- svg

const num = (n) => +n.toFixed(2);

function svgShape(sh, ids) {
  const dy = sh.dy || 0;
  const attrs = [`x="${sh.x}"`, `y="${sh.y + dy}"`, `width="${sh.w}"`, `height="${sh.h}"`];
  if (sh.r) attrs.push(`rx="${sh.r}"`);
  attrs.push(sh.fill ? `fill="${sh.fill}"` : 'fill="none"');
  if (sh.opacity !== undefined && sh.opacity !== 1) attrs.push(`fill-opacity="${sh.opacity}"`);
  if (sh.stroke) attrs.push(`stroke="${sh.stroke.color}" stroke-width="${sh.stroke.width}"`);
  if (sh.clip) attrs.push(`clip-path="url(#${sh.clip}Clip)"`);
  return `<rect ${attrs.join(' ')}/>`;
}

function buildSVG(variant) {
  const { scale, bgR } = VARIANTS[variant];
  const shapes = art();
  const defs = shapes.filter((sh) => sh.id).map((sh) => {
    return `<clipPath id="${sh.id}Clip"><rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.r}"/></clipPath>`;
  });
  const bg = `<rect width="512" height="512" rx="${bgR}" fill="${C.plaster}"/>`;
  const t = scale === 1 ? '' : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<title>Tincture</title>
<defs>${defs.join('')}</defs>
${bg}
<g${t}>
${shapes.map((sh) => svgShape(sh)).join('\n')}
</g>
</svg>
`;
}

// ------------------------------------------------------------------ raster

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Signed distance from point (px,py) to a rounded rect centered (cx,cy).
function sdRRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function rasterize(variant, size) {
  const { scale, bgR } = VARIANTS[variant];
  const k = size / 512; // art space -> pixels
  const shapes = art();
  const clipDefs = {};
  for (const sh of shapes) if (sh.id) clipDefs[sh.id] = sh;
  const buf = Buffer.alloc(size * size * 4);

  // art-space point -> pixel-space shape params (scale about the center)
  const tx = (v) => (256 + (v - 256) * scale) * k;
  const tl = (v) => v * scale * k;

  const bgHalf = size / 2;
  const bg = hexRgb(C.plaster);
  const prepared = shapes.map((sh) => {
    const dy = sh.dy || 0;
    return {
      sh,
      cx: tx(sh.x + sh.w / 2),
      cy: tx(sh.y + dy + sh.h / 2),
      hw: tl(sh.w / 2),
      hh: tl(sh.h / 2),
      r: Math.min(tl(sh.r), tl(sh.w / 2), tl(sh.h / 2)),
      rgb: sh.fill ? hexRgb(sh.fill) : null,
      sw: sh.stroke ? tl(sh.stroke.width) : 0,
      srgb: sh.stroke ? hexRgb(sh.stroke.color) : null,
      clip: sh.clip ? (() => {
        const c = clipDefs[sh.clip];
        return { cx: tx(c.x + c.w / 2), cy: tx(c.y + c.h / 2), hw: tl(c.w / 2), hh: tl(c.h / 2), r: Math.min(tl(c.r), tl(c.w / 2), tl(c.h / 2)) };
      })() : null,
    };
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // background rounded square (coverage gives transparent corners)
      const bgCov = clamp01(0.5 - sdRRect(px, py, bgHalf, bgHalf, bgHalf, bgHalf, bgR * k));
      let r = bg[0], g = bg[1], b = bg[2];
      for (const p of prepared) {
        const sd = sdRRect(px, py, p.cx, p.cy, p.hw, p.hh, p.r);
        let cov;
        let col;
        if (p.rgb) { cov = clamp01(0.5 - sd); col = p.rgb; }
        else { cov = clamp01(0.5 - (Math.abs(sd) - p.sw / 2)); col = p.srgb; }
        if (cov <= 0) continue;
        if (p.clip) cov *= clamp01(0.5 - sdRRect(px, py, p.clip.cx, p.clip.cy, p.clip.hw, p.clip.hh, p.clip.r));
        cov *= p.sh.opacity === undefined ? 1 : p.sh.opacity;
        if (cov <= 0) continue;
        r += (col[0] - r) * cov;
        g += (col[1] - g) * cov;
        b += (col[2] - b) * cov;
      }
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(bgCov * 255);
    }
  }
  return buf;
}

// --------------------------------------------------------------------- png

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------- main

const VARIANTS = {
  rounded: { scale: 1, bgR: 104 },
  square: { scale: 0.92, bgR: 0 },
  maskable: { scale: 0.74, bgR: 0 },
};

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, variant: 'rounded' },
  { file: 'icon-512.png', size: 512, variant: 'rounded' },
  { file: 'icon-512-maskable.png', size: 512, variant: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'square' },
];

fs.mkdirSync(ICON_DIR, { recursive: true });
fs.writeFileSync(path.join(ICON_DIR, 'icon.svg'), buildSVG('rounded'));
console.log('wrote icons/icon.svg');
for (const o of OUTPUTS) {
  const png = encodePNG(rasterize(o.variant, o.size), o.size);
  fs.writeFileSync(path.join(ICON_DIR, o.file), png);
  console.log(`wrote icons/${o.file} (${o.size}x${o.size}, ${o.variant}, ${png.length} bytes)`);
}
