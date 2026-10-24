/**
 * garden-card.js: The Dye Garden's cards on other screens (the Puzzles hub and
 * the Map). Both are cheap reads of sim.garden.summary; their one button
 * carries data-action="open-garden" (each screen navigates to 'garden'), and a
 * closed garden shows the shared unlock tag (data-action="unlock-open").
 * Kept apart from garden.js so those screens never load the canvas code.
 */

import { h, raw, button } from './kit.js';
import { unlockTag } from './workshop.js';
import { gardenIcon } from './garden-art.js';
import { LEVEL_BY_ID } from '../puzzles/garden-path.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const CSS = `
.gd-card .gd-row { display: flex; align-items: center; gap: 10px; }
.gd-card .gd-ic { flex: none; width: 44px; height: 44px; border-radius: 12px; background: #EEF0E4; display: grid; place-items: center; box-shadow: inset 0 0 0 1px rgba(42,38,34,.08); }
.gd-card .gd-dots { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.gd-card .gd-dots i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(42,38,34,.18); }
`;
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('gd-card-css')) return;
  const s = document.createElement('style');
  s.id = 'gd-card-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function placeName(ctx, id) {
  const p = ctx.puzzles && ctx.puzzles.garden && ctx.puzzles.garden.PLACE_BY_ID[id];
  if (!p && LEVEL_BY_ID[id]) return `Garden ${LEVEL_BY_ID[id].n} of the Garden Path`;
  return p ? p.name.replace(/^The /, 'the ') : 'the garden';
}

function lineFor(ctx, sum) {
  if (sum.wandering) {
    const n = sum.wandering.plants;
    return `You left off in ${placeName(ctx, sum.wandering.placeId)}${n ? ` with ${plural(n, 'plant', 'plants')} in the basket` : ''}.`;
  }
  const last = sum.last;
  if (last && (last.plants > 0 || last.coins > 0)) {
    const jars = (last.stock || []).reduce((s, e) => s + (e.jars || 0), 0);
    const coins = last.coins > 0 ? `${ctx.format ? ctx.format.num(last.coins) : String(last.coins)} ${last.coins === 1 ? 'coin' : 'coins'}` : '';
    const parts = [coins, jars ? plural(jars, 'jar', 'jars') + ' for the shelves' : ''].filter(Boolean);
    const where = placeName(ctx, last.placeId);
    return parts.length ? `Last visit to ${where}: ${parts.join(' and ')}.` : `Last visit to ${where}: ${plural(last.plants, 'plant', 'plants')} gathered.`;
  }
  return 'Five places to wander, with no clock, and a Garden Path of 108 gardens to walk.';
}

function dots(ctx, state) {
  const list = ctx.sim.garden.shelfList(state).slice(0, 10);
  if (!list.length) return '';
  return raw(`<div class="gd-dots" aria-hidden="true">${list.map((d) => `<i style="background:${d.hex}"></i>`).join('')}</div>`);
}

/** The Puzzles hub card. */
export function gardenCardHtml(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.garden) return '';
  injectCss();
  const sum = ctx.sim.garden.summary(state);
  if (!sum.open) {
    return h`<div class="card gd-card" id="pz-garden" data-coach="garden-card">
<div class="gd-row"><span class="gd-ic">${raw(gardenIcon(30))}</span><div class="grow"><div class="h3">Dye Garden</div>
<div class="hint">Steer a basket through real dye plants. It grows as it fills, until even the shed fits.</div></div></div>
<div class="pz-tiertag">${unlockTag(ctx, 'garden', { cls: 'pz-tag' })}</div>
</div>`;
  }
  const stats = sum.path && sum.path.done ? `Path ${sum.path.done} / ${sum.path.total}` : sum.visits ? `${plural(sum.visits, 'visit', 'visits')}${sum.spindles ? ` · ${plural(sum.spindles, 'spindle', 'spindles')}` : ''}` : '';
  return h`<div class="card gd-card" id="pz-garden" data-coach="garden-card">
<div class="row between"><div class="h3">Dye Garden</div>${stats ? h`<span class="chip">${stats}</span>` : ''}</div>
<div class="gd-row"><span class="gd-ic">${raw(gardenIcon(30))}</span><div class="grow"><div class="hint">${lineFor(ctx, sum)}</div>${dots(ctx, state)}</div></div>
${button(sum.wandering ? (sum.wandering.mode === 'path' ? 'Keep going on the path' : 'Keep wandering') : 'Go to the garden', { variant: 'primary', block: true, attrs: { 'data-action': 'open-garden' } })}
</div>`;
}

/** The Map card: the five places sit by the map's regions. */
export function gardenMapCardHtml(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.garden || !ctx.puzzles || !ctx.puzzles.garden) return '';
  injectCss();
  const G = ctx.puzzles.garden;
  const sum = ctx.sim.garden.summary(state);
  const regionName = (id) => {
    const r = (ctx.content.REGIONS || []).find((x) => x.id === id);
    return r ? r.name : id;
  };
  const names = G.PLACES.map((p) => `the ${regionName(G.PLACE_REGION[p.id])}`);
  const where = `Five places to gather dye plants, by ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}, and the Garden Path's 108 gardens.`;
  const action = sum.open
    ? button(sum.wandering ? (sum.wandering.mode === 'path' ? 'Keep going on the path' : 'Keep wandering') : 'Go to the Dye Garden', { block: true, attrs: { 'data-action': 'open-garden', 'data-coach': 'map-garden' } })
    : h`<div class="pz-tiertag">${unlockTag(ctx, 'garden', { cls: 'pz-tag' })}</div>`;
  return h`<div class="card gd-card" id="mp-garden">
<div class="gd-row"><span class="gd-ic">${raw(gardenIcon(30))}</span><div class="grow"><div class="h3">Dye Garden</div>
<div class="hint">${where}</div></div></div>
${sum.open ? h`<div class="hint">${lineFor(ctx, sum)}</div>` : ''}
${action}
</div>`;
}

/** A small signature of what the cards show (screens skip identical rebuilds). */
export function gardenCardSig(ctx, state) {
  if (!ctx || !ctx.sim || !ctx.sim.garden) return 0;
  const u = ctx.sim.unlocks.status(state, 'garden');
  return [u && u.revealed, u && u.affordable, u && u.open, JSON.stringify(ctx.sim.garden.summary(state))];
}
