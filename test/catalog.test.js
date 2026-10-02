import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mixPaintHex, deltaEHex, hueFamily, HUE_FAMILIES, WHITE, BLACK } from '../src/color.js';
import { PIGMENTS, DROPS, getPigment, pigmentHex } from '../src/content/pigments.js';
import {
  CATALOG, EVENT_COLORS, EVENT_IDS, PAGES, COLORS_BY_PAGE, EVENT_COLORS_BY_EVENT, TIER_PRICES,
  ERA1_MIN_DELTA_E, EVENT_MIN_DELTA_E, getColor, mixableColors, recipeParts,
} from '../src/content/catalog.js';

const HEX_RE = /^#[0-9a-f]{6}$/;
const WILD_IDS = [
  'meadow-green', 'clover-pink', 'honey-gold', 'slate-grey', 'umber-brown', 'ochre-rust', 'murex-purple', 'sea-glass',
  'harbor-teal', 'cochineal-red', 'parrot-green', 'orchid', 'lava-red', 'sulfur-yellow', 'obsidian', 'ash-grey',
];
const COMMISSION_IDS = [
  'lighthouse-white', 'stained-glass-ruby', 'bunting-red', 'deep-fathom', 'illuminated-gold', 'coronation-purple',
  'loom-thread', 'kiln-glaze', 'quilt-patchwork', 'atlas-ink', 'grand-spectrum',
];
const STARTER = new Set(['madder', 'ochre', 'woad', 'white', 'black']);
const EARTHY = new Set([...STARTER, 'umber', 'chalk-white', 'bone-black', 'sulfur', 'saffron']);

test('pigments: the twelve Era 1 pigments and two free drops', () => {
  const expect = {
    madder: '#b8433a', ochre: '#d39b2a', woad: '#3e6a9e', saffron: '#e8a63b', indigo: '#2e3f6e', murex: '#6e4a7e',
    lapis: '#2f4fb0', cochineal: '#c0233f', umber: '#6b4a2b', sulfur: '#d8c83a', 'bone-black': '#2b2b2e', 'chalk-white': '#efebe0',
  };
  assert.equal(PIGMENTS.length, 12);
  for (const p of PIGMENTS) {
    assert.equal(p.hex, expect[p.id], p.id);
    assert.equal(p.start, ['madder', 'ochre', 'woad'].includes(p.id), p.id);
    assert.equal(p.tier, 'primary');
    assert.equal(p.source, p.id);
    assert.ok(p.name && p.blurb, p.id);
  }
  assert.deepEqual(DROPS.map((d) => [d.id, d.hex]), [['white', WHITE], ['black', BLACK]]);
  assert.equal(getPigment('white').hex, WHITE);
  assert.equal(getPigment('nope'), undefined);
  assert.throws(() => pigmentHex('nope'), RangeError);
});

test('catalog: 100 Era 1 colors on five pages, 16 wild with the exact ids', () => {
  assert.equal(CATALOG.length, 100);
  assert.deepEqual([...PAGES], ['wheel', 'tints', 'shades', 'earths', 'wild']);
  assert.equal(PAGES.reduce((s, p) => s + COLORS_BY_PAGE[p].length, 0), 100);
  for (const p of PAGES) for (const c of COLORS_BY_PAGE[p]) assert.equal(c.page, p);
  const wild = COLORS_BY_PAGE.wild;
  assert.deepEqual(wild.map((c) => c.id).sort(), [...WILD_IDS].sort());
  const perRegion = {};
  for (const c of wild) {
    assert.equal(c.recipe, null);
    assert.equal(c.foundBy, 'hunt');
    assert.equal(c.tier, 'wild');
    assert.equal(c.basePrice, 60);
    assert.match(c.hint, /^a hunter's find on the [A-Z]/);
    perRegion[c.region] = (perRegion[c.region] || 0) + 1;
  }
  assert.deepEqual(perRegion, { meadow: 3, quarry: 3, coast: 3, jungle: 3, volcano: 4 });
  // Rough page sizes from the spec (wheel ~24, tints ~22, shades ~18, earths ~20).
  for (const [p, lo, hi] of [['wheel', 20, 26], ['tints', 18, 24], ['shades', 15, 20], ['earths', 18, 24]]) {
    const n = COLORS_BY_PAGE[p].length;
    assert.ok(n >= lo && n <= hi, `${p} has ${n}`);
  }
});

test('catalog: ids, names, hexes, families and prices are well formed', () => {
  const ids = new Set();
  const names = new Set();
  for (const c of [...CATALOG, ...EVENT_COLORS]) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(!names.has(c.name.toLowerCase()), `duplicate name ${c.name}`);
    names.add(c.name.toLowerCase());
    assert.ok(c.name.length >= 1 && c.name.length <= 24, c.name);
    assert.match(c.hex, HEX_RE);
    assert.equal(c.era, 1);
    assert.ok(HUE_FAMILIES.includes(c.family), c.id);
    assert.equal(c.family, hueFamily(c.hex), c.id);
    assert.equal(c.basePrice, TIER_PRICES[c.tier], c.id);
    assert.equal(typeof c.hint, 'string');
    assert.ok(c.hint.length > 0, c.id);
    assert.equal(getColor(c.id), c);
  }
  assert.deepEqual({ ...TIER_PRICES }, { primary: 1, secondary: 3, tertiary: 8, tint: 15, wild: 60 });
  assert.equal(getColor('no-such-color'), undefined);
});

test('catalog: guaranteed ids, starting primaries and secondaries', () => {
  for (const id of ['madder', 'ochre', 'woad']) {
    const c = getColor(id);
    assert.equal(c.page, 'wheel');
    assert.equal(c.tier, 'primary');
    assert.equal(c.foundBy, 'start');
    assert.deepEqual(c.recipe.map((p) => [p.pigment, p.weight]), [[id, 1]]);
    assert.equal(c.hex, getPigment(id).hex);
  }
  for (const id of ['orange', 'green', 'violet']) {
    const c = getColor(id);
    assert.equal(c.tier, 'secondary', id);
    assert.equal(c.basePrice, 3);
    assert.equal(c.foundBy, 'mix');
  }
  assert.equal(CATALOG.filter((c) => c.foundBy === 'start').length, 3);
});

test('catalog: every mixable hex equals mixPaintHex(recipe)', () => {
  const mixable = mixableColors();
  assert.equal(mixable.length, 84);
  for (const c of mixable) {
    assert.ok(Array.isArray(c.recipe) && c.recipe.length > 0, c.id);
    for (const p of c.recipe) {
      assert.ok(getPigment(p.pigment), `${c.id}: ${p.pigment}`);
      assert.ok(Number.isInteger(p.weight) && p.weight > 0, c.id);
    }
    assert.equal(c.hex, mixPaintHex(recipeParts(c.recipe)), c.id);
    assert.equal(c.hex, mixPaintHex(c.recipe.map((p) => ({ hex: pigmentHex(p.pigment), weight: p.weight }))), c.id);
  }
});

test('catalog: recipes only use pigments she can plausibly have on that page', () => {
  for (const c of mixableColors()) {
    if (c.foundBy === 'commission') continue;
    const allowed = c.page === 'earths' ? EARTHY : STARTER;
    for (const p of c.recipe) assert.ok(allowed.has(p.pigment), `${c.id} (${c.page}) uses ${p.pigment}`);
  }
  // Phase 1 can explore every wheel, tint and shade cell with her three
  // starting pigments plus the free drops.
  const phase1 = CATALOG.filter((c) => ['wheel', 'tints', 'shades'].includes(c.page) && c.foundBy !== 'commission');
  assert.ok(phase1.length >= 50, `${phase1.length}`);
  for (const c of COLORS_BY_PAGE.tints) if (c.foundBy !== 'commission') assert.ok(c.recipe.some((p) => p.pigment === 'white'), c.id);
  for (const c of COLORS_BY_PAGE.shades) if (c.foundBy !== 'commission') assert.ok(c.recipe.some((p) => p.pigment === 'black'), c.id);
});

test('catalog: Era 1 colors are pairwise at least ERA1_MIN_DELTA_E apart', () => {
  assert.equal(ERA1_MIN_DELTA_E, 5);
  for (let i = 0; i < CATALOG.length; i++) {
    for (let j = i + 1; j < CATALOG.length; j++) {
      const d = deltaEHex(CATALOG[i].hex, CATALOG[j].hex);
      assert.ok(d >= ERA1_MIN_DELTA_E, `${CATALOG[i].id} / ${CATALOG[j].id}: ΔE ${d.toFixed(2)}`);
    }
  }
});

test('catalog: tiers, foundBy and hints follow the page rules', () => {
  for (const c of [...COLORS_BY_PAGE.tints, ...COLORS_BY_PAGE.shades]) assert.equal(c.tier, 'tint', c.id);
  for (const c of COLORS_BY_PAGE.earths) assert.equal(c.tier, 'tertiary', c.id);
  for (const c of COLORS_BY_PAGE.wheel) assert.ok(['primary', 'secondary', 'tertiary'].includes(c.tier), c.id);
  const ts = [...COLORS_BY_PAGE.tints, ...COLORS_BY_PAGE.shades].filter((c) => c.foundBy !== 'commission');
  const graded = ts.filter((c) => c.foundBy === 'grade').length;
  assert.ok(graded >= ts.length * 0.4 && graded <= ts.length * 0.6, `${graded} of ${ts.length} graded`);
  for (const c of ts) assert.ok(['grade', 'mix'].includes(c.foundBy), c.id);
  for (const c of [...COLORS_BY_PAGE.wheel, ...COLORS_BY_PAGE.earths]) assert.ok(['start', 'mix', 'commission'].includes(c.foundBy), c.id);
  for (const id of COMMISSION_IDS) {
    const c = getColor(id);
    assert.ok(c, id);
    assert.equal(c.foundBy, 'commission', id);
    assert.ok(c.recipe, id);
    assert.equal(c.hint, "a commission's signature color");
  }
  assert.equal(CATALOG.filter((c) => c.foundBy === 'commission').length, COMMISSION_IDS.length);
  for (const c of CATALOG) {
    if (c.foundBy === 'mix') assert.equal(c.hint, 'found by mixing');
    if (c.foundBy === 'grade') assert.equal(c.hint, 'found by grading');
  }
});

test('catalog: 96 event colors, 12 per event, distinct within each page', () => {
  assert.equal(EVENT_COLORS.length, 96);
  assert.deepEqual([...EVENT_IDS], ['autumn-harvest', 'deep-sea', 'bloom-week', 'neon-night', 'winter-frost', 'festival-of-lanterns', 'golden-hour', 'ink-and-paper']);
  for (const e of EVENT_IDS) {
    const page = EVENT_COLORS_BY_EVENT[e];
    assert.equal(page.length, 12, e);
    assert.deepEqual(page.map((c) => c.id), Array.from({ length: 12 }, (_, i) => `${e}-${i + 1}`));
    for (const c of page) {
      assert.equal(c.page, 'event');
      assert.equal(c.event, e);
      assert.equal(c.tier, 'tint');
      assert.equal(c.basePrice, 15);
      assert.equal(c.foundBy, 'event');
      assert.equal(c.recipe, null);
    }
    for (let i = 0; i < 12; i++) {
      for (let j = i + 1; j < 12; j++) {
        const d = deltaEHex(page[i].hex, page[j].hex);
        assert.ok(d >= EVENT_MIN_DELTA_E, `${page[i].id} / ${page[j].id}: ΔE ${d.toFixed(2)}`);
      }
    }
  }
  assert.ok(!CATALOG.some((c) => c.page === 'event'));
});

test('catalog: data is frozen', () => {
  assert.ok(Object.isFrozen(CATALOG));
  assert.ok(Object.isFrozen(CATALOG[0]));
  assert.ok(Object.isFrozen(getColor('orange').recipe));
  assert.ok(Object.isFrozen(EVENT_COLORS[0]));
});

test('catalog: committed catalog.js matches tools/gen-catalog.js output', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const generated = execFileSync(process.execPath, ['tools/gen-catalog.js'], { cwd: root, encoding: 'utf8' });
  const committed = readFileSync(new URL('../src/content/catalog.js', import.meta.url), 'utf8');
  assert.equal(committed, generated, 'run: node tools/gen-catalog.js --write');
});
