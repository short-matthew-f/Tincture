// commissions.js — spec: DESIGN.md "Progression, eras and prestige" > "Commissions"
// (multi-step projects asking for colors in quantity, sometimes at minimum purity or
// with a wild hue; big Coin payout, signature catalog color, workshop trophy; two to
// three open at once; they never expire) and "Era Advance" (capstone needs ~80% of
// the era's catalog).
//
// A step asks for `jars` of ONE of:
//   family:   a hue family (see routes.js FAMILIES); any color of that family counts
//   families: several families, any of them counts (e.g. "brights")
//   pigment:  a pigment id; its same-named catalog color
//   colorId:  an exact catalog id (wild:true when it is a found-only wild hue)
// Optional per step:
//   distinct: at least this many different colors must make up the jars (default 1)
//   purity:   'pure' = at least pure-grade jars
//   tier:     deliver a merged container of this shelf tier (4 = "an Urn of ...")
//   wild:     true when the color is a wild hue (cannot be mixed)
//   bulk:     true when quantity matters more than variety
// reward.incomeMinutes: Coins paid as minutes of current idle income (sim multiplies).
// reward.signatureColor: catalog id found by 'commission' (the catalog module owns
//   these ids), or null.
// colorsRequired: catalog size before it appears in the offer pool.
// era: 1..3. Era 2/3 entries are stubs (comingSoon, no steps) for the era capstone link.

const step = (o) => Object.freeze({ distinct: 1, ...o });
const C = (o) => Object.freeze({
  era: 1, phase: 3, capstone: false, colorsRequired: 0, comingSoon: false, ...o,
  steps: Object.freeze((o.steps ?? []).map(step)),
  reward: Object.freeze(o.reward),
});


export const COMMISSIONS = Object.freeze([
  C({ id: 'harbor-lighthouse', name: 'Harbor Lighthouse Mural', phase: 3, colorsRequired: 30,
    blurb: 'The harbor master wants the lighthouse painted in every blue the sea can make.',
    steps: [
      { family: 'blue', jars: 50, distinct: 5 },
      { family: 'neutral', jars: 20, distinct: 2 },
      { colorId: 'harbor-teal', jars: 10, wild: true },
    ],
    reward: { incomeMinutes: 90, signatureColor: 'lighthouse-white', trophy: 'lighthouse-model' } }),
  C({ id: 'cathedral-window', name: 'Cathedral Window', phase: 3, colorsRequired: 34,
    blurb: 'Eight jewel tones, each pure enough to glow when the sun comes through.',
    steps: ['red', 'blue', 'green', 'violet', 'teal', 'yellow', 'orange', 'pink'].map((family) => ({ family, jars: 12, purity: 'pure' })),
    reward: { incomeMinutes: 150, signatureColor: 'stained-glass-ruby', trophy: 'stained-glass-panel' } }),
  C({ id: 'festival-banners', name: 'Festival Banners', phase: 3, colorsRequired: 32,
    blurb: 'Ten bright colors, by the cartload. The whole town is hanging bunting.',
    steps: [{ families: ['red', 'orange', 'yellow', 'pink'], jars: 200, distinct: 10, bulk: true }],
    reward: { incomeMinutes: 60, signatureColor: 'bunting-red', trophy: 'bunting-garland' } }),
  C({ id: 'ocean-mural', name: 'The Ocean Commission', phase: 3, colorsRequired: 36,
    blurb: 'A long wall of water: teals, blues and a little sea glass.',
    steps: [
      { family: 'teal', jars: 40, distinct: 3 },
      { family: 'blue', jars: 40, distinct: 3 },
      { colorId: 'sea-glass', jars: 8, wild: true },
    ],
    reward: { incomeMinutes: 110, signatureColor: 'deep-fathom', trophy: 'ship-in-a-bottle' } }),
  C({ id: 'gilded-urns', name: 'Gilded Urns', phase: 3, colorsRequired: 38,
    blurb: 'The abbey wants three urns of rich pigment for the new illuminated psalter.',
    steps: [
      { colorId: 'ochre', jars: 1, tier: 4 },
      { colorId: 'madder', jars: 1, tier: 4 },
      { family: 'blue', jars: 1, tier: 4 },
    ],
    reward: { incomeMinutes: 100, signatureColor: 'illuminated-gold', trophy: 'gilded-urn' } }),
  C({ id: 'royal-robes', name: 'Royal Robes', phase: 3, colorsRequired: 42,
    blurb: 'Violets and deep reds, pure and plenty, for a coronation.',
    steps: [
      { family: 'violet', jars: 30, purity: 'pure', distinct: 2 },
      { family: 'red', jars: 30, purity: 'pure', distinct: 2 },
      { colorId: 'murex-purple', jars: 6, wild: true },
    ],
    reward: { incomeMinutes: 140, signatureColor: 'coronation-purple', trophy: 'robe-stand' } }),
  C({ id: 'weavers-tapestry', name: "Weavers' Great Tapestry", phase: 3, colorsRequired: 40,
    blurb: 'Weavers\' Row wants a little of everything. A lot of everything.',
    steps: [{ families: ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'], jars: 300, distinct: 12, bulk: true }],
    reward: { incomeMinutes: 80, signatureColor: 'loom-thread', trophy: 'little-loom' } }),
  C({ id: 'potters-glaze', name: "The Potter's Glazes", phase: 3, colorsRequired: 44,
    blurb: 'Earthy glazes for a whole kiln: umber, rust and warm neutrals.',
    steps: [
      { pigment: 'umber', jars: 30 },
      { family: 'orange', jars: 30, distinct: 2 },
      { family: 'neutral', jars: 30, distinct: 3 },
    ],
    reward: { incomeMinutes: 90, signatureColor: 'kiln-glaze', trophy: 'glazed-pot' } }),
  C({ id: 'meadow-quilt', name: 'The Meadow Quilt', phase: 3, colorsRequired: 46,
    blurb: 'Greens, soft yellows and clover pinks, stitched into a quilt for spring.',
    steps: [
      { family: 'green', jars: 40, distinct: 4 },
      { family: 'yellow', jars: 30, distinct: 2 },
      { colorId: 'clover-pink', jars: 8, wild: true },
    ],
    reward: { incomeMinutes: 100, signatureColor: 'quilt-patchwork', trophy: 'patchwork-pillow' } }),
  C({ id: 'cartographers-atlas', name: "Cartographer's Atlas", phase: 3, colorsRequired: 50,
    blurb: 'Inks, sepias and old gold for the first map of every place you have visited.',
    steps: [
      { family: 'neutral', jars: 40, distinct: 4, purity: 'pure' },
      { family: 'yellow', jars: 20, distinct: 2 },
      { colorId: 'obsidian', jars: 6, wild: true },
    ],
    reward: { incomeMinutes: 130, signatureColor: 'atlas-ink', trophy: 'brass-compass' } }),
  C({ id: 'the-grand-catalogue', name: 'The Grand Catalogue', phase: 3, capstone: true, colorsRequired: 80,
    blurb: 'Every family of color, pure and plentiful: the book that proves your workshop knows the world.',
    steps: ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'].map((family) => ({ family, jars: 40, distinct: 4, purity: 'pure' })),
    reward: { incomeMinutes: 600, signatureColor: 'grand-spectrum', trophy: 'grand-catalogue-book' } }),
  // Later-era capstone stubs so ERAS[n].capstoneCommission always resolves.
  C({ id: 'the-synthetic-spectrum', name: 'The Synthetic Spectrum', era: 2, capstone: true, comingSoon: true, colorsRequired: 64,
    blurb: 'Coming in a later update.', steps: [], reward: { incomeMinutes: 0, signatureColor: null, trophy: 'synthetic-spectrum' } }),
  C({ id: 'the-light-garden', name: 'The Light Garden', era: 3, capstone: true, comingSoon: true, colorsRequired: 48,
    blurb: 'Coming in a later update.', steps: [], reward: { incomeMinutes: 0, signatureColor: null, trophy: 'light-garden' } }),
]);

export const COMMISSIONS_BY_ID = Object.freeze(Object.fromEntries(COMMISSIONS.map((c) => [c.id, c])));
export const byId = COMMISSIONS_BY_ID;

/** How many commissions are open at once (spec: two to three; they never expire). */
export const OPEN_COMMISSIONS = Object.freeze({ min: 2, max: 3 });

export function getCommission(id) {
  return COMMISSIONS_BY_ID[id] ?? null;
}

export function commissionsForEra(era) {
  return COMMISSIONS.filter((c) => c.era === era);
}

/** Era 1 non-capstone commissions that are offerable in `phase` with `colors` discovered. */
export function availableCommissions({ era = 1, phase = 3, colors = 0 } = {}) {
  return COMMISSIONS.filter((c) => c.era === era && !c.capstone && !c.comingSoon && c.phase <= phase && colors >= c.colorsRequired);
}
