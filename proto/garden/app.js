// The Dye Garden: canvas, input, animation and UI. Rules live in rules.js (pure).
import {
  PLACES, PLACE_BY_ID, SPECIES, DYES, R0, OPENING, JAR, generate, newVisit, gather, isDone, restoreVisit,
  basketRadius, fits, over, buildGrid, queryGrid, nearestGatherable, nextUp, tally, placeDyes, jarsLabel, pickFact, unitsOf,
  mulberry32,
} from './rules.js';
import { plantSprite, basketSprite, decorSprite, GROUNDS } from './sprites.js';

const KEY = 'tincture.proto.garden';
const $ = (s) => document.querySelector(s);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOW = [
  'Drag anywhere on the garden to steer your basket. It glides after your finger.',
  'Roll over plants that fit in the basket to gather them. Each one makes the basket grow, so bigger plants fit next; the chip at the top shows what comes next.',
  'Head home whenever you like. Everything you gathered comes home as jars of dye.',
];

// ---------- storage (prototype only; never the game save) ----------
function loadStore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && o.v === 1) return { v: 1, sound: !!o.sound, shelf: o.shelf || {}, visits: o.visits | 0, seenHelp: !!o.seenHelp, cur: o.cur || null };
  } catch { /* storage may be blocked */ }
  return { v: 1, sound: false, shelf: {}, visits: 0, seenHelp: false, cur: null };
}
const store = loadStore();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage may be blocked */ }
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
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'place'; b.dataset.place = p.id;
    const dyes = placeDyes(p.id).map((d) => `<span><i style="--c:${DYES[d].hex}"></i>${DYES[d].name}</span>`).join('');
    b.innerHTML = `<canvas aria-hidden="true"></canvas><div class="t"><h2>${p.name}</h2><p>${p.blurb}</p><div class="dyes">${dyes}</div></div>`;
    b.addEventListener('click', () => startVisit(p.id, freshSeed()));
    places.appendChild(b);
    requestAnimationFrame(() => placeStrip(b.querySelector('canvas'), p));
  }
  const cont = $('#continue');
  const cur = store.cur;
  cont.hidden = !(cur && PLACE_BY_ID[cur.place]);
  if (!cont.hidden) cont.textContent = `Keep gathering in ${PLACE_BY_ID[cur.place].name}`;
  const shelf = Object.entries(store.shelf).filter(([d, u]) => DYES[d] && u > 0).sort((a, b) => b[1] - a[1]);
  $('#shelf').hidden = !shelf.length;
  $('#shelfList').innerHTML = shelf.map(([d, u]) => `<li><span class="jarbox"><span class="jar" style="--c:${DYES[d].hex};--f:100%"><i></i></span></span>${DYES[d].name} <span class="muted">${jarsLabel(u)}</span></li>`).join('');
  $('#shelfNote').textContent = store.visits ? `From ${store.visits} visit${store.visits === 1 ? '' : 's'}. Dye jars keep forever here.` : '';
}
$('#howList').innerHTML = HOW.map((t) => `<li>${t}</li>`).join('');
$('#helpList').innerHTML = HOW.map((t) => `<li>${t}</li>`).join('');
$('#continue').addEventListener('click', () => { const c = store.cur; if (c) startVisit(c.place, c.seed, c); });
let seedBump = 0;
const freshSeed = () => ((Date.now() ^ (Math.random() * 4294967296)) + ++seedBump) >>> 0 || 1;

// ---------- the visit ----------
const cv = $('#cv');
const ctx = cv.getContext('2d', { alpha: false });
let g = null, visit = null, taken = null, grid = null, place = null, gr = null;
let vw = 0, vh = 0, dpr = 1, vf = 1, Z0 = 3.4;
const B = { x: 0, y: 0, vx: 0, vy: 0, r: R0, squash: 0 };
const cam = { x: 0, y: 0, z: 3.4 };
let drag = null, keys = new Set(), auto = null; // auto: a test-only autopilot (Playwright perf runs)
let falling = [], recent = [];
let time = 0, lastGather = 0, lastVisibleFit = 0, hint = -1, hintCheck = 0, shake = 0;
let raf = 0, lastT = 0, running = false, ended = false, endTimer = 0, errs = 0;
let sprites = new Map(), bSprite = null, decor = [], decorSprites = {};
let nextSpecies = null, gladUntil = 0, movedOnce = false, saveDue = 0;
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
  const seen = new Set(g.plants.map((p) => p.s));
  for (const s of seen) for (let v = 0; v < 3; v++) sprites.set(s + v, plantSprite(s, v, SPECIES[s].r * 1.05 * Z0 * dpr));
  bSprite = basketSprite(64 * dpr * vf * 1.4);
  decorSprites = {};
  for (const k of new Set(gr.decor)) decorSprites[k] = decorSprite(k, gr, 8 * Z0 * dpr);
}

function makeDecor() {
  const rnd = mulberry32(g.seed ^ 0xA5A5);
  const n = Math.round((g.W * g.H) / 7000);
  decor = [];
  for (let i = 0; i < n; i++) decor.push({ k: gr.decor[Math.floor(rnd() * gr.decor.length)], x: rnd() * g.W, y: rnd() * g.H, s: 4 + rnd() * 5 });
  decor.sort((a, b) => a.y - b.y);
}

function startVisit(placeId, seed, resume = null) {
  place = PLACE_BY_ID[placeId];
  gr = GROUNDS[place.ground];
  g = generate(placeId, seed);
  visit = resume ? restoreVisit(g, resume.got) : newVisit();
  taken = new Uint8Array(g.plants.length);
  for (const i of visit.got) taken[i] = 1;
  grid = buildGrid(g.plants, g.W, g.H, 64);
  B.x = resume && Number.isFinite(resume.x) ? resume.x : g.start.x;
  B.y = resume && Number.isFinite(resume.y) ? resume.y : g.start.y;
  B.vx = B.vy = 0; B.r = basketRadius(g, visit.mass); B.squash = 0;
  falling = []; recent = visit.got.slice(-8).map((i) => DYES[SPECIES[g.plants[i].s].dye].hex);
  time = 0; lastGather = 0; lastVisibleFit = 0; hint = -1; ended = false; shake = 0; drag = null;
  movedOnce = !!resume;
  clearTimeout(endTimer);
  store.cur = { place: placeId, seed: g.seed, got: visit.got, x: B.x, y: B.y };
  save();

  document.documentElement.classList.add('playing');
  $('#choose').hidden = true; $('#play').hidden = false; $('#end').hidden = true;
  $('#placeName').textContent = place.name;
  $('#coach').classList.toggle('gone', movedOnce);
  resize();
  cam.x = B.x; cam.y = B.y; cam.z = targetZoom();
  buildSprites();
  makeDecor();
  buildJars();
  nextSpecies = null; updateNext(false);
  $('#help').hidden = store.seenHelp;
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
  if (!g || ended) return;
  store.cur = { place: g.place, seed: g.seed, got: visit.got, x: Math.round(B.x), y: Math.round(B.y) };
  save();
}

// ---------- HUD ----------
let jarEls = {};
function buildJars() {
  const box = $('#jars');
  box.innerHTML = '';
  jarEls = {};
  for (const d of placeDyes(g.place)) {
    const el = document.createElement('div');
    el.className = 'jarbox';
    el.innerHTML = `<b></b><span class="jar" style="--c:${DYES[d].hex}"><i></i></span>`;
    box.appendChild(el);
    jarEls[d] = el;
  }
  for (const t of tally(g, visit.got)) setJar(t, false);
  for (const d of Object.keys(jarEls)) if (!visit.got.some((i) => SPECIES[g.plants[i].s].dye === d)) setJar({ dye: d, units: 0 }, false);
}
function setJar(t, pulse) {
  const el = jarEls[t.dye];
  if (!el) return;
  // the first jar fills up; after that the jar stays full and the number counts jars
  const full = Math.floor(t.units / JAR), part = Math.min(1, t.units / JAR);
  el.querySelector('i').style.height = `${Math.round(part * 100)}%`;
  el.querySelector('b').textContent = full ? `${full}` : '';
  el.setAttribute('aria-label', `${DYES[t.dye].name}: ${t.units ? jarsLabel(t.units) : 'empty so far'}`);
  el.title = `${DYES[t.dye].name}: ${t.units ? jarsLabel(t.units) : 'empty so far'}`;
  if (pulse && !reduced()) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
}
function updateNext(celebrate) {
  const nu = nextUp(g, visit);
  const el = $('#next');
  const left = g.plants.length - visit.got.length;
  const prev = nextSpecies;
  nextSpecies = nu ? nu.species : null;
  if (celebrate && prev && prev !== nextSpecies) {
    el.className = 'next glad';
    el.innerHTML = `${miniSprite(prev)}<span>Now in reach: <b>${SPECIES[prev].name}</b></span>`;
    gladUntil = time + 2.4;
    return;
  }
  if (time < gladUntil) return;
  el.className = 'next';
  if (nu) el.innerHTML = `${miniSprite(nu.species)}<span>Soon: <b>${SPECIES[nu.species].name}</b></span><span class="bar" style="--p:${Math.round(nu.progress * 100)}%"><i></i></span>`;
  else el.innerHTML = left ? `<span style="padding-left:6px">Everything fits now. <b>${left}</b> left</span>` : '<span style="padding-left:6px">The basket is full</span>';
}
function miniSprite(s) {
  const sp = sprites.get(s + 0);
  if (!sp) return '';
  // a tiny canvas copy, drawn into an <img> so innerHTML stays simple
  if (!miniSprite.cache) miniSprite.cache = {};
  if (!miniSprite.cache[s]) {
    const c = document.createElement('canvas');
    c.width = c.height = 60;
    c.getContext('2d').drawImage(sp.canvas, 0, 0, 60, 60);
    miniSprite.cache[s] = c.toDataURL();
  }
  return `<img src="${miniSprite.cache[s]}" width="30" height="30" alt="">`;
}

// ---------- input ----------
function toScreen(x, y) { return { x: (x - cam.x) * cam.z + vw / 2, y: (y - cam.y) * cam.z + vh / 2 }; }
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
  if (!movedOnce && Math.hypot(drag.x - drag.ax, drag.y - drag.ay) > 12) { movedOnce = true; $('#coach').classList.add('gone'); }
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('lostpointercapture', endDrag);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (!running || !e.key.startsWith('Arrow')) return;
  keys.add(e.key); e.preventDefault();
  if (!movedOnce) { movedOnce = true; $('#coach').classList.add('gone'); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => { keys.clear(); drag = null; });

// ---------- sound (off by default; never before a gesture) ----------
let actx = null, lastPluck = 0, noteIx = 0;
function ensureAudio() {
  if (!store.sound) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
const PENTA = [0, 2, 4, 7, 9, 12, 14];
function pluck(r, grand) {
  if (!store.sound || !actx || actx.state !== 'running') return;
  const now = actx.currentTime;
  if (now - lastPluck < 0.045) return;
  lastPluck = now;
  const base = 440 * Math.pow(8 / r, 0.3);
  const notes = grand ? [0, 7, 12] : [PENTA[noteIx++ % PENTA.length]];
  notes.forEach((n, k) => {
    const t0 = now + k * 0.09;
    const o = actx.createOscillator(), gn = actx.createGain(), f = actx.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.value = base * Math.pow(2, n / 12);
    f.type = 'lowpass'; f.frequency.value = 1800;
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(0.12, t0 + 0.006);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + (grand ? 0.9 : 0.32));
    o.connect(f); f.connect(gn); gn.connect(actx.destination);
    o.start(t0); o.stop(t0 + 1);
  });
}
function renderSound() {
  const b = $('#sound');
  b.setAttribute('aria-pressed', String(store.sound));
  b.textContent = store.sound ? '\u266A On' : '\u266A Off';
  b.setAttribute('aria-label', store.sound ? 'Sound is on' : 'Sound is off');
}
$('#sound').addEventListener('click', () => {
  store.sound = !store.sound; save(); renderSound();
  if (store.sound) { ensureAudio(); pluck(10, false); }
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
    draw();
  } catch (err) {
    errs++;
    console.error('garden frame', err);
    if (errs > 30) { stop(); $('#coach').textContent = 'The garden needs a moment. Tap Head home to keep your jars.'; $('#coach').classList.remove('gone'); }
  }
  frameWork.push(performance.now() - t0); if (frameWork.length > 1200) frameWork.shift();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stop(); persistCur(); drag = null; }
  else if (g && !$('#play').hidden && !ended) start();
});
window.addEventListener('pagehide', persistCur);

const targetZoom = () => Z0 * Math.pow(R0 / basketRadius(g, visit.mass), 0.6);

function step(dt) {
  time += dt;
  // steering
  const vmax = 300 / cam.z;
  let dx = 0, dy = 0, k = 0;
  if (drag) {
    let ox, oy;
    if (drag.carry) { const bs = toScreen(B.x, B.y); ox = drag.x - bs.x; oy = drag.y - bs.y; }
    else {
      ox = drag.x - drag.ax; oy = drag.y - drag.ay;
      const d = Math.hypot(ox, oy);
      if (d > 84) { drag.ax = drag.x - (ox / d) * 84; drag.ay = drag.y - (oy / d) * 84; ox = (ox / d) * 84; oy = (oy / d) * 84; }
    }
    const d = Math.hypot(ox, oy);
    if (d > 3) { dx = ox / d; dy = oy / d; k = Math.min(1, (d - 3) / (drag.carry ? 70 : 56)); }
  } else if (auto) {
    if (time > auto.next || auto.i < 0 || taken[auto.i]) { auto.i = nearestGatherable(g, visit, B.x, B.y, takenSet()); auto.next = time + 0.25; }
    if (auto.i >= 0) { const p = g.plants[auto.i]; const ox = p.x - B.x, oy = p.y - B.y, d = Math.hypot(ox, oy) || 1; dx = ox / d; dy = oy / d; k = Math.min(1, d * cam.z / 40); }
  } else if (keys.size) {
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

  // gathering: anything that fits and sits over the opening tips in
  if (!ended) {
    const near = queryGrid(grid, B.x - br - grid.cell, B.y - br - grid.cell, B.x + br + grid.cell, B.y + br + grid.cell, step.buf || (step.buf = []));
    for (let n = 0; n < near.length; n++) {
      const i = near[n];
      if (taken[i]) continue;
      const p = g.plants[i];
      if (fits(g, p, visit.mass) && over(B.x, B.y, basketRadius(g, visit.mass), p)) onGather(i);
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
  cam.x = g.W > 2 * hw - 120 ? Math.max(hw - 60, Math.min(g.W - hw + 60, cam.x)) : g.W / 2;
  cam.y = g.H > 2 * hh - 160 ? Math.max(hh - 70, Math.min(g.H - hh + 90, cam.y)) : g.H / 2;
  shake = Math.max(0, shake - dt);

  for (const f of falling) f.t += dt;
  if (falling.length && falling[0].t > 0.6) falling = falling.filter((f) => f.t < 0.6);

  // hints: a soft glow on the nearest plant that fits, after a quiet spell
  if (time > hintCheck) {
    hintCheck = time + 0.5;
    const quiet = time - Math.max(lastGather, 0) > 5 || time - lastVisibleFit > 2.5;
    hint = quiet && !ended ? nearestGatherable(g, visit, B.x, B.y, takenSet()) : -1;
  }
  if (time > saveDue && saveDue) { saveDue = 0; persistCur(); }
  if (gladUntil && time > gladUntil) { gladUntil = 0; updateNext(false); }
}
let takenCache = null, takenN = -1;
function takenSet() {
  if (takenN !== visit.got.length) { takenCache = new Set(visit.got); takenN = visit.got.length; }
  return takenCache;
}

function onGather(i) {
  const p = g.plants[i];
  const before = visit.got.length;
  visit = gather(g, visit, i);
  if (visit.got.length === before) return;
  taken[i] = 1;
  falling.push({ i, t: 0, x: p.x, y: p.y, dir: p.x < B.x ? -1 : 1 });
  lastGather = time; hint = -1;
  const sp = SPECIES[p.s];
  recent.push(DYES[sp.dye].hex); if (recent.length > 8) recent.shift();
  B.squash = 1;
  if (sp.grand && !reduced()) shake = 0.35;
  pluck(p.r, sp.grand);
  const t = tally(g, visit.got).find((x) => x.dye === sp.dye);
  setJar(t, true);
  updateNext(true);
  if (!saveDue) saveDue = time + 1.5;
  if (isDone(g, visit)) { ended = true; endTimer = setTimeout(() => showEnd(true), reduced() ? 300 : 900); }
}

// ---------- drawing ----------
function lowerBound(arr, y) { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].y < y) lo = mid + 1; else hi = mid; } return lo; }
const drawList = [], lateList = [];

function draw() {
  const z = cam.z;
  let sx = 0, sy = 0;
  if (shake > 0) { const a = shake / 0.35 * 3; sx = Math.sin(time * 70) * a; sy = Math.cos(time * 53) * a; }
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
  for (let i = lowerBound(decor, y0 - 10); i < decor.length && decor[i].y < y1 + 10; i++) {
    const d = decor[i];
    if (d.x < x0 - 10 || d.x > x1 + 10) continue;
    ctx.drawImage(decorSprites[d.k], d.x - d.s, d.y - d.s, d.s * 2, d.s * 2);
  }

  // plants: those that fit, then the basket, then the ones still too big (the basket slides under them)
  const lim = OPENING * basketRadius(g, visit.mass);
  const pad = grid.maxR * 1.4;
  drawList.length = 0; lateList.length = 0;
  let visibleFit = false;
  for (let i = lowerBound(g.plants, y0 - pad); i < g.plants.length; i++) {
    const p = g.plants[i];
    if (p.y > y1 + pad) break;
    if (taken[i] || p.x < x0 - pad || p.x > x1 + pad) continue;
    if (p.r <= lim) { drawList.push(i); if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) visibleFit = true; } else lateList.push(i);
  }
  if (visibleFit) lastVisibleFit = time;
  for (const i of drawList) drawPlant(g.plants[i], 1, 1);
  drawBasket();
  for (const f of falling) drawFalling(f);
  for (const i of lateList) {
    const p = g.plants[i];
    const ov = Math.hypot(p.x - B.x, p.y - B.y) < p.r + B.r;
    drawPlant(p, ov ? 0.55 : 1, 1);
  }

  // hint glow and an edge arrow when the plant is off screen
  if (hint >= 0 && !taken[hint]) {
    const p = g.plants[hint];
    const pulse = reduced() ? 0.6 : 0.5 + 0.5 * Math.sin(time * 4);
    const onScreen = p.x > x0 && p.x < x1 && p.y > y0 + 60 / z && p.y < y1 - 70 / z;
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

function drawPlant(p, alpha, scale) {
  const sp = sprites.get(p.s + p.v);
  const h = p.r * sp.half * scale;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(sp.canvas, p.x - h, p.y - h, h * 2, h * 2);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function drawBasket() {
  const sq = reduced() ? 0 : Math.sin(B.squash * Math.PI) * 0.07;
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
  const D = reduced() ? 0.18 : 0.42;
  const u = Math.min(1, f.t / D);
  if (u >= 1) return;
  const sp = sprites.get(p.s + p.v);
  let x = p.x, y = p.y, sc = 1, rot = 0, a = 1;
  if (reduced()) { sc = 1 - 0.3 * u; a = 1 - u; }
  else {
    const e = u * u;
    x = p.x + (B.x - p.x) * e; y = p.y + (B.y - p.y) * e - Math.sin(u * Math.PI) * p.r * 0.7;
    sc = 1 - 0.7 * e; rot = f.dir * u * 1.3; a = u > 0.8 ? (1 - u) / 0.2 : 1;
  }
  const h = p.r * sp.half * sc;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x, y); if (rot) ctx.rotate(rot);
  ctx.drawImage(sp.canvas, -h, -h, h * 2, h * 2);
  ctx.restore();
}

function drawArrow(p, pulse) {
  const sp = toScreen(p.x, p.y);
  const cx = vw / 2, cy = vh / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const top = 110, bot = 96, side = 30;
  // clamp to the visible play area (below the top HUD, above the jars)
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
function showEnd(complete) {
  ended = true;
  clearTimeout(endTimer);
  drag = null;
  const haul = tally(g, visit.got);
  for (const t of haul) store.shelf[t.dye] = (store.shelf[t.dye] || 0) + t.units;
  const fact = pickFact(g, visit.got, store.visits);
  store.visits++;
  store.cur = null;
  save();
  $('#endTitle').textContent = complete ? `You gathered all of ${place.name.replace(/^The /, 'the ')}` : `Home from ${place.name.replace(/^The /, 'the ')}`;
  const n = visit.got.length;
  $('#endSub').textContent = n ? `${n} plant${n === 1 ? '' : 's'} in the basket. Here are your jars:` : 'A quiet stroll today. The plants will be here next time.';
  $('#haul').innerHTML = haul.map((t) => `<li><span class="jarbox"><span class="jar" style="--c:${t.hex};--f:100%"><i></i></span></span><span class="nm">${t.name}</span><em>${jarsLabel(t.units)}</em></li>`).join('');
  $('#haul').hidden = !haul.length;
  $('#fact').innerHTML = `<small>From the dye notebook</small>${fact.text}`;
  $('#end').hidden = false;
  stop();
  draw();
  $('#again').focus({ preventScroll: true });
}
$('#home').addEventListener('click', () => { if (!ended) showEnd(false); else if ($('#end').hidden) showEnd(isDone(g, visit)); });
$('#again').addEventListener('click', () => startVisit(g.place, freshSeed()));
$('#another').addEventListener('click', () => { g = null; leaveToChoose(); });
$('#leave').addEventListener('click', () => { if (ended) g = null; leaveToChoose(); });
$('#helpBtn').addEventListener('click', () => { $('#help').hidden = false; $('#helpOk').focus(); });
$('#helpOk').addEventListener('click', () => { $('#help').hidden = true; });

// ---------- test hooks (read-only views for the Playwright check) ----------
window.__garden = {
  stats() {
    const d = [...frameDt].sort((a, b) => a - b), w = [...frameWork].sort((a, b) => a - b);
    const q = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0);
    return { dpr, frames: d.length, p50: q(d, 0.5), p95: q(d, 0.95), p99: q(d, 0.99), max: q(d, 1), over20: d.filter((x) => x > 20).length, work50: q(w, 0.5), work95: q(w, 0.95), workMax: q(w, 1) };
  },
  autopilot(on) { auto = on ? { i: -1, next: 0 } : null; },
  resetStats() { frameDt.length = 0; frameWork.length = 0; },
  debug() {
    if (!g) return null;
    const bs = toScreen(B.x, B.y);
    const i = nearestGatherable(g, visit, B.x, B.y, takenSet());
    const ts = i >= 0 ? toScreen(g.plants[i].x, g.plants[i].y) : null;
    return { bx: bs.x, by: bs.y, tx: ts && ts.x, ty: ts && ts.y, got: visit.got.length, total: g.plants.length, done: isDone(g, visit), ended, z: cam.z, r: basketRadius(g, visit.mass), units: visit.got.reduce((s, k) => s + unitsOf(g.plants[k]), 0), scroll: Math.max(window.scrollY, document.scrollingElement.scrollTop, document.body.scrollTop) };
  },
};

renderChoose();
