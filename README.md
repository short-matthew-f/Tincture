# Lifting Table art, batch 2 (source images only)

Painted sources for proto/lift/art-batch2.json, one per item, 384x512 8-bit non-interlaced RGB PNG, named by the sheet's `file`.
Never merged into main.

Made with Krea 2 Turbo (8 steps, 768x1024, downscaled with Lanczos). Prompt = the sheet's prompt + " Chunky, thick, rounded forms with no thin lines,
no spindly parts and no small scattered pieces; bright, saturated, natural colors on a light background. The whole subject fits inside the middle
two-thirds of the picture with a margin of background on every side, nothing cut off at the edges; about eight to ten colors in total."
Negative = the sheet's negative. Two seeds per item (7301, 7302); the one whose 27x36 grid (Python port of import-art.mjs, ZOOM crop, chroma 2)
had fewer regions and less of the subject cut off was kept.
