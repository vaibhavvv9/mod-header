# HeaderPilot

A minimal Chrome extension (Manifest V3) that adds or overrides HTTP request
headers on all sites. No build step, no dependencies, no background worker —
the popup writes `declarativeNetRequest` dynamic rules that Chrome applies
natively, even after the browser is closed and reopened.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.

## Use

- **＋ Add header** — add a name/value pair. Changes save automatically.
- **Row toggle** — enable/disable one header without deleting it.
- **ON/OFF pill** — pause/resume all headers at once.
- **Funnel icon** — per-header filters: limit to specific domains
  (comma-separated, subdomains match) and/or pin to the current tab only.
  A tab-pinned header disables itself when that tab closes or the browser
  restarts. The icon shows indigo when a filter is active.
- **Toolbar badge** — the extension icon shows how many headers are active.
- Invalid header names (spaces, colons, non-ASCII) get a red tint and are
  skipped; empty names/values are kept in the list but never applied.

Verify at <https://httpbin.org/headers>, which echoes your request headers.

## Development

Pure logic lives in `rules.js`; run its tests with:

    npm test   # node --test, no dependencies

`popup.js` is DOM/chrome-API glue; `manifest.json` declares
`declarativeNetRequest` + `storage` permissions over `<all_urls>`.
