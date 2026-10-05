/**
 * catalog.js: the swatch book (tab `catalog`).
 *
 * Owns: page tabs (Wheel, Tints, Shades, Earths, Wild, the running event's
 * page, plus Era 2 and 3 as "coming in a later update" paper tags), per-page
 * progress in positive framing, the grid of swatch cells (found colors with her
 * names and Essence stars; missing colors as faint hue-family silhouettes with
 * their page position), the detail sheet (big swatch, rename, recipe in words,
 * price, stock, how it was found, pin / unpin, assign to a mixer), the pinned
 * goals strip with a suggested next step, the +2% milestone meter and the page
 * completion border. Implements DESIGN.md "Discovery and the catalog" (How
 * colors are found, Catalog structure, Catalog milestones, Catalog as a goal
 * board), "Silhouettes of the missing" and the Essence stars of "The Merge
 * Shelf". Silhouettes use only the hue family (never the exact color).
 *
 * Params: show({page?, colorId?}) switches to that page and flashes the cell.
 * data-actions: page, later, cell, pin, unpin, rename, rename-save,
 * rename-cancel, assign, go, close-sheet. data-coach="catalog" is on the
 * milestone meter; the `catalog` guide uses "catalog-missing" (the first faint
 * cell on the page) and "catalog-pin" (the pin button in a missing color's
 * sheet).
 */

import { h, raw, button, tag, iconSvg, safeHex, progressBar } from './kit.js';
import { hueFamily } from '../color.js';
import { COLORS_BY_PAGE, PAGES, EVENT_COLORS_BY_EVENT, getColor } from '../content/catalog.js';
import { getEvent } from '../content/events.js';
import { ERAS } from '../content/eras.js';
import { getPigment } from '../content/pigments.js';
import { getRegion } from '../content/regions.js';
import { isNameOk } from '../content/names.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';
import { offerWhatsNext } from './matching.js';

const PAGE_NAMES = { wheel: 'Wheel', tints: 'Tints', shades: 'Shades', earths: 'Earths', wild: 'Wild' };
const PAGE_NOTES = {
  wheel: 'The core hues and their in-betweens, found at the mixing bench.',
  tints: 'Soft in-between tints, found on grading boards.',
  shades: 'Deeper shades, found on grading boards.',
  earths: 'Earth tones from clay and stone, found by mixing.',
  wild: 'Wild hues cannot be mixed. Your hunters find them on expeditions.',
  event: 'Found during the event. This page comes back when the event reruns.',
};
const PAGE_BORDER = {
  wheel: 'conic-gradient(#B8433A,#D39B2A,#8FA77A,#3E6A9E,#6E4A7E,#B8433A)',
  tints: 'linear-gradient(135deg,#F2C6C0,#F5E2A8,#C5DDC1,#BFD2EA)',
  shades: 'linear-gradient(135deg,#4A3A3C,#3C4A44,#2F3C52)',
  earths: 'linear-gradient(135deg,#8A5F3F,#B98A55,#6F5C4C)',
  wild: 'linear-gradient(135deg,#9AC12F,#EA76AC,#804497,#4DB8A4)',
  event: 'linear-gradient(135deg,#E2B04A,#C99A2E,#F4DDA0)',
};
const FAMILY_HEX = {
  red: '#B8433A', orange: '#D9792E', yellow: '#D9A93A', green: '#6E9A55', teal: '#3F8F8A',
  blue: '#3E6A9E', violet: '#7A5A9A', pink: '#D98A9F', neutral: '#9A9288',
};
const MAX_PINS = 3;
const FAMILY_WORD = { red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', teal: 'teal', blue: 'blue', violet: 'violet', pink: 'pink', neutral: 'neutral' };
const STAR = '<svg viewBox="0 0 24 24" width="8" height="8" aria-hidden="true"><path d="M12 2.5l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3-5.6-3.1-5.6 3.1 1.2-6.3L3 9.1l6.3-.8z" fill="#E2B04A" stroke="#8C6512" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const STAR_OFF = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3-5.6-3.1-5.6 3.1 1.2-6.3L3 9.1l6.3-.8z" fill="none" stroke="#B7BDB3" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const STAR_ON = STAR.replace('width="8" height="8"', 'width="12" height="12"');

const CSS = `
#screen-catalog .screen-body > *{flex-shrink:0}
#screen-catalog .h2,#screen-catalog .card-title{font-family:var(--font-ui);font-weight:600}
#screen-catalog .btn.small{min-height:44px}
#screen-catalog .cat-wrap{position:relative;display:block}
#screen-catalog .cat-strip{position:relative;margin:0 -2px}
#screen-catalog .cat-strip::before,#screen-catalog .cat-strip::after{content:'';position:absolute;top:0;bottom:6px;width:28px;pointer-events:none;opacity:0;transition:opacity 160ms;z-index:2}
#screen-catalog .cat-strip::before{left:0;background:linear-gradient(to right,var(--plaster),rgba(0,0,0,0))}
#screen-catalog .cat-strip::after{right:0;background:linear-gradient(to left,var(--plaster),rgba(0,0,0,0))}
#screen-catalog .cat-strip.can-left::before,#screen-catalog .cat-strip.can-right::after{opacity:1}
#screen-catalog .cat-pages{position:relative;display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 6px;scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding:0 24px}
#screen-catalog .cat-pages::-webkit-scrollbar{display:none}
#screen-catalog .cat-pages .chip{flex:0 0 auto;flex-direction:column;gap:0;padding:4px 16px;min-height:44px;line-height:1.15;justify-content:center;scroll-snap-align:start}
#screen-catalog .cat-pages .chip .sub{font-size:12px}
#screen-catalog .cat-eras{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
#screen-catalog .cat-eras .tag{white-space:normal;min-height:28px}
#screen-catalog .cat-book{position:relative;border-radius:16px;padding:10px;background:rgba(247,244,236,.55);box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.08)}
#screen-catalog .cat-book.is-complete{padding:13px;background:var(--paper);border:3px solid transparent;background-image:linear-gradient(#FFF8E4,#FFF8E4),var(--bd);background-origin:border-box;background-clip:padding-box,border-box;box-shadow:var(--cut)}
#screen-catalog .cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px}
#screen-catalog .cat-cell{display:flex;flex-direction:column;align-items:stretch;gap:3px;background:var(--paper);border-radius:10px;padding:6px 6px 5px;box-shadow:var(--cut-sm);min-width:0;min-height:44px;text-align:center;position:relative}
#screen-catalog .cat-cell:active{transform:translateY(2px);box-shadow:var(--cut-press)}
#screen-catalog .cat-sw{display:block;aspect-ratio:1 / .8;border-radius:7px;box-shadow:inset 0 0 0 1px rgba(42,38,34,.12);position:relative;overflow:hidden}
#screen-catalog .cat-name{font-family:var(--font-display);font-size:12px;line-height:1.15;min-height:2.3em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
#screen-catalog .cat-stars{display:flex;justify-content:center;gap:1px;min-height:8px}
#screen-catalog .cat-cell.is-missing{background:rgba(247,244,236,.45);box-shadow:none;padding:6px}
#screen-catalog .cat-cell.is-missing .cat-sw{background:var(--fam);opacity:.25;box-shadow:none;aspect-ratio:1 / 1}
#screen-catalog .cat-cell.is-missing .cat-sw::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.95) 50%,transparent 70%);transform:translateX(-120%);animation:cat-shimmer 3.6s ease-in-out infinite;animation-delay:var(--d,0s)}
#screen-catalog .cat-pin{position:absolute;right:4px;top:4px;color:var(--ink);z-index:2}
#screen-catalog .cat-cell.is-new{animation:cat-in 520ms var(--ease-out) both;box-shadow:0 0 0 3px #E2B04A,var(--cut-sm)}
#screen-catalog .cat-goal{display:flex;gap:10px;align-items:center}
#screen-catalog .cat-goal .cat-sw{width:44px;flex:0 0 44px;aspect-ratio:1;background:var(--fam);opacity:.3}
#screen-catalog .cat-layer{position:absolute;inset:0;z-index:20;background:rgba(42,38,34,.45);display:flex;align-items:flex-end;justify-content:center;animation:fade-in 160ms ease-out both}
#screen-catalog .cat-layer[hidden]{display:none}
#screen-catalog .cat-sheet{width:100%;max-width:520px;max-height:92%}
#screen-catalog .cat-big{height:96px;border-radius:14px;box-shadow:var(--cut);position:relative;overflow:hidden}
#screen-catalog .cat-big.ghost{background:var(--fam);opacity:.35;box-shadow:none}
#screen-catalog .cat-big.ghost::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.95) 50%,transparent 70%);transform:translateX(-120%);animation:cat-shimmer 3.6s ease-in-out infinite}
#screen-catalog .cat-kv{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:5px 0}
#screen-catalog .cat-kv + .cat-kv{border-top:1px solid rgba(42,38,34,.08)}
#screen-catalog .cat-kv .k{color:var(--ink-soft);flex:0 0 auto}
#screen-catalog .cat-kv .v{text-align:right;font-weight:600;min-width:0}
#screen-catalog .cat-input{flex:1 1 auto;min-width:0;min-height:48px;border-radius:12px;border:0;padding:0 14px;background:#fff;box-shadow:inset 0 0 0 2px rgba(42,38,34,.18);font-family:var(--font-display);font-size:18px;user-select:text;-webkit-user-select:text}
#screen-catalog .cat-input:focus{outline:none;box-shadow:inset 0 0 0 2px #2A2622}
#screen-catalog .cat-ess{display:flex;gap:2px;justify-content:center}
#screen-catalog .how-link{display:inline-block;position:relative;margin-top:2px;padding:0;min-height:20px;border:0;background:none;font:inherit;font-size:12px;font-weight:600;color:var(--ink-soft);text-decoration:underline;text-underline-offset:2px;text-align:left}
#screen-catalog .how-link::before{content:'';position:absolute;inset:-12px -10px}
@media (prefers-reduced-motion:reduce){#screen-catalog .cat-cell.is-missing .cat-sw::after,#screen-catalog .cat-big.ghost::after{animation:none}}
@keyframes cat-shimmer{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@keyframes cat-in{from{opacity:0;transform:translateY(-14px) scale(.9)}to{opacity:1;transform:none}}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('catalog-css')) return;
  const s = document.createElement('style');
  s.id = 'catalog-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let root = null;
let ctx = null;
let visible = false;

const ui = {
  page: null,
  sig: '',
  fresh: null,
  freshTimer: 0,
  scrollTo: null,
  sheet: null,      // {id, rename, msg}
  guide: null,
  offer: null,
  startTimer: 0,
};

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const isFound = (id) => !!state().catalog?.discovered?.[id];

// ---------------------------------------------------------------------------
// Pages and facts
// ---------------------------------------------------------------------------

function eventPage(st) {
  const key = st.event && st.event.key;
  const ev = key ? getEvent(key) : null;
  const colors = key ? EVENT_COLORS_BY_EVENT[key] : null;
  if (!ev || !colors || !colors.length) return null;
  return { id: 'event', name: ev.name, colors };
}

function pagesOf(st) {
  const list = PAGES.map((id) => ({ id, name: PAGE_NAMES[id] || cap(id), colors: COLORS_BY_PAGE[id] || [] }));
  const ep = eventPage(st);
  if (ep) list.push(ep);
  return list;
}

function pageOfColor(st, colorId) {
  return pagesOf(st).find((p) => p.colors.some((c) => c.id === colorId))?.id || null;
}

function famOf(c) {
  return c.family || hueFamily(c.hex);
}

function recipeWords(c) {
  if (!c.recipe || !c.recipe.length) {
    return c.foundBy === 'hunt' ? 'Cannot be mixed. Hunters find it in the wild.' : 'Cannot be mixed. It comes from somewhere special.';
  }
  const parts = c.recipe.map((p) => `${p.weight} ${p.weight === 1 ? 'part' : 'parts'} ${getPigment(p.pigment)?.name || p.pigment}`);
  if (parts.length === 1) return parts[0].replace(/^1 part /, 'Pure ').replace(/^\d+ parts? /, 'Pure ');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function foundByText(c) {
  const hint = c.hint || (c.foundBy ? `found by ${c.foundBy}` : '');
  return cap(hint);
}

/** {text, screen} suggested next step for a missing color. */
function nextStep(c) {
  switch (c.foundBy) {
    case 'mix': return { text: 'Try mixing at the bench and watch for the shimmer.', screen: 'bench', cta: 'Open the bench' };
    case 'grade': return { text: 'Grading boards on the puzzle table find tints and shades.', screen: 'puzzles', cta: 'Open the puzzles' };
    case 'hunt': {
      const r = c.region ? getRegion(c.region) : null;
      return { text: r ? `Send a hunter to the ${r.name} and see what they bring home.` : 'Send a hunter out and see what they bring home.', screen: 'map', cta: 'Open the map' };
    }
    case 'commission': return { text: 'Finish a commission to earn it as a signature color.', screen: 'commissions', cta: 'See commissions' };
    case 'event': return { text: 'Play this event to collect its colors.', screen: 'quests', cta: 'See the event' };
    case 'accident': return { text: 'A happy accident at a mixer can bring it.', screen: 'workshop', cta: 'Go to the workshop' };
    default: return { text: 'Keep experimenting.', screen: 'bench', cta: 'Open the bench' };
  }
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function starsRow(n) {
  const k = Math.max(0, Math.min(10, n | 0));
  if (!k) return '';
  return raw(STAR.repeat(k));
}

function cellHtml(c, pos, st, coach = false) {
  const d = st.catalog?.discovered?.[c.id];
  if (d) {
    const name = sim().displayName(st, c.id);
    const stars = Math.min(10, d.essence || 0);
    return h`<button type="button" class="cat-cell is-found${ui.fresh === c.id ? ' is-new' : ''}" data-tap data-action="cell" data-color="${c.id}" aria-label="${name}${stars ? `, ${stars} Essence ${stars === 1 ? 'star' : 'stars'}` : ''}">
  <span class="cat-sw" style="background:${safeHex(c.hex)}"></span>
  <span class="cat-name">${name}</span>
  <span class="cat-stars">${starsRow(stars)}</span>
</button>`;
  }
  const pinned = (st.catalog?.pinned || []).includes(c.id);
  const famId = famOf(c);
  const fam = FAMILY_HEX[famId] || '#9A9288';
  // A quiet hue-family silhouette: no number, no label. The detail sheet has the hint.
  return h`<button type="button" class="cat-cell is-missing" data-tap data-action="cell"${coach ? h` data-coach="catalog-missing"` : ''} data-color="${c.id}" aria-label="A ${FAMILY_WORD[famId] || 'special'} color waiting to be found${pinned ? ', pinned goal' : ''}">
  ${pinned ? h`<span class="cat-pin">${iconSvg('pin', { size: 14 })}</span>` : ''}
  <span class="cat-sw" style="--fam:${fam};--d:${(pos % 7) * 0.45}s"></span>
</button>`;
}

function goalsHtml(st) {
  const pins = (st.catalog?.pinned || []).map((id) => getColor(id)).filter(Boolean).filter((c) => !isFound(c.id));
  if (!pins.length) return '';
  return h`<div class="card" aria-label="Pinned goals">
  <div class="row between"><div class="card-title">Pinned goals</div><div class="small muted">${pins.length >= MAX_PINS ? 'All goal spots in use' : `Room for ${MAX_PINS - pins.length} more`}</div></div>
  ${pins.map((c) => {
    const step = nextStep(c);
    return h`<div class="cat-goal">
      <span class="cat-sw" style="--fam:${FAMILY_HEX[famOf(c)] || '#9A9288'};border-radius:10px"></span>
      <div class="grow"><div class="semi small">${cap(c.hint || 'A missing color')}</div><div class="small muted">${step.text}</div></div>
      ${button('Go', { small: true, attrs: { 'data-action': 'go', 'data-color': c.id, 'aria-label': step.cta } })}
    </div>`;
  })}
</div>`;
}

function build() {
  const st = state();
  const count = sim().discoveredCount(st);
  const pages = pagesOf(st);
  if (!ui.page || !pages.some((p) => p.id === ui.page)) {
    ui.page = 'wheel'; // the swatch book opens on the Wheel page
  }
  const page = pages.find((p) => p.id === ui.page);
  const have = page.colors.filter((c) => isFound(c.id)).length;
  const left = page.colors.length - have;
  const complete = left === 0 && page.colors.length > 0;
  const firstMissing = page.colors.findIndex((c) => !isFound(c.id));
  const toNext = 10 - (count % 10);
  const nextCanvas = (Math.floor(count / 20) + 1) * 20;
  const bonus = Math.floor(count / 10) * 2;
  const scrollEl = q('.screen-body');
  const scroll = scrollEl ? scrollEl.scrollTop : 0;
  const incomeNote = bonus > 0
    ? `+${bonus}% income from your catalog now. A new canvas arrives at ${nextCanvas} colors.`
    : `First +2% at 10 colors. A new canvas arrives at ${nextCanvas} colors.`;

  root.innerHTML = String(h`
<div class="screen-head is-left">
  <div class="titles"><div class="title">Catalog</div><div class="subtitle">${count} ${count === 1 ? 'color' : 'colors'} in your swatch book</div>${howThisWorksHtml('catalog')}</div>
</div>
<div class="screen-body pad-bottom-tab">
  <div class="card" data-coach="catalog" aria-label="Catalog milestone">
    <div class="semi">${toNext} more ${toNext === 1 ? 'color' : 'colors'} to +2% income</div>
    ${progressBar((10 - toNext) / 10, { label: 'Progress to the next catalog bonus' })}
    <div class="small muted">${incomeNote}</div>
  </div>
  ${goalsHtml(st)}
  <div class="cat-strip" data-ref="strip">
    <div class="cat-pages" role="tablist" aria-label="Catalog pages">
      ${pages.map((p) => {
        const l = p.colors.length - p.colors.filter((c) => isFound(c.id)).length;
        return h`<button type="button" class="chip" role="tab" data-tap data-action="page" data-page="${p.id}" aria-pressed="${p.id === ui.page}" aria-selected="${p.id === ui.page}">${p.name}<span class="sub">${l === 0 ? 'Complete' : `${l} more`}</span></button>`;
      })}
    </div>
  </div>
  <div class="card flat tight" style="padding:10px 14px">
    <div class="row between"><div class="h2">${page.name}</div>
      <div class="small semi">${complete ? 'Page complete' : `${left} more to complete`}</div></div>
    ${progressBar(page.colors.length ? have / page.colors.length : 0, { label: `${page.name} page progress` })}
    <div class="hint">${complete ? 'You earned a golden border for this page.' : (PAGE_NOTES[page.id] || '')}</div>
  </div>
  <div class="cat-book${complete ? ' is-complete' : ''}" style="--bd:${PAGE_BORDER[page.id] || PAGE_BORDER.event}">
    <div class="cat-grid">${page.colors.map((c, i) => cellHtml(c, i + 1, st, i === firstMissing))}</div>
  </div>
  <div class="cat-eras">
    ${ERAS.filter((e) => e.id > 1).map((e) => tag(`Era ${e.id} ${e.name}: coming in a later update`))}
  </div>
</div>
<div class="cat-layer" data-ref="layer" data-action="close-sheet" hidden></div>`);

  const body = q('.screen-body');
  if (body) body.scrollTop = scroll;
  const pg = q('.cat-pages');
  if (pg) {
    centerSelectedTab(pg);
    updateStripFade();
  }
  if (ui.scrollTo) {
    const cell = root.querySelector(`[data-color="${ui.scrollTo}"]`);
    if (cell && cell.scrollIntoView) cell.scrollIntoView({ block: 'center' });
    ui.scrollTo = null;
  }
  if (ui.sheet) renderSheet(); // the layer is rebuilt with the page; keep the open sheet
}

/** Bring the selected page tab into view (centered when it can be). */
function centerSelectedTab(pg) {
  const sel = pg.querySelector('[aria-selected="true"]');
  if (!sel) return;
  const want = sel.offsetLeft - (pg.clientWidth - sel.offsetWidth) / 2;
  const max = Math.max(0, pg.scrollWidth - pg.clientWidth);
  pg.scrollLeft = Math.max(0, Math.min(max, want));
}

/** Edge fades on the page strip show when there is more to scroll to. */
function updateStripFade() {
  const pg = q('.cat-pages');
  const strip = q('[data-ref=strip]');
  if (!pg || !strip) return;
  strip.classList.toggle('can-left', pg.scrollLeft > 4);
  strip.classList.toggle('can-right', pg.scrollLeft + pg.clientWidth < pg.scrollWidth - 4);
}

function signature() {
  const st = state();
  const d = st.catalog?.discovered || {};
  const pins = (st.catalog?.pinned || []).join(',');
  const found = Object.keys(d).map((id) => `${id}:${d[id].name}:${d[id].essence || 0}`).join('|');
  return [ui.page, ui.fresh, pins, found, st.event && st.event.key, sim().discoveredCount(st)].join('#');
}

function refresh(force = false) {
  if (!root || !ctx) return;
  const sig = signature();
  if (!force && sig === ui.sig) return;
  ui.sig = sig;
  build();
}

// ---------------------------------------------------------------------------
// Detail sheet
// ---------------------------------------------------------------------------

function closeSheet() {
  ui.sheet = null;
  const layer = q('[data-ref=layer]');
  if (layer) { layer.hidden = true; layer.innerHTML = ''; }
}

function renderSheet() {
  const s = ui.sheet;
  const layer = q('[data-ref=layer]');
  if (!s || !layer) return;
  const st = state();
  const c = getColor(s.id);
  if (!c) { closeSheet(); return; }
  layer.hidden = false;
  const d = st.catalog?.discovered?.[c.id];
  if (d) layer.innerHTML = String(foundSheet(st, c, d, s));
  else layer.innerHTML = String(missingSheet(st, c));
  if (s.rename) {
    const input = layer.querySelector('[data-ref=nameinput]');
    if (input) { input.focus(); input.select(); }
  }
}

function foundSheet(st, c, d, s) {
  const name = sim().displayName(st, c.id);
  const stars = Math.min(10, d.essence || 0);
  const price = sim().colorPrice(st, c.id);
  const jars = sim().storage.stockOf(st, c.id);
  const when = d.at ? new Date(d.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const mixable = !!(c.recipe && c.recipe.length);
  return h`<div class="sheet cat-sheet" role="dialog" aria-label="${name}">
  <div class="cat-big" style="background:${safeHex(c.hex)}"></div>
  ${s.rename
    ? h`<div class="stack stack-sm"><div class="row"><input class="cat-input" data-ref="nameinput" type="text" maxlength="24" value="${name}" aria-label="New name" autocomplete="off">${button('Save', { variant: 'primary', attrs: { 'data-action': 'rename-save' } })}</div>
        <div class="hint" data-ref="msg">${s.msg || 'Letters, spaces, apostrophes and hyphens, up to 24. Your orders and vats will use it.'}</div>
        <div>${button('Cancel', { small: true, attrs: { 'data-action': 'rename-cancel' } })}</div></div>`
    : h`<div class="center stack stack-sm"><div class="serif" style="font-size:22px;line-height:1.15">${name}</div><div>${button('Rename', { small: true, cls: 'cat-rename', attrs: { 'data-action': 'rename' } })}</div>${s.msg ? h`<div class="hint">${s.msg}</div>` : ''}</div>`}
  <div class="cat-ess" aria-label="${stars} of 10 Essence stars">${raw(Array.from({ length: 10 }, (_, i) => (i < stars ? STAR_ON : STAR_OFF)).join(''))}</div>
  <div class="center small muted">${stars ? `${stars} Essence ${stars === 1 ? 'star' : 'stars'}: +${stars * 5}% production, purity and price.` : 'First star from a Cask: merge a Cask of this color on the shelf.'}</div>
  <div>
    <div class="cat-kv"><span class="k">Recipe</span><span class="v">${recipeWords(c)}</span></div>
    <div class="cat-kv"><span class="k">Price</span><span class="v num">${ctx.format.num(price)} Coins a jar</span></div>
    <div class="cat-kv"><span class="k">On hand</span><span class="v num">${jars > 0.05 ? `${ctx.format.num(jars)} jars` : 'None yet'}</span></div>
    <div class="cat-kv"><span class="k">Found</span><span class="v">${foundByText(c)}${when ? `, ${when}` : ''}</span></div>
  </div>
  <div class="row">
    ${mixable ? button('Assign to mixer', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'assign', 'data-color': c.id } }) : ''}
    ${button('Close', { block: true, cls: 'grow', attrs: { 'data-action': 'close-sheet' } })}
  </div>
</div>`;
}

function missingSheet(st, c) {
  const pins = st.catalog?.pinned || [];
  const pinned = pins.includes(c.id);
  const step = nextStep(c);
  const page = pagesOf(st).find((p) => p.colors.some((x) => x.id === c.id));
  const roomLeft = Math.max(0, MAX_PINS - pins.length);
  const pinNote = pinned
    ? 'Pinned as a goal. It shows at the top of your catalog and in the Morning Ledger.'
    : roomLeft > 0
      ? `Pin up to ${MAX_PINS} missing colors as goals. Room for ${roomLeft} more.`
      : `All ${MAX_PINS} goal spots are in use. Unpin one to make room.`;
  // While the first-open guide runs its pin step, this sheet is a labeled group: the guide
  // keeps clear of dialogs, and its bubble has to point inside this one.
  const role = ui.guide && ui.guide.active ? 'group' : 'dialog';
  return h`<div class="sheet cat-sheet" role="${role}" aria-label="A color waiting to be found">
  <div class="cat-big ghost" style="--fam:${FAMILY_HEX[famOf(c)] || '#9A9288'}"></div>
  <div class="center"><div class="h2">A ${FAMILY_WORD[famOf(c)] || 'special'} color is waiting</div>
    <div class="hint">${page ? `It belongs on the ${page.name} page` : ''}</div></div>
  <div>
    <div class="cat-kv"><span class="k">How</span><span class="v">${foundByText(c)}</span></div>
    <div class="cat-kv"><span class="k">Next step</span><span class="v">${step.text}</span></div>
  </div>
  <div class="small muted center">${pinNote}</div>
  <div class="row">
    ${button(pinned ? 'Unpin goal' : 'Pin as a goal', { variant: pinned ? 'paper' : 'primary', block: true, cls: 'grow', attrs: { 'data-action': pinned ? 'unpin' : 'pin', 'data-color': c.id, 'data-coach': pinned ? false : 'catalog-pin' } })}
    ${button(step.cta, { block: true, cls: 'grow', attrs: { 'data-action': 'go', 'data-color': c.id } })}
  </div>
  ${button('Close', { block: true, attrs: { 'data-action': 'close-sheet' } })}
</div>`;
}

function saveName() {
  const s = ui.sheet;
  const input = q('[data-ref=nameinput]');
  if (!s || !input) return;
  const name = input.value.trim().replace(/\s+/g, ' ');
  const msg = (t) => { s.msg = t; const m = q('[data-ref=msg]'); if (m) m.textContent = t; };
  if (!name) { msg('Type a name first.'); return; }
  if (!isNameOk(name)) { msg('Names can use letters, spaces, apostrophes and hyphens, up to 24, and start with a letter.'); return; }
  const res = ctx.game.act(sim().nameColor, { colorId: s.id, name });
  if (res && res.ok) {
    s.rename = false;
    s.msg = '';
    ctx.toast(`Named ${res.name}. Orders and vats will use it.`);
    renderSheet();
    refresh(true);
    return;
  }
  const reason = res && res.reason;
  msg(reason === 'taken' ? 'Another color already has that name. Try a small twist on it.' : 'That name does not fit yet. Try letters and spaces only.');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  const id = t.dataset.color;
  switch (a) {
    case 'page':
      ui.page = t.dataset.page;
      refresh(true);
      break;
    case 'cell':
      ui.sheet = { id, rename: false, msg: '' };
      renderSheet();
      break;
    case 'close-sheet':
      if (e.target === t || t.tagName === 'BUTTON') closeSheet();
      break;
    case 'pin': {
      const res = ctx.game.act(sim().pinColor, { colorId: id });
      if (res && res.ok) {
        ctx.toast('Pinned as a goal.');
        offerPinNext();
      } else ctx.toast(res && res.reason === 'full' ? `You already have ${MAX_PINS} goals pinned. Unpin one to make room.` : 'That color is already yours.');
      renderSheet();
      refresh(true);
      break;
    }
    case 'unpin':
      ctx.game.act(sim().unpinColor, { colorId: id });
      renderSheet();
      refresh(true);
      break;
    case 'rename':
      if (ui.sheet) { ui.sheet.rename = true; ui.sheet.msg = ''; renderSheet(); }
      break;
    case 'rename-cancel':
      if (ui.sheet) { ui.sheet.rename = false; ui.sheet.msg = ''; renderSheet(); }
      break;
    case 'rename-save':
      saveName();
      break;
    case 'assign':
      closeSheet();
      ctx.navigate('workshop', { panel: 'mixers', assign: id, colorId: id });
      break;
    case 'go': {
      const c = getColor(id);
      closeSheet();
      if (c) ctx.navigate(nextStep(c).screen, { colorId: id });
      break;
    }
    default:
  }
}

/** After her first pin: two equal ways on (docs/PLAN-v0.2 Theme D). */
function offerPinNext() {
  if (ui.offer) ui.offer.stop();
  ui.offer = offerWhatsNext(ctx, {
    screen: 'catalog',
    id: 'catalogNext',
    delay: 1600,
    title: 'A goal to chase',
    body: 'It waits at the top of your catalog, and in the Morning Ledger.',
    more: { label: 'Pin another', run: () => closeSheet() },
    next: { label: 'Back to the workshop', run: () => ctx.navigate('workshop') },
  });
}

/** First-open guide: faint cells, then the pin control in a sheet. */
function startGuide() {
  stopGuide();
  if (typeof ctx.guide !== 'function') return;
  const st = state();
  const pinned = () => (state().catalog?.pinned || []).length > 0;
  if (pinned() && !st.onboarding?.seen?.catalog) { // an old hand: she knows pinning
    ctx.game.act(markGuideSeen, { id: 'catalog' });
    ctx.game.act(markGuideSeen, { id: 'catalogNext' });
    return;
  }
  ui.guide = ctx.guide('catalog', [
    { anchor: '[data-coach="catalog-missing"]', text: 'Faint cells are colors still to find', endsOn: 'got-it', side: 'above', when: () => !ui.sheet },
    { anchor: '[data-coach="catalog-pin"]', text: 'Pin one to chase it', endsOn: 'action', done: pinned, side: 'above', when: () => !!ui.sheet && !isFound(ui.sheet.id) && !pinned() },
  ], { screen: 'catalog' });
  ui.startTimer = setTimeout(() => { if (ui.guide) ui.guide.start(); }, 300);
}

function stopGuide() {
  clearTimeout(ui.startTimer);
  if (ui.guide) { try { ui.guide.stop(); } catch (e) { /* ignore */ } ui.guide = null; }
}

function onKey(e) {
  if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-ref=nameinput]')) {
    e.preventDefault();
    saveName();
  }
}

function markFresh(colorId) {
  ui.fresh = colorId;
  clearTimeout(ui.freshTimer);
  ui.freshTimer = setTimeout(() => {
    ui.fresh = null;
    if (visible) refresh(true);
  }, 2400);
}

const screen = {
  id: 'catalog',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    injectCss();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('cat-pages')) updateStripFade(); }, true);
    if (ctx.game && ctx.game.on) {
      ctx.game.on('discover', (p) => {
        const id = p && (p.colorId || (p.payload && p.payload.colorId));
        if (!id) return;
        markFresh(id);
        if (!visible) return; // the next visit opens on the Wheel, or on this page via show({colorId})
        const pg = pageOfColor(state(), id);
        if (pg) ui.page = pg;
        ui.scrollTo = id;
        refresh(true);
      });
    }
  },

  show(params = {}) {
    visible = true;
    const st = state();
    if (params.colorId) {
      const pg = pageOfColor(st, params.colorId);
      if (pg) ui.page = pg;
      ui.scrollTo = params.colorId;
      if (isFound(params.colorId)) markFresh(params.colorId);
    }
    if (params.page && pagesOf(st).some((p) => p.id === params.page)) ui.page = params.page;
    closeSheet();
    refresh(true);
    startGuide();
  },

  hide() {
    visible = false;
    closeSheet();
    stopGuide();
    if (ui.offer) { ui.offer.stop(); ui.offer = null; }
  },

  render() {
    // keep an open sheet (and a half-typed name) untouched
    if (ui.sheet) return;
    refresh(false);
  },

  reveal() {
    refresh(true);
  },
};

export default screen;
export const mount = screen.mount;
