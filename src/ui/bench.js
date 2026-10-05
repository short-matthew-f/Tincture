/**
 * bench.js: the Mixing bench overlay (screen id `bench`).
 *
 * Implements DESIGN.md "Discovery and the catalog > Mixing bench": a free
 * experiment table. Drop any pigments together, see a large result swatch,
 * and when the mix lands within DeltaE 4 of an undiscovered cell, "Mix it"
 * discovers it (sim.discovery.mixAtBench). Nearby undiscovered cells shimmer
 * as faint ghost swatches with their page hint, so experimenting never feels
 * blind. A small "Sell surplus" panel sells stock at base price
 * (sim.factory.sellStock). Shares the drop UI with matching.js.
 *
 * data-action names: `drop` (data-drop = pigment id), `undo`, `reset`, `mix`,
 * `sell` (data-color, data-jars = number | 'all'), `sell-more`.
 * Coach targets: data-coach="bench" on the jar card, "bench-drops" on the drop
 * chips, "bench-hint" on the shimmer hint card (the `bench` guide).
 */

import { h, iconSvg, button, backButton, safeHex } from './kit.js';
import { Mixer, chipsHtml, injectStyles, coinsWord, offerWhatsNext, SHARED_CSS, MIX_CSS } from './matching.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';

const PAGE_LABEL = Object.freeze({ wheel: 'Wheel', tints: 'Tints', shades: 'Shades', earths: 'Earths', wild: 'Wild' });
const NEAR_DE = 4;
const SELL_ROWS = 5;

const BENCH_CSS = `
.bn-top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bn-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bn-col .cap { font-size: 13px; font-weight: 600; }
.bn-jarbox { height: 168px; display: flex; align-items: flex-end; justify-content: center; }
.bn-swatch { height: 168px; border-radius: 14px; box-shadow: 0 3px 0 rgba(42,38,34,0.28); display: flex; align-items: flex-end; justify-content: flex-start; padding: 10px; transition: background-color 300ms var(--ease-out); }
.bn-swatch.is-empty { background: transparent !important; box-shadow: inset 0 0 0 2px var(--plaster-line); color: var(--ink-soft); font-size: 13px; align-items: center; justify-content: center; text-align: center; }
.bn-recipe { font-size: 14px; min-height: 20px; }
.bn-ghosts { display: flex; flex-direction: column; gap: 8px; }
.bn-ghost { display: flex; align-items: center; gap: 12px; }
.bn-ghost .gsw { width: 40px; height: 40px; border-radius: 10px; flex: 0 0 auto; box-shadow: inset 0 0 0 2px rgba(42,38,34,0.22); animation: bn-shim 2.6s ease-in-out infinite; }
.bn-ghost .gtx { font-size: 14px; }
.bn-ghost .gsub { font-size: 12px; color: var(--ink-soft); }
.bn-hint-h { font-family: var(--font-ui); font-weight: 700; font-size: 15px; }
.bn-explain { font-size: 13px; color: var(--ink-soft); line-height: 1.35; }
.bn-note { font-size: 13px; font-weight: 600; }
.bn-sell .nm { font-family: var(--font-display); font-size: 15px; }
.bn-sell .sub { font-size: 12px; color: var(--ink-soft); }
.bn-sell .btn { min-width: 44px; padding: 0 12px; font-size: 14px; }
.bn-sell { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 52px; }
.bn-sell + .bn-sell { border-top: 1px solid rgba(42,38,34,0.08); padding-top: 6px; }
.bn-sell .btns { display: flex; gap: 6px; }
.btn.is-ready { box-shadow: 0 0 0 2px var(--glow-ring), 0 0 12px 2px rgba(185,131,28,0.4), 0 3px 0 #000; }
@keyframes bn-shim { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.7; } }
`;

const S = {
  ctx: null,
  root: null,
  mixer: null,
  sellSig: '',
  known: -1,
  sellAll: false,
  note: '',
  down: false,
  dirty: false,
  timers: [],
  guide: null,
  offer: null,
  near: false, // a hidden color is within reach of the current blend (the guide's second step)
};

const stateOf = () => S.ctx.game.state;
const later = (fn, ms) => { S.timers.push(setTimeout(fn, ms)); };

function build() {
  const { ctx, root } = S;
  root.innerHTML = String(h`<div class="screen-head oq-head">${backButton('Back')}<div class="titles"><div class="title">Mixing bench</div>${howThisWorksHtml('bench')}</div><span class="spacer"></span></div>
<div class="screen-body">
<div class="card" data-coach="bench">
<div class="small muted">Drop pigments together and see what they make. Nothing is spent here, so experiment freely.</div>
<div class="bn-top">
<div class="bn-col"><div class="bn-jarbox" data-jar-slot></div><div class="cap">The jar</div></div>
<div class="bn-col"><div class="bn-swatch is-empty" data-result role="img" aria-label="Result">Tap a drop to start</div><div class="cap" data-result-cap>The result</div></div>
</div>
<div class="bn-recipe" data-recipe></div>
</div>
${chipsHtml('bench-drops')}
<div class="card" data-hints data-coach="bench-hint" hidden></div>
<div class="card" data-sell></div>
</div>
<div class="mx-actions">
${button('Undo', { attrs: { 'data-action': 'undo', hidden: true } })}
${button('Reset jar', { attrs: { 'data-action': 'reset', hidden: true } })}
${button('Mix it', { variant: 'primary', cls: 'grow', attrs: { 'data-action': 'mix' } })}
</div>`);
  S.note = '';
  S.mixer = new Mixer(ctx, root, { onChange: () => { S.note = ''; update(); } });
  S.mixer.setPigments(ctx.sim.discovery.availablePigments(stateOf()));
  S.sellSig = '';
  S.known = ctx.sim.discoveredCount(stateOf());
  S.near = false;
  update();
  renderSell(true);
  startGuide();
}

/** First-open guide: drops, then the shimmer card once something is within reach (Theme D). */
function startGuide() {
  stopGuide();
  const { ctx } = S;
  if (typeof ctx.guide !== 'function') return;
  S.guide = ctx.guide('bench', [
    { anchor: '[data-coach="bench-drops"]', text: 'Mix anything. Nearby colors shimmer', endsOn: 'action', done: () => !!S.mixer && S.mixer.size > 0, side: 'below' },
    { anchor: '[data-coach="bench-hint"]', text: 'Within reach: tap Mix it to discover', endsOn: 'got-it', when: () => S.near && !!S.mixer && S.mixer.size > 0, side: 'below' },
  ], { screen: 'bench' });
  later(() => { if (S.guide) S.guide.start(); }, 300);
}

function stopGuide() {
  if (S.guide) { try { S.guide.stop(); } catch (e) { /* ignore */ } S.guide = null; }
  if (S.offer) { S.offer.stop(); S.offer = null; }
}

// ---------------------------------------------------------------------------
// The jar side: result swatch, recipe text, shimmer hints, Mix it
// ---------------------------------------------------------------------------

function nearestKnown(hex) {
  const { ctx } = S;
  let best = null;
  for (const c of ctx.sim.discoveredColors(stateOf())) {
    const de = ctx.color.deltaEHex(hex, c.hex);
    if (de <= NEAR_DE && (!best || de < best.de)) best = { name: ctx.sim.displayName(stateOf(), c.id), de };
  }
  return best;
}

function pageHint(id) {
  const c = S.ctx.sim.colorDef(id);
  if (c && c.page && PAGE_LABEL[c.page]) return `Something on the ${PAGE_LABEL[c.page]} page`;
  if (c && c.event) return "Something on this week's event page";
  return 'Something in your catalog';
}

function update() {
  const { ctx, root, mixer } = S;
  if (!mixer) return;
  const hex = mixer.hex;
  const state = stateOf();
  const res = root.querySelector('[data-result]');
  const cap = root.querySelector('[data-result-cap]');
  const has = mixer.size > 0;
  if (hex) {
    res.classList.remove('is-empty');
    res.style.background = safeHex(hex);
    res.textContent = '';
    const known = nearestKnown(hex);
    cap.textContent = known ? `Like your ${known.name}` : 'The result';
  } else {
    res.classList.add('is-empty');
    res.style.background = '';
    res.textContent = 'Tap a drop to start';
    cap.textContent = 'The result';
  }
  root.querySelector('[data-recipe]').textContent = has ? `Recipe: ${mixer.recipeText()}` : '';

  // Shimmer hints: up to three faint ghosts of colors that are close by, with the page they live on.
  const hintsBox = root.querySelector('[data-hints]');
  const hints = hex ? ctx.sim.discovery.shimmerHints(state, hex) : [];
  const wasNear = S.near;
  S.near = hints.some((g) => g.de <= NEAR_DE);
  // On a short phone the hint card sits below the fold: bring it up for the guide's second step.
  if (S.near && !wasNear && S.guide && S.guide.active && S.guide.step === 1) {
    later(() => { try { hintsBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 80);
  }
  if (hints.length) {
    hintsBox.hidden = false;
    hintsBox.innerHTML = String(h`<div class="bn-hint-h">Something is shimmering nearby</div><div class="bn-ghosts">${hints.map((g) => {
      const o = (0.3 + 0.45 * (1 - Math.min(1, g.de / 12))).toFixed(2);
      return h`<div class="bn-ghost"><span class="gsw" style="background:${safeHex(g.hex)};opacity:${o}"></span><div><div class="gtx">${pageHint(g.id)}</div><div class="gsub">${g.de <= NEAR_DE ? 'So close! Mix it to find it.' : 'Keep experimenting.'}</div></div></div>`;
    })}</div>
<div class="bn-explain">Mix it checks this blend against the colors still to find, and adds one to your catalog when it lands on it.</div>${S.note ? h`<div class="bn-note">${S.note}</div>` : ''}`);
  } else if (has) {
    hintsBox.hidden = false;
    hintsBox.innerHTML = String(h`<div class="bn-hint-h">Nothing is shimmering yet</div>
<div class="bn-explain">Mix it checks this blend against the colors still to find, and adds one to your catalog when it lands on it. This one is not near any yet, so try another blend.</div>${S.note ? h`<div class="bn-note">${S.note}</div>` : ''}`);
  } else {
    hintsBox.hidden = true;
    hintsBox.innerHTML = '';
  }

  const near = hex ? ctx.sim.discovery.undiscoveredNear(state, hex, NEAR_DE, { method: 'bench' }) : null;
  const mixBtn = root.querySelector('[data-action="mix"]');
  mixBtn.disabled = !has;
  mixBtn.classList.toggle('is-ready', !!near);
  for (const a of ['undo', 'reset']) {
    const b = root.querySelector(`[data-action="${a}"]`);
    b.disabled = !has;
    b.hidden = !has;
  }
}

function mixIt() {
  const { ctx, mixer, root } = S;
  if (!mixer || !mixer.size) return;
  const parts = mixer.drops().map((d) => ({ id: d.id, hex: d.hex, weight: d.count }));
  const res = ctx.game.act(ctx.sim.discovery.mixAtBench, { parts });
  if (!res || !res.hex) return;
  const swatchEl = root.querySelector('[data-result]');
  if (res.discovered) {
    // The app's naming ceremony takes over; clear the table for the next idea.
    ctx.haptics.success();
    ctx.fx.ringBurst(swatchEl, res.hex);
    later(() => { mixer.reset(); }, 400);
    // She has found one: the coach is done, and two ways on wait until the naming is over.
    if (!stateOf().onboarding?.seen?.bench) ctx.game.act(markGuideSeen, { id: 'bench' });
    if (S.offer) S.offer.stop();
    const found = res.discovered.colorId;
    S.offer = offerWhatsNext(ctx, {
      screen: 'bench',
      id: 'benchNext',
      delay: 1200,
      tries: 400,
      title: 'A new color is yours',
      body: 'Your bench found it. It is already in the catalog.',
      more: 'Mix another',
      next: { label: 'Name it in your catalog', run: () => ctx.navigate('catalog', found ? { colorId: found } : {}) },
    });
  } else {
    ctx.haptics.light();
    ctx.fx.pulse(swatchEl, true);
    later(() => ctx.fx.pulse(swatchEl, false), 900);
    ctx.audio.tick('select');
    S.note = res.hints && res.hints.length ? 'A lovely mix. Something shimmers nearby.' : 'A lovely mix. Nothing new this time, keep experimenting!';
    update();
  }
}

// ---------------------------------------------------------------------------
// Sell surplus
// ---------------------------------------------------------------------------

function sellRows() {
  const { ctx } = S;
  const state = stateOf();
  const mult = ctx.sim.incomeMultiplier(state, ctx.game.now());
  return Object.entries(state.stock ?? {})
    .map(([id, e]) => ({ id, jars: Math.floor((e?.jars ?? 0) + 1e-9), price: ctx.sim.colorPrice(state, id, 'standard') * mult }))
    .filter((r) => r.jars >= 1)
    .sort((a, b) => b.jars - a.jars || (a.id < b.id ? -1 : 1));
}

function renderSell(force = false) {
  const { ctx, root } = S;
  const box = root && root.querySelector('[data-sell]');
  if (!box) return;
  const rows = sellRows();
  const sig = `${S.sellAll}|${rows.map((r) => `${r.id}:${r.jars}:${Math.round(r.price)}`).join(',')}`;
  if (!force && sig === S.sellSig) return;
  if (S.down) { S.dirty = true; return; }
  S.sellSig = sig;
  const state = stateOf();
  const shown = S.sellAll ? rows : rows.slice(0, SELL_ROWS);
  const coin = iconSvg('coin', { size: 14 });
  box.innerHTML = String(h`<div class="row between wrap"><div class="oq-h sm">Sell surplus</div><div class="small muted">Base price, straight from the shelf</div></div>
${rows.length ? '' : h`<div class="small muted">No jars in stock yet. Jars the workshop makes will show up here.</div>`}
${shown.map((r) => {
    const name = ctx.sim.displayName(state, r.id);
    const hex = ctx.sim.colorDef(r.id)?.hex;
    return h`<div class="bn-sell">
<span class="swatch" aria-hidden="true" style="--size:36px;background:${safeHex(hex)}"></span>
<div class="stack-sm" style="min-width:0"><div class="nm ellipsis">${name}</div><div class="sub num">${ctx.format.num(r.jars)} ${r.jars === 1 ? 'jar' : 'jars'} · ${coin} ${ctx.format.num(r.price)} each</div></div>
<div class="btns">${button('Sell 1', { cls: 'oq-btn', attrs: { 'data-action': 'sell', 'data-color': r.id, 'data-jars': '1', 'aria-label': `Sell 1 jar of ${name}` } })}${r.jars > 1 ? button('All', { cls: 'oq-btn', attrs: { 'data-action': 'sell', 'data-color': r.id, 'data-jars': 'all', 'aria-label': `Sell all ${name}` } }) : ''}</div>
</div>`;
  })}
${rows.length > SELL_ROWS ? button(S.sellAll ? 'Show fewer' : `Show all ${rows.length}`, { cls: 'oq-btn', attrs: { 'data-action': 'sell-more' } }) : ''}`);
}

async function sell(colorId, jarsAttr) {
  const { ctx } = S;
  const have = Math.floor((stateOf().stock?.[colorId]?.jars ?? 0) + 1e-9);
  const jars = jarsAttr === 'all' ? have : Math.min(have, Math.max(1, Number(jarsAttr) || 1));
  if (jars < 1) return;
  if (jarsAttr === 'all' && jars > 1) {
    // Selling a whole stock is a one-way door: ask first, kindly.
    const state = stateOf();
    const price = ctx.sim.colorPrice(state, colorId, 'standard') * ctx.sim.incomeMultiplier(state, ctx.game.now());
    const name = ctx.sim.displayName(state, colorId);
    const ok = await ctx.modal({
      title: `Sell all ${ctx.format.num(jars)} jars of ${name}?`,
      body: `That sells every jar at base price for about ${coinsWord(ctx, price * jars)}.`,
      actions: [{ label: 'Keep them', value: false }, { label: 'Sell them all', variant: 'primary', value: true }],
    });
    if (ok !== true) return;
  }
  const now = Math.floor((stateOf().stock?.[colorId]?.jars ?? 0) + 1e-9);
  const r = ctx.game.act(ctx.sim.factory.sellStock, { colorId, jars: Math.min(jars, now) });
  if (r && r.jars > 0) {
    ctx.audio.coins(Math.min(8, 3 + r.jars));
    ctx.haptics.ripple(3);
    ctx.toast(`Sold ${ctx.format.num(r.jars)} ${r.jars === 1 ? 'jar' : 'jars'} for ${coinsWord(ctx, r.coins)}`, { hex: ctx.sim.colorDef(colorId)?.hex });
  }
  renderSell(true);
}

export default {
  id: 'bench',

  mount(root, ctx) {
    S.root = root;
    S.ctx = ctx;
    injectStyles('oq-shared', SHARED_CSS);
    injectStyles('mix', MIX_CSS);
    injectStyles('bench', BENCH_CSS);
    const release = () => {
      if (!S.down) return;
      S.down = false;
      if (S.dirty) { S.dirty = false; later(() => renderSell(true), 60); }
    };
    root.addEventListener('pointerdown', () => { S.down = true; }, { passive: true });
    root.addEventListener('pointerup', release, { passive: true });
    root.addEventListener('pointercancel', release, { passive: true });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t) || t.disabled) return;
      switch (t.getAttribute('data-action')) {
        case 'drop': S.mixer?.add(t.getAttribute('data-drop')); break;
        case 'undo': S.mixer?.undo(); break;
        case 'reset': S.mixer?.reset(); break;
        case 'mix': mixIt(); break;
        case 'sell': sell(t.getAttribute('data-color'), t.getAttribute('data-jars')); break;
        case 'sell-more': S.sellAll = !S.sellAll; renderSell(true); break;
        default: break;
      }
    });
  },

  show() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.sellAll = false;
    S.down = false;
    S.dirty = false;
    build();
  },

  hide() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    stopGuide();
  },

  render(state) {
    if (!S.mixer) return;
    S.mixer.setPigments(S.ctx.sim.discovery.availablePigments(state));
    // A new discovery changes the "like your ..." line and the hints.
    const n = S.ctx.sim.discoveredCount(state);
    if (n !== S.known) { S.known = n; update(); }
    renderSell();
  },
};
