// Authoring tool (not loaded by the page): composes the bigger Lifting Table
// pictures from layered shapes (rects, ellipses, polygons, thick lines,
// dithered gradients, shading, outlines) straight in palette letters, and
// writes art.js. Deterministic: no Math.random, every speckle uses a seeded rng.
// Run from the repo root:  node proto/lift/art-gen.mjs [--png <dir>]
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { mulberry } from './rules.js';
import { PALETTE } from './palette.js';
import { addChapterPictures } from './art-gen-chapters.mjs';

// ---------- the little canvas of letters ----------
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const bay = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;
// Pick from a list of letters by t in [0,1], ordered-dithered between neighbors.
export function ramp(letters, t, x, y) {
  const n = letters.length;
  if (n === 1) return letters[0];
  const f = Math.max(0, Math.min(0.9999, t)) * (n - 1);
  const i = Math.floor(f);
  return f - i > bay(x, y) ? letters[Math.min(n - 1, i + 1)] : letters[i];
}

export class Pic {
  constructor(W, H, bg) { this.W = W; this.H = H; this.g = Array.from({ length: H }, () => Array(W).fill(bg)); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  set(x, y, ch) { x = Math.floor(x); y = Math.floor(y); if (ch && this.in(x, y)) this.g[y][x] = ch; }
  get(x, y) { return this.in(x, y) ? this.g[y][x] : null; }
  // Fill every cell where test(x, y) holds. fill: a letter or (x, y, u, v) => letter|null,
  // u, v in [-1, 1] across the shape's box.
  shape(box, test, fill) {
    const [x0, y0, x1, y1] = box;
    const mask = new Set();
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.H - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.W - 1, Math.ceil(x1)); x++) {
        if (!test(x + 0.5, y + 0.5)) continue;
        const u = ((x + 0.5 - x0) / Math.max(0.01, x1 - x0)) * 2 - 1, v = ((y + 0.5 - y0) / Math.max(0.01, y1 - y0)) * 2 - 1;
        const ch = typeof fill === 'function' ? fill(x, y, u, v) : fill;
        if (ch) { this.g[y][x] = ch; mask.add(y * this.W + x); }
      }
    }
    return mask;
  }
  rect(x0, y0, x1, y1, fill) { return this.shape([x0, y0, x1 + 1, y1 + 1], (x, y) => x >= x0 && y >= y0 && x < x1 + 1 && y < y1 + 1, fill); }
  ellipse(cx, cy, rx, ry, fill) {
    return this.shape([cx - rx, cy - ry, cx + rx, cy + ry], (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, fill);
  }
  poly(pts, fill) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    return this.shape([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], inside, fill);
  }
  line(x0, y0, x1, y1, fill, w = 1) {
    const r = w / 2;
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    return this.shape([Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r], (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= r;
    }, fill);
  }
  // A dithered vertical gradient over rows y0..y1 (whole width unless given).
  vgrad(y0, y1, letters, x0 = 0, x1 = this.W - 1) {
    return this.rect(x0, y0, x1, y1, (x, y) => ramp(letters, (y - y0) / Math.max(1, y1 - y0), x, y));
  }
  // Cells of the mask that touch a cell outside it (4-neighbors) take ch.
  outline(mask, ch, sides = 'all') {
    const out = [];
    for (const i of mask) {
      const x = i % this.W, y = (i - x) / this.W;
      const nb = { t: [x, y - 1], b: [x, y + 1], l: [x - 1, y], r: [x + 1, y] };
      for (const [k, [nx, ny]] of Object.entries(nb)) {
        if (sides !== 'all' && !sides.includes(k)) continue;
        if (!this.in(nx, ny) || !mask.has(ny * this.W + nx)) { out.push([x, y]); break; }
      }
    }
    for (const [x, y] of out) this.g[y][x] = ch;
    return this;
  }
  // Scatter a letter over a mask (or a box) with a seeded rng.
  speckle(mask, ch, density, seed, test = () => true) {
    const rng = mulberry(seed);
    for (const i of [...mask].sort((a, b) => a - b)) {
      const x = i % this.W, y = (i - x) / this.W;
      if (rng() < density && test(x, y, this.g[y][x])) this.g[y][x] = ch;
    }
    return this;
  }
  box(x0, y0, x1, y1) { const m = new Set(); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.in(x, y)) m.add(y * this.W + x); return m; }
  rows() { return this.g.map((r) => r.join('')); }
  // Keep the picture to at most `max` colors and drop slivers under `min`
  // cells: the rarest color merges into its nearest remaining color.
  budget(max = 10, min = 8) {
    const rgb = (k) => { const n = parseInt(PALETTE[k].hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    for (;;) {
      const cnt = {};
      for (const r of this.g) for (const ch of r) cnt[ch] = (cnt[ch] || 0) + 1;
      const ks = Object.keys(cnt).sort((a, b) => cnt[a] - cnt[b] || (a < b ? -1 : 1));
      if (ks.length <= 3 || (ks.length <= max && cnt[ks[0]] >= min)) return this;
      const k = ks[0], a = rgb(k);
      let best = null, bd = Infinity;
      for (const o of ks.slice(1)) { const b = rgb(o); const d = (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11; if (d < bd) { bd = d; best = o; } }
      for (const r of this.g) for (let x = 0; x < r.length; x++) if (r[x] === k) r[x] = best;
    }
  }
}

// Round-shape shading: light from the top left. letters run dark -> light.
const shade = (letters, bias = 0, spread = 0.9) => (x, y, u, v) => ramp(letters, 0.5 + bias - (u * 0.45 + v * 0.6) * spread * 0.6, x, y);
// Mirror-able blob of small circles (fleece, clouds, foliage).
function blob(P, parts, fill) {
  const m = new Set();
  for (const [cx, cy, rx, ry] of parts) for (const i of P.ellipse(cx, cy, rx, ry ?? rx, fill)) m.add(i);
  return m;
}

// ---------- the pictures ----------
export const PICTURES = {};
const def = (id, W, H, fn, max = 10) => { PICTURES[id] = { W, H, fn, max }; };

def('skein', 16, 14, (P) => {
  P.vgrad(0, 9, ['y', 'q']);
  P.rect(0, 10, 15, 13, (x, y) => (y === 10 ? 'l' : (x + y * 3) % 7 === 0 ? 'i' : 'k'));
  P.ellipse(8, 10.6, 6.5, 1, 'i');
  const sk = P.ellipse(8, 6, 6.6, 3.6, (x, y, u, v) => {
    if (x === 7 || x === 8) return v < -0.3 ? 'q' : 'l';
    const stripe = (x + y) % 3 === 0;
    const lit = -(u * 0.5 + v * 0.8);
    if (stripe) return 'm';
    return lit > 0.55 ? 'h' : 'p';
  });
  P.outline(sk, 'm', 'b');
  P.line(13, 2, 15, 0, 'k', 1);
});

def('mushrooms', 18, 18, (P) => {
  P.vgrad(0, 11, ['j', 'w']);
  for (const [x, h] of [[1, 6], [4, 3], [15, 5], [12, 2]]) P.rect(x, 11 - h, x, 11, 'w');
  P.rect(0, 12, 17, 17, (x, y) => ramp(['g', 'f'], (y - 12) / 6, x, y));
  P.speckle(P.box(0, 12, 17, 17), 'j', 0.12, 3);
  // big mushroom
  P.rect(6, 9, 9, 14, (x) => (x === 9 ? 'l' : 'q'));
  P.ellipse(7.5, 14.6, 3.2, 0.8, 'f');
  const cap = P.shape([1.5, 3, 14, 10], (x, y) => ((x - 7.75) / 6.2) ** 2 + ((y - 9.5) / 6) ** 2 <= 1 && y <= 9.6, shade(['d', 'r', 'r', 'a'], 0.05));
  P.outline(cap, 'd', 'b');
  for (const [x, y] of [[5, 5], [9, 4], [11, 7], [4, 8], [7, 7]]) { P.set(x, y, 'c'); P.set(x + 1, y, 'c'); }
  P.set(9, 5, 'c');
  // little one
  P.rect(13, 12, 14, 15, (x) => (x === 14 ? 'l' : 'q'));
  P.shape([11, 9.5, 16.5, 13], (x, y) => ((x - 13.75) / 2.8) ** 2 + ((y - 12.5) / 3) ** 2 <= 1 && y <= 12.6, shade(['d', 'r', 'a'], 0.1));
  P.set(13, 10, 'c');
  // grass blades
  for (const x of [0, 2, 3, 10, 16, 17]) P.line(x + 0.5, 12, x + 0.5 + (x % 2 ? 1 : -1), 9.5, 'g', 1);
});

def('sheep', 20, 18, (P) => {
  P.vgrad(0, 8, ['x', 's']);
  blob(P, [[4, 3, 2.6, 1.4], [6.5, 2.4, 2.2, 1.6], [8.5, 3.2, 2, 1.1]], (x, y, u, v) => (v > 0.4 ? 'e' : 'c'));
  blob(P, [[15, 5, 2.2, 1.1], [17, 4.4, 1.8, 1.2]], (x, y, u, v) => (v > 0.35 ? 'e' : 'c'));
  P.ellipse(4, 11, 9, 3.5, (x, y) => ramp(['w', 'g'], (y - 8) / 6, x, y));
  P.ellipse(16, 10.5, 8, 3, (x, y) => ramp(['w', 'g'], (y - 8) / 6, x, y));
  P.rect(0, 11, 19, 17, (x, y) => ramp(['j', 'g'], (y - 11) / 7, x, y));
  // sheep
  for (const x of [7, 9, 12, 14]) P.rect(x, 13, x, 15, 'i');
  const fleece = blob(P, [[10.5, 11, 4.6, 2.6], [8, 10, 2.2, 1.9], [12, 9.6, 2.4, 2], [10, 9.2, 2, 1.6], [13.6, 11.6, 1.8, 1.7]],
    (x, y, u, v) => ramp(['e', 'c', 'c'], 0.62 - v * 0.5, x, y));
  P.outline(fleece, 'e', 'b');
  P.ellipse(16.2, 10.2, 1.7, 1.5, 'i');
  P.set(15, 9, 'i'); P.set(17, 9, 'e'); P.set(16, 10, 'c');
  P.ellipse(10, 15.8, 4.5, 0.6, 'g');
  // flowers
  const rng = mulberry(7);
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rng() * 20), y = 12 + Math.floor(rng() * 6);
    if (P.get(x, y) === 'j' || P.get(x, y) === 'g') P.set(x, y, k % 3 ? 'y' : 'p');
  }
});

def('cherries', 18, 16, (P) => {
  P.vgrad(0, 10, ['h', 'q']);
  P.rect(0, 11, 17, 15, (x, y) => ((Math.floor(x / 2) + Math.floor((y - 11) / 2)) % 2 ? 'c' : 'r'));
  P.rect(0, 11, 17, 11, (x) => (x % 2 ? 'c' : 'd'));
  // stems and leaf
  P.line(9, 2, 5, 7.5, 'k', 1); P.line(9, 2, 12.5, 7, 'k', 1);
  P.poly([[9, 2], [13, 0.5], [15.5, 1.5], [12, 3.5]], (x, y, u, v) => (v < 0 ? 'j' : 'g'));
  P.line(10, 2.3, 14.5, 1.3, 'g', 0.8);
  for (const [cx, cy] of [[5, 9.2], [12.5, 8.8]]) {
    P.ellipse(cx, 10.9, 3, 0.7, 'd');
    const m = P.ellipse(cx, cy, 3.2, 3, shade(['d', 'r', 'r'], 0));
    P.outline(m, 'd', 'br');
    P.set(Math.round(cx - 1.6), Math.round(cy - 1.5), 'h'); P.set(Math.round(cx - 0.6), Math.round(cy - 2.2), 'h');
  }
});

def('cottage', 24, 24, (P) => {
  P.vgrad(0, 13, ['x', 's']);
  blob(P, [[5, 3, 3, 1.2], [8, 2.4, 2.4, 1.4], [19, 4, 2.6, 1.1]], (x, y, u, v) => (v > 0.3 ? 'x' : 'c'));
  P.ellipse(18, 13, 10, 4, 'w');
  P.rect(0, 14, 23, 23, (x, y) => ramp(['g', 'f'], (y - 14) / 12, x, y));
  // cottage
  P.rect(15, 3, 16, 6, 'e'); P.set(15, 2, 'k'); P.set(16, 2, 'k');
  P.rect(5, 9, 18, 16, (x, y) => ((y + (x % 4 === 0 ? 1 : 0)) % 3 === 0 ? 'l' : 'q'));
  P.rect(18, 9, 18, 16, 'l');
  const roof = P.poly([[3, 10], [8, 3.5], [16, 3.5], [21, 10]], (x, y, u, v) => ramp(['k', 'a', 'o', 'o'], 0.85 - (v + 1) * 0.35 + (x % 3 === 0 ? -0.15 : 0), x, y));
  P.outline(roof, 'k', 'b');
  P.rect(10, 12, 12, 16, 'b'); P.set(12, 14, 'y');
  for (const wx of [6, 14]) { P.rect(wx, 11, wx + 2, 13, 'y'); P.set(wx + 1, 11, 'k'); P.set(wx + 1, 12, 'k'); P.set(wx + 1, 13, 'k'); P.rect(wx - 1, 14, wx + 3, 14, 'k'); }
  // path
  P.poly([[10, 17], [12.8, 17], [15, 24], [7, 24]], (x, y) => ((x + y) % 4 === 0 ? 'l' : 'q'));
  // fence
  for (let x = 0; x < 24; x += 2) if (x < 8 || x > 14) { P.rect(x, 16, x, 20, 'c'); P.set(x, 15, x % 4 ? null : 'c'); }
  for (const y of [17, 19]) for (let x = 0; x < 24; x++) if ((x < 9 || x > 14) && P.get(x, y) !== 'c') P.set(x, y, 'e');
  // flowers in front of the fence
  const rng = mulberry(11);
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(rng() * 24), y = 18 + Math.floor(rng() * 6);
    if (x >= 7 && x <= 15) continue;
    const g = P.get(x, y);
    if (g === 'g' || g === 'f') P.set(x, y, ['p', 'r', 'u', 'y', 'c'][k % 5]);
  }
  for (const [x, y, c] of [[2, 12, 'p'], [3, 13, 'u'], [21, 12, 'r'], [22, 13, 'y'], [20, 13, 'p']]) { P.set(x, y, c); P.set(x, y + 1, 'g'); }
});

def('apple', 22, 24, (P) => {
  P.vgrad(0, 15, ['s', 'x']);
  P.ellipse(4, 17, 9, 3, 'j'); P.ellipse(19, 16.6, 8, 3, 'j');
  P.rect(0, 17, 21, 23, (x, y) => ramp(['w', 'g'], (y - 17) / 7, x, y));
  P.rect(10, 12, 12, 19, (x) => (x === 12 ? 'i' : x === 10 ? 'k' : 'k'));
  P.line(11, 14, 7, 10, 'k', 1.2); P.line(11.5, 13, 15, 9.5, 'k', 1.2);
  P.rect(9, 19, 13, 19, 'k');
  const crown = blob(P, [[11, 7, 8, 5.2], [5.5, 9, 3.6, 3], [16.5, 8.6, 3.6, 3], [11, 3.5, 5, 3]], shade(['f', 'g', 'g', 'j'], 0.05));
  P.outline(crown, 'f', 'b');
  P.speckle(crown, 'j', 0.08, 5, (x, y, c) => c === 'g' && y < 8);
  for (const [x, y] of [[6, 6], [9, 3], [14, 5], [16, 9], [11, 8], [5, 10], [13, 11], [8, 9], [18, 7]]) { P.set(x, y, 'r'); P.set(x + 1, y + 1, 'd'); P.set(x + 1, y, 'r'); P.set(x, y + 1, 'r'); }
  // basket
  P.rect(15, 19, 19, 22, (x, y) => ((x + y) % 2 ? 'a' : 'o'));
  P.rect(15, 18, 19, 18, 'r'); P.set(16, 17, 'r'); P.set(18, 17, 'd');
  P.line(14.5, 19, 16, 16, 'k', 0.8); P.line(19.5, 19, 18, 16, 'k', 0.8);
  P.set(4, 20, 'r'); P.set(5, 20, 'd');
});

def('lighthouse', 24, 30, (P) => {
  P.vgrad(0, 17, ['m', 'p', 'a', 'y']);
  P.ellipse(8, 17.8, 4.4, 3.4, (x, y) => (y <= 17 ? 'y' : null));
  P.rect(0, 18, 23, 29, (x, y) => ramp(['b', 'n'], (y - 18) / 12, x, y));
  // sun's reflection: broken streaks
  for (let y = 18; y < 30; y++) {
    const half = 4 - (y - 18) * 0.22;
    for (let x = Math.round(8 - half); x <= Math.round(8 + half); x++) if ((x * 3 + y * 5) % 4 !== 0 && y % 2 === 0) P.set(x, y, y < 23 ? 'y' : 'a');
  }
  blob(P, [[4, 4, 3, 0.8], [17, 6, 4, 0.9], [20, 3, 2.4, 0.6]], (x, y, u, v) => (v < 0 ? 'h' : 'p'));
  // rocks and tower
  const rocks = blob(P, [[18, 18.6, 6, 2.6], [22, 17, 3, 2], [14, 19, 2.6, 1.4]], shade(['i', 'k', 'e'], -0.05));
  P.outline(rocks, 'i', 'b');
  const tower = P.poly([[15.5, 17], [16.6, 6], [20.4, 6], [21.5, 17]], (x, y) => {
    const band = Math.floor((y - 6) / 3) % 2 === 0;
    const lit = x <= 17;
    return band ? (lit ? 'c' : 'e') : (lit ? 'r' : 'd');
  });
  P.outline(tower, 'i', 'r');
  P.rect(16, 5, 21, 5, 'i'); P.rect(17, 3, 20, 4, (x) => (x === 17 || x === 20 ? 'i' : 'y'));
  P.poly([[16.5, 3], [18.5, 0.6], [20.5, 3]], 'd');
  P.rect(18, 12, 18, 13, 'i');
  // beams
  P.poly([[17, 3.2], [9, 1.5], [9, 5.5], [17, 4.4]], (x, y) => ((x + y) % 2 ? 'y' : null));
  // reflection of the tower
  for (let y = 21; y < 30; y++) for (let x = 16; x <= 21; x++) if ((x + y) % 3 !== 0 && y - 21 < (30 - y) && P.get(x, y) !== 'y') P.set(x, y, Math.floor((y - 21) / 2) % 2 ? 'r' : 'e');
  for (let y = 19; y < 30; y += 2) P.line(1 + (y % 5), y, 3 + (y % 5), y, 's', 0.8);
});

def('cat', 24, 26, (P) => {
  P.rect(0, 0, 23, 25, 'k');
  P.rect(3, 2, 20, 18, (x, y) => ramp(['n', 'n', 'b'], y / 18, x, y));
  P.ellipse(16, 6, 2.6, 2.6, 'c'); P.ellipse(17.2, 5.4, 2.2, 2.2, (x, y) => (P.get(x, y) === 'c' ? null : null));
  P.set(16, 5, 'x'); P.set(15, 7, 'x');
  for (const [x, y] of [[5, 4], [9, 3], [12, 8], [7, 9], [19, 11], [10, 13], [5, 14]]) P.set(x, y, 'y');
  P.rect(11, 2, 12, 18, 'k'); P.rect(3, 10, 20, 10, 'k');
  // curtains
  for (const side of [0, 1]) {
    const x0 = side ? 18 : 1, x1 = side ? 22 : 5;
    P.poly(side ? [[19, 0], [23, 0], [23, 20], [20, 20], [21, 10]] : [[0, 0], [4, 0], [2, 10], [3, 20], [0, 20]], (x, y) => ((x + (y > 10 ? 1 : 0)) % 2 ? 'u' : 'v'));
    void x0; void x1;
  }
  // sill
  P.rect(0, 19, 23, 20, (x, y) => (y === 19 ? 'q' : 'l'));
  P.rect(0, 21, 23, 25, (x, y) => ((y + (x % 6 === 0 ? 1 : 0)) % 3 === 0 ? 'k' : 'i'));
  // cat sitting, seen from the back-ish side
  const body = P.ellipse(8.5, 15.2, 4.6, 4.4, (x, y, u, v) => (Math.floor((y + u * 2) / 2) % 2 ? 'o' : 'a'));
  P.outline(body, 'k', 'lb');
  const head = P.ellipse(8.5, 9.2, 3.2, 2.8, shade(['o', 'a', 'a'], 0.1));
  P.poly([[5.6, 8.4], [6, 5.2], [7.8, 7]], 'a'); P.poly([[9.4, 7], [11, 5.2], [11.4, 8.4]], 'a');
  P.set(6, 6, 'h'); P.set(10, 6, 'h');
  P.set(7, 9, 'j'); P.set(10, 9, 'j'); P.set(8, 10, 'h'); P.set(9, 10, 'h');
  P.ellipse(8.5, 13.6, 1.6, 2.4, 'c');
  P.outline(head, 'o', 'b');
  P.line(13, 18.5, 17.5, 17.5, 'o', 1.2); P.set(18, 17, 'a');
  // a pot plant
  P.rect(15, 16, 18, 18, (x) => (x === 18 ? 'd' : 'z'));
  blob(P, [[16.5, 14, 2, 1.6], [15.5, 12.6, 1, 1.4], [17.6, 13, 1, 1.2]], shade(['f', 'g', 'j']));
});

def('teapot', 26, 24, (P) => {
  P.rect(0, 0, 25, 15, (x, y) => (x % 4 === 0 ? 'h' : 'q'));
  P.rect(0, 14, 25, 14, 'l');
  P.rect(0, 15, 25, 23, (x, y) => {
    const cx = Math.floor((x + (y - 15)) / 3) % 2, cy = Math.floor((x - (y - 15) + 30) / 3) % 2;
    return cx && cy ? 'r' : cx || cy ? 'h' : 'c';
  });
  P.rect(0, 15, 25, 15, 'd');
  // steam
  P.line(10, 1, 11, 3, 'c', 0.8); P.line(11, 3, 10, 5, 'c', 0.8); P.line(20, 7, 21, 9, 'c', 0.8);
  // teapot
  P.ellipse(10, 18.2, 8, 1.2, 'd');
  P.line(16, 10, 19.5, 7, 'b', 1.6); P.set(20, 6, 'n');
  P.ellipse(3.6, 12.2, 2.4, 3, 'n'); P.ellipse(3.6, 12.2, 1.2, 1.8, 'q');
  const pot = P.ellipse(10, 12.4, 6.6, 5.6, shade(['n', 'b', 'b', 's'], 0.05));
  for (const [x, y] of [[7, 10], [11, 9], [13, 13], [8, 14], [10, 12], [14, 10], [6, 13]]) { P.set(x, y, 'c'); }
  P.outline(pot, 'n', 'br');
  P.rect(7, 6, 13, 7, (x) => (x === 13 ? 'n' : 'b')); P.rect(9, 5, 11, 5, 'b'); P.set(10, 4, 'y');
  P.rect(5, 17, 15, 17, 'n');
  // cup and saucer
  P.ellipse(21, 17.6, 4.4, 1, 'e');
  P.ellipse(21, 17.2, 4, 0.7, 'c');
  const cup = P.rect(18, 11, 23, 16, (x, y) => (y === 13 ? 'b' : x === 23 ? 'e' : 'c'));
  P.rect(19, 11, 22, 11, 'a');
  P.outline(cup, 'e', 'lr');
  P.ellipse(24.6, 13.5, 1.2, 1.6, (x, y) => (x === 25 ? 'e' : null));
});

def('quilt', 26, 26, (P) => {
  P.vgrad(0, 19, ['s', 'x']);
  blob(P, [[5, 3, 3.4, 1.2], [8, 2.3, 2.4, 1.4], [20, 5, 3, 1]], (x, y, u, v) => (v > 0.3 ? 'x' : 'c'));
  P.ellipse(6, 21, 11, 3, 'j'); P.ellipse(21, 20.5, 9, 2.6, 'w');
  P.rect(0, 21, 25, 25, (x, y) => ramp(['g', 'f'], (y - 21) / 5, x, y));
  P.line(0, 4.5, 26, 6, 'k', 0.9);
  // the quilt: 4 x 3 blocks of half-square triangles, hanging
  const cols = ['r', 'y', 'b', 't'];
  P.rect(3, 6, 22, 19, (x, y) => {
    const bx = Math.floor((x - 3) / 5), by = Math.floor((y - 6) / 5);
    const lx = (x - 3) % 5, ly = (y - 6) % 5;
    if (lx === 4 || ly === 4) return 'c';
    const a = cols[(bx + by) % 4], b = cols[(bx + by + 2) % 4];
    return (bx + by) % 2 ? (lx > ly ? a : b) : (lx + ly < 3 ? a : b);
  });
  P.rect(3, 6, 22, 6, 'c'); P.rect(3, 19, 22, 19, (x) => (x % 3 ? 'c' : 'e'));
  P.rect(22, 6, 22, 19, 'e');
  for (const x of [4, 12, 21]) { P.set(x, 5, 'l'); P.set(x, 6, 'l'); }
  P.ellipse(12.5, 20.5, 9, 0.7, 'f');
});

def('hedgehog', 26, 24, (P) => {
  P.vgrad(0, 13, ['q', 'l']);
  P.rect(0, 14, 25, 23, (x, y) => ramp(['l', 'k'], (y - 14) / 10, x, y));
  // trunks behind
  P.rect(1, 0, 3, 14, (x) => (x === 3 ? 'i' : 'k')); P.rect(21, 0, 24, 15, (x) => (x === 24 ? 'i' : 'k'));
  const rng = mulberry(19);
  const leaf = (x, y, c) => { P.set(x, y, c); P.set(x + 1, y, c); P.set(x, y + 1, c === 'r' ? 'd' : c); };
  for (let k = 0; k < 40; k++) leaf(Math.floor(rng() * 25), 13 + Math.floor(rng() * 11), ['o', 'z', 'r', 'a'][k % 4]);
  for (let k = 0; k < 12; k++) leaf(Math.floor(rng() * 25), Math.floor(rng() * 8), ['o', 'z'][k % 2]);
  // hedgehog
  P.ellipse(13, 19.6, 8, 1, 'i');
  const spines = P.ellipse(12, 15, 7.6, 5, (x, y, u, v) => ((x * 2 + y) % 3 === 0 ? 'q' : (x + y) % 2 ? 'k' : 'i'));
  P.outline(spines, 'i', 'tl');
  P.poly([[17, 13], [21.8, 17.2], [17, 19]], shade(['a', 'q', 'q'], 0.1));
  P.set(22, 17, 'i'); P.set(19, 15, 'i');
  for (const x of [9, 15]) P.rect(x, 19, x + 1, 19, 'a');
  // apple on its back
  P.ellipse(11, 9.6, 1.8, 1.6, shade(['d', 'r', 'r'])); P.set(11, 7, 'k'); P.set(12, 7, 'g');
});

def('bee', 26, 28, (P) => {
  P.vgrad(0, 27, ['x', 's', 's']);
  P.rect(0, 22, 25, 27, (x, y) => ramp(['j', 'g', 'f'], (y - 22) / 6, x, y));
  // clover heads on stems
  const clover = (cx, cy, r) => {
    P.line(cx, cy + r, cx + (cx > 13 ? 1 : -1), 27, 'g', 1);
    const m = P.ellipse(cx, cy, r, r * 1.1, (x, y, u, v) => ((x + y * 2) % 3 === 0 ? 'u' : v < -0.2 ? 'h' : 'p'));
    P.outline(m, 'v', 'b');
  };
  clover(6, 14, 3.4); clover(17, 17, 3); clover(21.5, 10.5, 2.4);
  // trefoil leaves
  for (const [cx, cy] of [[3, 22], [10, 21], [14, 23], [22, 22]]) blob(P, [[cx - 1.2, cy, 1.3, 1], [cx + 1.2, cy, 1.3, 1], [cx, cy - 1.2, 1, 1.3]], shade(['f', 'g', 'j']));
  // the bee
  P.ellipse(11.5, 5.2, 2.6, 1.8, (x, y, u, v) => (v < 0 ? 'c' : 'x'));
  P.ellipse(14.5, 4.8, 2.4, 1.6, (x, y, u, v) => (v < 0 ? 'c' : 'x'));
  const body = P.ellipse(13, 8.2, 4.6, 2.6, (x) => (Math.floor(x / 2) % 2 ? 'i' : 'y'));
  P.outline(body, 'i', 'b');
  P.ellipse(8.4, 8, 1.6, 1.6, 'i'); P.set(8, 7, 'c');
  P.set(18, 8, 'i');
  P.line(14, 11, 13, 12.5, 'i', 0.7);
  // little flight path
  for (const [x, y] of [[20, 4], [22, 5], [24, 4]]) P.set(x, y, 'c');
});

def('birdhouse', 24, 30, (P) => {
  P.vgrad(0, 29, ['s', 'x', 'x', 'q']);
  // branch and blossoms
  P.line(0, 4, 24, 2.5, 'k', 1.6);
  P.line(15, 3.4, 20, 6, 'k', 0.9);
  for (const [x, y] of [[3, 3], [6, 2], [9, 5], [18, 6], [21, 1], [13, 1], [22, 4]]) blob(P, [[x, y, 1.2, 1.1]], (xx, yy, u, v) => (v < 0 ? 'c' : 'h'));
  for (const [x, y] of [[3, 3], [9, 5], [21, 1]]) P.set(x, y, 'p');
  // hanging strings
  P.line(9, 4, 8, 10, 'k', 0.6); P.line(15, 3.6, 16, 10, 'k', 0.6);
  // roof
  const roof = P.poly([[4, 15], [12, 8], [20, 15]], shade(['d', 'r', 'r'], 0));
  P.outline(roof, 'd', 'b');
  P.rect(4, 15, 20, 15, 'd');
  const body = P.rect(6, 16, 18, 25, (x, y) => (x === 18 ? 'o' : (x + (y % 2)) % 3 === 0 ? 'o' : 'y'));
  P.outline(body, 'k', 'lb');
  P.ellipse(12, 19, 1.9, 1.9, 'i'); P.rect(11, 23, 13, 23, 'k');
  P.rect(5, 26, 19, 26, 'k');
  // bird on the perch
  P.ellipse(12, 21.6, 1.8, 1.2, shade(['n', 'b', 'x'])); P.set(14, 21, 'o'); P.set(11, 21, 'c'); P.set(10, 22, 'n');
  // ground of the garden far below
  P.rect(0, 27, 23, 29, (x, y) => ramp(['j', 'g'], (y - 27) / 3, x, y));
  for (const x of [2, 5, 20, 22]) P.set(x, 27, 'p');
});

def('loom', 26, 30, (P) => {
  P.rect(0, 0, 25, 29, (x, y) => ((x + Math.floor(y / 3)) % 5 === 0 ? 'l' : 'q'));
  // frame
  P.rect(2, 1, 23, 2, (x, y) => (y === 2 ? 'i' : 'k'));
  P.rect(2, 24, 23, 25, (x, y) => (y === 25 ? 'i' : 'k'));
  P.rect(2, 1, 3, 29, (x) => (x === 3 ? 'i' : 'k')); P.rect(22, 1, 23, 29, (x) => (x === 23 ? 'i' : 'k'));
  // warp threads on top, cloth below
  P.rect(4, 3, 21, 11, (x, y) => (x % 2 ? 'c' : 'e'));
  const bands = [['r', 'r'], ['y', 'o'], ['b', 'n'], ['c', 'y'], ['t', 'b'], ['r', 'd'], ['o', 'y'], ['n', 'b']];
  P.rect(4, 12, 21, 23, (x, y) => {
    const band = bands[Math.floor((23 - y) / 1.5) % bands.length];
    const zig = (x + y) % 4 < 2;
    return y < 13 ? 'c' : zig ? band[0] : band[1];
  });
  // the weaving edge and a heddle bar
  P.rect(4, 12, 21, 12, (x) => (x % 2 ? 'r' : 'c'));
  P.rect(3, 8, 22, 8, 'k');
  // shuttle with thread
  P.poly([[6, 12], [10, 11], [16, 11], [20, 12], [16, 13], [10, 13]], shade(['k', 'a', 'o']));
  P.line(16, 12, 21, 12, 'r', 0.7);
  // a basket of yarn on the floor
  P.rect(0, 27, 25, 29, 'k');
  blob(P, [[6, 27, 1.6, 1.4], [9, 27.4, 1.6, 1.3]], (x, y) => ((x + y) % 2 ? 'r' : 'd'));
  blob(P, [[18, 27, 1.6, 1.4]], (x, y) => ((x + y) % 2 ? 'b' : 'n'));
});

def('owl', 26, 32, (P) => {
  P.vgrad(0, 31, ['i', 'n', 'n', 'b']);
  P.ellipse(20, 5, 3.4, 3.4, (x, y, u, v) => (u + v > 0.3 ? 'e' : 'c'));
  const rng = mulberry(23);
  for (let k = 0; k < 22; k++) { const x = Math.floor(rng() * 26), y = Math.floor(rng() * 20); if (P.get(x, y) !== 'c' && P.get(x, y) !== 'e') P.set(x, y, k % 4 ? 'y' : 'x'); }
  // branch
  P.line(0, 25, 26, 23, 'k', 2.2); P.line(17, 24, 24, 29, 'k', 1.2);
  for (const [x, y] of [[3, 23], [22, 22], [24, 28], [1, 26]]) blob(P, [[x, y, 1.6, 1]], shade(['f', 'g', 'j']));
  // owl
  const body = P.ellipse(12, 17, 6.4, 7.4, (x, y, u, v) => (Math.abs(u) < 0.55 && v > -0.4 ? ((x + y) % 3 === 0 ? 'k' : 'l') : (x + y * 2) % 4 === 0 ? 'q' : 'a'));
  P.outline(body, 'k', 'all');
  const head = P.ellipse(12, 10, 5.6, 4.4, (x, y, u, v) => ((x * 3 + y) % 5 === 0 ? 'q' : 'a'));
  P.outline(head, 'k', 'lrt');
  P.poly([[6.4, 8], [7, 4], [9.4, 7]], 'k'); P.poly([[14.6, 7], [17, 4], [17.6, 8]], 'k');
  for (const ex of [9.6, 14.4]) { P.ellipse(ex, 10.2, 2, 2, 'c'); P.ellipse(ex, 10.2, 1.2, 1.2, 'o'); P.set(Math.floor(ex), 10, 'i'); }
  P.poly([[11, 11], [13, 11], [12, 13.4]], 'o');
  // wing
  P.poly([[6, 13], [9, 15], [8.6, 22], [5.6, 19]], (x, y) => ((x + y) % 2 ? 'k' : 'a'));
  P.poly([[18, 13], [15, 15], [15.4, 22], [18.4, 19]], (x, y) => ((x + y) % 2 ? 'k' : 'a'));
  for (const fx of [10, 14]) P.rect(fx - 1, 23, fx + 1, 23, 'o');
});

def('fox', 28, 30, (P) => {
  P.vgrad(0, 16, ['y', 'q', 'a']);
  // birch trunks and falling leaves
  for (const x0 of [2, 21, 25]) { P.rect(x0, 0, x0 + 1, 18, (x, y) => ((y * 3 + x) % 5 === 0 ? 'i' : 'c')); }
  P.rect(0, 17, 27, 29, (x, y) => ramp(['o', 'a', 'z', 'k'], (y - 17) / 13, x, y));
  const rng = mulberry(31);
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(rng() * 27), y = Math.floor(rng() * 30);
    const c = ['z', 'r', 'o', 'd', 'y'][k % 5];
    if (y < 16 && k % 3) continue;
    P.set(x, y, c); if (y >= 16) P.set(x + 1, y, c === 'y' ? 'o' : c);
  }
  // fox: body, tail, head
  P.ellipse(14, 26.2, 9, 1.2, 'k');
  const tail = P.poly([[16, 24], [24, 21], [26.4, 16.6], [25, 24], [18, 26]], (x, y, u, v) => (u > 0.55 && v < 0 ? 'c' : (x + y) % 5 === 0 ? 'r' : 'z'));
  P.outline(tail, 'd', 'b');
  const body = P.ellipse(13, 21, 6, 4.6, shade(['d', 'z', 'z', 'a'], 0.05));
  P.ellipse(10.4, 22, 2.2, 3, 'c');
  P.outline(body, 'd', 'br');
  for (const x of [9, 11, 15, 17]) P.rect(x, 24, x, 26, 'i');
  const head = P.poly([[5, 13.5], [7, 9.6], [9, 11.2], [11, 9.6], [13, 13.5], [9, 18]], shade(['d', 'z', 'a'], 0.1));
  P.poly([[5.6, 14.2], [9, 18], [9, 15]], 'c'); P.poly([[12.4, 14.2], [9, 18], [9, 15]], 'c');
  P.outline(head, 'd', 'lr');
  P.set(7, 13, 'i'); P.set(11, 13, 'i'); P.set(9, 17, 'i');
  P.set(7, 10, 'i'); P.set(11, 10, 'i');
});

def('harbor', 30, 30, (P) => {
  P.vgrad(0, 13, ['s', 'x']);
  blob(P, [[6, 3, 3.6, 1.2], [9, 2.2, 2.6, 1.4], [23, 4, 3.4, 1.1]], (x, y, u, v) => (v > 0.3 ? 'x' : 'c'));
  // hill with houses
  P.ellipse(15, 15, 18, 5, (x, y) => ramp(['j', 'w'], (y - 10) / 6, x, y));
  const houses = [[2, 'r'], [6, 'y'], [10, 'b'], [14, 'c'], [18, 'p'], [22, 'y'], [26, 'r']];
  houses.forEach(([x, c], i) => {
    const top = 9 + (i % 3);
    P.rect(x, top, x + 3, 14, (xx) => (xx === x + 3 ? 'e' : c));
    P.poly([[x - 0.4, top], [x + 2, top - 2.4], [x + 4.4, top]], i % 2 ? 'd' : 'k');
    P.set(x + 1, top + 2, 'n'); P.set(x + 2, 13, 'k');
  });
  P.rect(0, 15, 29, 15, 'e');
  P.rect(0, 16, 29, 29, (x, y) => ramp(['b', 'n'], (y - 16) / 14, x, y));
  for (let y = 17; y < 30; y += 2) for (let x = (y * 3) % 7; x < 30; x += 7) { P.set(x, y, 's'); P.set(x + 1, y, 's'); }
  // reflections of the houses
  houses.forEach(([x, c]) => { for (let y = 16; y < 21; y++) if ((x + y) % 2) P.set(x + 1, y, c); });
  // boats
  const boat = (x, y, hull, sail) => {
    P.poly([[x, y], [x + 8, y], [x + 6.6, y + 2.4], [x + 1.4, y + 2.4]], (xx, yy) => (yy <= y + 0.6 ? 'c' : hull));
    P.rect(x + 4, y - 8, x + 4, y - 1, 'k');
    P.poly([[x + 4.4, y - 8], [x + 8, y - 1.2], [x + 4.4, y - 1.2]], (xx, yy, u) => (u > 0.4 ? 'e' : sail));
    P.poly([[x + 3.6, y - 6], [x + 3.6, y - 1.2], [x + 1, y - 1.2]], 'e');
    for (let yy = y + 3; yy < y + 7; yy++) if (yy % 2) P.line(x + 1.5, yy, x + 6.5, yy, hull, 0.6);
  };
  boat(3, 21, 'r', 'c'); boat(17, 24, 'y', 'q'); boat(11, 18, 'b', 'c');
  P.rect(25, 17, 29, 18, 'k'); for (const x of [25, 28]) P.rect(x, 19, x, 23, 'k');
});

def('wheel', 28, 32, (P) => {
  P.rect(0, 0, 27, 23, (x, y) => ((x * 7 + y) % 9 === 0 ? 'l' : 'q'));
  P.rect(0, 24, 27, 31, (x, y) => (y % 3 === 0 ? 'i' : (x + Math.floor(y / 3) * 5) % 9 === 0 ? 'i' : 'k'));
  // wheel
  const cx = 12, cy = 11;
  P.shape([cx - 9, cy - 9, cx + 9, cy + 9], (x, y) => { const d = Math.hypot(x - cx, y - cy); return d >= 7 && d <= 8.6; }, (x, y) => (y > cy + 2 || x > cx + 3 ? 'i' : 'k'));
  for (let a = 0; a < 10; a++) { const t = (a * Math.PI) / 5 + 0.15; P.line(cx, cy, cx + Math.cos(t) * 7.2, cy + Math.sin(t) * 7.2, 'a', 0.8); }
  P.ellipse(cx, cy, 1.6, 1.6, 'o');
  // frame and legs
  P.line(cx, cy, 20, 18, 'k', 1.4); P.line(4, 30, 9, 20, 'k', 1.4); P.line(20, 30, 18, 18, 'k', 1.4); P.line(12, 30, 12, 20, 'k', 1.4);
  P.rect(8, 20, 23, 21, 'k');
  // flyer and distaff with fleece
  P.rect(20, 14, 25, 15, 'o'); P.set(22, 13, 'k');
  P.line(24, 13, 24, 4, 'k', 0.8);
  blob(P, [[24, 4, 2.6, 2], [23, 6.4, 2, 1.6]], (x, y, u, v) => (v > 0.2 ? 'l' : 'c'));
  // basket of skeins
  P.rect(1, 25, 7, 29, (x, y) => ((x + y) % 2 ? 'a' : 'o'));
  blob(P, [[2.6, 24, 1.6, 1.2], [5.6, 24, 1.6, 1.2]], (x, y, u) => (u < 0 ? 'p' : 'u'));
  P.ellipse(4, 22.6, 1.4, 1, 'g');
});

def('dyepot', 28, 32, (P) => {
  P.vgrad(0, 18, ['m', 'u', 'p', 'a']);
  for (const [x, y] of [[4, 2], [9, 1], [22, 3], [17, 2]]) P.set(x, y, 'h');
  P.rect(0, 19, 27, 31, (x, y) => ramp(['g', 'f'], (y - 19) / 12, x, y));
  // drying line with dyed skeins
  P.line(0, 4, 28, 5.5, 'k', 0.8);
  [[3, 'u'], [8, 'b'], [19, 'y'], [24, 'r']].forEach(([x, c]) => P.rect(x, 5, x + 2, 11, (xx, yy) => (yy === 5 ? 'l' : (xx + yy) % 3 === 0 ? 'v' : c)));
  // tripod
  P.line(5, 30, 14, 7, 'k', 1.2); P.line(23, 30, 14, 7, 'k', 1.2);
  P.line(14, 7, 14, 13, 'i', 0.8);
  // steam
  P.line(11, 9, 12, 12, 'c', 0.8); P.line(16, 8, 17, 11, 'c', 0.8);
  // pot
  const pot = P.ellipse(14, 17.4, 6.4, 4.6, shade(['i', 'i', 'k', 'e'], -0.05));
  P.outline(pot, 'i', 'all');
  P.ellipse(14, 13.6, 5.6, 1.3, (x, y) => ((x + y) % 4 === 0 ? 'u' : 'v'));
  P.set(12, 13, 'c'); P.set(16, 14, 'c');
  // fire
  P.rect(8, 25, 20, 26, (x) => (x % 4 === 0 ? 'i' : 'k'));
  P.poly([[9, 25], [11, 20], [12.5, 23], [14, 19.6], [15.5, 23], [17, 20.6], [19, 25]], (x, y, u, v) => ramp(['y', 'o', 'z', 'r'], (v + 1) / 2.2, x, y));
  // stones
  for (const x of [6, 8.6, 19.4, 22]) blob(P, [[x, 26.6, 1.5, 1.2]], shade(['i', 'e', 'c']));
  for (const [x, y] of [[13, 18], [15, 17]]) P.set(x, y, 'o');
});

def('strawberries', 28, 30, (P) => {
  P.rect(0, 0, 27, 15, (x, y) => ((x + y) % 7 === 0 ? 'p' : 'h'));
  P.rect(0, 16, 27, 29, (x, y) => {
    const a = Math.floor(x / 3) % 2, b = Math.floor((y - 16) / 3) % 2;
    return a && b ? 'r' : a || b ? 'p' : 'c';
  });
  P.rect(0, 16, 27, 16, 'd');
  // bowl
  P.ellipse(14, 25.4, 10, 1.4, 'd');
  const bowl = P.shape([3, 13, 25, 26], (x, y) => ((x - 14) / 11) ** 2 + ((y - 14) / 11) ** 2 <= 1 && y >= 15, (x, y) => (y === 18 || y === 22 ? 'c' : x > 19 ? 'n' : 'b'));
  P.outline(bowl, 'n', 'b');
  // berries heaped
  const berry = (cx, cy) => {
    const m = P.poly([[cx - 2.4, cy - 1.6], [cx + 2.4, cy - 1.6], [cx + 1.6, cy + 1.6], [cx, cy + 3], [cx - 1.6, cy + 1.6]], (x, y, u, v) => {
      if ((x * 2 + y) % 3 === 0) return 'y';
      return u > 0.4 ? 'd' : 'r';
    });
    P.outline(m, 'd', 'b');
    P.poly([[cx - 2, cy - 1.6], [cx, cy - 3], [cx + 2, cy - 1.6]], (x, y) => ((x + y) % 2 ? 'g' : 'j'));
  };
  for (const [x, y] of [[8, 12.4], [13, 11.6], [18, 12.2], [10.6, 9.4], [15.6, 9], [5, 14], [22, 14], [13, 6.6]]) berry(x, y);
  berry(23, 22); P.set(4, 21, 'r'); P.set(5, 21, 'r'); P.set(5, 22, 'd');
});

def('mittens', 30, 30, (P) => {
  P.vgrad(0, 21, ['n', 'b', 's', 'x']);
  const rng = mulberry(41);
  for (let k = 0; k < 40; k++) P.set(Math.floor(rng() * 30), Math.floor(rng() * 22), 'c');
  // pines
  for (const [x, h] of [[3, 9], [26, 11], [22, 7]]) P.poly([[x - 3, 22], [x, 22 - h], [x + 3, 22]], (xx, yy) => ((xx + yy) % 3 === 0 ? 'c' : xx > x ? 'f' : 'g'));
  P.rect(0, 22, 29, 29, (x, y) => ramp(['c', 'x', 'e'], (y - 22) / 9, x, y));
  // the line
  P.line(0, 4, 30, 5.2, 'k', 0.9);
  const mitten = (x0, flip, main, dark, pat) => {
    const m = P.rect(x0, 7, x0 + 6, 18, (x, y) => {
      if (y <= 8) return (x + y) % 2 ? 'c' : 'e';
      if (y === 12 || y === 13) return (x + y) % 2 ? pat : main;
      return x === (flip ? x0 : x0 + 6) ? dark : main;
    });
    P.ellipse(x0 + 3, 18.6, 3.6, 1.6, main);
    P.rect(flip ? x0 - 2 : x0 + 7, 11, flip ? x0 - 1 : x0 + 8, 15, (x) => (x === (flip ? x0 - 2 : x0 + 8) ? dark : main));
    P.outline(m, dark, 'b');
    P.rect(x0 + 2, 5, x0 + 2, 7, 'k'); P.rect(x0 + 4, 5, x0 + 4, 7, 'k');
  };
  mitten(4, false, 'r', 'd', 'c');
  mitten(18, true, 'b', 'n', 'y');
  // a little star cut on each
  P.set(7, 16, 'c'); P.set(21, 16, 'y');
});

def('village', 30, 34, (P) => {
  P.vgrad(0, 22, ['n', 'm', 'p', 'a']);
  P.ellipse(23, 5, 2.6, 2.6, (x, y, u, v) => (u > 0.3 ? null : 'y'));
  const rng = mulberry(53);
  for (let k = 0; k < 16; k++) { const x = Math.floor(rng() * 30), y = Math.floor(rng() * 9); if (P.get(x, y) === 'n' || P.get(x, y) === 'm') P.set(x, y, 'y'); }
  // far hills
  P.ellipse(6, 22, 12, 4, 'v'); P.ellipse(24, 21, 10, 3.4, 'v');
  // houses: silhouettes with lit windows
  const houses = [[1, 18, 6], [8, 16, 5], [14, 19, 6], [21, 17, 7]];
  for (const [x, top, w] of houses) {
    P.rect(x, top, x + w - 1, 28, 'k');
    P.poly([[x - 1, top], [x + w / 2, top - 4], [x + w, top]], 'n');
    for (let wy = top + 2; wy < 27; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if ((wx + wy) % 3) P.set(wx, wy, 'y');
  }
  // church spire
  P.rect(27, 12, 29, 28, 'k'); P.poly([[26.6, 12], [28, 4], [29.6, 12]], 'n'); P.set(28, 15, 'y');
  P.rect(0, 29, 29, 33, (x, y) => ramp(['f', 'g'], (33 - y) / 5, x, y));
  P.rect(0, 29, 29, 29, (x) => (x % 4 === 0 ? 'g' : 'f'));
  for (let x = 2; x < 30; x += 5) P.set(x, 31, 'y');
});

def('sampler', 30, 34, (P) => {
  P.rect(0, 0, 29, 33, (x, y) => (x % 4 === 1 && y % 4 === 2 ? 'q' : 'l'));
  // zigzag border
  P.rect(0, 0, 29, 33, (x, y) => {
    const e = Math.min(x, y, 29 - x, 33 - y);
    if (e === 0) return 'd';
    if (e === 1) return (x + y) % 4 < 2 ? 'r' : null;
    return null;
  });
  // three letters, pixel stitched: A B C
  const glyphs = {
    A: ['.xx.', 'x..x', 'xxxx', 'x..x', 'x..x'],
    B: ['xxx.', 'x..x', 'xxx.', 'x..x', 'xxx.'],
    C: ['.xxx', 'x...', 'x...', 'x...', '.xxx'],
  };
  ['A', 'B', 'C'].forEach((k, i) => glyphs[k].forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'x') P.set(6 + i * 7 + x, 4 + y, ['b', 'g', 'u'][i]); })));
  // heart
  P.poly([[15, 22], [9, 15.6], [10, 12.4], [12.6, 11.8], [15, 14], [17.4, 11.8], [20, 12.4], [21, 15.6]], (x, y, u, v) => (u < -0.4 && v < -0.2 ? 'p' : 'r'));
  // trees
  for (const tx of [5, 25]) {
    P.poly([[tx - 3, 20], [tx, 13], [tx + 3, 20]], (x, y) => ((x + y) % 2 ? 'f' : 'g'));
    P.rect(tx, 21, tx, 23, 'k');
  }
  // a little house
  P.rect(11, 26, 18, 30, (x, y) => (x === 14 && y >= 28 ? 'k' : 'y'));
  P.poly([[10, 26], [14.5, 22.6], [19, 26]], 'd');
  P.set(12, 27, 'b'); P.set(17, 27, 'b');
  // birds and flowers
  for (const [x, y] of [[4, 25], [24, 25]]) { P.set(x, y, 'b'); P.set(x + 1, y - 1, 'b'); P.set(x + 2, y, 'b'); }
  for (const x of [3, 7, 22, 26]) { P.set(x, 29, 'u'); P.set(x, 30, 'g'); P.set(x, 31, 'g'); }
});

// The gap pictures of chapters 4 to 10 (art-gen-chapters.mjs).
addChapterPictures(def, { mulberry });

// ---------- output ----------
export function renderAll() {
  const out = {};
  for (const [id, { W, H, fn, max }] of Object.entries(PICTURES)) {
    const P = new Pic(W, H, 'c');
    fn(P);
    P.budget(max);
    out[id] = P.rows();
  }
  return out;
}

function png(rows, scale = 8) {
  const H = rows.length * scale, W = rows[0].length * scale;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const hex = PALETTE[rows[Math.floor(y / scale)][Math.floor(x / scale)]].hex;
      const n = parseInt(hex.slice(1), 16);
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = n >> 16; raw[o + 1] = (n >> 8) & 255; raw[o + 2] = n & 255;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const art = renderAll();
  const body = Object.entries(art).map(([id, rows]) => `  ${id}: [\n${rows.map((r) => `    '${r}',`).join('\n')}\n  ],`).join('\n');
  writeFileSync(new URL('./art.js', import.meta.url),
    `// Generated by art-gen.mjs from layered shapes. Do not edit by hand; edit the\n// compositions there and run: node proto/lift/art-gen.mjs\nexport const ART = {\n${body}\n};\n`);
  const i = process.argv.indexOf('--png');
  if (i > 0) {
    const dir = process.argv[i + 1];
    mkdirSync(dir, { recursive: true });
    for (const [id, rows] of Object.entries(art)) writeFileSync(`${dir}/${id}.png`, png(rows));
    // a contact sheet: 6 across, gaps of paper
    const ids = Object.keys(art), S = 6, cw = 32 * S + 12, ch = 36 * S + 12, across = 6;
    const sheet = Array.from({ length: Math.ceil(ids.length / across) * 36 + Math.ceil(ids.length / across) * 2 }, () => '');
    void sheet; void cw; void ch;
    const big = [];
    const rowsN = Math.ceil(ids.length / across);
    for (let R = 0; R < rowsN; R++) {
      for (let y = 0; y < 38; y++) {
        let line = '';
        for (let C = 0; C < across; C++) {
          const id = ids[R * across + C];
          const a = id ? art[id] : null;
          for (let x = 0; x < 33; x++) line += a && y < a.length && x < a[0].length ? a[y][x] : 'q';
        }
        big.push(line);
      }
    }
    writeFileSync(`${dir}/_sheet.png`, png(big, S));
  }
  for (const [id, rows] of Object.entries(art)) {
    const colors = new Set(rows.join(''));
    console.log(`${id.padEnd(13)} ${rows[0].length}x${rows.length}  ${colors.size} colors  ${[...colors].sort().join('')}`);
  }
}
