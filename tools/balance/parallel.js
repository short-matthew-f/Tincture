// tools/balance/parallel.js — run many simulate() jobs across worker threads.
// The engine's tick is closed form but a 21-day run still takes 0.3–1.4 s
// (Dispatcher sub-steps, one flow-meter read per purchase), so the balance test
// and run.js spread their seeds over the machine's cores.
//
// runJobs([{profile, seed, days, puzzles, tier}], {threads}) -> Promise<RunSummary[]>
// (same order as the jobs; RunSummary = simulate() result without `state`).

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { simulate, summarize } from './sim-player.js';

/** Rough relative cost of a job, so the slowest start first. */
function weight(job) {
  const per = { engaged: 3, casual: 1.6, forgetful: 1 }[job.profile] ?? 1;
  return per * (job.puzzles === false ? 0.5 : 1) * (job.days ?? 21);
}

export function defaultThreads() {
  const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(8, n));
}

export async function runJobs(jobs, opts = {}) {
  const threads = Math.max(1, Math.min(jobs.length, opts.threads ?? defaultThreads()));
  const results = new Array(jobs.length);
  if (threads <= 1) {
    jobs.forEach((job, i) => { results[i] = summarize(simulate(job)); });
    return results;
  }
  const order = jobs.map((job, i) => i).sort((a, b) => weight(jobs[b]) - weight(jobs[a]));
  let next = 0;
  const lane = () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.js', import.meta.url));
    const feed = () => {
      if (next >= order.length) { w.terminate().then(() => resolve(), resolve); return; }
      const i = order[next++];
      w.postMessage({ i, job: jobs[i] });
    };
    w.on('message', (msg) => {
      if (msg.error) { w.terminate(); reject(new Error(msg.error)); return; }
      results[msg.i] = msg.result;
      feed();
    });
    w.on('error', reject);
    feed();
  });
  await Promise.all(Array.from({ length: threads }, lane));
  return results;
}
