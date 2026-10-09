import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  TIERS, TIER_VALUES, unlocked, addVial, canMerge, merge, sell, tickSpillover, containerValue,
  hints, move, SPILLOVER_MS, MIN_EMPTY, MAX_COLORS, LINE_BONUS, DOUBLE_BONUS, GOLDEN_CHANCE,
  findLines, resolveLines, skipLine, setShelfColors, defaultShelfColors, shelfColors, spilloverPaused,
  tierForValue, goldenAllowed,
} from '../src/sim/shelf.js';
import { assignRecipe, tickFactory } from '../src/sim/factory.js';
import { discover } from '../src/sim/discovery.js';
import { stockOf } from '../src/sim/storage.js';
import { colorFamily, colorPrice, incomeMultiplier } from '../src/sim/economy.js';
import { CATALOG } from '../src/content/catalog.js';

const NOW = Date.UTC(2026, 9, 2, 12);

function shelfState() {
  const s = createInitialState(NOW, 5);
  discover(s, { colorId: 'orange', method: 'bench' }, NOW);
  const more = CATALOG.find((c) => !s.catalog.discovered[c.id]);
  discover(s, { colorId: more.id, method: 'hunt' }, NOW);
  s.unlocks.shelf = true; // bought (v0.2: src/sim/unlocks.js)
  return s;
}

const vial = (color, tier = 1, extra = {}) => ({ color, tier, golden: false, boost: 1, unit: 10, ...extra });

test('shelf: tiers; open once bought, not by color count', () => {
  assert.deepEqual(TIERS.map((t) => t.id), ['vial', 'jar', 'bottle', 'urn', 'cask']);
  assert.deepEqual(TIER_VALUES, [1, 2.5, 6, 15, 40]);
  for (let t = 1; t < 5; t++) assert.ok(TIER_VALUES[t] > 2 * TIER_VALUES[t - 1], 'merging always pays');
  const s = createInitialState(NOW, 1);
  assert.equal(unlocked(s), false);
  for (const c of CATALOG.slice(0, 20)) discover(s, { colorId: c.id, method: 'debug' }, NOW);
  assert.equal(unlocked(s), false, 'colors only reveal the price');
  assert.equal(unlocked(shelfState()), true);
});

test('shelf: chain merge climbs the ladder and records each step', () => {
  const s = shelfState();
  const c = s.shelf.cells;
  c[0] = vial('madder', 2);
  c[1] = vial('madder', 1);
  c[2] = vial('madder', 3);
  c[6] = vial('madder', 1); // row 1, col 1 (below cell 1)
  assert.equal(canMerge(c[6], c[1]), true);
  assert.deepEqual(hints(s).sort((a, b) => a - b), [1, 6]);
  const r = merge(s, { from: 6, to: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((x) => x.tier), [2, 3, 4]);
  assert.equal(s.shelf.cells[1].tier, 4);
  assert.equal(s.shelf.cells[0], null);
  assert.equal(s.shelf.cells[2], null);
  assert.equal(s.shelf.cells[6], null);
  assert.ok(s._events.some((e) => e.type === 'chain' && e.steps.length === 3));
  assert.equal(merge(s, { from: 1, to: 1 }).ok, false);
});

test('shelf: merging never changes color; golden keeps the other color and doubles value', () => {
  const s = shelfState();
  const c = s.shelf.cells;
  c[0] = vial('madder');
  c[1] = vial('woad');
  assert.equal(canMerge(c[0], c[1]), false);
  c[2] = vial('woad', 1, { golden: true });
  c[10] = vial('madder');
  assert.equal(merge(s, { from: 2, to: 0 }).ok, true);
  assert.equal(c[0].color, 'madder');
  assert.equal(c[0].tier, 2);
  assert.equal(c[0].boost, 2);
  assert.equal(c[0].golden, false);
  const plain = vial('madder', 2);
  c[20] = plain;
  assert.ok(Math.abs(containerValue(s, 0) - 2 * containerValue(s, 20)) < 1e-9);
});

test('shelf: forming a Cask grants Essence and consumes it', () => {
  const s = shelfState();
  s.shelf.cells[0] = vial('ochre', 4);
  s.shelf.cells[1] = vial('ochre', 4);
  const r = merge(s, { from: 0, to: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.essence, { colorId: 'ochre', essence: 1 });
  assert.equal(s.catalog.discovered.ochre.essence, 1);
  assert.equal(s.shelf.cells[1], null);
  assert.ok(s._events.some((e) => e.type === 'essence' && e.colorId === 'ochre'));
});

test('shelf: sell pays tier value (no row labels, no tidy bonus)', () => {
  const s = shelfState();
  s.shelf.cells[0] = vial('woad', 3);
  const base = containerValue(s, 0, NOW);
  assert.ok(Math.abs(base - 10 * colorPrice(s, 'woad') * 6 * incomeMultiplier(s, NOW)) < 1e-9);
  assert.equal(s.shelf.rowLabels, undefined);
  const coins = s.coins;
  const r = sell(s, { cell: 0 }, NOW);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(s.coins - coins - base) < 1e-9);
  assert.equal(s.shelf.cells[0], null);
  // move: into empty, then swap
  s.shelf.cells[3] = vial('madder');
  assert.equal(move(s, { from: 3, to: 4 }).ok, true);
  assert.equal(s.shelf.cells[4].color, 'madder');
});

test('shelf: spillover adds vials while producing; a full shelf stops it without touching the factory', () => {
  const s = shelfState();
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  setShelfColors(s, { colors: ['orange'] });
  tickSpillover(s, NOW); // schedules the first vial
  tickFactory(s, NOW + 35 * 60e3);
  const n = s.shelf.cells.filter(Boolean).length;
  assert.ok(n >= 3, `three vials in 35 minutes (got ${n})`);
  assert.ok(s.shelf.cells.filter(Boolean).every((x) => x.color === 'orange' && x.unit > 0));
  // Fill it (madder/woad alternate so no line forms).
  for (let i = 0; i < s.shelf.cells.length; i++) if (!s.shelf.cells[i]) s.shelf.cells[i] = vial(i % 2 ? 'madder' : 'woad');
  assert.equal(addVial(s, { colorId: 'orange' }), null);
  const stockBefore = stockOf(s, 'orange');
  const snapshot = JSON.stringify(s.shelf.cells);
  tickFactory(s, NOW + 5 * 3600e3);
  assert.equal(JSON.stringify(s.shelf.cells), snapshot, 'nothing added to a full shelf');
  assert.ok(s.shelf.nextSpilloverAt > NOW + 5 * 3600e3 - 1 && s.shelf.nextSpilloverAt <= NOW + 5 * 3600e3 + SPILLOVER_MS);
  assert.ok(stockOf(s, 'orange') >= stockBefore, 'factory keeps producing');
});

test('shelf: the spillover timer pauses while nothing produces and resumes where it left off', () => {
  const s = shelfState();
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  tickSpillover(s, NOW); // schedules the first vial, SPILLOVER_MS (3 minutes) out
  tickFactory(s, NOW + 60e3); // 2 minutes left
  const left = s.shelf.nextSpilloverAt - (NOW + 60e3);
  assert.ok(left > 1.5 * 60e3 && left <= 2 * 60e3, `about two minutes left (got ${left})`);
  // Unassign the mixer: production stops. The timer must pause, not reset.
  s.stations.mixers[0].recipe = null;
  tickFactory(s, NOW + 90e3);
  assert.equal(s.shelf.nextSpilloverAt, 0, 'no countdown while idle');
  const kept = left - 30e3; // half a minute more ran before the pause
  assert.ok(Math.abs(s.shelf.pausedRemainingMs - kept) < 1000, 'remaining time kept');
  tickFactory(s, NOW + 60 * 60e3); // an idle hour: still paused, nothing added
  assert.equal(s.shelf.nextSpilloverAt, 0);
  assert.equal(s.shelf.cells.filter(Boolean).length, 0);
  // Resume: the vial lands after the remaining time, not after a fresh timer.
  assert.equal(assignRecipe(s, { mixer: 0, colorId: 'orange' }).ok, true);
  const t = NOW + 61 * 60e3;
  tickFactory(s, t);
  assert.ok(Math.abs(s.shelf.nextSpilloverAt - (t + kept)) < 1000, 'resumed with the kept remainder');
  assert.equal(s.shelf.pausedRemainingMs, 0);
});

// ---------------------------------------------------------------------------
// v0.2 Theme B: 6×6, five color chips, lines of six
// ---------------------------------------------------------------------------

const REDS = ['madder', 'mulberry', 'rosewood', 'brick-red', 'russet', 'bunting-red'];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
/** Fill `cells` with containers (cycling colors); every other cell stays empty. */
function place(s, cells, colors = REDS, tier = 1, extra = {}) {
  cells.forEach((i, k) => { s.shelf.cells[i] = vial(colors[k % colors.length], tier, extra); });
}

test('shelf: a fresh shelf is 6 x 6 with 36 cells, no row labels', () => {
  const s = createInitialState(NOW, 2);
  assert.equal(s.shelf.cols, 6);
  assert.equal(s.shelf.rows, 6);
  assert.equal(s.shelf.cells.length, 36);
  assert.equal(s.shelf.rowLabels, undefined);
  assert.deepEqual(s.shelf.colors, []);
});

test('shelf: five color chips at most, discovered only; defaults spread over five families', () => {
  const s = shelfState();
  for (const id of ['green', 'olive', 'marigold', 'violet', 'mulberry', 'teal']) discover(s, { colorId: id, method: 'debug' }, NOW);
  const r = setShelfColors(s, { colors: ['madder', 'ochre', 'woad', 'green', 'violet', 'orange', 'not-a-color'] });
  assert.equal(r.ok, true);
  assert.deepEqual(s.shelf.colors, ['madder', 'ochre', 'woad', 'green', 'violet']);
  assert.equal(s.shelf.colors.length, MAX_COLORS);
  assert.deepEqual(shelfColors(s), s.shelf.colors);
  assert.equal(setShelfColors(s, { colors: ['bramble'] }).colors.length, 0, 'undiscovered colors are refused');
  // Defaults: mixers' recipes first, then the most-stocked, five different families.
  assignRecipe(s, { mixer: 0, colorId: 'orange' });
  assignRecipe(s, { mixer: 1, colorId: 'marigold' }); // orange family again
  s.stock = { olive: { jars: 50, purity: { muddy: 0, standard: 50, pure: 0, flawless: 0 } }, woad: { jars: 40, purity: { muddy: 0, standard: 40, pure: 0, flawless: 0 } } };
  const d = defaultShelfColors(s);
  assert.equal(d.length, 5);
  assert.equal(d[0], 'orange');
  assert.equal(d[1], 'olive', 'most-stocked next');
  assert.equal(d[2], 'woad');
  assert.equal(new Set(d.map(colorFamily)).size, 5, `five families: ${d}`);
  assert.ok(!d.includes('marigold'), 'a second orange only if no new family is left');
  // Two chips in one family stay allowed when she picks them.
  assert.deepEqual(setShelfColors(s, { colors: ['orange', 'marigold'] }).colors, ['orange', 'marigold']);
  assert.deepEqual(setShelfColors(s, { colors: [] }).colors, []);
  assert.deepEqual(shelfColors(s), d, 'empty chips fall back to the defaults');
});

test('shelf: spillover delivers only chip colors and rests below six empty cells', () => {
  const s = shelfState();
  discover(s, { colorId: 'mulberry', method: 'debug' }, NOW);
  assignRecipe(s, { mixer: 0, colorId: 'orange' });
  setShelfColors(s, { colors: ['woad', 'mulberry'] });
  tickSpillover(s, NOW);
  tickFactory(s, NOW + 8 * 3600e3);
  const on = s.shelf.cells.filter(Boolean);
  assert.equal(on.length, 36 - MIN_EMPTY + 1, 'fills until fewer than six cells are empty');
  assert.ok(on.every((x) => x.color === 'woad' || x.color === 'mulberry'), 'never a color off the chips');
  assert.equal(spilloverPaused(s), true);
  const before = JSON.stringify(s.shelf.cells);
  tickFactory(s, NOW + 12 * 3600e3);
  assert.equal(JSON.stringify(s.shelf.cells), before, 'resting: nothing added');
  // Make room: it resumes.
  for (let i = 0; i < 4; i++) s.shelf.cells[s.shelf.cells.findIndex(Boolean)] = null;
  assert.equal(spilloverPaused(s), false);
  tickFactory(s, NOW + 14 * 3600e3);
  assert.ok(s.shelf.cells.filter(Boolean).length > on.length - 4);
});

test('shelf: lines found on rows, columns and both diagonals, by hue family; golden is any family', () => {
  const s = shelfState();
  place(s, [30, 31, 32, 33, 34, 35]); // bottom row: six different reds
  assert.deepEqual(findLines(s).map((l) => [l.kind, l.index, l.family]), [['row', 5, 'red']]);
  s.shelf.cells[33] = vial('woad');
  assert.deepEqual(findLines(s), [], 'a blue breaks the red row');
  s.shelf.cells[33] = vial('woad', 1, { golden: true });
  assert.equal(findLines(s).length, 1, 'golden counts as any family');
  s.shelf.cells.fill(null);
  place(s, [2, 8, 14, 20, 26, 32], ['woad', 'cornflower', 'sky-blue', 'delft-blue']);
  assert.deepEqual(findLines(s).map((l) => [l.kind, l.index, l.family]), [['col', 2, 'blue']]);
  s.shelf.cells.fill(null);
  place(s, [0, 7, 14, 21, 28, 35], ['green', 'willow', 'spruce']);
  assert.deepEqual(findLines(s).map((l) => [l.kind, l.index]), [['diag', 0]]);
  s.shelf.cells.fill(null);
  place(s, [5, 10, 15, 20, 25, 30], ['ochre', 'olive']);
  assert.deepEqual(findLines(s).map((l) => [l.kind, l.index, l.cells]), [['diag', 1, [5, 10, 15, 20, 25, 30]]]);
  s.shelf.cells.fill(null);
  place(s, [30, 31, 32, 33, 34]);
  assert.deepEqual(findLines(s), [], 'five is not a line');
});

test('shelf: tier and value maths: highest tier the summed value reaches, × 1.5, coins credited', () => {
  assert.equal(tierForValue(6), 3);
  assert.equal(tierForValue(14.9), 3);
  assert.equal(tierForValue(15), 4);
  assert.equal(tierForValue(90), 5);
  const s = shelfState();
  s.coins = 0;
  place(s, [30, 31, 32, 33, 34, 35], REDS, 2); // six jars: 15 -> Urn
  s.shelf.cells[33].boost = 2; // a golden-boosted jar: 5 -> sum 17.5
  const base = REDS.reduce((a, id) => a + 10 * colorPrice(s, id), 0) / 6;
  const r = resolveLines(s, NOW);
  assert.equal(r.double, false);
  assert.equal(r.tier, 4);
  assert.equal(r.lines[0].sum, 17.5);
  assert.ok(near(r.value, 15 * base * LINE_BONUS));
  assert.ok(near(r.coins, r.value * incomeMultiplier(s, NOW)));
  assert.ok(near(s.coins, r.coins));
  assert.deepEqual(r.cells, [30, 31, 32, 33, 34, 35]);
  assert.ok(r.cells.every((i) => s.shelf.cells[i] === null), 'cells cleared');
  assert.equal(s.stats.lines, 1);
  const ev = s._events.find((e) => e.type === 'lines');
  assert.ok(ev && ev.tier === 4 && ev.double === false && ev.cells.length === 6 && near(ev.coins, r.coins));
  assert.equal(resolveLines(s, NOW), null, 'nothing left to resolve');
  assert.equal(skipLine(s).lineSkips, 1);
  assert.equal(s.stats.lineSkips, 1);
});

test('shelf: a Cask line grants Essence to the family\'s most-stocked color', () => {
  const s = shelfState();
  discover(s, { colorId: 'mulberry', method: 'debug' }, NOW);
  s.stock = { mulberry: { jars: 30, purity: { muddy: 0, standard: 30, pure: 0, flawless: 0 } }, madder: { jars: 5, purity: { muddy: 0, standard: 5, pure: 0, flawless: 0 } } };
  place(s, [0, 1, 2, 3, 4, 5], REDS, 4); // six urns: 90 -> Cask
  const r = resolveLines(s, NOW);
  assert.equal(r.tier, 5);
  assert.deepEqual(r.essence, [{ colorId: 'mulberry', essence: 1 }]);
  assert.equal(s.catalog.discovered.mulberry.essence, 1);
  assert.ok(r.coins > 0, 'and it still sells');
});

test('shelf: two lines in one check resolve together as a double line (× 2 on the bonus, shared cell counts twice)', () => {
  const s = shelfState();
  s.coins = 0;
  place(s, [30, 31, 32, 33, 34, 35]); // bottom row
  place(s, [5, 11, 17, 23, 29], REDS.slice(1)); // right column, sharing cell 35
  const found = findLines(s);
  assert.deepEqual(found.map((l) => l.kind), ['row', 'col']);
  const r = resolveLines(s, NOW);
  assert.equal(r.double, true);
  assert.equal(r.lines.length, 2);
  assert.equal(r.cells.length, 11);
  for (const l of r.lines) assert.equal(l.tier, 3, 'six vials -> a Bottle');
  assert.ok(near(r.coins, r.lines[0].coins + r.lines[1].coins));
  const single = shelfState();
  place(single, [30, 31, 32, 33, 34, 35]);
  const one = resolveLines(single, NOW);
  assert.ok(near(r.lines[0].value, one.value * DOUBLE_BONUS), 'the row is worth twice a lone row');
  assert.ok(near(s.coins, r.coins));
  assert.equal(s.stats.lines, 1, 'one sequence');
  assert.ok(s.shelf.cells.every((c) => c === null));
});

test('shelf: cascade: the chain finishes first, then the line resolves; move resolves lines too', () => {
  const s = shelfState();
  // Bottom row: five reds and a madder jar at 35; a madder jar dropped onto it
  // makes a Bottle, which chains with the madder Bottle above (29), then the row is full.
  place(s, [30, 31, 32, 33, 34], REDS.slice(1));
  s.shelf.cells[35] = vial('madder', 2);
  s.shelf.cells[29] = vial('madder', 3);
  s.shelf.cells[0] = vial('madder', 2);
  const r = merge(s, { from: 0, to: 35 }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((x) => x.tier), [3, 4], 'chain: jar -> bottle -> urn');
  assert.ok(r.lines && r.lines.lines.length === 1 && r.lines.lines[0].kind === 'row');
  assert.equal(r.lines.lines[0].sum, 5 + 15);
  const order = s._events.map((e) => e.type).filter((t) => t === 'chain' || t === 'lines');
  assert.deepEqual(order, ['chain', 'lines']);
  assert.equal(s.shelf.cells[35], null);
  // A plain move that completes a column.
  place(s, [0, 6, 12, 18, 24], ['woad']);
  s.shelf.cells[31] = vial('cornflower');
  const m = move(s, { from: 31, to: 30 }, NOW);
  assert.equal(m.ok, true);
  assert.equal(m.lines.lines[0].kind, 'col');
  assert.equal(move(s, { from: 1, to: 2 }, NOW).ok, false, 'nothing to move');
  // No line: lines is null.
  s.shelf.cells[7] = vial('woad');
  assert.equal(move(s, { from: 7, to: 8 }, NOW).lines, null);
});

test('shelf: golden vials spill over only after the first Bottle', () => {
  const s = shelfState();
  assignRecipe(s, { mixer: 0, colorId: 'orange' });
  setShelfColors(s, { colors: ['orange'] });
  const goldens = (st) => st.shelf.cells.filter((c) => c && c.golden).length;
  // Roll many spillovers on a shelf that keeps being emptied.
  const run = (st) => {
    let g = 0;
    tickSpillover(st, NOW);
    for (let k = 1; k <= 400; k++) {
      tickSpillover(st, NOW + k * SPILLOVER_MS);
      g += goldens(st);
      st.shelf.cells.fill(null);
    }
    return g;
  };
  assert.equal(goldenAllowed(s), false);
  assert.equal(run(s), 0, 'no golden before a Bottle');
  const t = shelfState();
  assignRecipe(t, { mixer: 0, colorId: 'orange' });
  setShelfColors(t, { colors: ['orange'] });
  t.shelf.cells[0] = vial('orange', 2);
  t.shelf.cells[1] = vial('orange', 2);
  merge(t, { from: 0, to: 1 }, NOW);
  assert.equal(t.stats.firstBottleAt, NOW);
  assert.equal(goldenAllowed(t), true);
  const g = run(t);
  assert.ok(g > 0 && g < 400 * GOLDEN_CHANCE * 4, `about 1 in 40 (got ${g} of 400)`);
});

test('shelf: a line of six Bottles pays more than selling them one by one', async () => {
  const { resolveLines, tierValue, LINE_FLOOR } = await import('../src/sim/shelf.js');
  const { colorPrice } = await import('../src/sim/economy.js');
  const s = shelfState();
  for (let i = 0; i < 6; i++) s.shelf.cells[i] = { color: 'madder', tier: 3, golden: false, unit: 1 };
  const separately = 6 * tierValue(3) * colorPrice(s, 'madder');
  const before = s.coins;
  const r = resolveLines(s, NOW);
  assert.ok(r && r.lines.length === 1, 'one row resolved');
  assert.ok(r.value >= separately * LINE_FLOOR - 1e-9, `line value ${r.value} >= ${separately * LINE_FLOOR}`);
  assert.ok(s.coins > before);
});
