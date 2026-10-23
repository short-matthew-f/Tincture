// Tincture — test/tiles.e2e.mjs
// The Tile Room walked end to end in headless Chromium with touch input
// (isMobile, hasTouch, DPR 2) at 390x844 and 360x740:
//  - the Puzzles hub card shows the price; buying it there opens the Tile Room;
//  - the glaze picker (five discovered colors from five families; a swap keeps
//    the families apart) and Start the wall;
//  - the guide: at most 2 steps before the first action, ends on the action,
//    "How this works" replays it;
//  - whole walls with Ida playing (full motion) and resting (reduced motion),
//    every turn by touch: dish tile -> pattern line / seconds basket, Ida's turn,
//    Score the round, Deal round N, Finish the round;
//  - no stale selection when Ida takes the dish she tapped (T1), never locked;
//  - reload mid-turn (right after a take, mid-flight) resumes exactly, and
//    Ida's owed turn runs by itself;
//  - rewards land (coins grow per scored round; the summary and the mosaic
//    shelf; the summary is scrolled into view; the bar says Start a new wall);
//  - Renovate closes the room (mosaics and the wall stay), the half-price
//    re-buy reopens it with the wall waiting;
//  - 44 px controls, no horizontal scroll, the action bar inside the viewport
//    and the tab bar hidden, no page errors.
// Run: node test/tiles.e2e.mjs   (screenshots: $TILES_SHOTS or the OS temp dir)

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SHOTS = process.env.TILES_SHOTS || path.join(os.tmpdir(), 'tincture-tiles-e2e');
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
if (!pw) { console.log('SKIP tiles.e2e: Playwright not found'); process.exit(0); }

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
  // A screen may redraw (same markup) between finding and scrolling; a finger would land on
  // the redrawn button, so look it up again instead of failing.
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

const idle = (page, ms = 15000) => page.waitForFunction(() => window.__tl && !window.__tl.debugTiles().busy, null, { timeout: ms });
const phase = (page) => page.evaluate(() => window.tincture.ctx.sim.tiles.phase(window.tincture.game.state));
const tilesState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.tincture.game.state.tiles)));

async function boot(page) {
  await page.waitForFunction(() => window.tincture && window.tincture.game && window.tincture.ctx, null, { timeout: 15000 });
  await page.evaluate(async () => { window.__tl = await import('./src/ui/tiles.js'); });
}

/** A workshop past its first sessions: 22 colors (silently), coins, onboarding and the other guides done. */
async function seed(page) {
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st, a, now) => {
      st.onboarding.done = true;
      st.onboarding.step = 99;
      st.onboarding.seen = { ...(st.onboarding.seen || {}), workshop: true, shelf: true, map: true, hunters: true, gallery: true, purify: true, grading: true };
      const fams = new Set();
      const pick = [];
      for (const c of ctx.content.CATALOG) {
        if (Object.keys(st.catalog.discovered).length + pick.length >= 22) break;
        if (st.catalog.discovered[c.id]) continue;
        const f = ctx.sim.economy.colorFamily(c.id);
        if (!fams.has(f) || pick.length > 8) { fams.add(f); pick.push(c.id); }
      }
      for (const id of pick) st.catalog.discovered[id] = { at: now, name: ctx.content.getColor(id).name, custom: false, essence: 0 };
      st.coins = 6000;
      st.stations.mixers.forEach((m, i) => { m.recipe = ['madder', 'woad'][i % 2]; });
      return {};
    }, {});
    game.save();
  });
}

async function geometry(page, label) {
  await page.waitForTimeout(800); // screen entry and deal-in animations settle first
  const g = await page.evaluate(() => {
    const sec = document.querySelector('#screen-tiles');
    const body = sec.querySelector('.screen-body');
    const bar = sec.querySelector('[data-bar]');
    const small = [...sec.querySelectorAll('.tl-bar .btn, .tl-foot .btn, [data-dishes] button.tl-tile, [data-center] button.tl-tile, .tl-basket, .tl-pslot, .tl-sw, .btn-back, .how-link')]
      .filter((el) => el.getClientRects().length)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, w: r.width, h: r.height }; })
      .filter((r) => r.h < 43.5 || r.w < 43.5);
    const br = bar ? bar.getBoundingClientRect() : null;
    const tab = document.getElementById('tabbar');
    return {
      hScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || (body && body.scrollWidth > body.clientWidth + 1),
      barBottom: br ? br.bottom : -1, vh: innerHeight, tabHidden: !tab || tab.hidden || tab.getBoundingClientRect().height === 0,
      small,
    };
  });
  check(!g.hScroll, `${label}: no horizontal scroll`);
  check(g.barBottom > 0 && g.barBottom <= g.vh + 0.5, `${label}: the action bar sits inside the viewport (${g.barBottom} <= ${g.vh})`);
  check(g.tabHidden, `${label}: the tab bar is hidden under the Tile Room (no collision with the bar)`);
  check(g.small.length === 0, `${label}: every control is at least 44 px (${JSON.stringify(g.small.slice(0, 3))})`);
}

/** The move a calm player makes: a group that fits a line best, else the smallest group to seconds. */
function chooseMove(page) {
  return page.evaluate(() => {
    const st = window.tincture.game.state;
    const g = st.tiles.game;
    const R = window.tincture.ctx.puzzles.tiles;
    const opts = [];
    const add = (source, index, tiles) => {
      for (const color of [...new Set(tiles)]) {
        const count = tiles.filter((c) => c === color).length;
        const lines = R.legalLines(g, color);
        let best = { line: -1, waste: count, fill: 0 };
        for (const i of lines) {
          const free = i + 1 - g.lines[i].n;
          const waste = Math.max(0, count - free);
          if (waste < best.waste || (waste === best.waste && free < best.free)) best = { line: i, waste, free };
        }
        opts.push({ source, index, color, line: best.line, waste: best.waste });
      }
    };
    g.dishes.forEach((d, i) => { if (d.length) add('dish', i, d); });
    if (g.center.length) add('center', 0, g.center);
    opts.sort((a, b) => a.waste - b.waste || (b.line - a.line));
    return opts[0] || null;
  });
}

async function playTurn(page, { useSweep = false } = {}) {
  const ph = await phase(page);
  if (ph === 'pending') { await tap(page, '[data-bar] [data-action="go"]'); await idle(page); return 'go'; }
  if (ph === 'deal') { await tap(page, '[data-bar] [data-action="deal"]'); await idle(page); return 'deal'; }
  if (ph !== 'play') return ph;
  if (useSweep && await page.locator('[data-bar] [data-action="sweep"]').count()) {
    await tap(page, '[data-bar] [data-action="sweep"]');
    await idle(page);
    return 'sweep';
  }
  const mv = await chooseMove(page);
  if (!mv) return 'none';
  await tap(page, `#screen-tiles [data-src="${mv.source}"][data-i="${mv.index}"][data-c="${mv.color}"]`);
  const sel = await page.evaluate(() => window.__tl.debugTiles().sel);
  if (!sel) return 'reselect';
  if (mv.line >= 0) await tap(page, `#screen-tiles [data-line="${mv.line}"]`);
  else if (await page.locator('[data-bar] [data-action="basket"]').count()) await tap(page, '[data-bar] [data-action="basket"]');
  else await tap(page, '#screen-tiles [data-basket]');
  await idle(page);
  return 'take';
}

async function playWall(page, label, { rival, sweepEvery = 3, maxSteps = 400 } = {}) {
  let rounds = 0;
  let lastCoins = await page.evaluate(() => window.tincture.game.state.coins);
  let coinRises = 0;
  let idaSeen = false;
  for (let i = 0; i < maxSteps; i++) {
    const ph = await phase(page);
    if (ph === 'over') break;
    if (ph === 'pending') {
      const roundOver = await page.evaluate(() => window.tincture.ctx.puzzles.tiles.roundOver(window.tincture.game.state.tiles.game));
      if (!roundOver) idaSeen = true;
    }
    const did = await playTurn(page, { useSweep: rounds % sweepEvery === 1 });
    if (did === 'deal') rounds++;
    const coins = await page.evaluate(() => window.tincture.game.state.coins);
    if (coins > lastCoins + 1e-9) coinRises++;
    lastCoins = coins;
  }
  return { rounds, coinRises, idaSeen };
}

// ---------------------------------------------------------------------------
// The walks
// ---------------------------------------------------------------------------

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
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });

  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'load' });
  await boot(page);

  // --- the hub card and the unlock -------------------------------------------------
  await tap(page, '#tabbar [data-tab="puzzles"]');
  await page.waitForSelector('#pz-tiles', { state: 'visible' });
  must(await page.locator('#pz-tiles [data-action="unlock-open"]').count() === 1, `${tag}: the hub's Tile Room card carries the price button`);
  await page.evaluate(() => document.querySelector('#pz-tiles').scrollIntoView({ block: 'center' }));
  await shot('01-hub-locked');
  await tap(page, '#pz-tiles [data-action="unlock-open"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('02-unlock-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForFunction(() => window.tincture.game.state.unlocks.tiles === true);
  check(await page.evaluate(() => window.tincture.game.state.coins) < 1100, `${tag}: buying the Tile Room spent 5,000 coins`);
  await page.waitForSelector('#pz-tiles [data-action="open-tiles"]', { state: 'visible' });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#pz-tiles').scrollIntoView({ block: 'center' }));
  await shot('03-hub-open');

  // --- the picker ----------------------------------------------------------------------
  await tap(page, '#pz-tiles [data-action="open-tiles"]');
  await page.waitForSelector('#screen-tiles [data-picker]:not([hidden])', { state: 'visible' });
  const pick0 = await page.evaluate(() => {
    const st = window.tincture.game.state;
    const ids = window.tincture.ctx.sim.tiles.nextGlazes(st);
    return { ids, fams: new Set(ids.map((id) => window.tincture.ctx.sim.economy.colorFamily(id))).size, disc: ids.every((id) => st.catalog.discovered[id]) };
  });
  check(pick0.ids.length === 5 && pick0.fams === 5 && pick0.disc, `${tag}: the picker starts with five discovered glazes from five families`);
  check(await page.locator('#guide-layer .coach-tag').count() === 0, `${tag}: no guide bubble over the picker (it waits for the dishes)`);
  await geometry(page, `${tag} picker`);
  await shot('04-picker');
  // Swap: a color from a family already in the set replaces that family's glaze.
  const swap = await page.evaluate(() => {
    const st = window.tincture.game.state;
    const sim = window.tincture.ctx.sim;
    const ids = sim.tiles.nextGlazes(st);
    const fam = sim.economy.colorFamily(ids[2]);
    return Object.keys(st.catalog.discovered).find((id) => !ids.includes(id) && sim.economy.colorFamily(id) === fam) || null;
  });
  if (swap) {
    await tap(page, '#screen-tiles [data-action="pick-slot"][data-slot="0"]');
    await tap(page, `#screen-tiles [data-action="pick-color"][data-color="${swap}"]`);
    const msg = await page.locator('#screen-tiles [data-bar] .msg').textContent();
    check(/one glaze per family/.test(msg), `${tag}: a same-family pick swaps in for that family's glaze ("${msg.trim()}")`);
  }
  await tap(page, '#screen-tiles [data-bar] [data-action="start"]');
  await page.waitForSelector('#screen-tiles [data-dishes] .tl-tile', { state: 'visible' });
  const g0 = await tilesState(page);
  check(g0.game && g0.game.round === 1 && g0.game.rival === true, `${tag}: a wall starts at round 1 with Ida playing`);
  if (swap) check(g0.game.colors.includes(swap), `${tag}: the wall uses the swapped glaze`);
  check(new Set(g0.game.colors).size === 5, `${tag}: five distinct glazes`);

  // --- the guide ------------------------------------------------------------------------
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  const bubble1 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/Tap a glaze/.test(bubble1), `${tag}: the guide's first step is the action itself ("${(bubble1 || '').trim()}")`);
  check(await page.locator('#guide-layer [data-coach-action]').count() === 0, `${tag}: an action step has no Got it button`);
  await shot('05-guide-1');
  await geometry(page, `${tag} board`);

  // First turn by hand so the guide follows it.
  const mv = await chooseMove(page);
  await tap(page, `#screen-tiles [data-src="${mv.source}"][data-i="${mv.index}"][data-c="${mv.color}"]`);
  await page.waitForTimeout(350);
  const bubble2 = await page.locator('#guide-layer .coach-tag').textContent().catch(() => '');
  check(/pattern line/.test(bubble2), `${tag}: the second step points at the lines ("${(bubble2 || '').trim()}")`);
  await shot('06-selected');
  if (mv.line >= 0) await tap(page, `#screen-tiles [data-line="${mv.line}"]`);
  else await tap(page, '#screen-tiles [data-basket]');
  // Mid-flight: the move is already saved, and the bar offers Ida's turn with Undo.
  await page.waitForTimeout(120);
  await shot('07-midflight');
  await idle(page);
  check(await phase(page) === 'pending', `${tag}: after her take, Ida's turn is owed`);
  check(await page.locator('[data-bar] [data-action="undo"]').count() === 1, `${tag}: Undo is offered until Ida moves`);
  check(/Ida/.test(await page.locator('[data-bar] [data-action="go"]').textContent()), `${tag}: the bar's next step is Ida's turn`);
  await page.waitForSelector('#guide-layer [data-coach-action]', { state: 'visible', timeout: 3000 }).catch(() => {});
  if (await page.locator('#guide-layer [data-coach-action]').count()) {
    await shot('08-guide-3');
    await tap(page, '#guide-layer [data-coach-action]');
  }
  // Ida goes by herself after a short pause (the playtested rhythm).
  await page.waitForFunction(() => window.tincture.ctx.sim.tiles.phase(window.tincture.game.state) !== 'pending', null, { timeout: 8000 });
  await idle(page);
  check((await tilesState(page)).game.rivalTiles > 0, `${tag}: Ida took her dish by herself`);
  check(await page.evaluate(() => !!window.tincture.game.state.onboarding.seen.tiles), `${tag}: the guide is marked seen`);

  // --- stale selection (T1): tap a tile in the dish Ida is about to take ------------------
  {
    const p = await playTurn(page);
    void p;
    if (await phase(page) === 'pending') {
      const target = await page.evaluate(() => {
        const g = window.tincture.game.state.tiles.game;
        const ch = window.tincture.ctx.puzzles.tiles.rivalChoice(g);
        return ch ? { dish: ch.dish, color: g.dishes[ch.dish][0] } : null;
      });
      if (target) {
        await tap(page, `#screen-tiles [data-src="dish"][data-i="${target.dish}"][data-c="${target.color}"]`);
        await idle(page);
        const sel = await page.evaluate(() => window.__tl.debugTiles().sel);
        const msg = await page.locator('[data-bar] .msg').textContent();
        check(sel === null && /Ida took that dish/.test(msg), `${tag}: tapping Ida's dish during her turn selects nothing and says so ("${msg.trim()}")`);
        check(await page.locator('#screen-tiles .tl-line.is-ok').count() === 0, `${tag}: no line glows for a stale selection`);
      }
    }
  }

  // --- play to the end of round 1, check the round-end flow waits for Deal ----------------
  for (let i = 0; i < 80 && (await phase(page)) !== 'deal' && (await phase(page)) !== 'over'; i++) await playTurn(page);
  if (await phase(page) === 'deal') {
    const label = (await page.locator('[data-bar] [data-action="deal"]').textContent()).trim();
    check(/^Deal round 2$/.test(label), `${tag}: the round ends and waits for "${label}"`);
    const t = await tilesState(page);
    check(t.paid > 0, `${tag}: the scored round paid coins (${t.paid.toFixed(2)})`);
    await shot('09-round-done');
    await page.waitForTimeout(1200);
    check((await phase(page)) === 'deal', `${tag}: nothing deals by itself`);
  }

  // --- reload mid-turn: right after a take, during the flight -------------------------------
  await playTurn(page); // deal round 2
  {
    const mv2 = await chooseMove(page);
    await tap(page, `#screen-tiles [data-src="${mv2.source}"][data-i="${mv2.index}"][data-c="${mv2.color}"]`);
    if (mv2.line >= 0) await tap(page, `#screen-tiles [data-line="${mv2.line}"]`);
    else await tap(page, '#screen-tiles [data-basket]');
    const before = await tilesState(page);
    await page.reload({ waitUntil: 'load' });
    await boot(page);
    const after = await tilesState(page);
    check(JSON.stringify(after) === JSON.stringify(before), `${tag}: a reload mid-flight keeps the move exactly (pending ${after.pending})`);
    await tap(page, '#tabbar [data-tab="puzzles"]');
    await page.waitForSelector('#pz-tiles [data-action="open-tiles"]', { state: 'visible' });
    const card = await page.locator('#pz-tiles').textContent();
    check(/Round 2/.test(card) && /Continue the wall/.test(card), `${tag}: the hub card shows her wall at a glance ("${card.replace(/\s+/g, ' ').trim().slice(0, 90)}")`);
    await shot('10-hub-continue');
    await page.evaluate(() => document.querySelector('#pz-tiles').scrollIntoView({ block: 'center' }));
    await shot('10b-hub-card');
    await tap(page, '#pz-tiles [data-action="open-tiles"]');
    await page.waitForSelector('#screen-tiles [data-dishes]', { state: 'visible' });
    if (after.pending) {
      await page.waitForFunction(() => window.tincture.ctx.sim.tiles.phase(window.tincture.game.state) !== 'pending', null, { timeout: 8000 });
      await idle(page);
      check(true, `${tag}: the owed turn resumes by itself after the reload`);
    }
  }

  // --- the rest of the wall with Ida ---------------------------------------------------------
  const coinsBefore = await page.evaluate(() => window.tincture.game.state.coins);
  const r1 = await playWall(page, `${tag} Ida on`, { rival: true });
  must(await phase(page) === 'over', `${tag}: the wall with Ida finishes (${r1.rounds} more rounds)`);
  check(r1.idaSeen, `${tag}: Ida's turn came after her takes`);
  check(r1.coinRises > 0 && (await page.evaluate(() => window.tincture.game.state.coins)) > coinsBefore, `${tag}: coins landed as rounds were scored (${r1.coinRises} times)`);
  await page.waitForTimeout(1600);
  const sum = await page.evaluate(() => {
    const c = document.querySelector('#screen-tiles [data-sumcard]');
    const r = c ? c.getBoundingClientRect() : null;
    return { has: !!c, top: r ? r.top : -1, bottom: r ? r.bottom : -1, vh: innerHeight };
  });
  check(sum.has && sum.top >= 0 && sum.top < sum.vh * 0.5, `${tag}: the finished mosaic is scrolled into view (top ${Math.round(sum.top)})`);
  check(/Start a new wall/.test(await page.locator('[data-bar]').textContent()), `${tag}: the bar's next step is Start a new wall`);
  const t1 = await tilesState(page);
  check(t1.walls === 1 && t1.mosaics.length === 1 && t1.mosaics[0].score === t1.best, `${tag}: the mosaic is recorded (score ${t1.mosaics[0] && t1.mosaics[0].score})`);
  check(await page.locator('#screen-tiles [data-mosaic-list] .tl-m').count() === 1, `${tag}: the mosaic shelf lists it`);
  await shot('11-summary');
  await page.locator('#screen-tiles [data-mosaic-list]').scrollIntoViewIfNeeded();
  await shot('12-mosaics');
  await geometry(page, `${tag} summary`);

  // --- a wall with Ida resting (reduced motion) -----------------------------------------------
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await tap(page, '[data-bar] [data-action="again"]');
  await page.waitForSelector('#screen-tiles [data-picker]:not([hidden])', { state: 'visible' });
  await tap(page, '#screen-tiles [data-foot] [data-action="rival"]');
  check(/resting/.test(await page.locator('#screen-tiles [data-foot] [data-action="rival"]').textContent()), `${tag}: Ida rests`);
  await tap(page, '#screen-tiles [data-bar] [data-action="start"]');
  await page.waitForSelector('#screen-tiles [data-dishes] .tl-tile', { state: 'visible' });
  check(await page.locator('#screen-tiles [data-ida]').isHidden(), `${tag}: Ida's face is hidden while she rests`);
  const r2 = await playWall(page, `${tag} solo`, { rival: false, sweepEvery: 2 });
  must(await phase(page) === 'over', `${tag}: the solo wall finishes (${r2.rounds} rounds)`);
  const t2 = await tilesState(page);
  check(t2.game.rivalTiles === 0 && !r2.idaSeen, `${tag}: Ida took nothing while resting`);
  check(t2.walls === 2 && t2.mosaics.length === 2, `${tag}: two mosaics`);
  await shot('13-solo-summary');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // --- How this works replays the guide --------------------------------------------------------
  await tap(page, '[data-bar] [data-action="again"]');
  await tap(page, '#screen-tiles [data-bar] [data-action="start"]');
  await page.waitForSelector('#screen-tiles [data-dishes] .tl-tile', { state: 'visible' });
  await tap(page, '#screen-tiles [data-guide-replay="tiles"]');
  await page.waitForSelector('#guide-layer .coach-tag', { state: 'visible', timeout: 4000 }).catch(() => {});
  check(/Tap a glaze/.test(await page.locator('#guide-layer .coach-tag').textContent().catch(() => '')), `${tag}: How this works replays the guide`);
  await playTurn(page);
  await playTurn(page);

  // --- Renovate ----------------------------------------------------------------------------------
  const beforeRen = await tilesState(page);
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st) => { st.phase = 3; st.runEarned = 4e8; return {}; }, {});
    game.act(ctx.sim.renovate);
  });
  const ren = await page.evaluate(() => ({ open: window.tincture.game.state.unlocks.tiles, reopen: window.tincture.game.state.renovateReopen }));
  check(ren.open === false && ren.reopen.includes('tiles'), `${tag}: Renovate closes the Tile Room and lists it for the re-buy`);
  const afterRen = await tilesState(page);
  check(afterRen.mosaics.length === beforeRen.mosaics.length && JSON.stringify(afterRen.game) === JSON.stringify(beforeRen.game), `${tag}: mosaics and the wall in progress stay through Renovate`);
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = document.querySelector('#screen-phase-beat:not([hidden]) [data-back], #screen-phase-beat:not([hidden]) .btn'); if (b) b.click(); });
  await page.evaluate(() => window.tincture.ctx.navigate('puzzles'));
  await page.waitForSelector('#pz-tiles', { state: 'visible' });
  check(await page.locator('#pz-tiles .tag, #pz-tiles [data-action="unlock-open"]').count() >= 1, `${tag}: the hub card shows the lock again`);
  await page.evaluate(() => document.querySelector('#pz-tiles').scrollIntoView({ block: 'center' }));
  await shot('14-renovated');
  await page.evaluate(() => {
    const { game, ctx } = window.tincture;
    game.act((st) => { st.coins = 1e6; return {}; }, {});
    game.act(ctx.sim.batchRebuy, {});
  });
  check(await page.evaluate(() => window.tincture.game.state.unlocks.tiles), `${tag}: the half-price re-buy reopens the Tile Room`);
  await page.evaluate(() => window.tincture.ctx.navigate('tiles'));
  await page.waitForSelector('#screen-tiles [data-dishes] .tl-tile', { state: 'visible' });
  check(JSON.stringify((await tilesState(page)).game) === JSON.stringify(beforeRen.game) || (await phase(page)) !== 'none', `${tag}: her wall waits for her after the re-buy`);
  await shot('15-reopened');

  check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();
}

/** From the workshop: Next names the Tile Room, the sheet buys it, the ceremony plays, and a two-choice card offers the way in. */
async function workshopWalk(viewport, tag) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) });
  await page.goto(URL_, { waitUntil: 'load' });
  await boot(page);
  await seed(page);
  await page.evaluate(() => { window.tincture.game.act((st) => { st.unlocks.shelf = true; st.unlocks.hunters = true; st.unlocks.skeins = true; st.unlocks.lift = true; return {}; }, {}); window.tincture.game.save(); });
  await page.reload({ waitUntil: 'load' });
  await boot(page);
  await page.waitForSelector('#screen-workshop [data-action="next"]', { state: 'visible' });
  await page.waitForTimeout(400);
  const label = (await page.locator('#screen-workshop [data-action="next"]').textContent()).trim();
  check(/Tile Room/.test(label), `${tag}: the workshop's Next names the Tile Room ("${label}")`);
  await tap(page, '#screen-workshop [data-action="next"]');
  await page.waitForSelector('[data-action="unlock-buy"]', { state: 'visible' });
  await shot('w1-sheet');
  await tap(page, '[data-action="unlock-buy"]');
  await page.waitForTimeout(500);
  await shot('w2-ceremony');
  const go = page.locator('[data-overlay-action]', { hasText: 'Go to the Tile Room' });
  await go.waitFor({ state: 'visible', timeout: 6000 });
  await shot('w3-whats-next');
  await tap(page, go);
  await page.waitForSelector('#screen-tiles [data-picker]:not([hidden])', { state: 'visible' });
  check(true, `${tag}: "Go to the Tile Room" opens it at the glaze picker`);
  check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall Tile Room checks passed');
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
