/**
 * fx.js: motion effects (DOM + SVG only, Web Animations API and rAF).
 *
 * Owns: rollNumber, press, squash, pourFill, ringBurst, confetti,
 * shimmerSweep, flyTo, pulse, dim, fade, and the v0.2 motion vocabulary
 * (docs/V02-CONTRACTS.md "fx.js motion vocabulary"): spring, lift, settle,
 * coinArc, stamp, pour and drag. Implements DESIGN.md "Interaction feel >
 * Interaction spec" and "Motion rules": arrivals ease out, moves ease in and
 * out, overshoot never above 5% (except squash's specified 104%), nothing
 * longer than 1.5 s. Every effect checks `isReducedMotion()` and swaps its
 * movement for a 120 ms fade (particle bursts are skipped, per the
 * accessibility section: "disables screen shake and particle bursts").
 * Haptics go through haptics.js, which keeps its 80 ms throttle.
 *
 * Floating bits live in `#fx-layer` (fixed, pointer-events none, from
 * index.html). All effects return a Promise that resolves when they finish,
 * and never throw if an element is missing.
 *
 * Pure helpers (no DOM; unit-tested in test/fx.test.js): SPRINGS,
 * springCurve, springAt, lerpKeyframe, nearestCell, applyHysteresis,
 * cellsWithin, pickTarget, cellRect, boardFromRects, tiltFromVelocity.
 */

import { haptics } from './haptics.js';
import { audio } from './audio.js';

const FADE_MS = 120;
const SVGNS = 'http://www.w3.org/2000/svg';

const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when motion should be replaced by fades (player setting or OS setting). */
export function isReducedMotion() {
  if (typeof document === 'undefined') return false;
  const mode = document.documentElement.getAttribute('data-motion') || 'system';
  if (mode === 'reduced') return true;
  if (mode === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function layer() {
  let l = document.getElementById('fx-layer');
  if (!l) {
    l = document.createElement('div');
    l.id = 'fx-layer';
    document.body.appendChild(l);
  }
  return l;
}

function animate(node, keyframes, options) {
  if (!node || typeof node.animate !== 'function') return Promise.resolve();
  try {
    const a = node.animate(keyframes, options);
    return a.finished.then(() => a, () => a);
  } catch (e) {
    return Promise.resolve();
  }
}

/** A 120 ms opacity pulse, the reduced-motion stand-in for most effects. */
export function fade(node, from = 0.55) {
  return animate(node, [{ opacity: from }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
}

function centerOf(elm) {
  const r = elm && elm.getBoundingClientRect ? elm.getBoundingClientRect() : null;
  if (!r) return { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const rolls = new WeakMap();

/**
 * Rolling number: ticks from `from` to `to`, easing out so it slows just
 * before it stops (a tiny moment of anticipation). Starting a new roll on the
 * same element cancels the old one. Reduced motion jumps straight to `to`.
 * @param {HTMLElement} elm
 * @param {{ms?:number, format?:(v:number)=>string}} [o]
 */
export function rollNumber(elm, from, to, { ms = 500, format = (v) => Math.round(v).toLocaleString() } = {}) {
  if (!elm) return Promise.resolve();
  const prev = rolls.get(elm);
  if (prev) prev.cancel();
  elm.classList.add('num');
  const a = Number.isFinite(from) ? from : 0;
  const b = Number.isFinite(to) ? to : 0;
  if (a === b || isReducedMotion() || ms <= 0 || typeof requestAnimationFrame !== 'function') {
    elm.textContent = format(b);
    if (a !== b && isReducedMotion()) fade(elm);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    let raf = 0;
    const job = {
      cancel() { cancelAnimationFrame(raf); rolls.delete(elm); resolve(); },
    };
    rolls.set(elm, job);
    const step = (now) => {
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      elm.textContent = format(a + (b - a) * easeOutQuart(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else { rolls.delete(elm); elm.textContent = format(b); resolve(); }
    };
    raf = requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Button + station feel
// ---------------------------------------------------------------------------

/** Press-down feel for elements that are not :active-styled: `.pressed` for 120 ms. */
export function press(elm) {
  if (!elm) return Promise.resolve();
  elm.classList.add('pressed');
  return wait(FADE_MS).then(() => elm.classList.remove('pressed'));
}

/** Buy-an-upgrade squash: 94% -> 104% -> 100% in 250 ms (overshoot allowed by the spec). */
export function squash(elm) {
  if (!elm) return Promise.resolve();
  if (isReducedMotion()) return fade(elm);
  return animate(
    elm,
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.94)', offset: 0.3 },
      { transform: 'scale(1.04)', offset: 0.65 },
      { transform: 'scale(1)' },
    ],
    { duration: 250, easing: 'ease-out' },
  );
}

/** Breathing 2% pulse for merge hints. Pass false to stop. */
export function pulse(elm, on = true) {
  if (!elm) return;
  elm.classList.toggle('pulse', !!on);
}

// ---------------------------------------------------------------------------
// Pour
// ---------------------------------------------------------------------------

/**
 * Flood `hex` outward from a point inside an SVG (the vat, a canvas pane).
 * A circle clipped by the SVG's first <clipPath> grows from the point until it
 * covers the shape. Call it AFTER rendering the new state: the overlay floods
 * over the old color, then removes itself, leaving the final render beneath.
 * `{x, y}` are SVG user units (default: bottom center); `{clientX, clientY}`
 * are converted from a pointer event. Reduced motion fades the color in.
 * @returns {Promise<void>} resolves when the flood is done (300 to 450 ms)
 */
export function pourFill(svgEl, hex, { x, y, clientX, clientY, ms = 380, keep = false } = {}) {
  if (!svgEl || !svgEl.viewBox) return Promise.resolve();
  const vb = svgEl.viewBox.baseVal;
  const vbw = vb && vb.width ? vb.width : svgEl.clientWidth || 100;
  const vbh = vb && vb.height ? vb.height : svgEl.clientHeight || 100;
  const vbx = vb ? vb.x : 0;
  const vby = vb ? vb.y : 0;
  let cx = x, cy = y;
  if (clientX !== undefined && clientY !== undefined && svgEl.getScreenCTM) {
    const m = svgEl.getScreenCTM();
    if (m) {
      const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
      cx = p.x; cy = p.y;
    }
  }
  if (!Number.isFinite(cx)) cx = vbx + vbw / 2;
  if (!Number.isFinite(cy)) cy = vby + vbh * 0.85;

  const g = document.createElementNS(SVGNS, 'g');
  const clip = svgEl.querySelector('clipPath');
  if (clip && clip.id) g.setAttribute('clip-path', `url(#${clip.id})`);
  const c = document.createElementNS(SVGNS, 'circle');
  c.setAttribute('cx', cx);
  c.setAttribute('cy', cy);
  c.setAttribute('fill', hex);
  g.appendChild(c);
  // Sit above the paint, below the highlight and outline strokes.
  const layerEl = svgEl.querySelector('[data-fill-layer]');
  if (layerEl && layerEl.parentNode) layerEl.parentNode.insertBefore(g, layerEl.nextSibling);
  else svgEl.appendChild(g);

  const done = () => { if (!keep) g.remove(); };
  if (isReducedMotion()) {
    c.setAttribute('r', Math.hypot(vbw, vbh));
    return animate(g, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' }).then(done);
  }
  const maxR = Math.max(
    Math.hypot(cx - vbx, cy - vby), Math.hypot(cx - vbx - vbw, cy - vby),
    Math.hypot(cx - vbx, cy - vby - vbh), Math.hypot(cx - vbx - vbw, cy - vby - vbh),
  ) + 2;
  c.setAttribute('r', 0);
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      // rAF's timestamp can precede performance.now() on the first frame: clamp at 0.
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      c.setAttribute('r', (maxR * easeOutQuart(t)).toFixed(2));
      if (t < 1) requestAnimationFrame(step);
      else { done(); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Bursts
// ---------------------------------------------------------------------------

/** Expanding ring from an element (merge pop, Essence). Skipped when reduced (element fades). */
export function ringBurst(originEl, hex = '#E2B04A', { size = 70, ms = 320 } = {}) {
  if (isReducedMotion()) return originEl ? fade(originEl) : Promise.resolve();
  const o = centerOf(originEl);
  const ring = document.createElement('div');
  ring.className = 'fx-ring';
  ring.style.cssText = `color:${hex};width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;`;
  layer().appendChild(ring);
  return animate(
    ring,
    [
      { transform: `translate(${o.x}px,${o.y}px) scale(0.3)`, opacity: 0.9 },
      { transform: `translate(${o.x}px,${o.y}px) scale(1.4)`, opacity: 0 },
    ],
    { duration: ms, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' },
  ).then(() => ring.remove());
}

/**
 * Color-flake confetti from `originEl` (or screen center). Max 24 flakes, 900 ms.
 * Reduced motion skips the burst and fades the origin element instead.
 */
export function confetti(hexes, originEl, { count = 24 } = {}) {
  if (isReducedMotion()) return originEl ? fade(originEl) : Promise.resolve();
  const colors = Array.isArray(hexes) && hexes.length ? hexes : ['#B8433A', '#D39B2A', '#3E6A9E'];
  const n = Math.max(1, Math.min(24, count));
  const o = centerOf(originEl);
  const l = layer();
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const f = document.createElement('div');
    f.className = 'fx-flake';
    f.style.background = colors[i % colors.length];
    l.appendChild(f);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const dist = 70 + Math.random() * 110;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const rot = (Math.random() - 0.5) * 540;
    const x0 = o.x + (Math.random() - 0.5) * Math.min(60, o.w || 0);
    const y0 = o.y;
    jobs.push(
      animate(
        f,
        [
          { transform: `translate(${x0}px,${y0}px) rotate(0deg)`, opacity: 1, offset: 0 },
          { transform: `translate(${x0 + dx}px,${y0 + dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45, easing: 'cubic-bezier(0.1, 0.7, 0.4, 1)' },
          { transform: `translate(${x0 + dx * 1.2}px,${y0 + dy + 150}px) rotate(${rot}deg)`, opacity: 0, offset: 1, easing: 'ease-in' },
        ],
        { duration: 800 + Math.random() * 100, delay: Math.random() * 40, fill: 'both' },
      ).then(() => f.remove()),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Diagonal highlight sweep across an element (board solved, Gold vial). 900 ms default. */
export function shimmerSweep(elm, { ms = 900 } = {}) {
  if (!elm) return Promise.resolve();
  const wrap = document.createElement('div');
  wrap.className = 'fx-shimmer';
  const bar = document.createElement('i');
  wrap.appendChild(bar);
  if (getComputedStyle(elm).position === 'static') elm.style.position = 'relative';
  elm.appendChild(wrap);
  const clean = () => wrap.remove();
  if (isReducedMotion()) {
    bar.style.cssText = 'left:0;width:100%;transform:none;background:rgba(255,255,255,0.45)';
    return animate(wrap, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out' }).then(clean);
  }
  return animate(
    bar,
    [{ transform: 'translateX(-120%) skewX(-12deg)' }, { transform: 'translateX(300%) skewX(-12deg)' }],
    { duration: ms, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
  ).then(clean);
}

/**
 * Small dots arc from `fromEl` to `toEl` (coins to the counter, a star to its
 * swatch). They pause ~100 ms first (anticipation), then fly 450 to 600 ms.
 * Resolves when the last dot lands, so roll the counter then. `onArrive(i)`
 * fires as each dot lands. Reduced motion: one dot fades in at the target.
 */
export function flyTo(fromEl, toEl, hex = '#C99A2E', { count = 6, ms = 560, onArrive } = {}) {
  const n = Math.max(1, Math.min(12, count));
  const a = centerOf(fromEl);
  const b = centerOf(toEl);
  const l = layer();
  if (isReducedMotion()) {
    const d = document.createElement('div');
    d.className = 'fx-dot';
    d.style.background = hex;
    d.style.transform = `translate(${b.x}px,${b.y}px)`;
    l.appendChild(d);
    return animate(d, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: FADE_MS * 2 })
      .then(() => { d.remove(); if (onArrive) onArrive(0); });
  }
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'fx-dot';
    d.style.background = hex;
    l.appendChild(d);
    const sx = a.x + (Math.random() - 0.5) * Math.min(48, a.w || 0);
    const sy = a.y + (Math.random() - 0.5) * Math.min(24, a.h || 0);
    const mx = (sx + b.x) / 2 + (Math.random() - 0.5) * 60;
    const my = Math.min(sy, b.y) - 50 - Math.random() * 50;
    jobs.push(
      animate(
        d,
        [
          { transform: `translate(${sx}px,${sy}px) scale(0.8)`, opacity: 0, offset: 0 },
          { transform: `translate(${sx}px,${sy}px) scale(1)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${mx}px,${my}px) scale(1.1)`, opacity: 1, offset: 0.55, easing: 'ease-in' },
          { transform: `translate(${b.x}px,${b.y}px) scale(0.7)`, opacity: 1, offset: 1 },
        ],
        { duration: ms, delay: 100 + i * 40, easing: 'ease-out', fill: 'both' },
      ).then(() => { d.remove(); if (onArrive) onArrive(i); }),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

let dimEl = null;
/** Dim the screen by 20% for the discovery moment; `dim(false)` brings it back. */
export function dim(on = true) {
  const l = layer();
  if (on) {
    if (!dimEl) {
      dimEl = document.createElement('div');
      dimEl.className = 'fx-dim';
      l.appendChild(dimEl);
      void dimEl.offsetWidth; // commit the starting opacity so the fade runs
    }
    dimEl.classList.add('on');
  } else if (dimEl) {
    const d = dimEl;
    dimEl = null;
    d.classList.remove('on');
    setTimeout(() => d.remove(), 300);
  }
}

// ---------------------------------------------------------------------------
// Springs (pure maths + WAAPI)
// ---------------------------------------------------------------------------

/**
 * Damped spring presets (mass 1). Tuned so the curve is within 0.5% of its
 * target by `duration` and never overshoots more than 5% (DESIGN "Motion
 * rules"): soft ~2% and settles in 350 ms, firm ~3% in 280 ms, heavy a
 * visible ~4.5% in 420 ms.
 */
export const SPRINGS = Object.freeze({
  soft: Object.freeze({ stiffness: 477, damping: 34.1, duration: 350 }),
  firm: Object.freeze({ stiffness: 721, damping: 39.7, duration: 280 }),
  heavy: Object.freeze({ stiffness: 303, damping: 24.4, duration: 420 }),
});

const springCfg = (preset) => (typeof preset === 'object' && preset ? { ...SPRINGS.firm, ...preset } : SPRINGS[preset] || SPRINGS.firm);

/**
 * springAt(tMs, preset) -> progress (0 at rest, 1 at the target), the
 * closed-form solution of x'' = -k(x - 1) - c x' from x = 0, v = 0.
 */
export function springAt(tMs, preset = 'firm') {
  const { stiffness: k, damping: c } = springCfg(preset);
  const t = Math.max(0, tMs) / 1000;
  const w0 = Math.sqrt(k);
  const zeta = c / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/**
 * springCurve(preset, {samples=40}) -> {duration, values}: `samples + 1`
 * progress values at even steps from 0 to the preset's duration. The raw last
 * value is within 0.5% of 1; spring() pins the final keyframe to the target.
 */
export function springCurve(preset = 'firm', { samples = 40 } = {}) {
  const cfg = springCfg(preset);
  const n = Math.max(2, Math.round(samples));
  const values = [];
  for (let i = 0; i <= n; i++) values.push(springAt((cfg.duration * i) / n, cfg));
  return { duration: cfg.duration, values };
}

const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/**
 * lerpKeyframe(from, to, p) -> keyframe. Numbers interpolate; strings whose
 * shape matches ("translate(4px, 0) scale(1.06)") interpolate every number in
 * them; anything else switches to `to` once p reaches 1.
 */
export function lerpKeyframe(from = {}, to = {}, p = 1) {
  const out = {};
  const keys = new Set([...Object.keys(from || {}), ...Object.keys(to || {})]);
  for (const k of keys) {
    if (k === 'offset' || k === 'easing') continue;
    const a = from[k];
    const b = to[k];
    if (b === undefined) { out[k] = a; continue; }
    if (a === undefined) { out[k] = b; continue; }
    if (typeof a === 'number' && typeof b === 'number') { out[k] = a + (b - a) * p; continue; }
    const sa = String(a);
    const sb = String(b);
    const na = sa.match(NUM_RE) || [];
    const nb = sb.match(NUM_RE) || [];
    const shape = (x) => x.replace(NUM_RE, '#').replace(/\s+/g, ' ').trim();
    if (na.length && na.length === nb.length && shape(sa) === shape(sb)) {
      let i = 0;
      out[k] = sb.replace(NUM_RE, () => {
        const v = Number(na[i]) + (Number(nb[i]) - Number(na[i])) * p;
        i++;
        return String(Math.round(v * 10000) / 10000);
      });
    } else out[k] = p >= 1 ? b : a;
  }
  return out;
}

function shapesMatch(from, to) {
  for (const k of Object.keys(to || {})) {
    const a = from && from[k];
    const b = to[k];
    if (a === undefined || (typeof a === 'number' && typeof b === 'number')) continue;
    const na = String(a).match(NUM_RE) || [];
    const nb = String(b).match(NUM_RE) || [];
    const shape = (x) => String(x).replace(NUM_RE, '#').replace(/\s+/g, ' ').trim();
    if (!na.length || na.length !== nb.length || shape(a) !== shape(b)) return false;
  }
  return true;
}

const springs = new WeakMap(); // el -> the Animation of its running spring

function stopSpring(el) {
  const a = el && springs.get(el);
  if (a) { try { a.cancel(); } catch (e) { /* ignore */ } springs.delete(el); }
}

function track(el, a) {
  if (!a) return Promise.resolve();
  springs.set(el, a);
  return a.finished.then(() => { if (springs.get(el) === a) springs.delete(el); return a; }, () => a);
}

/**
 * spring(el, {from, to, preset='firm', fill='none', delay=0}) -> Promise.
 * WAAPI with a precomputed spring: ~40 keyframes interpolated from `from` to
 * `to` (keyframe objects, e.g. {transform: 'scale(0.94)'}), linear timing
 * between them. A new spring on the same element replaces the running one.
 * Reduced motion: `to` with a 120 ms fade.
 */
export function spring(el, { from = {}, to = {}, preset = 'firm', fill = 'none', delay = 0 } = {}) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  stopSpring(el);
  try {
    if (isReducedMotion()) {
      const op0 = from.opacity !== undefined ? from.opacity : 0.55;
      const op1 = to.opacity !== undefined ? to.opacity : 1;
      return track(el, el.animate([{ ...to, opacity: op0 }, { ...to, opacity: op1 }], { duration: FADE_MS, easing: 'ease-out', fill }));
    }
    const curve = springCurve(preset);
    let frames;
    let easing = 'linear';
    if (shapesMatch(from, to)) {
      const n = curve.values.length - 1;
      frames = curve.values.map((v, i) => ({ ...lerpKeyframe(from, to, i === n ? 1 : v), offset: i / n }));
    } else {
      frames = [{ ...from }, { ...to }];
      easing = linearEasing(curve.values) || 'cubic-bezier(0.3, 1.12, 0.5, 1)';
    }
    return track(el, el.animate(frames, { duration: curve.duration, easing, fill, delay }));
  } catch (e) {
    return Promise.resolve();
  }
}

let linearOk = null;
function linearEasing(values) {
  if (linearOk === null) {
    linearOk = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)');
  }
  if (!linearOk) return null;
  const v = values.slice();
  v[v.length - 1] = 1;
  return `linear(${v.map((x) => (Math.round(x * 10000) / 10000)).join(', ')})`;
}

// ---------------------------------------------------------------------------
// Lift and settle (tiles, vials, any held thing)
// ---------------------------------------------------------------------------

/** Pick-up feel on pointerdown: scale 106% and a grown shadow (`.fx-lifted`). Stays until settle(). */
export function lift(el) {
  if (!el) return Promise.resolve();
  if (el.classList) el.classList.add('fx-lifted');
  if (isReducedMotion()) return Promise.resolve();
  return spring(el, { from: { transform: 'scale(1)' }, to: { transform: 'scale(1.06)' }, preset: 'firm', fill: 'forwards' });
}

/** Put-down feel: from the lifted scale through a 3% overshoot (97%) back to rest, 200 ms. */
export function settle(el) {
  if (!el) return Promise.resolve();
  if (el.classList) el.classList.remove('fx-lifted');
  let cur = 'scale(1.06)';
  try {
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') cur = t;
  } catch (e) { /* ignore */ }
  stopSpring(el);
  if (isReducedMotion() || typeof el.animate !== 'function') return Promise.resolve();
  try {
    return track(el, el.animate([
      { transform: cur },
      { transform: 'scale(0.97)', offset: 0.45, easing: 'ease-in-out' },
      { transform: 'scale(1.008)', offset: 0.75, easing: 'ease-out' },
      { transform: 'scale(1)' },
    ], { duration: 200, easing: 'ease-out' }));
  } catch (e) {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Coin arc
// ---------------------------------------------------------------------------

/**
 * coinArc(fromEl, toEl, n=10, {hex, onArrive(i), quiet}) -> Promise.
 * 8 to 16 coins fan out from `fromEl` together (160 ms, ease out), hang a
 * beat (anticipation), then converge on `toEl` one after another along a
 * curve (300 ms, ease in). Resolves when the last coin lands: roll the
 * counter then. Plays the coin patter and a light ripple when the first coin
 * lands unless `quiet`. Whole effect stays under 700 ms. Reduced motion: one
 * coin fades in at the target.
 */
export function coinArc(fromEl, toEl, n = 10, { hex = '#D9A93A', onArrive, quiet = false } = {}) {
  if (typeof document === 'undefined') return Promise.resolve();
  const count = Math.max(8, Math.min(16, Math.round(Number(n) || 10)));
  const a = centerOf(fromEl);
  const b = centerOf(toEl);
  const l = layer();
  const feel = () => {
    if (quiet) return;
    try { audio.coins(Math.min(8, count)); } catch (e) { /* ignore */ }
    haptics.ripple(3);
  };
  const coin = () => {
    const c = document.createElement('div');
    c.className = 'fx-coin';
    c.style.setProperty('--coin', hex);
    l.appendChild(c);
    return c;
  };
  if (isReducedMotion()) {
    const c = coin();
    c.style.transform = `translate(${b.x}px,${b.y}px)`;
    feel();
    return animate(c, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: FADE_MS * 2 })
      .then(() => { c.remove(); if (onArrive) onArrive(0); });
  }
  const FAN = 160;
  const HOLD = 30;
  const CONV = 300;
  const stagger = Math.min(22, 190 / count);
  let landed = 0;
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const c = coin();
    const k = count > 1 ? i / (count - 1) : 0.5;
    const ang = -Math.PI / 2 + (k - 0.5) * Math.PI * 1.25 + (Math.random() - 0.5) * 0.25;
    const r = 28 + Math.random() * 28;
    const fx0 = a.x + Math.cos(ang) * r;
    const fy0 = a.y + Math.sin(ang) * r * 0.8;
    const mx = (fx0 + b.x) / 2 + (Math.random() - 0.5) * 50;
    const my = Math.min(fy0, b.y) - 30 - Math.random() * 40;
    const hold = HOLD + i * stagger;
    const total = FAN + hold + CONV;
    const o1 = FAN / total;
    const o2 = (FAN + hold) / total;
    jobs.push(
      animate(c, [
        { transform: `translate(${a.x}px,${a.y}px) scale(0.6)`, opacity: 0, offset: 0, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' },
        { transform: `translate(${fx0}px,${fy0}px) scale(1)`, opacity: 1, offset: o1 },
        { transform: `translate(${fx0}px,${fy0}px) scale(1)`, opacity: 1, offset: o2, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' },
        { transform: `translate(${mx}px,${my}px) scale(1.05)`, opacity: 1, offset: o2 + (1 - o2) * 0.5, easing: 'ease-in' },
        { transform: `translate(${b.x}px,${b.y}px) scale(0.7)`, opacity: 1, offset: 1 },
      ], { duration: total, fill: 'both' }).then(() => {
        c.remove();
        if (landed++ === 0) feel();
        if (onArrive) { try { onArrive(i); } catch (e) { /* ignore */ } }
      }),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Stamp
// ---------------------------------------------------------------------------

/**
 * stamp(el, text, {hold=700, keep=false, hex}) -> Promise<HTMLElement|null>.
 * An ink stamp drops onto the centre of `el`: it comes down from 150%, squashes
 * on contact (wide and low), lands with a thunk and a medium haptic, and the
 * ink spreads a little. Resolves on landing (about 260 ms). It fades away
 * after `hold` ms, or stays inside `el` with `keep: true`. Reduced motion: the
 * stamp fades in (sound and haptic stay).
 */
export function stamp(el, text = '', { hold = 700, keep = false, hex = null } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const s = document.createElement('div');
  s.className = 'fx-stamp';
  s.setAttribute('aria-hidden', 'true');
  if (hex) s.style.setProperty('--stamp-ink', hex);
  const span = document.createElement('span');
  span.textContent = String(text);
  s.appendChild(span);
  let place;
  if (keep && el) {
    try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (e) { /* ignore */ }
    s.classList.add('is-kept');
    el.appendChild(s);
    place = 'translate(-50%,-50%)';
  } else {
    const c = centerOf(el);
    layer().appendChild(s);
    place = `translate(${c.x}px,${c.y}px) translate(-50%,-50%)`;
  }
  const rot = 'rotate(-8deg)';
  const land = () => {
    try { audio.stamp(); } catch (e) { /* ignore */ }
    haptics.medium();
    s.classList.add('is-inked');
  };
  const leave = () => {
    if (keep) return;
    setTimeout(() => {
      animate(s, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).then(() => s.remove());
    }, Math.max(0, hold));
  };
  if (isReducedMotion()) {
    s.style.transform = `${place} ${rot}`;
    land();
    return animate(s, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' }).then(() => { leave(); return s; });
  }
  s.style.transform = `${place} ${rot}`;
  const down = animate(s, [
    { transform: `${place} ${rot} scale(1.5)`, opacity: 0, offset: 0, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
    { transform: `${place} ${rot} scale(1, 1)`, opacity: 1, offset: 0.55, easing: 'ease-out' },
    { transform: `${place} ${rot} scale(1.08, 0.9)`, opacity: 1, offset: 0.72, easing: 'ease-out' },
    { transform: `${place} ${rot} scale(0.98, 1.02)`, opacity: 1, offset: 0.88 },
    { transform: `${place} ${rot} scale(1)`, opacity: 1, offset: 1 },
  ], { duration: 300, fill: 'both' });
  setTimeout(land, 165); // contact: the 55% keyframe
  return down.then(() => { leave(); return s; });
}

// ---------------------------------------------------------------------------
// Pour with a surface wobble
// ---------------------------------------------------------------------------

/**
 * pour(svg, hex, from) -> Promise. pourFill's flood from `from` ({x, y} in SVG
 * units, {clientX, clientY}, or a pointer event), then the new surface wobbles
 * once (skew and a 1.5% squash, 260 ms) the way a poured layer settles.
 * Reduced motion: pourFill's fade, no wobble.
 */
export function pour(svg, hex, from = {}, opts = {}) {
  const f = from || {};
  const pt = { x: f.x, y: f.y, clientX: f.clientX, clientY: f.clientY };
  return pourFill(svg, hex, { ...pt, ...opts }).then(() => {
    if (!svg || isReducedMotion()) return undefined;
    const target = svg.querySelector && (svg.querySelector('[data-fill-layer]') || null);
    const node = target || svg;
    try {
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin = '50% 100%';
    } catch (e) { /* ignore */ }
    return animate(node, [
      { transform: 'none' },
      { transform: 'skewX(1.6deg) scaleY(1.015)', offset: 0.3 },
      { transform: 'skewX(-1deg) scaleY(0.992)', offset: 0.6 },
      { transform: 'skewX(0.4deg) scaleY(1.004)', offset: 0.82 },
      { transform: 'none' },
    ], { duration: 260, easing: 'ease-out' }).then(() => undefined);
  });
}

// ---------------------------------------------------------------------------
// Board-local hit testing (pure)
// ---------------------------------------------------------------------------

/** Defaults for fx.drag (docs/V02-CONTRACTS.md "drag contract"). */
export const DRAG = Object.freeze({
  threshold: 8,     // px before a press becomes a drag
  offsetY: 12,      // the ghost's base sits this far above the finger
  bounds: 12,       // the board's hit area reaches this far past its frame
  hysteresis: 0.25, // the target changes only this far (of a cell) into a neighbour
  magnet: 24,       // a legal partner this close beats an empty cell
  dwell: 90,        // ms resting inside the hysteresis band before the nearer cell wins
  maxTilt: 6,       // degrees
});

function padOf(pad) {
  if (pad && typeof pad === 'object') {
    return { top: +pad.top || 0, right: +pad.right || 0, bottom: +pad.bottom || 0, left: +pad.left || 0 };
  }
  const p = Number(pad) || 0;
  return { top: p, right: p, bottom: p, left: p };
}

function grid(b) {
  const cols = Math.max(1, b.cols | 0);
  const rows = Math.max(1, b.rows | 0);
  const gapX = Number(b.gapX) || 0;
  const gapY = Number(b.gapY) || 0;
  return {
    cols, rows, gapX, gapY,
    cellW: Number(b.cellW) || 0,
    cellH: Number(b.cellH) || 0,
    width: cols * (Number(b.cellW) || 0) + (cols - 1) * gapX,
    height: rows * (Number(b.cellH) || 0) + (rows - 1) * gapY,
  };
}

/**
 * Board geometry: {left, top} is the top-left corner of cell 0 (viewport
 * px), cells are cellW x cellH, gapX/gapY between them (a plank between rows
 * is just a tall gapY), `pad` the board frame around the grid (number or
 * {top, right, bottom, left}), optional `bounds` (default 12) and `count`.
 */
export function cellRect(index, b) {
  const g = grid(b);
  const col = index % g.cols;
  const row = Math.floor(index / g.cols);
  const left = b.left + col * (g.cellW + g.gapX);
  const top = b.top + row * (g.cellH + g.gapY);
  return { left, top, right: left + g.cellW, bottom: top + g.cellH, width: g.cellW, height: g.cellH };
}

/**
 * nearestCell({x, y}, board) -> cell index, or -1 beyond the frame + 12 px.
 * Every point inside resolves: gaps and planks belong to the nearer cell
 * (split at their midline), the frame to the edge cells.
 */
export function nearestCell(pos, b) {
  if (!pos || !b) return -1;
  const g = grid(b);
  if (!(g.cellW > 0 && g.cellH > 0)) return -1;
  const p = padOf(b.pad);
  const ext = Number.isFinite(b.bounds) ? b.bounds : DRAG.bounds;
  const x = pos.x - b.left;
  const y = pos.y - b.top;
  if (!(x >= -p.left - ext && x <= g.width + p.right + ext && y >= -p.top - ext && y <= g.height + p.bottom + ext)) return -1;
  const col = Math.max(0, Math.min(g.cols - 1, Math.floor((x + g.gapX / 2) / (g.cellW + g.gapX))));
  const row = Math.max(0, Math.min(g.rows - 1, Math.floor((y + g.gapY / 2) / (g.cellH + g.gapY))));
  const i = row * g.cols + col;
  if (Number.isFinite(b.count) && i >= b.count) return -1;
  return i;
}

/**
 * applyHysteresis(prev, candidate, pos, board) -> prev or candidate. The
 * target stays on `prev` until the point is 25% of a cell past the midline
 * into a neighbour, so the highlight never flickers on a boundary. Leaving the
 * board (-1) always wins.
 */
export function applyHysteresis(prev, candidate, pos, b) {
  if (!Number.isInteger(prev) || prev < 0 || candidate < 0 || candidate === prev || !pos || !b) return candidate;
  const g = grid(b);
  const h = Number.isFinite(b.hysteresis) ? b.hysteresis : DRAG.hysteresis;
  const r = cellRect(prev, b);
  const mx = g.gapX / 2 + h * g.cellW;
  const my = g.gapY / 2 + h * g.cellH;
  const inside = pos.x >= r.left - mx && pos.x <= r.right + mx && pos.y >= r.top - my && pos.y <= r.bottom + my;
  return inside ? prev : candidate;
}

/** cellsWithin({x, y}, board, px=24) -> [{index, dist}] cells whose box is within px, nearest first. */
export function cellsWithin(pos, b, px = DRAG.magnet) {
  if (!pos || !b) return [];
  const g = grid(b);
  const n = Number.isFinite(b.count) ? Math.min(b.count, g.cols * g.rows) : g.cols * g.rows;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = cellRect(i, b);
    const dx = Math.max(r.left - pos.x, 0, pos.x - r.right);
    const dy = Math.max(r.top - pos.y, 0, pos.y - r.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist <= px) out.push({ index: i, dist });
  }
  return out.sort((p, q) => p.dist - q.dist);
}

/**
 * pickTarget(candidates, magnet, px=24) -> index | -1. `candidates` are
 * [{index, dist}] (dist 0 = under the point). `magnet(index)` scores a cell:
 * > 0 is a legal partner. The best-scoring partner within px wins (ties: the
 * nearer); with none, the nearest candidate (empties and plain moves second).
 */
export function pickTarget(candidates, magnet, px = DRAG.magnet) {
  const list = (candidates || []).filter((c) => c && Number.isInteger(c.index) && c.index >= 0)
    .slice().sort((p, q) => (p.dist || 0) - (q.dist || 0));
  if (!list.length) return -1;
  if (typeof magnet === 'function') {
    let best = null;
    let bestScore = 0;
    for (const c of list) {
      if ((c.dist || 0) > px) continue;
      let score = 0;
      try { score = Number(magnet(c.index)) || 0; } catch (e) { score = 0; }
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best) return best.index;
  }
  return list[0].index;
}

/**
 * boardFromRects(rects, cols, pad=0) -> board geometry from the cells' client
 * rects in reading order (gapY is the row pitch minus the cell height, so a
 * plank between rows counts as gap).
 */
export function boardFromRects(rects, cols, pad = 0) {
  const list = [...(rects || [])];
  if (!list.length) return null;
  const c = Math.max(1, Math.min(cols | 0 || list.length, list.length));
  const r0 = list[0];
  const rows = Math.ceil(list.length / c);
  const cellW = r0.width !== undefined ? r0.width : r0.right - r0.left;
  const cellH = r0.height !== undefined ? r0.height : r0.bottom - r0.top;
  const gapX = c > 1 ? list[1].left - (r0.left + cellW) : 0;
  const gapY = rows > 1 && list[c] ? list[c].top - (r0.top + cellH) : 0;
  return { left: r0.left, top: r0.top, cols: c, rows, cellW, cellH, gapX: Math.max(0, gapX), gapY: Math.max(0, gapY), pad, count: list.length };
}

/** measureGrid(cellEls, cols, {pad}) -> board geometry measured now (DOM). */
export function measureGrid(cells, cols, { pad = 0 } = {}) {
  const rects = [...(cells || [])].map((c) => c.getBoundingClientRect());
  return boardFromRects(rects, cols, pad);
}

/** tiltFromVelocity(vx px/ms) -> degrees, capped at ±6. */
export function tiltFromVelocity(vx, max = DRAG.maxTilt) {
  const t = (Number(vx) || 0) * 9;
  return Math.max(-max, Math.min(max, t));
}

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * drag(el, opts) -> {cancel(), destroy(), active}
 *
 * Drag-and-drop with board-local hit testing (V02-CONTRACTS "drag contract",
 * PLAN-v0.2 Theme B / F):
 *  - pointer capture on `el`; a press becomes a drag after 8 px; lift() on
 *    press for instant acknowledgment, settle() if it stays a tap;
 *  - the ghost (a copy of the source's svg, or `opts.ghost(source)`) is drawn
 *    fully above the finger: its base sits at y - 12 and the drop resolves
 *    there, not under the finger. Position follows every pointermove with no
 *    smoothing; only the tilt (from horizontal velocity, capped at 6 deg) eases;
 *  - the target is the nearest cell of `board` (gaps and planks count, frame
 *    + 12 px), held by 25% hysteresis (a rest of 90 ms inside the band lets
 *    the nearer cell win), then `magnet(cell, from)` lets a legal partner
 *    within 24 px win over empties;
 *  - `pointercancel` (iOS edge swipe) or cancel(): the ghost flies home, the
 *    source is restored, onMove(-1) then onCancel(); onDrop is not called.
 *
 * opts:
 *   board     geometry {left, top, cols, rows, cellW, cellH, gapX, gapY, pad}
 *             or a function returning it (measured when the drag starts)
 *   cellAt    optional (x, y, board) -> index | -1: a custom resolver (a
 *             `board.cellAt(x, y)` method works too); without one, nearestCell
 *   onMove    (cell | -1, info) when the target changes (highlights)
 *   onDrop    (cell | -1, info) on release after a drag
 *   magnet    optional (cell, from) -> score; > 0 marks a legal partner
 *   handle    optional selector: `el` is a container and the drag starts on a
 *             matching descendant (give those `touch-action: none`, e.g. the
 *             `.fx-draggable` class); without it `el` itself is dragged and
 *             gets `touch-action: none` (and nothing else does)
 *   source    optional (sourceEl) -> index (default: Number(data-cell) or -1)
 *   ghost     optional (sourceEl) -> Node to draw while dragging
 *   liftEl    optional (sourceEl) -> the element lift()/settle() act on
 *   canStart  optional (sourceEl, event) -> boolean
 *   onStart(info), onTap(info), onCancel(info)
 *   threshold, offsetY, magnetPx: override the defaults in DRAG
 * info = {from, source, x, y (the ghost's base), clientX, clientY, raw}
 */
export function drag(el, opts = {}) {
  const noop = { cancel() {}, destroy() {}, get active() { return false; } };
  if (!el || typeof el.addEventListener !== 'function') return noop;
  const o = { ...opts };
  const threshold = Number.isFinite(o.threshold) ? o.threshold : DRAG.threshold;
  const offsetY = Number.isFinite(o.offsetY) ? o.offsetY : DRAG.offsetY;
  const magnetPx = Number.isFinite(o.magnetPx) ? o.magnetPx : DRAG.magnet;
  const single = !o.handle;
  const prevTouch = single && el.style ? el.style.touchAction : '';
  if (single && el.style) {
    el.style.touchAction = 'none';
    if (el.classList) el.classList.add('fx-draggable');
  }
  let d = null;
  let destroyed = false;

  const call = (fn, ...args) => { if (typeof fn === 'function') { try { return fn(...args); } catch (e) { console.error('[fx.drag]', e); } } return undefined; };

  function sourceFor(target) {
    if (single) return el;
    const s = target && target.closest ? target.closest(o.handle) : null;
    return s && el.contains(s) ? s : null;
  }
  function indexOf(src) {
    if (typeof o.source === 'function') { const v = call(o.source, src); return Number.isInteger(v) ? v : -1; }
    const v = src && src.dataset ? Number(src.dataset.cell) : NaN;
    return Number.isInteger(v) ? v : -1;
  }
  const info = () => ({
    from: d.from, source: d.src, x: d.x, y: d.y - offsetY, clientX: d.x, clientY: d.y, raw: d.raw,
  });

  function geometry() {
    const b = typeof o.board === 'function' ? call(o.board) : o.board;
    return b && typeof b === 'object' ? b : null;
  }

  function resolve(now) {
    const pos = { x: d.x, y: d.y - offsetY };
    let raw;
    const custom = typeof o.cellAt === 'function' ? o.cellAt
      : d.geo && typeof d.geo.cellAt === 'function' ? (x, y) => d.geo.cellAt(x, y) : null;
    if (custom) {
      const v = call(custom, pos.x, pos.y, d.geo);
      raw = Number.isInteger(v) ? v : -1;
    } else raw = d.geo ? nearestCell(pos, d.geo) : -1;
    d.raw = raw;
    let base = raw;
    if (d.geo && raw >= 0 && d.base >= 0 && raw !== d.base) {
      const held = applyHysteresis(d.base, raw, pos, d.geo);
      if (held !== raw) {
        if (d.pend !== raw) { d.pend = raw; d.pendAt = now; }
        if (now - d.pendAt >= DRAG.dwell) base = raw;
        else {
          base = held;
          clearTimeout(d.dwellTimer);
          d.dwellTimer = setTimeout(() => { if (d && d.moved) resolve(clock()); }, DRAG.dwell - (now - d.pendAt) + 5);
        }
      }
    }
    if (base === raw) d.pend = -1;
    d.base = base;
    let target = base;
    if (base >= 0 && typeof o.magnet === 'function' && d.geo) {
      const near = cellsWithin(pos, d.geo, magnetPx).filter((c) => c.index !== d.from && c.index !== base);
      target = pickTarget([{ index: base, dist: 0 }, ...near], (i) => (i === base && i === d.from ? 0 : o.magnet(i, d.from)), magnetPx);
    }
    if (target !== d.target) {
      d.target = target;
      call(o.onMove, target, info());
    }
    return target;
  }

  function placeGhost() {
    if (!d || !d.ghost) return;
    const s = isReducedMotion() ? 1 : 1.06;
    const tilt = isReducedMotion() ? 0 : d.tilt;
    d.ghost.style.transform = `translate(${d.x - d.gw / 2}px,${d.y - offsetY - d.gh}px) rotate(${tilt.toFixed(2)}deg) scale(${s})`;
  }

  function tiltLoop() {
    if (!d || !d.moved) return;
    const now = clock();
    const idle = now - d.lastMoveAt > 60;
    const want = idle ? 0 : tiltFromVelocity(d.vx);
    d.tilt += (want - d.tilt) * 0.35;
    if (Math.abs(d.tilt) < 0.05) d.tilt = 0;
    placeGhost();
    d.raf = requestAnimationFrame(tiltLoop);
  }

  function begin() {
    d.moved = true;
    d.geo = geometry();
    stopSpring(d.liftEl);
    if (d.liftEl && d.liftEl.classList) d.liftEl.classList.remove('fx-lifted');
    let node = typeof o.ghost === 'function' ? call(o.ghost, d.src) : null;
    if (!node) {
      const art = d.liftEl || d.src;
      node = art.cloneNode(true);
      if (node.classList) node.classList.remove('pulse', 'fx-lifted', 'is-drag-source');
      if (node.style) { node.style.transform = 'none'; node.style.opacity = ''; }
    }
    const g = document.createElement('div');
    g.className = 'fx-ghost';
    g.style.width = `${d.gw}px`;
    g.style.height = `${d.gh}px`;
    g.appendChild(node);
    layer().appendChild(g);
    d.ghost = g;
    if (d.src.classList) d.src.classList.add('is-drag-source');
    placeGhost();
    haptics.light();
    call(o.onStart, info());
    if (typeof requestAnimationFrame === 'function') d.raf = requestAnimationFrame(tiltLoop);
  }

  function cleanup() {
    if (!d) return;
    clearTimeout(d.dwellTimer);
    if (d.raf) cancelAnimationFrame(d.raf);
    try { if (el.hasPointerCapture && el.hasPointerCapture(d.id)) el.releasePointerCapture(d.id); } catch (e) { /* ignore */ }
    d = null;
  }

  /** Send the ghost home to its source, then restore the source. */
  function flyHome(ghost, src) {
    const restore = () => { if (src && src.classList) src.classList.remove('is-drag-source'); };
    if (!ghost) { restore(); return Promise.resolve(); }
    if (isReducedMotion() || !src || !src.getBoundingClientRect) { ghost.remove(); restore(); return Promise.resolve(); }
    const r = (src.querySelector && src.querySelector('svg') || src).getBoundingClientRect();
    const from = ghost.style.transform;
    const to = `translate(${r.left}px,${r.top}px) rotate(0deg) scale(1)`;
    return animate(ghost, [{ transform: from }, { transform: to }], { duration: 160, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'forwards' })
      .then(() => { ghost.remove(); restore(); });
  }

  function suppressClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', stop, true);
    setTimeout(() => window.removeEventListener('click', stop, true), 60);
  }

  function onDown(e) {
    if (destroyed || d) return;
    if ((e.button !== undefined && e.button > 0) || e.isPrimary === false) return;
    const src = sourceFor(e.target);
    if (!src) return;
    if (typeof o.canStart === 'function' && !call(o.canStart, src, e)) return;
    const liftEl = (typeof o.liftEl === 'function' ? call(o.liftEl, src) : null)
      || (src.querySelector && src.querySelector('svg')) || src;
    const r = liftEl.getBoundingClientRect();
    d = {
      id: e.pointerId, src, from: indexOf(src), liftEl, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      gw: r.width || 40, gh: r.height || 40, moved: false, ghost: null, geo: null,
      target: -1, base: -1, raw: -1, pend: -1, pendAt: 0, dwellTimer: 0,
      vx: 0, tilt: 0, lastX: e.clientX, lastMoveAt: clock(), raf: 0,
    };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
    lift(liftEl);
  }

  function onMovePtr(e) {
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const now = clock();
    if (!d.moved) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < threshold) return;
      begin();
    }
    if (e.cancelable) e.preventDefault();
    const dt = Math.max(1, now - d.lastMoveAt);
    const vx = (d.x - d.lastX) / dt;
    d.vx = d.vx * 0.5 + vx * 0.5;
    d.lastX = d.x;
    d.lastMoveAt = now;
    placeGhost();
    resolve(now);
  }

  function onUp(e) {
    if (!d || e.pointerId !== d.id) return;
    const cur = d;
    if (!cur.moved) {
      settle(cur.liftEl);
      const inf = info();
      cleanup();
      call(o.onTap, inf);
      return;
    }
    cur.x = e.clientX;
    cur.y = e.clientY;
    const target = resolve(clock());
    const inf = info();
    const ghost = cur.ghost;
    const src = cur.src;
    cleanup();
    suppressClick();
    if (target < 0) flyHome(ghost, src);
    else {
      if (ghost) ghost.remove();
      if (src && src.classList) src.classList.remove('is-drag-source');
    }
    call(o.onDrop, target, inf);
  }

  function cancelDrag() {
    if (!d) return;
    const cur = d;
    const inf = info();
    if (!cur.moved) {
      settle(cur.liftEl);
      cleanup();
      call(o.onCancel, inf);
      return;
    }
    const hadTarget = cur.target !== -1;
    const ghost = cur.ghost;
    const src = cur.src;
    cleanup();
    flyHome(ghost, src);
    if (hadTarget) call(o.onMove, -1, inf);
    call(o.onCancel, inf);
  }

  function onCancelPtr(e) {
    if (!d || e.pointerId !== d.id) return;
    cancelDrag();
  }
  function onLost(e) {
    // Capture lost without a pointerup (the element left the DOM, the OS took the touch).
    if (!d || e.pointerId !== d.id) return;
    setTimeout(() => { if (d && d.id === e.pointerId) cancelDrag(); }, 0);
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMovePtr);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancelPtr);
  el.addEventListener('lostpointercapture', onLost);

  return {
    cancel: cancelDrag,
    destroy() {
      cancelDrag();
      destroyed = true;
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMovePtr);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancelPtr);
      el.removeEventListener('lostpointercapture', onLost);
      if (single && el.style) {
        el.style.touchAction = prevTouch;
        if (el.classList) el.classList.remove('fx-draggable');
      }
    },
    get active() { return !!(d && d.moved); },
  };
}

export const fx = {
  isReducedMotion, rollNumber, press, squash, pulse, pourFill, ringBurst,
  confetti, shimmerSweep, flyTo, dim, fade,
  // v0.2 motion vocabulary
  spring, lift, settle, coinArc, stamp, pour, drag, measureGrid,
  // pure helpers (also exported by name)
  SPRINGS, DRAG, springCurve, springAt, lerpKeyframe, nearestCell, applyHysteresis, cellsWithin,
  pickTarget, cellRect, boardFromRects, tiltFromVelocity,
};

export default fx;
