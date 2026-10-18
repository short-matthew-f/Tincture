/**
 * commissions.js: the Commissions overlay (screen id `commissions`).
 *
 * Implements DESIGN.md "Progression, eras and prestige > Commissions" and
 * "Era Advance": multi-step projects that ask for colors in quantity, never
 * expire, and pay Coins, a signature catalog color and a workshop trophy.
 *
 * Every unfinished step says, from sim.commissions.stepGuide (playtest:
 * "commissions need to be actionable"):
 *  - exactly what is checked (which families count, tints and shades
 *    included; purity; how many different colors; shelf containers);
 *  - delivered so far, "X of 10" different colors so far;
 *  - which of HER colors count, live, with jars (or containers) on hand;
 *  - colors she could add when hers are not enough, and how each is found;
 *  - one action: Deliver when she has something, else a plan with a button
 *    ("Make it" opens the mixer picker here; others navigate: workshop,
 *    shelf, bench, puzzles, map).
 * "How does this work?" (head) and the commission name open the how-to sheet.
 * "Set aside for now" swaps a commission for another, progress kept.
 * Deep link show({commissionId, stepIndex}) scrolls to and outlines a step.
 *
 * data-action names: `deliver` (data-commission, data-step), `complete`
 * (data-commission), `howto`, `go` (data-screen, data-params JSON), `make`
 * (data-color), `set-aside` (data-commission), `sheet-color` (data-color),
 * `qty-dec`, `qty-inc`, `qty-ten`, `qty-max`, `sheet-go`, `sheet-close`,
 * `cele-close`, `cele-orders`, `next-commission`, `era-advance`.
 * Coach targets (the `commissions` guide): data-coach="commission-step" on the
 * first step row of the first open commission, "commission-deliver" on the
 * action button (Deliver or the plan's button) of its first unfinished step.
 */

import { h, raw, iconSvg, button, backButton, tag, swatch, progressBar, safeHex, CONTAINER_NAMES } from './kit.js';
import { injectStyles, coinsWord, offerWhatsNext, SHARED_CSS } from './matching.js';
import { markGuideSeen } from './guide.js';
import { unlockTag, openUnlockSheet, openRecipeSheet, ensureStyles as ensureWorkshopStyles, bindTouchFeel } from './workshop.js';

const FAMILY_PLURAL = Object.freeze({
  red: 'reds', orange: 'oranges', yellow: 'yellows', green: 'greens', teal: 'teals',
  blue: 'blues', violet: 'violets', pink: 'pinks', neutral: 'neutrals',
});
const FAMILY_ONE = Object.freeze({
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', teal: 'teal',
  blue: 'blue', violet: 'violet', pink: 'pink', neutral: 'neutral',
});
const PURITY_LABEL = Object.freeze({ pure: 'Pure or better', flawless: 'Flawless' });
/** Swatches shown per step before "+N more". */
const SHOW_OWNED = 8;
const SHOW_FIND = 4;

const CSS = `
.cm-card { gap: 10px; }
.cm-name { font-family: var(--font-display); font-size: 19px; line-height: 1.2; }
.cm-namebtn { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; min-height: 44px; }
.cm-namebtn .cm-name { text-decoration: underline; text-decoration-color: rgba(42,38,34,0.25); text-underline-offset: 4px; }
.cm-step { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(42,38,34,0.1); }
.cm-step.is-focus { animation: cm-focus 1600ms ease-out 1; border-radius: 10px; }
@keyframes cm-focus { 0%, 40% { box-shadow: 0 0 0 3px var(--ink); } 100% { box-shadow: 0 0 0 0 rgba(42,38,34,0); } }
.cm-step .top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cm-step .lbl { flex: 1 1 auto; min-width: 0; font-weight: 700; font-size: 15px; }
.cm-step .lbl.done { color: var(--ink-soft); font-weight: 500; }
.cm-rule { font-size: 13px; color: var(--ink-soft); line-height: 1.35; }
.cm-count { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; }
.cm-count .semi { font-weight: 700; }
.cm-sub { font-size: 12px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; }
.cm-sw { display: flex; flex-wrap: wrap; gap: 8px 10px; }
.cm-chip { position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 2px; width: 64px; min-width: 0; text-align: center; }
.cm-chip .nm { font-size: 11px; line-height: 1.15; max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-chip .ct { font-size: 11px; font-weight: 700; color: var(--ink-soft); }
.cm-chip .ct.has { color: var(--ink); }
.cm-chip .ck { position: absolute; top: -4px; right: 8px; width: 18px; height: 18px; border-radius: 50%; background: var(--paper); box-shadow: 0 0 0 1.5px var(--ink); display: grid; place-items: center; }
.cm-chip .ck svg { width: 12px; height: 12px; }
.cm-chip.ghost .swatch { opacity: 0.55; box-shadow: inset 0 0 0 2px rgba(42,38,34,0.28); }
.cm-more { align-self: center; font-size: 12px; font-weight: 700; color: var(--ink-soft); }
.cm-plan { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--plaster); }
.cm-plan .tx { font-size: 14px; line-height: 1.35; }
.cm-plan .btn { align-self: flex-start; }
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
.cm-foot { display: flex; justify-content: flex-end; }
.cm-foot .btn { min-height: 44px; font-size: 13px; padding: 0 14px; }
.cm-intro { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.cm-intro .how-link { padding: 0; }
.cm-layer { position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-end; justify-content: center; }
.cm-layer[hidden] { display: none; }
.cm-layer.center { align-items: center; padding: 0 var(--gutter); }
.cm-back { position: absolute; inset: 0; background: rgba(42,38,34,0.45); animation: fade-in 160ms ease-out both; }
.cm-layer .sheet { position: relative; max-height: 86%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.cm-how { display: flex; flex-direction: column; gap: 12px; }
.cm-how h3 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 400; }
.cm-how p { margin: 0; font-size: 14px; line-height: 1.45; }
.cm-how ol { margin: 0; padding-left: 22px; list-style: decimal; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.4; }
.cm-how li { display: list-item; }
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
.cm-opt, .cm-step .btn, .cm-empty { touch-action: manipulation; }
.cm-step .progress > span { transform-origin: 0 50%; }
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
  sheetSig: '',
  how: false, // the how-to sheet is open
  celeRolled: false,
  note: null, // {title, text, commissionId, nextStep}: what the last delivery did, and what comes next
  cele: null, // the finished commission's result page
  focus: null, // {commissionId, stepIndex} from a deep link
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
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const shelfStep = (step) => !!(step && (step.tier || step.wild));
const tierName = (t) => CONTAINER_NAMES[t || 1] || 'Container';

function colorName(id) {
  const state = stateOf();
  if (state.catalog?.discovered?.[id]) return S.ctx.sim.displayName(state, id);
  return S.ctx.sim.colorDef(id)?.name ?? titleCase(id);
}
const hexOf = (id) => S.ctx.sim.colorDef(id)?.hex ?? '#B7BDB3';
const pigmentName = (id) => S.ctx.content.getPigment?.(id)?.name ?? titleCase(id);
const regionName = (id) => S.ctx.content.getRegion?.(id)?.name ?? titleCase(id);

/** "blues", "Harbor Teal", "reds, oranges, yellows or pinks". */
function whatOf(step) {
  if (step.colorId) return colorName(step.colorId);
  if (step.pigment) return `colors made with ${pigmentName(step.pigment)}`;
  if (step.family) return FAMILY_PLURAL[step.family] || step.family;
  if (step.families) {
    if (step.families.length >= 9) return 'colors of any kind';
    const w = step.families.map((f) => FAMILY_PLURAL[f] || f);
    return w.length > 1 ? `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}` : w[0];
  }
  return 'colors';
}

/** The step's headline: exactly what it asks for. */
function stepLabel(step, prog) {
  if (step.tier) {
    const t = tierName(step.tier);
    const w = step.colorId ? colorName(step.colorId) : step.family ? FAMILY_ONE[step.family] : whatOf(step);
    return step.jars > 1 ? `${step.jars} ${t}s of ${w}` : `${article(t)} ${t} of ${w}`;
  }
  if (step.wild) return `${plural(step.jars, 'shelf container')} of ${colorName(step.colorId)}`;
  if (prog?.done) return `${fmt(step.jars)} ${jarsWord(step.jars)} of ${whatOf(step)}`;
  return `${fmt(step.jars)} ${jarsWord(step.jars)} of ${whatOf(step)}`;
}

/** Plain words for what this step really checks (purity, variety, shelf, which colors count). */
function ruleText(step) {
  const out = [];
  if (step.wild) out.push(`${colorName(step.colorId)} is a wild hue: it cannot be mixed into jars, so this step takes containers of it from the Merge Shelf. Any size counts as one.`);
  else if (step.tier) out.push(`Merge it on the Merge Shelf up to ${article(tierName(step.tier))} ${tierName(step.tier)} (or bigger), then deliver the container.`);
  if (step.family === 'neutral') out.push('Every grey, white, black, brown-grey or other soft muted color counts.');
  else if (step.family) out.push(`Every ${FAMILY_ONE[step.family]} counts, tints, shades and soft greyish ones included.`);
  else if (step.families) out.push(step.families.length >= 9 ? 'Any color counts.' : `Any ${step.families.map((f) => FAMILY_ONE[f]).join(', ').replace(/, ([^,]*)$/, ' or $1')} counts, tints and shades included.`);
  else if (step.pigment) out.push(`${pigmentName(step.pigment)} itself, or any color made with it.`);
  if (step.purity) out.push(`${PURITY_LABEL[step.purity] || 'High purity'} jars only.`);
  if ((step.distinct ?? 1) > 1) out.push(`Made up of at least ${step.distinct} different colors.`);
  if (step.bulk) out.push('A cartload: hand it over a few jars at a time.');
  return out.join(' ');
}

/** The next honest action for a step, as {text, label, go?:{screen, params}, make?:colorId}. */
function planOf(g) {
  const a = g.action || { kind: 'later' };
  const nm = a.colorId ? colorName(a.colorId) : '';
  const sim = S.ctx.sim;
  switch (a.kind) {
    case 'make':
      return { text: `Set a mixer to make ${nm}. Jars arrive as it works, and the shop keeps them for this step.`, label: 'Make it', make: a.colorId };
    case 'wait':
      return { text: `Mixer ${a.mixer + 1} is making ${nm}. Jars arrive as it works, and the shop keeps them for this step. Come back to deliver them.`, label: 'See the mixers', go: a };
    case 'purify':
      return { text: `This step takes pure jars. Purify a muddy batch of ${nm} in Puzzles, or upgrade your grinders, and pure jars collect on their own.`, label: 'Take me there', go: a };
    case 'shelf-open':
      return { text: 'This step is filled from the Merge Shelf. Open the shelf in the workshop first.', label: 'Take me there', go: a };
    case 'shelf-merge':
      return a.tier > 1
        ? { text: `Merge ${nm} on the Merge Shelf until you have ${article(tierName(a.tier))} ${tierName(a.tier)}, then come back to deliver it.`, label: 'Open the shelf', go: a }
        : { text: `Vials of ${nm} spill onto the Merge Shelf while your mixers work. Any vial or bigger counts, so come back once one lands.`, label: 'Open the shelf', go: a };
    case 'shelf-chip':
      return { text: `Pick ${nm} as one of your shelf colors, so its vials spill onto the Merge Shelf.`, label: 'Open the shelf', go: a };
    case 'find': {
      if (a.how === 'bench') {
        const r = (sim.colorDef(a.colorId)?.recipe || []).map((p) => `${p.weight} ${p.weight === 1 ? 'part' : 'parts'} ${pigmentName(p.pigment)}`).join(', ');
        return { text: `Find ${nm} at the Mixing Bench: try ${r}.`, label: 'Take me there', go: a };
      }
      if (a.how === 'grade') return { text: `${nm} hides between colors you know. A Grading board can reveal it.`, label: 'Take me there', go: a };
      if (a.how === 'source') return { text: `${nm} is made with ${pigmentName(a.pigment)}. Send a hunter to the ${regionName(a.region)}; they can bring a ${pigmentName(a.pigment)} source home.`, label: 'Send a hunter', go: a };
      return { text: `${nm} is a wild hue from the ${regionName(a.region)}. Send a hunter there to find it.`, label: 'Send a hunter', go: a };
    }
    case 'hunters-open':
      return { text: `${nm} comes from the ${regionName(a.region)}. Open the Hue Hunters in the workshop, then send one there.`, label: 'Take me there', go: a };
    default:
      return { text: 'Nothing you can reach yet makes this. It opens up as your catalog grows, and this commission waits for you.', label: null };
  }
}

const FIND_WORDS = { bench: 'at the bench', grade: 'on a Grading board', source: 'needs a hunter', hunt: 'with a hunter' };

// ---------------------------------------------------------------------------
// Eligible stock (or shelf containers) for a step: the delivery sheet's list
// ---------------------------------------------------------------------------

/** [{id, name, hex, avail, max}] sorted by jars on hand. */
function eligible(state, commissionId, stepIndex) {
  const g = S.ctx.sim.commissions.stepGuide(state, commissionId, stepIndex);
  if (!g || g.done) return [];
  const out = [];
  for (const o of g.owned) {
    if (g.kind === 'shelf') {
      if (o.containers > 0) out.push({ id: o.id, avail: o.containers, max: o.room > 0 ? 1 : 0 });
    } else if (o.usable > 0) {
      out.push({ id: o.id, avail: o.usable, max: Math.floor(Math.min(o.usable, o.room) + 1e-9) });
    }
  }
  return out
    .map((c) => ({ ...c, name: colorName(c.id), hex: hexOf(c.id) }))
    .sort((a, b) => (b.max > 0) - (a.max > 0) || b.avail - a.avail || (a.name < b.name ? -1 : 1));
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

function ownedChip(o, g) {
  const n = g.kind === 'shelf' ? o.containers : o.usable;
  const unit = g.kind === 'shelf' ? (n === 1 ? 'container' : 'containers') : jarsWord(n);
  const count = n > 0 ? `${fmt(n)} ${unit}` : o.making.length ? 'making' : 'none yet';
  return h`<span class="cm-chip" title="${colorName(o.id)}">${o.used ? h`<span class="ck" aria-label="Already delivered">${iconSvg('check', { size: 12 })}</span>` : ''}${swatch(hexOf(o.id), 34, { label: colorName(o.id) })}<span class="nm">${colorName(o.id)}</span><span class="ct${n > 0 ? ' has' : ''}">${count}</span></span>`;
}

function findChip(f) {
  return h`<span class="cm-chip ghost">${swatch(hexOf(f.id), 34, { label: colorName(f.id) })}<span class="nm">${colorName(f.id)}</span><span class="ct">${FIND_WORDS[f.how] || ''}</span></span>`;
}

function goAttrs(a) {
  return { 'data-action': 'go', 'data-screen': a.screen, 'data-params': JSON.stringify(a.params || {}) };
}

function stepHtml(def, rec, i, { coach = null } = {}) {
  const { sim } = S.ctx;
  const state = stateOf();
  const step = def.steps[i];
  const prog = rec.steps[i] ?? { delivered: 0, colors: {}, done: false };
  const g = sim.commissions.stepGuide(state, rec.id, i, rec);
  const ratio = step.jars > 0 ? (prog.delivered ?? 0) / step.jars : 0;
  const unit = g.kind === 'shelf' ? (step.tier ? (step.jars === 1 ? tierName(step.tier) : `${tierName(step.tier)}s`) : (step.jars === 1 ? 'container' : 'containers')) : jarsWord(step.jars);
  const head = h`<div class="top"><div class="lbl${prog.done ? ' done' : ''}">${stepLabel(step, prog)}</div>${prog.done ? h`<span class="cm-ok">${iconSvg('check', { size: 16 })}Done</span>` : ''}</div>`;
  if (prog.done) {
    return h`<div class="cm-step" data-step-row="${rec.id}:${i}"${coach && coach.row ? h` data-coach="commission-step"` : ''}>${head}${progressBar(1, { label: stepLabel(step, prog) })}</div>`;
  }
  const delivered = Math.floor((prog.delivered ?? 0) + 1e-9);
  const variety = (step.distinct ?? 1) > 1
    ? h`<div class="cm-count"><span>Different colors</span><span class="semi">${fmt(g.distinctDone)} of ${fmt(step.distinct)} so far</span></div>` : '';
  const owned = g.owned.slice(0, SHOW_OWNED);
  const moreOwned = g.owned.length - owned.length;
  // Colors she could add: when none of hers count yet, or the step wants more different colors than she has.
  const unusedOwned = g.owned.filter((o) => !o.used).length;
  const wantFind = !g.owned.length || g.moreColors > unusedOwned;
  const finds = wantFind ? g.findable.slice(0, SHOW_FIND) : [];
  const plan = g.action.kind === 'deliver' ? null : planOf(g);
  const coachDeliver = coach && coach.deliver ? 'commission-deliver' : false;
  const action = g.action.kind === 'deliver'
    ? button(g.kind === 'shelf' ? `Deliver (${plural(g.ready, 'container')} ready)` : `Deliver (${plural(g.ready, 'jar')} ready)`, { variant: 'primary', block: true, attrs: { 'data-action': 'deliver', 'data-commission': rec.id, 'data-step': i, 'data-coach': coachDeliver, 'aria-label': `Deliver to ${stepLabel(step, prog)}` } })
    : h`<div class="cm-plan"><div class="tx">${plan.text}</div>${plan.make
      ? button(plan.label, { variant: 'primary', attrs: { 'data-action': 'make', 'data-color': plan.make, 'data-coach': coachDeliver } })
      : plan.go ? button(plan.label, { variant: 'primary', attrs: { ...goAttrs(plan.go), 'data-coach': coachDeliver } }) : ''}</div>`;
  return h`<div class="cm-step" data-step-row="${rec.id}:${i}"${coach && coach.row ? h` data-coach="commission-step"` : ''}>
${head}
<div class="cm-rule">${ruleText(step)}</div>
<div class="cm-count"><span>Delivered</span><span class="semi">${fmt(delivered)} of ${fmt(step.jars)} ${unit}</span></div>
${progressBar(ratio, { label: stepLabel(step, prog) })}
${variety}
${owned.length ? h`<div class="cm-sub">Yours that count</div><div class="cm-sw">${owned.map((o) => ownedChip(o, g))}${moreOwned > 0 ? h`<span class="cm-more">+${fmt(moreOwned)} more</span>` : ''}</div>` : h`<div class="cm-sub">None of your colors count yet</div>`}
${finds.length ? h`<div class="cm-sub">${g.owned.length ? 'Colors you could add' : 'Colors that would count'}</div><div class="cm-sw">${finds.map(findChip)}</div>` : ''}
${action}
</div>`;
}

function commissionHtml(state, rec, first = false) {
  const def = defOf(rec.id);
  if (!def) return '';
  const allDone = rec.steps.length > 0 && rec.steps.every((s) => s.done);
  const firstOpen = rec.steps.findIndex((s) => !s.done);
  const aside = !def.capstone && S.ctx.sim.commissions.canSetAside(state, rec.id);
  return h`<div class="card cm-card" data-commission="${def.id}">
<button type="button" class="cm-namebtn" data-action="howto" data-tap aria-label="${def.name}: how commissions work"><span class="row between"><span class="cm-name">${def.name}</span>${def.capstone ? h`<span class="cm-cap">Grand finale</span>` : ''}</span></button>
<div class="small muted">${def.blurb}</div>
${def.steps.map((_, i) => stepHtml(def, rec, i, { coach: first ? { row: i === 0, deliver: i === firstOpen } : null }))}
${rewardRow(state, def)}
${allDone ? button('Complete commission', { variant: 'primary', block: true, attrs: { 'data-action': 'complete', 'data-commission': rec.id } }) : ''}
${aside && !allDone ? h`<div class="cm-foot">${button('Set aside for now', { attrs: { 'data-action': 'set-aside', 'data-commission': rec.id } })}</div>` : ''}
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
<div class="small semi">${left > 0 ? `${left} more ${left === 1 ? 'color' : 'colors'}, and it opens` : 'It opens once you can reach every color it asks for'}</div></div>`;
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

function laterHtml(state) {
  const recs = state.commissions?.later ?? [];
  if (!recs.length) return '';
  return h`<div class="oq-h sm mt-2">Waiting for later</div>
${recs.map((r) => {
    const def = defOf(r.id);
    if (!def) return '';
    const started = r.steps.some((p) => p.done || p.delivered > 0);
    return h`<div class="card tight"><div class="semi serif">${def.name}</div><div class="small muted">${started ? 'Your progress is kept. ' : ''}It comes back on its own when there is room${S.ctx.sim.commissions.commissionFeasible(state, r.id, r) ? '' : ' and you can reach every color it asks for'}.</div></div>`;
  })}`;
}

function nextHint(state) {
  const { sim, content } = S.ctx;
  const taken = new Set([...(state.commissions?.open ?? []).map((c) => c.id), ...(state.commissions?.done ?? []), ...(state.commissions?.later ?? []).map((c) => c.id)]);
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
  const g = n.nextStep !== null && n.nextStep !== undefined ? S.ctx.sim.commissions.stepGuide(state, n.commissionId, n.nextStep, rec) : null;
  const can = g && g.action.kind === 'deliver';
  return h`<div class="card cm-note" data-note>${iconSvg('check', { size: 22 })}<div class="tx"><span class="semi">${n.title}</span>${n.text}</div>${can ? button(n.cta || 'Keep going', { variant: 'primary', attrs: { 'data-action': 'deliver', 'data-commission': n.commissionId, 'data-step': n.nextStep } }) : ''}</div>`;
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
${def.steps.map((st) => h`<div class="cm-step"><div class="top"><div class="lbl">${stepLabel(st, null)}</div></div><div class="cm-rule">${ruleText(st)}</div></div>`)}
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
    return h`<div class="cm-intro"><span class="small muted">Big projects for the whole town, delivered a few jars at a time.</span></div>
<div class="card cm-empty is-tap" data-lift="1.02" data-action="unlock-open" data-unlock="commissions" data-tap role="button" tabindex="0" aria-label="What Commissions opens"><div class="oq-h">Commissions are on the way</div><p class="muted">Big projects for the whole town, delivered a few jars at a time.</p>
<div class="oq-lockrow" data-lock>${unlockTag(S.ctx, 'commissions', { cls: 'oq-lock' })}<span class="more">${more}</span></div></div>
${previewHtml(state)}`;
  }
  if (S.cele) return celeHtml(state);
  const open = state.commissions?.open ?? [];
  const ready = sim.commissions.capstoneReady(state);
  const waiting = (state.commissions?.later ?? []).length;
  return h`<div class="cm-intro"><span class="small muted">Big projects that never expire. Deliver jars a few at a time, whenever you have them.</span></div>
${noteHtml(state)}
${ready ? h`<div class="card cm-card"><div class="cm-name">The workshop has come a long way</div><div class="small muted">Your capstone is complete. The next era is waiting.</div>${button('Advance era', { variant: 'primary', block: true, attrs: { 'data-action': 'era-advance' } })}</div>` : ''}
${open.length
    ? open.map((r, i) => commissionHtml(state, r, i === 0))
    : h`<div class="card cm-empty"><div class="oq-h">${(state.commissions?.done ?? []).length ? 'Every commission is delivered' : 'No commission is open right now'}</div><p class="muted">${nextHint(state) || (waiting ? 'The ones below come back as soon as you can reach their colors.' : 'New ones appear as your catalog grows.')}</p>${button('Back to orders', { attrs: { 'data-action': 'cele-orders' } })}</div>`}
${capstoneTeaser(state)}
${laterHtml(state)}
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

/** Scroll to (and briefly outline) a step from a deep link: the Ledger's "Almost there", Next. */
function focusStep() {
  const f = S.focus;
  S.focus = null;
  if (!f || !S.body) return;
  const sel = Number.isInteger(f.stepIndex) ? `[data-step-row="${f.commissionId}:${f.stepIndex}"]` : `.cm-card[data-commission="${f.commissionId}"]`;
  const el = S.body.querySelector(sel);
  if (!el) return;
  try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
  if (el.classList.contains('cm-step')) el.classList.add('is-focus');
}

// ---------------------------------------------------------------------------
// The how-to sheet
// ---------------------------------------------------------------------------

function openHowTo() {
  S.sheet = null;
  S.how = true;
  S.layer.hidden = false;
  S.layer.classList.remove('center');
  S.layer.innerHTML = String(h`<div class="cm-back" data-action="sheet-close"></div>
<div class="sheet cm-how" role="dialog" aria-label="How commissions work" data-howto>
<div class="oq-h">How commissions work</div>
<p>Commissions are big projects for people in town. Each one asks for a few kinds of color, by the jar. They never expire, so take all the time you like.</p>
<h3>Filling one, step by step</h3>
<ol>
<li>Read a step. It says exactly what counts, and shows which of your colors count right under it.</li>
<li>Make jars of one of them: set a mixer to that color. The shop keeps those jars for the commission instead of selling them.</li>
<li>Tap Deliver and choose how many jars to hand over. A few at a time is perfect.</li>
<li>Some steps ask for different colors, pure jars, or a container from the Merge Shelf. The step says so, and its button takes you where to get it.</li>
<li>When every step is done, the commission finishes on its own.</li>
</ol>
<h3>What you get</h3>
<p>A big Coin payment, a new signature color for your catalog, and a trophy for the workshop.</p>
<h3>If you leave one</h3>
<p>Nothing is lost. Jars you delivered stay delivered, and you can come back any time. To try a different one, tap Set aside for now: it keeps its progress and comes back when there is room.</p>
${button('Show me on the screen', { block: true, attrs: { 'data-guide-replay': 'commissions', 'data-action': 'sheet-close' } })}
${button('Got it', { variant: 'primary', block: true, attrs: { 'data-action': 'sheet-close' } })}
</div>`);
}

// ---------------------------------------------------------------------------
// The delivery sheet
// ---------------------------------------------------------------------------

function closeLayer() {
  S.sheet = null;
  S.how = false;
  S.sheetSig = '';
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
  const again = !S.layer.hidden && !!S.layer.querySelector('.sheet'); // a re-render (stepper, a pick) must not slide the sheet up again
  const prevScroll = keepScroll ? S.layer.querySelector('.cm-list')?.scrollTop ?? 0 : 0;
  const isTier = shelfStep(step);
  S.sheetSig = JSON.stringify(list);
  S.layer.hidden = false;
  S.layer.classList.remove('center');
  S.layer.innerHTML = String(h`<div class="cm-back" data-action="sheet-close"></div>
<div class="sheet" role="dialog" aria-label="Deliver stock">
<div class="oq-h">Deliver to ${def.name}</div>
<div class="small muted">${stepLabel(step, rec.steps[sh.stepIndex])}${step.purity ? `, ${PURITY_LABEL[step.purity].toLowerCase()}` : ''}${(step.distinct ?? 1) > 1 ? `, from ${step.distinct} different colors` : ''}</div>
${list.length
    ? h`<div class="cm-list">${list.map((c) => h`<button type="button" class="cm-opt${c.id === sh.colorId ? ' is-sel' : ''}" data-lift="1.02" data-action="sheet-color" data-color="${c.id}" data-tap>${swatch(c.hex, 36)}<span class="nm">${c.name}</span><span class="have num">${fmt(c.avail)} ${isTier ? (c.avail === 1 ? 'container' : 'containers') : jarsWord(c.avail)}</span></button>`)}</div>`
    : h`<div class="card flat"><div class="semi">Nothing in stock fits this step yet</div><div class="small muted">${planOf(S.ctx.sim.commissions.stepGuide(state, sh.commissionId, sh.stepIndex)).text}</div></div>`}
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
  if (again) {
    S.layer.querySelectorAll('.sheet, .cm-back').forEach((n) => { n.style.animation = 'none'; });
    const q = S.layer.querySelector('.qty');
    if (q && sh.qty !== sh.lastQty) S.ctx.fx.spring(q, { from: { transform: 'scale(1.18)' }, to: { transform: 'scale(1)' }, preset: 'firm' });
  }
  sh.lastQty = sh.qty;
}

const REASONS = {
  'wrong-color': 'That color does not fit this step.',
  'need-variety': 'This step wants a different color now. Pick one you have not delivered yet.',
  'no-stock': 'There are no matching jars on hand right now.',
  'no-container': 'There is no matching container on the shelf yet.',
  done: 'That step is already done.',
};

/** A stand-in "element" for a spot that is about to leave the DOM (flyTo only reads its rect). */
const rectOf = (el) => {
  const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  return { getBoundingClientRect: () => r || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 } };
};

/** The step's progress bar in the freshly drawn card, plus its previous fill (0..1) read from the old DOM. */
function stepBar(commissionId, stepIndex) {
  const card = S.body && S.body.querySelector(`.cm-card[data-commission="${commissionId}"]`);
  const step = card && card.querySelectorAll('.cm-step')[stepIndex];
  return step ? step.querySelector('.progress') : null;
}

function deliver() {
  const { ctx } = S;
  const fx = ctx.fx;
  const sh = S.sheet;
  if (!sh || !sh.colorId || sh.qty < 1) return;
  const def = defOf(sh.commissionId);
  const step = def?.steps[sh.stepIndex];
  // Where the jars leave from (the stock row she picked) and how full the bar was, before the redraw.
  const from = rectOf(S.layer.querySelector('.cm-opt.is-sel') || S.layer.querySelector('[data-action="sheet-go"]'));
  const oldBar = stepBar(sh.commissionId, sh.stepIndex);
  const oldFill = oldBar ? Number(oldBar.getAttribute('aria-valuenow')) / 100 : 0;
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
  if (res.completed && res.completed.ok) {
    if (res.stepDone) ctx.audio.chord([0.3, 0.47, 0.64, 0.81], 0.5);
    S.note = null;
    celebrate(res.completed);
    return;
  }
  // The result of this delivery, and the next step.
  const rec = (stateOf().commissions?.open ?? []).find((c) => c.id === sh.commissionId);
  const delivered = res.delivered === 1 && shelfStep(step) ? 'a container' : `${fmt(res.delivered)} ${jarsWord(res.delivered)}`;
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
      const left = Math.max(0, Math.ceil(step.jars - (rec.steps[sh.stepIndex].delivered ?? 0) - 1e-9));
      const unit = shelfStep(step) ? (left === 1 ? 'container' : 'containers') : jarsWord(left);
      text = `${fmt(left)} more ${unit} to finish this step.`;
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

  // The jars fly from the stock row to the step's bar; the bar holds its old fill until they land, then
  // springs to the new one. A finished step gets its chord and flakes on arrival; sounds wait for the landing.
  const bar = stepBar(sh.commissionId, sh.stepIndex);
  const fill = bar ? Number(bar.getAttribute('aria-valuenow')) / 100 : 0;
  const span = bar && bar.firstElementChild;
  const k = fill > 0 ? Math.max(0, Math.min(1, oldFill / fill)) : 1;
  const hold = !!span && k < 1 && !fx.isReducedMotion();
  if (hold) span.style.transform = `scaleX(${k})`;
  const landed = () => {
    if (hold && span.isConnected) {
      span.style.transform = '';
      fx.spring(span, { from: { transform: `scaleX(${k})` }, to: { transform: 'scaleX(1)' }, preset: 'soft' });
    }
    if (res.stepDone) {
      ctx.audio.chord([0.3, 0.47, 0.64, 0.81], 0.5);
      ctx.haptics.success();
      if (bar && bar.isConnected) fx.confetti([hex, '#E2B04A', '#C99A2E'], bar, { count: 14 });
    } else {
      ctx.audio.clink(2);
    }
  };
  if (bar) {
    const count = Math.max(3, Math.min(8, Math.round(res.delivered) || 3));
    Promise.resolve(fx.flyTo(from, bar, hex, { count, ms: 480 })).then(landed, landed);
  } else {
    landed();
  }
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
    ctx.fx.stamp(card, 'Done', { hold: 900, hex: '#2F6B4F' });
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
  const card = S.body && S.body.querySelector(`.cm-card[data-commission="${commissionId}"]`);
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
    { anchor: '[data-coach="commission-step"]', text: 'Each step shows which of your colors count', endsOn: 'got-it', side: 'above' },
    { anchor: '[data-coach="commission-deliver"]', text: 'Deliver what you have, or tap to see where to get it', endsOn: 'action', side: 'above' },
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
    root.innerHTML = String(h`<div class="screen-head oq-head">${backButton('Back')}<div class="titles"><div class="title">Commissions</div><button type="button" class="how-link" data-action="howto" data-tap>How does this work?</button></div><span class="spacer"></span></div><div class="screen-body" data-body></div><div class="cm-layer" data-layer hidden></div>`);
    S.body = root.querySelector('[data-body]');
    S.layer = root.querySelector('[data-layer]');
    const release = () => {
      if (!S.down) return;
      S.down = false;
      if (S.dirty) { S.dirty = false; later(() => paint(true), 60); }
    };
    bindTouchFeel(root, ctx.fx, { lift: '.cm-opt, .cm-empty.is-tap' });
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
        case 'howto': openHowTo(); break;
        case 'go': {
          let params = {};
          try { params = JSON.parse(t.getAttribute('data-params') || '{}'); } catch (err) { params = {}; }
          closeLayer();
          ctx.navigate(t.getAttribute('data-screen'), params);
          break;
        }
        case 'make': {
          ensureWorkshopStyles();
          const colorId = t.getAttribute('data-color');
          openRecipeSheet(ctx, { colorId, host: root, onDone: () => paint(true) });
          break;
        }
        case 'set-aside': {
          const id = t.getAttribute('data-commission');
          const res = ctx.game.act(ctx.sim.commissions.setAside, { commissionId: id });
          if (res && res.ok) {
            const nd = res.replacedBy ? defOf(res.replacedBy) : null;
            ctx.toast(nd ? `Set aside, progress kept. ${nd.name} takes its place.` : 'Set aside, progress kept.');
          }
          paint(true);
          break;
        }
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

  show(params = {}) {
    S.focus = params && params.commissionId ? { commissionId: params.commissionId, stepIndex: Number.isInteger(params.stepIndex) ? params.stepIndex : null } : null;
    S.down = false;
    S.dirty = false;
    S.note = null;
    S.cele = null;
    S.celeRolled = false;
    closeLayer();
    paint(true);
    if (S.focus) later(focusStep, 60);
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
    // An open delivery sheet follows the stock live (jars arrive while she looks).
    if (S.sheet && !S.down) {
      const sig = JSON.stringify(eligible(stateOf(), S.sheet.commissionId, S.sheet.stepIndex));
      if (sig !== S.sheetSig) renderSheet();
    }
  },
};
