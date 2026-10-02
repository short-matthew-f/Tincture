/**
 * purify.js: the tube sort for muddy batches (overlay `purify`, fullscreen).
 *
 * Owns: tubes as tall glass SVGs with stacked layers (patterns in colorblind
 * mode), tap a tube to lift it then tap where to pour, the stream arc with a
 * wobbling landing, `audio.glug` per pour, the cork on a finished tube, unlimited
 * Undo, "Add a tube" (Relaxed only, once), and the solve: the batch is purified
 * through sim.factory.purifyBatch. Implements DESIGN.md "Active play >
 * Purifying", "Interaction feel" (Tube-sort pour) and the accessibility note
 * (patterns on tube layers).
 *
 * Back keeps the puzzle: it lives in state.activePuzzles.purify
 * ({batchId, color, puzzle, startedAt}) until it is solved or the batch is sold.
 * Wrong pours are never red: an illegal pour is a quiet low tick, nothing more.
 * sim.factory.purifyBatch already fires questEvent('batchPurified'), so this
 * screen only adds the event points (eventPoints('purify')).
 */

import { h, raw, backButton, button, swatch, iconSvg } from './kit.js';
import {
  injectStyle, PZ_CSS, ensureActive, activeOf, createPurifyPuzzle, patternFill, ensureDefs, lightnessOf,
} from './puzzles.js';

const CSS = `
.pu-shelf { position: relative; background: var(--walnut); border-radius: 18px; padding: 34px 10px 0; box-shadow: 0 4px 0 rgba(42,38,34,.3); display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.pu-row { position: relative; display: grid; grid-template-columns: repeat(var(--per), 44px); justify-content: center; column-gap: 7px; padding-bottom: 12px; }
.pu-row::after { content: ''; position: absolute; left: -10px; right: -10px; bottom: 0; height: 12px; background: var(--walnut-deep); }
.pu-tube { display: block; border: 0; padding: 0; background: transparent; position: relative; transition: transform 140ms var(--ease-out); touch-action: manipulation; }
.pu-tube.is-sel { transform: translateY(-16px); }
.pu-tube svg { display: block; overflow: visible; }
.pu-layer-new { transform-box: fill-box; transform-origin: 50% 100%; animation: pu-land 320ms var(--ease-out) var(--d, 150ms) backwards; }
@keyframes pu-land { 0% { transform: scaleY(0); } 60% { transform: scaleY(1.07); } 100% { transform: scaleY(1); } }
.pu-cork-new { animation: pu-cork 260ms var(--ease-out) var(--cd, 330ms) backwards; }
@keyframes pu-cork { from { transform: translateY(-18px); opacity: 0; } to { transform: none; opacity: 1; } }
.pu-stream { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 5; }
.pu-stream path { fill: none; stroke-linecap: round; filter: drop-shadow(0 1px 0 rgba(42,38,34,.35)); }
.pu-tools { display: flex; gap: 10px; }
.pu-tools .btn { flex: 1 1 0; min-height: 48px; }
.pu-undo { min-height: 44px; padding: 0 14px; font-size: 14px; }
`;

let C = null;
let ROOT = null;
const P = {
  visible: false, entry: null, sel: null, busy: false, celebrating: false, result: null,
  timers: [], cb: false, sig: '', el: {}, name: '', hex: '#B7BDB3', reward: null,
};
let uid = 0;

const later = (fn, ms) => { const id = setTimeout(fn, ms); P.timers.push(id); return id; };
const clearTimers = () => { P.timers.forEach(clearTimeout); P.timers = []; };
const fmt = (n) => (C.format && C.format.num ? C.format.num(n) : Math.round(n).toLocaleString());
const reduced = () => !!(C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const topOf = (t) => (t.length ? t[t.length - 1] : null);
const isDone = (puz, t) => t.length === puz.capacity && t.every((c) => c === t[0]);
const layerH = (puz) => (puz.capacity <= 4 ? 40 : Math.floor(160 / puz.capacity));

// ---------------------------------------------------------------------------
// Sim-style actions
// ---------------------------------------------------------------------------

function pourAct(s, args, now) {
  const e = s.activePuzzles && s.activePuzzles.purify;
  if (!e) return { ok: false };
  const r = C.puzzles.purify.pour(e.puzzle, args.from, args.to);
  if (r.ok && r.solved) {
    const sim = C.sim;
    const batch = (s.muddyBatches || []).find((b) => b.id === e.batchId);
    const colorId = e.color;
    const done = sim.factory.purifyBatch(s, { batchId: e.batchId, purity: 'pure' }, now);
    sim.events.eventPoints(s, 'purify', 1, { colorId });
    if (s.lifetime) s.lifetime.puzzles = (Number.isFinite(s.lifetime.puzzles) ? s.lifetime.puzzles : 0) + 1;
    ensureActive(s).purify = null;
    r.reward = { ok: !!done.ok, jars: done.jars || 0, coins: done.coins || 0, colorId, total: batch ? batch.jars : done.jars };
  }
  return r;
}

const undoAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e ? C.puzzles.purify.undo(e.puzzle) : { ok: false };
};

const addTubeAct = (s) => {
  const e = s.activePuzzles && s.activePuzzles.purify;
  return e ? C.puzzles.purify.addTube(e.puzzle) : { ok: false };
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** One tube as an inline SVG. `newN` = layers that just landed; `corkNew` animates the cork in. */
function tubeSvg(puz, i, { newN = 0, corkNew = false } = {}) {
  const tube = puz.tubes[i];
  const cap = puz.capacity;
  const L = layerH(puz);
  const top = 16;
  const bodyH = cap * L;
  const H = top + bodyH + 4;
  const id = `pu${++uid}`;
  const yb = top + bodyH - 17;
  const shape = `M5 ${top} V${yb} A17 17 0 0 0 39 ${yb} V${top}`;
  const layers = tube.map((c, k) => {
    const y = top + bodyH - (k + 1) * L;
    const hex = puz.colors[c];
    const fresh = k >= tube.length - newN && newN > 0;
    const cls = fresh ? ' class="pu-layer-new"' : '';
    const dly = fresh ? ` style="--d:${150 + (k - (tube.length - newN)) * 60}ms"` : '';
    const rect = `<rect x="5" y="${y}" width="34" height="${L}" fill="${hex}"/>${C.game.state.settings && C.game.state.settings.colorblind ? `<rect x="5" y="${y}" width="34" height="${L}" fill="${patternFill(c)}"/>` : ''}`;
    return `<g${cls}${dly}>${rect}<rect x="5" y="${y}" width="34" height="1.5" fill="#2A2622" fill-opacity=".18"/></g>`;
  }).join('');
  const corked = isDone(puz, tube);
  const cork = corked
    ? `<g class="${corkNew ? 'pu-cork-new' : ''}"><rect x="9" y="3" width="26" height="14" rx="3.5" fill="#C9A277" stroke="#2A2622" stroke-width="2"/><path d="M13 8 H31" stroke="#7B5236" stroke-opacity=".5" stroke-width="1.5"/></g>`
    : '';
  return `<svg width="44" height="${H}" viewBox="0 0 44 ${H}" aria-hidden="true" focusable="false" data-h="${H}" data-l="${L}">
<defs><clipPath id="${id}"><path d="${shape} Z"/></clipPath></defs>
<path d="${shape} Z" fill="#F2F4F0" fill-opacity=".9"/>
<g clip-path="url(#${id})">${layers}</g>
<rect x="10" y="${top + 8}" width="4" height="${Math.max(10, bodyH - 36)}" rx="2" fill="#FFFFFF" fill-opacity=".45"/>
<path d="${shape}" fill="none" stroke="#2A2622" stroke-width="2.5" stroke-linecap="round"/>
${cork}</svg>`;
}

function tubeButton(puz, i, opts) {
  const tube = puz.tubes[i];
  const lifted = P.sel === i ? ' is-sel' : '';
  const label = tube.length
    ? `Tube ${i + 1}, ${tube.length} of ${puz.capacity} layers${isDone(puz, tube) ? ', corked' : ''}`
    : `Tube ${i + 1}, empty`;
  return `<button type="button" class="pu-tube${lifted}" data-tube="${i}" aria-label="${label}">${tubeSvg(puz, i, opts)}</button>`;
}

function shelfHtml(puz) {
  const n = puz.tubes.length;
  const per = n <= 6 ? n : Math.ceil(n / 2);
  const rows = [];
  for (let r = 0; r * per < n; r++) {
    const cells = [];
    for (let i = r * per; i < Math.min(n, (r + 1) * per); i++) cells.push(tubeButton(puz, i));
    rows.push(`<div class="pu-row" style="--per:${per}">${cells.join('')}</div>`);
  }
  return rows.join('');
}

function statusHtml(puz) {
  const total = puz.colors.length;
  const corked = puz.tubes.filter((t) => isDone(puz, t)).length;
  const hl = corked ? (corked >= total ? 'Every color is corked' : `${corked} of ${total} colors corked`) : 'Pour each color into its own tube';
  return h`<div class="hl">${hl}</div><div class="dt">Tap a tube, then tap where to pour. You can pour onto the same color or into an empty tube.</div>`;
}

function updateStatus() {
  if (P.el.status && !P.result && P.entry) P.el.status.innerHTML = String(statusHtml(P.entry.puzzle));
}

function canAddTube() {
  const st = C.game.state;
  const t = st.settings && st.settings.puzzleTier && (st.settings.puzzleTier.purify || st.settings.puzzleTier.grading);
  return (t || 'relaxed') === 'relaxed';
}

function updateTools() {
  const e = P.entry;
  if (!e) return;
  const undo = ROOT.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !e.puzzle.history.length;
  const add = ROOT.querySelector('[data-action="add-tube"]');
  if (add) {
    add.disabled = !!e.puzzle.extraTubeUsed;
    add.textContent = e.puzzle.extraTubeUsed ? 'Extra tube added' : 'Add an empty tube';
  }
}

function emptyHtml() {
  return h`<div class="screen-head">${backButton('Back to the puzzle table')}<div class="titles"><div class="title">Purify</div></div><div class="spacer"></div></div>
<div class="screen-body pz-body"><div class="card pz-empty"><div class="h2">Nothing to purify right now</div><div class="hint">When a mixer makes a muddy batch, it waits on the puzzle table.</div>${button('Back to the table', { variant: 'primary', attrs: { 'data-action': 'done' } })}</div></div>`;
}

function drawAll() {
  const state = C.game.state;
  P.cb = !!(state.settings && state.settings.colorblind);
  P.sel = null;
  const e = P.entry;
  if (!e) {
    ROOT.innerHTML = String(emptyHtml());
    P.el = {};
    return;
  }
  const puz = e.puzzle;
  P.sig = sigOf(e);
  const batch = (state.muddyBatches || []).find((b) => b.id === e.batchId);
  const jars = batch ? Math.max(1, Math.round(batch.jars)) : 0;
  P.name = C.sim.displayName ? C.sim.displayName(state, e.color) : e.color;
  P.hex = C.sim.economy.colorHex(e.color);
  const addBtn = canAddTube()
    ? button(puz.extraTubeUsed ? 'Extra tube added' : 'Add an empty tube', { disabled: puz.extraTubeUsed, attrs: { 'data-action': 'add-tube' } })
    : '';
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">Purify</div><div class="subtitle">Muddy ${P.name}${jars ? ` \u00b7 ${jars} ${jars === 1 ? 'jar' : 'jars'}` : ''}</div></div>
<button type="button" class="btn pu-undo" data-action="undo" data-tap${puz.history.length ? '' : ' disabled'}>Undo</button></div>
<div class="screen-body pz-body">
<div class="pu-shelf" data-shelf>${raw(shelfHtml(puz))}</div>
<div class="card pz-status" data-status></div>
${addBtn ? h`<div class="pu-tools">${addBtn}</div>` : ''}
</div>`);
  P.el = { shelf: ROOT.querySelector('[data-shelf]'), status: ROOT.querySelector('[data-status]') };
  updateStatus();
}

function sigOf(e) {
  return `${e.batchId}|${e.puzzle.moves}|${e.puzzle.history.length}|${e.puzzle.tubes.length}|${P.cb ? 1 : 0}`;
}

function tubeEl(i) {
  return P.el.shelf && P.el.shelf.querySelector(`[data-tube="${i}"]`);
}

function redrawTube(i, opts) {
  const old = tubeEl(i);
  if (!old) return null;
  const t = document.createElement('div');
  t.innerHTML = tubeButton(P.entry.puzzle, i, opts);
  const fresh = t.firstElementChild;
  old.replaceWith(fresh);
  return fresh;
}

function setSel(i) {
  if (P.sel !== null) {
    const o = tubeEl(P.sel);
    if (o) { o.classList.remove('is-sel'); o.removeAttribute('aria-pressed'); }
  }
  P.sel = i;
  if (i !== null) {
    const n = tubeEl(i);
    if (n) { n.classList.add('is-sel'); n.setAttribute('aria-pressed', 'true'); }
  }
}

// ---------------------------------------------------------------------------
// Pour
// ---------------------------------------------------------------------------

function streamTo(a, b, hex, newLen, moved) {
  if (!a || !b || reduced() || !P.el.shelf) return;
  const sr = P.el.shelf.getBoundingClientRect();
  const L = layerH(P.entry.puzzle);
  const cap = P.entry.puzzle.capacity;
  const x1 = a.left + a.width / 2 - sr.left;
  const y1 = a.top - sr.top + 2; // from the (lifted) mouth
  const x2 = b.left + b.width / 2 - sr.left;
  const y2 = b.top - sr.top + 16 + (cap - newLen) * L;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pu-stream');
  svg.setAttribute('width', sr.width);
  svg.setAttribute('height', sr.height);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M${x1} ${y1} Q${x2} ${y1 - 34} ${x2} ${y2}`);
  path.setAttribute('stroke', hex);
  path.setAttribute('stroke-width', '5');
  svg.appendChild(path);
  P.el.shelf.appendChild(svg);
  const len = path.getTotalLength ? path.getTotalLength() : 200;
  path.style.strokeDasharray = String(len);
  const dur = 360 + moved * 60;
  const anim = path.animate
    ? path.animate([
      { strokeDashoffset: len, offset: 0 },
      { strokeDashoffset: 0, offset: 0.4 },
      { strokeDashoffset: 0, offset: 0.7 },
      { strokeDashoffset: -len, offset: 1 },
    ], { duration: dur, easing: 'ease-in-out', fill: 'both' })
    : null;
  const end = () => svg.remove();
  if (anim) anim.finished.then(end, end); else setTimeout(end, dur);
}

function pour(from, to) {
  const e = P.entry;
  const puz = e.puzzle;
  if (!C.puzzles.purify.canPour(puz, from, to)) {
    C.audio.tick('miss');
    const t = puz.tubes[to];
    setSel(t.length && !isDone(puz, t) ? to : null);
    return;
  }
  const before = puz.tubes[to].length;
  const colorIdx = topOf(puz.tubes[from]);
  const ra = tubeEl(from).getBoundingClientRect(); // measured before the tubes are redrawn
  const rb = tubeEl(to).getBoundingClientRect();
  const res = C.game.act(pourAct, { from, to });
  if (!res || !res.ok) { setSel(null); return; }
  setSel(null);
  redrawTube(from);
  redrawTube(to, { newN: res.moved, corkNew: res.completedTube });
  streamTo(ra, rb, puz.colors[colorIdx], before + res.moved, res.moved);
  const hex = puz.colors[colorIdx];
  const Lc = lightnessOf(C, hex);
  const hz = clamp(C.color.noteHz(Lc), 247, 523);
  const len = C.audio.glug((before + res.moved) / puz.capacity, { fromRatio: before / puz.capacity, layers: res.moved, hz }) || (0.32 + 0.2 * res.moved);
  C.haptics.light();
  if (res.completedTube) {
    C.audio.note(Lc, len + 0.02, 0.18, 0.8);
    C.audio.cork(len + 0.14);
    later(() => C.haptics.medium(), (len + 0.14) * 1000);
  }
  updateStatus();
  updateTools();
  P.sig = sigOf(e);
  if (res.solved && res.reward) {
    P.celebrating = true;
    P.reward = res.reward;
    later(startCelebration, 480);
  }
}

// ---------------------------------------------------------------------------
// Celebration and result
// ---------------------------------------------------------------------------

function startCelebration() {
  if (!P.celebrating) return;
  const puz = P.entry ? P.entry.puzzle : null;
  const colors = (puz ? puz.colors : []).map((hx) => lightnessOf(C, hx));
  C.fx.shimmerSweep(P.el.shelf, { ms: 800 });
  C.audio.arpeggio(colors);
  C.haptics.success();
  later(finalize, 780);
}

function skip() {
  if (!P.celebrating) return;
  clearTimers();
  finalize();
}

function finalize() {
  if (!P.celebrating) return;
  clearTimers();
  P.celebrating = false;
  const r = P.reward;
  P.result = r;
  const more = (C.game.state.muddyBatches || []).filter((b) => b.id !== (P.entry && P.entry.batchId));
  const card = h`<div class="card pz-result" data-result>
<div class="row">${swatch(P.hex, 44)}<div class="grow"><div class="hl">Pure batch of ${P.name}: sells for 1.5×</div><div class="hint">Every color in its own tube. This batch is now high purity.</div></div></div>
<ul class="lines">
<li>${iconSvg('check', { size: 18 })}<span>${Math.max(0, Math.round(r.jars))} ${Math.round(r.jars) === 1 ? 'jar' : 'jars'} added to your stock</span></li>
${r.coins > 0 ? h`<li>${iconSvg('coin', { size: 18 })}<span>+${fmt(r.coins)} coins from jars that did not fit</span></li>` : ''}
</ul>
<div class="pz-actions">${more.length ? button('Next batch', { variant: 'primary', attrs: { 'data-action': 'next-batch', 'data-batch': more[0].id } }) : ''}${button('Back to the table', { variant: more.length ? 'paper' : 'primary', attrs: { 'data-action': 'done' } })}</div>
</div>`;
  if (P.el.status) {
    const wrap = document.createElement('div');
    wrap.innerHTML = String(card);
    P.el.status.replaceWith(wrap.firstElementChild);
    P.el.status = null;
  }
  const undo = ROOT.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = true;
  const add = ROOT.querySelector('[data-action="add-tube"]');
  if (add) add.disabled = true;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function tapTube(i) {
  if (P.celebrating) { skip(); return; }
  if (P.result || !P.entry) return;
  const puz = P.entry.puzzle;
  const tubes = puz.tubes;
  if (P.sel === null) {
    if (!tubes[i].length || isDone(puz, tubes[i])) { C.audio.tick('blocked'); return; }
    setSel(i);
    C.audio.tick('select');
    C.haptics.light();
  } else if (P.sel === i) {
    setSel(null);
    C.audio.tick('deselect');
  } else {
    pour(P.sel, i);
  }
}

function onClick(e) {
  const tube = e.target.closest('[data-tube]');
  if (tube && ROOT.contains(tube)) { tapTube(Number(tube.dataset.tube)); return; }
  if (P.celebrating && e.target.closest('[data-shelf]')) { skip(); return; }
  const a = e.target.closest('[data-action]');
  if (!a || !ROOT.contains(a)) return;
  const act = a.dataset.action;
  if (act === 'undo') {
    if (!P.entry || P.result) return;
    const r = C.game.act(undoAct);
    if (r && r.ok) {
      setSel(null);
      redrawTube(r.from);
      redrawTube(r.to);
      C.audio.tick('deselect');
      C.haptics.light();
      P.sig = sigOf(P.entry);
      updateStatus();
      updateTools();
    }
  } else if (act === 'add-tube') {
    if (!P.entry || P.result) return;
    const r = C.game.act(addTubeAct);
    if (r && r.ok) {
      C.audio.tick('select');
      drawAll();
    }
  } else if (act === 'done') {
    P.result = null;
    C.back();
  } else if (act === 'next-batch') {
    const batchId = a.dataset.batch;
    P.result = null;
    C.game.act((s, args, now) => createPurifyPuzzle(C, s, args, now), { batchId });
    P.entry = activeOf(C.game.state).purify;
    drawAll();
  }
}

function adopt(params) {
  const st = C.game.state;
  let e = activeOf(st).purify;
  const want = params && params.batchId;
  const batches = st.muddyBatches || [];
  if (e && !batches.some((b) => b.id === e.batchId)) {
    C.game.act((s) => { ensureActive(s).purify = null; });
    e = null;
  }
  if (want && (!e || e.batchId !== want)) {
    if (batches.some((b) => b.id === want)) {
      C.game.act((s, a, now) => createPurifyPuzzle(C, s, a, now), { batchId: want });
    }
  } else if (!e && !want && batches.length) {
    C.game.act((s, a, now) => createPurifyPuzzle(C, s, a, now), { batchId: batches[0].id });
  }
  return activeOf(C.game.state).purify || null;
}

export default {
  id: 'purify',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('shared', PZ_CSS);
    injectStyle('purify', CSS);
    ensureDefs();
    root.addEventListener('click', onClick);
  },

  show(params = {}) {
    P.visible = true;
    clearTimers();
    if (P.result && !params.batchId && !(activeOf(C.game.state).purify)) return; // back from a ceremony: keep the result card
    P.result = null;
    P.celebrating = false;
    P.entry = adopt(params);
    drawAll();
  },

  hide() {
    P.visible = false;
    clearTimers();
    P.celebrating = false;
    P.result = null;
  },

  render(state) {
    if (!ROOT || !P.visible || P.celebrating || P.result) return;
    const e = activeOf(state).purify || null;
    const cb = !!(state.settings && state.settings.colorblind);
    if (e !== P.entry || cb !== P.cb || (e && sigOf(e) !== P.sig)) {
      P.entry = e;
      drawAll();
    }
  },
};
