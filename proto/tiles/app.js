// The Tile Room: UI, rendering and animation. Rules live in rules.js (pure).
import {
  COLORS, GLYPHS, SECOND_VALUE, newGame, take, legalLines, rivalTurn, endRound, dealRound,
  roundOver, finalScore, coinValue, wallColor,
} from './rules.js';

const KEY = 'tincture.proto.tiles';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GLYPH_SVG = {
  dot: '<circle cx="12" cy="12" r="4.8"/>',
  diamond: '<path d="M12 5 19 12 12 19 5 12z"/>',
  ring: '<circle cx="12" cy="12" r="5.4" style="fill:none;stroke:var(--g);stroke-width:2.6"/>',
  leaf: '<path d="M6 18C5.5 10 10.5 5.5 18.5 5.8 18.8 13.5 14 18.6 6 18z"/><path d="M7 17.2 14 10" style="stroke:rgba(0,0,0,.35);stroke-width:1.2;fill:none;stroke-linecap:round"/>',
  wave: '<path d="M4.5 12.5c2.2-4 4-4 6 0s3.8 4 6 0c.9-1.6 1.8-2.4 3-2.8" style="fill:none;stroke:var(--g);stroke-width:2.6;stroke-linecap:round"/>',
};
const glyph = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH_SVG[GLYPHS[c]]}</svg>`;
const label = (c) => `${COLORS[c]} ${GLYPHS[c]}`;

function tile(c, { tag = 'span', cls = '', attrs = '' } = {}) {
  const t = tag === 'button' ? ' type="button"' : '';
  return `<${tag}${t} class="tile c${c} ${cls}" data-c="${c}" ${attrs}>${glyph(c)}</${tag}>`;
}

// ---------- state ----------
let G, sel = null, undoSnap = null, pending = false, busy = false, timer = 0;
let idaMsg = 'Morning! I take the dish with the most of one glaze. Ties go to the left.';
let confirmNew = 0, busyMsg = '';

const randSeed = () => ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0) || 1;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ g: G, undo: undoSnap, pending })); } catch { /* storage may be blocked */ }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && o.g && o.g.v === 1 && Array.isArray(o.g.dishes) && o.g.dishes.length === 5 && Array.isArray(o.g.bag)) {
      undoSnap = o.undo || null; pending = !!o.pending;
      return o.g;
    }
  } catch { /* fall through to a new game */ }
  return null;
}

// ---------- render ----------
const app = $('#app');
function wallHTML(s, cls = '') {
  let h = `<div class="wall ${cls}" role="img" aria-label="Wall mosaic">`;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const k = wallColor(r, c);
    h += `<div class="cell" data-r="${r}" data-c="${c}">${tile(k, { cls: s.wall[r][c] ? 'set' : 'ghost' })}</div>`;
  }
  return h + '</div>';
}

function hintFor() {
  if (!sel) return 'Tap a glaze in a dish or the middle to take every tile of that colour.';
  const n = sourceCount();
  const legal = legalLines(G, sel.color);
  const nm = `${n} ${COLORS[sel.color]}`;
  if (!legal.length) return `${nm}: these go to the seconds basket. Tap the basket.`;
  return `${nm}: tap a glowing pattern line, or the basket for seconds.`;
}
const sourceCount = () => (sel.source === 'center' ? G.center : G.dishes[sel.index]).filter((c) => c === sel.color).length;

function render() {
  const legal = sel ? legalLines(G, sel.color) : [];
  const fs = G.over ? finalScore(G) : null;
  $('#score').textContent = G.score;
  $('#round').textContent = `Round ${G.round}`;
  $('#ida').hidden = !G.rival || G.over;
  $('#idaMsg').hidden = !G.rival || G.over;
  $('#idaMsg').textContent = idaMsg;
  $('#idaBtn').setAttribute('aria-pressed', String(G.rival));
  $('#idaBtn').textContent = G.rival ? 'Ida: playing' : 'Ida: resting';
  $('#play').hidden = G.over;
  $('#summary').hidden = !G.over;
  $('#newBtn').textContent = confirmNew ? 'Tap again to start over' : 'New wall';
  if (G.over) { renderSummary(fs); return; }

  const canUndo = !!undoSnap && !busy;
  $('#status').innerHTML = `<span class="msg" role="status">${busy ? busyMsg : pending && !sel ? 'Placed. Ida takes a dish next. You can still change your mind.' : hintFor()}</span>` +
    (canUndo ? '<button class="btn small" type="button" data-undo>Undo</button>' : '');

  let dishes = '';
  for (let d = 0; d < 5; d++) {
    const t = G.dishes[d];
    dishes += `<div class="dish ${t.length ? '' : 'empty'}" data-dish="${d}"><span class="dn">${d + 1}</span>`;
    for (const c of t) {
      const on = sel && sel.source === 'dish' && sel.index === d && sel.color === c;
      dishes += tile(c, { tag: 'button', cls: on ? 'sel' : '', attrs: `data-src="dish" data-i="${d}" aria-label="${label(c)}, dish ${d + 1}" aria-pressed="${!!on}"` });
    }
    dishes += '</div>';
  }
  dishes += `<div class="stock"><b>Bag</b> ${G.bag.length}<br><b>Kiln shelf</b> ${G.kiln.reduce((a, b) => a + b, 0)}${G.rival ? `<br><b>Ida sold</b> ${G.rivalTiles}` : ''}</div>`;
  let center = '';
  for (const c of G.center) {
    const on = sel && sel.source === 'center' && sel.color === c;
    center += tile(c, { tag: 'button', cls: on ? 'sel' : '', attrs: `data-src="center" data-i="0" aria-label="${label(c)}, middle" aria-pressed="${!!on}"` });
  }
  $('#dishes').innerHTML = dishes;
  $('#center').innerHTML = center || '<span class="hint">The middle is empty for now.</span>';

  let lines = '';
  for (let i = 0; i < 5; i++) {
    const L = G.lines[i];
    const ok = sel && legal.includes(i);
    let slots = '';
    for (let k = 0; k <= i; k++) {
      const filled = k >= i + 1 - L.n;
      slots += `<span class="slot" data-k="${k}">${filled ? tile(L.color) : ''}</span>`;
    }
    lines += `<button type="button" class="line ${ok ? 'ok' : ''} ${sel && !ok ? 'no' : ''}" data-line="${i}" aria-label="Pattern line ${i + 1}, holds ${i + 1}${L.n ? `, has ${L.n} ${COLORS[L.color]}` : ''}">${slots}</button>`;
  }
  $('#lines').innerHTML = lines;
  $('#wallBox').innerHTML = wallHTML(G);

  const basket = $('#basket');
  basket.className = 'basket' + (sel && !legal.length ? ' ok' : '');
  $('#secTiles').innerHTML = G.seconds.map((c) => tile(c)).join('') || '<span class="hint">Empty</span>';
  $('#secVal').textContent = G.seconds.length ? `+${G.seconds.length * SECOND_VALUE}` : '+0';
}

function renderSummary(fs) {
  const coins = coinValue(fs.total);
  $('#sumWall').innerHTML = wallHTML(G, 'big');
  $$('#sumWall .tile').forEach((t, i) => {
    if (!reduced()) t.animate([{ opacity: 0, transform: 'translateY(8px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 28, fill: 'backwards', easing: 'ease-out' });
  });
  $('#sumTitle').textContent = G.exhausted ? 'The shelf is bare, and it looks lovely' : 'Your mosaic is finished';
  $('#sumBreak').innerHTML =
    `<li><span>Placed tiles and seconds</span><b>+${G.score}</b></li>` +
    `<li><span>Complete rows (${fs.rowsDone} x 2)</span><b>+${fs.rows}</b></li>` +
    `<li><span>Complete columns (${fs.colsDone} x 7)</span><b>+${fs.cols}</b></li>` +
    `<li><span>All five of a colour (${fs.colorsDone} x 10)</span><b>+${fs.colors}</b></li>`;
  $('#sumTotal').textContent = fs.total;
  $('#sumCoins').textContent = `The mosaic would sell for about ${coins} coins.`;
}

// ---------- animation ----------
const fx = $('#fx');
const rectOf = (el) => el.getBoundingClientRect();
function snapshotTiles(sel2) {
  return $$(sel2).map((el) => ({ c: +el.dataset.c, rect: rectOf(el) }));
}
function settle(el) {
  if (!el || reduced()) return;
  el.animate([{ transform: 'scale(1.14)' }, { transform: 'scale(.95)', offset: .6 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
}
// Fly a clone of a glazed tile from `from` (DOMRect) to an element (or rect). Resolves on landing.
async function fly({ from, c, toEl, toRect, delay = 0, fade = false, onLand }) {
  const to = toRect || rectOf(toEl);
  if (toEl) toEl.style.visibility = 'hidden';
  const el = document.createElement('div');
  el.className = `tile fly c${c}`;
  el.innerHTML = glyph(c);
  Object.assign(el.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
  fx.append(el);
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  const sc = to.width / from.width;
  const dist = Math.hypot(dx, dy);
  let anim;
  if (reduced()) {
    Object.assign(el.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
    anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: 'backwards' });
  } else {
    const frames = [], N = 12, arc = Math.min(70, 18 + dist * .22);
    for (let i = 0; i <= N; i++) {
      const t = i / N, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const lift = Math.sin(Math.PI * t);
      frames.push({
        transform: `translate(${dx * e}px, ${dy * e - arc * lift}px) scale(${1 + (sc - 1) * e + .08 * lift})`,
        filter: `drop-shadow(0 ${2 + 9 * lift}px ${2 + 8 * lift}px rgba(42,38,34,${.2 + .15 * lift}))`,
        opacity: fade && t > .7 ? 1 - (t - .7) / .3 : 1,
      });
    }
    anim = el.animate(frames, { duration: Math.min(780, 380 + dist * .38), delay, easing: 'linear', fill: 'both' });
  }
  await anim.finished.catch(() => {});
  el.remove();
  if (toEl) { toEl.style.visibility = ''; settle(toEl); }
  if (onLand) onLand();
}
async function stagger(list, step = 70) {
  await Promise.all(list.map((m, i) => fly({ ...m, delay: reduced() ? 0 : i * step })));
}
function centerTargets(beforeCenter) {
  // New centre tiles per colour, matched to the last N buttons of that colour.
  const out = [];
  const have = [0, 0, 0, 0, 0], was = [0, 0, 0, 0, 0];
  G.center.forEach((c) => have[c]++);
  beforeCenter.forEach((c) => was[c]++);
  const els = $$('#center .tile');
  for (let c = 0; c < 5; c++) {
    const n = have[c] - was[c];
    const mine = els.filter((e) => +e.dataset.c === c);
    for (let i = 0; i < n; i++) out.push(mine[mine.length - 1 - i]);
  }
  return out;
}
function roll(from, to, el = $('#score')) {
  if (reduced() || from === to) { el.textContent = to; return Promise.resolve(); }
  return new Promise((res) => {
    const t0 = performance.now(), dur = 450;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      p < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
}
function floatText(rect, text) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'pop'; el.textContent = text;
  Object.assign(el.style, { left: rect.left + rect.width / 2 + 'px', top: rect.top + 'px' });
  fx.append(el);
  el.animate([{ opacity: 0, transform: 'translate(-50%,0)' }, { opacity: 1, offset: .2 }, { opacity: 0, transform: 'translate(-50%,-26px)' }], { duration: 900, easing: 'ease-out' }).finished.then(() => el.remove(), () => el.remove());
}

// ---------- turn flow ----------
async function place(line) {
  const s = sel;
  const src = s.source === 'center' ? G.center : G.dishes[s.index];
  const before = G;
  const res = take(G, { ...s, line });
  if (!res.ok) return;
  busy = true; busyMsg = '';
  const srcSel = s.source === 'center' ? '#center .tile' : `#dishes .tile[data-i="${s.index}"]`;
  const all = $$(srcSel).map((el) => ({ c: +el.dataset.c, rect: rectOf(el), el }));
  all.forEach((a) => { a.el.style.visibility = 'hidden'; });
  const picked = all.filter((a) => a.c === s.color), rest = all.filter((a) => a.c !== s.color);
  const oldN = before.lines[line >= 0 ? line : 0].n;
  undoSnap = before; sel = null; G = res.state;
  render();
  const moves = [];
  const m = res.moved;
  const lineEl = line >= 0 ? $(`.line[data-line="${line}"]`) : null;
  const secEls = $$('#secTiles .tile');
  picked.forEach((p, j) => {
    let toEl;
    if (j < m.placed) toEl = $$('.slot', lineEl)[line - oldN - j].firstElementChild;
    else toEl = secEls[secEls.length - (m.count - j)];
    moves.push({ from: p.rect, c: p.c, toEl });
  });
  if (s.source === 'dish') {
    const tg = centerTargets(before.center);
    rest.forEach((r, i) => moves.push({ from: r.rect, c: r.c, toEl: tg.find((t) => +t.dataset.c === r.c && !t.__used && (t.__used = true)) }));
  }
  void src;
  await stagger(moves.filter((x) => x.toEl));
  pending = G.rival || roundOver(G);
  busy = false;
  save();
  render();
  if (pending) { clearTimeout(timer); timer = setTimeout(resolve, 2300); }
}

const IDA_LINES = [
  (r) => `Dish ${r.dish + 1} had ${r.tiles} ${COLORS[r.color]}. Lovely, I will take those.`,
  (r) => `Ooh, ${COLORS[r.color]} ${GLYPHS[r.color]}s. They will sell nicely next door.`,
  (r) => `I could not resist the ${COLORS[r.color]} on dish ${r.dish + 1}.`,
  (r) => `${r.tiles} ${COLORS[r.color]} in one place. That is my kind of dish.`,
];

async function idaMove() {
  if (!G.rival) return;
  const r0 = rivalTurn(G);
  if (r0.dish < 0) { idaMsg = 'Nothing left for me this time. Enjoy the middle!'; return; }
  const els = $$(`#dishes .tile[data-i="${r0.dish}"]`).map((el) => ({ c: +el.dataset.c, rect: rectOf(el), el }));
  const dishEl = $(`.dish[data-dish="${r0.dish}"]`);
  dishEl.classList.add('ida-pick');
  idaMsg = IDA_LINES[(G.round + r0.dish + r0.tiles) % IDA_LINES.length](r0);
  $('#idaMsg').textContent = idaMsg;
  await sleep(reduced() ? 80 : 380);
  els.forEach((a) => { a.el.style.visibility = 'hidden'; });
  const before = G.center;
  G = r0.state;
  render();
  const chip = rectOf($('#idaFace'));
  const moves = [];
  for (const a of els) {
    if (a.c === r0.color) moves.push({ from: a.rect, c: a.c, toRect: chip, fade: true });
  }
  const tg = centerTargets(before);
  els.filter((a) => a.c !== r0.color).forEach((a) => moves.push({ from: a.rect, c: a.c, toEl: tg.find((t) => +t.dataset.c === a.c && !t.__used && (t.__used = true)) }));
  await stagger(moves.filter((x) => x.toEl || x.toRect));
}

async function finishRound() {
  const e = endRound(G);
  sel = null;
  busyMsg = 'The round is done. Tiles settle into the wall.';
  render();
  await sleep(reduced() ? 60 : 300);
  let shown = G.score;
  for (const p of e.placements) {
    const slots = $$(`.line[data-line="${p.row}"] .slot`);
    const fromTile = slots[p.row].firstElementChild;
    const cell = $(`.cell[data-r="${p.row}"][data-c="${p.col}"]`);
    const rest = slots.slice(0, p.row).map((s) => s.firstElementChild).filter(Boolean);
    const fromRect = rectOf(fromTile);
    fromTile.style.visibility = 'hidden';
    rest.forEach((t) => { if (!reduced()) t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 320, fill: 'forwards' }); else t.style.opacity = 0; });
    await fly({
      from: fromRect, c: p.color, toRect: rectOf(cell), onLand: () => {
        cell.innerHTML = tile(p.color, { cls: 'set' });
        settle(cell.firstElementChild);
        if (!reduced()) cell.firstElementChild.animate([{ boxShadow: '0 0 0 0 rgba(226,176,74,.9)' }, { boxShadow: '0 0 0 10px rgba(226,176,74,0)' }], { duration: 600 });
        floatText(rectOf(cell), `+${p.points}`);
      },
    });
    const to = shown + p.points;
    await roll(shown, to); shown = to;
    await sleep(reduced() ? 0 : 140);
  }
  if (e.secondsCount) {
    $$('#secTiles .tile').forEach((t) => { if (!reduced()) t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 400, fill: 'forwards' }); else t.style.opacity = 0; });
    floatText(rectOf($('#secVal')), `+${e.seconds}`);
    await roll(shown, shown + e.seconds); shown += e.seconds;
    await sleep(reduced() ? 0 : 300);
  }
  G = e.state;
  if (!e.gameOver) {
    G = dealRound(G);
    if (G.over) { /* shelf ran bare */ }
    idaMsg = G.rival ? `Round ${G.round}. Fresh dishes, same rules. Take your time.` : idaMsg;
  }
  undoSnap = null;
  render();
  if (!G.over && !reduced()) {
    $$('#dishes .tile').forEach((t, i) => t.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 25, fill: 'backwards', easing: 'ease-out' }));
  }
}

async function resolve() {
  if (!pending) return;
  clearTimeout(timer);
  busy = true; undoSnap = null; sel = null;
  busyMsg = roundOver(G) ? '' : 'Ida is choosing a dish.';
  render();
  if (!roundOver(G)) await idaMove();
  if (roundOver(G)) await finishRound();
  pending = false;
  busy = false;
  save();
  render();
}

function undo() {
  if (!undoSnap || busy) return;
  clearTimeout(timer);
  G = undoSnap; undoSnap = null; pending = false; sel = null;
  save(); render();
}

// ---------- input ----------
app.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (busy) return;
  if (t.closest('[data-undo]')) return undo();
  if (t.closest('#idaBtn')) { G.rival = !G.rival; idaMsg = G.rival ? 'Hello again! I will take a dish after each of your turns.' : ''; save(); return render(); }
  if (t.closest('#newBtn')) {
    if (!confirmNew) { confirmNew = setTimeout(() => { confirmNew = 0; render(); }, 3000); return render(); }
    clearTimeout(confirmNew); confirmNew = 0; return startNew();
  }
  if (t.closest('#againBtn')) return startNew();
  if (G.over) return;
  const tl = t.closest('[data-src]');
  if (tl) {
    if (pending) await resolve();
    if (G.over) return;
    const key = { source: tl.dataset.src, index: +tl.dataset.i, color: +tl.dataset.c };
    const same = sel && sel.source === key.source && sel.index === key.index && sel.color === key.color;
    sel = same ? null : key;
    render();
    return;
  }
  const ln = t.closest('[data-line]');
  if (ln && sel) return place(+ln.dataset.line);
  const bk = t.closest('#basket');
  if (bk && sel) return place(-1);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel && !busy) { sel = null; render(); } });

function startNew() {
  clearTimeout(timer);
  G = newGame(randSeed(), { rival: G ? G.rival : true });
  sel = null; undoSnap = null; pending = false; busy = false;
  idaMsg = 'A fresh wall! I take the dish with the most of one glaze. Ties go left.';
  save(); render();
  window.scrollTo(0, 0);
}

G = load();
if (!G) { G = newGame(randSeed(), { rival: true }); save(); }
render();
if (pending && !G.over) timer = setTimeout(resolve, 700);
window.__tiles = { get state() { return G; }, get busy() { return busy; } };
