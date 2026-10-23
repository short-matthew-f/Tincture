// puzzles/garden.js — The Dye Garden's rules (pure). Ported from
// proto/garden/rules.js (playtested); the only additions are each place's
// `region` (the map region it sits by, src/content/regions.js) and gardenFor(),
// a small memo so the screen and the sim share one generated garden.
// No window/document/Date.now/Math.random.
// A garden is generated from (place id, seed) with a seeded mulberry32 RNG.
// Plants are circles in world units; the basket is a circle whose radius grows
// with every plant gathered. A plant fits when its radius is at most
// OPENING x the basket radius, and tips in when its center is over the basket.
//
// Two modes share one garden layout: Wander (no clock) and Harvest before dusk
// (about two minutes, a fixed seed per place so bests are fair, a friendly goat).
// The only differences are the growth rate, the clock and the goat.

export const GEN = 2; // generation version: saved visits from another version are not resumed
export const OPENING = 0.95; // a plant fits if r <= OPENING * basket radius
export const R0 = 8.2; // starting basket radius: only the smallest plants fit
export const GROW_EXP = 1.5; // growth per plant = r^GROW_EXP (bigger finds count for more)
export const TEETER = 1.3; // plants up to this much too big wobble on the rim
export const JAR = 24; // dye units per jar
export const VARIANTS = 3; // drawing variants per species
export const COMBO_GAP = 0.5; // seconds between gathers that still count as one sweep
export const COMBO_SPAN = 2.2; // a sweep lasts at most this long; then a new one starts

// ---------- seeded RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** One mulberry32 step on an object's own state (o.rs), so a stepped thing (the goat) is plain data. */
function nextRand(o) {
  o.rs = (o.rs + 0x6D2B79F5) >>> 0;
  let t = o.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ---------- modes ----------
// landAt: the share of the non-landmark growth after which the biggest landmark fits.
// scale: a harvest field is a little bigger than a wander one, with more to gather than
// two minutes allow, so the race is how much (and whether the landmarks come in), not clearing it.
export const MODES = Object.freeze({
  wander: Object.freeze({ id: 'wander', name: 'Wander', timed: false, secs: 0, goat: false, landAt: 0.92, scale: 1 }),
  harvest: Object.freeze({ id: 'harvest', name: 'Harvest before dusk', timed: true, secs: 120, goat: true, landAt: 0.6, scale: 1.45 }),
});
/** The seed for a place and mode. Wander takes any seed; a harvest is fixed per place (or per day). */
export function harvestSeed(placeId, day = '') {
  return (hashStr('harvest:' + placeId + (day ? ':' + day : '')) || 1) >>> 0;
}

// ---------- dyes (the jars) ----------
export const DYES = Object.freeze({
  chamomile: { name: 'Chamomile gold', hex: '#E0B43C' },
  marigold: { name: 'Marigold gold', hex: '#E89A2C' },
  cosmos: { name: 'Cosmos orange', hex: '#E5822E' },
  onion: { name: 'Onion-skin rust', hex: '#B8642F' },
  lichen: { name: 'Lichen tan', hex: '#B49A64' },
  coreopsis: { name: 'Coreopsis orange', hex: '#D9702A' },
  woad: { name: 'Woad blue', hex: '#4F7BAE' },
  oakgray: { name: 'Oak gall gray', hex: '#7C7A72' },
  oaktan: { name: 'Oak tan', hex: '#9E7A4C' },
  avocado: { name: 'Avocado pink', hex: '#D79A90' },
  weld: { name: 'Weld yellow', hex: '#DCC236' },
  broom: { name: 'Broom yellow', hex: '#CDB83C' },
  seaweed: { name: 'Seaweed tan', hex: '#9C8A55' },
  logwood: { name: 'Logwood purple', hex: '#5E3A6E' },
  madder: { name: 'Madder red', hex: '#B8433A' },
  sumac: { name: 'Sumac tan', hex: '#A8875A' },
  walnut: { name: 'Walnut brown', hex: '#6B4A2B' },
  cochineal: { name: 'Cochineal crimson', hex: '#B5213F' },
  indigo: { name: 'Indigo blue', hex: '#2E3F6E' },
});

// ---------- facts (short, true, conservative) ----------
export const FACTS = Object.freeze({
  chamomile: "Dyer's chamomile is a different plant from tea chamomile. Its golden flower heads give clear yellows.",
  marigold: 'Marigold flower heads give warm yellows and golds, and they dry well, so a summer of picking can be saved for winter dye pots.',
  cosmos: 'Sulphur cosmos gives bright oranges and golds. Picking the flowers keeps the plant blooming.',
  onion: 'Dry yellow onion skins give warm oranges and rusts. No garden needed: just save them from the kitchen.',
  lichen: 'Many lichens grow only a tiny fraction of an inch a year, so careful dyers gather only pieces that have already fallen.',
  coreopsis: 'Dyer\'s coreopsis gives bright yellows and oranges. A little washing soda in the bath can shift it toward a deeper orange.',
  woad: 'Woad and indigo hold the same blue, indigotin. Woad leaves simply hold less of it than indigo leaves do.',
  galls: 'Oak galls are rich in tannin. With a little iron they turn gray to black, and for centuries they were the base of iron gall ink.',
  oak: 'Acorns and oak bark are full of tannin. Alone they give tans and browns; a little iron turns them gray.',
  avocado: 'Avocado pits and skins, saved from the kitchen, can give soft pinks and peachy tans.',
  weld: 'Weld gives a clear, lightfast yellow. Dyed over woad or indigo, it makes greens.',
  broom: 'Dyer\'s broom gives yellow. Dyed over woad, it made the "Kendal green" of northern England.',
  seaweed: 'Brown seaweeds like bladderwrack can give soft tans and browns. Gather only what has washed up.',
  logwood: 'Logwood chips give purples, and with a touch of iron, deep grays and blacks.',
  madder: 'Madder roots need about three years in the ground before they give their best reds.',
  sumac: 'Sumac leaves are rich in tannin. Alone they give tans; with a little iron they give soft grays.',
  walnut: 'Walnut hulls give rich browns with no mordant at all, because they carry their own tannins.',
  cochineal: 'Cochineal is a tiny insect that lives on prickly-pear pads. It takes tens of thousands of them to make a pound of dye.',
  indigo: 'Indigo does not dissolve in plain water. In the vat it turns yellow-green, and cloth turns blue as it meets the air.',
});

// ---------- species ----------
// r: base radius in world units (each plant varies by +-5%). many: a plural for combo and goal lines.
// shape: the sprite drawer in sprites.js. grand: the crescendo plants. landmark: the very last,
// biggest things (a cart, a shed, a vat, a tree, a boat). the: how a landmark is named in a sentence.
const sp = (o) => Object.freeze({ grand: false, landmark: false, ...o });
export const SPECIES = Object.freeze({
  chamomile: sp({ name: "Dyer's chamomile", many: 'chamomile', dye: 'chamomile', fact: 'chamomile', r: 6.4, shape: 'daisy' }),
  marigold: sp({ name: 'Marigold heads', many: 'marigolds', dye: 'marigold', fact: 'marigold', r: 7.2, shape: 'pompom' }),
  cosmos: sp({ name: 'Sulphur cosmos', many: 'cosmos', dye: 'cosmos', fact: 'cosmos', r: 7.0, shape: 'cosmos' }),
  onion: sp({ name: 'Onion skins', many: 'onion skins', dye: 'onion', fact: 'onion', r: 6.8, shape: 'curls' }),
  lichen: sp({ name: 'Lichen', many: 'lichen', dye: 'lichen', fact: 'lichen', r: 6.2, shape: 'lichen' }),
  acorns: sp({ name: 'Acorns', many: 'acorns', dye: 'oaktan', fact: 'oak', r: 6.8, shape: 'acorns' }),
  coreopsis: sp({ name: 'Coreopsis', many: 'coreopsis', dye: 'coreopsis', fact: 'coreopsis', r: 10.2, shape: 'coreopsis' }),
  woad: sp({ name: 'Woad leaves', many: 'woad rosettes', dye: 'woad', fact: 'woad', r: 11.2, shape: 'rosette' }),
  galls: sp({ name: 'Oak galls', many: 'oak galls', dye: 'oakgray', fact: 'galls', r: 9.8, shape: 'galls' }),
  avocado: sp({ name: 'Avocado pits', many: 'avocado pits', dye: 'avocado', fact: 'avocado', r: 10.6, shape: 'pits' }),
  weld: sp({ name: 'Weld', many: 'weld plants', dye: 'weld', fact: 'weld', r: 15.5, shape: 'spike' }),
  broom: sp({ name: "Dyer's broom", many: 'broom bushes', dye: 'broom', fact: 'broom', r: 16.2, shape: 'shrub' }),
  seaweed: sp({ name: 'Bladderwrack', many: 'bladderwrack', dye: 'seaweed', fact: 'seaweed', r: 14.8, shape: 'seaweed' }),
  logwood: sp({ name: 'Logwood chips', many: 'logwood piles', dye: 'logwood', fact: 'logwood', r: 15.2, shape: 'chips' }),
  oakbark: sp({ name: 'Oak bark', many: 'oak bark pieces', dye: 'oaktan', fact: 'oak', r: 15.8, shape: 'bark' }),
  madder: sp({ name: 'Madder roots', many: 'madder roots', dye: 'madder', fact: 'madder', r: 21.5, shape: 'madder' }),
  sumac: sp({ name: 'Staghorn sumac', many: 'sumac bushes', dye: 'sumac', fact: 'sumac', r: 22.8, shape: 'sumac' }),
  walnut: sp({ name: 'Walnut hulls', many: 'walnut hulls', dye: 'walnut', fact: 'walnut', r: 20.5, shape: 'hulls' }),
  pad: sp({ name: 'Cochineal on a prickly-pear pad', many: 'cochineal pads', dye: 'cochineal', fact: 'cochineal', r: 22.0, shape: 'pad' }),
  indigo: sp({ name: 'Indigo bush', many: 'indigo bushes', dye: 'indigo', fact: 'indigo', r: 30.5, shape: 'bush' }),
  madderBed: sp({ name: 'Old madder bed', many: 'madder beds', dye: 'madder', fact: 'madder', r: 41, shape: 'madderBed', grand: true }),
  sumacGrove: sp({ name: 'Sumac thicket', many: 'sumac thickets', dye: 'sumac', fact: 'sumac', r: 42, shape: 'grove', grand: true }),
  walnutTree: sp({ name: 'Black walnut tree', many: 'walnut trees', dye: 'walnut', fact: 'walnut', r: 45, shape: 'tree', grand: true }),
  indigoHedge: sp({ name: 'Indigo hedge in flower', many: 'indigo hedges', dye: 'indigo', fact: 'indigo', r: 41, shape: 'hedge', grand: true }),
  cactus: sp({ name: 'Prickly-pear cactus with cochineal', many: 'prickly pears', dye: 'cochineal', fact: 'cochineal', r: 44, shape: 'cactus', grand: true }),
  // landmarks: only fit at the very end
  hayCart: sp({ name: 'Hay cart full of weld', the: 'the hay cart', many: 'hay carts', dye: 'weld', fact: 'weld', r: 53, shape: 'cart', landmark: true }),
  walnutCart: sp({ name: 'Cart of walnut hulls', the: 'the walnut cart', many: 'carts', dye: 'walnut', fact: 'walnut', r: 53, shape: 'cart', landmark: true }),
  shed: sp({ name: 'Garden shed hung with marigolds', the: 'the garden shed', many: 'sheds', dye: 'marigold', fact: 'marigold', r: 60, shape: 'shed', landmark: true }),
  beachHut: sp({ name: 'Beach hut drying sumac', the: 'the beach hut', many: 'huts', dye: 'sumac', fact: 'sumac', r: 59, shape: 'shed', landmark: true }),
  adobeShed: sp({ name: 'Potting shed of cosmos', the: 'the potting shed', many: 'sheds', dye: 'cosmos', fact: 'cosmos', r: 59, shape: 'shed', landmark: true }),
  vat: sp({ name: 'Indigo dye vat', the: 'the indigo vat', many: 'vats', dye: 'indigo', fact: 'indigo', r: 56, shape: 'vat', landmark: true }),
  cochVat: sp({ name: 'Cochineal dye vat', the: 'the cochineal vat', many: 'vats', dye: 'cochineal', fact: 'cochineal', r: 54, shape: 'vat', landmark: true }),
  oak: sp({ name: 'Old oak tree', the: 'the old oak', many: 'oaks', dye: 'oaktan', fact: 'oak', r: 62, shape: 'oak', landmark: true }),
  boat: sp({ name: 'Rowing boat of bladderwrack', the: 'the rowing boat', many: 'boats', dye: 'seaweed', fact: 'seaweed', r: 54, shape: 'boat', landmark: true }),
});
export const isBig = (s) => SPECIES[s].grand || SPECIES[s].landmark;

// ---------- places ----------
// mix: [species, count]. zone: [x0, y0, x1, y1] as fractions of the field.
// rows: plants line up along terraces (the hillside).
export const PLACES = Object.freeze([
  {
    id: 'meadow', name: 'The Meadow', size: [800, 1100], ground: 'meadow',
    blurb: 'Summer flowers in long grass, an old madder bed by the fence, a hay cart and the garden shed.',
    mix: [['chamomile', 124], ['marigold', 100], ['coreopsis', 76], ['woad', 56], ['weld', 42], ['broom', 32], ['madder', 34], ['madderBed', 4], ['hayCart', 1], ['shed', 1]],
  },
  {
    id: 'shore', name: 'The Shoreline', size: [780, 1080], ground: 'shore',
    blurb: 'Lichen on the rocks, bladderwrack at the tide line, sumac on the dunes, and a boat pulled up.',
    mix: [['lichen', 120], ['chamomile', 80], ['woad', 54], ['seaweed', 66], ['broom', 30], ['sumac', 34], ['sumacGrove', 4], ['boat', 1], ['beachHut', 1]],
    zones: { lichen: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1], sumac: [0, 0, 0.6, 1], sumacGrove: [0, 0, 0.55, 1], boat: [0.62, 0.1, 0.9, 0.9], beachHut: [0.08, 0.1, 0.5, 0.9] },
  },
  {
    id: 'forest', name: 'The Forest Edge', size: [780, 1080], ground: 'forest',
    blurb: 'Mossy lichens, oak galls and acorns, walnuts dropping their hulls, and one very old oak.',
    mix: [['lichen', 116], ['acorns', 100], ['galls', 76], ['oakbark', 52], ['walnut', 38], ['walnutTree', 4], ['walnutCart', 1], ['oak', 1]],
  },
  {
    id: 'hillside', name: 'The Indigo Terraces', size: [800, 1100], ground: 'terraces', rows: 120,
    blurb: 'Terraced rows of indigo, with woad, weld and marigolds along the walls, and the indigo vat.',
    mix: [['marigold', 96], ['onion', 88], ['woad', 56], ['coreopsis', 42], ['weld', 38], ['madder', 24], ['indigo', 34], ['indigoHedge', 4], ['vat', 1], ['hayCart', 1]],
  },
  {
    id: 'cactus', name: 'The Cactus Garden', size: [780, 1060], ground: 'cactus',
    blurb: 'Prickly pears dusted with cochineal, logwood chips, sulphur cosmos and a cochineal vat.',
    mix: [['cosmos', 106], ['marigold', 70], ['avocado', 64], ['coreopsis', 36], ['logwood', 42], ['pad', 36], ['cactus', 4], ['cochVat', 1], ['adobeShed', 1]],
  },
].map((p) => Object.freeze(p)));
export const PLACE_BY_ID = Object.freeze(Object.fromEntries(PLACES.map((p) => [p.id, p])));
/** The map region (src/content/regions.js) each place sits by: shown as "By the Coast". */
export const PLACE_REGION = Object.freeze({ meadow: 'meadow', shore: 'coast', forest: 'jungle', hillside: 'quarry', cactus: 'volcano' });

const MEMO_MAX = 4;
const memo = new Map();
/**
 * gardenFor(placeId, seed, mode) -> the generated garden, memoized (a few kept),
 * so the screen and the sim's finishVisit share one. Generation is
 * deterministic, so the memo never changes an answer. Treat the result as
 * read-only.
 */
export function gardenFor(placeId, seed, mode = 'wander') {
  const m = MODES[mode] ? mode : 'wander';
  const key = `${placeId}|${seed >>> 0}|${m}`;
  if (memo.has(key)) {
    const g = memo.get(key);
    memo.delete(key);
    memo.set(key, g);
    return g;
  }
  const g = generate(placeId, seed, m);
  memo.set(key, g);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  return g;
}

// ---------- growth ----------
// The basket's area grows by G x (growth of each plant gathered):
//   radius = sqrt(R0^2 + G * sum of r^GROW_EXP).
// G is chosen per garden and mode so the biggest landmark fits once landAt of
// everything else's growth is in.
export const growthOf = (p) => Math.pow(p.r, GROW_EXP);
export const basketRadius = (g, mass) => Math.sqrt(R0 * R0 + g.G * mass);
/** open: the opening as a share of the basket radius (a wide brim raises it for a while). */
export const fits = (g, p, mass, open = OPENING) => p.r <= open * basketRadius(g, mass);
/** Too big, but only a little: it wobbles on the rim until the basket grows. */
export const teeters = (g, p, mass, open = OPENING) => !fits(g, p, mass, open) && p.r <= open * basketRadius(g, mass) * TEETER;
/** Mass needed before plant radius r fits. */
export const massToFit = (g, r) => Math.max(0, ((r / OPENING) ** 2 - R0 * R0) / g.G);
/** Is the plant's center over the basket (so it tips in when it fits)? */
export function over(bx, by, br, p) {
  const dx = p.x - bx, dy = p.y - by;
  return dx * dx + dy * dy <= br * br;
}

function computeG(plants, landAt) {
  let top = 0, wNon = 0;
  for (const p of plants) {
    if (SPECIES[p.s].landmark) top = Math.max(top, p.r);
    else wNon += growthOf(p);
  }
  if (!top) top = Math.max(...plants.map((p) => p.r));
  return ((top / OPENING) ** 2 - R0 * R0) / (landAt * wNon);
}

/** Gather the smallest fitting plant until done or stuck. Smallest-first is the
 *  exact feasibility check: if the smallest left does not fit, nothing does. */
export function greedyFinish(g) {
  const order = g.plants.map((p, i) => i).sort((a, b) => g.plants[a].r - g.plants[b].r || a - b);
  let mass = 0;
  const firstFit = {}; // species -> number gathered before it first fits
  for (let k = 0; k < order.length; k++) {
    const p = g.plants[order[k]];
    if (!fits(g, p, mass)) return { ok: false, gathered: k, mass, stuck: order[k], order: order.slice(0, k), firstFit };
    if (!(p.s in firstFit)) firstFit[p.s] = k;
    mass += growthOf(p);
  }
  return { ok: true, gathered: order.length, mass, order, firstFit };
}

// ---------- spatial grid ----------
export function buildGrid(plants, W, H, cell = 64) {
  const cols = Math.max(1, Math.ceil(W / cell)), rows = Math.max(1, Math.ceil(H / cell));
  const cells = Array.from({ length: cols * rows }, () => []);
  const grid = { cell, cols, rows, cells, maxR: 0 };
  plants.forEach((p, i) => gridAdd(grid, p, i));
  return grid;
}
function gridAdd(grid, p, i) {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor(p.x / grid.cell)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor(p.y / grid.cell)));
  grid.cells[r * grid.cols + c].push(i);
  grid.maxR = Math.max(grid.maxR, p.r);
}
/** Indices of plants whose centers lie in cells touching the box (x0..x1, y0..y1). */
export function queryGrid(grid, x0, y0, x1, y1, out = []) {
  const { cell, cols, rows } = grid;
  const c0 = Math.max(0, Math.floor(x0 / cell)), c1 = Math.min(cols - 1, Math.floor(x1 / cell));
  const r0 = Math.max(0, Math.floor(y0 / cell)), r1 = Math.min(rows - 1, Math.floor(y1 / cell));
  out.length = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const list = grid.cells[r * cols + c];
    for (let k = 0; k < list.length; k++) out.push(list[k]);
  }
  return out;
}

// ---------- generation ----------
export const tierOf = (r) => (r < 8 ? 1 : r < 13 ? 2 : r < 19 ? 3 : r < 27 ? 4 : r < 36 ? 5 : r < 48 ? 6 : 7);
export const FIND_KINDS = Object.freeze({
  brim: { name: 'Wide brim', secs: 9, open: 1.32, text: 'A wide brim! Bigger things fit' },
  breeze: { name: 'Breeze', secs: 7, reach: 2.6, text: 'A breeze! Little plants drift in' },
  spindle: { name: 'Lost spindle', secs: 0, text: 'You found a lost spindle!' },
});

export function generate(placeId, seed, mode = 'wander') {
  const place = PLACE_BY_ID[placeId];
  if (!place) throw new RangeError('unknown place ' + placeId);
  const M = MODES[mode] || MODES.wander;
  const rnd = mulberry32((seed >>> 0) ^ hashStr(placeId + (M.scale !== 1 ? ':' + M.id : '')));
  const W = Math.round(place.size[0] * M.scale), H = Math.round(place.size[1] * M.scale);
  const area = M.scale * M.scale;
  const start = { x: W / 2, y: H / 2 };
  const plants = [];
  const grid = buildGrid([], W, H, 64);
  const zones = place.zones || {};
  const counts = {};
  for (const [s, n] of place.mix) {
    counts[s] = SPECIES[s].landmark ? n : SPECIES[s].grand ? Math.round(n * area) : Math.max(1, Math.round(n * area * (0.92 + rnd() * 0.16)));
  }
  const smallest = place.mix.map(([s]) => s).filter((s) => tierOf(SPECIES[s].r) === 1);

  const clear = (x, y, r, s) => {
    const m = r + 10;
    if (x < m || y < m || x > W - m || y > H - m) return false;
    // keep the starting spot open for the first little ones
    if (tierOf(r) > 1 && Math.hypot(x - start.x, y - start.y) < 46 + r) return false;
    const reach = r + grid.maxR;
    const near = queryGrid(grid, x - reach, y - reach, x + reach, y + reach);
    for (const i of near) {
      const q = plants[i];
      const lm = SPECIES[s].landmark || SPECIES[q.s].landmark;
      const minD = (r + q.r) * (lm ? 1.02 : SPECIES[s].grand || SPECIES[q.s].grand ? 0.95 : 0.78);
      if ((q.x - x) ** 2 + (q.y - y) ** 2 < minD * minD) return false;
    }
    return true;
  };
  const snapRow = (s, y) => {
    if (!place.rows || tierOf(SPECIES[s].r) < 2) return y;
    const band = place.rows;
    return Math.floor(y / band) * band + band / 2 + (rnd() - 0.5) * band * 0.36;
  };
  const put = (s, x, y, snap = true) => {
    const r = SPECIES[s].r * (isBig(s) ? 1 : 0.95 + rnd() * 0.1);
    if (snap) y = snapRow(s, y);
    if (!clear(x, y, r, s)) return false;
    const p = { s, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 100) / 100, v: Math.floor(rnd() * VARIANTS), f: rnd() < 0.5 ? 1 : 0 };
    plants.push(p);
    gridAdd(grid, p, plants.length - 1);
    counts[s]--;
    return true;
  };
  const inZone = (s) => {
    const z = zones[s] || [0, 0, 1, 1];
    return [W * (z[0] + rnd() * (z[2] - z[0])), H * (z[1] + rnd() * (z[3] - z[1]))];
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  // 1. A ring of the smallest plants right around the start.
  for (let k = 0; k < 8; k++) {
    const s = pick(smallest);
    for (let t = 0; t < 20; t++) {
      const a = (k / 8) * Math.PI * 2 + rnd() * 0.5, d = 18 + rnd() * 26;
      if (put(s, start.x + Math.cos(a) * d, start.y + Math.sin(a) * d)) break;
    }
  }
  // 2. Landmarks, then the grand plants: well apart and away from the start.
  for (const kind of ['landmark', 'grand']) {
    for (const [s] of place.mix) {
      if (!SPECIES[s][kind]) continue;
      let tries = 0;
      while (counts[s] > 0 && tries++ < 600) {
        const [x, y] = inZone(s);
        if (Math.hypot(x - start.x, y - start.y) < Math.min(W, H) * (kind === 'landmark' ? 0.34 : 0.3)) continue;
        const far = plants.every((q) => !isBig(q.s) || Math.hypot(q.x - x, q.y - y) > (kind === 'landmark' ? 280 : 240));
        if (far) put(s, x, y, false);
      }
    }
  }
  // 3. Coverage: a small plant in every lattice cell, so something fits wherever she starts looking.
  const step = 110;
  for (let gy = 0; gy < H; gy += step) for (let gx = 0; gx < W; gx += step) {
    const s = pick(smallest);
    for (let t = 0; t < 30; t++) {
      const x = gx + rnd() * step, y = gy + rnd() * step;
      if (!put(s, x, y)) continue;
      // a little trio, so even the scattered ones come in twos and threes
      const a = place.rows ? 0 : rnd() * Math.PI * 2, gap = SPECIES[s].r * 2.1;
      for (let k = 1; k <= 2; k++) put(s, x + Math.cos(a) * gap * k, y + Math.sin(a) * gap * k, false);
      break;
    }
  }
  // 4. Swathes, biggest species first so they find room: rows to sweep along,
  //    round patches to plough through, and small clumps of the big ones.
  const row = (s, n, cx, cy) => {
    const r = SPECIES[s].r, gap = r * 2.12;
    let a = place.rows ? (rnd() < 0.5 ? 0 : Math.PI) : rnd() * Math.PI * 2;
    if (place.rows) cy = Math.floor(cy / place.rows) * place.rows + place.rows / 2 + (rnd() - 0.5) * 14;
    let x = cx, y = cy;
    for (let k = 0; k < n && counts[s] > 0; k++) {
      put(s, x, y, false);
      if (!place.rows) a += (rnd() - 0.5) * 0.22; // a gentle curve
      x += Math.cos(a) * gap; y += Math.sin(a) * gap;
    }
  };
  const patch = (s, n, cx, cy) => {
    const r = SPECIES[s].r, gap = r * 2.08;
    let placed = 0;
    for (let ring = 0; placed < n && ring < 5 && counts[s] > 0; ring++) {
      const m = ring === 0 ? 1 : ring * 6, a0 = rnd() * Math.PI;
      for (let k = 0; k < m && placed < n && counts[s] > 0; k++) {
        const a = a0 + (k / m) * Math.PI * 2, d = ring * gap + (rnd() - 0.5) * r * 0.3;
        if (put(s, cx + Math.cos(a) * d, cy + Math.sin(a) * d * (place.rows ? 0.5 : 1))) placed++;
      }
    }
  };
  const bySize = place.mix.map(([s]) => s).filter((s) => !isBig(s)).sort((a, b) => SPECIES[b].r - SPECIES[a].r);
  for (const s of bySize) {
    const t = tierOf(SPECIES[s].r);
    let guard = 0;
    while (counts[s] > 0 && guard++ < 260) {
      const [cx, cy] = inZone(s);
      const u = rnd();
      if (t <= 2) { if (u < 0.55) row(s, 8 + Math.floor(rnd() * 8), cx, cy); else patch(s, 8 + Math.floor(rnd() * 11), cx, cy); }
      else if (t === 3) { if (u < 0.5) row(s, 4 + Math.floor(rnd() * 4), cx, cy); else patch(s, 3 + Math.floor(rnd() * 5), cx, cy); }
      else patch(s, 2 + Math.floor(rnd() * 3), cx, cy);
    }
  }

  // Draw order: back to front.
  plants.sort((a, b) => a.y - b.y || a.x - b.x);
  const g = { v: GEN, place: placeId, seed: seed >>> 0, mode: M.id, W, H, start, plants, G: 0, finds: [] };
  // Balance with Wander's growth (the slowest), so the garden is finishable in either mode.
  g.G = computeG(plants, MODES.wander.landAt);

  // 5. Balance: if a size would never fit in smallest-first order, add more of
  //    the size just below it near its kin, and re-plan. Rare with these mixes.
  for (let guard = 0; guard < 300; guard++) {
    const res = greedyFinish(g);
    if (res.ok) break;
    const below = res.order.length ? g.plants[res.order[res.order.length - 1]].s : smallest[0];
    const kin = g.plants.filter((p) => p.s === below);
    const near = kin.length ? pick(kin) : start;
    let placed = false;
    for (let t = 0; t < 40 && !placed; t++) placed = put(below, near.x + (rnd() - 0.5) * 120, near.y + (rnd() - 0.5) * 120);
    if (!placed) for (let t = 0; t < 200 && !placed; t++) placed = put(below, rnd() * W, rnd() * H);
    plants.sort((a, b) => a.y - b.y || a.x - b.x);
    g.G = computeG(plants, MODES.wander.landAt);
  }
  plants.forEach((p, i) => { p.id = i; });
  g.G = computeG(plants, M.landAt);

  // 6. Sparkly finds: two wide brims, two breezes, and sometimes a lost spindle far out.
  const finds = [];
  const farOK = (x, y, d) => finds.every((f) => Math.hypot(f.x - x, f.y - y) > d);
  for (const k of ['brim', 'breeze', 'brim', 'breeze']) {
    for (let t = 0; t < 200; t++) {
      const x = 40 + rnd() * (W - 80), y = 40 + rnd() * (H - 80);
      if (Math.hypot(x - start.x, y - start.y) < 150 || !farOK(x, y, 200)) continue;
      finds.push({ k, x: Math.round(x), y: Math.round(y) });
      break;
    }
  }
  if (rnd() < 0.45) {
    for (let t = 0; t < 200; t++) {
      const x = 40 + rnd() * (W - 80), y = 40 + rnd() * (H - 80);
      if (Math.hypot(x - start.x, y - start.y) < Math.max(W, H) * 0.36 || !farOK(x, y, 120)) continue;
      finds.push({ k: 'spindle', x: Math.round(x), y: Math.round(y) });
      break;
    }
  }
  g.finds = finds;
  return g;
}

// ---------- a visit ----------
export const newVisit = () => ({ got: [], mass: 0 });
/** Gather plant i. Returns a new visit; unchanged if it does not fit or is already in. */
export function gather(g, visit, i, open = OPENING) {
  const p = g.plants[i];
  if (!p || visit.got.includes(i) || !fits(g, p, visit.mass, open)) return visit;
  return { got: [...visit.got, i], mass: visit.mass + growthOf(p) };
}
/** Done when nothing is left: everything gathered (or, in a harvest, nibbled by the goat). */
export const isDone = (g, visit, eaten = 0) => visit.got.length + eaten >= g.plants.length;
/** Rebuild a visit from saved gathered ids (ignoring any that are invalid or repeated).
 *  Saved ids were legal when gathered (a wide brim may have helped), so they are not re-checked. */
export function restoreVisit(g, ids) {
  const got = [];
  const seen = new Set();
  let mass = 0;
  for (const i of Array.isArray(ids) ? ids : []) {
    if (!Number.isInteger(i) || !g.plants[i] || seen.has(i)) continue;
    seen.add(i); got.push(i); mass += growthOf(g.plants[i]);
  }
  return { got, mass };
}

const takenFn = (visit, taken) => {
  if (!taken) { const s = new Set(visit.got); return (i) => s.has(i); }
  if (taken instanceof Set) return (i) => taken.has(i);
  return (i) => !!taken[i];
};
/** Nearest plant that fits now and is not gathered, or -1. taken: a Set or a 0/1 array. */
export function nearestGatherable(g, visit, x, y, taken = null) {
  const have = takenFn(visit, taken);
  const lim = OPENING * basketRadius(g, visit.mass);
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.plants.length; i++) {
    const p = g.plants[i];
    if (p.r > lim || have(i)) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** The next species to fit, with progress toward it (0..1), or null when all fit. */
export function nextUp(g, visit) {
  const have = new Set(visit.got);
  const lim = OPENING * basketRadius(g, visit.mass);
  let need = null;
  for (let i = 0; i < g.plants.length; i++) {
    const p = g.plants[i];
    if (have.has(i) || p.r <= lim) continue;
    if (!need || p.r < need.r) need = p;
  }
  if (!need) return null;
  const target = massToFit(g, need.r);
  let prevR = 0;
  for (const p of g.plants) if (p.r <= lim && p.r > prevR) prevR = p.r;
  const from = Math.min(massToFit(g, prevR), visit.mass);
  const progress = target > from ? (visit.mass - from) / (target - from) : 1;
  return { species: need.s, mass: target, progress: Math.max(0, Math.min(1, progress)) };
}

/** Max distance from any lattice point in the field to a plant that fits at the start. */
export function startCoverage(g, step = 40) {
  const small = g.plants.filter((p) => fits(g, p, 0));
  let worst = 0;
  for (let y = 0; y <= g.H; y += step) for (let x = 0; x <= g.W; x += step) {
    let bd = Infinity;
    for (const p of small) bd = Math.min(bd, (p.x - x) ** 2 + (p.y - y) ** 2);
    worst = Math.max(worst, Math.sqrt(bd));
  }
  return worst;
}

// ---------- basket levels (the growth bar) ----------
/** Level steps: the mass at which each kind of plant first comes into reach, smallest first.
 *  Kinds that come into reach within 4% of each other share a step. Level 1 is the start. */
export function levelsOf(g) {
  if (g._levels && g._levels.G === g.G) return g._levels.list;
  const first = new Map();
  for (const p of g.plants) first.set(p.s, Math.min(first.get(p.s) ?? Infinity, p.r));
  const steps = [...first.entries()].map(([s, r]) => ({ s, mass: massToFit(g, r) })).filter((x) => x.mass > 0).sort((a, b) => a.mass - b.mass || (a.s < b.s ? -1 : 1));
  const list = [];
  for (const x of steps) {
    const last = list[list.length - 1];
    if (last && x.mass <= last.mass * 1.04) last.species.push(x.s);
    else list.push({ mass: x.mass, species: [x.s] });
  }
  Object.defineProperty(g, '_levels', { value: { G: g.G, list }, enumerable: false, configurable: true, writable: true });
  return list;
}
/** { level, progress 0..1 toward the next, next: species ids that come next (or null), max } */
export function levelInfo(g, mass) {
  const list = levelsOf(g);
  let k = 0;
  while (k < list.length && mass >= list[k].mass - 1e-9) k++;
  const from = k ? list[k - 1].mass : 0;
  const nx = list[k];
  return { level: k + 1, max: list.length + 1, progress: nx ? Math.max(0, Math.min(1, (mass - from) / (nx.mass - from))) : 1, next: nx ? nx.species : null };
}

// ---------- combos (a sweep through a row or a patch) ----------
/** Add one gather at time t (seconds). Returns the combo (a new one after a pause of COMBO_GAP). */
export function comboAdd(combo, t, s) {
  if (!combo || t - combo.last > COMBO_GAP || t - combo.start > COMBO_SPAN) combo = { n: 0, start: t, last: t, by: {} };
  else combo = { ...combo, by: { ...combo.by } };
  combo.n++; combo.last = t;
  combo.by[s] = (combo.by[s] || 0) + 1;
  return combo;
}
export const comboOpen = (combo, t) => !!combo && t - combo.last <= COMBO_GAP && t - combo.start <= COMBO_SPAN;
/** A line for a sweep worth celebrating (5 or more), else ''. */
export function comboLabel(combo) {
  if (!combo || combo.n < 5) return '';
  let top = null, topN = 0;
  for (const [s, n] of Object.entries(combo.by)) if (n > topN) { top = s; topN = n; }
  const many = SPECIES[top].many;
  if (topN / combo.n >= 0.75) return `${combo.n >= 12 ? 'A whole row of' : 'A run of'} ${many}! ×${combo.n}`;
  if (combo.n >= 20) return `A whole swathe! ×${combo.n}`;
  if (combo.n >= 10) return `What a sweep! ×${combo.n}`;
  return `A lovely handful! ×${combo.n}`;
}

// ---------- the goat (harvest only) ----------
// The neighbor's goat wanders and nibbles small plants. It is a gentle race, not a threat:
// it never takes a grand plant or a landmark, and a big basket startles it into hopping away.
export const GOAT = Object.freeze({ speed: 30, hop: 120, hopSecs: 1.1, eatMax: 13, munch: 0.9, scareR: 24, sight: 160, dt: 1 / 20 });
export const goatCanEat = (p) => !!p && !isBig(p.s) && p.r <= GOAT.eatMax;
export function newGoat(g) {
  const o = { rs: (g.seed ^ 0x60A7F00D) >>> 0, x: 0, y: 0, vx: 0, state: 'walk', t: 0, target: -1, wx: 0, wy: 0, retarget: 0, eaten: 0, startled: 0, face: 1 };
  // it wanders in not far from the start, so she meets it early
  const a = nextRand(o) * Math.PI * 2, d = 150 + nextRand(o) * 60;
  o.x = Math.max(40, Math.min(g.W - 40, g.start.x + Math.cos(a) * d));
  o.y = Math.max(40, Math.min(g.H - 40, g.start.y + Math.sin(a) * d));
  o.wx = o.x; o.wy = o.y;
  return o;
}
/** Advance the goat by one fixed tick. Mutates goat; returns the index it finished eating, or -1.
 *  taken: 0/1 per plant (gathered or eaten). b: the basket {x, y, r}. */
export function goatStep(g, goat, taken, grid, b, dt = GOAT.dt) {
  goat.t += dt;
  const clampIn = () => { goat.x = Math.max(20, Math.min(g.W - 20, goat.x)); goat.y = Math.max(20, Math.min(g.H - 20, goat.y)); };
  if (goat.state === 'hop') {
    goat.hopT -= dt;
    goat.x += goat.hx * GOAT.hop * dt; goat.y += goat.hy * GOAT.hop * dt;
    clampIn();
    if (goat.hopT <= 0) { goat.state = 'walk'; goat.target = -1; goat.retarget = 0; }
    return -1;
  }
  const dB = Math.hypot(goat.x - b.x, goat.y - b.y);
  if (b.r >= GOAT.scareR && dB < b.r + 30) {
    // startled: hop away from the big basket
    const a = Math.atan2(goat.y - b.y, goat.x - b.x) + (nextRand(goat) - 0.5) * 0.8;
    goat.state = 'hop'; goat.hopT = GOAT.hopSecs; goat.hx = Math.cos(a); goat.hy = Math.sin(a);
    goat.face = goat.hx < 0 ? -1 : 1; goat.target = -1; goat.startled++;
    return -1;
  }
  if (goat.state === 'munch') {
    goat.munchT -= dt;
    if (goat.munchT > 0) return -1;
    goat.state = 'walk';
    const i = goat.target;
    goat.target = -1;
    if (i >= 0 && !taken[i] && goatCanEat(g.plants[i])) { goat.eaten++; return i; }
    return -1;
  }
  // walking: pick the nearest small plant in sight (not one under the basket), else amble
  if (goat.target >= 0 && taken[goat.target]) goat.target = -1;
  if (goat.target < 0 && goat.t >= goat.retarget) {
    goat.retarget = goat.t + 0.6;
    const S = GOAT.sight;
    const near = queryGrid(grid, goat.x - S, goat.y - S, goat.x + S, goat.y + S);
    let best = -1, bd = S * S;
    for (const i of near) {
      const p = g.plants[i];
      if (taken[i] || !goatCanEat(p)) continue;
      if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (b.r + 12) ** 2) continue;
      const d = (p.x - goat.x) ** 2 + (p.y - goat.y) ** 2;
      if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
    }
    goat.target = best;
    if (best < 0 && Math.hypot(goat.wx - goat.x, goat.wy - goat.y) < 8) {
      goat.wx = 40 + nextRand(goat) * (g.W - 80); goat.wy = 40 + nextRand(goat) * (g.H - 80);
    }
  }
  const tx = goat.target >= 0 ? g.plants[goat.target].x : goat.wx;
  const ty = goat.target >= 0 ? g.plants[goat.target].y : goat.wy;
  const dx = tx - goat.x, dy = ty - goat.y, d = Math.hypot(dx, dy);
  if (goat.target >= 0 && d < 4) { goat.state = 'munch'; goat.munchT = GOAT.munch; goat.vx = 0; return -1; }
  if (d > 0.5) {
    const v = Math.min(d, GOAT.speed * dt);
    goat.x += (dx / d) * v; goat.y += (dy / d) * v;
    goat.vx = dx / d;
    if (Math.abs(dx) > 1) goat.face = dx < 0 ? -1 : 1;
  }
  clampIn();
  return -1;
}

// ---------- finds (power-ups) ----------
/** Index of a find the basket picks up now (not yet found), or -1. found: a Set of indices. */
export function findAt(g, found, bx, by, br) {
  for (let k = 0; k < g.finds.length; k++) {
    if (found.has(k)) continue;
    const f = g.finds[k];
    if ((f.x - bx) ** 2 + (f.y - by) ** 2 <= (br + 5) ** 2) return k;
  }
  return -1;
}
/** Does a breeze draw this plant in? Small enough to fit, and within reach of the basket. */
export function breezeCatches(g, p, mass, bx, by, open = OPENING) {
  const br = basketRadius(g, mass);
  const reach = br * FIND_KINDS.breeze.reach + 16;
  return fits(g, p, mass, open) && (p.x - bx) ** 2 + (p.y - by) ** 2 <= reach * reach;
}

// ---------- a small goal per visit ----------
/** A bonus goal: gather enough of one mid-size plant for its dye. Same for a given garden. */
export function goalFor(g) {
  const count = {};
  for (const p of g.plants) if (!isBig(p.s)) count[p.s] = (count[p.s] || 0) + 1;
  const kinds = Object.keys(count).filter((s) => tierOf(SPECIES[s].r) >= 3).sort((a, b) => SPECIES[a].r - SPECIES[b].r || (a < b ? -1 : 1));
  const pool = kinds.length ? kinds : Object.keys(count).sort();
  const rnd = mulberry32(g.seed ^ 0x90A1);
  const s = pool[Math.floor(rnd() * pool.length)];
  const need = Math.max(4, Math.min(12, Math.round(count[s] * 0.3)));
  const dye = SPECIES[s].dye;
  return { s, need, dye, text: `Gather enough for ${DYES[dye].name.toLowerCase()}: ${need} ${SPECIES[s].many}` };
}
export function goalProgress(g, goal, ids) {
  let have = 0;
  for (const i of ids) if (g.plants[i] && g.plants[i].s === goal.s) have++;
  return { have: Math.min(have, goal.need), need: goal.need, met: have >= goal.need };
}

// ---------- the clock (harvest only): a sun crossing the sky ----------
/** u: 0..1 through the harvest. Returns the sun's place on its arc and the light. */
export function skyAt(u) {
  u = Math.max(0, Math.min(1, u));
  const a = Math.PI * (1 - u); // east to west
  // light: clear, then golden after 55%, then dusky in the last 20%
  const gold = Math.max(0, Math.min(1, u * 4 - 2.2));
  const dusk = Math.max(0, Math.min(1, u * 5 - 4));
  return { sx: 0.5 + 0.5 * Math.cos(a), sy: 1 - Math.sin(a), gold, dusk, phase: u >= 1 ? 'dusk' : dusk > 0 ? 'evening' : gold > 0 ? 'golden' : 'day' };
}
export function clockLabel(secsLeft) {
  const s = Math.max(0, Math.ceil(secsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- the haul ----------
export const unitsOf = (p) => Math.max(1, Math.round((p.r * p.r) / 40));
/** Jars by dye for the gathered ids: [{dye, name, hex, units, plants, jars}], most first. */
export function tally(g, ids) {
  const by = new Map();
  for (const i of ids) {
    const p = g.plants[i];
    if (!p) continue;
    const dye = SPECIES[p.s].dye;
    const t = by.get(dye) || { dye, name: DYES[dye].name, hex: DYES[dye].hex, units: 0, plants: 0, jars: 0 };
    t.units += unitsOf(p);
    t.plants += 1;
    t.jars = t.units / JAR;
    by.set(dye, t);
  }
  return [...by.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
/** The harvest score: whole jars gathered and the basket's final level.
 *  spare: seconds of sun left if she gathered everything before dusk (a tiebreak). */
export function harvestScore(g, ids, mass, spare = 0) {
  let units = 0;
  for (const i of ids) if (g.plants[i]) units += unitsOf(g.plants[i]);
  return { jars: Math.floor(units / JAR), units, plants: ids.length, level: levelInfo(g, mass).level, spare: Math.max(0, Math.round(spare)) };
}
/** Is score a better than best b (more jars, then a bigger basket, then more dye, then more sun to spare)? */
export function betterScore(a, b) {
  if (!b) return true;
  if (a.jars !== b.jars) return a.jars > b.jars;
  if ((a.level | 0) !== (b.level | 0)) return (a.level | 0) > (b.level | 0);
  if ((a.units | 0) !== (b.units | 0)) return (a.units | 0) > (b.units | 0);
  return (a.spare | 0) > (b.spare | 0);
}
/** The dyes a place can give, smallest plant first. */
export function placeDyes(placeId) {
  const out = [];
  const mix = [...PLACE_BY_ID[placeId].mix].sort((a, b) => SPECIES[a[0]].r - SPECIES[b[0]].r);
  for (const [s] of mix) if (!out.includes(SPECIES[s].dye)) out.push(SPECIES[s].dye);
  return out;
}
export function jarsLabel(units) {
  const j = units / JAR;
  if (j < 1) return j < 0.5 ? 'a little jar' : 'most of a jar';
  const n = Math.floor(j), half = j - n >= 0.5;
  if (half) return `${n}½ jars`;
  return n === 1 ? '1 jar' : `${n} jars`;
}

/** One fact about something she gathered (the biggest finds first, rotated by
 *  visit number). With nothing gathered, a fact about the place. */
export function pickFact(g, ids, n = 0) {
  const seen = new Map();
  for (const i of ids) {
    const p = g.plants[i];
    if (!p) continue;
    const f = SPECIES[p.s].fact;
    seen.set(f, Math.max(seen.get(f) || 0, SPECIES[p.s].r));
  }
  let keys = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 3);
  if (!keys.length) keys = PLACE_BY_ID[g.place].mix.map(([s]) => SPECIES[s].fact);
  const key = keys[Math.abs(n) % keys.length];
  return { key, text: FACTS[key] };
}
