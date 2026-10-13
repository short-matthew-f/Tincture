// Tartan setts for the floor-loom prototype. Pure: no window, document, Date or Math.random.
//
// A sett is written the usual way: colour letters and thread counts, e.g. "K4 R24 K24 Y4".
// A slash marks a PIVOT: "R/8 G24 K/4" is a symmetric sett that mirrors at R and at K, and a
// pivot stripe is woven ONCE at each turn (it is not doubled). With no slashes the sett can be
// mirrored at its first and last stripes, or repeated exactly as written (asymmetric).
// Tartan uses the same sequence for warp and weft, in 2/2 twill on a straight draw.

import { createDraft, straightDraw } from './draft.js';

/**
 * Colour letters. Single letters are the common thread-count codes; two-letter ones are the
 * light (L) and dark (D) shades and Az (azure). Hex values are a calm "modern colours" set.
 */
export const TARTAN_COLORS = {
  R: { name: 'Red', hex: '#B5242C' },
  G: { name: 'Green', hex: '#1F5C3A' },
  B: { name: 'Blue', hex: '#2B4C8C' },
  K: { name: 'Black', hex: '#1E1C1A' },
  W: { name: 'White', hex: '#F2EEE3' },
  Y: { name: 'Yellow', hex: '#E2B93B' },
  N: { name: 'Grey', hex: '#8A8780' },
  Az: { name: 'Azure', hex: '#5B9BD5' },
  P: { name: 'Purple', hex: '#5B3B6E' },
  O: { name: 'Orange', hex: '#D97A2B' },
  T: { name: 'Tan', hex: '#A88A5E' },
  DB: { name: 'Dark blue', hex: '#1C2A4D' },
  LB: { name: 'Light blue', hex: '#7FA7CF' },
  DG: { name: 'Dark green', hex: '#173F2A' },
  LG: { name: 'Light green', hex: '#6E9A5B' },
  DR: { name: 'Dark red', hex: '#7A1A22' },
  LR: { name: 'Light red', hex: '#D9605A' },
  DN: { name: 'Dark grey', hex: '#4A4844' },
  LN: { name: 'Light grey', hex: '#BDBAB2' },
  LY: { name: 'Light yellow', hex: '#EBD78A' },
  DY: { name: 'Dark yellow', hex: '#B08A1E' },
};
export const UNKNOWN_HEX = '#9A948A'; // a letter we do not know is shown as a soft grey

/** Canonical spelling of a colour code (case-insensitive: "az" -> "Az", "db" -> "DB"). */
export function colorCode(raw) {
  const s = String(raw || '');
  for (const k of Object.keys(TARTAN_COLORS)) if (k.toLowerCase() === s.toLowerCase()) return k;
  return s.toUpperCase();
}
export const isKnownCode = (code) => Object.prototype.hasOwnProperty.call(TARTAN_COLORS, code);

/**
 * A small library of well-known setts. Thread counts are from tartandictionary.org, which
 * collects the Scottish Register of Tartans, House of Tartan, Weddslist and Scottish Tartans
 * Authority records (Black Watch: the House of Tartan record). `total`, where present, is the
 * full-sett thread count that source states, and the tests check our expansion against it. Gordon and Campbell are left out on purpose: the published
 * counts disagree about which sett is the clan's, and we do not invent one.
 * The last two are generic cloths, not registered tartans, there for contrast.
 */
export const TARTANS = [
  { id: 'royal-stewart', name: 'Royal Stewart', sett: 'R/72 B8 K12 Y4 K4 W4 K4 G16 R8 K4 R4 W/4', total: 212, note: 'Known by the end of the 18th century; first published 1831.' },
  { id: 'black-watch', name: 'Black Watch (Government)', sett: 'DB/22 K2 DB2 K2 DB2 K16 G16 K2 G16 K16 DB16 K2 DB/2', note: 'The Highland Companies of 1725, then the 42nd. Dark blue, black and green.' },
  { id: 'dress-stewart', name: 'Dress Stewart', sett: 'W/78 DB6 K12 Y6 K6 W6 K6 G16 R10 K6 R6 W/6', total: 244, note: 'The Royal Stewart pattern on a white ground (c. 1750 record).' },
  { id: 'macleod-lewis', name: 'MacLeod of Lewis', sett: 'K/16 Y2 K16 Y24 R/2', total: 102, note: 'The loud MacLeod: black and bright yellow with a fine red line.' },
  { id: 'buchanan', name: 'Buchanan', sett: 'G/24 K4 DB16 K4 Y24 K4 Y24 K4 DB16 K4 R32 W4 R32 K4 DB16 K4 G24 DB/16', total: 472, note: 'Recorded 1843: green, yellow and red blocks.' },
  { id: 'wallace', name: 'Wallace', sett: 'K/4 R32 K32 Y/4', total: 136, note: 'Red and black with a yellow line (Scottish Tartans Authority, 1842).' },
  { id: 'rob-roy', name: 'Rob Roy', sett: 'K/8 R/8', total: 16, note: 'The simple red and black check (specimen of 1815-16).' },
  { id: 'gingham', name: 'Gingham (generic check)', sett: 'W/8 B/8', note: 'Not a tartan: an even two-colour check, for contrast.' },
  { id: 'tattersall', name: 'Tattersall (generic)', sett: 'W10 R2 W10 G2', asymmetric: true, note: 'Not a tartan: a light ground with alternating overchecks, repeated as written.' },
];
export const getTartan = (id) => TARTANS.find((t) => t.id === id) || null;

/**
 * Parse a thread count. Returns
 *   { stripes: [{code, n, known}], pivots: boolean, warnings: string[], unknown: string[] }
 * Accepted: "R8", "R/8" or "R8/" (pivot), any case, separated by spaces or commas.
 * Anything it cannot read is skipped with a gentle warning, never thrown.
 */
export function parseSett(text) {
  const out = { stripes: [], pivots: false, warnings: [], unknown: [] };
  const tokens = String(text || '').trim().split(/[\s,;]+/).filter(Boolean);
  const slashAt = [];
  for (const tok of tokens) {
    const m = /^([A-Za-z]{1,3})(\/?)(\d{1,4})(\/?)$/.exec(tok);
    if (!m) { out.warnings.push(`"${tok}" isn't a stripe (a colour letter and a number, like R8), so it was left out.`); continue; }
    const code = colorCode(m[1]);
    const n = Number(m[3]);
    if (!n) { out.warnings.push(`"${tok}" has no threads, so it was left out.`); continue; }
    const known = isKnownCode(code);
    if (!known && !out.unknown.includes(code)) out.unknown.push(code);
    if (m[2] || m[4]) slashAt.push(out.stripes.length);
    out.stripes.push({ code, n, known });
  }
  if (slashAt.length) {
    const last = out.stripes.length - 1;
    const ok = slashAt.every((i) => i === 0 || i === last);
    if (!ok) out.warnings.push('A slash marks a pivot, which can only be the first or last stripe; the others were ignored.');
    out.pivots = slashAt.includes(0) || slashAt.includes(last);
  }
  for (const u of out.unknown) out.warnings.push(`"${u}" isn't a colour letter we know; it is shown in grey until you dye it.`);
  return out;
}

/**
 * One full sett, thread by thread (an array of colour codes).
 * symmetric: mirror at the first and last stripes; each pivot is woven once, not doubled.
 */
export function expandSett(stripes, { symmetric = true } = {}) {
  const seq = [];
  const push = (s) => { for (let i = 0; i < s.n; i++) seq.push(s.code); };
  if (!stripes.length) return seq;
  if (!symmetric || stripes.length === 1) { stripes.forEach(push); return seq; }
  stripes.forEach(push);
  for (let i = stripes.length - 2; i >= 1; i--) push(stripes[i]);
  return seq;
}

/** Thread count of one full sett without building it. */
export function settThreads(stripes, opts = {}) {
  const symmetric = opts.symmetric ?? true;
  const sum = stripes.reduce((a, s) => a + s.n, 0);
  if (!symmetric || stripes.length < 2) return sum;
  return 2 * sum - stripes[0].n - stripes[stripes.length - 1].n;
}

/** Scale every stripe (full 1, half 0.5, quarter 0.25); a stripe never drops below 1 thread. */
export function scaleStripes(stripes, f) {
  return stripes.map((s) => ({ ...s, n: Math.max(1, Math.round(s.n * f)) }));
}

export const SCALES = [{ id: 'full', f: 1, label: 'Full sett' }, { id: 'half', f: 0.5, label: 'Half' }, { id: 'quarter', f: 0.25, label: 'Quarter' }];

/**
 * How many whole repeats fit: at least one, at most `maxEnds` threads in all, aiming for
 * about `target` threads so the check reads as a check. Returns 0 if one repeat is too wide.
 */
export function repeatsToFit(settLen, { maxEnds = 200, target = 120 } = {}) {
  if (!settLen || settLen > maxEnds) return 0;
  return Math.max(1, Math.min(Math.floor(maxEnds / settLen), Math.round(target / settLen) || 1));
}

/** The default scale: the largest one whose sett fits twice into `target` threads (else quarter). */
export function defaultScale(stripes, symmetric, { target = 120, maxEnds = 200 } = {}) {
  for (const s of SCALES) {
    const n = settThreads(scaleStripes(stripes, s.f), { symmetric });
    if (n * 2 <= target && n <= maxEnds) return s.id;
  }
  return 'quarter';
}

/**
 * Build a 2/2 twill draft woven to the sett: the same colour sequence in warp and weft,
 * straight draw on 4 shafts, the standard 2/2 tie-up and treadling 1-2-3-4.
 *   colors: { code: hex } overrides; anything missing uses TARTAN_COLORS, else UNKNOWN_HEX.
 */
export function tartanDraft(text, { symmetric, scale = 'full', repeats, colors = {}, maxEnds = 200 } = {}) {
  const parsed = parseSett(text);
  const sym = symmetric ?? parsed.pivots;
  const f = (SCALES.find((s) => s.id === scale) || SCALES[0]).f;
  const stripes = scaleStripes(parsed.stripes, f);
  const one = expandSett(stripes, { symmetric: sym });
  if (!one.length) return { ok: false, reason: 'empty', parsed, warnings: parsed.warnings.concat('There are no stripes to weave yet.') };
  if (one.length > maxEnds) return { ok: false, reason: 'too-wide', parsed, settLen: one.length, warnings: parsed.warnings.concat(`One repeat is ${one.length} threads, wider than the loom (${maxEnds}). Try a smaller scale.`) };
  const r = repeats || repeatsToFit(one.length, { maxEnds });
  const seq = [];
  for (let i = 0; i < r; i++) seq.push(...one);
  const hexOf = (code) => colors[code] || TARTAN_COLORS[code]?.hex || UNKNOWN_HEX;
  const n = seq.length;
  const d = createDraft({ shafts: 4, treadles: 4, ends: n, picks: n });
  d.mode = 'treadle';
  d.shed = 'rising';
  d.threading = straightDraw(n, 4);
  // 2/2 twill: treadle t lifts shafts t and t+1
  d.tieup = Array.from({ length: 4 }, (_, s) => Array.from({ length: 4 }, (_, t) => s === t || s === (t + 1) % 4));
  d.treadling = Array.from({ length: n }, (_, p) => p % 4);
  d.liftplan = d.treadling.map((t) => [t, (t + 1) % 4].sort((a, b) => a - b));
  // ends are numbered from the right, picks from the bottom: both run the same sequence
  d.warpColors = seq.map(hexOf);
  d.weftColors = seq.map(hexOf);
  const codes = [...new Set(seq)];
  return { ok: true, draft: d, parsed, symmetric: sym, settLen: one.length, repeats: r, ends: n, codes, warnings: parsed.warnings };
}
