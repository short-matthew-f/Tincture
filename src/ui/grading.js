/**
 * grading.js: the Grading board (overlay `grading`, fullscreen).
 *
 * Owns: the tile grid (anchors with a dot, masked cells invisible), tap-tap and
 * drag-and-drop swapping (fx.drag in handle mode on the grid: the tile lifts on
 * touch, a ghost follows the finger above it, a drop on a tile swaps), the swap
 * glide (fx.spring firm, 3% overshoot), the tile settle (fx.settle) + one-frame
 * shimmer + glass tink at a tile's own note, "Hear the board" (a 90 ms highlight
 * walking the reading order), colorblind index numbers, the tier switch sheet,
 * and the solve celebration (shimmer sweep, seams closing, arpeggio, tints
 * rising, fx.stamp effort stamp, result card; about 1.3 s, skippable by tap). Implements DESIGN.md "Active play > Grading",
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
  createGradingBoard, flushTints, rememberedTier, frameName, eventName, coinsText,
} from './puzzles.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';
import { offerWhatsNext } from './matching.js';

const CSS = `
.gr-body { gap: 12px; }
.gr-frame { position: relative; background: var(--paper); border-radius: 18px; padding: 12px; box-shadow: 0 4px 0 rgba(42,38,34,.26); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.gr-frametag { align-self: stretch; display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.gr-grid { position: relative; display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-auto-rows: var(--cell); border-radius: 10px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.gr-tile { position: relative; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; margin: 0; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--paper); touch-action: manipulation; cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: box-shadow 150ms var(--ease-out), border-radius 320ms var(--ease-in-out); }
.gr-tile.fx-draggable { touch-action: none; }
.gr-tile.is-void { visibility: hidden; pointer-events: none; }
.gr-tile.fx-lifted { z-index: 2; transform-origin: 50% 50%; transform-box: border-box; filter: none; box-shadow: 0 6px 0 var(--shadow), inset 0 0 0 2px var(--paper); }
.gr-tile.is-sel { transform: scale(1.06); z-index: 2; box-shadow: 0 6px 0 var(--shadow), inset 0 0 0 3px var(--paper), inset 0 0 0 5px var(--ink); }
.gr-tile.is-flying { z-index: 3; box-shadow: 0 6px 0 var(--shadow), inset 0 0 0 2px var(--paper); }
.gr-tile.is-drag-source { opacity: .35; }
.gr-tile.is-target { box-shadow: inset 0 0 0 3px var(--paper), inset 0 0 0 5px rgba(42,38,34,.4); }
.gr-tile.is-hear { z-index: 2; transform: scale(1.05); filter: brightness(1.14); box-shadow: 0 0 0 2px #fff, 0 0 14px rgba(255,255,255,.95), inset 0 0 0 2px var(--paper); transition: none; }
.gr-grid.rm .gr-tile.is-hear { transform: none; }
.gr-ghost-tile { box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 6px; box-shadow: inset 0 0 0 3px var(--paper), inset 0 0 0 5px var(--ink); }
.gr-grid.glow .gr-tile:not(.is-void) { box-shadow: inset 0 0 0 2px var(--paper), 0 0 9px rgba(255,255,255,.55); }
.gr-grid.is-seamless { overflow: hidden; }
.gr-grid.is-seamless .gr-tile { border-radius: 0; box-shadow: none; transform: none; filter: none; }
.gr-dot { box-sizing: border-box; width: 11px; height: 11px; border-radius: 50%; background: transparent; border: 2px solid var(--ink); box-shadow: 0 0 0 1.5px var(--paper); pointer-events: none; }
.gr-grid.cb .gr-dot { position: absolute; top: 4px; left: 4px; width: 9px; height: 9px; border-width: 1.5px; box-shadow: 0 0 0 1.5px var(--paper); }
.gr-num { font-size: min(15px, calc(var(--cell) * .4)); font-weight: 700; line-height: 1; pointer-events: none; font-variant-numeric: tabular-nums; }
.gr-flash { position: absolute; inset: 0; background: rgba(255,255,255,.7); pointer-events: none; border-radius: inherit; animation: gr-flash 70ms linear both; }
@keyframes gr-flash { from { opacity: 1; } to { opacity: 0; } }
.gr-rise { position: absolute; left: 0; right: 0; top: 50%; display: flex; justify-content: center; gap: 12px; pointer-events: none; z-index: 6; }
.gr-rise i { display: block; width: 46px; height: 46px; border-radius: 12px; box-shadow: 0 0 0 3px var(--paper), 0 4px 0 var(--shadow); animation: gr-rise 700ms var(--ease-out) both; }
@keyframes gr-rise { 0% { opacity: 0; transform: translateY(22px) scale(.5); } 100% { opacity: 1; transform: translateY(-30px) scale(1); } }
.gr-tools { display: flex; gap: 10px; }
.gr-tools .btn { flex: 1 1 0; min-height: 48px; }
.gr-tools .btn { padding: 0 10px; font-size: 14px; white-space: nowrap; }
.gr-tools .btn.is-quiet { box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 1.5px rgba(42,38,34,.2); }
.gr-empty-actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: 100%; max-width: 260px; }
.gr-result-top { align-items: center; }
.gr-result-top .pz-stamp { flex: 0 0 auto; animation: pz-stamp-in 260ms var(--ease-out) both; }
#screen-grading .how-link { display: inline-block; position: relative; margin-top: 2px; padding: 0; min-height: 20px; border: 0; background: none; font: inherit; font-size: 12px; font-weight: 600; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; text-align: left; }
#screen-grading .how-link::before { content: ''; position: absolute; inset: -12px -10px; }
`;

let C = null;
let ROOT = null;
const G = {
  visible: false, board: null, rank: [], sel: null, busy: false, celebrating: false, result: null,
  timers: [], cb: false, moves: -1, pressed: false, dragH: null, hearTimer: 0, cell: 40, tiles: [], el: {}, params: {}, settling: false,
  guide: null, offer: null, startTimer: 0,
  swapped: false, // she has swapped two tiles this visit (the guide's action step)
};

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
<div class="screen-body gr-body"><div class="card pz-empty"><div class="h2">The table is clear</div><div class="hint">Start a fresh board whenever you like.</div><div class="gr-empty-actions">${button('New grading board', { variant: 'primary', block: true, attrs: { 'data-action': 'again' } })}${button('Back to the table', { block: true, cls: 'is-quiet', attrs: { 'data-action': 'done' } })}</div></div></div>`;
}

function statusHtml(board) {
  const wrong = C.puzzles.grading.wrongCount(board);
  const toGo = wrong === 1 ? 'One more tile' : `${wrong} more tiles`;
  const hl = wrong <= 3 && wrong > 0 ? 'Almost there' : 'Put the gradient back in order';
  return h`<div class="hl">${hl}</div><div class="dt">Every color has its own note. A tile in the right place rings. ${toGo} to settle.</div>`;
}

function updateStatus() {
  if (!G.el.status || G.result || !G.board) return;
  G.el.status.innerHTML = String(statusHtml(G.board));
}

function updateHead() {
  const b = G.board;
  if (!b || !G.el.sub) return;
  G.el.sub.textContent = `${TIER_LABEL[b.tier]} board`;
}

function drawAll() {
  const state = C.game.state;
  G.cb = !!(state.settings && state.settings.colorblind);
  const board = G.board;
  G.sel = null;
  stopHear();
  if (G.dragH && G.dragH.active) G.dragH.cancel();
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
    tiles.push(`<button type="button" class="gr-tile${anchor ? ' is-anchor' : ' fx-draggable'}" data-p="${p}">${anchor ? '<i class="gr-dot"></i>' : ''}${G.cb ? '<b class="gr-num"></b>' : ''}</button>`);
  }
  const tag = board.event
    ? h`<div class="gr-frametag"><span>${frameName(C, board.event, board.shape)}</span><span>${eventName(C, board.event)}</span></div>`
    : '';
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Grading</div><div class="subtitle" data-sub></div>${howThisWorksHtml('grading')}</div><div class="spacer"></div></div>
<div class="screen-body gr-body">
<div class="gr-frame" data-frame${board.event ? ` data-event="${board.event}"` : ''}>${tag}
<div class="gr-grid${G.cb ? ' cb' : ''}${board.glow ? ' glow' : ''}" data-grid data-coach="grading-board" style="--cols:${board.cols};--cell:${G.cell}px" role="group" aria-label="Gradient board">${raw(tiles.join(''))}</div></div>
<div class="gr-tools" data-tools>${button(h`${iconSvg('sound', { size: 18 })}Hear the board`, { variant: 'primary', attrs: { 'data-action': 'hear', 'data-coach': 'grading-hear' } })}${button('Change difficulty', { cls: 'is-quiet', attrs: { 'data-action': 'tier-sheet' } })}</div>
<div class="card pz-status" data-status></div>
</div>`);
  G.el = {
    frame: ROOT.querySelector('[data-frame]'),
    grid: ROOT.querySelector('[data-grid]'),
    status: ROOT.querySelector('[data-status]'),
    sub: ROOT.querySelector('[data-sub]'),
    tools: ROOT.querySelector('[data-tools]'),
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

/** Drop whatever animations still hold a tile (a lift that fills forwards, a settle in flight). */
function freeze(el) {
  if (!el || typeof el.getAnimations !== 'function') return;
  try { el.getAnimations().forEach((a) => a.cancel()); } catch (e) { /* ignore */ }
}

function setSel(p) {
  const prev = G.sel !== null ? G.tiles[G.sel] : null;
  if (prev) {
    // The selected tile is held at 106% by CSS; put it down with the shared settle (3% overshoot).
    if (p === null || p !== G.sel) C.fx.settle(prev);
    prev.classList.remove('is-sel');
    prev.removeAttribute('aria-pressed');
  }
  G.sel = p;
  if (p !== null && G.tiles[p]) {
    freeze(G.tiles[p]); // the press lift ends here; the selected look is CSS, so there is no dip
    G.tiles[p].classList.remove('fx-lifted');
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

const SWAP_SPRING = { duration: 220 }; // spring firm, cut at the spec's ~200 ms swap

/**
 * Glide a tile into its cell from (dx, dy) away at 106%: spring firm, so it
 * overshoots about 3% of the way and settles. Reduced motion fades instead.
 */
function glide(el, dx, dy) {
  if (!el) return;
  el.classList.add('is-flying');
  const done = () => el.classList.remove('is-flying');
  const p = C.fx.spring(el, {
    from: { transform: `translate(${Math.round(dx * 10) / 10}px,${Math.round(dy * 10) / 10}px) scale(1.06)` },
    to: { transform: 'translate(0px,0px) scale(1)' },
    preset: SWAP_SPRING,
  });
  if (p && p.then) p.then(done, done); else done();
}

/** One-frame white flash on a tile (the shimmer of "tile lands in its right place"). */
function flash(el) {
  const f = document.createElement('i');
  f.className = 'gr-flash';
  el.appendChild(f);
  setTimeout(() => f.remove(), 90);
}

/** A tile that landed right: tiny settle, one-frame shimmer, glass tink at its own note. */
function land(p, k) {
  const b = G.board;
  const el = G.tiles[p];
  if (!el || !b) return;
  const L = b.L[b.order[p]];
  later(() => {
    if (!G.tiles[p] || G.tiles[p] !== el) return;
    C.audio.tink(L, 0, 0.3);
    C.fx.settle(el);
    flash(el);
  }, SWAP_SPRING.duration + 10 + k * 70);
}

/** Where a tile's centre is, in grid layout px (unaffected by transforms). */
const centreOf = (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 });

function doSwap(i, j, info) {
  const b = G.board;
  if (!b || G.busy) return;
  G.busy = true;
  const res = C.game.act(swapAct, { i, j });
  G.busy = false;
  setSel(null);
  const ei = G.tiles[i]; const ej = G.tiles[j];
  if (!res || !res.ok) {
    if (info) landFromGhost(i, info);
    C.audio.tick('blocked');
    return;
  }
  G.moves = b.moves;
  G.swapped = true;
  paintTile(i);
  paintTile(j);
  freeze(ei); freeze(ej);
  ei.classList.remove('fx-lifted'); ej.classList.remove('fx-lifted');
  const pi = centreOf(ei); const pj = centreOf(ej);
  // The tile now at j came from i, or from under the ghost when it was dragged; the one at i came from j.
  let jx = pi.x - pj.x; let jy = pi.y - pj.y;
  if (info) {
    const gr = G.el.grid.getBoundingClientRect();
    const h2 = ej.offsetHeight / 2;
    jx = (info.x - gr.left) - pj.x;
    jy = (info.y - h2 - gr.top) - pj.y;
  }
  glide(ej, jx, jy);
  glide(ei, pj.x - pi.x, pj.y - pi.y);
  C.audio.tick('deselect');
  C.haptics.light();
  res.placed.forEach((p, k) => land(p, k));
  updateHead();
  if (res.solved && res.reward) {
    // The one 'boardSolved' signal (onboarding step 2 listens): after the act, never from sim.
    C.game.emit('boardSolved', { puzzle: 'grading', tier: res.reward.tier, tints: res.reward.tints || [] });
    G.celebrating = true; // from here render() leaves the (now cleared) board alone
    G.reward = res.reward;
    if (G.guide) { // she has solved one: the coach is done
      C.game.act(markGuideSeen, { id: 'grading' });
      G.guide.stop();
      G.guide = null;
    }
    later(() => celebrate(res.reward), 260);
  } else updateStatus();
}

/** A drop that swaps nothing: the tile eases down from where the ghost let go. */
function landFromGhost(from, info) {
  const el = G.tiles[from];
  if (!el || !info) return;
  const gr = G.el.grid.getBoundingClientRect();
  const c = centreOf(el);
  glide(el, (info.x - gr.left) - c.x, (info.y - el.offsetHeight / 2 - gr.top) - c.y);
}

function clearTargets() {
  if (G.el.grid) G.el.grid.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
}

/** The ghost: a plain tile (not the button), tinted like the source, with its index number in colorblind mode. */
function ghostFor(src) {
  const g = document.createElement('div');
  g.className = 'gr-ghost-tile';
  g.style.display = 'flex';
  g.style.background = src.style.background;
  const n = src.querySelector('.gr-num');
  if (n) g.appendChild(n.cloneNode(true));
  return g;
}

function onDragStart() {
  setSel(null);
  C.audio.tick('select');
}

function onDragMove(to, info) {
  clearTargets();
  if (to < 0 || to === info.from || !movable(to) || !G.tiles[to]) return;
  G.tiles[to].classList.add('is-target');
}

function onDragDrop(to, info) {
  clearTargets();
  if (G.busy || G.celebrating || G.result || !G.board) return;
  if (to >= 0 && to !== info.from && G.board.mask[to] && movable(to)) { doSwap(info.from, to, info); return; }
  if (to >= 0) {
    // Dropped on itself or on a fixed tile: it settles back, quietly.
    landFromGhost(info.from, info);
    if (to !== info.from) C.audio.tick('blocked');
  }
  // Dropped outside the board: fx.drag flies the ghost home itself.
}

function onDragCancel() {
  clearTargets();
}

// ---------------------------------------------------------------------------
// Hear the board, tier sheet
// ---------------------------------------------------------------------------

const HEAR_STEP = 90; // ms per tile: the note and the highlight walk together

function stopHear() {
  clearTimeout(G.hearTimer);
  G.hearTimer = 0;
  if (G.el && G.el.grid) G.el.grid.querySelectorAll('.is-hear').forEach((n) => n.classList.remove('is-hear'));
}

/** Play the tiles in reading order; each lights for 90 ms as its note sounds. Long boards are sampled (36 notes at most). */
function hear() {
  const b = G.board;
  if (!b || !G.el.grid) return;
  stopHear();
  G.el.grid.classList.toggle('rm', reduced());
  const spots = [];
  for (let p = 0; p < b.order.length; p++) if (b.mask[p]) spots.push(p);
  const step = Math.max(1, Math.ceil(spots.length / 36));
  const seq = [];
  for (let n = 0; n < spots.length; n += step) seq.push(spots[n]);
  seq.forEach((p, k) => C.audio.note(b.L[b.order[p]], k * (HEAR_STEP / 1000), 0.2, 0.5));
  let k = 0;
  let prev = null;
  const walk = () => {
    if (prev) prev.classList.remove('is-hear');
    if (k >= seq.length || !G.visible || !G.el.grid) { G.hearTimer = 0; return; }
    const el = G.tiles[seq[k++]];
    if (el) { el.classList.add('is-hear'); prev = el; } else prev = null;
    G.hearTimer = setTimeout(walk, HEAR_STEP);
  };
  walk();
}

async function tierSheet() {
  const b = G.board;
  if (!b || G.celebrating || G.result) return;
  const tiers = C.sim.PUZZLE_TIERS || {};
  const idx = TIER_IDS.indexOf(b.tier);
  const actions = TIER_IDS.filter((t) => t !== b.tier).map((t) => {
    const pay = C.sim.economy.puzzleReward(C.game.state, t, { ...(tiers[t] || {}) });
    const verb = TIER_IDS.indexOf(t) < idx ? `Drop to ${TIER_LABEL[t]}` : `Try ${TIER_LABEL[t]}`;
    return { label: `${verb} · about ${coinsText(C, pay)} coins`, variant: 'paper', value: t };
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

/** Clear what the celebration put on the board (skip, finalize, leaving). */
function clearCelebration() {
  const f = G.el && G.el.frame;
  if (!f) return;
  f.querySelectorAll('.gr-rise, .fx-stamp, .fx-shimmer').forEach((n) => n.remove());
}

/**
 * The solve, about 1.3 s from the last swap: the shimmer sweeps the frame as the
 * seams close and the arpeggio climbs dark to light, the tints rise out, and a
 * Steady+ solve is stamped (fx.stamp: thunk and a medium haptic). Any tap skips.
 */
function celebrate(reward) {
  const b = G.board;
  if (!b || !G.el.frame || !G.celebrating) return;
  G.el.grid.classList.add('is-seamless');
  setSel(null);
  if (G.el.status) G.el.status.innerHTML = String(h`<div class="hl">Every tile is home</div><div class="dt">Listen to the whole gradient.</div>`);
  C.fx.shimmerSweep(G.el.frame, { ms: 800 });
  C.audio.arpeggio(C.puzzles.grading.boardMelody(b));
  C.haptics.success();
  if (reward.tints.length) {
    later(() => {
      if (!G.celebrating || !G.el.frame) return;
      const rise = document.createElement('div');
      rise.className = 'gr-rise';
      rise.innerHTML = reward.tints.map((hex, i) => `<i style="background:${hex};animation-delay:${i * 110}ms"></i>`).join('');
      G.el.frame.appendChild(rise);
    }, 280);
  }
  if (reward.tier !== 'relaxed') {
    later(() => {
      if (!G.celebrating || !G.el.frame) return;
      C.fx.stamp(G.el.frame, TIER_LABEL[reward.tier], { keep: true, hex: STAMP_TONE[reward.tier] });
    }, 420);
  }
  later(finalize, 1050);
}

function skip() {
  if (!G.celebrating) return;
  clearTimers();
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

const nameOf = (colorId) => (C.sim.displayName ? C.sim.displayName(C.game.state, colorId) : colorId);

/** The tint rows of the result card: swatch + name (the name follows her own naming). */
function tintRows(found, reward) {
  if (found.length) {
    const shown = found.slice(0, 3);
    return h`<div class="tints">${shown.map((f) => h`<div class="row">${swatch(f.hex, 44, { label: nameOf(f.colorId) })}<div class="grow"><div class="hint">New tint for your catalog</div><div class="nm pz-name" data-tint-name="${f.colorId}">${nameOf(f.colorId)}</div></div></div>`)}${found.length > shown.length ? h`<div class="hint">and ${found.length - shown.length} more tints</div>` : ''}</div>`;
  }
  if (reward.tints.length) {
    return h`<div class="tints"><div class="row"><div class="chips">${reward.tints.slice(0, 4).map((hex) => swatch(hex, 36))}</div><div class="grow hint">Tints you revealed are already in your catalog.</div></div></div>`;
  }
  return '';
}

/** Keep the names on the result card in step with the naming screen. */
function refreshNames() {
  ROOT.querySelectorAll('[data-tint-name]').forEach((n) => {
    const t = nameOf(n.dataset.tintName);
    if (n.textContent !== t) n.textContent = t;
  });
}

function finalize() {
  if (!G.celebrating) return;
  clearTimers();
  const reward = G.reward;
  // The result is claimed before the tints are flushed: the flush can open the naming screen
  // (its change event renders this screen), and render() must leave the solved board alone.
  G.result = { reward, found: [] };
  G.celebrating = false;
  const found = C.game.act((s, _a, now) => flushTints(C, s, now)) || [];
  G.result = { reward, found };
  clearCelebration(); // the stamp moves onto the result card
  const mins = Math.round(reward.boostMinutes * 10) / 10;
  const stamp = reward.tier !== 'relaxed'
    ? stampSvg(TIER_LABEL[reward.tier], { tone: STAMP_TONE[reward.tier], size: 64, double: reward.tier === 'master' })
    : '';
  const headline = found.length ? 'Solved: a new tint is yours' : 'Solved. Beautifully graded';
  const detail = found.length ? 'Your catalog just grew.' : 'A gentle boost is yours all the same.';
  const card = h`<div class="card pz-result" data-result>
<div class="row gr-result-top"><div class="grow"><div class="hl">${headline}</div><div class="hint">${detail}</div></div>${stamp}</div>
${tintRows(found, reward)}
<ul class="lines">
<li>${iconSvg('coin', { size: 18 })}<span><b class="num" data-coins>+0</b> coins</span></li>
<li>${iconSvg('check', { size: 18 })}<span>+${mins} ${mins === 1 ? 'minute' : 'minutes'} of faster mixing</span></li>
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
  if (G.el.tools) G.el.tools.hidden = true; // the result and its next steps take the room
  const coinsEl = ROOT.querySelector('[data-coins]');
  if (coinsEl) C.fx.rollNumber(coinsEl, 0, reward.coins, { ms: 600, format: (v) => `+${coinsText(C, v)}` });
  // After her first solved board: two equal ways on, once the naming (if any) is over.
  if (G.offer) G.offer.stop();
  const tint = found[0] || null;
  const result = G.result;
  G.offer = offerWhatsNext(C, {
    screen: 'grading',
    id: 'gradingNext',
    delay: 1500,
    tries: 400,
    ok: () => G.result === result,
    title: 'Your first board, graded',
    body: 'Solved boards find new tints and give a gentle boost.',
    more: { label: 'Another board', run: () => again() },
    next: { label: tint ? 'See the new tint in your catalog' : 'See your catalog', run: () => C.navigate('catalog', tint ? { colorId: tint.colorId } : {}) },
  });
}

function again() {
  clearTimers();
  if (G.offer) { G.offer.stop(); G.offer = null; }
  const tier = G.result && G.result.reward && TIER_IDS.includes(G.result.reward.tier) ? G.result.reward.tier : rememberedTier(C.game.state);
  G.result = null;
  G.celebrating = false;
  C.game.act((s, _a, now) => createGradingBoard(C, s, { tier }, now));
  G.board = activeOf(C.game.state).grading;
  drawAll();
}

// ---------------------------------------------------------------------------
// First-open guide (docs/PLAN-v0.2 Theme D)
// ---------------------------------------------------------------------------

function startGuide() {
  stopGuide();
  if (typeof C.guide !== 'function' || !G.board) return;
  const st = C.game.state;
  if (!(st.onboarding && st.onboarding.seen && st.onboarding.seen.grading) && Number(st.lifetime && st.lifetime.puzzles) >= 1) {
    C.game.act(markGuideSeen, { id: 'grading' }); // an old hand: she has solved a board
    C.game.act(markGuideSeen, { id: 'gradingNext' });
    return;
  }
  G.guide = C.guide('grading', [
    { anchor: '[data-coach="grading-board"]', text: 'Swap tiles until the gradient flows', endsOn: 'action', done: () => G.swapped, side: 'above' },
    { anchor: '[data-coach="grading-hear"]', text: 'Hear it: a solved board sounds like a scale', endsOn: 'got-it', when: () => G.swapped, side: 'below' },
  ], { screen: 'grading' });
  G.startTimer = setTimeout(() => { if (G.guide) G.guide.start(); }, 300);
}

function stopGuide() {
  clearTimeout(G.startTimer);
  if (G.guide) { try { G.guide.stop(); } catch (e) { /* ignore */ } G.guide = null; }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function onClick(e) {
  if (e.target.closest('[data-guide-replay]')) G.swapped = false; // "How this works" starts the guide over
  const a = e.target.closest('[data-action]');
  if (a && ROOT.contains(a)) {
    const act = a.dataset.action;
    if (act === 'hear') hear();
    else if (act === 'tier-sheet') tierSheet();
    else if (act === 'again') again();
    else if (act === 'done') { G.result = null; C.back(); }
    return;
  }
  // Pointer taps on movable tiles arrive through fx.drag's onTap (pointerup); a keyboard press arrives as a
  // click with detail 0. A fixed tile never starts a drag, so its tap (and its keys) answer here.
  const tile = e.target.closest('.gr-tile');
  if (!tile || tile.classList.contains('is-void')) return;
  const p = Number(tile.dataset.p);
  if (!movable(p)) { if (!G.busy && !G.celebrating && !G.result) C.audio.tick('blocked'); return; }
  if (e.detail === 0) tap(p);
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
      if (G.celebrating) { skip(); return; }
      if (e.target.closest('.gr-tile')) G.pressed = true;
    }, true);
    const release = () => { G.pressed = false; };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-grid]')) e.preventDefault(); });
    // Tiles are dragged by handle: one listener set on the section, board geometry measured per drag.
    G.dragH = C.fx.drag(root, {
      handle: '.gr-tile.fx-draggable',
      source: (el) => Number(el.dataset.p),
      board: () => (G.board && G.tiles.length ? C.fx.measureGrid(G.tiles, G.board.cols) : null),
      canStart: () => !G.busy && !G.celebrating && !G.result && !!G.board,
      ghost: ghostFor,
      onStart: onDragStart,
      onMove: onDragMove,
      onDrop: onDragDrop,
      onCancel: onDragCancel,
      onTap: (info) => tap(info.from),
    });
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
    G.swapped = false;
    drawAll();
    startGuide();
  },

  hide() {
    G.visible = false;
    stopGuide();
    if (G.offer) { G.offer.stop(); G.offer = null; }
    clearTimers();
    if (G.celebrating) {
      // Leaving mid-celebration still pays out the tints.
      G.celebrating = false;
      C.game.act((s, _a, now) => flushTints(C, s, now));
    }
    G.result = null;
    G.pressed = false;
    stopHear();
    if (G.dragH && G.dragH.active) G.dragH.cancel();
  },

  render(state) {
    if (ROOT && G.visible && G.result) { refreshNames(); return; }
    if (!ROOT || !G.visible || G.busy || G.celebrating || G.pressed || (G.dragH && G.dragH.active)) return;
    const b = activeOf(state).grading || null;
    const cb = !!(state.settings && state.settings.colorblind);
    if (b !== G.board || (b && b.moves !== G.moves) || cb !== G.cb) {
      G.board = b;
      drawAll();
    }
  },
};
