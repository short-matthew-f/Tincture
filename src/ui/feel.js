/**
 * feel.js: small shared helpers for the Theme F feel pass (screens only).
 *
 * Built locally because fx.js belongs to another worker; each of these is a
 * candidate to move into fx.js (see the report):
 *  - wireLift(root, selector, fx): press-lift for tiles. Touch lifts after an
 *    80 ms hold so a scroll that starts on a tile never bumps it (a pointercancel
 *    or a move of more than 6 px inside the hold means no lift at all); a quick tap lifts and settles at once.
 *  - springIn(el, fx, opts): the "arrives from above" spring used for cards that
 *    slide or drop into their slot.
 *  - dust(x, y): a small puff of paper-colored specks at a point.
 *
 * Every helper is reduced-motion safe (fx.spring fades; dust is skipped).
 */

const HOLD_MS = 80;

/**
 * Press-lift on every `selector` element inside `root`, with one delegated set
 * of listeners. Returns a dispose function. Never lifts disabled or
 * aria-disabled elements, and never double-fires: one lift per press.
 */
export function wireLift(root, selector, fx, { holdMs = HOLD_MS } = {}) {
  if (!root || !fx) return () => {};
  let held = null;      // the element currently lifted (or about to be)
  let timer = 0;
  let lifted = false;
  let pid = null;

  const release = () => {
    clearTimeout(timer);
    timer = 0;
    const el = held;
    held = null;
    pid = null;
    if (!el) return;
    if (!lifted) { fx.lift(el); }       // a quick tap: lift, then settle straight away
    lifted = false;
    fx.settle(el);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
    const el = held;
    held = null;
    pid = null;
    if (el && lifted) quietPut(el, fx);   // the finger turned into a scroll: put it down gently, no overshoot
    lifted = false;
  };
  // A scroll that starts on a tile is not a press: give up the hold once the finger has really moved.
  let sx = 0, sy = 0;
  const move = (e) => {
    if (!held || e.pointerId !== pid || lifted) return;
    if (Math.abs(e.clientX - sx) > 6 || Math.abs(e.clientY - sy) > 6) cancel();
  };

  const down = (e) => {
    if (held) release();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target && e.target.closest ? e.target.closest(selector) : null;
    if (!t || !root.contains(t) || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    held = t;
    pid = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    lifted = false;
    if (e.pointerType === 'mouse' || holdMs <= 0) { lifted = true; fx.lift(t); return; }
    timer = setTimeout(() => { timer = 0; if (held === t) { lifted = true; fx.lift(t); } }, holdMs);
  };
  const up = (e) => { if (held && (pid === null || e.pointerId === pid)) release(); };
  const cancelled = (e) => { if (held && (pid === null || e.pointerId === pid)) cancel(); };

  root.addEventListener('pointerdown', down, { passive: true });
  root.addEventListener('pointerup', up, { passive: true });
  root.addEventListener('pointercancel', cancelled, { passive: true });
  root.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerup', up, { passive: true });
  document.addEventListener('pointercancel', cancelled, { passive: true });
  return () => {
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', cancelled);
    root.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancelled);
    cancel();
  };
}

/** Put a lifted element back without the settle overshoot (a scroll took the finger). */
function quietPut(el, fx) {
  if (el.classList) el.classList.remove('fx-lifted');
  let cur = 'matrix(1, 0, 0, 1, 0, 0)';
  try { const t = getComputedStyle(el).transform; if (t && t !== 'none') cur = t; } catch (e) { /* ignore */ }
  fx.spring(el, { from: { transform: cur }, to: { transform: 'matrix(1, 0, 0, 1, 0, 0)' }, preset: 'soft' });
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
