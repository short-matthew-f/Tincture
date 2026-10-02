// Tincture — test/first-ten-minutes.e2e.mjs
// Playwright walk of DESIGN.md "Fun and engagement > First ten minutes" on the
// REAL app with a fresh localStorage. NOT part of `npm test`; run with
// `npm run e2e` (or `node test/first-ten-minutes.e2e.mjs`).
//
// Everything she does goes through real buttons. window.tincture is used only
// to read state and, through window.tincture.debug, to let time pass
// (debug.advance(ms)) or speed up discoveries (debug.discover(id)).
//
// Script: welcome -> first order mixed (madder + ochre) and delivered -> naming
// prompt -> named -> Relaxed grading board solved -> a tint discovered ->
// upgrades bought in the Workshop (the flow meter's suggestion when affordable,
// else the cheapest Level up) -> 5 colors -> the Merge Shelf opens seeded, one
// tap-merge chains -> the order board fills and she fills a second order ->
// more upgrades -> Mill Room tag visible -> Close up shop introduced; the first
// session must buy at least 6 upgrades with at most 10 minutes of
// debug.advance (TUNING.md change 7) -> 3 days away reopen the Morning Ledger with
// produced lines -> All caught up. Then every screen and overlay is opened
// and closed, and finally an offline reload must boot from the service worker.
//
// Throughout: no console errors or page errors (the Google Fonts abort is
// allowed), and no horizontal overflow (scrollWidth <= 390) on any screen.
// A screenshot per step goes to $E2E_SHOTS (default: <os tmpdir>/tincture-e2e-shots).
//
// If Playwright cannot be resolved the test prints SKIP and exits 0.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'tincture-e2e-shots');
const WIDTH = 390;
const DAY = 24 * 3600e3;

const ALL_SCREENS = ['workshop', 'ledger', 'orders', 'matching', 'bench', 'commissions', 'puzzles', 'grading',
  'purify', 'packing', 'map', 'hunter', 'album', 'quests', 'catalog', 'gallery', 'paint', 'shelf', 'heritage',
  'settings', 'naming', 'phase-beat', 'onboarding'];
const TABS = ['workshop', 'orders', 'puzzles', 'map', 'catalog'];

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
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
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
  throw new Error('http.server did not start: ' + url);
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('SKIP first-ten-minutes.e2e: the playwright package is not resolvable here.');
  process.exit(0);
}

fs.mkdirSync(SHOTS, { recursive: true });
const PORT = await freePort();
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });

let browser;
let failures = 0;
let shotN = 0;
const errors = [];
const shots = [];

function check(ok, label) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
  return ok;
}

/** A hard step: throws (ending the walk) when it fails. */
function must(ok, label) {
  if (!check(ok, label)) throw new Error('stopped at: ' + label);
}

try {
  await waitForServer(URL_);
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, hasTouch: false });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) || /net::ERR_FAILED/.test(m.text())) return; // the Google Fonts abort
    errors.push('console.error: ' + m.text() + (url ? ` (${url})` : ''));
  });

  // ---------------------------------------------------------------- helpers
  const S = (fn, arg) => page.evaluate(fn, arg);
  const stackIds = () => S(() => window.tincture.router.stack().map((x) => x.id));
  const topId = async () => (await stackIds()).slice(-1)[0];
  const sec = (id) => `#app > section[data-screen="${id}"]`;
  const wait = (ms) => page.waitForTimeout(ms);

  async function overflow(label) {
    const w = await S(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    check(w <= WIDTH, `no horizontal overflow on ${label} (scrollWidth ${w})`);
  }

  let errorsSeen = 0;
  function noNewErrors(label) {
    const fresh = errors.slice(errorsSeen);
    errorsSeen = errors.length;
    check(fresh.length === 0, `no console errors: ${label}` + (fresh.length ? '\n     ' + fresh.join('\n     ') : ''));
  }

  async function shot(name) {
    shotN++;
    const file = path.join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  }

  /** One step of the walk: screenshot, overflow and error checks. */
  async function step(name) {
    await wait(250);
    await shot(name);
    await overflow(name);
    noNewErrors(name);
  }

  async function waitTop(id, ms = 5000) {
    await page.waitForFunction((x) => {
      const s = window.tincture.router.stack();
      return s.length && s[s.length - 1].id === x;
    }, id, { timeout: ms });
  }

  /** Close every naming ceremony that is up (keeping the suggestion). */
  async function keepNames(max = 6) {
    for (let i = 0; i < max; i++) {
      await wait(350);
      if ((await topId()) !== 'naming') return i;
      await page.click(`${sec('naming')} [data-action="keep"]`);
      await wait(500);
    }
    return max;
  }

  /** Close ceremonies (naming, phase beats) until a normal screen is on top. */
  async function clearCeremonies() {
    for (let i = 0; i < 8; i++) {
      await wait(300);
      const t = await topId();
      if (t === 'naming') { await page.click(`${sec('naming')} [data-action="keep"]`); continue; }
      if (t === 'phase-beat') {
        const b = page.locator(`${sec('phase-beat')} [data-action]`).first();
        if (await b.count()) await b.click(); else await page.click(`${sec('phase-beat')} [data-back]`);
        continue;
      }
      return;
    }
  }

  /** Close an "away" card (Not now). Coach marks with "Got it" stay: steps advance from real play. */
  async function dismissCoach() {
    const b = page.locator('#coach-layer [data-coach-action="later"]');
    if (await b.count()) { await b.first().click(); await wait(200); }
  }

  // The first session's clock: debug.advance is the only way time passes faster
  // than real time, and DESIGN.md's script fits in ten minutes.
  const SESSION_MS = 10 * 60e3;
  let advanced = 0;
  const advance = async (ms) => { advanced += ms; await S((x) => window.tincture.debug.advance(x), ms); };
  // Every upgrade she buys in the first session (Workshop buttons only).
  const purchases = [];
  // debug.advance moves her clocks back rather than now forward, so the session
  // clock is real time since the welcome card plus everything advanced.
  let sessionStart = Date.now();
  const sessionClock = () => Date.now() - sessionStart + advanced;

  /**
   * One buying round in the Workshop: the flow meter's suggestion whenever she
   * can afford it, otherwise the first affordable Level up. Repeats until
   * nothing is affordable. Returns how many she bought.
   */
  async function buyRound(label) {
    if ((await topId()) !== 'workshop') { await page.click('#tabbar [data-tab="workshop"]'); await waitTop('workshop'); }
    await dismissCoach();
    const collect = page.locator(`${sec('workshop')} [data-action="collect"]:visible`);
    if (await collect.count()) { await collect.first().click(); await wait(600); }
    let n = 0;
    for (let guard = 0; guard < 20; guard++) {
      const coinsBefore = await S(() => window.tincture.game.state.coins);
      const sugg = page.locator(`${sec('workshop')} [data-action="suggestion"]:not([aria-disabled="true"])`);
      const suggKind = (await sugg.count()) ? await sugg.first().getAttribute('data-kind') : '';
      let what = '';
      if (suggKind && suggKind !== 'assign' && Number(await sugg.first().getAttribute('data-cost')) > 0) {
        what = 'suggestion: ' + (await sugg.first().textContent()).trim();
        await sugg.first().click();
      } else {
        // The cheapest affordable Level up (open panels only, as she sees them).
        const buys = page.locator(`${sec('workshop')} [data-action="buy"]:not([disabled]):not([aria-disabled="true"])`);
        const costs = await buys.evaluateAll((bs) => bs.map((b) => Number(b.dataset.cost)));
        if (!costs.length) break;
        const buy = buys.nth(costs.indexOf(Math.min(...costs)));
        what = await buy.evaluate((b) => (b.closest('.ws-row')?.querySelector('.ws-t')?.textContent || b.dataset.kind || '').trim());
        await buy.scrollIntoViewIfNeeded();
        await buy.click();
      }
      await wait(250);
      await clearCeremonies();
      const coinsAfter = await S(() => window.tincture.game.state.coins);
      if (!(coinsAfter < coinsBefore)) break;
      n++;
      purchases.push({ at: sessionClock(), what, cost: coinsBefore - coinsAfter, label });
    }
    return n;
  }

  const discovered = () => S(() => Object.keys(window.tincture.game.state.catalog.discovered).length);
  const onboarding = () => S(() => ({ ...window.tincture.game.state.onboarding }));

  // ---------------------------------------------------------------- 0:00 welcome
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.debug);
  await S(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.debug);
  await waitTop('onboarding');
  must(await page.isVisible(`${sec('onboarding')} [data-action="welcome-start"]`), 'fresh save opens the welcome card');
  await step('welcome');

  // ---------------------------------------------------------------- first order
  sessionStart = Date.now();
  await page.click(`${sec('onboarding')} [data-action="welcome-start"]`);
  await waitTop('orders');
  must(await page.isVisible('[data-coach="first-order"]'), 'the first order is on the board with its coach mark');
  await step('first-order');
  await page.click('[data-coach="first-order"]');
  await waitTop('matching');
  await page.click(`${sec('matching')} [data-drop="madder"]`);
  await page.click(`${sec('matching')} [data-drop="ochre"]`);
  await step('first-mix');
  await page.click(`${sec('matching')} [data-action="submit"]`);
  await waitTop('naming', 6000);
  must(true, 'delivering the first orange opens the naming prompt');
  await step('naming-prompt');
  await page.click(`${sec('naming')} [data-action="edit"]`);
  await page.fill('#naming-input', 'Harbor Sunset');
  await page.click(`${sec('naming')} [data-action="save"]`);
  await wait(900);
  must(await S(() => window.tincture.game.state.catalog.discovered.orange.name === 'Harbor Sunset'), 'she named her orange "Harbor Sunset"');
  check(await S(() => window.tincture.game.state.orders.filledCount >= 1), 'the first order counts as filled');
  await step('named');
  await page.click(`${sec('matching')} [data-action="back-orders"]`);
  await waitTop('orders');

  // ---------------------------------------------------------------- 1:00 Relaxed grading board
  must((await onboarding()).step === 2, 'onboarding moved to step 2 (grading)');
  await page.click('#tabbar [data-tab="puzzles"]');
  await waitTop('puzzles');
  await step('puzzles');
  const colorsBeforeBoard = await discovered();
  await page.click(`${sec('puzzles')} [data-action="new-grading"]`);
  await waitTop('grading');
  must(await S(() => !!window.tincture.game.state.activePuzzles.grading
    && window.tincture.game.state.activePuzzles.grading.tier === 'relaxed'), 'a Relaxed grading board is on the table');
  await step('grading-board');
  for (let guard = 0; guard < 80; guard++) {
    const mv = await S(() => {
      const b = window.tincture.game.state.activePuzzles.grading;
      if (!b) return null;
      for (let p = 0; p < b.order.length; p++) if (b.mask[p] && b.order[p] !== p) return [p, b.order.indexOf(p)];
      return null;
    });
    if (!mv) break;
    await page.click(`${sec('grading')} .gr-tile[data-p="${mv[0]}"]`);
    await page.click(`${sec('grading')} .gr-tile[data-p="${mv[1]}"]`);
    await wait(240);
  }
  must(await S(() => !window.tincture.game.state.activePuzzles.grading), 'the grading board is solved');
  await wait(1800);
  await step('board-solved');
  must((await onboarding()).step === 3, 'boardSolved advanced onboarding to step 3 (upgrades)');
  const named = await keepNames();
  must(named >= 1 && (await discovered()) > colorsBeforeBoard, 'the solved board revealed a tint for the catalog');
  if ((await topId()) === 'grading') await page.click(`${sec('grading')} [data-back]`);
  await clearCeremonies();

  // ---------------------------------------------------------------- 3:00 first upgrades
  await page.click('#tabbar [data-tab="workshop"]');
  await waitTop('workshop');
  await dismissCoach();
  // A mixer needs a recipe: the flow meter suggestion says so.
  await page.click(`${sec('workshop')} [data-action="suggestion"]`);
  await wait(400);
  const pick = page.locator('[data-action="set-recipe"][data-color="orange"]');
  must(await pick.count() > 0, 'the recipe sheet offers her orange');
  await pick.first().click();
  await wait(400);
  must(await S(() => window.tincture.game.state.stations.mixers[0].recipe === 'orange'), 'mixer 1 makes orange');
  await step('mixer-assigned');
  // The till from the drawer plus the tutorial rewards of the first order and
  // the first board: her first upgrades come at once.
  const coinsAtStep3 = await S(() => window.tincture.game.state.coins);
  const cheapestAtStep3 = await S(() => window.tincture.ctx.sim.economy.cheapestUpgrade(window.tincture.game.state).cost);
  console.log(`     at step 3: ${coinsAtStep3.toFixed(1)} Coins, cheapest upgrade ${cheapestAtStep3.toFixed(1)}`);
  check(coinsAtStep3 >= 3 * cheapestAtStep3, 'after the first order and board she can afford three upgrades');
  const levelsBefore = await S(() => window.tincture.game.state.onboarding.flags.levelsAt);
  let bought = await buyRound('first upgrades');
  // Let the workshop run a few minutes (still in the session: no Ledger during onboarding).
  for (let i = 0; i < 4; i++) {
    await advance(45e3);
    await wait(120);
  }
  bought += await buyRound('after a few minutes');
  must(bought >= 3, `bought ${bought} upgrades from the Workshop`);
  check(Number.isFinite(levelsBefore), 'onboarding recorded the station levels at step 3');
  await step('upgrades');

  // ---------------------------------------------------------------- 4:00 five colors -> Merge Shelf
  await clearCeremonies();
  const extra = ['green', 'purple', 'vermilion', 'amber', 'teal'];
  for (const id of extra) {
    if ((await discovered()) >= 5) break;
    await S((c) => window.tincture.debug.discover(c), id);
    await keepNames();
  }
  must((await discovered()) >= 5, `the catalog reached ${await discovered()} colors`);
  if ((await onboarding()).step === 3) {
    // Step 3 completes after three level-ups; she may have bought only two.
    const ok = page.locator('#coach-layer [data-coach-action="ok"][data-step="3"]');
    if (await ok.count()) await ok.click();
  }
  await clearCeremonies();
  await page.click('#tabbar [data-tab="workshop"]');
  await page.waitForFunction(() => window.tincture.game.state.onboarding.flags.chainSeeded === true, null, { timeout: 5000 });
  must(true, 'the shelf was seeded for the first chain');
  const cells = await S(() => window.tincture.game.state.onboarding.flags.chainCells);
  must(!!cells, 'seeded cells are known');
  // The real path: the Workshop's shelf door.
  await page.click(`${sec('workshop')} [data-action="open-shelf"]`);
  await waitTop('shelf');
  await step('shelf-seeded');
  const chainSeen = S(() => new Promise((resolve) => {
    const off = window.tincture.game.on('chain', (p) => { off(); resolve(p && p.steps ? p.steps.length : 1); });
    setTimeout(() => resolve(0), 4000);
  }));
  await page.click(`${sec('shelf')} [data-cell="${cells.from}"]`);
  await page.click(`${sec('shelf')} [data-cell="${cells.to}"]`);
  must((await chainSeen) >= 1, 'one tap-merge on the seeded shelf triggers a chain');
  await wait(900);
  await step('chain-merge');
  await page.click(`${sec('shelf')} [data-back]`);
  await clearCeremonies();

  // ---------------------------------------------------------------- 6:00 order board fills, Mill Room goal
  for (let i = 0; i < 12; i++) {
    if ((await S(() => window.tincture.game.state.orders.open.length)) >= 3) break;
    await advance(55e3);
    await wait(100);
  }
  await page.click('#tabbar [data-tab="orders"]');
  await waitTop('orders');
  const openOrders = await S(() => window.tincture.game.state.orders.open.length);
  must(openOrders >= 3, `the order board fills (${openOrders} open orders)`);
  await step('orders-full');
  // She fills one more: the first match order, mixed from its recipe.
  const next = await S(() => window.tincture.game.state.orders.open.find((o) => o.kind === 'match' && Array.isArray(o.recipe)));
  if (next) {
    const coinsBeforeOrder = await S(() => window.tincture.game.state.coins);
    await page.click(`${sec('orders')} [data-action="open-match"][data-order="${next.id}"]`);
    await waitTop('matching');
    for (const r of next.recipe) {
      for (let k = 0; k < r.weight; k++) await page.click(`${sec('matching')} [data-drop="${r.pigment}"]`);
    }
    await page.click(`${sec('matching')} [data-action="submit"]`);
    await wait(900);
    await keepNames();
    check((await S(() => window.tincture.game.state.coins)) > coinsBeforeOrder, 'a second order pays');
    if ((await topId()) === 'matching') await page.click(`${sec('matching')} [data-action="back-orders"]`);
    await clearCeremonies();
  }
  await buyRound('after the second order');
  await page.click('#tabbar [data-tab="workshop"]');
  await waitTop('workshop');
  const ob5 = await onboarding();
  check(ob5.step >= 5 || ob5.done, `onboarding reached the Mill Room step (step ${ob5.step})`);
  const mill = page.locator(`${sec('workshop')} [data-coach="mill-room"]`);
  must(await mill.count() > 0, 'the Mill Room goal is on the Workshop');
  await mill.first().scrollIntoViewIfNeeded();
  must(await mill.first().isVisible(), 'the Mill Room tag is visible');
  await step('mill-room');

  // ---------------------------------------------------------------- 8:00-9:00 map window, gallery door, Close up shop
  for (let i = 0; i < 6; i++) {
    const o = await onboarding();
    if (o.done || o.step >= 7) break;
    await advance(31e3);
    await wait(400);
    const ok = page.locator('#coach-layer [data-coach-action="ok"]');
    if (await ok.count()) { await ok.first().click(); await wait(300); }
  }
  const ob7 = await onboarding();
  must(ob7.step === 7 && !ob7.done, 'onboarding reached "Close up shop"');
  await advance(31e3);
  await wait(500);
  await buyRound('before closing up');
  console.log(`     first session: ${purchases.length} upgrades in ${(sessionClock() / 60e3).toFixed(1)} min `
    + `(${(advanced / 60e3).toFixed(1)} min advanced)\n       ` + purchases.map((p) => `${(p.at / 60e3).toFixed(1)} min  ${p.what} (${p.cost.toFixed(1)}; ${p.label})`).join('\n       '));
  check(advanced <= SESSION_MS, `the first session lets at most 10 minutes pass (${(advanced / 60e3).toFixed(1)} min advanced)`);
  check(purchases.length >= 6, `at least 6 upgrades bought in the first ten minutes (${purchases.length})`);
  await page.click('#tabbar [data-tab="workshop"]');
  await waitTop('workshop');
  const closeUp = page.locator(`${sec('workshop')} [data-coach="close-up"]`);
  must(await closeUp.count() > 0, 'the Close up shop control is on the Workshop');
  await closeUp.first().scrollIntoViewIfNeeded();
  await wait(300);
  must(await page.isVisible('#coach-layer .coach-tag'), 'Close up shop is introduced by a coach mark');
  await step('close-up-intro');
  await closeUp.first().click();
  await wait(600);
  // The ritual confirms in a sheet: "Close up shop?" -> Close up shop.
  const go = page.locator(`${sec('workshop')} [data-action="cu-go"]`);
  must(await go.count() > 0, 'Close up shop asks to confirm in a sheet');
  await shot('close-up-sheet');
  await go.first().click();
  await wait(2200); // evening chord and the dusk dim
  const after = await onboarding();
  must(after.done === true, 'Close up shop ends the first session (onboarding done)');
  must(await S(() => window.tincture.game.state.stats.lastCloseUpAt > 0), 'the shop is closed up');
  await step('closed-up');
  await clearCeremonies();

  // ---------------------------------------------------------------- 3 days later: the Morning Ledger
  await S((ms) => window.tincture.debug.advance(ms), 3 * DAY);
  await waitTop('ledger', 6000);
  must(true, 'returning after 3 days opens the Morning Ledger');
  const produced = await S(() => {
    const p = window.tincture.game.state.ledger.pending;
    return p && Array.isArray(p.produced) ? p.produced.length : 0;
  });
  must(produced > 0, `the Ledger lists produced lines (${produced})`);
  await step('ledger');
  // Each line is a tap. Lines that point elsewhere are handled there (claim the
  // accident, sell the muddy batches, claim quests and event steps), then she
  // reopens the Ledger from the Workshop's ledger book until the stamp lands.
  async function handleElsewhere(id) {
    const clickAll = async (sel, max = 12) => {
      for (let i = 0; i < max; i++) {
        const b = page.locator(`${sec(id)} ${sel}:visible`);
        if (!(await b.count())) return;
        try {
          await b.first().click({ timeout: 3000 }); // screens re-render as stock changes: retry on a fresh node
        } catch (e) { await wait(300); continue; }
        await wait(350);
        await clearCeremonies();
        const ok = page.locator('#modal:not([hidden]) .btn-primary, #modal:not([hidden]) [data-value]');
        if (await ok.count()) { await ok.first().click(); await wait(250); }
      }
    };
    if (id === 'workshop') await clickAll('[data-action="claim-accident"]');
    if (id === 'puzzles') await clickAll('[data-action="sell-muddy"]');
    if (id === 'quests') {
      await clickAll('[data-action="claim"]');
      await clickAll('[data-action="claim-weekly"]');
      const tab = page.locator(`${sec('quests')} [data-tab="event"], ${sec('quests')} [data-action="tab"][data-tab-id="event"]`);
      if (await tab.count()) { await tab.first().click(); await wait(250); }
      await clickAll('[data-action="claim-step"]');
    }
    if (id === 'gallery') await clickAll('[data-action="accept-offer"]');
  }
  async function openLedger() {
    if ((await topId()) === 'ledger') return;
    await clearCeremonies();
    if ((await topId()) !== 'workshop') await page.click('#tabbar [data-tab="workshop"]').catch(() => S(() => window.tincture.ctx.navigate('workshop')));
    await waitTop('workshop');
    await dismissCoach();
    await page.click(`${sec('workshop')} [data-action="open-ledger"]`);
    await waitTop('ledger');
  }
  let stamped = false;
  for (let guard = 0; guard < 30 && !stamped; guard++) {
    await openLedger();
    await wait(300);
    if (await page.locator(`${sec('ledger')} [data-stamp]`).count()) { stamped = true; break; }
    const line = page.locator(`${sec('ledger')} .ld-line:not(.done)`);
    if (!(await line.count())) { await wait(500); stamped = (await page.locator(`${sec('ledger')} [data-stamp]`).count()) > 0; break; }
    await line.first().scrollIntoViewIfNeeded();
    await line.first().click();
    await wait(450);
    const t = await topId();
    if (t !== 'ledger') await handleElsewhere(t);
  }
  if (!stamped) console.log('     still pending:', await S(() => window.tincture.ctx.sim.ledger.pendingItems(window.tincture.game.state).join(', ')));
  must(stamped, 'every Ledger line handled: the All caught up stamp lands');
  check(await S(() => window.tincture.game.state.ledger.allCaughtUpAt > window.tincture.game.state.stats.lastCloseUpAt), 'All caught up is recorded');
  await wait(600);
  await step('all-caught-up');
  await page.click(`${sec('ledger')} [data-action="ledger-back"]`);
  await clearCeremonies();

  // ---------------------------------------------------------------- every screen opens and closes
  for (const id of ALL_SCREENS) {
    if (id === 'onboarding') continue; // the welcome card is a ceremony checked at boot
    const params = id === 'naming' ? { colorId: 'orange', suggestedName: 'Harbor Sunset' } : {};
    await S(([x, p]) => window.tincture.ctx.navigate(x, p), [id, params]);
    await wait(350);
    const visible = await S((x) => {
      const el = document.querySelector(`#app > section[data-screen="${x}"]`);
      return !!(el && !el.hidden && el.getBoundingClientRect().height > 0 && el.textContent.trim().length > 0);
    }, id);
    if (id === 'paint' && !(await S(() => (window.tincture.game.state.gallery.pieces || []).some((p) => !p.signedAt)))) {
      // Painting needs a piece on the easel; with none it closes and points her to the Gallery.
      check(!(await S(() => window.tincture.router.isOpen('paint'))), 'paint with no piece on the easel closes itself');
      check((await topId()) === 'gallery', 'paint with no piece opens the Gallery');
      check(await page.locator('#toasts .toast', { hasText: 'Pick a canvas to start painting' }).count() > 0, 'paint with no piece says "Pick a canvas to start painting"');
      noNewErrors('screen paint');
      await S(() => window.tincture.router.back());
      await wait(200);
      continue;
    }
    check(visible, `${id} opens and shows content`);
    if (TABS.includes(id) || ['orders', 'puzzles'].includes(id)) {
      const tabbarOk = await S(() => {
        const tb = document.getElementById('tabbar');
        return tb && !tb.hidden;
      });
      check(tabbarOk, `${id} keeps the tab bar`);
    }
    await shot('screen-' + id);
    await overflow('screen ' + id);
    noNewErrors('screen ' + id);
    // Close: back for overlays (sheets/modals first), a tab switch for tabs.
    if (TABS.includes(id)) continue;
    for (let i = 0; i < 4 && (await S((x) => window.tincture.router.isOpen(x), id)); i++) {
      await S(() => window.tincture.router.back());
      await wait(200);
    }
    check(!(await S((x) => window.tincture.router.isOpen(x), id)), `${id} closes`);
    await clearCeremonies();
  }
  // Tabs through the real tab bar.
  for (const id of TABS) {
    await page.click(`#tabbar [data-tab="${id}"]`);
    await wait(250);
    check((await topId()) === id, `tab ${id} opens from the tab bar`);
  }
  noNewErrors('screen walk');

  // ---------------------------------------------------------------- offline reload boots from the service worker
  const swReady = await S(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return !!reg;
  });
  check(swReady, 'the service worker is ready');
  if (swReady) {
    // Make sure the page is controlled before going offline.
    if (!(await S(() => !!navigator.serviceWorker.controller))) {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
    }
    await wait(1500); // let the precache finish
    server.kill(); // really offline (setOffline alone does not reach the worker's fetches)
    await wait(300);
    await context.setOffline(true);
    errorsSeen = errors.length;
    await page.reload({ waitUntil: 'load' }).catch((e) => errors.push('offline reload: ' + e.message));
    const booted = await page.waitForFunction(() => window.tincture && window.tincture.game && document.querySelector('#tabbar button'), null, { timeout: 8000 })
      .then(() => true, () => false);
    check(booted, 'an offline reload boots the app from the service worker');
    await shot('offline-boot');
    // Offline is expected to make the update check fail quietly; anything else is an error.
    noNewErrors('offline boot');
    await context.setOffline(false);
  }

  // ---------------------------------------------------------------- fresh install, then offline (precache only)
  // A brand-new visitor: the first load comes from the network before the worker
  // controls the page, so an offline reload can only work if sw.js precached
  // every file the app loads (tools/bump-version.js keeps SHELL complete).
  // Served with Cache-Control: no-store so the browser's HTTP cache cannot
  // stand in for the service worker's precache.
  {
    const PORT2 = await freePort();
    const URL2 = `http://localhost:${PORT2}/`;
    const NO_STORE = [
      'import http.server, sys',
      'class H(http.server.SimpleHTTPRequestHandler):',
      '    def end_headers(self):',
      "        self.send_header('Cache-Control', 'no-store')",
      '        super().end_headers()',
      '    def log_message(self, *a):',
      '        pass',
      "http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()",
    ].join('\n');
    const server2 = spawn('python3', ['-c', NO_STORE, String(PORT2)], { cwd: ROOT, stdio: 'ignore' });
    try {
    await waitForServer(URL2);
    const fresh = await browser.newContext({ viewport: { width: WIDTH, height: 844 } });
    const p2 = await fresh.newPage();
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message));
    p2.on('console', (m) => {
      const url = (m.location() && m.location().url) || '';
      if ((m.type() === 'error' || (m.type() === 'warning' && /\[app\] screen/.test(m.text())))
        && !/fonts\.(googleapis|gstatic)\.com/.test(url) && !/net::ERR_(FAILED|INTERNET_DISCONNECTED)/.test(m.text())) {
        errs2.push(m.type() + ': ' + m.text());
      }
    });
    await p2.goto(URL2, { waitUntil: 'load' });
    const ready = await p2.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
      return !!(reg && reg.active);
    });
    check(ready, 'fresh install: the service worker activates');
    // Really offline: stop the server too (setOffline alone does not reach the
    // service worker's own fetches in Chromium).
    server2.kill();
    await new Promise((r) => setTimeout(r, 300));
    await fresh.setOffline(true);
    await p2.reload({ waitUntil: 'load' }).catch((e) => errs2.push('offline reload: ' + e.message));
    const ok2 = await p2.waitForFunction(() => window.tincture && window.tincture.game && document.querySelector('#tabbar button'), null, { timeout: 8000 })
      .then(() => true, () => false);
    check(ok2, 'fresh install: an offline reload boots from the precache');
    const placeholders = await p2.evaluate(() => (document.body.textContent.match(/still being painted/g) || []).length);
    check(placeholders === 0, `fresh install offline: every screen module loaded (${placeholders} placeholders)`);
    check(errs2.length === 0, 'fresh install offline: no console errors' + (errs2.length ? '\n     ' + errs2.join('\n     ') : ''));
    await p2.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-fresh-offline-boot.png`) });
    shots.push('fresh-offline-boot');
    await fresh.close();
    } finally {
      server2.kill();
    }
  }
} catch (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  failures++;
} finally {
  if (browser) await browser.close();
  server.kill();
}

if (errors.length) console.log(`\n${errors.length} console error(s) in total`);
console.log(`\nscreenshots (${shots.length}) in ${SHOTS}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nfirst-ten-minutes.e2e passed');
process.exit(failures ? 1 : 0);
