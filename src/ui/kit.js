/**
 * kit.js: tiny HTML helpers for Tincture's DOM + inline-SVG UI.
 *
 * Owns: the `h` escaping template tag, `raw`, `el`, the small component
 * builders (`card`, `button`, `tag`, `swatch`, `backButton`, `progressBar`),
 * and the shared SVG art: `containerSvg` (the five Merge Shelf containers from
 * docs/prototypes/Style.dc.html), `vatSvg` (display vats from Main.dc.html) and
 * `iconSvg`. Implements ARCHITECTURE.md "UI > kit.js" and DESIGN.md "Art
 * direction > Production rules" (draw neutral, tint in code).
 *
 * Safety model: everything returned by this module is a `Safe` (a String
 * subclass, so `.trim()`, `+`, `innerHTML = x` and `${x}` all just work).
 * `h` escapes every interpolation unless it is a `Safe` (from `raw()`, another
 * `h`, or any kit builder). Arrays are flattened and joined. null, undefined and
 * false render as nothing, so `${cond && h`...`}` works.
 * Builders that take "content" (card, button label, ...) escape plain strings
 * and pass `Safe` through.
 */

// ---------------------------------------------------------------------------
// Escaping and the h tag
// ---------------------------------------------------------------------------

/** Marker type: a string that is already HTML and must not be escaped again. */
export class Safe extends String {}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for use in HTML text nodes and quoted attribute values. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Mark a trusted HTML string so `h` will not escape it. */
export function raw(str) {
  return str instanceof Safe ? str : new Safe(String(str ?? ''));
}

/** Convert any interpolated value to safe HTML text. */
function toHtml(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return String(v);
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return escapeHtml(v);
}

/** Tagged template: h`<b>${userText}</b>` escapes userText. Returns a Safe. */
export function h(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new Safe(out);
}

/** Parse an HTML string (or Safe) into its first Element. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

/** Build an attribute string from an object: true -> bare attr, false/null -> skipped. */
function attrs(obj) {
  if (!obj) return '';
  let s = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === false || v === null || v === undefined) continue;
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue;
    s += v === true ? ' ' + k : ` ${k}="${escapeHtml(v)}"`;
  }
  return s;
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Accept only hex colors in inline styles/SVG fills; anything else becomes `fallback`. */
export function safeHex(hex, fallback = '#B7BDB3') {
  return typeof hex === 'string' && HEX_RE.test(hex.trim()) ? hex.trim() : fallback;
}

function mixWith(hex, target, t) {
  let c = safeHex(hex).slice(1);
  if (c.length <= 4) c = c.split('').map((x) => x + x).join('');
  const out = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16);
    return Math.round(v + (target - v) * t).toString(16).padStart(2, '0');
  });
  return '#' + out.join('');
}
/** Mix a hex toward white by t (0..1). */
export const lighten = (hex, t = 0.3) => mixWith(hex, 255, t);
/** Mix a hex toward black by t (0..1). */
export const darken = (hex, t = 0.2) => mixWith(hex, 0, t);

// ---------------------------------------------------------------------------
// Component builders
// ---------------------------------------------------------------------------

/**
 * card(content, {cls, tap, attrs}) -> `<div class="card ...">`.
 * `tap: true` adds `is-tap` and `data-tap` (delegated tick + haptic).
 */
export function card(content, { cls = '', tap = false, attrs: extra = null } = {}) {
  const a = attrs({ ...(tap ? { 'data-tap': true } : null), ...extra });
  return h`<div class="card ${tap ? 'is-tap ' : ''}${cls}"${raw(a)}>${content}</div>`;
}

/**
 * button(label, {variant, cls, attrs, tap, icon, disabled, block, small})
 * variant: 'primary' (ink) | 'paper' (default). Adds `data-tap` unless tap:false.
 * `icon` is an iconSvg name drawn before the label. `label` may be Safe HTML.
 */
export function button(label, { variant = 'paper', cls = '', attrs: extra = null, tap = true,
  icon = null, disabled = false, block = false, small = false } = {}) {
  const classes = ['btn', variant === 'primary' ? 'btn-primary' : variant === 'wood' ? 'btn-wood' : 'btn-paper',
    block ? 'block' : '', small ? 'small' : '', cls].filter(Boolean).join(' ');
  const a = attrs({ type: 'button', ...(tap ? { 'data-tap': true } : null), disabled, ...extra });
  return h`<button class="${classes}"${raw(a)}>${icon ? iconSvg(icon, { size: 18 }) : ''}${label}</button>`;
}

/** tag(text, {icon}) -> paper tag naming an unlock goal ("20 colors"). */
export function tag(text, { icon = 'lock', cls = '' } = {}) {
  return h`<span class="tag ${cls}">${icon ? iconSvg(icon, { size: 12 }) : ''}${text}</span>`;
}

/** swatch(hex, size=40) -> rounded color chip. `size` in px. */
export function swatch(hex, size = 40, { cls = '', label = '' } = {}) {
  const a = label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"';
  return h`<span class="swatch ${cls}"${raw(a)} style="--size:${Number(size) || 40}px;background:${safeHex(hex)}"></span>`;
}

/** backButton(label) -> 44px paper back button; `label` is the aria-label ("Back to the workshop"). */
export function backButton(label = 'Back') {
  return h`<button type="button" class="btn-back" data-back data-tap aria-label="${label}">${iconSvg('back', { size: 20 })}</button>`;
}

/** progressBar(ratio 0..1) -> thin ink bar. */
export function progressBar(ratio, { label = 'Progress', cls = '' } = {}) {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return h`<div class="progress ${cls}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r * 100)}"><span style="width:${(r * 100).toFixed(1)}%"></span></div>`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const STROKE_ICONS = {
  // tab bar icons (docs/prototypes/Main.dc.html)
  workshop: ['0 0 24 24', '<path d="M3 11 L12 4 L21 11 V20 H3 Z"/><path d="M9 20 V14 H15 V20"/>'],
  orders: ['0 0 24 24', '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9 H15 M9 13 H15 M9 17 H12"/>'],
  puzzles: ['0 0 24 24', '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'],
  map: ['0 0 24 24', '<path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z"/><path d="M9 4 V18 M15 6 V20"/>'],
  catalog: ['0 0 24 24', '<path d="M5 4 H17 A2 2 0 0 1 19 6 V20 H7 A2 2 0 0 1 5 18 Z"/><path d="M5 18 A2 2 0 0 1 7 16 H19"/>'],
  // common icons
  back: ['0 0 20 20', '<path d="M12 4 L6 10 L12 16"/>', 2],
  close: ['0 0 20 20', '<path d="M5 5 L15 15 M15 5 L5 15"/>', 2],
  plus: ['0 0 20 20', '<path d="M10 4 V16 M4 10 H16"/>', 2],
  check: ['0 0 20 20', '<path d="M4 10.5 L8.5 15 L16 6"/>', 2.2],
  lock: ['0 0 20 20', '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9 V6.5 A3 3 0 0 1 13 6.5 V9"/>', 1.8],
  sound: ['0 0 24 24', '<path d="M4 9.5 H8 L13 5.5 V18.5 L8 14.5 H4 Z"/><path d="M16.5 9 C18.2 10.6 18.2 13.4 16.5 15"/><path d="M19 6.5 C22 9.5 22 14.5 19 17.5"/>', 1.8],
  'sound-off': ['0 0 24 24', '<path d="M4 9.5 H8 L13 5.5 V18.5 L8 14.5 H4 Z"/><path d="M17 9.5 L22 14.5 M22 9.5 L17 14.5"/>', 1.8],
  pin: ['0 0 20 20', '<path d="M10 17.5 V11.5"/><path d="M6.5 11.5 H13.5 L12.5 4.5 H7.5 Z"/>', 1.8],
};

const FILLED_ICONS = {
  coin: ['0 0 22 22', '<circle cx="11" cy="11" r="10" fill="#C99A2E"/><circle cx="11" cy="11" r="6.5" fill="none" stroke="#8C6512" stroke-width="1.5"/>'],
  star: ['0 0 24 24', '<path d="M12 2.5 l2.7 5.8 l6.3 0.8 l-4.6 4.3 l1.2 6.3 l-5.6 -3.1 l-5.6 3.1 l1.2 -6.3 l-4.6 -4.3 l6.3 -0.8 z" fill="#E2B04A" stroke="#8C6512" stroke-width="1.2" stroke-linejoin="round"/>'],
};

/** Names accepted by iconSvg. */
export const ICON_NAMES = [...Object.keys(STROKE_ICONS), ...Object.keys(FILLED_ICONS)];

/** iconSvg(name, {size=24, cls}) -> inline SVG (stroke icons use currentColor). */
export function iconSvg(name, { size = 24, cls = '' } = {}) {
  const s = Number(size) || 24;
  if (FILLED_ICONS[name]) {
    const [vb, body] = FILLED_ICONS[name];
    return raw(`<svg class="icon ${escapeHtml(cls)}" width="${s}" height="${s}" viewBox="${vb}" aria-hidden="true">${body}</svg>`);
  }
  const def = STROKE_ICONS[name];
  if (!def) return raw('');
  const [vb, body, sw = 1.8] = def;
  return raw(`<svg class="icon ${escapeHtml(cls)}" width="${s}" height="${s}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
}

// ---------------------------------------------------------------------------
// Container + vat art
// ---------------------------------------------------------------------------

const GLASS = '#F2F4F0';
const CORK = '#C9A277';
const INK = '#2A2622';
const GOLD = '#E2B04A';
const GOLD_DEEP = '#8C6512';
const WOOD = '#A87449';
const WOOD_DEEP = '#5E3E28';

let uid = 0;

export const CONTAINER_NAMES = ['', 'Vial', 'Jar', 'Bottle', 'Urn', 'Cask'];

const BOTTLE_D = 'M33 14 H47 V34 C47 40 64 44 64 62 V96 A8 8 0 0 1 56 104 H24 A8 8 0 0 1 16 96 V62 C16 44 33 40 33 34 Z';
const URN_D = 'M26 22 H54 V30 C54 34 48 36 48 40 C62 46 68 58 68 72 C68 90 56 104 40 104 C24 104 12 90 12 72 C12 58 18 46 32 40 C32 36 26 34 26 30 Z';
const CASK_D = 'M14 34 C22 28 58 28 66 34 C71 50 71 86 66 100 C58 106 22 106 14 100 C9 86 9 50 14 34 Z';
const STAR_D = 'M40 4 l3.5 7 l7.5 1 l-5.5 5 l1.5 7.5 l-7 -3.5 l-7 3.5 l1.5 -7.5 l-5.5 -5 l7.5 -1 z';

/**
 * containerSvg(tier 1..5, hex, {golden, size, label}) -> SVG string.
 * Tiers: 1 vial, 2 jar, 3 bottle, 4 urn, 5 cask. Drawn neutral (glass, cork,
 * wood) and tinted with `hex` at runtime. `golden` adds a gold rim and a star.
 * `size` is the rendered WIDTH in px (default 72); height follows the 80x110
 * viewBox. Each call uses unique clipPath ids, so many can share a page.
 */
export function containerSvg(tier, hex, { golden = false, size = 72, label = '' } = {}) {
  const t = Math.max(1, Math.min(5, Math.round(Number(tier) || 1)));
  const fill = safeHex(hex);
  const id = `ct${++uid}`;
  const w = Number(size) || 72;
  const ht = Math.round((w * 110) / 80);
  const name = `${CONTAINER_NAMES[t]}${label ? ', ' + label : ''}${golden ? ', golden' : ''}`;
  const hi = (x, y, hgt, wd = 5) => `<rect x="${x}" y="${y}" width="${wd}" height="${hgt}" rx="${wd / 2}" fill="#FFFFFF" fill-opacity="0.5"/>`;
  const rim = (shape) => (golden ? shape.replace('/>', ` stroke="${GOLD}" stroke-width="5.5" stroke-linejoin="round" />`) : '');
  let body = '';
  let defs = '';

  if (t === 1) {
    const g = '<rect x="32" y="22" width="16" height="82" rx="8" fill="none"/>';
    body = `${rim(g)}
<rect x="31" y="10" width="18" height="12" rx="3" fill="${CORK}"/>
<rect x="32" y="22" width="16" height="82" rx="8" fill="${GLASS}"/>
<rect x="32" y="48" width="16" height="56" rx="8" fill="${fill}"/>
${hi(35, 28, 60, 4)}
<rect x="32" y="22" width="16" height="82" rx="8" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  } else if (t === 2) {
    const g = '<rect x="18" y="38" width="44" height="66" rx="10" fill="none"/>';
    body = `${rim(g)}
<rect x="16" y="26" width="48" height="12" rx="3" fill="${CORK}"/>
<rect x="18" y="38" width="44" height="66" rx="10" fill="${GLASS}"/>
<rect x="18" y="54" width="44" height="50" rx="10" fill="${fill}"/>
${hi(23, 44, 48)}
<rect x="18" y="38" width="44" height="66" rx="10" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  } else if (t === 3) {
    defs = `<clipPath id="${id}"><path d="${BOTTLE_D}"/></clipPath>`;
    const g = `<path d="${BOTTLE_D}" fill="none"/>`;
    body = `${rim(g)}
<rect x="31" y="6" width="18" height="10" rx="3" fill="${CORK}"/>
<path d="${BOTTLE_D}" fill="${GLASS}"/>
<rect x="10" y="58" width="60" height="50" fill="${fill}" clip-path="url(#${id})"/>
${hi(21, 60, 34)}
<path d="${BOTTLE_D}" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  } else if (t === 4) {
    defs = `<clipPath id="${id}"><path d="${URN_D}"/></clipPath>`;
    const g = `<path d="${URN_D}" fill="none"/>`;
    body = `${rim(g)}
<path d="M14 54 C2 54 2 76 14 78" fill="none" stroke="${INK}" stroke-width="3"/>
<path d="M66 54 C78 54 78 76 66 78" fill="none" stroke="${INK}" stroke-width="3"/>
<rect x="24" y="14" width="32" height="10" rx="3" fill="${CORK}"/>
<path d="${URN_D}" fill="${GLASS}"/>
<rect x="6" y="56" width="68" height="52" fill="${fill}" clip-path="url(#${id})"/>
${hi(19, 58, 30)}
<path d="${URN_D}" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  } else {
    const g = `<path d="${CASK_D}" fill="none"/>`;
    body = `${rim(g)}
<path d="${CASK_D}" fill="${WOOD}" stroke="${INK}" stroke-width="2.2"/>
<path d="M12 50 C24 46 56 46 68 50" fill="none" stroke="${WOOD_DEEP}" stroke-width="4"/>
<path d="M12 84 C24 88 56 88 68 84" fill="none" stroke="${WOOD_DEEP}" stroke-width="4"/>
<rect x="22" y="58" width="36" height="20" rx="4" fill="${fill}"/>
<rect x="36" y="94" width="8" height="10" rx="2" fill="${WOOD_DEEP}"/>
<path d="M40 106 C38 108 38 109 40 110 C42 109 42 108 40 106 Z" fill="${fill}"/>
<path d="${STAR_D}" fill="${GOLD}" stroke="${GOLD_DEEP}" stroke-width="1"/>`;
  }

  // Golden vials/jars/bottles/urns get the Essence-style star in the corner.
  if (golden && t < 5) {
    body += `\n<path d="M64 6 l2.6 5.2 l5.6 0.8 l-4.1 4 l1 5.6 l-5.1 -2.7 l-5.1 2.7 l1 -5.6 l-4.1 -4 l5.6 -0.8 z" fill="${GOLD}" stroke="${GOLD_DEEP}" stroke-width="1"/>`;
  }

  return raw(`<svg class="container container-t${t}${golden ? ' golden' : ''}" width="${w}" height="${ht}" viewBox="0 0 80 110" role="img" aria-label="${escapeHtml(name)}" data-tier="${t}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`);
}

/**
 * vatSvg(fillRatio 0..1, hex, {label, size}) -> display vat (Main.dc.html).
 * The paint layer carries `data-fill-layer` and the clipPath is the first one
 * in the SVG, which is what fx.pourFill() floods. `label` hangs a paper tag
 * beneath (Young Serif). `size` is the rendered width in px (default 66).
 */
export function vatSvg(fillRatio, hex, { label = '', size = 66 } = {}) {
  const r = Math.max(0, Math.min(1, Number.isFinite(fillRatio) ? fillRatio : 0));
  const fill = safeHex(hex);
  const id = `vt${++uid}`;
  const top = 12 + 98 * (1 - r);
  const vbH = label ? 138 : 114;
  const w = Number(size) || 66;
  const hgt = Math.round((w * vbH) / 66);
  let paint = '';
  if (r > 0) {
    paint = `<g clip-path="url(#${id})" data-fill-layer>
<rect x="6" y="${top.toFixed(2)}" width="54" height="${(110 - top + 4).toFixed(2)}" fill="${fill}"/>
${r < 0.97 ? `<rect x="6" y="${top.toFixed(2)}" width="54" height="7" fill="${lighten(fill, 0.28)}"/>` : ''}
</g>`;
  }
  const tagSvg = label
    ? `<rect x="14" y="116" width="38" height="18" rx="3" fill="#F7F4EC" style="filter:drop-shadow(0 2px 0 rgba(42,38,34,.25))"/><text x="33" y="129" text-anchor="middle" fill="${INK}" style="font-family:'Young Serif',Georgia,serif;font-size:10px">${escapeHtml(label)}</text>`
    : '';
  return raw(`<svg class="vat" width="${w}" height="${hgt}" viewBox="0 0 66 ${vbH}" role="img" aria-label="${escapeHtml(label || 'Vat')}, ${Math.round(r * 100)}% full" data-fill="${r.toFixed(3)}">
<defs><clipPath id="${id}"><rect x="6" y="12" width="54" height="98" rx="14"/></clipPath></defs>
<rect x="6" y="12" width="54" height="98" rx="14" fill="#F2F4F0" fill-opacity="0.85"/>
${paint}
<rect x="12" y="22" width="6" height="70" rx="3" fill="#FFFFFF" fill-opacity="0.45"/>
<rect x="6" y="12" width="54" height="98" rx="14" fill="none" stroke="${INK}" stroke-width="2.5"/>
<rect x="12" y="2" width="42" height="12" rx="3" fill="#7B5236"/>
${tagSvg}
</svg>`);
}
