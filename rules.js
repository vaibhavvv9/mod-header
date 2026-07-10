// Pure logic: header-name validation, domain parsing, and declarativeNetRequest
// rule computation. No chrome.* APIs here so it can run under node --test.

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

// Chrome's dynamic and session rules share one id space; keep them apart.
const SESSION_ID_OFFSET = 10000;

export function isValidHeaderName(name) {
  return TOKEN_RE.test(name);
}

export function isActiveHeader(h) {
  return h.enabled && h.value !== '' && isValidHeaderName(h.name);
}

export function parseDomains(str) {
  const out = [];
  for (let part of (str || '').split(',')) {
    part = part.trim().toLowerCase();
    part = part.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
    part = part.split('/')[0].split(':')[0].replace(/\.$/, ''); // path, port, trailing dot
    if (part !== '' && HOSTNAME_RE.test(part) && !out.includes(part)) out.push(part);
  }
  return out;
}

function toRule(h, id) {
  const condition = { urlFilter: '*' };
  const domains = parseDomains(h.domains);
  if (domains.length > 0) condition.requestDomains = domains;
  if (h.tabId != null) condition.tabIds = [h.tabId];
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: h.name, operation: 'set', value: h.value }],
    },
    condition,
  };
}

// Tab-scoped headers need session rules (only session rules support tabIds);
// everything else persists as dynamic rules.
export function buildRuleSets(state) {
  const dynamic = [];
  const session = [];
  if (!state.paused) {
    for (const h of state.headers.filter(isActiveHeader)) {
      if (h.tabId != null) {
        session.push(toRule(h, SESSION_ID_OFFSET + session.length + 1));
      } else {
        dynamic.push(toRule(h, dynamic.length + 1));
      }
    }
  }
  return { dynamic, session };
}
