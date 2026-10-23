// The Lifting Table: palette and hand-made pictures (pure data).
// Art rows are run-length strings: "s5 r2 s5" = five s, two r, five s.
// Lane queues, solutions and stats live in queues.js (written by gen-levels.mjs).
import { QUEUES } from './queues.js';
import { buildLevel } from './rules.js';

// Soft natural pigments from the Tincture catalog. One letter each.
export const PALETTE = {
  s: { name: 'Sky Blue', hex: '#8babc5', glyph: 'wave' },
  o: { name: 'Yellow Ochre', hex: '#d39b2a', glyph: 'sun' },
  g: { name: 'Green', hex: '#758054', glyph: 'leaf' },
  r: { name: 'Madder Red', hex: '#b8433a', glyph: 'heart' },
  c: { name: 'Lighthouse White', hex: '#eee4c8', glyph: 'ring' },
  b: { name: 'Woad Blue', hex: '#3e6a9e', glyph: 'drop' },
  k: { name: 'Walnut', hex: '#6f5c4c', glyph: 'square' },
  p: { name: 'Rose', hex: '#d78b80', glyph: 'flower' },
  w: { name: 'Willow', hex: '#869473', glyph: 'chevron' },
  n: { name: 'Navy', hex: '#324961', glyph: 'moon' },
  y: { name: 'Custard', hex: '#e7c691', glyph: 'star' },
  m: { name: 'Mulberry', hex: '#824e52', glyph: 'diamond' },
  a: { name: 'Apricot', hex: '#d69158', glyph: 'triangle' },
  l: { name: 'Linen', hex: '#c5b19a', glyph: 'bars' },
  h: { name: 'Shell Pink', hex: '#e5b6ab', glyph: 'shell' },
  f: { name: 'Forest', hex: '#38423d', glyph: 'cross' },
  t: { name: 'Teal', hex: '#4d7181', glyph: 'dot' },
};

export const LEVEL_DEFS = [
  {
    id: 'sun', name: 'Morning sun', noun: 'morning sun', lanes: 2, slots: 4, bench: 3,
    art: [
      's10', 's10', 's4 o2 s4', 's3 o4 s3', 's3 o4 s3', 's4 o2 s4',
      's10', 's10', 's2 g2 s6', 's g4 s3 g2', 'g10', 'g10',
    ],
  },
  {
    id: 'tulip', name: 'Tulip', noun: 'tulip', lanes: 2, slots: 4, bench: 3,
    art: [
      'c10', 'c2 r c r2 c r c2', 'c2 r6 c2', 'c2 r6 c2', 'c3 r4 c3', 'c4 g2 c4',
      'c g c2 g2 c2 g c', 'c g2 c g2 c g2 c', 'c2 g6 c2', 'c3 g3 c4', 'c4 g2 c4',
      'c k8 c', 'c2 k6 c2', 'c2 k6 c2',
    ],
  },
  {
    id: 'sail', name: 'Sailboat', noun: 'sailboat', lanes: 3, slots: 4, bench: 3,
    art: [
      's12', 's6 k s5', 's5 c k c s4', 's4 c2 k c2 s3', 's3 c3 k c3 s2', 's3 c3 k c4 s',
      's2 c4 k c4 s', 's6 k s5', 's k10 s', 's2 k8 s2', 'b3 k6 b3', 'b12',
      'b2 s b6 s b2', 'b12',
    ],
  },
  {
    id: 'house', name: 'Little house', noun: 'little house', lanes: 3, slots: 4, bench: 3,
    art: [
      's12', 's12', 's5 r2 s5', 's4 r4 s4', 's3 r6 s3', 's2 r8 s2', 's r10 s',
      's l10 s', 's l s2 l4 s2 l s', 's l s2 l4 s2 l s', 's l5 k2 l3 s', 's l5 k2 l3 s',
      'g12', 'g12',
    ],
  },
  {
    id: 'mushroom', name: 'Mushroom', noun: 'mushroom', lanes: 3, slots: 4, bench: 3,
    art: [
      's12', 's12', 's4 r4 s4', 's2 r3 c2 r3 s2', 's r2 c2 r6 s', 's r6 c2 r2 s',
      'r3 c r4 c2 r2', 'r12', 's3 l6 s3', 's4 l4 s4', 's4 l4 s4', 's4 l4 s4',
      's g3 l4 g3 s', 'g12', 'g12',
    ],
  },
  {
    id: 'sunset', name: 'Sunset', noun: 'sunset', lanes: 3, slots: 4, bench: 3,
    art: [
      'm13', 'm13', 'm13', 'p13', 'p5 y3 p5', 'p3 y7 p3', 'p2 y9 p2', 'p y11 p',
      'o y11 o', 'o2 y9 o2', 'n3 y7 n3', 'n13', 'n4 y5 n4', 'n13', 'n5 y3 n5', 'n13',
    ],
  },
  {
    id: 'cat', name: 'Cat on the sill', noun: 'cat', lanes: 4, slots: 4, bench: 3,
    art: [
      'k14', 'k n12 k', 'k n8 y2 n2 k', 'k n7 y3 n2 k', 'k n8 y2 n2 k', 'k n12 k',
      'k n2 a n2 a n6 k', 'k n2 a4 n6 k', 'k n2 a y a y n6 k', 'k n2 a4 n6 k',
      'k n a6 n5 k', 'k n a6 n5 k', 'k n a6 n a n3 k', 'k n a8 n3 k', 'l14', 'k14',
    ],
  },
  {
    id: 'teapot', name: 'Teapot', noun: 'teapot', lanes: 4, slots: 4, bench: 3,
    art: [
      'h14', 'h5 c h c h6', 'h6 c h c h5', 'h5 c h c h6', 'h6 o2 h6', 'h4 t6 h4',
      'h3 b8 h3', 'b h b10 h b', 'h b12 h', 'h2 b c b2 c b2 c b2 h2', 'h2 b10 h2',
      'h2 b2 c b2 c b2 c b h2', 'h2 b10 h2', 'h3 b8 h3', 'h4 b6 h4',
      'r c r c r c r c r c r c r c', 'c r c r c r c r c r c r c r',
    ],
  },
  {
    id: 'lighthouse', name: 'Lighthouse', noun: 'lighthouse', lanes: 4, slots: 4, bench: 3,
    art: [
      's14', 's6 r2 s6', 's5 r4 s5', 's2 y10 s2', 's5 k4 s5', 's5 c4 s5', 's5 r4 s5',
      's5 r4 s5', 's5 c4 s5', 's5 c4 s5', 's4 r6 s4', 's4 r6 s4', 's4 c6 s4',
      's4 c2 k2 c2 s4', 's3 k8 s3', 'b2 k10 b2', 'b14', 'b3 s b5 s b4',
    ],
  },
  {
    id: 'apple', name: 'Apple tree', noun: 'apple tree', lanes: 4, slots: 4, bench: 3,
    art: [
      's11 o3 s', 's11 o3 s', 's4 g6 s5', 's3 g8 s4', 's2 g3 r g5 s4', 's g8 r g3 s2',
      's g2 r g10 s', 's g6 r g5 r s', 's g13 s', 's2 g4 r g5 s3', 's3 g3 k3 g3 s3',
      's6 k3 s6', 's6 k3 s6', 's6 k3 s6', 's6 k3 s6', 'w5 k5 w5', 'w2 r w12', 'w15',
    ],
  },
  {
    id: 'yarn', name: 'Ball of yarn', noun: 'ball of yarn', lanes: 4, slots: 4, bench: 3,
    art: [
      'c16', 'c2 o c10 o c2', 'c3 k c8 k c3', 'c4 k c6 k c4', 'c5 k p4 k c5',
      'c4 p3 m p4 c4', 'c3 p2 m p3 m p3 c3', 'c3 m p3 m p3 m p c3', 'c3 p m p3 m p3 m c3',
      'c3 p2 m p3 m p3 c3', 'c4 p3 m p4 c4', 'a16', 'a2 k a2 k a2 k a2 k a2 k a',
      'k a2 k a2 k a2 k a2 k a2 k', 'a2 k a2 k a2 k a2 k a2 k a', 'c a14 c', 'g3 p5 g8', 'g16',
    ],
  },
  {
    id: 'sheep', name: 'Sheep', noun: 'sheep', lanes: 4, slots: 4, bench: 3,
    art: [
      's16', 's12 o3 s', 's2 c4 s6 o3 s', 's c6 s5 o3 s', 's2 c4 s10', 's16',
      'k s4 k s4 k s4 k', 'k16', 'k s4 k s4 k s4 k', 'g3 c7 g6', 'g2 c9 f2 g3',
      'g2 c9 f3 g2', 'g2 c9 f2 g3', 'g3 c7 g6', 'g3 f g3 f g8', 'g3 f g3 f g8',
      'g p g5 p g4 o g3', 'g16', 'g4 p g6 p g4', 'g16',
    ],
  },
];

// Ready-to-play levels: art + lanes + a known solution (verified by the tests).
export const LEVELS = LEVEL_DEFS.map((d) => {
  const q = QUEUES[d.id] || { queues: [], solution: '', stats: null };
  return { ...buildLevel({ ...d, queues: q.queues }), solution: q.solution, stats: q.stats };
});
export const levelById = (id) => LEVELS.find((L) => L.id === id) || null;
