// The Dye Garden: pure rules. No window/document/Date.now/Math.random.
// A garden is generated from (place id, seed) with a seeded mulberry32 RNG.
// Plants are circles in world units; the basket is a circle whose radius grows
// with every plant gathered. A plant fits when its radius is at most
// OPENING x the basket radius, and tips in when its center is over the basket.

export const OPENING = 0.95; // a plant fits if r <= OPENING * basket radius
export const R0 = 8.2; // starting basket radius: only the smallest plants fit
export const FINALE_AT = 0.8; // the grand plants fit once ~80% of the rest's growth is in
export const JAR = 24; // dye units per jar
export const VARIANTS = 3; // drawing variants per species

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
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
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
// r: base radius in world units (each plant varies by +-5%).
// shape: the sprite drawer in sprites.js. grand: the crescendo plants.
const sp = (o) => Object.freeze({ grand: false, ...o });
export const SPECIES = Object.freeze({
  chamomile: sp({ name: "Dyer's chamomile", dye: 'chamomile', fact: 'chamomile', r: 6.4, shape: 'daisy' }),
  marigold: sp({ name: 'Marigold heads', dye: 'marigold', fact: 'marigold', r: 7.2, shape: 'pompom' }),
  cosmos: sp({ name: 'Sulphur cosmos', dye: 'cosmos', fact: 'cosmos', r: 7.0, shape: 'cosmos' }),
  onion: sp({ name: 'Onion skins', dye: 'onion', fact: 'onion', r: 6.8, shape: 'curls' }),
  lichen: sp({ name: 'Lichen', dye: 'lichen', fact: 'lichen', r: 6.2, shape: 'lichen' }),
  acorns: sp({ name: 'Acorns', dye: 'oaktan', fact: 'oak', r: 6.8, shape: 'acorns' }),
  coreopsis: sp({ name: 'Coreopsis', dye: 'coreopsis', fact: 'coreopsis', r: 10.2, shape: 'coreopsis' }),
  woad: sp({ name: 'Woad leaves', dye: 'woad', fact: 'woad', r: 11.2, shape: 'rosette' }),
  galls: sp({ name: 'Oak galls', dye: 'oakgray', fact: 'galls', r: 9.8, shape: 'galls' }),
  avocado: sp({ name: 'Avocado pits', dye: 'avocado', fact: 'avocado', r: 10.6, shape: 'pits' }),
  weld: sp({ name: 'Weld', dye: 'weld', fact: 'weld', r: 15.5, shape: 'spike' }),
  broom: sp({ name: "Dyer's broom", dye: 'broom', fact: 'broom', r: 16.2, shape: 'shrub' }),
  seaweed: sp({ name: 'Bladderwrack', dye: 'seaweed', fact: 'seaweed', r: 14.8, shape: 'seaweed' }),
  logwood: sp({ name: 'Logwood chips', dye: 'logwood', fact: 'logwood', r: 15.2, shape: 'chips' }),
  oakbark: sp({ name: 'Oak bark', dye: 'oaktan', fact: 'oak', r: 15.8, shape: 'bark' }),
  madder: sp({ name: 'Madder roots', dye: 'madder', fact: 'madder', r: 21.5, shape: 'madder' }),
  sumac: sp({ name: 'Staghorn sumac', dye: 'sumac', fact: 'sumac', r: 22.8, shape: 'sumac' }),
  walnut: sp({ name: 'Walnut hulls', dye: 'walnut', fact: 'walnut', r: 20.5, shape: 'hulls' }),
  pad: sp({ name: 'Cochineal on a prickly-pear pad', dye: 'cochineal', fact: 'cochineal', r: 22.0, shape: 'pad' }),
  indigo: sp({ name: 'Indigo bush', dye: 'indigo', fact: 'indigo', r: 30.5, shape: 'bush' }),
  madderBed: sp({ name: 'Old madder bed', dye: 'madder', fact: 'madder', r: 41, shape: 'madderBed', grand: true }),
  sumacGrove: sp({ name: 'Sumac thicket', dye: 'sumac', fact: 'sumac', r: 42, shape: 'grove', grand: true }),
  walnutTree: sp({ name: 'Black walnut tree', dye: 'walnut', fact: 'walnut', r: 45, shape: 'tree', grand: true }),
  indigoHedge: sp({ name: 'Indigo hedge in flower', dye: 'indigo', fact: 'indigo', r: 41, shape: 'hedge', grand: true }),
  cactus: sp({ name: 'Prickly-pear cactus with cochineal', dye: 'cochineal', fact: 'cochineal', r: 44, shape: 'cactus', grand: true }),
});

// ---------- places ----------
// mix: [species, count]. zone: [x0, y0, x1, y1] as fractions of the field.
// rows: plants line up along terraces (the hillside).
export const PLACES = Object.freeze([
  {
    id: 'meadow', name: 'The Meadow', size: [780, 1080], ground: 'meadow',
    blurb: 'Summer flowers in long grass, and an old madder bed by the fence.',
    mix: [['chamomile', 40], ['marigold', 34], ['coreopsis', 34], ['woad', 30], ['weld', 28], ['broom', 22], ['madder', 30], ['madderBed', 4]],
  },
  {
    id: 'shore', name: 'The Shoreline', size: [740, 1040], ground: 'shore',
    blurb: 'Lichen on the rocks, bladderwrack at the tide line, sumac on the dunes.',
    mix: [['lichen', 42], ['chamomile', 28], ['woad', 24], ['seaweed', 36], ['broom', 20], ['sumac', 24], ['sumacGrove', 4]],
    zones: { lichen: [0, 0, 0.5, 1], seaweed: [0.66, 0, 1, 1], sumac: [0, 0, 0.6, 1], sumacGrove: [0, 0, 0.55, 1] },
  },
  {
    id: 'forest', name: 'The Forest Edge', size: [760, 1060], ground: 'forest',
    blurb: 'Mossy lichens, oak galls and acorns, and walnuts dropping their hulls.',
    mix: [['lichen', 40], ['acorns', 34], ['galls', 36], ['oakbark', 30], ['walnut', 28], ['walnutTree', 4]],
  },
  {
    id: 'hillside', name: 'The Indigo Terraces', size: [780, 1080], ground: 'terraces', rows: 120,
    blurb: 'Terraced rows of indigo, with woad, weld and marigolds along the walls.',
    mix: [['marigold', 32], ['onion', 30], ['woad', 28], ['coreopsis', 20], ['weld', 24], ['madder', 16], ['indigo', 30], ['indigoHedge', 4]],
  },
  {
    id: 'cactus', name: 'The Cactus Garden', size: [760, 1040], ground: 'cactus',
    blurb: 'Prickly pears dusted with cochineal, logwood chips and sulphur cosmos.',
    mix: [['cosmos', 36], ['marigold', 24], ['avocado', 28], ['coreopsis', 18], ['logwood', 26], ['pad', 28], ['cactus', 4]],
  },
].map((p) => Object.freeze(p)));
export const PLACE_BY_ID = Object.freeze(Object.fromEntries(PLACES.map((p) => [p.id, p])));

// ---------- growth ----------
// The basket's area grows by G x (radius of each plant gathered):
//   radius = sqrt(R0^2 + G * sum of gathered plant radii).
// Bigger plants give more, but less than their area, so the small ones keep
// mattering. G is chosen per garden so the grand plants fit at FINALE_AT.
export const growthOf = (p) => p.r;
export const basketRadius = (g, mass) => Math.sqrt(R0 * R0 + g.G * mass);
export const fits = (g, p, mass) => p.r <= OPENING * basketRadius(g, mass);
/** Mass needed before plant radius r fits. */
export const massToFit = (g, r) => Math.max(0, ((r / OPENING) ** 2 - R0 * R0) / g.G);
/** Is the plant's center over the basket (so it tips in when it fits)? */
export function over(bx, by, br, p) {
  const dx = p.x - bx, dy = p.y - by;
  return dx * dx + dy * dy <= br * br;
}

function computeG(plants) {
  let grandR = 0, wNon = 0;
  for (const p of plants) {
    if (SPECIES[p.s].grand) grandR = Math.max(grandR, p.r);
    else wNon += growthOf(p);
  }
  if (!grandR) grandR = Math.max(...plants.map((p) => p.r));
  return ((grandR / OPENING) ** 2 - R0 * R0) / (FINALE_AT * wNon);
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
/** Indices of plants whose centers lie in cells touching the box (x0..x1, y0..y1), padded by pad. */
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
const tierOf = (r) => (r < 8 ? 1 : r < 13 ? 2 : r < 19 ? 3 : r < 27 ? 4 : r < 36 ? 5 : 6);

export function generate(placeId, seed) {
  const place = PLACE_BY_ID[placeId];
  if (!place) throw new RangeError('unknown place ' + placeId);
  const rnd = mulberry32((seed >>> 0) ^ hashStr(placeId));
  const [W, H] = place.size;
  const start = { x: W / 2, y: H / 2 };
  const plants = [];
  const grid = buildGrid([], W, H, 64);
  const zones = place.zones || {};
  const counts = {};
  for (const [s, n] of place.mix) counts[s] = Math.max(SPECIES[s].grand ? n : 1, Math.round(n * (0.92 + rnd() * 0.16)));
  const smallest = place.mix.map(([s]) => s).filter((s) => tierOf(SPECIES[s].r) === 1);

  const clear = (x, y, r, s) => {
    const m = r + 12;
    if (x < m || y < m || x > W - m || y > H - m) return false;
    // keep the starting spot open for the first little ones
    if (tierOf(r) > 1 && Math.hypot(x - start.x, y - start.y) < 46 + r) return false;
    const reach = r + grid.maxR;
    const near = queryGrid(grid, x - reach, y - reach, x + reach, y + reach);
    for (const i of near) {
      const q = plants[i];
      const minD = (r + q.r) * (SPECIES[s].grand || SPECIES[q.s].grand ? 0.95 : 0.78);
      if ((q.x - x) ** 2 + (q.y - y) ** 2 < minD * minD) return false;
    }
    return true;
  };
  const snapRow = (s, y) => {
    if (!place.rows || tierOf(SPECIES[s].r) < 2) return y;
    const band = place.rows;
    return Math.floor(y / band) * band + band / 2 + (rnd() - 0.5) * band * 0.36;
  };
  const put = (s, x, y) => {
    const r = SPECIES[s].r * (0.95 + rnd() * 0.1);
    y = snapRow(s, y);
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
  for (let k = 0; k < 6; k++) {
    const s = pick(smallest);
    for (let t = 0; t < 20; t++) {
      const a = (k / 6) * Math.PI * 2 + rnd() * 0.6, d = 20 + rnd() * 26;
      if (put(s, start.x + Math.cos(a) * d, start.y + Math.sin(a) * d)) break;
    }
  }
  // 2. The grand plants, well apart and away from the start.
  for (const [s] of place.mix) {
    if (!SPECIES[s].grand) continue;
    let tries = 0;
    while (counts[s] > 0 && tries++ < 400) {
      const [x, y] = inZone(s);
      if (Math.hypot(x - start.x, y - start.y) < Math.min(W, H) * 0.3) continue;
      const far = plants.every((q) => !SPECIES[q.s].grand || Math.hypot(q.x - x, q.y - y) > 260);
      if (far) put(s, x, y);
    }
  }
  // 3. Coverage: a small plant in every lattice cell, so something fits wherever she starts looking.
  const step = 130;
  for (let gy = 0; gy < H; gy += step) for (let gx = 0; gx < W; gx += step) {
    const s = pick(smallest);
    for (let t = 0; t < 30; t++) if (put(s, gx + rnd() * step, gy + rnd() * step)) break;
  }
  // 4. Patches, biggest species first so they find room.
  const bySize = place.mix.map(([s]) => s).filter((s) => !SPECIES[s].grand).sort((a, b) => SPECIES[b].r - SPECIES[a].r);
  for (const s of bySize) {
    const sz = SPECIES[s].r;
    const per = Math.max(2, Math.round(26 / sz));
    let guard = 0;
    while (counts[s] > 0 && guard++ < 200) {
      const [cx, cy] = inZone(s);
      const n = Math.min(counts[s], per + Math.floor(rnd() * 3));
      const spread = sz * (2.2 + Math.sqrt(n) * 1.5);
      const sx = place.rows ? 2.4 : 1, sy = place.rows ? 0.45 : 1;
      for (let k = 0; k < n; k++) {
        for (let t = 0; t < 14; t++) {
          const a = rnd() * Math.PI * 2, d = spread * Math.sqrt(rnd());
          if (put(s, cx + Math.cos(a) * d * sx, cy + Math.sin(a) * d * sy)) break;
        }
      }
    }
  }

  // Draw order: back to front.
  plants.sort((a, b) => a.y - b.y || a.x - b.x);
  const g = { v: 1, place: placeId, seed: seed >>> 0, W, H, start, plants, G: 0 };
  g.G = computeG(plants);

  // 5. Balance: if a size would never fit in smallest-first order, add more of
  //    the size just below it near its kin, and re-plan. Rare with these mixes.
  for (let guard = 0; guard < 300; guard++) {
    const res = greedyFinish(g);
    if (res.ok) break;
    const below = res.order.length ? g.plants[res.order[res.order.length - 1]].s : smallest[0];
    const kin = g.plants.filter((p) => p.s === below);
    const near = kin.length ? pick(kin) : start;
    let placed = false;
    for (let t = 0; t < 40 && !placed; t++) {
      placed = put(below, near.x + (rnd() - 0.5) * 120, near.y + (rnd() - 0.5) * 120);
    }
    if (!placed) for (let t = 0; t < 200 && !placed; t++) placed = put(below, rnd() * W, rnd() * H);
    plants.sort((a, b) => a.y - b.y || a.x - b.x);
    g.G = computeG(plants);
  }
  plants.forEach((p, i) => { p.id = i; });
  return g;
}

// ---------- a visit ----------
export const newVisit = () => ({ got: [], mass: 0 });
/** Gather plant i. Returns a new visit; unchanged if it does not fit or is already in. */
export function gather(g, visit, i) {
  const p = g.plants[i];
  if (!p || visit.got.includes(i) || !fits(g, p, visit.mass)) return visit;
  return { got: [...visit.got, i], mass: visit.mass + growthOf(p) };
}
export const isDone = (g, visit) => visit.got.length >= g.plants.length;
/** Rebuild a visit from saved gathered ids (ignoring any that are invalid). */
export function restoreVisit(g, ids) {
  let v = newVisit();
  const want = new Set(Array.isArray(ids) ? ids : []);
  // replay smallest first so every saved id is legal again
  const order = [...want].filter((i) => g.plants[i]).sort((a, b) => g.plants[a].r - g.plants[b].r);
  for (const i of order) v = gather(g, v, i);
  return v;
}

/** Nearest plant that fits now and is not gathered, or -1. */
export function nearestGatherable(g, visit, x, y, taken = null) {
  const have = taken || new Set(visit.got);
  const lim = OPENING * basketRadius(g, visit.mass);
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.plants.length; i++) {
    const p = g.plants[i];
    if (p.r > lim || have.has(i)) continue;
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
  // progress from the last unlock (largest fitting plant size) to the next
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
