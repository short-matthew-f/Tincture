// The Lifting Table: UI, rendering and animation. Rules live in rules.js (pure).
import {
  newState, newGame, play, playNudge, undo, stage, isLegal, isDone, isStuck, benchCap,
  exposedColor, frontJar, laneLeft, canLift, hint, VERSION,
} from './rules.js';
import { LEVELS, PALETTE, levelById } from './levels.js';

const KEY = 'tincture.proto.lift';
const HISTORY_SAVED = 400; // undo is unlimited in a session; the save keeps the last 400 steps
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));

// ---------- glyphs (colorblind help) ----------
const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const GLYPHS = {
  wave: `<path d="M3 13c2.5-4 4.5-4 7 0s4.5 4 7 0c1-1.6 2-2.4 3.5-2.8" ${STROKE} stroke-width="2.8"/>`,
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.8M12 18.4v2.8M2.8 12h2.8M18.4 12h2.8M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2" ${STROKE} stroke-width="2.2"/>`,
  leaf: '<path d="M5 19C4.5 11 9.5 5.5 19 5c.3 8.5-5 14-14 14z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  ring: `<circle cx="12" cy="12" r="6" ${STROKE} stroke-width="3"/>`,
  drop: '<path d="M12 3.5c3.5 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6 6-11z"/>',
  square: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
  flower: '<circle cx="12" cy="7.6" r="3.7"/><circle cx="12" cy="16.4" r="3.7"/><circle cx="7.6" cy="12" r="3.7"/><circle cx="16.4" cy="12" r="3.7"/>',
  chevron: `<path d="M4 8.5l8 7.5 8-7.5" ${STROKE} stroke-width="3.2"/>`,
  moon: '<path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5z"/>',
  star: '<path d="M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.8l-5.6 3 1.3-6.2L3 9.3l6.3-.7z"/>',
  diamond: '<path d="M12 3 20.5 12 12 21 3.5 12z"/>',
  triangle: '<path d="M12 4 21 19.5H3z"/>',
  bars: `<path d="M6 5v14M12 5v14M18 5v14" ${STROKE} stroke-width="3"/>`,
  shell: '<path d="M12 4.5a8 8 0 0 1 8 8.5H4a8 8 0 0 1 8-8.5z"/><rect x="9" y="15" width="6" height="4" rx="1"/>',
  cross: `<path d="M6 6l12 12M18 6 6 18" ${STROKE} stroke-width="3.2"/>`,
  dot: '<circle cx="12" cy="12" r="5.5"/>',
};
const glyphSvg = (c, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPHS[PALETTE[c].glyph]}</svg>`;
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const glyphInk = (c) => (lum(PALETTE[c].hex) > 0.42 ? 'rgba(42,38,34,.78)' : 'rgba(255,250,235,.95)');
const cname = (c) => PALETTE[c].name;

// ---------- save ----------
let data = { v: 1, cur: LEVELS[0].id, done: {}, glyphs: true, seenHow: false, game: null };
function save() {
  try {
    const g = G ? { level: L.id, state: G.state, past: G.past.slice(-HISTORY_SAVED) } : null;
    localStorage.setItem(KEY, JSON.stringify({ ...data, cur: L ? L.id : data.cur, game: g }));
  } catch { /* storage may be blocked; play goes on */ }
}
function validState(Lv, s) {
  return s && s.v === VERSION && s.level === Lv.id && Array.isArray(s.h) && s.h.length === Lv.W &&
    s.h.every((x) => Number.isInteger(x) && x >= 0 && x <= Lv.H) && Array.isArray(s.lp) && s.lp.length === Lv.lanes.length &&
    s.lp.every((p, i) => Number.isInteger(p) && p >= 0 && p <= Lv.lanes[i].length) &&
    Array.isArray(s.belt) && Array.isArray(s.bench) && Array.isArray(s.shelf) && s.belt.length <= Lv.slots;
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && o.v === 1) {
      data = { ...data, ...o, done: o.done && typeof o.done === 'object' ? o.done : {} };
    }
  } catch { /* a fresh start */ }
  if (!levelById(data.cur)) data.cur = LEVELS[0].id;
}

// ---------- state ----------
let L = null, G = null, busy = false, skip = false, queued = null, hinted = null, note = '', howStep = 0;
let cellEls = [];
const skipWaiters = new Set();

function wait(ms) {
  if (skip || ms <= 0) return Promise.resolve();
  return new Promise((r) => {
    const done = () => { clearTimeout(t); skipWaiters.delete(done); r(); };
    const t = setTimeout(done, ms);
    skipWaiters.add(done);
  });
}
function skipAll() {
  skip = true;
  for (const f of [...skipWaiters]) f();
  for (const a of document.getAnimations()) { try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch { /* fine */ } }
}
// WAAPI with a timer fallback, so a paused or failed animation can never hang the table.
function anim(el, frames, opts) {
  if (!el || !el.animate) return Promise.resolve();
  const o = { ...opts, duration: Math.max(0, opts.duration || 0), delay: Math.max(0, opts.delay || 0) };
  try {
    const a = el.animate(frames, o);
    if (skip) a.finish();
    return Promise.race([a.finished.then(() => {}, () => {}), nap(o.duration + o.delay + 400)]);
  } catch { return Promise.resolve(); }
}

// Every animated action goes through here: whatever happens, busy is reset.
async function run(fn) {
  if (busy) { skipAll(); return; }
  busy = true; skip = false;
  try { await fn(); } catch (e) { console.error('The Lifting Table: an animation was cut short', e); } finally {
    busy = false; skip = false;
    $('#belt').classList.remove('running');
    $('#fx').innerHTML = '';
    render();
    afterMove();
    // A tap made mid-animation fast-forwards it, then happens.
    const q = queued;
    queued = null;
    if (q && !isDone(G.state)) setTimeout(() => act(q), 0);
  }
}

// ---------- level setup ----------
function startLevel(id, { fresh = false } = {}) {
  L = levelById(id) || LEVELS[0];
  data.cur = L.id;
  const g = data.game;
  if (!fresh && g && g.level === L.id && validState(L, g.state) && Array.isArray(g.past)) {
    G = { state: g.state, past: g.past.filter((s) => validState(L, s)) };
  } else {
    G = newGame(L);
  }
  hinted = null; note = '';
  buildPic();
  render();
  sizePic();
  save();
}

function buildPic() {
  const pic = $('#pic');
  pic.style.setProperty('--w', L.W);
  pic.setAttribute('aria-label', `The painting: ${L.name}, ${L.W} by ${L.H} cells`);
  cellEls = [];
  const frag = document.createDocumentFragment();
  for (let r = 0; r < L.H; r++) {
    const row = [];
    for (let c = 0; c < L.W; c++) {
      const k = L.cells[r][c];
      const el = document.createElement('div');
      el.className = 'cell';
      el.style.setProperty('--cc', PALETTE[k].hex);
      el.style.color = glyphInk(k);
      el.innerHTML = glyphSvg(k);
      frag.append(el);
      row.push(el);
    }
    cellEls.push(row);
  }
  pic.replaceChildren(frag);
}

function sizePic() {
  const app = $('#app');
  const wAvail = Math.min(innerWidth, 480) - 24 - 12;
  let used = 0, n = 0;
  for (const ch of app.children) {
    if (ch.classList.contains('picwrap') || ch.hidden) continue;
    used += ch.offsetHeight; n++;
  }
  used += n * 6 + 12 + 12; // gaps, frame, breathing room
  const hAvail = innerHeight - used;
  const cell = Math.floor(Math.max(9, Math.min(30, wAvail / L.W, hAvail / L.H)));
  document.documentElement.style.setProperty('--cell', `${cell}px`);
}

// ---------- render ----------
function jarHTML(j, { n = null, id = j.id, extra = '' } = {}) {
  const hasFill = n !== null;
  const pct = hasFill ? Math.round((100 * n) / j.cap) : 0;
  const full = hasFill && n >= j.cap;
  const label = hasFill ? `${n}/${j.cap}` : `${j.cap}`;
  return `<span class="jar ${hasFill ? '' : 'empty-look'} ${full ? 'full' : ''} ${extra}" data-id="${id}" style="--jc:${PALETTE[j.c].hex};color:${hasFill ? glyphInk(j.c) : ''}">` +
    '<span class="cork"></span><span class="neck"></span>' +
    `<span class="glass"><span class="tint"></span><span class="band"></span><span class="fill" style="height:${pct}%"></span><span class="shine"></span>${glyphSvg(j.c, 'gl')}</span>` +
    `<span class="num">${label}</span></span>`;
}

function paintCells(s) {
  for (let c = 0; c < L.W; c++) {
    for (let r = 0; r < L.H; r++) {
      const el = cellEls[r][c];
      el.classList.toggle('gone', r >= s.h[c]);
      el.classList.toggle('ex', r === s.h[c] - 1);
    }
  }
}

function render(s = G.state) {
  document.body.classList.toggle('glyphs', !!data.glyphs);
  const idx = LEVELS.indexOf(L);
  $('#lvNo').textContent = `${idx + 1}/${LEVELS.length}`;
  $('#lvName').textContent = L.name;
  const gb = $('#glyphBtn');
  gb.setAttribute('aria-pressed', String(!!data.glyphs));
  gb.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPHS.flower}</svg>`;
  gb.title = data.glyphs ? 'Color symbols are on' : 'Color symbols are off';

  paintCells(s);

  // shelf
  $('#shelfCount').innerHTML = `On the shelf <b>${s.shelf.length}</b>`;
  $('#shelf').innerHTML = s.shelf.slice(-40).map((j) => `<span class="mini" style="--jc:${PALETTE[j.c].hex}"></span>`).join('');

  // belt
  const belt = $('#belt');
  belt.style.setProperty('--slots', L.slots);
  let bh = '';
  for (let i = 0; i < L.slots; i++) {
    const j = s.belt[i];
    if (j) {
      const waiting = !busy && !canLift(L, s, j.c) && j.n < j.cap;
      bh += `<button type="button" class="slotbtn" data-where="belt" data-i="${i}" aria-label="${cname(j.c)} jar on the belt, ${j.n} of ${j.cap}${waiting ? ', waiting' : ''}. Tap to rest it on the bench.">${jarHTML(j, { n: j.n, extra: waiting ? 'waiting' : '' })}</button>`;
    } else bh += '<span class="spot">empty</span>';
  }
  belt.innerHTML = bh;

  // bench
  const bench = $('#bench');
  const bc = benchCap(L, s);
  bench.style.setProperty('--benchn', bc);
  let nh = '';
  for (let i = 0; i < bc; i++) {
    const j = s.bench[i];
    if (j) nh += `<button type="button" class="slotbtn" data-where="bench" data-i="${i}" aria-label="${cname(j.c)} jar resting on the bench, ${j.n} of ${j.cap}. Tap to put it back on the belt.">${jarHTML(j, { n: j.n })}</button>`;
    else nh += `<span class="spot ${i >= L.bench ? 'new' : ''}">${i >= L.bench ? 'spare' : ''}</span>`;
  }
  bench.innerHTML = nh;
  $('#benchNote').textContent = s.bench.length ? 'tap a jar to bring it back' : 'tap a belt jar to rest it here';

  // lanes
  const lanes = $('#lanes');
  lanes.style.setProperty('--lanes', L.lanes.length);
  let lh = '';
  L.lanes.forEach((lane, i) => {
    const p = s.lp[i];
    const f = frontJar(L, s, i);
    lh += '<div class="lane">';
    if (f) {
      lh += `<button type="button" class="front" data-lane="${i}" aria-label="${cname(f.c)} jar, holds ${f.cap}. Tap to set it on the belt.">${jarHTML(f, { id: `${i}.${p}` })}</button>`;
      lh += '<div class="next">';
      for (let k = 1; k <= 2; k++) if (lane[p + k]) lh += jarHTML(lane[p + k], { id: `${i}.${p + k}` });
      lh += '</div>';
      const more = laneLeft(L, s, i) - 3;
      lh += `<span class="more">${more > 0 ? `+${more} more` : ''}</span>`;
    } else {
      lh += '<span class="done">All set out</span>';
    }
    lh += '</div>';
  });
  lanes.innerHTML = lh;

  // buttons, message, stuck note
  const stuck = !busy && isStuck(L, s);
  $('#stuck').hidden = !stuck;
  $('#undoBtn').disabled = !G.past.length;
  $('#hintBtn').disabled = isDone(s);
  $('#msg').textContent = busy ? 'Lifting…' : message(s);

  if (hinted && !busy) {
    const el = targetFor(hinted);
    if (el) el.querySelector('.jar')?.classList.add('hinted');
  }
}

function message(s) {
  if (note) return note;
  if (isDone(s)) return 'All lifted. Lovely work.';
  if (isStuck(L, s)) return 'The table is full for now.';
  const waiting = s.belt.filter((j) => !canLift(L, s, j.c));
  if (s.belt.length >= L.slots) {
    return s.bench.length < benchCap(L, s)
      ? 'The belt is full. Tap a waiting jar to rest it on the bench.'
      : 'Belt and bench are full. A jar on the bench can swap back in when its color shows.';
  }
  if (!s.moves) return 'Tap a jar at the bottom. It lifts its color from the bottom edge of the painting.';
  if (waiting.length === 1) return `${cname(waiting[0].c)} waits on the belt until its color reaches the bottom edge.`;
  if (waiting.length > 1) return `${waiting.length} jars are waiting for their colors to reach the bottom edge.`;
  return 'Lifting nicely. Choose the next jar.';
}

function targetFor(m) {
  if (m.t === 'place') return $(`#lanes .front[data-lane="${m.i}"]`);
  if (m.t === 'park') return $(`#belt .slotbtn[data-i="${m.i}"]`);
  return $(`#bench .slotbtn[data-i="${m.i}"]`);
}

// ---------- animation ----------
function snapRects() {
  const out = new Map();
  for (const el of $$('#belt .jar, #bench .jar, #lanes .jar')) out.set(el.dataset.id, el.getBoundingClientRect());
  return out;
}
async function flip(before, dur = 260) {
  if (reduced()) return;
  const jobs = [];
  for (const el of $$('#belt .jar, #bench .jar, #lanes .jar')) {
    const a = before.get(el.dataset.id);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const sc = b.width ? a.width / b.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.02) continue;
    jobs.push(anim(el, [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: 'none' }], { duration: dur, easing: 'cubic-bezier(.3,.7,.4,1)' }));
  }
  await Promise.all(jobs);
}

const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const jarEl = (id) => $(`#belt .jar[data-id="${id}"]`);

function setJarFill(el, j) {
  if (!el) return;
  const f = el.querySelector('.fill');
  if (f) f.style.height = `${Math.round((100 * j.n) / j.cap)}%`;
  const n = el.querySelector('.num');
  if (n) n.textContent = `${j.n}/${j.cap}`;
  el.classList.remove('waiting');
}

async function liftOne(d, lift, delay, flightMs) {
  await wait(delay);
  const cell = cellEls[lift.row][lift.col];
  const from = centerOf(cell.getBoundingClientRect());
  d.h[lift.col] = lift.row;
  cell.classList.add('gone');
  cell.classList.remove('ex');
  if (lift.row > 0) cellEls[lift.row - 1][lift.col].classList.add('ex');
  const j = d.belt.find((x) => x.id === lift.id);
  const target = jarEl(lift.id);
  if (!skip && !reduced() && target) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.setProperty('--jc', PALETTE[lift.c].hex);
    dot.style.left = `${from.x}px`; dot.style.top = `${from.y}px`;
    $('#fx').append(dot);
    const to = centerOf(target.querySelector('.glass').getBoundingClientRect());
    const dx = to.x - from.x, dy = to.y - from.y;
    await anim(dot, [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 14}px) scale(1.1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.6)`, opacity: 0.6 },
    ], { duration: flightMs, easing: 'ease-in' });
    dot.remove();
  }
  if (j) { j.n++; setJarFill(target, j); }
}

function sweep(dur) {
  const sw = $('#sweep'), edge = $('#edge');
  if (reduced() || skip || !sw) return;
  const w = edge.getBoundingClientRect().width;
  anim(sw, [{ transform: 'translateX(-26px)', opacity: 1 }, { transform: `translateX(${w}px)`, opacity: 1 }], { duration: dur, easing: 'linear' });
}

async function corkAndLeave(d, ids) {
  const shelfR = $('#shelf').getBoundingClientRect();
  const jobs = ids.map(async (id) => {
    const el = jarEl(id);
    if (!el) return;
    el.classList.add('full');
    const cork = el.querySelector('.cork');
    if (!reduced() && !skip) {
      await anim(cork, [{ transform: 'translateY(-14px)', opacity: 0 }, { transform: 'translateY(1px)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-in' });
      const r = el.getBoundingClientRect();
      const pop = document.createElement('div');
      pop.className = 'pop';
      pop.textContent = 'pop!';
      pop.style.left = `${r.left + r.width / 2}px`; pop.style.top = `${r.top}px`;
      $('#fx').append(pop);
      anim(pop, [{ opacity: 0, transform: 'translate(-50%, -80%)' }, { opacity: 1, transform: 'translate(-50%, -130%)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%, -190%)' }], { duration: 700, easing: 'ease-out' }).then(() => pop.remove());
      await anim(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
      const c = centerOf(r);
      const tx = shelfR.left + 6 - c.x, ty = shelfR.top + shelfR.height / 2 - c.y;
      await anim(el, [{ transform: 'none', opacity: 1 }, { transform: `translate(${tx}px, ${ty}px) scale(.25)`, opacity: 0.2 }], { duration: 360, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' });
    }
  });
  await Promise.all(jobs);
  for (const id of ids) {
    const j = d.belt.find((x) => x.id === id);
    if (j) d.shelf.push({ id: j.id, c: j.c, cap: j.cap });
  }
  d.belt = d.belt.filter((x) => !ids.includes(x.id));
  const before = snapRects();
  render(d);
  await flip(before, 220);
}

async function animatePasses(staged, passes) {
  const d = JSON.parse(JSON.stringify(staged));
  $('#belt').classList.add('running');
  let landing = [];
  for (let p = 0; p < passes.length; p++) {
    const pass = passes[p];
    if (skip) break;
    const rm = reduced();
    // Later passes run quicker, so a deep column does not drag.
    const tick = rm ? 0 : Math.max(8, 30 * 0.78 ** p);
    const flightMs = rm ? 0 : Math.max(150, 280 * 0.85 ** p);
    sweep((L.W + d.belt.length) * tick);
    const lastTick = Math.max(0, ...pass.lifts.map((x) => x.tick));
    landing.push(...pass.lifts.map((lift) => liftOne(d, lift, lift.tick * tick, flightMs)));
    // The next pass starts once this one has swept by; flights may still be landing.
    await wait(rm ? 80 : lastTick * tick + 70);
    if (pass.filled.length) {
      await Promise.all(landing);
      landing = [];
      await corkAndLeave(d, pass.filled);
    }
  }
  await Promise.all(landing);
}

// ---------- actions ----------
function act(m) {
  // Lane taps queue up (lane numbers never shift); belt and bench slots can
  // shift while jars leave, so those taps only fast-forward.
  if (busy) { if (m.t === 'place') queued = m; skipAll(); return; }
  note = '';
  if (!isLegal(L, G.state, m)) { explainBlocked(m); return; }
  hinted = null;
  const staged = stage(L, G.state, m);
  const res = play(L, G, m);
  G = res.game;
  save();
  run(async () => {
    const before = snapRects();
    render(staged);
    $('#msg').textContent = res.passes.length ? 'Lifting…' : message(staged);
    await flip(before);
    if (res.passes.length) await animatePasses(staged, res.passes);
  });
}

function explainBlocked(m) {
  const s = G.state;
  if (m.t === 'place' || m.t === 'unpark') note = 'The belt is full. Rest a belt jar on the bench to make room.';
  else if (m.t === 'park') note = 'The bench is full. Bring a jar back to the belt first.';
  render();
  if (s.belt.length >= L.slots) anim($('#belt'), [{ transform: 'translateX(0)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: reduced() ? 0 : 260 });
}

function doUndo() {
  if (busy) { skipAll(); return; }
  if (!G.past.length) return;
  note = ''; hinted = null;
  const before = snapRects();
  G = undo(G);
  save();
  render();
  flip(before, 200);
}

function doNudge() {
  if (busy) return;
  G = playNudge(G);
  note = 'A spare bench spot, just for this painting.';
  hinted = null;
  save();
  render();
}

function doHint() {
  if (busy) { skipAll(); return; }
  note = 'Looking…';
  render();
  setTimeout(() => {
    try {
      const h = hint(L, G.state);
      if (h.kind === 'solution' || h.kind === 'lift') {
        hinted = h.move;
        note = h.move.t === 'park' ? 'Try resting this jar on the bench.' : h.move.t === 'unpark' ? 'Try bringing this jar back.' : 'Try this jar next.';
      } else if (h.kind === 'tangled') {
        hinted = null;
        note = 'This one has gotten tangled: no order of jars clears it from here. Undo a few steps, or add a spare bench spot.';
        $('#stuck').hidden = false;
      } else {
        note = 'Try a jar whose color is showing along the bottom edge.';
      }
    } catch (e) {
      console.error(e);
      note = 'Try a jar whose color is showing along the bottom edge.';
    }
    render();
    if (note.startsWith('This one has gotten tangled')) $('#stuck').hidden = false;
  }, 30);
}

function afterMove() {
  if (!isDone(G.state)) return;
  if (!data.done[L.id]) { data.done[L.id] = true; save(); }
  setTimeout(openFinish, reduced() ? 100 : 450);
}

// ---------- sheets ----------
function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  const p = el.querySelector('.panel');
  anim(p, [{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced() ? 0 : 220, easing: 'ease-out' });
  (el.querySelector('[data-close]') || el.querySelector('.btn'))?.focus({ preventScroll: true });
}
function closeSheet(el) { el.hidden = true; }
document.addEventListener('click', (e) => {
  const sh = e.target.closest('.sheet');
  if (sh && (e.target === sh || e.target.closest('[data-close]'))) closeSheet(sh);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const sh of $$('.sheet')) if (!sh.hidden && sh.id !== 'finishSheet') closeSheet(sh);
});

function thumb(Lv, maxW, maxH, s = null) {
  const cv = document.createElement('canvas');
  const k = Math.max(1, Math.floor(Math.min(maxW / Lv.W, maxH / Lv.H)));
  cv.width = Lv.W * k; cv.height = Lv.H * k;
  const ctx = cv.getContext('2d');
  for (let r = 0; r < Lv.H; r++) for (let c = 0; c < Lv.W; c++) {
    if (s && r >= s.h[c]) continue;
    ctx.fillStyle = PALETTE[Lv.cells[r][c]].hex;
    ctx.fillRect(c * k, r * k, k, k);
  }
  return cv;
}

function openLevels() {
  const list = $('#levelList');
  list.innerHTML = '';
  LEVELS.forEach((Lv, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(Lv === L));
    const th = document.createElement('span');
    th.className = 'th';
    th.append(thumb(Lv, 48, 56));
    b.append(th);
    const t = document.createElement('span');
    t.className = 't';
    t.innerHTML = `<strong>${i + 1}. ${Lv.name}</strong><span>${Lv.colors.length} colors · ${Lv.W * Lv.H} cells · ${Lv.lanes.length} lanes</span>`;
    b.append(t);
    if (data.done[Lv.id]) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = 'Lifted'; b.append(bd); }
    b.addEventListener('click', () => { closeSheet($('#levelSheet')); if (Lv !== L) startLevel(Lv.id, { fresh: true }); });
    li.append(b);
    list.append(li);
  });
  $('#restartBtn').textContent = 'Start this painting over';
  openSheet('#levelSheet');
}

function openFinish() {
  if (!isDone(G.state) || !$('#finishSheet').hidden) return;
  $('#finTitle').textContent = `Your ${L.noun}, lifted`;
  const s = G.state;
  $('#finSub').textContent = `${s.shelf.length} jars of pigment, corked and on the shelf.`;
  const cv = thumb(L, Math.min(220, innerWidth - 80), 200);
  cv.id = 'finThumb';
  $('#finThumb').replaceWith(cv);
  $('#finJars').innerHTML = s.shelf.map((j) => jarHTML(j, { n: j.cap, id: `f${j.id}` })).join('');
  const idx = LEVELS.indexOf(L);
  const next = LEVELS.slice(idx + 1).find((x) => !data.done[x.id]) || LEVELS[(idx + 1) % LEVELS.length];
  $('#finNext').textContent = `Next: ${next.name}`;
  $('#finNext').onclick = () => { closeSheet($('#finishSheet')); startLevel(next.id, { fresh: true }); };
  openSheet('#finishSheet');
  if (!reduced()) $$('#finJars .jar').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: Math.min(1200, i * 35), fill: 'backwards', easing: 'ease-out' }));
}

// How this works: three short steps.
const ILL = {
  pick: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <rect x="20" y="8" width="280" height="38" rx="10" fill="#D3C5A8"/>
    <g>${[0, 1, 2, 3].map((i) => `<rect x="${36 + i * 68}" y="14" width="36" height="26" rx="6" fill="none" stroke="rgba(42,38,34,.2)" stroke-dasharray="4 3" stroke-width="2"/>`).join('')}</g>
    ${[['#b8433a', 60], ['#3e6a9e', 160], ['#d39b2a', 260]].map(([c, x]) => `<rect x="${x - 16}" y="72" width="32" height="38" rx="7" fill="${c}" opacity=".35" stroke="rgba(42,38,34,.4)" stroke-width="1.5"/><rect x="${x - 16}" y="72" width="32" height="7" rx="3" fill="${c}"/>`).join('')}
    <path d="M160 66 V50" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M152 56l8-9 8 9" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="176" cy="104" r="9" fill="#E2B04A" opacity=".55"/>
  </svg>`,
  lift: `<svg class="ill" viewBox="0 0 320 140" aria-hidden="true">
    ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => {
    const col = r === 3 ? (c % 3 === 0 ? '#b8433a' : '#8babc5') : r === 2 && c === 3 ? '#b8433a' : '#8babc5';
    const gone = r === 3 && c === 0;
    return `<rect x="${90 + c * 20}" y="${6 + r * 20}" width="20" height="20" fill="${gone ? '#EFE7D6' : col}"/>`;
  }).join('')).join('')}
    <rect x="88" y="88" width="144" height="5" rx="2.5" fill="rgba(42,38,34,.18)"/>
    <path d="M70 108 H250" stroke="#8C6512" stroke-width="3" stroke-linecap="round"/><path d="M242 100l9 8-9 8" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="96" y="100" width="26" height="32" rx="6" fill="#FFFDF6" stroke="rgba(42,38,34,.4)" stroke-width="1.5"/><rect x="97" y="118" width="24" height="13" rx="5" fill="#b8433a"/>
    <circle cx="100" cy="76" r="4" fill="#b8433a"/>
  </svg>`,
  plan: `<svg class="ill" viewBox="0 0 320 130" aria-hidden="true">
    <rect x="20" y="8" width="280" height="44" rx="10" fill="#D3C5A8"/>
    ${['#b8433a', '#3e6a9e', '#758054', '#d39b2a'].map((c, i) => `<rect x="${42 + i * 68}" y="14" width="28" height="32" rx="6" fill="#FFFDF6" stroke="rgba(42,38,34,.4)" stroke-width="1.5"/><rect x="${43 + i * 68}" y="${30 - i * 3}" width="26" height="${15 + i * 3}" rx="5" fill="${c}"/>`).join('')}
    <rect x="20" y="78" width="210" height="44" rx="10" fill="rgba(42,38,34,.06)"/>
    ${[0, 1, 2].map((i) => `<rect x="${34 + i * 66}" y="84" width="34" height="32" rx="7" fill="none" stroke="rgba(42,38,34,.2)" stroke-dasharray="4 3" stroke-width="2"/>`).join('')}
    <path d="M260 50 C 262 76, 220 98, 110 100" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
    <path d="M120 93l-10 7 10 7" fill="none" stroke="#8C6512" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};
const HOW = [
  { t: 'Pick a jar', ill: 'pick', p: 'A painting has come into the workshop, and you lift its pigments back out into jars. Tap the front jar of a lane to set it on the belt. You can see the next two jars in every lane, so you can plan ahead.' },
  { t: 'Paint lifts from the bottom', ill: 'lift', p: 'Jars ride the belt left to right along the bottom edge. Over each column, a jar lifts the lowest cell if it is the jar\'s color, one cell per column each time around, until it\'s full. Then it\'s corked with a pop and goes to the shelf.' },
  { t: 'Room to plan', ill: 'plan', p: 'The belt holds four jars. A jar whose color hasn\'t reached the bottom yet waits. Tap a belt jar to rest it on the bench, and tap it there to bring it back. Undo is free, there are no timers, and there\'s no way to lose.' },
];
function renderHow() {
  const st = HOW[howStep];
  $('#howBody').innerHTML = `<h3 class="serif" style="font-size:19px;margin:6px 0 0">${howStep + 1}. ${st.t}</h3>${ILL[st.ill]}<p>${st.p}</p>`;
  $('#howDots').innerHTML = HOW.map((_, i) => `<i class="${i === howStep ? 'on' : ''}"></i>`).join('');
  $('#howBack').disabled = howStep === 0;
  $('#howNext').textContent = howStep === HOW.length - 1 ? 'Start lifting' : 'Next';
}
function openHow() { howStep = 0; renderHow(); openSheet('#howSheet'); }

// ---------- wiring ----------
$('#lanes').addEventListener('click', (e) => {
  const b = e.target.closest('.front');
  if (b) act({ t: 'place', i: +b.dataset.lane });
});
$('#belt').addEventListener('click', (e) => {
  const b = e.target.closest('.slotbtn');
  if (b) act({ t: 'park', i: +b.dataset.i });
  else if (busy) skipAll();
});
$('#bench').addEventListener('click', (e) => {
  const b = e.target.closest('.slotbtn');
  if (b) act({ t: 'unpark', i: +b.dataset.i });
});
$('#pic').addEventListener('click', () => { if (busy) skipAll(); });
$('#undoBtn').addEventListener('click', doUndo);
$('#stuckUndo').addEventListener('click', doUndo);
$('#nudgeBtn').addEventListener('click', doNudge);
$('#hintBtn').addEventListener('click', doHint);
$('#levelsBtn').addEventListener('click', () => { if (!busy) openLevels(); });
$('#howBtn').addEventListener('click', () => { if (!busy) openHow(); });
$('#glyphBtn').addEventListener('click', () => { data.glyphs = !data.glyphs; save(); render(); });
$('#howBack').addEventListener('click', () => { if (howStep > 0) { howStep--; renderHow(); } });
$('#howNext').addEventListener('click', () => {
  if (howStep < HOW.length - 1) { howStep++; renderHow(); return; }
  closeSheet($('#howSheet'));
  if (!data.seenHow) { data.seenHow = true; save(); }
});
let restartArmed = 0;
$('#restartBtn').addEventListener('click', () => {
  if (!restartArmed) {
    restartArmed = setTimeout(() => { restartArmed = 0; $('#restartBtn').textContent = 'Start this painting over'; }, 3000);
    $('#restartBtn').textContent = 'Tap again to start over';
    return;
  }
  clearTimeout(restartArmed); restartArmed = 0;
  closeSheet($('#levelSheet'));
  startLevel(L.id, { fresh: true });
});
$('#finAgain').addEventListener('click', () => { closeSheet($('#finishSheet')); startLevel(L.id, { fresh: true }); });
$('#finAll').addEventListener('click', () => { closeSheet($('#finishSheet')); openLevels(); });
let rz = 0;
addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (L) sizePic(); }); });

// ---------- boot ----------
load();
startLevel(data.cur);
if (!data.seenHow) openHow();
else if (isDone(G.state)) openFinish();

// For quick checks from the console or a test harness (no effect on play).
window.__lift = { get level() { return L; }, get state() { return G.state; }, get busy() { return busy; }, newState };
