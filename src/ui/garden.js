/**
 * garden.js: The Dye Garden (overlay `garden`, fullscreen, home tab Puzzles;
 * also reached from the Map's Dye Garden card). Ported from proto/garden/
 * (playtested and loved), keeping its feel: steer a basket through real dye
 * plants; it grows with every plant until even the cart and the shed fit.
 *
 * Owns two views inside the section:
 *  - choose: the five places (each by a map region), Today's garden, "Keep
 *    wandering", the dye shelf and "How this works"; and the Garden Path card
 *    (progress and Continue), which opens the path list (U.sub 'path'): nine
 *    chapter sections of numbered gardens with done ticks and stars, the next
 *    garden highlighted, and a garden card (goal, stars, what is new: intro
 *    cards for new plants and mechanics) before each garden;
 *  - play: a canvas garden with the top HUD (back, place name or the sun
 *    clock, sound, help; the basket level and growth bar with the bonus goal
 *    on one compact line under it), finds, combos, landmarks, the goat (harvest
 *    only), and a single "Head home" button at the bottom. There is no jar row
 *    during play (the owner's change); the haul shows on the end card.
 *
 * Modes: Wander (no clock, the default and the primary button) and Harvest
 * before dusk (opt-in, about two minutes; never a fail: dusk simply brings
 * the basket home and every plant gathered is banked). The sun pill and the
 * sky tint are the clock; nothing turns red.
 *
 * Rules: src/puzzles/garden.js (pure). Saving and pay: src/sim/garden.js
 * through ctx.game.act (saveVisit keeps a Wander visit to resume,
 * finishVisit banks a visit: coins, a few jars of stock, bests, hooks).
 * Leaving the screen mid-visit: a Wander visit is kept for "Keep wandering";
 * a harvest is banked at once.
 *
 * Performance (as in the prototype): a spatial grid for gathering and the goat,
 * culling to the view, small sprite copies for tiny plants, decor skipped when
 * it would be a speck, and an automatic resolution step-down when frames stay
 * slow. Reduced motion (the game setting or the system) turns pops and tumbles
 * into short fades. Garden sounds are off by default (the ♪ chip) and play
 * through ctx.audio, so the game's own sound setting still rules.
 *
 * Guide 'garden' (at most 2 steps before her first action): Wander on the
 * first place, then steer over a plant, then the growth bar.
 *
 * The Garden Path (src/puzzles/garden-path.js): a path garden plays like a
 * Wander visit (no clock unless she picks "Before dusk" in a sunny garden; it
 * resumes) with its goal on the line under the growth bar. When the goal is
 * met, sim.garden.reachGoal records it at once and the next garden opens;
 * she can keep gathering for stars or head home. Its mechanics: a stream
 * whose floating plants drift past (positions from floatPos(g, p, time),
 * gathered from their own list, never in the grid), hedges with gates that
 * open at a basket size (hedgeStep stops the basket; plants behind a closed
 * gate wait), and a napping cat (catWakes; it pads off to a quieter corner).
 * Weather is screen-only and cheap (petals, leaves or snow; none with reduced
 * motion).
 */

import { h, raw, backButton, escapeHtml, iconSvg } from './kit.js';
import { unlockTag, openUnlockSheet, ensureStyles as ensureWorkshopStyles } from './workshop.js';
import {
  PLACES, PLACE_BY_ID, PLACE_REGION, SPECIES, DYES, FACTS, MODES, R0, OPENING, TEETER, GOAT, FIND_KINDS,
  gardenFor, newVisit, gather, isDone, restoreVisit, basketRadius, fits, over, buildGrid, queryGrid,
  nearestGatherable, tally, placeDyes, jarsLabel, pickFact, unitsOf, mulberry32, harvestSeed,
  levelInfo, comboAdd, comboOpen, comboLabel, newGoat, goatStep, findAt, breezeCatches,
  goalFor, skyAt, clockLabel,
} from '../puzzles/garden.js';
import { floatPos, streamY } from '../puzzles/garden.js';
import {
  LEVELS, LEVEL_BY_ID, CHAPTERS, CHAPTER_BY_ID, MECHANICS, pathGarden, introFor, goalText, goalShort, progress as pathProgress, score as pathScore,
  hedgeStep, gateOpen, catWakes, catNextSpot, steerPoint, nearestFit, nameInSentence, chapterLevels,
} from '../puzzles/garden-path.js';
import { plantSprite, shrinkSprite, basketSprite, decorSprite, goatSprite, findSprite, catSprite, GROUNDS, PAD } from './garden-sprites.js';
import { gardenIcon } from './garden-art.js';

const HOW = [
  'Drag anywhere on the garden to steer your basket. It glides after your finger.',
  'Roll over plants that fit to gather them. Every one makes the basket grow. The bar at the top shows your basket size and the next plant to come into reach. Sweep along rows and patches to gather lots at once.',
  'A plant only a little too big wobbles on the rim; grow a bit more and it drops in. Right at the end the biggest things fit: a hay cart, a shed, a dye vat, even an old oak.',
  'Sparkles are finds. A wide brim lets bigger things in for a few seconds, a breeze draws little plants to you, and now and then there is a lost spindle to keep.',
  '<b>Wander</b> has no clock. Head home whenever you like, and pick up where you left off next time.',
  '<b>Harvest before dusk</b> lasts about two minutes while the sun crosses the sky; the sun starts when you first move. At dusk the basket heads home, and you see your jars and basket size beside your best. Each place plays the same every time, or turn on Today\'s garden for a new one each day. The neighbor\'s goat nibbles there too, and a big basket makes it hop away.',
  'Each visit has a small bonus goal, just under the basket bar. Everything you gather comes home: coins for the workshop, a few jars of your nearest colors for the shelves, and the dyes for your dye shelf.',
  '<b>The Garden Path</b> is 108 gardens, one after another, each with its own goal. Meet the goal and the next garden opens; stars are extra and never hold you back. New plants and new things (a stream, garden gates, a napping cat) come one at a time.',
];
const theName = (p) => p.name.replace(/^The /, 'the ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const CSS = `
#screen-garden { --gd-card: #FBF8F1; --gd-accent: #8C6512; --gd-gold: #E2B04A; --gd-line: rgba(42,38,34,.14); }
#screen-garden .gd-choose { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
#screen-garden .gd-head .titles { min-width: 0; }
#screen-garden .how-link { flex: 0 0 auto; min-width: 44px; max-width: 72px; min-height: 44px; padding: 0 2px; white-space: normal; text-align: center; line-height: 1.15; font-size: 12px; font-weight: 600; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
.gd-intro { margin: 0; font-size: 14px; line-height: 1.45; color: var(--ink-soft); }
.gd-pay { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); }
.gd-today { display: flex; align-items: center; gap: 10px; }
.gd-today .btn { flex: none; }
.gd-today .btn[aria-pressed="true"] { background: #F3E3B8; box-shadow: 0 0 0 2px var(--gd-gold), var(--cut); }
.gd-today .hint { margin: 0; line-height: 1.35; }
.gd-places { display: flex; flex-direction: column; gap: 12px; }
.gd-place { padding: 0; overflow: hidden; gap: 0; }
.gd-place canvas { display: block; width: 100%; height: 84px; }
.gd-place .t { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 3px; }
.gd-place h2 { margin: 0; font: 400 21px var(--font-display); display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.gd-place h2 small { font: 600 12px var(--font-ui); color: var(--ink-soft); }
.gd-place p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.4; }
.gd-place .dyes { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; color: var(--ink-soft); }
.gd-place .dyes span { display: inline-flex; align-items: center; gap: 5px; }
.gd-place .dyes i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(42,38,34,.2); }
.gd-place .best { margin: 6px 0 0; font-size: 14px; color: var(--ink); }
.gd-place .modes { display: flex; gap: 8px; margin-top: 10px; }
.gd-place .modes .btn { flex: 1 1 0; min-width: 0; min-height: 50px; padding: 4px 8px; font-size: 14px; line-height: 1.2; flex-direction: column; }
.gd-place .modes .btn small { display: block; font-weight: 500; font-size: 12px; opacity: .8; }
.gd-continue { min-height: 52px; font-size: 16px; }
.gd-shelf h2 { font: 400 19px var(--font-display); margin: 0 0 8px; }
.gd-shelf ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 14px; }
.gd-shelf li { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.gd-how { font-size: 14px; color: var(--ink-soft); }
.gd-how summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 600; color: var(--ink); }
.gd-how ol, .gd-help ol { margin: 0; padding-left: 22px; line-height: 1.5; }
.gd-how li, .gd-help li { margin-bottom: 6px; }

.gd-jar { --c: #ccc; position: relative; flex: none; width: 24px; height: 32px; border-radius: 5px 5px 8px 8px; background: color-mix(in srgb, var(--c) 16%, #fff); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, rgba(42,38,34,.4)), 0 2px 0 rgba(42,38,34,.14); overflow: hidden; }
.gd-jar::before { content: ''; position: absolute; left: 3px; right: 3px; top: 0; height: 4px; border-radius: 0 0 2px 2px; background: #B39A74; z-index: 2; }
.gd-jar i { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; background: var(--c); }
.gd-jar i::after { content: ''; position: absolute; left: 4px; top: 3px; width: 3px; bottom: 3px; border-radius: 2px; background: rgba(255,255,255,.28); }

/* playing */
#screen-garden .gd-play { position: absolute; inset: 0; z-index: 8; overflow: hidden; background: #D8D2B8; overscroll-behavior: none; touch-action: none; }
#screen-garden .gd-play[hidden] { display: none; }
.gd-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.gd-sky { position: absolute; inset: 0; pointer-events: none; background: transparent; }
.gd-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 6px; padding: calc(4px + var(--safe-top)) 8px 4px; pointer-events: none; }
.gd-hud > * { pointer-events: auto; }
.gd-chip { appearance: none; border: 0; min-width: 44px; min-height: 44px; padding: 0 12px; border-radius: 22px; background: rgba(251,248,241,.92); box-shadow: 0 3px 0 rgba(42,38,34,.18); font: 600 14px var(--font-ui); color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; touch-action: manipulation; }
.gd-chip:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(42,38,34,.18); }
.gd-chip[aria-pressed="true"] { background: #F3E3B8; }
.gd-chip svg { width: 20px; height: 20px; }
.gd-name { flex: 1; min-width: 0; text-align: center; font: 400 18px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 0 rgba(255,255,255,.6); pointer-events: none; }
.gd-coach { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); padding: 10px 16px; border-radius: 14px; background: rgba(251,248,241,.94); box-shadow: 0 3px 0 rgba(42,38,34,.18); font-size: 15px; font-weight: 500; text-align: center; pointer-events: none; transition: opacity .6s ease; max-width: min(320px, calc(100% - 32px)); }
.gd-coach.gone { opacity: 0; }
.gd-basket-anchor { position: absolute; left: 50%; top: 50%; width: 96px; height: 96px; transform: translate(-50%, -50%); pointer-events: none; }
/* the bottom: only Head home, floating at the right (no jar row; the haul shows on the end card) */
.gd-bot { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: flex-end; padding: 8px 10px calc(10px + var(--safe-bottom)); pointer-events: none; }
.gd-bot > * { pointer-events: auto; }
.gd-bot .btn { min-height: 48px; padding: 0 18px; }

/* growth bar: basket level, a bar to the next size step, the next plant below it; the bonus goal on one line under it */
.gd-grow { position: absolute; left: 50%; transform: translateX(-50%); top: calc(52px + var(--safe-top)); width: min(420px, calc(100% - 16px)); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; row-gap: 3px; padding: 5px 10px 5px 5px; border-radius: 16px; background: rgba(251,248,241,.92); box-shadow: 0 2px 0 rgba(42,38,34,.14); pointer-events: none; }
.gd-lvl { flex: none; width: 46px; height: 40px; border-radius: 12px; background: #F3E3B8; box-shadow: inset 0 0 0 1.5px rgba(140,101,18,.35); display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.gd-lvl small { font-size: 10px; font-weight: 600; letter-spacing: .04em; color: var(--gd-accent); }
.gd-lvl b { font: 400 20px var(--font-display); margin-top: 1px; }
.gd-gcol { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.gd-gbar { position: relative; height: 10px; border-radius: 5px; background: rgba(42,38,34,.12); overflow: hidden; }
.gd-gbar i { position: absolute; inset: 0; transform-origin: 0 50%; transform: scaleX(var(--p, 0)); background: linear-gradient(90deg, #E2B04A, #EBC56E); border-radius: 5px; }
.gd-gnext { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; min-height: 20px; }
.gd-gnext img { width: 20px; height: 20px; flex: none; }
.gd-gnext span { overflow: hidden; text-overflow: ellipsis; }
.gd-gnext b { color: var(--ink); font-weight: 600; }
.gd-cnt { flex: none; min-width: 34px; text-align: right; font: 700 15px var(--font-ui); font-variant-numeric: tabular-nums; }
.gd-cnt small { display: block; font-size: 10px; font-weight: 600; color: var(--ink-soft); }
.gd-grow.up .gd-lvl { background: #F7D98A; }
.gd-goal { flex: 1 0 100%; display: flex; align-items: center; gap: 5px; padding-left: 4px; font-size: 12px; color: var(--ink-soft); min-height: 16px; line-height: 1.2; white-space: nowrap; overflow: hidden; }
.gd-goal span { overflow: hidden; text-overflow: ellipsis; }
.gd-goal b { color: var(--ink); font-variant-numeric: tabular-nums; }
.gd-goal.met { color: var(--gd-accent); }
.gd-goal .tick { flex: none; display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: var(--gd-gold); color: #fff; font-size: 10px; font-weight: 700; }

/* the clock: a sun crossing the sky (harvest only) */
.gd-sun { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; pointer-events: none; }
.gd-sun[hidden] { display: none; }
.gd-sun svg { width: 92px; height: 34px; flex: none; overflow: visible; }
.gd-sun span { font: 600 14px var(--font-ui); font-variant-numeric: tabular-nums; color: var(--ink); background: rgba(251,248,241,.85); border-radius: 10px; padding: 2px 7px; }

/* little pops: combos, finds, landmarks, level-ups */
.gd-toast { position: absolute; left: 50%; top: calc(132px + var(--safe-top)); transform: translateX(-50%); max-width: calc(100% - 24px); padding: 8px 14px; border-radius: 16px; background: rgba(251,248,241,.96); box-shadow: 0 3px 0 rgba(42,38,34,.18); font: 700 16px var(--font-ui); line-height: 1.25; text-align: center; pointer-events: none; width: max-content; text-wrap: balance; opacity: 0; transition: opacity .25s ease; }
.gd-toast.show { opacity: 1; }
.gd-toast.gold { background: #F3E3B8; box-shadow: 0 0 0 2px var(--gd-gold), 0 3px 0 rgba(42,38,34,.18); }
.gd-lvlpop { position: absolute; left: 50%; top: 38%; transform: translateX(-50%); font: 400 34px var(--font-display); color: #FBF8F1; text-shadow: 0 2px 0 rgba(42,38,34,.35), 0 0 14px rgba(140,101,18,.5); pointer-events: none; opacity: 0; white-space: nowrap; }

.gd-over { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(42,38,34,.28); overflow: auto; touch-action: pan-y; }
.gd-over[hidden] { display: none; }
.gd-over .card { width: 100%; max-width: 420px; max-height: 100%; overflow: auto; padding: 16px; gap: 6px; }
.gd-over h2 { font: 400 24px var(--font-display); margin: 0 0 4px; }
.gd-help .btn { width: 100%; margin-top: 8px; min-height: 50px; }
.gd-haul { list-style: none; margin: 6px 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; }
.gd-haul li { display: flex; align-items: center; gap: 8px; padding: 5px 2px; border-top: 1px solid var(--gd-line); font-size: 14px; line-height: 1.2; min-width: 0; }
.gd-haul li .nm { flex: 1; min-width: 0; }
.gd-haul li em { display: block; font-style: normal; color: var(--ink-soft); font-size: 13px; }
.gd-fact { background: #F3EBD7; border-radius: 12px; padding: 10px 12px; margin: 4px 0 8px; font-size: 15px; line-height: 1.45; }
.gd-fact small { display: block; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--gd-accent); margin-bottom: 3px; }
.gd-score { display: flex; align-items: center; gap: 12px; margin: 8px 0 4px; padding: 10px 12px; border-radius: 12px; background: #F3EBD7; }
.gd-score[hidden] { display: none; }
.gd-score .big { font: 400 30px var(--font-display); line-height: 1; }
.gd-score .big small { font: 600 14px var(--font-ui); }
.gd-score .sub { font-size: 14px; color: var(--ink-soft); line-height: 1.35; }
.gd-score .sub b { color: var(--ink); }
.gd-newbest { display: inline-block; padding: 2px 8px; border-radius: 10px; background: var(--gd-gold); color: #2A2622; font-weight: 700; font-size: 13px; margin-left: 4px; }
.gd-notes { list-style: none; margin: 4px 0 0; padding: 0; font-size: 14px; color: var(--ink-soft); }
.gd-notes li { padding: 2px 0; }
.gd-pays { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 2px; padding: 10px 12px; border-radius: 12px; background: var(--paper); box-shadow: var(--cut-sm); font-size: 14px; }
.gd-pays .coins { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; }
.gd-pays .coins i { width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #F2D27A, #C99A2E); box-shadow: inset 0 0 0 1.5px #8C6512; }
.gd-pays .stock { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; color: var(--ink-soft); }
.gd-pays .stock span { display: inline-flex; align-items: center; gap: 5px; color: var(--ink); }
.gd-pays .stock i { width: 12px; height: 12px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(42,38,34,.2); }
.gd-endbtns { display: flex; gap: 8px; flex-wrap: wrap; }
.gd-endbtns .btn { flex: 1 1 140px; min-height: 50px; flex-direction: column; line-height: 1.2; }
.gd-endbtns .gd-linkbtn { flex: 1 0 100%; }
/* the Garden Path */
.gd-pathcard { padding: 14px; gap: 8px; }
.gd-pathcard h2 { margin: 0; font: 400 21px var(--font-display); }
.gd-pathcard p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.4; }
.gd-pathcard p b { color: var(--ink); font-weight: 600; }
.gd-pbar { height: 8px; border-radius: 4px; background: rgba(42,38,34,.12); overflow: hidden; }
.gd-pbar i { display: block; height: 100%; width: calc(var(--p, 0) * 100%); background: linear-gradient(90deg, #E2B04A, #EBC56E); border-radius: 4px; }
.gd-pathcard .modes, .gd-lvbtns { display: flex; gap: 8px; flex-wrap: wrap; }
.gd-pathcard .modes .btn, .gd-lvbtns .btn { flex: 1 1 140px; min-height: 50px; padding: 4px 10px; line-height: 1.2; flex-direction: column; }
.gd-pathcard .modes .btn small, .gd-lvbtns .btn small { display: block; font-weight: 500; font-size: 12px; opacity: .8; }
.gd-chap { padding: 12px; gap: 4px; scroll-margin-top: 8px; }
.gd-chap h2 { font: 400 19px var(--font-display); margin: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 4px 10px; flex-wrap: wrap; }
.gd-chap h2 small { font: 600 12.5px var(--font-ui); color: var(--ink-soft); }
.gd-chap .hint { margin: 0; }
.gd-tiles { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 8px; }
.gd-tile { appearance: none; border: 0; width: 100%; min-height: 58px; padding: 4px 2px; border-radius: 12px; background: var(--paper); box-shadow: 0 2px 0 rgba(42,38,34,.16); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font: 400 18px var(--font-display); color: var(--ink); cursor: pointer; position: relative; touch-action: manipulation; }
.gd-tile:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(42,38,34,.16); }
.gd-tile .st { font: 700 11px var(--font-ui); letter-spacing: 1px; color: var(--gd-accent); line-height: 1; }
.gd-tile .st i { font-style: normal; color: rgba(42,38,34,.22); }
.gd-tile .nx { font: 700 10px var(--font-ui); letter-spacing: .04em; text-transform: uppercase; color: var(--gd-accent); line-height: 1; }
.gd-tile.done { background: #F3EBD7; }
.gd-tile.done::after { content: '\\2713'; position: absolute; top: 4px; right: 7px; font: 700 11px var(--font-ui); color: var(--gd-accent); }
.gd-tile.next { background: #F3E3B8; box-shadow: 0 0 0 2px var(--gd-gold), 0 2px 0 rgba(42,38,34,.16); }
.gd-tile[aria-disabled="true"] { opacity: .45; cursor: default; }
.gd-tile[aria-disabled="true"]:active { transform: none; }
.gd-pathhead .back-places { flex: none; }
.gd-lvcard .card { gap: 8px; }
.gd-lvcard canvas { display: block; width: 100%; height: 64px; border-radius: 10px; }
.gd-kick { font: 700 12px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--gd-accent); }
.gd-lvgoal { display: flex; gap: 8px; align-items: baseline; padding: 10px 12px; border-radius: 12px; background: #F3EBD7; font-size: 15px; line-height: 1.35; }
.gd-lvgoal b { flex: none; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--gd-accent); }
.gd-stars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.gd-stars li { display: flex; gap: 8px; align-items: baseline; }
.gd-stars .s { flex: none; width: 18px; text-align: center; color: rgba(42,38,34,.3); font-size: 15px; }
.gd-stars .s.on { color: #D49A1E; }
.gd-new { border-top: 1px solid var(--gd-line); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.gd-new > small { font: 700 12px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--gd-accent); }
.gd-newrow { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.4; }
.gd-newrow img, .gd-newrow .mic { flex: none; width: 40px; height: 40px; border-radius: 10px; background: #EEF0E4; display: grid; place-items: center; font-size: 20px; }
.gd-newrow b { display: block; font-weight: 600; }
.gd-newrow em { display: block; font-style: normal; font-weight: 600; color: var(--gd-accent); font-size: 13px; }
.gd-bigstars { font-size: 30px; letter-spacing: 4px; color: #D49A1E; line-height: 1; margin: 4px 0; }
.gd-bigstars i { font-style: normal; color: rgba(42,38,34,.18); }
.gd-linkbtn { appearance: none; border: 0; background: none; min-height: 44px; padding: 0 8px; font: 600 14px var(--font-ui); color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; align-self: center; }
@media (max-width: 380px) { .gd-place .modes .btn { font-size: 13px; padding: 4px 6px; } .gd-sun svg { width: 74px; } }
@media (prefers-reduced-motion: reduce) { .gd-coach, .gd-toast { transition: none; } }
html[data-motion="reduced"] .gd-coach, html[data-motion="reduced"] .gd-toast { transition: none; }
`;

let C = null;
let ROOT = null;
const U = { visible: false, view: 'choose', sub: 'places', guide: null, sig: '', gen: 0, injected: false, lv: null };

const S = () => C.game.state;
const SG = () => C.sim.garden;
const gstate = () => (S() && S().garden) || {};
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
const esc = (s) => escapeHtml(String(s ?? ''));
const reduced = () => !!(C && C.fx && C.fx.isReducedMotion && C.fx.isReducedMotion());
const todayKey = () => (C.format && C.format.dayKey ? C.format.dayKey(C.game.now()) : '');
const $ = (sel) => (ROOT ? ROOT.querySelector(sel) : null);
const unlocked = () => !!safe(() => SG().unlocked(S()));
const regionName = (placeId) => {
  const id = PLACE_REGION[placeId];
  const r = safe(() => C.content.REGIONS.find((x) => x.id === id));
  return r ? r.name : '';
};
let seedBump = 0;
const freshSeed = () => ((Date.now() ^ (Math.random() * 4294967296)) + ++seedBump) >>> 0 || 1;

function injectCss() {
  if (U.injected || typeof document === 'undefined') return;
  U.injected = true;
  const el = document.createElement('style');
  el.id = 'gd-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// The choose view
// ---------------------------------------------------------------------------

function bestFor(placeId) {
  const today = !!gstate().settings && !!gstate().settings.today;
  return safe(() => SG().bestOf(S(), placeId, { daily: today, day: todayKey() })) || null;
}

function placeStrip(cv, place) {
  if (!cv || !cv.getContext) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 320, hgt = cv.clientHeight || 84;
  cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
  const ctx = cv.getContext('2d');
  const gr = GROUNDS[place.ground];
  ctx.fillStyle = gr.base; ctx.fillRect(0, 0, cv.width, cv.height);
  if (place.ground === 'terraces') { ctx.fillStyle = gr.wall; for (let y = 26; y < hgt; y += 30) ctx.fillRect(0, y * dpr, cv.width, 3 * dpr); }
  if (place.ground === 'shore') { ctx.fillStyle = gr.water; ctx.fillRect(cv.width * 0.82, 0, cv.width, cv.height); }
  const rnd = mulberry32(place.id.length * 977);
  const kinds = place.mix.map(([s]) => s);
  let x = 22;
  for (let i = 0; x < w - 10; i++) {
    const s = kinds[i % kinds.length];
    const r = Math.min(30, 9 + SPECIES[s].r * 0.5);
    const sp = plantSprite(s, i % 3, r * dpr);
    const y = hgt / 2 + (rnd() - 0.5) * 22;
    ctx.drawImage(sp.canvas, (x - r * sp.half) * dpr, (y - r * sp.half) * dpr, 2 * r * sp.half * dpr, 2 * r * sp.half * dpr);
    x += r * 1.5 + 6;
  }
}

function chooseSig() {
  const st = S();
  const u = safe(() => C.sim.unlocks.status(st, 'garden')) || {};
  const g = gstate();
  return JSON.stringify([u.revealed, u.affordable, u.open, g.visits, g.cur && [g.cur.place, (g.cur.got || []).length], g.settings,
    g.bests, g.daily, g.spindles, g.shelf, todayKey(), Math.round(safe(() => SG().coinsPerJar(st, C.game.now())) || 0), U.sub, g.path && g.path.done,
    !!(st.onboarding && st.onboarding.seen && st.onboarding.seen.garden)]);
}

function renderChoose(force = false) {
  if (!ROOT) return;
  const sig = chooseSig();
  if (!force && sig === U.sig && $('.gd-choose')) return;
  U.sig = sig;
  const box = $('.gd-choose');
  if (!box) return;
  const how = C.guide && C.guide.howThisWorksHtml ? C.guide.howThisWorksHtml('garden') : '';
  const head = `<div class="screen-head gd-head">${backButton('Back')}
<div class="titles"><div class="title">Dye Garden</div><div class="subtitle">Real dye plants and a growing basket</div></div>${unlocked() ? how : '<div class="spacer"></div>'}</div>`;
  if (!unlocked()) {
    box.innerHTML = `${head}<div class="screen-body"><div class="card" style="padding:16px;gap:10px">
<div class="row" style="gap:10px;align-items:center">${gardenIcon(40)}<div class="h3">The garden gate is closed</div></div>
<p class="hint">Steer a basket and gather real dye plants. Start with the little ones; the basket grows as it fills, until even the cart and the shed fit. Wander with no clock, or try a harvest before dusk.</p>
<div data-lock>${unlockTag(C, 'garden', { cls: 'pz-tag' })}</div></div></div>`;
    return;
  }
  if (U.sub === 'path') { renderPathList(box); return; }
  const g = gstate();
  const today = !!(g.settings && g.settings.today);
  const q = safe(() => SG().quote(S(), C.game.now())) || { perJar: 0 };
  const perN = Math.max(1, Math.round(q.perJar));
  const per = `${C.format ? C.format.num(perN) : String(perN)} ${perN === 1 ? 'coin' : 'coins'}`;
  const cur = g.cur && PLACE_BY_ID[g.cur.place] ? g.cur : null;
  const curPath = g.cur && g.cur.mode === 'path' && LEVEL_BY_ID[g.cur.place] ? g.cur : null;
  // Her very first visit follows the guide's Wander on the first place, so the
  // Garden Path card waits below the places until the guide has been seen; then it leads.
  const guideSeen = !!(S().onboarding && S().onboarding.seen && S().onboarding.seen.garden);
  const cards = PLACES.map((p, k) => {
    const dyes = placeDyes(p.id).map((d) => `<span><i style="--c:${DYES[d].hex}"></i>${DYES[d].name}</span>`).join('');
    const best = bestFor(p.id);
    const bestLine = best
      ? `Your best harvest${today ? ' today' : ''}: <b>${plural(best.jars, 'jar', 'jars')}</b> · Basket ${best.level}`
      : `<span class="muted">No harvest here yet${today ? ' today' : ''}.</span>`;
    const region = regionName(p.id);
    return `<div class="card gd-place" data-place-card="${p.id}"><canvas aria-hidden="true" data-strip="${p.id}"></canvas><div class="t">
<h2>${p.name}${region ? `<small>by the ${esc(region)}</small>` : ''}</h2><p>${p.blurb}</p><div class="dyes">${dyes}</div>
<p class="best">${bestLine}</p>
<div class="modes"><button type="button" class="btn btn-primary" data-action="visit" data-place="${p.id}" data-mode="wander"${k === 0 ? ' data-coach="garden-wander"' : ''} data-tap>Wander<small>no clock</small></button>
<button type="button" class="btn btn-paper" data-action="visit" data-place="${p.id}" data-mode="harvest" data-tap>Harvest before dusk<small>about 2 minutes</small></button></div></div></div>`;
  }).join('');
  const shelf = safe(() => SG().shelfList(S())) || [];
  const notes = [];
  if (g.visits) notes.push(`From ${plural(g.visits, 'visit', 'visits')}. Dye jars keep forever here.`);
  if (g.spindles) notes.push(`Lost spindles found: ${g.spindles}.`);
  box.innerHTML = `${head}<div class="screen-body gd-body">
<p class="gd-intro">Steer a basket and gather real dye plants. Start with the little ones; the basket grows as it fills, until even the cart and the shed fit. Wander with no clock, or try a harvest before dusk. Nothing to lose either way.</p>
<div class="gd-pay">${gardenIcon(24)}<span>Each jar of dye brings about ${esc(per)} home, plus a few jars of your nearest colors for the shelves.</span></div>
${cur ? `<button type="button" class="btn btn-primary block gd-continue" data-action="continue" data-tap>Keep wandering in ${esc(theName(PLACE_BY_ID[cur.place]))}</button>` : ''}
${guideSeen ? pathCardHtml(curPath) : ''}
<div class="gd-today"><button type="button" class="btn btn-paper small" data-action="today" aria-pressed="${today}" data-tap>&#9728; Today's garden</button>
<p class="hint">${today ? 'Harvests use today’s garden. Your bests for today are kept separately.' : 'Each place harvests the same way every time, so your bests are fair.'}</p></div>
<div class="gd-places">${cards}</div>
${guideSeen ? '' : pathCardHtml(curPath)}
<details class="gd-how"><summary>How the Dye Garden works</summary><ol>${HOW.map((t) => `<li>${t}</li>`).join('')}</ol></details>
${shelf.length || g.spindles ? `<section class="card gd-shelf" data-shelf><h2>Your dye shelf</h2><ul>${shelf.map((d) => `<li><span class="gd-jar" style="--c:${d.hex}"><i></i></span>${esc(d.name)} <span class="muted">${jarsLabel(d.units)}</span></li>`).join('')}</ul>
<p class="hint" style="margin:10px 0 0">${esc(notes.join(' '))}</p></section>` : ''}
</div>`;
  requestAnimationFrame(() => {
    if (!ROOT) return;
    ROOT.querySelectorAll('[data-strip]').forEach((cv) => safe(() => placeStrip(cv, PLACE_BY_ID[cv.dataset.strip])));
  });
}

// ---------------------------------------------------------------------------
// The Garden Path: the card on the places, the path list, the garden card
// ---------------------------------------------------------------------------

const pathSum = () => safe(() => SG().pathSummary(S())) || { total: LEVELS.length, done: 0, stars: 0, next: LEVELS[0].id, nextN: 1, chapters: [] };
const pathDone = () => (gstate().path && gstate().path.done) || {};
const levelLabel = (l) => `Garden ${l.n}`;
const starsHtml = (n, of = 3) => `${'&#9733;'.repeat(n)}<i>${'&#9733;'.repeat(Math.max(0, of - n))}</i>`;
/** The garden to play next: a waiting path visit, else the first not done (the last one again when all are done). */
function nextLevel() {
  const sum = pathSum();
  return LEVEL_BY_ID[sum.next] || LEVELS[LEVELS.length - 1];
}

function pathCardHtml(curPath) {
  const sum = pathSum();
  const nx = curPath ? LEVEL_BY_ID[curPath.place] : nextLevel();
  const ch = CHAPTER_BY_ID[nx.chapter];
  const all = sum.done >= sum.total;
  const line = all
    ? `Every garden on the path is done, with <b>${sum.stars} of ${sum.maxStars || sum.total * 3} stars</b>. Any garden can be played again.`
    : sum.done
      ? `<b>${sum.done} of ${sum.total}</b> gardens done · ${sum.stars} &#9733;. Next: <b>${levelLabel(nx)}, ${esc(nx.name)}</b> in the ${esc(ch.name.toLowerCase().replace(/^the /, ''))}.`
      : `${sum.total} gardens, one after another, each with its own small goal. New plants and new surprises come one at a time.`;
  const go = curPath ? `Keep going<small>${levelLabel(nx)}, where you left off</small>` : all ? 'See the path' : sum.done ? `Continue<small>${levelLabel(nx)}</small>` : `Start<small>${levelLabel(nx)}: ${esc(nx.name)}</small>`;
  return `<section class="card gd-pathcard" data-pathcard>
<div class="row between" style="align-items:baseline;gap:8px;flex-wrap:wrap"><h2>The Garden Path</h2>${sum.done ? `<span class="chip">${sum.done} / ${sum.total}</span>` : ''}</div>
<p>${line}</p>
<div class="gd-pbar" aria-hidden="true"><i style="--p:${(sum.done / sum.total).toFixed(3)}"></i></div>
<div class="modes"><button type="button" class="btn btn-primary" data-action="${all ? 'path-open' : 'path-continue'}" data-tap>${go}</button>
<button type="button" class="btn btn-paper" data-action="path-open" data-tap>All gardens<small>${CHAPTERS.length} chapters</small></button></div>
</section>`;
}

function renderPathList(box) {
  const sum = pathSum();
  const done = pathDone();
  const g = gstate();
  const curPath = g.cur && g.cur.mode === 'path' && LEVEL_BY_ID[g.cur.place] ? g.cur : null;
  const nx = sum.next ? LEVEL_BY_ID[sum.next] : null;
  const head = `<div class="screen-head gd-head gd-pathhead"><button type="button" class="btn-back back-places" data-action="places" aria-label="Back to the places" data-tap>${iconSvg('back', { size: 20 })}</button>
<div class="titles"><div class="title">The Garden Path</div><div class="subtitle">${sum.done} of ${sum.total} gardens · ${sum.stars} &#9733;</div></div><div class="spacer"></div></div>`;
  const chapters = CHAPTERS.map((c) => {
    const ls = chapterLevels(c.id);
    const cs = sum.chapters.find((x) => x.id === c.id) || { done: 0, total: ls.length, stars: 0, open: false };
    const tiles = ls.map((l) => {
      const d = done[l.id];
      const open = !!d || l.n === 1 || !!done[LEVELS[l.n - 2].id];
      const isNext = nx && nx.id === l.id;
      const cls = d ? 'done' : isNext ? 'next' : '';
      const label = d ? `${levelLabel(l)}, ${l.name}: done, ${d.stars} of 3 stars` : isNext ? `${levelLabel(l)}, ${l.name}: next` : open ? `${levelLabel(l)}, ${l.name}` : `${levelLabel(l)}: opens after garden ${l.n - 1}`;
      const sub = d ? `<span class="st" aria-hidden="true">${starsHtml(d.stars)}</span>` : isNext ? '<span class="nx" aria-hidden="true">Next</span>' : '';
      return `<li><button type="button" class="gd-tile ${cls}" data-action="path-level" data-level="${l.id}" aria-label="${esc(label)}"${open ? '' : ' aria-disabled="true"'} data-tap><span aria-hidden="true">${l.n}</span>${sub}</button></li>`;
    }).join('');
    const status = cs.done === cs.total ? `All ${cs.total} done · ${cs.stars} &#9733;` : cs.done ? `${cs.done} of ${cs.total} · ${cs.stars} &#9733;` : cs.open ? 'Ready when you are' : `Opens after garden ${ls[0].n - 1}`;
    return `<section class="card gd-chap" data-chapter="${c.id}"><h2>${esc(c.name)}<small>${status}</small></h2><p class="hint">${esc(c.blurb)}</p><ol class="gd-tiles">${tiles}</ol></section>`;
  }).join('');
  const go = curPath ? `Keep going in ${levelLabel(LEVEL_BY_ID[curPath.place])}` : nx ? `Continue: ${levelLabel(nx)}, ${nx.name}` : '';
  box.innerHTML = `${head}<div class="screen-body gd-body gd-pathbody">
<p class="gd-intro">Each garden has one goal. Meet it and the next garden opens; stars are a little extra and never hold you back.</p>
${go ? `<button type="button" class="btn btn-primary block gd-continue" data-action="path-continue" data-tap>${esc(go)}</button>` : ''}
${chapters}
</div>
<div class="gd-over gd-lvcard" data-lvcard hidden></div>`;
  requestAnimationFrame(() => {
    if (!ROOT || U.sub !== 'path') return;
    const t = ROOT.querySelector('.gd-tile.next');
    const body = ROOT.querySelector('.gd-pathbody');
    if (t && body && U.scrollNext) { U.scrollNext = false; const sec = t.closest('.gd-chap'); if (sec) body.scrollTop = Math.max(0, sec.offsetTop - 60); }
  });
}

function showPath() {
  U.sub = 'path';
  U.scrollNext = true;
  renderChoose(true);
  const body = $('.gd-choose .screen-body');
  if (body && !U.scrollNext) body.scrollTop = 0;
}
function showPlaces() {
  U.sub = 'places';
  renderChoose(true);
  const body = $('.gd-choose .screen-body');
  if (body) body.scrollTop = 0;
}

const miniUrl = new Map();
/** A plant drawn small, as an image URL (for the garden card's "new here" rows). */
function plantImg(s) {
  if (!miniUrl.has(s)) {
    const sp = safe(() => plantSprite(s, 0, 40));
    miniUrl.set(s, sp ? sp.canvas.toDataURL() : '');
  }
  return miniUrl.get(s);
}
const MECH_ICON = { finds: '&#10024;', goat: '&#128016;', dusk: '&#9728;', stream: '&#127754;', gates: '&#128682;', cat: '&#128008;' };

/** The garden card: what this garden asks, its stars, and anything new here (intro cards). */
function openLevelCard(id) {
  const l = LEVEL_BY_ID[id];
  const box = $('[data-lvcard]');
  if (!l || !box) return;
  const done = pathDone()[id];
  const ch = CHAPTER_BY_ID[l.chapter];
  const intro = introFor(id);
  const seen = (gstate().path && gstate().path.seen) || {};
  const plants = intro.plants.map((s) => {
    const sp = SPECIES[s];
    const fact = FACTS_OF(s);
    return `<div class="gd-newrow"><img src="${plantImg(s)}" alt="" width="40" height="40"><div><b>${esc(sp.name)}</b>${sp.note ? `<em>${esc(cap(sp.note))}</em>` : ''}${esc(fact)}</div></div>`;
  });
  const mechs = intro.mechanics.map((m) => `<div class="gd-newrow"><span class="mic" aria-hidden="true">${MECH_ICON[m] || '&#10022;'}</span><div><b>${esc(MECHANICS[m].name)}</b>${esc(MECHANICS[m].text)}</div></div>`);
  const anyNew = plants.length + mechs.length;
  const fresh = intro.plants.some((s) => !seen['p:' + s]) || intro.mechanics.some((m) => !seen['m:' + m]);
  const resume = gstate().cur && gstate().cur.mode === 'path' && gstate().cur.place === id;
  const stars = [`<li><span class="s${done ? ' on' : ''}" aria-hidden="true">&#9733;</span><span>Meet the goal</span></li>`]
    .concat(l.stars.map((st) => `<li><span class="s" aria-hidden="true">&#9734;</span><span>${esc(goalText(st, l))}</span></li>`)).join('');
  const btns = resume
    ? `<button type="button" class="btn btn-primary" data-action="path-start" data-level="${id}" data-resume="1" data-tap>Keep going<small>where you left off</small></button>`
    : l.dusk
      ? `<button type="button" class="btn btn-primary" data-action="path-start" data-level="${id}" data-sun="1" data-tap>Before dusk<small>about ${Math.round(l.dusk / 30) / 2} minutes, for a star</small></button>
<button type="button" class="btn btn-paper" data-action="path-start" data-level="${id}" data-tap>No clock<small>take your time</small></button>`
      : `<button type="button" class="btn btn-primary" data-action="path-start" data-level="${id}" data-tap>${done ? 'Play again' : 'Start'}<small>${levelLabel(l)}</small></button>`;
  box.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="gd-lv-title">
<canvas data-lvstrip aria-hidden="true"></canvas>
<div class="gd-kick">${levelLabel(l)} · ${esc(ch.name)}</div>
<h2 id="gd-lv-title" style="margin:0">${esc(l.name)}</h2>
${done ? `<div class="gd-bigstars" aria-label="${done.stars} of 3 stars">${starsHtml(done.stars)}</div>` : ''}
<div class="gd-lvgoal"><b>Goal</b><span>${esc(goalText(l.goal, l))}</span></div>
<ul class="gd-stars" aria-label="Stars">${stars}</ul>
${anyNew ? `<div class="gd-new" data-new><small>${fresh ? 'New in this garden' : 'First met in this garden'}</small>${mechs.join('')}${plants.join('')}</div>` : ''}
<div class="gd-lvbtns">${btns}</div>
<button type="button" class="gd-linkbtn" data-action="lv-close" data-tap>Not now</button>
</div>`;
  box.hidden = false;
  U.lv = id;
  requestAnimationFrame(() => {
    const cv = box.querySelector('[data-lvstrip]');
    if (cv) safe(() => placeStrip(cv, { id: l.id, ground: l.ground, mix: l.mix.filter(([s]) => !SPECIES[s].landmark).concat(l.mix.filter(([s]) => SPECIES[s].landmark)) }));
    const b = box.querySelector('[data-action="path-start"]');
    if (b) b.focus({ preventScroll: true });
    const card = box.querySelector('.card');
    if (card) card.scrollTop = 0;
  });
}
function closeLevelCard() {
  const box = $('[data-lvcard]');
  if (box) box.hidden = true;
  U.lv = null;
}
const FACTS_OF = (s) => safe(() => FACTS[SPECIES[s].fact]) || '';

/** Start (or resume) a path garden. sun: the opt-in clock in a sunny garden. */
function startPath(id, { sun = false, resume = false } = {}) {
  const l = LEVEL_BY_ID[id];
  if (!l || !safe(() => SG().pathOpen(S(), id))) return;
  // the intro cards were on the garden card: mark them seen
  const intro = introFor(id);
  for (const s2 of intro.plants) C.game.act(SG().seeIntro, { key: 'p:' + s2 });
  for (const m of intro.mechanics) C.game.act(SG().seeIntro, { key: 'm:' + m });
  closeLevelCard();
  const c = gstate().cur;
  if (resume && c && c.mode === 'path' && c.place === id) { startVisit(id, 'path', c.seed, c); return; }
  const banked = bankSaved();
  startVisit(id, 'path', l.seed, null, { sun: !!(sun && l.dusk) });
  if (banked && U.view === 'play') showToast(banked, true, 3);
}

// ---------------------------------------------------------------------------
// The visit (ported from proto/garden/app.js)
// ---------------------------------------------------------------------------

let cv = null, ctx = null;
const el = {};
let g = null, mode = MODES.wander, visit = null, taken = null, eatenN = 0, grid = null, place = null, gr = null, visitDay = '';
let vw = 0, vh = 0, ox = 0, oy = 0, dpr = 1, vf = 1, Z0 = 3.4;
const B = { x: 0, y: 0, vx: 0, vy: 0, r: R0, squash: 0 };
const cam = { x: 0, y: 0, z: 3.4 };
let drag = null, keys = new Set(), auto = null, speed = 1; // auto, speed: test-only (autopilot, a faster clock)
let falling = [], bits = [], recent = [];
let time = 0, lastGather = 0, lastVisibleFit = 0, hint = -1, hintCheck = 0;
let raf = 0, lastT = 0, running = false, ended = false, endTimer = 0, errs = 0;
let sprites = new Map(), bSprite = null, decor = [], decorSprites = {}, goatSprites = [], findSprites = {};
let movedOnce = false, saveDue = 0, gatheredOnce = false;
let clock = { on: false, started: false, t: 0, secs: 0 }, homing = null;
let goat = null, goatAcc = 0, goatSaid = 0, goatSayUntil = 0;
let found = new Set(), effects = { brim: 0, breeze: 0 };
let combo = null, comboBest = 0, toastUntil = 0, toastPrio = 0, comboText = '', comboTextAt = 0, comboPop = false;
let goal = null, goalHave = 0, goalMet = false;
let lastLevel = 1, growDirty = true, growAt = 0, nextKey = '', levelRing = 0, cntPopAt = 0;
let nudge = { x: 0, y: 0, t: 0 }, landmarksGot = 0, spindleNew = false, result = null;
// the Garden Path: the level, its run (goal, stars, cat), floating plants, gates, the cat, weather
let lvl = null, pr = null, fls = [], gatesOpen = [], cat = null, catSprites = [], weather = [], goatHello = false, gateSaidAt = -9;
const frameDt = [], frameWork = [];

const QUALITY = [1, 0.8, 0.65, 0.5];
let qual = 0, slowSum = 0, slowN = 0;
/** Watch frame times; if the average stays slow, render fewer pixels (only ever steps down). */
function adapt(dtMs) {
  if (time < 1.5 || dtMs > 200) return;
  slowSum += dtMs; slowN++;
  if (slowN < 90) return;
  const avg = slowSum / slowN;
  slowSum = 0; slowN = 0;
  if (avg > 19 && qual < QUALITY.length - 1 && dpr > 1) { qual++; resize(); }
}
function resize() {
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  vw = r.width || window.innerWidth; vh = r.height || window.innerHeight; ox = r.left; oy = r.top;
  // devicePixelRatio capped at 2, then lowered a step at a time if this phone is fill-bound
  const nd = Math.max(1, Math.min(2, window.devicePixelRatio || 1) * QUALITY[qual]);
  cv.width = Math.round(vw * nd); cv.height = Math.round(vh * nd);
  const nvf = Math.max(0.85, Math.min(1.6, Math.min(vw, vh * 0.62) / 390));
  const rebuild = nd > dpr || Math.abs(nvf - vf) > 0.08; // dropping resolution keeps the sharper sprites (no hitch)
  dpr = nd; vf = nvf; Z0 = 3.0 * vf;
  if (g && rebuild) buildSprites();
}
function onResize() { if (U.visible && U.view === 'play') resize(); }

const GOAT_R = 17, FIND_R = 11;
let miniCache = {};
function buildSprites() {
  sprites = new Map();
  // only the variants this garden uses, each with a small copy for when it is tiny on screen
  const used = new Set(g.plants.map((p) => p.s + p.v));
  for (const p of g.plants) {
    const key = p.s + p.v;
    if (!used.has(key)) continue;
    used.delete(key);
    const hi = plantSprite(p.s, p.v, SPECIES[p.s].r * 1.05 * Z0 * dpr);
    const mid = shrinkSprite(hi, Math.max(12, hi.canvas.width / 2));
    const lo = shrinkSprite(mid, Math.max(10, hi.canvas.width / 4));
    sprites.set(key, { hi, mid, lo, loPx: lo.canvas.width, midPx: mid.canvas.width });
  }
  bSprite = basketSprite(64 * dpr * vf * 1.4);
  decorSprites = {};
  for (const k of new Set(gr.decor)) decorSprites[k] = decorSprite(k, gr, 8 * Z0 * dpr);
  goatSprites = [goatSprite(GOAT_R * Z0 * dpr, 0), goatSprite(GOAT_R * Z0 * dpr, 1)];
  findSprites = {};
  for (const k of Object.keys(FIND_KINDS)) findSprites[k] = findSprite(k, FIND_R * Z0 * dpr);
  catSprites = g.cat ? [catSprite(15 * Z0 * dpr, 0), catSprite(15 * Z0 * dpr, 1)] : [];
  miniCache = {};
}

function makeDecor() {
  const rnd = mulberry32(g.seed ^ 0xA5A5);
  const n = Math.round((g.W * g.H) / 7000);
  decor = [];
  for (let i = 0; i < n; i++) decor.push({ k: gr.decor[Math.floor(rnd() * gr.decor.length)], x: rnd() * g.W, y: rnd() * g.H, s: 4 + rnd() * 5 });
  decor.sort((a, b) => a.y - b.y);
}

const spindleKey = () => SG().spindleKey(g.place, g.mode, g.seed);

function playSkeleton() {
  const box = $('.gd-play');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = `<canvas class="gd-cv" aria-label="The garden. Drag anywhere to steer the basket."></canvas>
<div class="gd-sky" aria-hidden="true"></div>
<div class="gd-basket-anchor" data-coach="garden-basket" aria-hidden="true"></div>
<div class="gd-hud">
  <button type="button" class="gd-chip" data-action="leave" aria-label="Back to the places" data-tap>&#8592;</button>
  <span class="gd-name" data-name></span>
  <div class="gd-sun" data-sun hidden aria-hidden="true">
    <svg viewBox="0 0 100 36"><path d="M6 33 A44 30 0 0 1 94 33" fill="none" stroke="rgba(42,38,34,.28)" stroke-width="2" stroke-dasharray="3 4"/><line x1="0" y1="34" x2="100" y2="34" stroke="rgba(42,38,34,.22)" stroke-width="2"/><circle data-sundot cx="6" cy="33" r="6.5" fill="#F2C14E" stroke="#FBF8F1" stroke-width="2"/></svg>
    <span data-clock>2:00</span>
  </div>
  <button type="button" class="gd-chip" data-action="sound" aria-pressed="false" aria-label="Sound is off" data-tap>&#9834; Off</button>
  <button type="button" class="gd-chip" data-action="help" aria-label="How this works" data-tap>?</button>
</div>
<div class="gd-grow" data-coach="garden-grow">
  <div class="gd-lvl" aria-hidden="true"><small>Basket</small><b data-lvln>1</b></div>
  <div class="gd-gcol">
    <div class="gd-gbar" role="progressbar" aria-label="Growth toward the next basket size" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="gd-gnext" aria-live="polite"></div>
  </div>
  <div class="gd-cnt" aria-hidden="true">0<small>plants</small></div>
  <div class="gd-goal" data-goal aria-live="polite"></div>
</div>
<div class="gd-toast" role="status" aria-live="polite"></div>
<div class="gd-lvlpop" aria-hidden="true"></div>
<div class="gd-coach">Drag anywhere to steer the basket</div>
<div class="gd-bot"><button type="button" class="btn btn-primary" data-action="home" data-tap>Head home</button></div>
<div class="gd-over gd-help" data-help hidden>
  <div class="card" role="dialog" aria-modal="true" aria-label="How this works">
    <h2>How this works</h2>
    <ol>${HOW.map((t) => `<li>${t}</li>`).join('')}</ol>
    <button type="button" class="btn btn-primary" data-action="help-ok" data-tap>Back to gathering</button>
  </div>
</div>
<div class="gd-over" data-end hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="gd-end-title">
    <h2 id="gd-end-title" data-end-title></h2>
    <p class="muted" data-end-sub style="margin:0"></p>
    <div class="gd-score" data-score hidden></div>
    <div class="gd-pays" data-pays></div>
    <ul class="gd-notes" data-notes></ul>
    <ul class="gd-haul" data-haul></ul>
    <div class="gd-fact" data-fact></div>
    <div class="gd-endbtns">
      <button type="button" class="btn btn-primary" data-action="again" data-tap>Visit again</button>
      <button type="button" class="btn btn-paper" data-action="another" data-tap>Another place</button>
    </div>
  </div>
</div>`;
  cv = box.querySelector('.gd-cv');
  ctx = cv.getContext('2d', { alpha: false });
  Object.assign(el, {
    play: box, help: box.querySelector('[data-help]'), end: box.querySelector('[data-end]'), toast: box.querySelector('.gd-toast'),
    lvlpop: box.querySelector('.gd-lvlpop'), lvlN: box.querySelector('[data-lvln]'), gfill: box.querySelector('.gd-gbar i'),
    gbar: box.querySelector('.gd-gbar'), gnext: box.querySelector('.gd-gnext'), cnt: box.querySelector('.gd-cnt'), grow: box.querySelector('.gd-grow'),
    goal: box.querySelector('[data-goal]'), sky: box.querySelector('.gd-sky'), sun: box.querySelector('[data-sun]'), sunDot: box.querySelector('[data-sundot]'),
    clock: box.querySelector('[data-clock]'), coach: box.querySelector('.gd-coach'), name: box.querySelector('[data-name]'), sound: box.querySelector('[data-action="sound"]'),
    home: box.querySelector('[data-action="home"]'), endbtns: box.querySelector('.gd-endbtns'),
  });
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('lostpointercapture', endDrag);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // A finger on the garden never scrolls or zooms the page.
  box.addEventListener('touchmove', (e) => { if (!e.target.closest('.gd-over')) e.preventDefault(); }, { passive: false });
}

function setView(v) {
  U.view = v;
  const ch = $('.gd-choose');
  const pl = $('.gd-play');
  if (ch) ch.hidden = v !== 'choose';
  if (pl) pl.hidden = v !== 'play';
}

function startVisit(placeId, modeId, seed, resume = null, opts = {}) {
  const isPath = modeId === 'path';
  if (!unlocked() || (isPath ? !LEVEL_BY_ID[placeId] : !PLACE_BY_ID[placeId])) return;
  playSkeleton();
  stop();
  if (isPath) {
    lvl = LEVEL_BY_ID[placeId];
    const sun = !!(opts.sun && lvl.dusk);
    mode = { ...MODES.path, timed: sun, secs: sun ? lvl.dusk : 0, goat: lvl.goat };
    place = { id: lvl.id, name: `${levelLabel(lvl)} · ${lvl.name}`, ground: lvl.ground, rows: lvl.rows || 0 };
    g = pathGarden(lvl.id);
  } else {
    lvl = null;
    mode = MODES[modeId] || MODES.wander;
    place = PLACE_BY_ID[placeId];
    g = gardenFor(placeId, seed, mode.id);
  }
  gr = GROUNDS[place.ground];
  visitDay = todayKey();
  visit = resume ? restoreVisit(g, resume.got) : newVisit();
  taken = new Uint8Array(g.plants.length);
  for (const i of visit.got) taken[i] = 1;
  eatenN = 0;
  grid = buildGrid(g.plants, g.W, g.H, 64);
  B.x = resume && Number.isFinite(resume.x) ? resume.x : g.start.x;
  B.y = resume && Number.isFinite(resume.y) ? resume.y : g.start.y;
  B.vx = B.vy = 0; B.r = basketRadius(g, visit.mass); B.squash = 0;
  falling = []; bits = []; recent = visit.got.slice(-8).map((i) => DYES[SPECIES[g.plants[i].s].dye].hex);
  time = 0; lastGather = 0; lastVisibleFit = 0; hint = -1; ended = false; drag = null; homing = null; result = null; errs = 0;
  // every throttle clock restarts with the visit's clock (else a long visit before froze the HUD of the next)
  growAt = 0; hintCheck = 0; sunAt = 0; comboTextAt = 0; cntPopAt = 0;
  clock = { on: mode.timed, started: false, t: 0, secs: mode.secs };
  goat = mode.goat ? newGoat(g) : null; goatAcc = 0; goatSaid = 0; goatSayUntil = 0;
  found = new Set(resume && Array.isArray(resume.found) ? resume.found.filter((k) => Number.isInteger(k) && g.finds[k]) : []);
  // a spindle already kept from this very garden stays kept; it does not show again
  const kept = safe(() => SG().hasSpindle(S(), spindleKey()));
  g.finds.forEach((f, k) => { if (f.k === 'spindle' && kept) found.add(k); });
  effects = { brim: 0, breeze: 0 };
  combo = null; comboBest = 0; toastUntil = 0; toastPrio = 0; comboText = ''; comboPop = false;
  goal = goalFor(g);
  goalHave = visit.got.filter((i) => g.plants[i].s === goal.s).length; goalMet = goalHave >= goal.need;
  landmarksGot = 0; spindleNew = false;
  fls = g.plants.map((p, i) => (p.fl ? i : -1)).filter((i) => i >= 0);
  gatesOpen = g.hedges ? g.hedges.map((h) => gateOpen(h, visit.mass)) : [];
  cat = g.cat ? { x: g.cat.x, y: g.cat.y, st: 'nap', t: 0, tx: g.cat.x, ty: g.cat.y, face: 1 } : null;
  goatHello = false; gateSaidAt = -9;
  pr = lvl ? {
    sun: mode.timed, met: false, first: false, goalAt: null, catWoke: !!(resume && resume.cw), sweep: resume ? resume.sw | 0 : 0,
    prog: null, extras: [], dirty: true, at: 0, doneBefore: !!pathDone()[lvl.id],
  } : null;
  if (pr) {
    pr.prog = pathProgress(g, lvl.goal, visit.got, pathFlags());
    // resumed with the goal already met: it was recorded then (reachGoal), so it simply shows as met
    if (pr.prog.met) { pr.met = true; pr.goalAt = 0; }
  }
  const vis = lvl ? CHAPTER_BY_ID[lvl.chapter].visual : null;
  weather = [];
  if (vis && !reduced()) {
    const wr = mulberry32(g.seed ^ 0x5EA5);
    const n = vis === 'snow' ? 26 : 14;
    const cols = vis === 'petals' ? ['#F4C6D2', '#FBF3F5', '#F2D9A8'] : vis === 'leaves' ? ['#C9853A', '#B5652E', '#D9A441', '#8E9A44'] : ['#FFFFFF'];
    for (let k = 0; k < n; k++) weather.push({ u: wr(), v: wr(), sp: 0.4 + wr() * 0.6, rot: wr() * 6.3, vr: (wr() - 0.5) * 2, c: cols[k % cols.length], s: vis === 'snow' ? 1.6 + wr() * 1.8 : 3 + wr() * 2.5, ph: wr() * 6.3, k: vis });
  }
  for (const i of visit.got) if (SPECIES[g.plants[i].s].landmark) landmarksGot++;
  lastLevel = levelInfo(g, visit.mass).level; growDirty = true; nextKey = ''; levelRing = 0; nudge = { x: 0, y: 0, t: 0 };
  movedOnce = !!resume; gatheredOnce = visit.got.length > 0; saveDue = 0;
  clearTimeout(endTimer);
  if (!mode.timed) C.game.act(SG().saveVisit, curArgs());

  setView('play');
  el.name.textContent = place.name;
  el.name.hidden = mode.timed;
  el.home.textContent = 'Head home';
  el.sun.hidden = !mode.timed;
  el.sky.style.background = 'transparent';
  el.toast.classList.remove('show', 'gold');
  el.coach.textContent = mode.timed ? 'Drag to steer. The sun rises when you start.' : 'Drag anywhere to steer the basket';
  // The first time, the guide says it (one voice at a time); after that the paper coach line does.
  const guided = !(S().onboarding && S().onboarding.seen && S().onboarding.seen.garden);
  el.coach.classList.toggle('gone', movedOnce || guided);
  el.end.hidden = true;
  el.help.hidden = true;
  renderSound();
  resize();
  cam.x = B.x; cam.y = B.y; cam.z = targetZoom();
  buildSprites();
  makeDecor();
  shown.level = 0; shown.pct = -1; shown.cnt = -1;
  updateGrow(true);
  updateGoal(false);
  updateSun(true);
  if (C.game.emit) C.game.emit('gardenStart', { placeId, mode: mode.id });
  start();
}

/** Back to the places. A Wander visit is kept for later; a harvest (or a finished visit) is banked. */
function leaveToChoose() {
  if (g && !result && (mode.timed || ended)) finishVisit(endReason());
  stop();
  persistCur();
  if (result) g = null;
  U.sub = lvl ? 'path' : 'places';
  setView('choose');
  renderChoose(true);
  const body = $('.gd-choose .screen-body');
  if (body) body.scrollTop = 0;
}

/** What saveVisit keeps: a Wander visit, or a path visit with its cat and sweep for the stars. */
function curArgs() {
  if (lvl) return { place: lvl.id, mode: 'path', seed: g.seed, got: visit.got, x: B.x, y: B.y, found: [...found], cw: !!(pr && pr.catWoke), sw: Math.max(comboBest, pr ? pr.sweep : 0) };
  return { place: g.place, seed: g.seed, got: visit.got, x: B.x, y: B.y, found: [...found] };
}
function persistCur() {
  if (!g || ended || mode.timed || result || !unlocked()) return;
  saveDue = 0;
  C.game.act(SG().saveVisit, curArgs());
}

// ---------- the Garden Path during a visit ----------
/** Star flags from this visit (stars are only stars; the sim takes them on trust). */
function pathFlags() {
  return {
    eaten: eatenN, sweep: Math.max(comboBest, pr ? pr.sweep : 0), spindle: g.finds.some((f, k) => f.k === 'spindle' && found.has(k)),
    catWoke: !!(pr && pr.catWoke), sun: !!(pr && pr.sun), beforeDusk: !!(pr && pr.met && pr.goalAt !== null),
  };
}
/** A plant's place now (floating plants drift along the stream). */
function posOf(i) {
  const p = g.plants[i];
  return p.fl ? floatPos(g, p, time) : p;
}
/** Re-check the goal and stars a few times a second while something changed. */
function pathTick() {
  if (!pr || !pr.dirty || time < pr.at) return;
  pr.dirty = false; pr.at = time + 0.15;
  const sc = pathScore(lvl, g, visit.got, pathFlags());
  pr.prog = sc.main; pr.extras = sc.extras;
  if (sc.met && !pr.met && !ended) onPathGoal();
  updateGoal(false);
}
/** Check the goal right now (before the visit ends, so a goal met in the last moment counts, before dusk too). */
function forcePathTick() {
  if (!pr) return;
  pr.dirty = true; pr.at = 0;
  const was = ended;
  ended = false;
  pathTick();
  ended = was;
}
function onPathGoal() {
  pr.met = true;
  pr.goalAt = clock.on ? clock.t : time;
  const r = C.game.act(SG().reachGoal, { levelId: lvl.id, got: visit.got, flags: pathFlags() });
  pr.first = !!(r && r.first);
  const nx = LEVELS[lvl.n];
  showToast(pr.first ? (nx ? `${levelLabel(lvl)} done! ${levelLabel(nx)} is open.` : 'The last garden on the path is done!') : 'Goal met!', true, 3.2);
  popToast();
  chime();
  if (C.haptics) safe(() => C.haptics.success());
  updateGoal(true);
}
/** A closed gate she bumps into says when it opens (now and then). */
function gateSays() {
  if (time - gateSaidAt < 4 || !g.hedges) return;
  let best = null, bd = Infinity;
  g.hedges.forEach((h, k) => { if (gatesOpen[k]) return; const d = Math.abs(B.y - h.y); if (d < bd) { bd = d; best = h; } });
  if (!best) return;
  gateSaidAt = time;
  showToast(`This gate opens at Basket ${best.level}`, false, 2);
}
function checkGates() {
  if (!g.hedges) return;
  g.hedges.forEach((h, k) => {
    if (gatesOpen[k] || !gateOpen(h, visit.mass)) return;
    gatesOpen[k] = true;
    showToast('A garden gate swings open!', true, 2.4);
    popToast();
    tick();
  });
}
function stepCat(dt) {
  if (!cat) return;
  if (cat.st === 'nap') {
    if (!ended && catWakes(cat, B.x, B.y, basketRadius(g, visit.mass))) {
      cat.st = 'stretch'; cat.t = reduced() ? 0.2 : 0.9;
      const sp = catNextSpot(g, B.x, B.y);
      cat.tx = sp.x; cat.ty = sp.y; cat.face = sp.x < cat.x ? -1 : 1;
      if (pr && !pr.catWoke) { pr.catWoke = true; pr.dirty = true; showToast('The cat wakes, stretches, and pads off to nap somewhere quieter.', false, 3); }
    }
  } else if (cat.st === 'stretch') {
    cat.t -= dt;
    if (cat.t <= 0) cat.st = 'walk';
  } else {
    const dx = cat.tx - cat.x, dy = cat.ty - cat.y, d = Math.hypot(dx, dy);
    if (d < 2) { cat.st = 'nap'; cat.x = cat.tx; cat.y = cat.ty; return; }
    const v = Math.min(d, 52 * dt);
    cat.x += (dx / d) * v; cat.y += (dy / d) * v;
  }
}

// ---------- HUD ----------
const shown = { level: 0, pct: -1, cnt: -1 };
/** The growth bar: basket level, progress to the next size step, the next plant below it. */
function updateGrow(force) {
  if (!force && !growDirty) return;
  growDirty = false;
  const info = levelInfo(g, visit.mass);
  const pct = Math.round(info.progress * 100);
  if (force || info.level !== shown.level) { el.lvlN.textContent = String(info.level); shown.level = info.level; }
  if (force || pct !== shown.pct) { el.gfill.style.setProperty('--p', (pct / 100).toFixed(2)); el.gbar.setAttribute('aria-valuenow', String(pct)); shown.pct = pct; }
  const left = g.plants.length - visit.got.length - eatenN;
  const key = info.next ? info.next[0] : left ? 'all' : 'full';
  if (key !== nextKey || force) {
    nextKey = key;
    if (info.next) el.gnext.innerHTML = `${miniSprite(info.next[0])}<span>Next: <b>${SPECIES[info.next[0]].name}</b></span>`;
    else el.gnext.innerHTML = left ? '<span>Everything fits now</span>' : '<span>The garden is gathered</span>';
  }
  if (force || shown.cnt !== visit.got.length) { el.cnt.firstChild.nodeValue = String(visit.got.length); shown.cnt = visit.got.length; }
}
function popCount() {
  if (reduced() || time - cntPopAt < 0.35) return;
  cntPopAt = time;
  el.cnt.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
}
function miniSprite(s) {
  const e = sprites.get(s + 0) || sprites.get(s + 1) || sprites.get(s + 2);
  if (!e) return '';
  // a tiny canvas copy, drawn into an <img> so innerHTML stays simple
  if (!miniCache[s]) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    c.getContext('2d').drawImage(e.hi.canvas, 0, 0, 48, 48);
    miniCache[s] = c.toDataURL();
  }
  return `<img src="${miniCache[s]}" width="20" height="20" alt="">`;
}
const jarsFrac = (u) => { const j = Math.floor((u / 24) * 2) / 2; return j === Math.floor(j) ? String(j) : `${Math.floor(j) || ''}½`; };
function pathGoalCount() {
  const pg = pr.prog || { have: 0, need: 1 };
  switch (lvl.goal.t) {
    case 'jars': return `${jarsFrac(pg.have)}/${pg.need / 24} jars`;
    case 'landmark': return '';
    case 'level': return `Basket ${pg.have}/${pg.need}`;
    default: return `${pg.have}/${pg.need}`;
  }
}
function updatePathGoal(fresh) {
  const cnt = pathGoalCount();
  el.goal.classList.toggle('met', pr.met);
  if (!pr.met) {
    el.goal.innerHTML = `<span>Goal: ${esc(goalText(lvl.goal, lvl))}${cnt ? ` · <b>${cnt}</b>` : ''}</span>`;
  } else {
    const nextStar = (pr.extras || []).find((e) => !e.met);
    el.goal.innerHTML = `<span class="tick" aria-hidden="true">&#10003;</span><span>${levelLabel(lvl)} done! ${nextStar ? `Star: ${esc(nextStar.text)} <b>${nextStar.goal.t === 'cat' || nextStar.goal.t === 'spindle' || nextStar.goal.t === 'dusk' || nextStar.goal.t === 'landmark' ? '' : `${nextStar.have}/${nextStar.need}`}</b>` : 'Every star is yours.'}</span>`;
  }
  if (fresh && !reduced()) el.goal.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 300 });
}
function updateGoal(fresh) {
  if (lvl && pr) { updatePathGoal(fresh); return; }
  const t = `${goalHave}/${goal.need}`;
  el.goal.classList.toggle('met', goalMet);
  el.goal.innerHTML = goalMet
    ? `<span class="tick" aria-hidden="true">&#10003;</span><span>Enough for ${DYES[goal.dye].name.toLowerCase()}! <b>${t}</b></span>`
    : `<span>Bonus: enough for ${DYES[goal.dye].name.toLowerCase()}, <b>${t}</b> ${SPECIES[goal.s].many}</span>`;
  if (fresh && !reduced()) el.goal.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 300 });
}
function showToast(text, prio, secs) {
  if (!prio && toastPrio && time < toastUntil) return false;
  const changed = el.toast.textContent !== text;
  el.toast.textContent = text;
  el.toast.classList.toggle('gold', !!prio);
  el.toast.classList.add('show');
  toastUntil = time + secs; toastPrio = prio ? 1 : 0;
  return changed;
}
function popToast() {
  if (reduced()) return;
  el.toast.animate([{ transform: 'translateX(-50%) scale(1.14)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 240, easing: 'ease-out' });
}
function levelUp(n) {
  el.lvlpop.textContent = `Basket ${n}!`;
  const rm = reduced();
  el.lvlpop.animate(rm
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
    : [{ opacity: 0, transform: 'translateX(-50%) translateY(10px) scale(.8)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1.1)', offset: 0.25 }, { opacity: 1, transform: 'translateX(-50%) translateY(-6px) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translateX(-50%) translateY(-16px) scale(1)' }],
  { duration: rm ? 1000 : 1100, easing: 'ease-out' });
  el.grow.classList.add('up');
  setTimeout(() => el.grow.classList.remove('up'), 700);
  if (!rm) { B.squash = 1.8; levelRing = time; }
  chime();
}
let sunAt = 0;
function updateSun(force) {
  if (!clock.on) return;
  if (!force && time - sunAt < 0.2) return;
  sunAt = time;
  const u = clock.t / clock.secs;
  const s = skyAt(u);
  el.sunDot.setAttribute('cx', (6 + 88 * s.sx).toFixed(1));
  el.sunDot.setAttribute('cy', (33 - 28 * (1 - s.sy)).toFixed(1));
  el.sunDot.setAttribute('fill', s.dusk > 0 ? '#E8875A' : s.gold > 0.3 ? '#F0A844' : '#F2C14E');
  el.clock.textContent = clockLabel(clock.secs - clock.t);
  const goldA = (0.16 * s.gold * (1 - s.dusk)).toFixed(3), duskA = (0.3 * s.dusk).toFixed(3);
  el.sky.style.background = s.gold || s.dusk ? `linear-gradient(rgba(64,44,104,${duskA}), rgba(64,44,104,${duskA})), rgba(255,176,64,${goldA})` : 'transparent';
}

// ---------- input ----------
function toScreen(x, y) { return { x: (x - cam.x) * cam.z + vw / 2, y: (y - cam.y) * cam.z + vh / 2 }; }
function moved() { if (!movedOnce) { movedOnce = true; el.coach.classList.add('gone'); } }
function onPointerDown(e) {
  if (drag || ended) return;
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  const px = e.clientX - ox, py = e.clientY - oy;
  const bs = toScreen(B.x, B.y);
  const near = Math.hypot(px - bs.x, py - bs.y) < B.r * cam.z * 1.15 + 26;
  drag = { id: e.pointerId, ax: px, ay: py, x: px, y: py, carry: near };
  ensureAudio();
}
function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  e.preventDefault();
  drag.x = e.clientX - ox; drag.y = e.clientY - oy;
  if (Math.hypot(drag.x - drag.ax, drag.y - drag.ay) > 12) moved();
}
function endDrag(e) { if (drag && e.pointerId === drag.id) drag = null; }
function onKeyDown(e) {
  if (!running || !U.visible || U.view !== 'play' || !e.key.startsWith('Arrow')) return;
  keys.add(e.key); e.preventDefault();
  moved();
}
function onKeyUp(e) { keys.delete(e.key); }
function onBlur() { keys.clear(); drag = null; }

// ---------- sound (off by default; through ctx.audio, so the game's sound setting still rules) ----------
let lastPluck = 0;
const soundOn = () => !!(gstate().settings && gstate().settings.sound);
const sfx = () => (soundOn() && C.audio ? C.audio : null);
function ensureAudio() { if (soundOn() && C.audio && C.audio.unlock) safe(() => C.audio.unlock()); }
// a pentatonic ladder: each pluck in a sweep climbs a step
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
function pluck(r, kind, n) {
  const a = sfx();
  if (!a) return;
  const now = performance.now();
  if (now - lastPluck < 45 && !kind) return;
  lastPluck = now;
  const base = 330 * Math.pow(8 / r, 0.25);
  safe(() => {
    if (kind === 'land') [0, 4, 7, 12, 16].forEach((s, k) => a.tink(base * Math.pow(2, s / 12), k * 0.11, 0.24));
    else if (kind === 'grand') [0, 7, 12].forEach((s, k) => a.tink(base * Math.pow(2, s / 12), k * 0.09, 0.24));
    else a.tink(base * Math.pow(2, LADDER[Math.min(LADDER.length - 1, Math.max(0, n - 1))] / 12), 0, 0.2);
  });
}
function chime() { const a = sfx(); if (a) safe(() => a.bell()); }
function tick() { const a = sfx(); if (a) safe(() => { a.tink(1320, 0, 0.14); a.tink(1760, 0.07, 0.11); }); }
function shimmer() { const a = sfx(); if (a) safe(() => [1047, 1319, 1568, 2093].forEach((f, k) => a.tink(f, k * 0.05, 0.09))); }
function duskSound() { const a = sfx(); if (a) safe(() => a.evening()); }
function bestSound() { const a = sfx(); if (a) safe(() => a.motif()); }
function renderSound() {
  const b = el.sound;
  if (!b) return;
  const on = soundOn();
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = on ? '&#9834; On' : '&#9834; Off';
  b.setAttribute('aria-label', on ? 'Sound is on' : 'Sound is off');
}

// ---------- loop ----------
function start() {
  if (running || (typeof document !== 'undefined' && document.hidden) || !U.visible) return;
  running = true; lastT = 0;
  raf = requestAnimationFrame(frame);
}
function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame); // schedule first: an exception below cannot stop the loop
  const t0 = performance.now();
  try {
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    if (lastT) { frameDt.push(now - lastT); if (frameDt.length > 1200) frameDt.shift(); adapt(now - lastT); }
    lastT = now;
    for (let k = 0; k < speed && running; k++) step(dt);
    if (running) draw();
  } catch (err) {
    errs++;
    console.error('garden frame', err);
    if (errs > 30) { stop(); el.coach.textContent = 'The garden needs a moment. Tap Head home to keep your jars.'; el.coach.classList.remove('gone'); }
  }
  frameWork.push(performance.now() - t0); if (frameWork.length > 1200) frameWork.shift();
}
function onVisibility() {
  if (document.hidden) { stop(); persistCur(); drag = null; }
  else if (g && U.visible && U.view === 'play' && el.end.hidden) start();
}

const targetZoom = () => Z0 * Math.pow(R0 / basketRadius(g, visit.mass), 0.6);
const openNow = () => (time < effects.brim ? OPENING * FIND_KINDS.brim.open : OPENING);

const stepBuf = [], stepBuf2 = [];
function step(dt) {
  time += dt;
  const paused = !el.help.hidden;
  // the clock: starts with her first move, pauses while help is open
  if (clock.on && !ended && !paused) {
    if (!clock.started && movedOnce) {
      clock.started = true;
      if (goat) showToast("The neighbor's goat is in the garden too!", true, 2.6);
    }
    if (clock.started) { clock.t += dt; if (clock.t >= clock.secs) { clock.t = clock.secs; dusk(); } }
  }
  if (clock.on) updateSun(false);

  // steering
  const vmax = 300 / cam.z;
  let dx = 0, dy = 0, k = 0;
  if (homing) {
    homing.t += dt;
    const hx = g.W / 2 - B.x, hy = g.H - 20 - B.y, d = Math.hypot(hx, hy) || 1;
    dx = hx / d; dy = hy / d; k = Math.min(0.7, d / 60);
    if (homing.t >= homing.D) { homing = null; showEnd('dusk'); return; }
  } else if (drag && !ended) {
    let mx, my;
    if (drag.carry) { const bs = toScreen(B.x, B.y); mx = drag.x - bs.x; my = drag.y - bs.y; } else {
      mx = drag.x - drag.ax; my = drag.y - drag.ay;
      const d = Math.hypot(mx, my);
      if (d > 84) { drag.ax = drag.x - (mx / d) * 84; drag.ay = drag.y - (my / d) * 84; mx = (mx / d) * 84; my = (my / d) * 84; }
    }
    const d = Math.hypot(mx, my);
    if (d > 3) { dx = mx / d; dy = my / d; k = Math.min(1, (d - 3) / (drag.carry ? 70 : 56)); }
  } else if (auto && !ended) {
    if (time > auto.next || auto.i < 0 || taken[auto.i]) { auto.i = lvl ? nearestFit(g, visit.mass, taken, B.x, B.y, time) : nearestGatherable(g, visit, B.x, B.y, taken); auto.next = time + 0.25; }
    if (auto.i >= 0) {
      const q = posOf(auto.i);
      const p = lvl ? steerPoint(g, visit.mass, B.x, B.y, q.x, q.y) : q;
      const ax = p.x - B.x, ay = p.y - B.y, d = Math.hypot(ax, ay) || 1; dx = ax / d; dy = ay / d; k = Math.min(1, d * cam.z / 40);
    }
  } else if (keys.size && !ended) {
    dx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    dy = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; k = 1;
  }
  const ease = 1 - Math.exp(-dt * 9);
  B.vx += (dx * k * vmax - B.vx) * ease;
  B.vy += (dy * k * vmax - B.vy) * ease;
  const px0 = B.x, py0 = B.y;
  B.x += B.vx * dt; B.y += B.vy * dt;
  const br = basketRadius(g, visit.mass);
  const m = Math.min(br * 0.7, 30);
  if (B.x < m) { B.x = m; B.vx = 0; } if (B.x > g.W - m) { B.x = g.W - m; B.vx = 0; }
  if (B.y < m) { B.y = m; B.vy = 0; } if (B.y > g.H - m) { B.y = g.H - m; B.vy = 0; }
  if (g.hedges && !homing) {
    // a hedge stops the basket, except through an open gate
    const mv = hedgeStep(g, px0, py0, B.x, B.y, visit.mass);
    if (mv.blocked) { B.y = mv.y; B.vy = 0; if (drag || keys.size) gateSays(); }
  }

  if (!ended) {
    const open = openNow();
    // gathering: anything that fits and sits over the opening tips in
    const near = queryGrid(grid, B.x - br - grid.cell, B.y - br - grid.cell, B.x + br + grid.cell, B.y + br + grid.cell, stepBuf);
    for (let n = 0; n < near.length && !ended; n++) {
      const i = near[n];
      if (taken[i]) continue;
      const p = g.plants[i];
      if (p.need && visit.mass < p.need) continue; // behind a closed gate
      if (fits(g, p, visit.mass, open) && over(B.x, B.y, basketRadius(g, visit.mass), p)) onGather(i, open, '');
    }
    // floating plants: wherever the stream has carried them
    for (let n = 0; n < fls.length && !ended; n++) {
      const i = fls[n];
      if (taken[i] || !fits(g, g.plants[i], visit.mass, open)) continue;
      const q = floatPos(g, g.plants[i], time), rr = basketRadius(g, visit.mass);
      if ((q.x - B.x) ** 2 + (q.y - B.y) ** 2 <= rr * rr) onGather(i, open, 'float', q);
    }
    // a breeze draws little plants in from around the basket
    if (time < effects.breeze && !ended) {
      const Rr = basketRadius(g, visit.mass) * FIND_KINDS.breeze.reach + 16;
      const list = queryGrid(grid, B.x - Rr, B.y - Rr, B.x + Rr, B.y + Rr, stepBuf2);
      let pulled = 0;
      for (let n = 0; n < list.length && pulled < 4 && !ended; n++) {
        const i = list[n];
        if (taken[i]) continue;
        if (breezeCatches(g, g.plants[i], visit.mass, B.x, B.y, open)) { onGather(i, open, 'breeze'); pulled++; }
      }
    }
    // finds
    const fk = findAt(g, found, B.x, B.y, B.r);
    if (fk >= 0) onFind(fk);
    // the goat, on a fixed tick so it behaves the same every time
    if (goat && !clock.on && movedOnce && !goatHello) { goatHello = true; showToast("The neighbor's goat is in the garden too!", true, 2.6); }
    if (goat && (clock.started || (!clock.on && movedOnce)) && !paused && !ended) {
      goatAcc = Math.min(goatAcc + dt, GOAT.dt * 4);
      while (goatAcc >= GOAT.dt) {
        goatAcc -= GOAT.dt;
        const e = goatStep(g, goat, taken, grid, { x: B.x, y: B.y, r: basketRadius(g, visit.mass) });
        if (e >= 0) onGoatEat(e);
      }
      if (goat.startled !== goatSaid) { goatSaid = goat.startled; goatSayUntil = time + 0.9; }
    }
  }
  if (cat && !paused) stepCat(dt);
  if (weather.length) for (const w of weather) { w.rot += w.vr * dt; w.ph += dt; }

  // easing: basket size, camera, zoom
  B.r += (basketRadius(g, visit.mass) - B.r) * (1 - Math.exp(-dt * 5));
  B.squash = Math.max(0, B.squash - dt * 4);
  const ce = 1 - Math.exp(-dt * 5);
  cam.x += (B.x + B.vx * 0.25 - cam.x) * ce;
  cam.y += (B.y + B.vy * 0.25 - cam.y) * ce;
  cam.z += (targetZoom() - cam.z) * (1 - Math.exp(-dt * 1.6));
  const hw = vw / 2 / cam.z, hh = vh / 2 / cam.z;
  // margins in screen pixels, so the field's edges can always come clear of the top HUD and Head home
  const mx = 40 / cam.z, mt = 170 / cam.z, mb = 90 / cam.z;
  cam.x = g.W > 2 * hw - 2 * mx ? Math.max(hw - mx, Math.min(g.W - hw + mx, cam.x)) : g.W / 2;
  cam.y = g.H > 2 * hh - mt - mb ? Math.max(hh - mt, Math.min(g.H - hh + mb, cam.y)) : (g.H + mb - mt) / 2;
  nudge.t = Math.max(0, nudge.t - dt);

  for (const f of falling) f.t += dt;
  if (falling.length && falling.some((f) => f.t > f.D)) falling = falling.filter((f) => f.t <= f.D);
  if (bits.length) {
    for (const b of bits) b.t += dt;
    if (bits.some((b) => b.t > b.L)) bits = bits.filter((b) => b.t <= b.L);
  }

  // toasts: a sweep stays up while it lasts
  if (combo && comboOpen(combo, time) && combo.n >= 5) toastUntil = Math.max(toastUntil, time + 0.2);
  if (toastUntil && time > toastUntil) { toastUntil = 0; toastPrio = 0; el.toast.classList.remove('show'); }

  // hints: a soft glow on the nearest plant that fits, after a quiet spell
  if (time > hintCheck) {
    hintCheck = time + 0.5;
    const quiet = time - Math.max(lastGather, 0) > 5 || time - lastVisibleFit > 2.5;
    hint = quiet && !ended ? (lvl ? nearestFit(g, visit.mass, taken, B.x, B.y, time) : nearestGatherable(g, visit, B.x, B.y, taken)) : -1;
  }
  if (pr) pathTick();
  if (time > growAt) { growAt = time + 0.12; updateGrow(false); }
  if (comboText && time > comboTextAt) { comboTextAt = time + 0.15; const t = comboText; comboText = ''; if (showToast(t, false, 1.1) && comboPop) popToast(); comboPop = false; }
  if (time > saveDue && saveDue) { saveDue = 0; persistCur(); }
}

function onGather(i, open, how, pos = null) {
  const p = g.plants[i];
  const before = visit.got.length;
  visit = gather(g, visit, i, open);
  if (visit.got.length === before) return;
  taken[i] = 1;
  const sp = SPECIES[p.s];
  const big = sp.landmark || sp.grand;
  const rm = reduced();
  const at = pos || p;
  falling.push({ i, t: 0, dir: at.x < B.x ? 1 : -1, kind: sp.landmark ? 'land' : sp.grand ? 'grand' : how === 'breeze' ? 'breeze' : 'plain', D: rm ? 0.22 : sp.landmark ? 1.3 : sp.grand ? 0.95 : how === 'breeze' ? 0.6 : 0.5, x0: at.x, y0: at.y });
  lastGather = time; hint = -1;
  recent.push(DYES[sp.dye].hex); if (recent.length > 8) recent.shift();
  B.squash = Math.max(B.squash, big ? 1.8 : 1);
  combo = comboAdd(combo, time, p.s);
  comboBest = Math.max(comboBest, combo.n);
  pluck(p.r, sp.landmark ? 'land' : sp.grand ? 'grand' : '', combo.n);
  if (!rm) {
    spawnBits(p, sp.landmark ? 30 : sp.grand ? 16 : 2, at);
    if (big) { const d = Math.hypot(B.x - p.x, B.y - p.y) || 1; const a = sp.landmark ? 7 : 4; nudge = { x: (B.x - p.x) / d * a, y: (B.y - p.y) / d * a, t: 0.4, D: 0.4 }; }
  }
  if (sp.landmark) { landmarksGot++; showToast(`${cap(sp.the)} tumbles in!`, true, 2.8); popToast(); if (C.haptics) safe(() => C.haptics.medium()); } else if (sp.grand) { showToast(`${sp.name}, all of it!`, true, 2.2); popToast(); } else if (combo.n >= 5) {
    // the sweep line updates a few times a second, not on every pluck
    comboText = comboLabel(combo);
    if (combo.n === 5 || combo.n % 10 === 0) comboPop = true;
  }
  if (lvl) { pr.dirty = true; checkGates(); } else if (!goalMet && p.s === goal.s) {
    goalHave++;
    if (goalHave >= goal.need) { goalMet = true; tick(); showToast(`Enough for ${DYES[goal.dye].name.toLowerCase()}!`, true, 2.2); }
    updateGoal(goalMet);
  }
  const info = levelInfo(g, visit.mass);
  if (info.level > lastLevel) { lastLevel = info.level; levelUp(info.level); }
  growDirty = true; popCount();
  if (!gatheredOnce) { gatheredOnce = true; if (C.game.emit) C.game.emit('gardenGather', {}); }
  if (!saveDue && !mode.timed) saveDue = time + 1.5;
  if (isDone(g, visit, eatenN)) finishSoon();
}
function onGoatEat(i) {
  taken[i] = 2; eatenN++;
  if (pr) pr.dirty = true;
  falling.push({ i, t: 0, dir: 1, kind: 'goat', D: reduced() ? 0.2 : 0.5, gx: goat.x + goat.face * 9, gy: goat.y - 3 });
  growDirty = true;
  if (isDone(g, visit, eatenN)) finishSoon();
}
function finishSoon() {
  if (ended) return;
  forcePathTick();
  ended = true; drag = null;
  endTimer = setTimeout(() => { if (g && !result) showEnd(eatenN ? 'cleared' : 'done'); }, reduced() ? 300 : 1400);
}
function dusk() {
  if (ended) return;
  forcePathTick();
  ended = true; drag = null;
  homing = { t: 0, D: reduced() ? 0.6 : 1.8 };
  showToast('Dusk. The basket heads home.', true, 3);
  duskSound();
}
function onFind(k) {
  found.add(k);
  const f = g.finds[k], kind = FIND_KINDS[f.k];
  if (f.k === 'brim') effects.brim = time + kind.secs;
  if (f.k === 'breeze') effects.breeze = time + kind.secs;
  let text = kind.text;
  if (f.k === 'spindle') {
    const res = C.game.act(SG().keepSpindle, { key: spindleKey() });
    if (res && res.isNew) spindleNew = true;
    text = `You found a lost spindle! (${(res && res.count) || gstate().spindles || 1} kept)`;
  }
  showToast(text, true, 2.6); popToast();
  shimmer();
  if (!reduced()) spawnSparkle(f.x, f.y);
  saveDue = saveDue || time + 1;
}

// ---------- little bits that pop up and fall in ----------
function spawnBits(p, n, at = p) {
  const c = DYES[SPECIES[p.s].dye].hex;
  for (let k = 0; k < n && bits.length < 160; k++) {
    const a = Math.random() * Math.PI * 2, s = p.r * (0.2 + Math.random() * 0.6);
    bits.push({ x0: at.x + Math.cos(a) * s, y0: at.y + Math.sin(a) * s, t: 0, L: 0.45 + Math.random() * 0.35, h: p.r * (0.5 + Math.random() * 0.9), c: k % 3 === 2 ? '#7E9A58' : c, s: Math.max(1.5, p.r * 0.12) });
  }
}
function spawnSparkle(x, y) {
  for (let k = 0; k < 14 && bits.length < 160; k++) {
    const a = (k / 14) * Math.PI * 2;
    bits.push({ x0: x + Math.cos(a) * 12, y0: y + Math.sin(a) * 12, t: 0, L: 0.6, h: 14, c: k % 2 ? '#FFF2C4' : '#E2B04A', s: 2.2 });
  }
}

// ---------- drawing ----------
function lowerBound(arr, y) { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].y < y) lo = mid + 1; else hi = mid; } return lo; }
const drawList = [], lateList = [];

function draw() {
  const z = cam.z;
  const rm = reduced();
  let sx = 0, sy = 0;
  if (nudge.t > 0 && !rm) { const k = nudge.t / nudge.D; sx = nudge.x * k * Math.cos((1 - k) * 9); sy = nudge.y * k * Math.cos((1 - k) * 9); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // one full-screen fill (the field color); the outside only where it shows. Fill area is the main raster cost on phones.
  ctx.fillStyle = gr.base; ctx.fillRect(0, 0, vw, vh);
  const s = dpr * z;
  ctx.setTransform(s, 0, 0, s, dpr * (vw / 2 - cam.x * z + sx), dpr * (vh / 2 - cam.y * z + sy));
  const x0 = cam.x - vw / 2 / z, x1 = cam.x + vw / 2 / z, y0 = cam.y - vh / 2 / z, y1 = cam.y + vh / 2 / z;

  // ground
  ctx.fillStyle = gr.out;
  if (x0 < 0) ctx.fillRect(x0 - 2, y0 - 2, -x0 + 2, y1 - y0 + 4);
  if (x1 > g.W) ctx.fillRect(g.W, y0 - 2, x1 - g.W + 2, y1 - y0 + 4);
  if (y0 < 0) ctx.fillRect(Math.max(0, x0), y0 - 2, Math.min(g.W, x1) - Math.max(0, x0), -y0 + 2);
  if (y1 > g.H) ctx.fillRect(Math.max(0, x0), g.H, Math.min(g.W, x1) - Math.max(0, x0), y1 - g.H + 2);
  if (place.ground === 'terraces') {
    const band = place.rows;
    for (let k = Math.max(0, Math.floor(y0 / band)); k * band < Math.min(g.H, y1); k++) {
      if (k % 2) { ctx.fillStyle = gr.band; ctx.fillRect(Math.max(0, x0), k * band, Math.min(g.W, x1) - Math.max(0, x0), band); }
      ctx.fillStyle = 'rgba(42,38,34,.14)'; ctx.fillRect(Math.max(0, x0), k * band + 4, Math.min(g.W, x1) - Math.max(0, x0), 6);
      ctx.fillStyle = gr.wall; ctx.fillRect(Math.max(0, x0), k * band, Math.min(g.W, x1) - Math.max(0, x0), 6);
    }
  } else if (place.ground === 'shore') {
    ctx.fillStyle = '#D9C9A0'; ctx.fillRect(g.W - 70, Math.max(0, y0), 70, Math.min(g.H, y1) - Math.max(0, y0));
    ctx.fillStyle = '#F4EFE4';
    for (let y = Math.max(0, Math.floor(y0 / 40) * 40); y < Math.min(g.H, y1 + 40); y += 40) {
      ctx.beginPath(); ctx.ellipse(g.W + 2, y + 20, 7, 18, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = gr.rocks; ctx.fillRect(0, Math.max(0, y0), g.W * 0.12, Math.min(g.H, y1) - Math.max(0, y0));
  }
  ctx.strokeStyle = gr.edge; ctx.lineWidth = 6; ctx.strokeRect(-3, -3, g.W + 6, g.H + 6);
  if (g.stream) drawStream(x0, x1, y0, y1);
  // decor is skipped when it is only a speck on screen
  if (z * 8 > 5) {
    for (let i = lowerBound(decor, y0 - 10); i < decor.length && decor[i].y < y1 + 10; i++) {
      const d = decor[i];
      if (d.x < x0 - 10 || d.x > x1 + 10) continue;
      ctx.drawImage(decorSprites[d.k], d.x - d.s, d.y - d.s, d.s * 2, d.s * 2);
    }
  }

  if (g.hedges) drawHedges(x0, x1, y0, y1);
  // floating plants ride the stream (drawn on the water, under everything else)
  for (let n = 0; n < fls.length; n++) {
    const i = fls[n];
    if (taken[i]) continue;
    const p = g.plants[i], q = floatPos(g, p, time);
    if (q.x < x0 - 20 || q.x > x1 + 20 || q.y < y0 - 20 || q.y > y1 + 20) continue;
    drawPlantRot(p, q.x, q.y + (rm ? 0 : Math.sin(time * 2 + i) * 0.8), rm ? 0 : Math.sin(time * 0.9 + i) * 0.3, 1);
  }

  // finds: sparkles on the ground
  for (let k = 0; k < g.finds.length; k++) {
    if (found.has(k)) continue;
    const f = g.finds[k];
    if (f.x < x0 - 20 || f.x > x1 + 20 || f.y < y0 - 20 || f.y > y1 + 20) continue;
    const tw = rm ? 1 : 1 + 0.1 * Math.sin(time * 3 + k * 1.7);
    const hh = FIND_R * tw;
    ctx.drawImage(findSprites[f.k], f.x - hh, f.y - hh, hh * 2, hh * 2);
  }

  // plants: those that fit, then the basket, then the ones still too big (the basket slides under them)
  const open = openNow();
  const lim = open * basketRadius(g, visit.mass);
  const pad = grid.maxR * 1.4;
  drawList.length = 0; lateList.length = 0;
  let visibleFit = false;
  for (let i = lowerBound(g.plants, y0 - pad); i < g.plants.length; i++) {
    const p = g.plants[i];
    if (p.y > y1 + pad) break;
    if (taken[i] || p.fl) continue;
    const pr = p.r * PAD;
    if (p.x + pr < x0 || p.x - pr > x1 || p.y + pr < y0 || p.y - pr > y1) continue;
    if (p.r <= lim) { drawList.push(i); if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) visibleFit = true; } else lateList.push(i);
  }
  if (visibleFit) lastVisibleFit = time;
  for (const i of drawList) drawPlant(g.plants[i], 1);
  drawBasket();
  for (const f of falling) drawFalling(f);
  if (goat) drawGoat(x0, x1, y0, y1);
  if (cat) drawCat(x0, x1, y0, y1);
  for (const i of lateList) {
    const p = g.plants[i];
    const d = Math.hypot(p.x - B.x, p.y - B.y);
    if (p.r <= lim * TEETER && d < B.r * 0.95) {
      // a little too big: it wobbles on the rim until the basket grows enough
      const rot = rm ? 0.06 : Math.sin(time * 11 + i) * 0.14;
      const lift = rm ? 0 : Math.abs(Math.sin(time * 11 + i)) * p.r * 0.06;
      drawPlantRot(p, p.x, p.y - lift, rot, 1);
    } else drawPlant(p, d < p.r + B.r ? 0.55 : 1);
  }

  // bits popping into the basket
  for (const b of bits) {
    const u = b.t / b.L, e = u * u;
    const x = b.x0 + (B.x - b.x0) * e, y = b.y0 + (B.y - b.y0) * e - Math.sin(u * Math.PI) * b.h;
    ctx.fillStyle = b.c;
    ctx.fillRect(x - b.s / 2, y - b.s / 2, b.s, b.s);
  }

  // power-up rings around the basket
  if (time < effects.brim) {
    const left = effects.brim - time;
    ctx.globalAlpha = left < 2 && !rm ? 0.5 + 0.5 * Math.sin(time * 14) : 0.85;
    ctx.beginPath(); ctx.arc(B.x, B.y, B.r * 1.1, 0, Math.PI * 2);
    ctx.lineWidth = B.r * 0.13; ctx.strokeStyle = '#E2B04A'; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (time < effects.breeze) {
    const Rr = basketRadius(g, visit.mass) * FIND_KINDS.breeze.reach + 16;
    ctx.lineWidth = 2.2 / z; ctx.strokeStyle = 'rgba(240,248,250,.75)';
    const rot = rm ? 0 : time * 2.2;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(B.x, B.y, Rr * (0.55 + k * 0.2), rot + k * 2.1, rot + k * 2.1 + 1.3); ctx.stroke(); }
  }
  if (levelRing && time - levelRing < 0.6) {
    const u = (time - levelRing) / 0.6;
    ctx.globalAlpha = 1 - u;
    ctx.beginPath(); ctx.arc(B.x, B.y, B.r * (1.05 + 0.5 * u), 0, Math.PI * 2);
    ctx.lineWidth = 4 / z; ctx.strokeStyle = '#FFF2C4'; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // hint glow and an edge arrow when the plant is off screen
  if (hint >= 0 && !taken[hint]) {
    const p0 = g.plants[hint], q0 = posOf(hint);
    const p = p0.fl ? { x: q0.x, y: q0.y, r: p0.r } : p0;
    const pulse = rm ? 0.6 : 0.5 + 0.5 * Math.sin(time * 4);
    const onScreen = p.x > x0 && p.x < x1 && p.y > y0 + 130 / z && p.y < y1 - 70 / z;
    if (onScreen) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.25 + 0.12 * pulse), 0, Math.PI * 2);
      ctx.lineWidth = 3 / z; ctx.strokeStyle = `rgba(226,176,74,${0.55 + 0.4 * pulse})`; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.25, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,236,170,${0.18 + 0.12 * pulse})`; ctx.fill();
    } else drawArrow(p, pulse);
  }

  // a soft ring where her thumb steers from
  if (drag && !drag.carry) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath(); ctx.arc(drag.ax, drag.ay, 30, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(251,248,241,.7)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(drag.x, drag.y, 12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(251,248,241,.55)'; ctx.fill();
  }
  if (weather.length) drawWeather();
}

// ---------- the Garden Path's things on the ground ----------
function drawStream(x0, x1, y0, y1) {
  const st = g.stream;
  const a = Math.max(-4, x0 - 10), b = Math.min(g.W + 4, x1 + 10);
  if (st.y + st.amp + st.w < y0 || st.y - st.amp - st.w > y1 || a >= b) return;
  const top = [], bot = [];
  for (let x = a; ; x += 14) { const xx = Math.min(x, b); const y = streamY(st, xx); top.push(xx, y - st.w); bot.push(xx, y + st.w); if (xx >= b) break; }
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  for (let k = 2; k < top.length; k += 2) ctx.lineTo(top[k], top[k + 1]);
  for (let k = bot.length - 2; k >= 0; k -= 2) ctx.lineTo(bot[k], bot[k + 1]);
  ctx.closePath();
  ctx.fillStyle = '#C7B48C'; ctx.save(); ctx.translate(0, 3); ctx.fill(); ctx.restore(); // the bank
  ctx.fillStyle = gr.water || '#8DBCC8'; ctx.fill();
  // ripples drifting downstream
  ctx.strokeStyle = 'rgba(244,250,250,.6)'; ctx.lineWidth = 1.6;
  const off = reduced() ? 0 : (time * st.v) % 60;
  ctx.beginPath();
  for (let x = Math.floor((a - off) / 60) * 60 + off; x < b; x += 60) {
    for (const dy of [-0.45, 0.4]) { const y = streamY(st, x) + st.w * dy; ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 7, y - 3, x + 14, y); }
  }
  ctx.stroke();
}
function drawHedges(x0, x1, y0, y1) {
  const a = Math.max(0, x0 - 10), b = Math.min(g.W, x1 + 10);
  g.hedges.forEach((h, k) => {
    if (h.y < y0 - 30 || h.y > y1 + 30) return;
    const open = gatesOpen[k], gx = h.x, gap = h.gap;
    // the hedge: a dark band with leafy bumps, broken by the gateway
    for (const [s0, s1] of [[a, Math.min(b, gx - gap)], [Math.max(a, gx + gap), b]]) {
      if (s1 <= s0) continue;
      ctx.fillStyle = 'rgba(42,38,34,.16)'; ctx.fillRect(s0, h.y - 7, s1 - s0, 16);
      ctx.fillStyle = '#5C7A40'; ctx.fillRect(s0, h.y - 9, s1 - s0, 16);
      ctx.fillStyle = '#6E8F4E';
      ctx.beginPath();
      for (let x = Math.floor(s0 / 13) * 13 + 6; x < s1; x += 13) { ctx.moveTo(x + 8, h.y - 4); ctx.arc(x, h.y - 4, 8, 0, Math.PI * 2); }
      ctx.fill();
    }
    // gateposts and the gate
    ctx.fillStyle = '#7A5530';
    ctx.fillRect(gx - gap - 4, h.y - 14, 8, 22); ctx.fillRect(gx + gap - 4, h.y - 14, 8, 22);
    if (!open) {
      ctx.fillStyle = '#B88550'; ctx.fillRect(gx - gap + 4, h.y - 8, gap * 2 - 8, 5); ctx.fillRect(gx - gap + 4, h.y + 1, gap * 2 - 8, 5);
      ctx.fillStyle = '#9A6C3A';
      for (let x = gx - gap + 10; x < gx + gap - 6; x += 14) ctx.fillRect(x, h.y - 10, 4, 18);
      // the sign: which basket size opens it
      ctx.fillStyle = '#FBF8F1'; ctx.strokeStyle = '#8C6512'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(gx - 22, h.y - 34, 44, 18, 4) : ctx.rect(gx - 22, h.y - 34, 44, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2A2622'; ctx.font = '700 10px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Basket ${h.level}`, gx, h.y - 25);
      ctx.textBaseline = 'alphabetic';
    } else {
      // swung open against the hedge
      ctx.fillStyle = '#B88550'; ctx.fillRect(gx - gap + 4, h.y - 16, 5, 16); ctx.fillRect(gx + gap - 9, h.y - 16, 5, 16);
    }
  });
}
function drawCat(x0, x1, y0, y1) {
  if (cat.x < x0 - 30 || cat.x > x1 + 30 || cat.y < y0 - 30 || cat.y > y1 + 30) return;
  const R = 15, nap = cat.st === 'nap';
  const sp = catSprites[nap ? 0 : 1];
  if (!sp) return;
  ctx.save();
  ctx.translate(cat.x, cat.y);
  if (!nap) ctx.scale(cat.face, 1);
  const breathe = nap && !reduced() ? 1 + Math.sin(time * 2.2) * 0.03 : 1;
  ctx.drawImage(sp, -R * breathe, -R * breathe, R * 2 * breathe, R * 2 * breathe);
  ctx.restore();
  if (nap && !reduced()) {
    // little z's drifting up
    const zz = cam.z;
    ctx.fillStyle = 'rgba(42,38,34,.55)'; ctx.textAlign = 'center';
    for (let k = 0; k < 2; k++) {
      const u = ((time * 0.5 + k * 0.5) % 1);
      ctx.globalAlpha = 1 - u;
      ctx.font = `700 ${(9 + 5 * u) / zz * 1.6}px Figtree, system-ui, sans-serif`;
      ctx.fillText('z', cat.x + 10 + u * 8, cat.y - 12 - u * 18);
    }
    ctx.globalAlpha = 1;
  }
}
/** Petals in the wind, falling leaves or snow: a few drifting bits over the screen (none with reduced motion). */
function drawWeather() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const w of weather) {
    const fall = w.k === 'snow' ? 26 : 20, drift = w.k === 'petals' ? 34 : w.k === 'leaves' ? 14 : 8;
    const x = ((w.u * (vw + 40) + time * drift * w.sp + Math.sin(w.ph * 0.8) * 16) % (vw + 40) + vw + 40) % (vw + 40) - 20;
    const y = ((w.v * (vh + 40) + time * fall * w.sp) % (vh + 40)) - 20;
    ctx.fillStyle = w.c;
    if (w.k === 'snow') { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(x, y, w.s, 0, Math.PI * 2); ctx.fill(); } else {
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(x, y, w.s, w.s * 0.55, w.rot, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** The sprite to draw: the small copy when the plant is tiny on screen (much cheaper to scale). */
function spriteFor(p, scale) {
  const e = sprites.get(p.s + p.v);
  const px = p.r * 2 * PAD * cam.z * dpr * scale; // on-screen size in device pixels
  return px < e.loPx * 1.3 ? e.lo : px < e.midPx * 1.3 ? e.mid : e.hi;
}
/** Blit only the opaque box of a sprite into the square (x - h, y - h, 2h, 2h). */
function blit(sp, x, y, hh) {
  const b = sp.box, n = sp.canvas.width, d = hh * 2;
  ctx.drawImage(sp.canvas, b.x * n, b.y * n, b.w * n, b.h * n, x - hh + b.x * d, y - hh + b.y * d, b.w * d, b.h * d);
}
function drawPlant(p, alpha) {
  const sp = spriteFor(p, 1);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  blit(sp, p.x, p.y, p.r * sp.half);
  if (alpha !== 1) ctx.globalAlpha = 1;
}
function drawPlantRot(p, x, y, rot, sc, a = 1) {
  const sp = spriteFor(p, sc);
  ctx.save();
  if (a !== 1) ctx.globalAlpha = a;
  ctx.translate(x, y); if (rot) ctx.rotate(rot);
  blit(sp, 0, 0, p.r * sp.half * sc);
  ctx.restore();
}

function drawBasket() {
  const sq = reduced() ? 0 : Math.sin(Math.min(1, B.squash) * Math.PI) * (B.squash > 1 ? 0.12 : 0.07);
  const rx = B.r * (1 + sq), ry = B.r * (1 - sq * 0.6);
  const hh = bSprite.half;
  ctx.drawImage(bSprite.canvas, B.x - rx * hh, B.y - ry * hh, rx * hh * 2, ry * hh * 2);
  // a few dyed bits peeking out of the opening
  for (let k = 0; k < recent.length; k++) {
    const a = k * 2.4, d = B.r * (0.25 + (k % 3) * 0.17);
    ctx.beginPath(); ctx.arc(B.x + Math.cos(a) * d, B.y + Math.sin(a) * d * 0.9, B.r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = recent[k]; ctx.fill();
  }
}

function drawFalling(f) {
  const p = g.plants[f.i];
  const u = Math.min(1, f.t / f.D);
  if (u >= 1) return;
  const px = f.x0 ?? p.x, py = f.y0 ?? p.y; // where it was picked up (a floating plant drifts)
  let x = px, y = py, sc = 1, rot = 0, a = 1;
  if (reduced()) { sc = 1 - 0.3 * u; a = 1 - u; } else if (f.kind === 'goat') {
    x = px + (f.gx - px) * u; y = py + (f.gy - py) * u; sc = 1 - 0.85 * u; a = u > 0.8 ? (1 - u) / 0.2 : 1;
  } else if (f.kind === 'land' || f.kind === 'grand') {
    // it teeters on the rim, then tips over and sinks in
    const rockEnd = f.kind === 'land' ? 0.38 : 0.25;
    if (u < rockEnd) { const w = u / rockEnd; rot = Math.sin(w * Math.PI * 3) * 0.16; y = py - Math.abs(Math.sin(w * Math.PI * 3)) * p.r * 0.05; } else {
      const w = (u - rockEnd) / (1 - rockEnd), e = w * w;
      x = px + (B.x - px) * e; y = py + (B.y - py) * e - Math.sin(w * Math.PI) * p.r * 0.22;
      rot = f.dir * (w * 1.5); sc = 1 - 0.85 * e; a = w > 0.85 ? (1 - w) / 0.15 : 1;
    }
  } else {
    // pops up, tumbles over and drops in
    const m = Math.min(1, u * 1.35), e = m * m;
    x = px + (B.x - px) * e; y = py + (B.y - py) * e - Math.sin(Math.min(1, u * 1.5) * Math.PI) * p.r * 0.9;
    sc = u < 0.3 ? 1 + 0.12 * Math.sin((u / 0.3) * Math.PI) : 1 - 0.75 * ((u - 0.3) / 0.7);
    rot = f.dir * u * (f.kind === 'breeze' ? 4.2 : 2.8); a = u > 0.85 ? (1 - u) / 0.15 : 1;
  }
  drawPlantRot(p, x, y, rot, sc, a);
}

function drawGoat(x0, x1, y0, y1) {
  if (goat.x < x0 - 30 || goat.x > x1 + 30 || goat.y < y0 - 30 || goat.y > y1 + 30) return;
  const rm = reduced();
  let lift = 0, fr = 0;
  if (goat.state === 'hop' && !rm) lift = Math.abs(Math.sin((goat.hopT / GOAT.hopSecs) * Math.PI * 2)) * 10;
  else if (goat.state === 'walk' && !rm) fr = Math.floor(time * 6) % 2;
  else if (goat.state === 'munch' && !rm) fr = Math.floor(time * 4) % 2;
  const hh = GOAT_R;
  ctx.save();
  ctx.translate(goat.x, goat.y - hh * 0.5 - lift);
  ctx.scale(goat.face, 1);
  ctx.drawImage(goatSprites[fr], -hh, -hh, hh * 2, hh * 2);
  ctx.restore();
  if (time < goatSayUntil) {
    const zz = cam.z;
    ctx.font = `700 ${13 / zz}px Figtree, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(251,248,241,.95)';
    const tx = goat.x, ty = goat.y - hh * 1.7 - lift;
    ctx.beginPath(); ctx.ellipse(tx, ty - 4 / zz, 22 / zz, 12 / zz, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2622';
    ctx.fillText('Maa!', tx, ty);
  }
}

function drawArrow(p, pulse) {
  const sp = toScreen(p.x, p.y);
  const cx = vw / 2, cy = vh / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const top = 150, bot = 84, side = 30;
  // clamp to the visible play area (below the top HUD, above Head home)
  const tx = Math.cos(ang), ty = Math.sin(ang);
  let t = Infinity;
  if (tx > 0) t = Math.min(t, (vw - side - cx) / tx);
  if (tx < 0) t = Math.min(t, (side - cx) / tx);
  if (ty > 0) t = Math.min(t, (vh - bot - cy) / ty);
  if (ty < 0) t = Math.min(t, (top - cy) / ty);
  const ax = cx + tx * t, ay = cy + ty * t;
  ctx.setTransform(dpr, 0, 0, dpr, dpr * ax, dpr * ay);
  ctx.rotate(ang);
  const s = 1 + 0.08 * pulse;
  ctx.scale(s, s);
  ctx.beginPath(); ctx.arc(0, 2, 19, 0, Math.PI * 2); ctx.fillStyle = 'rgba(42,38,34,.18)'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fillStyle = '#FBF8F1'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(226,176,74,${0.6 + 0.4 * pulse})`; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(6, 0); ctx.lineTo(-5, 8);
  ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#8C6512'; ctx.stroke();
}

// ---------- the end of a visit ----------
/** Bank the haul through the sim (coins, stock, bests, hooks). Safe to call once per visit. */
function finishVisit(reason) {
  if (result) return result;
  ended = true; homing = null;
  clearTimeout(endTimer);
  drag = null;
  const spare = mode.timed && (reason === 'done' || reason === 'cleared') ? clock.secs - clock.t : 0;
  if (pr) forcePathTick(); // a last look at the goal before banking
  const res = lvl
    ? C.game.act(SG().finishVisit, { placeId: lvl.id, levelId: lvl.id, mode: 'path', seed: g.seed, got: visit.got.slice(), flags: pathFlags(), firstMet: !!(pr && pr.first), reason })
    : C.game.act(SG().finishVisit, { placeId: g.place, mode: mode.id, seed: g.seed, day: visitDay, got: visit.got.slice(), spare, reason });
  if (res && res.ok) result = res;
  else {
    // Not banked (the garden closed meanwhile): still show what she gathered.
    result = { ok: false, reason, haul: tally(g, visit.got), fact: pickFact(g, visit.got, 0), coins: 0, stock: [], stockLeft: 0, score: null, prev: null, isNew: false };
  }
  return result;
}

const END_BTNS = `<button type="button" class="btn btn-primary" data-action="again" data-tap>Visit again</button>
<button type="button" class="btn btn-paper" data-action="another" data-tap>Another place</button>`;
/** What is still to do for an unmet goal, in kind words ("5 more tansy heads"). */
function stillToDo() {
  const pg = pr.prog || { have: 0, need: 1 };
  const left = Math.max(0, pg.need - pg.have);
  switch (lvl.goal.t) {
    case 'gather': return `${left} more ${left === 1 ? nameInSentence(SPECIES[lvl.goal.s].name) : SPECIES[lvl.goal.s].many}`;
    case 'float': return `${left} more floating ${SPECIES[lvl.stream.s].many}`;
    case 'jars': return `${jarsFrac(left) === '0' ? 'a little' : jarsFrac(left)} more ${left <= 24 ? 'jar' : 'jars'} of dye`;
    case 'landmark': return `${cap(SPECIES[lvl.goal.s].the)}, once the basket is big enough`;
    case 'level': return `${left === 1 ? 'One more basket size' : `${left} more basket sizes`}`;
    default: return `${left} more ${left === 1 ? 'plant' : 'plants'}`;
  }
}
function showPathEnd(r, reason) {
  const P = r.path || { met: pr.met, stars: 0, best: 0, extras: [], first: false, next: LEVELS[lvl.n] ? LEVELS[lvl.n].id : null };
  const nx = P.next ? LEVEL_BY_ID[P.next] : null;
  const title = el.end.querySelector('[data-end-title]');
  const sub = el.end.querySelector('[data-end-sub]');
  const sc = el.end.querySelector('[data-score]');
  const met = !!P.met;
  const doneEver = met || pr.doneBefore || !!pathDone()[lvl.id];
  title.textContent = met ? (P.first ? `${levelLabel(lvl)} done!` : `${levelLabel(lvl)}, done again`) : reason === 'dusk' ? `Dusk at ${levelLabel(lvl)}` : `Home from ${levelLabel(lvl)}`;
  sub.textContent = met
    ? (P.first ? (nx ? `${levelLabel(nx)}, ${nx.name}, is open.` : 'That was the last garden on the path. Every garden stays open to play again.') : '')
    : reason === 'dusk' ? 'The sun set first. You keep everything you gathered, and the garden is here to try again.' : `${stillToDo()} next time. Everything you gathered comes home.`;
  sub.hidden = !sub.textContent;
  const rows = [`<li><span class="s${met ? ' on' : ''}" aria-hidden="true">&#9733;</span><span>${esc(goalText(lvl.goal, lvl))}</span></li>`]
    .concat((P.extras || []).map((e) => `<li><span class="s${e.met ? ' on' : ''}" aria-hidden="true">&#9733;</span><span>${esc(e.text)}</span></li>`));
  const best = P.best && P.best > P.stars ? `<div class="hint">Your best here: ${P.best} of 3 stars.</div>` : '';
  sc.innerHTML = `<div style="flex:1;min-width:0"><div class="gd-bigstars" aria-label="${P.stars} of 3 stars">${starsHtml(P.stars)}</div><ul class="gd-stars">${rows.join('')}</ul>${best}</div>`;
  sc.hidden = false;
  let btns;
  if (doneEver && nx) {
    btns = `<button type="button" class="btn btn-primary" data-action="path-next" data-level="${nx.id}" data-tap>Next garden<small style="display:block;font-weight:500;font-size:12px;opacity:.8">${levelLabel(nx)}</small></button>
<button type="button" class="btn btn-paper" data-action="path-list" data-tap>The path</button>
<button type="button" class="gd-linkbtn" data-action="again" data-tap>Play this garden again</button>`;
  } else if (!met && reason === 'dusk' && lvl.dusk) {
    btns = `<button type="button" class="btn btn-primary" data-action="again" data-tap>Try again before dusk</button>
<button type="button" class="btn btn-paper" data-action="again-nosun" data-tap>No clock this time</button>
<button type="button" class="gd-linkbtn" data-action="path-list" data-tap>The path</button>`;
  } else {
    btns = `<button type="button" class="btn btn-primary" data-action="again" data-tap>${met ? 'Play again' : 'Try again'}</button>
<button type="button" class="btn btn-paper" data-action="path-list" data-tap>The path</button>`;
  }
  el.endbtns.innerHTML = btns;
  if (met) bestSound();
}

function showEnd(reason) {
  const r = finishVisit(reason);
  const { haul, fact, score, prev, isNew } = r;
  const where = theName(place);
  const n = visit.got.length;
  const title = el.end.querySelector('[data-end-title]');
  const sub = el.end.querySelector('[data-end-sub]');
  const sc = el.end.querySelector('[data-score]');
  if (!lvl) el.endbtns.innerHTML = END_BTNS;
  if (lvl) showPathEnd(r, reason);
  else if (mode.timed) {
    title.textContent = reason === 'dusk' ? `Dusk at ${where}` : reason === 'home' ? `Home early from ${where}` : reason === 'cleared' ? `You and the goat cleared ${where}` : `You gathered all of ${where}`;
    sub.textContent = n ? '' : 'A quiet evening stroll. The plants will be here next time.';
    sub.hidden = !!n;
    if (score) {
      const bestLine = isNew
        ? `<span class="gd-newbest">New best!</span>${prev ? ` <span>Before: ${plural(prev.jars, 'jar', 'jars')}</span>` : ''}`
        : prev ? `Your best at ${where}: <b>${plural(prev.jars, 'jar', 'jars')}</b> · Basket ${prev.level}` : 'Your first harvest here.';
      const spareLine = score.spare ? `<br>Everything gathered with ${clockLabel(score.spare)} of sun to spare` : '';
      sc.innerHTML = `<div class="big">${score.jars}<small> jar${score.jars === 1 ? '' : 's'}</small></div><div class="sub"><b>Basket ${score.level}</b> · ${plural(n, 'plant', 'plants')}${spareLine}<br>${bestLine}</div>`;
      sc.hidden = false;
    } else sc.hidden = true;
    if (isNew) bestSound();
  } else {
    title.textContent = reason === 'done' ? `You gathered all of ${where}` : `Home from ${where}`;
    sub.textContent = n ? `${plural(n, 'plant', 'plants')} in the basket. Here are your jars:` : 'A quiet stroll today. The plants will be here next time.';
    sub.hidden = false;
    sc.hidden = true;
  }
  // What came home for the workshop
  const pays = el.end.querySelector('[data-pays]');
  const coinsTxt = C.format ? C.format.num(Math.max(r.coins > 0 ? 1 : 0, Math.round(r.coins || 0))) : String(Math.round(r.coins || 0));
  const stock = (r.stock || []).filter((e) => e.added > 0);
  const stockHtml = stock.length
    ? `<div class="stock">For your shelves: ${stock.map((e) => `<span><i style="background:${esc(safe(() => C.sim.economy.colorHex(e.colorId)) || '#B7BDB3')}"></i>${Math.round(e.added)} ${esc(safe(() => C.sim.displayName(S(), e.colorId)) || e.colorId)}</span>`).join('')}</div>` : '';
  const left = Math.round(r.stockLeft || 0);
  pays.innerHTML = r.ok && n
    ? `<div class="coins" data-coins><i aria-hidden="true"></i>+${esc(coinsTxt)} coins</div>${stockHtml}${left > 0 ? `<div class="hint">Your storage is full, so ${plural(left, 'jar stays', 'jars stay')} on the dye shelf.</div>` : ''}`
    : '<div class="hint">The dyes go on your dye shelf.</div>';
  pays.hidden = !n;
  const notes = [];
  if (!lvl && (r.goal ? r.goal.met : goalMet)) notes.push(`<li>&#10003; Bonus met: enough for ${DYES[goal.dye].name.toLowerCase()}.</li>`);
  if (cat && pr && !pr.catWoke) notes.push('<li>The cat napped right through it.</li>');
  if (comboBest >= 5) notes.push(`<li>Biggest sweep: ${comboBest} in one go.</li>`);
  if (landmarksGot) notes.push(`<li>Even ${landmarksGot === 1 ? 'a landmark' : `${landmarksGot} landmarks`} fit in the basket.</li>`);
  if (spindleNew) notes.push(`<li>A lost spindle came home with you (${gstate().spindles || 1} kept).</li>`);
  if (goat && goat.eaten) notes.push(`<li>The neighbor's goat nibbled ${plural(goat.eaten, 'plant', 'plants')}${goat.startled ? ` and hopped off ${goat.startled === 1 ? 'once' : `${goat.startled} times`}` : ''}.</li>`);
  el.end.querySelector('[data-notes]').innerHTML = notes.join('');
  const hl = el.end.querySelector('[data-haul]');
  hl.innerHTML = (haul || []).map((t) => `<li><span class="gd-jar" style="--c:${t.hex}"><i></i></span><span class="nm">${t.name}<em>${jarsLabel(t.units)}</em></span></li>`).join('');
  hl.hidden = !(haul && haul.length);
  el.end.querySelector('[data-fact]').innerHTML = `<small>From the dye notebook</small>${fact ? fact.text : ''}`;
  if (!lvl) el.end.querySelector('[data-action="again"]').textContent = mode.timed ? 'Harvest again' : 'Visit again';
  el.toast.classList.remove('show');
  el.end.hidden = false;
  stop();
  safe(draw);
  if (r.ok && r.coins > 0 && C.audio && soundOn()) safe(() => C.audio.coins(6));
  const again = el.end.querySelector('[data-action="path-next"]') || el.end.querySelector('[data-action="again"]');
  if (again) again.focus({ preventScroll: true });
  el.end.scrollTop = 0;
  const card = el.end.querySelector('.card');
  if (card) card.scrollTop = 0;
}
const endReason = () => (homing ? 'dusk' : isDone(g, visit, eatenN) ? (eatenN ? 'cleared' : 'done') : 'home');

/** A new visit while a Wander visit waits: that basket comes home first (paid), so nothing gathered is lost. */
function bankSaved() {
  const c = gstate().cur;
  if (!c || !Array.isArray(c.got) || !c.got.length) return '';
  const path = c.mode === 'path';
  const r = path
    ? C.game.act(SG().finishVisit, { placeId: c.place, levelId: c.place, mode: 'path', seed: c.seed, got: c.got, flags: { catWoke: !!c.cw, sweep: c.sw | 0 }, reason: 'home' })
    : C.game.act(SG().finishVisit, { placeId: c.place, mode: 'wander', seed: c.seed, got: c.got, reason: 'home' });
  if (!r || !r.ok) return '';
  const from = path ? levelLabel(LEVEL_BY_ID[c.place]) : theName(PLACE_BY_ID[c.place]);
  return `Your basket from ${from} came home: +${C.format ? C.format.num(Math.max(1, Math.round(r.coins))) : Math.round(r.coins)} coins`;
}

// ---------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------

function onClick(e) {
  if (!ROOT || !e.target.closest) return;
  const a = e.target.closest('[data-action]');
  if (!a || !ROOT.contains(a)) return;
  switch (a.dataset.action) {
    case 'unlock-open': ensureWorkshopStyles(); openUnlockSheet(C, 'garden', { host: ROOT }); return;
    case 'visit': {
      const id = a.dataset.place;
      const banked = bankSaved();
      if (a.dataset.mode === 'harvest') startVisit(id, 'harvest', harvestSeed(id, gstate().settings && gstate().settings.today ? todayKey() : ''));
      else startVisit(id, 'wander', freshSeed());
      if (banked && U.view === 'play') showToast(banked, true, 3);
      return;
    }
    case 'continue': { const c = gstate().cur; if (c) startVisit(c.place, c.mode === 'path' ? 'path' : 'wander', c.seed, c); return; }
    case 'path-open': closeLevelCard(); showPath(); return;
    case 'places': closeLevelCard(); showPlaces(); return;
    case 'path-continue': {
      const c = gstate().cur;
      if (c && c.mode === 'path' && LEVEL_BY_ID[c.place]) { startVisit(c.place, 'path', c.seed, c); return; }
      if (U.sub !== 'path') { U.sub = 'path'; U.scrollNext = true; renderChoose(true); }
      openLevelCard(nextLevel().id);
      return;
    }
    case 'path-level': {
      if (a.getAttribute('aria-disabled') === 'true') { if (C.toast) C.toast(`This garden opens after garden ${LEVEL_BY_ID[a.dataset.level].n - 1}.`); return; }
      openLevelCard(a.dataset.level);
      return;
    }
    case 'lv-close': closeLevelCard(); return;
    case 'path-start': startPath(a.dataset.level, { sun: a.dataset.sun === '1', resume: a.dataset.resume === '1' }); return;
    case 'path-next': {
      const id = a.dataset.level;
      g = null; lvl = null;
      U.sub = 'path';
      setView('choose');
      renderChoose(true);
      if (LEVEL_BY_ID[id]) openLevelCard(id);
      return;
    }
    case 'path-list': g = null; lvl = null; U.sub = 'path'; U.scrollNext = true; setView('choose'); renderChoose(true); return;
    case 'again-nosun': if (g && lvl) startVisit(lvl.id, 'path', lvl.seed, null, { sun: false }); return;
    case 'today': C.game.act(SG().setSetting, { key: 'today', value: !(gstate().settings && gstate().settings.today) }); renderChoose(true); return;
    case 'leave': leaveToChoose(); return;
    case 'home': if (el.end && !el.end.hidden) return; if (g) showEnd(endReason()); return;
    case 'again':
      if (g && lvl) startVisit(lvl.id, 'path', lvl.seed, null, { sun: mode.timed });
      else if (g) startVisit(g.place, mode.id, mode.timed ? g.seed : freshSeed());
      return;
    case 'another': g = null; leaveToChoose(); return;
    case 'help': el.help.hidden = false; drag = null; { const ok = el.help.querySelector('[data-action="help-ok"]'); if (ok) ok.focus({ preventScroll: true }); } return;
    case 'help-ok': el.help.hidden = true; return;
    case 'sound': {
      const on = !soundOn();
      C.game.act(SG().setSetting, { key: 'sound', value: on });
      renderSound();
      if (on) { ensureAudio(); setTimeout(() => pluck(10, '', 1), 30); }
      return;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------

function coachSteps() {
  return [
    { anchor: '[data-coach="garden-wander"]', text: 'Start with Wander: no clock, nothing to lose.', endsOn: 'action', event: 'gardenStart' },
    { anchor: '[data-coach="garden-basket"]', text: 'Drag anywhere to steer the basket over plants that fit.', endsOn: 'action', event: 'gardenGather', side: 'below' },
    { anchor: '[data-coach="garden-grow"]', text: 'Every plant grows the basket. The bar shows what fits next.', endsOn: 'got-it', side: 'below' },
  ];
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/** debugGarden() -> a read for tests (test/garden.e2e.mjs). */
export function debugGarden() {
  const base = { visible: U.visible, view: U.view, running, ended, result: result ? { ok: result.ok, coins: result.coins, stock: result.stock, reason: result.reason } : null };
  if (!g || !visit) return base;
  const bs = toScreen(B.x, B.y);
  const i = lvl ? nearestFit(g, visit.mass, taken, B.x, B.y, time) : nearestGatherable(g, visit, B.x, B.y, taken);
  const tq = i >= 0 ? (lvl ? (() => { const q = posOf(i); return steerPoint(g, visit.mass, B.x, B.y, q.x, q.y); })() : g.plants[i]) : null;
  const ts = tq ? toScreen(tq.x, tq.y) : null;
  return {
    ...base, place: g.place, mode: mode.id, seed: g.seed, ox, oy, bx: bs.x + ox, by: bs.y + oy, tx: ts && ts.x + ox, ty: ts && ts.y + oy,
    got: visit.got.length, total: g.plants.length, eaten: eatenN, done: isDone(g, visit, eatenN), z: cam.z, r: basketRadius(g, visit.mass),
    level: levelInfo(g, visit.mass).level, units: visit.got.reduce((s, k) => s + unitsOf(g.plants[k]), 0),
    clock: clock.on ? { started: clock.started, t: clock.t, secs: clock.secs } : null, homing: !!homing,
    goat: goat ? { state: goat.state, eaten: goat.eaten, startled: goat.startled } : null, landmarksGot, comboBest,
    goal: { ...goal, have: goalHave, met: goalMet }, dpr, qual,
    path: lvl ? { level: lvl.id, n: lvl.n, met: !!pr.met, first: !!pr.first, prog: pr.prog, catWoke: !!pr.catWoke, cat: cat ? cat.st : null, gates: gatesOpen.slice(), floaters: fls.length, sun: !!pr.sun, extras: (pr.extras || []).map((e) => e.met) } : null,
    scroll: Math.max(window.scrollY, document.scrollingElement.scrollTop, document.body.scrollTop, document.getElementById('app') ? document.getElementById('app').scrollTop : 0),
  };
}

/** Test-only handles: an autopilot (as in the prototype's perf runs) and a faster clock for short harvests. */
export const gardenTest = {
  autopilot(on) { auto = on ? { i: -1, next: 0 } : null; if (on && el.coach) moved(); },
  speed(x) { speed = Math.max(1, Math.min(20, Math.round(Number(x) || 1))); },
  stats() {
    const d = [...frameDt].sort((a, b) => a - b), w = [...frameWork].sort((a, b) => a - b);
    const q = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0);
    return { dpr, qual, frames: d.length, p50: q(d, 0.5), p95: q(d, 0.95), work50: q(w, 0.5), work95: q(w, 0.95) };
  },
  resetStats() { frameDt.length = 0; frameWork.length = 0; },
  /** Put the basket at world (x, y) (the camera follows); for checks near the cat or a gate. */
  teleport(x, y) { if (!g) return; B.x = Math.max(0, Math.min(g.W, x)); B.y = Math.max(0, Math.min(g.H, y)); B.vx = B.vy = 0; cam.x = B.x; cam.y = B.y; moved(); },
  /** World positions of the cat and the gates in the garden in play. */
  where() { return g ? { cat: cat ? { x: cat.x, y: cat.y, st: cat.st } : null, hedges: g.hedges || [], W: g.W, H: g.H, basket: { x: B.x, y: B.y } } : null; },
};

export default {
  id: 'garden',

  mount(root, c) {
    C = c;
    ROOT = root;
    injectCss();
    root.innerHTML = '<div class="gd-choose"></div><div class="gd-play" hidden></div>';
    root.addEventListener('click', onClick);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      window.addEventListener('pagehide', () => { if (U.visible) persistCur(); });
      document.addEventListener('visibilitychange', () => { if (U.visible && U.view === 'play') onVisibility(); });
    }
    // Registered at mount, so app.js's 'unlocked' hand-off and "How this works" can find it.
    if (C.guide) U.guide = C.guide('garden', coachSteps(), { screen: 'garden' });
    // Bought elsewhere (the workshop's Next): offer the way in (two equal choices; nothing navigates by itself).
    if (C.game && C.game.on) {
      C.game.on('unlocked', (p) => {
        const here = () => { const top = C.current ? C.current() : null; return top && (top.id === 'puzzles' || top.id === 'garden' || top.id === 'map'); };
        if (!p || p.id !== 'garden' || U.visible || here()) return;
        setTimeout(() => {
          if (U.visible || here() || !C.guide || !C.guide.whatsNext) return;
          C.guide.whatsNext({
            title: 'The Dye Garden is open',
            body: 'Steer a basket through real dye plants, whenever you like.',
            more: { label: 'Later' },
            next: { label: 'Go to the garden', run: () => C.navigate('garden') },
          });
        }, 300);
      });
    }
  },

  show(params = {}) {
    U.visible = true;
    U.gen += 1;
    if (unlocked()) C.game.act(SG().ensureGarden);
    // Every visit to the screen starts at the places (hide() kept or banked any visit in play);
    // params.path opens the Garden Path list instead.
    U.sub = params && params.path ? 'path' : 'places';
    U.scrollNext = U.sub === 'path';
    closeLevelCard();
    setView('choose');
    renderChoose(true);
    if (U.guide && unlocked()) U.guide.start();
  },

  hide() {
    // Leaving the screen: a Wander visit is kept to resume; a harvest is banked now.
    if (U.view === 'play' && g && !result) {
      if (mode.timed || ended) {
        const r = finishVisit(endReason());
        if (r && r.ok && r.coins > 0 && C.toast) C.toast(`Your basket came home: +${C.format ? C.format.num(Math.round(r.coins)) : Math.round(r.coins)} coins`);
      } else persistCur();
    }
    stop();
    drag = null;
    keys.clear();
    clearTimeout(endTimer);
    if (U.view === 'play') { g = result ? null : g; setView('choose'); }
    closeLevelCard();
    U.visible = false;
    U.gen += 1;
    if (U.guide) U.guide.stop();
  },

  render() {
    if (!ROOT || !U.visible || U.view !== 'choose') return;
    renderChoose(false);
  },
};
