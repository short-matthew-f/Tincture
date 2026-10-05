// Tincture — test/shell.e2e.mjs
// Playwright smoke test for the app shell. NOT part of `npm test` (the unit
// glob only matches *.test.js). Run it by hand:
//
//   node test/shell.e2e.mjs
//
// It starts `python3 -m http.server 8011` in the repo root, opens the page in
// Chromium, and checks: no console errors or page errors on load, the manifest
// and sw.js are fetchable, the screen sections exist, and #tabbar has 5
// buttons. Then the v0.2 shell rules (PLAN-v0.2 "New items", Theme D):
//  - ctx.fx carries the motion vocabulary (window.tincture.ctx.fx.drag) and
//    ctx.guide the coach mechanism;
//  - toast discipline: one toast at a time, news collapses into one slip, a
//    toast never carries across a navigation, and no toast sits over the
//    visible screen's head (workshop, orders, an overlay, settings);
//  - tab highlight by home tab: Catalog -> Settings lights the Workshop;
//  - guide(): the bubble never intersects its anchor, no toast is visible
//    while it is up, "Got it" only on the information step, the action step
//    ends on the action, seen persists in state.onboarding.seen, replay()
//    runs it again.
// Playwright is a dev-only tool, never a dependency of the game: if it
// cannot be resolved the test prints a SKIP line and exits 0.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8011;
const URL_ = `http://localhost:${PORT}/`;
const CHROMIUM = '/opt/pw-browsers/chromium';

const SCREENS = ['workshop', 'orders', 'puzzles', 'map', 'catalog', 'ledger', 'album', 'quests', 'gallery',
  'shelf', 'settings', 'grading', 'purify', 'packing', 'matching', 'bench', 'paint', 'hunter', 'commissions',
  'heritage', 'naming', 'phase-beat', 'onboarding'];

async function loadPlaywright() {
  const unwrap = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  try {
    const pw = unwrap(await import('playwright'));
    if (pw) return pw;
  } catch (e) { /* fall through */ }
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch (e) { /* ignore */ }
  roots.push('/opt/node-tools/node_modules', '/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules');
  for (const r of roots) {
    const entry = path.join(r, 'playwright', 'index.js');
    if (fs.existsSync(entry)) {
      const pw = unwrap(await import(pathToFileURL(entry).href));
      if (pw) return pw;
    }
  }
  return null;
}

async function waitForServer(url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('http.server did not start on port ' + PORT);
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('SKIP shell.e2e: the playwright package is not resolvable here.');
  process.exit(0);
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let browser;
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

try {
  await waitForServer(URL_);
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // Google Fonts are optional by design; block them so the run is offline-safe
  // and their failure is not counted as an app error.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '') || /ERR_FAILED/.test(m.text())) return;
    errors.push('console.error: ' + m.text() + ' (' + (m.location().url || '') + ')');
  });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  check(errors.length === 0, 'no console errors on load' + (errors.length ? '\n     ' + errors.join('\n     ') : ''));

  const manifest = await page.request.get(URL_ + 'manifest.webmanifest');
  check(manifest.ok(), 'manifest.webmanifest is fetchable');
  const mj = manifest.ok() ? await manifest.json() : {};
  check(mj.name === 'Tincture' && Array.isArray(mj.icons) && mj.icons.length >= 3, 'manifest has a name and icons');
  for (const icon of (mj.icons || [])) {
    const r = await page.request.get(URL_ + icon.src);
    check(r.ok(), `manifest icon ${icon.src} is fetchable`);
  }

  const sw = await page.request.get(URL_ + 'sw.js');
  check(sw.ok() && /CACHE_VERSION/.test(await sw.text()), 'sw.js is fetchable');

  const ver = await page.request.get(URL_ + 'version.json');
  const vj = ver.ok() ? await ver.json() : {};
  check(typeof vj.version === 'string', 'version.json has a version');

  const tabs = await page.locator('#tabbar button').count();
  check(tabs === 5, `#tabbar has 5 buttons (found ${tabs})`);

  const sections = await page.locator('#app > section[data-screen]').evaluateAll((els) => els.map((e) => e.dataset.screen));
  check(SCREENS.every((s) => sections.includes(s)), `all ${SCREENS.length} screen sections exist`);

  for (const id of ['toasts', 'modal', 'fx-layer']) {
    check((await page.locator('#' + id).count()) === 1, `#${id} exists`);
  }
  check(await page.evaluate(() => document.documentElement.dataset.motion === 'system'), 'html[data-motion] defaults to "system"');

  // ---- v0.2: ctx.fx and ctx.guide -------------------------------------------
  const api = await page.evaluate(() => {
    const c = window.tincture.ctx;
    return {
      fx: ['drag', 'spring', 'lift', 'settle', 'coinArc', 'stamp', 'pour', 'rollNumber', 'flyTo'].filter((k) => typeof c.fx[k] !== 'function'),
      guide: typeof c.guide === 'function' && ['whatsNext', 'howThisWorks', 'howThisWorksHtml', 'replay', 'isUp'].every((k) => typeof c.guide[k] === 'function'),
    };
  });
  check(api.fx.length === 0, 'window.tincture.ctx.fx has drag, spring, lift, settle, coinArc, stamp, pour' + (api.fx.length ? ` (missing ${api.fx})` : ''));
  check(api.guide, 'ctx.guide(id, steps) with whatsNext, howThisWorks, replay, isUp');

  // Past the welcome card, onto the Workshop.
  if (await page.locator('[data-action="welcome-skip"]').isVisible().catch(() => false)) {
    await page.click('[data-action="welcome-skip"]');
  }
  await page.evaluate(() => window.tincture.ctx.navigate('workshop'));
  await page.waitForTimeout(300);

  // ---- toast discipline ------------------------------------------------------
  const T = (fn, arg) => page.evaluate(fn, arg);
  const visibleToasts = () => T(() => [...document.querySelectorAll('#toasts .toast:not(.is-leaving)')].map((t) => t.textContent.trim()));
  await T(() => { const c = window.tincture.ctx; c.toast('First feedback'); c.toast('Second feedback'); });
  await page.waitForTimeout(80);
  let vis = await visibleToasts();
  check(vis.length === 1 && /Second feedback/.test(vis[0]), `one toast at a time: the newer feedback replaces the older (${JSON.stringify(vis)})`);
  await T(() => { window.tincture.ctx.overlay.clearToasts(); });
  await page.waitForTimeout(250);
  await T(() => { const o = window.tincture.ctx.overlay; o.toast('A quest is ready', { kind: 'info' }); o.toast('A postcard: Lighthouse', { kind: 'info' }); });
  await page.waitForTimeout(80);
  vis = await visibleToasts();
  check(vis.length === 1 && /quest/.test(vis[0]) && /postcard/i.test(vis[0]), `news collapses into one slip (${JSON.stringify(vis)})`);
  await T(() => window.tincture.ctx.navigate('orders'));
  await page.waitForTimeout(260);
  vis = await visibleToasts();
  check(vis.length === 0, `a toast never carries across a navigation (${JSON.stringify(vis)})`);
  for (const [id, params] of [['workshop'], ['orders'], ['shelf'], ['quests'], ['settings']]) {
    await T(([x, p]) => window.tincture.ctx.navigate(x, p || {}), [id, params]);
    await page.waitForTimeout(280);
    await T((x) => window.tincture.ctx.toast(`Toast on ${x}`), id);
    await page.waitForTimeout(120);
    const geo = await T(() => {
      const top = document.querySelector('#app > .screen.is-top:not([hidden])');
      const head = top && top.querySelector('.screen-head');
      const t = document.querySelector('#toasts .toast:not(.is-leaving)');
      return { head: head ? head.getBoundingClientRect().bottom : null, toast: t ? t.getBoundingClientRect().top : null, top: top && top.dataset.screen };
    });
    check(geo.toast !== null && (geo.head === null || geo.toast >= geo.head - 0.5),
      `toast sits below the ${geo.top} head (toast top ${geo.toast && geo.toast.toFixed(1)}, head bottom ${geo.head && geo.head.toFixed(1)})`);
  }
  await T(() => window.tincture.ctx.overlay.clearToasts());

  // ---- tab highlight by home tab ---------------------------------------------
  const lit = () => T(() => [...document.querySelectorAll('#tabbar [data-tab][aria-current="page"]')].map((b) => b.dataset.tab));
  await T(() => { window.tincture.ctx.navigate('catalog'); window.tincture.ctx.navigate('settings'); });
  await page.waitForTimeout(200);
  check(JSON.stringify(await lit()) === '["workshop"]', `Catalog -> Settings lights the Workshop tab (${JSON.stringify(await lit())})`);
  await T(() => { window.tincture.ctx.navigate('orders'); window.tincture.ctx.navigate('shelf'); });
  await page.waitForTimeout(200);
  check(JSON.stringify(await lit()) === '["workshop"]', 'Orders -> Shelf lights the Workshop tab');

  // ---- guide() ---------------------------------------------------------------
  await T(() => window.tincture.ctx.navigate('workshop'));
  await page.waitForTimeout(300);
  await T(() => {
    window.__g = window.tincture.ctx.guide('e2e-guide', [
      { anchor: '[data-action="settings"]', text: 'Your settings live behind this gear.' },
      { anchor: '#tabbar [data-tab="catalog"]', text: 'Tap the catalog to see your colors.', endsOn: 'action' },
    ], { screen: 'workshop' });
    window.__g.start();
  });
  await page.waitForTimeout(250);
  const bubble = (sel) => T((anchorSel) => {
    const tag = document.querySelector('#guide-layer .coach-tag');
    const a = document.querySelector(anchorSel);
    if (!tag || !a) return null;
    const r = tag.getBoundingClientRect();
    const q = a.getBoundingClientRect();
    const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
    const hh = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
    return { overlap: w > 0 && hh > 0, gotIt: !!tag.querySelector('[data-coach-action="ok"]'), text: tag.textContent.trim() };
  }, sel);
  let b1 = await bubble('[data-action="settings"]');
  check(!!b1 && !b1.overlap, `the first bubble shows and does not cover its anchor (${JSON.stringify(b1)})`);
  check(!!b1 && b1.gotIt, 'an information step has "Got it"');
  await T(() => window.tincture.ctx.overlay.toast('News while the coach is up', { kind: 'info' }));
  await T(() => window.tincture.ctx.toast('Feedback while the coach is up'));
  await page.waitForTimeout(150);
  vis = await visibleToasts();
  check(vis.length === 0, `no toast is visible while a guide bubble is up (${JSON.stringify(vis)})`);
  await page.click('#guide-layer [data-coach-action="ok"]');
  await page.waitForTimeout(250);
  const b2 = await bubble('#tabbar [data-tab="catalog"]');
  check(!!b2 && !b2.overlap && !b2.gotIt, `the action step shows without "Got it" and clear of its anchor (${JSON.stringify(b2)})`);
  await page.click('#tabbar [data-tab="catalog"]');
  await page.waitForTimeout(300);
  const after = await T(() => ({
    up: window.tincture.ctx.guide.isUp(),
    seen: !!(window.tincture.game.state.onboarding.seen || {})['e2e-guide'],
    active: window.__g.active,
  }));
  check(!after.up && after.seen && !after.active, `the action ends the guide and seen persists (${JSON.stringify(after)})`);
  await page.waitForTimeout(500);
  vis = await visibleToasts();
  check(vis.some((t) => /News while the coach is up/.test(t)), `held news shows once the coach is gone (${JSON.stringify(vis)})`);
  check(await T(() => window.__g.start()) === false, 'a seen guide does not start again');
  await T(() => { window.tincture.ctx.overlay.clearToasts(); window.tincture.ctx.navigate('workshop'); });
  await page.waitForTimeout(250);
  await T(() => {
    const link = window.tincture.ctx.guide.howThisWorks('e2e-guide');
    link.id = 'e2e-how';
    document.querySelector('#app > .screen.is-top .screen-head').appendChild(link);
  });
  await page.click('#e2e-how');
  await page.waitForTimeout(250);
  b1 = await bubble('[data-action="settings"]');
  check(!!b1 && !b1.overlap, '"How this works" replays the guide');
  await T(() => { window.__g.stop(); document.getElementById('e2e-how').remove(); });
  check(!(await T(() => window.tincture.ctx.guide.isUp())), 'stop() takes the bubble away');
  // ---- the new effects run and resolve, in full and reduced motion -----------
  for (const mode of ['full', 'reduced']) {
    const res = await T(async (m) => {
      document.documentElement.dataset.motion = m;
      const fx = window.tincture.ctx.fx;
      const from = document.querySelector('#tabbar [data-tab="orders"]');
      const to = document.querySelector('#tabbar [data-tab="catalog"]');
      const box = document.querySelector('#app > .screen.is-top .screen-head');
      const t0 = performance.now();
      const out = {};
      const time = async (k, p) => { const s = performance.now(); await p; out[k] = Math.round(performance.now() - s); };
      await Promise.all([
        time('spring', fx.spring(box, { from: { transform: 'scale(0.94)' }, to: { transform: 'scale(1)' }, preset: 'heavy' })),
        time('lift+settle', fx.lift(to).then(() => fx.settle(to))),
        time('coinArc', fx.coinArc(from, to, 12, { quiet: true })),
        time('stamp', fx.stamp(box, 'Sold', { hold: 0 })),
      ]);
      out.total = Math.round(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 400));
      out.leftovers = document.querySelectorAll('#fx-layer .fx-coin, #fx-layer .fx-stamp').length;
      document.documentElement.dataset.motion = 'system';
      return out;
    }, mode);
    check(res.total < 1500 && res.leftovers === 0, `fx.spring, lift/settle, coinArc and stamp resolve under 1.5 s and clean up (${mode}: ${JSON.stringify(res)})`);
  }
  check(errors.length === 0, 'no console errors through the shell checks' + (errors.length ? '\n     ' + errors.join('\n     ') : ''));
} catch (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nshell.e2e passed');
process.exit(failures ? 1 : 0);
