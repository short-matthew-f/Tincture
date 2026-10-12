// app.js — the Knitting Room prototype page.
import {
  newPiece, build, apply, applyMany, undo, ripRow, parseRow, planSteps, written, status, nextStitch,
  asItAppears, repeatToEnd, repeatPasses, appearSteps, STITCHES, STITCH_GROUPS, DEFAULT_YARNS,
} from './engine.js';
import { drawFabric, drawChart, drawTube } from './render.js';
import { SAMPLES } from './samples.js';

const KEY = 'tincture.proto.knit';
const $ = (sel) => document.querySelector(`[data-ref="${sel}"]`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PALETTE = [
  ['Cream', '#EFE6D2'], ['Madder', '#B8433A'], ['Woad', '#3E6A9E'], ['Weld', '#E3C65A'], ['Walnut', '#6B4A32'], ['Sage', '#8A9A6B'],
  ['Indigo', '#2C3E66'], ['Cochineal', '#C2507A'], ['Logwood', '#5B3B6E'], ['Ochre', '#D9A63A'], ['Rust', '#A4562D'], ['Charcoal', '#2E2B28'],
  ['Lichen', '#B7B48A'], ['Teal', '#2F7774'], ['Blush', '#E3A8A0'], ['Oat', '#CDBB98'], ['Sky', '#9BB8D3'], ['Moss', '#55663C'],
];

let piece = load() || newPiece({ stitches: 20 });
let S = build(piece);
const view = { mode: 'fabric', face: 'RS', zoom: 1.4, tab: 'dec', spin: 0 };
let recorder = null; // [ops] while recording a repeat
let lastMade = null;

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.log && v.yarns ? v : null; } catch (e) { return null; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(piece)); } catch (e) { /* storage may be off */ } }, 200);
}
function tick() { try { navigator.vibrate && navigator.vibrate(6); } catch (e) { /* no haptics */ } }
function say(text) { $('msg').textContent = text || ''; }

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function commit(res, okText) {
  if (res && res.state) S = res.state;
  else S = build(piece);
  lastMade = S.cells.length - 1;
  save();
  render();
  if (res && res.ok === false && res.reason) say(gentle(res.reason));
  else say(okText || '');
}

function gentle(reason) {
  if (/Not enough stitches/.test(reason)) return `${reason} The row is nearly done.`;
  return reason;
}

function stitch(op) {
  if (S.finished) { say('This piece is bound off. Start a new one, or undo to keep going.'); return; }
  const r = apply(piece, { t: 'st', op }, S);
  if (r.ok) { tick(); if (recorder) recorder.push(op); }
  commit(r);
}

function many(entries, text) {
  if (!entries.length) { say('Nothing to work there.'); return; }
  const r = applyMany(piece, entries);
  tick();
  commit(r, r.ok && r.done === entries.length ? text : `Worked ${r.done} steps. ${r.reason || ''}`);
}

function typedRow() {
  const input = $('typed');
  const p = parseRow(input.value);
  if (!p.ok) { say(p.error); return; }
  const plan = planSteps(piece, p.plan);
  if (!plan.steps.length) { say('That row does not fit the stitches on the needle yet.'); return; }
  const r = applyMany(piece, plan.steps);
  commit(r);
  const st = status(S);
  if (st.worked > 0 && st.left > 0) say(`Worked ${st.worked}; ${st.left} stitch${st.left === 1 ? '' : 'es'} left in this row.`);
  else say('Row done.');
  input.select();
}

function loadSample(id) {
  const smp = SAMPLES.find((x) => x.id === id);
  if (!smp) return;
  piece = newPiece({ stitches: smp.co, mode: smp.mode, yarn: smp.yarn });
  for (const text of smp.rows) {
    const p = parseRow(text);
    if (!p.ok) break;
    const plan = planSteps(piece, p.plan);
    applyMany(piece, plan.steps);
  }
  view.mode = smp.mode === 'round' && smp.id === 'hat' ? 'tube' : 'fabric';
  view.face = 'RS';
  commit(null, `${smp.name}: ${smp.note}`);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  renderViews();
  renderStatus();
  renderNeedle();
  renderPad();
  renderHelpers();
  renderYarns();
  draw();
}

function renderViews() {
  const round = piece.log[0].mode === 'round';
  const b = (id, label, on) => `<button class="btn small" data-view="${id}" aria-pressed="${on}">${label}</button>`;
  $('views').innerHTML = [
    b('fabric', 'Fabric', view.mode === 'fabric'),
    b('chart', 'Chart', view.mode === 'chart'),
    round ? b('tube', 'Tube', view.mode === 'tube') : '',
    view.mode === 'fabric' ? b('face', view.face === 'RS' ? 'Right side' : 'Wrong side', view.face === 'WS') : '',
    b('zin', '+', false), b('zout', '&minus;', false),
  ].join('');
}

function renderStatus() {
  const st = status(S);
  const y = S.yarns.find((x) => x.id === S.yarn);
  const where = st.finished ? 'Bound off' : st.round ? `Rnd ${st.pass}` : `${st.kind === 'short' ? 'Short row' : 'Row'} ${st.pass} (${st.side})`;
  const dir = st.finished ? '' : st.side === 'RS' ? '&#8592;' : '&#8594;';
  $('status').innerHTML = `<span class="grow"><b>${where}</b> ${dir} &nbsp;stitch ${Math.min(st.worked + 1, st.total)} of ${st.total}${recorder ? ' &nbsp;<b>recording</b>' : ''}</span>
    <span class="hint">${st.rows} row${st.rows === 1 ? '' : 's'}</span>
    <span style="width:22px;height:22px;border-radius:7px;background:${y ? y.hex : '#ccc'};box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)" title="Working yarn"></span>`;
}

function renderNeedle() {
  const el = $('needle');
  const nx = nextStitch(S);
  const parts = [];
  const lo = S.dir < 0 ? 0 : S.cursor;
  S.live.forEach((id, i) => {
    if (typeof id === 'string') { parts.push('<i class="mk"></i>'); return; }
    const c = S.cells[id];
    const hex = (S.yarns.find((y) => y.id === c.color) || {}).hex || '#ccc';
    const done = S.dir < 0 ? i >= S.cursor : i < S.cursor;
    parts.push(`<i class="${done ? 'done' : ''}${nx && nx.id === id ? ' next' : ''}" style="background:${hex}"></i>`);
  });
  void lo;
  el.innerHTML = parts.join('');
  const n = el.querySelector('.next');
  if (n) el.scrollLeft = n.offsetLeft - el.clientWidth / 2;
}

function renderPad() {
  $('tabs').innerHTML = STITCH_GROUPS.filter((g) => g.id !== 'basic' || true).map((g) => `<button class="btn small" data-tab="${g.id}" aria-pressed="${view.tab === g.id}">${g.name}</button>`).join('');
  const ops = Object.entries(STITCHES).filter(([, d]) => d.group === view.tab);
  $('pad').innerHTML = ops.map(([op, d]) => `<button class="btn" data-st="${op}" title="${esc(d.name)}">${esc(d.label)}<small>${esc(d.name)}</small></button>`).join('');
}

function renderHelpers() {
  const st = status(S);
  const flat = piece.log[0].mode !== 'round';
  const h = [];
  h.push('<button class="btn small" data-act="kend">k to end</button>');
  h.push('<button class="btn small" data-act="pend">p to end</button>');
  h.push('<button class="btn small" data-act="appearend">as they appear to end</button>');
  h.push(recorder ? `<button class="btn small rec" data-act="recend">rep from * to end (${recorder.length})</button><button class="btn small" data-act="recstop">stop</button>`
    : '<button class="btn small" data-act="recstart">* start repeat</button>');
  h.push(`<button class="btn small" data-act="rep2">repeat last ${flat ? '2 rows' : 'round'}</button>`);
  h.push('<button class="btn small" data-act="pm">pm</button>');
  h.push('<button class="btn small" data-act="wt">w&amp;t</button>');
  h.push('<button class="btn small" data-act="turn">turn</button>');
  h.push('<button class="btn small" data-act="ds">turn, DS</button>');
  if (flat && st.worked === 0) h.push('<button class="btn small" data-act="slide">slide</button>');
  $('helpers').innerHTML = h.join('');
}

function renderYarns() {
  $('yarns').innerHTML = S.yarns.map((y) => {
    const dark = parseInt(y.hex.slice(1), 16);
    const l = (0.2126 * ((dark >> 16) & 255) + 0.7152 * ((dark >> 8) & 255) + 0.0722 * (dark & 255)) / 255;
    return `<button class="yarn" data-yarn="${y.id}" aria-pressed="${S.yarn === y.id}" style="background:${y.hex};color:${l > 0.6 ? '#2A2622' : '#FBF8F1'}" aria-label="Yarn ${y.id}, ${esc(y.name)}">${y.id}</button>`;
  }).join('');
}

function draw() {
  const stage = $('stage');
  const canvas = $('canvas');
  const minWidth = stage.clientWidth;
  let res;
  if (view.mode === 'chart') res = drawChart(canvas, S, { zoom: view.zoom, minWidth });
  else if (view.mode === 'tube') res = drawTube(canvas, S, { zoom: view.zoom, minWidth, spin: view.spin });
  else res = drawFabric(canvas, S, { face: view.face, zoom: view.zoom, minWidth, highlight: lastMade });
  // Keep the newest rows (at the top) in view.
  stage.scrollTop = 0;
  if (res && res.width > stage.clientWidth) stage.scrollLeft = (res.width - stage.clientWidth) / 2;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function sheet(html, onClick) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => {
    if (e.target === bg) { close(); return; }
    const t = e.target.closest('[data-pick],[data-close],[data-go]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { close(); return; }
    onClick(t, close, bg);
  });
  return { close, el: bg };
}

function samplesSheet() {
  sheet(`<h2>Samples</h2><p class="hint">Each one is knit from written US rows, so you can open the pattern and check it.</p>
    <div class="list">${SAMPLES.map((s) => `<button class="btn" data-pick="${s.id}">${esc(s.name)}<small>${esc(s.note)} &middot; CO ${s.co}${s.mode === 'round' ? ', in the round' : ''}</small></button>`).join('')}</div>
    <p><button class="btn" data-close style="width:100%">Close</button></p>`, (t, close) => { loadSample(t.getAttribute('data-pick')); close(); });
}

function newSheet() {
  const h = sheet(`<h2>Cast on</h2>
    <div class="field">Stitches<input type="number" inputmode="numeric" min="1" max="400" value="${status(S).total || 20}" data-ref="co"></div>
    <p class="row"><button class="btn" data-pick="flat" style="flex:1">Flat</button><button class="btn" data-pick="round" style="flex:1">In the round</button></p>
    <p class="hint">Your current piece is replaced. The yarns you dyed stay.</p>
    <p><button class="btn" data-close style="width:100%">Cancel</button></p>`, (t, close, bg) => {
    const n = Math.max(1, Math.min(400, parseInt(bg.querySelector('[data-ref="co"]').value, 10) || 20));
    piece = newPiece({ stitches: n, mode: t.getAttribute('data-pick'), yarn: S.yarn, yarns: piece.yarns });
    view.mode = 'fabric';
    view.face = 'RS';
    close();
    commit(null, `Cast on ${n}. ${t.getAttribute('data-pick') === 'round' ? 'Joined in the round.' : ''}`);
  });
  return h;
}

function yarnSheet(id) {
  const y = piece.yarns.find((x) => x.id === id);
  sheet(`<h2>Yarn ${id}</h2><p class="hint">Dye it any color. Stitches already knit in yarn ${id} change too.</p>
    <div class="swatches">${PALETTE.map(([n, hex]) => `<button data-pick="${hex}" data-name="${n}" style="background:${hex}" aria-label="${n}"></button>`).join('')}</div>
    <p><button class="btn" data-close style="width:100%">Done</button></p>`, (t, close) => {
    y.hex = t.getAttribute('data-pick');
    y.name = t.getAttribute('data-name');
    S = build(piece);
    save();
    render();
    close();
  });
}

function patternSheet() {
  const lines = written(S, piece);
  sheet(`<h2>Written pattern</h2><div class="pattern">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
    <p class="row"><button class="btn" data-go="copy" style="flex:1">Copy</button><button class="btn" data-close style="flex:1">Close</button></p>`, (t) => {
    if (t.getAttribute('data-go') === 'copy') {
      try { navigator.clipboard.writeText(lines.join('\n')); t.textContent = 'Copied'; } catch (e) { t.textContent = 'Copy is not available here'; }
    }
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  if (e.target.closest('.sheet-bg')) return;
  const st = e.target.closest('[data-st]');
  if (st) { stitch(st.getAttribute('data-st')); st.classList.remove('pulse'); void st.offsetWidth; st.classList.add('pulse'); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { view.tab = tab.getAttribute('data-tab'); renderPad(); return; }
  const v = e.target.closest('[data-view]');
  if (v) {
    const id = v.getAttribute('data-view');
    if (id === 'face') view.face = view.face === 'RS' ? 'WS' : 'RS';
    else if (id === 'zin') view.zoom = Math.min(3, view.zoom * 1.2);
    else if (id === 'zout') view.zoom = Math.max(0.5, view.zoom / 1.2);
    else view.mode = id;
    renderViews();
    draw();
    return;
  }
  const yb = e.target.closest('[data-yarn]');
  if (yb) {
    const id = yb.getAttribute('data-yarn');
    if (S.yarn === id) { yarnSheet(id); return; }
    commit(apply(piece, { t: 'yarn', id }, S), `Working with yarn ${id}.`);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  switch (a.getAttribute('data-act')) {
    case 'appear': { const op = asItAppears(S); if (op) stitch(op); break; }
    case 'undo': commit({ state: undo(piece, 1) }, 'Unknit one.'); break;
    case 'rip': commit({ state: ripRow(piece) }, 'Ripped back. The yarn is ready to use again.'); break;
    case 'kend': many(repeatToEnd(S, ['k']), 'Knit to the end.'); break;
    case 'pend': many(repeatToEnd(S, ['p']), 'Purled to the end.'); break;
    case 'appearend': many(appearSteps(piece), 'Worked the stitches as they appear.'); break;
    case 'recstart': recorder = []; say('Work the repeat once, then tap "rep from * to end".'); render(); break;
    case 'recstop': recorder = null; render(); break;
    case 'recend': { const ops = recorder || []; recorder = null; many(repeatToEnd(S, ops), 'Repeated to the end.'); break; }
    case 'rep2': many(repeatPasses(S, piece.log[0].mode === 'round' ? 1 : 2), 'Repeated.'); break;
    case 'pm': commit(apply(piece, { t: 'pm' }, S), 'Marker placed.'); break;
    case 'wt': commit(apply(piece, { t: 'turn', kind: 'wt' }, S), 'Wrapped and turned.'); break;
    case 'turn': commit(apply(piece, { t: 'turn', kind: 'turn' }, S), 'Turned.'); break;
    case 'ds': commit(apply(piece, { t: 'turn', kind: 'ds' }, S), 'Turned; the first stitch is a double stitch.'); break;
    case 'slide': commit(apply(piece, { t: 'slide' }, S), 'Slid the stitches back. Same side again.'); break;
    case 'typed': typedRow(); break;
    case 'pattern': patternSheet(); break;
    case 'samples': samplesSheet(); break;
    case 'new': newSheet(); break;
    default: break;
  }
});

$('typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typedRow(); } });

// Drag across the tube to turn it.
(() => {
  const stage = $('stage');
  let x0 = null;
  stage.addEventListener('pointerdown', (e) => { if (view.mode === 'tube') x0 = e.clientX; });
  stage.addEventListener('pointermove', (e) => { if (x0 === null) return; view.spin += (e.clientX - x0) / 60; x0 = e.clientX; draw(); });
  const up = () => { x0 = null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
})();

window.addEventListener('resize', () => draw());
render();
if (piece.log.length === 1) say('Cast on 20. Tap k and p, or type a row, or open Samples.');
window.knit = { get piece() { return piece; }, get state() { return S; } };
