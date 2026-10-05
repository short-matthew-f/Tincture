#!/usr/bin/env node
// tools/balance/run.js — the Era 1 balance simulation from the command line.
// Drives the real engine (tools/balance/sim-player.js) for each player profile
// and prints the design doc's tables (docs/DESIGN.md "Balance model and testing")
// as markdown, medians over seeds.
//
//   node tools/balance/run.js                       # all profiles, 30 seeds, 21 days
//   node tools/balance/run.js --seeds 10 --days 21 --profile casual
//   node tools/balance/run.js --threads 1           # no worker threads
//   node tools/balance/run.js --json out.json       # also write the raw summaries
//   node tools/balance/run.js --minutes 10          # the first sessions minute by minute:
//        purchases, coins and colors per session, and when the Merge Shelf is reachable
//        (--profile casual by default, --seeds 5, --sessions 2; --verbose lists every purchase)

import { writeFileSync } from 'node:fs';
import { runJobs, defaultThreads } from './parallel.js';
import { jobsFor, markdown, median, PROFILE_ORDER } from './report.js';
import { firstSessions } from './sim-player.js';

function parseArgs(argv) {
  const out = { seeds: null, days: 21, profile: null, threads: defaultThreads(), json: null, minutes: null, sessions: 2, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seeds') out.seeds = Number(next());
    else if (a === '--days') out.days = Number(next());
    else if (a === '--profile') out.profile = String(next());
    else if (a === '--threads') out.threads = Number(next());
    else if (a === '--json') out.json = String(next());
    else if (a === '--minutes') out.minutes = Number(next());
    else if (a === '--sessions') out.sessions = Number(next());
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument ' + a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('usage: node tools/balance/run.js [--seeds 30] [--days 21] [--profile all|engaged|casual|forgetful] [--threads N] [--json file]\n'
    + '       node tools/balance/run.js --minutes 10 [--seeds 5] [--sessions 2] [--profile casual] [--verbose]');
  process.exit(0);
}

/** --minutes N: the first sessions minute by minute (sim-player.js firstSessions). */
function firstMinutes() {
  const profile = args.profile ?? 'casual';
  const seeds = args.seeds ?? 5;
  const lines = [`First sessions, ${profile}, ${args.minutes} minutes each, ${args.sessions} sessions, seeds 1–${seeds}`, ''];
  const counts = args.sessions > 0 ? Array.from({ length: args.sessions }, () => []) : [];
  const shelf = [];
  const fmt = (x) => (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(1));
  for (let seed = 1; seed <= seeds; seed++) {
    const r = firstSessions({ profile, seed, minutes: args.minutes, sessions: args.sessions });
    shelf.push(r.shelfSession ?? Infinity);
    r.sessions.forEach((s, i) => {
      counts[i].push(s.purchases.length);
      const kinds = {};
      for (const p of s.purchases) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      const mixerAt = s.purchases.find((p) => p.kind === 'newMixer');
      lines.push(`seed ${seed} session ${i + 1} (+${s.start.toFixed(1)} h): ${s.purchases.length} purchases `
        + `(${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')})`
        + `${mixerAt ? `, new mixer at ${mixerAt.at.toFixed(1)} min` : ''}; coins ${fmt(s.coinsStart)} → ${fmt(s.coinsEnd)}; `
        + `colors ${s.colorsStart} → ${s.colorsEnd}; mixers ${s.mixers}; income ${s.income.toFixed(2)}/s; `
        + `shelf ${s.shelfBought ? 'bought' : s.shelfAffordable ? 'affordable' : s.shelfRevealed ? 'revealed' : 'closed'}`);
      if (args.verbose) for (const p of s.purchases) lines.push(`    ${p.at.toFixed(1)} min  ${p.label} (${fmt(p.cost)}, ${p.why})`);
    });
  }
  lines.push('');
  counts.forEach((c, i) => lines.push(`session ${i + 1}: median ${median(c)} purchases (min ${Math.min(...c)}, max ${Math.max(...c)})`));
  const ms = median(shelf);
  lines.push(`Merge Shelf first reachable (8 colors + 400 Coins) in session: median ${ms ?? 'later'} (${shelf.map((x) => (Number.isFinite(x) ? x : '—')).join(', ')})`);
  console.log(lines.join('\n'));
}

if (args.minutes) {
  firstMinutes();
  process.exit(0);
}
args.seeds ??= 30;
args.profile ??= 'all';
const profiles = args.profile === 'all' ? PROFILE_ORDER : [args.profile];
if (!profiles.every((p) => PROFILE_ORDER.includes(p))) throw new Error('unknown profile ' + args.profile);

const jobs = jobsFor({ profiles, seeds: args.seeds, days: args.days, tiers: profiles.includes('casual') });
const t0 = Date.now();
const results = await runJobs(jobs, { threads: args.threads });
process.stdout.write(markdown(results, { seeds: args.seeds, days: args.days }));
process.stderr.write(`\n${jobs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${args.threads} thread(s)\n`);
if (args.json) writeFileSync(args.json, JSON.stringify(results));
