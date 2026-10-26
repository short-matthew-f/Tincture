// Tincture — test/limits.e2e.mjs
// Responsibility mode (src/sim/limits.js, src/ui/rest.js) in headless Chromium at
// 390 x 844 with touch:
//  - it is on by default at 5 plays an hour; grading boards started 5 times
//    (by touch on the Puzzles hub and through the sim, as a guide's deep link would);
//  - at 3 of 5 the hub card says "2 plays left this hour", quietly;
//  - mid-board with the limit reached she keeps playing ("Continue board"), and
//    the card says when it rests until; no "New board" button;
//  - with nothing to continue the card shows the leaf note "Rests until 3:42 PM";
//  - a 6th start opens the gentle sheet (title, clock time, "Back to the workshop",
//    "Change this in Settings"), starts nothing and is never red;
//  - another resting room (the Tile Room) shows the same note; others stay open;
//  - Settings: the section, the default choices, and turning it off lets her start;
//  - no horizontal scroll at 390 px, no page errors.
// Run: node test/limits.e2e.mjs   (screenshots: $LIMITS_SHOTS or the OS temp dir)

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.LIMITS_SHOTS || path.join(os.tmpdir(), 'tincture-limits-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

let pw = null;
try { pw = createRequire('/opt/node-tools/node_modules/')('playwright'); } catch (e) {
  try { pw = await import('playwright'); pw = pw.chromium ? pw : pw.default; } catch (e2) { pw = null; }
}
if (!pw || !pw.chromium) { console.log('SKIP limits.e2e: Playwright not found'); process.exit(0); }

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

const HUB = 'section[data-screen="puzzles"]';
const SHEET = '#modal .sheet';
const plays = (page, id) => page.evaluate((g) => {
  const t = window.tincture;
  return t.ctx.sim.limits.playsIn(t.game.state, g, t.game.now()).length;
}, id);
const topId = (page) => page.evaluate(() => { const c = window.tincture.router && window.tincture.router.current && window.tincture.router.current(); return c ? c.id : null; });
const noHScroll = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const wide = [...document.querySelectorAll('section[data-screen]:not([hidden]) .screen-body, #modal .sheet')].filter((el) => el.scrollWidth > el.clientWidth + 1);
  return se.scrollWidth <= se.clientWidth + 1 && window.scrollX === 0 && wide.length === 0;
});
/** The clock time limits.readyAt names, as the screen formats it. */
const readyText = (page, id) => page.evaluate((g) => {
  const t = window.tincture;
  const at = t.ctx.sim.limits.readyAt(t.game.state, g, t.game.now());
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}, id);

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__pz = await import('./src/ui/puzzles.js'); });
}

/** Past the first sessions: 30 colors (silently), every guide seen, the Tile Room bought. Responsibility mode left as it comes. */
async function seed(page) {
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true, gradingNext: true, tiles: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 30) break;
        if (!st.catalog.discovered[c.id]) st.catalog.discovered[c.id] = { at: now, name: c.name, custom: false, essence: 0 };
      }
      st.lifetime.puzzles = 3;
      st.coins = 2000;
      st.unlocks.tiles = true;
      return {};
    }, {});
    game.save();
  });
}

/** A board through the sim, as a guide or quest deep link would make one (inside game.act, so it saves). */
const simBoard = (page) => page.evaluate(() => {
  const { game, ctx } = window.tincture;
  return !!game.act((s, _a, now) => window.__pz.createGradingBoard(ctx, s, {}, now));
});

async function backToHub(page) {
  if ((await topId(page)) === 'grading') await tap(page, 'section[data-screen="grading"] [data-back]');
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'puzzles'; }, null, { timeout: 5000 });
  await page.waitForTimeout(700); // the hub holds its redraw for 400 ms after a finger lifts
}

async function walk() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
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
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  const cfg = await page.evaluate(() => { const s = window.tincture.game.state.settings; return [s.responsibleMode, s.playLimit, s.playWindowMin]; });
  must(JSON.stringify(cfg) === '[true,5,60]', `Responsibility mode is on by default: 5 plays within an hour (${cfg})`);

  // --- plays 1 to 3 -------------------------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-grading', { state: 'visible' });
  check(await page.locator('#pz-grading [data-rest-line]').count() === 0, 'no plays-left line before she has played');
  await tap(page, '#pz-grading [data-action="new-grading"]:not([data-mode])');
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'grading'; }, null, { timeout: 5000 });
  must(await plays(page, 'grading') === 1, 'New grading board (by touch) records play 1');
  await backToHub(page);
  must(await simBoard(page) && await simBoard(page), 'two more boards through the sim');
  must(await plays(page, 'grading') === 3, 'three plays recorded');
  await page.waitForTimeout(300);
  const left2 = (await page.locator('#pz-grading [data-rest-line]').textContent() || '').trim();
  check(left2 === '2 plays left this hour', `at 3 of 5 the card says "${left2}"`);
  check(await page.evaluate(() => { const el = document.querySelector('#pz-grading [data-rest-line]'); const c = getComputedStyle(el).color; return !/rgb\((1[5-9]\d|2\d\d), ?([0-9]|[1-9]\d), ?([0-9]|[1-9]\d)\)/.test(c); }), 'the line is soft ink, never red');
  await page.evaluate(() => document.querySelector('#pz-grading').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(150);
  await shot('limits-hub-plays-left');
  check(await noHScroll(page), 'hub: no horizontal scroll at 390 px');

  // --- plays 4 and 5; Continue is never blocked --------------------------------------------
  await tap(page, '#pz-grading [data-action="new-grading"]:not([data-mode])');
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'grading'; }, null, { timeout: 5000 });
  must(await plays(page, 'grading') === 4, 'New board (by touch, a board already waiting) records play 4');
  await backToHub(page);
  const left1 = await page.locator('#pz-grading [data-rest-line]').count() ? ((await page.locator('#pz-grading [data-rest-line]').textContent()) || '').trim() : '(none)';
  check(left1 === '1 play left this hour', `at 4 of 5: "${left1}"`);
  must(await simBoard(page), 'a fifth board through the sim');
  must(await plays(page, 'grading') === 5, 'five plays recorded');
  await page.waitForTimeout(300);
  check(await page.locator('#pz-grading [data-action="continue-grading"]').count() === 1, 'mid-board at the limit: Continue board stays');
  check(await page.locator('#pz-grading [data-action="new-grading"]').count() === 0, 'and no New board button while it rests');
  const at = await readyText(page, 'grading');
  const finishLine = ((await page.locator('#pz-grading [data-rest-line]').textContent()) || '').trim();
  check(finishLine === `This one is yours to finish. Then it rests until ${at}.`, `the card says so: "${finishLine}"`);
  await tap(page, '#pz-grading [data-action="continue-grading"]');
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'grading'; }, null, { timeout: 5000 });
  check(await page.locator('section[data-screen="grading"] .gr-tile').count() > 0 && await plays(page, 'grading') === 5, 'continuing the board opens it and records nothing');
  await backToHub(page);

  // --- the board is done: the card rests -------------------------------------------------
  await page.evaluate(() => { window.tincture.game.act((s) => { s.activePuzzles.grading = null; return {}; }, {}); });
  await page.waitForTimeout(300);
  const note = page.locator('#pz-grading .rest-note[data-rest="grading"]');
  must(await note.count() === 1, 'with nothing to continue, the card shows the resting note');
  const noteText = ((await note.textContent()) || '').trim();
  check(noteText === `Rests until ${at}`, `the note reads "${noteText}"`);
  check(await page.locator('#pz-grading .rest-note svg').count() === 1, 'with a small leaf');
  check(/^\d{1,2}:\d{2}\s?(AM|PM)?$/i.test(at), `a clock time, not a countdown (${at})`);
  await page.evaluate(() => document.querySelector('#pz-grading').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(150);
  await shot('limits-hub-resting');

  // --- the 6th start: the gentle sheet --------------------------------------------------
  // A deep link to a fresh board (a guide, a quest): nothing starts, the sheet explains.
  await page.evaluate(() => window.tincture.ctx.navigate('grading', {}));
  await page.waitForSelector(SHEET, { state: 'visible', timeout: 5000 });
  must(await plays(page, 'grading') === 5, 'the 6th start records nothing');
  check(await page.evaluate(() => !window.tincture.game.state.activePuzzles.grading), 'and starts no board');
  const sheet = await page.evaluate(() => {
    const el = document.querySelector('#modal .sheet');
    return {
      title: (el.querySelector('.modal-title') || {}).textContent || '',
      body: (el.querySelector('.modal-body') || {}).textContent || '',
      primary: [...el.querySelectorAll('.btn-primary')].map((b) => b.textContent.trim()),
      link: [...el.querySelectorAll('.overlay-link')].map((b) => b.textContent.trim()),
      red: [...el.querySelectorAll('*')].some((n) => { const c = getComputedStyle(n).color; const m = c.match(/rgb\((\d+), (\d+), (\d+)/); return m && +m[1] > 150 && +m[2] < 90 && +m[3] < 90; }),
    };
  });
  check(sheet.title === 'Time for a rest from grading boards', `sheet title: "${sheet.title}"`);
  check(sheet.body.includes("You've played 5 boards this hour.") && sheet.body.includes(`It'll be ready again at ${at}.`) && sheet.body.includes("Your workshop keeps making color while you're away."), `sheet body: "${sheet.body.trim()}"`);
  check(JSON.stringify(sheet.primary) === '["Back to the workshop"]' && JSON.stringify(sheet.link) === '["Change this in Settings"]', `buttons: ${JSON.stringify(sheet)}`);
  check(!sheet.red, 'nothing in the sheet is red');
  await page.waitForTimeout(350);
  await shot('limits-rest-sheet');
  check(await noHScroll(page), 'sheet: no horizontal scroll at 390 px');
  await tap(page, `${SHEET} .btn-primary`);
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'workshop'; }, null, { timeout: 5000 });
  check(true, '"Back to the workshop" goes to the workshop');

  // The resting note on the hub opens the same sheet.
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await tap(page, '#pz-grading .rest-note');
  await page.waitForSelector(SHEET, { state: 'visible', timeout: 5000 });
  check(((await page.locator(`${SHEET} .modal-title`).textContent()) || '') === 'Time for a rest from grading boards', 'tapping the leaf note opens the gentle sheet');
  await tap(page, `${SHEET} .overlay-link`);
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'settings'; }, null, { timeout: 5000 });
  check(true, '"Change this in Settings" opens Settings');

  // --- Settings ----------------------------------------------------------------------
  const card = page.locator('[data-settings-rest]');
  await card.waitFor({ state: 'visible' });
  const st = await page.evaluate(() => {
    const el = document.querySelector('[data-settings-rest]');
    const r = el.getBoundingClientRect();
    return {
      inView: r.top >= 0 && r.top < window.innerHeight - 100,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      on: el.querySelector('[data-toggle="responsibleMode"]').getAttribute('aria-checked'),
      limit: [...el.querySelectorAll('[data-seg="playLimit"]')].map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
      win: [...el.querySelectorAll('[data-seg="playWindowMin"]')].map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
    };
  });
  check(st.inView, 'Settings opens at the Responsibility mode section');
  check(st.text.includes('Each game can be played this many times in this window, then it rests until the window has passed.'), 'the plain explaining line');
  check(st.on === 'true' && JSON.stringify(st.limit) === '["3","5*","8","10"]' && JSON.stringify(st.win) === '["30 minutes","1 hour*","2 hours"]', `toggle on, 5 plays, 1 hour (${JSON.stringify(st)})`);
  await page.evaluate(() => { const el = document.querySelector('[data-settings-rest]'); const b = el.closest('.screen-body'); b.scrollTop = el.offsetTop - b.offsetTop - 8; });
  await page.waitForTimeout(150);
  await shot('limits-settings');
  check(await noHScroll(page), 'Settings: no horizontal scroll at 390 px');
  await tap(page, '[data-settings-rest] [data-seg="playLimit"][data-value="8"]');
  check(await page.evaluate(() => window.tincture.game.state.settings.playLimit) === 8, 'plays per game: 8 is saved as a number');
  await tap(page, '[data-settings-rest] [data-seg="playLimit"][data-value="5"]');
  await tap(page, '[data-settings-rest] [data-toggle="responsibleMode"]');
  check(await page.evaluate(() => window.tincture.game.state.settings.responsibleMode) === false, 'the toggle turns it off');

  // --- off: she can start again at once ------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-grading [data-action="new-grading"]', { state: 'visible', timeout: 5000 });
  check(await page.locator('#pz-grading .rest-note').count() === 0 && await page.locator('#pz-grading [data-rest-line]').count() === 0, 'off: no note, no plays-left line');
  await tap(page, '#pz-grading [data-action="new-grading"]:not([data-mode])');
  await page.waitForFunction(() => { const c = window.tincture.router.current(); return c && c.id === 'grading'; }, null, { timeout: 5000 });
  check(await page.evaluate(() => !!window.tincture.game.state.activePuzzles.grading) && !(await page.locator(SHEET).count()), 'off: a sixth board starts');
  check(await page.evaluate(() => window.tincture.game.state.plays.grading.length) === 5, 'off: the earlier plays are kept, nothing new is noted');
  await backToHub(page);

  // --- on again, and per-game: the Tile Room rests on its own -----------------------------
  await page.evaluate(() => {
    const { game } = window.tincture;
    game.setSetting('responsibleMode', true);
    game.act((s, _a, now) => { s.activePuzzles.grading = null; for (let i = 0; i < 5; i++) window.tincture.ctx.sim.limits.recordStart(s, 'tiles', now); return {}; }, {});
  });
  await page.waitForTimeout(300);
  check(await page.locator('#pz-grading .rest-note').count() === 1, 'back on: grading rests again (the plays were kept)');
  const tilesNote = page.locator('#pz-tiles .rest-note[data-rest="tiles"]');
  check(await tilesNote.count() === 1 && ((await tilesNote.textContent()) || '').trim() === `Rests until ${await readyText(page, 'tiles')}`, 'the Tile Room card rests on its own');
  check(await page.locator('#pz-tiles [data-action="open-tiles"]').count() === 0, 'with no broken button');
  check(await page.locator('#pz-purify .rest-note').count() === 0, 'Purify, never played, is not resting');
  await page.evaluate(() => document.querySelector('#pz-tiles').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await shot('limits-hub-tiles-resting');
  // Time passing frees it (absolute times; debug.advance moves every clock back).
  await page.evaluate(() => window.tincture.debug.advance(61 * 60e3));
  await page.evaluate(() => { const ov = document.querySelector('#modal'); if (ov && !ov.hidden) ov.click(); });
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForTimeout(400);
  check(await page.locator('#pz-tiles .rest-note').count() === 0 && await page.locator('#pz-grading .rest-note').count() === 0, 'an hour later both are ready again');
  check(await noHScroll(page), 'hub: still no horizontal scroll');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

try {
  browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  await waitForServer(URL_);
  await walk();
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Responsibility mode checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
