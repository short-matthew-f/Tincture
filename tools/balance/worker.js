// tools/balance/worker.js — worker thread for parallel.js: runs one simulate() job
// per message and posts back the summary (no `state`, so it clones cheaply).

import { parentPort } from 'node:worker_threads';
import { simulate, summarize } from './sim-player.js';

parentPort.on('message', ({ i, job }) => {
  try {
    parentPort.postMessage({ i, result: summarize(simulate(job)) });
  } catch (e) {
    parentPort.postMessage({ i, error: String((e && e.stack) || e) });
  }
});
