// puzzles/garden-path.js — The Garden Path (pure): 108 numbered gardens played
// in order, in nine chapters by place and season. Each garden is a fixed seed
// and a hand-tuned recipe (field size, plant mix, landmark, goat, finds, and
// at most one new thing at a time: a stream, gates, a napping cat), with one
// clear goal and up to two extra stars. Stars never block anything: the next
// garden opens as soon as the main goal is met.
//
// No window/document/Date.now/Math.random. The rules are src/puzzles/garden.js;
// this module adds the recipes, the goals and stars, the gates (hedges that
// open when the basket reaches a size), the cat, and a headless autopilot used
// by the tests and tools/garden-path-check.mjs to prove every garden can be
// finished.
//
// Goals (one per garden; `t` is the kind):
//   gather {s, n}    gather n of one plant          "Gather 12 tansy heads"
//   float  {n}       catch n floating plants        "Catch 8 floating marigolds"
//   jars   {jars}    fill dye jars, {dye: jars}     "Fill 1 jar of weld yellow and 1 of woad blue"
//   landmark {s}     fit the landmark in the basket "Fit the wheelbarrow in the basket"
//   level  {n}       reach a basket size            "Grow the basket to Basket 5"
//   all              gather the whole garden        "Gather the whole garden"
// Extra stars use the same kinds, plus: sweep {n} (n plants in one sweep),
// cat (let the cat nap), spindle (find the lost spindle), dusk (the main goal
// met before dusk; only in gardens with a sun, and only when she picks it).

import {
  SPECIES, DYES, JAR, MODES, isBig, generateFrom, levelsOf, levelInfo, fits, basketRadius, growthOf,
  buildGrid, queryGrid, over, floatPos, unitsOf, hashStr, R0, OPENING,
} from './garden.js';

/** Path layout version: a saved path visit from another version is not resumed. */
export const PATH_GEN = 1;
/** A gate's opening, half its width in world units (the basket's middle must pass through it). */
export const GATE_GAP = 46;

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------
// visual: cheap, screen-only weather (petals in the wind, falling leaves, snow).
// finds: the sparkly finds a chapter's gardens have unless a recipe says otherwise.
export const CHAPTERS = Object.freeze([
  { id: 'spring', name: 'Spring meadow', ground: 'meadow', visual: 'petals', finds: 'brim breeze',
    blurb: 'Tansy, chamomile and woad in fresh grass, a wheelbarrow and a scarecrow.' },
  { id: 'shore', name: 'Midsummer shore', ground: 'shore', visual: null, finds: 'brim breeze',
    blurb: 'Lichen on the rocks, elder in the dunes, and the neighbor\'s goat on the sand.' },
  { id: 'stream', name: 'The mill stream', ground: 'river', visual: 'petals', finds: 'breeze brim',
    blurb: 'A stream carries flowers past. Japanese indigo, French marigolds and rhubarb on the banks.' },
  { id: 'autumn', name: 'Autumn forest', ground: 'forest', visual: 'leaves', finds: 'brim breeze',
    blurb: 'Goldenrod, black-eyed Susans and pokeweed under the oaks, and a beehive.' },
  { id: 'indigo', name: 'Indigo harvest', ground: 'terraces', visual: null, finds: 'brim breeze', rows: 120,
    blurb: 'Terraces of indigo behind garden gates that open as the basket grows.' },
  { id: 'cottage', name: 'Cottage garden', ground: 'cottage', visual: 'petals', finds: 'brim breeze',
    blurb: 'Borders of alkanet and marigolds, and a cat napping in the sun. Let it sleep.' },
  { id: 'desert', name: 'Desert bloom', ground: 'cactus', visual: null, finds: 'brim breeze',
    blurb: 'Safflower, hibiscus and cutch among the prickly pears.' },
  { id: 'winter', name: 'Winter hedgerow', ground: 'snow', visual: 'snow', finds: 'brim breeze',
    blurb: 'Osage oranges and lichens along snowy hedgerows, and rhubarb crowns to dig.' },
  { id: 'dyehouse', name: 'The dye-house', ground: 'yard', visual: 'leaves', finds: 'brim breeze',
    blurb: 'Everything comes together in the yard, right up to the dye-house itself.' },
].map((c) => Object.freeze(c)));
export const CHAPTER_BY_ID = Object.freeze(Object.fromEntries(CHAPTERS.map((c) => [c.id, c])));

// ---------------------------------------------------------------------------
// The gardens. One row each:
//   [name, 'WxH', mix, goal, extra stars, options]
// mix: 'species count ...' (a count of 1 may be left out). goal and stars use
// the kinds above ('gather tansy 12', 'jars weld 1 woad 1', 'landmark barrow',
// 'level 5', 'all', 'float 8', 'sweep 15', 'cat', 'spindle', 'dusk').
// options: goat, dusk (seconds of sun, opt-in), finds ('brim breeze' or ''),
// spindle (0..1), stream {y, s, n, amp, waves, v}, gates [[y, x, level], ...]
// (fractions of the field; the gate opens at that basket size), cat [x, y],
// zones, rows, landAt, seed (a hand-picked seed when the default looked off).
// ---------------------------------------------------------------------------
const ROWS = {
  spring: [
    ['First shoots', '440x600', 'chamomile 52 tansy 34 marigold 22 woad 10', 'gather tansy 12', ['level 2', 'all'], { finds: '' }],
    ['A row of woad', '460x620', 'chamomile 48 marigold 36 tansy 12 woad 16 weld 4', 'gather woad 8', ['level 3', 'all'], { finds: '' }],
    ['The wheelbarrow', '480x660', 'chamomile 46 tansy 34 marigold 28 woad 14 weld 8 barrow', 'landmark barrow', ['sweep 10', 'all'], { finds: '' }],
    ['Two jars', '500x680', 'chamomile 56 marigold 44 woad 16 weld 12', 'jars weld 1 woad 1', ['level 3', 'all'], { finds: '' }],
    ['Sparkles in the grass', '520x700', 'tansy 56 chamomile 34 marigold 34 woad 16 weld 10 madder 5', 'level 4', ['gather madder 4', 'all']],
    ['Weld by the fence', '540x720', 'chamomile 56 marigold 44 woad 16 weld 18 broom 7', 'gather weld 12', ['level 4', 'all']],
    ['The old madder bed', '560x760', 'chamomile 54 tansy 44 marigold 32 woad 18 weld 10 madder 12 madderBed', 'gather madder 8', ['gather madderBed 1', 'all']],
    ['The scarecrow', '580x780', 'chamomile 56 marigold 50 tansy 32 woad 20 weld 12 madder 10 scarecrow', 'landmark scarecrow', ['sweep 15', 'all']],
    ['Spring jars', '600x800', 'tansy 64 marigold 54 coreopsis 22 woad 18 weld 12 madder 9', 'jars tansy 1 coreopsis 1 madder 1', ['level 5', 'all']],
    ['A lost spindle', '620x820', 'chamomile 64 tansy 44 marigold 40 woad 20 weld 14 broom 8 madder 9 barrow', 'level 6', ['spindle', 'all'], { spindle: 1 }],
    ['Across the meadow', '640x860', 'chamomile 66 tansy 50 marigold 48 coreopsis 20 woad 20 weld 14 madder 10 madderBed', 'all', ['sweep 15', 'sweep 25']],
    ['The garden shed', '680x900', 'chamomile 70 tansy 46 marigold 54 woad 22 weld 16 broom 9 madder 12 madderBed 2 shed', 'landmark shed', ['sweep 20', 'all']],
  ],
  shore: [
    ['Lichen on the rocks', '480x640', 'crottle 54 chamomile 44 woad 12 seaweed 10', 'gather crottle 20', ['level 3', 'all'],
      { zones: { crottle: [0, 0, 0.55, 1], seaweed: [0.6, 0, 1, 1] } }],
    ['The tide line', '500x680', 'lichen 44 chamomile 44 crottle 16 seaweed 24 woad 12', 'gather seaweed 12', ['level 3', 'all'],
      { zones: { lichen: [0, 0, 0.5, 1], seaweed: [0.6, 0, 1, 1] } }],
    ['Sumac on the dunes', '520x700', 'crottle 50 chamomile 44 woad 14 seaweed 16 sumac 8', 'jars sumac 1', ['sweep 12', 'all'],
      { zones: { crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1], sumac: [0, 0, 0.6, 1] } }],
    ['Elder in the dunes', '540x720', 'chamomile 60 crottle 40 woad 14 broom 8 elder 9', 'gather elder 6', ['level 4', 'all'],
      { zones: { crottle: [0, 0, 0.5, 1] } }],
    ["The neighbor's goat", '560x760', 'lichen 50 chamomile 50 woad 16 seaweed 18 broom 8 sumac 6', 'level 5', ['sweep 15', 'all'],
      { goat: true, zones: { lichen: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1] } }],
    ['The rowing boat', '580x780', 'crottle 56 chamomile 50 woad 16 seaweed 20 broom 8 sumac 8 boat', 'landmark boat', ['sweep 15', 'all'],
      { zones: { crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1], boat: [0.62, 0.1, 0.9, 0.9] } }],
    ['Shore jars', '600x800', 'crottle 60 chamomile 50 woad 18 seaweed 22 elder 8 sumac 6', 'jars crottle 1 seaweed 2', ['level 5', 'all'],
      { zones: { crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1] } }],
    ['Before dusk on the sand', '600x800', 'lichen 60 chamomile 54 woad 18 seaweed 20 broom 10 elder 6', 'jars seaweed 1 woad 1', ['dusk', 'all'],
      { dusk: 150, zones: { lichen: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1] } }],
    ['The beach hut', '620x820', 'crottle 60 chamomile 56 woad 18 seaweed 22 broom 10 sumac 8 beachHut', 'landmark beachHut', ['sweep 18', 'all'],
      { goat: true, zones: { crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1], beachHut: [0.08, 0.1, 0.5, 0.9] } }],
    ['Driftwood and spindles', '640x860', 'lichen 64 crottle 30 chamomile 54 woad 20 seaweed 22 elder 10 sumac 8', 'level 5', ['spindle', 'all'],
      { spindle: 1, zones: { lichen: [0, 0, 0.5, 1], crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1] } }],
    ['Evening tide', '660x880', 'crottle 64 chamomile 60 woad 20 seaweed 24 broom 10 elder 12 sumac 6', 'gather elder 10', ['dusk', 'all'],
      { dusk: 160, zones: { crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1] } }],
    ['The whole shoreline', '700x940', 'lichen 70 crottle 40 chamomile 60 woad 22 seaweed 26 broom 12 elder 10 sumac 12 sumacGrove 2 boat beachHut', 'all', ['sweep 20', 'sweep 30'],
      { zones: { lichen: [0, 0, 0.5, 1], crottle: [0, 0, 0.5, 1], seaweed: [0.62, 0, 1, 1], sumacGrove: [0, 0, 0.55, 1], boat: [0.62, 0.1, 0.9, 0.9], beachHut: [0.08, 0.1, 0.5, 0.9] } }],
  ],
  stream: [
    ['The mill stream', '480x660', 'chamomile 50 marigold 30 woad 12', 'float 6', ['float 10', 'all'], { finds: '', stream: { y: 0.5, s: 'marigold', n: 10 } }],
    ['Japanese indigo', '500x680', 'chamomile 50 marigold 34 woad 8 japIndigo 14', 'gather japIndigo 8', ['float 8', 'all'], { stream: { y: 0.62, s: 'chamomile', n: 8 } }],
    ['Down the stream', '520x700', 'chamomile 54 marigold 40 japIndigo 14 weld 10', 'jars japindigo 1 chamomile 1', ['float 10', 'all'], { stream: { y: 0.4, s: 'chamomile', n: 12 } }],
    ['French marigolds', '540x720', 'chamomile 40 frenchMarigold 50 woad 14 japIndigo 12 weld 8', 'gather frenchMarigold 20', ['float 10', 'all'], { stream: { y: 0.55, s: 'frenchMarigold', n: 12 } }],
    ['Stepping stones', '560x760', 'chamomile 56 frenchMarigold 40 woad 16 japIndigo 14 weld 10 madder 6', 'level 5', ['float 12', 'all'], { stream: { y: 0.66, s: 'marigold', n: 12, amp: 0.05 } }],
    ['The old well', '580x780', 'chamomile 60 marigold 44 woad 16 japIndigo 14 weld 12 madder 8 well', 'landmark well', ['float 12', 'all'], { stream: { y: 0.36, s: 'chamomile', n: 12 } }],
    ['Rhubarb by the mill', '600x800', 'chamomile 56 frenchMarigold 46 woad 16 japIndigo 14 rhubarb 10', 'gather rhubarb 6', ['float 12', 'all'], { stream: { y: 0.58, s: 'frenchMarigold', n: 12 } }],
    ['Mill race at dusk', '600x800', 'chamomile 60 marigold 50 woad 18 japIndigo 16 weld 10 rhubarb 6', 'jars japindigo 1 marigold 1', ['dusk', 'float 12'], { dusk: 160, stream: { y: 0.45, s: 'marigold', n: 12 } }],
    ['Sweep the bank', '620x840', 'chamomile 70 frenchMarigold 50 woad 18 japIndigo 16 weld 12 rhubarb 8 madder 6', 'level 6', ['sweep 20', 'all'], { stream: { y: 0.7, s: 'chamomile', n: 14, amp: 0.04 } }],
    ['Blue and gold', '640x860', 'chamomile 64 frenchMarigold 56 marigold 20 woad 20 japIndigo 20 weld 12 rhubarb 8', 'jars japindigo 2 tagetes 1', ['float 14', 'all'], { stream: { y: 0.5, s: 'frenchMarigold', n: 14 } }],
    ['The weir', '660x880', 'chamomile 66 marigold 50 woad 20 japIndigo 18 weld 14 rhubarb 10 madder 8 barrow', 'landmark barrow', ['sweep 18', 'all'], { goat: true, stream: { y: 0.3, s: 'marigold', n: 14 } }],
    ['The whole mill stream', '700x940', 'chamomile 70 frenchMarigold 56 marigold 24 woad 22 japIndigo 20 weld 14 rhubarb 12 madder 8 madderBed well', 'all', ['float 16', 'sweep 25'], { stream: { y: 0.56, s: 'chamomile', n: 16, amp: 0.05 } }],
  ],
  autumn: [
    ['Goldenrod', '520x700', 'lichen 50 acorns 40 goldenrod 30 galls 12', 'gather goldenrod 16', ['level 3', 'all'], { finds: '' }],
    ['Acorns and galls', '540x720', 'lichen 50 acorns 50 galls 20 oakbark 10', 'jars oakgray 1 oaktan 1', ['level 3', 'all']],
    ['Black-eyed Susans', '560x740', 'acorns 50 lichen 40 susan 36 goldenrod 20 galls 12', 'gather susan 20', ['level 4', 'all']],
    ['Walnut hulls', '580x780', 'lichen 54 acorns 50 galls 18 oakbark 10 walnut 12 walnutCart', 'gather walnut 8', ['landmark walnutCart', 'all']],
    ['Leaves on the path', '600x800', 'acorns 60 lichen 50 goldenrod 24 susan 20 galls 14 walnut 8', 'level 5', ['spindle', 'all'], { spindle: 1 }],
    ['Pokeweed', '620x820', 'lichen 56 acorns 50 susan 30 galls 16 oakbark 10 poke 9', 'gather poke 6', ['sweep 15', 'all']],
    ['Autumn dusk', '620x820', 'acorns 60 lichen 50 goldenrod 36 susan 20 galls 14 walnut 8', 'jars goldenrod 2', ['dusk', 'all'], { dusk: 150 }],
    ['Goldenrod drifts', '640x860', 'lichen 60 acorns 50 goldenrod 36 galls 16 oakbark 12 walnut 8 goldenrodDrift 2', 'gather goldenrodDrift 2', ['sweep 18', 'all']],
    ['The goat in the leaves', '660x880', 'acorns 64 lichen 56 goldenrod 24 susan 24 galls 16 oakbark 10 poke 8', 'level 6', ['sweep 18', 'all'], { goat: true }],
    ['The beehive', '680x900', 'lichen 60 acorns 56 goldenrod 36 susan 20 galls 16 walnut 10 goldenrodDrift hive', 'landmark hive', ['sweep 20', 'all']],
    ['Forest jars', '700x920', 'acorns 66 lichen 54 susan 34 goldenrod 20 galls 16 oakbark 12 poke 10 walnut 10', 'jars rudbeckia 1 pokeweed 1 walnut 1', ['level 6', 'all']],
    ['The old oak', '720x960', 'lichen 70 acorns 60 goldenrod 30 susan 24 galls 18 oakbark 12 poke 8 walnut 12 walnutTree 2 oak', 'landmark oak', ['sweep 25', 'all']],
  ],
  indigo: [
    ['The terrace gate', '520x720', 'marigold 56 onion 40 woad 14 indigo 8', 'gather indigo 6', ['level 3', 'all'],
      { finds: '', gates: [[0.3, 0.5, 3]], zones: { indigo: [0, 0, 1, 0.28] } }],
    ['Woad and weld rows', '540x740', 'marigold 56 onion 46 woad 18 weld 12 indigo 6', 'jars woad 1 weld 1', ['level 4', 'all'],
      { gates: [[0.68, 0.4, 3]], zones: { weld: [0, 0.7, 1, 1] } }],
    ['Two gates', '560x780', 'marigold 60 onion 46 woad 18 weld 12 madder 8 indigo 8', 'level 5', ['sweep 15', 'all'],
      { gates: [[0.28, 0.3, 3], [0.72, 0.7, 4]] }],
    ['Japanese indigo terraces', '580x800', 'marigold 60 onion 46 japIndigo 18 woad 12 weld 10 indigo 8', 'gather japIndigo 12', ['sweep 15', 'all'],
      { gates: [[0.3, 0.6, 3]], zones: { japIndigo: [0, 0, 1, 0.3] } }],
    ['Marigolds on the walls', '600x820', 'marigold 80 onion 40 coreopsis 20 woad 16 weld 12 indigo 8', 'gather marigold 50', ['level 5', 'all'],
      { gates: [[0.7, 0.3, 3]] }],
    ['The indigo hedge', '620x840', 'marigold 62 onion 50 woad 18 weld 12 madder 8 indigo 12 indigoHedge 2', 'gather indigoHedge 2', ['sweep 18', 'all'],
      { gates: [[0.3, 0.5, 4]] }],
    ['Terraces at dusk', '620x840', 'marigold 66 onion 50 woad 20 weld 12 indigo 14', 'jars indigo 2', ['dusk', 'all'],
      { dusk: 170, gates: [[0.32, 0.4, 3]] }],
    ['The indigo vat', '640x860', 'marigold 64 onion 50 woad 20 weld 14 coreopsis 12 madder 8 indigo 12 vat', 'landmark vat', ['sweep 18', 'all'],
      { gates: [[0.3, 0.5, 4]], zones: { vat: [0.1, 0, 0.9, 0.26] } }],
    ['Onion skins', '660x880', 'onion 80 marigold 50 woad 20 weld 14 madder 8 indigo 12', 'jars onion 2', ['level 5', 'all'],
      { gates: [[0.7, 0.6, 3], [0.3, 0.4, 5]] }],
    ['Hay bales', '680x900', 'marigold 66 onion 54 woad 20 weld 16 coreopsis 12 indigo 12 indigoHedge bales', 'landmark bales', ['sweep 20', 'all'],
      { gates: [[0.72, 0.5, 4]], zones: { bales: [0.1, 0.76, 0.9, 1] } }],
    ['Madder on the top terrace', '700x920', 'marigold 70 onion 54 woad 22 weld 16 madder 14 indigo 12', 'gather madder 10', ['level 5', 'all'],
      { gates: [[0.3, 0.5, 4]], zones: { madder: [0, 0, 1, 0.28] } }],
    ['Indigo harvest', '740x980', 'marigold 74 onion 60 japIndigo 16 woad 22 weld 16 madder 12 indigo 16 indigoHedge 2 vat bales', 'all', ['sweep 20', 'sweep 30'],
      { gates: [[0.26, 0.3, 4], [0.74, 0.7, 5]] }],
  ],
  cottage: [
    ['The sleeping cat', '520x720', 'chamomile 54 marigold 40 cosmos 20 woad 12 weld 6', 'level 3', ['cat', 'all'], { finds: '', cat: [0.78, 0.24] }],
    ['Alkanet', '540x740', 'chamomile 50 tansy 40 alkanet 20 woad 12 weld 6', 'gather alkanet 12', ['cat', 'all'], { cat: [0.2, 0.78] }],
    ['Cosmos and coreopsis', '560x760', 'cosmos 60 marigold 44 coreopsis 22 woad 14 weld 8', 'jars cosmos 1 coreopsis 1', ['cat', 'all'], { cat: [0.8, 0.8] }],
    ['A French marigold border', '580x780', 'frenchMarigold 70 chamomile 40 alkanet 16 woad 14 weld 10', 'gather frenchMarigold 40', ['cat', 'sweep 18'], { cat: [0.22, 0.2] }],
    ['The cottage brook', '600x800', 'chamomile 56 tansy 40 alkanet 16 woad 16 weld 10 madder 6', 'float 10', ['cat', 'all'], { cat: [0.8, 0.2], stream: { y: 0.62, s: 'tansy', n: 12 } }],
    ['Cat by the shed', '620x820', 'chamomile 60 marigold 46 alkanet 16 woad 16 weld 12 madder 8 shed', 'landmark shed', ['cat', 'all'], { cat: [0.2, 0.8] }],
    ['The herb gate', '640x840', 'tansy 60 chamomile 46 alkanet 18 woad 16 weld 12 madder 8', 'gather alkanet 14', ['cat', 'all'],
      { cat: [0.8, 0.84], gates: [[0.3, 0.4, 3]], zones: { alkanet: [0, 0, 1, 0.28] } }],
    ['Cottage at dusk', '640x840', 'chamomile 64 cosmos 50 coreopsis 20 woad 18 weld 12 madder 8', 'jars cosmos 1 madder 1', ['dusk', 'cat'], { dusk: 160, cat: [0.2, 0.22] }],
    ['Bees in the borders', '660x880', 'tansy 60 marigold 50 goldenrod 24 alkanet 16 woad 16 weld 12 madder 8 hive', 'landmark hive', ['cat', 'all'], { cat: [0.8, 0.8] }],
    ['Finds among the flowers', '680x900', 'chamomile 66 frenchMarigold 50 cosmos 20 alkanet 18 woad 18 weld 12 madder 10', 'level 5', ['spindle', 'cat'], { spindle: 1, cat: [0.2, 0.2] }],
    ['Purple and gold', '700x920', 'chamomile 64 frenchMarigold 56 alkanet 24 woad 18 weld 14 madder 10 scarecrow', 'jars alkanet 1 tagetes 2', ['cat', 'all'], { cat: [0.8, 0.22] }],
    ['The cottage garden', '740x960', 'chamomile 70 tansy 50 marigold 40 cosmos 20 alkanet 20 woad 20 weld 14 madder 12 madderBed hive well', 'all', ['cat', 'sweep 25'], { cat: [0.2, 0.84] }],
  ],
  desert: [
    ['Safflower', '540x720', 'cosmos 56 marigold 40 safflower 30 avocado 10', 'gather safflower 16', ['level 3', 'all'], { finds: '' }],
    ['Prickly pears', '560x760', 'cosmos 56 marigold 44 safflower 20 avocado 14 pad 10', 'gather pad 6', ['level 4', 'all']],
    ['Hibiscus', '580x780', 'cosmos 60 marigold 40 safflower 20 avocado 14 hibiscus 14', 'gather hibiscus 10', ['sweep 15', 'all']],
    ['Desert dusk', '580x780', 'cosmos 64 marigold 50 safflower 24 avocado 14 hibiscus 10', 'jars safflower 1 cosmos 1', ['dusk', 'all'], { dusk: 150 }],
    ['The oasis channel', '600x800', 'cosmos 60 marigold 44 safflower 20 avocado 14 hibiscus 12 logwood 6', 'float 12', ['sweep 15', 'all'], { stream: { y: 0.6, s: 'cosmos', n: 14, amp: 0.02 } }],
    ['Cutch', '620x820', 'cosmos 60 marigold 46 safflower 22 avocado 14 logwood 10 cutch 8', 'gather cutch 6', ['level 5', 'all']],
    ['The adobe gate', '640x840', 'cosmos 64 marigold 50 safflower 22 avocado 16 hibiscus 12 pad 8', 'level 5', ['sweep 18', 'all'], { gates: [[0.28, 0.5, 3], [0.72, 0.5, 4]] }],
    ['The cochineal vat', '660x880', 'cosmos 64 marigold 50 safflower 20 avocado 16 logwood 12 pad 12 cactus 2 cochVat', 'landmark cochVat', ['sweep 20', 'all']],
    ['Logwood and the goat', '680x900', 'cosmos 70 marigold 50 safflower 22 avocado 16 hibiscus 12 logwood 14 cutch 6', 'gather logwood 10', ['level 6', 'all'], { goat: true }],
    ['Pink and red', '700x920', 'cosmos 66 marigold 50 safflower 26 avocado 16 hibiscus 16 pad 12', 'jars hibiscus 1 safflower 1 cochineal 1', ['sweep 20', 'all']],
    ['The potting shed', '700x920', 'cosmos 70 marigold 54 safflower 24 avocado 16 hibiscus 12 logwood 10 cutch 6 adobeShed', 'landmark adobeShed', ['dusk', 'all'], { dusk: 180 }],
    ['Desert bloom', '760x1000', 'cosmos 74 marigold 56 safflower 26 avocado 18 hibiscus 14 logwood 12 cutch 8 pad 12 cactus 2 cochVat adobeShed', 'all', ['sweep 25', 'sweep 35']],
  ],
  winter: [
    ['Hedge apples', '540x740', 'crottle 56 acorns 44 galls 14 osage 10', 'gather osage 6', ['level 3', 'all'], { finds: '' }],
    ['The hedgerow gate', '560x760', 'crottle 56 acorns 46 galls 16 osage 10 oakbark 6', 'gather osage 8', ['level 4', 'all'], { gates: [[0.3, 0.4, 2]], zones: { osage: [0, 0, 1, 0.28] } }],
    ['Orchil lichen', '580x780', 'crottle 50 orchil 36 acorns 40 galls 14 osage 8', 'gather orchil 18', ['level 4', 'all']],
    ['Rhubarb crowns in the snow', '600x800', 'crottle 56 acorns 50 orchil 20 galls 14 rhubarb 12', 'gather rhubarb 8', ['sweep 15', 'all']],
    ['The frozen stream', '620x820', 'crottle 60 acorns 50 orchil 20 galls 16 osage 10 rhubarb 6', 'float 10', ['level 5', 'all'], { stream: { y: 0.45, s: 'crottle', n: 12, v: 10 } }],
    ['The Osage orange tree', '640x860', 'crottle 60 acorns 54 orchil 22 galls 16 osage 14 oakbark 8 osageTree', 'gather osageTree 1', ['sweep 18', 'all']],
    ['Winter cat', '660x880', 'crottle 64 acorns 54 orchil 20 galls 16 alkanet 12 osage 10 rhubarb 6', 'level 6', ['cat', 'all'], { cat: [0.8, 0.2], gates: [[0.7, 0.4, 3]] }],
    ['A short winter day', '660x880', 'crottle 66 acorns 56 orchil 24 galls 16 osage 12 rhubarb 8', 'jars osage 1 orchil 1', ['dusk', 'all'], { dusk: 160 }],
    ['Galls and bark', '680x900', 'acorns 66 crottle 54 galls 24 oakbark 16 osage 10 walnut 8', 'jars oakgray 1 oaktan 2', ['level 5', 'all'], { gates: [[0.28, 0.6, 4]] }],
    ['The old well in snow', '700x920', 'crottle 66 acorns 56 orchil 24 galls 16 alkanet 14 osage 12 rhubarb 8 well', 'landmark well', ['sweep 20', 'all'], { goat: true }],
    ['Lichen walls', '720x940', 'crottle 74 orchil 40 acorns 50 galls 18 osage 12 oakbark 10', 'jars crottle 1 orchil 1', ['sweep 20', 'all'], { cat: [0.2, 0.8] }],
    ['Winter hedgerow', '760x1000', 'crottle 70 acorns 60 orchil 30 galls 18 alkanet 14 osage 14 oakbark 10 rhubarb 10 walnut 8 osageTree 2 bales', 'all', ['cat', 'sweep 25'],
      { cat: [0.8, 0.82], gates: [[0.26, 0.5, 4], [0.74, 0.5, 5]] }],
  ],
  dyehouse: [
    ['The dye yard', '600x800', 'onion 60 marigold 50 woad 16 weld 14 madder 8 indigo 6', 'level 5', ['sweep 15', 'all']],
    ['Drying racks', '620x840', 'onion 60 chamomile 50 weld 18 broom 10 logwood 10 madder 10', 'jars weld 1 logwood 1 madder 1', ['level 5', 'all']],
    ['The mill race', '640x860', 'chamomile 64 marigold 50 woad 18 weld 14 japIndigo 14 madder 10', 'float 14', ['sweep 18', 'all'], { stream: { y: 0.36, s: 'marigold', n: 16, v: 20 } }],
    ['The hundredth garden', '680x900', 'chamomile 66 tansy 50 marigold 40 woad 20 weld 16 goldenrod 14 madder 12 madderBed 2 barrow', 'all', ['sweep 25', 'spindle'], { spindle: 1 }],
    ['Cat on the woodpile', '700x920', 'onion 64 lichen 50 acorns 30 galls 16 oakbark 14 walnut 12 cutch 8', 'jars walnut 1 cutch 1', ['cat', 'all'], { cat: [0.2, 0.2] }],
    ['Yard gates', '720x940', 'onion 66 marigold 56 woad 20 weld 16 safflower 16 madder 12 indigo 10', 'level 6', ['sweep 20', 'all'], { gates: [[0.28, 0.3, 4], [0.72, 0.7, 5]] }],
    ['Dusk at the dye-house', '720x940', 'chamomile 70 marigold 56 woad 22 weld 16 hibiscus 12 madder 12 indigo 10', 'jars indigo 1 madder 1 weld 1', ['dusk', 'all'], { dusk: 180 }],
    ['Every color', '740x980', 'tansy 64 cosmos 50 crottle 30 woad 20 japIndigo 16 safflower 16 alkanet 14 elder 10 madder 12', 'jars tansy 1 japindigo 1 safflower 1 madder 1', ['sweep 20', 'all']],
    ['The goat visits the yard', '760x1000', 'onion 70 marigold 60 woad 22 weld 16 goldenrod 16 rhubarb 10 poke 8 madder 10', 'level 7', ['sweep 25', 'all'], { goat: true }],
    ['Stream, gate and cat', '780x1040', 'chamomile 74 frenchMarigold 56 woad 22 weld 16 japIndigo 16 alkanet 14 madder 12 indigo 10', 'gather indigo 8', ['cat', 'float 14'],
      { stream: { y: 0.6, s: 'chamomile', n: 16 }, gates: [[0.26, 0.5, 4]], cat: [0.82, 0.86], zones: { indigo: [0, 0, 1, 0.24] } }],
    ['Bales by the vats', '860x1160', 'onion 90 marigold 70 tansy 36 woad 28 weld 20 logwood 14 madder 16 indigo 14 indigoHedge 2 bales', 'landmark bales', ['sweep 25', 'all']],
    ['The dye-house', '1000x1360', 'chamomile 120 onion 100 marigold 80 tansy 50 woad 36 japIndigo 24 weld 28 safflower 22 logwood 18 madder 22 cutch 12 indigo 18 madderBed 2 indigoHedge 2 dyehouse', 'landmark dyehouse', ['all', 'sweep 30'],
      { stream: { y: 0.78, s: 'marigold', n: 18, amp: 0.02 } }],
  ],
};

// ---------------------------------------------------------------------------
// Parsing the rows (once, at load)
// ---------------------------------------------------------------------------
function parseMix(str) {
  const t = str.trim().split(/\s+/);
  const out = [];
  for (let k = 0; k < t.length; k++) {
    const s = t[k];
    if (!SPECIES[s]) throw new Error('garden path: unknown species ' + s);
    const n = /^\d+$/.test(t[k + 1] || '') ? Number(t[++k]) : 1;
    out.push([s, n]);
  }
  return out;
}
/** 'gather tansy 12' | 'float 8' | 'jars weld 1 woad 1' | 'landmark barrow' | 'level 5' | 'all' | 'sweep 15' | 'cat' | 'spindle' | 'dusk' */
export function parseGoal(str) {
  const [t, ...a] = str.trim().split(/\s+/);
  switch (t) {
    case 'gather': if (!SPECIES[a[0]]) throw new Error('garden path: goal species ' + a[0]); return Object.freeze({ t, s: a[0], n: Number(a[1]) });
    case 'landmark': if (!SPECIES[a[0]]) throw new Error('garden path: landmark ' + a[0]); return Object.freeze({ t, s: a[0] });
    case 'float': case 'level': case 'sweep': return Object.freeze({ t, n: Number(a[0]) });
    case 'jars': {
      const jars = {};
      for (let k = 0; k < a.length; k += 2) { if (!DYES[a[k]]) throw new Error('garden path: dye ' + a[k]); jars[a[k]] = Number(a[k + 1]); }
      return Object.freeze({ t, jars: Object.freeze(jars) });
    }
    case 'all': case 'cat': case 'spindle': case 'dusk': return Object.freeze({ t });
    default: throw new Error('garden path: goal ' + str);
  }
}

const built = [];
for (const ch of CHAPTERS) {
  ROWS[ch.id].forEach((row, k) => {
    const [name, size, mix, goal, stars, opt = {}] = row;
    const [W, H] = size.split('x').map(Number);
    const n = built.length + 1;
    const id = `${ch.id}-${k + 1}`;
    built.push(Object.freeze({
      id, n, chapter: ch.id, k: k + 1, name, size: Object.freeze([W, H]), ground: ch.ground, rows: opt.rows ?? ch.rows ?? 0,
      mix: Object.freeze(parseMix(mix)), goal: parseGoal(goal), stars: Object.freeze(stars.map(parseGoal)),
      goat: !!opt.goat, dusk: opt.dusk || 0, finds: (opt.finds ?? ch.finds).split(/\s+/).filter(Boolean),
      spindle: opt.spindle ?? 0.15, stream: opt.stream ? Object.freeze({ ...opt.stream }) : null,
      gates: Object.freeze((opt.gates || []).map(([y, x, level]) => Object.freeze({ y, x, level }))),
      cat: opt.cat ? Object.freeze({ x: opt.cat[0], y: opt.cat[1] }) : null, zones: opt.zones || null,
      // a landmark comes in after 92% of everything else; without one, the biggest plants after 80% of the rest
      landAt: opt.landAt || (parseMix(mix).some(([s]) => SPECIES[s].landmark) ? 0.92 : 0.8), seed: (opt.seed || hashStr('path:' + id)) >>> 0,
    }));
  });
}
export const LEVELS = Object.freeze(built);
export const LEVEL_BY_ID = Object.freeze(Object.fromEntries(LEVELS.map((l) => [l.id, l])));
export const levelIndex = (id) => (LEVEL_BY_ID[id] ? LEVEL_BY_ID[id].n - 1 : -1);
export const chapterLevels = (chId) => LEVELS.filter((l) => l.chapter === chId);

// ---------------------------------------------------------------------------
// What is new in each garden (for the intro cards): plants and landmarks seen
// for the first time on the path (the five places' own plants only when they
// are new to the path and not one of the classic places' everyday ones),
// and each mechanic the first time it appears.
// ---------------------------------------------------------------------------
const CLASSIC = new Set(['chamomile', 'marigold', 'cosmos', 'onion', 'lichen', 'acorns', 'coreopsis', 'woad', 'galls', 'avocado', 'weld', 'broom',
  'seaweed', 'logwood', 'oakbark', 'madder', 'sumac', 'walnut', 'pad', 'indigo', 'madderBed', 'sumacGrove', 'walnutTree', 'indigoHedge', 'cactus',
  'hayCart', 'walnutCart', 'shed', 'beachHut', 'adobeShed', 'vat', 'cochVat', 'oak', 'boat']);
export const MECHANICS = Object.freeze({
  finds: { name: 'Sparkly finds', text: 'Roll over a sparkle: a wide brim lets bigger things in for a moment, a breeze draws little plants to you.' },
  goat: { name: "The neighbor's goat", text: 'The goat nibbles little plants. It is only being a goat: a big basket makes it hop away, and nothing is lost but a nibble.' },
  dusk: { name: 'Before dusk (if you like)', text: 'Some gardens offer a sun to race. Pick "Before dusk" for an extra star, or "No clock" to take your time. Dusk only brings the basket home; you keep everything.' },
  stream: { name: 'The stream', text: 'A stream carries flowers past. Hold the basket in the water and they float right in. They come round again if you miss them.' },
  gates: { name: 'Garden gates', text: 'Hedges with gates split the garden. Each gate opens when the basket reaches the size on its sign. Gather what you can reach first.' },
  cat: { name: 'The napping cat', text: 'A cat is napping in the sun. Give it room for a star. If it wakes, it just stretches and pads off to nap somewhere quieter.' },
});
const mechsOf = (l) => [l.finds.length && 'finds', l.goat && 'goat', l.dusk && 'dusk', l.stream && 'stream', l.gates.length && 'gates', l.cat && 'cat'].filter(Boolean);
const introCache = (() => {
  const seenS = new Set(), seenM = new Set(), out = {};
  for (const l of LEVELS) {
    const plants = [];
    const kinds = l.mix.map(([s]) => s).concat(l.stream ? [l.stream.s] : []);
    for (const s of kinds) if (!seenS.has(s)) { seenS.add(s); if (!CLASSIC.has(s)) plants.push(s); }
    const mechs = mechsOf(l).filter((m) => !seenM.has(m));
    mechs.forEach((m) => seenM.add(m));
    out[l.id] = Object.freeze({ plants: Object.freeze(plants), mechanics: Object.freeze(mechs) });
  }
  return out;
})();
/** introFor(levelId) -> {plants:[species ids new here], mechanics:[ids new here]}. */
export const introFor = (id) => introCache[id] || { plants: [], mechanics: [] };

// ---------------------------------------------------------------------------
// Generating a garden
// ---------------------------------------------------------------------------
/** The place-shaped recipe generateFrom takes. */
export function placeOf(level) {
  return {
    id: 'path:' + level.id, size: level.size, mix: level.mix, ground: level.ground, rows: level.rows || undefined, zones: level.zones || undefined,
    landAt: level.landAt, finds: level.finds, spindle: level.spindle,
    stream: level.stream ? { ...level.stream, w: 22 } : undefined, hedges: level.gates.map((g) => ({ y: g.y })), cat: level.cat || undefined,
  };
}

/** The basket mass at which basket level n is reached (level 1 is the start). */
export function massForLevel(g, n) {
  if (n <= 1) return 0;
  const list = levelsOf(g);
  return list[Math.min(n, list.length + 1) - 2].mass;
}

/** Plants behind closed gates: each plant's `need` (the mass that opens every gate between it and the start). */
function applyGates(g) {
  for (const p of g.plants) {
    let need = 0;
    for (const h of g.hedges) if ((g.start.y - h.y) * (p.y - h.y) < 0) need = Math.max(need, h.mass);
    if (need) p.need = need; else delete p.need;
  }
}

/** Smallest-first gathering that respects gates: the exact feasibility check for a gated garden. */
export function pathFinish(g) {
  const n = g.plants.length;
  const order = g.plants.map((p, i) => i).sort((a, b) => g.plants[a].r - g.plants[b].r || a - b);
  const taken = new Uint8Array(n);
  let mass = 0, left = n;
  const seq = [];
  while (left) {
    let pick = -1;
    for (const i of order) {
      if (taken[i]) continue;
      const p = g.plants[i];
      if (p.need && mass < p.need) continue;
      if (fits(g, p, mass)) pick = i;
      break;
    }
    if (pick < 0) return { ok: false, gathered: seq.length, mass, order: seq };
    taken[pick] = 1; left--; seq.push(pick);
    mass += growthOf(g.plants[pick]);
  }
  return { ok: true, gathered: n, mass, order: seq };
}

function buildPath(level) {
  const g = generateFrom(placeOf(level), level.seed, MODES.path);
  g.level = level.id;
  g.chapter = level.chapter;
  if (level.gates.length) {
    const max = levelsOf(g).length + 1;
    g.hedges = level.gates.map((gt, k) => ({ y: g.hedges[k].y, x: Math.round(g.W * gt.x), gap: GATE_GAP, level: Math.max(2, Math.min(max, gt.level)), asked: gt.level, mass: 0 }));
    // a gate asked to open later than its side of the garden can grow the basket opens a size sooner
    for (let guard = 0; guard < 20; guard++) {
      for (const h of g.hedges) h.mass = massForLevel(g, h.level);
      applyGates(g);
      const res = pathFinish(g);
      if (res.ok) break;
      const shut = g.hedges.filter((h) => h.mass > res.mass && h.level > 2).sort((a, b) => a.mass - b.mass)[0];
      if (!shut) break;
      shut.level -= 1;
    }
  }
  if (g.cat) g.cat.spots = catSpots(g);
  return g;
}

const MEMO_MAX = 4;
const memo = new Map();
/** pathGarden(levelId) -> the generated garden for that level (memoized; treat it as read-only). */
export function pathGarden(id) {
  const level = LEVEL_BY_ID[id];
  if (!level) throw new RangeError('unknown garden ' + id);
  if (memo.has(id)) { const g = memo.get(id); memo.delete(id); memo.set(id, g); return g; }
  const g = buildPath(level);
  memo.set(id, g);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  return g;
}

// ---------------------------------------------------------------------------
// Gates, the stream and the cat (shared by the screen and the autopilot)
// ---------------------------------------------------------------------------
/** Move the basket's middle from (x0, y0) to (x1, y1): a hedge stops it unless its gate is open and she is in the gateway. */
export function hedgeStep(g, x0, y0, x1, y1, mass) {
  let blocked = false;
  if (!g.hedges) return { x: x1, y: y1, blocked };
  for (const h of g.hedges) {
    const s0 = y0 - h.y, s1 = y1 - h.y;
    if (s0 === 0 || s0 * s1 > 0) continue;
    const pass = mass >= h.mass && Math.abs(x1 - h.x) <= h.gap;
    if (!pass) { y1 = h.y + Math.sign(s0) * 0.5; blocked = true; }
  }
  return { x: x1, y: y1, blocked };
}
/** Is a gate open at this mass? */
export const gateOpen = (h, mass) => mass >= h.mass;

/** Four quiet corners the cat naps in (the first is where it starts). */
export function catSpots(g) {
  const c = g.cat;
  const corners = [[0.14, 0.14], [0.86, 0.14], [0.86, 0.86], [0.14, 0.86]].map(([x, y]) => ({ x: Math.round(g.W * x), y: Math.round(g.H * y) }));
  corners.sort((a, b) => Math.hypot(b.x - c.x, b.y - c.y) - Math.hypot(a.x - c.x, a.y - c.y));
  return [{ x: c.x, y: c.y }, ...corners.slice(0, 3)];
}
/** Does the basket come close enough to wake the cat? */
export function catWakes(cat, bx, by, br) {
  const d = br * 0.55 + 18;
  return (bx - cat.x) ** 2 + (by - cat.y) ** 2 < d * d;
}
/** Where a woken cat goes: the nap spot farthest from the basket. */
export function catNextSpot(g, bx, by) {
  let best = g.cat.spots[0], bd = -1;
  for (const s of g.cat.spots) { const d = (s.x - bx) ** 2 + (s.y - by) ** 2; if (d > bd) { bd = d; best = s; } }
  return { x: best.x, y: best.y };
}

// ---------------------------------------------------------------------------
// Goals and stars
// ---------------------------------------------------------------------------
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const PROPER = /^(Japanese|French|Osage|Black-eyed Susan)\b/;
/** A plant or dye name inside a sentence: lower case, except where it starts with a proper name. */
const lc = (s) => (PROPER.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
export const nameInSentence = lc;
/** The words for a goal or a star. */
export function goalText(goal, level = null) {
  switch (goal.t) {
    case 'gather': return `Gather ${goal.n} ${goal.n === 1 ? lc(SPECIES[goal.s].name) : SPECIES[goal.s].many}`;
    case 'float': return `Catch ${goal.n} floating ${level && level.stream ? SPECIES[level.stream.s].many : 'flowers'}`;
    case 'jars': {
      const parts = Object.entries(goal.jars).map(([d, n], k) => (k === 0 ? `${n} ${n === 1 ? 'jar' : 'jars'} of ${lc(DYES[d].name)}` : `${n} of ${lc(DYES[d].name)}`));
      return `Fill ${listAnd(parts)}`;
    }
    case 'landmark': return `Fit ${SPECIES[goal.s].the || lc(SPECIES[goal.s].name)} in the basket`;
    case 'level': return `Grow the basket to Basket ${goal.n}`;
    case 'all': return 'Gather the whole garden';
    case 'sweep': return `Sweep up ${goal.n} in one go`;
    case 'cat': return 'Let the cat nap';
    case 'spindle': return 'Find the lost spindle';
    case 'dusk': return 'Meet the goal before dusk';
    default: return '';
  }
}
/** A short form for the play screen's goal line. */
export function goalShort(goal, level = null) {
  switch (goal.t) {
    case 'gather': return SPECIES[goal.s].many;
    case 'float': return `floating ${level && level.stream ? SPECIES[level.stream.s].many : 'flowers'}`;
    case 'jars': return 'jars';
    case 'landmark': return SPECIES[goal.s].the || SPECIES[goal.s].name;
    case 'level': return `Basket ${goal.n}`;
    case 'all': return 'the whole garden';
    default: return goalText(goal, level);
  }
}

/**
 * progress(g, goal, ids, flags) -> {have, need, met}: how far a goal or star is.
 * ids: gathered plant ids (in order). flags (from the screen; stars are only
 * stars, so they are taken on trust): {eaten, sweep, spindle, catWoke, sun, beforeDusk}.
 */
export function progress(g, goal, ids, flags = {}) {
  const P = g.plants;
  switch (goal.t) {
    case 'gather': { let have = 0; for (const i of ids) if (P[i] && P[i].s === goal.s) have++; return done(have, goal.n); }
    case 'float': { let have = 0; for (const i of ids) if (P[i] && P[i].fl) have++; return done(have, goal.n); }
    case 'landmark': { const have = ids.some((i) => P[i] && P[i].s === goal.s) ? 1 : 0; return done(have, 1); }
    case 'jars': {
      const units = {};
      for (const i of ids) { const p = P[i]; if (!p) continue; const d = SPECIES[p.s].dye; units[d] = (units[d] || 0) + unitsOf(p); }
      let have = 0, need = 0, met = true;
      for (const [d, n] of Object.entries(goal.jars)) {
        const u = Math.min(units[d] || 0, n * JAR);
        have += u; need += n * JAR;
        if (u < n * JAR) met = false;
      }
      return { have: Math.floor(have), need, met, units };
    }
    case 'level': {
      let mass = 0;
      for (const i of ids) if (P[i]) mass += growthOf(P[i]);
      return done(levelInfo(g, mass).level, goal.n);
    }
    case 'all': { const have = Math.min(P.length, ids.length + Math.max(0, flags.eaten | 0)); return done(have, P.length); }
    case 'sweep': return done(Math.max(0, flags.sweep | 0), goal.n);
    case 'cat': return done(flags.catWoke ? 0 : 1, 1);
    case 'spindle': return done(flags.spindle ? 1 : 0, 1);
    case 'dusk': return done(flags.sun && flags.beforeDusk ? 1 : 0, 1);
    default: return done(0, 1);
  }
}
function done(have, need) { return { have: Math.min(have, need), need, met: have >= need }; }

/** The whole score of a visit: the main goal and the stars (1 for the goal, +1 per extra star met with it). */
export function score(level, g, ids, flags = {}) {
  const main = progress(g, level.goal, ids, flags);
  const extras = level.stars.map((st) => ({ goal: st, text: goalText(st, level), ...progress(g, st, ids, flags) }));
  // stars are counted only with the main goal (the dusk star needs it met before dusk)
  const stars = main.met ? 1 + extras.filter((e) => e.met).length : 0;
  return { met: main.met, main, extras, stars };
}

// ---------------------------------------------------------------------------
// A headless autopilot: straight at the nearest plant that fits, through the
// gateways, catching floating plants where they are. A lower bound on a visit's
// time, and the proof each garden can be finished (test/garden-path.test.js,
// tools/garden-path-check.mjs). Its speed matches the screen's top speed.
// ---------------------------------------------------------------------------
/** The point the autopilot steers for: the plant, or the gateway on the way to it. */
export function steerPoint(g, mass, bx, by, px, py) {
  if (g.hedges) {
    // the nearest hedge between the basket and the plant
    let best = null, bd = Infinity;
    for (const h of g.hedges) {
      if ((by - h.y) * (py - h.y) >= 0) continue;
      const d = Math.abs(by - h.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best && gateOpen(best, mass)) {
      const side = Math.sign(by - best.y);
      if (Math.abs(bx - best.x) > best.gap * 0.6) return { x: best.x, y: best.y + side * 26 };
      return { x: best.x, y: best.y - side * 40 };
    }
  }
  return { x: px, y: py };
}

/** The nearest plant that fits now (floating ones where they are at time t), or -1. */
export function nearestFit(g, mass, taken, x, y, t = 0) {
  const lim = OPENING * basketRadius(g, mass);
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.plants.length; i++) {
    const p = g.plants[i];
    if (taken[i] || p.r > lim || (p.need && mass < p.need)) continue;
    const q = p.fl ? floatPos(g, p, t) : p;
    // a plant behind a hedge is reached through its gateway: count the detour
    let d = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (g.hedges) for (const h of g.hedges) if ((y - h.y) * (q.y - h.y) < 0) d += (Math.abs(x - h.x) + Math.abs(q.x - h.x)) ** 2 * 0.5;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * autoplay(level, {maxT, until:'goal'|'all', dt}) -> {got, secs, goalAt, done, mass, stuck}
 * goalAt: seconds when the main goal was first met (or null).
 */
export function autoplay(level, { maxT = 900, until = 'all', dt = 1 / 20 } = {}) {
  const g = pathGarden(level.id);
  const n = g.plants.length;
  const taken = new Uint8Array(n);
  const grid = buildGrid(g.plants, g.W, g.H, 64);
  const floaters = g.plants.map((p, i) => (p.fl ? i : -1)).filter((i) => i >= 0);
  const got = [];
  let mass = 0, x = g.start.x, y = g.start.y, t = 0, target = -1, next = 0, goalAt = null, idle = 0, sweep = 0, best = 0, lastAt = -9;
  const goalCheck = () => {
    if (goalAt === null && progress(g, level.goal, got, { sweep: best }).met) goalAt = t;
  };
  const take = (i) => {
    taken[i] = 1; got.push(i); mass += growthOf(g.plants[i]);
    sweep = t - lastAt <= 0.5 ? sweep + 1 : 1; lastAt = t; best = Math.max(best, sweep);
    goalCheck();
  };
  goalCheck();
  while (t < maxT && got.length < n) {
    if (until === 'goal' && goalAt !== null) break;
    t += dt;
    const br = basketRadius(g, mass);
    const speed = 100 * Math.pow(br / R0, 0.6);
    if (t > next || target < 0 || taken[target]) { target = nearestFit(g, mass, taken, x, y, t); next = t + 0.25; }
    if (target < 0) { idle += dt; if (idle > 3) break; continue; }
    idle = 0;
    const p = g.plants[target];
    const q = p.fl ? floatPos(g, p, t) : p;
    const aim = steerPoint(g, mass, x, y, q.x, q.y);
    const dx = aim.x - x, dy = aim.y - y, d = Math.hypot(dx, dy) || 1, m = Math.min(d, speed * dt);
    const mv = hedgeStep(g, x, y, x + (dx / d) * m, y + (dy / d) * m, mass);
    const edge = Math.min(br * 0.7, 30);
    x = Math.max(edge, Math.min(g.W - edge, mv.x)); y = Math.max(edge, Math.min(g.H - edge, mv.y));
    const rr = basketRadius(g, mass);
    for (const i of queryGrid(grid, x - rr - 64, y - rr - 64, x + rr + 64, y + rr + 64)) {
      if (taken[i]) continue;
      const pl = g.plants[i];
      if ((pl.need && mass < pl.need) || !fits(g, pl, mass)) continue;
      if (over(x, y, basketRadius(g, mass), pl)) take(i);
    }
    for (const i of floaters) {
      if (taken[i] || !fits(g, g.plants[i], mass)) continue;
      const f = floatPos(g, g.plants[i], t);
      if ((f.x - x) ** 2 + (f.y - y) ** 2 <= basketRadius(g, mass) ** 2) take(i);
    }
  }
  return { got, secs: t, goalAt, done: got.length >= n, mass, stuck: got.length < n && idle > 3, sweep: best };
}

/** Is this a big thing (grand plant or landmark)? Re-exported for the screen's intro cards. */
export { isBig };
