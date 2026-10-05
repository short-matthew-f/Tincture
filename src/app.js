/**
 * app.js: boot. Loads the save into a Game, builds the shared `ctx`
 * (docs/UI-CONTRACT.md), mounts every screen into its <section data-screen>,
 * wires the tab bar, back handling, taps, visibility, the service worker, and
 * maps domain events to feel (DESIGN.md "Interaction spec") and ceremonies
 * (discovery naming, phase beats). Implements ARCHITECTURE.md "UI", "Game
 * loop" and "PWA and updates".
 *
 * Screens load through dynamic import() from the SCREEN_IDS list; a module
 * that is missing or fails to load gets a "Coming soon" placeholder, so one
 * broken screen never takes the app down.
 *
 * Toasts: app.js sets overlay's toast gate (hold while a coach mark or a
 * guide bubble, a ceremony or a puzzle board is up; drop "X joins your
 * catalog" while naming shows X), sends domain-event news as kind 'info' so it
 * collapses into one slip, and calls overlay.leaveScreen() whenever the top
 * screen changes so a toast never carries across a navigation.
 *
 * Unlock purchases: an unlock that is a room (Gallery Wing, Loading Yard)
 * drops its 'room' phase beat (the scene's unlock ceremony is the beat) and
 * holds other beats until workshop.js emits 'unlocked'; 'unlocked' {id} then
 * starts that subgame's guide (guide id = the unlock id; hunters also 'map',
 * shipping also 'yard') when one is registered and not yet seen.
 *
 * ctx.guide(id, steps, opts) is guide.js's guide() bound to ctx, with
 * ctx.guide.whatsNext(opts), .howThisWorks(id), .howThisWorksHtml(id),
 * .replay(id) and .isUp(). ctx.fx is fx.js (spring, lift, settle, drag,
 * coinArc, stamp, pour and the older effects). Naming ceremonies queue at most MAX_QUEUED_NAMINGS deep; the rest keep
 * their catalog names and one line says so.
 *
 * Debug handle: window.tincture = {game, ctx, router, version, debug: {advance(ms), discover(colorId)}}.
 */

import { Game } from './game.js';
import * as sim from './sim/index.js';
import * as puzzles from './puzzles/index.js';
import * as color from './color.js';
import * as fmt from './format.js';
import * as kit from './ui/kit.js';
import { audio } from './ui/audio.js';
import { haptics } from './ui/haptics.js';
import { fx } from './ui/fx.js';
import * as overlay from './ui/overlay.js';
import * as guides from './ui/guide.js';
import { createRouter, TABS } from './ui/router.js';
import { applySettings } from './ui/settings.js';
import { registerSW, APP_VERSION } from './pwa.js';

import * as apprentices from './content/apprentices.js';
import * as canvases from './content/canvases.js';
import * as catalog from './content/catalog.js';
import * as commissions from './content/commissions.js';
import * as eras from './content/eras.js';
import * as events from './content/events.js';
import * as heritage from './content/heritage.js';
import * as hunters from './content/hunters.js';
import * as names from './content/names.js';
import * as pigments from './content/pigments.js';
import * as postcards from './content/postcards.js';
import * as quests from './content/quests.js';
import * as regions from './content/regions.js';
import * as rooms from './content/rooms.js';
import * as routes from './content/routes.js';
import * as sources from './content/sources.js';
import * as stations from './content/stations.js';

/** Every screen module under src/ui/, matching <section data-screen> in index.html. */
export const SCREEN_IDS = Object.freeze([
  'workshop', 'ledger', 'orders', 'matching', 'bench', 'commissions', 'puzzles', 'grading', 'purify',
  'packing', 'map', 'hunter', 'album', 'quests', 'catalog', 'gallery', 'paint', 'shelf', 'heritage',
  'settings', 'naming', 'phase-beat', 'onboarding',
]);

/** Screens that are ceremonies: one at a time, others wait in a queue. */
const CEREMONY_IDS = new Set(['naming', 'phase-beat', 'onboarding']);
/** News toasts wait behind these (nothing blocks a ceremony or a puzzle board). */
const NEWS_WAITS_FOR = new Set([...CEREMONY_IDS, 'grading', 'purify', 'packing']);

const TITLES = {
  workshop: 'Workshop', ledger: 'Morning Ledger', orders: 'Orders', matching: 'Matching', bench: 'Mixing Bench',
  commissions: 'Commissions', puzzles: 'Puzzles', grading: 'Grading', purify: 'Purifying', packing: 'Packing',
  map: 'Map', hunter: 'Hunter', album: 'Postcard Album', quests: 'Quests', catalog: 'Catalog', gallery: 'Gallery',
  paint: 'Painting', shelf: 'Merge Shelf', heritage: 'Heritage', settings: 'Settings', naming: 'A new color',
  'phase-beat': 'Something new', onboarding: 'Welcome',
};

// ---------------------------------------------------------------------------
// Content + format
// ---------------------------------------------------------------------------

function mergeContent() {
  const merged = Object.assign({}, apprentices, canvases, catalog, commissions, eras, events, heritage, hunters,
    names, pigments, postcards, quests, regions, rooms, routes, sources, stations);
  delete merged.byId; // every module has its own byId; use the named *_BY_ID maps instead
  merged.modules = { apprentices, canvases, catalog, commissions, eras, events, heritage, hunters, names, pigments,
    postcards, quests, regions, rooms, routes, sources, stations };
  return Object.freeze(merged);
}

function makeFormat(game) {
  const notation = () => (game.state && game.state.settings && game.state.settings.notation) || 'short';
  return {
    num: (n) => fmt.formatNumber(n, notation()),
    duration: (ms) => fmt.formatDuration(ms),
    countdown: (ms) => fmt.formatCountdown(ms),
    until: (ms) => fmt.formatUntil(ms),
    rate: (perSec) => fmt.formatRate(perSec, notation()),
    pct: (x) => fmt.pct(x),
    dayKey: fmt.dayKey,
    isoWeekKey: fmt.isoWeekKey,
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function placeholderScreen(id) {
  let root = null;
  return {
    id,
    placeholder: true,
    mount(el) {
      root = el;
      const isTab = TABS.includes(id);
      root.innerHTML = String(kit.h`
        <header class="screen-head">
          ${isTab ? kit.raw('<div class="spacer"></div>') : kit.backButton('Back')}
          <div class="titles"><div class="title">${TITLES[id] || id}</div></div>
          <div class="spacer"></div>
        </header>
        <div class="screen-body">
          <div class="card center"><div class="card-title">Coming soon</div>
            <div class="hint">This part of the workshop is still being painted.</div></div>
        </div>`);
    },
    show() {},
    hide() {},
    render() {},
  };
}

async function loadScreen(id) {
  try {
    const m = await import(`./ui/${id}.js`);
    const mod = m && (m.default || m);
    if (!mod || typeof mod.mount !== 'function') throw new Error('no default export with mount()');
    return { mod, ns: m };
  } catch (e) {
    console.warn(`[app] screen "${id}" is not available yet; showing a placeholder.`, e && e.message);
    return { mod: placeholderScreen(id), ns: {} };
  }
}

function sectionFor(id) {
  const app = document.getElementById('app');
  let sec = app.querySelector(`:scope > section[data-screen="${id}"]`);
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'screen';
    sec.id = `screen-${id}`;
    sec.dataset.screen = id;
    sec.hidden = true;
    app.appendChild(sec);
  }
  return sec;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const game = new Game({ reload: () => location.reload() });
  applySettings(game.state.settings, { audio, haptics });

  const content = mergeContent();
  const ctx = {
    game,
    sim,
    puzzles,
    content,
    color,
    format: makeFormat(game),
    audio,
    haptics,
    fx,
    kit,
    overlay,
    navigate: (id, params) => router && router.navigate(id, params),
    back: () => router && router.back(),
    current: () => (router ? router.current() : null),
    isTab: (id) => TABS.includes(id),
    toast: (text, opts) => overlay.toast(text, opts),
    modal: (opts) => overlay.modal(opts),
    sheet: (opts) => overlay.sheet(opts),
    celebrate: (kind, payload) => celebrate(kind, payload),
    guide: null,
    router: null,
  };
  let router = null;
  ctx.guide = Object.assign((id, steps, opts) => guides.guide(id, steps, ctx, opts), {
    whatsNext: (opts) => guides.whatsNext(ctx, opts),
    howThisWorks: guides.howThisWorks,
    howThisWorksHtml: guides.howThisWorksHtml,
    replay: guides.replay,
    isUp: guides.isGuideUp,
  });

  // --- screens ------------------------------------------------------------
  const loaded = await Promise.all(SCREEN_IDS.map(loadScreen));
  const screens = {};
  SCREEN_IDS.forEach((id, i) => {
    const section = sectionFor(id);
    let { mod } = loaded[i];
    try {
      mod.mount(section, ctx);
    } catch (e) {
      console.error(`[app] screen "${id}" failed to mount; showing a placeholder.`, e);
      mod = placeholderScreen(id);
      section.innerHTML = '';
      mod.mount(section, ctx);
    }
    section.hidden = true;
    screens[id] = { module: mod, section, ns: loaded[i].ns };
  });

  let lastTopId = null;
  const observers = Object.values(screens).map((s) => s.module).filter((m) => typeof m.observe === 'function');

  router = createRouter({
    screens,
    root: document.getElementById('app'),
    tabbar: document.getElementById('tabbar'),
    overlay,
    onChange: (top) => {
      // A toast never carries across a navigation (synchronously, so a toast
      // the new screen raises in its show() survives).
      const id = top ? top.id : null;
      if (id !== lastTopId) { lastTopId = id; overlay.leaveScreen(); }
      setTimeout(() => { overlay.placeToasts(); pumpCeremonies(); }, 0);
    },
    tabDots: (state) => {
      const a = sim.hunters.mapAttention(state, game.now());
      return { map: a.choices + a.hauls > 0 };
    },
    afterRender: (state, top) => {
      for (const m of observers) {
        try { m.observe(state, top); } catch (e) { console.error('[app] observe failed', e); }
      }
    },
  });
  ctx.router = router;

  // --- ceremonies -----------------------------------------------------------
  const ceremonyQueue = [];
  let pendingLedger = null; // a return that arrived while a ceremony was on screen
  // Many colors at once (a big board, a hunter's haul): name the first few one
  // by one, and let the rest keep their catalog names with one quiet line.
  const MAX_QUEUED_NAMINGS = 3;
  let quietlyNamed = 0;

  function ceremonyActive() {
    const top = router.current();
    return !!(top && CEREMONY_IDS.has(top.id));
  }

  // An unlock that IS a room (Gallery Wing, Loading Yard) plays its own 1.5 s
  // ceremony in the scene and then emits 'unlocked'. Its 'room' beat would
  // repeat the "What this opens" sheet, so it is dropped, and any other beat the
  // purchase raised (Phase 3 with the Loading Yard) waits until 'unlocked' (or
  // UNLOCK_HOLD_MS, for a purchase made where no ceremony plays).
  const ROOM_UNLOCKS = Object.freeze({ gallery: 'gallery-wing', shipping: 'loading-yard' });
  const UNLOCK_HOLD_MS = 4000;
  const unlockRooms = new Set();
  let ceremonyHold = 0;
  function holdCeremonies(ms) {
    clearTimeout(ceremonyHold);
    ceremonyHold = setTimeout(releaseCeremonies, ms);
  }
  function releaseCeremonies() {
    unlockRooms.clear();
    if (!ceremonyHold) return;
    clearTimeout(ceremonyHold);
    ceremonyHold = 0;
    pumpCeremonies();
  }

  function pumpCeremonies() {
    if (ceremonyActive() || ceremonyHold) return;
    if (quietlyNamed && !ceremonyQueue.some((c) => c.screen === 'naming')) {
      const n = quietlyNamed;
      quietlyNamed = 0;
      overlay.toast(n === 1 ? 'One more new color is waiting in your catalog' : `${n} more new colors are waiting in your catalog`, { kind: 'info' });
    }
    if (pendingLedger) {
      const summary = pendingLedger;
      pendingLedger = null;
      router.navigate('ledger', { summary });
    }
    if (!ceremonyQueue.length) return;
    const next = ceremonyQueue.shift();
    router.navigate(next.screen, next.params);
  }

  function queueCeremony(screen, params) {
    if (screen === 'naming' && ceremonyQueue.some((c) => c.screen === 'naming' && c.params.colorId === params.colorId)) return;
    if (screen === 'naming' && ceremonyQueue.filter((c) => c.screen === 'naming').length >= MAX_QUEUED_NAMINGS) {
      quietlyNamed++;
      return;
    }
    ceremonyQueue.push({ screen, params });
    pumpCeremonies();
  }

  function celebrate(kind, payload = {}) {
    const p = payload || {};
    switch (kind) {
      case 'discover': queueCeremony('naming', p); break;
      case 'phase': queueCeremony('phase-beat', { ...p, kind: 'phase' }); break;
      case 'milestone': queueCeremony('phase-beat', { ...p, kind: 'milestone' }); break;
      case 'room': queueCeremony('phase-beat', { ...p, kind: 'room' }); break;
      case 'renovate': queueCeremony('phase-beat', { ...p, kind: 'renovate' }); break;
      case 'allCaughtUp':
        // The Morning Ledger lands its own stamp (sound, haptic, ring); only celebrate elsewhere.
        if (router.isOpen('ledger')) break;
        audio.stamp();
        haptics.medium();
        break;
      // A custom beat must say what changed; a bare one is never shown.
      default: if (p.title) queueCeremony('phase-beat', p); break;
    }
  }

  // --- toasts: where and when ------------------------------------------------
  // Hold every toast while a coach mark is up (onboarding suspends the visible
  // ones when a mark appears), hold news behind ceremonies and puzzle boards,
  // and drop "X joins your catalog" while the naming screen is showing X.
  overlay.setToastGate(({ text, kind }) => {
    if (router.isOpen('naming') && (kind === 'discovery' || /\bjoins (your|the) catalog\b/i.test(text))) return 'drop';
    if (document.querySelector('#coach-layer .coach-tag') || guides.isGuideUp()) return 'hold';
    const top = router.current();
    if (!top) return 'show';
    if (CEREMONY_IDS.has(top.id)) return 'hold';
    if (kind !== 'action' && NEWS_WAITS_FOR.has(top.id)) return 'hold';
    return 'show';
  });
  const news = (text, opts = {}) => overlay.toast(text, { ...opts, kind: 'info' });

  // --- domain events -> feel ------------------------------------------------
  const quiet = (meta) => !!(meta && meta.catchUp);
  const once = new Set();
  const nameOf = (id) => { try { return sim.displayName(game.state, id) || id; } catch (e) { return id; } };
  const hexOf = (id) => { const c = content.getColor && content.getColor(id); return c ? c.hex : null; };

  game.on('change', (state) => router.requestRender(state));

  game.on('discover', (p) => celebrate('discover', p));

  game.on('chain', (p, meta) => {
    if (quiet(meta)) return;
    const steps = (p && p.steps) || [];
    steps.forEach((s, i) => setTimeout(() => { audio.chain(i); haptics.light(); }, i * 90));
  });

  game.on('essence', (p, meta) => {
    if (quiet(meta)) return;
    audio.bell();
    haptics.success();
    const from = document.querySelector('[data-essence-from]')
      || document.querySelector(`#app > .screen:not([hidden]) [data-cell][data-color="${p.colorId}"]`);
    const to = document.querySelector(`#app > .screen:not([hidden]) [data-swatch="${p.colorId}"]`)
      || document.querySelector('#tabbar [data-tab="catalog"]');
    if (from && to) fx.flyTo(from, to, '#E2B04A', { count: 1, ms: 900 });
  });

  game.on('milestone', (p, meta) => {
    if (!quiet(meta)) {
      audio.thunk();
      audio.clink(5);
      haptics.medium();
    }
    if (p && p.kind === 'catalog') celebrate('milestone', { colors: p.colors, level: p.level });
  });

  game.on('phase', (p) => celebrate('phase', { phase: p.phase }));
  game.on('unlock', (p) => {
    const room = p && ROOM_UNLOCKS[p.id];
    if (!room) return;
    unlockRooms.add(room);
    holdCeremonies(UNLOCK_HOLD_MS);
  });
  game.on('room', (p) => {
    if (p && unlockRooms.delete(p.id)) return; // the unlock ceremony is the beat
    celebrate('room', { id: p.id });
  });
  // After an unlock's ceremony (workshop.js emits 'unlocked' {id, object}):
  // release held beats, then hand off to that subgame's guide, if one is
  // registered and she has not seen it (it shows once she is on its screen).
  const GUIDES_FOR_UNLOCK = Object.freeze({
    shelf: ['shelf'], hunters: ['hunters', 'map'], gallery: ['gallery'], shipping: ['shipping', 'yard'], commissions: ['commissions'],
  });
  game.on('unlocked', (p) => {
    releaseCeremonies();
    const id = p && p.id;
    for (const gid of GUIDES_FOR_UNLOCK[id] || (id ? [id] : [])) {
      if (guides.isSeen(game.state, gid)) break;
      if (guides.replay(gid)) break;
    }
  });
  game.on('renovate', (p) => celebrate('renovate', { heritage: p.heritage }));

  game.on('hunterReturn', (p, meta) => { if (!quiet(meta)) audio.knock(); });

  game.on('postcard', (p, meta) => {
    if (quiet(meta)) return;
    const card = content.getPostcard && content.getPostcard(p.id);
    news(p.duplicate ? 'A postcard you already have: turned into Seals' : `A postcard: ${card ? card.title : 'news from afar'}`);
  });

  game.on('setComplete', (p, meta) => {
    if (quiet(meta)) return;
    const r = content.getRegion && content.getRegion(p.region);
    audio.chord([0.45, 0.6, 0.75, 0.9], 0.8);
    news(`Postcard set complete${r ? `: ${r.name}` : ''}`);
  });

  game.on('allCaughtUp', () => celebrate('allCaughtUp'));

  game.on('storageFull', () => {
    if (once.has('storageFull')) return;
    once.add('storageFull');
    news('The vats are full: a good moment to collect, ship or sell.', { ms: 3200 });
  });

  game.on('saveFailed', () => {
    if (once.has('saveFailed')) return;
    once.add('saveFailed');
    news('This device is out of space, so saving is paused. Export a save from Settings.', { ms: 4000 });
  });

  game.on('comingSoon', () => {
    overlay.modal({
      title: 'Coming in a later update',
      body: 'The next era is still being painted. Everything you have made is safe and waiting.',
      actions: [{ label: 'Lovely', variant: 'primary', value: true }],
    });
  });

  game.on('golden', (p, meta) => { if (!quiet(meta)) news('A golden vial landed on the shelf', { hex: '#E2B04A' }); });
  game.on('accident', (p, meta) => {
    if (quiet(meta)) return;
    audio.bell();
    news('A happy accident in the mixers');
  });
  game.on('questDone', (p, meta) => { if (!quiet(meta)) news('A quest is ready to claim'); });
  game.on('weeklyDone', (p, meta) => { if (!quiet(meta)) news('The weekly quest is complete'); });
  game.on('eventStep', (p, meta) => { if (!quiet(meta)) news('A new event reward is ready'); });
  game.on('commissionDone', (p, meta) => {
    if (quiet(meta)) return;
    // The Commissions screen runs its own "Commission complete!" ceremony; never a second one.
    if (router.isOpen('commissions')) return;
    const c = content.getCommission && content.getCommission(p.id);
    audio.chord([0.4, 0.55, 0.7, 0.85], 1);
    haptics.success();
    news(`Commission complete${c ? `: ${c.name || c.title || ''}` : ''}`);
  });
  game.on('sourceUnlocked', (p, meta) => {
    if (quiet(meta)) return;
    const src = content.SOURCES && content.SOURCES.find((s) => s.id === p.sourceId);
    news(`A new pigment source: ${src ? src.name : nameOf(p.sourceId)}`, { hex: hexOf(src && src.pigment) });
  });
  game.on('collector', (p, meta) => { if (!quiet(meta)) news('A collector is visiting the Gallery'); });
  game.on('scoutChoice', (p, meta) => { if (!quiet(meta)) news('A hunter sent word: a choice is waiting on the map'); });

  game.on('return', (summary) => {
    const s = game.state;
    if (!s.onboarding || !s.onboarding.done) return;
    if (ceremonyActive()) pendingLedger = summary;
    else router.navigate('ledger', { summary });
  });

  game.on('import', (state) => {
    applySettings(state.settings, { audio, haptics });
    ceremonyQueue.length = 0;
    unlockRooms.clear();
    clearTimeout(ceremonyHold);
    ceremonyHold = 0;
    quietlyNamed = 0;
    pendingLedger = null;
    router.navigate('workshop');
  });

  // --- DOM wiring -------------------------------------------------------------
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest || !e.target.closest('[data-tap]')) return;
    audio.unlock();
    audio.tick();
    haptics.light();
  }, { passive: true });

  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const tab = e.target.closest('#tabbar [data-tab]');
    if (tab) { router.navigate(tab.dataset.tab); return; }
    if (e.target.closest('[data-back]')) { router.back(); return; }
    if (e.target.closest('[data-action="settings"]')) router.navigate('settings');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.suspend();
    else game.resume();
  });
  window.addEventListener('pagehide', () => game.suspend());
  window.addEventListener('pageshow', (e) => { if (e.persisted) game.resume(); });

  // --- first screen + loop ----------------------------------------------------
  router.navigate('workshop');
  const ob = game.state.onboarding;
  if (ob && !ob.done && ob.step === 0) router.navigate('onboarding');
  game.start();
  router.requestRender(game.state);

  registerSW({
    onUpdateReady: () => {
      document.documentElement.dataset.updateReady = 'on';
      news('Update ready. Restart from Settings.', { ms: 3600 });
    },
  });

  window.tincture = { game, ctx, router, version: APP_VERSION, debug: makeDebug(game) };
  return { game, ctx, router };
}

/**
 * Debug helpers for tests and the console (window.tincture.debug). Never used by
 * the game itself.
 *  - advance(ms): pretend `ms` passed while away. Shifts the loop clocks and the
 *    schedules that wait on absolute times (sim.shiftClock: order refresh,
 *    spillover, collector, trips, Rush, boosts) back by `ms`, then resumes (>= 60 s runs the offline catch-up and
 *    opens the Morning Ledger) or ticks.
 *  - discover(colorId): discover a color through the real sim (the naming
 *    ceremony follows as in play).
 */
function makeDebug(game) {
  return {
    advance(ms) {
      sim.shiftClock(game.state, Math.max(0, Number(ms) || 0));
      const summary = game.resume();
      if (!summary) game.tick();
      return summary;
    },
    discover(colorId) {
      return game.act(sim.discover, { colorId, method: 'debug' });
    },
  };
}

overlay.injectStyle('app-style', `
html[data-update-ready="on"] [data-action="settings"] { position: relative; }
html[data-update-ready="on"] [data-action="settings"]::after { content: ''; position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--walnut); box-shadow: 0 0 0 2px var(--paper); }
`);

boot().catch((e) => {
  console.error('[app] boot failed', e);
  const app = document.getElementById('app');
  if (app) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.margin = '24px 16px';
    div.textContent = 'Tincture could not start. Try reloading; your save is kept on this device.';
    app.appendChild(div);
  }
});
