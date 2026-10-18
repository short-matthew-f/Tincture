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
 * data-actions: claim, reroll, claim-weekly, claim-step, go-map, go-workshop, how (data-kind
 * daily|weekly|event, data-id / data-index: opens the how-to sheet), go (data-screen, data-params:
 * navigate), how-close.
 * Opens with params `{section: 'daily' | 'weekly' | 'event'}` (optional scroll target) and
 * `{how: 'event'}` (opens the event sheet).
 *
 * How-to sheets (playtest: "tapping a quest should explain how to do it and take you there"):
 * every daily card, every weekly step and the event card open a bottom sheet built from
 * sim/howto.js: one or two plain sentences, progress, what to open first (with its price and
 * a button: never a dead end) and a "Take me there" button to the exact screen. The event
 * sheet lists every way to earn event points (with Go buttons), how to get the limited colors,
 * the twist and where to see it, any Era preview, and the reward track in words; the next step
 * is shown in actions ("about 1 board or 2 orders"), not just points.
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

import { h, raw, backButton, button, progressBar, fadeStrip, iconSvg, swatch, safeHex, containerSvg, tag } from './kit.js';
import { pennantSvg } from './map.js';
import { howThisWorksHtml, markGuideSeen, isSeen } from './guide.js';
import { questGuide, eventGuide } from '../sim/howto.js';

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
button.qs-step { cursor:pointer; border:0; background:none; font:inherit; color:inherit; }
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
.qs-intro { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--paper); box-shadow:var(--cut-sm); font-size:13px; line-height:1.4; }
.qs-intro b { font-weight:700; }
.qs-intro > span:first-child, .qs-note > span:first-child { flex:0 0 auto; display:inline-flex; }
.qs-quest.is-tap, .qs-evtap { cursor:pointer; touch-action:manipulation; }
.qs-howlink { display:inline-flex; align-items:center; gap:4px; font-size:13px; font-weight:600; color:var(--ink-soft); text-decoration:underline; text-underline-offset:3px; }
.qs-howlink svg { transform:rotate(180deg); }
button.qs-step-row { width:100%; border:0; background:none; padding:4px 0; font:inherit; color:inherit; text-align:left; min-height:44px; cursor:pointer; }
button.qs-step-row .qs-chev { flex:0 0 auto; color:var(--ink-soft); }
button.qs-step-row .qs-chev svg { transform:rotate(180deg); }
.qs-next { font-size:13px; color:var(--ink-soft); }
.qs-next b { color:var(--ink); }
.qs-evtap { display:flex; align-items:center; gap:12px; width:100%; border:0; background:none; padding:0; font:inherit; color:inherit; text-align:left; }
.qs-sheet-host { position:absolute; inset:0; z-index:55; display:flex; align-items:flex-end; justify-content:center; background:rgba(42,38,34,.45); animation: fade-in 160ms ease-out both; }
.qs-sheet { position:relative; min-height:0; gap:12px; }
.qs-sheet .qs-x { position:absolute; right:12px; top:10px; }
.qs-sheet-title { font-family:var(--font-ui); font-weight:700; font-size:19px; line-height:1.2; padding-right:48px; }
.qs-sheet-sub { font-size:13px; color:var(--ink-soft); }
.qs-sheet p { margin:0; line-height:1.45; }
.qs-lbl { font-size:12px; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--ink-soft); margin-top:4px; }
.qs-need { display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:var(--radius-sm); background:#FBF1D4; box-shadow:inset 0 0 0 1.5px var(--gold); font-size:13px; }
.qs-need .semi { font-size:14px; }
.qs-src { display:flex; flex-direction:column; gap:6px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--plaster); }
.qs-src .row { gap:10px; }
.qs-src .pts { flex:0 0 auto; font-weight:700; font-size:13px; }
.qs-src .hint { line-height:1.35; }
.qs-src .btn { align-self:flex-start; }
.qs-steps { display:flex; flex-direction:column; gap:6px; }
.qs-tstep { display:flex; align-items:flex-start; gap:10px; font-size:13px; line-height:1.35; }
.qs-tstep .n { flex:0 0 28px; height:28px; border-radius:50%; display:grid; place-items:center; font-weight:700; background:var(--plaster); box-shadow:inset 0 0 0 1.5px var(--plaster-line); }
.qs-tstep.is-reached .n { background:var(--ink); color:var(--paper); box-shadow:none; }
.qs-tstep .pts { color:var(--ink-soft); white-space:nowrap; }
.qs-sheet-acts { display:flex; flex-direction:column; gap:8px; position:sticky; bottom:calc(-18px - var(--safe-bottom)); margin:0 -18px calc(-18px - var(--safe-bottom)); padding:10px 18px calc(18px + var(--safe-bottom)); background:var(--paper); box-shadow:0 -2px 0 rgba(42,38,34,.08); }
.qs-sheet .swatch.is-faint { opacity:.4; }
.qs-prev { display:flex; flex-wrap:wrap; gap:10px; }
.qs-prev .it { display:flex; align-items:center; gap:6px; font-size:13px; }
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
  const tap = !q.claimed;
  return h`<div class="card qs-quest ${tap ? 'is-tap' : ''} ${q.done && !q.claimed ? 'is-done' : ''} ${q.claimed ? 'is-claimed' : ''}" data-quest="${q.id}"${tap ? h` data-action="how" data-kind="daily" data-id="${q.id}" data-tap role="button" tabindex="0" aria-label="${q.text}: how to do it"` : ''}>
    <div class="row between"><div class="semi">${q.text}</div>${tap && !q.done ? h`<span class="qs-howlink" aria-hidden="true">How${iconSvg('back', { size: 14 })}</span>` : ''}</div>
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
      <div class="stack stack-sm" style="gap:0">${w.steps.map((s, i) => h`<button type="button" class="qs-step-row" data-action="how" data-kind="weekly" data-index="${i}" data-tap aria-label="${s.text}: how to do it">
        <span class="qs-tick ${s.done ? 'is-done' : ''}" aria-hidden="true">${s.done ? iconSvg('check', { size: 14 }) : ''}</span>
        <div class="grow ${s.done ? 'muted' : ''}"><span class="${s.done ? '' : 'semi'}">${s.text}</span></div>
        ${s.n > 1 && !s.done ? h`<span class="hint num nowrap">${Math.max(0, s.n - s.progress)} more</span>` : ''}
        <span class="sr-only">${s.done ? 'Done' : 'Not yet'}</span>${s.done ? '' : h`<span class="qs-chev" aria-hidden="true">${iconSvg('back', { size: 16 })}</span>`}</button>`)}</div>
      ${w.done ? '' : h`<div class="hint">Tap a step to see how to do it.</div>`}
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
  const palette = ctx.sim.eventColors(ev.id).map((c) => c.hex).slice(0, 12);
  const found = ctx.sim.eventColors(ev.id).filter((c) => ctx.sim.knowsColor(state, c.id)).length;
  const guide = eventGuide(state);
  return h`<div class="qs-sec" data-section="event"><h2 class="qs-sech">This week's event</h2>
      ${claimable.length ? h`<span class="chip is-on">${claimable.length} ready to claim</span>` : ''}</div>
    <div class="card" data-event>
      <button type="button" class="qs-evtap" data-action="how" data-kind="event" data-tap aria-label="${ev.name}: how the event works"><span aria-hidden="true">${pennantSvg(ev.palette, 52)}</span>
        <div class="grow"><div class="qs-h" style="font-size:18px">${ev.name}</div><div class="hint">${region ? (ctx.sim.hunters.unlocked(state) ? `The ${region.name} is open on your map. Its limited colors are found there.` : `The ${region.name} opens on your map once you have hunters.`) : ''}</div></div>
        <span class="qs-howlink" aria-hidden="true">How${iconSvg('back', { size: 14 })}</span></button>
      ${palette.length ? h`<div class="stack stack-sm"><div class="hint">This week's limited colors${found ? ` (${found} found)` : ''}</div><div class="qs-pal">${palette.map((hx) => swatch(safeHex(hx), 22))}</div></div>` : ''}
      <div class="hint"><b class="semi">This week's twist:</b> ${ev.twist.text}</div>
      <div class="divider"></div>
      <div class="row between"><div><div class="qs-big num">${fmt(pts)}</div><div class="hint">event points so far</div></div>
        <div class="hint" style="text-align:right;max-width:55%">${next ? `${plural(next.points - pts, 'more point')} to step ${next.step}` : 'Every step reached. Lovely.'}</div></div>
      ${guide && guide.next ? h`<div class="qs-next" data-event-next>Next: <b>${guide.next.reward.label}</b>. ${aboutActions(guide.next.actions)}</div>` : ''}
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
          : h`<button type="button" class="${cls}" data-action="how" data-kind="event" data-section="track" data-tap aria-label="Step ${s.step}: ${rv.label}${s.claimed ? ', claimed' : ''}. What each step gives">${inner}</button>`;
      }), { cls: 'qs-track', label: 'Event track' })}
      ${button('How to earn event points', { block: true, attrs: { 'data-action': 'how', 'data-kind': 'event' } })}
      <div class="hint">This event comes back in the rotation, and your points are saved, so there is never a rush.</div>
    </div>`;
}

/** "That is about 1 board or 2 orders." from eventGuide().next.actions. */
function aboutActions(actions = []) {
  const list = actions.slice(0, 2).map((a) => a.text);
  if (!list.length) return '';
  return `That is about ${list.join(' or ')}.`;
}

function build(state) {
  const q = state.quests || {};
  if (!(q.daily && q.daily.length) && !q.weekly && !(state.event && state.event.key)) return emptyQuests();
  return h`${introLine(state)}
    ${dailySection(state)}${weeklySection(state)}${sealShopSection(state)}${eventSection(state)}`;
}

/**
 * "How quests work", for first-timers (until her first claim, then one short line).
 */
function introLine(state) {
  if (isSeen(state, 'questsNext')) {
    return h`<div class="qs-note" data-seals-note><span aria-hidden="true">${sealIcon(18)}</span><span>Tap any quest to see how to do it. Seals buy things in the shop below.</span></div>`;
  }
  return h`<div class="qs-intro" data-quests-intro><span aria-hidden="true">${sealIcon(22)}</span><div><b>How quests work.</b> Three little goals arrive each morning; tap one to see how to do it and go straight there. Finish it for <b>Seals</b>, the wax stamps that buy things in the shop below. Unfinished ones simply make way for new ones.</div></div>`;
}

const SHOP_WHY = { seals: 'Not enough Seals yet', shelf: 'Opens with the Merge Shelf', full: 'The shelf is full', home: 'Everyone is home' };

/** What Seals buy (src/sim/seals.js): boosts, a crate of vials, calling the hunters home. */
function sealShopSection(state) {
  const offers = ctx.sim.seals.sealOffers(state);
  const boosts = (state.boosts || []).filter((b) => b.until > ctx.game.now());
  const left = boosts.length ? Math.max(...boosts.map((b) => b.until)) - ctx.game.now() : 0;
  return h`<div class="qs-sec" data-section="seal-shop"><h2 class="qs-sech">Spend Seals</h2>${left > 0 ? h`<span class="hint">A boost is running, about ${Math.max(1, Math.round(left / 60e3))} min left</span>` : ''}</div>
    ${offers.map((o) => h`<div class="card tight" style="flex-direction:row;align-items:center;gap:12px;text-align:left" data-seal-item="${o.id}">
      <div class="grow stack stack-sm"><div class="semi">${o.name}</div><div class="hint">${o.ok || o.reason === 'seals' ? o.blurb : SHOP_WHY[o.reason] || o.blurb}</div></div>
      ${button(h`${sealIcon(14)} ${fmt(o.cost)}`, { small: true, variant: o.ok ? 'primary' : 'paper', attrs: { 'data-action': 'seal-buy', 'data-item': o.id, 'aria-disabled': o.ok ? 'false' : 'true', 'aria-label': `${o.name} for ${o.cost} Seals` } })}
    </div>`)}`;
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
// How-to sheets (sim/howto.js): explain, show what is still needed, take her there
// ---------------------------------------------------------------------------

let sheet = null; // {host, kind, id, index, html}

const goAttrs = (g) => ({ 'data-action': 'go', 'data-screen': g.screen, 'data-params': JSON.stringify(g.params || {}) });

/** A requirement box: what to open first, its price and a button that goes there. */
function needBox(need, { primary = true } = {}) {
  if (!need) return '';
  return h`<div class="qs-need" data-need="${need.need}"><div class="semi">${need.title}</div><div>${need.text}</div>
    ${button(need.cta, { variant: primary ? 'primary' : 'paper', small: !primary, attrs: goAttrs(need.go) })}</div>`;
}

function questSheetHtml(state) {
  const q = state.quests || {};
  let item = null;
  let title = '';
  let reward = '';
  if (sheet.kind === 'daily') {
    item = (q.daily || []).find((x) => x.id === sheet.id) || null;
    if (item) {
      title = item.text;
      const r = item.reward || {};
      reward = `+${fmt(fin(r.seals))} Seals${fin(r.boostMin) > 0 ? ` and a ${r.boostMin}-minute boost` : ''}`;
    }
  } else if (sheet.kind === 'weekly') {
    item = q.weekly && q.weekly.steps ? q.weekly.steps[sheet.index] || null : null;
    if (item) {
      title = item.text;
      const w = q.weekly;
      const def = ctx.content.getWeeklyQuest(w.id);
      reward = `A step of ${def ? def.name : 'this week\'s quest'}: finish every step for ${fmt(fin(w.reward && w.reward.seals))} Seals and ${RARE_LABEL[w.reward && w.reward.rare] || 'a rare find'}.`;
    }
  }
  if (!item) return null;
  const g = questGuide(state, item);
  const target = fin(item.target ?? item.n, 1);
  const prog = Math.min(target, fin(item.progress));
  const status = g.done ? (sheet.kind === 'daily' && !item.claimed ? 'Done! Claim it on its card for your Seals.' : 'Done. Nicely finished.')
    : prog > 0 ? `${g.left} more to go. Lovely progress.` : (target > 1 ? `${target} to go.` : 'One to go.');
  const main = g.done ? button('Close', { variant: 'primary', block: true, attrs: { 'data-action': 'how-close' } })
    : g.need ? button('Close', { block: true, attrs: { 'data-action': 'how-close' } })
      : h`${button(h`Take me there: ${g.cta}`, { variant: 'primary', block: true, attrs: { ...goAttrs(g.go), 'data-coach': 'quests-go' } })}${button('Close', { block: true, attrs: { 'data-action': 'how-close' } })}`;
  return h`<div class="qs-sheet-title">${title}</div>
    ${progressBar(target > 0 ? prog / target : 0, { label: title })}
    <div class="qs-sheet-sub">${status}</div>
    <div class="qs-lbl">How to do it</div>
    <p data-how>${g.how}</p>
    ${g.done ? '' : needBox(g.need)}
    ${reward ? h`<div class="qs-reward">${sealIcon(14)}<span>${reward}</span></div>` : ''}
    <div class="qs-sheet-acts">${main}</div>`;
}

function eventSheetHtml(state) {
  const g = eventGuide(state);
  if (!g) return null;
  const S = ctx.sim;
  const limited = S.eventColors(g.id);
  const left = g.limited.total - g.limited.found;
  const next = g.next;
  const twistNeed = g.twist.need;
  const banners = (state.cosmetics || []).filter((c) => /-banner$/.test(c)).map((c) => ctx.content.getEvent(c.replace(/-banner$/, ''))).filter(Boolean);
  return h`<div class="qs-sheet-title">${g.name}</div>
    <div class="qs-sheet-sub">${fmt(g.points)} event points so far. ${next ? h`Next is step ${next.step}: <b>${next.reward.label}</b>, ${plural(next.left, 'more point')} away. ${aboutActions(next.actions)}` : 'Every step of the track is reached. Lovely.'}</div>

    <div class="qs-lbl" data-sheet-section="points">How to earn event points</div>
    ${g.sources.map((src) => h`<div class="qs-src" data-source="${src.kind}">
      <div class="row between"><span class="semi">${src.label}</span><span class="pts">+${src.points} pts</span></div>
      <div class="hint">${src.how}</div>
      ${src.need ? needBox(src.need, { primary: false }) : button(h`Go: ${src.cta}`, { small: true, attrs: goAttrs(src.go) })}
    </div>`)}

    <div class="qs-lbl" data-sheet-section="limited">This week's limited colors</div>
    <div class="qs-pal">${limited.map((c) => (S.knowsColor(state, c.id) ? swatch(c.hex, 26, { label: S.displayName(state, c.id) }) : swatch(c.hex, 26, { cls: 'is-faint', label: 'A limited color to collect' })))}</div>
    <div class="hint">${left > 0 ? `${g.limited.found ? `${g.limited.found} found, ` : ''}${plural(left, 'more color')} to collect. They join your catalog for good.` : 'Every limited color is yours. Lovely.'}</div>
    ${left > 0 ? g.limited.ways.map((w) => h`<div class="qs-src"><div class="hint" style="color:var(--ink)">${w.how}</div>${w.need ? needBox(w.need, { primary: false }) : w.go ? button(h`Go: ${w.cta}`, { small: true, attrs: goAttrs(w.go) }) : ''}</div>`) : ''}

    <div class="qs-lbl" data-sheet-section="twist">This week's twist</div>
    <div class="qs-src"><div class="semi">${g.twist.text}</div><div class="hint">${g.twist.how}</div>
      ${twistNeed ? needBox(twistNeed, { primary: false }) : button(h`Go: ${g.twist.cta}`, { small: true, attrs: goAttrs(g.twist.go) })}</div>
    ${g.preview.length ? h`<div class="qs-src" data-preview><div class="semi">Era 2 preview</div>
      <div class="qs-prev">${g.preview.map((c) => h`<span class="it">${swatch(c.hex, 26)}${c.name}</span>`)}</div>
      <div class="hint">A peek at the Synthetics to come. They glow on this week's boards; you can collect them once Era 2 arrives.</div>${tag('Era 2: coming in a later update')}</div>` : ''}

    <div class="qs-lbl" data-sheet-section="track">The reward track</div>
    <div class="hint">Event points fill the track; each step you reach is yours to claim on the track above. Steps 1 to 6 take about 20 minutes of play over the week; the rest are for fun.</div>
    <div class="qs-steps">${g.track.map((t) => h`<div class="qs-tstep ${t.reached ? 'is-reached' : ''}"><span class="n">${t.claimed ? iconSvg('check', { size: 14 }) : t.step}</span>
      <div class="grow"><b>${t.reward.label}</b>${t.reward.detail ? h`: ${t.reward.detail}` : ''}</div><span class="pts num">${fmt(t.points)} pts</span></div>`)}</div>
    ${banners.length ? h`<div class="hint">Your keepsake banners: ${banners.map((e) => e.name).join(', ')}.</div>` : ''}
    <div class="hint">This event comes back in the rotation, and your points are saved.</div>
    <div class="qs-sheet-acts">${button('Close', { variant: 'primary', block: true, attrs: { 'data-action': 'how-close' } })}</div>`;
}

function paintSheet() {
  if (!sheet) return;
  const state = ctx.game.state;
  const inner = sheet.kind === 'event' ? eventSheetHtml(state) : questSheetHtml(state);
  if (inner === null) { closeSheet(); return; }
  const html = String(h`<button type="button" class="btn-back qs-x" data-action="how-close" data-tap aria-label="Close">${iconSvg('close', { size: 20 })}</button>${inner}`);
  if (html === sheet.html) return;
  sheet.html = html;
  const panel = sheet.host.querySelector('.qs-sheet');
  const top = panel.scrollTop;
  panel.innerHTML = html;
  panel.scrollTop = top;
}

function openSheet(kind, { id = null, index = null } = {}) {
  closeSheet();
  const host = document.createElement('div');
  host.className = 'qs-sheet-host';
  host.setAttribute('data-quest-sheet', kind);
  host.innerHTML = '<div class="sheet qs-sheet" role="dialog" aria-modal="true" aria-label="How to do it" tabindex="-1"></div>';
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  sheet = { host, kind, id, index, html: '', onKey };
  document.addEventListener('keydown', onKey);
  // Buttons inside bubble to root's click listener (onClick); a tap on the dim backdrop closes.
  host.addEventListener('click', (e) => { if (e.target === host) closeSheet(); });
  root.scrollTop = 0; // the section itself never scrolls (its body does); keep the sheet anchored to the screen
  root.appendChild(host);
  paintSheet();
  const panel = host.querySelector('.qs-sheet');
  try { panel.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  if (!ctx.fx.isReducedMotion || !ctx.fx.isReducedMotion()) {
    ctx.fx.spring(panel, { from: { transform: 'translateY(40px)', opacity: 0.4 }, to: { transform: 'translateY(0px)', opacity: 1 }, preset: 'soft' });
  }
}

function closeSheet() {
  if (!sheet) return;
  const s2 = sheet;
  sheet = null;
  document.removeEventListener('keydown', s2.onKey);
  s2.host.remove();
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
  if (a === 'how') {
    const kind = el.getAttribute('data-kind');
    if (kind === 'event') {
      openSheet('event');
      const sec = el.getAttribute('data-section');
      const target = sec && sheet && sheet.host.querySelector(`[data-sheet-section="${sec}"]`);
      const panel = sheet && sheet.host.querySelector('.qs-sheet');
      if (target && panel) panel.scrollTop = target.offsetTop - 12;
    }
    else if (kind === 'weekly') openSheet('weekly', { index: Number(el.getAttribute('data-index')) });
    else openSheet('daily', { id: el.getAttribute('data-id') });
    return;
  }
  if (a === 'how-close') { closeSheet(); return; }
  if (a === 'go') {
    let params = {};
    try { params = JSON.parse(el.getAttribute('data-params') || '{}') || {}; } catch (err) { params = {}; }
    const screenId = el.getAttribute('data-screen');
    closeSheet();
    if (screenId) ctx.navigate(screenId, params);
    return;
  }
  if (a === 'claim') {
    const qid = el.getAttribute('data-quest-id');
    const res = withFly(el, () => ctx.game.act(S.quests.claim, { questId: qid }), { stampId: qid });
    if (res && res.ok) {
      ctx.audio.coins(6);
      const extra = res.bankSeals ? ` (+${fmt(res.bankSeals)} from missed days)` : '';
      ctx.toast(`+${fmt(res.seals)} Seals${extra}${res.boostMin ? `, and a ${res.boostMin}-minute boost` : ''}`);
      firstClaimCard();
    }
  } else if (a === 'seal-buy') {
    const id = el.getAttribute('data-item');
    const res = ctx.game.act(S.seals.buySealItem, { id });
    if (res && res.ok) {
      ctx.audio.thunk(0.6);
      const item = S.seals.SEAL_SHOP_BY_ID[id];
      const msg = res.vials !== undefined ? `${res.vials} vials are on the shelf.`
        : res.recalled ? 'Your hunters are home. Their finds are on the map.'
          : `${item.name} is running.`;
      ctx.toast(msg);
    } else if (res && res.reason) ctx.toast(SHOP_WHY[res.reason] || 'Not right now');
    paint(ctx.game.state, true);
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
      more: { label: 'See the weekly', run: () => { const el = bodyEl && bodyEl.querySelector('[data-section="weekly"]'); if (el) bodyEl.scrollTop += el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 8; } },
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
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
        e.preventDefault();
        e.target.click();
      }
    });
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
        // Scroll only the screen body (scrollIntoView would also scroll #app and shift the screen).
        const t = bodyEl.querySelector(`[data-section="${params.section}"]`);
        if (t) bodyEl.scrollTop += t.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 8;
      });
    } else if (bodyEl) bodyEl.scrollTop = 0;
    if (params.how === 'event') openSheet('event');
    startGuide();
  },

  hide() {
    visible = false;
    closeSheet();
    clearTimeout(nextTimer);
    nextTimer = 0;
    stopGuide();
  },

  render(state) {
    if (!visible) return;
    paint(state);
    paintSheet();
  },
};

export default screen;
