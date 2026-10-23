// The Dye Garden: papercut sprites for plants, the basket and ground bits.
// Each sprite is drawn once into an offscreen canvas (two passes: a soft
// paper shadow, then the shapes) and blitted with drawImage every frame.
import { SPECIES, DYES, mulberry32, hashStr } from './rules.js';

export const PAD = 1.32; // sprite half-size in plant radii (leaves poke out a little)
const SHADOW = 'rgba(42,38,34,.2)';
let SH = false; // shadow pass: every fill is the shadow color

const TAU = Math.PI * 2;
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
const light = (c, t = 0.3) => mix(c, '#FFFFFF', t);
const dark = (c, t = 0.25) => mix(c, '#000000', t);
const LEAF = '#6E8F4E', LEAF2 = '#5C7A40', LEAF3 = '#88A55E';

function fill(ctx, c) { ctx.fillStyle = SH ? SHADOW : c; ctx.fill(); }
function stroke(ctx, c, w) { ctx.strokeStyle = SH ? SHADOW : c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
function circ(ctx, x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fill(ctx, c); }
function ell(ctx, x, y, rx, ry, rot, c) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); fill(ctx, c); }
function leaf(ctx, a, d0, len, w, c) {
  const cx = Math.cos(a), sy = Math.sin(a);
  ctx.beginPath();
  ctx.moveTo(cx * d0, sy * d0);
  const tx = cx * (d0 + len), ty = sy * (d0 + len);
  const mx = cx * (d0 + len * 0.5), my = sy * (d0 + len * 0.5);
  ctx.quadraticCurveTo(mx - sy * w, my + cx * w, tx, ty);
  ctx.quadraticCurveTo(mx + sy * w, my - cx * w, cx * d0, sy * d0);
  fill(ctx, c);
}
function ring(ctx, n, d, fn, rot = 0) { for (let i = 0; i < n; i++) fn((i / n) * TAU + rot, i); }

// ---------- plant shapes (unit radius) ----------
const SHAPES = {
  daisy(ctx, rnd, c) {
    ring(ctx, 4, 0, (a) => leaf(ctx, a + 0.4, 0.2, 0.85, 0.22, LEAF));
    const r0 = rnd() * TAU;
    ring(ctx, 12, 0, (a) => ell(ctx, Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.34, 0.13, a, c), r0);
    circ(ctx, 0, 0, 0.3, dark(c, 0.15));
    circ(ctx, -0.07, -0.07, 0.12, light(c, 0.25));
  },
  cosmos(ctx, rnd, c) {
    ring(ctx, 5, 0, (a) => leaf(ctx, a, 0.2, 0.85, 0.12, LEAF3));
    ring(ctx, 8, 0, (a) => ell(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.36, 0.22, a, c), rnd() * TAU);
    circ(ctx, 0, 0, 0.22, '#C9952A');
  },
  coreopsis(ctx, rnd, c) {
    ring(ctx, 5, 0, (a) => leaf(ctx, a, 0.15, 0.85, 0.12, LEAF));
    const r0 = rnd() * TAU;
    ring(ctx, 8, 0, (a) => ell(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.36, 0.2, a, light(c, 0.15)), r0);
    ring(ctx, 8, 0, (a) => ell(ctx, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0.18, 0.15, a, '#8E2F22'), r0);
    circ(ctx, 0, 0, 0.16, '#5A2A1C');
  },
  pompom(ctx, rnd, c) {
    ring(ctx, 5, 0, (a) => leaf(ctx, a + 0.3, 0.3, 0.75, 0.2, LEAF2));
    const r0 = rnd() * TAU;
    ring(ctx, 11, 0, (a) => circ(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.26, dark(c, 0.08)), r0);
    ring(ctx, 8, 0, (a) => circ(ctx, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.22, c), r0 + 0.3);
    circ(ctx, 0, 0, 0.2, light(c, 0.2));
  },
  curls(ctx, rnd, c) {
    for (let i = 0; i < 4; i++) {
      const a = rnd() * TAU, d = 0.25 + rnd() * 0.3, x = Math.cos(a) * d, y = Math.sin(a) * d;
      const rot = rnd() * TAU, col = i % 2 ? c : light(c, 0.2);
      ctx.beginPath();
      ctx.ellipse(x, y, 0.55, 0.38, rot, 0.2, Math.PI + 0.6);
      ctx.ellipse(x + Math.cos(rot + 1.6) * 0.12, y + Math.sin(rot + 1.6) * 0.12, 0.42, 0.22, rot, Math.PI + 0.6, 0.2, true);
      ctx.closePath();
      fill(ctx, col);
    }
  },
  lichen(ctx, rnd, c) {
    const base = mix(c, '#9FAE8A', 0.45);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.55;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.22 + rnd() * 0.18, i % 3 ? base : light(base, 0.2));
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.6;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.07, light(c, 0.35));
    }
  },
  acorns(ctx, rnd, c) {
    const r0 = rnd() * TAU;
    ring(ctx, 3, 0, (a) => {
      const x = Math.cos(a) * 0.38, y = Math.sin(a) * 0.38;
      ell(ctx, x, y + 0.08, 0.26, 0.34, 0, light(c, 0.1));
      ell(ctx, x, y - 0.14, 0.3, 0.17, 0, '#6E5638');
      circ(ctx, x, y - 0.32, 0.05, '#4E3C26');
    }, r0);
  },
  rosette(ctx, rnd, c) {
    const leafC = mix(c, LEAF, 0.45);
    const r0 = rnd() * TAU;
    ring(ctx, 7, 0, (a) => leaf(ctx, a, 0.05, 0.95, 0.26, leafC), r0);
    ring(ctx, 5, 0, (a) => leaf(ctx, a, 0.05, 0.6, 0.2, light(leafC, 0.15)), r0 + 0.4);
    if (!SH) ring(ctx, 7, 0, (a) => { ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); ctx.lineTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8); stroke(ctx, light(leafC, 0.35), 0.04); }, r0);
  },
  galls(ctx, rnd, c) {
    leaf(ctx, rnd() * TAU, 0.1, 0.9, 0.32, LEAF2);
    const r0 = rnd() * TAU;
    ring(ctx, 3, 0, (a) => {
      const x = Math.cos(a) * 0.32, y = Math.sin(a) * 0.32;
      circ(ctx, x, y, 0.36, mix(c, '#8B6A44', 0.45));
      circ(ctx, x - 0.1, y - 0.1, 0.12, light(mix(c, '#8B6A44', 0.45), 0.25));
      circ(ctx, x + 0.12, y + 0.08, 0.04, '#3A3026');
    }, r0);
  },
  pits(ctx, rnd, c) {
    const r0 = rnd() * TAU;
    ring(ctx, 4, 0, (a, i) => {
      const x = Math.cos(a) * 0.42, y = Math.sin(a) * 0.42;
      ell(ctx, x, y, 0.3, 0.36, a, i % 2 ? '#8A5A3A' : '#9C6A48');
      if (i % 2 === 0) ell(ctx, x, y, 0.2, 0.25, a, c);
    }, r0);
  },
  spike(ctx, rnd, c) {
    ring(ctx, 9, 0, (a) => leaf(ctx, a, 0.1, 0.95, 0.12, mix(LEAF3, c, 0.25)), rnd() * TAU);
    const r0 = rnd() * TAU;
    ring(ctx, 5, 0, (a) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 0.72, Math.sin(a) * 0.72); stroke(ctx, c, 0.16);
      circ(ctx, Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.1, light(c, 0.2));
    }, r0);
    circ(ctx, 0, 0, 0.2, c);
  },
  shrub(ctx, rnd, c) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rnd() * 0.4, d = 0.42;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.36, i % 2 ? LEAF : LEAF2);
    }
    circ(ctx, 0, 0, 0.45, LEAF3);
    if (!SH) for (let i = 0; i < 22; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.75;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.08 + rnd() * 0.05, i % 3 ? c : light(c, 0.3));
    }
  },
  seaweed(ctx, rnd, c) {
    const r0 = rnd() * TAU;
    ring(ctx, 5, 0, (a, i) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const ex = Math.cos(a) * 0.95, ey = Math.sin(a) * 0.95;
      const bend = (i % 2 ? 0.3 : -0.3);
      ctx.quadraticCurveTo(Math.cos(a + bend) * 0.6, Math.sin(a + bend) * 0.6, ex, ey);
      stroke(ctx, i % 2 ? c : dark(c, 0.12), 0.2);
      circ(ctx, Math.cos(a + bend * 0.5) * 0.5, Math.sin(a + bend * 0.5) * 0.5, 0.11, light(c, 0.2));
    }, r0);
    circ(ctx, 0, 0, 0.18, dark(c, 0.15));
  },
  chips(ctx, rnd, c) {
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.62;
      ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(rnd() * TAU);
      ctx.beginPath(); ctx.rect(-0.2, -0.08, 0.4, 0.16);
      fill(ctx, i % 3 === 0 ? '#8A3B4E' : i % 3 === 1 ? c : light(c, 0.15));
      ctx.restore();
    }
  },
  bark(ctx, rnd, c) {
    for (let i = 0; i < 4; i++) {
      const a = rnd() * TAU, d = 0.2 + rnd() * 0.3;
      ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(rnd() * TAU);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.5, -0.17, 1.0, 0.34, 0.15) : ctx.rect(-0.5, -0.17, 1, 0.34);
      fill(ctx, i % 2 ? c : dark(c, 0.12));
      if (!SH) { ctx.beginPath(); ctx.moveTo(-0.4, 0); ctx.lineTo(0.4, 0); stroke(ctx, light(c, 0.25), 0.05); }
      ctx.restore();
    }
  },
  madder(ctx, rnd, c) {
    // dug roots curl out from a whorl of narrow leaves
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(Math.cos(a) * 0.4, Math.sin(a) * 0.4, Math.cos(a + 0.8) * 0.8, Math.sin(a + 0.8) * 0.8, Math.cos(a + 0.4) * 0.98, Math.sin(a + 0.4) * 0.98);
      stroke(ctx, i % 2 ? c : dark(c, 0.15), 0.13);
    }
    const r0 = rnd() * TAU;
    ring(ctx, 6, 0, (a) => leaf(ctx, a, 0.05, 0.55, 0.12, LEAF2), r0);
    ring(ctx, 6, 0, (a) => leaf(ctx, a, 0.05, 0.38, 0.1, LEAF3), r0 + 0.5);
    circ(ctx, 0, 0, 0.1, c);
  },
  sumac(ctx, rnd, c) {
    const r0 = rnd() * TAU;
    ring(ctx, 6, 0, (a, i) => {
      for (let k = 0; k < 4; k++) {
        const d = 0.25 + k * 0.17;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        ell(ctx, x - Math.sin(a) * 0.1, y + Math.cos(a) * 0.1, 0.12, 0.06, a + 0.9, i % 2 ? mix(LEAF, c, 0.5) : mix(LEAF2, c, 0.35));
        ell(ctx, x + Math.sin(a) * 0.1, y - Math.cos(a) * 0.1, 0.12, 0.06, a - 0.9, mix(LEAF, c, 0.4));
      }
    }, r0);
    ell(ctx, 0, 0, 0.18, 0.28, r0, '#A0352E');
    if (!SH) circ(ctx, -0.04, -0.06, 0.07, '#C25048');
  },
  hulls(ctx, rnd, c) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rnd() * 0.5, d = i === 6 ? 0 : 0.48;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      circ(ctx, x, y, 0.32, i % 2 ? mix('#4F5A2C', c, 0.5) : c);
      circ(ctx, x - 0.1, y - 0.1, 0.09, light(c, 0.25));
    }
  },
  pad(ctx, rnd, c) {
    const rot = rnd() * TAU;
    ell(ctx, 0, 0, 0.62, 0.92, rot, '#7E9A58');
    ell(ctx, -0.06, -0.06, 0.5, 0.78, rot, '#93AE68');
    if (!SH) {
      for (let i = 0; i < 9; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.55;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        circ(ctx, x, y, 0.11, '#F4F0E8');
        circ(ctx, x + 0.04, y + 0.03, 0.05, c);
      }
    }
  },
  bush(ctx, rnd, c) {
    const leafC = mix(c, LEAF2, 0.45);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + rnd() * 0.3;
      circ(ctx, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.34, i % 2 ? leafC : light(leafC, 0.1));
    }
    circ(ctx, 0, 0, 0.6, light(leafC, 0.05));
    if (!SH) for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.8;
      ell(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.08, 0.045, rnd() * TAU, i % 4 === 0 ? '#D58AA8' : light(leafC, 0.3));
    }
  },
  madderBed(ctx, rnd, c) {
    circ(ctx, 0, 0, 0.98, '#8B6A4C');
    circ(ctx, 0, 0, 0.9, '#9C7A58');
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU, d = 0.2 + rnd() * 0.65;
      ctx.beginPath();
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 0.25, y - 0.1, x + 0.2 + rnd() * 0.2, y + 0.18);
      stroke(ctx, i % 2 ? c : dark(c, 0.15), 0.06);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU, d = i === 8 ? 0 : 0.55;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.save(); ctx.translate(x, y);
      ring(ctx, 6, 0, (b) => leaf(ctx, b, 0.02, 0.24, 0.06, i % 2 ? LEAF2 : LEAF3), rnd());
      ctx.restore();
    }
  },
  grove(ctx, rnd, c) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rnd() * 0.3, d = 0.5;
      ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.scale(0.5, 0.5);
      SHAPES.sumac(ctx, rnd, c);
      ctx.restore();
    }
    ctx.save(); ctx.scale(0.55, 0.55); SHAPES.sumac(ctx, rnd, c); ctx.restore();
  },
  tree(ctx, rnd, c) {
    const canopy = mix('#56683A', c, 0.4);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + rnd() * 0.2;
      circ(ctx, Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.34, i % 2 ? canopy : dark(canopy, 0.08));
    }
    circ(ctx, 0, 0, 0.72, light(canopy, 0.06));
    circ(ctx, -0.12, -0.12, 0.42, light(canopy, 0.14));
    if (!SH) for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.85;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.07, i % 2 ? '#7E8A3A' : c);
    }
  },
  hedge(ctx, rnd, c) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      ctx.save(); ctx.translate(Math.cos(a) * 0.42, Math.sin(a) * 0.42); ctx.scale(0.6, 0.6);
      SHAPES.bush(ctx, rnd, c);
      ctx.restore();
    }
    ctx.save(); ctx.scale(0.55, 0.55); SHAPES.bush(ctx, rnd, c); ctx.restore();
  },
  cactus(ctx, rnd, c) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd() * 0.3;
      ctx.save(); ctx.translate(Math.cos(a) * 0.5, Math.sin(a) * 0.5); ctx.rotate(a + Math.PI / 2); ctx.scale(0.48, 0.48);
      SHAPES.pad(ctx, rnd, c);
      ctx.restore();
    }
    ctx.save(); ctx.scale(0.55, 0.55); SHAPES.pad(ctx, rnd, c); ctx.restore();
    if (!SH) { circ(ctx, 0.1, -0.35, 0.09, '#E7B23C'); circ(ctx, -0.4, 0.15, 0.09, '#E7B23C'); }
  },
  // ---------- landmarks (the very last, biggest things) ----------
  cart(ctx, rnd, c) {
    const rot = (rnd() - 0.5) * 0.5;
    ctx.save(); ctx.rotate(rot);
    // shafts
    ctx.beginPath(); ctx.moveTo(0.6, -0.3); ctx.lineTo(1.0, -0.22); ctx.moveTo(0.6, 0.3); ctx.lineTo(1.0, 0.22); stroke(ctx, '#7A5530', 0.06);
    // wheels
    for (const [x, y] of [[-0.45, -0.58], [0.3, -0.58], [-0.45, 0.58], [0.3, 0.58]]) {
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 0.17, y - 0.07, 0.34, 0.14, 0.05) : ctx.rect(x - 0.17, y - 0.07, 0.34, 0.14); fill(ctx, '#4E3A26');
    }
    // the bed
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.78, -0.5, 1.4, 1.0, 0.08) : ctx.rect(-0.78, -0.5, 1.4, 1.0); fill(ctx, '#9A6C3A');
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.72, -0.44, 1.28, 0.88, 0.06) : ctx.rect(-0.72, -0.44, 1.28, 0.88); fill(ctx, '#B88550');
    if (!SH) for (let k = -0.3; k <= 0.31; k += 0.15) { ctx.beginPath(); ctx.moveTo(-0.7, k); ctx.lineTo(0.54, k); stroke(ctx, 'rgba(90,60,30,.35)', 0.02); }
    // heaped load: straw with the dye plant through it
    const straw = '#E3C567';
    for (let i = 0; i < 9; i++) ell(ctx, -0.55 + (i % 5) * 0.26 + rnd() * 0.06, i < 5 ? -0.16 : 0.18, 0.24, 0.2, rnd(), i % 2 ? straw : light(straw, 0.15));
    if (!SH) for (let i = 0; i < 22; i++) circ(ctx, -0.6 + rnd() * 1.1, -0.34 + rnd() * 0.68, 0.06, i % 3 ? c : light(c, 0.3));
    ctx.restore();
  },
  shed(ctx, rnd, c) {
    const rot = (rnd() - 0.5) * 0.3;
    ctx.save(); ctx.rotate(rot);
    // walls peeking out below the eaves, then the roof seen from above
    ctx.beginPath(); ctx.rect(-0.78, -0.62, 1.56, 1.26); fill(ctx, '#B9A27E');
    ctx.beginPath(); ctx.rect(-0.86, -0.66, 1.72, 0.66); fill(ctx, '#8C5A44');
    ctx.beginPath(); ctx.rect(-0.86, 0, 1.72, 0.66); fill(ctx, '#7A4C3A');
    if (!SH) {
      for (let y = -0.56; y < 0.62; y += 0.13) { if (Math.abs(y) < 0.05) continue; ctx.beginPath(); ctx.moveTo(-0.84, y); ctx.lineTo(0.84, y); stroke(ctx, 'rgba(40,24,16,.25)', 0.022); }
      ctx.beginPath(); ctx.moveTo(-0.88, 0); ctx.lineTo(0.88, 0); stroke(ctx, '#5E3A2A', 0.06);
      // chimney pipe and bunches of drying flowers at the eaves
      circ(ctx, 0.5, -0.32, 0.08, '#5A5550');
      for (let i = 0; i < 7; i++) { const x = -0.72 + i * 0.24; circ(ctx, x, 0.72, 0.08, i % 2 ? c : light(c, 0.25)); circ(ctx, x + 0.05, 0.78, 0.06, dark(c, 0.1)); }
    }
    ctx.restore();
  },
  vat(ctx, rnd, c) {
    circ(ctx, 0, 0, 0.98, '#6E4C2C');
    if (!SH) ring(ctx, 24, 0, (a, i) => { ctx.beginPath(); ctx.arc(0, 0, 0.93, a, a + TAU / 24); ctx.arc(0, 0, 0.8, a + TAU / 24, a, true); ctx.closePath(); fill(ctx, i % 2 ? '#8A6038' : '#7A5432'); });
    ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, TAU); stroke(ctx, '#3E3A36', 0.05);
    ctx.beginPath(); ctx.arc(0, 0, 0.84, 0, TAU); stroke(ctx, '#3E3A36', 0.04);
    circ(ctx, 0, 0, 0.78, dark(c, 0.1));
    circ(ctx, 0.04, 0.05, 0.7, c);
    if (!SH) {
      // the coppery "flower" of foam on the vat, and a stirring stick
      for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.25; circ(ctx, -0.12 + Math.cos(a) * d, -0.1 + Math.sin(a) * d, 0.1, i % 2 ? '#8E6A3A' : '#A88048'); }
      ell(ctx, 0.2, 0.25, 0.28, 0.12, 0.4, light(c, 0.18));
      ctx.beginPath(); ctx.moveTo(-0.7, 0.75); ctx.lineTo(0.45, -0.35); stroke(ctx, '#C8A06A', 0.07);
    }
  },
  oak(ctx, rnd, c) {
    const canopy = mix('#56683A', '#6E7A40', 0.3);
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * TAU + rnd() * 0.2;
      circ(ctx, Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.32, i % 2 ? canopy : dark(canopy, 0.1));
    }
    circ(ctx, 0, 0, 0.74, light(canopy, 0.05));
    for (let i = 0; i < 6; i++) { const a = rnd() * TAU, d = 0.2 + rnd() * 0.35; circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.26, i % 2 ? light(canopy, 0.12) : canopy); }
    if (!SH) for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.86;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      ell(ctx, x, y + 0.02, 0.045, 0.06, 0, light(c, 0.1));
      ell(ctx, x, y - 0.03, 0.05, 0.03, 0, '#6E5638');
    }
  },
  boat(ctx, rnd, c) {
    const rot = -0.5 + (rnd() - 0.5) * 0.4;
    ctx.save(); ctx.rotate(rot);
    const hull = (k, col) => { ctx.beginPath(); ctx.moveTo(-0.98 * k, 0); ctx.quadraticCurveTo(-0.6 * k, -0.5 * k, 0.2, -0.46 * k); ctx.quadraticCurveTo(0.8 * k, -0.4 * k, 0.98 * k, 0); ctx.quadraticCurveTo(0.8 * k, 0.4 * k, 0.2, 0.46 * k); ctx.quadraticCurveTo(-0.6 * k, 0.5 * k, -0.98 * k, 0); fill(ctx, col); };
    hull(1, '#5F7F96');
    hull(0.86, '#A88458');
    if (!SH) {
      for (const x of [-0.25, 0.35]) { ctx.beginPath(); ctx.rect(x - 0.06, -0.38, 0.12, 0.76); fill(ctx, '#C9A472'); }
      for (let i = 0; i < 10; i++) { const x = -0.65 + rnd() * 0.5, y = (rnd() - 0.5) * 0.4; ell(ctx, x, y, 0.16, 0.08, rnd() * TAU, i % 2 ? c : dark(c, 0.15)); }
      for (let i = 0; i < 6; i++) { const x = 0.5 + rnd() * 0.3, y = (rnd() - 0.5) * 0.3; ell(ctx, x, y, 0.12, 0.06, rnd() * TAU, i % 2 ? c : light(c, 0.2)); }
      ctx.beginPath(); ctx.moveTo(-0.1, 0.2); ctx.lineTo(0.9, 0.75); stroke(ctx, '#C9A472', 0.05);
      ell(ctx, 0.9, 0.75, 0.12, 0.05, 0.5, '#C9A472');
    }
    ctx.restore();
  },
};

/** A plant sprite: { canvas, half } where half is the half-size in plant radii. */
export function plantSprite(speciesId, variant, pxRadius) {
  const s = SPECIES[speciesId];
  const c = DYES[s.dye].hex;
  const size = Math.max(8, Math.min(560, Math.ceil(pxRadius * PAD * 2)));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const k = size / (PAD * 2);
  for (const pass of [true, false]) {
    SH = pass;
    const rnd = mulberry32(hashStr(speciesId) + variant * 7919);
    ctx.setTransform(k, 0, 0, k, size / 2 + (pass ? k * 0.05 : 0), size / 2 + (pass ? k * 0.11 : 0));
    SHAPES[s.shape](ctx, rnd, c);
  }
  SH = false;
  return { canvas: cv, half: PAD, box: opaqueBox(cv) };
}

/** The opaque part of a sprite as fractions of its box, found on a small scratch copy (the sprite
 *  itself is never read back). Drawing only this part skips blending the empty margins. */
let scratch = null;
function opaqueBox(src) {
  const N = 48;
  if (!scratch) { scratch = document.createElement('canvas'); scratch.width = scratch.height = N; }
  const sx = scratch.getContext('2d', { willReadFrequently: true });
  sx.clearRect(0, 0, N, N);
  sx.drawImage(src, 0, 0, N, N);
  let data;
  try { data = sx.getImageData(0, 0, N, N).data; } catch { return { x: 0, y: 0, w: 1, h: 1 }; }
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (data[(y * N + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(N - 1, x1 + 1); y1 = Math.min(N - 1, y1 + 1);
  return { x: x0 / N, y: y0 / N, w: (x1 - x0 + 1) / N, h: (y1 - y0 + 1) / N };
}

/** The basket, seen from above: a woven rim around a dark opening. */
export function basketSprite(pxRadius) {
  const size = Math.max(16, Math.min(640, Math.ceil(pxRadius * 2.6)));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const k = size / 2.6;
  ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
  ctx.beginPath(); ctx.arc(0.05, 0.12, 1.12, 0, TAU); ctx.fillStyle = 'rgba(42,38,34,.22)'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 1.12, 0, TAU); ctx.fillStyle = '#C8955A'; ctx.fill();
  // weave: alternating segments around the rim
  for (let i = 0; i < 28; i++) {
    const a0 = (i / 28) * TAU, a1 = ((i + 1) / 28) * TAU;
    ctx.beginPath(); ctx.arc(0, 0, 1.1, a0, a1); ctx.arc(0, 0, i % 2 ? 0.98 : 1.02, a1, a0, true); ctx.closePath();
    ctx.fillStyle = i % 2 ? '#D8A86C' : '#B9864D'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, 0.98, 0, TAU); ctx.lineWidth = 0.03; ctx.strokeStyle = '#9A6C3A'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 0.94, 0, TAU); ctx.fillStyle = '#5E4128'; ctx.fill();
  ctx.beginPath(); ctx.arc(0.04, 0.06, 0.86, 0, TAU); ctx.fillStyle = '#4A3220'; ctx.fill();
  // inner weave lines
  ctx.strokeStyle = 'rgba(255,230,190,.12)'; ctx.lineWidth = 0.025;
  for (let rr = 0.3; rr < 0.86; rr += 0.18) { ctx.beginPath(); ctx.arc(0.04, 0.06, rr, 0, TAU); ctx.stroke(); }
  // handle (a gentle arc across)
  ctx.beginPath(); ctx.ellipse(0, -0.02, 1.0, 0.24, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.lineWidth = 0.1; ctx.strokeStyle = 'rgba(42,38,34,.18)'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, -0.08, 1.0, 0.24, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.lineWidth = 0.09; ctx.strokeStyle = '#C8955A'; ctx.stroke();
  return { canvas: cv, half: 1.3 };
}

// ---------- ground ----------
export const GROUNDS = {
  meadow: { base: '#B4C98A', edge: '#93AE6C', out: '#9DB777', decor: ['tuft', 'tuft', 'tuft', 'speck'], tuft: '#9DB574', speck: '#F4EFE4' },
  shore: { base: '#E8D9B4', edge: '#D7C496', out: '#9CC3C4', decor: ['ripple', 'pebble', 'shell'], tuft: '#D3C092', speck: '#F7F1E4', water: '#9CC3C4', rocks: '#D4C6A6' },
  forest: { base: '#8FA06A', edge: '#6F8250', out: '#6C7E4E', decor: ['leafy', 'moss', 'leafy', 'tuft'], tuft: '#7E9158', speck: '#C49A5C' },
  terraces: { base: '#BFC48E', edge: '#A5AB73', out: '#A8AE78', decor: ['tuft', 'speck'], tuft: '#A7AE74', speck: '#EFE6D2', wall: '#C9B48E', band: '#B5BB83' },
  cactus: { base: '#E4C7A0', edge: '#D3B184', out: '#D6B78E', decor: ['gravel', 'gravel', 'stone'], tuft: '#CFAF86', speck: '#B99470' },
};

export function decorSprite(kind, gr, px) {
  const size = Math.max(6, Math.ceil(px * 2));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.setTransform(size / 2, 0, 0, size / 2, size / 2, size / 2);
  const rnd = mulberry32(hashStr(kind));
  SH = false;
  if (kind === 'tuft') {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.35;
      ctx.beginPath(); ctx.moveTo(0, 0.6); ctx.quadraticCurveTo(Math.cos(a) * 0.3, 0.2, Math.cos(a) * 0.8, 0.6 + Math.sin(a) * 1.0);
      stroke(ctx, i % 2 ? gr.tuft : dark(gr.tuft, 0.1), 0.12);
    }
  } else if (kind === 'speck') {
    for (let i = 0; i < 4; i++) circ(ctx, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, 0.12, gr.speck);
  } else if (kind === 'ripple') {
    for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.moveTo(-0.9, k * 0.4 - 0.1); ctx.quadraticCurveTo(0, k * 0.4 - 0.45, 0.9, k * 0.4 - 0.1); stroke(ctx, gr.tuft, 0.1); }
  } else if (kind === 'pebble') {
    ell(ctx, 0, 0, 0.5, 0.36, 0.3, '#C9C0AE'); ell(ctx, -0.1, -0.08, 0.2, 0.12, 0.3, '#DCD4C4');
  } else if (kind === 'shell') {
    ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.arc(0, 0.1, 0.5, Math.PI * 1.1, Math.PI * 1.9); ctx.closePath(); fill(ctx, '#F2D8C6');
  } else if (kind === 'leafy') {
    for (let i = 0; i < 3; i++) leaf(ctx, rnd() * TAU, 0, 0.9, 0.3, ['#B07A3C', '#9C6A30', '#C49A5C'][i]);
  } else if (kind === 'moss') {
    for (let i = 0; i < 5; i++) circ(ctx, (rnd() - 0.5) * 1.0, (rnd() - 0.5) * 0.8, 0.32, i % 2 ? '#7D9450' : '#879E58');
  } else if (kind === 'gravel') {
    for (let i = 0; i < 6; i++) circ(ctx, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4, 0.1 + rnd() * 0.08, i % 2 ? gr.speck : '#EAD6B8');
  } else if (kind === 'stone') {
    ell(ctx, 0, 0, 0.7, 0.5, 0.2, '#C4A882'); ell(ctx, -0.15, -0.12, 0.3, 0.18, 0.2, '#D7BF9C');
  }
  return cv;
}

/** A small, cheap copy of a sprite for plants that are tiny on screen. */
export function shrinkSprite(sp, px) {
  const size = Math.max(6, Math.min(sp.canvas.width, Math.ceil(px)));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sp.canvas, 0, 0, size, size);
  return { canvas: cv, half: sp.half, box: sp.box };
}

/** The neighbor's goat, side on, in two steps of a walk. Unit: half-height of the sprite box. */
export function goatSprite(px, frame) {
  const size = Math.max(16, Math.ceil(px * 2));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.setTransform(size / 2, 0, 0, size / 2, size / 2, size / 2);
  SH = false;
  ell(ctx, 0, 0.78, 0.62, 0.12, 0, 'rgba(42,38,34,.18)');
  const coat = '#F1EADB', shade = '#D9CDB6', hoof = '#5E5248';
  const legs = frame ? [[-0.42, 0.06], [-0.22, -0.06], [0.22, 0.06], [0.42, -0.06]] : [[-0.42, -0.06], [-0.22, 0.06], [0.22, -0.06], [0.42, 0.06]];
  for (const [x, dx] of legs) { ctx.beginPath(); ctx.moveTo(x, 0.2); ctx.lineTo(x + dx, 0.7); stroke(ctx, shade, 0.11); circ(ctx, x + dx, 0.71, 0.06, hoof); }
  ell(ctx, -0.02, 0.08, 0.6, 0.33, 0, coat);
  ell(ctx, -0.1, 0.18, 0.42, 0.16, 0, '#E6DCC8');
  // tail
  ell(ctx, -0.6, -0.12, 0.08, 0.14, -0.6, coat);
  // neck and head
  ell(ctx, 0.5, -0.14, 0.16, 0.26, 0.5, coat);
  ell(ctx, 0.7, -0.36, 0.22, 0.16, 0.35, coat);
  ell(ctx, 0.86, -0.28, 0.1, 0.08, 0.3, '#E8C9B8');
  // ear, horns, eye, beard
  ell(ctx, 0.56, -0.38, 0.14, 0.05, -0.6, shade);
  ctx.beginPath(); ctx.moveTo(0.62, -0.5); ctx.quadraticCurveTo(0.56, -0.72, 0.44, -0.74); stroke(ctx, '#A08C6E', 0.06);
  circ(ctx, 0.74, -0.4, 0.035, '#2A2622');
  ctx.beginPath(); ctx.moveTo(0.8, -0.22); ctx.lineTo(0.77, -0.08); stroke(ctx, shade, 0.05);
  // a little bell on a ribbon
  circ(ctx, 0.5, 0.02, 0.06, '#E2B04A');
  return cv;
}

/** A sparkly find, drawn in a unit circle: a wide brim, a breeze or a lost spindle. */
export function findSprite(kind, px) {
  const size = Math.max(12, Math.ceil(px * 2));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.setTransform(size / 2, 0, 0, size / 2, size / 2, size / 2);
  SH = false;
  const glow = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
  glow.addColorStop(0, 'rgba(255,244,200,.95)'); glow.addColorStop(0.55, 'rgba(255,226,140,.45)'); glow.addColorStop(1, 'rgba(255,226,140,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
  if (kind === 'brim') {
    ell(ctx, 0, 0.05, 0.62, 0.42, 0, '#D8B46A');
    ell(ctx, 0, 0.05, 0.62, 0.42, 0, '#D8B46A');
    ell(ctx, 0, -0.02, 0.32, 0.24, 0, '#C79A4E');
    ctx.beginPath(); ctx.ellipse(0, -0.02, 0.33, 0.25, 0, 0.2, Math.PI - 0.2); stroke(ctx, '#B8433A', 0.08);
  } else if (kind === 'breeze') {
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-0.05 + k * 0.05, 0.05 - k * 0.12, 0.5 - k * 0.12, Math.PI * 1.05, Math.PI * 1.95); stroke(ctx, k === 1 ? '#7FA7B8' : '#9DC0CC', 0.08); }
    leaf(ctx, -0.6, 0.12, 0.4, 0.12, '#88A55E');
  } else {
    ctx.save(); ctx.rotate(-0.6);
    ctx.beginPath(); ctx.moveTo(0, -0.75); ctx.lineTo(0, 0.75); stroke(ctx, '#B88550', 0.09);
    ell(ctx, 0, -0.05, 0.3, 0.3, 0, '#B8433A');
    for (let k = -0.2; k < 0.15; k += 0.1) { ctx.beginPath(); ctx.moveTo(-0.28, k); ctx.lineTo(0.28, k + 0.06); stroke(ctx, '#D86A5E', 0.035); }
    ell(ctx, 0, 0.42, 0.26, 0.07, 0, '#8C6512');
    ctx.restore();
  }
  // four-point twinkle
  ctx.beginPath(); ctx.moveTo(0.62, -0.88); ctx.lineTo(0.68, -0.68); ctx.lineTo(0.88, -0.62); ctx.lineTo(0.68, -0.56); ctx.lineTo(0.62, -0.36); ctx.lineTo(0.56, -0.56); ctx.lineTo(0.36, -0.62); ctx.lineTo(0.56, -0.68); ctx.closePath();
  ctx.fillStyle = '#FFF7DC'; ctx.fill();
  return cv;
}
