import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/color.js';

const HEX_RE = /^#[0-9a-f]{6}$/;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${a} ≈ ${b} (±${eps})`);

// Deterministic RNG (mulberry32) for reproducible tests.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('hex parsing and round trips', () => {
  assert.deepEqual(C.hexToRgb('#3e6a9e'), { r: 0x3e, g: 0x6a, b: 0x9e });
  assert.deepEqual(C.hexToRgb('#fA0'), { r: 255, g: 170, b: 0 });
  assert.equal(C.rgbToHex({ r: 300, g: -4, b: 127.6 }), '#ff0080');
  for (const h of ['#000000', '#ffffff', '#3e6a9e', '#d39b2a', '#b8433a', C.WHITE, C.BLACK]) {
    assert.equal(C.rgbToHex(C.hexToRgb(h)), h);
    assert.equal(C.oklchToHex(C.hexToOklch(h)), h, `oklab round trip ${h}`);
  }
  assert.throws(() => C.hexToRgb('#12345'), TypeError);
});

test('sRGB transfer functions invert each other', () => {
  for (const v of [0, 0.01, 0.04045, 0.2, 0.5, 0.9, 1]) near(C.linearToSrgb(C.srgbToLinear(v)), v, 1e-6); // standard sRGB constants are ~3e-8 discontinuous at the knee
});

test('known OKLab values', () => {
  const w = C.rgbToOklab({ r: 255, g: 255, b: 255 });
  near(w.L, 1, 1e-3, 'white L');
  near(w.a, 0, 1e-3, 'white a');
  near(w.b, 0, 1e-3, 'white b');
  const k = C.rgbToOklab({ r: 0, g: 0, b: 0 });
  near(k.L, 0, 1e-6, 'black L');
  const red = C.rgbToOklab({ r: 255, g: 0, b: 0 });
  near(red.L, 0.628, 2e-3, 'red L');
  near(red.a, 0.2249, 2e-3, 'red a');
  near(red.b, 0.1258, 2e-3, 'red b');
  assert.deepEqual(C.oklabToRgb(C.rgbToOklab({ r: 62, g: 106, b: 158 })), { r: 62, g: 106, b: 158 });
});

test('OKLCH round trip', () => {
  const lab = C.rgbToOklab(C.hexToRgb('#3e6a9e'));
  const lch = C.oklabToOklch(lab);
  assert.ok(lch.h >= 0 && lch.h < 360);
  const back = C.oklchToOklab(lch);
  near(back.L, lab.L, 1e-12);
  near(back.a, lab.a, 1e-12);
  near(back.b, lab.b, 1e-12);
  // Negative a/b gives a hue in [0, 360).
  const h = C.oklabToOklch({ L: 0.5, a: -0.1, b: -0.1 }).h;
  near(h, 225, 1e-9);
});

test('deltaE is zero on identity, symmetric, and scaled by 100', () => {
  assert.equal(C.deltaEHex('#3e6a9e', '#3e6a9e'), 0);
  const ab = C.deltaEHex('#3e6a9e', '#d39b2a');
  near(ab, C.deltaEHex('#d39b2a', '#3e6a9e'), 1e-12);
  near(C.deltaEHex('#000000', '#ffffff'), 100, 0.1, 'black-white ΔE ~100');
  near(C.deltaE({ L: 0.5, a: 0, b: 0 }, { L: 0.5, a: 0.03, b: 0.04 }), 5, 1e-9);
});

test('mixPaint: blue + yellow makes green', () => {
  const mix = C.mixPaintHex([{ hex: '#3e6a9e', weight: 1 }, { hex: '#d39b2a', weight: 1 }]);
  assert.match(mix, HEX_RE);
  const { h } = C.hexToOklch(mix);
  assert.ok(C.hueFamily(mix) === 'green' || (h > 90 && h < 170), `got ${mix} hue ${h}`);
});

test('mixPaint: black darkens strongly, same color is identity, weights matter', () => {
  const blue = '#3e6a9e';
  const L0 = C.hexToOklch(blue).L;
  const L1 = C.hexToOklch(C.mixPaintHex([{ hex: blue, weight: 1 }, { hex: C.BLACK, weight: 1 }])).L;
  assert.ok(L0 - L1 > 0.15, `L dropped only ${L0 - L1}`);
  assert.equal(C.mixPaintHex([{ hex: blue, weight: 2 }, { hex: blue, weight: 5 }]), blue);
  const mostlyWhite = C.mixPaintHex([{ hex: blue, weight: 1 }, { hex: C.WHITE, weight: 9 }]);
  assert.ok(C.deltaEHex(mostlyWhite, C.WHITE) < C.deltaEHex(mostlyWhite, blue));
  assert.throws(() => C.mixPaint([]), RangeError);
});

test('mixAdditive: identity for one color, brightens distinct mixes', () => {
  assert.equal(C.rgbToHex(C.mixAdditive([{ hex: '#b8433a', weight: 1 }, { hex: '#b8433a', weight: 3 }])), '#b8433a');
  const a = '#3e6a9e', b = '#d39b2a';
  const add = C.rgbToHex(C.mixAdditive([{ hex: a, weight: 1 }, { hex: b, weight: 1 }]));
  const paint = C.mixPaintHex([{ hex: a, weight: 1 }, { hex: b, weight: 1 }]);
  assert.ok(C.hexToOklch(add).L > C.hexToOklch(paint).L);
});

test('clampToGamut always returns an in-gamut color with same L and h', () => {
  const r = rng(7);
  for (let i = 0; i < 200; i++) {
    const lch = { L: r(), C: r() * 0.5, h: r() * 360 };
    const out = C.clampToGamut(lch);
    assert.ok(C.inGamut(out), JSON.stringify(out));
    near(out.L, lch.L, 1e-12);
    assert.equal(out.h, lch.h);
    assert.ok(out.C <= lch.C);
  }
  assert.equal(C.inGamut({ L: 0.7, C: 0.4, h: 140 }), false);
  assert.ok(C.inGamut(C.hexToOklch('#3e6a9e')));
});

test('gradients have the right length and valid hex', () => {
  const g = C.gradientOklab({ tl: '#e9c46a', tr: '#d98a8f', bl: '#2f8a8a', br: '#3e4e8c' }, 4, 5);
  assert.equal(g.length, 20);
  for (const h of g) assert.match(h, HEX_RE);
  assert.equal(g[0], '#e9c46a');
  assert.equal(g[3], '#d98a8f');
  assert.equal(g[16], '#2f8a8a');
  assert.equal(g[19], '#3e4e8c');
  const wide = C.gradientOklab({ tl: '#ff0000', tr: '#00ff00', bl: '#0000ff', br: '#ffff00' }, 9, 12);
  assert.equal(wide.length, 108);
  for (const h of wide) assert.match(h, HEX_RE);
  const line = C.gradient1D('#000000', '#ffffff', 7);
  assert.equal(line.length, 7);
  assert.equal(line[0], '#000000');
  assert.equal(line[6], '#ffffff');
  for (let i = 1; i < line.length; i++) assert.ok(C.hexToOklch(line[i]).L > C.hexToOklch(line[i - 1]).L);
});

test('noteHz is monotonic in lightness and on the pentatonic ladder', () => {
  assert.deepEqual(C.PENTATONIC, [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26]);
  let prev = -Infinity;
  for (let L = 0; L <= 1.0001; L += 0.01) {
    const hz = C.noteHz(L);
    assert.ok(hz >= prev, `noteHz not monotonic at L=${L}`);
    prev = hz;
  }
  assert.equal(C.noteIndexForLightness(0.1), 0);
  assert.equal(C.noteIndexForLightness(0.99), 11);
  assert.equal(C.noteIndexForLightness(0.55, 5), 2);
  near(C.noteHz(0), 196, 1e-9);
  near(C.noteHz(1), 196 * Math.pow(2, 26 / 12), 1e-9);
  assert.ok(C.noteHz(0.9) > C.noteHz(0.3));
});

test('hueFamily on obvious colors', () => {
  const cases = {
    '#e03030': 'red', '#b8433a': 'red', '#ff8800': 'orange', '#ffe600': 'yellow', '#d39b2a': 'yellow',
    '#2e9e3e': 'green', '#1f8f8f': 'teal', '#2050d0': 'blue', '#7a3fd0': 'violet', '#ff69b4': 'pink',
    '#808080': 'neutral', '#ffffff': 'neutral', [C.BLACK]: 'neutral',
  };
  for (const [hex, fam] of Object.entries(cases)) assert.equal(C.hueFamily(hex), fam, hex);
  assert.deepEqual(C.HUE_FAMILIES, ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral']);
});

test('text contrast helpers', () => {
  near(C.relativeLuminance('#ffffff'), 1, 1e-9);
  near(C.relativeLuminance('#000000'), 0, 1e-9);
  assert.equal(C.textColorOn('#f4f1e8'), '#2a2622');
  assert.equal(C.textColorOn('#1b1917'), '#f7f4ec');
  assert.equal(C.textColorOn('#3e4e8c'), '#f7f4ec');
});

test('randomHexNear stays close and is deterministic per rng', () => {
  const r = rng(42);
  for (let i = 0; i < 100; i++) {
    const h = C.randomHexNear('#3e6a9e', 6, r);
    assert.match(h, HEX_RE);
    assert.ok(C.deltaEHex(h, '#3e6a9e') <= 6.5, `${h} too far`);
  }
  assert.equal(C.randomHexNear('#d39b2a', 5, rng(1)), C.randomHexNear('#d39b2a', 5, rng(1)));
  assert.equal(C.randomHexNear('#d39b2a', 0, rng(1)), '#d39b2a');
});

import { dialRamp, mixOklab, rgbToOklab as _lab, hexToRgb as _rgb } from '../src/color.js';

test('dialRamp: starts from whichever of ink or white contrasts more, always with room to spare', () => {
  assert.equal(dialRamp('#24385a').startsWith, 'white', 'a navy target starts from white');
  assert.equal(dialRamp('#2a2622').startsWith, 'white', 'an ink-colored target starts from white');
  assert.equal(dialRamp('#efebe0').startsWith, 'ink', 'a pale target starts from ink');
  assert.equal(dialRamp('#de7a2e').startsWith, 'ink');
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 500; i++) {
    const hex = '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
    const r = dialRamp(hex);
    assert.ok(r.contrast >= 0.36, `${hex} contrast ${r.contrast}`);
    assert.equal(r.end, hex);
  }
});

test('mixOklab hits both ends and stays valid', () => {
  assert.equal(mixOklab('#2a2622', '#de7a2e', 0), '#2a2622');
  assert.equal(mixOklab('#2a2622', '#de7a2e', 1), '#de7a2e');
  assert.match(mixOklab('#ffffff', '#3e6a9e', 0.5), /^#[0-9a-f]{6}$/);
});
