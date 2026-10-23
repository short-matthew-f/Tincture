// Tincture — test/lift.e2e.mjs
// The Lifting Table walked end to end in headless Chromium with real touch
// input (isMobile, hasTouch, DPR 2) at 390x844 and 360x740:
//  - from the workshop: Next names the Lifting Table, the sheet buys it, the
//    short ceremony plays, and a two-choice card offers the way in;
//  - from the Puzzles hub: the card shows the price, buying it there opens the
//    card's "Go to the easel";
//  - the guide: its first step is the action itself (no Got it), then two
//    short information steps; it is marked seen;
//  - painting 1 finished by taps on the lanes (the stored solution), with a
//    reload in the middle that resumes exactly (moves, columns, belt);
//  - the finish sheet: coins and stock land (state and the reward line);
//  - the gallery wall opens and lists 27 paintings; Undo and Hint work;
//  - 44 px controls, no horizontal scroll, the lanes inside the viewport,
//    the tab bar hidden, one painting canvas, no page or console errors.
// Run: node test/lift.e2e.mjs   (screenshots: $LIFT_SHOTS or the OS temp dir)

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.LIFT_SHOTS || path.join(os.tmpdir(), 'tincture-lift-e2e');
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
if (!pw) { console.log('SKIP lift.e2e: Playwright not found'); process.exit(0); }

const PORT = await freePort();
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; return ok; };
const must = (ok, label) => { if (!check(ok, label)) throw new Error('stopped at: ' + label); };
let browser = null;

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

const idle = (page, ms = 15000) => page.waitForFunction(() => window.__lf && !window.__lf.debugLift().busy && !window.__lf.debugLift().revealing, null, { timeout: ms });
const liftState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.lift)));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__lf = await import('./src/ui/lift.js'); });
}

/** A workshop past its first sessions: 19 colors (silently), coins, two mixers running, the other guides done. */
async function seed(page, { coins = 4200 } = {}) {
  await page.evaluate((coinsAt) => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true, skeins: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 19) break;
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

async function geometry(page, label) {
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-lift');
    const body = sec.querySelector('.screen-body');
    const small = [...sec.querySelectorAll('.btn, .btn-back, .lf-front, .lf-slotbtn, .lf-iconbtn')]
      .filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
      .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    const lanes = sec.querySelector('#lf-lanes');
    const lr = lanes ? lanes.getBoundingClientRect() : null;
    const tab = document.getElementById('tabbar');
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      lanesBottom: lr ? lr.bottom : -1, vh: innerHeight, tabHidden: !tab || tab.hidden || tab.getBoundingClientRect().height === 0,
      canvases: sec.querySelectorAll('#lf-app canvas').length,
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.lanesBottom > 0 && g.lanesBottom <= g.vh + 0.5, `${label}: the lanes sit inside the viewport (${Math.round(g.lanesBottom)} <= ${g.vh})`);
  check(g.tabHidden, `${label}: the tab bar is hidden under the Lifting Table`);
  check(g.canvases === 2, `${label}: one painting canvas and one grain canvas (${g.canvases})`);
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

/** Tap the move a stored-solution step names: L<i> a lane's front jar, P<i> a belt jar, U<i> a bench jar. */
async function tapMove(page, m) {
  const i = m.slice(1);
  const sel = m[0] === 'L' ? `#lf-lanes .lf-front[data-lane="${i}"]` : m[0] === 'P' ? `#lf-belt .lf-slotbtn[data-i="${i}"]` : `#lf-bench .lf-slotbtn[data-i="${i}"]`;
  await tap(page, sel);
  await idle(page);
}

async function gotIt(page) {
  // Information steps of the guide: tap "Got it" when one is up.
  for (let k = 0; k < 3; k++) {
    const b = page.locator('#guide-layer [data-coach-action]');
    if (!(await b.count())) return k;
    await tap(page, b);
    await page.waitForTimeout(250);
  }
  return 3;
}

// ---------------------------------------------------------------------------
// The walks
// ---------------------------------------------------------------------------

/** From the Puzzles hub: price, purchase, the guide, painting 1 by taps with a reload mid-way, the finish. */
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
  await page.waitForSelector('#pz-lift', { state: 'visible' });
  must(await page.locator('#pz-lift [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Lifting Table card carries the price button`);
  check(/3(,500|\.5K)/.test(await page.locator("#pz-lift").textContent()), `${tag}: the price reads 3.5K`);
  await page.evaluate(() => document.querySelector('#pz-lift').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-lift [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  const coins0 = await page.evaluate(() => window.tincture.game.state.coins);
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.lift === true);
  const coins1 = await page.evaluate(() => window.tincture.game.state.coins);
  check(coins0 - coins1 > 3499 && coins0 - coins1 < 3600, `${tag}: buying the Lifting Table spent 3,500 coins (${Math.round(coins0 - coins1)})`);
  await page.waitForSelector('#pz-lift [data-action="open-lift"]', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#pz-lift').scrollIntoView({ block: 'center' }));
  await shot('03-hub-open');

  // --- the table and the guide ---------------------------------------------------------------
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Tap a front jar/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button (no steps before her first action)`);
  check(await page.locator('#screen-lift .lf-sheet:not([hidden])').count() === 0, `${tag}: no sheet over the table on the first visit`);
  await shot('04-guide-1');
  await geometry(page, `${tag} table`);

  const L = await page.evaluate(() => { const l = window.tincture.ctx.puzzles.liftLevels.levelById('sun'); return { solution: l.solution.split(' '), W: l.W, H: l.H }; });
  const quote = await page.evaluate(() => window.tincture.ctx.sim.lift.quote(window.tincture.game.state, 'sun', window.tincture.game.now()));
  const stock0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.stock)));

  // First move by hand so the guide follows it.
  await tapMove(page, L.solution[0]);
  await page.waitForTimeout(300);
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/bottom edge/.test(bubble2), `${tag}: the second step explains the lifting ("${(bubble2 || '').trim()}")`);
  await shot('05-first-move');
  const gots = await gotIt(page);
  check(gots === 2, `${tag}: two short information steps after the action (${gots})`);
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.lift), `${tag}: the guide is marked seen`);

  const half = Math.floor(L.solution.length / 2);
  for (const m of L.solution.slice(1, half)) await tapMove(page, m);
  // A tap mid-animation then a reload: the move is saved the moment it is made.
  await tap(page, `#lf-lanes .lf-front[data-lane="${L.solution[half].slice(1)}"]`);
  await page.waitForTimeout(120);
  await shot('06-mid-belt');
  const before = await liftState(page);
  const beforeRules = await page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.ctx.sim.lift.current(window.tincture.game.state).s)));
  check(before.game.moves.length === half + 1, `${tag}: every move is saved as it is made (${before.game.moves.length})`);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  const after = await liftState(page);
  check(JSON.stringify(after.game) === JSON.stringify(before.game), `${tag}: a reload mid-painting keeps the moves exactly`);
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForSelector('#pz-lift [data-action="open-lift"]', { state: 'visible' });
  const card = (await page.locator('#pz-lift').textContent()).replace(/\s+/g, ' ');
  check(/Continue lifting/.test(card) && /% lifted/.test(card), `${tag}: the hub card shows the painting at a glance ("${card.trim().slice(0, 80)}")`);
  await page.evaluate(() => document.querySelector('#pz-lift').scrollIntoView({ block: 'center' }));
  await shot('07-hub-continue');
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await idle(page);
  const resumed = await page.evaluate(() => ({
    rules: JSON.parse(JSON.stringify(window.tincture.ctx.sim.lift.current(window.tincture.game.state).s)),
    painter: window.__lf.debugLift().painter.h,
    belt: document.querySelectorAll('#lf-belt .lf-slotbtn').length,
    shelf: document.querySelector('#lf-shelfCount').textContent,
  }));
  check(JSON.stringify(resumed.rules) === JSON.stringify(beforeRules), `${tag}: the table resumes exactly where it was`);
  check(resumed.painter.join() === beforeRules.h.join(), `${tag}: the painting's columns match the saved heights`);
  check(resumed.belt === beforeRules.belt.length && resumed.shelf.includes(String(beforeRules.shelf.length)), `${tag}: belt and shelf drawn as saved`);
  await shot('08-resumed');

  // Undo and hint.
  await tap(page, '#lf-undoBtn');
  await idle(page);
  check((await liftState(page)).game.moves.length === half, `${tag}: Undo takes back one move`);
  await tap(page, '#lf-hintBtn');
  await page.waitForSelector('#screen-lift .lf-jar.lf-hinted', { state: 'visible', timeout: 4000 }).catch(() => {});
  check(await page.locator('#screen-lift .lf-jar.lf-hinted').count() === 1, `${tag}: Hint points at one jar ("${(await page.locator('#lf-msg').textContent()).trim()}")`);
  await shot('09-hint');

  // The rest of painting 1 by taps.
  for (const m of L.solution.slice(half)) await tapMove(page, m);
  await page.waitForSelector('#lf-finishSheet:not([hidden])', { state: 'visible', timeout: 8000 });
  const fin = await page.evaluate(() => ({ st: JSON.parse(JSON.stringify(window.tincture.game.state)), title: document.querySelector('#lf-finTitle').textContent, reward: document.querySelector('#lf-finReward').textContent }));
  check(/morning sun, lifted/.test(fin.title), `${tag}: the finish sheet ("${fin.title}")`);
  check(fin.st.lift.done.sun === 1 && fin.st.lift.lifted === 1, `${tag}: painting 1 is recorded as lifted`);
  const paid = fin.st.lift.last.coins + fin.st.lift.last.sold;
  check(paid > 0 && Math.abs(fin.st.lift.last.coins - quote.coins) / quote.coins < 0.05, `${tag}: coins landed (${paid.toFixed(1)}, quoted ${quote.coins.toFixed(1)})`);
  // The shop keeps selling while she plays, so read what landed from the record, and see the jars in stock.
  const landed = fin.st.lift.last.stock;
  const want = quote.stock.reduce((a, it) => a + it.jars, 0);
  const got = landed.reduce((a, it) => a + it.jars + it.sold, 0);
  const jarsOf = (st, id) => (st[id] ? st[id].jars : 0);
  // (the shop sells about 0.04 jars a second at level 1, so allow one jar to have gone)
  const inStock = landed.filter((it) => it.jars > 0).every((it) => jarsOf(fin.st.stock, it.colorId) >= jarsOf(stock0, it.colorId) + it.jars - 1);
  check(want > 0 && Math.abs(got - want) < 1e-6 && landed.some((it) => it.jars > 0) && inStock, `${tag}: stock landed in her nearest colors (${landed.map((it) => `${it.colorId} +${it.jars}`).join(', ')})`);
  check(/coins/.test(fin.reward) && /jar/.test(fin.reward), `${tag}: the reward line names coins and jars ("${fin.reward.replace(/\s+/g, ' ').trim()}")`);
  await page.waitForTimeout(700);
  await shot('10-finish');

  // The gallery wall from the finish sheet.
  await tap(page, '#lf-finAll');
  await page.waitForSelector('#lf-levelSheet:not([hidden])', { state: 'visible' });
  check(await page.locator('#lf-wall [data-level]').count() === 27, `${tag}: the gallery wall shows 27 paintings`);
  check(await page.locator('#lf-wall .lf-tick').count() === 1, `${tag}: painting 1 carries its tick`);
  await page.waitForTimeout(350);
  await shot('11-gallery');
  await tap(page, '#lf-wall [data-level="tulip"]');
  await page.waitForSelector('#lf-levelSheet', { state: 'hidden' });
  check((await liftState(page)).cur === 'tulip', `${tag}: any painting, in any order`);
  await geometry(page, `${tag} tulip`);
  await shot('12-tulip');

  // A painting with a new mechanic introduces it once, then plays (the late, big pictures fit too).
  await tap(page, '#lf-levelsBtn');
  await page.waitForSelector('#lf-levelSheet:not([hidden])', { state: 'visible' });
  await tap(page, '#lf-wall [data-level="skein"]');
  await page.waitForSelector('#lf-introSheet:not([hidden])', { state: 'visible' });
  check(/Mystery jars/.test(await page.locator('#lf-introBody').textContent()), `${tag}: the mystery jars intro card`);
  await page.waitForTimeout(300);
  await shot('13-intro');
  await tap(page, '#lf-introOk');
  check((await liftState(page)).seenIntro.mystery === true, `${tag}: the intro card is remembered`);
  await tapMove(page, (await page.evaluate(() => window.tincture.ctx.puzzles.liftLevels.levelById('skein').solution.split(' ')[0])));
  check((await liftState(page)).game.moves.length === 1, `${tag}: skein plays`);
  await page.evaluate(() => { window.tincture.game.act(window.tincture.ctx.sim.lift.startPainting, { levelId: 'sampler' }); });
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#lf-introSheet:not([hidden])', { state: 'visible' });
  await tap(page, '#lf-introOk');
  await geometry(page, `${tag} sampler (30 x 34)`);
  const cs = await page.evaluate(() => window.__lf.debugLift().painter.cs);
  check(cs >= 4, `${tag}: the sampler's cells are ${cs.toFixed(1)} px`);
  await shot('14-sampler');

  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** From the workshop: Next names the Lifting Table, the sheet buys it, the ceremony plays, a two-choice card offers the way in. */
async function workshopWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.evaluate(() => { window.tincture.game.act((st) => { st.unlocks.shelf = true; st.unlocks.hunters = true; st.unlocks.skeins = true; return {}; }, {}); window.tincture.game.save(); });
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.waitForSelector('#screen-workshop [data-action="next"]', { state: 'visible' });
  await page.waitForTimeout(400);
  const label = (await page.locator('#screen-workshop [data-action="next"]').textContent()).trim();
  check(/Lifting Table/.test(label) && /3(,500|\.5K)/.test(label), `${tag}: the workshop's Next names the Lifting Table ("${label}")`);
  await tap(page, '#screen-workshop [data-action="next"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await page.waitForTimeout(300);
  await shot('w1-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForTimeout(450);
  await shot('w2-ceremony');
  check(await page.evaluate(() => window.tincture.game.state.unlocks.lift === true), `${tag}: bought from the workshop`);
  const go = page.locator('[data-overlay-action]', { hasText: 'Go to the easel' });
  await go.waitFor({ state: 'visible', timeout: 6000 });
  await shot('w3-whats-next');
  await tap(page, go);
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  check(true, `${tag}: "Go to the easel" opens the table`);
  await page.waitForTimeout(600);
  await shot('w4-table');
  await geometry(page, `${tag} table`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

try {
  try { browser = await pw.chromium.launch(); } catch (e) {
    if (!fs.existsSync(CHROMIUM)) throw e;
    browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  }
  await waitForServer(URL_);
  await workshopWalk({ width: 390, height: 844 }, '390');
  await walk({ width: 390, height: 844 }, '390');
  await walk({ width: 360, height: 740 }, '360');
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Lifting Table checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
