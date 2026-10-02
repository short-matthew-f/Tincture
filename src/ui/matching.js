/**
 * matching.js: the Matching overlay (screen id `matching`, fullscreen) plus the
 * drop-mixing pieces the Mixing bench shares (`Mixer`, `jarSvg`, `dialSvg`,
 * `payBase`, `injectStyles`).
 *
 * Implements DESIGN.md "Active play > Matching (orders)" (live blend, closeness
 * scored in OKLab, never a fail, undo + reset jar, no timers) and "Interaction
 * feel > Interaction spec" (Pour, Order submitted). Look ported from
 * docs/prototypes/Matching.dc.html: teardrop drop chips, a live blend jar, a
 * closeness needle, tiered chords.
 *
 * data-action names handled here: `drop` (data-drop = pigment id), `undo`,
 * `reset`, `submit`, `back-orders`.
 */

import { h, raw, iconSvg, button, backButton, tag, swatch, safeHex, lighten, escapeHtml } from './kit.js';

// ---------------------------------------------------------------------------
// Shared helpers (also imported by bench.js and orders.js)
// ---------------------------------------------------------------------------

/** Inject a <style> once per id (screens own their CSS; style.css is not ours). */
export function injectStyles(id, css) {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`style[data-ui="${id}"]`)) return;
  const s = document.createElement('style');
  s.setAttribute('data-ui', id);
  s.textContent = css;
  document.head.appendChild(s);
}

export const TIER_NAMES = Object.freeze({ perfect: 'Perfect', great: 'Great', good: 'Good', close: 'Close enough' });

/** Coins an order pays at 100% right now (base x income multiplier x hand-delivery bonus). */
export function payBase(ctx, order, now) {
  const state = ctx.game.state;
  const o = ctx.sim.orders;
  const t = now ?? ctx.game.now();
  const base = Math.max(Number(order.pay) || 0, o.orderBasePay(state, order.minutes ?? 3));
  return base * ctx.sim.incomeMultiplier(state, t) * o.handDeliverBonus(state, t);
}

/** Whole coins, never fractions ("Pays 2 to 4.3" became "Up to 4 coins"). */
export function coinsText(ctx, n) {
  const v = Math.round(Number(n) || 0);
  return ctx.format.num(Number(n) > 0 ? Math.max(1, v) : 0);
}

/** "5 coins" / "1 coin". */
export function coinsWord(ctx, n) {
  const v = Number(n) > 0 ? Math.max(1, Math.round(Number(n))) : 0;
  return `${ctx.format.num(v)} ${v === 1 ? 'coin' : 'coins'}`;
}

/** The customer's wish in words ("a soft green"), so a plain swatch carries a little story. */
export function wishWords(ctx, hex) {
  try {
    const { L, C } = ctx.color.hexToOklch(hex);
    const fam = ctx.color.hueFamily(hex);
    const word = fam === 'neutral' ? 'gray' : fam;
    const lw = L > 0.82 ? 'pale' : L < 0.42 ? 'deep' : C > 0.13 ? 'bright' : L > 0.66 ? 'soft' : 'muted';
    return `a ${lw} ${word}`;
  } catch (e) {
    return 'a color';
  }
}

/** The name to show for an order's customer: a repeat on the same board gets a fresh neighbor (older saves). */
export function customerName(ctx, order) {
  const open = ctx.game.state.orders?.open ?? [];
  const first = open.findIndex((o) => o.customer === order.customer);
  if (first < 0 || open[first].id === order.id) return order.customer;
  const names = ctx.content.CUSTOMER_NAMES ?? [];
  if (!names.length) return order.customer;
  const used = new Set(open.map((o) => o.customer));
  let hash = 0;
  for (const ch of String(order.id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  for (let k = 0; k < names.length; k++) {
    const n = names[(hash + k) % names.length];
    if (!used.has(n)) return n;
  }
  return order.customer;
}

/**
 * Minute-granularity waiting copy: never seconds, never a pressure.
 * ms <= 60 s says "soon".
 */
export function aboutMinutes(ms) {
  if (!(ms > 60e3)) return 'soon';
  const m = Math.round(ms / 60e3);
  if (m >= 90) return `in about ${Math.round(m / 60)} h`;
  return `in about ${m} m`;
}

/** The reputation star as a labeled chip, never a bare glyph. */
export function repChip(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return h`<span class="oq-chip">${iconSvg('star', { size: 16 })}<span>${v} reputation ${v === 1 ? 'star' : 'stars'}</span></span>`;
}

/** Commission lock: null when open, else {tag, more} naming the real goal from state. */
export function commissionLock(ctx, state) {
  const gate = ctx.sim.factory?.PHASE_GATES?.[3] ?? { colors: 30, room: 'loading-yard' };
  const have = ctx.sim.discoveredCount(state);
  const left = Math.max(0, gate.colors - have);
  const yard = (state.rooms ?? []).includes(gate.room);
  if ((state.phase ?? 1) >= 3) return null;
  let text = 'Commissions open soon';
  let more = '';
  if (left > 0 && !yard) text = `Commissions open at ${gate.colors} colors and the Loading Yard`;
  else if (left > 0) text = `Commissions open at ${gate.colors} colors`;
  else if (!yard) text = 'Commissions open with the Loading Yard';
  if (left > 0) more = `${left} more ${left === 1 ? 'color' : 'colors'}`;
  if (!yard && left > 0) more += ', then build the Loading Yard';
  else if (!yard) more = 'Build the Loading Yard in your workshop';
  return { tag: tag(text, { icon: 'lock', cls: 'oq-lock' }), more };
}

/** Styles shared by orders, matching, bench and commissions (headings in Figtree; serif only for names). */
export const SHARED_CSS = `
[data-screen="orders"] .screen-head .title, [data-screen="matching"] .screen-head .title,
[data-screen="bench"] .screen-head .title, [data-screen="commissions"] .screen-head .title { font-family: var(--font-ui); font-weight: 700; font-size: 19px; }
.oq-h { font-family: var(--font-ui); font-weight: 700; font-size: 19px; line-height: 1.2; }
.oq-h.sm { font-size: 16px; }
.oq-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px 6px 9px; min-height: 32px; border-radius: 999px; background: var(--glow); color: var(--glow-ink); box-shadow: 0 0 0 2px var(--glow-ring); font-size: 13px; font-weight: 700; }
.oq-lock { white-space: normal; font-size: 12px; max-width: 100%; line-height: 1.25; padding-top: 5px; padding-bottom: 5px; }
.oq-lockrow { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.oq-lockrow .more { font-size: 13px; font-weight: 600; color: var(--ink-soft); padding-left: 2px; }
.oq-req { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 3px 11px; border-radius: 999px; background: var(--plaster); box-shadow: inset 0 0 0 1.5px var(--plaster-line); color: var(--ink); font-size: 12px; font-weight: 600; line-height: 1.1; }
.oq-req svg { width: 12px; height: 12px; }
.oq-btn { min-height: 44px; padding: 0 14px; font-size: 14px; }
`;

const dropsLabel = (n) => (n ? `${n} ${n === 1 ? 'drop' : 'drops'}` : '');

// -- the jar ----------------------------------------------------------------

const JAR_TOP = 34;
const JAR_BOTTOM = 182;
const JAR_H = JAR_BOTTOM - JAR_TOP;
const JAR_BODY = 'M40 34 H120 V52 C120 60 142 66 142 92 V158 A24 24 0 0 1 118 182 H42 A24 24 0 0 1 18 158 V92 C18 66 40 60 40 52 Z';
let jarUid = 0;

/** How full the jar looks for `n` drops (a feel, not a measurement). */
export function jarLevel(n) {
  return n > 0 ? Math.min(0.88, 0.4 + 0.06 * n) : 0;
}

/**
 * jarSvg({size}) -> the live blend jar, empty (paper glass). The liquid is
 * clipped to the jar and rises with a CSS transform; the FIRST clipPath is the
 * liquid region so fx.pourFill floods only what is filled.
 */
export function jarSvg({ label = 'Your mix' } = {}) {
  const id = `jr${++jarUid}`;
  return raw(`<svg class="mx-jar" viewBox="0 0 160 196" role="img" aria-label="${escapeHtml(label)}" data-jar>
<defs>
<clipPath id="${id}-liq" clip-path="url(#${id}-body)"><rect data-liq-clip x="0" y="${JAR_BOTTOM}" width="160" height="${JAR_H + 20}"/></clipPath>
<clipPath id="${id}-body"><path d="${JAR_BODY}"/></clipPath>
</defs>
<path d="${JAR_BODY}" fill="#FBF8F1"/>
<g clip-path="url(#${id}-body)" data-fill-layer>
<g data-liq style="transform:translateY(${JAR_H}px)">
<rect data-liq-fill x="0" y="${JAR_TOP}" width="160" height="${JAR_H + 24}" fill="#B7BDB3"/>
<rect data-liq-top x="0" y="${JAR_TOP}" width="160" height="7" fill="#D8DCD4"/>
</g>
</g>
<rect x="28" y="84" width="8" height="70" rx="4" fill="#fff" fill-opacity="0.5"/>
<path d="${JAR_BODY}" fill="none" stroke="#2A2622" stroke-width="3" stroke-linejoin="round"/>
<rect x="34" y="14" width="92" height="20" rx="5" fill="#C9A277" stroke="#2A2622" stroke-width="3"/>
</svg>`);
}

/** Set the jar's liquid for `n` drops of mixed color `hex` (null = leave the color, lower the level). */
export function applyJar(svg, hex, n) {
  if (!svg) return;
  const ratio = jarLevel(n);
  const liq = svg.querySelector('[data-liq]');
  if (liq) liq.style.transform = `translateY(${((1 - ratio) * JAR_H).toFixed(1)}px)`;
  const clip = svg.querySelector('[data-liq-clip]');
  if (clip) clip.setAttribute('y', (JAR_BOTTOM - ratio * JAR_H).toFixed(1));
  if (hex) {
    const c = safeHex(hex);
    svg.querySelector('[data-liq-fill]')?.setAttribute('fill', c);
    svg.querySelector('[data-liq-top]')?.setAttribute('fill', lighten(c, 0.28));
  }
}

function dripInto(svg, hex, ratio, fx) {
  if (!svg || fx.isReducedMotion() || typeof svg.animate !== 'function') return;
  const NS = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(NS, 'ellipse');
  c.setAttribute('cx', '80');
  c.setAttribute('cy', '0');
  c.setAttribute('rx', '5');
  c.setAttribute('ry', '7');
  c.setAttribute('fill', safeHex(hex));
  c.setAttribute('stroke', '#2A2622');
  c.setAttribute('stroke-opacity', '0.5');
  svg.appendChild(c);
  const fall = Math.max(30, JAR_BOTTOM - ratio * JAR_H);
  try {
    c.animate(
      [{ transform: 'translateY(2px)', opacity: 1 }, { transform: `translateY(${fall}px)`, opacity: 1, offset: 0.85 }, { transform: `translateY(${fall}px)`, opacity: 0 }],
      { duration: 240, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
    ).finished.then(() => c.remove(), () => c.remove());
  } catch (e) { c.remove(); }
}

// -- the closeness dial -----------------------------------------------------

const DIAL_ZONES = [
  [0, 0.667, '#C4C9BE'], // close enough
  [0.667, 0.833, '#C9A277'], // good
  [0.833, 0.933, '#7B5236'], // great
  [0.933, 1, '#C99A2E'], // perfect
];
const needleDeg = (c) => -90 + 180 * Math.max(0, Math.min(1, Number(c) || 0));

function arcPath(c0, c1, r, cx = 100, cy = 96) {
  const pt = (c) => {
    const th = Math.PI * (1 - c);
    return `${(cx + r * Math.cos(th)).toFixed(2)} ${(cy - r * Math.sin(th)).toFixed(2)}`;
  };
  return `M${pt(c0)} A${r} ${r} 0 0 1 ${pt(c1)}`;
}

/** dialSvg() -> the closeness gauge; the needle is `[data-needle]` (rotate via setNeedle). */
export function dialSvg() {
  const arcs = DIAL_ZONES.map(([a, b, col]) => `<path d="${arcPath(a + 0.004, b - 0.004, 78)}" fill="none" stroke="${col}" stroke-width="14"/>`).join('');
  return raw(`<svg class="mx-dial" viewBox="0 0 200 108" role="img" aria-label="Closeness to their color" data-dial>
${arcs}
<g class="mx-needle" data-needle style="transform:rotate(-90deg)"><path d="M100 96 L100 28" stroke="#2A2622" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="96" r="8" fill="#2A2622"/><circle cx="100" cy="96" r="3" fill="#F7F4EC"/></g>
</svg>`);
}

/** Rotate the needle to closeness 0..1 (CSS-eased; pass `instant` to skip the swing). */
export function setNeedle(root, closeness, { instant = false } = {}) {
  const n = root && root.querySelector('[data-needle]');
  if (!n) return;
  if (instant) {
    n.style.transition = 'none';
    n.style.transform = `rotate(${needleDeg(closeness)}deg)`;
    void n.getBoundingClientRect();
    n.style.transition = '';
  } else {
    n.style.transform = `rotate(${needleDeg(closeness)}deg)`;
  }
}

// -- the drop mixer ---------------------------------------------------------

/**
 * Mixer: drop chips + live jar + undo history, shared by Matching and the bench.
 * `root` must hold a `[data-jar-slot]` and a `[data-chips]` element.
 */
export class Mixer {
  constructor(ctx, root, { onChange } = {}) {
    this.ctx = ctx;
    this.root = root;
    this.onChange = onChange || (() => {});
    this.history = [];
    this.pigments = [];
    this.key = '';
    this.hex = null;
    const slot = root.querySelector('[data-jar-slot]');
    if (slot) slot.innerHTML = String(jarSvg());
    this.svg = root.querySelector('svg[data-jar]');
  }

  /** Replace the chip set; keeps the drops she has already added. */
  setPigments(list) {
    const key = list.map((p) => `${p.id}:${p.hex}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.pigments = list;
    this.history = this.history.filter((id) => list.some((p) => p.id === id));
    const box = this.root.querySelector('[data-chips]');
    if (box) {
      box.innerHTML = String(h`${list.map((p) => h`<button type="button" class="mx-chip" data-action="drop" data-drop="${p.id}" data-tap aria-label="Add a drop of ${p.name}">
<span class="mx-drop" style="background:${safeHex(p.hex)}"></span>
<span class="mx-name">${p.name}</span>
<span class="mx-count" data-count="${p.id}"></span>
</button>`)}`);
    }
    this.sync();
  }

  counts() {
    const m = {};
    for (const id of this.history) m[id] = (m[id] || 0) + 1;
    return m;
  }

  /** [{id, name, hex, count}] in chip order, only drops that were added. */
  drops() {
    const c = this.counts();
    return this.pigments.filter((p) => c[p.id]).map((p) => ({ id: p.id, name: p.name, hex: p.hex, count: c[p.id] }));
  }

  get size() { return this.history.length; }

  blend() {
    return this.ctx.puzzles.matching.blend(this.drops());
  }

  /** "2 madder, 1 ochre, 1 white" (empty string for an empty jar). */
  recipeText() {
    return this.drops().map((d) => `${d.count} ${d.name.toLowerCase()}`).join(', ');
  }

  sync() {
    const c = this.counts();
    for (const el of this.root.querySelectorAll('[data-count]')) {
      const id = el.getAttribute('data-count');
      el.textContent = dropsLabel(c[id] || 0);
      el.closest('.mx-chip')?.classList.toggle('has', !!c[id]);
    }
    this.hex = this.blend();
    applyJar(this.svg, this.hex, this.history.length);
  }

  add(id) {
    const p = this.pigments.find((x) => x.id === id);
    if (!p) return;
    const { audio, haptics, fx } = this.ctx;
    const prevN = this.history.length;
    this.history.push(id);
    this.sync();
    const ratio = jarLevel(this.history.length);
    try { audio.glug(ratio, { fromRatio: jarLevel(prevN), hz: 300 }); } catch (e) { /* audio is optional */ }
    haptics.soft();
    dripInto(this.svg, p.hex, ratio, fx);
    fx.pourFill(this.svg, this.hex || p.hex, { x: 80, y: JAR_BOTTOM - ratio * JAR_H + 4, ms: 360 });
    this.onChange('add', p);
  }

  undo() {
    if (!this.history.length) return;
    this.history.pop();
    this.ctx.audio.tick('deselect');
    this.sync();
    this.onChange('undo');
  }

  reset() {
    if (!this.history.length) return;
    this.history = [];
    this.ctx.audio.tick('deselect');
    this.sync();
    this.onChange('reset');
  }
}

/** The drops card markup: the chip grid (filled by Mixer.setPigments). */
export function chipsHtml() {
  return h`<div class="card mx-drops-card" data-coach-slot><div class="mx-chips" data-chips></div></div>`;
}

export const MIX_CSS = `
.mx-jar { height: 100%; width: auto; max-width: 100%; overflow: visible; }
.mx-jar [data-liq] { transition: transform 420ms var(--ease-out); }
.mx-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 10px 6px; }
.mx-chip { min-width: 44px; }
.mx-chip { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0 2px; min-height: 92px; border-radius: 12px; }
.mx-chip:active .mx-drop { transform: rotate(-45deg) translate(2px, -2px) scale(0.94); }
.mx-drop { width: 44px; height: 44px; margin-top: 6px; border-radius: 50% 6% 50% 50%; transform: rotate(-45deg); box-shadow: inset 0 0 0 1.5px rgba(42,38,34,0.2), 0 3px 0 rgba(42,38,34,0.28); transition: transform 120ms var(--ease-out); }
.mx-chip.has .mx-drop { box-shadow: inset 0 0 0 1.5px rgba(42,38,34,0.2), 0 0 0 3px var(--paper), 0 0 0 5px var(--ink); }
.mx-name { font-size: 13px; font-weight: 600; line-height: 1.1; text-align: center; }
.mx-count { font-size: 12px; color: var(--ink-soft); }
.mx-drops-card { padding: 10px 8px 8px; }
.mx-actions { display: flex; gap: 10px; padding: 8px var(--gutter) calc(14px + var(--safe-bottom)); background: var(--plaster); }
.mx-actions .btn { min-height: 48px; }
.mx-actions .grow { flex: 1 1 auto; }
`;

// ---------------------------------------------------------------------------
// The Matching screen
// ---------------------------------------------------------------------------

const MATCH_CSS = `
.mx-top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; transition: gap 450ms var(--ease-out); }
.mx-top.is-joined { gap: 3px; }
.mx-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mx-col .cap { font-size: 13px; font-weight: 600; }
.mx-target, .mx-mine { height: 168px; border-radius: 14px; box-shadow: 0 3px 0 rgba(42,38,34,0.28); }
.mx-top.is-joined .mx-target, .mx-top.is-joined .mx-mine { height: 120px; }
.mx-mine { animation: mx-slide 480ms var(--ease-out) both; }
.mx-jarbox { height: 168px; display: flex; align-items: flex-end; justify-content: center; }
.mx-gauge { flex-direction: row; align-items: center; gap: 10px; }
.mx-gauge .mx-dial { width: 148px; flex: 0 0 auto; overflow: visible; }
.mx-needle { transform-origin: 100px 96px; transition: transform 720ms cubic-bezier(0.25, 1.12, 0.5, 1); }
.mx-tier { font-family: var(--font-ui); font-weight: 700; font-size: 20px; line-height: 1.15; }
.mx-pay { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--ink-soft); }
.mx-result { gap: 10px; animation: screen-in 260ms var(--ease-out) both; align-items: center; text-align: center; }
.mx-result .mx-top { width: 100%; text-align: left; }
.mx-result .mx-dial { width: 190px; overflow: visible; margin-top: 2px; }
.mx-result .big { font-family: var(--font-ui); font-weight: 800; font-size: 26px; line-height: 1.1; }
.mx-paid { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 26px; font-weight: 700; transition: opacity 200ms; }
.mx-paid small { font-size: 15px; font-weight: 600; color: var(--ink-soft); }
.mx-chips-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.mx-notes { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.mx-notes li { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.mx-notes svg { flex: 0 0 auto; }
.mx-new { flex-direction: row; align-items: center; gap: 12px; }
.mx-new .nm { font-family: var(--font-display); font-size: 18px; line-height: 1.2; }
.mx-new .lk { margin-top: 2px; min-height: 44px; padding: 0 12px; font-size: 14px; }
.mx-goal { font-size: 13px; color: var(--ink-soft); text-align: center; padding: 2px 8px; }
.mx-gone { text-align: center; align-items: center; padding: 22px 16px; }
.mx-tip { font-size: 13px; color: var(--ink-soft); }
@keyframes mx-slide { from { transform: translateX(34%); opacity: 0.2; } to { transform: none; opacity: 1; } }
`;

const S = {
  ctx: null,
  root: null,
  mixer: null,
  orderId: null,
  order: null,
  phase: 'mixing', // 'mixing' | 'submitting' | 'done'
  newColor: null, // color id found by the delivered mix
  timers: [],
};

const later = (fn, ms) => { S.timers.push(setTimeout(fn, ms)); };
const stateOf = () => S.ctx.game.state;

function findOrder() {
  return (stateOf().orders?.open ?? []).find((o) => o.id === S.orderId) ?? null;
}

function head(title) {
  return h`<div class="screen-head">${backButton('Back to orders')}<div class="titles"><div class="title ellipsis">${title}</div></div><span class="spacer"></span></div>`;
}

function nextMatchOrder(exceptId) {
  return (stateOf().orders?.open ?? []).find((o) => o.kind === 'match' && o.id !== exceptId) ?? null;
}

function gonePage() {
  const next = nextMatchOrder(null);
  const left = (stateOf().orders?.open ?? []).length;
  return h`${head('Order delivered')}<div class="screen-body"><div class="card mx-gone"><div class="oq-h">That order is all set</div><p class="muted">${left ? `${left} ${left === 1 ? 'order is' : 'orders are'} waiting on the board.` : 'New orders arrive on the board as the day goes by.'}</p>
${next ? button('Next order', { variant: 'primary', block: true, attrs: { 'data-action': 'next-order' } }) : ''}
${button('Back to orders', { variant: next ? 'paper' : 'primary', block: true, attrs: { 'data-action': 'back-orders' } })}</div></div>`;
}

function build() {
  const { ctx, root } = S;
  const order = S.order;
  if (S.mixer) S.mixer = null;
  S.newColor = null;
  if (!order || order.kind !== 'match') {
    root.innerHTML = String(gonePage());
    return;
  }
  const target = safeHex(order.target);
  const who = customerName(ctx, order);
  root.innerHTML = String(h`${head(`Order from ${who}`)}
<div class="screen-body">
<div class="card">
<div class="small muted">${who} would like ${wishWords(ctx, order.target)}. Anything you deliver is welcome; the needle shows what it pays.</div>
<div class="mx-top" data-top>
<div class="mx-col"><div class="mx-target" style="background:${target}" role="img" aria-label="Their swatch"></div><div class="cap">Their swatch</div></div>
<div class="mx-col" data-mine-col><div class="mx-jarbox" data-jar-slot></div><div class="cap">Your mix</div></div>
</div>
</div>
<div class="card mx-gauge" data-gauge>
${dialSvg()}
<div class="stack stack-sm grow"><div class="mx-tier" data-tier>Add a drop</div><div class="mx-pay" data-pay-hint></div><div class="small muted" data-hint>Tap a drop below to start mixing.</div></div>
</div>
${chipsHtml()}
</div>
<div class="mx-actions" data-bar>
${button('Undo', { attrs: { 'data-action': 'undo' } })}
${button('Reset jar', { attrs: { 'data-action': 'reset' } })}
${button('Deliver', { variant: 'primary', cls: 'grow', attrs: { 'data-action': 'submit' } })}
</div>`);
  S.mixer = new Mixer(ctx, root, { onChange: update });
  S.mixer.setPigments(ctx.sim.discovery.availablePigments(stateOf()));
  update();
}

/** Refresh needle, tier label, pay preview and button states from the jar. */
function update() {
  const { ctx, root, mixer, order } = S;
  if (!mixer || !order) return;
  const m = ctx.puzzles.matching;
  const hex = mixer.hex;
  const tierEl = root.querySelector('[data-tier]');
  const payEl = root.querySelector('[data-pay-hint]');
  const hint = root.querySelector('[data-hint]');
  const base = payBase(ctx, order);
  const coin = String(iconSvg('coin', { size: 16 }));
  if (!hex) {
    setNeedle(root, 0);
    tierEl.textContent = 'Add a drop';
    payEl.innerHTML = `${coin}<span>Pays up to ${coinsWord(ctx, base * 1.5)}</span>`;
    hint.textContent = 'Tap a drop below to start mixing.';
  } else {
    const sc = m.score(order.target, hex);
    setNeedle(root, m.closeness(order.target, hex));
    tierEl.textContent = TIER_NAMES[sc.tier] ?? 'Nice';
    payEl.innerHTML = `${coin}<span>Pays ${coinsWord(ctx, base * sc.pct)}</span>`;
    hint.textContent = sc.tier === 'perfect' ? 'That is a match. Deliver when you like.' : 'Keep going, or deliver any time.';
  }
  const has = mixer.size > 0;
  const undo = root.querySelector('[data-action="undo"]');
  const reset = root.querySelector('[data-action="reset"]');
  undo.hidden = !has;
  reset.hidden = !has;
  undo.disabled = !has;
  reset.disabled = !has;
  root.querySelector('[data-action="submit"]').disabled = !has;
}

function chordFor(tier, hexes) {
  const { ctx } = S;
  const L = ctx.color.hexToOklch(hexes[0]).L;
  const n = { perfect: 5, great: 4, good: 3, close: 2 }[tier] || 2;
  const bright = { perfect: 1, great: 0.55, good: 0.25, close: 0 }[tier] || 0;
  const base = Math.max(0.08, Math.min(0.5, L));
  const Ls = [];
  for (let k = 0; k < n; k++) Ls.push(Math.min(0.98, base + k * 0.17));
  ctx.audio.chord(Ls, bright);
}

const SHELF_GOAL = (ctx, state) => {
  const need = ctx.sim.shelf.UNLOCK_COLORS ?? 5;
  const left = need - ctx.sim.discoveredCount(state);
  return left > 0 ? `${left} more ${left === 1 ? 'color' : 'colors'} and the shelf opens` : '';
};

/** The bar at the bottom after a delivery: two ways on. */
function barHtml(next) {
  return h`${button('Back to orders', { variant: next ? 'paper' : 'primary', cls: next ? '' : 'grow', attrs: { 'data-action': 'back-orders' } })}
${next ? button('Next order', { variant: 'primary', cls: 'grow', attrs: { 'data-action': 'next-order' } }) : ''}`;
}

function submit() {
  const { ctx, root, mixer, order } = S;
  if (S.phase !== 'mixing' || !mixer || !mixer.size) return;
  const drops = mixer.drops();
  const state = stateOf();
  const bonus = ctx.sim.orders.handDeliverBonus(state, ctx.game.now());
  const customer = customerName(ctx, order);
  const target = order.target;
  S.phase = 'submitting';
  const res = ctx.game.act(ctx.sim.orders.submitOrder, { orderId: order.id, drops });
  if (!res || !res.ok) {
    S.phase = 'mixing';
    ctx.toast('That order is no longer on the board');
    ctx.navigate('orders');
    return;
  }
  S.phase = 'done';
  const mixHex = res.mixHex || mixer.hex;
  const tier = res.tier;
  S.newColor = res.discovered ? res.discovered.colorId : null;
  const closeness = ctx.puzzles.matching.closeness(target, mixHex);

  const cell = Number.isInteger(res.vialCell) ? state.shelf?.cells?.[res.vialCell] : null;
  const vialName = cell ? ctx.sim.displayName(state, cell.color) : null;
  const notes = [];
  if (vialName) notes.push(h`<li>${iconSvg('plus', { size: 18 })}<span>A bonus vial of <span class="serif">${vialName}</span> is on the shelf</span></li>`);
  if (bonus > 1) notes.push(h`<li>${iconSvg('coin', { size: 18 })}<span>Fleet is busy: +${Math.round((bonus - 1) * 100)}% for hand delivery</span></li>`);
  if (res.tutorialBonus > 0) notes.push(h`<li>${iconSvg('coin', { size: 18 })}<span>Includes a welcome gift of ${coinsWord(ctx, res.tutorialBonus)}</span></li>`);
  const praise = {
    perfect: `${customer} is thrilled. Exactly the color they pictured.`,
    great: `${customer} loves it.`,
    good: `${customer} is happy with it.`,
    close: `${customer} says it will do nicely. Thank you!`,
  }[tier] || `${customer} says thank you.`;
  const next = nextMatchOrder(order.id);
  const waiting = (stateOf().orders?.open ?? []).length;
  const goal = SHELF_GOAL(ctx, stateOf());
  const newName = S.newColor ? ctx.sim.displayName(stateOf(), S.newColor) : '';

  root.innerHTML = String(h`${head(`Order from ${customer}`)}
<div class="screen-body" data-done>
<div class="card mx-result" data-result>
<div class="mx-top is-joined">
<div class="mx-col"><div class="mx-target" style="background:${safeHex(target)}" role="img" aria-label="Their swatch"></div><div class="cap">Their swatch</div></div>
<div class="mx-col"><div class="mx-mine" style="background:${safeHex(mixHex)}" role="img" aria-label="Your mix"></div><div class="cap">Your mix</div></div>
</div>
${dialSvg()}
<div class="big" data-tier-done>${tier === 'perfect' ? 'Perfect!' : tier === 'close' ? 'Close enough' : `${TIER_NAMES[tier] ?? 'Lovely'} match`}</div>
<div class="muted small">${praise}</div>
<div class="mx-paid" data-paid-wrap style="opacity:0">${iconSvg('coin', { size: 26 })}<span data-paid class="num">${coinsText(ctx, res.coins)}</span><small>${Math.max(1, Math.round(res.coins)) === 1 ? 'coin' : 'coins'}</small></div>
${tier === 'perfect' ? h`<div class="mx-chips-row">${repChip(state.orders?.reputation ?? 0)}</div>` : ''}
</div>
${notes.length ? h`<div class="card"><ul class="mx-notes">${notes}</ul></div>` : ''}
${S.newColor ? h`<div class="card mx-new" data-newcolor>${swatch(res.discovered.hex || mixHex, 48, { label: newName })}<div class="grow"><div class="small muted">A new color joined your catalog</div><div class="nm" data-newcolor-name>${newName}</div><button type="button" class="btn btn-paper lk" data-action="see-catalog" data-tap>See it in your catalog</button></div></div>` : ''}
<div class="mx-goal">${waiting} ${waiting === 1 ? 'order is' : 'orders are'} waiting on the board${goal ? `. ${goal}.` : '.'}</div>
</div>
<div class="mx-actions" data-bar>${barHtml(next)}</div>`);
  setNeedle(root, 0, { instant: true });
  requestAnimationFrame(() => setNeedle(root, closeness));

  // Sounds, haptics, confetti, rolling pay: after the slide lands.
  const hexes = [target, mixHex, ...drops.map((d) => d.hex)];
  const paid = root.querySelector('[data-paid]');
  const wrap = root.querySelector('[data-paid-wrap]');
  later(() => {
    chordFor(tier, hexes);
    if (tier === 'perfect') {
      ctx.haptics.success();
      ctx.fx.confetti(hexes, root.querySelector('.mx-mine'), { count: 24 });
      ctx.fx.ringBurst(root.querySelector('.mx-mine'), '#E2B04A');
    } else {
      ctx.haptics.light();
    }
    if (wrap) wrap.style.opacity = '1';
    ctx.fx.rollNumber(paid, 0, res.coins, { ms: 650, format: (v) => coinsText(ctx, v) });
    ctx.audio.coins(tier === 'perfect' ? 7 : 4);
  }, 380);
  // Never leave the pay hidden if the timer is cut short.
  later(() => { if (wrap) wrap.style.opacity = '1'; }, 1500);
}

export default {
  id: 'matching',

  mount(root, ctx) {
    S.root = root;
    S.ctx = ctx;
    injectStyles('oq-shared', SHARED_CSS);
    injectStyles('mix', MIX_CSS);
    injectStyles('matching', MATCH_CSS);
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t) || t.disabled) return;
      switch (t.getAttribute('data-action')) {
        case 'drop': if (S.phase === 'mixing') S.mixer?.add(t.getAttribute('data-drop')); break;
        case 'undo': if (S.phase === 'mixing') S.mixer?.undo(); break;
        case 'reset': if (S.phase === 'mixing') S.mixer?.reset(); break;
        case 'submit': submit(); break;
        case 'back-orders': ctx.navigate('orders'); break;
        case 'next-order': {
          const o = nextMatchOrder(S.phase === 'done' ? null : S.orderId);
          if (o) ctx.navigate('matching', { orderId: o.id });
          else ctx.navigate('orders');
          break;
        }
        case 'see-catalog': ctx.navigate('catalog'); break;
        default: break;
      }
    });
  },

  show(params = {}) {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.orderId = params.orderId ?? null;
    S.phase = 'mixing';
    S.order = findOrder();
    build();
  },

  hide() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
  },

  render(state) {
    if (S.phase === 'done') {
      // She named the new color on top of this page: keep the name current.
      const el = S.root.querySelector('[data-newcolor-name]');
      if (el && S.newColor) {
        const name = S.ctx.sim.displayName(state, S.newColor);
        if (el.textContent !== name) el.textContent = name;
      }
      return;
    }
    if (S.phase !== 'mixing' || !S.mixer) return;
    const order = findOrder();
    if (!order) { // delivered elsewhere (the Order Clerk) while she was mixing
      S.order = null;
      build();
      return;
    }
    S.order = order;
    S.mixer.setPigments(S.ctx.sim.discovery.availablePigments(state));
  },
};
