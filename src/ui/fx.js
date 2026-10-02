/**
 * fx.js: motion effects (DOM + SVG only, Web Animations API and rAF).
 *
 * Owns: rollNumber, press, squash, pourFill, ringBurst, confetti,
 * shimmerSweep, flyTo, pulse, dim. Implements DESIGN.md "Interaction feel >
 * Interaction spec" and "Motion rules": arrivals ease out, moves ease in and
 * out, overshoot never above 5% (except squash's specified 104%), nothing
 * longer than 1.5 s. Every effect checks `isReducedMotion()` and swaps its
 * movement for a 120 ms fade (particle bursts are skipped, per the
 * accessibility section: "disables screen shake and particle bursts").
 *
 * Floating bits live in `#fx-layer` (fixed, pointer-events none, from
 * index.html). All effects return a Promise that resolves when they finish,
 * and never throw if an element is missing.
 */

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
      const t = Math.min(1, (now - start) / ms);
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
      const t = Math.min(1, (now - start) / ms);
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

export const fx = {
  isReducedMotion, rollNumber, press, squash, pulse, pourFill, ringBurst,
  confetti, shimmerSweep, flyTo, dim, fade,
};

export default fx;
