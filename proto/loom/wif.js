/*
 * wif.js: read and write WIF 1.1 (Weaving Information File). PURE module.
 *
 * WIF is INI-style: [SECTION] headers, key=value lines, ';' comments. Section
 * and key names are case-insensitive. Indices are 1-based (ends, picks, shafts,
 * treadles, colors). Conventions used here, following WIF 1.1:
 *   [WEAVING]   Shafts, Treadles, Rising Shed (true = tied/marked shafts rise)
 *   [WARP]/[WEFT]  Threads, Color (default palette index)
 *   [THREADING] end = shaft            (a comma list means several shafts)
 *   [TIEUP]     treadle = shafts       (comma list)
 *   [TREADLING] pick = treadle(s)      (comma list)
 *   [LIFTPLAN]  pick = shafts          (comma list)
 *   [COLOR PALETTE] Entries, Form (RGB), Range=min,max
 *   [COLOR TABLE]   index = r,g,b      (within Range)
 *   [WARP COLORS]/[WEFT COLORS]  thread = palette index
 * Unsupported sections and keys (notes, spacing, units, ...) are ignored.
 * A thread on several shafts, or a pick on several treadles, is simplified:
 * see parseWif.
 */
import { createDraft, normalizeDraft, MAX_SHAFTS } from './draft.js';

const DEFAULT_WARP = '#EFE6D2';
const DEFAULT_WEFT = '#3E6A9E';

/* ----------------------------------------------------------------- writer */

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Serialize a draft as a WIF 1.1 string. opts: { title, date } (date is text, kept pure). */
export function writeWif(draft, { title = '', date = '' } = {}) {
  const E = draft.threading.length;
  const P = draft.treadling.length;
  const lift = draft.mode === 'liftplan';

  // color table: unique hexes in order of first use, 1-based
  const palette = [];
  const index = new Map();
  const idx = (hex) => {
    const k = hex.toLowerCase();
    if (!index.has(k)) { palette.push(k); index.set(k, palette.length); }
    return index.get(k);
  };
  const warpIdx = draft.warpColors.map(idx);
  const weftIdx = draft.weftColors.map(idx);

  const out = [];
  const sec = (name) => { out.push(`[${name}]`); };
  const kv = (k, v) => { out.push(`${k}=${v}`); };

  sec('WIF');
  kv('Version', '1.1');
  kv('Date', date || 'unknown');
  kv('Developers', 'wif@mhsoft.com');
  kv('Source Program', 'Tincture floor loom prototype');
  kv('Source Version', '1');
  out.push('');
  sec('CONTENTS');
  kv('COLOR PALETTE', 'true');
  kv('TEXT', 'true');
  kv('WEAVING', 'true');
  kv('WARP', 'true');
  kv('WEFT', 'true');
  kv('COLOR TABLE', 'true');
  kv('THREADING', 'true');
  kv('TIEUP', lift ? 'false' : 'true');
  kv('TREADLING', lift ? 'false' : 'true');
  kv('LIFTPLAN', lift ? 'true' : 'false');
  kv('WARP COLORS', 'true');
  kv('WEFT COLORS', 'true');
  out.push('');
  sec('TEXT');
  kv('Title', title);
  out.push('');
  sec('WEAVING');
  kv('Shafts', draft.shafts);
  kv('Treadles', draft.treadles);
  kv('Rising Shed', draft.shed === 'sinking' ? 'false' : 'true');
  out.push('');
  sec('WARP');
  kv('Threads', E);
  kv('Color', warpIdx[0] || 1);
  out.push('');
  sec('WEFT');
  kv('Threads', P);
  kv('Color', weftIdx[0] || 1);
  out.push('');
  sec('COLOR PALETTE');
  kv('Entries', palette.length);
  kv('Form', 'RGB');
  kv('Range', '0,255');
  out.push('');
  sec('COLOR TABLE');
  palette.forEach((h, i) => kv(i + 1, hex2rgb(h).join(',')));
  out.push('');
  sec('THREADING');
  draft.threading.forEach((s, e) => { if (s != null) kv(e + 1, s + 1); });
  out.push('');
  if (lift) {
    sec('LIFTPLAN');
    draft.liftplan.forEach((l, p) => { if (l.length) kv(p + 1, l.map((s) => s + 1).join(',')); });
  } else {
    sec('TIEUP');
    for (let t = 0; t < draft.treadles; t++) {
      const shafts = [];
      for (let s = 0; s < draft.shafts; s++) if (draft.tieup[s][t]) shafts.push(s + 1);
      if (shafts.length) kv(t + 1, shafts.join(','));
    }
    out.push('');
    sec('TREADLING');
    draft.treadling.forEach((t, p) => { if (t != null) kv(p + 1, t + 1); });
  }
  out.push('');
  sec('WARP COLORS');
  warpIdx.forEach((c, e) => kv(e + 1, c));
  out.push('');
  sec('WEFT COLORS');
  weftIdx.forEach((c, p) => kv(p + 1, c));
  out.push('');
  return out.join('\n');
}

/* ----------------------------------------------------------------- parser */

/** Parse INI text into { SECTION: { key(lowercase): value } }, ignoring comments. */
export function parseIni(text) {
  const sections = {};
  let cur = null;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const m = /^\[(.+?)\]/.exec(line);
    if (m) {
      cur = m[1].trim().toUpperCase();
      sections[cur] = sections[cur] || {};
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    sections[cur][line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return sections;
}

const num = (v) => {
  if (v == null) return null;
  const n = parseInt(String(v).split(';')[0], 10);
  return Number.isFinite(n) ? n : null;
};
const bool = (v, dflt) => {
  if (v == null) return dflt;
  const t = String(v).split(';')[0].trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(t)) return true;
  if (['false', 'no', 'off', '0'].includes(t)) return false;
  return dflt;
};
const list = (v) => String(v).split(';')[0].split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const maxKey = (sec) => Math.max(0, ...Object.keys(sec || {}).map((k) => parseInt(k, 10)).filter(Number.isFinite));

/**
 * Parse a WIF string. Returns { draft, title, warnings }. Throws an Error with a
 * friendly message when the text has no weaving data at all.
 * Simplifications (each adds a warning): a thread on several shafts keeps its
 * first shaft; a pick on several treadles switches the draft to a lift plan
 * (the union of the tied shafts). Shaft counts above 16 are clamped.
 */
export function parseWif(text) {
  const ini = parseIni(text);
  const warnings = [];
  if (!ini.THREADING && !ini.TIEUP && !ini.LIFTPLAN && !ini.TREADLING) {
    throw new Error('No threading, tie-up or treadling found, so this does not look like a WIF draft.');
  }
  const weaving = ini.WEAVING || {};
  const warp = ini.WARP || {};
  const weft = ini.WEFT || {};

  let shafts = num(weaving.shafts) ?? 0;
  let treadles = num(weaving.treadles) ?? 0;
  const tieupSec = ini.TIEUP || {};
  const threadingSec = ini.THREADING || {};
  const treadlingSec = ini.TREADLING || {};
  const liftSec = ini.LIFTPLAN || {};

  const maxShaftSeen = Math.max(
    ...Object.values(threadingSec).flatMap(list), 0,
    ...Object.values(tieupSec).flatMap(list), 0,
    ...Object.values(liftSec).flatMap(list), 0,
  );
  shafts = Math.max(shafts, maxShaftSeen, 2);
  if (shafts > MAX_SHAFTS) { warnings.push(`This file uses ${shafts} shafts; only ${MAX_SHAFTS} are supported, the rest were left out.`); shafts = MAX_SHAFTS; }
  treadles = Math.max(treadles, maxKey(tieupSec), ...Object.values(treadlingSec).flatMap(list), 1);
  treadles = Math.min(treadles, MAX_SHAFTS + 4);

  const ends = Math.min(200, Math.max(num(warp.threads) ?? 0, maxKey(threadingSec), 1));
  const picks = Math.min(400, Math.max(num(weft.threads) ?? 0, maxKey(treadlingSec), maxKey(liftSec), 1));

  const d = createDraft({ shafts, treadles, ends, picks });

  // threading
  let multi = false;
  for (const [k, v] of Object.entries(threadingSec)) {
    const e = parseInt(k, 10) - 1;
    const l = list(v);
    if (e < 0 || e >= ends || !l.length) continue;
    if (l.length > 1) multi = true;
    if (l[0] - 1 < shafts) d.threading[e] = l[0] - 1;
  }
  if (multi) warnings.push('Some threads were on several shafts; the first shaft was kept.');

  // tie-up
  for (const [k, v] of Object.entries(tieupSec)) {
    const t = parseInt(k, 10) - 1;
    if (t < 0 || t >= treadles) continue;
    for (const s of list(v)) if (s - 1 < shafts) d.tieup[s - 1][t] = true;
  }

  // treadling / lift plan
  let needLift = false;
  const hasTreadling = Object.keys(treadlingSec).length > 0;
  const hasLift = Object.keys(liftSec).length > 0;
  for (const [k, v] of Object.entries(treadlingSec)) {
    const p = parseInt(k, 10) - 1;
    const l = list(v).map((t) => t - 1).filter((t) => t < treadles);
    if (p < 0 || p >= picks || !l.length) continue;
    d.treadling[p] = l[0];
    const set = new Set();
    for (const t of l) for (let s = 0; s < shafts; s++) if (d.tieup[s][t]) set.add(s);
    d.liftplan[p] = [...set].sort((a, b) => a - b);
    if (l.length > 1) needLift = true;
  }
  if (needLift) warnings.push('Some picks used several treadles at once, so the draft was opened as a lift plan.');
  if (hasLift) {
    for (const [k, v] of Object.entries(liftSec)) {
      const p = parseInt(k, 10) - 1;
      if (p < 0 || p >= picks) continue;
      d.liftplan[p] = [...new Set(list(v).map((s) => s - 1).filter((s) => s < shafts))].sort((a, b) => a - b);
    }
  }
  d.mode = needLift || (hasLift && !hasTreadling) ? 'liftplan' : 'treadle';
  d.shed = bool(weaving['rising shed'], true) ? 'rising' : 'sinking';

  // colors
  const pal = ini['COLOR PALETTE'] || {};
  const [lo, hi] = (pal.range || '0,255').split(';')[0].split(',').map((x) => parseInt(x, 10));
  const rlo = Number.isFinite(lo) ? lo : 0;
  const rhi = Number.isFinite(hi) && hi > rlo ? hi : 255;
  const form = (pal.form || 'RGB').toUpperCase();
  const table = {};
  if (form === 'RGB') {
    for (const [k, v] of Object.entries(ini['COLOR TABLE'] || {})) {
      const rgb = String(v).split(';')[0].split(',').map((x) => parseInt(x, 10));
      if (rgb.length === 3 && rgb.every(Number.isFinite)) {
        table[parseInt(k, 10)] = toHex(rgb.map((c) => ((c - rlo) / (rhi - rlo)) * 255));
      }
    }
  } else if (Object.keys(ini['COLOR TABLE'] || {}).length) {
    warnings.push('Only RGB color tables are supported; colors were left at the defaults.');
  }
  const color = (i, dflt) => table[i] || dflt;
  const warpDefault = color(num(warp.color), DEFAULT_WARP);
  const weftDefault = color(num(weft.color), DEFAULT_WEFT);
  d.warpColors = d.warpColors.map(() => warpDefault);
  d.weftColors = d.weftColors.map(() => weftDefault);
  for (const [k, v] of Object.entries(ini['WARP COLORS'] || {})) {
    const e = parseInt(k, 10) - 1;
    if (e >= 0 && e < ends) d.warpColors[e] = color(num(v), warpDefault);
  }
  for (const [k, v] of Object.entries(ini['WEFT COLORS'] || {})) {
    const p = parseInt(k, 10) - 1;
    if (p >= 0 && p < picks) d.weftColors[p] = color(num(v), weftDefault);
  }

  return { draft: normalizeDraft(d), title: (ini.TEXT && ini.TEXT.title) || '', warnings };
}
