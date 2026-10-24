// Authoring tool (not loaded by the page): turns a painted source image (PNG)
// into a Lifting Table picture grid in palette letters. No dependencies.
//
//   node proto/lift/import-art.mjs <file.png> --id fox2 [--size 28x36] [--colors 10]
//        [--crop 0,0.4,1,1] [--palette sxogjr...] [--min 3] [--png preview.png] [--write] [--gen]
//
//  --size     target grid, columns x rows (default 28x36; the image is
//             center-cropped to that aspect, then area-averaged)
//  --crop     l,t,r,b as fractions of the image, e.g. 0,0.4,1,1 for the lower 60%
//             (the grid's aspect is center-cropped inside that box)
//  --colors   at most this many palette colors (default 10)
//  --palette  only these palette letters (default: the whole palette)
//  --min      regions smaller than this many cells merge into a neighbor (default 3)
//  --write    store the grid in art-imported.js under --id (levels.js picks it up as ART[id])
//  --gen      then deal jars and solve it: runs gen-levels.mjs for that id (needs a
//             LEVEL_DEFS entry with that id; prints one to paste if there isn't)
//  --chroma   weight of hue against lightness when matching colors (default 1)
//  --tone     stretch the picture's lightness onto the palette's range first
// Without --write the grid is printed, ready to paste into chapters.js.
// --size defaults to the painting's slot size when --id names one in chapters.js.
//
//   node proto/lift/import-art.mjs --batch <dir> [--only id,id] [--png <dir>] [--write] [--gen]
//
// imports every picture listed in art-sources.js (file, crop, chroma, colors)
// from the PNGs in <dir> at its painting's slot size; --png writes a preview of
// each and a contact sheet; --write stores them all in art-imported.js; --gen
// then re-deals the jars for exactly those paintings (gen-levels.mjs ONLY=...).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PALETTE } from './palette.js';

// ---------- PNG in and out (8-bit, non-interlaced) ----------
export function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('not a PNG');
  let pos = 8, W = 0, H = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { W = body.readUInt32BE(0); H = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') plte = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`only 8-bit PNGs (this one is ${depth}-bit)`);
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`unsupported PNG color type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = W * ch, out = Buffer.alloc(W * H * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, s = x * ch;
      if (type === 2 || type === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = type === 6 ? cur[s + 3] : 255; }
      else if (type === 0 || type === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = type === 4 ? cur[s + 1] : 255; }
      else { const k = cur[s]; out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { W, H, data: out };
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// RGB or RGBA (rgba: Uint8 array W*H*4) -> PNG buffer. Filter 0 rows.
export function encodePNG(W, H, rgba, alpha = false) {
  const ch = alpha ? 4 : 3, raw = Buffer.alloc((W * ch + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < ch; k++) raw[y * (W * ch + 1) + 1 + x * ch + k] = rgba[(y * W + x) * 4 + k];
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- color ----------
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const hexLin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(toLin); };
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const PAPER = hexLin('#EFE7D6');

// ---------- the pipeline ----------
// Center-crop to the grid's aspect, then average each cell's area in linear
// light (alpha composited over the paper). Returns W*H OKLab colors.
export function downsample(img, W, H, crop) {
  // crop = [left, top, right, bottom] as fractions of the image (default whole);
  // the grid's aspect is then center-cropped inside that box.
  const [fl, ft, fr, fb] = crop || [0, 0, 1, 1];
  const bx0 = fl * img.W, by0 = ft * img.H, bw = (fr - fl) * img.W, bh = (fb - ft) * img.H;
  const want = W / H, have = bw / bh;
  let cw = bw, chh = bh;
  if (have > want) cw = bh * want; else chh = bw / want;
  const x0 = bx0 + (bw - cw) / 2, y0 = by0 + (bh - chh) / 2, sx = cw / W, sy = chh / H;
  const out = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ax = x0 + c * sx, bx = ax + sx, ay = y0 + r * sy, by = ay + sy;
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let y = Math.floor(ay); y < Math.ceil(by); y++) {
      const wy = Math.min(by, y + 1) - Math.max(ay, y);
      if (wy <= 0) continue;
      for (let x = Math.floor(ax); x < Math.ceil(bx); x++) {
        const wx = Math.min(bx, x + 1) - Math.max(ax, x);
        if (wx <= 0) continue;
        const o = (Math.min(img.H - 1, y) * img.W + Math.min(img.W - 1, x)) * 4, a = img.data[o + 3] / 255, w = wx * wy;
        for (let k = 0; k < 3; k++) acc[k] += w * (toLin(img.data[o + k]) * a + PAPER[k] * (1 - a));
        wsum += w;
      }
    }
    out.push(oklab(acc.map((v) => v / wsum)));
  }
  return out;
}

// Nearest palette letter in OKLab, then a color budget (the rarest color's
// cells move to their own nearest remaining color), then small regions merge
// into the neighbor they share the most edge with. Deterministic.
// Options for painted sources whose darks and brights go past the palette's:
//   tone   stretch the picture's lightness (2nd to 98th percentile) onto the
//          palette's range first, so a deep navy band lands on Navy, not Charcoal;
//   chroma weight of hue against lightness when matching (1 = plain OKLab).
export function quantize(labs, W, H, { letters = Object.keys(PALETTE), colors = 10, min = 3, minColor = 8, tone = false, chroma = 1 } = {}) {
  const pal = Object.fromEntries(letters.map((k) => [k, oklab(hexLin(PALETTE[k].hex))]));
  if (tone) labs = toneMap(labs, Object.values(pal));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + chroma * ((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const nearest = (lab, allowed) => { let best = null, bd = Infinity; for (const k of allowed) { const d = d2(lab, pal[k]); if (d < bd) { bd = d; best = k; } } return best; };
  let allowed = letters.slice();
  const g = labs.map((lab) => nearest(lab, allowed));
  // Drop colors one at a time while over budget (or while some color is a
  // sliver under minColor cells): the one whose cells lose the least by moving
  // to their next nearest color goes first.
  for (;;) {
    const cnt = {};
    for (const k of g) cnt[k] = (cnt[k] || 0) + 1;
    const ks = Object.keys(cnt).sort();
    const slivers = ks.filter((k) => cnt[k] < minColor);
    if (ks.length <= 3 || (ks.length <= colors && !slivers.length)) break;
    const pool = slivers.length ? slivers : ks;
    let drop = null, best = Infinity;
    for (const k of pool) {
      const rest = ks.filter((x) => x !== k);
      let cost = 0;
      for (let i = 0; i < g.length; i++) if (g[i] === k) cost += d2(labs[i], pal[nearest(labs[i], rest)]) - d2(labs[i], pal[k]);
      if (cost < best) { best = cost; drop = k; }
    }
    allowed = ks.filter((x) => x !== drop);
    for (let i = 0; i < g.length; i++) if (g[i] === drop) g[i] = nearest(labs[i], allowed);
  }
  // merge small 4-connected regions
  for (let pass = 0; pass < 6; pass++) {
    const seen = new Uint8Array(W * H);
    let changed = false;
    for (let i = 0; i < W * H; i++) {
      if (seen[i]) continue;
      const k = g[i], stack = [i], region = [];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop(); region.push(j);
        const x = j % W, y = (j - x) / W;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (!seen[n] && g[n] === k) { seen[n] = 1; stack.push(n); }
        }
      }
      if (region.length >= min) continue;
      const edge = {};
      for (const j of region) {
        const x = j % W, y = (j - x) / W;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = g[ny * W + nx];
          if (n !== k) edge[n] = (edge[n] || 0) + 1;
        }
      }
      const to = Object.keys(edge).sort((a, b) => edge[b] - edge[a] || (a < b ? -1 : 1))[0];
      if (to) { for (const j of region) g[j] = to; changed = true; }
    }
    if (!changed) break;
  }
  const rows = [];
  for (let r = 0; r < H; r++) rows.push(g.slice(r * W, (r + 1) * W).join(''));
  return rows;
}

export function toneMap(labs, pal) {
  const Ls = labs.map((l) => l[0]).sort((a, b) => a - b);
  const lo = Ls[Math.floor(Ls.length * 0.02)], hi = Ls[Math.floor(Ls.length * 0.98)];
  const pl = pal.map((p) => p[0]), plo = Math.min(...pl) + 0.02, phi = Math.max(...pl) - 0.01;
  if (hi - lo < 0.05) return labs;
  return labs.map(([L, a, b]) => [plo + ((Math.min(hi, Math.max(lo, L)) - lo) / (hi - lo)) * (phi - plo), a, b]);
}

export function importPNG(buf, { W = 28, H = 36, crop, ...opts } = {}) {
  return quantize(downsample(decodePNG(buf), W, H, crop), W, H, opts);
}

// ---------- command line ----------
function previewPNG(rows, S = 8) {
  const W = rows[0].length, H = rows.length, buf = new Uint8Array(W * S * H * S * 4);
  for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
    const n = parseInt(PALETTE[rows[Math.floor(y / S)][Math.floor(x / S)]].hex.slice(1), 16), o = (y * W * S + x) * 4;
    buf[o] = n >> 16; buf[o + 1] = (n >> 8) & 255; buf[o + 2] = n & 255; buf[o + 3] = 255;
  }
  return encodePNG(W * S, H * S, buf);
}
// Several pictures side by side on paper, `across` to a row.
export function contactSheet(items, S = 8, across = 6, pad = 12) {
  const cw = Math.max(...items.map(([, r]) => r[0].length)) * S + pad, ch = Math.max(...items.map(([, r]) => r.length)) * S + pad;
  const W = cw * Math.min(across, items.length), H = ch * Math.ceil(items.length / across), buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) buf.set([0xF4, 0xEF, 0xE4, 255], i * 4);
  items.forEach(([, rows], n) => {
    const ox = (n % across) * cw + pad / 2, oy = Math.floor(n / across) * ch + pad / 2;
    for (let y = 0; y < rows.length * S; y++) for (let x = 0; x < rows[0].length * S; x++) {
      const v = parseInt(PALETTE[rows[Math.floor(y / S)][Math.floor(x / S)]].hex.slice(1), 16), o = ((oy + y) * W + ox + x) * 4;
      buf[o] = v >> 16; buf[o + 1] = (v >> 8) & 255; buf[o + 2] = v & 255;
    }
  });
  return encodePNG(W, H, buf);
}
async function writeImported(grids) {
  const path = new URL('./art-imported.js', import.meta.url);
  const cur = existsSync(path) ? (await import(path.href + `?t=${Date.now()}`)).ART_IMPORTED : {};
  Object.assign(cur, grids);
  const body = Object.entries(cur).map(([k, rs]) => `  ${k}: [\n${rs.map((r) => `    '${r}',`).join('\n')}\n  ],`).join('\n');
  writeFileSync(path, `// Generated by import-art.mjs from painted source images. Do not edit by hand;\n// re-run: node proto/lift/import-art.mjs --batch <dir> --write (sources: art-sources.js)\n// or: node proto/lift/import-art.mjs <file.png> --id <id> --write\nexport const ART_IMPORTED = {\n${body}\n};\n`);
}
async function regenerate(ids) {
  const { LEVEL_DEFS } = await import(new URL('./chapters.js', import.meta.url).href + `?t=${Date.now()}`);
  const missing = ids.filter((id) => !LEVEL_DEFS.some((d) => d.id === id));
  if (missing.length) {
    console.log(`No painting "${missing.join('", "')}" yet. Add it to a chapter in chapters.js, then run again with --gen:\n  ['${missing[0]}', 'Name', 'noun', { mix: 0.25, link: 0.2, mystery: 0.3 }],`);
    return 1;
  }
  const r = spawnSync(process.execPath, [new URL('./gen-levels.mjs', import.meta.url).pathname], { env: { ...process.env, ONLY: ids.join(',') }, stdio: 'inherit' });
  return r.status ?? 1;
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] === here) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const flags = ['--write', '--gen', '--tone'];
  const { LEVEL_DEFS } = await import(new URL('./chapters.js', import.meta.url).href);
  const slotSize = (id) => { const d = LEVEL_DEFS.find((x) => x.id === id); return d && d.size ? d.size : null; };
  if (opt('batch')) {
    const { SOURCES } = await import(new URL('./art-sources.js', import.meta.url).href);
    const dir = opt('batch').replace(/\/?$/, '/');
    const only = opt('only') ? opt('only').split(',') : null;
    const grids = {};
    for (const [id, src] of Object.entries(SOURCES)) {
      if (only && !only.includes(id)) continue;
      const size = slotSize(id);
      if (!size) { console.log(`${id}: no painting with a slot size in chapters.js, skipped`); continue; }
      const file = dir + src.file;
      if (!existsSync(file)) { console.log(`${id}: ${src.file} not found, skipped`); continue; }
      const rows = importPNG(readFileSync(file), { W: size[0], H: size[1], crop: src.crop || undefined, colors: src.colors, min: src.min, chroma: src.chroma || 1, tone: !!src.tone, letters: src.drop ? Object.keys(PALETTE).filter((k) => !src.drop.includes(k)) : undefined });
      grids[id] = rows;
      const used = [...new Set(rows.join(''))].sort().join('');
      console.log(`${id.padEnd(12)} ${size[0]}x${size[1]}  ${used.length} colors (${used})  from ${src.file}`);
    }
    if (opt('png')) {
      const out = opt('png').replace(/\/?$/, '/');
      mkdirSync(out, { recursive: true });
      for (const [id, rows] of Object.entries(grids)) writeFileSync(`${out}${id}.png`, previewPNG(rows));
      writeFileSync(`${out}_sheet.png`, contactSheet(Object.entries(grids)));
    }
    if (args.includes('--write')) { await writeImported(grids); console.log(`wrote ${Object.keys(grids).length} pictures to art-imported.js`); }
    if (args.includes('--gen')) process.exit(await regenerate(Object.keys(grids)));
  } else {
    const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !flags.includes(args[i - 1])));
    if (!file) { console.log('usage: node proto/lift/import-art.mjs <file.png> --id <id> [--size 28x36] [--crop l,t,r,b] [--colors 10] [--palette letters] [--min 3] [--chroma 2] [--tone] [--png preview.png] [--write] [--gen]\n   or: node proto/lift/import-art.mjs --batch <dir> [--only id,id] [--png <dir>] [--write] [--gen]'); process.exit(1); }
    const id = opt('id', 'imported');
    const [W, H] = opt('size') ? opt('size').split('x').map(Number) : (slotSize(id) || [28, 36]);
    const rows = importPNG(readFileSync(file), { W, H, crop: opt('crop') ? opt('crop').split(',').map(Number) : undefined, colors: +opt('colors', 10), min: +opt('min', 3), chroma: +opt('chroma', 1), tone: args.includes('--tone'), letters: opt('palette') ? [...opt('palette')] : undefined });
    const used = [...new Set(rows.join(''))].sort().join('');
    console.log(`${id}: ${W}x${H}, ${used.length} colors (${used})`);
    if (opt('png')) writeFileSync(opt('png'), previewPNG(rows));
    if (!args.includes('--write')) {
      console.log(`  art: [\n${rows.map((r) => `    '${r}',`).join('\n')}\n  ],`);
    } else {
      await writeImported({ [id]: rows });
      console.log(`wrote ART.${id} to art-imported.js`);
      if (args.includes('--gen')) process.exit(await regenerate([id]));
    }
  }
}
