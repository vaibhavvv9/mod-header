import { buildRuleSets, isValidHeaderName, isActiveHeader, parseDomains } from './rules.js';

let state = { paused: false, headers: [] };
let saveTimer = null;
let saveChain = Promise.resolve();
const expandedFilters = new Set();

const FUNNEL_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>';

const listEl = document.getElementById('header-list');
const emptyEl = document.getElementById('empty-state');
const addBtn = document.getElementById('add-header');
const masterBtn = document.getElementById('master-toggle');
const countEl = document.getElementById('active-count');

addBtn.addEventListener('click', () => {
  state.headers.push({
    id: crypto.randomUUID(),
    name: '',
    value: '',
    enabled: true,
    domains: '',
    tabIds: [],
  });
  render();
  listEl.querySelector('.item:last-child .name')?.focus();
  save();
});

masterBtn.addEventListener('click', () => {
  state.paused = !state.paused;
  render();
  save();
});

// Best-effort flush of a pending debounced save before Chrome tears down the popup
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer !== null) save();
});

init();

async function init() {
  try {
    state = await chrome.storage.local.get({ paused: false, headers: [] });
    await reconcileTabPins();
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  } catch (err) {
    console.error('HeaderPilot: failed to load state', err);
  }
  render();
  save(); // re-sync rules from stored state in case a previous save was interrupted
}

// Tab ids are meaningless after a browser restart (and pinned tabs may have
// been closed). storage.session is cleared on restart, so a missing marker
// means every stored tab pin is stale. Dead pins are dropped; a header whose
// pins are ALL gone gets disabled rather than silently becoming global.
async function reconcileTabPins() {
  const { alive } = await chrome.storage.session.get({ alive: false });
  if (!alive) await chrome.storage.session.set({ alive: true });
  for (const h of state.headers) {
    // Migrate the pre-1.1 single-pin shape
    if (!Array.isArray(h.tabIds)) h.tabIds = h.tabId != null ? [h.tabId] : [];
    delete h.tabId;
    if (h.tabIds.length === 0) continue;
    const live = alive
      ? (
          await Promise.all(
            h.tabIds.map((id) => chrome.tabs.get(id).then(() => id).catch(() => null)),
          )
        ).filter((id) => id !== null)
      : [];
    if (live.length < h.tabIds.length) {
      h.tabIds = live;
      if (live.length === 0) h.enabled = false;
    }
  }
}

function render() {
  listEl.replaceChildren(...state.headers.map(renderRow));
  emptyEl.hidden = state.headers.length > 0;
  masterBtn.textContent = state.paused ? 'OFF' : 'ON';
  masterBtn.classList.toggle('on', !state.paused);
  document.body.classList.toggle('paused', state.paused);
  updateCount();
}

function hasFilter(h) {
  return (h.tabIds?.length ?? 0) > 0 || parseDomains(h.domains).length > 0;
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

// Human-readable label for a pinned tab, looked up live so it tracks
// navigation. Falls back gracefully if the tab is gone.
async function describeTab(tabId, max = 40) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return 'closed tab';
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {
    // chrome:// pages etc. — title alone is fine
  }
  const label = tab.title || host || `tab ${tabId}`;
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

function renderRow(h) {
  const item = document.createElement('div');
  item.className = 'item';

  const row = document.createElement('div');
  row.className = 'row' + (h.enabled ? '' : ' off');

  const toggle = document.createElement('button');
  toggle.className = 'switch' + (h.enabled ? ' on' : '');
  toggle.title = h.enabled ? 'Disable header' : 'Enable header';
  toggle.addEventListener('click', () => {
    h.enabled = !h.enabled;
    render();
    save();
  });

  const name = document.createElement('input');
  name.className = 'name';
  name.placeholder = 'Name';
  name.value = h.name;
  name.spellcheck = false;
  name.classList.toggle('invalid', h.name !== '' && !isValidHeaderName(h.name));
  name.addEventListener('input', () => {
    h.name = name.value.trim();
    name.classList.toggle('invalid', h.name !== '' && !isValidHeaderName(h.name));
    updateCount();
    scheduleSave();
  });

  const value = document.createElement('input');
  value.className = 'value';
  value.placeholder = 'Value';
  value.value = h.value;
  value.spellcheck = false;
  value.addEventListener('input', () => {
    h.value = value.value;
    updateCount();
    scheduleSave();
  });
  value.addEventListener('pointerenter', () => {
    if (document.activeElement !== value && value.scrollWidth > value.clientWidth) {
      showTooltip(value, h.value);
    }
  });
  value.addEventListener('pointerleave', hideTooltip);
  value.addEventListener('focus', hideTooltip);

  const filterBtn = document.createElement('button');
  filterBtn.className = 'filter' + (hasFilter(h) ? ' active' : '');
  filterBtn.innerHTML = FUNNEL_SVG; // static markup, no user data
  filterBtn.title = 'Limit to specific sites or the current tab';
  filterBtn.addEventListener('click', () => {
    if (expandedFilters.has(h.id)) expandedFilters.delete(h.id);
    else expandedFilters.add(h.id);
    render();
  });

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '✕';
  del.title = 'Delete header';
  del.addEventListener('click', () => {
    state.headers = state.headers.filter((x) => x.id !== h.id);
    expandedFilters.delete(h.id);
    render();
    save();
  });

  row.append(toggle, name, value, filterBtn, del);
  item.append(row);

  if (!expandedFilters.has(h.id) && hasFilter(h)) {
    const meta = document.createElement('button');
    meta.className = 'filter-meta';
    const domainText = parseDomains(h.domains).join(', ');
    const setMeta = (tabText) => {
      meta.textContent = [domainText, tabText].filter(Boolean).join(' · ');
    };
    const pins = h.tabIds ?? [];
    setMeta(pins.length > 0 ? `${pins.length} tab${pins.length > 1 ? 's' : ''}` : '');
    if (pins.length > 0) {
      Promise.all(pins.map((id) => describeTab(id, 24))).then((labels) =>
        setMeta(`${pins.length > 1 ? 'tabs' : 'tab'}: ${labels.join(', ')}`),
      );
    }
    meta.title = 'Edit filters';
    meta.addEventListener('click', () => {
      expandedFilters.add(h.id);
      render();
    });
    item.append(meta);
  }

  if (expandedFilters.has(h.id)) {
    const panel = document.createElement('div');
    panel.className = 'filter-panel';

    const domains = document.createElement('input');
    domains.className = 'domains';
    domains.placeholder = 'Only on: example.com, api.foo.com — empty = all sites';
    domains.value = h.domains || '';
    domains.spellcheck = false;
    domains.addEventListener('input', () => {
      h.domains = domains.value;
      filterBtn.classList.toggle('active', hasFilter(h));
      scheduleSave();
    });

    const tabRow = document.createElement('div');
    tabRow.className = 'tab-row';

    for (const tabId of h.tabIds ?? []) {
      const chip = document.createElement('span');
      chip.className = 'tab-chip pinned';

      const label = document.createElement('button');
      label.className = 'tab-chip-label';
      label.textContent = `tab ${tabId}`;
      label.title = 'Show this tab';
      describeTab(tabId, 20).then((text) => {
        label.textContent = text;
      });
      label.addEventListener('click', () => focusTab(tabId));

      const unpin = document.createElement('button');
      unpin.className = 'tab-chip-x';
      unpin.textContent = '✕';
      unpin.title = 'Unpin this tab';
      unpin.addEventListener('click', () => {
        h.tabIds = h.tabIds.filter((t) => t !== tabId);
        render();
        save();
      });

      chip.append(label, unpin);
      tabRow.append(chip);
    }

    const pinBtn = document.createElement('button');
    pinBtn.className = 'tab-chip';
    pinBtn.textContent = '＋ Pin this tab';
    pinBtn.title = 'Also apply this header in the current tab only';
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab && (h.tabIds ?? []).includes(tab.id)) {
        pinBtn.disabled = true;
        pinBtn.textContent = '✓ Current tab pinned';
      }
    });
    pinBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || h.tabIds.includes(tab.id)) return;
      h.tabIds.push(tab.id);
      render();
      save();
    });
    tabRow.append(pinBtn);

    panel.append(domains, tabRow);
    item.append(panel);
  }

  return item;
}

// Tooltip showing the full value of a truncated field; a single fixed-position
// element so it can't be clipped by the scrolling header list.
const tooltip = document.createElement('div');
tooltip.id = 'value-tooltip';
tooltip.hidden = true;
document.body.append(tooltip);
listEl.addEventListener('scroll', hideTooltip);

function showTooltip(input, text) {
  tooltip.textContent = text;
  tooltip.hidden = false;
  const r = input.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
  const fitsBelow = r.bottom + 4 + tooltip.offsetHeight + 8 <= window.innerHeight;
  tooltip.style.top = fitsBelow ? `${r.bottom + 4}px` : `${r.top - tooltip.offsetHeight - 4}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function updateCount() {
  countEl.textContent = state.paused
    ? 'paused'
    : `${state.headers.filter(isActiveHeader).length} active`;
}

function updateBadge() {
  const count = state.paused ? 0 : state.headers.filter(isActiveHeader).length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saveChain = saveChain.then(doSave);
  return saveChain;
}

async function doSave() {
  try {
    await chrome.storage.local.set(state);
    const { dynamic, session } = buildRuleSets(state);
    const [oldDynamic, oldSession] = await Promise.all([
      chrome.declarativeNetRequest.getDynamicRules(),
      chrome.declarativeNetRequest.getSessionRules(),
    ]);
    await Promise.all([
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: oldDynamic.map((r) => r.id),
        addRules: dynamic,
      }),
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: oldSession.map((r) => r.id),
        addRules: session,
      }),
    ]);
    updateBadge();
  } catch (err) {
    console.error('HeaderPilot: failed to save/sync rules', err);
  }
}
