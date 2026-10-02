/**
 * orders.js: the Order board (bottom tab, screen id `orders`).
 *
 * Implements DESIGN.md "Active play > Matching (orders)" (3 to 6 open orders
 * that wait for her), "Gentle surprises" ("Anything you love" orders, about 1
 * in 10), container orders (an Urn of ..., from the Merge Shelf), the hand
 * delivery bonus, reputation stars and the Order Clerk note.
 *
 * Cards: `match` orders open the Matching overlay; `any` orders expand a
 * color picker (she offers a discovered color; rarer pays more); `container`
 * orders deliver a merged container from the shelf.
 *
 * data-action names: `open-match` (data-order), `toggle-any` (data-order),
 * `pick-color` (data-order, data-color), `offer-any` (data-order),
 * `deliver-container` (data-order, data-cell), `go-shelf`, `commissions`,
 * `bench`.
 * Coach target: data-coach="first-order" on the first order card.
 */

import { h, iconSvg, button, tag, swatch, safeHex, containerSvg, CONTAINER_NAMES } from './kit.js';
import { injectStyles, payBase } from './matching.js';

const CSS = `
.or-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.or-rep { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 18px; }
.or-rep small { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
.or-badge { background: var(--glow); box-shadow: 0 0 0 2px var(--glow-ring), 0 2px 0 var(--shadow-soft); color: var(--glow-ink); font-weight: 600; font-size: 14px; flex-direction: row; align-items: center; gap: 10px; padding: 10px 14px; }
.or-card .or-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.or-card .or-sw { width: 64px; height: 64px; border-radius: 12px; flex: 0 0 auto; box-shadow: 0 3px 0 rgba(42,38,34,0.28); }
.or-card .or-sw.any { background: linear-gradient(135deg, #F3D68A 0%, #E2B04A 55%, #C99A2E 100%); display: grid; place-items: center; }
.or-card .or-name { font-family: var(--font-display); font-size: 17px; line-height: 1.2; }
.or-card .or-pay { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink-soft); }
.or-card .or-go { flex: 0 0 auto; color: var(--ink-soft); }
.or-card .or-go svg { transform: rotate(180deg); }
.or-card .or-cont { flex: 0 0 auto; width: 64px; display: grid; place-items: center; }
.or-pick { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-height: 250px; overflow-y: auto; padding: 4px 2px 6px; -webkit-overflow-scrolling: touch; }
.or-opt { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 12px; background: var(--plaster); min-height: 88px; min-width: 0; }
.or-opt.is-sel { background: var(--paper); box-shadow: 0 0 0 3px var(--ink); }
.or-opt .nm { font-size: 12px; font-weight: 600; line-height: 1.15; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.or-opt .py { font-size: 11px; color: var(--ink-soft); }
.or-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.or-actions .btn { padding: 0 10px; }
.or-lock { display: flex; align-items: center; justify-content: center; min-height: var(--tap); }
.or-empty { text-align: center; padding: 22px 16px; align-items: center; }
.or-done { color: var(--ink); font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
`;

const S = {
  ctx: null,
  root: null,
  body: null,
  html: '',
  anyOpen: null, // order id whose picker is open
  pick: {}, // order id -> color id
  down: false,
  dirty: false,
  timer: 0,
  bonusAt: -Infinity,
  bonus: 1,
};

const stateOf = () => S.ctx.game.state;

function handBonus() {
  const { ctx } = S;
  const now = ctx.game.now();
  if (now - S.bonusAt > 1500 || now < S.bonusAt) {
    S.bonusAt = now;
    try { S.bonus = ctx.sim.orders.handDeliverBonus(stateOf(), now); } catch (e) { S.bonus = 1; }
  }
  return S.bonus;
}

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The shelf cell (smallest big-enough container of that color) that fills a container order. */
function containerCell(state, want) {
  const cells = state.shelf?.cells ?? [];
  let best = -1;
  cells.forEach((c, i) => {
    if (c && c.color === want.color && (c.tier ?? 1) >= want.tier && (best < 0 || (c.tier ?? 1) < (cells[best].tier ?? 1))) best = i;
  });
  return best;
}

function countdownText(state) {
  const { ctx } = S;
  const b = state.orders;
  if ((b.open?.length ?? 0) >= ctx.sim.orders.MAX_OPEN) return 'The board is full';
  const ms = (b.nextRefreshAt ?? 0) - ctx.game.now();
  return ms > 0 ? `Next order in ${ctx.format.countdown(ms)}` : 'A new order is on its way';
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function payRange(base, lo = 0.7, hi = 1.5) {
  const { ctx } = S;
  return h`<span class="or-pay">${iconSvg('coin', { size: 14 })}<span>Pays ${ctx.format.num(base * lo)} to ${ctx.format.num(base * hi)}</span></span>`;
}

function matchCard(o, coach) {
  const base = payBase(S.ctx, o);
  return h`<div class="card or-card is-tap" data-action="open-match" data-order="${o.id}" data-tap role="button" tabindex="0"${coach ? h` data-coach="first-order"` : ''} aria-label="Order from ${o.customer}, match this color">
<div class="or-main">
<span class="or-sw" style="background:${safeHex(o.target)}" aria-hidden="true"></span>
<div class="grow stack stack-sm"><div class="or-name ellipsis">${o.customer}</div><div class="small muted">Match this color</div>${payRange(base)}</div>
<span class="or-go">${iconSvg('back', { size: 20 })}</span>
</div>
</div>`;
}

function anyCard(o, coach) {
  const { ctx } = S;
  const state = stateOf();
  const open = S.anyOpen === o.id;
  const base = payBase(ctx, o);
  const sim = ctx.sim;
  const bonus = sim.orders.ANY_TIER_BONUS;
  const colors = sim.discoveredColors(state)
    .map((c) => ({ ...c, pct: sim.orders.ANY_MULT * (bonus[sim.colorTier(c.id)] ?? 1) }))
    .sort((a, b) => b.pct - a.pct || (a.name < b.name ? -1 : 1));
  const hi = colors.length ? colors[0].pct : sim.orders.ANY_MULT;
  const lo = colors.length ? colors[colors.length - 1].pct : sim.orders.ANY_MULT;
  const picked = colors.find((c) => c.id === S.pick[o.id]) ?? null;
  return h`<div class="card or-card" data-order-card="${o.id}"${coach ? h` data-coach="first-order"` : ''}>
<div class="or-main is-tap" data-action="toggle-any" data-order="${o.id}" data-tap role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}" aria-label="Anything you love, from ${o.customer}">
<span class="or-sw any" aria-hidden="true">${iconSvg('star', { size: 34 })}</span>
<div class="grow stack stack-sm"><div class="or-name ellipsis">Anything you love</div><div class="small muted">${o.customer} will pay extra for a color you are proud of.</div>${payRange(base, lo, hi)}</div>
<span class="or-go" style="${open ? 'transform:rotate(90deg)' : ''}">${iconSvg('back', { size: 20 })}</span>
</div>
${open ? h`<div class="small muted">Rarer colors pay more. Pick one to offer.</div>
<div class="or-pick" data-keepscroll="pick-${o.id}">${colors.map((c) => h`<button type="button" class="or-opt${picked && picked.id === c.id ? ' is-sel' : ''}" data-action="pick-color" data-order="${o.id}" data-color="${c.id}" data-tap aria-pressed="${picked && picked.id === c.id ? 'true' : 'false'}">${swatch(c.hex, 40)}<span class="nm">${c.name}</span><span class="py">${ctx.format.num(base * c.pct)}</span></button>`)}</div>
${picked ? button(h`Offer ${picked.name} for ${ctx.format.num(base * picked.pct)}`, { variant: 'primary', block: true, attrs: { 'data-action': 'offer-any', 'data-order': o.id } }) : h`<div class="or-lock small muted">Tap a color to see what it pays.</div>`}` : ''}
</div>`;
}

function containerCard(o, coach) {
  const { ctx } = S;
  const state = stateOf();
  const want = o.container;
  const tierName = CONTAINER_NAMES[want.tier] || 'Container';
  const colorName = ctx.sim.displayName(state, want.color);
  const hex = ctx.sim.colorDef(want.color)?.hex ?? o.target;
  const cellIdx = containerCell(state, want);
  const cell = cellIdx >= 0 ? state.shelf.cells[cellIdx] : null;
  const base = payBase(ctx, o);
  const tv = ctx.sim.shelf.tierValue;
  const pct = cell ? 1 + 0.5 * want.tier * (tv(cell.tier) / tv(want.tier)) : 1 + 0.5 * want.tier;
  return h`<div class="card or-card"${coach ? h` data-coach="first-order"` : ''} data-order-card="${o.id}">
<div class="or-main">
<span class="or-cont">${containerSvg(want.tier, hex, { size: 44, label: colorName })}</span>
<div class="grow stack stack-sm"><div class="or-name">${o.customer} would like ${article(tierName)} ${tierName} of ${colorName}</div>
<div class="or-pay">${iconSvg('coin', { size: 14 })}<span>Pays about ${ctx.format.num(base * pct)}</span></div></div>
</div>
${cell
    ? h`<div class="or-done">${iconSvg('check', { size: 16 })}You have one on the shelf</div>${button('Deliver it', { variant: 'primary', block: true, attrs: { 'data-action': 'deliver-container', 'data-order': o.id, 'data-cell': cellIdx } })}`
    : h`<div class="row between wrap">${tag(`Merge ${article(tierName)} ${tierName} of ${colorName}`, { icon: 'pin' })}${button('Open the shelf', { small: true, attrs: { 'data-action': 'go-shelf' } })}</div>`}
</div>`;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function boardHtml(state) {
  const { ctx } = S;
  const open = state.orders?.open ?? [];
  const bonus = handBonus();
  const rep = Math.max(0, Math.floor(state.orders?.reputation ?? 0));
  const commCount = state.commissions?.open?.length ?? 0;
  const unlockedComm = (state.phase ?? 1) >= 3;
  return h`<div class="or-chips"><span class="or-rep">${iconSvg('star', { size: 22 })}${rep}<small>${rep === 1 ? 'star' : 'stars'} of reputation</small></span></div>
<div class="small muted" data-countdown></div>
${bonus > 1 ? h`<div class="card or-badge">${iconSvg('coin', { size: 22 })}<span>Fleet is busy: +${Math.round((bonus - 1) * 100)}% for hand delivery</span></div>` : ''}
<div class="or-actions">
${unlockedComm
    ? button(commCount ? `Commissions (${commCount})` : 'Commissions', { attrs: { 'data-action': 'commissions' } })
    : h`<div class="card tight or-lock">${tag('Opens in Phase 3', { icon: 'lock' })}</div>`}
${button('Mixing bench', { attrs: { 'data-action': 'bench' } })}
</div>
${open.length
    ? open.map((o, i) => (o.kind === 'any' ? anyCard(o, i === 0) : o.kind === 'container' && o.container ? containerCard(o, i === 0) : matchCard(o, i === 0)))
    : h`<div class="card or-empty"><div class="h2">The board is clear</div><p class="muted">New orders arrive over time. Meanwhile, the bench is free.</p></div>`}
${state.apprentices?.orderClerk ? h`<div class="card tight"><div class="small"><span class="semi">Order Clerk:</span> fills simple orders from your stock at ${Math.round(ctx.sim.orders.CLERK_PAYOUT * 100)}% pay.</div></div>` : ''}`;
}

function paint(force = false) {
  const { body } = S;
  if (!body) return;
  const state = stateOf();
  const html = String(boardHtml(state));
  if (!force && html === S.html) return;
  if (S.down) { S.dirty = true; return; }
  S.html = html;
  const top = body.scrollTop;
  const keep = {};
  body.querySelectorAll('[data-keepscroll]').forEach((n) => { keep[n.getAttribute('data-keepscroll')] = n.scrollTop; });
  body.innerHTML = html;
  body.scrollTop = top;
  tickCountdown();
  body.querySelectorAll('[data-keepscroll]').forEach((n) => {
    const v = keep[n.getAttribute('data-keepscroll')];
    if (v) n.scrollTop = v;
  });
}

function tickCountdown() {
  const el = S.body && S.body.querySelector('[data-countdown]');
  if (el) el.textContent = countdownText(stateOf());
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function celebrate(fromEl, res, order, text) {
  const { ctx } = S;
  ctx.audio.coins(6);
  ctx.haptics.ripple(3);
  ctx.fx.confetti(['#E2B04A', '#C99A2E', order.target || '#B8433A'], fromEl, { count: 18 });
  ctx.toast(`${text} +${ctx.format.num(res.coins)}`, { hex: '#E2B04A' });
}

function offerAny(orderId, fromEl) {
  const { ctx } = S;
  const colorId = S.pick[orderId];
  const order = (stateOf().orders?.open ?? []).find((o) => o.id === orderId);
  if (!colorId || !order) return;
  const name = ctx.sim.displayName(stateOf(), colorId);
  const res = ctx.game.act(ctx.sim.orders.submitOrder, { orderId, colorId });
  if (res && res.ok) {
    delete S.pick[orderId];
    if (S.anyOpen === orderId) S.anyOpen = null;
    celebrate(fromEl, res, order, `${order.customer} loves your ${name}!`);
  } else {
    ctx.toast('That order is no longer on the board');
  }
  paint(true);
}

function deliverContainer(orderId, cell, fromEl) {
  const { ctx } = S;
  const order = (stateOf().orders?.open ?? []).find((o) => o.id === orderId);
  if (!order) return;
  const res = ctx.game.act(ctx.sim.orders.submitOrder, { orderId, cell: Number(cell) });
  if (res && res.ok) celebrate(fromEl, res, order, `${order.customer} is delighted!`);
  else ctx.toast('That container is not on the shelf anymore');
  paint(true);
}

export default {
  id: 'orders',

  mount(root, ctx) {
    S.ctx = ctx;
    S.root = root;
    injectStyles('orders', CSS);
    root.innerHTML = String(h`<div class="screen-head is-left"><div class="titles"><div class="title">Orders</div><div class="subtitle">Customers wait as long as it takes</div></div></div><div class="screen-body pad-bottom-tab" data-body></div>`);
    S.body = root.querySelector('[data-body]');
    const release = () => {
      if (!S.down) return;
      S.down = false;
      if (S.dirty) { S.dirty = false; setTimeout(() => paint(true), 60); }
    };
    root.addEventListener('pointerdown', () => { S.down = true; }, { passive: true });
    root.addEventListener('pointerup', release, { passive: true });
    root.addEventListener('pointercancel', release, { passive: true });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t) || t.disabled) return;
      const order = t.getAttribute('data-order');
      switch (t.getAttribute('data-action')) {
        case 'open-match': ctx.navigate('matching', { orderId: order }); break;
        case 'toggle-any': S.anyOpen = S.anyOpen === order ? null : order; paint(true); break;
        case 'pick-color': S.pick[order] = t.getAttribute('data-color'); paint(true); break;
        case 'offer-any': offerAny(order, t.closest('.card') || t); break;
        case 'deliver-container': deliverContainer(order, t.getAttribute('data-cell'), t.closest('.card') || t); break;
        case 'go-shelf': ctx.navigate('shelf'); break;
        case 'commissions': ctx.navigate('commissions'); break;
        case 'bench': ctx.navigate('bench'); break;
        default: break;
      }
    });
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
        e.preventDefault();
        e.target.click();
      }
    });
  },

  show() {
    S.down = false;
    S.dirty = false;
    S.bonusAt = -Infinity;
    paint(true);
    clearInterval(S.timer);
    S.timer = setInterval(tickCountdown, 1000);
  },

  hide() {
    clearInterval(S.timer);
    S.timer = 0;
  },

  render() {
    paint();
  },
};
