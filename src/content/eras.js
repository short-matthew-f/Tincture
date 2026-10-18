// eras.js — spec: DESIGN.md "Progression, eras and prestige" > "Era Advance (major
// prestige)" (mixing rule and mood per era) and "Economy" > "Color value"
// (Era 2 and 3 prices scale x1,000 and x1,000,000).
//
// Only Era 1 is playable in this build; Eras 2 and 3 are data-driven extension
// points. colorCount is the size of the era's catalog; the capstone commission
// needs ~80% of it (see commissions.js).
// pages: catalog page ids for the era (Era 1 matches catalog.js `page`).

export const CAPSTONE_CATALOG_SHARE = 0.8;

export const ERAS = Object.freeze([
  { id: 1, name: 'Natural Dyes', mixing: 'subtractive-muted', priceScale: 1, mood: 'Cozy artisan workshop',
    pages: Object.freeze(['wheel', 'tints', 'shades', 'earths', 'wild']), colorCount: 100, playable: true,
    capstoneCommission: 'the-grand-catalogue', vehicles: Object.freeze(['handcart', 'wagon', 'river-barge']) },
  { id: 2, name: 'Synthetics', mixing: 'subtractive-vivid', priceScale: 1e3, mood: 'Bustling industrial studio',
    pages: Object.freeze(['primaries', 'pastels', 'brights', 'metals', 'wild']), colorCount: 80, playable: false,
    capstoneCommission: 'the-synthetic-spectrum', vehicles: Object.freeze(['delivery-truck', 'steam-train']) },
  { id: 3, name: 'Light', mixing: 'additive', priceScale: 1e6, mood: 'Glowing, whimsical lab',
    pages: Object.freeze(['glow', 'prisms', 'auroras', 'dreams']), colorCount: 60, playable: false,
    capstoneCommission: 'the-light-garden', vehicles: Object.freeze(['airship', 'pneumatic-tube', 'beam-relay']) },
].map((e) => Object.freeze(e)));

export const ERAS_BY_ID = Object.freeze(Object.fromEntries(ERAS.map((e) => [e.id, e])));
export const byId = ERAS_BY_ID;

export function getEra(id) {
  return ERAS_BY_ID[id] ?? null;
}

/** Colors needed in the catalog to attempt the era capstone (~80%). */
export function capstoneColorsRequired(eraId) {
  const e = ERAS_BY_ID[eraId];
  return e ? Math.ceil(e.colorCount * CAPSTONE_CATALOG_SHARE) : 0;
}

/**
 * A sneak peek at Era 2 (Neon Night's twist, rules.previewEra = 2): a few
 * Synthetics shown on the event page and borrowed by that week's grading
 * boards. They are previews only: Era 2 is not playable yet, so they are never
 * discovered and never enter the catalog (the page shows "coming in a later
 * update").
 */
export const ERA_PREVIEW_COLORS = Object.freeze([
  { id: 'era2-mauveine', name: 'Mauveine', hex: '#8E3FA8', era: 2, page: 'brights', note: 'The very first synthetic dye.' },
  { id: 'era2-prussian-blue', name: 'Prussian Blue', hex: '#24467E', era: 2, page: 'primaries', note: 'A deep, inky blue from the chemist\'s bench.' },
  { id: 'era2-chrome-yellow', name: 'Chrome Yellow', hex: '#F4B71A', era: 2, page: 'brights', note: 'A sunny yellow that never fades in the shop window.' },
  { id: 'era2-viridian', name: 'Viridian', hex: '#2B8C70', era: 2, page: 'pastels', note: 'A cool, clear green.' },
].map((c) => Object.freeze(c)));

/** Preview colors for an era (empty when there are none). */
export function eraPreviewColors(eraId) {
  return ERA_PREVIEW_COLORS.filter((c) => c.era === eraId);
}
