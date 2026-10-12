// samples.js — small sample projects, each written as US pattern rows the
// engine reads with parseRow. They double as a test of the parser.

const times = (n, rows) => Array.from({ length: n }, () => rows).flat();

export const SAMPLES = [
  {
    id: 'seed', name: 'Seed stitch swatch', note: 'k1, p1 over an odd count: the purls land on the knits.',
    co: 21, mode: 'flat', yarn: 'F',
    rows: times(14, ['*k1, p1; rep from * to last st, k1']),
  },
  {
    id: 'rib', name: '2x2 rib into stockinette', note: 'Rib, then stockinette above it.',
    co: 22, mode: 'flat', yarn: 'C',
    rows: [...times(4, ['k2, *p2, k2; rep from * to end', 'p2, *k2, p2; rep from * to end']), ...times(5, ['k to end', 'p to end'])],
  },
  {
    id: 'shale', name: 'Feather and Fan', note: 'Old Shale: (k2tog) 3 times, (yo, k1) 6 times, (k2tog) 3 times.',
    co: 36, mode: 'flat', yarn: 'B',
    rows: times(3, ['k to end', 'p to end', '*(k2tog) 3 times, (yo, k1) 6 times, (k2tog) 3 times; rep from * to end', 'k to end']),
  },
  {
    id: 'cables', name: 'Cable panel', note: 'Two 2/2 cables crossing away from each other, every 6 rows.',
    co: 18, mode: 'flat', yarn: 'A',
    rows: times(3, [
      'p3, 2/2 RC, p4, 2/2 LC, p3', 'k3, p4, k4, p4, k3',
      'p3, k4, p4, k4, p3', 'k3, p4, k4, p4, k3',
      'p3, k4, p4, k4, p3', 'k3, p4, k4, p4, k3',
    ]),
  },
  {
    id: 'mosaic', name: 'Mosaic stripes', note: 'One yarn per row; slipped stitches carry the other color up.',
    co: 21, mode: 'flat', yarn: 'A',
    rows: times(4, [
      'with B, k1, *sl 1 wyib, k1; rep from * to end', 'with B, k1, *sl 1 wyif, k1; rep from * to end',
      'with A, k2, *sl 1 wyib, k1; rep from * to last st, k1', 'with A, k2, *sl 1 wyif, k1; rep from * to last st, k1',
    ]),
  },
  {
    id: 'fairisle', name: 'Stranded band (in the round)', note: 'Two colors in a round; flip to the WS to see the floats.',
    co: 48, mode: 'round', yarn: 'A',
    rows: [
      ...times(3, ['k to end']),
      '*with B, k1, with A, k3; rep from * to end',
      '*with B, k2, with A, k1, with B, k1; rep from * to end',
      '*with B, k1, with A, k3; rep from * to end',
      ...times(3, ['with A, k to end']),
    ],
  },
  {
    id: 'brioche', name: 'Brioche rib', note: 'Set-up row, then sl1yo and brk.',
    co: 20, mode: 'flat', yarn: 'D',
    rows: ['*sl1yo, k1; rep from * to end', ...times(10, ['*sl1yo, brk; rep from * to end'])],
  },
  {
    id: 'wedge', name: 'Short-row wedge', note: 'Wrap and turn short rows build height on one side.',
    co: 20, mode: 'flat', yarn: 'C',
    rows: ['k to end', 'p to end', 'k16, w&t', 'p12, w&t', 'k8, w&t', 'p4, w&t', 'k to end', 'p to end', 'k to end', 'p to end'],
  },
  {
    id: 'shawl', name: 'Garter triangle', note: 'yo at both edges every row: the triangle grows as you knit.',
    co: 3, mode: 'flat', yarn: 'B',
    rows: times(16, ['k1, yo, k to last st, yo, k1']),
  },
  {
    id: 'hat', name: 'Hat crown (in the round)', note: 'Ribbed brim, then decreases every other round. Try the Tube view.',
    co: 64, mode: 'round', yarn: 'E',
    rows: [
      ...times(4, ['*k2, p2; rep from * to end']),
      ...times(6, ['k to end']),
      '*k6, k2tog; rep from * to end', 'k to end',
      '*k5, k2tog; rep from * to end', 'k to end',
      '*k4, k2tog; rep from * to end', 'k to end',
      '*k3, k2tog; rep from * to end', 'k to end',
      '*k2, k2tog; rep from * to end',
      '*k1, k2tog; rep from * to end',
      '*k2tog; rep from * to end',
    ],
  },
  {
    id: 'lace', name: 'Eyelet rows', note: 'k1, *yo, k2tog; rep to last st, k1, between bands of stockinette.',
    co: 21, mode: 'flat', yarn: 'A',
    rows: times(3, ['k to end', 'p to end', 'k1, *yo, k2tog; rep from * to end', 'p to end']),
  },
];
