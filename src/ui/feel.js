/**
 * feel.js: small shared helpers for the Theme F feel pass (screens only).
 *
 *  - wireLift(root, selector, fx): press-lift for tiles. A thin wrapper over
 *    fx.touchFeel (the shared delegated 80 ms hold / 6 px move-cancel /
 *    pointercancel behaviour); kept so screens need no change.
 *  - springIn(el, fx, opts): the "arrives from above" spring used for cards that
 *    slide or drop into their slot.
 *  - dust(x, y): a small puff of paper-colored specks at a point.
 *
 * Every helper is reduced-motion safe (fx.spring fades; dust is skipped).
 */

import { touchFeel } from './fx.js';

/**
 * Press-lift on every `selector` element inside `root` (fx.touchFeel with
 * `lift: selector`). Returns a dispose function. `fx` is accepted for the old
 * signature; a passed fx with its own touchFeel is used.
 */
export function wireLift(root, selector, fx, { holdMs = 80 } = {}) {
  const tf = fx && typeof fx.touchFeel === 'function' ? fx.touchFeel : touchFeel;
  return tf(root, { lift: selector, holdMs });
}

/**
 * Spring an element in from `dy` px above (or `dx` px aside) at a slightly
 * smaller scale. `preset` is a spring preset ('soft' paper, 'firm' wood,
 * 'heavy' cask). Resolves when it settles.
 */
export function springIn(el, fx, { dy = -24, dx = 0, scale = 0.94, preset = 'soft', delay = 0 } = {}) {
  if (!el || !fx) return Promise.resolve();
  return fx.spring(el, {
    from: { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
    to: { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
    preset,
    delay,
    fill: delay ? 'backwards' : 'none', // hold the first frame during the delay
  });
}

/** A puff of small paper-colored specks drifting up and out from a point (client px). */
export function dust(fx, x, y, { n = 6, hexes = ['#F7F4EC', '#E3D8C4', '#CFC3AA'], ms = 520 } = {}) {
  if (typeof document === 'undefined' || (fx && fx.isReducedMotion && fx.isReducedMotion())) return Promise.resolve();
  const layer = document.getElementById('fx-layer');
  if (!layer || typeof layer.animate !== 'function') return Promise.resolve();
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'fx-dot';
    d.style.background = hexes[i % hexes.length];
    d.style.width = d.style.height = `${5 + (i % 3) * 2}px`;
    d.style.margin = `${-(5 + (i % 3) * 2) / 2}px 0 0 ${-(5 + (i % 3) * 2) / 2}px`;
    layer.appendChild(d);
    const side = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;           // -1 .. 1, a fan along the ground
    const dx = side * (22 + (i % 2) * 10);
    const dy = -(8 + (i % 3) * 7);
    jobs.push(d.animate([
      { transform: `translate(${x}px,${y}px) scale(0.4)`, opacity: 0.9 },
      { transform: `translate(${x + dx * 0.7}px,${y + dy}px) scale(1)`, opacity: 0.85, offset: 0.4 },
      { transform: `translate(${x + dx}px,${y + dy - 10}px) scale(1.3)`, opacity: 0 },
    ], { duration: ms, delay: i * 18, easing: 'ease-out', fill: 'both' }).finished.then(() => d.remove(), () => d.remove()));
  }
  return Promise.all(jobs).then(() => undefined);
}

export default { wireLift, springIn, dust };
