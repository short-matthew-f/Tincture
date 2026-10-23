// Skein Stacks: UI, drag, rendering and animation. Rules live in rules.js (pure).
import {
  LEVELS, COLORS, HANK, board, topRun, bands, newSession, sessionPlace, sessionClear, sessionSwap,
  sessionUndo, situation, goalOwed, hankName, bestPlacement,
} from './rules.js';

const KEY = 'tincture.proto.skeins';
const SAVE_HISTORY = 120; // undo is unlimited in memory; the save keeps the last 120 steps
const HOP_MS = 70;        // one tile hop
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 1);

const GLYPH_SVG = {
  dot: '<circle cx="12" cy="12" r="5.5"/>',
  diamond: '<path d="M12 4 20 12 12 20 4 12z"/>',
  ring: '<circle class="st" cx="12" cy="12" r="6"/>',
  wave: '<path class="st" d="M3.5 13c2.4-4.4 4.3-4.4 6.5 0s4.1 4.4 6.5 0c1-1.8 2-2.6 3.3-3"/>',
  heart: '<path d="M12 20 4.6 12.8A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.4 5.6z"/>',
  leaf: '<path d="M5.5 18.5C5 10 10 5 19 5.2 19.3 13.5 14 18.8 5.5 18.5z"/>',
};
const glyph = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH_SVG[COLORS[c].glyph]}</svg>`;
const hex = (c) => COLORS[c].hex;

// A twisted hank: a figure-eight of yarn, tied in the middle.
function skeinSVG(c) {
  const col = hex(c);
  return `<svg viewBox="0 0 66 40" aria-hidden="true">
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="${col}"/>
    <path d="M10 20C10 11 24 9 31 17M10 21C11 29 24 31 31 23M56 20C56 11 42 9 35 17M56 21C55 29 42 31 35 23" fill="none" stroke="rgba(255,250,235,.38)" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M14 20C15 14 23 13 29 18M14 21C15 26 23 27 29 22M52 20C51 14 43 13 37 18M52 21C51 26 43 27 37 22" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
    <rect x="29.5" y="11" width="7" height="18" rx="2.5" fill="#EFE6D2" stroke="rgba(42,38,34,.35)" stroke-width="1"/>
    <path d="M30 16h6M30 20h6M30 24h6" stroke="rgba(42,38,34,.3)" stroke-width="1"/>
  </svg>`;
}

// ---------- save ----------
let S = { v: 1, li: 0, glyphs: false, finished: {}, notes: {}, sess: null, other: {} };
const randSeed = () => ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0) || 1;

function validSess(sess, li) {
  return sess && sess.state && sess.state.v === 1 && sess.state.level === li && Array.isArray(sess.state.stacks) &&
    sess.state.stacks.length === board(li).cells.length && Array.isArray(sess.state.tray) && Array.isArray(sess.past) && sess.stats;
}
function save() {
  try {
    const sess = S.sess && { ...S.sess, past: S.sess.past.slice(-SAVE_HISTORY) };
    localStorage.setItem(KEY, JSON.stringify({ ...S, sess }));
  } catch { /* storage may be blocked; the game still plays */ }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (!o || o.v !== 1 || !(o.li >= 0 && o.li < LEVELS.length)) return;
    S = { ...S, ...o, finished: o.finished || {}, notes: o.notes || {}, other: o.other || {} };
    if (!validSess(S.sess, S.li)) S.sess = null;
  } catch { /* start fresh */ }
}
const st = () => S.sess.state;

// ---------- ui state ----------
let busy = false, sel = -1, clearMode = false, drag = null;
let view = null, trayView = null, hanksView = null; // overrides while animating
let note = '', busyMsg = '', doneShown = false;
let L = null; // layout

// ---------- layout ----------
const boardEl = $('#board');
function layout() {
  const b = board(S.li);
  const units = Math.max(...b.cells.map((c) => c.col + (c.row & 1) * 0.5)) + 1;
  const K = 0.98; // a slightly tilted table: hexes a touch shorter than true
  const vw = document.documentElement.clientWidth;
  const availW = Math.min(vw, 460) - 24 - 20;
  const top = $('#boardWrap').getBoundingClientRect().top + scrollY;
  const dockH = $('#dock').offsetHeight || 190;
  const availH = Math.max(220, innerHeight - dockH - top - 22);
  const rise = 0.62; // room above the top row for tall piles
  let w = Math.min(64, availW / units, availH / (rise + (b.rows - 1) * 0.75 * K + K));
  w = Math.max(34, Math.floor(w));
  const hs = w * K, step = hs * 0.75, pad = w * rise;
  const pos = b.cells.map((c) => ({ x: (c.col + (c.row & 1) * 0.5) * w + w / 2, y: pad + c.row * step + hs / 2 }));
  return { b, w, hs, pw: w * 0.93, ph: hs * 0.93, W: units * w, H: pad + (b.rows - 1) * step + hs, pos };
}
const dl = (len, w = L.w) => Math.min(w * 0.08, (w * 0.6) / Math.max(1, len));

function stackHTML(stack, { pw, ph, w, badge = true, lit = 0, d } = {}) {
  if (!stack || !stack.length) return '';
  const n = stack.length;
  const step = d ?? dl(n, w);
  let h = `<div class="stack" style="width:${pw}px;height:${ph}px">`;
  stack.forEach((c, i) => {
    const isTop = i === n - 1;
    h += `<div class="ly${isTop ? ' top' : ''}${i >= n - lit ? ' lit' : ''}" style="--c:${hex(c)};transform:translateY(${(-i * step).toFixed(1)}px)"></div>`;
  });
  if (badge) {
    const run = topRun(stack), c = stack[n - 1];
    h += `<span class="badge${run >= HANK - 3 ? ' near' : ''}" style="--c:${hex(c)};margin-top:${(-(n - 1) * step).toFixed(1)}px">${S.glyphs ? glyph(c) : ''}${run}</span>`;
  }
  return h + '</div>';
}

const stacksNow = () => view || st().stacks;
function pegLabel(i) {
  const s = stacksNow()[i];
  if (s === null) return `Knot ${i + 1}`;
  if (!s.length) return `Peg ${i + 1}, empty`;
  return `Peg ${i + 1}: ${topRun(s)} ${COLORS[s[s.length - 1]].name} on top, ${s.length} in all`;
}
function pegClass(i) {
  const s = stacksNow()[i];
  let c = 'peg';
  if (s === null) c += ' knot';
  else if (!s.length && (sel >= 0 || drag) && !busy) c += ' open';
  if (drag && drag.target === i) c += ' target';
  return c;
}
function renderBoard() {
  L = layout();
  boardEl.style.width = L.W + 'px';
  boardEl.style.height = L.H + 'px';
  const stacks = stacksNow();
  let h = '<div class="table"></div>';
  L.b.cells.forEach((cell, i) => {
    const p = L.pos[i];
    h += `<button type="button" class="${pegClass(i)}" data-cell="${i}" ${cell.knot ? 'disabled' : ''} aria-label="${pegLabel(i)}"
      style="left:${(p.x - L.pw / 2).toFixed(1)}px;top:${(p.y - L.ph / 2).toFixed(1)}px;width:${L.pw.toFixed(1)}px;height:${L.ph.toFixed(1)}px;z-index:${cell.row * 2 + 1}">
      <span class="hole"></span>${stackHTML(stacks[i], L)}</button>`;
  });
  boardEl.innerHTML = h;
}
function renderCell(i, lit = 0) {
  const el = $(`.peg[data-cell="${i}"]`, boardEl);
  if (!el) return;
  const old = $('.stack', el);
  if (old) old.remove();
  el.insertAdjacentHTML('beforeend', stackHTML(stacksNow()[i], { ...L, lit }));
  el.setAttribute('aria-label', pegLabel(i));
  el.className = pegClass(i);
}
function refreshPegClasses() {
  $$('.peg', boardEl).forEach((el) => { el.className = pegClass(+el.dataset.cell); });
}

function renderTray() {
  const tray = trayView || st().tray;
  const slotW = ($('#tray').clientWidth - 16) / 3 || 100;
  const w = Math.min(56, Math.max(40, slotW * 0.52));
  const opts = { pw: w * 0.93, ph: w * 0.98 * 0.93, w, d: 6.5, badge: false };
  $('#tray').innerHTML = tray.map((s, t) => {
    if (!s) return `<button type="button" class="tslot empty" data-t="${t}" aria-label="Tray spot ${t + 1}, used" disabled></button>`;
    const bl = S.glyphs ? `<span class="bandlist" style="flex-direction:row-reverse">${bands(s).map((b) => `<span style="--c:${hex(b.c)}">${glyph(b.c)}${b.n}</span>`).join('')}</span>` : '';
    const desc = bands(s).slice().reverse().map((b) => `${b.n} ${COLORS[b.c].name}`).join(' over ');
    const lift = S.glyphs ? 16 : 6;
    return `<button type="button" class="tslot${sel === t ? ' sel' : ''}${drag && drag.t === t && drag.moved ? ' lifted' : ''}" data-t="${t}" aria-pressed="${sel === t}" aria-label="Tray stack: ${desc}">
      <span style="position:absolute;left:50%;bottom:${lift}px;transform:translateX(-50%);width:${opts.pw}px;height:${opts.ph}px;display:block">${stackHTML(s, opts)}</span>${bl}</button>`;
  }).join('');
}

function renderGoal() {
  const lv = LEVELS[S.li];
  const hanks = hanksView || st().hanks;
  $('#levelBtn').textContent = `Level ${S.li + 1}`;
  $('#lvlName').textContent = `Level ${S.li + 1} · ${lv.name}`;
  $('#count').innerHTML = `${Math.min(hanks.length, lv.goal.hanks)}<small>of ${lv.goal.hanks} hanks</small>`;
  let sl = '';
  for (let i = 0; i < lv.goal.hanks; i++) sl += i < hanks.length ? `<span class="slot on" style="--c:${hex(hanks[i])}"></span>` : '<span class="slot"></span>';
  $('#slots').innerHTML = sl;
  const want = lv.goal.colors || {};
  $('#chips').innerHTML = Object.keys(want).map((c) => {
    const have = hanks.filter((h) => h === +c).length;
    return `<span class="chip${have >= want[c] ? ' met' : ''}"><span class="dot" style="--c:${hex(+c)}">${S.glyphs ? glyph(+c) : ''}</span>${COLORS[c].name}: ${Math.min(have, want[c])} of ${want[c]}</span>`;
  }).join('');
}

function renderActions() {
  const s = st();
  const sit = situation(s);
  const canUndo = S.sess.past.length > 0;
  let msg = note || 'Drag a stack from the tray onto an empty peg.';
  const btns = [];
  if (busy) { msg = busyMsg || 'Sliding together.'; }
  else if (s.done) { msg = 'Level finished. Lovely work.'; btns.push('<button type="button" class="btn small primary" data-act="shelf">See your shelf</button>'); }
  else if (clearMode) { msg = 'Tap a stack to set it aside. It just leaves the board.'; btns.push('<button type="button" class="btn small" data-act="cancel">Keep them all</button>'); }
  else {
    if (sit === 'stuck') msg = 'The board is full. Undo, or take a free nudge.';
    else if (sit === 'tight') msg = 'Getting snug. A free nudge is here if you like.';
    else if (sel >= 0) msg = 'Now tap an empty peg for that stack.';
    if (canUndo) btns.push('<button type="button" class="btn small" data-act="undo">Undo</button>');
    if (sit === 'stuck' || sit === 'tight') {
      btns.push('<button type="button" class="btn small primary" data-act="clear">Clear a peg</button>');
      if (s.tray.some(Boolean)) btns.push('<button type="button" class="btn small" data-act="swap">Swap the tray</button>');
    }
  }
  $('#msg').textContent = msg;
  $('#btns').innerHTML = btns.join('');
  $('#actions').classList.toggle('wide', btns.length > 1);
}

function renderNotes() {
  const rows = LEVELS.map((lv, i) => {
    const n = S.notes[i];
    return n ? `Level ${i + 1}: finished ${n.finishes}x, ${n.moves} moves, ${n.undos} undos, ${n.clears} pegs cleared, ${n.swaps} tray swaps` : null;
  }).filter(Boolean);
  const c = S.sess.stats;
  rows.push(`This try: ${c.moves} moves, ${c.undos} undos, ${c.clears} pegs cleared, ${c.swaps} tray swaps`);
  $('#notes').innerHTML = rows.join('<br>');
}

function renderAll() {
  renderGoal();
  renderBoard();
  renderTray();
  renderActions();
  renderNotes();
  $('#glyphBtn').setAttribute('aria-pressed', String(S.glyphs));
  $('#glyphBtn').textContent = `Color symbols: ${S.glyphs ? 'on' : 'off'}`;
}

// ---------- animation helpers (always time-bounded; t is clamped) ----------
function tween(ms, stepFn) {
  return new Promise((resolve) => {
    let finished = false;
    const fin = () => { if (!finished) { finished = true; resolve(); } };
    const t0 = performance.now();
    const frame = (now) => {
      if (finished) return;
      const t = clamp01((now - t0) / ms);
      try { stepFn(t); } catch (err) { console.error(err); fin(); return; }
      if (t < 1) requestAnimationFrame(frame); else fin();
    };
    requestAnimationFrame(frame);
    setTimeout(fin, ms + 300); // a hidden tab never leaves us waiting
  });
}
function waapi(el, frames, opts) {
  if (!el || !el.animate) return Promise.resolve();
  const a = el.animate(frames, opts);
  return Promise.race([a.finished.catch(() => {}), sleep((opts.duration || 0) + (opts.delay || 0) + 200)]);
}
const fxBoard = (html, cls) => {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  boardEl.append(el);
  return el;
};
// keep a centered pill inside the board's width
function placePill(el, x, y) {
  const half = el.offsetWidth / 2;
  const lo = half - 8, hi = L.W - half + 8;
  el.style.left = (lo > hi ? L.W / 2 : Math.min(hi, Math.max(lo, x))) + 'px';
  el.style.top = y + 'px';
}
// top-of-pile center for peg i with `len` tiles, layer index k
const layerY = (i, k, len) => L.pos[i].y - k * dl(len);

async function hop(from, to, c) {
  const nFrom = view[from].length, nTo = view[to].length; // view[from] already lost the tile
  const x0 = L.pos[from].x, y0 = layerY(from, nFrom, nFrom + 1);
  const x1 = L.pos[to].x, y1 = layerY(to, nTo, nTo + 1);
  const el = fxBoard(`<div class="ly top" style="--c:${hex(c)};position:absolute;inset:0"></div>`, 'hop');
  Object.assign(el.style, { left: (x0 - L.pw / 2) + 'px', top: (y0 - L.ph / 2) + 'px', width: L.pw + 'px', height: L.ph + 'px', zIndex: 900 });
  const arc = L.w * 0.32;
  await tween(HOP_MS, (t) => {
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    el.style.transform = `translate(${((x1 - x0) * e).toFixed(1)}px, ${((y1 - y0) * e - arc * Math.sin(Math.PI * t)).toFixed(1)}px)`;
  });
  el.remove();
}

function chainPop(i, text) {
  if (reduced()) return;
  const p = L.pos[i];
  const el = fxBoard(text, 'chain');
  placePill(el, p.x, Math.max(-6, p.y - L.w * 1.15));
  waapi(el, [{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'translate(-50%, -18px)' }], { duration: 900, easing: 'ease-out' }).then(() => el.remove());
}

async function bundleFx({ cell, color, n }) {
  renderCell(cell, n); // the run glows
  await sleep(reduced() ? 120 : 200);
  view[cell].length -= n;
  renderCell(cell);
  const p = L.pos[cell];
  const y = layerY(cell, view[cell].length, view[cell].length + 1);
  const label = fxBoard(hankName(color), 'label');
  placePill(label, p.x, Math.max(-6, y - L.w * 1.05 - 10));
  $('#msg').textContent = `${hankName(color)}, bundled.`;
  const sk = fxBoard(skeinSVG(color), 'hank');
  Object.assign(sk.style, { left: (p.x - 33) + 'px', top: (y - 20) + 'px' });
  const labelOut = () => waapi(label, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -8px)' }], { duration: 260, fill: 'forwards' }).then(() => label.remove());
  if (reduced()) {
    await sleep(650);
  } else {
    waapi(label, [{ opacity: 0, transform: 'translate(-50%, 8px) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1.06)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 320, easing: 'ease-out' });
    // twist and tie
    await waapi(sk, [
      { transform: 'scale(.35, .9) rotate(-160deg)', opacity: 0 },
      { transform: 'scale(1.2, .7) rotate(-20deg)', opacity: 1, offset: 0.55 },
      { transform: 'scale(.92, 1.1) rotate(8deg)', offset: 0.8 },
      { transform: 'scale(1) rotate(0)' },
    ], { duration: 520, easing: 'ease-out' });
    await sleep(260);
    // off to the goal shelf
    const slot = $$('#slots .slot')[hanksView.length] || $('#count');
    const sr = slot.getBoundingClientRect(), br = boardEl.getBoundingClientRect();
    const dx = sr.left + sr.width / 2 - (br.left + p.x), dy = sr.top + sr.height / 2 - (br.top + y);
    await waapi(sk, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0.6 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
  }
  sk.remove();
  labelOut();
  hanksView.push(color);
  renderGoal();
  const slot = $$('#slots .slot.on').at(-1);
  if (slot && !reduced()) slot.classList.add('pop');
}

async function playSteps(steps) {
  let moves = 0;
  for (const step of steps) {
    if (step.type === 'move') {
      moves++;
      if (moves === 2) chainPop(step.to, 'A chain!');
      else if (moves > 2) chainPop(step.to, `Chain of ${moves}`);
      busyMsg = moves > 1 ? `Chain of ${moves}.` : 'Sliding together.';
      $('#msg').textContent = busyMsg;
      if (reduced()) {
        for (let k = 0; k < step.n; k++) view[step.to].push(view[step.from].pop());
        renderCell(step.from); renderCell(step.to);
        await sleep(160);
        continue;
      }
      for (let k = 0; k < step.n; k++) {
        const c = view[step.from].pop();
        renderCell(step.from);
        await hop(step.from, step.to, c);
        view[step.to].push(c);
        renderCell(step.to);
      }
      await sleep(110);
    } else if (step.type === 'bundle') {
      await bundleFx(step);
    }
  }
  return moves;
}

// Every animated action goes through here: busy is always reset.
async function run(fn) {
  if (busy) return;
  busy = true;
  renderActions();
  try {
    await fn();
  } catch (err) {
    console.error(err);
  } finally {
    $$('.hop, .hank, .label, .chain', boardEl).forEach((el) => el.remove());
    busy = false; busyMsg = '';
    view = null; trayView = null; hanksView = null;
    save();
    renderAll();
  }
  if (st().done && !doneShown) showDone();
}

// ---------- actions ----------
function doPlace(t, cell) {
  return run(async () => {
    const before = st();
    const r = sessionPlace(S.sess, t, cell);
    if (!r.ok) return;
    S.sess = r.session;
    sel = -1; clearMode = false; note = '';
    view = before.stacks.map((s) => (s ? s.slice() : s));
    view[cell] = before.tray[t].slice();
    trayView = before.tray.map((s, i) => (i === t ? null : s));
    hanksView = before.hanks.slice();
    save(); // a reload mid-flight keeps the move
    renderBoard();
    renderTray();
    const pegStack = $(`.peg[data-cell="${cell}"] .stack`, boardEl);
    if (!reduced()) await waapi(pegStack, [{ transform: 'translateY(-14px) scale(1.06)' }, { transform: 'translateY(2px) scale(.98)', offset: 0.7 }, { transform: 'none' }], { duration: 170, easing: 'ease-out' });
    const moves = await playSteps(r.steps);
    const owedLeft = LEVELS[S.li].goal.hanks - r.state.hanks.length;
    if (r.hanks.length) note = owedLeft > 0 ? `${r.hanks.map(hankName).join(', ')}! ${owedLeft} more to go.` : `${hankName(r.hanks.at(-1))}! That is the goal.`;
    else if (moves > 1) note = `A chain of ${moves} slides.`;
    else note = '';
    const owed = goalOwed(r.state);
    const still = Object.keys(owed).filter((c) => owed[c] > 0);
    if (r.hanks.length && owedLeft <= 0 && still.length) note = `Lovely. Still to bundle: ${still.map((c) => `${owed[c]} ${COLORS[c].name}`).join(', ')}.`;
    if (r.refilled) {
      trayView = null;
      renderTray();
      if (!reduced()) await Promise.all($$('#tray .tslot .stack').map((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 60, fill: 'backwards' })));
    }
  });
}

function doClear(cell) {
  return run(async () => {
    const r = sessionClear(S.sess, cell);
    if (!r.ok) return;
    const el = $(`.peg[data-cell="${cell}"] .stack`, boardEl);
    clearMode = false;
    if (el && !reduced()) await waapi(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-24px) scale(.9)' }], { duration: 260, fill: 'forwards' });
    S.sess = r.session;
    note = 'Set aside. There is room again.';
  });
}

function doSwap() {
  return run(async () => {
    const r = sessionSwap(S.sess);
    if (!r.ok) return;
    S.sess = r.session;
    sel = -1; note = 'A fresh tray.';
    renderTray();
    if (!reduced()) await Promise.all($$('#tray .tslot .stack').map((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 60, fill: 'backwards' })));
  });
}

function doUndo() {
  if (busy) return;
  const r = sessionUndo(S.sess);
  if (!r.ok) return;
  S.sess = r.session;
  sel = -1; clearMode = false; note = 'Undone.';
  save(); renderAll();
}

// ---------- levels and the shelf ----------
function startLevel(li, { fresh = false } = {}) {
  if (S.sess) S.other[S.li] = { state: S.sess.state, stats: S.sess.stats };
  S.li = li;
  const o = S.other[li];
  S.sess = !fresh && o && validSess({ ...o, past: [] }, li) && !o.state.done ? { state: o.state, past: [], stats: o.stats } : newSession(li, randSeed());
  delete S.other[li];
  sel = -1; clearMode = false; note = ''; doneShown = false;
  save(); renderAll();
  window.scrollTo(0, 0);
}

function showDone() {
  doneShown = true;
  const s = st();
  const n = S.notes[S.li] || { finishes: 0, moves: 0, undos: 0, clears: 0, swaps: 0 };
  const c = S.sess.stats;
  S.notes[S.li] = { finishes: n.finishes + 1, moves: n.moves + c.moves, undos: n.undos + c.undos, clears: n.clears + c.clears, swaps: n.swaps + c.swaps };
  S.finished[S.li] = true;
  save();
  const counts = COLORS.map((_, k) => s.hanks.filter((h) => h === k).length);
  const piles = counts.map((cnt, k) => (cnt ? `<div class="pile"><div class="sk">${skeinSVG(k).repeat(Math.min(cnt, 4))}</div><span class="tag">${COLORS[k].name}<small>${cnt} ${cnt > 1 ? 'hanks' : 'hank'}</small></span></div>` : '')).filter(Boolean);
  // three piles to a shelf board
  let rows = '';
  for (let i = 0; i < piles.length; i += 3) rows += `<div class="row">${piles.slice(i, i + 3).join('')}</div>`;
  $('#shelf').innerHTML = rows;
  $('#doneTitle').textContent = `${LEVELS[S.li].name}: finished`;
  $('#doneSub').textContent = `You bundled ${s.hanks.length} hanks. Here they are on the shelf.`;
  const last = S.li === LEVELS.length - 1;
  $('#nextBtn').textContent = last ? 'Back to level 1' : `Next: level ${S.li + 2}`;
  $('#done').hidden = false;
  if (!reduced()) $$('#shelf .sk svg').forEach((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 70, fill: 'backwards', easing: 'ease-out' }));
  $('#nextBtn').focus();
}

function openLevels() {
  $('#levelList').innerHTML = LEVELS.map((lv, i) => {
    const goal = `${lv.goal.hanks} hanks, ${lv.colors} colors${lv.goal.colors ? ', some in set colors' : ''}`;
    return `<li><button type="button" data-level="${i}" class="${i === S.li ? 'cur' : ''}"><span class="n">${i + 1}</span><span class="t">${lv.name}<small>${goal}</small></span><span class="mark">${S.finished[i] ? skeinSVG(i % COLORS.length) : ''}</span></button></li>`;
  }).join('');
  $('#levels').hidden = false;
  const cur = $('#levelList .cur');
  if (cur) cur.focus();
}

// ---------- input: tray drag and tap ----------
const LIFT = 58; // the stack rides above her finger so she can see the peg
function pegAtPoint(x, y) {
  const br = boardEl.getBoundingClientRect();
  let best = -1, bd = Infinity;
  const stacks = st().stacks;
  L.pos.forEach((p, i) => {
    if (!stacks[i] || stacks[i].length) return;
    const d = Math.hypot(br.left + p.x - x, br.top + p.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  return bd <= L.w * 0.85 ? best : -1;
}
function ghostPos(e) { return { x: e.clientX, y: e.clientY - LIFT }; }

$('#tray').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.tslot');
  if (!el || busy || st().done || drag) return;
  const t = +el.dataset.t;
  if (!st().tray[t]) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch { /* not all pointers capture */ }
  drag = { t, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, target: -1, ghost: null };
});
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
    drag.moved = true;
    clearMode = false; sel = -1;
    const g = document.createElement('div');
    g.className = 'ghost';
    g.style.width = L.pw + 'px'; g.style.height = L.ph + 'px';
    g.innerHTML = stackHTML(st().tray[drag.t], { ...L, badge: false });
    $('#fx').append(g);
    drag.ghost = g;
    // keep the captured slot element alive: toggle classes, do not re-render the tray
    $$('.tslot').forEach((el) => el.classList.remove('sel'));
    const slotEl = $(`.tslot[data-t="${drag.t}"]`);
    if (slotEl) slotEl.classList.add('lifted');
    refreshPegClasses();
    renderActions();
  }
  const p = ghostPos(e);
  drag.ghost.style.transform = `translate(${(p.x - L.pw / 2).toFixed(1)}px, ${(p.y - L.ph / 2).toFixed(1)}px)`;
  const tg = pegAtPoint(p.x, p.y);
  if (tg !== drag.target) { drag.target = tg; refreshPegClasses(); }
});
async function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  if (!d.moved) {
    drag = null;
    if (!cancelled) { sel = sel === d.t ? -1 : d.t; clearMode = false; renderTray(); refreshPegClasses(); renderActions(); }
    return;
  }
  const target = cancelled ? -1 : d.target;
  if (target >= 0) {
    d.ghost.remove();
    drag = null;
    await doPlace(d.t, target);
    return;
  }
  // back to the tray
  const slot = $(`.tslot[data-t="${d.t}"]`).getBoundingClientRect();
  if (!reduced()) {
    await waapi(d.ghost, [{ transform: d.ghost.style.transform }, { transform: `translate(${slot.left + slot.width / 2 - L.pw / 2}px, ${slot.top + slot.height / 2 - L.ph / 2}px) scale(.9)`, opacity: 0.4 }], { duration: 180, easing: 'ease-in' });
  }
  d.ghost.remove();
  drag = null;
  renderTray(); refreshPegClasses(); renderActions();
}
addEventListener('pointerup', (e) => endDrag(e, false));
addEventListener('pointercancel', (e) => endDrag(e, true));
// keyboard: Enter/Space on a tray stack selects it
$('#tray').addEventListener('click', (e) => {
  const el = e.target.closest('.tslot');
  if (!el || e.detail !== 0 || busy) return;
  const t = +el.dataset.t;
  if (!st().tray[t]) return;
  sel = sel === t ? -1 : t; clearMode = false;
  renderTray(); refreshPegClasses(); renderActions();
});

boardEl.addEventListener('click', (e) => {
  const el = e.target.closest('.peg');
  if (!el || busy || st().done) return;
  const i = +el.dataset.cell;
  const s = st().stacks[i];
  if (clearMode) { if (s && s.length) doClear(i); return; }
  if (sel >= 0 && s && !s.length) doPlace(sel, i);
});

$('#btns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || busy) return;
  const a = b.dataset.act;
  if (a === 'undo') doUndo();
  else if (a === 'clear') { clearMode = true; sel = -1; renderAll(); }
  else if (a === 'cancel') { clearMode = false; renderAll(); }
  else if (a === 'swap') doSwap();
  else if (a === 'shelf') { doneShown = false; showDone(); }
});
$('#glyphBtn').addEventListener('click', () => { S.glyphs = !S.glyphs; save(); renderAll(); });
let confirmRestart = 0;
$('#restartBtn').addEventListener('click', () => {
  if (busy) return;
  if (!confirmRestart && st().moves > 0 && !st().done) {
    $('#restartBtn').textContent = 'Tap again to start over';
    confirmRestart = setTimeout(() => { confirmRestart = 0; $('#restartBtn').textContent = 'Start this level over'; }, 3000);
    return;
  }
  clearTimeout(confirmRestart); confirmRestart = 0;
  $('#restartBtn').textContent = 'Start this level over';
  startLevel(S.li, { fresh: true });
});
$('#levelBtn').addEventListener('click', () => { if (!busy) openLevels(); });
$('#levelsClose').addEventListener('click', () => { $('#levels').hidden = true; });
$('#levelList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  $('#levels').hidden = true;
  if (+b.dataset.level !== S.li) startLevel(+b.dataset.level);
});
$('#nextBtn').addEventListener('click', () => { $('#done').hidden = true; startLevel((S.li + 1) % LEVELS.length, { fresh: true }); });
$('#againBtn').addEventListener('click', () => { $('#done').hidden = true; startLevel(S.li, { fresh: true }); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#levels').hidden) $('#levels').hidden = true;
  else if (sel >= 0 || clearMode) { sel = -1; clearMode = false; renderAll(); }
});

let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!busy && !drag) renderAll(); }, 120); });
try {
  new ResizeObserver(() => document.body.style.setProperty('--dockH', $('#dock').offsetHeight + 'px')).observe($('#dock'));
} catch { /* older browsers keep the default padding */ }

// ---------- start ----------
load();
if (!S.sess) S.sess = newSession(S.li, randSeed());
save();
renderAll();
if (st().done) doneShown = true; // the bar offers "See your shelf"

// For the playtest harness: read-only peeks.
window.__skeins = {
  get state() { return st(); },
  get busy() { return busy; },
  get stats() { return S.sess.stats; },
  best: () => bestPlacement(st()),
  pegCenter(i) { const r = boardEl.getBoundingClientRect(); return { x: r.left + L.pos[i].x, y: r.top + L.pos[i].y }; },
  liftPx: LIFT,
  situation: () => situation(st()),
};
