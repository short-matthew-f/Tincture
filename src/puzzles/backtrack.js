// backtrack.js — "Back to solvable" (pure, shared by Purify and the Lifting Table).
// 0.4.1 playtest: when a position is a dead end, undo back through the history
// to the latest position from which the puzzle can still be finished.
//
// Positions are numbered 0 (the fresh puzzle) .. n - 1 (where she is now). A
// verdict for a position is 'solvable', 'dead' or 'unknown' (the solver ran out
// of its node budget). Purify treats 'unknown' as solvable, so the button never
// lies about a dead end; the Lifting Table only stops on a position it can
// prove solvable (`unknown: 'skip'`).

/**
 * lastSolvable(n, verdictAt, {unknown = 'solvable', fallback = 0}) -> index
 * The largest index i in [0, n) whose verdict counts as solvable, scanning back
 * from the newest position and asking verdictAt(i) lazily (so the cheap newest
 * positions are tried first). `unknown: 'skip'` keeps going back past an
 * undecided position. When nothing qualifies (or verdictAt returns 'stop', a
 * spent budget) the result is `fallback` (default 0: the fresh puzzle, which is
 * always solvable), or the fallback function's answer.
 */
export function lastSolvable(n, verdictAt, { unknown = 'solvable', fallback = 0 } = {}) {
  const fb = () => (typeof fallback === 'function' ? fallback() : fallback);
  for (let i = n - 1; i >= 0; i--) {
    const v = verdictAt(i);
    if (v === 'stop') return fb();
    if (v === 'solvable') return i;
    if (v === 'unknown' && unknown !== 'skip') return i;
  }
  return fb();
}

/** A tiny bounded memo (Map with insertion-order eviction) for verdicts by position key. */
export function verdictCache(max = 400) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    has: (k) => m.has(k),
    set(k, v) {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
      return v;
    },
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}
