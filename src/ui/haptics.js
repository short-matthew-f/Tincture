/**
 * haptics.js: gentle vibration patterns on navigator.vibrate.
 *
 * Owns: the four haptic strengths (light, medium, heavy, success) plus `soft`
 * (pours) and `ripple(n)` (coin collect: "Light x 3"). Implements DESIGN.md
 * "Interaction feel > Haptics": never buzzing, at most one haptic per 80 ms so
 * chains feel like a ripple rather than a rattle, one toggle (settings.haptics).
 * Silent no-op where navigator.vibrate does not exist (iOS Safari, desktop).
 */

const PATTERNS = {
  soft: [6],
  light: [10],
  medium: [20],
  heavy: [35],
  success: [15, 40, 25],
};

const THROTTLE_MS = 80;

let enabled = true;
let last = -Infinity;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fire(pattern) {
  if (!enabled) return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const t = now();
  if (t - last < THROTTLE_MS) return false;
  last = t;
  try {
    return navigator.vibrate(pattern);
  } catch (e) {
    return false;
  }
}

export const haptics = {
  soft: () => fire(PATTERNS.soft),
  light: () => fire(PATTERNS.light),
  medium: () => fire(PATTERNS.medium),
  heavy: () => fire(PATTERNS.heavy),
  success: () => fire(PATTERNS.success),
  /** Light x n as one gentle ripple pattern (coin collect). */
  ripple(n = 3) {
    const k = Math.max(1, Math.min(5, Math.round(n)));
    const p = [];
    for (let i = 0; i < k; i++) p.push(10, 50);
    p.pop();
    return fire(p);
  },
  /** settings.haptics */
  setEnabled(on) {
    enabled = !!on;
    if (!enabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(0); } catch (e) { /* ignore */ }
    }
  },
  isEnabled: () => enabled,
  isSupported: () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
};

export default haptics;
