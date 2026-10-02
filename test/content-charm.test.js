import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUE_FAMILIES } from '../src/color.js';
import { mulberry32 } from '../src/rng.js';
import { POSTCARDS, SET_SIZE, STAMPS, EVENT_REGIONS, getPostcard, cardsForRegion, cardsForEvent } from '../src/content/postcards.js';
import { CANVASES, getCanvas, starterCanvases } from '../src/content/canvases.js';
import {
  suggestName, isNameOk, CUSTOMER_NAMES, VISITOR_COMMENTS, COMMENT_PLACES, fillComment,
} from '../src/content/names.js';

const HEX_RE = /^#[0-9a-f]{6}$/;
const REGIONS = ['meadow', 'quarry', 'coast', 'jungle', 'volcano'];
const EVENTS = {
  'autumn-harvest': 'orchard', 'deep-sea': 'reef', 'bloom-week': 'garden', 'neon-night': 'night-market',
  'winter-frost': 'glacier-pass', 'festival-of-lanterns': 'lantern-bridge', 'golden-hour': 'hilltop', 'ink-and-paper': 'scriptorium',
};

// ---------------------------------------------------------------------------
// Postcards
// ---------------------------------------------------------------------------

test('postcards: 40 region cards and 64 event cards with the expected ids', () => {
  assert.equal(SET_SIZE, 8);
  assert.equal(POSTCARDS.length, 104);
  assert.deepEqual({ ...EVENT_REGIONS }, EVENTS);
  for (const r of REGIONS) {
    const set = cardsForRegion(r);
    assert.deepEqual(set.map((c) => c.id), Array.from({ length: 8 }, (_, i) => `${r}-${i + 1}`));
    for (const c of set) assert.equal(c.event, undefined);
  }
  for (const [e, region] of Object.entries(EVENTS)) {
    const set = cardsForEvent(e);
    assert.deepEqual(set.map((c) => c.id), Array.from({ length: 8 }, (_, i) => `${e}-${i + 1}`));
    assert.deepEqual(cardsForRegion(region), set);
    for (const c of set) assert.equal(c.region, region);
  }
  assert.equal(POSTCARDS.filter((c) => !c.event).length, 40);
  assert.equal(POSTCARDS.filter((c) => c.event).length, 64);
  assert.equal(getPostcard('coast-3').title, cardsForRegion('coast')[2].title);
  assert.equal(getPostcard('nope'), undefined);
});

test('postcards: every card is well formed and no two lines or titles repeat', () => {
  const ids = new Set();
  const lines = new Set();
  const titles = new Set();
  for (const c of POSTCARDS) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.ok(c.n >= 1 && c.n <= 8, c.id);
    assert.equal(c.rare, c.n === 8, c.id);
    assert.ok(typeof c.title === 'string' && c.title.length > 0 && c.title.length <= 28, c.id);
    assert.ok(!titles.has(c.title), `duplicate title ${c.title}`);
    titles.add(c.title);
    assert.equal(c.lines.length, 2, c.id);
    for (const l of c.lines) {
      assert.ok(typeof l === 'string' && l.length > 0 && l.length <= 90, `${c.id}: ${l}`);
      assert.ok(!lines.has(l), `duplicate line: ${l}`);
      lines.add(l);
    }
    for (const k of ['sky', 'land', 'accent']) assert.match(c.scene[k], HEX_RE, `${c.id} ${k}`);
    assert.ok(STAMPS.includes(c.stamp), `${c.id} stamp ${c.stamp}`);
    assert.ok(Object.isFrozen(c));
  }
  assert.equal(POSTCARDS.filter((c) => c.rare).length, 13);
});

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

const RANGES = {
  'harbor-window': [16, 16], 'tile-mosaic': [30, 30], 'painted-plate': [12, 12], 'patchwork-quilt': [40, 40],
  tapestry: [18, 18], 'botanical-print': [16, 16],
  'rose-window': [24, 24], 'map-tile': [20, 20], 'lantern-row': [15, 15], 'river-quilt': [30, 30], 'sunburst-plate': [16, 16],
  'meadow-window': [16, 24], 'quarry-mosaic': [16, 24], 'coast-window': [16, 24], 'jungle-print': [16, 24], 'volcano-plate': [16, 24],
  'grand-rotunda-window': [48, 48], 'heritage-tapestry': [60, 60],
};
const EVENT_CANVASES = {
  'autumn-harvest': ['harvest-window', 'leaf-mosaic'],
  'deep-sea': ['coral-window', 'pearl-plate'],
  'bloom-week': ['bouquet-quilt', 'trellis-print'],
  'neon-night': ['neon-sign-window', 'night-market-print'],
  'winter-frost': ['frost-window', 'snowflake-mosaic'],
  'festival-of-lanterns': ['lantern-plate', 'paper-lantern-tapestry'],
  'golden-hour': ['sunset-window', 'honey-hill-print'],
  'ink-and-paper': ['inkwell-plate', 'manuscript-print'],
};
const PATH_RE = /^M[\d\s.,MLHVAQZ-]+$/;

test('canvases: the full set with expected ids, unlocks and region counts', () => {
  assert.equal(CANVASES.length, 34);
  assert.equal(new Set(CANVASES.map((c) => c.id)).size, CANVASES.length);
  assert.deepEqual(starterCanvases().map((c) => c.id), ['harbor-window', 'tile-mosaic', 'painted-plate', 'patchwork-quilt', 'tapestry', 'botanical-print']);
  assert.deepEqual(['rose-window', 'map-tile', 'lantern-row', 'river-quilt', 'sunburst-plate'].map((id) => getCanvas(id).unlock),
    [20, 40, 60, 80, 100].map((n) => ({ type: 'milestone', n })));
  for (const r of REGIONS) {
    const c = CANVASES.find((x) => x.unlock.type === 'postcards' && x.unlock.region === r);
    assert.ok(c, `postcard canvas for ${r}`);
  }
  for (const [e, ids] of Object.entries(EVENT_CANVASES)) {
    for (const id of ids) {
      const c = getCanvas(id);
      assert.ok(c, id);
      assert.deepEqual({ ...c.unlock }, { type: 'event', id: e });
      assert.ok(c.regions.length >= 12 && c.regions.length <= 20, `${id}: ${c.regions.length}`);
    }
  }
  assert.equal(CANVASES.filter((c) => c.unlock.type === 'event').length, 16);
  for (const [id, [lo, hi]] of Object.entries(RANGES)) {
    const n = getCanvas(id).regions.length;
    assert.ok(n >= lo && n <= hi, `${id}: ${n} regions`);
  }
  assert.equal(getCanvas('grand-rotunda-window').unlock.type, 'heritage');
  assert.equal(getCanvas('heritage-tapestry').unlock.type, 'heritage');
  assert.equal(getCanvas('nope'), undefined);
});

test('canvases: regions are plain {id, d, size} with valid paths', () => {
  const kinds = ['window', 'mosaic', 'plate', 'quilt', 'tapestry', 'print'];
  const frames = ['window', 'tile', 'plate', 'quilt', 'tapestry', 'print'];
  for (const c of CANVASES) {
    assert.equal(c.viewBox, '0 0 300 400');
    assert.ok(kinds.includes(c.kind), c.id);
    assert.ok(frames.includes(c.frame), c.id);
    assert.ok(typeof c.name === 'string' && c.name.length > 0);
    assert.ok(c.regions.length >= 12 && c.regions.length <= 60, `${c.id}: ${c.regions.length}`);
    const ids = new Set();
    c.regions.forEach((r, i) => {
      assert.deepEqual(Object.keys(r).sort(), ['d', 'id', 'size']);
      assert.equal(r.id, 'r' + i);
      assert.ok(!ids.has(r.id), `${c.id} ${r.id}`);
      ids.add(r.id);
      assert.ok(r.d.startsWith('M'), `${c.id} ${r.id}`);
      assert.match(r.d, PATH_RE, `${c.id} ${r.id}`);
      assert.ok(r.d.trim().endsWith('Z'), `${c.id} ${r.id} is closed`);
      assert.ok([1, 2, 3].includes(r.size), `${c.id} ${r.id} size`);
      for (const n of r.d.match(/-?\d+(\.\d+)?/g)) assert.ok(Number(n) >= -1 && Number(n) <= 401, `${c.id} ${r.id}: ${n}`);
    });
    assert.ok(c.leading.startsWith('M'), c.id);
    assert.match(c.leading, PATH_RE, c.id);
    assert.ok(c.outline.startsWith('M'), c.id);
    assert.ok(c.suggestedPalette.length > 0);
    for (const f of c.suggestedPalette) assert.ok(HUE_FAMILIES.includes(f), `${c.id}: ${f}`);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.regions));
  }
});

test('canvases: the harbor window is the prototype window', () => {
  const c = getCanvas('harbor-window');
  assert.equal(c.regions[13].d, 'M113 160 L187 160 L187 260 L150 200 L113 260 Z');
  assert.equal(c.regions[14].d, 'M150 200 L187 260 L150 320 L113 260 Z');
  assert.ok(c.leading.includes('M40 360 L40 130 A110 110 0 0 1 260 130 L260 360 Z'));
  assert.ok(c.regions.some((r) => r.size === 3) && c.regions.some((r) => r.size === 1));
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

test('names: isNameOk accepts 1-24 letters, spaces, apostrophes and hyphens', () => {
  for (const s of ['Rose', "Miller's Blue", 'Sea-Glass Green', 'A', 'Abcdefghijklmnopqrstuvwx']) assert.ok(isNameOk(s), s);
  for (const s of ['', ' Rose', 'Rose ', 'Rose  Red', 'Blue 2', 'Abcdefghijklmnopqrstuvwxy', 'Red!', '-Red', null, 7]) assert.ok(!isNameOk(s), String(s));
});

test('names: suggestName never returns a taken name over 500 trials', () => {
  const rng = mulberry32(42);
  const hexes = ['#b8433a', '#758054', '#3e6a9e', '#efebe0', '#1b1917', '#e876a6'];
  for (const hex of hexes) {
    const taken = new Set();
    for (let i = 0; i < 500; i++) {
      const name = suggestName(hex, rng, { taken });
      assert.ok(isNameOk(name), `${hex}: "${name}"`);
      assert.ok(![...taken].some((t) => t.toLowerCase() === name.toLowerCase()), `${hex}: repeated "${name}"`);
      taken.add(name);
    }
  }
});

test('names: suggestName is deterministic for a seeded rng and works without options', () => {
  const a = suggestName('#3e6a9e', mulberry32(7));
  const b = suggestName('#3e6a9e', mulberry32(7));
  assert.equal(a, b);
  assert.ok(isNameOk(a));
  const taken = new Set([a.toUpperCase()]);
  assert.notEqual(suggestName('#3e6a9e', mulberry32(7), { taken }).toLowerCase(), a.toLowerCase());
});

test('names: customers and visitor comments', () => {
  assert.equal(CUSTOMER_NAMES.length, 30);
  assert.equal(new Set(CUSTOMER_NAMES).size, 30);
  assert.ok(CUSTOMER_NAMES.includes('Harbor Town') && CUSTOMER_NAMES.includes('The Abbey') && CUSTOMER_NAMES.includes('Master Weaver Lin'));
  assert.equal(VISITOR_COMMENTS.length, 24);
  assert.equal(new Set(VISITOR_COMMENTS).size, 24);
  for (const t of VISITOR_COMMENTS) assert.ok(t.includes('{color}'), t);
  assert.ok(VISITOR_COMMENTS.filter((t) => t.includes('{place}')).length >= 8);
  assert.ok(COMMENT_PLACES.length >= 5);
  assert.equal(fillComment(VISITOR_COMMENTS[0], { color: 'Harbor Teal', place: 'the harbor' }), 'The Harbor Teal reminds me of the harbor at dawn.');
});
