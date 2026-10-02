/**
 * hunter.js: hunter detail (overlay `hunter`, opened with navigate('hunter', {hunterId})).
 *
 * Owns: big portrait, name, voice and blurb, trait chips, level and XP bar
 * ("2 more trips to level 4"), the perks at levels 5, 10 and 15, trip status
 * with the current region and a live countdown, the Send button (the shared
 * Send sheet exported from map.js), the radio-call button, the last haul and
 * recent postcards from this hunter's trips. Implements DESIGN.md "Hue Hunters
 * and postcards > The team" and "Expeditions".
 *
 * A hunter who has not joined yet gets the same page, with a paper tag naming the real goal
 * ("Joins at 25 colors: 9 more" / "Hire for 400 coins") and a Hire button once it is affordable.
 *
 * data-actions: send, hire, answer-choice, open-card, open-album, go-map.
 */

import { h, backButton, button, progressBar, iconSvg, tag, lockTag } from './kit.js';
import {
  hunterPortrait, tripStatusHtml, tripBar, tickCountdowns, openSendSheet, openChoiceSheet,
  haulChips, recentCardsFor, recordHauls, refreshSheet, hireInfo, TRAIT_HEX,
} from './map.js';
import { postcardArt } from './album.js';

const CSS = `
.hn-hero { align-items:center; text-align:center; gap:6px; padding-top:18px; }
.hn-plate { position:relative; display:grid; place-items:center; }
.hn-name { font-family:var(--font-display); font-size:26px; line-height:1.1; }
.hn-h { font-family:var(--font-ui); font-weight:600; font-size:16px; line-height:1.25; }
.hn-goal { display:flex; flex-direction:column; gap:10px; align-items:center; text-align:center; }
.hn-goal .tag { white-space:normal; }
.hn-chip { font-size:12px; min-height:28px; padding:0 10px; box-shadow:0 1px 0 var(--shadow-soft); }
.hn-chips { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
.hn-perk { display:flex; align-items:flex-start; gap:10px; padding:8px 0; }
.hn-perk + .hn-perk { border-top:1px solid rgba(42,38,34,.08); }
.hn-perk .dot { flex:0 0 28px; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--ink); color:var(--paper); }
.hn-perk.is-locked .dot { background:var(--plaster); color:var(--ink-soft); box-shadow:inset 0 0 0 1.5px var(--plaster-line); }
.hn-perk.is-locked { opacity:.85; }
.hn-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.hn-cards button { display:flex; flex-direction:column; gap:4px; padding:5px; border-radius:8px; background:var(--paper); box-shadow:var(--cut-sm); text-align:left; }
.hn-cards .al-art { width:100%; height:auto; }
.hn-cards span { font-family:var(--font-display); font-size:12px; line-height:1.15; padding:0 1px 2px; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('hn-style')) return;
  const s = document.createElement('style');
  s.id = 'hn-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
injectStyle();

let root = null;
let ctx = null;
let bodyEl = null;
let hunterId = null;
let visible = false;
let lastKey = '';
let timer = 0;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

function find(state) {
  return ((state.hunters && state.hunters.roster) || []).find((x) => x.id === hunterId) || null;
}

function xpLine(hu) {
  const C = ctx.content;
  const max = C.LEVELS.max;
  if (hu.level >= max) return { ratio: 1, text: 'Top of the ladder: level ' + max };
  const base = C.xpForLevel(hu.level);
  const span = C.xpToNext(hu.level);
  const into = Math.max(0, hu.xp - base);
  const need = Math.max(1, C.xpForLevel(hu.level + 1) - hu.xp);
  return { ratio: Math.min(1, into / Math.max(1, span)), text: `${plural(need, 'more trip')} to level ${hu.level + 1}` };
}

function perksHtml(hu) {
  const C = ctx.content;
  return Object.entries(C.LEVELS.perks).map(([lv, p]) => {
    const L = Number(lv);
    const got = hu.level >= L;
    const more = L - hu.level;
    let text = p.text;
    if (p.secondTrait && hu.trait2) text = `Learned a second trait: ${C.TRAITS[hu.trait2] ? C.TRAITS[hu.trait2].name : hu.trait2}.`;
    return h`<div class="hn-perk ${got ? '' : 'is-locked'}"><span class="dot">${got ? iconSvg('check', { size: 14 }) : iconSvg('lock', { size: 13 })}</span>
      <div class="grow"><div class="semi">Level ${L}${got ? '' : h` <span class="muted">· ${plural(more, 'more level')}</span>`}</div><div class="hint">${text}</div></div></div>`;
  });
}

/** A hunter who has not joined yet: portrait, blurb, trait, the real goal as a paper tag, and Hire when it is live. */
function unhiredHtml(state) {
  const C = ctx.content;
  const def = hunterId ? C.getHunter(hunterId) : null;
  if (!def) {
    return h`<div class="card hn-goal"><div class="hn-h">Pick a hunter from the map</div><div class="hint">Your hunters and the ones who will join later all live there.</div>
      ${button('Back to the map', { variant: 'primary', attrs: { 'data-action': 'go-map' } })}</div>`;
  }
  const trait = C.TRAITS[def.trait];
  const info = hireInfo(ctx, state, def);
  const goalTag = info.icon === 'lock' ? lockTag(info.text) : tag(info.text, { icon: info.icon });
  const goal = info.can
    ? h`${goalTag}${button(`Hire ${def.name}`, { variant: 'primary', block: true, attrs: { 'data-action': 'hire' } })}`
    : goalTag;
  const waiting = info.kind === 'coins' ? 'Your coins are building up, and then it is a quick tap.'
    : info.kind === 'full' ? 'Make room on the team and this is a quick tap.'
      : `Every new color brings ${def.name} closer.`;
  return h`<div class="card hn-hero">
      <div class="hn-plate">${hunterPortrait(def.id, { size: 148, trait: def.trait, label: def.name })}</div>
      <div class="hn-name">${def.name}</div>
      <div class="hn-chips"><span class="chip hn-chip" style="background:${TRAIT_HEX[def.trait] || '#ccc'}33">${trait ? trait.name : def.trait}</span>
        <span class="chip hn-chip">${def.voice[0].toUpperCase() + def.voice.slice(1)} voice</span></div>
      <p class="hint" style="max-width:300px">${def.blurb}</p>
    </div>
    <div class="card hn-goal" data-hire-goal>${goal}
      ${info.can ? '' : h`<div class="hint">${waiting}</div>`}
      ${button('Back to the map', { block: true, attrs: { 'data-action': 'go-map' } })}</div>
    <div class="card">
      <div class="hn-h">${trait ? trait.name : 'Trait'}</div>
      <div class="hint">${trait ? trait.blurb : ''}</div>
    </div>`;
}

function build(state) {
  const C = ctx.content;
  const hu = find(state);
  if (!hu) return unhiredHtml(state);
  const def = C.getHunter(hu.id);
  const trait = C.TRAITS[hu.trait];
  const trait2 = hu.trait2 ? C.TRAITS[hu.trait2] : null;
  const now = ctx.game.now();
  const trip = ctx.sim.hunters.tripsSummary(state, now).find((x) => x.hunterId === hu.id);
  const xp = xpLine(hu);
  const out = trip && trip.state === 'out';
  const region = out ? C.getRegion(trip.region) : null;
  const cardIds = recentCardsFor(hu.id, 6).filter((id) => state.album && state.album.cards[id]);
  const haul = hu.lastHaul;
  const bonus = Math.round(hu.level * C.LEVELS.haulPerLevel * 100);

  return h`<div class="card hn-hero">
      <div class="hn-plate">${hunterPortrait(hu.id, { size: 148, trait: hu.trait, label: hu.name })}</div>
      <div class="hn-name">${hu.name}</div>
      <div class="hn-chips"><span class="chip hn-chip" style="background:${TRAIT_HEX[hu.trait] || '#ccc'}33">${trait ? trait.name : hu.trait}</span>${trait2 ? h`<span class="chip hn-chip">${trait2.name}</span>` : ''}<span class="chip hn-chip">Level ${hu.level}</span>
        ${def ? h`<span class="chip hn-chip">${def.voice[0].toUpperCase() + def.voice.slice(1)} voice</span>` : ''}</div>
      ${def ? h`<p class="hint" style="max-width:300px">${def.blurb}</p>` : ''}
    </div>

    <div class="card">
      <div class="row between"><div class="hn-h">${out ? 'On the road' : 'At home'}</div>${out ? '' : h`<span class="chip hn-chip">Ready</span>`}</div>
      ${out
        ? h`<div class="stack stack-sm"><div class="row gap-2 wrap"><span class="semi">${region ? region.name : 'Out exploring'}</span>${tripStatusHtml(ctx, trip, { withRegion: false })}</div>${trip.choicePending ? '' : tripBar(trip)}
            ${trip.choicePending ? button('Answer the radio', { variant: 'primary', block: true, attrs: { 'data-action': 'answer-choice' } }) : ''}</div>`
        : h`<div class="hint">${hu.name} is home and rested. Pick a region and a trip length.</div>${button(`Send ${hu.name}`, { variant: 'primary', block: true, attrs: { 'data-action': 'send' } })}`}
    </div>

    <div class="card">
      <div class="hn-h">${trait ? trait.name : 'Trait'}</div>
      <div class="hint">${trait ? trait.blurb : ''}</div>
      ${trait2 ? h`<div class="hint">Second trait, ${trait2.name}: ${trait2.blurb}</div>` : ''}
    </div>

    <div class="card">
      <div class="row between"><div class="hn-h">Level ${hu.level}</div><span class="hint">+${bonus}% haul</span></div>
      ${progressBar(xp.ratio, { label: 'Experience' })}
      <div class="hint">${xp.text}</div>
      <div class="divider"></div>
      ${perksHtml(hu)}
    </div>

    ${haul ? h`<div class="card"><div class="hn-h">Last trip${C.getRegion(haul.region) ? h` to the ${C.getRegion(haul.region).name}` : ''}</div>${haulChips(ctx, state, haul)}</div>` : ''}

    <div class="card">
      <div class="row between"><div class="hn-h">Postcards from ${hu.name}</div>${button('Album', { attrs: { 'data-action': 'open-album' } })}</div>
      ${cardIds.length
        ? h`<div class="hn-cards">${cardIds.map((id) => {
          const c = C.getPostcard(id);
          return c ? h`<button type="button" data-action="open-card" data-card-id="${id}" data-tap aria-label="${c.title}">${postcardArt(c, { width: 100 })}<span>${c.title}</span></button>` : '';
        })}</div>`
        : h`<div class="hint">When ${hu.name} finds a postcard on a trip, it will turn up here. Longer trips find more.</div>`}
    </div>`;
}

function paint(state, force = false) {
  if (!bodyEl) return;
  state = state || ctx.game.state;
  recordHauls(state);
  const html = String(build(state));
  const key = html.replace(/(data-until="\d+" data-prefix="[^"]*">)[^<]*/g, '$1').replace(/(data-from="\d+" data-to="\d+"><span style="width:)[^"]*/g, '$1');
  if (!force && key === lastKey) { tickCountdowns(root, ctx); return; }
  lastKey = key;
  const keep = bodyEl.scrollTop;
  bodyEl.innerHTML = html;
  bodyEl.scrollTop = keep;
  tickCountdowns(root, ctx);
  const hu = find(state);
  const def = hunterId ? ctx.content.getHunter(hunterId) : null;
  const t = root.querySelector('.screen-head .title');
  const st = root.querySelector('.screen-head .subtitle');
  const traitOf = (id) => (ctx.content.TRAITS[id] ? ctx.content.TRAITS[id].name : '');
  if (t) t.textContent = hu ? hu.name : def ? def.name : 'Your hunters';
  if (st) st.textContent = hu ? `${traitOf(hu.trait)} · Level ${hu.level}` : def ? `${traitOf(def.trait)} · not on the team yet` : '';
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.getAttribute('data-action');
  if (a === 'send') openSendSheet(ctx, { hunterId });
  else if (a === 'answer-choice') openChoiceSheet(ctx, hunterId).then(() => paint(ctx.game.state, true));
  else if (a === 'open-card') ctx.navigate('album', { cardId: el.getAttribute('data-card-id') });
  else if (a === 'open-album') ctx.navigate('album');
  else if (a === 'go-map') ctx.navigate('map');
  else if (a === 'hire') {
    const def = ctx.content.getHunter(hunterId);
    const res = ctx.game.act(ctx.sim.hunters.hire, { hunterId });
    if (res && res.ok) {
      ctx.audio.stamp();
      ctx.toast(`${def ? def.name : 'A new hunter'} joins the team!`);
      requestAnimationFrame(() => { const plate = root.querySelector('.hn-plate'); if (plate) ctx.fx.ringBurst(plate, '#E2B04A', { size: 160 }); });
    } else ctx.toast('Not quite yet. Your coins are building up.');
  }
}

const screen = {
  id: 'hunter',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    injectStyle();
    root.innerHTML = String(h`<div class="screen-head">${backButton('Back to the map')}
      <div class="titles"><div class="title">Your hunters</div><div class="subtitle"></div></div><span class="spacer"></span></div>
      <div class="screen-body" data-hunter-body></div>`);
    bodyEl = root.querySelector('[data-hunter-body]');
    root.addEventListener('click', onClick);
  },

  show(params = {}) {
    visible = true;
    if (params.hunterId) hunterId = params.hunterId;
    if (!hunterId) {
      const first = ((ctx.game.state.hunters && ctx.game.state.hunters.roster) || [])[0];
      hunterId = first ? first.id : null;
    }
    paint(ctx.game.state, true);
    if (bodyEl) bodyEl.scrollTop = 0;
    clearInterval(timer);
    timer = setInterval(() => tickCountdowns(root, ctx), 1000);
  },

  hide() {
    visible = false;
    clearInterval(timer);
    timer = 0;
  },

  render(state) {
    if (!visible) return;
    paint(state);
    refreshSheet(ctx);
  },
};

export default screen;
