// engine.js — the knitting model for the Knitting Room prototype (pure: no DOM,
// no Date.now, no Math.random). US terms throughout.
//
// The piece is a log of actions (cast on, stitches, yarn changes, turns,
// slides, markers) replayed into a stitch graph. Every stitch knows the loops
// it was worked through (`parents`), which side it was worked from and how it
// faces the right side, so the renderer can draw decreases leaning, cables
// crossing, slipped stitches stretching, short-row wedges and shaped edges
// from the structure itself.
//
// Needle model: `live` is every stitch on the needles in right-side
// left-to-right order (markers are entries whose id starts with 'm'). A
// boundary index `cursor` splits worked from unworked. Right-side passes move
// right to left (dir -1: the next stitch is live[cursor-1]); wrong-side passes
// move left to right (dir +1: the next stitch is live[cursor]). Turning flips
// the direction at the cursor, which is exactly what a short row is. In the
// round every pass is a right-side round.

const FLIP = { k: 'p', p: 'k' };
const MIRROR = { L: 'R', R: 'L', C: 'C' };

// ---------------------------------------------------------------------------
// Stitch vocabulary
// ---------------------------------------------------------------------------
// consume: stitches taken from the left needle. make(ctx) returns the new
// stitches in work order: {work:'k'|'p', lean?, tbl?, slip?, yo?, ...}.
// `lean` is as seen from the working side; the engine mirrors it for WS rows.

const one = (spec) => () => [spec];

function cable(held, holdSide, heldWork, otherWork) {
  return (ctx) => {
    const other = ctx.consume - held;
    const group = ctx.nextGroup();
    const out = [];
    // Knit the "other" stitches first, then the held ones from the cable needle.
    for (let i = 0; i < other; i++) out.push({ work: otherWork, parentIdx: held + i, cable: { group, front: holdSide === 'back' } });
    for (let i = 0; i < held; i++) out.push({ work: heldWork, parentIdx: i, cable: { group, front: holdSide === 'front' } });
    return out;
  };
}

export const STITCHES = {
  // Basics
  k: { consume: 1, label: 'k', name: 'Knit', group: 'basic', make: one({ work: 'k' }) },
  p: { consume: 1, label: 'p', name: 'Purl', group: 'basic', make: one({ work: 'p' }) },
  ktbl: { consume: 1, label: 'k1 tbl', name: 'Knit through back loop', group: 'basic', make: one({ work: 'k', tbl: true }) },
  ptbl: { consume: 1, label: 'p1 tbl', name: 'Purl through back loop', group: 'basic', make: one({ work: 'p', tbl: true }) },
  slwyib: { consume: 1, label: 'sl 1 wyib', name: 'Slip purlwise, yarn in back', group: 'slip', make: one({ slip: 'back' }) },
  slwyif: { consume: 1, label: 'sl 1 wyif', name: 'Slip purlwise, yarn in front', group: 'slip', make: one({ slip: 'front' }) },
  // Increases
  yo: { consume: 0, label: 'yo', name: 'Yarn over', group: 'inc', make: one({ work: 'k', yo: true }) },
  m1l: { consume: 0, label: 'M1L', name: 'Make 1 left', group: 'inc', make: one({ work: 'k', lean: 'L', inc: 'bar' }) },
  m1r: { consume: 0, label: 'M1R', name: 'Make 1 right', group: 'inc', make: one({ work: 'k', lean: 'R', inc: 'bar' }) },
  m1lp: { consume: 0, label: 'M1LP', name: 'Make 1 left purlwise', group: 'inc', make: one({ work: 'p', lean: 'L', inc: 'bar' }) },
  m1rp: { consume: 0, label: 'M1RP', name: 'Make 1 right purlwise', group: 'inc', make: one({ work: 'p', lean: 'R', inc: 'bar' }) },
  lli: { consume: 0, label: 'LLI', name: 'Left lifted increase', group: 'inc', make: one({ work: 'k', lean: 'L', inc: 'lifted' }) },
  rli: { consume: 0, label: 'RLI', name: 'Right lifted increase', group: 'inc', make: one({ work: 'k', lean: 'R', inc: 'lifted' }) },
  kfb: { consume: 1, label: 'kfb', name: 'Knit front and back', group: 'inc', make: () => [{ work: 'k', parentIdx: 0 }, { work: 'p', parentIdx: 0, inc: 'kfb' }] },
  pfb: { consume: 1, label: 'pfb', name: 'Purl front and back', group: 'inc', make: () => [{ work: 'p', parentIdx: 0 }, { work: 'k', parentIdx: 0, inc: 'kfb' }] },
  kyok: { consume: 1, label: '(k1, yo, k1) in next st', name: 'K1, yo, k1 in one stitch', group: 'inc', make: () => [{ work: 'k', parentIdx: 0 }, { work: 'k', yo: true, parentIdx: 0 }, { work: 'k', parentIdx: 0 }] },
  co: { consume: 0, label: 'CO 1', name: 'Backward-loop cast on', group: 'inc', make: one({ work: 'k', castOn: true }) },
  // Decreases (lean as seen from the working side)
  k2tog: { consume: 2, label: 'k2tog', name: 'Knit 2 together', group: 'dec', make: one({ work: 'k', lean: 'R', top: 1 }) },
  ssk: { consume: 2, label: 'ssk', name: 'Slip, slip, knit', group: 'dec', make: one({ work: 'k', lean: 'L', top: 0 }) },
  p2tog: { consume: 2, label: 'p2tog', name: 'Purl 2 together', group: 'dec', make: one({ work: 'p', lean: 'L', top: 1 }) },
  ssp: { consume: 2, label: 'ssp', name: 'Slip, slip, purl', group: 'dec', make: one({ work: 'p', lean: 'R', top: 0 }) },
  k3tog: { consume: 3, label: 'k3tog', name: 'Knit 3 together', group: 'dec', make: one({ work: 'k', lean: 'R', top: 2 }) },
  sssk: { consume: 3, label: 'sssk', name: 'Slip, slip, slip, knit', group: 'dec', make: one({ work: 'k', lean: 'L', top: 0 }) },
  sk2p: { consume: 3, label: 'sk2p', name: 'Sl 1, k2tog, psso', group: 'dec', make: one({ work: 'k', lean: 'L', top: 0 }) },
  s2kp: { consume: 3, label: 's2kp', name: 'Centered double decrease', group: 'dec', make: one({ work: 'k', lean: 'C', top: 1 }) },
  p3tog: { consume: 3, label: 'p3tog', name: 'Purl 3 together', group: 'dec', make: one({ work: 'p', lean: 'L', top: 2 }) },
  // Cables (US: held/other, RC holds to the back, LC to the front)
  rc11: { consume: 2, label: '1/1 RC', name: 'Right twist (1 over 1, back)', group: 'cable', make: cable(1, 'back', 'k', 'k') },
  lc11: { consume: 2, label: '1/1 LC', name: 'Left twist (1 over 1, front)', group: 'cable', make: cable(1, 'front', 'k', 'k') },
  rc22: { consume: 4, label: '2/2 RC', name: '2 over 2 right cross', group: 'cable', make: cable(2, 'back', 'k', 'k') },
  lc22: { consume: 4, label: '2/2 LC', name: '2 over 2 left cross', group: 'cable', make: cable(2, 'front', 'k', 'k') },
  rc33: { consume: 6, label: '3/3 RC', name: '3 over 3 right cross', group: 'cable', make: cable(3, 'back', 'k', 'k') },
  lc33: { consume: 6, label: '3/3 LC', name: '3 over 3 left cross', group: 'cable', make: cable(3, 'front', 'k', 'k') },
  rpc21: { consume: 3, label: '2/1 RPC', name: '2 over 1 right purl cross', group: 'cable', make: cable(1, 'back', 'p', 'k') },
  lpc21: { consume: 3, label: '2/1 LPC', name: '2 over 1 left purl cross', group: 'cable', make: cable(2, 'front', 'k', 'p') },
  rpc22: { consume: 4, label: '2/2 RPC', name: '2 over 2 right purl cross', group: 'cable', make: cable(2, 'back', 'p', 'k') },
  lpc22: { consume: 4, label: '2/2 LPC', name: '2 over 2 left purl cross', group: 'cable', make: cable(2, 'front', 'k', 'p') },
  // Brioche
  sl1yo: { consume: 1, label: 'sl1yo', name: 'Slip 1, yarn over', group: 'brioche', make: one({ slip: 'shawl', brioche: 'slyo' }) },
  brk: { consume: 1, label: 'brk', name: 'Brioche knit', group: 'brioche', make: one({ work: 'k', brioche: 'k' }) },
  brp: { consume: 1, label: 'brp', name: 'Brioche purl', group: 'brioche', make: one({ work: 'p', brioche: 'p' }) },
  // Bind off
  bo: { consume: 1, label: 'BO 1', name: 'Bind off 1', group: 'bo', make: one({ work: 'k', bindOff: true }) },
};

export const STITCH_GROUPS = [
  { id: 'basic', name: 'Knit and purl' },
  { id: 'dec', name: 'Decreases' },
  { id: 'inc', name: 'Increases' },
  { id: 'slip', name: 'Slip' },
  { id: 'cable', name: 'Cables' },
  { id: 'brioche', name: 'Brioche' },
  { id: 'bo', name: 'Bind off' },
];

// ---------------------------------------------------------------------------
// Piece
// ---------------------------------------------------------------------------

export const DEFAULT_YARNS = [
  { id: 'A', name: 'Cream', hex: '#EFE6D2' },
  { id: 'B', name: 'Madder', hex: '#B8433A' },
  { id: 'C', name: 'Woad', hex: '#3E6A9E' },
  { id: 'D', name: 'Weld', hex: '#E3C65A' },
  { id: 'E', name: 'Walnut', hex: '#6B4A32' },
  { id: 'F', name: 'Sage', hex: '#8A9A6B' },
];

/** A fresh piece description (the log's first entry). */
export function newPiece({ stitches = 20, mode = 'flat', yarn = 'A', yarns = DEFAULT_YARNS, method = 'long-tail' } = {}) {
  return { log: [{ t: 'castOn', stitches: Math.max(1, stitches | 0), mode, yarn, method }], yarns: yarns.map((y) => ({ ...y })) };
}

/** Replays a piece's log into a full knitting state. */
export function build(piece) {
  const first = piece.log[0];
  const s = {
    mode: first.mode,
    yarns: piece.yarns,
    yarn: first.yarn,
    cells: [],          // every stitch ever made (index = id)
    live: [],           // RS-ordered ids on the needles ('m…' = marker)
    cursor: 0,
    dir: -1,
    passes: [],
    groups: 0,
    markers: 0,
    finished: false,
    note: null,
  };
  for (let i = 0; i < first.stitches; i++) {
    const c = mkCell(s, { work: 'k', face: 'k', color: first.yarn, parents: [], y: 0, pass: -1, castOn: true, op: 'castOn' });
    s.live.push(c.id);
  }
  startPass(s, 'RS', 'row');
  for (let i = 1; i < piece.log.length; i++) {
    s.logIdx = i;
    const r = step(s, piece.log[i]);
    if (!r.ok) { s.note = r.reason; break; }
  }
  return s;
}

function mkCell(s, props) {
  const c = { id: s.cells.length, ...props };
  s.cells.push(c);
  return c;
}

const isMarker = (id) => typeof id === 'string';

function startPass(s, side, kind) {
  const round = s.mode === 'round';
  s.dir = side === 'RS' ? -1 : 1;
  s.cursor = side === 'RS' ? s.live.length : 0;
  const number = s.passes.filter((p) => p.ops.length || p.kind !== 'row').length + 1;
  s.passes.push({ index: s.passes.length, number, side, round, kind, ops: [], cells: [], end: null, startCount: stitchCount(s), logStart: (s.logIdx ?? 0) + 1 });
}

function current(s) { return s.passes[s.passes.length - 1]; }

export function stitchCount(s) { return s.live.filter((id) => !isMarker(id)).length; }

/** Stitches left to work in this pass (markers skipped). */
export function remaining(s) {
  const part = s.dir < 0 ? s.live.slice(0, s.cursor) : s.live.slice(s.cursor);
  return part.filter((id) => !isMarker(id)).length;
}

function workedSide(s) { return current(s).side; }

/** The next stitch on the left needle (or null). */
export function nextStitch(s) {
  if (s.dir < 0) {
    for (let j = s.cursor - 1; j >= 0; j--) if (!isMarker(s.live[j])) return s.cells[s.live[j]];
  } else {
    for (let j = s.cursor; j < s.live.length; j++) if (!isMarker(s.live[j])) return s.cells[s.live[j]];
  }
  return null;
}

function step(s, e) {
  if (s.finished && e.t !== 'yarn') return { ok: false, reason: 'The piece is bound off.' };
  switch (e.t) {
    case 'st': return work(s, e.op);
    case 'yarn': s.yarn = e.id; current(s).ops.push({ t: 'yarn', id: e.id }); return { ok: true };
    case 'pm': {
      const id = 'm' + (++s.markers);
      s.live.splice(s.cursor, 0, id);
      if (s.dir > 0) s.cursor++;
      current(s).ops.push({ t: 'pm' });
      return { ok: true };
    }
    case 'turn': return turn(s, e.kind || 'turn');
    case 'slide': return slide(s);
    default: return { ok: false, reason: 'Unknown step' };
  }
}

function work(s, op) {
  const def = STITCHES[op];
  if (!def) return { ok: false, reason: `Unknown stitch ${op}` };
  if (remaining(s) < def.consume) return { ok: false, reason: `Not enough stitches left for ${def.label}.` };
  const pass = current(s);
  const side = workedSide(s);
  // Gather consumed stitches in work order, lifting any markers past.
  const take = [];
  const marks = [];
  let j = s.cursor;
  while (take.length < def.consume) {
    if (s.dir < 0) { j--; const id = s.live[j]; (isMarker(id) ? marks : take).push(id); } else { const id = s.live[j]; j++; (isMarker(id) ? marks : take).push(id); }
  }
  if (marks.length) pass.ops.push({ t: 'sm', n: marks.length });
  const parents = take.map((id) => s.cells[id]);
  const ctx = { consume: def.consume, nextGroup: () => ++s.groups };
  const specs = def.make(ctx);
  const prev = pass.cells.length ? s.cells[pass.cells[pass.cells.length - 1]] : null;
  const made = specs.map((sp) => {
    let ps;
    if (sp.parentIdx !== undefined) ps = [parents[sp.parentIdx]];
    else ps = parents;
    const top = sp.top !== undefined && parents[sp.top] ? parents[sp.top].id : null;
    let y;
    if (ps.length) y = Math.max(...ps.map((p) => p.y)) + 1;
    else if (prev) y = prev.y;
    else { const nx = nextStitch(s); y = nx ? nx.y + 1 : 1; }
    const slipped = sp.slip ? parents[0] : null;
    const workFace = slipped ? (slipped.work ?? 'k') : sp.work;
    const face = slipped ? slipped.face : (side === 'RS' ? sp.work : FLIP[sp.work]);
    const lean = sp.lean ? (side === 'RS' ? sp.lean : MIRROR[sp.lean]) : null;
    const cell = mkCell(s, {
      pass: pass.index, y, op, side,
      work: workFace, face,
      color: slipped ? slipped.color : s.yarn,
      parents: ps.map((p) => p.id),
      lean, top,
      tbl: !!sp.tbl,
      yo: !!sp.yo,
      inc: sp.inc || null,
      castOn: !!sp.castOn,
      bindOff: !!sp.bindOff,
      brioche: sp.brioche || null,
      shawl: sp.brioche === 'slyo' ? s.yarn : null,
      cable: sp.cable || null,
      // Slip floats: which face of the fabric the carried yarn lies on.
      slip: sp.slip ? { float: sp.slip === 'shawl' ? null : floatFace(side, sp.slip), yarn: s.yarn } : null,
    });
    if (!cell.bindOff) pass.cells.push(cell.id);
    return cell;
  });
  // Put the new stitches on the right needle (bound-off stitches leave the needle).
  const onNeedle = made.filter((c) => !c.bindOff).map((c) => c.id);
  if (s.dir < 0) {
    s.live.splice(j, s.cursor - j, ...onNeedle.slice().reverse(), ...marks);
    s.cursor = j;
  } else {
    s.live.splice(s.cursor, j - s.cursor, ...marks, ...onNeedle);
    s.cursor += marks.length + onNeedle.length;
  }
  if (made.some((c) => c.bindOff)) pass.cells.push(...made.filter((c) => c.bindOff).map((c) => c.id));
  pass.ops.push({ t: 'st', op, consume: def.consume, produce: onNeedle.length, yarn: s.yarn });
  if (stitchCount(s) === 0) { s.finished = true; pass.end = 'bindOff'; return { ok: true }; }
  if (remaining(s) === 0) endPass(s);
  return { ok: true };
}

function floatFace(side, held) {
  // Yarn in back on a RS row lies on the WS; in front on a RS row, on the RS.
  // On a WS row "back" faces the RS.
  if (side === 'RS') return held === 'back' ? 'WS' : 'RS';
  return held === 'back' ? 'RS' : 'WS';
}

function endPass(s) {
  const pass = current(s);
  if (pass.kind === 'short') pass.kind = 'row'; // worked back to the edge: a full row again
  // Move markers at the very end onto the worked side.
  if (s.dir < 0) s.cursor = 0; else s.cursor = s.live.length;
  pass.end = 'row';
  pass.endCount = stitchCount(s);
  if (s.mode === 'round') startPass(s, 'RS', 'round');
  else startPass(s, pass.side === 'RS' ? 'WS' : 'RS', 'row');
}

function turn(s, kind) {
  const pass = current(s);
  if (!pass.ops.some((o) => o.t === 'st')) return { ok: false, reason: 'Work a stitch before turning.' };
  if (s.mode === 'round' && kind === 'turn') { /* short rows in the round are fine too */ }
  if (kind === 'wt') {
    const nx = nextStitch(s);
    if (nx) nx.wrapped = true;
  }
  pass.end = kind;
  pass.endCount = stitchCount(s);
  pass.kind = pass.kind === 'round' ? 'round' : 'short';
  const side = pass.side === 'RS' ? 'WS' : 'RS';
  const keep = s.cursor;
  startPass(s, side, 'short');
  s.cursor = keep;
  if (kind === 'ds') {
    // German short row: the first stitch of the new pass becomes a double stitch.
    const nx = nextStitch(s);
    if (nx) nx.double = true;
  }
  current(s).ops.push({ t: 'turned', kind });
  return { ok: true };
}

function slide(s) {
  const pass = current(s);
  const prev = s.passes[s.passes.length - 2];
  if (s.mode === 'round') return { ok: false, reason: 'Sliding is for flat knitting.' };
  if (pass.ops.some((o) => o.t === 'st') || !prev) return { ok: false, reason: 'Slide at the end of a row.' };
  pass.side = prev.side;
  pass.kind = 'slide';
  s.dir = pass.side === 'RS' ? -1 : 1;
  s.cursor = pass.side === 'RS' ? s.live.length : 0;
  pass.ops.push({ t: 'slid' });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Editing the log
// ---------------------------------------------------------------------------

/** Appends a step if it is legal; returns {ok, reason}. */
export function apply(piece, entry, state = build(piece)) {
  const before = piece.log.length;
  piece.log.push(entry);
  const s = build(piece);
  if (s.note) { piece.log.length = before; return { ok: false, reason: s.note, state }; }
  return { ok: true, state: s };
}

/** Fast path: apply many entries, stopping at the first that does not fit. */
export function applyMany(piece, entries) {
  let s = build(piece);
  let done = 0;
  for (const e of entries) {
    const r = step(s, e);
    if (!r.ok) { s = build(piece); return { ok: done > 0, done, reason: r.reason, state: s }; }
    piece.log.push(e);
    done++;
  }
  return { ok: true, done, state: s };
}

export function undo(piece, n = 1) {
  const keep = Math.max(1, piece.log.length - n);
  piece.log.length = keep;
  return build(piece);
}

/** Rip back to the start of the current pass (or the whole previous pass if this one is empty). */
export function ripRow(piece) {
  const s = build(piece);
  const passes = s.passes;
  const cur = passes[passes.length - 1];
  const target = cur.ops.some((o) => o.t === 'st') ? cur : passes[passes.length - 2];
  if (!target) return s;
  piece.log.length = Math.max(1, target.logStart);
  return build(piece);
}

// ---------------------------------------------------------------------------
// Helpers knitters use constantly
// ---------------------------------------------------------------------------

/** The stitch that "works as it appears" for the next stitch: knit the knits, purl the purls. */
export function asItAppears(s) {
  const nx = nextStitch(s);
  if (!nx) return null;
  const sideFace = current(s).side === 'RS' ? nx.face : FLIP[nx.face];
  return sideFace === 'p' ? 'p' : 'k';
}

/** Entries that work `group` (array of stitch ops) to the end, or until `leave` stitches remain. */
export function repeatToEnd(s, group, leave = 0) {
  const need = group.reduce((n, op) => n + (STITCHES[op]?.consume ?? 0), 0);
  const out = [];
  let left = remaining(s) - leave;
  if (need === 0) return out;
  while (left >= need) {
    for (const op of group) out.push({ t: 'st', op });
    left -= need;
  }
  return out;
}

/** Entries that finish the current row working every stitch as it appears. */
export function appearSteps(piece) {
  const sim = build(piece);
  const start = sim.passes.length;
  const out = [];
  let guard = 0;
  while (sim.passes.length === start && !sim.finished && remaining(sim) > 0 && guard++ < 5000) {
    const e = { t: 'st', op: asItAppears(sim) };
    if (!step(sim, e).ok) break;
    out.push(e);
  }
  return out;
}

/** Entries that repeat the last `n` finished passes. */
export function repeatPasses(s, n) {
  const done = s.passes.filter((p) => p.end && p.ops.some((o) => o.t === 'st'));
  const src = done.slice(-n);
  const out = [];
  for (const p of src) {
    for (const o of p.ops) {
      if (o.t === 'st') out.push({ t: 'st', op: o.op });
      else if (o.t === 'yarn') out.push({ t: 'yarn', id: o.id });
      else if (o.t === 'pm') out.push({ t: 'pm' });
    }
    if (p.end && p.end !== 'row' && p.end !== 'bindOff') out.push({ t: 'turn', kind: p.end });
  }
  return out;
}

export function status(s) {
  const pass = current(s);
  const done = s.passes.filter((p) => p.ops.some((o) => o.t === 'st'));
  return {
    pass: pass.number,
    side: pass.side,
    kind: pass.kind,
    round: s.mode === 'round',
    worked: stitchCount(s) - remaining(s),
    left: remaining(s),
    total: stitchCount(s),
    rows: done.length,
    finished: s.finished,
    yarn: s.yarn,
  };
}

// ---------------------------------------------------------------------------
// Written instructions (US)
// ---------------------------------------------------------------------------

function tokensOf(pass, yarns) {
  const toks = [];
  for (const o of pass.ops) {
    if (o.t === 'st') toks.push({ text: STITCHES[o.op].label, op: o.op, n: o.consume });
    else if (o.t === 'yarn') toks.push({ text: `with ${yarnName(yarns, o.id)}`, n: 0, fixed: true });
    else if (o.t === 'pm') toks.push({ text: 'pm', n: 0, fixed: true });
    else if (o.t === 'sm') toks.push({ text: 'sm', n: 0, fixed: true });
  }
  return toks;
}

function yarnName(yarns, id) {
  const y = yarns.find((x) => x.id === id);
  return y ? `${y.id} (${y.name})` : id;
}

/** Run-length: k, k, k -> k3; BO 1 x3 -> BO 3. */
const RUN = { k: (n) => `k${n}`, p: (n) => `p${n}`, bo: (n) => `BO ${n}`, co: (n) => `CO ${n}` };
function rle(toks) {
  const out = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (last && RUN[t.op] && last.op === t.op) { last.count++; last.n += t.n; } else out.push({ ...t, count: 1 });
  }
  return out.map((t) => (RUN[t.op] ? { ...t, text: RUN[t.op](t.count) } : t));
}

const keyOf = (t) => t.text;

/** Finds the repeat that covers the most stitches: *unit; rep from * ... */
function bestRepeat(toks) {
  let best = null;
  const n = toks.length;
  for (let len = 1; len <= Math.floor(n / 2); len++) {
    for (let start = 0; start + 2 * len <= n; start++) {
      let reps = 1;
      while (start + (reps + 1) * len <= n) {
        let same = true;
        for (let i = 0; i < len; i++) if (keyOf(toks[start + i]) !== keyOf(toks[start + reps * len + i])) { same = false; break; }
        if (!same) break;
        reps++;
      }
      if (reps < 2) continue;
      const covered = reps * len;
      const special = !RUN[toks[start].op];
      if (!best || covered > best.covered || (covered === best.covered && (len < best.len || (len === best.len && special && !best.special)))) best = { start, len, reps, covered, special };
    }
  }
  return best;
}

/** "(yo, k1) 6 times", "(k2tog) 3 times": runs of a short group become one phrase. */
function groupRuns(toks) {
  const out = [];
  let i = 0;
  while (i < toks.length) {
    let best = null;
    for (let len = 1; len <= 4 && i + 2 * len <= toks.length; len++) {
      let r = 1;
      while (i + (r + 1) * len <= toks.length) {
        let same = true;
        for (let j = 0; j < len; j++) if (toks[i + j].text !== toks[i + r * len + j].text || toks[i + j].fixed) { same = false; break; }
        if (!same) break;
        r++;
      }
      const plain = len === 1 && RUN[toks[i].op];
      if (r >= 2 && !plain && r * len >= 3 && (!best || r * len > best.r * best.len)) best = { len, r };
    }
    if (best) {
      const unit = toks.slice(i, i + best.len);
      out.push({ text: `(${unit.map((t) => t.text).join(', ')}) ${best.r} times`, n: unit.reduce((a, t) => a + t.n, 0) * best.r });
      i += best.len * best.r;
    } else out.push(toks[i++]);
  }
  return out;
}

function joinToks(toks) { return groupRuns(toks).map((t) => t.text).join(', '); }

function writtenParts(s, pass) {
  const toks = rle(tokensOf(pass, s.yarns));
  if (!toks.length) return null;
  let body;
  // RLE first, then look for a repeat over the raw stitch tokens for patterns like k2, p2.
  const raw = tokensOf(pass, s.yarns);
  const rep = bestRepeat(raw);
  const unitRle = rep ? rle(raw.slice(rep.start, rep.start + rep.len)) : [];
  const natural = unitRle.length >= 2 || (unitRle.length === 1 && !RUN[unitRle[0].op]);
  const whole = toks.length === 1 && (toks[0].op === 'k' || toks[0].op === 'p') && pass.end === 'row';
  if (whole) body = toks[0].op === 'k' ? 'Knit' : 'Purl';
  else if (rep && toks.length > 3 && (rep.reps >= 3 || (rep.reps >= 2 && rep.len >= 6)) && natural) {
    const pre = rle(raw.slice(0, rep.start));
    const unit = rle(raw.slice(rep.start, rep.start + rep.len));
    const post = rle(raw.slice(rep.start + rep.covered));
    const after = post.reduce((n, t) => n + t.n, 0);
    const parts = [];
    if (pre.length) parts.push(joinToks(pre));
    const tail = !post.length ? (pass.end === 'row' || pass.end === 'bindOff' ? 'to end' : `${rep.reps} times`)
      : (after > 0 && (pass.end === 'row' || pass.end === 'bindOff') ? (after === 1 ? 'to last st' : `to last ${after} sts`) : `${rep.reps - 1} more times`);
    parts.push(`*${joinToks(unit)}; rep from * ${tail}`);
    if (post.length) parts.push(joinToks(post));
    body = parts.join(', ');
  } else if (pass.end === 'row' || pass.end === 'bindOff') {
    // "k to last N sts": the longest plain run, when something fixed follows it.
    let at = -1;
    toks.forEach((t, i) => { if ((t.op === 'k' || t.op === 'p') && t.count >= 4 && (at < 0 || t.count > toks[at].count)) at = i; });
    if (at >= 0 && at < toks.length - 1) {
      const after = toks.slice(at + 1).reduce((n, t) => n + t.n, 0);
      const run = { ...toks[at], text: `${toks[at].op} to ${after === 1 ? 'last st' : `last ${after} sts`}` };
      body = joinToks([...toks.slice(0, at), run, ...toks.slice(at + 1)]);
    } else if (at === toks.length - 1 && at > 0) {
      body = joinToks([...toks.slice(0, at), { text: `${toks[at].op} to end` }]);
    } else body = joinToks(toks);
  } else body = joinToks(toks);
  let end = '';
  if (pass.end === 'turn') end = ', turn';
  else if (pass.end === 'wt') end = ', w&t';
  else if (pass.end === 'ds') end = ', turn, make DS';
  if (pass.kind === 'slide') end += ' (slide, do not turn)';
  const count = pass.endCount !== undefined && pass.endCount !== pass.startCount ? ` (${pass.endCount} sts)` : '';
  return { pass, body: `${body}${end}.`, count, text: `${body}${end}.${count}` };
}

function noun(pass, many) {
  if (pass.round) return many ? 'Rnds' : 'Rnd';
  if (pass.kind === 'short') return many ? 'Short rows' : 'Short row';
  return many ? 'Rows' : 'Row';
}

function lineFor(part) {
  const p = part.pass;
  return `${noun(p, false)} ${p.number}${p.round ? '' : ` (${p.side})`}: ${part.text}`;
}

/** One pass in US written form. */
export function writtenPass(s, pass) {
  const part = writtenParts(s, pass);
  return part ? lineFor(part) : null;
}

/** The whole pattern, US terms. */
export function written(s, piece) {
  const first = piece.log[0];
  const lines = [];
  const y = yarnName(s.yarns, first.yarn);
  lines.push(first.mode === 'round'
    ? `With ${y}, CO ${first.stitches} sts. Join to work in the round, being careful not to twist.`
    : `With ${y}, CO ${first.stitches} sts.`);
  const parts = s.passes.map((p) => writtenParts(s, p)).filter(Boolean);
  // Identical instructions match even when the count changes (a growing shawl).
  const key = (x) => `${x.pass.kind === 'slide' ? 's' : ''}${x.pass.round ? 'r' : x.pass.kind === 'short' ? 'h' : 'w'}|${x.body}|${x.count ? 'c' : ''}`;
  // Collapse what knitters would: identical rows become a range, a repeating
  // block of up to 12 rows is written once and then "Rep Rows a–b N more times."
  let i = 0;
  while (i < parts.length) {
    let best = null;
    for (let k = 1; k <= 12 && i + 2 * k <= parts.length; k++) {
      let r = 1;
      while (i + (r + 1) * k <= parts.length) {
        let same = true;
        for (let j = 0; j < k; j++) {
          const a = parts[i + j];
          const b = parts[i + r * k + j];
          if (key(a) !== key(b) || (!a.pass.round && a.pass.side !== b.pass.side && k > 1)) { same = false; break; }
        }
        if (!same) break;
        r++;
      }
      if (r >= 2 && (!best || r * k > best.r * best.k)) best = { k, r };
    }
    if (best && best.k === 1) {
      const a = parts[i].pass;
      const b = parts[i + best.r - 1].pass;
      const sides = new Set(parts.slice(i, i + best.r).map((x) => x.pass.side));
      const last = parts[i + best.r - 1];
      lines.push(`${noun(a, true)} ${a.number}\u2013${b.number}${!a.round && sides.size === 1 ? ` (${a.side})` : ''}: ${parts[i].body}${last.count ? ` (${last.pass.endCount} sts after Row ${b.number})` : ''}`);
      i += best.r;
    } else if (best) {
      for (let j = 0; j < best.k; j++) lines.push(lineFor(parts[i + j]));
      const a = parts[i].pass;
      const b = parts[i + best.k - 1].pass;
      lines.push(`Rep ${noun(a, true)} ${a.number}\u2013${b.number} ${best.r - 1} more time${best.r - 1 === 1 ? '' : 's'}.`);
      i += best.k * best.r;
    } else {
      lines.push(lineFor(parts[i]));
      i++;
    }
  }
  if (s.finished) lines.push('Fasten off. Weave in ends.');
  return lines;
}

// ---------------------------------------------------------------------------
// Reading a written row (US) into steps
// ---------------------------------------------------------------------------

const ALIASES = {
  k: 'k', knit: 'k', p: 'p', purl: 'p',
  'k1 tbl': 'ktbl', ktbl: 'ktbl', 'k tbl': 'ktbl', 'p1 tbl': 'ptbl', ptbl: 'ptbl', 'p tbl': 'ptbl',
  'sl 1 wyib': 'slwyib', 'sl1 wyib': 'slwyib', 'sl wyib': 'slwyib', 'sl 1': 'slwyib', sl1: 'slwyib', sl: 'slwyib',
  'sl 1 wyif': 'slwyif', 'sl1 wyif': 'slwyif', 'sl wyif': 'slwyif',
  yo: 'yo', m1l: 'm1l', m1: 'm1l', m1r: 'm1r', m1lp: 'm1lp', m1rp: 'm1rp', m1p: 'm1lp', lli: 'lli', rli: 'rli',
  kfb: 'kfb', pfb: 'pfb', 'k1, yo, k1 in next st': 'kyok',
  k2tog: 'k2tog', ssk: 'ssk', p2tog: 'p2tog', ssp: 'ssp', k3tog: 'k3tog', sssk: 'sssk', sk2p: 'sk2p',
  s2kp: 's2kp', s2kp2: 's2kp', cdd: 's2kp', p3tog: 'p3tog',
  '1/1 rc': 'rc11', rt: 'rc11', '1/1 lc': 'lc11', lt: 'lc11',
  '2/2 rc': 'rc22', c4b: 'rc22', '2/2 lc': 'lc22', c4f: 'lc22',
  '3/3 rc': 'rc33', c6b: 'rc33', '3/3 lc': 'lc33', c6f: 'lc33',
  '2/1 rpc': 'rpc21', '2/1 lpc': 'lpc21', '2/2 rpc': 'rpc22', '2/2 lpc': 'lpc22',
  sl1yo: 'sl1yo', 'sl1yo': 'sl1yo', brk: 'brk', brp: 'brp',
};

function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if ((ch === ',' || ch === ';') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseToken(tok) {
  const t = tok.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  let m;
  if ((m = /^(k|p|knit|purl) to end$/.exec(t))) return { toEnd: ALIASES[m[1]], leave: 0 };
  if ((m = /^(k|p|knit|purl) to last (?:(\d+) )?sts?$/.exec(t))) return { toEnd: ALIASES[m[1]], leave: m[2] ? +m[2] : 1 };
  if ((m = /^(bo|bind off) (\d+)(?: sts?)?$/.exec(t))) return { op: 'bo', n: +m[2] };
  if (t === 'bo' || t === 'bind off' || t === 'bo to end' || t === 'bind off all sts' || t === 'bo all sts') return { toEnd: 'bo', leave: 0 };
  if ((m = /^(co|cast on) (\d+)(?: sts?)?$/.exec(t))) return { op: 'co', n: +m[2] };
  if ((m = /^(?:with|join|change to|switch to) ([a-f])$/.exec(t))) return { yarn: m[1].toUpperCase() };
  if (t === 'pm' || t === 'place marker') return { pm: true };
  if (t === 'sm' || t === 'slip marker') return { skip: true };
  if (t === 'w&t' || t === 'wt' || t === 'wrap and turn') return { turn: 'wt' };
  if (t === 'turn') return { turn: 'turn' };
  if (t === 'make ds' || t === 'mds' || t === 'turn, make ds') return { turn: 'ds' };
  if ((m = /^(k|p)(\d+)$/.exec(t))) return { op: t[0], n: +m[2] };
  if ((m = /^(k|p)(\d+) tbl$/.exec(t))) return { op: m[1] === 'k' ? 'ktbl' : 'ptbl', n: +m[2] };
  if ((m = /^sl (\d+) (wyib|wyif)$/.exec(t)) || (m = /^sl(\d+) (wyib|wyif)$/.exec(t))) return { op: m[2] === 'wyib' ? 'slwyib' : 'slwyif', n: +m[1] };
  if ((m = /^(.+?) (\d+) times$/.exec(t)) && ALIASES[m[1]]) return { op: ALIASES[m[1]], n: +m[2] };
  if (ALIASES[t]) return { op: ALIASES[t], n: 1 };
  return { error: tok };
}

function parseSeq(parts) {
  const out = [];
  for (const raw of parts) {
    let m;
    const g = /^[([](.+)[)\]]\s*(?:x\s*(\d+)|(\d+)\s*times|to end|to last (?:(\d+) )?sts?)?$/i.exec(raw.trim());
    if (g) {
      const inner = parseSeq(splitTop(g[1]));
      if (inner.error) return inner;
      if (g[2] || g[3]) out.push({ group: inner.items, times: +(g[2] || g[3]) });
      else if (/to end/i.test(raw)) out.push({ group: inner.items, until: 0 });
      else if (/to last/i.test(raw)) out.push({ group: inner.items, until: g[4] ? +g[4] : 1 });
      else out.push({ group: inner.items, times: 1 });
      continue;
    }
    if ((m = /^(.*?)\s*$/.exec(raw))) {
      const tok = parseToken(m[1]);
      if (tok.error) return { error: tok.error };
      if (!tok.skip) out.push(tok);
    }
  }
  return { items: out };
}

/**
 * parseRow(text) -> {ok, plan} | {ok:false, error}. Understands US row
 * instructions: "k2, *p2, k2; rep from * to end", "*k1, yo, k2tog; rep from *
 * to last 3 sts, k3", "(k1, p1) 4 times", "[ssk, k2] x 3", "k to end",
 * "BO 4", "w&t", cables like "2/2 LC", brioche "sl1yo, brk".
 */
export function parseRow(text) {
  const src = String(text || '').trim().replace(/^(row|rnd|round)\s*\d*\s*(\((rs|ws)\))?\s*:\s*/i, '').replace(/\.$/, '');
  if (!src) return { ok: false, error: 'Type a row, for example: k2, *p2, k2; rep from * to end' };
  const star = src.indexOf('*');
  if (star >= 0) {
    const repM = /;?\s*rep(?:eat)? from \*\s*(to end|across|to last (?:(\d+) )?sts?|(\d+) (more )?times(?: more)?)/i.exec(src);
    if (!repM) return { ok: false, error: 'A * needs a "rep from *" to go with it.' };
    const before = src.slice(0, star);
    const unitText = src.slice(star + 1, repM.index);
    const after = src.slice(repM.index + repM[0].length);
    const pre = parseSeq(splitTop(before));
    const unit = parseSeq(splitTop(unitText));
    const post = parseSeq(splitTop(after));
    for (const x of [pre, unit, post]) if (x.error) return { ok: false, error: `I don't know "${x.error}" yet.` };
    const rep = /to end|across/i.test(repM[1]) ? { group: unit.items, until: 0 }
      : /to last/i.test(repM[1]) ? { group: unit.items, until: repM[2] ? +repM[2] : 1 }
        : { group: unit.items, times: (repM[4] || /times more/i.test(repM[0]) ? 1 : 0) + +repM[3] };
    return { ok: true, plan: [...pre.items, rep, ...post.items] };
  }
  const seq = parseSeq(splitTop(src));
  if (seq.error) return { ok: false, error: `I don't know "${seq.error}" yet.` };
  return { ok: true, plan: seq.items };
}

function consumeOf(items) {
  let n = 0;
  for (const it of items) {
    if (it.op) n += (STITCHES[it.op]?.consume ?? 0) * (it.n || 1);
    else if (it.group) n += consumeOf(it.group) * (it.times || 1);
  }
  return n;
}

/** Turns a parsed plan into log entries against the current state (simulated). */
export function planSteps(piece, plan) {
  const sim = build(piece);
  const out = [];
  const push = (e) => { const r = step(sim, e); if (r.ok) out.push(e); return r.ok; };
  const startPass = sim.passes.length;
  const sameRow = () => sim.passes.length === startPass && !sim.finished;
  const run = (items) => {
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (it.op) { for (let i = 0; i < (it.n || 1); i++) if (!push({ t: 'st', op: it.op })) return false; }
      else if (it.toEnd) {
        const per = STITCHES[it.toEnd].consume;
        while (sameRow() && remaining(sim) - it.leave >= per && remaining(sim) > 0) if (!push({ t: 'st', op: it.toEnd })) return false;
      } else if (it.pm) push({ t: 'pm' });
      else if (it.yarn) push({ t: 'yarn', id: it.yarn });
      else if (it.turn) { if (!push({ t: 'turn', kind: it.turn })) return false; }
      else if (it.group) {
        if (it.times !== undefined) { for (let i = 0; i < it.times; i++) if (!run(it.group)) return false; }
        else {
          // Leave room for what follows the repeat (or the "to last N").
          const tailNeed = it.until || consumeOf(items.slice(idx + 1));
          const per = consumeOf(it.group);
          if (per <= 0) return false;
          let guard = 0;
          while (sameRow() && remaining(sim) - tailNeed >= per && guard++ < 2000) if (!run(it.group)) return false;
        }
      }
    }
    return true;
  };
  const complete = run(plan);
  return { steps: out, complete };
}

// ---------------------------------------------------------------------------
// Layout: where each stitch sits, in stitch units (x) and rows (y)
// ---------------------------------------------------------------------------

/**
 * layout(s) -> {x: Float64Array, minX, maxX, maxY}. Cast-on stitches sit at
 * 0..n-1. Each later stitch starts at the mean of its parents' x (a decrease
 * pulls in, a cable crosses); increases and yarn overs slot between their
 * neighbours; then each pass is relaxed so neighbours keep at least one
 * stitch width apart, centred on where they wanted to be. Shaping therefore
 * shows as real shape: a triangle shawl widens, a hat crown narrows.
 */
export function layout(s) {
  const x = new Float64Array(s.cells.length).fill(NaN);
  let maxY = 0;
  s.cells.forEach((c) => { if (c.castOn && c.pass === -1) x[c.id] = c.id; });
  for (const pass of s.passes) {
    const ids = rsOrder(s, pass);
    if (!ids.length) continue;
    const want = ids.map((id) => {
      const c = s.cells[id];
      if (!c.parents.length) return NaN;
      const px = c.parents.map((p) => x[p]);
      if (c.top !== null && c.top !== undefined) return 0.35 * avg(px) + 0.65 * x[c.top];
      return avg(px);
    });
    // Fill increases between neighbours.
    for (let i = 0; i < want.length; i++) {
      if (!Number.isNaN(want[i])) continue;
      let a = i - 1; while (a >= 0 && Number.isNaN(want[a])) a--;
      let b = i + 1; while (b < want.length && Number.isNaN(want[b])) b++;
      const left = a >= 0 ? want[a] : null;
      const right = b < want.length ? want[b] : null;
      if (left !== null && right !== null) want[i] = left + ((right - left) * (i - a)) / (b - a);
      else if (left !== null) want[i] = left + (i - a);
      else if (right !== null) want[i] = right - (b - i);
      else want[i] = i;
    }
    const placed = settle(relax(want));
    ids.forEach((id, i) => { x[id] = placed[i]; maxY = Math.max(maxY, s.cells[id].y); });
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); }
  return { x, minX, maxX, maxY };
}

function avg(a) { return a.reduce((n, v) => n + v, 0) / a.length; }

/** Yarn tension: gaps wider than a stitch close by half (a decreased row draws in), centred where it was. */
function settle(xs) {
  if (xs.length < 2) return xs;
  const out = [xs[0]];
  for (let i = 1; i < xs.length; i++) out.push(out[i - 1] + 1 + (xs[i] - xs[i - 1] - 1) * 0.5);
  const shift = avg(xs) - avg(out);
  return out.map((v) => v + shift);
}

/** Keeps neighbours >= 1 apart with the least total movement (pool adjacent violators). */
function relax(want) {
  // Isotonic regression on want[i] - i, then add i back: the classic way to
  // enforce x[i+1] - x[i] >= 1 while staying as close as possible.
  const n = want.length;
  const v = want.map((w, i) => w - i);
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: v[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum; a.n += b.n; blocks.pop();
    }
  }
  const out = [];
  let i = 0;
  for (const b of blocks) for (let k = 0; k < b.n; k++, i++) out.push(b.sum / b.n + i);
  return out;
}

/** A pass's stitches in right-side left-to-right order (bound-off ones included). */
export function rsOrder(s, pass) {
  // Cells are recorded in work order; RS passes run right to left.
  const ids = pass.cells.slice();
  return pass.side === 'RS' ? ids.reverse() : ids;
}
