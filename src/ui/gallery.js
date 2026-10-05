/**
 * gallery.js: the Gallery Wing (overlay `gallery`).
 *
 * Owns: the locked door (the price tag and the "What this opens" sheet from workshop.js), the
 * walls (framed mini-renders of hung pieces with their admission per second),
 * the weekly taste banner, visitor comment bubbles, the collector offer card,
 * the archive of unhung pieces (hang / take down), unfinished pieces
 * ("Continue") and the canvases list ("Start painting"). Implements DESIGN.md
 * "The Gallery" (Painting, Piece value, The gallery walls, Where canvases come
 * from, Unlock and prestige). Painting itself lives in paint.js.
 *
 * data-actions: unlock-open, piece, empty-wall, unhang (also a 44 px "Take down" on each hung tile), hang, start,
 * continue, accept-offer, decline-offer, sell-open (sheet of a signed piece), sell-confirm, sell-cancel,
 * close-sheet, export, share, goto-workshop, goto-catalog, goto-canvases.
 * Selling (Theme E): a sheet with the thumbnail and "A collector offers N"; Sell plays fx.stamp "Sold" and
 * fx.coinArc to the coin pill; a "Sold to a collector" card (gallery.sold, newest first, 12 shown) stays in the archive.
 * Navigates: navigate('paint', {pieceId}), navigate('workshop').
 *
 * First-open guide 'gallery' (a visitor speaks): `data-coach="gallery-start"` is the first canvas's
 * "Start painting"; the step ends when paint opens (this screen emits 'galleryStart' just before it
 * navigates). 'galleryNext' is the one-time "what's next" card after her first hang (a Hang here, or a
 * hung piece when the paint screen closes back to this one).
 *
 * Feel (Theme F): tiles lift on press (wireLift); hanging and taking down slide the tile (FLIP, spring soft; the
 * moved tile glides from where she saw it with a lift, a hung piece out of sight is scrolled to first); a piece hung
 * from the paint screen drops onto its wall (spring heavy, thunk as it lands); the collector's card slides in once
 * per offer and Accept sends coins (fx.coinArc) to the pill; selling stamps "Sold" (lands in about 300 ms), THEN the
 * coins arc (about 600 ms), as the thumbnail fades back.
 */

import { h, raw, backButton, button, tag, safeHex, progressBar } from './kit.js';
import { canvasSvgMarkup, exportPieceImage, FAMILY_HEX, paintIntent } from './paint.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';
import { howThisWorksHtml, markGuideSeen, isSeen } from './guide.js';
import { wireLift, springIn } from './feel.js';

const PLURAL = Object.freeze({
  red: 'reds', orange: 'oranges', yellow: 'yellows', green: 'greens', teal: 'teals',
  blue: 'blues', violet: 'violets', pink: 'pinks', neutral: 'neutrals',
});

const CSS = `
#screen-gallery .screen-body > *{flex-shrink:0}
#screen-gallery .h2{font-family:var(--font-ui);font-weight:600}
#screen-gallery .gl-door-tag{display:flex;justify-content:center}
#screen-gallery .gl-door-tag .tag{white-space:normal;text-align:left;max-width:100%}
#screen-gallery .gl-door-tag .ws-unlockbtn{justify-content:center;text-align:center}
#screen-gallery .btn.small{min-height:44px}
#screen-gallery .how-link{min-height:24px;padding:0 8px;line-height:1;position:relative}
#screen-gallery .how-link::before{content:'';position:absolute;inset:-10px -8px}
#screen-gallery .gl-name{font-family:var(--font-display);font-size:20px;line-height:1.2}
#screen-gallery .gl-sec{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:6px}
#screen-gallery .gl-walls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
#screen-gallery .gl-tile{display:flex;flex-direction:column;gap:4px;align-items:stretch;text-align:left;min-width:0}
#screen-gallery .gl-frame{border-radius:6px;background:#D3D8D0;padding:6px 4px 2px;box-shadow:inset 0 0 0 1px rgba(42,38,34,.08)}
#screen-gallery .gl-frame svg{width:100%;height:auto;display:block}
#screen-gallery .gl-tile.fx-lifted,#screen-gallery .gl-empty.fx-lifted{filter:none}
#screen-gallery .gl-tile.fx-lifted .gl-frame{box-shadow:inset 0 0 0 1px rgba(42,38,34,.08),0 6px 0 rgba(42,38,34,.26)}
#screen-gallery .gl-empty.fx-lifted{box-shadow:inset 0 3px 8px rgba(42,38,34,.12),0 6px 0 rgba(42,38,34,.22)}
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
#screen-gallery .gl-big .gl-frame{display:block}
#screen-gallery .gl-row{display:flex;gap:10px;align-items:center}
#screen-gallery .gl-cell{display:flex;flex-direction:column;gap:6px;min-width:0}
#screen-gallery .gl-cell > .gl-tile{flex:1 1 auto}
#screen-gallery .gl-sold{display:flex;flex-direction:column;gap:4px;min-width:0;opacity:.92}
#screen-gallery .gl-sold .gl-frame{background:#E3E0D6;position:relative}
#screen-gallery .gl-sold .gl-frame svg{opacity:.7}
#screen-gallery .gl-sold .gl-r{white-space:normal}
#screen-gallery .gl-price{font-family:var(--font-display);font-size:22px;line-height:1.2;text-align:center}
#screen-gallery .gl-sellbig{position:relative}
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

const ui = { offerSeen: '', sig: '', comments: {}, commentsKey: '', commentsAt: 0, sheet: null, guide: null, guideTimer: 0, nextTimer: 0, hungBefore: 0, startShown: false };

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
  const u = sim().unlocks.status(st, 'gallery');
  const need = u.revealColors;
  return h`
<div class="card gl-door is-tap" data-coach="gallery" data-action="unlock-open" data-unlock="gallery" data-tap role="button" tabindex="0" aria-label="What the Gallery Wing opens">
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
  <div class="gl-door-tag">${unlockTag(ctx, 'gallery')}</div>
  ${u.colorsLeft > 0 ? progressBar(Math.min(1, n / need), { label: 'Colors toward the Gallery Wing' }) : ''}
  <div class="small muted">Tap the door to see what it opens.</div>
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
<div class="card" data-offer="${o.pieceId}:${Math.round(o.pay)}" style="background:#FFF6DF;box-shadow:0 0 0 2px #B9831C,0 3px 0 rgba(42,38,34,.25)">
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
      tiles.push(h`<div class="gl-cell" data-cell-piece="${p.id}">
  <button type="button" class="gl-tile" data-tap data-action="piece" data-piece="${p.id}" aria-label="${p.title || 'Painting'}, ${ctx.format.rate(pieceRate(p, now))}">
    <span class="gl-frame">${mini(p)}</span>
    <span class="gl-t">${p.title || canvasOf(p)?.name || 'Untitled'}</span>
    <span class="gl-r">${ctx.format.rate(pieceRate(p, now))}</span></button>
  ${button('Take down', { small: true, block: true, attrs: { 'data-action': 'unhang', 'data-piece': p.id, 'aria-label': `Take down ${p.title || 'this painting'}` } })}
</div>`);
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
<div class="gl-grid2">${list.map((cv, i) => h`<div class="card gl-cv">
  <span class="gl-frame">${raw(canvasSvgMarkup(cv, {}, { label: cv.name }))}</span>
  <div class="semi" style="font-family:var(--font-display);font-size:14px">${cv.name}</div>
  <div class="small muted">${cv.regions.length} panes</div>
  ${button('Start painting', { small: true, variant: 'primary', block: true, attrs: { 'data-action': 'start', 'data-canvas': cv.id, ...(i === 0 ? { 'data-coach': 'gallery-start' } : {}) } })}
</div>`)}</div>
${list.length < 12 ? h`<div class="hint">New canvases arrive with catalog milestones, postcard sets, events and commissions.</div>` : ''}`;
}

const SOLD_SHOWN = 12;

function soldList() {
  return (gal().sold || []).slice().sort((a, b) => (b.soldAt || 0) - (a.soldAt || 0)).slice(0, SOLD_SHOWN);
}

function soldCard(r) {
  const cv = ctx.content.getCanvas(r.canvas);
  const fills = {};
  for (const [rid, cid] of Object.entries(r.thumb || {})) fills[rid] = hexOf(cid);
  const when = new Date(r.soldAt || 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return h`<div class="gl-sold" data-sold="${r.id}" aria-label="${r.title || 'Painting'}, sold to a collector ${when}">
  <span class="gl-frame">${cv ? raw(canvasSvgMarkup(cv, fills, { label: r.title || cv.name })) : ''}</span>
  <span class="gl-t">${r.title || cv?.name || 'Untitled'}</span>
  <span class="gl-r">Sold to a collector</span>
  <span class="gl-r">${when}</span></div>`;
}

function archiveView(st) {
  const g = gal();
  const list = (g.pieces || []).filter((p) => p.signedAt && !p.hung).sort((a, b) => b.signedAt - a.signedAt);
  const sold = soldList();
  if (!list.length && !sold.length) {
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
<div class="gl-sec"><div class="h2">Archive</div><div class="small muted">${list.length ? `${list.length} resting` : 'Nothing resting'}${sold.length ? ` · ${(g.sold || []).length} sold` : ''}</div></div>
${list.length ? h`<div class="gl-walls">${list.map((p) => h`<div class="gl-cell" data-cell-piece="${p.id}">
  <button type="button" class="gl-tile" data-tap data-action="piece" data-piece="${p.id}" aria-label="${p.title || 'Painting'}">
    <span class="gl-frame">${mini(p)}</span>
    <span class="gl-t">${p.title || 'Untitled'}</span>
    <span class="gl-r">worth ${ctx.format.num(p.value || 0)}</span></button>
  ${button('Hang', { small: true, block: true, attrs: { 'data-action': 'hang', 'data-piece': p.id } })}
</div>`)}</div>` : ''}
${list.length && free <= 0 ? h`<div class="hint">Every wall is in use. Take one down to rotate a new piece in. Nothing is ever lost.</div>` : ''}
${sold.length ? h`<div class="gl-sec"><div class="semi small">Sold to a collector</div></div><div class="gl-walls" data-ref="sold">${sold.map(soldCard)}</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function signature(st, now) {
  const g = st.gallery || {};
  return JSON.stringify([
    g.unlocked, sim().discoveredCount(st), (() => { const u = sim().unlocks.status(st, 'gallery'); return [u.revealed, u.affordable, u.open]; })(), g.canvases, g.walls, g.hung, g.taste,
    (g.pieces || []).map((p) => [p.id, p.signedAt, p.hung, p.title, Object.keys(p.regions || {}).length, Math.round(p.value || 0)]),
    (g.sold || []).map((r) => r.id),
    g.collectorOffer ? [g.collectorOffer.pieceId, Math.round(g.collectorOffer.pay)] : null,
    Math.round(sim().gallery.admissionRate(st, now) * 1000),
    (st.rooms || []).includes('gallery-wing'),
  ]);
}

function headSubtitle(st, now) {
  if (!gal().unlocked) {
    const u = sim().unlocks.status(st, 'gallery');
    return `${ctx.format.num(u.cost)} coins to open`;
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
  <div class="titles"><div class="title">Gallery Wing</div><div class="subtitle" data-ref="sub">${headSubtitle(st, now)}</div>${unlocked ? howThisWorksHtml('gallery') : ''}</div>
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
  const offer = q('[data-offer]');
  if (offer && offer.dataset.offer !== ui.offerSeen) {
    ui.offerSeen = offer.dataset.offer;
    springIn(offer, fx, { dy: -32, scale: 0.97, preset: 'soft' }); // the collector's card slides in
  }
  // The door just opened (the 'unlocked' hand-off starts the guide): bring the first canvas into view once.
  if (!ui.startShown && ui.guide && ui.guide.active && q('[data-coach="gallery-start"]')) showStart();
}

// ---------------------------------------------------------------------------
// Movement: hanging and taking down slide the tile (FLIP with spring soft)
// ---------------------------------------------------------------------------

const cssId = (id) => String(id).replace(/["\\]/g, '\\$&');

function cellRects() {
  const m = new Map();
  root.querySelectorAll('.gl-cell[data-cell-piece]').forEach((n) => m.set(n.dataset.cellPiece, n.getBoundingClientRect()));
  const body = q('.screen-body');
  m.scroll = body ? body.scrollTop : 0;
  return m;
}

function inView(r) {
  const body = q('.screen-body');
  if (!body || !r) return true;
  const b = body.getBoundingClientRect();
  return r.bottom > b.top + 8 && r.top < b.bottom - 8;
}

/**
 * FLIP: `before` was measured before the rebuild. The moved piece's tile glides from where it was to where it
 * is now with a lift (scale 106%) that settles; the rest of the tiles that shifted glide softly too. A hung
 * piece whose wall slot is out of sight is scrolled to first; a taken-down piece's empty wall slot just
 * springs open (the archive can be a long way down, and the page keeps her place).
 */
function flipFrom(before, movedId, { hang = false } = {}) {
  if (!root || fx.isReducedMotion()) return;
  let moved = movedId ? q(`.gl-cell[data-cell-piece="${cssId(movedId)}"]`) : null;
  if (moved && hang && !inView(moved.getBoundingClientRect())) moved.scrollIntoView({ block: 'center' });
  const after = cellRects();
  for (const [id, r1] of after) {
    const r0 = before.get(id);
    if (!r0) continue;
    const isMoved = id === movedId;
    // The moved tile glides from where she saw it (screen coordinates); the others only for a real change of
    // layout, so a scroll to the wall (content coordinates) does not make them swim.
    const dx = r0.left - r1.left;
    const dy = isMoved ? r0.top - r1.top : (r0.top + before.scroll) - (r1.top + after.scroll);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const el = q(`.gl-cell[data-cell-piece="${cssId(id)}"]`);
    if (!el) continue;
    if (isMoved) el.style.zIndex = '3';
    fx.spring(el, {
      from: { transform: `translate(${dx}px, ${dy}px) scale(${isMoved ? 1.06 : 1})` },
      to: { transform: 'translate(0px, 0px) scale(1)' },
      preset: 'soft',
    }).then(() => { if (isMoved) el.style.zIndex = ''; });
  }
  if (!hang && movedId) {
    // the freed wall: its empty slot springs open where the tile was
    const slots = [...root.querySelectorAll('.gl-walls[data-coach] .gl-empty')];
    const first = slots[0];
    if (first) springIn(first, fx, { dy: 0, scale: 0.9, preset: 'soft' });
  }
}

function consumeHung() {
  const id = paintIntent.hung;
  if (!id) return;
  paintIntent.hung = null;
  requestAnimationFrame(() => landOnWall(id));
}

/** A newly hung piece (from the paint screen) drops onto its wall: spring heavy, with the wooden thunk as it lands. */
function landOnWall(id) {
  const cell = q(`.gl-cell[data-cell-piece="${cssId(id)}"]`);
  if (!cell) return;
  if (!inView(cell.getBoundingClientRect())) cell.scrollIntoView({ block: 'center' });
  cell.style.zIndex = '3';
  fx.spring(cell, {
    from: { transform: 'translate(0px, -44px) scale(1.18)', opacity: 0 },
    to: { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
    preset: 'heavy',
  }).then(() => { cell.style.zIndex = ''; });
  setTimeout(() => { audio.thunk(0.8); }, 120);
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
  ${signed ? h`<div class="row">${button('Sell to a collector', { block: true, cls: 'grow', attrs: { 'data-action': 'sell-open', 'data-piece': p.id } })}</div>` : ''}
  ${signed && !p.hung && free <= 0 ? h`<div class="hint center">Every wall is in use. Take one down to rotate this in. Nothing is ever lost.</div>` : ''}
</div>`);
}

function openSell(id) {
  const p = pieceById(id);
  const cv = canvasOf(p);
  if (!p || !cv || !p.signedAt) return;
  const offer = sim().gallery.sellOffer(state(), id, ctx.game.now());
  if (!offer) return;
  const layer = q('[data-ref=layer]');
  ui.sheet = 'sell:' + id;
  ui.selling = false;
  layer.hidden = false;
  layer.innerHTML = String(h`<div class="sheet gl-sheet" role="dialog" aria-label="Sell ${p.title || cv.name} to a collector">
  <div class="gl-big gl-sellbig" data-ref="sellthumb"><span class="gl-frame">${mini(p)}</span></div>
  <div class="center"><div class="gl-name">${p.title || cv.name}</div>
    <div class="gl-price num" data-ref="price">A collector offers ${ctx.format.num(offer.coins)}</div>
    <div class="hint">Coins for the original. It leaves your gallery for good, and a small card here remembers it. You can paint this canvas again.</div></div>
  <div class="row">
    ${button('Keep it', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'sell-cancel', 'data-piece': id } })}
    ${button('Sell', { block: true, cls: 'grow', attrs: { 'data-action': 'sell-confirm', 'data-piece': id } })}
  </div>
</div>`);
}

function coinPillTarget() {
  const pill = document.querySelector('.ws-pill, [data-ref=pill]');
  const r = pill && pill.getBoundingClientRect ? pill.getBoundingClientRect() : null;
  if (r && r.width > 0 && r.height > 0 && getComputedStyle(pill).visibility !== 'hidden') return pill;
  return q('.screen-head .titles') || root; // the workshop's pill is covered by this overlay
}

async function sellPiece(id) {
  if (ui.selling) return;
  const p = pieceById(id);
  if (!p || !p.signedAt) { closeSheet(); return; }
  ui.selling = true;
  const thumb = q('[data-ref=sellthumb]');
  const title = p.title || canvasOf(p)?.name || 'your painting';
  const res = act(sim().gallery.sellPiece, { pieceId: id });
  if (!res || !res.ok) {
    ui.selling = false;
    ctx.toast('That piece is not for sale right now.');
    closeSheet();
    refresh(true);
    return;
  }
  for (const b of root.querySelectorAll('.gl-sheet .btn')) b.disabled = true;
  try {
    await fx.stamp(thumb, 'Sold', { hold: 600 }); // the stamp lands first (about 300 ms)...
    if (thumb) fx.spring(thumb, { from: { transform: 'scale(1)', opacity: 1 }, to: { transform: 'scale(0.94)', opacity: 0.45 }, preset: 'soft', fill: 'forwards' });
    await fx.coinArc(thumb, coinPillTarget(), 10); // ...then the coins leave it (about 600 ms)
  } catch (e) { /* the sale is done; effects are a bonus */ }
  ui.selling = false;
  ctx.toast(`Sold "${title}" for ${ctx.format.num(res.coins)} Coins.`);
  closeSheet();
  refresh(true);
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
  if (a === 'close-sheet') { if (e.target === t && !ui.selling) closeSheet(); return; }
  if (a === 'goto-workshop') { ctx.navigate('workshop'); return; }
  if (a === 'unlock-open') { ensureWorkshopStyles(); openUnlockSheet(ctx, t.dataset.unlock, { host: root }); return; }
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
    if (res && res.ok) {
      if (ctx.game.emit) ctx.game.emit('galleryStart', { pieceId: res.pieceId }); // ends the first-open guide step
      ctx.navigate('paint', { pieceId: res.pieceId });
    }
    else ctx.toast('That canvas is not ready yet.');
    return;
  }
  if (a === 'sell-open') { openSell(id); return; }
  if (a === 'sell-cancel') { if (!ui.selling) openPiece(id); return; }
  if (a === 'sell-confirm') { sellPiece(id); return; }
  if (a === 'continue') { closeSheet(); ctx.navigate('paint', { pieceId: id }); return; }
  if (a === 'hang') {
    const before = cellRects();
    const res = act(sim().gallery.hang, { pieceId: id });
    closeSheet();
    refresh(true);
    if (res && res.ok) {
      haptics.medium();
      setTimeout(() => audio.thunk(0.8), 180); // as the tile lands
      flipFrom(before, id, { hang: true });
      ctx.toast('Hung. Visitors will find it.');
      firstHangCard();
    } else ctx.toast('Every wall is in use. Take one down to rotate this in.');
    return;
  }
  if (a === 'unhang') {
    const before = cellRects();
    act(sim().gallery.unhang, { pieceId: id });
    audio.tick();
    haptics.light();
    closeSheet();
    refresh(true);
    flipFrom(before, id, { hang: false });
    ctx.toast('Taken down and safe in the archive.');
    return;
  }
  if (a === 'accept-offer') {
    const card = q('[data-offer]');
    const res = act(sim().gallery.acceptCollector, {});
    if (res && res.ok) {
      fx.coinArc(card, coinPillTarget(), 8); // brings its own patter and ripple
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

// ---------------------------------------------------------------------------
// First-open guide (a visitor speaks) and the "what's next" card after her first hang
// ---------------------------------------------------------------------------

/** A small papercut visitor: round glasses, a soft hat, a plum coat. */
const VISITOR_PORTRAIT = `<svg width="32" height="32" viewBox="0 0 100 100" role="img" aria-label="A gallery visitor">
<defs><clipPath id="glvc"><circle cx="50" cy="50" r="47"/></clipPath></defs>
<circle cx="50" cy="50" r="47" fill="#DCE6D6"/>
<g clip-path="url(#glvc)"><path d="M10 100 C10 76 28 68 50 68 C72 68 90 76 90 100Z" fill="#8F6F9E"/>
<rect x="43.5" y="58" width="13" height="14" rx="3" fill="#C9A07C"/>
<ellipse cx="50" cy="48" rx="17" ry="19" fill="#E3B895"/>
<path d="M33 40 C34 26 66 26 67 40 C60 35 40 35 33 40Z" fill="#4A3B33"/>
<ellipse cx="50" cy="30" rx="26" ry="5.5" fill="#2A2622"/><path d="M36 30 C36 13 64 13 64 30Z" fill="#2A2622"/>
<g fill="none" stroke="#2A2622" stroke-width="1.8"><circle cx="43" cy="48" r="5.2"/><circle cx="57" cy="48" r="5.2"/><path d="M48.2 48 H51.8"/></g>
<circle cx="43" cy="48" r="1.6" fill="#2A2622"/><circle cx="57" cy="48" r="1.6" fill="#2A2622"/>
<path d="M44.5 58 Q50 62 55.5 58" fill="none" stroke="#2A2622" stroke-width="1.8" stroke-linecap="round"/></g>
<circle cx="50" cy="50" r="47" fill="none" stroke="#2A2622" stroke-width="2.2"/></svg>`;

function stopGuide() {
  clearTimeout(ui.guideTimer);
  ui.guideTimer = 0;
  if (ui.guide) { try { ui.guide.stop(); } catch (e) { /* ignore */ } ui.guide = null; }
}

function startGuide() {
  stopGuide();
  if (typeof ctx.guide !== 'function') return;
  // Registered even while the door is locked, so app.js's 'unlocked' hand-off can start it from here.
  ui.guide = ctx.guide('gallery', [
    { anchor: '[data-coach="gallery-start"]', text: 'Paint with your colors. Hang it, and visitors pay.', endsOn: 'action',
      kicker: 'A visitor', portrait: VISITOR_PORTRAIT, event: 'galleryStart' },
  ], { screen: 'gallery' });
  const g = ui.guide;
  ui.guideTimer = setTimeout(() => {
    ui.guideTimer = 0;
    if (g !== ui.guide || isSeen(state(), 'gallery')) return;
    showStart();
    g.start();
  }, 300);
}

/** Bring the first canvas's Start painting into view so the bubble has something to point at. */
function showStart() {
  const el = q('[data-coach="gallery-start"]');
  const body = q('.screen-body');
  if (!el || !body || !el.scrollIntoView) return;
  ui.startShown = true;
  const r = el.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'center' });
}

/** Her first hang (here, or in the paint screen that just closed back to this one): two equal choices. */
function firstHangCard() {
  if (typeof ctx.guide !== 'function' || isSeen(state(), 'galleryNext')) return;
  ctx.game.act(markGuideSeen, { id: 'galleryNext' });
  clearTimeout(ui.nextTimer);
  ui.nextTimer = setTimeout(() => {
    ui.nextTimer = 0;
    ctx.guide.whatsNext({
      title: 'Hung on the wall',
      more: { label: 'Paint another', run: () => scrollToCanvases() },
      next: { label: 'Back to the workshop', run: () => ctx.navigate('workshop') },
    });
  }, 900);
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
    wireLift(root, '.gl-tile, .gl-empty', fx); // tiles lift under her finger and settle on release
    root.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-guide-replay="gallery"]')) showStart(); });
  },

  show() {
    ui.commentsAt = 0;
    refresh(true);
    ui.hungBefore = (gal().hung || []).length;
    ui.startShown = false;
    consumeHung();
    startGuide();
  },

  hide() {
    clearTimeout(ui.nextTimer);
    ui.nextTimer = 0;
    stopGuide();
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
    const hung = (gal().hung || []).length;
    if (hung > ui.hungBefore) firstHangCard();
    ui.hungBefore = hung;
    consumeHung();
    if (!ui.guide || !ui.guide.active) startGuide();
    if (paintIntent.focus === 'canvases') {
      paintIntent.focus = null;
      setTimeout(scrollToCanvases, 60);
    }
  },
};

export default screen;
export const mount = screen.mount;
