// Quests and events UX (playtest: "tapping a quest should explain how to do it and take you
// there"): every quest type, weekly step, event-point source and twist has a how-to and a
// real destination; bouquet orders (Bloom Week); the Era 2 preview (Neon Night); the event
// region's limited colors; themed points for orders and packed crates; board styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../src/state.js';
import { QUEST_TYPES, WEEKLY_QUESTS, QUEST_HOW, ALL_QUEST_EVENTS, NEED_KEYS, eligibleQuestTypes } from '../src/content/quests.js';
import { EVENTS, POINTS_PER, EVENT_POINT_HOW } from '../src/content/events.js';
import { ERA_PREVIEW_COLORS } from '../src/content/eras.js';
import { questGuide, eventGuide, requirement, GO_SCREENS, pointKinds } from '../src/sim/howto.js';
import { currentEvent, eventPoints, eraPreview, eventPalette, isThemed } from '../src/sim/events.js';
import {
  generateOrder, refreshOrders, submitOrder, autoFillOrders, makeBouquet, bouquetStock,
  BOUQUET_JARS, BOUQUET_FLOWERS,
} from '../src/sim/orders.js';
import { unlocksOf, rollWeekly } from '../src/sim/quests.js';
import { discoverableColors } from '../src/sim/discovery.js';
import { addStock, keepOf } from '../src/sim/storage.js';
import { colorDef } from '../src/sim/economy.js';
import { eventColors, knowsColor } from '../src/sim/hunters.js';
import { mulberry32 } from '../src/rng.js';
import { hueFamily, hexToOklch } from '../src/color.js';
import * as grading from '../src/puzzles/grading.js';

const WEEK = 7 * 86400e3;
const W40 = Date.UTC(2026, 8, 30, 12); // ISO week 40: autumn-harvest; +2 weeks bloom-week, +3 neon-night
const weekOf = (id) => W40 + EVENTS.findIndex((e) => e.id === id) * WEEK;

const SCREENS = new Set([...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/data-screen="([a-z-]+)"/g)].map((m) => m[1]));

function validGo(go, where) {
  assert.ok(go && typeof go.screen === 'string', `${where}: go`);
  assert.ok(SCREENS.has(go.screen), `${where}: ${go.screen} is a screen in index.html`);
  assert.ok(GO_SCREENS.includes(go.screen), `${where}: ${go.screen} in GO_SCREENS`);
  assert.equal(typeof go.params, 'object', `${where}: params`);
}

function eventState(id, seed = 7) {
  const now = weekOf(id);
  const s = createInitialState(now, seed);
  currentEvent(s, now);
  assert.equal(s.event.key, id);
  return { s, now };
}

test('how-to: every quest hook, quest type and weekly step says how and where', () => {
  for (const ev of ALL_QUEST_EVENTS) {
    const hw = QUEST_HOW[ev];
    assert.ok(hw && hw.how.length > 20 && hw.cta, `${ev}: how`);
    validGo(hw.go, ev);
    if (hw.needs) assert.ok(NEED_KEYS.includes(hw.needs), `${ev}: needs`);
  }
  for (const t of QUEST_TYPES) {
    assert.ok(t.how && t.cta, `${t.id}: how`);
    validGo(t.go, t.id);
  }
  for (const w of WEEKLY_QUESTS) {
    for (const st of w.steps) {
      assert.ok(st.how && st.cta, `${w.id}/${st.text}: how`);
      validGo(st.go, `${w.id}/${st.text}`);
    }
  }
  for (const n of NEED_KEYS) {
    const r = requirement(createInitialState(W40, 1), n);
    assert.ok(r && r.text && r.cta, `${n}: a fresh game explains it`);
    validGo(r.go, `need ${n}`);
  }
});

test('how-to: every event-point source and every twist says how and where', () => {
  for (const kind of Object.keys(POINTS_PER)) {
    const src = EVENT_POINT_HOW[kind];
    assert.ok(src && src.label && src.how && src.cta, `${kind}: how`);
    validGo(src.go, `points ${kind}`);
  }
  for (const ev of EVENTS) {
    assert.ok(ev.twist.how && ev.twist.cta, `${ev.id}: twist how`);
    validGo(ev.twist.go, `${ev.id} twist`);
    const { s } = eventState(ev.id);
    const g = eventGuide(s);
    assert.equal(g.id, ev.id);
    assert.deepEqual(g.sources.map((x) => x.kind), pointKinds(ev));
    assert.equal(g.sources.some((x) => x.kind === 'bouquet'), ev.id === 'bloom-week', 'bouquet points only under its twist');
    for (const x of g.sources) {
      validGo(x.go, `${ev.id} ${x.kind}`);
      assert.doesNotMatch(x.how, /\{families\}/);
      if (x.need) validGo(x.need.go, `${ev.id} ${x.kind} need`);
    }
    assert.equal(g.track.length, 10);
    for (const t of g.track) assert.ok(t.reward.label, `${ev.id} step ${t.step}`);
    // The next step reads in actions ("about 1 board"), not just points.
    assert.equal(g.next.step, 1);
    assert.ok(g.next.actions.length >= 2);
    assert.ok(g.next.actions.every((a) => a.n >= 1 && /\d+ \w/.test(a.text)));
    assert.equal(g.limited.total, 12);
    for (const w of g.limited.ways) if (w.go) validGo(w.go, `${ev.id} limited`);
    validGo(g.twist.go, `${ev.id} twist guide`);
    assert.equal(g.preview.length > 0, !!ev.twist.rules.previewEra);
  }
});

test('how-to: a targeted quest goes to the exact place; requirements clear once open', () => {
  const s = createInitialState(W40, 3);
  const g = questGuide(s, { type: 'send-hunter', event: 'hunterSent', region: 'coast', target: 1, progress: 0 });
  assert.deepEqual(g.go, { screen: 'map', params: { regionId: 'coast' } });
  assert.match(g.how, /Coast/);
  assert.ok(g.need && g.need.need === 'hunters', 'hunters are not bought in a fresh game');
  assert.match(g.need.text, /coins/);
  s.unlocks = { ...(s.unlocks || {}), hunters: true };
  assert.equal(questGuide(s, { event: 'hunterSent', target: 1 }).need, null);
  const b = questGuide(s, { type: 'solve-board', event: 'boardSolved', target: 2, progress: 1 });
  assert.deepEqual(b.go, { screen: 'puzzles', params: { puzzle: 'grading' } });
  assert.equal(b.left, 1);
  assert.equal(b.need, null);
});

test('dailies only ask for what she can do now: shipping waits for the Loading Yard', () => {
  const s = createInitialState(W40, 4);
  s.stations.fleet = [{ kind: 'handcart', level: 1, route: null, departedAt: 0, arrivesAt: 0, cargo: null }];
  assert.equal(unlocksOf(s).fleet, false, 'a vehicle alone does not open shipping');
  const ids = eligibleQuestTypes(unlocksOf(s)).map((t) => t.id);
  for (const id of ['ship-crates', 'send-hunter', 'merge-bottle', 'paint-regions', 'purify-batch']) assert.ok(!ids.includes(id), id);
  s.rooms.push('loading-yard');
  assert.equal(unlocksOf(s).fleet, true);
});

test('weekly quest: a "discover N of a family" step is only dealt when that many are left', () => {
  const s = createInitialState(W40, 5);
  // Discover every blue she could find: Five Blues and Ocean Week are not dealt.
  for (const c of discoverableColors(s)) if (c.family === 'blue' || hueFamily(c.hex) === 'blue') s.catalog.discovered[c.id] = { at: 0, name: c.name };
  for (let w = 0; w < 6; w++) {
    s.quests.weeklyKey = null;
    const wq = rollWeekly(s, W40 + w * WEEK);
    assert.ok(!wq.steps.some((st) => st.family === 'blue'), `week ${w}: ${wq.id}`);
  }
});

test('bouquet orders: about 1 in 3 new orders during Bloom Week, none otherwise', () => {
  const { s, now } = eventState('bloom-week');
  const rng = mulberry32(11);
  let bouquets = 0;
  for (let i = 0; i < 90; i++) {
    const o = generateOrder(s, rng, now);
    if (o.kind !== 'bouquet') continue;
    bouquets++;
    assert.ok(o.flowers.length >= 2 && o.flowers.length <= BOUQUET_FLOWERS);
    for (const f of o.flowers) {
      assert.ok(['pink', 'violet', 'green'].includes(hueFamily(f.target)), `${f.target} is a Bloom family`);
      assert.ok(Array.isArray(f.recipe) && f.recipe.length, 'each flower is a real recipe');
      assert.equal(f.filled, false);
    }
  }
  assert.ok(bouquets >= 15 && bouquets <= 45, `${bouquets}/90 bouquets`);
  const other = eventState('autumn-harvest').s;
  for (let i = 0; i < 40; i++) assert.notEqual(generateOrder(other, rng, weekOf('autumn-harvest')).kind, 'bouquet');
});

function bouquetOn(s, now) {
  const flowers = makeBouquet(s, mulberry32(5), ['pink', 'violet', 'green'], []);
  assert.ok(flowers && flowers.length >= 2);
  const o = { id: 'o-bq', kind: 'bouquet', target: flowers[0].target, recipe: null, flowers, event: 'bloom-week', pay: 0, minutes: 3, container: null, postedAt: now, customer: 'Test' };
  s.orders.open.push(o);
  return o;
}

test('bouquet orders: fill each flower by mixing or from stock; the whole bouquet earns points', () => {
  const { s, now } = eventState('bloom-week');
  const o = bouquetOn(s, now);
  const filledBefore = s.orders.filledCount;
  const coins0 = s.coins;
  // Flower 0: a perfect mix.
  const r0 = submitOrder(s, { orderId: o.id, flower: 0, hex: o.flowers[0].target }, now);
  assert.ok(r0.ok && r0.tier === 'perfect' && r0.coins > 0);
  assert.equal(r0.bouquet.complete, false);
  assert.ok(s.coins > coins0);
  assert.equal(s.event.points, 0, 'no points until the bouquet is complete');
  assert.ok(s.orders.open.some((x) => x.id === o.id), 'a part-filled bouquet waits on the board');
  assert.equal(submitOrder(s, { orderId: o.id, flower: 0, hex: '#000000' }, now).ok, false, 'a filled flower stays filled');
  // Flower 1: from stock (a close color, BOUQUET_JARS jars).
  const f1 = o.flowers[1];
  if (f1.colorId) {
    assert.equal(keepOf(s, f1.colorId), BOUQUET_JARS, 'the shop keeps a flower\'s jars back');
    addStock(s, f1.colorId, BOUQUET_JARS + 2);
    const cand = bouquetStock(s, f1);
    assert.equal(cand[0].colorId, f1.colorId);
    const r1 = submitOrder(s, { orderId: o.id, flower: 1, colorId: f1.colorId }, now);
    assert.ok(r1.ok && r1.tier === 'perfect' && r1.fromStock === f1.colorId);
    assert.ok(Math.abs(s.stock[f1.colorId].jars - 2) < 1e-9, 'three jars handed over');
  } else {
    assert.equal(submitOrder(s, { orderId: o.id, flower: 1, colorId: 'no-such-color' }, now).ok, false);
    submitOrder(s, { orderId: o.id, flower: 1, hex: f1.target }, now);
  }
  for (let i = 2; i < o.flowers.length; i++) submitOrder(s, { orderId: o.id, flower: i, hex: o.flowers[i].target }, now);
  assert.ok(!s.orders.open.some((x) => x.id === o.id), 'a complete bouquet leaves the board');
  assert.equal(s.orders.filledCount, filledBefore + 1, 'one bouquet is one filled order');
  assert.equal(s.event.points, POINTS_PER.bouquet);
});

test('bouquet orders: a stocked color too far from the flower is not accepted', () => {
  const { s, now } = eventState('bloom-week');
  const o = bouquetOn(s, now);
  addStock(s, 'woad', 10);
  const far = hueFamily(colorDef('woad').hex) !== hueFamily(o.flowers[0].target);
  if (far) assert.equal(submitOrder(s, { orderId: o.id, flower: 0, colorId: 'woad' }, now).ok, false);
  assert.equal(submitOrder(s, { orderId: o.id, flower: 9, hex: '#ffffff' }, now).ok, false);
});

test('bouquet orders: the Order Clerk never fills one', () => {
  const { s, now } = eventState('bloom-week');
  s.orders.open = [];
  const o = bouquetOn(s, now);
  s.apprentices.orderClerk = true;
  for (const f of o.flowers) if (f.colorId) addStock(s, f.colorId, 50);
  for (const id of Object.keys(s.catalog.discovered)) if (colorDef(id)?.hex) addStock(s, id, 50);
  autoFillOrders(s, now);
  autoFillOrders(s, now + 3 * 3600e3);
  const still = s.orders.open.find((x) => x.id === o.id);
  assert.ok(still, 'the bouquet is still on the board');
  assert.ok(still.flowers.every((f) => !f.filled));
});

test('event points: orders count by their color, packed crates count under Lanterns', () => {
  const { s } = eventState('bloom-week');
  assert.equal(isThemed(s, { hex: '#d0557f' }), true);   // a pink target
  assert.equal(isThemed(s, { hex: '#e47600' }), false);  // an orange one
  assert.equal(eventPoints(s, 'order', 1, { hex: '#65a64d' }), POINTS_PER.order);
  const L = eventState('festival-of-lanterns').s;
  assert.equal(eventPoints(L, 'crate', 1, { packed: true, colors: ['woad'] }), POINTS_PER.crate, 'packing strings lanterns');
  assert.equal(eventPoints(L, 'crate', 1, { packed: false, colors: ['woad'] }), 0);
  assert.equal(eventPoints(s, 'crate', 1, { packed: true, colors: ['woad'] }), 0, 'packing only counts on its own under Lanterns');
});

test('previewEra: Neon Night shows a few Era 2 colors on its boards and page, never in the catalog', () => {
  const { s } = eventState('neon-night');
  const prev = eraPreview(s);
  assert.ok(prev.length >= 3 && prev.every((c) => c.era === 2));
  const pal = eventPalette(s);
  for (const c of prev) assert.ok(pal.includes(c.hex), `${c.name} is on this week's boards`);
  const discoverable = new Set(discoverableColors(s).map((c) => c.id));
  for (const c of ERA_PREVIEW_COLORS) assert.ok(!discoverable.has(c.id), 'previews are never discovered');
  assert.deepEqual(eraPreview(eventState('bloom-week').s), []);
});

test('limited colors: a trip to the event region can bring one home', async () => {
  const { resolveReturns } = await import('../src/sim/hunters.js');
  const { s, now } = eventState('bloom-week', 9);
  s.unlocks = { ...(s.unlocks || {}), hunters: true };
  const { unlockRegions } = await import('../src/sim/hunters.js');
  unlockRegions(s, {}, now);
  currentEvent(s, now);
  const h = s.hunters.roster[0];
  assert.ok(h, 'a hunter is seated');
  let found = 0;
  for (let i = 0; i < 12; i++) {
    h.state = 'out';
    h.trip = { region: 'garden', duration: 'overnight', departedAt: now, returnsAt: now + 1, choice: null };
    const before = eventColors('bloom-week').filter((c) => knowsColor(s, c.id)).length;
    resolveReturns(s, now + 2);
    if (eventColors('bloom-week').filter((c) => knowsColor(s, c.id)).length > before) found++;
  }
  assert.ok(found >= 6, `${found}/12 overnight trips found a limited color`);
});

test('board styles: sunset boards are light at the top, ink boards are one hue', () => {
  for (const tier of grading.TIER_NAMES) {
    for (let k = 0; k < 4; k++) {
      const sun = grading.createBoard({ tier, shape: 'sunset' }, mulberry32(100 + k));
      assert.equal(sun.style, 'sunset');
      const L = (hx) => hexToOklch(hx).L;
      assert.ok(L(sun.corners.tl) + L(sun.corners.tr) > L(sun.corners.bl) + L(sun.corners.br), 'honey light on top');
      const ink = grading.createBoard({ tier, shape: 'scroll', palette: ['#243163'] }, mulberry32(200 + k));
      assert.equal(ink.style, 'ink');
      const hues = Object.values(ink.corners).map((hx) => hexToOklch(hx)).filter((c) => c.C > 0.03).map((c) => c.h);
      assert.ok(Math.max(...hues) - Math.min(...hues) < 12, `one ink: ${hues.join(',')}`);
      assert.ok(!sun.belowFloor && !ink.belowFloor);
    }
  }
  // Every event's board frame is a real shape.
  for (const ev of EVENTS) if (ev.twist.rules.boardShape) assert.ok(grading.SHAPES.includes(ev.twist.rules.boardShape), ev.id);
});
