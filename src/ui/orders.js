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
 * Coach targets: data-coach="first-order" on the first order card (the
 * first-ten-minutes script), data-coach="first-match" on the first match
 * order when it is not the first card (the `orders` guide).
 */

import { h, raw, iconSvg, button, swatch, safeHex, containerSvg, CONTAINER_NAMES } from './kit.js';
import {
  injectStyles, payBase, coinsWord, wishWords, customerName, aboutMinutes, repChip, commissionLock, orderVeteran, SHARED_CSS,
} from './matching.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';
import { bindTouchFeel, squashOnce } from './workshop.js';

const CSS = `
.or-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.or-badge { background: var(--glow); box-shadow: 0 0 0 2px var(--glow-ring), 0 2px 0 var(--shadow-soft); color: var(--glow-ink); font-weight: 600; font-size: 14px; flex-direction: row; align-items: center; gap: 10px; padding: 10px 14px; }
.or-thanks { flex-direction: row; align-items: center; gap: 12px; animation: screen-in 260ms var(--ease-out) both; }
.or-card .or-main { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 64px; }
.or-card .or-sw { width: 64px; height: 64px; border-radius: 12px; flex: 0 0 auto; box-shadow: 0 3px 0 rgba(42,38,34,0.28); }
.or-card .or-sw.any { background: linear-gradient(135deg, #F3D68A 0%, #E2B04A 55%, #C99A2E 100%); display: grid; place-items: center; }
.or-card .or-name { font-family: var(--font-display); font-size: 17px; line-height: 1.2; }
.or-card .or-name.plain { font-family: var(--font-ui); font-weight: 700; }
.or-card .or-pay { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--ink-soft); }
.or-card .or-go { flex: 0 0 auto; color: var(--ink-soft); }
.or-card .or-go svg { transform: rotate(180deg); }
.or-card .or-cont { flex: 0 0 auto; width: 64px; display: grid; place-items: center; }
.or-pick { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-height: 250px; overflow-y: auto; padding: 4px 2px 6px; -webkit-overflow-scrolling: touch; }
.or-opt { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 12px; background: var(--plaster); min-height: 88px; min-width: 0; }
.or-opt.is-sel { background: var(--paper); box-shadow: 0 0 0 3px var(--ink); }
.or-opt .nm { font-family: var(--font-display); font-size: 12px; line-height: 1.15; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.or-opt .py { font-size: 12px; color: var(--ink-soft); }
.or-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.or-actions.one { grid-template-columns: 1fr; }
.or-actions .btn { padding: 0 10px; }
.or-lock { display: flex; align-items: center; justify-content: center; min-height: var(--tap); }
.or-card .linkish { min-height: var(--tap); padding: 6px 12px; border: 0; background: none; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 3px; }
.or-empty { text-align: center; padding: 22px 16px; align-items: center; }
.or-card.is-tap:active, .or-main.is-tap:active { transform: none; box-shadow: var(--cut); }
.or-card.is-held { box-shadow: 0 6px 0 var(--shadow); }
.or-card, .or-opt, .or-main { touch-action: manipulation; }
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
  delivered: null, // {text, hex, coins}: the last any/container delivery, thanked inline
  guide: null,
  fresh: '', // what just changed and should land with motion on the next paint: 'thanks' | 'pick' | 'picker'
  startTimer: 0,
  opened: false,   // she tapped an order this visit (ends the guide's action step)
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
  const n = b.open?.length ?? 0;
  const waiting = n ? `${n} ${n === 1 ? 'order' : 'orders'} waiting` : 'The board is ready for new orders';
  if (n >= ctx.sim.orders.MAX_OPEN) return `${waiting}. Fill one to bring the next.`;
  const ms = (b.nextRefreshAt ?? 0) - ctx.game.now();
  return ms > 0 ? `${waiting}. Next one ${aboutMinutes(ms)}.` : `${waiting}. A new one is on its way.`;
}

const HEART = raw('<svg class="icon" width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 C5 15.2 3 12 3 8.8 A4.8 4.8 0 0 1 12 6.6 A4.8 4.8 0 0 1 21 8.8 C21 12 19 15.2 12 20.5 Z" fill="#FFF6DF" stroke="#8C6512" stroke-width="1.4" stroke-linejoin="round"/></svg>');

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function payUpTo(base, mult = 1.5) {
  const { ctx } = S;
  return h`<span class="or-pay">${iconSvg('coin', { size: 14 })}<span>Up to ${coinsWord(ctx, base * mult)}</span></span>`;
}

function matchCard(o, coach, firstMatch) {
  const { ctx } = S;
  const base = payBase(ctx, o);
  const who = customerName(ctx, o);
  return h`<div class="card or-card is-tap" data-lift="1.02" data-action="open-match" data-order="${o.id}" data-tap role="button" tabindex="0"${coach ? h` data-coach="first-order"` : firstMatch ? h` data-coach="first-match"` : ''} aria-label="Order from ${who}, would like ${wishWords(ctx, o.target)}">
<div class="or-main">
<span class="or-sw" style="background:${safeHex(o.target)}" aria-hidden="true"></span>
<div class="grow stack stack-sm"><div class="or-name ellipsis">${who}</div><div class="small muted">Would like ${wishWords(ctx, o.target)}</div>${payUpTo(base)}</div>
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
  const who = customerName(ctx, o);
  const picked = colors.find((c) => c.id === S.pick[o.id]) ?? null;
  return h`<div class="card or-card" data-order-card="${o.id}"${coach ? h` data-coach="first-order"` : ''}>
<div class="or-main is-tap" data-lift="1.02" data-action="toggle-any" data-order="${o.id}" data-tap role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}" aria-label="Anything you love, from ${who}">
<span class="or-sw any" aria-hidden="true">${HEART}</span>
<div class="grow stack stack-sm"><div class="or-name plain ellipsis">Anything you love</div><div class="small muted"><span class="serif">${who}</span> will pay extra for a color you are proud of.</div>${payUpTo(base, hi)}</div>
<span class="or-go" style="${open ? 'transform:rotate(90deg)' : ''}">${iconSvg('back', { size: 20 })}</span>
</div>
${open ? h`<div class="small muted">Rarer colors pay more. Pick one to offer.</div>
<div class="or-pick" data-keepscroll="pick-${o.id}">${colors.map((c) => h`<button type="button" class="or-opt${picked && picked.id === c.id ? ' is-sel' : ''}" data-action="pick-color" data-order="${o.id}" data-color="${c.id}" data-tap aria-pressed="${picked && picked.id === c.id ? 'true' : 'false'}">${swatch(c.hex, 40)}<span class="nm">${c.name}</span><span class="py">${coinsWord(ctx, base * c.pct)}</span></button>`)}</div>
${picked ? button(h`Offer ${picked.name} for ${coinsWord(ctx, base * picked.pct)}`, { variant: 'primary', block: true, attrs: { 'data-action': 'offer-any', 'data-order': o.id } }) : h`<div class="or-lock small muted">Tap a color to see what it pays.</div>`}` : ''}
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
<div class="grow stack stack-sm"><div class="or-name">${customerName(ctx, o)} would like ${article(tierName)} ${tierName} of ${colorName}</div>
<div class="or-pay">${iconSvg('coin', { size: 14 })}<span>Pays about ${coinsWord(ctx, base * pct)}</span></div></div>
</div>
${cell
    ? h`<div class="or-done">${iconSvg('check', { size: 16 })}You have one on the shelf</div>${button('Deliver it', { variant: 'primary', block: true, attrs: { 'data-action': 'deliver-container', 'data-order': o.id, 'data-cell': cellIdx } })}`
    : containerHelp(o, want, tierName, colorName)}
</div>`;
}

/**
 * What to do when the container is not on the shelf yet: add the color to the
 * shelf's chips if its vials are not arriving, else merge; and a quiet way to
 * pass the order on to another shop (orders never expire on their own).
 */
function containerHelp(o, want, tierName, colorName) {
  const { ctx } = S;
  const state = stateOf();
  const chips = ctx.sim.shelf.shelfColors(state);
  const onShelf = chips.includes(want.color);
  const lower = CONTAINER_NAMES[want.tier - 1] ? CONTAINER_NAMES[want.tier - 1].toLowerCase() : 'vial';
  const how = onShelf
    ? h`<div class="row between wrap"><span class="oq-req">${iconSvg('pin', { size: 12 })}Merge two ${colorName} ${lower}s into ${article(tierName)} ${tierName}</span>${button('Open the shelf', { cls: 'oq-btn', attrs: { 'data-action': 'go-shelf' } })}</div>`
    : h`<div class="row between wrap"><span class="oq-req">${iconSvg('pin', { size: 12 })}${colorName} vials are not coming to the shelf yet</span>${button(h`Add ${colorName} to the shelf`, { cls: 'oq-btn', attrs: { 'data-action': 'shelf-color', 'data-order': o.id, 'data-color': want.color } })}</div>`;
  return h`${how}<div class="or-lock small"><button type="button" class="linkish" data-tap data-action="pass-order" data-order="${o.id}">Pass this one on to another shop</button></div>`;
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
  const lock = commissionLock(ctx, state);
  const th = S.delivered;
  const firstMatch = open.findIndex((o) => o.kind !== 'any' && !(o.kind === 'container' && o.container));
  return h`<div class="or-chips">${rep >= 1 ? repChip(rep) : h`<span class="small muted">Earn a reputation star with a Perfect match</span>`}</div>
<div class="small muted" data-countdown></div>
${th ? h`<div class="card or-thanks" data-thanks>${swatch(th.hex, 44)}<div class="grow"><div class="semi">${th.text}</div><div class="small muted">Paid <span data-paid>${th.coins}</span></div></div></div>` : ''}
${bonus > 1 ? h`<div class="card or-badge">${iconSvg('coin', { size: 22 })}<span>Fleet is busy: +${Math.round((bonus - 1) * 100)}% for hand delivery</span></div>` : ''}
<div class="or-actions${lock ? ' one' : ''}">
${lock ? '' : button(commCount ? `Commissions (${commCount})` : 'Commissions', { attrs: { 'data-action': 'commissions' } })}
${button('Mixing bench', { attrs: { 'data-action': 'bench' } })}
</div>
${lock ? h`<div class="oq-lockrow" data-lock>${lock.tag}${lock.more ? h`<span class="more">${lock.more}</span>` : ''}</div>` : ''}
${open.length
    ? open.map((o, i) => (o.kind === 'any' ? anyCard(o, i === 0) : o.kind === 'container' && o.container ? containerCard(o, i === 0) : matchCard(o, i === 0, i === firstMatch)))
    : h`<div class="card or-empty"><div class="oq-h">Every order is filled</div><p class="muted">New orders arrive over time. Meanwhile, the bench is free.</p></div>`}
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
  landFresh();
}

/** Motion for what just changed (the paint replaced the DOM, so the effect runs on the new nodes). */
function landFresh() {
  const { ctx, body } = S;
  const what = S.fresh;
  S.fresh = '';
  if (!what || !body) return;
  const fx = ctx.fx;
  if (what === 'thanks') {
    const card = body.querySelector('[data-thanks]');
    if (!card) return;
    fx.spring(card, { from: { transform: 'translateY(-14px) scale(0.96)', opacity: 0 }, to: { transform: 'translateY(0px) scale(1)', opacity: 1 }, preset: 'soft' });
    const n = body.querySelector('[data-thanks] [data-paid]');
    if (n && S.delivered && S.delivered.amount > 0) fx.rollNumber(n, 0, S.delivered.amount, { ms: 600, format: (v) => coinsWord(ctx, v) });
  } else if (what === 'pick') {
    squashOnce(fx, body.querySelector('.or-opt.is-sel'));
  } else if (what === 'picker') {
    const pk = body.querySelector('.or-pick');
    if (pk) fx.spring(pk, { from: { transform: 'translateY(-8px)', opacity: 0 }, to: { transform: 'translateY(0px)', opacity: 1 }, preset: 'soft' });
  }
}

function tickCountdown() {
  const el = S.body && S.body.querySelector('[data-countdown]');
  if (el) el.textContent = countdownText(stateOf());
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function celebrate(fromEl, res, order, text, hex) {
  const { ctx } = S;
  ctx.audio.coins(6);
  ctx.haptics.ripple(3);
  ctx.fx.confetti(['#E2B04A', '#C99A2E', order.target || '#B8433A'], fromEl, { count: 18 });
  S.delivered = { text, hex: hex || order.target || '#E2B04A', coins: coinsWord(ctx, res.coins), amount: res.coins };
  S.fresh = 'thanks';
}

function offerAny(orderId, fromEl) {
  const { ctx } = S;
  const colorId = S.pick[orderId];
  const order = (stateOf().orders?.open ?? []).find((o) => o.id === orderId);
  if (!colorId || !order) return;
  const name = ctx.sim.displayName(stateOf(), colorId);
  const who = customerName(ctx, order);
  const hex = ctx.sim.colorDef(colorId)?.hex;
  const res = ctx.game.act(ctx.sim.orders.submitOrder, { orderId, colorId });
  if (res && res.ok) {
    delete S.pick[orderId];
    if (S.anyOpen === orderId) S.anyOpen = null;
    celebrate(fromEl, res, order, `${who} loves your ${name}!`, hex);
  } else {
    ctx.toast('That order is no longer on the board');
  }
  paint(true);
  if (S.body) S.body.scrollTop = 0;
}

/** Put a color on the shelf's chips (replacing the last one when all five are taken) and go there. */
function addShelfColor(colorId) {
  const { ctx } = S;
  const state = stateOf();
  const colors = [...ctx.sim.shelf.shelfColors(state)].filter((id) => id !== colorId);
  const max = ctx.sim.shelf.MAX_COLORS ?? 5;
  if (colors.length >= max) colors.length = max - 1;
  colors.push(colorId);
  const res = ctx.game.act(ctx.sim.shelf.setShelfColors, { colors });
  if (res && res.ok) ctx.toast(`New ${ctx.sim.displayName(state, colorId)} vials will come to the shelf`, { hex: ctx.sim.colorDef(colorId)?.hex });
  ctx.navigate('shelf');
}

/** Pass a container order on: it leaves the board and a fresh order takes its place. */
function passOrder(orderId) {
  const { ctx } = S;
  const order = (stateOf().orders?.open ?? []).find((o) => o.id === orderId);
  if (!order) return;
  const res = ctx.game.act(ctx.sim.orders.passOrder, { orderId });
  if (res && res.ok) ctx.toast(`${customerName(ctx, order)} will try another shop. A new order is up.`);
  paint(true);
}

function deliverContainer(orderId, cell, fromEl) {
  const { ctx } = S;
  const order = (stateOf().orders?.open ?? []).find((o) => o.id === orderId);
  if (!order) return;
  const who = customerName(ctx, order);
  const res = ctx.game.act(ctx.sim.orders.submitOrder, { orderId, cell: Number(cell) });
  if (res && res.ok) celebrate(fromEl, res, order, `${who} is delighted!`, order.target);
  else ctx.toast('That container is not on the shelf anymore');
  paint(true);
  if (S.body) S.body.scrollTop = 0;
}

/** First-open guide: tap the first match order (docs/PLAN-v0.2 Theme D). */
function startGuide() {
  stopGuide();
  const { ctx } = S;
  if (typeof ctx.guide !== 'function') return;
  const seen = stateOf().onboarding?.seen || {};
  if (!seen.orders && orderVeteran(stateOf())) { ctx.game.act(markGuideSeen, { id: 'orders' }); return; }
  S.guide = ctx.guide('orders', [
    { anchor: '[data-coach="first-match"], [data-coach="first-order"][data-action="open-match"]', text: 'Tap an order to mix its color', endsOn: 'action', done: () => S.opened, side: 'below' },
  ], { screen: 'orders' });
  S.startTimer = setTimeout(() => { if (S.guide) S.guide.start(); }, 300);
}

function stopGuide() {
  clearTimeout(S.startTimer);
  if (S.guide) { try { S.guide.stop(); } catch (e) { /* ignore */ } S.guide = null; }
}

export default {
  id: 'orders',

  mount(root, ctx) {
    S.ctx = ctx;
    S.root = root;
    injectStyles('oq-shared', SHARED_CSS);
    injectStyles('orders', CSS);
    bindTouchFeel(root, ctx.fx, { lift: '.or-card.is-tap, .or-main.is-tap, .or-opt' });
    root.innerHTML = String(h`<div class="screen-head is-left oq-head"><div class="titles"><div class="title">Orders</div><div class="subtitle">Customers wait as long as it takes</div>${howThisWorksHtml('orders')}</div></div><div class="screen-body pad-bottom-tab" data-body></div>`);
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
      if (e.target.closest('[data-guide-replay]')) S.opened = false; // "How this works" starts the guide over
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t) || t.disabled) return;
      const order = t.getAttribute('data-order');
      switch (t.getAttribute('data-action')) {
        case 'open-match':
          S.opened = true; // she has done what the guide asks; it ends before the screen hides
          if (!stateOf().onboarding?.seen?.orders) ctx.game.act(markGuideSeen, { id: 'orders' });
          ctx.navigate('matching', { orderId: order });
          break;
        case 'toggle-any': S.anyOpen = S.anyOpen === order ? null : order; S.fresh = S.anyOpen ? 'picker' : ''; paint(true); break;
        case 'pick-color': S.pick[order] = t.getAttribute('data-color'); S.fresh = 'pick'; paint(true); break;
        case 'offer-any': offerAny(order, t.closest('.card') || t); break;
        case 'deliver-container': deliverContainer(order, t.getAttribute('data-cell'), t.closest('.card') || t); break;
        case 'go-shelf': ctx.navigate('shelf'); break;
        case 'shelf-color': addShelfColor(t.getAttribute('data-color')); break;
        case 'pass-order': passOrder(order); break;
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
    S.opened = false;
    S.down = false;
    S.dirty = false;
    S.bonusAt = -Infinity;
    S.delivered = null;
    paint(true);
    clearInterval(S.timer);
    S.timer = setInterval(tickCountdown, 15000);
    startGuide();
  },

  hide() {
    clearInterval(S.timer);
    S.timer = 0;
    stopGuide();
  },

  render() {
    paint();
  },
};
