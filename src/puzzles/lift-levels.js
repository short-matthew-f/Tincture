// puzzles/lift-levels.js — The Lifting Table's palette, mechanics, chapters and
// paintings (pure data), written by proto/lift/ship.mjs from proto/lift/chapters.js
// (the prototype is the source; its generator knobs stay there). Pictures live in
// lift-art.js; lanes, keys, muslin, jars left out, stored solutions and stats in
// lift-queues.js. Do not edit by hand: edit the prototype and ship
// (test/lift.test.js checks the two match painting for painting).
import { QUEUES } from './lift-queues.js';
import { ART } from './lift-art.js';
import { buildLevel, mechanicsOf, levelSig } from './lift.js';

// Soft natural pigments, one letter each. Glyph names map to the shapes in
// src/ui/lift.js (color symbols for colorblind play).
export const PALETTE = Object.freeze({
  s: { name: 'Sky Blue', hex: '#8babc5', glyph: 'wave' },
  x: { name: 'Pale Sky', hex: '#c3d4df', glyph: 'cloud' },
  o: { name: 'Yellow Ochre', hex: '#d39b2a', glyph: 'sun' },
  g: { name: 'Green', hex: '#758054', glyph: 'leaf' },
  j: { name: 'Sage', hex: '#aab78f', glyph: 'sprout' },
  r: { name: 'Madder Red', hex: '#b8433a', glyph: 'heart' },
  d: { name: 'Deep Madder', hex: '#7e2f2b', glyph: 'down' },
  c: { name: 'Lighthouse White', hex: '#eee4c8', glyph: 'ring' },
  b: { name: 'Woad Blue', hex: '#3e6a9e', glyph: 'drop' },
  k: { name: 'Walnut', hex: '#6f5c4c', glyph: 'square' },
  i: { name: 'Charcoal', hex: '#3b3632', glyph: 'slash' },
  e: { name: 'Pebble', hex: '#a29c92', glyph: 'pebble' },
  p: { name: 'Rose', hex: '#d78b80', glyph: 'flower' },
  w: { name: 'Willow', hex: '#869473', glyph: 'chevron' },
  n: { name: 'Navy', hex: '#324961', glyph: 'moon' },
  y: { name: 'Custard', hex: '#e7c691', glyph: 'star' },
  m: { name: 'Mulberry', hex: '#824e52', glyph: 'diamond' },
  a: { name: 'Apricot', hex: '#d69158', glyph: 'triangle' },
  z: { name: 'Ember', hex: '#c4632e', glyph: 'flame' },
  l: { name: 'Linen', hex: '#c5b19a', glyph: 'bars' },
  q: { name: 'Sand', hex: '#ddcca6', glyph: 'grain' },
  h: { name: 'Shell Pink', hex: '#e5b6ab', glyph: 'shell' },
  f: { name: 'Forest', hex: '#38423d', glyph: 'cross' },
  t: { name: 'Teal', hex: '#4d7181', glyph: 'dot' },
  u: { name: 'Lavender', hex: '#a596b5', glyph: 'bell' },
  v: { name: 'Heather', hex: '#6f5d80', glyph: 'spade' },
});

// What each mechanic is called, and the one line that introduces it.
export const MECHANICS = Object.freeze({
  mystery: { name: 'Mystery jars', line: 'A “?” jar keeps its color secret until it reaches the front of its lane.' },
  linked: { name: 'Tied jars', line: 'Two jars tied with string go onto the belt together, so they need two free places.' },
  mixing: { name: 'Mixing jars', line: 'A mixing jar lifts two colors, a set amount of each, and they blend as it fills.' },
  cloth: { name: 'Muslin cloth', line: 'Nothing lifts through the muslin. It lifts away once a column beside it is bare.' },
  key: { name: 'Keys', line: 'A padlocked lane opens once you lift its key cell out of the painting.' },
  belt3: { name: 'A shorter belt', line: 'Only three jars ride the belt at once on this painting.' },
  bench2: { name: 'A smaller bench', line: 'The bench has two resting spots here, so park with care.' },
  crock: { name: 'Stoneware crocks', line: 'A crock is too heavy for the bench. Once it is on the belt, it rides until it fills.' },
  leftover: { name: 'A jar left out', line: 'Someone left a jar resting on the bench. Bring it to the belt when its color shows.' },
});

// The gallery wall's rooms, in order: paintings [from, to) of LEVELS. A chapter
// opens once every painting of the one before is lifted; inside a chapter, each
// painting opens once the one before it is lifted (src/sim/lift.js).
export const CHAPTERS = Object.freeze([
  { id: 'first', name: 'First paintings', line: 'Small, bright pictures to learn the table on.', from: 0, to: 10 },
  { id: 'tricks', name: 'New tricks', line: 'Mixing jars, muslin and keys join the table, one at a time.', from: 10, to: 19 },
  { id: 'table', name: 'The whole table', line: 'Bigger paintings, a shorter belt and a smaller bench: every trick at once.', from: 19, to: 27 },
  { id: 'garden', name: 'The kitchen garden', line: 'Sunflowers, snails and a well-worn gate. A gentler start, then the garden grows.', from: 27, to: 38 },
  { id: 'country', name: 'Out in the country', line: 'Barns, geese and windmills under wide skies.', from: 38, to: 49 },
  { id: 'kitchen', name: 'The country kitchen', line: 'Warm bread, jam, and a stoneware crock or two.', from: 49, to: 60 },
  { id: 'wool', name: 'Wool and thread', line: 'Reels, quilts and buttons, and a jar someone left out on the bench.', from: 60, to: 71 },
  { id: 'water', name: 'By the water', line: 'Boats, swans and the things that live in the shallows.', from: 71, to: 82 },
  { id: 'woodland', name: 'Woodland and autumn', line: 'Acorns, robins and a walk through the falling leaves.', from: 82, to: 93 },
  { id: 'winter', name: 'Winter evenings', line: 'Candlelight, snow, and a carousel at the winter fair.', from: 93, to: 104 },
].map((c) => Object.freeze(c)));

// [id, name, noun, chapter, {slots, bench, cover}] in play order.
const DEFS = [
  ['sun', 'Morning sun', 'morning sun', 'first'],
  ['tulip', 'Tulip', 'tulip', 'first'],
  ['teacup', 'Teacup', 'teacup', 'first'],
  ['sail', 'Sailboat', 'sailboat', 'first'],
  ['skein', 'Skein of wool', 'skein', 'first'],
  ['mushrooms', 'Toadstools', 'toadstools', 'first'],
  ['sheep', 'Sheep in the meadow', 'sheep', 'first'],
  ['cherries', 'Cherries', 'cherries', 'first'],
  ['cottage', 'Cottage garden', 'cottage garden', 'first'],
  ['apple', 'Apple tree', 'apple tree', 'first'],
  ['lighthouse', 'Lighthouse at sunset', 'lighthouse', 'tricks'],
  ['cat', 'Cat on the sill', 'cat', 'tricks'],
  ['teapot', 'Tea for two', 'tea table', 'tricks'],
  ['quilt', 'Quilt on the line', 'quilt', 'tricks', { cover: [13] }],
  ['hedgehog', 'Hedgehog in the leaves', 'hedgehog', 'tricks', { cover: [12] }],
  ['bee', 'Bee and clover', 'bee and clover', 'tricks', { cover: [6, 17] }],
  ['birdhouse', 'Birdhouse', 'birdhouse', 'tricks'],
  ['loom', 'Half-woven cloth', 'weaving', 'tricks'],
  ['owl', 'Owl at night', 'owl', 'tricks', { cover: [12] }],
  ['fox', 'Fox in autumn leaves', 'fox', 'table', { slots: 3, cover: [14] }],
  ['harbor', 'Harbor', 'harbor', 'table', { slots: 3, cover: [12, 24] }],
  ['wheel', 'Spinning wheel', 'spinning wheel', 'table', { slots: 3, cover: [20] }],
  ['dyepot', 'Dye pot on the fire', 'dye pot', 'table', { slots: 3, bench: 2, cover: [14] }],
  ['strawberries', 'Bowl of strawberries', 'strawberries', 'table', { slots: 3, bench: 2, cover: [7, 20] }],
  ['mittens', 'Mittens on the line', 'mittens', 'table', { slots: 3, bench: 2, cover: [15] }],
  ['village', 'Village at dusk', 'village', 'table', { slots: 3, bench: 2, cover: [10, 20] }],
  ['sampler', 'Cross-stitch sampler', 'sampler', 'table', { slots: 3, bench: 2, cover: [14, 15] }],
  ['sunflower', 'Sunflower', 'sunflower', 'garden'],
  ['carrots', 'Carrots', 'carrots', 'garden'],
  ['snail', 'Snail', 'snail', 'garden'],
  ['cactus', 'Cactus in a pot', 'cactus', 'garden'],
  ['peapods', 'Pea pods', 'pea pods', 'garden'],
  ['beehive', 'Straw beehive', 'beehive', 'garden'],
  ['wateringcan', 'Watering can', 'watering can', 'garden'],
  ['houseplant', 'House plant', 'house plant', 'garden'],
  ['wheelbarrow', 'Wheelbarrow of seedlings', 'wheelbarrow', 'garden', { slots: 3 }],
  ['well', 'Stone well', 'well', 'garden', { slots: 3 }],
  ['gardengate', 'Garden gate', 'garden gate', 'garden', { slots: 3, bench: 2 }],
  ['rainbow', 'Rainbow over the hill', 'rainbow', 'country'],
  ['sunrise', 'Sunrise over the field', 'sunrise', 'country'],
  ['goose', 'Goose', 'goose', 'country'],
  ['kite', 'Kite on the hill', 'kite', 'country'],
  ['barn', 'Red barn', 'barn', 'country'],
  ['balloon', 'Hot air balloon', 'balloon', 'country'],
  ['goat', 'Goat on the hill', 'goat', 'country', { slots: 3 }],
  ['alpaca', 'Alpaca', 'alpaca', 'country'],
  ['windmill', 'Windmill', 'windmill', 'country', { slots: 3 }],
  ['cottagedoor', 'Cottage door', 'cottage door', 'country', { bench: 2 }],
  ['bridge', 'Covered bridge', 'covered bridge', 'country', { slots: 3, bench: 2 }],
  ['pear', 'Pear', 'pear', 'kitchen'],
  ['crock', 'Butter crock', 'butter crock', 'kitchen'],
  ['strawberry', 'Strawberry', 'strawberry', 'kitchen'],
  ['bread', 'Loaf of bread', 'loaf', 'kitchen'],
  ['honeypot', 'Honey pot', 'honey pot', 'kitchen'],
  ['pumpkin', 'Pumpkin', 'pumpkin', 'kitchen'],
  ['croissant', 'Croissant', 'croissant', 'kitchen'],
  ['copperpan', 'Copper pan', 'copper pan', 'kitchen'],
  ['jam', 'Jar of jam', 'jam jar', 'kitchen', { slots: 3 }],
  ['eggs', 'Basket of eggs', 'basket of eggs', 'kitchen', { bench: 2 }],
  ['cake', 'Slice of cake', 'cake', 'kitchen', { slots: 3, bench: 2 }],
  ['pincushion', 'Pincushion', 'pincushion', 'wool'],
  ['reels', 'Cotton reels', 'cotton reels', 'wool'],
  ['sweater', 'Yellow sweater', 'sweater', 'wool'],
  ['thimble', 'Thimble and needle', 'thimble', 'wool'],
  ['quilts', 'Folded quilts', 'quilts', 'wool'],
  ['logcabin', 'Log cabin quilt', 'quilt block', 'wool'],
  ['hoop', 'Embroidery hoop', 'embroidery', 'wool'],
  ['knitting', 'Knitting', 'knitting', 'wool'],
  ['workbasket', 'Workbasket', 'workbasket', 'wool', { slots: 3 }],
  ['buttons', 'Jar of buttons', 'button jar', 'wool', { bench: 2 }],
  ['sewing', 'Sewing machine', 'sewing machine', 'wool', { slots: 3 }],
  ['starfish', 'Starfish', 'starfish', 'water'],
  ['whale', 'Whale tail', 'whale', 'water'],
  ['seashell', 'Scallop shell', 'shell', 'water'],
  ['swan', 'Swan', 'swan', 'water'],
  ['jellyfish', 'Jellyfish', 'jellyfish', 'water'],
  ['crab', 'Crab on the sand', 'crab', 'water', { slots: 3 }],
  ['duck', 'Mallard', 'mallard', 'water'],
  ['frog', 'Frog on a lily pad', 'frog', 'water', { bench: 2 }],
  ['anchor', 'Anchor', 'anchor', 'water', { slots: 3 }],
  ['koi', 'Koi', 'koi', 'water', { slots: 3 }],
  ['rowboat', 'Rowing boat', 'rowing boat', 'water', { slots: 3, bench: 2 }],
  ['acorn', 'Acorn', 'acorn', 'woodland'],
  ['rabbit', 'Rabbit', 'rabbit', 'woodland'],
  ['pinecone', 'Pine cone', 'pine cone', 'woodland'],
  ['robin', 'Robin on a twig', 'robin', 'woodland'],
  ['umbrella', 'Umbrella in the rain', 'umbrella', 'woodland', { slots: 3 }],
  ['squirrel', 'Squirrel', 'squirrel', 'woodland'],
  ['branch', 'Autumn branch', 'autumn branch', 'woodland'],
  ['dog', 'Dog in a scarf', 'dog', 'woodland', { bench: 2 }],
  ['woodpecker', 'Woodpecker', 'woodpecker', 'woodland', { slots: 3 }],
  ['deer', 'Deer', 'deer', 'woodland', { slots: 3 }],
  ['market', 'Market stall', 'market stall', 'woodland', { slots: 3, bench: 2 }],
  ['candle', 'Candle', 'candle', 'winter'],
  ['snowflake', 'Snowflake', 'snowflake', 'winter'],
  ['moon', 'Moon over the hills', 'moon', 'winter'],
  ['snowman', 'Snowman', 'snowman', 'winter'],
  ['holly', 'Holly', 'holly', 'winter', { slots: 3 }],
  ['lantern', 'Lantern', 'lantern', 'winter'],
  ['pine', 'Snowy pine', 'pine', 'winter', { bench: 2 }],
  ['sledge', 'Sledge', 'sledge', 'winter', { slots: 3 }],
  ['sleepycat', 'Cat asleep', 'sleeping cat', 'winter', { slots: 3 }],
  ['gingerbread', 'Gingerbread house', 'gingerbread house', 'winter', { slots: 3, bench: 2 }],
  ['carousel', 'Carousel horse', 'carousel horse', 'winter', { slots: 3, bench: 2 }],
];

// Ready-to-play levels: art + lanes + a known solution (verified by the tests).
export const LEVELS = DEFS.map(([id, name, noun, chapter, extra = {}]) => {
  const q = QUEUES[id] || { queues: [], locks: [], solution: '', stats: null };
  const L = buildLevel({ id, name, noun, ...extra, art: ART[id].split('/'), queues: q.queues, locks: q.locks, cover: q.cover || extra.cover, left: q.left });
  const mech = mechanicsOf(L);
  if (L.slots < 4) mech.add('belt3');
  if (L.bench < 3) mech.add('bench2');
  return { ...L, chapter, solution: q.solution, stats: q.stats, sig: levelSig(L), mechanics: [...mech] };
});
export const LEVEL_IDS = Object.freeze(LEVELS.map((L) => L.id));
const BY_ID = new Map(LEVELS.map((L) => [L.id, L]));
export const levelById = (id) => BY_ID.get(id) || null;
const CH_BY_ID = new Map(CHAPTERS.map((c, i) => [c.id, i]));
/** chapterIndex(levelId) -> the index in CHAPTERS of the chapter a painting hangs in (-1 when unknown). */
export const chapterIndex = (id) => { const L = BY_ID.get(id); return L ? CH_BY_ID.get(L.chapter) : -1; };
