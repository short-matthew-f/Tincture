/**
 * audio.js: Tincture's Web Audio synth. No samples, no network.
 *
 * Owns every sound in the game. Implements DESIGN.md "Interaction feel >
 * Sound" (every color has a note; pentatonic everywhere so overlapping sounds
 * always harmonize; UI ticks quiet, payoffs louder, ambience lowest;
 * celebrations briefly duck other sounds) and ARCHITECTURE.md "UI > audio.js".
 * Sound shapes are ported from the approved prototypes: tink/tick
 * (Grading.dc.html), glug/cork/echo (Purify.dc.html), thunk/knock/clink/coins
 * (Ledger.dc.html), the pack-clean arpeggio (Packing.dc.html).
 *
 * Lifecycle:
 *  - One AudioContext, created lazily and only after a user gesture. This
 *    module listens (capture phase) for the first pointerdown / touchend /
 *    click / keydown and calls `unlock()`. Calls before that are silent no-ops.
 *  - Master gain 0.5. `duck(ms)` eases it to 0.35 and back. Celebrations
 *    (motif, arpeggio, chord, evening) go through a separate "hero" gain that
 *    is not ducked, so they duck everything else without dimming themselves.
 *  - `setEnabled(false)` mutes everything (settings.sound). The context is
 *    suspended on `visibilitychange` hidden and resumed on visible.
 *  - At most 12 voices may overlap at any instant; extra voices are dropped.
 *
 * Time units: delays passed to note/tink are in SECONDS (Web Audio's unit).
 * `duck(ms)` takes milliseconds.
 */

import { noteHz } from '../color.js';

const MASTER_LEVEL = 0.5;
const DUCKED_LEVEL = 0.35;
const MAX_VOICES = 12;
const WET_LEVEL = 0.35;

// G major pentatonic ladder: step 0 = G4 (392 Hz). Used by clink, coins, motif.
const G_PENT = [0, 2, 4, 7, 9];
const gPent = (i) => 392 * Math.pow(2, (G_PENT[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5)) / 12);
// Major scale semitone offsets for chain().
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const majorSemis = (i) => MAJOR[((i % 7) + 7) % 7] + 12 * Math.floor(i / 7);

let ac = null;          // AudioContext
let master = null;      // GainNode, ducked by duck()
let hero = null;        // GainNode, celebrations (not ducked)
let wet = null;         // GainNode input of the short echo
let noiseBuf = null;
let enabled = true;
let unlockedFlag = false;
let voices = [];        // [{ s, e }] scheduled voice windows (seconds, ctx time)
let duckTimer = 0;

const hasWindow = typeof window !== 'undefined';
const AC = hasWindow ? window.AudioContext || window.webkitAudioContext : null;

// ---------------------------------------------------------------------------
// Context management
// ---------------------------------------------------------------------------

function ensureContext() {
  if (ac || !AC) return ac;
  try {
    ac = new AC();
  } catch (e) {
    ac = null;
    return null;
  }
  master = ac.createGain();
  master.gain.value = enabled ? MASTER_LEVEL : 0;
  master.connect(ac.destination);
  hero = ac.createGain();
  hero.gain.value = enabled ? MASTER_LEVEL : 0;
  hero.connect(ac.destination);
  // Light room echo (ported from Purify.dc.html): short delay, filtered feedback.
  const input = ac.createGain();
  const dl = ac.createDelay(1);
  dl.delayTime.value = 0.085;
  const fb = ac.createGain();
  fb.gain.value = 0.32;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  const out = ac.createGain();
  out.gain.value = WET_LEVEL;
  input.connect(dl);
  dl.connect(lp);
  lp.connect(fb);
  fb.connect(dl);
  lp.connect(out);
  out.connect(master);
  wet = input;
  return ac;
}

/** The context if sound is allowed right now, else null. */
function ctx() {
  if (!enabled || !unlockedFlag || !ac) return null;
  if (ac.state === 'suspended' && !document.hidden) ac.resume().catch(() => {});
  return ac;
}

/** Reserve a voice window; false when 12 voices already overlap its start. */
function reserve(t, len) {
  const now = ac.currentTime;
  voices = voices.filter((v) => v.e > now);
  let n = 0;
  for (const v of voices) if (v.s <= t && v.e > t) n++;
  if (n >= MAX_VOICES) return false;
  voices.push({ s: t, e: t + len });
  return true;
}

function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(ac.sampleRate * 1.5);
  noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = 0.985 * last + 0.015 * (Math.random() * 2 - 1); // brown-ish, as in Purify.dc.html
    d[i] = last * 8;
  }
  return noiseBuf;
}

function noiseSource(t, len) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  src.start(t, Math.random() * 0.5);
  src.stop(t + len);
  return src;
}

/** Percussive/soft tone: exponential attack to `vol`, exponential decay over `len`. */
function tone(hz, delay, vol, len, type = 'sine', { attack = 0.01, dest = null, send = 0, bend = null } = {}) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + (delay || 0);
  if (!reserve(t, len + 0.05)) return;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(dest || master);
  if (send) {
    const s = c.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(wet);
  }
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(bend ? bend[0] : hz, t);
  if (bend) o.frequency.exponentialRampToValueAtTime(bend[1], t + bend[2]);
  o.connect(g);
  o.start(t);
  o.stop(t + len + 0.05);
}

/** Glassy tink: a sine plus a quiet inharmonic overtone (2.76x). Ported from Grading.dc.html. */
function tinkAt(hz, delay, vol, len = 0.9, dest = null) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + (delay || 0);
  if (!reserve(t, len + 0.1)) return;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(dest || master);
  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = hz;
  o1.connect(g);
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  g2.connect(g);
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = hz * 2.76;
  o2.connect(g2);
  o1.start(t);
  o2.start(t);
  o1.stop(t + len + 0.1);
  o2.stop(t + len + 0.1);
}

const toHz = (v) => (v > 0 && v <= 1.5 ? noteHz(v) : v);

// ---------------------------------------------------------------------------
// The public API
// ---------------------------------------------------------------------------

export const audio = {
  /** Create/resume the AudioContext. Safe to call repeatedly; call from a gesture. */
  unlock() {
    if (!AC) return false;
    unlockedFlag = true;
    ensureContext();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return !!ac;
  },

  /** settings.sound. Muting is immediate, including already-scheduled sounds. */
  setEnabled(on) {
    enabled = !!on;
    if (ac) {
      const t = ac.currentTime;
      const lvl = enabled ? MASTER_LEVEL : 0;
      for (const g of [master, hero]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(lvl, t, 0.02);
      }
      if (!enabled && ac.state === 'running') {
        // Let the mute ramp finish, then spare the CPU.
        setTimeout(() => { if (!enabled && ac) ac.suspend().catch(() => {}); }, 120);
      }
    }
    if (enabled && ac && unlockedFlag && !document.hidden) ac.resume().catch(() => {});
  },
  isEnabled: () => enabled,
  isUnlocked: () => unlockedFlag && !!ac,

  /** Lower everything but celebrations to 0.35 for `ms`, then ease back to 0.5. */
  duck(ms = 1200) {
    if (!ac || !enabled) return;
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(DUCKED_LEVEL, t, 0.03);
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => {
      if (!ac) return;
      const n = ac.currentTime;
      master.gain.cancelScheduledValues(n);
      master.gain.setTargetAtTime(enabled ? MASTER_LEVEL : 0, n, 0.15);
    }, Math.max(0, ms));
  },

  /**
   * Soft paper tick for every button (quiet, 0.07). `kind` picks a variant from
   * the prototypes: 'select' (default), 'deselect', 'blocked', 'miss'.
   */
  tick(kind = 'select') {
    const v = {
      select: [1600, 0.05, 0.07],
      deselect: [1200, 0.04, 0.05],
      blocked: [500, 0.06, 0.05],
      miss: [320, 0.09, 0.06],
    }[kind] || [1600, 0.05, 0.07];
    tone(v[0], 0, v[2], v[1], 'triangle', { attack: 0.002 });
  },

  /** Glass tink at a color's own note. Accepts Hz, or an OKLab lightness 0..1. */
  tink(hzOrL, delay = 0, vol = 0.3) {
    tinkAt(toHz(hzOrL), delay, vol);
  },

  /** Soft sine note at a color's lightness (pentatonic via noteHz). `delay` in seconds. */
  note(L, delay = 0, vol = 0.2, len = 0.7) {
    tone(noteHz(L), delay, vol, len, 'sine', { attack: 0.02, send: 0.3 });
  },

  /** A gradient as a melody: every lightness once, dark to light, 110 ms apart. */
  arpeggio(Ls) {
    if (!ctx() || !Ls || !Ls.length) return;
    const seen = new Set();
    const hzs = [];
    for (const L of [...Ls].sort((a, b) => a - b)) {
      const hz = Math.round(noteHz(L));
      if (!seen.has(hz)) { seen.add(hz); hzs.push(hz); }
    }
    this.duck(hzs.length * 110 + 900);
    hzs.forEach((hz, k) => tinkAt(hz, k * 0.11, 0.3, 0.7, hero));
  },

  /**
   * Chord of color notes, strummed 25 ms apart. `bright` (true, or 0..1) adds a
   * shimmer octave: Perfect orders play bright, Close orders plain.
   */
  chord(Ls, bright = 0) {
    if (!ctx() || !Ls || !Ls.length) return;
    const b = bright === true ? 1 : Math.max(0, Math.min(1, Number(bright) || 0));
    const hzs = [...new Set(Ls.map((L) => Math.round(noteHz(L))))].slice(0, 5);
    this.duck(1100);
    hzs.forEach((hz, k) => tone(hz, k * 0.025, 0.16, 1.1, 'sine', { attack: 0.015, dest: hero, send: 0.25 }));
    if (b > 0) {
      const top = Math.max(...hzs) * 2;
      tinkAt(top, 0.07, 0.1 + 0.1 * b, 0.9, hero);
      if (b > 0.6) tinkAt(top * 1.5, 0.14, 0.07 * b, 0.8, hero);
    }
  },

  /**
   * Merge clink (Ledger.dc.html's 988 + 1318 Hz pair) moved one pentatonic
   * step higher per container tier (1 vial .. 5 cask).
   */
  clink(tier = 1) {
    const t = Math.max(1, Math.min(5, Math.round(Number(tier) || 1)));
    const base = 7 + (t - 1); // B5 on the G pentatonic ladder, then up a step per tier
    tone(gPent(base), 0, 0.2, 0.5, 'sine', { send: 0.2 });
    tone(gPent(base + 2), 0.06, 0.14, 0.5, 'sine', { send: 0.2 });
    if (t === 5) tone(gPent(base - 5), 0, 0.12, 0.7, 'sine'); // a low octave warms the Cask
  },

  /** Chain-merge step 0,1,2...: climbs the major scale from G3 (196 Hz). */
  chain(step = 0) {
    const s = Math.max(0, Math.floor(Number(step) || 0));
    tinkAt(196 * Math.pow(2, majorSemis(s) / 12), 0, 0.22, 0.6);
  },

  /**
   * Pour glugs (Purify.dc.html): layered soft glugs climbing a pentatonic
   * ladder as the tube fills, over a quiet stream and the room echo.
   * @param {number} fillRatio  fill AFTER the pour, 0..1
   * @param {{fromRatio?:number, layers?:number, hz?:number}} [o]
   *   fromRatio: fill before (default fillRatio - 0.25). layers: how many layers
   *   poured (default 1; longer pour). hz: base pitch (default G4 392; pass lower
   *   for bigger regions). Returns the pour length in seconds.
   */
  glug(fillRatio = 0.5, { fromRatio, layers = 1, hz = 392 } = {}) {
    const c = ctx();
    if (!c) return 0;
    const to = Math.max(0, Math.min(1, Number(fillRatio) || 0));
    const from = Math.max(0, Math.min(to, fromRatio === undefined ? to - 0.25 : fromRatio));
    const len = 0.32 + Math.max(1, layers) * 0.2;
    const t = c.currentTime + 0.03;
    const ladder = [-12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12].map((st) => hz * Math.pow(2, st / 12));
    if (reserve(t, len + 0.15)) {
      const src = noiseSource(t, len + 0.1);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
      src.connect(lp);
      lp.connect(g);
      g.connect(master);
    }
    const step = 0.068;
    const count = Math.max(4, Math.round(len / step));
    for (let k = 0; k < count; k++) {
      const frac = from + (to - from) * (k / count);
      const idx = Math.min(ladder.length - 1, Math.round(frac * (ladder.length - 1)));
      const f = ladder[idx];
      const bt = t + k * step + (Math.random() - 0.5) * 0.012;
      if (!reserve(bt, 0.12)) continue;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.exponentialRampToValueAtTime(0.1, bt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.09);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 0.82, bt);
      o.frequency.exponentialRampToValueAtTime(f * 1.06, bt + 0.05);
      o.connect(lp);
      lp.connect(g);
      g.connect(master);
      g.connect(wet);
      o.start(bt);
      o.stop(bt + 0.1);
    }
    return len;
  },

  /** Cork pop for a finished tube (Purify.dc.html's pop, 0.3). */
  cork(delay = 0) {
    tone(900, delay, 0.3, 0.09, 'triangle', { attack: 0.004, bend: [900, 300, 0.08] });
  },

  /**
   * Wooden thunk: low sine drop (Ledger.dc.html, 150 to 55 Hz) plus a short low
   * filtered noise burst. `scale` multiplies loudness, `delay` is in seconds.
   */
  thunk(scale = 1, delay = 0) {
    const c = ctx();
    if (!c) return;
    const t = c.currentTime + 0.01 + (delay || 0);
    const s = Math.max(0.1, Math.min(1.5, scale));
    tone(150, delay + 0.01, 0.5 * s, 0.22, 'sine', { attack: 0.005, bend: [150, 55, 0.18] });
    if (!reserve(t, 0.12)) return;
    const src = noiseSource(t, 0.1);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * s, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
  },

  /** Ink stamp: a dry paper pat, then a dull rubber thump a hair lower than thunk. */
  stamp(delay = 0) {
    const c = ctx();
    if (!c) return;
    const t = c.currentTime + 0.01 + (delay || 0);
    if (reserve(t, 0.1)) {
      const src = noiseSource(t, 0.06);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
    }
    tone(120, delay + 0.025, 0.42, 0.2, 'sine', { attack: 0.004, bend: [120, 58, 0.15] });
  },

  /** Two soft knocks on the map window (Ledger.dc.html: 180 Hz, 140 ms apart). */
  knock() {
    tone(180, 0, 0.3, 0.12, 'sine', { attack: 0.006 });
    tone(430, 0, 0.05, 0.05, 'triangle', { attack: 0.002 });
    tone(180, 0.14, 0.3, 0.12, 'sine', { attack: 0.006 });
    tone(430, 0.14, 0.05, 0.05, 'triangle', { attack: 0.002 });
  },

  /** Small bell for Essence earned (D6, long soft tail). */
  bell() {
    tinkAt(1175, 0, 0.22, 1.3);
    tinkAt(1568, 0.09, 0.1, 1.0);
  },

  /** The four-note Tincture motif: G4 B4 D5 G5, soft sine attack, 140 ms apart. */
  motif() {
    if (!ctx()) return;
    this.duck(1500);
    [392, 493.88, 587.33, 783.99].forEach((hz, k) =>
      tone(hz, k * 0.14, 0.25, 0.9, 'sine', { attack: 0.03, dest: hero, send: 0.3 }));
  },

  /** Coin patter: n quick tinks climbing the pentatonic ladder, accelerating. */
  coins(n = 6) {
    const count = Math.max(1, Math.min(10, Math.round(Number(n) || 1)));
    let t = 0;
    let gap = 0.075;
    for (let k = 0; k < count; k++) {
      tone(gPent(7 + k), t, 0.07 + 0.01 * Math.min(k, 4), 0.12, 'triangle', { attack: 0.003 });
      t += gap;
      gap = Math.max(0.03, gap * 0.86);
    }
  },

  /** Close up shop: low bell plus a quiet pad, about 1.5 s (ambience stays low). */
  evening() {
    if (!ctx()) return;
    this.duck(1800);
    tinkAt(196, 0, 0.22, 2.0, hero);
    tinkAt(98, 0, 0.12, 2.0, hero);
    [196, 293.66, 392].forEach((hz) =>
      tone(hz, 0.05, 0.035, 1.5, 'sine', { attack: 0.5, dest: hero, send: 0.4 }));
  },
};

export default audio;

// ---------------------------------------------------------------------------
// Auto-unlock + visibility handling
// ---------------------------------------------------------------------------

if (hasWindow) {
  const gestures = ['pointerdown', 'touchend', 'click', 'keydown'];
  // Kept for the page's lifetime: unlock() is cheap, and a context suspended by
  // the OS (iOS call, lock screen) needs a fresh gesture to resume.
  const onGesture = () => { audio.unlock(); };
  for (const g of gestures) window.addEventListener(g, onGesture, { capture: true, passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {});
    else if (enabled && unlockedFlag) ac.resume().catch(() => {});
  });
}
