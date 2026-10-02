/**
 * color.js: Tincture's color-math foundation.
 *
 * What: pure functions for hex/sRGB/linear-RGB/OKLab/OKLCH conversion, gamut
 * clamping, perceptual distance (ΔE), the paint and light mixing models,
 * gradient generation for Grading boards, hue-family classification, text
 * contrast, and the lightness-to-pentatonic-note mapping used by Sound.
 *
 * Why: every system in the game (Matching scores, Grading fairness, catalog
 * discovery, sound) agrees on one perceptual space, OKLab, so a "Steady" blue
 * board feels as hard as a "Steady" yellow one and ΔE thresholds in
 * docs/DESIGN.md mean the same thing everywhere.
 *
 * Conventions:
 *  - sRGB {r,g,b} channels are integers 0..255; linear channels are 0..1.
 *  - OKLab {L,a,b}: L is 0..1. OKLCH {L,C,h}: h in degrees [0, 360).
 *  - ΔE is Euclidean OKLab distance x 100 (so "ΔE under 2" = 0.02 raw).
 *  - No DOM, no globals, no dependencies: runs in browsers and `node --test`.
 *
 * OKLab matrices are Björn Ottosson's (same as docs/prototypes/*.dc.html).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Near-white and near-black "drops" for paint mixing (not pure 255/0, so the
 *  geometric mean stays well behaved while black still darkens strongly). */
export const WHITE = '#f4f1e8';
export const BLACK = '#1b1917';

/** Semitone offsets of a two-octave-plus major pentatonic ladder. */
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

/** Hue families in display order; 'neutral' is for low-chroma colors. */
export const HUE_FAMILIES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'];

const INK = '#2a2622';
const PAPER = '#f7f4ec';
const GAMUT_EPS = 1e-4;
const PAINT_FLOOR = 1e-4;
const NOTE_L_MIN = 0.15;
const NOTE_L_MAX = 0.95;
const NEUTRAL_CHROMA = 0.03;
const ADDITIVE_LIFT = 0.08;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Hex / sRGB
// ---------------------------------------------------------------------------

/** '#rgb' or '#rrggbb' (leading '#' optional, any case) -> {r,g,b} 0..255. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') throw new TypeError('hexToRgb: expected a string, got ' + typeof hex);
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new TypeError('hexToRgb: invalid hex color ' + JSON.stringify(hex));
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** {r,g,b} -> '#rrggbb' lowercase; channels are rounded and clamped. */
export function rgbToHex({ r, g, b }) {
  const part = (v) => clamp(Math.round(Number.isFinite(v) ? v : 0), 0, 255).toString(16).padStart(2, '0');
  return '#' + part(r) + part(g) + part(b);
}

/** sRGB transfer function: encoded 0..1 -> linear 0..1. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse transfer function: linear 0..1 -> encoded 0..1 (sign-preserving). */
export function linearToSrgb(c) {
  if (c < 0) return -linearToSrgb(-c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// Internal: {r,g,b} 0..255 <-> linear [r,g,b] 0..1.
function rgbToLinear({ r, g, b }) {
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}
function linearToRgb([r, g, b]) {
  const enc = (c) => clamp(Math.round(linearToSrgb(c) * 255), 0, 255);
  return { r: enc(r), g: enc(g), b: enc(b) };
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH
// ---------------------------------------------------------------------------

// Internal: linear sRGB -> OKLab.
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

// Internal: OKLab -> linear sRGB (unclamped; may be out of gamut).
function oklabToLinear({ L, a, b }) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** {r,g,b} 0..255 -> OKLab {L,a,b}. */
export function rgbToOklab(rgb) {
  return linearToOklab(rgbToLinear(rgb));
}

/** OKLab -> {r,g,b} 0..255, clamped per channel (no hue-preserving mapping;
 *  use clampToGamut first if that matters). */
export function oklabToRgb(lab) {
  return linearToRgb(oklabToLinear(lab));
}

/** OKLab -> OKLCH {L,C,h}, h in degrees [0,360). */
export function oklabToOklch({ L, a, b }) {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  return { L, C, h };
}

/** OKLCH -> OKLab. */
export function oklchToOklab({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

/** Hex -> OKLCH. */
export function hexToOklch(hex) {
  return oklabToOklch(rgbToOklab(hexToRgb(hex)));
}

/** OKLCH -> hex (per-channel clamp; see clampToGamut for hue-safe clamping). */
export function oklchToHex(lch) {
  return rgbToHex(oklabToRgb(oklchToOklab(lch)));
}

// ---------------------------------------------------------------------------
// Gamut
// ---------------------------------------------------------------------------

/** True if every linear sRGB channel is within [0,1] (1e-4 tolerance). */
export function inGamut(lch) {
  const lin = oklabToLinear(oklchToOklab(lch));
  return lin.every((c) => c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS);
}

/** Keep L (clamped to 0..1) and h; binary-search chroma downward until the
 *  color fits sRGB (max 24 iterations). Returns an in-gamut {L,C,h}. */
export function clampToGamut({ L, C, h }) {
  const Lc = clamp(L, 0, 1);
  const out = { L: Lc, C: Math.max(0, C), h };
  if (inGamut(out)) return out;
  let lo = 0;
  let hi = out.C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ L: Lc, C: mid, h })) lo = mid;
    else hi = mid;
  }
  return { L: Lc, C: lo, h };
}

// Internal: OKLab -> gamut-clamped hex via OKLCH chroma reduction.
function labToSafeHex(lab) {
  return oklchToHex(clampToGamut(oklabToOklch(lab)));
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Euclidean OKLab distance x 100 (design-doc ΔE units). */
export function deltaE(labA, labB) {
  const dL = labA.L - labB.L;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dL * dL + da * da + db * db) * 100;
}

/** ΔE between two hex colors. */
export function deltaEHex(hexA, hexB) {
  return deltaE(rgbToOklab(hexToRgb(hexA)), rgbToOklab(hexToRgb(hexB)));
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

// Internal: validate parts and return [{lin, share}] with shares summing to 1.
function normalizeParts(parts, fn) {
  if (!Array.isArray(parts)) throw new TypeError(fn + ': parts must be an array of {hex, weight}');
  const used = parts.filter((p) => p && Number.isFinite(p.weight) && p.weight > 0);
  const total = used.reduce((s, p) => s + p.weight, 0);
  if (!used.length || !(total > 0)) throw new RangeError(fn + ': need at least one part with weight > 0');
  return used.map((p) => ({ hex: p.hex, lin: rgbToLinear(hexToRgb(p.hex)), share: p.weight / total }));
}

/** Paint (subtractive-ish) mix: weighted geometric mean of each pigment's
 *  linear RGB channels, each floored at 1e-4 before the log. Blue + yellow
 *  makes green; black darkens strongly. Returns sRGB {r,g,b} 0..255.
 *  Parts with weight <= 0 are ignored; throws RangeError if none remain. */
export function mixPaint(parts) {
  const ps = normalizeParts(parts, 'mixPaint');
  const logs = [0, 0, 0];
  for (const { lin, share } of ps) {
    for (let k = 0; k < 3; k++) logs[k] += share * Math.log(Math.max(lin[k], PAINT_FLOOR));
  }
  return linearToRgb(logs.map(Math.exp));
}

/** mixPaint as '#rrggbb'. */
export function mixPaintHex(parts) {
  return rgbToHex(mixPaint(parts));
}

/** Light (additive, Era 3) mix: weighted arithmetic mean in linear RGB, then
 *  OKLab lightness is lifted by +0.08 per additional DISTINCT pigment beyond
 *  the first (so mixing light tends toward white), then gamut-clamped in
 *  OKLCH. Mixing a color with itself returns that color. */
export function mixAdditive(parts) {
  const ps = normalizeParts(parts, 'mixAdditive');
  const mean = [0, 0, 0];
  for (const { lin, share } of ps) {
    for (let k = 0; k < 3; k++) mean[k] += share * lin[k];
  }
  const distinct = new Set(ps.map((p) => rgbToHex(hexToRgb(p.hex)))).size;
  const lch = oklabToOklch(linearToOklab(mean));
  lch.L = clamp(lch.L + ADDITIVE_LIFT * (distinct - 1), 0, 1);
  return hexToRgb(oklchToHex(clampToGamut(lch)));
}

// ---------------------------------------------------------------------------
// Sound: lightness -> pentatonic note
// ---------------------------------------------------------------------------

// Internal: semitone offset of pentatonic step k (extends PENTATONIC by octaves).
function pentatonicSemitone(k) {
  if (k < PENTATONIC.length) return PENTATONIC[k];
  return PENTATONIC[k % 5] + 12 * Math.floor(k / 5);
}

/** Map OKLab L (clamped to [0.15, 0.95]) onto a ladder index 0..steps-1. */
export function noteIndexForLightness(L, steps = 12) {
  const n = Math.max(1, Math.floor(steps));
  const t = (clamp(Number.isFinite(L) ? L : 0, NOTE_L_MIN, NOTE_L_MAX) - NOTE_L_MIN) / (NOTE_L_MAX - NOTE_L_MIN);
  return clamp(Math.round(t * (n - 1)), 0, n - 1);
}

/** Frequency in Hz of the pentatonic note for lightness L (darker = lower). */
export function noteHz(L, steps = 12, baseHz = 196) {
  return baseHz * Math.pow(2, pentatonicSemitone(noteIndexForLightness(L, steps)) / 12);
}

// ---------------------------------------------------------------------------
// Gradients (Grading boards)
// ---------------------------------------------------------------------------

/** Bilinear OKLab interpolation over a cols x rows grid, row-major, each cell
 *  gamut-clamped via OKLCH chroma reduction. Accepts {tl,tr,bl,br} hex
 *  corners, or a two-hex array [left, right] (a horizontal gradient). */
export function gradientOklab(cornersOrEnds, cols, rows) {
  let c = cornersOrEnds;
  if (Array.isArray(c)) c = { tl: c[0], bl: c[0], tr: c[1], br: c[1] };
  const [tl, tr, bl, br] = [c.tl, c.tr, c.bl, c.br].map((h) => rgbToOklab(hexToRgb(h)));
  const nc = Math.max(1, Math.floor(cols));
  const nr = Math.max(1, Math.floor(rows));
  const out = [];
  for (let y = 0; y < nr; y++) {
    const v = nr === 1 ? 0 : y / (nr - 1);
    for (let x = 0; x < nc; x++) {
      const u = nc === 1 ? 0 : x / (nc - 1);
      const mix = (k) => (tl[k] * (1 - u) + tr[k] * u) * (1 - v) + (bl[k] * (1 - u) + br[k] * u) * v;
      out.push(labToSafeHex({ L: mix('L'), a: mix('a'), b: mix('b') }));
    }
  }
  return out;
}

/** n evenly spaced OKLab steps from hexA to hexB inclusive, gamut-clamped. */
export function gradient1D(hexA, hexB, n) {
  return gradientOklab([hexA, hexB], n, 1);
}

// ---------------------------------------------------------------------------
// Classification and contrast
// ---------------------------------------------------------------------------

// OKLCH hue bands (degrees, upper bound exclusive). Anchors for reference:
// sRGB red ~29, orange ~55-70, yellow ~110, green ~142, cyan ~195,
// blue ~264, violet ~295, purple/magenta ~328 (counted as violet).
const HUE_BANDS = [
  [15, 'pink'], // 345..15 wraps: rose / crimson-pink
  [45, 'red'],
  [75, 'orange'],
  [118, 'yellow'],
  [170, 'green'],
  [225, 'teal'],
  [280, 'blue'],
  [330, 'violet'],
  [345, 'pink'],
  [360, 'pink'],
];

/** Classify a hex color into one of HUE_FAMILIES by OKLCH hue;
 *  chroma < 0.03 is 'neutral'. */
export function hueFamily(hex) {
  const { C, h } = hexToOklch(hex);
  if (C < NEUTRAL_CHROMA) return 'neutral';
  for (const [upper, name] of HUE_BANDS) if (h < upper) return name;
  return 'pink';
}

/** WCAG relative luminance (0..1) of a hex color. */
export function relativeLuminance(hex) {
  const [r, g, b] = rgbToLinear(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink ('#2a2622') on light backgrounds (OKLab L > 0.62), paper ('#f7f4ec')
 *  otherwise. */
export function textColorOn(hex) {
  return rgbToOklab(hexToRgb(hex)).L > 0.62 ? INK : PAPER;
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/** A color near `hex`: offset in OKLab by a random vector of length
 *  <= maxDeltaE/100 (uniform in the ball), then gamut-clamped. Tries a few
 *  samples to find one already in gamut so clamping rarely pushes the result
 *  past maxDeltaE. `rng` returns [0,1). */
export function randomHexNear(hex, maxDeltaE, rng = Math.random) {
  const base = rgbToOklab(hexToRgb(hex));
  const radius = Math.max(0, maxDeltaE) / 100;
  let lab = base;
  for (let attempt = 0; attempt < 8; attempt++) {
    // Rejection-sample a point in the unit ball.
    let x, y, z, d2;
    let tries = 0;
    do {
      x = rng() * 2 - 1;
      y = rng() * 2 - 1;
      z = rng() * 2 - 1;
      d2 = x * x + y * y + z * z;
    } while (d2 > 1 && ++tries < 32);
    if (d2 > 1) {
      const d = Math.sqrt(d2);
      x /= d; y /= d; z /= d;
    }
    lab = { L: base.L + x * radius, a: base.a + y * radius, b: base.b + z * radius };
    if (inGamut(oklabToOklch(lab))) break;
  }
  return labToSafeHex(lab);
}
