// Authoring data (not loaded by the page): which painted source image each
// imported picture comes from, and how it is turned into a grid. Read by
//   node proto/lift/import-art.mjs --batch <dir with the PNGs> [--only id,id] [--write] [--gen]
// The grid size is the painting's slot size (LEVEL_DEFS `size` in chapters.js),
// so a picture can be re-imported, or swapped for a generated one, without
// moving its painting or its difficulty slot. The source PNGs are not kept in
// the repo; the converted grids are (art-imported.js).
//
// crop: [left, top, right, bottom] as fractions (ZOOM = a 10% zoom on the
// subject, keeping the 3:4 frame); chroma 2 matches hue before lightness, so the
// paintings' deep navy bands land on Navy rather than Charcoal (4 for a pale
// yellow that should stay yellow); drop: palette letters not to use (a goat
// that would melt into a madder band, a pine that should stay green).
const ZOOM = [0.1, 0.1, 0.9, 0.9];
const S = (file, o = {}) => ({ file, crop: ZOOM, chroma: 2, colors: 10, min: 3, ...o });

export const SOURCES = {
  // chapter 4: the kitchen garden
  sunflower: S('32_sunflower.png', { crop: null, chroma: 4 }),
  snail: S('05_snail.png'),
  cactus: S('34_cactus.png'),
  beehive: S('30_beehive.png'),
  houseplant: S('67_house_plant.png'),
  well: S('71_stone_well.png'),
  gardengate: S('70_garden_gate.png'),
  // chapter 5: out in the country
  rainbow: S('50_rainbow.png', { crop: null }),
  sunrise: S('49_sunrise_field.png', { crop: null }),
  goose: S('09_goose.png'),
  kite: S('65_kite.png', { crop: null }),
  barn: S('22_red_barn.png'),
  balloon: S('20_balloon.png', { crop: null }),
  goat: S('10_goat.png', { drop: 'd' }),
  alpaca: S('11_alpaca.png'),
  windmill: S('21_windmill.png'),
  cottagedoor: S('61_cottage_door.png'),
  bridge: S('23_covered_bridge.png', { crop: null }),
  // chapter 6: the country kitchen
  pear: S('03_pear.png'),
  strawberry: S('35_strawberry.png', { crop: null }),
  pumpkin: S('37_pumpkin.png', { crop: null }),
  croissant: S('45_croissant.png', { crop: null }),
  jam: S('47_jam_jar.png'),
  eggs: S('01_eggs.png'),
  cake: S('44_cake_slice.png'),
  // chapter 7: wool and thread
  sweater: S('19_sweater.png', { crop: null }),
  pincushion: S('15_pincushion.png'),
  quilts: S('13_folded_quilts.png'),
  hoop: S('77_embroidery_hoop.png'),
  logcabin: S('73_log_cabin_quilt.png'),
  buttons: S('17_button_jar.png'),
  sewing: S('14_sewing_machine.png'),
  // chapter 8: by the water
  whale: S('27_whale_tail.png'),
  swan: S('58_swan.png'),
  jellyfish: S('28_jellyfish.png'),
  duck: S('57_duck.png', { crop: null }),
  frog: S('59_frog_lily.png'),
  koi: S('60_koi.png'),
  rowboat: S('79_rowing_boat.png'),
  // chapter 9: woodland and autumn
  acorn: S('38_acorn.png', { crop: null }),
  rabbit: S('56_rabbit_dark.png', { crop: null }),
  robin: S('08_robin.png'),
  umbrella: S('51_umbrella_rain.png', { crop: null }),
  branch: S('39_autumn_branch.png'),
  dog: S('53_dog_scarf.png'),
  deer: S('55_deer.png'),
  market: S('63_market_stall.png'),
  // chapter 10: winter evenings
  candle: S('80_candle.png', { crop: null }),
  moon: S('48_moon_hills.png', { crop: null }),
  snowman: S('41_snowman.png'),
  lantern: S('78_lantern.png', { crop: null }),
  pine: S('40_snowy_pine.png', { drop: 'i' }),
  sleepycat: S('52_sleeping_cat.png', { crop: null }),
  carousel: S('64_carousel_horse.png'),
};

// Sources looked at and left out, and why (so a later pass need not redo it):
// near-duplicates of a painting already on the wall (06 owl, 07 hedgehog,
// 12 spinning wheel, 25 lighthouse, 26 sailboat, 29 mushroom, 31 bee,
// 33 tulips, 36 cherries, 42 mittens on a line, 18 mitten, 43 teacup,
// 02 teapot and 72 kettle (Tea for two), 54 fox, 69 birdhouse, 74 yarn skein,
// 75 loom, 76 dye vat, 24 canal boat (the rowing boat is the same picture));
// too thin or busy to read at play size (04 lemon tree, 16 scissors and thread,
// 62 bicycle, 68 watering can, 46 bread loaf (reads as a red ball) and
// 66 paper boat (lost at 18x24): generated pictures took their places).
