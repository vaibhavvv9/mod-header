// Pure logic: header-name validation and declarativeNetRequest rule computation.
// No chrome.* APIs here so it can run under node --test.

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function isValidHeaderName(name) {
  return TOKEN_RE.test(name);
}

export function isActiveHeader(h) {
  return h.enabled && h.value !== '' && isValidHeaderName(h.name);
}

export function buildRules(state) {
  if (state.paused) return [];
  return state.headers
    .filter(isActiveHeader)
    .map((h, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: h.name, operation: 'set', value: h.value }],
      },
      // No resourceTypes: an omitted list matches every resource type, current and future
      condition: { urlFilter: '*' },
    }));
}
