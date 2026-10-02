// postcards.js — the postcard album (pure data).
// Implements docs/DESIGN.md "Hue Hunters and postcards › Postcards": one set of
// 8 cards per region plus one set per weekly event region. A card is a tiny
// papercut illustration (three flat colors drawn procedurally from `scene`),
// two lines in a hunter's voice, and a stamp. Card 8 of every set is the rare,
// gold-stamped one.
//
// Card: { id: '<region>-<n>' | '<event-id>-<n>', region, event?, n, title,
//         lines: [string, string], rare, scene: {sky, land, accent}, stamp }

/** Cards per set (one set per region or event). */
export const SET_SIZE = 8;

/** Stamp motifs the album knows how to draw. */
export const STAMPS = Object.freeze(['leaf', 'wave', 'mountain', 'sun', 'moon', 'star', 'flower', 'feather']);

/** Event id -> event region id (the event's set lives in that region). */
export const EVENT_REGIONS = Object.freeze({
  'autumn-harvest': 'orchard',
  'deep-sea': 'reef',
  'bloom-week': 'garden',
  'neon-night': 'night-market',
  'winter-frost': 'glacier-pass',
  'festival-of-lanterns': 'lantern-bridge',
  'golden-hour': 'hilltop',
  'ink-and-paper': 'scriptorium',
});

// Rows: [title, line 1, line 2, stamp, sky, land, accent]
const SETS = {
  meadow: [
    ['Morning Dew', 'Knelt in the clover at sunrise and came up soaked to the knees.', 'Worth it. The madder roots here run as red as a cut apple.', 'flower', '#f3d9b8', '#7fa05a', '#b8433a'],
    ['The Bee Field', 'A whole hillside humming. I walked very, very slowly.', 'Brought you a pocket of saffron threads. Careful with them.', 'leaf', '#cfe3ea', '#93ad5c', '#e8a63b'],
    ['Haystack Nap', 'Rested against a haystack and woke with a sparrow on my boot.', 'It left before I could ask about its color.', 'feather', '#dce8ee', '#c9b26a', '#8a6b4a'],
    ['Rain on Poppies', 'Short shower, long rainbow. The poppies did not mind at all.', 'I pressed one in the back of this card for you.', 'flower', '#b9c8d2', '#6f9150', '#d0473a'],
    ["Shepherd's Gate", 'The shepherd let me through if I promised to name a green after her dog.', 'His name is Biscuit. Over to you.', 'leaf', '#e6eef0', '#86a868', '#efebe0'],
    ['Wildflower Wall', 'Counted eleven kinds of yellow along one dry-stone wall.', 'Only had jars for four. Next time, more jars.', 'sun', '#f2e6c4', '#a0a46a', '#e3bd3a'],
    ['Evening Larks', 'The larks go up singing and come down quiet.', 'Heading home along the river path, the long way round.', 'feather', '#e8c2a8', '#5f7d4c', '#6e5a8a'],
    ['The Golden Meadow', 'Everything turned honey-colored for about four minutes tonight.', 'I did not paint it. I just stood there. Sorry, and also not sorry.', 'sun', '#f6c87a', '#c39a3c', '#fff1c9'],
  ],
  quarry: [
    ['First Cut', 'The quarry walls are striped like a layer cake: ochre, umber, ochre again.', 'I chipped you a sample from every stripe.', 'mountain', '#dfe6e8', '#b98b4e', '#6b4a2b'],
    ['Echo Pool', 'There is a green pool at the bottom where the old diggings flooded.', 'Shout your name and it comes back three times, politer each time.', 'wave', '#d7e0e2', '#8c8a80', '#4f8a78'],
    ['Lunch with the Masons', 'The masons shared their bread and argued about which grey is the best grey.', 'I said slate. Nobody agreed with me.', 'mountain', '#e4e2da', '#9a958b', '#5c6670'],
    ['Iron Seam', 'Found a seam of red earth that stains your hands for days.', 'My fingers look like I have been eating cherries.', 'leaf', '#ecdccb', '#a6643e', '#7a2f22'],
    ['Chalk Steps', 'Climbed the old chalk steps to the top ledge.', 'From up there the whole valley looks freshly washed.', 'mountain', '#cfe0ea', '#efebe0', '#7c9a5e'],
    ['Fossil Hunt', 'Split a stone and found a tiny shell inside, older than anything.', 'It is on the windowsill of the hut. Come and see it some day.', 'star', '#e9e4d6', '#b5a58a', '#d7c6a0'],
    ['Dusty Wagon', 'Rode back on the stone wagon, the slowest way home ever invented.', 'Excellent for thinking about umber.', 'sun', '#f0d9b0', '#9c7c55', '#5b4636'],
    ['The Glittering Wall', 'At noon the sun hit the north wall and the whole face sparkled.', 'Mica, says the foreman. Magic, say I.', 'star', '#c9dbe6', '#8d8e91', '#f5e7a8'],
  ],
  coast: [
    ['Harbor at Dawn', 'The boats go out before the gulls are awake.', 'The water is three blues at once. I tried to bottle all of them.', 'wave', '#f2d4c0', '#3e6a9e', '#efebe0'],
    ['Murex Cove', 'Waded into the cove for the purple snails. Colder than it looks.', 'My toes are the same color as the dye now.', 'wave', '#c8dce6', '#2f7c86', '#6e4a7e'],
    ['Lighthouse Steps', 'Two hundred and twelve steps up the lighthouse. I counted twice.', 'The keeper paints the rail white every spring, and asked after you.', 'star', '#bcd4e6', '#55708a', '#f4f1e8'],
    ['Tide Pools', 'The tide pools are like little paint pots someone left open.', 'Anemones in four pinks. One of them waved.', 'wave', '#d6e6ea', '#8a7d6e', '#e07f98'],
    ['Net Menders', 'Sat with the net menders on the quay. Their hands never stop.', 'They dye their twine with oak bark and swear by it.', 'feather', '#e2e8e4', '#7a5a3e', '#b07a3a'],
    ['Sea Glass Beach', 'The beach past the point is all pebbles and sea glass.', 'I filled a pocket with the green ones. Then the other pocket.', 'sun', '#d9ecee', '#cbbfa8', '#93cfb8'],
    ['Storm Watching', 'A storm rolled in from the west and turned the sea to slate.', 'Waited it out in a boathouse that smelled of tar and oranges.', 'moon', '#5c6a78', '#34495e', '#d8c83a'],
    ['Phosphor Night', 'After dark the waves glowed blue wherever the oars touched them.', 'Nobody on the quay could explain it, and nobody wanted to.', 'moon', '#1d2540', '#1f3a5a', '#7fe0e6'],
  ],
  jungle: [
    ['Under the Canopy', 'It is green on green on green in here, and the light comes down in coins.', 'I have stopped trying to count the greens.', 'leaf', '#bcd8a4', '#2f6b3a', '#e3d66a'],
    ['Parrot Morning', 'Woken by parrots arguing about breakfast.', 'One dropped a feather on my hat, which I am told is good luck.', 'feather', '#cfe6d0', '#3d7d45', '#d8452e'],
    ['Cactus Garden', 'The farmers brush cochineal off the prickly pears with a feather.', 'Gentle work, with a dazzling red at the end of it.', 'flower', '#f1dcc0', '#6f8d4e', '#c0233f'],
    ['River Crossing', 'Crossed the brown river on a raft of six logs and a prayer.', 'The ferryman hums the whole way across. It helps.', 'wave', '#d8e4d0', '#8a6a3e', '#3f7f6a'],
    ['Orchid Ledge', 'Found an orchid growing out of bare stone, purple and very proud.', 'I left it where it was and sketched it instead.', 'flower', '#d6e2cc', '#4b6e48', '#a65bb0'],
    ['Market Boat', 'Here the market comes to you: boats piled with fruit I cannot name.', 'Traded a jar of ochre for a sack of something sweet.', 'sun', '#f3e2b6', '#3b6e5a', '#e88a2e'],
    ['Rain Drums', 'Afternoon rain on the big leaves sounds like a hundred tiny drums.', 'I sat under it and did absolutely nothing for an hour.', 'leaf', '#9fb3a8', '#285a3c', '#7fae6a'],
    ['Firefly Clearing', 'At dusk the clearing filled up with fireflies, slow and gold.', 'I held still so long a frog sat on my boot.', 'star', '#1f3530', '#1d4a33', '#f2d25a'],
  ],
  volcano: [
    ['The Long Climb', 'The path up is black gravel that slides back half a step for every step.', 'My boots have opinions about this trip.', 'mountain', '#e6d2c0', '#3a3436', '#b8433a'],
    ['Sulfur Vents', 'The vents breathe out yellow crystals and a smell like old eggs.', 'The crystals are worth it. The smell is not.', 'sun', '#e9e2c8', '#5a5048', '#d8c83a'],
    ['Warm Stones', 'The ground is warm enough to dry socks on. I tested this.', 'Socks: dry. Dignity: also mostly dry.', 'mountain', '#f0dcc6', '#6a5a52', '#d97a3a'],
    ['Ash Field', 'A field of grey ash, soft as flour, with one stubborn flower in it.', 'I like that flower very much.', 'flower', '#d9d6d2', '#9a9690', '#c0233f'],
    ['Obsidian Ridge', "Found a ridge of black glass, sharp and shiny as a crow's eye.", 'Wrapped a piece in three handkerchiefs for you.', 'star', '#c8ccd6', '#1f1d26', '#6a7aa0'],
    ['Hot Spring', 'There is a hot spring halfway down where the miners soak their elbows.', 'I soaked mine too. Professional research.', 'wave', '#e2e6e0', '#6e6258', '#8fc7c0'],
    ['Night Glow', 'From camp you can see the crater glow orange against the stars.', 'Like a lantern someone forgot to put out.', 'moon', '#1c1a2a', '#2b2526', '#e8662a'],
    ['Lava Light', 'Watched a slow river of lava from a safe and sensible distance.', 'Brightest red I have ever seen. I owe you a jar of it, somehow.', 'sun', '#3a1f24', '#241d1f', '#f05425'],
  ],
  'autumn-harvest': [
    ['Apple Ladders', 'Every tree in the orchard has a ladder leaning on it this week.', 'I picked for an hour and ate about a third of it.', 'leaf', '#f0dcb8', '#8a7a3c', '#c0392b'],
    ['Cider Press', 'The cider press creaks like an old door and smells like heaven.', 'The run-off stains the cobbles a lovely amber.', 'sun', '#ead2a8', '#7a5634', '#cc9140'],
    ['Pear Shade', 'Lunch under the pear trees. The wasps were polite about it.', 'Mostly polite.', 'leaf', '#e6e2c0', '#7d8a44', '#b9bf5f'],
    ['Leaf Piles', 'The children rake the leaves into piles and then jump in them, every time.', 'I helped. With the jumping.', 'leaf', '#dcd2c0', '#a6643e', '#e47600'],
    ['Harvest Supper', 'Long tables in the barn, lanterns hung from the rafters.', 'Someone baked a pie the exact color of ochre. I asked for the recipe.', 'star', '#4a3428', '#7a4a2c', '#e3ae28'],
    ['Quince Jelly', 'Watched quince jelly turn from pale gold to rosy amber on the stove.', 'Brought a jar home. Do not let me eat it all.', 'flower', '#f2e2c8', '#9a6a4a', '#d0705a'],
    ['Frost on the Windfalls', 'First frost this morning, silver on the windfall apples.', 'The orchard dog was very excited about it.', 'moon', '#d6dee6', '#7a7050', '#b6322b'],
    ['Golden Orchard', 'In the last light every leaf in the orchard went gold at once.', 'It looked like the trees were lit from inside.', 'sun', '#f6c06a', '#a8742a', '#fff0c0'],
  ],
  'deep-sea': [
    ['Glass-Bottom Boat', 'Took the glass-bottom boat out over the reef.', 'Fish in every color you have ever named, and a few you have not.', 'wave', '#bfe2e6', '#1f6f7a', '#e1897e'],
    ['Pearl Divers', 'The pearl divers hold their breath longer than I can hold a thought.', 'One showed me a pearl the color of morning milk.', 'moon', '#d4e6ea', '#2b5c70', '#efebe0'],
    ['Coral Gardens', 'The coral grows in fans and antlers and little brains.', 'I am told not to touch. I am told this firmly.', 'flower', '#9fd2d6', '#2b8d71', '#e07a6a'],
    ['Kelp Forest', 'Swam through a kelp forest, tall and swaying like a slow crowd.', 'Green-gold light everywhere I looked.', 'leaf', '#7fb8a8', '#2a4a38', '#a8a03a'],
    ['Ink Cloud', 'A squid inked at me today. Rude, but a beautiful black.', 'I have decided to take it as a compliment.', 'wave', '#3a6a80', '#12253c', '#15151f'],
    ['Turtle Hour', 'A sea turtle swam beside the boat for a whole song.', 'The boatman sang every verse, so it was a long one.', 'feather', '#c4e6e2', '#31a5a5', '#5a7a3a'],
    ['Murex Shallows', 'The murex cove opened for the week and the shallows are full of purple.', 'Bringing back as much as the boat will float.', 'wave', '#d0dcea', '#2f6a8a', '#7e3c94'],
    ['The Deep Blue', 'Past the reef edge the water goes from teal to a blue with no bottom.', 'We rested the oars and just looked down for a while.', 'star', '#5aa0c0', '#0e2a4a', '#9fe0e6'],
  ],
  'bloom-week': [
    ['Gate in the Wall', 'Found a green door in an old wall, and behind it a garden.', 'The gardener says it has always been there. I believe her.', 'flower', '#e2ecda', '#5f8a4a', '#eb90b9'],
    ['Peony Bed', 'The peonies are as big as cabbages and pinker than anything.', 'Bees go in and come out looking dazed.', 'flower', '#f2e0e6', '#65a64d', '#d0557f'],
    ['Sweet Pea Trellis', 'Sweet peas climbing a trellis, every color a different whisper.', 'I sniffed every single one. For science.', 'flower', '#eef0e6', '#7aa65a', '#c1a3d8'],
    ['Lilac Walk', 'Walked the lilac path twice because once was not enough.', 'My coat smells of lilac now. No complaints.', 'leaf', '#e6e2f0', '#6a8a5a', '#947fc1'],
    ['Seedling Trays', 'The glasshouse is full of seedling trays, each a brand-new green.', "Labelled in the gardener's tiny, careful writing.", 'leaf', '#e8f0e0', '#8a6a4a', '#b7d978'],
    ['Tulip Rows', 'Tulips in rows like a paintbox someone tipped over very neatly.', 'Red, then cream, then a red so dark it is almost plum.', 'flower', '#dde8ee', '#3f713a', '#cf4047'],
    ['Watering Can', 'Helped water the beds at dusk. The soil smells like rain on stone.', 'The gardener gave me cuttings to bring home.', 'feather', '#d6c8d8', '#4a6a3a', '#656cba'],
    ['Blossom Storm', 'A gust shook the cherry trees and it snowed pink petals.', 'I stood in it with my mouth open like a child.', 'flower', '#f6dce6', '#8aa66a', '#f9dbe6'],
  ],
  'neon-night': [
    ['Lantern Stalls', 'The night market opens at sundown and stays open until the birds start.', 'Every stall has a lamp of a different color.', 'star', '#191731', '#2b2546', '#f92da2'],
    ['Glow Paint', 'One stall sells paint that glows after dark. I bought a thimble of it.', 'It is glowing in my pocket as I write this.', 'moon', '#1c1a36', '#3a2f5a', '#b0f42f'],
    ['Noodle Steam', 'Ate noodles at a counter while steam rolled past the pink signs.', 'Best dinner of the year, and it cost two coins.', 'sun', '#2a2140', '#4a3a5a', '#fe7802'],
    ["Juggler's Rings", 'A juggler tossed glowing rings, lime and magenta, higher than the roofs.', 'Never dropped a single one.', 'star', '#141228', '#2e2a48', '#d00aca'],
    ['Fortune Teller', 'The fortune teller said I would find a color nobody has named.', 'I am choosing to believe her.', 'moon', '#231a3a', '#3b2a50', '#2eeded'],
    ['Dancing Lights', 'Someone strung lights between the rooftops and the whole street danced.', 'I danced too. Badly, and happily.', 'star', '#1a1830', '#33284a', '#fdf720'],
    ['Midnight Tea', 'Tea at midnight from a kettle shaped like a fish.', 'The tea was electric blue. I did not ask.', 'moon', '#161a30', '#2a3050', '#1874ed'],
    ['The Neon Bridge', 'From the bridge the whole market glows like a spilled paintbox.', 'I stayed until the very last lamp went out.', 'star', '#0f0e22', '#241f3e', '#39e252'],
  ],
  'winter-frost': [
    ['Snowshoes', 'Learned to walk in snowshoes. Mostly learned to fall in them.', 'The snow is softer than it looks, luckily.', 'mountain', '#d3e8f7', '#f7f5ef', '#50799b'],
    ['Ice Cave', 'Inside the glacier there is a cave lit blue all the way through.', 'Like standing inside a bottle of woad.', 'moon', '#81cae1', '#3d6473', '#d3e8f7'],
    ['Frost Ferns', 'Frost grew ferns all over the hut window overnight.', 'I traced one with my finger and it melted. Sorry.', 'leaf', '#c6dcea', '#9da8be', '#f7f5ef'],
    ['Silver Pines', 'The pines up here wear silver every morning.', 'Even my eyebrows were frosted by breakfast.', 'mountain', '#e2ecf2', '#3d5a52', '#bbbec1'],
    ['Mountain Hut', 'The hut keeper makes soup thick enough to stand a spoon in.', 'We played cards by candlelight until the wind got bored.', 'star', '#2c3d5d', '#5a4a3e', '#f8c970'],
    ['Sledge Run', 'Rode a sledge down the old supply track. Faster than wise.', 'Laughed the whole way down, so worth it.', 'mountain', '#bfe0f0', '#f2f4f6', '#a92227'],
    ['Starry Pass', 'There are so many stars over the pass it looks like frost on the sky.', 'Cold nose, warm heart.', 'star', '#1b2a48', '#81878d', '#f7f5ef'],
    ['The Aurora', 'Green and violet ribbons over the glacier tonight, slow as breathing.', 'Everyone came out of the hut in their blankets to watch.', 'moon', '#14203a', '#2c3d5d', '#53bcac'],
  ],
  'festival-of-lanterns': [
    ['Paper and Glue', 'Spent the afternoon folding paper lanterns with the bridge keepers.', 'Mine is lopsided. They hung it anyway.', 'feather', '#f5e7c3', '#9a6a4a', '#f3821d'],
    ['First Light', 'At dusk they lit the first lantern, then the next, then all of them.', 'The river carried the reflections down to the sea.', 'sun', '#3a2a3a', '#2a3a4a', '#fba62a'],
    ['Sugar Stalls', 'Candied fruit on sticks, red as lacquer and twice as shiny.', 'My teeth are worried about this festival.', 'star', '#f2d8c0', '#6b1e1c', '#d33c33'],
    ['Drum Boats', 'Boats with great drums rowed under the bridge, beat by beat.', 'You feel it in your ribs more than in your ears.', 'wave', '#2a2638', '#3a4a5a', '#eb5200'],
    ['Wish Ribbons', 'Everyone ties a ribbon to the bridge rail with a wish written on it.', 'I wished for more jars. Very practical of me.', 'feather', '#f0e0d0', '#8a5a3a', '#e7768a'],
    ['Ember Sparks', 'The fire twirlers sent up sparks that hung in the air like orange stars.', 'A little girl beside me clapped for every one.', 'star', '#1e1626', '#3a1e0e', '#f3821d'],
    ['Lantern Float', 'We set lanterns on the river and watched them drift out of sight.', 'A whole river of warm orange light.', 'wave', '#2a2a40', '#1e3048', '#f8c970'],
    ['The Thousand Lanterns', 'On the last night they released a thousand lanterns into the sky.', 'Nobody spoke. Not one person. It was perfect.', 'moon', '#1a1830', '#2a2236', '#fba62a'],
  ],
  'golden-hour': [
    ['Up the Hill', 'Climbed the hill path in the late afternoon, as the locals suggested.', 'The grass up here is long and gold and full of crickets.', 'mountain', '#f4bd99', '#cd8817', '#725b9a'],
    ['Picnic Rock', 'A picnic on the flat rock at the top: bread, cheese and peaches.', 'The peaches were the exact color of the sky.', 'sun', '#f6c6a0', '#a8843a', '#e3975a'],
    ['Long Shadows', 'My shadow was ten feet tall and very pleased with itself.', 'So was I, honestly.', 'sun', '#f1d680', '#9a7a3a', '#423b65'],
    ['Honey Seller', 'A beekeeper on the hill sells honey in jars that glow like lamps.', 'I bought two. One of them is for you.', 'flower', '#f2d0a0', '#b08a3a', '#eab444'],
    ['Windmill', 'The old windmill turns slow and creaky against a pink sky.', 'The miller waved from the top window.', 'feather', '#e8a8a0', '#8a7040', '#efebe0'],
    ['Dusk Violets', 'Violets grow on the shady side of the hill, small and deep.', 'The dusk turns them almost blue.', 'flower', '#ae9ece', '#5a6a3a', '#725b9a'],
    ['First Star', 'Watched the first star come out over the valley.', 'Made a wish. Not telling.', 'star', '#42558a', '#3a3a4a', '#f1d680'],
    ['Sunset from the Summit', 'The whole sky went peach, then rose, then violet, then gone.', 'I did not paint it. I just remembered it for you.', 'sun', '#d66643', '#423b65', '#f4bd99'],
  ],
  'ink-and-paper': [
    ['Quiet Hall', 'The scriptorium is so quiet you can hear quills on vellum.', 'I whispered the whole visit, even to myself.', 'feather', '#e2cead', '#6a4b2f', '#171614'],
    ['Oak Galls', 'The scribes make ink from oak galls and iron, brewed for weeks.', 'It goes on brown and dries a deep black.', 'leaf', '#f1ebd9', '#7a6548', '#222f3c'],
    ['Rubric Red', 'Each chapter starts with a red letter, painted by a monk with a steady hand.', 'He let me hold the brush. Briefly.', 'feather', '#f1ebd9', '#533525', '#a8372e'],
    ['Gold Leaf', 'Watched gold leaf laid on a capital letter with a single breath.', 'Too thin to hold. Somehow they hold it.', 'star', '#e2cead', '#3a2a20', '#d8b040'],
    ['Vellum Stacks', 'Stacks of creamy vellum waiting for words.', 'It smells like a library nobody has invented yet.', 'moon', '#f1ebd9', '#9b9893', '#e2cead'],
    ['Indigo Margin', 'Found a book with tiny indigo birds painted in every margin.', 'Someone was very happy when they made it.', 'feather', '#f1ebd9', '#6a7586', '#243163'],
    ['Sand and Seal', 'The scribes blot with fine sand and seal their letters with green wax.', 'I have sent you this card with a proper seal.', 'leaf', '#e8dcc4', '#7a6548', '#3f713a'],
    ['The Illuminated Page', 'They showed me the oldest page in the library, still bright after centuries.', 'Blues and golds that refuse to fade. I want that for us.', 'sun', '#f1ebd9', '#243163', '#d8b040'],
  ],
};

const REGION_ORDER = ['meadow', 'quarry', 'coast', 'jungle', 'volcano'];

function build() {
  const cards = [];
  for (const key of [...REGION_ORDER, ...Object.keys(EVENT_REGIONS)]) {
    const isEvent = key in EVENT_REGIONS;
    SETS[key].forEach(([title, l1, l2, stamp, sky, land, accent], i) => {
      const n = i + 1;
      const card = { id: `${key}-${n}`, region: isEvent ? EVENT_REGIONS[key] : key };
      if (isEvent) card.event = key;
      Object.assign(card, {
        n, title, lines: Object.freeze([l1, l2]), rare: n === SET_SIZE,
        scene: Object.freeze({ sky, land, accent }), stamp,
      });
      cards.push(Object.freeze(card));
    });
  }
  return Object.freeze(cards);
}

/** All postcards: 40 region cards then 64 event cards. */
export const POSTCARDS = build();

const BY_ID = new Map(POSTCARDS.map((c) => [c.id, c]));

/** Postcard by id, or undefined. */
export function getPostcard(id) {
  return BY_ID.get(id);
}

/** The cards of one region's set (event regions included), in order. */
export function cardsForRegion(regionId) {
  return POSTCARDS.filter((c) => c.region === regionId);
}

/** The cards of one event's set, in order. */
export function cardsForEvent(eventId) {
  return POSTCARDS.filter((c) => c.event === eventId);
}
