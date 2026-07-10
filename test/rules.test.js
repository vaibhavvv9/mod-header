import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHeaderName, buildRules } from '../rules.js';

const header = (over = {}) => ({
  id: 'uuid-1',
  name: 'X-Test',
  value: 'v',
  enabled: true,
  ...over,
});

test('isValidHeaderName accepts RFC 7230 tokens', () => {
  for (const name of ['Authorization', 'X-Debug-Mode', 'x_custom', 'a', "!#$%&'*+.^_`|~0-9A-Za-z-"]) {
    assert.equal(isValidHeaderName(name), true, name);
  }
});

test('isValidHeaderName rejects invalid names', () => {
  for (const name of ['', 'has space', 'colon:name', 'quote"', 'naïve', 'a\tb', '(paren)']) {
    assert.equal(isValidHeaderName(name), false, JSON.stringify(name));
  }
});

test('buildRules returns [] when paused', () => {
  const state = { paused: true, headers: [header()] };
  assert.deepEqual(buildRules(state), []);
});

test('buildRules skips disabled, empty-name, invalid-name, and empty-value headers', () => {
  const state = {
    paused: false,
    headers: [
      header({ enabled: false }),
      header({ name: '' }),
      header({ name: 'bad name' }),
      header({ value: '' }),
    ],
  };
  assert.deepEqual(buildRules(state), []);
});

test('buildRules produces set-header rules with sequential ids', () => {
  const state = {
    paused: false,
    headers: [
      header({ name: 'Authorization', value: 'Bearer abc' }),
      header({ id: 'uuid-2', name: 'X-Debug', value: 'true', enabled: false }),
      header({ id: 'uuid-3', name: 'X-Trace-Id', value: '123' }),
    ],
  };
  const rules = buildRules(state);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  assert.equal(rules[0].priority, 1);
  assert.equal(rules[0].action.type, 'modifyHeaders');
  assert.deepEqual(rules[0].action.requestHeaders, [
    { header: 'Authorization', operation: 'set', value: 'Bearer abc' },
  ]);
  assert.equal(rules[1].action.requestHeaders[0].header, 'X-Trace-Id');
  assert.equal(rules[0].condition.urlFilter, '*');
  assert.equal(rules[0].condition.resourceTypes, undefined);
});
