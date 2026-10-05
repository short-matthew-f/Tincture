/**
 * haptics.js: gentle vibration patterns on navigator.vibrate.
 *
 * Owns: the four haptic strengths (light, medium, heavy, success) plus `soft`
 * (pours) and `ripple(n)` (coin collect: "Light x 3"). Implements DESIGN.md
 * "Interaction feel > Haptics": never buzzing, at most one haptic per 80 ms so
 * chains feel like a ripple rather than a rattle, one toggle (settings.haptics).
 * Silent no-op where navigator.vibrate does not exist (iOS Safari, desktop).
 *
 * Throttle rule: inside the 80 ms window after a haptic, a call of the SAME or
 * a WEAKER strength is dropped, but a STRONGER one (rank: soft < light/ripple
 * < medium < heavy/success) overrides it: navigator.vibrate() cancels the
 * running pattern and plays the new one, and the window restarts. So the
 * app's light tick on pointerdown never swallows the medium/heavy/success an
 * action plays a few ms later, and a chain still can't rattle (at most one
 * escalation per strength step).
 */

const PATTERNS = {
  soft: [6],
  light: [10],
  medium: [20],
  heavy: [35],
  success: [15, 40, 25],
};

const THROTTLE_MS = 80;
const RANK = { soft: 0, light: 1, ripple: 1, medium: 2, heavy: 3, success: 3 };

let enabled = true;
let last = -Infinity;
let lastRank = -1;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fire(pattern, rank = 1) {
  if (!enabled) return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const t = now();
  if (t - last < THROTTLE_MS && rank <= lastRank) return false;
  last = t;
  lastRank = rank;
  try {
    return navigator.vibrate(pattern);
  } catch (e) {
    return false;
  }
}

export const haptics = {
  soft: () => fire(PATTERNS.soft, RANK.soft),
  light: () => fire(PATTERNS.light, RANK.light),
  medium: () => fire(PATTERNS.medium, RANK.medium),
  heavy: () => fire(PATTERNS.heavy, RANK.heavy),
  success: () => fire(PATTERNS.success, RANK.success),
  /** Light x n as one gentle ripple pattern (coin collect). */
  ripple(n = 3) {
    const k = Math.max(1, Math.min(5, Math.round(n)));
    const p = [];
    for (let i = 0; i < k; i++) p.push(10, 50);
    p.pop();
    return fire(p, RANK.ripple);
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
