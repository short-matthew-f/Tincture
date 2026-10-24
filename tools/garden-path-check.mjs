// tools/garden-path-check.mjs — the Garden Path's offline audit: generates all
// 108 gardens and runs the greedy feasibility check and the headless autopilot
// (src/puzzles/garden-path.js autoplay) on every one, to the main goal and to
// the very last plant. `npm test` runs the cheap checks on all gardens and the
// autopilot on a sample (test/garden-path.test.js); this runs everything.
//
// Run: node tools/garden-path-check.mjs [--quiet]
// Exit code 1 when any garden cannot be finished, its goal or a star cannot be
// met, a landmark did not fit in the field, or a sunny garden's goal needs more
// than DUSK_SHARE of its sun at the autopilot's pace.

import * as R from '../src/puzzles/garden.js';
import * as P from '../src/puzzles/garden-path.js';

const quiet = process.argv.includes('--quiet');
const DUSK_SHARE = 0.4; // a person steers at about a third of the autopilot's pace
let bad = 0;
const rows = [];
const t0 = performance.now();
for (const level of P.LEVELS) {
  const a = performance.now();
  const g = P.pathGarden(level.id);
  const genMs = performance.now() - a;
  const issues = [];
  const fin = P.pathFinish(g);
  if (!fin.ok) issues.push(`stuck after ${fin.gathered} of ${g.plants.length}`);
  for (const [s, n] of level.mix) {
    if (!R.SPECIES[s].landmark && !R.SPECIES[s].grand) continue;
    const have = g.plants.filter((p) => p.s === s).length;
    if (have < n) issues.push(`${s}: ${have} of ${n} placed`);
  }
  const maxLevel = R.levelsOf(g).length + 1;
  const all = fin.order;
  const flags = { sweep: 99, spindle: true, sun: true, beforeDusk: true };
  const sc = P.score(level, g, all, flags);
  if (!sc.met) issues.push('goal not reachable with everything gathered');
  for (const e of sc.extras) if (!e.met) issues.push(`star not reachable: ${e.text}`);
  if (level.stars.some((s) => s.t === 'spindle') && !g.finds.some((f) => f.k === 'spindle')) issues.push('no spindle to find');
  for (const h of g.hedges || []) if (h.level !== h.asked) issues.push(`gate asked ${h.asked}, opens at ${h.level}`);
  // landmarks come in near the end: after most of everything else
  const lm = g.plants.map((p, i) => i).filter((i) => R.SPECIES[g.plants[i].s].landmark);
  if (lm.length && fin.ok) {
    const first = Math.min(...lm.map((i) => all.indexOf(i)));
    if (first < all.length * 0.8) issues.push(`landmark fits early (${first} of ${all.length})`);
  }
  const b = performance.now();
  const run = P.autoplay(level, { maxT: 1200 });
  const botMs = performance.now() - b;
  if (!run.done) issues.push(`autopilot stopped after ${run.got.length} of ${g.plants.length}${run.stuck ? ' (nothing fits)' : ''}`);
  if (run.goalAt === null && level.goal.t !== 'sweep') issues.push('autopilot never met the goal');
  if (level.dusk && run.goalAt !== null && run.goalAt > level.dusk * DUSK_SHARE) issues.push(`sunny goal at ${run.goalAt.toFixed(0)} s of ${level.dusk} s`);
  if (issues.length) bad++;
  rows.push({ n: level.n, id: level.id, size: `${g.W}x${g.H}`, plants: g.plants.length, levels: maxLevel, goal: P.goalText(level.goal, level),
    goalAt: run.goalAt, secs: run.secs, genMs, botMs, issues });
}
const ms = performance.now() - t0;
if (!quiet) {
  for (const r of rows) {
    console.log(`${String(r.n).padStart(3)} ${r.id.padEnd(12)} ${r.size.padEnd(9)} ${String(r.plants).padStart(4)} plants  B${r.levels}  goal ${r.goalAt === null ? '  -  ' : r.goalAt.toFixed(0).padStart(4) + ' s'}  all ${r.secs.toFixed(0).padStart(4)} s  gen ${r.genMs.toFixed(0)} ms  bot ${r.botMs.toFixed(0)} ms  ${r.goal}${r.issues.length ? '  !! ' + r.issues.join('; ') : ''}`);
  }
}
const dens = rows.reduce((m, r) => (r.plants > m.plants ? r : m), rows[0]);
console.log(`\n${rows.length} gardens, ${rows.length - bad} fine, ${bad} with issues. Densest: ${dens.id} (${dens.plants} plants, ${dens.size}). ${(ms / 1000).toFixed(1)} s.`);
const goalSecs = rows.map((r) => r.goalAt).filter((x) => x !== null).sort((a, b) => a - b);
const allSecs = rows.map((r) => r.secs).sort((a, b) => a - b);
const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
console.log(`Autopilot to the goal: median ${q(goalSecs, 0.5).toFixed(0)} s, max ${goalSecs[goalSecs.length - 1].toFixed(0)} s. To the last plant: median ${q(allSecs, 0.5).toFixed(0)} s, max ${allSecs[allSecs.length - 1].toFixed(0)} s.`);
process.exit(bad ? 1 : 0);
