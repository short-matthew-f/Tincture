/**
 * commissions.js: the Commissions overlay (screen id `commissions`).
 *
 * Implements DESIGN.md "Progression, eras and prestige > Commissions" and
 * "Era Advance": multi-step projects that ask for colors in quantity, never
 * expire, and pay Coins, a signature catalog color and a workshop trophy.
 * Each open commission lists its steps with progress bars (purity, container
 * and wild-hue badges), a Deliver button per step (a sheet of eligible stock
 * with a quantity stepper), the reward preview, and a celebration on
 * completion. The era capstone shows progress toward 80 colors and, once
 * done, an "Advance era" button (Era 2 is "coming in a later update").
 *
 * data-action names: `deliver` (data-commission, data-step), `complete`
 * (data-commission), `sheet-color` (data-color), `qty-dec`, `qty-inc`,
 * `qty-ten`, `qty-max`, `sheet-go`, `sheet-close`, `cele-close`,
 * `era-advance`.
 * Coach targets (the `commissions` guide): data-coach="commission-step" on the
 * first step row of the first open commission, "commission-deliver" on the
 * Deliver button of its first unfinished step.
 */

import { h, raw, iconSvg, button, backButton, tag, swatch, progressBar, safeHex, CONTAINER_NAMES } from './kit.js';
import { injectStyles, coinsWord, offerWhatsNext, SHARED_CSS } from './matching.js';
import { howThisWorksHtml, markGuideSeen } from './guide.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';

const FAMILY_PLURAL = Object.freeze({
  red: 'reds', orange: 'oranges', yellow: 'yellows', green: 'greens', teal: 'teals',
  blue: 'blues', violet: 'violets', pink: 'pinks', neutral: 'neutrals',
});
const PURITY_LABEL = Object.freeze({ pure: 'Pure or better', flawless: 'Flawless' });

const CSS = `
.cm-card { gap: 10px; }
.cm-name { font-family: var(--font-display); font-size: 19px; line-height: 1.2; }
.cm-step { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid rgba(42,38,34,0.1); }
.cm-step .top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cm-step .lbl { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 14px; }
.cm-step .lbl.done { color: var(--ink-soft); font-weight: 500; }
.cm-step .badges { display: flex; flex-wrap: wrap; gap: 6px; }
.cm-req { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 3px 11px; border-radius: 999px; background: var(--plaster); box-shadow: inset 0 0 0 1.5px var(--plaster-line); color: var(--ink); font-size: 12px; font-weight: 600; line-height: 1.1; }
.cm-req svg { width: 12px; height: 12px; }
.cm-step .btn { flex: 0 0 auto; padding: 0 16px; }
.cm-note { flex-direction: row; align-items: center; gap: 12px; animation: screen-in 260ms var(--ease-out) both; }
.cm-note .tx { flex: 1 1 auto; min-width: 0; font-size: 14px; }
.cm-note .tx .semi { display: block; }
.cm-note .btn { flex: 0 0 auto; padding: 0 14px; font-size: 14px; }
.cm-preview { opacity: 0.85; }
.cm-preview .cm-step .lbl { font-weight: 500; color: var(--ink-soft); }
.cm-ok { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; flex: 0 0 auto; }
.cm-reward { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid rgba(42,38,34,0.1); }
.cm-reward .it { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.cm-sil { width: 28px; height: 28px; border-radius: 8px; box-shadow: inset 0 0 0 2px rgba(42,38,34,0.28); flex: 0 0 auto; opacity: 0.45; }
.cm-cap { background: var(--glow); color: var(--glow-ink); box-shadow: 0 0 0 1.5px var(--glow-ring); border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
.cm-layer { position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-end; justify-content: center; }
.cm-layer[hidden] { display: none; }
.cm-layer.center { align-items: center; padding: 0 var(--gutter); }
.cm-back { position: absolute; inset: 0; background: rgba(42,38,34,0.45); animation: fade-in 160ms ease-out both; }
.cm-layer .sheet { position: relative; max-height: 86%; }
.cm-list { display: flex; flex-direction: column; gap: 6px; max-height: 230px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 2px; }
.cm-opt { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 10px; border-radius: 12px; background: var(--plaster); text-align: left; width: 100%; }
.cm-opt.is-sel { background: var(--paper); box-shadow: 0 0 0 3px var(--ink); }
.cm-opt .nm { font-weight: 600; font-size: 14px; flex: 1 1 auto; min-width: 0; }
.cm-opt .have { font-size: 12px; color: var(--ink-soft); }
.cm-stepper { display: flex; align-items: center; justify-content: center; gap: 8px; }
.cm-stepper .btn { min-width: 48px; min-height: 48px; padding: 0 12px; }
.cm-stepper .qty { min-width: 56px; text-align: center; font-size: 22px; font-weight: 700; }
.cm-cele { width: 100%; padding: 22px 18px 18px; gap: 12px; align-items: center; text-align: center; animation: screen-in 260ms var(--ease-out) both; }
.cm-cele .big { font-family: var(--font-ui); font-weight: 800; font-size: 24px; line-height: 1.15; }
.cm-cele .nm { font-family: var(--font-display); }
.cm-celebar { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.cm-cele .paid { display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 700; }
.cm-cele .paid small { font-size: 15px; font-weight: 600; color: var(--ink-soft); }
.cm-cele .gifts { display: flex; flex-direction: column; gap: 8px; align-items: center; font-size: 14px; }
.cm-cele .gifts .g { display: inline-flex; align-items: center; gap: 8px; text-align: left; }
.cm-empty { text-align: center; align-items: center; padding: 22px 16px; }
.cm-empty .oq-lockrow { align-items: center; }
.cm-done { display: flex; align-items: center; gap: 12px; min-width: 0; }
`;

const TROPHY = raw('<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8C6512" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M7 4 H17 V10 A5 5 0 0 1 7 10 Z" fill="#E2B04A"/><path d="M7 6 H4 V8 A3 3 0 0 0 7 11 M17 6 H20 V8 A3 3 0 0 1 17 11"/><path d="M12 15 V18 M8 20 H16 M9 18 H15"/></svg>');

const S = {
  ctx: null,
  root: null,
  body: null,
  layer: null,
  html: '',
  sheet: null, // {commissionId, stepIndex, colorId, qty}
  celeRolled: false,
  note: null, // {title, text, commissionId, nextStep}: what the last delivery did, and what comes next
  cele: null, // the finished commission's result page
  down: false,
  dirty: false,
  timers: [],
  guide: null,
  offer: null,
};

const stateOf = () => S.ctx.game.state;
const fmt = (n) => S.ctx.format.num(n);
const later = (fn, ms) => { S.timers.push(setTimeout(fn, ms)); };

function defOf(id) {
  const c = S.ctx.content;
  if (typeof c.getCommission === 'function') return c.getCommission(id);
  return (c.COMMISSIONS || []).find((x) => x.id === id) ?? null;
}

const titleCase = (id) => String(id || '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const jarsWord = (n) => (n === 1 ? 'jar' : 'jars');

function colorName(id) {
  const state = stateOf();
  if (state.catalog?.discovered?.[id]) return S.ctx.sim.displayName(state, id);
  return S.ctx.sim.colorDef(id)?.name ?? titleCase(id);
}

/** "blues", "Harbor Teal", "bright colors (reds, oranges, ...)". */
function whatOf(step) {
  if (step.colorId) return colorName(step.colorId);
  if (step.pigment) return colorName(step.pigment);
  if (step.family) return FAMILY_PLURAL[step.family] || step.family;
  if (step.families) {
    return step.families.length >= 9 ? 'colors of any family' : `colors (${step.families.map((f) => FAMILY_PLURAL[f] || f).join(', ')})`;
  }
  return 'colors';
}

function stepLabel(step, prog) {
  if (step.tier) {
    const t = CONTAINER_NAMES[step.tier] || 'Container';
    const w = step.colorId ? colorName(step.colorId) : step.family ? FAMILY_PLURAL[step.family].replace(/s$/, '') : whatOf(step);
    return `${article(t)} ${t} of ${w}`;
  }
  const need = Math.max(0, Math.ceil(step.jars - (prog?.delivered ?? 0) - 1e-9));
  if (prog?.done) return `${step.jars} ${jarsWord(step.jars)} of ${whatOf(step)}`;
  return `${need} more ${jarsWord(need)} of ${whatOf(step)}`;
}

// ---------------------------------------------------------------------------
// Eligible stock for a step
// ---------------------------------------------------------------------------

/** [{id, name, hex, avail, max}] sorted by jars on hand. */
function eligible(state, commissionId, stepIndex) {
  const { sim } = S.ctx;
  const def = defOf(commissionId);
  const rec = (state.commissions?.open ?? []).find((c) => c.id === commissionId);
  const sDef = def && def.steps[stepIndex];
  const prog = rec && rec.steps[stepIndex];
  if (!sDef || !prog) return [];
  const out = [];
  if (sDef.tier) {
    const counts = {};
    for (const cell of state.shelf?.cells ?? []) {
      if (cell && (cell.tier ?? 1) >= sDef.tier && sim.commissions.stepAccepts(sDef, cell.color)) counts[cell.color] = (counts[cell.color] || 0) + 1;
    }
    for (const [id, n] of Object.entries(counts)) out.push({ id, avail: n, max: 1 });
  } else {
    const order = sim.PURITY_ORDER;
    const min = sDef.purity ? order.indexOf(sDef.purity) : 0;
    for (const id of sim.commissions.eligibleStock(state, commissionId, stepIndex)) {
      const e = state.stock?.[id];
      let jars = 0;
      order.forEach((p, i) => { if (i >= min) jars += e?.purity?.[p] ?? 0; });
      const avail = Math.floor(jars + 1e-9);
      const max = Math.floor(Math.min(avail, sim.commissions.stepRoom(sDef, prog, id)) + 1e-9);
      if (avail > 0) out.push({ id, avail, max });
    }
  }
  return out
    .map((c) => ({ ...c, name: colorName(c.id), hex: sim.colorDef(c.id)?.hex ?? '#B7BDB3' }))
    .sort((a, b) => b.avail - a.avail || (a.name < b.name ? -1 : 1));
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function rewardRow(state, def) {
  const { sim } = S.ctx;
  const coins = sim.commissions.commissionPay(state, def.id);
  const sig = def.reward.signatureColor;
  const sigKnown = sig && state.catalog?.discovered?.[sig];
  const sigHex = sig ? sim.colorDef(sig)?.hex : null;
  return h`<div class="cm-reward"><span class="small muted">Reward</span>
<span class="it">${iconSvg('coin', { size: 18 })}${coinsWord(S.ctx, coins)}</span>
${sig ? h`<span class="it">${sigKnown && sigHex ? swatch(sigHex, 28, { label: colorName(sig) }) : h`<span class="cm-sil" style="background:${safeHex(sigHex, '#B7BDB3')}" aria-hidden="true"></span>`}${sigKnown ? colorName(sig) : 'A signature color'}</span>` : ''}
${def.reward.trophy ? h`<span class="it">${TROPHY}${titleCase(def.reward.trophy)}</span>` : ''}</div>`;
}

const req = (text, icon = null) => h`<span class="cm-req">${icon ? iconSvg(icon, { size: 12 }) : ''}${text}</span>`;

function stepHtml(def, rec, i, { preview = false, coach = null } = {}) {
  const step = def.steps[i];
  const prog = rec?.steps[i] ?? { delivered: 0, colors: {}, done: false };
  const distinctDone = Object.keys(prog.colors || {}).filter((k) => prog.colors[k] > 0).length;
  const reqs = [];
  if (step.purity) reqs.push(req(PURITY_LABEL[step.purity] || 'High purity', 'check'));
  if (step.tier) reqs.push(req(`Needs a merged ${CONTAINER_NAMES[step.tier] || 'container'}`, 'pin'));
  if (step.wild) reqs.push(req('Wild hue'));
  if (step.bulk) reqs.push(req('Bulk order'));
  const moreColors = Math.max(0, (step.distinct ?? 1) - distinctDone);
  if ((step.distinct ?? 1) > 1 && !prog.done && moreColors > 0) reqs.push(req(`${moreColors} more different ${moreColors === 1 ? 'color' : 'colors'}`));
  const ratio = step.jars > 0 ? (prog.delivered ?? 0) / step.jars : 0;
  return h`<div class="cm-step"${coach && coach.row ? h` data-coach="commission-step"` : ''}>
<div class="top"><div class="lbl${prog.done ? ' done' : ''}">${stepLabel(step, prog)}</div>
${preview ? '' : prog.done
    ? h`<span class="cm-ok">${iconSvg('check', { size: 16 })}Done</span>`
    : button('Deliver', { attrs: { 'data-action': 'deliver', 'data-commission': rec.id, 'data-step': i, 'data-coach': coach && coach.deliver ? 'commission-deliver' : false, 'aria-label': `Deliver to ${stepLabel(step, prog)}` } })}</div>
${reqs.length ? h`<div class="badges">${reqs}</div>` : ''}
${preview ? '' : progressBar(prog.done ? 1 : ratio, { label: stepLabel(step, prog) })}
</div>`;
}

function commissionHtml(state, rec, first = false) {
  const def = defOf(rec.id);
  if (!def) return '';
  const allDone = rec.steps.length > 0 && rec.steps.every((s) => s.done);
  const firstOpen = rec.steps.findIndex((s) => !s.done);
  return h`<div class="card cm-card" data-commission="${def.id}">
<div class="row between"><div class="cm-name">${def.name}</div>${def.capstone ? h`<span class="cm-cap">Grand finale</span>` : ''}</div>
<div class="small muted">${def.blurb}</div>
${def.steps.map((_, i) => stepHtml(def, rec, i, { coach: first ? { row: i === 0, deliver: i === firstOpen } : null }))}
${rewardRow(state, def)}
${allDone ? button('Complete commission', { variant: 'primary', block: true, attrs: { 'data-action': 'complete', 'data-commission': rec.id } }) : ''}
</div>`;
}

function capstoneTeaser(state) {
  const { sim, content } = S.ctx;
  const cap = sim.commissions.capstoneDef(state);
  if (!cap) return '';
  const open = (state.commissions?.open ?? []).some((c) => c.id === cap.id);
  const done = (state.commissions?.done ?? []).includes(cap.id);
  if (open || done) return '';
  if (cap.comingSoon) return h`<div class="card cm-card"><div class="cm-name">${cap.name}</div>${tag('Coming in a later update', { icon: 'lock' })}</div>`;
  const colors = sim.discoveredCount(state);
  const need = Math.max(cap.colorsRequired || 0, content.capstoneColorsRequired ? content.capstoneColorsRequired(state.era ?? 1) : 0);
  const left = Math.max(0, need - colors);
  return h`<div class="card cm-card"><div class="row between"><div class="cm-name">${cap.name}</div><span class="cm-cap">Grand finale</span></div>
<div class="small muted">${cap.blurb}</div>
${progressBar(need ? colors / need : 0, { label: 'Progress toward the grand finale' })}
<div class="small semi">${left > 0 ? `${left} more ${left === 1 ? 'color' : 'colors'}, and it opens` : 'It opens very soon'}</div></div>`;
}

function doneHtml(state) {
  const ids = state.commissions?.done ?? [];
  if (!ids.length) return '';
  return h`<div class="oq-h sm mt-2">Finished commissions</div>
${ids.map((id) => {
    const def = defOf(id);
    if (!def) return '';
    const sig = def.reward?.signatureColor;
    const hex = sig && state.catalog?.discovered?.[sig] ? S.ctx.sim.colorDef(sig)?.hex : null;
    return h`<div class="card tight"><div class="cm-done">${TROPHY}<div class="grow"><div class="semi serif">${def.name}</div><div class="small muted">${def.reward?.trophy ? `Trophy: ${titleCase(def.reward.trophy)}` : 'Finished'}</div></div>${hex ? swatch(hex, 28, { label: colorName(sig) }) : ''}</div></div>`;
  })}`;
}

function nextHint(state) {
  const { sim, content } = S.ctx;
  const taken = new Set([...(state.commissions?.open ?? []).map((c) => c.id), ...(state.commissions?.done ?? [])]);
  const colors = sim.discoveredCount(state);
  const next = (content.COMMISSIONS || [])
    .filter((c) => c.era === (state.era ?? 1) && !c.capstone && !c.comingSoon && !taken.has(c.id) && c.colorsRequired > colors)
    .sort((a, b) => a.colorsRequired - b.colorsRequired)[0];
  if (!next) return '';
  const left = next.colorsRequired - colors;
  return `${left} more ${left === 1 ? 'color' : 'colors'}, and the next commission arrives.`;
}

/** What the last delivery did, and the next step: a result with a way on. */
function noteHtml(state) {
  const n = S.note;
  if (!n) return '';
  const rec = (state.commissions?.open ?? []).find((c) => c.id === n.commissionId);
  if (!rec) return '';
  return h`<div class="card cm-note" data-note>${iconSvg('check', { size: 22 })}<div class="tx"><span class="semi">${n.title}</span>${n.text}</div>${n.nextStep !== null && n.nextStep !== undefined ? button(n.cta || 'Keep going', { variant: 'primary', attrs: { 'data-action': 'deliver', 'data-commission': n.commissionId, 'data-step': n.nextStep } }) : ''}</div>`;
}

function previewHtml(state) {
  const { content } = S.ctx;
  const def = (content.COMMISSIONS || [])
    .filter((c) => c.era === (state.era ?? 1) && !c.capstone && !c.comingSoon && c.steps.length)
    .sort((a, b) => a.colorsRequired - b.colorsRequired)[0];
  if (!def) return '';
  return h`<div class="small muted">A first look at what is coming</div>
<div class="card cm-card cm-preview" aria-label="Preview of ${def.name}">
<div class="cm-name">${def.name}</div>
<div class="small muted">${def.blurb}</div>
${def.steps.map((_, i) => stepHtml(def, null, i, { preview: true }))}
${rewardRow(state, def)}
</div>`;
}

function celeHtml(state) {
  const { ctx } = S;
  const c = S.cele;
  const def = defOf(c.id);
  const sig = c.signatureColor;
  const sigHex = sig ? ctx.sim.colorDef(sig)?.hex : null;
  const next = (state.commissions?.open ?? [])[0] ?? null;
  const nextDef = next ? defOf(next.id) : null;
  const show = S.celeRolled ? '' : ' style="opacity:0"';
  return h`<div class="card cm-cele" role="status" data-cele>
<div class="big">Commission complete!</div>
<div class="muted">${def ? def.name : 'A big project'} is finished. The whole town is talking about it.</div>
<div class="paid" data-cele-wrap${raw(show)}>${iconSvg('coin', { size: 28 })}<span class="num" data-cele-paid>${fmt(Math.max(1, Math.round(c.coins)))}</span><small>coins</small></div>
<div class="gifts">
${sig && sigHex ? h`<span class="g">${swatch(sigHex, 32, { label: ctx.sim.displayName(state, sig) })}<span>A new signature color: <span class="nm">${ctx.sim.displayName(state, sig)}</span></span></span>` : ''}
${c.trophy ? h`<span class="g">${TROPHY}Trophy for the workshop: ${titleCase(c.trophy)}</span>` : ''}
</div>
<div class="cm-celebar">
${nextDef ? button('Start the next commission', { variant: 'primary', block: true, attrs: { 'data-action': 'next-commission', 'data-commission': next.id } }) : ''}
${button('Back to orders', { variant: nextDef ? 'paper' : 'primary', block: true, attrs: { 'data-action': 'cele-orders' } })}
</div>
</div>`;
}

function boardHtml(state) {
  const { sim } = S.ctx;
  const u = sim.unlocks.status(state, 'commissions');
  if (!u.open) {
    const more = u.colorsLeft > 0 ? `${u.colorsLeft} more ${u.colorsLeft === 1 ? 'color' : 'colors'} to see it` : !u.phaseOk ? 'It opens once the Loading Yard is built' : 'Tap to see what it opens';
    return h`<div class="card cm-empty is-tap" data-action="unlock-open" data-unlock="commissions" data-tap role="button" tabindex="0" aria-label="What Commissions opens"><div class="oq-h">Commissions are on the way</div><p class="muted">Big projects for the whole town, delivered a few jars at a time.</p>
<div class="oq-lockrow" data-lock>${unlockTag(S.ctx, 'commissions', { cls: 'oq-lock' })}<span class="more">${more}</span></div></div>
${previewHtml(state)}`;
  }
  if (S.cele) return celeHtml(state);
  const open = state.commissions?.open ?? [];
  const ready = sim.commissions.capstoneReady(state);
  return h`<div class="small muted">Big projects that never expire. Deliver jars a few at a time, whenever you have spare stock.</div>
${noteHtml(state)}
${ready ? h`<div class="card cm-card"><div class="cm-name">The workshop has come a long way</div><div class="small muted">Your capstone is complete. The next era is waiting.</div>${button('Advance era', { variant: 'primary', block: true, attrs: { 'data-action': 'era-advance' } })}</div>` : ''}
${open.length
    ? open.map((r, i) => commissionHtml(state, r, i === 0))
    : h`<div class="card cm-empty"><div class="oq-h">Every commission is delivered</div><p class="muted">${nextHint(state) || 'New ones appear as your catalog grows.'}</p>${button('Back to orders', { attrs: { 'data-action': 'cele-orders' } })}</div>`}
${capstoneTeaser(state)}
${doneHtml(state)}`;
}

function paint(force = false) {
  const { body } = S;
  if (!body) return;
  const html = String(boardHtml(stateOf()));
  if (!force && html === S.html) return;
  if (S.down) { S.dirty = true; return; }
  S.html = html;
  const top = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = top;
}

// ---------------------------------------------------------------------------
// The delivery sheet
// ---------------------------------------------------------------------------

function closeLayer() {
  S.sheet = null;
  S.layer.hidden = true;
  S.layer.classList.remove('center');
  S.layer.innerHTML = '';
}

function openSheet(commissionId, stepIndex) {
  const state = stateOf();
  const list = eligible(state, commissionId, stepIndex);
  const first = list.find((c) => c.max > 0) ?? list[0] ?? null;
  S.sheet = { commissionId, stepIndex, colorId: first ? first.id : null, qty: first ? Math.max(1, first.max) : 0 };
  renderSheet();
}

function renderSheet(keepScroll = true) {
  const sh = S.sheet;
  if (!sh) return;
  const state = stateOf();
  const def = defOf(sh.commissionId);
  const rec = (state.commissions?.open ?? []).find((c) => c.id === sh.commissionId);
  if (!def || !rec) { closeLayer(); return; }
  const step = def.steps[sh.stepIndex];
  const list = eligible(state, sh.commissionId, sh.stepIndex);
  const cur = list.find((c) => c.id === sh.colorId) ?? null;
  const max = cur ? Math.max(0, cur.max) : 0;
  sh.qty = max ? Math.max(1, Math.min(max, sh.qty || 1)) : 0;
  const prevScroll = keepScroll ? S.layer.querySelector('.cm-list')?.scrollTop ?? 0 : 0;
  const isTier = !!step.tier;
  S.layer.hidden = false;
  S.layer.classList.remove('center');
  S.layer.innerHTML = String(h`<div class="cm-back" data-action="sheet-close"></div>
<div class="sheet" role="dialog" aria-label="Deliver stock">
<div class="oq-h">Deliver to ${def.name}</div>
<div class="small muted">${stepLabel(step, rec.steps[sh.stepIndex])}${step.purity ? `, ${PURITY_LABEL[step.purity].toLowerCase()}` : ''}</div>
${list.length
    ? h`<div class="cm-list">${list.map((c) => h`<button type="button" class="cm-opt${c.id === sh.colorId ? ' is-sel' : ''}" data-action="sheet-color" data-color="${c.id}" data-tap>${swatch(c.hex, 36)}<span class="nm">${c.name}</span><span class="have num">${fmt(c.avail)} ${isTier ? (c.avail === 1 ? 'container' : 'containers') : jarsWord(c.avail)}</span></button>`)}</div>`
    : h`<div class="card flat"><div class="semi">Nothing in stock fits this step yet</div><div class="small muted">${isTier ? 'Merge a bigger container on the shelf and bring it back.' : 'Keep the workshop running, then bring jars back whenever you like.'}</div></div>`}
${cur && !isTier ? h`<div class="cm-stepper">
${button('−', { attrs: { 'data-action': 'qty-dec', 'aria-label': 'One fewer jar' }, disabled: sh.qty <= 1 })}
<div class="qty num" aria-live="polite">${fmt(sh.qty)}</div>
${button('+', { attrs: { 'data-action': 'qty-inc', 'aria-label': 'One more jar' }, disabled: sh.qty >= max })}
${button('+10', { attrs: { 'data-action': 'qty-ten' }, disabled: sh.qty >= max })}
${button('Max', { attrs: { 'data-action': 'qty-max' }, disabled: sh.qty >= max })}
</div>` : ''}
${button(isTier ? 'Deliver container' : cur && max ? `Deliver ${fmt(sh.qty)} ${jarsWord(sh.qty)}` : 'Deliver', { variant: 'primary', block: true, disabled: !cur || max < 1, attrs: { 'data-action': 'sheet-go' } })}
${button('Not now', { block: true, attrs: { 'data-action': 'sheet-close' } })}
</div>`);
  const lst = S.layer.querySelector('.cm-list');
  if (lst) lst.scrollTop = prevScroll;
}

const REASONS = {
  'wrong-color': 'That color does not fit this step.',
  'need-variety': 'This step wants more different colors. Try another one.',
  'no-stock': 'There are no matching jars on hand right now.',
  'no-container': 'There is no matching container on the shelf yet.',
  done: 'That step is already done.',
};

function deliver() {
  const { ctx } = S;
  const sh = S.sheet;
  if (!sh || !sh.colorId || sh.qty < 1) return;
  const def = defOf(sh.commissionId);
  const step = def?.steps[sh.stepIndex];
  const res = ctx.game.act(ctx.sim.commissions.deliver, {
    commissionId: sh.commissionId, stepIndex: sh.stepIndex, colorId: sh.colorId, jars: sh.qty,
  });
  closeLayer();
  if (!res || !res.ok) {
    ctx.toast(REASONS[res && res.reason] || 'That did not fit this time.');
    paint(true);
    return;
  }
  const hex = ctx.sim.colorDef(sh.colorId)?.hex ?? '#C99A2E';
  const what = colorName(sh.colorId);
  ctx.haptics.light();
  if (res.stepDone) {
    ctx.audio.chord([0.3, 0.47, 0.64, 0.81], 0.5);
    ctx.fx.confetti([hex, '#E2B04A', '#C99A2E'], null, { count: 14 });
  } else {
    ctx.audio.clink(2);
  }
  if (res.completed && res.completed.ok) {
    S.note = null;
    celebrate(res.completed);
    return;
  }
  // The result of this delivery, and the next step.
  const rec = (stateOf().commissions?.open ?? []).find((c) => c.id === sh.commissionId);
  const delivered = res.delivered === 1 && step?.tier ? 'a container' : `${fmt(res.delivered)} ${jarsWord(res.delivered)}`;
  let nextStep = null;
  let text = '';
  let cta = 'Keep going';
  if (rec) {
    if (res.stepDone) {
      nextStep = rec.steps.findIndex((p) => !p.done);
      if (nextStep < 0) nextStep = null;
      else { text = `Next: ${stepLabel(def.steps[nextStep], rec.steps[nextStep])}.`; cta = 'Deliver the next step'; }
    } else {
      nextStep = sh.stepIndex;
      text = `${stepLabel(step, rec.steps[sh.stepIndex])} to finish this step.`;
    }
  }
  S.note = {
    commissionId: sh.commissionId,
    title: res.stepDone ? `Step complete: ${delivered} of ${what}` : `Delivered ${delivered} of ${what}`,
    text,
    nextStep,
    cta,
  };
  paint(true);
}

function complete(commissionId) {
  const { ctx } = S;
  const res = ctx.game.act(ctx.sim.commissions.complete, { commissionId });
  if (res && res.ok) { S.note = null; celebrate(res); } else { paint(true); ctx.toast('Every step needs to be finished first.'); }
}

/** The finished commission lands on its reward, with two ways on. */
function celebrate(res) {
  const { ctx } = S;
  const state = stateOf();
  const sig = res.signatureColor;
  const sigHex = sig ? ctx.sim.colorDef(sig)?.hex : null;
  S.sheet = null;
  S.cele = { id: res.id, coins: res.coins, signatureColor: sig, trophy: res.trophy };
  S.celeRolled = false;
  closeLayer();
  paint(true);
  if (S.body) S.body.scrollTop = 0;
  ctx.audio.motif();
  ctx.haptics.success();
  const colors = ['#B8433A', '#D39B2A', '#3E6A9E', '#E2B04A', sigHex || '#7B5236'];
  later(() => {
    const card = S.body && S.body.querySelector('[data-cele]');
    if (!card) return;
    S.celeRolled = true;
    const wrap = card.querySelector('[data-cele-wrap]');
    if (wrap) wrap.style.opacity = '1';
    ctx.fx.confetti(colors, card, { count: 24 });
    ctx.fx.rollNumber(card.querySelector('[data-cele-paid]'), 0, Math.max(1, Math.round(res.coins)), { ms: 800, format: ctx.format.num });
  }, 200);
  // After the first finished commission: two equal ways on (only when there is a next one to start).
  const next = (state.commissions?.open ?? [])[0] ?? null;
  if (S.offer) S.offer.stop();
  if (next) {
    S.offer = offerWhatsNext(ctx, {
      screen: 'commissions',
      id: 'commissionNext',
      delay: 2400,
      ok: () => !!S.cele,
      title: 'A commission, delivered',
      body: 'The whole town is talking about it.',
      more: { label: 'Start the next commission', run: () => startNext(next.id) },
      next: { label: 'Back to orders', run: () => { S.cele = null; ctx.navigate('orders'); } },
    });
  }
}

/** The finished commission's page gives way to the next open one. */
function startNext(commissionId) {
  S.cele = null;
  paint(true);
  const card = S.body && S.body.querySelector(`[data-commission="${commissionId}"]`);
  if (card) { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}

/** First-open guide: step by step, then deliver what you have (docs/PLAN-v0.2 Theme D). */
function startGuide() {
  stopGuide();
  const { ctx } = S;
  if (typeof ctx.guide !== 'function') return;
  const state = stateOf();
  const open = state.commissions?.open ?? [];
  const veteran = (state.commissions?.done?.length ?? 0) > 0 || open.some((r) => r.steps.some((p) => p.done || p.delivered > 0));
  if (veteran && !state.onboarding?.seen?.commissions) { ctx.game.act(markGuideSeen, { id: 'commissions' }); return; }
  S.guide = ctx.guide('commissions', [
    { anchor: '[data-coach="commission-step"]', text: 'Deliver jars step by step; nothing expires', endsOn: 'got-it', side: 'above' },
    { anchor: '[data-coach="commission-deliver"]', text: 'Deliver what you have now', endsOn: 'action', side: 'above' },
  ], { screen: 'commissions' });
  later(() => { if (S.guide) S.guide.start(); }, 300);
}

function stopGuide() {
  if (S.guide) { try { S.guide.stop(); } catch (e) { /* ignore */ } S.guide = null; }
  if (S.offer) { S.offer.stop(); S.offer = null; }
}

export default {
  id: 'commissions',

  mount(root, ctx) {
    S.ctx = ctx;
    S.root = root;
    injectStyles('oq-shared', SHARED_CSS);
    injectStyles('commissions', CSS);
    root.innerHTML = String(h`<div class="screen-head oq-head">${backButton('Back')}<div class="titles"><div class="title">Commissions</div>${howThisWorksHtml('commissions')}</div><span class="spacer"></span></div><div class="screen-body" data-body></div><div class="cm-layer" data-layer hidden></div>`);
    S.body = root.querySelector('[data-body]');
    S.layer = root.querySelector('[data-layer]');
    const release = () => {
      if (!S.down) return;
      S.down = false;
      if (S.dirty) { S.dirty = false; later(() => paint(true), 60); }
    };
    root.addEventListener('pointerdown', () => { S.down = true; }, { passive: true });
    root.addEventListener('pointerup', release, { passive: true });
    root.addEventListener('pointercancel', release, { passive: true });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t) || t.disabled) return;
      const sh = S.sheet;
      const cur = sh && eligible(stateOf(), sh.commissionId, sh.stepIndex).find((c) => c.id === sh.colorId);
      const max = cur ? cur.max : 0;
      switch (t.getAttribute('data-action')) {
        case 'unlock-open': ensureWorkshopStyles(); openUnlockSheet(ctx, t.getAttribute('data-unlock'), { host: root }); break;
        case 'deliver': openSheet(t.getAttribute('data-commission'), Number(t.getAttribute('data-step'))); break;
        case 'complete': complete(t.getAttribute('data-commission')); break;
        case 'sheet-color': {
          if (!sh) break;
          sh.colorId = t.getAttribute('data-color');
          const next = eligible(stateOf(), sh.commissionId, sh.stepIndex).find((c) => c.id === sh.colorId);
          sh.qty = next ? Math.max(1, next.max) : 0;
          renderSheet();
          break;
        }
        case 'qty-dec': if (sh) { sh.qty = Math.max(1, sh.qty - 1); renderSheet(); } break;
        case 'qty-inc': if (sh) { sh.qty = Math.min(max, sh.qty + 1); renderSheet(); } break;
        case 'qty-ten': if (sh) { sh.qty = Math.min(max, sh.qty + 10); renderSheet(); } break;
        case 'qty-max': if (sh) { sh.qty = max; renderSheet(); } break;
        case 'sheet-go': deliver(); break;
        case 'sheet-close': closeLayer(); break;
        case 'cele-close': S.cele = null; paint(true); break;
        case 'cele-orders': S.cele = null; ctx.navigate('orders'); break;
        case 'next-commission': startNext(t.getAttribute('data-commission')); break;
        case 'era-advance': ctx.game.act(ctx.sim.commissions.eraAdvance); break;
        default: break;
      }
    });
  },

  show() {
    S.down = false;
    S.dirty = false;
    S.note = null;
    S.cele = null;
    S.celeRolled = false;
    closeLayer();
    paint(true);
    startGuide();
  },

  hide() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    stopGuide();
    S.note = null;
    S.cele = null;
    closeLayer();
  },

  render() {
    paint();
  },
};
