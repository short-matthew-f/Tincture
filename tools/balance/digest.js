#!/usr/bin/env node
// tools/balance/digest.js — fingerprints of the balance test's simulations, for
// engine refactors and speed-ups that must not change a single result.
//
//   node tools/balance/digest.js            # runs, states and first-sessions digests
//
// runs:   the 45 run summaries of test/balance.test.js (5 seeds, 21 days), the
//         numbers every balance assertion reads; the test pins this one
//         (BALANCE_DIGEST), so update it there when a rule change is meant to
//         move the balance.
// states: the same runs' final states (stronger: any stored field, rng position
//         or key order that differs shows up here).
// first:  the 30 first-session runs of the test's "first session" check.
// Run it before and after a change; equal digests mean identical simulations.

import { runJobs } from './parallel.js';
import { firstSessions } from './sim-player.js';
import { jobsFor, runsDigest, statesDigest, jsonDigest } from './report.js';

const t0 = Date.now();
const results = await runJobs(jobsFor({ seeds: 5, days: 21 }), { stateDigest: true });
const first = jsonDigest(Array.from({ length: 30 }, (_, i) => firstSessions({ profile: 'casual', seed: i + 1, minutes: 10, sessions: 2 })));
console.log(`runs    ${runsDigest(results)}`);
console.log(`states  ${statesDigest(results)}`);
console.log(`first   ${first}`);
process.stderr.write(`${results.length} runs + 30 first sessions in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
