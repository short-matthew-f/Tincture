// Tincture — test/update-flow.e2e.mjs
// Playwright check of the update flow (ARCHITECTURE.md "PWA and updates"):
//
//   1. serve the repo at its current version; the app installs its service worker;
//      Settings > "Check for updates" says "Up to date";
//   2. copy the repo to a temp dir and bump it to the next patch version
//      there; the same origin now serves the copy;
//   3. "Check for updates" finds it: the Settings row shows "Update ready"
//      with a Restart button;
//   4. Restart reloads the page on the new version (window.tincture.version, the
//      Settings label and the worker's cache name).
//
// The server is a tiny Node static server whose root can be swapped, and it
// sends GitHub Pages' headers (Cache-Control: max-age=600 plus ETag and
// Last-Modified), so a worker that trusted the HTTP cache would boot stale
// files after Restart. NOT part of `npm test`; `npm run e2e` runs it. If
// Playwright cannot be resolved the test prints SKIP and exits 0.

import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const FROM = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
const TO = FROM.replace(/(\d+)$/, (m) => String(Number(m) + 1)); // next patch version

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

const pw = await loadPlaywright();
if (!pw) {
  console.log('SKIP update-flow.e2e: the playwright package is not resolvable here.');
  process.exit(0);
}

// ------------------------------------------------------------------ the copy
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tincture-update-'));
const COPY = path.join(TMP, 'repo');
fs.cpSync(ROOT, COPY, {
  recursive: true,
  filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(path.relative(ROOT, src) ? '/' + path.relative(ROOT, src) : ''),
});
execFileSync(process.execPath, [path.join(COPY, 'tools/bump-version.js'), TO], { cwd: COPY, stdio: 'ignore' });

// ------------------------------------------------------------------ the server
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
let docRoot = ROOT;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(docRoot, path.normalize(rel));
  if (!file.startsWith(docRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const body = fs.readFileSync(file);
  const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
  const headers = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'max-age=600', // what GitHub Pages sends
    ETag: etag,
    'Last-Modified': fs.statSync(file).mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, headers);
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://localhost:${server.address().port}/`;

let browser;
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
  return ok;
};
const must = (ok, label) => { if (!check(ok, label)) throw new Error('stopped at: ' + label); };

try {
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) || /net::ERR_FAILED/.test(m.text())) return;
    errors.push('console.error: ' + m.text() + (url ? ` (${url})` : ''));
  });

  const booted = () => page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 10000 });
  const line = () => page.locator('#screen-settings [data-update-line]').textContent();
  async function openSettings() {
    await page.evaluate(() => window.tincture.ctx.navigate('settings'));
    await page.waitForSelector('#screen-settings [data-update-line]', { state: 'visible', timeout: 5000 });
  }

  // ---------------------------------------------------------------- 0.1.0 installs
  await page.goto(URL_, { waitUntil: 'load' });
  await booted();
  must(await page.evaluate(() => window.tincture.version) === FROM, `the app boots at ${FROM}`);
  const active = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
    return !!(reg && reg.active);
  });
  must(active, 'the service worker activates');
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'load' });
    await booted();
  }
  must(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the page is controlled by the worker');
  await page.waitForTimeout(800); // let the precache settle

  await openSettings();
  await page.click('#screen-settings [data-action="check-update"]');
  await page.waitForFunction(() => /Up to date/.test(document.querySelector('#screen-settings [data-update-line]').textContent), null, { timeout: 10000 })
    .catch(() => {});
  check(/Up to date/.test(await line()), `Check for updates at ${FROM} says "Up to date" (${(await line()).trim()})`);
  check(await page.locator('#screen-settings [data-action="apply-update"]').count() === 0, 'no Restart button while up to date');

  // ---------------------------------------------------------------- 0.1.1 is published
  docRoot = COPY;
  await page.click('#screen-settings [data-action="check-update"]');
  await page.waitForSelector('#screen-settings [data-action="apply-update"]', { state: 'visible', timeout: 15000 }).catch(() => {});
  check(/Update ready/.test(await line()), `after the bump the row says "Update ready" (${(await line()).trim()})`);
  must(await page.locator('#screen-settings [data-action="apply-update"]').isVisible(), 'the Settings row shows a Restart button');
  check(await page.evaluate(() => window.tincture.version) === FROM, `nothing reloads by itself: still ${FROM} until Restart`);
  await page.screenshot({ path: path.join(TMP, 'update-ready.png') });

  // ---------------------------------------------------------------- Restart
  const reloaded = page.waitForEvent('load', { timeout: 15000 });
  await page.click('#screen-settings [data-action="apply-update"]');
  await reloaded;
  await booted();
  check(await page.evaluate(() => window.tincture.version) === TO, `Restart reloads the page at ${TO} (window.tincture.version)`);
  const mod = await page.evaluate(() => import('./src/version.js').then((m) => m.APP_VERSION));
  check(mod === TO, `src/version.js APP_VERSION is ${TO} (${mod})`);
  await openSettings();
  check(await page.locator('#screen-settings .label', { hasText: `Version ${TO}` }).count() > 0, `Settings shows "Version ${TO}"`);
  const caches = await page.evaluate(() => caches.keys());
  check(caches.includes('tincture-v' + TO) && !caches.includes('tincture-v' + FROM), `the worker's cache is tincture-v${TO} only (${caches.join(', ')})`);
  await page.click('#screen-settings [data-action="check-update"]');
  await page.waitForFunction(() => /Up to date/.test(document.querySelector('#screen-settings [data-update-line]').textContent), null, { timeout: 10000 })
    .catch(() => {});
  check(/Up to date/.test(await line()), `at ${TO} Check for updates says "Up to date" again`);
  check(errors.length === 0, 'no console errors' + (errors.length ? '\n     ' + errors.join('\n     ') : ''));
  await context.close();
} catch (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nupdate-flow.e2e passed');
process.exit(failures ? 1 : 0);
