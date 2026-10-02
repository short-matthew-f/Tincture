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
