// Tincture — test/tangle.e2e.mjs
// The Tangle Basket walked end to end in headless Chromium with real touch
// input (isMobile, hasTouch, DPR 2) at 390x844 and 360x740:
//  - from the workshop: the unlock sheet buys it, the short ceremony plays in
//    the scene, and a two-choice card offers the way in;
//  - from the Puzzles hub: the card shows the price, buying it there opens the
//    card's "Go to the basket";
//  - the guide: its first step is the action itself (no Got it), then two
//    short information steps; it is marked seen;
//  - basket 1 untangled by taps on its strands (the stored solution), with a
//    reload in the middle that resumes exactly; the finish sheet: coins land
//    (state and the reward line);
//  - the basket list: 11 chapters, ticks, the next basket highlighted, locked
//    baskets later on, and Continue;
//  - a snarl: a tap on a covered snarled strand lights both, and a tap once it
//    is free pulls both together;
//  - the last and biggest basket: a two-finger pinch zooms in (CDP touch
//    events), a tap pulls a strand while zoomed in, Fit goes back; measured at
//    a 4x CPU throttle (heap frames, slither frames, gesture handling, build);
//  - 44 px controls, no horizontal scroll, the tab bar hidden, no page or
//    console errors.
// Run: node test/tangle.e2e.mjs   (screenshots: $TANGLE_SHOTS or the OS temp dir)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.TANGLE_SHOTS || path.join(os.tmpdir(), 'tincture-tangle-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

function loadPlaywright() {
  for (const base of ['/opt/node-tools/node_modules/', path.join(ROOT, 'node_modules/')]) {
    try { const pw = createRequire(base)('playwright'); if (pw && pw.chromium) return pw; } catch (e) { /* next */ }
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

const pw = loadPlaywright();
if (!pw) { console.log('SKIP tangle.e2e: Playwright not found'); process.exit(0); }

const PORT = await freePort();
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; return ok; };
const must = (ok, label) => { if (!check(ok, label)) throw new Error('stopped at: ' + label); };
let browser = null;
const PERF_OUT = {};

// ---------------------------------------------------------------------------
// Helpers (all taps are real touch events)
// ---------------------------------------------------------------------------

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

const idle = (page, ms = 15000) => page.waitForFunction(() => window.__tb && !window.__tb.debugTangle().busy, null, { timeout: ms });
const tState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.tangle)));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__tb = await import('./src/ui/tangle.js'); });
}

/** A workshop well on its way: 29 colors (silently), coins, two mixers running, the other rooms open, their guides done. */
async function seed(page, { coins = 9600 } = {}) {
  await page.evaluate((coinsAt) => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.settings.responsibleMode = false; // replays the room far more than 5 times (test/limits.e2e.mjs covers the mode)
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true, skeins: true, lift: true, garden: true, tiles: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 29) break;
        if (st.catalog.discovered[c.id]) continue;
        st.catalog.discovered[c.id] = { at: now, name: ctx.content.getColor(c.id).name, custom: false, essence: 0 };
      }
      st.coins = coinsAt;
      st.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
      return {};
    }, {});
    game.save();
  }, coins);
}

/** Open the basket and mark baskets before `upto` untangled, every intro card seen, the guide seen. */
async function openUpTo(page, upto) {
  await page.evaluate((id) => {
    const { game, ctx } = window.tincture;
    game.act((st) => {
      st.unlocks.tangle = true;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), tangle: true };
      const ids = ctx.puzzles.tangleLevels.LEVEL_IDS;
      st.tangle = st.tangle || {};
      st.tangle.done = {};
      for (const x of ids.slice(0, ids.indexOf(id))) st.tangle.done[x] = 1;
      st.tangle.seenIntro = Object.fromEntries(Object.keys(ctx.puzzles.tangleLevels.MECHANICS).map((m) => [m, true]));
      st.tangle.cur = id;
      st.tangle.game = null;
      return {};
    }, {});
    game.act(ctx.sim.tangle.startBasket, { levelId: id, fresh: true });
    game.save();
  }, upto);
}

async function geometry(page, label) {
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-tangle');
    const body = sec.querySelector('.screen-body');
    const small = [...sec.querySelectorAll('.btn, .btn-back, .tb-iconbtn, .tb-fitbtn')]
      .filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
      .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    const msg = sec.querySelector('.tb-msgrow');
    const mr = msg ? msg.getBoundingClientRect() : null;
    const heap = sec.querySelector('#tb-heapWrap');
    const hr = heap ? heap.getBoundingClientRect() : null;
    const tab = document.getElementById('tabbar');
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      msgBottom: mr ? mr.bottom : -1, vh: innerHeight, heapW: hr ? hr.width : 0, vw: innerWidth,
      tabHidden: !tab || tab.hidden || tab.getBoundingClientRect().height === 0,
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.msgBottom > 0 && g.msgBottom <= g.vh + 0.5, `${label}: Hint and Undo sit inside the viewport (${Math.round(g.msgBottom)} <= ${g.vh})`);
  check(g.heapW >= 200 && g.heapW <= g.vw, `${label}: the basket fits the width (${Math.round(g.heapW)} px)`);
  check(g.tabHidden, `${label}: the tab bar is hidden under the basket`);
  check(g.small.length === 0, `${label}: every control is at least 44 px (${JSON.stringify(g.small.slice(0, 3))})`);
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) || /net::ERR_FAILED/.test(m.text())) return;
    errors.push('console.error: ' + m.text());
  });
  return errors;
}

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  return { context, page };
}

/** Tap strand i where it lies most in the open (a real touch), then wait for the slither to land. Returns the moves after. */
async function tapStrand(page, i) {
  const p = await page.evaluate((k) => window.__tb.debugTangle().pointOf(k), i);
  if (!p) return null;
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(40);
  await idle(page);
  return (await tState(page)).game.moves;
}

/** Two fingers on the heap (CDP touch events): from `d0` px apart to `d1`, about its middle. */
async function pinch(page, cdp, d0, d1, steps = 10) {
  const r = await page.evaluate(() => { const b = document.querySelector('#tb-heapWrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.45 }; });
  const pts = (d) => [{ x: r.x - d / 2, y: r.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }, { x: r.x + d / 2, y: r.y + 6, id: 2, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * k) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function gotIt(page) {
  for (let k = 0; k < 3; k++) {
    const b = page.locator('#guide-layer [data-coach-action]');
    if (!(await b.count())) return k;
    await tap(page, b);
    await page.waitForTimeout(250);
  }
  return 3;
}

const pct = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

// ---------------------------------------------------------------------------
// The walks
// ---------------------------------------------------------------------------

/** From the workshop: the unlock sheet buys it, the ceremony plays, a two-choice card offers the way in. */
async function workshopWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.evaluate(() => { window.tincture.game.act((st) => { for (const k of ['shelf', 'hunters', 'skeins', 'lift', 'tiles', 'garden']) st.unlocks[k] = true; return {}; }, {}); window.tincture.game.save(); });
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.waitForSelector('#screen-workshop [data-action="next"]', { state: 'visible' });
  await page.waitForTimeout(400);
  const label = (await page.locator('#screen-workshop [data-action="next"]').textContent()).trim();
  if (/Tangle Basket/.test(label)) {
    check(/9(,000|K)/.test(label), `${tag}: the workshop's Next names the Tangle Basket ("${label}")`);
    await tap(page, '#screen-workshop [data-action="next"]');
  } else {
    // Next may point at a room or an upgrade first: open the basket's sheet the way its price tag does.
    await page.evaluate(async () => { const w = await import('./src/ui/workshop.js'); w.openUnlockSheet(window.tincture.ctx, 'tangle'); });
  }
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await page.waitForTimeout(300);
  check(/Tangle Basket/.test(await page.locator('.ws-unlock-name').first().textContent()), `${tag}: the "What this opens" sheet names the Tangle Basket`);
  await shot('w1-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForTimeout(450);
  check(await page.locator('.ws-cer').count() === 1, `${tag}: the unlock ceremony plays in the scene`);
  await shot('w2-ceremony');
  check(await page.evaluate(() => window.tincture.game.state.unlocks.tangle === true), `${tag}: bought from the workshop`);
  const go = page.locator('[data-overlay-action]', { hasText: 'Go to the basket' });
  await go.waitFor({ state: 'visible', timeout: 6000 });
  await shot('w3-whats-next');
  await tap(page, go);
  await page.waitForSelector('#screen-tangle #tb-heap', { state: 'visible' });
  check(true, `${tag}: "Go to the basket" opens the basket`);
  await page.waitForTimeout(600);
  await shot('w4-basket');
  await geometry(page, `${tag} basket`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** From the Puzzles hub: price, purchase, the guide, basket 1 by taps with a reload mid-way, the finish, the list. */
async function walk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  // --- the hub card and the unlock ------------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-tangle', { state: 'visible' });
  must(await page.locator('#pz-tangle [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Tangle Basket card carries the price button`);
  check(/9(,000|K)/.test(await page.locator('#pz-tangle').textContent()), `${tag}: the price reads 9K`);
  await page.evaluate(() => document.querySelector('#pz-tangle').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-tangle [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  const coins0 = await page.evaluate(() => window.tincture.game.state.coins);
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.tangle === true);
  const coins1 = await page.evaluate(() => window.tincture.game.state.coins);
  check(coins0 - coins1 > 8999 && coins0 - coins1 < 9100, `${tag}: buying the Tangle Basket spent 9,000 coins (${Math.round(coins0 - coins1)})`);
  await page.waitForSelector('#pz-tangle [data-action="open-tangle"]', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#pz-tangle').scrollIntoView({ block: 'center' }));
  await shot('03-hub-open');

  // --- the basket and the guide ---------------------------------------------------------------
  await tap(page, '#pz-tangle [data-action="open-tangle"]');
  await page.waitForSelector('#screen-tangle #tb-heap', { state: 'visible' });
  await idle(page);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Tap a raised strand/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button (no steps before her first action)`);
  check(await page.locator('#screen-tangle .tb-sheet:not([hidden])').count() === 0, `${tag}: no sheet over the basket on the first visit`);
  await shot('04-guide-1');
  await geometry(page, `${tag} basket 1`);

  const L = await page.evaluate(() => { const l = window.tincture.ctx.puzzles.tangleLevels.levelById('first'); return { solution: l.solution.split(' ').map(Number), n: l.n }; });
  const quote = await page.evaluate(() => window.tincture.ctx.sim.tangle.quote(window.tincture.game.state, 'first', window.tincture.game.now()));

  // First pull by hand so the guide follows it.
  let moves = await tapStrand(page, L.solution[0]);
  check(moves && moves.length === 1 && moves[0] === L.solution[0], `${tag}: a touch on a raised strand pulls it (${JSON.stringify(moves)})`);
  await page.waitForTimeout(300);
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/spool/.test(bubble2), `${tag}: the second step explains the spools ("${(bubble2 || '').trim()}")`);
  await shot('05-first-pull');
  const gots = await gotIt(page);
  check(gots === 2, `${tag}: two short information steps after the action (${gots})`);
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.tangle), `${tag}: the guide is marked seen`);

  // A covered strand: a wiggle, the one on top glows, a line says so.
  const coveredI = await page.evaluate(() => {
    const { ctx, game } = window.tincture;
    const cur = ctx.sim.tangle.current(game.state);
    for (let i = 0; i < cur.L.n; i++) if (ctx.puzzles.tangle.whyNot(cur.L, cur.s, i)?.reason === 'covered') return i;
    return -1;
  });
  if (coveredI >= 0) {
    await tapStrand(page, coveredI);
    const dbg = await page.evaluate(() => ({ g: window.__tb.debugTangle().glowing, note: window.__tb.debugTangle().note, moves: window.tincture.game.state.tangle.game.moves.length }));
    check(dbg.moves === 1 && dbg.g.length >= 1 && /lies? over/.test(dbg.note), `${tag}: a covered strand stays and what lies on it glows ("${dbg.note}")`);
  }

  for (const m of L.solution.slice(1, 3)) moves = await tapStrand(page, m);
  check(moves && moves.length === 3, `${tag}: three pulls by touch (${JSON.stringify(moves)})`);
  // A tap mid-slither then a reload: the pull is saved the moment it is made.
  const p3 = await page.evaluate((k) => window.__tb.debugTangle().pointOf(k), L.solution[3]);
  await page.touchscreen.tap(p3.x, p3.y);
  await page.waitForTimeout(150);
  await shot('06-mid-slither');
  const before = await tState(page);
  const beforeRules = await page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.ctx.sim.tangle.current(window.tincture.game.state).s)));
  check(before.game.moves.length === 4, `${tag}: every pull is saved as it is made (${before.game.moves.length})`);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  const after = await tState(page);
  check(JSON.stringify(after.game) === JSON.stringify(before.game), `${tag}: a reload mid-basket keeps the pulls and her yarns exactly`);
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForSelector('#pz-tangle [data-action="open-tangle"]', { state: 'visible' });
  const card = (await page.locator('#pz-tangle').textContent()).replace(/\s+/g, ' ');
  check(/Continue untangling/.test(card) && /2 strands to go/.test(card), `${tag}: the hub card shows the basket at a glance ("${card.trim().slice(0, 90)}")`);
  await page.evaluate(() => document.querySelector('#pz-tangle').scrollIntoView({ block: 'center' }));
  await shot('07-hub-continue');
  await tap(page, '#pz-tangle [data-action="open-tangle"]');
  await page.waitForSelector('#screen-tangle #tb-heap', { state: 'visible' });
  await idle(page);
  const resumed = await page.evaluate(() => ({
    rules: JSON.parse(JSON.stringify(window.tincture.ctx.sim.tangle.current(window.tincture.game.state).s)),
    screen: JSON.parse(JSON.stringify(window.__tb.debugTangle().state)),
    shelf: document.querySelector('#tb-shelfCount').textContent,
    spools: document.querySelectorAll('#tb-rack .tb-spool').length,
  }));
  check(JSON.stringify(resumed.rules) === JSON.stringify(beforeRules) && JSON.stringify(resumed.screen) === JSON.stringify(beforeRules), `${tag}: the basket resumes exactly where it was`);
  check(resumed.shelf.includes(String(beforeRules.skeins.length)) && resumed.spools === beforeRules.rack.filter(Boolean).length, `${tag}: rack and shelf drawn as saved`);
  await shot('08-resumed');

  // Undo and hint.
  await tap(page, '#tb-undoBtn');
  await idle(page);
  check((await tState(page)).game.moves.length === 3, `${tag}: Undo takes back one pull`);
  await tap(page, '#tb-hintBtn');
  await page.waitForTimeout(200);
  const hn = await page.evaluate(() => ({ h: window.__tb.debugTangle().hinted, msg: document.querySelector('#tb-msg').textContent }));
  check(hn.h >= 0 && /^Try this .*strand next/.test(hn.msg), `${tag}: Hint lights a strand ("${hn.msg}")`);
  await shot('09-hint');

  // The rest of basket 1 by taps.
  for (const m of L.solution.slice(3)) await tapStrand(page, m);
  await page.waitForSelector('#tb-finishSheet:not([hidden])', { state: 'visible', timeout: 8000 });
  const fin = await page.evaluate(() => ({ st: JSON.parse(JSON.stringify(window.tincture.game.state)), title: document.querySelector('#tb-finTitle').textContent, reward: document.querySelector('#tb-finReward').textContent }));
  check(/First tangle: all untangled/.test(fin.title), `${tag}: the finish sheet ("${fin.title}")`);
  check(fin.st.tangle.done.first === 1 && fin.st.tangle.untangled === 1, `${tag}: basket 1 is recorded as untangled`);
  check(fin.st.tangle.last.coins > 0 && Math.abs(fin.st.tangle.last.coins - quote.coins) / quote.coins < 0.05, `${tag}: coins landed (${fin.st.tangle.last.coins.toFixed(1)}, quoted ${quote.coins.toFixed(1)})`);
  check(/\+\d[\d.,K]* coins?/.test(fin.reward), `${tag}: the reward line names the coins ("${fin.reward.replace(/\s+/g, ' ').trim()}")`);
  await page.waitForTimeout(700);
  await shot('10-finish');

  // The list from the finish sheet: chapters, ticks, the next basket, locks, Continue.
  await tap(page, '#tb-finAll');
  await page.waitForSelector('#tb-levelSheet:not([hidden])', { state: 'visible' });
  const list = await page.evaluate(() => ({
    chapters: [...document.querySelectorAll('#tb-lvList .tb-band')].map((x) => x.textContent),
    items: document.querySelectorAll('#tb-lvList [data-level]').length,
    ticks: document.querySelectorAll('#tb-lvList .tb-tick').length,
    next: [...document.querySelectorAll('#tb-lvList .tb-next')].map((b) => b.dataset.level),
    locked: document.querySelectorAll('#tb-lvList .tb-locked').length,
    canvases: document.querySelectorAll('#tb-lvList canvas').length,
    cont: document.querySelector('#tb-continueBtn').textContent,
    total: window.tincture.ctx.puzzles.tangleLevels.LEVELS.length,
  }));
  check(list.chapters.length === 11 && /Odds and ends/.test(list.chapters[0]) && /dye pots/i.test(list.chapters[10]), `${tag}: 11 chapters (${list.chapters.map((c) => c.split('·')[1] || c).slice(0, 4).join(' | ')} …)`);
  check(list.items === list.total && list.total >= 100, `${tag}: every basket listed (${list.items})`);
  check(list.ticks === 1, `${tag}: basket 1 carries its tick`);
  check(list.next.length === 1 && list.next[0] === 'scraps', `${tag}: the next basket is highlighted (${list.next})`);
  check(list.locked === list.total - 2 && list.canvases === 2, `${tag}: later baskets wait behind a lock (${list.locked} locked, ${list.canvases} drawn)`);
  check(/Continue: 2 · A handful of scraps/.test(list.cont), `${tag}: Continue names the next basket ("${list.cont}")`);
  await page.waitForTimeout(350);
  await shot('11-list');
  await tap(page, '#tb-lvList [data-level="leftovers"]');
  check(/opens once basket 2/.test(await page.locator('#tb-lvHint').textContent()), `${tag}: a locked basket says when it opens`);
  await tap(page, '#tb-continueBtn');
  await page.waitForSelector('#tb-levelSheet', { state: 'hidden' });
  await idle(page);
  check((await tState(page)).cur === 'scraps', `${tag}: Continue opens basket 2`);
  await geometry(page, `${tag} basket 2`);
  await shot('12-basket-2');

  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** A snarl: tap a covered snarled strand (both light up), then pull the pair together by touch. */
async function snarlWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  // The first basket whose snarl of two is still held when it starts (Interlocked's own snarl lies free).
  const info = await page.evaluate(() => {
    const { LEVELS } = window.tincture.ctx.puzzles.tangleLevels;
    const R = window.tincture.ctx.puzzles.tangle;
    for (const L of LEVELS.slice(9)) {
      const sol = L.solution.split(' ').map(Number);
      const s0 = R.newState(L);
      for (const sn of L.snarls) {
        if (sn.length !== 2 || !R.whyNot(L, s0, sn[0])) continue;
        return { id: L.id, name: L.name, sn, sol, at: sol.findIndex((m) => sn.includes(m)) };
      }
    }
    return {};
  });
  must(info.sn && info.at > 0, `${tag}: "${info.name}" has a snarl of two that starts held`);
  await openUpTo(page, info.id);
  await page.evaluate(() => window.tincture.ctx.navigate('tangle'));
  await page.waitForSelector('#screen-tangle #tb-heap', { state: 'visible' });
  await idle(page);
  await geometry(page, `${tag} snarl basket`);
  // While something still lies on it: a tap lights both strands of the snarl.
  const heldNow = await page.evaluate((sn) => { const { ctx, game } = window.tincture; const cur = ctx.sim.tangle.current(game.state); return ctx.puzzles.tangle.whyNot(cur.L, cur.s, sn[0])?.reason || null; }, info.sn);
  check(!!heldNow, `${tag}: the snarl is held at the start (${heldNow})`);
  if (heldNow) {
    await tapStrand(page, info.sn[0]);
    const d = await page.evaluate(() => ({ tapped: window.__tb.debugTangle().tapped, note: window.__tb.debugTangle().note }));
    check(info.sn.every((m) => d.tapped.includes(m)) && /snarled together/.test(d.note), `${tag}: a tap on a snarled strand lights both ("${d.note}")`);
    await page.waitForTimeout(250);
    await shot('20-snarl-lit');
  }
  // Pull everything before it (through the sim), then the snarl by touch.
  await page.evaluate((pre) => { const { game, ctx } = window.tincture; for (const m of pre) game.act(ctx.sim.tangle.pull, { strand: m }); }, info.sol.slice(0, info.at));
  await page.waitForTimeout(300);
  await idle(page);
  const before = (await tState(page)).game.moves.length;
  await tapStrand(page, info.sn[1]);
  const st = await page.evaluate((sn) => { const { ctx, game } = window.tincture; const cur = ctx.sim.tangle.current(game.state); return { out: sn.map((m) => cur.s.out[m]), n: game.state.tangle.game.moves.length }; }, info.sn);
  check(st.n === before + 1 && st.out.every((x) => x === 1), `${tag}: one touch pulls the snarl out together (${JSON.stringify(st)})`);
  await shot('21-snarl-out');
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** The last, biggest basket: pinch to zoom, a pull while zoomed, Fit; timings at a 4x CPU throttle. */
async function deepWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  const last = await page.evaluate(() => {
    const ls = window.tincture.ctx.puzzles.tangleLevels.LEVELS;
    let big = ls[0];
    for (const L of ls) if (L.n > big.n || (L.n === big.n && L.board.w > big.board.w)) big = L;
    return { id: ls[ls.length - 1].id, biggest: big.id, n: big.n, w: big.board.w };
  });
  await openUpTo(page, last.biggest);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.evaluate(() => window.tincture.ctx.navigate('tangle'));
  await page.waitForSelector('#screen-tangle #tb-heap', { state: 'visible' });
  await idle(page);
  await page.waitForFunction(() => window.__tb.debugTangle().perf.frames >= 1, null, { timeout: 30000 });
  const openMs = Date.now() - t0;
  await page.waitForTimeout(800);
  await geometry(page, `${tag} ${last.biggest} (${last.n} strands)`);
  await shot('30-deep-fit');
  const build = await page.evaluate((id) => {
    const L = window.tincture.ctx.puzzles.tangleLevels.levelById(id);
    const c = window.tincture.ctx.puzzles.tangleLevels.levelById('everything');
    c.release();
    const a = performance.now(); void c.cross; const b = performance.now();
    return { buildMs: b - a, n: L.n };
  }, last.biggest);
  const bench = await page.evaluate(() => window.__tb.debugTangle().bench(5));
  await page.evaluate(() => window.__tb.debugTangle().resetPerf());

  // Pinch: two fingers spread apart.
  await pinch(page, cdp, 60, 190, 12);
  await page.waitForTimeout(200);
  const v1 = await page.evaluate(() => window.__tb.debugTangle().view);
  check(v1.z > 1.6, `${tag}: a two-finger pinch zooms in (z ${v1.z.toFixed(2)})`);
  await page.waitForFunction(() => window.__tb.debugTangle().perf.rasterLeft === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  await shot('31-deep-zoomed');
  const gesture = await page.evaluate(() => window.__tb.debugTangle().perf.gesture);
  // A pull by touch while zoomed in.
  const pick = await page.evaluate(() => {
    const { ctx, game } = window.tincture;
    const cur = ctx.sim.tangle.current(game.state);
    const d = window.__tb.debugTangle();
    for (let i = 0; i < cur.L.n; i++) if (ctx.puzzles.tangle.canPull(cur.L, cur.s, i) && d.pointOf(i)) return i;
    return -1;
  });
  must(pick >= 0, `${tag}: a pullable strand in the zoomed window`);
  await page.evaluate(() => window.__tb.debugTangle().resetPerf());
  const n0 = (await tState(page)).game.moves.length;
  const moves = await tapStrand(page, pick);
  check(moves && moves.length === n0 + 1, `${tag}: a touch pulls strand ${pick} while zoomed in`);
  const pullPerf = await page.evaluate(() => { const p = window.__tb.debugTangle().perf; return { heap: p.heap, fly: p.fly }; });
  await shot('32-deep-pulled');
  // Fit goes back to the whole basket.
  await tap(page, '#tb-fitBtn');
  await page.waitForTimeout(500);
  const v2 = await page.evaluate(() => window.__tb.debugTangle().view);
  check(v2.z <= 1.001, `${tag}: Fit shows the whole basket again`);
  const mb = await page.evaluate(() => window.__tb.debugTangle().spriteMB);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  PERF_OUT[tag] = {
    basket: `${last.biggest} (${build.n} strands, board ${last.w} x ${Math.round(last.w * 1.4)})`, throttle: '4x CPU', openMs,
    buildMs: +build.buildMs.toFixed(1), cacheRebuildMs: +bench.rebuild.toFixed(1), fullFrameMs: +bench.frame.toFixed(1),
    gestureMoveMs: { median: +pct(gesture, 0.5).toFixed(2), p95: +pct(gesture, 0.95).toFixed(2), n: gesture.length },
    heapFrameMsDuringPull: { median: +pct(pullPerf.heap, 0.5).toFixed(1), p95: +pct(pullPerf.heap, 0.95).toFixed(1), n: pullPerf.heap.length },
    slitherFrameMs: { median: +pct(pullPerf.fly, 0.5).toFixed(1), p95: +pct(pullPerf.fly, 0.95).toFixed(1), n: pullPerf.fly.length },
    spriteMB: +mb.toFixed(1),
  };
  console.log(`perf ${tag}: ${JSON.stringify(PERF_OUT[tag])}`);
  check(pct(gesture, 0.95) < 4, `${tag}: a pinch moves only a CSS transform (p95 ${pct(gesture, 0.95).toFixed(2)} ms per move at 4x)`);
  check(pct(pullPerf.fly, 0.5) < 34, `${tag}: the slither stays smooth at 4x (median ${pct(pullPerf.fly, 0.5).toFixed(1)} ms a frame)`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

try {
  try { browser = await pw.chromium.launch({ executablePath: CHROMIUM }); } catch (e) {
    browser = await pw.chromium.launch();
  }
  await waitForServer(URL_);
  // TANGLE_ONLY=workshop,walk,snarl,deep runs just those walks.
  const only = process.env.TANGLE_ONLY ? process.env.TANGLE_ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  if (want('workshop')) await workshopWalk({ width: 390, height: 844 }, '390');
  if (want('walk')) await walk({ width: 390, height: 844 }, '390');
  if (want('walk')) await walk({ width: 360, height: 740 }, '360');
  if (want('snarl')) await snarlWalk({ width: 390, height: 844 }, '390');
  if (want('deep')) await deepWalk({ width: 390, height: 844 }, '390');
  if (want('deep')) await deepWalk({ width: 360, height: 740 }, '360');
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Tangle Basket checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
