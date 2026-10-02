// index.js — re-exports the four puzzle modules (docs/DESIGN.md "Active play").
// Namespaced because each module has its own create / apply / isSolved.

export * as grading from './grading.js';
export * as matching from './matching.js';
export * as purify from './purify.js';
export * as packing from './packing.js';
export { TIERS as GRADING_TIERS } from './grading.js';
