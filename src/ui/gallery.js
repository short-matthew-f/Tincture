/**
 * gallery.js: the Gallery Wing (overlay `gallery`).
 *
 * Owns: the locked door ("Opens at 20 colors with the Gallery Wing"), the
 * walls (framed mini-renders of hung pieces with their admission per second),
 * the weekly taste banner, visitor comment bubbles, the collector offer card,
 * the archive of unhung pieces (hang / take down), unfinished pieces
 * ("Continue") and the canvases list ("Start painting"). Implements DESIGN.md
 * "The Gallery" (Painting, Piece value, The gallery walls, Where canvases come
 * from, Unlock and prestige). Painting itself lives in paint.js.
 *
 * data-actions: piece, empty-wall, unhang, hang, start, continue, accept-offer,
 * decline-offer, close-sheet, export, share, goto-workshop.
 * Navigates: navigate('paint', {pieceId}), navigate('workshop').
 */

import { h, raw, backButton, button, tag, safeHex, progressBar } from './kit.js';
import { canvasSvgMarkup, exportPieceImage, FAMILY_HEX, paintIntent } from './paint.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';

const UNLOCK_COLORS = 20;
const PLURAL = Object.freeze({
  red: 'reds', orange: 'oranges', yellow: 'yellows', green: 'greens', teal: 'teals',
  blue: 'blues', violet: 'violets', pink: 'pinks', neutral: 'neutrals',
});

const CSS = `
#screen-gallery .screen-body > *{flex-shrink:0}
#screen-gallery .h2{font-family:var(--font-ui);font-weight:600}
#screen-gallery .btn.small{min-height:44px}
#screen-gallery .gl-name{font-family:var(--font-display);font-size:20px;line-height:1.2}
#screen-gallery .gl-sec{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:6px}
#screen-gallery .gl-walls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
#screen-gallery .gl-tile{display:flex;flex-direction:column;gap:4px;align-items:stretch;text-align:left;min-width:0}
#screen-gallery .gl-frame{border-radius:6px;background:#D3D8D0;padding:6px 4px 2px;box-shadow:inset 0 0 0 1px rgba(42,38,34,.08)}
#screen-gallery .gl-frame svg{width:100%;height:auto;display:block}
#screen-gallery .gl-t{font-family:var(--font-display);font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#screen-gallery .gl-r{font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
#screen-gallery .gl-empty{min-height:130px;border-radius:10px;background:rgba(247,244,236,.7);box-shadow:inset 0 3px 8px rgba(42,38,34,.12),0 2px 0 rgba(42,38,34,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--ink-soft);font-size:12px;text-align:center;padding:8px}
#screen-gallery .gl-taste{display:flex;flex-direction:row;align-items:center;gap:10px}
#screen-gallery .gl-door .progress{align-self:stretch}
#screen-gallery .gl-dot{width:26px;height:26px;border-radius:50%;flex:0 0 auto;box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.25)}
#screen-gallery .gl-bubble{display:flex;gap:10px;align-items:flex-start;background:#fff;border-radius:14px 14px 14px 4px;padding:9px 12px;box-shadow:0 2px 0 rgba(42,38,34,.14);font-size:14px}
#screen-gallery .gl-bubble .gl-dot{width:14px;height:14px;margin-top:3px}
#screen-gallery .gl-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
#screen-gallery .gl-cv{align-items:center;text-align:center}
#screen-gallery .gl-cv .gl-frame{width:100px}
#screen-gallery .gl-door{align-items:center;text-align:center;gap:10px;padding:18px 16px}
#screen-gallery .gl-door > svg{width:140px;height:auto}
#screen-gallery .gl-door .tag,#screen-gallery .gl-note .tag{white-space:normal;text-align:left;min-height:28px;line-height:1.25;font-size:13px}
#screen-gallery .gl-note{align-items:center;text-align:center;gap:8px}
#screen-gallery .gl-layer{position:absolute;inset:0;z-index:20;background:rgba(42,38,34,.45);display:flex;align-items:flex-end;justify-content:center;animation:fade-in 160ms ease-out both}
#screen-gallery .gl-layer[hidden]{display:none}
#screen-gallery .gl-sheet{width:100%;max-width:520px;max-height:92%}
#screen-gallery .gl-big{width:190px;margin:0 auto}
#screen-gallery .gl-big svg{width:100%;height:auto}
#screen-gallery .gl-row{display:flex;gap:10px;align-items:center}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('gallery-css')) return;
  const s = document.createElement('style');
  s.id = 'gallery-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let root = null;
let ctx = null;
let fx = fxDefault;
let audio = audioDefault;
let haptics = hapticsDefault;

const ui = { sig: '', comments: {}, commentsKey: '', commentsAt: 0, sheet: null };

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);
const hexOf = (id) => sim().colorHex(id);
const gal = () => state().gallery;
const pieceById = (id) => (gal().pieces || []).find((p) => p.id === id) || null;
const canvasOf = (p) => (p ? ctx.content.getCanvas(p.canvas) : null);

function fillsOf(p) {
  const out = {};
  for (const [rid, cid] of Object.entries(p?.regions || {})) out[rid] = hexOf(cid);
  return out;
}

function mini(p) {
  const cv = canvasOf(p);
  return cv ? raw(canvasSvgMarkup(cv, fillsOf(p), { label: p.title || cv.name })) : '';
}

function pieceRate(p, now) {
  return (p.value || 0) * sim().gallery.ADMISSION_RATE * sim().incomeMultiplier(state(), now);
}

function paintedCount(p) {
  const cv = canvasOf(p);
  return cv ? cv.regions.filter((r) => p.regions[r.id]).length : 0;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function doorView(st) {
  const n = sim().discoveredCount(st);
  const room = ctx.content.getRoom ? ctx.content.getRoom('gallery-wing') : null;
  const need = (room && room.colorsRequired) || UNLOCK_COLORS;
  const left = Math.max(0, need - n);
  const hasRoom = (st.rooms || []).includes('gallery-wing');
  return h`
<div class="card gl-door" data-coach="gallery">
  <svg viewBox="0 0 160 200" role="img" aria-label="A closed gallery door">
    <path d="M18 196 V84 A62 62 0 0 1 142 84 V196 Z" fill="#7B5236" stroke="#2A2622" stroke-width="3"/>
    <path d="M34 196 V88 A46 46 0 0 1 126 88 V196 Z" fill="#A87449" stroke="#2A2622" stroke-width="2.5"/>
    <path d="M80 42 V196 M34 120 H126" stroke="#5E3E28" stroke-width="3" fill="none"/>
    <circle cx="104" cy="132" r="5" fill="#E2B04A" stroke="#8C6512" stroke-width="1.5"/>
    <rect x="52" y="20" width="56" height="18" rx="3" fill="#F7F4EC" stroke="#2A2622" stroke-width="2"/>
    <path d="M62 29 H98" stroke="#5E5148" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <div class="h2">The Gallery Wing</div>
  <div class="hint">Quiet white walls, waiting for your first paintings. Hang your art, and visitors pay to see it.</div>
  ${left > 0
    ? h`${tag(`Opens at ${need} colors with the Gallery Wing: ${left} more`)}${progressBar(Math.min(1, n / need), { label: 'Colors toward the Gallery Wing' })}`
    : hasRoom
      ? h`${tag('The Gallery Wing opens in just a moment')}<div class="small semi">The painters are hanging the last lamps. Check back in a moment.</div>`
      : h`${tag('Opens when you build the Gallery Wing')}<div class="small semi">You have the colors. Build the Gallery Wing in the workshop.</div>${button('Go to the workshop', { variant: 'primary', attrs: { 'data-action': 'goto-workshop' } })}`}
</div>`;
}

function tasteView(st, now) {
  const fam = gal().taste || sim().gallery.weeklyTaste(now);
  const name = PLURAL[fam] || fam;
  return h`
<div class="card gl-taste flat" aria-label="Weekly visitor taste">
  <span class="gl-dot" style="background:${FAMILY_HEX[fam] || '#9A9288'}"></span>
  <div class="grow"><div class="semi">Visitors love ${name} this week</div><div class="hint">A piece that is mostly ${name} earns +25% value.</div></div>
</div>`;
}

function offerView(st) {
  const o = gal().collectorOffer;
  if (!o) return '';
  const p = pieceById(o.pieceId);
  if (!p) return '';
  return h`
<div class="card" style="background:#FFF6DF;box-shadow:0 0 0 2px #B9831C,0 3px 0 rgba(42,38,34,.25)">
  <div class="row top"><div class="shrink0" style="width:44px">${mini(p)}</div>
    <div class="grow"><div class="card-title">A collector is visiting</div>
    <div class="small">offers <b class="num">${ctx.format.num(o.pay)}</b> Coins for a print of "${p.title || 'your piece'}". You keep the original on the wall.</div></div></div>
  <div class="row">${button('Not today', { block: true, cls: 'grow', attrs: { 'data-action': 'decline-offer' } })}${button('Accept', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'accept-offer' } })}</div>
</div>`;
}

function wallsView(st, now) {
  const g = gal();
  const walls = Math.max(1, Math.min(24, g.walls || 4));
  const hung = (g.hung || []).map(pieceById).filter(Boolean);
  const total = sim().gallery.admissionRate(st, now);
  const freeWalls = Math.max(0, walls - hung.length);
  const tiles = [];
  for (let i = 0; i < walls; i++) {
    const p = hung[i];
    if (p) {
      tiles.push(h`<button type="button" class="gl-tile" data-tap data-action="piece" data-piece="${p.id}" aria-label="${p.title || 'Painting'}, ${ctx.format.rate(pieceRate(p, now))}">
  <span class="gl-frame">${mini(p)}</span>
  <span class="gl-t">${p.title || canvasOf(p)?.name || 'Untitled'}</span>
  <span class="gl-r">${ctx.format.rate(pieceRate(p, now))}</span></button>`);
    } else {
      tiles.push(h`<button type="button" class="gl-empty" data-tap data-action="empty-wall" aria-label="Empty wall"><span class="semi">A wall for your art</span><span>${hasArchive() ? 'Hang a piece' : 'Paint one'}</span></button>`);
    }
  }
  return h`
<div class="gl-sec"><div class="h2">On the walls</div>
  <div class="small muted num">${walls} ${walls === 1 ? 'wall' : 'walls'}, ${freeWalls > 0 ? `${freeWalls} free` : 'all in use'}${total > 0 ? h` · ${ctx.format.rate(total)} total` : ''}</div></div>
<div class="gl-walls" data-coach="gallery">${tiles}</div>
${hung.length === 0 ? h`<div class="hint">Hang a signed piece and visitors start paying admission.</div>` : ''}`;
}

function hasArchive() {
  return (gal().pieces || []).some((p) => p.signedAt && !p.hung);
}

function rollComments() {
  const g = gal();
  const key = (g.hung || []).join(',');
  const stale = Date.now() - ui.commentsAt > 45000;
  if (key === ui.commentsKey && !stale) return;
  ui.commentsKey = key;
  ui.commentsAt = Date.now();
  ui.comments = {};
  for (const id of g.hung || []) {
    try { ui.comments[id] = sim().gallery.visitorComment(state(), id, Math.random); } catch (e) { ui.comments[id] = ''; }
  }
}

function commentsView() {
  const g = gal();
  const ids = (g.hung || []).filter((id) => ui.comments[id]).slice(0, 3);
  if (!ids.length) return '';
  return h`
<div class="gl-sec"><div class="h2">Visitors say</div></div>
<div class="stack stack-sm">${ids.map((id) => {
    const p = pieceById(id);
    const top = Object.values(p?.regions || {})[0];
    return h`<div class="gl-bubble"><span class="gl-dot" style="background:${top ? safeHex(hexOf(top)) : '#9A9288'}"></span><div>"${ui.comments[id]}"<div class="tiny muted">on ${p?.title || 'a painting'}</div></div></div>`;
  })}</div>`;
}

function easelView() {
  const list = (gal().pieces || []).filter((p) => !p.signedAt);
  if (!list.length) return '';
  return h`
<div class="gl-sec"><div class="h2">On the easel</div></div>
<div class="stack stack-sm">${list.map((p) => {
    const cv = canvasOf(p);
    const total = cv ? cv.regions.length : 0;
    const done = paintedCount(p);
    return h`<div class="card tight"><div class="gl-row"><div class="shrink0" style="width:46px">${mini(p)}</div>
      <div class="grow"><div class="semi">${cv?.name || 'Canvas'}</div><div class="small muted">${total - done > 0 ? `${total - done} ${total - done === 1 ? 'pane' : 'panes'} to fill` : 'All painted: ready to sign'}</div></div>
      ${button('Continue', { small: true, variant: 'primary', attrs: { 'data-action': 'continue', 'data-piece': p.id } })}</div></div>`;
  })}</div>`;
}

function nextCanvasAt(st) {
  return (Math.floor(sim().discoveredCount(st) / 20) + 1) * 20;
}

function canvasesView(st) {
  const list = (gal().canvases || []).map((id) => ctx.content.getCanvas(id)).filter(Boolean);
  if (!list.length) {
    const at = nextCanvasAt(st);
    const more = Math.max(1, at - sim().discoveredCount(st));
    return h`
<div class="gl-sec"><div class="h2">Canvases</div></div>
<div class="card gl-note" data-ref="canvases">
  <div class="semi">Your first canvas is on its way</div>
  <div class="small muted">New canvases arrive with catalog milestones, postcard sets, events and commissions.</div>
  ${tag(`Next canvas at ${at} colors: ${more} more`, { icon: null })}
  ${button('See your catalog', { attrs: { 'data-action': 'goto-catalog' } })}
</div>`;
  }
  return h`
<div class="gl-sec" data-ref="canvases"><div class="h2">Canvases</div><div class="small muted">${list.length} to paint</div></div>
<div class="gl-grid2">${list.map((cv) => h`<div class="card gl-cv">
  <span class="gl-frame">${raw(canvasSvgMarkup(cv, {}, { label: cv.name }))}</span>
  <div class="semi" style="font-family:var(--font-display);font-size:14px">${cv.name}</div>
  <div class="small muted">${cv.regions.length} panes</div>
  ${button('Start painting', { small: true, variant: 'primary', block: true, attrs: { 'data-action': 'start', 'data-canvas': cv.id } })}
</div>`)}</div>
${list.length < 12 ? h`<div class="hint">New canvases arrive with catalog milestones, postcard sets, events and commissions.</div>` : ''}`;
}

function archiveView(st) {
  const g = gal();
  const list = (g.pieces || []).filter((p) => p.signedAt && !p.hung).sort((a, b) => b.signedAt - a.signedAt);
  if (!list.length) {
    const hasCanvas = (g.canvases || []).length > 0;
    return h`
<div class="gl-sec"><div class="h2">Archive</div></div>
<div class="card gl-note">
  <div class="semi">Signed pieces rest here</div>
  <div class="small muted">Finish a painting and sign it. It waits safely here until you hang it on a wall.</div>
  ${hasCanvas ? button('Pick a canvas', { attrs: { 'data-action': 'goto-canvases' } }) : ''}
</div>`;
  }
  const free = Math.max(0, (g.walls || 0) - (g.hung || []).length);
  return h`
<div class="gl-sec"><div class="h2">Archive</div><div class="small muted">${list.length} resting</div></div>
<div class="gl-walls">${list.map((p) => h`<div class="gl-tile">
  <button type="button" class="gl-tile" data-tap data-action="piece" data-piece="${p.id}" aria-label="${p.title || 'Painting'}">
    <span class="gl-frame">${mini(p)}</span>
    <span class="gl-t">${p.title || 'Untitled'}</span>
    <span class="gl-r">worth ${ctx.format.num(p.value || 0)}</span></button>
  ${button('Hang', { small: true, block: true, attrs: { 'data-action': 'hang', 'data-piece': p.id } })}
</div>`)}</div>
${free <= 0 ? h`<div class="hint">Every wall is in use. Take one down to rotate a new piece in. Nothing is ever lost.</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function signature(st, now) {
  const g = st.gallery || {};
  return JSON.stringify([
    g.unlocked, sim().discoveredCount(st), g.canvases, g.walls, g.hung, g.taste,
    (g.pieces || []).map((p) => [p.id, p.signedAt, p.hung, p.title, Object.keys(p.regions || {}).length, Math.round(p.value || 0)]),
    g.collectorOffer ? [g.collectorOffer.pieceId, Math.round(g.collectorOffer.pay)] : null,
    Math.round(sim().gallery.admissionRate(st, now) * 1000),
    (st.rooms || []).includes('gallery-wing'),
  ]);
}

function headSubtitle(st, now) {
  if (!gal().unlocked) {
    const room = ctx.content.getRoom ? ctx.content.getRoom('gallery-wing') : null;
    const need = (room && room.colorsRequired) || UNLOCK_COLORS;
    const left = Math.max(0, need - sim().discoveredCount(st));
    return left > 0 ? `Opens at ${need} colors: ${left} more` : 'Build the Gallery Wing to open it';
  }
  const r = sim().gallery.admissionRate(st, now);
  return r > 0 ? `${ctx.format.rate(r)} from visitors` : 'Hang a piece to welcome visitors';
}

function build(st, now) {
  const unlocked = !!gal().unlocked;
  const scroll = q('.screen-body') ? q('.screen-body').scrollTop : 0;
  rollComments();
  root.innerHTML = String(h`
<div class="screen-head">
  ${backButton('Back to the workshop')}
  <div class="titles"><div class="title">Gallery Wing</div><div class="subtitle" data-ref="sub">${headSubtitle(st, now)}</div></div>
  <span class="spacer"></span>
</div>
<div class="screen-body">
  ${unlocked
    ? h`${tasteView(st, now)}${offerView(st)}${wallsView(st, now)}${commentsView()}${easelView()}${canvasesView(st)}${archiveView(st)}`
    : doorView(st)}
</div>
<div class="gl-layer" data-ref="layer" data-action="close-sheet" hidden></div>`);
  const body = q('.screen-body');
  if (body && scroll) body.scrollTop = scroll;
  if (ui.sheet) closeSheet();
}

// ---------------------------------------------------------------------------
// Sheets and actions
// ---------------------------------------------------------------------------

function closeSheet() {
  ui.sheet = null;
  const layer = q('[data-ref=layer]');
  if (layer) { layer.hidden = true; layer.innerHTML = ''; }
}

function openPiece(id) {
  const p = pieceById(id);
  const cv = canvasOf(p);
  if (!p || !cv) return;
  const now = ctx.game.now();
  const layer = q('[data-ref=layer]');
  const signed = !!p.signedAt;
  const when = signed ? new Date(p.signedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const free = Math.max(0, (gal().walls || 0) - (gal().hung || []).length);
  ui.sheet = id;
  layer.hidden = false;
  layer.innerHTML = String(h`<div class="sheet gl-sheet" role="dialog" aria-label="${p.title || cv.name}">
  <div class="gl-big"><span class="gl-frame">${mini(p)}</span></div>
  <div class="center"><div class="gl-name">${p.title || cv.name}</div>
    <div class="hint">${signed ? `Signed ${when} · worth ${ctx.format.num(p.value || 0)} Coins` : 'Not signed yet'}${p.hung ? ` · ${ctx.format.rate(pieceRate(p, now))}` : ''}</div></div>
  <div class="row">
    ${button('Save image', { block: true, cls: 'grow', attrs: { 'data-action': 'export', 'data-piece': p.id } })}
    ${signed
      ? (p.hung
        ? button('Take down', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'unhang', 'data-piece': p.id } })
        : button('Hang it', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'hang', 'data-piece': p.id } }))
      : button('Continue', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'continue', 'data-piece': p.id } })}
  </div>
  ${signed && !p.hung && free <= 0 ? h`<div class="hint center">Every wall is in use. Take one down to rotate this in. Nothing is ever lost.</div>` : ''}
</div>`);
}

function scrollToCanvases() {
  const el = q('[data-ref=canvases]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: fx.isReducedMotion() ? 'auto' : 'smooth' });
}

function act(fn, args) { return ctx.game.act(fn, args); }

function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  const id = t.dataset.piece;
  if (a === 'close-sheet') { if (e.target === t) closeSheet(); return; }
  if (a === 'goto-workshop') { ctx.navigate('workshop'); return; }
  if (a === 'goto-catalog') { ctx.navigate('catalog'); return; }
  if (a === 'goto-canvases') { scrollToCanvases(); return; }
  if (a === 'piece') { openPiece(id); return; }
  if (a === 'empty-wall') {
    if (hasArchive()) {
      const hdr = [...root.querySelectorAll('.gl-sec .h2')].find((n) => n.textContent === 'Archive');
      if (hdr && hdr.scrollIntoView) hdr.scrollIntoView({ block: 'start', behavior: fx.isReducedMotion() ? 'auto' : 'smooth' });
    } else ctx.toast('Paint a canvas and sign it to fill this wall.');
    return;
  }
  if (a === 'start') {
    const res = act(sim().gallery.startPiece, { canvasId: t.dataset.canvas });
    if (res && res.ok) ctx.navigate('paint', { pieceId: res.pieceId });
    else ctx.toast('That canvas is not ready yet.');
    return;
  }
  if (a === 'continue') { closeSheet(); ctx.navigate('paint', { pieceId: id }); return; }
  if (a === 'hang') {
    const res = act(sim().gallery.hang, { pieceId: id });
    if (res && res.ok) { audio.thunk(); haptics.medium(); ctx.toast('Hung. Visitors will find it.'); }
    else ctx.toast('Every wall is in use. Take one down to rotate this in.');
    closeSheet();
    refresh(true);
    return;
  }
  if (a === 'unhang') {
    act(sim().gallery.unhang, { pieceId: id });
    audio.tick();
    ctx.toast('Taken down and safe in the archive.');
    closeSheet();
    refresh(true);
    return;
  }
  if (a === 'accept-offer') {
    const res = act(sim().gallery.acceptCollector, {});
    if (res && res.ok) {
      audio.coins(8);
      haptics.ripple(3);
      ctx.toast(`+${ctx.format.num(res.coins)} Coins. The original stays on your wall.`);
    } else ctx.toast('The collector has moved on, but another will visit.');
    refresh(true);
    return;
  }
  if (a === 'decline-offer') {
    act(sim().gallery.declineCollector, {});
    refresh(true);
    return;
  }
  if (a === 'export' || a === 'share') {
    const p = pieceById(id);
    const cv = canvasOf(p);
    if (!p || !cv) return;
    exportPieceImage(cv, fillsOf(p), { title: p.title || cv.name, share: a === 'share' })
      .then((r) => { if (r && r.ok) ctx.toast('Image saved.'); }, () => ctx.toast('Could not make the image just now. Try again in a moment.'));
  }
}

function refresh(force) {
  if (!root || !ctx) return;
  const st = state();
  const now = ctx.game.now();
  const sig = signature(st, now);
  if (!force && sig === ui.sig) {
    const sub = q('[data-ref=sub]');
    if (sub) sub.textContent = headSubtitle(st, now);
    return;
  }
  ui.sig = sig;
  build(st, now);
}

const screen = {
  id: 'gallery',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    fx = ctx.fx || fxDefault;
    audio = ctx.audio || audioDefault;
    haptics = ctx.haptics || hapticsDefault;
    injectCss();
    root.addEventListener('click', onClick);
  },

  show() {
    ui.commentsAt = 0;
    refresh(true);
  },

  hide() {
    closeSheet();
  },

  render() {
    // never rebuild under an open sheet; the next render after it closes catches up
    if (ui.sheet) return;
    refresh(false);
  },

  // the router calls this instead of render() when the paint screen above closes
  reveal() {
    ui.commentsAt = 0;
    refresh(true);
    if (paintIntent.focus === 'canvases') {
      paintIntent.focus = null;
      setTimeout(scrollToCanvases, 60);
    }
  },
};

export default screen;
export const mount = screen.mount;
