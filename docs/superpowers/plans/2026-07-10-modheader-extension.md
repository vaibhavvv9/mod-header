# ModHeader Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that adds/overrides multiple HTTP request headers globally, with a compact light-minimal popup UI showing 8–10 header rows per screen.

**Architecture:** No background service worker. The popup owns all state (in `chrome.storage.local`) and, on every change, atomically swaps the full set of `declarativeNetRequest` dynamic rules. Pure logic (validation + rule computation) lives in `rules.js`, unit-tested with Node's built-in test runner; DOM/chrome-API glue lives in `popup.js`.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS. Zero runtime dependencies, no build step. Tests via `node --test` (Node ≥ 18).

## Global Constraints

- Manifest V3 only; permissions exactly `declarativeNetRequest`, `storage`; host permissions `<all_urls>`.
- No third-party dependencies, no build step. Extension loads unpacked from the repo root.
- DNR rule ids are positional integers (1, 2, 3, …) — never timestamps or UUIDs (must fit int32).
- Header row identity uses `crypto.randomUUID()` strings.
- Style tokens: white background, `#e5e7eb` hairline borders, accent indigo `#4f46e5`, system font stack, 13 px base size, 6 px radii, popup width 420 px.
- Header names validate against RFC 7230 token charset: `!#$%&'*+-.^_`|~0-9A-Za-z`.
- Commit after every task.

## File Structure

```
mod-header/
├── manifest.json          # MV3 manifest
├── package.json           # { "type": "module" } so .js = ESM for node --test; not used by Chrome
├── popup.html             # Popup markup
├── popup.css              # All styles
├── popup.js               # DOM + chrome.storage + DNR sync (imports rules.js)
├── rules.js               # Pure: isValidHeaderName(), buildRules() — unit tested
├── icons/icon{16,32,48,128}.png
├── scripts/gen-icons.mjs  # One-shot icon generator (zero-dep PNG writer)
├── test/rules.test.js     # node --test unit tests
└── README.md
```

---

### Task 1: Scaffolding — manifest, package.json, icons

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `scripts/gen-icons.mjs`
- Create: `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `manifest.json` referencing `popup.html` (created in Task 3) and `icons/*.png`; `package.json` with `"type": "module"` that Task 2's tests rely on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mod-header",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "ModHeader",
  "version": "1.0.0",
  "description": "Add or override request headers on all sites.",
  "permissions": ["declarativeNetRequest", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "ModHeader"
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 3: Create `scripts/gen-icons.mjs`** — a dependency-free PNG writer that draws an indigo rounded square with three white "header list" bars.

```js
// One-shot generator: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pixel(x, y, s) {
  const px = x + 0.5;
  const py = y + 0.5;
  const r = s * 0.22;
  const cx = Math.min(Math.max(px, r), s - r);
  const cy = Math.min(Math.max(py, r), s - r);
  if (Math.hypot(px - cx, py - cy) > r) return [0, 0, 0, 0]; // outside rounded corner
  const barCenters = [0.34, 0.5, 0.66];
  const inBarY = barCenters.some((c) => Math.abs(py / s - c) < 0.05);
  const inBarX = px / s > 0.27 && px / s < 0.73;
  if (inBarY && inBarX) return [255, 255, 255, 255]; // white bar
  return [79, 70, 229, 255]; // indigo #4f46e5
}

function makePng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixel(x, y, size), y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, makePng(size));
  console.log(`icons/icon${size}.png`);
}
```

- [ ] **Step 4: Generate icons and verify**

Run: `node scripts/gen-icons.mjs && node -e "JSON.parse(require('fs').readFileSync('manifest.json')); console.log('manifest OK')" && ls -la icons/`
Expected: four `icons/icon*.png` files listed (each a few hundred bytes to a few KB), and `manifest OK`.

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json scripts/gen-icons.mjs icons/
git commit -m "feat: scaffold MV3 manifest, package.json, generated icons"
```

---

### Task 2: `rules.js` — validation and rule computation (TDD)

**Files:**
- Create: `rules.js`
- Test: `test/rules.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 4's `popup.js`):
  - `isValidHeaderName(name: string): boolean` — RFC 7230 token check.
  - `buildRules(state: { paused: boolean, headers: Array<{ id: string, name: string, value: string, enabled: boolean }> }): Rule[]` — returns the complete DNR dynamic rule array (empty when paused).

- [ ] **Step 1: Write the failing tests** — create `test/rules.test.js`:

```js
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
  assert.ok(rules[0].condition.resourceTypes.includes('main_frame'));
  assert.ok(rules[0].condition.resourceTypes.includes('xmlhttprequest'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../rules.js'` (or equivalent ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Implement `rules.js`**

```js
// Pure logic: header-name validation and declarativeNetRequest rule computation.
// No chrome.* APIs here so it can run under node --test.

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other',
];

export function isValidHeaderName(name) {
  return TOKEN_RE.test(name);
}

export function buildRules(state) {
  if (state.paused) return [];
  return state.headers
    .filter((h) => h.enabled && h.value !== '' && isValidHeaderName(h.name))
    .map((h, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: h.name, operation: 'set', value: h.value }],
      },
      condition: { urlFilter: '*', resourceTypes: RESOURCE_TYPES },
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add rules.js test/rules.test.js
git commit -m "feat: header validation and DNR rule computation with tests"
```

---

### Task 3: Popup markup and styles

**Files:**
- Create: `popup.html`
- Create: `popup.css`

**Interfaces:**
- Consumes: nothing.
- Produces (element ids Task 4's `popup.js` queries): `#header-list`, `#empty-state`, `#add-header`, `#master-toggle`, `#active-count`. CSS classes Task 4 toggles: `row`, `off`, `switch`, `on`, `name`, `value`, `invalid`, `delete`, `pill`, `paused` (on `<body>`).

- [ ] **Step 1: Create `popup.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="topbar">
    <h1>ModHeader</h1>
    <button id="master-toggle" class="pill on" title="Pause or resume all headers">ON</button>
  </header>
  <main id="header-list"></main>
  <div id="empty-state">No headers yet — click <strong>＋ Add header</strong></div>
  <footer>
    <button id="add-header">＋ Add header</button>
    <span id="active-count">0 active</span>
  </footer>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

Note: `#empty-state` is visible by default (no `hidden` attribute) so the static page is previewable; `popup.js` hides it when headers exist.

- [ ] **Step 2: Create `popup.css`**

```css
:root {
  --accent: #4f46e5;
  --accent-soft: #eef2ff;
  --border: #e5e7eb;
  --text: #111827;
  --muted: #9ca3af;
  --danger: #dc2626;
}

* { box-sizing: border-box; margin: 0; }

body {
  width: 420px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  background: #fff;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.topbar h1 { font-size: 15px; font-weight: 600; }

.pill {
  border: 1px solid var(--border);
  background: #f3f4f6;
  color: var(--muted);
  border-radius: 999px;
  padding: 3px 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.pill.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

#header-list {
  max-height: 440px;
  overflow-y: auto;
  padding: 6px 8px;
}

body.paused #header-list { opacity: 0.45; }

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
}

.row:hover { background: #f9fafb; }

.row.off input { opacity: 0.45; }

.switch {
  flex: none;
  width: 30px;
  height: 17px;
  border: none;
  border-radius: 999px;
  background: #d1d5db;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}

.switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}

.switch.on { background: var(--accent); }
.switch.on::after { left: 15px; }

.row input {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 13px;
  background: transparent;
  color: var(--text);
}

.row input:hover { border-color: var(--border); }

.row input:focus {
  outline: none;
  border-color: var(--accent);
  background: #fff;
}

.name { flex: 0 0 38%; font-weight: 500; }

.value {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.name.invalid { border-color: var(--danger); background: #fef2f2; }

.delete {
  flex: none;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: none;
  color: transparent;
  font-size: 13px;
  cursor: pointer;
}

.row:hover .delete { color: var(--muted); }
.delete:hover { color: var(--danger); background: #fee2e2; }

#empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--muted);
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}

#add-header {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 5px;
}

#add-header:hover { background: var(--accent-soft); }

#active-count { color: var(--muted); font-size: 12px; }
```

- [ ] **Step 3: Visual check**

Run: `open popup.html` (opens in default browser; the `popup.js` 404 is expected at this stage).
Expected: 420px-content page with "ModHeader" topbar + indigo ON pill, centered empty-state hint, footer with indigo "＋ Add header" and "0 active". Hairline borders, white background.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.css
git commit -m "feat: popup markup and compact light-minimal styles"
```

---

### Task 4: `popup.js` — state, rendering, storage, rule sync

**Files:**
- Create: `popup.js`

**Interfaces:**
- Consumes: `buildRules(state)`, `isValidHeaderName(name)` from `rules.js` (Task 2); element ids/classes from `popup.html`/`popup.css` (Task 3).
- Produces: complete working extension.

- [ ] **Step 1: Create `popup.js`**

```js
import { buildRules, isValidHeaderName } from './rules.js';

let state = { paused: false, headers: [] };
let saveTimer = null;

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

init();

async function init() {
  state = await chrome.storage.local.get({ paused: false, headers: [] });
  render();
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

function isActive(h) {
  return h.enabled && h.value !== '' && isValidHeaderName(h.name);
}

function updateCount() {
  countEl.textContent = state.paused
    ? 'paused'
    : `${state.headers.filter(isActive).length} active`;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

async function save() {
  clearTimeout(saveTimer);
  try {
    await chrome.storage.local.set(state);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: buildRules(state),
    });
  } catch (err) {
    console.error('ModHeader: failed to save/sync rules', err);
  }
}
```

- [ ] **Step 2: Run unit tests still pass**

Run: `npm test`
Expected: PASS — 5 tests (popup.js is not under test; this guards against accidental rules.js edits).

- [ ] **Step 3: Load unpacked and smoke test**

1. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select the repo root.
2. Open the ModHeader popup. Expected: empty state visible, "0 active", ON pill indigo.
3. Click "＋ Add header" — a focused empty row appears. Type name `X-Modheader-Test`, value `hello`. Footer shows "1 active" (after typing).
4. Type an invalid name (`bad name`) in a second row — name input gets red tint, count excludes it.
5. Toggle a row off — row dims, count decrements. Click master pill — it shows OFF, list dims, count shows "paused".
6. Delete a row with ✕ — row disappears.
7. Close and reopen the popup — state persisted.

Expected: all of the above; no errors in the popup's DevTools console (right-click popup → Inspect).

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: popup logic — storage-backed state and atomic DNR rule sync"
```

---

### Task 5: End-to-end verification and README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the complete extension from Tasks 1–4.
- Produces: verified behavior + install/usage docs.

- [ ] **Step 1: End-to-end header verification**

1. In the popup, add header `X-Modheader-Test` = `hello`, enabled, master ON.
2. Visit `https://httpbin.org/headers`.
3. Expected: response JSON includes `"X-Modheader-Test": "hello"`.
4. Toggle the header off, reload the page. Expected: header gone from the JSON.
5. Toggle back on, switch master to OFF, reload. Expected: header gone.
6. Master back ON, reload. Expected: header present again.
7. Add a second header `X-Another` = `world`, reload. Expected: both headers present.

(If httpbin.org is unreachable, `https://postman-echo.com/headers` is an equivalent fallback.)

- [ ] **Step 2: Write `README.md`**

```markdown
# ModHeader

A minimal Chrome extension (Manifest V3) that adds or overrides HTTP request
headers on all sites. No build step, no dependencies, no background worker —
the popup writes `declarativeNetRequest` dynamic rules that Chrome applies
natively, even while the browser is closed and reopened.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.

## Use

- **＋ Add header** — add a name/value pair. Changes save automatically.
- **Row toggle** — enable/disable one header without deleting it.
- **ON/OFF pill** — pause/resume all headers at once.
- Invalid header names (spaces, colons, non-ASCII) get a red tint and are
  skipped; empty names/values are kept in the list but never applied.

Verify at <https://httpbin.org/headers>, which echoes your request headers.

## Development

Pure logic lives in `rules.js`; run its tests with:

    npm test   # node --test, no dependencies

`popup.js` is DOM/chrome-API glue; `manifest.json` declares
`declarativeNetRequest` + `storage` permissions over `<all_urls>`.
```

- [ ] **Step 3: Final test run and commit**

Run: `npm test`
Expected: PASS — 5 tests.

```bash
git add README.md
git commit -m "docs: README with install, usage, and dev notes"
```
