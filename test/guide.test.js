// guide.js pure parts: step hygiene, seen persistence, bubble placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSteps, stepKind, wordCount, markGuideSeen, isSeen, noteCoachDismissed, placeBubble, rectsIntersect,
  guide, MAX_WORDS,
} from '../src/ui/guide.js';

const info = (t = 'A short line.') => ({ anchor: '[data-coach=a]', text: t });
const act = (t = 'Drag a vial onto its twin.') => ({ anchor: '[data-coach=b]', text: t, endsOn: 'action' });

test('stepKind: action when it can end on one, Got it otherwise', () => {
  assert.equal(stepKind(info()), 'got-it');
  assert.equal(stepKind(act()), 'action');
  assert.equal(stepKind({ anchor: 'x', text: 'y', event: 'merged' }), 'action');
  assert.equal(stepKind({ anchor: 'x', text: 'y', done: () => false }), 'action');
  assert.equal(stepKind({ anchor: 'x', text: 'y', done: () => false, endsOn: 'got-it' }), 'got-it');
});

test('validateSteps: at most 2 steps before the first action', () => {
  const ok = validateSteps([info(), info(), act(), info()]);
  assert.equal(ok.ok, true);
  assert.equal(ok.steps.length, 4);
  const tooMany = validateSteps([info('one'), info('two'), info('three'), act('do it')]);
  assert.equal(tooMany.ok, false);
  assert.deepEqual(tooMany.steps.map((s) => s.text), ['one', 'two', 'do it'], 'the extra leading info step is dropped');
  assert.match(tooMany.problems.join(' '), /before the first action/);
  const noAction = validateSteps([info('a'), info('b'), info('c')]);
  assert.equal(noAction.steps.length, 2);
  assert.equal(validateSteps([act(), info(), info(), info()]).steps.length, 4, 'after an action, more info steps are fine');
});

test('validateSteps: 15 words a step, an anchor and text each', () => {
  assert.equal(wordCount('  Drag   a vial onto its twin. '), 6);
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  assert.equal(wordCount(long), MAX_WORDS + 1);
  const v = validateSteps([info(long), { text: 'no anchor' }, { anchor: 'x' }]);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /16 words/);
  assert.ok(v.problems.some((p) => /no anchor/.test(p)));
  assert.ok(v.problems.some((p) => /no text/.test(p)));
  assert.equal(validateSteps([info('exactly fifteen words is fine one two three four five six seven eight nine ten')]).ok, true);
});

function fakeGame(state = {}) {
  const listeners = new Map();
  return {
    state,
    acts: [],
    act(fn, args) { this.acts.push(fn.name); const r = fn(this.state, args, 0); this.emit('change', this.state); return r; },
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
    emit(type, p) { for (const fn of listeners.get(type) || []) fn(p); },
  };
}

test('seen persists through a fake act and stops the guide from running again', () => {
  const game = fakeGame({ onboarding: { step: 3, done: true, flags: {} } });
  assert.equal(isSeen(game.state, 'shelf'), false);
  game.act(markGuideSeen, { id: 'shelf' });
  assert.deepEqual(game.state.onboarding.seen, { shelf: true });
  assert.equal(isSeen(game.state, 'shelf'), true);
  assert.equal(game.state.onboarding.step, 3, 'the onboarding script is untouched');
  // A save without onboarding.seen (v1) gets it on first use.
  const bare = {};
  markGuideSeen(bare, { id: 'map' });
  assert.equal(bare.onboarding.seen.map, true);
  assert.deepEqual(markGuideSeen(bare, {}), { ok: false });
  // A seen guide does not start; replay() still runs it (no DOM here: it just reports).
  const g = guide('shelf', [act()], { game });
  assert.equal(g.start(), false);
  assert.equal(g.active, false);
});

test('a guide that finishes marks itself seen through ctx.game.act', async () => {
  const game = fakeGame({ onboarding: { seen: {} } });
  const g = guide('purify', [{ anchor: '[data-coach=tube]', text: 'Pour the top layer.', event: 'poured' }], { game });
  assert.equal(g.start(), true);
  assert.equal(g.step, 0);
  game.emit('poured');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(game.state.onboarding.seen.purify, true);
  assert.ok(game.acts.includes('markGuideSeen'));
  assert.equal(g.active, false);
});

test('noteCoachDismissed counts locally', () => {
  const s = { stats: { lines: 2 } };
  noteCoachDismissed(s);
  noteCoachDismissed(s);
  assert.equal(s.stats.coachDismissed, 2);
  assert.equal(s.stats.lines, 2);
});

test('placeBubble never covers its anchor or the next target when there is room, and flips side', () => {
  const vp = { width: 390, height: 844 };
  const size = { width: 296, height: 90 };
  const r = (left, top, w, hgt) => ({ left, top, right: left + w, bottom: top + hgt, width: w, height: hgt });
  // Preferred above, room above: above.
  const a = r(40, 400, 120, 60);
  const p1 = placeBubble(a, size, vp, { side: 'above' });
  assert.equal(p1.side, 'above');
  assert.equal(rectsIntersect(p1.rect, a), 0);
  assert.ok(p1.rect.bottom <= a.top);
  // Preferred above but the anchor sits at the top: flips below.
  const top = r(40, 30, 120, 50);
  const p2 = placeBubble(top, size, vp, { side: 'above' });
  assert.equal(p2.side, 'below');
  assert.equal(p2.covers, false);
  // The next target sits right below the anchor: the bubble goes above.
  const next = r(40, 472, 300, 120);
  const p3 = placeBubble(a, size, vp, { side: 'below', avoid: [next] });
  assert.equal(p3.side, 'above');
  assert.equal(p3.blocksNext, false);
  // Stays on screen horizontally.
  const edge = r(350, 400, 30, 30);
  const p4 = placeBubble(edge, size, vp, {});
  assert.ok(p4.left >= 8 && p4.rect.right <= 390 - 8);
  assert.ok(p4.arrowX <= size.width - 16);
  // A huge anchor (a whole board) with no room either side: covers as little as it can.
  const board = r(0, 60, 390, 760);
  const p5 = placeBubble(board, size, vp, { side: 'above' });
  assert.equal(p5.covers, true);
  assert.ok(p5.rect.top >= 8 && p5.rect.bottom <= vp.height - 8);
});
