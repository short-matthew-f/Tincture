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
