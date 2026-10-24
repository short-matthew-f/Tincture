// The Tangle Basket: level generation (pure; used at authoring time by
// gen-levels.mjs and by the tests). No window/document/Date.now/Math.random.
//
// GEOMETRY (makeHeap). Strands are laid one at a time, each a steered walk
// (control points about 7 units apart, a slowly drifting turn, and in loopy
// baskets now and then a sustained curl: a loop, or curling back the other way,
// a figure-eight). At each step the walk tries turns near the one it wants and
// keeps the first whose next stretch either stays clear of all yarn or closes
// in on a strand until they clearly lie on each other (a crossing, or a short
// stretch lying along it); it may backtrack a little, or end early. The
// finished strand is then checked properly, from both strands' sides:
//   - it stays on the board and never bends tighter than R_MIN (no kinks);
//   - wherever two strands (or one strand and itself) come closer than APART,
//     their centerlines come within OVER_MAX: no near-miss slivers, so what she
//     sees and the rule always agree;
//   - a strand's loop crossing (drawn as a patch) keeps clear of its other
//     crossings; a tip either keeps clear of other yarn or lies well on it
//     (only in baskets with tucks), and pegs keep clear of other yarn.
// Among a few good candidates, the one nearest the wanted number of crossings
// wins (loopy baskets also like loops, and crossing a neighbor more than once).
//
// OVER AND UNDER (dealLevel). Snarls are chosen first, from the geometry: a
// pair that crosses more than once, or three strands that cross each other.
// The strands then get a bottom-to-top order, with each snarl kept together as
// one block (so nothing can sit between its strands) and every tip resting on
// a strand either on top (an end resting across) or, for `tucks` of them,
// underneath (a tuck). Several orders are tried; the one nearest the wanted
// depth whose snarl crossings can be turned cleanly wins. By default the later
// strand lies on top; each snarl turns one crossing (a pair), or every crossing
// between its bottom and top strands (a ring of three). The rings of the
// "lies over" graph are then checked to be exactly those snarls, so no other
// cycle exists anywhere. Then colors, two-color strands, pins, peg colors and
// buried colors are dealt, and gen-levels.mjs keeps the deal whose
// random-player clear rate is nearest the level's target (solver-verified).
import {
  W, TOUCH, SELF_GAP, SPOOL, splineIdx, arcLengths, gridOf, nearIdx, nearDist, minRadius, bboxOf, tangentAt, patchLen,
  buildLevel, sccs, acyclic, clearsWithRoom, dependencyCycles, mulberry,
} from './rules.js';

export const APART = 1.1;    // two strands either keep this far apart (x W)...
export const OVER_MAX = 0.55; // ...or clearly lie on each other: centerlines this close (x W)
export const END_CLEAR = 1.5; // crossings keep this far (x W) from strand ends
export const R_MIN = 0.75;    // tightest bend (x W): the inner edge never folds
export const PEG_R = 1.05;    // a strand wraps a peg at this radius (x W)
export const PEG_CLEAR = 1.3; // other yarn keeps this far from a peg (x W)
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const PAD = W / 2 + 1.2; // centerline keeps this far from the board edge

// Colors in the order levels bring them in (friendly, high-contrast ones first).
export const COLOR_ORDER = ['m', 'i', 'w', 'g', 'c', 'n', 'o', 'l'];

// ---------- one strand ----------

// A spatial hash of every sample already on the board, for steering.
const HC = W;
const hkey = (gx, gy) => (gx + 64) * 8192 + (gy + 64);
function hashAdd(H, j, poly) {
  poly.forEach((p, k) => {
    const key = hkey(Math.floor(p[0] / HC), Math.floor(p[1] / HC));
    let a = H.get(key);
    if (!a) H.set(key, (a = []));
    a.push(j, k);
  });
}
function hashRemove(H, j) {
  for (const [key, a] of H) {
    const b = [];
    for (let t = 0; t < a.length; t += 2) if (a[t] !== j) b.push(a[t], a[t + 1]);
    if (b.length) H.set(key, b); else H.delete(key);
  }
}
// Nearest sample of each strand within R of p: Map j -> { d, k }.
function hashNear(H, S, p, R) {
  const out = new Map();
  const g = Math.ceil(R / HC), gx = Math.floor(p[0] / HC), gy = Math.floor(p[1] / HC);
  for (let dx = -g; dx <= g; dx++) for (let dy = -g; dy <= g; dy++) {
    const a = H.get(hkey(gx + dx, gy + dy));
    if (!a) continue;
    for (let t = 0; t < a.length; t += 2) {
      const j = a[t], k = a[t + 1], q = S[j].poly[k];
      const d = Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
      if (d > R) continue;
      const o = out.get(j);
      if (!o || d < o.d) out.set(j, { d, k });
    }
  }
  return out;
}
const SIN_STEER = Math.sin((50 * Math.PI) / 180);

/**
 * A steered walk. At every step it wants a turn (a slow drift, or a curl that
 * makes a loop or a figure-eight), tries turns near it, and keeps the first
 * whose next segment either keeps clear of all yarn, or heads steeply across
 * one strand, away from its ends, its other crossings and any peg. If no turn
 * works, the strand simply ends there.
 */
function steerWalk(rng, ctx, { len, start, heading, step = 7, loop = 0, board, peg = false, partner = -1, tips = false }) {
  const { S, H, pegList } = ctx;
  const lo = PAD + 1.5, hiX = board.w - PAD - 1.5, hiY = board.h - PAD - 1.5;
  const maxTurn = 0.4 + 0.2 * loop;
  let [x, y] = start;
  let h = heading, turn = (rng() - 0.5) * 0.3, curl = 0, curlTurn = 0, lastSign = rng() < 0.5 ? -1 : 1;
  const ctrl = [[r1(x), r1(y)]];
  const own = [[x, y]], ownS = [0]; // my path so far, every unit
  const mine = []; // my crossings: { s, r }
  let contacts = new Map(); // strands the walk is touching right now (-1: itself)
  let s = 0, pegAt = null;
  const wrapFrom = peg ? len * (0.3 + rng() * 0.25) : Infinity;
  const ownNear = (p, sQ) => {
    let best = Infinity, bk = -1;
    for (let k = 0; k < own.length; k++) {
      if (ownS[k] > sQ - SELF_GAP - 1) break;
      const d = Math.sqrt((own[k][0] - p[0]) ** 2 + (own[k][1] - p[1]) ** 2);
      if (d < best) { best = d; bk = k; }
    }
    return { d: best, k: bk };
  };
  // Is the straight segment from (x, y) at heading hh, `step` long, fine?
  // Returns { found, open } (new crossings, and the contacts still open), or null.
  // A contact opens when the walk comes within APART of a strand; it must then
  // close in on it until they clearly lie on each other ("deep"), and may only
  // leave once deep. Coming close and veering off is a near miss: not allowed.
  const tryStep = (hh) => {
    const dx = Math.cos(hh), dy = Math.sin(hh);
    const found = [];
    const open = new Map([...contacts].map(([j, c]) => [j, { ...c }]));
    const meet = (j, d, sQ, endsNear, spacingBad) => {
      let c = open.get(j);
      if (!c) {
        if (endsNear) return false;
        c = { deep: false, dPrev: d, risen: false, dMax: 0 };
        open.set(j, c);
      } else if (!c.deep && d > c.dPrev + 0.25) return false; // veering off before lying on it
      c.seen = sQ;
      if (!c.deep) c.dPrev = Math.min(c.dPrev, d);
      if (!c.deep && d < OVER_MAX * W - 0.6) {
        if (endsNear || spacingBad()) return false;
        c.deep = true; c.sDeep = sQ; c.dMax = d;
        return 'deep';
      }
      if (c.deep) {
        // leaving: once it starts to lift off, it keeps lifting off (one clean contact)
        if (d > TOUCH * W - 0.5) c.risen = true;
        if (c.risen && d < c.dMax - 0.2) return false;
        c.dMax = Math.max(c.dMax, d);
        if (sQ - c.sDeep > 3.8 * W) return false; // lying along too long
      }
      return true;
    };
    // a strand's tip near the walk must end up clearly clear of it, or clearly on it
    const tipCheck = (j, c, Q) => {
      const B = S[j];
      for (const e of [0, B.poly.length - 1]) {
        const p = B.poly[e], d = Math.hypot(p[0] - Q[0], p[1] - Q[1]);
        const key = e ? 't1' : 't0';
        c[key] = Math.min(c[key] ?? Infinity, d);
      }
    };
    const tipsOk = (c) => [c.t0, c.t1].every((d) => d === undefined || d > APART * W + 0.4 || (tips && d < OVER_MAX * W - 0.6));
    for (let t = 1; t <= 7; t++) {
      const f = (step * t) / 7, sQ = s + f;
      const Q = [x + dx * f, y + dy * f];
      if (Q[0] < lo || Q[0] > hiX || Q[1] < lo || Q[1] > hiY) return null;
      for (const pg of pegList) if (Math.hypot(Q[0] - pg.x, Q[1] - pg.y) < PEG_CLEAR * W + 0.6) return null;
      const near = hashNear(H, S, Q, APART * W + 0.3);
      for (const [j, { d, k }] of near) {
        if (j === partner && sQ < 2.5 * W) continue; // the knot itself
        const B = S[j], cb = B.cum;
        const endsNear = !!B.wrap && cb[k] > B.wrap[0] - END_CLEAR * W && cb[k] < B.wrap[1] + END_CLEAR * W;
        // only a loop's crossing needs room around it (it is drawn as a patch)
        const bad = () => B.xs.some((xx) => xx.o === j && Math.abs(xx.s - cb[k]) < xx.r + 1.15 * W + 0.6) || mine.concat(found).some((yy) => yy.j === -1 && Math.abs(yy.s - sQ) < yy.r + 1.15 * W + 0.6);
        const m = meet(j, d, sQ, endsNear, bad);
        if (!m) return null;
        if (m === 'deep') found.push({ s: sQ, r: 1.15 * W, j });
        if (k < 12 || k > B.poly.length - 13) tipCheck(j, open.get(j), Q);
      }
      const o = ownNear(Q, sQ);
      if (o.d < APART * W + 0.3) {
        if (!loop) return null;
        const os = ownS[o.k];
        const bad = () => mine.concat(found).some((yy) => Math.abs(yy.s - sQ) < yy.r + 1.15 * W + 0.6 || Math.abs(yy.s - os) < yy.r + 1.15 * W + 0.6);
        const m = meet(-1, o.d, sQ, os < 2 * W, bad);
        if (!m) return null;
        if (m === 'deep') found.push({ s: sQ, r: 1.15 * W, j: -1 }, { s: os, r: 1.15 * W, j: -1 });
      }
      for (const [j, c] of open) if (c.seen !== sQ) { if (!c.deep || (j >= 0 && !tipsOk(c))) return null; open.delete(j); }
    }
    return { found, open };
  };
  const advance = (hh) => {
    const dx = Math.cos(hh), dy = Math.sin(hh);
    for (let t = 1; t <= 7; t++) { const f = (step * t) / 7; own.push([x + dx * f, y + dy * f]); ownS.push(s + f); }
    x += dx * step; y += dy * step; s += step; h = hh;
    ctrl.push([r1(x), r1(y)]);
  };
  const OFFS = [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.58, -0.58, 0.78, -0.78];
  const stack = [];
  stack.floor = 0;
  let budget = Math.ceil(len / step) * 14, stuck = false;
  const save = () => ({ x, y, h, s, turn, curl, curlTurn, lastSign, nc: ctrl.length, no: own.length, nm: mine.length, contacts });
  const restore = (st) => {
    ({ x, y, h, s, turn, curl, curlTurn, lastSign } = st);
    ctrl.length = st.nc; own.length = st.no; ownS.length = st.no; mine.length = st.nm; contacts = st.contacts;
  };
  while (s < len) {
    if (peg && !pegAt && s >= wrapFrom) {
      // wrap round a peg: a 200-degree arc about a center to one side, all of it clear
      const sg = rng() < 0.5 ? -1 : 1, rw = PEG_R * W;
      const cx = x - Math.sin(h) * rw * sg, cy = y + Math.cos(h) * rw * sg;
      const a0 = Math.atan2(y - cy, x - cx), sweep = sg * (Math.PI + 0.45), m = 5;
      const arc = [];
      for (let j = 1; j <= m; j++) { const a = a0 + (sweep * j) / m; arc.push([cx + Math.cos(a) * rw, cy + Math.sin(a) * rw]); }
      const clear = (p) => p[0] > lo && p[0] < hiX && p[1] > lo && p[1] < hiY && hashNear(H, S, p, APART * W + 1.5).size === 0 && pegList.every((pg) => Math.hypot(p[0] - pg.x, p[1] - pg.y) > PEG_CLEAR * W + rw);
      if (clear([cx, cy]) && hashNear(H, S, [cx, cy], PEG_CLEAR * W + 1).size === 0 && arc.every(clear)) {
        for (const p of arc) {
          const seg = Math.hypot(p[0] - x, p[1] - y);
          for (let t = 1; t <= 4; t++) { own.push([x + ((p[0] - x) * t) / 4, y + ((p[1] - y) * t) / 4]); ownS.push(s + (seg * t) / 4); }
          s += seg; x = p[0]; y = p[1];
          ctrl.push([r1(x), r1(y)]);
        }
        h = a0 + sweep + (sg * Math.PI) / 2;
        pegAt = { x: r1(cx), y: r1(cy), s0: s - rw * Math.abs(sweep), s1: s };
        turn = 0; curl = 0;
        stack.length = 0; stack.floor = 0; // no stepping back through the wrap
        continue;
      }
    }
    let want;
    if (curl > 0) { want = curlTurn; curl--; } else {
      turn = clamp(turn * 0.85 + (rng() - 0.5) * 0.42, -maxTurn, maxTurn);
      want = turn;
      if (loop > 0 && s > step * 1.5 && s < len - step * 3 && rng() < loop * 0.16) {
        // a loop: about one full turn; the next often curls the other way (a
        // figure-eight). The strand runs on long enough for the loop to close.
        const sign = rng() < 0.6 ? -lastSign : lastSign;
        lastSign = sign;
        curl = 6 + Math.floor(rng() * 3);
        curlTurn = sign * (0.8 + rng() * 0.2);
        want = curlTurn;
        len = Math.max(len, s + step * (curl + 3));
      }
    }
    // near an edge, lean back toward the middle
    const ahead = [x + Math.cos(h + want) * step * 3, y + Math.sin(h + want) * step * 3];
    if (ahead[0] < lo + 4 || ahead[0] > hiX - 4 || ahead[1] < lo + 4 || ahead[1] > hiY - 4) {
      let dd = Math.atan2(board.h / 2 - y, board.w / 2 - x) - h;
      while (dd > Math.PI) dd -= 2 * Math.PI;
      while (dd < -Math.PI) dd += 2 * Math.PI;
      want = clamp(want + Math.sign(dd) * 0.45, -1, 1);
      curl = 0;
    }
    // try turns near the wanted one; if none works, step back and try that
    // step's next choice (a little backtracking, within a budget)
    let frame = { want, offs: OFFS.slice(), st: save() };
    for (;;) {
      let moved = false;
      while (frame.offs.length && budget-- > 0) {
        const tt = clamp(frame.want + frame.offs.shift(), -0.95, 0.95);
        const f = tryStep(h + tt);
        if (!f) continue;
        stack.push(frame);
        for (const c of f.found) mine.push(c);
        contacts = f.open;
        advance(h + tt);
        if (curl === 0) turn = clamp(tt, -maxTurn, maxTurn);
        moved = true;
        break;
      }
      if (moved) break;
      if (budget <= 0 || !stack.length || stack.length < stack.floor) { stuck = true; break; }
      frame = stack.pop();
      restore(frame.st);
    }
    if (stuck) break;
  }
  if (stuck && stack.length) restore(stack[stack.length - 1].st); // keep only steps that led somewhere
  if (s < len * 0.6 || ctrl.length < 3 || (peg && !pegAt)) return null;
  return { ctrl, peg: pegAt };
}

function shape(ctrl) {
  const { poly, idx } = splineIdx(ctrl);
  const cum = arcLengths(poly);
  return { ctrl, poly, cum, idx, grid: gridOf(poly), box: bboxOf(poly) };
}
// The strand cut to samples [k0, k1]: control points inside, plus the cut ends.
function cut(A, k0, k1) {
  const ctrl = [];
  if (k0 > 0) ctrl.push([r1(A.poly[k0][0]), r1(A.poly[k0][1])]);
  A.ctrl.forEach((p, j) => { const k = A.idx[j]; if (k >= k0 + (k0 > 0 ? 3 : 0) && k <= k1 - (k1 < A.poly.length - 1 ? 3 : 0)) ctrl.push(p); });
  if (k1 < A.poly.length - 1) ctrl.push([r1(A.poly[k1][0]), r1(A.poly[k1][1])]);
  return ctrl.length >= 3 ? shape(ctrl) : null;
}
// A new strand's free ends must not stop in a near miss: each tip either
// keeps clear of other yarn or lies well on it. Trim an end back until it does.
function trimEnds(A, S, skip, keepStart, keepEnd, tips) {
  const n = A.poly.length;
  const D = new Float64Array(n).fill(Infinity);
  for (let j = 0; j < S.length; j++) {
    if (j === skip) continue;
    const B = S[j];
    if (!boxesNear(A.box, B.box, APART * W + 1)) continue;
    for (let k = 0; k < n; k++) { const d = nearDist(A.poly[k], B.poly, B.grid); if (d < D[k]) D[k] = d; }
  }
  const good = (k) => (D[k] > APART * W + 0.35 || (tips && D[k] < OVER_MAX * W - 0.45)) && selfNear(A, k).d > APART * W + 0.35;
  let k0 = 0, k1 = n - 1;
  if (!keepStart) while (k0 < n - 1 && !good(k0)) k0++;
  if (!keepEnd) while (k1 > 0 && !good(k1)) k1--;
  if (k1 <= k0 || A.cum[k1] - A.cum[k0] < 0.6 * A.cum[n - 1]) return null;
  if (k0 === 0 && k1 === n - 1) return A;
  return cut(A, k0, k1);
}

const inBounds = (poly, board) => poly.every(([x, y]) => x >= PAD && x <= board.w - PAD && y >= PAD && y <= board.h - PAD);
const boxesNear = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

// Nearest sample of a strand to its own sample k, skipping its neighbors along the arc.
function selfNear(S, k) {
  const p = S.poly[k], C = 2 * W;
  const gx = Math.floor(p[0] / C), gy = Math.floor(p[1] / C);
  let best = Infinity, bj = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = S.grid.get((gx + dx + 64) * 4096 + (gy + dy + 64));
    if (!a) continue;
    for (const j of a) {
      if (Math.abs(S.cum[j] - S.cum[k]) < SELF_GAP) continue;
      const q = S.poly[j];
      const d = Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
      if (d < best) { best = d; bj = j; }
    }
  }
  return { d: best, k: bj };
}

/**
 * Where strand A meets strand B (or itself, when B === A), as clean
 * crossings: [{ ka, kb, sa, sb, ra, rb, x, y, tipA, tipB }] (ra/rb: the
 * patch half-length along A and along B; tipA/tipB: 0 or 1 when that strand's
 * start or end tip lies in the meeting, else -1), or null if any meeting is a
 * near-miss sliver. tips: whether a tip may rest on another strand at all.
 */
export function meetings(A, B, { why = null, tips = false } = {}) {
  const no = (r) => { if (why) why[r] = (why[r] || 0) + 1; return null; };
  const self = A === B;
  const pa = A.poly, ca = A.cum, n = pa.length, la = ca[n - 1];
  const pb = B.poly, cb = B.cum, lb = cb[cb.length - 1];
  const D = new Float64Array(n), J = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const r = self ? selfNear(A, k) : nearIdx(pa[k], pb, B.grid);
    D[k] = r.d; J[k] = r.k;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    if (!(D[k] < APART * W)) continue;
    let e = k, km = k;
    while (e + 1 < n && D[e + 1] < APART * W) { e++; if (D[e] < D[km]) km = e; }
    const s0 = k, s1 = e;
    k = e;
    if (D[km] > OVER_MAX * W) return no('graze'); // a near miss, not clearly on top
    let blocks = 0, inT = false, t0 = -1, t1 = -1;
    for (let t = s0; t <= s1; t++) { const on = D[t] < TOUCH * W; if (on && !inT) { blocks++; t0 = t; } if (on) t1 = t; inT = on; }
    if (blocks !== 1) return no('blocks');
    const kb = J[km];
    // a tip inside the meeting must lie well on (or under) the other strand,
    // and only where tips may rest on yarn at all
    const tipA = s0 === 0 ? 0 : s1 === n - 1 ? 1 : -1;
    if (tipA >= 0 && (self || !tips || D[tipA ? n - 1 : 0] > OVER_MAX * W)) return no('tipA');
    const ta = tangentAt(pa, km), tb = tangentAt(pb, kb);
    const sin = Math.max(0.05, Math.abs(ta[0] * tb[1] - ta[1] * tb[0]));
    const ra = patchLen(sin, Math.max(ca[km] - ca[t0], ca[t1] - ca[km]));
    const rb = patchLen(sin, Math.max(Math.abs(cb[J[t0]] - cb[kb]), Math.abs(cb[J[t1]] - cb[kb])));
    if (ra > 5.6 * W || rb > 5.6 * W) return no('long');
    if (self && kb < km) continue; // validated; counted from its first pass
    let tipB = -1;
    if (!self) for (const [tk, tv] of [[0, 0], [pb.length - 1, 1]]) for (let q = s0; q <= s1; q++) if (Math.hypot(pa[q][0] - pb[tk][0], pa[q][1] - pb[tk][1]) < APART * W) { tipB = tv; break; }
    if (tipA >= 0 && tipB >= 0) return no('tips'); // two tips in one meeting
    out.push({ ka: km, kb, sa: ca[km], sb: cb[kb], ra, rb, x: (pa[km][0] + pb[kb][0]) / 2, y: (pa[km][1] + pb[kb][1]) / 2, tipA, tipB });
  }
  if (!self) for (const e of [0, pb.length - 1]) { const d = nearDist(pb[e], pa, A.grid); if (d < APART * W && (!tips || d > OVER_MAX * W)) return no('tipB'); } // B's tip in a near miss, or resting where tips may not
  return out;
}

// Do a strand's loop crossings keep apart from its other crossings? Each
// loop crossing is drawn as a patch (the top pass painted again), which must
// not reach another crossing. list: [{ s, r, o }] along strand `owner`.
function spaced(list, owner) {
  const a = list.slice().sort((x, y) => x.s - y.s);
  for (let k = 0; k < a.length; k++) {
    if (a[k].o !== owner) continue;
    for (let t = 0; t < a.length; t++) if (t !== k && Math.abs(a[t].s - a[k].s) < a[k].r + a[t].r && !(a[t].o === owner && Math.abs(a[t].s - a[k].s) < 1e-9)) return false;
  }
  return true;
}

/**
 * makeHeap(rng, opts) -> { ctrl: [[[x,y]...]], knots: [[a,b]], pegs: [{ s, x, y }], board } or null
 * opts: n strands; len [min, max]; cross: wanted crossings per strand; loop: 0 (gentle) to 1 (loopy);
 * knots: knotted pairs (each placed one after the other); pegs; tips: how many
 * strand tips may rest on another strand (from the tuck basket on); board: { w, h }.
 */
export function makeHeap(rng, { n, len = [55, 85], cross = 2, loop = 0, knots = 0, pegs = 0, tips: tipBudget = 0, tries = 80, center = 0.85, board = { w: 100, h: 140 }, why = null } = {}) {
  const no = (r) => { if (why) why[r] = (why[r] || 0) + 1; };
  let tipsUsed = 0;
  const S = []; // placed strands: { ctrl, poly, cum, grid, box, xs: [{ s, r, o }], peg, wrap }
  const pegList = [];
  const H = new Map();
  const ctx = { S, H, pegList };
  const knotAt = new Set();
  for (let k = 0; k < knots; k++) {
    for (let t = 0; t < 50; t++) {
      const a = 1 + Math.floor(rng() * (n - 2));
      if (knotAt.has(a) || knotAt.has(a + 1) || knotAt.has(a - 1) || knotAt.has(a + 2)) continue;
      knotAt.add(a);
      break;
    }
  }
  const knotList = [...knotAt].sort((a, b) => a - b).map((a) => [a, a + 1]);
  const inKnot = new Set(knotList.flat());
  const pegAt = new Set();
  for (let t = 0; t < 200 && pegAt.size < pegs; t++) {
    const s = 2 + Math.floor(rng() * (n - 3));
    if (!inKnot.has(s)) pegAt.add(s);
  }
  let pairRetries = 0;
  for (let i = 0; i < n; i++) {
    const knotted = knotList.find(([, b]) => b === i);
    const pairStart = knotList.some(([a]) => a === i);
    const partner = knotted ? i - 1 : pairStart ? i + 1 : -1;
    // loops go down first, while there is room for them; later strands curl less
    const myLoop = knotted || pairStart || pegAt.has(i) ? 0 : Math.min(1, loop * (i < n * 0.35 ? 1.3 : 0.4));
    const tips = tipsUsed < tipBudget;
    let best = null, found = 0;
    for (let t = 0; t < tries && found < 6; t++) {
      const L = len[0] + rng() * (len[1] - len[0]);
      let start, heading;
      if (knotted) {
        const pc = S[i - 1].ctrl, e = pc[pc.length - 1], f = pc[pc.length - 2];
        start = e; heading = Math.atan2(e[1] - f[1], e[0] - f[0]) + (rng() - 0.5) * 0.7;
      } else {
        // somewhere clear to start
        start = null;
        for (let u = 0; u < 80 && !start; u++) {
          const wide = u > 25 ? 1 : center;
          const sx = board.w / 2 + (rng() + rng() - 1) * board.w * 0.5 * wide;
          const sy = board.h / 2 + (rng() + rng() - 1) * board.h * 0.5 * wide;
          const p = [clamp(sx, PAD + 3, board.w - PAD - 3), clamp(sy, PAD + 3, board.h - PAD - 3)];
          if (hashNear(H, S, p, APART * W + 2).size === 0 && pegList.every((pg) => Math.hypot(p[0] - pg.x, p[1] - pg.y) > PEG_CLEAR * W + 2)) start = p;
        }
        if (!start) { no('start'); continue; }
        heading = Math.atan2(board.h / 2 - start[1], board.w / 2 - start[0]) + (rng() - 0.5) * 3.4;
      }
      const wk = steerWalk(rng, ctx, { len: pairStart || knotted ? L * 0.65 : L, start, heading, loop: myLoop, board, peg: pegAt.has(i), partner: knotted ? i - 1 : -1, tips });
      if (!wk) { no('walk'); continue; }
      let A = shape(wk.ctrl);
      if (!inBounds(A.poly, board)) { no('bounds'); continue; }
      if (minRadius(A.poly, A.cum) < R_MIN * W) { no('bend'); continue; }
      if (!wk.peg) {
        // (a pair's knot sits somewhere clear)
        for (let r = 0; r < 3 && A; r++) { const B = trimEnds(A, S, partner, !!knotted, false, tips && !pairStart); if (B === A) break; A = B; }
        if (!A) { no('trim'); continue; }
        if (minRadius(A.poly, A.cum) < R_MIN * W) { no('bend2'); continue; }
      }
      A.peg = wk.peg;
      const sw = why ? {} : null;
      const selfX = meetings(A, A, { why: sw });
      if (!selfX) { no('self'); if (why) for (const k in sw) no('self.' + k); continue; }
      if (myLoop === 0 && selfX.length) { no('loop'); continue; }
      if (knotted) {
        // the joined pair runs clean as one strand, with no loop across the knot
        const P = S[i - 1];
        const both = shape(P.ctrl.concat(A.ctrl.slice(1)));
        const bx = meetings(both, both);
        if (!bx || bx.length) { no(bx ? "knotLoop" : "knotJoin"); continue; }
      }
      // the peg: clear of other yarn, and of this strand away from its wrap
      if (A.peg) {
        const pp = [A.peg.x, A.peg.y];
        let ok = true;
        for (const B of S) if (nearDist(pp, B.poly, B.grid) < PEG_CLEAR * W) { ok = false; break; }
        if (!ok) continue;
        let runs = 0, inR = false;
        for (const q of A.poly) { const on = Math.hypot(q[0] - pp[0], q[1] - pp[1]) < PEG_CLEAR * W; if (on && !inR) runs++; inR = on; }
        if (runs !== 1) continue;
      }
      let ok = true;
      for (const pg of pegList) if (nearDist([pg.x, pg.y], A.poly, A.grid) < PEG_CLEAR * W) { ok = false; break; }
      if (!ok) continue;
      const mine = selfX.flatMap((m) => [{ s: m.sa, r: m.ra, o: i }, { s: m.sb, r: m.rb, o: i }]);
      const theirs = [];
      let crosses = 0, multi = 0, tipN = 0;
      for (let j = 0; j < i && ok; j++) {
        if (j === partner) continue;
        const B = S[j];
        if (!boxesNear(A.box, B.box, APART * W + 1)) continue;
        const ms = meetings(A, B, { why, tips });
        if (!ms) { ok = false; no('pair'); break; }
        // the same meetings seen from the other strand (the game walks either one)
        const back = meetings(B, A, { why, tips });
        if (!back || back.length !== ms.length) { ok = false; no('pairBack'); break; }
        if (!ms.length) continue;
        crosses += ms.length;
        tipN += ms.filter((m) => m.tipA >= 0 || m.tipB >= 0).length;
        if (ms.length > 1) multi++;
        for (const m of ms) { mine.push({ s: m.sa, r: m.ra, o: j }); theirs.push([j, { s: m.sb, r: m.rb, o: i }]); }
      }
      if (!ok) continue;
      if (tipsUsed + tipN > tipBudget) { no('tipBudget'); continue; }
      if (!spaced(mine, i)) { no('spaceA'); continue; }
      const byJ = new Map();
      for (const [j, x] of theirs) { if (!byJ.has(j)) byJ.set(j, S[j].xs.slice()); byJ.get(j).push(x); }
      for (const [j, list] of byJ) {
        if (!spaced(list, j)) { ok = false; break; }
        // no crossing on the wrap round a peg
        if (S[j].wrap && list.some((x) => x.s > S[j].wrap[0] - END_CLEAR * W && x.s < S[j].wrap[1] + END_CLEAR * W)) { ok = false; break; }
      }
      if (!ok) { no('spaceB'); continue; }
      if (A.peg) {
        const pp = [A.peg.x, A.peg.y];
        let w0 = Infinity, w1 = -Infinity;
        A.poly.forEach((q, k) => { if (Math.hypot(q[0] - pp[0], q[1] - pp[1]) < PEG_CLEAR * W) { w0 = Math.min(w0, A.cum[k]); w1 = Math.max(w1, A.cum[k]); } });
        A.wrap = [w0, w1];
        if (mine.some((x) => x.s > w0 - END_CLEAR * W && x.s < w1 + END_CLEAR * W)) continue;
      }
      found++;
      const want = Math.min(cross, i);
      const score = -Math.abs(crosses - want) + (loop ? 0.6 * multi + 1.2 * Math.min(2, selfX.length) : 0) + rng() * 0.8 + (i > 1 && crosses === 0 ? -2 : 0);
      if (!best || score > best.score) best = { score, A, mine, byJ, tipN };
    }
    if (!best && knotted && pairRetries < 6) {
      // the knot landed somewhere crowded: lay the pair's first strand again
      pairRetries++;
      const P = S.pop();
      hashRemove(H, i - 1);
      tipsUsed -= P.tipN || 0;
      for (const B of S) B.xs = B.xs.filter((x) => x.o !== i - 1);
      i -= 2;
      continue;
    }
    if (!best) { no(`fail@${i}`); if (why) why.partial = S.map((A) => A.ctrl); return null; }
    const A = best.A;
    tipsUsed += best.tipN;
    A.tipN = best.tipN;
    A.xs = best.mine;
    for (const [j, list] of best.byJ) S[j].xs = list;
    S.push(A);
    hashAdd(H, i, A.poly);
    if (A.peg) pegList.push({ s: i, x: A.peg.x, y: A.peg.y });
  }
  return { ctrl: S.map((A) => A.ctrl), knots: knotList, pegs: pegList, board: { ...board } };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// Longest chain of crossings, one strand above the next, for an order.
function depthFor(n, pairs, rank) {
  const up = Array.from({ length: n }, () => []);
  for (const [a, b] of pairs) { if (rank[a] < rank[b]) up[a].push(b); else up[b].push(a); }
  const memo = Array(n).fill(-1);
  const byRank = [...Array(n).keys()].sort((a, b) => rank[b] - rank[a]);
  for (const i of byRank) { let d = 0; for (const j of up[i]) d = Math.max(d, 1 + memo[j]); memo[i] = d; }
  return Math.max(0, ...memo);
}

/**
 * dealLevel(heap, rng, opts) -> level def { board, strands, knots, pins, pegs, flips, snarls }, unchecked for the rack.
 * opts: colors; vari (two-color strands); pins; buried (share of covered strands shown gray);
 * snarl2 / snarl3 (how many snarls of two and of three strands); depth (wanted).
 */
export function dealLevel(heap, rng, { colors = 3, vari = 0, pins = 0, buried = 0, snarl2 = 0, snarl3 = 0, depth = 0, tucks = 0, why = null } = {}) {
  const no = (r) => { if (why) why[r] = (why[r] || 0) + 1; return null; };
  const n = heap.ctrl.length;
  const base = buildLevel({ id: 'tmp', name: 'tmp', board: [heap.board.w, heap.board.h], strands: heap.ctrl.map((c) => ({ c: 'm', p: c.flat() })), knots: heap.knots });
  const byPair = new Map();
  for (const c of base.cross) if (!c.self) { const k = `${c.a}.${c.b}`; if (!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(c); }
  const pairOf = (x, y) => byPair.get(`${Math.min(x, y)}.${Math.max(x, y)}`) || [];
  // A crossing can be turned over only if it holds no tip, and it is clear of
  // the crossings where the strand it raises lies under something (it is
  // drawn as a patch of that strand, which must not reach them). That depends
  // on the order, so it is checked for each order tried (rank: old strand -> place).
  const noTip = (c) => c.tipA < 0 && c.tipB < 0;
  const clearFor = (c, top, rank) => {
    const cu = base.cum[top], at = cu[c.a === top ? c.ka : c.kb], r = c.a === top ? c.ra : c.rb;
    return base.crossOf[top].every((o) => {
      if (o === c) return true;
      if (!o.self && rank[o.a === top ? o.b : o.a] < rank[top]) return true; // top lies over that one anyway
      const spots = o.self ? [[o.ka, o.ra], [o.kb, o.rb]] : [[o.a === top ? o.ka : o.kb, o.a === top ? o.ra : o.rb]];
      return spots.every(([k, ro]) => Math.abs(cu[k] - at) >= r + ro + 0.3 * W);
    });
  };
  // 1. snarls, chosen from the geometry. Each is kept as one block in the
  // order below (its strands one right above the other), so no other strand
  // can sit between them and the ring is exactly the snarl.
  const busy = new Set([...heap.knots.flat(), ...heap.pegs.map((p) => p.s)]);
  // Candidates: a few more than wanted; each order tried below uses the
  // first ones that work in it (the rest are plain strands, kept as blocks).
  const groups = []; // { members (old indices), kind: 2 | 3 }
  for (const l of shuffle([...byPair.values()].filter((l) => l.length >= 2), rng)) {
    if (groups.length >= snarl2 * 3) break;
    const a = l[0].a, b = l[0].b;
    if (busy.has(a) || busy.has(b) || !l.every(noTip)) continue;
    groups.push({ members: [a, b], kind: 2 });
    busy.add(a); busy.add(b);
  }
  if (groups.length < snarl2) return no('snarl2');
  if (snarl3) {
    const adj = new Map();
    for (const k of byPair.keys()) { const [a, b] = k.split('.').map(Number); for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, new Set()); adj.get(x).add(y); } }
    const tris = [];
    for (const [a, na] of adj) for (const b of na) if (b > a) for (const c of na) if (c > b && adj.get(b).has(c)) tris.push([a, b, c]);
    let made = 0;
    for (const t of shuffle(tris, rng)) {
      if (made >= snarl3 * 3) break;
      if (t.some((m) => busy.has(m))) continue;
      if (![[t[0], t[1]], [t[1], t[2]], [t[0], t[2]]].every(([x, y]) => pairOf(x, y).every(noTip))) continue;
      groups.push({ members: t.slice(), kind: 3 });
      for (const m of t) busy.add(m);
      made++;
    }
    if (made < snarl3) return no('snarl3');
  }
  const PERMS = { 2: [[0, 1], [1, 0]], 3: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] };
  // For an order (blocks in place), pick each snarl's bottom-to-top order and
  // the crossings it turns: a pair turns one crossing so its bottom strand lies
  // over its top one there; a ring of three (bottom p, middle q, top r: q lies
  // over p, r over q) turns every p-r crossing so p lies over r. Returns
  // { order, turns, snarls } or null.
  const turnsFor = (order) => {
    order = order.slice();
    const rank = [];
    order.forEach((s0, r) => { rank[s0] = r; });
    const turns = [], snarls = [];
    const need = { 2: snarl2, 3: snarl3 };
    for (const g of groups) {
      if (!need[g.kind]) continue;
      const slots = g.members.map((m) => rank[m]).sort((a, b) => a - b);
      let done = false;
      for (const pm of shuffle(PERMS[g.kind].slice(), rng)) {
        const seq = pm.map((k) => g.members[k]); // bottom..top
        seq.forEach((m, k) => { rank[m] = slots[k]; });
        const bottom = seq[0], top = seq[seq.length - 1];
        const xs = pairOf(bottom, top);
        const ok = xs.filter((c) => clearFor(c, bottom, rank));
        if (g.kind === 3 ? xs.length && ok.length === xs.length : ok.length) {
          seq.forEach((m, k) => { order[slots[k]] = m; });
          if (g.kind === 3) turns.push(...ok); else turns.push(ok[Math.floor(rng() * ok.length)]);
          snarls.push(seq);
          need[g.kind]--;
          done = true;
          break;
        }
      }
      if (!done) g.members.forEach((m) => { rank[m] = order.indexOf(m); });
    }
    return need[2] || need[3] ? null : { order, turns, snarls };
  };
  // 2. where a tip rests on another strand, the order decides: tip on top
  // (resting across) or underneath (a tuck). `tucks` of them go underneath.
  const unit = [...Array(n).keys()]; // strand -> its block (a snarl's first strand)
  for (const g of groups) for (const m of g.members) unit[m] = g.members[0];
  const endX = [];
  for (const c of base.cross) {
    if (c.self || (c.tipA < 0 && c.tipB < 0)) continue;
    if (c.tipA >= 0 && c.tipB >= 0) return no('twoTips');
    const end = c.tipA >= 0 ? c.a : c.b, other = c.tipA >= 0 ? c.b : c.a;
    if (unit[end] === unit[other]) return no('tipInSnarl');
    endX.push({ end, other });
  }
  if (endX.length < tucks) return no('fewTips');
  let must = null;
  for (let t = 0; t < 12 && !must; t++) {
    const pick = new Set(shuffle(endX.map((_, k) => k), rng).slice(0, tucks));
    const m = Array.from({ length: n }, () => []); // m[u]: blocks that must lie above block u
    endX.forEach((x, k) => { const lo = pick.has(k) ? x.end : x.other, hi = pick.has(k) ? x.other : x.end; m[unit[lo]].push(unit[hi]); });
    if (!sccs(m).length) must = m;
  }
  if (!must) return no('tipRing');
  // 3. a bottom-to-top order of blocks (several tried: nearest the wanted depth)
  const units = [...new Set(unit)];
  const groupAt = new Map(groups.map((g) => [g.members[0], g]));
  const topo = () => {
    const indeg = new Map(units.map((u) => [u, 0]));
    for (const u of units) for (const v of must[u]) indeg.set(v, indeg.get(v) + 1);
    const ready = units.filter((u) => !indeg.get(u));
    const out = [];
    while (ready.length) {
      const u = ready.splice(Math.floor(rng() * ready.length), 1)[0];
      out.push(...(groupAt.has(u) ? groupAt.get(u).members : [u]));
      for (const v of must[u]) { indeg.set(v, indeg.get(v) - 1); if (!indeg.get(v)) ready.push(v); }
    }
    return out.length === n ? out : null;
  };
  const pairs = [...byPair.keys()].map((k) => k.split('.').map(Number));
  let best = null, bd = Infinity;
  for (let t = 0; t < 24; t++) {
    const order = topo();
    if (!order) return no('topo');
    const got = turnsFor(order);
    if (!got) continue;
    const rank = [];
    got.order.forEach((s0, r) => { rank[s0] = r; });
    const score = depth ? Math.abs(depthFor(n, pairs, rank) - depth) : 0;
    if (score < bd) { bd = score; best = got; }
    if (!depth || score === 0) break;
  }
  if (!best) return no('noTurns');
  const bestOrder = best.order, bestTurns = best.turns;
  const perm = bestOrder; // new index -> old
  const inv = [];
  perm.forEach((old, ni) => { inv[old] = ni; });
  const knots = heap.knots.map(([a, b]) => [inv[a], inv[b]]);
  const pegsAt = heap.pegs.map((p) => ({ s: inv[p.s], x: p.x, y: p.y }));
  const inKnot = new Set(knots.flat());
  const def = { board: [heap.board.w, heap.board.h], strands: perm.map((old) => ({ c: null, p: heap.ctrl[old].flat() })), knots, pins: [], pegs: [], flips: [], snarls: [] };
  const L0 = buildLevel({ id: 'tmp', name: 'tmp', ...def, strands: def.strands.map((s0) => ({ ...s0, c: 'm' })) });
  const cross = L0.cross;
  if (cross.filter((c) => c.tuck >= 0).length !== tucks) return no('tuckCount');
  // 4. over and under: the snarls' turned crossings, and a coin toss for which
  // pass of each loop lies on top
  const flips = new Set();
  for (const c0 of bestTurns) {
    const a = Math.min(inv[c0.a], inv[c0.b]), b = Math.max(inv[c0.a], inv[c0.b]);
    let best = null, bdd = Infinity;
    for (const c of L0.crossOf[a]) if (c.a === a && c.b === b) { const d = Math.hypot(c.x - c0.x, c.y - c0.y); if (d < bdd) { bdd = d; best = c; } }
    if (!best || bdd > W) return no('turnLost');
    flips.add(best.id);
  }
  for (const c of cross) if (c.self && rng() < 0.5) flips.add(c.id);
  def.flips = cross.filter((c) => flips.has(c.id)).map((c) => [c.a, c.b, c.ord]);
  def.snarls = best.snarls.map((g) => g.map((m) => inv[m]).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  const key = (list) => JSON.stringify(list.map((x) => x.slice().sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]));
  // 5. colors
  const keys = COLOR_ORDER.slice(0, colors);
  const variIdx = shuffle([...Array(n).keys()].filter((i) => !inKnot.has(i)), rng).slice(0, vari);
  const U = n + variIdx.length;
  if (U % SPOOL) return no('units');
  const spools = U / SPOOL;
  if (spools < colors) return no('colors');
  const per = keys.map(() => 1);
  for (let k = colors; k < spools; k++) per[Math.floor(rng() * colors)]++;
  const pool = [];
  keys.forEach((c, k) => { for (let u = 0; u < per[k] * SPOOL; u++) pool.push(c); });
  shuffle(pool, rng);
  const strands = def.strands;
  for (const i of variIdx) {
    const a = pool.pop();
    const k = pool.findIndex((x) => x !== a);
    if (k < 0) return no('vari');
    const b = pool.splice(k, 1)[0];
    strands[i].c = a; strands[i].c2 = b;
  }
  for (const s of strands) if (!s.c) s.c = pool.pop();
  // pegs: each waits for a skein of a color it isn't, with enough of that color elsewhere
  for (const p of pegsAt) {
    const own = [strands[p.s].c, strands[p.s].c2].filter(Boolean);
    const opts = keys.filter((c) => !own.includes(c) && per[keys.indexOf(c)] >= 1);
    if (!opts.length) return no('pegColor');
    def.pegs.push([p.s, opts[Math.floor(rng() * opts.length)], p.x, p.y]);
  }
  let L = buildLevel({ id: 'tmp', name: 'tmp', ...def });
  if (pins) {
    // A pin must matter: the strand that frees it must not already lie over the
    // pinned strand (directly or through others), or the pin changes nothing.
    // Pinned strands that come uncovered early are preferred, so she meets them.
    const above = ancestors(L);
    const cands = [];
    for (let s = 0; s < n; s++) {
      if (inKnot.has(s) || variIdx.includes(s) || L.snarlOf[s] >= 0 || L.pegC[s]) continue;
      for (let by = 0; by < n; by++) {
        if (by === s || L.partner[s] === by || above[s].has(by) || L.snarlOf[by] >= 0) continue;
        let d = Infinity;
        for (const p of L.poly[s]) { const e = nearDist(p, L.poly[by], L.grids[by]); if (e < d) d = e; }
        if (d >= 1.4 * W && d <= 2.6 * W) cands.push({ pair: [s, by], key: above[s].size + rng() * 2.5 - above[by].size * 0.3 });
      }
    }
    cands.sort((a, b) => a.key - b.key);
    const used = new Set();
    for (const { pair: [s, by] } of cands) {
      if (def.pins.length >= pins) break;
      if (used.has(s) || used.has(by)) continue;
      const T = buildLevel({ id: 'tmp', name: 'tmp', ...def, pins: [...def.pins, [s, by]] });
      if (!acyclic(T)) continue;
      def.pins.push([s, by]); used.add(s); used.add(by);
    }
    if (def.pins.length < pins) return no('pins');
    L = buildLevel({ id: 'tmp', name: 'tmp', ...def });
  }
  if (buried) {
    const covered = [...Array(n).keys()].filter((i) => L.over[i].some((j) => !L.group[i].includes(j)));
    const k = Math.round(covered.length * buried);
    for (const i of shuffle(covered, rng).slice(0, k)) strands[i].q = 1;
  }
  // 6. every cycle is a snarl, and with room on the rack it all comes out
  if (key(dependencyCycles(L)) !== key(def.snarls) || !acyclic(L) || !clearsWithRoom(L)) return no('cycles');
  return def;
}

// For each strand, every strand lying over it, directly or through others.
export function ancestors(L) {
  const memo = [];
  const up = (i) => {
    if (memo[i]) return memo[i];
    const set = new Set();
    memo[i] = set;
    for (const j of L.over[i]) { set.add(j); for (const k of up(j)) set.add(k); }
    return set;
  };
  for (let i = L.n - 1; i >= 0; i--) up(i);
  return memo;
}

/** One candidate for a level: geometry from `seed`, then deal `deal`. */
export function candidate(knobs, seed, deal = 0) {
  const heap = makeHeap(mulberry(seed * 7919 + 1), knobs);
  if (!heap) return null;
  return heapCandidate(heap, knobs, seed, deal);
}
export function heapCandidate(heap, knobs, seed, deal) {
  const def = dealLevel(heap, mulberry(seed * 104729 + deal * 31 + 5), knobs);
  if (!def) return null;
  return { ...def, slots: knobs.slots ?? 5 };
}
