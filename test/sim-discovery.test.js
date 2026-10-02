import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  tryDiscover, discover, undiscoveredNear, shimmerHints, nameColor, displayName, discoveredCount,
  discoveredColors, pinColor, unpinColor, mixAtBench, availablePigments,
} from '../src/sim/discovery.js';
import { CATALOG } from '../src/content/catalog.js';
import { deltaEHex, oklchToHex, hexToOklch } from '../src/color.js';

const NOW = Date.UTC(2026, 9, 2, 12);

test('discovery: tryDiscover finds a mixable color within ΔE 4, not farther', () => {
  const s = createInitialState(NOW, 9);
  const orange = CATALOG.find((c) => c.id === 'orange');
  assert.ok(orange);
  // A hex about ΔE 2 from orange.
  const lch = hexToOklch(orange.hex);
  const nearHex = oklchToHex({ ...lch, L: lch.L + 0.015 });
  assert.ok(deltaEHex(nearHex, orange.hex) < 4);
  const near = undiscoveredNear(s, nearHex, 4, { method: 'bench' });
  assert.ok(near);
  const d = tryDiscover(s, { hex: nearHex, method: 'bench' }, NOW);
  assert.ok(d, 'discovered');
  assert.ok(s.catalog.discovered[d.colorId]);
  assert.equal(typeof d.suggestedName, 'string');
  assert.equal(s.lifetime.discoveries, 1);
  assert.ok(s._events.some((e) => e.type === 'discover' && e.colorId === d.colorId));
  // Already found: nothing new at the same spot (unless another cell is that close).
  const again = tryDiscover(s, { hex: orange.hex, method: 'bench' }, NOW);
  if (again) assert.notEqual(again.colorId, d.colorId);
  // Far from anything: a pure grey far from the catalog is unlikely to be within 4 of a mixable cell.
  const far = CATALOG.every((c) => deltaEHex('#00ff00', c.hex) > 4);
  if (far) assert.equal(tryDiscover(s, { hex: '#00ff00', method: 'bench' }, NOW), null);
  assert.equal(discover(s, { colorId: d.colorId }, NOW), null, 'no double discovery');
});

test('discovery: catalog milestone at 10 colors', () => {
  const s = createInitialState(NOW, 9);
  const todo = CATALOG.filter((c) => !s.catalog.discovered[c.id]).slice(0, 7);
  let milestone = null;
  for (const c of todo) {
    const r = discover(s, { colorId: c.id, method: 'hunt' }, NOW);
    if (r.milestone) milestone = r.milestone;
  }
  assert.equal(discoveredCount(s), 10);
  assert.deepEqual({ kind: milestone.kind, level: milestone.level }, { kind: 'catalog', level: 1 });
  assert.ok(s._events.some((e) => e.type === 'milestone' && e.kind === 'catalog' && e.level === 1));
  assert.equal(discoveredColors(s).length, 10);
});

test('discovery: nameColor validates, rejects taken names, shows her names', () => {
  const s = createInitialState(NOW, 9);
  discover(s, { colorId: 'orange', method: 'bench' }, NOW);
  assert.equal(nameColor(s, { colorId: 'orange', name: 'Madder' }).reason, 'taken');
  assert.equal(nameColor(s, { colorId: 'orange', name: 'madder' }).reason, 'taken');
  assert.equal(nameColor(s, { colorId: 'orange', name: '   ' }).ok, false);
  const r = nameColor(s, { colorId: 'orange', name: 'Marigold Morning' });
  assert.equal(r.ok, true);
  assert.equal(displayName(s, 'orange'), 'Marigold Morning');
  assert.equal(s.catalog.discovered.orange.custom, true);
  assert.equal(nameColor(s, { colorId: 'not-found', name: 'X' }).ok, false);
});

test('discovery: pins (max 3), bench mixing and pigments', () => {
  const s = createInitialState(NOW, 9);
  const missing = CATALOG.filter((c) => !s.catalog.discovered[c.id]).slice(0, 4);
  for (const c of missing.slice(0, 3)) assert.equal(pinColor(s, { colorId: c.id }).ok, true);
  assert.equal(pinColor(s, { colorId: missing[3].id }).ok, false);
  unpinColor(s, { colorId: missing[0].id });
  assert.equal(s.catalog.pinned.length, 2);
  const pigs = availablePigments(s).map((p) => p.id);
  assert.deepEqual(pigs, ['madder', 'ochre', 'woad', 'white', 'black']);
  const res = mixAtBench(s, { parts: [{ id: 'madder', hex: '#b8433a', weight: 1 }, { id: 'ochre', hex: '#d39b2a', weight: 1 }] }, NOW);
  assert.match(res.hex, /^#[0-9a-f]{6}$/);
  assert.ok(Array.isArray(res.hints) && res.hints.length <= 3);
  assert.ok(Array.isArray(shimmerHints(s, '#888888')));
});
