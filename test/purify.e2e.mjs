// Tincture — test/purify.e2e.mjs
// Purify walked in headless Chromium with touch input (isMobile, hasTouch,
// DPR 2) at 390x844:
//  - the Puzzles hub card shows the tier control and the Murky on/off chip with
//    its one line; the chip remembers her choice (settings.purifyMurky);
//  - a Murky board: every layer below a top is cloudy ([data-hidden]), the
//    first-Murky bubble shows once, pours reveal layers for good, undo never
//    re-hides, a reload keeps the reveal state, colorblind patterns never land
//    on a cloudy layer, and a solve pays with "the Murky bonus";
//  - the board's Murky chip turns it off (starts over) and the tier switch opens
//    a Master board in strongly distinct colors;
//  - no horizontal scroll, no page errors.
// Run: node test/purify.e2e.mjs   (screenshots: $PURIFY_SHOTS or the OS temp dir)

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.PURIFY_SHOTS || path.join(os.tmpdir(), 'tincture-purify-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  const unwrap = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  try { const pw = unwrap(await import('playwright')); if (pw) return pw; } catch (e) { /* fall through */ }
  const roots = ['/opt/node-tools/node_modules'];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch (e) { /* ignore */ }
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
  for (const r of roots) {
    const entry = path.join(r, 'playwright', 'index.js');
    if (fs.existsSync(entry)) { const pw = unwrap(await import(pathToFileURL(entry).href)); if (pw) return pw; }
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

const pw = await loadPlaywright();
if (!pw) { console.log('SKIP purify.e2e: Playwright not found'); process.exit(0); }

const PORT = await freePort();
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; return ok; };
const must = (ok, label) => { if (!check(ok, label)) throw new Error('stopped at: ' + label); };
let browser = null;

async function tap(page, target) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  for (let tries = 0; ; tries++) {
    try {
      await loc.waitFor({ state: 'visible', timeout: 8000 });
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      if (!b) throw new Error('no box for ' + target);
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      return;
    } catch (e) {
      if (tries >= 2 || !/not attached|no box/.test(String(e && e.message))) throw e;
    }
  }
}

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
}

/** A workshop with 50 colors (every tier and Murky open), other guides done, two muddy batches waiting. */
async function seed(page) {
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 50) break;
        if (c.era !== 1 || st.catalog.discovered[c.id]) continue;
        st.catalog.discovered[c.id] = { at: now, name: c.name, custom: false, essence: 0 };
      }
      if (!st.catalog.discovered.blush) st.catalog.discovered.blush = { at: now, name: 'Blush', custom: false, essence: 0 };
      st.coins = 500;
      st.muddyBatches = [
        { id: 'mb1', color: 'blush', jars: 5, value: 50, at: 0, tier: null },
        { id: 'mb2', color: 'blush', jars: 5, value: 50, at: 0, tier: null },
      ];
      st.activePuzzles = { grading: null, purify: null, packing: null, pendingTints: [] };
      return {};
    }, {});
    game.save();
  });
}

const purifyState = (page) => page.evaluate(() => {
  const e = window.tincture.game.state.activePuzzles.purify;
  const P = window.tincture.ctx.puzzles.purify;
  return e ? { batchId: e.batchId, tier: e.tier, murky: !!e.puzzle.murky, hidden: P.hiddenTotal(e.puzzle), moves: e.puzzle.moves, tubes: JSON.stringify(e.puzzle.tubes), hiddenList: JSON.stringify(e.puzzle.hidden || null), colors: e.puzzle.colors } : null;
});

/** Cloudy layers drawn on the shelf, and whether any of them carries a color or a pattern. */
const drawnHidden = (page) => page.evaluate(() => {
  const gs = [...document.querySelectorAll('#screen-purify [data-shelf] [data-hidden]')];
  const P = window.tincture.ctx.puzzles.purify;
  const e = window.tincture.game.state.activePuzzles.purify;
  const colors = e ? e.puzzle.colors.map((c) => c.toLowerCase()) : [];
  // A cloudy layer that is not mid-clear must not have a real layer (color or pattern) drawn under it.
  let leaks = 0;
  for (const g of gs) {
    if (g.classList.contains('pu-clearing')) continue;
    const parent = g.parentElement;
    for (const r of parent.querySelectorAll(':scope > rect')) {
      const f = (r.getAttribute('fill') || '').toLowerCase();
      if (f.startsWith('url(') || colors.includes(f)) leaks++;
    }
  }
  return { count: gs.filter((g) => !g.classList.contains('pu-clearing')).length, leaks, total: e ? P.hiddenTotal(e.puzzle) : 0 };
});

async function noHScroll(page, label) {
  const h = await page.evaluate(() => {
    const sec = document.querySelector('section.screen:not([hidden])');
    const body = sec && sec.querySelector('.screen-body');
    return document.scrollingElement.scrollWidth > innerWidth + 1 || !!(body && body.scrollWidth > body.clientWidth + 1);
  });
  check(!h, `${label}: no horizontal scroll`);
}

/** Pour a -> b by touch: tap the source, then the target. */
async function pourByTap(page, a, b) {
  await tap(page, `#screen-purify [data-tube="${a}"]`);
  await page.waitForTimeout(60);
  await tap(page, `#screen-purify [data-tube="${b}"]`);
  await page.waitForTimeout(140);
}

const solution = (page) => page.evaluate(() => {
  const e = window.tincture.game.state.activePuzzles.purify;
  return window.tincture.ctx.puzzles.purify.solve(e.puzzle).moves;
});

async function walk(viewport, tag) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) || /net::ERR_FAILED/.test(m.text())) return;
    errors.push('console.error: ' + m.text());
  });
  const shot = (name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`), ...opts });

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  // --- the hub card: tiers and the Murky chip ---------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-purify', { state: 'visible' });
  const chip = '#pz-purify [data-action="purify-murky"]';
  must(await page.locator(chip).count() === 1, `${tag}: the Purify card shows the Murky chip`);
  check(await page.locator(chip).getAttribute('aria-pressed') === 'false', `${tag}: Murky starts off`);
  check(await page.locator('#pz-purify [data-action="purify-tier"]').count() === 4, `${tag}: all four tiers show at 50 colors`);
  check(/cloudy/.test(await page.locator('#pz-purify .pz-murkyrow .hint').innerText()), `${tag}: the chip has its one-line explanation`);
  await tap(page, chip);
  await page.waitForFunction(() => window.tincture.game.state.settings.purifyMurky === true);
  check(await page.locator(chip).getAttribute('aria-pressed') === 'true', `${tag}: the chip reads On`);
  await page.locator('#pz-purify').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('#pz-purify').screenshot({ path: path.join(SHOTS, `${tag}-01-tier-and-murky-switch.png`) });
  await noHScroll(page, `${tag} hub`);

  // --- a Murky board ------------------------------------------------------------------
  await tap(page, '#pz-purify [data-action="sort-one"]');
  await page.waitForSelector('#screen-purify [data-shelf] [data-tube]', { state: 'visible' });
  await page.waitForTimeout(500);
  let st = await purifyState(page);
  must(st && st.murky && st.tier === 'relaxed', `${tag}: Sort one opens a Relaxed · Murky board`);
  check(/Relaxed · Murky/.test(await page.locator('#screen-purify [data-subtitle]').innerText()), `${tag}: the subtitle says Relaxed · Murky`);
  let dh = await drawnHidden(page);
  check(dh.count > 0 && dh.count === st.hidden, `${tag}: every hidden layer is drawn cloudy (${dh.count} of ${st.hidden})`);
  check(dh.leaks === 0, `${tag}: no cloudy layer shows its color`);
  const bubble = await page.waitForSelector('.coach-tag', { state: 'visible', timeout: 5000 }).catch(() => null);
  check(!!bubble && /Cloudy layers/.test(await bubble.innerText()), `${tag}: the first Murky board shows its one bubble`);
  await shot('02-murky-board');
  if (bubble) await tap(page, '.coach-tag [data-coach-action="ok"]');
  await page.waitForFunction(() => window.tincture.game.state.onboarding.seen['purify-murky'] === true, null, { timeout: 4000 }).catch(() => {});
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen['purify-murky']), `${tag}: the Murky bubble is marked seen`);

  // Pours reveal layers; drawn and saved stay in step.
  const before = st.hidden;
  let moves = await solution(page);
  for (const [a, b] of moves.slice(0, 4)) await pourByTap(page, a, b);
  await page.waitForTimeout(700);
  st = await purifyState(page);
  check(st.moves === 4, `${tag}: four pours by touch (${st.moves})`);
  check(st.hidden < before, `${tag}: pours revealed layers (${before} -> ${st.hidden})`);
  dh = await drawnHidden(page);
  check(dh.count === st.hidden && dh.leaks === 0, `${tag}: the shelf draws exactly the layers still cloudy (${dh.count})`);
  await shot('03-murky-after-reveals');
  await noHScroll(page, `${tag} murky board`);

  // Undo never re-hides.
  const afterPours = st.hidden;
  await tap(page, '#screen-purify [data-action="undo"]');
  await page.waitForTimeout(200);
  st = await purifyState(page);
  check(st.hidden <= afterPours && st.moves === 4, `${tag}: undo takes back a pour without re-hiding (${st.hidden})`);

  // Colorblind: patterns never land on a cloudy layer.
  await page.evaluate(() => window.tincture.game.setSetting('colorblind', true));
  await page.waitForTimeout(200);
  dh = await drawnHidden(page);
  check(dh.count === st.hidden && dh.leaks === 0, `${tag}: colorblind patterns skip cloudy layers`);
  check(await page.locator('#screen-purify [data-shelf] rect[fill^="url("]').count() > 0, `${tag}: revealed layers still carry patterns`);
  await page.evaluate(() => window.tincture.game.setSetting('colorblind', false));

  // A reload keeps the board and its reveal state.
  const saved = await purifyState(page);
  await page.evaluate(() => window.tincture.game.save());
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.evaluate(() => window.tincture.ctx.navigate('purify', {}));
  await page.waitForSelector('#screen-purify [data-shelf] [data-tube]', { state: 'visible' });
  await page.waitForTimeout(300);
  const reloaded = await purifyState(page);
  check(reloaded.tubes === saved.tubes && reloaded.hiddenList === saved.hiddenList && reloaded.murky, `${tag}: a reload keeps the board and what is revealed`);

  // Finish it: the reward names the Murky bonus.
  const coins0 = await page.evaluate(() => window.tincture.game.state.coins);
  moves = await solution(page);
  for (const [a, b] of moves) await pourByTap(page, a, b);
  const result = await page.waitForSelector('#screen-purify [data-result]', { state: 'visible', timeout: 8000 }).catch(() => null);
  must(!!result, `${tag}: the Murky board solves by touch`);
  await page.waitForTimeout(900);
  check(/Murky bonus/.test(await result.innerText()), `${tag}: the reward line names the Murky bonus`);
  check(await page.evaluate(() => window.tincture.game.state.coins) > coins0, `${tag}: coins landed`);

  // --- the next batch: Murky off on the board, then Master -----------------------------
  await tap(page, '#screen-purify [data-action="next-batch"]');
  await page.waitForSelector('#screen-purify [data-shelf] [data-tube]', { state: 'visible' });
  st = await purifyState(page);
  check(st.murky && st.batchId === 'mb2', `${tag}: the next batch keeps Murky on`);
  await tap(page, '#screen-purify [data-action="murky-toggle"]');
  await page.waitForTimeout(250);
  st = await purifyState(page);
  check(!st.murky && st.hidden === 0, `${tag}: the board's chip turns Murky off (all clear)`);
  check(await page.evaluate(() => window.tincture.game.state.settings.purifyMurky === false), `${tag}: and remembers it`);
  await tap(page, '#screen-purify [data-action="restart-tier"][data-tier="master"]');
  await page.waitForTimeout(600);
  st = await purifyState(page);
  must(st.tier === 'master' && !st.murky, `${tag}: the tier switch opens a Master board`);
  check(st.colors.length === 9, `${tag}: Master sorts 9 colors`);
  await shot('04-master-board');
  await noHScroll(page, `${tag} master board`);
  // Master on Murky too, for the record.
  await tap(page, '#screen-purify [data-action="murky-toggle"]');
  await page.waitForTimeout(500);
  st = await purifyState(page);
  check(st.murky && st.tier === 'master', `${tag}: Master · Murky combines`);
  check(/Master · Murky/.test(await page.locator('#screen-purify [data-subtitle]').innerText()), `${tag}: the subtitle says Master · Murky`);
  await page.locator('#screen-purify [data-tools]').scrollIntoViewIfNeeded();
  await shot('05-board-switches');
  await noHScroll(page, `${tag} master murky`);

  check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

try {
  try { browser = await pw.chromium.launch(); } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  await waitForServer(URL_);
  await walk({ width: 390, height: 844 }, '390');
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Purify checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
