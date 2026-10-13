// Unit tests for the Dye Studio prototype (proto/dye/*.js) and the shared fabric modules
// (proto/fabric/textures.js, stash.js). Pure modules only; small grids so it stays fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPiece, applyOp, replay, resistMap, composite, mixSubtractive, dyeAbsorb, makeName, dominantColor, mainDyes,
  iceComponents, tileInfo, POTS, R, clonePiece, packOps, unpackOps, nextSteps,
} from '../dye/dyecore.js';
import { weaveField, shadeCloth, absorbOf, hexRgb, BASES, DYES, PRINTS, mulberry32, noiseField } from '../fabric/textures.js';

const N = 96;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const hex = (h) => hexRgb(h);

// ------------------------------------------------------------------ color
test('subtractive mixing: weld over woad makes green, and nothing gets lighter', () => {
  const g = hex(mixSubtractive([{ hex: '#E3C65A' }, { hex: '#3E6A9E' }]));
  assert.ok(g[1] > g[0] && g[1] > g[2], `weld + woad should be greenish, got ${g}`);
  for (const a of POTS) for (const b of POTS) {
    const one = hex(mixSubtractive([{ hex: a.hex }]));
    const two = hex(mixSubtractive([{ hex: a.hex }, { hex: b.hex, s: 0.5 }]));
    for (let k = 0; k < 3; k++) assert.ok(two[k] <= one[k], `${a.id} + ${b.id} lighter in channel ${k}`);
  }
});

test('overdyeing a piece only ever darkens every pixel', () => {
  const p = createPiece('quilting-cotton', 2, N);
  applyOp(p, { t: 'dip', dye: 'weld', s: 0.8, mottle: 0.5, seed: 1 });
  const wf = weaveField('quilting-cotton', N, 1);
  const before = composite(new Uint8ClampedArray(N * N * 4), p, wf);
  applyOp(p, { t: 'dip', dye: 'madder', s: 0.6, mottle: 0.5, seed: 2 });
  const after = composite(new Uint8ClampedArray(N * N * 4), p, wf);
  for (let i = 0; i < before.length; i += 4) for (let k = 0; k < 3; k++) assert.ok(after[i + k] <= before[i + k], `pixel ${i / 4} got lighter`);
  assert.ok(mean(Array.from(after.filter((_, i) => i % 4 === 0))) < mean(Array.from(before.filter((_, i) => i % 4 === 0))));
});

test('a uniform weave tile averages to the requested color', () => {
  for (const b of BASES) {
    if (b.id === 'chambray' || b.id === 'shot-cotton' || b.id === 'voile' || b.id === 'flannel') continue; // these shift color on purpose
    const wf = weaveField(b.id, 64, 3);
    const out = shadeCloth(new Uint8ClampedArray(64 * 64 * 4), 64, wf, { uniform: absorbOf('#3E6A9E') });
    const m = [0, 1, 2].map((k) => mean(Array.from(out.filter((_, i) => i % 4 === k))));
    const want = hex('#3E6A9E');
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(m[k] - want[k]) < 9, `${b.id} channel ${k}: ${m[k]} vs ${want[k]}`);
  }
});

test('weave fields are deterministic and normalised; noise fields tile', () => {
  const a = weaveField('linen', 48, 5), b = weaveField('linen', 48, 5);
  assert.equal(a, b, 'cached');
  assert.ok(Math.abs(mean(Array.from(a.lum)) - 1) < 0.03);
  const n = noiseField(32, 4, 7, 3);
  // periodic: the first column continues from the last one
  let d = 0;
  for (let y = 0; y < 32; y++) d += Math.abs(n[y * 32] - n[y * 32 + 31]);
  assert.ok(d / 32 < 0.08, 'noise wraps around');
});

// ------------------------------------------------------------------ wax
test('wax fully resists dye, then releases after boiling', () => {
  const p = createPiece('batik-cotton', 1, N);
  applyOp(p, { t: 'wax', tool: 'tjanting', pts: [0.1, 0.5, 0.9, 0.5], r: 0.03, seed: 1 });
  const at = (x, y) => Math.round(y * N) * N + Math.round(x * N);
  const onWax = at(0.5, 0.5), off = at(0.5, 0.15);
  assert.ok(p.wax[onWax] > 0.5 && p.wax[off] === 0);
  assert.ok(resistMap(p)[onWax] > 0.95);
  applyOp(p, { t: 'dip', dye: 'indigo', s: 1, seed: 1 });
  const ind = dyeAbsorb('indigo');
  assert.ok(p.A[onWax * 3] < ind[0] * 0.05, 'no dye under wax');
  assert.ok(p.A[off * 3] > ind[0] * 0.6, 'dye off the wax');
  applyOp(p, { t: 'boil' });
  assert.equal(p.wax.reduce((s, v) => s + v, 0), 0);
  assert.ok(resistMap(p)[onWax] === 0);
  const before = p.A[onWax * 3];
  applyOp(p, { t: 'dip', dye: 'madder', s: 1, seed: 2 });
  assert.ok(p.A[onWax * 3 + 1] > before + 0.3, 'after boiling the cloth takes dye again');
});

test('crackle lets a little dye into the waxed area, only through the veins', () => {
  const run = (crack) => {
    const p = createPiece('batik-cotton', 1, N);
    applyOp(p, { t: 'wax', tool: 'brush', pts: [0.1, 0.5, 0.9, 0.5], r: 0.2, seed: 1 });
    if (crack) applyOp(p, { t: 'crackle', seed: 4 });
    applyOp(p, { t: 'dip', dye: 'indigo', s: 1, seed: 1 });
    let waxed = 0, n = 0;
    for (let i = 0; i < N * N; i++) if (p.wax[i] > 0.6) { waxed += p.A[i * 3]; n++; }
    return { p, mean: waxed / n };
  };
  const plain = run(false), cracked = run(true);
  assert.ok(cracked.mean > plain.mean * 1.5 + 0.01, `${cracked.mean} vs ${plain.mean}`);
  assert.ok(cracked.p.veins.some((v) => v > 0.5));
  const outside = cracked.p.veins.filter((v, i) => v > 0 && cracked.p.wax[i] === 0).length;
  assert.equal(outside, 0, 'veins only form in wax');
});

test('an incremental wax stroke matches the stroke replayed in one go', () => {
  const pts = [0.1, 0.2, 0.3, 0.25, 0.5, 0.4, 0.7, 0.42];
  const a = createPiece('linen', 1, N), b = createPiece('linen', 1, N);
  applyOp(a, { t: 'wax', tool: 'tjanting', pts, r: 0.01, seed: 3 });
  for (let i = 1; i <= 4; i++) applyOp(b, { t: 'wax', tool: 'tjanting', pts: pts.slice(0, i * 2), r: 0.01, seed: 3, from: i - 1 });
  let diff = 0;
  for (let i = 0; i < N * N; i++) diff = Math.max(diff, Math.abs(a.wax[i] - b.wax[i]));
  assert.ok(diff < 1e-6);
});

// ------------------------------------------------------------------ resist patterns
const COVER = {
  itajime: [0.12, 0.6], arashi: [0.08, 0.6], kumo: [0.12, 0.7], mokume: [0.1, 0.6],
};
for (const s of R.SHIBORI) {
  test(`shibori ${s.id}: deterministic and sensible coverage`, () => {
    const a = R.shibori(s.id, N, {}, 7).resist, b = R.shibori(s.id, N, {}, 7).resist, c = R.shibori(s.id, N, {}, 8).resist;
    assert.deepEqual(a, b);
    if (s.id !== 'itajime') assert.notDeepEqual(a, c); // itajime is mostly geometry
    const m = mean(Array.from(a));
    const [lo, hi] = COVER[s.id];
    assert.ok(m > lo && m < hi, `${s.id} coverage ${m.toFixed(3)}`);
    assert.ok(a.every((v) => v >= -0.4 && v <= 1));
  });
}
test('itajime options change the pattern', () => {
  const circle = R.itajime(N, { clamp: 'circle' }, 1).resist, bars = R.itajime(N, { clamp: 'bars' }, 1).resist, tri = R.itajime(N, { fold: 'triangle' }, 1).resist;
  assert.notDeepEqual(circle, bars);
  assert.notDeepEqual(circle, tri);
});

test('tie-dye folds: deterministic, coords in range, section weights cover the cloth', () => {
  for (const k of R.TIES) {
    const g = R.tie(k.id, N, { n: 4 }, 3), h = R.tie(k.id, N, { n: 4 }, 3);
    assert.deepEqual(g.resist, h.resist);
    assert.ok(g.coord.every((c) => c >= 0 && c <= 1));
    const m = mean(Array.from(g.resist));
    assert.ok(m > 0.03 && m < 0.6, `${k.id} resist ${m}`);
    for (let p = 0; p < N * N; p += 37) {
      let sum = 0;
      for (let s = 0; s < 4; s++) sum += R.sectionWeight(g.coord[p], s, 4, g.circular);
      assert.ok(sum > 0.6 && sum < 1.6, `${k.id} weights ${sum}`);
    }
  }
});

test('squirting dye lands mostly in its own section', () => {
  const p = createPiece('quilting-cotton', 1, N);
  applyOp(p, { t: 'bind', kind: 'tie-spiral', opts: { n: 4 }, seed: 2 });
  applyOp(p, { t: 'squirt', k: 1, dye: 'woad', s: 1, seed: 1 });
  let inS = 0, out = 0;
  for (let i = 0; i < N * N; i++) {
    const w = R.sectionWeight(p.bind.coord[i], 1, 4, true);
    if (w > 0.9) inS += p.A[i * 3]; else if (w < 0.1) out += p.A[i * 3];
  }
  assert.ok(inS > out * 5);
});

test('ice dye: deterministic blooms, powder splits into several colors', () => {
  const comps = iceComponents('#5B3B6E');
  assert.ok(comps.length >= 2 && new Set(comps.map((c) => c.hex)).size === comps.length);
  assert.equal(iceComponents('#2E2B28').length, 3, 'dark neutrals split too');
  const ab = comps.map((c) => ({ a: absorbOf(c.hex), w: c.w }));
  const a = R.iceBloom(N, 40, 40, ab, 1, 5, null), b = R.iceBloom(N, 40, 40, ab, 1, 5, null);
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 0));
  assert.ok(a.some((v) => v > 0.3));
});

test('carved blocks print an imperfect impression of the motif', () => {
  for (const b of R.BLOCKS) {
    const m = R.blockMask(b.id, 96);
    const cover = mean(Array.from(m));
    assert.ok(cover > 0.12 && cover < 0.75, `${b.id} cover ${cover}`);
    const ink = R.inkImpression(m, 96, 3);
    assert.ok(ink.some((v, i) => m[i] > 0.9 && v < 0.5 * m[i]), `${b.id} has some bare specks`);
    assert.ok(ink.every((v, i) => m[i] > 0.001 || v === 0), 'no ink off the block');
  }
  assert.equal(R.repeatGrid(0.25, 'grid').length, 16);
  assert.ok(R.repeatGrid(0.25, 'halfdrop').some(([, y]) => Math.abs(y - 0.25) < 1e-9));
});

test('replay is deterministic, so undo can rebuild a piece exactly', () => {
  const ops = [
    { t: 'wax', tool: 'tjanting', pts: [0.2, 0.2, 0.8, 0.7], r: 0.01, seed: 1 },
    { t: 'tjap', block: 'kawung', x: 0.5, y: 0.5, size: 0.3, seed: 2 },
    { t: 'dip', dye: 'ochre', s: 0.7, mottle: 0.3, seed: 3 },
    { t: 'crackle', seed: 4 },
    { t: 'dip', dye: 'walnut', s: 0.9, depth: 0.6, lift: true, seed: 5 },
    { t: 'boil' },
    { t: 'stamp', block: 'leaf', x: 0.3, y: 0.3, size: 0.25, dye: 'indigo', seed: 6 },
  ];
  const a = replay('linen', 4, ops, 64), b = replay('linen', 4, ops, 64);
  assert.deepEqual(a.A, b.A);
  assert.deepEqual(mainDyes(a), ['ochre', 'walnut', 'indigo']);
});

// ------------------------------------------------------------------ names and results
test('names read like a dyer would say them', () => {
  assert.equal(makeName({ kind: 'shibori', base: 'quilting-cotton', dyes: ['indigo'], shibori: 'kumo' }), 'Indigo kumo shibori');
  assert.equal(makeName({ kind: 'batik', base: 'batik-cotton', dyes: ['madder', 'walnut'] }), 'Madder and walnut batik');
  assert.equal(makeName({ kind: 'batik', base: 'batik-cotton', dyes: ['weld', 'madder', 'indigo'], crackle: true }), 'Weld, madder and indigo crackle batik');
  assert.equal(makeName({ kind: 'solid', base: 'linen', dyes: ['sage'] }), 'Sage linen');
  assert.equal(makeName({ kind: 'solid', base: 'quilting-cotton', dyes: [] }), 'Undyed cotton');
  assert.equal(makeName({ kind: 'block', base: 'linen', dyes: ['walnut'], block: 'leaf' }), 'Walnut leaf block print');
  assert.equal(makeName({ kind: 'tiedye', base: 'quilting-cotton', dyes: ['cochineal', 'weld'], tie: 'spiral' }), 'Cochineal and weld spiral tie-dye');
  assert.equal(makeName({ kind: 'marbled', base: 'quilting-cotton', dyes: ['woad', 'madder'] }), 'Woad and madder marbled cotton');
  assert.equal(makeName({ kind: 'ice', base: 'quilting-cotton', dyes: ['logwood'] }), 'Logwood ice dye');
  assert.equal(makeName({ kind: 'ombre', base: 'voile', dyes: ['cochineal'] }), 'Cochineal ombré voile');
  const taken = ['Indigo kumo shibori', 'Indigo kumo shibori no. 2'];
  assert.equal(makeName({ kind: 'shibori', base: 'quilting-cotton', dyes: ['indigo'], shibori: 'kumo' }, taken), 'Indigo kumo shibori no. 3');
});

test('dominant color picks the most common color, not the average', () => {
  const px = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) { const c = i < 70 ? [44, 62, 102] : [250, 250, 250]; px.set([...c, 255], i * 4); }
  assert.equal(dominantColor(px, 1), '#2C3E66');
});

test('tiles: solids and block prints repeat, one-off pieces do not', () => {
  assert.deepEqual(tileInfo('solid'), { repeat: true, inches: 8 });
  assert.equal(tileInfo('block').repeat, true);
  for (const k of ['batik', 'shibori', 'tiedye', 'ice', 'marbled', 'ombre']) assert.equal(tileInfo(k).repeat, false);
});

test('the shared palettes keep their contract', () => {
  assert.equal(BASES.length, 7);
  assert.ok(DYES.every((d) => /^#[0-9A-F]{6}$/i.test(d.hex)));
  assert.ok(PRINTS.length >= 6);
  assert.equal(typeof mulberry32(1)(), 'number');
});

// ------------------------------------------------------------------ the stash contract
test('stash: add, get, rename, remove, and the cap on dyed fabrics', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const st = await import('../fabric/stash.js');
  const f = st.addFabric({ id: 'a', name: 'Indigo kumo shibori', base: 'quilting-cotton', kind: 'shibori', color: '#2C3E66', img: 'data:image/jpeg;base64,xx', inches: 8, repeat: false, createdAt: 1 });
  assert.equal(f.starter, false);
  assert.deepEqual(st.getFabric('a').colors, ['#2C3E66']);
  assert.equal(st.getFabric('a').repeat, false);
  st.renameFabric('a', 'Night sky');
  assert.equal(st.getFabric('a').name, 'Night sky');
  const raw = JSON.parse(mem.get(st.STASH_KEY));
  assert.equal(raw.v, 1);
  st.addFabric({ id: 's', name: 'Starter', base: 'linen', kind: 'solid', color: '#8A9A6B', starter: true });
  for (let i = 0; i < st.STASH_MAX + 5; i++) st.addFabric({ id: 'x' + i, name: 'n' + i, base: 'linen', kind: 'solid', color: '#000000' });
  const all = st.fabrics();
  assert.equal(all.filter((x) => !x.starter).length, st.STASH_MAX);
  assert.ok(st.getFabric('s'), 'starters are never pushed out');
  assert.equal(st.getFabric('a'), null, 'oldest dyed fabric made room');
  st.removeFabric('x10');
  assert.equal(st.getFabric('x10'), null);
  delete globalThis.localStorage;
});

// ------------------------------------------------------------------ undo checkpoints, saving, next step
test('a cloned piece is untouched by ops on the original (undo checkpoints)', () => {
  const p = createPiece('linen', 3, N);
  applyOp(p, { t: 'wax', tool: 'tjanting', pts: [0.2, 0.5, 0.8, 0.5], r: 0.01, seed: 2 });
  applyOp(p, { t: 'dip', dye: 'weld', s: 0.7, mottle: 0.2, seed: 1 });
  const c = clonePiece(p);
  const A = Float32Array.from(p.A), wax = Float32Array.from(p.wax), usage = JSON.stringify(p.usage);
  applyOp(p, { t: 'crackle', seed: 4 });
  applyOp(p, { t: 'dip', dye: 'indigo', s: 1, mottle: 0.2, seed: 2 });
  applyOp(p, { t: 'boil' });
  assert.deepEqual(c.A, A); assert.deepEqual(c.wax, wax); assert.equal(JSON.stringify(c.usage), usage);
  assert.equal(c.meta.crackle, false);
  // and carrying on from the clone gives what a replay gives
  applyOp(c, { t: 'dip', dye: 'madder', s: 0.5, mottle: 0.2, seed: 9 });
  const r = replay('linen', 3, [
    { t: 'wax', tool: 'tjanting', pts: [0.2, 0.5, 0.8, 0.5], r: 0.01, seed: 2 },
    { t: 'dip', dye: 'weld', s: 0.7, mottle: 0.2, seed: 1 },
    { t: 'dip', dye: 'madder', s: 0.5, mottle: 0.2, seed: 9 }], N);
  for (let i = 0; i < r.A.length; i++) assert.ok(Math.abs(r.A[i] - c.A[i]) < 1e-6, `A[${i}]`);
});

test('a bound piece clones with its own section colors', () => {
  const p = createPiece('quilting-cotton', 2, N);
  applyOp(p, { t: 'bind', kind: 'tie-spiral', opts: { n: 4 }, seed: 2 });
  const c = clonePiece(p);
  applyOp(p, { t: 'squirt', k: 1, dye: 'madder', s: 1, seed: 3 });
  assert.deepEqual(c.sectionA[1], [0, 0, 0]);
  assert.ok(p.sectionA[1].some((v) => v > 0));
});

test('ops survive the trip through sessionStorage', () => {
  const ops = [
    { t: 'wax', tool: 'tjanting', pts: [0.123456, 0.5, 0.876543, 0.51], r: 0.0046, seed: 2 },
    { t: 'dip', dye: 'weld', s: 0.7, mottle: 0.15, seed: 1 },
    { t: 'crackle', seed: 4 },
    { t: 'marble', delta: new Float32Array(12), dyes: ['madder'], bath: [{ color: '#B5482F', pts: [1, 2, 3, 4] }], mseed: 7, base: 'linen' },
  ];
  const back = unpackOps(JSON.parse(JSON.stringify(packOps(ops))));
  assert.equal(back.length, 4);
  assert.deepEqual(back[0].pts, [0.1235, 0.5, 0.8765, 0.51]);
  assert.deepEqual(back[1], ops[1]);
  assert.equal(back[3].delta, undefined, 'the big delta is rebuilt from the bath, not saved');
  assert.deepEqual(back[3].bath, ops[3].bath);
  assert.equal(ops[3].delta.length, 12, 'packing leaves the live op alone');
  assert.equal(unpackOps([{ t: 'nonsense' }]), null);
  assert.equal(unpackOps('x'), null);
  // rounding the wax path doesn't visibly move the wax
  const a = replay('batik-cotton', 1, ops.slice(0, 2), N), b = replay('batik-cotton', 1, back.slice(0, 2), N);
  let d = 0; for (let i = 0; i < a.wax.length; i++) d = Math.max(d, Math.abs(a.wax[i] - b.wax[i]));
  assert.ok(d < 0.05, `wax moved by ${d}`);
});

test('crackle is deterministic (and cached replays agree)', () => {
  const a = replay('batik-cotton', 1, [{ t: 'tjap', block: 'kawung', x: 0.5, y: 0.5, size: 0.8, seed: 1 }, { t: 'crackle', seed: 5 }], N);
  const b = replay('batik-cotton', 1, [{ t: 'tjap', block: 'kawung', x: 0.5, y: 0.5, size: 0.8, seed: 1 }, { t: 'crackle', seed: 5 }], N);
  assert.deepEqual(a.veins, b.veins);
  assert.ok(a.veins.some((v) => v > 0.5));
});

test('the next step follows the piece through every technique', () => {
  const n = (tech, ops, st) => { const r = nextSteps(tech, ops, st); return [r.steps.map((x) => `${x.n}${x.label[0]}`).join(' '), r.done]; };
  const wax = { t: 'wax' }, dip = { t: 'dip' };
  // batik: wax, dye, then boil (or another round, or crackle), then done
  assert.deepEqual(n('batik', []), ['2N', false]);
  assert.deepEqual(n('batik', [wax]), ['3N', false]);
  assert.deepEqual(n('batik', [wax, dip]), ['6N 4O 5O', false]);
  assert.deepEqual(n('batik', [wax, dip, { t: 'crackle' }]), ['3N', false], 'after crumpling, dye into the cracks');
  assert.deepEqual(n('batik', [wax, dip, wax]), ['3N', false], 'the second round');
  assert.deepEqual(n('batik', [wax, dip, { t: 'boil' }]), ['2M', true]);
  assert.deepEqual(n('batik', [{ t: 'tjap' }]), ['3N', false]);
  // solid and ombré
  assert.deepEqual(n('solid', []), ['2N', false]);
  assert.deepEqual(n('solid', [dip]), ['2M', true]);
  assert.deepEqual(n('ombre', [], { lineSet: false }), ['2N', false]);
  assert.deepEqual(n('ombre', [], { lineSet: true }), ['3N', false]);
  assert.deepEqual(n('ombre', [dip]), ['2M', true]);
  // shibori: bind, dip, open
  const bind = { t: 'bind', kind: 'kumo' }, unbind = { t: 'unbind' };
  assert.deepEqual(n('shibori', []), ['2N', false]);
  assert.deepEqual(n('shibori', [bind]), ['3N', false]);
  assert.deepEqual(n('shibori', [bind, dip]), ['4N 3O', false]);
  assert.deepEqual(n('shibori', [bind, dip, unbind]), ['2M', true]);
  // tie-dye and ice
  const tie = { t: 'bind', kind: 'tie-spiral' };
  assert.deepEqual(n('tiedye', [tie]), ['3N', false]);
  assert.deepEqual(n('tiedye', [tie, { t: 'squirt' }]), ['4N 3O', false]);
  assert.deepEqual(n('tiedye', [tie, { t: 'squirt' }, unbind]), ['2M', true]);
  assert.deepEqual(n('ice', [{ t: 'bind', kind: 'ice' }]), ['3N', false]);
  assert.deepEqual(n('ice', [{ t: 'bind', kind: 'ice' }, { t: 'ice' }]), ['4N 3O', false]);
  // marbling: float, lay, and the bath is ready for another layer
  assert.deepEqual(n('marbling', [], { bathOpen: true, bathInks: 0 }), ['2N', false]);
  assert.deepEqual(n('marbling', [], { bathOpen: true, bathInks: 3 }), ['3N 2O', false]);
  assert.deepEqual(n('marbling', [{ t: 'marble' }], { bathOpen: false, bathInks: 0 }), ['2M', true]);
  // block print
  assert.deepEqual(n('block', []), ['3N', false]);
  assert.deepEqual(n('block', [{ t: 'stamp' }]), ['3M', true]);
});
