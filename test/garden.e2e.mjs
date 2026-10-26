// Tincture — test/garden.e2e.mjs
// The Dye Garden walked end to end in headless Chromium with touch input
// (isMobile, hasTouch, DPR 2) at 390x844 (full motion) and 360x740 (reduced motion):
//  - the Puzzles hub card shows the price; buying it there opens the garden;
//  - the guide: its first step is an action (Wander), then steer, then the bar;
//  - a Wander visit steered by real touch drags (CDP touch events): plants come
//    in, the page never scrolls, the HUD has no jar/bottle row (only Head home
//    at the bottom) and the bonus goal sits under the growth bar;
//  - leave mid-visit and "Keep wandering" resumes it; then the visit runs to
//    the end (autopilot with a faster clock) and the end card shows the haul,
//    the coins and the jars for the shelves; coins and stock land in the save;
//  - a short harvest before dusk (debug speed-up): the sun pill, dusk brings the
//    basket home, the score and a best; leaving a harvest early banks it;
//  - the Garden Path: its card on the places, the path list (nine chapters,
//    108 numbered gardens, done ticks and stars, the next one highlighted), a
//    garden card with its goal and the intro of what is new, a path garden
//    steered by touch, left and continued, its goal met (the next garden opens
//    at once), the end card's stars and "Next garden"; then a later garden's
//    new mechanic (the stream: floating flowers caught);
//  - the Map's Dye Garden card opens the garden;
//  - 44 px controls, no horizontal scroll, no page errors.
// Run: node test/garden.e2e.mjs   (screenshots: $GARDEN_SHOTS or the OS temp dir)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.GARDEN_SHOTS || path.join(os.tmpdir(), 'tincture-garden-e2e');
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
if (!pw) { console.log('SKIP garden.e2e: Playwright not found'); process.exit(0); }

const PORT = await freePort();
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; return ok; };
const must = (ok, label) => { if (!check(ok, label)) throw new Error('stopped at: ' + label); };
let browser = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Helpers (all taps and drags are real touch events)
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

const dbg = (page) => page.evaluate(() => window.__gd.debugGarden());
const gstate = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.garden)));
const coins = (page) => page.evaluate(() => window.tincture.game.state.coins);
const stockTotal = (page) => page.evaluate(() => Object.values(window.tincture.game.state.stock || {}).reduce((n, e) => n + (e.jars || 0), 0));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__gd = await import('./src/ui/garden.js'); });
}

/** A workshop past its first sessions: 22 colors, 7,000 coins, onboarding and the other guides done. */
async function seed(page) {
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.settings.responsibleMode = false; // replays the room far more than 5 times (test/limits.e2e.mjs covers the mode)
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true, tiles: true, skeins: true, lift: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 22) break;
        if (!st.catalog.discovered[c.id]) st.catalog.discovered[c.id] = { at: now, name: ctx.content.getColor(c.id).name, custom: false, essence: 0 };
      }
      ctx.sim.economy.invalidateDiscoveredCount && ctx.sim.economy.invalidateDiscoveredCount(st);
      st.coins = 7000;
      st.unlocks.hunters = true;
      st.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; m.level = 8; });
      for (const k of Object.keys(st.stations.sources)) st.stations.sources[k].level = 8;
      st.stations.shop.level = 8;
      return {};
    }, {});
    game.save();
  });
}

async function noHScroll(page, label) {
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-garden');
    const body = sec.querySelector('.gd-choose .screen-body');
    const small = [...sec.querySelectorAll('button, .btn')]
      .filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
      .map((el) => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20), w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.small.length === 0, `${label}: every control is at least 44 px (${JSON.stringify(g.small.slice(0, 3))})`);
}

/**
 * Steer by real touch drags for `ms`: each drag starts in a quiet corner of the
 * garden and pulls toward the nearest plant that fits (the drag is relative, so
 * the finger never has to be on the basket). Returns the scroll seen meanwhile.
 */
async function steer(page, cdp, ms, { stopWhen = null } = {}) {
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
  const vp = page.viewportSize();
  const end = Date.now() + ms;
  let maxScroll = 0;
  const ax = Math.round(vp.width * 0.3), ay = Math.round(vp.height * 0.36);
  while (Date.now() < end) {
    const d = await dbg(page);
    if (!d.running || d.ended) break;
    if (stopWhen && stopWhen(d)) break;
    let dx = 0, dy = 1;
    if (d.tx !== null && d.tx !== undefined) { dx = d.tx - d.bx; dy = d.ty - d.by; }
    const len = Math.hypot(dx, dy) || 1;
    const pull = Math.min(70, 18 + len * 0.6);
    const fx = ax + (dx / len) * pull, fy = ay + (dy / len) * pull;
    await touch('touchStart', ax, ay);
    for (let k = 1; k <= 4; k++) await touch('touchMove', ax + ((fx - ax) * k) / 4, ay + ((fy - ay) * k) / 4);
    for (let k = 0; k < 4; k++) { await sleep(70); await touch('touchMove', fx + (k % 2), fy); }
    await touch('touchEnd', fx, fy);
    maxScroll = Math.max(maxScroll, (await dbg(page)).scroll || 0);
  }
  return maxScroll;
}

// ---------------------------------------------------------------------------
// The walks
// ---------------------------------------------------------------------------

async function walk(viewport, tag, { reducedMotion = false } = {}) {
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
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  const cdp = await context.newCDPSession(page);
  console.log(`\n${tag}: ${viewport.width}x${viewport.height}${reducedMotion ? ' (reduced motion)' : ''}`);

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  if (reducedMotion) await page.evaluate(() => window.tincture.game.setSetting('reducedMotion', 'on'));

  // --- the hub card and the unlock -------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-garden', { state: 'attached' });
  must(await page.locator('#pz-garden [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Dye Garden card carries the price button`);
  await page.evaluate(() => document.querySelector('#pz-garden').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-garden [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.garden === true);
  check(Math.abs((await coins(page)) - 1000) < 200, `${tag}: buying the Dye Garden spent 6,000 coins`);
  await page.waitForSelector('#pz-garden [data-action="open-garden"]', { state: 'visible' });

  // --- the garden: places and the guide ------------------------------------------------
  await tap(page, '#pz-garden [data-action="open-garden"]');
  await page.waitForSelector('#screen-garden [data-place-card="meadow"]', { state: 'visible' });
  await page.waitForTimeout(500);
  await noHScroll(page, `${tag} places`);
  check(await page.locator('#screen-garden [data-place-card]').count() === 5, `${tag}: five places`);
  const regions = await page.locator('#screen-garden .gd-place h2 small').allTextContents();
  check(regions.length === 5 && regions.every((t) => /^by the /.test(t)), `${tag}: each place sits by a map region (${regions.join(', ')})`);
  const wanderPrimary = await page.evaluate(() => document.querySelector('[data-place-card="meadow"] [data-mode="wander"]').classList.contains('btn-primary'));
  check(wanderPrimary, `${tag}: Wander is the default (primary) choice; the harvest is opt-in`);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Wander/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button`);
  await shot('03-places-guide');

  // --- a Wander visit by touch ----------------------------------------------------------
  await tap(page, '#screen-garden [data-place-card="meadow"] [data-mode="wander"]');
  await page.waitForFunction(() => window.__gd.debugGarden().view === 'play' && window.__gd.debugGarden().running);
  await page.waitForTimeout(400);
  const d0 = await dbg(page);
  check(d0.got === 0 && d0.level === 1, `${tag}: the basket starts empty at level 1 (${d0.got} plants)`);
  const hud = await page.evaluate(() => {
    const play = document.querySelector('#screen-garden .gd-play');
    const bot = play.querySelector('.gd-bot');
    const goal = play.querySelector('[data-goal]');
    return {
      jars: play.querySelectorAll('.gd-jar, #jars, .jarbox').length - play.querySelectorAll('.gd-over .gd-jar').length,
      botButtons: [...bot.querySelectorAll('button')].map((b) => b.textContent.trim()),
      goalInGrow: !!goal.closest('.gd-grow'),
      goalText: goal.textContent.trim(),
      tabHidden: (() => { const t = document.getElementById('tabbar'); return !t || t.hidden || t.getBoundingClientRect().height === 0; })(),
    };
  });
  check(hud.jars === 0, `${tag}: no jar/bottle row during play`);
  check(hud.botButtons.length === 1 && hud.botButtons[0] === 'Head home', `${tag}: the bottom holds only Head home (${hud.botButtons.join(', ')})`);
  check(hud.goalInGrow && /^Bonus: enough for/.test(hud.goalText), `${tag}: the bonus goal sits under the growth bar ("${hud.goalText}")`);
  check(hud.tabHidden, `${tag}: the tab bar is hidden in the garden`);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 3000 }).catch(() => {});
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/steer/i.test(bubble2), `${tag}: the guide's second step is the steer ("${(bubble2 || '').trim()}")`);
  await shot('04-play-start');
  const scroll1 = await steer(page, cdp, 9000);
  const d1 = await dbg(page);
  check(d1.got >= 8, `${tag}: touch steering gathered ${d1.got} plants`);
  check(scroll1 === 0, `${tag}: the page never scrolls while steering (max ${scroll1})`);
  await page.waitForSelector('#guide-layer [data-coach-action]', { state: 'visible', timeout: 3000 }).catch(() => {});
  if (await page.locator('#guide-layer [data-coach-action]').count()) {
    const b3 = await page.locator('#guide-layer .coach-tag').textContent();
    check(/bar/.test(b3), `${tag}: the guide's last step points at the growth bar`);
    await shot('05-guide-3');
    await tap(page, '#guide-layer [data-coach-action]');
  }
  await page.waitForFunction(() => !!window.tincture.game.state.onboarding.seen.garden, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.garden), `${tag}: the guide is marked seen`);
  await steer(page, cdp, 3000);
  await shot('06-play-steered');
  await noHScroll(page, `${tag} play`);

  // --- leave and resume ------------------------------------------------------------------
  await page.waitForTimeout(600); // the basket glides to a stop after the last drag
  const before = (await dbg(page)).got;
  const coinsMid = await coins(page);
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden [data-action="continue"]', { state: 'visible' });
  const cur = (await gstate(page)).cur;
  check(cur && cur.place === 'meadow' && cur.got.length >= before && cur.got.length > 0, `${tag}: leaving keeps the Wander visit (${cur && cur.got.length} plants)`);
  check(Math.abs((await coins(page)) - coinsMid) < 1e-6, `${tag}: leaving a Wander visit banks nothing yet`);
  await tap(page, '#screen-garden [data-action="continue"]');
  await page.waitForFunction(() => window.__gd.debugGarden().view === 'play');
  check((await dbg(page)).got === cur.got.length, `${tag}: Keep wandering resumes with the same basket`);

  // --- to the end (autopilot, faster clock) -------------------------------------------------
  const coins0 = await coins(page);
  const stock0 = await stockTotal(page);
  await page.evaluate(() => { window.__gd.gardenTest.speed(6); window.__gd.gardenTest.autopilot(true); });
  await page.waitForSelector('#screen-garden [data-end]:not([hidden])', { state: 'visible', timeout: 90000 });
  await page.evaluate(() => { window.__gd.gardenTest.autopilot(false); window.__gd.gardenTest.speed(1); });
  const end1 = await page.evaluate(() => ({
    title: document.querySelector('#screen-garden [data-end-title]').textContent,
    haul: document.querySelectorAll('#screen-garden [data-haul] li').length,
    coins: (document.querySelector('#screen-garden [data-pays] [data-coins]') || {}).textContent || '',
    stock: (document.querySelector('#screen-garden [data-pays] .stock') || {}).textContent || '',
  }));
  check(/gathered all of the Meadow/.test(end1.title), `${tag}: a Wander visit to the end ("${end1.title}")`);
  check(end1.haul >= 5, `${tag}: the end card shows the haul (${end1.haul} dyes)`);
  check(/^\+[\d.,KMB]+ coins$/.test(end1.coins.trim()), `${tag}: the end card shows the coins (${end1.coins.trim()})`);
  check(/For your shelves/.test(end1.stock), `${tag}: the end card shows the jars for the shelves`);
  const coins1 = await coins(page);
  const stock1 = await stockTotal(page);
  check(coins1 > coins0, `${tag}: coins land (${Math.round(coins0)} -> ${Math.round(coins1)})`);
  check(stock1 > stock0, `${tag}: stock lands (${stock0.toFixed(1)} -> ${stock1.toFixed(1)} jars)`);
  const gs1 = await gstate(page);
  check(gs1.visits === 1 && gs1.cur === null && Object.keys(gs1.shelf).length >= 5, `${tag}: the visit is banked (dye shelf ${Object.keys(gs1.shelf).length} dyes)`);
  await page.evaluate(() => { const e = document.querySelector('#screen-garden [data-end]'); e.scrollTop = 0; });
  await shot('07-wander-end');

  // --- a short harvest before dusk (faster clock) ---------------------------------------------
  await tap(page, '#screen-garden [data-action="another"]');
  await page.waitForSelector('#screen-garden [data-place-card="shore"]', { state: 'visible' });
  await tap(page, '#screen-garden [data-place-card="shore"] [data-mode="harvest"]');
  await page.waitForFunction(() => window.__gd.debugGarden().view === 'play' && window.__gd.debugGarden().mode === 'harvest');
  const sun = await page.evaluate(() => {
    const s = document.querySelector('#screen-garden [data-sun]');
    return { shown: !s.hidden && s.getBoundingClientRect().width > 0, clock: s.textContent.trim(), color: getComputedStyle(s.querySelector('span')).color };
  });
  check(sun.shown && /2:00/.test(sun.clock), `${tag}: the harvest shows the sun clock (${sun.clock})`);
  check(!/rgb\((2[0-5]\d|1[5-9]\d), ([0-9]|[1-6]\d), ([0-9]|[1-6]\d)\)/.test(sun.color), `${tag}: the clock is never red (${sun.color})`);
  check((await dbg(page)).clock.started === false, `${tag}: the sun waits for her first move`);
  await steer(page, cdp, 2500);
  check((await dbg(page)).clock.started === true, `${tag}: the sun starts when she moves`);
  await shot('08-harvest');
  const coinsH = await coins(page);
  await page.evaluate(() => { window.__gd.gardenTest.speed(10); window.__gd.gardenTest.autopilot(true); });
  await page.waitForSelector('#screen-garden [data-end]:not([hidden])', { state: 'visible', timeout: 60000 });
  await page.evaluate(() => { window.__gd.gardenTest.autopilot(false); window.__gd.gardenTest.speed(1); });
  const end2 = await page.evaluate(() => ({
    title: document.querySelector('#screen-garden [data-end-title]').textContent,
    score: !document.querySelector('#screen-garden [data-score]').hidden,
    best: document.querySelector('#screen-garden [data-score]').textContent,
  }));
  check(/^(Dusk at|You gathered all of|You and the goat cleared) the Shoreline/.test(end2.title), `${tag}: the harvest ends kindly ("${end2.title}")`);
  check(end2.score && /New best!/.test(end2.best), `${tag}: the score and a first best show`);
  check((await coins(page)) > coinsH, `${tag}: the harvest pays`);
  check(!!(await gstate(page)).bests.shore, `${tag}: the best is saved for the Shoreline`);
  await shot('09-harvest-end');

  // --- leaving a harvest early banks it ---------------------------------------------------------
  await tap(page, '#screen-garden [data-action="again"]');
  await page.waitForFunction(() => window.__gd.debugGarden().running && window.__gd.debugGarden().mode === 'harvest');
  await steer(page, cdp, 2500);
  const visits0 = (await gstate(page)).visits;
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden [data-place-card="shore"]', { state: 'visible' });
  check((await gstate(page)).visits === visits0 + 1, `${tag}: leaving a harvest early still brings the basket home`);

  // --- a new visit while a Wander basket waits: that basket is banked first -----------------------
  await tap(page, '#screen-garden [data-place-card="forest"] [data-mode="wander"]');
  await page.waitForFunction(() => window.__gd.debugGarden().running && window.__gd.debugGarden().place === 'forest');
  await steer(page, cdp, 2500);
  await page.waitForTimeout(600);
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden [data-action="continue"]', { state: 'visible' });
  const waiting = (await gstate(page)).cur;
  const visits1 = (await gstate(page)).visits;
  await tap(page, '#screen-garden [data-place-card="cactus"] [data-mode="wander"]');
  await page.waitForFunction(() => window.__gd.debugGarden().running && window.__gd.debugGarden().place === 'cactus');
  const g2 = await gstate(page);
  check(waiting && waiting.got.length > 0 && g2.visits === visits1 + 1 && g2.last.placeId === 'forest' && g2.cur.place === 'cactus',
    `${tag}: starting elsewhere banks the waiting basket first (${waiting && waiting.got.length} plants)`);
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden [data-place-card="shore"]', { state: 'visible' });

  // --- the Garden Path ----------------------------------------------------------------------------
  await page.waitForSelector('#screen-garden [data-pathcard]', { state: 'visible' });
  const pathCard = await page.locator('#screen-garden [data-pathcard]').textContent();
  check(/The Garden Path/.test(pathCard) && /108 gardens/.test(pathCard), `${tag}: the places show the Garden Path card`);
  await page.evaluate(() => document.querySelector('#screen-garden [data-pathcard]').scrollIntoView({ block: 'center' }));
  await shot('11-path-card');
  await tap(page, '#screen-garden [data-pathcard] [data-action="path-open"]');
  await page.waitForSelector('#screen-garden .gd-chap', { state: 'visible' });
  const list = await page.evaluate(() => ({
    chapters: [...document.querySelectorAll('#screen-garden .gd-chap h2')].map((h) => h.firstChild.textContent.trim()),
    tiles: document.querySelectorAll('#screen-garden .gd-tile').length,
    next: (document.querySelector('#screen-garden .gd-tile.next') || {}).textContent || '',
    locked: document.querySelectorAll('#screen-garden .gd-tile[aria-disabled="true"]').length,
  }));
  check(list.chapters.length === 9 && list.chapters[0] === 'Spring meadow' && list.chapters.includes('Winter hedgerow'), `${tag}: nine chapters (${list.chapters.join(', ')})`);
  check(list.tiles === 108 && list.locked === 107 && /^1\s*Next/.test(list.next.trim()), `${tag}: 108 gardens, the first one next (${list.tiles}, ${list.locked} waiting)`);
  await noHScroll(page, `${tag} path list`);
  await page.evaluate(() => { const b = document.querySelector('#screen-garden .gd-pathbody'); b.scrollTop = 0; });
  await shot('12-path-list');
  await tap(page, '#screen-garden .gd-tile[data-level="spring-2"]');
  check(await page.locator('#screen-garden [data-lvcard]:not([hidden])').count() === 0, `${tag}: a garden further on waits (no card)`);
  await tap(page, '#screen-garden .gd-tile.next');
  await page.waitForSelector('#screen-garden [data-lvcard]:not([hidden])', { state: 'visible' });
  const lvcard = await page.locator('#screen-garden [data-lvcard] .card').textContent();
  check(/Gather 12 tansy heads/.test(lvcard), `${tag}: the garden card names the goal`);
  check(/New in this garden/.test(lvcard) && /Tansy/.test(lvcard) && /not for eating/i.test(lvcard), `${tag}: the garden card introduces the new plant, with its note`);
  await shot('13-garden-card');
  await tap(page, '#screen-garden [data-lvcard] [data-action="path-start"]');
  await page.waitForFunction(() => window.__gd.debugGarden().view === 'play' && window.__gd.debugGarden().mode === 'path' && window.__gd.debugGarden().running);
  const pathHud = await page.evaluate(() => ({ name: document.querySelector('#screen-garden [data-name]').textContent, goal: document.querySelector('#screen-garden [data-goal]').textContent.trim() }));
  check(/^Garden 1 · First shoots/.test(pathHud.name), `${tag}: the garden's number and name in the HUD ("${pathHud.name}")`);
  check(/^Goal: Gather 12 tansy heads/.test(pathHud.goal), `${tag}: the goal sits under the growth bar ("${pathHud.goal}")`);
  await steer(page, cdp, 3500);
  await page.waitForTimeout(600);
  const pathGot = (await dbg(page)).got;
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden .gd-pathbody [data-action="path-continue"]', { state: 'visible' });
  const pcur = (await gstate(page)).cur;
  check(pcur && pcur.mode === 'path' && pcur.place === 'spring-1' && pcur.got.length === pathGot, `${tag}: leaving a path garden keeps it (${pcur && pcur.got.length} plants)`);
  check(/Keep going in Garden 1/.test(await page.locator('#screen-garden .gd-pathbody [data-action="path-continue"]').textContent()), `${tag}: the path list offers to keep going`);
  await tap(page, '#screen-garden .gd-pathbody [data-action="path-continue"]');
  await page.waitForFunction(() => window.__gd.debugGarden().running && window.__gd.debugGarden().mode === 'path');
  check((await dbg(page)).got === pathGot, `${tag}: Continue resumes the same basket`);
  await page.evaluate(() => { window.__gd.gardenTest.speed(4); window.__gd.gardenTest.autopilot(true); });
  await page.waitForFunction(() => { const d = window.__gd.debugGarden(); return d.path && d.path.met; }, null, { timeout: 60000 });
  await page.evaluate(() => { window.__gd.gardenTest.autopilot(false); window.__gd.gardenTest.speed(1); });
  const metToast = await page.locator('#screen-garden .gd-toast').textContent();
  const metState = await gstate(page);
  check(!!metState.path.done['spring-1'], `${tag}: the goal met marks Garden 1 done at once`);
  check(/Garden 1 done! Garden 2 is open/.test(metToast), `${tag}: a kind note says the next garden is open ("${metToast}")`);
  check(/done!/.test(await page.locator('#screen-garden [data-goal]').textContent()), `${tag}: the goal line turns to the stars`);
  await shot('14-goal-met');
  const coinsP = await coins(page);
  await page.evaluate(() => { window.__gd.gardenTest.speed(6); window.__gd.gardenTest.autopilot(true); });
  await page.waitForSelector('#screen-garden [data-end]:not([hidden])', { state: 'visible', timeout: 90000 });
  await page.evaluate(() => { window.__gd.gardenTest.autopilot(false); window.__gd.gardenTest.speed(1); });
  const pend = await page.evaluate(() => ({
    title: document.querySelector('#screen-garden [data-end-title]').textContent,
    stars: (document.querySelector('#screen-garden [data-score] .gd-bigstars') || {}).getAttribute ? document.querySelector('#screen-garden [data-score] .gd-bigstars').getAttribute('aria-label') : '',
    next: (document.querySelector('#screen-garden [data-end] [data-action="path-next"]') || {}).textContent || '',
  }));
  check(/^Garden 1(, done again| done!)/.test(pend.title), `${tag}: the end card ("${pend.title}")`);
  check(/^[123] of 3 stars$/.test(pend.stars), `${tag}: the end card shows the stars (${pend.stars})`);
  check(/Next garden/.test(pend.next), `${tag}: the end card offers the next garden`);
  check((await coins(page)) > coinsP, `${tag}: a path garden pays`);
  await page.evaluate(() => { const e = document.querySelector('#screen-garden [data-end]'); e.scrollTop = 0; });
  await shot('15-path-end');
  await tap(page, '#screen-garden [data-end] [data-action="path-next"]');
  await page.waitForSelector('#screen-garden [data-lvcard]:not([hidden])', { state: 'visible' });
  check(/Garden 2/.test(await page.locator('#screen-garden [data-lvcard] .gd-kick').textContent()), `${tag}: Next garden opens Garden 2's card`);
  await tap(page, '#screen-garden [data-lvcard] [data-action="lv-close"]');
  check(await page.evaluate(() => !!document.querySelector('#screen-garden .gd-tile.done[data-level="spring-1"]') && !!document.querySelector('#screen-garden .gd-tile.next[data-level="spring-2"]')),
    `${tag}: the list ticks Garden 1 and highlights Garden 2`);

  // a later garden's new mechanic: the stream (the first 24 gardens marked done)
  await page.evaluate(async () => {
    const P = await import('./src/puzzles/garden-path.js');
    window.tincture.game.act((st, a, now) => { for (const l of P.LEVELS.slice(0, 24)) st.garden.path.done[l.id] = st.garden.path.done[l.id] || { stars: 2, at: now }; return {}; }, {});
  });
  await tap(page, '#screen-garden [data-action="places"]');
  await tap(page, '#screen-garden [data-pathcard] [data-action="path-continue"]');
  await page.waitForSelector('#screen-garden [data-lvcard]:not([hidden])', { state: 'visible' });
  const streamCard = await page.locator('#screen-garden [data-lvcard] .card').textContent();
  check(/Garden 25/.test(streamCard) && /The stream/.test(streamCard) && /float/.test(streamCard), `${tag}: Continue opens Garden 25, which introduces the stream`);
  await shot('16-stream-card');
  await tap(page, '#screen-garden [data-lvcard] [data-action="path-start"]');
  await page.waitForFunction(() => window.__gd.debugGarden().running && window.__gd.debugGarden().path && window.__gd.debugGarden().path.level === 'stream-1');
  await page.evaluate(() => { window.__gd.gardenTest.speed(2); window.__gd.gardenTest.autopilot(true); });
  await page.waitForFunction(() => { const d = window.__gd.debugGarden(); return d.path && d.path.prog && d.path.prog.have >= 2; }, null, { timeout: 60000 });
  await page.evaluate(() => { window.__gd.gardenTest.autopilot(false); window.__gd.gardenTest.speed(1); });
  const sd = await dbg(page);
  check(sd.path.floaters > 0 && sd.path.prog.have >= 2, `${tag}: floating marigolds drift past and are caught (${sd.path.prog.have} of ${sd.path.prog.need})`);
  await page.waitForTimeout(400);
  await shot('17-stream');
  await tap(page, '#screen-garden [data-action="leave"]');
  await page.waitForSelector('#screen-garden .gd-pathbody', { state: 'visible' });
  await tap(page, '#screen-garden [data-action="places"]');
  await page.waitForSelector('#screen-garden [data-place-card="meadow"]', { state: 'visible' });

  // --- the Map entry ---------------------------------------------------------------------------
  await tap(page, '#screen-garden [data-back]');
  await tap(page, '#tabbar [data-tab="map"]');
  await page.waitForSelector('#mp-garden', { state: 'attached' });
  await page.evaluate(() => document.querySelector('#mp-garden').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot('10-map-card');
  await tap(page, '#mp-garden [data-action="open-garden"]');
  await page.waitForSelector('#screen-garden [data-place-card="meadow"]', { state: 'visible' });
  check(await page.evaluate(() => window.tincture.router && document.querySelector('#screen-garden').hidden === false), `${tag}: the Map's Dye Garden card opens the garden`);
  await tap(page, '#screen-garden [data-back]');
  await page.waitForSelector('#mp-garden', { state: 'visible' });
  check(true, `${tag}: back from the garden returns to the Map`);
  // the hub card now tells her about her last visit
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-garden [data-action="open-garden"]', { state: 'attached' });
  const hubLine = await page.locator('#pz-garden .hint').first().textContent();
  check(/Last visit|left off/.test(hubLine), `${tag}: the hub card remembers the last visit ("${hubLine.trim()}")`);

  check(errors.length === 0, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  const stats = await page.evaluate(() => window.__gd.gardenTest.stats());
  console.log(`     frames: ${stats.frames}, p50 ${stats.p50.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms, work p95 ${stats.work95.toFixed(1)} ms, dpr ${stats.dpr}`);
  await context.close();
}

try {
  await waitForServer(URL_);
  browser = await pw.chromium.launch({ executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined });
  await walk({ width: 390, height: 844 }, 'g390');
  await walk({ width: 360, height: 740 }, 'g360', { reducedMotion: true });
} catch (e) {
  failures++;
  console.log('FAIL ' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed. Screenshots: ${SHOTS}` : `\nAll garden checks passed. Screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
