import { buildRules, isValidHeaderName, isActiveHeader } from './rules.js';

let state = { paused: false, headers: [] };
let saveTimer = null;
let saveChain = Promise.resolve();

const listEl = document.getElementById('header-list');
const emptyEl = document.getElementById('empty-state');
const addBtn = document.getElementById('add-header');
const masterBtn = document.getElementById('master-toggle');
const countEl = document.getElementById('active-count');

addBtn.addEventListener('click', () => {
  state.headers.push({ id: crypto.randomUUID(), name: '', value: '', enabled: true });
  render();
  listEl.querySelector('.row:last-child .name')?.focus();
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
  } catch (err) {
    console.error('HeaderPilot: failed to load state', err);
  }
  render();
  save(); // re-sync rules from stored state in case a previous save was interrupted
}

function render() {
  listEl.replaceChildren(...state.headers.map(renderRow));
  emptyEl.hidden = state.headers.length > 0;
  masterBtn.textContent = state.paused ? 'OFF' : 'ON';
  masterBtn.classList.toggle('on', !state.paused);
  document.body.classList.toggle('paused', state.paused);
  updateCount();
}

function renderRow(h) {
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

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '✕';
  del.title = 'Delete header';
  del.addEventListener('click', () => {
    state.headers = state.headers.filter((x) => x.id !== h.id);
    render();
    save();
  });

  row.append(toggle, name, value, del);
  return row;
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
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: buildRules(state),
    });
  } catch (err) {
    console.error('HeaderPilot: failed to save/sync rules', err);
  }
}
