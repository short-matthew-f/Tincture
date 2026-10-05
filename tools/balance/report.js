// tools/balance/report.js — job lists and the design doc's tables from run
// summaries (docs/DESIGN.md "Balance model and testing": Milestone results,
// Difficulty tiers, Always-progress check, Gallery and Merge Shelf).
// Medians over seeds; "—" when most runs never got there.

import { PROFILES, TIER_MINUTES } from './sim-player.js';

export const PROFILE_ORDER = Object.freeze(['engaged', 'casual', 'forgetful']);
export const TIER_ORDER = Object.freeze(['relaxed', 'steady', 'tricky', 'master']);

/** Every job for a report: each profile with and without puzzles, plus Casual at each tier. */
export function jobsFor({ profiles = PROFILE_ORDER, seeds = 5, days = 21, tiers = true } = {}) {
  const jobs = [];
  for (const profile of profiles) {
    for (const puzzles of [true, false]) {
      for (let seed = 1; seed <= seeds; seed++) jobs.push({ profile, puzzles, seed, days, key: key(profile, puzzles) });
    }
  }
  if (tiers) {
    for (const tier of TIER_ORDER) {
      if (tier === PROFILES.casual.tier && profiles.includes('casual')) continue; // the Casual runs themselves
      for (let seed = 1; seed <= seeds; seed++) jobs.push({ profile: 'casual', puzzles: true, tier, seed, days, key: 'casual@' + tier });
    }
  }
  return jobs;
}

export function key(profile, puzzles) {
  return puzzles ? profile : profile + '-np';
}

/** Group run summaries by key; Casual (Steady) also counts as 'casual@steady'. */
export function group(results) {
  const g = {};
  for (const r of results) {
    const k = r.tier && r.tier !== PROFILES[r.profile].tier ? `${r.profile}@${r.tier}` : key(r.profile, r.puzzles);
    (g[k] ??= []).push(r);
    if (r.profile === 'casual' && r.puzzles && r.tier === PROFILES.casual.tier) (g['casual@' + r.tier] ??= []).push(r);
  }
  return g;
}

/** Median of numbers; null entries count as "never" (Infinity). Returns null if most never got there. */
export function median(values) {
  if (!values.length) return null;
  const s = values.map((x) => (x === null || x === undefined || Number.isNaN(x) ? Infinity : x)).sort((a, b) => a - b);
  const m = s.length;
  const v = m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
  return Number.isFinite(v) ? v : null;
}

const fmtDay = (v) => (v === null ? '—' : v.toFixed(1));
const pct = (v) => (v === null ? '—' : (100 * v).toFixed(1) + '%');
const day = (rs, d, f) => median(rs.map((r) => f(r.days[Math.min(d, r.days.length - 1)])));
const NAMES = { engaged: 'Engaged', casual: 'Casual', forgetful: 'Forgetful' };

function table(head, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

/** Coins earned by puzzles per active minute (the doc's "Active Coins per minute"). */
export function coinsPerActiveMinute(r) {
  return r.activeMinutes > 0 ? r.puzzleCoins / r.activeMinutes : 0;
}

/**
 * Admission share "by day 14": the median of days 13–15 (calendar days 12–14),
 * so one day landing on a Renovate dip does not swing it (TUNING.md change 11).
 */
export function admissionByDay14(r) {
  return median([12, 13, 14].map((d) => r.days[Math.min(d, r.days.length - 1)].admissionShare));
}

/** Lowest offline window (hours) she left with after day 1. */
export function minWindowAfterDay1(r) {
  return Math.min(...r.days.slice(1).map((d) => d.windowMinH));
}

export function milestoneTable(g) {
  const rows = [];
  for (const p of PROFILE_ORDER) {
    for (const puzzles of [true, false]) {
      const rs = g[key(p, puzzles)];
      if (!rs) continue;
      const m = (k) => fmtDay(median(rs.map((r) => r.milestones[k])));
      rows.push([`${NAMES[p]}${puzzles ? (p === 'casual' ? ' (target player)' : '') : ', no puzzles'}`,
        m('phase2'), m('phase3'), m('renovate'), m('colors50'), String(median(rs.map((r) => r.colors)))]);
    }
  }
  return table(['Profile', 'Phase 2', 'Phase 3', 'Renovate (10 Heritage)', '50 colors', 'Colors by day 21'], rows);
}

export function tierTable(g) {
  const base = g['casual@relaxed'];
  if (!base) return '';
  const baseCpm = median(base.map(coinsPerActiveMinute));
  const rows = [];
  for (const t of TIER_ORDER) {
    const rs = g['casual@' + t];
    if (!rs) continue;
    const cpm = median(rs.map(coinsPerActiveMinute));
    rows.push([t[0].toUpperCase() + t.slice(1), fmtDay(median(rs.map((r) => r.milestones.renovate))),
      String(median(rs.map((r) => r.activeMinutes))), baseCpm > 0 ? (cpm / baseCpm).toFixed(2) + '×' : '—']);
  }
  return table(['Tier', 'First Renovate (day)', 'Active minutes over 21 days', 'Active Coins per minute (vs Relaxed)'], rows);
}

export function progressTable(g) {
  const rows = [];
  for (const p of PROFILE_ORDER) {
    const rs = g[p];
    if (!rs) continue;
    const worst = Math.max(...rs.map((r) => r.worstGapMin));
    const tier = PROFILES[p].tier;
    rows.push([NAMES[p], `${worst} min`, `${TIER_MINUTES[tier]} min (${tier[0].toUpperCase() + tier.slice(1)})`, worst <= 5 ? '≤ 5 min: pass' : '≤ 5 min: FAIL']);
  }
  for (const t of TIER_ORDER) {
    const rs = g['casual@' + t];
    if (!rs || t === PROFILES.casual.tier) continue;
    const worst = Math.max(...rs.map((r) => r.worstGapMin));
    rows.push([`Casual at ${t}`, `${worst} min`, `${TIER_MINUTES[t]} min`, worst <= 5 ? '≤ 5 min: pass' : '≤ 5 min: FAIL']);
  }
  return table(['Profile', 'Worst gap', 'One puzzle takes', 'Target'], rows);
}

export function zonesTable(g) {
  const rows = [];
  for (const p of PROFILE_ORDER) {
    const rs = g[p];
    if (!rs) continue;
    rows.push([NAMES[p], fmtDay(median(rs.map((r) => r.milestones.galleryOpen))),
      `${pct(median(rs.map(admissionByDay14)))} (${pct(day(rs, 13, (d) => d.admissionShare))}) / ${pct(day(rs, 20, (d) => d.admissionShare))}`,
      pct(day(rs, 13, (d) => d.shelfShare)),
      [6, 13, 20].map((d) => (day(rs, d, (x) => x.essenceAvg) ?? 0).toFixed(1)).join(' / '),
      String(median(rs.map((r) => r.pieces))), `${Math.max(...rs.map((r) => r.worstGapMin))} min`]);
  }
  return table(['Profile', 'Gallery opens (day)', 'Admission share, days 13–15 (day 14 alone) / day 21', 'Shelf share, day 14',
    'Avg Essence stars, day 7 / 14 / 21', 'Pieces painted by day 21', 'Worst progress gap'], rows);
}

/** Extra columns the doc reads from the model: puzzle share, income, offline window, Renovates. */
export function economyTable(g) {
  const rows = [];
  for (const p of PROFILE_ORDER) {
    for (const puzzles of [true, false]) {
      const rs = g[key(p, puzzles)];
      if (!rs) continue;
      const share = median(rs.map((r) => (r.earned > 0 ? r.puzzleCoins / r.earned : 0)));
      const inc = (d) => { const v = day(rs, d, (x) => x.incomeRate); return v === null ? '—' : fmtNum(v); };
      rows.push([`${NAMES[p]}${puzzles ? '' : ', no puzzles'}`, pct(share), inc(6), inc(13), inc(20),
        (median(rs.map(minWindowAfterDay1)) ?? 0).toFixed(1) + ' h', (Math.min(...rs.map(minWindowAfterDay1))).toFixed(1) + ' h',
        String(median(rs.map((r) => r.renovations.length)))]);
    }
  }
  return table(['Profile', 'Puzzle share of Coins', 'Income/s day 7', 'Income/s day 14', 'Income/s day 21',
    'Offline window after day 1 (median of min)', 'Worst', 'Renovates in 21 days'], rows);
}

export function fmtNum(v) {
  if (!Number.isFinite(v)) return '—';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [n, u] of units) if (Math.abs(v) >= n) return (v / n).toFixed(1) + u;
  return v.toFixed(1);
}

/** All tables as one markdown document. */
export function markdown(results, { seeds, days } = {}) {
  const g = group(results);
  const parts = [`Tincture Era 1 balance simulation (real engine), ${days ?? 21} days, ${seeds ?? '?'} seeds per profile. Medians; "—" means most runs never got there.`];
  parts.push('### Milestone results\n\n' + milestoneTable(g));
  const tiers = tierTable(g);
  if (tiers) parts.push('### Difficulty tiers (Casual schedule)\n\n' + tiers);
  parts.push('### Always-progress check\n\n' + progressTable(g));
  parts.push('### Gallery and Merge Shelf\n\n' + zonesTable(g));
  parts.push('### Economy\n\n' + economyTable(g));
  return parts.join('\n\n') + '\n';
}
