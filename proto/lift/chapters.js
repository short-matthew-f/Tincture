// The Lifting Table: palette, mechanics, chapters and the painting definitions
// (pure data; levels.js builds the playable paintings from these).
// Art rows are literal letters ("sssoosss") or run-length ("s3 o2 s3", "s3o2s3").
// Lane queues, keys, muslin and jars left out, solutions and stats live in
// queues.js (written by gen-levels.mjs). Pictures: art.js (composed by
// art-gen.mjs) and art-imported.js (painted sources, import-art.mjs).
import { ART as ART_GEN } from './art.js';
import { ART_IMPORTED } from './art-imported.js';
import { PALETTE } from './palette.js';

// Pictures composed by art-gen.mjs, plus any imported from painted sources by
// import-art.mjs (an imported picture with the same id wins).
const ART = { ...ART_GEN, ...ART_IMPORTED };

export { PALETTE };

// What each mechanic is called, and the one line that introduces it.
export const MECHANICS = {
  mystery: { name: 'Mystery jars', line: 'A “?” jar keeps its color secret until it reaches the front of its lane.' },
  linked: { name: 'Tied jars', line: 'Two jars tied with string go onto the belt together, so they need two free places.' },
  mixing: { name: 'Mixing jars', line: 'A mixing jar lifts two colors, a set amount of each, and they blend as it fills.' },
  cloth: { name: 'Muslin cloth', line: 'Nothing lifts through the muslin. It lifts away once a column beside it is bare.' },
  key: { name: 'Keys', line: 'A padlocked lane opens once you lift its key cell out of the painting.' },
  belt3: { name: 'A shorter belt', line: 'Only three jars ride the belt at once on this painting.' },
  bench2: { name: 'A smaller bench', line: 'The bench has two resting spots here, so park with care.' },
  crock: { name: 'Stoneware crocks', line: 'A crock is too heavy for the bench. Once it is on the belt, it rides until it fills.' },
  leftover: { name: 'A jar left out', line: 'Someone left a jar resting on the bench. Bring it to the belt when its color shows.' },
};

// Generation knobs (see gen-levels.mjs): lanes; target casual clear rate; and
// the chances the generator uses for each mechanic. The first 27 paintings
// (chapters 1 to 3) keep their own knobs, art and lanes exactly as they were.
const FIRST_DEFS = [
  // ---- learning the table ----
  { id: 'sun', name: 'Morning sun', noun: 'morning sun', lanes: 2, gen: { target: 0.95, caps: [5, 8, 10] },
    art: ['ssssssss', 'sssoosss', 'ssooooss', 'ssooooss', 'sssoosss', 'ssssssss', 'gggsssgg', 'gggggggg'] },
  { id: 'tulip', name: 'Tulip', noun: 'tulip', lanes: 2, gen: { target: 0.9, future: 0.05 },
    art: ['ccccccccc', 'ccrcrcrcc', 'ccrrrrrcc', 'ccrrprrcc', 'cccrrrccc', 'ccccgcccc', 'cggcgcggc', 'ccgggggcc',
      'cckkkkkcc', 'ccckkkccc', 'ccckkkccc'] },
  { id: 'teacup', name: 'Teacup', noun: 'teacup', lanes: 3, gen: { target: 0.85, future: 0.1 },
    art: ['hhhhhhhhhhh', 'hhhhchchhhh', 'hhhchchhhhh', 'hcaaaaaachh', 'hccbccbccch', 'hcbcbcbcchc', 'hccbccbccch',
      'hhcccccchhh', 'hllllllllhh', 'hhhhhhhhhhh'] },
  { id: 'sail', name: 'Sailboat', noun: 'sailboat', lanes: 3, gen: { target: 0.8, future: 0.15 },
    art: ['sssssssssss', 'ssssskrssss', 'sssscksssss', 'ssscckcssss', 'ssccckccsss', 'scccckcccss', 'sssssksssss',
      'skkkkkkkkks', 'sskkkkkkkss', 'bbbbbbbbbbb', 'bbsbbbbbsbb'] },
  // ---- mystery jars ----
  { id: 'skein', name: 'Skein of wool', noun: 'skein', lanes: 3, art: ART.skein, gen: { target: 0.6, future: 0.15, mystery: 0.35, caps: [5, 8, 10, 12] } },
  { id: 'mushrooms', name: 'Toadstools', noun: 'toadstools', lanes: 3, art: ART.mushrooms, gen: { target: 0.5, future: 0.2, mystery: 0.3, caps: [8, 10, 12, 15] } },
  { id: 'sheep', name: 'Sheep in the meadow', noun: 'sheep', lanes: 4, art: ART.sheep, gen: { target: 0.42, future: 0.25, mystery: 0.3, caps: [8, 10, 12, 15] } },
  // ---- tied jars ----
  { id: 'cherries', name: 'Cherries', noun: 'cherries', lanes: 3, art: ART.cherries, gen: { target: 0.45, future: 0.15, link: 0.3, caps: [8, 10, 12, 15] } },
  { id: 'cottage', name: 'Cottage garden', noun: 'cottage garden', lanes: 4, art: ART.cottage, gen: { target: 0.3, future: 0.25, link: 0.25, mystery: 0.2, caps: [8, 10, 12, 15, 20] } },
  { id: 'apple', name: 'Apple tree', noun: 'apple tree', lanes: 4, art: ART.apple, gen: { target: 0.17, future: 0.3, link: 0.25, mystery: 0.25, caps: [8, 10, 12, 15, 20] } },
  // ---- mixing jars ----
  { id: 'lighthouse', name: 'Lighthouse at sunset', noun: 'lighthouse', lanes: 4, art: ART.lighthouse, gen: { target: 0.3, future: 0.25, mix: 0.35, caps: [10, 12, 15, 20] } },
  { id: 'cat', name: 'Cat on the sill', noun: 'cat', lanes: 4, art: ART.cat, gen: { target: 0.2, future: 0.3, mix: 0.25, link: 0.2, mystery: 0.25, caps: [10, 12, 15, 20] } },
  { id: 'teapot', name: 'Tea for two', noun: 'tea table', lanes: 4, art: ART.teapot, gen: { target: 0.12, future: 0.35, mix: 0.25, link: 0.2, mystery: 0.25, caps: [10, 12, 15, 20] } },
  // ---- muslin cloth ----
  { id: 'quilt', name: 'Quilt on the line', noun: 'quilt', lanes: 4, cover: [13], art: ART.quilt, gen: { target: 0.1, future: 0.15, mix: 0.1, caps: [10, 12, 15, 20] } },
  { id: 'hedgehog', name: 'Hedgehog in the leaves', noun: 'hedgehog', lanes: 4, cover: [12], art: ART.hedgehog, gen: { target: 0.07, future: 0.2, mix: 0.2, link: 0.2, mystery: 0.3, caps: [10, 12, 15, 20] } },
  { id: 'bee', name: 'Bee and clover', noun: 'bee and clover', lanes: 4, cover: [6, 17], art: ART.bee, gen: { target: 0.05, future: 0.25, mix: 0.25, link: 0.2, mystery: 0.3, caps: [10, 12, 15, 20] } },
  // ---- keys ----
  { id: 'birdhouse', name: 'Birdhouse', noun: 'birdhouse', lanes: 4, art: ART.birdhouse, gen: { target: 0.06, future: 0.3, link: 0.15, locks: 1, caps: [10, 12, 15, 20] } },
  { id: 'loom', name: 'Half-woven cloth', noun: 'weaving', lanes: 4, art: ART.loom, gen: { target: 0.04, future: 0.4, mix: 0.2, link: 0.2, mystery: 0.25, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'owl', name: 'Owl at night', noun: 'owl', lanes: 4, cover: [12], art: ART.owl, gen: { target: 0.03, future: 0.4, mix: 0.25, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  // ---- the whole table ----
  { id: 'fox', name: 'Fox in autumn leaves', noun: 'fox', lanes: 4, slots: 3, cover: [14], art: ART.fox, gen: { target: 0.08, future: 0.35, mix: 0.2, link: 0.15, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'harbor', name: 'Harbor', noun: 'harbor', lanes: 4, slots: 3, cover: [12, 24], art: ART.harbor, gen: { target: 0.07, future: 0.4, mix: 0.25, link: 0.15, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'wheel', name: 'Spinning wheel', noun: 'spinning wheel', lanes: 4, slots: 3, cover: [20], art: ART.wheel, gen: { target: 0.06, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'dyepot', name: 'Dye pot on the fire', noun: 'dye pot', lanes: 4, slots: 3, bench: 2, cover: [14], art: ART.dyepot, gen: { target: 0.03, future: 0.5, mix: 0.3, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'strawberries', name: 'Bowl of strawberries', noun: 'strawberries', lanes: 4, slots: 3, bench: 2, cover: [7, 20], art: ART.strawberries, gen: { target: 0.05, future: 0.4, mix: 0.3, link: 0.2, mystery: 0.3, locks: 1, caps: [10, 12, 15, 20, 25] } },
  { id: 'mittens', name: 'Mittens on the line', noun: 'mittens', lanes: 4, slots: 3, bench: 2, cover: [15], art: ART.mittens, gen: { target: 0.04, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'village', name: 'Village at dusk', noun: 'village', lanes: 4, slots: 3, bench: 2, cover: [10, 20], art: ART.village, gen: { target: 0.03, future: 0.45, mix: 0.25, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
  { id: 'sampler', name: 'Cross-stitch sampler', noun: 'sampler', lanes: 4, slots: 3, bench: 2, cover: [14, 15], art: ART.sampler, gen: { target: 0.02, future: 0.45, mix: 0.3, link: 0.2, mystery: 0.3, locks: 2, caps: [10, 12, 15, 20, 25] } },
];


// ---- chapters 4 to 10 ----
// Every chapter climbs from a gentler start: eleven slots, the picture growing
// from 18x24 to 27x36 cells, the casual clear rate it aims for falling
// geometrically from `from` to `to`, and more planning ahead (future) as it
// goes. A slot's size, place and knobs belong to the painting's id, so its
// picture can be swapped for an imported one (import-art.mjs uses `size`) and
// re-dealt (gen-levels.mjs ONLY=<id>) without moving it.
const SLOT_SIZES = [[18, 24], [18, 24], [21, 28], [21, 28], [21, 28], [24, 32], [24, 32], [24, 32], [27, 36], [27, 36], [27, 36]];
const CAPS = { 18: [5, 8, 10, 12], 21: [8, 10, 12, 15], 24: [8, 10, 12, 15, 20], 27: [10, 12, 15, 20, 25] };
const r3 = (x) => Math.round(x * 1000) / 1000;
function slots(range, rows) {
  return rows.map(([id, name, noun, knobs], i) => {
    const f = i / (rows.length - 1);
    const [W, H] = SLOT_SIZES[i];
    const { lanes = 4, slots: belt, bench, ...gen } = knobs;
    return {
      id, name, noun, lanes, ...(belt ? { slots: belt } : {}), ...(bench ? { bench } : {}), size: [W, H], art: ART[id],
      gen: { target: r3(range.from * (range.to / range.from) ** f), future: r3(0.15 + 0.3 * f), caps: CAPS[W], ...gen },
    };
  });
}

const GARDEN = slots({ from: 0.45, to: 0.04 }, [
  ['sunflower', 'Sunflower', 'sunflower', { lanes: 3, mystery: 0.2 }],
  ['carrots', 'Carrots', 'carrots', { lanes: 3, link: 0.25 }],
  ['snail', 'Snail', 'snail', { mix: 0.25, mystery: 0.2 }],
  ['cactus', 'Cactus in a pot', 'cactus', { cloth: 1, link: 0.2 }],
  ['peapods', 'Pea pods', 'pea pods', { mix: 0.25, link: 0.2, mystery: 0.25 }],
  ['beehive', 'Straw beehive', 'beehive', { locks: 1, link: 0.15, mystery: 0.25 }],
  ['wateringcan', 'Watering can', 'watering can', { cloth: 1, mix: 0.25, link: 0.2 }],
  ['houseplant', 'House plant', 'house plant', { locks: 1, mix: 0.2, link: 0.2, mystery: 0.3 }],
  ['wheelbarrow', 'Wheelbarrow of seedlings', 'wheelbarrow', { slots: 3, cloth: 1, mix: 0.2, link: 0.15, mystery: 0.3 }],
  ['well', 'Stone well', 'well', { slots: 3, locks: 1, cloth: 1, mix: 0.25, link: 0.2, mystery: 0.3 }],
  ['gardengate', 'Garden gate', 'garden gate', { slots: 3, bench: 2, locks: 1, cloth: 1, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);
const COUNTRY = slots({ from: 0.4, to: 0.035 }, [
  ['rainbow', 'Rainbow over the hill', 'rainbow', { lanes: 3, link: 0.2 }],
  ['sunrise', 'Sunrise over the field', 'sunrise', { lanes: 3, mystery: 0.3 }],
  ['goose', 'Goose', 'goose', { mix: 0.3 }],
  ['kite', 'Kite on the hill', 'kite', { locks: 1, link: 0.2 }],
  ['barn', 'Red barn', 'barn', { cloth: 1, mystery: 0.25 }],
  ['balloon', 'Hot air balloon', 'balloon', { mix: 0.25, link: 0.2, mystery: 0.25 }],
  ['goat', 'Goat on the hill', 'goat', { slots: 3, link: 0.2, mystery: 0.25 }],
  ['alpaca', 'Alpaca', 'alpaca', { locks: 1, cloth: 1, mix: 0.2 }],
  ['windmill', 'Windmill', 'windmill', { slots: 3, locks: 1, mix: 0.25, link: 0.2, mystery: 0.3 }],
  ['cottagedoor', 'Cottage door', 'cottage door', { bench: 2, cloth: 2, mix: 0.2, link: 0.2, mystery: 0.3 }],
  ['bridge', 'Covered bridge', 'covered bridge', { slots: 3, bench: 2, locks: 2, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);
const KITCHEN = slots({ from: 0.4, to: 0.03 }, [
  ['pear', 'Pear', 'pear', { lanes: 3, mix: 0.2, link: 0.2 }],
  ['crock', 'Butter crock', 'butter crock', { lanes: 3, crock: 0.3 }],
  ['strawberry', 'Strawberry', 'strawberry', { crock: 0.25, mystery: 0.25 }],
  ['bread', 'Loaf of bread', 'loaf', { crock: 0.25, link: 0.2 }],
  ['honeypot', 'Honey pot', 'honey pot', { crock: 0.2, mix: 0.25 }],
  ['pumpkin', 'Pumpkin', 'pumpkin', { crock: 0.25, cloth: 1, mystery: 0.25 }],
  ['croissant', 'Croissant', 'croissant', { crock: 0.2, locks: 1, link: 0.2 }],
  ['copperpan', 'Copper pan', 'copper pan', { crock: 0.25, mix: 0.25, link: 0.2, mystery: 0.3 }],
  ['jam', 'Jar of jam', 'jam jar', { slots: 3, crock: 0.2, cloth: 1, locks: 1, mystery: 0.3 }],
  ['eggs', 'Basket of eggs', 'basket of eggs', { bench: 2, crock: 0.25, mix: 0.25, link: 0.2, mystery: 0.3 }],
  ['cake', 'Slice of cake', 'cake', { slots: 3, bench: 2, crock: 0.2, locks: 1, cloth: 1, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);
const WOOL = slots({ from: 0.35, to: 0.025 }, [
  ['pincushion', 'Pincushion', 'pincushion', { lanes: 3, crock: 0.2, mystery: 0.25 }],
  ['reels', 'Cotton reels', 'cotton reels', { lanes: 3, left: 1 }],
  ['sweater', 'Yellow sweater', 'sweater', { left: 1, mystery: 0.25 }],
  ['thimble', 'Thimble and needle', 'thimble', { left: 1, link: 0.2 }],
  ['quilts', 'Folded quilts', 'quilts', { crock: 0.2, mix: 0.25 }],
  ['logcabin', 'Log cabin quilt', 'quilt block', { left: 1, mix: 0.2, link: 0.2 }],
  ['hoop', 'Embroidery hoop', 'embroidery', { locks: 1, crock: 0.2, mystery: 0.3 }],
  ['knitting', 'Knitting', 'knitting', { left: 2, mix: 0.2, link: 0.2 }],
  ['workbasket', 'Workbasket', 'workbasket', { slots: 3, left: 1, crock: 0.2, mystery: 0.3 }],
  ['buttons', 'Jar of buttons', 'button jar', { bench: 2, locks: 1, cloth: 1, mix: 0.25, link: 0.2 }],
  ['sewing', 'Sewing machine', 'sewing machine', { slots: 3, left: 2, locks: 1, crock: 0.2, mix: 0.2, link: 0.2, mystery: 0.3 }],
]);
const WATER = slots({ from: 0.3, to: 0.02 }, [
  ['starfish', 'Starfish', 'starfish', { lanes: 3, link: 0.25, mystery: 0.25 }],
  ['whale', 'Whale tail', 'whale', { lanes: 3, crock: 0.25, mix: 0.2 }],
  ['seashell', 'Scallop shell', 'shell', { left: 1, mix: 0.25 }],
  ['swan', 'Swan', 'swan', { cloth: 1, mystery: 0.3 }],
  ['jellyfish', 'Jellyfish', 'jellyfish', { locks: 1, crock: 0.2, link: 0.2 }],
  ['crab', 'Crab on the sand', 'crab', { slots: 3, mix: 0.25, mystery: 0.25 }],
  ['duck', 'Mallard', 'mallard', { left: 1, cloth: 1, link: 0.2 }],
  ['frog', 'Frog on a lily pad', 'frog', { bench: 2, locks: 1, mix: 0.25, mystery: 0.3 }],
  ['anchor', 'Anchor', 'anchor', { slots: 3, cloth: 2, crock: 0.2, link: 0.2 }],
  ['koi', 'Koi', 'koi', { slots: 3, left: 1, locks: 1, mix: 0.25, mystery: 0.3 }],
  ['rowboat', 'Rowing boat', 'rowing boat', { slots: 3, bench: 2, locks: 1, cloth: 1, crock: 0.2, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);
const WOODLAND = slots({ from: 0.25, to: 0.015 }, [
  ['acorn', 'Acorn', 'acorn', { lanes: 3, mix: 0.25, link: 0.2 }],
  ['rabbit', 'Rabbit', 'rabbit', { lanes: 3, left: 1, mystery: 0.3 }],
  ['pinecone', 'Pine cone', 'pine cone', { crock: 0.25, cloth: 1 }],
  ['robin', 'Robin on a twig', 'robin', { locks: 1, mix: 0.25, mystery: 0.25 }],
  ['umbrella', 'Umbrella in the rain', 'umbrella', { slots: 3, link: 0.2, mystery: 0.25 }],
  ['squirrel', 'Squirrel', 'squirrel', { left: 1, crock: 0.2, mix: 0.2 }],
  ['branch', 'Autumn branch', 'autumn branch', { cloth: 2, locks: 1, mystery: 0.3 }],
  ['dog', 'Dog in a scarf', 'dog', { bench: 2, crock: 0.2, mix: 0.25, link: 0.2 }],
  ['woodpecker', 'Woodpecker', 'woodpecker', { slots: 3, left: 1, locks: 1, mystery: 0.3 }],
  ['deer', 'Deer', 'deer', { slots: 3, cloth: 1, crock: 0.2, mix: 0.25, link: 0.2, mystery: 0.3 }],
  ['market', 'Market stall', 'market stall', { slots: 3, bench: 2, locks: 2, crock: 0.15, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);
const WINTER = slots({ from: 0.2, to: 0.01 }, [
  ['candle', 'Candle', 'candle', { lanes: 3, link: 0.2, mystery: 0.3 }],
  ['snowflake', 'Snowflake', 'snowflake', { lanes: 3, left: 1, mix: 0.2 }],
  ['moon', 'Moon over the hills', 'moon', { cloth: 1, crock: 0.2, mystery: 0.25 }],
  ['snowman', 'Snowman', 'snowman', { locks: 1, mix: 0.25, link: 0.2 }],
  ['holly', 'Holly', 'holly', { slots: 3, crock: 0.2, mystery: 0.3 }],
  ['lantern', 'Lantern', 'lantern', { left: 1, cloth: 1, mix: 0.25, link: 0.2 }],
  ['pine', 'Snowy pine', 'pine', { bench: 2, locks: 1, mix: 0.2, mystery: 0.3 }],
  ['sledge', 'Sledge', 'sledge', { slots: 3, left: 1, crock: 0.25, link: 0.2 }],
  ['sleepycat', 'Cat asleep', 'sleeping cat', { slots: 3, cloth: 1, locks: 1, mix: 0.25, mystery: 0.3 }],
  ['gingerbread', 'Gingerbread house', 'gingerbread house', { slots: 3, bench: 2, left: 1, crock: 0.2, mix: 0.25, link: 0.2 }],
  ['carousel', 'Carousel horse', 'carousel horse', { slots: 3, bench: 2, locks: 2, cloth: 1, crock: 0.2, mix: 0.25, link: 0.2, mystery: 0.3 }],
]);

// The gallery wall's rooms. A chapter opens once every painting of the one
// before is lifted; inside a chapter, each painting opens once the one before it
// is lifted (src/sim/lift.js). `line` is the chapter's intro card.
const BOOK = [
  { id: 'first', name: 'First paintings', line: 'Small, bright pictures to learn the table on.', defs: FIRST_DEFS.slice(0, 10) },
  { id: 'tricks', name: 'New tricks', line: 'Mixing jars, muslin and keys join the table, one at a time.', defs: FIRST_DEFS.slice(10, 19) },
  { id: 'table', name: 'The whole table', line: 'Bigger paintings, a shorter belt and a smaller bench: every trick at once.', defs: FIRST_DEFS.slice(19) },
  { id: 'garden', name: 'The kitchen garden', line: 'Sunflowers, snails and a well-worn gate. A gentler start, then the garden grows.', defs: GARDEN },
  { id: 'country', name: 'Out in the country', line: 'Barns, geese and windmills under wide skies.', defs: COUNTRY },
  { id: 'kitchen', name: 'The country kitchen', line: 'Warm bread, jam, and a stoneware crock or two.', defs: KITCHEN },
  { id: 'wool', name: 'Wool and thread', line: 'Reels, quilts and buttons, and a jar someone left out on the bench.', defs: WOOL },
  { id: 'water', name: 'By the water', line: 'Boats, swans and the things that live in the shallows.', defs: WATER },
  { id: 'woodland', name: 'Woodland and autumn', line: 'Acorns, robins and a walk through the falling leaves.', defs: WOODLAND },
  { id: 'winter', name: 'Winter evenings', line: 'Candlelight, snow, and a carousel at the winter fair.', defs: WINTER },
];

export const LEVEL_DEFS = BOOK.flatMap((ch) => ch.defs.map((d) => ({ ...d, chapter: ch.id })));
let at = 0;
export const CHAPTERS = BOOK.map(({ id, name, line, defs }) => { const c = { id, name, line, from: at, to: at + defs.length }; at += defs.length; return c; });
