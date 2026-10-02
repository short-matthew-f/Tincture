/**
 * shelf.js: the Merge Shelf (overlay `shelf`).
 *
 * Owns: the 5x7 (6x9 expanded) grid on walnut shelves, containers drawn with
 * kit.containerSvg, drag-and-drop on pointer events (lift on pointerdown,
 * follow, drop; tap-tap fallback), the merge / chain-merge / Cask-to-Essence
 * visuals, merge hints breathing, the sell dock, row family labels with the
 * tidy-shelf glow, the header (next vial, capacity, Essence summary) and the
 * expand button. Implements DESIGN.md "The Merge Shelf" and the Merge, Chain
 * merge, Essence earned and Merge-hint rows of "Interaction feel > Interaction
 * spec". The look is docs/prototypes/Shelf.dc.html.
 *
 * Sound: this screen plays audio.clink(tier) for a merge. It never calls
 * audio.chain (the app plays the scale from the 'chain' event) nor audio.bell
 * (the app's 'essence' handler rings it and flies the star to the catalog tab
 * from the cell marked data-essence-from, which this screen sets on the merge
 * target for the duration of the merge).
 *
 * data-actions: label, set-label, sell, done, expand, close-sheet.
 * Cells carry data-cell="<index>". data-coach="shelf" is on the board.
 */

import { h, raw, backButton, button, tag, iconSvg, containerSvg, CONTAINER_NAMES, safeHex } from './kit.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';

const UNLOCK_COLORS = 5;
const FAMILIES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'neutral'];
const FAMILY_HEX = {
  red: '#B8433A', orange: '#D9792E', yellow: '#D9A93A', green: '#6E9A55', teal: '#3F8F8A',
  blue: '#3E6A9E', violet: '#7A5A9A', pink: '#D98A9F', neutral: '#9A9288',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const CSS = `
#screen-shelf .screen-body > *{flex-shrink:0}
#screen-shelf .sh-info{gap:8px}
#screen-shelf .sh-board{background:#7B5236;border-radius:16px;padding:12px 10px 8px;box-shadow:0 4px 0 rgba(42,38,34,.3);display:flex;flex-direction:column;gap:0}
#screen-shelf .sh-board.is-locked{opacity:.55;pointer-events:none}
#screen-shelf .sh-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:6px;align-items:end;border-radius:10px;position:relative}
#screen-shelf .sh-row.is-tidy{box-shadow:0 0 0 2px rgba(226,176,74,.95),0 0 14px rgba(226,176,74,.55)}
#screen-shelf .sh-cells{display:grid;gap:6px}
#screen-shelf .sh-plank{height:8px;background:#8A5F3F;border-radius:3px;box-shadow:0 2px 0 rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.18);margin:3px -4px 9px}
#screen-shelf .sh-cell{height:var(--cellh,74px);border-radius:10px;background:#5E3E28;box-shadow:inset 0 3px 0 rgba(0,0,0,.25);display:flex;align-items:flex-end;justify-content:center;padding:0 0 4px;position:relative;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
#screen-shelf .sh-cell.has-item{touch-action:none;cursor:grab}
#screen-shelf .sh-cell svg{pointer-events:none;overflow:visible}
#screen-shelf .sh-cell.is-sel{box-shadow:0 0 0 3px #F7F4EC,0 0 0 5px #E2B04A,inset 0 3px 0 rgba(0,0,0,.25)}
#screen-shelf .sh-cell.is-partner{box-shadow:inset 0 0 0 2px rgba(226,176,74,.95),inset 0 3px 0 rgba(0,0,0,.25)}
#screen-shelf .sh-cell.is-target{box-shadow:inset 0 0 0 2px rgba(247,244,236,.8),inset 0 3px 0 rgba(0,0,0,.25)}
#screen-shelf .sh-cell.is-target.is-mergeable{box-shadow:inset 0 0 0 3px #E2B04A,0 0 10px rgba(226,176,74,.7)}
#screen-shelf .sh-cell.is-lifted svg{transform:scale(1.06);filter:drop-shadow(0 4px 0 rgba(0,0,0,.3))}
#screen-shelf .sh-cell.is-ghosted svg{opacity:.3}
#screen-shelf .sh-tag{height:44px;border-radius:4px 10px 10px 4px;background:#F7F4EC;box-shadow:0 2px 0 rgba(0,0,0,.25);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;font-weight:700;color:#5E5148;margin-bottom:0}
#screen-shelf .sh-tag i{display:block;width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.3)}
#screen-shelf .sh-tag i.none{background:transparent;box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.25);border-style:dashed}
#screen-shelf .sh-tag .tidy{color:#7A5410}
#screen-shelf .sh-dock{flex:0 0 auto;margin:0 14px calc(10px + var(--safe-bottom));padding:10px 12px;flex-direction:row;align-items:center;gap:10px}
#screen-shelf .sh-dock[hidden]{display:none}
#screen-shelf .sh-ess{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-variant-numeric:tabular-nums}
#screen-shelf .sh-layer{position:absolute;inset:0;z-index:20;background:rgba(42,38,34,.45);display:flex;align-items:flex-end;justify-content:center;animation:fade-in 160ms ease-out both}
#screen-shelf .sh-layer[hidden]{display:none}
#screen-shelf .sh-fams{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
#screen-shelf .sh-fams .chip{justify-content:flex-start;min-height:44px}
#screen-shelf .sh-fams .chip i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.3);flex:0 0 auto}
.sh-ghost{position:fixed;left:0;top:0;pointer-events:none;z-index:70;filter:drop-shadow(0 8px 0 rgba(0,0,0,.28));will-change:transform}
.sh-ghost svg{display:block}
.sh-star{position:fixed;left:0;top:0;pointer-events:none;z-index:70;will-change:transform,opacity}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('shelf-css')) return;
  const s = document.createElement('style');
  s.id = 'shelf-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let root = null;
let ctx = null;
let fx = fxDefault;
let audio = audioDefault;
let haptics = hapticsDefault;

const ui = {
  sel: null,       // selected cell (tap-tap + sell dock)
  drag: null,      // active pointer interaction
  anim: 0,         // running animations: render() waits
  dirty: false,
  sig: '',
  sheet: null,
  skeleton: false,
  hintSig: '',
};

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);
const hexOf = (id) => sim().colorHex(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function anim(elm, keyframes, options) {
  if (!elm || typeof elm.animate !== 'function') return Promise.resolve();
  try {
    return elm.animate(keyframes, options).finished.then(() => undefined, () => undefined);
  } catch (e) { return Promise.resolve(); }
}

const geometry = (st) => (st.shelf.cols >= 6
  ? { size: 38, cellh: 62 }
  : { size: 46, cellh: 74 });

function cellName(st, c) {
  if (!c) return '';
  const tierName = CONTAINER_NAMES[c.tier] || 'Container';
  return c.golden ? `Golden ${tierName.toLowerCase()}` : `${sim().displayName(st, c.color)} ${tierName.toLowerCase()}`;
}

function totalEssence(st) {
  let n = 0;
  for (const d of Object.values(st.catalog?.discovered || {})) n += Math.min(sim().ESSENCE_MAX, d.essence || 0);
  return n;
}
function essenceColors(st) {
  return Object.values(st.catalog?.discovered || {}).filter((d) => (d.essence || 0) > 0).length;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function cellHtml(st, i, c, geo) {
  const label = c ? cellName(st, c) : 'Empty spot';
  const svg = c ? containerSvg(c.tier, hexOf(c.color), { golden: !!c.golden, size: geo.size, label: '' }) : '';
  return h`<div class="sh-cell${c ? ' has-item' : ''}" data-cell="${i}" role="button" tabindex="${c ? 0 : -1}" aria-label="${label}"${c ? raw(' data-tap') : ''}>${svg}</div>`;
}

function boardHtml(st) {
  const s = st.shelf;
  const geo = geometry(st);
  const tidy = sim().shelf.tidyRows(st);
  const rows = [];
  for (let r = 0; r < s.rows; r++) {
    const cells = [];
    for (let c = 0; c < s.cols; c++) cells.push(cellHtml(st, r * s.cols + c, s.cells[r * s.cols + c], geo));
    const label = s.rowLabels[r];
    rows.push(h`<div class="sh-row${tidy[r] ? ' is-tidy' : ''}" data-row="${r}">
  <div class="sh-cells" style="grid-template-columns:repeat(${s.cols},minmax(0,1fr))">${cells}</div>
  <button type="button" class="sh-tag" data-tap data-action="label" data-row="${r}" aria-label="${label ? `Row label: ${label}${tidy[r] ? ', tidy shelf bonus' : ''}` : 'Set a row label'}">
    ${label ? h`<i style="background:${FAMILY_HEX[label] || '#9A9288'}"></i>` : h`<i class="none"></i>`}
    ${tidy[r] ? h`<span class="tidy">+10%</span>` : ''}
  </button>
</div><div class="sh-plank"></div>`);
  }
  return h`${rows}`;
}

function skeleton() {
  root.innerHTML = String(h`
<div class="screen-head">
  ${backButton('Back to the workshop')}
  <div class="titles"><div class="title">Merge Shelf</div><div class="subtitle">Drag or tap two matching containers</div></div>
  <span class="spacer"></span>
</div>
<div class="screen-body" data-ref="body">
  <div class="card sh-info">
    <div class="row between top">
      <div class="grow"><div class="semi" data-ref="next"></div><div class="small muted" data-ref="cap"></div></div>
      <div class="sh-ess shrink0" title="Essence stars">${iconSvg('star', { size: 20 })}<span data-ref="ess">0</span><span class="small muted" style="font-weight:500" data-ref="essnote"></span></div>
    </div>
    <div data-ref="unlocktag"></div>
    <div data-ref="expand"></div>
  </div>
  <div class="sh-board" data-ref="board" data-coach="shelf"></div>
  <div class="hint center">Merging never changes a color. Tidy rows of one family earn +10%.</div>
</div>
<div class="card sh-dock" data-ref="dock" hidden></div>
<div class="sh-layer" data-ref="layer" data-action="close-sheet" hidden></div>`);
  ui.skeleton = true;
  ui.sig = '';
}

// ---------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------

function updateHeader(st, now) {
  const s = st.shelf;
  const unlocked = sim().shelf.unlocked(st);
  const used = s.cells.filter(Boolean).length;
  const free = s.cells.length - used;
  let next;
  if (!unlocked) next = 'The shelf is waiting for its first colors';
  else if (free === 0) next = 'The shelf is full. Merge or sell to make room.';
  else if (!(s.nextSpilloverAt > 0)) next = s.pausedRemainingMs > 0 ? `Mixers are paused. Next vial ${ctx.format.duration(s.pausedRemainingMs)} after they run` : 'Vials arrive while your mixers run';
  else {
    const ms = s.nextSpilloverAt - now;
    next = ms <= 1000 ? 'A vial is on its way' : `Next vial in ${ctx.format.duration(ms)}`;
  }
  q('[data-ref=next]').textContent = next;
  q('[data-ref=cap]').textContent = `${free} free ${free === 1 ? 'spot' : 'spots'} of ${s.cells.length}`;
  if (!ui.anim) {
    const essEl = q('[data-ref=ess]');
    const n = totalEssence(st);
    if (essEl.textContent !== String(n)) essEl.textContent = String(n);
  }
  const ec = essenceColors(st);
  q('[data-ref=essnote]').textContent = ec ? `in ${ec} ${ec === 1 ? 'color' : 'colors'}` : 'none yet';
  const tg = q('[data-ref=unlocktag]');
  const n = sim().discoveredCount(st);
  const tgHtml = unlocked ? '' : String(h`${tag(`Opens at ${UNLOCK_COLORS} colors`)} <span class="small semi">${UNLOCK_COLORS - n} more ${UNLOCK_COLORS - n === 1 ? 'color' : 'colors'}</span>`);
  if (tg.dataset.k !== tgHtml) { tg.dataset.k = tgHtml; tg.innerHTML = tgHtml; }
  // expand button
  const ex = q('[data-ref=expand]');
  let exHtml = '';
  if (unlocked && s.cols < sim().shelf.EXPANDED.cols) {
    const cost = sim().shelf.EXPAND_COST;
    const afford = (st.coins || 0) >= cost;
    exHtml = String(button(`Expand to ${sim().shelf.EXPANDED.cols} x ${sim().shelf.EXPANDED.rows} for ${ctx.format.num(cost)}`, {
      variant: afford ? 'primary' : 'paper', small: true, block: true, icon: 'plus',
      attrs: { 'data-action': 'expand', 'aria-disabled': afford ? null : 'true' },
    }));
  }
  if (ex.dataset.k !== exHtml) { ex.dataset.k = exHtml; ex.innerHTML = exHtml; }
}

function boardSig(st) {
  const s = st.shelf;
  return [
    s.cols, s.rows, sim().shelf.unlocked(st),
    s.cells.map((c) => (c ? `${c.color}:${c.tier}:${c.golden ? 1 : 0}` : '-')).join(','),
    s.rowLabels.join(','),
    sim().shelf.tidyRows(st).map((t) => (t ? 1 : 0)).join(''),
    // colors rename -> aria labels
    Object.values(st.catalog?.discovered || {}).map((d) => d.name).join('|'),
  ].join('#');
}

function applyHints(st) {
  const board = q('[data-ref=board]');
  const hints = new Set(sim().shelf.hints(st));
  board.querySelectorAll('.sh-cell').forEach((cell) => {
    const i = +cell.dataset.cell;
    const svg = cell.querySelector('svg');
    if (svg) fx.pulse(svg, hints.has(i) && !(ui.drag && ui.drag.moved && ui.drag.i === i));
    const sel = ui.sel;
    cell.classList.toggle('is-sel', sel === i);
    cell.classList.toggle('is-partner', sel !== null && sel !== i && !!st.shelf.cells[i] && sim().shelf.canMerge(st.shelf.cells[sel], st.shelf.cells[i]));
  });
}

function updateDock(st, now) {
  const dock = q('[data-ref=dock]');
  const i = ui.sel;
  const c = i === null ? null : st.shelf.cells[i];
  if (!c) {
    ui.sel = null;
    dock.hidden = true;
    dock.dataset.k = '';
    return;
  }
  const value = sim().shelf.containerValue(st, i, now);
  const tidy = sim().shelf.tidyRows(st)[Math.floor(i / st.shelf.cols)];
  const k = `${i}:${c.color}:${c.tier}:${c.golden ? 1 : 0}`;
  if (dock.dataset.k !== k) {
    dock.dataset.k = k;
    dock.hidden = false;
    dock.innerHTML = String(h`
  <div class="shrink0" style="width:30px">${containerSvg(c.tier, hexOf(c.color), { golden: !!c.golden, size: 30 })}</div>
  <div class="grow"><div class="semi ellipsis">${cellName(st, c)}</div><div class="small muted"><span data-ref="dockval"></span></div></div>
  ${button('Done', { small: true, attrs: { 'data-action': 'done' } })}
  ${button('Sell', { small: true, variant: 'primary', attrs: { 'data-action': 'sell' } })}`);
  }
  q('[data-ref=dockval]').textContent = `Sells for ${ctx.format.num(value)} Coins${tidy ? ', tidy bonus included' : ''}${c.golden ? '. Golden: merge it to double a partner.' : ''}`;
}

function refresh(force = false) {
  if (!root || !ctx || !ui.skeleton) return;
  const st = state();
  const now = ctx.game.now();
  updateHeader(st, now);
  if (ui.drag || ui.anim) { if (force) ui.dirty = true; else if (boardSig(st) !== ui.sig) ui.dirty = true; return; }
  const sig = boardSig(st);
  if (force || sig !== ui.sig) {
    ui.sig = sig;
    ui.dirty = false;
    const body = q('[data-ref=body]');
    const top = body ? body.scrollTop : 0;
    const board = q('[data-ref=board]');
    const geo = geometry(st);
    board.style.setProperty('--cellh', geo.cellh + 'px');
    board.classList.toggle('is-locked', !sim().shelf.unlocked(st));
    board.innerHTML = String(boardHtml(st));
    if (body) body.scrollTop = top;
  }
  if (ui.sel !== null && !st.shelf.cells[ui.sel]) ui.sel = null;
  applyHints(st);
  updateDock(st, now);
}

// ---------------------------------------------------------------------------
// Merge visuals
// ---------------------------------------------------------------------------

function cellEl(i) {
  return q(`.sh-cell[data-cell="${i}"]`);
}

function setCellContent(el, tier, colorId, golden, size) {
  el.innerHTML = String(containerSvg(tier, hexOf(colorId), { golden, size }));
  el.classList.add('has-item');
}

function pop(el) {
  const svg = el.querySelector('svg');
  if (fx.isReducedMotion()) { fx.fade(svg || el); return Promise.resolve(); }
  return anim(svg, [
    { transform: 'scale(0.6)' },
    { transform: 'scale(1.1)', offset: 0.6 },
    { transform: 'scale(1)' },
  ], { duration: 220, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' });
}

/** A gold star rises off the Cask and fades (reduced motion: a fade in place). */
function starLift(fromEl) {
  const a = fromEl.getBoundingClientRect();
  const layer = document.getElementById('fx-layer') || document.body;
  const star = document.createElement('div');
  star.className = 'sh-star';
  star.innerHTML = String(iconSvg('star', { size: 26 }));
  star.style.margin = '-13px 0 0 -13px';
  layer.appendChild(star);
  const x = a.left + a.width / 2;
  const y = a.top + a.height / 2;
  const rm = fx.isReducedMotion();
  return anim(star, rm
    ? [{ transform: `translate(${x}px,${y}px)`, opacity: 0 }, { transform: `translate(${x}px,${y}px)`, opacity: 1 }, { transform: `translate(${x}px,${y}px)`, opacity: 0 }]
    : [
      { transform: `translate(${x}px,${y}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x}px,${y - 30}px) scale(1.3)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x}px,${y - 46}px) scale(1.1)`, opacity: 0 },
    ], { duration: rm ? 240 : 520, easing: 'ease-out' }).then(() => star.remove());
}

async function playMerge(from, to, before, after, res, essBefore) {
  const st = state();
  const geo = geometry(st);
  const board = q('[data-ref=board]');
  board.querySelectorAll('.pulse').forEach((n) => n.classList.remove('pulse'));
  board.querySelectorAll('.is-lifted,.is-ghosted,.is-target,.is-sel,.is-partner').forEach((n) => n.classList.remove('is-lifted', 'is-ghosted', 'is-target', 'is-mergeable', 'is-sel', 'is-partner'));
  const fromEl = cellEl(from);
  const toEl = cellEl(to);
  if (!fromEl || !toEl) return;
  const reduced = fx.isReducedMotion();
  const steps = res.steps || [];
  const first = steps[0];
  const consumed = [];
  before.forEach((c, i) => { if (c && !after[i] && i !== from && i !== to) consumed.push(i); });

  // Step 0: lean in, squash, pop.
  const fromSvg = fromEl.querySelector('svg');
  const toSvg = toEl.querySelector('svg');
  if (!reduced && fromSvg && toSvg) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    await Promise.all([
      anim(fromSvg, [
        { transform: 'translate(0,0) rotate(0deg)' },
        { transform: `translate(${dx * 0.8}px,${dy * 0.8}px) rotate(${dx >= 0 ? 9 : -9}deg) scale(0.95)` },
      ], { duration: 130, easing: 'ease-in', fill: 'forwards' }),
      anim(toSvg, [{ transform: 'scale(1)' }, { transform: 'scale(1.07,0.88)' }], { duration: 130, easing: 'ease-out', fill: 'forwards' }),
    ]);
  }
  fromEl.innerHTML = '';
  fromEl.classList.remove('has-item');
  const golden0 = !!(before[from] && before[to] && before[from].golden && before[to].golden);
  setCellContent(toEl, first.tier, first.colorId, golden0, geo.size);
  fx.ringBurst(toEl, safeHex(hexOf(first.colorId)));
  audio.clink(first.tier);
  if (first.tier >= 5) haptics.heavy(); else haptics.medium();
  let popP = pop(toEl);

  // Chain steps, 90 ms apart (the app plays the scale from the 'chain' event).
  for (let k = 1; k < steps.length; k++) {
    await wait(90);
    const cEl = consumed[k - 1] !== undefined ? cellEl(consumed[k - 1]) : null;
    if (cEl) {
      const csvg = cEl.querySelector('svg');
      if (!reduced && csvg) {
        const a = cEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        anim(csvg, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${b.left - a.left}px,${b.top - a.top}px) scale(0.7)`, opacity: 0.2 }], { duration: 110, easing: 'ease-in', fill: 'forwards' });
      }
      setTimeout(() => { cEl.innerHTML = ''; cEl.classList.remove('has-item'); }, 110);
    }
    const s = steps[k];
    setCellContent(toEl, s.tier, s.colorId, false, geo.size);
    fx.ringBurst(toEl, safeHex(hexOf(s.colorId)), { size: 60 });
    haptics.light();
    popP = pop(toEl);
  }
  await popP;

  // Cask -> Essence: a star lifts off the Cask. The app's 'essence' handler plays the
  // bell and flies the dot from [data-essence-from] (set on this cell) to the catalog.
  if (res.essence) {
    const svg = toEl.querySelector('svg');
    const lift = starLift(toEl);
    anim(svg, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9) translateY(-6px)' }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
    await lift;
    await wait(650); // the dot's flight to the catalog tab
    const essEl = q('[data-ref=ess]');
    const essNow = totalEssence(state());
    if (essEl) await fx.rollNumber(essEl, essBefore, essNow, { ms: 400, format: (v) => String(Math.round(v)) });
  }
  toEl.removeAttribute('data-essence-from');
}

function startAnim(fn) {
  ui.anim++;
  return Promise.resolve().then(fn).catch(() => undefined).then(() => {
    ui.anim = Math.max(0, ui.anim - 1);
    if (!ui.anim) refresh(true);
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function doMerge(from, to) {
  const st = state();
  const before = st.shelf.cells.map((c) => (c ? { ...c } : null));
  const essBefore = totalEssence(st);
  ui.sel = null;
  ui.anim++; // freeze rendering before act() emits 'change'
  const toEl0 = cellEl(to);
  if (toEl0) toEl0.setAttribute('data-essence-from', ''); // origin for the app's Essence flight
  const res = ctx.game.act(sim().shelf.merge, { from, to });
  ui.anim = Math.max(0, ui.anim - 1);
  if (!res || !res.ok) { refresh(true); return; }
  const after = state().shelf.cells.map((c) => (c ? { ...c } : null));
  startAnim(() => playMerge(from, to, before, after, res, essBefore));
}

function doMove(from, to) {
  ui.sel = null;
  ui.anim++;
  const res = ctx.game.act(sim().shelf.move, { from, to });
  ui.anim = Math.max(0, ui.anim - 1);
  if (res && res.ok) { audio.tick(); haptics.light(); }
  refresh(true);
}

function doSell(i) {
  const st = state();
  const c = st.shelf.cells[i];
  if (!c) return;
  const el = cellEl(i);
  ui.sel = null;
  ui.anim++;
  const res = ctx.game.act(sim().shelf.sell, { cell: i });
  ui.anim = Math.max(0, ui.anim - 1);
  if (!res || !res.ok) { refresh(true); return; }
  audio.coins(6);
  haptics.ripple(3);
  ctx.toast(`+${ctx.format.num(res.coins)} Coins`);
  updateDock(state(), ctx.game.now());
  startAnim(async () => {
    const svg = el && el.querySelector('svg');
    if (svg) await anim(svg, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6) translateY(-10px)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
  });
}

function tapCell(i) {
  const st = state();
  const cells = st.shelf.cells;
  const c = cells[i];
  if (ui.sel === null) {
    if (c) { ui.sel = i; refresh(true); }
    return;
  }
  if (ui.sel === i) { ui.sel = null; refresh(true); return; }
  const from = ui.sel;
  if (!c) { doMove(from, i); return; }
  if (sim().shelf.canMerge(cells[from], c)) { doMerge(from, i); return; }
  ui.sel = i;
  refresh(true);
}

function openLabelSheet(row) {
  const st = state();
  const cur = st.shelf.rowLabels[row];
  ui.sheet = row;
  const layer = q('[data-ref=layer]');
  layer.hidden = false;
  layer.innerHTML = String(h`<div class="sheet" role="dialog" aria-label="Row label">
  <div class="center"><div class="h2">Label this row</div><div class="hint">A row holding only one family earns a +10% tidy bonus.</div></div>
  <div class="sh-fams">${FAMILIES.map((f) => h`<button type="button" class="chip" data-tap data-action="set-label" data-family="${f}" aria-pressed="${cur === f}"><i style="background:${FAMILY_HEX[f]}"></i>${cap(f)}</button>`)}</div>
  ${button('No label', { block: true, attrs: { 'data-action': 'set-label', 'data-family': '' } })}
</div>`);
}

function closeSheet() {
  ui.sheet = null;
  const layer = q('[data-ref=layer]');
  if (layer) { layer.hidden = true; layer.innerHTML = ''; }
}

function onClick(e) {
  const cell = e.target.closest('.sh-cell');
  if (cell && root.contains(cell)) {
    const i = +cell.dataset.cell;
    const has = !!state().shelf.cells[i];
    if (has && e.detail !== 0) return; // pointer taps on containers are handled on pointerup
    if (ui.anim) return;
    tapCell(i);
    return;
  }
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  if (a === 'close-sheet') { if (e.target === t) closeSheet(); return; }
  if (a === 'label') { openLabelSheet(+t.dataset.row); return; }
  if (a === 'set-label') {
    ctx.game.act(sim().shelf.setRowLabel, { row: ui.sheet, family: t.dataset.family || null });
    closeSheet();
    refresh(true);
    return;
  }
  if (a === 'done') { ui.sel = null; refresh(true); return; }
  if (a === 'sell') { if (ui.sel !== null) doSell(ui.sel); return; }
  if (a === 'expand') {
    const res = ctx.game.act(sim().shelf.expand, {});
    if (res && res.ok) {
      audio.thunk();
      haptics.medium();
      ctx.toast(`The shelf grew to ${sim().shelf.EXPANDED.cols} x ${sim().shelf.EXPANDED.rows}.`);
      refresh(true);
    } else if (res && res.reason === 'coins') {
      ctx.toast(`${ctx.format.num(Math.max(0, res.cost - (state().coins || 0)))} more Coins and the shelf can grow.`);
    }
  }
}

function onKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest && e.target.closest('.sh-cell');
  if (!cell) return;
  e.preventDefault();
  if (!ui.anim) tapCell(+cell.dataset.cell);
}

// ---------------------------------------------------------------------------
// Drag and drop (pointer events)
// ---------------------------------------------------------------------------

let scrollTimer = 0;

function stopAutoScroll() {
  if (scrollTimer) { cancelAnimationFrame(scrollTimer); scrollTimer = 0; }
}

function autoScroll() {
  const d = ui.drag;
  if (!d || !d.moved) { scrollTimer = 0; return; }
  const body = q('[data-ref=body]');
  if (body) {
    const r = body.getBoundingClientRect();
    if (d.y < r.top + 56) body.scrollTop -= 9;
    else if (d.y > r.bottom - 56) body.scrollTop += 9;
  }
  scrollTimer = requestAnimationFrame(autoScroll);
}

function clearTargets() {
  root.querySelectorAll('.sh-cell.is-target').forEach((n) => n.classList.remove('is-target', 'is-mergeable'));
}

function endDrag() {
  const d = ui.drag;
  if (!d) return;
  stopAutoScroll();
  if (d.ghost) d.ghost.remove();
  clearTargets();
  const el = cellEl(d.i);
  if (el) el.classList.remove('is-lifted', 'is-ghosted');
  ui.drag = null;
}

function onPointerDown(e) {
  if (ui.anim || ui.drag || (e.button !== undefined && e.button > 0)) return;
  const cell = e.target.closest && e.target.closest('.sh-cell.has-item');
  if (!cell || !root.contains(cell)) return;
  const i = +cell.dataset.cell;
  if (!state().shelf.cells[i]) return;
  ui.drag = { i, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, ghost: null, el: cell };
  cell.classList.add('is-lifted');
  try { cell.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
}

function startGhost(d) {
  const svg = d.el.querySelector('svg');
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'sh-ghost';
  ghost.innerHTML = svg.outerHTML;
  const gs = ghost.firstElementChild;
  gs.classList.remove('pulse');
  gs.style.transform = 'none';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  d.gw = r.width;
  d.gh = r.height;
  (document.getElementById('fx-layer') || document.body).appendChild(ghost);
  d.ghost = ghost;
  d.el.classList.remove('is-lifted');
  d.el.classList.add('is-ghosted');
  fx.pulse(svg, false);
  haptics.light();
}

function placeGhost(d) {
  if (!d.ghost) return;
  const s = 1.14;
  d.ghost.style.transform = `translate(${d.x - d.gw / 2}px,${d.y - d.gh * 0.7}px) scale(${s})`;
}

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const c = el && el.closest ? el.closest('.sh-cell') : null;
  return c && root.contains(c) ? c : null;
}

function onPointerMove(e) {
  const d = ui.drag;
  if (!d || e.pointerId !== d.id) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.moved) {
    if (Math.hypot(d.x - d.x0, d.y - d.y0) < 7) return;
    d.moved = true;
    startGhost(d);
    scrollTimer = requestAnimationFrame(autoScroll);
  }
  placeGhost(d);
  clearTargets();
  const t = cellAt(d.x, d.y);
  if (t && +t.dataset.cell !== d.i) {
    const cells = state().shelf.cells;
    t.classList.add('is-target');
    if (sim().shelf.canMerge(cells[d.i], cells[+t.dataset.cell])) t.classList.add('is-mergeable');
  }
}

function onPointerUp(e) {
  const d = ui.drag;
  if (!d || e.pointerId !== d.id) return;
  const wasMoved = d.moved;
  const from = d.i;
  const target = wasMoved ? cellAt(e.clientX, e.clientY) : null;
  const to = target ? +target.dataset.cell : null;
  endDrag();
  if (!wasMoved) {
    tapCell(from);
    return;
  }
  const cells = state().shelf.cells;
  if (to === null || to === from || to < 0 || to >= cells.length) { refresh(true); return; }
  if (sim().shelf.canMerge(cells[from], cells[to])) doMerge(from, to);
  else doMove(from, to);
}

function onPointerCancel(e) {
  const d = ui.drag;
  if (!d || e.pointerId !== d.id) return;
  endDrag();
  refresh(true);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const screen = {
  id: 'shelf',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    fx = ctx.fx || fxDefault;
    audio = ctx.audio || audioDefault;
    haptics = ctx.haptics || hapticsDefault;
    injectCss();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.sh-cell')) e.preventDefault(); });
  },

  show() {
    endDrag();
    ui.sel = null;
    ui.anim = 0;
    skeleton();
    refresh(true);
  },

  hide() {
    endDrag();
    closeSheet();
  },

  render() {
    refresh(false);
  },

  reveal() {
    refresh(true);
  },
};

export default screen;
export const mount = screen.mount;
