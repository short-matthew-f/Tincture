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
//  - the gallery wall opens room by room: ten chapters, the first open with
//    its tick, the next painting ringed, closed ones veiled (a tap says what
//    opens them), "Continue" on top; Undo and Hint work;
//  - chapters: with the first 27 lifted (an older save), "Continue" leads into
//    chapter 4, whose card greets her once; a late painting (crocks, a jar left
//    out, a short belt, a small bench) plays mid-way at both sizes; the wall
//    folds finished rooms; the hub card names the chapter;
//  - 0.4.1: Hint always gives visible feedback within about 300 ms on the
//    biggest painting (the jar glows and one line names it), also when tapped
//    while the belt is still running and off the stored solution; a dead end
//    shows "Back to solvable" next to Hint (and Hint says so), which steps back
//    to a position the rules prove solvable without spending the spare spot;
//    from the gallery menu on a fine painting it says "You're on track";
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

/** Mark every painting before `id` lifted (paintings open in order), and the given intro cards seen. */
async function liftedUpTo(page, id, seen = []) {
  await page.evaluate(({ id, seen }) => {
    const { game, ctx } = window.tincture;
    const ids = ctx.puzzles.liftLevels.LEVEL_IDS;
    game.act((st) => {
      for (const x of ids.slice(0, ids.indexOf(id))) st.lift.done[x] = st.lift.done[x] || 1;
      for (const k of seen) st.lift.seenIntro[k] = true;
      return {};
    }, {});
  }, { id, seen });
}
const OLD_INTROS = ['mystery', 'linked', 'mixing', 'cloth', 'key', 'belt3', 'bench2'];

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
  check(/^Try (the|resting the|bringing the) .+ jar/.test((await page.locator('#lf-msg').textContent()).trim()), `${tag}: the hint line names the jar`);
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
  const wall = await page.evaluate(() => ({
    rooms: document.querySelectorAll('#lf-wall .lf-room').length,
    shut: document.querySelectorAll('#lf-wall .lf-room.lf-shut').length,
    open: [...document.querySelectorAll('#lf-wall [data-level]')].map((b) => b.dataset.level),
    closed: document.querySelectorAll('#lf-wall [data-closed]').length,
    next: document.querySelector('#lf-wall .lf-nextup')?.dataset.level,
    cont: document.querySelector('#lf-contBtn')?.dataset.level,
  }));
  check(wall.rooms === 10 && wall.shut === 9, `${tag}: the gallery wall hangs ten rooms, the first one open (${wall.rooms}, ${wall.shut} not open yet)`);
  check(wall.open.join() === 'sun,tulip' && wall.closed === 8, `${tag}: in the first room, the lifted painting and the next are open, the rest veiled (${wall.open.join()}; ${wall.closed} veiled)`);
  check(await page.locator('#lf-wall .lf-tick').count() === 1, `${tag}: painting 1 carries its tick`);
  check(wall.next === 'tulip' && wall.cont === 'tulip', `${tag}: the next painting is ringed and Continue leads to it`);
  await page.waitForTimeout(350);
  await shot('11-gallery');
  await tap(page, '#lf-wall [data-closed="teacup"]');
  check(/opens once you lift Tulip/.test(await page.locator('#lf-wallNote').textContent()), `${tag}: a veiled painting says what opens it ("${(await page.locator('#lf-wallNote').textContent()).trim()}")`);
  check((await liftState(page)).cur === 'sun', `${tag}: and does not open`);
  await tap(page, '#lf-contBtn');
  await page.waitForSelector('#lf-levelSheet', { state: 'hidden' });
  check((await liftState(page)).cur === 'tulip', `${tag}: Continue opens the next painting`);
  await geometry(page, `${tag} tulip`);
  await shot('12-tulip');

  // A painting with a new mechanic introduces it once, then plays (the late, big pictures fit too).
  await liftedUpTo(page, 'skein');
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
  await liftedUpTo(page, 'sampler');
  check(await page.evaluate(() => window.tincture.game.act(window.tincture.ctx.sim.lift.startPainting, { levelId: 'sampler' }).ok), `${tag}: the sampler opens once the paintings before it are lifted`);
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

/** Hint feedback on the biggest painting, a dead end and Back to solvable (0.4.1). */
async function hintWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.evaluate(() => {
    const { game } = window.tincture;
    game.act((st) => {
      st.unlocks.lift = true;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), lift: true };
      st.lift = st.lift || {};
      st.lift.seenIntro = { mystery: true, linked: true, mixing: true, cloth: true, key: true, belt3: true, bench2: true };
      for (const id of window.tincture.ctx.puzzles.liftLevels.LEVEL_IDS.slice(0, 27)) st.lift.done[id] = 1;
      return {};
    }, {});
    game.save();
  });
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  /** Tap Hint and time it in the page: from the touch to the glow (or the dead-end line). */
  const timedHint = async () => {
    await page.evaluate(() => {
      window.__t = {};
      document.querySelector('#lf-hintBtn').addEventListener('pointerdown', () => { window.__t.down = performance.now(); }, { once: true, capture: true });
      const mo = new MutationObserver(() => {
        const m = document.querySelector('#lf-msg').textContent;
        // Only an answer after the touch counts (a dead end's message already says "tangled" before it).
        if (!window.__t.down || m === 'Looking…') return;
        if (!window.__t.answer && (document.querySelector('#screen-lift .lf-jar.lf-hinted') || /tangled/.test(m))) { window.__t.answer = performance.now(); mo.disconnect(); }
      });
      mo.observe(document.querySelector('#screen-lift'), { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await tap(page, '#lf-hintBtn');
    await page.waitForFunction(() => window.__t && window.__t.answer, null, { timeout: 5000 }).catch(() => {});
    const t = await page.evaluate(() => window.__t);
    return { ms: t.answer && t.down ? t.answer - t.down : Infinity, msg: (await page.locator('#lf-msg').textContent()).trim(), glow: await page.locator('#screen-lift .lf-jar.lf-hinted').count() };
  };

  // --- the biggest painting, mid-game on the stored solution ------------------------------
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act(ctx.sim.lift.startPainting, { levelId: 'sampler' });
    for (const m of ctx.puzzles.liftLevels.levelById('sampler').solution.split(' ').slice(0, 14)) game.act(ctx.sim.lift.move, { move: m });
  });
  await page.evaluate(() => window.tincture.ctx.navigate('lift'));
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await idle(page);
  await page.waitForTimeout(300);
  let h = await timedHint();
  check(h.glow === 1 && h.ms < 300, `${tag}: sampler: Hint glows a jar in ${Math.round(h.ms)} ms`);
  check(/^Try (the|resting the|bringing the) .+ jar/.test(h.msg), `${tag}: and one line names it ("${h.msg}")`);
  await shot('15-hint-feedback');

  // Right after a move, while the belt still runs: the tap is not swallowed any more.
  const lane = await page.evaluate(() => {
    const { ctx, game } = window.tincture;
    const cur = ctx.sim.lift.current(game.state);
    const R = ctx.puzzles.lift;
    const m = R.legalMoves(cur.L, cur.s).find((x) => x.t === 'place' && R.frontUnit(cur.L, cur.s, x.i).some((j) => R.canLift(cur.L, cur.s, j)));
    return m ? m.i : null;
  });
  must(lane !== null, `${tag}: a lane jar that lifts`);
  await tap(page, `#lf-lanes .lf-front[data-lane="${lane}"]`);
  await page.waitForTimeout(60);
  const busyAtTap = await page.evaluate(() => window.__lf.debugLift().busy);
  await tap(page, '#lf-hintBtn');
  await page.waitForSelector('#screen-lift .lf-jar.lf-hinted', { state: 'visible', timeout: 4000 }).catch(() => {});
  h = { glow: await page.locator('#screen-lift .lf-jar.lf-hinted').count(), msg: (await page.locator('#lf-msg').textContent()).trim() };
  check(h.glow === 1 && /^Try|^To make room/.test(h.msg), `${tag}: Hint tapped while the belt runs (${busyAtTap ? 'busy' : 'settled'}) still answers ("${h.msg}")`);
  await idle(page);

  // Off the stored solution: still a glowing jar and a line (a solver move or a best guess).
  await page.evaluate(() => {
    const { ctx, game } = window.tincture;
    const R = ctx.puzzles.lift;
    for (let k = 0; k < 6; k++) {
      const cur = ctx.sim.lift.current(game.state);
      const ms = R.legalMoves(cur.L, cur.s).filter((x) => x.t === 'place');
      if (!ms.length) break;
      const nxt = R.apply(cur.L, cur.s, ms[ms.length - 1]).state;
      if (R.isStuck(cur.L, nxt)) break;
      game.act(ctx.sim.lift.move, { move: R.encodeMove(ms[ms.length - 1]) });
    }
  });
  await page.waitForTimeout(400);
  await idle(page);
  h = await timedHint();
  check((h.glow === 1 || /tangled/.test(h.msg)) && h.ms < 400, `${tag}: off the stored solution: feedback in ${Math.round(h.ms)} ms ("${h.msg}")`);

  // --- a dead end and Back to solvable ------------------------------------------------------
  const deadMoves = await page.evaluate(() => {
    const { ctx } = window.tincture;
    const R = ctx.puzzles.lift;
    const L = ctx.puzzles.liftLevels.levelById('village');
    for (let seed = 1; seed < 40; seed++) {
      let x = seed * 48271;
      const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
      let s = R.newState(L);
      const moves = [];
      for (let k = 0; k < 160 && !R.isDone(s); k++) {
        const ms = R.legalMoves(L, s);
        if (!ms.length) break;
        const places = ms.filter((m) => m.t === 'place');
        const pool = places.length && r() < 0.85 ? places : ms;
        const m = pool[Math.floor(r() * pool.length)];
        s = R.apply(L, s, m).state;
        moves.push(R.encodeMove(m));
        const v = R.verdict(L, s);
        if (v === 'dead' && !R.isStuck(L, s)) return moves; // dead, but jars can still move: the button sits next to Hint
        if (v === 'dead') break;
      }
    }
    return null;
  });
  must(!!deadMoves, `${tag}: a dead end on the village painting`);
  await page.evaluate((moves) => {
    const { game, ctx } = window.tincture;
    ctx.back();
    game.act(ctx.sim.lift.startPainting, { levelId: 'village' });
    for (const m of moves) game.act(ctx.sim.lift.move, { move: m });
  }, deadMoves);
  await page.evaluate(() => window.tincture.ctx.navigate('lift'));
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await idle(page);
  await page.waitForSelector('#lf-backBtn', { state: 'visible', timeout: 4000 }).catch(() => {});
  check(await page.locator('#lf-backBtn').isVisible(), `${tag}: a proven dead end shows Back to solvable`);
  check(await page.locator('#lf-hintBtn').isVisible(), `${tag}: next to Hint`);
  h = await timedHint();
  check(/tangled/.test(h.msg) && h.glow === 0, `${tag}: Hint says the painting has gotten tangled ("${h.msg.slice(0, 60)}…")`);
  await geometry(page, `${tag} dead end`);
  await shot('16-lift-back-offered');
  const n0 = await page.evaluate(() => window.tincture.game.state.lift.game.moves.length);
  await tap(page, '#lf-backBtn');
  await page.waitForTimeout(150);
  await shot('17-lift-back-stepping');
  await page.waitForFunction(() => !window.__lf.debugLift().stepping && /Took back/.test(document.querySelector('#lf-msg').textContent), null, { timeout: 15000 }).catch(() => {});
  const back = await page.evaluate(() => {
    const { ctx, game } = window.tincture;
    const cur = ctx.sim.lift.current(game.state);
    return { n: game.state.lift.game.moves.length, dead: ctx.sim.lift.deadEnd(game.state), nudge: ctx.puzzles.lift.canNudge(cur.s), msg: document.querySelector('#lf-msg').textContent, btn: !document.querySelector('#lf-backBtn').hidden };
  });
  check(back.n < n0 && !back.dead, `${tag}: Back to solvable took back ${n0 - back.n} move(s) to a solvable position`);
  check(back.nudge, `${tag}: the spare bench spot is not spent`);
  check(/Took back \d+ moves?\./.test(back.msg) && !back.btn, `${tag}: a line says so and the button is gone ("${back.msg}")`);
  await idle(page);
  await shot('18-lift-back-done');
  h = await timedHint();
  check(h.glow === 1, `${tag}: and Hint points the way from there ("${h.msg}")`);

  // From the gallery menu on a fine painting.
  await tap(page, '#lf-levelsBtn');
  await page.waitForSelector('#lf-levelSheet:not([hidden])', { state: 'visible' });
  const n1 = await page.evaluate(() => window.tincture.game.state.lift.game.moves.length);
  await tap(page, '#lf-backMenuBtn');
  await page.waitForFunction(() => /on track/.test(document.querySelector('#lf-msg').textContent), null, { timeout: 8000 }).catch(() => {});
  check(/You.re on track/.test(await page.locator('#lf-msg').textContent()), `${tag}: from the menu on a fine painting: "You're on track"`);
  check(await page.evaluate(() => window.tincture.game.state.lift.game.moves.length) === n1, `${tag}: and nothing was taken back`);

  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/**
 * Chapters: an older save with the first 27 paintings lifted. The finish sheet
 * says a new room is open, the wall folds the finished rooms and rings the next
 * painting, Continue leads into chapter 4 and its card greets her once; a late
 * painting with crocks and a jar left out plays mid-way and fits the screen.
 */
async function chapterWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.evaluate((old) => {
    const { game, ctx } = window.tincture;
    game.act((st) => {
      st.unlocks.lift = true;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), lift: true };
      for (const id of ctx.puzzles.liftLevels.LEVEL_IDS.slice(0, 26)) st.lift.done[id] = 1;
      for (const k of old) st.lift.seenIntro[k] = true;
      return {};
    }, {});
    // The sampler, played to the end through the sim, as she would have.
    game.act(ctx.sim.lift.startPainting, { levelId: 'sampler' });
    for (const m of ctx.puzzles.liftLevels.levelById('sampler').solution.split(' ')) game.act(ctx.sim.lift.move, { move: m });
    game.save();
  }, OLD_INTROS);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  check(await page.evaluate(() => Object.keys(window.tincture.game.state.lift.done).length === 27), `${tag}: the first 27 paintings lifted`);

  // The hub card, then the table: the finish sheet says a new room is open.
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-lift [data-action="open-lift"]', { state: 'visible' });
  const card = (await page.locator('#pz-lift').textContent()).replace(/\s+/g, ' ');
  check(/27 paintings lifted/.test(card), `${tag}: the hub card counts the lifted paintings ("${card.trim().slice(0, 90)}")`);
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#lf-finishSheet:not([hidden])', { state: 'visible', timeout: 8000 });
  const room = (await page.locator('#lf-finRoom').textContent()).trim();
  check(/The whole table is lifted\. A new room is open: The kitchen garden/.test(room) && await page.locator('#lf-finRoom').isVisible(), `${tag}: the finish sheet opens the next room ("${room}")`);
  check(/Sunflower/.test(await page.locator('#lf-finNext').textContent()), `${tag}: and offers its first painting`);
  await page.waitForTimeout(700);
  await shot('c1-finish-new-room');

  // The wall: finished rooms fold, the next painting is ringed, Continue on top.
  await tap(page, '#lf-finAll');
  await page.waitForSelector('#lf-levelSheet:not([hidden])', { state: 'visible' });
  const w = await page.evaluate(() => ({
    folded: [...document.querySelectorAll('#lf-wall [data-room-show]')].map((b) => b.dataset.roomShow),
    open: document.querySelectorAll('#lf-wall .lf-room:not(.lf-shut)').length,
    next: document.querySelector('#lf-wall .lf-nextup')?.dataset.level,
    cont: document.querySelector('#lf-contBtn')?.dataset.level,
    contText: document.querySelector('#lf-contBtn')?.textContent,
    ticks: document.querySelectorAll('#lf-wall .lf-tick').length,
  }));
  check(w.folded.join() === 'first,tricks', `${tag}: finished rooms fold away (${w.folded.join()})`);
  check(w.open === 4 && w.ticks === 8, `${tag}: four rooms open; the whole table shows its eight ticks (${w.open}, ${w.ticks})`);
  check(w.next === 'sunflower' && w.cont === 'sunflower' && /Kitchen garden/i.test(w.contText), `${tag}: Continue leads into chapter 4 ("${(w.contText || '').trim()}")`);
  await page.evaluate(() => document.querySelector('#lf-wall .lf-nextup')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(350);
  await shot('c2-gallery-chapters');
  await tap(page, '#lf-wall [data-room-show="first"]');
  check(await page.locator('#lf-wall [data-room="first"] .lf-tick').count() === 10, `${tag}: a folded room unfolds with its ten ticks`);

  // Into the new room: its card, once.
  await tap(page, '#lf-contBtn');
  await page.waitForSelector('#lf-chapterSheet:not([hidden])', { state: 'visible', timeout: 4000 });
  const ch = await page.evaluate(() => ({ no: document.querySelector('#lf-chNo').textContent, name: document.querySelector('#lf-chName').textContent, thumbs: document.querySelectorAll('#lf-chStrip canvas').length }));
  check(ch.name === 'The kitchen garden' && /Chapter 4 of 10/.test(ch.no) && ch.thumbs === 11, `${tag}: chapter 4's card (${ch.no}, ${ch.name}, ${ch.thumbs} paintings)`);
  await page.waitForTimeout(300);
  await shot('c3-chapter-intro');
  await tap(page, '#lf-chOk');
  check(await page.evaluate(() => window.tincture.game.state.lift.seenIntro['chapter:garden'] === true), `${tag}: the chapter card is remembered`);
  check(await page.locator('#screen-lift .lf-sheet:not([hidden])').count() === 0, `${tag}: no other card (the mechanics are old friends)`);
  check((await page.locator('#lf-lvNo').textContent()).trim() === '4·1', `${tag}: the head reads chapter 4, painting 1`);
  const sol = await page.evaluate(() => window.tincture.ctx.puzzles.liftLevels.levelById('sunflower').solution.split(' '));
  for (const m of sol.slice(0, 3)) await tapMove(page, m);
  check((await liftState(page)).game.moves.length === 3, `${tag}: the sunflower plays`);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.evaluate(() => window.tincture.ctx.navigate('lift'));
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await page.waitForTimeout(300);
  check(await page.locator('#screen-lift .lf-sheet:not([hidden])').count() === 0, `${tag}: after a reload, no card again; the sunflower waits as it was`);
  check((await liftState(page)).game.moves.length === 3, `${tag}: three moves kept`);
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForSelector('#pz-lift [data-action="open-lift"]', { state: 'visible' });
  const card2 = (await page.locator('#pz-lift').textContent()).replace(/\s+/g, ' ');
  check(/Chapter 4, The kitchen garden · Sunflower · \d+% lifted/.test(card2) && /Continue lifting/.test(card2), `${tag}: the hub card names the chapter ("${card2.trim().slice(0, 100)}")`);

  // A late painting mid-play: crocks, a jar left out, a short belt and a small bench.
  await liftedUpTo(page, 'gingerbread', ['crock', 'leftover', 'chapter:kitchen', 'chapter:wool', 'chapter:water', 'chapter:woodland', 'chapter:winter']);
  const start = await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    const r = game.act(ctx.sim.lift.startPainting, { levelId: 'gingerbread' });
    const L = ctx.puzzles.liftLevels.levelById('gingerbread');
    return { ok: r.ok, left: L.left.length, crocks: L.lanes.flat().filter((j) => j.heavy).length, slots: L.slots, bench: L.bench, n: L.solution.split(' ').length };
  });
  check(start.ok && start.left === 1 && start.crocks > 0 && start.slots === 3 && start.bench === 2, `${tag}: the gingerbread house: ${start.crocks} crocks, a jar left out, belt 3, bench 2`);
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await idle(page);
  check(await page.locator('#lf-bench .lf-jar[data-id="b.0"]').count() === 1, `${tag}: the jar left out rests on the bench from the start`);
  check(await page.locator('#lf-lanes .lf-jar.lf-crock').count() > 0 || start.crocks > 0, `${tag}: crocks wait in the lanes`);
  await page.evaluate((n) => {
    const { game, ctx } = window.tincture;
    for (const m of ctx.puzzles.liftLevels.levelById('gingerbread').solution.split(' ').slice(0, n)) game.act(ctx.sim.lift.move, { move: m });
  }, Math.floor(start.n / 2));
  await page.evaluate(() => { window.tincture.ctx.navigate('puzzles'); });
  await page.waitForSelector('#pz-lift [data-action="open-lift"]', { state: 'visible' });
  await tap(page, '#pz-lift [data-action="open-lift"]');
  await page.waitForSelector('#screen-lift #lf-lanes .lf-front', { state: 'visible' });
  await idle(page);
  await geometry(page, `${tag} gingerbread (27 x 36)`);
  const crockOnBelt = await page.evaluate(() => { const b = [...document.querySelectorAll('#lf-belt .lf-slotbtn')]; const k = b.findIndex((el) => el.querySelector('.lf-crock')); return k >= 0 ? b[k].dataset.i : null; });
  if (crockOnBelt !== null) {
    await tap(page, `#lf-belt .lf-slotbtn[data-i="${crockOnBelt}"]`);
    check(/too heavy for the bench/.test(await page.locator('#lf-msg').textContent()), `${tag}: a crock tapped on the belt explains itself`);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => { const m = document.querySelector('#lf-msg'); if (m && /too heavy/.test(m.textContent)) return; });
  await shot('c4-late-painting-mid-play');
  const cs = await page.evaluate(() => window.__lf.debugLift().painter.cs);
  check(cs >= 6, `${tag}: the gingerbread house's cells are ${cs.toFixed(1)} px`);

  // The wall late on: nine rooms folded, Continue still on top.
  await tap(page, '#lf-levelsBtn');
  await page.waitForSelector('#lf-levelSheet:not([hidden])', { state: 'visible' });
  const w2 = await page.evaluate(() => ({ folded: document.querySelectorAll('#lf-wall [data-room-show]').length, cont: document.querySelector('#lf-contBtn')?.dataset.level, contText: document.querySelector('#lf-contBtn')?.textContent }));
  check(w2.folded === 9 && w2.cont === 'gingerbread' && /Continue lifting/.test(w2.contText), `${tag}: late on, nine rooms folded and Continue lifting the gingerbread house (${w2.folded})`);
  await page.waitForTimeout(350);
  await shot('c5-gallery-late');
  await geometry(page, `${tag} late wall`);

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
  await hintWalk({ width: 390, height: 844 }, '390');
  await chapterWalk({ width: 390, height: 844 }, '390');
  await chapterWalk({ width: 360, height: 740 }, '360');
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
