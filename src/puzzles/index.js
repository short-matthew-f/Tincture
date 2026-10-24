// index.js — re-exports the four puzzle modules (docs/DESIGN.md "Active play").
// Namespaced because each module has its own create / apply / isSolved.

export * as grading from './grading.js';
export * as matching from './matching.js';
export * as purify from './purify.js';
export * as packing from './packing.js';
export { TIERS as GRADING_TIERS } from './grading.js';
export * as tiles from './tiles.js';
export * as skeins from './skeins.js';
export * as garden from './garden.js';
export * as lift from './lift.js';
export * as liftLevels from './lift-levels.js';
export * as tangle from './tangle.js';
export * as tangleLevels from './tangle-levels.js';
export * as hoop from './hoop.js';
export * as hoopLevels from './hoop-levels.js';
export * as hoopLayout from './hoop-layout.js';
