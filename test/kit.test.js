// kit.h: escaping and booleans (attribute values say "true"/"false"; content drops them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, raw } from '../src/ui/kit.js';

test('kit.h stringifies booleans inside quoted attributes', () => {
  assert.equal(String(h`<b aria-pressed="${true}" aria-selected='${false}'></b>`), `<b aria-pressed="true" aria-selected='false'></b>`);
  assert.equal(String(h`<b aria-pressed="${1 === 2}">x</b>`), '<b aria-pressed="false">x</b>');
});

test('kit.h drops booleans, null and undefined in content and escapes text', () => {
  assert.equal(String(h`<p>${false}${true}${null}${undefined}</p>`), '<p></p>');
  assert.equal(String(h`<p>${false && h`<i>no</i>`}${'<x>'}${raw('<y>')}</p>`), '<p>&lt;x&gt;<y></p>');
});

test('kit icons: each currency has its own mark', async () => {
  const { iconSvg, ICON_NAMES } = await import('../src/ui/kit.js');
  const names = ['seal', 'heritage', 'essence', 'reputation', 'star', 'coin'];
  for (const n of names) assert.ok(ICON_NAMES.includes(n), `icon ${n} exists`);
  const bodies = names.map((n) => String(iconSvg(n, { size: 16 })));
  for (const b of bodies) assert.match(b, /^<svg class="icon /);
  assert.equal(new Set(bodies).size, names.length, 'no two currency icons are the same drawing');
});

test('kit lockTag and fadeStrip', async () => {
  const { lockTag, tag, fadeStrip, h } = await import('../src/ui/kit.js');
  assert.equal(String(lockTag('4 more colors')), String(tag('4 more colors', { icon: 'lock' })));
  const s = String(fadeStrip(h`<button>A & B</button>`, { label: 'Pages' }));
  assert.match(s, /^<div class="strip "/);
  assert.match(s, /aria-label="Pages"/);
  assert.match(s, /<button>A & B<\/button>/);
  assert.match(String(fadeStrip('<b>')), /&lt;b&gt;/, 'plain strings are escaped');
});
