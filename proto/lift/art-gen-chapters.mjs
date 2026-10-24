// Authoring data (not loaded by the page): the pictures art-gen.mjs composes for
// the gaps in chapters 4 to 10, where no painted source was a good fit (most of
// those chapters use painted sources, see art-sources.js). Drawn in the same
// manner as the painted set: one bold subject over three flat bands, a light
// from the top left, two or three tones per shape and no dithering, so a
// generated picture sits happily next to an imported one. Each is drawn at its
// painting's slot size (LEVEL_DEFS `size`), so it can later be swapped for an
// imported picture without moving the painting. Deterministic.

// Flat horizontal bands: [[fromRow, letter], ...] (each band runs to the next).
function bands(P, list) {
  list.forEach(([y0, ch], i) => P.rect(0, y0, P.W - 1, i + 1 < list.length ? list[i + 1][0] - 1 : P.H - 1, ch));
}
// Two-tone round shading: light top-left, shadow bottom-right (no dither).
const tone3 = (dark, mid, light, cut = 0.55) => (x, y, u, v) => {
  const t = -(u * 0.55 + v * 0.75);
  return t > cut ? light : t < -cut ? dark : mid;
};
const tone2 = (dark, mid, cut = 0.45) => (x, y, u, v) => (u * 0.55 + v * 0.75 > cut ? dark : mid);

export function addChapterPictures(def, { mulberry }) {
  // ---------------- chapter 4: the kitchen garden ----------------
  def('carrots', 18, 24, (P) => {
    bands(P, [[0, 'j'], [12, 'y'], [15, 'k']]);
    P.speckle(P.box(0, 16, 17, 23), 'i', 0.08, 4);
    const tops = [[4.5, 8], [9, 6.5], [13.5, 8]];
    for (const [x, y] of tops) {
      for (const [dx, h] of [[-2.2, 4.5], [0, 6], [2.2, 4.5]]) P.line(x, y, x + dx, y - h, 'g', 1.5);
      P.line(x, y, x + 0.3, y - 5, 'f', 0.6);
    }
    const carrot = (x, y, len, w, lean) => P.poly([[x - w, y], [x + w, y], [x + lean, y + len]], (xx, yy) => {
      const t = (yy + 0.5 - y) / len, cx = x + lean * t, half = w * (1 - t);
      const u = (xx + 0.5 - cx) / Math.max(0.6, half);
      if (Math.floor(yy - y) % 3 === 2 && u > -0.6 && u < 0.5) return 'r';
      return u < -0.3 ? 'a' : u > 0.45 ? 'r' : 'z';
    });
    carrot(4.5, 8, 14, 2.6, -0.8);
    carrot(13.5, 8, 13, 2.6, 0.8);
    carrot(9, 6.5, 16.5, 3, 0);
  });

  def('peapods', 21, 28, (P) => {
    bands(P, [[0, 'h'], [10, 'c'], [19, 'v']]);
    // tendril and stalk
    P.line(10, 1, 13, 6, 'w', 1);
    P.line(13, 6, 15, 3.5, 'w', 0.8); P.line(15, 3.5, 17, 4.5, 'w', 0.8); P.line(17, 4.5, 17.5, 2.5, 'w', 0.8);
    // a closed pod behind, leaning right
    const back = P.poly([[13, 7], [17.5, 12], [18.5, 20], [16.5, 24], [15, 18], [12, 11]], tone2('f', 'g', 0.3));
    P.outline(back, 'f', 'rb');
    // the open pod: a long boat shape
    const pod = P.poly([[11, 6], [14, 10], [15, 17], [13, 24], [9, 26.5], [6, 25], [5, 18], [7, 11]], (x, y, u) => (u > 0.45 ? 'f' : 'g'));
    P.outline(pod, 'f', 'all');
    P.poly([[10.6, 8.5], [12.5, 12], [12.6, 18], [10.8, 23.5], [8.4, 24.4], [7.4, 18], [8.6, 12]], 'w');
    for (const y of [10.6, 13.6, 16.6, 19.6, 22.4]) {
      const cx = 10.2 + Math.sin(y / 3) * 0.6;
      P.ellipse(cx, y, 1.6, 1.45, (x, yy, u, v) => (u + v < -0.6 ? 'c' : u + v > 0.5 ? 'g' : 'j'));
    }
    P.line(11, 6, 10.5, 2.5, 'g', 1.2);
  });

  def('wateringcan', 24, 32, (P) => {
    bands(P, [[0, 'x'], [16, 'y'], [20, 'g']]);
    P.speckle(P.box(0, 21, 23, 31), 'w', 0.18, 7);
    // drops falling from the rose
    for (const [x, y] of [[21, 15], [23, 16], [22, 19], [20, 18], [23, 21]]) { P.set(x, y, 'b'); P.set(x, y + 1, 's'); }
    // the spout, from low on the body up to the rose
    P.line(13.5, 24, 19.5, 12.5, 'n', 2.6);
    P.line(13.5, 24, 19.5, 12.5, 't', 1.5);
    P.poly([[18, 10.5], [21.5, 9], [23.5, 12.5], [20.5, 14.5]], 'n');
    P.line(20.6, 9.8, 22.6, 13.4, 'e', 0.8);
    // the handle arching over the top
    P.shape([2, 6, 16, 16], (x, y) => { const d = Math.hypot((x - 9) / 5.6, (y - 15.5) / 7); return d >= 0.74 && d <= 1 && y < 15.5; }, (x) => (x < 8 ? 't' : 'n'));
    // the body
    const body = P.rect(3, 15, 15, 28, (x, y) => (x <= 5 ? 's' : x >= 13 ? 'n' : 't'));
    for (const y of [15, 19, 27, 28]) P.rect(3, y, 15, y, 'n');
    P.outline(body, 'n', 'lr');
    P.ellipse(9.5, 29.5, 8, 0.9, 'f');
  });

  def('wheelbarrow', 27, 36, (P) => {
    bands(P, [[0, 's'], [17, 'j'], [23, 'k']]);
    P.speckle(P.box(0, 24, 26, 35), 'l', 0.1, 9);
    // cargo: three pots of seedlings
    for (const [x, c] of [[6, 'z'], [11, 'a'], [16, 'z']]) {
      P.poly([[x - 2.4, 12], [x + 2.4, 12], [x + 1.8, 16], [x - 1.8, 16]], (xx) => (xx > x + 0.8 ? 'd' : c));
      P.rect(Math.round(x - 2.6), 11, Math.round(x + 2.6), 11, 'd');
      P.ellipse(x, 8.6, 2.6, 2.4, tone3('f', 'g', 'j', 0.5));
      P.line(x, 11, x, 9.5, 'f', 0.8);
    }
    // the tray
    const tray = P.poly([[1.5, 15], [22.5, 15], [19, 23], [5, 23]], (x, y) => (y < 16.5 ? 'd' : x > 17 ? 'd' : 'r'));
    P.outline(tray, 'd', 'b');
    P.rect(2, 15, 22, 15, 'r');
    for (const x of [8, 12, 16]) P.line(x, 17, x - 0.4, 22, 'd', 0.6);
    // handles and legs
    P.line(18, 19, 26.5, 15, 'l', 1.3); P.line(19, 21.5, 26.5, 17.5, 'l', 1.3);
    P.line(18.5, 23, 19.5, 29.5, 'i', 1.2);
    P.line(6, 22, 4.5, 26, 'i', 1);
    // the wheel
    P.ellipse(5.5, 28.5, 4.4, 4.4, 'i');
    P.ellipse(5.5, 28.5, 2.6, 2.6, 'e');
    P.ellipse(5.5, 28.5, 1, 1, 'i');
    P.ellipse(14, 32.2, 10, 0.9, 'i');
  });

  // ---------------- chapter 6: the country kitchen ----------------
  def('crock', 18, 24, (P) => {
    bands(P, [[0, 'y'], [9, 'p'], [15, 'm']]);
    P.rect(0, 15, 17, 15, 'd');
    // the crock: wide, round shouldered, salt-glazed with a blue band
    P.ellipse(9, 21.3, 7, 1, 'd');
    const body = P.shape([2, 6, 16, 22], (x, y) => {
      const t = (y - 6) / 15.5;
      const half = 5.4 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.6) * 1.6 - (t > 0.85 ? (t - 0.85) * 6 : 0);
      return Math.abs(x - 9) <= half;
    }, (x, y) => {
      if (y >= 11 && y <= 12) return x > 12 ? 'n' : 'b';
      if (y === 14) return x > 12 ? 'n' : 'b';
      return x < 6 ? 'c' : x > 12 ? 'l' : 'q';
    });
    P.outline(body, 'k', 'lrb');
    // lid and knob
    P.rect(4, 5, 14, 6, (x, y) => (y === 5 ? 'l' : 'k'));
    P.rect(8, 3, 10, 4, 'k'); P.set(8, 3, 'l');
    // a little label of butter on the lid edge
    P.rect(5, 16, 7, 18, 'y'); P.rect(5, 16, 7, 16, 'o');
  });

  def('bread', 21, 28, (P) => {
    bands(P, [[0, 'j'], [11, 'c'], [18, 'v']]);
    // the board
    P.rect(1, 21, 19, 23, (x, y) => (y === 23 ? 'k' : 'l'));
    P.rect(1, 21, 19, 21, 'q');
    // a round loaf, crusty, with three cuts and a dusting of flour
    const loaf = P.ellipse(10, 15.5, 8.6, 6.2, (x, y, u, v) => {
      const t = -(u * 0.45 + v * 0.8);
      return t > 0.45 ? 'a' : t < -0.55 ? 'k' : 'z';
    });
    P.rect(2, 20, 18, 20, 'k');
    P.outline(loaf, 'k', 'b');
    for (const x0 of [5, 9, 13]) P.line(x0, 15.5, x0 + 3, 11, 'y', 1);
    P.speckle(loaf, 'c', 0.08, 29, (x, y) => y < 13);
    P.ellipse(10.5, 24.6, 9, 0.7, 'm');
  });

  def('honeypot', 21, 28, (P) => {
    bands(P, [[0, 'n'], [11, 'u'], [16, 'j']]);
    P.ellipse(10.5, 25.5, 8.5, 1.1, 'g');
    // jar of honey
    const jar = P.rect(4, 9, 16, 25, (x, y) => (y < 11 ? 'c' : x <= 5 ? 'y' : x >= 15 ? 'z' : 'o'));
    P.outline(jar, 'z', 'lrb');
    P.rect(4, 10, 16, 10, 'k');
    // the cloth cover, gingham
    P.poly([[2.5, 9.5], [10.5, 4], [18.5, 9.5], [17, 11.5], [4, 11.5]], (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 'r' : 'c'));
    P.rect(4, 10, 16, 10, 'k');
    // label
    P.rect(7, 15, 13, 19, 'c'); P.rect(8, 17, 12, 17, 'k');
    // the dipper, leaning against the jar
    P.line(18.5, 6, 15.5, 18, 'k', 1);
    P.ellipse(15, 19.5, 1.5, 1.8, (x, y) => (y % 2 ? 'k' : 'l'));
    // a drip running down
    P.rect(12, 11, 12, 13, 'o'); P.set(12, 14, 'z');
    // a bee
    P.ellipse(5.5, 4, 1.6, 1.1, (x) => (x % 2 ? 'i' : 'y'));
    P.set(5, 2, 'c'); P.set(6, 2, 'c');
    P.set(3, 4, 'i');
  });

  def('copperpan', 24, 32, (P) => {
    bands(P, [[0, 'c'], [13, 't'], [17, 'v']]);
    // stove ring
    P.ellipse(11, 27.5, 9, 1.6, 'i');
    P.ellipse(11, 27.2, 7, 0.9, 'e');
    // steam
    P.line(8, 8, 9, 5, 'e', 0.8); P.line(9, 5, 8, 2.5, 'e', 0.8); P.line(13, 9, 14, 6, 'e', 0.8); P.line(14, 6, 13, 3, 'e', 0.8);
    // lid
    P.ellipse(11, 12, 8.4, 1.6, (x, y) => (y < 12 ? 'a' : 'd'));
    P.rect(10, 9, 12, 10, 'k');
    // pan body: copper, banded
    const pan = P.rect(3, 13, 19, 26, (x, y) => (x <= 5 ? 'a' : x >= 17 ? 'd' : y === 15 || y === 24 ? 'a' : 'z'));
    P.outline(pan, 'd', 'b');
    for (const y of [13, 26]) P.rect(3, y, 19, y, 'd');
    // the long handle, with a hanging hole
    P.line(19, 16, 23.5, 12.5, 'k', 1.8);
    P.set(22, 13, 'c');
  });

  // ---------------- chapter 7: wool and thread ----------------
  def('reels', 18, 24, (P) => {
    bands(P, [[0, 'q'], [9, 'h'], [16, 'n']]);
    const reel = (x0, y0, w, h, c, shade) => {
      P.rect(x0, y0, x0 + w - 1, y0 + 1, 'l'); P.rect(x0, y0 + h - 2, x0 + w - 1, y0 + h - 1, 'k');
      P.rect(x0 + 1, y0 + 2, x0 + w - 2, y0 + h - 3, (x, y) => (x === x0 + w - 2 ? shade : (y + x) % 3 === 0 ? shade : c));
      P.rect(x0, y0 + 1, x0 + w - 1, y0 + 1, 'k');
    };
    reel(2, 4, 7, 10, 'b', 'n');
    reel(9, 2, 7, 11, 'r', 'd');
    reel(5, 12, 8, 10, 'o', 'a');
    // a loose thread curling from the red reel
    P.line(15, 8, 17, 12, 'r', 0.7); P.line(17, 12, 15.5, 15, 'r', 0.7); P.line(15.5, 15, 17, 18, 'r', 0.7);
    P.ellipse(9, 22.6, 6, 0.7, 'i');
  });

  def('thimble', 21, 28, (P) => {
    bands(P, [[0, 'm'], [10, 'y'], [17, 't']]);
    // needle and thread
    P.line(3, 25, 16, 3, 'e', 0.9);
    P.set(15, 4, 'i');
    P.line(15.5, 4, 18.5, 8, 'r', 0.8); P.line(18.5, 8, 17, 13, 'r', 0.8); P.line(17, 13, 19, 18, 'r', 0.8);
    // thimble: a rounded cup, dimpled
    const th = P.shape([4, 8, 17, 25], (x, y) => {
      const t = (y - 9) / 15;
      if (t < 0) return false;
      const half = 4.2 + t * 2.2;
      if (t < 0.25) return ((x - 10.5) / (half + 0.2)) ** 2 + ((y - 12.6) / 3.6) ** 2 <= 1;
      return Math.abs(x - 10.5) <= half;
    }, (x, y) => {
      const dim = (x + (y % 2)) % 2 === 0 && y < 21;
      if (x <= 7) return dim ? 'e' : 'c';
      if (x >= 14) return dim ? 'i' : 'e';
      return dim ? 'l' : 'e';
    });
    P.rect(4, 22, 17, 24, (x) => (x <= 7 ? 'c' : x >= 14 ? 'k' : 'l'));
    P.outline(th, 'i', 'b');
    P.ellipse(10.5, 25.6, 7, 0.7, 'i');
  });

  def('knitting', 24, 32, (P) => {
    bands(P, [[0, 'j'], [12, 'c'], [20, 'n']]);
    // two needles crossing
    P.line(2, 3, 21, 10, 'o', 1.3); P.line(22, 3, 3, 10, 'o', 1.3);
    P.rect(1, 2, 2, 3, 'k'); P.rect(21, 2, 22, 3, 'k');
    // the knitted strip hanging from the needles: rows of V stitches in stripes
    const stripes = ['r', 'r', 'c', 'b', 'b', 'c', 'r', 'r', 'o', 'o', 'c', 'b', 'b', 'c', 'r', 'r'];
    P.rect(6, 8, 17, 23, (x, y) => {
      const c = stripes[(y - 8) % stripes.length];
      const v = (x + (y % 2)) % 2 === 0;
      return v ? c : c === 'c' ? 'q' : c === 'r' ? 'd' : c === 'b' ? 'n' : 'a';
    });
    for (let y = 24; y < 26; y++) for (let x = 6; x <= 17; x++) if ((x + y) % 3 !== 0) P.set(x, y, 'r');
    // the ball of yarn, its thread running up
    P.line(18, 23, 15, 27, 'u', 0.8);
    P.ellipse(19, 27.5, 3.6, 3.2, (x, y, u, v) => (u + v < -0.5 ? 'h' : (x - y) % 3 === 0 ? 'v' : 'u'));
    P.ellipse(12, 31, 9, 0.6, 'i');
  });

  def('workbasket', 27, 36, (P) => {
    bands(P, [[0, 'u'], [14, 'q'], [22, 'm']]);
    // the open lid, tilted back
    P.poly([[4, 13], [22, 13], [25, 4], [7, 4]], (x, y) => ((x + y) % 3 === 0 ? 'k' : 'o'));
    P.poly([[6, 12], [21, 12], [23.6, 5.4], [8.4, 5.4]], 'r');
    // what is inside: reels, yarn balls, a pincushion
    P.ellipse(8, 15, 3, 2.6, (x, y) => ((x + y) % 3 ? 'b' : 'n'));
    P.ellipse(19, 15, 3, 2.6, (x, y) => ((x - y) % 3 ? 'p' : 'h'));
    P.ellipse(13.5, 14.5, 2.6, 2.2, (x, y) => ((x * y) % 4 ? 'g' : 'j'));
    P.rect(11, 11, 12, 15, 'c'); P.rect(15, 11, 16, 15, 'y'); P.rect(15, 11, 16, 11, 'k'); P.rect(11, 11, 12, 11, 'k');
    P.line(20, 15, 25.5, 11, 'e', 0.9); P.line(25.5, 11, 26, 12.5, 'e', 0.9);
    // the basket: a woven tub
    const tub = P.poly([[2, 16], [25, 16], [23, 31], [4, 31]], (x, y) => {
      const row = Math.floor((y - 16) / 2);
      const weave = (Math.floor(x / 2) + row) % 2 === 0;
      if (x > 20) return weave ? 'k' : 'a';
      return weave ? 'a' : 'o';
    });
    P.outline(tub, 'k', 'lrb');
    P.rect(2, 16, 25, 17, (x) => (x % 2 ? 'k' : 'a'));
    P.ellipse(13.5, 32.2, 11, 0.9, 'd');
  });

  // ---------------- chapter 8: by the water ----------------
  def('starfish', 18, 24, (P) => {
    bands(P, [[0, 'x'], [8, 's'], [12, 'q']]);
    P.speckle(P.box(0, 13, 17, 23), 'l', 0.16, 31);
    for (const [x, y] of [[2, 20], [15, 21], [14, 14]]) { P.set(x, y, 'e'); P.set(x + 1, y, 'e'); }
    const cx = 9, cy = 15.5, pts = [];
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 3.3 : 8.2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    const st = P.poly(pts, (x, y, u, v) => {
      if ((x * 3 + y * 5) % 7 === 0) return 'y';
      const t = -(u * 0.55 + v * 0.75);
      return t > 0.35 ? 'a' : t < -0.45 ? 'r' : 'z';
    });
    P.outline(st, 'r', 'b');
    P.ellipse(cx, cy, 1.4, 1.3, 'a');
  });

  def('seashell', 21, 28, (P) => {
    bands(P, [[0, 'x'], [10, 's'], [15, 'q']]);
    P.speckle(P.box(0, 16, 20, 27), 'l', 0.14, 5);
    P.ellipse(10.5, 25, 9, 1, 'l');
    const cx = 10.5, cy = 23.5;
    const fan = P.shape([0, 5, 21, 24], (x, y) => {
      const dx = x - cx, dy = cy - y;
      if (dy < 0) return false;
      const a = Math.atan2(dx, dy), r = Math.hypot(dx, dy);
      return Math.abs(a) < 1.05 && r < 16.5 - Math.abs(Math.sin(a * 8.5)) * 1;
    }, (x, y) => {
      const a = Math.atan2(x - cx, cy - y), r = Math.hypot(x - cx, cy - y);
      const rib = Math.floor((a + 1.2) / 0.25);
      if (r > 14.6) return 'c';
      return rib % 2 ? (a < -0.4 ? 'h' : 'p') : (a > 0.5 ? 'p' : 'h');
    });
    P.outline(fan, 'a', 'all');
    P.poly([[6.5, 21.5], [14.5, 21.5], [13, 25], [8, 25]], (x) => (x > 11.5 ? 'a' : 'h'));
  });

  def('crab', 24, 32, (P) => {
    bands(P, [[0, 'y'], [12, 'b'], [17, 'q']]);
    P.rect(0, 12, 23, 12, 's');
    P.speckle(P.box(0, 18, 23, 31), 'l', 0.12, 13);
    P.ellipse(12, 28, 9, 1, 'l');
    // legs
    for (const s of [-1, 1]) for (const k of [0, 1, 2]) {
      const x0 = 12 + s * 4.5, y0 = 22 + k * 1.6, x1 = 12 + s * (9 + k * 0.6), y1 = 23.5 + k * 1.8;
      P.line(x0, y0, x1, y1, 'd', 1); P.line(x1, y1, x1 + s * 0.8, y1 + 2.4, 'd', 1);
    }
    // body
    const body = P.ellipse(12, 21.5, 6.6, 4.4, tone3('d', 'r', 'z', 0.5));
    P.outline(body, 'd', 'b');
    // claws on arms
    for (const s of [-1, 1]) {
      P.line(12 + s * 5, 19, 12 + s * 7, 14.5, 'r', 1.4);
      const cl = P.ellipse(12 + s * 7.5, 11.5, 2.6, 3, tone3('d', 'r', 'z', 0.4));
      P.outline(cl, 'd', s < 0 ? 'l' : 'r');
      P.poly([[12 + s * 6.5, 8.5], [12 + s * 7.6, 11], [12 + s * 8.6, 8.5]], 'b');
    }
    // eyes on stalks
    for (const s of [-1, 1]) { P.line(12 + s * 1.8, 17.5, 12 + s * 2.2, 15.5, 'd', 0.8); P.set(12 + s * 2 + (s < 0 ? -1 : 0), 15, 'i'); P.set(12 + s * 2 + (s < 0 ? 0 : -1), 15, 'c'); }
    P.rect(10, 22, 13, 22, 'd');
  });

  def('anchor', 27, 36, (P) => {
    bands(P, [[0, 'c'], [17, 'r'], [22, 's']]);
    P.rect(0, 22, 26, 22, 'x');
    for (let y = 25; y < 36; y += 3) for (let x = (y * 5) % 7; x < 27; x += 7) { P.set(x, y, 'x'); P.set(x + 1, y, 'x'); }
    const ink = (x) => (x < 13 ? 'b' : 'n');
    // ring
    P.shape([9, 1, 18, 9], (x, y) => { const d = Math.hypot(x - 13.5, y - 4.5); return d >= 2 && d <= 3.6; }, (x) => ink(x));
    // stock (crossbar) and shank
    P.rect(7, 9, 20, 10, (x) => (x < 13 ? 'b' : 'n'));
    P.rect(12, 8, 15, 29, (x) => (x <= 13 ? 'b' : 'n'));
    // the curved arms and flukes
    P.shape([3, 21, 24, 33], (x, y) => { const d = Math.hypot((x - 13.5) / 9.5, (y - 23) / 9); return d >= 0.78 && d <= 1 && y > 23; }, (x) => ink(x));
    P.poly([[1.5, 21], [6, 23.5], [5.5, 27.5]], 'b');
    P.poly([[25.5, 21], [21, 23.5], [21.5, 27.5]], 'n');
    P.ellipse(13.5, 31.6, 2.4, 1.6, 'n');
    // a rope looped around the shank
    for (const [y, dir] of [[12, 1], [15, -1], [18, 1]]) P.line(9.5, y, 17.5, y + dir * 1.4, (x) => ((Math.round(x) % 2) ? 'l' : 'k'), 1.1);
    P.line(9.5, 12, 6, 16, 'l', 1.1); P.line(6, 16, 8, 20, 'l', 1.1); P.line(17.5, 19.4, 21, 22, 'l', 1.1);
  });

  // ---------------- chapter 9: woodland and autumn ----------------
  def('pinecone', 21, 28, (P) => {
    bands(P, [[0, 'j'], [12, 'c'], [19, 'g']]);
    // the twig with tufts of needles at each end
    P.line(0, 4, 21, 6, 'k', 1.2);
    for (const [x, y, s] of [[3, 4, -1], [18, 5.5, 1]]) for (let k = -2; k <= 2; k++) P.line(x, y, x + s * 3 + k * 0.6, y - 3 + Math.abs(k) * 0.8 + (k > 0 ? 5 : 0), 'f', 0.8);
    P.rect(10, 5, 11, 7, 'k');
    // the cone, hanging point down: a lattice of diamond scales, each lit at its lip
    const mod = (v, m) => ((v % m) + m) % m;
    const cone = P.shape([3, 7, 18, 26], (x, y) => {
      const t = (y - 7) / 18.5;
      if (t < 0 || t > 1) return false;
      const half = 6.8 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.86)) ** 0.8;
      return Math.abs(x - 10.5) <= half;
    }, (x, y) => {
      const a = (x - 10.5) * 0.8 + (y - 7) * 0.75, b = -(x - 10.5) * 0.8 + (y - 7) * 0.75;
      const fa = mod(a, 3.6), fb = mod(b, 3.6);
      if (fa < 0.6 || fb < 0.6) return 'i';
      if (fa > 2.1 && fb > 2.1) return 'a';
      return x < 8.5 ? 'l' : x > 14.5 ? 'i' : 'k';
    });
    P.outline(cone, 'i', 'lrb');
    P.ellipse(11, 26.8, 6, 0.7, 'f');
  });

  def('squirrel', 24, 32, (P) => {
    bands(P, [[0, 'x'], [14, 'j'], [21, 'w']]);
    P.rect(0, 21, 23, 21, 'g');
    P.speckle(P.box(0, 22, 23, 31), 'g', 0.15, 21);
    // the big curling tail behind
    const tail = blobOf(P, [[16.5, 9, 5, 6], [18, 16, 4.2, 5.6], [14.5, 4.5, 3.2, 3]], (x, y, u, v) => (u + v < -0.6 ? 'a' : (x + y) % 5 === 0 ? 'd' : 'z'));
    P.outline(tail, 'd', 'rb');
    // body sitting up
    const body = P.ellipse(10.5, 20, 5.2, 6.4, tone3('d', 'z', 'a', 0.6));
    P.ellipse(8.6, 20.5, 2.4, 4.4, 'c');
    P.outline(body, 'd', 'b');
    // head and ear
    P.ellipse(8, 11.5, 3.6, 3.2, tone3('d', 'z', 'a', 0.45));
    P.poly([[7.6, 9], [8.6, 5.6], [10, 9]], 'z'); P.set(8, 7, 'd');
    P.set(7, 11, 'i'); P.set(4, 12, 'i'); P.set(5, 13, 'c');
    // paws holding an acorn
    P.ellipse(6, 16.5, 1.6, 1.8, 'o'); P.rect(5, 14, 7, 14, 'k'); P.set(6, 13, 'k');
    P.rect(7, 16, 8, 17, 'z');
    // feet
    P.ellipse(9, 26.4, 2.4, 0.9, 'd'); P.ellipse(13.5, 26.4, 2.2, 0.9, 'd');
    P.ellipse(12, 27.6, 8, 0.7, 'g');
  });

  def('woodpecker', 27, 36, (P) => {
    bands(P, [[0, 'q'], [16, 'a'], [24, 'g']]);
    // the trunk, with bark
    P.rect(13, 0, 21, 35, (x, y) => (x >= 20 ? 'i' : x <= 14 ? 'l' : ((y * 2 + x * 5) % 9 === 0 || (y + x) % 7 === 0) ? 'i' : 'k'));
    P.ellipse(13, 13.5, 0.9, 1.5, 'i');
    // a branch stub with leaves
    P.line(21, 27, 26, 24, 'k', 1.4);
    blobOf(P, [[25, 22.5, 2, 1.4], [23.5, 21.5, 1.6, 1.2]], 'g');
    // the woodpecker clinging on the left side of the trunk, beak to the bark
    const body = P.poly([[11.5, 12], [12.5, 18], [11, 25], [8, 29], [6.5, 25], [7, 17], [8.5, 12.5]], (x, y) => ((x + y) % 4 === 0 && y > 16 ? 'c' : 'i'));
    P.outline(body, 'i', 'all');
    P.poly([[7.6, 18], [9.6, 18.6], [9.4, 24], [7.4, 23]], (x, y) => ((y % 2) ? 'c' : 'e'));
    P.poly([[8, 28], [9.6, 28.2], [8.6, 33], [7.4, 32]], 'i');
    const head = P.ellipse(10, 10.2, 2.8, 2.7, 'i');
    P.outline(head, 'i', 'all');
    P.rect(9, 7.5, 11, 8.5, 'r'); P.set(12, 9, 'r'); P.rect(8, 8, 8, 9, 'r');
    P.rect(9, 11, 10, 12, 'c');
    P.set(11, 10, 'c');
    P.line(12.5, 10.5, 13.4, 10.6, 'e', 0.8);
    P.rect(11, 13, 12, 13, 'e'); P.rect(11, 20, 12, 21, 'e');
    // chips of bark falling
    for (const [x, y] of [[11, 4], [9, 2], [12, 31]]) P.set(x, y, 'k');
  });

  // ---------------- chapter 10: winter evenings ----------------
  def('snowflake', 18, 24, (P) => {
    bands(P, [[0, 'n'], [15, 'b'], [18, 'x']]);
    P.speckle(P.box(0, 19, 17, 23), 'c', 0.3, 3);
    for (const [x, y] of [[1, 2], [15, 1], [16, 7], [2, 9], [1, 14], [16, 13], [5, 0], [12, 0], [9, 1]]) P.set(x, y, 'y');
    const cx = 9, cy = 9, R = 7.6;
    for (let a = 0; a < 6; a++) {
      const t = (a * Math.PI) / 3 + Math.PI / 2;
      const ex = cx + Math.cos(t) * R, ey = cy + Math.sin(t) * R;
      P.line(cx, cy, ex, ey, 'c', 1.4);
      for (const f of [0.5, 0.78]) {
        const bx = cx + Math.cos(t) * R * f, by = cy + Math.sin(t) * R * f;
        for (const s of [-1, 1]) P.line(bx, by, bx + Math.cos(t + s * 0.85) * 2.4, by + Math.sin(t + s * 0.85) * 2.4, 'x', 0.9);
      }
      P.set(ex, ey, 's'); P.set(cx + Math.cos(t) * (R - 1), cy + Math.sin(t) * (R - 1), 's');
    }
    P.ellipse(cx, cy, 2, 2, 'b');
    P.set(cx, cy, 'x');
  });

  def('holly', 21, 28, (P) => {
    bands(P, [[0, 'c'], [12, 'y'], [16, 'n']]);
    const leaf = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      const pts = [];
      const N = 5;
      for (let i = 0; i <= N; i++) { const t = i / N, w = Math.sin(Math.PI * t) * 3.2 + (i % 2 ? 0.9 : 0); pts.push([x0 + dx * t + nx * w, y0 + dy * t + ny * w]); }
      for (let i = N; i >= 0; i--) { const t = i / N, w = Math.sin(Math.PI * t) * 3.2 + (i % 2 ? 0.9 : 0); pts.push([x0 + dx * t - nx * w, y0 + dy * t - ny * w]); }
      const m = P.poly(pts, (x, y) => (((x + 0.5 - x0) * nx + (y + 0.5 - y0) * ny) > 0 ? 'g' : 'f'));
      P.line(x0, y0, x1, y1, 'j', 0.7);
      return m;
    };
    leaf(10, 15, 2, 4);
    leaf(11, 15, 19.5, 5);
    leaf(10.5, 16, 7, 26);
    leaf(11, 16, 17, 25.5);
    for (const [x, y] of [[9, 14.5], [12.5, 14], [10.8, 17.2]]) {
      P.ellipse(x, y, 1.9, 1.9, (xx, yy, u, v) => (u + v < -0.7 ? 'h' : u + v > 0.7 ? 'd' : 'r'));
    }
  });

  def('sledge', 24, 32, (P) => {
    bands(P, [[0, 's'], [14, 'x'], [19, 'c']]);
    P.speckle(P.box(0, 0, 23, 13), 'c', 0.06, 17);
    P.speckle(P.box(0, 20, 23, 31), 'x', 0.12, 19);
    // a parcel and a scarf riding on the sledge
    P.rect(7, 12, 13, 17, (x) => (x === 10 ? 'r' : x > 11 ? 'g' : 'w'));
    P.rect(7, 14, 13, 14, 'r');
    P.line(14, 16.5, 18, 13.5, 'o', 1.6); P.line(18, 13.5, 19.5, 17, 'o', 1.4);
    // the seat: slats
    P.rect(3, 18, 21, 20, (x, y) => (y === 18 ? 'z' : y === 20 ? 'd' : 'r'));
    for (const x of [5, 12, 19]) P.rect(x, 21, x + 1, 24, 'd');
    // the runners, curling up at the front
    P.rect(2, 25, 20, 25, 'i');
    P.shape([19, 19, 24, 26], (x, y) => { const d = Math.hypot(x - 20.5, y - 22.5); return d >= 1.6 && d <= 2.8 && !(x < 20.5 && y < 22.5); }, 'i');
    P.rect(2, 26, 20, 26, 'e');
    // the tow rope
    P.line(22, 21, 23.5, 30, 'l', 0.8);
    P.ellipse(11, 27.5, 10, 0.8, 'x');
  });

  def('gingerbread', 27, 36, (P) => {
    bands(P, [[0, 'n'], [21, 'u'], [26, 'c']]);
    const rng = mulberry(67);
    for (let k = 0; k < 16; k++) { const x = Math.floor(rng() * 27), y = Math.floor(rng() * 20); P.set(x, y, k % 3 ? 'y' : 'c'); }
    P.speckle(P.box(0, 27, 26, 35), 'x', 0.1, 23);
    // the plate
    P.ellipse(13.5, 31.5, 12, 2.2, (x, y) => (y < 31 ? 'c' : 'e'));
    // walls
    const wall = P.rect(5, 16, 21, 30, (x) => (x >= 19 ? 'k' : 'a'));
    P.outline(wall, 'k', 'lr');
    // roof thick with icing
    P.poly([[2, 17], [13, 6], [24, 17]], (x, y, u, v) => (v > 0.5 ? 'c' : (x + y) % 2 ? 'k' : 'a'));
    P.line(2, 17, 13, 6, 'c', 1.6); P.line(13, 6, 24, 17, 'c', 1.6);
    for (const x of [5, 9, 17, 21]) P.rect(x, 18, x, 19, 'c');
    // door and windows
    P.rect(11, 23, 15, 30, (x, y) => (y === 23 ? 'c' : 'd'));
    P.set(14, 27, 'y');
    for (const wx of [7, 17]) { P.rect(wx, 20, wx + 2, 22, 'y'); P.rect(wx, 21, wx + 2, 21, 'c'); P.rect(wx + 1, 20, wx + 1, 22, 'c'); }
    // sweets on the roof and along the base
    for (const [x, y, c] of [[10, 11, 'r'], [16, 11, 'g'], [13, 9, 'p'], [7, 15, 'p'], [19, 15, 'r']]) { P.set(x, y, c); P.set(x + 1, y, c); }
    for (let x = 5; x <= 21; x += 2) P.set(x, 29, (x / 2) % 2 ? 'r' : 'g');
    // chimney with a puff of smoke
    P.rect(18, 7, 20, 11, 'd'); P.rect(18, 7, 20, 7, 'c');
    P.ellipse(20, 4, 1.6, 1.2, 'e'); P.ellipse(22, 2.4, 1.3, 1, 'e');
  });
}

// A blob of ellipses (fleece, tails, foliage) filled with one fill.
function blobOf(P, parts, fill) {
  const m = new Set();
  for (const [cx, cy, rx, ry] of parts) for (const i of P.ellipse(cx, cy, rx, ry ?? rx, fill)) m.add(i);
  return m;
}
