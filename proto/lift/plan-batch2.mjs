// Authoring tool (not loaded by the page): lays the batch 2 pictures
// (art-batch2.json) out as chapters and writes book-batch2.js. Run once, or again
// after art-batch2.json changes:
//   node proto/lift/plan-batch2.mjs <dir of batch 2 PNGs>
// Each theme of the job sheet becomes two chapters. Its pictures are ordered by
// how busy they are (color regions at 27x36): the calmer half opens the first
// chapter, the busier half the second, and inside a chapter they climb the
// same way. Ids, titles and nouns come from the subject and stay fixed once
// written (a save refers to a painting by id), so edit book-batch2.js by hand
// afterwards rather than re-planning a shipped book.
import { readFileSync, writeFileSync } from 'node:fs';
import { importPNG } from './import-art.mjs';
import { LEVEL_DEFS } from './chapters.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node proto/lift/plan-batch2.mjs <dir of batch 2 PNGs>'); process.exit(1); }
const sheet = JSON.parse(readFileSync(new URL('./art-batch2.json', import.meta.url), 'utf8'));

// Two chapters a theme: [name, intro line] each.
const NAMES = {
  orchard: [['The orchard', 'Cherries, grapes and a bowl of blueberries, ripe from the trees.'], ['Orchard harvest', 'Quinces, figs and a ladder against the old apple tree.']],
  vegpatch: [['The vegetable patch', 'Garlic, cabbages and peas still in the pod.'], ['The allotment', 'Radishes, squash and a scarecrow keeping watch.']],
  flowers: [['Flower border', 'Tulips, poppies and bluebells along the path.'], ['The cutting garden', 'Dahlias, irises and a pot of geraniums by the door.']],
  bugs: [['Little creatures', 'Butterflies, beetles and a wasp on the go.'], ['Under the leaves', 'Bumblebees, ladybirds and a bug hotel in the hedge.']],
  farm: [['Farm animals', 'Lambs, chicks and a ginger cat curled up in the hay.'], ['Down on the farm', 'Piglets, a llama and a rooster greeting the morning.']],
  farmyard: [['The farmyard', 'Hay bales, a haystack and a red wheelbarrow.'], ['Around the barn', 'A coop, a weathervane and a bright red tractor.']],
  woodland: [['In the woods', 'Hedgehogs, acorns and a toadstool ring under the trees.'], ['Deep in the forest', 'Otters, stags and a hare in the long grass.']],
  birds: [['Birds of a feather', 'Canaries, flamingos and a peacock showing off.'], ['Wings far and wide', 'Kingfishers, puffins and a robin on the fence.']],
  pond: [['The pond', 'A red canoe, a black swan and a frog on a stone.'], ['Down by the river', 'Newts, a mallard and a duck house on its post.']],
  seaside: [['At the seaside', 'Sun hats, ice lollies and a kite on the beach.'], ['On the pier', 'Deck chairs, sandcastles and a lighthouse on the rocks.']],
  undersea: [['Under the sea', 'Whales, sharks and a yellow submarine.'], ['The deep blue', 'Seahorses, an octopus and a treasure chest on the sea bed.']],
  baking: [['Baking day', 'Gingerbread men, iced buns and a lattice pie.'], ['The bakery counter', 'Scones, pretzels and a layer cake on its stand.']],
  pantry: [['The pantry shelf', 'A red teapot, a jar of jam and a wedge of cheese.'], ['The tea table', 'A kettle, a star mug and a pot of soup on the stove.']],
  textiles: [['The sewing room', 'Mittens, buttons and a tailor\'s dummy.'], ['Wool basket', 'Granny squares, tapestry and socks on the line.']],
  dyeworks: [['The dye house', 'Madder roots, woad leaves and a vat of indigo.'], ['Colors drying', 'Skeins on the pole, dyed cloths and a shelf of pigment.']],
  village: [['The village', 'A phone box, a post box and a blue front door.'], ['Market day', 'The post office, the bookshop and the clock tower.']],
  weather: [['Sky and weather', 'Moons, storm clouds and a bright summer sun.'], ['Far horizons', 'Misty mountains, palm islands and blossom on the hill.']],
  travel: [['Out and about', 'Buses, taxis and a little red post van.'], ['Long journeys', 'Sleighs, tugboats and a sailing ship.']],
  toys: [['The toy box', 'Spinning tops, a toy drum and a teddy bear.'], ['Music and play', 'Guitars, marbles and a rocking horse.']],
  seasons: [['Celebrations', 'Bonfires, crackers and a Christmas tree.'], ['Seasons turning', 'Stockings, birthday cake and a cup of cocoa.']],
};

// Titles: the subject without sizing and viewing words, first letter capitalized.
const DROP = /\b(a|an|one|big|bright|single|round|fat|little|large|small|seen from (the )?(side|front|above)|shown side-on|side-on|from above)\b/gi;
function title(subject) {
  let t = subject.replace(DROP, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(and|with)\s+/i, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return TITLES[t] || t;
}
// Hand-tidied titles (the generated one on the left).
const TITLES = {
  "Red cherry pair on plate": "Cherries on a plate",
  "Cluster of blackberries": "Blackberries",
  "Pomegranate split open": "Pomegranate",
  "Bunch of purple grapes": "Grapes",
  "Halved orange": "Orange",
  "Green apple with bite": "Bitten apple",
  "Orange carrot with green leaves": "Carrot",
  "Blueberries in bowl": "Bowl of blueberries",
  "Ripe banana bunch": "Bananas",
  "Redcurrants on stem": "Redcurrants",
  "Lemon with leaf": "Lemon",
  "Ripe peach": "Peach",
  "Apricots on branch": "Apricots",
  "Fig cut in half": "Fig",
  "Plum on leafy twig": "Plum",
  "Orchard ladder against apple tree": "Apple tree and ladder",
  "Red chili peppers": "Chili peppers",
  "Yellow bell pepper": "Bell pepper",
  "Green pea pod split open showing peas": "Peas in the pod",
  "Beetroot with leaves": "Beetroot",
  "Bunch of radishes": "Radishes",
  "Corn cob in its husk": "Corn on the cob",
  "Onion with papery skin": "Onion",
  "Tomatoes on the vine": "Tomatoes",
  "Garden scarecrow": "Scarecrow",
  "Cold frame with seedlings": "Seedlings in a cold frame",
  "Pink peony": "Peony",
  "Yellow sunflower head": "Sunflower head",
  "Lavender sprigs": "Lavender",
  "Hydrangea head": "Hydrangea",
  "Leaf with bite out of it": "Nibbled leaf",
  "Straw beehive skep": "Beehive skep",
  "Beetle with green shell": "Green beetle",
  "Yellow and black striped wasp": "Wasp",
  "Orange moth with two eye spots on its wings": "Eyed moth",
  "Yellow brimstone butterfly with its wings folded,": "Brimstone butterfly",
  "Red and black shield bug": "Shield bug",
  "Garden snail on pot": "Snail on a flowerpot",
  "Ladybird on leaf": "Ladybird",
  "Earthworm and soil": "Earthworm",
  "Moth on bark": "Moth on the bark",
  "Butterfly on thistle": "Butterfly on a thistle",
  "Bumblebee on lavender": "Bumblebee",
  "Firefly at dusk": "Firefly",
  "Wooden bug hotel": "Bug hotel",
  "Chicks in straw": "Chicks",
  "Cow in meadow": "Cow",
  "Chestnut-brown horse standing,": "Chestnut horse",
  "Ginger cat curled up": "Ginger cat",
  "Bull with nose ring": "Bull",
  "Rooster crowing": "Rooster",
  "Golden haystack": "Haystack",
  "Blue watering can": "Blue watering can",
  "Red wheelbarrow": "Red wheelbarrow",
  "Egg basket on fence": "Egg basket",
  "Scythe and sheaf of wheat": "Sheaf of wheat",
  "Milking stool and pail": "Milking pail",
  "Weathervane rooster": "Weathervane",
  "Wooden gate and stile": "Gate and stile",
  "Bat hanging": "Bat",
  "Red squirrel sitting,": "Red squirrel",
  "Wolf howling": "Howling wolf",
  "Toad on stone": "Toad",
  "Stag with antlers": "Stag",
  "Hollow tree stump": "Tree stump",
  "Hare in long grass": "Hare",
  "Swallow in flight": "Swallow",
  "Crow on fence": "Crow on a fence",
  "Robin with orange-red breast": "Robin redbreast",
  "Black swan with red beak swimming,": "Black swan",
  "Green frog sitting on stone,": "Frog on a stone",
  "Grey river stone with green moss on top": "Mossy stone",
  "Dragonfly over water": "Dragonfly over the water",
  "Green rubber wellington boot": "Wellington boot",
  "Willow tree by the river": "Willow",
  "Trout leaping": "Leaping trout",
  "Mallard duck with green head floating,": "Mallard drake",
  "River otter on its back": "Otter afloat",
  "Rubber ducks bobbing": "Rubber ducks",
  "Wooden duck house on post": "Duck house",
  "Navy blue sailor's cap": "Sailor's cap",
  "Pink flip-flop": "Flip-flop",
  "Pink scallop shell": "Pink scallop",
  "Orange ice lolly": "Ice lolly",
  "Message in bottle": "Message in a bottle",
  "Seaside lighthouse rock": "Lighthouse on the rocks",
  "Yellow tang fish": "Tang fish",
  "Ray gliding": "Stingray",
  "Grey shark": "Shark",
  "Pink conch shell": "Conch shell",
  "Starfish on rock": "Starfish on a rock",
  "Treasure chest on the sea bed": "Treasure chest",
  "Pink jelly on plate": "Jelly",
  "Pink iced bun with cherry on top": "Iced bun",
  "Pie with lattice crust": "Lattice pie",
  "Chocolate-chip cookie": "Cookie",
  "Scone with jam": "Scone and jam",
  "Tart with berries": "Berry tart",
  "Mixing bowl and whisk": "Mixing bowl",
  "Macarons stack": "Macarons",
  "Layer cake on stand": "Layer cake",
  "Red teapot": "Red teapot",
  "Boiled egg in cup": "Boiled egg",
  "Jar of red strawberry jam with yellow lid": "Strawberry jam",
  "Blue mug with white star": "Star mug",
  "Kettle on the stove": "Kettle",
  "Red sewing machine,": "Red sewing machine",
  "Red knitted mitten": "Red mitten",
  "Red button": "Button",
  "Ball of yarn with needles": "Ball of yarn",
  "Red knitted jumper laid flat": "Red jumper",
  "Red tomato-shaped pincushion": "Tomato pincushion",
  "Cardigan on chair": "Cardigan on a chair",
  "Socks on line": "Socks on the line",
  "Crochet granny square": "Granny square",
  "Weaving loom shuttle": "Loom shuttle",
  "Skein of red yarn": "Red skein",
  "Marigold petals in basket": "Marigold petals",
  "Wooden barrel full of blue dye": "Barrel of blue dye",
  "Red bucket of dye": "Bucket of red dye",
  "Onion skins in pot": "Onion skins",
  "Wooden dye paddle": "Dye paddle",
  "Stone bowl full of yellow powder": "Yellow pigment",
  "Stained apron on hook": "Stained apron",
  "Copper kettle steaming": "Copper kettle",
  "Green bottle of dye": "Bottle of green dye",
  "Skeins drying on pole": "Skeins drying",
  "Folded stack of three dyed cloths, red, yellow and blue": "Dyed cloths",
  "Blue glass bottle of ink with cork": "Ink bottle",
  "Jars of pigment on shelf": "Pigment shelf",
  "Tub of rinse water": "Rinse tub",
  "Golden church bell": "Church bell",
  "Wooden wishing well with red roof": "Wishing well",
  "Windowsill flower box": "Window box",
  "Wooden signpost": "Signpost",
  "Yellow lightning bolt": "Lightning bolt",
  "Snow-capped mountain peak": "Mountain peak",
  "Deep orange-yellow sun": "Summer sun",
  "Yellow raincoat hanging on peg": "Yellow raincoat",
  "Storm cloud with lightning": "Storm cloud",
  "Palm tree island": "Palm island",
  "Autumn hill and tree": "Autumn hill",
  "Green camper van": "Camper van",
  "Paper boat in puddle": "Paper boat",
  "Red toy truck": "Toy truck",
  "Hot air balloons over hills": "Balloons over the hills",
  "Yellow taxi car": "Taxi",
  "Red fire engine": "Fire engine",
  "Red post van": "Post van",
  "Blue suitcase": "Suitcase",
  "Rowing boat on lake": "Rowing boat on a lake",
  "Red drum with white rims,": "Toy drum",
  "Green toy dinosaur": "Toy dinosaur",
  "Yellow toy duck on wheels": "Pull-along duck",
  "Holly leaf with berries": "Holly sprig",
  "Red heart-shaped box of chocolates": "Box of chocolates",
  "Green Christmas tree with gold star": "Christmas tree",
  "Red Christmas cracker": "Christmas cracker",
  "Pink birthday cake with candles on top": "Birthday cake",
  "Candle in window": "Candle in the window",
  "Summer picnic basket": "Picnic basket",
  "Hen on her nest": "Hen on her nest",
};

const STOP = new Set(['a', 'an', 'the', 'with', 'of', 'on', 'in', 'and', 'by', 'at', 'its', 'to', 'over', 'from', 'showing']);
const taken = new Set(LEVEL_DEFS.filter((d) => !d.batch2).map((d) => d.id));
function makeId(name) {
  const w = name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x && !STOP.has(x));
  let id = w.join('').slice(0, 20) || 'painting';
  let k = 2;
  const base = id;
  while (taken.has(id)) id = base + k++;
  taken.add(id);
  return id;
}

// How busy a picture is: color regions at 27x36 (4-connected), plus colors.
function busy(rows) {
  const H = rows.length, W = rows[0].length, seen = new Uint8Array(W * H);
  let regions = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x]) continue;
    regions++;
    const c = rows[y][x], st = [[x, y]];
    seen[y * W + x] = 1;
    while (st.length) {
      const [px, py] = st.pop();
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || rows[ny][nx] !== c) continue;
        seen[ny * W + nx] = 1; st.push([nx, ny]);
      }
    }
  }
  return regions + 4 * new Set(rows.join('')).size;
}

const conv = { ...sheet.delivered.convert, crop: null };
const book = [];
for (const theme of Object.keys(sheet.themes)) {
  const items = sheet.items.filter((it) => it.theme === theme && it.status !== 'empty').map((it) => {
    const rows = importPNG(readFileSync(`${dir}/${it.file}`), { W: 27, H: 36, ...conv });
    return { n: it.n, file: it.file, subject: it.subject, busy: busy(rows) };
  }).sort((a, b) => a.busy - b.busy || a.n - b.n);
  const half = Math.ceil(items.length / 2);
  [items.slice(0, half), items.slice(half)].forEach((part, k) => {
    const [name, line] = NAMES[theme][k];
    book.push({
      id: `${theme}${k + 1}`, name, line, theme,
      items: part.map((it) => { const nm = title(it.subject); return { id: makeId(nm), n: it.n, file: it.file, name: nm, noun: nm.toLowerCase() }; }),
    });
  });
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const body = book.map((c) => `  { id: ${q(c.id)}, name: ${q(c.name)}, line: ${q(c.line)}, theme: ${q(c.theme)}, items: [\n${c.items.map((it) => `    { id: ${q(it.id)}, n: ${it.n}, file: ${q(it.file)}, name: ${q(it.name)}, noun: ${q(it.noun)} },`).join('\n')}\n  ] },`).join('\n');
writeFileSync(new URL('./book-batch2.js', import.meta.url), `// The batch 2 chapters (pure data), planned by plan-batch2.mjs from
// art-batch2.json: two chapters a theme, calmer pictures first. Ids are what a
// save refers to: never rename or reorder a shipped painting, only append.
// Edit names and nouns here by hand.

// A slot's picture size by its place in a chapter of n paintings: 18x24 up to 27x36.
const SIZES = [[18, 24], [21, 28], [24, 32], [27, 36]];
export function slotSize(i, n) {
  return SIZES[Math.min(3, Math.floor((i / Math.max(1, n - 1)) * 3.999))];
}

export const BOOK2 = [
${body}
];
`);
console.log(book.length, 'chapters,', book.reduce((s, c) => s + c.items.length, 0), 'paintings');
