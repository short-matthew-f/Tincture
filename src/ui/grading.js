/**
 * grading.js: the Grading board (overlay `grading`, fullscreen).
 *
 * Owns: the tile grid (anchors with a dot, masked cells invisible), tap-tap and
 * drag-and-drop swapping (8 px drag threshold), the 180 ms swap slide with a 3%
 * overshoot, the tile settle + one-frame shimmer + glass tink at a tile's own
 * note, "Hear the board", colorblind index numbers, the tier switch sheet, and
 * the solve celebration (shimmer sweep, seams closing, arpeggio, tints rising,
 * effort stamp, result card). Implements DESIGN.md "Active play > Grading",
 * "Interaction feel" (Swap two tiles, Tile lands, Board solved, Effort stamps,
 * Hear the board, Correctness without failure) and "UX > Accessibility".
 *
 * Wrong tiles stay neutral: no red, no shake. The celebration is under 1.5 s
 * and any tap skips it. All state writes go through ctx.game.act so the board
 * survives closing the app (state.activePuzzles.grading, see puzzles.js).
 */

import { h, raw, backButton, button, iconSvg, swatch } from './kit.js';
import { stateRng } from '../rng.js';
import {
  injectStyle, PZ_CSS, ensureActive, activeOf, TIER_IDS, TIER_LABEL, STAMP_TONE, stampSvg,
  createGradingBoard, flushTints, rememberedTier, frameName, eventName,
} from './puzzles.js';

const CSS = `
.gr-body { gap: 12px; }
.gr-frame { position: relative; background: var(--paper); border-radius: 18px; padding: 12px; box-shadow: 0 4px 0 rgba(42,38,34,.26); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.gr-frametag { align-self: stretch; display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.gr-grid { position: relative; display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-auto-rows: var(--cell); border-radius: 10px; touch-action: none; user-select: none; -webkit-user-select: none; }
.gr-tile { position: relative; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; margin: 0; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--paper); touch-action: none; cursor: pointer;
  transition: transform 150ms var(--ease-out), box-shadow 150ms var(--ease-out), border-radius 320ms var(--ease-in-out); }
.gr-tile.is-void { visibility: hidden; pointer-events: none; }
.gr-tile.is-sel { transform: scale(1.06); z-index: 2; box-shadow: 0 6px 0 var(--shadow), inset 0 0 0 3px var(--paper), inset 0 0 0 5px var(--ink); }
.gr-tile.is-flying { z-index: 3; box-shadow: 0 6px 0 var(--shadow), inset 0 0 0 2px var(--paper); transition: none; }
.gr-tile.is-drag { z-index: 4; transition: none; box-shadow: 0 8px 0 var(--shadow), inset 0 0 0 3px var(--paper), inset 0 0 0 5px var(--ink); }
.gr-tile.is-target { box-shadow: inset 0 0 0 3px var(--paper), inset 0 0 0 5px rgba(42,38,34,.4); }
.gr-grid.glow .gr-tile:not(.is-void) { box-shadow: inset 0 0 0 2px var(--paper), 0 0 9px rgba(255,255,255,.55); }
.gr-grid.is-seamless { overflow: hidden; }
.gr-grid.is-seamless .gr-tile { border-radius: 0; box-shadow: none; transform: none; }
.gr-dot { width: 8px; height: 8px; border-radius: 4px; background: var(--ink); box-shadow: 0 0 0 2px var(--paper); pointer-events: none; }
.gr-grid.cb .gr-dot { position: absolute; top: 4px; left: 4px; width: 6px; height: 6px; box-shadow: 0 0 0 1.5px var(--paper); }
.gr-num { font-size: min(15px, calc(var(--cell) * .4)); font-weight: 700; line-height: 1; pointer-events: none; font-variant-numeric: tabular-nums; }
.gr-flash { position: absolute; inset: 0; background: rgba(255,255,255,.7); pointer-events: none; border-radius: inherit; animation: gr-flash 70ms linear both; }
@keyframes gr-flash { from { opacity: 1; } to { opacity: 0; } }
.gr-ring { animation: gr-ring 220ms var(--ease-out) both; }
@keyframes gr-ring { 0% { transform: scale(1); } 40% { transform: scale(.94); } 100% { transform: scale(1); } }
.gr-rise { position: absolute; left: 0; right: 0; top: 50%; display: flex; justify-content: center; gap: 12px; pointer-events: none; z-index: 6; }
.gr-rise i { display: block; width: 46px; height: 46px; border-radius: 12px; box-shadow: 0 0 0 3px var(--paper), 0 4px 0 var(--shadow); animation: gr-rise 700ms var(--ease-out) both; }
@keyframes gr-rise { 0% { opacity: 0; transform: translateY(22px) scale(.5); } 100% { opacity: 1; transform: translateY(-30px) scale(1); } }
.gr-stampwrap { position: absolute; right: 6px; bottom: 6px; z-index: 6; pointer-events: none; padding: 3px; border-radius: 50%; background: rgba(247,244,236,.94); box-shadow: 0 3px 0 var(--shadow); animation: pz-stamp-in 260ms var(--ease-out) both; }
.gr-tools { display: flex; gap: 10px; }
.gr-tools .btn { flex: 1 1 0; min-height: 48px; }
.gr-tierbtn { min-height: 44px; padding: 0 12px; font-size: 14px; }
`;

let C = null;
let ROOT = null;
const G = {
  visible: false, board: null, rank: [], sel: null, busy: false, celebrating: false, result: null,
  timers: [], cb: false, moves: -1, drag: null, cell: 40, tiles: [], el: {}, params: {},
};

const fmt = (n) => (C.format && C.format.num ? C.format.num(n) : Math.round(n).toLocaleString());
const reduced = () => !!(C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const later = (fn, ms) => { const id = setTimeout(fn, ms); G.timers.push(id); return id; };
const clearTimers = () => { G.timers.forEach(clearTimeout); G.timers = []; };

// ---------------------------------------------------------------------------
// Sim-style actions (run inside ctx.game.act)
// ---------------------------------------------------------------------------

function pickCard(ctx, s, rng) {
  const regions = (s.hunters && s.hunters.regionsUnlocked) || [];
  const cards = [];
  for (const r of regions) {
    try { cards.push(...(ctx.content.cardsForRegion(r) || [])); } catch { /* region without cards */ }
  }
  if (!cards.length) return null;
  const owned = (s.album && s.album.cards) || {};
  const fresh = cards.filter((c) => !c.rare && !(owned[c.id] && owned[c.id].count > 0));
  const pool = fresh.length ? fresh : cards;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Master bonus roll: 30% a wild-hue fragment (worth 30 Seals), 30% a postcard, 40% Seals. */
function rollBonus(ctx, s, rng, now) {
  const r = rng();
  if (r < 0.3) {
    s.seals = (Number.isFinite(s.seals) ? s.seals : 0) + 30;
    return { kind: 'fragment', seals: 30 };
  }
  if (r < 0.6) {
    const card = pickCard(ctx, s, rng);
    if (card) {
      const res = ctx.sim.hunters.addPostcard(s, card.id, now);
      if (res) return { kind: 'postcard', id: card.id, title: card.title, duplicate: !!res.duplicate, seals: res.seals || 0 };
    }
  }
  s.seals = (Number.isFinite(s.seals) ? s.seals : 0) + 20;
  return { kind: 'seals', seals: 20 };
}

/** Pay out a solved board in one atomic step and clear it from the active slot. */
function settle(ctx, s, board, now) {
  const sim = ctx.sim;
  const tier = board.tier;
  const def = (sim.PUZZLE_TIERS || {})[tier] || { k: 8, mult: 1 };
  let coins = sim.economy.puzzleReward(s, tier, { ...def, now });
  // The onboarding's first board pays a tutorial reward on top (one cheapest upgrade), once.
  const ob = s.onboarding;
  if (ob && !ob.done && ob.flags && !ob.flags.firstBoardPaid) {
    coins += sim.economy.tutorialReward(s);
    ob.flags.firstBoardPaid = true;
  }
  sim.factory.earn(s, coins);
  const boostMinutes = 10 * def.mult;
  sim.factory.addBoost(s, { kind: 'production', mult: 0.25, minutes: boostMinutes }, now);
  sim.quests.questEvent(s, 'boardSolved', 1, { tier, event: board.event || null });
  sim.events.eventPoints(s, 'board', 1, { event: board.event || null });
  if (s.lifetime) s.lifetime.puzzles = (Number.isFinite(s.lifetime.puzzles) ? s.lifetime.puzzles : 0) + 1;
  // "Fast" solves feed the gentle Try Tricky nudge on the Puzzle table.
  const limit = { relaxed: 75e3, steady: 180e3 }[tier];
  if (limit && Number.isFinite(board.startedAt) && now - board.startedAt <= limit) {
    s.stats = s.stats || {};
    s.stats.fastSolves = (Number.isFinite(s.stats.fastSolves) ? s.stats.fastSolves : 0) + 1;
  }
  const rng = stateRng(s);
  const tints = ctx.puzzles.grading.revealedTints(board, rng);
  const a = ensureActive(s);
  a.pendingTints = tints.slice();
  a.grading = null;
  const bonus = tier === 'master' ? rollBonus(ctx, s, rng, now) : null;
  return { coins, k: def.k, mult: def.mult, boostMinutes, tints, tier, bonus, moves: board.moves, event: board.event || null };
}

function swapAct(s, args, now) {
  const board = s.activePuzzles && s.activePuzzles.grading;
  if (!board) return { ok: false };
  const r = C.puzzles.grading.swap(board, args.i, args.j);
  if (r.ok && r.solved) r.reward = settle(C, s, board, now);
  return r;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function swapsLabel(n) {
  return `${n} ${n === 1 ? 'swap' : 'swaps'}`;
}

function cellSize(board) {
  const W = ROOT.clientWidth || 390;
  const H = ROOT.clientHeight || 760;
  const availW = W - 2 * 16 - 2 * 12;
  const availH = H - 300 - (board.event ? 22 : 0);
  return Math.max(22, Math.min(88, Math.floor(Math.min(availW / board.cols, availH / board.rows))));
}

function tileHex(board, p) {
  const c = board.order[p];
  return c === null || c === undefined ? null : board.cells[c];
}

function paintTile(p) {
  const el = G.tiles[p];
  const b = G.board;
  if (!el || !b || !b.mask[p]) return;
  const hex = tileHex(b, p);
  el.style.background = hex;
  if (G.cb) {
    const n = el.querySelector('.gr-num');
    if (n) { n.textContent = String(G.rank[b.order[p]]); n.style.color = C.color.textColorOn(hex); }
  }
  const row = Math.floor(p / b.cols) + 1;
  const col = (p % b.cols) + 1;
  el.setAttribute('aria-label', `${b.anchors.includes(p) ? 'Fixed tile' : 'Tile'}, row ${row}, column ${col}`);
}

function emptyHtml() {
  return h`<div class="screen-head">${backButton('Back to the puzzle table')}<div class="titles"><div class="title">Grading</div></div><div class="spacer"></div></div>
<div class="screen-body gr-body"><div class="card pz-empty"><div class="h2">No board on the table</div><div class="hint">Start a new one whenever you like.</div>${button('New grading board', { variant: 'primary', attrs: { 'data-action': 'again' } })}</div></div>`;
}

function statusHtml(board) {
  const wrong = C.puzzles.grading.wrongCount(board);
  const toGo = wrong === 1 ? 'One tile' : `${wrong} tiles`;
  const hl = wrong <= 3 && wrong > 0 ? 'Almost there' : 'Put the gradient back in order';
  return h`<div class="hl">${hl}</div><div class="dt">Every color has its own note. A tile in the right place rings. ${toGo} to go.</div>`;
}

function updateStatus() {
  if (!G.el.status || G.result || !G.board) return;
  G.el.status.innerHTML = String(statusHtml(G.board));
}

function updateHead() {
  const b = G.board;
  if (!b || !G.el.sub) return;
  G.el.sub.textContent = `${TIER_LABEL[b.tier]} · ${swapsLabel(b.moves)}`;
  if (G.el.tierBtn) G.el.tierBtn.firstChild.textContent = TIER_LABEL[b.tier];
}

function drawAll() {
  const state = C.game.state;
  G.cb = !!(state.settings && state.settings.colorblind);
  const board = G.board;
  G.sel = null;
  G.drag = null;
  if (!board) {
    ROOT.innerHTML = String(emptyHtml());
    G.el = {};
    G.tiles = [];
    return;
  }
  G.moves = board.moves;
  G.cell = cellSize(board);
  let k = 0;
  G.rank = [];
  for (let p = 0; p < board.mask.length; p++) if (board.mask[p]) G.rank[p] = ++k;
  const tiles = [];
  for (let p = 0; p < board.mask.length; p++) {
    if (!board.mask[p]) { tiles.push('<div class="gr-tile is-void" aria-hidden="true"></div>'); continue; }
    const anchor = board.anchors.includes(p);
    tiles.push(`<button type="button" class="gr-tile${anchor ? ' is-anchor' : ''}" data-p="${p}">${anchor ? '<i class="gr-dot"></i>' : ''}${G.cb ? '<b class="gr-num"></b>' : ''}</button>`);
  }
  const tag = board.event
    ? h`<div class="gr-frametag"><span>${frameName(C, board.event, board.shape)}</span><span>${eventName(C, board.event)}</span></div>`
    : '';
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Grading</div><div class="subtitle" data-sub></div></div>
<button type="button" class="btn gr-tierbtn" data-action="tier-sheet" data-tap aria-label="Change difficulty"><span></span></button></div>
<div class="screen-body gr-body">
<div class="gr-frame" data-frame${board.event ? ` data-event="${board.event}"` : ''}>${tag}
<div class="gr-grid${G.cb ? ' cb' : ''}${board.glow ? ' glow' : ''}" data-grid style="--cols:${board.cols};--cell:${G.cell}px" role="group" aria-label="Gradient board">${raw(tiles.join(''))}</div></div>
<div class="gr-tools">${button(h`${iconSvg('sound', { size: 18 })}Hear the board`, { variant: 'primary', attrs: { 'data-action': 'hear' } })}</div>
<div class="card pz-status" data-status></div>
</div>`);
  G.el = {
    frame: ROOT.querySelector('[data-frame]'),
    grid: ROOT.querySelector('[data-grid]'),
    status: ROOT.querySelector('[data-status]'),
    sub: ROOT.querySelector('[data-sub]'),
    tierBtn: ROOT.querySelector('.gr-tierbtn'),
  };
  G.tiles = [];
  const nodes = G.el.grid.children;
  for (let p = 0; p < board.mask.length; p++) G.tiles[p] = nodes[p];
  for (let p = 0; p < board.mask.length; p++) paintTile(p);
  updateHead();
  updateStatus();
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

const movable = (p) => !!G.board && C.puzzles.grading.isMovable(G.board, p);

function setSel(p) {
  if (G.sel !== null && G.tiles[G.sel]) {
    G.tiles[G.sel].classList.remove('is-sel');
    G.tiles[G.sel].removeAttribute('aria-pressed');
  }
  G.sel = p;
  if (p !== null && G.tiles[p]) {
    G.tiles[p].classList.add('is-sel');
    G.tiles[p].setAttribute('aria-pressed', 'true');
  }
}

function tap(p) {
  if (G.busy || G.celebrating || G.result || !G.board) return;
  if (!movable(p)) { C.audio.tick('blocked'); return; }
  if (G.sel === null) {
    setSel(p);
    C.audio.tick('select');
    C.haptics.light();
  } else if (G.sel === p) {
    setSel(null);
    C.audio.tick('deselect');
  } else {
    doSwap(G.sel, p, null);
  }
}

function slide(el, dx, dy) {
  if (!el || !el.animate) return;
  if (reduced()) { C.fx.fade(el); return; }
  el.classList.add('is-flying');
  const a = el.animate([
    { transform: `translate(${dx}px,${dy}px) scale(1.06)` },
    { transform: `translate(${-dx * 0.03}px,${-dy * 0.03}px) scale(1.02)`, offset: 0.82 },
    { transform: 'translate(0,0) scale(1)' },
  ], { duration: 180, easing: 'ease-in-out' });
  const done = () => el.classList.remove('is-flying');
  a.finished.then(done, done);
}

function land(p, k) {
  const b = G.board;
  const el = G.tiles[p];
  if (!el || !b) return;
  const L = b.L[b.order[p]];
  C.audio.tink(L, 0.18 + k * 0.07, 0.3);
  later(() => {
    if (!G.tiles[p]) return;
    if (!reduced() && el.animate) {
      el.animate([{ transform: 'scale(.94)' }, { transform: 'scale(1.02)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' });
    }
    const f = document.createElement('i');
    f.className = 'gr-flash';
    el.appendChild(f);
    setTimeout(() => f.remove(), 90);
  }, 180 + k * 70);
}

function snapBack(el) {
  if (!el) return;
  el.classList.remove('is-drag');
  const t = el.style.transform;
  el.style.transform = '';
  if (t && el.animate && !reduced()) {
    el.animate([{ transform: t }, { transform: 'none' }], { duration: 140, easing: 'ease-out' });
  }
}

function doSwap(i, j, dragOff) {
  const b = G.board;
  if (!b || G.busy) return;
  G.busy = true;
  const res = C.game.act(swapAct, { i, j });
  G.busy = false;
  setSel(null);
  if (!res || !res.ok) {
    if (dragOff) snapBack(G.tiles[i]);
    C.audio.tick('blocked');
    return;
  }
  G.moves = b.moves;
  paintTile(i);
  paintTile(j);
  const cell = G.cell;
  const ci = i % b.cols; const ri = Math.floor(i / b.cols);
  const cj = j % b.cols; const rj = Math.floor(j / b.cols);
  const ei = G.tiles[i]; const ej = G.tiles[j];
  if (dragOff) { ei.classList.remove('is-drag'); ei.style.transform = ''; }
  slide(ej, (ci - cj) * cell + (dragOff ? dragOff.dx : 0), (ri - rj) * cell + (dragOff ? dragOff.dy : 0));
  slide(ei, (cj - ci) * cell, (rj - ri) * cell);
  C.audio.tick('deselect');
  C.haptics.light();
  res.placed.forEach((p, k) => land(p, k));
  updateHead();
  if (res.solved && res.reward) {
    // The one 'boardSolved' signal (onboarding step 2 listens): after the act, never from sim.
    C.game.emit('boardSolved', { puzzle: 'grading', tier: res.reward.tier, tints: res.reward.tints || [] });
    G.celebrating = true; // from here render() leaves the (now cleared) board alone
    G.reward = res.reward;
    later(() => celebrate(res.reward), 220);
  } else updateStatus();
}

function pointToPos(x, y) {
  const b = G.board;
  const r = G.el.grid.getBoundingClientRect();
  const col = Math.floor((x - r.left) / G.cell);
  const row = Math.floor((y - r.top) / G.cell);
  if (col < 0 || row < 0 || col >= b.cols || row >= b.rows) return -1;
  const p = row * b.cols + col;
  return b.mask[p] ? p : -1;
}

function clearTargets() {
  G.el.grid.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
}

function onPointerDown(e) {
  if (G.busy || G.result || !G.board || (e.button !== undefined && e.button > 0)) return;
  const tile = e.target.closest('.gr-tile');
  if (!tile || tile.classList.contains('is-void')) return;
  G.drag = { p: Number(tile.dataset.p), id: e.pointerId, x: e.clientX, y: e.clientY, moving: false, el: tile };
}

function onPointerMove(e) {
  const d = G.drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  if (!d.moving) {
    if (Math.hypot(dx, dy) < 8 || !movable(d.p)) return;
    d.moving = true;
    setSel(null);
    d.el.classList.add('is-drag');
    try { d.el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    C.audio.tick('select');
  }
  d.el.style.transform = `translate(${dx}px,${dy}px) scale(1.06)`;
  clearTargets();
  const tp = pointToPos(e.clientX, e.clientY);
  if (tp >= 0 && tp !== d.p && movable(tp)) G.tiles[tp].classList.add('is-target');
}

function onPointerUp(e) {
  const d = G.drag;
  if (!d || e.pointerId !== d.id) return;
  G.drag = null;
  if (!d.moving) { if (e.type === 'pointerup') tap(d.p); return; }
  clearTargets();
  const tp = e.type === 'pointerup' ? pointToPos(e.clientX, e.clientY) : -1;
  const off = { dx: e.clientX - d.x, dy: e.clientY - d.y };
  if (tp >= 0 && tp !== d.p && movable(tp)) doSwap(d.p, tp, off);
  else snapBack(d.el);
}

// ---------------------------------------------------------------------------
// Hear the board, tier sheet
// ---------------------------------------------------------------------------

function hear() {
  const b = G.board;
  if (!b) return;
  const spots = [];
  for (let p = 0; p < b.order.length; p++) if (b.mask[p]) spots.push(p);
  const step = Math.max(1, Math.ceil(spots.length / 36)); // long boards are sampled: 36 notes at most
  let k = 0;
  for (let n = 0; n < spots.length; n += step) {
    const p = spots[n];
    C.audio.note(b.L[b.order[p]], k * 0.09, 0.2, 0.5);
    if (!reduced()) {
      later(() => { const el = G.tiles[p]; if (el && el.animate) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' }); }, k * 90);
    }
    k++;
  }
}

async function tierSheet() {
  const b = G.board;
  if (!b || G.celebrating || G.result) return;
  const tiers = C.sim.PUZZLE_TIERS || {};
  const idx = TIER_IDS.indexOf(b.tier);
  const actions = TIER_IDS.filter((t) => t !== b.tier).map((t) => {
    const pay = C.sim.economy.puzzleReward(C.game.state, t, { ...(tiers[t] || {}) });
    const verb = TIER_IDS.indexOf(t) < idx ? `Drop to ${TIER_LABEL[t]}` : `Try ${TIER_LABEL[t]}`;
    return { label: `${verb} · about ${fmt(pay)}`, variant: 'paper', value: t };
  });
  actions.push({ label: `Stay on ${TIER_LABEL[b.tier]}`, variant: 'primary', value: null });
  const pick = await C.sheet({
    title: 'Change the difficulty?',
    body: String(h`<p>Your reward recalculates and your progress is kept. Switch whenever you like.</p>`),
    actions,
  });
  if (!pick || pick === b.tier || !TIER_IDS.includes(pick) || G.board !== b) return;
  C.game.act((s, a) => {
    const old = s.activePuzzles && s.activePuzzles.grading;
    if (!old) return;
    const nb = C.puzzles.grading.switchTier(old, a.tier, stateRng(s));
    nb.event = old.event || null;
    nb.glow = !!old.glow;
    nb.startedAt = old.startedAt;
    s.activePuzzles.grading = nb;
    C.sim.settings.setPuzzleTier(s, { puzzle: 'grading', tier: a.tier });
  }, { tier: pick });
  G.board = activeOf(C.game.state).grading;
  drawAll();
}

// ---------------------------------------------------------------------------
// Celebration and result
// ---------------------------------------------------------------------------

function celebrate(reward) {
  const b = G.board;
  if (!b || !G.el.frame || !G.celebrating) return;
  G.el.grid.classList.add('is-seamless');
  setSel(null);
  if (G.el.status) G.el.status.innerHTML = String(h`<div class="hl">Every tile is home</div><div class="dt">Listen to the whole gradient.</div>`);
  C.fx.shimmerSweep(G.el.frame, { ms: 900 });
  C.audio.arpeggio(C.puzzles.grading.boardMelody(b));
  C.haptics.success();
  if (reward.tints.length) {
    later(() => {
      if (!G.celebrating || !G.el.frame) return;
      const rise = document.createElement('div');
      rise.className = 'gr-rise';
      rise.innerHTML = reward.tints.map((hex, i) => `<i style="background:${hex};animation-delay:${i * 110}ms"></i>`).join('');
      G.el.frame.appendChild(rise);
    }, 420);
  }
  if (reward.tier !== 'relaxed') {
    later(() => {
      if (!G.celebrating || !G.el.frame) return;
      const w = document.createElement('div');
      w.className = 'gr-stampwrap';
      w.innerHTML = String(stampSvg(TIER_LABEL[reward.tier], { tone: STAMP_TONE[reward.tier], size: 84, double: reward.tier === 'master' }));
      G.el.frame.appendChild(w);
      C.audio.stamp();
      C.haptics.medium();
    }, 820);
  }
  later(finalize, 1200);
}

function skip() {
  if (!G.celebrating) return;
  const hadStamp = G.el.frame && G.el.frame.querySelector('.gr-stampwrap');
  clearTimers();
  if (!hadStamp && G.reward && G.reward.tier !== 'relaxed' && G.el.frame) {
    const w = document.createElement('div');
    w.className = 'gr-stampwrap';
    w.innerHTML = String(stampSvg(TIER_LABEL[G.reward.tier], { tone: STAMP_TONE[G.reward.tier], size: 84, double: G.reward.tier === 'master' }));
    G.el.frame.appendChild(w);
  }
  finalize();
}

function bonusLine(bonus) {
  if (!bonus) return '';
  if (bonus.kind === 'fragment') return h`<li>${iconSvg('star', { size: 18 })}<span><b>Bonus roll:</b> a wild-hue fragment, worth ${bonus.seals} Seals</span></li>`;
  if (bonus.kind === 'postcard') {
    return bonus.duplicate
      ? h`<li>${iconSvg('star', { size: 18 })}<span><b>Bonus roll:</b> a postcard you have, “${bonus.title}”, turned into ${bonus.seals} Seals</span></li>`
      : h`<li>${iconSvg('star', { size: 18 })}<span><b>Bonus roll:</b> a new postcard, “${bonus.title}”</span></li>`;
  }
  return h`<li>${iconSvg('star', { size: 18 })}<span><b>Bonus roll:</b> ${bonus.seals} Seals</span></li>`;
}

function finalize() {
  if (!G.celebrating) return;
  clearTimers();
  G.celebrating = false;
  const reward = G.reward;
  const found = C.game.act((s, _a, now) => flushTints(C, s, now)) || [];
  G.result = { reward, found };
  const rise = G.el.frame && G.el.frame.querySelector('.gr-rise');
  if (rise) rise.remove();
  const chips = (found.length ? found.map((f) => f.hex) : reward.tints).map((hex) => swatch(hex, 44));
  const headline = found.length
    ? `Solved. You found ${found[0].name}${found.length > 1 ? ` and ${found.length - 1} more` : ''}`
    : 'Solved. Beautifully graded';
  const detail = found.length ? 'A new tint for the catalog, plus a production boost.' : 'The tints you revealed were already in your catalog. The boost is yours.';
  const boostLabel = reward.boostMinutes === Math.round(reward.boostMinutes) ? reward.boostMinutes : reward.boostMinutes.toFixed(1);
  const card = h`<div class="card pz-result" data-result>
<div class="row">${chips.length ? h`<div class="chips">${chips}</div>` : ''}<div class="grow"><div class="hl">${headline}</div><div class="hint">${detail}</div></div></div>
<ul class="lines">
<li>${iconSvg('coin', { size: 18 })}<span><b class="num" data-coins>+0</b> coins, about ${reward.k} minutes of production</span></li>
<li>${iconSvg('check', { size: 18 })}<span>+25% production for ${boostLabel} minutes</span></li>
${bonusLine(reward.bonus)}
</ul>
<div class="pz-actions">${button('Another board', { variant: 'primary', attrs: { 'data-action': 'again' } })}${button('Back to the table', { attrs: { 'data-action': 'done' } })}</div>
</div>`;
  if (G.el.status) {
    const wrap = document.createElement('div');
    wrap.innerHTML = String(card);
    G.el.status.replaceWith(wrap.firstElementChild);
    G.el.status = null;
  }
  const coinsEl = ROOT.querySelector('[data-coins]');
  if (coinsEl) C.fx.rollNumber(coinsEl, 0, reward.coins, { ms: 600, format: (v) => `+${fmt(v)}` });
}

function again() {
  clearTimers();
  G.result = null;
  G.celebrating = false;
  C.game.act((s, _a, now) => createGradingBoard(C, s, { tier: rememberedTier(s) }, now));
  G.board = activeOf(C.game.state).grading;
  drawAll();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (a && ROOT.contains(a)) {
    const act = a.dataset.action;
    if (act === 'hear') hear();
    else if (act === 'tier-sheet') tierSheet();
    else if (act === 'again') again();
    else if (act === 'done') { G.result = null; C.back(); }
    return;
  }
  // Keyboard activation (Enter / Space) arrives as a click with detail 0; pointer taps are handled on pointerup.
  const tile = e.target.closest('.gr-tile');
  if (tile && e.detail === 0 && !tile.classList.contains('is-void')) tap(Number(tile.dataset.p));
}

export default {
  id: 'grading',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('shared', PZ_CSS);
    injectStyle('grading', CSS);
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', (e) => {
      if (G.celebrating) skip();
      else if (e.target.closest('[data-grid]')) onPointerDown(e);
    });
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-grid]')) e.preventDefault(); });
  },

  show(params = {}) {
    G.visible = true;
    G.params = params;
    const st = C.game.state;
    const a = activeOf(st);
    if (a.pendingTints && a.pendingTints.length && !G.celebrating) {
      C.game.act((s, _a, now) => flushTints(C, s, now));
    }
    // Coming back from the naming ceremony keeps the result card; anything else starts fresh.
    if (G.result && !activeOf(C.game.state).grading && !params.fresh) return;
    clearTimers();
    G.result = null;
    G.celebrating = false;
    if (!activeOf(C.game.state).grading) {
      C.game.act((s, _a, now) => createGradingBoard(C, s, { tier: rememberedTier(s), own: !!params.own }, now));
    }
    G.board = activeOf(C.game.state).grading;
    drawAll();
  },

  hide() {
    G.visible = false;
    clearTimers();
    if (G.celebrating) {
      // Leaving mid-celebration still pays out the tints.
      G.celebrating = false;
      C.game.act((s, _a, now) => flushTints(C, s, now));
    }
    G.result = null;
    G.drag = null;
  },

  render(state) {
    if (!ROOT || !G.visible || G.busy || G.celebrating || G.result || G.drag) return;
    const b = activeOf(state).grading || null;
    const cb = !!(state.settings && state.settings.colorblind);
    if (b !== G.board || (b && b.moves !== G.moves) || cb !== G.cb) {
      G.board = b;
      drawAll();
    }
  },
};
