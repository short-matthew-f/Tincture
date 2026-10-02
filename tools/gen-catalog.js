#!/usr/bin/env node
// tools/gen-catalog.js — the source of truth for src/content/catalog.js.
//
// What: holds the Era 1 catalog as data (recipes for mixable colors, hand-
// picked hexes for wild hues and event pages), computes every mixable hex with
// color.mixPaintHex, validates the whole set, and prints the finished module.
//
// Why: docs/DESIGN.md "Discovery and the catalog" discovers a color when a mix
// lands within ΔE 4 of an undiscovered cell, so a cell's hex must be exactly
// what its recipe mixes to, and cells must sit far enough apart that "the
// nearest cell" is a clear answer. Generating the file keeps both true.
//
// Usage:
//   node tools/gen-catalog.js            print catalog.js to stdout
//   node tools/gen-catalog.js --write    write src/content/catalog.js
//   node tools/gen-catalog.js --check    validate only (exit 1 on failure)
//
// Validation (throws on any failure):
//   - 100 Era 1 colors on PAGES; 16 wild with the exact region split; 8 events x 12.
//   - every recipe uses known pigments with positive integer weights, and
//     hex === mixPaintHex(recipe) by construction;
//   - wheel/tints/shades recipes use only madder/ochre/woad/white/black (Phase 1
//     can explore them all); earths add umber, chalk-white, bone-black, sulfur,
//     saffron; commission signature colors may use any Era 1 pigment;
//   - every pair of Era 1 colors is at least ERA1_MIN_DELTA_E apart; every pair
//     on one event page is at least EVENT_MIN_DELTA_E apart;
//   - ids are unique kebab-case; names are unique and 1-24 letters/spaces/'/-.
//
// Why ΔE 5 for Era 1 (not 6): the paint-mixing gamut of five starter drops plus
// five hunted pigments is small (geometric-mean mixing pulls everything toward
// muddy mid-tones). Packing studies on that gamut put the ceiling for a
// pairwise floor of 6 at roughly 60 to 70 colors, short of the 84 mixable cells
// the page plan needs. A floor of 5 fits all of them; discovery still uses
// "nearest cell within ΔE 4", so the ceremony always names one color.
// Event pages are small and hand-picked from the full sRGB gamut, so they keep 6.
// The mixable recipes below were placed with a packing search (seeded
// simulated annealing over integer recipes) and then named by eye.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mixPaintHex, deltaEHex, hueFamily, hexToOklch, HUE_FAMILIES } from '../src/color.js';
import { getPigment, pigmentHex } from '../src/content/pigments.js';

const ERA1_MIN_DELTA_E = 5;
const EVENT_MIN_DELTA_E = 6;
const PAGES = ['wheel', 'tints', 'shades', 'earths', 'wild'];
const TIER_PRICE = { primary: 1, secondary: 3, tertiary: 8, tint: 15, wild: 60 };
const PRIMARY_IDS = ['madder', 'ochre', 'woad'];
const SECONDARY_IDS = ['orange', 'green', 'violet'];
const STARTER = new Set(['madder', 'ochre', 'woad', 'white', 'black']);
const EARTHY = new Set([...STARTER, 'umber', 'chalk-white', 'bone-black', 'sulfur', 'saffron']);
const ALLOWED = { wheel: STARTER, tints: STARTER, shades: STARTER, earths: EARTHY };
const REGION_NAMES = { meadow: 'Meadow', quarry: 'Quarry', coast: 'Coast', jungle: 'Jungle', volcano: 'Volcano' };
const WILD_REGION_COUNTS = { meadow: 3, quarry: 3, coast: 3, jungle: 3, volcano: 4 };
const EVENT_NAMES = {
  'autumn-harvest': 'Autumn Harvest',
  'deep-sea': 'Deep Sea',
  'bloom-week': 'Bloom Week',
  'neon-night': 'Neon Night',
  'winter-frost': 'Winter Frost',
  'festival-of-lanterns': 'Festival of Lanterns',
  'golden-hour': 'Golden Hour',
  'ink-and-paper': 'Ink and Paper',
};

// ---------------------------------------------------------------------------
// Data. Rows are [id, name, recipe]; a recipe is 'pigment:weight ...' using
// pigment ids from src/content/pigments.js plus the free drops 'white'/'black'.
// Order inside a table does not matter: pages are sorted by hue on output.
// ---------------------------------------------------------------------------

const WHEEL = [
  ['mulberry', 'Mulberry', 'madder:2 woad:1'],
  ['rosewood', 'Rosewood', 'madder:8 woad:3 white:2'],
  ['brick-red', 'Brick Red', 'madder:8 woad:1 white:3'],
  ['madder', 'Madder Red', 'madder:1'],
  ['russet', 'Russet', 'madder:5 ochre:3 white:1 black:1'],
  ['orange', 'Orange', 'madder:1 ochre:1'],
  ['walnut', 'Walnut', 'madder:4 ochre:3 woad:5 black:1'],
  ['marigold', 'Marigold', 'madder:1 ochre:3'],
  ['hazel', 'Hazel', 'madder:3 ochre:6 woad:1 black:2'],
  ['ochre', 'Yellow Ochre', 'ochre:1'],
  ['olive', 'Olive', 'ochre:2 woad:1'],
  ['green', 'Green', 'ochre:1 woad:1'],
  ['willow', 'Willow', 'ochre:4 woad:5 white:3'],
  ['spruce', 'Spruce', 'ochre:3 woad:5 white:1 black:1'],
  ['juniper', 'Juniper', 'ochre:3 woad:8 white:2'],
  ['teal', 'Teal', 'ochre:1 woad:5'],
  ['cornflower', 'Cornflower', 'woad:3 white:1'],
  ['woad', 'Woad Blue', 'woad:1'],
  ['violet', 'Violet', 'madder:1 woad:2'],
  ['mauve', 'Mauve', 'madder:3 woad:3 white:1'],
];

const TINTS = [
  ['dusty-rose', 'Dusty Rose', 'madder:4 woad:2 white:7'],
  ['coral', 'Coral', 'madder:4 white:3'],
  ['rose', 'Rose', 'madder:4 white:5'],
  ['shell-pink', 'Shell Pink', 'madder:3 white:10'],
  ['blush', 'Blush', 'madder:1 white:6'],
  ['peach', 'Peach', 'madder:4 ochre:1 white:8'],
  ['apricot', 'Apricot', 'madder:4 ochre:5 white:5'],
  ['wheat', 'Wheat', 'madder:1 ochre:2 white:4'],
  ['linen', 'Linen', 'madder:1 ochre:1 woad:1 white:5'],
  ['custard', 'Custard', 'madder:1 ochre:3 white:9'],
  ['old-gold', 'Old Gold', 'madder:1 ochre:10 woad:2 white:1'],
  ['sage', 'Sage', 'ochre:2 woad:2 white:9'],
  ['sky-blue', 'Sky Blue', 'woad:3 white:4'],
  ['delft-blue', 'Delft Blue', 'woad:5 white:4'],
  ['mist', 'Mist', 'ochre:1 woad:3 white:6'],
  ['eucalyptus', 'Eucalyptus', 'ochre:1 woad:3 white:3'],
  ['ice', 'Ice', 'woad:1 white:8'],
  ['powder-blue', 'Powder Blue', 'woad:1 white:4'],
];

const SHADES = [
  ['maroon', 'Maroon', 'madder:5 black:2'],
  ['oxblood', 'Oxblood', 'madder:7 black:6'],
  ['rust', 'Rust', 'madder:5 ochre:1 black:1'],
  ['tobacco', 'Tobacco', 'madder:1 ochre:3 black:3'],
  ['bog-oak', 'Bog Oak', 'ochre:3 black:5'],
  ['olive-drab', 'Olive Drab', 'ochre:5 woad:1 black:3'],
  ['navy', 'Navy', 'woad:5 black:2'],
  ['storm-blue', 'Storm Blue', 'woad:6 black:1'],
  ['damson', 'Damson', 'madder:5 woad:5 black:1'],
  ['cocoa', 'Cocoa', 'madder:2 ochre:1 black:7'],
  ['forest', 'Forest', 'ochre:2 woad:5 black:5'],
  ['bottle-green', 'Bottle Green', 'ochre:2 woad:5 black:1'],
  ['soot', 'Soot', 'woad:1 black:7'],
  ['charcoal', 'Charcoal', 'madder:1 woad:3 black:4'],
];

const EARTHS = [
  ['bramble', 'Bramble', 'madder:5 woad:2 bone-black:5'],
  ['cinder-rose', 'Cinder Rose', 'madder:6 woad:3 chalk-white:4'],
  ['clay', 'Clay', 'madder:2 umber:3 chalk-white:5'],
  ['burnt-sienna', 'Burnt Sienna', 'madder:1 umber:4'],
  ['driftwood', 'Driftwood', 'madder:5 woad:5 sulfur:4'],
  ['fawn', 'Fawn', 'white:1 umber:4 chalk-white:2'],
  ['raw-sienna', 'Raw Sienna', 'ochre:4 umber:5 saffron:1'],
  ['tawny', 'Tawny', 'ochre:3 umber:2 saffron:1'],
  ['tan', 'Tan', 'umber:4 chalk-white:6 saffron:1'],
  ['saffron-gold', 'Saffron Gold', 'sulfur:1 saffron:5'],
  ['sandstone', 'Sandstone', 'ochre:4 black:1 chalk-white:6'],
  ['primrose', 'Primrose', 'white:3 sulfur:1 saffron:1'],
  ['mustard', 'Mustard', 'ochre:6 woad:2 sulfur:5'],
  ['turmeric', 'Turmeric', 'woad:1 sulfur:6 saffron:3'],
  ['loden', 'Loden', 'black:3 chalk-white:1 sulfur:5'],
  ['lichen', 'Lichen', 'woad:1 chalk-white:4 sulfur:3'],
  ['moss', 'Moss', 'woad:3 sulfur:4 saffron:2'],
  ['pistachio', 'Pistachio', 'woad:2 chalk-white:4 sulfur:3'],
  ['rosemary', 'Rosemary', 'woad:5 black:4 saffron:4'],
  ['heather', 'Heather', 'madder:2 woad:3 chalk-white:2'],
  ['taupe', 'Taupe', 'madder:3 woad:3 chalk-white:5'],
];

const WILD = [
  ['meadow-green', 'Meadow Green', 'meadow', '#9ac12f'],
  ['clover-pink', 'Clover Pink', 'meadow', '#ea76ac'],
  ['honey-gold', 'Honey Gold', 'meadow', '#ffb500'],
  ['slate-grey', 'Slate Grey', 'quarry', '#699499'],
  ['umber-brown', 'Umber Brown', 'quarry', '#652f00'],
  ['ochre-rust', 'Ochre Rust', 'quarry', '#873301'],
  ['murex-purple', 'Murex Purple', 'coast', '#804497'],
  ['sea-glass', 'Sea Glass', 'coast', '#9fdcc6'],
  ['harbor-teal', 'Harbor Teal', 'coast', '#12807d'],
  ['cochineal-red', 'Cochineal Red', 'jungle', '#b6194a'],
  ['parrot-green', 'Parrot Green', 'jungle', '#27a343'],
  ['orchid', 'Orchid', 'jungle', '#bc71cb'],
  ['lava-red', 'Lava Red', 'volcano', '#f05425'],
  ['sulfur-yellow', 'Sulfur Yellow', 'volcano', '#e7de1f'],
  ['obsidian', 'Obsidian', 'volcano', '#150f20'],
  ['ash-grey', 'Ash Grey', 'volcano', '#c8b4c2'],
];

const EVENTS = {
  'autumn-harvest': [
    ['Harvest Gold', '#e3ae28'], ['Pumpkin', '#e47600'], ['Russet Leaf', '#b45b2e'],
    ['Cider', '#cc9140'], ['Maple Red', '#a92227'], ['Acorn', '#7c5828'],
    ['Amber Glow', '#c16f00'], ['Bramble Jam', '#5b2036'], ['Wheat Sheaf', '#eed59b'],
    ['Orchard Apple', '#ce5053'], ['Pear Skin', '#b9bf5f'], ['Chestnut', '#60311e'],
  ],
  'deep-sea': [
    ['Pearl', '#efebe0'], ['Abalone', '#a1c5cc'], ['Lagoon', '#31a5a5'],
    ['Fathom Teal', '#076b6f'], ['Kelp', '#526c43'], ['Abyss', '#12253c'],
    ['Squid Ink', '#15151f'], ['Coral Reef', '#e1897e'], ['Spindrift', '#b9e6d9'],
    ['Nautilus', '#5c869f'], ['Tidepool', '#2b8d71'], ['Anemone', '#ae6aa8'],
  ],
  'bloom-week': [
    ['Peony', '#eb90b9'], ['Lilac Spray', '#c1a3d8'], ['Sweet Pea', '#e7c0de'],
    ['Fresh Fern', '#65a64d'], ['New Leaf', '#b7d978'], ['Tulip Red', '#cf4047'],
    ['Wisteria', '#947fc1'], ['Rosebud', '#d0557f'], ['Daffodil', '#f2dd5a'],
    ['Bluebell', '#656cba'], ['Stem Green', '#3f713a'], ['Apple Blossom', '#f9dbe6'],
  ],
  'neon-night': [
    ['Electric Pink', '#f92da2'], ['Laser Lime', '#b0f42f'], ['Neon Tangerine', '#fe7802'],
    ['Hot Magenta', '#d00aca'], ['Volt Yellow', '#fdf720'], ['Cyber Cyan', '#2eeded'],
    ['Ultraviolet', '#7523de'], ['Signal Red', '#ea2221'], ['Glow Green', '#39e252'],
    ['Arc Blue', '#1874ed'], ['Midnight Neon', '#191731'], ['Arcade Purple', '#6b139e'],
  ],
  'winter-frost': [
    ['First Snow', '#f7f5ef'], ['Rime', '#d3e8f7'], ['Glacier', '#70bdde'],
    ['Silver Birch', '#bbbec1'], ['Pewter Sky', '#81878d'], ['Steel Blue', '#50799b'],
    ['Icicle', '#9ee4dd'], ['Northern Sky', '#5aa0d0'], ['Midwinter', '#2c3d5d'],
    ['Hoarfrost', '#9da8be'], ['Aurora Teal', '#53bcac'], ['Frozen Lake', '#3d6473'],
  ],
  'festival-of-lanterns': [
    ['Lantern Orange', '#f3821d'], ['Paper Red', '#d33c33'], ['Candle Glow', '#f8c970'],
    ['Ember', '#a03313'], ['Firecracker', '#eb5200'], ['Marigold Garland', '#fba62a'],
    ['Silk Crimson', '#9d1133'], ['Tassel Gold', '#c8a83a'], ['Lacquer', '#6b1e1c'],
    ['Sunset Pink', '#e7768a'], ['Night Lantern', '#3a1e0e'], ['Paper Moon', '#f5e7c3'],
  ],
  'golden-hour': [
    ['Peach Glow', '#f4bd99'], ['Honey Light', '#eab444'], ['Dusk Violet', '#725b9a'],
    ['Lavender Haze', '#ae9ece'], ['Apricot Sky', '#e3975a'], ['Rose Gold', '#cb8c81'],
    ['Long Shadow', '#423b65'], ['Amber Field', '#cd8817'], ['Mauve Cloud', '#a47692'],
    ['Golden Wheat', '#f1d680'], ['Afterglow', '#d66643'], ['Twilight Blue', '#42558a'],
  ],
  'ink-and-paper': [
    ['Vellum', '#f1ebd9'], ['Parchment', '#e2cead'], ['Sepia Ink', '#6a4b2f'],
    ['Iron Gall', '#222f3c'], ['Lamp Black', '#171614'], ['Indigo Ink', '#243163'],
    ['Walnut Ink', '#533525'], ['Faded Ink', '#6a7586'], ['Rubric Red', '#a8372e'],
    ['Quill Grey', '#9b9893'], ['Oak Gall', '#7a6548'], ['Lapis Wash', '#5a78bc'],
  ],
};

// Commission signature colors (docs/DESIGN.md "Commissions"): placed on the
// page their hue belongs to, made from hunted pigments she has by Phase 3.
const COMMISSION = [
  ['bunting-red', 'Bunting Red', 'wheel', 'cochineal:2 saffron:1 white:1'],
  ['coronation-purple', 'Coronation Purple', 'wheel', 'murex:3 lapis:1'],
  ['grand-spectrum', 'Grand Spectrum', 'wheel', 'lapis:2 white:1'],
  ['lighthouse-white', 'Lighthouse White', 'tints', 'chalk-white:10 saffron:1'],
  ['kiln-glaze', 'Kiln Glaze', 'tints', 'chalk-white:3 lapis:2 sulfur:3'],
  ['quilt-patchwork', 'Patchwork Pink', 'tints', 'cochineal:1 chalk-white:3'],
  ['loom-thread', 'Loom Thread', 'tints', 'murex:1 chalk-white:2'],
  ['stained-glass-ruby', 'Stained-Glass Ruby', 'shades', 'cochineal:4 bone-black:1'],
  ['deep-fathom', 'Deep Fathom', 'shades', 'lapis:3 indigo:1'],
  ['atlas-ink', 'Atlas Ink', 'shades', 'indigo:3 bone-black:1'],
  ['illuminated-gold', 'Illuminated Gold', 'earths', 'saffron:1 sulfur:4'],
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function fail(msg) {
  throw new Error('gen-catalog: ' + msg);
}

function parseRecipe(str, where) {
  const recipe = str.trim().split(/\s+/).map((tok) => {
    const [pigment, w] = tok.split(':');
    const weight = Number(w);
    if (!getPigment(pigment)) fail(`${where}: unknown pigment "${pigment}"`);
    if (!Number.isInteger(weight) || weight <= 0) fail(`${where}: bad weight in "${tok}"`);
    return { pigment, weight };
  });
  if (new Set(recipe.map((p) => p.pigment)).size !== recipe.length) fail(`${where}: repeated pigment`);
  return recipe;
}

const recipeHex = (recipe) => mixPaintHex(recipe.map((p) => ({ hex: pigmentHex(p.pigment), weight: p.weight })));

// Hue order for a page: chromatic colors by OKLCH hue, then neutrals light to dark.
function hueKey(hex) {
  const { L, h } = hexToOklch(hex);
  return hueFamily(hex) === 'neutral' ? 1000 + (1 - L) : h;
}

function hintFor(c) {
  if (c.foundBy === 'start') return 'one of your first pigments';
  if (c.foundBy === 'mix') return 'found by mixing';
  if (c.foundBy === 'grade') return 'found by grading';
  if (c.foundBy === 'commission') return "a commission's signature color";
  if (c.foundBy === 'hunt') return `a hunter's find on the ${REGION_NAMES[c.region]}`;
  return '';
}

function buildEra1() {
  const all = [];
  const add = (page, [id, name, recipeStr], extra = {}) => {
    const recipe = parseRecipe(recipeStr, id);
    if (!extra.commission) {
      for (const p of recipe) if (!ALLOWED[page].has(p.pigment)) fail(`${id}: pigment ${p.pigment} not allowed on ${page}`);
    }
    let tier = 'tertiary';
    if (page === 'tints' || page === 'shades') tier = 'tint';
    if (PRIMARY_IDS.includes(id)) tier = 'primary';
    if (SECONDARY_IDS.includes(id)) tier = 'secondary';
    let foundBy = extra.commission ? 'commission' : 'mix';
    if (tier === 'primary') foundBy = 'start';
    all.push({ id, name, hex: recipeHex(recipe), page, tier, recipe, foundBy });
  };
  for (const row of WHEEL) add('wheel', row);
  for (const row of TINTS) add('tints', row);
  for (const row of SHADES) add('shades', row);
  for (const row of EARTHS) add('earths', row);
  for (const [id, name, page, recipe] of COMMISSION) add(page, [id, name, recipe], { commission: true });
  for (const [id, name, region, hex] of WILD) {
    if (!REGION_NAMES[region]) fail(`${id}: unknown region ${region}`);
    all.push({ id, name, hex, page: 'wild', tier: 'wild', recipe: null, foundBy: 'hunt', region });
  }

  const out = [];
  for (const page of PAGES) {
    const onPage = all.filter((c) => c.page === page);
    onPage.sort((a, b) => (page === 'wild' ? 0 : hueKey(a.hex) - hueKey(b.hex)));
    // About half of the tints and shades are revealed by grading boards: every
    // other mixable cell in hue order, so both methods cover the whole page.
    if (page === 'tints' || page === 'shades') {
      onPage.filter((c) => c.foundBy === 'mix').forEach((c, i) => { if (i % 2 === 1) c.foundBy = 'grade'; });
    }
    for (const c of onPage) {
      const entry = {
        id: c.id, name: c.name, hex: c.hex, era: 1, page, tier: c.tier, basePrice: TIER_PRICE[c.tier],
        recipe: c.recipe, foundBy: c.foundBy,
      };
      if (c.region) entry.region = c.region;
      entry.hint = hintFor(c);
      entry.family = hueFamily(c.hex);
      out.push(entry);
    }
  }
  return out;
}

function buildEvents() {
  const out = [];
  for (const [event, rows] of Object.entries(EVENTS)) {
    if (!EVENT_NAMES[event]) fail(`unknown event ${event}`);
    rows.forEach(([name, hex], i) => {
      out.push({
        id: `${event}-${i + 1}`, name, hex, era: 1, page: 'event', event, tier: 'tint', basePrice: 15,
        foundBy: 'event', recipe: null, hint: `an event color from ${EVENT_NAMES[event]}`, family: hueFamily(hex),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z][A-Za-z '\-]{0,23}$/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

function minPair(list) {
  let best = { d: Infinity };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = deltaEHex(list[i].hex, list[j].hex);
      if (d < best.d) best = { d, a: list[i].id, b: list[j].id };
    }
  }
  return best;
}

function validate(era1, events) {
  if (era1.length !== 100) fail(`expected 100 Era 1 colors, got ${era1.length}`);
  const ids = new Set();
  const names = new Set();
  for (const c of [...era1, ...events]) {
    if (!ID_RE.test(c.id)) fail(`bad id ${c.id}`);
    if (ids.has(c.id)) fail(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!NAME_RE.test(c.name)) fail(`bad name "${c.name}"`);
    if (names.has(c.name.toLowerCase())) fail(`duplicate name "${c.name}"`);
    names.add(c.name.toLowerCase());
    if (!HEX_RE.test(c.hex)) fail(`bad hex ${c.id} ${c.hex}`);
    if (!HUE_FAMILIES.includes(c.family)) fail(`bad family ${c.id}`);
    if (c.recipe && recipeHex(c.recipe) !== c.hex) fail(`${c.id}: hex does not match its recipe`);
  }
  for (const id of [...PRIMARY_IDS, ...SECONDARY_IDS]) if (!ids.has(id)) fail(`missing guaranteed id ${id}`);
  const wild = era1.filter((c) => c.page === 'wild');
  if (wild.length !== 16) fail(`expected 16 wild, got ${wild.length}`);
  for (const [region, n] of Object.entries(WILD_REGION_COUNTS)) {
    if (wild.filter((c) => c.region === region).length !== n) fail(`expected ${n} wild hues in ${region}`);
  }
  const era1Min = minPair(era1);
  if (era1Min.d < ERA1_MIN_DELTA_E) fail(`Era 1 ΔE ${era1Min.d.toFixed(2)} between ${era1Min.a} and ${era1Min.b}`);
  for (const event of Object.keys(EVENTS)) {
    const page = events.filter((c) => c.event === event);
    if (page.length !== 12) fail(`${event}: expected 12 colors`);
    const m = minPair(page);
    if (m.d < EVENT_MIN_DELTA_E) fail(`${event}: ΔE ${m.d.toFixed(2)} between ${m.a} and ${m.b}`);
  }
  if (events.length !== 96) fail(`expected 96 event colors, got ${events.length}`);
  return { era1Min, counts: Object.fromEntries(PAGES.map((p) => [p, era1.filter((c) => c.page === p).length])) };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function emitColor(c) {
  const parts = [
    `id: ${q(c.id)}`, `name: ${q(c.name)}`, `hex: ${q(c.hex)}`, `era: ${c.era}`, `page: ${q(c.page)}`,
  ];
  if (c.event) parts.push(`event: ${q(c.event)}`);
  parts.push(`tier: ${q(c.tier)}`, `basePrice: ${c.basePrice}`);
  parts.push(`recipe: ${c.recipe ? '[' + c.recipe.map((p) => `{ pigment: ${q(p.pigment)}, weight: ${p.weight} }`).join(', ') + ']' : 'null'}`);
  parts.push(`foundBy: ${q(c.foundBy)}`);
  if (c.region) parts.push(`region: ${q(c.region)}`);
  parts.push(`hint: ${q(c.hint)}`, `family: ${q(c.family)}`);
  return `  { ${parts.join(', ')} },`;
}

function emit(era1, events, summary) {
  return `// catalog.js — GENERATED by tools/gen-catalog.js. Do not edit by hand:
// change the tables in the generator and run \`node tools/gen-catalog.js --write\`.
//
// The Era 1 swatch book (docs/DESIGN.md "Discovery and the catalog",
// "Catalog structure", "Economy › Color value") plus the eight weekly event
// pages ("Quests and weekly events › Weekly events").
//
// Contract (ARCHITECTURE.md "Content"):
//  - CATALOG: ${era1.length} Era 1 colors on PAGES (${PAGES.map((p) => `${p} ${summary.counts[p]}`).join(', ')}).
//  - Mixable colors carry recipe [{pigment, weight}] (pigment ids from
//    pigments.js plus 'white'/'black') and hex === mixPaintHex(recipeParts(recipe)).
//  - Wild hues (page 'wild', foundBy 'hunt', region set) have recipe null and
//    cannot be mixed; sim discovery by mixing should only consider colors with
//    a recipe.
//  - Every pair of Era 1 colors is at least ERA1_MIN_DELTA_E (${ERA1_MIN_DELTA_E}) apart
//    (closest pair: ${summary.era1Min.a} / ${summary.era1Min.b}, ΔE ${summary.era1Min.d.toFixed(2)}); colors
//    on one event page are at least EVENT_MIN_DELTA_E (${EVENT_MIN_DELTA_E}) apart.
//  - EVENT_COLORS: 8 events x 12 ('<event-id>-1'..'-12'), recipe null.

import { pigmentHex } from './pigments.js';

export const ERA1_MIN_DELTA_E = ${ERA1_MIN_DELTA_E};
export const EVENT_MIN_DELTA_E = ${EVENT_MIN_DELTA_E};

/** Era 1 catalog pages in display order. */
export const PAGES = Object.freeze(${JSON.stringify(PAGES).replace(/"/g, "'").replace(/,/g, ', ')});

/** Base price in Coins per jar by tier (Era 1). */
export const TIER_PRICES = Object.freeze({ primary: 1, secondary: 3, tertiary: 8, tint: 15, wild: 60 });

/** Event ids in rotation order. */
export const EVENT_IDS = Object.freeze(${JSON.stringify(Object.keys(EVENTS)).replace(/"/g, "'").replace(/,/g, ', ')});

const deepFreeze = (c) => {
  if (c.recipe) { c.recipe.forEach(Object.freeze); Object.freeze(c.recipe); }
  return Object.freeze(c);
};

/** The ${era1.length} Era 1 colors, page by page; order within a page is its position. */
export const CATALOG = Object.freeze([
${era1.map(emitColor).join('\n')}
].map(deepFreeze));

/** Limited event pages: 12 colors per event, rerun on the 8-week rotation. */
export const EVENT_COLORS = Object.freeze([
${events.map(emitColor).join('\n')}
].map(deepFreeze));

const BY_ID = new Map([...CATALOG, ...EVENT_COLORS].map((c) => [c.id, c]));

/** Era 1 colors grouped by page: { wheel: Color[], tints, shades, earths, wild }. */
export const COLORS_BY_PAGE = Object.freeze(Object.fromEntries(
  PAGES.map((p) => [p, Object.freeze(CATALOG.filter((c) => c.page === p))]),
));

/** Event colors grouped by event id. */
export const EVENT_COLORS_BY_EVENT = Object.freeze(Object.fromEntries(
  EVENT_IDS.map((e) => [e, Object.freeze(EVENT_COLORS.filter((c) => c.event === e))]),
));

/** Any catalog or event color by id, or undefined. */
export function getColor(id) {
  return BY_ID.get(id);
}

/** Era 1 colors that have a recipe (everything except wild hues). */
export function mixableColors() {
  return CATALOG.filter((c) => c.recipe);
}

/** A recipe as mixPaint parts: [{pigment, weight}] -> [{hex, weight}]. */
export function recipeParts(recipe) {
  return recipe.map((p) => ({ hex: pigmentHex(p.pigment), weight: p.weight }));
}
`;
}

const era1 = buildEra1();
const events = buildEvents();
const summary = validate(era1, events);
const args = process.argv.slice(2);
if (args.includes('--check')) {
  console.log(`ok: ${era1.length} Era 1 colors, ${events.length} event colors, closest Era 1 pair ΔE ${summary.era1Min.d.toFixed(2)}`);
} else if (args.includes('--write')) {
  const target = fileURLToPath(new URL('../src/content/catalog.js', import.meta.url));
  writeFileSync(target, emit(era1, events, summary));
  console.error(`wrote ${target}`);
} else {
  process.stdout.write(emit(era1, events, summary));
}
