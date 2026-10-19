// Tincture — test/commissions.e2e.mjs
// Playwright check of the Commissions screen at phone width (playtest: "she
// really doesn't get the commissions; her blue tints don't qualify"). NOT part
// of `npm test`; run with `npm run e2e` or `node test/commissions.e2e.mjs`.
//
// It serves the repo with `python3 -m http.server`, sets up a Phase 3 workshop
// with Commissions bought and a blue tint (Sky Blue) discovered but not made
// yet, opens Commissions at 390 px and checks:
//  - every step lists her qualifying colors (Sky Blue shows under the blue step);
//  - a step with nothing to hand over shows one plan with a button, and the
//    blue step's "Make it" opens the mixer picker over the screen;
//  - once jars exist the step offers Deliver, and delivering moves the count;
//  - "How does this work?" opens the how-to sheet;
//  - the workshop's vat list shows discovered colors not made yet and picks
//    up a new find while it is open;
//  - no horizontal scroll, no console errors.
// SHOTS=<dir> saves commissions-screen.png and commissions-howto.png there.
// If Playwright cannot be resolved the test prints SKIP and exits 0.

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
if (!pw) { console.log('SKIP commissions.e2e: Playwright not found'); process.exit(0); }
const PORT = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let browser;
try {
  await waitForServer(`http://localhost:${PORT}/`);
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: CHROMIUM }); }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  // Google Fonts may be unreachable here; the game must work with the fallback fonts.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.tincture && window.tincture.game, null, { timeout: 10000 });

  // A Phase 3 workshop, Commissions bought, Sky Blue discovered but not made yet.
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    const s = game.state;
    const sim = ctx.sim;
    s.onboarding.done = true;
    s.onboarding.step = 99;
    s.onboarding.seen = { ...(s.onboarding.seen || {}), commissions: true };
    const want = ['sky-blue', 'navy', 'orange', 'green', 'violet', 'rose', 'maroon', 'olive', 'marigold', 'russet', 'cornflower', 'willow',
      'mulberry', 'rosewood', 'brick-red', 'walnut', 'hazel', 'spruce', 'juniper', 'teal', 'mauve', 'dusty-rose', 'blush', 'apricot', 'wheat',
      'old-gold', 'ice', 'mist', 'rust', 'bog-oak', 'damson', 'forest', 'cocoa'];
    for (const id of want) sim.discover(s, { colorId: id, method: 'debug' }, game.now());
    s._events = []; // no naming ceremonies for the set-up colors
    s.phase = 3;
    s.coins = 1e6;
    s.unlocks.shelf = true;
    s.unlocks.hunters = true;
    s.unlocks.commissions = true;
    s.stock = {};
    s.commissions = { open: [], done: [], later: [] };
    game.act(sim.commissions.refresh, {});
    game.act(sim.unlockRegions, {});
    ctx.navigate('commissions');
  });
  await page.waitForSelector('[data-screen="commissions"] .cm-card', { timeout: 5000 });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const root = document.querySelector('[data-screen="commissions"]');
    const open = window.tincture.game.state.commissions.open.map((r) => r.id);
    const blueRow = [...root.querySelectorAll('.cm-step')].find((el) => /jars of blues/.test(el.textContent));
    return {
      open,
      blueHasSky: !!blueRow && /Sky Blue/.test(blueRow.textContent),
      blueMake: !!blueRow && !!blueRow.querySelector('[data-action="make"]'),
      plans: [...root.querySelectorAll('.cm-step')].filter((el) => !/Done/.test(el.querySelector('.top').textContent))
        .every((el) => el.querySelector('[data-action="deliver"], [data-action="make"], [data-action="go"]') || /Nothing you can reach/.test(el.textContent)),
      hscroll: document.documentElement.scrollWidth > window.innerWidth || root.querySelector('.screen-body').scrollWidth > root.querySelector('.screen-body').clientWidth,
    };
  });
  must(info.open.length >= 1, `commissions open: ${info.open.join(', ')}`);
  must(info.blueHasSky, 'the blue step lists her Sky Blue tint as a color that counts');
  must(info.blueMake, 'with no jars yet, the blue step offers "Make it"');
  must(info.plans, 'every unfinished step has a Deliver button or a plan with a button');
  must(!info.hscroll, 'no horizontal scroll at 390 px');
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'commissions-screen.png') });
    await page.evaluate(() => document.querySelector('[data-screen="commissions"] .cm-card[data-commission="harbor-lighthouse"]')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'commissions-blue-step.png') });
    await page.evaluate(() => document.querySelector('[data-screen="commissions"] .screen-body').scrollTo(0, 0));
  }

  // "Make it" opens the mixer picker over the screen.
  const blueMake = page.locator('[data-screen="commissions"] .cm-step', { hasText: 'jars of blues' }).locator('[data-action="make"]').first();
  const makeColor = await blueMake.getAttribute('data-color');
  await blueMake.scrollIntoViewIfNeeded();
  await blueMake.click();
  await page.waitForTimeout(300);
  must(await page.locator('[data-screen="commissions"] .ws-sheet').count() > 0, 'Make it opens the mixer picker on the Commissions screen');
  await page.locator('[data-screen="commissions"] .ws-sheet [data-action="assign-to"]').first().click();
  await page.waitForTimeout(300);
  const making = await page.evaluate((id) => window.tincture.game.state.stations.mixers.some((m) => m.recipe === id), makeColor);
  must(making, `a mixer now makes ${makeColor}`);

  // Jars arrive: the step offers Deliver and a delivery moves the count.
  await page.evaluate(() => { const { game, ctx } = window.tincture; game.act((s) => ctx.sim.addStock(s, 'sky-blue', 6)); });
  await page.waitForTimeout(300);
  const deliverBtn = page.locator('[data-screen="commissions"] .cm-step', { hasText: 'jars of blues' }).locator('[data-action="deliver"]').first();
  must(await deliverBtn.count() > 0, 'with jars in stock the blue step offers Deliver');
  await deliverBtn.scrollIntoViewIfNeeded();
  await deliverBtn.click();
  await page.waitForTimeout(300);
  await page.locator('[data-screen="commissions"] [data-action="sheet-go"]').click();
  await page.waitForTimeout(700);
  const delivered = await page.evaluate(() => {
    const s = window.tincture.game.state;
    const rec = s.commissions.open.find((r) => r.id === 'harbor-lighthouse') || s.commissions.open[0];
    return rec.steps.reduce((n, p) => n + (p.colors?.['sky-blue'] || 0), 0);
  });
  must(delivered > 0, `delivered Sky Blue jars (${delivered})`);

  // The how-to sheet.
  await page.evaluate(() => document.querySelector('[data-screen="commissions"] .screen-body').scrollTo(0, 0));
  await page.locator('[data-screen="commissions"] .screen-body [data-action="howto"]').first().click();
  await page.waitForSelector('[data-screen="commissions"] [data-howto]', { timeout: 3000 });
  const how = await page.textContent('[data-screen="commissions"] [data-howto]');
  must(/never expire/.test(how) && /What you get/.test(how) && /If you leave one/.test(how), 'the how-to sheet explains filling, rewards and leaving');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'commissions-howto.png') });
  await page.locator('[data-screen="commissions"] [data-howto] [data-action="sheet-close"]').last().click();

  // The vat list shows every discovered color and follows new finds live.
  await page.evaluate(() => window.tincture.ctx.navigate('workshop', { sheet: 'vat', vat: 2 }));
  await page.waitForSelector('[data-screen="workshop"] .ws-sheet', { timeout: 3000 });
  const vat1 = await page.textContent('[data-screen="workshop"] .ws-sheet');
  must(/Navy/.test(vat1) && /Not made yet/.test(vat1), 'the vat list shows discovered colors that are not made yet');
  await page.evaluate(() => { const { game, ctx } = window.tincture; game.act(ctx.sim.discover, { colorId: 'delft-blue', method: 'debug' }); game.state._events = []; });
  await page.waitForTimeout(600);
  const vat2 = await page.textContent('[data-screen="workshop"] .ws-sheet');
  must(/Delft Blue/.test(vat2), 'a color found while the vat list is open appears on it');

  must(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL', e && e.stack || e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}
if (failures) { console.log(`commissions.e2e: ${failures} failure(s)`); process.exit(1); }
console.log('commissions.e2e: all good');
