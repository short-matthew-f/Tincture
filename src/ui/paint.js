/**
 * paint.js: the fullscreen painting screen (overlay `paint`).
 *
 * Owns: the canvas SVG (regions as tappable panes filled from `piece.regions`,
 * unpainted panes in card paper, ink leading on top), the palette of colors she
 * has in stock, the "uses N jars a pane" line, the pour-fill + glug on every
 * pane, a local undo stack, the suggested-palette hint row, the Sign sheet
 * (title, value reveal with a rolling number, Hang it / Keep in archive) and
 * image export (PNG download and Web Share with a file). Implements DESIGN.md
 * "The Gallery > Painting / Piece value / The gallery walls" and the "Pour"
 * row of "Interaction feel > Interaction spec"; the look is
 * docs/prototypes/Gallery.dc.html.
 *
 * Also exports `canvasSvgMarkup` and `exportPieceImage`, which gallery.js
 * reuses for its framed mini-renders.
 *
 * Params: show({pieceId}). data-actions: sign, sign-confirm, sign-cancel,
 * hang, archive, undo, export, share, pick, family, close-sheet.
 */

import { h, raw, backButton, button, safeHex, escapeHtml } from './kit.js';
import { textColorOn } from '../color.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';

export const PAPER_PANE = '#FBF8F1';

/** One representative hex per hue family (used for hints; never an exact catalog color). */
export const FAMILY_HEX = Object.freeze({
  red: '#B8433A', orange: '#D9792E', yellow: '#D9A93A', green: '#6E9A55', teal: '#3F8F8A',
  blue: '#3E6A9E', violet: '#7A5A9A', pink: '#D98A9F', neutral: '#9A9288',
});

const FAMILY_NAME = Object.freeze({
  red: 'Reds', orange: 'Oranges', yellow: 'Yellows', green: 'Greens', teal: 'Teals',
  blue: 'Blues', violet: 'Violets', pink: 'Pinks', neutral: 'Neutrals',
});

const GLUG_HZ = Object.freeze({ 1: 392, 2: 330, 3: 262 });

// ---------------------------------------------------------------------------
// Shared canvas renderer (also used by gallery.js)
// ---------------------------------------------------------------------------

let svgUid = 0;

/**
 * canvasSvgMarkup(canvas, fills, {interactive, label, exportMode}) -> SVG string.
 * `fills` maps regionId -> hex. Unpainted panes are card paper. Interactive
 * mode adds `.pane[data-region]` handles and the staging clipPath that
 * fx.pourFill floods (it must be the first clipPath in the SVG).
 */
export function canvasSvgMarkup(canvas, fills = {}, { interactive = false, label = '', exportMode = false } = {}) {
  if (!canvas) return '';
  const vb = canvas.viewBox || '0 0 300 400';
  const outline = escapeHtml(canvas.outline || '');
  const uid = `cv${++svgUid}`;
  const panes = (canvas.regions || []).map((r, i) => {
    const fill = safeHex(fills[r.id] || '', PAPER_PANE);
    const a = interactive
      ? ` class="pane" data-region="${escapeHtml(r.id)}" role="button" tabindex="0" aria-label="Pane ${i + 1}, ${fills[r.id] ? 'painted' : 'not painted yet'}"`
      : '';
    return `<path${a} d="${escapeHtml(r.d)}" fill="${fill}"/>`;
  }).join('');
  const defs = interactive ? `<defs><clipPath id="${uid}-clip"><path d=""/></clipPath></defs>` : '';
  const aria = label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"';
  const ns = exportMode ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  return `<svg class="canvas-svg"${ns} viewBox="${escapeHtml(vb)}" ${aria} data-canvas="${escapeHtml(canvas.id)}">${defs}
<g opacity="0.28" transform="translate(0 4)"><path d="${outline}" fill="#2A2622" stroke="#2A2622" stroke-width="22" stroke-linejoin="round"/></g>
<path d="${outline}" fill="#7B5236" stroke="#7B5236" stroke-width="22" stroke-linejoin="round"/>
<path d="${outline}" fill="none" stroke="#5E3E28" stroke-width="2" transform="translate(0 0)"/>
<g data-fill-layer="">${panes}</g>
<path d="${escapeHtml(canvas.leading || '')}" fill="none" stroke="#2A2622" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" style="pointer-events:none"/>
</svg>`;
}

function svgToPngBlob(svgText, w, h2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h2;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h2);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), 'image/png');
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('image failed'));
    img.src = url;
  });
}

/**
 * exportPieceImage(canvas, fills, {title, share}) -> Promise<{ok, shared?}>.
 * Renders the piece to a 900x1200 PNG on a plaster ground, then either shares
 * it as a file (share:true, when the browser can) or downloads it.
 */
export async function exportPieceImage(canvas, fills, { title = '', share = false } = {}) {
  const inner = canvasSvgMarkup(canvas, fills, { exportMode: true, label: title || canvas.name })
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 300 400"><rect width="300" height="400" fill="#E3E6E0"/>${inner}</svg>`;
  const blob = await svgToPngBlob(svg, 900, 1200);
  const safeName = (title || canvas.name || 'painting').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'painting';
  const file = typeof File === 'function' ? new File([blob], `${safeName}.png`, { type: 'image/png' }) : null;
  if (share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title || canvas.name || 'My painting' });
      return { ok: true, shared: true };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: true, shared: false };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true, shared: false };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
#screen-paint .pt-stage{flex:1 1 0;min-height:0;display:flex;align-items:center;justify-content:center;padding:2px 20px}
#screen-paint .pt-stage svg{height:100%;width:100%;max-height:100%;overflow:visible}
#screen-paint .pane{cursor:pointer;transition:opacity 120ms}
#screen-paint .pane:active{opacity:.82}
#screen-paint .pane:focus{outline:none}
#screen-paint .pane:focus-visible{outline:none;stroke:#2A2622;stroke-width:3}
#screen-paint .pt-tools{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:0 16px 8px}
#screen-paint .pt-tools .grow{flex:1 1 auto}
#screen-paint .pt-palette{flex:0 0 auto;margin:0 14px calc(14px + var(--safe-bottom));border-radius:16px;padding:12px 14px;gap:8px}
#screen-paint .pt-chips{display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,48px);grid-auto-columns:56px;gap:10px;overflow-x:auto;overflow-y:hidden;padding:8px 10px 10px;margin:0 -10px;scrollbar-width:none}
#screen-paint .pt-chips.one-row{grid-template-rows:48px}
#screen-paint .pt-chips::-webkit-scrollbar{display:none}
#screen-paint .pt-chip{position:relative;width:56px;height:48px;border-radius:12px;box-shadow:0 3px 0 rgba(42,38,34,.25);transition:transform 120ms}
#screen-paint .pt-chip.is-sel{box-shadow:0 0 0 3px #F7F4EC,0 0 0 6px #2A2622;transform:translateY(-1px)}
#screen-paint .pt-chip.is-low{opacity:.55}
#screen-paint .pt-chip .n{position:absolute;right:5px;bottom:3px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
#screen-paint .pt-suggest{display:flex;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none}
#screen-paint .pt-suggest::-webkit-scrollbar{display:none}
#screen-paint .pt-fam{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border-radius:999px;background:#E3E6E0;font-size:12px;font-weight:600;white-space:nowrap;flex:0 0 auto}
#screen-paint .pt-fam i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(42,38,34,.25)}
#screen-paint .pt-fam[aria-pressed="true"]{background:#2A2622;color:#F7F4EC}
#screen-paint .pt-scrim{position:absolute;inset:0;z-index:20;background:rgba(42,38,34,.45);display:flex;align-items:flex-end;justify-content:center;animation:fade-in 160ms ease-out both}
#screen-paint .pt-scrim[hidden]{display:none}
#screen-paint .pt-sheet{width:100%;max-width:520px;max-height:92%}
#screen-paint .pt-title-input{width:100%;min-height:48px;border-radius:12px;border:0;padding:0 14px;background:#fff;box-shadow:inset 0 0 0 2px rgba(42,38,34,.18);font-family:var(--font-display);font-size:18px;user-select:text;-webkit-user-select:text}
#screen-paint .pt-title-input:focus{outline:none;box-shadow:inset 0 0 0 2px #2A2622}
#screen-paint .pt-value{font-family:var(--font-display);font-size:44px;line-height:1;text-align:center;font-variant-numeric:tabular-nums}
#screen-paint .pt-bd{display:flex;justify-content:space-between;font-size:14px;padding:3px 0}
#screen-paint .pt-bd + .pt-bd{border-top:1px solid rgba(42,38,34,.08)}
#screen-paint .pt-mini{width:96px;margin:0 auto}
#screen-paint .pt-mini svg{width:100%;height:auto}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('paint-css')) return;
  const s = document.createElement('style');
  s.id = 'paint-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let fx = fxDefault;
let audio = audioDefault;
let haptics = hapticsDefault;

const ui = {
  pieceId: null,
  canvasId: null,
  sel: null,            // selected color id
  undo: [],             // [{regionId, prev: colorId|null}]
  pending: new Set(),   // regionIds whose pour is still flooding
  family: null,         // active suggested-family filter
  sheet: null,          // null | 'sign' | 'reveal'
  title: '',
  lastCost: 0,
  chipSig: '',
  busy: false,
};

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);
const hexOf = (id) => sim().colorHex(id);

function piece() {
  return (state().gallery?.pieces || []).find((p) => p.id === ui.pieceId) || null;
}
function canvas() {
  const p = piece();
  return p ? ctx.content.getCanvas(p.canvas) : null;
}
function fillsOf(p) {
  const out = {};
  for (const [rid, cid] of Object.entries(p?.regions || {})) out[rid] = hexOf(cid);
  return out;
}

function paintedCount(p, cv) {
  return (cv?.regions || []).filter((r) => p?.regions?.[r.id]).length;
}

function costs(cv) {
  const set = new Set((cv?.regions || []).map((r) => sim().gallery.regionCost(cv.id, r.id)).filter(Boolean));
  return [...set].sort((a, b) => a - b);
}

function costLine(cv) {
  if (ui.lastCost) return `That pane uses ${ui.lastCost} jars`;
  const c = costs(cv);
  if (!c.length) return '';
  if (c.length === 1) return `Uses ${c[0]} jars a pane`;
  return `Uses ${c[0]} jars a pane, more for big ones`;
}

function stockColors() {
  const st = state();
  return sim().discoveredColors(st)
    .map((c) => ({ ...c, jars: sim().storage.stockOf(st, c.id) }))
    .filter((c) => c.jars > 0.0001);
}

function famOf(id) {
  return sim().economy.colorFamily(id);
}

// ---- build ----------------------------------------------------------------

function buildAll() {
  const p = piece();
  const cv = canvas();
  if (!p || !cv) {
    root.innerHTML = '';
    return;
  }
  ui.canvasId = cv.id;
  const signed = !!p.signedAt;
  const fam = (cv.suggestedPalette || []);
  root.innerHTML = String(h`
<div class="screen-head">
  ${backButton('Back to the Gallery')}
  <div class="titles"><div class="title" data-ref="title"></div><div class="subtitle" data-ref="progress"></div></div>
  <span data-ref="signslot"></span>
</div>
<div class="pt-stage" data-ref="stage" data-coach="paint">${raw(canvasSvgMarkup(cv, fillsOf(p), { interactive: !signed, label: cv.name }))}</div>
<div class="pt-tools">
  ${button('Undo', { small: true, attrs: { 'data-action': 'undo', 'data-ref': 'undo' }, disabled: true })}
  <span class="grow"></span>
  ${button('Save image', { small: true, attrs: { 'data-action': 'export' } })}
  <span data-ref="shareslot"></span>
</div>
<div class="card pt-palette" data-ref="palette" ${signed ? 'hidden' : ''}>
  <div class="row between"><div class="serif" style="font-size:17px" data-ref="selname"></div><div class="small muted" data-ref="jars"></div></div>
  ${fam.length ? h`<div class="pt-suggest" data-ref="suggest"><span class="small muted nowrap">Suggested</span>${fam.map((f) => h`<button type="button" class="pt-fam" data-tap data-action="family" data-family="${f}" aria-pressed="false"><i style="background:${FAMILY_HEX[f] || '#9A9288'}"></i>${FAMILY_NAME[f] || f}</button>`)}</div>` : ''}
  <div class="pt-chips" data-ref="chips"></div>
  <div class="hint" data-ref="hint">Pick a color, then tap a pane. Any color can go anywhere.</div>
</div>
<div class="pt-scrim" data-ref="layer" data-action="close-sheet" hidden></div>`);
  ui.chipSig = '';
  if (navigator.canShare && typeof File === 'function') {
    try {
      if (navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) {
        q('[data-ref=shareslot]').innerHTML = String(button('Share', { small: true, attrs: { 'data-action': 'share' } }));
      }
    } catch (e) { /* no sharing */ }
  }
  update();
}

// ---- update (cheap, never rebuilds the SVG) -------------------------------

function setFill(rid, hex) {
  const el = root.querySelector(`.pane[data-region="${CSS_ESC(rid)}"]`);
  if (!el) return;
  el.setAttribute('fill', hex || PAPER_PANE);
  const idx = (canvas()?.regions || []).findIndex((r) => r.id === rid);
  el.setAttribute('aria-label', `Pane ${idx + 1}, ${hex ? 'painted' : 'not painted yet'}`);
}
const CSS_ESC = (s) => String(s).replace(/["\\]/g, '\\$&');

function updateChips() {
  const wrap = q('[data-ref=chips]');
  if (!wrap) return;
  let list = stockColors();
  if (ui.family) list = list.filter((c) => famOf(c.id) === ui.family);
  const st = state();
  if (!ui.sel || !stockColors().some((c) => c.id === ui.sel)) {
    ui.sel = (list[0] || stockColors()[0] || {}).id || null;
  }
  const sig = list.map((c) => c.id + (c.id === ui.sel ? '*' : '') + (c.jars < 3 ? 'L' : '')).join('|') + '#' + (ui.family || '');
  if (sig !== ui.chipSig) {
    ui.chipSig = sig;
    wrap.classList.toggle('one-row', list.length <= 6);
    wrap.innerHTML = list.length
      ? String(h`${list.map((c) => h`<button type="button" class="pt-chip ${c.id === ui.sel ? 'is-sel' : ''} ${c.jars < 3 ? 'is-low' : ''}" data-tap data-action="pick" data-color="${c.id}" aria-label="${sim().displayName(st, c.id)}, ${Math.floor(c.jars)} jars" aria-pressed="${c.id === ui.sel}" style="background:${safeHex(c.hex)};color:${textColorOn(safeHex(c.hex))}"><span class="n" data-jars="${c.id}">${Math.floor(c.jars)}</span></button>`)}`)
      : String(h`<div class="small muted" style="grid-row:1;grid-column:1 / span 6;align-self:center">${ui.family ? 'None of those colors are in stock yet. Clear the filter to see all.' : 'Your vats are empty for now. Let the mixers run, then come back to paint.'}</div>`);
  } else {
    for (const c of list) {
      const n = wrap.querySelector(`[data-jars="${CSS_ESC(c.id)}"]`);
      if (n) n.textContent = String(Math.floor(c.jars));
    }
  }
  const selEntry = stockColors().find((c) => c.id === ui.sel);
  q('[data-ref=selname]').textContent = ui.sel ? sim().displayName(st, ui.sel) : 'No paint in stock';
  q('[data-ref=jars]').textContent = selEntry ? `${Math.floor(selEntry.jars)} jars left` : '';
  root.querySelectorAll('.pt-fam').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.family === ui.family)));
}

function update() {
  const p = piece();
  const cv = canvas();
  if (!p || !cv) return;
  const signed = !!p.signedAt;
  const done = paintedCount(p, cv);
  const total = cv.regions.length;
  q('[data-ref=title]').textContent = signed ? (p.title || cv.name) : cv.name;
  q('[data-ref=progress]').textContent = signed
    ? 'Signed and finished'
    : done >= total ? 'All painted. Ready to sign.' : `${done} painted, ${total - done} to go`;
  const slot = q('[data-ref=signslot]');
  const slotKey = signed ? 'signed' : done >= total ? 'ready' : 'wait';
  if (slot.dataset.key !== slotKey) {
    slot.dataset.key = slotKey;
    slot.innerHTML = signed
      ? String(button('Signed', { variant: 'paper', disabled: true, attrs: { 'aria-label': 'Signed' } }))
      : String(button('Sign', { variant: 'primary', disabled: done < total, attrs: { 'data-action': 'sign' } }));
  }
  q('[data-ref=undo]').disabled = signed || ui.undo.length === 0;
  if (!signed) {
    // keep fills in step with state (skipping panes mid-pour)
    for (const r of cv.regions) {
      if (ui.pending.has(r.id)) continue;
      const want = p.regions[r.id] ? hexOf(p.regions[r.id]) : PAPER_PANE;
      const el = root.querySelector(`.pane[data-region="${CSS_ESC(r.id)}"]`);
      if (el && el.getAttribute('fill') !== want) setFill(r.id, p.regions[r.id] ? want : null);
    }
    updateChips();
    const cl = costLine(cv);
    q('[data-ref=hint]').textContent = (cl ? cl + '. ' : '') + 'Pick a color, then tap a pane. Any color can go anywhere.';
  }
}

// ---- painting -------------------------------------------------------------

function gently(text) { ctx.toast(text); }

function flood(el, hexColor, ev, size) {
  const svg = q('.canvas-svg');
  if (!svg) return Promise.resolve();
  const clipPath = svg.querySelector('clipPath path');
  if (clipPath) clipPath.setAttribute('d', el.getAttribute('d'));
  const o = {};
  if (ev && Number.isFinite(ev.clientX) && (ev.clientX || ev.clientY)) { o.clientX = ev.clientX; o.clientY = ev.clientY; }
  else {
    const b = el.getBBox();
    o.x = b.x + b.width / 2;
    o.y = b.y + b.height / 2;
  }
  o.ms = 300 + size * 50;
  // start the flood inside a frame callback so fx's clock never runs ahead of rAF's
  return new Promise((resolve) => {
    requestAnimationFrame(() => { Promise.resolve(fx.pourFill(svg, hexColor, o)).then(resolve, resolve); });
  });
}

function sound(size) {
  const s = Math.max(1, Math.min(3, size));
  audio.glug(0.35 + s * 0.2, { layers: s, hz: GLUG_HZ[s] });
  haptics.soft();
}

function applyPaint(rid, colorId, ev, { fromUndo = false } = {}) {
  const p = piece();
  const cv = canvas();
  if (!p || p.signedAt) return false;
  const region = cv.regions.find((r) => r.id === rid);
  if (!region) return false;
  const cost = sim().gallery.regionCost(cv.id, rid);
  ui.lastCost = cost;
  const have = sim().storage.stockOf(state(), colorId);
  if (have + 1e-9 < cost) {
    gently(`${sim().displayName(state(), colorId)}: ${Math.floor(have)} of ${cost} jars. A little more time in the vats and it's yours to pour.`);
    update();
    return false;
  }
  const prev = p.regions[rid] || null;
  if (prev === colorId) {
    gently('That pane already has that color.');
    return false;
  }
  const res = ctx.game.act(sim().gallery.paintRegion, { pieceId: p.id, regionId: rid, colorId });
  if (!res || !res.ok) {
    gently(res && res.reason === 'stock' ? 'Not quite enough jars of that color yet.' : 'That pane is not ready for paint.');
    update();
    return false;
  }
  if (!fromUndo) ui.undo.push({ regionId: rid, prev });
  const el = root.querySelector(`.pane[data-region="${CSS_ESC(rid)}"]`);
  ui.pending.add(rid);
  const hx = hexOf(colorId);
  sound(region.size || 1);
  const done = () => { ui.pending.delete(rid); setFill(rid, hx); update(); };
  flood(el, hx, ev, region.size || 1).then(done, done);
  update();
  return true;
}

const clearRegion = (st, { pieceId, regionId }) => {
  const p = (st.gallery?.pieces || []).find((x) => x.id === pieceId);
  if (!p || p.signedAt) return { ok: false };
  delete p.regions[regionId];
  if (p.purity) delete p.purity[regionId];
  if (p.jars) delete p.jars[regionId];
  return { ok: true };
};

function onUndo() {
  const p = piece();
  if (!p || p.signedAt || !ui.undo.length) return;
  const last = ui.undo[ui.undo.length - 1];
  const el = root.querySelector(`.pane[data-region="${CSS_ESC(last.regionId)}"]`);
  if (last.prev) {
    const ok = applyPaint(last.regionId, last.prev, null, { fromUndo: true });
    if (ok) ui.undo.pop();
    else return;
  } else {
    ctx.game.act(clearRegion, { pieceId: p.id, regionId: last.regionId });
    ui.undo.pop();
    ui.pending.add(last.regionId);
    const region = canvas().regions.find((r) => r.id === last.regionId);
    audio.tick();
    const done = () => { ui.pending.delete(last.regionId); setFill(last.regionId, null); update(); };
    flood(el, PAPER_PANE, null, region?.size || 1).then(done, done);
    gently('Pane cleared.');
  }
  update();
}

// ---- sign + reveal ----------------------------------------------------------

function openSheet(kind) {
  ui.sheet = kind;
  const layer = q('[data-ref=layer]');
  layer.hidden = false;
  const p = piece();
  const cv = canvas();
  if (kind === 'sign') {
    layer.innerHTML = String(h`<div class="sheet pt-sheet" role="dialog" aria-label="Sign your piece">
  <div class="pt-mini">${raw(canvasSvgMarkup(cv, fillsOf(p)))}</div>
  <div class="center"><div class="h2">Sign your piece</div><div class="hint">Give it a title, or let it carry the canvas name.</div></div>
  <input class="pt-title-input" data-ref="titleinput" type="text" maxlength="40" placeholder="${cv.name}" value="${ui.title}" aria-label="Title" autocomplete="off">
  <div class="row">${button('Not yet', { block: true, cls: 'grow', attrs: { 'data-action': 'sign-cancel' } })}${button('Sign it', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'sign-confirm' } })}</div>
</div>`);
  }
}

function closeSheet() {
  ui.sheet = null;
  const layer = q('[data-ref=layer]');
  if (layer) { layer.hidden = true; layer.innerHTML = ''; }
}

function onSignConfirm() {
  const p = piece();
  const input = q('[data-ref=titleinput]');
  const title = input ? input.value.trim() : '';
  ui.title = title;
  const res = ctx.game.act(sim().gallery.signPiece, { pieceId: p.id, title });
  if (!res || !res.ok) {
    gently(res && res.reason === 'unpainted' ? `${res.missing} panes still waiting for color.` : 'This piece cannot be signed yet.');
    closeSheet();
    return;
  }
  ui.undo = [];
  const np = piece();
  const cv = canvas();
  const now = ctx.game.now();
  const st = state();
  const perSec = res.value * sim().gallery.ADMISSION_RATE * sim().incomeMultiplier(st, now);
  const free = Math.max(0, (st.gallery.walls || 0) - (st.gallery.hung || []).length);
  const b = res.breakdown || {};
  const rows = [
    ['Paint used', `${ctx.format.num(b.paint || 0)} Coins`],
    b.rarity > 1.001 ? ['Rare colors', `x${(+b.rarity).toFixed(2)}`] : null,
    b.variety > 1.001 ? ['Variety', `x${(+b.variety).toFixed(2)}`] : null,
    b.taste > 1.001 ? ['Visitors love this week', `x${(+b.taste).toFixed(2)}`] : null,
  ].filter(Boolean);
  ui.sheet = 'reveal';
  const layer = q('[data-ref=layer]');
  layer.hidden = false;
  layer.innerHTML = String(h`<div class="sheet pt-sheet" role="dialog" aria-label="Your signed piece">
  <div class="pt-mini">${raw(canvasSvgMarkup(cv, fillsOf(np)))}</div>
  <div class="center"><div class="h2" data-ref="signedtitle"></div><div class="hint">is worth</div></div>
  <div class="pt-value" data-ref="value" aria-live="polite">0</div>
  <div class="center small muted">Coins, and ${perSec >= 0.05 ? `about ${ctx.format.rate(perSec)}` : 'a gentle trickle'} in admission once it hangs.</div>
  <div>${rows.map(([k, v]) => h`<div class="pt-bd"><span>${k}</span><span class="num bold">${v}</span></div>`)}</div>
  <div class="row">${button('Keep in archive', { block: true, cls: 'grow', attrs: { 'data-action': 'archive' } })}${button('Hang it', { variant: 'primary', block: true, cls: 'grow', disabled: free <= 0, attrs: { 'data-action': 'hang' } })}</div>
  ${free <= 0 ? h`<div class="hint center">Your walls are full. It will wait safely in the archive until you take one down.</div>` : ''}
</div>`);
  layer.querySelector('[data-ref=signedtitle]').textContent = np.title || cv.name;
  update();
  const valEl = layer.querySelector('[data-ref=value]');
  fx.rollNumber(valEl, 0, res.value, { format: ctx.format.num, ms: 1100 });
  audio.motif();
  haptics.success();
  const used = [...new Set(Object.values(np.regions).map(hexOf))].slice(0, 6);
  fx.confetti(used, valEl);
}

function afterReveal() {
  closeSheet();
  if (ctx.back) ctx.back(); else ctx.navigate('gallery');
}

function onHang() {
  const p = piece();
  const res = ctx.game.act(sim().gallery.hang, { pieceId: p.id });
  if (res && res.ok) {
    audio.thunk();
    haptics.medium();
    ctx.toast('Hung on the wall. Visitors are on their way.');
  } else {
    ctx.toast('The walls are full. It is safe in your archive.');
  }
  afterReveal();
}

function onExport(share) {
  const p = piece();
  const cv = canvas();
  if (!p || !cv) return;
  exportPieceImage(cv, fillsOf(p), { title: p.title || cv.name, share }).then((r) => {
    if (r && r.ok) ctx.toast(r.shared ? 'Shared.' : 'Image saved.');
  }, () => ctx.toast('Could not make the image just now. Try again in a moment.'));
}

// ---- events ---------------------------------------------------------------

function onClick(e) {
  const pane = e.target.closest && e.target.closest('.pane');
  if (pane && root.contains(pane)) {
    if (!ui.sel) { gently('Pick a color first, then tap a pane.'); return; }
    applyPaint(pane.dataset.region, ui.sel, e);
    return;
  }
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  if (a === 'close-sheet') { if (e.target === t && ui.sheet === 'sign') closeSheet(); return; }
  if (a === 'pick') { ui.sel = t.dataset.color; ui.lastCost = 0; ui.chipSig = ''; update(); return; }
  if (a === 'family') { ui.family = ui.family === t.dataset.family ? null : t.dataset.family; ui.chipSig = ''; updateChips(); return; }
  if (a === 'undo') onUndo();
  else if (a === 'sign') openSheet('sign');
  else if (a === 'sign-cancel') closeSheet();
  else if (a === 'sign-confirm') onSignConfirm();
  else if (a === 'hang') onHang();
  else if (a === 'archive') afterReveal();
  else if (a === 'export') onExport(false);
  else if (a === 'share') onExport(true);
}

function onKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const pane = e.target.closest && e.target.closest('.pane');
  if (!pane || !ui.sel) return;
  e.preventDefault();
  applyPaint(pane.dataset.region, ui.sel, null);
}

const screen = {
  id: 'paint',
  fullscreen: true, // the router hides the tab bar

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    fx = ctx.fx || fxDefault;
    audio = ctx.audio || audioDefault;
    haptics = ctx.haptics || hapticsDefault;
    injectCss();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
  },

  show(params = {}) {
    if (params.pieceId && params.pieceId !== ui.pieceId) {
      ui.pieceId = params.pieceId;
      ui.undo = [];
      ui.family = null;
      ui.title = '';
    }
    ui.pending.clear();
    ui.lastCost = 0;
    closeSheet();
    if (!piece()) {
      root.innerHTML = '';
      if (ctx.back) ctx.back();
      return;
    }
    buildAll();
  },

  hide() {
    closeSheet();
    ui.pending.clear();
  },

  render() {
    if (!root || !piece()) return;
    if (!q('.canvas-svg')) { buildAll(); return; }
    update();
  },
};

export default screen;
export const mount = screen.mount;
