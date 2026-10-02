// state.js — save shape, versioning and migration (pure; no localStorage, no Date.now()).
// Implements ARCHITECTURE.md "State". Saves are JSON {v, savedAt, state} stored by
// src/game.js under SAVE_KEY. Every shape change bumps SAVE_VERSION and adds a
// step in migrate().

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'tincture.save';

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
      puzzleTier: { grading: 'relaxed' },
    },
    onboarding: { step: 0, done: false, flags: {} },
    era: 1,
    phase: 1,
    coins: 0,
    seals: 0,
    heritage: 0,
    heritageSpent: {},
    runEarned: 0,
    lifetime: { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 },
    rooms: ['bench'],
    stations: {
      sources,
      grinders: [{ kind: 'mortar', level: 1 }],
      mixers: [{ recipe: null, level: 1, progress: 0, rushedAt: 0, accident: null }],
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
    stats: { sessionStartedAt: now, lastCloseUpAt: 0, fastSolves: 0 },
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
    // case 1: /* v1 -> v2 transform on saveObj.state */ v = 2; // falls through
    case 1:
    default:
      break;
  }
  saveObj.v = SAVE_VERSION;
  saveObj.state.v = SAVE_VERSION;
  return saveObj;
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * mergeDefaults(state, now) -> state (mutated and returned). Fills any missing
 * top-level key from createInitialState; `settings` is merged one level deep
 * (puzzleTier too) so new settings appear on old saves. Always ensures `_events`.
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
  const migrated = migrate(obj);
  return mergeDefaults(migrated.state, now);
}
