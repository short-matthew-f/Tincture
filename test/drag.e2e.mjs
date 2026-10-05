// Tincture — test/drag.e2e.mjs
// Playwright perturbation harness for fx.drag (PLAN-v0.2 Theme B item 8,
// UX-GUIDELINES-REVIEW §C Theme B/F, handbook ch. 08 §7.1). NOT part of
// `npm test`; run it by hand:
//
//   node test/drag.e2e.mjs
//
// It serves the repo with `python3 -m http.server` and, on the same origin,
// a generated scratch page (page.route, nothing is written to disk): a 6x6
// board with 6 px gaps between columns and a 20 px plank between rows, every
// cell holding a vial, wired with the real src/ui/fx.js `drag` in handle mode.
// With touch emulation (hasTouch + isMobile) at the iPhone 14 viewport and at
// 375x667 it performs 200 drags per viewport through real touch input (CDP
// Input.dispatchTouchEvent, so touch-action and pointer capture are real):
//  - release points at random offsets up to half a cell from cell centres,
//    plus gap and plank midpoints; >= 99% must resolve to the intended cell or
//    the geometrically nearest one (half the drags rest 110 ms before release,
//    half aim through the cell first and release at once);
//  - the drop always equals the last highlighted target (what she sees is
//    what she drops on);
//  - the ghost never covers the finger point, its base sits 12 px above the
//    finger with no positional lag, and its tilt stays within 6 degrees;
//  - touchcancel (pointercancel, the iOS edge swipe) removes the ghost,
//    restores the source and never drops;
//  - a legal partner within 24 px wins over the empty under the hotspot;
//  - touch-action: none is on the draggable cells only, not on the board.
// If Playwright cannot be resolved the test prints SKIP and exits 0.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const DRAGS = 200;
const OFFSET_Y = 12;

async function loadPlaywright() {
  const unwrap = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  try {
    const pw = unwrap(await import('playwright'));
    if (pw) return pw;
  } catch (e) { /* fall through */ }
  const roots = ['/opt/node-tools/node_modules'];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch (e) { /* ignore */ }
  roots.push('/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules');
  for (const r of roots) {
    const entry = path.join(r, 'playwright', 'index.js');
    if (fs.existsSync(entry)) {
      const pw = unwrap(await import(pathToFileURL(entry).href));
      if (pw) return pw;
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitForServer(url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('http.server did not start: ' + url);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Seeded PRNG so a failure reproduces.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIAL = '<svg viewBox="0 0 30 44" aria-hidden="true"><rect x="5" y="2" width="20" height="40" rx="7" fill="#F2F4F0" stroke="#2A2622" stroke-width="2"/><rect x="7" y="20" width="16" height="20" rx="5" fill="#B8433A"/></svg>';

const BOARD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="./style.css">
<style>
  html, body { margin: 0; background: #E3E6E0; overflow: hidden; }
  #board { margin: 110px auto 0; width: max-content; background: #7B5236; padding: 10px; border-radius: 14px; }
  .row { display: grid; grid-template-columns: repeat(6, var(--cw)); column-gap: 6px; }
  .plank { height: 20px; background: #8A5F3F; }
  .cell { height: 58px; background: #5E3E28; border-radius: 8px; display: flex; align-items: flex-end; justify-content: center; }
  .cell svg { width: 28px; height: 42px; display: block; }
  .cell.hl { box-shadow: inset 0 0 0 3px #F7F4EC; }
</style></head>
<body><div id="board"></div>
<script type="module">
  import * as fx from './src/ui/fx.js';
  const vw = innerWidth;
  const cw = Math.floor(Math.min(52, (vw - 32 - 20 - 30) / 6));
  document.documentElement.style.setProperty('--cw', cw + 'px');
  const board = document.getElementById('board');
  let html = '';
  for (let r = 0; r < 6; r++) {
    if (r) html += '<div class="plank"></div>';
    html += '<div class="row">';
    for (let c = 0; c < 6; c++) html += '<div class="cell fx-draggable" data-cell="' + (r * 6 + c) + '">' + ${JSON.stringify(VIAL)} + '</div>';
    html += '</div>';
  }
  board.innerHTML = html;
  const cells = [...board.querySelectorAll('.cell')];
  const log = [];
  window.log = log;
  window.fxm = fx;
  const hl = (c) => { cells.forEach((x) => x.classList.remove('hl')); if (c >= 0) cells[c].classList.add('hl'); };
  window.wire = (partners) => {
    if (window.handle) window.handle.destroy();
    const set = new Set(partners || []);
    window.handle = fx.drag(board, {
      handle: '.cell',
      board: () => fx.measureGrid(cells, 6, { pad: 10 }),
      magnet: set.size ? (i) => (set.has(i) ? 1 : 0) : undefined,
      onMove: (c) => { hl(c); log.push(['move', c]); },
      onDrop: (c, info) => { hl(-1); log.push(['drop', c, info.x, info.y]); },
      onCancel: () => log.push(['cancel']),
      onTap: () => log.push(['tap']),
    });
  };
  window.wire();
  window.ready = true;
</script></body></html>`;

const pw = await loadPlaywright();
if (!pw) {
  console.log('SKIP drag.e2e: the playwright package is not resolvable here.');
  process.exit(0);
}

const PORT = await freePort();
const ORIGIN = `http://localhost:${PORT}`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let browser;
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

/** The geometric oracle: cells whose box is nearest to p (several on a midline). */
function nearestSet(rects, p) {
  const d = rects.map((r) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom)));
  const min = Math.min(...d);
  return new Set(d.map((v, i) => (v <= min + 0.75 ? i : -1)).filter((i) => i >= 0));
}

async function runViewport(label, contextOpts, seed) {
  const context = await browser.newContext({ ...contextOpts, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route(`${ORIGIN}/__drag-board.html`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: BOARD_PAGE }));
  await page.goto(`${ORIGIN}/__drag-board.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 8000 });
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });

  const vp = page.viewportSize();
  console.log(`\n${label}: ${vp.width}x${vp.height}`);
  const rects = await page.evaluate(() => [...document.querySelectorAll('.cell')].map((c) => {
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }));
  const centre = (i) => ({ x: (rects[i].left + rects[i].right) / 2, y: (rects[i].top + rects[i].bottom) / 2 });
  const cellW = rects[0].right - rects[0].left;
  const cellH = rects[0].bottom - rects[0].top;
  check(Math.abs(rects[1].left - rects[0].right - 6) < 0.6, `columns have a 6 px gap (${(rects[1].left - rects[0].right).toFixed(1)})`);
  check(Math.abs(rects[6].top - rects[0].bottom - 20) < 0.6, `rows have a 20 px plank (${(rects[6].top - rects[0].bottom).toFixed(1)})`);
  const ta = await page.evaluate(() => ({
    board: getComputedStyle(document.getElementById('board')).touchAction,
    cell: getComputedStyle(document.querySelector('.cell')).touchAction,
    body: getComputedStyle(document.body).touchAction,
  }));
  check(ta.cell === 'none' && ta.board !== 'none' && ta.body !== 'none', `touch-action none on the cells only (cell ${ta.cell}, board ${ta.board}, body ${ta.body})`);

  const ghostRect = () => page.evaluate(() => {
    const g = document.querySelector('#fx-layer .fx-ghost');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const m = /rotate\((-?[\d.]+)deg\)/.exec(g.style.transform || '');
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, tilt: m ? Number(m[1]) : 0, w: g.offsetWidth, h: g.offsetHeight };
  });

  const rnd = rng(seed);
  let good = 0;
  let wysiwyg = 0;
  let covered = 0;
  let lagged = 0;
  let tiltOver = 0;
  const misses = [];
  for (let k = 0; k < DRAGS; k++) {
    const kind = k % 10 === 3 ? 'gap' : k % 10 === 7 ? 'plank' : 'offset';
    let t;
    let hot;
    if (kind === 'gap') {
      const row = Math.floor(rnd() * 6);
      const col = Math.floor(rnd() * 5);
      t = row * 6 + col;
      hot = { x: (rects[t].right + rects[t + 1].left) / 2, y: centre(t).y + (rnd() - 0.5) * cellH * 0.8 };
    } else if (kind === 'plank') {
      const row = Math.floor(rnd() * 5);
      const col = Math.floor(rnd() * 6);
      t = row * 6 + col;
      hot = { x: centre(t).x + (rnd() - 0.5) * cellW * 0.8, y: (rects[t].bottom + rects[t + 6].top) / 2 };
    } else {
      t = Math.floor(rnd() * 36);
      const c = centre(t);
      hot = { x: c.x + (rnd() - 0.5) * cellW, y: c.y + (rnd() - 0.5) * cellH };
    }
    let s = Math.floor(rnd() * 36);
    if (s === t) s = (s + 7) % 36;
    const start = centre(s);
    const finger = { x: hot.x, y: hot.y + OFFSET_Y };
    const aim = k % 2 === 1; // odd: aim through the cell centre, release at once; even: direct path, rest, release
    const via = aim ? { x: centre(t).x, y: centre(t).y + OFFSET_Y } : finger;
    await touch('touchStart', start.x, start.y);
    const steps = 5;
    let mid = null;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const x = start.x + (via.x - start.x) * f + (i < steps ? (rnd() - 0.5) * 6 : 0);
      const y = start.y + (via.y - start.y) * f + (i < steps ? (rnd() - 0.5) * 6 : 0);
      await touch('touchMove', x, y);
      if (i === 3) mid = { x, y, g: await ghostRect() };
    }
    if (aim) await touch('touchMove', finger.x, finger.y);
    else await sleep(110);
    const fin = await ghostRect();
    await touch('touchEnd', 0, 0);
    const log = await page.evaluate(() => window.log.splice(0));
    const drop = log.find((e) => e[0] === 'drop');
    const moves = log.filter((e) => e[0] === 'move');
    const last = moves.length ? moves[moves.length - 1][1] : -1;
    const got = drop ? drop[1] : null;
    const near = nearestSet(rects, hot);
    const ok = got === t || near.has(got);
    if (ok) good++;
    else misses.push({ k, kind, aim, t, got, near: [...near], hot: { x: +hot.x.toFixed(1), y: +hot.y.toFixed(1) } });
    if (drop && got === last) wysiwyg++;
    for (const [p, g] of [[mid, mid && mid.g], [finger, fin]]) {
      if (!p || !g) { covered++; continue; }
      const coversFinger = p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom;
      if (coversFinger || g.bottom >= p.y) covered++;
      // Base centre of the unrotated ghost: x at the finger, y 12 px above it (bbox slack for the tilt).
      const slack = g.h * Math.sin((Math.abs(g.tilt) * Math.PI) / 180) + 1.5;
      if (Math.abs((g.left + g.right) / 2 - p.x) > slack + 1 || Math.abs(g.bottom - (p.y - OFFSET_Y)) > slack + 3) lagged++;
      if (Math.abs(g.tilt) > 6.001) tiltOver++;
    }
  }
  const pct = (good / DRAGS) * 100;
  check(good / DRAGS >= 0.99, `${good}/${DRAGS} drops (${pct.toFixed(1)}%) land on the intended or nearest cell`);
  if (misses.length) console.log('     misses:', JSON.stringify(misses.slice(0, 6)));
  check(wysiwyg === DRAGS, `every drop equals the last highlighted cell (${wysiwyg}/${DRAGS})`);
  check(covered === 0, `the ghost never covers the finger point (${covered} samples did)`);
  check(lagged === 0, `the ghost's base tracks the finger 12 px above it with no lag (${lagged} samples off)`);
  check(tiltOver === 0, 'the tilt never passes 6 degrees');

  // A fast horizontal swipe tilts the ghost, within the cap.
  {
    const a = centre(12);
    await page.evaluate(() => { window.log.length = 0; });
    await touch('touchStart', a.x, a.y);
    let maxTilt = 0;
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', a.x + i * 30, a.y);
      const g = await ghostRect();
      if (g) maxTilt = Math.max(maxTilt, Math.abs(g.tilt));
    }
    await touch('touchCancel', 0, 0);
    await sleep(220);
    check(maxTilt > 0.5 && maxTilt <= 6, `a fast swipe tilts the ghost (max ${maxTilt.toFixed(2)} deg, cap 6)`);
  }

  // pointercancel (iOS edge swipe): the ghost leaves, the source comes back, nothing drops.
  let restored = 0;
  const CANCELS = 5;
  for (let k = 0; k < CANCELS; k++) {
    const s = (k * 7 + 3) % 36;
    const a = centre(s);
    const b = centre((s + 8) % 36);
    await page.evaluate(() => { window.log.length = 0; });
    await touch('touchStart', a.x, a.y);
    for (let i = 1; i <= 4; i++) await touch('touchMove', a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4);
    const during = await page.evaluate((i) => ({
      ghost: !!document.querySelector('#fx-layer .fx-ghost'),
      faded: document.querySelectorAll('.cell')[i].classList.contains('is-drag-source'),
    }), s);
    await touch('touchCancel', 0, 0);
    await sleep(260);
    const after = await page.evaluate((i) => ({
      ghost: !!document.querySelector('#fx-layer .fx-ghost'),
      faded: document.querySelectorAll('.cell')[i].classList.contains('is-drag-source'),
      log: window.log.slice(),
      highlighted: document.querySelectorAll('.cell.hl').length,
    }), s);
    const ok = during.ghost && during.faded && !after.ghost && !after.faded
      && after.log.some((e) => e[0] === 'cancel') && !after.log.some((e) => e[0] === 'drop') && after.highlighted === 0;
    if (ok) restored++;
    else console.log('     cancel', k, JSON.stringify({ during, after }));
  }
  check(restored === CANCELS, `pointercancel restores the source and drops nothing (${restored}/${CANCELS})`);

  // Magnet: a legal partner within 24 px beats the empty under the hotspot.
  {
    const partner = 14;
    await page.evaluate((p) => window.wire([p]), partner);
    const drop = async (hot) => {
      await page.evaluate(() => { window.log.length = 0; });
      const a = centre(0);
      await touch('touchStart', a.x, a.y);
      for (let i = 1; i <= 5; i++) await touch('touchMove', a.x + ((hot.x - a.x) * i) / 5, a.y + ((hot.y + OFFSET_Y - a.y) * i) / 5);
      await touch('touchEnd', 0, 0);
      const log = await page.evaluate(() => window.log.slice());
      const d = log.find((e) => e[0] === 'drop');
      return d ? d[1] : null;
    };
    const y = centre(15).y;
    const near = await drop({ x: rects[14].right + 6 + 10, y }); // inside cell 15, 16 px from cell 14
    const far = await drop({ x: centre(16).x, y });             // well away from 14
    check(near === partner, `the partner 16 px away wins over the empty under the hotspot (dropped on ${near})`);
    check(far === 16, `a partner beyond 24 px never steals the drop (dropped on ${far})`);
    await page.evaluate(() => window.wire());
  }

  // A press without movement is a tap, not a drag.
  {
    await page.evaluate(() => { window.log.length = 0; });
    const a = centre(20);
    await touch('touchStart', a.x, a.y);
    await touch('touchMove', a.x + 4, a.y + 3);
    await touch('touchEnd', 0, 0);
    const log = await page.evaluate(() => window.log.slice());
    check(log.some((e) => e[0] === 'tap') && !log.some((e) => e[0] === 'drop'), 'a press under 8 px is a tap');
  }

  check(errors.length === 0, 'no console errors' + (errors.length ? '\n     ' + errors.join('\n     ') : ''));
  await context.close();
}

try {
  await waitForServer(`${ORIGIN}/index.html`);
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  const iphone = pw.devices && pw.devices['iPhone 14'];
  const iphoneOpts = iphone
    ? { viewport: iphone.viewport, deviceScaleFactor: iphone.deviceScaleFactor, userAgent: iphone.userAgent }
    : { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3 };
  await runViewport('iPhone 14', iphoneOpts, 1405);
  await runViewport('small phone', { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 }, 375);
} catch (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\ndrag.e2e passed');
process.exit(failures ? 1 : 0);
