// The Tangle Basket: the baskets (pure data). Geometry, colors, solutions
// and stats live in heaps.js, written by gen-levels.mjs.
import { HEAPS } from './heaps.js';
import { buildLevel, mechanicsOf, levelSig, validState, VERSION } from './rules.js';

// What each new thing is called, and the one line that introduces it.
export const MECHANICS = {
  rack: { name: 'A full rack', line: 'Five spools fit on the rack, and this heap has six colors. Finish a spool to make room before starting a new color.' },
  knot: { name: 'Knotted ends', line: 'Two strands knotted end to end come out together, so both need to be free.' },
  weave: { name: 'Woven yarn', line: 'Longer strands loop and weave: over one neighbor, under the next. Look at each crossing to see which lies on top.' },
  pin: { name: 'Pins', line: 'A pinned strand stays put until the strand matching its pin’s glass head is pulled.' },
  snarl: { name: 'Snarls', line: 'Two strands that lie over and under each other are snarled. Tap one to see its partner glow; they come out together once nothing else lies on them.' },
  variegated: { name: 'Two-color yarn', line: 'A two-color strand winds onto two spools, one length to each color.' },
  big: { name: 'A bigger heap', line: 'More strands, and all eight colors. Same rules, more to untangle.' },
  buried: { name: 'Buried colors', line: 'A strand still under others looks undyed gray until you uncover it.' },
  deep: { name: 'A deep heap', line: 'Pinch (or tap Zoom) to look closer, and drag to look around. Double-tap an empty spot, or tap Fit, to see the whole basket again.' },
  rack4: { name: 'A smaller rack', line: 'Only four spools fit on the rack in these baskets.' },
  tuck: { name: 'Tucked ends', line: 'An end tucked under another strand is held there, just like a crossing. Free the strand on top first.' },
  peg: { name: 'Pegs', line: 'A strand looped round a peg stays put until you finish a skein in the color of the peg’s band. Then the peg lifts out.' },
  snarl3: { name: 'Bigger snarls', line: 'Three strands can snarl in a ring, each over the next. Tap one to see all three; they come out together.' },
};

// Generation knobs (see gen-levels.mjs): n strands; len range (board units);
// size: the board is size times 100 x 140; loop: how loopy (0 to 1); colors
// in play; slots on the rack; knots; pins; pegs; vari (two-color strands);
// buried (share of covered strands shown gray); snarl2 / snarl3 (snarls of two
// and three strands); tucks (tips tucked under, from `tips` resting tips);
// depth (wanted layers); target random-player clear rate.
// intro: a card for something that isn't a rule change.
export const LEVEL_DEFS = [
  // ---- learning the basket ----
  { id: 'first', name: 'First tangle', knobs: { n: 6, len: [70, 95], colors: 2, slots: 5, depth: 2, target: 1 } },
  { id: 'scraps', name: 'A handful of scraps', knobs: { n: 9, len: [65, 90], colors: 3, slots: 5, depth: 2, target: 1 } },
  { id: 'leftovers', name: 'The leftovers bag', knobs: { n: 15, len: [55, 80], colors: 5, slots: 5, depth: 3, target: 1 } },
  { id: 'plan', name: 'Six colors, five spools', intro: 'rack', knobs: { n: 18, len: [55, 80], colors: 6, slots: 5, target: 0.75 } },
  { id: 'cat', name: 'The cat got into it', knobs: { n: 21, len: [50, 75], colors: 7, slots: 5, target: 0.55 } },
  // ---- knots and weaving ----
  { id: 'joins', name: 'Joined ends', knobs: { n: 21, len: [55, 80], colors: 6, slots: 5, knots: 2, target: 0.6 } },
  { id: 'magic', name: 'Magic knots', intro: 'weave', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.8, colors: 7, slots: 5, knots: 3, target: 0.4 } },
  // ---- pins ----
  { id: 'pinned', name: 'Pinned to the board', knobs: { n: 21, len: [65, 95], size: 1.05, loop: 0.5, colors: 7, slots: 5, pins: 2, target: 0.5 } },
  { id: 'blocking', name: 'Blocking day', knobs: { n: 24, len: [65, 95], size: 1.1, loop: 0.5, colors: 7, slots: 5, pins: 3, knots: 2, target: 0.35 } },
  // ---- snarls ----
  { id: 'snarl', name: 'Interlocked', knobs: { n: 24, len: [70, 100], size: 1.15, loop: 0.7, colors: 7, slots: 5, snarl2: 1, target: 0.4 } },
  // ---- two-color yarn ----
  { id: 'stripes', name: 'Self-striping', knobs: { n: 21, len: [65, 95], size: 1.1, loop: 0.6, colors: 7, slots: 5, vari: 3, snarl2: 1, target: 0.45 } },
  { id: 'festival', name: 'After the fiber festival', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 8, slots: 5, vari: 3, knots: 2, pins: 1, snarl2: 1, target: 0.3 } },
  // ---- a bigger heap ----
  { id: 'bottom', name: 'The bottom of the bag', intro: 'big', knobs: { n: 30, len: [60, 90], size: 1.2, loop: 0.6, colors: 8, slots: 5, snarl2: 1, target: 0.3 } },
  // ---- buried colors ----
  { id: 'thrift', name: 'The thrift-store bag', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 7, slots: 5, buried: 0.4, snarl2: 1, target: 0.35 } },
  { id: 'attic', name: 'Grandma’s attic', knobs: { n: 27, len: [65, 95], size: 1.2, loop: 0.6, colors: 8, slots: 5, buried: 0.4, knots: 2, vari: 3, snarl2: 1, target: 0.25 } },
  // ---- a deep heap ----
  { id: 'deep', name: 'The deep end', knobs: { n: 39, len: [80, 115], size: 1.5, loop: 0.7, colors: 8, slots: 5, snarl2: 2, depth: 6, target: 0.25 } },
  // ---- a smaller rack ----
  { id: 'small', name: 'A smaller rack', knobs: { n: 18, len: [60, 90], size: 1.05, loop: 0.5, colors: 6, slots: 4, snarl2: 1, target: 0.35 } },
  { id: 'swap', name: 'Swap meet', knobs: { n: 21, len: [60, 90], size: 1.1, loop: 0.5, colors: 6, slots: 4, knots: 2, pins: 1, snarl2: 1, target: 0.25 } },
  { id: 'destash', name: 'Destash day', knobs: { n: 24, len: [65, 95], size: 1.15, loop: 0.6, colors: 7, slots: 4, vari: 3, buried: 0.3, snarl2: 1, target: 0.2 } },
  // ---- tucks, pegs and rings ----
  { id: 'tucked', name: 'Tucked in', knobs: { n: 36, len: [75, 110], size: 1.45, loop: 0.7, colors: 8, slots: 5, tucks: 3, tips: 5, snarl2: 1, depth: 5, target: 0.25 } },
  { id: 'pegboard', name: 'The pegboard', knobs: { n: 36, len: [75, 110], size: 1.45, loop: 0.7, colors: 8, slots: 5, pegs: 2, tucks: 2, tips: 4, snarl2: 1, depth: 5, target: 0.2 } },
  { id: 'ring', name: 'Ring around', knobs: { n: 39, len: [75, 110], size: 1.5, loop: 0.7, colors: 8, slots: 5, snarl3: 1, snarl2: 1, tucks: 1, tips: 3, depth: 6, target: 0.2 } },
  // ---- the whole stash ----
  { id: 'studio', name: 'The studio floor', knobs: { n: 42, len: [75, 110], size: 1.55, loop: 0.7, colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, snarl2: 2, tucks: 2, tips: 4, depth: 6, target: 0.15 } },
  { id: 'guild', name: 'Guild night', knobs: { n: 45, len: [75, 110], size: 1.6, loop: 0.75, colors: 8, slots: 4, knots: 2, pins: 2, vari: 3, buried: 0.3, snarl2: 2, snarl3: 1, tucks: 2, tips: 4, depth: 6, target: 0.1 } },
  { id: 'stash', name: 'The whole stash', knobs: { n: 48, len: [75, 110], size: 1.65, loop: 0.75, colors: 8, slots: 4, knots: 3, pins: 2, pegs: 1, vari: 3, buried: 0.35, snarl2: 2, snarl3: 1, tucks: 2, tips: 4, depth: 6, target: 0.08 } },
  // ---- truly gnarly ----
  { id: 'felted', name: 'Felted in the wash', knobs: { n: 48, len: [75, 108], size: 1.7, loop: 0.8, colors: 8, slots: 4, knots: 2, pins: 2, pegs: 1, snarl2: 3, snarl3: 1, tucks: 3, tips: 5, depth: 6, target: 0.06 } },
  { id: 'moths', name: 'Moths in the cupboard', knobs: { n: 51, len: [75, 106], size: 1.75, loop: 0.8, colors: 8, slots: 4, knots: 2, pins: 2, pegs: 2, vari: 3, buried: 0.35, snarl2: 3, snarl3: 1, tucks: 3, tips: 5, depth: 6, target: 0.05 } },
  { id: 'nest', name: 'The rat’s nest', knobs: { n: 54, len: [75, 105], size: 1.82, loop: 0.85, colors: 8, slots: 4, knots: 3, pins: 2, pegs: 2, snarl2: 3, snarl3: 2, tucks: 3, tips: 5, depth: 6, target: 0.04 } },
  { id: 'everything', name: 'Everything at once', knobs: { n: 57, len: [75, 105], size: 1.9, loop: 0.85, colors: 8, slots: 4, knots: 3, pins: 3, pegs: 2, vari: 3, buried: 0.35, snarl2: 4, snarl3: 2, tucks: 4, tips: 6, depth: 6, target: 0.03 } },
];

export const BANDS = [
  { name: 'Learning the basket', from: 0 },
  { name: 'Knots and weaving', from: 5 },
  { name: 'Pins', from: 7 },
  { name: 'Snarls', from: 9 },
  { name: 'Two-color yarn', from: 10 },
  { name: 'A bigger heap', from: 12 },
  { name: 'Buried colors', from: 13 },
  { name: 'A deep heap', from: 15 },
  { name: 'A smaller rack', from: 16 },
  { name: 'Tucks, pegs and rings', from: 19 },
  { name: 'The whole stash', from: 22 },
  { name: 'Truly gnarly', from: 25 },
];

// Ready-to-play levels: geometry + colors + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.filter((d) => HEAPS[d.id]).map((d) => {
  const h = HEAPS[d.id];
  const L = buildLevel({ id: d.id, name: d.name, slots: h.slots, board: h.board, strands: h.strands, knots: h.knots, pins: h.pins, pegs: h.pegs, flips: h.flips });
  const mech = mechanicsOf(L);
  if (d.intro) mech.unshift(d.intro);
  return { ...L, solution: h.solution, stats: h.stats, sig: levelSig(L), mechanics: [...new Set(mech)] };
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;

// ---------- the save ----------
// What a save may hold: { v: 1, cur, done: { id: true }, glyphs, sound, seenHow,
// seenIntro: { mechanic: true }, game: { level, sig, state, past } }.
// readSave(raw) -> { data, reset } turns whatever was stored into clean data.
// Progress from an older version carries over: ticks and seen cards stay, and
// a basket in progress is kept only if that basket is still exactly the same
// (its signature); otherwise `reset` names it, so the page can say it was
// rewound and starts fresh.
export function readSave(raw) {
  const data = { v: 1, cur: LEVELS[0].id, done: {}, glyphs: false, sound: false, seenHow: false, seenIntro: {}, game: null };
  let reset = null;
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return { data, reset };
  if (raw.done && typeof raw.done === 'object') for (const id of Object.keys(raw.done)) if (levelById(id) && raw.done[id]) data.done[id] = true;
  data.cur = typeof raw.cur === 'string' && levelById(raw.cur) ? raw.cur : LEVELS[0].id;
  data.glyphs = !!raw.glyphs; data.sound = !!raw.sound; data.seenHow = !!raw.seenHow;
  if (raw.seenIntro && typeof raw.seenIntro === 'object') for (const k of Object.keys(raw.seenIntro)) if (MECHANICS[k] && raw.seenIntro[k]) data.seenIntro[k] = true;
  const g = raw.game;
  if (g && typeof g === 'object' && typeof g.level === 'string') {
    const L = levelById(g.level);
    if (L && g.sig === L.sig && validState(L, g.state) && Array.isArray(g.past)) {
      data.game = { level: L.id, sig: L.sig, state: g.state, past: g.past.filter((s) => validState(L, s)) };
    } else if (L && g.state && Array.isArray(g.state.out) && g.state.out.some(Boolean) && g.state.v === VERSION) reset = L.id;
  }
  return { data, reset };
}
