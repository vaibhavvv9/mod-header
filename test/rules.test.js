import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHeaderName, parseDomains, buildRuleSets } from '../rules.js';

const header = (over = {}) => ({
  id: 'uuid-1',
  name: 'X-Test',
  value: 'v',
  enabled: true,
  domains: '',
  tabIds: [],
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

test('parseDomains splits, trims, lowercases, and dedups', () => {
  assert.deepEqual(
    parseDomains('Example.com, api.foo.com,  ,example.com'),
    ['example.com', 'api.foo.com'],
  );
});

test('parseDomains strips scheme, path, and port from pasted URLs', () => {
  assert.deepEqual(parseDomains('https://example.com/some/path'), ['example.com']);
  assert.deepEqual(parseDomains('http://api.foo.com:8080'), ['api.foo.com']);
});

test('parseDomains drops invalid hostnames and handles empty/missing input', () => {
  assert.deepEqual(parseDomains('not a domain, -bad.com, good.example.com'), ['good.example.com']);
  assert.deepEqual(parseDomains(''), []);
  assert.deepEqual(parseDomains(undefined), []);
});

test('buildRuleSets returns empty sets when paused', () => {
  const state = { paused: true, headers: [header()] };
  assert.deepEqual(buildRuleSets(state), { dynamic: [], session: [] });
});

test('buildRuleSets skips disabled, empty-name, invalid-name, and empty-value headers', () => {
  const state = {
    paused: false,
    headers: [
      header({ enabled: false }),
      header({ name: '' }),
      header({ name: 'bad name' }),
      header({ value: '' }),
    ],
  };
  assert.deepEqual(buildRuleSets(state), { dynamic: [], session: [] });
});

test('buildRuleSets produces set-header dynamic rules with sequential ids', () => {
  const state = {
    paused: false,
    headers: [
      header({ name: 'Authorization', value: 'Bearer abc' }),
      header({ id: 'uuid-2', name: 'X-Debug', value: 'true', enabled: false }),
      header({ id: 'uuid-3', name: 'X-Trace-Id', value: '123' }),
    ],
  };
  const { dynamic, session } = buildRuleSets(state);
  assert.equal(session.length, 0);
  assert.equal(dynamic.length, 2);
  assert.deepEqual(dynamic.map((r) => r.id), [1, 2]);
  assert.equal(dynamic[0].priority, 1);
  assert.equal(dynamic[0].action.type, 'modifyHeaders');
  assert.deepEqual(dynamic[0].action.requestHeaders, [
    { header: 'Authorization', operation: 'set', value: 'Bearer abc' },
  ]);
  assert.equal(dynamic[1].action.requestHeaders[0].header, 'X-Trace-Id');
  assert.equal(dynamic[0].condition.urlFilter, '*');
  assert.equal(dynamic[0].condition.resourceTypes, undefined);
});

test('domain filter becomes a requestDomains condition; empty filter omits it', () => {
  const state = {
    paused: false,
    headers: [
      header({ domains: 'example.com, api.foo.com' }),
      header({ id: 'uuid-2', name: 'X-Other' }),
    ],
  };
  const { dynamic } = buildRuleSets(state);
  assert.deepEqual(dynamic[0].condition.requestDomains, ['example.com', 'api.foo.com']);
  assert.equal(dynamic[1].condition.requestDomains, undefined);
});

test('a domain filter with no valid domains is treated as no filter', () => {
  const state = { paused: false, headers: [header({ domains: 'not a domain' })] };
  const { dynamic } = buildRuleSets(state);
  assert.equal(dynamic[0].condition.requestDomains, undefined);
});

test('tab-scoped headers become session rules with tabIds and offset ids', () => {
  const state = {
    paused: false,
    headers: [
      header({ name: 'X-Global', value: '1' }),
      header({ id: 'uuid-2', name: 'X-TabOnly', value: '2', tabIds: [42] }),
    ],
  };
  const { dynamic, session } = buildRuleSets(state);
  assert.equal(dynamic.length, 1);
  assert.equal(session.length, 1);
  assert.deepEqual(session[0].condition.tabIds, [42]);
  // Session ids are offset because Chrome's dynamic and session rules share one id space
  assert.equal(session[0].id, 10001);
  assert.equal(session[0].action.requestHeaders[0].header, 'X-TabOnly');
});

test('a header can be pinned to multiple tabs with one session rule', () => {
  const state = { paused: false, headers: [header({ tabIds: [7, 9, 12] })] };
  const { dynamic, session } = buildRuleSets(state);
  assert.equal(dynamic.length, 0);
  assert.equal(session.length, 1);
  assert.deepEqual(session[0].condition.tabIds, [7, 9, 12]);
});

test('tab filter and domain filter combine on one rule', () => {
  const state = {
    paused: false,
    headers: [header({ domains: 'example.com', tabIds: [7] })],
  };
  const { dynamic, session } = buildRuleSets(state);
  assert.equal(dynamic.length, 0);
  assert.deepEqual(session[0].condition.requestDomains, ['example.com']);
  assert.deepEqual(session[0].condition.tabIds, [7]);
});
