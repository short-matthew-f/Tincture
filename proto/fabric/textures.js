// textures.js — drawing fabric for the fiber prototypes (browser canvas).
//
// CONTRACT (used by the Dye Studio and the Quilt Designer; the Dye Studio
// owns and may improve the drawing, but must keep these exports and their
// meaning):
//
//   BASES: [{ id, name, note }]           the cloth types
//   PRINTS: [{ id, name }]                procedural prints for the starter stash
//   DYES: [{ id, name, hex }]             the natural-dye palette (matches the game)
//   drawBase(ctx, size, baseId, hex, rng)  fills a size×size tile with plain cloth of
//                                           that type and color (weave, slubs, nap, sheen)
//   drawPrint(ctx, size, printId, colors, rng)  draws a print over the cloth
//   fabricTile(spec, px = 384) -> canvas    spec = { base, color, print?, colors?, seed }
//   tileDataURL(canvas, q = 0.86) -> 'data:image/jpeg;...'
//   starterFabrics() -> [Fabric]           a small starter stash (see stash.js), deterministic
//   mulberry32(seed) -> rng
//
// A first version by the integrator; the Dye Studio agent is expected to make
// the cloth look better (keep it fast: a 384 px tile in well under 50 ms).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DYES = [
  { id: 'madder', name: 'Madder', hex: '#B8433A' },
  { id: 'ochre', name: 'Ochre', hex: '#D9A63A' },
  { id: 'woad', name: 'Woad', hex: '#3E6A9E' },
  { id: 'indigo', name: 'Indigo', hex: '#2C3E66' },
  { id: 'weld', name: 'Weld', hex: '#E3C65A' },
  { id: 'cochineal', name: 'Cochineal', hex: '#C2507A' },
  { id: 'logwood', name: 'Logwood', hex: '#5B3B6E' },
  { id: 'walnut', name: 'Walnut', hex: '#6B4A32' },
  { id: 'sage', name: 'Sage', hex: '#8A9A6B' },
  { id: 'rust', name: 'Rust', hex: '#A4562D' },
  { id: 'charcoal', name: 'Charcoal', hex: '#2E2B28' },
  { id: 'cream', name: 'Undyed', hex: '#EFE6D2' },
];

export const BASES = [
  { id: 'quilting-cotton', name: 'Quilting cotton', note: 'Crisp, even plain weave. The everyday quilter\'s cloth.' },
  { id: 'batik-cotton', name: 'Batik cotton', note: 'A tight, fine weave that holds wax lines crisply.' },
  { id: 'linen', name: 'Linen', note: 'Slubby threads and a soft, uneven color.' },
  { id: 'flannel', name: 'Flannel', note: 'Brushed and fuzzy; colors look soft.' },
  { id: 'voile', name: 'Voile', note: 'Light and fine, with a gentle sheen.' },
  { id: 'chambray', name: 'Chambray', note: 'Colored warp, white weft: a soft, heathered look.' },
  { id: 'shot-cotton', name: 'Shot cotton', note: 'Two colors woven together: it shimmers.' },
];

export const PRINTS = [
  { id: 'dots', name: 'Polka dots' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'gingham', name: 'Gingham' },
  { id: 'calico', name: 'Calico' },
  { id: 'floral', name: 'Small floral' },
  { id: 'plaid', name: 'Plaid' },
];

function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb([r, g, b], a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** Plain cloth of a base type in one color, drawn as a tile that repeats. */
export function drawBase(ctx, size, baseId, hex, rng = mulberry32(1)) {
  const c = hexRgb(hex);
  const fill = baseId === 'flannel' ? mix(c, WHITE, 0.08) : c;
  ctx.fillStyle = rgb(fill);
  ctx.fillRect(0, 0, size, size);
  const pitch = { 'batik-cotton': 2, voile: 2, linen: 4, flannel: 5, chambray: 3, 'shot-cotton': 3 }[baseId] || 3;
  // Warp and weft threads: faint light and dark lines.
  for (let x = 0; x < size; x += pitch) {
    ctx.fillStyle = rgb(mix(fill, (x / pitch) % 2 ? WHITE : BLACK, 0.05 + rng() * 0.03), 0.6);
    ctx.fillRect(x, 0, 1, size);
  }
  for (let y = 0; y < size; y += pitch) {
    ctx.fillStyle = rgb(mix(fill, (y / pitch) % 2 ? BLACK : WHITE, 0.04 + rng() * 0.03), 0.55);
    ctx.fillRect(0, y, size, 1);
  }
  if (baseId === 'chambray') {
    // White weft through a colored warp.
    for (let y = 1; y < size; y += pitch) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(0, y, size, 1); }
  }
  if (baseId === 'shot-cotton') {
    const other = mix(c, [c[2], c[0], c[1]], 0.55);
    for (let y = 1; y < size; y += pitch) { ctx.fillStyle = rgb(other, 0.35); ctx.fillRect(0, y, size, 1); }
  }
  if (baseId === 'linen') {
    // Slubs: short thicker threads.
    for (let i = 0; i < size * 0.6; i++) {
      const x = rng() * size, y = rng() * size, l = 6 + rng() * 22;
      ctx.fillStyle = rgb(mix(fill, rng() < 0.5 ? WHITE : BLACK, 0.1 + rng() * 0.08), 0.5);
      if (rng() < 0.5) ctx.fillRect(x, y, l, 1.5); else ctx.fillRect(x, y, 1.5, l);
    }
  }
  if (baseId === 'flannel') {
    // Brushed nap: soft speckle.
    for (let i = 0; i < size * size * 0.02; i++) {
      ctx.fillStyle = rgb(mix(fill, WHITE, 0.2 + rng() * 0.2), 0.25);
      ctx.fillRect(rng() * size, rng() * size, 1.6, 1.6);
    }
  }
  if (baseId === 'voile') {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
}

/** A simple repeating print on top of the cloth. colors[0] is the ground, the rest are motif colors. */
export function drawPrint(ctx, size, printId, colors, rng = mulberry32(2)) {
  const m = colors.slice(1).length ? colors.slice(1) : ['#EFE6D2'];
  const pick = (i) => m[i % m.length];
  ctx.save();
  if (printId === 'dots') {
    const step = size / 6;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      ctx.fillStyle = pick(0);
      ctx.beginPath(); ctx.arc((i + (j % 2) * 0.5) * step + step / 4, j * step + step / 2, step * 0.14, 0, 6.2832); ctx.fill();
      if (i === 0 && j % 2) { ctx.beginPath(); ctx.arc(size + step / 4 - step / 2, j * step + step / 2, step * 0.14, 0, 6.2832); ctx.fill(); }
    }
  } else if (printId === 'stripes') {
    const step = size / 8;
    for (let i = 0; i < 8; i += 2) { ctx.fillStyle = pick(i / 2); ctx.globalAlpha = 0.9; ctx.fillRect(i * step, 0, step * 0.8, size); }
  } else if (printId === 'gingham') {
    const step = size / 8;
    ctx.fillStyle = pick(0);
    for (let i = 0; i < 8; i += 2) { ctx.globalAlpha = 0.45; ctx.fillRect(i * step, 0, step, size); ctx.fillRect(0, i * step, size, step); }
  } else if (printId === 'plaid') {
    const step = size / 8;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = pick(i % 3); ctx.globalAlpha = i % 4 === 0 ? 0.5 : 0.18;
      ctx.fillRect(i * step, 0, i % 4 === 0 ? step * 0.6 : step * 0.15, size);
      ctx.fillRect(0, i * step, size, i % 4 === 0 ? step * 0.6 : step * 0.15);
    }
  } else if (printId === 'calico' || printId === 'floral') {
    const n = printId === 'calico' ? 70 : 26;
    for (let k = 0; k < n; k++) {
      const x = rng() * size, y = rng() * size, r = (printId === 'calico' ? 3 : 7) + rng() * 4;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
        ctx.fillStyle = pick(k);
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * 6.2832 + k;
          ctx.beginPath(); ctx.ellipse(x + dx + Math.cos(a) * r * 0.7, y + dy + Math.sin(a) * r * 0.7, r * 0.5, r * 0.32, a, 0, 6.2832); ctx.fill();
        }
        if (printId === 'floral') { ctx.fillStyle = pick(k + 1); ctx.beginPath(); ctx.arc(x + dx, y + dy, r * 0.28, 0, 6.2832); ctx.fill(); }
      }
    }
  }
  ctx.restore();
}

export function fabricTile(spec, px = 384) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(spec.seed || 7);
  drawBase(ctx, px, spec.base || 'quilting-cotton', spec.color, rng);
  if (spec.print) {
    drawPrint(ctx, px, spec.print, [spec.color, ...(spec.colors || [])], rng);
    // Let the weave show through the print a little.
    ctx.globalAlpha = 0.25;
    drawBase(ctx, px, spec.base || 'quilting-cotton', spec.color, mulberry32(spec.seed || 7));
    ctx.globalAlpha = 1;
  }
  return cv;
}

export function tileDataURL(canvas, q = 0.86) {
  return canvas.toDataURL('image/jpeg', q);
}

/** The starter stash: a few solids and prints so the quilt designer has fabric on day one. */
export function starterFabrics() {
  const d = Object.fromEntries(DYES.map((x) => [x.id, x.hex]));
  const specs = [
    ['Undyed cotton', 'quilting-cotton', d.cream],
    ['Indigo', 'quilting-cotton', d.indigo],
    ['Madder', 'quilting-cotton', d.madder],
    ['Weld', 'quilting-cotton', d.weld],
    ['Sage linen', 'linen', d.sage],
    ['Walnut flannel', 'flannel', d.walnut],
    ['Woad chambray', 'chambray', d.woad],
    ['Cochineal shot cotton', 'shot-cotton', d.cochineal],
    ['Cream dots on indigo', 'quilting-cotton', d.indigo, 'dots', [d.cream]],
    ['Madder calico', 'quilting-cotton', d.madder, 'calico', [d.weld, d.cream]],
    ['Sage gingham', 'quilting-cotton', d.cream, 'gingham', [d.sage]],
    ['Ochre floral', 'quilting-cotton', d.ochre, 'floral', [d.madder, d.cream]],
  ];
  return specs.map(([name, base, color, print, colors], i) => {
    const tile = fabricTile({ base, color, print, colors, seed: 100 + i });
    return {
      id: `starter-${i}`, name, base, kind: print ? 'print' : 'solid', color, colors: [color, ...(colors || [])],
      img: tileDataURL(tile), inches: print ? 6 : 8, repeat: true, starter: true, createdAt: 0,
    };
  });
}
