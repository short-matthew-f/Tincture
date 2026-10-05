/**
 * quests.js: Quests and events (overlay `quests`).
 *
 * Owns: the Seals balance header (rolling number), the three daily quest cards
 * (progress, Claim, one free swap a day, the catch-up bank line), the weekly
 * quest (steps with checkmarks, the rare reward preview, Claim) and the weekly
 * event (palette swatches, region pennant, the 10-step paper track with
 * claimable steps glowing, points so far, the twist, and the "comes back in the
 * rotation" footnote). Implements DESIGN.md "Quests and weekly events".
 *
 * Tone: positive framing only. "New quests each morning" is plain text, never a
 * timer; nothing here counts down. Progress reads "3 more", never "2 / 5".
 * The event track is a fade-edged, snapping strip that opens on the current step.
 *
 * data-actions: claim, reroll, claim-weekly, claim-step, go-map, go-workshop.
 * Opens with params `{section: 'daily' | 'weekly' | 'event'}` (optional scroll target).
 *
 * First-open guide 'quests': `data-coach="quests-daily"` (the Daily heading, a got-it step), then
 * `data-coach="quests-claim"` (the first Claim button, waits for a claimable quest, ends when a daily
 * is claimed). Once the intro step has been seen it is not repeated while the claim step still waits
 * ('questsIntro'). 'questsNext' is the one-time "what's next" card after her first claim.
 *
 * Feel (Theme F): Claim flies seal-red dots to the Seals chip, the big "Claimed" stamp lands about 500 ms in (the small
 * mark waits for it), the number rolls when the dots land (about 1.3 s in all); a bar whose progress changed fills
 * with a spring from where it was; an event step that becomes claimable springs (heavy, with a ring) as its glow
 * starts, and claimable steps arrive softly when the page opens.
 */

import { h, raw, backButton, button, progressBar, fadeStrip, iconSvg, swatch, safeHex, containerSvg } from './kit.js';
import { pennantSvg } from './map.js';
import { howThisWorksHtml, markGuideSeen, isSeen } from './guide.js';

const CSS = `
section[data-screen="quests"] .screen-head .title { font-family:var(--font-ui); font-weight:600; font-size:18px; }
.qs-head-seals { flex:0 0 auto; min-width:var(--tap); justify-content:flex-end; gap:5px; }
.qs-head-seals .qs-seal-label { font-size:12px; font-weight:600; color:var(--ink-soft); }
.qs-sec { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-top:8px; }
.qs-sech { font-family:var(--font-ui); font-weight:600; font-size:18px; line-height:1.2; }
.qs-h { font-family:var(--font-ui); font-weight:600; font-size:16px; line-height:1.25; }
.qs-note { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-soft); }
section[data-screen="quests"] .how-link { min-height:24px; padding:0 8px; line-height:1; position:relative; }
section[data-screen="quests"] .how-link::before { content:''; position:absolute; inset:-10px -8px; }
.qs-empty { align-items:center; text-align:center; gap:10px; }
.qs-quest.is-done { box-shadow:0 0 0 2px var(--glow-ring), var(--cut); background:var(--glow); }
.qs-quest.is-done .progress > span { background:var(--gold); }
.qs-quest.is-claimed { opacity:.75; }
.qs-stamp.is-await { visibility:hidden; }
.qs-quest .qs-acts { display:flex; align-items:center; gap:10px; margin-left:auto; }
.qs-stamp { display:inline-flex; align-items:center; gap:4px; padding:5px 11px; border-radius:6px; box-shadow:inset 0 0 0 1.5px var(--plaster-line);
  color:var(--ink-soft); font-size:12px; font-weight:600; transform:rotate(-2.5deg); }
.qs-reward { font-size:12px; color:var(--ink-soft); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.qs-reward b { color:var(--ink); }
.qs-bank { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:var(--radius-sm); background:#FBF1D4; box-shadow:inset 0 0 0 1.5px var(--gold); font-size:13px; }
.qs-step-row { display:flex; align-items:center; gap:10px; min-height:36px; }
.qs-tick { flex:0 0 24px; width:24px; height:24px; border-radius:50%; display:grid; place-items:center; box-shadow:inset 0 0 0 2px var(--plaster-line); color:var(--paper); }
.qs-tick.is-done { background:var(--ink); box-shadow:none; }
.qs-rare { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:var(--radius-sm); background:#FBF1D4; box-shadow:inset 0 0 0 1.5px var(--gold); font-size:13px; }
.qs-track.strip { align-items:flex-start; margin:0 -14px; padding:4px 14px 10px; gap:0; scroll-padding-inline:14px; }
.qs-step { position:relative; flex:0 0 auto; display:flex; flex-direction:column; align-items:center; gap:6px; width:84px; padding:0 4px; text-align:center; }
.qs-step::before { content:''; position:absolute; left:-50%; right:50%; top:21px; height:5px; border-radius:3px; background:rgba(42,38,34,.14); }
.qs-step.is-first::before { display:none; }
.qs-step.is-reached::before { background:var(--ink); }
.qs-node { position:relative; z-index:1; width:44px; height:44px; border-radius:50%; display:grid; place-items:center; flex:0 0 auto;
  font-family:var(--font-ui); font-weight:700; font-size:18px; background:var(--plaster); color:var(--ink-soft); box-shadow:inset 0 0 0 2px var(--plaster-line); }
.qs-step.is-reached .qs-node { background:var(--paper); color:var(--ink); box-shadow:0 3px 0 var(--shadow), inset 0 0 0 2px var(--ink); }
.qs-step.is-claimed .qs-node { background:var(--ink); color:var(--paper); box-shadow:0 3px 0 rgba(0,0,0,.35); }
.qs-step.is-claimable .qs-node { background:var(--glow); box-shadow:0 0 0 3px var(--glow-ring), 0 3px 0 var(--shadow); animation:glow-breathe 2.8s ease-in-out infinite; }
button.qs-step { cursor:pointer; }
button.qs-step:active .qs-node { transform:translateY(2px); }
.qs-ticket { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; width:100%; min-height:62px; padding:6px 4px; border-radius:8px 8px 8px 8px;
  background:var(--paper); box-shadow:var(--cut-sm); font-size:11px; font-weight:600; line-height:1.15; }
.qs-step:not(.is-reached) .qs-ticket { background:rgba(247,244,236,.6); color:var(--ink-soft); }
.qs-step.is-claimable .qs-ticket { box-shadow:0 0 0 2px var(--glow-ring), var(--cut-sm); }
.qs-pts { font-size:11px; color:var(--ink-soft); }
.qs-step.is-claimable .qs-pts { color:var(--glow-ink); font-weight:700; }
.qs-pal { display:flex; flex-wrap:wrap; gap:6px; }
.qs-evhead { display:flex; align-items:center; gap:12px; }
.qs-big { font-family:var(--font-ui); font-weight:700; font-size:30px; line-height:1; }
.qs-hl { animation:qs-flash 1.4s ease-out 1; }
@keyframes qs-flash { 0% { box-shadow:0 0 0 4px var(--glow-ring), var(--cut); } 100% { box-shadow:var(--cut); } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('qs-style')) return;
  const s = document.createElement('style');
  s.id = 'qs-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
injectStyle();

let root = null;
let ctx = null;
let bodyEl = null;
let visible = false;
let lastKey = '';
let shownSeals = null;
let holdSeals = false;
let trackLeft = null; // null: open the event track on its current step
const progMemo = new Map();      // quest id -> the bar's last width (%), so a changed bar springs from where it was
const awaiting = new Set();      // claimed cards whose small "Claimed" mark waits for the big stamp to land
let claimableSeen = null;        // event steps that were claimable at the last paint (null: first paint of a visit)
const SEAL_HEX = '#9E4436';      // the wax seal's own red, for the dots that fly to the Seals chip

const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const fmt = (n) => ctx.format.num(n);

const sealIcon = (size = 16) => iconSvg('seal', { size });

const RARE_LABEL = {
  wild: 'a new wild hue to find',
  'gold-postcard': 'a gold-stamped postcard',
  'hunter-level': 'a hunter level-up',
};

// ---------------------------------------------------------------------------
// Seals header
// ---------------------------------------------------------------------------

function syncSeals(state, animate = true) {
  const el = root && root.querySelector('[data-seals-num]');
  if (!el) return;
  const to = fin(state.seals);
  if (holdSeals) return;
  if (shownSeals === null || !animate) el.textContent = fmt(to);
  else if (shownSeals !== to) ctx.fx.rollNumber(el, shownSeals, to, { format: fmt });
  shownSeals = to;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function bankLine(state) {
  const seals = ctx.sim.quests.bankSeals(state);
  if (seals <= 0) return '';
  const thirds = Math.round(fin(state.quests.bank) * 3);
  const days = Math.floor(thirds / 3);
  const what = thirds % 3 === 0 ? plural(days, 'missed day') : plural(thirds, 'missed daily', 'missed dailies');
  return h`<div class="qs-bank" data-section-bank><span aria-hidden="true">${sealIcon(22)}</span>
    <div class="grow"><b>${what}</b> of rewards waiting: finish any daily to collect <b>+${fmt(seals)} Seals</b>.</div></div>`;
}

function questCard(q, state) {
  const used = !!state.quests.rerollUsed;
  const pct = q.target > 0 ? q.progress / q.target : 0;
  const reward = q.reward || {};
  const more = Math.max(0, q.target - q.progress);
  let action;
  if (q.claimed) action = h`<span class="qs-stamp ${awaiting.has(q.id) ? 'is-await' : ''}">${iconSvg('check', { size: 13 })} Claimed</span>`;
  else if (q.done) action = button('Claim', { variant: 'primary', attrs: { 'data-action': 'claim', 'data-quest-id': q.id, 'data-coach': 'quests-claim' } });
  else if (!used) action = button('Try another', { attrs: { 'data-action': 'reroll', 'data-quest-id': q.id, 'aria-label': 'Try another quest in its place, free once a day' } });
  else action = '';
  return h`<div class="card qs-quest ${q.done && !q.claimed ? 'is-done' : ''} ${q.claimed ? 'is-claimed' : ''}" data-quest="${q.id}">
    <div class="semi">${q.text}</div>
    ${q.claimed ? '' : progressBar(pct, { label: q.text })}
    <div class="row between wrap">
      <div class="qs-reward">${sealIcon(14)}<b>+${fmt(fin(reward.seals))} Seals</b>${fin(reward.boostMin) > 0 ? h`<span>and a ${reward.boostMin}-minute boost</span>` : ''}</div>
      <div class="qs-acts">${q.done || q.claimed ? '' : h`<span class="hint num nowrap">${more} more</span>`}${action}</div>
    </div></div>`;
}

function emptyQuests() {
  return h`<div class="card qs-empty" data-quests-empty>
    <div class="qs-h">Quests start with your first colors</div>
    <div class="hint">Make a color or two in the workshop, and little goals will show up here. New ones arrive each morning.</div>
    ${button('Back to the workshop', { variant: 'primary', attrs: { 'data-action': 'go-workshop' } })}</div>`;
}

function dailySection(state) {
  const q = state.quests;
  const list = q.daily || [];
  return h`<div class="qs-sec" data-section="daily" data-coach="quests-daily"><h2 class="qs-sech">Daily</h2><span class="hint">New quests each morning</span></div>
    ${bankLine(state)}
    ${list.length ? list.map((x) => questCard(x, state)) : h`<div class="card qs-empty"><div class="hint">New quests arrive each morning. Make something in the workshop, then check back.</div>${button('Back to the workshop', { attrs: { 'data-action': 'go-workshop' } })}</div>`}
    ${list.length ? h`<div class="hint">${q.rerollUsed ? 'Today\'s free try-another is used. You get another tomorrow.' : 'Not feeling one? Try another, free once a day.'}</div>` : ''}`;
}

function weeklySection(state) {
  const w = state.quests.weekly;
  if (!w) return '';
  const def = ctx.content.getWeeklyQuest(w.id);
  const rare = RARE_LABEL[w.reward && w.reward.rare] || 'a guaranteed rare find';
  const stepsLeft = w.steps.filter((s) => !s.done).length;
  return h`<div class="qs-sec" data-section="weekly"><h2 class="qs-sech">Weekly</h2><span class="hint">A fresh one every Monday</span></div>
    <div class="card ${w.done && !w.claimed ? 'qs-quest is-done' : ''}" data-weekly>
      <div class="row between"><div><div class="qs-h">${def ? def.name : 'This week\'s quest'}</div>${def ? h`<div class="hint">${def.blurb}</div>` : ''}</div>
        <span class="chip">${stepsLeft > 0 ? `${stepsLeft} more ${stepsLeft === 1 ? 'step' : 'steps'}` : 'All steps done'}</span></div>
      <div class="stack stack-sm" style="gap:2px">${w.steps.map((s) => h`<div class="qs-step-row">
        <span class="qs-tick ${s.done ? 'is-done' : ''}" aria-hidden="true">${s.done ? iconSvg('check', { size: 14 }) : ''}</span>
        <div class="grow ${s.done ? 'muted' : ''}"><span class="${s.done ? '' : 'semi'}">${s.text}</span></div>
        ${s.n > 1 && !s.done ? h`<span class="hint num nowrap">${Math.max(0, s.n - s.progress)} more</span>` : ''}
        <span class="sr-only">${s.done ? 'Done' : 'Not yet'}</span></div>`)}</div>
      <div class="qs-rare"><span aria-hidden="true">${sealIcon(22)}</span><div class="grow">Reward: <b>${fmt(fin(w.reward && w.reward.seals))} Seals</b> and <b>${rare}</b>.</div></div>
      ${w.claimed ? h`<span class="qs-stamp ${awaiting.has('weekly') ? 'is-await' : ''}" style="align-self:flex-start">${iconSvg('check', { size: 13 })} Claimed</span>`
        : w.done ? button('Claim reward', { variant: 'primary', block: true, attrs: { 'data-action': 'claim-weekly' } }) : ''}
    </div>`;
}

function rewardView(state, r) {
  if (r.seals) return { icon: sealIcon(22), label: `${fmt(r.seals)} Seals` };
  if (r.colorId) {
    const info = ctx.sim.colorInfo(r.colorId);
    const known = state.catalog && state.catalog.discovered && state.catalog.discovered[r.colorId];
    return { icon: swatch(info ? info.hex : '#B7BDB3', 24, { cls: 'round' }), label: known ? 'Color found' : 'New limited color' };
  }
  if (r.canvas) {
    return { icon: raw('<svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true"><rect x="2" y="2" width="22" height="18" rx="2" fill="#F7F4EC" stroke="#2A2622" stroke-width="2"/><path d="M5 16 L10 10 L14 14 L17 11 L21 16Z" fill="#7B5236"/><circle cx="18" cy="7" r="2" fill="#C99A2E"/></svg>'), label: 'A canvas' };
  }
  if (r.vial) {
    const ev = ctx.content.getEvent(state.event.key);
    const info = ev && ctx.sim.colorInfo(ev.vialColors[0]);
    return { icon: containerSvg(1, info ? info.hex : '#B7BDB3', { size: 16 }), label: plural(r.vial, 'vial') };
  }
  if (r.cosmetic) {
    return { icon: raw('<svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><path d="M3 2 H19 V19 L11 15 L3 19Z" fill="#B8433A" stroke="#2A2622" stroke-width="2" stroke-linejoin="round"/></svg>'), label: 'Workshop banner' };
  }
  return { icon: '', label: 'Surprise' };
}

function eventSection(state) {
  const ev = state.event && ctx.content.getEvent(state.event.key);
  if (!ev) return '';
  const region = ctx.content.getRegion(ev.region);
  const track = ctx.sim.events.eventTrack(state);
  const claimable = ctx.sim.events.claimableSteps(state);
  const pts = fin(state.event.points);
  const next = track.find((s) => !s.reached);
  const palette = ctx.sim.events.eventPalette(state).slice(0, 12);
  return h`<div class="qs-sec" data-section="event"><h2 class="qs-sech">This week's event</h2>
      ${claimable.length ? h`<span class="chip is-on">${claimable.length} ready to claim</span>` : ''}</div>
    <div class="card" data-event>
      <div class="qs-evhead"><span aria-hidden="true">${pennantSvg(ev.palette, 52)}</span>
        <div class="grow"><div class="qs-h" style="font-size:18px">${ev.name}</div><div class="hint">${region ? (ctx.sim.hunters.unlocked(state) ? `The ${region.name} is open on your map.` : `The ${region.name} opens on your map once hunters arrive.`) : ''}</div></div></div>
      ${palette.length ? h`<div class="stack stack-sm"><div class="hint">This week's limited colors</div><div class="qs-pal">${palette.map((hx) => swatch(safeHex(hx), 22))}</div></div>` : ''}
      <div class="hint"><b class="semi">This week's twist:</b> ${ev.twist.text}</div>
      <div class="divider"></div>
      <div class="row between"><div><div class="qs-big num">${fmt(pts)}</div><div class="hint">event points so far</div></div>
        <div class="hint" style="text-align:right;max-width:55%">${next ? `${plural(next.points - pts, 'more point')} to step ${next.step}` : 'Every step reached. Lovely.'}</div></div>
      ${progressBar(next ? Math.min(1, (pts - (track[next.step - 2] ? track[next.step - 2].points : 0)) / Math.max(1, next.points - (track[next.step - 2] ? track[next.step - 2].points : 0))) : 1, { label: 'Progress to the next step' })}
      ${fadeStrip(track.map((s) => {
        const can = s.reached && !s.claimed;
        const rv = rewardView(state, s.reward);
        const cls = `qs-step ${s.step === 1 ? 'is-first' : ''} ${s.reached ? 'is-reached' : ''} ${s.claimed ? 'is-claimed' : ''} ${can ? 'is-claimable' : ''}`;
        const inner = h`<span class="qs-node">${s.claimed ? iconSvg('check', { size: 20 }) : s.step}</span>
          <span class="qs-ticket">${rv.icon}<span>${rv.label}</span></span>
          <span class="qs-pts num">${can ? 'Claim' : s.claimed ? 'Claimed' : `${fmt(s.points)} pts`}</span>`;
        return can
          ? h`<button type="button" class="${cls}" data-action="claim-step" data-step="${s.step}" data-tap aria-label="Claim step ${s.step}: ${rv.label}">${inner}</button>`
          : h`<div class="${cls}" role="group" aria-label="Step ${s.step}: ${rv.label}${s.claimed ? ', claimed' : ''}">${inner}</div>`;
      }), { cls: 'qs-track', label: 'Event track' })}
      <div class="hint">This event comes back in the rotation, and your points are saved, so there is never a rush.</div>
    </div>`;
}

function build(state) {
  const q = state.quests || {};
  if (!(q.daily && q.daily.length) && !q.weekly && !(state.event && state.event.key)) return emptyQuests();
  return h`<div class="qs-note" data-seals-note><span aria-hidden="true">${sealIcon(18)}</span><span>Seals are the wax stamps you earn for finishing little goals.</span></div>
    ${dailySection(state)}${weeklySection(state)}${eventSection(state)}`;
}

/** Keep the event track where she left it; the first time, open on the current step. */
function placeTrack() {
  const t = bodyEl && bodyEl.querySelector('.qs-track');
  if (!t || t.scrollWidth <= t.clientWidth) return;
  if (trackLeft !== null) { t.scrollLeft = trackLeft; return; }
  const cur = t.querySelector('.is-claimable') || t.querySelector('.qs-step:not(.is-reached)') || t.querySelector('.qs-step:last-child');
  if (!cur) return;
  const tr = t.getBoundingClientRect();
  const cr = cur.getBoundingClientRect();
  t.scrollLeft += (cr.left - tr.left) - (tr.width - cr.width) / 2;
  trackLeft = t.scrollLeft;
}

function paint(state, force = false) {
  if (!bodyEl) return;
  state = state || ctx.game.state;
  const html = String(build(state));
  if (!force && html === lastKey) { syncSeals(state); return; }
  lastKey = html;
  const keep = bodyEl.scrollTop;
  bodyEl.innerHTML = html;
  bodyEl.scrollTop = keep;
  placeTrack();
  syncSeals(state);
  springBars();
  springClaimable();
}

/** A bar whose progress changed fills with a spring from where it was (a new bar just appears). */
function springBars() {
  bodyEl.querySelectorAll('.qs-quest[data-quest]').forEach((card) => {
    const id = card.getAttribute('data-quest');
    const bar = card.querySelector('.progress > span');
    if (!bar) { progMemo.delete(id); return; }
    const now = parseFloat(bar.style.width) || 0;
    const prev = progMemo.get(id);
    progMemo.set(id, now);
    if (!visible || prev === undefined || Math.abs(prev - now) < 0.5) return;
    ctx.fx.spring(bar, { from: { width: `${prev}%` }, to: { width: `${now}%` }, preset: 'soft' });
  });
}

/** An event step that becomes claimable glows (CSS) and springs: heavy with a ring when it happens in front of her, a soft arrival on opening. */
function springClaimable() {
  const nodes = [...bodyEl.querySelectorAll('.qs-step.is-claimable')];
  const now = new Set(nodes.map((n) => n.getAttribute('data-step')));
  const first = claimableSeen === null;
  nodes.forEach((n, i) => {
    const key = n.getAttribute('data-step');
    if (!visible || (!first && claimableSeen.has(key))) return;
    const node = n.querySelector('.qs-node');
    if (!node) return;
    if (first) ctx.fx.spring(node, { from: { transform: 'scale(0.82)', opacity: 0.4 }, to: { transform: 'scale(1)', opacity: 1 }, preset: 'soft', delay: i * 60, fill: 'backwards' });
    else {
      ctx.fx.spring(node, { from: { transform: 'scale(0.6)', opacity: 0.6 }, to: { transform: 'scale(1)', opacity: 1 }, preset: 'heavy' });
      ctx.fx.ringBurst(node, '#E2B04A', { size: 64 });
    }
  });
  claimableSeen = now;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function sealsTarget() {
  return root.querySelector('[data-seals-chip]');
}

/**
 * Run a claim: seal-red dots fly to the Seals chip first, the number rolls when they land, and (for a quest
 * card) the big "Claimed" stamp lands about 500 ms in, just ahead of the first seal. About 1.3 s in all.
 */
function withFly(btn, fn, { stampId = null } = {}) {
  const target = sealsTarget();
  const card = btn && btn.closest ? btn.closest('.qs-quest, [data-weekly]') : null;
  holdSeals = true;
  const flight = btn && target ? ctx.fx.flyTo(btn, target, SEAL_HEX, { count: 6 }) : Promise.resolve();
  const at = card ? card.getBoundingClientRect() : null;
  let res;
  try { res = fn(); } finally { /* state already changed; render happens inside act */ }
  if (res && res.ok && stampId && at) {
    awaiting.add(stampId);
    paint(ctx.game.state, true); // the small mark waits (hidden) for the stamp
    setTimeout(() => landClaimStamp(stampId), 330);
  }
  flight.then(() => { holdSeals = false; syncSeals(ctx.game.state); });
  return res;
}

function landClaimStamp(id) {
  const card = id === 'weekly' ? bodyEl && bodyEl.querySelector('[data-weekly]') : bodyEl && bodyEl.querySelector(`.qs-quest[data-quest="${String(id).replace(/["\\]/g, '\\$&')}"]`);
  const finish = () => { awaiting.delete(id); if (visible) paint(ctx.game.state, true); };
  if (!card || !visible) { finish(); return; }
  Promise.resolve(ctx.fx.stamp(card, 'Claimed', { hold: 500 })).then(finish, finish);
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const a = el.getAttribute('data-action');
  const S = ctx.sim;
  if (a === 'claim') {
    const qid = el.getAttribute('data-quest-id');
    const res = withFly(el, () => ctx.game.act(S.quests.claim, { questId: qid }), { stampId: qid });
    if (res && res.ok) {
      ctx.audio.coins(6);
      const extra = res.bankSeals ? ` (+${fmt(res.bankSeals)} from missed days)` : '';
      ctx.toast(`+${fmt(res.seals)} Seals${extra}${res.boostMin ? `, and a ${res.boostMin}-minute boost` : ''}`);
      firstClaimCard();
    }
  } else if (a === 'reroll') {
    const res = ctx.game.act(S.quests.reroll, { questId: el.getAttribute('data-quest-id') });
    if (res && res.ok) ctx.toast('A fresh quest, just for you.');
    else ctx.toast('Today\'s free try-another is used. You get another tomorrow!');
  } else if (a === 'claim-weekly') {
    const res = withFly(el, () => ctx.game.act(S.quests.claimWeekly, {}), { stampId: 'weekly' });
    if (res && res.ok) {
      ctx.audio.coins(8);
      const r = res.rare || {};
      let what = '';
      if (r.kind === 'wild') what = `, and a new wild hue: ${ctx.sim.displayName(ctx.game.state, r.colorId)}`;
      else if (r.kind === 'gold-postcard') { const c = ctx.content.getPostcard(r.postcardId); what = `, and a gold-stamped postcard${c ? `: ${c.title}` : ''}`; }
      else if (r.kind === 'hunter-level') { const hu = ((ctx.game.state.hunters || {}).roster || []).find((x) => x.id === r.hunterId); what = `, and ${hu ? hu.name : 'a hunter'} reached level ${r.level}`; }
      else if (r.kind === 'seals') what = `, plus ${fmt(r.seals)} bonus Seals`;
      ctx.toast(`+${fmt(res.seals)} Seals${what}`);
    }
  } else if (a === 'claim-step') {
    const step = Number(el.getAttribute('data-step'));
    const node = el.querySelector('.qs-node');
    const res = withFly(el, () => ctx.game.act(S.events.claimStep, { step }));
    if (res && res.ok) {
      if (res.seals) ctx.audio.coins(5); else ctx.audio.stamp();
      if (node) { ctx.fx.ringBurst(node, '#E2B04A', { size: 70 }); }
      const bits = [];
      if (res.seals) bits.push(`+${fmt(res.seals)} Seals`);
      if (res.colorId) bits.push('a limited color');
      if (res.canvas) bits.push('a new canvas');
      if (res.vials) bits.push(plural(res.vials.length, 'vial'));
      if (res.cosmetic) bits.push('a workshop banner');
      ctx.toast(`Step ${step}: ${bits.join(', ') || 'collected'}!`);
    }
  } else if (a === 'go-map') ctx.navigate('map');
  else if (a === 'go-workshop') ctx.navigate('workshop');
}

// ---------------------------------------------------------------------------
// First-open guide and the "what's next" card after her first claim
// ---------------------------------------------------------------------------

let guideTimer = 0;
let nextTimer = 0;
let qGuide = null;

const dailies = (st) => (st && st.quests && st.quests.daily) || [];

function stopGuide() {
  clearTimeout(guideTimer);
  guideTimer = 0;
  if (!qGuide) return;
  // The intro step has been seen: a later visit that is still waiting for a claim skips it.
  if (qGuide.step >= 1 && !isSeen(ctx.game.state, 'questsIntro')) ctx.game.act(markGuideSeen, { id: 'questsIntro' });
  try { qGuide.stop(); } catch (e) { /* ignore */ }
  qGuide = null;
}

function startGuide({ replay = false } = {}) {
  stopGuide();
  if (typeof ctx.guide !== 'function') return;
  const claimed = (st) => dailies(st).filter((x) => x.claimed).length;
  const base = claimed(ctx.game.state);
  const intro = { anchor: '[data-coach="quests-daily"]', text: 'Three little goals a day. No streaks, no rush.', endsOn: 'got-it', side: 'below' };
  const claim = {
    anchor: '[data-coach="quests-claim"]', text: 'Claim it for Seals.', endsOn: 'action',
    when: (st) => dailies(st).some((x) => x.done && !x.claimed),
    done: (st) => claimed(st) > base,
  };
  qGuide = ctx.guide('quests', !replay && isSeen(ctx.game.state, 'questsIntro') ? [claim] : [intro, claim], { screen: 'quests' });
  const g = qGuide;
  if (!replay) guideTimer = setTimeout(() => { guideTimer = 0; if (visible && g === qGuide) g.start(); }, 300);
}

function firstClaimCard() {
  if (typeof ctx.guide !== 'function' || isSeen(ctx.game.state, 'questsNext')) return;
  ctx.game.act(markGuideSeen, { id: 'questsNext' });
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    nextTimer = 0;
    if (!visible) return;
    ctx.guide.whatsNext({
      title: 'Seals earned',
      more: { label: 'See the weekly', run: () => { const el = root.querySelector('[data-section="weekly"]'); if (el) el.scrollIntoView({ block: 'start' }); } },
      next: { label: 'Back to the workshop', run: () => ctx.navigate('workshop') },
    });
  }, 1100);
}

const screen = {
  id: 'quests',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    injectStyle();
    root.innerHTML = String(h`<div class="screen-head">${backButton('Back')}
      <div class="titles"><div class="title">Quests and events</div><div class="subtitle">Little goals, no rush</div>${howThisWorksHtml('quests')}</div>
      <span class="chip qs-head-seals" data-seals-chip aria-label="Seals balance">${sealIcon(18)}<span data-seals-num class="num">0</span><span class="qs-seal-label">Seals</span></span></div>
      <div class="screen-body" data-quests-body></div>`);
    bodyEl = root.querySelector('[data-quests-body]');
    root.addEventListener('click', onClick);
    // "How this works": rebuild with the intro step first (guide.js's own listener then runs it).
    root.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-guide-replay="quests"]')) startGuide({ replay: true }); });
    bodyEl.addEventListener('scroll', (e) => {
      if (e.target.classList && e.target.classList.contains('qs-track')) trackLeft = e.target.scrollLeft;
    }, true);
  },

  show(params = {}) {
    visible = true;
    shownSeals = null;
    holdSeals = false;
    trackLeft = null;
    claimableSeen = null;
    awaiting.clear();
    paint(ctx.game.state, true);
    requestAnimationFrame(() => { if (visible) placeTrack(); });
    if (params.section && bodyEl) {
      requestAnimationFrame(() => {
        const t = root.querySelector(`[data-section="${params.section}"]`);
        if (t) t.scrollIntoView({ block: 'start' });
      });
    } else if (bodyEl) bodyEl.scrollTop = 0;
    startGuide();
  },

  hide() {
    visible = false;
    clearTimeout(nextTimer);
    nextTimer = 0;
    stopGuide();
  },

  render(state) {
    if (!visible) return;
    paint(state);
  },
};

export default screen;
