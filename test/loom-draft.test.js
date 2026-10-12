import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../proto/loom/draft.js';

const rowStr = (row) => row.map((c) => (c === 'warp' ? '#' : '.')).join('');

function plain(ends = 8, picks = 8) {
  const d = D.createDraft({ shafts: 4, treadles: 2, ends, picks });
  d.threading = D.straightDraw(ends, 4);
  d.tieup[0][0] = d.tieup[2][0] = true; // treadle 1: shafts 1+3
  d.tieup[1][1] = d.tieup[3][1] = true; // treadle 2: shafts 2+4
  d.treadling = D.repeatTreadling([0, 1], picks);
  return d;
}

function twill22(ends = 16, picks = 16) {
  const d = D.createDraft({ shafts: 4, treadles: 4, ends, picks });
  d.threading = D.straightDraw(ends, 4);
  for (let t = 0; t < 4; t++) { d.tieup[t][t] = true; d.tieup[(t + 1) % 4][t] = true; }
  d.treadling = D.repeatTreadling([0, 1, 2, 3], picks);
  return d;
}

test('straight draw maps end i to shaft i mod n', () => {
  assert.deepEqual(D.straightDraw(10, 4), [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
});

test('point draw turns without doubling the turning shafts', () => {
  assert.deepEqual(D.pointDraw(12, 4), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
});

test('mirror and repeat helpers', () => {
  assert.deepEqual(D.mirror([1, 2, 3]), [1, 2, 3, 2, 1]);
  assert.deepEqual(D.mirror([1, 2, 3], true), [1, 2, 3, 3, 2, 1]);
  assert.deepEqual(D.repeatTreadling([1, 2, 3], 7), [1, 2, 3, 1, 2, 3, 1]);
  assert.equal(D.repeatUnit([0, 1, 2, null, null]), 3);
  assert.equal(D.repeatUnit([0, 1, 0, 1, 0, 1]), 2);
});

test('plain weave alternates on every pick and every end', () => {
  const dd = D.drawdown(plain());
  for (let p = 0; p < dd.length; p++) {
    for (let e = 0; e < dd[p].length; e++) {
      if (e > 0) assert.notEqual(dd[p][e], dd[p][e - 1]);
      if (p > 0) assert.notEqual(dd[p][e], dd[p - 1][e]);
    }
  }
  assert.equal(rowStr(dd[0]), '#.#.#.#.');
  assert.equal(rowStr(dd[1]), '.#.#.#.#');
});

test('2/2 twill steps one end per pick and is 2 up 2 down', () => {
  const d = twill22();
  const dd = D.drawdown(d);
  for (let p = 0; p < dd.length; p++) {
    assert.equal(dd[p].filter((c) => c === 'warp').length, d.threading.length / 2);
    for (let e = 1; e < dd[p].length; e++) {
      if (p + 1 < dd.length) assert.equal(dd[p + 1][e], dd[p][e - 1]);
    }
  }
  assert.deepEqual(D.floats(d).face, { warp: 2, weft: 2 });
});

test('liftedShafts reads tie-up x treadling', () => {
  const d = twill22();
  assert.deepEqual(D.liftedShafts(d, 0), [0, 1]);
  assert.deepEqual(D.liftedShafts(d, 3), [0, 3]);
});

test('back of the cloth is the exact inverse of the face', () => {
  const dd = D.drawdown(twill22());
  const back = D.backOf(dd);
  for (let p = 0; p < dd.length; p++) for (let e = 0; e < dd[p].length; e++) {
    assert.notEqual(back[p][e], dd[p][e]);
  }
  assert.deepEqual(D.backOf(back), dd);
});

test('sinking shed inverts the drawdown of the same tie-up', () => {
  const r = twill22();
  const s = D.setShed(r, 'sinking');
  const a = D.drawdown(r);
  const b = D.drawdown(s);
  for (let p = 0; p < a.length; p++) for (let e = 0; e < a[p].length; e++) {
    assert.notEqual(a[p][e], b[p][e]);
  }
  assert.deepEqual(D.liftedShafts(s, 0), [2, 3]);
});

test('sinking with the complemented tie-up gives the same cloth as rising', () => {
  const r = twill22();
  const s = D.setShed(r, 'sinking');
  for (let sh = 0; sh < 4; sh++) for (let t = 0; t < 4; t++) s.tieup[sh][t] = !r.tieup[sh][t];
  assert.deepEqual(D.drawdown(s), D.drawdown(r));
});

test('liftplan equals tie-up x treadling, rising and sinking', () => {
  for (const shed of ['rising', 'sinking']) {
    const d = D.setShed(twill22(), shed);
    const lp = D.setMode(d, 'liftplan');
    assert.equal(lp.mode, 'liftplan');
    assert.deepEqual(D.drawdown(lp), D.drawdown(d));
  }
});

test('unthreaded ends and blank picks show weft and are skipped by floats', () => {
  const d = D.createDraft({ shafts: 4, treadles: 2, ends: 4, picks: 3 });
  d.threading = [0, null, 0, 0];
  d.tieup[0][0] = true;
  d.treadling = [0, null, 0];
  const dd = D.drawdown(d);
  assert.equal(rowStr(dd[0]), '#.##');
  assert.equal(rowStr(dd[1]), '....');
  assert.equal(D.floats(d).face.warp, 1); // blank pick breaks the run
});

test('floats counts the longest warp and weft float', () => {
  const d = D.createDraft({ shafts: 4, treadles: 1, ends: 6, picks: 5 });
  d.threading = [0, 1, 1, 1, 1, 1];
  d.tieup[0][0] = true;
  d.treadling = [0, 0, 0, 0, 0];
  const f = D.floats(d);
  assert.equal(f.face.warp, 5);
  assert.equal(f.face.weft, 5);
  assert.equal(f.back.warp, 5);
  assert.equal(D.floats(plain()).warp, 1);
});

test('edits are immutable', () => {
  const d = twill22();
  const snap = JSON.stringify(d);
  D.toggleThreading(d, 0, 2); D.toggleTieup(d, 0, 0); D.toggleTreadling(d, 0, 3);
  D.setEnds(d, 5); D.setPicks(d, 5); D.setWarpColor(d, 0, '#000000');
  assert.equal(JSON.stringify(d), snap);
});

test('toggles set and clear cells', () => {
  let d = D.createDraft({ ends: 4, picks: 4 });
  d = D.toggleThreading(d, 1, 2);
  assert.equal(d.threading[1], 2);
  d = D.toggleThreading(d, 1, 3); // one shaft per end: moves
  assert.equal(d.threading[1], 3);
  d = D.toggleThreading(d, 1, 3);
  assert.equal(d.threading[1], null);
  d = D.toggleTieup(d, 1, 1);
  assert.equal(d.tieup[1][1], true);
  d = D.toggleTreadling(d, 0, 4);
  assert.equal(d.treadling[0], 4);
  d = D.setMode(d, 'liftplan');
  d = D.toggleLift(d, 2, 3);
  d = D.toggleLift(d, 2, 1);
  assert.deepEqual(d.liftplan[2], [1, 3]);
  d = D.toggleLift(d, 2, 3);
  assert.deepEqual(d.liftplan[2], [1]);
});

test('resizing ends, picks, shafts and treadles preserves data', () => {
  let d = twill22(8, 8);
  const t0 = d.threading.slice();
  d = D.setEnds(d, 12);
  assert.equal(d.threading.length, 12);
  assert.equal(d.warpColors.length, 12);
  assert.deepEqual(d.threading.slice(0, 8), t0);
  assert.equal(d.threading[11], null);
  d = D.setEnds(d, 4);
  assert.deepEqual(d.threading, t0.slice(0, 4));
  d = D.setPicks(d, 10);
  assert.equal(d.treadling.length, 10);
  assert.equal(d.liftplan.length, 10);
  assert.equal(d.weftColors.length, 10);
  d = D.setShafts(d, 8);
  assert.equal(d.tieup.length, 8);
  assert.equal(d.tieup[0][0], true);
  d = D.setShafts(d, 2);
  assert.equal(d.tieup.length, 2);
  assert.ok(d.threading.every((s) => s === null || s < 2));
  d = D.setTreadles(d, 2);
  assert.equal(d.tieup[0].length, 2);
  assert.ok(d.treadling.every((t) => t === null || t < 2));
});

test('repeat to fill repeats the started threading and treadling with colors', () => {
  let d = D.createDraft({ ends: 12, picks: 12 });
  d.threading = [0, 1, 2, 3, null, null, null, null, null, null, null, null];
  d.warpColors = d.warpColors.map((_, i) => (i === 0 ? '#B8433A' : '#EFE6D2'));
  d = D.repeatThreadingToFill(d);
  assert.deepEqual(d.threading, D.straightDraw(12, 4));
  assert.equal(d.warpColors[4], '#B8433A');
  d.treadling = [0, 1, null, null, null, null, null, null, null, null, null, null];
  d = D.repeatTreadlingToFill(d);
  assert.deepEqual(d.treadling.slice(0, 6), [0, 1, 0, 1, 0, 1]);
});

test('weaving appends picks and undo-by-removal unweaves them', () => {
  let d = D.createDraft({ ends: 4, picks: 2, treadles: 3 });
  assert.equal(D.wovenCount(d), 0);
  d = D.appendPick(d, 1, '#B8433A');
  d = D.appendPick(d, 2, '#3E6A9E');
  assert.equal(D.wovenCount(d), 2);
  d = D.appendPick(d, 0, '#D9A63A'); // grows the draft
  assert.equal(d.treadling.length, 3);
  assert.deepEqual(d.treadling, [1, 2, 0]);
  assert.equal(d.weftColors[2], '#D9A63A');
  d = D.removeLastPick(d);
  assert.equal(D.wovenCount(d), 2);
  const lp = D.appendPick(D.setMode(D.createDraft({ picks: 1 }), 'liftplan'), [2, 0], '#000000');
  assert.deepEqual(lp.liftplan[0], [0, 2]);
});

test('normalizeDraft repairs bad data', () => {
  const d = D.normalizeDraft({ shafts: 4, treadles: 2, threading: [0, 9, 'x'], treadling: [5, 1], tieup: [[true]], warpColors: ['nope'] });
  assert.deepEqual(d.threading, [0, null, null]);
  assert.deepEqual(d.treadling, [null, 1]);
  assert.equal(d.warpColors[0], '#EFE6D2');
  assert.equal(d.tieup.length, 4);
});

test('every preset is a complete, well-formed draft', () => {
  assert.ok(D.PRESETS.length >= 13);
  for (const { id, name } of D.PRESETS) {
    const d = D.buildPreset(id);
    assert.ok(d, name);
    assert.equal(d.threading.length, d.warpColors.length, name);
    assert.equal(d.treadling.length, d.weftColors.length, name);
    assert.equal(d.tieup.length, d.shafts, name);
    assert.ok(d.threading.every((s) => s !== null && s < d.shafts), `${name} threading`);
    assert.ok(d.treadling.every((t) => t !== null && t < d.treadles), `${name} treadling`);
    assert.ok(d.warpColors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), name);
    // liftplan mirrors the tie-up so switching modes is lossless
    assert.deepEqual(D.drawdown(D.setMode(d, 'liftplan')), D.drawdown(d), name);
    // no solid warp or weft pick rows
    for (const row of D.drawdown(d)) {
      const warps = row.filter((c) => c === 'warp').length;
      assert.ok(warps > 0 && warps < row.length, `${name} has a solid pick row`);
    }
    // every end and every pick ties in with the cloth: no solid columns either
    const dd = D.drawdown(d);
    for (let e = 0; e < d.threading.length; e++) {
      const ups = dd.filter((r) => r[e] === 'warp').length;
      assert.ok(ups > 0 && ups < dd.length, `${name} has a solid end column`);
    }
    assert.ok(D.floats(d).warp <= 8 && D.floats(d).weft <= 8, `${name} floats`);
  }
  assert.equal(D.buildPreset('nope'), null);
});

test('named presets have the right structure', () => {
  const p = (id) => D.buildPreset(id);
  const f = (id) => D.floats(p(id)).face;
  assert.deepEqual(f('plain'), { warp: 1, weft: 1 });
  assert.deepEqual(f('basket'), { warp: 2, weft: 2 });
  assert.deepEqual(f('twill22'), { warp: 2, weft: 2 });
  assert.deepEqual(f('twill13'), { warp: 1, weft: 3 });
  assert.deepEqual(f('twill31'), { warp: 3, weft: 1 });
  // 3/1 is the back of 1/3: complement of the 1/3 drawdown
  assert.deepEqual(D.drawdown(p('twill31')), D.backOf(D.drawdown(p('twill13'))));
  // each pick of 1/3 twill raises exactly one end in four
  for (const row of D.drawdown(p('twill13'))) {
    row.forEach((c, i) => { if (i < 4) assert.ok(row.slice(0, 4).filter((x) => x === 'warp').length === 1); });
  }
  // point twill threading is 1 2 3 4 3 2
  assert.deepEqual(p('point').threading.slice(0, 7).map((s) => s + 1), [1, 2, 3, 4, 3, 2, 1]);
  // houndstooth: 2/2 twill with 4 dark / 4 light in warp and weft
  const h = p('houndstooth');
  assert.deepEqual(h.warpColors.slice(0, 8), h.weftColors.slice(0, 8));
  assert.equal(new Set(h.warpColors.slice(0, 4)).size, 1);
  assert.notEqual(h.warpColors[0], h.warpColors[4]);
  assert.deepEqual(f('houndstooth'), { warp: 2, weft: 2 });
  // overshot: tabby picks alternate odd (1+3) / even (2+4) shafts
  const o = p('overshot');
  const tabby = o.treadling.filter((t) => t >= 2);
  tabby.forEach((t, i) => assert.equal(t, 2 + (i % 2)));
  o.treadling.forEach((t, i) => { if (i % 2 === 1) assert.ok(t >= 2); else assert.ok(t < 2); });
  // log cabin is plain weave: no float longer than 1
  assert.deepEqual(f('logcabin'), { warp: 1, weft: 1 });
});

test('log cabin color-and-weave makes horizontal and vertical stripe blocks', () => {
  const d = D.buildPreset('logcabin');
  const dd = D.drawdown(d);
  const top = (p, e) => (dd[p][e] === 'warp' ? d.warpColors[e] : d.weftColors[p]);
  // warp block 1 x weft block 1: horizontal stripes (rows uniform, rows differ)
  assert.equal(new Set(dd.slice(0, 1).map((_, p) => [0, 1, 2, 3, 4, 5, 6, 7].map((e) => top(p, e)).join())).size, 1);
  const r0 = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((e) => top(0, e)));
  const r1 = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((e) => top(1, e)));
  assert.equal(r0.size, 1);
  assert.equal(r1.size, 1);
  assert.notEqual([...r0][0], [...r1][0]);
  // warp block 2 x weft block 1: vertical stripes (columns uniform, rows alternate)
  const row = [8, 9, 10, 11].map((e) => top(0, e));
  assert.notEqual(row[0], row[1]);
  assert.equal(row[0], row[2]);
  assert.equal(top(0, 8), top(1, 8));
});
