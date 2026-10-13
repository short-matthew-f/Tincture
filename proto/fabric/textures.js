// textures.js — drawing fabric for the fiber prototypes.
//
// CONTRACT (used by the Dye Studio and the Quilt Designer; the Dye Studio
// owns and may improve the drawing, but must keep these exports and their
// meaning):
//
//   BASES: [{ id, name, note }]           the cloth types
//   PRINTS: [{ id, name }]                procedural prints for the starter stash
//   DYES: [{ id, name, hex }]             the natural-dye palette (matches the game)
//   drawBase(ctx, size, baseId, hex, rng)  fills a size×size tile with plain cloth of
//                                           that type and color (weave, slubs, nap, sheen)
//   drawPrint(ctx, size, printId, colors, rng)  draws a print over the cloth
//   fabricTile(spec, px = 384) -> canvas    spec = { base, color, print?, colors?, seed }
//   tileDataURL(canvas, q = 0.86) -> 'data:image/jpeg;...'
//   starterFabrics() -> [Fabric]           a small starter stash (see stash.js), deterministic
//   mulberry32(seed) -> rng
//
// How the cloth is drawn (Dye Studio, v2): every pixel is a real plain weave.
// weaveField() samples warp and weft threads (round yarn profile, over-under
// crossings, per-thread thickness and tone, linen slubs, flannel nap, voile
// gaps) 2×2 supersampled into three maps: lum (shading, mean 1), weft (how much
// of the pixel is weft yarn) and gap (open space between threads). shadeCloth()
// turns those maps plus a dye *absorbance* (subtractive: color = white·e^−A)
// into RGBA, so dyeing, overdyeing and printing all sit "in" the threads. Both
// functions are pure (no DOM); only drawBase/fabricTile/tileDataURL touch canvas.
// Tiles repeat seamlessly (even thread counts, periodic noise).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DYES = [
  { id: 'madder', name: 'Madder', hex: '#B8433A' },
  { id: 'ochre', name: 'Ochre', hex: '#D9A63A' },
  { id: 'woad', name: 'Woad', hex: '#3E6A9E' },
  { id: 'indigo', name: 'Indigo', hex: '#2C3E66' },
  { id: 'weld', name: 'Weld', hex: '#E3C65A' },
  { id: 'cochineal', name: 'Cochineal', hex: '#C2507A' },
  { id: 'logwood', name: 'Logwood', hex: '#5B3B6E' },
  { id: 'walnut', name: 'Walnut', hex: '#6B4A32' },
  { id: 'sage', name: 'Sage', hex: '#8A9A6B' },
  { id: 'rust', name: 'Rust', hex: '#A4562D' },
  { id: 'charcoal', name: 'Charcoal', hex: '#2E2B28' },
  { id: 'cream', name: 'Undyed', hex: '#EFE6D2' },
];

export const BASES = [
  { id: 'quilting-cotton', name: 'Quilting cotton', note: 'Crisp, even plain weave. The everyday quilter\'s cloth.' },
  { id: 'batik-cotton', name: 'Batik cotton', note: 'A tight, fine weave that holds wax lines crisply.' },
  { id: 'linen', name: 'Linen', note: 'Slubby threads and a soft, uneven color.' },
  { id: 'flannel', name: 'Flannel', note: 'Brushed and fuzzy; colors look soft.' },
  { id: 'voile', name: 'Voile', note: 'Light and fine, with a gentle sheen.' },
  { id: 'chambray', name: 'Chambray', note: 'Colored warp, white weft: a soft, heathered look.' },
  { id: 'shot-cotton', name: 'Shot cotton', note: 'Two colors woven together: it shimmers.' },
];

export const PRINTS = [
  { id: 'dots', name: 'Polka dots' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'gingham', name: 'Gingham' },
  { id: 'calico', name: 'Calico' },
  { id: 'floral', name: 'Small floral' },
  { id: 'plaid', name: 'Plaid' },
];

// How each cloth is built. pitch: px per thread on a 512 px (8 inch) piece. cover: yarn width
// as a fraction of the pitch. contrast: how strongly the weave shades. tone/width: per-thread
// unevenness. slub: thick-and-thin yarn. paper: the undyed cloth. weftUptake < 1: the weft
// stays pale (chambray). shot: the weft is a different hue. gapLight: open weave you can see
// light through (voile). sheen: soft specular band. fuzz: brushed nap. muted: nap softens color.
export const BASE_LOOK = {
  'quilting-cotton': { pitch: 4, cover: 0.86, contrast: 0.34, tone: 0.05, width: 0.05, slub: 0, wobble: 0.02, paper: '#F4F0E6', uneven: 0.025, grain: 0.035 },
  'batik-cotton': { pitch: 3.2, cover: 0.95, contrast: 0.22, tone: 0.03, width: 0.03, slub: 0, wobble: 0.01, paper: '#F7F4EC', uneven: 0.015, grain: 0.025 },
  linen: { pitch: 5.4, cover: 0.78, contrast: 0.42, tone: 0.2, width: 0.16, slub: 1.1, wobble: 0.1, paper: '#E2D6BE', uneven: 0.06, grain: 0.05 },
  flannel: { pitch: 5, cover: 0.97, contrast: 0.1, tone: 0.04, width: 0.05, slub: 0.2, wobble: 0.04, paper: '#F2EDE3', uneven: 0.03, grain: 0.02, fuzz: 1, muted: 0.16 },
  voile: { pitch: 2.8, cover: 0.62, contrast: 0.3, tone: 0.04, width: 0.015, slub: 0, wobble: 0.02, paper: '#F8F6F1', uneven: 0.02, grain: 0.02, gapLight: 0.6, sheen: 0.07 },
  chambray: { pitch: 3.6, cover: 0.9, contrast: 0.3, tone: 0.06, width: 0.06, slub: 0.15, wobble: 0.03, paper: '#F6F4EE', uneven: 0.03, grain: 0.03, weftUptake: 0.18 },
  'shot-cotton': { pitch: 3.6, cover: 0.9, contrast: 0.32, tone: 0.05, width: 0.05, slub: 0.15, wobble: 0.03, paper: '#F5F2EA', uneven: 0.025, grain: 0.03, shot: 0.45, sheen: 0.045 },
};
export function lookOf(baseId) { return BASE_LOOK[baseId] || BASE_LOOK['quilting-cotton']; }

// ------------------------------------------------------------------ color
export const REF = [252, 250, 246]; // the whitest cloth; color = REF * exp(-absorbance)

export function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbHex(c) {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** Absorbance of a color against REF white: e^-A * REF = color. Never negative. */
export function absorbOf(hex) {
  const c = typeof hex === 'string' ? hexRgb(hex) : hex;
  return [0, 1, 2].map((k) => Math.max(0, -Math.log(Math.max(4, c[k]) / REF[k])));
}
export function colorOfAbsorb(a) { return [0, 1, 2].map((k) => REF[k] * Math.exp(-a[k])); }

// ------------------------------------------------------------------ noise (periodic, pure)
function hash3(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Value noise in [0,1], periodic with period px × py lattice cells. */
export function vnoise(x, y, px, py, s) {
  const xf = Math.floor(x), yf = Math.floor(y);
  let fx = x - xf, fy = y - yf;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xf % px) + px) % px, y0 = ((yf % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash3(x0, y0, s), b = hash3(x1, y0, s), c = hash3(x0, y1, s), d = hash3(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise field N×N in [0,1] (about 0.5 mean), seamless; cells = lattice cells across (integer).
 *  Low frequencies are computed on a coarse grid and upsampled, so big soft noise is cheap. */
export function noiseField(N, cells, seed, oct = 4, gain = 0.5) {
  const top = Math.max(1, Math.round(cells * (1 << (oct - 1))));
  const M = Math.min(N, Math.max(16, top * 6));
  const g = new Float32Array(M * M);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const c = Math.max(1, Math.round(cells * (1 << o)));
    const k = c / M, s = (seed * 31 + o * 977) | 0;
    for (let y = 0; y < M; y++) {
      const fy = y * k;
      for (let x = 0; x < M; x++) g[y * M + x] += amp * vnoise(x * k, fy, c, c, s);
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < g.length; i++) g[i] /= norm;
  if (M === N) return g;
  const out = new Float32Array(N * N), r = M / N;
  for (let y = 0; y < N; y++) {
    const gy = y * r, y0 = Math.floor(gy), fy = gy - y0, ya = (y0 % M) * M, yb = ((y0 + 1) % M) * M;
    for (let x = 0; x < N; x++) {
      const gx = x * r, x0 = Math.floor(gx), fx = gx - x0, xa = x0 % M, xb = (x0 + 1) % M;
      const a = g[ya + xa], b = g[ya + xb], c = g[yb + xa], d = g[yb + xb];
      out[y * N + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

// ------------------------------------------------------------------ weave
const WEAVE_CACHE = new Map();

/**
 * weaveField(baseId, N, seed = 1, threads?) -> { N, threads, lum, weft, gap, spec, shim, look }
 * A plain weave of `threads` × `threads` (even, so it tiles) on an N×N grid. If threads is
 * omitted, the thread count matches an 8 inch piece at that cloth's pitch.
 */
export function weaveField(baseId, N, seed = 1, threads = 0) {
  const key = `${baseId}|${N}|${seed}|${threads}`;
  const hit = WEAVE_CACHE.get(key);
  if (hit) return hit;
  const L = lookOf(baseId);
  let T = threads || Math.round(512 / L.pitch);
  T = Math.max(4, T + (T & 1));
  const pitch = N / T;
  const rng = mulberry32(seed * 7919 + 13);
  const mk = (n, f) => { const a = new Float32Array(n); for (let k = 0; k < n; k++) a[k] = f(rng()); return a; };
  const wW = mk(T, (r) => L.cover * (1 + L.width * (r * 2 - 1)));
  const fW = mk(T, (r) => L.cover * (1 + L.width * (r * 2 - 1)));
  const wT = mk(T, (r) => 1 + L.tone * (r * 2 - 1));
  const fT = mk(T, (r) => 1 + L.tone * (r * 2 - 1));
  const wO = mk(T, (r) => 0.5 + (r - 0.5) * L.wobble);
  const fO = mk(T, (r) => 0.5 + (r - 0.5) * L.wobble);
  const slubP = Math.max(1, Math.round(T / 7)), wobP = Math.max(1, Math.round(T / 3));
  const sl = L.slub, wob = L.wobble, var_ = sl > 0 || wob > 0.02;
  const lum = new Float32Array(N * N), weft = new Float32Array(N * N), gap = new Float32Array(N * N);
  const S = 2, inv = 1 / (S * S), NS = N * S;
  const sseed = seed * 13 + 5;
  const PI = Math.PI, TAU = 2 * Math.PI;
  // Along-thread tables: position, thread index, fraction, the crossing bulge and the yarn twist
  // (twist = sin(a + b) split into per-row and per-column parts).
  const cI = new Int32Array(NS), cF = new Float32Array(NS), cSin = new Float32Array(NS), cTs = new Float32Array(NS);
  for (let c = 0; c < NS; c++) {
    const u = (c + 0.5) / S / pitch, i = Math.floor(u), f = u - i;
    cI[c] = i % T; cF[c] = f; cSin[c] = Math.sin(PI * f);
    cTs[c] = Math.sin(TAU * f * 2.3);
  }
  // Thick-and-thin yarn and wandering threads, sampled once per thread per supersample step.
  const slubOf = (along, idx, salt) => {
    const n = vnoise(along / 7, idx * 3.7 + salt, slubP, 4096, sseed);
    return n > 0.58 ? sl * (n - 0.58) / 0.42 : -0.12 * sl * (0.58 - n);
  };
  const wobOf = (along, idx, salt) => wob * (vnoise(along / 3, idx * 5.3 + salt, wobP, 4096, sseed + 1) - 0.5);
  // Sampled every half thread along each yarn and interpolated (slubs are several threads long).
  let warpW = null, warpC = null, weftW = null, weftC = null;
  const SR = 2, L2 = T * SR;
  if (var_) {
    warpW = new Float32Array(T * L2); warpC = new Float32Array(T * L2); weftW = new Float32Array(T * L2); weftC = new Float32Array(T * L2);
    for (let i = 0; i < T; i++) for (let r = 0; r < L2; r++) {
      const v = r / SR, k = i * L2 + r;
      warpW[k] = 0.5 * wW[i] * (1 + slubOf(v, i, 0)); warpC[k] = wO[i] + wobOf(v, i, 0);
      weftW[k] = 0.5 * fW[i] * (1 + slubOf(v, i, 101)); weftC[k] = fO[i] + wobOf(v, i, 101);
    }
  }
  // per supersample row/column: index into those tables and the blend weight
  const aI = new Int32Array(NS), aF = new Float32Array(NS);
  for (let c = 0; c < NS; c++) { const s = ((c + 0.5) / S / pitch) * SR; const f = Math.floor(s); aI[c] = f % L2; aF[c] = s - f; }
  const hW = new Float32Array(T), hF = new Float32Array(T);
  for (let i = 0; i < T; i++) { hW[i] = 0.5 * wW[i]; hF[i] = 0.5 * fW[i]; }
  let sum = 0;
  for (let y = 0; y < N; y++) {
    for (let sy = 0; sy < S; sy++) {
      const r = y * S + sy;
      const j = cI[r], fv = cF[r], sinV = cSin[r], tvs = cTs[r];
      const tj = fT[j];
      for (let x = 0; x < N; x++) {
        let accL = 0, accW = 0, accG = 0;
        for (let sx = 0; sx < S; sx++) {
          const c = x * S + sx;
          const i = cI[c], fu = cF[c];
          let hw, ci, hf, cj;
          if (var_) {
            const ar = aI[r], ar1 = (ar + 1) % L2, fr = aF[r], ac = aI[c], ac1 = (ac + 1) % L2, fc = aF[c];
            const k = i * L2, q = j * L2;
            hw = warpW[k + ar] + (warpW[k + ar1] - warpW[k + ar]) * fr; ci = warpC[k + ar] + (warpC[k + ar1] - warpC[k + ar]) * fr;
            hf = weftW[q + ac] + (weftW[q + ac1] - weftW[q + ac]) * fc; cj = weftC[q + ac] + (weftC[q + ac1] - weftC[q + ac]) * fc;
          } else { hw = hW[i]; ci = wO[i]; hf = hF[j]; cj = fO[j]; }
          const dx = (fu - ci) / hw, dy = (fv - cj) / hf;
          const d2x = dx * dx, d2y = dy * dy;
          const warpTop = ((i + j) & 1) === 0;
          if (warpTop ? d2x < 1 : (d2y >= 1 && d2x < 1)) {
            // warp yarn: round profile, bulging where it crosses over, twisted fibers
            const tw = 0.95 + 0.05 * tvs;
            accL += Math.sqrt(1 - d2x) * (warpTop ? 0.6 + 0.4 * sinV : 0.5) * wT[i] * tw;
          } else if (d2y < 1) {
            const tw = 0.95 + 0.05 * cTs[c];
            accL += Math.sqrt(1 - d2y) * (!warpTop ? 0.6 + 0.4 * cSin[c] : 0.5) * tj * tw;
            accW += 1;
          } else { accL += 0.12; accG += 1; }
        }
        const p = y * N + x;
        lum[p] += accL * inv; weft[p] += accW * inv; gap[p] += accG * inv;
      }
    }
  }
  for (let p = 0; p < N * N; p++) sum += lum[p];
  const mean = sum / (N * N) || 1;
  // a whole piece reads as cloth with a softer weave; close-ups (threads given) show every thread
  const con = L.contrast * (threads ? 1.15 : 0.72);
  // Low-frequency unevenness (yarn lots, linen's soft mottle) and per-pixel fiber grain.
  const uneven = L.uneven ? noiseField(N, 4, seed + 3, 2) : null;
  const grng = mulberry32(seed * 31 + 7);
  for (let p = 0; p < N * N; p++) {
    let l = 1 + con * (lum[p] / mean - 1);
    if (uneven) l *= 1 + L.uneven * 2 * (uneven[p] - 0.5);
    l *= 1 + L.grain * (grng() - 0.5);
    lum[p] = l;
  }
  let spec = null, shim = null;
  if (L.fuzz) brushNap(lum, N, seed, L.fuzz);
  if (L.sheen) {
    spec = new Float32Array(N * N);
    const band = noiseField(N, 2, seed + 11, 2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x;
      const b = Math.max(0, Math.sin(6.2832 * ((x + y) / N) + band[p] * 4)) ** 3;
      spec[p] = L.sheen * b * (1 - gap[p]) * Math.max(0, lum[p] - 0.7);
    }
  }
  if (L.shot) shim = noiseField(N, 2, seed + 17, 2);
  const out = { N, threads: T, pitch, lum, weft, gap, spec, shim, look: L, base: baseId };
  if (WEAVE_CACHE.size > 16) WEAVE_CACHE.delete(WEAVE_CACHE.keys().next().value);
  WEAVE_CACHE.set(key, out);
  return out;
}

// Flannel: the weave is brushed into a soft nap of loose fibers that catch the light.
function brushNap(lum, N, seed, amt) {
  const rng = mulberry32(seed * 101 + 3);
  const soft = new Float32Array(N * N);
  // soften the weave
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = y * N + x;
    const l = lum[(y * N + ((x + 1) % N))], r = lum[y * N + ((x + N - 1) % N)];
    const u = lum[((y + 1) % N) * N + x], d = lum[((y + N - 1) % N) * N + x];
    soft[p] = (lum[p] * 2 + l + r + u + d) / 6;
  }
  for (let p = 0; p < N * N; p++) lum[p] = 1 + (soft[p] - 1) * 0.55;
  // loose fibers: short curved strokes, lighter
  const count = Math.round(N * N * 0.02 * amt);
  for (let k = 0; k < count; k++) {
    let x = rng() * N, y = rng() * N;
    let a = rng() * 6.2832;
    const len = 2 + rng() * 5, bright = (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.035);
    for (let t = 0; t < len; t++) {
      const xi = ((x | 0) % N + N) % N, yi = ((y | 0) % N + N) % N;
      lum[yi * N + xi] += bright * (1 - t / len * 0.5);
      a += (rng() - 0.5) * 0.6; x += Math.cos(a); y += Math.sin(a);
    }
  }
  // a last soft pass: the nap blurs everything a little
  const tmp = Float32Array.from(lum);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = y * N + x;
    lum[p] = (tmp[p] * 4 + tmp[y * N + ((x + 1) % N)] + tmp[y * N + ((x + N - 1) % N)] + tmp[((y + 1) % N) * N + x] + tmp[((y + N - 1) % N) * N + x]) / 8;
  }
  const mott = noiseField(N, Math.max(2, Math.round(N / 24)), seed + 21, 2);
  for (let p = 0; p < N * N; p++) lum[p] *= 1 + 0.07 * (mott[p] - 0.5);
}

/**
 * shadeCloth(out, N, wf, opts): writes RGBA into out (Uint8ClampedArray N*N*4).
 *   opts.A: Float32Array(3·N·N) dye absorbance per pixel, on the bare cloth (opts.paper, default
 *           the cloth's undyed color), or
 *   opts.uniform: [3] one absorbance everywhere (the whole color, no paper: used by drawBase).
 *   opts.rect: [x0, y0, x1, y1] to update only part.
 * Chambray's weft takes only a little of the dye; shot cotton's weft turns it round the hue wheel.
 */
export function shadeCloth(out, N, wf, opts = {}) {
  const L = wf.look;
  const A = opts.A || null;
  const U = opts.uniform || [0, 0, 0];
  const P = A ? (opts.paper || absorbOf(L.paper)) : [0, 0, 0];
  const [x0, y0, x1, y1] = opts.rect || [0, 0, N, N];
  const { lum, weft, gap, spec, shim } = wf;
  const wu = L.weftUptake ?? 1, shot = L.shot || 0, muted = L.muted || 0, gl = L.gapLight || 0;
  const two = wu !== 1 || shot;
  const R0 = REF[0], G0 = REF[1], B0 = REF[2];
  const keep = 1 - shot;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * N + x;
      let dr = U[0], dg = U[1], db = U[2];
      if (A) { dr = A[p * 3]; dg = A[p * 3 + 1]; db = A[p * 3 + 2]; }
      let r = R0 * Math.exp(-(P[0] + dr)), g = G0 * Math.exp(-(P[1] + dg)), b = B0 * Math.exp(-(P[2] + db));
      if (two) {
        let fr, fg, fb;
        if (shot) { fr = dr * keep + db * shot; fg = dg * keep + dr * shot; fb = db * keep + dg * shot; } else { fr = dr * wu; fg = dg * wu; fb = db * wu; }
        let t = weft[p];
        if (shim) t = Math.min(1, Math.max(0, t * (0.65 + 0.7 * shim[p])));
        r += (R0 * Math.exp(-(P[0] + fr)) - r) * t; g += (G0 * Math.exp(-(P[1] + fg)) - g) * t; b += (B0 * Math.exp(-(P[2] + fb)) - b) * t;
      }
      const l = lum[p];
      r *= l; g *= l; b *= l;
      if (muted) { const m = (r + g + b) / 3, k = 8 * muted; r += (m - r) * muted + k; g += (m - g) * muted + k; b += (m - b) * muted + k; }
      if (gl) { const t = gap[p] * gl; r += (255 - r) * t; g += (253 - g) * t; b += (248 - b) * t; }
      if (spec) { const s = spec[p] * 255; r += s; g += s; b += s; }
      const o = p * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// A weave looks the same from tile to tile, so tiles share a couple of cached weave variants
// per cloth: after the first tile of a cloth, a new tile only pays for the shading.
function weaveSeed(rng) { return 1 + (Math.floor(rng() * 9973) % 2); }

// ------------------------------------------------------------------ canvas helpers (browser)
function makeCanvas(px) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(px, px);
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  return cv;
}

/** Plain cloth of a base type in one color, drawn as a tile that repeats.
 *  opts.threads: draw a close-up with that many threads across (e.g. 24 for a swatch). */
export function drawBase(ctx, size, baseId, hex, rng = mulberry32(1), opts = {}) {
  size = Math.max(1, Math.round(size));
  const seed = weaveSeed(rng);
  const wf = weaveField(baseId, size, seed, opts.threads || 0);
  const cv = makeCanvas(size);
  const c2 = cv.getContext('2d');
  const img = c2.createImageData(size, size);
  shadeCloth(img.data, size, wf, { uniform: absorbOf(hex) });
  c2.putImageData(img, 0, 0);
  ctx.drawImage(cv, 0, 0);
  return wf;
}

/** A simple repeating print on top of the cloth. colors[0] is the ground, the rest are motif colors. */
export function drawPrint(ctx, size, printId, colors, rng = mulberry32(2)) {
  const m = colors.slice(1).length ? colors.slice(1) : ['#EFE6D2'];
  const pick = (i) => m[i % m.length];
  ctx.save();
  const wrap = (x, y, r, fn) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
      fn(x + dx, y + dy);
    }
  };
  if (printId === 'dots') {
    const step = size / 6;
    ctx.fillStyle = pick(0);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const x = (i + (j % 2) * 0.5) * step + step / 4, y = j * step + step / 2;
      wrap(x, y, step * 0.15, (X, Y) => { ctx.beginPath(); ctx.arc(X, Y, step * 0.14, 0, 6.2832); ctx.fill(); });
    }
  } else if (printId === 'stripes') {
    const step = size / 8;
    for (let i = 0; i < 8; i += 2) { ctx.fillStyle = pick(i / 2); ctx.globalAlpha = 0.9; ctx.fillRect(i * step, 0, step * 0.8, size); }
  } else if (printId === 'gingham') {
    const step = size / 8;
    ctx.fillStyle = pick(0);
    for (let i = 0; i < 8; i += 2) { ctx.globalAlpha = 0.45; ctx.fillRect(i * step, 0, step, size); ctx.fillRect(0, i * step, size, step); }
  } else if (printId === 'plaid') {
    const step = size / 8;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = pick(i % 3); ctx.globalAlpha = i % 4 === 0 ? 0.5 : 0.18;
      ctx.fillRect(i * step, 0, i % 4 === 0 ? step * 0.6 : step * 0.15, size);
      ctx.fillRect(0, i * step, size, i % 4 === 0 ? step * 0.6 : step * 0.15);
    }
  } else if (printId === 'calico' || printId === 'floral') {
    const n = printId === 'calico' ? 70 : 26;
    for (let k = 0; k < n; k++) {
      const x = rng() * size, y = rng() * size, r = (printId === 'calico' ? 3 : 7) * size / 384 + rng() * 4 * size / 384;
      const rot = rng() * 6.2832;
      wrap(x, y, r * 2, (X, Y) => {
        ctx.fillStyle = pick(k);
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * 6.2832 + rot;
          ctx.beginPath(); ctx.ellipse(X + Math.cos(a) * r * 0.7, Y + Math.sin(a) * r * 0.7, r * 0.5, r * 0.32, a, 0, 6.2832); ctx.fill();
        }
        if (printId === 'floral') {
          ctx.fillStyle = pick(k + 1); ctx.beginPath(); ctx.arc(X, Y, r * 0.28, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = pick(k + 2); ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath();
          ctx.moveTo(X + Math.cos(rot + 0.6) * r, Y + Math.sin(rot + 0.6) * r);
          ctx.quadraticCurveTo(X + Math.cos(rot + 0.9) * r * 2, Y + Math.sin(rot + 0.3) * r * 2, X + Math.cos(rot + 1.2) * r * 2.4, Y + Math.sin(rot + 1.2) * r * 2.4);
          ctx.stroke();
        }
      });
    }
  }
  ctx.restore();
}

export function fabricTile(spec, px = 384) {
  const cv = makeCanvas(px);
  const ctx = cv.getContext('2d');
  const rng = mulberry32(spec.seed || 7);
  const base = spec.base || 'quilting-cotton';
  const seed = weaveSeed(rng);
  const wf = weaveField(base, px, seed);
  const img = ctx.createImageData(px, px);
  shadeCloth(img.data, px, wf, { uniform: absorbOf(spec.color) });
  if (spec.print) {
    // The print is inked into the threads: draw it flat, then shade it with the weave.
    const pc = makeCanvas(px);
    const pctx = pc.getContext('2d');
    drawPrint(pctx, px, spec.print, [spec.color, ...(spec.colors || [])], rng);
    const pd = pctx.getImageData(0, 0, px, px).data;
    const d = img.data, lum = wf.lum;
    for (let p = 0, o = 0; p < px * px; p++, o += 4) {
      const a = pd[o + 3] / 255 * 0.94;
      if (a <= 0) continue;
      const l = lum[p];
      d[o] += (pd[o] * l - d[o]) * a; d[o + 1] += (pd[o + 1] * l - d[o + 1]) * a; d[o + 2] += (pd[o + 2] * l - d[o + 2]) * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function tileDataURL(canvas, q = 0.86) {
  if (canvas.toDataURL) return canvas.toDataURL('image/jpeg', q);
  // OffscreenCanvas fallback: copy to a DOM canvas
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c.toDataURL('image/jpeg', q);
}

/** The starter stash: a few solids and prints so the quilt designer has fabric on day one. */
export function starterFabrics() {
  const d = Object.fromEntries(DYES.map((x) => [x.id, x.hex]));
  const specs = [
    ['Undyed cotton', 'quilting-cotton', d.cream],
    ['Indigo', 'quilting-cotton', d.indigo],
    ['Madder', 'quilting-cotton', d.madder],
    ['Weld', 'quilting-cotton', d.weld],
    ['Sage linen', 'linen', d.sage],
    ['Walnut flannel', 'flannel', d.walnut],
    ['Woad chambray', 'chambray', d.woad],
    ['Cochineal shot cotton', 'shot-cotton', d.cochineal],
    ['Cream dots on indigo', 'quilting-cotton', d.indigo, 'dots', [d.cream]],
    ['Madder calico', 'quilting-cotton', d.madder, 'calico', [d.weld, d.cream]],
    ['Sage gingham', 'quilting-cotton', d.cream, 'gingham', [d.sage]],
    ['Ochre floral', 'quilting-cotton', d.ochre, 'floral', [d.madder, d.cream]],
  ];
  return specs.map(([name, base, color, print, colors], i) => {
    const tile = fabricTile({ base, color, print, colors, seed: 100 + i });
    return {
      id: `starter-${i}`, name, base, kind: print ? 'print' : 'solid', color, colors: [color, ...(colors || [])],
      img: tileDataURL(tile), inches: print ? 6 : 8, repeat: true, starter: true, createdAt: 0,
    };
  });
}
