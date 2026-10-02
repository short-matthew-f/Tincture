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

import { writeFileSync } from 'node:fs';
import { runJobs, defaultThreads } from './parallel.js';
import { jobsFor, markdown, PROFILE_ORDER } from './report.js';

function parseArgs(argv) {
  const out = { seeds: 30, days: 21, profile: 'all', threads: defaultThreads(), json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seeds') out.seeds = Number(next());
    else if (a === '--days') out.days = Number(next());
    else if (a === '--profile') out.profile = String(next());
    else if (a === '--threads') out.threads = Number(next());
    else if (a === '--json') out.json = String(next());
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument ' + a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('usage: node tools/balance/run.js [--seeds 30] [--days 21] [--profile all|engaged|casual|forgetful] [--threads N] [--json file]');
  process.exit(0);
}
const profiles = args.profile === 'all' ? PROFILE_ORDER : [args.profile];
if (!profiles.every((p) => PROFILE_ORDER.includes(p))) throw new Error('unknown profile ' + args.profile);

const jobs = jobsFor({ profiles, seeds: args.seeds, days: args.days, tiers: profiles.includes('casual') });
const t0 = Date.now();
const results = await runJobs(jobs, { threads: args.threads });
process.stdout.write(markdown(results, { seeds: args.seeds, days: args.days }));
process.stderr.write(`\n${jobs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${args.threads} thread(s)\n`);
if (args.json) writeFileSync(args.json, JSON.stringify(results));
