// Tincture — test/first-ten-minutes.e2e.mjs
// Playwright walk of DESIGN.md "Fun and engagement > First ten minutes" (the
// v0.2 script, docs/UX-GUIDELINES-REVIEW.md §C) on the REAL app with a fresh
// localStorage. NOT part of `npm test`; run with `npm run e2e` (or
// `node test/first-ten-minutes.e2e.mjs`).
//
// Everything she does goes through real taps. window.tincture is used only to
// read state and, through window.tincture.debug, to let time pass
// (debug.advance(ms), in 45 s steps during the session so no break starts) or
// to add a color (debug.discover(id)) after the session.
//
// Script: welcome -> first order mixed (madder + ochre) and delivered ->
// naming -> the board bubble (Puzzles tab, then New board) -> a Relaxed board
// in her own colors solved, one tint -> Workshop: the Next bubble, then Next
// taps (recipes, upgrades) -> the third-mixer bubble, Mixer 3 bought through
// Next -> a second order (the board is full) -> the "Still to open" bubble
// (Rooms & staff) -> Got it -> Close up shop -> 3 days away: the Morning Ledger,
// every line handled, All caught up. Then every screen opens and closes at 390
// and at 375 x 667, and an offline reload boots from the service worker.
//
// Asserts: at most 5 coach bubbles in the tour (debug.coachCount), none
// covering its anchor; at least 6 purchases with at most 10 minutes advanced;
// a third mixer; the shelf still closed at the end of session one, and its tag
// says "N vials waiting" once she has 6 colors; no console errors; no
// horizontal overflow at 390 and 375. Shelf and purify (mid-rewrite elsewhere)
// are only opened and checked for console errors.
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
  let viewW = WIDTH;

  async function overflow(label) {
    const w = await S(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    check(w <= viewW, `no horizontal overflow on ${label} at ${viewW} (scrollWidth ${w})`);
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

  /** A "what's next" card or other sheet left open: she dismisses it (Escape, like a backdrop tap). */
  async function dismissSheets() {
    for (let i = 0; i < 3; i++) {
      const open = await S(() => { const m = document.getElementById('modal'); return !!(m && !m.hidden); });
      if (!open) return;
      await page.keyboard.press('Escape');
      await wait(300);
    }
  }

  /** Close ceremonies (naming, phase beats) until a normal screen is on top. */
  async function clearCeremonies() {
    for (let i = 0; i < 8; i++) {
      await wait(300);
      await dismissSheets();
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

  /** The coach bubble on screen: its text, its anchor (by selector) and whether it covers it. */
  const bubble = (anchorSel) => S((sel) => {
    const tag = document.querySelector('#guide-layer .coach-tag');
    if (!tag) return null;
    const text = (tag.querySelector('.coach-text') || tag).textContent.trim();
    const a = sel ? [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length && !el.closest('[hidden]')) : null;
    let overlap = false;
    if (a) {
      const r = tag.getBoundingClientRect();
      let q = a.getBoundingClientRect();
      const box = a.closest('.screen-body');
      if (box) {
        const c = box.getBoundingClientRect();
        q = { left: Math.max(q.left, c.left), right: Math.min(q.right, c.right), top: Math.max(q.top, c.top), bottom: Math.min(q.bottom, c.bottom) };
      }
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
      const hh = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      overlap = w > 1 && hh > 1;
    }
    const ring = document.querySelector('#guide-layer .coach-ring');
    return { text, anchored: !!a, overlap, ring: !!ring, gotIt: !!tag.querySelector('[data-coach-action="ok"]') };
  }, anchorSel || '');

  async function waitBubble(re, anchorSel, ms = 4000) {
    const end = Date.now() + ms;
    for (;;) {
      const b = await bubble(anchorSel);
      if (b && re.test(b.text)) return b;
      if (Date.now() > end) return b;
      await wait(150);
    }
  }

  // The first session's clock: debug.advance is the only way time passes faster
  // than real time. During the session it moves in 45 s steps (under the 60 s
  // that would count as a break and run the offline catch-up).
  const SESSION_MS = 10 * 60e3;
  const TICK_MS = 45e3;
  let advanced = 0;
  const advance = async (ms) => { advanced += ms; await S((x) => window.tincture.debug.advance(x), ms); };
  // Every purchase she makes in the first session (Next taps that spend coins).
  const purchases = [];
  // debug.advance moves her clocks back rather than now forward, so the session
  // clock is real time since the welcome card plus everything advanced.
  let sessionStart = Date.now();
  const sessionClock = () => Date.now() - sessionStart + advanced;
  const beats = [];
  const beat = (name) => { beats.push({ at: sessionClock(), name }); };

  const discovered = () => S(() => Object.keys(window.tincture.game.state.catalog.discovered).length);
  const onboarding = () => S(() => JSON.parse(JSON.stringify(window.tincture.game.state.onboarding)));
  const coins = () => S(() => window.tincture.game.state.coins);
  const NEXT = `${sec('workshop')} [data-coach="next"]`;
  const nextInfo = () => S((sel) => {
    const b = document.querySelector(sel);
    return b ? { kind: b.dataset.kind || '', cost: Number(b.dataset.cost) || 0, wait: b.getAttribute('aria-disabled') === 'true', label: b.textContent.trim() } : null;
  }, NEXT);

  async function toWorkshop() {
    await clearCeremonies();
    if ((await topId()) !== 'workshop') {
      await page.click('#tabbar [data-tab="workshop"]');
      await waitTop('workshop');
    }
  }

  /** The recipe sheet is up: pick a color no mixer makes yet (orange first). */
  async function pickRecipe() {
    await wait(350);
    const id = await S(() => {
      const s = window.tincture.game.state;
      const making = new Set(s.stations.mixers.map((m) => m && m.recipe).filter(Boolean));
      const offered = [...document.querySelectorAll('[data-action="set-recipe"][data-color]')].map((b) => b.dataset.color).filter(Boolean);
      const fresh = offered.filter((c) => !making.has(c));
      return fresh.includes('orange') ? 'orange' : (fresh.find((c) => !['madder', 'ochre', 'woad'].includes(c)) || fresh[0] || offered[0] || null);
    });
    if (!id) return null;
    await page.click(`[data-action="set-recipe"][data-color="${id}"]`);
    await wait(400);
    return id;
  }

  let mixerBubble = null;
  /**
   * A round of Next taps in the Workshop: a recipe for an idle mixer, then any
   * purchase Next offers while she can afford it; Collect when the till has
   * coins. Returns how many purchases she made.
   */
  async function nextRound(label) {
    await toWorkshop();
    let n = 0;
    for (let guard = 0; guard < 20; guard++) {
      await clearCeremonies();
      if ((await topId()) !== 'workshop') await toWorkshop();
      const info = await nextInfo();
      if (!info) break;
      const before = await coins();
      if (info.kind === 'assign') {
        await page.click(NEXT);
        const picked = await pickRecipe();
        if (!picked) break;
        continue;
      }
      if (['upgrade', 'mixer', 'room'].includes(info.kind) && !info.wait && info.cost > 0 && info.cost <= before) {
        if (info.kind === 'mixer' && !mixerBubble) {
          mixerBubble = await waitBubble(/third mixer/i, NEXT, 2500);
          if (mixerBubble && /third mixer/i.test(mixerBubble.text)) await step('third-mixer-bubble');
        }
        await page.click(NEXT);
        await wait(300);
        await clearCeremonies();
        const after = await coins();
        if (!(after < before)) break;
        purchases.push({ at: sessionClock(), what: info.label, cost: before - after, label });
        if (info.kind === 'mixer') beat('third mixer bought');
        n++;
        continue;
      }
      const collect = page.locator(`${sec('workshop')} [data-action="collect"]:visible`);
      if (await collect.count()) { await collect.first().click({ force: true }); await wait(500); continue; }
      break;
    }
    return n;
  }

  // ---------------------------------------------------------------- 0:00 welcome
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.debug);
  await S(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.debug);
  await waitTop('onboarding');
  must(await page.isVisible(`${sec('onboarding')} [data-action="welcome-start"]`), 'fresh save opens the welcome card');
  await step('welcome');

  // ---------------------------------------------------------------- first order, named
  sessionStart = Date.now();
  await page.click(`${sec('onboarding')} [data-action="welcome-start"]`);
  await waitTop('orders');
  beat('welcome -> first order');
  must(await page.isVisible('[data-coach="first-order"]'), 'the first order is on the board');
  let b = await waitBubble(/neighbor would love orange/i, '[data-coach="first-order"]');
  check(!!b && /neighbor/i.test(b.text) && b.anchored && !b.overlap && !b.gotIt, `bubble 1 points at the first order, clear of it, no "Got it" (${JSON.stringify(b)})`);
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
  beat('orange named');
  check(await page.locator('#toasts .toast', { hasText: 'joins your catalog' }).count() === 0, 'no "joins your catalog" toast repeats the naming card');
  check(await S(() => window.tincture.game.state.orders.filledCount >= 1), 'the first order counts as filled');
  check(await S(() => window.tincture.game.state.stations.mixers[0].recipe === 'orange'), 'her orange goes straight onto Mixer 1');
  await step('named');
  await page.click(`${sec('matching')} [data-action="back-orders"]`);
  await waitTop('orders');

  // ---------------------------------------------------------------- 1:30 a Relaxed board in her own colors
  await page.waitForFunction(() => window.tincture.game.state.onboarding.step === 2, null, { timeout: 3000 }).catch(() => {});
  must((await onboarding()).step === 2, 'onboarding moved to the board beat (step 2)');
  b = await waitBubble(/calm puzzle/i, '#tabbar [data-tab="puzzles"]');
  check(!!b && /calm puzzle/i.test(b.text) && b.anchored && !b.overlap, `bubble 2 points at the Puzzles tab (${JSON.stringify(b)})`);
  await step('board-bubble-tab');
  await page.click('#tabbar [data-tab="puzzles"]');
  await waitTop('puzzles');
  const newBoard = `${sec('puzzles')} [data-coach="grading"] [data-action="new-grading"]:not([data-mode])`;
  b = await waitBubble(/calm puzzle/i, newBoard);
  check(!!b && b.anchored && !b.overlap, `bubble 2 moves onto New board, clear of it (${JSON.stringify(b)})`);
  await step('board-bubble');
  const colorsBeforeBoard = await discovered();
  await page.click(newBoard);
  await waitTop('grading');
  beat('first board');
  must(await S(() => !!window.tincture.game.state.activePuzzles.grading
    && window.tincture.game.state.activePuzzles.grading.tier === 'relaxed'), 'a Relaxed grading board is on the table');
  check(await S(() => {
    const g = window.tincture.game.state.activePuzzles.grading;
    return !g.event && (!g.shape || g.shape === 'rect');
  }), 'the first board is a plain rectangle in her own colors (no event palette or frame)');
  await wait(400);
  const overBoard = await bubble('');
  check(!overBoard, `no bubble over the board (${JSON.stringify(overBoard)})`);
  await step('grading-board');
  for (let guard = 0; guard < 80; guard++) {
    const mv = await S(() => {
      const g = window.tincture.game.state.activePuzzles.grading;
      if (!g) return null;
      for (let p = 0; p < g.order.length; p++) if (g.mask[p] && g.order[p] !== p) return [p, g.order.indexOf(p)];
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
  const named = await keepNames();
  must(named >= 1 && (await discovered()) === colorsBeforeBoard + 1, `the solved board revealed one tint (${await discovered()} colors)`);
  if ((await topId()) === 'grading') await page.click(`${sec('grading')} [data-back]`);
  await clearCeremonies();
  await page.waitForFunction(() => window.tincture.game.state.onboarding.step >= 3, null, { timeout: 3000 }).catch(() => {});
  must((await onboarding()).step === 3, 'the solved board moved onboarding to the Next beat (step 3)');

  // ---------------------------------------------------------------- 3:00 first upgrades through Next
  await page.click('#tabbar [data-tab="workshop"]');
  await waitTop('workshop');
  b = await waitBubble(/Next picks/i, NEXT);
  check(!!b && /Next picks/.test(b.text) && b.anchored && !b.overlap && !b.gotIt, `bubble 3 points at Next, clear of it (${JSON.stringify(b)})`);
  const nx = await nextInfo();
  check(!!nx && nx.cost <= (await coins()), `the Next bubble shows only when its price is within her coins (${JSON.stringify(nx)})`);
  await step('next-bubble');
  beat('first Next tap');
  let bought = await nextRound('first upgrades');
  check((await onboarding()).step >= 4, 'tapping Next ends the Next beat');
  check(!(await page.locator('#guide-layer .coach-tag', { hasText: 'Next picks' }).count()), 'the Next bubble is gone after the tap');

  // ---------------------------------------------------------------- 4:30-9:00 the third mixer, the board fills, Still to open
  // 8:00 Still to open: one quiet "Got it" bubble (on Rooms & staff, then on
  // the card once she taps it).
  const ROOMS_SEG = `${sec('workshop')} [data-segment="rooms"]`;
  const doors = `${sec('workshop')} [data-coach="doors"]`;
  let doorsDone = false;
  async function doorsBeat() {
    await toWorkshop();
    await S(() => { const bd = document.querySelector('#app > section[data-screen="workshop"] .screen-body'); if (bd) bd.scrollTop = 0; });
    let d = await waitBubble(/still to open/i, ROOMS_SEG);
    check(!!d && /still to open/i.test(d.text) && d.gotIt && d.anchored && !d.overlap, `bubble 5 is a quiet "Got it" on Rooms & staff (${JSON.stringify(d)})`);
    beat('Still to open');
    await step('doors-bubble-segment');
    // She taps Rooms & staff: the bubble moves onto the Still to open card.
    await page.click(ROOMS_SEG);
    await wait(400);
    await page.locator(doors).first().scrollIntoViewIfNeeded();
    await wait(400);
    d = await waitBubble(/still to open/i, doors);
    check(!!d && d.anchored && !d.overlap, `bubble 5 sits on the Still to open card, clear of it (${JSON.stringify(d)})`);
    check(await page.locator(`${sec('workshop')} [data-coach="mill-room"]`).count() > 0, 'the Mill Room goal is in Rooms & staff');
    const millText = (await page.locator(`${sec('workshop')} [data-coach="rooms"]`).first().textContent()).replace(/\s+/g, ' ').trim();
    check(/1\.5K|1,500/.test(millText) && /more colors?/i.test(millText), `the Mill Room shows its price and colors to go (${millText})`);
    const doorText = (await page.locator(doors).first().textContent()).replace(/\s+/g, ' ');
    check(/2\.5K/.test(doorText) && /8K/.test(doorText), `the window and door tags show their prices (${doorText.trim().slice(0, 120)}...)`);
    await step('doors-bubble');
    await page.click('#guide-layer [data-coach-action="ok"]');
    await wait(500);
    const o7 = await onboarding();
    must(o7.step === 7 && !o7.done, 'Got it moves onboarding to Close up shop (step 7)');
    check(!!o7.seen && o7.seen['first-ten'] === true, 'the first-ten guide is recorded in onboarding.seen');
    doorsDone = true;
  }

  let secondOrder = false;
  for (let i = 0; i < 30 && advanced + TICK_MS <= SESSION_MS - 15e3; i++) {
    if (!doorsDone && (await onboarding()).step >= 6) await doorsBeat();
    await advance(TICK_MS);
    await wait(150);
    bought += await nextRound(`after ${(advanced / 60e3).toFixed(1)} min`);
    if (process.env.E2E_VERBOSE) console.log('     ', (advanced / 60e3).toFixed(2), JSON.stringify(await nextInfo()), (await coins()).toFixed(1), JSON.stringify((await onboarding()).step), await S(() => window.tincture.ctx.format.rate(window.tincture.ctx.sim.economy.incomeRate(window.tincture.game.state, window.tincture.game.now()))));
    // The order board is full: she fills one more order, from its recipe.
    if (!secondOrder && (await S(() => window.tincture.game.state.stations.mixers.length)) >= 3) {
      secondOrder = true;
      await page.click('#tabbar [data-tab="orders"]');
      await waitTop('orders');
      const openOrders = await S(() => window.tincture.game.state.orders.open.length);
      check(openOrders >= 3, `the order board is full (${openOrders} open orders)`);
      await wait(400);
      check(!(await bubble('')), 'no bubble announces the full board or the order bench');
      beat('order board full');
      await step('orders-full');
      const next = await S(() => window.tincture.game.state.orders.open.find((x) => x.kind === 'match' && Array.isArray(x.recipe)));
      if (next) {
        const before = await coins();
        await page.click(`${sec('orders')} [data-action="open-match"][data-order="${next.id}"]`);
        await waitTop('matching');
        for (const r of next.recipe) {
          for (let k = 0; k < r.weight; k++) await page.click(`${sec('matching')} [data-drop="${r.pigment}"]`);
        }
        await wait(500);
        check(!(await bubble('')), 'no matching bubble during the tour');
        await page.click(`${sec('matching')} [data-action="submit"]`);
        await wait(900);
        await keepNames();
        check((await coins()) > before, 'a second order pays');
        if ((await topId()) === 'matching') await page.click(`${sec('matching')} [data-action="back-orders"]`);
        await clearCeremonies();
      }
    }
  }
  if (!doorsDone && (await onboarding()).step >= 6) await doorsBeat();
  must(doorsDone, `the Still to open beat came within the session (step ${(await onboarding()).step})`);
  const mixers = await S(() => window.tincture.game.state.stations.mixers.length);
  must(mixers >= 3, `the third mixer is in the workshop (${mixers} mixers)`);
  check(!!mixerBubble && /third mixer/i.test(mixerBubble.text) && mixerBubble.anchored && !mixerBubble.overlap,
    `bubble 4 announced the third mixer on Next (${JSON.stringify(mixerBubble)})`);
  await toWorkshop();
  await S(() => { const bd = document.querySelector('#app > section[data-screen="workshop"] .screen-body'); if (bd) bd.scrollTop = 0; });
  check(await S(() => document.querySelectorAll('#app > section[data-screen="workshop"] [data-jar]:not(.ws-off)').length) >= 3,
    'three mixer jars show in the Workshop scene');

  // ---------------------------------------------------------------- session one in numbers
  const coachCount = await S(() => window.tincture.debug.coachCount);
  const coachTexts = await S(() => window.tincture.debug.coachTexts);
  console.log(`     beats:\n       ` + beats.map((x) => `${(x.at / 60e3).toFixed(1)} min  ${x.name}`).join('\n       '));
  console.log(`     ${coachCount} coach bubbles:\n       ` + coachTexts.join('\n       '));
  console.log(`     first session: ${purchases.length} purchases in ${(sessionClock() / 60e3).toFixed(1)} min `
    + `(${(advanced / 60e3).toFixed(1)} min advanced), ${await discovered()} colors\n       `
    + purchases.map((p) => `${(p.at / 60e3).toFixed(1)} min  ${p.what} (${p.cost.toFixed(1)}; ${p.label})`).join('\n       '));
  check(coachCount <= 5, `at most 5 coach bubbles in the first session (${coachCount})`);
  check(coachCount >= 5, `every beat with a bubble showed it (${coachCount})`);
  check(advanced <= SESSION_MS, `the first session lets at most 10 minutes pass (${(advanced / 60e3).toFixed(1)} min advanced)`);
  check(purchases.length >= 6, `at least 6 purchases in the first ten minutes (${purchases.length})`);
  check(purchases.some((p) => /Mixer 3/.test(p.what)), 'the third mixer was bought through Next');
  check((await discovered()) >= 5, `5 colors at the end of session one (${await discovered()})`);
  check(await S(() => window.tincture.game.state.unlocks.shelf === false), 'the Merge Shelf is still closed at the end of session one');

  // ---------------------------------------------------------------- 9:00 Close up shop
  await page.click('#tabbar [data-tab="workshop"]');
  await waitTop('workshop');
  const closeUp = page.locator(`${sec('workshop')} [data-coach="close-up"]`);
  must(await closeUp.count() > 0, 'Close up shop is at the foot of the Workshop');
  await closeUp.first().scrollIntoViewIfNeeded();
  await wait(300);
  check(!(await page.locator('#guide-layer .coach-tag').count()), 'no bubble on Close up shop');
  await step('close-up');
  await closeUp.first().click();
  await wait(600);
  const go = page.locator(`${sec('workshop')} [data-action="cu-go"]`);
  must(await go.count() > 0, 'Close up shop asks to confirm in a sheet');
  await shot('close-up-sheet');
  await go.first().click();
  await wait(2200); // evening chord and the dusk dim
  beat('closed up');
  const after = await onboarding();
  must(after.done === true, 'Close up shop ends the first session (onboarding done)');
  must(await S(() => window.tincture.game.state.stats.lastCloseUpAt > 0), 'the shop is closed up');
  await step('closed-up');
  await clearCeremonies();

  // The closed shelf collects vials behind its glass once she has 6 colors.
  for (const id of ['green', 'purple', 'vermilion', 'teal']) {
    if ((await discovered()) >= 6) break;
    await S((c) => window.tincture.debug.discover(c), id);
    await keepNames();
  }
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
        const btn = page.locator(`${sec(id)} ${sel}:visible`);
        if (!(await btn.count())) return;
        try {
          await btn.first().click({ timeout: 3000 }); // screens re-render as stock changes: retry on a fresh node
        } catch (e) { await wait(300); continue; }
        await wait(350);
        await clearCeremonies();
        const ok = page.locator('#modal:not([hidden]) .btn-primary, #modal:not([hidden]) [data-value]');
        if (await ok.count()) { await ok.first().click(); await wait(250); }
        const sheetOk = page.locator('.sheet [data-action="confirm"]:visible, .sheet .btn-primary:visible');
        if (id === 'puzzles' && await sheetOk.count()) { await sheetOk.first().click(); await wait(250); }
      }
    };
    if (id === 'workshop') await clickAll('[data-action="claim-accident"]');
    if (id === 'puzzles') await clickAll('[data-action="sell-muddy"], [data-action="sell-all-muddy"]');
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
    const sheetClose = page.locator(`${sec('workshop')} [data-sheet-close]:visible`);
    if (await sheetClose.count()) { await sheetClose.first().click(); await wait(250); }
    await S(() => { const bd = document.querySelector('#app > section[data-screen="workshop"] .screen-body'); if (bd) bd.scrollTop = 0; });
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

  // The shelf tag: "N vials waiting" behind the closed glass (6+ colors).
  await toWorkshop();
  await S(() => { const bd = document.querySelector('#app > section[data-screen="workshop"] .screen-body'); if (bd) bd.scrollTop = 0; });
  await wait(300);
  const shelfState = await S(() => ({ open: window.tincture.game.state.unlocks.shelf, waiting: window.tincture.game.state.shelf.waiting }));
  const waitingTag = await S(() => {
    const t = document.querySelector('#app > section[data-screen="workshop"] .ws-waiting');
    return t ? t.textContent.trim() : '';
  });
  check(!shelfState.open && shelfState.waiting > 0 && /^\d+ vials? waiting$/.test(waitingTag),
    `with ${await discovered()} colors the closed shelf's tag reads "N vials waiting" (${JSON.stringify({ ...shelfState, waitingTag })})`);
  await step('shelf-vials-waiting');

  // ---------------------------------------------------------------- every screen opens and closes (390, then 375 x 667)
  // Shelf and purify are being rewritten elsewhere: they are opened and checked
  // for console errors only.
  const ERRORS_ONLY = new Set(['shelf', 'purify']);
  async function screenWalk(tag) {
    for (const id of ALL_SCREENS) {
      if (id === 'onboarding') continue; // the welcome card is a ceremony checked at boot
      const params = id === 'naming' ? { colorId: 'orange', suggestedName: 'Harbor Sunset' }
        : id === 'phase-beat' ? { kind: 'room', id: 'mill-room' } : {};
      await S(([x, p]) => window.tincture.ctx.navigate(x, p), [id, params]);
      await wait(350);
      if (ERRORS_ONLY.has(id)) {
        await shot(`${tag}-screen-${id}`);
        noNewErrors(`${tag} screen ${id}`);
        for (let i = 0; i < 4 && (await S((x) => window.tincture.router.isOpen(x), id)); i++) {
          await S(() => window.tincture.router.back());
          await wait(200);
        }
        await clearCeremonies();
        continue;
      }
      const visible = await S((x) => {
        const el = document.querySelector(`#app > section[data-screen="${x}"]`);
        return !!(el && !el.hidden && el.getBoundingClientRect().height > 0 && el.textContent.trim().length > 0);
      }, id);
      if (id === 'paint' && !(await S(() => (window.tincture.game.state.gallery.pieces || []).some((p) => !p.signedAt)))) {
        // Painting needs a piece on the easel; with none it closes and points her to the Gallery.
        check(!(await S(() => window.tincture.router.isOpen('paint'))), `${tag}: paint with no piece on the easel closes itself`);
        check((await topId()) === 'gallery', `${tag}: paint with no piece opens the Gallery`);
        noNewErrors(`${tag} screen paint`);
        await S(() => window.tincture.router.back());
        await wait(200);
        continue;
      }
      check(visible, `${tag}: ${id} opens and shows content`);
      if (TABS.includes(id)) {
        check(await S(() => { const tb = document.getElementById('tabbar'); return tb && !tb.hidden; }), `${tag}: ${id} keeps the tab bar`);
      }
      await shot(`${tag}-screen-${id}`);
      await overflow(`${tag} screen ${id}`);
      noNewErrors(`${tag} screen ${id}`);
      if (TABS.includes(id)) continue;
      for (let i = 0; i < 4 && (await S((x) => window.tincture.router.isOpen(x), id)); i++) {
        await S(() => window.tincture.router.back());
        await wait(200);
      }
      check(!(await S((x) => window.tincture.router.isOpen(x), id)), `${tag}: ${id} closes`);
      await clearCeremonies();
    }
    for (const id of TABS) {
      await page.click(`#tabbar [data-tab="${id}"]`);
      await wait(250);
      check((await topId()) === id, `${tag}: tab ${id} opens from the tab bar`);
    }
    noNewErrors(`${tag} screen walk`);
  }
  await screenWalk('390');
  viewW = 375;
  await page.setViewportSize({ width: 375, height: 667 });
  await wait(300);
  await screenWalk('375');
  viewW = WIDTH;
  await page.setViewportSize({ width: WIDTH, height: 844 });
  await wait(300);

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
