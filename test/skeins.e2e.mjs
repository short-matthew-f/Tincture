// Tincture — test/skeins.e2e.mjs
// The Winding Room (Skein Stacks) walked end to end in headless Chromium with
// real touch input (isMobile, hasTouch, DPR 2; drags through CDP
// Input.dispatchTouchEvent, so touch-action and pointer capture are real) at
// 390x844 and 360x740:
//  - the workshop's Next names the Winding Room at 12+ colors; the sheet buys
//    it, the ceremony plays, a two-choice card offers the way in;
//  - the Puzzles hub card shows the price; buying it there opens the room;
//  - the guide: at most 2 steps before the first action, the first IS the
//    action (no Got it), the second is shown after her first move;
//  - level 1 played to the end by touch (drags and tap-then-peg), coins land
//    on the chip as hanks are tied, the finished shelf and "Next: level 2";
//  - a reload mid-level (right after a placement, mid-flight) resumes exactly;
//  - 44 px controls, no horizontal scroll, the dock inside the viewport and
//    the tab bar hidden, no console errors;
//  - 112 levels in chapters: her finished levels from a save, the hub card's
//    "Play level N", the level list (Continue, chapter sections, done ticks,
//    the next level highlighted), each newer mechanic's intro card shown once
//    and drawn on its board (snarls, an order slip, the basket, felted
//    stacks, spindle pegs, the next-tray peek, untangling), silhouette boards
//    (heart, sheep, mitten, teapot, star, flower) fitting at 360 px, Continue
//    after a finished level, and a reload mid-level on a mechanic level.
// Run: node test/skeins.e2e.mjs   (screenshots: $SKEINS_SHOTS or the OS temp dir)

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.SKEINS_SHOTS || path.join(os.tmpdir(), 'tincture-skeins-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  const unwrap = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  try { const pw = unwrap(await import('playwright')); if (pw) return pw; } catch (e) { /* fall through */ }
  try { const pw = unwrap(createRequire('/opt/node-tools/node_modules/')('playwright')); if (pw) return pw; } catch (e) { /* fall through */ }
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
if (!pw) { console.log('SKIP skeins.e2e: Playwright not found'); process.exit(0); }

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

/** A real touch drag: touchstart on the tray slot, moves to the peg (the stack rides LIFT px above the finger), touchend. */
async function touchDrag(page, cdp, t, cell) {
  const from = await page.locator(`#screen-skeins .sk-tslot[data-t="${t}"]`).boundingBox();
  const to = await page.evaluate((i) => {
    const d = window.__sk.debugSkeins();
    const p = d.pegCenter(i);
    return { x: p.x, y: p.y + d.liftPx };
  }, cell);
  const x0 = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
  await touch('touchStart', x0, y0);
  const N = 8;
  for (let i = 1; i <= N; i++) {
    await touch('touchMove', x0 + (to.x - x0) * (i / N), y0 + (to.y - y0) * (i / N));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(40);
  await touch('touchEnd', to.x, to.y);
}

const idle = (page, ms = 20000) => page.waitForFunction(() => window.__sk && !window.__sk.debugSkeins().busy, null, { timeout: ms });
const sk = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.skeins)));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__sk = await import('./src/ui/skeins.js'); });
}

/** A workshop in its second session: 13 colors (silently), 2,000 coins, the shelf bought, onboarding and other guides done. */
async function seed(page) {
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, purify: true, grading: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 13) break;
        if (!st.catalog.discovered[c.id]) st.catalog.discovered[c.id] = { at: now, name: c.name, custom: false, essence: 0 };
      }
      st.coins = 2000;
      st.unlocks.shelf = true;
      st.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
      return {};
    }, {});
    game.save();
  });
}

async function geometry(page, label) {
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-skeins');
    const body = sec.querySelector('.screen-body');
    const dock = sec.querySelector('[data-dock]');
    const small = [...sec.querySelectorAll('.sk-actions .btn, .sk-foot .btn, .sk-tslot, .btn-back, .how-link, [data-levelbtn], .sk-sheet:not([hidden]) .btn, .sk-sheet:not([hidden]) [data-level], .sk-sheet:not([hidden]) .sk-chhead')]
      .filter((el) => el.getClientRects().length)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    const dr = dock ? dock.getBoundingClientRect() : null;
    const tab = document.getElementById('tabbar');
    const board = sec.querySelector('[data-board]');
    const br = board ? board.getBoundingClientRect() : null;
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      dockBottom: dr ? dr.bottom : -1, vh: innerHeight, vw: innerWidth, tabHidden: !tab || tab.hidden || tab.getBoundingClientRect().height === 0,
      boardRight: br ? br.right : 0, boardLeft: br ? br.left : 0,
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.boardLeft >= 0 && g.boardRight <= g.vw, `${label}: the board fits the width (${Math.round(g.boardLeft)}..${Math.round(g.boardRight)} of ${g.vw})`);
  check(g.dockBottom > 0 && g.dockBottom <= g.vh + 0.5, `${label}: the dock sits inside the viewport (${g.dockBottom} <= ${g.vh})`);
  check(g.tabHidden, `${label}: the tab bar is hidden under the Winding Room`);
  check(g.small.length === 0, `${label}: every control is at least 44 px (${JSON.stringify(g.small.slice(0, 3))})`);
}

/** The prototype's greedy pick: {t, cell} or {clear: cell} when the board is full. */
function chooseMove(page) {
  return page.evaluate(() => {
    const R = window.tincture.ctx.puzzles.skeins;
    const s = window.tincture.game.state.skeins.sess.state;
    const m = R.bestPlacement(s);
    if (m.t < 0) return { clear: R.botClearChoice(s) };
    return { t: m.t, cell: m.cell };
  });
}

async function playMove(page, cdp, { drag }) {
  const mv = await chooseMove(page);
  if (mv.clear !== undefined) {
    await tap(page, '#screen-skeins [data-act="clear"]');
    await tap(page, `#screen-skeins .sk-peg[data-cell="${mv.clear}"]`);
    await idle(page);
    return 'clear';
  }
  if (drag) await touchDrag(page, cdp, mv.t, mv.cell);
  else {
    await tap(page, `#screen-skeins .sk-tslot[data-t="${mv.t}"]`);
    await page.waitForFunction((t) => window.__sk.debugSkeins().sel === t, mv.t, { timeout: 3000 });
    await tap(page, `#screen-skeins .sk-peg[data-cell="${mv.cell}"]`);
  }
  await page.waitForTimeout(30);
  await idle(page);
  return 'place';
}

function trackErrors(page) {
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

// ---------------------------------------------------------------------------
// The walks
// ---------------------------------------------------------------------------

async function walk(viewport, tag) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = trackErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  // --- the hub card and the unlock ----------------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-skeins', { state: 'visible' });
  must(await page.locator('#pz-skeins [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Winding Room card carries the price button`);
  check(/1,500|1\.5K/.test(await page.locator('#pz-skeins').textContent()), `${tag}: the card names the price`);
  await page.evaluate(() => document.querySelector('#pz-skeins').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-skeins [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.skeins === true);
  check(await page.evaluate(() => window.tincture.game.state.coins) <= 600, `${tag}: buying the Winding Room spent 1,500 coins`);
  await page.waitForSelector('#pz-skeins [data-action="open-skeins"]', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#pz-skeins').scrollIntoView({ block: 'center' }));
  await shot('03-hub-open');

  // --- the room and the guide -------------------------------------------------------------------
  await tap(page, '#pz-skeins [data-action="open-skeins"]');
  await page.waitForSelector('#screen-skeins .sk-tslot', { state: 'visible' });
  const s0 = await sk(page);
  check(s0.sess && s0.sess.state.level === 0 && s0.sess.state.moves === 0, `${tag}: level 1 is dealt`);
  const yarn = await page.evaluate(() => {
    const st = window.tincture.game.state;
    const ids = st.skeins.sess.state.colors;
    return { n: new Set(ids).size, disc: ids.every((id) => st.catalog.discovered[id]), fams: new Set(ids.map((id) => window.tincture.ctx.sim.economy.colorFamily(id))).size };
  });
  check(yarn.n === 6 && yarn.disc, `${tag}: six yarns from her own discovered colors (${yarn.fams} hue families)`);
  const lvl = await page.locator('#screen-skeins [data-lvlname]').textContent();
  check(/Level 1/.test(lvl), `${tag}: the goal names the level ("${lvl.trim()}")`);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Drag a stack/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button`);
  await shot('04-guide-1');
  await geometry(page, `${tag} board`);

  // First move: a real touch drag.
  const coins0 = await page.evaluate(() => window.tincture.game.state.coins);
  await playMove(page, cdp, { drag: true });
  check((await sk(page)).sess.state.moves === 1, `${tag}: a touch drag placed the first stack`);
  await page.waitForSelector('#guide-layer [data-coach-action]', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/hank/.test(bubble2), `${tag}: the second step explains hanks ("${(bubble2 || '').trim()}")`);
  await shot('05-guide-2');
  if (await page.locator('#guide-layer [data-coach-action]').count()) await tap(page, '#guide-layer [data-coach-action]');
  await page.waitForFunction(() => !!window.tincture.game.state.onboarding.seen.skeins, null, { timeout: 4000 }).catch(() => {});
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.skeins), `${tag}: the guide is marked seen`);

  // A few more moves with full motion, alternating drag and tap-then-peg; screenshot a chain or a hank in flight.
  let tookFlight = false;
  for (let i = 0; i < 6; i++) {
    const mv = await chooseMove(page);
    if (mv.clear !== undefined) { await playMove(page, cdp, { drag: false }); continue; }
    if (i % 2) await touchDrag(page, cdp, mv.t, mv.cell);
    else {
      await tap(page, `#screen-skeins .sk-tslot[data-t="${mv.t}"]`);
      await tap(page, `#screen-skeins .sk-peg[data-cell="${mv.cell}"]`);
    }
    if (!tookFlight) { await page.waitForTimeout(260); await shot('06-in-flight'); tookFlight = true; }
    await idle(page);
  }

  // --- reload mid-level: right after a placement, mid-flight ----------------------------------------
  {
    const mv = await chooseMove(page);
    if (mv.clear === undefined) {
      await tap(page, `#screen-skeins .sk-tslot[data-t="${mv.t}"]`);
      await tap(page, `#screen-skeins .sk-peg[data-cell="${mv.cell}"]`);
    } else await playMove(page, cdp, { drag: false });
    await page.waitForTimeout(60);
    const before = await sk(page);
    await page.reload({ waitUntil: 'load' });
    await boot(page);
    const after = await sk(page);
    check(JSON.stringify(after) === JSON.stringify(before), `${tag}: a reload mid-flight keeps the level exactly (move ${after.sess.state.moves})`);
    await tap(page, '#tabbar [data-tab="puzzles"]');
    await page.waitForSelector('#pz-skeins [data-action="open-skeins"]', { state: 'visible' });
    const card = (await page.locator('#pz-skeins').textContent()).replace(/\s+/g, ' ').trim();
    check(/Continue level 1/.test(card) && /of 6 hanks/.test(card), `${tag}: the hub card shows her level at a glance ("${card.slice(0, 90)}")`);
    await page.evaluate(() => document.querySelector('#pz-skeins').scrollIntoView({ block: 'center' }));
    await shot('07-hub-continue');
    await tap(page, '#pz-skeins [data-action="open-skeins"]');
    await page.waitForSelector('#screen-skeins .sk-tslot', { state: 'visible' });
    const resumed = await sk(page);
    check(JSON.stringify(resumed.sess.state) === JSON.stringify(before.sess.state), `${tag}: the room opens on the same board`);
  }

  // --- the rest of level 1 (reduced motion keeps it quick) ------------------------------------------------
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let coinRises = 0;
  let last = await page.evaluate(() => window.tincture.game.state.coins);
  let chipOk = true;
  for (let i = 0; i < 120; i++) {
    const s = await sk(page);
    if (s.sess.state.done) break;
    await playMove(page, cdp, { drag: i % 3 === 0 });
    const c = await page.evaluate(() => window.tincture.game.state.coins);
    if (c > last + 1e-9) {
      coinRises++;
      const chip = await page.evaluate(() => document.querySelector('#screen-skeins [data-coins]').textContent);
      const want = await page.evaluate((v) => window.tincture.ctx.format.num(v < 100 ? Math.max(1, Math.round(v)) : v), c);
      if (chip.trim() !== want.trim()) chipOk = false;
    }
    last = c;
  }
  const s1 = await sk(page);
  must(s1.sess.state.done, `${tag}: level 1 finishes (${s1.sess.state.moves} moves, ${s1.sess.state.hanks.length} hanks)`);
  check(coinRises > 0 && last > coins0, `${tag}: coins landed as hanks were tied (${coinRises} times, +${Math.round(last - coins0)})`);
  check(chipOk, `${tag}: the coins chip shows her coins once the hank has landed`);
  await page.waitForSelector('#screen-skeins [data-done]:not([hidden])', { state: 'visible', timeout: 6000 });
  const done = (await page.locator('#screen-skeins [data-done]').textContent()).replace(/\s+/g, ' ');
  check(/finished/.test(done) && /hanks/.test(done) && /earned/.test(done), `${tag}: the finished shelf shows the hanks and the coins ("${done.trim().slice(0, 100)}")`);
  check(/Next: level 2/.test(done), `${tag}: the shelf offers the next level`);
  check(s1.finished[0] === true && s1.levels === 1, `${tag}: level 1 is recorded as finished`);
  await page.waitForTimeout(400); // the reduced-motion fade-in settles
  await shot('08-level-done');
  await geometry(page, `${tag} shelf`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // --- the levels list and level 2 ----------------------------------------------------------------------------
  await tap(page, '#screen-skeins [data-act="next"]');
  await page.waitForFunction(() => window.tincture.game.state.skeins.sess.state.level === 1);
  check(true, `${tag}: "Next: level 2" deals level 2`);
  await tap(page, '#screen-skeins [data-act="levels"]');
  await page.waitForSelector('#screen-skeins [data-levels]:not([hidden])', { state: 'visible' });
  const opened = await page.evaluate(() => [...document.querySelectorAll('#screen-skeins [data-level]')].map((b) => !b.disabled));
  check(opened[0] && opened[1] && !opened[2], `${tag}: levels 1 and 2 are open, level 3 opens after level 2`);
  await shot('09-levels');
  await geometry(page, `${tag} levels`);
  await tap(page, '#screen-skeins [data-act="levels-close"]');
  await geometry(page, `${tag} level 2`);
  await shot('10-level-2');

  check(errors.length === 0, `${tag}: no console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}


/** Seeds her progress: levels 1..n finished, the level on the table (no session yet), intro cards seen. */
async function seedProgress(page, { finished, li, seen = {} }) {
  await page.evaluate(({ finished, li, seen }) => {
    const { game } = window.tincture;
    game.act((st) => {
      st.unlocks.skeins = true;
      const k = st.skeins;
      k.finished = {};
      for (let i = 0; i < finished; i++) k.finished[i] = true;
      k.li = li;
      k.sess = null;
      k.other = {};
      k.seen = { ...seen };
      return {};
    }, {});
    game.save();
  }, { finished, li, seen });
}

/** A few placements with the planning bot through the sim (fills the board for a screenshot). */
async function botMoves(page, n) {
  await page.evaluate((n) => {
    const { game, ctx } = window.tincture;
    const R = ctx.puzzles.skeins;
    for (let i = 0; i < n; i++) {
      const s = game.state.skeins.sess.state;
      if (s.done) break;
      const m = R.botMove(s);
      if (m.clear !== undefined) game.act(ctx.sim.skeins.clearPeg, { cell: m.clear });
      else game.act(ctx.sim.skeins.place, { t: m.t, cell: m.cell });
    }
  }, n);
}

/** Jump to level li (her progress opened up to it) and wait for the board; returns the intro card's text or ''. */
async function goLevel(page, li) {
  await page.evaluate((li) => {
    const { game, ctx } = window.tincture;
    game.act((st) => { for (let i = 0; i < li; i++) st.skeins.finished[i] = true; return {}; }, {});
    game.act(ctx.sim.skeins.startLevel, { level: li, fresh: true });
  }, li);
  await tap(page, '#screen-skeins .btn-back');
  await page.waitForSelector('#pz-skeins [data-action="open-skeins"]', { state: 'visible' });
  await tap(page, '#pz-skeins [data-action="open-skeins"]');
  await page.waitForSelector('#screen-skeins .sk-tslot', { state: 'visible' });
  await page.waitForTimeout(250);
  const open = await page.locator('#screen-skeins [data-intro]:not([hidden])').count();
  return open ? (await page.locator('#screen-skeins [data-intro]').textContent()).replace(/\s+/g, ' ').trim() : '';
}

const firstWith = (page, m) => page.evaluate((m) => {
  const R = window.tincture.ctx.puzzles.skeins;
  return R.LEVELS.findIndex((_, i) => R.levelMechanics(i).includes(m));
}, m);

/** 112 levels: chapters, Continue, intro cards, mechanics and silhouettes on the board. */
async function chaptersWalk(viewport, tag) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = trackErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  // her save: chapter 1 and 2 wound (23 levels), level 24 (the first order) next, the snarl card read
  await seedProgress(page, { finished: 23, li: 23, seen: { snarl: true } });
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.evaluate(() => { window.tincture.game.state.onboarding.seen.skeins = true; });

  // --- the hub card -------------------------------------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-skeins [data-action="open-skeins"]', { state: 'visible' });
  const card = (await page.locator('#pz-skeins').textContent()).replace(/\s+/g, ' ').trim();
  check(/Play level 24/.test(card) && /Dye day/.test(card) && /23 levels finished/.test(card), `${tag}: the hub card names the next level and its chapter ("${card.slice(0, 120)}")`);
  await page.evaluate(() => document.querySelector('#pz-skeins').scrollIntoView({ block: 'center' }));
  await shot('c01-hub-card');

  // --- level 24: the order card, once ----------------------------------------------------------------
  await tap(page, '#pz-skeins [data-action="open-skeins"]');
  await page.waitForSelector('#screen-skeins [data-intro]:not([hidden])', { state: 'visible', timeout: 6000 });
  const intro = (await page.locator('#screen-skeins [data-intro]').textContent()).replace(/\s+/g, ' ');
  check(/Orders/.test(intro) && /customer/.test(intro), `${tag}: the order level opens with its intro card ("${intro.trim().slice(0, 90)}")`);
  await shot('c02-intro-order');
  await geometry(page, `${tag} intro card`);
  await tap(page, '#screen-skeins [data-act="intro-ok"]');
  check(await page.evaluate(() => window.tincture.game.state.skeins.seen.order === true), `${tag}: the card is marked read`);
  const count = (await page.locator('#screen-skeins [data-count]').textContent()).trim();
  check(/for the weaver/.test(count), `${tag}: the goal reads as an order slip ("${count}")`);
  await botMoves(page, 6);
  await page.waitForTimeout(300);
  await shot('c03-order-board');

  // --- the level list: Continue, chapters, ticks, next highlighted ------------------------------------
  await tap(page, '#screen-skeins [data-act="levels"]');
  await page.waitForSelector('#screen-skeins [data-levels]:not([hidden])', { state: 'visible' });
  const list = await page.evaluate(() => {
    const sh = document.querySelector('#screen-skeins [data-levels]');
    return {
      heads: sh.querySelectorAll('.sk-chhead').length,
      expanded: [...sh.querySelectorAll('.sk-chhead[aria-expanded="true"]')].map((b) => +b.dataset.chapter),
      rows: sh.querySelectorAll('[data-level]').length,
      next: [...sh.querySelectorAll('[data-level].next')].map((b) => +b.dataset.level),
      cont: (sh.querySelector('[data-act="continue"]') || {}).textContent || '',
      openHeads: [...sh.querySelectorAll('.sk-chhead')].filter((b) => !b.disabled).length,
    };
  });
  check(list.heads === 11 && list.openHeads === 3, `${tag}: 11 chapter sections, 3 open (${list.heads}, ${list.openHeads})`);
  check(list.expanded.length === 1 && list.expanded[0] === 2 && list.rows === 10, `${tag}: the chapter with the next level is open (${list.expanded}, ${list.rows} rows)`);
  check(list.next.length === 1 && list.next[0] === 23, `${tag}: level 24 is highlighted as next (${list.next})`);
  check(/Continue level 24/.test(list.cont), `${tag}: the Continue button resumes level 24 ("${list.cont.trim()}")`);
  await shot('c04-levels');
  await geometry(page, `${tag} level list`);
  await tap(page, '#screen-skeins [data-chapter="1"]');
  await page.waitForTimeout(150);
  const ticks = await page.evaluate(() => document.querySelectorAll('#screen-skeins #sk-ch-1 .tick').length);
  check(ticks === 10, `${tag}: chapter 2 shows ten done ticks (${ticks})`);
  await shot('c05-levels-chapter2');
  await tap(page, '#screen-skeins [data-act="continue"]');
  await page.waitForFunction(() => document.querySelector('#screen-skeins [data-levels]').hidden);
  check(await page.evaluate(() => window.tincture.game.state.skeins.sess.state.level === 23 && window.tincture.game.state.skeins.sess.state.moves === 6), `${tag}: Continue went back to the same board`);

  // --- each newer mechanic: its card, then its board ------------------------------------------------------
  const MECH = [['snarl', 'Snarls'], ['basket', 'basket of trays'], ['felt', 'Felted stacks'], ['spindle', 'Spindle pegs'], ['preview', 'next tray'], ['untie', 'Untangle']];
  for (const [m, word] of MECH) {
    const li = await firstWith(page, m);
    // the snarl card was read in her save: show it again for the screenshot
    if (m === 'snarl') await page.evaluate(() => { delete window.tincture.game.state.skeins.seen.snarl; });
    const text = await goLevel(page, li);
    check(new RegExp(word).test(text), `${tag}: level ${li + 1} opens with the ${m} card ("${text.slice(0, 60)}")`);
    if (text) {
      await shot(`c06-intro-${m}`);
      await tap(page, '#screen-skeins [data-act="intro-ok"]');
    }
    const fresh = await page.evaluate(() => document.querySelectorAll('#screen-skeins .sk-stack.felt').length);
    await botMoves(page, m === 'untie' ? 16 : 9);
    await page.waitForTimeout(350);
    const drawn = await page.evaluate((m) => {
      const sec = document.querySelector('#screen-skeins');
      return {
        snarl: sec.querySelectorAll('.sk-peg.snarl').length,
        felt: sec.querySelectorAll('.sk-stack.felt').length,
        spindle: sec.querySelectorAll('.sk-peg.spindle').length,
        next: !sec.querySelector('[data-next]').hidden,
        chips: sec.querySelector('[data-chips]').textContent,
      };
    }, m);
    const ok = { snarl: drawn.snarl > 0, basket: /basket/.test(drawn.chips), felt: fresh > 0, spindle: drawn.spindle > 0, preview: drawn.next, untie: /untangle|loosen|wake|untangled/i.test(drawn.chips) }[m];
    check(ok, `${tag}: the ${m} board draws it (${JSON.stringify(drawn).slice(0, 120)})`);
    await shot(`c07-board-${m}`);
    await geometry(page, `${tag} ${m} board`);
  }
  // a felted stack wakes beside a hank: play the felt level on until one wakes
  {
    const li = await firstWith(page, 'felt');
    await goLevel(page, li);
    const before = await page.evaluate(() => window.tincture.game.state.skeins.sess.state.felt.length);
    await page.evaluate(() => {
      const { game, ctx } = window.tincture;
      const R = ctx.puzzles.skeins;
      for (let i = 0; i < 200; i++) {
        const s = game.state.skeins.sess.state;
        if (s.done || s.felt.length < 3) break;
        const m = R.botMove(s);
        if (m.clear !== undefined) game.act(ctx.sim.skeins.clearPeg, { cell: m.clear });
        else game.act(ctx.sim.skeins.place, { t: m.t, cell: m.cell });
      }
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.tincture.game.state.skeins.sess.state.felt.length);
    check(after < before, `${tag}: felted stacks wake as hanks are tied beside them (${before} -> ${after})`);
    await shot('c08-felt-woken');
  }

  // --- silhouettes on the board ---------------------------------------------------------------------
  for (const shape of ['heart35', 'sheep', 'mitten', 'teapot', 'star37', 'flower25']) {
    const li = await page.evaluate((sh) => window.tincture.ctx.puzzles.skeins.LEVELS.findIndex((L) => L.shape === sh), shape);
    const text = await goLevel(page, li);
    if (text) await tap(page, '#screen-skeins [data-act="intro-ok"]');
    await botMoves(page, 8);
    await page.waitForTimeout(300);
    await shot(`c09-shape-${shape}`);
    await geometry(page, `${tag} ${shape} board`);
  }

  // --- a reload mid-level on a mechanic level, by touch ----------------------------------------------
  {
    const li = await firstWith(page, 'snarl');
    const text = await goLevel(page, li);
    if (text) await tap(page, '#screen-skeins [data-act="intro-ok"]');
    for (let i = 0; i < 3; i++) await playMove(page, cdp, { drag: i === 1 });
    const before = await sk(page);
    await page.reload({ waitUntil: 'load' });
    await boot(page);
    const after = await sk(page);
    check(JSON.stringify(after.sess) === JSON.stringify(before.sess), `${tag}: a reload mid-level on a snarl level resumes exactly (move ${after.sess.state.moves})`);
  }

  // --- Continue after a finished level ------------------------------------------------------------------
  {
    await page.evaluate(() => {
      const { game, ctx } = window.tincture;
      game.act((st) => { st.skeins.finished = {}; for (let i = 0; i < 41; i++) st.skeins.finished[i] = true; st.skeins.other = {}; return {}; }, {});
      game.act(ctx.sim.skeins.startLevel, { level: 4, fresh: true });
      const R = ctx.puzzles.skeins;
      for (let i = 0; i < 400 && !game.state.skeins.sess.state.done; i++) {
        const m = R.botMove(game.state.skeins.sess.state);
        if (m.clear !== undefined) game.act(ctx.sim.skeins.clearPeg, { cell: m.clear });
        else game.act(ctx.sim.skeins.place, { t: m.t, cell: m.cell });
      }
    });
    await tap(page, '#tabbar [data-tab="puzzles"]');
    await page.waitForSelector('#pz-skeins [data-action="open-skeins"]', { state: 'visible' });
    const c2 = (await page.locator('#pz-skeins').textContent()).replace(/\s+/g, ' ');
    check(/Play level 42/.test(c2), `${tag}: after a finished replay, the card offers the newest level ("${c2.trim().slice(0, 90)}")`);
    await tap(page, '#pz-skeins [data-action="open-skeins"]');
    await page.waitForSelector('#screen-skeins .sk-tslot', { state: 'visible' });
    check(await page.evaluate(() => window.tincture.game.state.skeins.sess.state.level) === 41, `${tag}: the room opens on level 42`);
  }

  check(errors.length === 0, `${tag}: no console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** From the workshop: Next names the Winding Room, the sheet buys it, the ceremony plays, and a two-choice card offers the way in. */
async function workshopWalk(viewport, tag) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = trackErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.waitForSelector('#screen-workshop [data-action="next"]', { state: 'visible' });
  await page.waitForTimeout(400);
  const label = (await page.locator('#screen-workshop [data-action="next"]').textContent()).trim();
  check(/Winding Room/.test(label), `${tag}: the workshop's Next names the Winding Room ("${label}")`);
  await tap(page, '#screen-workshop [data-action="next"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('w1-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForTimeout(500);
  await shot('w2-ceremony');
  const go = page.locator('[data-overlay-action]', { hasText: 'Go to the Winding Room' });
  await go.waitFor({ state: 'visible', timeout: 6000 });
  await shot('w3-whats-next');
  await tap(page, go);
  await page.waitForSelector('#screen-skeins .sk-tslot', { state: 'visible' });
  check(true, `${tag}: "Go to the Winding Room" opens it on level 1`);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  check(/Drag a stack/.test(await page.locator('#guide-layer .coach-tag').textContent().catch(() => '')), `${tag}: the guide starts on arrival`);
  await shot('w4-room');
  check(errors.length === 0, `${tag}: no console errors (${errors.slice(0, 3).join(' | ')})`);
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
  await chaptersWalk({ width: 390, height: 844 }, '390');
  await chaptersWalk({ width: 360, height: 740 }, '360');
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Winding Room checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
