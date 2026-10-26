/**
 * rest.js: Responsibility mode on screen (the rules are src/sim/limits.js).
 *
 * Owns: the gentle rest sheet ("Time for a rest from the Hoop"), the quiet
 * "2 plays left this hour" line and the resting note ("Rests until 3:42 PM",
 * with a small leaf) that the Puzzles hub cards and the room screens show, and
 * `guardStart`, which a screen calls before an action that would start a NEW
 * play. Continuing a play in progress is never guarded.
 *
 * Copy rules (docs/DESIGN.md "Responsibility mode"): warm and plain, never red,
 * never a ticking countdown: only the clock time it is ready again.
 * Any element with data-rest="<gameId>" opens the sheet (app.js listens).
 */

import { h, raw, iconSvg } from './kit.js';

const CSS = `
.rest-note { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; padding: 8px 14px; border: 0; border-radius: var(--radius-sm, 12px); background: rgba(110,154,90,.12); box-shadow: inset 0 0 0 1.5px rgba(110,154,90,.35); color: var(--ink); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; text-align: center; }
.rest-note .icon { flex: 0 0 auto; color: #5E7F4C; }
.rest-note small { font-weight: 500; color: var(--ink-soft); font-size: 13px; }
.rest-left { font-size: 13px; color: var(--ink-soft); text-align: center; }
.rest-sheet-art { display: flex; justify-content: center; margin: 2px 0 4px; }
.rest-sheet p { margin: 0 0 8px; }
.rest-sheet p:last-child { margin-bottom: 0; }
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('rest-css')) return;
  const s = document.createElement('style');
  s.id = 'rest-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Proper names for titles ("Time for a rest from the Hoop"). */
const TITLE_NAME = {
  grading: 'grading boards', purify: 'Purify', tiles: 'the Tile Room', skeins: 'the Winding Room',
  lift: 'the Lifting Table', garden: 'the Dye Garden', tangle: 'the Tangle Basket', hoop: 'the Hoop',
};

/** The window in words: "this hour" for the line, "this hour" / "in the last two hours" for the sheet. */
export function windowWords(min) {
  if (min === 30) return { left: 'this half hour', played: 'in the last half hour' };
  if (min === 120) return { left: 'in these two hours', played: 'in the last two hours' };
  return { left: 'this hour', played: 'this hour' };
}

/** "3:42 PM": the clock time on this device. */
export function clockTime(ms) {
  if (!Number.isFinite(ms)) return '';
  try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}

/** limits.status for one game at the game's clock (null when the sim has no limits). */
export function restStatus(ctx, gameId, state) {
  const L = ctx && ctx.sim && ctx.sim.limits;
  if (!L) return null;
  const st = state || (ctx.game && ctx.game.state);
  const now = ctx.game && typeof ctx.game.now === 'function' ? ctx.game.now() : 0;
  return L.status(st, gameId, now);
}

/** True when a new play of `gameId` would rest right now. */
export function isResting(ctx, gameId, state) {
  const s = restStatus(ctx, gameId, state);
  return !!(s && s.resting);
}

const teacup = () => raw(`<svg width="88" height="64" viewBox="0 0 88 64" aria-hidden="true">
<path d="M34 6 C30 11 38 13 34 19 M44 4 C40 10 48 12 44 18 M54 6 C50 11 58 13 54 19" fill="none" stroke="#9A8F84" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="44" cy="56" rx="34" ry="6" fill="#D9CAA6"/>
<path d="M20 26 H68 V34 C68 46 58 54 44 54 C30 54 20 46 20 34 Z" fill="#A87449"/>
<path d="M68 30 C78 30 78 44 66 44" fill="none" stroke="#A87449" stroke-width="5" stroke-linecap="round"/>
<ellipse cx="44" cy="26" rx="24" ry="4" fill="#7B5236"/>
<path d="M36 44 C36 37 44 33 52 34 C52 41 44 45 36 44 Z" fill="#6E9A5A"/>
<path d="M37 43 C42 40 46 38 50 35.5" fill="none" stroke="#F5EFE3" stroke-width="1.2" stroke-linecap="round"/>
</svg>`);

/** The sheet's words for one game (exported for tests and the quest sheet). */
export function restCopy(ctx, gameId, state) {
  const s = restStatus(ctx, gameId, state) || { limit: 5, windowMin: 60, readyAt: null, used: 5 };
  const w = windowWords(s.windowMin);
  const n = Math.max(s.limit, s.used || 0);
  const name = TITLE_NAME[gameId] || 'this game';
  const played = gameId === 'grading' ? `You've played ${n} boards ${w.played}.` : `You've played it ${n} times ${w.played}.`;
  const at = clockTime(s.readyAt);
  return {
    title: `Time for a rest from ${name}`,
    played,
    ready: at ? `It'll be ready again at ${at}.` : "It'll be ready again soon.",
    away: "Your workshop keeps making color while you're away.",
  };
}

/**
 * openRestSheet(ctx, gameId) -> Promise. The gentle popup: "Back to the
 * workshop" (primary) and a small "Change this in Settings" link.
 */
export function openRestSheet(ctx, gameId) {
  injectCss();
  const c = restCopy(ctx, gameId);
  const body = String(h`<div class="rest-sheet" data-rest-sheet="${gameId}"><div class="rest-sheet-art">${teacup()}</div><p>${c.played} ${c.ready}</p><p>${c.away}</p></div>`);
  const open = ctx.sheet || (ctx.modal);
  if (typeof open !== 'function') return Promise.resolve(null);
  return open({
    title: c.title,
    body,
    actions: [
      { label: 'Back to the workshop', variant: 'primary', value: 'workshop' },
      { label: 'Change this in Settings', variant: 'link', value: 'settings' },
    ],
  }).then((v) => {
    if (v === 'workshop') ctx.navigate('workshop');
    else if (v === 'settings') ctx.navigate('settings', { section: 'rest' });
    return v;
  });
}

/**
 * guardStart(ctx, gameId) -> true when a NEW play may start; otherwise opens
 * the rest sheet and returns false. Never call it for continuing a play.
 */
export function guardStart(ctx, gameId) {
  if (!isResting(ctx, gameId)) return true;
  openRestSheet(ctx, gameId);
  return false;
}

/** A sim result that was refused because the game rests. */
export const restingResult = (r) => !!(r && r.ok === false && r.reason === 'resting');

/** The resting note that stands where a start button would be (tap: the sheet). */
export function restingNote(ctx, gameId, state) {
  injectCss();
  const s = restStatus(ctx, gameId, state);
  const at = s ? clockTime(s.readyAt) : '';
  return h`<button type="button" class="rest-note" data-rest="${gameId}" data-tap>${iconSvg('leaf', { size: 20 })}<span>Rests until ${at || 'a little later'}</span></button>`;
}

/**
 * restBits(ctx, state, gameId) -> {resting, inProgress, block, line}.
 *  - block: the resting note (replaces the start button) when resting with nothing to continue;
 *  - line: the quiet "2 plays left this hour", or, mid-play while resting,
 *    "Yours to finish. Then it rests until 3:42 PM."
 */
export function restBits(ctx, state, gameId) {
  const s = restStatus(ctx, gameId, state);
  if (!s || !s.on) return { resting: false, inProgress: !!(s && s.inProgress), block: '', line: '' };
  injectCss();
  if (s.resting) {
    if (!s.inProgress) return { resting: true, inProgress: false, block: restingNote(ctx, gameId, state), line: '' };
    return { resting: true, inProgress: true, block: '', line: h`<div class="rest-left" data-rest-line="${gameId}">This one is yours to finish. Then it rests until ${clockTime(s.readyAt)}.</div>` };
  }
  if (s.left <= 2) {
    const w = windowWords(s.windowMin);
    return { resting: false, inProgress: s.inProgress, block: '', line: h`<div class="rest-left" data-rest-line="${gameId}">${s.left} ${s.left === 1 ? 'play' : 'plays'} left ${w.left}</div>` };
  }
  return { resting: false, inProgress: s.inProgress, block: '', line: '' };
}

/** What restBits depends on (screens that skip identical redraws add this to their signature). */
export function restSig(ctx, state, gameId) {
  const s = restStatus(ctx, gameId, state);
  return s ? [s.on, s.left, s.resting, s.readyAt, s.inProgress] : 0;
}
