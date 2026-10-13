/*
 * puzzles.js: "Match the cloth" drafting puzzles. PURE module (no window,
 * document, Date.now, Math.random).
 *
 * A puzzle has a hidden target draft. The weaver drafts her own loom (within
 * the stated shafts / treadles) until the cloth on the FACE matches the target.
 * similarity() is the share of cells that match, allowing any horizontal and
 * vertical shift of the repeat (the compared cloth is treated as a repeating
 * tile, so an offset draft still counts). Nothing here marks a mistake: the
 * mask only says which of her cells match.
 */
import {
  createDraft, buildDraft, drawdown, repeatTreadling, setShafts, setTreadles,
} from './draft.js';

const CREAM = '#EFE6D2';
const WOAD = '#3E6A9E';
const INDIGO = '#2C3E66';
const MADDER = '#B8433A';
const CHARCOAL = '#2E2B28';
const OCHRE = '#D9A63A';
const SAGE = '#8A9A6B';
const WALNUT = '#6B4A32';

const TWILL22 = [[1, 2], [2, 3], [3, 4], [4, 1]];
const PLAIN = [[1, 3], [2, 4]];

/** Each puzzle: data plus solution() which returns one draft that solves it. */
const DEFS = [
  {
    id: 'tea-towel', title: 'Plain weave', customer: 'A tea-towel for the market stall: just a plain, honest cloth.',
    shafts: 4, treadles: 2, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4], tieup: PLAIN, treadling: [1, 2], ends: 16, picks: 16, warp: CREAM, weft: MADDER }),
  },
  {
    id: 'basket', title: 'Basket weave', customer: 'A cosy cushion cover that looks like a little woven basket.',
    shafts: 4, treadles: 2, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 1, 2, 2], tieup: [[1], [2]], treadling: [1, 1, 2, 2], ends: 16, picks: 16, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'twill22', title: '2/2 twill', customer: 'A sturdy blanket for the shop door, with a clear diagonal.',
    shafts: 4, treadles: 4, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 16, picks: 16, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'twill13', title: '1/3 twill', customer: 'A soft scarf where the weft shows long and smooth on the face.',
    shafts: 4, treadles: 4, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4], tieup: [[1], [2], [3], [4]], treadling: [1, 2, 3, 4], ends: 16, picks: 16, warp: CREAM, weft: INDIGO }),
  },
  {
    id: 'twill31', title: '3/1 twill', customer: 'A jacket lining: warp on the face this time, with a fine diagonal.',
    shafts: 4, treadles: 4, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4], tieup: [[2, 3, 4], [1, 3, 4], [1, 2, 4], [1, 2, 3]], treadling: [1, 2, 3, 4], ends: 16, picks: 16, warp: INDIGO, weft: CREAM }),
  },
  {
    id: 'point', title: 'Point twill', customer: 'The Weavers’ Guild would like this for a table runner: little diamonds all along.',
    shafts: 4, treadles: 4, ends: 24, picks: 24, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4, 3, 2], tieup: TWILL22, treadling: [1, 2, 3, 4, 3, 2], ends: 24, picks: 24, warp: CREAM, weft: WOAD }),
  },
  {
    id: 'herringbone', title: 'Herringbone', customer: 'A tailor asks for a classic herringbone for a winter coat.',
    shafts: 4, treadles: 4, ends: 32, picks: 16, structureOnly: true,
    solution: () => {
      const zig = Array.from({ length: 16 }, (_, i) => ((i <= 8 ? i : 16 - i) % 4) + 1);
      return buildDraft({ threading: zig, tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 32, picks: 16, warp: CREAM, weft: WALNUT });
    },
  },
  {
    id: 'broken', title: 'Broken twill', customer: 'A bag-maker wants a twill with the diagonal gently broken up.',
    shafts: 4, treadles: 4, ends: 32, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 4, 4, 3, 2, 1], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 32, picks: 16, warp: CREAM, weft: MADDER }),
  },
  {
    id: 'birdseye', title: 'Bird’s-eye', customer: 'A baby blanket with tiny diamonds, each with a little eye.',
    shafts: 4, treadles: 3, ends: 16, picks: 16, structureOnly: true,
    solution: () => buildDraft({ threading: [1, 2, 3, 2], tieup: [[1, 2], [2, 3], [3, 1]], treadling: [1, 2, 3, 2], ends: 16, picks: 16, warp: CREAM, weft: INDIGO }),
  },
  {
    id: 'houndstooth', title: 'Houndstooth', customer: 'A tailor’s favorite: dark and light houndstooth. The colors matter here.',
    shafts: 4, treadles: 4, ends: 16, picks: 16, structureOnly: false,
    solution: () => {
      const col = [CHARCOAL, CHARCOAL, CHARCOAL, CHARCOAL, CREAM, CREAM, CREAM, CREAM];
      return buildDraft({ threading: [1, 2, 3, 4], tieup: TWILL22, treadling: [1, 2, 3, 4], ends: 16, picks: 16, warp: col, weft: col });
    },
  },
  {
    id: 'logcabin', title: 'Log cabin', customer: 'A patchwork-look throw woven in plain weave: stripes that turn the corner.',
    shafts: 4, treadles: 2, ends: 16, picks: 16, structureOnly: false,
    solution: () => {
      const seq = [CHARCOAL, OCHRE, CHARCOAL, OCHRE, CHARCOAL, OCHRE, CHARCOAL, OCHRE, OCHRE, CHARCOAL, OCHRE, CHARCOAL, OCHRE, CHARCOAL, OCHRE, CHARCOAL];
      return buildDraft({ threading: [1, 2, 3, 4], tieup: PLAIN, treadling: [1, 2], ends: 16, picks: 16, warp: seq, weft: seq });
    },
  },
  {
    id: 'overshot', title: 'Overshot blocks', customer: 'A heirloom coverlet in two bold blocks, with a tabby between each pattern pick.',
    shafts: 4, treadles: 4, ends: 24, picks: 16, structureOnly: true,
    solution: () => {
      const A = [1, 2, 1, 2, 1, 2];
      const B = [3, 2, 3, 2, 3, 2];
      const group = (pat) => [pat, 3, pat, 4, pat, 3, pat, 4];
      return buildDraft({
        threading: [...A, ...B], tieup: [[3, 4], [4, 1], [1, 3], [2, 4]],
        treadling: [...group(1), ...group(2)], ends: 24, picks: 16, warp: CREAM, weft: INDIGO,
      });
    },
  },
];

export const PUZZLES = DEFS.map((d, i) => ({
  id: d.id, title: d.title, customer: d.customer, shafts: d.shafts, treadles: d.treadles,
  ends: d.ends, picks: d.picks, structureOnly: d.structureOnly, level: i + 1,
  solution: d.solution,
}));

export function getPuzzle(id) {
  return PUZZLES.find((p) => p.id === id) || null;
}

/** The hidden target draft (never shown as a draft, only as cloth). */
export function targetOf(puzzle) {
  return puzzle.solution();
}

/** A fresh, blank draft with the puzzle's loom and size. */
export function startDraft(puzzle) {
  let d = createDraft({ shafts: puzzle.shafts, treadles: puzzle.treadles, ends: puzzle.ends, picks: puzzle.picks, warpColor: CREAM, weftColor: SAGE });
  d = setShafts(d, puzzle.shafts);
  d = setTreadles(d, puzzle.treadles);
  return d;
}

/* ------------------------------------------------------------- similarity */

/** Face of the cloth as integer codes: structure (0/1) or top-thread color index. */
function codes(draft, structureOnly, palette) {
  const dd = drawdown(draft);
  const E = draft.threading.length;
  const P = dd.length;
  const out = new Int32Array(E * P);
  for (let p = 0; p < P; p++) {
    for (let e = 0; e < E; e++) {
      const warp = dd[p][e] === 'warp';
      if (structureOnly) { out[p * E + e] = warp ? 1 : 0; continue; }
      const c = (warp ? draft.warpColors[e] : draft.weftColors[p]).toLowerCase();
      if (!palette.has(c)) palette.set(c, palette.size);
      out[p * E + e] = palette.get(c);
    }
  }
  return { a: out, E, P };
}

/**
 * Best match of the user's cloth against the target over every shift.
 * The user's cloth is treated as a repeating tile; the target is compared
 * cell for cell. Returns { score 0..1, dx, dy } where target cell (e, p)
 * is compared with user cell ((e+dx) mod Eu, (p+dy) mod Pu).
 */
export function bestMatch(user, target, { structureOnly = true } = {}) {
  const palette = new Map();
  const T = codes(target, structureOnly, palette);
  const U = codes(user, structureOnly, palette);
  const total = T.E * T.P;
  let best = { score: 0, dx: 0, dy: 0 };
  if (!total || !U.E || !U.P) return best;
  for (let dy = 0; dy < U.P; dy++) {
    for (let dx = 0; dx < U.E; dx++) {
      let hit = 0;
      for (let p = 0; p < T.P; p++) {
        const row = ((p + dy) % U.P) * U.E;
        const trow = p * T.E;
        for (let e = 0; e < T.E; e++) if (T.a[trow + e] === U.a[row + ((e + dx) % U.E)]) hit++;
      }
      const score = hit / total;
      if (score > best.score) {
        best = { score, dx, dy };
        if (hit === total) return best;
      }
    }
  }
  return best;
}

/** 0..1: share of matching cells, best over all shifts. */
export function similarity(user, target, opts) {
  return bestMatch(user, target, opts).score;
}

/**
 * Progress for the meter, 0..1: similarity rescaled so an all-weft or all-warp
 * cloth (what a blank draft weaves) reads 0 and an exact match reads 1.
 * The raw similarity() stays the test for "solved".
 */
export function progress(user, target, opts = {}) {
  const sim = similarity(user, target, opts);
  if (sim >= 1) return 1;
  const flat = { ...user, mode: 'liftplan', shed: 'rising', threading: user.threading.map(() => 0) };
  const weft = { ...flat, liftplan: user.treadling.map(() => []) };
  const all = Array.from({ length: user.shafts }, (_, s) => s);
  const warp = { ...flat, liftplan: user.treadling.map(() => all) };
  const base = Math.max(similarity(weft, target, opts), similarity(warp, target, opts));
  if (base >= 1) return 0;
  return Math.max(0, (sim - base) / (1 - base));
}

/**
 * Which of the user's cells match, under the best shift: boolean [pick][end].
 * Used to let matching areas glow. (Cells that do not match are simply not lit.)
 */
export function matchMask(user, target, opts = {}) {
  const structureOnly = opts.structureOnly ?? true;
  const { dx, dy } = bestMatch(user, target, { structureOnly });
  const palette = new Map();
  const T = codes(target, structureOnly, palette);
  const U = codes(user, structureOnly, palette);
  const mask = [];
  for (let p = 0; p < U.P; p++) {
    const row = [];
    for (let e = 0; e < U.E; e++) {
      // user cell (e,p) corresponds to target cell ((e-dx) mod Et, (p-dy) mod Pt)
      const te = (((e - dx) % T.E) + T.E) % T.E;
      const tp = (((p - dy) % T.P) + T.P) % T.P;
      row.push(U.a[p * U.E + e] === T.a[tp * T.E + te]);
    }
    mask.push(row);
  }
  return mask;
}

export function isSolved(user, puzzle, target = targetOf(puzzle)) {
  return similarity(user, target, { structureOnly: puzzle.structureOnly }) >= 1;
}

/* ------------------------------------------------------------------ hints */

/** Hint stages in order. Colors only for puzzles where colors matter. */
export function hintStages(puzzle) {
  return puzzle.structureOnly ? ['threading', 'tie-up', 'treadling'] : ['threading', 'tie-up', 'treadling', 'colors'];
}

/** Reveal one stage by copying it from the solution into the user's draft. */
export function applyHint(draft, puzzle, stage) {
  const sol = puzzle.solution();
  const d = {
    ...draft,
    threading: draft.threading.slice(),
    tieup: draft.tieup.map((r) => r.slice()),
    treadling: draft.treadling.slice(),
    liftplan: draft.liftplan.map((l) => l.slice()),
    warpColors: draft.warpColors.slice(),
    weftColors: draft.weftColors.slice(),
    mode: 'treadle',
    shed: 'rising',
  };
  const fitTo = (arr, n) => repeatTreadling(arr, n);
  if (stage === 'threading') d.threading = fitTo(sol.threading, d.threading.length);
  if (stage === 'tie-up') {
    d.tieup = Array.from({ length: d.shafts }, (_, s) => Array.from({ length: d.treadles }, (_, t) => !!sol.tieup[s]?.[t]));
  }
  if (stage === 'treadling') {
    d.treadling = fitTo(sol.treadling, d.treadling.length).map((t) => (t != null && t < d.treadles ? t : null));
    d.liftplan = d.treadling.map(() => []);
  }
  if (stage === 'colors') {
    d.warpColors = fitTo(sol.warpColors, d.warpColors.length);
    d.weftColors = fitTo(sol.weftColors, d.weftColors.length);
  }
  return d;
}
