/**
 * phase-beat.js: screen `phase-beat`, the short illustrated beat for phase
 * changes, room openings, catalog milestones and Renovate.
 * Implements DESIGN.md "Phases within an era" ("Phase changes are Paperclips
 * moments: a short illustrated beat, a new room opens, the HUD gains a panel")
 * and "Catalog milestones" (+2% income every 10 colors).
 *
 * show(params):
 *   {kind:'phase', phase}                 phase 2 / 3 beats
 *   {kind:'room', id}                     a room purchase
 *   {kind:'milestone', colors}            every 10 catalog colors
 *   {kind:'renovate', heritage}           Renovate summary
 *   {title, lines:[a, b], art}            anything else (custom beat)
 * A papercut room silhouette, a title, two lines and Continue. Skippable: tap
 * anywhere on the backdrop or Continue. Continue pops the screen (ctx.back);
 * the app queues further ceremonies after it. A request that says nothing
 * (no kind, no title) is never shown: the screen closes itself at once.
 *
 * Voice (the first-session story): warm, specific, second person, present
 * tense, the way the map says "The window opens soon".
 */

import { h, raw, button } from './kit.js';
import { injectStyle } from './overlay.js';

injectStyle('phase-beat-style', `
.screen[data-screen="phase-beat"] { background: rgba(42,38,34,.35); align-items: center; justify-content: center; padding: 16px; }
.beat-card { width: 100%; max-width: 380px; background: var(--paper); border-radius: 18px; box-shadow: 0 4px 0 var(--shadow); padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 12px; text-align: center; animation: pop-in 240ms var(--ease-out) both; }
.beat-art { border-radius: 12px; overflow: hidden; background: var(--plaster); }
.beat-art svg { display: block; width: 100%; height: auto; }
.beat-kicker { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; }
.beat-title { font-family: var(--font-display); font-size: 24px; line-height: 1.15; }
.beat-lines { color: var(--ink-soft); font-size: 15px; line-height: 1.4; display: flex; flex-direction: column; gap: 4px; }
html[data-motion="reduced"] .beat-card { animation: fade-in 120ms ease-out both; }
`);

let root = null;
let ctx = null;
let currentBeat = null;

const ROOM_ADDS = {
  grinderSlots: ['grinder', 'grinders'],
  mixerSlots: ['mixer', 'mixers'],
  vatSlots: ['vat', 'vats'],
  fleetSlots: ['cart', 'carts'],
  walls: ['gallery wall', 'gallery walls'],
};
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n, one, many) => `${WORDS[n] || n} more ${n === 1 ? one : many}`;

/** "There is room for one more grinder and one more mixer." */
export function roomLines(room) {
  const adds = (room && room.adds) || {};
  const bits = [];
  for (const [k, [one, many]] of Object.entries(ROOM_ADDS)) {
    const n = Number(adds[k]) || 0;
    if (n > 0) bits.push(count(n, one, many));
  }
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
  const cellar = Number(adds.cellarMult) > 1 ? `Your cellar holds ${adds.cellarMult} times as much.` : '';
  if (!list) return cellar || 'More room for you to work.';
  return `There is room for ${list}.${cellar ? ` ${cellar}` : ''}`;
}

const ROOM_SECOND = {
  'mill-room': 'A second grinder keeps your mixers fed, so the vats fill faster.',
  'mixing-hall': 'More mixers means more colors filling your vats at once.',
  'gallery-wing': 'Paint with every color you make, and hang it for Harbor Town to see.',
  cellar: 'Your vats can fill all night while you are away.',
  'loading-yard': 'Your carts carry color down the routes, and commissions come calling.',
  'long-hall': 'More walls, more visitors, more of your work on show.',
  atelier: 'A bright room for your finest mixing.',
  rotunda: 'The grandest walls in town, and every one of them is yours to fill.',
};

/** Build {kicker, title, lines, art, hex} for a beat request. */
export function beatFor(params = {}, content = {}) {
  const p = params || {};
  if (p.kind === 'phase') {
    if (Number(p.phase) === 2) {
      return { kicker: 'A new chapter', title: 'Your business outgrows the bench', art: 'factory',
        lines: ['Carts, routes and apprentices are ready to help you.', 'Your hunters can set out, and the Gallery door opens soon.'] };
    }
    if (Number(p.phase) === 3) {
      return { kicker: 'A new chapter', title: 'Commissions come calling', art: 'atelier',
        lines: ['Harbor Town brings you big projects that ask for many colors at once.', 'Renovate is open too, whenever you want a fresh start with Heritage.'] };
    }
    return { kicker: 'A new chapter', title: 'Your workshop grows', art: 'bench', lines: ['New work is waiting for you.'] };
  }
  if (p.kind === 'room') {
    const room = (content.getRoom && content.getRoom(p.id)) || (content.ROOMS || []).find((r) => r.id === p.id) || { name: 'A new room' };
    return { kicker: 'A new room', title: `The ${room.name.replace(/^The /, '')} opens`, art: p.id === 'gallery-wing' || p.id === 'long-hall' || p.id === 'rotunda' ? 'gallery' : 'room',
      lines: [roomLines(room), ROOM_SECOND[p.id] || 'Fresh space for your next idea.'] };
  }
  if (p.kind === 'milestone') {
    const n = Number(p.colors) || 10;
    return { kicker: 'Catalog milestone', title: `${n} colors in your catalog`, art: 'catalog',
      lines: ['Your income grows by 2%, for good.', 'Every 10 colors you find adds another 2%.'] };
  }
  if (p.kind === 'renovate') {
    const hgt = Number(p.heritage) || 0;
    return { kicker: 'Renovated', title: 'A fresh coat of paint', art: 'bench',
      lines: [hgt > 0 ? `+${hgt} Heritage: every coin you earn counts for more.` : 'A clean start, with everything you love kept.',
        'Your catalog, hunters, postcards and Gallery stay with you.'] };
  }
  const lines = (p.lines || []).filter(Boolean).slice(0, 2);
  if (!p.title) return null; // nothing to say: never show a bare "Something new"
  return { kicker: p.kicker || '', title: p.title, art: p.art || 'room', lines };
}

/** Papercut room silhouette: walls, floor, window, and a few props per kind. */
function artSvg(kind, hex) {
  const accent = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#C99A2E';
  const props = {
    bench: '<rect x="70" y="92" width="120" height="10" rx="2" fill="#7B5236"/><rect x="80" y="102" width="8" height="26" fill="#5E3E28"/><rect x="172" y="102" width="8" height="26" fill="#5E3E28"/><rect x="96" y="74" width="16" height="18" rx="4" fill="#B8433A"/><rect x="120" y="70" width="16" height="22" rx="4" fill="#D39B2A"/><rect x="144" y="76" width="16" height="16" rx="4" fill="#3E6A9E"/>',
    factory: '<rect x="40" y="70" width="44" height="58" rx="10" fill="#F2F4F0" stroke="#2A2622" stroke-width="2.5"/><rect x="40" y="96" width="44" height="32" rx="8" fill="#B8433A"/><rect x="104" y="70" width="44" height="58" rx="10" fill="#F2F4F0" stroke="#2A2622" stroke-width="2.5"/><rect x="104" y="90" width="44" height="38" rx="8" fill="#D39B2A"/><rect x="168" y="92" width="62" height="26" rx="4" fill="#7B5236"/><circle cx="182" cy="122" r="8" fill="#2A2622"/><circle cx="216" cy="122" r="8" fill="#2A2622"/>',
    atelier: '<rect x="64" y="52" width="70" height="60" rx="4" fill="#F7F4EC" stroke="#7B5236" stroke-width="5"/><path d="M70 104 L92 74 L108 92 L118 82 L130 104 Z" fill="' + accent + '"/><path d="M150 128 L170 56 L190 128" fill="none" stroke="#5E3E28" stroke-width="5"/><rect x="200" y="96" width="24" height="32" rx="6" fill="#3E6A9E"/>',
    gallery: '<rect x="36" y="56" width="50" height="40" rx="3" fill="#F7F4EC" stroke="#7B5236" stroke-width="4"/><rect x="42" y="62" width="38" height="28" fill="#3E6A9E"/><rect x="104" y="48" width="56" height="52" rx="3" fill="#F7F4EC" stroke="#7B5236" stroke-width="4"/><rect x="110" y="54" width="44" height="40" fill="' + accent + '"/><rect x="178" y="56" width="50" height="40" rx="3" fill="#F7F4EC" stroke="#7B5236" stroke-width="4"/><rect x="184" y="62" width="38" height="28" fill="#B8433A"/>',
    catalog: '<rect x="66" y="40" width="128" height="88" rx="6" fill="#F7F4EC" stroke="#2A2622" stroke-width="2.5"/><path d="M130 40 V128" stroke="#2A2622" stroke-width="2"/>' +
      [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${78 + (i % 2) * 22}" y="${52 + Math.floor(i / 2) * 24}" width="16" height="16" rx="3" fill="${['#B8433A', '#D39B2A', '#3E6A9E', '#c56731', '#cc7f2e', accent][i]}"/>`).join('') +
      [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${142 + (i % 2) * 22}" y="${52 + Math.floor(i / 2) * 24}" width="16" height="16" rx="3" fill="#D3D8D0"/>`).join(''),
    room: '<rect x="56" y="64" width="40" height="64" rx="4" fill="#7B5236"/><circle cx="88" cy="98" r="3" fill="#E2B04A"/><rect x="128" y="88" width="90" height="10" rx="2" fill="#7B5236"/><rect x="136" y="98" width="8" height="30" fill="#5E3E28"/><rect x="202" y="98" width="8" height="30" fill="#5E3E28"/><rect x="150" y="68" width="18" height="20" rx="4" fill="' + accent + '"/>',
  };
  return raw(`<svg viewBox="0 0 260 150" role="img" aria-hidden="true">
<rect width="260" height="150" fill="#E3E6E0"/>
<path d="M0 128 H260 V150 H0 Z" fill="#D3D8D0"/>
<path d="M0 28 L130 6 L260 28 V34 H0 Z" fill="#B7BDB3"/>
<rect x="186" y="40" width="46" height="38" rx="4" fill="#FFF6DF" stroke="#7B5236" stroke-width="4"/>
<path d="M209 40 V78 M186 59 H232" stroke="#7B5236" stroke-width="3"/>
${props[kind] || props.room}
<path d="M0 128 H260" stroke="rgba(42,38,34,.25)" stroke-width="3"/>
</svg>`);
}

function draw() {
  if (!root || !currentBeat) return;
  const b = currentBeat;
  root.innerHTML = String(h`<div class="beat-card" role="dialog" aria-modal="true" aria-labelledby="beat-title">
    <div class="beat-art">${artSvg(b.art, b.hex)}</div>
    ${b.kicker ? h`<div class="beat-kicker">${b.kicker}</div>` : ''}
    <div class="beat-title" id="beat-title">${b.title}</div>
    <div class="beat-lines">${(b.lines || []).filter(Boolean).map((l) => h`<div>${l}</div>`)}</div>
    ${button('Continue', { variant: 'primary', block: true, attrs: { 'data-action': 'beat-continue' } })}
  </div>`);
  const btn = root.querySelector('[data-action="beat-continue"]');
  if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

function done() {
  currentBeat = null;
  if (ctx && ctx.back) ctx.back();
}

const screen = {
  id: 'phase-beat',
  transparent: true,
  fullscreen: true,
  enter: 'fade',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="beat-continue"]') || e.target === root) done();
    });
  },

  show(params = {}) {
    const beat = beatFor(params, (ctx && ctx.content) || {});
    if (!beat) { currentBeat = null; if (ctx && ctx.back) setTimeout(() => ctx.back(), 0); return; }
    currentBeat = { ...beat, hex: params.hex };
    draw();
    if (ctx) {
      try { ctx.audio.chord([0.45, 0.6, 0.75], 0.6); } catch (e) { /* ignore */ }
      try { ctx.haptics.success(); } catch (e) { /* ignore */ }
    }
  },

  hide() {
    currentBeat = null;
  },

  render() {},
};

export default screen;
