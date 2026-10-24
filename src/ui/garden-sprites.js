// ui/garden-sprites.js — The Dye Garden's papercut sprites for plants, the
// basket and ground bits (ported from proto/garden/sprites.js; DOM canvases,
// so it lives in ui/, not puzzles/). The Garden Path adds shapes for its new
// plants and landmarks, four grounds (river, cottage, snow, yard) and the cat;
// the prototype's shapes are unchanged.
// Each sprite is drawn once into an offscreen canvas (two passes: a soft
// paper shadow, then the shapes) and blitted with drawImage every frame.
import { SPECIES, DYES, mulberry32, hashStr } from '../puzzles/garden.js';

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
const i0 = (a) => Math.round(a * 7) % 2 === 0; // alternate two leaf greens around a ring

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

  // ---------- the Garden Path's plants ----------
  buttons(ctx, rnd, c) {
    // tansy: feathery leaves under flat clusters of little golden buttons
    ring(ctx, 6, 0, (a) => leaf(ctx, a, 0.15, 0.85, 0.16, LEAF2), rnd() * TAU);
    for (let i = 0; i < 11; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.5;
      circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.17, i % 3 ? c : dark(c, 0.12));
      if (!SH) circ(ctx, Math.cos(a) * d - 0.04, Math.sin(a) * d - 0.04, 0.06, light(c, 0.35));
    }
  },
  frilly(ctx, rnd, c) {
    // French marigold: a small frilled head, rust ring around gold
    ring(ctx, 6, 0, (a) => leaf(ctx, a + 0.2, 0.25, 0.7, 0.18, LEAF2), rnd() * TAU);
    const r0 = rnd() * TAU;
    ring(ctx, 14, 0, (a) => ell(ctx, Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0.2, 0.16, a, '#B5502A'), r0);
    ring(ctx, 10, 0, (a) => circ(ctx, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.2, c), r0 + 0.2);
    circ(ctx, 0, 0, 0.18, light(c, 0.2));
  },
  fruticose(ctx, rnd, c) {
    // orchil: little gray-green branching tufts
    const base = mix(c, '#A9B49A', 0.6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rnd() * 0.4;
      ctx.beginPath(); ctx.moveTo(0, 0);
      const x = Math.cos(a) * 0.75, y = Math.sin(a) * 0.75;
      ctx.quadraticCurveTo(Math.cos(a + 0.4) * 0.4, Math.sin(a + 0.4) * 0.4, x, y);
      stroke(ctx, i % 2 ? base : light(base, 0.15), 0.14);
      circ(ctx, x, y, 0.1, light(base, 0.25));
    }
    circ(ctx, 0, 0, 0.2, base);
    if (!SH) for (let i = 0; i < 5; i++) { const a = rnd() * TAU, d = 0.3 + rnd() * 0.3; circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.06, c); }
  },
  susan(ctx, rnd, c) {
    ring(ctx, 4, 0, (a) => leaf(ctx, a + 0.6, 0.2, 0.85, 0.24, LEAF2));
    const r0 = rnd() * TAU;
    ring(ctx, 13, 0, (a) => ell(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.32, 0.11, a, '#E7B437'), r0);
    circ(ctx, 0, 0, 0.27, '#4A2E1C');
    if (!SH) circ(ctx, -0.06, -0.06, 0.1, mix('#4A2E1C', c, 0.4));
  },
  thistle(ctx, rnd, c) {
    // safflower: spiny bracts and an orange-red tuft
    ring(ctx, 7, 0, (a) => leaf(ctx, a, 0.2, 0.8, 0.14, mix(LEAF, '#9AA86A', 0.4)), rnd() * TAU);
    circ(ctx, 0, 0, 0.4, '#7E9A58');
    ring(ctx, 10, 0, (a) => ell(ctx, Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.14, 0.06, a, '#93AE68'), rnd() * TAU);
    const r0 = rnd() * TAU;
    ring(ctx, 12, 0, (a, i) => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 0.32, Math.sin(a) * 0.32); stroke(ctx, i % 2 ? '#E8892E' : c, 0.09); }, r0);
    circ(ctx, 0, 0, 0.16, '#E8892E');
  },
  plume(ctx, rnd, c) {
    // goldenrod: arching sprays of tiny yellow flowers
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rnd() * 0.5;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5, Math.cos(a + 0.5) * 0.9, Math.sin(a + 0.5) * 0.9);
      stroke(ctx, LEAF2, 0.06);
      for (let k = 2; k <= 9; k++) {
        const u = k / 9, ang = a + 0.5 * u * u;
        circ(ctx, Math.cos(ang) * 0.9 * u, Math.sin(ang) * 0.9 * u, 0.1 - u * 0.03, k % 2 ? c : light(c, 0.2));
      }
    }
  },
  borage(ctx, rnd, c) {
    // alkanet: a hairy rosette with small bright blue flowers; its dye is in the roots
    const r0 = rnd() * TAU;
    ring(ctx, 7, 0, (a) => leaf(ctx, a, 0.05, 0.9, 0.24, i0(a) ? LEAF : '#7C9A5C'), r0);
    if (!SH) {
      for (let i = 0; i < 6; i++) {
        const a = rnd() * TAU, d = 0.12 + rnd() * 0.35;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        ring(ctx, 5, 0, (b) => circ(ctx, x + Math.cos(b) * 0.07, y + Math.sin(b) * 0.07, 0.06, '#3E6FC0'), rnd());
        circ(ctx, x, y, 0.04, '#F2E6A0');
      }
      ctx.beginPath(); ctx.moveTo(-0.1, 0.1); ctx.quadraticCurveTo(0.3, 0.5, 0.75, 0.62); stroke(ctx, c, 0.09);
    }
  },
  polygonum(ctx, rnd, c) {
    // Japanese indigo: an oval-leaved clump with little pink flower spikes
    const leafC = mix(LEAF, c, 0.25);
    const r0 = rnd() * TAU;
    ring(ctx, 9, 0, (a) => ell(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.36, 0.2, a, rnd() < 0.5 ? leafC : light(leafC, 0.1)), r0);
    circ(ctx, 0, 0, 0.36, dark(leafC, 0.05));
    if (!SH) for (let i = 0; i < 4; i++) {
      const a = r0 + (i / 4) * TAU + 0.3;
      for (let k = 0; k < 4; k++) circ(ctx, Math.cos(a) * (0.15 + k * 0.1), Math.sin(a) * (0.15 + k * 0.1), 0.06, k % 2 ? '#E59AB4' : '#D47C9C');
    }
  },
  hibiscus(ctx, rnd, c) {
    ring(ctx, 5, 0, (a) => leaf(ctx, a + 0.3, 0.3, 0.75, 0.24, LEAF2), rnd() * TAU);
    const r0 = rnd() * TAU;
    ring(ctx, 5, 0, (a) => ell(ctx, Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.42, 0.32, a, c), r0);
    ring(ctx, 5, 0, (a) => ell(ctx, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.28, 0.2, a, light(c, 0.15)), r0);
    circ(ctx, 0, 0, 0.16, dark(c, 0.35));
    if (!SH) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.3, -0.25); stroke(ctx, '#F2D46A', 0.05); circ(ctx, 0.3, -0.25, 0.05, '#F2D46A'); }
  },
  hedgeapple(ctx, rnd, c) {
    // Osage orange: bumpy green fruit on a shaving of yellow wood
    ell(ctx, 0.1, 0.35, 0.6, 0.18, 0.2, light(c, 0.1));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + rnd() * 0.4, x = Math.cos(a) * 0.36, y = Math.sin(a) * 0.32 - 0.05;
      circ(ctx, x, y, 0.36, '#A5B85A');
      if (!SH) for (let k = 0; k < 9; k++) { const b = rnd() * TAU, d = Math.sqrt(rnd()) * 0.3; circ(ctx, x + Math.cos(b) * d, y + Math.sin(b) * d, 0.07, k % 2 ? '#B9C96E' : '#94A84C'); }
    }
  },
  elder(ctx, rnd, c) {
    const r0 = rnd() * TAU;
    ring(ctx, 7, 0, (a) => { leaf(ctx, a, 0.2, 0.8, 0.16, LEAF2); }, r0);
    ring(ctx, 3, 0, (a) => {
      const x = Math.cos(a) * 0.32, y = Math.sin(a) * 0.32;
      for (let k = 0; k < 9; k++) { const b = rnd() * TAU, d = Math.sqrt(rnd()) * 0.24; circ(ctx, x + Math.cos(b) * d, y + Math.sin(b) * d, 0.07, k % 3 ? dark(c, 0.45) : c); }
    }, r0 + 0.5);
  },
  rhubarb(ctx, rnd, c) {
    // rhubarb: broad crinkled leaves on red stalks, and the dug golden root
    const r0 = rnd() * TAU;
    ring(ctx, 4, 0, (a) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 0.45, Math.sin(a) * 0.45); stroke(ctx, '#B83A3E', 0.1);
      ell(ctx, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.38, 0.32, a, '#6E8F4E');
      if (!SH) ell(ctx, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.2, 0.14, a, '#80A05C');
    }, r0);
    ell(ctx, 0, 0, 0.2, 0.3, r0 + 1, c);
    if (!SH) ell(ctx, -0.04, -0.06, 0.08, 0.14, r0 + 1, light(c, 0.3));
  },
  poke(ctx, rnd, c) {
    // pokeweed: magenta stems with drooping clusters of dark berries
    const r0 = rnd() * TAU;
    ring(ctx, 5, 0, (a) => leaf(ctx, a + 0.3, 0.2, 0.75, 0.24, LEAF), r0);
    ring(ctx, 3, 0, (a) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 0.7, Math.sin(a) * 0.7); stroke(ctx, c, 0.07);
      for (let k = 0; k < 6; k++) circ(ctx, Math.cos(a) * (0.3 + k * 0.08) + Math.sin(a) * 0.06 * (k % 2 ? 1 : -1), Math.sin(a) * (0.3 + k * 0.08) - Math.cos(a) * 0.06 * (k % 2 ? 1 : -1), 0.08, '#3E1C36');
    }, r0 + 0.6);
    circ(ctx, 0, 0, 0.1, c);
  },
  blocks(ctx, rnd, c) {
    // cutch: dark cakes of dried extract
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU, d = i ? 0.4 : 0;
      ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(rnd() * TAU);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.26, -0.2, 0.52, 0.4, 0.06) : ctx.rect(-0.26, -0.2, 0.52, 0.4);
      fill(ctx, i % 2 ? c : dark(c, 0.18));
      if (!SH) { ctx.beginPath(); ctx.rect(-0.2, -0.14, 0.2, 0.1); fill(ctx, light(c, 0.15)); }
      ctx.restore();
    }
  },
  drift(ctx, rnd, c) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd() * 0.3;
      ctx.save(); ctx.translate(Math.cos(a) * 0.5, Math.sin(a) * 0.5); ctx.scale(0.5, 0.5); SHAPES.plume(ctx, rnd, c); ctx.restore();
    }
    ctx.save(); ctx.scale(0.55, 0.55); SHAPES.plume(ctx, rnd, c); ctx.restore();
  },
  eldertree(ctx, rnd, c) {
    const canopy = '#6A8A4A';
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + rnd() * 0.2; circ(ctx, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.36, i % 2 ? canopy : dark(canopy, 0.08)); }
    circ(ctx, 0, 0, 0.7, light(canopy, 0.06));
    if (!SH) for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.7, x = Math.cos(a) * d, y = Math.sin(a) * d;
      for (let k = 0; k < 6; k++) circ(ctx, x + (rnd() - 0.5) * 0.14, y + (rnd() - 0.5) * 0.14, 0.04, k % 2 ? dark(c, 0.45) : c);
    }
  },
  osagetree(ctx, rnd, c) {
    const canopy = '#5E7A3C';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + rnd() * 0.2; circ(ctx, Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.33, i % 2 ? canopy : dark(canopy, 0.1)); }
    circ(ctx, 0, 0, 0.72, light(canopy, 0.05));
    if (!SH) for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.8; circ(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.09, '#B9C96E'); }
  },
  // ---------- the Garden Path's landmarks ----------
  hive(ctx, rnd, c) {
    // a straw skep on a stand, seen from above, in a ring of goldenrod
    ring(ctx, 10, 0, (a) => { ctx.save(); ctx.translate(Math.cos(a) * 0.78, Math.sin(a) * 0.78); ctx.scale(0.24, 0.24); SHAPES.plume(ctx, rnd, c); ctx.restore(); }, rnd());
    ctx.beginPath(); ctx.rect(-0.62, -0.62, 1.24, 1.24); fill(ctx, '#8A6A44');
    for (let k = 5; k >= 1; k--) circ(ctx, 0, 0, 0.11 * k + 0.02, k % 2 ? '#D9B466' : '#C59E52');
    if (!SH) {
      circ(ctx, 0, 0, 0.06, '#6E5434');
      for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = 0.7 + rnd() * 0.25; const x = Math.cos(a) * d, y = Math.sin(a) * d; ell(ctx, x, y, 0.05, 0.035, a, '#3A2E1C'); ell(ctx, x + 0.02, y, 0.03, 0.02, a, '#F2C14E'); }
    }
  },
  barrow(ctx, rnd, c) {
    const rot = (rnd() - 0.5) * 0.5;
    ctx.save(); ctx.rotate(rot);
    ctx.beginPath(); ctx.moveTo(-0.95, -0.32); ctx.lineTo(-0.45, -0.3); ctx.moveTo(-0.95, 0.32); ctx.lineTo(-0.45, 0.3); stroke(ctx, '#7A5530', 0.07);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0.55, -0.12, 0.3, 0.24, 0.06) : ctx.rect(0.55, -0.12, 0.3, 0.24); fill(ctx, '#4E3A26');
    ctx.beginPath(); ctx.moveTo(-0.55, -0.5); ctx.lineTo(0.62, -0.38); ctx.lineTo(0.62, 0.38); ctx.lineTo(-0.55, 0.5); ctx.closePath(); fill(ctx, '#5F7F96');
    ctx.beginPath(); ctx.moveTo(-0.48, -0.42); ctx.lineTo(0.55, -0.32); ctx.lineTo(0.55, 0.32); ctx.lineTo(-0.48, 0.42); ctx.closePath(); fill(ctx, '#4D6C82');
    for (let i = 0; i < 14; i++) {
      const x = -0.4 + rnd() * 0.85, y = (rnd() - 0.5) * 0.62;
      circ(ctx, x, y, 0.13, i % 3 ? c : '#B5502A');
      if (!SH) circ(ctx, x, y, 0.05, light(c, 0.3));
    }
    ctx.restore();
  },
  scarecrow(ctx, rnd, c) {
    // a scarecrow seen from above: a straw hat, outstretched arms in a woad-blue coat, and its shadow pole
    ctx.beginPath(); ctx.moveTo(0, 0.2); ctx.lineTo(0, 0.95); stroke(ctx, '#7A5530', 0.08);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.95, -0.12, 1.9, 0.24, 0.1) : ctx.rect(-0.95, -0.12, 1.9, 0.24); fill(ctx, c);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.36, -0.3, 0.72, 0.7, 0.14) : ctx.rect(-0.36, -0.3, 0.72, 0.7); fill(ctx, dark(c, 0.1));
    if (!SH) {
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(sx * 0.95, 0); ctx.lineTo(sx * (1.06 + k * 0.02), -0.12 + k * 0.08); stroke(ctx, '#E3C567', 0.04); }
      circ(ctx, -0.12, 0.1, 0.06, '#E3C567'); circ(ctx, 0.14, 0.24, 0.05, '#B8433A');
    }
    circ(ctx, 0, -0.38, 0.42, '#D9B466');
    circ(ctx, 0, -0.38, 0.24, '#C59E52');
    if (!SH) { ctx.beginPath(); ctx.arc(0, -0.38, 0.32, 0, TAU); stroke(ctx, '#B8433A', 0.05); ell(ctx, 0.62, -0.5, 0.08, 0.04, 0.4, '#2A2622'); ell(ctx, 0.7, -0.44, 0.05, 0.025, 0.2, '#2A2622'); }
  },
  well(ctx, rnd, c) {
    // a round stone well with its little roof beam, and buckets of walnut hulls soaking beside it
    circ(ctx, -0.1, 0, 0.72, '#A8A094');
    if (!SH) ring(ctx, 14, 0, (a, i) => { ctx.beginPath(); ctx.arc(-0.1, 0, 0.72, a, a + TAU / 14 - 0.03); ctx.arc(-0.1, 0, 0.52, a + TAU / 14 - 0.03, a, true); ctx.closePath(); fill(ctx, i % 2 ? '#B8B0A2' : '#9C9486'); });
    circ(ctx, -0.1, 0, 0.5, '#3E4A52');
    circ(ctx, -0.06, 0.04, 0.38, '#4F6470');
    ctx.beginPath(); ctx.rect(-0.95, -0.08, 1.7, 0.16); fill(ctx, '#7A5530');
    ctx.beginPath(); ctx.rect(-0.55, -0.42, 0.18, 0.84); fill(ctx, '#8C6640');
    for (const [x, y] of [[0.72, 0.5], [0.78, -0.42]]) {
      circ(ctx, x, y, 0.22, '#8A7A66'); circ(ctx, x, y, 0.17, '#5A4630');
      if (!SH) for (let k = 0; k < 4; k++) circ(ctx, x + (rnd() - 0.5) * 0.18, y + (rnd() - 0.5) * 0.18, 0.06, k % 2 ? c : mix('#4F5A2C', c, 0.5));
    }
  },
  bales(ctx, rnd, c) {
    // a stack of rectangular hay bales, bundles of weld drying on top
    const bale = (x, y, w, h, rot) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, 0.05) : ctx.rect(-w / 2, -h / 2, w, h); fill(ctx, '#D9BC6A');
      if (!SH) { ctx.beginPath(); ctx.rect(-w / 2 + 0.03, -h / 2 + 0.03, w - 0.06, h * 0.3); fill(ctx, '#E6CD84'); for (const u of [-0.3, 0.3]) { ctx.beginPath(); ctx.moveTo(u * w, -h / 2); ctx.lineTo(u * w, h / 2); stroke(ctx, '#9C7E3A', 0.025); } }
      ctx.restore();
    };
    bale(-0.42, -0.42, 0.78, 0.5, 0.05); bale(0.42, -0.4, 0.78, 0.5, -0.04);
    bale(-0.42, 0.18, 0.78, 0.5, -0.03); bale(0.42, 0.2, 0.78, 0.5, 0.06);
    bale(0, 0.68, 0.78, 0.46, 0.02);
    bale(0, -0.12, 0.8, 0.5, 0.0);
    if (!SH) for (let i = 0; i < 4; i++) { const x = -0.3 + i * 0.2, y = -0.16 + (rnd() - 0.5) * 0.1; ctx.beginPath(); ctx.moveTo(x, y - 0.2); ctx.lineTo(x + 0.05, y + 0.2); stroke(ctx, '#7E9A58', 0.06); for (let k = 0; k < 4; k++) circ(ctx, x + 0.012 * k, y - 0.18 + k * 0.08, 0.05, c); }
  },
  dyehouse(ctx, rnd, c) {
    // the dye-house roof seen from above, a chimney, skeins drying on a rail, and two indigo vats in the yard
    const rot = (rnd() - 0.5) * 0.12;
    ctx.save(); ctx.rotate(rot);
    ctx.beginPath(); ctx.rect(-0.82, -0.66, 1.64, 1.02); fill(ctx, '#C8B48E');
    ctx.beginPath(); ctx.rect(-0.9, -0.72, 1.8, 0.56); fill(ctx, '#9A5A40');
    ctx.beginPath(); ctx.rect(-0.9, -0.16, 1.8, 0.56); fill(ctx, '#874C36');
    if (!SH) {
      for (let y = -0.66; y < 0.38; y += 0.11) { if (Math.abs(y + 0.16) < 0.04) continue; ctx.beginPath(); ctx.moveTo(-0.88, y); ctx.lineTo(0.88, y); stroke(ctx, 'rgba(40,24,16,.22)', 0.02); }
      ctx.beginPath(); ctx.moveTo(-0.92, -0.16); ctx.lineTo(0.92, -0.16); stroke(ctx, '#5E3A2A', 0.06);
      ctx.beginPath(); ctx.rect(0.42, -0.6, 0.18, 0.22); fill(ctx, '#7A6A5E');
      // skeins on a rail along the front
      ctx.beginPath(); ctx.moveTo(-0.85, 0.52); ctx.lineTo(0.2, 0.52); stroke(ctx, '#7A5530', 0.04);
      ['#2E3F6E', '#B8433A', '#DCC236', '#4F7BAE', '#E89A2C', '#8A3F7E'].forEach((col, k) => ell(ctx, -0.76 + k * 0.17, 0.62, 0.06, 0.12, 0, col));
    }
    for (const [x, y] of [[0.52, 0.66], [0.82, 0.48]]) { circ(ctx, x, y, 0.2, '#6E4C2C'); circ(ctx, x, y, 0.15, c); if (!SH) circ(ctx, x - 0.04, y - 0.04, 0.05, '#A88048'); }
    ctx.restore();
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
  // the Garden Path's grounds
  river: { base: '#AFC88E', edge: '#8FAE70', out: '#98B67A', decor: ['tuft', 'tuft', 'speck', 'reeds'], tuft: '#97B06E', speck: '#F4EFE4', water: '#8DBCC8' },
  cottage: { base: '#B7C98C', edge: '#97AE70', out: '#A3BA7C', decor: ['tuft', 'bloom', 'tuft', 'speck'], tuft: '#9DB574', speck: '#F7F1E4' },
  snow: { base: '#DCE2DE', edge: '#C3CCC8', out: '#CBD3D0', decor: ['snowpatch', 'snowpatch', 'twig', 'speck'], tuft: '#AEB8A8', speck: '#FFFFFF' },
  yard: { base: '#CDBB9A', edge: '#B39F7C', out: '#BFAC8A', decor: ['cobble', 'cobble', 'speck', 'tuft'], tuft: '#A9A070', speck: '#E8DCC4' },
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
  } else if (kind === 'reeds') {
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-0.3 + i * 0.2, 0.7); ctx.lineTo(-0.4 + i * 0.25, -0.6); stroke(ctx, i % 2 ? '#7E9A58' : '#6E8A4A', 0.1); }
    ell(ctx, -0.05, -0.55, 0.07, 0.2, 0, '#8A5A3A');
  } else if (kind === 'bloom') {
    const cols = ['#E8A0B4', '#F2D46A', '#B49AD8'];
    for (let i = 0; i < 3; i++) { const x = (rnd() - 0.5) * 1.1, y = (rnd() - 0.5) * 1.1; ring(ctx, 5, 0, (a) => circ(ctx, x + Math.cos(a) * 0.14, y + Math.sin(a) * 0.14, 0.11, cols[i]), rnd()); circ(ctx, x, y, 0.07, '#F7F1E4'); }
  } else if (kind === 'snowpatch') {
    ell(ctx, 0, 0, 0.95, 0.55, 0.2, '#F4F7F6'); ell(ctx, 0.25, -0.12, 0.45, 0.25, 0.2, '#FFFFFF');
  } else if (kind === 'twig') {
    ctx.beginPath(); ctx.moveTo(-0.7, 0.3); ctx.lineTo(0.6, -0.2); ctx.moveTo(0, 0.07); ctx.lineTo(0.3, 0.4); stroke(ctx, '#7A6A5A', 0.09);
  } else if (kind === 'cobble') {
    for (let i = 0; i < 4; i++) ell(ctx, (i % 2 ? 0.35 : -0.35) + (rnd() - 0.5) * 0.1, (i < 2 ? -0.35 : 0.35), 0.32, 0.26, rnd(), i % 2 ? '#BCA888' : '#C6B392');
  }
  return cv;
}

/** The napping cat, seen from above: curled up asleep (frame 0) or up on its paws (frame 1, facing right). */
export function catSprite(px, frame) {
  const size = Math.max(16, Math.ceil(px * 2));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.setTransform(size / 2, 0, 0, size / 2, size / 2, size / 2);
  SH = false;
  const fur = '#E3A55A', stripe = '#C27E3A', pale = '#F4D9AE';
  ell(ctx, 0.05, 0.12, 0.8, 0.62, 0, 'rgba(42,38,34,.18)');
  if (!frame) {
    circ(ctx, 0, 0, 0.62, fur);
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(0, 0, 0.3 + k * 0.08, -0.6 + k * 0.2, 0.9 + k * 0.2); stroke(ctx, stripe, 0.05); }
    ctx.beginPath(); ctx.arc(0, 0, 0.62, 0.4, 2.6); stroke(ctx, stripe, 0.16);
    circ(ctx, -0.32, -0.28, 0.27, fur);
    ctx.beginPath(); ctx.moveTo(-0.52, -0.42); ctx.lineTo(-0.5, -0.66); ctx.lineTo(-0.36, -0.5); ctx.closePath(); fill(ctx, fur);
    ctx.beginPath(); ctx.moveTo(-0.22, -0.5); ctx.lineTo(-0.1, -0.68); ctx.lineTo(-0.06, -0.44); ctx.closePath(); fill(ctx, fur);
    ctx.beginPath(); ctx.moveTo(-0.44, -0.27); ctx.quadraticCurveTo(-0.39, -0.23, -0.34, -0.27); stroke(ctx, '#5A3A1E', 0.03);
    ctx.beginPath(); ctx.moveTo(-0.28, -0.22); ctx.quadraticCurveTo(-0.23, -0.18, -0.18, -0.22); stroke(ctx, '#5A3A1E', 0.03);
    ell(ctx, -0.3, -0.16, 0.06, 0.04, 0, pale);
  } else {
    ctx.beginPath(); ctx.moveTo(-0.55, 0); ctx.quadraticCurveTo(-0.9, -0.1, -0.85, -0.45); stroke(ctx, fur, 0.14);
    ell(ctx, -0.05, 0, 0.55, 0.3, 0, fur);
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-0.3 + k * 0.2, -0.28); ctx.lineTo(-0.25 + k * 0.2, 0.28); stroke(ctx, stripe, 0.05); }
    circ(ctx, 0.55, -0.02, 0.26, fur);
    ctx.beginPath(); ctx.moveTo(0.48, -0.2); ctx.lineTo(0.52, -0.44); ctx.lineTo(0.64, -0.22); ctx.closePath(); fill(ctx, fur);
    ctx.beginPath(); ctx.moveTo(0.48, 0.16); ctx.lineTo(0.52, 0.4); ctx.lineTo(0.64, 0.18); ctx.closePath(); fill(ctx, fur);
    ell(ctx, 0.74, -0.02, 0.07, 0.06, 0, pale);
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
