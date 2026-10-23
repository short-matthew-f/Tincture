// The Dye Garden: canvas, input, animation and UI. Rules live in rules.js (pure).
import {
  PLACES, PLACE_BY_ID, SPECIES, DYES, MODES, GEN, R0, OPENING, TEETER, GOAT, FIND_KINDS,
  generate, newVisit, gather, isDone, restoreVisit, basketRadius, fits, over, buildGrid, queryGrid,
  nearestGatherable, tally, placeDyes, jarsLabel, pickFact, unitsOf, mulberry32, harvestSeed,
  levelInfo, comboAdd, comboOpen, comboLabel, newGoat, goatStep, findAt, breezeCatches,
  goalFor, skyAt, clockLabel, harvestScore, betterScore,
} from './rules.js';
import { plantSprite, shrinkSprite, basketSprite, decorSprite, goatSprite, findSprite, GROUNDS, PAD } from './sprites.js';

const KEY = 'tincture.proto.garden';
const $ = (s) => document.querySelector(s);
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedMQ.matches;
const HOW = [
  'Drag anywhere on the garden to steer your basket. It glides after your finger.',
  'Roll over plants that fit to gather them. Every one makes the basket grow. The bar at the top shows your basket size and the next plant to come into reach. Sweep along rows and patches to gather lots at once.',
  'A plant only a little too big wobbles on the rim; grow a bit more and it drops in. Right at the end the biggest things fit: a hay cart, a shed, a dye vat, even an old oak.',
  'Sparkles are finds. A wide brim lets bigger things in for a few seconds, a breeze draws little plants to you, and now and then there is a lost spindle to keep.',
  '<b>Wander</b> has no clock. Head home whenever you like, and pick up where you left off next time.',
  '<b>Harvest before dusk</b> lasts about two minutes while the sun crosses the sky; the sun starts when you first move. At dusk the basket heads home, and you see your jars and basket size beside your best. Each place plays the same every time, or turn on Today\'s garden for a new one each day. The neighbor\'s goat nibbles there too, and a big basket makes it hop away.',
  'Each visit has a small bonus goal, just under the basket bar. Everything you gather comes home as jars of dye.',
];
const theName = (p) => p.name.replace(/^The /, 'the ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- storage (prototype only; never the game save) ----------
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
function loadStore() {
  const base = { v: 1, sound: false, shelf: {}, visits: 0, seenHelp: false, cur: null, bests: {}, daily: { day: '', bests: {} }, spindles: [], today: false };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && o.v === 1) {
      // a visit saved by an older garden layout cannot be resumed; the shelf and everything else carry over
      const cur = o.cur && o.cur.gen === GEN && PLACE_BY_ID[o.cur.place] ? o.cur : null;
      const daily = o.daily && typeof o.daily.day === 'string' ? { day: o.daily.day, bests: obj(o.daily.bests) } : base.daily;
      return { ...base, sound: !!o.sound, shelf: obj(o.shelf), visits: o.visits | 0, seenHelp: !!o.seenHelp, cur, bests: obj(o.bests), daily, spindles: Array.isArray(o.spindles) ? o.spindles.filter((k) => typeof k === 'string') : [], today: !!o.today };
    }
  } catch { /* storage may be blocked */ }
  return base;
}
const store = loadStore();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage may be blocked */ }
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function bestFor(placeId, daily = store.today) {
  if (daily) return store.daily.day === todayStr() ? store.daily.bests[placeId] || null : null;
  return store.bests[placeId] || null;
}
function setBest(placeId, score, daily) {
  const s = { jars: score.jars, level: score.level, units: score.units, plants: score.plants, spare: score.spare };
  if (daily) {
    if (store.daily.day !== todayStr()) store.daily = { day: todayStr(), bests: {} };
    store.daily.bests[placeId] = s;
  } else store.bests[placeId] = s;
}

// ---------- choose screen ----------
function placeStrip(cv, place) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth || 320, h = cv.clientHeight || 84;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  const gr = GROUNDS[place.ground];
  ctx.fillStyle = gr.base; ctx.fillRect(0, 0, cv.width, cv.height);
  if (place.ground === 'terraces') { ctx.fillStyle = gr.wall; for (let y = 26; y < h; y += 30) ctx.fillRect(0, y * dpr, cv.width, 3 * dpr); }
  if (place.ground === 'shore') { ctx.fillStyle = gr.water; ctx.fillRect(cv.width * 0.82, 0, cv.width, cv.height); }
  const rnd = mulberry32(place.id.length * 977);
  const kinds = place.mix.map(([s]) => s);
  let x = 22;
  for (let i = 0; x < w - 10; i++) {
    const s = kinds[i % kinds.length];
    const r = Math.min(30, 9 + SPECIES[s].r * 0.5);
    const sp = plantSprite(s, i % 3, r * dpr);
    const y = h / 2 + (rnd() - 0.5) * 22;
    ctx.drawImage(sp.canvas, (x - r * sp.half) * dpr, (y - r * sp.half) * dpr, 2 * r * sp.half * dpr, 2 * r * sp.half * dpr);
    x += r * 1.5 + 6;
  }
}
function renderChoose() {
  const places = $('#places');
  places.innerHTML = '';
  for (const p of PLACES) {
    const card = document.createElement('div');
    card.className = 'place';
    const dyes = placeDyes(p.id).map((d) => `<span><i style="--c:${DYES[d].hex}"></i>${DYES[d].name}</span>`).join('');
    const best = bestFor(p.id);
    const bestLine = best
      ? `Your best at ${theName(p)}${store.today ? ' today' : ''}: <b>${best.jars} jar${best.jars === 1 ? '' : 's'}</b> · Basket ${best.level}`
      : `<span class="muted">No harvest here yet${store.today ? ' today' : ''}.</span>`;
    card.innerHTML = `<canvas aria-hidden="true"></canvas><div class="t"><h2>${p.name}</h2><p>${p.blurb}</p><div class="dyes">${dyes}</div>`
      + `<p class="best">${bestLine}</p>`
      + `<div class="modes"><button type="button" class="btn" data-place="${p.id}" data-mode="wander">Wander<small>no clock</small></button>`
      + `<button type="button" class="btn primary" data-place="${p.id}" data-mode="harvest">Harvest before dusk<small>about 2 minutes</small></button></div></div>`;
    card.querySelector('[data-mode="wander"]').addEventListener('click', () => startVisit(p.id, 'wander', freshSeed()));
    card.querySelector('[data-mode="harvest"]').addEventListener('click', () => startVisit(p.id, 'harvest', harvestSeed(p.id, store.today ? todayStr() : '')));
    places.appendChild(card);
    requestAnimationFrame(() => placeStrip(card.querySelector('canvas'), p));
  }
  const cont = $('#continue');
  const cur = store.cur;
  cont.hidden = !(cur && PLACE_BY_ID[cur.place]);
  if (!cont.hidden) cont.textContent = `Keep wandering in ${theName(PLACE_BY_ID[cur.place])}`;
  const tb = $('#todayBtn');
  tb.setAttribute('aria-pressed', String(store.today));
  $('#todayNote').textContent = store.today
    ? `Harvests use today's garden. Your bests for today are kept separately.`
    : 'Each place harvests the same way every time, so your bests are fair.';
  const shelf = Object.entries(store.shelf).filter(([d, u]) => DYES[d] && u > 0).sort((a, b) => b[1] - a[1]);
  $('#shelf').hidden = !shelf.length && !store.spindles.length;
  $('#shelfList').innerHTML = shelf.map(([d, u]) => `<li><span class="jarbox"><span class="jar" style="--c:${DYES[d].hex};--f:100%"><i></i></span></span>${DYES[d].name} <span class="muted">${jarsLabel(u)}</span></li>`).join('');
  const notes = [];
  if (store.visits) notes.push(`From ${store.visits} visit${store.visits === 1 ? '' : 's'}. Dye jars keep forever here.`);
  if (store.spindles.length) notes.push(`Lost spindles found: ${store.spindles.length}.`);
  $('#shelfNote').textContent = notes.join(' ');
}
$('#howList').innerHTML = HOW.map((t) => `<li>${t}</li>`).join('');
$('#helpList').innerHTML = HOW.map((t) => `<li>${t}</li>`).join('');
$('#continue').addEventListener('click', () => { const c = store.cur; if (c) startVisit(c.place, 'wander', c.seed, c); });
$('#todayBtn').addEventListener('click', () => { store.today = !store.today; save(); renderChoose(); });
let seedBump = 0;
const freshSeed = () => ((Date.now() ^ (Math.random() * 4294967296)) + ++seedBump) >>> 0 || 1;

// ---------- the visit ----------
const cv = $('#cv');
const ctx = cv.getContext('2d', { alpha: false });
const el = {
  help: $('#help'), toast: $('#toast'), lvlpop: $('#lvlpop'), lvlN: $('#lvlN'), gfill: $('#gfill'), gbar: $('#gbar'), gnext: $('#gnext'),
  cnt: $('#cnt'), grow: $('#grow'), goal: $('#goal'), sky: $('#sky'), sun: $('#sun'), sunDot: $('#sunDot'), clock: $('#clock'), coach: $('#coach'),
};
let g = null, mode = MODES.wander, visit = null, taken = null, eatenN = 0, grid = null, place = null, gr = null;
let vw = 0, vh = 0, dpr = 1, vf = 1, Z0 = 3.4;
const B = { x: 0, y: 0, vx: 0, vy: 0, r: R0, squash: 0 };
const cam = { x: 0, y: 0, z: 3.4 };
let drag = null, keys = new Set(), auto = null; // auto: a test-only autopilot (Playwright perf runs)
let falling = [], bits = [], recent = [];
let time = 0, lastGather = 0, lastVisibleFit = 0, hint = -1, hintCheck = 0;
let raf = 0, lastT = 0, running = false, ended = false, endTimer = 0, errs = 0;
let sprites = new Map(), bSprite = null, decor = [], decorSprites = {}, goatSprites = [], findSprites = {};
let movedOnce = false, saveDue = 0;
let clock = { on: false, started: false, t: 0, secs: 0 }, homing = null;
let goat = null, goatAcc = 0, goatSaid = 0, goatSayUntil = 0;
let found = new Set(), effects = { brim: 0, breeze: 0 };
let combo = null, comboBest = 0, toastUntil = 0, toastPrio = 0, comboText = '', comboTextAt = 0, comboPop = false;
let goal = null, goalHave = 0, goalMet = false;
let lastLevel = 1, growDirty = true, growAt = 0, nextKey = '', levelRing = 0, cntPopAt = 0;
let nudge = { x: 0, y: 0, t: 0 }, landmarksGot = 0, spindleNew = false, result = null;
const frameDt = [], frameWork = [];

const QUALITY = [1, 0.8, 0.65, 0.5];
let qual = 0, slowSum = 0, slowN = 0;
/** Watch frame times; if the average stays slow, render fewer pixels (only ever steps down). */
function adapt(dtMs) {
  if (time < 1.5 || dtMs > 200) return;
  slowSum += dtMs; slowN++;
  if (slowN < 90) return;
  const avg = slowSum / slowN;
  slowSum = 0; slowN = 0;
  if (avg > 19 && qual < QUALITY.length - 1 && dpr > 1) { qual++; resize(); }
}
function resize() {
  vw = window.innerWidth; vh = window.innerHeight;
  // devicePixelRatio capped at 2, then lowered a step at a time if this phone is fill-bound
  const nd = Math.max(1, Math.min(2, window.devicePixelRatio || 1) * QUALITY[qual]);
  cv.width = Math.round(vw * nd); cv.height = Math.round(vh * nd);
  const nvf = Math.max(0.85, Math.min(1.6, Math.min(vw, vh * 0.62) / 390));
  const rebuild = nd > dpr || Math.abs(nvf - vf) > 0.08; // dropping resolution keeps the sharper sprites (no hitch)
  dpr = nd; vf = nvf; Z0 = 3.0 * vf;
  if (g && rebuild) buildSprites();
}
window.addEventListener('resize', resize);

function buildSprites() {
  sprites = new Map();
  // only the variants this garden uses, each with a small copy for when it is tiny on screen
  const used = new Set(g.plants.map((p) => p.s + p.v));
  for (const p of g.plants) {
    const key = p.s + p.v;
    if (!used.has(key)) continue;
    used.delete(key);
    const hi = plantSprite(p.s, p.v, SPECIES[p.s].r * 1.05 * Z0 * dpr);
    const mid = shrinkSprite(hi, Math.max(12, hi.canvas.width / 2));
    const lo = shrinkSprite(mid, Math.max(10, hi.canvas.width / 4));
    sprites.set(key, { hi, mid, lo, loPx: lo.canvas.width, midPx: mid.canvas.width });
  }
  bSprite = basketSprite(64 * dpr * vf * 1.4);
  decorSprites = {};
  for (const k of new Set(gr.decor)) decorSprites[k] = decorSprite(k, gr, 8 * Z0 * dpr);
  goatSprites = [goatSprite(GOAT_R * Z0 * dpr, 0), goatSprite(GOAT_R * Z0 * dpr, 1)];
  findSprites = {};
  for (const k of Object.keys(FIND_KINDS)) findSprites[k] = findSprite(k, FIND_R * Z0 * dpr);
  miniCache = {};
}
const GOAT_R = 17, FIND_R = 11;

function makeDecor() {
  const rnd = mulberry32(g.seed ^ 0xA5A5);
  const n = Math.round((g.W * g.H) / 7000);
  decor = [];
  for (let i = 0; i < n; i++) decor.push({ k: gr.decor[Math.floor(rnd() * gr.decor.length)], x: rnd() * g.W, y: rnd() * g.H, s: 4 + rnd() * 5 });
  decor.sort((a, b) => a.y - b.y);
}

const spindleKey = () => `${g.place}:${g.mode}:${g.seed}`;

function startVisit(placeId, modeId, seed, resume = null) {
  mode = MODES[modeId] || MODES.wander;
  place = PLACE_BY_ID[placeId];
  gr = GROUNDS[place.ground];
  g = generate(placeId, seed, mode.id);
  visit = resume ? restoreVisit(g, resume.got) : newVisit();
  taken = new Uint8Array(g.plants.length);
  for (const i of visit.got) taken[i] = 1;
  eatenN = 0;
  grid = buildGrid(g.plants, g.W, g.H, 64);
  B.x = resume && Number.isFinite(resume.x) ? resume.x : g.start.x;
  B.y = resume && Number.isFinite(resume.y) ? resume.y : g.start.y;
  B.vx = B.vy = 0; B.r = basketRadius(g, visit.mass); B.squash = 0;
  falling = []; bits = []; recent = visit.got.slice(-8).map((i) => DYES[SPECIES[g.plants[i].s].dye].hex);
  time = 0; lastGather = 0; lastVisibleFit = 0; hint = -1; ended = false; drag = null; homing = null; result = null;
  clock = { on: mode.timed, started: false, t: 0, secs: mode.secs };
  goat = mode.goat ? newGoat(g) : null; goatAcc = 0; goatSaid = 0; goatSayUntil = 0;
  found = new Set(resume && Array.isArray(resume.found) ? resume.found.filter((k) => Number.isInteger(k) && g.finds[k]) : []);
  // a spindle already kept from this very garden stays kept; it does not show again
  g.finds.forEach((f, k) => { if (f.k === 'spindle' && store.spindles.includes(spindleKey())) found.add(k); });
  effects = { brim: 0, breeze: 0 };
  combo = null; comboBest = 0; toastUntil = 0; toastPrio = 0; comboText = ''; comboPop = false;
  goal = goalFor(g);
  goalHave = visit.got.filter((i) => g.plants[i].s === goal.s).length; goalMet = goalHave >= goal.need;
  landmarksGot = 0; spindleNew = false;
  for (const i of visit.got) if (SPECIES[g.plants[i].s].landmark) landmarksGot++;
  lastLevel = levelInfo(g, visit.mass).level; growDirty = true; nextKey = ''; levelRing = 0; nudge = { x: 0, y: 0, t: 0 };
  movedOnce = !!resume;
  clearTimeout(endTimer);
  if (!mode.timed) { store.cur = { place: placeId, mode: 'wander', gen: GEN, seed: g.seed, got: visit.got, x: B.x, y: B.y, found: [...found] }; save(); }

  document.documentElement.classList.add('playing');
  $('#choose').hidden = true; $('#play').hidden = false; $('#end').hidden = true;
  $('#placeName').textContent = place.name;
  $('#placeName').hidden = mode.timed;
  el.sun.hidden = !mode.timed;
  el.sky.style.background = 'transparent';
  el.toast.classList.remove('show', 'gold');
  el.coach.textContent = mode.timed ? 'Drag to steer. The sun rises when you start.' : 'Drag anywhere to steer the basket';
  el.coach.classList.toggle('gone', movedOnce);
  resize();
  cam.x = B.x; cam.y = B.y; cam.z = targetZoom();
  buildSprites();
  makeDecor();
  updateGrow(true);
  updateGoal(false);
  updateSun(true);
  el.help.hidden = store.seenHelp;
  if (!store.seenHelp) { store.seenHelp = true; save(); }
  start();
}

function leaveToChoose() {
  stop();
  persistCur();
  document.documentElement.classList.remove('playing');
  $('#play').hidden = true; $('#choose').hidden = false;
  renderChoose();
  window.scrollTo(0, 0);
}

function persistCur() {
  if (!g || ended || mode.timed) return;
  store.cur = { place: g.place, mode: 'wander', gen: GEN, seed: g.seed, got: visit.got, x: Math.round(B.x), y: Math.round(B.y), found: [...found] };
  save();
}

// ---------- HUD ----------
/** The growth bar: basket level, progress to the next size step, the next plant below it. */
function updateGrow(force) {
  if (!force && !growDirty) return;
  growDirty = false;
  const info = levelInfo(g, visit.mass);
  const pct = Math.round(info.progress * 100);
  if (force || info.level !== shown.level) { el.lvlN.textContent = String(info.level); shown.level = info.level; }
  if (force || pct !== shown.pct) { el.gfill.style.setProperty('--p', (pct / 100).toFixed(2)); el.gbar.setAttribute('aria-valuenow', String(pct)); shown.pct = pct; }
  const left = g.plants.length - visit.got.length - eatenN;
  const key = info.next ? info.next[0] : left ? 'all' : 'full';
  if (key !== nextKey || force) {
    nextKey = key;
    if (info.next) el.gnext.innerHTML = `${miniSprite(info.next[0])}<span>Next: <b>${SPECIES[info.next[0]].name}</b></span>`;
    else el.gnext.innerHTML = left ? '<span>Everything fits now</span>' : '<span>The garden is gathered</span>';
  }
  if (force || shown.cnt !== visit.got.length) { el.cnt.firstChild.nodeValue = String(visit.got.length); shown.cnt = visit.got.length; }
}
const shown = { level: 0, pct: -1, cnt: -1 };
function popCount() {
  if (reduced() || time - cntPopAt < 0.35) return;
  cntPopAt = time;
  el.cnt.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
}
let miniCache = {};
function miniSprite(s) {
  const e = sprites.get(s + 0) || sprites.get(s + 1) || sprites.get(s + 2);
  if (!e) return '';
  // a tiny canvas copy, drawn into an <img> so innerHTML stays simple
  if (!miniCache[s]) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    c.getContext('2d').drawImage(e.hi.canvas, 0, 0, 48, 48);
    miniCache[s] = c.toDataURL();
  }
  return `<img src="${miniCache[s]}" width="20" height="20" alt="">`;
}
function updateGoal(fresh) {
  const t = `${goalHave}/${goal.need}`;
  el.goal.classList.toggle('met', goalMet);
  el.goal.innerHTML = goalMet
    ? `<span class="tick" aria-hidden="true">&#10003;</span><span>Enough for ${DYES[goal.dye].name.toLowerCase()}! <b>${t}</b></span>`
    : `<span>Bonus: enough for ${DYES[goal.dye].name.toLowerCase()}, <b>${t}</b> ${SPECIES[goal.s].many}</span>`;
  if (fresh && !reduced()) el.goal.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 300 });
}
function showToast(text, prio, secs) {
  if (!prio && toastPrio && time < toastUntil) return;
  const changed = el.toast.textContent !== text;
  el.toast.textContent = text;
  el.toast.classList.toggle('gold', !!prio);
  el.toast.classList.add('show');
  toastUntil = time + secs; toastPrio = prio ? 1 : 0;
  return changed;
}
function popToast() {
  if (reduced()) return;
  el.toast.animate([{ transform: 'translateX(-50%) scale(1.14)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 240, easing: 'ease-out' });
}
function levelUp(n) {
  el.lvlpop.textContent = `Basket ${n}!`;
  const rm = reduced();
  el.lvlpop.animate(rm
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
    : [{ opacity: 0, transform: 'translateX(-50%) translateY(10px) scale(.8)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1.1)', offset: 0.25 }, { opacity: 1, transform: 'translateX(-50%) translateY(-6px) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translateX(-50%) translateY(-16px) scale(1)' }],
  { duration: rm ? 1000 : 1100, easing: 'ease-out' });
  el.grow.classList.add('up');
  setTimeout(() => el.grow.classList.remove('up'), 700);
  if (!rm) { B.squash = 1.8; levelRing = time; }
  chime();
}
function updateSun(force) {
  if (!clock.on) return;
  if (!force && time - (updateSun.at || 0) < 0.2) return;
  updateSun.at = time;
  const u = clock.t / clock.secs;
  const s = skyAt(u);
  el.sunDot.setAttribute('cx', (6 + 88 * s.sx).toFixed(1));
  el.sunDot.setAttribute('cy', (33 - 28 * (1 - s.sy)).toFixed(1));
  el.sunDot.setAttribute('fill', s.dusk > 0 ? '#E8875A' : s.gold > 0.3 ? '#F0A844' : '#F2C14E');
  el.clock.textContent = clockLabel(clock.secs - clock.t);
  const goldA = (0.16 * s.gold * (1 - s.dusk)).toFixed(3), duskA = (0.3 * s.dusk).toFixed(3);
  el.sky.style.background = s.gold || s.dusk ? `linear-gradient(rgba(64,44,104,${duskA}), rgba(64,44,104,${duskA})), rgba(255,176,64,${goldA})` : 'transparent';
}

// ---------- input ----------
function toScreen(x, y) { return { x: (x - cam.x) * cam.z + vw / 2, y: (y - cam.y) * cam.z + vh / 2 }; }
function moved() { if (!movedOnce) { movedOnce = true; el.coach.classList.add('gone'); } }
cv.addEventListener('pointerdown', (e) => {
  if (drag || ended) return;
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
  const bs = toScreen(B.x, B.y);
  const near = Math.hypot(e.clientX - bs.x, e.clientY - bs.y) < B.r * cam.z * 1.15 + 26;
  drag = { id: e.pointerId, ax: e.clientX, ay: e.clientY, x: e.clientX, y: e.clientY, carry: near };
  ensureAudio();
});
cv.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  e.preventDefault();
  drag.x = e.clientX; drag.y = e.clientY;
  if (Math.hypot(drag.x - drag.ax, drag.y - drag.ay) > 12) moved();
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('lostpointercapture', endDrag);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (!running || !e.key.startsWith('Arrow')) return;
  keys.add(e.key); e.preventDefault();
  moved();
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => { keys.clear(); drag = null; });

// ---------- sound (off by default; never before a gesture) ----------
let actx = null, lastPluck = 0;
function ensureAudio() {
  if (!store.sound) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
const soundOK = () => store.sound && actx && actx.state === 'running';
function tone(freq, t0, dur, vol = 0.1, type = 'triangle') {
  const o = actx.createOscillator(), gn = actx.createGain(), f = actx.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = 1900;
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(f); f.connect(gn); gn.connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
// a pentatonic ladder: each pluck in a sweep climbs a step
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
function pluck(r, kind, n) {
  if (!soundOK()) return;
  const now = actx.currentTime;
  if (now - lastPluck < 0.045 && !kind) return;
  lastPluck = now;
  const base = 330 * Math.pow(8 / r, 0.25);
  if (kind === 'land') [0, 4, 7, 12, 16].forEach((s, k) => tone(base * Math.pow(2, s / 12), now + k * 0.11, 1.4, 0.1));
  else if (kind === 'grand') [0, 7, 12].forEach((s, k) => tone(base * Math.pow(2, s / 12), now + k * 0.09, 0.9, 0.11));
  else tone(base * Math.pow(2, LADDER[Math.min(LADDER.length - 1, Math.max(0, n - 1))] / 12), now, 0.3, 0.1);
}
function chime() { if (!soundOK()) return; const t = actx.currentTime; tone(784, t, 0.6, 0.06, 'sine'); tone(1175, t + 0.09, 0.7, 0.05, 'sine'); }
function tick() { if (!soundOK()) return; const t = actx.currentTime; tone(1320, t, 0.14, 0.05, 'sine'); tone(1760, t + 0.07, 0.18, 0.04, 'sine'); }
function shimmer() { if (!soundOK()) return; const t = actx.currentTime; [1047, 1319, 1568, 2093].forEach((f, k) => tone(f, t + k * 0.05, 0.35, 0.035, 'sine')); }
function duskSound() { if (!soundOK()) return; const t = actx.currentTime; tone(294, t, 1.6, 0.05, 'sine'); tone(440, t + 0.15, 1.6, 0.04, 'sine'); }
function bestSound() { if (!soundOK()) return; const t = actx.currentTime; [523, 659, 784, 1047].forEach((f, k) => tone(f, t + k * 0.1, 0.6, 0.05, 'sine')); }
function renderSound() {
  const b = $('#sound');
  b.setAttribute('aria-pressed', String(store.sound));
  b.textContent = store.sound ? '♪ On' : '♪ Off';
  b.setAttribute('aria-label', store.sound ? 'Sound is on' : 'Sound is off');
}
$('#sound').addEventListener('click', () => {
  store.sound = !store.sound; save(); renderSound();
  if (store.sound) { ensureAudio(); setTimeout(() => pluck(10, '', 1), 30); }
});
renderSound();

// ---------- loop ----------
function start() {
  if (running || document.hidden) return;
  running = true; lastT = 0;
  raf = requestAnimationFrame(frame);
}
function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame); // schedule first: an exception below cannot stop the loop
  const t0 = performance.now();
  try {
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    if (lastT) { frameDt.push(now - lastT); if (frameDt.length > 1200) frameDt.shift(); adapt(now - lastT); }
    lastT = now;
    step(dt);
    if (running) draw();
  } catch (err) {
    errs++;
    console.error('garden frame', err);
    if (errs > 30) { stop(); el.coach.textContent = 'The garden needs a moment. Tap Head home to keep your jars.'; el.coach.classList.remove('gone'); }
  }
  frameWork.push(performance.now() - t0); if (frameWork.length > 1200) frameWork.shift();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stop(); persistCur(); drag = null; }
  else if (g && !$('#play').hidden && $('#end').hidden) start();
});
window.addEventListener('pagehide', persistCur);

const targetZoom = () => Z0 * Math.pow(R0 / basketRadius(g, visit.mass), 0.6);
const openNow = () => (time < effects.brim ? OPENING * FIND_KINDS.brim.open : OPENING);

function step(dt) {
  time += dt;
  const paused = !el.help.hidden;
  // the clock: starts with her first move, pauses while help is open
  if (clock.on && !ended && !paused) {
    if (!clock.started && movedOnce) {
      clock.started = true;
      if (goat) showToast("The neighbor's goat is in the garden too!", true, 2.6);
    }
    if (clock.started) { clock.t += dt; if (clock.t >= clock.secs) { clock.t = clock.secs; dusk(); } }
  }
  if (clock.on) updateSun(false);

  // steering
  const vmax = 300 / cam.z;
  let dx = 0, dy = 0, k = 0;
  if (homing) {
    homing.t += dt;
    const ox = g.W / 2 - B.x, oy = g.H - 20 - B.y, d = Math.hypot(ox, oy) || 1;
    dx = ox / d; dy = oy / d; k = Math.min(0.7, d / 60);
    if (homing.t >= homing.D) { homing = null; showEnd('dusk'); return; }
  } else if (drag && !ended) {
    let ox, oy;
    if (drag.carry) { const bs = toScreen(B.x, B.y); ox = drag.x - bs.x; oy = drag.y - bs.y; }
    else {
      ox = drag.x - drag.ax; oy = drag.y - drag.ay;
      const d = Math.hypot(ox, oy);
      if (d > 84) { drag.ax = drag.x - (ox / d) * 84; drag.ay = drag.y - (oy / d) * 84; ox = (ox / d) * 84; oy = (oy / d) * 84; }
    }
    const d = Math.hypot(ox, oy);
    if (d > 3) { dx = ox / d; dy = oy / d; k = Math.min(1, (d - 3) / (drag.carry ? 70 : 56)); }
  } else if (auto && !ended) {
    if (time > auto.next || auto.i < 0 || taken[auto.i]) { auto.i = nearestGatherable(g, visit, B.x, B.y, taken); auto.next = time + 0.25; }
    if (auto.i >= 0) { const p = g.plants[auto.i]; const ox = p.x - B.x, oy = p.y - B.y, d = Math.hypot(ox, oy) || 1; dx = ox / d; dy = oy / d; k = Math.min(1, d * cam.z / 40); }
  } else if (keys.size && !ended) {
    dx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    dy = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; k = 1;
  }
  const ease = 1 - Math.exp(-dt * 9);
  B.vx += (dx * k * vmax - B.vx) * ease;
  B.vy += (dy * k * vmax - B.vy) * ease;
  B.x += B.vx * dt; B.y += B.vy * dt;
  const br = basketRadius(g, visit.mass);
  const m = Math.min(br * 0.7, 30);
  if (B.x < m) { B.x = m; B.vx = 0; } if (B.x > g.W - m) { B.x = g.W - m; B.vx = 0; }
  if (B.y < m) { B.y = m; B.vy = 0; } if (B.y > g.H - m) { B.y = g.H - m; B.vy = 0; }

  if (!ended) {
    const open = openNow();
    // gathering: anything that fits and sits over the opening tips in
    const near = queryGrid(grid, B.x - br - grid.cell, B.y - br - grid.cell, B.x + br + grid.cell, B.y + br + grid.cell, step.buf || (step.buf = []));
    for (let n = 0; n < near.length && !ended; n++) {
      const i = near[n];
      if (taken[i]) continue;
      const p = g.plants[i];
      if (fits(g, p, visit.mass, open) && over(B.x, B.y, basketRadius(g, visit.mass), p)) onGather(i, open, '');
    }
    // a breeze draws little plants in from around the basket
    if (time < effects.breeze && !ended) {
      const R = basketRadius(g, visit.mass) * FIND_KINDS.breeze.reach + 16;
      const list = queryGrid(grid, B.x - R, B.y - R, B.x + R, B.y + R, step.buf2 || (step.buf2 = []));
      let pulled = 0;
      for (let n = 0; n < list.length && pulled < 4 && !ended; n++) {
        const i = list[n];
        if (taken[i]) continue;
        if (breezeCatches(g, g.plants[i], visit.mass, B.x, B.y, open)) { onGather(i, open, 'breeze'); pulled++; }
      }
    }
    // finds
    const fk = findAt(g, found, B.x, B.y, B.r);
    if (fk >= 0) onFind(fk);
    // the goat, on a fixed tick so it behaves the same every time
    if (goat && clock.started && !paused && !ended) {
      goatAcc = Math.min(goatAcc + dt, GOAT.dt * 4);
      while (goatAcc >= GOAT.dt) {
        goatAcc -= GOAT.dt;
        const e = goatStep(g, goat, taken, grid, { x: B.x, y: B.y, r: basketRadius(g, visit.mass) });
        if (e >= 0) onGoatEat(e);
      }
      if (goat.startled !== goatSaid) { goatSaid = goat.startled; goatSayUntil = time + 0.9; }
    }
  }

  // easing: basket size, camera, zoom
  B.r += (basketRadius(g, visit.mass) - B.r) * (1 - Math.exp(-dt * 5));
  B.squash = Math.max(0, B.squash - dt * 4);
  const ce = 1 - Math.exp(-dt * 5);
  cam.x += (B.x + B.vx * 0.25 - cam.x) * ce;
  cam.y += (B.y + B.vy * 0.25 - cam.y) * ce;
  cam.z += (targetZoom() - cam.z) * (1 - Math.exp(-dt * 1.6));
  const hw = vw / 2 / cam.z, hh = vh / 2 / cam.z;
  // margins in screen pixels, so the field's edges can always come clear of the top HUD and Head home
  const mx = 40 / cam.z, mt = 170 / cam.z, mb = 90 / cam.z;
  cam.x = g.W > 2 * hw - 2 * mx ? Math.max(hw - mx, Math.min(g.W - hw + mx, cam.x)) : g.W / 2;
  cam.y = g.H > 2 * hh - mt - mb ? Math.max(hh - mt, Math.min(g.H - hh + mb, cam.y)) : (g.H + mb - mt) / 2;
  nudge.t = Math.max(0, nudge.t - dt);

  for (const f of falling) f.t += dt;
  if (falling.length && falling.some((f) => f.t > f.D)) falling = falling.filter((f) => f.t <= f.D);
  if (bits.length) {
    for (const b of bits) b.t += dt;
    if (bits.some((b) => b.t > b.L)) bits = bits.filter((b) => b.t <= b.L);
  }

  // toasts: a sweep stays up while it lasts
  if (combo && comboOpen(combo, time) && combo.n >= 5) toastUntil = Math.max(toastUntil, time + 0.2);
  if (toastUntil && time > toastUntil) { toastUntil = 0; toastPrio = 0; el.toast.classList.remove('show'); }

  // hints: a soft glow on the nearest plant that fits, after a quiet spell
  if (time > hintCheck) {
    hintCheck = time + 0.5;
    const quiet = time - Math.max(lastGather, 0) > 5 || time - lastVisibleFit > 2.5;
    hint = quiet && !ended ? nearestGatherable(g, visit, B.x, B.y, taken) : -1;
  }
  if (time > growAt) { growAt = time + 0.12; updateGrow(false); }
  if (comboText && time > comboTextAt) { comboTextAt = time + 0.15; const t = comboText; comboText = ''; if (showToast(t, false, 1.1) && comboPop) popToast(); comboPop = false; }
  if (time > saveDue && saveDue) { saveDue = 0; persistCur(); }
}

function onGather(i, open, how) {
  const p = g.plants[i];
  const before = visit.got.length;
  visit = gather(g, visit, i, open);
  if (visit.got.length === before) return;
  taken[i] = 1;
  const sp = SPECIES[p.s];
  const big = sp.landmark || sp.grand;
  const rm = reduced();
  falling.push({ i, t: 0, dir: p.x < B.x ? 1 : -1, kind: sp.landmark ? 'land' : sp.grand ? 'grand' : how || 'plain', D: rm ? 0.22 : sp.landmark ? 1.3 : sp.grand ? 0.95 : how === 'breeze' ? 0.6 : 0.5 });
  lastGather = time; hint = -1;
  recent.push(DYES[sp.dye].hex); if (recent.length > 8) recent.shift();
  B.squash = Math.max(B.squash, big ? 1.8 : 1);
  combo = comboAdd(combo, time, p.s);
  comboBest = Math.max(comboBest, combo.n);
  pluck(p.r, sp.landmark ? 'land' : sp.grand ? 'grand' : '', combo.n);
  if (!rm) {
    spawnBits(p, sp.landmark ? 30 : sp.grand ? 16 : 2);
    if (big) { const d = Math.hypot(B.x - p.x, B.y - p.y) || 1; const a = sp.landmark ? 7 : 4; nudge = { x: (B.x - p.x) / d * a, y: (B.y - p.y) / d * a, t: 0.4, D: 0.4 }; }
  }
  if (sp.landmark) { landmarksGot++; showToast(`${cap(sp.the)} tumbles in!`, true, 2.8); popToast(); }
  else if (sp.grand) { showToast(`${sp.name}, all of it!`, true, 2.2); popToast(); }
  else if (combo.n >= 5) {
    // the sweep line updates a few times a second, not on every pluck
    comboText = comboLabel(combo);
    if (combo.n === 5 || combo.n % 10 === 0) comboPop = true;
  }
  if (!goalMet && p.s === goal.s) {
    goalHave++;
    if (goalHave >= goal.need) { goalMet = true; tick(); showToast(`Enough for ${DYES[goal.dye].name.toLowerCase()}!`, true, 2.2); }
    updateGoal(goalMet);
  }
  const info = levelInfo(g, visit.mass);
  if (info.level > lastLevel) { lastLevel = info.level; levelUp(info.level); }
  growDirty = true; popCount();
  if (!saveDue && !mode.timed) saveDue = time + 1.5;
  if (isDone(g, visit, eatenN)) finishSoon();
}
function onGoatEat(i) {
  taken[i] = 2; eatenN++;
  falling.push({ i, t: 0, dir: 1, kind: 'goat', D: reduced() ? 0.2 : 0.5, gx: goat.x + goat.face * 9, gy: goat.y - 3 });
  growDirty = true;
  if (isDone(g, visit, eatenN)) finishSoon();
}
function finishSoon() {
  if (ended) return;
  ended = true; drag = null;
  endTimer = setTimeout(() => showEnd(eatenN ? 'cleared' : 'done'), reduced() ? 300 : 1400);
}
function dusk() {
  if (ended) return;
  ended = true; drag = null;
  homing = { t: 0, D: reduced() ? 0.6 : 1.8 };
  showToast('Dusk. The basket heads home.', true, 3);
  duskSound();
}
function onFind(k) {
  found.add(k);
  const f = g.finds[k], kind = FIND_KINDS[f.k];
  if (f.k === 'brim') effects.brim = time + kind.secs;
  if (f.k === 'breeze') effects.breeze = time + kind.secs;
  let text = kind.text;
  if (f.k === 'spindle') {
    const key = spindleKey();
    if (!store.spindles.includes(key)) { store.spindles.push(key); spindleNew = true; save(); }
    text = `You found a lost spindle! (${store.spindles.length} kept)`;
  }
  showToast(text, true, 2.6); popToast();
  shimmer();
  if (!reduced()) spawnSparkle(f.x, f.y);
  saveDue = saveDue || time + 1;
}

// ---------- little bits that pop up and fall in ----------
function spawnBits(p, n) {
  const c = DYES[SPECIES[p.s].dye].hex;
  for (let k = 0; k < n && bits.length < 160; k++) {
    const a = Math.random() * Math.PI * 2, s = p.r * (0.2 + Math.random() * 0.6);
    bits.push({ x0: p.x + Math.cos(a) * s, y0: p.y + Math.sin(a) * s, t: 0, L: 0.45 + Math.random() * 0.35, h: p.r * (0.5 + Math.random() * 0.9), c: k % 3 === 2 ? '#7E9A58' : c, s: Math.max(1.5, p.r * 0.12) });
  }
}
function spawnSparkle(x, y) {
  for (let k = 0; k < 14 && bits.length < 160; k++) {
    const a = (k / 14) * Math.PI * 2;
    bits.push({ x0: x + Math.cos(a) * 12, y0: y + Math.sin(a) * 12, t: 0, L: 0.6, h: 14, c: k % 2 ? '#FFF2C4' : '#E2B04A', s: 2.2 });
  }
}

// ---------- drawing ----------
function lowerBound(arr, y) { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].y < y) lo = mid + 1; else hi = mid; } return lo; }
const drawList = [], lateList = [];

function draw() {
  const z = cam.z;
  let sx = 0, sy = 0;
  if (nudge.t > 0 && !reduced()) { const k = nudge.t / nudge.D; sx = nudge.x * k * Math.cos((1 - k) * 9); sy = nudge.y * k * Math.cos((1 - k) * 9); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // one full-screen fill (the field color); the outside only where it shows. Fill area is the main raster cost on phones.
  ctx.fillStyle = gr.base; ctx.fillRect(0, 0, vw, vh);
  const s = dpr * z;
  ctx.setTransform(s, 0, 0, s, dpr * (vw / 2 - cam.x * z + sx), dpr * (vh / 2 - cam.y * z + sy));
  const x0 = cam.x - vw / 2 / z, x1 = cam.x + vw / 2 / z, y0 = cam.y - vh / 2 / z, y1 = cam.y + vh / 2 / z;

  // ground
  ctx.fillStyle = gr.out;
  if (x0 < 0) ctx.fillRect(x0 - 2, y0 - 2, -x0 + 2, y1 - y0 + 4);
  if (x1 > g.W) ctx.fillRect(g.W, y0 - 2, x1 - g.W + 2, y1 - y0 + 4);
  if (y0 < 0) ctx.fillRect(Math.max(0, x0), y0 - 2, Math.min(g.W, x1) - Math.max(0, x0), -y0 + 2);
  if (y1 > g.H) ctx.fillRect(Math.max(0, x0), g.H, Math.min(g.W, x1) - Math.max(0, x0), y1 - g.H + 2);
  if (place.ground === 'terraces') {
    const band = place.rows;
    for (let k = Math.max(0, Math.floor(y0 / band)); k * band < Math.min(g.H, y1); k++) {
      if (k % 2) { ctx.fillStyle = gr.band; ctx.fillRect(Math.max(0, x0), k * band, Math.min(g.W, x1) - Math.max(0, x0), band); }
      ctx.fillStyle = 'rgba(42,38,34,.14)'; ctx.fillRect(Math.max(0, x0), k * band + 4, Math.min(g.W, x1) - Math.max(0, x0), 6);
      ctx.fillStyle = gr.wall; ctx.fillRect(Math.max(0, x0), k * band, Math.min(g.W, x1) - Math.max(0, x0), 6);
    }
  } else if (place.ground === 'shore') {
    ctx.fillStyle = '#D9C9A0'; ctx.fillRect(g.W - 70, Math.max(0, y0), 70, Math.min(g.H, y1) - Math.max(0, y0));
    ctx.fillStyle = '#F4EFE4';
    for (let y = Math.max(0, Math.floor(y0 / 40) * 40); y < Math.min(g.H, y1 + 40); y += 40) {
      ctx.beginPath(); ctx.ellipse(g.W + 2, y + 20, 7, 18, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = gr.rocks; ctx.fillRect(0, Math.max(0, y0), g.W * 0.12, Math.min(g.H, y1) - Math.max(0, y0));
  }
  ctx.strokeStyle = gr.edge; ctx.lineWidth = 6; ctx.strokeRect(-3, -3, g.W + 6, g.H + 6);
  // decor is skipped when it is only a speck on screen
  if (z * 8 > 5) for (let i = lowerBound(decor, y0 - 10); i < decor.length && decor[i].y < y1 + 10; i++) {
    const d = decor[i];
    if (d.x < x0 - 10 || d.x > x1 + 10) continue;
    ctx.drawImage(decorSprites[d.k], d.x - d.s, d.y - d.s, d.s * 2, d.s * 2);
  }

  // finds: sparkles on the ground
  for (let k = 0; k < g.finds.length; k++) {
    if (found.has(k)) continue;
    const f = g.finds[k];
    if (f.x < x0 - 20 || f.x > x1 + 20 || f.y < y0 - 20 || f.y > y1 + 20) continue;
    const tw = reduced() ? 1 : 1 + 0.1 * Math.sin(time * 3 + k * 1.7);
    const h = FIND_R * tw;
    ctx.drawImage(findSprites[f.k], f.x - h, f.y - h, h * 2, h * 2);
  }

  // plants: those that fit, then the basket, then the ones still too big (the basket slides under them)
  const open = openNow();
  const lim = open * basketRadius(g, visit.mass);
  const pad = grid.maxR * 1.4;
  drawList.length = 0; lateList.length = 0;
  let visibleFit = false;
  for (let i = lowerBound(g.plants, y0 - pad); i < g.plants.length; i++) {
    const p = g.plants[i];
    if (p.y > y1 + pad) break;
    if (taken[i]) continue;
    const pr = p.r * PAD;
    if (p.x + pr < x0 || p.x - pr > x1 || p.y + pr < y0 || p.y - pr > y1) continue;
    if (p.r <= lim) { drawList.push(i); if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) visibleFit = true; } else lateList.push(i);
  }
  if (visibleFit) lastVisibleFit = time;
  for (const i of drawList) drawPlant(g.plants[i], 1);
  drawBasket();
  for (const f of falling) drawFalling(f);
  if (goat) drawGoat(x0, x1, y0, y1);
  const rm = reduced();
  for (const i of lateList) {
    const p = g.plants[i];
    const d = Math.hypot(p.x - B.x, p.y - B.y);
    if (p.r <= lim * TEETER && d < B.r * 0.95) {
      // a little too big: it wobbles on the rim until the basket grows enough
      const rot = rm ? 0.06 : Math.sin(time * 11 + i) * 0.14;
      const lift = rm ? 0 : Math.abs(Math.sin(time * 11 + i)) * p.r * 0.06;
      drawPlantRot(p, p.x, p.y - lift, rot, 1);
    } else drawPlant(p, d < p.r + B.r ? 0.55 : 1);
  }

  // bits popping into the basket
  for (const b of bits) {
    const u = b.t / b.L, e = u * u;
    const x = b.x0 + (B.x - b.x0) * e, y = b.y0 + (B.y - b.y0) * e - Math.sin(u * Math.PI) * b.h;
    ctx.fillStyle = b.c;
    ctx.fillRect(x - b.s / 2, y - b.s / 2, b.s, b.s);
  }

  // power-up rings around the basket
  if (time < effects.brim) {
    const left = effects.brim - time;
    ctx.globalAlpha = left < 2 && !rm ? 0.5 + 0.5 * Math.sin(time * 14) : 0.85;
    ctx.beginPath(); ctx.arc(B.x, B.y, B.r * 1.1, 0, Math.PI * 2);
    ctx.lineWidth = B.r * 0.13; ctx.strokeStyle = '#E2B04A'; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (time < effects.breeze) {
    const R = basketRadius(g, visit.mass) * FIND_KINDS.breeze.reach + 16;
    ctx.lineWidth = 2.2 / z; ctx.strokeStyle = 'rgba(240,248,250,.75)';
    const rot = rm ? 0 : time * 2.2;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(B.x, B.y, R * (0.55 + k * 0.2), rot + k * 2.1, rot + k * 2.1 + 1.3); ctx.stroke(); }
  }
  if (levelRing && time - levelRing < 0.6) {
    const u = (time - levelRing) / 0.6;
    ctx.globalAlpha = 1 - u;
    ctx.beginPath(); ctx.arc(B.x, B.y, B.r * (1.05 + 0.5 * u), 0, Math.PI * 2);
    ctx.lineWidth = 4 / z; ctx.strokeStyle = '#FFF2C4'; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // hint glow and an edge arrow when the plant is off screen
  if (hint >= 0 && !taken[hint]) {
    const p = g.plants[hint];
    const pulse = rm ? 0.6 : 0.5 + 0.5 * Math.sin(time * 4);
    const onScreen = p.x > x0 && p.x < x1 && p.y > y0 + 130 / z && p.y < y1 - 70 / z;
    if (onScreen) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.25 + 0.12 * pulse), 0, Math.PI * 2);
      ctx.lineWidth = 3 / z; ctx.strokeStyle = `rgba(226,176,74,${0.55 + 0.4 * pulse})`; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.25, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,236,170,${0.18 + 0.12 * pulse})`; ctx.fill();
    } else drawArrow(p, pulse);
  }

  // a soft ring where her thumb steers from
  if (drag && !drag.carry) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath(); ctx.arc(drag.ax, drag.ay, 30, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(251,248,241,.7)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(drag.x, drag.y, 12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(251,248,241,.55)'; ctx.fill();
  }
}

/** The sprite to draw: the small copy when the plant is tiny on screen (much cheaper to scale). */
function spriteFor(p, scale) {
  const e = sprites.get(p.s + p.v);
  const px = p.r * 2 * PAD * cam.z * dpr * scale; // on-screen size in device pixels
  return px < e.loPx * 1.3 ? e.lo : px < e.midPx * 1.3 ? e.mid : e.hi;
}
/** Blit only the opaque box of a sprite into the square (x - h, y - h, 2h, 2h). */
function blit(sp, x, y, h) {
  const b = sp.box, n = sp.canvas.width, d = h * 2;
  ctx.drawImage(sp.canvas, b.x * n, b.y * n, b.w * n, b.h * n, x - h + b.x * d, y - h + b.y * d, b.w * d, b.h * d);
}
function drawPlant(p, alpha) {
  const sp = spriteFor(p, 1);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  blit(sp, p.x, p.y, p.r * sp.half);
  if (alpha !== 1) ctx.globalAlpha = 1;
}
function drawPlantRot(p, x, y, rot, sc, a = 1) {
  const sp = spriteFor(p, sc);
  ctx.save();
  if (a !== 1) ctx.globalAlpha = a;
  ctx.translate(x, y); if (rot) ctx.rotate(rot);
  blit(sp, 0, 0, p.r * sp.half * sc);
  ctx.restore();
}

function drawBasket() {
  const sq = reduced() ? 0 : Math.sin(Math.min(1, B.squash) * Math.PI) * (B.squash > 1 ? 0.12 : 0.07);
  const rx = B.r * (1 + sq), ry = B.r * (1 - sq * 0.6);
  const h = bSprite.half;
  ctx.drawImage(bSprite.canvas, B.x - rx * h, B.y - ry * h, rx * h * 2, ry * h * 2);
  // a few dyed bits peeking out of the opening
  for (let k = 0; k < recent.length; k++) {
    const a = k * 2.4, d = B.r * (0.25 + (k % 3) * 0.17);
    ctx.beginPath(); ctx.arc(B.x + Math.cos(a) * d, B.y + Math.sin(a) * d * 0.9, B.r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = recent[k]; ctx.fill();
  }
}

function drawFalling(f) {
  const p = g.plants[f.i];
  const u = Math.min(1, f.t / f.D);
  if (u >= 1) return;
  let x = p.x, y = p.y, sc = 1, rot = 0, a = 1;
  if (reduced()) { sc = 1 - 0.3 * u; a = 1 - u; }
  else if (f.kind === 'goat') {
    x = p.x + (f.gx - p.x) * u; y = p.y + (f.gy - p.y) * u; sc = 1 - 0.85 * u; a = u > 0.8 ? (1 - u) / 0.2 : 1;
  } else if (f.kind === 'land' || f.kind === 'grand') {
    // it teeters on the rim, then tips over and sinks in
    const rockEnd = f.kind === 'land' ? 0.38 : 0.25;
    if (u < rockEnd) { const w = u / rockEnd; rot = Math.sin(w * Math.PI * 3) * 0.16; y = p.y - Math.abs(Math.sin(w * Math.PI * 3)) * p.r * 0.05; }
    else {
      const w = (u - rockEnd) / (1 - rockEnd), e = w * w;
      x = p.x + (B.x - p.x) * e; y = p.y + (B.y - p.y) * e - Math.sin(w * Math.PI) * p.r * 0.22;
      rot = f.dir * (w * 1.5); sc = 1 - 0.85 * e; a = w > 0.85 ? (1 - w) / 0.15 : 1;
    }
  } else {
    // pops up, tumbles over and drops in
    const m = Math.min(1, u * 1.35), e = m * m;
    x = p.x + (B.x - p.x) * e; y = p.y + (B.y - p.y) * e - Math.sin(Math.min(1, u * 1.5) * Math.PI) * p.r * 0.9;
    sc = u < 0.3 ? 1 + 0.12 * Math.sin((u / 0.3) * Math.PI) : 1 - 0.75 * ((u - 0.3) / 0.7);
    rot = f.dir * u * (f.kind === 'breeze' ? 4.2 : 2.8); a = u > 0.85 ? (1 - u) / 0.15 : 1;
  }
  drawPlantRot(p, x, y, rot, sc, a);
}

function drawGoat(x0, x1, y0, y1) {
  if (goat.x < x0 - 30 || goat.x > x1 + 30 || goat.y < y0 - 30 || goat.y > y1 + 30) return;
  const rm = reduced();
  let lift = 0, frame = 0;
  if (goat.state === 'hop' && !rm) lift = Math.abs(Math.sin((goat.hopT / GOAT.hopSecs) * Math.PI * 2)) * 10;
  else if (goat.state === 'walk' && !rm) frame = Math.floor(time * 6) % 2;
  else if (goat.state === 'munch' && !rm) frame = Math.floor(time * 4) % 2;
  const h = GOAT_R;
  ctx.save();
  ctx.translate(goat.x, goat.y - h * 0.5 - lift);
  ctx.scale(goat.face, 1);
  ctx.drawImage(goatSprites[frame], -h, -h, h * 2, h * 2);
  ctx.restore();
  if (time < goatSayUntil) {
    const zz = cam.z;
    ctx.font = `700 ${13 / zz}px Figtree, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(251,248,241,.95)';
    const tx = goat.x, ty = goat.y - h * 1.7 - lift;
    ctx.beginPath(); ctx.ellipse(tx, ty - 4 / zz, 22 / zz, 12 / zz, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2622';
    ctx.fillText('Maa!', tx, ty);
  }
}

function drawArrow(p, pulse) {
  const sp = toScreen(p.x, p.y);
  const cx = vw / 2, cy = vh / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const top = 150, bot = 84, side = 30;
  // clamp to the visible play area (below the top HUD, above Head home)
  const tx = Math.cos(ang), ty = Math.sin(ang);
  let t = Infinity;
  if (tx > 0) t = Math.min(t, (vw - side - cx) / tx);
  if (tx < 0) t = Math.min(t, (side - cx) / tx);
  if (ty > 0) t = Math.min(t, (vh - bot - cy) / ty);
  if (ty < 0) t = Math.min(t, (top - cy) / ty);
  const ax = cx + tx * t, ay = cy + ty * t;
  ctx.setTransform(dpr, 0, 0, dpr, dpr * ax, dpr * ay);
  ctx.rotate(ang);
  const s = 1 + 0.08 * pulse;
  ctx.scale(s, s);
  ctx.beginPath(); ctx.arc(0, 2, 19, 0, Math.PI * 2); ctx.fillStyle = 'rgba(42,38,34,.18)'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fillStyle = '#FBF8F1'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(226,176,74,${0.6 + 0.4 * pulse})`; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(6, 0); ctx.lineTo(-5, 8);
  ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#8C6512'; ctx.stroke();
}

// ---------- the end of a visit ----------
/** Bank the haul (and a harvest score). Safe to call once per visit. */
function finishVisit(reason) {
  if (result) return result;
  ended = true; homing = null;
  clearTimeout(endTimer);
  drag = null;
  const haul = tally(g, visit.got);
  for (const t of haul) store.shelf[t.dye] = (store.shelf[t.dye] || 0) + t.units;
  const fact = pickFact(g, visit.got, store.visits);
  store.visits++;
  if (!mode.timed) store.cur = null;
  let score = null, prev = null, isNew = false;
  if (mode.timed) {
    const daily = g.seed !== harvestSeed(g.place);
    const spare = reason === 'done' || reason === 'cleared' ? clock.secs - clock.t : 0;
    score = harvestScore(g, visit.got, visit.mass, spare);
    prev = bestFor(g.place, daily);
    isNew = score.plants > 0 && betterScore(score, prev);
    if (isNew) setBest(g.place, score, daily);
  }
  save();
  result = { reason, haul, fact, score, prev, isNew };
  return result;
}
function showEnd(reason) {
  const r = finishVisit(reason);
  const { haul, fact, score, prev, isNew } = r;
  const where = theName(place);
  const n = visit.got.length;
  if (mode.timed) {
    $('#endTitle').textContent = reason === 'dusk' ? `Dusk at ${where}` : reason === 'home' ? `Home early from ${where}` : reason === 'cleared' ? `You and the goat cleared ${where}` : `You gathered all of ${where}`;
    $('#endSub').textContent = n ? '' : 'A quiet evening stroll. The plants will be here next time.';
    $('#endSub').hidden = !!n;
    const bestLine = isNew
      ? `<span class="newbest">New best!</span>${prev ? ` <span>Before: ${prev.jars} jar${prev.jars === 1 ? '' : 's'}</span>` : ''}`
      : prev ? `Your best at ${where}: <b>${prev.jars} jar${prev.jars === 1 ? '' : 's'}</b> · Basket ${prev.level}` : 'Your first harvest here.';
    const spareLine = score.spare ? `<br>Everything gathered with ${clockLabel(score.spare)} of sun to spare` : '';
    $('#score').innerHTML = `<div class="big">${score.jars}<small> jar${score.jars === 1 ? '' : 's'}</small></div><div class="sub"><b>Basket ${score.level}</b> · ${n} plant${n === 1 ? '' : 's'}${spareLine}<br>${bestLine}</div>`;
    $('#score').hidden = false;
    if (isNew) bestSound();
  } else {
    $('#endTitle').textContent = reason === 'done' ? `You gathered all of ${where}` : `Home from ${where}`;
    $('#endSub').textContent = n ? `${n} plant${n === 1 ? '' : 's'} in the basket. Here are your jars:` : 'A quiet stroll today. The plants will be here next time.';
    $('#endSub').hidden = false;
    $('#score').hidden = true;
  }
  const notes = [];
  if (goalMet) notes.push(`<li>&#10003; Bonus met: enough for ${DYES[goal.dye].name.toLowerCase()}.</li>`);
  if (comboBest >= 5) notes.push(`<li>Biggest sweep: ${comboBest} in one go.</li>`);
  if (landmarksGot) notes.push(`<li>Even ${landmarksGot === 1 ? 'a landmark' : `${landmarksGot} landmarks`} fit in the basket.</li>`);
  if (spindleNew) notes.push(`<li>A lost spindle came home with you (${store.spindles.length} kept).</li>`);
  if (goat && goat.eaten) notes.push(`<li>The neighbor's goat nibbled ${goat.eaten} plant${goat.eaten === 1 ? '' : 's'}${goat.startled ? ` and hopped off ${goat.startled === 1 ? 'once' : `${goat.startled} times`}` : ''}.</li>`);
  $('#notes').innerHTML = notes.join('');
  $('#haul').innerHTML = haul.map((t) => `<li><span class="jarbox"><span class="jar" style="--c:${t.hex};--f:100%"><i></i></span></span><span class="nm">${t.name}<em>${jarsLabel(t.units)}</em></span></li>`).join('');
  $('#haul').hidden = !haul.length;
  $('#fact').innerHTML = `<small>From the dye notebook</small>${fact.text}`;
  $('#again').textContent = mode.timed ? 'Harvest again' : 'Visit again';
  el.toast.classList.remove('show');
  $('#end').hidden = false;
  stop();
  draw();
  $('#again').focus({ preventScroll: true });
}
const endReason = () => (homing ? 'dusk' : isDone(g, visit, eatenN) ? (eatenN ? 'cleared' : 'done') : 'home');
$('#home').addEventListener('click', () => { if (!$('#end').hidden) return; showEnd(endReason()); });
$('#again').addEventListener('click', () => startVisit(g.place, mode.id, mode.timed ? g.seed : freshSeed()));
$('#another').addEventListener('click', () => { g = null; leaveToChoose(); });
$('#leave').addEventListener('click', () => {
  // a harvest left early still brings its jars home
  if (g && !result && (mode.timed || ended)) finishVisit(endReason());
  if (result) g = null;
  leaveToChoose();
});
$('#helpBtn').addEventListener('click', () => { el.help.hidden = false; $('#helpOk').focus(); });
$('#helpOk').addEventListener('click', () => { el.help.hidden = true; });

// ---------- test hooks (read-only views for the Playwright check) ----------
window.__garden = {
  stats() {
    const d = [...frameDt].sort((a, b) => a - b), w = [...frameWork].sort((a, b) => a - b);
    const q = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0);
    return { dpr, frames: d.length, p50: q(d, 0.5), p95: q(d, 0.95), p99: q(d, 0.99), max: q(d, 1), over20: d.filter((x) => x > 20).length, work50: q(w, 0.5), work95: q(w, 0.95), workMax: q(w, 1) };
  },
  autopilot(on) { auto = on ? { i: -1, next: 0 } : null; if (on) moved(); },
  resetStats() { frameDt.length = 0; frameWork.length = 0; },
  debug() {
    if (!g) return null;
    const bs = toScreen(B.x, B.y);
    const i = nearestGatherable(g, visit, B.x, B.y, taken);
    const ts = i >= 0 ? toScreen(g.plants[i].x, g.plants[i].y) : null;
    const gs = goat ? toScreen(goat.x, goat.y) : null;
    const lms = g.plants.map((p, k) => (SPECIES[p.s].landmark && !taken[k] ? { s: p.s, ...toScreen(p.x, p.y), fits: fits(g, p, visit.mass) } : null)).filter(Boolean);
    const fs = g.finds.map((f, k) => (found.has(k) ? null : { k: f.k, ...toScreen(f.x, f.y) })).filter(Boolean);
    return {
      mode: mode.id, bx: bs.x, by: bs.y, tx: ts && ts.x, ty: ts && ts.y, got: visit.got.length, total: g.plants.length, eaten: eatenN, done: isDone(g, visit, eatenN), ended,
      z: cam.z, r: basketRadius(g, visit.mass), level: levelInfo(g, visit.mass).level, units: visit.got.reduce((s, k) => s + unitsOf(g.plants[k]), 0),
      clock: clock.on ? { started: clock.started, t: clock.t, secs: clock.secs } : null, homing: !!homing,
      goat: goat ? { x: gs.x, y: gs.y, state: goat.state, eaten: goat.eaten, startled: goat.startled } : null,
      landmarks: lms, landmarksGot, finds: fs, effects: { brim: time < effects.brim, breeze: time < effects.breeze },
      combo: combo ? combo.n : 0, comboBest, toast: el.toast.classList.contains('show') ? el.toast.textContent : '', goal: { ...goal, have: goalHave, met: goalMet },
      scroll: Math.max(window.scrollY, document.scrollingElement.scrollTop, document.body.scrollTop), running,
    };
  },
};

renderChoose();
