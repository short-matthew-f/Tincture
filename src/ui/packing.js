/**
 * packing.js: the crate sort before a shipment (overlay `packing`, fullscreen).
 *
 * `navigate('packing', {vehicle, routeId, cargo})` (the shipping UI) starts it:
 * the chosen route's crate plus one or two other routes as decoys, and the cargo
 * expanded into jar units (24 at most). A conveyor shows the current jar and the
 * next two; tap a crate to drop it in (a bounce and a thunk). Missorts are
 * neutral: no red, no sound of failure, the crate just ships at base value. When
 * the last jar lands the lids close with a stamp, the shipment is dispatched
 * through sim.shipping.dispatch({vehicle, routeId, cargo, packed: result.clean})
 * (which already fires questEvent('crateShipped') and eventPoints('crate')), and
 * a result card says "Clean crate: +25%".
 *
 * Implements DESIGN.md "Active play > Packing", "Interaction feel > Packing drop"
 * and "UX > Accessibility" (crate jars get patterns in colorblind mode). The
 * Festival of Lanterns twist (rules.packingLanterns) only changes the title and
 * frame. The live puzzle is saved in state.activePuzzles.packing
 * ({vehicle, routeId, picks, loadPicks, puzzle, lanterns}).
 *
 * First-open guide 'packing': `data-coach="packing-crates"` (ends on her first drop, announced by the
 * 'crateDrop' game event this screen emits), then `data-coach="packing-crate-full"` (a got-it step
 * on the first crate that is clean and holding a few jars). The result card says the same thing, so
 * finishing a shipment marks the guide seen. 'packingNext' is the one-time "what's next" card after her
 * first result.
 */

import { h, raw, backButton, button, iconSvg, containerSvg, safeHex, escapeHtml } from './kit.js';
import { stateRng, shuffle } from '../rng.js';
import {
  injectStyle, PZ_CSS, ensureActive, activeOf, FAMILY_HEX, FAMILY_ORDER, familyName, patternFill,
  ensureDefs, lightnessOf, stampSvg, yardStatus, yardTag, gentleDuration, coinsText,
} from './puzzles.js';
import { howThisWorksHtml, markGuideSeen, isSeen } from './guide.js';

const MAX_JARS = 24;

const CSS = `
.pk-conveyor { flex-direction: row; align-items: center; gap: 16px; padding: 14px; position: relative; overflow: hidden; }
.pk-conveyor.is-lanterns { background: linear-gradient(#FFF6DF, var(--paper) 55%); box-shadow: 0 0 0 2px #E2B04A, var(--cut); }
.pk-conveyor.is-lanterns::before { content: ''; position: absolute; left: 10px; right: 10px; top: 4px; height: 10px; background: radial-gradient(circle at 9px 5px, #DE7A2E 0 4px, transparent 4.5px) 0 0 / 28px 10px repeat-x; opacity: .9; }
.pk-jarwrap { flex: 0 0 auto; width: 66px; animation: pk-in 240ms var(--ease-out) both; }
@keyframes pk-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
.pk-now .lbl { font-size: 13px; color: var(--ink-soft); }
.pk-now .nm { font-family: var(--font-display); font-size: 22px; line-height: 1.15; }
.pk-now .fam { display: inline-flex; margin-top: 2px; }
.pk-next { display: flex; gap: 6px; margin-top: 6px; align-items: center; font-size: 12px; color: var(--ink-soft); }
.pk-next svg { display: block; }
.pk-crates { display: flex; flex-direction: column; gap: 10px; }
.pk-crate { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; border-radius: 14px; background: #A87449; color: var(--paper); box-shadow: 0 4px 0 rgba(42,38,34,.3); min-height: 108px; transition: transform 120ms var(--ease-out), box-shadow 120ms var(--ease-out); }
.pk-crate:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(42,38,34,.3); }
.pk-crate:disabled { transform: none; }
.pk-top { display: flex; align-items: center; gap: 8px; }
.pk-name { background: var(--paper); color: var(--ink); border-radius: 6px; padding: 3px 9px; font-family: var(--font-display); font-size: 15px; }
.pk-pal { display: flex; gap: 3px; align-items: center; }
.pk-count { margin-left: auto; font-size: 13px; font-weight: 600; }
.pk-palname { font-size: 12px; opacity: .92; margin-top: -4px; }
.pk-slots { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.pk-slot { display: block; height: 30px; border-radius: 8px; background: #8A5E40; box-shadow: inset 0 2px 0 rgba(0,0,0,.25); }
.pk-jar { display: block; width: 100%; height: 30px; filter: drop-shadow(0 2px 0 rgba(42,38,34,.3)); }
.pk-jar.pk-drop { animation: pk-drop 260ms cubic-bezier(.3,1.5,.5,1) both; }
@keyframes pk-drop { 0% { opacity: 0; transform: translateY(-46px); } 55% { opacity: 1; transform: translateY(2px); } 100% { opacity: 1; transform: none; } }
.pk-lid { position: absolute; inset: 0; background: linear-gradient(#B98255, #9A6A44); border-radius: 14px; transform: translateY(-101%); display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: inset 0 -4px 0 rgba(42,38,34,.25); }
.pk-lid .pk-lidname { font-family: var(--font-display); font-size: 16px; color: var(--paper); }
.pk-crate.is-closed .pk-lid { transform: none; transition: transform 200ms var(--ease-in-out); }
.pk-lid .pz-stamp { background: rgba(247,244,236,.92); border-radius: 50%; }
.pk-lid .pk-stampin { animation: pz-stamp-in 240ms var(--ease-out) both; }
section[data-screen="packing"] .how-link { min-height: 24px; padding: 0 8px; line-height: 1; position: relative; }
section[data-screen="packing"] .how-link::before { content: ''; position: absolute; inset: -10px -8px; }
.pk-hint { font-size: 13px; color: var(--ink-soft); text-align: center; }
.pk-empty-actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: 100%; max-width: 260px; }
.pk-empty-actions .btn.is-quiet { box-shadow: 0 3px 0 var(--shadow), inset 0 0 0 1.5px rgba(42,38,34,.2); }
.pk-result .bonus { display: inline-flex; align-items: center; gap: 8px; }
`;

let C = null;
let ROOT = null;
const K = {
  visible: false, entry: null, celebrating: false, result: null, timers: [], el: {}, last: null, cb: false, sig: '', from: 'workshop',
};

/** Where Back leads: the table when she came from there, else the workshop (the yard lives in it). */
const backLabel = () => (K.from === 'puzzles' ? 'Back to the table' : 'Back to the workshop');

const later = (fn, ms) => { const id = setTimeout(fn, ms); K.timers.push(id); return id; };
const clearTimers = () => { K.timers.forEach(clearTimeout); K.timers = []; };
const reduced = () => !!(C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());

// ---------------------------------------------------------------------------
// Sim-style actions
// ---------------------------------------------------------------------------

function routeDefs() {
  const list = C.content && C.content.ROUTES;
  return Array.isArray(list) ? list : [];
}

/** Cargo picks -> at most MAX_JARS jar units (proportional, at least one per color). */
function expandJars(s, picks) {
  const total = picks.reduce((n, p) => n + p.jars, 0);
  const scale = total > MAX_JARS ? MAX_JARS / total : 1;
  const counts = picks.map((p) => Math.max(1, Math.round(p.jars * scale)));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum > MAX_JARS) {
    let big = 0;
    counts.forEach((c, i) => { if (c > counts[big]) big = i; });
    if (counts[big] <= 1) break;
    counts[big] -= 1;
    sum -= 1;
  }
  const jars = [];
  picks.forEach((p, i) => {
    const hex = C.sim.economy.colorHex(p.colorId);
    const family = C.sim.economy.colorFamily(p.colorId);
    for (let n = 0; n < counts[i]; n++) jars.push({ color: p.colorId, hex, family });
  });
  return jars.slice(0, MAX_JARS);
}

/** Chosen route + 1 to 2 decoys; widens the set when a jar's family fits no crate. */
function pickRoutes(s, routeId, jars, now, rng) {
  const all = routeDefs();
  const chosen = all.find((r) => r.id === routeId) || null;
  let avail = [];
  try { avail = C.sim.shipping.availableRoutes(s, now); } catch { avail = []; }
  const others = (list) => list.filter((r) => r.id !== routeId && !r.any);
  let decoys = shuffle(rng, others(avail)).slice(0, rng() < 0.6 ? 2 : 1);
  if (!decoys.length) decoys = shuffle(rng, others(all)).slice(0, 2);
  const routes = [];
  if (chosen) routes.push(chosen);
  routes.push(...decoys);
  // Every jar must have a home, so a clean shipment is always possible: add the route that covers
  // the most homeless families, and fall back to the take-anything crate when four are not enough.
  const fams = [...new Set(jars.map((j) => j.family))];
  const homeless = () => fams.filter((f) => !routes.some((r) => r.any || r.palette.includes(f)));
  while (homeless().length && routes.length < 4) {
    const miss = homeless();
    const best = others(all)
      .filter((r) => !routes.includes(r))
      .map((r) => ({ r, n: miss.filter((f) => r.palette.includes(f)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)[0];
    if (!best) break;
    routes.push(best.r);
  }
  if (homeless().length) {
    const catchAll = all.find((r) => r.any);
    if (catchAll && !routes.includes(catchAll)) {
      // Make room by dropping a decoy that no jar wants.
      const wanted = (r) => fams.some((f) => r.palette.includes(f));
      while (routes.length >= 4) {
        const idx = routes.findIndex((r) => r !== chosen && !wanted(r));
        routes.splice(idx >= 0 ? idx : routes.length - 1, 1);
      }
      routes.push(catchAll);
    }
  }
  return shuffle(rng, routes);
}

function createAct(s, args, now) {
  const fleet = (s.stations && s.stations.fleet) || [];
  const v = fleet[args.vehicle] || null;
  const raw0 = Array.isArray(args.cargo) && args.cargo.length ? args.cargo : (v && v.cargo) || [];
  const picks = raw0
    .map((c) => ({ colorId: c.colorId, jars: Math.max(0, Number(c.jars) || 0) }))
    .filter((c) => c.jars > 0 && c.colorId);
  if (!picks.length) return null;
  const routeId = args.routeId || (v && v.route) || null;
  const loaded = !!(v && Array.isArray(v.cargo) && v.cargo.length);
  const rng = stateRng(s);
  const jars = expandJars(s, picks);
  const routes = pickRoutes(s, routeId, jars, now, rng);
  if (!routes.length) return null;
  let lanterns = false;
  try {
    const tw = C.sim.events.eventTwist(s);
    lanterns = !!(tw && tw.rules && tw.rules.packingLanterns);
  } catch { lanterns = false; }
  const puzzle = C.puzzles.packing.create({
    routes: routes.map((r) => ({ id: r.id, name: r.name, palette: r.palette.slice(), any: !!r.any })),
    jars,
    ...(lanterns ? { twist: 'lanterns' } : null),
  }, rng);
  const entry = { vehicle: args.vehicle, routeId, picks, loadPicks: loaded ? null : picks, puzzle, lanterns };
  ensureActive(s).packing = entry;
  return entry;
}

function dropAct(s, args, now) {
  const e = s.activePuzzles && s.activePuzzles.packing;
  if (!e) return { ok: false };
  const r = C.puzzles.packing.drop(e.puzzle, args.routeId);
  if (r.ok && r.done) {
    const result = C.puzzles.packing.result(e.puzzle);
    const disp = C.sim.shipping.dispatch(s, {
      vehicle: e.vehicle, routeId: e.routeId, cargo: e.loadPicks || undefined, packed: result.clean,
    }, now);
    if (s.lifetime) s.lifetime.puzzles = (Number.isFinite(s.lifetime.puzzles) ? s.lifetime.puzzles : 0) + 1;
    ensureActive(s).packing = null;
    r.final = { result, disp, now };
  }
  return r;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function chipSvg(hex, idx, cb, { cls = '' } = {}) {
  const fill = safeHex(hex);
  return `<svg class="pk-jar ${cls}" viewBox="0 0 40 30" aria-hidden="true" focusable="false"><rect x="11" y="1" width="18" height="6" rx="2.5" fill="#C9A277" stroke="#2A2622" stroke-width="1.4"/><rect x="2" y="5" width="36" height="24" rx="8" fill="${fill}" stroke="#2A2622" stroke-width="1.6"/>${cb ? `<rect x="2" y="5" width="36" height="24" rx="8" fill="${patternFill(idx)}"/>` : ''}<rect x="7" y="9" width="4" height="12" rx="2" fill="#fff" fill-opacity=".4"/></svg>`;
}

function famIdx(f) {
  const i = FAMILY_ORDER.indexOf(f);
  return i < 0 ? 8 : i;
}

function palChip(f, cb) {
  return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><rect x=".75" y=".75" width="12.5" height="12.5" rx="3" fill="${FAMILY_HEX[f] || '#8A8580'}" stroke="#F7F4EC" stroke-width="1.5"/>${cb ? `<rect x=".75" y=".75" width="12.5" height="12.5" rx="3" fill="${patternFill(famIdx(f))}"/>` : ''}</svg>`;
}

/** How many jars make a crate worth a word about clean crates (a short shipment needs fewer). */
const fullAt = (puz) => (puz.conveyor.length >= 6 ? 3 : 2);
const accepts = (route, family) => C.puzzles.packing.accepts(route, family);

function crateHtml(route, puz, cb, justDropped) {
  const jars = puz.crates[route.id] || [];
  const nm = escapeHtml(route.name);
  const nSlots = Math.max(12, Math.ceil(jars.length / 6) * 6);
  const slots = [];
  for (let i = 0; i < nSlots; i++) {
    const j = jars[i];
    slots.push(j
      ? chipSvg(j.hex, famIdx(j.family), cb, { cls: justDropped === route.id && i === jars.length - 1 ? 'pk-drop' : '' })
      : '<i class="pk-slot"></i>');
  }
  const pal = route.any
    ? '<span class="pk-palname">Takes any color</span>'
    : `<span class="pk-pal">${route.palette.map((f) => palChip(f, cb)).join('')}</span>`;
  const names = route.any ? '' : `<div class="pk-palname">${route.palette.map(familyName).join(', ')}</div>`;
  const ready = jars.length >= fullAt(puz) && jars.every((j) => accepts(route, j.family));
  return `<button type="button" class="pk-crate" data-crate="${route.id}"${ready ? ' data-coach="packing-crate-full"' : ''} data-tap aria-label="Pack into the ${nm} crate. ${jars.length} ${jars.length === 1 ? 'jar' : 'jars'} so far.">
<div class="pk-top"><span class="pk-name">${nm}</span>${pal}<span class="pk-count">${jars.length} ${jars.length === 1 ? 'jar' : 'jars'}</span></div>${names}
<div class="pk-slots">${slots.join('')}</div>
<div class="pk-lid" data-lid></div></button>`;
}

function jarName(c) {
  return C.sim.displayName ? C.sim.displayName(C.game.state, c) : c;
}

function conveyorHtml(e) {
  const puz = e.puzzle;
  const cur = C.puzzles.packing.currentJar(puz);
  const next = cur ? puz.conveyor.slice(puz.index + 1, puz.index + 3) : [];
  const title = e.lanterns ? 'Stringing lanterns' : null;
  if (!cur) {
    return h`<div class="card pk-conveyor${e.lanterns ? ' is-lanterns' : ''}" data-conveyor><div class="pk-now"><div class="lbl">Shipment ready</div><div class="nm">All packed</div></div></div>`;
  }
  return h`<div class="card pk-conveyor${e.lanterns ? ' is-lanterns' : ''}" data-conveyor>
<div class="pk-jarwrap" data-jar>${containerSvg(2, cur.hex, { size: 66, label: jarName(cur.color) })}</div>
<div class="pk-now"><div class="lbl">${title ? 'Next lantern on the string' : 'Next on the conveyor'}</div><div class="nm">${jarName(cur.color)}</div>
<span class="tag pk-fam" style="margin-left:0">${familyName(cur.family)}</span>
${next.length ? h`<div class="pk-next"><span>Then</span>${raw(next.map((j) => chipSvg(j.hex, famIdx(j.family), K.cb).replace('class="pk-jar ', 'width="30" height="22" class="pk-jar ')).join(''))}</div>` : ''}</div></div>`;
}

function leftLabel(e) {
  const puz = e.puzzle;
  const left = puz.conveyor.length - puz.index;
  return e.lanterns
    ? `${left} ${left === 1 ? 'lantern' : 'lanterns'} left to string`
    : `${left} ${left === 1 ? 'jar' : 'jars'} left to pack`;
}

function cratesHtml(e, justDropped) {
  return e.puzzle.routes.map((r) => crateHtml(r, e.puzzle, K.cb, justDropped)).join('');
}

function emptyHtml() {
  const yard = yardStatus(C, C.game.state);
  const go = yard.open
    ? button('Go to the Loading Yard', { variant: 'primary', block: true, attrs: { 'data-action': 'to-yard' } })
    : '';
  return h`<div class="screen-head">${backButton(backLabel())}<div class="titles"><div class="title">Packing</div></div><div class="spacer"></div></div>
<div class="screen-body pz-body"><div class="card pz-empty"><div class="h2">Crates are all shipped</div><div class="hint">Packing happens when you ship a crate: load a cart at the Loading Yard and pack it by hand.</div>${yard.open ? '' : yardTag(yard)}<div class="pk-empty-actions">${go}${button(backLabel(), { block: true, cls: 'is-quiet', attrs: { 'data-action': 'done' } })}</div></div></div>`;
}

function drawAll(justDropped) {
  const st = C.game.state;
  K.cb = !!(st.settings && st.settings.colorblind);
  const e = K.entry;
  if (!e) { ROOT.innerHTML = String(emptyHtml()); K.el = {}; return; }
  K.sig = sigOf(e);
  const title = e.lanterns ? 'Stringing lanterns' : 'Packing';
  ROOT.innerHTML = String(h`<div class="screen-head">${backButton(backLabel())}
<div class="titles"><div class="title">${title}</div><div class="subtitle" data-left>${leftLabel(e)}</div>${howThisWorksHtml('packing')}</div><div class="spacer"></div></div>
<div class="screen-body pz-body">
<div data-conveyor-wrap>${conveyorHtml(e)}</div>
<div class="pk-crates" data-crates data-coach="packing-crates">${raw(cratesHtml(e, justDropped))}</div>
<div class="pk-hint" data-hint>A clean crate ships at +25%. A mixed one still ships, at base value.</div>
</div>`);
  K.el = {
    left: ROOT.querySelector('[data-left]'),
    conv: ROOT.querySelector('[data-conveyor-wrap]'),
    crates: ROOT.querySelector('[data-crates]'),
    hint: ROOT.querySelector('[data-hint]'),
  };
}

function sigOf(e) {
  return `${e.vehicle}|${e.routeId}|${e.puzzle.index}|${K.cb ? 1 : 0}`;
}

// ---------------------------------------------------------------------------
// Drop, finish, result
// ---------------------------------------------------------------------------

function drop(routeId) {
  const e = K.entry;
  if (!e) return;
  const puz = e.puzzle;
  const jar = C.puzzles.packing.currentJar(puz);
  if (!jar) return;
  const res = C.game.act(dropAct, { routeId });
  if (!res || !res.ok) return;
  if (C.game.emit) C.game.emit('crateDrop', { routeId, clean: !!res.clean }); // ends the guide's first step
  C.audio.thunk(0.8);
  C.haptics.light();
  if (res.clean) C.audio.tink(lightnessOf(C, jar.hex), 0.07, 0.18); // a quiet glass note only for a fit; a miss is just a thunk
  K.last = routeId;
  K.sig = sigOf(e);
  K.el.left.textContent = leftLabel(e);
  K.el.conv.innerHTML = String(conveyorHtml(e));
  K.el.crates.innerHTML = cratesHtml(e, routeId);
  if (res.done) {
    K.celebrating = true;
    K.final = res.final;
    later(closeLids, 320);
  }
}

function closeLids() {
  if (!K.celebrating) return;
  const e = K.entry;
  const res = K.final.result;
  let k = 0;
  const crates = K.el.crates.querySelectorAll('.pk-crate');
  crates.forEach((el) => {
    const id = el.dataset.crate;
    const route = e.puzzle.routes.find((r) => r.id === id);
    const count = (e.puzzle.crates[id] || []).length;
    el.setAttribute('aria-disabled', 'true');
    if (!count) return;
    const clean = res.perCrate[id] && res.perCrate[id].clean;
    const lid = el.querySelector('[data-lid]');
    const delay = reduced() ? 0 : k * 120;
    later(() => {
      lid.innerHTML = `<span class="pk-lidname">${escapeHtml(route.name)}</span>${clean ? `<span class="pk-stampin">${stampSvg('Clean', { sub: 'CRATE', tone: '#3F7A5A', size: 54 })}</span>` : ''}`;
      el.classList.add('is-closed');
      if (clean) C.audio.stamp(); else C.audio.thunk(0.5);
    }, delay);
    k++;
  });
  if (res.clean) {
    later(() => C.audio.chord([0.35, 0.5, 0.65, 0.8], 1), 260);
    later(() => C.haptics.success(), 260);
  }
  later(finalize, 520 + k * 120);
}

function skip() {
  if (!K.celebrating) return;
  clearTimers();
  // Show every lid closed, then the result.
  const e = K.entry;
  const res = K.final.result;
  K.el.crates.querySelectorAll('.pk-crate').forEach((el) => {
    const id = el.dataset.crate;
    const route = e.puzzle.routes.find((r) => r.id === id);
    el.setAttribute('aria-disabled', 'true');
    if (!(e.puzzle.crates[id] || []).length) return;
    const clean = res.perCrate[id] && res.perCrate[id].clean;
    el.querySelector('[data-lid]').innerHTML = `<span class="pk-lidname">${escapeHtml(route.name)}</span>${clean ? stampSvg('Clean', { sub: 'CRATE', tone: '#3F7A5A', size: 54 }) : ''}`;
    el.classList.add('is-closed');
  });
  finalize();
}

function finalize() {
  if (!K.celebrating) return;
  clearTimers();
  K.celebrating = false;
  const { result, disp, now } = K.final;
  K.result = K.final;
  let head;
  let detail;
  if (result.clean) {
    head = '+25% clean crate';
    detail = 'Every jar found its crate, so this shipment is paid a quarter more.';
  } else {
    head = 'Shipped at base value';
    detail = 'Packed and on its way. A fully clean crate earns +25% next time.';
  }
  const lines = [];
  if (disp && disp.ok) {
    lines.push(h`<li>${iconSvg('coin', { size: 18 })}<span>Worth about <b class="num">${coinsText(C, disp.value)}</b> coins on arrival</span></li>`);
    const ms = Number.isFinite(disp.arrivesAt) ? Math.max(0, disp.arrivesAt - now) : 0;
    if (ms > 0) lines.push(h`<li>${iconSvg('check', { size: 18 })}<span>Back in about ${gentleDuration(ms)}</span></li>`);
  } else {
    lines.push(h`<li>${iconSvg('check', { size: 18 })}<span>This cart had already left, so nothing was sent. Nothing is lost.</span></li>`);
  }
  const card = h`<div class="card pz-result pk-result" data-result><div class="hl">${head}</div><div class="hint">${detail}</div><ul class="lines">${lines}</ul>
<div class="pz-actions">${button('Back to the workshop', { variant: 'primary', attrs: { 'data-action': 'to-workshop' } })}</div></div>`;
  // The result takes the conveyor's place at the top so it is in view without scrolling.
  K.el.conv.innerHTML = String(card);
  if (K.el.hint) K.el.hint.remove();
  K.el.hint = null;
  if (K.el.left) K.el.left.textContent = 'All packed';
  const top = ROOT.querySelector('.screen-body');
  if (top) top.scrollTop = 0;
  stopGuide();
  if (!isSeen(C.game.state, 'packing')) C.game.act(markGuideSeen, { id: 'packing' }); // the result card says it too
  firstResultCard();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function onClick(e) {
  if (K.celebrating) { skip(); return; }
  const crate = e.target.closest('[data-crate]');
  if (crate && ROOT.contains(crate)) {
    if (!K.result && !crate.disabled) drop(crate.dataset.crate);
    return;
  }
  const a = e.target.closest('[data-action]');
  if (!a || !ROOT.contains(a)) return;
  const act = a.dataset.action;
  if (act === 'done') {
    K.result = null;
    C.back();
  } else if (act === 'to-workshop') {
    K.result = null;
    C.navigate('workshop', {});
  } else if (act === 'to-yard') {
    K.result = null;
    C.navigate('workshop', { sheet: 'yard' });
  }
}

// ---------------------------------------------------------------------------
// First-open guide and the "what's next" card after her first result
// ---------------------------------------------------------------------------

let guide = null;
let guideTimer = 0;

function stopGuide() {
  clearTimeout(guideTimer);
  guideTimer = 0;
  if (guide) { try { guide.stop(); } catch (e) { /* ignore */ } guide = null; }
}

/** The packing guide's steps; `later` drops the first-drop step for a crate she has already started on. */
function packingSteps(later) {
  const first = { anchor: '[data-coach="packing-crates"]', text: 'Drop each jar in the crate that wants its family.', endsOn: 'action', event: 'crateDrop',
    side: 'below', next: '[data-conveyor]' };
  const clean = { anchor: '[data-coach="packing-crate-full"]', text: 'A clean crate ships for +25%.', endsOn: 'got-it', side: 'below',
    when: () => !!(ROOT && ROOT.querySelector('[data-coach="packing-crate-full"]')) };
  return later ? [clean] : [first, clean];
}

/** Registered at mount so the unlock hook (app.js) and "How this works" can find it; show() re-registers it per puzzle. */
function registerGuide() {
  if (typeof C.guide === 'function') C.guide('packing', packingSteps(false), { screen: 'packing' });
}

function startGuide() {
  stopGuide();
  const e = K.entry;
  if (typeof C.guide !== 'function' || !e || K.result || e.puzzle.done) return;
  guide = C.guide('packing', packingSteps(e.puzzle.index > 0), { screen: 'packing' });
  const g = guide;
  guideTimer = setTimeout(() => { guideTimer = 0; if (g === guide && K.visible) g.start(); }, 300);
}

/** The index of a loaded cart that still waits at the yard (null when none). */
function waitingVehicle(st) {
  const fleet = (st.stations && st.stations.fleet) || [];
  const i = fleet.findIndex((v) => v && C.sim.shipping.isIdle(v) && v.route && Array.isArray(v.cargo) && v.cargo.length > 0);
  return i >= 0 ? i : null;
}

function firstResultCard() {
  if (typeof C.guide !== 'function' || isSeen(C.game.state, 'packingNext')) return;
  C.game.act(markGuideSeen, { id: 'packingNext' });
  later(() => {
    if (!K.visible || !K.result) return;
    const st = C.game.state;
    const vi = waitingVehicle(st);
    const more = vi === null
      ? { label: 'Stay here' }
      : { label: 'Pack the next crate', run: () => {
        if (!K.visible) return;
        const v = (C.game.state.stations.fleet || [])[vi];
        K.result = null;
        K.entry = adopt({ vehicle: vi, routeId: v ? v.route : undefined });
        drawAll();
      } };
    C.guide.whatsNext({ title: 'Shipment on its way', more, next: { label: 'Back to the workshop', run: () => C.navigate('workshop', {}) } });
  }, 900);
}

function adopt(params) {
  const st = C.game.state;
  const cur = activeOf(st).packing || null;
  const wants = params && (params.routeId !== undefined || params.vehicle !== undefined || (Array.isArray(params.cargo) && params.cargo.length));
  if (wants && !(cur && cur.vehicle === params.vehicle && (params.routeId === undefined || cur.routeId === params.routeId))) {
    C.game.act(createAct, { vehicle: params.vehicle, routeId: params.routeId, cargo: params.cargo });
  }
  return activeOf(C.game.state).packing || null;
}

export default {
  id: 'packing',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('shared', PZ_CSS);
    injectStyle('packing', CSS);
    ensureDefs();
    root.addEventListener('click', onClick);
    registerGuide();
  },

  show(params = {}) {
    K.visible = true;
    clearTimers();
    K.from = params && params.from === 'puzzles' ? 'puzzles' : 'workshop';
    const wants = params && (params.routeId !== undefined || params.vehicle !== undefined || (Array.isArray(params.cargo) && params.cargo.length));
    if (K.result && !wants) return; // coming back to a finished result card
    K.result = null;
    K.celebrating = false;
    K.entry = adopt(params);
    drawAll();
    startGuide();
  },

  hide() {
    K.visible = false;
    stopGuide();
    clearTimers();
    K.celebrating = false;
    K.result = null;
  },

  render(state) {
    if (!ROOT || !K.visible || K.celebrating || K.result) return;
    const e = activeOf(state).packing || null;
    const cb = !!(state.settings && state.settings.colorblind);
    if (e !== K.entry || cb !== K.cb || (e && sigOf(e) !== K.sig)) {
      K.entry = e;
      drawAll();
    }
  },
};
