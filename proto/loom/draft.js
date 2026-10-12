/*
 * draft.js: the handweaving drafting model for the floor-loom prototype.
 *
 * PURE module: no window, document, Date.now() or Math.random().
 * All functions are NON-MUTATING: they return a new draft and never touch the
 * one they were given (arrays inside a draft are fresh copies on every edit).
 *
 * CONVENTIONS (read these before trusting a drawdown)
 *  - Everything is 0-based internally. The UI shows 1-based shaft, treadle,
 *    end and pick numbers. Shaft 0 is "shaft 1", the one nearest the weaver.
 *  - threading[end] = shaft index (one shaft per end) or null (end not
 *    threaded; it is never lifted, so it shows weft on top).
 *  - Ends are numbered from the RIGHT, as handweavers read a draft. That is a
 *    display matter only: the UI draws end 0 at the right edge. Nothing here
 *    depends on it.
 *  - tieup[shaft][treadle] = true when that shaft is tied to that treadle.
 *  - treadling[pick] = one treadle index (or null for "not woven yet").
 *    Picks are numbered in weaving order: pick 0 is the first one thrown. The
 *    UI draws pick 0 at the BOTTOM so the cloth grows upward.
 *  - liftplan[pick] = array of shaft indices (the shafts the weaver marks on
 *    that pick, as on a dobby or computer loom). Used when mode === 'liftplan'.
 *
 *  SHED CONVENTION
 *   rising shed  (jack loom, rising shed): the tied/marked shafts are RAISED.
 *                A warp end on a raised shaft is on top: the face shows warp.
 *   sinking shed (countermarch, sinking shed): the tied/marked shafts are
 *                pulled DOWN, so the shafts that are raised are the ones NOT
 *                tied/marked. Same tie-up on a sinking loom therefore gives the
 *                exact inverse of the rising drawdown (warp <-> weft on the face).
 *                To get the same cloth on a sinking loom, tie the complement.
 *   In both cases the face of the cloth is the side seen from above, warp is
 *   on top where its shaft is raised, otherwise weft is on top.
 *   A "blank" pick (treadle mode with no treadle chosen) opens no shed: its row
 *   is all weft on both sheds, lifts nothing, and is skipped by floats().
 *
 *  BACK OF THE CLOTH = exact inverse of the face (warp<->weft), same threads.
 */

export const MAX_SHAFTS = 16;

/** Warm natural-dye palette. */
export const PALETTE = [
  { id: 'madder', name: 'Madder red', hex: '#B8433A' },
  { id: 'ochre', name: 'Ochre', hex: '#D9A63A' },
  { id: 'woad', name: 'Woad blue', hex: '#3E6A9E' },
  { id: 'weld', name: 'Weld yellow', hex: '#E3C65A' },
  { id: 'walnut', name: 'Walnut brown', hex: '#6B4A32' },
  { id: 'indigo', name: 'Indigo', hex: '#2C3E66' },
  { id: 'cochineal', name: 'Cochineal pink', hex: '#C2507A' },
  { id: 'logwood', name: 'Logwood purple', hex: '#5B3B6E' },
  { id: 'cream', name: 'Undyed cream', hex: '#EFE6D2' },
  { id: 'charcoal', name: 'Charcoal', hex: '#2E2B28' },
  { id: 'sage', name: 'Sage', hex: '#8A9A6B' },
  { id: 'rust', name: 'Rust', hex: '#A4562D' },
];

const CREAM = '#EFE6D2';
const WOAD = '#3E6A9E';
const INDIGO = '#2C3E66';
const CHARCOAL = '#2E2B28';
const MADDER = '#B8433A';
const OCHRE = '#D9A63A';
const WALNUT = '#6B4A32';
const SAGE = '#8A9A6B';
const LOGWOOD = '#5B3B6E';

/* ------------------------------------------------------------ small helpers */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
const sortedUnique = (a) => [...new Set(a)].sort((x, y) => x - y);

function emptyTieup(shafts, treadles) {
  return range(shafts).map(() => range(treadles).map(() => false));
}

function copy(d) {
  return {
    ...d,
    threading: d.threading.slice(),
    tieup: d.tieup.map((r) => r.slice()),
    treadling: d.treadling.slice(),
    liftplan: (d.liftplan || []).map((l) => sortedUnique([...l])),
    warpColors: d.warpColors.slice(),
    weftColors: d.weftColors.slice(),
  };
}

/** Straight draw: end i -> shaft i mod shafts. 1 2 3 4 1 2 3 4 ... */
export function straightDraw(ends, shafts) {
  return range(ends).map((i) => i % shafts);
}

/**
 * Point (pointed / "rosepath") draw, turning points NOT doubled:
 * 1 2 3 4 3 2 1 2 3 4 3 2 ... (period 2*shafts-2).
 */
export function pointDraw(ends, shafts) {
  if (shafts < 2) return range(ends).map(() => 0);
  const period = 2 * shafts - 2;
  return range(ends).map((i) => {
    const k = i % period;
    return k < shafts ? k : period - k;
  });
}

/** Repeat a sequence (cyclically) to exactly `length` entries. */
export function repeatTreadling(seq, length) {
  if (!seq.length) return range(length).map(() => null);
  return range(length).map((i) => seq[i % seq.length]);
}
export const repeatSeq = repeatTreadling;

/** mirror([1,2,3]) -> [1,2,3,2,1] (turn not doubled); doubleTurn -> [1,2,3,3,2,1]. */
export function mirror(seq, doubleTurn = false) {
  const tail = seq.slice().reverse();
  return seq.concat(doubleTurn ? tail : tail.slice(1));
}

/**
 * The repeat unit of a sequence the weaver has started filling in: if there are
 * trailing blanks (null), the unit is everything up to the last filled entry;
 * if it is full, the smallest period it already repeats with (or its whole
 * length if it does not repeat). Returns 0 for an empty sequence.
 */
export function repeatUnit(seq) {
  let last = -1;
  seq.forEach((v, i) => { if (v != null) last = i; });
  if (last < 0) return 0;
  if (last < seq.length - 1) return last + 1;
  for (let p = 1; p < seq.length; p++) {
    if (seq.every((v, i) => v === seq[i % p])) return p;
  }
  return seq.length;
}

/** Fill a sequence by repeating its first `unit` entries (default repeatUnit). */
export function repeatToFill(seq, unit = repeatUnit(seq)) {
  if (!unit) return seq.slice();
  return repeatTreadling(seq.slice(0, unit), seq.length);
}

/* ---------------------------------------------------------------- the draft */

export function createDraft({
  shafts = 4, treadles = 6, ends = 24, picks = 24,
  warpColor = CREAM, weftColor = WOAD,
} = {}) {
  return {
    shafts,
    treadles,
    threading: range(ends).map(() => null),
    tieup: emptyTieup(shafts, treadles),
    treadling: range(picks).map(() => null),
    liftplan: range(picks).map(() => []),
    mode: 'treadle',
    shed: 'rising',
    warpColors: range(ends).map(() => warpColor),
    weftColors: range(picks).map(() => weftColor),
  };
}

/** Repair a draft loaded from storage so every array has the right shape. */
export function normalizeDraft(raw) {
  const shafts = clamp(Math.round(raw?.shafts) || 4, 2, MAX_SHAFTS);
  const treadles = clamp(Math.round(raw?.treadles) || 6, 1, MAX_SHAFTS + 4);
  const ends = Array.isArray(raw?.threading) ? raw.threading.length : 24;
  const picks = Array.isArray(raw?.treadling) ? raw.treadling.length : 24;
  const hex = (c, f) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : f);
  const d = createDraft({ shafts, treadles, ends, picks });
  d.threading = range(ends).map((i) => {
    const s = raw?.threading?.[i];
    return Number.isInteger(s) && s >= 0 && s < shafts ? s : null;
  });
  d.tieup = range(shafts).map((s) => range(treadles).map((t) => !!raw?.tieup?.[s]?.[t]));
  d.treadling = range(picks).map((i) => {
    const t = raw?.treadling?.[i];
    return Number.isInteger(t) && t >= 0 && t < treadles ? t : null;
  });
  d.liftplan = range(picks).map((i) =>
    sortedUnique((raw?.liftplan?.[i] ? [...raw.liftplan[i]] : []).filter((s) => Number.isInteger(s) && s >= 0 && s < shafts)));
  d.mode = raw?.mode === 'liftplan' ? 'liftplan' : 'treadle';
  d.shed = raw?.shed === 'sinking' ? 'sinking' : 'rising';
  d.warpColors = range(ends).map((i) => hex(raw?.warpColors?.[i], CREAM));
  d.weftColors = range(picks).map((i) => hex(raw?.weftColors?.[i], WOAD));
  return d;
}

/* --------------------------------------------------------------- the math */

/** True when this pick has no shed at all (treadle mode, no treadle chosen). */
export function isBlankPick(draft, pick) {
  return draft.mode !== 'liftplan' && draft.treadling[pick] == null;
}

/** Shafts tied to the pick's treadle, or marked in the liftplan. Sorted. */
function markedShafts(draft, pick) {
  if (draft.mode === 'liftplan') return sortedUnique([...(draft.liftplan?.[pick] || [])]);
  const t = draft.treadling[pick];
  if (t == null) return [];
  const out = [];
  for (let s = 0; s < draft.shafts; s++) if (draft.tieup[s]?.[t]) out.push(s);
  return out;
}

/**
 * Shaft indices actually RAISED on this pick (see SHED CONVENTION above).
 * Rising shed: the tied/marked shafts. Sinking shed: every other shaft.
 */
export function liftedShafts(draft, pick) {
  if (isBlankPick(draft, pick)) return [];
  const marked = markedShafts(draft, pick);
  if (draft.shed !== 'sinking') return marked;
  const m = new Set(marked);
  return range(draft.shafts).filter((s) => !m.has(s));
}

/** The shafts the weaver sees marked (tied) on this pick, regardless of shed. */
export const markedOnPick = markedShafts;

/** Face of the cloth: [pick][end] = 'warp' | 'weft' (which thread is on top). */
export function drawdown(draft) {
  return range(draft.treadling.length).map((p) => {
    const up = new Set(liftedShafts(draft, p));
    return draft.threading.map((s) => (s != null && up.has(s) ? 'warp' : 'weft'));
  });
}

/** Back of the cloth: the exact inverse of the face. */
export function backOf(dd) {
  return dd.map((row) => row.map((c) => (c === 'warp' ? 'weft' : 'warp')));
}

function longestRun(cells) {
  let best = 0;
  let run = 0;
  for (const c of cells) {
    if (c) { run += 1; if (run > best) best = run; } else run = 0;
  }
  return best;
}

/**
 * Longest floats, in threads passed over/under (plain weave = 1).
 * warp = longest stretch of picks one warp end stays on top (face) or under (back);
 * weft = longest stretch of ends one pick stays on top or under.
 * Returned as the worst of either side of the cloth, with face/back detail.
 * Unthreaded ends and blank picks are skipped (they break a run).
 */
export function floats(draft) {
  const dd = drawdown(draft);
  const P = dd.length;
  const E = draft.threading.length;
  const valid = (p, e) => draft.threading[e] != null && !isBlankPick(draft, p);
  const res = { face: { warp: 0, weft: 0 }, back: { warp: 0, weft: 0 } };
  for (let e = 0; e < E; e++) {
    const col = range(P);
    res.face.warp = Math.max(res.face.warp, longestRun(col.map((p) => valid(p, e) && dd[p][e] === 'warp')));
    res.back.warp = Math.max(res.back.warp, longestRun(col.map((p) => valid(p, e) && dd[p][e] === 'weft')));
  }
  for (let p = 0; p < P; p++) {
    const row = range(E);
    res.face.weft = Math.max(res.face.weft, longestRun(row.map((e) => valid(p, e) && dd[p][e] === 'weft')));
    res.back.weft = Math.max(res.back.weft, longestRun(row.map((e) => valid(p, e) && dd[p][e] === 'warp')));
  }
  return {
    warp: Math.max(res.face.warp, res.back.warp),
    weft: Math.max(res.face.weft, res.back.weft),
    face: res.face,
    back: res.back,
  };
}

/** Convert tie-up x treadling into an explicit liftplan (marked shafts per pick). */
export function toLiftplan(draft) {
  const base = { ...draft, mode: 'treadle' };
  return range(draft.treadling.length).map((p) => markedShafts(base, p));
}

/* ------------------------------------------------------------------ edits */

export function setMode(draft, mode) {
  const d = copy(draft);
  if (mode === 'liftplan' && draft.mode !== 'liftplan') d.liftplan = toLiftplan(draft);
  d.mode = mode === 'liftplan' ? 'liftplan' : 'treadle';
  return d;
}

export function setShed(draft, shed) {
  const d = copy(draft);
  d.shed = shed === 'sinking' ? 'sinking' : 'rising';
  return d;
}

export function toggleThreading(draft, end, shaft) {
  const d = copy(draft);
  if (end < 0 || end >= d.threading.length || shaft < 0 || shaft >= d.shafts) return d;
  d.threading[end] = d.threading[end] === shaft ? null : shaft;
  return d;
}

export function toggleTieup(draft, shaft, treadle) {
  const d = copy(draft);
  if (!d.tieup[shaft] || treadle < 0 || treadle >= d.treadles) return d;
  d.tieup[shaft][treadle] = !d.tieup[shaft][treadle];
  return d;
}

export function toggleTreadling(draft, pick, treadle) {
  const d = copy(draft);
  if (pick < 0 || pick >= d.treadling.length || treadle < 0 || treadle >= d.treadles) return d;
  d.treadling[pick] = d.treadling[pick] === treadle ? null : treadle;
  return d;
}

export function toggleLift(draft, pick, shaft) {
  const d = copy(draft);
  if (pick < 0 || pick >= d.liftplan.length || shaft < 0 || shaft >= d.shafts) return d;
  const set = new Set(d.liftplan[pick]);
  if (set.has(shaft)) set.delete(shaft); else set.add(shaft);
  d.liftplan[pick] = sortedUnique([...set]);
  return d;
}

export function setWarpColor(draft, end, hex) {
  const d = copy(draft);
  if (end >= 0 && end < d.warpColors.length) d.warpColors[end] = hex;
  return d;
}

export function setWeftColor(draft, pick, hex) {
  const d = copy(draft);
  if (pick >= 0 && pick < d.weftColors.length) d.weftColors[pick] = hex;
  return d;
}

export function setEnds(draft, n) {
  const d = copy(draft);
  n = clamp(Math.round(n), 1, 200);
  const lastColor = d.warpColors[d.warpColors.length - 1] || CREAM;
  d.threading = range(n).map((i) => (i < d.threading.length ? d.threading[i] : null));
  d.warpColors = range(n).map((i) => (i < d.warpColors.length ? d.warpColors[i] : lastColor));
  return d;
}

export function setPicks(draft, n) {
  const d = copy(draft);
  n = clamp(Math.round(n), 1, 400);
  const lastColor = d.weftColors[d.weftColors.length - 1] || WOAD;
  d.treadling = range(n).map((i) => (i < d.treadling.length ? d.treadling[i] : null));
  d.liftplan = range(n).map((i) => (i < d.liftplan.length ? d.liftplan[i] : []));
  d.weftColors = range(n).map((i) => (i < d.weftColors.length ? d.weftColors[i] : lastColor));
  return d;
}

/** Change the shaft count. Ends threaded on removed shafts become unthreaded. */
export function setShafts(draft, n) {
  const d = copy(draft);
  n = clamp(Math.round(n), 2, MAX_SHAFTS);
  d.tieup = range(n).map((s) => (s < d.shafts ? d.tieup[s] : range(d.treadles).map(() => false)));
  d.threading = d.threading.map((s) => (s != null && s < n ? s : null));
  d.liftplan = d.liftplan.map((l) => l.filter((s) => s < n));
  d.shafts = n;
  return d;
}

/** Change the treadle count. Picks on removed treadles become blank. */
export function setTreadles(draft, n) {
  const d = copy(draft);
  n = clamp(Math.round(n), 1, MAX_SHAFTS + 4);
  d.tieup = d.tieup.map((row) => range(n).map((t) => (t < row.length ? row[t] : false)));
  d.treadling = d.treadling.map((t) => (t != null && t < n ? t : null));
  d.treadles = n;
  return d;
}

/** Repeat the filled-in part of the threading (and warp colors) to fill all ends. */
export function repeatThreadingToFill(draft) {
  const d = copy(draft);
  const unit = repeatUnit(d.threading);
  if (!unit) return d;
  d.threading = repeatToFill(d.threading, unit);
  d.warpColors = repeatToFill(d.warpColors, unit);
  return d;
}

/** Repeat the filled-in part of the treadling (liftplan, weft colors) to fill all picks. */
export function repeatTreadlingToFill(draft) {
  const d = copy(draft);
  const key = d.mode === 'liftplan'
    ? d.liftplan.map((l) => (l.length ? l.join(',') : null))
    : d.treadling;
  const unit = repeatUnit(key);
  if (!unit) return d;
  d.treadling = repeatToFill(d.treadling, unit);
  d.liftplan = repeatToFill(d.liftplan, unit);
  d.weftColors = repeatToFill(d.weftColors, unit);
  return d;
}

/** Mirror the filled-in start of the threading (and warp colors) back on itself, then repeat to fill. */
export function mirrorThreading(draft) {
  const d = copy(draft);
  const unit = repeatUnit(d.threading) || d.threading.length;
  d.threading = repeatTreadling(mirror(d.threading.slice(0, unit)), d.threading.length);
  d.warpColors = repeatTreadling(mirror(d.warpColors.slice(0, unit)), d.warpColors.length);
  return d;
}

export function mirrorTreadling(draft) {
  const d = copy(draft);
  const unit = repeatUnit(d.treadling) || d.treadling.length;
  d.treadling = repeatTreadling(mirror(d.treadling.slice(0, unit)), d.treadling.length);
  d.liftplan = repeatTreadling(mirror(d.liftplan.slice(0, unit)), d.liftplan.length);
  d.weftColors = repeatTreadling(mirror(d.weftColors.slice(0, unit)), d.weftColors.length);
  return d;
}

export function clearThreading(draft) {
  const d = copy(draft);
  d.threading = d.threading.map(() => null);
  return d;
}
export function clearTieup(draft) {
  const d = copy(draft);
  d.tieup = emptyTieup(d.shafts, d.treadles);
  return d;
}
export function clearTreadling(draft) {
  const d = copy(draft);
  d.treadling = d.treadling.map(() => null);
  d.liftplan = d.liftplan.map(() => []);
  return d;
}
export function setAllWarpColors(draft, hex) {
  const d = copy(draft);
  d.warpColors = d.warpColors.map(() => hex);
  return d;
}
export function setAllWeftColors(draft, hex) {
  const d = copy(draft);
  d.weftColors = d.weftColors.map(() => hex);
  return d;
}
export function clearColors(draft, warp = CREAM, weft = WOAD) {
  const d = copy(draft);
  d.warpColors = d.warpColors.map(() => warp);
  d.weftColors = d.weftColors.map(() => weft);
  return d;
}
export function clearAll(draft) {
  return clearColors(clearTreadling(clearTieup(clearThreading(draft))));
}

/* --------------------------------------------------------- weaving a cloth */

/** Number of picks woven so far: index after the last pick that has a shed. */
export function wovenCount(draft) {
  for (let p = draft.treadling.length - 1; p >= 0; p--) {
    if (draft.mode === 'liftplan' ? (draft.liftplan[p] || []).length : draft.treadling[p] != null) return p + 1;
  }
  return 0;
}

/**
 * Throw one pick: the next unwoven pick is set (or a pick is added at the end).
 * `what` is a treadle index (treadle mode) or an array of shafts (liftplan mode).
 */
export function appendPick(draft, what, color) {
  let d = copy(draft);
  const n = wovenCount(d);
  if (n >= d.treadling.length) d = setPicks(d, n + 1);
  if (d.mode === 'liftplan') d.liftplan[n] = sortedUnique([...what]);
  else d.treadling[n] = what;
  d.weftColors[n] = color;
  return d;
}

/** Un-weave the last pick (its slot is emptied, not removed). */
export function removeLastPick(draft) {
  const d = copy(draft);
  const n = wovenCount(d);
  if (n > 0) { d.treadling[n - 1] = null; d.liftplan[n - 1] = []; }
  return d;
}

/* ---------------------------------------------------------------- presets */

/**
 * Build a draft from readable 1-based data.
 *  threading: 1-based shafts; tieup: per treadle, list of 1-based shafts;
 *  treadling: 1-based treadles. warp/weft: color or per-thread arrays.
 */
function build({ shafts = 4, threading, tieup, treadling, ends, picks, warp = CREAM, weft = WOAD, treadles }) {
  const T = treadles || tieup.length;
  const d = createDraft({ shafts, treadles: T, ends, picks });
  d.threading = repeatTreadling(threading.map((s) => s - 1), ends);
  tieup.forEach((list, t) => list.forEach((s) => { d.tieup[s - 1][t] = true; }));
  d.treadling = repeatTreadling(treadling.map((t) => t - 1), picks);
  d.liftplan = toLiftplan(d);
  const colors = (c, n) => (Array.isArray(c) ? repeatTreadling(c, n) : range(n).map(() => c));
  d.warpColors = colors(warp, ends);
  d.weftColors = colors(weft, picks);
  return d;
}

const TWILL22 = [[1, 2], [2, 3], [3, 4], [4, 1]];
const PLAIN = [[1, 3], [2, 4]];

const PRESET_DEFS = [
  {
    id: 'plain', name: 'Plain weave', note: 'Over one, under one. Treadles alternate 1+3 and 2+4.',
    build: () => build({ threading: [1, 2, 3, 4], tieup: PLAIN, treadling: [1, 2], ends: 24, picks: 24, warp: CREAM, weft: MADDER }),
  },
  {
    id: 'basket', name: 'Basket weave (2/2)', note: 'Plain weave in pairs: two ends and two picks work together.',
    build: () => build({ threading: [1, 1, 2, 2], tieup: [[1], [2]], treadling: [1, 1, 2, 2], ends: 24, picks: 24, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'twill22', name: '2/2 twill', note: 'Straight draw, two up and two down, stepping one end per pick.',
    build: () => build({ threading: [1, 2, 3, 4], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 24, picks: 24, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'twill13', name: '1/3 twill', note: 'One up, three down: weft-dominant on the face.',
    build: () => build({ threading: [1, 2, 3, 4], tieup: [[1], [2], [3], [4]], treadling: [1, 2, 3, 4], ends: 24, picks: 24, warp: CREAM, weft: INDIGO }),
  },
  {
    id: 'twill31', name: '3/1 twill', note: 'Three up, one down: warp-dominant on the face (the back of 1/3).',
    build: () => build({ threading: [1, 2, 3, 4], tieup: [[2, 3, 4], [1, 3, 4], [1, 2, 4], [1, 2, 3]], treadling: [1, 2, 3, 4], ends: 24, picks: 24, warp: INDIGO, weft: CREAM }),
  },
  {
    id: 'broken', name: 'Broken twill', note: 'Straight treadling over a threading that reverses with the turning ends doubled (1234 4321), so no point forms.',
    build: () => build({ threading: [1, 2, 3, 4, 4, 3, 2, 1], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 24, picks: 24, warp: CREAM, weft: MADDER }),
  },
  {
    id: 'point', name: 'Point twill (rosepath)', note: 'Threading 1 2 3 4 3 2 and treadled the same way, 2/2 tie-up: diamonds.',
    build: () => build({ threading: [1, 2, 3, 4, 3, 2], tieup: TWILL22, treadling: [1, 2, 3, 4, 3, 2], ends: 24, picks: 24, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'herringbone', name: 'Herringbone', note: 'Eight ends of twill run one way, eight the other (zigzag threading), straight treadling.',
    build: () => {
      const zig = range(16).map((i) => (i <= 8 ? i : 16 - i) % 4 + 1);
      return build({ threading: zig, tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 32, picks: 24, warp: CREAM, weft: WALNUT });
    },
  },
  {
    id: 'birdseye', name: "Bird's-eye (small point twill)", note: 'A tiny diamond twill on three shafts: threaded 1 2 3 2, treadled 1 2 3 2.',
    build: () => build({ threading: [1, 2, 3, 2], tieup: [[1, 2], [2, 3], [3, 1]], treadling: [1, 2, 3, 2], ends: 24, picks: 24, warp: CREAM, weft: INDIGO }),
  },
  {
    id: 'overshot', name: 'Overshot, two blocks (Monk’s belt style)', note: 'Pattern picks (indigo) alternate with tabby picks (cream). Treadles 1 and 2 are pattern, 3 and 4 are tabby.',
    build: () => {
      // Block A threaded 1 2 1 2 1 2, block B threaded 3 2 3 2 3 2; odd positions
      // stay on odd shafts so the tabby treadles (1+3, 2+4) alternate cleanly.
      const A = [1, 2, 1, 2, 1, 2];
      const B = [3, 2, 3, 2, 3, 2];
      const threading = [...A, ...B];
      // Pattern treadle 1 = 3+4 floats over block A; treadle 2 = 4+1 floats over block B.
      const tieup = [[3, 4], [4, 1], [1, 3], [2, 4]];
      const group = (pat) => [pat, 3, pat, 4, pat, 3, pat, 4]; // pattern, tabby a, pattern, tabby b, ...
      const treadling = [...group(1), ...group(2), ...group(1), ...group(2)];
      const d = build({ threading, tieup, treadling, ends: 24, picks: 32, warp: CREAM, weft: CREAM });
      d.weftColors = repeatTreadling([INDIGO, CREAM], 32);
      return d;
    },
  },
  {
    id: 'houndstooth', name: 'Houndstooth', note: '2/2 twill with 4 dark and 4 light in both warp and weft.',
    build: () => {
      const col = [CHARCOAL, CHARCOAL, CHARCOAL, CHARCOAL, CREAM, CREAM, CREAM, CREAM];
      return build({ threading: [1, 2, 3, 4], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 32, picks: 32, warp: col, weft: col });
    },
  },
  {
    id: 'logcabin', name: 'Log cabin', note: 'Plain weave, one dark and one light in warp and weft; the order flips every 8 so blocks of stripes alternate.',
    build: () => {
      const D = CHARCOAL;
      const L = OCHRE;
      const seq = [D, L, D, L, D, L, D, L, L, D, L, D, L, D, L, D];
      return build({ threading: [1, 2, 3, 4], tieup: PLAIN, treadling: [1, 2], ends: 32, picks: 32, warp: seq, weft: seq });
    },
  },
  {
    id: 'waffle', name: 'Waffle-style cells (5 shaft)', note: 'Point threading 1 2 3 4 5 4 3 2 with matching point treadling: floats form cells around plain-weave centers. A simplified waffle.',
    build: () => {
      // lifted when |threadShaft - treadle| mod 3 != 1 (1-based, 5 shafts, 5 treadles)
      const tieup = range(5).map((t) => range(5).map((s) => s + 1).filter((s) => Math.abs(s - (t + 1)) % 3 !== 1));
      return build({ shafts: 5, threading: [1, 2, 3, 4, 5, 4, 3, 2], tieup, treadling: [1, 2, 3, 4, 5, 4, 3, 2], ends: 32, picks: 32, warp: CREAM, weft: SAGE });
    },
  },
  {
    id: 'twillblocks', name: 'Twill blocks (8 shaft, M’s and O’s style)', note: 'Two 4-shaft twill blocks side by side; one block steps right while the other steps left, then they swap. A simplified relative of M’s and O’s.',
    build: () => {
      // Block A = shafts 1-4, block B = shafts 5-8. fwd(k) / rev(k): the 2/2 twill lift
      // stepping one way or the other on step k. Treadles 1-4: A forward, B backward;
      // treadles 5-8: A backward, B forward.
      const fwd = (k) => [k + 1, ((k + 1) % 4) + 1];
      const rev = (k) => fwd((4 - k) % 4);
      const tieup = [];
      for (let k = 0; k < 4; k++) tieup.push([...fwd(k), ...rev(k).map((s) => s + 4)]);
      for (let k = 0; k < 4; k++) tieup.push([...rev(k), ...fwd(k).map((s) => s + 4)]);
      return build({
        shafts: 8,
        threading: [1, 2, 3, 4, 5, 6, 7, 8],
        tieup,
        treadling: [1, 2, 3, 4, 5, 6, 7, 8],
        ends: 32, picks: 32, warp: CREAM, weft: LOGWOOD,
      });
    },
  },
];

export const PRESETS = PRESET_DEFS.map(({ id, name, note }) => ({ id, name, note }));

export function buildPreset(id) {
  const def = PRESET_DEFS.find((p) => p.id === id);
  return def ? def.build() : null;
}
