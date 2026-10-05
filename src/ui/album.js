/**
 * album.js: the Postcard album (overlay `album`).
 *
 * Owns: set tabs (Meadow, Quarry, Coast, Jungle, Volcano, plus event sets that
 * have a card or are the current event), the 2x4 card grid, procedural
 * postcard illustrations (sky band, land shapes, accent stamp icon drawn from
 * `card.scene` / `card.stamp`), the CSS 3D flip with paper-tick and stamp sound,
 * duplicate badges, "new" tags, set completion bar and the completed-set wall
 * badge. Implements DESIGN.md "Hue Hunters and postcards > Postcards" and
 * "Interaction spec > Postcard opened" (flip 600 ms, stamp lands; reduced
 * motion = fade).
 *
 * Exports `postcardArt(card, {width})` for hunter.js and the Backpack.
 * Opens with params `{regionId}` or `{cardId}` (selects that set and highlights the card).
 * Cards still to find are quiet, unlabeled hue silhouettes; an empty album points to the Map.
 * data-actions: tab, flip, go-map.
 *
 * Feel (Theme F): cards lift on press; the postmark lands on the postage stamp through fx.stamp (with its thunk and
 * medium haptic) as the turn finishes; a new card slides into its slot (spring soft, once). The page re-keys after a
 * flip, and the no-op check ignores each picture's unique clip id, so a render never rebuilds under a turning card.
 */

import { h, raw, backButton, button, progressBar, fadeStrip, lockTag, iconSvg, safeHex, lighten, darken } from './kit.js';
import { FAMILY_HEX } from './map.js';
import { wireLift, springIn } from './feel.js';

const INK = '#2A2622';
const GOLD = '#C99A2E';
const GOLD_DEEP = '#8C6512';

const CSS = `
section[data-screen="album"] .screen-head .title { font-family:var(--font-ui); font-weight:600; }
.al-tabs { flex:0 0 auto; }
.al-tabs .chip { flex:0 0 auto; min-height:44px; }
.al-tabs .chip .sub { font-size:12px; }
.al-inline { display:inline-block; vertical-align:-3px; }
.al-h { font-family:var(--font-ui); font-weight:600; font-size:16px; line-height:1.25; }
.al-empty { align-items:center; text-align:center; gap:10px; }
.al-empty .tag { white-space:normal; }
.al-grid.is-quiet { grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
.al-grid.is-quiet .al-card { height:78px; }
.al-grid.is-quiet .al-sil { border-radius:10px; }
.al-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.al-card { position:relative; perspective:900px; height:182px; border-radius:12px; outline-offset:3px; }
.al-inner { position:relative; width:100%; height:100%; transform-style:preserve-3d; transition:transform 600ms var(--ease-in-out); }
.al-card.is-flipped .al-inner { transform:rotateY(180deg); }
.al-face { position:absolute; inset:0; display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:12px; background:var(--paper);
  box-shadow:var(--cut); overflow:hidden; backface-visibility:hidden; -webkit-backface-visibility:hidden; }
.al-card.is-rare .al-face { box-shadow:0 0 0 2.5px var(--gold), var(--cut); }
.al-back { transform:rotateY(180deg); justify-content:space-between; padding:10px 12px; }
.al-art { display:block; width:100%; height:auto; border-radius:6px; flex:0 0 auto; }
.al-title { font-family:var(--font-display); font-size:14px; line-height:1.2; padding:0 2px; }
.al-lines { display:block; font-size:12px; line-height:1.35; color:var(--ink); overflow:hidden; }
.al-lines p { margin:0 0 6px; }
.al-lines p + p { color:var(--ink-soft); }
.al-stamp { float:right; width:44px; margin:0 0 4px 8px; opacity:0; transform:scale(1.8) rotate(-12deg); }
.al-card.is-flipped .al-badge, .al-card.is-flipped .al-new { opacity:0; }
.al-card.is-flipped .al-stamp { animation:al-stamp 260ms var(--ease-out) 380ms both; }
.al-from { font-size:11px; color:var(--ink-soft); letter-spacing:.3px; text-transform:uppercase; font-weight:700; }
.al-from i { font-style:normal; color:var(--gold-deep); }
.al-badge { position:absolute; right:6px; top:6px; z-index:2; min-width:26px; padding:1px 7px; border-radius:999px; background:var(--ink); color:var(--paper);
  font-size:12px; font-weight:700; text-align:center; box-shadow:0 2px 0 rgba(0,0,0,.35); }
.al-new { position:absolute; left:6px; top:6px; z-index:2; padding:1px 8px; border-radius:4px 8px 8px 4px; background:var(--glow); color:var(--glow-ink);
  box-shadow:0 0 0 1.5px var(--glow-ring), 0 2px 0 var(--shadow); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; }
.al-lost { display:block; height:100%; border-radius:12px; background:rgba(247,244,236,.55); box-shadow:inset 0 0 0 2px rgba(42,38,34,.14); border:0; overflow:hidden; }
.al-sil { display:block; width:100%; height:100%; }
.al-card.is-rare .al-lost { box-shadow:inset 0 0 0 2.5px var(--gold); background:rgba(251,241,212,.5); }
.al-card.is-lost { perspective:none; }
.al-wall { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; background:#FBF1D4; box-shadow:inset 0 0 0 1.5px var(--gold); }
.al-hl .al-face { animation:al-flash 1.4s ease-out 1; }
.al-card[data-rm] { perspective:none; }
.al-card[data-rm] .al-inner { transform:none !important; transition:none; }
.al-card[data-rm] .al-face { backface-visibility:visible; -webkit-backface-visibility:visible; transition:opacity 120ms ease-out; }
.al-card[data-rm] .al-back { transform:none; opacity:0; pointer-events:none; }
.al-card[data-rm].is-flipped .al-back { opacity:1; pointer-events:auto; }
.al-card[data-rm].is-flipped .al-front { opacity:0; }
@keyframes al-stamp { from { opacity:0; transform:scale(1.8) rotate(-12deg); } 70% { opacity:1; transform:scale(.96) rotate(-4deg); } to { opacity:1; transform:scale(1) rotate(-4deg); } }
@keyframes al-flash { 0% { box-shadow:0 0 0 4px var(--glow-ring), var(--cut); } 100% { box-shadow:var(--cut); } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('al-style')) return;
  const s = document.createElement('style');
  s.id = 'al-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
injectStyle();

// ---------------------------------------------------------------------------
// Procedural postcard art
// ---------------------------------------------------------------------------

// Stamp motifs, drawn in a 24x24 box and filled with the card's accent color.
const STAMP_ICONS = {
  leaf: '<path d="M5 19 C4 10 10 4 20 4 C20 14 14 20 5 19Z"/><path d="M5 19 L14 10" fill="none" stroke="#F7F4EC" stroke-width="1.4"/>',
  wave: '<path d="M2 9 C5 5 8 12 12 8 C16 4 19 11 22 7 V13 C19 17 16 10 12 14 C8 18 5 11 2 15Z"/><path d="M2 19 C5 16 8 21 12 18 C16 15 19 20 22 17 V21 H2Z"/>',
  mountain: '<path d="M1 20 L9 6 L13 13 L16 9 L23 20Z"/><path d="M9 6 L11 10 L9 9 L7 10Z" fill="#F7F4EC"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M5 19 L7 17 M17 7 L19 5" fill="none" stroke-width="2" stroke-linecap="round"/>',
  moon: '<path d="M16 3 C9 3 5 9 5 14 C5 19 9 22 14 22 C9 19 9 8 16 3Z"/><circle cx="19" cy="7" r="1.6"/>',
  star: '<path d="M12 2 L14.8 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.2 8.6Z"/>',
  flower: '<g><circle cx="12" cy="6" r="4"/><circle cx="18" cy="12" r="4"/><circle cx="12" cy="18" r="4"/><circle cx="6" cy="12" r="4"/></g><circle cx="12" cy="12" r="3.2" fill="#F7F4EC"/>',
  feather: '<path d="M20 3 C10 3 5 10 5 17 L4 21 L7 19 C14 19 20 13 20 3Z"/><path d="M5 20 L15 9" fill="none" stroke="#F7F4EC" stroke-width="1.4"/>',
};

function stampIcon(stamp, accent, size) {
  const body = STAMP_ICONS[stamp] || STAMP_ICONS.star;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${accent}" stroke="${accent}" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const FAR = [
  'M0 62 C20 48 36 52 56 60 C80 44 104 46 128 58 C140 52 152 54 160 58 V130 H0Z',
  'M0 56 C26 62 40 44 66 50 C92 56 112 40 136 46 C146 48 154 52 160 50 V130 H0Z',
  'M0 64 L22 46 L40 58 L64 40 L88 60 L112 46 L136 58 L160 44 V130 H0Z',
  'M0 58 C30 46 50 66 80 54 C104 44 130 62 160 52 V130 H0Z',
];
const NEAR = [
  'M0 80 C30 66 56 72 84 80 C112 88 138 70 160 76 V130 H0Z',
  'M0 74 C24 84 54 86 80 76 C108 66 136 78 160 70 V130 H0Z',
  'M0 84 C28 72 60 70 90 78 C116 84 140 82 160 74 V130 H0Z',
  'M0 70 C34 80 62 66 96 74 C124 80 144 88 160 80 V130 H0Z',
];

/** Darken an accent that is too pale to read on the stamp's paper. */
function legible(hex) {
  const c = safeHex(hex).slice(1);
  const f = (i) => { const v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
  return L > 0.35 ? darken(hex, Math.min(0.55, (L - 0.2) * 1.1)) : hex;
}

let artSeq = 0;

/**
 * postcardArt(card, {width}) -> SVG (Safe): a papercut postcard picture. Three flat colors from
 * `card.scene` ({sky, land, accent}) make a sky band, two layers of land and a postage stamp
 * in the corner showing `card.stamp`. Rare (gold-stamped) cards get a gold edge and stamp.
 */
export function postcardArt(card, { width = 160 } = {}) {
  const sc = card.scene || {};
  const sky = safeHex(sc.sky, '#DCE8EE');
  const land = safeHex(sc.land, '#8FAA6A');
  const accent = legible(safeHex(sc.accent, '#B8433A'));
  const n = Math.max(1, card.n || 1);
  const v = (n - 1) % 4;
  const w = Number(width) || 160;
  const hgt = Math.round((w * 130) / 160);
  const id = `alc${++artSeq}`;
  const rare = !!card.rare;
  const cloud = `<path d="M${14 + v * 6} 24 C${14 + v * 6} 17 ${24 + v * 6} 16 ${27 + v * 6} 20 C${31 + v * 6} 15 ${42 + v * 6} 17 ${42 + v * 6} 24Z" fill="#fff" opacity=".45"/>`;
  const sunDisc = card.stamp === 'sun' || card.stamp === 'moon' ? '' : `<circle cx="${40 + ((n * 23) % 50)}" cy="${26 + (n % 3) * 4}" r="9" fill="#fff" opacity=".35"/>`;
  return raw(`<svg class="al-art" width="${w}" height="${hgt}" viewBox="0 0 160 130" role="img" aria-label="${(card.title || 'Postcard').replace(/"/g, '')}">
<defs><clipPath id="${id}"><rect width="160" height="130" rx="6"/></clipPath></defs>
<g clip-path="url(#${id})">
  <rect width="160" height="130" fill="${sky}"/>
  <rect y="34" width="160" height="30" fill="${lighten(sky, 0.35)}" opacity=".55"/>
  ${sunDisc}${cloud}
  <path d="${FAR[v]}" fill="${darken(land, 0.16)}"/>
  <path d="${NEAR[(v + 1) % 4]}" fill="${land}"/>
  <path d="M0 98 H160 V130 H0Z" fill="${darken(land, 0.1)}" opacity=".6"/>
  <g>
    <rect x="116" y="8" width="36" height="42" rx="2" fill="#F7F4EC" stroke="${rare ? GOLD : '#fff'}" stroke-width="${rare ? 2.2 : 1.2}" stroke-dasharray="${rare ? '0' : '3 2'}"/>
    <rect x="120" y="12" width="28" height="34" rx="1" fill="${lighten(accent, 0.8)}"/>
    <g transform="translate(124 18)">${stampIcon(card.stamp, accent, 20)}</g>
    <path d="M122 41 H146" stroke="${accent}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>
  </g>
  ${rare ? `<path d="M14 100 l2.2 4.6 l5 .6 l-3.7 3.5 l1 5 l-4.5 -2.5 l-4.5 2.5 l1 -5 l-3.7 -3.5 l5 -.6z" fill="${GOLD}" stroke="${GOLD_DEEP}" stroke-width=".8"/>` : ''}
</g>
<rect x=".5" y=".5" width="159" height="129" rx="6" fill="none" stroke="${INK}" stroke-opacity=".35"/>
</svg>`);
}

/** A small stamp sized for the card back, in the card's accent. */
function backStamp(card) {
  const accent = legible(safeHex(card.scene && card.scene.accent, '#B8433A'));
  const rare = !!card.rare;
  return raw(`<svg width="44" height="52" viewBox="0 0 44 52" aria-hidden="true"><rect x="2" y="2" width="40" height="48" rx="2" fill="#F7F4EC" stroke="${rare ? GOLD : accent}" stroke-width="${rare ? 3 : 2}" stroke-dasharray="${rare ? '0' : '4 2.5'}"/>
<rect x="7" y="7" width="30" height="38" rx="1" fill="${lighten(accent, 0.72)}"/><g transform="translate(10 13)">${stampIcon(card.stamp, accent, 24)}</g>
<path d="M10 41 H34" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></svg>`);
}

/** The wall-display badge for a finished set: a tiny framed picture on a hook. */
function wallBadge() {
  return raw(`<svg width="38" height="34" viewBox="0 0 38 34" aria-hidden="true"><path d="M19 2 L10 10 M19 2 L28 10" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
<circle cx="19" cy="2.5" r="2" fill="${GOLD}"/><rect x="4" y="9" width="30" height="22" rx="2" fill="#7B5236" stroke="${INK}" stroke-width="1.5"/>
<rect x="8" y="13" width="22" height="14" fill="#CFE0E6"/><path d="M8 24 C13 18 18 24 22 20 C25 17 28 20 30 19 V27 H8Z" fill="#86AE5A"/><circle cx="25" cy="17" r="2.2" fill="#E8C778"/></svg>`);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let bodyEl = null;
let visible = false;
let lastKey = '';
let tabId = null;
let highlightId = null;
const flipped = new Set();
const seenNew = new Set();
const slid = new Set();   // new cards that have slid into their slot

const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;
const ownedCount = (state, id) => (state.album && state.album.cards[id] ? state.album.cards[id].count : 0);

/** The sets the album shows: five region sets, then event sets with a card or the running event. */
function setList(state) {
  const C = ctx.content;
  const out = ['meadow', 'quarry', 'coast', 'jungle', 'volcano'].map((id) => ({ id, region: C.getRegion(id), event: null }));
  const current = state.event && state.event.region;
  for (const ev of C.EVENTS) {
    const region = C.getRegion(ev.region);
    if (!region) continue;
    const cards = C.cardsForRegion(region.id);
    const any = cards.some((c) => ownedCount(state, c.id) > 0);
    if (any || region.id === current) out.push({ id: region.id, region, event: ev });
  }
  return out;
}

/** "in the Meadow", "on the Coast": where a set's cards are found. */
const ON_THE = new Set(['coast', 'glacier', 'reef', 'hilltop', 'glacier-pass']);
const AT_THE = new Set(['lantern-bridge', 'night-market']);
function whereLine(region) {
  const prep = ON_THE.has(region.id) ? 'on' : AT_THE.has(region.id) ? 'at' : 'in';
  return `${prep} the ${region.name}`;
}

/** A card still to find: a soft, unlabeled silhouette in the card's own hues (a postage-stamp outline, no text). */
function silhouette(card) {
  const sc = card.scene || {};
  const sky = lighten(safeHex(sc.sky, '#DCE8EE'), 0.45);
  const land = lighten(safeHex(sc.land, '#8FAA6A'), 0.45);
  const v = (Math.max(1, card.n || 1) - 1) % 4;
  const rare = !!card.rare;
  return raw(`<svg class="al-sil" viewBox="0 0 160 130" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${rare ? 'A gold-stamped card to find' : 'A card to find'}">
<rect width="160" height="130" fill="${sky}" opacity=".75"/>
<path d="${FAR[v]}" fill="${darken(land, 0.06)}" opacity=".7"/>
<path d="${NEAR[(v + 1) % 4]}" fill="${land}" opacity=".85"/>
<rect x="118" y="10" width="32" height="38" rx="2" fill="#F7F4EC" fill-opacity=".7" stroke="${rare ? GOLD : INK}" stroke-opacity="${rare ? '.8' : '.25'}" stroke-width="${rare ? 2.4 : 1.6}" stroke-dasharray="${rare ? '0' : '3 2.5'}"/>
</svg>`);
}

function cardHtml(state, card, sessionStart) {
  const rec = state.album && state.album.cards[card.id];
  const count = rec ? rec.count : 0;
  const rare = !!card.rare;
  const hl = highlightId === card.id ? ' al-hl' : '';
  if (count <= 0) {
    return h`<div class="al-card is-lost ${rare ? 'is-rare' : ''}"><div class="al-lost">${silhouette(card)}</div></div>`;
  }
  const isNew = rec.at >= sessionStart && !seenNew.has(card.id);
  const rm = ctx.fx.isReducedMotion();
  return h`<div class="al-card is-owned ${rare ? 'is-rare' : ''} ${flipped.has(card.id) ? 'is-flipped' : ''}${hl}" role="button" tabindex="0" data-action="flip" data-card-id="${card.id}" data-tap ${rm ? raw('data-rm') : ''}
      aria-label="${card.title}. Tap to ${flipped.has(card.id) ? 'turn it back' : 'read it'}">
    ${isNew ? h`<span class="al-new">new</span>` : ''}${count > 1 ? h`<span class="al-badge" aria-label="${count} copies">×${count}</span>` : ''}
    <div class="al-inner">
      <div class="al-face al-front">${postcardArt(card, { width: 158 })}<div class="al-title">${card.title}</div></div>
      <div class="al-face al-back">
        <div class="al-lines"><span class="al-stamp">${backStamp(card)}</span><p>${card.lines[0]}</p><p>${card.lines[1]}</p></div>
        <div class="al-from">${rare ? h`<i>Gold stamp</i> · ` : ''}${ctx.content.getRegion(card.region).name} · ${card.n} of ${ctx.content.cardsForRegion(card.region).length}</div>
      </div>
    </div></div>`;
}

function totalOwned(state) {
  return Object.values((state && state.album && state.album.cards) || {}).filter((x) => x.count > 0).length;
}

/** "Hunters open with the map window for 2.5K" (+ "3 more colors" until the price is revealed). */
function huntersGoal(state) {
  const u = ctx.sim.unlocks.status(state, 'hunters');
  if (!u) return 'Hunters open with the map window';
  const base = `Hunters open with the map window for ${ctx.format.num(u.cost)}`;
  if (u.colorsLeft > 0) return `${base}: ${u.colorsLeft} more ${u.colorsLeft === 1 ? 'color' : 'colors'}`;
  return base;
}

function emptyAlbumHtml(state) {
  const on = ctx.sim.hunters.unlocked(state);
  return h`<div class="card al-empty" data-empty>
    <div class="al-h">Hunters bring postcards home</div>
    <div class="hint">${on ? 'Send one from the Map, and the first card lands here.' : 'Your first hunters set out from the map window, and every trip can bring a card home.'}</div>
    ${on ? button('Go to the Map', { variant: 'primary', attrs: { 'data-action': 'go-map' } }) : lockTag(huntersGoal(state))}
  </div>`;
}

function build(state) {
  const C = ctx.content;
  const sets = setList(state);
  if (!sets.some((s) => s.id === tabId)) tabId = sets[0].id;
  const cur = sets.find((s) => s.id === tabId);
  const cards = C.cardsForRegion(cur.id);
  const owned = cards.filter((c) => ownedCount(state, c.id) > 0).length;
  const left = cards.length - owned;
  const done = cards.length > 0 && left === 0;
  const sessionStart = (state.stats && state.stats.sessionStartedAt) ?? ctx.game.now() - 3600e3;
  const bonus = Math.round(ctx.sim.SET_HAUL_BONUS * 100);
  const noHunters = !ctx.sim.hunters.unlocked(state);
  const extras = cards.reduce((n, c) => n + Math.max(0, ownedCount(state, c.id) - 1), 0);
  const empty = totalOwned(state) === 0;
  const quiet = owned === 0;

  return h`${empty ? emptyAlbumHtml(state) : ''}
    ${fadeStrip(sets.map((s) => {
      const cs = C.cardsForRegion(s.id);
      const o = cs.filter((c) => ownedCount(state, c.id) > 0).length;
      return h`<button type="button" class="chip" data-action="tab" data-set-id="${s.id}" aria-pressed="${String(s.id === tabId)}" data-tap>${s.region.name}${s.event ? h` <span class="sub">event</span>` : ''}${o > 0 ? h` <span class="sub">${o}/${cs.length}</span>` : ''}</button>`;
    }), { cls: 'al-tabs', label: 'Postcard sets' })}
    <div class="card">
      <div class="row between"><div><div class="h2">${cur.region.name}</div>
        ${cur.event ? h`<div class="hint">${cur.event.name} set</div>` : ''}</div>
        ${done ? h`<span class="chip is-on">Set complete</span>` : ''}</div>
      ${quiet ? '' : progressBar(cards.length ? owned / cards.length : 0, { label: `${cur.region.name} set` })}
      ${done
        ? h`<div class="al-wall">${wallBadge()}<div><div class="semi small">On your workshop wall</div><div class="hint">+${bonus}% haul in the ${cur.region.name}, for good.</div></div></div>`
        : quiet
          ? h`<div class="hint">${plural(left, 'card')} to find ${whereLine(cur.region)}.${noHunters ? ' Postcards arrive with your hunters.' : ''}</div>`
          : h`<div class="hint">${plural(left, 'more card')} to finish this set: +${bonus}% haul in the ${cur.region.name} and a spot on the workshop wall.</div>`}
    </div>
    <div class="al-grid ${quiet ? 'is-quiet' : ''}">${cards.map((c) => cardHtml(state, c, sessionStart))}</div>
    <div class="hint center">${extras > 0 ? h`Extra copies turn into ${ctx.sim.DUPLICATE_SEALS} ${iconSvg('seal', { size: 14, cls: 'al-inline' })} Seals each, so nothing is wasted.` : 'Longer trips find more cards, and gold-stamped ones come from long trips.'}</div>`;
}

function paint(state, force = false) {
  if (!bodyEl) return;
  state = state || ctx.game.state;
  const html = String(build(state));
  const key = html.replace(/alc\d+/g, 'alc'); // each picture draws with a fresh clip id: compare without it, or every render rebuilds
  if (!force && key === lastKey) return;
  lastKey = key;
  const keep = bodyEl.scrollTop;
  bodyEl.innerHTML = html;
  bodyEl.scrollTop = keep;
  const active = bodyEl.querySelector('.al-tabs .chip[aria-pressed="true"]');
  if (active && typeof active.scrollIntoView === 'function' && force) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  slideInNew();
}

/** A new card slides into its slot (spring soft, 70 ms apart), once. */
function slideInNew() {
  if (!visible || !bodyEl) return;
  let k = 0;
  bodyEl.querySelectorAll('.al-card.is-owned').forEach((el) => {
    const id = el.getAttribute('data-card-id');
    if (!el.querySelector('.al-new') || slid.has(id)) return;
    slid.add(id);
    springIn(el, ctx.fx, { dy: -30, scale: 0.9, preset: 'soft', delay: k * 70 });
    k++;
  });
  if (k) ctx.audio.tick('select');
}

/** Where the postmark lands: over the postage stamp, in the top right of the card's back. */
function postmark(cardEl, card) {
  const el = (bodyEl && bodyEl.querySelector(`.al-card[data-card-id="${card.id}"]`)) || cardEl;
  const r = el.getBoundingClientRect();
  const at = { getBoundingClientRect: () => ({ left: r.right - 86, top: r.top + 46, width: 0, height: 0 }) };
  const region = ctx.content.getRegion(card.region);
  const word = card.rare ? 'Gold' : String((region && region.name) || 'Posted').split(' ')[0].slice(0, 9);
  ctx.fx.stamp(at, word, { hold: 600, hex: card.rare ? '#8C6512' : null });
}

function flip(el) {
  const id = el.getAttribute('data-card-id');
  const card = ctx.content.getPostcard(id);
  if (!card) return;
  const rm = ctx.fx.isReducedMotion();
  if (rm) el.setAttribute('data-rm', ''); else el.removeAttribute('data-rm');
  const to = !el.classList.contains('is-flipped');
  el.classList.toggle('is-flipped', to);
  el.setAttribute('aria-label', `${card.title}. Tap to ${to ? 'turn it back' : 'read it'}`);
  if (to) flipped.add(id); else flipped.delete(id);
  setTimeout(() => ctx.audio.tick('select'), 90);
  // The postmark lands as the card finishes turning (it contacts 165 ms into the stamp, the flip ends at 600):
  // fx.stamp brings the thunk and the medium touch itself.
  if (to) setTimeout(() => { if (el.classList.contains('is-flipped')) postmark(el, card); }, rm ? 120 : 400);
  const tagEl = el.querySelector('.al-new');
  if (tagEl) { seenNew.add(id); tagEl.remove(); }
  el.classList.remove('al-hl');
  if (highlightId === id) highlightId = null;
  // The DOM already shows this change. Re-key, or the next render sees different markup (flipped, no "new" tag),
  // rebuilds the page, and cuts the turn and the stamp off mid-air.
  lastKey = String(build(ctx.game.state)).replace(/alc\d+/g, 'alc');
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.getAttribute('data-action');
  if (a === 'tab') { tabId = el.getAttribute('data-set-id'); paint(ctx.game.state, true); bodyEl.scrollTop = 0; }
  else if (a === 'flip') flip(el);
  else if (a === 'go-map') ctx.navigate('map');
}

const screen = {
  id: 'album',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    injectStyle();
    root.innerHTML = String(h`<div class="screen-head">${backButton('Back to the map')}
      <div class="titles"><div class="title">Postcard album</div><div class="subtitle"></div></div><span class="spacer"></span></div>
      <div class="screen-body" data-album-body></div>`);
    bodyEl = root.querySelector('[data-album-body]');
    root.addEventListener('click', onClick);
    wireLift(bodyEl, '.al-card.is-owned', ctx.fx); // cards lift under her finger; the flip does the rest
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
    });
  },

  show(params = {}) {
    visible = true;
    const state = ctx.game.state;
    const C = ctx.content;
    let want = params.regionId || null;
    if (params.cardId) {
      const c = C.getPostcard(params.cardId);
      if (c) { want = c.region; highlightId = c.id; }
    }
    if (want) tabId = want;
    else if (!tabId) {
      const sets = setList(state);
      const unfinished = sets.find((s) => { const cs = C.cardsForRegion(s.id); const o = cs.filter((c) => ownedCount(state, c.id) > 0).length; return o > 0 && o < cs.length; });
      tabId = (unfinished || sets[0]).id;
    }
    paint(state, true);
    const sub = root.querySelector('.screen-head .subtitle');
    if (sub) {
      const total = totalOwned(state);
      sub.textContent = total > 0 ? `${plural(total, 'card')} collected` : 'Your collection starts here';
    }
    if (highlightId) {
      requestAnimationFrame(() => {
        const el = root.querySelector(`[data-card-id="${highlightId}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
      });
    }
  },

  hide() { visible = false; },

  render(state) {
    if (!visible) return;
    paint(state);
    const sub = root.querySelector('.screen-head .subtitle');
    if (sub) {
      const total = totalOwned(state || ctx.game.state);
      sub.textContent = total > 0 ? `${plural(total, 'card')} collected` : 'Your collection starts here';
    }
  },
};

export default screen;
