// sim/howto.js — "how do I do this?" for quests and the weekly event (pure).
// The Quests screen shows these when she taps a daily quest, a weekly step or
// the event card: one or two plain sentences, what is still needed first (a
// system to buy, with its price and how to get there: never a dead end), and
// where "Take me there" goes. Data lives in content (QUEST_HOW in quests.js,
// EVENT_POINT_HOW and twist.how/go in events.js); this module fills in the
// specifics from state (the region, the family, prices, what is open).
// Spec: DESIGN.md "Quests and weekly events"; tone: positive framing only.

import { QUEST_HOW, getQuestType } from '../content/quests.js';
import {
  getEvent, POINTS_PER, EVENT_POINT_HOW, EVENT_HUE_CHANCE, FAMILY_WORDS, familiesText, trackStepsReached,
} from '../content/events.js';
import { getRegion } from '../content/regions.js';
import { ROOMS_BY_ID } from '../content/rooms.js';
import { getCanvas } from '../content/canvases.js';
import { eraPreviewColors } from '../content/eras.js';
import { getCommission } from '../content/commissions.js';
import { formatNumber } from '../format.js';
import { status as unlockStatus } from './unlocks.js';
import { PHASE_GATES, phaseGoal } from './factory.js';
import { discoveredCount } from './discovery.js';
import { eventColors, knowsColor, colorInfo } from './hunters.js';

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const go = (screen, params = {}) => ({ screen, params: { ...params } });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const coins = (n) => `${formatNumber(Math.ceil(fin(n)))} ${Math.ceil(fin(n)) === 1 ? 'coin' : 'coins'}`;

/** Screen ids the how-to may send her to (index.html sections). */
export const GO_SCREENS = Object.freeze([
  'workshop', 'orders', 'puzzles', 'map', 'catalog', 'album', 'quests', 'gallery', 'shelf', 'grading', 'purify',
  'packing', 'matching', 'bench', 'paint', 'hunter', 'commissions', 'heritage', 'tiles', 'skeins', 'lift', 'garden', 'tangle', 'hoop',
]);

const UNLOCK_OF_NEED = Object.freeze({ shelf: 'shelf', hunters: 'hunters', gallery: 'gallery', shipping: 'shipping', commissions: 'commissions', tiles: 'tiles', skeins: 'skeins', lift: 'lift', garden: 'garden', tangle: 'tangle', hoop: 'hoop' });

/**
 * requirement(state, need) -> null when it is open, else
 * {need, title, text, go:{screen, params}, cta}: what to do first, with prices and
 * colors in positive words, and a button that goes to the next useful place.
 */
export function requirement(state, need) {
  if (!need) return null;
  if (need === 'factory') {
    if (fin(state.phase, 1) >= 2) return null;
    const gate = PHASE_GATES[2];
    const room = ROOMS_BY_ID[gate.room];
    const need2 = Math.max(gate.colors, fin(room && room.colorsRequired));
    const left = Math.max(0, need2 - discoveredCount(state));
    const hasRoom = (state.rooms || []).includes(gate.room);
    if (left > 0) {
      return {
        need, title: `First, the ${room.name}`,
        text: `Muddy batches start once your workshop grows into the ${room.name}. Its price shows at ${need2} colors: ${plural(left, 'more color')} to find.`,
        go: go('bench'), cta: 'Find new colors',
      };
    }
    return {
      need, title: hasRoom ? 'Coming up soon' : `First, the ${room.name}`,
      text: hasRoom ? 'Your workshop is growing: keep a mixer busy and a muddy batch will turn up.'
        : `Buy the ${room.name} in the workshop for ${coins(room.cost)}${fin(state.coins) >= room.cost ? '. You can afford it now.' : `: ${coins(room.cost - fin(state.coins))} more to go.`}`,
      go: go('workshop', { panel: 'rooms' }), cta: 'Open the rooms',
    };
  }
  const id = UNLOCK_OF_NEED[need];
  if (!id) return null;
  let st;
  try { st = unlockStatus(state, id); } catch { st = null; }
  if (!st || st.open) return null;
  const name = st.name;
  if (!st.phaseOk) {
    const g = phaseGoal(state, st.phase);
    const rn = g.room.name;
    const text = !g.hasRoom
      ? `The ${name} comes after the ${rn}. ${g.roomColorsLeft > 0 ? `The ${rn} opens at ${g.room.colorsRequired} colors (${plural(g.roomColorsLeft, 'more color')} to find), then costs ${coins(g.room.cost)}.` : `Build the ${rn} in the workshop for ${coins(g.room.cost)}.`} After that the ${name} costs ${coins(st.cost)}.`
      : `The ${name} opens at ${g.colors} colors: ${plural(g.colorsLeft, 'more color')} to find. Then it costs ${coins(st.cost)}.`;
    return {
      need, title: `First, the ${g.hasRoom ? name : rn}`, text,
      go: g.hasRoom ? go('bench') : go('workshop', { panel: 'rooms' }), cta: g.hasRoom ? 'Find new colors' : 'Open the rooms',
    };
  }
  if (st.colorsLeft > 0) {
    return {
      need, title: `First, the ${name}`,
      text: `You can buy the ${name} in the workshop for ${coins(st.cost)}. The price shows at ${st.revealColors} colors: ${plural(st.colorsLeft, 'more color')} to find.`,
      go: go('bench'), cta: 'Find new colors',
    };
  }
  return {
    need, title: `First, the ${name}`,
    text: `You can buy the ${name} in the workshop for ${coins(st.cost)}.${st.affordable ? ' You can afford it now.' : ` ${coins(st.cost - fin(state.coins))} more to go.`}`,
    go: go('workshop', { unlock: id }), cta: `See the ${name}`,
  };
}

function regionName(id) {
  const r = getRegion(id);
  return r ? r.name : id;
}

/**
 * questGuide(state, quest) -> {how, go, cta, need, done, left}. `quest` is a daily
 * quest ({type, event, region, target, progress}) or a weekly step ({event, n,
 * progress, region?, family?, commission?}). `need` is requirement() or null; when
 * it is set, "Take me there" should use need.go (the quest's own go stays in `go`).
 */
export function questGuide(state, quest = {}) {
  const event = quest.event ?? (getQuestType(quest.type) || {}).event;
  const base = QUEST_HOW[event] || { how: 'Play as you like: this fills in as you go.', go: go('workshop'), cta: 'Open the workshop', needs: null };
  let how = base.how;
  let dest = go(base.go.screen, base.go.params);
  let cta = base.cta;
  const target = fin(quest.target ?? quest.n, 1);
  const progress = fin(quest.progress);
  if (event === 'hunterSent' && quest.region) {
    how = `Open the Map and send a hunter to the ${regionName(quest.region)}. A short trip counts.`;
    dest = go('map', { regionId: quest.region });
    cta = `Go to the ${regionName(quest.region)}`;
  } else if (event === 'colorDiscovered' && quest.family) {
    const w = FAMILY_WORDS[quest.family] || `${quest.family}s`;
    how = `Find new ${w}: mix them at the bench and watch for the shimmer, or solve grading boards in those shades.`;
  } else if (event === 'commissionDone' && quest.commission) {
    const c = getCommission(quest.commission);
    if (c) how = `Open Commissions and deliver each step of ${c.name} from your stock. It completes when the last step is in.`;
  }
  return {
    event, how, go: dest, cta, need: requirement(state, base.needs),
    done: !!quest.done || progress >= target, left: Math.max(0, target - progress),
  };
}

// ---------------------------------------------------------------------------
// The weekly event
// ---------------------------------------------------------------------------

/** One reward in words: {label, detail}. */
export function rewardText(state, ev, r = {}) {
  if (r.seals) return { label: `${r.seals} Seals`, detail: 'to spend in the Seal shop on this page' };
  if (r.colorId) {
    const c = colorInfo(r.colorId);
    return { label: c ? `${c.name}, a limited color` : 'A limited color', detail: 'joins your catalog for good' };
  }
  if (r.canvas) {
    const c = getCanvas(r.canvas);
    return { label: c ? `${c.name}, a canvas` : 'A new canvas', detail: 'a design to paint in the Gallery' };
  }
  if (r.vial) return { label: plural(r.vial, 'event vial'), detail: 'land on your Merge Shelf (once it is open)' };
  if (r.cosmetic) return { label: `${ev ? ev.name : 'Event'} banner`, detail: 'a keepsake pennant, kept with your event progress' };
  return { label: 'A surprise', detail: '' };
}

/** Kinds of event point this event offers (bouquet only under its twist), in display order. */
export function pointKinds(ev) {
  const order = ['board', 'order', 'bouquet', 'purify', 'crate', 'paint'];
  return order.filter((k) => POINTS_PER[k] > 0 && EVENT_POINT_HOW[k] && (!EVENT_POINT_HOW[k].rule || (ev && ev.twist.rules[EVENT_POINT_HOW[k].rule])));
}

const ACTION_WORDS = {
  board: ['board', 'boards'], order: ['order', 'orders'], bouquet: ['bouquet', 'bouquets'],
  purify: ['purified batch', 'purified batches'], crate: ['shipment', 'shipments'], paint: ['painted region', 'painted regions'],
};

/**
 * eventGuide(state) -> null, or everything the event sheet explains:
 *  {id, name, regionId, regionName, families, familiesText, points,
 *   sources:[{kind, points, label, how, go, cta, need}],
 *   next:{step, points, left, reward, actions:[{kind, n, text}]} | null,
 *   track:[{step, points, reached, claimed, reward:{label, detail}}],
 *   twist:{text, how, go, cta, need},
 *   limited:{total, found, ways:[{how, go, cta, need}]},
 *   preview:[{id, name, hex, note}]}
 */
export function eventGuide(state) {
  const key = state && state.event && state.event.key;
  const ev = key ? getEvent(key) : null;
  if (!ev) return null;
  const fams = familiesText(ev.palette);
  const points = fin(state.event.points);
  const claimed = Array.isArray(state.event.claimed) ? state.event.claimed : [];
  const rules = ev.twist.rules;

  const sources = pointKinds(ev).map((kind) => {
    const s = EVENT_POINT_HOW[kind];
    let label = s.label;
    let how = s.how.replace(/\{families\}/g, fams);
    if (kind === 'crate' && rules.packingLanterns) {
      label = 'Pack a shipment (it strings lanterns)';
      how = `This week a packed shipment counts whatever its colors; an unpacked one counts when it carries ${fams}.`;
    }
    return { kind, points: POINTS_PER[kind], label, how, go: go(s.go.screen, s.go.params), cta: s.cta, need: requirement(state, s.needs) };
  });

  const reached = trackStepsReached(ev, points);
  const nextDef = ev.track.find((s) => s.step === reached + 1) || null;
  let next = null;
  if (nextDef) {
    const left = Math.max(1, nextDef.points - points);
    const actions = sources.filter((s) => !s.need).map((s) => {
      const n = Math.max(1, Math.ceil(left / s.points));
      const w = ACTION_WORDS[s.kind] || [s.kind, `${s.kind}s`];
      return { kind: s.kind, n, text: `${n} ${n === 1 ? w[0] : w[1]}` };
    }).sort((a, b) => a.n - b.n || (a.kind === 'order' ? -1 : 0));
    next = { step: nextDef.step, points: nextDef.points, left, reward: rewardText(state, ev, nextDef.reward), actions };
  }
  const track = ev.track.map((s) => ({
    step: s.step, points: s.points, reached: points >= s.points, claimed: claimed.includes(s.step), reward: rewardText(state, ev, s.reward),
  }));

  const twist = {
    text: ev.twist.text, how: ev.twist.how, go: go(ev.twist.go.screen, ev.twist.go.params), cta: ev.twist.cta,
    need: rules.packingLanterns ? requirement(state, 'shipping') : rules.longTripBonus ? requirement(state, 'hunters') : null,
  };

  const limitedIds = eventColors(ev.id).map((c) => c.id);
  const found = limitedIds.filter((id) => knowsColor(state, id)).length;
  const region = regionName(ev.region);
  const stepColor = ev.track.find((s) => s.reward.colorId);
  const pct = (d) => `${Math.round(fin(EVENT_HUE_CHANCE[d]) * 100)}%`;
  const ways = [
    {
      how: `Send a hunter to the ${region}: each trip there can bring one home (short trips ${pct('short')}, long ${pct('long')}, overnight ${pct('overnight')}).`,
      go: go('map', { regionId: ev.region }), cta: `Go to the ${region}`, need: requirement(state, 'hunters'),
    },
    stepColor ? {
      how: `Step ${stepColor.step} of the event track gives you ${rewardText(state, ev, stepColor.reward).label.replace(', a limited color', '')}.`,
      go: null, cta: null, need: null,
    } : null,
    {
      how: 'A mix at the bench or a tint on an event grading board that lands very close to one finds it too.',
      go: go('puzzles', { puzzle: 'grading' }), cta: 'Open grading boards', need: null,
    },
  ].filter(Boolean);

  const preview = rules.previewEra ? eraPreviewColors(rules.previewEra).map((c) => ({ id: c.id, name: c.name, hex: c.hex, note: c.note })) : [];

  return {
    id: ev.id, name: ev.name, regionId: ev.region, regionName: region, families: ev.palette.slice(), familiesText: fams,
    points, sources, next, track, twist, limited: { total: limitedIds.length, found, ways }, preview,
  };
}
