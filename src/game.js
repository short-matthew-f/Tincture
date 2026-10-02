/**
 * game.js: the Game class. Owns the live state, the 250 ms tick loop, autosave,
 * offline catch-up on return, and the tiny event emitter the UI listens to.
 * Implements ARCHITECTURE.md "Game loop" and the `ctx.game` half of
 * docs/UI-CONTRACT.md.
 *
 * Never touches `document` or `window`: app.js wires visibilitychange /
 * pagehide to `suspend()` / `resume()`, so this module runs under node --test.
 * Time, storage and timers are injectable:
 *
 *   new Game({ save, now: () => ms, storage, setInterval, clearInterval,
 *              setTimeout, clearTimeout, reload, tickMs, saveMs, seed })
 *
 * Events (game.on(type, fn)):
 *  - 'change' (state, info)      after every tick and act (app throttles render via rAF)
 *  - domain events drained from state._events: fn(payload, meta). payload is
 *    {type, ...fields} as pushed by src/sim/bus.js; meta.catchUp is true when
 *    the event happened during an offline catch-up.
 *  - 'return' (summary)          after an offline catch-up of >= 60 s (Morning Ledger)
 *  - 'import', 'reset'           after importSave / reset
 *  - '*' (type, payload, meta)   every emitted event, for observers (onboarding)
 */

import * as sim from './sim/index.js';
import { createInitialState, deserialize, serialize, SAVE_KEY } from './state.js';

export const TICK_MS = 250;
export const SAVE_MS = 1000;
export const AWAY_MS = 60e3;
/** If the saved clock is this far ahead of now, the device clock went backwards. */
export const CLOCK_SKEW_MS = 60e3;

/** In-memory Storage stand-in (tests, private mode, no localStorage). */
export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const k = '__tincture_probe__';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    }
  } catch (e) { /* blocked storage: fall through */ }
  return memoryStorage();
}

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

export class Game {
  constructor(opts = {}) {
    const {
      save, now, storage, seed, reload,
      tickMs = TICK_MS, saveMs = SAVE_MS,
    } = opts;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this.storage = storage || defaultStorage();
    this._setInterval = opts.setInterval || ((fn, ms) => setInterval(fn, ms));
    this._clearInterval = opts.clearInterval || ((id) => clearInterval(id));
    this._setTimeout = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = opts.clearTimeout || ((id) => clearTimeout(id));
    this._reload = typeof reload === 'function' ? reload : null;
    this.tickMs = tickMs;
    this.saveMs = saveMs;

    this._listeners = new Map();
    this._timer = null;          // tick interval id
    this._saveTimer = null;      // pending throttled save
    this._lastSaveAt = -Infinity;
    this._started = false;       // start() was called (suspend/resume keep this)
    this._suspended = false;
    this._saveFailed = false;
    this.loadError = null;       // set when a stored save could not be read
    this.isNew = true;           // false when the state came from a save

    const t = this.now();
    let text = save;
    if (text === undefined || text === null) {
      try { text = this.storage.getItem(SAVE_KEY); } catch (e) { text = null; }
    }
    let state = null;
    if (text) {
      try {
        state = deserialize(text, t);
        this.isNew = false;
      } catch (e) {
        this.loadError = e;
        console.error('[game] could not read the save; starting fresh (a copy is kept)', e);
        try { this.storage.setItem(SAVE_KEY + '.unreadable', String(text)); } catch (err) { /* ignore */ }
      }
    }
    this.state = state || createInitialState(t, seed);
    if (!Array.isArray(this.state._events)) this.state._events = [];
    this._fixClock(t);
  }

  // -------------------------------------------------------------------------
  // Emitter
  // -------------------------------------------------------------------------

  /** Subscribe; returns an unsubscribe function. */
  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }

  /** Emit to listeners of `type` (and '*'). A throwing listener never stops the others. */
  emit(type, payload, meta) {
    const call = (fn, ...args) => {
      try { fn(...args); } catch (e) { console.error(`[game] '${type}' listener failed`, e); }
    };
    const set = this._listeners.get(type);
    if (set) for (const fn of [...set]) call(fn, payload, meta);
    if (type !== '*') {
      const all = this._listeners.get('*');
      if (all) for (const fn of [...all]) call(fn, type, payload, meta);
    }
  }

  // -------------------------------------------------------------------------
  // Time and loop
  // -------------------------------------------------------------------------

  now() {
    const t = this._now();
    return Number.isFinite(t) ? t : Date.now();
  }

  /**
   * The device clock went backwards (saved times are in the future): rebase the
   * loop clocks to now so production keeps flowing instead of pausing until the
   * clock catches up. Nothing is granted and nothing is lost.
   */
  _fixClock(t) {
    const s = this.state;
    const ahead = Math.max(fin(s.lastTick) - t, fin(s.lastSeenAt) - t);
    if (!(ahead > CLOCK_SKEW_MS)) return;
    // Every schedule moves back with the clocks, so trips, cooldowns and boosts
    // keep the time they had left.
    sim.shiftClock(s, ahead);
    if (fin(s.lastTick) > t) s.lastTick = t;
    if (fin(s.lastSeenAt) > t) s.lastSeenAt = t;
  }

  /** Begin the 250 ms loop. Runs a catch-up first when she has been away >= 60 s. */
  start() {
    if (this._started && this._timer) return this;
    this._started = true;
    this._suspended = false;
    this.resume();
    this._startTimer();
    return this;
  }

  _startTimer() {
    if (this._timer || !this._started || this._suspended) return;
    this._timer = this._setInterval(() => this.tick(), this.tickMs);
  }

  _stopTimer() {
    if (this._timer) this._clearInterval(this._timer);
    this._timer = null;
  }

  /** Stop the loop for good (tests, teardown). Saves first. */
  stop() {
    this._started = false;
    this._stopTimer();
    if (this._saveTimer) this._clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.save();
  }

  /** The page went to the background: save now and stop ticking (resume() picks up). */
  suspend() {
    if (this._started) this._suspended = true;
    this._stopTimer();
    this.state.lastSeenAt = this.now();
    this.save();
  }

  /** One world step. Never throws: a failing tick is logged and the loop lives on. */
  tick() {
    const t = this.now();
    try {
      this._fixClock(t);
      sim.tick(this.state, t);
      this.state.lastSeenAt = Math.max(fin(this.state.lastSeenAt), t);
    } catch (e) {
      console.error('[game] tick failed', e);
    }
    this._drain();
    this.emit('change', this.state, { tick: true });
    this._requestSave();
  }

  /**
   * resume(now) -> LedgerSummary|null. Called on start and when the page becomes
   * visible again. Away >= 60 s: offline catch-up, emits 'return' with the
   * summary (before the catch-up's domain events, so ceremonies stack on top of
   * the Ledger), saves. Restarts the loop if it was suspended.
   */
  resume(now) {
    const t = Number.isFinite(now) ? now : this.now();
    this._suspended = false;
    this._fixClock(t);
    const s = this.state;
    const last = Number.isFinite(s.lastSeenAt) ? s.lastSeenAt : fin(s.lastTick, t);
    let summary = null;
    if (t - last >= AWAY_MS) {
      try {
        summary = sim.catchUp(s, t);
      } catch (e) {
        console.error('[game] catch-up failed', e);
      }
      if (summary) this.emit('return', summary);
      this._drain({ catchUp: true });
      this.save();
      this.emit('change', s, { resume: true });
    }
    this._startTimer();
    return summary;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * act(fn, args) -> fn's result. Runs fn(state, args, now), drains domain
   * events, saves (throttled to once a second), emits 'change'. A throwing sim
   * function is logged and returns undefined; the loop is never left dead.
   */
  act(fn, args) {
    if (typeof fn !== 'function') {
      console.error('[game] act() needs a sim function, got', fn);
      return undefined;
    }
    const t = this.now();
    let result;
    try {
      result = fn(this.state, args, t);
    } catch (e) {
      console.error(`[game] act(${fn.name || 'anonymous'}) failed`, e);
      result = undefined;
    }
    this._drain();
    this._requestSave();
    this.emit('change', this.state, { result, fn: fn.name || '' });
    return result;
  }

  /** Emit every pending domain event (state._events) in order. */
  _drain(meta) {
    const s = this.state;
    if (!Array.isArray(s._events)) { s._events = []; return; }
    let guard = 0;
    while (s._events.length && guard++ < 50) {
      const batch = s._events.splice(0);
      for (const ev of batch) {
        if (!ev || typeof ev.type !== 'string') continue;
        this.emit(ev.type, ev, meta || {});
      }
    }
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /** Write the save now. Returns true on success. */
  save() {
    if (this._saveTimer) this._clearTimeout(this._saveTimer);
    this._saveTimer = null;
    const t = this.now();
    this._lastSaveAt = t;
    try {
      this.storage.setItem(SAVE_KEY, serialize(this.state, t));
      this._saveFailed = false;
      return true;
    } catch (e) {
      if (!this._saveFailed) {
        console.warn('[game] save failed', e);
        this.emit('saveFailed', { error: String(e && e.message) });
      }
      this._saveFailed = true;
      return false;
    }
  }

  /** Save at most once per `saveMs`: now if the last save is old enough, else soon. */
  _requestSave() {
    if (this._saveTimer) return;
    const wait = this.saveMs - (this.now() - this._lastSaveAt);
    if (wait <= 0) { this.save(); return; }
    this._saveTimer = this._setTimeout(() => { this._saveTimer = null; this.save(); }, wait);
  }

  // -------------------------------------------------------------------------
  // Settings and save helpers (Settings screen)
  // -------------------------------------------------------------------------

  /** setSetting(key, value) -> {ok, value}. Saves and emits 'change'. */
  setSetting(key, value) {
    if (key === 'puzzleTier' && value && typeof value === 'object') {
      return this.act(sim.setPuzzleTier, value);
    }
    return this.act(sim.setSetting, { key, value });
  }

  /** The save as a JSON string ({v, savedAt, state}). */
  exportSave() {
    return serialize(this.state, this.now());
  }

  /**
   * importSave(text) -> {ok:true} | {ok:false, error}. Replaces the game with the
   * save, catches up the time since it was made, saves, emits 'import' + 'change'.
   */
  importSave(text) {
    const t = this.now();
    let next;
    try {
      next = deserialize(typeof text === 'string' ? text : JSON.stringify(text), t);
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
    next._events = [];
    this.state = next;
    this.isNew = false;
    this._fixClock(t);
    const s = this.state;
    if (!Number.isFinite(s.lastSeenAt)) s.lastSeenAt = fin(s.lastTick, t);
    let summary = null;
    try {
      summary = sim.catchUp(s, t);
      if (!summary) sim.tick(s, t);
    } catch (e) {
      console.error('[game] catch-up after import failed', e);
    }
    this.emit('import', s);
    if (summary) this.emit('return', summary);
    this._drain({ catchUp: true });
    this.save();
    this.emit('change', s, { import: true });
    return { ok: true, summary };
  }

  /**
   * Erase the save (and the per-viewer `tincture.ui.*` notes that belong to it,
   * like the hunters' postcard log) and start over. Reloads the page when a
   * `reload` option was given.
   */
  reset() {
    const t = this.now();
    try { this.storage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    try { this.storage.removeItem(SAVE_KEY + '.unreadable'); } catch (e) { /* ignore */ }
    try {
      const keys = [];
      for (let i = 0; i < (this.storage.length || 0); i++) {
        const k = typeof this.storage.key === 'function' ? this.storage.key(i) : null;
        if (k && k.startsWith('tincture.ui.')) keys.push(k);
      }
      for (const k of keys) this.storage.removeItem(k);
    } catch (e) { /* ignore */ }
    this.state = createInitialState(t);
    this.isNew = true;
    this.save();
    this.emit('reset', this.state);
    this.emit('change', this.state, { reset: true });
    if (this._reload) this._reload();
    return true;
  }
}

export default Game;
