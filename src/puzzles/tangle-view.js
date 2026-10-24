// puzzles/tangle-view.js — The Tangle Basket's zoom and pan (pure arithmetic,
// no DOM), copied unchanged from proto/tangle/view.js.
// A view is { z, x, y }: z = zoom (1 shows the whole board), and (x, y) = the
// board point at the top-left corner of the window. `fit` is the board's size
// in css px at zoom 1 ({ w, h, s }: s = css px per board unit). Screen points
// are css px from the window's top-left corner.

export const ZMIN = 1;
export const ZMAX = 3.2;

export const fitView = () => ({ z: 1, x: 0, y: 0 });
export const pxPerUnit = (fit, v) => fit.s * v.z;

// Keep the window inside the board.
export function clampView(fit, board, v) {
  const z = Math.min(ZMAX, Math.max(ZMIN, v.z));
  const ww = board.w / z, wh = board.h / z; // the window, in board units
  const x = Math.min(board.w - ww, Math.max(0, v.x));
  const y = Math.min(board.h - wh, Math.max(0, v.y));
  return { z, x, y };
}

export const toBoard = (fit, v, px, py) => [v.x + px / (fit.s * v.z), v.y + py / (fit.s * v.z)];
export const toScreen = (fit, v, bx, by) => [(bx - v.x) * fit.s * v.z, (by - v.y) * fit.s * v.z];

// Zoom by `factor` keeping the board point under (px, py) where it is.
export function zoomAt(fit, board, v, factor, px, py) {
  const [bx, by] = toBoard(fit, v, px, py);
  const z = Math.min(ZMAX, Math.max(ZMIN, v.z * factor));
  return clampView(fit, board, { z, x: bx - px / (fit.s * z), y: by - py / (fit.s * z) });
}
// Move the window by a finger drag of (dx, dy) css px.
export const panBy = (fit, board, v, dx, dy) => clampView(fit, board, { z: v.z, x: v.x - dx / (fit.s * v.z), y: v.y - dy / (fit.s * v.z) });

// A two-finger gesture: from the view at its start (v0) and the two fingers
// then (a0, b0) and now (a1, b1), the view now. The board point under the
// fingers' midpoint follows the midpoint; the spread sets the zoom.
export function pinchView(fit, board, v0, a0, b0, a1, b1) {
  const d0 = Math.max(8, Math.hypot(b0[0] - a0[0], b0[1] - a0[1]));
  const d1 = Math.max(8, Math.hypot(b1[0] - a1[0], b1[1] - a1[1]));
  const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
  const [bx, by] = toBoard(fit, v0, m0[0], m0[1]);
  const z = Math.min(ZMAX, Math.max(ZMIN, v0.z * (d1 / d0)));
  return clampView(fit, board, { z, x: bx - m1[0] / (fit.s * z), y: by - m1[1] / (fit.s * z) });
}

// How far a tap may land from a strand and still count, in board units: a
// fixed finger size on screen (22 css px, or half the yarn plus 6 px), so it
// shrinks on the board as she zooms in.
export function reachUnits(fit, v, yarnW) {
  const s = fit.s * v.z;
  return Math.max(22, (yarnW / 2) * s + 6) / s;
}

// Is a view (about) the whole board?
export const isFit = (v) => v.z <= 1.001;
