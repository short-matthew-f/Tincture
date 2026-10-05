// state.js — save shape, versioning and migration (pure; no localStorage, no Date.now()).
// Implements ARCHITECTURE.md "State". Saves are JSON {v, savedAt, state} stored by
// src/game.js under SAVE_KEY. Every shape change bumps SAVE_VERSION and adds a
// step in migrate().

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'tincture.save';
/** Coins in the till of a brand-new workshop. */
export const STARTING_COINS = 25;

const PRIMARIES = [
  ['madder', 'Madder'],
  ['ochre', 'Ochre'],
  ['woad', 'Woad'],
];

/** createInitialState(now, seed) -> fresh state. `_events` is transient (never saved). */
export function createInitialState(now = 0, seed) {
  const s = seed === undefined || seed === null
    ? ((now ^ 0x9e3779b9) >>> 0)
    : (seed >>> 0);
  const sources = {};
  const raw = {};
  const pigment = {};
  const discovered = {};
  for (const [id, name] of PRIMARIES) {
    sources[id] = { level: 1 };
    raw[id] = 0;
    pigment[id] = 0;
    discovered[id] = { at: now, name, custom: false, essence: 0 };
  }
  return {
    v: SAVE_VERSION,
    seed: s,
    createdAt: now,
    lastTick: now,
    lastSeenAt: now,
    settings: {
      sound: true,
      haptics: true,
      reducedMotion: 'system',
      colorblind: false,
      notation: 'short',
      disabledQuestTypes: [],
      notifyHunters: false,
      notifyVats: false,
      puzzleTier: { grading: 'relaxed', purify: 'relaxed' },
    },
    // `seen`: one entry per subgame guide (src/ui/guide.js) that has run.
    onboarding: { step: 0, done: false, flags: {}, seen: {} },
    era: 1,
    phase: 1,
    // "A few coins left in the drawer": the inherited workshop starts with a small
    // till so her first upgrades come right after the first order and board
    // (DESIGN.md "First ten minutes", tools/balance/TUNING.md change 7).
    // Renovate does not refill it (prestige.js starts the new run at Deep Pockets).
    coins: STARTING_COINS,
    seals: 0,
    heritage: 0,
    heritageSpent: {},
    runEarned: 0,
    lifetime: { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 },
    rooms: ['bench'],
    stations: {
      sources,
      grinders: [{ kind: 'mortar', level: 1 }],
      // Two mixers from the start (docs/PLAN-v0.2.md Theme A.1): two colors to mix and paint with.
      mixers: [
        { recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null },
        { recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null },
      ],
      vats: [
        { level: 1, color: null },
        { level: 1, color: null },
        { level: 1, color: null },
      ],
      shop: { level: 1 },
      fleet: [],
    },
    cellarLevel: 1,
    raw,
    pigment,
    stock: {},
    catalog: { discovered, pinned: [] },
    // Coin-bought systems (src/sim/unlocks.js); colors only reveal the price.
    // Reset on Renovate unless a Heritage keep-* node holds them open.
    unlocks: { shelf: false, hunters: false, gallery: false, shipping: false, commissions: false },
    renovateReopen: [],        // unlock ids open before the last Renovate (batch re-buy)
    // Shop reserve: colorId -> jars the shop and the Dispatcher never sell.
    // Missing entries use the default rule (storage.keepOf): 20 jars of a pinned
    // color or one used by a started painting.
    keep: {},
    apprentices: {
      errandRunner: false,
      orderClerk: false,
      dispatcher: false,
      packer: false,
      steward: false,
    },
    stewardOn: false,
    orders: { open: [], nextRefreshAt: 0, reputation: 0, filledCount: 0 },
    muddyBatches: [],
    boosts: [],
    shelf: {
      cols: 5,
      rows: 7,
      cells: new Array(35).fill(null),
      rowLabels: new Array(7).fill(null),
      colors: [],              // the (≤5) color chips spillover delivers
      waiting: 0,              // vials piled behind the glass before the shelf is bought
      nextSpilloverAt: 0,
    },
    gallery: {
      unlocked: false,
      canvases: [],
      pieces: [],
      walls: 4,
      hung: [],
      taste: null,
      nextCollectorAt: 0,
      collectorOffer: null,
    },
    hunters: { roster: [], regionsUnlocked: [] },
    album: { cards: {}, setsDone: [] },
    quests: {
      daily: [],
      dailyDate: null,
      rerollUsed: false,
      weekly: null,
      weeklyKey: null,
      bank: 0,
    },
    event: null,
    eventProgress: {},
    commissions: { open: [], done: [] },
    ledger: { pending: null, allCaughtUpAt: now },
    stats: {
      sessionStartedAt: now, lastCloseUpAt: 0, fastSolves: 0,
      // Local-only feel counters (debug panel; docs/PLAN-v0.2.md amendments).
      lines: 0, lineSkips: 0, wrongDrops: 0, rejectedDrags: 0, coachDismissed: 0,
    },
    activePuzzles: {},         // puzzle id -> in-progress board (grading, purify, ...)
    flags: {},                 // sim bookkeeping (storageFull edge, firstTickAt, ...)
    pendingCollect: 0,         // shop till waiting for Collect
    discoveredMarkets: [],     // route ids found by the Trader / markets
    routesDiscovered: [],      // special markets hunters have reported
    cosmetics: [],             // event-track cosmetic ids
    trophies: [],              // commission trophy ids
    _events: [],
  };
}

/** serialize(state) -> JSON string {v, savedAt, state}; strips transient `_events`. */
export function serialize(state, savedAt) {
  const { _events, ...rest } = state; // eslint-disable-line no-unused-vars
  const at = savedAt !== undefined ? savedAt : (state.lastSeenAt ?? 0);
  return JSON.stringify({ v: state.v ?? SAVE_VERSION, savedAt: at, state: rest });
}

/**
 * migrate(saveObj) -> saveObj at SAVE_VERSION. Add a `case` per old version that
 * transforms saveObj.state and falls through to the next. Throws on a save from
 * a newer version (so the caller can refuse rather than corrupt it).
 */
export function migrate(saveObj) {
  if (!saveObj || typeof saveObj !== 'object' || !saveObj.state || typeof saveObj.state !== 'object') {
    throw new Error('Invalid save: missing state');
  }
  let v = Number.isInteger(saveObj.v) ? saveObj.v : 1;
  if (v > SAVE_VERSION) throw new Error(`Save is from a newer version (v${v})`);
  switch (v) { // eslint-disable-line default-case
    case 1: migrateV1toV2(saveObj.state); v = 2; // falls through
    default:
      break;
  }
  saveObj.v = SAVE_VERSION;
  saveObj.state.v = SAVE_VERSION;
  return saveObj;
}

const UNLOCK_IDS = ['shelf', 'hunters', 'gallery', 'shipping', 'commissions'];

/**
 * v1 (0.1.x) -> v2 (0.2): coin-bought unlocks granted for every system the save
 * already used, a second mixer, the shelf's color chips and waiting pile, the
 * shop reserve, purify tier, guide bookkeeping, local counters and the one-time
 * "What changed in 0.2" note (state.flags.whatsNew). The shelf grid itself
 * (5x7 -> 6x6, rowLabels) is converted by the step-3 shelf rework.
 */
function migrateV1toV2(st) {
  const cells = Array.isArray(st.shelf?.cells) ? st.shelf.cells : [];
  const prev = isPlainObject(st.unlocks) ? st.unlocks : {};
  const rooms = Array.isArray(st.rooms) ? st.rooms : [];
  const granted = {
    shelf: cells.some((c) => c && typeof c === 'object'),
    hunters: Array.isArray(st.hunters?.roster) && st.hunters.roster.length > 0,
    gallery: !!st.gallery?.unlocked,
    shipping: rooms.includes('loading-yard'),
    commissions: (Number(st.phase) || 1) >= 3,
  };
  st.unlocks = {};
  for (const id of UNLOCK_IDS) st.unlocks[id] = !!(prev[id] || granted[id]);
  if (!Array.isArray(st.renovateReopen)) st.renovateReopen = [];
  const mixers = st.stations?.mixers;
  if (Array.isArray(mixers) && mixers.length === 1) {
    mixers.push({ recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null });
  }
  if (isPlainObject(st.shelf)) {
    if (!Array.isArray(st.shelf.colors)) {
      const colors = [];
      for (const c of cells) {
        if (c && typeof c.color === 'string' && !colors.includes(c.color) && colors.length < 5) colors.push(c.color);
      }
      st.shelf.colors = colors;
    }
    if (!Number.isFinite(st.shelf.waiting)) st.shelf.waiting = 0;
  }
  if (!isPlainObject(st.keep)) st.keep = {};
  if (isPlainObject(st.settings)) {
    if (!isPlainObject(st.settings.puzzleTier)) st.settings.puzzleTier = { grading: 'relaxed' };
    if (!st.settings.puzzleTier.purify) st.settings.puzzleTier.purify = 'relaxed';
  }
  if (isPlainObject(st.onboarding) && !isPlainObject(st.onboarding.seen)) st.onboarding.seen = {};
  if (isPlainObject(st.stats)) {
    for (const k of ['lines', 'lineSkips', 'wrongDrops', 'rejectedDrags', 'coachDismissed']) {
      if (!Number.isFinite(st.stats[k])) st.stats[k] = 0;
    }
  }
  if (!isPlainObject(st.flags)) st.flags = {};
  st.flags.whatsNew = '0.2';
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Top-level sections whose own keys mergeDefaults fills in (one level deep). */
const DEEP_SECTIONS = ['onboarding', 'lifetime', 'stations', 'catalog', 'apprentices', 'orders', 'shelf',
  'gallery', 'hunters', 'album', 'quests', 'commissions', 'ledger', 'unlocks'];

function fillMissing(target, defaults) {
  for (const [k, d] of Object.entries(defaults)) {
    const v = target[k];
    if (v === undefined
      || (Array.isArray(d) && !Array.isArray(v))
      || (isPlainObject(d) && !isPlainObject(v))) target[k] = d;
  }
}

/**
 * mergeDefaults(state, now) -> state (mutated and returned). Fills any missing
 * top-level key from createInitialState; `settings` is merged one level deep
 * (puzzleTier too) so new settings appear on old saves, and so are the object
 * sections in DEEP_SECTIONS (gallery, onboarding + flags, orders, ...). Always
 * ensures `_events`.
 */
export function mergeDefaults(state, now = 0) {
  const defaults = createInitialState(now, state.seed);
  for (const key of Object.keys(defaults)) {
    if (state[key] === undefined) state[key] = defaults[key];
  }
  if (!isPlainObject(state.settings)) state.settings = defaults.settings;
  for (const key of Object.keys(defaults.settings)) {
    if (state.settings[key] === undefined) state.settings[key] = defaults.settings[key];
  }
  if (!isPlainObject(state.settings.puzzleTier)) state.settings.puzzleTier = defaults.settings.puzzleTier;
  for (const key of Object.keys(defaults.settings.puzzleTier)) {
    if (state.settings.puzzleTier[key] === undefined) {
      state.settings.puzzleTier[key] = defaults.settings.puzzleTier[key];
    }
  }
  // Sections saved as objects get their missing keys one level deep, so a v1
  // save from before a key existed (gallery.*, onboarding.flags, orders.*, ...)
  // loads with the default. A wrong type (array for object, object for array)
  // falls back to the default too.
  for (const key of DEEP_SECTIONS) {
    if (!isPlainObject(state[key])) { state[key] = defaults[key]; continue; }
    fillMissing(state[key], defaults[key]);
  }
  if (!isPlainObject(state.onboarding.flags)) state.onboarding.flags = {};
  if (!isPlainObject(state.onboarding.seen)) state.onboarding.seen = {};
  if (!isPlainObject(state.keep)) state.keep = {};
  if (!Array.isArray(state.renovateReopen)) state.renovateReopen = [];
  for (const key of ['coins', 'seals', 'heritage', 'runEarned']) {
    if (!Number.isFinite(state[key])) state[key] = key === 'coins' ? 0 : defaults[key];
  }
  if (!isPlainObject(state.flags)) state.flags = {};
  if (!Number.isFinite(state.pendingCollect)) state.pendingCollect = 0;
  for (const key of ['discoveredMarkets', 'routesDiscovered', 'cosmetics', 'trophies']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  // One list of found markets: fold the hunters' legacy mirror into the canonical list.
  for (const id of state.routesDiscovered) if (!state.discoveredMarkets.includes(id)) state.discoveredMarkets.push(id);
  if (!isPlainObject(state.stats)) state.stats = { ...defaults.stats };
  for (const key of Object.keys(defaults.stats)) {
    if (state.stats[key] === undefined) state.stats[key] = defaults.stats[key];
  }
  if (!isPlainObject(state.activePuzzles)) state.activePuzzles = {};
  if (!Array.isArray(state._events)) state._events = [];
  return state;
}

/** deserialize(json, now) -> state. Parses, migrates, merges defaults; throws on garbage. */
export function deserialize(json, now = 0) {
  let obj;
  try {
    obj = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (e) {
    throw new Error('Invalid save: not JSON');
  }
  if (!isPlainObject(obj)) throw new Error('Invalid save: not an object');
  // Every Tincture save since v1 has its stations and catalog: anything else is
  // some other JSON file, and importing it would wipe her game.
  if (!isPlainObject(obj.state) || !isPlainObject(obj.state.stations) || !isPlainObject(obj.state.catalog)) {
    throw new Error('Invalid save: not a Tincture save');
  }
  const migrated = migrate(obj);
  return mergeDefaults(migrated.state, now);
}
