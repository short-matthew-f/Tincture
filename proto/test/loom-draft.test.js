import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../loom/draft.js';
import * as Z from '../loom/puzzles.js';
import * as W from '../loom/wif.js';

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

/* ------------------------------------------------------------ puzzles */

const rotate = (a, k) => a.map((_, i) => a[(i + k) % a.length]);

test('there are 12 puzzles in rising order with unique targets', () => {
  assert.equal(Z.PUZZLES.length, 12);
  Z.PUZZLES.forEach((p, i) => assert.equal(p.level, i + 1));
  assert.equal(Z.PUZZLES[0].id, 'tea-towel');
  assert.equal(Z.PUZZLES.at(-1).id, 'overshot');
  assert.equal(Z.getPuzzle('nope'), null);
});

test('every puzzle is solvable within its stated shafts, treadles and size', () => {
  for (const p of Z.PUZZLES) {
    const s = p.solution();
    assert.ok(s.threading.every((x) => x < p.shafts), `${p.id} shafts`);
    assert.ok(s.treadling.every((t) => t < p.treadles), `${p.id} treadles`);
    assert.equal(s.tieup.length, p.shafts, p.id);
    assert.equal(s.threading.length, p.ends, p.id);
    assert.equal(s.treadling.length, p.picks, p.id);
    assert.equal(s.mode, 'treadle');
    assert.equal(Z.similarity(s, Z.targetOf(p), { structureOnly: p.structureOnly }), 1, p.id);
    assert.ok(Z.isSolved(s, p), p.id);
  }
});

test('a shifted solution still scores 1.0', () => {
  for (const p of Z.PUZZLES) {
    const s = p.solution();
    const shifted = {
      ...s,
      threading: rotate(s.threading, 3),
      warpColors: rotate(s.warpColors, 3),
      treadling: rotate(s.treadling, 5),
      weftColors: rotate(s.weftColors, 5),
    };
    assert.equal(Z.similarity(shifted, Z.targetOf(p), { structureOnly: p.structureOnly }), 1, p.id);
  }
});

test('a different structure scores below 1.0', () => {
  for (const a of Z.PUZZLES) for (const b of Z.PUZZLES) {
    if (a === b) continue;
    const opts = { structureOnly: a.structureOnly && b.structureOnly };
    assert.ok(Z.similarity(a.solution(), b.solution(), opts) < 1, `${a.id} vs ${b.id}`);
  }
});

test('an alternative draft with the same cloth also solves the puzzle', () => {
  const p = Z.getPuzzle('tea-towel');
  const alt = D.createDraft({ shafts: 4, treadles: 2, ends: 16, picks: 16 });
  alt.threading = D.repeatTreadling([0, 1], 16); // 2-shaft threading
  alt.tieup[0][0] = true; alt.tieup[1][1] = true;
  alt.treadling = D.repeatTreadling([0, 1], 16);
  assert.ok(Z.isSolved(alt, p));
  // the same cloth woven on a sinking shed with the complement tie-up
  const sink = D.setShed(alt, 'sinking');
  sink.tieup[0][0] = false; sink.tieup[1][1] = false; sink.tieup[1][0] = true; sink.tieup[0][1] = true;
  assert.ok(Z.isSolved(sink, p));
});

test('colors matter only for color puzzles', () => {
  const hp = Z.getPuzzle('houndstooth');
  const s = hp.solution();
  const recolored = D.clearColors(s, '#B8433A', '#3E6A9E');
  assert.ok(Z.similarity(recolored, Z.targetOf(hp), { structureOnly: true }) === 1);
  assert.ok(Z.similarity(recolored, Z.targetOf(hp), { structureOnly: false }) < 1);
});

test('a blank draft scores gently below 1 and the mask lights only matching cells', () => {
  const p = Z.getPuzzle('twill22');
  const blank = Z.startDraft(p);
  assert.ok(Z.similarity(blank, Z.targetOf(p)) < 1);
  const solved = p.solution();
  assert.ok(Z.matchMask(solved, Z.targetOf(p)).every((r) => r.every(Boolean)));
  const m = Z.matchMask(blank, Z.targetOf(p));
  assert.ok(m.flat().some((x) => !x) && m.flat().some(Boolean));
});

test('hints reveal threading, tie-up, treadling (and colors) one at a time', () => {
  for (const p of Z.PUZZLES) {
    const stages = Z.hintStages(p);
    assert.deepEqual(stages.slice(0, 3), ['threading', 'tie-up', 'treadling']);
    assert.equal(stages.length, p.structureOnly ? 3 : 4);
    let d = Z.startDraft(p);
    d = Z.applyHint(d, p, 'threading');
    assert.deepEqual(d.treadling, Z.startDraft(p).treadling);
    assert.ok(d.threading.every((s) => s !== null));
    d = Z.applyHint(d, p, 'tie-up');
    d = Z.applyHint(d, p, 'treadling');
    for (const st of stages.slice(3)) d = Z.applyHint(d, p, st);
    assert.ok(Z.isSolved(d, p), p.id);
  }
});

/* --------------------------------------------------------------- WIF */

test('WIF round trip keeps threading, tie-up, treadling, shed and colors', () => {
  for (const { id } of D.PRESETS) {
    const d = D.buildPreset(id);
    const text = W.writeWif(d, { title: id, date: 'Oct 1, 2026' });
    const back = W.parseWif(text);
    assert.deepEqual(back.warnings, [], id);
    assert.equal(back.title, id);
    const b = back.draft;
    assert.equal(b.shafts, d.shafts, id);
    assert.deepEqual(b.threading, d.threading, id);
    assert.deepEqual(b.treadling, d.treadling, id);
    assert.deepEqual(b.tieup, d.tieup.map((r) => r.slice(0, b.treadles)), id);
    assert.deepEqual(b.warpColors.map((c) => c.toLowerCase()), d.warpColors.map((c) => c.toLowerCase()), id);
    assert.deepEqual(b.weftColors.map((c) => c.toLowerCase()), d.weftColors.map((c) => c.toLowerCase()), id);
    assert.deepEqual(D.drawdown(b), D.drawdown(d), id);
  }
});

test('WIF writer uses the 1.1 layout with 1-based comma lists', () => {
  const d = D.buildPreset('twill22');
  const t = W.writeWif(d, {});
  for (const h of ['[WIF]', '[CONTENTS]', '[WEAVING]', '[WARP]', '[WEFT]', '[THREADING]', '[TIEUP]', '[TREADLING]', '[COLOR PALETTE]', '[COLOR TABLE]', '[WARP COLORS]', '[WEFT COLORS]']) {
    assert.ok(t.includes(h + '\n'), h);
  }
  assert.ok(t.includes('Version=1.1'));
  assert.ok(t.includes('Range=0,255'));
  assert.match(t, /\[THREADING\]\n1=1\n2=2\n3=3\n4=4\n5=1/);
  assert.match(t, /\[TIEUP\]\n1=1,2\n2=2,3\n3=3,4\n4=1,4\n/);
  assert.ok(!t.includes('[LIFTPLAN]'));
});

test('WIF round trip of a lift plan and a sinking shed', () => {
  let d = D.setShed(D.setMode(D.buildPreset('point'), 'liftplan'), 'sinking');
  d = D.toggleLift(d, 0, 3);
  const text = W.writeWif(d);
  assert.ok(text.includes('[LIFTPLAN]') && text.includes('Rising Shed=false') && !text.includes('[TIEUP]'));
  const b = W.parseWif(text).draft;
  assert.equal(b.mode, 'liftplan');
  assert.equal(b.shed, 'sinking');
  assert.deepEqual(b.liftplan, d.liftplan);
  assert.deepEqual(D.drawdown(b), D.drawdown(d));
});

const SAMPLE = `[WIF]
Version=1.1
Date=April 20, 1997
Developers=wif@mhsoft.com
Source Program=Hand-written sample
[CONTENTS]
COLOR PALETTE=yes
WEAVING=yes
WARP=yes
WEFT=yes
COLOR TABLE=yes
THREADING=yes
TIEUP=yes
TREADLING=yes
NOTES=yes
[NOTES]
1=Anything here is ignored.
[weaving]
Shafts=4
Treadles=4
Rising Shed=yes
Profile=false ; unknown keys are ignored
[WARP]
Threads=8
Color=1
Units=Centimeters
Spacing=0.1
[WEFT]
Threads=4
Color=2
[COLOR PALETTE]
Entries=2
Form=RGB
Range=0,999
[COLOR TABLE]
1=999,0,0
2=0,0,999 ; blue
[THREADING]
1=1
2=2
3=3
4=4
5=1
6=2
7=3
8=4
[TIEUP]
1=1,2
2=2,3
3=3,4
4=4,1
[TREADLING]
1=1
2=2
3=3
4=4
[WARP COLORS]
5=2
`;

test('a small hand-written WIF sample parses to a 2/2 twill with scaled colors', () => {
  const { draft, warnings } = W.parseWif(SAMPLE);
  assert.deepEqual(warnings, []);
  assert.equal(draft.shafts, 4);
  assert.equal(draft.threading.length, 8);
  assert.equal(draft.treadling.length, 4);
  assert.deepEqual(draft.threading, [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(draft.tieup.map((r) => r.map(Number).join('')), ['1001', '1100', '0110', '0011']);
  assert.equal(draft.shed, 'rising');
  assert.equal(draft.warpColors[0], '#ff0000'); // 999 of 999 -> 255
  assert.equal(draft.warpColors[4], '#0000ff'); // override from [WARP COLORS]
  assert.equal(draft.weftColors[0], '#0000ff');
  const dd = D.drawdown(draft);
  assert.equal(rowStr(dd[0]), '##..##..');
  assert.equal(rowStr(dd[1]), '.##..##.');
});

test('WIF with several treadles per pick becomes a lift plan; junk is rejected kindly', () => {
  const text = '[WEAVING]\nShafts=4\nTreadles=2\n[THREADING]\n1=1\n2=2\n[TIEUP]\n1=1\n2=2\n[TREADLING]\n1=1,2\n';
  const r = W.parseWif(text);
  assert.equal(r.draft.mode, 'liftplan');
  assert.deepEqual(r.draft.liftplan[0], [0, 1]);
  assert.equal(r.warnings.length, 1);
  assert.throws(() => W.parseWif('hello world'), /WIF/);
});

/* ---------------------------------------------- range edits & overlay */

test('repeat, mirror and shift a selected range', () => {
  let d = D.createDraft({ ends: 8, picks: 8 });
  d.threading = [0, 1, 2, null, null, null, null, null];
  const r = D.repeatRange(d, 'ends', 0, 2);
  assert.deepEqual(r.threading, [0, 1, 2, 0, 1, 2, 0, 1]);
  const m = D.mirrorRange(d, 'ends', 0, 2);
  assert.deepEqual(m.threading, [0, 1, 2, 1, 0, null, null, null]);
  const s = D.shiftRange(d, 'ends', 1, 2, 1);
  assert.deepEqual(s.threading.slice(0, 3), [0, 2, 3]);
  assert.deepEqual(D.shiftRange(d, 'ends', 2, 2, 2).threading[2], 0); // wraps at 4 shafts
  assert.deepEqual(d.threading.slice(0, 3), [0, 1, 2]); // immutable
  d.treadling = [0, 1, null, null, null, null, null, null];
  assert.deepEqual(D.repeatRange(d, 'picks', 0, 1).treadling, [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(D.mirrorRange(d, 'picks', 0, 1).treadling.slice(0, 3), [0, 1, 0]);
  assert.deepEqual(D.shiftRange(d, 'picks', 0, 1, -1).treadling.slice(0, 2), [5, 0]);
});

test('tromp as writ makes the treadling follow the threading', () => {
  let d = D.createDraft({ shafts: 4, treadles: 4, ends: 6, picks: 8 });
  d.threading = [0, 1, 2, 3, 2, 1];
  const t = D.trompAsWrit(d);
  assert.deepEqual(t.treadling, [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.deepEqual(t.liftplan[3], [3]);
  // with a straight tie-up that gives the straight draw's classic twill look
  for (let s = 0; s < 4; s++) { d.tieup[s][s] = true; d.tieup[(s + 1) % 4][s] = true; }
  const two = D.trompAsWrit({ ...d, threading: D.straightDraw(6, 4) });
  assert.deepEqual(two.treadling.slice(0, 5), [0, 1, 2, 3, 0]);
  const fewTreadles = D.trompAsWrit(D.createDraft({ shafts: 4, treadles: 2, ends: 4, picks: 4 }).threading.length ? { ...D.createDraft({ shafts: 4, treadles: 2, ends: 4, picks: 4 }), threading: [0, 1, 2, 3] } : null);
  assert.deepEqual(fewTreadles.treadling, [0, 1, null, null]);
});

test('floatCells marks only floats longer than the limit, on face or back', () => {
  const d = D.createDraft({ shafts: 4, treadles: 1, ends: 6, picks: 5 });
  d.threading = [0, 1, 1, 1, 1, 1];
  d.tieup[0][0] = true;
  d.treadling = [0, 0, 0, 0, 0];
  const f = D.floatCells(d, 3);
  // end 0 is warp on top for 5 picks; picks have weft over ends 1-5 (5 ends)
  assert.ok(f.every((row) => row[0]));
  assert.ok(f.every((row) => row.slice(1).every(Boolean)));
  assert.ok(D.floatCells(d, 5).flat().every((x) => !x));
  const plainOverlay = D.floatCells(plain(), 1);
  assert.ok(plainOverlay.flat().every((x) => !x));
  const back = D.floatCells(d, 3, 'back');
  assert.ok(back.flat().some(Boolean));
  assert.equal(D.floatCells(D.buildPreset('twill13'), 2).flat().some(Boolean), true);
  assert.equal(D.floatCells(D.buildPreset('twill22'), 2).flat().some(Boolean), false);
});

test('progress rescales so a blank draft reads 0, the solution 1, and a half-right draft in between', () => {
  for (const p of Z.PUZZLES) {
    const target = Z.targetOf(p);
    const o = { structureOnly: p.structureOnly };
    assert.equal(Z.progress(Z.startDraft(p), target, o), 0, p.id);
    assert.equal(Z.progress(p.solution(), target, o), 1, p.id);
  }
  const p = Z.getPuzzle('point');
  let d = Z.applyHint(Z.startDraft(p), p, 'threading');
  assert.equal(Z.progress(d, Z.targetOf(p)), 0); // threading alone weaves nothing yet
  d = Z.applyHint(d, p, 'tie-up');
  const half = Z.applyHint(d, p, 'treadling');
  half.treadling = half.treadling.map((t, i) => (i < 12 ? t : null));
  const v = Z.progress(half, Z.targetOf(p));
  assert.ok(v > 0 && v < 1, String(v));
});

/* ------------------------------------------------------------- tartan setts */
import * as T from '../loom/tartan.js';

test('tartan: a symmetric sett mirrors at its pivots and does not double them', () => {
  const p = T.parseSett('R/8 G24 K/4');
  assert.equal(p.pivots, true);
  assert.deepEqual(p.stripes.map((s) => [s.code, s.n]), [['R', 8], ['G', 24], ['K', 4]]);
  const seq = T.expandSett(p.stripes, { symmetric: true });
  // R8 G24 K4 G24 -> 60 threads; the R and K pivots appear once per sett
  assert.equal(seq.length, 8 + 24 + 4 + 24);
  const runs = [];
  for (const c of seq) { if (runs.length && runs[runs.length - 1][0] === c) runs[runs.length - 1][1]++; else runs.push([c, 1]); }
  assert.deepEqual(runs, [['R', 8], ['G', 24], ['K', 4], ['G', 24]]);
  assert.equal(T.settThreads(p.stripes, { symmetric: true }), 60);
});

test('tartan: an asymmetric sett repeats exactly as written', () => {
  const p = T.parseSett('W10 R2 W10 G2');
  assert.equal(p.pivots, false);
  const seq = T.expandSett(p.stripes, { symmetric: false });
  assert.equal(seq.length, 24);
  const r = T.tartanDraft('W10 R2 W10 G2', { symmetric: false, repeats: 3 });
  assert.ok(r.ok);
  assert.equal(r.ends, 72);
  // the overchecks alternate red, green, red, green across repeats
  const over = [];
  r.draft.warpColors.forEach((c, i) => { if (c !== r.draft.warpColors[i - 1] && c !== T.TARTAN_COLORS.W.hex) over.push(c); });
  assert.deepEqual(over, [T.TARTAN_COLORS.R.hex, T.TARTAN_COLORS.G.hex, T.TARTAN_COLORS.R.hex, T.TARTAN_COLORS.G.hex, T.TARTAN_COLORS.R.hex, T.TARTAN_COLORS.G.hex]);
});

test('tartan: unknown letters and junk are handled gently', () => {
  const p = T.parseSett('R/8 XQ4 hello G12, k/4');
  assert.deepEqual(p.stripes.map((s) => s.code), ['R', 'XQ', 'G', 'K']);
  assert.deepEqual(p.unknown, ['XQ']);
  assert.ok(p.warnings.some((w) => w.includes('hello')));
  assert.ok(p.warnings.some((w) => w.includes('XQ')));
  const r = T.tartanDraft('R/8 XQ4 G12 K/4');
  assert.ok(r.ok);
  assert.ok(r.draft.warpColors.includes(T.UNKNOWN_HEX));
  // and she can dye the unknown letter
  const r2 = T.tartanDraft('R/8 XQ4 G12 K/4', { colors: { XQ: '#C2507A' } });
  assert.ok(!r2.draft.warpColors.includes(T.UNKNOWN_HEX));
  assert.ok(r2.draft.warpColors.includes('#C2507A'));
  assert.equal(T.tartanDraft('').ok, false);
  assert.equal(T.parseSett('nonsense only').stripes.length, 0);
  // codes are case-insensitive, two-letter shades included
  assert.deepEqual(T.parseSett('db4 Az2 ly/6').stripes.map((s) => s.code), ['DB', 'Az', 'LY']);
});

test('tartan: library thread counts match the totals their sources state', () => {
  for (const t of T.TARTANS) {
    const p = T.parseSett(t.sett);
    assert.equal(p.warnings.length, 0, `${t.name}: ${p.warnings.join(' ')}`);
    assert.equal(p.unknown.length, 0, t.name);
    if (t.total) assert.equal(T.settThreads(p.stripes, { symmetric: !t.asymmetric }), t.total, t.name);
  }
  // Royal Stewart, stated as 212 threads in the full sett
  const rs = T.getTartan('royal-stewart');
  assert.equal(T.expandSett(T.parseSett(rs.sett).stripes, { symmetric: true }).length, 212);
});

test('tartan: warp and weft carry the same colour sequence in 2/2 twill, sized to whole repeats', () => {
  const r = T.tartanDraft(T.getTartan('royal-stewart').sett, { scale: 'half' });
  assert.ok(r.ok);
  assert.deepEqual(r.draft.warpColors, r.draft.weftColors);
  assert.equal(r.ends % r.settLen, 0);
  assert.equal(r.draft.threading.length, r.ends);
  assert.equal(r.draft.treadling.length, r.ends);
  assert.ok(r.ends <= 200);
  // straight draw and the 2/2 tie-up: every pick lifts exactly two adjacent shafts
  assert.deepEqual(r.draft.threading.slice(0, 8), [0, 1, 2, 3, 0, 1, 2, 3]);
  for (let t = 0; t < 4; t++) assert.equal(r.draft.tieup.filter((row) => row[t]).length, 2);
  const f = D.floats(r.draft);
  assert.equal(f.warp, 2);
  assert.equal(f.weft, 2);
  // the full Royal Stewart sett (212) is wider than the loom: refused kindly, with a reason
  const full = T.tartanDraft(T.getTartan('royal-stewart').sett, { scale: 'full' });
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'too-wide');
  assert.equal(T.defaultScale(T.parseSett('K/8 R/8').stripes, true), 'full');
  assert.equal(T.repeatsToFit(16), 8);
  assert.equal(T.repeatsToFit(250), 0);
});
