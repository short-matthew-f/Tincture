// Tincture — test/shell.e2e.mjs
// Playwright smoke test for the app shell. NOT part of `npm test` (the unit
// glob only matches *.test.js). Run it by hand:
//
//   node test/shell.e2e.mjs
//
// It starts `python3 -m http.server 8011` in the repo root, opens the page in
// Chromium, and checks: no console errors or page errors on load, the manifest
// and sw.js are fetchable, the screen sections exist, and #tabbar has 5
// buttons. Playwright is a dev-only tool, never a dependency of the game: if it
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
} catch (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nshell.e2e passed');
process.exit(failures ? 1 : 0);
