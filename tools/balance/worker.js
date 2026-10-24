// tools/balance/worker.js — worker thread for parallel.js: runs one simulate() job
// per message and posts back the summary (no `state`, so it clones cheaply).

import { parentPort } from 'node:worker_threads';
import { simulate, summarize } from './sim-player.js';
import { jsonDigest } from './report.js';

parentPort.on('message', ({ i, job, stateDigest }) => {
  try {
    const run = simulate(job);
    const result = summarize(run);
    if (stateDigest) result.stateDigest = jsonDigest(run.state);
    parentPort.postMessage({ i, result });
  } catch (e) {
    parentPort.postMessage({ i, error: String((e && e.stack) || e) });
  }
});
