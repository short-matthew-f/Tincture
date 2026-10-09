/**
 * ledger.js: the Morning Ledger (screen id `ledger`, an overlay with a back button).
 *
 * Owns: the return summary page ported from docs/prototypes/Ledger.dc.html:
 * title, away time, one tappable line per little thing (made colors with
 * swatches, coins earned with a rolling number, hunters home, postcards,
 * orders, vials, canvases, quests), the "Almost there" strip, the big ink "All
 * caught up" stamp, and "Close up shop" / "Back to the workshop" buttons.
 * Implements DESIGN.md "Core loop > Check-in surface", "Open loops" and
 * "Stopping points".
 *
 * Data: show({summary}) uses that LedgerSummary; otherwise state.ledger.pending;
 * otherwise a live summary of what is still waiting. Informational lines (screen
 * "workshop" without params) are acknowledged in place; the others tick off and
 * navigate to their screen. When every line is handled and nothing else waits,
 * the stamp lands (audio.stamp + haptics.medium + a ring) after
 * `sim.ledger.markCaughtUp`. Leaving the screen clears state.ledger.pending.
 *
 * data-action names: ledger-line, ledger-almost, ledger-close-up,
 * ledger-close-up-reopen, ledger-back.
 */

import { h, raw, button, iconSvg, swatch, backButton, safeHex } from './kit.js';
import defaultFx from './fx.js';
import defaultAudio from './audio.js';
import defaultHaptics from './haptics.js';
import { ensureStyles, closeUpFlow, waitText, bindTouchFeel, squashOnce } from './workshop.js';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const doc = () => (typeof document !== 'undefined' ? document : null);

function ensureLedgerStyles() {
  const d = doc();
  if (!d || d.getElementById('ld-style')) return;
  const s = d.createElement('style');
  s.id = 'ld-style';
  s.textContent = `
.ld-body { gap: 14px; }
.ld-page { position: relative; background: var(--paper); border-radius: 6px 6px 18px 18px; padding: 20px 16px 14px; box-shadow: 0 4px 0 rgba(42,38,34,.24); display: flex; flex-direction: column; gap: 4px; }
.ld-titlerow { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ld-title { font-family: var(--font-ui); font-weight: 700; font-size: 22px; line-height: 1.2; }
.ld-title.is-name { font-family: var(--font-display); font-weight: 400; font-size: 26px; line-height: 1.15; }
.ld-away { font-size: 13px; font-weight: 600; color: var(--walnut); }
.ld-lede { font-size: 14px; color: var(--ink-soft); }
.ld-warm { margin-top: 10px; padding: 14px 2px 4px; border-top: 1px dashed #CFC6B8; font-size: 15px; line-height: 1.35; color: var(--ink); }
.ld-lines { margin-top: 12px; display: flex; flex-direction: column; }
.ld-line { min-height: 58px; border-top: 1px dashed #CFC6B8; display: flex; align-items: center; gap: 12px; padding: 8px 2px; text-align: left; width: 100%; transition: opacity 160ms; }
.ld-line.done { opacity: .55; }
.ld-tile { width: 34px; height: 34px; border-radius: 9px; box-shadow: 0 2px 0 rgba(42,38,34,.25); flex: 0 0 auto; display: flex; align-items: center; justify-content: center; color: var(--paper); }
.ld-line .tt { font-size: 15px; font-weight: 600; line-height: 1.25; }
.ld-line .ss { font-size: 13px; color: var(--ink-soft); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ld-line .aa { display: inline-flex; align-items: center; gap: 2px; min-height: 32px; padding: 0 6px 0 12px; border-radius: 999px; background: var(--plaster); box-shadow: 0 2px 0 var(--shadow-soft); font-size: 13px; font-weight: 600; color: var(--walnut); flex: 0 0 auto; }
.ld-line .aa svg { transform: rotate(180deg); width: 14px; height: 14px; }
.ld-line.done .aa { background: transparent; box-shadow: none; }
.ld-line .grow { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.ld-line .nx { font-size: 13px; color: var(--walnut); margin-top: 2px; }
.ld-empty { padding: 14px 2px 6px; border-top: 1px dashed #CFC6B8; color: var(--ink-soft); font-size: 14px; }
.ld-chip { display: inline-block; width: 16px; height: 16px; border-radius: 5px; box-shadow: 0 1px 0 rgba(42,38,34,.25); }
.ld-stampzone { position: relative; align-self: center; width: 100%; height: 88px; margin: 10px 0 2px; pointer-events: none; }
.ld-line, .ld-almost button { touch-action: manipulation; }
.ld-line.is-held { background: var(--plaster); border-radius: 12px; box-shadow: 0 4px 0 var(--shadow-soft); }
.ld-almost { display: flex; flex-direction: column; gap: 4px; }
.ld-almost button { display: flex; align-items: center; gap: 10px; min-height: 44px; width: 100%; text-align: left; font-size: 14px; }
[data-screen="ledger"] .card > .card-title { font-family: var(--font-ui); font-weight: 600; font-size: 15px; }
.ld-almost .sw { width: 14px; height: 14px; border-radius: 4px; flex: 0 0 auto; }
.ld-bottom { display: flex; flex-direction: column; gap: 10px; margin-top: auto; padding-top: 6px; }
.ld-bottom .ws-closed { background: var(--walnut-deep); color: var(--paper); box-shadow: 0 3px 0 rgba(0,0,0,.6); }
`;
  d.head.appendChild(s);
}

// action: the small pill on the right. next: the next step, so every line lands with
// its result (the title) AND where it leads (this line). rank: results first, chores after.
const ICON_STYLE = {
  jar: { hex: '#D39B2A', action: 'Got it', rank: 0, next: 'Safe in your vats, ready to sell or ship.' },
  coin: { hex: '#C99A2E', action: 'Got it', rank: 0, next: 'Already in your purse. A good time for an upgrade.' },
  cart: { hex: '#9A6A47', action: 'Open', rank: 0, next: 'The cart is back. Send the next load from the Fleet.' },
  hunter: { hex: '#6E4A7E', action: 'Open', rank: 1, next: 'See what they found, then send them out again.' },
  postcard: { hex: '#6E4A7E', action: 'Open', rank: 1, next: 'Open it and pin it to the board.' },
  swatch: { hex: '#D39B2A', action: 'View', rank: 1, next: 'Look them over in your catalog.' },
  collector: { hex: '#D98A8F', action: 'View', rank: 2, next: 'See the offer in the gallery.' },
  canvas: { hex: '#2F8A8A', action: 'Open', rank: 2, next: 'Start painting it in the gallery.' },
  order: { hex: '#DE7A2E', action: 'View', rank: 3, next: 'Pick one on the board to fill.' },
  vial: { hex: '#8FA77A', action: 'Merge', rank: 3, next: 'Merge a matching pair on the shelf.' },
  sparkle: { hex: '#E2B04A', action: 'Claim', rank: 3, next: 'Tap it at the mixer to claim.' },
  tube: { hex: '#8FA77A', action: 'Purify', rank: 3, next: 'A short puzzle brings back the full price.' },
  quest: { hex: '#3E6A9E', action: 'Claim', rank: 3, next: 'Claim it for Seals. Spend them on boosts and vials under Quests.' },
  event: { hex: '#3E6A9E', action: 'Claim', rank: 3, next: 'Claim it for Seals. Spend them on boosts and vials under Quests.' },
  pin: { hex: '#B8433A', action: 'Open', rank: 3, next: 'Open it to see where to find it.' },
  commission: { hex: '#3E6A9E', action: 'Open', rank: 3, next: 'Open the commission to deliver.' },
  room: { hex: '#7B5236', action: 'View', rank: 3, next: 'Have a look at the new room.' },
};

/** "3 days", "5 hours", "1 day 4 hours": words, not abbreviations. */
function awayWords(ms) {
  const mins = Math.max(1, Math.round(ms / 60e3));
  const d = Math.floor(mins / 1440);
  const hr = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const u = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d > 0) return hr > 0 ? `${u(d, 'day')} ${u(hr, 'hour')}` : u(d, 'day');
  if (hr > 0) return m > 0 && hr < 6 ? `${u(hr, 'hour')} ${u(m, 'minute')}` : u(hr, 'hour');
  return u(m, 'minute');
}

/** Results first, chores after; stable within each group. */
function ordered(list) {
  return list.map((ln, i) => ({ ln, i, r: (ICON_STYLE[ln.icon] || { rank: 3 }).rank }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.ln);
}

/** Sim copy tuned for the page: a pile of vials is something to merge, not a chore list. */
function lineText(ln) {
  const m = /^(\d+) vials waiting on the shelf$/.exec(ln.text || '');
  return m ? `${m[1]} vials ready to merge` : ln.text;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let summary = null;
let lines = [];
let done = new Set();
let stamped = false;
let stampSettled = false; // true once the stamp has landed: later repaints draw it already inked
let rolled = false;
let closedInfo = null;
let visible = false;

const S = () => ctx.game.state;
const sim = () => ctx.sim;
const fx = () => ctx.fx || defaultFx;
const audio = () => ctx.audio || defaultAudio;
const haptics = () => ctx.haptics || defaultHaptics;
const fmt = (n) => ctx.format.num(n);
const hexOf = (id) => ctx.sim.economy.colorHex(id);

function liveSummary() {
  const s = S();
  const t = ctx.game.now();
  const sum = sim().ledger.buildReturnSummary(s, sim().ledger.snapshot(s), t);
  sum.away = 0;
  sum.awayText = '';
  return sum;
}

const isInfo = (ln) => ln.screen === 'workshop' && !(ln.params && Object.keys(ln.params).length);

function lineHex(ln) {
  const p = ln.params || {};
  const id = p.color || p.colorId || (Array.isArray(p.colors) ? p.colors[0] : null);
  if (id) { try { return hexOf(id); } catch (e) { /* fall through */ } }
  return (ICON_STYLE[ln.icon] || { hex: '#7B5236' }).hex;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function lineSub(ln) {
  const p = ln.params || {};
  if (ln.icon === 'jar' && summary.produced && summary.produced.length) {
    const top = summary.produced.slice(0, 6);
    return h`${top.map((x) => h`<span class="ld-chip" style="background:${safeHex(hexOf(x.color))}" title="${sim().displayName(S(), x.color)}"></span>`)}<span>${top.map((x) => sim().displayName(S(), x.color)).slice(0, 3).join(', ')}</span>`;
  }
  if (ln.icon === 'hunter' && p.hunterId) {
    const home = (summary.huntersHome || []).find((x) => x.hunterId === p.hunterId);
    if (home && home.wild) return h`<span class="ld-chip" style="background:${safeHex(hexOf(home.wild))}"></span><span>${sim().displayName(S(), home.wild)}, a new wild hue</span>`;
  }
  if (ln.icon === 'swatch' && Array.isArray(p.colors)) {
    return h`${p.colors.slice(0, 6).map((id) => h`<span class="ld-chip" style="background:${safeHex(hexOf(id))}"></span>`)}`;
  }
  return '';
}

function lineHtml(ln, i) {
  const st = ICON_STYLE[ln.icon] || { hex: '#7B5236', action: 'Open' };
  const isDone = done.has(i);
  const sub = lineSub(ln);
  const coins = ln.icon === 'coin' && num(summary.coinsEarned) >= 1;
  const text = lineText(ln);
  const title = coins
    ? h`Earned <span data-roll class="num">${fmt(Math.round(summary.coinsEarned))}</span> Coins while you were away`
    : text;
  const action = isDone ? 'Done' : isInfo(ln) ? 'Got it' : st.action;
  return h`<button type="button" class="ld-line${isDone ? ' done' : ''}" data-action="ledger-line" data-i="${i}" data-lift="1.02" data-tap aria-label="${text}${isDone ? ', done' : ''}">
<span class="ld-tile" style="background:${safeHex(lineHex(ln))}">${isDone ? iconSvg('check', { size: 18 }) : ''}</span>
<span class="grow"><span class="tt">${title}</span>${sub ? h`<span class="ss">${sub}</span>` : ''}${st.next ? h`<span class="nx">${st.next}</span>` : ''}</span>
<span class="aa">${action}${isDone ? '' : iconSvg('back', { size: 14 })}</span></button>`;
}

/** The "All caught up" stamp zone. fx.stamp drops the ink stamp into it; once it has landed, repaints draw it already inked. */
function stampZone() {
  const inked = stampSettled
    ? raw('<div class="fx-stamp is-kept is-inked" aria-hidden="true" style="transform:translate(-50%,-50%) rotate(-8deg);--stamp-ink:#8E2F2A"><span>All caught up</span></div>')
    : '';
  return h`<div class="ld-stampzone" data-stamp role="img" aria-label="All caught up">${inked}</div>`;
}

function almostHtml() {
  const items = summary.almostThere && summary.almostThere.length ? summary.almostThere : [];
  if (!items.length) return '';
  return h`<div class="card"><div class="card-title">Almost there</div><div class="ld-almost">${items.map((it, i) => {
    const p = it.params || {};
    const id = p.color || p.colorId;
    let hex = (ICON_STYLE[it.icon] || { hex: '#7B5236' }).hex;
    if (id) { try { hex = hexOf(id); } catch (e) { /* keep */ } }
    return h`<button type="button" data-action="ledger-almost" data-i="${i}" data-lift="1.02" data-tap><span class="sw" style="background:${safeHex(hex)}"></span><span class="grow">${it.text}</span></button>`;
  })}</div></div>`;
}

function build() {
  const away = num(summary.away);
  const awayText = away >= 60e3 ? `You were away ${awayWords(away)}` : '';
  const fill = sim().storage.fillTimeMs(S());
  const closeLabel = closedInfo
    ? (Number.isFinite(fill) && fill > 0 ? `Shop closed. Vats fill in ${waitText(ctx.format, fill)}` : 'Shop closed. Everything is set for tomorrow')
    : 'Close up shop';
  // One title at a time: the nav says "Welcome back" after an absence, and the card carries
  // the ledger's name; otherwise the nav is the name and the card says something warm.
  const named = away >= 60e3;
  const cardTitle = named ? 'Morning Ledger' : lines.length ? 'Waiting for you' : 'All tended';
  const calm = !lines.length;
  const caughtUp = stamped || calm;
  return h`
<div class="screen-head">${backButton('Back to the workshop')}<div class="titles"><div class="title">${away >= 60e3 ? 'Welcome back' : 'Morning Ledger'}</div></div><div class="spacer"></div></div>
<div class="screen-body ld-body" data-ref="body">
  <div class="ld-page" data-ref="page">
    <div class="ld-titlerow"><div class="ld-title${named ? ' is-name' : ''}">${cardTitle}</div></div>
    ${awayText ? h`<div class="ld-away">${awayText}</div>` : ''}
    ${calm ? '' : h`<div class="ld-lede">${named ? 'Here is what the workshop got up to. Tap a line to look closer.' : 'A few little things are waiting. Tap a line to look closer.'}</div>`}
    <div class="ld-lines">${calm ? h`<div class="ld-warm">Nothing needs you right now. The workshop is humming along on its own, and your vats keep filling while you rest.</div>` : lines.map(lineHtml)}</div>
    ${stamped && !calm ? h`<div class="ld-warm" data-warm>Everything is tended. Your vats keep filling while you rest.</div>` : ''}
    ${stamped ? stampZone() : ''}
  </div>
  ${almostHtml()}
  <div class="ld-bottom">
    ${button(closeLabel, { variant: caughtUp || closedInfo ? 'primary' : 'wood', block: true, cls: `tall${closedInfo ? ' ws-closed' : ''}`, attrs: { 'data-action': closedInfo ? 'ledger-close-up-reopen' : 'ledger-close-up', 'data-coach': 'close-up-ledger' } })}
    ${button('Back to the workshop', { block: true, attrs: { 'data-action': 'ledger-back' } })}
  </div>
</div>`;
}

function paint() {
  root.innerHTML = String(build());
  if (!rolled) {
    rolled = true;
    const r = root.querySelector('[data-roll]');
    if (r && summary) fx().rollNumber(r, 0, Math.round(num(summary.coinsEarned)), { ms: 800, format: fmt });
  } else {
    const r = root.querySelector('[data-roll]');
    if (r) r.textContent = fmt(Math.round(num(summary.coinsEarned)));
  }
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

function clearPending() {
  if (S().ledger && S().ledger.pending) ctx.game.act((s) => { s.ledger.pending = null; });
}

function landStamp() {
  if (stamped) return;
  stamped = true;
  stampSettled = false;
  paint();
  stampSettled = true;
  // An ink stamp drops onto the page, squashes on contact, thunks (audio + medium haptic come with it) and the ink spreads.
  fx().stamp(root.querySelector('[data-stamp]'), 'All caught up', { keep: true, hex: '#8E2F2A' });
}

/** When every line is handled and nothing else waits, the stamp lands. */
function checkCaughtUp() {
  if (stamped || !visible) return;
  if (lines.length && done.size < lines.length) return;
  // markCaughtUp clears the pending summary and, when nothing else waits, records
  // the moment and emits 'allCaughtUp' (also when she handled things elsewhere first).
  if (!sim().ledger.isAllCaughtUp(S()) && !(S().ledger && S().ledger.pending)) return;
  const res = ctx.game.act(sim().ledger.markCaughtUp);
  if (res && res.ok) landStamp();
}

function soundFor(ln) {
  const a = audio();
  switch (ln.icon) {
    case 'coin': a.coins(6); break;
    case 'jar': a.clink(1); break;
    case 'hunter': case 'postcard': a.knock(); break;
    case 'vial': case 'canvas': a.clink(2); break;
    default: a.note(0.3 + Math.min(0.5, done.size * 0.1)); break;
  }
}

function onClick(e) {
  if (e.target.closest('[data-back]')) { clearPending(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  switch (el.dataset.action) {
    case 'ledger-line': {
      const i = Number(el.dataset.i);
      const ln = lines[i];
      if (!ln) break;
      if (done.has(i)) {
        if (!isInfo(ln)) ctx.navigate(ln.screen, ln.params || {});
        break;
      }
      done.add(i);
      soundFor(ln);
      haptics().light();
      paint();
      squashOnce(fx(), root.querySelector(`.ld-line[data-i="${i}"] .ld-tile`));
      if (isInfo(ln)) checkCaughtUp();
      else {
        clearPending();
        ctx.navigate(ln.screen, ln.params || {});
      }
      break;
    }
    case 'ledger-almost': {
      const it = (summary.almostThere || [])[Number(el.dataset.i)];
      if (it) { clearPending(); ctx.navigate(it.screen, it.params || {}); }
      break;
    }
    case 'ledger-close-up':
      closeUpFlow(ctx, root).then((r) => {
        if (!r) return;
        closedInfo = { fillMs: r.fillMs };
        if (visible) paint();
      });
      break;
    case 'ledger-close-up-reopen': closedInfo = null; paint(); break;
    case 'ledger-back': clearPending(); ctx.navigate('workshop'); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const screen = {
  id: 'ledger',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    ensureStyles();
    ensureLedgerStyles();
    root.addEventListener('click', onClick, true);
    bindTouchFeel(root, fx(), { lift: '.ld-line, .ld-almost button' });
    root.innerHTML = '';
  },

  show(params = {}) {
    if (!root) return;
    root.hidden = false;
    visible = true;
    const pending = S().ledger && S().ledger.pending;
    summary = (params && params.summary) || pending || liveSummary();
    lines = Array.isArray(summary.lines) ? ordered(summary.lines) : [];
    done = new Set();
    stamped = false;
    stampSettled = false;
    rolled = false;
    paint();
    checkCaughtUp();
  },

  hide() {
    if (!root) return;
    visible = false;
    clearPending();
    summary = null;
    lines = [];
    closedInfo = null;
    root.hidden = true;
  },

  render() {
    if (!visible || !summary) return;
    // The Close up label counts down live; the rest is static between taps.
    const b = root.querySelector('[data-coach="close-up-ledger"]');
    if (b && closedInfo) {
      const fill = sim().storage.fillTimeMs(S());
      const label = Number.isFinite(fill) && fill > 0 ? `Shop closed. Vats fill in ${waitText(ctx.format, fill)}` : 'Shop closed. Everything is set for tomorrow';
      if (b.textContent !== label) b.textContent = label;
    }
    checkCaughtUp();
  },
};

export default screen;
export const id = screen.id;
export const mount = screen.mount;
export const show = screen.show;
export const hide = screen.hide;
export const render = screen.render;
