// routes.js — spec: DESIGN.md "Storage and shipping" > "Shipping: fleet and routes"
// (routes want a palette and pay a premium; demand drifts every few days; some
// special markets are discovered by hunters) and "Economy" > "Color value"
// (route demand adds +20% to +60%).
//
// palette: hue FAMILIES (see FAMILIES). Weavers' Row accepts any family and is
// flagged any:true / bulk:true (its palette lists every family so palette
// matching needs no special case).
// premium: price multiplier delta for on-palette jars (0.4 = +40%; -0.3 = -30%).
// unlock: {type:'phase', phase} | {type:'colors', n} | {type:'discovered'}
// discoveredBy: region id whose expeditions can discover a 'discovered' market.

export const FAMILIES = Object.freeze(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral']);

/** Daily demand bonus range for a route's currently favored color (spec: +20% to +60%). */
export const DEMAND_BONUS = Object.freeze({ min: 0.2, max: 0.6 });

/** A route's favorite color shifts every few days. */
export const DEMAND_DRIFT_DAYS = 3;

const route = (o) => Object.freeze({
  bulk: false, any: false, unlimited: false, wantsPurity: false, discoveredBy: null,
  demandDriftDays: DEMAND_DRIFT_DAYS, ...o,
});

export const ROUTES = Object.freeze([
  route({ id: 'harbor-town', name: 'Harbor Town', palette: Object.freeze(['blue', 'teal']), premium: 0.4,
    unlock: Object.freeze({ type: 'phase', phase: 2 }), blurb: 'Sailors and sailmakers who adore every blue.' }),
  route({ id: 'weavers-row', name: "Weavers' Row", palette: FAMILIES, premium: -0.3, any: true, bulk: true, unlimited: true,
    unlock: Object.freeze({ type: 'phase', phase: 2 }), blurb: 'Takes anything, in any amount, at a friendly price.' }),
  route({ id: 'festival-city', name: 'Festival City', palette: Object.freeze(['red', 'orange', 'yellow', 'pink']), premium: 0.35,
    unlock: Object.freeze({ type: 'colors', n: 25 }), blurb: 'Banners and bunting: bright, bright, brighter.' }),
  route({ id: 'abbey', name: 'The Abbey', palette: Object.freeze(['yellow', 'red']), premium: 0.5, wantsPurity: true,
    unlock: Object.freeze({ type: 'colors', n: 40 }), blurb: 'Monks who pay well for golds and deep reds, but only the purest.' }),
  // Special markets discovered by hunters (decision: expeditions feed the economy too).
  route({ id: 'glassworks', name: 'The Glassworks', palette: Object.freeze(['teal', 'blue', 'green']), premium: 0.6, discoveredBy: 'coast',
    unlock: Object.freeze({ type: 'discovered' }), blurb: 'Found by the sea: glassblowers hungry for sea colors.' }),
  route({ id: 'dyers-guild', name: "Dyers' Guild", palette: Object.freeze(['violet', 'pink']), premium: 0.6, discoveredBy: 'jungle',
    unlock: Object.freeze({ type: 'discovered' }), blurb: 'A secret guild in the canopy that prizes violets and pinks.' }),
  route({ id: 'cartographers', name: "Cartographers' Hall", palette: Object.freeze(['neutral', 'yellow']), premium: 0.5, discoveredBy: 'quarry',
    unlock: Object.freeze({ type: 'discovered' }), blurb: 'Mapmakers who need inks, sepias and old gold.' }),
]);

export const ROUTES_BY_ID = Object.freeze(Object.fromEntries(ROUTES.map((r) => [r.id, r])));
export const byId = ROUTES_BY_ID;

export function getRoute(id) {
  return ROUTES_BY_ID[id] ?? null;
}

/** True if a hue family is on a route's palette. */
export function routeWantsFamily(routeId, family) {
  const r = ROUTES_BY_ID[routeId];
  return !!r && r.palette.includes(family);
}

/** Special markets a hunter can discover on an expedition to `regionId`. */
export function marketsDiscoverableIn(regionId) {
  return ROUTES.filter((r) => r.discoveredBy === regionId);
}
