/**
 * heritage.js: Renovate and the Heritage tree (overlay `heritage`).
 *
 * Owns: the Renovate offer ("Renovate now: +14 Heritage (+70% income)") with
 * the 50% nudge from prestige.shouldSuggest, a plain list of what stays and
 * what starts fresh, a two-step confirm before prestige.renovate (the app
 * shows the phase-beat from the 'renovate' event), the Heritage balance and
 * the Heritage tree as cards (level pips, effect text, cost, buy). Implements
 * DESIGN.md "Progression, eras and prestige > Renovate (soft prestige)".
 *
 * data-actions: renovate-ask, renovate-cancel, renovate-go, buy.
 */

import { h, raw, backButton, button, tag } from './kit.js';
import { HERITAGE_TREE, HERITAGE_DIVISOR, HERITAGE_INCOME, heritageCost } from '../content/heritage.js';
import fxDefault from './fx.js';
import audioDefault from './audio.js';
import hapticsDefault from './haptics.js';

const GEM = '<svg class="icon" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L17 8 L10 18 L3 8 Z" fill="#C99A2E" stroke="#8C6512" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 8 H17 M7 8 L10 2 L13 8 L10 18 Z" fill="none" stroke="#8C6512" stroke-width="1" stroke-linejoin="round"/></svg>';
const CHECK = '<svg class="icon" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 L8.5 15 L16 6" fill="none" stroke="#2A2622" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FRESH = '<svg class="icon" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10 A6 6 0 1 1 13.5 5.1 M16 3.5 V6.5 H13" fill="none" stroke="#5E5148" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const STAYS = [
  'Your catalog and every Essence star',
  'Hunters, the map and what they found',
  'Postcards and the album',
  'Apprentices',
  'Heritage and its tree',
  'Paintings and the Gallery',
];
const RESETS = [
  'Stations and mixers',
  'Coins',
  'Rooms',
  'Jars in vats and containers on the shelf',
];

const CSS = `
#screen-heritage .screen-body > *{flex-shrink:0}
#screen-heritage .hr-big{font-family:var(--font-display);font-size:30px;line-height:1.1;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px}
#screen-heritage .hr-list{display:flex;flex-direction:column;gap:6px}
#screen-heritage .hr-li{display:flex;gap:8px;align-items:flex-start;font-size:14px}
#screen-heritage .hr-li .icon{margin-top:2px}
#screen-heritage .hr-fresh{color:var(--ink-soft)}
#screen-heritage .hr-pips{display:flex;gap:5px}
#screen-heritage .hr-pip{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(42,38,34,.35)}
#screen-heritage .hr-pip.on{background:#C99A2E;box-shadow:inset 0 0 0 1.5px #8C6512}
#screen-heritage .hr-nudge{background:#FFF6DF;box-shadow:0 0 0 2px #B9831C,0 2px 0 rgba(42,38,34,.18);border-radius:12px;padding:8px 12px;font-size:14px}
#screen-heritage .hr-confirm{background:#F2F4F0;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;box-shadow:inset 0 0 0 2px rgba(42,38,34,.12)}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('heritage-css')) return;
  const s = document.createElement('style');
  s.id = 'heritage-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let root = null;
let ctx = null;
let fx = fxDefault;
let audio = audioDefault;
let haptics = hapticsDefault;

const ui = { confirm: false, sig: '' };

const sim = () => ctx.sim;
const state = () => ctx.game.state;
const q = (sel) => root.querySelector(sel);

function effectLines(node, level) {
  const e = node.effect;
  const num = ctx.format.num;
  let per = '';
  let now = '';
  if (e.startCoins) {
    per = `Each level: +${num(e.startCoins)} Coins at the start of every run.`;
    now = level ? `Now: +${num(e.startCoins * level)} Coins each run.` : '';
  } else if (e.startVats) {
    per = `Each level: +${e.startVats} display ${e.startVats === 1 ? 'vat' : 'vats'} at the start of every run.`;
    now = level ? `Now: +${e.startVats * level} ${e.startVats * level === 1 ? 'vat' : 'vats'} each run.` : '';
  } else if (e.startMixers) {
    per = `Each level: +${e.startMixers} mixer at the start of every run.`;
    now = level ? `Now: +${e.startMixers * level} ${e.startMixers * level === 1 ? 'mixer' : 'mixers'} each run.` : '';
  } else if (e.phaseSpeed) {
    per = `Each level: +${Math.round(e.phaseSpeed * 100)}% production in Phases 1 and 2.`;
    now = level ? `Now: +${Math.round(e.phaseSpeed * level * 100)}% production early in a run.` : '';
  } else if (e.autoApprentice) {
    per = 'Returns already hired at the start of every run.';
    now = level ? 'Active.' : '';
  }
  return { per, now };
}

function renovateHtml(st) {
  const chk = sim().prestige.canRenovate(st);
  const gain = chk.gain;
  const inc = Math.round(gain * HERITAGE_INCOME * 100);
  if (!chk.ok) {
    return h`<div class="card">
  <div class="row between"><div class="card-title">Renovate</div>${tag('Opens in Phase 3')}</div>
  <div class="small">When your workshop reaches Phase 3 you can renovate: rebuild from the bench with a permanent income boost called Heritage.</div>
</div>`;
  }
  const suggest = sim().prestige.shouldSuggest(st);
  const needNext = Math.max(0, (gain + 1) * (gain + 1) * HERITAGE_DIVISOR - (st.runEarned || 0));
  const lists = h`<div class="stack stack-sm">
  <div class="semi small">Stays with you</div>
  <div class="hr-list">${STAYS.map((t) => h`<div class="hr-li">${raw(CHECK)}<span>${t}</span></div>`)}</div>
  <div class="semi small" style="margin-top:4px">Starts fresh</div>
  <div class="hr-list hr-fresh">${RESETS.map((t) => h`<div class="hr-li">${raw(FRESH)}<span>${t}</span></div>`)}</div>
</div>`;
  return h`<div class="card" data-coach="heritage">
  <div class="card-title">Renovate</div>
  ${gain > 0
    ? h`<div class="h2" style="font-size:20px">Renovate now: +${gain} Heritage (+${inc}% income)</div>`
    : h`<div class="h2" style="font-size:18px">Heritage is on its way</div>
        <div class="small">${ctx.format.num(needNext)} more Coins earned this run brings your next Heritage.</div>`}
  ${suggest ? h`<div class="hr-nudge">A good moment: this run would add more than half of the Heritage you have so far.</div>` : ''}
  ${lists}
  ${ui.confirm
    ? h`<div class="hr-confirm" role="alertdialog" aria-label="Confirm renovate">
        <div><div class="semi">Ready to renovate?</div><div class="small muted">Everything under "Starts fresh" begins again, and you gain +${gain} Heritage right away. Your catalog and art are safe.</div></div>
        <div class="row">${button('Not yet', { block: true, cls: 'grow', attrs: { 'data-action': 'renovate-cancel' } })}${button('Renovate now', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'renovate-go' } })}</div>
      </div>`
    : button(gain > 0 ? 'Renovate...' : 'Keep going', { variant: 'primary', block: true, disabled: gain <= 0, attrs: { 'data-action': 'renovate-ask' } })}
</div>`;
}

function nodeHtml(st, n) {
  const level = Math.min(n.maxLevel, (st.heritageSpent && st.heritageSpent[n.id]) || 0);
  const cost = heritageCost(n.id, level);
  const avail = sim().prestige.heritageAvailable(st);
  const { per, now } = effectLines(n, level);
  const maxed = cost === null;
  const short = !maxed && avail < cost ? cost - avail : 0;
  return h`<div class="card" data-node="${n.id}">
  <div class="row between"><div class="card-title">${n.name}</div><div class="small muted">Level ${level} of ${n.maxLevel}</div></div>
  <div class="hr-pips" aria-hidden="true">${Array.from({ length: n.maxLevel }, (_, i) => h`<span class="hr-pip${i < level ? ' on' : ''}"></span>`)}</div>
  <div class="small">${n.blurb}</div>
  <div class="small muted">${per}${now ? ' ' + now : ''}</div>
  ${maxed
    ? h`<div>${tag('Complete', { icon: 'check' })}</div>`
    : button(h`Buy ${raw(GEM)} ${cost} Heritage${short ? h` · ${short} more to go` : ''}`, { variant: short ? 'paper' : 'primary', small: true, block: true, attrs: { 'data-action': 'buy', 'data-node': n.id, 'aria-disabled': short ? 'true' : null } })}
</div>`;
}

function build() {
  const st = state();
  const body = q('.screen-body');
  const scroll = body ? body.scrollTop : 0;
  const total = st.heritage || 0;
  const avail = sim().prestige.heritageAvailable(st);
  const pct = Math.round(total * HERITAGE_INCOME * 100);
  root.innerHTML = String(h`
<div class="screen-head">
  ${backButton('Back')}
  <div class="titles"><div class="title">Renovate and Heritage</div><div class="subtitle">${total ? `Heritage gives +${pct}% income` : 'A permanent income boost'}</div></div>
  <span class="spacer"></span>
</div>
<div class="screen-body">
  <div class="card">
    <div class="small muted">Heritage to spend</div>
    <div class="hr-big">${raw(GEM.replace('width="16" height="16"', 'width="28" height="28"'))}<span class="num">${avail}</span></div>
    <div class="small muted">${total} earned in all. Each Heritage adds +${Math.round(HERITAGE_INCOME * 100)}% to all income, spent or not.</div>
  </div>
  ${renovateHtml(st)}
  <div class="h2" style="margin-top:4px">Heritage tree</div>
  <div class="hint">Spend Heritage so every new run starts a little smoother.</div>
  ${HERITAGE_TREE.map((n) => nodeHtml(st, n))}
</div>`);
  const nb = q('.screen-body');
  if (nb) nb.scrollTop = scroll;
}

function signature() {
  const st = state();
  const chk = sim().prestige.canRenovate(st);
  const need = Math.max(0, (chk.gain + 1) * (chk.gain + 1) * HERITAGE_DIVISOR - (st.runEarned || 0));
  return JSON.stringify([
    st.heritage, st.heritageSpent, st.phase, chk.gain, chk.ok, ui.confirm,
    chk.gain > 0 ? '' : ctx.format.num(need), sim().prestige.shouldSuggest(st),
  ]);
}

function refresh(force = false) {
  if (!root || !ctx) return;
  const sig = signature();
  if (!force && sig === ui.sig) return;
  ui.sig = sig;
  build();
}

function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !root.contains(t)) return;
  const a = t.dataset.action;
  if (a === 'renovate-ask') { ui.confirm = true; refresh(true); return; }
  if (a === 'renovate-cancel') { ui.confirm = false; refresh(true); return; }
  if (a === 'renovate-go') {
    ui.confirm = false;
    const res = ctx.game.act(sim().prestige.renovate, {});
    if (!res || !res.ok) ctx.toast('Renovating opens in Phase 3. Your workshop is almost there.');
    refresh(true);
    return;
  }
  if (a === 'buy') {
    const id = t.dataset.node;
    const node = HERITAGE_TREE.find((n) => n.id === id);
    const res = ctx.game.act(sim().prestige.buyHeritageNode, { id });
    if (res && res.ok) {
      audio.clink(3);
      haptics.medium();
      ctx.toast(`${node ? node.name : 'Upgrade'} is now level ${res.level}.`);
      refresh(true);
      const card = q(`[data-node="${id}"]`);
      if (card) fx.squash(card);
    } else if (res && res.reason === 'heritage') {
      const need = res.cost - sim().prestige.heritageAvailable(state());
      ctx.toast(`${need} more Heritage and this one is yours.`);
    } else if (res && res.reason === 'max') {
      ctx.toast('This one is already complete.');
    }
  }
}

const screen = {
  id: 'heritage',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    fx = ctx.fx || fxDefault;
    audio = ctx.audio || audioDefault;
    haptics = ctx.haptics || hapticsDefault;
    injectCss();
    root.addEventListener('click', onClick);
  },

  show() {
    ui.confirm = false;
    refresh(true);
  },

  hide() {
    ui.confirm = false;
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
