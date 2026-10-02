/**
 * map.js: the Map tab (tab screen `map`).
 *
 * Owns: the illustrated papercut map (inline SVG with tappable region pins),
 * the Backpack card of recent returns, the hunter roster, the hire cards, the
 * Send sheet and the scouting-choice sheet. Implements DESIGN.md "Hue Hunters
 * and postcards" (team, regions, expeditions, scouting, pity timer),
 * "Interaction spec" (Hunter returns: a tiny knock on the map window, the
 * backpack drops) and "Art direction" (papercut; locked things stay visible
 * with a paper tag in positive framing).
 *
 * Shared with hunter.js (it imports these): `openSendSheet`, `openChoiceSheet`,
 * `hunterPortrait`, `haulChips`, `TRAIT_HEX`, `FAMILY_HEX`, `recentCardsFor`.
 *
 * Contract notes (docs/UI-CONTRACT.md): one delegated click listener on the
 * section, `data-action` attributes, every tappable carries `data-tap`.
 * data-actions on this screen: open-hunter, region, hire, answer-choice,
 * dismiss-backpack, send-again, open-card, open-album, open-quests.
 * The Send sheet lives in its own host appended to <body> (data-actions:
 * close-sheet, pick-region, pick-hunter, pick-duration, send-go), so it works
 * from any screen. `data-coach="map"` sits on the map window.
 */

import { h, raw, button, tag, lockTag, swatch, iconSvg, safeHex, lighten, darken } from './kit.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Muted trait colors for portraits (the UI never uses a saturated accent of its own). */
export const TRAIT_HEX = Object.freeze({
  botanist: '#7FA05A', miner: '#C08F4E', diver: '#4E93A3', lucky: '#D9A441', trader: '#9A6A9C', scholar: '#5675A8',
});

/** Hue family -> a representative paper-friendly hex (for region palettes and pennants). */
export const FAMILY_HEX = Object.freeze({
  red: '#B8433A', orange: '#D9782B', yellow: '#DDAE2E', green: '#6BA05A', teal: '#3E9A9A',
  blue: '#3E6A9E', violet: '#7B5EA3', pink: '#D86A9A', neutral: '#8F8F86',
});

const INK = '#2A2622';
const SEEN_KEY = 'tincture.ui.backpackSeen';
const CARDS_KEY = 'tincture.ui.hunterCards';
const BACKPACK_WINDOW_MS = 48 * 3600e3;

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

let seq = 0;

// ---------------------------------------------------------------------------
// Styles (injected once; this module owns the .mp- prefix)
// ---------------------------------------------------------------------------

const CSS = `
.mp-portrait { display:block; flex:0 0 auto; }
.mp-portrait.is-dim { filter: grayscale(.85); opacity:.7; }
.mp-win { position:relative; padding:8px; border-radius:16px; background:var(--walnut); box-shadow:var(--cut); }
.mp-win.is-knock { animation: mp-knock 500ms var(--ease-out) both; transform-origin: 50% 100%; }
.mp-view { position:relative; border-radius:10px; overflow:hidden; aspect-ratio: 390 / 420; background:#D3E2E8;
  box-shadow: inset 0 0 0 2px rgba(42,38,34,.4); }
.mp-view.is-sleepy .mp-art { filter: saturate(.55) brightness(1.03); }
.mp-art { position:absolute; inset:0; width:100%; height:100%; }
.mp-banner { position:absolute; left:50%; bottom:-14px; transform:translateX(-50%); z-index:4; width:max-content; max-width:92%;
  padding:8px 16px 9px; border-radius:6px 12px 12px 6px; background:var(--paper); box-shadow:var(--cut), inset 0 0 0 1.5px rgba(42,38,34,.15);
  font-family:var(--font-ui); font-weight:600; font-size:16px; text-align:center; line-height:1.25; }
.mp-banner::before { content:''; position:absolute; left:8px; top:50%; width:6px; height:6px; margin-top:-3px; border-radius:50%; background:var(--plaster); box-shadow:inset 0 0 0 1px var(--plaster-line); }
.mp-win.is-sleepy { margin-bottom:18px; }
.mp-banner small { display:block; margin-top:2px; font-family:var(--font-ui); font-size:12px; color:var(--ink-soft); }
.mp-pin { position:absolute; z-index:2; display:flex; flex-direction:column; align-items:center; gap:3px;
  min-width:44px; transform:translate(-50%,-22px); padding:0; text-align:center; }
.mp-disc { position:relative; width:44px; height:44px; border-radius:50%; background:var(--paper); display:grid; place-items:center;
  box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 2px var(--ink); transition: transform 120ms var(--ease-out), box-shadow 120ms; }
.mp-pin:active .mp-disc { transform: translateY(2px); box-shadow: 0 1px 0 var(--shadow), inset 0 0 0 2px var(--ink); }
.mp-pin.is-locked .mp-disc { background:var(--plaster); color:var(--ink-soft); box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 2px var(--ink-soft); }
.mp-pin.is-event .mp-disc { background: transparent; box-shadow:none; }
.mp-name { padding:2px 8px; border-radius:6px; background:var(--paper); box-shadow:0 2px 0 var(--shadow);
  font-family:var(--font-display); font-size:12px; line-height:1.2; white-space:nowrap; }
.mp-pin .tag { font-size:10px; min-height:18px; padding:2px 7px 2px 14px; }
.mp-pin .tag::before { left:5px; width:4px; height:4px; margin-top:-2px; }
.mp-pin .tag svg { width:10px; height:10px; }
section[data-screen="map"] .screen-head .title { font-family:var(--font-ui); font-weight:600; }
.mp-h { font-family:var(--font-ui); font-weight:600; font-size:18px; line-height:1.2; }
.mp-hn { font-family:var(--font-display); font-weight:400; font-size:17px; line-height:1.25; }
.mp-headslot { flex:0 0 auto; display:flex; align-items:center; }
.mp-legend { gap:8px; }
.mp-legend-row { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:34px; }
.mp-legend-row .mp-rn { font-family:var(--font-display); font-size:16px; line-height:1.2; display:flex; align-items:center; gap:8px; min-width:0; }
.mp-legend-row .tag { flex:0 1 auto; white-space:normal; }
.mp-hire-foot { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.mp-hire .btn { flex:0 0 auto; }
.mp-back-actions { display:flex; justify-content:flex-end; }
.mp-badge { position:absolute; right:-5px; top:-5px; min-width:18px; height:18px; padding:0 4px; border-radius:9px;
  background:var(--ink); color:var(--paper); font-size:11px; font-weight:700; line-height:18px; text-align:center; }
.mp-section { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-top:6px; }
.mp-hunter { flex-direction:row; align-items:center; gap:12px; }
.mp-hunter .h3 { font-size:17px; }
.mp-fwd { transform:rotate(180deg); color:var(--ink-soft); }
.mp-lv { font-size:12px; font-weight:700; color:var(--ink-soft); }
.mp-chip { min-height:22px; padding:0 8px; font-size:11px; box-shadow:0 1px 0 var(--shadow-soft); }
.mp-status { font-size:13px; color:var(--ink-soft); }
.mp-status.is-radio { color:var(--glow-ink); font-weight:700; }
.mp-hire { flex-direction:row; align-items:center; gap:12px; }
.mp-cost { display:inline-flex; align-items:center; gap:5px; font-weight:700; }
.mp-backpack { background: var(--paper); }
.mp-backpack.is-drop { animation: mp-drop 500ms var(--ease-out) both; }
.mp-haul { display:flex; flex-direction:column; gap:6px; padding-top:8px; border-top:1px solid rgba(42,38,34,.1); }
.mp-haul:first-of-type { border-top:0; padding-top:0; }
.mp-haul-line { display:flex; flex-wrap:wrap; gap:6px; }
.mp-find { display:inline-flex; align-items:center; gap:5px; min-height:26px; padding:2px 9px 2px 5px; border-radius:999px;
  background:var(--plaster); font-size:11.5px; font-weight:600; }
.mp-find.is-new { background:var(--glow); box-shadow:inset 0 0 0 1.5px var(--glow-ring); }
.mp-find.is-gold { box-shadow:inset 0 0 0 1.5px var(--gold); background:#FBF1D4; }
button.mp-find { min-height:44px; padding:4px 12px 4px 8px; font-size:12px; }
.mp-find .icon { flex:0 0 auto; }
.mp-sheet-host { position:absolute; inset:0; z-index:55; display:flex; align-items:flex-end; justify-content:center;
  background:rgba(42,38,34,.45); animation: fade-in 160ms ease-out both; }
.mp-sheet { min-height:0; }
.mp-sheet .mp-x { position:absolute; right:12px; top:10px; }
.mp-sheet .chip { min-height:44px; }
.mp-sheet-title { font-family:var(--font-ui); font-weight:600; font-size:16px; line-height:1.15; color:var(--ink-soft); }
.mp-sheet-title .mp-rname { display:block; font-family:var(--font-display); font-weight:400; font-size:24px; color:var(--ink); }
.mp-label { font-size:12px; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--ink-soft); }
.mp-dur { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.mp-dur > button { display:flex; flex-direction:column; align-items:center; gap:2px; padding:10px 4px; min-height:92px;
  border-radius:12px; background:var(--paper); box-shadow:0 2px 0 var(--shadow-soft), inset 0 0 0 1.5px rgba(42,38,34,.15);
  font-size:12px; color:var(--ink-soft); }
.mp-dur > button b { font-family:var(--font-ui); font-weight:700; font-size:17px; color:var(--ink); }
.mp-dur > button[aria-pressed="true"] { background:var(--ink); color:var(--paper); box-shadow:0 2px 0 #000; }
.mp-dur > button[aria-pressed="true"] b { color:var(--paper); }
.mp-sil { display:inline-block; width:34px; height:34px; border-radius:10px; flex:0 0 auto;
  background:rgba(42,38,34,.1); box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.28); }
.mp-pal { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.mp-pal .mp-p { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; }
.mp-hl { animation: mp-flash 1.4s ease-out 1; }
@keyframes mp-knock { 0%,100% { transform:none; } 18% { transform:translateY(2px) rotate(-.6deg); } 36% { transform:none; }
  54% { transform:translateY(2px) rotate(.5deg); } 72% { transform:none; } }
@keyframes mp-drop { from { opacity:0; transform:translateY(-14px); } 60% { opacity:1; transform:translateY(2px); } to { transform:none; } }
@keyframes mp-flash { 0% { box-shadow:0 0 0 3px var(--glow-ring), var(--cut); } 100% { box-shadow:var(--cut); } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('mp-style')) return;
  const s = document.createElement('style');
  s.id = 'mp-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
injectStyle();

// ---------------------------------------------------------------------------
// Portraits: procedural papercut busts keyed by hunter id
// ---------------------------------------------------------------------------

const PORTRAITS = {
  wren: {
    skin: '#E8B896', hair: '#6B3E2A',
    back: () => '<path d="M31 40 C26 62 28 78 36 82 L64 82 C72 78 74 62 69 40 Z" fill="#6B3E2A"/>',
    front: (c) => `<path d="M33 41 C36 31 46 28 50 29 C56 28 65 31 67 41 C60 36 50 37 33 41Z" fill="#6B3E2A"/>
      <ellipse cx="50" cy="31" rx="31" ry="7" fill="#DDBE70"/>
      <path d="M35 31 C35 14 65 14 65 31 Z" fill="#EBD08C"/>
      <rect x="35" y="25.5" width="30" height="4.5" fill="${c}"/>
      <circle cx="62" cy="24" r="3.6" fill="#D0473A"/><circle cx="62" cy="24" r="1.4" fill="#F7E7A8"/>`,
    scarf: () => '',
  },
  tobias: {
    skin: '#B9825E', hair: '#4A3A30',
    back: () => '',
    front: () => `<path d="M33 43 C31 37 33 34 36 33 L37 45Z M67 43 C69 37 67 34 64 33 L63 45Z" fill="#4A3A30"/>
      <path d="M32 33 C32 13 68 13 68 33 Z" fill="#E0A93C"/>
      <rect x="46.5" y="13" width="7" height="12" fill="#C8902A"/>
      <rect x="28" y="31" width="44" height="5.5" rx="2.7" fill="#C8902A"/>
      <circle cx="50" cy="24" r="5.2" fill="#FFF6DF" stroke="${INK}" stroke-width="1.6"/>
      <path d="M42 54.5 Q50 50.5 58 54.5 Q50 59 42 54.5Z" fill="#4A3A30"/>`,
    scarf: () => '<path d="M37 66 L63 66 L50 82Z" fill="#D9A441"/><path d="M42 66 L50 76 L58 66" fill="none" stroke="#B98A2A" stroke-width="1.5"/>',
  },
  ines: {
    skin: '#8A5A3E', hair: '#1E1A1A',
    back: () => '<path d="M30 48 C28 25 41 20 50 20 C59 20 72 25 70 48 L70 66 L61 66 L61 44 L39 44 L39 66 L30 66 Z" fill="#1E1A1A"/>',
    front: () => `<path d="M34 38 C40 28 60 28 66 38 C58 34 42 34 34 38Z" fill="#1E1A1A"/>
      <rect x="31" y="28.5" width="38" height="3.2" fill="${INK}"/>
      <circle cx="42" cy="29.5" r="6.2" fill="#9FDCC6" stroke="${INK}" stroke-width="2"/>
      <circle cx="58" cy="29.5" r="6.2" fill="#9FDCC6" stroke="${INK}" stroke-width="2"/>
      <path d="M39 27.5 L42 26" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>`,
    scarf: (c) => `<path d="M33 67 Q50 76 67 67 L69 76 Q50 87 31 76Z" fill="${c}"/>`,
  },
  pip: {
    skin: '#F0C9A8', hair: '#D9702B',
    back: () => '',
    front: () => `<path d="M32 42 L29 33 L37 36 L38 27 L44 33 L50 25 L56 33 L62 27 L63 36 L71 33 L68 42 C60 35 40 35 32 42Z" fill="#D9702B"/>
      <path d="M33 34 C33 13 67 13 67 34 Z" fill="#D9A441"/>
      <path d="M37 26 L63 26 M35 20 L65 20" stroke="#F7F4EC" stroke-width="3" stroke-linecap="round" opacity=".9"/>
      <rect x="31" y="31.5" width="38" height="6.5" rx="3.2" fill="#E8BE5C"/>
      <circle cx="50" cy="12.5" r="6" fill="#F7F4EC" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="42" cy="51" r="0.9" fill="#B07A56"/><circle cx="45" cy="52.5" r="0.9" fill="#B07A56"/><circle cx="58" cy="51" r="0.9" fill="#B07A56"/><circle cx="55" cy="52.5" r="0.9" fill="#B07A56"/>`,
    scarf: () => '<path d="M34 66 Q50 75 66 66 L67 74 Q50 83 33 74Z" fill="#D9A441"/><path d="M36 71 Q50 79 64 71" fill="none" stroke="#F7F4EC" stroke-width="2.5"/>',
  },
  mireille: {
    skin: '#D9A27E', hair: '#2A2622',
    back: () => '<path d="M33 42 C31 62 34 72 38 76 L62 76 C66 72 69 62 67 42Z" fill="#2A2622"/>',
    front: () => `<path d="M62 24 C74 12 82 15 85 7 C82 22 73 31 61 29Z" fill="#E8C778"/>
      <ellipse cx="50" cy="31" rx="35" ry="8" fill="#85568A"/>
      <path d="M35 31 C35 11 65 11 65 31 Z" fill="#9A6A9C"/>
      <rect x="35" y="24.5" width="30" height="4.5" fill="${INK}"/>
      <path d="M33 42 C34 36 37 33 40 33 L40 44Z M67 42 C66 36 63 33 60 33 L60 44Z" fill="#2A2622"/>
      <circle cx="33.5" cy="53" r="1.6" fill="#E8C778"/><circle cx="66.5" cy="53" r="1.6" fill="#E8C778"/>`,
    scarf: () => '<path d="M36 66 L64 66 L57 83 L50 71 L43 83Z" fill="#C79A3E"/>',
  },
  osei: {
    skin: '#6B4430', hair: '#1B1612',
    back: () => '',
    front: () => `<g fill="#1B1612"><circle cx="38" cy="32" r="6"/><circle cx="44" cy="28" r="6"/><circle cx="50" cy="27" r="6"/><circle cx="56" cy="28" r="6"/><circle cx="62" cy="32" r="6"/></g>
      <path d="M33 33 C34 19 66 19 67 33 Z" fill="#5675A8"/>
      <path d="M58 31 L79 34 L58 37Z" fill="#44608F"/>
      <circle cx="50" cy="21" r="2.2" fill="#44608F"/>
      <g fill="none" stroke="${INK}" stroke-width="1.8"><circle cx="43" cy="47" r="6.4"/><circle cx="57" cy="47" r="6.4"/><path d="M49.4 46.6 L50.6 46.6"/></g>`,
    scarf: () => '<path d="M43 68 L50 71.5 L43 75Z M57 68 L50 71.5 L57 75Z" fill="#D9A441"/><circle cx="50" cy="71.5" r="2.2" fill="#B98A2A"/>',
    glasses: true,
  },
};

/**
 * hunterPortrait(hunterId, {size, trait, dim}) -> SVG (Safe). A papercut bust: plate,
 * jacket in the trait's colour, head, and per-hunter hat / hair / scarf shapes.
 */
export function hunterPortrait(hunterId, { size = 56, trait = null, dim = false, label = '' } = {}) {
  const def = PORTRAITS[hunterId] || { skin: '#E3B895', hair: '#5A4636', back: () => '', front: () => '<path d="M33 38 C36 27 64 27 67 38 C58 33 42 33 33 38Z" fill="#5A4636"/>', scarf: () => '' };
  const t = trait || (hunterId && HUNTER_TRAIT[hunterId]) || 'botanist';
  const c = TRAIT_HEX[t] || '#7FA05A';
  const id = `mpc${++seq}`;
  const skin = def.skin;
  const eyes = def.glasses
    ? `<circle cx="43" cy="47" r="1.7" fill="${INK}"/><circle cx="57" cy="47" r="1.7" fill="${INK}"/>`
    : `<ellipse cx="43" cy="47" rx="1.8" ry="2.2" fill="${INK}"/><ellipse cx="57" cy="47" rx="1.8" ry="2.2" fill="${INK}"/>`;
  return raw(`<svg class="mp-portrait${dim ? ' is-dim' : ''}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${label || (hunterId ? hunterId[0].toUpperCase() + hunterId.slice(1) : 'Hunter')}">
<defs><clipPath id="${id}"><circle cx="50" cy="50" r="47"/></clipPath></defs>
<circle cx="50" cy="53" r="47" fill="${INK}" fill-opacity=".22"/>
<circle cx="50" cy="50" r="47" fill="${lighten(c, 0.62)}"/>
<g clip-path="url(#${id})">
  ${def.back(c)}
  <path d="M10 100 C10 76 28 68 50 68 C72 68 90 76 90 100Z" fill="${darken(c, 0.18)}"/>
  <path d="M10 100 C10 80 22 72 34 69 C26 78 26 90 30 100Z" fill="${darken(c, 0.3)}" opacity=".5"/>
  <rect x="43.5" y="58" width="13" height="14" rx="3" fill="${darken(skin, 0.12)}"/>
  ${def.scarf(c)}
  <ellipse cx="33.2" cy="48" rx="3.2" ry="4.4" fill="${skin}"/><ellipse cx="66.8" cy="48" rx="3.2" ry="4.4" fill="${skin}"/>
  <ellipse cx="50" cy="46" rx="17" ry="19" fill="${skin}"/>
  <ellipse cx="38.5" cy="53" rx="3.4" ry="2.2" fill="#D0473A" fill-opacity=".18"/><ellipse cx="61.5" cy="53" rx="3.4" ry="2.2" fill="#D0473A" fill-opacity=".18"/>
  ${eyes}
  <path d="M44.5 56.5 Q50 60.5 55.5 56.5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  ${def.front(c)}
</g>
<circle cx="50" cy="50" r="47" fill="none" stroke="${INK}" stroke-width="2.2"/>
</svg>`);
}

const HUNTER_TRAIT = { wren: 'botanist', tobias: 'miner', ines: 'diver', pip: 'lucky', mireille: 'trader', osei: 'scholar' };

// ---------------------------------------------------------------------------
// The illustrated map (static, drawn once)
// ---------------------------------------------------------------------------

const SH = 'style="filter:drop-shadow(0 3px 0 rgba(42,38,34,.24))"';

const MAP_ART = `<svg class="mp-art" viewBox="0 0 390 420" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrated map: glacier, volcano, jungle, meadow, quarry and coast">
<rect width="390" height="420" fill="#D3E2E8"/>
<path d="M0 96 C80 74 150 104 220 84 C300 64 350 94 390 78 V240 H0Z" fill="#E1EAE9"/>
<path d="M0 150 C90 128 160 158 250 138 C320 122 360 142 390 130 V260 H0Z" fill="#EEEBDD"/>
<circle cx="214" cy="52" r="27" fill="#F8EDC8" opacity=".75"/><circle cx="214" cy="52" r="19" fill="#F5E2A8"/>
<g ${SH} fill="#F7F4EC">
  <path d="M110 44 C110 36 120 34 124 38 C128 32 140 34 140 42 C148 42 148 52 140 52 H114 C106 52 104 46 110 44Z"/>
  <path d="M300 120 C300 113 309 111 312 115 C316 110 326 112 326 119 C333 119 333 128 326 128 H304 C297 128 295 122 300 120Z"/>
  <path d="M168 18 C168 12 176 11 179 14 C182 10 190 12 190 18 C196 18 196 25 190 25 H172 C166 25 164 20 168 18Z"/>
</g>
<g ${SH}>
  <path d="M0 118 L26 54 L42 78 L62 20 L92 84 L108 62 L130 118Z" fill="#C3D6E0"/>
  <path d="M62 20 L92 84 L70 84Z" fill="#A9C2CF"/>
  <path d="M62 20 L74 46 L66 41 L61 49 L55 41 L47 46Z" fill="#F7FAFA"/>
  <path d="M26 54 L35 70 L28 66 L21 71Z" fill="#F7FAFA"/>
  <path d="M108 62 L116 78 L109 75 L102 79Z" fill="#F7FAFA"/>
</g>
<g ${SH} transform="translate(-22 0)">
  <path d="M316 54 C318 41 338 37 350 39 C364 34 380 42 384 54 C376 62 362 68 350 64 C336 68 322 62 316 54Z" fill="#CDB7E6"/>
  <path d="M326 62 C334 80 346 84 352 96 C358 82 372 78 378 62Z" fill="#E6A8C8"/>
  <path d="M338 44 C342 38 350 38 354 42" fill="none" stroke="#F7F4EC" stroke-width="3" stroke-linecap="round"/>
  <path d="M368 24 C362 24 358 29 359 35 C363 32 369 31 373 33 C374 28 372 24 368 24Z" fill="#FFF6DF"/>
  <g fill="#FFF6DF"><circle cx="318" cy="30" r="2"/><circle cx="336" cy="18" r="1.6"/><circle cx="380" cy="72" r="2"/><circle cx="322" cy="82" r="1.5"/></g>
  <path d="M300 78 C302 72 312 72 314 78 C312 83 302 83 300 78Z" fill="#B7E2D6"/>
</g>
<path d="M0 150 C40 122 62 112 92 142 C122 110 150 106 180 142 C220 114 250 122 282 152 C320 122 350 128 390 142 V270 H0Z" fill="#BBC8C6"/>
<g ${SH}>
  <path d="M220 152 L258 62 C262 52 284 52 288 62 L328 152Z" fill="#7A5642"/>
  <path d="M288 62 L328 152 L298 152Z" fill="#5E3E28"/>
  <path d="M258 62 C262 52 284 52 288 62 C282 67 264 67 258 62Z" fill="#E2623A"/>
  <path d="M265 64 L261 92 L270 78 L274 100 L281 74 L287 64Z" fill="#E2623A"/>
  <g fill="#EEECE6"><circle cx="276" cy="40" r="8"/><circle cx="289" cy="29" r="6.5"/><circle cx="298" cy="17" r="5"/></g>
</g>
<g ${SH}>
  <path d="M88 176 C98 134 130 112 160 116 C192 112 216 142 224 176Z" fill="#4F8A55"/>
  <g fill="#3C7747"><circle cx="118" cy="136" r="17"/><circle cx="150" cy="120" r="21"/><circle cx="184" cy="132" r="18"/><circle cx="134" cy="152" r="14"/><circle cx="168" cy="152" r="15"/></g>
  <g fill="#6AA568"><circle cx="112" cy="130" r="7"/><circle cx="144" cy="113" r="8"/><circle cx="178" cy="126" r="7"/></g>
  <path d="M202 154 L206 120" stroke="#6B4A2E" stroke-width="4" stroke-linecap="round"/>
  <path d="M206 120 C192 112 186 118 184 127 M206 120 C216 110 226 114 228 123 M206 120 C206 108 214 103 219 106" fill="none" stroke="#2F6A40" stroke-width="5" stroke-linecap="round"/>
  <circle cx="176" cy="108" r="4.5" fill="#D0473A"/><path d="M180 108 L185 110 L180 111Z" fill="#E8A63B"/>
</g>
<path d="M0 196 C60 176 120 206 190 190 C250 178 320 200 390 184 V420 H0Z" fill="#A9C07E"/>
<g ${SH}>
  <path d="M0 232 C50 206 122 216 164 246 C190 266 190 304 164 326 L0 326Z" fill="#86AE5A"/>
  <path d="M0 252 C40 234 92 240 124 264 L0 280Z" fill="#A3C973"/>
  <g><circle cx="58" cy="254" r="3.2" fill="#B8433A"/><circle cx="92" cy="272" r="3.2" fill="#E8A63B"/><circle cx="36" cy="284" r="3.2" fill="#F7F4EC"/><circle cx="118" cy="288" r="3.2" fill="#B8433A"/><circle cx="68" cy="298" r="3.2" fill="#E8A63B"/><circle cx="140" cy="266" r="3" fill="#F7F4EC"/></g>
  <path d="M16 270 C16 254 40 254 40 270Z" fill="#E2C071"/><path d="M12 270 H44" stroke="#B8924A" stroke-width="3" stroke-linecap="round"/>
</g>
<g ${SH}>
  <path d="M256 206 C282 196 322 202 352 192 C370 188 382 192 390 190 V352 C360 342 330 352 300 337 C275 324 262 302 258 282 C250 252 250 226 256 206Z" fill="#5FA3A8"/>
  <path d="M248 210 C236 242 238 276 252 302 C266 328 282 340 302 344 C276 332 262 308 256 282 C250 252 250 228 258 206Z" fill="#E8D6A8"/>
  <g fill="none" stroke="#9ED2D0" stroke-width="4" stroke-linecap="round"><path d="M272 224 C292 216 310 228 330 220 C350 212 370 224 390 216"/><path d="M270 296 C290 288 308 300 328 292 C348 284 368 296 390 288"/><path d="M290 330 C308 322 324 334 342 326 C360 318 376 330 390 322"/></g>
  <path d="M300 276 L324 276 L317 287 L307 287Z" fill="#B8433A"/><path d="M312 254 L312 274 L324 274Z" fill="#F7F4EC"/>
</g>
<g ${SH}>
  <path d="M126 336 L148 292 L174 298 L186 262 L214 270 L230 246 L252 282 L266 336Z" fill="#C79F69"/>
  <path d="M126 336 L160 306 L190 314 L222 298 L258 322 L266 336Z" fill="#B58650"/>
  <path d="M186 262 L214 270 L206 292 L190 286Z" fill="#7F8A8C"/>
  <path d="M230 246 L252 282 L236 280Z" fill="#A88958"/>
  <g fill="#9A8A78"><circle cx="146" cy="324" r="7"/><circle cx="244" cy="322" r="6"/><circle cx="170" cy="330" r="5"/></g>
</g>
<path d="M92 274 C120 304 150 312 188 302 C230 294 270 282 312 252" fill="none" stroke="#F7F4EC" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="1 8"/>
<path d="M0 348 C70 332 140 352 210 342 C280 332 340 354 390 342 V420 H0Z" fill="#6F9150"/>
<path d="M0 384 C80 368 160 388 240 374 C310 364 360 382 390 374 V420 H0Z" fill="#5C7E42"/>
<g ${SH}>
  <rect x="40" y="350" width="5" height="16" fill="#6B4A2E"/><circle cx="42.5" cy="346" r="14" fill="#7DA862"/>
  <rect x="330" y="360" width="5" height="16" fill="#6B4A2E"/><circle cx="332.5" cy="356" r="13" fill="#7DA862"/>
  <rect x="196" y="372" width="4" height="12" fill="#6B4A2E"/><circle cx="198" cy="369" r="10" fill="#8BB36C"/>
</g>
</svg>`;

// ---------------------------------------------------------------------------
// Region glyphs for the pins
// ---------------------------------------------------------------------------

const GLYPHS = {
  meadow: '<path d="M12 20 V11"/><path d="M12 13 C8 13 6 10 6 7 C10 7 12 9 12 13Z"/><path d="M12 11 C12 8 14 6 18 6 C18 9 16 11 12 11Z"/>',
  quarry: '<path d="M4 19 L9 11 L13 16 L16 12 L21 19Z"/><path d="M9 11 L11 14"/>',
  coast: '<path d="M3 9 C6 6 9 12 12 9 C15 6 18 12 21 9"/><path d="M3 15 C6 12 9 18 12 15 C15 12 18 18 21 15"/>',
  jungle: '<path d="M12 21 V10"/><path d="M12 10 C8 7 5 9 4 12 M12 10 C16 7 19 9 20 12 M12 10 C11 6 13 4 16 4 M12 10 C9 5 7 5 5 6"/>',
  volcano: '<path d="M4 20 L9 8 H15 L20 20Z"/><path d="M10 5 C9 3 11 2 11 1 M14 5 C13 3 15 2 15 1"/>',
  glacier: '<path d="M12 3 L18 9 L12 21 L6 9Z"/><path d="M6 9 H18 M12 3 V21"/>',
  dreamshore: '<path d="M14 4 C9 4 6 8 6 12 C6 17 10 20 15 20 C11 17 11 8 14 4Z"/><path d="M18 5 L19 7.5 L21.5 8 L19.5 9.5 L20 12 L18 10.5 L16 12 L16.5 9.5 L14.5 8 L17 7.5Z"/>',
};
const glyph = (id) => raw(`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[id] || '<circle cx="12" cy="12" r="5"/>'}</svg>`);

/** A little pennant on a pole, striped in the event's palette. */
export function pennantSvg(families, size = 44) {
  const cs = (families && families.length ? families : ['neutral']).map((f) => FAMILY_HEX[f] || FAMILY_HEX.neutral);
  const n = cs.length;
  const clip = 'M9 6 L41 16 L9 26Z';
  const id = `mpp${++seq}`;
  const stripes = cs.map((c, i) => `<rect x="9" y="${(6 + (i * 20) / n).toFixed(1)}" width="34" height="${(20 / n + 0.4).toFixed(1)}" fill="${c}"/>`).join('');
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" style="filter:drop-shadow(0 2px 0 rgba(42,38,34,.3))">
<defs><clipPath id="${id}"><path d="${clip}"/></clipPath></defs>
<path d="M8 44 V4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<circle cx="8" cy="4" r="2.4" fill="#C99A2E" stroke="${INK}" stroke-width="1.2"/>
<g clip-path="url(#${id})">${stripes}</g>
<path d="${clip}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M3 44 H15" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
</svg>`);
}

// ---------------------------------------------------------------------------
// Persistence helpers (per-viewer conveniences only; all wrapped)
// ---------------------------------------------------------------------------

let memSeen = 0;
function readSeen() {
  try { const v = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(v) ? Math.max(v, memSeen) : memSeen; } catch { return memSeen; }
}
function writeSeen(v) {
  memSeen = Math.max(memSeen, v);
  try { localStorage.setItem(SEEN_KEY, String(memSeen)); } catch { /* ignore */ }
}

let cardLog = null;
function loadCardLog() {
  if (cardLog) return cardLog;
  try { cardLog = JSON.parse(localStorage.getItem(CARDS_KEY) || '{}') || {}; } catch { cardLog = {}; }
  return cardLog;
}
/** Remember each hunter's latest postcards (the save keeps only the last haul). */
export function recordHauls(state) {
  const log = loadCardLog();
  let dirty = false;
  for (const hu of (state && state.hunters && state.hunters.roster) || []) {
    const lh = hu.lastHaul;
    if (!lh || !Array.isArray(lh.postcards) || !lh.postcards.length) continue;
    const list = (log[hu.id] = log[hu.id] || []);
    if (list.some((e) => e.at === lh.at)) continue;
    list.unshift({ at: lh.at, cards: lh.postcards.map((p) => p.id) });
    list.length = Math.min(list.length, 6);
    dirty = true;
  }
  if (dirty) { try { localStorage.setItem(CARDS_KEY, JSON.stringify(log)); } catch { /* ignore */ } }
}
/** Recent postcard ids from a hunter's trips, newest first (up to `max`). */
export function recentCardsFor(hunterId, max = 6) {
  const out = [];
  for (const e of loadCardLog()[hunterId] || []) for (const id of e.cards) if (!out.includes(id)) out.push(id);
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

const traitName = (C, id) => (C.TRAITS && C.TRAITS[id] ? C.TRAITS[id].name : id);

function colorsCount(ctx, state) {
  return ctx.sim.discoveredCount(state);
}

function huntersOn(ctx, state) {
  return ctx.sim.hunters.unlocked(state);
}

function regionOpen(ctx, state, region) {
  if (!huntersOn(ctx, state)) return false;
  if ((region.era ?? 1) > (state.era ?? 1)) return false;
  return !!(state.hunters && state.hunters.regionsUnlocked || []).includes(region.id);
}

/**
 * What a locked region needs, in the "N more" voice, for a paper tag (or null when open):
 * {text, more, later}. `more` is the number of colors still to find (for ordering).
 */
export function regionLock(ctx, state, region) {
  if (regionOpen(ctx, state, region)) return null;
  if ((region.era ?? 1) > (state.era ?? 1)) return { text: 'Coming in a later update', more: Infinity, later: true };
  const count = colorsCount(ctx, state);
  const U = ctx.sim.HUNTERS_UNLOCK_COLORS;
  const u = region.unlock || {};
  const own = u.type === 'colors' ? fin(u.n) : 0;
  const n = Math.max(own, huntersOn(ctx, state) ? 0 : U);
  if (n > count) return { text: `Opens at ${n} colors: ${n - count} more`, more: n - count, later: false };
  if (u.type === 'event' || region.kind === 'event') return { text: 'Opens with its weekly event', more: 0, later: false };
  return { text: 'Opens soon', more: 0, later: false };
}

/**
 * hireInfo(ctx, state, def) -> {kind, can, text, icon}: the paper-tag line for a hunter who has
 * not joined yet ("Joins at 25 colors: 9 more", "Hire for 400 coins"), and whether Hire is live.
 * Shared with hunter.js.
 */
export function hireInfo(ctx, state, def) {
  const chk = ctx.sim.hunters.canHire(state, { hunterId: def.id });
  const cost = def.hireCost ?? 0;
  if (chk.ok) return { kind: 'ready', can: true, cost, text: cost > 0 ? `Hire for ${ctx.format.num(cost)} coins` : 'Joins free', icon: cost > 0 ? 'coin' : null };
  if (chk.reason === 'hired') return { kind: 'hired', can: false, cost, text: '', icon: null };
  if (!huntersOn(ctx, state)) {
    const U = ctx.sim.HUNTERS_UNLOCK_COLORS;
    return { kind: 'locked', can: false, cost, text: `Arrives at ${U} colors: ${Math.max(0, U - colorsCount(ctx, state))} more`, icon: 'lock' };
  }
  if (chk.reason === 'full') return { kind: 'full', can: false, cost, text: 'Your team is full', icon: null };
  if (chk.reason === 'colors') return { kind: 'colors', can: false, cost, text: `Joins at ${def.hireColors} colors: ${chk.need} more`, icon: 'lock' };
  if (chk.reason === 'coins') return { kind: 'coins', can: false, cost, text: `Hire for ${ctx.format.num(cost)} coins: ${ctx.format.num(Math.max(1, Math.ceil(cost - fin(state.coins))))} more`, icon: 'coin' };
  return { kind: 'locked', can: false, cost, text: 'Joins soon', icon: 'lock' };
}

function eventRegion(ctx, state) {
  const id = state.event && state.event.region;
  return id ? ctx.content.getRegion(id) : null;
}

function nameOfColor(ctx, state, id) {
  try { return ctx.sim.displayName(state, id) || id; } catch { return id; }
}

function hexOfColor(ctx, id) {
  const c = ctx.sim.colorInfo(id) || (ctx.content.getPigment && ctx.content.getPigment(id));
  return safeHex(c && c.hex);
}

function postcardTitle(ctx, id) {
  const c = ctx.content.getPostcard ? ctx.content.getPostcard(id) : null;
  return c ? c.title : 'a postcard';
}

/** Postcard chance for a trip (sim.hunters.cardChance per roll; level 10 adds a second roll). */
function postcardOdds(ctx, hunter, regionId, duration) {
  const p = ctx.sim.hunters.cardChance(hunter, regionId, duration, {});
  const rolls = 1 + (hunter && ctx.content.perksAtLevel(hunter.level ?? 1).some((x) => x.extraPostcardRolls) ? 1 : 0);
  return 1 - Math.pow(1 - p, rolls);
}

// ---------------------------------------------------------------------------
// Trip status (shared with hunter.js)
// ---------------------------------------------------------------------------

/** Time left at minute granularity, never seconds: "25 m", "2 h 10 m", "1 d 3 h". */
export function roughTime(ms) {
  const mins = Math.max(1, Math.ceil(fin(ms) / 60e3));
  if (mins < 60) return `${mins} m`;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs < 24) return m ? `${hrs} h ${m} m` : `${hrs} h`;
  const d = Math.floor(hrs / 24);
  const hh = hrs % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

/** HTML for a status line from tripsSummary(). Countdown spans carry data-until for the 1 s updater. */
export function tripStatusHtml(ctx, item, { withRegion = true } = {}) {
  if (!item || item.state !== 'out') return h`<span class="mp-status">Home and ready</span>`;
  const region = ctx.content.getRegion(item.region);
  const where = withRegion && region ? h` <span class="muted">· ${region.name}</span>` : '';
  if (item.choicePending) {
    return h`<span class="mp-status is-radio pulse">Radioed in: choice waiting</span>${where}`;
  }
  const ms = item.remainingMs;
  const txt = ms > 0 ? `Back in about ${roughTime(ms)}` : 'Just arriving';
  return h`<span class="mp-status"><span data-until="${item.returnsAt}" data-prefix="Back in about ">${txt}</span></span>${where}`;
}

/** Update every countdown span / trip progress bar under `root` from the live clock. */
export function tickCountdowns(root, ctx) {
  if (!root) return;
  const now = ctx.game.now();
  root.querySelectorAll('[data-until]').forEach((el) => {
    const until = Number(el.getAttribute('data-until'));
    const ms = until - now;
    const txt = ms > 0 ? `${el.getAttribute('data-prefix') || ''}${roughTime(ms)}` : 'Just arriving';
    if (el.textContent !== txt) el.textContent = txt;
  });
  root.querySelectorAll('[data-from]').forEach((el) => {
    const from = Number(el.getAttribute('data-from'));
    const to = Number(el.getAttribute('data-to'));
    const r = Math.max(0, Math.min(1, (now - from) / Math.max(1, to - from)));
    const bar = el.firstElementChild;
    if (bar) bar.style.width = `${(r * 100).toFixed(1)}%`;
    el.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  });
}

/** Thin progress bar for an expedition (kept current by tickCountdowns). */
export function tripBar(item) {
  if (!item || item.state !== 'out') return '';
  const total = item.progress < 1 ? item.remainingMs / (1 - item.progress) : item.remainingMs;
  const from = Math.round(item.returnsAt - (Number.isFinite(total) ? total : 0));
  return h`<div class="progress" role="progressbar" aria-label="Trip progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(item.progress * 100)}" data-from="${from}" data-to="${item.returnsAt}"><span style="width:${(item.progress * 100).toFixed(1)}%"></span></div>`;
}

// ---------------------------------------------------------------------------
// Haul chips (Backpack + hunter detail)
// ---------------------------------------------------------------------------

/** What a trip brought home, as paper chips. `haul` is a hunter.lastHaul summary. */
export function haulChips(ctx, state, haul) {
  const C = ctx.content;
  const chips = [];
  for (const [pid, amt] of Object.entries(haul.raw || {})) {
    const p = C.getPigment ? C.getPigment(pid) : null;
    chips.push(h`<span class="mp-find">${swatch(p ? p.hex : '#B7BDB3', 16, { cls: 'round' })}+${ctx.format.num(Math.round(amt))} ${p ? p.name : pid}</span>`);
  }
  if (haul.wild) {
    chips.push(h`<span class="mp-find is-new">${swatch(hexOfColor(ctx, haul.wild), 18, { cls: 'round' })}New wild hue: ${nameOfColor(ctx, state, haul.wild)}</span>`);
  }
  for (const id of haul.tints || []) {
    chips.push(h`<span class="mp-find is-new">${swatch(hexOfColor(ctx, id), 16, { cls: 'round' })}Noted: ${nameOfColor(ctx, state, id)}</span>`);
  }
  for (const p of haul.postcards || []) {
    const t = postcardTitle(ctx, p.id);
    const extra = p.duplicate ? h` <span class="muted">+${p.seals} ${iconSvg('seal', { size: 13 })} Seals</span>` : p.setComplete ? h` <span class="muted">set complete!</span>` : '';
    chips.push(h`<button type="button" class="mp-find ${p.rare ? 'is-gold' : ''}" data-action="open-card" data-card-id="${p.id}" data-tap>${iconSvg('pin', { size: 14 })}Postcard: ${t}${extra}</button>`);
  }
  if (haul.vial) chips.push(h`<span class="mp-find">${swatch(hexOfColor(ctx, haul.vial), 16)}A vial of ${nameOfColor(ctx, state, haul.vial)}</span>`);
  if (haul.sourceUnlocked) {
    const s = (C.SOURCES || []).find((x) => x.id === haul.sourceUnlocked);
    chips.push(h`<span class="mp-find is-new">New source: ${s ? s.name : haul.sourceUnlocked}</span>`);
  }
  if (haul.market) {
    const m = (C.ROUTES || []).find((x) => x.id === haul.market);
    chips.push(h`<span class="mp-find is-new">Found a market: ${m ? m.name : 'a new route'}</span>`);
  }
  if (haul.levelUp) chips.push(h`<span class="mp-find is-gold">${haul.name} reached level ${haul.levelUp}!</span>`);
  return chips.length ? h`<div class="mp-haul-line">${chips}</div>` : h`<div class="hint">A quiet trip, with good stories.</div>`;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

let sheet = null; // {ctx, host, regionId, hunterId, duration, onKey}

export function closeSheet() {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  document.removeEventListener('keydown', s.onKey);
  s.host.remove();
}

function whatsLeft(ctx, state, region) {
  const wilds = (region.wildHues || []).map((id) => ({ id, known: ctx.sim.knowsColor(state, id) }));
  const cards = ctx.content.cardsForRegion(region.id);
  const owned = cards.filter((c) => state.album && state.album.cards[c.id] && state.album.cards[c.id].count > 0).length;
  return { wilds, total: cards.length, owned, left: cards.length - owned };
}

/** "Back in about 25 m" for the next hunter due home. */
function nextHomeLine(roster, now) {
  const due = roster.filter((x) => x.state === 'out' && x.trip && Number.isFinite(x.trip.returnsAt)).map((x) => x.trip.returnsAt - now);
  if (!due.length) return 'Pick a region and come back when someone is free.';
  return `The next one is home in about ${roughTime(Math.max(0, Math.min(...due)))}.`;
}

function sheetHtml(ctx, state) {
  const s = sheet;
  const C = ctx.content;
  const region = C.getRegion(s.regionId);
  const now = ctx.game.now();
  const open = regionOpen(ctx, state, region);
  const lock = regionLock(ctx, state, region);
  const roster = (state.hunters && state.hunters.roster) || [];
  const home = roster.filter((x) => x.state !== 'out');
  const hunter = home.find((x) => x.id === s.hunterId) || null;
  const openRegions = C.REGIONS.filter((r) => regionOpen(ctx, state, r));
  const left = whatsLeft(ctx, state, region);
  const sample = hunter || { trait: null, trait2: null, level: 1, pityStreak: 0 };

  const regionPicker = open && openRegions.length > 1
    ? h`<div class="stack stack-sm"><div class="mp-label">Where to?</div>
        <div class="chips">${openRegions.map((r) => h`<button type="button" class="chip" data-action="pick-region" data-region-id="${r.id}" aria-pressed="${String(r.id === region.id)}" data-tap>${r.name}</button>`)}</div></div>`
    : '';

  const hunterPicker = !open ? '' : home.length
    ? h`<div class="stack stack-sm"><div class="mp-label">Who goes?</div>
        <div class="chips">${home.map((x) => h`<button type="button" class="chip" data-action="pick-hunter" data-hunter-id="${x.id}" aria-pressed="${String(x.id === s.hunterId)}" data-tap>${hunterPortrait(x.id, { size: 24, trait: x.trait })}${x.name} <span class="sub">Lv ${x.level}</span></button>`)}</div></div>`
    : h`<div class="card flat tight"><div class="semi">Everyone is out exploring</div><div class="hint">${nextHomeLine(roster, now)}</div></div>`;

  const noWilds = !left.wilds.some((w) => !w.known);
  const durations = !open ? '' : h`<div class="stack stack-sm"><div class="mp-label">How long?</div>
    <div class="mp-dur" role="group" aria-label="Trip length">${ctx.content.DURATION_IDS.map((id) => {
      const d = C.DURATIONS[id];
      const ms = hunter ? ctx.sim.hunters.tripMs(hunter, id) : d.ms;
      const len = ms === d.ms ? d.label : ctx.format.duration(ms);
      const wild = noWilds ? 'all found' : `${Math.round(ctx.sim.hunters.wildChance(sample, region.id, id) * 100)}%`;
      const card = hunter ? `${Math.round(postcardOdds(ctx, hunter, region.id, id) * 100)}%` : `${Math.round(d.card * 100)}%`;
      return h`<button type="button" data-action="pick-duration" data-duration="${id}" aria-pressed="${String(s.duration === id)}" data-tap>
        <b>${len}</b><span>Haul ×${d.haul}</span><span>Wild ${wild}</span><span>Card ${card}</span>${d.scouting ? h`<span class="tiny">may radio in</span>` : ''}</button>`;
    })}</div>
    ${hunter && hunter.pityStreak > 0 && !noWilds ? h`<div class="hint">${hunter.name}'s luck is building: +${Math.round(hunter.pityStreak * ctx.content.PITY_STEP * 100)}% wild-hue chance is already included.</div>` : ''}</div>`;

  const palette = h`<div class="stack stack-sm"><div class="mp-label">What it is like</div>
    <div class="mp-pal">${(region.palette || []).map((f) => h`<span class="mp-p">${swatch(FAMILY_HEX[f] || FAMILY_HEX.neutral, 22)}${f[0].toUpperCase() + f.slice(1)}</span>`)}</div>
    ${region.hauls && region.hauls.length ? h`<div class="mp-pal"><span class="hint">Raw finds:</span>${region.hauls.map((pid) => {
      const p = C.getPigment(pid);
      return h`<span class="mp-p">${swatch(p ? p.hex : '#B7BDB3', 16, { cls: 'round' })}${p ? p.name : pid}</span>`;
    })}</div>` : ''}</div>`;

  const leftBlock = h`<div class="stack stack-sm"><div class="mp-label">What is left here</div>
    ${left.wilds.length ? h`<div class="mp-pal">${left.wilds.map((w) => (w.known
      ? h`<span class="mp-p">${swatch(hexOfColor(ctx, w.id), 34)}<span>${nameOfColor(ctx, state, w.id)}</span></span>`
      : h`<span class="mp-sil" role="img" aria-label="A hue still to find"></span>`))}</div>
      <div class="hint">${noWilds ? 'Every hidden hue here is yours.' : `${plural(left.wilds.filter((w) => !w.known).length, 'hidden hue')} still to find.`}</div>` : h`<div class="hint">No hidden hues here, just postcards.</div>`}
    <div class="hint">${left.left > 0 ? `${plural(left.left, 'postcard')} to find here${left.owned > 0 ? `, ${left.owned} already in your album` : ''}.` : `You have the whole set of ${left.total}. Extras turn into Seals.`}</div></div>`;

  let cta;
  if (!open) cta = h`<div class="row center" style="justify-content:center">${lockTag(lock ? lock.text : 'Opens soon')}</div>`;
  else if (!hunter) cta = '';
  else cta = button(`Send ${hunter.name}`, { block: true, variant: 'primary', attrs: { 'data-action': 'send-go' } });

  return h`<button type="button" class="btn-back mp-x" data-action="close-sheet" data-tap aria-label="Close">${iconSvg('close', { size: 20 })}</button>
    <div class="stack stack-sm"><div class="mp-sheet-title">${open ? 'Send to the' : 'On the map'}<span class="mp-rname">${region.name}</span></div>
      <div class="hint">${region.blurb}</div></div>
    ${regionPicker}${hunterPicker}${durations}${palette}${leftBlock}${cta}`;
}

function paintSheet(ctx) {
  if (!sheet) return;
  const panel = sheet.host.querySelector('.mp-sheet');
  const html = String(sheetHtml(ctx, ctx.game.state));
  if (html === sheet.html) return;
  sheet.html = html;
  const top = panel.scrollTop;
  panel.innerHTML = html;
  panel.scrollTop = top;
}

/** Re-check an open Send sheet against the live state (a hunter may have just come home). */
export function refreshSheet(context) {
  if (sheet) paintSheet(context);
}

/**
 * openSendSheet(ctx, {hunterId, regionId}) — the Send sheet: pick a home hunter and a
 * trip length, see the odds (including pity), what is left in the region, then Send.
 * Locked regions open the same sheet with their paper tag instead of the Send button.
 */
export function openSendSheet(ctx, { hunterId = null, regionId = null } = {}) {
  closeSheet();
  const state = ctx.game.state;
  const C = ctx.content;
  const openRegions = C.REGIONS.filter((r) => regionOpen(ctx, state, r));
  const region = (regionId && C.getRegion(regionId)) || openRegions[0] || C.getRegion('meadow');
  const home = ((state.hunters && state.hunters.roster) || []).filter((x) => x.state !== 'out');
  const pick = home.find((x) => x.id === hunterId) || home[0] || null;
  const host = document.createElement('div');
  host.className = 'mp-sheet-host';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', `Send a hunter to the ${region.name}`);
  host.innerHTML = '<div class="sheet mp-sheet" style="position:relative"></div>';
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  sheet = { ctx, host, regionId: region.id, hunterId: pick ? pick.id : null, duration: 'long', onKey };
  document.addEventListener('keydown', onKey);
  host.addEventListener('click', (e) => {
    if (e.target === host) { closeSheet(); return; }
    const el = e.target.closest('[data-action]');
    if (!el || !sheet) return;
    const a = el.getAttribute('data-action');
    if (a === 'close-sheet') closeSheet();
    else if (a === 'pick-region') { sheet.regionId = el.getAttribute('data-region-id'); paintSheet(ctx); }
    else if (a === 'pick-hunter') { sheet.hunterId = el.getAttribute('data-hunter-id'); paintSheet(ctx); }
    else if (a === 'pick-duration') { sheet.duration = el.getAttribute('data-duration'); paintSheet(ctx); }
    else if (a === 'send-go') doSend(ctx);
  });
  document.body.appendChild(host);
  paintSheet(ctx);
  const panel = host.querySelector('.mp-sheet');
  panel.setAttribute('tabindex', '-1');
  panel.focus({ preventScroll: true });
  return host;
}

function doSend(ctx) {
  const s = sheet;
  if (!s || !s.hunterId) return;
  const state = ctx.game.state;
  const hunter = ((state.hunters && state.hunters.roster) || []).find((x) => x.id === s.hunterId);
  const region = ctx.content.getRegion(s.regionId);
  const res = ctx.game.act(ctx.sim.hunters.send, { hunterId: s.hunterId, regionId: s.regionId, duration: s.duration });
  if (res && res.ok) {
    const ms = Math.max(0, res.returnsAt - ctx.game.now());
    closeSheet();
    ctx.audio.thunk(0.6);
    ctx.toast(`${hunter ? hunter.name : 'Your hunter'} sets off for the ${region.name}. Back in about ${roughTime(ms)}.`);
  } else {
    ctx.toast('That hunter is not free right now.');
    paintSheet(ctx);
  }
}

/** openChoiceSheet(ctx, hunterId) — the scouting radio call: two options, then sim `choose`. */
export async function openChoiceSheet(ctx, hunterId) {
  const state = ctx.game.state;
  const call = ctx.sim.hunters.offerChoice(state, { hunterId }, ctx.game.now());
  const hunter = ((state.hunters && state.hunters.roster) || []).find((x) => x.id === hunterId);
  if (!call || !hunter) { ctx.toast('That radio call has already been answered.'); return null; }
  const pick = await ctx.sheet({
    title: `${hunter.name} is on the radio`,
    body: String(h`<p>${call.prompt}</p><p class="hint">It is entirely optional. If you skip it, ${hunter.name} picks one at random.</p>`),
    actions: [
      { label: call.a.text, variant: 'primary', value: 'a' },
      { label: call.b.text, variant: 'paper', value: 'b' },
    ],
  });
  if (pick !== 'a' && pick !== 'b') return null;
  const res = ctx.game.act(ctx.sim.hunters.choose, { hunterId, pick });
  if (res && res.ok) ctx.toast(`${hunter.name}: "${pick === 'a' ? call.a.text : call.b.text}". On it!`);
  return res;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let bodyEl = null;
let lastKey = '';
let timer = 0;
let visible = false;
let droppedAt = 0;

function backpackItems(state, now) {
  const seen = readSeen();
  return ((state.hunters && state.hunters.roster) || [])
    .filter((x) => x.lastHaul && x.lastHaul.at > seen && now - x.lastHaul.at < BACKPACK_WINDOW_MS)
    .sort((a, b) => b.lastHaul.at - a.lastHaul.at);
}

function backpackHtml(state, items) {
  if (!items.length) return '';
  const latest = Math.max(...items.map((x) => x.lastHaul.at));
  return h`<div class="card mp-backpack ${latest > droppedAt ? 'is-drop' : ''}" data-coach="backpack" data-latest="${latest}">
    <div class="row between"><div class="row gap-2"><span class="mp-h">Backpack</span><span class="hint">${items.length === 1 ? '1 new return' : `${items.length} new returns`}</span></div>
      ${button('Got it', { attrs: { 'data-action': 'dismiss-backpack' } })}</div>
    ${items.map((x) => {
      const region = ctx.content.getRegion(x.lastHaul.region);
      const home = x.state !== 'out';
      const again = home && region && regionOpen(ctx, state, region) ? region.id : '';
      return h`<div class="mp-haul"><div class="row gap-2">${hunterPortrait(x.id, { size: 36, trait: x.trait })}
        <div class="grow"><div class="semi">${x.name} is back${region ? h` from the ${region.name}` : ''}</div><div class="hint">Here is what came home.</div></div></div>
        ${haulChips(ctx, state, x.lastHaul)}
        <div class="mp-back-actions">${home
    ? button('Send again', { attrs: { 'data-action': 'send-again', 'data-hunter-id': x.id, 'data-region-id': again } })
    : h`<span class="hint">${x.name} is already out exploring again.</span>`}</div></div>`;
    })}
  </div>`;
}

function pinHtml(state, region, outByRegion, isEventPin) {
  const open = regionOpen(ctx, state, region);
  const lock = regionLock(ctx, state, region);
  const x = Math.max(15, Math.min(85, region.mapPos.x));
  const y = Math.max(7, Math.min(88, region.mapPos.y));
  const out = outByRegion[region.id] || 0;
  const ev = isEventPin ? ctx.content.getEvent(state.event.key) : null;
  const disc = isEventPin
    ? h`<span class="mp-disc">${pennantSvg(ev ? ev.palette : [], 46)}</span>`
    : h`<span class="mp-disc">${open ? glyph(region.id) : iconSvg('lock', { size: 20 })}${out ? h`<span class="mp-badge" aria-label="${plural(out, 'hunter')} out here">${out}</span>` : ''}</span>`;
  // Locked pins show only the lock and the name; their paper tags sit in the legend below the map
  // so nothing overlaps or clips at the edge of the frame.
  return h`<button type="button" class="mp-pin ${open ? '' : 'is-locked'} ${isEventPin ? 'is-event' : ''}" style="left:${x}%;top:${y}%"
      data-action="region" data-region-id="${region.id}" data-tap aria-label="${region.name}${open ? '' : ', ' + (lock ? lock.text : 'locked')}">
      ${disc}<span class="mp-name">${region.name}</span>
      ${isEventPin ? h`<span class="tag">This week</span>` : ''}</button>`;
}

function mapHtml(state) {
  const hOn = huntersOn(ctx, state);
  const outBy = {};
  for (const x of (state.hunters && state.hunters.roster) || []) if (x.state === 'out' && x.trip) outBy[x.trip.region] = (outBy[x.trip.region] || 0) + 1;
  const ev = eventRegion(ctx, state);
  const pins = ctx.content.REGIONS.filter((r) => r.kind !== 'event').map((r) => pinHtml(state, r, outBy, false));
  if (ev && hOn) pins.push(pinHtml(state, ev, outBy, true));
  const more = Math.max(0, ctx.sim.HUNTERS_UNLOCK_COLORS - colorsCount(ctx, state));
  return h`<div class="mp-win ${hOn ? '' : 'is-sleepy'}" data-coach="map"><div class="mp-view ${hOn ? '' : 'is-sleepy'}">${raw(MAP_ART)}${pins}</div>
    ${hOn ? '' : h`<div class="mp-banner">Hunters arrive at ${ctx.sim.HUNTERS_UNLOCK_COLORS} colors<small>${more} more, and the window opens.</small></div>`}</div>`;
}

/** The locked places with their paper tags, nearest goal first (kept off the illustration so nothing overlaps). */
function legendHtml(state) {
  const C = ctx.content;
  const hOn = huntersOn(ctx, state);
  const evRegion = eventRegion(ctx, state);
  const locked = C.REGIONS
    .filter((r) => r.kind !== 'event' || (!hOn && evRegion && r.id === evRegion.id))
    .map((r) => ({ r, lock: regionLock(ctx, state, r) }))
    .filter((x) => x.lock);
  if (!locked.length) return '';
  const soon = locked.filter((x) => !x.lock.later).sort((a, b) => a.lock.more - b.lock.more);
  const later = locked.filter((x) => x.lock.later);
  const shown = soon.slice(0, 3);
  return h`<div class="card mp-legend" data-legend>
    <div class="mp-h">Next places to open</div>
    ${shown.map((x) => h`<div class="mp-legend-row"><span class="mp-rn">${x.r.name}</span>${lockTag(x.lock.text)}</div>`)}
    ${later.length ? h`<div class="mp-legend-row"><span class="mp-rn">${later.map((x) => x.r.name).join(' and ')}</span>${lockTag('Coming in a later update')}</div>` : ''}
    ${soon.length > shown.length ? h`<div class="hint">More places open as your catalog grows.</div>` : ''}
  </div>`;
}

function rosterHtml(state, trips) {
  if (!trips.length) return '';
  const C = ctx.content;
  return h`<div class="mp-section"><h2 class="mp-h">Your hunters</h2><span class="hint">${trips.filter((x) => x.state === 'home').length} home</span></div>
    ${trips.map((t) => {
      const choice = t.state === 'out' && t.choicePending;
      return h`<div class="card is-tap mp-hunter" role="button" tabindex="0" data-action="open-hunter" data-hunter-id="${t.hunterId}" data-tap data-hunter-row="${t.hunterId}">
        ${hunterPortrait(t.hunterId, { size: 54, trait: t.trait })}
        <div class="grow stack stack-sm" style="gap:3px">
          <div class="row gap-2 wrap"><span class="mp-hn">${t.name}</span><span class="chip mp-chip">${traitName(C, t.trait)}</span><span class="mp-lv">Lv ${t.level}</span></div>
          <div>${tripStatusHtml(ctx, t)}</div>
          ${t.state === 'out' && !choice ? tripBar(t) : ''}
        </div>
        ${choice ? button('Answer', { attrs: { 'data-action': 'answer-choice', 'data-hunter-id': t.hunterId } }) : iconSvg('back', { size: 18, cls: 'mp-fwd' })}
      </div>`;
    })}`;
}

function hireHtml(state) {
  const C = ctx.content;
  const roster = (state.hunters && state.hunters.roster) || [];
  const rest = C.HUNTERS.filter((d) => !roster.some((x) => x.id === d.id));
  if (!rest.length) return '';
  const room = Math.max(0, C.MAX_ROSTER - roster.length);
  return h`<div class="mp-section"><h2 class="mp-h">Join the team</h2><span class="hint">${room > 0 ? `Room for ${plural(room, 'hunter')}` : 'Your team is full'}</span></div>
    ${rest.map((d) => {
      const info = hireInfo(ctx, state, d);
      const foot = info.can
        ? h`<span class="mp-cost">${info.cost > 0 ? iconSvg('coin', { size: 16 }) : ''}${info.text}</span>`
        : (info.icon === 'lock' ? lockTag(info.text) : tag(info.text, { icon: info.icon }));
      return h`<div class="card is-tap mp-hire" role="button" tabindex="0" data-action="open-hunter" data-hunter-id="${d.id}" data-tap data-hire-row="${d.id}">
        ${hunterPortrait(d.id, { size: 50, trait: d.trait, dim: !info.can })}
        <div class="grow stack stack-sm" style="gap:4px">
          <div class="row gap-2 wrap"><span class="mp-hn">${d.name}</span><span class="chip mp-chip">${traitName(C, d.trait)}</span></div>
          <div class="hint">${d.blurb}</div>
          <div class="mp-hire-foot">${foot}</div>
        </div>
        ${info.can ? button('Hire', { variant: 'primary', attrs: { 'data-action': 'hire', 'data-hunter-id': d.id } }) : iconSvg('back', { size: 18, cls: 'mp-fwd' })}
      </div>`;
    })}`;
}

function eventLine(state) {
  const ev = state.event && ctx.content.getEvent(state.event.key);
  const region = eventRegion(ctx, state);
  if (!ev || !region) return '';
  const hOn = huntersOn(ctx, state);
  return h`<div class="card flat tight row gap-2" style="flex-direction:row;align-items:center">
    <span aria-hidden="true">${pennantSvg(ev.palette, 30)}</span>
    <div class="grow"><div class="semi small">${hOn ? `${ev.name}: the ${region.name} is open` : `${ev.name} is on this week`}</div><div class="hint">${hOn ? 'Its postcards and trips count toward the event track. Points are saved, so there is never a rush.' : 'Its trips open with your hunters. Points are saved, so there is never a rush.'}</div></div>
    ${button('Track', { attrs: { 'data-action': 'open-quests' } })}</div>`;
}

function build(state) {
  const now = ctx.game.now();
  const trips = ctx.sim.hunters.tripsSummary(state, now);
  const items = backpackItems(state, now);
  return h`${backpackHtml(state, items)}${mapHtml(state)}${legendHtml(state)}${eventLine(state)}${rosterHtml(state, trips)}${hireHtml(state)}`;
}

function paint(state, force = false) {
  if (!bodyEl) return;
  state = state || ctx.game.state;
  recordHauls(state);
  const html = String(build(state));
  // Countdown text changes every second; compare without it so we only rebuild on real changes.
  const key = html.replace(' is-drop', '').replace(/(data-until="\d+" data-prefix="[^"]*">)[^<]*/g, '$1').replace(/(data-from="\d+" data-to="\d+"><span style="width:)[^"]*/g, '$1');
  if (!force && key === lastKey) { tickCountdowns(root, ctx); return; }
  lastKey = key;
  bodyEl.innerHTML = html;
  markSeenSoon(state);
  const bp = bodyEl.querySelector('.mp-backpack');
  if (bp) droppedAt = Math.max(droppedAt, Number(bp.getAttribute('data-latest')) || 0);
  tickCountdowns(root, ctx);
  const sub = root.querySelector('.screen-head .subtitle');
  if (sub) sub.textContent = headSubtitle(state);
  const slot = root.querySelector('[data-map-headslot]');
  if (slot) {
    const hOn = huntersOn(ctx, state);
    const more = Math.max(0, ctx.sim.HUNTERS_UNLOCK_COLORS - colorsCount(ctx, state));
    const headHtml = String(hOn ? button('Album', { attrs: { 'data-action': 'open-album' } }) : lockTag(`Album: ${more} more colors`));
    if (slot.innerHTML !== headHtml) slot.innerHTML = headHtml;
  }
}

/** The map is on screen (with its Backpack): every haul home counts as read, which clears the tab dot. */
let seenTimer = 0;
function markSeenSoon(state) {
  if (!visible || seenTimer || !ctx.sim.hunters.mapAttention(state, ctx.game.now()).hauls) return;
  seenTimer = setTimeout(() => { // never act from inside a render
    seenTimer = 0;
    if (visible) ctx.game.act(ctx.sim.hunters.markHaulsSeen, {});
  }, 0);
}

function headSubtitle(state) {
  const roster = (state.hunters && state.hunters.roster) || [];
  if (!huntersOn(ctx, state)) return 'The window opens soon';
  const out = roster.filter((x) => x.state === 'out').length;
  return out ? `${plural(out, 'hunter')} out exploring` : 'Everyone is home';
}

function knock() {
  const win = root && root.querySelector('.mp-win');
  if (!win) return;
  win.classList.remove('is-knock');
  void win.offsetWidth;
  win.classList.add('is-knock');
  setTimeout(() => win.classList.remove('is-knock'), 600);
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.getAttribute('data-action');
  const state = ctx.game.state;
  if (a === 'open-hunter') ctx.navigate('hunter', { hunterId: el.getAttribute('data-hunter-id') });
  else if (a === 'region') openSendSheet(ctx, { regionId: el.getAttribute('data-region-id') });
  else if (a === 'answer-choice') { e.stopPropagation(); openChoiceSheet(ctx, el.getAttribute('data-hunter-id')).then(() => paint(ctx.game.state, true)); }
  else if (a === 'dismiss-backpack') {
    const latest = Math.max(0, ...((state.hunters && state.hunters.roster) || []).map((x) => (x.lastHaul ? x.lastHaul.at : 0)));
    writeSeen(latest);
    paint(state, true);
  } else if (a === 'send-again') openSendSheet(ctx, { hunterId: el.getAttribute('data-hunter-id'), regionId: el.getAttribute('data-region-id') || null });
  else if (a === 'open-card') ctx.navigate('album', { cardId: el.getAttribute('data-card-id') });
  else if (a === 'open-album') ctx.navigate('album');
  else if (a === 'open-quests') ctx.navigate('quests');
  else if (a === 'hire') {
    const id = el.getAttribute('data-hunter-id');
    const res = ctx.game.act(ctx.sim.hunters.hire, { hunterId: id });
    if (res && res.ok) {
      const def = ctx.content.getHunter(id);
      ctx.audio.stamp();
      ctx.toast(`${def ? def.name : 'A new hunter'} joins the team!`);
      requestAnimationFrame(() => {
        const row = root.querySelector(`[data-hunter-row="${id}"]`);
        if (row) { ctx.fx.ringBurst(row, '#E2B04A', { size: 120 }); row.classList.add('mp-hl'); }
      });
    } else ctx.toast('Not quite yet. Your coins are building up.');
  }
}

const screen = {
  id: 'map',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    injectStyle();
    root.innerHTML = String(h`<div class="screen-head is-left">
        <div class="titles"><div class="title">Map</div><div class="subtitle"></div></div>
        <div class="mp-headslot" data-map-headslot></div>
      </div><div class="screen-body" data-map-body></div>`);
    bodyEl = root.querySelector('[data-map-body]');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
    });
    if (ctx.game.on) {
      ctx.game.on('hunterReturn', () => { if (visible) knock(); });
    }
    paint(ctx.game.state, true);
  },

  show(params = {}) {
    visible = true;
    paint(ctx.game.state, true);
    clearInterval(timer);
    timer = setInterval(() => tickCountdowns(root, ctx), 1000);
    if (params.hunterId) {
      requestAnimationFrame(() => {
        const row = root.querySelector(`[data-hunter-row="${params.hunterId}"]`);
        if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('mp-hl'); }
      });
    }
    if (params.regionId) openSendSheet(ctx, { regionId: params.regionId, hunterId: params.sendHunterId || null });
  },

  hide() {
    visible = false;
    clearInterval(timer);
    timer = 0;
    closeSheet();
  },

  render(state) {
    if (!visible) return;
    paint(state);
    refreshSheet(ctx);
  },
};

export default screen;
