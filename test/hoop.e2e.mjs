// Tincture — test/hoop.e2e.mjs
// The Hoop walked end to end in headless Chromium with real touch input
// (isMobile, hasTouch, DPR 2) at 390x844 and 360x740:
//  - from the workshop: the unlock sheet buys it, the short ceremony plays in
//    the scene, and a two-choice card offers the way in;
//  - from the Puzzles hub: the card shows the price (34 colors, 14,000 coins),
//    buying it there opens the card's "Go to the hoop";
//  - the guide: its first step is the action itself (no Got it), then one
//    short information step; it is marked seen;
//  - hoop 1 cleared by touches (a knot, then a glowing peg), with a reload in
//    the middle of a move that resumes exactly, Undo, a Hint, the finish
//    sheet: coins land (state and the reward line), the par star;
//  - the hoop list: 11 chapters, ticks, the next hoop highlighted, locked
//    hoops later on, and Continue;
//  - a clasp: hoop 2's intro card, the hooked marks drawn where two strands
//    hook, over and under painted as recorded at every crossing, cleared by
//    touch; a lift-off: a tap on the middle of a strand lying on top of
//    everything lifts it off as one move;
//  - the densest hoop at a 4x CPU throttle: frames during moves, the full
//    cache repaint and an ordinary frame;
//  - 44 px controls, no horizontal scroll, the tab bar hidden, no page or
//    console errors.
// Run: node test/hoop.e2e.mjs   (screenshots: $HOOP_SHOTS or the OS temp dir)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.HOOP_SHOTS || path.join(os.tmpdir(), 'tincture-hoop-e2e');
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
if (!pw) { console.log('SKIP hoop.e2e: Playwright not found'); process.exit(0); }

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

const idle = (page, ms = 20000) => page.waitForFunction(() => window.__hp && !window.__hp.debugHoop().busy, null, { timeout: ms });
const hState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.hoop)));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__hp = await import('./src/ui/hoop.js'); });
}

/** A workshop well on its way: 35 colors (silently), coins, two mixers running, the other rooms open, their guides done. */
async function seed(page, { coins = 14600 } = {}) {
  await page.evaluate((coinsAt) => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.settings.responsibleMode = false; // replays the room far more than 5 times (test/limits.e2e.mjs covers the mode)
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true, skeins: true, lift: true, garden: true, tiles: true, tangle: true };
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length >= 35) break;
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

/** Open the Hoop and mark hoops before `upto` cleared, the intro cards seen unless asked, the guide seen. */
async function openUpTo(page, upto, { intros = false } = {}) {
  await page.evaluate(({ id, intros: keep }) => {
    const { game, ctx } = window.tincture;
    game.act((st) => {
      st.unlocks.hoop = true;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), hoop: true };
      const ids = ctx.puzzles.hoopLevels.LEVEL_IDS;
      st.hoop.done = {};
      for (const x of ids.slice(0, ids.indexOf(id))) st.hoop.done[x] = 1;
      st.hoop.seenIntro = keep ? {} : Object.fromEntries(Object.keys(ctx.puzzles.hoopLevels.MECHANICS).map((m) => [m, true]));
      st.hoop.cur = id;
      st.hoop.game = null;
      return {};
    }, {});
    game.act(ctx.sim.hoop.startHoop, { levelId: id, fresh: true });
    game.save();
  }, { id: upto, intros });
}

async function geometry(page, label) {
  await page.waitForTimeout(350);
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-hoop');
    const body = sec.querySelector('.screen-body');
    const small = [...sec.querySelectorAll('.btn, .btn-back, .hp-iconbtn')]
      .filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
      .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    const act = sec.querySelector('.hp-actions');
    const ar = act ? act.getBoundingClientRect() : null;
    const hoop = sec.querySelector('#hp-hoop');
    const hr = hoop ? hoop.getBoundingClientRect() : null;
    const tab = document.getElementById('tabbar');
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      actBottom: ar ? ar.bottom : -1, vh: innerHeight, hoopW: hr ? hr.width : 0, hoopRight: hr ? hr.right : 0, vw: innerWidth,
      tabHidden: !tab || tab.hidden || tab.getBoundingClientRect().height === 0,
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.actBottom > 0 && g.actBottom <= g.vh + 0.5, `${label}: Undo, Hint and Start over sit inside the viewport (${Math.round(g.actBottom)} <= ${g.vh})`);
  check(g.hoopW >= 240 && g.hoopRight <= g.vw, `${label}: the hoop fits the width (${Math.round(g.hoopW)} px)`);
  check(g.tabHidden, `${label}: the tab bar is hidden under the hoop`);
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

const pegPoint = (page, q) => page.evaluate((p) => window.__hp.debugHoop().pegPoint(p), q);

/** One move by touch: tap the knot (end e), then the peg; or, for a lift-off, the strand's middle. Waits for the yarn to settle. */
async function touchMove(page, e, q, { settle = true } = {}) {
  const st = await page.evaluate(() => window.__hp.debugHoop().state);
  if (q === -1) {
    const p = await page.evaluate((i) => window.__hp.debugHoop().strandMid(i), e >> 1);
    await page.touchscreen.tap(p[0], p[1]);
  } else {
    const a = await pegPoint(page, st.ends[e]);
    await page.touchscreen.tap(a[0], a[1]);
    await page.waitForTimeout(90);
    const b = await pegPoint(page, q);
    await page.touchscreen.tap(b[0], b[1]);
  }
  if (!settle) return null;
  await page.waitForTimeout(60);
  await idle(page);
  return (await hState(page)).game.moves;
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

const solutionOf = (page, id) => page.evaluate((x) => window.tincture.ctx.puzzles.hoopLevels.levelById(x).solution.split(' ').map((m) => m.split(':').map(Number)), id);
const pct = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** Over and under as painted (top layer, cache and patches) at every crossing in view agrees with the words. */
async function drawnRight(page) {
  return page.evaluate(() => { const t = window.__hp.debugHoop().drawnTops(); return { n: t.length, bad: t.filter((x) => x.drawn !== x.top).length }; });
}

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
  await page.evaluate(() => { window.tincture.game.act((st) => { for (const k of ['shelf', 'hunters', 'skeins', 'lift', 'tiles', 'garden', 'gallery', 'tangle']) st.unlocks[k] = true; return {}; }, {}); window.tincture.game.save(); });
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.waitForSelector('#screen-workshop [data-action="next"]', { state: 'visible' });
  await page.waitForTimeout(400);
  const label = (await page.locator('#screen-workshop [data-action="next"]').textContent()).trim();
  if (/the Hoop/.test(label)) {
    check(/14(,000|K)/.test(label), `${tag}: the workshop's Next names the Hoop ("${label}")`);
    await tap(page, '#screen-workshop [data-action="next"]');
  } else {
    await page.evaluate(async () => { const w = await import('./src/ui/workshop.js'); w.openUnlockSheet(window.tincture.ctx, 'hoop'); });
  }
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await page.waitForTimeout(300);
  check(/Hoop/.test(await page.locator('.ws-unlock-name').first().textContent()), `${tag}: the "What this opens" sheet names the Hoop`);
  await shot('w1-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForTimeout(450);
  check(await page.locator('.ws-cer').count() === 1, `${tag}: the unlock ceremony plays in the scene`);
  await shot('w2-ceremony');
  check(await page.evaluate(() => window.tincture.game.state.unlocks.hoop === true), `${tag}: bought from the workshop`);
  const go = page.locator('[data-overlay-action]', { hasText: 'Go to the hoop' });
  await go.waitFor({ state: 'visible', timeout: 6000 });
  await shot('w3-whats-next');
  await tap(page, go);
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  check(true, `${tag}: "Go to the hoop" opens the Hoop`);
  await page.waitForTimeout(600);
  await shot('w4-hoop');
  await geometry(page, `${tag} hoop`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** From the Puzzles hub: price, purchase, the guide, hoop 1 by touch with a reload mid-move, the finish, the list. */
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
  await page.waitForSelector('#pz-hoop', { state: 'visible' });
  must(await page.locator('#pz-hoop [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Hoop card carries the price button`);
  check(/14(,000|K)/.test(await page.locator('#pz-hoop').textContent()), `${tag}: the price reads 14K`);
  await page.evaluate(() => document.querySelector('#pz-hoop').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-hoop [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  const coins0 = await page.evaluate(() => window.tincture.game.state.coins);
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.hoop === true);
  const coins1 = await page.evaluate(() => window.tincture.game.state.coins);
  check(coins0 - coins1 > 13999 && coins0 - coins1 < 14100, `${tag}: buying the Hoop spent 14,000 coins (${Math.round(coins0 - coins1)})`);
  await page.waitForSelector('#pz-hoop [data-action="open-hoop"]', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#pz-hoop').scrollIntoView({ block: 'center' }));
  await shot('03-hub-open');

  // --- the hoop and the guide -----------------------------------------------------------------
  await tap(page, '#pz-hoop [data-action="open-hoop"]');
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  await idle(page);
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Tap a knot/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button (no steps before her first action)`);
  check(await page.locator('#screen-hoop .hp-sheet:not([hidden])').count() === 0, `${tag}: no sheet over the hoop on the first visit`);
  await shot('04-guide-1');
  await geometry(page, `${tag} hoop 1`);

  const sol = await solutionOf(page, 'first');
  const quote = await page.evaluate((n) => window.tincture.ctx.sim.hoop.quote(window.tincture.game.state, 'first', window.tincture.game.now(), { moves: n }), sol.length);

  // A knot lifted: the pegs it may go to glow (DOM rings), a line says what to do.
  const st0 = await page.evaluate(() => window.__hp.debugHoop().state);
  const k0 = await pegPoint(page, st0.ends[sol[0][0]]);
  await page.touchscreen.tap(k0[0], k0[1]);
  await page.waitForTimeout(200);
  const lifted = await page.evaluate(() => ({ held: window.__hp.debugHoop().held, rings: document.querySelectorAll('#hp-pegfx .hp-pg').length, msg: document.querySelector('#hp-msg').textContent }));
  check(lifted.held === sol[0][0] && lifted.rings >= 1 && /glowing peg/.test(lifted.msg), `${tag}: a tapped knot lifts and the pegs it may go to glow (${lifted.rings} rings, "${lifted.msg}")`);
  await shot('05-lifted');
  const p0 = await pegPoint(page, sol[0][1]);
  await page.touchscreen.tap(p0[0], p0[1]);
  await page.waitForTimeout(60);
  await idle(page);
  let moves = (await hState(page)).game.moves;
  check(moves.length === 1 && moves[0] === `${sol[0][0]}:${sol[0][1]}`, `${tag}: a knot and then a peg by touch retie it (${JSON.stringify(moves)})`);
  await page.waitForTimeout(300);
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/comes free/.test(bubble2), `${tag}: the second step says how strands come free ("${(bubble2 || '').trim()}")`);
  await shot('06-first-move');
  const gots = await gotIt(page);
  check(gots === 1, `${tag}: one short information step after the action (${gots})`);
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.hoop), `${tag}: the guide is marked seen`);

  // A tap on a taken peg's knot while one is held lifts that one instead; a tap on the same knot puts it back.
  const a1 = await pegPoint(page, (await page.evaluate(() => window.__hp.debugHoop().state)).ends[sol[1][0]]);
  await page.touchscreen.tap(a1[0], a1[1]);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(a1[0], a1[1]);
  await page.waitForTimeout(120);
  check(await page.evaluate(() => window.__hp.debugHoop().held) === -1 && /Put back/.test(await page.locator('#hp-msg').textContent()), `${tag}: tapping the lifted knot again puts it back`);

  // A move started, then a reload mid-animation: the move is saved the moment it is made.
  await touchMove(page, sol[1][0], sol[1][1], { settle: false });
  await page.waitForTimeout(120);
  await shot('07-mid-move');
  const before = await hState(page);
  const beforeRules = await page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.ctx.sim.hoop.current(window.tincture.game.state).s)));
  check(before.game.moves.length === 2, `${tag}: every move is saved as it is made (${before.game.moves.length})`);
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  const after = await hState(page);
  check(JSON.stringify(after.game) === JSON.stringify(before.game), `${tag}: a reload mid-hoop keeps the moves and her yarns exactly`);
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForSelector('#pz-hoop [data-action="open-hoop"]', { state: 'visible' });
  const card = (await page.locator('#pz-hoop').textContent()).replace(/\s+/g, ' ');
  check(/Continue untangling/.test(card) && /strands? to go/.test(card), `${tag}: the hub card shows the hoop at a glance ("${card.trim().slice(0, 90)}")`);
  await page.evaluate(() => document.querySelector('#pz-hoop').scrollIntoView({ block: 'center' }));
  await shot('08-hub-continue');
  await tap(page, '#pz-hoop [data-action="open-hoop"]');
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  await idle(page);
  const resumed = await page.evaluate(() => ({
    rules: JSON.parse(JSON.stringify(window.tincture.ctx.sim.hoop.current(window.tincture.game.state).s)),
    screen: JSON.parse(JSON.stringify(window.__hp.debugHoop().state)),
    moves: document.querySelector('#hp-moveCount').textContent,
    note: window.__hp.debugHoop().note,
  }));
  check(JSON.stringify(resumed.rules) === JSON.stringify(beforeRules) && JSON.stringify(resumed.screen) === JSON.stringify(beforeRules), `${tag}: the hoop resumes exactly where it was`);
  check(/Moves 2/.test(resumed.moves) && /Back where you left it/.test(resumed.note), `${tag}: the move count and a welcome back ("${resumed.note}")`);
  const dr = await drawnRight(page);
  check(dr.bad === 0, `${tag}: over and under painted as recorded at all ${dr.n} crossings`);
  await shot('09-resumed');

  // Undo and Hint.
  await tap(page, '#hp-undoBtn');
  await idle(page);
  check((await hState(page)).game.moves.length === 1, `${tag}: Undo takes back one move`);
  await tap(page, '#hp-hintBtn');
  await page.waitForTimeout(250);
  const hn = await page.evaluate(() => ({ h: window.__hp.debugHoop().hint, msg: document.querySelector('#hp-msg').textContent, ring: document.querySelectorAll('#hp-pegfx .hp-hr').length }));
  check(hn.h && hn.h.end === sol[1][0] && hn.h.to === sol[1][1] && hn.ring === 1 && /^Try the glowing/.test(hn.msg), `${tag}: Hint glows the next knot and rings its peg ("${hn.msg}")`);
  await shot('10-hint');

  // The rest of hoop 1 by touch.
  for (const [e, q] of sol.slice(1)) moves = await touchMove(page, e, q);
  await page.waitForSelector('#hp-finishSheet:not([hidden])', { state: 'visible', timeout: 10000 });
  const fin = await page.evaluate(() => ({ st: JSON.parse(JSON.stringify(window.tincture.game.state)), title: document.querySelector('#hp-finTitle').textContent, reward: document.querySelector('#hp-finReward').textContent, par: document.querySelector('#hp-finPar').textContent }));
  check(/First knots: all free/.test(fin.title), `${tag}: the finish sheet ("${fin.title}")`);
  check(fin.st.hoop.done.first === 1 && fin.st.hoop.finished === 1, `${tag}: hoop 1 is recorded as cleared`);
  // (Undo takes a move back, so the three left make the par: the star, and its small bonus)
  const paid = fin.st.hoop.last.coins;
  check(paid > 0 && Math.abs(paid - (quote.coins + quote.bonus)) / paid < 0.05 && fin.st.hoop.last.star && fin.st.hoop.last.bonus > 0, `${tag}: coins landed with the star's bonus (${paid.toFixed(2)}, quoted ${(quote.coins + quote.bonus).toFixed(2)})`);
  check(/\+\d[\d.,K]* coins?/.test(fin.reward) && /star bonus/.test(fin.reward), `${tag}: the reward line names the coins and the star ("${fin.reward.replace(/\s+/g, ' ').trim()}")`);
  check(/Untangled in 3 moves, the tidiest it can be done/.test(fin.par), `${tag}: the par line ("${fin.par.trim()}")`);
  await page.waitForTimeout(700);
  await shot('11-finish');
  // Again, with a detour first and Hint the rest of the way (off the stored path): over par, a quarter of the coins, a gentle line.
  await tap(page, '#hp-finAgain');
  await idle(page);
  const q2 = await page.evaluate(() => window.tincture.ctx.sim.hoop.quote(window.tincture.game.state, 'first', window.tincture.game.now(), { moves: 99 }));
  const detour = await page.evaluate((good) => { const { ctx, game } = window.tincture; const c = ctx.sim.hoop.current(game.state); const ms = ctx.puzzles.hoop.legalMoves(c.L, c.s); return ms.find(([e, q]) => !(e === good[0] && q === good[1]) && !ctx.puzzles.hoop.move(c.L, c.s, e, q).freed.length) || ms[0]; }, sol[0]);
  await touchMove(page, detour[0], detour[1]);
  let guard = 0;
  while (!(await page.evaluate(() => window.__hp.debugHoop().state.out.every(Boolean))) && guard++ < 16) {
    await tap(page, '#hp-hintBtn');
    await page.waitForTimeout(150);
    const h = await page.evaluate(() => window.__hp.debugHoop().hint);
    if (!h) break;
    await touchMove(page, h.end, h.to);
  }
  await page.waitForSelector('#hp-finishSheet:not([hidden])', { state: 'visible', timeout: 10000 });
  const fin2 = await page.evaluate(() => ({ last: JSON.parse(JSON.stringify(window.tincture.game.state.hoop.last)), par: document.querySelector('#hp-finPar').textContent, reward: document.querySelector('#hp-finReward').textContent }));
  check(fin2.last.moves > 3 && !fin2.last.star && fin2.last.repeat && fin2.last.bonus === 0 && Math.abs(fin2.last.coins - q2.coins) < 1e-6, `${tag}: Hint saw it home from a detour; cleared again over par: a quarter of the coins (${fin2.last.moves} moves, ${fin2.last.coins.toFixed(2)})`);
  check(/star is there if you’d like another go/.test(fin2.par) && /cleared again/.test(fin2.reward), `${tag}: over par the star is a gentle invitation ("${fin2.par.trim()}")`);
  await shot('12-finish-again');

  // The list from the finish sheet: chapters, ticks, stars, the next hoop, locks, Continue.
  await tap(page, '#hp-finAll');
  await page.waitForSelector('#hp-levelSheet:not([hidden])', { state: 'visible' });
  await page.waitForTimeout(400);
  const list = await page.evaluate(() => ({
    chapters: [...document.querySelectorAll('#hp-lvList .hp-band')].map((x) => x.textContent),
    items: document.querySelectorAll('#hp-lvList [data-level]').length,
    ticks: document.querySelectorAll('#hp-lvList .hp-tick').length,
    stars: document.querySelectorAll('#hp-lvList .hp-lvstar').length,
    next: [...document.querySelectorAll('#hp-lvList .hp-next')].map((b) => b.dataset.level),
    locked: document.querySelectorAll('#hp-lvList .hp-locked').length,
    thumbs: document.querySelectorAll('#hp-lvList canvas.hp-th').length,
    cont: document.querySelector('#hp-continueBtn').textContent,
    total: window.tincture.ctx.puzzles.hoopLevels.LEVELS.length,
    hScroll: document.querySelector('#hp-levelSheet .hp-panel').scrollWidth > document.querySelector('#hp-levelSheet .hp-panel').clientWidth + 1,
  }));
  check(list.chapters.length === 11 && /First stitches/.test(list.chapters[0]) && /Heirlooms/.test(list.chapters[10]), `${tag}: 11 chapters (${list.chapters.map((c) => c.split('·')[1] || c).slice(0, 4).join(' | ')} …)`);
  check(list.items === list.total && list.total >= 100, `${tag}: every hoop listed (${list.items})`);
  check(list.ticks === 1 && list.stars === 1, `${tag}: hoop 1 carries its tick and its star`);
  check(list.next.length === 1 && list.next[0] === 'sampler', `${tag}: the next hoop is highlighted (${list.next})`);
  check(list.locked === list.total - 2 && list.thumbs === 2, `${tag}: later hoops wait behind a lock (${list.locked} locked, ${list.thumbs} drawn)`);
  check(/Continue: 2 · A little sampler/.test(list.cont), `${tag}: Continue names the next hoop ("${list.cont}")`);
  check(!list.hScroll, `${tag}: the list never scrolls sideways`);
  await shot('13-list');
  await tap(page, '#hp-lvList [data-level="floss"]');
  check(/opens once hoop 2/.test(await page.locator('#hp-lvHint').textContent()), `${tag}: a locked hoop says when it opens`);
  await tap(page, '#hp-continueBtn');
  await page.waitForSelector('#hp-levelSheet', { state: 'hidden' });
  await idle(page);
  check((await hState(page)).cur === 'sampler', `${tag}: Continue opens hoop 2`);
  await page.waitForSelector('#hp-introSheet:not([hidden])', { state: 'visible', timeout: 4000 }).catch(() => {});
  check(/Hooked strands/.test(await page.locator('#hp-introBody').textContent().catch(() => '')), `${tag}: hoop 2 introduces hooked strands`);
  await shot('14-intro-clasp');
  await tap(page, '#hp-introOk');
  await geometry(page, `${tag} hoop 2`);

  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** A clasp (hooked marks, over and under as painted, unhooked by touch) and a lift-off by a tap on a strand's middle. */
async function claspLiftWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  // a clasp: hoop 2, three hooked pairs at the start
  await openUpTo(page, 'sampler');
  await page.evaluate(() => window.tincture.ctx.navigate('hoop'));
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  await idle(page);
  await page.waitForTimeout(300);
  const marks = await page.evaluate(() => window.__hp.debugHoop().marks);
  const hooked = await page.evaluate(() => { const { ctx, game } = window.tincture; const c = ctx.sim.hoop.current(game.state); return ctx.puzzles.hoop.hookedPairs(c.L, c.s).length; });
  check(hooked >= 1 && marks.length >= 1, `${tag}: hooked strands carry their marks (${marks.length} marks, ${hooked} pairs)`);
  let dr = await drawnRight(page);
  check(dr.bad === 0 && dr.n >= 2, `${tag}: a clasp is painted over and under as recorded (${dr.n} crossings)`);
  await shot('20-clasp');
  const sol = await solutionOf(page, 'sampler');
  for (const [e, q] of sol.slice(0, -1)) await touchMove(page, e, q);
  dr = await drawnRight(page);
  check(dr.bad === 0, `${tag}: still painted right after the moves (${dr.n} crossings)`);
  await touchMove(page, ...sol.at(-1));
  await page.waitForSelector('#hp-finishSheet:not([hidden])', { state: 'visible', timeout: 10000 });
  check((await hState(page)).done.sampler === 1, `${tag}: the clasped hoop cleared by touch`);
  await shot('21-clasp-done');

  // a lift-off: the band's first hoop; play its way out until a strand lies on top of everything, then tap its middle
  await openUpTo(page, 'lifting');
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.tincture.ctx.navigate('hoop'));
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  await idle(page);
  const lsol = await solutionOf(page, 'lifting');
  let off = -1;
  for (const [e, q] of lsol) {
    off = await page.evaluate(() => { const { ctx, game } = window.tincture; const c = ctx.sim.hoop.current(game.state); for (let i = 0; i < c.L.S; i++) if (!c.s.out[i] && !ctx.puzzles.hoop.canLiftOff(c.L, c.s, i)) return i; return -1; });
    if (off >= 0) break;
    await touchMove(page, e, q);
  }
  must(off >= 0, `${tag}: a strand lies on top of everything on "Lifting off"`);
  const px = await page.evaluate(() => window.__hp.debugHoop().basePixel());
  check(px[3] === 255, `${tag}: the hoop is painted when the screen is shown again (the middle is linen or yarn, not see-through: ${px})`);
  await shot('22-liftable');
  const n0 = (await hState(page)).game.moves.length;
  const after = await touchMove(page, 2 * off, -1);
  const outNow = await page.evaluate((i) => window.__hp.debugHoop().state.out[i], off);
  check(after.length === n0 + 1 && after.at(-1) === `${2 * off}:-1` && outNow === 1, `${tag}: a tap on its middle lifts the strand right off, as one move (${after.at(-1)})`);
  check(/lifted the .* strand right off/.test(await page.locator('#hp-msg').textContent()), `${tag}: the message says so`);
  await shot('23-lifted-off');
  // a strand under another: a tap on its middle says why, and nothing moves
  const under = await page.evaluate(() => { const { ctx, game } = window.tincture; const c = ctx.sim.hoop.current(game.state); for (let i = 0; i < c.L.S; i++) { const w = ctx.puzzles.hoop.canLiftOff(c.L, c.s, i); if (!c.s.out[i] && w && w.reason === 'under') return i; } return -1; });
  if (under >= 0) {
    const n1 = (await hState(page)).game.moves.length;
    const p = await page.evaluate((i) => window.__hp.debugHoop().strandMid(i), under);
    if (p) {
      await page.touchscreen.tap(p[0], p[1]);
      await page.waitForTimeout(200);
      const msg = await page.locator('#hp-msg').textContent();
      check((await hState(page)).game.moves.length === n1 && /(lies|lie) over it|Hooked|knots/.test(msg), `${tag}: a covered strand stays, gently ("${msg}")`);
    }
  }
  await geometry(page, `${tag} lifting`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** The densest hoop, played to the end by touch at a 4x CPU throttle: frames during moves, a cache repaint, a frame. */
async function perfWalk(viewport, tag) {
  const { context, page } = await newPage(viewport);
  const errors = watchErrors(page);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  const dense = await page.evaluate(() => { let b = null; for (const L of window.tincture.ctx.puzzles.hoopLevels.LEVELS) if (!b || L.stats.crossings > b.stats.crossings) b = L; return { id: b.id, x: b.stats.crossings, S: b.stats.strands }; });
  await openUpTo(page, dense.id);
  await page.evaluate(() => window.tincture.ctx.navigate('hoop'));
  await page.waitForSelector('#screen-hoop #hp-hoop', { state: 'visible' });
  await idle(page);
  await page.waitForTimeout(500);
  await shot('30-dense');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const bench = await page.evaluate(() => window.__hp.debugHoop().bench(5));
  await page.evaluate(() => {
    window.__hp.debugHoop().resetPerf();
    window.__mf = []; const d = window.__hp.debugHoop(); let last = performance.now();
    const f = (t) => { if (d.busy) window.__mf.push(t - last); last = t; window.__mfr = requestAnimationFrame(f); };
    window.__mfr = requestAnimationFrame(f);
  });
  const sol = await solutionOf(page, dense.id);
  for (const [e, q] of sol) await touchMove(page, e, q);
  const mf = await page.evaluate(() => { cancelAnimationFrame(window.__mfr); return window.__mf.slice(1); });
  const p = await page.evaluate(() => window.__hp.debugHoop().perf);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForSelector('#hp-finishSheet:not([hidden])', { state: 'visible', timeout: 10000 });
  await shot('31-dense-done');
  const avg = mf.reduce((a, b) => a + b, 0) / Math.max(1, mf.length);
  PERF_OUT[tag] = {
    hoop: `${dense.id} (${dense.S} strands, ${dense.x} crossings)`, throttle: '4x CPU', moves: sol.length,
    moveFrames: mf.length, moveFrameAvgMs: +avg.toFixed(1), moveFramesOver33ms: mf.filter((x) => x > 33.4).length, moveFrameP95Ms: +pct(mf, 0.95).toFixed(1),
    drawMedianMs: +pct(p.draw, 0.5).toFixed(1), fullCacheRepaints: p.rebuilds, partialCacheRepaints: p.partial,
    layoutMsAvg: +(p.layout.ms / Math.max(1, p.layout.n)).toFixed(1), cacheRebuildMs: +bench.rebuild.toFixed(1), frameMs: +bench.frame.toFixed(1),
  };
  console.log(`perf ${tag}: ${JSON.stringify(PERF_OUT[tag])}`);
  check(avg < 26, `${tag}: moves stay smooth at 4x (${avg.toFixed(1)} ms a frame on average, ${mf.filter((x) => x > 33.4).length} of ${mf.length} over 33 ms)`);
  check(p.partial > 0, `${tag}: the cache is repainted only where strands changed, most of the time (${p.partial} partial, ${p.rebuilds} full)`);
  check(errors.length === 0, `${tag}: no page or console errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

try {
  try { browser = await pw.chromium.launch({ executablePath: CHROMIUM }); } catch (e) {
    browser = await pw.chromium.launch();
  }
  await waitForServer(URL_);
  // HOOP_ONLY=workshop,walk,clasp,perf runs just those walks.
  const only = process.env.HOOP_ONLY ? process.env.HOOP_ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  if (want('workshop')) await workshopWalk({ width: 390, height: 844 }, '390');
  if (want('walk')) await walk({ width: 390, height: 844 }, '390');
  if (want('walk')) await walk({ width: 360, height: 740 }, '360');
  if (want('clasp')) await claspLiftWalk({ width: 390, height: 844 }, '390');
  if (want('clasp')) await claspLiftWalk({ width: 360, height: 740 }, '360');
  if (want('perf')) await perfWalk({ width: 390, height: 844 }, '390');
} catch (e) {
  failures++;
  console.error('FAIL', e && e.stack ? e.stack : e);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(server.pid); } catch (e) { /* already gone */ }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall Hoop checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
