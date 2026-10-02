// format.js — number and time formatting (pure). No Date.now(): callers pass `now`.
// Used by every UI screen; notation comes from state.settings.notation.

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function trimFixed(x, digits) {
  // toFixed then drop a trailing ".0"
  return String(Number(x.toFixed(digits)));
}

/**
 * formatNumber(n, notation='short')
 *  - |n| < 1000: integers; values < 10 that are not integers get one decimal.
 *  - short: 1.2K 3.4M 5.6B 7.8T 1Qa ... Dc (values beyond Dc fall back to sci).
 *  - sci: 1.23e6 for |n| >= 1e6 (below that, plain rounded integers).
 */
export function formatNumber(n, notation = 'short') {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  if (n < 0) return '-' + formatNumber(-n, notation);

  if (n < 1000) {
    if (n < 10) return Number.isInteger(n) ? String(n) : trimFixed(n, 1);
    const r = Math.round(n);
    if (r < 1000) return String(r);
    // 999.6 rounds up to 1000: fall through to the K range
    n = 1000;
  }

  if (notation === 'sci') {
    if (n < 1e6) return String(Math.round(n));
    return sci(n);
  }

  let idx = Math.floor(Math.log10(n) / 3);
  if (idx >= SUFFIXES.length) return sci(n);
  let scaled = n / Math.pow(1000, idx);
  // guard against log10 float error (e.g. 1e15 -> 4.999..)
  if (scaled >= 1000) { idx++; scaled /= 1000; }
  else if (scaled < 1 && idx > 0) { idx--; scaled *= 1000; }
  let txt = trimFixed(scaled, 1);
  if (Number(txt) >= 1000) { // 999.96K -> 1M
    idx++;
    if (idx >= SUFFIXES.length) return sci(n);
    txt = '1';
  }
  return txt + SUFFIXES[idx];
}

function sci(n) {
  const [m, e] = n.toExponential(2).split('e');
  // trim trailing zeros of the mantissa: 1.00 -> 1, 1.50 -> 1.5
  const mant = String(Number(m));
  return mant + 'e' + Number(e);
}

const MIN = 60, HOUR = 3600, DAY = 86400;

/**
 * formatDuration(ms) -> "2 d 3 h", "6 h 20 m", "45 m", "30 s".
 * Shows the largest unit plus the next one when non-zero. Floors to seconds;
 * negative or invalid input is "0 s".
 */
export function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return durationFromSeconds(total);
}

function durationFromSeconds(total) {
  const d = Math.floor(total / DAY);
  const h = Math.floor((total % DAY) / HOUR);
  const m = Math.floor((total % HOUR) / MIN);
  const s = total % MIN;
  const parts = [[d, 'd'], [h, 'h'], [m, 'm'], [s, 's']];
  const i = parts.findIndex(([v]) => v > 0);
  if (i < 0) return '0 s';
  let out = `${parts[i][0]} ${parts[i][1]}`;
  const next = parts[i + 1];
  if (next && next[0] > 0) out += ` ${next[0]} ${next[1]}`;
  return out;
}

/** formatCountdown(ms) -> like formatDuration but rounds up and says "now" at <= 0. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  return durationFromSeconds(Math.ceil(ms / 1000));
}

/**
 * formatUntil(ms) -> a calm, minute-level "how long until": "now" (<= 0),
 * "under a minute", "about 9 m", "about 2 h 10 m", "about 3 d 4 h". Rounds UP
 * to the whole minute and never shows seconds, so nothing on screen ticks
 * (DESIGN.md: countdown copy never pressures; the map's "opens soon" voice).
 */
export function formatUntil(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  if (ms < 60e3) return 'under a minute';
  const mins = Math.ceil(ms / 60e3);
  if (mins < 60) return `about ${mins} m`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours < 24) return `about ${hours} h${m ? ` ${m} m` : ''}`;
  const d = Math.floor(hours / 24);
  const hr = hours % 24;
  return `about ${d} d${hr ? ` ${hr} h` : ''}`;
}

/** formatRate(perSec, notation) -> "+38/s" (negative: "-3/s"; tiny: "+<0.1/s"). */
export function formatRate(perSec, notation = 'short') {
  if (!Number.isFinite(perSec) || perSec === 0) return '+0/s';
  const sign = perSec < 0 ? '-' : '+';
  const a = Math.abs(perSec);
  if (a < 0.05) return `${sign}<0.1/s`;
  return `${sign}${formatNumber(a, notation)}/s`;
}

/**
 * isoWeekKey(now) -> "2026-W40". ISO 8601 week (Monday start, week 1 holds the
 * year's first Thursday). Computed in UTC so every device agrees on the week.
 */
export function isoWeekKey(now) {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const date = new Date(t);
  const dow = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this week
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** dayKey(now) -> "2026-10-02" using the device's LOCAL calendar date. */
export function dayKey(now) {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** pct(x) -> "+25%" for 0.25, "-10%" for -0.1, "+2.5%" for 0.025, "0%" for 0. */
export function pct(x) {
  if (!Number.isFinite(x)) return '0%';
  const v = Number((x * 100).toFixed(1));
  if (v === 0) return '0%';
  return (v > 0 ? '+' : '-') + Math.abs(v) + '%';
}
