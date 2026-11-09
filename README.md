# Lifting Table art, batch 2 (source images only)

Painted sources for proto/lift/art-batch2.json, one per item, 384x512 8-bit non-interlaced RGB PNG, named by the sheet's `file`.
Never merged into main.

Made with Krea 2 Turbo (8 steps, 768x1024, downscaled with Lanczos). Prompt = the sheet's prompt + " Chunky, thick, rounded forms with no thin lines,
no spindly parts and no small scattered pieces; bright, saturated, natural colors on a light background. The whole subject fits inside the middle
two-thirds of the picture with a margin of background on every side, nothing cut off at the edges; about eight to ten colors in total."
Negative = the sheet's negative. Two seeds per item (7301, 7302); the one whose 27x36 grid (Python port of import-art.mjs, ZOOM crop, chroma 2)
had fewer regions and less of the subject cut off was kept.

## Full batch (393 of 400)

Prompt for every item (after Tincture's pilot review): the sheet's prompt with the "soft color bands" background replaced by "a plain flat {color}
background with at most one simple ground band in a slightly darker shade of {color}, no specks, no texture, no scattered bits", color by n % 4
(pale sky blue, pale mint green, pale pink, pale lemon yellow), plus "the subject is mostly made of two to four big solid color areas". Thin
subjects get a close-up of their chunkiest part. Seeds 7401 and 7402, auto-picked on the 27x36 grid with crop null, chroma 2, colors 10, min 3.

Review round 2: every pale background converts to cream, so white or pale-yellow subjects vanished. These use "soft medium sky blue" instead and
were picked by eye from seeds 7401-7404: 2, 23, 26, 42, 47, 86, 93, 135, 144, 146, 152, 153, 159, 163, 186, 205, 351. These came out as the wrong
thing and were reworded, then picked by eye: 70 (earthworm, on mint), 189 (pier), 193 (sun hat), 206 (stingray), 214 (nautilus), 220 (treasure
chest), 271 (cardigan), 293 (swatch fan), 294 (dipped hanks), 308 (tea shop), 309 (bookshop), 315 (greenhouse), 318 (cobbled lane), 327 (sunset).

Skipped, still reading as lines or as the wrong thing: 49 lily of the valley, 69 spider web with dew, 75 cricket on a stem, 76 damselfly on a reed,
104 pitchfork in hay, 276 bobbin lace, 396 fireworks.

## Round 3 (all 400)

Background snap on every file (scripts' bgsnap.py, post-process only): median of the outer 2 px border (top + sides, top 70%) snapped to the
nearest of #c3d4df #eee4c8 #e5b6ab #e7c691 #ddcca6 #aab78f #8babc5, flood from the border through pixels within Delta E 12 (OKLab x100) of that
median, set to the exact hex. Ground band: median of the bottom-10% side edge pixels, snapped to the 26-color list and flooded the same way, only
when it is more than Delta E 12 from the background and at least 70% of those edge pixels agree (so a subject touching the bottom isn't taken
for a band). The subject is untouched.

Redos used the round-3 recipe (one object, side or front view, simplest silhouette, body mostly one color with one or two accents, no pattern,
perfectly flat background), seeds 7405/7406, picked by eye after the snap. Items that still muddled were swapped (seeds 7407/7408, without the
"two to four color areas" line, which caused patchwork). Kept their earlier pick: 205, 234, 336, 372, 373, 388, 394.

Swapped subjects (same n and filename):
- 19: rhubarb stalks -> a big orange carrot with green leaves
- 38: pea flower and tendril -> a green pea pod split open showing round peas
- 44: foxgloves -> a single red tulip
- 49: lily of the valley -> a big yellow sunflower head
- 55: sweet peas -> a big pink peony
- 69: spider web with dew -> a red and black shield bug seen from above
- 72: ant carrying a leaf -> a yellow and black striped wasp seen from above
- 75: cricket on a stem -> an orange moth with two big round eye spots on its wings
- 76: damselfly on a reed -> a yellow brimstone butterfly with its wings folded, seen from the side
- 87: horse grazing -> a chestnut-brown horse standing, seen from the side
- 104: pitchfork in hay -> a red wheelbarrow
- 116: straw hat on a post -> a big round golden haystack
- 136: porcupine -> a red squirrel sitting, seen from the side
- 154: goldfinch -> a robin with an orange-red breast
- 165: tadpoles -> a fat orange goldfish seen from the side
- 166: water vole -> a black swan with a red beak swimming, seen from the side
- 167: stepping stones -> a green frog sitting on a stone, seen from the front
- 171: pond skater -> a mallard duck with a green head floating, seen from the side
- 175: mill wheel -> a bright red canoe seen from the side
- 176: canal lock gates -> a big round grey river stone with green moss on top
- 177: punt on the river -> a green rubber wellington boot
- 179: frog spawn -> an orange and white koi carp seen from the side
- 194: pebbles -> a pink scallop shell
- 195: driftwood -> a red crab seen from the front
- 199: sailor's knot rope -> a navy blue sailor's cap
- 208: narwhal -> a grey shark seen from the side
- 214: nautilus shell -> a big yellow submarine
- 223: doughnut -> a pink iced bun with a cherry on top
- 232: rolling pin and dough -> a pink jelly on a plate
- 245: salt and pepper shakers -> a big round red teapot
- 249: wooden spoons in a jar -> a jar of red strawberry jam with a yellow lid
- 265: woolly scarf -> a red knitted jumper laid flat
- 276: bobbin lace -> a red tomato-shaped pincushion
- 279: pom-pom -> a red sewing machine, seen from the side
- 280: mitten with a snowflake -> a single red knitted mitten
- 286: dye garden bed -> a big wooden barrel full of bright blue dye
- 288: pestle of crushed pigment -> a stone bowl full of bright yellow powder
- 293: color swatch card -> a blue glass bottle of ink with a cork
- 295: rack of colored yarn -> a big skein of red yarn
- 300: clothes pegs and dyed cloth -> a folded stack of three dyed cloths, red, yellow and blue
- 315: greenhouse -> a red post box
- 316: corner shop awning -> a wooden wishing well with a red roof
- 330: waterfall -> a big red umbrella
- 334: sun behind clouds -> a bright yellow sun
- 335: tornado on the plain -> a yellow raincoat hanging on a peg
- 340: lavender field -> a single snow-capped mountain peak
- 349: biplane -> a red fire engine seen from the side
- 359: airship -> a yellow taxi car seen from the side
- 369: toy drum -> a red drum with white rims, seen from the side
- 390: spring lamb in flowers -> a red heart-shaped box of chocolates
- 391: maypole -> a green Christmas tree with a gold star
- 392: birthday cake -> a pink birthday cake with candles on top
- 396: fireworks -> a red Christmas cracker

## Round 4 (final)

Swapped (seeds 7409/7410, one solid body color plus one or two accents, background snapped as before):
65 purple butterfly; 67 straw beehive skep; 77 leaf with a bite out of it; 78 wooden bug hotel; 97 ginger cat curled up; 99 black sheep;
109 blue watering can; 121 hedgehog; 125 acorn; 137 hollow tree stump; 141 yellow canary; 158 grey pigeon; 179 wooden duck house on a post;
182 pink flip-flop; 190 orange ice lolly; 204 yellow tang fish; 217 whale tail; 219 pink conch shell; 226 chocolate-chip cookie; 239 loaf of bread;
259 blue mug with a white star; 274 big red button; 289 red bucket of dye; 294 green bottle of dye; 303 golden church bell; 336 yellow lightning bolt;
341 green camper van; 345 blue suitcase; 372 yellow toy duck on wheels; 380 green toy dinosaur; 394 holly leaf with berries.
Redrawn fully inside the frame: 175 red canoe, 359 yellow taxi. 334: deep orange-yellow sun, background forced to Pale Sky #c3d4df.
Skipped (slots left empty, files removed): 89 (cow face), 130 (pine cone), 189 (striped beach umbrella), 234 (lemon cake slice).
