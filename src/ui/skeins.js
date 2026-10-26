/**
 * skeins.js: the Winding Room (Skein Stacks; overlay `skeins`, fullscreen,
 * home tab Puzzles). A port of proto/skeins/app.js (playtested): the same
 * board, tray, drag, merge animation, hank twist, goal shelf, nudges, level
 * list and "level finished" shelf, with every fix the prototype already had
 * (busy always resets in try/finally, time-bounded animations, the dragged
 * slot kept alive, pills kept inside the board, a reload mid-flight keeps the
 * move).
 *
 * Owns: her six yarns (her own discovered colors, one per hue family, chosen
 * by the sim), the honeycomb of pegs, the tray of three stacks, the dock with
 * the one next step (Undo / Clear a peg / Swap the tray / See your shelf), the
 * coins chip, the level list (112 levels in chapter sections: Continue, done
 * ticks, basket ribbons, the next level highlighted; each finished level opens
 * the next), the newer mechanics on the board (snarls, felted stacks, spindle
 * pegs, the next-tray peek, the order slip, the basket and untangle chips) and
 * their intro cards (shown once each, `skeins.seen`), and the finished-level
 * shelf. Also exports the Puzzle table's card (skeinsCardHtml / skeinsCardSig).
 *
 * Rules: src/puzzles/skeins.js (pure). Every move is a sim action in
 * src/sim/skeins.js run through ctx.game.act, so it is saved at once and a
 * reload resumes exactly. Coins land on the chip as each hank is tied.
 * Wrong drops are never red: a stack let go away from an empty peg glides
 * back to the tray.
 */

import { h, raw, backButton, escapeHtml, button } from './kit.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import { restBits, restingResult, openRestSheet, isResting, restingNote } from './rest.js';

const HOP_MS = 70;   // one tile hop
const LIFT = 58;     // the stack rides above her finger so she can see the peg

const GLYPH_SVG = {
  dot: '<circle cx="12" cy="12" r="5.5"/>',
  diamond: '<path d="M12 4 20 12 12 20 4 12z"/>',
  ring: '<circle class="st" cx="12" cy="12" r="6"/>',
  wave: '<path class="st" d="M3.5 13c2.4-4.4 4.3-4.4 6.5 0s4.1 4.4 6.5 0c1-1.8 2-2.6 3.3-3"/>',
  heart: '<path d="M12 20 4.6 12.8A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.4 5.6z"/>',
  leaf: '<path d="M5.5 18.5C5 10 10 5 19 5.2 19.3 13.5 14 18.8 5.5 18.5z"/>',
};

// The newer mechanics' icons (intro cards, level list), drawn in ink and walnut.
const MECH_ICON = {
  snarl: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 10c-9 0-14 6-12 12s12 6 14 0-6-10-10-6 2 12 10 12 14-6 12-13-10-9-15-5" fill="none" stroke="#7B5236" stroke-width="3" stroke-linecap="round"/><path d="M30 34c4 2 8 1 9-2M14 33c-2 3-1 6 2 7" fill="none" stroke="#B89A6E" stroke-width="2.5" stroke-linecap="round"/></svg>',
  order: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h20l6 6v30H12z" fill="#FBF8F1" stroke="#7B5236" stroke-width="2.5" stroke-linejoin="round"/><path d="M17 17h14M17 23h14M17 29h9" stroke="#B89A6E" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="34" r="5" fill="#C0573B"/></svg>',
  basket: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 20c0-8 20-8 20 0" fill="none" stroke="#7B5236" stroke-width="3"/><path d="M7 20h34l-4 20H11z" fill="#D8C29C" stroke="#7B5236" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 27h24M13 33h22M18 20l2 20M30 20l-2 20" stroke="#9C7F55" stroke-width="1.8"/></svg>',
  felt: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8 38 16v16L24 40 10 32V16z" fill="#C7B9A6" stroke="#7B5236" stroke-width="2.5" stroke-linejoin="round"/><g fill="#FBF8F1"><circle cx="18" cy="20" r="1.6"/><circle cx="26" cy="17" r="1.6"/><circle cx="31" cy="24" r="1.6"/><circle cx="22" cy="27" r="1.6"/><circle cx="17" cy="31" r="1.6"/><circle cx="28" cy="32" r="1.6"/></g></svg>',
  spindle: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4v40" stroke="#7B5236" stroke-width="3" stroke-linecap="round"/><ellipse cx="24" cy="34" rx="12" ry="4.5" fill="#C9A55E" stroke="#7B5236" stroke-width="2.5"/><path d="M18 12c4 2 8 2 12 0M17 18c5 2.5 9 2.5 14 0M17 24c5 2.5 9 2.5 14 0" stroke="#4C76A6" stroke-width="3" stroke-linecap="round" fill="none"/></svg>',
  preview: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="22" width="32" height="18" rx="5" fill="#EFE6D2" stroke="#B89A6E" stroke-width="2.5"/><rect x="5" y="8" width="38" height="18" rx="5" fill="#FBF8F1" stroke="#7B5236" stroke-width="2.5"/><circle cx="15" cy="17" r="4" fill="#C0573B"/><circle cx="24" cy="17" r="4" fill="#D5AE3C"/><circle cx="33" cy="17" r="4" fill="#4C76A6"/></svg>',
  untie: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 18c6-8 14-8 16 6s10 14 16 6" fill="none" stroke="#7B5236" stroke-width="3" stroke-linecap="round"/><path d="M10 34c5 4 10 4 13-2" fill="none" stroke="#B89A6E" stroke-width="2.5" stroke-linecap="round"/><circle cx="40" cy="30" r="3" fill="#E2B04A"/></svg>',
};
const TICK_SVG = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#E2B04A"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#3A2A10" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RIBBON_SVG = '<svg class="ribbon" viewBox="0 0 16 22" aria-hidden="true"><path d="M3 10 1 21l4-2 3 3 1-12M13 10l2 11-4-2-3 3-1-12" fill="#B04F7A"/><circle cx="8" cy="7" r="6" fill="#C0573B" stroke="#8E3A2A" stroke-width="1"/></svg>';
// A snarl on a peg: a little tangle of undyed yarn.
const SNARL_MARK = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 9c-8 0-12 5-10 10s10 5 12 0-5-8-8-5 2 10 8 10 12-5 10-11-8-8-13-4" fill="none" stroke="#7B5236" stroke-width="2.6" stroke-linecap="round"/><path d="M25 30c3 2 7 1 8-2M10 29c-2 3-1 5 2 6" fill="none" stroke="#EFE6D2" stroke-width="2" stroke-linecap="round"/></svg>';
const SPINDLE_MARK = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6v28" stroke="#7B5236" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="20" cy="27" rx="8" ry="3" fill="#C9A55E" stroke="#7B5236" stroke-width="1.8"/></svg>';
const CHEV_SVG = '<svg class="chev" viewBox="0 0 14 14" aria-hidden="true"><path d="m5 3 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const CSS = `
#screen-skeins { --sk-card: #FBF8F1; --sk-line: rgba(42,38,34,.14); --sk-gold: #E2B04A; --sk-gold-soft: #F3E3B8; --sk-wood-dark: #B89A6E; --sk-shadow: 0 3px 0 rgba(42,38,34,.18); }
#screen-skeins .sk-head .titles { min-width: 0; }
#screen-skeins .how-link { flex: 0 0 auto; min-width: 44px; max-width: 72px; min-height: 44px; padding: 0 2px; white-space: normal; text-align: center; line-height: 1.15; font-size: 12px; font-weight: 600; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
#screen-skeins .sk-body { gap: 4px; padding-bottom: 16px; }
#screen-skeins [hidden] { display: none !important; }

/* goal */
#screen-skeins .sk-goal { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 2px 0 6px; }
#screen-skeins .sk-goalrow { flex: 1 1 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#screen-skeins .sk-lvl { min-width: 0; font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-soft); }
#screen-skeins .sk-big { font: 400 26px/1 var(--font-display); font-variant-numeric: tabular-nums; }
#screen-skeins .sk-big small { font: 500 14px var(--font-ui); color: var(--ink-soft); margin-left: 4px; }
#screen-skeins .sk-slots { display: flex; flex-wrap: wrap; gap: 3px; flex: 1; min-width: 0; }
#screen-skeins .sk-slot { width: 12px; height: 16px; border-radius: 5px; background: rgba(42,38,34,.08); box-shadow: inset 0 0 0 1px rgba(42,38,34,.1); }
#screen-skeins .sk-slot.on { background: var(--c); box-shadow: inset 0 -2px 0 rgba(0,0,0,.2), inset 0 0 0 1px rgba(0,0,0,.12); }
#screen-skeins .sk-slot.pop { animation: sk-slotpop .5s ease-out; }
@keyframes sk-slotpop { 0% { transform: scale(1.8); } 100% { transform: scale(1); } }
#screen-skeins .sk-coins { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; background: var(--paper); box-shadow: var(--cut-sm); font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
#screen-skeins .sk-coins i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
#screen-skeins .sk-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 100%; }
#screen-skeins .sk-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 3px 9px 3px 4px; border-radius: 999px; background: var(--sk-card); box-shadow: 0 1px 0 var(--sk-line); }
#screen-skeins .sk-chip.met { background: var(--sk-gold-soft); }
#screen-skeins .sk-dot { width: 18px; height: 18px; border-radius: 50%; background: var(--c); display: inline-grid; place-items: center; flex: none; }
#screen-skeins .sk-dot svg { width: 12px; height: 12px; fill: rgba(255,250,235,.95); }

/* board */
#screen-skeins .sk-boardwrap { display: flex; justify-content: center; margin: 4px 0 8px; }
#screen-skeins .sk-board { position: relative; touch-action: manipulation; }
#screen-skeins .sk-table { position: absolute; inset: -8px -10px; border-radius: 22px; background: linear-gradient(170deg, #EADBBE, #DCC7A0); box-shadow: inset 0 0 0 2px rgba(107,74,50,.18), var(--sk-shadow); }
#screen-skeins .sk-peg { position: absolute; display: block; padding: 0; border: 0; background: none; cursor: pointer; }
#screen-skeins .sk-peg .sk-hole { position: absolute; inset: 0; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); background: radial-gradient(circle at 50% 42%, #C9AE84, #B79A6C 70%); }
#screen-skeins .sk-peg .sk-hole::after { content: ''; position: absolute; left: 50%; top: 50%; width: 16%; height: 16%; transform: translate(-50%, -50%); border-radius: 50%; background: #9C7F55; box-shadow: 0 1px 0 rgba(255,255,255,.35); }
#screen-skeins .sk-peg.knot .sk-hole { background: radial-gradient(circle at 50% 40%, #A98B5F, #8E7048 70%); opacity: .55; }
#screen-skeins .sk-peg.knot { cursor: default; }
#screen-skeins .sk-peg.open .sk-hole { box-shadow: none; background: radial-gradient(circle at 50% 42%, #E8D6B0, #CDB284 70%); }
#screen-skeins .sk-peg.target .sk-hole { background: radial-gradient(circle at 50% 42%, #F9E8B8, #E2B04A 80%); }
#screen-skeins .sk-peg:focus-visible { outline: 3px solid var(--sk-gold); outline-offset: 2px; }

.sk-stack { position: absolute; left: 0; top: 0; pointer-events: none; }
.sk-ly { position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background:
    repeating-linear-gradient(118deg, rgba(255,250,235,.16) 0 2px, rgba(255,250,235,0) 2px 4.5px, rgba(0,0,0,.1) 4.5px 5.5px, rgba(0,0,0,0) 5.5px 7px),
    linear-gradient(180deg, var(--c) 0 72%, color-mix(in srgb, var(--c) 70%, #000) 100%); }
.sk-ly.top { background:
    radial-gradient(70% 55% at 35% 25%, rgba(255,255,255,.28), rgba(255,255,255,0) 60%),
    repeating-linear-gradient(118deg, rgba(255,250,235,.2) 0 2px, rgba(255,250,235,0) 2px 4.5px, rgba(0,0,0,.12) 4.5px 5.5px, rgba(0,0,0,0) 5.5px 7px),
    linear-gradient(180deg, color-mix(in srgb, var(--c) 92%, #fff) 0 60%, var(--c) 72%, color-mix(in srgb, var(--c) 65%, #000) 100%); }
.sk-ly.lit { filter: brightness(1.18) saturate(1.1); }
.sk-badge { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 2px; min-width: 22px; height: 20px; padding: 0 5px; border-radius: 10px;
  background: rgba(251,248,241,.94); color: var(--ink); font: 700 12px/20px var(--font-ui); font-variant-numeric: tabular-nums; box-shadow: 0 1px 2px rgba(42,38,34,.3); justify-content: center; }
.sk-badge.near { background: #F3E3B8; box-shadow: 0 0 0 1.5px #E2B04A, 0 1px 2px rgba(42,38,34,.3); }
.sk-badge svg { width: 11px; height: 11px; fill: var(--c); }
.sk-badge svg .st { fill: none; stroke: var(--c); stroke-width: 3; }

/* fx inside the board */
#screen-skeins .sk-hop { position: absolute; pointer-events: none; z-index: 900; }
#screen-skeins .sk-hank { position: absolute; z-index: 950; pointer-events: none; width: 66px; height: 40px; }
#screen-skeins .sk-hank svg { width: 100%; height: 100%; overflow: visible; }
#screen-skeins .sk-label { position: absolute; z-index: 960; pointer-events: none; white-space: nowrap; transform: translate(-50%, 0); padding: 5px 11px; border-radius: 999px;
  background: var(--sk-card); box-shadow: 0 0 0 1.5px var(--sk-gold), 0 4px 12px rgba(42,38,34,.18); font: 400 15px var(--font-display); color: var(--ink); }
#screen-skeins .sk-chain { position: absolute; z-index: 960; pointer-events: none; transform: translate(-50%, 0); padding: 3px 10px; border-radius: 999px; background: rgba(251,248,241,.95); box-shadow: 0 2px 8px rgba(42,38,34,.18); font: 400 16px var(--font-display); color: #6A5A1E; white-space: nowrap; }

/* dock: tray + actions, in thumb reach */
#screen-skeins .sk-dock { flex: 0 0 auto; position: relative; z-index: 6; padding: 8px max(10px, calc((100% - 460px) / 2 + 10px)) calc(8px + var(--safe-bottom));
  background: rgba(251,248,241,.97); box-shadow: 0 -3px 0 rgba(42,38,34,.08), 0 -8px 24px rgba(42,38,34,.08); }
#screen-skeins .sk-tray { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
#screen-skeins .sk-tslot { position: relative; height: 104px; border-radius: 16px; background: rgba(42,38,34,.045); box-shadow: inset 0 0 0 1px var(--sk-line); touch-action: none; cursor: grab; padding: 0; border: 0; display: block; width: 100%; }
#screen-skeins .sk-tslot.sel { background: var(--sk-gold-soft); box-shadow: 0 0 0 2.5px var(--sk-gold); }
#screen-skeins .sk-tslot.empty { cursor: default; background: rgba(42,38,34,.025); }
#screen-skeins .sk-tslot.lifted .sk-stack { opacity: .25; }
#screen-skeins .sk-bandlist { position: absolute; left: 4px; right: 4px; bottom: 3px; display: flex; justify-content: center; gap: 4px; font-size: 11px; color: var(--ink-soft); }
#screen-skeins .sk-bandlist span { display: inline-flex; align-items: center; gap: 1px; }
#screen-skeins .sk-bandlist svg { width: 11px; height: 11px; fill: var(--c); }
#screen-skeins .sk-bandlist svg .st { fill: none; stroke: var(--c); stroke-width: 3; }
#screen-skeins .sk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 8px; min-height: 44px; }
#screen-skeins .sk-actions .msg { flex: 1 1 140px; font-size: 14px; line-height: 1.3; font-weight: 500; }
#screen-skeins .sk-actions .btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
#screen-skeins .sk-actions.wide .msg { flex-basis: 100%; }
#screen-skeins .sk-actions .btn { min-height: 44px; }

/* below the board */
#screen-skeins .sk-foot { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
#screen-skeins .sk-foot .btn[aria-pressed="true"] { background: var(--sk-gold-soft); box-shadow: 0 0 0 2px var(--sk-gold), var(--cut-sm); }
#screen-skeins .sk-rules { margin-top: 10px; font-size: 14px; color: var(--ink-soft); }
#screen-skeins .sk-rules summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 600; color: var(--ink); }
#screen-skeins .sk-rules ol { margin: 0; padding-left: 20px; line-height: 1.5; list-style: decimal; display: flex; flex-direction: column; gap: 4px; }

/* panels: levels and level finished */
#screen-skeins .sk-sheet { position: fixed; inset: 0; z-index: 80; background: rgba(42,38,34,.35); display: flex; align-items: flex-end; justify-content: center; padding: 12px 12px calc(12px + var(--safe-bottom)); }
#screen-skeins .sk-sheet .sk-card { width: 100%; max-width: 440px; max-height: calc(100% - 24px); overflow: auto; padding: 16px; background: var(--sk-card); border-radius: 14px; box-shadow: var(--sk-shadow); }
#screen-skeins .sk-sheet h2 { font: 400 24px var(--font-display); margin: 0 0 4px; text-align: center; }
#screen-skeins .sk-sheet .hint { text-align: center; margin: 0; }
#screen-skeins .sk-levellist { list-style: none; margin: 10px 0; padding: 0; display: grid; gap: 6px; }
#screen-skeins .sk-levellist button { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; text-align: left; border: 0; border-radius: 12px; background: var(--paper); padding: 6px 10px; cursor: pointer; color: var(--ink); font: inherit; }
#screen-skeins .sk-levellist button.cur { box-shadow: 0 0 0 2px var(--sk-gold); }
#screen-skeins .sk-levellist button:disabled { cursor: default; opacity: .62; }
#screen-skeins .sk-levellist .n { font: 400 18px var(--font-display); width: 26px; text-align: center; }
#screen-skeins .sk-levellist .t { flex: 1; min-width: 0; }
#screen-skeins .sk-levellist .t small { display: block; color: var(--ink-soft); font-size: 12px; }
#screen-skeins .sk-levellist .mark svg { width: 30px; height: 18px; }
#screen-skeins .sk-shelf { margin: 14px 0 10px; padding: 10px 8px 0; border-radius: 12px; background: linear-gradient(180deg, #F3EAD8, #EADBBE); }
#screen-skeins .sk-shelf .row { display: flex; justify-content: center; align-items: flex-end; gap: 6px 8px; padding-bottom: 6px; border-bottom: 9px solid var(--sk-wood-dark); box-shadow: 0 2px 0 rgba(42,38,34,.15); margin-bottom: 12px; }
#screen-skeins .sk-pile { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 0 1 31%; min-width: 0; }
#screen-skeins .sk-pile .sk { display: flex; flex-direction: column-reverse; align-items: center; }
#screen-skeins .sk-pile .sk svg { width: 52px; height: 30px; margin-top: -10px; }
#screen-skeins .sk-pile .sk svg:last-child { margin-top: 0; }
#screen-skeins .sk-pile .tag2 { font-size: 12px; line-height: 1.25; text-align: center; color: var(--ink); background: var(--sk-card); padding: 3px 7px; border-radius: 6px; box-shadow: 0 1px 0 var(--sk-line); overflow-wrap: anywhere; }
#screen-skeins .sk-pile .tag2 small { display: block; color: var(--ink-soft); font-size: 11px; }
#screen-skeins .sk-earned { text-align: center; font: 400 16px var(--font-display); margin: 0 0 10px; }
#screen-skeins .sk-btnrow { display: grid; gap: 8px; }
#screen-skeins .sk-btnrow .btn { width: 100%; min-height: 52px; font-size: 17px; }
#screen-skeins .sk-locked { padding: 16px; gap: 10px; }

/* the newer mechanics on the board */
#screen-skeins .sk-peg.snarl { cursor: default; }
#screen-skeins .sk-peg.snarl .sk-hole { background: radial-gradient(circle at 50% 42%, #BDA27A, #A68A60 70%); }
#screen-skeins .sk-peg.snarl .sk-hole::after { display: none; }
#screen-skeins .sk-mark { position: absolute; inset: 8%; pointer-events: none; }
#screen-skeins .sk-mark svg { width: 100%; height: 100%; overflow: visible; }
#screen-skeins .sk-peg.spindle .sk-hole { background: radial-gradient(circle at 50% 42%, #E9D3A2, #C9A55E 72%); box-shadow: inset 0 0 0 2px rgba(140,101,18,.35); }
#screen-skeins .sk-peg.spindle .sk-hole::after { display: none; }
#screen-skeins .sk-peg .sk-eight { position: absolute; right: 4%; bottom: 2%; min-width: 15px; height: 15px; border-radius: 8px; padding: 0 3px; background: #8C6512; color: #FBF3DE; font: 700 10px/15px var(--font-ui); text-align: center; pointer-events: none; z-index: 2; }
.sk-stack.felt .sk-ly { filter: saturate(.55) brightness(1.04); }
.sk-stack.felt .sk-ly.top::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle, rgba(255,250,235,.55) 0 1px, transparent 1.6px) 0 0 / 5px 5px, radial-gradient(circle, rgba(42,38,34,.18) 0 1px, transparent 1.6px) 2.5px 2.5px / 5px 5px; }
.sk-badge.felt { background: #EFE6D2; color: var(--ink-soft); font-weight: 600; }
#screen-skeins .sk-peg.pulse .sk-hole, #screen-skeins .sk-peg.pulse .sk-stack { animation: sk-pulse .6s ease-out; }
@keyframes sk-pulse { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }

/* the next tray, peeking out under this one */
#screen-skeins .sk-next { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
#screen-skeins .sk-next .mini { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; flex: 1; }
#screen-skeins .sk-next .mini span { position: relative; height: 34px; border-radius: 10px; background: rgba(42,38,34,.035); box-shadow: inset 0 0 0 1px rgba(42,38,34,.08); }
#screen-skeins .sk-next .mini .sk-stack { left: 50%; top: auto; bottom: 3px; transform: translateX(-50%); }

/* order slip, untangle and basket chips */
#screen-skeins .sk-slot.want { background: transparent; box-shadow: inset 0 0 0 2px var(--c); opacity: .55; }
#screen-skeins .sk-chip .ic { width: 18px; height: 18px; flex: none; }
#screen-skeins .sk-chip.order { font-weight: 600; background: #F1E9D6; }

/* level list: Continue, chapters */
#screen-skeins .sk-continue { width: 100%; min-height: 52px; margin: 10px 0 4px; font-size: 16px; }
#screen-skeins .sk-chapters { list-style: none; margin: 8px 0 10px; padding: 0; display: grid; gap: 8px; }
#screen-skeins .sk-chhead { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 10px; text-align: left; border: 0; border-radius: 12px; padding: 8px 12px; background: #F1E9D6; color: var(--ink); font: inherit; cursor: pointer; }
#screen-skeins .sk-chhead[aria-expanded="true"] { background: #EADBBE; }
#screen-skeins .sk-chhead:disabled { cursor: default; opacity: .62; }
#screen-skeins .sk-chhead .cn { font: 400 18px var(--font-display); width: 26px; text-align: center; flex: none; }
#screen-skeins .sk-chhead .ct { flex: 1; min-width: 0; }
#screen-skeins .sk-chhead .ct b { display: block; font: 400 17px var(--font-display); }
#screen-skeins .sk-chhead .ct small { display: block; color: var(--ink-soft); font-size: 12px; line-height: 1.3; }
#screen-skeins .sk-chhead .cp { flex: none; font-size: 12px; font-weight: 700; color: var(--ink-soft); text-align: right; }
#screen-skeins .sk-chhead .chev { flex: none; width: 14px; height: 14px; transition: transform .15s; }
#screen-skeins .sk-chhead[aria-expanded="true"] .chev { transform: rotate(90deg); }
#screen-skeins .sk-chapters .sk-levellist { margin: 6px 0 2px; }
#screen-skeins .sk-levellist button.next { box-shadow: 0 0 0 2.5px var(--sk-gold); background: var(--sk-gold-soft); }
#screen-skeins .sk-levellist .tagnext { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px; background: var(--sk-gold); color: #3A2A10; font-size: 11px; font-weight: 700; vertical-align: 1px; }
#screen-skeins .sk-levellist .mark { display: inline-flex; align-items: center; gap: 2px; flex: none; }
#screen-skeins .sk-levellist .tick { width: 22px; height: 22px; }
#screen-skeins .sk-levellist .ribbon { width: 16px; height: 22px; }
#screen-skeins .sk-levellist .mech { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: -3px; }
#screen-skeins .sk-levellist .mech svg { width: 15px; height: 15px; }

/* intro cards */
#screen-skeins .sk-intro .sk-item { display: flex; gap: 12px; align-items: center; margin: 12px 0; }
#screen-skeins .sk-intro .sk-item svg { flex: none; width: 52px; height: 52px; }
#screen-skeins .sk-intro .sk-item p { margin: 0; font-size: 15px; line-height: 1.4; }
#screen-skeins .sk-intro .sk-item strong { display: block; font: 400 17px var(--font-display); }
#screen-skeins .sk-ribbonline { text-align: center; margin: -4px 0 10px; font-size: 14px; color: var(--ink-soft); }

#sk-fx { position: fixed; inset: 0; pointer-events: none; z-index: 1000; }
#sk-fx .sk-ghost { position: fixed; z-index: 1000; pointer-events: none; left: 0; top: 0; filter: drop-shadow(0 10px 10px rgba(42,38,34,.3)); }

@media (prefers-reduced-motion: reduce) { #screen-skeins .sk-slot.pop { animation: none; } }
html[data-motion="reduced"] #screen-skeins .sk-slot.pop { animation: none; }
`;

const CARD_CSS = `
.sk-cardrow { display: flex; align-items: center; gap: 12px; }
.sk-mini { display: flex; flex-direction: column; gap: 0; flex: none; }
.sk-mini svg { width: 40px; height: 24px; margin-top: -6px; }
.sk-mini svg:first-child { margin-top: 0; }
`;

let C = null;
let ROOT = null;
const U = {
  visible: false, busy: false, sel: -1, clearMode: false, drag: null,
  view: null, trayView: null, hanksView: null, note: '', busyMsg: '', doneShown: false,
  L: null, sig: null, gen: 0, guide: null, confirmRestart: 0, coinsShown: null, resizeT: 0,
  marks: null, nextView: null, introOpen: false, introFresh: [], openCh: -1,
};

const K = () => C.sim.skeins;
const R = () => C.puzzles.skeins;
const S = () => C.game.state;
const sess = () => (S().skeins && S().skeins.sess) || null;
const st = () => sess().state;
const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 1);
const reduced = () => !!(C && C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const $ = (sel, r = ROOT) => (r ? r.querySelector(sel) : null);
const $$ = (sel, r = ROOT) => (r ? [...r.querySelectorAll(sel)] : []);
const esc = (s) => escapeHtml(String(s ?? ''));

const styled = new Set();
function injectStyle(id, css) {
  if (typeof document === 'undefined' || styled.has(id)) return;
  styled.add(id);
  const el = document.createElement('style');
  el.id = `sk-style-${id}`;
  el.textContent = css;
  document.head.appendChild(el);
}

function coinsText(ctx, n) {
  const v = Number.isFinite(n) ? n : 0;
  const x = v < 100 ? Math.max(v > 0 ? 1 : 0, Math.round(v)) : v;
  return ctx.format && ctx.format.num ? ctx.format.num(x) : Math.round(x).toLocaleString();
}

// ---------------------------------------------------------------------------
// Her yarns: color index -> her color id, hex and name
// ---------------------------------------------------------------------------

function colorsNow() {
  const s = sess() && sess().state;
  return s && Array.isArray(s.colors) ? s.colors : safe(() => K().yarns(S())) || [];
}
const idOf = (c) => colorsNow()[c];
const hexOfId = (ctx, id) => safe(() => ctx.sim.economy.colorHex(id)) || '#B7BDB3';
const nameOfId = (ctx, id) => safe(() => ctx.sim.displayName(ctx.game.state, id)) || String(id || '');
const hex = (c) => hexOfId(C, idOf(c));
const cname = (c) => nameOfId(C, idOf(c));
const hankName = (c) => `${cname(c)} hank`;
const glyphsOn = () => !!safe(() => K().glyphsOn(S()));
const glyph = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH_SVG[R().COLORS[c].glyph]}</svg>`;
const levelTitleOf = (li) => R().levelTitle(li, (k) => cname(k));

// A twisted hank: a figure-eight of yarn, tied in the middle.
function skeinSvgHex(col) {
  return `<svg viewBox="0 0 66 40" aria-hidden="true">
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="${col}"/>
    <path d="M10 20C10 11 24 9 31 17M10 21C11 29 24 31 31 23M56 20C56 11 42 9 35 17M56 21C55 29 42 31 35 23" fill="none" stroke="rgba(255,250,235,.38)" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M14 20C15 14 23 13 29 18M14 21C15 26 23 27 29 22M52 20C51 14 43 13 37 18M52 21C51 26 43 27 37 22" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6 20C6 7 25 5 33 15 41 5 60 7 60 20S41 35 33 25C25 35 6 33 6 20Z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
    <rect x="29.5" y="11" width="7" height="18" rx="2.5" fill="#EFE6D2" stroke="rgba(42,38,34,.35)" stroke-width="1"/>
    <path d="M30 16h6M30 20h6M30 24h6" stroke="rgba(42,38,34,.3)" stroke-width="1"/>
  </svg>`;
}
const skeinSVG = (c) => skeinSvgHex(hex(c));

// ---------------------------------------------------------------------------
// Layout (the board fits the space between the goal and the dock)
// ---------------------------------------------------------------------------

function layout() {
  const b = R().board(st().level);
  const x0 = b.minX || 0; // a silhouette whose left edge sits half a peg in
  const units = Math.max(...b.cells.map((c) => c.col + (c.row & 1) * 0.5)) - x0 + 1;
  const KH = 0.98; // a slightly tilted table: hexes a touch shorter than true
  const body = $('[data-body]');
  const wrap = $('[data-boardwrap]');
  const bodyW = body ? body.clientWidth : 360;
  const availW = Math.min(bodyW - 32, 436) - 20;
  let availH = 400;
  if (body && wrap) {
    const top = wrap.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    availH = Math.max(220, body.clientHeight - top - 22);
  }
  const rise = 0.62; // room above the top row for tall piles
  let w = Math.min(64, availW / units, availH / (rise + (b.rows - 1) * 0.75 * KH + KH));
  w = Math.max(34, Math.floor(w));
  const hs = w * KH;
  const step = hs * 0.75;
  const pad = w * rise;
  const pos = b.cells.map((c) => ({ x: (c.col + (c.row & 1) * 0.5 - x0) * w + w / 2, y: pad + c.row * step + hs / 2 }));
  return { b, w, hs, pw: w * 0.93, ph: hs * 0.93, W: units * w, H: pad + (b.rows - 1) * step + hs, pos };
}
const dl = (len, w = U.L.w) => Math.min(w * 0.08, (w * 0.6) / Math.max(1, len));

function stackHTML(stack, { pw, ph, w, badge = true, lit = 0, d, felt = false, need = 10 } = {}) {
  if (!stack || !stack.length) return '';
  const n = stack.length;
  const step = d ?? dl(n, w);
  let out = `<div class="sk-stack${felt ? ' felt' : ''}" style="width:${pw}px;height:${ph}px">`;
  stack.forEach((c, i) => {
    const isTop = i === n - 1;
    out += `<div class="sk-ly${isTop ? ' top' : ''}${i >= n - lit ? ' lit' : ''}" style="--c:${hex(c)};transform:translateY(${(-i * step).toFixed(1)}px)"></div>`;
  });
  if (badge && felt) {
    out += `<span class="sk-badge felt" style="margin-top:${(-(n - 1) * step).toFixed(1)}px">felted</span>`;
  } else if (badge) {
    const run = R().topRun(stack);
    const c = stack[n - 1];
    out += `<span class="sk-badge${run >= need - 3 ? ' near' : ''}" style="--c:${hex(c)};margin-top:${(-(n - 1) * step).toFixed(1)}px">${glyphsOn() ? glyph(c) : ''}${run}</span>`;
  }
  return `${out}</div>`;
}

// Snarls and felted stacks as they read right now (a step behind while a move animates).
const marksNow = () => U.marks || { felt: st().felt || [], snarl: st().snarl || [] };
const isSnarl = (i) => marksNow().snarl.includes(i);
const isFelt = (i) => marksNow().felt.includes(i);
const isSpindle = (i) => { const b = R().board(st().level); return !!(b.spin && b.spin.has(i)); };
const needAt = (i) => R().hankAt(st().level, i);
const cellStack = (i, lit = 0) => stackHTML(stacksNow()[i], { ...U.L, lit, felt: isFelt(i), need: needAt(i) });

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const stacksNow = () => U.view || st().stacks;
function pegLabel(i) {
  const s = stacksNow()[i];
  if (s === null) return `Knot ${i + 1}`;
  if (isSnarl(i)) return `Peg ${i + 1}, snarled. A hank tied beside it loosens it.`;
  const sp = isSpindle(i) ? `Spindle peg ${i + 1}, twists ${needAt(i)} into a hank` : `Peg ${i + 1}`;
  if (!s.length) return `${sp}, empty`;
  if (isFelt(i)) return `${sp}: a felted stack of ${s.length}, resting until a hank is tied beside it`;
  return `${sp}: ${R().topRun(s)} ${cname(s[s.length - 1])} on top, ${s.length} in all`;
}
function pegClass(i) {
  const s = stacksNow()[i];
  let c = 'sk-peg';
  if (s === null) c += ' knot';
  else if (isSnarl(i)) c += ' snarl';
  else if (!s.length && (U.sel >= 0 || U.drag) && !U.busy) c += ' open';
  if (s && isSpindle(i)) c += ' spindle';
  if (U.drag && U.drag.target === i) c += ' target';
  return c;
}
const pegMark = (i) => (isSnarl(i) ? `<span class="sk-mark">${SNARL_MARK}</span>` : isSpindle(i) ? `<span class="sk-mark">${SPINDLE_MARK}</span><span class="sk-eight" aria-hidden="true">${needAt(i)}</span>` : '');

function renderBoard() {
  const boardEl = $('[data-board]');
  if (!boardEl) return;
  U.L = layout();
  const L = U.L;
  boardEl.style.width = `${L.W}px`;
  boardEl.style.height = `${L.H}px`;
  const stacks = stacksNow();
  let out = '<div class="sk-table"></div>';
  L.b.cells.forEach((cell, i) => {
    const p = L.pos[i];
    out += `<button type="button" class="${pegClass(i)}" data-cell="${i}" ${cell.knot ? 'disabled' : ''} aria-label="${esc(pegLabel(i))}"
      style="left:${(p.x - L.pw / 2).toFixed(1)}px;top:${(p.y - L.ph / 2).toFixed(1)}px;width:${L.pw.toFixed(1)}px;height:${L.ph.toFixed(1)}px;z-index:${cell.row * 2 + 1}">
      <span class="sk-hole"></span>${pegMark(i)}${cellStack(i)}</button>`;
  });
  boardEl.innerHTML = out;
}
function renderCell(i, lit = 0) {
  const el = $(`.sk-peg[data-cell="${i}"]`);
  if (!el) return;
  const old = $('.sk-stack', el);
  if (old) old.remove();
  $$('.sk-mark, .sk-eight', el).forEach((m) => m.remove());
  el.insertAdjacentHTML('beforeend', pegMark(i) + cellStack(i, lit));
  el.setAttribute('aria-label', pegLabel(i));
  el.className = pegClass(i);
}
function refreshPegClasses() {
  $$('.sk-peg').forEach((el) => { el.className = pegClass(+el.dataset.cell); });
}

function renderTray() {
  const trayEl = $('[data-tray]');
  if (!trayEl) return;
  const tray = U.trayView || st().tray;
  const slotW = (trayEl.clientWidth - 16) / 3 || 100;
  const w = Math.min(56, Math.max(40, slotW * 0.52));
  const opts = { pw: w * 0.93, ph: w * 0.98 * 0.93, w, d: 6.5, badge: false };
  const g = glyphsOn();
  trayEl.innerHTML = tray.map((s, t) => {
    if (!s) return `<button type="button" class="sk-tslot empty" data-t="${t}" aria-label="Tray spot ${t + 1}, used" disabled></button>`;
    const bands = R().bands(s);
    const bl = g ? `<span class="sk-bandlist" style="flex-direction:row-reverse">${bands.map((b) => `<span style="--c:${hex(b.c)}">${glyph(b.c)}${b.n}</span>`).join('')}</span>` : '';
    const desc = bands.slice().reverse().map((b) => `${b.n} ${cname(b.c)}`).join(' over ');
    const lift = g ? 16 : 6;
    return `<button type="button" class="sk-tslot${U.sel === t ? ' sel' : ''}${U.drag && U.drag.t === t && U.drag.moved ? ' lifted' : ''}" data-t="${t}" data-tap aria-pressed="${U.sel === t}" aria-label="Tray stack: ${esc(desc)}">
      <span style="position:absolute;left:50%;bottom:${lift}px;transform:translateX(-50%);width:${opts.pw}px;height:${opts.ph}px;display:block">${stackHTML(s, opts)}</span>${bl}</button>`;
  }).join('');
  renderNext();
}

/** The next tray, peeking out under this one (levels with a preview). */
function renderNext() {
  const el = $('[data-next]');
  if (!el) return;
  const next = U.nextView || st().next;
  if (!next) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const w = 26;
  const opts = { pw: w * 0.93, ph: w * 0.98 * 0.93, w, d: 3.2, badge: false };
  const desc = next.map((x) => R().bands(x).slice().reverse().map((b) => `${b.n} ${cname(b.c)}`).join(' over ')).join('; ');
  el.innerHTML = `<span>Next</span><span class="mini" role="img" aria-label="${esc(`The next tray: ${desc}`)}">${next.map((x) => `<span>${stackHTML(x, opts)}</span>`).join('')}</span>`;
}

function renderCoins() {
  const el = $('[data-coins]');
  if (!el) return;
  const v = U.busy && U.coinsShown !== null ? U.coinsShown : S().coins;
  const t = coinsText(C, v);
  if (el.textContent !== t) el.textContent = t;
}

function renderGoal() {
  const s = st();
  const g = R().goalOf(s.level);
  const hanks = U.hanksView || s.hanks;
  const ch = R().chapterOf(s.level);
  const lb = $('[data-levelbtn]');
  if (lb) lb.textContent = `Level ${s.level + 1}`;
  const nm = $('[data-lvlname]');
  if (nm) nm.textContent = `Level ${s.level + 1} · ${levelTitleOf(s.level)}`;
  const sub = $('[data-subtitle]');
  if (sub) sub.textContent = `${R().CHAPTERS[ch].name} · Level ${s.level + 1}`;
  const want = g.colors;
  const haveOf = (c) => hanks.filter((x) => x === +c).length;
  const cnt = $('[data-count]');
  let sl = '';
  if (g.order) {
    // the order slip: one slot per hank asked for, in its color, filled as she ties them
    const got = Object.keys(want).reduce((a, c) => a + Math.min(haveOf(c), want[c]), 0);
    if (cnt) cnt.innerHTML = `${got}<small>of ${g.hanks} for ${esc(g.who || 'the order')}</small>`;
    for (const c of Object.keys(want)) {
      const have = haveOf(c);
      for (let i = 0; i < want[c]; i++) sl += `<span class="sk-slot ${i < have ? 'on' : 'want'}" style="--c:${hex(+c)}"></span>`;
    }
  } else {
    if (cnt) cnt.innerHTML = `${Math.min(hanks.length, g.hanks)}<small>of ${g.hanks} hanks</small>`;
    for (let i = 0; i < g.hanks; i++) sl += i < hanks.length ? `<span class="sk-slot on" style="--c:${hex(hanks[i])}"></span>` : '<span class="sk-slot"></span>';
  }
  const slots = $('[data-slots]');
  if (slots) slots.innerHTML = sl;
  const chips = $('[data-chips]');
  if (chips) {
    let out = Object.keys(want).map((c) => {
      const have = haveOf(c);
      return `<span class="sk-chip${have >= want[c] ? ' met' : ''}"><span class="sk-dot" style="--c:${hex(+c)}">${glyphsOn() ? glyph(+c) : ''}</span>${esc(cname(+c))}: ${Math.min(have, want[c])} of ${want[c]}</span>`;
    }).join('');
    const m = marksNow();
    if (g.untie) {
      const n = m.snarl.length + m.felt.length;
      const what = [m.snarl.length ? `${m.snarl.length} ${m.snarl.length === 1 ? 'snarl' : 'snarls'} to loosen` : '', m.felt.length ? `${m.felt.length} felted to wake` : ''].filter(Boolean).join(', ');
      out += `<span class="sk-chip${n ? '' : ' met'}"><span class="ic">${MECH_ICON.untie}</span>${n ? esc(what) : 'All untangled'}</span>`;
    }
    if (g.trays) {
      const left = R().traysLeft(s);
      const words = !R().withinBasket(s) ? 'Spare trays from here on' : left ? `${left} more ${left === 1 ? 'tray' : 'trays'} in the basket` : 'The last tray from the basket';
      out += `<span class="sk-chip"><span class="ic">${MECH_ICON.basket}</span>${words}</span>`;
    }
    chips.innerHTML = out;
  }
  renderCoins();
}

function renderActions() {
  const msgEl = $('[data-msg]');
  const btnsEl = $('[data-btns]');
  if (!msgEl || !btnsEl) return;
  const s = st();
  const sit = R().situation(s);
  const canUndo = sess().past.length > 0;
  let msg = U.note || 'Drag a stack from the tray onto an empty peg.';
  const btns = [];
  if (U.busy) { msg = U.busyMsg || 'Sliding together.'; } else if (s.done) {
    msg = 'Level finished. Lovely work.';
    btns.push('<button type="button" class="btn btn-primary small" data-act="shelf" data-tap>See your shelf</button>');
  } else if (U.clearMode) {
    msg = 'Tap a stack to set it aside. It just leaves the board.';
    btns.push('<button type="button" class="btn btn-paper small" data-act="cancel" data-tap>Keep them all</button>');
  } else {
    const g = R().goalOf(s.level);
    const locks = (s.snarl ? s.snarl.length : 0) + (s.felt ? s.felt.length : 0);
    if (sit === 'stuck') msg = 'The board is full. Undo, or take a free nudge.';
    else if (sit === 'tight') msg = 'Getting snug. A free nudge is here if you like.';
    else if (U.sel >= 0) msg = 'Now tap an empty peg for that stack.';
    else if (!U.note && g.untie && locks && s.hanks.length >= g.hanks) msg = 'The hanks are done. Tie one beside each snarl or felted stack to finish.';
    if (canUndo) btns.push('<button type="button" class="btn btn-paper small" data-act="undo" data-tap>Undo</button>');
    if (sit === 'stuck' || sit === 'tight') {
      btns.push('<button type="button" class="btn btn-primary small" data-act="clear" data-tap>Clear a peg</button>');
      if (s.tray.some(Boolean)) btns.push('<button type="button" class="btn btn-paper small" data-act="swap" data-tap>Swap the tray</button>');
    }
  }
  msgEl.textContent = msg;
  btnsEl.innerHTML = btns.join('');
  const act = $('[data-actions]');
  if (act) act.classList.toggle('wide', btns.length > 1);
}

function renderFoot() {
  const gb = $('[data-glyphbtn]');
  if (gb) {
    const on = glyphsOn();
    gb.setAttribute('aria-pressed', String(on));
    gb.textContent = `Color symbols: ${on ? 'on' : 'off'}`;
  }
  const rb = $('[data-restart]');
  if (rb && !U.confirmRestart) rb.textContent = 'Start this level over';
}

function unlocked() {
  return !!safe(() => K().unlocked(S()));
}

function skeleton() {
  const how = C.guide && C.guide.howThisWorksHtml ? C.guide.howThisWorksHtml('skeins') : '';
  if (!unlocked()) {
    ROOT.innerHTML = String(h`<div class="screen-head sk-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">The Winding Room</div><div class="subtitle">Skein Stacks</div></div><div class="spacer"></div></div>
<div class="screen-body sk-body"><div class="card sk-locked">
<div class="h3">The swift is waiting</div>
<p class="hint">Stack yarn in your own colors on a table of pegs. Neighbors with the same top color slide together, and ten of one color on top twist into a hank.</p>
<div data-lock>${unlockTag(C, 'skeins', { cls: 'pz-tag' })}</div></div></div>`);
    return;
  }
  ROOT.innerHTML = `<div class="screen-head sk-head">${backButton('Back to the puzzle table')}
<div class="titles"><div class="title">The Winding Room</div><div class="subtitle" data-subtitle>Skein Stacks</div></div>${how}</div>
<div class="screen-body sk-body" data-body>
<div class="sk-goal" aria-live="polite" data-coach="skeins-goal">
<div class="sk-goalrow"><span class="sk-lvl" data-lvlname></span><button type="button" class="btn btn-paper small" data-act="levels" data-levelbtn data-tap aria-haspopup="dialog">Level 1</button></div>
<span class="sk-big" data-count></span><div class="sk-slots" data-slots aria-hidden="true"></div><span class="sk-coins" data-coins-chip aria-label="Coins"><i></i><span data-coins>0</span></span>
<div class="sk-chips" data-chips></div>
</div>
<div class="sk-boardwrap" data-boardwrap><div class="sk-board" data-board role="group" aria-label="Pegs"></div></div>
<div class="sk-foot">
<button type="button" class="btn btn-paper small" data-act="glyphs" data-glyphbtn data-tap aria-pressed="false">Color symbols: off</button>
<button type="button" class="btn btn-paper small" data-act="restart" data-restart data-tap>Start this level over</button>
</div>
<details class="sk-rules"><summary>How the Winding Room works</summary><ol>
<li><b>Drag</b> a stack from the tray onto any empty peg, or tap a stack and then a peg.</li>
<li>Neighbors with the <b>same top color</b> slide together. What is underneath can slide on, so chains happen.</li>
<li>When <b>10 or more</b> of one color sit on top, they twist into a hank. Bundle enough hanks to finish the level. Board full? Undo as much as you like, or take a free nudge.</li>
<li>Each hank pays a few coins, and a finished level pays a little extra. Each level you finish opens the next.</li>
<li>Later chapters bring snarls, orders, a basket of trays, felted stacks, spindle pegs and a peek at the next tray. Each one has a card the first time it shows up.</li>
</ol></details>
</div>
<div class="sk-dock" data-dock>
<div class="sk-tray" data-tray role="group" aria-label="Tray" data-coach="skeins-tray"></div>
<div class="sk-next" data-next hidden></div>
<div class="sk-actions" data-actions><span class="msg" role="status" data-msg></span><span class="btns" data-btns></span></div>
</div>
<div class="sk-sheet" data-levels hidden role="dialog" aria-modal="true" aria-labelledby="sk-levels-title"><div class="sk-card">
<h2 id="sk-levels-title">Levels</h2>
<p class="hint" data-levelshint>Each level you finish opens the next.</p>
<div data-continuewrap></div>
<ul class="sk-chapters" data-chapters></ul>
<button type="button" class="btn btn-paper block tall" data-act="levels-close" data-tap>Back to the board</button>
</div></div>
<div class="sk-sheet" data-intro hidden role="dialog" aria-modal="true" aria-labelledby="sk-intro-title"><div class="sk-card sk-intro">
<h2 id="sk-intro-title" data-introtitle>Something new on the table</h2>
<div data-introbody></div>
<button type="button" class="btn btn-primary block tall" data-act="intro-ok" data-tap>Lovely, let's wind</button>
</div></div>
<div class="sk-sheet" data-done hidden role="dialog" aria-modal="true" aria-labelledby="sk-done-title"><div class="sk-card">
<h2 id="sk-done-title" data-donetitle>Level finished</h2>
<p class="hint" data-donesub></p>
<div class="sk-shelf" data-shelf></div>
<p class="sk-earned" data-earned></p>
<p class="sk-ribbonline" data-ribbonline hidden></p>
<div data-donerest></div>
<div class="sk-btnrow" data-donebtns>
<button type="button" class="btn btn-primary" data-act="next" data-nextbtn data-tap>Next level</button>
<button type="button" class="btn btn-paper" data-act="again" data-tap>Play this level again</button>
</div>
</div></div>`;
}

function renderAll() {
  if (!ROOT) return;
  if (!unlocked()) {
    if (!$('[data-lock]')) skeleton();
    U.sig = sigOf(S());
    return;
  }
  if (!$('[data-board]')) skeleton();
  if (!sess()) { U.sig = sigOf(S()); return; }
  renderGoal();
  renderTray();
  renderActions();
  renderFoot();
  renderBoard();
  U.sig = sigOf(S());
}

function sigOf(state) {
  const k = state.skeins || {};
  const s = k.sess;
  return [unlocked(), s && s.state, s && s.past && s.past.length, k.li, safe(() => K().glyphsOn(state)), Object.keys(k.finished || {}).length];
}
const sameSig = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// Animation helpers (always time-bounded; t is clamped)
// ---------------------------------------------------------------------------

function tween(ms, stepFn) {
  return new Promise((resolve) => {
    let finished = false;
    const fin = () => { if (!finished) { finished = true; resolve(); } };
    const t0 = performance.now();
    const frame = (now) => {
      if (finished) return;
      const t = clamp01((now - t0) / ms);
      try { stepFn(t); } catch (err) { console.error(err); fin(); return; }
      if (t < 1) requestAnimationFrame(frame); else fin();
    };
    requestAnimationFrame(frame);
    setTimeout(fin, ms + 300); // a hidden tab never leaves us waiting
  });
}
function waapi(el, frames, opts) {
  if (!el || !el.animate) return Promise.resolve();
  const a = el.animate(frames, opts);
  return Promise.race([a.finished.catch(() => {}), sleep((opts.duration || 0) + (opts.delay || 0) + 200)]);
}
function fxBoard(html, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  $('[data-board]').append(el);
  return el;
}
// keep a centered pill inside the board's width
function placePill(el, x, y) {
  const half = el.offsetWidth / 2;
  const lo = half - 8;
  const hi = U.L.W - half + 8;
  el.style.left = `${lo > hi ? U.L.W / 2 : Math.min(hi, Math.max(lo, x))}px`;
  el.style.top = `${y}px`;
}
// top-of-pile center for peg i with `len` tiles, layer index k
const layerY = (i, k, len) => U.L.pos[i].y - k * dl(len);

async function hop(from, to, c) {
  const L = U.L;
  const nFrom = U.view[from].length;
  const nTo = U.view[to].length; // view[from] already lost the tile
  const x0 = L.pos[from].x;
  const y0 = layerY(from, nFrom, nFrom + 1);
  const x1 = L.pos[to].x;
  const y1 = layerY(to, nTo, nTo + 1);
  const el = fxBoard(`<div class="sk-ly top" style="--c:${hex(c)};position:absolute;inset:0"></div>`, 'sk-hop');
  Object.assign(el.style, { left: `${x0 - L.pw / 2}px`, top: `${y0 - L.ph / 2}px`, width: `${L.pw}px`, height: `${L.ph}px`, zIndex: 900 });
  const arc = L.w * 0.32;
  await tween(HOP_MS, (t) => {
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    el.style.transform = `translate(${((x1 - x0) * e).toFixed(1)}px, ${((y1 - y0) * e - arc * Math.sin(Math.PI * t)).toFixed(1)}px)`;
  });
  el.remove();
}

function chainPop(i, text) {
  if (reduced()) return;
  const p = U.L.pos[i];
  const el = fxBoard(text, 'sk-chain');
  placePill(el, p.x, Math.max(-6, p.y - U.L.w * 1.15));
  waapi(el, [{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'translate(-50%, -18px)' }], { duration: 900, easing: 'ease-out' }).then(() => el.remove());
}

/** Coins for one hank fly from its slot to the chip, and the chip rolls up. */
function landCoins(fromEl, coins) {
  const chip = $('[data-coins-chip]');
  const el = $('[data-coins]');
  if (!(coins > 0) || !chip || !el) return;
  const from = num(U.coinsShown, num(S().coins));
  U.coinsShown = from + coins;
  safe(() => C.fx.coinArc(fromEl || chip, chip, 8));
  safe(() => C.fx.rollNumber(el, from, from + coins, { ms: 450, format: (v) => coinsText(C, v) }));
}

async function bundleFx({ cell, color, n }, coins) {
  renderCell(cell, n); // the run glows
  await sleep(reduced() ? 120 : 200);
  U.view[cell].length -= n;
  renderCell(cell);
  const p = U.L.pos[cell];
  const y = layerY(cell, U.view[cell].length, U.view[cell].length + 1);
  const label = fxBoard(esc(hankName(color)), 'sk-label');
  placePill(label, p.x, Math.max(-6, y - U.L.w * 1.05 - 10));
  const msg = $('[data-msg]');
  if (msg) msg.textContent = `${hankName(color)}, bundled.`;
  safe(() => C.audio.chord([0.5, 0.65, 0.8], 0.6));
  safe(() => C.haptics.medium());
  const sk = fxBoard(skeinSVG(color), 'sk-hank');
  Object.assign(sk.style, { left: `${p.x - 33}px`, top: `${y - 20}px` });
  const labelOut = () => waapi(label, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -8px)' }], { duration: 260, fill: 'forwards' }).then(() => label.remove());
  if (reduced()) {
    await sleep(650);
  } else {
    waapi(label, [{ opacity: 0, transform: 'translate(-50%, 8px) scale(.8)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1.06)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 320, easing: 'ease-out' });
    // twist and tie
    await waapi(sk, [
      { transform: 'scale(.35, .9) rotate(-160deg)', opacity: 0 },
      { transform: 'scale(1.2, .7) rotate(-20deg)', opacity: 1, offset: 0.55 },
      { transform: 'scale(.92, 1.1) rotate(8deg)', offset: 0.8 },
      { transform: 'scale(1) rotate(0)' },
    ], { duration: 520, easing: 'ease-out' });
    await sleep(260);
    // off to the goal shelf
    const slot = $$('[data-slots] .sk-slot')[U.hanksView.length] || $('[data-count]');
    const boardEl = $('[data-board]');
    if (slot && boardEl) {
      const sr = slot.getBoundingClientRect();
      const br = boardEl.getBoundingClientRect();
      const dx = sr.left + sr.width / 2 - (br.left + p.x);
      const dy = sr.top + sr.height / 2 - (br.top + y);
      await waapi(sk, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0.6 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    }
  }
  sk.remove();
  labelOut();
  U.hanksView.push(color);
  renderGoal();
  const slot = $$('[data-slots] .sk-slot.on').at(-1);
  if (slot && !reduced()) slot.classList.add('pop');
  landCoins(slot, coins);
}

async function playSteps(steps, coinsFor) {
  let moves = 0;
  for (const step of steps) {
    if (step.type === 'move') {
      moves++;
      if (moves === 2) chainPop(step.to, 'A chain!');
      else if (moves > 2) chainPop(step.to, `Chain of ${moves}`);
      if (moves > 1) safe(() => C.audio.chain(moves - 2));
      U.busyMsg = moves > 1 ? `Chain of ${moves}.` : 'Sliding together.';
      const msg = $('[data-msg]');
      if (msg) msg.textContent = U.busyMsg;
      if (reduced()) {
        for (let k = 0; k < step.n; k++) U.view[step.to].push(U.view[step.from].pop());
        renderCell(step.from);
        renderCell(step.to);
        await sleep(160);
        continue;
      }
      for (let k = 0; k < step.n; k++) {
        const c = U.view[step.from].pop();
        renderCell(step.from);
        await hop(step.from, step.to, c);
        U.view[step.to].push(c);
        renderCell(step.to);
      }
      await sleep(110);
    } else if (step.type === 'bundle') {
      await bundleFx(step, coinsFor(U.hanksView.length));
    } else if (step.type === 'wake' || step.type === 'loosen') {
      // a hank tied beside it: the felted stack wakes, the snarl comes loose
      const key = step.type === 'wake' ? 'felt' : 'snarl';
      if (U.marks) U.marks = { ...U.marks, [key]: U.marks[key].filter((i) => i !== step.cell) };
      renderCell(step.cell);
      const el = $(`.sk-peg[data-cell="${step.cell}"]`);
      if (el && !reduced()) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 650); }
      chainPop(step.cell, step.type === 'wake' ? 'Awake!' : 'Loose!');
      U.busyMsg = step.type === 'wake' ? 'A felted stack wakes up.' : 'A snarl comes loose.';
      const msg = $('[data-msg]');
      if (msg) msg.textContent = U.busyMsg;
      safe(() => C.audio.tink(0.7));
      await sleep(reduced() ? 160 : 420);
    }
  }
  return moves;
}

// Every animated action goes through here: busy is always reset.
async function run(fn) {
  if (U.busy) return;
  U.busy = true;
  U.coinsShown = num(S().coins);
  const gen = U.gen;
  renderActions();
  try {
    await fn();
  } catch (err) {
    console.error('[skeins]', err);
  } finally {
    $$('.sk-hop, .sk-hank, .sk-label, .sk-chain').forEach((el) => el.remove());
    U.busy = false;
    U.busyMsg = '';
    U.view = null;
    U.trayView = null;
    U.hanksView = null;
    U.marks = null;
    U.nextView = null;
    U.coinsShown = null;
    if (gen === U.gen && U.visible) renderAll();
  }
  if (gen === U.gen && U.visible && sess() && st().done && !U.doneShown) showDone();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function doPlace(t, cell) {
  return run(async () => {
    const before = st();
    const r = C.game.act(K().place, { t, cell });
    if (!r || !r.ok) return;
    safe(() => C.game.save()); // a reload mid-flight keeps the move
    U.sel = -1;
    U.clearMode = false;
    U.note = '';
    U.view = before.stacks.map((s) => (s ? s.slice() : s));
    U.view[cell] = before.tray[t].slice();
    U.trayView = before.tray.map((s, i) => (i === t ? null : s));
    U.hanksView = before.hanks.slice();
    U.marks = { felt: (before.felt || []).slice(), snarl: (before.snarl || []).slice() };
    U.nextView = before.next || null;
    renderBoard();
    renderTray();
    renderActions();
    safe(() => C.audio.tink(0.55));
    safe(() => C.haptics.light());
    const pegStack = $(`.sk-peg[data-cell="${cell}"] .sk-stack`);
    if (!reduced()) await waapi(pegStack, [{ transform: 'translateY(-14px) scale(1.06)' }, { transform: 'translateY(2px) scale(.98)', offset: 0.7 }, { transform: 'none' }], { duration: 170, easing: 'ease-out' });
    // Hank i (index in the level's list) pays when it is one the sim just paid for.
    const total = before.hanks.length + r.hanks.length;
    const firstPaid = total - r.paid.length;
    const coinsFor = (i) => (i >= firstPaid && r.paid[i - firstPaid] ? r.paid[i - firstPaid].coins : 0);
    const moves = await playSteps(r.steps, coinsFor);
    const g = R().goalOf(before.level);
    const now = st();
    const owed = R().goalOwed(now);
    const still = Object.keys(owed).filter((c) => owed[c] > 0);
    const owedLeft = g.order ? still.reduce((a, c) => a + owed[c], 0) : g.hanks - (before.hanks.length + r.hanks.length);
    const locks = (now.snarl ? now.snarl.length : 0) + (now.felt ? now.felt.length : 0);
    if (r.hanks.length) U.note = owedLeft > 0 ? `${r.hanks.map(hankName).join(', ')}! ${owedLeft} more to go.` : `${hankName(r.hanks.at(-1))}! That is the goal.`;
    else if (moves > 1) U.note = `A chain of ${moves} slides.`;
    else U.note = '';
    if (r.hanks.length && owedLeft <= 0 && still.length) U.note = `Lovely. Still to bundle: ${still.map((c) => `${owed[c]} ${cname(+c)}`).join(', ')}.`;
    else if (r.hanks.length && g.order && owedLeft > 0) U.note = `${r.hanks.map(hankName).join(', ')}! The order still wants ${still.map((c) => `${owed[c]} ${cname(+c)}`).join(', ')}.`;
    if (!now.done && g.untie && locks && r.hanks.length && owedLeft <= 0) U.note = `Lovely. Now tie a hank beside ${locks === 1 ? 'the last snarl or felted stack' : `the ${locks} snarls and felted stacks left`}.`;
    if (r.bonus > 0) {
      const chip = $('[data-coins-chip]');
      const from = $('[data-count]');
      const el = $('[data-coins]');
      const c0 = num(U.coinsShown, num(S().coins));
      U.coinsShown = c0 + r.bonus;
      await Promise.race([safe(() => C.fx.coinArc(from || chip, chip, 12)) || Promise.resolve(), sleep(900)]);
      safe(() => C.fx.rollNumber(el, c0, c0 + r.bonus, { ms: 450, format: (v) => coinsText(C, v) }));
    }
    if (r.refilled) {
      U.trayView = null;
      U.nextView = null;
      renderTray();
      if (!reduced()) await Promise.all($$('[data-tray] .sk-tslot .sk-stack').map((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 60, fill: 'backwards' })));
    }
  });
}

function doClear(cell) {
  return run(async () => {
    const el = $(`.sk-peg[data-cell="${cell}"] .sk-stack`);
    U.clearMode = false;
    if (el && !reduced()) await waapi(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-24px) scale(.9)' }], { duration: 260, fill: 'forwards' });
    const r = C.game.act(K().clearPeg, { cell });
    if (!r || !r.ok) return;
    U.note = 'Set aside. There is room again.';
  });
}

function doSwap() {
  return run(async () => {
    const r = C.game.act(K().swapTray);
    if (!r || !r.ok) return;
    U.sel = -1;
    U.note = 'A fresh tray.';
    renderTray();
    if (!reduced()) await Promise.all($$('[data-tray] .sk-tslot .sk-stack').map((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 60, fill: 'backwards' })));
  });
}

function doUndo() {
  if (U.busy) return;
  const r = C.game.act(K().undo);
  if (!r || !r.ok) return;
  U.sel = -1;
  U.clearMode = false;
  U.note = 'Undone.';
  safe(() => C.audio.tick('deselect'));
  renderAll();
}

// ---------------------------------------------------------------------------
// Levels and the shelf
// ---------------------------------------------------------------------------

function startLevel(li, { fresh = false } = {}) {
  const r = C.game.act(K().startLevel, { level: li, fresh });
  if (restingResult(r)) { openRestSheet(C, 'skeins'); renderAll(); return; } // Responsibility mode
  if (!r || !r.ok) { C.toast('That level opens after the one before it.'); return; }
  U.sel = -1;
  U.clearMode = false;
  U.note = '';
  U.doneShown = false;
  renderAll();
  const body = $('[data-body]');
  if (body) body.scrollTop = 0;
  maybeIntro();
}

/** The intro card(s) for what this level brings that she has not met yet. */
function maybeIntro() {
  const box = $('[data-intro]');
  if (!box || !sess() || st().done) return false;
  const fresh = safe(() => K().introsFor(S(), st().level)) || [];
  if (!fresh.length) return false;
  const M = R().MECHANICS;
  U.introFresh = fresh;
  U.introOpen = true;
  $('[data-introtitle]').textContent = fresh.length > 1 ? 'Some new things on the table' : 'Something new on the table';
  $('[data-introbody]').innerHTML = fresh.map((m) => `<div class="sk-item">${MECH_ICON[m] || ''}<p><strong>${esc(M[m].name)}</strong>${esc(M[m].line)}</p></div>`).join('');
  box.hidden = false;
  safe(() => $('[data-act="intro-ok"]').focus());
  return true;
}
function closeIntro() {
  const box = $('[data-intro]');
  if (box) box.hidden = true;
  if (U.introFresh.length) C.game.act(K().seeIntro, { mechanics: U.introFresh });
  U.introFresh = [];
  U.introOpen = false;
}

function showDone() {
  U.doneShown = true;
  const s = st();
  const box = $('[data-done]');
  if (!box) return;
  const counts = R().COLORS.map((_, k) => s.hanks.filter((x) => x === k).length);
  const piles = counts.map((cnt, k) => (cnt ? `<div class="sk-pile"><div class="sk">${skeinSVG(k).repeat(Math.min(cnt, 4))}</div><span class="tag2">${esc(cname(k))}<small>${cnt} ${cnt > 1 ? 'hanks' : 'hank'}</small></span></div>` : '')).filter(Boolean);
  // three piles to a shelf board
  let rows = '';
  for (let i = 0; i < piles.length; i += 3) rows += `<div class="row">${piles.slice(i, i + 3).join('')}</div>`;
  $('[data-shelf]').innerHTML = rows;
  const ch = R().chapterOf(s.level);
  const chEnd = s.level === R().chapterStart(ch) + R().CHAPTERS[ch].levels - 1;
  $('[data-donetitle]').textContent = chEnd ? `${R().CHAPTERS[ch].name}: chapter finished` : `${levelTitleOf(s.level)}: finished`;
  $('[data-donesub]').textContent = `You bundled ${s.hanks.length} hanks${chEnd ? ` and finished the chapter with ${levelTitleOf(s.level)}` : ''}. Here they are on the shelf.`;
  const paid = num(sess().paid);
  $('[data-earned]').textContent = paid > 0 ? `This level earned ${coinsText(C, paid)} coins.` : '';
  const rib = $('[data-ribbonline]');
  if (rib) {
    const g = R().goalOf(s.level);
    rib.hidden = !(g.trays && R().withinBasket(s));
    rib.innerHTML = rib.hidden ? '' : `${RIBBON_SVG} Finished within the basket: a ribbon for this level.`;
  }
  const last = s.level === R().LEVELS.length - 1;
  const nextCh = !last && chEnd ? R().CHAPTERS[ch + 1].name : '';
  $('[data-nextbtn]').textContent = last ? 'Back to level 1' : nextCh ? `Next: ${nextCh}, level ${s.level + 2}` : `Next: level ${s.level + 2}`;
  // Responsibility mode: resting, the next level waits; the note says until when.
  const resting = isResting(C, 'skeins');
  const restBox = $('[data-donerest]');
  if (restBox) restBox.innerHTML = resting ? String(restingNote(C, 'skeins')) : String(restBits(C, S(), 'skeins').line);
  const btns = $('[data-donebtns]');
  if (btns) btns.hidden = resting;
  box.hidden = false;
  safe(() => C.audio.chord([0.45, 0.6, 0.75, 0.9], 0.8));
  safe(() => C.haptics.success());
  if (!reduced()) $$('[data-shelf] .sk svg').forEach((el, i) => waapi(el, [{ opacity: 0, transform: 'translateY(-14px) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 70, fill: 'backwards', easing: 'ease-out' }));
  if (!resting) safe(() => $('[data-nextbtn]').focus());
}

/** The goal of level li in a few words, for the level list. */
function goalWords(li) {
  const g = R().goalOf(li);
  const L = R().LEVELS[li];
  if (g.order) return `An order for ${g.who || 'a customer'}: ${g.hanks} hanks, ${L.colors} colors`;
  let w = `${g.hanks} hanks, ${L.colors} colors`;
  if (Object.keys(g.colors).length) w += ', some in set colors';
  if (g.untie) w += ', untangle it all';
  return w;
}

function levelRow(i, k, nextLi) {
  const fin = k.finished || {};
  const notes = k.notes || {};
  const open = K().isOpen(S(), i);
  const mech = R().levelMechanics(i).filter((m) => MECH_ICON[m]);
  const marks = `${fin[i] ? TICK_SVG : ''}${notes[i] && notes[i].neat ? RIBBON_SVG : ''}`;
  const cls = [i === k.li ? 'cur' : '', i === nextLi ? 'next' : ''].filter(Boolean).join(' ');
  const sub = open ? goalWords(i) : `Opens after level ${i}`;
  const label = `Level ${i + 1}, ${levelTitleOf(i)}${fin[i] ? ', finished' : ''}${notes[i] && notes[i].neat ? ', with a ribbon' : ''}${i === nextLi ? ', next up' : ''}. ${sub}`;
  return `<li><button type="button" data-level="${i}" class="${cls}" ${open ? 'data-tap' : 'disabled'} aria-label="${esc(label)}"><span class="n">${i + 1}</span><span class="t">${esc(levelTitleOf(i))}${i === nextLi ? '<span class="tagnext">Next</span>' : ''}<small>${esc(sub)}${mech.length ? `<span class="mech">${mech.map((m) => MECH_ICON[m]).join('')}</span>` : ''}</small></span><span class="mark">${marks}</span></button></li>`;
}

function renderLevels() {
  const k = S().skeins || {};
  const nextLi = safe(() => K().nextLevel(S()));
  const chs = K().chapters(S());
  if (U.openCh < 0) U.openCh = R().chapterOf(nextLi >= 0 ? nextLi : k.li || 0);
  const cw = $('[data-continuewrap]');
  if (cw) {
    if (nextLi >= 0) {
      const resume = k.sess && !k.sess.state.done && k.li === nextLi && k.sess.state.moves > 0;
      cw.innerHTML = `<button type="button" class="btn btn-primary sk-continue" data-act="continue" data-level-go="${nextLi}" data-tap>${resume ? 'Continue' : 'Play'} level ${nextLi + 1}: ${esc(levelTitleOf(nextLi))}</button>`;
    } else cw.innerHTML = '';
  }
  const hint = $('[data-levelshint]');
  const done = Object.keys(k.finished || {}).length;
  if (hint) hint.textContent = done >= R().LEVELS.length ? `All ${R().LEVELS.length} levels are wound. Play any of them again.` : done ? `${done} ${done === 1 ? 'level' : 'levels'} wound so far. Each one you finish opens the next.` : 'Each level you finish opens the next.';
  $('[data-chapters]').innerHTML = chs.map((c) => {
    const expanded = c.index === U.openCh;
    const prog = !c.open ? `Opens after level ${c.first}` : c.finished >= c.count ? 'All finished' : c.finished ? `${c.finished} finished` : 'Ready';
    let rows = '';
    if (expanded) {
      rows = `<ul class="sk-levellist" id="sk-ch-${c.index}">`;
      for (let i = c.first; i < c.first + c.count; i++) rows += levelRow(i, k, nextLi);
      rows += '</ul>';
    }
    const label = `Chapter ${c.index + 1}, ${c.name}. ${prog}`;
    return `<li><button type="button" class="sk-chhead" data-chapter="${c.index}" aria-expanded="${expanded}" aria-controls="sk-ch-${c.index}" ${c.open ? 'data-tap' : 'disabled'} aria-label="${esc(label)}"><span class="cn">${c.index + 1}</span><span class="ct"><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></span><span class="cp">${esc(prog)}</span>${c.open ? CHEV_SVG : ''}</button>${rows}</li>`;
  }).join('');
}

function openLevels() {
  U.openCh = -1;
  renderLevels();
  $('[data-levels]').hidden = false;
  const cur = $('[data-chapters] .next') || $('[data-chapters] .cur') || $('[data-act="continue"]');
  if (cur) { cur.focus(); if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); }
}

// ---------------------------------------------------------------------------
// Input: tray drag and tap, pegs, the dock's buttons
// ---------------------------------------------------------------------------

function fxLayer() {
  let l = document.getElementById('sk-fx');
  if (!l) {
    l = document.createElement('div');
    l.id = 'sk-fx';
    l.setAttribute('aria-hidden', 'true');
    document.body.appendChild(l);
  }
  return l;
}

function pegAtPoint(x, y) {
  const boardEl = $('[data-board]');
  if (!boardEl || !U.L) return -1;
  const br = boardEl.getBoundingClientRect();
  let best = -1;
  let bd = Infinity;
  const stacks = st().stacks;
  U.L.pos.forEach((p, i) => {
    if (!stacks[i] || stacks[i].length) return;
    const d = Math.hypot(br.left + p.x - x, br.top + p.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  return bd <= U.L.w * 0.85 ? best : -1;
}
const ghostPos = (e) => ({ x: e.clientX, y: e.clientY - LIFT });

function onPointerDown(e) {
  const el = e.target.closest && e.target.closest('.sk-tslot');
  if (!el || !ROOT.contains(el) || U.busy || !sess() || st().done || U.drag) return;
  const t = +el.dataset.t;
  if (!st().tray[t]) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* not all pointers capture */ }
  U.drag = { t, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, target: -1, ghost: null };
}

function onPointerMove(e) {
  const d = U.drag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
    d.moved = true;
    U.clearMode = false;
    U.sel = -1;
    const g = document.createElement('div');
    g.className = 'sk-ghost';
    g.style.width = `${U.L.pw}px`;
    g.style.height = `${U.L.ph}px`;
    g.innerHTML = stackHTML(st().tray[d.t], { ...U.L, badge: false });
    fxLayer().append(g);
    d.ghost = g;
    // keep the captured slot element alive: toggle classes, do not re-render the tray
    $$('.sk-tslot').forEach((x) => x.classList.remove('sel'));
    const slotEl = $(`.sk-tslot[data-t="${d.t}"]`);
    if (slotEl) slotEl.classList.add('lifted');
    refreshPegClasses();
    renderActions();
    safe(() => C.haptics.light());
  }
  const p = ghostPos(e);
  d.ghost.style.transform = `translate(${(p.x - U.L.pw / 2).toFixed(1)}px, ${(p.y - U.L.ph / 2).toFixed(1)}px)`;
  const tg = pegAtPoint(p.x, p.y);
  if (tg !== d.target) { d.target = tg; refreshPegClasses(); }
}

async function endDrag(e, cancelled) {
  const d = U.drag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.moved) {
    U.drag = null;
    if (!cancelled) {
      U.sel = U.sel === d.t ? -1 : d.t;
      U.clearMode = false;
      if (U.sel >= 0) safe(() => C.audio.tink(0.6));
      renderTray();
      refreshPegClasses();
      renderActions();
    }
    return;
  }
  const target = cancelled ? -1 : d.target;
  if (target >= 0) {
    d.ghost.remove();
    U.drag = null;
    await doPlace(d.t, target);
    return;
  }
  // back to the tray
  const slotEl = $(`.sk-tslot[data-t="${d.t}"]`);
  if (slotEl && !reduced()) {
    const slot = slotEl.getBoundingClientRect();
    await waapi(d.ghost, [{ transform: d.ghost.style.transform }, { transform: `translate(${slot.left + slot.width / 2 - U.L.pw / 2}px, ${slot.top + slot.height / 2 - U.L.ph / 2}px) scale(.9)`, opacity: 0.4 }], { duration: 180, easing: 'ease-in' });
  }
  d.ghost.remove();
  U.drag = null;
  if (!U.visible) return;
  renderTray();
  refreshPegClasses();
  renderActions();
}
const onPointerUp = (e) => { endDrag(e, false); };
const onPointerCancel = (e) => { endDrag(e, true); };

function onClick(e) {
  if (!ROOT || !e.target.closest) return;
  const unlockBtn = e.target.closest('[data-action="unlock-open"]');
  if (unlockBtn && ROOT.contains(unlockBtn)) {
    ensureWorkshopStyles();
    openUnlockSheet(C, 'skeins', { host: ROOT });
    return;
  }
  if (!sess()) return;
  // keyboard: Enter/Space on a tray stack selects it
  const slot = e.target.closest('.sk-tslot');
  if (slot && ROOT.contains(slot)) {
    if (e.detail !== 0 || U.busy) return;
    const t = +slot.dataset.t;
    if (!st().tray[t]) return;
    U.sel = U.sel === t ? -1 : t;
    U.clearMode = false;
    renderTray();
    refreshPegClasses();
    renderActions();
    return;
  }
  const peg = e.target.closest('.sk-peg');
  if (peg && ROOT.contains(peg)) {
    if (U.busy || st().done) return;
    const i = +peg.dataset.cell;
    const s = st().stacks[i];
    if (R().isSnarled(st(), i)) { U.note = 'A snarl. Tie a hank on a peg beside it and it comes loose.'; renderActions(); return; }
    if (U.clearMode) { if (s && s.length) doClear(i); return; }
    if (U.sel >= 0 && s && !s.length) doPlace(U.sel, i);
    else if (U.sel < 0 && R().isFelted(st(), i)) { U.note = 'A felted stack. It wakes when a hank is tied beside it.'; renderActions(); }
    return;
  }
  const chh = e.target.closest('[data-chapter]');
  if (chh && ROOT.contains(chh)) {
    const c = +chh.dataset.chapter;
    U.openCh = U.openCh === c ? -2 : c;
    renderLevels();
    const head = $(`[data-chapter="${c}"]`);
    if (head) { head.focus(); if (head.scrollIntoView) head.scrollIntoView({ block: 'nearest' }); }
    return;
  }
  const lv = e.target.closest('[data-level]');
  if (lv && ROOT.contains(lv)) {
    $('[data-levels]').hidden = true;
    const li = +lv.dataset.level;
    if (li !== S().skeins.li) startLevel(li);
    else maybeIntro();
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b || !ROOT.contains(b)) return;
  const a = b.dataset.act;
  if (a === 'levels-close') { $('[data-levels]').hidden = true; return; }
  if (a === 'intro-ok') { closeIntro(); return; }
  if (a === 'continue') {
    $('[data-levels]').hidden = true;
    const li = +b.dataset.levelGo;
    if (li !== S().skeins.li || !sess() || st().done) startLevel(li);
    return;
  }
  if (a === 'next') { $('[data-done]').hidden = true; startLevel((st().level + 1) % R().LEVELS.length, { fresh: true }); return; }
  if (a === 'again') { $('[data-done]').hidden = true; startLevel(st().level, { fresh: true }); return; }
  if (U.busy) return;
  if (a === 'undo') doUndo();
  else if (a === 'clear') { U.clearMode = true; U.sel = -1; renderAll(); } else if (a === 'cancel') { U.clearMode = false; renderAll(); } else if (a === 'swap') doSwap();
  else if (a === 'shelf') { U.doneShown = false; showDone(); } else if (a === 'levels') openLevels();
  else if (a === 'glyphs') { C.game.act(K().setGlyphs, { on: !glyphsOn() }); renderAll(); } else if (a === 'restart') {
    if (!U.confirmRestart && st().moves > 0 && !st().done) {
      b.textContent = 'Tap again to start over';
      U.confirmRestart = setTimeout(() => { U.confirmRestart = 0; renderFoot(); }, 3000);
      return;
    }
    clearTimeout(U.confirmRestart);
    U.confirmRestart = 0;
    startLevel(st().level, { fresh: true });
  }
}

function onKey(e) {
  if (e.key !== 'Escape' || !U.visible || !ROOT) return;
  const lv = $('[data-levels]');
  if (U.introOpen) closeIntro();
  else if (lv && !lv.hidden) lv.hidden = true;
  else if (U.sel >= 0 || U.clearMode) { U.sel = -1; U.clearMode = false; renderAll(); }
}

function onResize() {
  clearTimeout(U.resizeT);
  U.resizeT = setTimeout(() => { if (U.visible && !U.busy && !U.drag) renderAll(); }, 120);
}

// ---------------------------------------------------------------------------
// Guide (at most 2 steps before her first action; the first IS the action)
// ---------------------------------------------------------------------------

function coachSteps() {
  const moved = (s) => {
    const x = s && s.skeins && s.skeins.sess && s.skeins.sess.state;
    return !!x && (x.moves > 0 || x.done);
  };
  return [
    { anchor: '[data-coach="skeins-tray"]', text: 'Drag a stack from the tray onto any empty peg.', endsOn: 'action', done: moved, side: 'above' },
    { anchor: '[data-coach="skeins-goal"]', text: 'Ten of one color on top twist into a hank. Bundle enough to finish.', endsOn: 'got-it' },
  ];
}

// ---------------------------------------------------------------------------
// The Puzzle table's card (puzzles.js draws it between its other cards)
// ---------------------------------------------------------------------------

/** skeinsCardHtml(ctx, state) -> the Winding Room card: her level at a glance, or the price tag while it is closed. */
export function skeinsCardHtml(ctx, state) {
  const Ks = ctx.sim.skeins;
  if (!Ks) return '';
  injectStyle('card', CARD_CSS);
  const sum = Ks.summary(state);
  if (!sum.open) {
    return h`<div class="card" id="pz-skeins" data-coach="skeins-card">
<div class="h3">Winding Room</div>
<div class="hint">Stack yarn in your own colors on a table of pegs. Ten of one color on top twist into a hank.</div>
<div class="pz-tiertag">${unlockTag(ctx, 'skeins', { cls: 'pz-tag' })}</div>
</div>`;
  }
  const Rs = ctx.puzzles.skeins;
  const ids = Ks.yarns(state);
  const nm = (k) => nameOfId(ctx, ids[k]);
  const title = Rs.levelTitle(sum.level, nm);
  const chOf = (li) => Rs.CHAPTERS[Rs.chapterOf(li)].name;
  let line;
  if (sum.playing) line = `${chOf(sum.level)} · Level ${sum.level + 1} · ${title} · ${sum.hanks} of ${sum.goal} hanks`;
  else if (sum.next >= 0 && (sum.done || sum.finished)) line = `${chOf(sum.next)}: level ${sum.next + 1}, ${Rs.levelTitle(sum.next, nm)}, is ready when you are.`;
  else if (sum.next < 0) line = `All ${sum.levels} levels are wound. Wind any of them again.`;
  else line = 'Twist yarn in your colors into hanks, a few calm moves at a time.';
  const stats = sum.finished ? `${sum.finished} ${sum.finished === 1 ? 'level' : 'levels'} finished` : '';
  const mini = raw(`<div class="sk-mini" aria-hidden="true">${[0, 1, 2].map((k) => skeinSvgHex(hexOfId(ctx, ids[k]))).join('')}</div>`);
  const label = sum.playing ? `Continue level ${sum.level + 1}` : sum.next >= 0 && sum.finished ? `Play level ${sum.next + 1}` : 'Wind some yarn';
  const rest = restBits(ctx, state, 'skeins');
  return h`<div class="card" id="pz-skeins" data-coach="skeins-card">
<div class="row between"><div class="h3">Winding Room</div>${stats ? h`<span class="chip">${stats}</span>` : ''}</div>
<div class="sk-cardrow">${mini}<div class="hint grow">${line}</div></div>
${rest.block || button(label, { variant: 'primary', block: true, attrs: { 'data-action': 'open-skeins' } })}
${rest.line}
</div>`;
}

/** skeinsCardSig(ctx, state) -> what the card shows, for the Puzzle table's redraw check. */
export function skeinsCardSig(ctx, state) {
  if (!ctx.sim.skeins) return 0;
  const u = ctx.sim.unlocks.status(state, 'skeins');
  return JSON.stringify([u && u.revealed, u && u.affordable, u && u.open, u && u.colorsLeft, ctx.sim.skeins.summary(state), ctx.sim.skeins.yarns(state).slice(0, 3)]);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/** debugSkeins() -> a read for tests (test/skeins.e2e.mjs). */
export function debugSkeins() {
  return {
    busy: U.busy, sel: U.sel, clearMode: U.clearMode, drag: !!U.drag, visible: U.visible, doneShown: U.doneShown, introOpen: U.introOpen,
    liftPx: LIFT,
    pegCenter(i) {
      const b = $('[data-board]');
      if (!b || !U.L) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + U.L.pos[i].x, y: r.top + U.L.pos[i].y };
    },
  };
}

export default {
  id: 'skeins',

  mount(root, ctx) {
    C = ctx;
    ROOT = root;
    injectStyle('screen', CSS);
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) U.guide = C.guide('skeins', coachSteps(), { screen: 'skeins' });
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        if (!p || p.id !== 'skeins') return;
        if (U.visible) {
          C.game.act(K().ensureLevel, {});
          skeleton();
          renderAll();
          if (U.guide) U.guide.start();
          return;
        }
        // On the Puzzle table its own card is the way in; elsewhere (the workshop's Next) offer it.
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'skeins'); };
        if (here()) return;
        setTimeout(() => {
          if (U.visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Winding Room is open',
            body: 'Stack yarn in your colors and twist hanks, whenever you like.',
            more: { label: 'Later' },
            next: { label: 'Go to the Winding Room', run: () => C.navigate('skeins') },
          });
        }, 300);
      });
    }
  },

  show() {
    U.visible = true;
    U.gen += 1;
    U.busy = false;
    U.sel = -1;
    U.clearMode = false;
    U.note = '';
    U.view = null;
    U.trayView = null;
    U.hanksView = null;
    if (unlocked()) {
      C.game.act(K().ensureSkeins);
      C.game.act(K().ensureLevel, {});
      // Back after finishing a level (its shelf was shown then): the next one is on the table.
      const k = S().skeins;
      const nx = k.sess && k.sess.state.done ? K().nextLevel(S()) : -1;
      if (nx >= 0 && nx !== k.li) C.game.act(K().startLevel, { level: nx });
      // Nothing on the table and the room resting (Responsibility mode): the gentle sheet, and back.
      if (!S().skeins.sess && isResting(C, 'skeins')) { setTimeout(() => { if (U.visible) C.back(); openRestSheet(C, 'skeins'); }, 0); return; }
    }
    skeleton();
    renderAll();
    // A finished level waits on the board; the dock offers "See your shelf".
    U.doneShown = !!(sess() && st().done);
    U.introOpen = false;
    if (U.guide && unlocked()) U.guide.start();
    if (unlocked()) maybeIntro();
  },

  hide() {
    U.visible = false;
    U.gen += 1;
    U.busy = false;
    U.introOpen = false;
    U.introFresh = [];
    clearTimeout(U.confirmRestart);
    U.confirmRestart = 0;
    if (U.drag && U.drag.ghost) U.drag.ghost.remove();
    U.drag = null;
    const l = typeof document !== 'undefined' ? document.getElementById('sk-fx') : null;
    if (l) l.innerHTML = '';
    if (U.guide) U.guide.stop();
  },

  render(state) {
    if (!ROOT || !U.visible || U.busy || U.drag) return;
    renderCoins();
    if (!sameSig(sigOf(state), U.sig)) renderAll();
  },
};
