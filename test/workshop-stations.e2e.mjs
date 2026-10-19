// Tincture — test/workshop-stations.e2e.mjs
// Playwright check of the 0.3.1 audit fixes at phone width (docs/AUDIT-0.3.1.md). NOT part of
// `npm test`; run with `npm run e2e` or `node test/workshop-stations.e2e.mjs`.
//
// A mid-game workshop (26 colors, Phase 2, shelf, map, Tile Room and Gallery open, three mixers
// working, two event banners earned) at 390 x 844 with touch:
//  - Stations shows "Mixers and their jars" (no separate Vats panel): "Mixer 1 makes X" and
//    "N of M jars", and the scene's glass jar i shows mixer i's color;
//  - tapping a mixer row's words, or its glass in the scene, opens the same "what this is for"
//    note with Change the color; a source row opens its own note;
//  - "Bigger jars" says it means a longer time away, and buying it grows the room;
//  - earned event banners hang in the scene and open a list;
//  - the Close up shop line explains itself; the Seals chip explains Seals and goes to the shop;
//  - Quests and Orders stay still between changes (no rebuild that eats taps);
//  - the Commissions lock on Orders names the Loading Yard and its 50 colors;
//  - no horizontal scroll, no console errors.
// SHOTS=<dir> saves screenshots there. If Playwright cannot be resolved it prints SKIP and exits 0.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.SHOTS || '';

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
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitForServer(url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

let failures = 0;
const must = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const pw = await loadPlaywright();
if (!pw) { console.log('SKIP workshop-stations.e2e: Playwright not found'); process.exit(0); }
const PORT = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let browser;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const sheetText = (page) => page.evaluate(() => [...document.querySelectorAll('.ws-sheet, #modal .sheet')].map((x) => x.innerText).join('\n'));
const closeSheets = (page) => page.evaluate(() => {
  document.querySelectorAll('[data-screen="workshop"] .ws-sheet-wrap').forEach((x) => x.remove());
  window.tincture.ctx.overlay.closeAll();
});

try {
  await waitForServer(`http://localhost:${PORT}/`);
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: CHROMIUM }); }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.tincture && window.tincture.game, null, { timeout: 10000 });

  // A mid-game workshop, set up in one act so no ceremonies queue.
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    const sim = ctx.sim;
    game.act((s, a, t) => {
      s.onboarding.done = true;
      s.onboarding.step = 99;
      const start = ctx.content.CATALOG.filter((c) => c.recipe && c.recipe.every((r) => ['madder', 'ochre', 'woad'].includes(r.pigment))).map((c) => c.id);
      const ids = [...start, ...ctx.content.CATALOG.filter((c) => !start.includes(c.id) && c.era === 1).map((c) => c.id)].slice(0, 26);
      for (const id of ids) sim.discover(s, { colorId: id, method: 'debug' }, t);
      s.coins = 30000;
      if (!s.rooms.includes('mill-room')) s.rooms.push('mill-room');
      s.phase = 2;
      for (const u of ['shelf', 'hunters', 'tiles', 'gallery']) sim.unlocks.buy(s, { id: u }, t);
      while (s.stations.mixers.length < 3) sim.factory.buyMixer(s, {}, t);
      ['marigold', 'ochre', 'olive'].forEach((c, i) => { s.stations.mixers[i].recipe = c; });
      s.stations.vats.forEach((v) => { v.color = null; });
      s.cosmetics = ['bloom-week-banner', 'autumn-harvest-banner'];
      s.coins = 9000;
      s._events = [];
    });
    sim.shiftClock(game.state, 2 * 3600e3);
    game.tick();
    game.state._events = [];
    ctx.navigate('workshop', { panel: 'mixers' });
  });
  await page.waitForTimeout(1200);

  // ---- Part 2: mixers and their jars ----
  const p2 = await page.evaluate(() => {
    const root = document.querySelector('[data-screen="workshop"]');
    const s = window.tincture.game.state;
    const mixers = root.querySelector('[data-pw="mixers"]');
    return {
      title: mixers.querySelector('.ws-panel-head .t').textContent,
      vatsPanel: !!root.querySelector('[data-pw="vats"]'),
      row0: root.querySelector('[data-row="mixer:0"]').innerText,
      jars: !!root.querySelector('[data-row="jars"]'),
      jarsText: root.querySelector('[data-row="jars"]') ? root.querySelector('[data-row="jars"]').innerText : '',
      aligned: s.stations.mixers.every((m, i) => i >= s.stations.vats.length || !m.recipe || s.stations.vats[i].color === m.recipe),
      cap: window.tincture.ctx.sim.storage.capacity(s).total,
    };
  });
  must(p2.title === 'Mixers and their jars' && !p2.vatsPanel, 'Stations shows "Mixers and their jars" and no separate Vats panel');
  must(/Mixer 1 makes Marigold/.test(p2.row0) && /\d+ of [\d.,K]+ jars/.test(p2.row0), `a mixer row names its color and its jar: ${p2.row0.split('\n').slice(0, 2).join(' / ')}`);
  must(p2.aligned, "each scene jar shows its mixer's color");
  must(p2.jars && /longer time away/.test(p2.jarsText), '"Bigger jars" says it means a longer time away');
  await shot(page, 'stations-mixers-and-jars');

  // The row's words open the mixer note.
  await page.locator('[data-screen="workshop"] [data-note="mixer:0"]').tap();
  await page.waitForTimeout(400);
  let t = await sheetText(page);
  must(/pours it into its jar/.test(t) && /Change the color/.test(t) && /of [\d.,K]+ jars/.test(t), 'tapping a mixer opens its "what this is for" note with Change the color');
  await shot(page, 'note-mixer');
  await closeSheets(page);

  // A source row opens its own note.
  await page.evaluate(() => window.tincture.ctx.navigate('workshop', { panel: 'sources' }));
  await page.waitForTimeout(500);
  await page.locator('[data-screen="workshop"] [data-note="source:madder"]').tap();
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/gathers one raw pigment/.test(t) && /Level up/.test(t), 'a source row opens its note with Level up');
  await closeSheets(page);

  // The glass in the scene opens the same mixer note.
  await page.evaluate(() => document.querySelector('[data-screen="workshop"] .screen-body').scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-screen="workshop"] [data-action="vat-color"][data-vat="1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/Mixer 2 makes Ochre/.test(t), "the scene's second jar opens Mixer 2's note");
  await closeSheets(page);

  // Bigger jars: the note, then a purchase that grows the room.
  await page.evaluate(() => window.tincture.ctx.navigate('workshop', { panel: 'vat', index: 0 }));
  await page.waitForTimeout(500);
  await page.locator('[data-screen="workshop"] [data-note="jars"]').tap();
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/longer time away/.test(t) && /Room for/.test(t), 'the Bigger jars note explains the time away');
  await shot(page, 'note-bigger-jars');
  await page.locator('[data-screen="workshop"] .ws-sheet [data-action="buy"]').tap();
  await page.waitForTimeout(400);
  const cap2 = await page.evaluate(() => window.tincture.ctx.sim.storage.capacity(window.tincture.game.state).total);
  must(cap2 > p2.cap, `Bigger jars grows the room (${p2.cap} -> ${cap2})`);
  await closeSheets(page);

  // ---- Event banners in the scene ----
  await page.evaluate(() => document.querySelector('[data-screen="workshop"] .screen-body').scrollTo(0, 0));
  await page.waitForTimeout(300);
  const pen = await page.evaluate(() => {
    const g = document.querySelector('[data-screen="workshop"] [data-pennants]');
    return { on: !!g && !g.classList.contains('ws-off'), flags: g ? g.querySelectorAll('path[fill]').length : 0 };
  });
  must(pen.on && pen.flags >= 2, `earned banners hang in the workshop (${pen.flags} pennants)`);
  await page.evaluate(() => document.querySelector('[data-screen="workshop"] [data-pennants]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/Bloom Week/.test(t) && /Autumn Harvest/.test(t), 'tapping the bunting lists the banners');
  await closeSheets(page);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
  if (SHOTS) await page.locator('[data-screen="workshop"] .ws-scene').screenshot({ path: path.join(SHOTS, 'scene-banners.png') });

  // ---- Close up shop explains itself ----
  await page.evaluate(() => document.querySelector('[data-screen="workshop"] [data-sec="closeup"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const cu = await page.textContent('[data-screen="workshop"] [data-sec="closeup"]');
  must(/hunters head out/.test(cu) && /What does it do/.test(cu), 'Close up shop has a line saying what it is for');
  await page.locator('[data-screen="workshop"] [data-explain="closeup"]').tap();
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/Nothing pauses/.test(t), 'its note says nothing pauses');
  await closeSheets(page);

  // ---- Seals ----
  await page.evaluate(() => window.tincture.ctx.navigate('quests'));
  await page.waitForTimeout(600);
  const churn = await page.evaluate(async () => {
    const body = document.querySelector('[data-screen="quests"] .screen-body');
    let n = 0;
    const mo = new MutationObserver((l) => { for (const m of l) if (m.target === body && m.type === 'childList') n++; });
    mo.observe(body, { childList: true });
    await new Promise((r) => setTimeout(r, 2000));
    mo.disconnect();
    return n;
  });
  must(churn === 0, `Quests stays still between changes (${churn} rebuilds in 2 s)`);
  await page.locator('[data-screen="quests"] [data-seals-chip]').tap();
  await page.waitForTimeout(400);
  t = await sheetText(page);
  must(/What Seals are for/.test(t) && /Seal shop/.test(t), 'the Seals chip explains what Seals are for');
  await shot(page, 'seals-note');
  await page.locator('#modal .sheet [data-overlay-action="0"]').tap();
  await page.waitForTimeout(700);
  const shopTop = await page.evaluate(() => {
    const el = document.querySelector('[data-screen="quests"] [data-section="seal-shop"]');
    const r = el && el.getBoundingClientRect();
    return r ? r.top : 9999;
  });
  must(shopTop < 400, '"Open the Seal shop" lands on the shop');

  // ---- Orders: still, and the Commissions lock names the real goal ----
  await page.evaluate(() => window.tincture.ctx.navigate('orders'));
  await page.waitForTimeout(700);
  const ord = await page.evaluate(async () => {
    const body = document.querySelector('[data-screen="orders"] [data-body]');
    let n = 0;
    const mo = new MutationObserver((l) => { for (const m of l) if (m.target === body && m.type === 'childList') n++; });
    mo.observe(body, { childList: true });
    await new Promise((r) => setTimeout(r, 2000));
    mo.disconnect();
    const lock = document.querySelector('[data-screen="orders"] [data-lock]');
    return { n, lock: lock ? lock.innerText : '' };
  });
  must(ord.n === 0, `Orders stays still between changes (${ord.n} rebuilds in 2 s)`);
  must(/Loading Yard/.test(ord.lock) && /50 colors/.test(ord.lock), `the Commissions lock names the Loading Yard and 50 colors: ${ord.lock.replace(/\s+/g, ' ')}`);

  const hscroll = await page.evaluate(() => [...document.querySelectorAll('[data-screen]')].filter((s) => !s.hidden).some((s) => {
    const b = s.querySelector('.screen-body');
    return document.documentElement.scrollWidth > window.innerWidth || (b && b.scrollWidth > b.clientWidth + 1);
  }));
  must(!hscroll, 'no horizontal scroll at 390 px');
  must(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL', e && e.stack || e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}
if (failures) { console.log(`workshop-stations.e2e: ${failures} failure(s)`); process.exit(1); }
console.log('workshop-stations.e2e: all good');
